// Spec G3 §6 — Wert, Veraltung, Art-Bezeichnung und Listenreihenfolge des Sealed-Bestands.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/SealedValue.kt. Beide laufen gegen
// docs/fixtures/portfolio/sealed-value.json (sealed-value.test.cjs bzw. SealedValueTest.kt).
// Wer eine Seite aendert, aendert beide. Gerundet wird nur in der Anzeige.
const DAY_MS = 86400000;
const STALE_DAYS = 30;
const ZONE = /(Z|[+-]\d{2}:\d{2})$/;

// Reihenfolge = Reihenfolge der Schluessel; die Schluessel sind die Werte der Spalte sealed_items.kind.
const KIND_LABELS = {
  display: 'Display',
  booster: 'Booster',
  tin: 'Tin',
  deck: 'Deck',
  special: 'Special Edition',
  other: 'Sonstiges',
};
const SEALED_KINDS = Object.keys(KIND_LABELS);

const kindLabel = (kind) => (kind != null && Object.hasOwn(KIND_LABELS, kind) ? KIND_LABELS[kind] : 'Sonstiges');

const lineValue = (item) => (item.price == null ? null : Number(item.quantity) * Number(item.price));

// Summe quantity × price ueber lebende Zeilen mit Preis. deleted ist lokal 0/1, in der Cloud Boolean.
function sealedValue(items) {
  let sum = 0;
  for (const item of items || []) {
    if (item.deleted || item.price == null) continue;
    sum += Number(item.quantity) * Number(item.price);
  }
  return sum;
}

// Liest lokal "2026-09-15 05:00:03" (naive UTC) und Cloud "2026-09-15T05:00:03.123456+00:00".
// Nachkommastellen werden auf Millisekunden gekuerzt bzw. aufgefuellt, wie toEpochMilli() in Kotlin.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/SealedValue.kt.
const VALID_TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
function toUtcMillis(ts) {
  if (ts == null || String(ts).trim() === '') return null;
  let s = String(ts).trim();
  if (!VALID_TS.test(s)) return null;
  s = s.replace(' ', 'T').replace(/\.(\d+)/, (m, d) => `.${(d + '00').slice(0, 3)}`);
  if (!ZONE.test(s)) s += 'Z';
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

// "aelter als 30 Tage": genau 30 Tage ist noch nicht veraltet.
function isPriceStale(priceUpdatedAt, nowMs) {
  const t = toUtcMillis(priceUpdatedAt);
  return t != null && nowMs - t > STALE_DAYS * DAY_MS;
}

const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// Zeilensumme absteigend, Zeilen ohne Preis ans Ende, dann Name, dann sealed_id. Neue Liste.
function sortSealed(items) {
  return [...(items || [])].sort((a, b) => {
    const va = lineValue(a);
    const vb = lineValue(b);
    if (va != null && vb == null) return -1;
    if (va == null && vb != null) return 1;
    if (va != null && vb != null && va !== vb) return vb - va;
    return cmp(a.name, b.name) || cmp(a.sealed_id, b.sealed_id);
  });
}

module.exports = { SEALED_KINDS, KIND_LABELS, kindLabel, lineValue, sealedValue, toUtcMillis, isPriceStale, sortSealed };
