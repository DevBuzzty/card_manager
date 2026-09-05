import assert from 'node:assert';
import { CONDITIONS, EDITIONS, EDITION_LABELS, conditionFactor, valueOf, groupCopies } from './valuation.js';

assert.deepStrictEqual(CONDITIONS, ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
assert.deepStrictEqual(EDITIONS, ['first', 'unlimited', 'limited', 'unknown']);
assert.equal(EDITION_LABELS.first, '1st Ed');
assert.equal(EDITION_LABELS.unknown, 'Unbek.');
assert.equal(conditionFactor('LP'), 0.5);
assert.equal(valueOf(4, [{ condition: 'NM' }, { condition: 'EX' }]), 7.4);

const groups = groupCopies([
  { copy_id: 'a', edition: 'unknown', condition: 'NM' },
  { copy_id: 'b', edition: 'first', condition: 'GD' },
  { copy_id: 'c', edition: 'unknown', condition: 'NM' },
]);
assert.deepStrictEqual(groups, [
  { edition: 'first', condition: 'GD', count: 1 },
  { edition: 'unknown', condition: 'NM', count: 2 },
]);
console.log('valuation renderer test: PASS');
