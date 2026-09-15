// desktop/electron/sealed-items.cjs
// Spec G3 §4.1 — Sealed-Bestand lokal (SQLite). Gegenstueck zu supabase/sealed_items_schema.sql.
// Menge >= 1, darunter nur Soft-Delete (deleted = 1). Ein zweites Anlegen desselben lebenden Produkts
// erhoeht die Menge der vorhandenen Zeile. Wert, Veraltung, Art und Reihenfolge: sealed-value.cjs (Zwilling),
// Trend-Regel: sealed-prices.cjs (Zwilling). Der Sync (sync.cjs) schiebt die Aenderungen in die Cloud.
const crypto = require('crypto');
const { SEALED_KINDS, sealedValue, lineValue, isPriceStale, kindLabel, sortSealed } = require('./sealed-value.cjs');
const { pickSealedUpdates } = require('./sealed-prices.cjs');

// Erwartete, nutzersichtbare Fehler (deutsch). main.cjs reicht sie unveraendert durch, alles andere nicht.
class SealedError extends Error {}

const SEALED_COLS = ['sealed_id', 'cm_product_id', 'name', 'kind', 'quantity', 'price', 'price_updated_at', 'created_at', 'updated_at', 'deleted'];

function ensureSealedSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sealed_items (
      sealed_id        TEXT PRIMARY KEY,
      cm_product_id    INTEGER NOT NULL,
      name             TEXT NOT NULL,
      kind             TEXT NOT NULL CHECK (kind IN (${SEALED_KINDS.map((k) => `'${k}'`).join(',')})),
      quantity         INTEGER NOT NULL CHECK (quantity >= 1),
      price            REAL,
      price_updated_at DATETIME,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted          INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS sealed_items_updated_idx ON sealed_items (updated_at);
    CREATE INDEX IF NOT EXISTS sealed_items_product_idx ON sealed_items (cm_product_id, deleted);
  `);
  // Wie trg_containers_updated (containers-schema.cjs): stempelt updated_at bei jedem UPDATE, das es nicht
  // selbst setzt -- sonst saehe der Push (updated_at > cursor) die Aenderung nie.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_sealed_updated AFTER UPDATE ON sealed_items FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE sealed_items SET updated_at = CURRENT_TIMESTAMP WHERE sealed_id = NEW.sealed_id; END;
  `);
}

const liveRow = (db, sealedId) =>
  db.prepare('SELECT * FROM sealed_items WHERE sealed_id = ? AND deleted = 0').get(String(sealedId));

function requireQuantity(quantity) {
  const q = Number(quantity);
  if (!Number.isInteger(q) || q < 1) throw new SealedError('Die Menge muss mindestens 1 sein.');
  return q;
}

// Lebende Zeilen fuer die Liste, schon sortiert, mit Zeilensumme, Veraltung und Art-Bezeichnung.
function listSealed(db, nowMs = Date.now()) {
  const rows = db.prepare('SELECT * FROM sealed_items WHERE deleted = 0').all();
  const items = sortSealed(rows).map((r) => ({
    ...r,
    lineValue: lineValue(r),
    stale: r.price != null && isPriceStale(r.price_updated_at, nowMs),
    kindLabel: kindLabel(r.kind),
  }));
  return { items, sealedValue: sealedValue(rows) };
}

// product: { cm_product_id, name, kind, trend } aus der Produktliste (sealed-products.cjs).
// Gibt es das Produkt schon lebend, waechst die aelteste lebende Zeile; sonst neue Zeile mit Startpreis.
function addSealed(db, product, quantity) {
  const q = requireQuantity(quantity);
  if (!product) throw new SealedError('Produkt nicht in der Produktliste gefunden.');
  return db.transaction(() => {
    const live = db.prepare(`SELECT sealed_id FROM sealed_items WHERE cm_product_id = ? AND deleted = 0
      ORDER BY created_at, sealed_id LIMIT 1`).get(product.cm_product_id);
    if (live) {
      db.prepare('UPDATE sealed_items SET quantity = quantity + ? WHERE sealed_id = ?').run(q, live.sealed_id);
      return { sealed_id: live.sealed_id, merged: true };
    }
    const sealedId = crypto.randomUUID();
    const price = product.trend ?? null;
    db.prepare(`INSERT INTO sealed_items (sealed_id, cm_product_id, name, kind, quantity, price, price_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)`)
      .run(sealedId, product.cm_product_id, product.name, product.kind, q, price, price);
    return { sealed_id: sealedId, merged: false };
  })();
}

function setSealedQuantity(db, { sealed_id, quantity } = {}) {
  const q = requireQuantity(quantity);
  if (!liveRow(db, sealed_id)) throw new SealedError('Dieser Eintrag existiert nicht mehr.');
  db.prepare('UPDATE sealed_items SET quantity = ? WHERE sealed_id = ? AND quantity IS NOT ?').run(q, String(sealed_id), q);
}

// "Geoeffnet": Menge - 1; bei Menge 1 weich loeschen (die Oberflaeche fragt vorher, Spec G3 §4.1).
function openSealed(db, sealedId) {
  const row = liveRow(db, sealedId);
  if (!row) throw new SealedError('Dieser Eintrag existiert nicht mehr.');
  if (row.quantity > 1) {
    db.prepare('UPDATE sealed_items SET quantity = quantity - 1 WHERE sealed_id = ?').run(row.sealed_id);
    return { quantity: row.quantity - 1, deleted: false };
  }
  db.prepare('UPDATE sealed_items SET deleted = 1 WHERE sealed_id = ?').run(row.sealed_id);
  return { quantity: row.quantity, deleted: true };
}

function deleteSealed(db, sealedId) {
  if (!liveRow(db, sealedId)) throw new SealedError('Dieser Eintrag existiert nicht mehr.');
  db.prepare('UPDATE sealed_items SET deleted = 1 WHERE sealed_id = ?').run(String(sealedId));
}

// Bulk-Schritt C (Spec G3 §5): Trend auf alle lebenden Zeilen, nur Aenderungen schreiben.
// Der Trigger stempelt updated_at, damit der Sync die neuen Preise in die Cloud schiebt.
function applySealedPrices(db, priceGuides) {
  const rows = db.prepare('SELECT sealed_id, cm_product_id, price FROM sealed_items WHERE deleted = 0').all();
  const updates = pickSealedUpdates(rows, priceGuides);
  const upd = db.prepare('UPDATE sealed_items SET price = ?, price_updated_at = CURRENT_TIMESTAMP WHERE sealed_id = ?');
  db.transaction(() => { for (const u of updates) upd.run(u.price, u.sealed_id); })();
  return updates.length;
}

module.exports = {
  SealedError, SEALED_COLS, ensureSealedSchema, listSealed, addSealed, setSealedQuantity, openSealed, deleteSealed,
  applySealedPrices,
};
