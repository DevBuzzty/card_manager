// supabase/functions/_shared/ebay-client.ts
// Spec H3b §4/§5 -- schlanker eBay-Client nur mit fetch (kein SDK). fetch wird hereingereicht (Tests: nachgebautes eBay,
// kein Netz). Fehler kommen einheitlich als EbayError (transient = Durchgang abbrechen, auth = neu verbinden).
// NIE Tokens, Codes oder Secrets protokollieren oder in Fehlermeldungen übernehmen.
import { type AspectDef, MARKETPLACE } from "./ebay-map.ts";

export type Env = "sandbox" | "production";
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type Creds = { clientId: string; clientSecret: string; ruName: string };

export const HOSTS: Record<Env, { auth: string; api: string }> = {
  sandbox: { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com" },
  production: { auth: "https://auth.ebay.com", api: "https://api.ebay.com" },
};
// Befund eBay-Doku 3: dieselben Scope-Adressen in Sandbox und Produktion.
export const USER_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
];
// Befund eBay-Doku 9: Taxonomy verlangt ein Anwendungs-Token (client_credentials) mit dem Basis-Scope.
export const APP_SCOPE = "https://api.ebay.com/oauth/api_scope";

export class EbayError extends Error {
  constructor(message: string, readonly status: number, readonly transient: boolean, readonly auth: boolean) {
    super(message);
  }
}

// Secrets je Umgebung (Spec §4.1); fehlen sie, ist das ein Einrichtungsfehler, kein eBay-Fehler.
export function credsFor(env: Env, get: (k: string) => string | undefined): Creds {
  const p = env === "production" ? "EBAY_PROD" : "EBAY_SANDBOX";
  const clientId = get(`${p}_CLIENT_ID`), clientSecret = get(`${p}_CLIENT_SECRET`), ruName = get(`${p}_RUNAME`);
  if (!clientId || !clientSecret || !ruName) {
    throw new EbayError(`eBay-Zugangsdaten für ${env === "production" ? "Produktion" : "Sandbox"} fehlen (Secrets ${p}_…).`, 0, false, false);
  }
  return { clientId, clientSecret, ruName };
}

export function consentUrl(env: Env, c: Creds, state: string): string {
  const q = new URLSearchParams({
    client_id: c.clientId, redirect_uri: c.ruName, response_type: "code", scope: USER_SCOPES.join(" "), state,
  });
  return `${HOSTS[env].auth}/oauth2/authorize?${q.toString()}`;
}

const basic = (c: Creds) => `Basic ${btoa(`${c.clientId}:${c.clientSecret}`)}`;
const isoIn = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString();

async function readJson(r: Response): Promise<any> {
  const t = await r.text();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; }
}
// eBay-REST-Fehler: { errors: [{ errorId, message, longMessage }] }; OAuth: { error, error_description }.
function errorText(body: any, status: number): string {
  const e = body?.errors?.[0];
  const text = e?.longMessage || e?.message || body?.error_description || body?.error || body?.raw;
  return text ? String(text) : `eBay-Aufruf fehlgeschlagen (${status})`;
}
// Fixrunde 1 Befund 1: invalid_client (falsches App-Secret) darf NICHT als auth gelten -- sonst löscht der Aufrufer
// den noch gültigen Nutzer-Refresh-Token und "neu verbinden" hilft nie. Am Token-Endpunkt gilt nur invalid_grant
// (abgelaufener/widerrufener Nutzer-Token) als auth; invalid_client und jeder andere 4xx dort sind Einrichtungsfehler.
function toError(body: any, status: number, oauth: boolean): EbayError {
  const transient = status === 429 || status >= 500;
  const code = String(body?.error ?? "").toLowerCase();
  if (oauth && code === "invalid_client") {
    return new EbayError("eBay-Zugangsdaten der App ungültig – Secrets prüfen.", status, false, false);
  }
  const auth = oauth ? (status === 400 || status === 401) && code === "invalid_grant" : status === 401;
  return new EbayError(errorText(body, status), status, transient, auth);
}
// Fixrunde 1 Befund 5: Zeitlimit für jeden Aufruf, damit ein hängender eBay-Aufruf den Abgleich nicht blockiert.
// Ein Abbruch/Netzwerkfehler ist kein eBay-Fehler mit Status, sondern vorübergehend (Durchgang abbrechen, später erneut).
async function send(fetchFn: Fetch, url: string, init: RequestInit, oauth = false): Promise<any> {
  let r: Response;
  try { r = await fetchFn(url, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000) }); }
  catch (e) { throw new EbayError(`eBay nicht erreichbar: ${(e as Error).message}`, 0, true, false); }
  const body = await readJson(r);
  if (!r.ok) throw toError(body, r.status, oauth);
  return body;
}
// Fixrunde 1 Befund 2/3: eine 200-Antwort ohne Pflichtfeld (oder ganz ohne Body) ist kein gültiges Ergebnis --
// EbayError statt eines rohen TypeError/RangeError oder der Zeichenkette "undefined" weiterreichen.
function requireField(b: any, key: string): unknown {
  const v = b?.[key];
  if (v === null || v === undefined || v === "") {
    throw new EbayError(`eBay-Antwort unvollständig (Feld „${key}“ fehlt).`, 0, false, false);
  }
  return v;
}

export type TokenSet = { access_token: string; access_expires_at: string; refresh_token: string; refresh_expires_at: string };

async function tokenCall(fetchFn: Fetch, env: Env, c: Creds, form: Record<string, string>) {
  return await send(fetchFn, `${HOSTS[env].api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic(c) },
    body: new URLSearchParams(form).toString(),
  }, true);
}
export async function exchangeCode(fetchFn: Fetch, env: Env, c: Creds, code: string, now: Date): Promise<TokenSet> {
  const b = await tokenCall(fetchFn, env, c, { grant_type: "authorization_code", code, redirect_uri: c.ruName });
  return {
    access_token: String(requireField(b, "access_token")), access_expires_at: isoIn(now, Number(requireField(b, "expires_in"))),
    refresh_token: String(requireField(b, "refresh_token")), refresh_expires_at: isoIn(now, Number(requireField(b, "refresh_token_expires_in"))),
  };
}
export async function refreshAccess(fetchFn: Fetch, env: Env, c: Creds, refreshToken: string, now: Date) {
  const b = await tokenCall(fetchFn, env, c, { grant_type: "refresh_token", refresh_token: refreshToken, scope: USER_SCOPES.join(" ") });
  return { access_token: String(requireField(b, "access_token")), access_expires_at: isoIn(now, Number(requireField(b, "expires_in"))) };
}
export async function appToken(fetchFn: Fetch, env: Env, c: Creds): Promise<string> {
  const b = await tokenCall(fetchFn, env, c, { grant_type: "client_credentials", scope: APP_SCOPE });
  return String(requireField(b, "access_token"));
}

// Gültiges Nutzer-Token: das gespeicherte, solange es noch mindestens 5 Minuten gilt, sonst erneuert.
// -> { token, patch } (patch = zu speichernde neue Werte oder null).
export async function ensureAccess(
  fetchFn: Fetch, env: Env, c: Creds,
  acc: { access_token: string | null; access_expires_at: string | null; refresh_token: string | null }, now: Date,
) {
  if (acc.access_token && acc.access_expires_at && Date.parse(acc.access_expires_at) - now.getTime() > 5 * 60 * 1000) {
    return { token: acc.access_token, patch: null };
  }
  if (!acc.refresh_token) throw new EbayError("Nicht mit eBay verbunden.", 401, false, true);
  const p = await refreshAccess(fetchFn, env, c, acc.refresh_token, now);
  return { token: p.access_token, patch: p };
}

export type Offer = {
  offerId: string; sku?: string; marketplaceId?: string; status?: string;
  listing?: { listingId?: string; listingStatus?: string; soldQuantity?: number };
};

export function ebayApi(fetchFn: Fetch, env: Env, token: string) {
  const base = HOSTS[env].api;
  const call = (method: string, path: string, body?: unknown) =>
    send(fetchFn, `${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json",
        "Content-Language": "de-DE", "Accept-Language": "de-DE",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const enc = encodeURIComponent;
  const mp = `marketplace_id=${MARKETPLACE}`;
  return {
    optedInPrograms: async () => ((await call("GET", "/sell/account/v1/program/get_opted_in_programs"))?.programs ?? [])
      .map((p: any) => String(p.programType)),
    paymentPolicies: async () => ((await call("GET", `/sell/account/v1/payment_policy?${mp}`))?.paymentPolicies ?? [])
      .map((p: any) => ({ id: String(p.paymentPolicyId), name: String(p.name ?? "") })),
    fulfillmentPolicies: async () => ((await call("GET", `/sell/account/v1/fulfillment_policy?${mp}`))?.fulfillmentPolicies ?? [])
      .map((p: any) => ({ id: String(p.fulfillmentPolicyId), name: String(p.name ?? "") })),
    returnPolicies: async () => ((await call("GET", `/sell/account/v1/return_policy?${mp}`))?.returnPolicies ?? [])
      .map((p: any) => ({ id: String(p.returnPolicyId), name: String(p.name ?? "") })),
    locations: async () => ((await call("GET", "/sell/inventory/v1/location?limit=100"))?.locations ?? [])
      .filter((l: any) => l.merchantLocationStatus !== "DISABLED")
      .map((l: any) => ({ id: String(l.merchantLocationKey), name: String(l.name ?? l.merchantLocationKey) })),
    createLocation: (key: string, body: unknown) => call("POST", `/sell/inventory/v1/location/${enc(key)}`, body),
    putInventoryItem: (sku: string, body: unknown) => call("PUT", `/sell/inventory/v1/inventory_item/${enc(sku)}`, body),
    // Keine Offer zur SKU: eBay antwortet 404 -> leere Liste.
    getOffers: async (sku: string): Promise<Offer[]> => {
      try { return (await call("GET", `/sell/inventory/v1/offer?sku=${enc(sku)}&${mp}`))?.offers ?? []; }
      catch (e) { if (e instanceof EbayError && e.status === 404) return []; throw e; }
    },
    getOffer: async (offerId: string): Promise<Offer | null> => {
      try { return await call("GET", `/sell/inventory/v1/offer/${enc(offerId)}`); }
      catch (e) { if (e instanceof EbayError && e.status === 404) return null; throw e; }
    },
    createOffer: async (body: unknown) => String(requireField(await call("POST", "/sell/inventory/v1/offer", body), "offerId")),
    updateOffer: (offerId: string, body: unknown) => call("PUT", `/sell/inventory/v1/offer/${enc(offerId)}`, body),
    publishOffer: async (offerId: string) => String(requireField(await call("POST", `/sell/inventory/v1/offer/${enc(offerId)}/publish`), "listingId")),
    withdrawOffer: (offerId: string) => call("POST", `/sell/inventory/v1/offer/${enc(offerId)}/withdraw`),
  };
}
export type EbayApi = ReturnType<typeof ebayApi>;

// Taxonomy mit Anwendungs-Token (Befund eBay-Doku 9/10): Baum-ID für EBAY_DE, dann die Merkmale der Kategorie.
export async function categoryAspects(fetchFn: Fetch, env: Env, appTok: string, categoryId: string) {
  const h = { headers: { Authorization: `Bearer ${appTok}`, Accept: "application/json", "Accept-Language": "de-DE" } };
  const base = `${HOSTS[env].api}/commerce/taxonomy/v1`;
  const tree = await send(fetchFn, `${base}/get_default_category_tree_id?marketplace_id=${MARKETPLACE}`, h);
  const treeId = String(tree.categoryTreeId);
  const a = await send(fetchFn, `${base}/category_tree/${encodeURIComponent(treeId)}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`, h);
  return (a?.aspects ?? []) as AspectDef[];
}
