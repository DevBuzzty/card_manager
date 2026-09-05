const crypto = require('crypto');

function getSetting(db, key) {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; }
  catch { return null; }
}
function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value')
    .run({ key, value: String(value) });
}
function addColumnIfMissing(db, table, name, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
}

// Recount SQL for ONE printing key; used by all three triggers. `pfx` is NEW or OLD.
const PRINTING_WHERE = (pfx) =>
  `card_id = ${pfx}.card_id AND set_code = ${pfx}.set_code AND language = ${pfx}.language AND rarity = ${pfx}.rarity AND deleted = 0`;
// The WHERE clause's change guard keeps this a no-op (no cards.updated_at re-stamp, no cloud
// push) when the recount would leave quantity/deleted unchanged — e.g. editing a copy's
// condition/edition without changing how many live copies the printing has.
const RECOUNT = (pfx) => `
  UPDATE cards SET
    quantity = (SELECT COUNT(*) FROM card_copies WHERE ${PRINTING_WHERE(pfx)}),
    deleted  = CASE WHEN (SELECT COUNT(*) FROM card_copies WHERE ${PRINTING_WHERE(pfx)}) = 0 THEN 1 ELSE 0 END
  WHERE id = ${pfx}.card_id AND set_code = ${pfx}.set_code AND language = ${pfx}.language AND rarity = ${pfx}.rarity
    AND (quantity IS NOT (SELECT COUNT(*) FROM card_copies WHERE ${PRINTING_WHERE(pfx)})
         OR deleted IS NOT CASE WHEN (SELECT COUNT(*) FROM card_copies WHERE ${PRINTING_WHERE(pfx)}) = 0 THEN 1 ELSE 0 END);`;

function ensureCopiesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_copies (
      copy_id    TEXT PRIMARY KEY,
      card_id    TEXT NOT NULL,
      set_code   TEXT NOT NULL,
      language   TEXT NOT NULL DEFAULT 'DE',
      rarity     TEXT NOT NULL DEFAULT 'Unknown',
      edition    TEXT NOT NULL DEFAULT 'unknown' CHECK (edition IN ('first','unlimited','limited','unknown')),
      condition  TEXT NOT NULL DEFAULT 'NM' CHECK (condition IN ('MT','NM','EX','GD','LP','PL','PO')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted    INTEGER NOT NULL DEFAULT 0,
      container_id TEXT, page INTEGER, slot INTEGER, tags TEXT, note TEXT,
      needs_review INTEGER NOT NULL DEFAULT 0, review_reason TEXT,
      for_sale INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS card_copies_printing_idx ON card_copies (card_id, set_code, language, rarity);
    CREATE INDEX IF NOT EXISTS card_copies_updated_idx ON card_copies (updated_at);

    CREATE TABLE IF NOT EXISTS price_history (
      card_id TEXT NOT NULL, set_code TEXT NOT NULL, language TEXT NOT NULL, rarity TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'base',
      day TEXT NOT NULL,
      price REAL NOT NULL,
      source TEXT NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (card_id, set_code, language, rarity, variant, day)
    );
    CREATE INDEX IF NOT EXISTS price_history_recorded_idx ON price_history (recorded_at);

    CREATE TRIGGER IF NOT EXISTS trg_copies_updated AFTER UPDATE ON card_copies FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE card_copies SET updated_at = CURRENT_TIMESTAMP WHERE copy_id = NEW.copy_id; END;
  `);
  // The three recount triggers are dropped and recreated on every start (rather than relying on
  // CREATE TRIGGER IF NOT EXISTS) so an already-migrated database picks up RECOUNT's change guard
  // instead of keeping whatever definition it was created with.
  db.exec(`
    DROP TRIGGER IF EXISTS trg_copies_ins;
    DROP TRIGGER IF EXISTS trg_copies_upd;
    DROP TRIGGER IF EXISTS trg_copies_del;
    CREATE TRIGGER trg_copies_ins AFTER INSERT ON card_copies FOR EACH ROW
    BEGIN ${RECOUNT('NEW')} END;
    CREATE TRIGGER trg_copies_upd AFTER UPDATE ON card_copies FOR EACH ROW
    BEGIN ${RECOUNT('NEW')} ${RECOUNT('OLD')} END;
    CREATE TRIGGER trg_copies_del AFTER DELETE ON card_copies FOR EACH ROW
    BEGIN ${RECOUNT('OLD')} END;
  `);
  // Cross-spec columns pre-created now so A is the only PK/schema churn (overview doc).
  addColumnIfMissing(db, 'cards', 'price_first_ed', 'REAL');
  addColumnIfMissing(db, 'cards', 'cm_first_ed_updated_at', 'DATETIME');
  addColumnIfMissing(db, 'portfolio_history', 'sealed_value', 'REAL NOT NULL DEFAULT 0');
}

// One-time, desktop-only: `quantity` copies per live printing with the defaults. Guarded.
function backfillCopies(db) {
  if (getSetting(db, 'copies_migrated') === '1') return { created: 0, skipped: true };
  const rows = db.prepare('SELECT id, set_code, language, rarity, quantity FROM cards WHERE deleted = 0 AND quantity > 0').all();
  const ins = db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition, updated_at)
    VALUES (@copy_id, @card_id, @set_code, @language, @rarity, 'unknown', 'NM', CURRENT_TIMESTAMP)`);
  let created = 0;
  db.transaction(() => {
    for (const r of rows) {
      for (let i = 0; i < r.quantity; i++) {
        ins.run({ copy_id: crypto.randomUUID(), card_id: String(r.id), set_code: r.set_code, language: r.language || 'DE', rarity: r.rarity || 'Unknown' });
        created++;
      }
    }
    setSetting(db, 'copies_migrated', '1');
  })();
  return { created, skipped: false };
}

module.exports = { ensureCopiesSchema, backfillCopies };
