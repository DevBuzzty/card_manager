const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveCarddexRows, printingKey, slotKey, previewHeaderText, replaceWarningText, importResultText,
} = require('./carddex-resolve.cjs');

// Eine gelesene Zeile wie readCarddex sie liefert (alles Text, tags als Liste).
const row = (over = {}) => ({
  line: 2, passcode: '46986414', name: 'Dunkler Magier', set_code: 'LOB-DE005', rarity: 'Ultra Rare', language: 'DE',
  count: '1', edition: 'first', condition: 'NM', container: '', container_kind: '', pockets_per_page: '', page: '', slot: '',
  tags: [], note: '', ...over,
});
const LOB = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ultra Rare' };
const CATALOG = new Map([
  ['46986414', { name_de: 'Dunkler Magier', name_en: 'Dark Magician', type: 'Normal Monster', image: 'img-dm' }],
  ['89631139', { name_de: '', name_en: 'Blue-Eyes White Dragon', type: 'Normal Monster', image: 'img-bewd' }],
]);
const ALIASES = new Map([['46986415', '46986414']]);
function ctx(over = {}) {
  return {
    catalog: { card: (p) => CATALOG.get(ALIASES.get(p) || p) || null },
    localCards: new Map(),
    printings: new Map(),
    containers: [],
    occupied: new Map(),
    defaults: { edition: 'unknown', condition: 'NM' },
    ...over,
  };
}
const one = (r, c = ctx(), rule = 'add') => resolveCarddexRows([r], c, rule).rows[0];

test('Grün: Printing vorhanden, Karte in der lokalen Sammlung, alle Felder gültig', () => {
  const c = ctx({ catalog: null, localCards: new Map([['46986414', { name: 'Dunkler Magier', type: 'x', image_url: 'u' }]]),
    printings: new Map([[printingKey(LOB), { live: 2, located: 0 }]]) });
  const r = one(row({ tags: ['Deck'], note: 'Notiz' }), c);
  assert.equal(r.status, 'green');
  assert.equal(r.action, 'import');
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.printing, LOB);
  assert.equal(r.count, 1);
  assert.deepEqual([r.edition, r.condition, r.tags, r.note, r.meta], ['first', 'NM', ['Deck'], 'Notiz', null]);
});

test('Katalog über die Artwork-Zuordnung: Passcode bleibt, Name/Typ/Bild der Hauptkarte; neues Printing gelb', () => {
  const r = one(row({ passcode: '46986415', set_code: 'CT13-DE003' }));
  assert.equal(r.status, 'yellow');
  assert.deepEqual(r.reasons, ['Printing wird angelegt']);
  assert.equal(r.printing.id, '46986415');
  assert.deepEqual(r.meta, { name: 'Dunkler Magier', type: 'Normal Monster', image_url: 'img-dm' });
  assert.equal(one(row({ passcode: '89631139' })).meta.name, 'Blue-Eyes White Dragon', 'ohne deutschen Namen der englische');
});

test('Rot: Passcode unbekannt oder Menge ungültig; ohne Katalog nur lokale Sammlung', () => {
  assert.deepEqual(one(row({ passcode: '12345678' })).reasons, ['Passcode unbekannt']);
  assert.deepEqual(one(row({ passcode: 'abc' })).reasons, ['Passcode unbekannt']);
  for (const count of ['0', '', '-1', '1.5', 'zwei', '1001']) {
    const r = one(row({ count }));
    assert.equal(r.status, 'red', count);
    assert.deepEqual(r.reasons, ['Menge ungültig'], count);
  }
  assert.equal(one(row({ count: '1000' })).status, 'yellow');
  const noCatalog = resolveCarddexRows([row()], ctx({ catalog: null }));
  assert.equal(noCatalog.rows[0].status, 'red');
  assert.equal(noCatalog.summary.catalogMissing, true);
});

test('Führende Nullen: Katalog ohne, lokale Sammlung mit gespeicherter Schreibweise', () => {
  assert.equal(one(row({ passcode: '046986414' })).printing.id, '46986414');
  const c = ctx({ catalog: null, localCards: new Map([['04031928', { name: 'X', type: null, image_url: null }]]) });
  assert.equal(one(row({ passcode: '04031928' }), c).printing.id, '04031928');
});

test('Gelb: Edition/Zustand ungültig -> Standard aus settings; leere Felder: Unknown, Sprache DE', () => {
  const r = one(row({ edition: '1st', condition: 'nm' }), ctx({ defaults: { edition: 'unlimited', condition: 'EX' } }));
  assert.deepEqual([r.edition, r.condition], ['unlimited', 'NM']);
  assert.deepEqual(r.reasons, ['Edition ungültig – Standard unlimited', 'Printing wird angelegt']);
  const bad = one(row({ condition: 'mint' }));
  assert.equal(bad.condition, 'NM');
  assert.ok(bad.reasons.includes('Zustand ungültig – Standard NM'));
  const blank = one(row({ set_code: '', rarity: '', language: 'en' }));
  assert.deepEqual(blank.printing, { id: '46986414', set_code: 'Unknown', language: 'EN', rarity: 'Unknown' });
});

test('Behälter: neu anlegen (Art und Fächerzahl aus der Datei, Binder ohne Angabe 9), vorhandener über den Namen', () => {
  const rows = [
    row({ line: 2, container: 'Binder Blau', container_kind: 'binder', pockets_per_page: '12', page: '1', slot: '12' }),
    row({ line: 3, container: 'Neu', container_kind: 'binder', page: '1', slot: '9' }),
    row({ line: 4, container: 'Box 1', container_kind: 'box' }),
  ];
  const c = ctx({ containers: [{ container_id: 'b1', name: 'Box 1', kind: 'box', pockets_per_page: null }] });
  const { rows: out, summary } = resolveCarddexRows(rows, c);
  assert.deepEqual(out[0].container, { name: 'Binder Blau', kind: 'binder', pockets_per_page: 12, container_id: null, create: true });
  assert.deepEqual([out[0].page, out[0].slot], [1, 12]);
  assert.ok(out[0].reasons.includes('Behälter „Binder Blau“ wird angelegt'));
  assert.equal(out[1].container.pockets_per_page, 9);
  assert.deepEqual(out[2].container, { name: 'Box 1', kind: 'box', pockets_per_page: null, container_id: 'b1', create: false });
  assert.ok(!out[2].reasons.some((x) => x.startsWith('Behälter')));
  assert.equal(summary.containersToCreate, 2);
});

test('Behälter: ungültige Art -> Box, ungültige Fächerzahl -> 9, abweichende Zeilen gelb (erste Zeile gilt)', () => {
  const rows = [
    row({ line: 2, container: 'A', container_kind: 'schrank' }),
    row({ line: 3, container: 'B', container_kind: 'binder', pockets_per_page: '8' }),
    row({ line: 4, container: 'B', container_kind: 'binder', pockets_per_page: '8' }),
    row({ line: 5, container: 'B', container_kind: 'binder', pockets_per_page: '4', page: '1', slot: '9' }),
    row({ line: 6, container: 'B', container_kind: 'box' }),
  ];
  const out = resolveCarddexRows(rows, ctx()).rows;
  assert.equal(out[0].container.kind, 'box');
  assert.ok(out[0].reasons.includes('Behälter-Art ungültig – Box'));
  assert.equal(out[1].container.pockets_per_page, 9);
  assert.ok(out[1].reasons.includes('Fächerzahl ungültig – 9'));
  assert.ok(!out[2].reasons.some((x) => x.includes('weicht ab')), 'gleiche Angaben wie die erste Zeile');
  assert.ok(out[3].reasons.includes('Behälter „B“ weicht ab – Art und Fächerzahl aus Zeile 3'));
  assert.deepEqual([out[3].container.pockets_per_page, out[3].page, out[3].slot], [9, 1, 9], 'Fach passt zur geltenden Fächerzahl');
  assert.ok(out[4].reasons.includes('Behälter „B“ weicht ab – Art und Fächerzahl aus Zeile 3'));
  assert.equal(out[4].container.kind, 'binder');
});

test('Seite/Fach: kein Binder, ungültig, über der Fächerzahl oder belegt -> ohne Seite/Fach in den Behälter', () => {
  const OTHER = { id: '89631139', set_code: 'SDK-DE001', language: 'DE', rarity: 'Ultra Rare' };
  const c = ctx({
    containers: [{ container_id: 'b1', name: 'Blau', kind: 'binder', pockets_per_page: 9 }, { container_id: 'x1', name: 'Box', kind: 'box', pockets_per_page: null }],
    occupied: new Map([[slotKey('b1', 1, 1), new Set([printingKey(OTHER)])]]),
  });
  const rows = [
    row({ line: 2, container: 'Box', container_kind: 'box', page: '1', slot: '1' }),
    row({ line: 3, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: '1', slot: '10' }),
    row({ line: 4, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: 'x', slot: '1' }),
    row({ line: 5, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: '1', slot: '' }),
    row({ line: 6, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: '1', slot: '1' }),
    row({ line: 7, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: '1', slot: '2' }),
  ];
  const out = resolveCarddexRows(rows, c).rows;
  const expectReason = (r, reason) => {
    assert.ok(r.reasons.includes(reason), `${r.line}: ${r.reasons}`);
    assert.deepEqual([r.page, r.slot], [null, null]);
    assert.ok(r.container);
  };
  expectReason(out[0], 'Behälter ist kein Binder – ohne Seite/Fach');
  expectReason(out[1], 'Seite/Fach ungültig – ohne Seite/Fach');
  expectReason(out[2], 'Seite/Fach ungültig – ohne Seite/Fach');
  expectReason(out[3], 'Seite/Fach ungültig – ohne Seite/Fach');
  expectReason(out[4], 'Fach belegt – ohne Seite/Fach');
  assert.deepEqual([out[5].page, out[5].slot], [1, 2]);
});

test('Regeln: Hinzufügen (Standard), Ersetzen (Zählung, belegte Fächer der ersetzten Printings frei), Überspringen', () => {
  const c = ctx({
    printings: new Map([[printingKey(LOB), { live: 3, located: 2 }]]),
    containers: [{ container_id: 'b1', name: 'Blau', kind: 'binder', pockets_per_page: 9 }],
    occupied: new Map([[slotKey('b1', 1, 1), new Set([printingKey(LOB)])]]),
  });
  const rows = [
    row({ line: 2, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: '1', slot: '1' }),
    row({ line: 3, count: '2' }),
    row({ line: 4, passcode: '89631139', set_code: 'SDK-DE001' }),
    row({ line: 5, passcode: '99999999' }),
  ];
  const add = resolveCarddexRows(rows, c, 'add');
  assert.ok(add.rows[0].reasons.includes('Fach belegt – ohne Seite/Fach'));
  assert.deepEqual([add.summary.replaced, add.summary.skippedExisting], [0, 0]);
  assert.equal(replaceWarningText(add.summary), null);

  const replace = resolveCarddexRows(rows, c, 'replace');
  assert.deepEqual([replace.rows[0].page, replace.rows[0].slot], [1, 1], 'das ersetzte Exemplar gibt sein Fach frei');
  assert.deepEqual([replace.summary.replaced, replace.summary.replacedLocated], [3, 2], 'je Printing einmal gezählt');
  assert.equal(replaceWarningText(replace.summary), '3 vorhandene Exemplare werden ersetzt, davon 2 mit Standort oder Tags');

  const skip = resolveCarddexRows(rows, c, 'skip');
  assert.deepEqual(skip.rows.map((r) => r.action), ['skip-existing', 'skip-existing', 'import', 'red']);
  assert.deepEqual(skip.rows[1].reasons, ['Printing vorhanden – übersprungen']);
  assert.equal(skip.rows[0].container, null, 'übersprungene Zeilen planen keinen Behälter');
  assert.equal(skip.summary.skippedExisting, 2);
  assert.equal(resolveCarddexRows(rows, c, 'quatsch').summary.rule, 'add');
});

test('Zusammenfassung und Texte', () => {
  const rows = [
    row({ line: 2, container: 'Neu', container_kind: 'box' }),
    row({ line: 3 }),
    row({ line: 4, passcode: '1' }),
  ];
  const c = ctx({ printings: new Map([[printingKey(LOB), { live: 1, located: 0 }]]) });
  const { summary } = resolveCarddexRows(rows, c);
  assert.deepEqual(summary, { rule: 'add', total: 3, green: 1, yellow: 1, red: 1, containersToCreate: 1, replaced: 0, replacedLocated: 0, skippedExisting: 0, catalogMissing: false });
  assert.equal(previewHeaderText(summary), '3 Zeilen · 1 bereit · 1 mit Hinweis · 1 unbekannt · 1 Behälter wird angelegt');
  assert.equal(previewHeaderText({ total: 412, green: 398, yellow: 11, red: 3, containersToCreate: 2 }), '412 Zeilen · 398 bereit · 11 mit Hinweis · 3 unbekannt · 2 Behälter werden angelegt');
  assert.equal(previewHeaderText({ total: 1, green: 1, yellow: 0, red: 0, containersToCreate: 0 }), '1 Zeile · 1 bereit · 0 mit Hinweis · 0 unbekannt');
  assert.equal(replaceWarningText({ rule: 'replace', replaced: 1, replacedLocated: 0 }), '1 vorhandenes Exemplar wird ersetzt, davon 0 mit Standort oder Tags');
  assert.equal(importResultText({ imported: 398, containersCreated: 2, omitted: 3, skipped: 0 }), '398 Exemplare importiert · 2 Behälter angelegt · 3 ausgelassen');
  assert.equal(importResultText({ imported: 1, containersCreated: 0, omitted: 0, skipped: 4 }), '1 Exemplar importiert · 0 Behälter angelegt · 0 ausgelassen · 4 übersprungen');
});
