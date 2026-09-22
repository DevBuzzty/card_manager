// supabase/functions/ebay-auth/handler.ts
// Spec H3b §4.3 -- Verbinden und Einrichten. Deploy mit --no-verify-jwt (der eBay-Rücksprung kommt ohne Anmeldung);
// alle anderen Aktionen prüfen das JWT hier selbst. Tokens nie protokollieren, nie an Geräte zurückgeben.
import {
  consentUrl, credsFor, type EbayApi, ebayApi, EbayError, ensureAccess, type Env, exchangeCode, type Fetch,
} from "../_shared/ebay-client.ts";
import type { Account } from "../_shared/ebay-store.ts";
import { json, jsonBody, text } from "../_shared/http.ts";
import { type Chosen, checkLocationInput, KINDS, type Lists, locationBody, POLICY_PAGE, resolveSetup, SetupError } from "./setup.ts";

export type AuthStore = {
  account(): Promise<Account>; saveAccount(p: Partial<Account>): Promise<void>;
  // Rücksprung-state atomar verbrauchen (löschen), nur wenn er noch passt und nicht abgelaufen ist.
  consumeState(state: string): Promise<boolean>;
  // Anzeigen mit Offer, die in dieser Umgebung noch nicht beendet sind (online oder fehler).
  liveOfferCount(env: string): Promise<number>;
  // Fixrunde 1 Befund 1: set_environment/disconnect dürfen nicht mitten in einen ebay-sync-Lauf fallen (gleiche
  // Sperre wie der Abgleicher, ebay_try_lock/ebay_unlock).
  tryLock(holder: string, seconds: number): Promise<boolean>;
  unlock(holder: string): Promise<void>;
};
export type AuthDeps = {
  store: AuthStore; fetch: Fetch; env: (k: string) => string | undefined; now: () => Date;
  verifyUser: (authorization: string | null) => Promise<boolean>; randomState: () => string;
};

export const STATE_MINUTES = 10;
export const LOCATION_KEY = "ygo-default";
export const OK_PAGE = "Verbunden – du kannst das Fenster schließen.";
export const failPage = (why: string) => `Verbindung fehlgeschlagen: ${why}`;
export const LOCK_BUSY = "Abgleich läuft gerade – bitte gleich noch einmal.";
const LOCK_SECONDS = 60;
const TOKENS_NULL = { refresh_token: null, refresh_expires_at: null, access_token: null, access_expires_at: null, connected_at: null };
const SETUP_NULL = {
  payment_policy_id: null, payment_policy_name: null, fulfillment_policy_id: null, fulfillment_policy_name: null,
  return_policy_id: null, return_policy_name: null, location_key: null,
};

async function userApi(d: AuthDeps, acc: Account): Promise<EbayApi> {
  if (!acc.refresh_token) throw new SetupError("Nicht mit eBay verbunden.");
  const env = acc.environment as Env;
  const t = await ensureAccess(d.fetch, env, credsFor(env, d.env), acc, d.now());
  if (t.patch) await d.store.saveAccount(t.patch);
  return ebayApi(d.fetch, env, t.token);
}

// Fixrunde 1 Befund 1: set_environment/disconnect nur unter der Sperre -- sonst kann ein laufender ebay-sync noch
// die alte Umgebung veröffentlichen oder einen Token in die falsche Zeile schreiben.
async function withLock(d: AuthDeps, fn: () => Promise<Response>): Promise<Response> {
  const holder = `ebay-auth:${crypto.randomUUID()}`;
  if (!(await d.store.tryLock(holder, LOCK_SECONDS))) return json({ ok: false, error: LOCK_BUSY });
  try {
    return await fn();
  } finally {
    await d.store.unlock(holder);
  }
}

// Fixrunde 1 Befund 4: nur schreiben, wenn sich mindestens ein Feld tatsächlich ändert -- sonst springt
// ebay_status.updated_at (Trigger) bei jedem Check, obwohl sich an der Einrichtung nichts geändert hat.
function differs(acc: Account, patch: Partial<Account>): boolean {
  return (Object.keys(patch) as (keyof Account)[]).some((k) => acc[k] !== patch[k]);
}

// Einrichtungs-Check (Spec §4.3 check/select): Listen lesen, Auswahl bestimmen, IDs + Namen speichern.
async function runCheck(d: AuthDeps, chosen: Chosen = {}) {
  const acc = await d.store.account();
  const api = await userApi(d, acc);
  const programs = await api.optedInPrograms();
  const lists: Lists = {
    payment: await api.paymentPolicies(), fulfillment: await api.fulfillmentPolicies(),
    return: await api.returnPolicies(), location: await api.locations(),
  };
  const r = resolveSetup(lists, {
    payment: acc.payment_policy_id, fulfillment: acc.fulfillment_policy_id, return: acc.return_policy_id, location: acc.location_key,
  }, chosen);
  if (differs(acc, r.patch)) await d.store.saveAccount(r.patch);
  const out: Record<string, unknown> = {
    ok: true, programOk: programs.includes("SELLING_POLICY_MANAGEMENT"), policyPage: POLICY_PAGE[acc.environment] ?? null,
  };
  for (const k of KINDS) out[k] = { options: lists[k], selected: r.selected[k]?.id ?? null };
  return out;
}

// Abschluss-Fix A2: eBay hängt an eine RuName-Adresse, die schon "?" enthält, eventuell nochmals "?" statt "&" an
// (".../ebay-auth?action=callback?state=...&code=..."). Dann steckt der erste eigene Parameter im action-Wert --
// hier herauslösen, damit state/code/error gefunden werden. Liefert die bereinigten Parameter.
export function callbackParams(url: URL): URLSearchParams {
  const p = new URLSearchParams(url.searchParams);
  const a = p.get("action");
  const q = a == null ? -1 : a.indexOf("?");
  if (a != null && q >= 0) {
    p.set("action", a.slice(0, q));
    for (const [k, v] of new URLSearchParams(a.slice(q + 1))) if (!p.has(k)) p.set(k, v);
  }
  return p;
}

// Ein GET ist ein Rücksprung, sobald er code, state oder error trägt -- unabhängig vom action-Wert.
function isCallback(p: URLSearchParams): boolean {
  const a = p.get("action");
  return a === "callback" || a === "declined" || p.has("code") || p.has("state") || p.has("error");
}

async function callback(p: URLSearchParams, d: AuthDeps): Promise<Response> {
  if (p.get("action") === "declined" || (p.has("error") && !p.has("code"))) {
    // Info: offenen state gleich leeren, statt ihn ungenutzt auslaufen zu lassen.
    await d.store.saveAccount({ oauth_state: null, oauth_state_expires_at: null });
    return text(failPage("bei eBay abgelehnt."));
  }
  const state = p.get("state");
  // Fixrunde 1 Befund 2: state atomar verbrauchen (bedingtes Update in der Datenbank) statt lesen-dann-schreiben --
  // sonst könnten zwei gleichzeitige Rücksprünge mit demselben state beide durchkommen.
  if (!state || !(await d.store.consumeState(state))) {
    return text(failPage("Anmeldelink abgelaufen oder ungültig – bitte in der App neu verbinden."), 400);
  }
  const acc = await d.store.account();
  const code = p.get("code");
  if (!code) return text(failPage("eBay hat keinen Code geliefert."), 400);
  try {
    const env = acc.environment as Env;
    const t = await exchangeCode(d.fetch, env, credsFor(env, d.env), code, d.now());
    await d.store.saveAccount({ ...t, connected_at: d.now().toISOString(), last_error: null });
  } catch (e) {
    return text(failPage((e as Error).message), 400);
  }
  // Genau eine Richtlinie je Art -> gleich wählen (Spec §4.3); ein Fehler hier ändert nichts an der Verbindung.
  try { await runCheck(d); } catch (e) { console.error("[ebay-auth] Check nach dem Verbinden:", (e as Error).message); }
  return text(OK_PAGE);
}

export async function handleAuth(req: Request, d: AuthDeps): Promise<Response> {
  const url = new URL(req.url);
  const qa = url.searchParams.get("action");
  if (req.method === "GET") {
    const p = callbackParams(url);
    if (isCallback(p)) return await callback(p, d);
  }
  if (req.method !== "POST") return json({ ok: false, error: "Nur POST." }, 405);
  if (!(await d.verifyUser(req.headers.get("authorization")))) return json({ ok: false, error: "Nicht angemeldet." }, 401);
  const body = await jsonBody(req);
  const action = String(body.action ?? qa ?? "");
  try {
    switch (action) {
      case "start": {
        const acc = await d.store.account();
        const env = acc.environment as Env;
        const creds = credsFor(env, d.env);
        const state = d.randomState();
        await d.store.saveAccount({
          oauth_state: state, oauth_state_expires_at: new Date(d.now().getTime() + STATE_MINUTES * 60000).toISOString(),
        });
        return json({ ok: true, url: consentUrl(env, creds, state) });
      }
      case "check":
        return json(await runCheck(d));
      case "select": {
        const chosen: Chosen = {};
        for (const [k, f] of [["payment", "payment_policy_id"], ["fulfillment", "fulfillment_policy_id"], ["return", "return_policy_id"], ["location", "location_key"]] as const) {
          // Fixrunde 1 Befund 3: leere Zeichenkette wie "keine Auswahl" behandeln (globale Regel: leer = null).
          if (typeof body[f] === "string" && body[f] !== "") chosen[k] = body[f] as string;
        }
        return json(await runCheck(d, chosen));
      }
      case "create_location": {
        const bad = checkLocationInput(body.postal_code, body.city);
        if (bad) return json({ ok: false, error: bad });
        const api = await userApi(d, await d.store.account());
        try { await api.createLocation(LOCATION_KEY, locationBody(String(body.postal_code).trim(), String(body.city).trim())); }
        catch (e) { if (!(e instanceof EbayError && e.status === 409)) throw e; } // gibt es schon -> weiter
        return json(await runCheck(d, { location: LOCATION_KEY }));
      }
      case "set_environment":
        return await withLock(d, async () => {
          const env = body.environment;
          if (env !== "sandbox" && env !== "production") return json({ ok: false, error: "Unbekannte Umgebung." });
          const acc = await d.store.account();
          if (env === acc.environment) return json({ ok: true });
          // Abweichung 7: ein Wechsel ließe die Anzeigen der alten Umgebung für immer online (niemand zieht sie zurück).
          const n = await d.store.liveOfferCount(acc.environment);
          if (n > 0) {
            const where = acc.environment === "production" ? "der Produktion" : "der Sandbox";
            return json({ ok: false, error: `Zuerst die ${n} eBay-Anzeige${n === 1 ? "" : "n"} in ${where} beenden – sonst bleiben sie dort online.` });
          }
          await d.store.saveAccount({ environment: env, ...TOKENS_NULL, ...SETUP_NULL, oauth_state: null, oauth_state_expires_at: null, last_error: null });
          return json({ ok: true });
        });
      case "disconnect":
        return await withLock(d, async () => {
          await d.store.saveAccount({ ...TOKENS_NULL });
          return json({ ok: true });
        });
      default:
        return json({ ok: false, error: "Unbekannte Aktion." }, 400);
    }
  } catch (e) {
    if (e instanceof SetupError) return json({ ok: false, error: e.message });
    if (e instanceof EbayError) return json({ ok: false, error: e.auth ? "Verbindung abgelaufen – bitte neu verbinden" : e.message });
    console.error("[ebay-auth]", action, (e as Error).message);
    return json({ ok: false, error: "Interner Fehler." }, 500);
  }
}
