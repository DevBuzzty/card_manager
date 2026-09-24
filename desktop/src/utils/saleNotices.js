// Spec H3b §7.6 (H3b2) -- eBay-Hinweise (sale_notices) und Marke „Gebühren vorläufig“ (ebay_orders), ohne React.
// ZWILLING: android .../ml/SaleNotices.kt. Gemeinsame Fixture: docs/fixtures/ebay/notices.json. Wer eine Fassung ändert,
// ändert beide. Sortierung per Codeeinheiten (kein localeCompare).

const LABELS = {
  shipping: { label: 'Versand', tone: 'warn' },
  error: { label: 'Problem', tone: 'bad' },
  reminder: { label: 'Erinnerung', tone: 'neutral' },
  token: { label: 'eBay-Verbindung', tone: 'bad' },
};
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Offene Hinweise, neueste zuerst; gleiche Zeit nach notice_id. dismissed kommt lokal als 0/1, aus der Cloud als true/false.
export function sortNotices(list) {
  return (list || []).filter((n) => !n.dismissed)
    .sort((a, b) => cmp(b.created_at ?? '', a.created_at ?? '') || cmp(a.notice_id, b.notice_id));
}

export function noticeLabel(kind) {
  return LABELS[kind] ?? { label: 'Hinweis', tone: 'neutral' };
}

// orders: sale_id -> { status, fees_final } (IPC ebay-orders).
export function feesMark(orders, saleId) {
  const o = orders?.[saleId];
  return o && o.status === 'gebucht' && !o.fees_final ? 'Gebühren vorläufig' : null;
}

export function noticesTitle(count) {
  return `eBay-Hinweise (${count})`;
}
