import assert from 'node:assert';
import { NAV, T } from './i18n-de.js';

assert.deepStrictEqual(NAV.map(n => n.key), ['start', 'scannen', 'sammlung', 'deals', 'insights']);
assert.deepStrictEqual(NAV.map(n => n.to), ['/start', '/scannen', '/sammlung/karten', '/deals', '/insights']);
assert.deepStrictEqual(NAV.map(n => n.label), ['Start', 'Scannen', 'Sammlung', 'Deals', 'Insights']);

for (const k of ['start', 'scannen', 'sammlung', 'karten', 'wunschliste', 'sets', 'decks', 'deals',
                 'insights', 'einstellungen', 'uebernehmen', 'pruefen', 'abbrechen', 'zurueck',
                 'suchen', 'keineTreffer', 'exemplar', 'exemplare']) {
  assert.ok(typeof T[k] === 'string' && T[k].length > 0, `missing vocabulary key: ${k}`);
}
// The renamed terms must be gone from the shared table.
const forbidden = /\b(Collection|Settings|Wishlist|Submit|Cancel|Commit|Staging|Home)\b/;
for (const [k, v] of Object.entries(T)) assert.ok(!forbidden.test(v), `English leftover in T.${k}: ${v}`);
console.log('i18n-de test: PASS');
