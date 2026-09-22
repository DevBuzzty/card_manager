// desktop/electron/ebay-schema.cjs — Spec H3b1 §5.1/§6. Gegenstück zu supabase/ebay_schema.sql.
// ebay_listings ist ein NUR-LESE-Spiegel (Strom ohne Push, sync.cjs READ_ONLY_STREAMS): Zeitstempel bleiben der Cloud-Text,
// kein Auslöser, nie geschoben. listing_photos ist ein Strom in beide Richtungen wie listings (Auslöser wie trg_listings_updated).
const EBAY_LISTING_COLS = ['listing_id', 'environment', 'state', 'sku', 'offer_id', 'item_id', 'item_url', 'published_qty', 'synced_hash',
  'failed_hash', 'sold_seen', 'error', 'synced_at', 'created_at', 'updated_at'];
const LISTING_PHOTO_COLS = ['photo_id', 'listing_id', 'path', 'sort', 'created_at', 'updated_at', 'deleted'];

function ensureEbaySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ebay_listings (
      listing_id TEXT PRIMARY KEY, environment TEXT NOT NULL, state TEXT NOT NULL, sku TEXT, offer_id TEXT, item_id TEXT,
      item_url TEXT, published_qty INTEGER, synced_hash TEXT, failed_hash TEXT, sold_seen INTEGER, error TEXT, synced_at TEXT,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS listing_photos (
      photo_id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, path TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS listing_photos_updated_idx ON listing_photos (updated_at);
    CREATE INDEX IF NOT EXISTS listing_photos_listing_idx ON listing_photos (listing_id);
    CREATE TRIGGER IF NOT EXISTS trg_listing_photos_updated AFTER UPDATE ON listing_photos FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE listing_photos SET updated_at = CURRENT_TIMESTAMP WHERE photo_id = NEW.photo_id; END;
  `);
}

module.exports = { ensureEbaySchema, EBAY_LISTING_COLS, LISTING_PHOTO_COLS };
