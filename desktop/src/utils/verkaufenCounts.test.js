import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verkaufenCounts, SALES_DEFAULT_PERIOD } from './verkaufenCounts.js';
import { VERKAUFEN_SEGMENTS } from './i18n-de.js';

test('verkaufenCounts: eine Zahl je Station, Schluessel wie die Reiter', () => {
  const c = verkaufenCounts({
    duplicateGroups: [{}, {}, {}],
    // Restrunde 2: vorgemerkt zaehlt auch, wenn das Exemplar in einem aktiven Angebot steckt;
    // geloeschte und nicht vorgemerkte zaehlen nicht (wie forSaleSummary / Kopfzeile der Liste).
    saleCopies: [{ for_sale: 1 }, { for_sale: 1, in_listing: true }, { for_sale: 0 }, { for_sale: 1, deleted: 1 }],
    nav: { unknown: 9, forSale: 1, listingsOpen: 2 },
    // Liste im Standard-Zeitraum, Stornos eingeschlossen -- die Zahl ist ihre Laenge.
    salesInDefaultPeriod: [{ status: 'aktiv' }, { status: 'storniert' }, { status: 'aktiv' }],
  });
  assert.deepEqual(c, { kandidaten: 3, 'zum-verkauf': 2, angebote: 2, verkaeufe: 3 });
  assert.deepEqual(Object.keys(c).sort(), VERKAUFEN_SEGMENTS.map((s) => s.id).sort());
});

test('verkaufenCounts: solange eine Quelle laedt, steht dort null statt 0', () => {
  assert.deepEqual(verkaufenCounts({ duplicateGroups: null, saleCopies: null, nav: null, salesInDefaultPeriod: null }),
    { kandidaten: null, 'zum-verkauf': null, angebote: null, verkaeufe: null });
  assert.deepEqual(verkaufenCounts({ duplicateGroups: [], saleCopies: [], nav: { forSale: 0, listingsOpen: 0 }, salesInDefaultPeriod: [] }),
    { kandidaten: 0, 'zum-verkauf': 0, angebote: 0, verkaeufe: 0 });
});

test('Standard-Zeitraum der Reiterzahl ist der Standard-Zeitraum der Verkaufsliste', () => {
  const panel = readFileSync(new URL('../components/SalesPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, new RegExp(`useState\\('${SALES_DEFAULT_PERIOD}'\\)`));
});
