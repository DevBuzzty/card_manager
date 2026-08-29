const assert = require('assert');
const Database = require('better-sqlite3');

const db = new Database(':memory:');
db.exec(`CREATE TABLE cards (
  id TEXT, name TEXT, type TEXT, desc TEXT, image_url TEXT, atk INTEGER, def INTEGER,
  level INTEGER, race TEXT, attribute TEXT, quantity INTEGER DEFAULT 1, rarity TEXT,
  set_code TEXT, price REAL, language TEXT DEFAULT 'DE', deleted INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, set_code, language)
)`);

db.prepare("INSERT INTO cards (id,set_code,language,name,quantity,deleted) VALUES ('900','Unknown','DE','Foo',3,0)").run();

const newRarity = 'Common', newSetCode = 'X-DE001', newPrice = 0.5, unknownId = '900';

db.prepare(`INSERT OR IGNORE INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, set_code, price, language, deleted)
  SELECT id, name, type, desc, image_url, atk, def, level, race, attribute, quantity, ?, ?, ?, language, 0
  FROM cards WHERE id = ? AND set_code = 'Unknown'`).run(newRarity, newSetCode, newPrice, unknownId);
db.prepare("UPDATE cards SET deleted = 1, quantity = 0 WHERE id = ? AND set_code = 'Unknown'").run(unknownId);

const oldRow = db.prepare("SELECT deleted, quantity FROM cards WHERE id='900' AND set_code='Unknown' AND language='DE'").get();
assert.ok(oldRow, 'old row still exists (tombstoned, not deleted)');
assert.strictEqual(oldRow.deleted, 1, 'old row tombstoned');
assert.strictEqual(oldRow.quantity, 0, 'old row quantity zeroed');

const newRow = db.prepare("SELECT deleted, quantity, name, rarity FROM cards WHERE id='900' AND set_code='X-DE001' AND language='DE'").get();
assert.ok(newRow, 'new row was inserted');
assert.strictEqual(newRow.deleted, 0, 'new row not deleted');
assert.strictEqual(newRow.quantity, 3, 'new row carries over old quantity');
assert.strictEqual(newRow.name, 'Foo', 'new row carries over old name');
assert.strictEqual(newRow.rarity, 'Common', 'new row has new rarity');

console.log('consolidation rename test: PASS');
