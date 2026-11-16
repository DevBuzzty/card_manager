# Ausgangsmessung Scraper ohne Pruefbox (Abnahme 1)

Stand: 16.11.2026 · nur lesend (Desktop-DB `readonly`, lokale `cardmarket/*.json`, `api_cache` -> `cardsets`), kein Netz.

## Methode

Messskript (Scratchpad, nicht eingecheckt) rechnet die Kandidaten selbst, wie es Task 2 (`resolveProduct` mit `candidates`) liefern wird:
`expansionIdsFor(setNames je Set-Praefix)` -> `singlesIndex.get(normName(Name))` gefiltert auf diese Expansionen.
Spanne = Trend (> 0) aller Kandidaten aus `price_guide_3.json`, mit `cm_lang_factor` (`applyLangFactor`).
Schwellenwert je Druck = `COALESCE(max der Spanne, price) >= 5`. Basis: Nicht-KR, `deleted=0`, `quantity>0`, `cm_product_id IS NULL`,
`set_code<>'Unknown'`, `price_locked != 2`. 1st-Ed: lebende `card_copies`-Kopie mit `edition='first'` (Join wie `firstEdCandidates`),
unabhaengig von `cm_product_id`; Spanne nur bei fehlender ID.

## Zahlen

- **a) Schaetzpreis moeglich / nicht:** 295 Nicht-KR-Drucke ohne ID: 289 `ambiguous` (alle mit Trend > 0 bei mindestens einem Kandidaten), 6 `no-candidate`, 0 `no-expansion`.
  Davon 180 `ambiguous` **ohne** Scrape-Preis (`cm_url IS NULL`) = 180 Drucke, die den Schaetzpreis bekaemen; 109 haben einen Scrape-Preis (siehe d).
  (Spec-Befund nannte 296 inkl. 2 `no-expansion`; jetzt 295, `no-expansion` entfaellt dank Set-Aliasen.)
- **b) Basis-Kandidaten (neue Regel): 50** (nur Spanne ab >= 5 EUR). Davon nur 4 mit eigenem `price >= 5`; 26 haben einen Scrape-Preis ohne ID (`cm_url` gesetzt).
  - nach Seltenheit: Common 18, Ultra Rare 12, Secret Rare 8, Starlight Rare 4, je 1: Collector's Rare, Rare, Ultimate Rare, Ghost Rare, Super Rare, Quarter Century Secret Rare, "New", "3"
  - nach Set: LAVD 20, RA05 14, LC01 4, LED8 3, BETB 3, BLGG 2, LOB 2, WISU 1, MP24 1
- **c) 1st-Ed-Kandidaten (neue Regel): 47** von 1332 (heute: 18-19 mit `price >= 5`, die uebrigen 28 kommen nur ueber die Spanne dazu).
  - nach Seltenheit: Common 17, Secret Rare 11, Ultra Rare 7, Starlight Rare 3, Super Rare 2, Prismatic Secret Rare 2, je 1: Collector's Rare, Ghost Rare, Quarter Century Secret Rare, "New", "3"
  - nach Set: LAVD 21, RA05 6, BLGG 5, DOOD 4, BETB 4, LED8 2, MP24 2, je 1: MAMO, MP23, ANGU
- **d) Scrape-Preis ohne ID (geschuetzt): 109** (alle `cm_url` nicht NULL, ohne ID).

## Haltepunkt

b) = 50, Schwelle "mehr als 50" **nicht ueberschritten** (Grenzfall, exakt am Richtwert). Weiterbauen ist nach Spec erlaubt.
Hinweis: 20 von 50 (LAVD) und 14 (RA05) kommen fast nur ueber teure Schwester-Versionen zustande (Commons mit Spanne bis ~100 EUR,
niedrigster Trend meist < 0,2 EUR). b und c ueberlappen weitgehend (Basis ~50 + 1st-Ed 47, zusammen ca. 70 verschiedene Drucke).
Die Eingrenzung der Spanne nach Seltenheit (Spec "Meine Entscheidungen") wuerde b und c fuer LAVD/RA05 deutlich senken.

## Abnahme nach Umsetzung (16.11.2026)

Methode (Ruling 4): Kopie der Desktop-DB (`cards.db`, 1,9 GB) plus `cardmarket/*.json` in ein Scratch-Verzeichnis, die fuenf neuen Spalten per
`ALTER TABLE` wie `priceLockCols`, dann echtes `runBulkRefresh(db, { userDataPath })` (Cache frisch, kein Download), danach Pruefung auf der Kopie.
Originale wurden nur gelesen. Branch `feat/scraper-ohne-pruefbox`.

### Schritt 1: Tests
- `electron/*.test.cjs` (unter Electron): 632 Tests, 632 gruen, 0 rot.
- `src/utils/*.test.js|mjs` (node): 386 Tests, 386 gruen, 0 rot.

### Abnahme 2: Schaetzpreis (bestanden)
- Bulk-Lauf: `estimated: 180`, `resolved 0`, `derived 0`, `priced 1`, `skipped 1`, `unchanged 3541`; Gruende `ambiguous 289`, `no-candidate 6`.
- 186 besessene Nicht-KR-Drucke ohne ID und ohne Scrape-Preis (`cm_url IS NULL`): 180 mit `cm_estimate = 1`, 6 ohne (`no-candidate`, kein Trend) = alle mit Kandidaten-Trend > 0 sind Schaetzpreise.
- Verletzungen: 0 Zeilen mit `cm_estimate = 1` UND (`cm_product_id` gesetzt ODER `price_locked = 2` ODER echter Scrape-Preis vorher). 0 Zeilen mit geaendertem `cm_updated_at`. Vorher 0 Schaetzpreise, nachher 180.

### Abnahme 1 neu gerechnet (echte Codepfade, Schwelle 5 EUR, nach dem Bulk-Lauf)
- Basis-Kandidaten (Scraper-SQL, `COALESCE(cm_estimate_max, price) >= 5`): **27** Drucke (25 Karten) – Ausgangsmessung 50.
- 1st-Ed-Kandidaten (`firstEdCandidates(db, { minEur: 5 })`): **39** – Ausgangsmessung 47.
- Beides unter der Ausgangsmessung; der Haltepunkt (> 50) ist nicht beruehrt.
  Abweichung nach unten erklaert sich vermutlich durch den Sprachfaktor auf `cm_estimate_max` (Ausgangsmessung ohne gleiche Anwendung bei 1st-Ed-Zahl, Kandidatenmenge ist die der echten Resolver-Kandidaten).

## Offen: Geraeteabnahme 3 und 4

Nur mit dem Nutzer am Geraet (Installer, Poller ueber 24 h, Lauf-Protokoll `cardmarket-scraper.log` lesen):
- Abnahme 3: Knopf und Poller laufen still, keine Cloudflare-Pruefbox sichtbar, 6-Stunden-Pause nach Pruefung greift.
- Abnahme 4: Lauf-Protokoll nach 24 h Poller auswerten (gesehen/gescheitert, Ruhe nach Pruefung).
