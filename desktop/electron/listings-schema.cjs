// desktop/electron/listings-schema.cjs — Spec H3a §4.1. Gegenstueck zu supabase/listings_schema.sql.
// Zeitstempel-Trigger wie trg_sales_updated (sales-schema.cjs): ohne sie saehe der Push (updated_at > cursor) nichts.
// Keine Aenderung an card_copies.
const LISTING_COLS = ['listing_id', 'channel_id', 'channel_name', 'title', 'description', 'price', 'status', 'listed_on', 'sale_id',
  'external_url', 'note', 'created_at', 'updated_at', 'deleted'];
const LISTING_ITEM_COLS = ['listing_id', 'copy_id', 'card_id', 'set_code', 'language', 'rarity', 'edition', 'condition', 'name',
  'image_url', 'created_at', 'updated_at', 'deleted'];

function ensureListingsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      listing_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, channel_name TEXT NOT NULL, title TEXT, description TEXT,
      price REAL NOT NULL CHECK (price > 0),
      status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','verkauft','beendet')),
      listed_on TEXT NOT NULL, sale_id TEXT, external_url TEXT, note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS listing_items (
      listing_id TEXT NOT NULL, copy_id TEXT NOT NULL,
      card_id TEXT NOT NULL, set_code TEXT NOT NULL, language TEXT NOT NULL, rarity TEXT NOT NULL,
      edition TEXT NOT NULL, condition TEXT NOT NULL, name TEXT, image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (listing_id, copy_id));
    CREATE INDEX IF NOT EXISTS listings_updated_idx ON listings (updated_at);
    CREATE INDEX IF NOT EXISTS listing_items_updated_idx ON listing_items (updated_at);
    CREATE INDEX IF NOT EXISTS listing_items_copy_idx ON listing_items (copy_id);
    CREATE TRIGGER IF NOT EXISTS trg_listings_updated AFTER UPDATE ON listings FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE listings SET updated_at = CURRENT_TIMESTAMP WHERE listing_id = NEW.listing_id; END;
    CREATE TRIGGER IF NOT EXISTS trg_listing_items_updated AFTER UPDATE ON listing_items FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE listing_items SET updated_at = CURRENT_TIMESTAMP WHERE listing_id = NEW.listing_id AND copy_id = NEW.copy_id; END;
  `);
}

module.exports = { ensureListingsSchema, LISTING_COLS, LISTING_ITEM_COLS };
