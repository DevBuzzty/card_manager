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

test('M4(b): kein gelesener Setcode zaehlt den Hauptdruck auch mit vorhandenen Zusatzdrucken', () => {
  const card = loaded({ extraPrintings: [{ id: 'x', selectedSet: sdy, quantity: 1 }] });
  assert.deepEqual(aggregateTarget(card, scan({ setCode: undefined })), { kind: 'primary' });
});

test('applyScan haengt eine unbekannte Karte hinten an', () => {
  const out = applyScan([], scan());
  assert.equal(out.length, 1);
  assert.equal(out[0].passcode, '46986414');
  assert.equal(out[0].status, 'pending');
  assert.equal(out[0].scannedSetCode, 'LOB-DE005');
});

test('applyScan legt eine erste Sichtung auch ohne mode-Feld an', () => {
  // I2: die erste Sichtung wird IMMER angelegt -- nur eine Wiederholung wird vom Modus-Feld
  // entschieden.
  const out = applyScan([], scan({ mode: undefined }));
  assert.equal(out.length, 1);
  assert.equal(out[0].passcode, '46986414');
});

test('applyScan im Modus "stapel" erhoeht die Menge des Hauptdrucks bei einer Wiederholung', () => {
  const out = applyScan([loaded()], scan({ mode: 'stapel' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, 2);
});

test('I2: applyScan im Modus "einzeln" laesst die Liste bei einer Wiederholung unveraendert', () => {
  const cards = [loaded()];
  const out = applyScan(cards, scan({ mode: 'einzeln' }));
  assert.equal(out, cards); // dieselbe Array-Referenz, nicht nur derselbe Inhalt
  assert.equal(out[0].quantity, 1);
});

test('I2: applyScan OHNE mode-Feld laesst die Liste bei einer Wiederholung unveraendert', () => {
  // Ein aelteres Handy schickt kein `mode` -- muss wie "einzeln" behandelt werden, nicht wie
  // "stapel".
  const cards = [loaded()];
  const out = applyScan(cards, scan({ mode: undefined }));
  assert.equal(out, cards);
  assert.equal(out[0].quantity, 1);
});

test('applyScan legt im Modus "stapel" einen neuen Zusatzdruck mit Menge 1 an', () => {
  const out = applyScan([loaded()], scan({ setCode: 'SDY-G005', mode: 'stapel' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].quantity, 1);
  assert.equal(out[0].extraPrintings.length, 1);
  assert.equal(out[0].extraPrintings[0].quantity, 1);
  assert.equal(out[0].extraPrintings[0].selectedSet.set_code, 'SDY-G005');
  // C1: der automatisch angelegte Zusatzdruck braucht eine id, sonst schluesselt das gesamte
  // Zusatzdruck-UI in StagingArea.jsx (updatePrinting/removePrinting/key) auf `undefined`.
  assert.ok(out[0].extraPrintings[0].id);
  // Ohne uebergebene `defaults` greift der Rueckfall -- dieselben Werte, die CopyChip.jsx als
  // Standardparameter kennt.
  assert.equal(out[0].extraPrintings[0].edition, 'unknown');
  assert.equal(out[0].extraPrintings[0].condition, 'NM');
});

test('I3: M4(a): ein neuer Zusatzdruck erbt die uebergebenen Voreinstellungen', () => {
  const defaults = { edition: 'first', condition: 'EX' };
  const out = applyScan([loaded()], scan({ setCode: 'SDY-G005', mode: 'stapel' }), defaults);
  assert.equal(out[0].extraPrintings[0].edition, 'first');
  assert.equal(out[0].extraPrintings[0].condition, 'EX');
});

test('C1: zwei automatisch angelegte Zusatzdrucke bekommen unterschiedliche ids', () => {
  let cards = [loaded()];
  cards = applyScan(cards, scan({ setCode: 'SDY-G005', mode: 'stapel' }));
  cards = applyScan(cards, scan({ setCode: 'LOB-EN005', rarity: 'Ultra Rare', language: 'EN', mode: 'stapel' }));
  const [first, second] = cards[0].extraPrintings;
  assert.equal(cards[0].extraPrintings.length, 2);
  assert.ok(first.id);
  assert.ok(second.id);
  assert.notEqual(first.id, second.id);
});

test('applyScan fasst im Modus "stapel" nur den passenden Eintrag an', () => {
  const other = loaded({ tempId: 9, passcode: '11111111' });
  const out = applyScan([other, loaded()], scan({ mode: 'stapel' }));
  assert.equal(out[0].quantity, 1);
  assert.equal(out[1].quantity, 2);
});
