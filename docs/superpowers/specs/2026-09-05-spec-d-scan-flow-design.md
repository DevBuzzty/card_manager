# Spec D — Scan-Flow: Offline-Katalog, Printing-Ampel, Edition automatisch

**Datum:** 2026-09-05
**Status:** Entwurf, vom User im Brainstorming abgesegnet
**Teil von:** „Supercharge"-Programm (Specs A–H). Setzt **A** (Exemplare mit Edition/Zustand) und **C** (Scan-Shell mit Staging-Sheet) voraus. Baut auf dem bestehenden Artwork-Scanner (HybridPipeline, SetCodeEvidence, SetCodeMatch) auf und ersetzt ihn nicht.

## 1. Problem

Ein Scan erkennt die Karte schnell, aber alles danach ist langsam oder unsicher: die bekannten Printings werden pro Karte über drei Web-Quellen geholt (Sekunden, ohne Netz gar nicht), ein Set-Code mit mehreren Rarities landet als „Unbekannt", die Edition wird gar nicht gelesen, und im Prüfen-Sheet sieht man nicht, welche Einträge Aufmerksamkeit brauchen.

## 2. Ziel

- **Sofort brauchbar, auch offline:** Name, Text, Stats und Printings kommen aus einem lokalen Katalog. Nur Bilder laden nach.
- **Richtiges Printing ohne Nachfrage:** sprachneutrales Matching, still verbessernde Beweise, Rarity-Vorauswahl, **Ampel** pro Eintrag statt Pflichtfragen.
- **Edition automatisch** aus dem Bandtext, mit Sicherheitsangabe.
- Modelle und Index kommen ohne neue APK aufs Handy.

## 3. Nicht-Ziele

- Neue ML-Modelle oder Training (läuft separat: Fine-Tuning, Chibi-Index).
- Binder-Seite mit neun Karten auf einmal (vom User nicht gewählt).
- Zustand automatisch erkennen.
- Foil-Erkennung als Kern (nur optionale Phase mit Messgate, §9).
- Desktop nutzt den Katalog (bleibt bei `api_cache`; später möglich).

## 4. Voraussetzung

Die Audit-Fixes P1–P7 vom 2026-09-02 (1080p-Frames, CardStrip-Band, SetCodeEvidence, SetCodeMatch, Fallback-Drossel, ScanCache, ORT-Tuning) sind gebaut und installiert, aber **nicht funktional am Gerät geprüft**. Erster Plan-Task: On-Device-Verifikation (`adb logcat -s MlScan OrtPerf PasscodeOcr`), Band-Faktoren 0.55/1.05 justieren, falls der Passcode nicht im Bandtext liegt. Erst danach wird auf dem Bandtext aufgebaut.

## 5. Baustein 1: Offline-Katalog

### 5.1 Inhalt

Eine Datei `catalog.v<N>.json.gz` (Ziel ≤ 8 MB gepackt), Schema:

```
{
  "version": 12, "built_at": "2026-09-05T03:00:00Z",
  "cards": [
    { "id": 46986414, "name_de": "Dunkler Magier", "name_en": "Dark Magician",
      "type": "Normal Monster", "desc_de": "…", "atk": 2500, "def": 2100, "level": 7,
      "race": "Spellcaster", "attribute": "DARK",
      "image": "https://images.ygoprodeck.com/images/cards/46986414.jpg",
      "image_small": "…_small.jpg",
      "printings": [ { "code": "LOB-EN005", "rarity": "Ultra Rare" }, … ],
      "printings_verified": [ { "code": "SGX3-DEA10", "rarity": "Common", "lang": "DE" } ]
    }, …
  ]
}
```

- `printings`: YGOPRODeck `card_sets` (englische Codes, Rarity, vollständig).
- `printings_verified`: deutsche/japanische Codes, die der Desktop schon über Yugipedia/Fandom/Konami bestätigt hat (`api_cache`) — nur echte Funde, **nie abgeleitet** (Regel aus [[german-setcode-sources]]).
- Deutsche Namen/Texte: YGOPRODeck `cardinfo.php?language=de`, Fallback Englisch.

### 5.2 Bau und Lieferung

- `desktop/electron/catalog-builder.cjs`: lädt beide YGOPRODeck-Dumps (EN + DE), mergt, hängt `printings_verified` aus `api_cache` an, schreibt gzip, lädt in Supabase Storage Bucket `catalog/` hoch und upsertet `catalog_versions (kind, version, url, size, built_at)`. Läuft wöchentlich (Scheduler in `main.cjs`, gleiches Muster wie Cardmarket-Bulk), manuell in Einstellungen › Daten.
- Derselbe Mechanismus liefert **Modelle**: `kind = 'index' | 'embedder' | 'detector'`. Der Desktop lädt eine neue `index.bin`/`embedder.onnx` (aus dem Training) über Einstellungen › Daten › „Scanner-Modell hochladen" hoch.
- Storage: öffentlich lesbar (Katalog ist keine Nutzerdaten), Schreiben nur über den angemeldeten Desktop.

### 5.3 Handy

- Neue lokale SQLite `catalog.db` (`SQLiteOpenHelper`, kein Room — Kotlin-2.0-Abhängigkeitsregel): Tabellen `cards`, `printings` (mit `verified`-Flag und `lang`), `meta(version)`. Import aus dem gzip-JSON in einer Transaktion, ~14.500 Zeilen.
- `CatalogRepository.kt`: `card(passcode)`, `printings(passcode)`, `search(name)`; ersetzt in Scan, Staging, Suche und Detail die Netz-Lookups. `CardSearchRepository`/`PrintingRepository` bleiben als Fallback, wenn der Katalog eine Karte nicht kennt (nagelneue Sets).
- Update-Prüfung beim App-Start und einmal täglich: `catalog_versions` lesen; neue Version → Download **nur im WLAN** (Einstellung „Auch mobil laden" opt-in), im Hintergrund, atomarer Tausch. Erststart ohne Katalog: Banner „Katalog wird geladen (7 MB)" mit Fortschritt; Scannen ist währenddessen möglich (Netz-Fallback).
- Modelle: `ModelStore.kt` prüft `catalog_versions` für `index`/`embedder`/`detector`, lädt neue Dateien nach `filesDir/models/`, `DetectorModel`/`EmbedderModel`/`IndexSearcher` öffnen zuerst dort, sonst die APK-Assets. Prüfsumme (SHA-256 in `catalog_versions`) vor dem Tausch.
- Bilder: nicht offline. Coil-Cache wie heute; Prefetch der eigenen Sammlungsbilder als späterer Nice-to-have.

## 6. Baustein 2: Printing ohne Nachfrage

### 6.1 Sprachneutrales Matching (`SetCodeMatch`)

- Ein Printing-Code wird in **Präfix · Region · Nummer** zerlegt (`LOB-EN005` → `LOB`, `EN`, `005`; `LOB-G005` → `LOB`, `G`, `005`).
- Der OCR-Bandtext wird gegen `Präfix+Nummer` gematcht (Confusion-Levenshtein wie heute, Region ausgeblendet). Die **Region wird aus dem Bandtext gelesen** (Token zwischen Präfix und Nummer: `DE`, `G`, `EN`, `FR`, `IT`, `SP`, `PT`, `JP`, …), mit derselben Confusion-Toleranz. Kein Region-Token lesbar → Sprache = Default-Sprache des Nutzers (`DE`).
- Ergebnis: `SetOption(code = Präfix-Region-Nummer, rarity = vom englischen Printing, language = aus Region)`.
- `printings_verified` werden **zuerst** geprüft (exakte Codes, z. B. Speed Duel `SGX3-DEA10`), dann die sprachneutralen Kandidaten.
- Rarity-Annahme: gleiche Rarity für alle Sprachen desselben Codes. Bekannte Ausnahmen lassen sich später über `printings_verified` überschreiben.

### 6.2 Stille Verbesserung

`SetCodeEvidence` sammelt nach der Bestätigung weiter, solange die Karte getrackt wird (BoxTracker-Präsenz). Bei jedem neuen Frame wird neu aufgelöst; wird der Treffer **besser** (kleinere Distanz, mehr Frames), aktualisiert sich der Staging-Eintrag, sofern der User ihn nicht manuell geändert hat (`userTouched`-Flag).

### 6.3 Rarity-Vorauswahl

Mehrere Rarities für den gematchten Code → Vorauswahl = niedrigste Rarity nach der bestehenden Rangfolge (Common < Short Print < Rare < Super < Ultra < Secret < Rest), gleiche Logik wie `findBestDefaultSet` am Desktop; Kotlin-Pendant `RarityRank.kt` (existierende Rank-Tabelle aus dem Cardmarket-Scraper wiederverwenden).

### 6.4 Ampel

Jeder Staging-Eintrag trägt `confidence ∈ {GREEN, YELLOW, RED}` plus Grund:

| Ampel | Bedingung |
|---|---|
| **Grün** | Code-Distanz 0 in ≥ 2 Frames **und** Rarity eindeutig **und** Edition ≠ unknown |
| **Gelb** | Code nur mit Toleranz oder nur 1 Frame, **oder** Rarity mehrdeutig (Vorauswahl gesetzt), **oder** Edition unknown |
| **Rot** | kein Code-Treffer (Set = Unknown) |

- Anzeige: farbiger Punkt links am Eintrag, Grund als Untertitel („Rarity mehrdeutig: Ultra/Secret", „Code unsicher: LOB-DE0?5").
- Prüfen-Sheet (C) bekommt oben den Schalter **Nur unsichere** (gelb + rot). Übernehmen nimmt immer alle.
- Desktop-Staging zeigt dieselbe Ampel; der Socket-Payload liefert `confidence` und `reason`.

### 6.5 Socket-Payload (Handy → Desktop)

```
{ passcode, setCode, setCodeCandidates, rarity, language,
  edition, editionConfidence, confidence, reason }
```
Desktop `StagingArea` nutzt `setCode/rarity/language` direkt als Vorauswahl (statt nur Kandidaten neu zu matchen) und `edition` für den Chip aus A.

## 7. Baustein 3: Edition automatisch

- Neue Auswertung `EditionEvidence.kt` über den gepoolten Bandtext derselben Karte:
  - Marker **first**: `1st Edition`, `1. Auflage`, `1ª Edición`, `1ère Édition`, `1ª Edizione`, `1ª Edição` (case-insensitiv, OCR-tolerant: `1st` ≈ `lst`/`Ist`, `Auflage` ≈ `Auflaqe`).
  - Marker **limited**: `LIMITED EDITION`, `LIMITIERTE AUFLAGE`, `EDICIÓN LIMITADA`, `ÉDITION LIMITÉE`.
  - Kein Marker, aber die **Passcode-Zeile** in ≥ 2 Frames gelesen (Passcode-Token gefunden) → **unlimited**.
  - Sonst **unknown**.
- Sicherheit: `HIGH` (Marker in ≥ 2 Frames oder unlimited mit ≥ 3 Frames), `LOW` (1 Frame). `LOW` macht den Eintrag gelb.
- Der Chip aus A zeigt den erkannten Wert; manuelle Änderung setzt `userTouched`. Übernehmen schreibt `edition` in die Copies.
- Wenn Default-Edition (A) auf `first` steht und die Erkennung `unlimited` HIGH liefert, gewinnt die Erkennung (Karte schlägt Einstellung).

## 8. Betroffene Dateien

**Desktop main:** neu `catalog-builder.cjs` (+ Test für Merge), `main.cjs` (Scheduler, IPC `catalog-build-now`, `model-upload`, Storage-Client über `sync.ensureClient()`), `preload.cjs`; `StagingArea.jsx` (Payload-Felder, Ampel, Chip-Vorbelegung).
**Supabase:** `supabase/catalog_versions_schema.sql` (Tabelle + RLS: read all, write authenticated), Storage-Bucket `catalog` (öffentlich lesen).
**Android:** neu `cloud/CatalogRepository.kt`, `cloud/CatalogDb.kt`, `cloud/CatalogSync.kt` (Version, Download, WLAN-Regel), `ml/ModelStore.kt`, `ml/EditionEvidence.kt`, `ml/RarityRank.kt`; geändert `cloud/SetCodeMatch.kt` (sprachneutral), `ml/SetCodeEvidence.kt` (weiter sammeln), `MainActivity.kt`/`ScanScreen.kt` (Auflösung aus Katalog, Ampel, Payload), `ui/ScanStagingScreen.kt` (Ampel, Nur-unsichere, Chip), `ml/DetectorModel.kt`/`EmbedderModel.kt`/`IndexSearcher.kt` (ModelStore-Pfad), `ui/SettingsScreen.kt` (Katalog-Status, „Auch mobil laden", Version).

## 9. Optionale Phase: Foil-Hinweis (nur mit Messgate)

Idee: Glanz-Varianz des Artwork-Crops über die getrackten Frames als Foil-Score; Foil → Rarity-Vorauswahl auf die niedrigste **Foil**-Rarity statt Common. Gate: auf 50 bekannten Karten (25 Foil, 25 Common) ≥ 90 % korrekt, sonst nicht ausliefern. Wird als eigener Plan-Task ans Ende gestellt und kann entfallen.

## 10. Fehlerfälle

- Katalog fehlt/kaputt → Netz-Fallback wie heute, Banner mit Retry.
- Karte nicht im Katalog (neues Set) → Netz-Fallback; Eintrag gelb mit Grund „nicht im Katalog".
- Kein Netz und nicht im Katalog → Eintrag rot, bleibt im Staging, Übernehmen legt Printing `Unknown` an (wie heute).
- Storage nicht erreichbar → alte Version bleibt, kein Fehler-Popup, nur Statuszeile in Einstellungen.
- Modell-Download unvollständig → Prüfsumme schlägt fehl, Assets bleiben aktiv.

## 11. Tests

- `SetCodeMatch`: Zerlegung (`LOB-EN005`, `LOB-G005`, `SGX3-DEA10`, `RA01-DE001`), sprachneutraler Treffer mit Region aus OCR („LOB DE005", „L0B-DE0O5"), verified-vor-derived, kein Treffer → null. Kotlin-Unit-Tests.
- `EditionEvidence`: alle Marker-Sprachen, OCR-Verschreibungen, unlimited-Regel (≥ 2 Frames mit Passcode), unknown bei 1 Frame ohne Marker.
- Ampel: Tabelle aus 6.4 als parametrisierter Test.
- Katalog-Builder: Merge EN+DE, `printings_verified` aus `api_cache`, gzip-Größe unter Limit (Node-Test mit kleinen Fixtures).
- `CatalogDb`: Import + Lookups + Versionstausch atomar (Kotlin-Test mit In-Memory-DB).
- Desktop `StagingArea`: Payload mit `setCode/rarity/language` → Vorauswahl ohne Re-Match (bestehendes Test-Muster `setCodeMatch.test.js`).
- On-Device: 30 Karten (10 Foils, 5 erste Auflage, 3 mehrdeutige Codes): ≥ 25 grün, keine falsch-grünen; Flugmodus-Scan zeigt Name sofort.

## 12. Risiken

- **Rarity-Annahme über Sprachen** kann in Einzelfällen falsch sein → gelb statt grün, wenn der Code in `printings_verified` mit anderer Rarity steht; Overrides wachsen über den Desktop-Cache.
- **Edition-Marker außerhalb des Bands** bei älteren Layouts → unknown statt falsch; die Band-Geometrie wird im Verifikations-Task geprüft.
- **Katalog-Größe** wächst mit jedem Set; Limit 8 MB gepackt, sonst `desc_de` kürzen oder auslagern.
