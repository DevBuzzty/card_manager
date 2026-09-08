import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateTarget, applyScan } from './scanAggregate.js';

const lob = { set_code: 'LOB-DE005', set_rarity: 'Common', language: 'DE' };
const sdy = { set_code: 'SDY-G005', set_rarity: 'Common', language: 'DE' };
const lobEn = { set_code: 'LOB-EN005', set_rarity: 'Ultra Rare', language: 'EN' };

const loaded = (over = {}) => ({
  tempId: 1, passcode: '46986414', status: 'loaded',
  allPrintings: [lob, sdy, lobEn], selectedSet: lob, quantity: 1, extraPrintings: [],
  ...over,
});

const scan = (over = {}) => ({ passcode: '46986414', setCode: 'LOB-DE005', rarity: 'Common', language: 'DE', ...over });

test('ohne gelesenen Setcode zaehlt der Hauptdruck', () => {
  assert.deepEqual(aggregateTarget(loaded(), scan({ setCode: undefined })), { kind: 'primary' });
});

test('eine noch ladende Karte zaehlt den Hauptdruck', () => {
  // Wettlauf: es gibt noch keine Druckliste, gegen die verglichen werden koennte.
  const pending = { tempId: 1, passcode: '46986414', status: 'pending', quantity: 1 };
  assert.deepEqual(aggregateTarget(pending, scan()), { kind: 'primary' });
});

test('gleicher Druck wie der Hauptdruck zaehlt den Hauptdruck', () => {
  assert.deepEqual(aggregateTarget(loaded(), scan()), { kind: 'primary' });
});

test('bekannter Zusatzdruck wird getroffen', () => {
  const card = loaded({ extraPrintings: [{ selectedSet: sdy, quantity: 1 }] });
  assert.deepEqual(aggregateTarget(card, scan({ setCode: 'SDY-G005' })), { kind: 'extra', index: 0 });
});

test('der richtige unter mehreren Zusatzdrucken wird getroffen', () => {
  const card = loaded({ extraPrintings: [
    { selectedSet: sdy, quantity: 1 },
    { selectedSet: lobEn, quantity: 1 },
  ] });
  const t = aggregateTarget(card, scan({ setCode: 'LOB-EN005', rarity: 'Ultra Rare', language: 'EN' }));
  assert.deepEqual(t, { kind: 'extra', index: 1 });
});

test('unbekannter Druck wird ein neuer Zusatzdruck', () => {
  const t = aggregateTarget(loaded(), scan({ setCode: 'SDY-G005' }));
  assert.equal(t.kind, 'newExtra');
  assert.equal(t.set.set_code, 'SDY-G005');
});

test('gleicher Setcode mit anderer Rarity ist ein anderer Druck', () => {
  const t = aggregateTarget(loaded(), scan({ rarity: 'Secret Rare' }));
  assert.equal(t.kind, 'newExtra');
});

test('gleicher Setcode in anderer Sprache ist ein anderer Druck', () => {
  const t = aggregateTarget(loaded(), scan({ language: 'EN' }));
  assert.equal(t.kind, 'newExtra');
});

test('ein noch leerer Zusatzdruck wird uebersprungen statt getroffen', () => {
  const card = loaded({ extraPrintings: [{ selectedSet: null, quantity: 1 }] });
  const t = aggregateTarget(card, scan({ setCode: 'SDY-G005' }));
  assert.equal(t.kind, 'newExtra');
  assert.equal(t.set.set_code, 'SDY-G005');
});

test('geladene Karte ohne Hauptdruck zaehlt trotzdem den Hauptdruck', () => {
  // Befund 1: `status === 'loaded'` und `selectedSet === null` sind gleichzeitig erreichbar --
  // siehe Kommentar in scanAggregate.js. `allPrintings: []` ist absichtlich ein LEERES aber
  // WAHRES Array, damit der Statusproxy allein diesen Fall nicht abfaengt.
  const card = { tempId: 1, passcode: '46986414', status: 'loaded', allPrintings: [], selectedSet: null, quantity: 1, extraPrintings: [] };
  assert.deepEqual(aggregateTarget(card, scan()), { kind: 'primary' });
});

test('applyScan haengt eine unbekannte Karte hinten an', () => {
  const out = applyScan([], scan());
  assert.equal(out.length, 1);
  assert.equal(out[0].passcode, '46986414');
  assert.equal(out[0].status, 'pending');
  assert.equal(out[0].scannedSetCode, 'LOB-DE005');
});

test('applyScan erhoeht die Menge des Hauptdrucks', () => {
  const out = applyScan([loaded()], scan());
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, 2);
});

test('applyScan legt einen neuen Zusatzdruck mit Menge 1 an', () => {
  const out = applyScan([loaded()], scan({ setCode: 'SDY-G005' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, 1);
  assert.equal(out[0].extraPrintings.length, 1);
  assert.equal(out[0].extraPrintings[0].quantity, 1);
  assert.equal(out[0].extraPrintings[0].selectedSet.set_code, 'SDY-G005');
  // Edition und Zustand bleiben leer -- handleAdd setzt beim Uebernehmen die Voreinstellungen ein.
  assert.equal(out[0].extraPrintings[0].edition, null);
});

test('applyScan fasst nur den passenden Eintrag an', () => {
  const other = loaded({ tempId: 9, passcode: '11111111' });
  const out = applyScan([other, loaded()], scan());
  assert.equal(out[0].quantity, 1);
  assert.equal(out[1].quantity, 2);
});
