// Behaelter (Binder, Box, Deckbox) und der Standort eines Exemplars darin.
//
// Die fuenf Standortspalten an card_copies (container_id, page, slot, tags, note) legt bereits
// copies-schema.cjs an -- der Spec-A-Plan hat die spec-uebergreifenden Spalten vorgezogen. Hier
// fehlt nur noch der Index darauf.
//
// KEIN Fremdschluessel von card_copies auf containers: der Sync zieht beide Stroeme getrennt, und
// ein Exemplar darf waehrend eines Zyklus kurz auf einen noch nicht angekommenen Behaelter zeigen.
// Die Aufraeumpflicht traegt stattdessen deleteContainer.

const CONTAINER_COLS = [
  'container_id', 'name', 'kind', 'pockets_per_page', 'color',
  'sort_order', 'created_at', 'updated_at', 'deleted',
];

function ensureContainersSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS containers (
      container_id     TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      kind             TEXT NOT NULL CHECK (kind IN ('binder','box','deckbox')),
      pockets_per_page INTEGER,
      color            TEXT,
      sort_order       INTEGER NOT NULL DEFAULT 0,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted          INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS card_copies_location_idx
      ON card_copies (container_id, page, slot);
  `);
}

/**
 * Loescht einen Behaelter weich UND setzt die Standorte aller seiner Exemplare zurueck --
 * in EINER Transaktion, damit nie ein Exemplar auf einen geloeschten Behaelter zeigt.
 *
 * Beide Seiten bekommen ein frisches updated_at, sonst wuerde der Sync die Aenderung nie
 * abholen: er zieht ueber `updated_at > cursor`.
 *
 * @returns Anzahl der Exemplare, deren Standort geraeumt wurde.
 */
function deleteContainer(db, containerId) {
  return db.transaction(() => {
    const info = db.prepare(`
      UPDATE card_copies
         SET container_id = NULL, page = NULL, slot = NULL,
             updated_at = CURRENT_TIMESTAMP
       WHERE container_id = ?`).run(containerId);
    db.prepare(`
      UPDATE containers
         SET deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE container_id = ?`).run(containerId);
    return info.changes;
  })();
}

module.exports = { ensureContainersSchema, deleteContainer, CONTAINER_COLS };
