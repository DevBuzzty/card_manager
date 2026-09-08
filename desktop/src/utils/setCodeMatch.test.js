import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, confusionDistance, matchCandidates, phoneSelectedSet, mapPhoneConfidence } from './setCodeMatch.js';

const sets = [
  { set_code: 'DOOD-DE038', set_rarity: 'Secret Rare' },
  { set_code: 'LOB-EN001', set_rarity: 'Ultra Rare' },
  { set_code: 'SDK-DE050', set_rarity: 'Common' },
];

test('normalize uppercases and strips whitespace', () => {
  assert.equal(normalize(' dood-de038 '), 'DOOD-DE038');
  assert.equal(normalize(null), '');
});

test('confusion substitutions are cheap (0.5), real edits cost 1', () => {
  assert.equal(confusionDistance('DOOD-DE038', 'DOOD-DE038'), 0);
  assert.equal(confusionDistance('DOOO-DE038', 'DOOD-DE038'), 0.5); // O<->D
  assert.ok(confusionDistance('DXXD-DE038', 'DOOD-DE038') >= 2);    // real edits
});

test('exact candidate wins with confidence exact', () => {
  const r = matchCandidates(['LOB-EN001'], sets);
  assert.equal(r.set.set_code, 'LOB-EN001');
  assert.equal(r.confidence, 'exact');
});

test('OCR-mangled candidate corrects to the right printing (fuzzy)', () => {
  const r = matchCandidates(['DOOO-DE038'], sets); // O misread for D
  assert.equal(r.set.set_code, 'DOOD-DE038');
  assert.equal(r.confidence, 'fuzzy');
});

test('multiple confusions within threshold still match', () => {
  const r = matchCandidates(['LO8-EN00I'], sets); // 8->B, I->1  => distance 1.0
  assert.equal(r.set.set_code, 'LOB-EN001');
  assert.equal(r.confidence, 'fuzzy');
});

test('best candidate is chosen when several are given', () => {
  const r = matchCandidates(['ZZZZ-ZZ999', 'DOOD-DE038'], sets);
  assert.equal(r.set.set_code, 'DOOD-DE038');
  assert.equal(r.confidence, 'exact');
});

test('no plausible match => confidence none, set null', () => {
  const r = matchCandidates(['ZZZZ-ZZ999'], sets);
  assert.equal(r.set, null);
  assert.equal(r.confidence, 'none');
});

test('empty candidates or empty sets => none', () => {
  assert.equal(matchCandidates([], sets).confidence, 'none');
  assert.equal(matchCandidates(['LOB-EN001'], []).confidence, 'none');
});

// Spec D3 Task 8: the phone already resolved a printing (its own SetCodeMatch.kt saw the card's
// band text) and sends it alongside the scan (setCode/rarity/language) -- StagingArea uses
// phoneSelectedSet to take that AS THE PRESELECTION instead of matching scannedSetCandidates
// against `printings` a second time via matchCandidates() above. An older phone never sends
// setCode/rarity/language at all, so `setCode` is `undefined`/`null` for that scan and this
// returns `null` -- StagingArea's own fallback (matchCandidates, "genau wie heute") is what
// then runs, not this function.

test('phoneSelectedSet finds the real printing (real price/isYugipedia survive)', () => {
  const printings = [
    { set_code: 'DOOD-DE038', set_rarity: 'Secret Rare', set_price: 12.5, language: 'DE', isYugipedia: true },
    { set_code: 'LOB-EN001', set_rarity: 'Ultra Rare', set_price: 9.99, language: 'EN' },
  ];
  const r = phoneSelectedSet('DOOD-DE038', 'Secret Rare', 'DE', printings);
  assert.equal(r, printings[0]);
});

test('phoneSelectedSet is case/spacing tolerant, same normalize() as matchCandidates', () => {
  const printings = [{ set_code: 'dood-de038', set_rarity: 'secret rare', set_price: 1, language: 'de' }];
  const r = phoneSelectedSet('DOOD-DE038', 'Secret Rare', 'DE', printings);
  assert.equal(r, printings[0]);
});

test('phoneSelectedSet composes a placeholder (price 0) when the printing is not in the list yet', () => {
  // e.g. the phone read a DE code but the DE/JP fetch hasn't landed yet -- only EN printings so far.
  const enOnly = [{ set_code: 'LOB-EN001', set_rarity: 'Ultra Rare', set_price: 9.99, language: 'EN' }];
  const r = phoneSelectedSet('DOOD-DE038', 'Secret Rare', 'DE', enOnly);
  assert.deepEqual(r, { set_code: 'DOOD-DE038', set_rarity: 'Secret Rare', set_price: 0, language: 'DE' });
});

test('phoneSelectedSet returns null without a setCode (RED / old payload) -- nothing to preselect', () => {
  assert.equal(phoneSelectedSet(undefined, undefined, undefined, sets), null);
  assert.equal(phoneSelectedSet(null, null, null, sets), null);
});

test('mapPhoneConfidence maps the Ampel onto the exact/fuzzy/none vocabulary', () => {
  assert.equal(mapPhoneConfidence('green'), 'exact');
  assert.equal(mapPhoneConfidence('yellow'), 'fuzzy');
  assert.equal(mapPhoneConfidence('red'), 'none');
  assert.equal(mapPhoneConfidence(undefined), 'none');
});
