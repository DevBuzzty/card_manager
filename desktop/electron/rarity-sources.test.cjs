const test = require('node:test');
const assert = require('node:assert/strict');
const { kenntRarity, repariereQuellcode, dropErfundeneRarity } = require('./rarity-sources.cjs');

const s = (code, rarity) => ({ set_code: code, set_rarity: rarity });

test('kennt die Quelle eine Rarity?', () => {
  assert.ok(kenntRarity('Ultra Rare'));
  assert.ok(!kenntRarity(''));
  assert.ok(!kenntRarity(null));
  assert.ok(!kenntRarity('Unknown'), 'der Platzhalter ist keine Auskunft');
  assert.ok(!kenntRarity('New'), 'YGOPRODecks Platzhalter fuer ein frisches Set');
  assert.ok(!kenntRarity('new'));
  assert.ok(!kenntRarity('  '));
});

test('der echte Fall: Konami steuert nichts bei, das Wiki kennt Ultra Rare', () => {
  // Yugipedia und Fandom sagen beide "Ultra Rare", Konami nennt gar nichts (gemessen 20.09.2026).
  const union = [s('BLGG-DE055', 'Ultra Rare'), s('BLGG-DE055', 'Ultra Rare'), s('BLGG-DE055', '')];
  assert.deepEqual(dropErfundeneRarity(union), [s('BLGG-DE055', 'Ultra Rare'), s('BLGG-DE055', 'Ultra Rare')]);
});

test('kennt keine Quelle die Rarity, bleibt EINE ehrliche Zeile', () => {
  assert.deepEqual(dropErfundeneRarity([s('XYZ-DE001', ''), s('XYZ-DE001', '')]),
    [s('XYZ-DE001', 'Unknown')]);
});

test('echte Mehrdeutigkeit bleibt: MAMO-DE015 gibt es als Ultra UND als Starlight Rare', () => {
  const union = [s('MAMO-DE015', 'Ultra Rare'), s('MAMO-DE015', 'Starlight Rare'), s('MAMO-DE015', '')];
  assert.deepEqual(dropErfundeneRarity(union), [s('MAMO-DE015', 'Ultra Rare'), s('MAMO-DE015', 'Starlight Rare')]);
});

test('Gross/Kleinschreibung des Codes trennt nicht, Zusatzfelder bleiben', () => {
  const union = [{ set_code: 'blgg-de055', set_rarity: 'Ultra Rare', price: 7 }, s('BLGG-DE055', '')];
  assert.deepEqual(dropErfundeneRarity(union), [{ set_code: 'blgg-de055', set_rarity: 'Ultra Rare', price: 7 }]);
});

test('der zweite echte Fall: YGOPRODeck sagt "New", das Wiki kennt Ultra Rare', () => {
  // BLGG-EN045 "Fallin' Cheatah" -- so steht es im Scan-Protokoll: "Rarity mehrdeutig: Ultra Rare/New".
  const union = [s('BLGG-EN045', 'New'), s('BLGG-EN045', 'Ultra Rare')];
  assert.deepEqual(dropErfundeneRarity(union), [s('BLGG-EN045', 'Ultra Rare')]);
});

test('kennt NUR YGOPRODeck den Druck und sagt "New", bleibt es ehrlich unbekannt', () => {
  assert.deepEqual(dropErfundeneRarity([s('BLGG-EN045', 'New')]), [s('BLGG-EN045', 'Unknown')]);
});

test('leere Eingabe und unveraenderte Listen', () => {
  assert.deepEqual(dropErfundeneRarity([]), []);
  assert.deepEqual(dropErfundeneRarity(null), []);
  const sauber = [s('A-DE001', 'Common'), s('B-DE002', 'Rare')];
  assert.deepEqual(dropErfundeneRarity(sauber), sauber);
});

// --- Der Fall LAVD, gemessen am 20.09.2026 (Zwilling von RarityQuellenTest) ---------------------
test('der Buchstabe O in einer Kartennummer ist eine Null, echte Codes bleiben', () => {
  assert.equal(repariereQuellcode('LAVD-ENO11'), 'LAVD-EN011');
  assert.equal(repariereQuellcode('LAVD-DEO19'), 'LAVD-DE019');
  assert.equal(repariereQuellcode('LAVD-ENI22'), 'LAVD-EN122');
  for (const c of ['SGX3-DEA10', 'LOB-EN001', 'MAMO-DE103', 'TP1-G015', 'RA01-EN075']) {
    assert.equal(repariereQuellcode(c), c, c);
  }
});

test('eine Rarity ohne Buchstaben ist keine Rarity', () => {
  assert.ok(!kenntRarity('3'));
  assert.ok(!kenntRarity('2'));
  assert.ok(!kenntRarity('  7 '));
  assert.ok(kenntRarity('Ultra Rare'));
  assert.ok(kenntRarity('20th Secret Rare'));
});
