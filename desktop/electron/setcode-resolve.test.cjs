const test = require('node:test');
const assert = require('node:assert/strict');
const { codeKey, belongsToCard, resolveSetCode } = require('./setcode-resolve.cjs');

// Echte Daten des Falls, der das ausgeloest hat (YGOPRODeck, 20.09.2026).
const SETS = [
  { set_name: 'Magnificent Monsters', set_code: 'MAMO' },
  { set_name: 'Ancient Guardians', set_code: 'ANGU' },
  { set_name: 'Doom of Dimensions', set_code: 'DOOD' },
];
const HAPPINESS = {
  id: 93481594, name: 'Solfachord Happiness',
  card_sets: [{ set_code: 'DOOD-EN065' }, { set_code: 'MAMO-EN103' }],
};
const HARMONIA = { id: 29650040, name: 'Solfachord Harmonia', card_sets: [{ set_code: 'ANGU-EN024' }] };
const CARDS = {
  'Magnificent Monsters': [HAPPINESS],
  'Ancient Guardians': [HARMONIA],
  'Doom of Dimensions': [HAPPINESS],
};
const deps = (zaehler = {}) => ({
  listSets: async () => { zaehler.sets = (zaehler.sets || 0) + 1; return SETS; },
  cardsOfSet: async (n) => { zaehler.karten = (zaehler.karten || 0) + 1; return CARDS[n] || []; },
});

test('Region zaehlt nicht: der deutsche Code findet den englisch gefuehrten Druck', () => {
  assert.deepEqual(codeKey('MAMO-DE103'), { prefix: 'MAMO', number: '103' });
  assert.deepEqual(codeKey('MAMO-EN103'), { prefix: 'MAMO', number: '103' });
  assert.deepEqual(codeKey('SGX3-DEA10'), { prefix: 'SGX3', number: 'A10' }, 'Speed Duel: Variantenbuchstabe gehoert zur Nummer');
  assert.deepEqual(codeKey('MAMO-EN0103'), { prefix: 'MAMO', number: '103' }, 'fuehrende Null egal');
  assert.equal(codeKey('MAMO 103'), null, 'ohne Bindestrich keine Grammatik');
  assert.equal(codeKey(''), null);
});

test('gehoert der gelesene Code zur erkannten Karte?', () => {
  assert.ok(belongsToCard('MAMO-DE103', HAPPINESS.card_sets), 'ja -- nichts zu korrigieren');
  assert.ok(!belongsToCard('MAMO-DE103', HARMONIA.card_sets), 'nein -- die Bilderkennung lag daneben');
  assert.ok(!belongsToCard('Quatsch', HAPPINESS.card_sets));
});

test('der Fall aus dem Lauf: MAMO-DE103 loest die richtige Karte auf', async () => {
  const z = {};
  assert.deepEqual(await resolveSetCode(deps(z), 'MAMO-DE103'),
    { id: '93481594', name: 'Solfachord Happiness', setName: 'Magnificent Monsters' });
  assert.deepEqual(z, { sets: 1, karten: 1 }, 'ein Satz Abfragen, nicht mehr');
});

test('ANGU-DE103 gibt es nicht: keine Auskunft statt einer falschen', async () => {
  assert.equal(await resolveSetCode(deps(), 'ANGU-DE103'), null);
});

test('die Nummer entscheidet, nicht das Set: ANGU-DE024 bleibt bei Harmonia', async () => {
  // Gegenprobe zur Korrektur: liest das Handy den Code der Karte, die das Bild meint, darf nichts
  // passieren. Echte Nummern -- Harmonia ist ANGU-EN024, ANGU-014 gehoert DoSolfachord Cutia.
  assert.ok(belongsToCard('ANGU-DE024', HARMONIA.card_sets));
  assert.ok(!belongsToCard('ANGU-DE014', HARMONIA.card_sets));
});

test('unbekanntes Praefix und ungrammatischer Code geben nichts zurueck', async () => {
  assert.equal(await resolveSetCode(deps(), 'XYZQ-DE001'), null);
  assert.equal(await resolveSetCode(deps(), 'irgendwas'), null);
});

test('zwei Karten auf derselben Nummer entscheiden nichts', async () => {
  const doppelt = {
    listSets: async () => SETS,
    cardsOfSet: async () => [HAPPINESS, { id: 1, name: 'Zwilling', card_sets: [{ set_code: 'MAMO-EN103' }] }],
  };
  assert.equal(await resolveSetCode(doppelt, 'MAMO-DE103'), null);
});
