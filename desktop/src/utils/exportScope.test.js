import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCopyIds, exportScope, EXPORT_FORMAT_OPTIONS } from './exportScope.js';
import { printingKey } from './printingKey.js';

const DE = { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' };
const EN = { id: '1', set_code: 'LOB-EN001', language: 'EN', rarity: 'Ultra Rare' };
const SDK = { id: '2', set_code: 'SDK-DE001', language: 'DE', rarity: 'Common' };
const copy = (p, copy_id, over = {}) => ({ copy_id, card_id: p.id, set_code: p.set_code, language: p.language, rarity: p.rarity,
  edition: 'unknown', condition: 'NM', container_id: null, tags: null, ...over });
const GROUPS = [{ variants: [DE, EN] }, { variants: [SDK] }];
const COPIES = {
  [printingKey(DE)]: [copy(DE, 'a', { condition: 'EX', container_id: 'b1', tags: '["Tausch"]' }), copy(DE, 'b', { edition: 'first' })],
  [printingKey(EN)]: [copy(EN, 'c', { container_id: 'b1' })],
  [printingKey(SDK)]: [copy(SDK, 'd', { tags: '["tausch","Deck"]' })],
};

test('ohne Filter alle Exemplare der gefilterten Gruppen', () => {
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, {}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(filterCopyIds([GROUPS[1]], COPIES), ['d'], 'nur Gruppen, die die Liste zeigt');
  assert.deepEqual(filterCopyIds(null, null), []);
});

test('Printing-Filter: Sprache, Seltenheit, Set-Kürzel', () => {
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { lang: 'DE' }), ['a', 'b', 'd']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { rarity: 'Common' }), ['d']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { set: 'LOB' }), ['a', 'b', 'c']);
});

test('Exemplar-Filter: Zustand, Edition, Behälter, Tags (ohne Groß/Klein)', () => {
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { condition: 'EX' }), ['a']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { edition: 'first' }), ['b']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { containers: ['b1'] }), ['a', 'c']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { tags: ['TAUSCH'] }), ['a', 'd']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { lang: 'DE', containers: ['b1'], tags: ['Tausch'] }), ['a']);
});

test('Umfang für den Hauptprozess und Formatliste', () => {
  assert.deepEqual(exportScope('all'), { kind: 'all' });
  assert.deepEqual(exportScope('container', { containerId: 'b1' }), { kind: 'container', containerId: 'b1' });
  assert.deepEqual(exportScope('filter', { copyIds: ['a'] }), { kind: 'copies', copyIds: ['a'] });
  assert.deepEqual(EXPORT_FORMAT_OPTIONS.map((o) => o.value), ['carddex', 'dragonshield', 'ygoprodeck', 'wantslist', 'salelist']);
});
