import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueBreakdown, typeGroup, UNSORTED_LABEL, UNKNOWN_LABEL } from './breakdown.js';

const cards = [
  { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare', type: 'Normal Monster', price: 10, quantity: 2, value: 18.5 },
  { id: '2', set_code: 'LOB-DE002', language: 'DE', rarity: 'Common', type: 'Spell Card', price: 1, quantity: 1, value: 1 },
  { id: '3', set_code: 'MRD-DE003', language: 'DE', rarity: 'Common', type: 'Trap Card', price: 4, quantity: 1, value: 4 },
];
const copies = [
  { card_id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare', condition: 'NM', container_id: 'b1' },
  { card_id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare', condition: 'EX', container_id: null },
  { card_id: '2', set_code: 'LOB-DE002', language: 'DE', rarity: 'Common', condition: 'NM', container_id: 'b1' },
  { card_id: '3', set_code: 'MRD-DE003', language: 'DE', rarity: 'Common', condition: 'NM', container_id: 'weg' },
];
const containers = [{ container_id: 'b1', name: 'Ordner Blau' }];

test('typeGroup', () => {
  assert.equal(typeGroup('Effect Monster'), 'Monster');
  assert.equal(typeGroup('Spell Card'), 'Zauber');
  assert.equal(typeGroup('Trap Card'), 'Falle');
  assert.equal(typeGroup(null), 'Sonstige');
});

test('Typ nach Wert', () => {
  assert.deepEqual(valueBreakdown({ cards, copies, containers, dimension: 'type' }), [
    { label: 'Monster', count: 2, value: 18.5 },
    { label: 'Falle', count: 1, value: 4 },
    { label: 'Zauber', count: 1, value: 1 },
  ]);
});

test('Set nach Praefix', () => {
  assert.deepEqual(valueBreakdown({ cards, copies, containers, dimension: 'set' }), [
    { label: 'LOB', count: 3, value: 19.5 },
    { label: 'MRD', count: 1, value: 4 },
  ]);
});

test('Binder: Exemplare mit Zustandsfaktor, ohne oder unbekannter Behaelter = Nicht einsortiert', () => {
  assert.deepEqual(valueBreakdown({ cards, copies, containers, dimension: 'binder' }), [
    { label: 'Ordner Blau', count: 2, value: 11 },
    { label: UNSORTED_LABEL, count: 2, value: 12.5 },
  ].sort((a, b) => b.value - a.value));
});

test('Unbekanntes Set und fehlende Raritaet heissen Unbekannt', () => {
  const cards2 = [
    { id: '9', set_code: 'Unknown', language: 'DE', rarity: 'Unknown', type: 'Normal Monster', price: 2, quantity: 1, value: 2 },
    { id: '8', set_code: 'LOB-DE008', language: 'DE', rarity: null, type: 'Spell Card', price: 1, quantity: 1, value: 1 },
  ];
  assert.deepEqual(valueBreakdown({ cards: cards2, copies: [], containers: [], dimension: 'set' }), [
    { label: UNKNOWN_LABEL, count: 1, value: 2 },
    { label: 'LOB', count: 1, value: 1 },
  ]);
  assert.deepEqual(valueBreakdown({ cards: cards2, copies: [], containers: [], dimension: 'rarity' }), [
    { label: UNKNOWN_LABEL, count: 2, value: 3 },
  ]);
});

test('Binder: 1st-Ed-Exemplar zählt mit price_first_ed', () => {
  const cardsFe = [{ id: '5', set_code: 'MAMO-DE020', language: 'DE', rarity: 'Ultra Rare', type: 'Effect Monster', price: 73.85, price_first_ed: 77.87, quantity: 2, value: 0 }];
  const copiesFe = [
    { card_id: '5', set_code: 'MAMO-DE020', language: 'DE', rarity: 'Ultra Rare', edition: 'first', condition: 'NM', container_id: 'b1' },
    { card_id: '5', set_code: 'MAMO-DE020', language: 'DE', rarity: 'Ultra Rare', edition: 'unknown', condition: 'NM', container_id: 'b1' },
  ];
  assert.deepEqual(valueBreakdown({ cards: cardsFe, copies: copiesFe, containers, dimension: 'binder' }), [
    { label: 'Ordner Blau', count: 2, value: 151.72 },
  ]);
});
