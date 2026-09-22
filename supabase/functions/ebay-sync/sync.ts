// supabase/functions/ebay-sync/sync.ts
// Spec H3b §8 -- ein Durchgang des Abgleichers, H3b1: Schritt 1 (Token), 4 (Angebote abgleichen, höchstens 50),
// 5 (Stand schreiben). Nur ein Durchgang gleichzeitig (Sperre in ebay_account, Abweichung 2). Einzelne Ablehnungen
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

export const LOCK_SECONDS = 300;
export const MAX_PER_RUN = 50;

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
  if (ended && !ack) throw new ListingProblem(ENDED_ON_EBAY);
  if (!ended && sold > (row.sold_seen ?? 0) && !ack) throw new ListingProblem(SOLD_ON_EBAY);
  await api.putInventoryItem(b.sku, inventoryItemBody(b));
  await api.updateOffer(offer.offerId, offerBody(b, p));
  if (ended) return { offerId: offer.offerId, listingId: await api.publishOffer(offer.offerId), sold: 0 };
  return { offerId: offer.offerId, listingId: String(offer.listing?.listingId), sold };
}

export async function runSync(d: SyncDeps, opts: { retry?: string | null; max?: number } = {}): Promise<SyncResult> {
  const retryId = opts.retry ?? null;
  const max = opts.max ?? MAX_PER_RUN;
  if (!(await d.store.tryLock(d.holder, LOCK_SECONDS))) return { ok: true, busy: true, text: "läuft schon" };
  const now = d.now();
  const nowIso = now.toISOString();
  const s = emptySummary();
  try {
    const acc = await d.store.account();
    const env = acc.environment as Env;
    let lastError: string | null = null;
    let api: EbayApi | null = null;
    let connected = !!acc.refresh_token;
    const expired = !!acc.refresh_expires_at && Date.parse(acc.refresh_expires_at) <= now.getTime();
    const creds = connected ? credsFor(env, d.env) : null;
    // Schritt 1: Token erneuern. Abgelehnt (invalid_grant) oder abgelaufen -> trennen, Angebote bleiben „wartet“.
    if (connected && !expired) {
      try {
        const t = await ensureAccess(d.fetch, env, creds!, acc, now);
        if (t.patch) await d.store.saveAccount(t.patch);
        api = ebayApi(d.fetch, env, t.token);
      } catch (e) {
        if (!(e instanceof EbayError && e.auth)) throw e;
        connected = false;
      }
    } else connected = false;
    if (!connected && acc.refresh_token) {
      await d.store.saveAccount({ refresh_token: null, refresh_expires_at: null, access_token: null, access_expires_at: null });
      lastError = EXPIRED;
    }
    const setupOk = connected && !!(acc.payment_policy_id && acc.fulfillment_policy_id && acc.return_policy_id && acc.location_key);
    const policies: Policies = acc;

    // Schritt 4: Angebote abgleichen.
    const rows = await d.store.openRows(retryId);
    const rowById = new Map(rows.map((r) => [r.listing_id, r]));
    const soll = await d.store.soll([...rowById.keys()]);
    const listingById = new Map(soll.listings.map((l) => [l.listing_id, l]));
    const ids = [...new Set([...listingById.keys(), ...rowById.keys()])].sort(cmp);
    // Abweichung 10: Merkmale je Kategorie (Einzelkarten 183454, Konvolute 183455), einmal je Durchgang.
    const aspectsByCategory = new Map<string, AspectDef[]>();
    const loadAspects = async (categoryId: string) => {
      const hit = aspectsByCategory.get(categoryId);
      if (hit) return hit;
      let aspects: AspectDef[];
      try { aspects = await categoryAspects(d.fetch, env, await appToken(d.fetch, env, creds!), categoryId); }
      catch (e) {
        // Ohne Merkmale scheitert jedes Einstellen gleich -> Durchgang abbrechen statt 50 gleiche Fehler.
        throw new EbayError(`eBay-Merkmale nicht lesbar: ${(e as Error).message}`, (e as EbayError).status ?? 0, true, false);
      }
      aspectsByCategory.set(categoryId, aspects);
      return aspects;
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
      if (used >= max) { s.deferred++; continue; }
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
          if (offer && offer.status === "PUBLISHED") await api!.withdrawOffer(offer.offerId);
          await d.store.saveRow({ ...base, state: "beendet", published_qty: 0, error: null, synced_at: nowIso });
          s.withdrawn++;
        } else if (action === "check") {
          const offer = await api!.getOffer(base.offer_id!);
          if (offerEnded(offer)) throw new ListingProblem(ENDED_ON_EBAY);
          if ((offer!.listing?.soldQuantity ?? 0) > (base.sold_seen ?? 0)) throw new ListingProblem(SOLD_ON_EBAY);
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
    await d.store.saveAccount({ last_run_at: nowIso, last_run_summary: text, last_error: lastError });
    return { ok: true, busy: false, summary: s, text };
  } catch (e) {
    const msg = e instanceof EbayError && e.auth ? EXPIRED : (e as Error).message;
    try { await d.store.saveAccount({ last_run_at: nowIso, last_error: msg }); }
    catch (e2) { console.error("[ebay-sync] Stand nicht gespeichert:", (e2 as Error).message); }
    return { ok: false, error: msg };
  } finally {
    await d.store.unlock(d.holder);
  }
}
