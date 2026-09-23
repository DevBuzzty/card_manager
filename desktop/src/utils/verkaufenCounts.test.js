import test from 'node:test';
import assert from 'node:assert/strict';
import { verkaufenCounts } from './verkaufenCounts.js';
import { VERKAUFEN_SEGMENTS } from './i18n-de.js';

test('verkaufenCounts: eine Zahl je Station, Schluessel wie die Reiter', () => {
  const c = verkaufenCounts({
    duplicateGroups: [{}, {}, {}],
    nav: { unknown: 9, forSale: 4, listingsOpen: 2 },
    sales: [{ status: 'aktiv' }, { status: 'storniert' }, { status: 'aktiv' }, { status: 'aktiv', deleted: 1 }],
  });
  assert.deepEqual(c, { kandidaten: 3, 'zum-verkauf': 4, angebote: 2, verkaeufe: 2 });
  assert.deepEqual(Object.keys(c).sort(), VERKAUFEN_SEGMENTS.map((s) => s.id).sort());
});

test('verkaufenCounts: solange eine Quelle laedt, steht dort null statt 0', () => {
  assert.deepEqual(verkaufenCounts({ duplicateGroups: null, nav: null, sales: null }),
    { kandidaten: null, 'zum-verkauf': null, angebote: null, verkaeufe: null });
  assert.deepEqual(verkaufenCounts({ duplicateGroups: [], nav: { forSale: 0, listingsOpen: 0 }, sales: [] }),
    { kandidaten: 0, 'zum-verkauf': 0, angebote: 0, verkaeufe: 0 });
});
