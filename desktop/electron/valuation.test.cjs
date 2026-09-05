const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { CONDITIONS, EDITIONS, conditionFactor, valueOf, factorCaseSql, totalValue, copyCount } = require('./valuation.cjs');

test('condition codes and factors', () => {
  assert.deepStrictEqual(CONDITIONS, ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
  assert.deepStrictEqual(EDITIONS, ['first', 'unlimited', 'limited', 'unknown']);
  assert.equal(conditionFactor('NM'), 1);
  assert.equal(conditionFactor('GD'), 0.7);
  assert.equal(conditionFactor(''), 1, 'blank condition counts as NM');
  assert.equal(conditionFactor('XX'), 1, 'unknown code counts as NM');
});

test('valueOf sums price × factor over copies (count optional)', () => {
  assert.equal(valueOf(10, [{ condition: 'NM' }, { condition: 'GD' }]), 17);
  assert.equal(valueOf(10, [{ condition: 'NM', count: 2 }, { condition: 'PO', count: 1 }]), 22);
  assert.equal(valueOf(null, [{ condition: 'NM' }]), 0);
  assert.equal(valueOf(10, []), 0);
});

test('factorCaseSql + totalValue/copyCount against a tiny db', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT, rarity TEXT, price REAL, deleted INTEGER DEFAULT 0);
           CREATE TABLE card_copies (copy_id TEXT PRIMARY KEY, card_id TEXT, set_code TEXT, language TEXT, rarity TEXT, condition TEXT, deleted INTEGER DEFAULT 0);`);
  db.exec(`INSERT INTO cards VALUES ('1','LOB-DE001','DE','Ultra Rare',10,0);
           INSERT INTO card_copies VALUES ('a','1','LOB-DE001','DE','Ultra Rare','NM',0);
           INSERT INTO card_copies VALUES ('b','1','LOB-DE001','DE','Ultra Rare','GD',0);
           INSERT INTO card_copies VALUES ('c','1','LOB-DE001','DE','Ultra Rare','NM',1);`);
  assert.match(factorCaseSql('cp.condition'), /CASE cp\.condition WHEN 'MT' THEN 1/);
  assert.equal(totalValue(db), 17);
  assert.equal(copyCount(db), 2);
});
