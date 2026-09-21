import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuelleRarityAusGeschwistern, kenntRarity } from './printingRarity.js';

const d = (set_code, set_rarity, language) => ({ set_code, set_rarity, language });

test('der Fall vom 21.09.: MAMO-DE072 Unknown uebernimmt Ultra Rare von MAMO-EN072', () => {
  const out = fuelleRarityAusGeschwistern([
    d('DUPO-DE002', 'Ultra Rare', 'DE'), d('MAMO-DE072', 'Unknown', 'DE'),
    d('DUPO-EN002', 'Ultra Rare', 'EN'), d('MAMO-EN072', 'Ultra Rare', 'EN'),
  ]);
  const de072 = out.filter(p => p.set_code === 'MAMO-DE072');
  assert.equal(de072.length, 1);
  assert.equal(de072[0].set_rarity, 'Ultra Rare');
  assert.equal(de072[0].rarityVonGeschwister, true, 'nachvollziehbar, woher die Rarity kommt');
});

test('mehrere echte Rarities der Geschwister ergeben je eine Zeile', () => {
  const out = fuelleRarityAusGeschwistern([
    d('MAMO-DE015', 'Unknown', 'DE'), d('MAMO-EN015', 'Ultra Rare', 'EN'), d('MAMO-EN015', 'Starlight Rare', 'EN'),
  ]);
  assert.deepEqual(out.filter(p => p.language === 'DE').map(p => p.set_rarity), ['Ultra Rare', 'Starlight Rare']);
});

test('ohne Geschwister mit Rarity bleibt Unknown ehrlich stehen', () => {
  const out = fuelleRarityAusGeschwistern([d('26DE-DEG07', 'Unknown', 'DE')]);
  assert.deepEqual(out, [d('26DE-DEG07', 'Unknown', 'DE')]);
});

test('eine bekannte Rarity wird nie ueberschrieben, eine andere Nummer hilft nicht', () => {
  const out = fuelleRarityAusGeschwistern([
    d('MAMO-DE072', 'Secret Rare', 'DE'), d('MAMO-EN072', 'Ultra Rare', 'EN'), d('MAMO-DE073', 'Unknown', 'DE'),
  ]);
  assert.equal(out[0].set_rarity, 'Secret Rare');
  assert.equal(out.find(p => p.set_code === 'MAMO-DE073').set_rarity, 'Unknown');
});

test('keine Dublette, wenn die aufgefuellte Zeile schon existiert', () => {
  const out = fuelleRarityAusGeschwistern([
    d('MAMO-DE072', 'Ultra Rare', 'DE'), d('MAMO-DE072', 'Unknown', 'DE'), d('MAMO-EN072', 'Ultra Rare', 'EN'),
  ]);
  assert.equal(out.filter(p => p.set_code === 'MAMO-DE072').length, 1);
});

test('Platzhalter erkennen wie im Hauptprozess', () => {
  for (const r of ['', 'Unknown', 'New', '3', null]) assert.ok(!kenntRarity(r), String(r));
  assert.ok(kenntRarity('Ultra Rare'));
});
