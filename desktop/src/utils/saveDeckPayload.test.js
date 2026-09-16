import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSaveDeckCards } from './saveDeckPayload.js';

// F1: ohne name/image_url loescht save-deck Katalognamen/-bilder nicht besessener Karten -- dieser Test
// scheitert ohne den Schutz (siehe Bericht, Sabotage-Nachweis).
test('buildSaveDeckCards: name und image_url je Karte mitgeschickt', () => {
  const mainDeck = [{ card_id: '1', quantity: 2, name: 'Karte A', image_url: 'a.jpg' }];
  const extraDeck = [{ card_id: '2', quantity: 1, name: 'Karte B', image_url: 'b.jpg' }];
  const sideDeck = [{ card_id: '3', quantity: 3, name: 'Karte C', image_url: null }];
  assert.deepEqual(buildSaveDeckCards({ mainDeck, extraDeck, sideDeck }), [
    { id: '1', type: 'main', quantity: 2, name: 'Karte A', image_url: 'a.jpg', role: null },
    { id: '2', type: 'extra', quantity: 1, name: 'Karte B', image_url: 'b.jpg', role: null },
    { id: '3', type: 'side', quantity: 3, name: 'Karte C', image_url: null, role: null },
  ]);
});

// Spec E3 §6: ohne role verliert "Save Deck" (Loeschen + Neu-Einfuegen) jeden Starter-Stern.
test('buildSaveDeckCards: role der Main-Deck-Starter mitgeschickt, in Extra/Side nie', () => {
  const mainDeck = [{ card_id: '1', quantity: 3, name: 'A', image_url: null, role: 'starter' }, { card_id: '4', quantity: 1, name: 'D', image_url: null }];
  const extraDeck = [{ card_id: '2', quantity: 1, name: 'B', image_url: null, role: 'starter' }];
  const sideDeck = [{ card_id: '1', quantity: 1, name: 'A', image_url: null, role: 'starter' }];
  assert.deepEqual(buildSaveDeckCards({ mainDeck, extraDeck, sideDeck }).map((c) => [c.id, c.type, c.role]), [
    ['1', 'main', 'starter'], ['4', 'main', null], ['2', 'extra', null], ['1', 'side', null],
  ]);
});
