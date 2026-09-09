// Spec B1: Tags eines Exemplars. Die Spalte card_copies.tags ist Text und traegt ein JSON-Array.
//
// Die Kotlin-Fassung derselben Regeln steht in
// android/app/src/main/java/com/example/yugiohscanner/ml/Tags.kt.
// Dass es sie zweimal gibt, ist Absicht -- beide Geraete lesen und schreiben dieselbe Spalte.
// Wer hier etwas aendert, aendert dort mit, sonst entstehen Eintraege, die die andere Seite
// nicht wiederfindet.
//
// Nie werfen: der Inhalt der Spalte stammt aus der Cloud und kann alles sein. Eine kaputte
// Zelle darf hoechstens "keine Tags" bedeuten, niemals eine leere Kartenansicht.

const norm = (t) => String(t).trim();
const key = (t) => norm(t).toLowerCase();

export function parseTags(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = norm(item);
    if (!t || seen.has(key(t))) continue;
    seen.add(key(t));
    out.push(t);
  }
  return out;
}

export function serializeTags(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return JSON.stringify(list);
}

export function addTag(list, tag) {
  const cur = Array.isArray(list) ? list : [];
  const t = norm(tag ?? '');
  if (!t || cur.some(x => key(x) === key(t))) return cur;
  return [...cur, t];
}

export function removeTag(list, tag) {
  const cur = Array.isArray(list) ? list : [];
  const k = key(tag ?? '');
  return cur.filter(x => key(x) !== k);
}
