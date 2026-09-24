import assert from 'node:assert';
import { NAV_GROUPS, T } from './i18n-de.js';

// NAV wurde durch NAV_GROUPS ersetzt (Spec I §3) -- die Gruppen flach betrachtet ergeben
// dieselbe Reihenfolge wie zuvor die einzelne Liste, jetzt inklusive Decks, Verkaufen und
// Einstellungen (die vorher separat gerendert wurden).
const flat = NAV_GROUPS.flatMap(g => g.items);
assert.deepStrictEqual(flat.map(n => n.key), ['start', 'scannen', 'sammlung', 'decks', 'verkaufen', 'deals', 'insights', 'einstellungen']);
assert.deepStrictEqual(flat.map(n => n.to), ['/start', '/scannen', '/sammlung/karten', '/decks', '/verkaufen/kandidaten', '/deals', '/insights', '/einstellungen']);
assert.deepStrictEqual(flat.map(n => n.label), ['Start', 'Scannen', 'Sammlung', 'Decks', 'Verkaufen', 'Deals', 'Insights', 'Einstellungen']);

for (const k of ['start', 'scannen', 'sammlung', 'karten', 'wunschliste', 'sets', 'decks', 'sealed', 'deals',
                 'insights', 'einstellungen', 'uebernehmen', 'pruefen', 'abbrechen', 'zurueck',
                 'suchen', 'keineTreffer', 'exemplar', 'exemplare']) {
  assert.ok(typeof T[k] === 'string' && T[k].length > 0, `missing vocabulary key: ${k}`);
}
// The renamed terms must be gone from the shared table.
const forbidden = /\b(Collection|Settings|Wishlist|Submit|Cancel|Commit|Staging|Home)\b/;
for (const [k, v] of Object.entries(T)) assert.ok(!forbidden.test(v), `English leftover in T.${k}: ${v}`);
console.log('i18n-de test: PASS');
