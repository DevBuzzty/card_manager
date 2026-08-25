import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, confusionDistance, matchCandidates } from './setCodeMatch.js';

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
