const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { addCopies } = require('./copies.cjs');
const { collectionSql, parseImportCsv } = require('./collection-query.cjs');

test('collectionSql yields value/factor_sum/nonstandard/conditions/editions', () => {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, name TEXT, quantity INTEGER DEFAULT 1, rarity TEXT DEFAULT 'Unknown', set_code TEXT, price REAL,
            language TEXT DEFAULT 'DE', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d);
  d.exec("INSERT INTO cards (id, set_code, language, rarity, quantity, price) VALUES ('1','LOB-DE001','DE','Ultra Rare',0,10)");
  const P = { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' };
  addCopies(d, P, { edition: 'unknown', condition: 'NM', count: 2 });
  addCopies(d, P, { edition: 'first', condition: 'GD', count: 1 });
  const rows = d.prepare(collectionSql()).all({ def_condition: 'NM', def_edition: 'unknown' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 3);
  assert.ok(Math.abs(rows[0].factor_sum - 2.7) < 1e-9);
  assert.equal(rows[0].value, 27);
  assert.equal(rows[0].nonstandard, 1);
  assert.deepStrictEqual(rows[0].conditions.split(',').sort(), ['GD', 'NM']);
  assert.deepStrictEqual(rows[0].editions.split(',').sort(), ['first', 'unknown']);
});

test('parseImportCsv: legacy column-2 passcodes and optional edition/condition headers', () => {
  assert.deepStrictEqual(parseImportCsv('name;passcode\nBlue;89631139\nBad;abc\n'), [{ passcode: '89631139' }]);
  assert.deepStrictEqual(parseImportCsv('Passcode,Edition,Condition\n46986414,first,gd\n12345678,weird,ZZ\n'),
    [{ passcode: '46986414', edition: 'first', condition: 'GD' }, { passcode: '12345678' }]);
  assert.deepStrictEqual(parseImportCsv(''), []);
});
