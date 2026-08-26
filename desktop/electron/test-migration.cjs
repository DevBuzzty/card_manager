const assert = require('assert');
const Database = require('better-sqlite3');

// Simulates a legacy DB: cards table WITHOUT updated_at/deleted, exactly like a
// pre-existing installation would look before this migration runs.
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE',
    quantity INTEGER DEFAULT 1,
    PRIMARY KEY (id, set_code, language)
  );
`);

db.prepare("INSERT INTO cards (id, set_code, language, quantity) VALUES ('1','A','DE',1)").run();

// SQLite rejects a non-constant default (CURRENT_TIMESTAMP) on ALTER TABLE ADD COLUMN.
// This documents why database.cjs must NOT do this.
assert.throws(
    () => db.exec("ALTER TABLE cards ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP"),
    /Cannot add a column with non-constant default/,
    'ALTER TABLE ADD COLUMN with CURRENT_TIMESTAMP default must throw'
);

// The correct, additive way: add updated_at with NO default, deleted with a constant default (0 is fine).
db.exec("ALTER TABLE cards ADD COLUMN updated_at DATETIME");
db.exec("ALTER TABLE cards ADD COLUMN deleted INTEGER DEFAULT 0");

// Backfill existing rows, since the ALTER above leaves updated_at NULL for them.
db.exec("UPDATE cards SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL");
const backfilled = db.prepare("SELECT updated_at FROM cards WHERE id='1'").get().updated_at;
assert.ok(backfilled, 'backfill stamps updated_at for pre-existing rows after ALTER');

// Mirror of the trigger pair added in database.cjs.
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_cards_updated AFTER UPDATE ON cards FOR EACH ROW
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN
    UPDATE cards SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id AND set_code = NEW.set_code AND language = NEW.language;
  END;
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS trg_cards_inserted AFTER INSERT ON cards FOR EACH ROW
  WHEN NEW.updated_at IS NULL
  BEGIN
    UPDATE cards SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id AND set_code = NEW.set_code AND language = NEW.language;
  END;
`);

// New rows inserted without updated_at (the normal app insert path) must get stamped by the AFTER INSERT trigger.
db.prepare("INSERT INTO cards (id, set_code, language, quantity) VALUES ('2','B','DE',1)").run();
const inserted = db.prepare("SELECT updated_at FROM cards WHERE id='2'").get().updated_at;
assert.ok(inserted, 'AFTER INSERT trigger stamps updated_at for new rows that did not set it');

// Force a stale timestamp, then mutate quantity; the AFTER UPDATE trigger must bump updated_at.
db.prepare("UPDATE cards SET updated_at = datetime('now','-1 day') WHERE id='1'").run();
const stale = db.prepare("SELECT updated_at FROM cards WHERE id='1'").get().updated_at;
db.prepare("UPDATE cards SET quantity = 5 WHERE id='1'").run();
const after = db.prepare("SELECT updated_at, quantity FROM cards WHERE id='1'").get();
assert.strictEqual(after.quantity, 5);
assert.ok(after.updated_at > stale, 'trigger bumped updated_at on quantity change');

console.log('migration trigger test: PASS');
