const test = require('node:test');
const assert = require('node:assert/strict');
const { kenntRarity, dropErfundeneRarity } = require('./rarity-sources.cjs');

const s = (code, rarity) => ({ set_code: code, set_rarity: rarity });

test('kennt die Quelle eine Rarity?', () => {
  assert.ok(kenntRarity('Ultra Rare'));
  assert.ok(!kenntRarity(''));
  assert.ok(!kenntRarity(null));
  assert.ok(!kenntRarity('Unknown'), 'der Platzhalter ist keine Auskunft');
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

test('leere Eingabe und unveraenderte Listen', () => {
  assert.deepEqual(dropErfundeneRarity([]), []);
  assert.deepEqual(dropErfundeneRarity(null), []);
  const sauber = [s('A-DE001', 'Common'), s('B-DE002', 'Rare')];
  assert.deepEqual(dropErfundeneRarity(sauber), sauber);
});
