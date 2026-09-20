// Passcodes sind achtstellig und werden MIT fuehrenden Nullen gedruckt (z. B. 02463794), intern aber
// als Zahl gefuehrt (YGOPRODeck `id`). Die Sammlung speichert deshalb "2463794" -- Anzeige und Suche
// gingen dadurch auseinander: der Nutzer sucht nach dem, was auf der Karte steht, und fand nichts
// (19.09.2026). Diese drei Funktionen sind die eine Stelle, an der das zusammengefuehrt wird.

/** Nur Ziffern, ohne fuehrende Nullen -- die Form, in der die Datenbank Passcodes fuehrt. */
export function normPasscode(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const trimmed = digits.replace(/^0+/, '');
  return trimmed || '0';
}

/** Anzeigeform: achtstellig mit fuehrenden Nullen (laengere Codes bleiben unveraendert). */
export function formatPasscode(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 8 ? digits.replace(/^0+(?=\d{8,})/, '') : digits.padStart(8, '0');
}

/** Sucht der Nutzer nach einem (Teil-)Passcode: vergleicht ohne fuehrende Nullen UND achtstellig. */
export function passcodeMatches(query, id) {
  const q = String(query ?? '').replace(/\D/g, '');
  if (!q) return false;
  const norm = normPasscode(id);
  if (!norm) return false;
  return norm.includes(normPasscode(q)) || formatPasscode(id).includes(q);
}
