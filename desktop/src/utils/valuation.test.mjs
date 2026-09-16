import assert from 'node:assert';
import fs from 'node:fs';
import { CONDITIONS, EDITIONS, EDITION_LABELS, conditionFactor, unitPrice, valueOf, firstEdLine, groupCopies } from './valuation.js';

// Spec G4 §6/§7 — ZWILLING: desktop/electron/valuation.test.cjs und android ValuationTest.kt lesen dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(new URL('../../../docs/fixtures/valuation/first-ed.json', import.meta.url), 'utf8'));

assert.deepStrictEqual(CONDITIONS, ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
assert.deepStrictEqual(EDITIONS, ['first', 'unlimited', 'limited', 'unknown']);
assert.equal(EDITION_LABELS.first, '1st Ed');
assert.equal(EDITION_LABELS.unknown, 'Unbek.');
assert.equal(conditionFactor('LP'), 0.5);
assert.equal(valueOf({ price: 4 }, [{ condition: 'NM' }, { condition: 'EX' }]), 7.4);

for (const c of FIX.unitPrice) assert.strictEqual(unitPrice(c.card, c.copy), c.unit, c.name);
for (const c of FIX.valueOf) assert.strictEqual(valueOf(c.card, c.copies), c.value, c.name);
// Intl setzt ein geschuetztes Leerzeichen vor das Euro-Zeichen; die Fixture schreibt ein normales.
for (const c of FIX.line) {
  const got = firstEdLine(c.card);
  assert.strictEqual(got == null ? null : got.replace(/ /g, ' '), c.line, c.name);
}

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
