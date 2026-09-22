// desktop/src/utils/ebayMarks.js
// Spec H3b §4.4/§5.4 -- eBay-Marken und Einrichtungs-Check-Liste für die Anzeige. ZWILLING:
// android/app/src/main/java/com/example/yugiohscanner/ml/EbayMarks.kt. Gemeinsame Fixture: docs/fixtures/ebay/marks.json.
// Wer eine Fassung ändert, ändert beide. status: undefined = lädt, null = kein Stand (Tabellen fehlen/nie verbunden).

export const MAX_OWN_PHOTOS = 12;
const WAITING = { kind: 'wartet', text: 'wartet auf eBay', url: null, retry: false };

const isActive = (l) => l.status === 'aktiv' && !l.deleted;
const webUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim() : null);

export function ebayMark(listing, row, status) {
  if (!listing || listing.channel_id !== 'ebay') return null;
  if (status === undefined) return { kind: 'laden', text: '…', url: null, retry: false };
  const active = isActive(listing);
  if (!status || !row) return active ? WAITING : null;
  if (row.environment !== status.environment) {
    return active ? WAITING : { kind: 'andere', text: 'auf eBay beendet (andere Umgebung)', url: null, retry: false };
  }
  if (row.state === 'online') return { kind: 'online', text: 'auf eBay online', url: webUrl(row.item_url), retry: false };
  if (row.state === 'fehler') {
    return { kind: 'fehler', text: `eBay-Fehler: ${row.error || 'unbekannt'}`, url: webUrl(row.item_url), retry: active };
  }
  if (row.state === 'beendet') return { kind: 'beendet', text: 'auf eBay beendet', url: null, retry: false };
  return active ? WAITING : null;
}

export function setupItems(status) {
  const s = status || {};
  const named = (label, ok, name) => ({ label: ok && name ? `${label}: ${name}` : label, ok: !!ok });
  return [
    { label: 'Mit eBay verbunden', ok: !!s.connected },
    named('Zahlungsrichtlinie', s.has_payment_policy, s.payment_policy_name),
    named('Versandrichtlinie', s.has_fulfillment_policy, s.fulfillment_policy_name),
    named('Rücknahmerichtlinie', s.has_return_policy, s.return_policy_name),
    named('Artikelstandort', s.has_location, s.location_key),
  ];
}
export const setupOk = (status) => setupItems(status).every((i) => i.ok);

// Spec §4.3: 30 Tage vor Ablauf des Refresh-Tokens ein Hinweis. today = 'YYYY-MM-DD' (lokal).
export function expiryText(status, today) {
  if (!status || !status.connected || !status.refresh_expires_at) return null;
  const day = String(status.refresh_expires_at).slice(0, 10);
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const days = Math.round((utc(day) - utc(today)) / 86400000);
  if (days > 30) return null;
  return `Verbindung läuft am ${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)} ab – bitte neu verbinden.`;
}

export const photoCountText = (n) => `${n}/${MAX_OWN_PHOTOS} Fotos`;
