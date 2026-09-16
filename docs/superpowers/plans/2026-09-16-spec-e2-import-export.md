# Spec E2 Import & Export — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decklisten wandern in beide Richtungen: YDK, YDKE-Link und Textliste werden auf beiden Geräten gelesen und geschrieben; Textlisten werden gegen den Offline-Katalog aufgelöst (exakt, normalisiert, „Meintest du …?"), jeder Import zeigt eine Vorschau und legt immer ein neues Deck an, Nicht-Übernommenes landet in `decks.notes`. Der Desktop importiert YDK-Dateien (der alte Weg war toter Code) und eingefügten Text und exportiert YDK/YDKE/Textliste; das Handy importiert per Einfügen und als Share-Ziel und teilt YDKE/Textliste/YDK. Beide Editoren bekommen das Side-Deck (Hinzufügen-Ziel und Zeilenaktion „→ Side"/„→ Deck").

**Architecture:** Alle Regeln wohnen in zwei reinen Zwillingen: `deckFormats` (Lesen, Schreiben, Erkennen von YDK/YDKE/Text) und `deckImport` (Normalisierung, Levenshtein, Auflösung, Abschnittsregel `deckSectionFor`, Zeilenaktion, Vorschau-Plan mit Zählern und Notizen, Texte, Vorbereitung `prepareImport`), JS in `desktop/src/utils/`, Kotlin in `android/.../ml/`, beide gegen `docs/fixtures/decks/formats.json` und `import.json`. Der Desktop löst im Renderer auf; der Hauptprozess liefert dafür aus der vorhandenen Katalogdatei (`catalog-prices.cjs`, jetzt auch Katalog-Index) nur die gebrauchten Katalogzeilen (Passcodes bzw. einmal je Import alle Namen kompakt) und legt das Deck mit Rückbau an (`decks.cjs#createImportedDeck`, Client-Attrappe). Das Handy liest Namen per `CatalogRepository.importRows` nur während des Imports, legt mit `DecksRepository.createWithRollback` an und empfängt geteilten Text über `DeckImportInbox` (MainActivity → AppNav nach dem Login → DecksScreen). Neue Spalte `decks.notes` per SQL-Datei (spielt der Nutzer ein).

**Tech Stack:** Electron CJS + better-sqlite3, React/Vite, Postgres (nur SQL-Datei), Kotlin/Compose (Material3), org.json, node:test, JUnit4, kotlinx-coroutines-test.

**Spec:** `docs/superpowers/specs/2026-09-16-spec-e-nachtrag-e2-import-export.md` (vom Nutzer abgesegnet). Sie ändert `docs/superpowers/specs/2026-09-05-spec-e-deckbuilder-pro-design.md` §5.1 (`notes`), §6, §7.1/§7.2, §9–§12 und setzt E1 (gemergt `bcc579d`) und Katalog Version ≥ 6 voraus. Plan-Basis `f16cb40`.

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus und verbinden sich nie mit Supabase. Das gilt auch für Edge-Function-Aufrufe und Deploys. SQL spielt der Nutzer von Hand im Dashboard ein; der Plan liefert nur die SQL-Datei.
- Immer explizite Pfade stagen, nie `git add -A` und nie `git stash`. Der Stash-Stack ist mit den Worktrees geteilt.
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI). `desktop/node_modules` ist im Worktree eine Junction.
- `cards.quantity` und `cards.deleted` pflegen Trigger; die App schreibt sie nie. Es gibt nur Soft-Delete. (Seit G4 gilt dasselbe für `cards.price_first_ed`.)
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs`.
- Sichtbare Texte sind deutsch mit echten Umlauten, „Fächer" statt „Taschen".
- Regeln wohnen in reinen, getesteten Helfern. Absichtliche Zwillinge werden im Kopfkommentar markiert, der den anderen Zwilling nennt, und auf beiden Seiten gegen gemeinsame Fixtures getestet.
- Kotlin-Rundung von Geld und Zahlen mit `java.lang.Math.round` (nie `kotlin.math.round`, Banker's Rounding). E2 rundet nichts; die Regel gilt für jede Erweiterung.
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`). Ein sechster ist ein Fehlschlag.
- Deutsche Set-Codes werden nie aus englischen abgeleitet.
- Ein Test, der gegen einen Fehler schützt, muss nachweislich ohne den Schutz scheitern. Dazu den Schutz kurz sabotieren, den Fehlschlag im Bericht zitieren und die Sabotage zurücknehmen.
- Ein Platzhalter darf nie wie eine leere Sammlung aussehen: solange Daten fehlen, steht „…" bzw. ein Ladekreis, nie „Main 0 · Extra 0 · Side 0" vor der Auflösung.
- Teure Berechnungen laufen in Compose nie unmemoisiert in der Komposition (`remember` mit Schlüsseln; Lesen/Auflösen im `LaunchedEffect` abseits des Hauptthreads).
- Ein Schutz, der in eine geteilte Funktion wandert, darf das Verhalten der anderen Aufrufer nicht ändern — alle Aufrufer prüfen (Lehre aus E1 F3).
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- E2-spezifisch nicht drin (Spec §2): YGOPRODeck-URL-Import, Online-Nachschlagen unbekannter Passcodes, Import in ein bestehendes Deck, geteilte Dateien (nur Text), Legalität/Simulation (E3), Master-Duel-Codes. Keine Edge Function, kein Katalog-Wechsel.

**Befehle (aus der Worktree-Wurzel, sofern nicht anders angegeben):**
- Desktop SQLite-Suite (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Desktop Sync-Skript (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
- Desktop-Helfer (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs`
- Desktop-Lint (in `desktop/`): `npx eslint .` → genau `5 errors`. Gelintet werden nur `*.js`/`*.jsx`, nicht `*.cjs`/`*.mjs`.
- Desktop-Build (in `desktop/`): `npx vite build`
- Android: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`

Ausgangszahlen auf `f16cb40`: SQLite-Suite 231, Helfer 145, Lint 5 Fehler/3 Warnungen, Android 495 Tests.

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `supabase/decks_notes.sql` (neu) | `decks.notes text` | 1 |
| `docs/fixtures/decks/formats.json` (neu) | gemeinsame Fälle Formate | 1 |
| `desktop/src/utils/deckFormats.js` + `.test.js` (neu) | YDK/YDKE/Text lesen, schreiben, erkennen | 1 |
| `docs/fixtures/decks/import.json` (neu) | gemeinsame Fälle Auflösung/Plan/Texte | 2 |
| `desktop/src/utils/deckImport.js` + `.test.js` (neu) | Normalisierung, Levenshtein, Auflösung, `deckSectionFor`, Plan, Notizen, Texte, `prepareImport` | 2 |
| `desktop/electron/catalog-prices.cjs` + `.test.cjs` | Katalog-Index (Namen, Typ, Bild) neben den Preisen | 3 |
| `desktop/electron/decks.cjs` + `.test.cjs` | `readYdkFile`, `createImportedDeck` mit Rückbau | 3 |
| `desktop/electron/main.cjs`, `preload.cjs`, `ipc-channels.test.cjs` | `get-catalog-cards`, `create-imported-deck`; `import-deck-ydk`/`export-deck-ydk`/`save-deck`/`get-deck-details` umgebaut | 3 |
| `desktop/src/components/DeckNewMenu.jsx`, `DeckImportDialog.jsx`, `DeckExportMenu.jsx` (neu) | Menü „Neues Deck", Einfügen + Vorschau, Export-Menü | 4 |
| `desktop/src/components/DeckBuilder.jsx` | Import/Export verdrahten, Ziel Deck/Side, Zeilenaktion, Notizfeld | 4 |
| `android/.../ml/DeckFormats.kt`, `DeckImport.kt` (neu) | Kotlin-Zwillinge | 5 |
| `android/.../DeckFormatsTest.kt`, `DeckImportTest.kt` (neu) | Fixture-Tests | 5 |
| `android/.../cloud/DecksRepository.kt`, `CatalogRepository.kt` | `Deck.notes`, Anlegen mit Rückbau, `moveOne`; `importRows` | 6 |
| `android/.../DecksRepositoryTest.kt`, `CatalogParserTest.kt` | notes, JSON der Karten, Rückbau, Abfrage | 6 |
| `android/.../ui/DeckImportInbox.kt` + `DeckImportInboxTest.kt` (neu) | Postfach + Share-Auswertung | 7 |
| `android/app/src/main/AndroidManifest.xml`, `MainActivity.kt`, `ui/AppNav.kt` | Share-Ziel, `onNewIntent`, Navigation nach dem Login | 7 |
| `android/.../ui/DeckImportScreen.kt` (neu), `ui/DecksScreen.kt` | Einfügen/Vorschau, Plus-Menü, Side, Ziel, Zeilenaktion, Teilen-Menü, Notizen | 8 |

`android/...` steht für `android/app/src/main/java/com/example/yugiohscanner` (Paket `com.example.yugiohscanner`). Die Tests liegen unter `android/app/src/test/java/com/example/yugiohscanner/` und lesen Fixtures über `Fixtures.text("docs/fixtures/...")`; `DeckFixtureWorld.Companion.objects` (E1) wird wiederverwendet. Die Android-Unit-Tests laufen auf der JVM ohne Robolectric.

Jede Datei wird in genau einem Task geändert. Reihenfolge: 1 → 2 → 3 → 4 (Desktop), 5 → 6 → 7 → 8 (Handy). Task 5 braucht die Fixtures aus 1 und 2; 5–8 hängen sonst nicht vom Desktop ab. Tasks strikt nacheinander im selben Worktree.

**Vorab geprüft (Plan-Autor, Scratch-Kopie von `f16cb40` außerhalb des Repos, `desktop/node_modules` als Junction, ohne `local.properties`):** Aller Code dieses Plans stand dort genau so (die Änderungsblöcke unten sind maschinell aus dieser Kopie gegen `HEAD` erzeugt und auf Eindeutigkeit geprüft). Ergebnisse: SQLite-Suite 243/243, `test-sync.cjs` alle PASS, Helfer 180/180, `npx eslint .` 5 Fehler/3 Warnungen, `vite build` ok, Android `testDebugUnitTest assembleDebug` BUILD SUCCESSFUL mit 511 Tests/0 Fehlern. Alle Schutz-Nachweise unten sind gemessen. Mit dem echten Katalog (Version 7, 14 565 Karten): YDKE mit 6 Karten inkl. Laden 61 ms, Textliste mit 60 Zeilen und 15 Tippfehlern 392 ms (14 Vorschläge).

## Plan-Ergänzungen (vom Plan entschieden, bitte dem Nutzer vorlegen)

1. **Spec §1 ergänzt: auch der Desktop-YDK-Export war kaputt.** `DeckBuilder.jsx` schickt einen fertigen String, `export-deck-ydk` ruft darauf `content.filter(...)` auf → TypeError, es wurde nie eine Datei geschrieben. Neu baut der Renderer den Text mit `buildYdk` (mit Side-Deck, Kopf `#created by YGO Card Manager`), der Hauptprozess speichert nur noch.
2. **Aufgelöst wird im Renderer, nicht im Hauptprozess.** Der JS-Zwilling liegt ESM in `src/utils` und wird nicht nach `electron/**` paketiert; der CJS-Hauptprozess kann ihn nicht laden, ein dritter Zwilling wäre die Folge. `catalog-prices.cjs` liest die Katalogdatei wie bisher einmal (Cache nach Änderungszeit/Größe) und hält jetzt neben den Preisen einen Index Passcode → `{ id, name_de, name_en, type, image }`. Neuer Kanal `get-catalog-cards(ids)`: mit Passcodes nur diese Zeilen (samt Bild; YDK/YDKE), mit `null` alle Karten kompakt ohne Bild (Textliste; gemessen 1,5 MB JSON bei 14 565 Karten) — genau einmal je Import, nie je Tastendruck. Bilder für `deck_cards.image_url` setzt `create-imported-deck` im Hauptprozess aus demselben Index; sie gehen nie gesammelt über IPC. (Die Katalogdatei ist 2,3 MB gz / 13,6 MB entpackt.)
3. **Handy: Namen nur während des Imports.** `CatalogRepository.importRows(ids)` liest für YDK/YDKE nur die Passcodes (Blöcke zu 500, samt Bild), für die Textliste alle Zeilen ohne Bild; die Liste lebt nur in `DeckImport.prepare` (auf `Dispatchers.IO`), danach bleiben nur die Kandidaten. Ohne Katalog (`CatalogRepository.isReady()` falsch, z. B. direkt nach einem Katalog-Upgrade) gilt „Katalog fehlt".
4. **Vorbereitung als Zwillings-Regel** `prepareImport(text, format, loadCatalog)` ↔ `DeckImport.prepare(text, format, loadCatalog)`: lesen → welche Katalogzeilen laden → auflösen. Damit ist der Vorschau-Zustand am Handy ohne Gerät getestet (Spec §9), und beide Seiten entscheiden gleich, wann der Katalog überhaupt gelesen wird (bei Lesefehler nie).
5. **Formate, Einzelheiten:** Passcode = 1–10 Ziffern mit Wert 1…2³²−1, führende Nullen weg; `0` und Überlanges → nicht übernommen. YDKE: Präfix `ydke://` (klein, wie in der Erkennung), jeder Leerraum im Link wird entfernt, genau drei Blöcke plus optionales Schluss-`!` (mehr Blöcke → ungültig), Base64 streng mit Auffüllung — geprüft mit **demselben** Muster auf beiden Seiten, weil `atob` und `java.util.Base64` unterschiedlich nachsichtig sind; Passcode 0 im Link → nicht übernommen („0"). „Keine Deckliste erkannt" gilt für jedes Format ohne einzige gelesene Karte (auch leerer YDKE-Link, YDK-Datei nur mit Müll). Erkennung von `#main`/`!side` Groß/Klein egal. Die YDK-Datei wird mit vorgegebenem Format `ydk` gelesen.
6. **Textliste, Einzelheiten:** Zeilenmuster `^[0-9]+(\s*[xX])?\s+Name` und `Name\s+[xX][0-9]+`; Anzahl außerhalb 1–99 → Zeile nicht übernommen; gleiche Zeilen werden **nicht** zusammengefasst (die Rohzeile bleibt für Notizen und Vorschau), summiert wird erst beim Anlegen je Passcode und Abschnitt. Zeilen vor der ersten Überschrift haben Abschnitt `unknown`. Geschützte Leerzeichen aus Webseiten zählen als Leerzeichen (JS `\s`; Kotlin `(?U)`, Ziffern bewusst `[0-9]`). Bekannte Grenze: ein Kartenname, der mit „Zahl Leerzeichen" beginnt („7 Colored Fish"), wird als Anzahl gelesen und landet als „Nicht gefunden" mit Rohzeile in den Notizen.
7. **Schreiben, Einzelheiten:** YDK eine Zeile je Kopie, mit Zeilenumbruch am Ende; YDKE `ydke://A!B!C!`; Textliste je Abschnitt nach Passcode summiert (das Handy hat mehrere Zeilen je Passcode), Name fällt auf den Passcode zurück, Zeilen ohne Umbruch am Ende; Kopien mit Anzahl ≤ 0 entfallen.
8. **Auflösung, Einzelheiten:** Anzeigename = `name_de`, sonst `name_en`. Stufe 1 vergleicht getrimmt und klein gegen beide Namen. Stufe 2 in dieser Reihenfolge: klein → NFKD → `\p{M}` entfernen → `ß`→`ss` → alles außer `\p{L}\p{N}` zu einem Leerzeichen → trimmen (klein zuerst, damit auch `ẞ` greift). Stufe 3: normalisierte Anfrage ≥ 6 Zeichen, je Passcode der kleinste Abstand über seine normalisierten Namen, ≤ 2; Sortierung Abstand, Anzeigename in Codeeinheiten-Ordnung (kein Locale-Vergleich, sonst weichen die Zwillinge ab), Passcode; höchstens 3. **„Längendifferenz ≤ 2" folgt aus „Abstand ≤ 2"** (Levenshtein ≥ Längendifferenz) — sie bleibt als Vorfilter für die Geschwindigkeit, ein eigener Schutz-Test ist unmöglich; die Grenze ist trotzdem als Fall abgedeckt (`Raigekixx` Vorschlag, `Raigekixxx` nicht gefunden).
9. **Mehrdeutig und Vorschlag in der Vorschau:** Mehrdeutige Zeilen zeigen „Mehrdeutig – bitte wählen" (neuer Text) und Optionen „Name (Passcode)"; Vorschläge zeigen je Kandidat eine Option „Meintest du Name?". Bis zur Auswahl steht die Zeile als „offen" (neuer Text) und wird nicht übernommen; ein zweiter Klick nimmt die Auswahl zurück. Im echten Katalog gibt es 0 exakt und 1 normalisiert mehrdeutigen Namen.
10. **Vorschau-Plan:** übernommen = aufgelöst oder gewählt; Abschnitt `unknown` → `deckSectionFor(Typ der gewählten Karte)`; Karten je (Passcode, Abschnitt) in Reihenfolge des ersten Auftretens summiert; die Zähler zählen Kopien. „n nicht übernommen" zählt Zeilen: zuerst die beim Lesen nicht verstandenen Rohzeilen, dann die Zeilen der Auflösung in Reihenfolge. Notizen = „Nicht übernommen beim Import:" + je Zeile (unbekannte Passcodes als „Unbekannter Passcode 12345678", sonst die Rohzeile, auch offene Vorschläge); ohne solche Zeilen `null`. Der Block „Nicht übernommen" zeigt dieselben Zeilen mit Grund („… · Nicht gefunden", „… · offen") als `skippedLabels`. „Main 0 · Extra 0 · Side 0" erscheint nur nach der Auflösung als echter Wert; vorher „…" bzw. Ladekreis.
11. **Anlegen:** `notes` geht nur mit Inhalt in den Insert — ein Import ohne Nicht-Übernommenes klappt so auch vor `decks_notes.sql`, einer mit Nicht-Übernommenem scheitert dann sauber schon beim Deck (nichts zurückzubauen). Alle Karten in **einem** Insert; scheitert er, wird das Deck gelöscht und die Rohmeldung zurückgegeben; den Präfix „Import fehlgeschlagen: …" setzt die Oberfläche über `failedText`. Leerer Name → „Importiertes Deck". Anlegen ist auch ohne eine einzige übernommene Karte erlaubt (Spec §7: „Anlegen mit den gefundenen Karten bleibt möglich"). Nach Erfolg: Desktop setzt das Deck vorn in die Liste und öffnet es; Handy lädt `SideStores.decks` und öffnet den Editor.
12. **YDK-Datei am Desktop:** `import-deck-ydk` liest nur noch (`readYdkFile` → `{ canceled: false, name, text }`, `name` = Dateiname ohne Endung); geparst wird im Import-Dialog. Der tote Zweig mit `result.deck` entfällt samt Auto-Save.
13. **Notizen am Desktop:** Textfeld unter dem Abgleich-Kopf; `save-deck` bekommt optional `notes` und schreibt sie **nur, wenn sie sich geändert haben** (Renderer schickt sonst `undefined`) — „Save Deck" bleibt für Decks ohne Notizänderung auch vor dem SQL heil. Einziger Aufrufer von `save-deck` ist `DeckBuilder.handleSaveDeck` (geprüft).
14. **Side-Deck am Desktop:** Der Umschalter „Ziel: Deck | Side" steht über dem Sammlungs-Raster (das ist die Suche, aus der der Desktop hinzufügt). „Deck" = `deckSectionFor(card.type)` (bisher Groß/Klein-sensibles `includes`, für echte Typen gleiches Ergebnis); die bestehende 3-Kopien-Grenze je Ziel-Liste bleibt. Zeilenknopf „→ Side"/„→ Deck" verschiebt eine Kopie im Editor-Zustand (gespeichert mit „Save Deck"); ein Klick auf die Zeile entfernt weiterhin eine Kopie (der Knopf stoppt die Weitergabe). „→ Deck" braucht den Kartentyp: neu hinzugefügte Karten tragen `card_type`; `get-deck-details` fällt für nicht besessene Karten auf den Katalogtyp zurück (einziger Aufrufer `handleLoadDeck`; besessene Karten unverändert).
15. **Export am Desktop:** Menü „Export" ersetzt „Export YDK": *YDK-Datei*, *YDKE kopieren*, *Textliste kopieren*, jeweils aus dem Editor-Stand (auch ungespeichert). Zwischenablage über `navigator.clipboard.writeText` (so schon in Settings/StagingArea); Bestätigung neben dem Knopf („YDKE-Link kopiert", „Textliste kopiert", „YDK-Datei gespeichert").
16. **Handy, Plus-Menü:** Der vorhandene Plus-Knopf öffnet ein Menü *Leer* (bisheriges Anlegen mit dem Namensfeld) · *Einfügen (YDKE/Text)*. Einfügen und Vorschau sind ein Vollbild `DeckImportScreen` (Textfeld mit der Zwischenablage vorbefüllt, „Vorschau"); ein geteilter Text geht direkt in die Vorschau.
17. **Handy, Verschieben:** erst das Ziel erhöhen (vorhandene Zeile +1 oder neue Zeile), dann die Quelle senken — scheitert der zweite Schritt, ist eine Kopie zu viel da statt verloren. Typ für „→ Deck" aus dem Katalog; ohne Katalog `main`. Umschalter „Ziel:" als zwei `FilterChip`s Deck/Side über den Suchergebnissen.
18. **Share-Empfang:** Intent-Filter `SEND` + `DEFAULT` + `text/plain`; dazu `android:launchMode="singleTask"`, sonst würde Android `onNewIntent` nie aufrufen (Standard-Startmodus legt beim Teilen eine zweite Instanz in den Task der teilenden App). `onCreate` wertet nur ohne `savedInstanceState` aus (kein zweiter Import nach einer Wiederherstellung). `DeckImportInbox` hält den Text prozessweit; `AppNav` führt erst **hinter** dem Login-/Lade-Tor und nur mit `cloudReady` zu `sammlung/decks` (gleiches Muster wie `onOpenBinder`); `DecksScreen` nimmt den Text genau einmal heraus. So bleibt der Text ohne Anmeldung erhalten und die Vorschau erscheint nach dem Login. Die Auswertung `sharedText(action, type, extra)` ist rein und auf der JVM getestet.
19. **Handy, Teilen:** Menü *YDKE*, *Textliste*, *YDK* über den Teilen-Dialog („Deck teilen"), `EXTRA_TITLE` Deckname (bei YDK mit `.ydk`); YDK kommt jetzt aus `DeckFormats.buildYdk` (mit Side, Kopf wie am Desktop). `extraOrMain` und das lokale `buildYdk` in `DecksScreen.kt` entfallen (Regeln in den Zwillingen).
20. **Handy, Notizen:** `Deck.notes` wird aus `select=*` gelesen und unter dem Editor-Kopf angezeigt, wenn nicht leer.
21. **Geteilte Funktionen, Aufrufer geprüft:** `createDeck(name, notes = null)` sendet ohne Notizen denselben Körper wie bisher (Aufrufer: Liste „Leer", Import); `catalog-prices.cjs#readCatalogPrices` liefert unverändert dieselbe Map (Aufrufer `catalogPrices`, Test sichert es zusätzlich); `get-deck-details` ändert nur den Rückfall für fehlenden lokalen Typ; `save-deck` ohne `notes` wie bisher.
22. **Nicht automatisch getestet:** die Oberflächen (Desktop-Dialog/Menüs, Handy-Screens), Zwischenablage, das Weiterleiten des Share-Intents auf dem Gerät, die SQL-Ausführung von `importRows` (getestet ist die Abfrage), `moveOne` und `insertCards` gegen die Cloud. Das prüft die Abnahme (Spec §10). Der UI-Code ist aber vorab kompiliert (Vite-Build, Lint, Gradle `assembleDebug`).

---
### Task 1: SQL-Datei und JS-Zwilling `deckFormats` mit Fixture

**Files:**
- Create: `supabase/decks_notes.sql`
- Create: `docs/fixtures/decks/formats.json`
- Create: `desktop/src/utils/deckFormats.js`
- Create: `desktop/src/utils/deckFormats.test.js`

**Interfaces:**
- Produces (für Task 2, 4, 5, Nutzer): Spalte `public.decks.notes text`. In `deckFormats.js`: `YDKE_INVALID`, `NOTHING_RECOGNIZED`, `YDK_HEADER`, `normalizePasscode(raw) → string|null`, `parseYdk(text) → { format: 'ydk', cards: [{ passcode, count, section }], unresolved: string[] }`, `parseYdke(text) → { format: 'ydke', cards, unresolved, error? }`, `parseTextList(text) → { format: 'text', cards: [{ name, count, section, line }], unresolved }`, `detectFormat(text) → 'ydke'|'ydk'|'text'`, `parseDeckText(text, format = detectFormat(text)) → { format, cards, unresolved, error? }`, `buildYdk(entries) → string`, `buildYdke(entries) → string`, `buildTextList(entries) → string` mit `entries: [{ passcode, name?, count, section }]`.
- Produces (Fixture, für Task 5): `formats.json` mit `parse[] { name, format?, text, expected { format, cards, unresolved, error } }`, `detect[] { text, format }`, `build[] { name, entries, ydk, ydke, text, roundtrip }`.
- Consumes: nichts (Renderer ohne `Buffer`: `atob`/`btoa`, laufen auch unter `node --test`).

- [ ] **Step 1: `supabase/decks_notes.sql` schreiben (nur Datei, nichts ausführen)**

```sql
-- supabase/decks_notes.sql — Spec E2 §5/§8. Einmal im Dashboard einspielen (idempotent),
-- VOR dem neuen Desktop-Installer und der APK.
-- Notizen je Deck: beim Import landen nicht uebernommene Zeilen hier ("Nicht übernommen beim Import:" plus je eine
-- Zeile); am Desktop frei bearbeitbar, am Handy nur Anzeige. Die bestehende Policy "decks are private" deckt
-- Lesen und Schreiben ab.

alter table public.decks add column if not exists notes text;

-- Abnahme (Nutzer, von Hand): select id, name, notes from public.decks order by id desc limit 5;
```

- [ ] **Step 2: Fixture schreiben**

Die YDKE-Blöcke sind unabhängig vom Helfer mit Node `Buffer.writeUInt32LE` + `toString('base64')` erzeugt (z. B. `[14558127]` → `ryPeAA==`, `[0, 14558127]` → `AAAAAK8j3gA=`, 5 Bytes → `AQIDBAU=`).

`docs/fixtures/decks/formats.json`:
```json
{
  "_comment": "Spec E2 §3 — YDK, YDKE, Textliste lesen/schreiben/erkennen. Leser: desktop/src/utils/deckFormats.test.js und android DeckFormatsTest.kt. parse[].format fehlt = Erkennung (parseDeckText ohne Format). YDKE-Bloecke unabhaengig mit Node Buffer.writeUInt32LE + base64 erzeugt. cards: YDK/YDKE {passcode,count,section}, Textliste {name,count,section,line}.",
  "parse": [
    {
      "name": "YDK: Abschnitte, Kommentare, Summen je Abschnitt, führende Nullen, ungültige Zeilen",
      "text": "#created by someone\n#main\n14558127\n14558127\n04031928\n\n14558127\n#extra\n90448279\n01861629\n!side\n27204311\nabc\n27204311\n0\n",
      "expected": {"format":"ydk","cards":[{"passcode":"14558127","count":3,"section":"main"},{"passcode":"4031928","count":1,"section":"main"},{"passcode":"90448279","count":1,"section":"extra"},{"passcode":"1861629","count":1,"section":"extra"},{"passcode":"27204311","count":2,"section":"side"}],"unresolved":["abc","0"],"error":null}
    },
    {
      "name": "YDK: vor dem ersten Kopf gilt main, Köpfe Groß/Klein egal, CRLF",
      "text": "23434538\r\n#EXTRA\r\n90448279\r\n!Side\r\n23434538\r\n#Main\r\n23434538\r\n",
      "expected": {"format":"ydk","cards":[{"passcode":"23434538","count":2,"section":"main"},{"passcode":"90448279","count":1,"section":"extra"},{"passcode":"23434538","count":1,"section":"side"}],"unresolved":[],"error":null}
    },
    {
      "name": "YDK ohne gültige Karte: Keine Deckliste erkannt",
      "text": "#main\nfoo\n#extra\n!side\n",
      "expected": {"format":"ydk","cards":[],"unresolved":["foo"],"error":"Keine Deckliste erkannt"}
    },
    {
      "name": "YDK-Datei mit vorgegebenem Format liest keine Textliste",
      "format": "ydk",
      "text": "3 Raigeki\n",
      "expected": {"format":"ydk","cards":[],"unresolved":["3 Raigeki"],"error":"Keine Deckliste erkannt"}
    },
    {
      "name": "YDKE: drei Blöcke mit Schluss-!, Leerzeichen und Zeilenumbruch drumherum",
      "text": "  ydke://ryPeAK8j3gCvI94AKpVlAbiFPQA=!lyFkBf1nHAA=!1xqfAdcanwE=!\n",
      "expected": {"format":"ydke","cards":[{"passcode":"14558127","count":3,"section":"main"},{"passcode":"23434538","count":1,"section":"main"},{"passcode":"4031928","count":1,"section":"main"},{"passcode":"90448279","count":1,"section":"extra"},{"passcode":"1861629","count":1,"section":"extra"},{"passcode":"27204311","count":2,"section":"side"}],"unresolved":[],"error":null}
    },
    {
      "name": "YDKE: letztes ! optional, leere Blöcke sind leere Abschnitte",
      "text": "ydke://!!ryPeAA==",
      "expected": {"format":"ydke","cards":[{"passcode":"14558127","count":1,"section":"side"}],"unresolved":[],"error":null}
    },
    {
      "name": "YDKE: Zeilenumbruch zwischen den Blöcken",
      "text": "ydke://ryPeAA==!\n!!",
      "expected": {"format":"ydke","cards":[{"passcode":"14558127","count":1,"section":"main"}],"unresolved":[],"error":null}
    },
    {
      "name": "YDKE: Passcode 0 wird nicht übernommen",
      "text": "ydke://AAAAAK8j3gA=!!!",
      "expected": {"format":"ydke","cards":[{"passcode":"14558127","count":1,"section":"main"}],"unresolved":["0"],"error":null}
    },
    {
      "name": "YDKE: ungültiges Base64",
      "text": "ydke://ryPe*A==!!!",
      "expected": {"format":"ydke","cards":[],"unresolved":[],"error":"Kein gültiger YDKE-Link"}
    },
    {
      "name": "YDKE: fehlende Auffüllung ist ungültig",
      "text": "ydke://ryPeAA!!!",
      "expected": {"format":"ydke","cards":[],"unresolved":[],"error":"Kein gültiger YDKE-Link"}
    },
    {
      "name": "YDKE: Bytelänge nicht durch 4 teilbar",
      "text": "ydke://AQIDBAU=!!!",
      "expected": {"format":"ydke","cards":[],"unresolved":[],"error":"Kein gültiger YDKE-Link"}
    },
    {
      "name": "YDKE: weniger als drei Blöcke",
      "text": "ydke://ryPeAA==!",
      "expected": {"format":"ydke","cards":[],"unresolved":[],"error":"Kein gültiger YDKE-Link"}
    },
    {
      "name": "YDKE: mehr als drei Blöcke",
      "text": "ydke://!!!ryPeAA==!",
      "expected": {"format":"ydke","cards":[],"unresolved":[],"error":"Kein gültiger YDKE-Link"}
    },
    {
      "name": "YDKE: gültig, aber leer",
      "text": "ydke://!!!",
      "expected": {"format":"ydke","cards":[],"unresolved":[],"error":"Keine Deckliste erkannt"}
    },
    {
      "name": "Textliste: alle Zeilenformen, Überschriften mit (n) und :, Kommentare, Anzahl außerhalb 1–99",
      "text": "Main Deck (40)\n3 Ash Blossom & Joyous Spring\n2x Maxx \"C\"\n1 x Pot of Greed\nNibiru, the Primal Being x2\nDark Magician\n// Kommentar\n# auch Kommentar\n\nExtra Deck:\n1 Divine Arsenal AA-ZEUS - Sky Thunder\nside\n3 Nibiru, the Primal Being\n0 Pot of Greed\n100 Raigeki\n",
      "expected": {"format":"text","cards":[
        {"name":"Ash Blossom & Joyous Spring","count":3,"section":"main","line":"3 Ash Blossom & Joyous Spring"},
        {"name":"Maxx \"C\"","count":2,"section":"main","line":"2x Maxx \"C\""},
        {"name":"Pot of Greed","count":1,"section":"main","line":"1 x Pot of Greed"},
        {"name":"Nibiru, the Primal Being","count":2,"section":"main","line":"Nibiru, the Primal Being x2"},
        {"name":"Dark Magician","count":1,"section":"main","line":"Dark Magician"},
        {"name":"Divine Arsenal AA-ZEUS - Sky Thunder","count":1,"section":"extra","line":"1 Divine Arsenal AA-ZEUS - Sky Thunder"},
        {"name":"Nibiru, the Primal Being","count":3,"section":"side","line":"3 Nibiru, the Primal Being"}
      ],"unresolved":["0 Pot of Greed","100 Raigeki"],"error":null}
    },
    {
      "name": "Textliste ohne Überschrift: Abschnitt unknown, gleiche Zeilen nicht zusammengefasst",
      "text": "3 Ash Blossom & Joyous Spring\nDecode Talker\nDecode Talker\n",
      "expected": {"format":"text","cards":[
        {"name":"Ash Blossom & Joyous Spring","count":3,"section":"unknown","line":"3 Ash Blossom & Joyous Spring"},
        {"name":"Decode Talker","count":1,"section":"unknown","line":"Decode Talker"},
        {"name":"Decode Talker","count":1,"section":"unknown","line":"Decode Talker"}
      ],"unresolved":[],"error":null}
    },
    {
      "name": "Textliste: Überschriften MAIN:, Extra (15), Side Deck:; x im Namen",
      "text": "MAIN:\n3 Xyz Dragon\nMaxx x2\nRaigeki x\nExtra (15)\n1 Decode Talker\nSide Deck:\nRaigeki x3\n",
      "expected": {"format":"text","cards":[
        {"name":"Xyz Dragon","count":3,"section":"main","line":"3 Xyz Dragon"},
        {"name":"Maxx","count":2,"section":"main","line":"Maxx x2"},
        {"name":"Raigeki x","count":1,"section":"main","line":"Raigeki x"},
        {"name":"Decode Talker","count":1,"section":"extra","line":"1 Decode Talker"},
        {"name":"Raigeki","count":3,"section":"side","line":"Raigeki x3"}
      ],"unresolved":[],"error":null}
    },
    {
      "name": "Textliste: geschütztes Leerzeichen aus Webseiten zählt als Leerzeichen",
      "text": "Main Deck\n3 Raigeki\nRaigeki x2\n",
      "expected": {"format":"text","cards":[
        {"name":"Raigeki","count":3,"section":"main","line":"3 Raigeki"},
        {"name":"Raigeki","count":2,"section":"main","line":"Raigeki x2"}
      ],"unresolved":[],"error":null}
    },
    {
      "name": "leerer Text: Keine Deckliste erkannt",
      "text": "  \n\n// nur Kommentar\n",
      "expected": {"format":"text","cards":[],"unresolved":[],"error":"Keine Deckliste erkannt"}
    }
  ],
  "detect": [
    {"text":"  ydke://!!!","format":"ydke"},
    {"text":"#created by x\n#main\n14558127","format":"ydk"},
    {"text":"14558127\n!SIDE\n","format":"ydk"},
    {"text":"3 Raigeki","format":"text"},
    {"text":"YDKE://ryPeAA==!!!","format":"text"},
    {"text":"#mainboard\n3 Raigeki","format":"text"}
  ],
  "build": [
    {
      "name": "alle Abschnitte, mehrere Zeilen je Passcode, Name fehlt, Anzahl 0 entfällt",
      "entries": [
        {"passcode":"14558127","name":"Ash Blossom & Joyous Spring","count":2,"section":"main"},
        {"passcode":"23434538","name":"Maxx \"C\"","count":1,"section":"main"},
        {"passcode":"14558127","name":"Ash Blossom & Joyous Spring","count":1,"section":"main"},
        {"passcode":"4031928","name":null,"count":1,"section":"main"},
        {"passcode":"90448279","name":"Divine Arsenal AA-ZEUS - Sky Thunder","count":1,"section":"extra"},
        {"passcode":"1861629","name":"Decode Talker","count":1,"section":"extra"},
        {"passcode":"27204311","name":"Nibiru, the Primal Being","count":2,"section":"side"},
        {"passcode":"55144522","name":"Pot of Greed","count":0,"section":"side"}
      ],
      "ydk": "#created by YGO Card Manager\n#main\n14558127\n14558127\n23434538\n14558127\n4031928\n#extra\n90448279\n1861629\n!side\n27204311\n27204311\n",
      "ydke": "ydke://ryPeAK8j3gAqlWUBryPeALiFPQA=!lyFkBf1nHAA=!1xqfAdcanwE=!",
      "text": "Main Deck\n3 Ash Blossom & Joyous Spring\n1 Maxx \"C\"\n1 4031928\nExtra Deck\n1 Divine Arsenal AA-ZEUS - Sky Thunder\n1 Decode Talker\nSide Deck\n2 Nibiru, the Primal Being",
      "roundtrip": [{"passcode":"14558127","count":3,"section":"main"},{"passcode":"23434538","count":1,"section":"main"},{"passcode":"4031928","count":1,"section":"main"},{"passcode":"90448279","count":1,"section":"extra"},{"passcode":"1861629","count":1,"section":"extra"},{"passcode":"27204311","count":2,"section":"side"}]
    },
    {
      "name": "nur Side",
      "entries": [{"passcode":"55144522","name":"Pot of Greed","count":1,"section":"side"}],
      "ydk": "#created by YGO Card Manager\n#main\n#extra\n!side\n55144522\n",
      "ydke": "ydke://!!SnBJAw==!",
      "text": "Side Deck\n1 Pot of Greed",
      "roundtrip": [{"passcode":"55144522","count":1,"section":"side"}]
    },
    {
      "name": "leeres Deck",
      "entries": [],
      "ydk": "#created by YGO Card Manager\n#main\n#extra\n!side\n",
      "ydke": "ydke://!!!",
      "text": "",
      "roundtrip": []
    }
  ]
}
```

- [ ] **Step 3: Test schreiben**

`desktop/src/utils/deckFormats.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDeckText, detectFormat, buildYdk, buildYdke, buildTextList, parseTextList, normalizePasscode } from './deckFormats.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DeckFormatsTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/formats.json', import.meta.url), 'utf8'));

for (const c of FIX.parse) {
  test(`Fixture lesen: ${c.name}`, () => {
    const got = c.format ? parseDeckText(c.text, c.format) : parseDeckText(c.text);
    assert.deepEqual({ ...got, error: got.error ?? null }, c.expected);
  });
}

test('Fixture: Erkennung', () => {
  for (const d of FIX.detect) assert.equal(detectFormat(d.text), d.format, JSON.stringify(d.text));
});

const sectionSums = (cards) => ['main', 'extra', 'side'].map((s) => cards.filter((c) => c.section === s).reduce((a, c) => a + c.count, 0));

for (const b of FIX.build) {
  test(`Fixture schreiben und zurücklesen: ${b.name}`, () => {
    assert.equal(buildYdk(b.entries), b.ydk);
    assert.equal(buildYdke(b.entries), b.ydke);
    assert.equal(buildTextList(b.entries), b.text);
    if (b.roundtrip.length) {
      assert.deepEqual(parseDeckText(b.ydk).cards, b.roundtrip);
      assert.deepEqual(parseDeckText(b.ydke).cards, b.roundtrip);
      assert.deepEqual(sectionSums(parseTextList(b.text).cards), sectionSums(b.roundtrip));
    }
  });
}

test('Passcodes: führende Nullen weg, 0 und zu groß ungültig', () => {
  assert.equal(normalizePasscode('04031928'), '4031928');
  assert.equal(normalizePasscode('4294967295'), '4294967295');
  assert.equal(normalizePasscode('4294967296'), null);
  assert.equal(normalizePasscode('0000'), null);
  assert.equal(normalizePasscode('12a'), null);
});
```

- [ ] **Step 4: Fehlschlag bestätigen**

Run (in `desktop/`): `node --test src/utils/deckFormats.test.js`
Expected: FAIL mit `Cannot find module …/deckFormats.js`.

- [ ] **Step 5: `deckFormats.js` anlegen**

```js
// Spec E2 §3 — Decklisten-Formate YDK, YDKE und Textliste: lesen, schreiben, erkennen.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/DeckFormats.kt. Beide laufen gegen
// docs/fixtures/decks/formats.json. Wer eine Seite aendert, aendert beide.

export const YDKE_INVALID = 'Kein gültiger YDKE-Link';
export const NOTHING_RECOGNIZED = 'Keine Deckliste erkannt';
export const YDK_HEADER = '#created by YGO Card Manager';

const MAX_UINT32 = 4294967295;
// Standard-Base64 mit Auffuellung; leerer Block erlaubt. Beide Zwillinge pruefen mit DIESEM Muster, weil atob und
// java.util.Base64 unterschiedlich nachsichtig sind.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const HEADING = /^(main|extra|side)(?:\s+deck)?\s*(?::|\([0-9]+\))?$/i;
// [0-9] statt \d und Unicode-\s (geschuetztes Leerzeichen aus Webseiten): der Kotlin-Zwilling nutzt dafuer (?U).
const COUNT_FIRST = /^([0-9]+)(?:\s*[xX])?\s+(\S.*)$/;
const COUNT_LAST = /^(.+?)\s+[xX]([0-9]+)$/;

// Passcode als Zahl ohne fuehrende Nullen ("04031928" -> "4031928"); 1..2^32-1, sonst null.
export function normalizePasscode(raw) {
  const t = String(raw).trim();
  if (!/^[0-9]{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_UINT32 ? String(n) : null;
}

// Gleiche Passcodes je Abschnitt summieren, Reihenfolge des ersten Auftretens.
function addCard(cards, passcode, section, count) {
  const hit = cards.find((c) => c.passcode === passcode && c.section === section);
  if (hit) hit.count += count;
  else cards.push({ passcode, count, section });
}

export function parseYdk(text) {
  const cards = [];
  const unresolved = [];
  let section = 'main';
  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    const lower = t.toLowerCase();
    if (lower === '#main') section = 'main';
    else if (lower === '#extra') section = 'extra';
    else if (lower === '!side') section = 'side';
    else if (t.startsWith('#')) continue;
    else {
      const passcode = normalizePasscode(t);
      if (passcode) addCard(cards, passcode, section, 1);
      else unresolved.push(t);
    }
  }
  return { format: 'ydk', cards, unresolved };
}

function decodeBlock(block) {
  if (!BASE64.test(block)) return null;
  const bin = atob(block);
  if (bin.length % 4 !== 0) return null;
  const out = [];
  for (let i = 0; i < bin.length; i += 4) {
    out.push((bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0);
  }
  return out;
}

export function parseYdke(text) {
  const invalid = { format: 'ydke', cards: [], unresolved: [], error: YDKE_INVALID };
  const body = String(text).trim();
  if (!body.startsWith('ydke://')) return invalid;
  let parts = body.slice('ydke://'.length).replace(/\s+/g, '').split('!');
  if (parts.length === 4 && parts[3] === '') parts = parts.slice(0, 3);
  if (parts.length !== 3) return invalid;
  const cards = [];
  const unresolved = [];
  const sections = ['main', 'extra', 'side'];
  for (let s = 0; s < 3; s++) {
    const codes = decodeBlock(parts[s]);
    if (!codes) return invalid;
    for (const n of codes) {
      if (n === 0) unresolved.push('0');
      else addCard(cards, String(n), sections[s], 1);
    }
  }
  return { format: 'ydke', cards, unresolved };
}

// Kartenzeilen "3 Name", "3x Name", "3 x Name", "Name x3", "Name"; Ueberschriften Main/Extra/Side (Deck) mit ":" oder
// "(n)". Ohne Ueberschrift davor: section "unknown". Zeilen werden NICHT zusammengefasst (Rohzeile bleibt fuer die Notizen).
export function parseTextList(text) {
  const cards = [];
  const unresolved = [];
  let section = 'unknown';
  for (const raw of String(text).split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('//')) continue;
    const heading = HEADING.exec(t);
    if (heading) { section = heading[1].toLowerCase(); continue; }
    let count = 1;
    let name = t;
    const first = COUNT_FIRST.exec(t);
    const last = first ? null : COUNT_LAST.exec(t);
    if (first) { count = Number(first[1]); name = first[2]; }
    else if (last) { name = last[1]; count = Number(last[2]); }
    if (!(count >= 1 && count <= 99)) { unresolved.push(t); continue; }
    cards.push({ name: name.trim(), count, section, line: t });
  }
  return { format: 'text', cards, unresolved };
}

export function detectFormat(text) {
  const body = String(text).trim();
  if (body.startsWith('ydke://')) return 'ydke';
  const lines = body.split(/\r?\n/).map((l) => l.trim().toLowerCase());
  if (lines.includes('#main') || lines.includes('!side')) return 'ydk';
  return 'text';
}

// Einstieg fuer Einfuegen/Teilen/YDK-Datei: erkennt (oder nimmt das vorgegebene Format), liest, und meldet
// "Keine Deckliste erkannt", wenn keine einzige Karte gelesen wurde.
export function parseDeckText(text, format = detectFormat(text)) {
  const parsed = format === 'ydke' ? parseYdke(text) : format === 'ydk' ? parseYdk(text) : parseTextList(text);
  if (parsed.error) return parsed;
  if (parsed.cards.length === 0) return { ...parsed, error: NOTHING_RECOGNIZED };
  return parsed;
}

const live = (entries) => (entries || []).filter((e) => e && e.count > 0);
const ofSection = (entries, section) => live(entries).filter((e) => e.section === section);

// entries: [{ passcode, name?, count, section }] (mehrere Zeilen je Passcode erlaubt).
export function buildYdk(entries) {
  const lines = [YDK_HEADER];
  for (const [head, section] of [['#main', 'main'], ['#extra', 'extra'], ['!side', 'side']]) {
    lines.push(head);
    for (const e of ofSection(entries, section)) for (let i = 0; i < e.count; i++) lines.push(String(e.passcode));
  }
  return `${lines.join('\n')}\n`;
}

function encodeBlock(entries) {
  let bin = '';
  for (const e of entries) {
    const n = Number(e.passcode) >>> 0;
    const four = String.fromCharCode(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
    for (let i = 0; i < e.count; i++) bin += four;
  }
  return btoa(bin);
}

export function buildYdke(entries) {
  return `ydke://${['main', 'extra', 'side'].map((s) => `${encodeBlock(ofSection(entries, s))}!`).join('')}`;
}

// "Main Deck" / "3 Name" …; je Abschnitt nach Passcode summiert (Reihenfolge des ersten Auftretens), leere Abschnitte
// entfallen, Name faellt auf den Passcode zurueck. Zeilen mit "\n" verbunden, ohne Zeilenumbruch am Ende.
export function buildTextList(entries) {
  const lines = [];
  for (const [head, section] of [['Main Deck', 'main'], ['Extra Deck', 'extra'], ['Side Deck', 'side']]) {
    const summed = [];
    for (const e of ofSection(entries, section)) {
      const hit = summed.find((x) => x.passcode === String(e.passcode));
      if (hit) hit.count += e.count;
      else summed.push({ passcode: String(e.passcode), name: e.name || String(e.passcode), count: e.count });
    }
    if (summed.length === 0) continue;
    lines.push(head);
    for (const x of summed) lines.push(`${x.count} ${x.name}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 6: Tests und Lint**

Run (in `desktop/`): `node --test src/utils/deckFormats.test.js` → `ℹ pass 24`, `ℹ fail 0`.
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 169`.
Run (in `desktop/`): `npx eslint .` → `5 errors` (unverändert).

- [ ] **Step 7: Schutz-Nachweis**

(a) In `decodeBlock` die Zeile `  if (!BASE64.test(block)) return null;` kurz durch `  try { atob(block); } catch { return null; }` ersetzen → `Fixture lesen: YDKE: fehlende Auffüllung ist ungültig` scheitert (gemessen: `atob` nimmt `ryPeAA` ohne Auffüllung an). Zitieren, zurücknehmen.
(b) In `parseYdke` `if (parts.length !== 3) return invalid;` kurz durch `if (parts.length < 3) return invalid;` ersetzen → `Fixture lesen: YDKE: mehr als drei Blöcke` scheitert (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add supabase/decks_notes.sql docs/fixtures/decks/formats.json desktop/src/utils/deckFormats.js desktop/src/utils/deckFormats.test.js
git commit -m "feat(e2): decks.notes (SQL) und Formate YDK/YDKE/Textliste als JS-Zwilling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: JS-Zwilling `deckImport` mit Fixture

**Files:**
- Create: `docs/fixtures/decks/import.json`
- Create: `desktop/src/utils/deckImport.js`
- Create: `desktop/src/utils/deckImport.test.js`

**Interfaces:**
- Produces (für Task 4, 5): in `deckImport.js` `CATALOG_MISSING`, `NOT_FOUND`, `DEFAULT_DECK_NAME`, `NOTES_HEAD`, `AMBIGUOUS`, `OPEN`, `deckSectionFor(type) → 'main'|'extra'`, `moveTarget(section, type) → 'main'|'extra'|'side'`, `moveLabel(section) → '→ Side'|'→ Deck'`, `normalizeName(s) → string`, `levenshtein(a, b) → number`, `unknownPasscodeText(passcode)`, `suggestionText(name)`, `ambiguousOptionText({ name, passcode })`, `failedText(message)`, `countsText({ main, extra, side })`, `skippedText(n) → string|null`, `deckNameFor(fileName) → string`, `resolveImport(parsed, catalogCards|null) → { catalogMissing, rows: [{ status, count, section, source, candidates: [{ passcode, name, type }] }], unresolved }`, `importPlan(resolved, choices = {}) → { cards: [{ card_id, name, count, section }], counts: { main, extra, side }, skipped: string[], skippedLabels: string[], notes: string|null }`, `async prepareImport(text, format, loadCatalog) → { error } | { resolved }` mit `loadCatalog(ids: string[]|null) → Promise<{ available, cards: [{ id, name_de, name_en, type }] }>`.
- Produces (Fixture, für Task 5): `import.json` mit `catalog[]`, `normalize[]`, `levenshtein[]`, `sectionFor[]`, `moveTarget[]`, `resolve[] { name, catalog: bool, parsed, expected { catalogMissing, rows[] (candidates als Passcodes) }, plans[] { choices, expected { cards, counts, skipped, skippedLabels, notes, countsText, skippedText } } }`, `texts { failed, deckName, suggestion, ambiguousOption, unknownPasscode }`.
- Consumes (Task 1): `parseDeckText`.

- [ ] **Step 1: Fixture schreiben**

Handrechnung der großen Textliste ohne Auswahl: Asche-Blüte 3 + 2 (EN exakt + DE normalisiert) = 5, dazu Maxx 1, Weiße Straße 1, Élan Fusion 1 → Main 8; Extra 1; Side 2; nicht übernommen 1 Lesezeile + 9 Zeilen = 10. Mit Auswahl: + Dunkler Magier 1 + Rune Gate 3 + Zwillingskarte 1 + Spielmarke 1 + Raigeki 1 = Main 15; die Wahl `99999999` für `Raigekixx` ist kein Kandidat und bleibt offen. `Rune Kate`: Date/Gate/Late/Mate haben Abstand 1, alphabetisch die ersten drei; `Rune Bxte` (alphabetisch zuerst, Abstand 2) fällt heraus — Abstand vor Alphabet. `Jinzu` (5 Zeichen) bekommt keinen Vorschlag, obwohl `Jinzo` Abstand 1 hat.

`docs/fixtures/decks/import.json`:
```json
{
  "_comment": "Spec E2 §4/§5 — Namensaufloesung, Abschnittsregel, Vorschau-Plan, Texte. Leser: desktop/src/utils/deckImport.test.js und android DeckImportTest.kt. resolve[].catalog false = kein Katalog (null). expected.rows[].candidates sind Passcodes; plans[].choices: Zeilenindex -> Passcode. Passcodes 1000xxxx sind erfundene Testkarten.",
  "catalog": [
    {"id":14558127,"name_de":"Asche-Blüte & Freudiger Frühling","name_en":"Ash Blossom & Joyous Spring","type":"Tuner Monster"},
    {"id":23434538,"name_de":"Maxx „C“","name_en":"Maxx \"C\"","type":"Effect Monster"},
    {"id":27204311,"name_de":"Nibiru, das Urwesen","name_en":"Nibiru, the Primal Being","type":"Effect Monster"},
    {"id":55144522,"name_de":"Topf der Gier","name_en":"Pot of Greed","type":"Spell Card"},
    {"id":46986414,"name_de":"Dunkler Magier","name_en":"Dark Magician","type":"Normal Monster"},
    {"id":90448279,"name_de":"Göttliches Arsenal AA-ZEUS – Himmelsdonner","name_en":"Divine Arsenal AA-ZEUS - Sky Thunder","type":"XYZ Monster"},
    {"id":1861629,"name_de":"Decode Talker","name_en":"Decode Talker","type":"Link Monster"},
    {"id":12580477,"name_de":"Raigeki","name_en":"Raigeki","type":"Spell Card"},
    {"id":77585513,"name_de":"Jinzo","name_en":"Jinzo","type":"Effect Monster"},
    {"id":10000001,"name_de":"Weiße Straße","name_en":"White Street","type":"Trap Card"},
    {"id":10000011,"name_de":"Zwillingskarte","name_en":"Twin-Card","type":"Spell Card"},
    {"id":10000012,"name_de":"Zwillingskarte Zwei","name_en":"Twin Card","type":"Spell Card"},
    {"id":10000021,"name_de":"Spielmarke","name_en":"Token","type":"Token"},
    {"id":10000022,"name_de":"Spielmarke","name_en":"Token","type":"Token"},
    {"id":10000031,"name_de":"Rune Date","name_en":"Rune Date","type":"Spell Card"},
    {"id":10000032,"name_de":"Rune Gate","name_en":"Rune Gate","type":"Spell Card"},
    {"id":10000033,"name_de":"Rune Late","name_en":"Rune Late","type":"Spell Card"},
    {"id":10000034,"name_de":"Rune Mate","name_en":"Rune Mate","type":"Spell Card"},
    {"id":10000035,"name_de":"Rune Bxte","name_en":"Rune Bxte","type":"Spell Card"},
    {"id":10000041,"name_de":"Elfen-Fusion","name_en":"Élan Fusion","type":"Spell Card"},
    {"id":10000051,"name_de":"","name_en":"Only English","type":"Spell Card"}
  ],
  "normalize": [
    {"in":"Asche-Blüte & Freudiger Frühling","out":"asche blute freudiger fruhling"},
    {"in":"Weiße Straße","out":"weisse strasse"},
    {"in":"GROẞE STRAẞE","out":"grosse strasse"},
    {"in":"  Maxx „C“  ","out":"maxx c"},
    {"in":"Élan Fusion","out":"elan fusion"},
    {"in":"Divine Arsenal AA-ZEUS - Sky Thunder","out":"divine arsenal aa zeus sky thunder"},
    {"in":"Number 39: Utopia","out":"number 39 utopia"},
    {"in":"ﬁnal","out":"final"},
    {"in":"","out":""}
  ],
  "levenshtein": [
    {"a":"","b":"","d":0},
    {"a":"kitten","b":"sitting","d":3},
    {"a":"raigek","b":"raigeki","d":1},
    {"a":"rune kate","b":"rune bxte","d":2},
    {"a":"abc","b":"","d":3}
  ],
  "sectionFor": [
    {"type":"Fusion Monster","section":"extra"},
    {"type":"Synchro Tuner Monster","section":"extra"},
    {"type":"XYZ Pendulum Effect Monster","section":"extra"},
    {"type":"Link Monster","section":"extra"},
    {"type":"Pendulum Effect Fusion Monster","section":"extra"},
    {"type":"xyz monster","section":"extra"},
    {"type":"Effect Monster","section":"main"},
    {"type":"Spell Card","section":"main"},
    {"type":"Token","section":"main"},
    {"type":"","section":"main"},
    {"type":null,"section":"main"}
  ],
  "moveTarget": [
    {"section":"main","type":"Effect Monster","target":"side","label":"→ Side"},
    {"section":"extra","type":"Link Monster","target":"side","label":"→ Side"},
    {"section":"side","type":"Link Monster","target":"extra","label":"→ Deck"},
    {"section":"side","type":"Spell Card","target":"main","label":"→ Deck"},
    {"section":"side","type":null,"target":"main","label":"→ Deck"}
  ],
  "resolve": [
    {
      "name": "per Passcode: Name DE, unbekannter Passcode, Rohzeile aus dem Lesen",
      "catalog": true,
      "parsed": {"format":"ydk","cards":[{"passcode":"14558127","count":3,"section":"main"},{"passcode":"99999999","count":1,"section":"main"},{"passcode":"90448279","count":1,"section":"extra"},{"passcode":"27204311","count":2,"section":"side"}],"unresolved":["abc"]},
      "expected": {"catalogMissing":false,"rows":[
        {"status":"ok","count":3,"section":"main","source":"14558127","candidates":["14558127"]},
        {"status":"unknownPasscode","count":1,"section":"main","source":"99999999","candidates":[]},
        {"status":"ok","count":1,"section":"extra","source":"90448279","candidates":["90448279"]},
        {"status":"ok","count":2,"section":"side","source":"27204311","candidates":["27204311"]}
      ]},
      "plans": [
        {"choices":{},"expected":{
          "cards":[{"card_id":"14558127","name":"Asche-Blüte & Freudiger Frühling","count":3,"section":"main"},{"card_id":"90448279","name":"Göttliches Arsenal AA-ZEUS – Himmelsdonner","count":1,"section":"extra"},{"card_id":"27204311","name":"Nibiru, das Urwesen","count":2,"section":"side"}],
          "counts":{"main":3,"extra":1,"side":2},
          "skipped":["abc","Unbekannter Passcode 99999999"],
          "skippedLabels":["abc","Unbekannter Passcode 99999999"],
          "notes":"Nicht übernommen beim Import:\nabc\nUnbekannter Passcode 99999999",
          "countsText":"Main 3 · Extra 1 · Side 2",
          "skippedText":"2 nicht übernommen"
        }}
      ]
    },
    {
      "name": "per Passcode: ohne deutschen Namen gilt der englische",
      "catalog": true,
      "parsed": {"format":"ydke","cards":[{"passcode":"10000051","count":1,"section":"main"}],"unresolved":[]},
      "expected": {"catalogMissing":false,"rows":[{"status":"ok","count":1,"section":"main","source":"10000051","candidates":["10000051"]}]},
      "plans": [
        {"choices":{},"expected":{"cards":[{"card_id":"10000051","name":"Only English","count":1,"section":"main"}],"counts":{"main":1,"extra":0,"side":0},"skipped":[],"skippedLabels":[],"notes":null,"countsText":"Main 1 · Extra 0 · Side 0","skippedText":null}}
      ]
    },
    {
      "name": "Textliste mit Überschriften: exakt, normalisiert (Umlaute, ß, Satzzeichen, Akzent), Vorschläge, Mehrdeutig, Grenzen",
      "catalog": true,
      "parsed": {"format":"text","cards":[
        {"name":"Ash Blossom & Joyous Spring","count":3,"section":"main","line":"3 Ash Blossom & Joyous Spring"},
        {"name":"Asche Blute & Freudiger Fruhling","count":2,"section":"main","line":"2 Asche Blute & Freudiger Fruhling"},
        {"name":"Maxx C","count":1,"section":"main","line":"1 Maxx C"},
        {"name":"weisse strasse","count":1,"section":"main","line":"1 weisse strasse"},
        {"name":"Elan Fusion","count":1,"section":"main","line":"1 Elan Fusion"},
        {"name":"Dark Magican","count":1,"section":"main","line":"Dark Magican"},
        {"name":"Rune Kate","count":3,"section":"main","line":"3 Rune Kate"},
        {"name":"twin card!","count":1,"section":"main","line":"twin card!"},
        {"name":"TOKEN","count":1,"section":"main","line":"TOKEN"},
        {"name":"Dork Mogicien","count":1,"section":"main","line":"Dork Mogicien"},
        {"name":"Jinzu","count":1,"section":"main","line":"Jinzu"},
        {"name":"Raigek","count":1,"section":"main","line":"Raigek"},
        {"name":"Raigekixx","count":1,"section":"main","line":"Raigekixx"},
        {"name":"Raigekixxx","count":1,"section":"main","line":"Raigekixxx"},
        {"name":"Divine Arsenal AA-ZEUS - Sky Thunder","count":1,"section":"extra","line":"1 Divine Arsenal AA-ZEUS - Sky Thunder"},
        {"name":"Nibiru, the Primal Being","count":2,"section":"side","line":"2 Nibiru, the Primal Being"}
      ],"unresolved":["0 Pot of Greed"]},
      "expected": {"catalogMissing":false,"rows":[
        {"status":"ok","count":3,"section":"main","source":"3 Ash Blossom & Joyous Spring","candidates":["14558127"]},
        {"status":"ok","count":2,"section":"main","source":"2 Asche Blute & Freudiger Fruhling","candidates":["14558127"]},
        {"status":"ok","count":1,"section":"main","source":"1 Maxx C","candidates":["23434538"]},
        {"status":"ok","count":1,"section":"main","source":"1 weisse strasse","candidates":["10000001"]},
        {"status":"ok","count":1,"section":"main","source":"1 Elan Fusion","candidates":["10000041"]},
        {"status":"suggest","count":1,"section":"main","source":"Dark Magican","candidates":["46986414"]},
        {"status":"suggest","count":3,"section":"main","source":"3 Rune Kate","candidates":["10000031","10000032","10000033"]},
        {"status":"ambiguous","count":1,"section":"main","source":"twin card!","candidates":["10000011","10000012"]},
        {"status":"ambiguous","count":1,"section":"main","source":"TOKEN","candidates":["10000021","10000022"]},
        {"status":"notFound","count":1,"section":"main","source":"Dork Mogicien","candidates":[]},
        {"status":"notFound","count":1,"section":"main","source":"Jinzu","candidates":[]},
        {"status":"suggest","count":1,"section":"main","source":"Raigek","candidates":["12580477"]},
        {"status":"suggest","count":1,"section":"main","source":"Raigekixx","candidates":["12580477"]},
        {"status":"notFound","count":1,"section":"main","source":"Raigekixxx","candidates":[]},
        {"status":"ok","count":1,"section":"extra","source":"1 Divine Arsenal AA-ZEUS - Sky Thunder","candidates":["90448279"]},
        {"status":"ok","count":2,"section":"side","source":"2 Nibiru, the Primal Being","candidates":["27204311"]}
      ]},
      "plans": [
        {"choices":{},"expected":{
          "cards":[
            {"card_id":"14558127","name":"Asche-Blüte & Freudiger Frühling","count":5,"section":"main"},
            {"card_id":"23434538","name":"Maxx „C“","count":1,"section":"main"},
            {"card_id":"10000001","name":"Weiße Straße","count":1,"section":"main"},
            {"card_id":"10000041","name":"Elfen-Fusion","count":1,"section":"main"},
            {"card_id":"90448279","name":"Göttliches Arsenal AA-ZEUS – Himmelsdonner","count":1,"section":"extra"},
            {"card_id":"27204311","name":"Nibiru, das Urwesen","count":2,"section":"side"}
          ],
          "counts":{"main":8,"extra":1,"side":2},
          "skipped":["0 Pot of Greed","Dark Magican","3 Rune Kate","twin card!","TOKEN","Dork Mogicien","Jinzu","Raigek","Raigekixx","Raigekixxx"],
          "skippedLabels":["0 Pot of Greed","Dark Magican · offen","3 Rune Kate · offen","twin card! · offen","TOKEN · offen","Dork Mogicien · Nicht gefunden","Jinzu · Nicht gefunden","Raigek · offen","Raigekixx · offen","Raigekixxx · Nicht gefunden"],
          "notes":"Nicht übernommen beim Import:\n0 Pot of Greed\nDark Magican\n3 Rune Kate\ntwin card!\nTOKEN\nDork Mogicien\nJinzu\nRaigek\nRaigekixx\nRaigekixxx",
          "countsText":"Main 8 · Extra 1 · Side 2",
          "skippedText":"10 nicht übernommen"
        }},
        {"choices":{"5":"46986414","6":"10000032","7":"10000011","8":"10000022","11":"12580477","12":"99999999"},"expected":{
          "cards":[
            {"card_id":"14558127","name":"Asche-Blüte & Freudiger Frühling","count":5,"section":"main"},
            {"card_id":"23434538","name":"Maxx „C“","count":1,"section":"main"},
            {"card_id":"10000001","name":"Weiße Straße","count":1,"section":"main"},
            {"card_id":"10000041","name":"Elfen-Fusion","count":1,"section":"main"},
            {"card_id":"46986414","name":"Dunkler Magier","count":1,"section":"main"},
            {"card_id":"10000032","name":"Rune Gate","count":3,"section":"main"},
            {"card_id":"10000011","name":"Zwillingskarte","count":1,"section":"main"},
            {"card_id":"10000022","name":"Spielmarke","count":1,"section":"main"},
            {"card_id":"12580477","name":"Raigeki","count":1,"section":"main"},
            {"card_id":"90448279","name":"Göttliches Arsenal AA-ZEUS – Himmelsdonner","count":1,"section":"extra"},
            {"card_id":"27204311","name":"Nibiru, das Urwesen","count":2,"section":"side"}
          ],
          "counts":{"main":15,"extra":1,"side":2},
          "skipped":["0 Pot of Greed","Dork Mogicien","Jinzu","Raigekixx","Raigekixxx"],
          "skippedLabels":["0 Pot of Greed","Dork Mogicien · Nicht gefunden","Jinzu · Nicht gefunden","Raigekixx · offen","Raigekixxx · Nicht gefunden"],
          "notes":"Nicht übernommen beim Import:\n0 Pot of Greed\nDork Mogicien\nJinzu\nRaigekixx\nRaigekixxx",
          "countsText":"Main 15 · Extra 1 · Side 2",
          "skippedText":"5 nicht übernommen"
        }}
      ]
    },
    {
      "name": "Textliste ohne Überschrift: Abschnitt per Typ, auch nach Auswahl eines Vorschlags",
      "catalog": true,
      "parsed": {"format":"text","cards":[
        {"name":"Ash Blossom & Joyous Spring","count":3,"section":"unknown","line":"3 Ash Blossom & Joyous Spring"},
        {"name":"Divine Arsenal AA-ZEUS - Sky Thunder","count":1,"section":"unknown","line":"1 Divine Arsenal AA-ZEUS - Sky Thunder"},
        {"name":"Decode Talker","count":1,"section":"unknown","line":"Decode Talker"},
        {"name":"Decode Talker","count":1,"section":"unknown","line":"Decode Talker"},
        {"name":"Dark Magican","count":1,"section":"unknown","line":"Dark Magican"},
        {"name":"Decode Talkr","count":1,"section":"unknown","line":"Decode Talkr"}
      ],"unresolved":[]},
      "expected": {"catalogMissing":false,"rows":[
        {"status":"ok","count":3,"section":"unknown","source":"3 Ash Blossom & Joyous Spring","candidates":["14558127"]},
        {"status":"ok","count":1,"section":"unknown","source":"1 Divine Arsenal AA-ZEUS - Sky Thunder","candidates":["90448279"]},
        {"status":"ok","count":1,"section":"unknown","source":"Decode Talker","candidates":["1861629"]},
        {"status":"ok","count":1,"section":"unknown","source":"Decode Talker","candidates":["1861629"]},
        {"status":"suggest","count":1,"section":"unknown","source":"Dark Magican","candidates":["46986414"]},
        {"status":"suggest","count":1,"section":"unknown","source":"Decode Talkr","candidates":["1861629"]}
      ]},
      "plans": [
        {"choices":{},"expected":{
          "cards":[{"card_id":"14558127","name":"Asche-Blüte & Freudiger Frühling","count":3,"section":"main"},{"card_id":"90448279","name":"Göttliches Arsenal AA-ZEUS – Himmelsdonner","count":1,"section":"extra"},{"card_id":"1861629","name":"Decode Talker","count":2,"section":"extra"}],
          "counts":{"main":3,"extra":3,"side":0},
          "skipped":["Dark Magican","Decode Talkr"],
          "skippedLabels":["Dark Magican · offen","Decode Talkr · offen"],
          "notes":"Nicht übernommen beim Import:\nDark Magican\nDecode Talkr",
          "countsText":"Main 3 · Extra 3 · Side 0",
          "skippedText":"2 nicht übernommen"
        }},
        {"choices":{"4":"46986414","5":"1861629"},"expected":{
          "cards":[{"card_id":"14558127","name":"Asche-Blüte & Freudiger Frühling","count":3,"section":"main"},{"card_id":"90448279","name":"Göttliches Arsenal AA-ZEUS – Himmelsdonner","count":1,"section":"extra"},{"card_id":"1861629","name":"Decode Talker","count":3,"section":"extra"},{"card_id":"46986414","name":"Dunkler Magier","count":1,"section":"main"}],
          "counts":{"main":4,"extra":4,"side":0},
          "skipped":[],
          "skippedLabels":[],
          "notes":null,
          "countsText":"Main 4 · Extra 4 · Side 0",
          "skippedText":null
        }}
      ]
    },
    {
      "name": "Katalog fehlt: Passcodes werden unbekannt",
      "catalog": false,
      "parsed": {"format":"ydke","cards":[{"passcode":"14558127","count":1,"section":"main"}],"unresolved":[]},
      "expected": {"catalogMissing":true,"rows":[{"status":"unknownPasscode","count":1,"section":"main","source":"14558127","candidates":[]}]},
      "plans": [
        {"choices":{},"expected":{"cards":[],"counts":{"main":0,"extra":0,"side":0},"skipped":["Unbekannter Passcode 14558127"],"skippedLabels":["Unbekannter Passcode 14558127"],"notes":"Nicht übernommen beim Import:\nUnbekannter Passcode 14558127","countsText":"Main 0 · Extra 0 · Side 0","skippedText":"1 nicht übernommen"}}
      ]
    },
    {
      "name": "Katalog fehlt: Namen werden nicht gefunden",
      "catalog": false,
      "parsed": {"format":"text","cards":[{"name":"Raigeki","count":1,"section":"unknown","line":"Raigeki"}],"unresolved":[]},
      "expected": {"catalogMissing":true,"rows":[{"status":"notFound","count":1,"section":"unknown","source":"Raigeki","candidates":[]}]},
      "plans": [
        {"choices":{},"expected":{"cards":[],"counts":{"main":0,"extra":0,"side":0},"skipped":["Raigeki"],"skippedLabels":["Raigeki · Nicht gefunden"],"notes":"Nicht übernommen beim Import:\nRaigeki","countsText":"Main 0 · Extra 0 · Side 0","skippedText":"1 nicht übernommen"}}
      ]
    }
  ],
  "texts": {
    "failed": [{"message":"duplicate key","text":"Import fehlgeschlagen: duplicate key"}],
    "deckName": [{"file":"Tenpai Dragon","name":"Tenpai Dragon"},{"file":"  ","name":"Importiertes Deck"},{"file":null,"name":"Importiertes Deck"}],
    "suggestion": [{"name":"Dunkler Magier","text":"Meintest du Dunkler Magier?"}],
    "ambiguousOption": [{"passcode":"10000021","name":"Spielmarke","text":"Spielmarke (10000021)"}],
    "unknownPasscode": [{"passcode":"12345678","text":"Unbekannter Passcode 12345678"}]
  }
}
```

- [ ] **Step 2: Test schreiben**

`desktop/src/utils/deckImport.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeName, levenshtein, deckSectionFor, moveTarget, moveLabel, resolveImport, importPlan, countsText, skippedText,
  failedText, deckNameFor, suggestionText, ambiguousOptionText, unknownPasscodeText, prepareImport,
} from './deckImport.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DeckImportTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/import.json', import.meta.url), 'utf8'));

test('Fixture: Normalisierung', () => {
  for (const c of FIX.normalize) assert.equal(normalizeName(c.in), c.out, c.in);
});

test('Fixture: Levenshtein', () => {
  for (const c of FIX.levenshtein) assert.equal(levenshtein(c.a, c.b), c.d, `${c.a}/${c.b}`);
});

test('Fixture: Abschnitt per Typ und Zeilenaktion', () => {
  for (const c of FIX.sectionFor) assert.equal(deckSectionFor(c.type), c.section, String(c.type));
  for (const c of FIX.moveTarget) {
    assert.equal(moveTarget(c.section, c.type), c.target, `${c.section}/${c.type}`);
    assert.equal(moveLabel(c.section), c.label);
  }
});

for (const c of FIX.resolve) {
  test(`Fixture auflösen: ${c.name}`, () => {
    const resolved = resolveImport(c.parsed, c.catalog ? FIX.catalog : null);
    assert.equal(resolved.catalogMissing, c.expected.catalogMissing);
    assert.deepEqual(resolved.rows.map((r) => ({ ...r, candidates: r.candidates.map((x) => x.passcode) })), c.expected.rows);
    for (const p of c.plans) {
      const plan = importPlan(resolved, p.choices);
      const { countsText: ct, skippedText: st, ...rest } = p.expected;
      assert.deepEqual(plan, rest, JSON.stringify(p.choices));
      assert.equal(countsText(plan.counts), ct);
      assert.equal(skippedText(plan.skipped.length), st);
    }
  });
}

test('Fixture: Texte', () => {
  for (const t of FIX.texts.failed) assert.equal(failedText(t.message), t.text);
  for (const t of FIX.texts.deckName) assert.equal(deckNameFor(t.file), t.name);
  for (const t of FIX.texts.suggestion) assert.equal(suggestionText(t.name), t.text);
  for (const t of FIX.texts.ambiguousOption) assert.equal(ambiguousOptionText(t), t.text);
  for (const t of FIX.texts.unknownPasscode) assert.equal(unknownPasscodeText(t.passcode), t.text);
});

test('Vorschau vorbereiten: YDKE lädt nur die gelesenen Passcodes, Textliste alle, Lesefehler lädt nichts', async () => {
  const calls = [];
  const load = async (ids) => { calls.push(ids); return { available: true, cards: FIX.catalog }; };
  const ydke = await prepareImport('ydke://ryPeAA==!!!', undefined, load);
  assert.deepEqual(calls, [['14558127']]);
  assert.equal(ydke.resolved.rows[0].status, 'ok');
  const text = await prepareImport('3 Raigeki', undefined, load);
  assert.equal(calls[1], null);
  assert.deepEqual(text.resolved.rows[0].candidates.map((c) => c.passcode), ['12580477']);
  assert.deepEqual(await prepareImport('ydke://kaputt', undefined, load), { error: 'Kein gültiger YDKE-Link' });
  assert.deepEqual(await prepareImport('3 Raigeki', 'ydk', load), { error: 'Keine Deckliste erkannt' });
  assert.equal(calls.length, 2, 'ohne gelesene Karte kein Katalogzugriff');
  const missing = await prepareImport('3 Raigeki', undefined, async () => ({ available: false, cards: [] }));
  assert.equal(missing.resolved.catalogMissing, true);
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run (in `desktop/`): `node --test src/utils/deckImport.test.js`
Expected: FAIL mit `Cannot find module …/deckImport.js`.

- [ ] **Step 4: `deckImport.js` anlegen**

```js
// Spec E2 §4/§5 — Namensaufloesung gegen den Offline-Katalog, Abschnittsregel, Vorschau-Zahlen, Notizen und Texte.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/DeckImport.kt. Beide laufen gegen
// docs/fixtures/decks/import.json. Wer eine Seite aendert, aendert beide.
import { parseDeckText } from './deckFormats.js';

export const CATALOG_MISSING = 'Katalog fehlt – Namen können nicht aufgelöst werden';
export const NOT_FOUND = 'Nicht gefunden';
export const DEFAULT_DECK_NAME = 'Importiertes Deck';
export const NOTES_HEAD = 'Nicht übernommen beim Import:';
export const AMBIGUOUS = 'Mehrdeutig – bitte wählen';
export const OPEN = 'offen';

const EXTRA_TYPES = ['fusion', 'synchro', 'xyz', 'link'];

// Spec E2 §4: Typ enthaelt Fusion/Synchro/XYZ/Link (Gross/Klein egal) -> extra, sonst main. Auch fuer "Ziel: Deck".
export function deckSectionFor(type) {
  const t = String(type || '').toLowerCase();
  return EXTRA_TYPES.some((x) => t.includes(x)) ? 'extra' : 'main';
}

// Zeilenaktion: aus dem Side-Deck "→ Deck" (Main/Extra per Typ), sonst "→ Side".
export function moveTarget(section, type) {
  return section === 'side' ? deckSectionFor(type) : 'side';
}

export const moveLabel = (section) => (section === 'side' ? '→ Deck' : '→ Side');

// Stufe 2: klein, NFKD, Akzente/Umlaut-Punkte weg, ß -> ss, alles ausser Buchstaben/Ziffern -> ein Leerzeichen, getrimmt.
export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Levenshtein auf UTF-16-Einheiten (Kotlin: Char) -- nach normalizeName praktisch immer ASCII.
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export const unknownPasscodeText = (passcode) => `Unbekannter Passcode ${passcode}`;
export const suggestionText = (name) => `Meintest du ${name}?`;
export const ambiguousOptionText = (c) => `${c.name} (${c.passcode})`;
export const failedText = (message) => `Import fehlgeschlagen: ${message}`;
export const countsText = (counts) => `Main ${counts.main} · Extra ${counts.extra} · Side ${counts.side}`;
export const skippedText = (n) => (n > 0 ? `${n} nicht übernommen` : null);
export const deckNameFor = (fileName) => (fileName && String(fileName).trim() ? String(fileName).trim() : DEFAULT_DECK_NAME);

const displayName = (c) => c.name_de || c.name_en || String(c.id);
const candidate = (c) => ({ passcode: String(c.id), name: displayName(c), type: c.type || '' });
const byNameThenPasscode = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.passcode < b.passcode ? -1 : a.passcode > b.passcode ? 1 : 0);

function addTo(map, key, id) {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [id]);
  else if (!list.includes(id)) list.push(id);
}

// catalogCards: [{ id, name_de, name_en, type }] oder null (kein Katalog). Fuer YDK/YDKE reichen die Karten der
// gelesenen Passcodes, fuer die Textliste braucht es alle.
function buildIndex(catalogCards) {
  const byId = new Map();
  const exact = new Map();
  const norm = new Map();
  const entries = [];
  for (const c of catalogCards || []) {
    const id = String(c.id);
    byId.set(id, c);
    const names = [c.name_de, c.name_en].filter((x) => x);
    const norms = [];
    for (const name of names) {
      addTo(exact, String(name).trim().toLowerCase(), id);
      const n = normalizeName(name);
      addTo(norm, n, id);
      if (n && !norms.includes(n)) norms.push(n);
    }
    entries.push({ id, norms });
  }
  return { byId, exact, norm, entries };
}

function fuzzy(index, n) {
  if (n.length < 6) return [];
  const hits = [];
  for (const e of index.entries) {
    let best = Infinity;
    for (const x of e.norms) {
      if (Math.abs(x.length - n.length) > 2) continue;   // folgt aus Abstand <= 2; spart die Rechnung
      best = Math.min(best, levenshtein(n, x));
    }
    if (best <= 2) hits.push({ ...candidate(index.byId.get(e.id)), distance: best });
  }
  hits.sort((a, b) => a.distance - b.distance || byNameThenPasscode(a, b));
  return hits.slice(0, 3).map((h) => ({ passcode: h.passcode, name: h.name, type: h.type }));
}

const candidatesOf = (index, ids) => ids.map((id) => candidate(index.byId.get(id))).sort(byNameThenPasscode);

// parsed: Ergebnis von parseDeckText (ohne error). Ergebnis-Zeilen:
// { status: ok|ambiguous|suggest|notFound|unknownPasscode, count, section, source, candidates: [{passcode,name,type}] }
// source = Passcode (YDK/YDKE) bzw. Rohzeile (Textliste).
export function resolveImport(parsed, catalogCards) {
  const index = buildIndex(catalogCards);
  const rows = parsed.cards.map((card) => {
    const base = { count: card.count, section: card.section };
    if (card.passcode != null) {
      const c = index.byId.get(String(card.passcode));
      return c
        ? { status: 'ok', ...base, source: card.passcode, candidates: [candidate(c)] }
        : { status: 'unknownPasscode', ...base, source: card.passcode, candidates: [] };
    }
    const source = card.line;
    const exactIds = index.exact.get(String(card.name).trim().toLowerCase());
    const n = normalizeName(card.name);
    const ids = exactIds || (n ? index.norm.get(n) : undefined);
    if (ids) return { status: ids.length === 1 ? 'ok' : 'ambiguous', ...base, source, candidates: candidatesOf(index, ids) };
    const suggestions = fuzzy(index, n);
    return suggestions.length
      ? { status: 'suggest', ...base, source, candidates: suggestions }
      : { status: 'notFound', ...base, source, candidates: [] };
  });
  return { catalogMissing: catalogCards == null, rows, unresolved: parsed.unresolved.slice() };
}

// choices: { [Zeilenindex]: passcode } -- Auswahl bei Vorschlag/Mehrdeutig. Offene Zeilen werden nicht uebernommen.
export function importPlan(resolved, choices = {}) {
  const cards = [];
  const counts = { main: 0, extra: 0, side: 0 };
  const skipped = resolved.unresolved.slice();
  const skippedLabels = resolved.unresolved.slice();   // Anzeige im Block "Nicht übernommen"
  resolved.rows.forEach((row, i) => {
    let chosen = null;
    if (row.status === 'ok') chosen = row.candidates[0];
    else if (row.status === 'ambiguous' || row.status === 'suggest') {
      const pick = choices[i];
      chosen = row.candidates.find((c) => c.passcode === pick) || null;
    }
    if (!chosen) {
      skipped.push(row.status === 'unknownPasscode' ? unknownPasscodeText(row.source) : row.source);
      skippedLabels.push(row.status === 'unknownPasscode' ? unknownPasscodeText(row.source)
        : `${row.source} · ${row.status === 'notFound' ? NOT_FOUND : OPEN}`);
      return;
    }
    const section = row.section === 'unknown' ? deckSectionFor(chosen.type) : row.section;
    const hit = cards.find((c) => c.card_id === chosen.passcode && c.section === section);
    if (hit) hit.count += row.count;
    else cards.push({ card_id: chosen.passcode, name: chosen.name, count: row.count, section });
    counts[section] += row.count;
  });
  const notes = skipped.length ? [NOTES_HEAD, ...skipped].join('\n') : null;
  return { cards, counts, skipped, skippedLabels, notes };
}

// Einstieg der Vorschau (Einfuegen, YDK-Datei; Handy auch Teilen): lesen mit dem gemeinsamen Parser, dann den Katalog
// laden -- fuer YDK/YDKE nur die gelesenen Passcodes, fuer die Textliste alle Karten -- und aufloesen.
// loadCatalog(ids | null) -> { available, cards }. Ergebnis { error } oder { resolved }.
export async function prepareImport(text, format, loadCatalog) {
  const parsed = format ? parseDeckText(text, format) : parseDeckText(text);
  if (parsed.error) return { error: parsed.error };
  const ids = parsed.format === 'text' ? null : parsed.cards.map((c) => c.passcode);
  const catalog = await loadCatalog(ids);
  return { resolved: resolveImport(parsed, catalog && catalog.available ? catalog.cards : null) };
}
```

- [ ] **Step 5: Tests und Lint**

Run (in `desktop/`): `node --test src/utils/deckImport.test.js` → `ℹ pass 11`, `ℹ fail 0`.
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 180`.
Run (in `desktop/`): `npx eslint .` → `5 errors` (ein destrukturiertes, ungenutztes `_distance` wäre ein sechster — deshalb baut `fuzzy` die Kandidaten ausdrücklich neu).

- [ ] **Step 6: Schutz-Nachweis**

(a) In `fuzzy` `if (n.length < 6) return [];` kurz auf `< 5` ändern → `Fixture auflösen: Textliste mit Überschriften …` scheitert mit `+ candidates: [ '77585513' ]` / `- candidates: []` (gemessen: `Jinzu` bekäme `Jinzo` vorgeschlagen). Zitieren, zurücknehmen.
(b) In `importPlan` `const section = row.section === 'unknown' ? deckSectionFor(chosen.type) : row.section;` kurz durch `const section = row.section;` ersetzen → `Fixture auflösen: Textliste ohne Überschrift: Abschnitt per Typ …` scheitert (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add docs/fixtures/decks/import.json desktop/src/utils/deckImport.js desktop/src/utils/deckImport.test.js
git commit -m "feat(e2): Namensauflösung, Abschnittsregel und Import-Vorschau als JS-Zwilling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: Desktop-Hauptprozess — Katalog-Index, Import mit Rückbau, YDK lesen/schreiben, Notizen, Kanäle

**Files:**
- Modify: `desktop/electron/catalog-prices.cjs`
- Modify: `desktop/electron/catalog-prices.test.cjs`
- Modify: `desktop/electron/decks.cjs`
- Modify: `desktop/electron/decks.test.cjs`
- Modify: `desktop/electron/main.cjs`
- Modify: `desktop/electron/preload.cjs`
- Modify: `desktop/electron/ipc-channels.test.cjs`

**Interfaces:**
- Produces (für Task 4): in `catalog-prices.cjs` `readCatalogCards(userDataPath) → Map<string, { id, name_de, name_en, type, image }> | null`, `catalogCards(userDataPath, ids?) → { available, cards }` (mit `ids`: gefundene Zeilen samt `image`; ohne: alle `{ id, name_de, name_en, type }`); `readCatalogPrices`/`catalogPrices` unverändert. In `decks.cjs` `readYdkFile(filePath) → { canceled: false, name, text }`, `async createImportedDeck(client, { name, notes, cards: [{ card_id, name, count, section }] }, imageOf) → { success: true, deck } | { success: false, error }`. Renderer-Brücke: `window.api.getCatalogCards(ids|null) → { available, cards }`, `createImportedDeck({ name, notes, cards }) → { success, deck?, error? }`, `importDeckYdk() → { canceled: true } | { canceled: false, name, text }`, `exportDeckYdk({ name, content: string }) → { success } | { canceled }`, `saveDeck(deckId, cards, notes?)`; `getDeckDetails` liefert `card_type` mit Katalog-Rückfall.
- Consumes (vorhanden): `dealsClient()`, `userDataPath`, `dialog`, `fs` (main.cjs); Katalogdatei aus E1 (`catalogFilePath`).

- [ ] **Step 1: Tests schreiben**

In `desktop/electron/catalog-prices.test.cjs` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```js
const { mergeCards, packCatalog } = require('./catalog-build.cjs');
const { catalogFilePath, saveCatalogFile, readCatalogPrices, catalogPrices } = require('./catalog-prices.cjs');
```
durch:
```js
const { mergeCards, packCatalog } = require('./catalog-build.cjs');
const { catalogFilePath, saveCatalogFile, readCatalogPrices, readCatalogCards, catalogPrices, catalogCards } = require('./catalog-prices.cjs');
```

Änderung 2/2 — ersetzen:
```js
  assert.deepEqual(catalogPrices(dir), { available: true, prices: { '23434538': null } });
});
```
durch:
```js
  assert.deepEqual(catalogPrices(dir), { available: true, prices: { '23434538': null } });
});

// Spec E2 §4 -- Katalog-Index fuer den Import aus derselben Datei.
test('Katalog-Index: mit ids nur diese samt Bild, ohne ids alle kompakt ohne Bild', () => {
  const dir = tmpDir();
  saveCatalogFile(dir, packCatalog(mergeCards([card(14558127, '4.50'), card(1861629)], [{ id: 14558127, name: 'Asche-Blüte', desc: 'x' }]), 7).buffer);
  assert.deepEqual(catalogCards(dir, ['14558127', '99999999', 14558127]), {
    available: true,
    cards: [{ id: '14558127', name_de: 'Asche-Blüte', name_en: 'Karte 14558127', type: 'Effect Monster', image: 'https://x/14558127.jpg' }],
  });
  assert.deepEqual(catalogCards(dir), {
    available: true,
    cards: [
      { id: '14558127', name_de: 'Asche-Blüte', name_en: 'Karte 14558127', type: 'Effect Monster' },
      { id: '1861629', name_de: 'Karte 1861629', name_en: 'Karte 1861629', type: 'Effect Monster' },
    ],
  });
  assert.equal(readCatalogCards(dir).get('1861629').image, 'https://x/1861629.jpg');
  assert.deepEqual(catalogPrices(dir), { available: true, prices: { '14558127': 4.5, '1861629': null } }, 'Preise unverändert');
});

test('Katalog-Index ohne Datei: Katalog fehlt', () => {
  assert.deepEqual(catalogCards(tmpDir(), ['14558127']), { available: false, cards: [] });
  assert.equal(readCatalogCards(tmpDir()), null);
});
```

In `desktop/electron/decks.test.cjs` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```js
const copies = require('./copies.cjs');
const { DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer } = require('./decks.cjs');
```
durch:
```js
const copies = require('./copies.cjs');
const { DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck } = require('./decks.cjs');
```

Änderung 2/2 — ersetzen:
```js
  assert.throws(() => moveCopiesToContainer(db, { copyIds: ['k1'], containerId: null }, (e) => e.message), copies.ValidationError);
});
```
durch:
```js
  assert.throws(() => moveCopiesToContainer(db, { copyIds: ['k1'], containerId: null }, (e) => e.message), copies.ValidationError);
});

// Spec E2 §5 -- Attrappe fuer den Import: decks.insert().select().single(), deck_cards.insert(), decks.delete().eq().
function importClient({ deckError = null, cardsError = null } = {}) {
  const calls = { decks: [], deck_cards: [], deleted: [] };
  return {
    calls,
    from(table) {
      return {
        insert: (row) => {
          calls[table].push(row);
          if (table === 'decks') {
            return { select: () => ({ single: async () => (deckError ? { data: null, error: deckError } : { data: { id: 42, ...row }, error: null }) }) };
          }
          return Promise.resolve({ error: cardsError });
        },
        delete: () => ({ eq: async (col, val) => { calls.deleted.push({ table, col, val }); return { error: null }; } }),
      };
    },
  };
}

const IMPORT = {
  name: 'Tenpai',
  notes: 'Nicht übernommen beim Import:\nJinzu',
  cards: [
    { card_id: '14558127', name: 'Asche-Blüte & Freudiger Frühling', count: 3, section: 'main' },
    { card_id: '1861629', name: 'Decode Talker', count: 1, section: 'extra' },
  ],
};

test('Import anlegen: Deck mit Notizen, alle Karten in einem Insert mit Katalogbild', async () => {
  const c = importClient();
  const res = await createImportedDeck(c, IMPORT, (id) => (id === '14558127' ? 'https://img/14558127.jpg' : null));
  assert.deepEqual(res, { success: true, deck: { id: 42, name: 'Tenpai', notes: 'Nicht übernommen beim Import:\nJinzu' } });
  assert.deepEqual(c.calls.decks, [{ name: 'Tenpai', notes: 'Nicht übernommen beim Import:\nJinzu' }]);
  assert.deepEqual(c.calls.deck_cards, [[
    { deck_id: 42, card_id: '14558127', name: 'Asche-Blüte & Freudiger Frühling', image_url: 'https://img/14558127.jpg', count: 3, section: 'main' },
    { deck_id: 42, card_id: '1861629', name: 'Decode Talker', image_url: null, count: 1, section: 'extra' },
  ]]);
  assert.deepEqual(c.calls.deleted, []);
});

test('Import anlegen: ohne Nicht-Übernommenes keine notes-Spalte im Insert', async () => {
  const c = importClient();
  await createImportedDeck(c, { ...IMPORT, notes: null });
  assert.deepEqual(c.calls.decks, [{ name: 'Tenpai' }]);
});

test('Import anlegen: scheitern die Karten, wird das leere Deck wieder gelöscht', async () => {
  const c = importClient({ cardsError: { message: 'violates check constraint' } });
  const res = await createImportedDeck(c, IMPORT);
  assert.deepEqual(res, { success: false, error: 'violates check constraint' });
  assert.deepEqual(c.calls.deleted, [{ table: 'decks', col: 'id', val: 42 }]);
});

test('Import anlegen: scheitert schon das Deck, wird nichts eingefügt und nichts gelöscht', async () => {
  const c = importClient({ deckError: { message: "Could not find the 'notes' column" } });
  const res = await createImportedDeck(c, IMPORT);
  assert.deepEqual(res, { success: false, error: "Could not find the 'notes' column" });
  assert.deepEqual(c.calls.deck_cards, []);
  assert.deepEqual(c.calls.deleted, []);
});

test('YDK-Datei: Antwortform { canceled, name, text } für den gemeinsamen Parser', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ydk-')), 'Tenpai Dragon.ydk');
  fs.writeFileSync(file, '#main\n14558127\n!side\n');
  assert.deepEqual(readYdkFile(file), { canceled: false, name: 'Tenpai Dragon', text: '#main\n14558127\n!side\n' });
});
```

In `desktop/electron/ipc-channels.test.cjs` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```js

for (const ch of E1_CHANNELS) {
  test(`Kanal ${ch} steht in main.cjs und preload.cjs`, () => {
```
durch:
```js

// Spec E2 §9: neue Kanaele plus die umgebauten Deck-Kanaele (YDK lesen/schreiben, Notizen).
const E2_CHANNELS = ['get-catalog-cards', 'create-imported-deck', 'import-deck-ydk', 'export-deck-ydk', 'save-deck'];

for (const ch of [...E1_CHANNELS, ...E2_CHANNELS]) {
  test(`Kanal ${ch} steht in main.cjs und preload.cjs`, () => {
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/catalog-prices.test.cjs electron/decks.test.cjs electron/ipc-channels.test.cjs`
Expected: FAIL. `catalogCards is not a function`, `createImportedDeck is not a function`/`readYdkFile is not a function`, und `main.cjs fehlt ipcMain.handle('get-catalog-cards'` bzw. `'create-imported-deck'`.

- [ ] **Step 3: Katalog-Index in `catalog-prices.cjs`**

In `desktop/electron/catalog-prices.cjs` (5 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/5 — ersetzen:
```js
// Der entpackte Katalog ist gross: einmal lesen und behalten, bis sich die Datei aendert (Muster sealed-products.cjs).
let cache = null;

// Map Passcode -> cm_price (Zahl oder null); null, wenn keine lesbare Datei da ist.
function readCatalogPrices(userDataPath) {
  if (!userDataPath) return null;
```
durch:
```js
// Der entpackte Katalog ist gross: einmal lesen und behalten, bis sich die Datei aendert (Muster sealed-products.cjs).
// Spec E2 §4: derselbe Lesevorgang fuellt auch den Katalog-Index (Namen, Typ, Bild je Passcode) fuer den Import.
let cache = null;

// { prices: Map Passcode -> cm_price|null, cards: Map Passcode -> { id, name_de, name_en, type, image } } oder null,
// wenn keine lesbare Datei da ist.
function readCatalog(userDataPath) {
  if (!userDataPath) return null;
```

Änderung 2/5 — ersetzen:
```js
  catch { return null; }
  if (cache && cache.key === key) return cache.prices;
  try {
```
durch:
```js
  catch { return null; }
  if (cache && cache.key === key) return cache;
  try {
```

Änderung 3/5 — ersetzen:
```js
    const prices = new Map();
    for (const c of Array.isArray(json.cards) ? json.cards : []) {
      if (!c || c.id == null) continue;
      // Katalog vor Version 6 hat kein cm_price: dann null ("Preis unbekannt").
      prices.set(String(c.id), typeof c.cm_price === 'number' && c.cm_price > 0 ? c.cm_price : null);
    }
    cache = { key, prices };
    return prices;
  } catch (e) {
```
durch:
```js
    const prices = new Map();
    const cards = new Map();
    for (const c of Array.isArray(json.cards) ? json.cards : []) {
      if (!c || c.id == null) continue;
      const id = String(c.id);
      // Katalog vor Version 6 hat kein cm_price: dann null ("Preis unbekannt").
      prices.set(id, typeof c.cm_price === 'number' && c.cm_price > 0 ? c.cm_price : null);
      cards.set(id, { id, name_de: c.name_de || '', name_en: c.name_en || '', type: c.type || '', image: c.image || null });
    }
    cache = { key, prices, cards };
    return cache;
  } catch (e) {
```

Änderung 4/5 — ersetzen:
```js
  }
}
```
durch:
```js
  }
}

// Map Passcode -> cm_price (Zahl oder null); null, wenn keine lesbare Datei da ist.
function readCatalogPrices(userDataPath) {
  const catalog = readCatalog(userDataPath);
  return catalog ? catalog.prices : null;
}

// Map Passcode -> { id, name_de, name_en, type, image }; null ohne lesbare Datei.
function readCatalogCards(userDataPath) {
  const catalog = readCatalog(userDataPath);
  return catalog ? catalog.cards : null;
}

// Spec E2 §4 -- fuer den Renderer-Import: mit ids nur diese Passcodes (samt Bild, fuer YDK/YDKE), ohne ids alle Karten
// kompakt ohne Bild (Textliste, ~1,5 MB). available = false ohne Datei ("Katalog fehlt").
function catalogCards(userDataPath, ids) {
  const cards = readCatalogCards(userDataPath);
  if (!cards) return { available: false, cards: [] };
  if (Array.isArray(ids)) {
    const out = [];
    for (const id of new Set(ids.map(String))) { const c = cards.get(id); if (c) out.push(c); }
    return { available: true, cards: out };
  }
  return { available: true, cards: Array.from(cards.values(), ({ id, name_de, name_en, type }) => ({ id, name_de, name_en, type })) };
}
```

Änderung 5/5 — ersetzen:
```js

module.exports = { catalogFilePath, saveCatalogFile, readCatalogPrices, catalogPrices };
```
durch:
```js

module.exports = { catalogFilePath, saveCatalogFile, readCatalogPrices, readCatalogCards, catalogPrices, catalogCards };
```

- [ ] **Step 4: `decks.cjs` — YDK-Datei lesen, Import mit Rückbau**

In `desktop/electron/decks.cjs` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```js
// Namens-Rueckfall an, aber nie einen Deal-Watch dafuer.
const { ValidationError, setCopyLocation } = require('./copies.cjs');
```
durch:
```js
// Namens-Rueckfall an, aber nie einen Deal-Watch dafuer.
const fs = require('fs');
const path = require('path');
const { ValidationError, setCopyLocation } = require('./copies.cjs');
```

Änderung 2/2 — ersetzen:
```js

module.exports = { DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer };
```
durch:
```js

// Spec E2 §5 -- YDK-Datei fuer den Import: nur lesen, das Parsen macht der Renderer mit dem gemeinsamen Parser
// (deckFormats.js). Antwortform { canceled: false, name, text }; name = Dateiname ohne .ydk.
function readYdkFile(filePath) {
  return { canceled: false, name: path.basename(filePath, path.extname(filePath)), text: fs.readFileSync(filePath, 'utf8') };
}

// Spec E2 §5 -- Import legt immer ein NEUES Deck an: erst das Deck (mit Notizen), dann alle Deckkarten in einem Insert.
// Scheitert das Einfuegen der Karten, wird das leere Deck wieder geloescht. `imageOf(passcode)` liefert das Katalogbild.
// Rueckgabe { success: true, deck } oder { success: false, error } (Rohmeldung; "Import fehlgeschlagen: …" setzt der
// Renderer ueber deckImport.js#failedText).
// ZWILLING (Rueckbau): android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt#createWithRollback.
async function createImportedDeck(client, { name, notes, cards } = {}, imageOf = () => null) {
  // notes nur mitsenden, wenn es welche gibt: ein Import ohne Nicht-Uebernommenes klappt so auch vor decks_notes.sql.
  const deckRow = notes ? { name, notes } : { name };
  let deck;
  try {
    const { data, error } = await client.from('decks').insert(deckRow).select('*').single();
    if (error) return { success: false, error: error.message || 'Deck anlegen fehlgeschlagen.' };
    deck = data;
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
  const rows = (Array.isArray(cards) ? cards : []).map((c) => ({
    deck_id: deck.id, card_id: String(c.card_id), name: c.name || null,
    image_url: imageOf(String(c.card_id)) || null, count: c.count, section: c.section,
  }));
  if (rows.length === 0) return { success: true, deck };
  let error;
  try { ({ error } = await client.from('deck_cards').insert(rows)); } catch (e) { error = e; }
  if (!error) return { success: true, deck };
  try {
    const { error: deleteError } = await client.from('decks').delete().eq('id', deck.id);
    if (deleteError) console.error('[create-imported-deck] leeres Deck nicht geloescht:', deleteError.message);
  } catch (e) { console.error('[create-imported-deck] leeres Deck nicht geloescht:', e.message); }
  return { success: false, error: error.message || String(error) };
}

module.exports = { DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck };
```

- [ ] **Step 5: `main.cjs`**

In `desktop/electron/main.cjs` (9 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/9 — ersetzen:
```js
const { collectionSql, parseImportCsv } = require('./collection-query.cjs');
const { setDeckContainer, addMissingToWishlist, moveCopiesToContainer } = require('./decks.cjs');
const { catalogPrices } = require('./catalog-prices.cjs');
```
durch:
```js
const { collectionSql, parseImportCsv } = require('./collection-query.cjs');
const { setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck } = require('./decks.cjs');
const { catalogPrices, catalogCards, readCatalogCards } = require('./catalog-prices.cjs');
```

Änderung 2/9 — ersetzen:
```js

ipcMain.handle('save-deck', async (event, { deckId, cards }) => {
    const c = await dealsClient();
```
durch:
```js

ipcMain.handle('save-deck', async (event, { deckId, cards, notes }) => {
    const c = await dealsClient();
```

Änderung 3/9 — ersetzen:
```js
        if (error) throw new Error(error.message);
    }
    return { success: true };
});
```
durch:
```js
        if (error) throw new Error(error.message);
    }
    // Spec E2 §5: Notizen nur schreiben, wenn der Renderer sie mitschickt (er tut es nur bei einer Aenderung).
    if (notes !== undefined) {
        const { error } = await c.from('decks').update({ notes: notes || null }).eq('id', deckId);
        if (error) throw new Error(error.message);
    }
    return { success: true };
});
```

Änderung 4/9 — ersetzen:
```js
    );
    return (data || []).map(dc => {
        const d = detail.get(String(dc.card_id)) || {};
        return {
```
durch:
```js
    );
    // Spec E2 §6: "→ Deck" braucht den Kartentyp auch fuer nicht besessene Karten -- Rueckfall auf den Katalog.
    const catalog = readCatalogCards(userDataPath);
    return (data || []).map(dc => {
        const d = detail.get(String(dc.card_id)) || {};
        const cat = (catalog && catalog.get(String(dc.card_id))) || {};
        return {
```

Änderung 5/9 — ersetzen:
```js
            name: dc.name || d.name || null, image_url: dc.image_url || d.image_url || null,
            card_type: d.card_type || null, desc: d.desc || null,
            atk: d.atk ?? null, def: d.def ?? null, level: d.level ?? null,
```
durch:
```js
            name: dc.name || d.name || null, image_url: dc.image_url || d.image_url || null,
            card_type: d.card_type || cat.type || null, desc: d.desc || null,
            atk: d.atk ?? null, def: d.def ?? null, level: d.level ?? null,
```

Änderung 6/9 — ersetzen:
```js

ipcMain.handle('import-deck-ydk', async () => {
```
durch:
```js

// Spec E2 §5: nur Datei waehlen und lesen -- geparst wird im Renderer mit dem gemeinsamen Parser (deckFormats.js).
ipcMain.handle('import-deck-ydk', async () => {
```

Änderung 7/9 — ersetzen:
```js
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };

    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const name = path.basename(result.filePaths[0], '.ydk');
    const lines = content.split(/\r?\n/);

    const cards = [];
    let currentSection = 'main';

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '#main') currentSection = 'main';
        else if (trimmed === '#extra') currentSection = 'extra';
        else if (trimmed === '!side') currentSection = 'side';
        else if (/^\d+$/.test(trimmed)) {
            cards.push({ id: trimmed, type: currentSection, quantity: 1 });
        }
    }

    // Consolidate duplicates
    const consolidated = [];
    cards.forEach(c => {
        const existing = consolidated.find(x => x.id === c.id && x.type === c.type);
        if (existing) existing.quantity++;
        else consolidated.push(c);
    });

    return { canceled: false, name, cards: consolidated };
});

ipcMain.handle('export-deck-ydk', async (event, { name, content }) => {
```
durch:
```js
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return readYdkFile(result.filePaths[0]);
});

// Spec E2 §6: der Renderer baut den YDK-Text (deckFormats.js#buildYdk, mit Side-Deck); hier nur speichern.
ipcMain.handle('export-deck-ydk', async (event, { name, content }) => {
```

Änderung 8/9 — ersetzen:
```js
    if (result.canceled || !result.filePath) return { canceled: true };

    let ydk = '#created by Yu-Gi-Oh! Card Manager\n#main\n';
    content.filter(c => c.type === 'main').forEach(c => {
        for(let i=0; i<(c.quantity||1); i++) ydk += `${c.id}\n`;
    });

    ydk += '#extra\n';
    content.filter(c => c.type === 'extra').forEach(c => {
        for(let i=0; i<(c.quantity||1); i++) ydk += `${c.id}\n`;
    });

    ydk += '!side\n';
    content.filter(c => c.type === 'side').forEach(c => {
        for(let i=0; i<(c.quantity||1); i++) ydk += `${c.id}\n`;
    });

    fs.writeFileSync(result.filePath, ydk);
    return { success: true };
```
durch:
```js
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, String(content));
    return { success: true };
```

Änderung 9/9 — ersetzen:
```js
    } catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'move-copies-to-container') }; }
});
```
durch:
```js
    } catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'move-copies-to-container') }; }
});

// --- Spec E2: Import & Export ---
// Katalog-Index fuer die Namensaufloesung im Renderer: mit ids nur diese Passcodes, ohne ids alle Karten kompakt.
ipcMain.handle('get-catalog-cards', (event, ids) => catalogCards(userDataPath, Array.isArray(ids) ? ids : undefined));
// Neues Deck mit Notizen und allen Karten; scheitern die Karten, wird das leere Deck wieder geloescht.
ipcMain.handle('create-imported-deck', async (event, input) => {
    const c = await dealsClient();
    const catalog = readCatalogCards(userDataPath);
    return createImportedDeck(c, input, (id) => (catalog && catalog.get(id) ? catalog.get(id).image : null));
});
```

- [ ] **Step 6: `preload.cjs`**

In `desktop/electron/preload.cjs` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```js
  deleteDeck: (id) => ipcRenderer.invoke('delete-deck', id),
  saveDeck: (deckId, cards) => ipcRenderer.invoke('save-deck', { deckId, cards }),
  getDeckDetails: (deckId) => ipcRenderer.invoke('get-deck-details', deckId),
```
durch:
```js
  deleteDeck: (id) => ipcRenderer.invoke('delete-deck', id),
  saveDeck: (deckId, cards, notes) => ipcRenderer.invoke('save-deck', { deckId, cards, notes }),
  getDeckDetails: (deckId) => ipcRenderer.invoke('get-deck-details', deckId),
```

Änderung 2/2 — ersetzen:
```js
  moveCopiesToContainer: (data) => ipcRenderer.invoke('move-copies-to-container', data),
```
durch:
```js
  moveCopiesToContainer: (data) => ipcRenderer.invoke('move-copies-to-container', data),
  // Spec E2: Import & Export
  getCatalogCards: (ids) => ipcRenderer.invoke('get-catalog-cards', ids),
  createImportedDeck: (data) => ipcRenderer.invoke('create-imported-deck', data),
```

- [ ] **Step 7: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 243`, `ℹ fail 0` (neu: 2 in `catalog-prices`, 5 in `decks`, 5 in `ipc-channels`).
Run (in `desktop/`): `node --check electron/main.cjs` → keine Ausgabe.
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` → alle Zeilen `PASS`.

- [ ] **Step 8: Schutz-Nachweis**

(a) In `createImportedDeck` die Zeile `    const { error: deleteError } = await client.from('decks').delete().eq('id', deck.id);` kurz durch `    const deleteError = null;` ersetzen → `Import anlegen: scheitern die Karten, wird das leere Deck wieder gelöscht` scheitert mit `actual: []` / `expected: [ { table: 'decks', col: 'id', val: 42 } ]` (gemessen). Zitieren, zurücknehmen.
(b) `const deckRow = notes ? { name, notes } : { name };` kurz durch `const deckRow = { name, notes };` ersetzen → `Import anlegen: ohne Nicht-Übernommenes keine notes-Spalte im Insert` scheitert (gemessen). Zitieren, zurücknehmen.
(c) In `catalogCards` `if (Array.isArray(ids)) {` kurz durch `if (false) {` ersetzen → `Katalog-Index: mit ids nur diese samt Bild …` scheitert (gemessen). Zitieren, zurücknehmen.
(d) In `preload.cjs` `invoke('create-imported-deck'` kurz umbenennen → `Kanal create-imported-deck steht in main.cjs und preload.cjs` scheitert mit `preload.cjs fehlt ipcRenderer.invoke('create-imported-deck'` (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/catalog-prices.cjs desktop/electron/catalog-prices.test.cjs desktop/electron/decks.cjs desktop/electron/decks.test.cjs desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/ipc-channels.test.cjs
git commit -m "feat(e2): Desktop-Kanäle für Katalog-Index und Import mit Rückbau, YDK lesen/schreiben repariert, Notizen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Desktop-Oberfläche — Neues-Deck-Menü, Import-Dialog, Export-Menü, Side-Deck, Notizen

**Files:**
- Create: `desktop/src/components/DeckNewMenu.jsx`
- Create: `desktop/src/components/DeckImportDialog.jsx`
- Create: `desktop/src/components/DeckExportMenu.jsx`
- Modify: `desktop/src/components/DeckBuilder.jsx`

**Interfaces:**
- Produces: `<DeckNewMenu onEmpty onYdkFile onPaste />`, `<DeckImportDialog source={{ text?, name?, format? }} onClose onCreated={(deck) => …} />`, `<DeckExportMenu deckName entries={[{ passcode, name, count, section }]} />`.
- Consumes (Task 1–3): `buildYdk`, `buildYdke`, `buildTextList`; `prepareImport`, `importPlan`, `countsText`, `skippedText`, `suggestionText`, `ambiguousOptionText`, `failedText`, `deckNameFor`, `deckSectionFor`, `moveTarget`, `moveLabel`, `CATALOG_MISSING`, `AMBIGUOUS`, `OPEN`; `window.api.getCatalogCards`, `createImportedDeck`, `importDeckYdk`, `exportDeckYdk`, `saveDeck(deckId, cards, notes?)`. Vorhanden: `LOADING` (deckCoverage.js), Tailwind-Klassen `bg-obsidian-700`, `border-line`, `text-ink*`, `text-warn`, `text-crit` wie in `DeckWishlistDialog.jsx`/`FillBoxDialog.jsx`.

- [ ] **Step 1: `DeckNewMenu.jsx` anlegen**

```jsx
import { useState } from 'react';
import { Plus } from 'lucide-react';

// Spec E2 §5 — Menue "Neues Deck": Leer · YDK-Datei · Einfügen (YDKE/Text). Import legt immer ein neues Deck an.
export default function DeckNewMenu({ onEmpty, onYdkFile, onPaste }) {
  const [open, setOpen] = useState(false);
  const choose = (fn) => () => { setOpen(false); fn(); };

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="p-1.5 bg-space-violet hover:bg-space-violet-dark text-white rounded transition-colors" title="Neues Deck">
        <Plus className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-lg py-1">
          <button type="button" onClick={choose(onEmpty)} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Leer</button>
          <button type="button" onClick={choose(onYdkFile)} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">YDK-Datei</button>
          <button type="button" onClick={choose(onPaste)} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Einfügen (YDKE/Text)</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `DeckImportDialog.jsx` anlegen**

Aufbau: ohne `source.text` erst das Textfeld („Vorschau"), mit `source.text` (YDK-Datei) sofort Lesen/Auflösen im Effekt (Zustand nur im `.then`, wie `DeckWishlistDialog`). Während des Ladens „…"; Lesefehler („Kein gültiger YDKE-Link", „Keine Deckliste erkannt") stehen im Dialog, nichts wird angelegt.

```jsx
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { LOADING } from '../utils/deckCoverage';
import {
  AMBIGUOUS, CATALOG_MISSING, OPEN, ambiguousOptionText, countsText, deckNameFor, failedText, importPlan, prepareImport,
  skippedText, suggestionText,
} from '../utils/deckImport';

const SECTIONS = [['main', 'Main Deck'], ['extra', 'Extra Deck'], ['side', 'Side Deck']];

// Katalog aus dem Hauptprozess (catalog-prices.cjs): mit ids nur diese Passcodes, mit null alle Karten kompakt.
const loadCatalog = (ids) => window.api.getCatalogCards(ids);

// Spec E2 §5 — Import-Dialog: Einfuegen (YDKE/Text) und Vorschau. Legt immer ein NEUES Deck an.
// source: { text, name, format } fuer die YDK-Datei (direkt Vorschau) oder {} fuer "Einfügen".
export default function DeckImportDialog({ source, onClose, onCreated }) {
  const [text, setText] = useState('');
  const [resolved, setResolved] = useState(null);
  const [choices, setChoices] = useState({});
  const [name, setName] = useState(deckNameFor(source.name));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(!!source.text);

  useEffect(() => {
    if (!source.text) return undefined;
    let alive = true;
    prepareImport(source.text, source.format, loadCatalog)
      .then((r) => { if (!alive) return; setBusy(false); if (r.error) setError(r.error); else setResolved(r.resolved); })
      .catch((e) => { if (alive) { setBusy(false); setError(e.message || String(e)); } });
    return () => { alive = false; };
  }, [source]);

  const plan = useMemo(() => (resolved ? importPlan(resolved, choices) : null), [resolved, choices]);

  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await prepareImport(text, undefined, loadCatalog);
      if (r.error) setError(r.error);
      else { setChoices({}); setResolved(r.resolved); }
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.createImportedDeck({ name: deckNameFor(name), notes: plan.notes, cards: plan.cards });
      if (res.success) { onCreated(res.deck); return; }
      setError(failedText(res.error));
    } catch (e) {
      setError(failedText(e.message || String(e)));
    }
    setBusy(false);
  };

  const pick = (i, passcode) => setChoices((prev) => {
    const next = { ...prev };
    if (next[i] === passcode) delete next[i];
    else next[i] = passcode;
    return next;
  });

  const openRows = resolved ? resolved.rows.map((row, i) => ({ row, i })).filter(({ row }) => row.status === 'suggest' || row.status === 'ambiguous') : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-obsidian-700 border border-line rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">{resolved ? 'Import-Vorschau' : 'Einfügen (YDKE/Text)'}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        {!resolved && !source.text && (
          <textarea
            autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={10}
            placeholder="ydke://… oder eine Deckliste, z. B. 3 Ash Blossom & Joyous Spring"
            className="w-full bg-[#1a1a1a] border border-gray-700 text-white px-3 py-2 rounded text-sm font-mono focus:border-space-violet focus:outline-none"
          />
        )}
        {!resolved && busy && <p className="text-sm text-ink-muted">{LOADING}</p>}

        {resolved && plan && (
          <>
            <label className="block text-xs text-ink-muted">
              Deckname
              <input value={name} onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full bg-[#1a1a1a] border border-gray-700 text-white px-3 py-2 rounded text-sm focus:border-space-violet focus:outline-none" />
            </label>
            {resolved.catalogMissing && <p className="text-sm text-warn">{CATALOG_MISSING}</p>}
            <p className="font-mono text-sm text-ink">
              {countsText(plan.counts)}
              {skippedText(plan.skipped.length) && <span className="text-crit"> · {skippedText(plan.skipped.length)}</span>}
            </p>

            {openRows.length > 0 && (
              <div className="space-y-2">
                {openRows.map(({ row, i }) => (
                  <div key={i} className="p-2 rounded-lg border border-gray-800 bg-black/30">
                    <div className="text-sm text-ink">
                      {row.source}
                      {!row.candidates.some((c) => c.passcode === choices[i]) && <span className="ml-2 text-xs text-warn">{OPEN}</span>}
                    </div>
                    {row.status === 'ambiguous' && <div className="text-xs text-ink-muted">{AMBIGUOUS}</div>}
                    <div className="mt-1 flex flex-wrap gap-2">
                      {row.candidates.map((c) => (
                        <button key={c.passcode} type="button" onClick={() => pick(i, c.passcode)}
                          className={`px-2 py-1 rounded text-xs ${choices[i] === c.passcode ? 'bg-space-violet text-white' : 'bg-gray-800 text-gray-300 hover:text-white'}`}>
                          {row.status === 'suggest' ? suggestionText(c.name) : ambiguousOptionText(c)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {SECTIONS.map(([section, title]) => {
              const cards = plan.cards.filter((c) => c.section === section);
              if (cards.length === 0) return null;
              return (
                <div key={section}>
                  <h4 className="text-xs font-bold uppercase text-gray-500 mb-1">{title}</h4>
                  {cards.map((c) => <div key={c.card_id} className="text-sm text-gray-300 font-mono">{c.count} {c.name}</div>)}
                </div>
              );
            })}

            {plan.skippedLabels.length > 0 && (
              <div>
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-1">Nicht übernommen</h4>
                {plan.skippedLabels.map((line, k) => <div key={k} className="text-sm text-gray-400 font-mono">{line}</div>)}
              </div>
            )}
          </>
        )}

        {error && <p className="text-sm text-crit">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Abbrechen</button>
          {resolved ? (
            <button type="button" onClick={create} disabled={busy}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium disabled:opacity-50">
              {busy ? 'Wird angelegt…' : 'Anlegen'}
            </button>
          ) : !source.text && (
            <button type="button" onClick={preview} disabled={busy || !text.trim()}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium disabled:opacity-50">
              Vorschau
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `DeckExportMenu.jsx` anlegen**

```jsx
import { useState } from 'react';
import { Download } from 'lucide-react';
import { buildTextList, buildYdk, buildYdke } from '../utils/deckFormats';

// Spec E2 §6 — Export-Menue: YDK-Datei (Speichern-Dialog im Hauptprozess), YDKE und Textliste in die Zwischenablage.
// entries: [{ passcode, name, count, section }] aus dem Editor (ungespeicherter Stand).
export default function DeckExportMenu({ deckName, entries }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(null);

  const copy = async (text, done) => {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(text);
      setNote(done);
    } catch (e) {
      setNote(`Kopieren fehlgeschlagen: ${e.message || e}`);
    }
  };

  const saveYdk = async () => {
    setOpen(false);
    try {
      const res = await window.api.exportDeckYdk({ name: deckName, content: buildYdk(entries) });
      if (res.success) setNote('YDK-Datei gespeichert');
    } catch (e) {
      setNote(`Export fehlgeschlagen: ${e.message || e}`);
    }
  };

  return (
    <div className="relative flex items-center gap-2">
      {note && <span className="text-xs text-gray-400">{note}</span>}
      <button onClick={() => setOpen((v) => !v)} className="flex items-center px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm font-medium border border-gray-700">
        <Download className="w-4 h-4 mr-2" />
        Export
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-lg py-1">
          <button type="button" onClick={saveYdk} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">YDK-Datei</button>
          <button type="button" onClick={() => copy(buildYdke(entries), 'YDKE-Link kopiert')} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">YDKE kopieren</button>
          <button type="button" onClick={() => copy(buildTextList(entries), 'Textliste kopiert')} className="block w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Textliste kopieren</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `DeckBuilder.jsx` anpassen**

Inhalt: Imports (die nicht mehr genutzten Icons `Plus`, `Upload`, `Download` entfallen), Zustände `importSource`/`addTarget`/`notes`, Notizen beim Anlegen/Laden/Speichern, neuer `handleImportYdk` + `handleImported` + `exportEntries` (ersetzen den toten Import-Zweig und das lokale `handleExportYdk`), Hinzufügen per Ziel, `moveOne`, Menü „Neues Deck", Umschalter „Ziel:", Export-Menü, Notizfeld, Dialog, Zeilenknopf.

In `desktop/src/components/DeckBuilder.jsx` (20 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/20 — ersetzen:
```jsx
import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Save, Upload, FileUp, Download, BarChart2, PieChart as PieChartIcon, Play } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';
```
durch:
```jsx
import { useState, useEffect, useMemo } from 'react';
import { Trash2, Save, FileUp, BarChart2, PieChart as PieChartIcon, Play } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';
```

Änderung 2/20 — ersetzen:
```jsx
import DeckWishlistDialog from './DeckWishlistDialog';
```
durch:
```jsx
import DeckWishlistDialog from './DeckWishlistDialog';
import DeckNewMenu from './DeckNewMenu';
import DeckImportDialog from './DeckImportDialog';
import DeckExportMenu from './DeckExportMenu';
import { deckSectionFor, moveLabel, moveTarget } from '../utils/deckImport';
```

Änderung 3/20 — ersetzen:
```jsx
  const [newDeckName, setNewDeckName] = useState('');
```
durch:
```jsx
  const [newDeckName, setNewDeckName] = useState('');

  // Spec E2: Import-Dialog ({ text, name, format } fuer die YDK-Datei, {} fuer Einfuegen), Ziel beim Hinzufuegen, Notizen.
  const [importSource, setImportSource] = useState(null);
  const [addTarget, setAddTarget] = useState('deck');
  const [notes, setNotes] = useState('');
```

Änderung 4/20 — ersetzen:
```jsx
          setSideDeck([]);
          setIsCreating(false);
```
durch:
```jsx
          setSideDeck([]);
          setNotes('');
          setIsCreating(false);
```

Änderung 5/20 — ersetzen:
```jsx
          setActiveDeck(deck);
```
durch:
```jsx
          setActiveDeck(deck);
          setNotes(deck.notes || '');
```

Änderung 6/20 — ersetzen:
```jsx
      ];
      await window.api.saveDeck(activeDeck.id, allCards);
      reloadCoverage();   // Spec E1: die Deck-Liste rechnet mit den gespeicherten Deckkarten
```
durch:
```jsx
      ];
      // Spec E2 §5: Notizen nur mitschicken, wenn sie sich geaendert haben.
      const deckId = activeDeck.id;
      const notesChanged = notes !== (activeDeck.notes || '');
      await window.api.saveDeck(deckId, allCards, notesChanged ? notes : undefined);
      if (notesChanged) {
          setDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, notes } : d)));
          setActiveDeck((prev) => (prev?.id === deckId ? { ...prev, notes } : prev));
      }
      reloadCoverage();   // Spec E1: die Deck-Liste rechnet mit den gespeicherten Deckkarten
```

Änderung 7/20 — ersetzen:
```jsx

  const handleImportYdk = async () => {
      if (window.api) {
          const result = await window.api.importDeckYdk();
          if (result && !result.canceled && result.deck) {
              const newDeck = await window.api.createDeck(result.name || "Imported Deck");
              setDecks([newDeck, ...decks]);
              setActiveDeck(newDeck);

              // Sort into buckets
              const main = [], extra = [], side = [];
              result.deck.forEach(c => {
                  // Find details in collection to show images immediately if owned, else placeholder
                  const cardInfo = collection.find(col => col.id === c.id) || { id: c.id, name: 'Unknown / Not Owned', image_url: `https://images.ygoprodeck.com/images/cards/${c.id}.jpg` };
                  const deckCard = { ...cardInfo, card_id: c.id, quantity: 1 };

                  if (c.type === 'extra') extra.push(deckCard);
                  else if (c.type === 'side') side.push(deckCard);
                  else main.push(deckCard);
              });
              setMainDeck(main);
              setExtraDeck(extra);
              setSideDeck(side);

              // Auto-save initial structure
              const allCards = result.deck.map(c => ({ id: c.id, type: c.type, quantity: 1 }));
              await window.api.saveDeck(newDeck.id, allCards);
          }
      }
  };

  const handleExportYdk = async () => {
      if (!activeDeck || !window.api) return;

      let content = '#created by YuGiOhCardManager\n#main\n';
      mainDeck.forEach(c => {
          for(let i=0; i<c.quantity; i++) content += `${c.card_id}\n`;
      });
      content += '#extra\n';
      extraDeck.forEach(c => {
          for(let i=0; i<c.quantity; i++) content += `${c.card_id}\n`;
      });
      content += '!side\n';
      sideDeck.forEach(c => {
          for(let i=0; i<c.quantity; i++) content += `${c.card_id}\n`;
      });

      const res = await window.api.exportDeckYdk({ name: activeDeck.name, content });
      if (res.success) alert("Deck exported!");
      else if (!res.canceled) alert("Export failed: " + res.error);
  };
```
durch:
```jsx

  // Spec E2 §5: YDK-Datei lesen (Hauptprozess), parsen und aufloesen im Import-Dialog.
  const handleImportYdk = async () => {
      if (!window.api) return;
      const result = await window.api.importDeckYdk();
      if (result && !result.canceled) setImportSource({ text: result.text, name: result.name, format: 'ydk' });
  };

  // Spec E2 §5: das neue Deck steht vorn in der Liste und ist im Editor offen.
  const handleImported = (deck) => {
      setImportSource(null);
      setDecks((prev) => [deck, ...prev]);
      handleLoadDeck(deck);
      reloadCoverage();
  };

  // Spec E2 §6: Export aus dem Editor-Stand (auch ungespeichert).
  const exportEntries = useMemo(() => [
      ...mainDeck.map((c) => ({ passcode: String(c.card_id), name: c.name, count: c.quantity, section: 'main' })),
      ...extraDeck.map((c) => ({ passcode: String(c.card_id), name: c.name, count: c.quantity, section: 'extra' })),
      ...sideDeck.map((c) => ({ passcode: String(c.card_id), name: c.name, count: c.quantity, section: 'side' })),
  ], [mainDeck, extraDeck, sideDeck]);
```

Änderung 8/20 — ersetzen:
```jsx
      }
      // Determine destination based on type
      const isExtra = card.type && (card.type.includes('Fusion') || card.type.includes('Synchro') || card.type.includes('XYZ') || card.type.includes('Link'));
      const targetDeck = isExtra ? extraDeck : mainDeck;
      const setTarget = isExtra ? setExtraDeck : setMainDeck;
```
durch:
```jsx
      }
      // Spec E2 §6: Ziel "Side" oder "Deck" (Main/Extra per deckSectionFor).
      const section = addTarget === 'side' ? 'side' : deckSectionFor(card.type);
      const targetDeck = section === 'side' ? sideDeck : section === 'extra' ? extraDeck : mainDeck;
      const setTarget = section === 'side' ? setSideDeck : section === 'extra' ? setExtraDeck : setMainDeck;
```

Änderung 9/20 — ersetzen:
```jsx
      } else {
          setTarget(prev => [...prev, { ...card, card_id: card.id, quantity: 1 }]);
      }
```
durch:
```jsx
      } else {
          setTarget(prev => [...prev, { ...card, card_id: card.id, card_type: card.type, quantity: 1 }]);
      }
```

Änderung 10/20 — ersetzen:
```jsx
      });
  };
```
durch:
```jsx
      });
  };

  // Spec E2 §6: eine Kopie verschieben -- "→ Side" aus Main/Extra, "→ Deck" aus Side (Main/Extra per Kartentyp).
  const moveOne = (card, from) => {
      const to = moveTarget(from, card.card_type);
      const setTo = to === 'side' ? setSideDeck : to === 'extra' ? setExtraDeck : setMainDeck;
      removeFromDeck(card.card_id, from);
      setTo((prev) => (prev.some((c) => c.card_id === card.card_id)
          ? prev.map((c) => (c.card_id === card.card_id ? { ...c, quantity: c.quantity + 1 } : c))
          : [...prev, { ...card, quantity: 1 }]));
  };
```

Änderung 11/20 — ersetzen:
```jsx
                    <h3 className="font-bold text-white">My Decks</h3>
                    <div className="flex gap-2">
                        <button onClick={handleImportYdk} className="p-1.5 bg-gray-800 hover:text-white text-gray-400 rounded transition-colors" title="Import .ydk">
                            <Upload className="w-4 h-4" />
                        </button>
                        <button onClick={() => setIsCreating(true)} className="p-1.5 bg-space-violet hover:bg-space-violet-dark text-white rounded transition-colors" title="New Deck">
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </div>
```
durch:
```jsx
                    <h3 className="font-bold text-white">My Decks</h3>
                    <DeckNewMenu onEmpty={() => setIsCreating(true)} onYdkFile={handleImportYdk} onPaste={() => setImportSource({})} />
                </div>
```

Änderung 12/20 — ersetzen:
```jsx
            <div className="bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 flex flex-col flex-1 h-2/3">
                <div className="mb-4">
```
durch:
```jsx
            <div className="bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 flex flex-col flex-1 h-2/3">
                <div className="mb-2 flex items-center gap-2 text-xs text-gray-400">
                    <span>Ziel:</span>
                    {[['deck', 'Deck'], ['side', 'Side']].map(([value, label]) => (
                        <button key={value} type="button" onClick={() => setAddTarget(value)}
                            className={`px-2 py-1 rounded ${addTarget === value ? 'bg-space-violet text-white' : 'bg-gray-800 hover:text-white'}`}>
                            {label}
                        </button>
                    ))}
                </div>
                <div className="mb-4">
```

Änderung 13/20 — ersetzen:
```jsx
                            </button>
                             <button onClick={handleExportYdk} className="flex items-center px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm font-medium border border-gray-700">
                                <Download className="w-4 h-4 mr-2" />
                                Export YDK
                            </button>
                            <button onClick={handleSaveDeck} className="flex items-center px-4 py-2 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg transition-colors font-medium shadow-lg shadow-space-violet/20">
```
durch:
```jsx
                            </button>
                            <DeckExportMenu deckName={activeDeck.name} entries={exportEntries} />
                            <button onClick={handleSaveDeck} className="flex items-center px-4 py-2 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg transition-colors font-medium shadow-lg shadow-space-violet/20">
```

Änderung 14/20 — ersetzen:
```jsx
                        onOpenFillBox={openFillBox}
                    />
```
durch:
```jsx
                        onOpenFillBox={openFillBox}
                    />

                    <textarea
                        value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notizen" rows={notes ? 3 : 1}
                        className="w-full mb-4 bg-black/30 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 font-mono focus:outline-none focus:border-space-violet"
                    />
```

Änderung 15/20 — ersetzen:
```jsx
                                {mainDeck.length === 0 && <p className="text-gray-600 text-sm italic">Drag or click cards to add.</p>}
                                {mainDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="main" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} />)}
                            </div>
```
durch:
```jsx
                                {mainDeck.length === 0 && <p className="text-gray-600 text-sm italic">Drag or click cards to add.</p>}
                                {mainDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="main" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} />)}
                            </div>
```

Änderung 16/20 — ersetzen:
```jsx
                            <div className="space-y-1">
                                {extraDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="extra" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} />)}
                            </div>
```
durch:
```jsx
                            <div className="space-y-1">
                                {extraDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="extra" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} />)}
                            </div>
```

Änderung 17/20 — ersetzen:
```jsx
                            <div className="space-y-1">
                                {sideDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="side" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} />)}
                            </div>
```
durch:
```jsx
                            <div className="space-y-1">
                                {sideDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="side" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} />)}
                            </div>
```

Änderung 18/20 — ersetzen:
```jsx
        )}
        {dialog && dialog.kind === 'wishlist' && activeCoverage && (
```
durch:
```jsx
        )}
        {importSource && (
            <DeckImportDialog source={importSource} onClose={() => setImportSource(null)} onCreated={handleImported} />
        )}
        {dialog && dialog.kind === 'wishlist' && activeCoverage && (
```

Änderung 19/20 — ersetzen:
```jsx
// Spec E1 §8: statt des roten "fehlt" die drei Zahlen aus dem Abgleich (numbers null = noch nicht geladen).
const DeckCardRow = ({ card, type, numbers, removeFromDeck }) => {
    const missing = !!numbers && numbers.missing > 0;
```
durch:
```jsx
// Spec E1 §8: statt des roten "fehlt" die drei Zahlen aus dem Abgleich (numbers null = noch nicht geladen).
const DeckCardRow = ({ card, type, numbers, removeFromDeck, onMove }) => {
    const missing = !!numbers && numbers.missing > 0;
```

Änderung 20/20 — ersetzen:
```jsx
            </div>
            <DeckCardNumbers card={numbers} />
        </div>
```
durch:
```jsx
            </div>
            <div className="flex items-center gap-2">
                <DeckCardNumbers card={numbers} />
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(card, type); }}
                    className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400 hover:text-white">
                    {moveLabel(type)}
                </button>
            </div>
        </div>
```

- [ ] **Step 5: Lint, Helfer, Build**

Run (in `desktop/`): `npx eslint .` → genau `5 errors` (3 Warnungen, unverändert).
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 180`.
Run (in `desktop/`): `npx vite build` → `✓ built`.

- [ ] **Step 6: Kein neuer Schutz-Test**

Die Oberfläche hat keine automatischen Tests (Plan-Ergänzung 22); alle Regeln stecken in den Helfern aus Task 1–2. Per Grep (lesend) prüfen: `Grep "includes\('Fusion'\)|#created by YuGiOhCardManager|result\.deck" desktop/src/components/DeckBuilder.jsx` → keine Treffer.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/DeckNewMenu.jsx desktop/src/components/DeckImportDialog.jsx desktop/src/components/DeckExportMenu.jsx desktop/src/components/DeckBuilder.jsx
git commit -m "feat(e2): Desktop importiert YDK-Datei und Einfügen mit Vorschau, exportiert YDK/YDKE/Textliste, Side-Deck und Notizen im Editor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: Kotlin-Zwillinge `DeckFormats`, `DeckImport`

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/DeckFormats.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/DeckImport.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/DeckFormatsTest.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/DeckImportTest.kt`

**Interfaces:**
- Produces (für Task 6–8): `ParsedCard(passcode, name, count, section, line)`, `ParsedDeck(format, cards, unresolved, error)`, `DeckEntry(passcode, name, count, section)`; `DeckFormats.YDKE_INVALID`, `NOTHING_RECOGNIZED`, `YDK_HEADER`, `normalizePasscode`, `parseYdk`, `parseYdke`, `parseTextList`, `detectFormat`, `parseDeckText(text, format = detectFormat(text))`, `buildYdk(entries)`, `buildYdke(entries)`, `buildTextList(entries)`. `CatalogNameRow(id, nameDe, nameEn, type, image = null)`, `ImportCandidate(passcode, name, type)`, `ImportRow(status, count, section, source, candidates)`, `ResolvedImport(catalogMissing, rows, unresolved)`, `ImportCard(cardId, name, count, section)`, `ImportCounts(main, extra, side)`, `ImportPlan(cards, counts, skipped, skippedLabels, notes)`, `PreparedImport(error, resolved)`; `DeckImport.CATALOG_MISSING`, `NOT_FOUND`, `DEFAULT_DECK_NAME`, `NOTES_HEAD`, `AMBIGUOUS`, `OPEN`, `deckSectionFor`, `moveTarget`, `moveLabel`, `normalizeName`, `levenshtein`, `unknownPasscodeText`, `suggestionText`, `ambiguousOptionText`, `failedText`, `countsText`, `skippedText`, `deckNameFor`, `resolve(parsed, catalog?)`, `plan(resolved, choices: Map<Int, String>)`, `prepare(text, format?, loadCatalog: (List<String>?) -> List<CatalogNameRow>?)`.
- Consumes (Task 1–2): `formats.json`, `import.json`. Consumes (vorhanden): `Fixtures.text`, `DeckFixtureWorld.Companion.objects` (E1).

Die Kotlin-Fassungen sind vorab mit dem Kotlin-2.0.0-Compiler des Projekts (einzeln) und im vollen Gradle-Lauf der Scratch-Kopie kompiliert und gegen dieselben Fixtures ausgeführt worden.

- [ ] **Step 1: Tests schreiben**

`DeckFormatsTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.DeckEntry
import com.example.yugiohscanner.ml.DeckFormats
import com.example.yugiohscanner.ml.ParsedCard
import com.example.yugiohscanner.ml.ParsedDeck
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/deckFormats.test.js -- dieselbe Fixture docs/fixtures/decks/formats.json. */
class DeckFormatsTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/formats.json"))

    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)

    private fun cards(arr: JSONArray): List<ParsedCard> = arr.objects().map {
        ParsedCard(str(it, "passcode"), str(it, "name"), it.getInt("count"), it.getString("section"), str(it, "line"))
    }

    private fun strings(arr: JSONArray): List<String> = (0 until arr.length()).map { arr.getString(it) }

    @Test fun `Fixture lesen`() {
        for (c in fix.getJSONArray("parse").objects()) {
            val text = c.getString("text")
            val got = str(c, "format")?.let { DeckFormats.parseDeckText(text, it) } ?: DeckFormats.parseDeckText(text)
            val e = c.getJSONObject("expected")
            val expected = ParsedDeck(e.getString("format"), cards(e.getJSONArray("cards")), strings(e.getJSONArray("unresolved")), str(e, "error"))
            assertEquals(c.getString("name"), expected, got)
        }
    }

    @Test fun `Fixture Erkennung`() {
        for (d in fix.getJSONArray("detect").objects()) {
            assertEquals(d.getString("text"), d.getString("format"), DeckFormats.detectFormat(d.getString("text")))
        }
    }

    private fun sectionSums(cards: List<ParsedCard>) = listOf("main", "extra", "side").map { s -> cards.filter { it.section == s }.sumOf { it.count } }

    @Test fun `Fixture schreiben und zuruecklesen`() {
        for (b in fix.getJSONArray("build").objects()) {
            val name = b.getString("name")
            val entries = b.getJSONArray("entries").objects().map {
                DeckEntry(it.getString("passcode"), str(it, "name"), it.getInt("count"), it.getString("section"))
            }
            assertEquals("$name ydk", b.getString("ydk"), DeckFormats.buildYdk(entries))
            assertEquals("$name ydke", b.getString("ydke"), DeckFormats.buildYdke(entries))
            assertEquals("$name text", b.getString("text"), DeckFormats.buildTextList(entries))
            val roundtrip = cards(b.getJSONArray("roundtrip"))
            if (roundtrip.isNotEmpty()) {
                assertEquals("$name ydk zurueck", roundtrip, DeckFormats.parseDeckText(b.getString("ydk")).cards)
                assertEquals("$name ydke zurueck", roundtrip, DeckFormats.parseDeckText(b.getString("ydke")).cards)
                assertEquals("$name text zurueck", sectionSums(roundtrip), sectionSums(DeckFormats.parseTextList(b.getString("text")).cards))
            }
        }
    }

    @Test fun `Passcodes fuehrende Nullen weg, 0 und zu gross ungueltig`() {
        assertEquals("4031928", DeckFormats.normalizePasscode("04031928"))
        assertEquals("4294967295", DeckFormats.normalizePasscode("4294967295"))
        assertEquals(null, DeckFormats.normalizePasscode("4294967296"))
        assertEquals(null, DeckFormats.normalizePasscode("0000"))
        assertEquals(null, DeckFormats.normalizePasscode("12a"))
    }
}
```

`DeckImportTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.CatalogNameRow
import com.example.yugiohscanner.ml.DeckImport
import com.example.yugiohscanner.ml.ImportCandidate
import com.example.yugiohscanner.ml.ImportCard
import com.example.yugiohscanner.ml.ImportCounts
import com.example.yugiohscanner.ml.ParsedCard
import com.example.yugiohscanner.ml.ParsedDeck
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/deckImport.test.js -- dieselbe Fixture docs/fixtures/decks/import.json. */
class DeckImportTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/import.json"))
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    private fun strings(arr: JSONArray): List<String> = (0 until arr.length()).map { arr.getString(it) }

    private val catalog = fix.getJSONArray("catalog").objects().map {
        CatalogNameRow(it.get("id").toString(), str(it, "name_de"), str(it, "name_en"), str(it, "type"))
    }

    @Test fun `Fixture Normalisierung und Levenshtein`() {
        for (c in fix.getJSONArray("normalize").objects()) assertEquals(c.getString("in"), c.getString("out"), DeckImport.normalizeName(c.getString("in")))
        for (c in fix.getJSONArray("levenshtein").objects()) {
            assertEquals("${c.getString("a")}/${c.getString("b")}", c.getInt("d"), DeckImport.levenshtein(c.getString("a"), c.getString("b")))
        }
    }

    @Test fun `Fixture Abschnitt per Typ und Zeilenaktion`() {
        for (c in fix.getJSONArray("sectionFor").objects()) assertEquals("${str(c, "type")}", c.getString("section"), DeckImport.deckSectionFor(str(c, "type")))
        for (c in fix.getJSONArray("moveTarget").objects()) {
            assertEquals(c.getString("target"), DeckImport.moveTarget(c.getString("section"), str(c, "type")))
            assertEquals(c.getString("label"), DeckImport.moveLabel(c.getString("section")))
        }
    }

    @Test fun `Fixture aufloesen und Plan`() {
        for (c in fix.getJSONArray("resolve").objects()) {
            val name = c.getString("name")
            val p = c.getJSONObject("parsed")
            val parsed = ParsedDeck(
                p.getString("format"),
                p.getJSONArray("cards").objects().map { ParsedCard(str(it, "passcode"), str(it, "name"), it.getInt("count"), it.getString("section"), str(it, "line")) },
                strings(p.getJSONArray("unresolved")),
            )
            val resolved = DeckImport.resolve(parsed, if (c.getBoolean("catalog")) catalog else null)
            val e = c.getJSONObject("expected")
            assertEquals("$name catalogMissing", e.getBoolean("catalogMissing"), resolved.catalogMissing)
            val expectedRows = e.getJSONArray("rows").objects().map {
                listOf(it.getString("status"), it.getInt("count"), it.getString("section"), it.getString("source"), strings(it.getJSONArray("candidates")))
            }
            val gotRows = resolved.rows.map { listOf(it.status, it.count, it.section, it.source, it.candidates.map(ImportCandidate::passcode)) }
            assertEquals("$name rows", expectedRows, gotRows)

            for (plan in c.getJSONArray("plans").objects()) {
                val ch = plan.getJSONObject("choices")
                val choices = ch.keys().asSequence().associate { it.toInt() to ch.getString(it) }
                val got = DeckImport.plan(resolved, choices)
                val x = plan.getJSONObject("expected")
                val counts = x.getJSONObject("counts")
                assertEquals("$name $choices cards", x.getJSONArray("cards").objects().map {
                    ImportCard(it.getString("card_id"), it.getString("name"), it.getInt("count"), it.getString("section"))
                }, got.cards)
                assertEquals("$name counts", ImportCounts(counts.getInt("main"), counts.getInt("extra"), counts.getInt("side")), got.counts)
                assertEquals("$name skipped", strings(x.getJSONArray("skipped")), got.skipped)
                assertEquals("$name skippedLabels", strings(x.getJSONArray("skippedLabels")), got.skippedLabels)
                assertEquals("$name notes", str(x, "notes"), got.notes)
                assertEquals("$name countsText", x.getString("countsText"), DeckImport.countsText(got.counts))
                assertEquals("$name skippedText", str(x, "skippedText"), DeckImport.skippedText(got.skipped.size))
            }
        }
    }

    @Test fun `Fixture Texte`() {
        val t = fix.getJSONObject("texts")
        for (x in t.getJSONArray("failed").objects()) assertEquals(x.getString("text"), DeckImport.failedText(x.getString("message")))
        for (x in t.getJSONArray("deckName").objects()) assertEquals(x.getString("name"), DeckImport.deckNameFor(str(x, "file")))
        for (x in t.getJSONArray("suggestion").objects()) assertEquals(x.getString("text"), DeckImport.suggestionText(x.getString("name")))
        for (x in t.getJSONArray("ambiguousOption").objects()) {
            assertEquals(x.getString("text"), DeckImport.ambiguousOptionText(ImportCandidate(x.getString("passcode"), x.getString("name"), "")))
        }
        for (x in t.getJSONArray("unknownPasscode").objects()) assertEquals(x.getString("text"), DeckImport.unknownPasscodeText(x.getString("passcode")))
    }

    @Test fun `Vorschau vorbereiten laedt fuer YDKE nur die Passcodes, fuer Text alle, bei Lesefehler nichts`() {
        val calls = mutableListOf<List<String>?>()
        val load = { ids: List<String>? -> calls.add(ids); catalog }
        val ydke = DeckImport.prepare("ydke://ryPeAA==!!!", null, load)
        assertEquals(listOf(listOf("14558127")), calls)
        assertEquals("ok", ydke.resolved!!.rows[0].status)
        val text = DeckImport.prepare("3 Raigeki", null, load)
        assertEquals(null, calls[1])
        assertEquals(listOf("12580477"), text.resolved!!.rows[0].candidates.map { it.passcode })
        assertEquals("Kein gültiger YDKE-Link", DeckImport.prepare("ydke://kaputt", null, load).error)
        assertEquals("Keine Deckliste erkannt", DeckImport.prepare("3 Raigeki", "ydk", load).error)
        assertEquals("ohne gelesene Karte kein Katalogzugriff", 2, calls.size)
        assertEquals(true, DeckImport.prepare("3 Raigeki", null) { null }.resolved!!.catalogMissing)
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests '*DeckFormatsTest' --tests '*DeckImportTest'`
Expected: FAIL beim Kompilieren (`Unresolved reference: DeckFormats` / `DeckImport`).

- [ ] **Step 3: `ml/DeckFormats.kt` anlegen**

```kotlin
package com.example.yugiohscanner.ml

/** Gelesene Karte: YDK/YDKE mit [passcode], Textliste mit [name] und Rohzeile [line]. section: main|extra|side|unknown. */
data class ParsedCard(
    val passcode: String?,
    val name: String?,
    val count: Int,
    val section: String,
    val line: String?,
)

data class ParsedDeck(val format: String, val cards: List<ParsedCard>, val unresolved: List<String>, val error: String? = null)

/** Eine Deckzeile zum Schreiben (mehrere Zeilen je Passcode erlaubt). */
data class DeckEntry(val passcode: String, val name: String?, val count: Int, val section: String)

/**
 * Spec E2 §3 -- Decklisten-Formate YDK, YDKE und Textliste: lesen, schreiben, erkennen.
 * ZWILLING: desktop/src/utils/deckFormats.js. Beide laufen gegen docs/fixtures/decks/formats.json.
 * Wer eine Seite aendert, aendert beide.
 */
object DeckFormats {
    const val YDKE_INVALID = "Kein gültiger YDKE-Link"
    const val NOTHING_RECOGNIZED = "Keine Deckliste erkannt"
    const val YDK_HEADER = "#created by YGO Card Manager"

    private const val MAX_UINT32 = 4294967295L
    // Standard-Base64 mit Auffuellung; dasselbe Muster wie der JS-Zwilling (java.util.Base64 ist nachsichtiger).
    private val BASE64 = Regex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")
    // (?U): \s wie im JS-Zwilling auch fuer geschuetzte Leerzeichen aus Webseiten; Ziffern bewusst [0-9].
    private val HEADING = Regex("(?U)^(main|extra|side)(?:\\s+deck)?\\s*(?::|\\([0-9]+\\))?$", RegexOption.IGNORE_CASE)
    private val COUNT_FIRST = Regex("(?U)^([0-9]+)(?:\\s*[xX])?\\s+(\\S.*)$")
    private val COUNT_LAST = Regex("(?U)^(.+?)\\s+[xX]([0-9]+)$")
    private val LINE_BREAK = Regex("\\r?\\n")
    private val WHITESPACE = Regex("(?U)\\s+")
    private val PASSCODE = Regex("^[0-9]{1,10}$")
    private val SECTIONS = listOf("main", "extra", "side")

    /** Passcode als Zahl ohne fuehrende Nullen; 1..2^32-1, sonst null. */
    fun normalizePasscode(raw: String): String? {
        val t = raw.trim()
        if (!PASSCODE.matches(t)) return null
        val n = t.toLong()
        return if (n in 1..MAX_UINT32) n.toString() else null
    }

    private fun MutableList<ParsedCard>.addPasscode(passcode: String, section: String) {
        val i = indexOfFirst { it.passcode == passcode && it.section == section }
        if (i >= 0) this[i] = this[i].copy(count = this[i].count + 1)
        else add(ParsedCard(passcode, null, 1, section, null))
    }

    fun parseYdk(text: String): ParsedDeck {
        val cards = mutableListOf<ParsedCard>()
        val unresolved = mutableListOf<String>()
        var section = "main"
        for (raw in text.split(LINE_BREAK)) {
            val t = raw.trim()
            if (t.isEmpty()) continue
            when (t.lowercase()) {
                "#main" -> section = "main"
                "#extra" -> section = "extra"
                "!side" -> section = "side"
                else -> if (!t.startsWith("#")) {
                    val passcode = normalizePasscode(t)
                    if (passcode != null) cards.addPasscode(passcode, section) else unresolved.add(t)
                }
            }
        }
        return ParsedDeck("ydk", cards, unresolved)
    }

    private fun decodeBlock(block: String): List<Long>? {
        if (!BASE64.matches(block)) return null
        val bytes = java.util.Base64.getDecoder().decode(block)
        if (bytes.size % 4 != 0) return null
        return (bytes.indices step 4).map { i ->
            (bytes[i].toLong() and 0xFF) or ((bytes[i + 1].toLong() and 0xFF) shl 8) or
                ((bytes[i + 2].toLong() and 0xFF) shl 16) or ((bytes[i + 3].toLong() and 0xFF) shl 24)
        }
    }

    fun parseYdke(text: String): ParsedDeck {
        val invalid = ParsedDeck("ydke", emptyList(), emptyList(), YDKE_INVALID)
        val body = text.trim()
        if (!body.startsWith("ydke://")) return invalid
        var parts = body.removePrefix("ydke://").replace(WHITESPACE, "").split("!")
        if (parts.size == 4 && parts[3].isEmpty()) parts = parts.take(3)
        if (parts.size != 3) return invalid
        val cards = mutableListOf<ParsedCard>()
        val unresolved = mutableListOf<String>()
        for (s in 0 until 3) {
            val codes = decodeBlock(parts[s]) ?: return invalid
            for (n in codes) {
                if (n == 0L) unresolved.add("0") else cards.addPasscode(n.toString(), SECTIONS[s])
            }
        }
        return ParsedDeck("ydke", cards, unresolved)
    }

    fun parseTextList(text: String): ParsedDeck {
        val cards = mutableListOf<ParsedCard>()
        val unresolved = mutableListOf<String>()
        var section = "unknown"
        for (raw in text.split(LINE_BREAK)) {
            val t = raw.trim()
            if (t.isEmpty() || t.startsWith("#") || t.startsWith("//")) continue
            val heading = HEADING.find(t)
            if (heading != null) { section = heading.groupValues[1].lowercase(); continue }
            var count = 1
            var name = t
            val first = COUNT_FIRST.find(t)
            val last = if (first == null) COUNT_LAST.find(t) else null
            if (first != null) { count = first.groupValues[1].toIntOrNull() ?: 0; name = first.groupValues[2] }
            else if (last != null) { name = last.groupValues[1]; count = last.groupValues[2].toIntOrNull() ?: 0 }
            if (count !in 1..99) { unresolved.add(t); continue }
            cards.add(ParsedCard(null, name.trim(), count, section, t))
        }
        return ParsedDeck("text", cards, unresolved)
    }

    fun detectFormat(text: String): String {
        val body = text.trim()
        if (body.startsWith("ydke://")) return "ydke"
        val lines = body.split(LINE_BREAK).map { it.trim().lowercase() }
        return if ("#main" in lines || "!side" in lines) "ydk" else "text"
    }

    /** Einstieg fuer Einfuegen/Teilen: erkennt (oder nimmt [format]), liest, "Keine Deckliste erkannt" ohne Karte. */
    fun parseDeckText(text: String, format: String = detectFormat(text)): ParsedDeck {
        val parsed = when (format) {
            "ydke" -> parseYdke(text)
            "ydk" -> parseYdk(text)
            else -> parseTextList(text)
        }
        if (parsed.error != null) return parsed
        return if (parsed.cards.isEmpty()) parsed.copy(error = NOTHING_RECOGNIZED) else parsed
    }

    private fun ofSection(entries: List<DeckEntry>, section: String) = entries.filter { it.count > 0 && it.section == section }

    fun buildYdk(entries: List<DeckEntry>): String {
        val lines = mutableListOf(YDK_HEADER)
        for ((head, section) in listOf("#main" to "main", "#extra" to "extra", "!side" to "side")) {
            lines.add(head)
            for (e in ofSection(entries, section)) repeat(e.count) { lines.add(e.passcode) }
        }
        return lines.joinToString("\n") + "\n"
    }

    private fun encodeBlock(entries: List<DeckEntry>): String {
        val out = java.io.ByteArrayOutputStream()
        for (e in entries) {
            val n = e.passcode.toLong()
            repeat(e.count) {
                out.write((n and 0xFF).toInt()); out.write(((n shr 8) and 0xFF).toInt())
                out.write(((n shr 16) and 0xFF).toInt()); out.write(((n shr 24) and 0xFF).toInt())
            }
        }
        return java.util.Base64.getEncoder().encodeToString(out.toByteArray())
    }

    fun buildYdke(entries: List<DeckEntry>): String =
        "ydke://" + SECTIONS.joinToString("") { encodeBlock(ofSection(entries, it)) + "!" }

    fun buildTextList(entries: List<DeckEntry>): String {
        val lines = mutableListOf<String>()
        for ((head, section) in listOf("Main Deck" to "main", "Extra Deck" to "extra", "Side Deck" to "side")) {
            val summed = LinkedHashMap<String, Pair<String, Int>>()
            for (e in ofSection(entries, section)) {
                val prev = summed[e.passcode]
                summed[e.passcode] = if (prev == null) (e.name?.takeIf { it.isNotEmpty() } ?: e.passcode) to e.count
                else prev.first to prev.second + e.count
            }
            if (summed.isEmpty()) continue
            lines.add(head)
            for ((name, count) in summed.values) lines.add("$count $name")
        }
        return lines.joinToString("\n")
    }
}
```

- [ ] **Step 4: `ml/DeckImport.kt` anlegen**

```kotlin
package com.example.yugiohscanner.ml

import java.text.Normalizer

/** Katalogzeile fuer die Aufloesung (Handy: aus CatalogDb). image nur fuer das Anlegen, nicht fuer die Regel. */
data class CatalogNameRow(val id: String, val nameDe: String?, val nameEn: String?, val type: String?, val image: String? = null)

data class ImportCandidate(val passcode: String, val name: String, val type: String)

/** status: ok | ambiguous | suggest | notFound | unknownPasscode; source = Passcode (YDK/YDKE) bzw. Rohzeile. */
data class ImportRow(val status: String, val count: Int, val section: String, val source: String, val candidates: List<ImportCandidate>)

data class ResolvedImport(val catalogMissing: Boolean, val rows: List<ImportRow>, val unresolved: List<String>)

data class ImportCard(val cardId: String, val name: String, val count: Int, val section: String)

data class ImportCounts(val main: Int, val extra: Int, val side: Int)

/** skipped = Zeilen fuer die Notizen; skippedLabels = dieselben Zeilen fuer den Block "Nicht übernommen" (mit Grund). */
data class ImportPlan(
    val cards: List<ImportCard>, val counts: ImportCounts, val skipped: List<String>, val skippedLabels: List<String>, val notes: String?,
)

/** Ergebnis der Vorbereitung: entweder [error] (Lesefehler) oder [resolved]. */
data class PreparedImport(val error: String?, val resolved: ResolvedImport?)

/**
 * Spec E2 §4/§5 -- Namensaufloesung gegen den Offline-Katalog, Abschnittsregel, Vorschau-Plan, Notizen und Texte.
 * ZWILLING: desktop/src/utils/deckImport.js. Beide laufen gegen docs/fixtures/decks/import.json.
 * Wer eine Seite aendert, aendert beide.
 */
object DeckImport {
    const val CATALOG_MISSING = "Katalog fehlt – Namen können nicht aufgelöst werden"
    const val NOT_FOUND = "Nicht gefunden"
    const val DEFAULT_DECK_NAME = "Importiertes Deck"
    const val NOTES_HEAD = "Nicht übernommen beim Import:"
    const val AMBIGUOUS = "Mehrdeutig – bitte wählen"
    const val OPEN = "offen"

    private val EXTRA_TYPES = listOf("fusion", "synchro", "xyz", "link")
    private val MARKS = Regex("\\p{M}+")
    private val NON_ALNUM = Regex("[^\\p{L}\\p{N}]+")

    /** Typ enthaelt Fusion/Synchro/XYZ/Link (Gross/Klein egal) -> extra, sonst main. Auch fuer "Ziel: Deck". */
    fun deckSectionFor(type: String?): String {
        val t = (type ?: "").lowercase()
        return if (EXTRA_TYPES.any { t.contains(it) }) "extra" else "main"
    }

    /** Zeilenaktion: aus dem Side-Deck "→ Deck" (Main/Extra per Typ), sonst "→ Side". */
    fun moveTarget(section: String, type: String?): String = if (section == "side") deckSectionFor(type) else "side"

    fun moveLabel(section: String): String = if (section == "side") "→ Deck" else "→ Side"

    fun normalizeName(s: String?): String {
        val lower = (s ?: "").lowercase()
        val stripped = MARKS.replace(Normalizer.normalize(lower, Normalizer.Form.NFKD), "")
        return NON_ALNUM.replace(stripped.replace("ß", "ss"), " ").trim()
    }

    fun levenshtein(a: String, b: String): Int {
        var prev = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val cur = IntArray(b.length + 1)
            cur[0] = i
            for (j in 1..b.length) {
                cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
            }
            prev = cur
        }
        return prev[b.length]
    }

    fun unknownPasscodeText(passcode: String) = "Unbekannter Passcode $passcode"
    fun suggestionText(name: String) = "Meintest du $name?"
    fun ambiguousOptionText(c: ImportCandidate) = "${c.name} (${c.passcode})"
    fun failedText(message: String?) = "Import fehlgeschlagen: $message"
    fun countsText(counts: ImportCounts) = "Main ${counts.main} · Extra ${counts.extra} · Side ${counts.side}"
    fun skippedText(n: Int): String? = if (n > 0) "$n nicht übernommen" else null
    fun deckNameFor(fileName: String?): String = fileName?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_DECK_NAME

    private fun displayName(c: CatalogNameRow) = c.nameDe?.takeIf { it.isNotEmpty() } ?: c.nameEn?.takeIf { it.isNotEmpty() } ?: c.id
    private fun candidate(c: CatalogNameRow) = ImportCandidate(c.id, displayName(c), c.type ?: "")
    // Codeeinheiten-Vergleich wie "<" im JS-Zwilling (kein Locale-Vergleich).
    private val byNameThenPasscode = compareBy<ImportCandidate>({ it.name }, { it.passcode })

    private class Index(cards: List<CatalogNameRow>) {
        val byId = LinkedHashMap<String, CatalogNameRow>()
        val exact = HashMap<String, MutableList<String>>()
        val norm = HashMap<String, MutableList<String>>()
        val entries = ArrayList<Pair<String, List<String>>>()

        init {
            for (c in cards) {
                byId[c.id] = c
                val norms = mutableListOf<String>()
                for (name in listOfNotNull(c.nameDe, c.nameEn).filter { it.isNotEmpty() }) {
                    add(exact, name.trim().lowercase(), c.id)
                    val n = normalizeName(name)
                    add(norm, n, c.id)
                    if (n.isNotEmpty() && n !in norms) norms.add(n)
                }
                entries.add(c.id to norms)
            }
        }

        private fun add(map: HashMap<String, MutableList<String>>, key: String, id: String) {
            if (key.isEmpty()) return
            val list = map.getOrPut(key) { mutableListOf() }
            if (id !in list) list.add(id)
        }
    }

    private fun fuzzy(index: Index, n: String): List<ImportCandidate> {
        if (n.length < 6) return emptyList()
        val hits = ArrayList<Pair<ImportCandidate, Int>>()
        for ((id, norms) in index.entries) {
            var best = Int.MAX_VALUE
            for (x in norms) {
                if (Math.abs(x.length - n.length) > 2) continue   // folgt aus Abstand <= 2; spart die Rechnung
                best = minOf(best, levenshtein(n, x))
            }
            if (best <= 2) hits.add(candidate(index.byId.getValue(id)) to best)
        }
        return hits.sortedWith(compareBy<Pair<ImportCandidate, Int>> { it.second }.thenBy(byNameThenPasscode) { it.first })
            .take(3).map { it.first }
    }

    /** [catalog] null = kein Katalog. Fuer YDK/YDKE reichen die Zeilen der gelesenen Passcodes, fuer Text alle. */
    fun resolve(parsed: ParsedDeck, catalog: List<CatalogNameRow>?): ResolvedImport {
        val index = Index(catalog ?: emptyList())
        val rows = parsed.cards.map { card ->
            if (card.passcode != null) {
                val c = index.byId[card.passcode]
                if (c != null) ImportRow("ok", card.count, card.section, card.passcode, listOf(candidate(c)))
                else ImportRow("unknownPasscode", card.count, card.section, card.passcode, emptyList())
            } else {
                val source = card.line ?: card.name ?: ""
                val name = card.name ?: ""
                val n = normalizeName(name)
                val ids = index.exact[name.trim().lowercase()] ?: (if (n.isNotEmpty()) index.norm[n] else null)
                if (ids != null) {
                    val cands = ids.map { candidate(index.byId.getValue(it)) }.sortedWith(byNameThenPasscode)
                    ImportRow(if (ids.size == 1) "ok" else "ambiguous", card.count, card.section, source, cands)
                } else {
                    val suggestions = fuzzy(index, n)
                    if (suggestions.isNotEmpty()) ImportRow("suggest", card.count, card.section, source, suggestions)
                    else ImportRow("notFound", card.count, card.section, source, emptyList())
                }
            }
        }
        return ResolvedImport(catalog == null, rows, parsed.unresolved)
    }

    /** [choices]: Zeilenindex -> Passcode (Auswahl bei Vorschlag/Mehrdeutig). Offene Zeilen werden nicht uebernommen. */
    fun plan(resolved: ResolvedImport, choices: Map<Int, String> = emptyMap()): ImportPlan {
        val cards = mutableListOf<ImportCard>()
        var main = 0; var extra = 0; var side = 0
        val skipped = resolved.unresolved.toMutableList()
        val skippedLabels = resolved.unresolved.toMutableList()
        resolved.rows.forEachIndexed { i, row ->
            val chosen = when (row.status) {
                "ok" -> row.candidates.first()
                "ambiguous", "suggest" -> row.candidates.firstOrNull { it.passcode == choices[i] }
                else -> null
            }
            if (chosen == null) {
                skipped.add(if (row.status == "unknownPasscode") unknownPasscodeText(row.source) else row.source)
                skippedLabels.add(
                    if (row.status == "unknownPasscode") unknownPasscodeText(row.source)
                    else "${row.source} · ${if (row.status == "notFound") NOT_FOUND else OPEN}"
                )
                return@forEachIndexed
            }
            val section = if (row.section == "unknown") deckSectionFor(chosen.type) else row.section
            val at = cards.indexOfFirst { it.cardId == chosen.passcode && it.section == section }
            if (at >= 0) cards[at] = cards[at].copy(count = cards[at].count + row.count)
            else cards.add(ImportCard(chosen.passcode, chosen.name, row.count, section))
            when (section) { "extra" -> extra += row.count; "side" -> side += row.count; else -> main += row.count }
        }
        val notes = if (skipped.isEmpty()) null else (listOf(NOTES_HEAD) + skipped).joinToString("\n")
        return ImportPlan(cards, ImportCounts(main, extra, side), skipped, skippedLabels, notes)
    }

    /**
     * Einstieg der Vorschau (Einfuegen, Teilen): lesen mit dem gemeinsamen Parser, dann den Katalog laden -- fuer
     * YDK/YDKE nur die gelesenen Passcodes, fuer die Textliste alle Karten -- und aufloesen. [loadCatalog] liefert
     * null ohne Katalog. Laeuft abseits des Hauptthreads (Katalogzugriff, Fuzzy-Suche).
     */
    fun prepare(text: String, format: String?, loadCatalog: (List<String>?) -> List<CatalogNameRow>?): PreparedImport {
        val parsed = if (format != null) DeckFormats.parseDeckText(text, format) else DeckFormats.parseDeckText(text)
        if (parsed.error != null) return PreparedImport(parsed.error, null)
        val ids = if (parsed.format == "text") null else parsed.cards.mapNotNull { it.passcode }
        return PreparedImport(null, resolve(parsed, loadCatalog(ids)))
    }
}
```

- [ ] **Step 5: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, 504 Tests, 0 Fehler (neu: `DeckFormatsTest` 4, `DeckImportTest` 5).

- [ ] **Step 6: Schutz-Nachweis**

(a) In `DeckFormats.kt` bei `COUNT_FIRST` kurz das `(?U)` entfernen → `Fixture lesen` scheitert beim Fall „geschütztes Leerzeichen" mit `… but was:<… name=3 Raigeki, count=1 …>` (gemessen: Javas `\s` kennt ohne `(?U)` kein geschütztes Leerzeichen, der JS-Zwilling schon). Zitieren, zurücknehmen.
(b) In `normalizeName` `stripped.replace("ß", "ss")` kurz durch `stripped` ersetzen → `Fixture Normalisierung und Levenshtein` und `Fixture aufloesen und Plan` scheitern (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/DeckFormats.kt android/app/src/main/java/com/example/yugiohscanner/ml/DeckImport.kt android/app/src/test/java/com/example/yugiohscanner/DeckFormatsTest.kt android/app/src/test/java/com/example/yugiohscanner/DeckImportTest.kt
git commit -m "feat(e2): Kotlin-Zwillinge DeckFormats und DeckImport gegen die gemeinsamen Fixtures

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Handy-Repositories — Notizen, Anlegen mit Rückbau, Verschieben, Katalogzeilen für den Import

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/DecksRepositoryTest.kt`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt`

**Interfaces:**
- Produces (für Task 8): `Deck(id, name, containerId = null, notes = null)`; `DecksRepository.createDeck(name, notes = null): Long`, `internal suspend createWithRollback(create, insertCards, delete): Long`, `internal importCardsJson(deckId, cards: List<ImportCard>, imageOf: Map<String, String?>): JSONArray`, `suspend createImportedDeck(name, notes, cards, imageOf): Long` (wirft bei Fehler, Deck dann gelöscht), `suspend moveOne(deckId, card: DeckCard, deckCards: List<DeckCard>, type: String?)`; `CatalogRepository.internal importRowsQuery(ids: List<String>?): Pair<String, Array<String>>`, `importRows(ids: Collection<String>?): List<CatalogNameRow>`.
- Consumes (Task 5): `DeckImport.moveTarget`, `ImportCard`, `CatalogNameRow`. Vorhanden: `addCard`, `setCount`, `deleteDeck`, `executeWithReauth`, `err`, `SupabaseCloud`.

- [ ] **Step 1: Tests schreiben**

In `android/app/src/test/java/com/example/yugiohscanner/DecksRepositoryTest.kt` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```kotlin
import com.example.yugiohscanner.cloud.DecksRepository
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
```
durch:
```kotlin
import com.example.yugiohscanner.cloud.DecksRepository
import com.example.yugiohscanner.ml.ImportCard
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
```

Änderung 2/2 — ersetzen:
```kotlin
    }
}
```
durch:
```kotlin
    }

    @Test fun `Deck liest notes, null und fehlend werden null`() {
        assertEquals(
            Deck(4, "Import", null, "Nicht übernommen beim Import:\nJinzu"),
            DecksRepository.parseDeck(JSONObject("""{"id":4,"name":"Import","container_id":null,"notes":"Nicht übernommen beim Import:\nJinzu"}""")),
        )
        assertEquals(null, DecksRepository.parseDeck(JSONObject("""{"id":5,"name":"Leer","notes":null}""")).notes)
        assertEquals(null, DecksRepository.parseDeck(JSONObject("""{"id":6,"name":"Alt"}""")).notes)
    }

    @Test fun `Import-Karten als ein JSON-Array mit Katalogbild`() {
        val rows = DecksRepository.importCardsJson(
            42,
            listOf(ImportCard("14558127", "Asche-Blüte & Freudiger Frühling", 3, "main"), ImportCard("27204311", "Nibiru, das Urwesen", 2, "side")),
            mapOf("14558127" to "https://img/14558127.jpg"),
        )
        assertEquals(2, rows.length())
        val first = rows.getJSONObject(0)
        assertEquals(42L, first.getLong("deck_id"))
        assertEquals("14558127", first.getString("card_id"))
        assertEquals("https://img/14558127.jpg", first.getString("image_url"))
        assertEquals(3, first.getInt("count"))
        assertEquals("main", first.getString("section"))
        val second = rows.getJSONObject(1)
        assertTrue("ohne Katalogbild image_url null", second.isNull("image_url"))
        assertEquals("side", second.getString("section"))
    }

    @Test fun `Import scheitern die Karten, wird das leere Deck geloescht und der Fehler weitergereicht`() = runTest {
        val deleted = mutableListOf<Long>()
        val error = runCatching {
            DecksRepository.createWithRollback(
                create = { 42L },
                insertCards = { throw RuntimeException("Karten anlegen fehlgeschlagen (400): kaputt") },
                delete = { deleted.add(it) },
            )
        }.exceptionOrNull()
        assertEquals("Karten anlegen fehlgeschlagen (400): kaputt", error?.message)
        assertEquals(listOf(42L), deleted)
    }

    @Test fun `Import gelingt, nichts geloescht`() = runTest {
        val deleted = mutableListOf<Long>()
        val inserted = mutableListOf<Long>()
        val id = DecksRepository.createWithRollback(create = { 7L }, insertCards = { inserted.add(it) }, delete = { deleted.add(it) })
        assertEquals(7L, id)
        assertEquals(listOf(7L), inserted)
        assertTrue(deleted.isEmpty())
    }
}
```

In `android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```kotlin
    }
}
```
durch:
```kotlin
    }

    @Test fun `Import-Abfrage mit Passcodes samt Bild, ohne alle Karten ohne Bild`() {
        val (sql, args) = CatalogRepository.importRowsQuery(listOf("14558127", "23434538"))
        assertEquals("SELECT id, name_de, name_en, type, image FROM cards WHERE id IN (?,?)", sql)
        assertEquals(listOf("14558127", "23434538"), args.toList())
        val (all, none) = CatalogRepository.importRowsQuery(null)
        assertEquals("SELECT id, name_de, name_en, type, NULL FROM cards", all)
        assertEquals(0, none.size)
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests '*DecksRepositoryTest' --tests '*CatalogParserTest'`
Expected: FAIL beim Kompilieren (`Unresolved reference: importCardsJson`, `createWithRollback`, `importRowsQuery`; `Deck` hat keinen vierten Parameter).

- [ ] **Step 3: `DecksRepository.kt`**

In `android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt` (5 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/5 — ersetzen:
```kotlin

import kotlinx.coroutines.Dispatchers
```
durch:
```kotlin

import com.example.yugiohscanner.ml.DeckImport
import com.example.yugiohscanner.ml.ImportCard
import kotlinx.coroutines.Dispatchers
```

Änderung 2/5 — ersetzen:
```kotlin

data class Deck(val id: Long, val name: String, val containerId: String? = null)
data class DeckCard(
```
durch:
```kotlin

// Spec E2 §5: notes = "Nicht übernommen beim Import:" …, am Handy nur Anzeige.
data class Deck(val id: Long, val name: String, val containerId: String? = null, val notes: String? = null)
data class DeckCard(
```

Änderung 3/5 — ersetzen:
```kotlin

    suspend fun createDeck(name: String): Long = withContext(Dispatchers.IO) {
        val body = JSONObject().put("name", name).toString()
        executeWithReauth {
```
durch:
```kotlin

    /** Spec E2 §5: [notes] nur mitsenden, wenn es welche gibt (ein Import ohne Nicht-Uebernommenes klappt so auch vor decks_notes.sql). */
    suspend fun createDeck(name: String, notes: String? = null): Long = withContext(Dispatchers.IO) {
        val body = JSONObject().put("name", name).apply { if (notes != null) put("notes", notes) }.toString()
        executeWithReauth {
```

Änderung 4/5 — ersetzen:
```kotlin

    private fun base(url: HttpUrl): Request.Builder =
```
durch:
```kotlin

    /**
     * Spec E2 §5: Rueckbau beim Import -- scheitert das Einfuegen der Karten, wird das eben angelegte (leere) Deck wieder
     * geloescht und der Fehler weitergereicht. Rein, damit ohne Netz testbar.
     * ZWILLING (Rueckbau): desktop/electron/decks.cjs#createImportedDeck.
     */
    internal suspend fun createWithRollback(
        create: suspend () -> Long,
        insertCards: suspend (Long) -> Unit,
        delete: suspend (Long) -> Unit,
    ): Long {
        val id = create()
        try {
            insertCards(id)
        } catch (e: Exception) {
            try { delete(id) } catch (_: Exception) { /* der eigentliche Fehler zaehlt */ }
            throw e
        }
        return id
    }

    /** Spec E2 §5: alle Deckkarten eines Imports als ein JSON-Array (ein Insert), Bild aus dem Katalog. */
    internal fun importCardsJson(deckId: Long, cards: List<ImportCard>, imageOf: Map<String, String?>): JSONArray =
        JSONArray().apply {
            for (c in cards) put(
                JSONObject().put("deck_id", deckId).put("card_id", c.cardId).put("name", c.name)
                    .put("image_url", imageOf[c.cardId] ?: JSONObject.NULL).put("count", c.count).put("section", c.section)
            )
        }

    /** Spec E2 §5: Import legt immer ein neues Deck an -- Deck mit Notizen, dann alle Karten in einem Insert, sonst Rueckbau. */
    suspend fun createImportedDeck(name: String, notes: String?, cards: List<ImportCard>, imageOf: Map<String, String?>): Long =
        createWithRollback(
            create = { createDeck(name, notes) },
            insertCards = { id -> if (cards.isNotEmpty()) insertCards(importCardsJson(id, cards, imageOf)) },
            delete = { id -> deleteDeck(id) },
        )

    private suspend fun insertCards(rows: JSONArray) = withContext(Dispatchers.IO) {
        executeWithReauth {
            base("${SupabaseCloud.base()}/rest/v1/deck_cards".toHttpUrl())
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .post(rows.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err("Karten anlegen", r) }
    }

    /**
     * Spec E2 §6: eine Kopie verschieben ("→ Side" / "→ Deck", Ziel per DeckImport.moveTarget). Erst das Ziel erhoehen,
     * dann die Quelle senken -- scheitert der zweite Schritt, ist eine Kopie zu viel da statt eine verloren.
     */
    suspend fun moveOne(deckId: Long, card: DeckCard, deckCards: List<DeckCard>, type: String?) {
        val to = DeckImport.moveTarget(card.section, type)
        val target = deckCards.firstOrNull { it.cardId == card.cardId && it.section == to }
        if (target != null) setCount(target.id, target.count + 1)
        else addCard(deckId, card.cardId, card.name, card.imageUrl, to)
        setCount(card.id, card.count - 1)
    }

    private fun base(url: HttpUrl): Request.Builder =
```

Änderung 5/5 — ersetzen:
```kotlin
        containerId = if (o.isNull("container_id")) null else o.optString("container_id"),
    )
```
durch:
```kotlin
        containerId = if (o.isNull("container_id")) null else o.optString("container_id"),
        notes = if (o.isNull("notes")) null else o.optString("notes"),
    )
```

- [ ] **Step 4: `CatalogRepository.kt`**

In `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```kotlin
import android.database.Cursor
```
durch:
```kotlin
import android.database.Cursor
import com.example.yugiohscanner.ml.CatalogNameRow
```

Änderung 2/2 — ersetzen:
```kotlin

    private fun escapeLike(input: String): String =
```
durch:
```kotlin

    /** Spec E2 §4: SQL fuer den Import -- rein, damit ohne SQLite testbar. ids null = alle Karten, ohne Bild. */
    internal fun importRowsQuery(ids: List<String>?): Pair<String, Array<String>> =
        if (ids == null) "SELECT id, name_de, name_en, type, NULL FROM cards" to emptyArray()
        else "SELECT id, name_de, name_en, type, image FROM cards WHERE id IN (${ids.joinToString(",") { "?" }})" to ids.toTypedArray()

    /**
     * Spec E2 §4: Namen und Typ fuer die Namensaufloesung -- mit [ids] nur diese Passcodes (samt Bild, in Bloecken zu 500),
     * mit null alle Karten ohne Bild. Die Liste lebt nur waehrend des Imports. Aufrufer lesen abseits des Hauptthreads.
     */
    fun importRows(ids: Collection<String>?): List<CatalogNameRow> {
        val database = db?.readableDatabase ?: return emptyList()
        val out = ArrayList<CatalogNameRow>()
        val chunks: List<List<String>?> = ids?.distinct()?.chunked(500) ?: listOf(null)
        for (chunk in chunks) {
            val (sql, args) = importRowsQuery(chunk)
            database.rawQuery(sql, args).use { c ->
                while (c.moveToNext()) {
                    out.add(CatalogNameRow(c.getString(0), c.getString(1), c.getString(2), c.getString(3), if (c.isNull(4)) null else c.getString(4)))
                }
            }
        }
        return out
    }

    private fun escapeLike(input: String): String =
```

- [ ] **Step 5: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, 509 Tests, 0 Fehler (neu: `DecksRepositoryTest` +4, `CatalogParserTest` +1).
Aufrufer prüfen (Plan-Ergänzung 21): `Grep "createDeck\(" android/app/src/main/java` → außer der Definition nur `DecksScreen.kt` (ein Argument, Körper unverändert) und `DecksRepository.createImportedDeck`.

- [ ] **Step 6: Schutz-Nachweis**

In `createWithRollback` die Zeile `            try { delete(id) } catch (_: Exception) { /* der eigentliche Fehler zaehlt */ }` kurz auskommentieren → `Import scheitern die Karten, wird das leere Deck geloescht …` scheitert (`java.lang.AssertionError at DecksRepositoryTest.kt:61`, gemessen). Zitieren, zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt android/app/src/test/java/com/example/yugiohscanner/DecksRepositoryTest.kt android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt
git commit -m "feat(e2): Handy-Repositories für Import mit Rückbau, Notizen, Verschieben und Katalogzeilen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Handy — Share-Ziel, Postfach, Navigation nach dem Login

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/DeckImportInbox.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/DeckImportInboxTest.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt`

**Interfaces:**
- Produces (für Task 8): `DeckImportInbox.text: StateFlow<String?>`, `offer(text)`, `take(): String?` (genau einmal), `sharedText(action: String?, mimeType: String?, extraText: CharSequence?): String?`. AppNav navigiert bei wartendem Text und `cloudReady` nach `Routes.sammlung("decks")`.
- Consumes (vorhanden): `Routes.sammlung`, `navigateTop`, `cloudReady` und das Lade-Tor in `AppNav`.

- [ ] **Step 1: Test schreiben**

`DeckImportInboxTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ui.DeckImportInbox
import org.junit.Assert.assertEquals
import org.junit.Test

/** Spec E2 §6/§9: Share-Intent-Auswertung und Postfach ohne Geraet. */
class DeckImportInboxTest {
    @Test fun `nur ACTION_SEND mit text-plain und Text wird angenommen`() {
        val send = "android.intent.action.SEND"
        assertEquals("ydke://!!!", DeckImportInbox.sharedText(send, "text/plain", "ydke://!!!"))
        assertEquals("3 Raigeki", DeckImportInbox.sharedText(send, "text/plain; charset=utf-8", "3 Raigeki"))
        assertEquals(null, DeckImportInbox.sharedText("android.intent.action.MAIN", "text/plain", "3 Raigeki"))
        assertEquals(null, DeckImportInbox.sharedText(send, "image/png", "3 Raigeki"))
        assertEquals(null, DeckImportInbox.sharedText(send, null, "3 Raigeki"))
        assertEquals(null, DeckImportInbox.sharedText(send, "text/plain", "   "))
        assertEquals(null, DeckImportInbox.sharedText(send, "text/plain", null))
    }

    @Test fun `Postfach haelt den Text bis zum Herausnehmen, genau einmal`() {
        DeckImportInbox.take()
        DeckImportInbox.offer("ydke://!!!")
        assertEquals("ydke://!!!", DeckImportInbox.text.value)
        DeckImportInbox.offer("3 Raigeki")
        assertEquals("der neueste geteilte Text gilt", "3 Raigeki", DeckImportInbox.take())
        assertEquals(null, DeckImportInbox.text.value)
        assertEquals(null, DeckImportInbox.take())
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests '*DeckImportInboxTest'`
Expected: FAIL beim Kompilieren (`Unresolved reference: DeckImportInbox`).

- [ ] **Step 3: `ui/DeckImportInbox.kt` anlegen**

```kotlin
package com.example.yugiohscanner.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.getAndUpdate

/**
 * Spec E2 §6: Postfach fuer geteilten Text (Share-Ziel). MainActivity legt den Text ab, AppNav fuehrt -- erst nach dem
 * Login -- zu den Decks, DecksScreen nimmt ihn heraus und oeffnet die Import-Vorschau. Prozessweit, damit der Text
 * einen Login ueberlebt.
 */
object DeckImportInbox {
    private val pending = MutableStateFlow<String?>(null)
    val text: StateFlow<String?> = pending

    fun offer(text: String) { pending.value = text }

    /** Nimmt den Text heraus (danach null), damit er genau einmal eine Vorschau oeffnet. */
    fun take(): String? = pending.getAndUpdate { null }

    /**
     * Nur ACTION_SEND mit text/plain und nicht leerem EXTRA_TEXT; keine Dateien. Reine Funktion mit den Intent-Werten,
     * damit ohne Geraet testbar ("android.intent.action.SEND" = Intent.ACTION_SEND).
     */
    fun sharedText(action: String?, mimeType: String?, extraText: CharSequence?): String? {
        if (action != "android.intent.action.SEND") return null
        if (mimeType == null || !mimeType.startsWith("text/plain")) return null
        return extraText?.toString()?.takeIf { it.isNotBlank() }
    }
}
```

- [ ] **Step 4: Manifest**

In `android/app/src/main/AndroidManifest.xml` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```xml
            android:screenOrientation="portrait"
            android:windowSoftInputMode="adjustResize">
```
durch:
```xml
            android:screenOrientation="portrait"
            android:launchMode="singleTask"
            android:windowSoftInputMode="adjustResize">
```

Änderung 2/2 — ersetzen:
```xml
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
```
durch:
```xml
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <!-- Spec E2 §6: Share-Ziel fuer Decklisten (YDKE/Textliste) als Text, keine Dateien. singleTask, damit ein
                 Teilen die laufende App (onNewIntent) statt einer zweiten Instanz im Task der teilenden App erreicht. -->
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
```

- [ ] **Step 5: `MainActivity.kt`**

In `android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt` (3 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/3 — ersetzen:
```kotlin

import android.os.Bundle
```
durch:
```kotlin

import android.content.Intent
import android.os.Bundle
```

Änderung 2/3 — ersetzen:
```kotlin
import com.example.yugiohscanner.ui.AppNav
import com.example.yugiohscanner.ui.theme.AppTheme
```
durch:
```kotlin
import com.example.yugiohscanner.ui.AppNav
import com.example.yugiohscanner.ui.DeckImportInbox
import com.example.yugiohscanner.ui.theme.AppTheme
```

Änderung 3/3 — ersetzen:
```kotlin
        com.example.yugiohscanner.cloud.CatalogRepository.init(this)
        setContent { AppTheme { AppNav() } }
    }
```
durch:
```kotlin
        com.example.yugiohscanner.cloud.CatalogRepository.init(this)
        // Spec E2 §6: an die App geteilter Text -> Import-Vorschau (nicht erneut nach einer Wiederherstellung).
        if (savedInstanceState == null) offerSharedText(intent)
        setContent { AppTheme { AppNav() } }
    }

    // singleTask (Manifest): ein weiteres Teilen erreicht die laufende App hier.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        offerSharedText(intent)
    }

    private fun offerSharedText(intent: Intent?) {
        DeckImportInbox.sharedText(intent?.action, intent?.type, intent?.getCharSequenceExtra(Intent.EXTRA_TEXT))
            ?.let { DeckImportInbox.offer(it) }
    }
```

- [ ] **Step 6: `AppNav.kt`**

Der Effekt steht bewusst **nach** dem `return` des Lade-Tors (`StartupLoadingScreen`): er läuft erst, wenn angemeldet und geladen ist; ohne gespeicherte Zugangsdaten verhindert `cloudReady`, dass vor dem Login navigiert wird. Der Text bleibt so lange im Postfach.

In `android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```kotlin
    val showBar = route != Routes.SCAN && route != Routes.EINSORTIEREN
```
durch:
```kotlin
    val showBar = route != Routes.SCAN && route != Routes.EINSORTIEREN
    // Spec E2 §6: geteilter Text fuehrt zu den Decks -- erst hier, nach Login und Laden (der Text wartet im Postfach);
    // DecksScreen nimmt ihn heraus und oeffnet die Import-Vorschau.
    val sharedDeckText by DeckImportInbox.text.collectAsState()
    LaunchedEffect(sharedDeckText != null, cloudReady) {
        if (sharedDeckText != null && cloudReady) nav.navigateTop(Routes.sammlung("decks"))
    }
```

- [ ] **Step 7: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, 511 Tests, 0 Fehler (neu: `DeckImportInboxTest` 2).

- [ ] **Step 8: Schutz-Nachweis**

In `sharedText` die Zeile `        if (mimeType == null || !mimeType.startsWith("text/plain")) return null` kurz auskommentieren → `nur ACTION_SEND mit text-plain und Text wird angenommen` scheitert (`java.lang.AssertionError at DeckImportInboxTest.kt:14`, gemessen: `image/png` würde angenommen). Zitieren, zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/DeckImportInbox.kt android/app/src/test/java/com/example/yugiohscanner/DeckImportInboxTest.kt android/app/src/main/AndroidManifest.xml android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt
git commit -m "feat(e2): Handy als Share-Ziel für Decklisten, Text wartet bis nach dem Login

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: Handy-Oberfläche — Einfügen und Vorschau, Plus-Menü, Side-Deck, Teilen, Notizen

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/DeckImportScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt`

**Interfaces:**
- Produces: `@Composable DeckImportScreen(sharedText: String?, onBack: () -> Unit, onCreated: (Long) -> Unit)`; in `DecksScreen.kt` privat `ImportRequest(text: String?)`, `shareText(context, title, text)`; `DeckCardRow(card, numbers, onMove, mutate)`.
- Consumes (Task 5–7): `DeckImport.prepare/plan/…`, `DeckFormats.build*`, `DeckEntry`, `DecksRepository.createImportedDeck/moveOne`, `Deck.notes`, `CatalogRepository.importRows/isReady`, `DeckImportInbox`. Vorhanden: `SideStores.decks/allDeckCards`, `SectionHeader`, `SpaceCard`, Theme-Farben.

- [ ] **Step 1: `ui/DeckImportScreen.kt` anlegen**

Lesen, Katalog und Auflösung laufen im `LaunchedEffect(previewText)` auf `Dispatchers.IO`; `DeckImport.plan` nur in `remember(resolved, choices)`; Bilder für die Deckkarten werden erst im Klick auf „Anlegen" gelesen.

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.DecksRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.DeckImport
import com.example.yugiohscanner.ml.PreparedImport
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val IMPORT_SECTIONS = listOf("main" to "Main Deck", "extra" to "Extra Deck", "side" to "Side Deck")

/**
 * Spec E2 §5/§6: Import am Handy im Vollbild. [sharedText] (Share-Ziel) geht direkt in die Vorschau; sonst erst das
 * Textfeld, vorbefuellt mit der Zwischenablage. Lesen, Katalog und Aufloesung laufen abseits des Hauptthreads
 * (DeckImport.prepare); der Plan ist nach Aufloesung und Auswahl gemerkt. Legt immer ein neues Deck an.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeckImportScreen(sharedText: String?, onBack: () -> Unit, onCreated: (Long) -> Unit) {
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf(sharedText ?: clipboard.getText()?.text.orEmpty()) }
    var previewText by remember { mutableStateOf(sharedText) }
    var prepared by remember { mutableStateOf<PreparedImport?>(null) }
    var choices by remember { mutableStateOf(mapOf<Int, String>()) }
    var name by remember { mutableStateOf(DeckImport.DEFAULT_DECK_NAME) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(previewText) {
        val text = previewText ?: return@LaunchedEffect
        prepared = null
        choices = emptyMap()
        prepared = withContext(Dispatchers.IO) {
            // Namen nur waehrend des Imports im Speicher; ohne Katalog (z. B. direkt nach einem Katalog-Upgrade) null.
            DeckImport.prepare(text, null) { ids -> if (CatalogRepository.isReady()) CatalogRepository.importRows(ids) else null }
        }
    }
    val resolved = prepared?.resolved
    val plan = remember(resolved, choices) { resolved?.let { DeckImport.plan(it, choices) } }
    val openRows = remember(resolved) {
        resolved?.rows?.withIndex()?.filter { it.value.status == "suggest" || it.value.status == "ambiguous" } ?: emptyList()
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack, enabled = !busy) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface) }
                Spacer(Modifier.width(4.dp))
                Text(if (previewText == null) "Einfügen (YDKE/Text)" else "Import-Vorschau",
                    style = MaterialTheme.typography.headlineSmall, color = OnSurface)
            }
            Spacer(Modifier.height(12.dp))

            when {
                previewText == null -> {
                    OutlinedTextField(
                        value = input, onValueChange = { input = it }, minLines = 6,
                        placeholder = { Text("ydke://… oder eine Deckliste") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = { previewText = input }, enabled = input.isNotBlank()) { Text("Vorschau") }
                }
                prepared == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Primary)
                }
                prepared?.error != null -> Text(prepared?.error.orEmpty(), color = ErrorColor, style = MaterialTheme.typography.bodyMedium)
                resolved != null && plan != null -> LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        OutlinedTextField(value = name, onValueChange = { name = it }, singleLine = true,
                            label = { Text("Deckname") }, modifier = Modifier.fillMaxWidth())
                    }
                    if (resolved.catalogMissing) item { Text(DeckImport.CATALOG_MISSING, color = Gold, style = MaterialTheme.typography.bodySmall) }
                    item {
                        Text(DeckImport.countsText(plan.counts), color = OnSurface, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelLarge)
                        DeckImport.skippedText(plan.skipped.size)?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelMedium) }
                    }
                    items(openRows, key = { it.index }) { (i, row) ->
                        SpaceCard(Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(row.source, color = OnSurface, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                    if (row.candidates.none { it.passcode == choices[i] }) Text(DeckImport.OPEN, color = Gold, style = MaterialTheme.typography.labelSmall)
                                }
                                if (row.status == "ambiguous") Text(DeckImport.AMBIGUOUS, color = Muted, style = MaterialTheme.typography.labelSmall)
                                row.candidates.forEach { c ->
                                    FilterChip(
                                        selected = choices[i] == c.passcode,
                                        onClick = { choices = if (choices[i] == c.passcode) choices - i else choices + (i to c.passcode) },
                                        label = { Text(if (row.status == "suggest") DeckImport.suggestionText(c.name) else DeckImport.ambiguousOptionText(c)) },
                                    )
                                }
                            }
                        }
                    }
                    IMPORT_SECTIONS.forEach { (section, title) ->
                        val cards = plan.cards.filter { it.section == section }
                        if (cards.isNotEmpty()) {
                            item { SectionHeader(title) }
                            items(cards, key = { "$section-${it.cardId}" }) { c ->
                                Text("${c.count} ${c.name}", color = OnSurface, fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    if (plan.skippedLabels.isNotEmpty()) {
                        item { SectionHeader("Nicht übernommen") }
                        items(plan.skippedLabels) { Text(it, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.bodySmall) }
                    }
                    item {
                        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
                        Button(
                            enabled = !busy,
                            onClick = {
                                busy = true
                                error = null
                                scope.launch {
                                    try {
                                        val images = withContext(Dispatchers.IO) {
                                            CatalogRepository.importRows(plan.cards.map { it.cardId }).associate { it.id to it.image }
                                        }
                                        val id = DecksRepository.createImportedDeck(DeckImport.deckNameFor(name), plan.notes, plan.cards, images)
                                        SideStores.decks.refreshAndWait()
                                        SideStores.allDeckCards.refresh()
                                        onCreated(id)
                                    } catch (e: Exception) {
                                        error = DeckImport.failedText(e.message)
                                    }
                                    busy = false
                                }
                            },
                        ) { Text(if (busy) "Wird angelegt…" else "Anlegen", fontWeight = FontWeight.SemiBold) }
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 2: `DecksScreen.kt` anpassen**

Inhalt: Imports, Import-Zustand samt Postfach (vor dem Editor, damit ein geteilter Text auch aus einem offenen Editor die Vorschau öffnet), Plus-Menü, `extraOrMain`/`buildYdk` durch `ImportRequest`/`shareText` ersetzt, Ziel-Umschalter, Teilen-Menü, Notizen, Side-Abschnitt, Zeilenaktion.

In `android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt` (15 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/15 — ersetzen:
```kotlin
import com.example.yugiohscanner.ml.Coverage
import com.example.yugiohscanner.ml.CoverageCard
```
durch:
```kotlin
import com.example.yugiohscanner.ml.Coverage
import com.example.yugiohscanner.ml.DeckEntry
import com.example.yugiohscanner.ml.DeckFormats
import com.example.yugiohscanner.ml.DeckImport
import com.example.yugiohscanner.ml.CoverageCard
```

Änderung 2/15 — ersetzen:
```kotlin
    val decks = cache.value ?: emptyList()

    // The editor is a sub-view of this destination — system back closes it, not the destination.
    BackHandler(openDeckId != null) { openDeckId = null }
```
durch:
```kotlin
    val decks = cache.value ?: emptyList()
    // Spec E2 §5/§6: offener Import -- null = keiner; text null = Einfuegen (Zwischenablage), sonst geteilter Text.
    var importRequest by remember { mutableStateOf<ImportRequest?>(null) }
    val sharedText by DeckImportInbox.text.collectAsState()
    LaunchedEffect(sharedText) {
        if (sharedText != null) DeckImportInbox.take()?.let { importRequest = ImportRequest(it); openDeckId = null }
    }

    // The editor is a sub-view of this destination — system back closes it, not the destination.
    BackHandler(importRequest != null) { importRequest = null }
    importRequest?.let { request ->
        DeckImportScreen(
            sharedText = request.text,
            onBack = { importRequest = null },
            onCreated = { id -> importRequest = null; openDeckId = id },
        )
        return
    }
    BackHandler(openDeckId != null) { openDeckId = null }
```

Änderung 3/15 — ersetzen:
```kotlin
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
```
durch:
```kotlin
    var name by remember { mutableStateOf("") }
    var newMenuOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
```

Änderung 4/15 — ersetzen:
```kotlin
                Spacer(Modifier.width(8.dp))
                FilledIconButton(onClick = create) { Icon(Icons.Default.Add, "Anlegen") }
            }
```
durch:
```kotlin
                Spacer(Modifier.width(8.dp))
                // Spec E2 §5: Plus-Menue Leer · Einfügen (YDKE/Text).
                Box {
                    FilledIconButton(onClick = { newMenuOpen = true }) { Icon(Icons.Default.Add, "Neues Deck") }
                    DropdownMenu(expanded = newMenuOpen, onDismissRequest = { newMenuOpen = false }) {
                        DropdownMenuItem(text = { Text("Leer") }, onClick = { newMenuOpen = false; create() })
                        DropdownMenuItem(text = { Text("Einfügen (YDKE/Text)") }, onClick = { newMenuOpen = false; importRequest = ImportRequest(null) })
                    }
                }
            }
```

Änderung 5/15 — ersetzen:
```kotlin

// "extra" for Extra-Deck monster types, else "main".
private fun extraOrMain(type: String?): String {
    val t = type?.lowercase() ?: return "main"
    return if (listOf("fusion", "synchro", "xyz", "link").any { t.contains(it) }) "extra" else "main"
}

private fun buildYdk(cards: List<DeckCard>): String {
    fun section(name: String) = cards.filter { it.section == name }
        .flatMap { c -> List(c.count.coerceAtLeast(0)) { c.cardId } }
    val sb = StringBuilder()
    sb.append("#created by Card Scanner\n")
    sb.append("#main\n")
    section("main").forEach { sb.append(it).append("\n") }
    sb.append("#extra\n")
    section("extra").forEach { sb.append(it).append("\n") }
    sb.append("!side\n")
    return sb.toString()
}
```
durch:
```kotlin

/** Spec E2 §5/§6: offener Import; text null = Einfuegen (Zwischenablage), sonst geteilter Text direkt in die Vorschau. */
private data class ImportRequest(val text: String?)

/** Spec E2 §6: Deckliste als Text ueber den Android-Teilen-Dialog. */
private fun shareText(context: android.content.Context, title: String, text: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TITLE, title)
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(send, "Deck teilen"))
}
```

Änderung 6/15 — ersetzen:
```kotlin
    var query by remember { mutableStateOf("") }
    val results = remember { mutableStateListOf<CardRow>() }
```
durch:
```kotlin
    var query by remember { mutableStateOf("") }
    // Spec E2 §6: Ziel beim Hinzufuegen -- false = Deck (Main/Extra per deckSectionFor), true = Side.
    var addToSide by remember { mutableStateOf(false) }
    var shareMenuOpen by remember { mutableStateOf(false) }
    val results = remember { mutableStateListOf<CardRow>() }
```

Änderung 7/15 — ersetzen:
```kotlin
                )
                IconButton(onClick = {
                    val ydk = buildYdk(cards)
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TITLE, "${deck.name}.ydk")
                        putExtra(Intent.EXTRA_TEXT, ydk)
                    }
                    context.startActivity(Intent.createChooser(send, "Deck exportieren"))
                }) { Icon(Icons.Default.Share, "Exportieren", tint = Primary) }
            }
```
durch:
```kotlin
                )
                // Spec E2 §6: Teilen-Menue YDKE · Textliste · YDK (als Text; YDK jetzt mit Side-Deck).
                Box {
                    IconButton(onClick = { shareMenuOpen = true }) { Icon(Icons.Default.Share, "Teilen", tint = Primary) }
                    DropdownMenu(expanded = shareMenuOpen, onDismissRequest = { shareMenuOpen = false }) {
                        val entries = cards.map { DeckEntry(it.cardId, it.name, it.count, it.section) }
                        DropdownMenuItem(text = { Text("YDKE") }, onClick = { shareMenuOpen = false; shareText(context, deck.name, DeckFormats.buildYdke(entries)) })
                        DropdownMenuItem(text = { Text("Textliste") }, onClick = { shareMenuOpen = false; shareText(context, deck.name, DeckFormats.buildTextList(entries)) })
                        DropdownMenuItem(text = { Text("YDK") }, onClick = { shareMenuOpen = false; shareText(context, "${deck.name}.ydk", DeckFormats.buildYdk(entries)) })
                    }
                }
            }
```

Änderung 8/15 — ersetzen:
```kotlin
                },
            )

            Spacer(Modifier.height(12.dp))
```
durch:
```kotlin
                },
            )
            // Spec E2 §5: Notizen am Handy nur anzeigen, wenn vorhanden.
            deck.notes?.takeIf { it.isNotBlank() }?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
            }

            Spacer(Modifier.height(12.dp))
```

Änderung 9/15 — ersetzen:
```kotlin
                FilledIconButton(onClick = search) { Icon(Icons.Default.Search, "Suchen") }
            }
```
durch:
```kotlin
                FilledIconButton(onClick = search) { Icon(Icons.Default.Search, "Suchen") }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Ziel:", color = Muted, style = MaterialTheme.typography.labelMedium)
                FilterChip(selected = !addToSide, onClick = { addToSide = false }, label = { Text("Deck") })
                FilterChip(selected = addToSide, onClick = { addToSide = true }, label = { Text("Side") })
            }
```

Änderung 10/15 — ersetzen:
```kotlin
                                    deck.id, cardId = r.id, name = r.name,
                                    imageUrl = r.imageUrl, section = extraOrMain(r.type),
                                )
```
durch:
```kotlin
                                    deck.id, cardId = r.id, name = r.name,
                                    imageUrl = r.imageUrl, section = if (addToSide) "side" else DeckImport.deckSectionFor(r.type),
                                )
```

Änderung 11/15 — ersetzen:
```kotlin
                val extra = cards.filter { it.section == "extra" }
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
```
durch:
```kotlin
                val extra = cards.filter { it.section == "extra" }
                val side = cards.filter { it.section == "side" }
                // Spec E2 §6: eine Kopie verschieben; fuer "→ Deck" den Typ aus dem Katalog (ohne Katalog: Main).
                val move: (DeckCard) -> Unit = { card ->
                    mutate {
                        val type = if (card.section == "side") withContext(Dispatchers.IO) {
                            CatalogRepository.importRows(listOf(card.cardId)).firstOrNull()?.type
                        } else null
                        DecksRepository.moveOne(deck.id, card, cards, type)
                    }
                }
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
```

Änderung 12/15 — ersetzen:
```kotlin
                    }
                    items(main, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId)) { block -> mutate(block) } }
                    item {
```
durch:
```kotlin
                    }
                    items(main, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), move) { block -> mutate(block) } }
                    item {
```

Änderung 13/15 — ersetzen:
```kotlin
                    }
                    items(extra, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId)) { block -> mutate(block) } }
                }
```
durch:
```kotlin
                    }
                    items(extra, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), move) { block -> mutate(block) } }
                    item {
                        Spacer(Modifier.height(10.dp))
                        SectionHeader("Side · ${side.sumOf { it.count }}")
                        Spacer(Modifier.height(6.dp))
                    }
                    items(side, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), move) { block -> mutate(block) } }
                }
```

Änderung 14/15 — ersetzen:
```kotlin
@Composable
private fun DeckCardRow(card: DeckCard, numbers: CoverageCard?, mutate: ((suspend () -> Unit)) -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
```
durch:
```kotlin
@Composable
private fun DeckCardRow(card: DeckCard, numbers: CoverageCard?, onMove: (DeckCard) -> Unit, mutate: ((suspend () -> Unit)) -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
```

Änderung 15/15 — ersetzen:
```kotlin
                    Text(it, color = Gold, style = MaterialTheme.typography.labelSmall)
                }
```
durch:
```kotlin
                    Text(it, color = Gold, style = MaterialTheme.typography.labelSmall)
                }
                TextButton(onClick = { onMove(card) }, contentPadding = PaddingValues(0.dp)) {
                    Text(DeckImport.moveLabel(card.section), style = MaterialTheme.typography.labelSmall)
                }
```

- [ ] **Step 3: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, 511 Tests, 0 Fehler.
Per Grep (lesend): `Grep "DeckImport.prepare|DeckImport.plan" android/app/src/main/java/com/example/yugiohscanner/ui` → `prepare` nur im `withContext(Dispatchers.IO)` des `LaunchedEffect`, `plan` nur in `remember(resolved, choices)`. `Grep "extraOrMain|Card Scanner" android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt` → keine Treffer.

- [ ] **Step 4: Kein neuer Schutz-Test**

Oberfläche ohne automatische Tests (Plan-Ergänzung 22); die Regeln sind in Task 5–7 geschützt.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/DeckImportScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt
git commit -m "feat(e2): Handy importiert per Einfügen und Teilen mit Vorschau, teilt YDKE/Textliste/YDK, Side-Deck und Notizen im Editor

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Controller-Abschluss (kein Subagent)

- [ ] **Gesamtlauf:** Desktop SQLite-Suite (erwartet 243), `electron/test-sync.cjs` (alle PASS), Desktop-Helfer (180), Lint genau 5 Fehler, `npx vite build`, Android `testDebugUnitTest assembleDebug` (511/0). Die Zahlen kommen ins Ledger (Android aus `android/app/build/test-results/testDebugUnitTest/*.xml`).
- [ ] **Abschlussreview** mit dem besten Modell über den gesamten Zweig (`review-package`, Basis = Plan-Commit), danach eine Fix-Welle und ein scoped Re-Review. Besonders prüfen:
  - Die Zwillinge sind regelgleich: `[0-9]` statt `\d`, Unicode-Leerraum (JS `\s` ↔ Kotlin `(?U)`), Base64-Muster vor dem Dekodieren, genau drei YDKE-Blöcke, Normalisierungs-Reihenfolge (klein → NFKD → Marken → ß → Nicht-Alnum), Sortierung in Codeeinheiten, `skippedLabels`, `prepare` lädt den Katalog nie bei Lesefehler; beide Seiten lesen dieselben zwei Fixtures.
  - Rückbau: Desktop `createImportedDeck` und Handy `createWithRollback` löschen das Deck genau dann, wenn die Karten scheitern; `notes` nur mit Inhalt im Insert.
  - Kein Platzhalter sieht wie ein leeres Deck aus: Desktop-Dialog „…" bis zur Auflösung, Handy Ladekreis; Zähler erst mit Plan.
  - Aufrufer geteilter Funktionen unverändert (Plan-Ergänzung 21): `save-deck` ohne `notes`, `createDeck(name)`, `readCatalogPrices`, `get-deck-details` für besessene Karten.
  - Share: `singleTask`, `savedInstanceState`-Schutz, Effekt hinter dem Lade-Tor, `take()` genau einmal, nur `text/plain`.
  - Compose: `DeckImport.prepare` nie in der Komposition, `plan` nur in `remember`; Desktop löst genau einmal je Import auf und holt alle Namen nur für Textlisten.
  - Kein App-Code schreibt `cards.quantity`, `cards.deleted` oder `price_first_ed` (E2 berührt die lokale Sammlung nicht).
  - Jeder neue/umgebaute Kanal in `main.cjs` und `preload.cjs` (`ipc-channels.test.cjs`).
- [ ] **Übergabe an den Nutzer, in dieser Reihenfolge (Spec §8):**
  1. `supabase/decks_notes.sql` im Dashboard einspielen.
  2. Desktop-Installer bauen und installieren, **nicht** aus dem Worktree mit Junction-`node_modules` (nach dem Merge im Hauptcheckout bauen). Kein „Katalog jetzt bauen" nötig (Katalog ≥ 6 trägt Namen und Typ); fehlt die lokale Katalogdatei, zeigt die Vorschau „Katalog fehlt – Namen können nicht aufgelöst werden".
  3. APK installieren. `connectedDebugAndroidTest` nie auf dem Gerät ausführen.
  Keine Edge Function, kein Deploy, kein Katalog-Wechsel.
- [ ] **Abnahme** (Checkliste im Ledger, Spec §10):
  1. Desktop: Neues Deck → *YDK-Datei* mit Main/Extra/Side importieren → Vorschau zeigt Dateinamen als Decknamen und „Main n · Extra n · Side n"; nach „Anlegen" ist das Deck offen, Main/Extra/Side stimmen, Bilder erscheinen.
  2. Desktop: auf YGOPRODeck „YDKE kopieren", Neues Deck → *Einfügen (YDKE/Text)* → wie 1; ein kaputter Link zeigt „Kein gültiger YDKE-Link", nichts wird angelegt.
  3. Textliste mit einem Tippfehler (z. B. `Ash Blosom & Joyous Spring`) und einer Unsinnszeile einfügen → „Meintest du …?" als Auswahl; ohne Auswahl anlegen → Tippfehler- und Unsinnszeile stehen im Notizfeld unter „Nicht übernommen beim Import:"; Notiz am Desktop ändern, „Save Deck", neu laden → Änderung bleibt; am Handy erscheint die Notiz im Editor.
  4. Deck am Desktop über *Export → YDKE kopieren* in eine Notiz-App am Handy bringen, dort kopieren, am Handy Plus → *Einfügen (YDKE/Text)* (Zwischenablage vorbefüllt) → identisches Deck (gleiche Zahlen je Abschnitt).
  5. Am Handy YDKE oder Textliste aus einer anderen App an „Card Scanner" teilen → die Vorschau öffnet; einmal bei laufender App (onNewIntent) und einmal nach Abmelden (Text bleibt, Vorschau nach dem Login).
  6. Side-Deck: am Desktop eine Karte mit „→ Side" verschieben, speichern; am Handy eine Karte mit „→ Side" und eine mit „→ Deck" verschieben → *Export → YDK-Datei* (Desktop) bzw. *Teilen → YDK* (Handy) enthält unter `!side` die Karten.
- [ ] **Merge-Frage** an den Nutzer.

---

## Selbstprüfung

**Spec-Abdeckung:**

| Spec | Umsetzung |
|---|---|
| §1 Abgleich Spec ↔ Code (YDK-Import toter Code, Export, Abschnitte, Side fehlt am Handy, kein Resolver, kein YDKE, keine Share-Annahme, kein `notes`, Base64-Wege) | Task 3 (`readYdkFile`, Export repariert — Plan-Ergänzung 1, 12), Task 1/5 (Formate mit `atob`/`java.util.Base64`), Task 2/5 (Resolver), Task 4/8 (Side), Task 7 (Share), Task 1 (SQL) |
| §2 Umfang, nicht drin | Global Constraints E2-spezifisch; kein URL-Import, keine Online-Abfrage (`unknownPasscode` statt Nachladen), immer neues Deck, nur Text beim Teilen |
| §3 Formate (neutrales Ergebnis, Passcodes ohne Nullen, YDK lesen/schreiben, YDKE lesen/schreiben inkl. Fehler, Textliste alle Zeilenformen/Überschriften/Kommentare/`unknown`, Textliste schreiben, Erkennung, „Keine Deckliste erkannt") | Task 1 `deckFormats.js` + `formats.json` (19 Lesefälle, Erkennung, 3 Schreib-/Rückweg-Fälle), Task 5 `DeckFormats.kt`; Plan-Ergänzungen 5–7 |
| §4 Namensauflösung (Katalogquelle beidseitig, per Passcode DE/EN + „Unbekannter Passcode", exakt, normalisiert, Fuzzy mit Grenzen und max. 3 sortiert, „Nicht gefunden", Mehrdeutig, `deckSectionFor` auch für Editoren) | Task 2 `deckImport.js` + `import.json`, Task 5 `DeckImport.kt`, Task 3 `catalogCards` (Desktop-Index), Task 6 `importRows` (Handy), Task 4/8 Editoren nutzen `deckSectionFor`; Plan-Ergänzungen 2, 3, 8, 9 |
| §5 Import-Ablauf (immer neues Deck; Desktop-Menü Leer/YDK/Einfügen; Handy Plus-Menü + Share; Vorschau mit Name, Zählern, „n nicht übernommen", Liste je Abschnitt, Auswahl, Block „Nicht übernommen"; Anlegen in einem Zug mit Name/Bild, Rückbau, „Import fehlgeschlagen: …"; `decks.notes`, Desktop bearbeitbar, Handy Anzeige) | Task 2/5 `importPlan`/`plan`, `countsText`, `skippedText`, `failedText`, `deckNameFor`, `prepareImport`/`prepare`; Task 3 `createImportedDeck` (Attrappe, Rückbau), `save-deck` mit `notes`; Task 6 `createWithRollback`; Task 4 `DeckNewMenu`/`DeckImportDialog`/Notizfeld; Task 8 `DeckImportScreen`/Plus-Menü/Notizen; Task 1 SQL; Plan-Ergänzungen 10–13, 16, 20 |
| §6 Export, Teilen, Side (Desktop-Export-Menü mit Bestätigungen; Handy-Teilen YDKE/Text/YDK mit Side; Share-Empfang `SEND`+`text/plain`, Start und `onNewIntent`, unerkannt → Meldung, ohne Anmeldung erhalten; Side Desktop Umschalter + Zeilenaktion; Side Handy Abschnitt + Umschalter + Zeilenaktion) | Task 4 `DeckExportMenu`, Ziel-Umschalter, `moveOne`; Task 3 `get-deck-details`-Typ-Rückfall; Task 7 Manifest/`MainActivity`/`AppNav`/`DeckImportInbox`; Task 8 Teilen-Menü, Side-Abschnitt, FilterChips, `moveOne`; Task 2/5 `moveTarget`/`moveLabel`; Plan-Ergänzungen 14, 15, 17–19 |
| §7 Fehlerfälle (ungültiger YDKE, leer/unerkannt, Katalog fehlt mit Passcode-/Textfolgen und Anlegen möglich, halbes Anlegen, überlange Listen ohne Grenze, Share ohne Anmeldung) | Fixtures `formats.json` (ungültig, leer) und `import.json` („Katalog fehlt" beide Wege); `decks.test.cjs`/`DecksRepositoryTest` Rückbau; keine Obergrenze im Plan (Zähler zeigen die echte Zahl); Task 7 Postfach + Tor; Plan-Ergänzungen 3, 11, 18 |
| §8 Einspiel-Reihenfolge SQL → Installer → APK, kein Katalog-Wechsel | Task 9 Übergabe |
| §9 Tests (Formate und Auflösung je JS + Kotlin mit Fixtures inkl. aller Grenzfälle; Desktop YDK über gemeinsamen Parser mit Antwortform, Anlegen mit Rückbau per Attrappe, Kanäle in beiden Dateien, Katalog-Index-Leser; Handy Share-Intent und Vorschau-Zustand ohne Gerät, Repository-Anlegen mit Rückbau, `buildYdk` mit Side; Schutz-Tests scheitern ohne Schutz) | Task 1/2/5 (Fixtures, `prepareImport`/`prepare` = Vorschau-Zustand), Task 3 (`readYdkFile`-Antwortform, `createImportedDeck`, `ipc-channels`, `catalogCards`), Task 5 `build`-Fälle mit Side (= `buildYdk` am Handy), Task 6 (`createWithRollback`, `importCardsJson`), Task 7 (`DeckImportInboxTest`); gemessene Schutz-Nachweise in Task 1, 2, 3, 5, 6, 7 |
| §10 Abnahme 1–6 | Task 9 Abnahme |

**Platzhalter-Suche:** Kein „TBD", kein „wie in Task N". Jeder Code-Schritt enthält den vollständigen Code bzw. exakte, im Zielstand eindeutige Ersetzungsblöcke; beides stammt unverändert aus der vorab geprüften Scratch-Kopie.

**Namens- und Typkonsistenz:**
- SQL: `decks.notes`; Texte „Nicht übernommen beim Import:" (`NOTES_HEAD`), „Import fehlgeschlagen: …" (`failedText`), „Katalog fehlt – Namen können nicht aufgelöst werden" (`CATALOG_MISSING`), „Kein gültiger YDKE-Link" (`YDKE_INVALID`), „Keine Deckliste erkannt" (`NOTHING_RECOGNIZED`), „Unbekannter Passcode …", „Nicht gefunden", „Meintest du …?", „Importiertes Deck", „Main n · Extra n · Side n", „n nicht übernommen", „→ Side"/„→ Deck" — jeweils gleichnamig in JS und Kotlin, Werte aus den Fixtures. Desktop-only: „YDKE-Link kopiert", „Textliste kopiert" (`DeckExportMenu`), „Ziel:" + „Deck"/„Side" beidseitig in der Oberfläche.
- JS ↔ Kotlin: `parseDeckText`/`detectFormat`/`parseYdk`/`parseYdke`/`parseTextList`/`buildYdk`/`buildYdke`/`buildTextList`/`normalizePasscode` gleichnamig; `resolveImport` ↔ `DeckImport.resolve`, `importPlan` ↔ `DeckImport.plan`, `prepareImport` ↔ `DeckImport.prepare`, übrige Helfer gleichnamig; `decks.cjs#createImportedDeck` ↔ `DecksRepository.createWithRollback`.
- Ergebnisfelder: JS `{ passcode, count, section }` / `{ name, count, section, line }` ↔ `ParsedCard(passcode, name, count, section, line)`; Zeilen `{ status, count, section, source, candidates[{ passcode, name, type }] }` ↔ `ImportRow`/`ImportCandidate`; Plan `{ cards[{ card_id, name, count, section }], counts, skipped, skippedLabels, notes }` ↔ `ImportPlan(cards[ImportCard(cardId, …)], counts, skipped, skippedLabels, notes)`; Katalogzeile JS `{ id, name_de, name_en, type, image? }` ↔ `CatalogNameRow(id, nameDe, nameEn, type, image)`.
- IPC: `get-catalog-cards`/`getCatalogCards`, `create-imported-deck`/`createImportedDeck`, `import-deck-ydk`/`importDeckYdk`, `export-deck-ydk`/`exportDeckYdk`, `save-deck`/`saveDeck(deckId, cards, notes)`.
- Fixture-Schlüssel: `parse`, `detect`, `build` (formats); `catalog`, `normalize`, `levenshtein`, `sectionFor`, `moveTarget`, `resolve`, `texts` (import) gleich in allen Lesern.
