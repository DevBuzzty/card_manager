// supabase/functions/ebay-sync/sync.ts
// Spec H3b §8 -- ein Durchgang des Abgleichers: Schritt 1 (Token), 2+3 (H3b2: Bestellungen buchen, Gebühren nachtragen --
// ebay-sync/orders.ts), 4 (Angebote abgleichen, höchstens 50), 5 (Stand schreiben). Nur ein Durchgang gleichzeitig (Sperre in ebay_account, Abweichung 2). Einzelne Ablehnungen
// betreffen nur ihr Angebot; eBay nicht erreichbar / Verbindung weg bricht den Durchgang ab (Spec §9).
import {
  appToken, categoryAspects, credsFor, type EbayApi, ebayApi, EbayError, ensureAccess, type Env, type Fetch, type Offer,
} from "../_shared/ebay-client.ts";
import {
  type AspectDef, type Built, buildListing, categoryFor, desired, hashOf, inventoryItemBody, itemUrl, MARKETPLACE,
  offerBody, ownPhotos, photoUrl, type Policies,
} from "../_shared/ebay-map.ts";
import {
  decide, type EbayRow, emptySummary, ENDED_ON_EBAY, EXPIRED, offerEnded, SOLD_ON_EBAY, type Summary, summaryText,
} from "../_shared/ebay-plan.ts";
import type { Store } from "../_shared/ebay-store.ts";
import { notices, tokenDue } from "../_shared/ebay-orders.ts";
import { runFees, runOrders } from "./orders.ts";

export const LOCK_SECONDS = 300;
export const MAX_PER_RUN = 50;
// Fixrunde 1 (Task 5) Important 1: Frist ab Laufstart -- danach werden verbleibende Angebote nicht mehr
// bearbeitet, sondern als "deferred" gezählt (nächster Lauf holt sie nach). Uhr kommt von d.now(), testbar.
// Abschluss-Fix A3: 60 s (vorher 100 s), damit der Lauf sicher unter dem Funktions-Zeitlimit bleibt.
export const RUN_BUDGET_MS = 60_000;

export type SyncDeps = { store: Store; fetch: Fetch; env: (k: string) => string | undefined; now: () => Date; holder: string };
export type SyncResult =
  | { ok: true; busy: true; text: string }
  | { ok: true; busy: false; summary: Summary; text: string }
  | { ok: false; error: string };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
class ListingProblem extends Error {}

function freshRow(id: string, env: string): EbayRow {
  return {
    listing_id: id, environment: env, state: "wartet", sku: null, offer_id: null, item_id: null, item_url: null,
    published_qty: null, synced_hash: null, failed_hash: null, sold_seen: null, error: null, synced_at: null,
  };
}

async function publish(api: EbayApi, b: Built, p: Policies): Promise<{ offerId: string; listingId: string; sold: number }> {
  await api.putInventoryItem(b.sku, inventoryItemBody(b));
  // Nach einem Abbruch mitten im Einstellen gibt es die Offer schon: wiederverwenden statt doppelt anlegen.
  const existing = (await api.getOffers(b.sku)).find((o) => (o.marketplaceId ?? MARKETPLACE) === MARKETPLACE) ?? null;
  if (!existing) {
    const offerId = await api.createOffer(offerBody(b, p));
    return { offerId, listingId: await api.publishOffer(offerId), sold: 0 };
  }
  await api.updateOffer(existing.offerId, offerBody(b, p));
  if (!offerEnded(existing)) {
    return { offerId: existing.offerId, listingId: String(existing.listing?.listingId), sold: existing.listing?.soldQuantity ?? 0 };
  }
  return { offerId: existing.offerId, listingId: await api.publishOffer(existing.offerId), sold: 0 };
}

async function revise(api: EbayApi, b: Built, p: Policies, row: EbayRow, ack: boolean) {
  const offer: Offer | null = await api.getOffer(row.offer_id!);
  if (!offer) return await publish(api, b, p);
  const ended = offerEnded(offer);
  const sold = offer.listing?.soldQuantity ?? 0;
  // Abschluss-Fix A1: Verkauf vor "beendet" prüfen -- eine verkaufte und danach beendete Anzeige darf nicht als
  // "erneut einstellen" erscheinen (ack würde sie mit alter Menge neu einstellen -> Doppelverkauf).
  if (sold > (row.sold_seen ?? 0) && !ack) throw new ListingProblem(SOLD_ON_EBAY);
  if (ended && !ack) throw new ListingProblem(ENDED_ON_EBAY);
  await api.putInventoryItem(b.sku, inventoryItemBody(b));
  await api.updateOffer(offer.offerId, offerBody(b, p));
  if (ended) return { offerId: offer.offerId, listingId: await api.publishOffer(offer.offerId), sold: 0 };
  return { offerId: offer.offerId, listingId: String(offer.listing?.listingId), sold };
}

export async function runSync(d: SyncDeps, opts: { retry?: string | null; max?: number } = {}): Promise<SyncResult> {
  const retryId = opts.retry ?? null;
  const max = opts.max ?? MAX_PER_RUN;
  const now = d.now();
  const nowIso = now.toISOString();
  const deadline = now.getTime() + RUN_BUDGET_MS;
  // Fixrunde 1 (Task 5) Minor 6: die Sperre selbst gehört in den try -- ein Store-Fehler hier (z.B. DB weg) soll
  // als {ok:false,error} zurückkommen statt die Funktion roh scheitern zu lassen. `locked` steuert, ob am Ende
  // entsperrt/ein Fehlerstand geschrieben wird (vor einer erfolgreichen Sperre gibt es beides nicht zu tun).
  let locked = false;
  // Fixrunde 2 (Task 5) Minor 3: "war zu Laufbeginn verbunden" und der bisherige Hinweis -- damit ein unabhängiger
  // Fehler (z.B. Store weg) im äußeren catch einen stehenden EXPIRED nicht mit einer Zufallsmeldung überschreibt.
  let connectedSnapshot = false;
  let priorLastError: string | null = null;
  const s = emptySummary();
  try {
    if (!(await d.store.tryLock(d.holder, LOCK_SECONDS))) return { ok: true, busy: true, text: "läuft schon" };
    locked = true;
    const acc = await d.store.account();
    connectedSnapshot = !!acc.refresh_token;
    priorLastError = acc.last_error;
    const env = acc.environment as Env;
    let lastError: string | null = null;
    let api: EbayApi | null = null;
    let connected = !!acc.refresh_token;
    let authReason: string | null = null;
    const expired = !!acc.refresh_expires_at && Date.parse(acc.refresh_expires_at) <= now.getTime();
    const creds = connected ? credsFor(env, d.env) : null;
    // Schritt 1: Token erneuern. Abgelehnt (invalid_grant) oder abgelaufen -> trennen, Angebote bleiben „wartet“.
    if (connected && !expired) {
      try {
        const t = await ensureAccess(d.fetch, env, creds!, acc, now);
        // Fixrunde 1 (Task 5) Minor 5: nur schreiben, wenn Refresh-Token/Umgebung noch zur gelesenen Zeile passen
        // (Wettlauf mit set_environment/disconnect in ebay-auth oder einem zweiten Lauf).
        if (t.patch) {
          const ok = await d.store.saveAccountIf({ refresh_token: acc.refresh_token, environment: env }, t.patch);
          // Fixrunde 2 (Task 5) Minor 2: die Zeile hat sich seit dem Lesen geändert (z.B. frischer Rücksprung) --
          // unser `acc`/`api` ist jetzt stale. Sauber abbrechen, keine weiteren eBay-Aufrufe; der nächste Lauf
          // sieht die frische Zeile. Kein last_error/last_run_summary schreiben (würde die neue Verbindung stören).
          if (!ok) return { ok: true, busy: false, summary: s, text: summaryText(s) };
        }
        api = ebayApi(d.fetch, env, t.token);
      } catch (e) {
        if (!(e instanceof EbayError && e.auth)) throw e;
        connected = false;
        // eBays eigene Begründung (error_description, nie ein Token) zur Fehlersuche mitschreiben -- H3b2-Befund
        // 24.09.2026: die erste Token-Erneuerung in Produktion wurde abgelehnt, ohne dass sichtbar war, warum.
        authReason = e.message;
      }
    } else connected = false;
    if (!connected && acc.refresh_token) {
      const ok = await d.store.saveAccountIf(
        { refresh_token: acc.refresh_token, environment: env },
        { refresh_token: null, refresh_expires_at: null, access_token: null, access_expires_at: null },
      );
      // Fixrunde 2 (Task 5) Minor 2: ebenso hier -- die Zeile passt nicht mehr (z.B. inzwischen neu verbunden);
      // dann nicht fälschlich EXPIRED setzen, sondern sauber abbrechen und den nächsten Lauf entscheiden lassen.
      if (!ok) return { ok: true, busy: false, summary: s, text: summaryText(s) };
      lastError = authReason ? `${EXPIRED} (eBay: ${authReason})` : EXPIRED;
    } else if (!connected) {
      // Fixrunde 1 (Task 5) Important 2: ohne (neue) Verbindung bleibt ein zuvor gesetzter Hinweis stehen, statt
      // am Laufende auf null überschrieben zu werden -- sonst verschwindet EXPIRED nach dem ersten Folgelauf.
      lastError = acc.last_error;
    }
    const setupOk = connected && !!(acc.payment_policy_id && acc.fulfillment_policy_id && acc.return_policy_id && acc.location_key);
    const policies: Policies = acc;
    let feesError: string | null = null;

    // H3b2 Schritte 2/3: Bestellungen abholen und buchen, danach Gebühren nachtragen -- vor Schritt 4, damit ein gerade
    // gebuchter Verkauf (Angebot verkauft/Menge gesenkt, sold_seen erhöht) im selben Lauf auf eBay nachgezogen wird.
    if (connected && api) {
      if (tokenDue(acc.refresh_expires_at, now.getTime())) await d.store.addNotices([notices.token(acc.refresh_expires_at!)]);
      const over = () => d.now().getTime() >= deadline;
      await runOrders(api, d.store, env, acc, now, over, s);
      // Schritt 3 ist nie fatal: fehlen Finanzdaten (oder ist der apiz-Host der Sandbox anders), sollen Buchen und
      // Angebots-Abgleich trotzdem laufen. Nur eine abgelaufene Verbindung bricht ab (wie überall).
      try { await runFees(api, d.store, env, over, s); }
      catch (e) {
        if (e instanceof EbayError && e.auth) throw e;
        feesError = `Gebühren nicht lesbar: ${(e as Error).message}`;
      }
    }

    // Schritt 4: Angebote abgleichen.
    const rows = await d.store.openRows(retryId);
    const rowById = new Map(rows.map((r) => [r.listing_id, r]));
    const soll = await d.store.soll([...rowById.keys()]);
    const listingById = new Map(soll.listings.map((l) => [l.listing_id, l]));
    const ids = [...new Set([...listingById.keys(), ...rowById.keys()])].sort(cmp);
    // Abweichung 10: Merkmale je Kategorie (Einzelkarten 183454, Konvolute 183455), einmal je Durchgang.
    // Fixrunde 1 (Task 5) Important 3: ein vorübergehender (transient/auth) Fehler bricht wie bisher den ganzen
    // Durchgang ab (weitergereicht); ein dauerhafter Fehler (z.B. unbekannte Kategorie) wird je Kategorie gemerkt
    // und betrifft nur die Angebote dieser Kategorie -- als ListingProblem, also Einzelfehler wie ein abgelehntes
    // Veröffentlichen. Andere Kategorien und andere Aktionen (Zurückziehen, Warten, ...) laufen normal weiter.
    const aspectsByCategory = new Map<string, AspectDef[]>();
    const categoryErrors = new Map<string, string>();
    const loadAspects = async (categoryId: string): Promise<AspectDef[]> => {
      const hit = aspectsByCategory.get(categoryId);
      if (hit) return hit;
      const priorError = categoryErrors.get(categoryId);
      if (priorError) throw new ListingProblem(priorError);
      try {
        const aspects = await categoryAspects(d.fetch, env, await appToken(d.fetch, env, creds!), categoryId);
        aspectsByCategory.set(categoryId, aspects);
        return aspects;
      } catch (e) {
        if (e instanceof EbayError && (e.transient || e.auth)) throw e;
        const msg = `eBay-Merkmale nicht lesbar: ${(e as Error).message}`;
        categoryErrors.set(categoryId, msg);
        throw new ListingProblem(msg);
      }
    };
    let used = 0;
    for (const id of ids) {
      const listing = listingById.get(id) ?? null;
      const want = desired(listing, soll.items, soll.liveCopyIds);
      const photoUrls = ownPhotos(soll.photos, id).map((p) => photoUrl(d.store.photoBase, p.path));
      const hash = want.active ? await hashOf(buildListing(listing!, want.liveItems, photoUrls, [])) : null;
      const row = rowById.get(id) ?? null;
      const sameEnv = row && row.environment === env ? row : null;
      const action = decide({ active: want.active, hash, row, env, connected, setupOk, retry: id === retryId, nowMs: now.getTime() });
      if (action === "none") continue;
      if (used >= max || d.now().getTime() >= deadline) { s.deferred++; continue; }
      used++;
      const base = sameEnv ?? freshRow(id, env);
      try {
        if (action === "wait") {
          await d.store.saveRow({ ...freshRow(id, env), synced_at: nowIso });
          s.waiting++;
        } else if (action === "end_local") {
          await d.store.saveRow({ ...base, state: "beendet", error: null, synced_at: nowIso });
          s.withdrawn++;
        } else if (action === "withdraw") {
          const offer = await api!.getOffer(base.offer_id!);
          if (offer && !offerEnded(offer)) {
            try { await api!.withdrawOffer(offer.offerId); }
            catch (e) {
              // Fixrunde 2 (Task 5) Important 1: ein 400/403 usw. beim Zurückziehen heißt nicht automatisch, dass
              // die Anzeige schon beendet ist -- sie kann noch live sein (Doppelverkaufsrisiko, wenn wir sie
              // trotzdem als "beendet" verbuchen). Erst nachsehen: nur ein tatsächlich beendetes/verschwundenes
              // Angebot zählt als "schon zurückgezogen"; sonst der ursprüngliche Fehler als Einzelfehler, damit
              // der nächste Lauf das Zurückziehen erneut versucht (kein failed_hash-Blocker nötig: `hash` ist bei
              // inaktiven Angeboten ohnehin null, decide() prüft ihn für "withdraw" nicht).
              if (!(e instanceof EbayError) || e.transient || e.auth) throw e;
              const after = await api!.getOffer(offer.offerId);
              if (!offerEnded(after)) throw new ListingProblem((e as Error).message);
            }
          }
          await d.store.saveRow({ ...base, state: "beendet", published_qty: 0, error: null, synced_at: nowIso });
          s.withdrawn++;
        } else if (action === "check") {
          const offer = await api!.getOffer(base.offer_id!);
          // Abschluss-Fix A1: Verkauf zuerst, auch wenn die Anzeige inzwischen beendet ist.
          if ((offer?.listing?.soldQuantity ?? 0) > (base.sold_seen ?? 0)) throw new ListingProblem(SOLD_ON_EBAY);
          if (offerEnded(offer)) throw new ListingProblem(ENDED_ON_EBAY);
          await d.store.saveRow({ ...base, synced_at: nowIso });
          s.checked++;
        } else {
          const b = buildListing(listing!, want.liveItems, photoUrls, await loadAspects(categoryFor(want.liveItems)));
          if (b.problem) throw new ListingProblem(b.problem);
          const ack = id === retryId || base.state === "beendet";
          const r = action === "publish" || !base.offer_id ? await publish(api!, b, policies) : await revise(api!, b, policies, base, ack);
          await d.store.saveRow({
            ...base, state: "online", sku: b.sku, offer_id: r.offerId, item_id: r.listingId, item_url: itemUrl(env, r.listingId),
            published_qty: b.quantity, synced_hash: hash, failed_hash: null, sold_seen: r.sold, error: null, synced_at: nowIso,
          });
          if (action === "publish") s.published++; else s.revised++;
        }
      } catch (e) {
        // Verbindung/Netz: ganzer Durchgang bricht ab (der nächste versucht es erneut). Sonst nur dieses Angebot.
        if (e instanceof EbayError && (e.transient || e.auth)) throw e;
        await d.store.saveRow({ ...base, state: "fehler", error: (e as Error).message, failed_hash: hash, synced_at: nowIso });
        s.errors++;
      }
    }
    // Schritt 5: Stand schreiben.
    const text = summaryText(s);
    await d.store.saveAccount({ last_run_at: nowIso, last_run_summary: text, last_error: lastError ?? feesError });
    return { ok: true, busy: false, summary: s, text };
  } catch (e) {
    const msg = e instanceof EbayError && e.auth ? EXPIRED : (e as Error).message;
    if (locked) {
      try {
        const patch: { last_run_at: string; last_error?: string } = { last_run_at: nowIso };
        // Fixrunde 2 (Task 5) Minor 3: ohne Verbindung bleibt ein stehender Hinweis (z.B. EXPIRED) bestehen --
        // ein unabhängiger Fehler dieses Laufs (z.B. Store weg) soll ihn nicht überschreiben. Nur setzen, wenn
        // wir zu Laufbeginn verbunden waren, oder bisher noch gar kein Hinweis stand.
        if (connectedSnapshot || !priorLastError) patch.last_error = msg;
        await d.store.saveAccount(patch);
      } catch (e2) { console.error("[ebay-sync] Stand nicht gespeichert:", (e2 as Error).message); }
    }
    return { ok: false, error: msg };
  } finally {
    if (locked) await d.store.unlock(d.holder);
  }
}
