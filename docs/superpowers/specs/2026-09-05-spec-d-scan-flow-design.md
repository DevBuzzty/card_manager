# Spec D — Scan-Flow: Offline-Katalog, Printing-Ampel, Edition automatisch, Speed-Scan, OCR-Qualität

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
- **Speed-Scan-Modus:** Handy auf der Erhöhung, Karte drunterschieben, automatisch erkannt und direkt in die Sammlung, Karte für Karte; Unsicheres landet in einer Nachprüfen-Liste statt in einer Nachfrage.
- **OCR liest jedes Kartenlayout** (Pendulum, Link, Zauber/Falle, Skill, altes Layout) an der richtigen Stelle und wird **messbar** besser.

## 3. Nicht-Ziele

- Neues Training des Artwork-Embedders/Detektors (läuft separat: Fine-Tuning, Chibi-Index). Einzige Ausnahme: ein eigenes Band-Texterkennungsmodell als Phase 2 des OCR-Programms (§7c), nur wenn das Messgate es verlangt.
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

## 7a. Baustein 4: Speed-Scan-Modus

### 7a.1 Schalter
Im Scan-Screen (C) ein Segment oben: **Normal · Speed**. Die Wahl wird in den Prefs gemerkt (`scan_mode`). Normal = heutiger Ablauf mit Staging-Sheet. Speed = Aufbau „Handy auf der Erhöhung, Karte drunterschieben".

### 7a.2 Zustandsautomat (`SpeedScanController.kt`, reine Logik, getestet)

```
LEER      : kein Treffer im Bild
EINGELEGT : dieselbe Karte (Passcode) in ≥ 3 Frames in Folge, genau EINE Karte im Bild
WARTEN    : bis zu 1000 ms auf Band-OCR (Set-Code, Edition), endet früher, sobald Ampel grün
ÜBERNOMMEN: Exemplar geschrieben, Feedback gegeben
ABGELEGT  : Karte ≥ maxMisses Frames nicht mehr gesehen → zurück zu LEER
```

- Zwei Karten gleichzeitig im Bild → Hinweis „Nur eine Karte" (Overlay), keine Übernahme.
- Dieselbe Karte bleibt liegen → wird nicht erneut übernommen; erst nach ABGELEGT ist die nächste Karte (auch dieselbe Karte als zweites Exemplar) dran.
- `WARTEN` nutzt dieselbe Evidenz-Pooling-Logik wie Normal (SetCodeEvidence, EditionEvidence); Timeout → Übernahme mit der aktuellen Ampel.

### 7a.3 Übernahme
- Exemplar direkt in die Sammlung (A: `addCopy` mit Standards; Printing aus D-Auflösung; Set `Unknown` bei rot).
- Ampel **gelb oder rot** → Exemplar bekommt `needs_review = 1` (neue Spalte auf `card_copies`, synchronisiert), Grund als Text (`review_reason`).
- Feedback: grün → großer grüner Blitz, Kartenname und Printing groß, kurzer Ton A, Haptik; gelb/rot → gelber/roter Blitz, **anderer Ton B**, damit man es ohne Hinsehen hört.
- Kopfzeile zählt: „24 übernommen · 3 nachprüfen". **Rückgängig** (letzte Übernahme, Stack über die Sitzung) wie im Einsortier-Modus (B).
- Kein Desktop-Spiegel im Speed-Modus (die Karte ist schon in der Sammlung, Sync trägt sie rüber).

### 7a.4 Nachprüfen-Liste
Neue Arbeitsliste in Sammlung › Karten (Chips: Alle · Unbekannt · **Nachprüfen** · Unvollständig · Foils), beide Geräte. Zeile zeigt Grund und die Alternativen (Rarity-Kandidaten, Code-Kandidaten, Edition). Korrektur im Karten-Detail (Exemplar-Gruppe umstellen / Printing wechseln) setzt `needs_review = 0`. Start (C) zeigt den Zähler in den Arbeitslisten.

## 7b. Baustein 5: Layout-abhängige OCR-Geometrie

Heute liest `CardStrip` ein festes Band unter der Artwork-Box. Neu: nach der Identifikation (Artwork-Embedder → Passcode → Katalog-Typ) wählt die Pipeline die **Zonen pro Layout**; ist der Typ noch unbekannt (Embedder ohne Treffer), werden die zwei häufigsten Layouts (Standard, Pendulum) beide gelesen.

`ml/CardLayout.kt`: `enum Layout { STANDARD, SPELL_TRAP, PENDULUM, LINK, SKILL, LEGACY }` + `zones(layout): Map<Zone, RectF>` in Einheiten der Artwork-Box (`Zone = SET_CODE, PASSCODE, EDITION`). Zuordnung Katalog-Typ → Layout: `Pendulum*` → PENDULUM, `Link Monster` → LINK, `Spell Card`/`Trap Card` → SPELL_TRAP, `Skill Card` → SKILL, Rest → STANDARD; LEGACY über `tcg_date` < 2004 (Katalog `misc`) nur als Fallback-Zone.

Bekannte Abweichungen (werden im Verifikations-Task ausgemessen, nicht geraten): Pendulum: Set-Code **links unten unter dem Pendel-Kasten**, Artwork-Box kürzer; Link: Set-Code standard, Passcode-Zeile enthält Link-Pfeile-nahen Text; Skill: Querformat-Elemente. Die Zonenwerte stehen als Konstanten mit Crop-Dumps (`ml/data/zones/<layout>/*.png`) als Beleg im Repo (nur Dumps eigener Karten, klein).

Jede Zone wird **einzeln** vorverarbeitet und OCR'd; `bandText` wird zu `zoneTexts: Map<Zone, String>`, `SetCodeEvidence`/`EditionEvidence` poolen pro Zone.

## 7c. Baustein 6: OCR-Qualitätsprogramm

**Messkorb zuerst.** `ml/ocr_bench/`: 60–100 Fotos eigener Karten (Speed-Aufbau und frei in der Hand, alle Layouts, Foils dabei) mit Labels `set_code, passcode, edition` (`labels.csv`). Skript `ml/ocr_bench.py` spielt die Android-Vorverarbeitung nach (gleiche Zonen, gleiche Skalierung) und ruft die gleiche OCR (ML Kit gibt es nicht am PC → das Skript exportiert die Zonen-Crops, eine kleine Android-Instrumentation `OcrBench` liest sie am Gerät und schreibt `results.json`). Kennzahlen: Trefferquote pro Feld, pro Layout, pro Aufbau.

**Maßnahmen, in dieser Reihenfolge, jede mit Vorher/Nachher-Zahl:**
1. Zonen pro Layout (§7b).
2. Vorverarbeitung pro Zone: perspektivische Entzerrung aus der Box, Hochskalieren auf ≥ 32 px Zeilenhöhe, Kontrast/Binarisierung (bestehendes `OcrPrep`), zwei Skalen, bestes Ergebnis.
3. Grammatik-Nachbearbeitung: Set-Code-Muster `PREFIX-REGION+NUMMER`, Ziffern-Whitelist für den Passcode, Confusion-Tabelle (bestehend), Prüfziffer-freies Plausibilitätsmaß (Passcode muss im Katalog existieren).
4. Mehrframe-Voting **pro Zone** statt pro Band.

**Gate:** Set-Code ≥ 90 %, Passcode ≥ 97 %, Edition ≥ 90 % im Messkorb. Darunter → **Phase 2**: eigenes Band-Texterkennungsmodell (CRNN, ONNX Runtime) nur für die drei Zonen, trainiert mit der bestehenden Synthese-Pipeline (`ml/`): die YGOPRODeck-Kartenbilder enthalten Set-Code, Passcode und Editionsvermerk bereits gedruckt; Labels für die Synthese kommen aus einer einmaligen Offline-OCR der Originalbilder plus Katalog-Abgleich. Ersetzt ML Kit nur für die Zonen; die Vollbild-Fallback-OCR bleibt ML Kit.

## 8. Betroffene Dateien

**Desktop main:** neu `catalog-builder.cjs` (+ Test für Merge), `main.cjs` (Scheduler, IPC `catalog-build-now`, `model-upload`, Storage-Client über `sync.ensureClient()`), `preload.cjs`; `StagingArea.jsx` (Payload-Felder, Ampel, Chip-Vorbelegung).
**Supabase:** `supabase/catalog_versions_schema.sql` (Tabelle + RLS: read all, write authenticated), Storage-Bucket `catalog` (öffentlich lesen).
**Android:** neu `cloud/CatalogRepository.kt`, `cloud/CatalogDb.kt`, `cloud/CatalogSync.kt` (Version, Download, WLAN-Regel), `ml/ModelStore.kt`, `ml/EditionEvidence.kt`, `ml/RarityRank.kt`, `ml/CardLayout.kt` (Zonen pro Layout), `ml/SpeedScanController.kt`, `ui/SpeedScanOverlay.kt`, Instrumentation `OcrBench`; geändert `ml/CardStrip.kt`/`HybridPipeline.kt` (Zonen statt Band, `zoneTexts`), `ui/CollectionScreen.kt` (Chip Nachprüfen), `cloud/CollectionRepository.kt` (`needs_review`), Prefs `scan_mode`;
**Schema (A-Erweiterung):** `card_copies.needs_review INTEGER NOT NULL DEFAULT 0`, `card_copies.review_reason TEXT` in SQLite und Supabase, in den Spiegel-Spalten des Copies-Stroms.
**ML-Tooling:** `ml/ocr_bench.py`, `ml/ocr_bench/labels.csv` + Fotos (gitignored bis auf ein Beispiel), `ml/data/zones/` Crop-Dumps.
Weiterhin geändert `cloud/SetCodeMatch.kt` (sprachneutral), `ml/SetCodeEvidence.kt` (weiter sammeln), `MainActivity.kt`/`ScanScreen.kt` (Auflösung aus Katalog, Ampel, Payload), `ui/ScanStagingScreen.kt` (Ampel, Nur-unsichere, Chip), `ml/DetectorModel.kt`/`EmbedderModel.kt`/`IndexSearcher.kt` (ModelStore-Pfad), `ui/SettingsScreen.kt` (Katalog-Status, „Auch mobil laden", Version).

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
- `SpeedScanController`: Übergänge LEER→EINGELEGT (3 Frames), zwei Karten → kein Übergang, liegengelassene Karte → keine zweite Übernahme, gleiche Karte nach ABGELEGT → zweite Übernahme, Timeout 1000 ms → Übernahme mit aktueller Ampel, Rückgängig-Stack. Kotlin-Unit-Tests mit synthetischen Frame-Sequenzen.
- `CardLayout`: Zuordnung Typ → Layout für alle Katalog-Typen; Zonen liegen innerhalb der Kartenfläche (Geometrie-Test gegen Beispiel-Boxen).
- OCR-Messkorb: `ocr_bench` läuft vor und nach jeder Maßnahme; Ergebnisse als Tabelle im Plan-Task dokumentiert; Gate aus §7c entscheidet über Phase 2.
- Speed-Modus On-Device: 30 Karten am Stück (darunter 2× dieselbe Karte, 3 Pendulum, 2 Foils): 30 Exemplare in der Sammlung, keine Dubletten, Nachprüfen-Liste enthält genau die gelben/roten.

## 12. Risiken

- **Rarity-Annahme über Sprachen** kann in Einzelfällen falsch sein → gelb statt grün, wenn der Code in `printings_verified` mit anderer Rarity steht; Overrides wachsen über den Desktop-Cache.
- **Edition-Marker außerhalb des Bands** bei älteren Layouts → unknown statt falsch; die Band-Geometrie wird im Verifikations-Task geprüft.
- **Katalog-Größe** wächst mit jedem Set; Limit 8 MB gepackt, sonst `desc_de` kürzen oder auslagern.
- **Speed-Modus übernimmt Falsches** (falscher Passcode bei sehr ähnlichen Artworks): Abgesichert durch die 3-Frame-Stabilität, den Rückgängig-Stack und die Nachprüfen-Liste; ein falsch-grüner Treffer bleibt möglich und wird im On-Device-Test gemessen (Ziel 0 von 30).
- **Zonenkonstanten** gelten für den Standard-Druck; Sonderdrucke (Promo-Layouts, Anniversary-Rahmen) fallen auf STANDARD zurück und landen im Zweifel gelb.
