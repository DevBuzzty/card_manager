const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { CONDITIONS, EDITIONS, conditionFactor, unitPrice, valueOf, factorCaseSql, unitPriceCaseSql, totalValue, copyCount } = require('./valuation.cjs');

// Spec G4 §6 — ZWILLING: desktop/src/utils/valuation.test.mjs und android ValuationTest.kt lesen dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'valuation', 'first-ed.json'), 'utf8'));

test('condition codes and factors', () => {
  assert.deepStrictEqual(CONDITIONS, ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
  assert.deepStrictEqual(EDITIONS, ['first', 'unlimited', 'limited', 'unknown']);
  assert.equal(conditionFactor('NM'), 1);
  assert.equal(conditionFactor('GD'), 0.7);
  assert.equal(conditionFactor(''), 1, 'blank condition counts as NM');
  assert.equal(conditionFactor('XX'), 1, 'unknown code counts as NM');
});

test('valueOf sums unit price × factor over copies (count optional)', () => {
  assert.equal(valueOf({ price: 10 }, [{ condition: 'NM' }, { condition: 'GD' }]), 17);
  assert.equal(valueOf({ price: 10 }, [{ condition: 'NM', count: 2 }, { condition: 'PO', count: 1 }]), 22);
  assert.equal(valueOf({ price: null }, [{ condition: 'NM' }]), 0);
  assert.equal(valueOf({ price: 10 }, []), 0);
  assert.equal(valueOf(undefined, [{ condition: 'NM' }]), 0, 'fehlende Karte zählt 0');
});

test('Fixture: unitPrice', () => {
  for (const c of FIX.unitPrice) assert.strictEqual(unitPrice(c.card, c.copy), c.unit, c.name);
});

test('Fixture: valueOf', () => {
  for (const c of FIX.valueOf) assert.strictEqual(valueOf(c.card, c.copies), c.value, c.name);
});

test('unitPriceCaseSql entspricht der Spec wörtlich', () => {
  assert.equal(unitPriceCaseSql('c', 'cp'),
    "CASE WHEN cp.edition = 'first' AND c.price_first_ed IS NOT NULL THEN c.price_first_ed ELSE COALESCE(c.price, 0) END");
});

function tinyDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT, rarity TEXT, price REAL, price_first_ed REAL, deleted INTEGER DEFAULT 0);
           CREATE TABLE card_copies (copy_id TEXT PRIMARY KEY, card_id TEXT, set_code TEXT, language TEXT, rarity TEXT,
             edition TEXT DEFAULT 'unknown', condition TEXT, deleted INTEGER DEFAULT 0);`);
  return db;
}

test('factorCaseSql + totalValue/copyCount against a tiny db', () => {
  const db = tinyDb();
  db.exec(`INSERT INTO cards VALUES ('1','LOB-DE001','DE','Ultra Rare',10,NULL,0);
           INSERT INTO card_copies VALUES ('a','1','LOB-DE001','DE','Ultra Rare','unknown','NM',0);
           INSERT INTO card_copies VALUES ('b','1','LOB-DE001','DE','Ultra Rare','unknown','GD',0);
           INSERT INTO card_copies VALUES ('c','1','LOB-DE001','DE','Ultra Rare','unknown','NM',1);`);
  assert.match(factorCaseSql('cp.condition'), /CASE cp\.condition WHEN 'MT' THEN 1/);
  assert.equal(totalValue(db), 17);
  assert.equal(copyCount(db), 2);
});

test('Fixture: totalValue (SQL-Fassung)', () => {
  for (const c of FIX.valueOf) {
    const db = tinyDb();
    db.prepare("INSERT INTO cards VALUES ('1','MAMO-DE020','DE','Ultra Rare',?,?,0)").run(c.card.price, c.card.price_first_ed);
    const ins = db.prepare("INSERT INTO card_copies VALUES (?,'1','MAMO-DE020','DE','Ultra Rare',?,?,0)");
    let n = 0;
    for (const cp of c.copies) for (let i = 0; i < (cp.count || 1); i++) ins.run(`k${n++}`, cp.edition, cp.condition);
    assert.strictEqual(totalValue(db), c.value, c.name);
  }
});
