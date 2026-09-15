// Spec G2 §7/§9 — Eingabepruefung der Preis-Alarme (deutsches Komma, kein Tausenderpunkt).
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/AlertInput.kt. Beide laufen gegen
// docs/fixtures/portfolio/alert-input.json. Wer eine Seite aendert, aendert beide.
const EURO = /^\d+([.,]\d{1,2})?$/;
const PCT = /^\d+([.,]\d)?$/;
const num = (t) => Number(t.replace(',', '.'));
const clean = (text) => String(text ?? '').trim();

// Zielpreis: leer heisst entfernen ({ value: null, error: null }).
export function parseTarget(text) {
  const t = clean(text);
  if (t === '') return { value: null, error: null };
  if (!EURO.test(t)) return { value: null, error: 'Ungültiger Betrag' };
  const v = num(t);
  return v > 0 ? { value: v, error: null } : { value: null, error: 'Betrag muss größer als 0 sein' };
}

export function parsePct(text) {
  const t = clean(text);
  if (!PCT.test(t)) return { value: null, error: 'Ungültige Zahl' };
  const v = num(t);
  return v >= 1 && v <= 500 ? { value: v, error: null } : { value: null, error: 'Prozent zwischen 1 und 500' };
}

export function parseMinEur(text) {
  const t = clean(text);
  if (!EURO.test(t)) return { value: null, error: 'Ungültiger Betrag' };
  return { value: num(t), error: null };
}

// Gespeicherter Betrag im Eingabefeld: 12.5 -> "12,5", 2 -> "2", null -> "".
export const toInput = (v) => (v == null ? '' : String(Number(v)).replace('.', ','));
