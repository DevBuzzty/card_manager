// supabase/functions/_shared/ebay-plan.ts
// Spec H3b §5.3/§8/§9 -- reine Entscheidung je Angebot: was der Abgleicher tun muss (Soll/Ist). Keine Aufrufe.
// Tests: ebay-plan_test.ts gegen docs/fixtures/ebay/plan.json.

export type RowState = "wartet" | "online" | "fehler" | "beendet";
export type EbayRow = {
  listing_id: string; environment: string; state: RowState; sku: string | null; offer_id: string | null;
  item_id: string | null; item_url: string | null; published_qty: number | null; synced_hash: string | null;
  failed_hash: string | null; sold_seen: number | null; error: string | null; synced_at: string | null;
};
export type Action = "none" | "wait" | "end_local" | "publish" | "revise" | "withdraw" | "check";

// Stichprobe (Spec §5.3 „manuell auf eBay beendet“): eine unveränderte Online-Anzeige wird höchstens stündlich gelesen.
export const CHECK_EVERY_MS = 60 * 60 * 1000;

export type DecideInput = {
  active: boolean; hash: string | null; row: EbayRow | null; env: string;
  connected: boolean; setupOk: boolean; retry: boolean; nowMs: number;
};

export function decide(x: DecideInput): Action {
  // Spec §5.3 Umgebung: eine Zeile aus der anderen Umgebung wird nie angefasst; sie gilt als „beendet (andere Umgebung)“.
  const r = x.row && x.row.environment === x.env ? x.row : null;
  if (!x.active) {
    if (!r || r.state === "beendet") return "none";
    // Zurückziehen braucht die Verbindung; bis dahin bleibt die Zeile, wie sie ist (nächster Lauf nach dem Verbinden).
    return r.offer_id ? (x.connected ? "withdraw" : "none") : "end_local";
  }
  // Spec §4.4/§9: ohne Verbindung oder Einrichtung bleiben Angebote „wartet“; eine vorhandene Zeile (gleich welchen
  // Zustands, auch fehler/beendet) bleibt unberührt, bis wieder verbunden ist -- dann greift die normale Logik.
  if (!x.connected || !x.setupOk) {
    return r ? "none" : "wait";
  }
  if (!r || !r.offer_id) {
    if (r && r.state === "fehler" && r.failed_hash === x.hash && !x.retry) return "none";
    return "publish";
  }
  // Ein Fehler wird nur nach „Erneut versuchen“ oder nach einer Änderung (neue Prüfsumme) wiederholt.
  if (r.state === "fehler") return r.failed_hash === x.hash && !x.retry ? "none" : "revise";
  if (r.state !== "online" || r.synced_hash !== x.hash || x.retry) return "revise";
  const last = r.synced_at ? Date.parse(r.synced_at) : NaN;
  return !Number.isFinite(last) || x.nowMs - last >= CHECK_EVERY_MS ? "check" : "none";
}

// Anzeige auf eBay gilt als lebend bei ACTIVE oder OUT_OF_STOCK (Befund eBay-Doku 8); alles andere = beendet.
export function offerEnded(o: { status?: string; listing?: { listingStatus?: string } } | null): boolean {
  if (!o || o.status !== "PUBLISHED") return true;
  const s = o.listing?.listingStatus;
  return s !== "ACTIVE" && s !== "OUT_OF_STOCK";
}

export const ENDED_ON_EBAY = "auf eBay beendet – in der App beenden oder erneut einstellen";
export const SOLD_ON_EBAY = "Auf eBay verkauft – bitte den Verkauf in der App buchen, danach „Erneut versuchen“.";
export const EXPIRED = "Verbindung abgelaufen – bitte neu verbinden";

export type Summary = { published: number; revised: number; withdrawn: number; waiting: number; checked: number; errors: number; deferred: number };
export const emptySummary = (): Summary => ({ published: 0, revised: 0, withdrawn: 0, waiting: 0, checked: 0, errors: 0, deferred: 0 });
export function summaryText(s: Summary): string {
  const parts = [`${s.published} eingestellt`, `${s.revised} geändert`, `${s.withdrawn} beendet`, `${s.errors} Fehler`];
  if (s.waiting > 0) parts.push(`${s.waiting} wartet`);
  if (s.deferred > 0) parts.push(`${s.deferred} im nächsten Lauf`);
  return parts.join(" · ");
}
