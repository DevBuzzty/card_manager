// desktop/electron/nav-counts.cjs -- Spec I §3.1: Zaehler der Seitenleiste (offene Unbekannte,
// vorgemerkte Exemplare, laufende Angebote). Eigene Datei, damit ein SQLite-Test die Abfragen
// pruefen kann, ohne main.cjs (Electron-App) zu starten.
function navCounts(db) {
  const zahl = (sql) => { try { return db.prepare(sql).get().n | 0; } catch { return 0; } };
  return {
    // Fixrunde 1 (Review Task 6, Info 4): als Karten zaehlen (COUNT DISTINCT id), nicht als Zeilen --
    // dieselbe Karte kann mehrfach unter 'Unknown' stehen (z.B. verschiedene Sprachen), soll aber
    // nur einmal als Kachel in Scannen erscheinen.
    unknown: zahl("SELECT COUNT(DISTINCT id) AS n FROM cards WHERE set_code = 'Unknown' AND deleted = 0"),
    // Fixrunde 1 (Review Task 6, Important): ein vorgemerktes Exemplar, das bereits in einem AKTIVEN
    // Angebot steckt, zaehlt hier nicht mehr mit -- sonst waere es gleichzeitig "vorgemerkt" (Verkaufen)
    // und Teil von listingsOpen, also doppelt im Abzeichen. Ein beendetes/verkauftes Angebot blockt
    // nicht (NOT EXISTS greift nur bei status = 'aktiv' UND listing_items.deleted = 0 UND listings.deleted = 0).
    forSale: zahl(`SELECT COUNT(*) AS n FROM card_copies cc
      WHERE cc.for_sale = 1 AND cc.deleted = 0 AND cc.sold_in IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM listing_items li JOIN listings l ON l.listing_id = li.listing_id
          WHERE li.copy_id = cc.copy_id AND li.deleted = 0 AND l.deleted = 0 AND l.status = 'aktiv'
        )`),
    listingsOpen: zahl("SELECT COUNT(*) AS n FROM listings WHERE deleted = 0 AND status = 'aktiv'"),
  };
}

module.exports = { navCounts };
