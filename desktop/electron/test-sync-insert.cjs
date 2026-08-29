const assert = require('assert');
const Database = require('better-sqlite3');
const { applyRemoteRow } = require('./sync.cjs');

const db = new Database(':memory:');
db.exec(`CREATE TABLE cards (
  id TEXT, name TEXT, type TEXT, desc TEXT, image_url TEXT, atk INTEGER, def INTEGER,
  level INTEGER, race TEXT, attribute TEXT, quantity INTEGER DEFAULT 1, rarity TEXT,
  set_code TEXT, price REAL, language TEXT DEFAULT 'DE', deleted INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, set_code, language)
)`);

// Existing local row -> only quantity+deleted change; details untouched.
db.prepare("INSERT INTO cards (id,set_code,language,name,quantity,deleted) VALUES ('111','A-DE001','DE','Local Name',1,0)").run();
applyRemoteRow(db, { id: '111', set_code: 'A-DE001', language: 'DE', name: 'REMOTE NAME', quantity: 5, deleted: false, updated_at: 'x' });
let row = db.prepare("SELECT name, quantity, deleted FROM cards WHERE id='111' AND set_code='A-DE001'").get();
assert.strictEqual(row.quantity, 5, 'existing row quantity updated');
assert.strictEqual(row.deleted, 0);
assert.strictEqual(row.name, 'Local Name', 'existing row detail NOT overwritten by pull');
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM cards').get().c, 1, 'no duplicate row inserted');

// Missing local row (phone-created printing) -> inserted with full data.
applyRemoteRow(db, { id: '222', set_code: 'B-DE009', language: 'DE', name: 'New Card', type: 'Effect Monster',
  image_url: 'http://img', atk: 1800, def: 1200, level: 4, race: 'Warrior', attribute: 'EARTH',
  quantity: 2, rarity: 'Common', price: 0.25, deleted: false, updated_at: 'y' });
const ins = db.prepare("SELECT * FROM cards WHERE id='222' AND set_code='B-DE009' AND language='DE'").get();
assert.ok(ins, 'missing row was inserted');
assert.strictEqual(ins.name, 'New Card'); assert.strictEqual(ins.atk, 1800);
assert.strictEqual(ins.quantity, 2); assert.strictEqual(ins.rarity, 'Common'); assert.strictEqual(ins.deleted, 0);

console.log('sync insert test: PASS');
