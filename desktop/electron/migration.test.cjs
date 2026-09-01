// desktop/electron/migration.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');

// Mirrors the add-missing-column pattern in database.cjs for the three new columns.
function addPriceLockColumns(db) {
  const cols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
  const adds = {
    cm_url: "ALTER TABLE cards ADD COLUMN cm_url TEXT",
    cm_updated_at: "ALTER TABLE cards ADD COLUMN cm_updated_at DATETIME",
    price_locked: "ALTER TABLE cards ADD COLUMN price_locked INTEGER DEFAULT 0",
  };
  for (const [name, sql] of Object.entries(adds)) if (!cols.includes(name)) db.exec(sql);
}

test('adds cm columns idempotently', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT, rarity TEXT, price REAL)");
  addPriceLockColumns(db);
  addPriceLockColumns(db); // second call must not throw
  const cols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
  assert.ok(cols.includes('cm_url'));
  assert.ok(cols.includes('cm_updated_at'));
  assert.ok(cols.includes('price_locked'));
});
