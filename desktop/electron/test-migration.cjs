const assert = require('assert');
const Database = require('better-sqlite3');

// Mirror of the trigger + columns we add in database.cjs, exercised on an in-memory DB.
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE',
    quantity INTEGER DEFAULT 1, deleted INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code, language)
  );
  CREATE TRIGGER IF NOT EXISTS trg_cards_updated AFTER UPDATE ON cards FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN
    UPDATE cards SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id AND set_code = NEW.set_code AND language = NEW.language;
  END;
`);

db.prepare("INSERT INTO cards (id, set_code, language, quantity) VALUES ('1','A','DE',1)").run();
const before = db.prepare("SELECT updated_at FROM cards WHERE id='1'").get().updated_at;
assert.ok(before, 'insert stamps updated_at via column default');

// Force a later timestamp, then mutate quantity; trigger must bump updated_at.
db.prepare("UPDATE cards SET updated_at = datetime('now','-1 day') WHERE id='1'").run();
const stale = db.prepare("SELECT updated_at FROM cards WHERE id='1'").get().updated_at;
db.prepare("UPDATE cards SET quantity = 5 WHERE id='1'").run();
const after = db.prepare("SELECT updated_at, quantity FROM cards WHERE id='1'").get();
assert.strictEqual(after.quantity, 5);
assert.ok(after.updated_at > stale, 'trigger bumped updated_at on quantity change');

console.log('migration trigger test: PASS');
