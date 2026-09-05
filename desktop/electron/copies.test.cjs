const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const C = require('./copies.cjs');

const P = { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' };
const U = { id: '1', set_code: 'Unknown', language: 'DE', rarity: 'Unknown' };
function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER DEFAULT 1, rarity TEXT DEFAULT 'Unknown', set_code TEXT, price REAL,
            language TEXT DEFAULT 'DE', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, deleted INTEGER DEFAULT 0,
            PRIMARY KEY (id, set_code, language, rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
          CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL);`);
  ensureCopiesSchema(d);
  d.exec("INSERT INTO cards (id, set_code, language, rarity, quantity, price) VALUES ('1','LOB-DE001','DE','Ultra Rare',0,10), ('1','Unknown','DE','Unknown',0,0)");
  return d;
}
const qty = (d, p) => d.prepare('SELECT quantity, deleted FROM cards WHERE id=? AND set_code=? AND language=? AND rarity=?').get(p.id, p.set_code, p.language, p.rarity);

test('defaults come from settings with fallbacks', () => {
  const d = db();
  assert.deepStrictEqual(C.defaults(d), { edition: 'unknown', condition: 'NM' });
  d.exec("INSERT INTO settings VALUES ('default_edition','first'), ('default_condition','EX')");
  assert.deepStrictEqual(C.defaults(d), { edition: 'first', condition: 'EX' });
});

test('addCopies creates rows and the trigger counts them', () => {
  const d = db();
  const ids = C.addCopies(d, P, { edition: 'first', condition: 'NM', count: 2 });
  assert.equal(ids.length, 2);
  assert.deepStrictEqual(qty(d, P), { quantity: 2, deleted: 0 });
  assert.deepStrictEqual(C.groupCopies(C.listCopies(d, P)), [{ edition: 'first', condition: 'NM', count: 2 }]);
});

test('removeCopies removes from the named group, or standard-first without one', () => {
  const d = db();
  C.addCopies(d, P, { edition: 'unknown', condition: 'NM', count: 2 });   // standard
  C.addCopies(d, P, { edition: 'first', condition: 'GD', count: 1 });     // rare one
  assert.equal(C.removeCopies(d, P, { edition: 'first', condition: 'GD' }), 1);
  assert.deepStrictEqual(C.groupCopies(C.listCopies(d, P)), [{ edition: 'unknown', condition: 'NM', count: 2 }]);
  C.addCopies(d, P, { edition: 'first', condition: 'GD', count: 1 });
  assert.equal(C.removeCopies(d, P, {}), 1, 'no group -> standard-first');
  assert.deepStrictEqual(C.groupCopies(C.listCopies(d, P)), [
    { edition: 'first', condition: 'GD', count: 1 }, { edition: 'unknown', condition: 'NM', count: 1 }]);
  assert.equal(C.removeCopies(d, P, { count: 5 }), 2, 'never removes more than exist');
  assert.deepStrictEqual(qty(d, P), { quantity: 0, deleted: 1 });
});

test('moveCopies re-points copies and both printings recount', () => {
  const d = db();
  C.addCopies(d, U, { edition: 'unknown', condition: 'PL', count: 2 });
  assert.equal(C.moveCopies(d, U, P), 2);
  assert.deepStrictEqual(qty(d, U), { quantity: 0, deleted: 1 });
  assert.deepStrictEqual(qty(d, P), { quantity: 2, deleted: 0 });
  assert.deepStrictEqual(C.groupCopies(C.listCopies(d, P)), [{ edition: 'unknown', condition: 'PL', count: 2 }], 'condition preserved');
});

test('updateCopyGroup and softDeletePrinting', () => {
  const d = db();
  C.addCopies(d, P, { edition: 'unknown', condition: 'NM', count: 3 });
  assert.equal(C.updateCopyGroup(d, P, { edition: 'unknown', condition: 'NM' }, { edition: 'first', condition: 'EX' }), 3);
  assert.deepStrictEqual(C.groupCopies(C.listCopies(d, P)), [{ edition: 'first', condition: 'EX', count: 3 }]);
  C.softDeletePrinting(d, P);
  assert.deepStrictEqual(qty(d, P), { quantity: 0, deleted: 1 });
  assert.equal(C.listCopies(d, P).length, 0);
});
