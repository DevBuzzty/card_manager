import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printingKey, copyKey } from './printingKey.js';

test('printingKey reiht die vier Spalten in der Reihenfolge des Primaerschluessels', () => {
  assert.equal(
    printingKey({ id: '46986414', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' }),
    '46986414|LOB-DE001|DE|Ultra Rare',
  );
});

test('copyKey liest dieselbe Spalte aus card_id', () => {
  assert.equal(
    copyKey({ card_id: '46986414', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' }),
    '46986414|LOB-DE001|DE|Ultra Rare',
  );
});

test('beide Ableiter liefern fuer dieselbe Druckvariante denselben Schluessel', () => {
  const card = { id: '89631139', set_code: 'SDK-DE001', language: 'EN', rarity: 'Common' };
  const copy = { card_id: '89631139', set_code: 'SDK-DE001', language: 'EN', rarity: 'Common' };
  assert.equal(copyKey(copy), printingKey(card));
});

test('fehlende Sprache faellt in beiden Ableitern auf DE zurueck -- und zwar gleich', () => {
  const card = { id: '55144522', set_code: 'MRD-DE037', rarity: 'Super Rare' };
  const copy = { card_id: '55144522', set_code: 'MRD-DE037', rarity: 'Super Rare' };
  assert.equal(printingKey(card), '55144522|MRD-DE037|DE|Super Rare');
  assert.equal(copyKey(copy), printingKey(card));
});

test('leere Sprache zaehlt wie fehlende -- DE, nicht der leere String', () => {
  assert.equal(printingKey({ id: '1', set_code: 'X', language: '', rarity: 'Common' }), '1|X|DE|Common');
  assert.equal(copyKey({ card_id: '1', set_code: 'X', language: null, rarity: 'Common' }), '1|X|DE|Common');
});

test('fehlende Seltenheit wird NICHT ersetzt: die Druckvariante ohne Rarity ist eine eigene', () => {
  // Kein Rueckfall auf "Common" -- ein solcher wuerde eine Zeile ohne Seltenheit still auf die
  // Common-Zeile derselben Set-Nummer zeigen lassen. Sie bekommt einen eigenen Schluessel.
  assert.equal(printingKey({ id: '1', set_code: 'X', language: 'DE' }), '1|X|DE|undefined');
  assert.notEqual(
    printingKey({ id: '1', set_code: 'X', language: 'DE' }),
    printingKey({ id: '1', set_code: 'X', language: 'DE', rarity: 'Common' }),
  );
});

test('verschiedene Seltenheiten derselben Set-Nummer bleiben getrennt', () => {
  assert.notEqual(
    printingKey({ id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Common' }),
    printingKey({ id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Secret Rare' }),
  );
});

test('Zahl und Zeichenkette als Passcode ergeben denselben Schluessel', () => {
  // getCollection liefert id als Zahl, card_copies.card_id als Text -- ohne das traefe die
  // Fach-Ansicht keinen einzigen Namen.
  assert.equal(
    printingKey({ id: 46986414, set_code: 'LOB-DE001', language: 'DE', rarity: 'Common' }),
    copyKey({ card_id: '46986414', set_code: 'LOB-DE001', language: 'DE', rarity: 'Common' }),
  );
});
