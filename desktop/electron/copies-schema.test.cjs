const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema, backfillCopies, reconcileCopies } = require('./copies-schema.cjs');

// Minimal replica of the live cards/settings tables (4-col PK, as after the rarity migration).
function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, name TEXT, quantity INTEGER DEFAULT 1, rarity TEXT DEFAULT 'Unknown',
             set_code TEXT, price REAL, language TEXT DEFAULT 'DE', updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
             deleted INTEGER DEFAULT 0, PRIMARY KEY (id, set_code, language, rarity));
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  return db;
}
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
const card = (db) => db.prepare("SELECT quantity, deleted FROM cards WHERE id='1' AND set_code='LOB-DE001' AND language='DE' AND rarity='Ultra Rare'").get();

test('ensureCopiesSchema is idempotent and creates all columns', () => {
  const db = freshDb();
  ensureCopiesSchema(db); ensureCopiesSchema(db);
  const cc = cols(db, 'card_copies');
  for (const c of ['copy_id','card_id','set_code','language','rarity','edition','condition','created_at','updated_at','deleted',
                   'container_id','page','slot','tags','note','needs_review','review_reason','for_sale']) assert.ok(cc.includes(c), c);
  const ph = cols(db, 'price_history');
  for (const c of ['card_id','set_code','language','rarity','variant','day','price','source','recorded_at']) assert.ok(ph.includes(c), c);
  assert.ok(cols(db, 'cards').includes('price_first_ed'));
  assert.ok(cols(db, 'cards').includes('cm_first_ed_updated_at'));
  assert.ok(cols(db, 'portfolio_history').includes('sealed_value'));
});

test('triggers keep cards.quantity/deleted in step with live copies', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  db.exec("INSERT INTO cards (id, set_code, language, rarity, quantity, price) VALUES ('1','LOB-DE001','DE','Ultra Rare',0,5)");
  const ins = db.prepare("INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition) VALUES (?, '1','LOB-DE001','DE','Ultra Rare','unknown','NM')");
  ins.run('a'); ins.run('b');
  assert.deepStrictEqual(card(db), { quantity: 2, deleted: 0 });
  db.prepare("UPDATE card_copies SET deleted = 1 WHERE copy_id = 'a'").run();
  assert.deepStrictEqual(card(db), { quantity: 1, deleted: 0 });
  db.prepare("UPDATE card_copies SET deleted = 1 WHERE copy_id = 'b'").run();
  assert.deepStrictEqual(card(db), { quantity: 0, deleted: 1 }, 'zero copies tombstones the printing');
  db.prepare("UPDATE card_copies SET deleted = 0 WHERE copy_id = 'b'").run();
  assert.deepStrictEqual(card(db), { quantity: 1, deleted: 0 }, 'a revived copy revives the printing');
});

test('moving a copy to another printing recounts BOTH printings', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  db.exec("INSERT INTO cards (id, set_code, language, rarity, quantity) VALUES ('1','Unknown','DE','Unknown',0), ('1','LOB-DE001','DE','Ultra Rare',0)");
  db.exec("INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity) VALUES ('a','1','Unknown','DE','Unknown')");
  db.prepare("UPDATE card_copies SET set_code='LOB-DE001', rarity='Ultra Rare' WHERE copy_id='a'").run();
  assert.deepStrictEqual(db.prepare("SELECT quantity, deleted FROM cards WHERE set_code='Unknown'").get(), { quantity: 0, deleted: 1 });
  assert.deepStrictEqual(card(db), { quantity: 1, deleted: 0 });
});

test('recount triggers only touch cards on a real count/deleted change', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  db.exec("INSERT INTO cards (id, set_code, language, rarity, quantity, price) VALUES ('1','LOB-DE001','DE','Ultra Rare',0,5)");
  const ins = db.prepare("INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition) VALUES (?, '1','LOB-DE001','DE','Ultra Rare','unknown','NM')");
  ins.run('a');
  db.prepare("UPDATE cards SET updated_at = '2000-01-01 00:00:00' WHERE id='1' AND set_code='LOB-DE001' AND language='DE' AND rarity='Ultra Rare'").run();
  // Editing a copy's condition doesn't change the live count -> the recount UPDATE must be a no-op.
  db.prepare("UPDATE card_copies SET condition = 'GD' WHERE copy_id = 'a'").run();
  assert.equal(
    db.prepare("SELECT updated_at FROM cards WHERE id='1' AND set_code='LOB-DE001' AND language='DE' AND rarity='Ultra Rare'").get().updated_at,
    '2000-01-01 00:00:00',
    'cards.updated_at must not be re-stamped when quantity/deleted are unchanged',
  );
  // A real change (soft-delete) must still recount normally.
  db.prepare("UPDATE card_copies SET deleted = 1 WHERE copy_id = 'a'").run();
  assert.deepStrictEqual(card(db), { quantity: 0, deleted: 1 });
});

test('backfill creates quantity copies once, with defaults, and is guarded', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  db.exec(`INSERT INTO cards (id, set_code, language, rarity, quantity, deleted) VALUES
           ('1','LOB-DE001','DE','Ultra Rare',3,0), ('2','SDK-DE001','DE','Common',1,1), ('3','X-1','DE','Common',0,0)`);
  const first = backfillCopies(db);
  assert.deepStrictEqual(first, { created: 3, skipped: false });
  const rows = db.prepare("SELECT card_id, edition, condition, deleted FROM card_copies ORDER BY card_id").all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.card_id === '1' && r.edition === 'unknown' && r.condition === 'NM' && r.deleted === 0));
  assert.deepStrictEqual(card(db), { quantity: 3, deleted: 0 });
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='copies_migrated'").get().value, '1');
  const second = backfillCopies(db);
  assert.deepStrictEqual(second, { created: 0, skipped: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_copies').get().n, 3);
});

test('backfill skips (rather than double-counting) when card_copies already has rows', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  db.exec("INSERT INTO cards (id, set_code, language, rarity, quantity, deleted) VALUES ('1','LOB-DE001','DE','Ultra Rare',3,0)");
  db.prepare("INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition) VALUES ('pre-existing','1','LOB-DE001','DE','Ultra Rare','unknown','NM')").run();
  const result = backfillCopies(db);
  assert.deepStrictEqual(result, { created: 0, skipped: true, reason: 'copies_present' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_copies').get().n, 1, 'no new copies were created');
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='copies_migrated'").get().value, '1');
});

test('reconcile creates only the missing copies of a printing, once', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  // Two printings written by a pre-Spec-A build: one partially covered (qty 3, 1 copy),
  // one not covered at all (qty 2, no copies). A third is already consistent.
  db.exec(`INSERT INTO cards (id, set_code, language, rarity, quantity, deleted) VALUES
           ('1','LOB-DE001','DE','Ultra Rare',3,0), ('2','SDK-DE002','DE','Common',2,0), ('3','X-3','DE','Common',0,0)`);
  db.prepare("INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition) VALUES ('a','1','LOB-DE001','DE','Ultra Rare','first','GD')").run();
  db.prepare("UPDATE cards SET quantity = 3 WHERE id = '1'").run();   // the trigger recount is what a legacy writer overrode
  db.prepare("INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition) VALUES ('c','3','X-3','DE','Common','unknown','NM')").run();

  const first = reconcileCopies(db);
  assert.equal(first.created, 4, '2 missing on the partial printing + 2 on the uncovered one');
  assert.equal(first.printings, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM card_copies WHERE card_id='1' AND deleted=0").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM card_copies WHERE card_id='2' AND deleted=0").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM card_copies WHERE card_id='1' AND edition='first'").get().n, 1, 'the existing copy keeps its edition/condition');
  assert.equal(db.prepare("SELECT quantity FROM cards WHERE id='1'").get().quantity, 3, 'quantity ends up matching the copies');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM card_copies WHERE card_id='3'").get().n, 1, 'a consistent printing is untouched');

  const second = reconcileCopies(db);
  assert.deepStrictEqual(second, { created: 0, skipped: true }, 'guarded: never runs twice');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_copies').get().n, 6);
});
