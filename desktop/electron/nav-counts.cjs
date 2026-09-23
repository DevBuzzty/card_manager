// desktop/electron/nav-counts.cjs -- Spec I §3.1: Zaehler der Seitenleiste (offene Unbekannte,
// vorgemerkte Exemplare, laufende Angebote). Eigene Datei, damit ein SQLite-Test die Abfragen
// pruefen kann, ohne main.cjs (Electron-App) zu starten.
function navCounts(db) {
  const zahl = (sql) => { try { return db.prepare(sql).get().n | 0; } catch { return 0; } };
  return {
    unknown: zahl("SELECT COUNT(*) AS n FROM cards WHERE set_code = 'Unknown' AND deleted = 0"),
    forSale: zahl('SELECT COUNT(*) AS n FROM card_copies WHERE for_sale = 1 AND deleted = 0 AND sold_in IS NULL'),
    listingsOpen: zahl("SELECT COUNT(*) AS n FROM listings WHERE deleted = 0 AND status = 'aktiv'"),
  };
}

module.exports = { navCounts };
