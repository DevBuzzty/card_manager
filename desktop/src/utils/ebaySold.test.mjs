import assert from 'node:assert';
import fs from 'node:fs';
import test from 'node:test';
import { ebaySoldLine, ebaySoldCanCheck } from './ebaySold.js';

const FIX = JSON.parse(fs.readFileSync(new URL('../../../docs/fixtures/ebay/sold-line.json', import.meta.url), 'utf8'));
test('Fixture eBay-Zeile (Zwilling EbaySold.kt)', () => {
  for (const c of FIX.line) {
    // Intl setzt ein geschütztes Leerzeichen vor das Euro-Zeichen; die Fixture schreibt ein normales.
    assert.strictEqual(ebaySoldLine(c.access, c.row).replace(/ /g, ' '), c.line, c.name);
    assert.strictEqual(ebaySoldCanCheck(c.access), c.canCheck, c.name);
  }
});
