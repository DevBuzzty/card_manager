const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let db;

function initDatabase(userDataPath) {
    const configPath = path.join(userDataPath, 'config.json');
    let dbPath = path.join(userDataPath, 'cards.db');

    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.dbPath && fs.existsSync(config.dbPath)) {
                dbPath = config.dbPath;
            }
        }
    } catch (e) {
        console.error("Failed to load config:", e);
    }

    console.log("Using Database at:", dbPath);
    db = new Database(dbPath);

    // Schema Migration
    runMigrations();

    return db;
}

function getDb() {
    return db;
}

function runMigrations() {
    // 1. Cards Table
    db.exec(`
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT,
        name TEXT,
        type TEXT,
        desc TEXT,
        image_url TEXT,
        atk INTEGER,
        def INTEGER,
        level INTEGER,
        race TEXT,
        attribute TEXT,
        quantity INTEGER DEFAULT 1,
        rarity TEXT,
        set_code TEXT,
        price REAL,
        language TEXT DEFAULT 'DE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_updated DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted INTEGER DEFAULT 0,
        PRIMARY KEY (id, set_code, language)
      )
    `);

    // 2. Portfolio History
    db.exec(`
      CREATE TABLE IF NOT EXISTS portfolio_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total_value REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Settings
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // 4. Decks
    db.exec(`
      CREATE TABLE IF NOT EXISTS decks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS deck_cards (
        deck_id INTEGER,
        card_id TEXT,
        type TEXT,
        quantity INTEGER,
        PRIMARY KEY (deck_id, card_id, type),
        FOREIGN KEY(deck_id) REFERENCES decks(id)
      )
    `);

    // 5. Wishlist
    db.exec(`
      CREATE TABLE IF NOT EXISTS wishlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id TEXT,
        name TEXT,
        image_url TEXT,
        price REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. API Cache (New)
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_cache (
        key TEXT PRIMARY KEY,
        data TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Deal-scraper: price-alert watches + the listings they surfaced.
    db.exec(`
      CREATE TABLE IF NOT EXISTS deal_watches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        max_price REAL NOT NULL,
        sources TEXT,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS deal_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        watch_id INTEGER,
        source TEXT,
        listing_id TEXT,
        title TEXT,
        price REAL,
        url TEXT,
        image_url TEXT,
        found_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        notified INTEGER DEFAULT 0,
        dismissed INTEGER DEFAULT 0,
        UNIQUE(source, listing_id)
      )
    `);

    // Check Columns / Migration Logic
    try {
        const columns = db.prepare("PRAGMA table_info(cards)").all();
        const columnNames = columns.map(c => c.name);

        // Ensure columns exist
        const required = ['atk', 'def', 'level', 'race', 'attribute', 'quantity', 'rarity', 'set_code', 'price', 'last_updated', 'language', 'updated_at', 'deleted'];
        required.forEach(col => {
            if (!columnNames.includes(col)) {
                let type = 'TEXT';
                if (['atk', 'def', 'level', 'quantity', 'deleted'].includes(col)) type = 'INTEGER';
                if (col === 'price') type = 'REAL';

                let defaultVal = '';
                if (col === 'language') defaultVal = " DEFAULT 'DE'";
                if (col === 'quantity') defaultVal = " DEFAULT 1";
                if (col === 'deleted') defaultVal = " DEFAULT 0";

                db.exec(`ALTER TABLE cards ADD COLUMN ${col} ${type}${defaultVal}`);
            }
        });

        // updated_at cannot be ALTER-added with a CURRENT_TIMESTAMP default (SQLite
        // rejects non-constant defaults), so it is added without a default and backfilled here.
        db.exec("UPDATE cards SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL");

        // PK Migration (id, set_code -> id, set_code, language)
        const pkColumns = columns.filter(c => c.pk > 0);
        const pkNames = pkColumns.map(c => c.name).sort().join(',');
        if (pkNames === 'id,set_code' || pkNames === 'id') {
            console.log("Migrating cards table to include LANGUAGE in PRIMARY KEY...");
            const transaction = db.transaction(() => {
                db.exec("ALTER TABLE cards RENAME TO cards_temp_v2");
                db.exec(`
                    CREATE TABLE cards (
                        id TEXT,
                        name TEXT,
                        type TEXT,
                        desc TEXT,
                        image_url TEXT,
                        atk INTEGER,
                        def INTEGER,
                        level INTEGER,
                        race TEXT,
                        attribute TEXT,
                        quantity INTEGER DEFAULT 1,
                        rarity TEXT,
                        set_code TEXT,
                        price REAL,
                        language TEXT DEFAULT 'DE',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        last_updated DATETIME,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        deleted INTEGER DEFAULT 0,
                        PRIMARY KEY (id, set_code, language)
                    )
                `);
                db.exec(`
                    INSERT INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity,
                        rarity, set_code, price, language, created_at, last_updated, updated_at, deleted)
                    SELECT id, name, type, desc, image_url, atk, def, level, race, attribute, quantity,
                        COALESCE(rarity, 'Unknown'), COALESCE(set_code, 'Unknown'), price, 'DE', created_at, last_updated,
                        COALESCE(updated_at, CURRENT_TIMESTAMP), COALESCE(deleted, 0)
                    FROM cards_temp_v2
                `);
                db.exec("DROP TABLE cards_temp_v2");
            });
            transaction();
            console.log("Migration complete.");
        }

        // PK Migration 2: (id, set_code, language) -> (id, set_code, language, rarity), so the SAME
        // set code held in two rarities (e.g. Secret Rare + Ultra Rare) are two distinct printings
        // with their own quantity and price, instead of collapsing into one.
        const pk2 = db.pragma("table_info(cards)").filter(c => c.pk > 0).map(c => c.name).sort().join(',');
        if (pk2 === 'id,language,set_code') {
            console.log("Migrating cards table to include RARITY in PRIMARY KEY...");
            const tx = db.transaction(() => {
                db.exec("ALTER TABLE cards RENAME TO cards_temp_v3");
                db.exec(`
                    CREATE TABLE cards (
                        id TEXT,
                        name TEXT,
                        type TEXT,
                        desc TEXT,
                        image_url TEXT,
                        atk INTEGER,
                        def INTEGER,
                        level INTEGER,
                        race TEXT,
                        attribute TEXT,
                        quantity INTEGER DEFAULT 1,
                        rarity TEXT DEFAULT 'Unknown',
                        set_code TEXT,
                        price REAL,
                        language TEXT DEFAULT 'DE',
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        last_updated DATETIME,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        deleted INTEGER DEFAULT 0,
                        PRIMARY KEY (id, set_code, language, rarity)
                    )
                `);
                db.exec(`
                    INSERT INTO cards (id, name, type, desc, image_url, atk, def, level, race, attribute, quantity,
                        rarity, set_code, price, language, created_at, last_updated, updated_at, deleted)
                    SELECT id, name, type, desc, image_url, atk, def, level, race, attribute, quantity,
                        COALESCE(rarity, 'Unknown'), COALESCE(set_code, 'Unknown'), price, COALESCE(language, 'DE'),
                        created_at, last_updated, COALESCE(updated_at, CURRENT_TIMESTAMP), COALESCE(deleted, 0)
                    FROM cards_temp_v3
                `);
                db.exec("DROP TABLE cards_temp_v3");
            });
            tx();
            console.log("Rarity PK migration complete.");
        }

        // Cardmarket price-lock columns: cm_url/cm_updated_at record the scraped listing,
        // price_locked lets the poller (and manual price entry) skip overwriting a locked price.
        const priceLockCols = { cm_url: 'TEXT', cm_updated_at: 'DATETIME', price_locked: 'INTEGER DEFAULT 0' };
        const existingCols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
        for (const [name, type] of Object.entries(priceLockCols)) {
            if (!existingCols.includes(name)) db.exec(`ALTER TABLE cards ADD COLUMN ${name} ${type}`);
        }
    } catch (e) {
        console.log("Migration check failed or not needed", e);
    }

    // Auto-stamp updated_at on any change so the sync layer can detect dirty rows
    // without touching every mutation site. The WHEN guard prevents recursion.
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_cards_updated AFTER UPDATE ON cards FOR EACH ROW
      WHEN NEW.updated_at = OLD.updated_at
      BEGIN
        UPDATE cards SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id AND set_code = NEW.set_code AND language = NEW.language;
      END;
    `);

    // Stamp updated_at on insert when the caller didn't set it, so new cards sync.
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_cards_inserted AFTER INSERT ON cards FOR EACH ROW
      WHEN NEW.updated_at IS NULL
      BEGIN
        UPDATE cards SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id AND set_code = NEW.set_code AND language = NEW.language;
      END;
    `);

    // Cleanup: remove zero/negative-quantity rows left over from the legacy
    // decrement-to-zero behavior. Idempotent — a no-op once the table is clean.
    try {
        const info = db.prepare("UPDATE cards SET deleted = 1 WHERE quantity <= 0 AND deleted = 0").run();
        if (info.changes > 0) console.log(`Quantity cleanup: tombstoned ${info.changes} zero-quantity row(s).`);
    } catch (e) {
        console.error("Quantity cleanup failed:", e);
    }
}

// Prepare commonly used statements
const statements = {
    insertCache: (key, data) => db.prepare("INSERT OR REPLACE INTO api_cache (key, data, timestamp) VALUES (?, ?, CURRENT_TIMESTAMP)"),
    getCache: (key) => db.prepare("SELECT data, timestamp FROM api_cache WHERE key = ?"),
    cleanCache: () => db.prepare("DELETE FROM api_cache WHERE timestamp < datetime('now', '-7 days')")
};

module.exports = { initDatabase, getDb, statements };
