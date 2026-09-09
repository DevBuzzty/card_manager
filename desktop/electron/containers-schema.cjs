// Behaelter (Binder, Box, Deckbox) und der Standort eines Exemplars darin.
//
// Die fuenf Standortspalten an card_copies (container_id, page, slot, tags, note) legt bereits
// copies-schema.cjs an -- der Spec-A-Plan hat die spec-uebergreifenden Spalten vorgezogen. Hier
// fehlt nur noch der Index darauf.
//
// KEIN Fremdschluessel von card_copies auf containers: der Sync zieht beide Stroeme getrennt, und
// ein Exemplar darf waehrend eines Zyklus kurz auf einen noch nicht angekommenen Behaelter zeigen.
// Die Aufraeumpflicht traegt clearContainerLocations() unten -- es gibt ZWEI Wege, auf denen ein
// Behaelter lokal geloescht wird (deleteContainer hier lokal, applyRemoteContainer in sync.cjs per
// Pull), und beide rufen denselben Helfer.

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
  // Analog zu trg_copies_updated (copies-schema.cjs): stempelt updated_at bei jedem UPDATE neu,
  // das es nicht schon selbst setzt. saveContainer/deleteContainer setzen es heute von Hand --
  // dieser Trigger ist das Sicherheitsnetz fuer den naechsten Schreiber, der es vergisst, sonst
  // entstuende eine Aenderung, die der Sync (er zieht ueber `updated_at > cursor`) nie abholt.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_containers_updated AFTER UPDATE ON containers FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE containers SET updated_at = CURRENT_TIMESTAMP WHERE container_id = NEW.container_id; END;
  `);
}

/**
 * Setzt Behaelter, Seite und Fach aller Exemplare zurueck, die auf diesen Behaelter zeigen.
 * Gemeinsamer Kern von deleteContainer (lokales Loeschen) und applyRemoteContainer in sync.cjs
 * (ein Behaelter kommt per Pull bereits geloescht herunter, weil ein anderes Geraet ihn geloescht
 * hat) -- beide Wege muessen dieselbe Regel anwenden, sonst bleibt ein Exemplar auf einen
 * geloeschten Behaelter zeigend haengen: nicht im Behaelter, weil der weg ist, nicht in
 * "nicht einsortiert", weil container_id nicht NULL ist -- es zaehlt nirgends mehr.
 *
 * @returns Anzahl der Exemplare, deren Standort geraeumt wurde.
 */
function clearContainerLocations(db, containerId) {
  return db.prepare(`
    UPDATE card_copies
       SET container_id = NULL, page = NULL, slot = NULL,
           updated_at = CURRENT_TIMESTAMP
     WHERE container_id = ?`).run(containerId).changes;
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
    const changes = clearContainerLocations(db, containerId);
    db.prepare(`
      UPDATE containers
         SET deleted = 1, updated_at = CURRENT_TIMESTAMP
       WHERE container_id = ?`).run(containerId);
    return changes;
  })();
}

module.exports = { ensureContainersSchema, deleteContainer, clearContainerLocations, CONTAINER_COLS };
