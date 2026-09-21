// desktop/electron/sales-schema.cjs — Spec H2 §4.1. Gegenstueck zu supabase/sales_schema.sql.
// Zeitstempel-Trigger wie trg_sealed_updated (sealed-items.cjs): ohne sie saehe der Push (updated_at > cursor) nichts.
const CHANNEL_COLS = ['channel_id', 'name', 'fee_percent', 'builtin', 'sort', 'created_at', 'updated_at', 'deleted'];
const SALE_COLS = ['sale_id', 'sold_on', 'channel_id', 'channel_name', 'gross', 'fees', 'shipping', 'status', 'note', 'created_at', 'updated_at', 'deleted'];
const ITEM_COLS = ['sale_id', 'copy_id', 'value_at_sale', 'share', 'was_for_sale', 'card_id', 'set_code', 'language', 'rarity',
  'edition', 'condition', 'name', 'image_url', 'created_at', 'updated_at', 'deleted'];
const BUILTIN = [['cardmarket', 'Cardmarket', 5, 1], ['ebay', 'eBay', 0, 2], ['kleinanzeigen', 'Kleinanzeigen', 0, 3], ['tausch', 'Tausch', 0, 4], ['privat', 'Privat', 0, 5]];

function ensureSalesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sale_channels (
      channel_id TEXT PRIMARY KEY, name TEXT NOT NULL,
      fee_percent REAL NOT NULL DEFAULT 0 CHECK (fee_percent >= 0 AND fee_percent <= 100),
      builtin INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sales (
      sale_id TEXT PRIMARY KEY, sold_on TEXT NOT NULL, channel_id TEXT NOT NULL, channel_name TEXT NOT NULL,
      gross REAL NOT NULL CHECK (gross >= 0), fees REAL CHECK (fees IS NULL OR fees >= 0),
      shipping REAL CHECK (shipping IS NULL OR shipping >= 0),
      status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','storniert')), note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sale_items (
      sale_id TEXT NOT NULL, copy_id TEXT NOT NULL, value_at_sale REAL NOT NULL DEFAULT 0, share REAL NOT NULL DEFAULT 0,
      was_for_sale INTEGER NOT NULL DEFAULT 0, card_id TEXT NOT NULL, set_code TEXT NOT NULL, language TEXT NOT NULL,
      rarity TEXT NOT NULL, edition TEXT NOT NULL, condition TEXT NOT NULL, name TEXT, image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (sale_id, copy_id));
    CREATE INDEX IF NOT EXISTS sale_channels_updated_idx ON sale_channels (updated_at);
    CREATE INDEX IF NOT EXISTS sales_updated_idx ON sales (updated_at);
    CREATE INDEX IF NOT EXISTS sale_items_updated_idx ON sale_items (updated_at);
    CREATE INDEX IF NOT EXISTS sale_items_copy_idx ON sale_items (copy_id);
    CREATE TRIGGER IF NOT EXISTS trg_sale_channels_updated AFTER UPDATE ON sale_channels FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE sale_channels SET updated_at = CURRENT_TIMESTAMP WHERE channel_id = NEW.channel_id; END;
    CREATE TRIGGER IF NOT EXISTS trg_sales_updated AFTER UPDATE ON sales FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE sales SET updated_at = CURRENT_TIMESTAMP WHERE sale_id = NEW.sale_id; END;
    CREATE TRIGGER IF NOT EXISTS trg_sale_items_updated AFTER UPDATE ON sale_items FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE sale_items SET updated_at = CURRENT_TIMESTAMP WHERE sale_id = NEW.sale_id AND copy_id = NEW.copy_id; END;
  `);
  const cols = db.prepare('PRAGMA table_info(card_copies)').all().map((c) => c.name);
  if (!cols.includes('sold_in')) db.exec('ALTER TABLE card_copies ADD COLUMN sold_in TEXT');
  // Feste Kanaele mit altem Stempel: die Cloud legt dieselben Zeilen selbst an, ein Push waere ueberfluessig.
  const ins = db.prepare(`INSERT OR IGNORE INTO sale_channels (channel_id, name, fee_percent, builtin, sort, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, '1970-01-01 00:00:00', '1970-01-01 00:00:00')`);
  for (const [id, name, fee, sort] of BUILTIN) ins.run(id, name, fee, sort);
}

module.exports = { ensureSalesSchema, CHANNEL_COLS, SALE_COLS, ITEM_COLS };
