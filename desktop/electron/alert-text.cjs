// Spec G2 §8 — Treffertexte der Preis-Alarme (Windows-Benachrichtigung und Desktop-Liste).
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/AlertText.kt. Beide laufen gegen
// docs/fixtures/portfolio/alert-texts.json. Wer eine Seite aendert, aendert beide.
const MINUS = '−';

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// "1.234,50 €" — in ganzen Cent gerechnet, damit Kotlin und JS gleich runden.
function eur(value) {
  const v = Number(value);
  const cents = Math.round(Math.abs(v) * 100);
  const int = String(Math.floor(cents / 100));
  const frac = String(cents % 100).padStart(2, '0');
  return `${v < 0 && cents > 0 ? MINUS : ''}${group(int)},${frac} €`;
}

// "+20,0 %" / "−25,0 %" — in Zehntelprozent gerechnet.
function signedPct(value) {
  const v = Number(value);
  const tenths = Math.round(Math.abs(v) * 10);
  return `${v < 0 ? MINUS : '+'}${Math.floor(tenths / 10)},${tenths % 10} %`;
}

// Gespeichertes "Unknown" oder leer erscheint als "Unbekannt" (Spec G1 §4.12).
const label = (v) => (v && String(v).trim() && v !== 'Unknown' ? v : 'Unbekannt');

function alertText(e) {
  const head = `${e.name || e.card_id} · ${label(e.set_code)} · ${label(e.rarity)}`;
  if (e.kind === 'move') {
    const old = e.old_price == null ? '—' : eur(e.old_price);
    return `${head}: ${signedPct(e.pct ?? 0)} in ${e.days} Tagen (${old} → ${eur(e.new_price)})`;
  }
  const op = e.kind === 'above' ? '≥' : '≤';
  return `${head}: Zielpreis ${op} ${eur(e.threshold ?? 0)} erreicht (${eur(e.new_price)})`;
}

module.exports = { alertText, eur, signedPct };
