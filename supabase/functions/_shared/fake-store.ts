// supabase/functions/_shared/fake-store.ts -- NUR für Tests: Store im Speicher, Sperre wie ebay_try_lock.
import type { Photo, SollItem, SollListing } from "./ebay-map.ts";
import type { EbayRow } from "./ebay-plan.ts";
import type { Account, Store } from "./ebay-store.ts";

export function account(patch: Partial<Account> = {}): Account {
  return {
    environment: "sandbox", marketplace: "EBAY_DE", refresh_token: "RT", refresh_expires_at: "2028-01-01T00:00:00Z",
    access_token: "AT", access_expires_at: "2026-09-22T14:00:00Z", oauth_state: null, oauth_state_expires_at: null,
    payment_policy_id: "PAY1", payment_policy_name: "Zahlung", fulfillment_policy_id: "FUL1", fulfillment_policy_name: "Versand",
    return_policy_id: "RET1", return_policy_name: "Keine Rücknahme", location_key: "ygo-default",
    last_run_at: null, last_run_summary: null, last_error: null, connected_at: "2026-09-01T00:00:00Z", ...patch,
  };
}

export function fakeStore(init: {
  account?: Account; listings?: SollListing[]; items?: SollItem[]; live?: string[]; photos?: Photo[]; rows?: EbayRow[];
}) {
  const state = {
    account: init.account ?? account(),
    listings: init.listings ?? [], items: init.items ?? [], live: new Set(init.live ?? []), photos: init.photos ?? [],
    rows: new Map((init.rows ?? []).map((r) => [r.listing_id, r])),
    lockHolder: null as string | null, unlocked: 0,
  };
  const store: Store = {
    photoBase: "https://proj.supabase.co",
    account: () => Promise.resolve({ ...state.account }),
    saveAccount: (p) => { state.account = { ...state.account, ...p }; return Promise.resolve(); },
    tryLock: (h) => { if (state.lockHolder) return Promise.resolve(false); state.lockHolder = h; return Promise.resolve(true); },
    unlock: (h) => { if (state.lockHolder === h) state.lockHolder = null; state.unlocked++; return Promise.resolve(); },
    openRows: (extra) => Promise.resolve([...state.rows.values()].filter((r) => r.state !== "beendet" || r.listing_id === extra)),
    soll: (ids) => Promise.resolve({
      listings: state.listings.filter((l) => (l.channel_id === "ebay" && l.status === "aktiv" && !l.deleted) || ids.includes(l.listing_id)),
      items: state.items.filter((i) => !i.deleted), liveCopyIds: state.live, photos: state.photos.filter((p) => !p.deleted),
    }),
    saveRow: (r) => { state.rows.set(r.listing_id, { ...r }); return Promise.resolve(); },
    liveOfferCount: (env) => Promise.resolve([...state.rows.values()]
      .filter((r) => r.environment === env && (r.state === "online" || r.state === "fehler") && r.offer_id).length),
  };
  return { store, state };
}
