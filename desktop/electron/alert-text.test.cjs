const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { alertText, eur, signedPct } = require('./alert-text.cjs');

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/AlertTextTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'portfolio', 'alert-texts.json'), 'utf8'));

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    assert.equal(alertText(c.event), c.text);
  });
}

test('Beträge und Prozent', () => {
  assert.equal(eur(0), '0,00 €');
  assert.equal(eur(-3.5), '−3,50 €');
  assert.equal(signedPct(0), '+0,0 %');
  assert.equal(signedPct(-12.34), '−12,3 %');
});
