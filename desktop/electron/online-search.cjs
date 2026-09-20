// Die Handsuche im Scanner-Tab als reine Funktion -- damit ihre Faelle pruefbar sind statt in einem
// ipcMain-Handler zu verschwinden.
//
// ECHTE FALLE: YGOPRODecks deutsche Datenbank ist LUECKENHAFT. "Solfachord Happiness" (93481594) steht
// nur in der englischen. Eine einzelne fehlende id beantwortet die API mit HTTP 400, bei mehreren ids
// laesst sie die fehlenden still weg (HTTP 200, kuerzere Liste). Ohne Rueckfall auf die englische
// Abfrage findet der Nutzer solche Karten ueberhaupt nicht (Nutzer 20.09.2026).
const BASE = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';

// Karten zu Passcodes: erst deutsch (wegen der deutschen Namen), die dabei fehlenden danach englisch.
async function fetchByIds(fetchCards, ids) {
  if (ids.length === 0) return [];
  const de = await fetchCards(`${BASE}?id=${encodeURIComponent(ids.join(','))}&language=de`);
  const missing = ids.filter(id => !de.some(c => String(c.id) === id));
  if (missing.length === 0) return de;
  const en = await fetchCards(`${BASE}?id=${encodeURIComponent(missing.join(','))}`);
  return [...de, ...en];
}

// query: die Eingabe des Nutzers. catalogIds: Passcodes aus der Namenssuche im Offline-Katalog (dritte
// Quelle; faengt die deutschen Namen, die YGOPRODecks fname-Suche mit language=de auslaesst).
// fetchCards(url) liefert das data-Feld der Antwort, [] bei jedem Fehler.
async function onlineSearch(fetchCards, query, catalogIds = []) {
  const q = String(query || '').trim();
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    // Gedruckt wird achtstellig mit fuehrenden Nullen (02463794), gefuehrt wird ohne sie.
    return await fetchByIds(fetchCards, [q.replace(/^0+/, '') || '0']);
  }
  const [de, en] = await Promise.all([
    fetchCards(`${BASE}?fname=${encodeURIComponent(q)}&language=de`),
    fetchCards(`${BASE}?fname=${encodeURIComponent(q)}`),
  ]);
  const known = (id) => de.some(c => String(c.id) === id) || en.some(c => String(c.id) === id);
  const fromCatalog = await fetchByIds(fetchCards, catalogIds.filter(id => !known(id)));
  const seen = new Set();
  const out = [];
  for (const c of [...de, ...fromCatalog, ...en]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

module.exports = { BASE, fetchByIds, onlineSearch };
