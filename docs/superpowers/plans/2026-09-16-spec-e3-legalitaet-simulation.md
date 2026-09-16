# Spec E3 Legalität & Simulation — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decks bekommen ein Format (TCG/OCG/Frei) und eine Legalitätsprüfung mit Badge, Verstoß-Liste und Banlist-Icons auf beiden Geräten; Banlist (`ban_tcg`/`ban_ocg`) und Artwork-Zuordnung (`card_images[].id` → Haupt-Passcode) kommen aus dem Offline-Katalog. Legalität, Kopien-Grenze und Ban-Lookup zählen über den Haupt-Passcode, der E2-Import löst Artwork-Passcodes auf (die Deckkarte behält den Artwork-Passcode). Hinzufügen/„+" blockiert die 4. Kopie (nicht im Format Frei), das Handy erhöht beim Hinzufügen die bestehende Zeile. Der Desktop markiert Starter (`deck_cards.role`) und zeigt in einer Seitenleiste Statistik, exakte Starthand-Wahrscheinlichkeiten mit Testhand und die Verstöße samt „Banlist-Stand".

**Architecture:** Die Regeln wohnen in reinen Zwillingen gegen gemeinsame Fixtures: `canonicalPasscode` und die Import-Auflösung über die Zuordnung in `deckImport.js` ↔ `DeckImport.kt` (`import.json`), Format/Regeln/Badge/Banlist-Stufe/Banlist-Stand/`canAddCopy` in `deckLegality.js` ↔ `DeckLegality.kt` (`legality.json`). `deckOdds.js` (hypergeometrisch über Bruch-Produkte, Testhand mit austauschbarer Zufallsquelle) gibt es nur am Desktop. Der Katalog-Bau schreibt `ban_tcg`, `ban_ocg` je Karte und `aliases` auf oberster Ebene; der Desktop liest sie über den vorhandenen Katalog-Index (`catalog-prices.cjs`, neuer Kanal `get-catalog-legality`), das Handy speichert sie in `CatalogDb` v4 (`card_aliases`, Ban-Spalten, `meta.built_at`/`meta.legality`). „Save Deck" wandert als testbarer Helfer nach `decks.cjs#saveDeck` und trägt `role` und `format`. Neue Spalten per SQL-Datei `supabase/decks_format_role.sql` (spielt der Nutzer ein).

**Tech Stack:** Electron CJS + better-sqlite3, React/Vite + recharts + lucide-react, Postgres (nur SQL-Datei), Kotlin/Compose (Material3), org.json, node:test, JUnit4, kotlinx-coroutines-test.

**Spec:** `docs/superpowers/specs/2026-09-16-spec-e-nachtrag-e3-legalitaet-simulation.md` (vom Nutzer Abschnitt für Abschnitt abgesegnet). Sie ändert `docs/superpowers/specs/2026-09-05-spec-e-deckbuilder-pro-design.md` §5.1 (`format`), §5.2 (`role`, Ban-Felder), §5.4, §5.5, §7.1/§7.2, §10–§12 und setzt E1 (`bcc579d`) und E2 (`392d123`) voraus. Plan-Basis `05dfba2`.

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus und verbinden sich nie mit Supabase. Das gilt auch für Edge-Function-Aufrufe und Deploys. SQL spielt der Nutzer von Hand im Dashboard ein; der Plan liefert nur die SQL-Datei.
- Immer explizite Pfade stagen, nie `git add -A` und nie `git stash`. Der Stash-Stack ist mit den Worktrees geteilt.
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI). `desktop/node_modules` ist im Worktree eine Junction.
- `cards.quantity` und `cards.deleted` pflegen Trigger; die App schreibt sie nie. Es gibt nur Soft-Delete. (Seit G4 gilt dasselbe für `cards.price_first_ed`.)
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs`.
- Sichtbare Texte sind deutsch mit echten Umlauten, „Fächer" statt „Taschen".
- Regeln wohnen in reinen, getesteten Helfern. Absichtliche Zwillinge werden im Kopfkommentar markiert, der den anderen Zwilling nennt, und auf beiden Seiten gegen gemeinsame Fixtures getestet.
- Kotlin-Rundung von Geld und Zahlen mit `java.lang.Math.round` (nie `kotlin.math.round`, Banker's Rounding). E3 rundet nur in `deckOdds.js` (Desktop, kein Zwilling); die Regel gilt für jede Erweiterung.
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`). Ein sechster ist ein Fehlschlag.
- Deutsche Set-Codes werden nie aus englischen abgeleitet.
- Ein Test, der gegen einen Fehler schützt, muss nachweislich ohne den Schutz scheitern. Dazu den Schutz kurz sabotieren, den Fehlschlag im Bericht zitieren und die Sabotage zurücknehmen.
- Ein Platzhalter darf nie wie eine leere Sammlung aussehen: solange Daten fehlen, steht „…" bzw. ein Ladekreis, nie „Main 0 · Extra 0 · Side 0" vor der Auflösung. (E3: nie ein vorläufiges „Legal" oder „Banlist unbekannt", solange der Katalog-Index lädt.)
- Teure Berechnungen laufen in Compose nie unmemoisiert in der Komposition (`remember` mit Schlüsseln; Lesen/Auflösen im `LaunchedEffect`/`produceState` abseits des Hauptthreads).
- Ein Schutz, der in eine geteilte Funktion wandert, darf das Verhalten der anderen Aufrufer nicht ändern — alle Aufrufer prüfen (Lehre aus E1 F3).
- Regex-Zwillinge: Ziffern als `[0-9]` (nie `\d`), Unicode-Leerraum JS `\s` ↔ Kotlin `(?U)`.
- Handy-Mutationen laufen durch das `InFlight`-Gatter und rechnen mit dem frischen Stand (Cache innerhalb von `mutate` lesen), nie mit dem Kompositions-Schnappschuss (Lehre E2 Task 6/8).
- Legalität, Kopien-Grenze und Ban-Lookup zählen immer über den Haupt-Passcode (`canonicalPasscode`).
- Deckkarten behalten importierte Artwork-Passcodes; nur Name, Typ und Bild kommen von der Hauptkarte.
- Die Banlist blockiert nie das Hinzufügen; blockiert wird nur die 4. Kopie (TCG/OCG).
- Desktop „Save Deck" löscht und fügt alle Deckkarten neu ein (`buildSaveDeckCards` → `decks.cjs#saveDeck`): es MUSS `role` und `format` mitnehmen; jede neue Spalte von `deck_cards` muss dort getragen werden.
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- E3-spezifisch nicht drin (Spec §2): GOAT/Genesys/sonstige Formate, OCG-Deckregeln außer der Banlist, Aufräumen bestehender Doppelzeilen am Handy, Simulation am Handy, Klick auf Verstoß markiert Zeile, Desktop-`cards`-Ban-Spalten, 1000-Hände-Simulation. Keine Edge Function, kein Deploy.

**Befehle (aus der Worktree-Wurzel, sofern nicht anders angegeben):**
- Desktop SQLite-Suite (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Desktop Sync-Skript (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
- Desktop-Helfer (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs`
- Desktop-Lint (in `desktop/`): `npx eslint .` → genau `5 errors`. Gelintet werden nur `*.js`/`*.jsx`, nicht `*.cjs`/`*.mjs`.
- Desktop-Build (in `desktop/`): `npx vite build`
- Android: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`

Ausgangszahlen auf `05dfba2` (gemessen): SQLite-Suite 243, `test-sync.cjs` alle PASS, Helfer 185, Lint 5 Fehler/3 Warnungen, Android 515 Tests/0 Fehler.

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `supabase/decks_format_role.sql` (neu) | `decks.format` mit Default und Check, `deck_cards.role` mit Check | 1 |
| `desktop/electron/catalog-build.cjs` + `.test.cjs` | `banOf`, `ban_tcg`/`ban_ocg` je Karte, `buildAliases`, `packCatalog(…, aliases)` | 1 |
| `desktop/electron/catalog-builder.cjs` | Bau schreibt `aliases` | 1 |
| `desktop/electron/catalog-prices.cjs` + `.test.cjs` | Index mit Ban/Zuordnung/`builtAt`; `catalogCards` über Zuordnung; `catalogMainId`; `catalogLegality` | 1 |
| `desktop/src/utils/deckImport.js` + `.test.js`, `docs/fixtures/decks/import.json` | `canonicalPasscode`, Auflösung über `aliases` | 2 |
| `desktop/src/utils/deckLegality.js` + `.test.js` (neu), `docs/fixtures/decks/legality.json` (neu) | Formate, Regeln 1–6, Warnungen, Badge, `banOf`, Banlist-Stand, `canAddCopy` | 3 |
| `desktop/src/utils/deckOdds.js` + `.test.js` (neu) | `handOdds`, `percentText`, `oddsTexts`, `drawHand` | 4 |
| `desktop/electron/decks.cjs` + `.test.cjs` | `saveDeckRows`, `saveDeck` (role, Rückfall ohne role, format) | 5 |
| `desktop/electron/main.cjs`, `preload.cjs`, `ipc-channels.test.cjs` | `save-deck` über `saveDeck`, `get-deck-details` mit `role`, Bild/Typ über Hauptkarte, `get-catalog-legality` | 5 |
| `desktop/src/utils/saveDeckPayload.js` + `.test.js` | `role` im Save-Payload | 5 |
| `desktop/src/components/DeckBuilder.jsx`, `DeckSidebar.jsx` (neu), `DeckLegalityBadge.jsx` (neu), `DeckBanIcon.jsx` (neu) | Format-Auswahl, Badge, Icons, Stern, Seitenleiste, Kopien-Grenze | 6 |
| `android/.../ml/DeckImport.kt`, `DeckLegality.kt` (neu) + `DeckImportTest.kt`, `DeckLegalityTest.kt` (neu) | Kotlin-Zwillinge | 7 |
| `android/.../cloud/CatalogDb.kt`, `CatalogParser.kt`, `CatalogRepository.kt` + `CatalogParserTest.kt`, `CatalogSealedTest.kt` | Katalog v4, Parser, `aliases`/`legalityCatalog`/`builtAt` | 8 |
| `android/.../cloud/DecksRepository.kt` + `DecksRepositoryTest.kt` | `Deck.format`, `setFormat`, `AddCopyPlan`, `addCopy`, `incrementCopy` | 9 |
| `android/.../ui/DecksScreen.kt`, `ui/DeckImportScreen.kt` | Format, Badge, Aufklapper, Icons, Grenze, frischer Stand; Import über Zuordnung | 10 |

`android/...` steht für `android/app/src/main/java/com/example/yugiohscanner` (Paket `com.example.yugiohscanner`). Die Tests liegen unter `android/app/src/test/java/com/example/yugiohscanner/` und lesen Fixtures über `Fixtures.text("docs/fixtures/...")`; `DeckFixtureWorld.Companion.objects` (E1) wird wiederverwendet. Die Android-Unit-Tests laufen auf der JVM ohne Robolectric.

Jede Datei wird in genau einem Task geändert. Reihenfolge: 1 → 2 → 3 → 4 → 5 → 6 (Desktop), 7 → 8 → 9 → 10 (Handy). Task 3 braucht Task 2 (`canonicalPasscode`, `deckSectionFor`); Task 5 braucht Task 1; Task 6 braucht 3, 4, 5; Task 7 braucht die Fixtures aus 2 und 3; 8 braucht 7; 9 braucht 7; 10 braucht 8 und 9. Jeder Task baut und testet für sich grün. Tasks strikt nacheinander im selben Worktree.

**Vorab geprüft (Plan-Autor, Scratch-Kopie von `05dfba2` außerhalb des Repos per `git archive`, `desktop/node_modules` als Junction, ohne `local.properties`):** Aller Code dieses Plans stand dort genau so; die Änderungsblöcke unten sind maschinell aus dieser Kopie gegen `05dfba2` erzeugt, beim Erzeugen nacheinander angewendet und mit dem Endstand verglichen (jeder alte Block kommt an seiner Stelle genau einmal vor). Ergebnisse am Endstand: SQLite-Suite 259/259, `test-sync.cjs` 16× PASS (exit 0), Helfer 241/241, `npx eslint .` 5 Fehler/3 Warnungen, `vite build` ok, Android `testDebugUnitTest assembleDebug` BUILD SUCCESSFUL mit 527 Tests/0 Fehlern (mit `--rerun-tasks`), zusätzlich `compileDebugAndroidTestKotlin` ok. Alle Schutz-Nachweise unten sind gemessen (Sabotage automatisch angewendet, Fehlschlag zitiert, zurückgenommen). Echte Daten: YGOPRODeck-Dump aus einer Kopie des lokalen `api_cache` (kein Netz): 14 565 Karten, 164 Artwork-IDs (Dunkler Magier: 8), keine Kollision mit Haupt-IDs, `banlist_info` bei 315 Karten mit den Werten `Forbidden`/`Limited`/`Semi-Limited`; `card_images[]` = `{ id (Zahl), image_url, image_url_small, image_url_cropped }`, `card_images[0].id` ist immer die Haupt-ID. Daraus gebauter Katalog: 2,21 MB gz, Legalitäts-Index 1,41 MB JSON, erster Aufbau 84 ms.

## Plan-Ergänzungen (vom Plan entschieden, bitte dem Nutzer vorlegen)

1. **Banlist-Werte (Spec §3 korrigiert):** YGOPRODeck schreibt `Forbidden`, nicht `Banned` (gemessen im Dump: TCG 117 × `Forbidden`, 95 × `Limited`, 10 × `Semi-Limited`; OCG 91/90/12; nie `Banned`). `banOf` versteht beide als `forbidden`; `Limited` → `limited`, `Semi-Limited` → `semi`; fehlend oder unbekannt → `null`. `ban_goat` wird ignoriert.
2. **Artwork-Zuordnung, Einzelheiten:** nur für Karten, die im Katalog stehen (mit Bild), nie die Haupt-ID selbst und nie eine ID, die selbst Haupt-ID einer Katalogkarte ist; Passcodes als Strings ohne führende Nullen. Der Desktop-Leser übernimmt nur Zuordnungen auf vorhandene Katalogkarten, der Handy-Parser ebenso.
3. **„Katalog ohne Ban- und Artwork-Felder" (Spec §8) = fehlender Schlüssel `aliases`.** `packCatalog` schreibt ihn ab E3 immer (auch `{}`). Desktop: `catalogLegality` liefert dann `available: false`; Handy: `meta.legality = "0"` → `legalityCatalog` = `null`. Beides zeigt „Katalog fehlt – Banlist unbekannt", keine Icons, Artworks zählen einzeln. Import und Preise lesen den alten Katalog weiter. Einen „Banlist-Stand" gibt es nur mit E3-Katalog.
4. **Desktop-Legalitätsdaten:** neuer Kanal `get-catalog-legality` liefert beim Öffnen des Deck-Builders einmal den ganzen Index `{ available, builtAt, aliases, cards: { [Haupt-Passcode]: { name, type, ban_tcg, ban_ocg } } }` (gemessen 1,41 MB, im Hauptprozess je Katalogdatei einmal gebaut). Grund: Regel 4 braucht den Typ jeder Karte, und der Editor fügt beliebige Karten hinzu — ein Nachladen je Karte würde kurz „Banlist unbekannt" zeigen. Der Renderer rechnet Deck-Liste (gespeicherter Stand, gespeichertes Format) und Editor (ungespeicherter Stand, gewähltes Format) selbst; solange der Index lädt, zeigt der Badge „…".
5. **Handy-Legalitätsdaten:** `CatalogRepository.legalityCatalog(ids)` liest nur die Zuordnung der Deckkarten-Passcodes und deren Hauptkarten (Blöcke zu 500) plus `meta.built_at`; in Compose über `rememberLegalityCatalog(ids)` (`produceState`, `Dispatchers.IO`). Das Ergebnis ist an die ids gebunden — nach einem Hinzufügen gilt es bis zum Nachladen als „…", nie als „Banlist unbekannt".
6. **`canonicalPasscode` wohnt in `deckImport.js`/`DeckImport.kt`,** `deckLegality` importiert es (umgekehrt entstünde ein Zirkelimport, weil die Legalität `deckSectionFor` braucht). Regel `aliases[p] ?? p`, nur eigene Schlüssel.
7. **E2-Import über die Zuordnung:** `resolveImport(parsed, catalogCards, aliases = null)` ↔ `DeckImport.resolve(parsed, catalog, aliases = null)`; der Kandidat trägt den importierten Artwork-Passcode, Name und Typ kommen von der Hauptkarte. Lader: Desktop `get-catalog-cards(ids)` liefert Hauptkarten plus `aliases` in einer Antwort (die Antwort hat jetzt immer `aliases`, auch `{}` — einziger Aufrufer `DeckImportDialog` über `prepareImport`); Handy `DeckImport.prepare(text, format, loadAliases = { emptyMap() }, loadCatalog)` lädt erst die Zuordnung, dann die Hauptkarten. `loadAliases` steht **vor** `loadCatalog`, damit der bestehende Aufruf `prepare(text, null) { ids -> … }` in `DeckImportScreen` bis Task 10 unverändert kompiliert (in Task 7 nur die Testaufrufe mit Positionsargument auf `loadCatalog = load` umgestellt). Bilder beim Anlegen und der Typ-Rückfall in `get-deck-details` laufen über die Hauptkarte; der Handy-Typ für „→ Deck" ebenso.
8. **Legalitätsergebnis, Einzelheiten:** `violations: [{ rule, cardId, text }]` mit `cardId` = Haupt-Passcode (Regeln 4–6) bzw. `null` (1–3), `warnings: [{ cardId, text }]` (`cardId` `null` bei „Katalog fehlt"); Kotlin `LegalityIssue(rule: Int?, cardId, text)`. Gezählt werden nur Zeilen mit Anzahl > 0. Regel 4 prüft je Haupt-Passcode einmal je Richtung (steht er im Main und ist Extra-Typ bzw. im Extra und Main-Typ), nicht je Zeile; Side nie. Ein leerer Name zählt als fehlend. Unbekanntes Format (`null`, `"goat"`) = TCG. Die Fixture prüft jede Grenze aus Spec §10 mit Handrechnung (40-/60-Karten-Basen aus 1000xxxx-Füllern).
9. **Anzeige-Helfer als Zwilling:** `badgeKind` (`legal`/`warn`/`crit`/`free`) für die Farbe, `violationCountText` („0 Verstöße"/„1 Verstoß"/„3 Verstöße") für den Handy-Aufklapper (nicht im Format Frei), `banlistDateText(builtAt)` = UTC-Datum aus `built_at` → „Banlist-Stand: 16.09.2026", sonst `null`. Neuer Text nur am Desktop: „Keine Verstöße" im Reiter „Verstöße", wenn es weder Verstöße noch Warnungen gibt.
10. **Kopien-Grenze, Einzelheiten:** Desktop `addToDeck` ersetzt die bisherige Grenze „3 je Ziel-Liste" durch `canAddCopy` über alle Abschnitte (im Format Frei also gar keine Grenze mehr); die Meldung „Höchstens 3 Kopien je Karte" steht neben „Ziel:" bis zum nächsten erfolgreichen Hinzufügen, Formatwechsel oder Deckwechsel. Handy: auch der „+"-Knopf einer Zeile ist Hinzufügen und läuft durch dieselbe Grenze (`incrementCopy`); die Meldung erscheint in der vorhandenen Fehlerzeile. Verschieben wird nie blockiert.
11. **Handy rechnet mit dem frischen Stand:** Hinzufügen, „+" und Verschieben lesen innerhalb von `mutate` den Cache (`deckCache.state.value.value`) und die Zuordnung (`CatalogRepository.aliases`) — nicht den Kompositions-Schnappschuss. Das `InFlight`-Gatter gibt erst nach `refreshAndWait` frei, der Cache ist dann aktuell. „Hinzufügen" erhöht die **erste** Zeile desselben Passcodes im Zielabschnitt (`AddCopyPlan.Increment`), sonst neue Zeile; rein getestet.
12. **Save Deck wandert nach `decks.cjs#saveDeck`** (Attrappen-Tests statt ungetestetem Handler). `role` steht nur an Starter-Zeilen des Main Decks — supabase-js nennt im Insert nur Spalten, die in einer Zeile vorkommen (geprüft in `@supabase/postgrest-js`), also speichern Decks ohne Stern auch vor dem SQL. Scheitert der Insert mit Sternen (Spalte `role` fehlt), fügt `saveDeck` dieselben Zeilen ohne `role` ein — sonst wären nach dem Löschen alle Deckkarten weg; `roleSaved: false`, keine eigene Meldung (Spec §8). `format` nur bei Änderung, Fehler → „Format konnte nicht gespeichert werden" (Karten und Notizen sind dann schon gespeichert). `buildSaveDeckCards` schickt `role` (Main: Stern oder `null`, Extra/Side immer `null`).
13. **Geteilte Funktionen, Aufrufer geprüft:** `save-deck` nur `DeckBuilder.handleSaveDeck` (ohne `format` verhält es sich wie bisher); `buildSaveDeckCards` nur `handleSaveDeck` (neues Feld `role`); `get-deck-details` nur `handleLoadDeck` (neues Feld `role`, Typ-Rückfall für Artwork-Passcodes über die Hauptkarte, besessene Karten unverändert); `catalogCards` nur `get-catalog-cards` (zusätzliches `aliases`, Karten unverändert); `readCatalogPrices`/`readCatalogCards`/`catalogPrices` unverändert (bestehende Tests grün); `DeckImport.resolve`/`prepare` nur `DeckImportScreen` und Tests (neue Parameter mit Vorgabe); `CatalogDb.VERSION` zusätzlich in `CatalogSealedTest` geprüft (auf 4 angehoben); `Deck(...)` bekommt `format` mit Vorgabe am Ende (bestehende Konstruktoraufrufe unverändert).
14. **Desktop-Oberfläche:** Seitenleiste als dritte Spalte (`w-80`) neben dem Editor, nur bei offenem Deck, Reiter „Statistik" · „Simulation" · „Verstöße"; der Statistik-Umschalter und der Knopf „Test Hand" im Kopf entfallen, `DeckStats` zieht unverändert (einspaltig) in `DeckSidebar.jsx`. Kopf: Name, Format-Auswahl (`CustomSelect` „TCG/OCG/Frei"), Badge. Deck-Liste: Format-Chip und Badge neben dem Namen. Kartenzeile: Banlist-Icon hinter dem Namen, an Main-Zeilen ein Stern-Knopf (stoppt die Weitergabe, ein Klick auf die Zeile entfernt weiter eine Kopie). Eine verschobene Kopie nimmt den Stern nicht mit. Testhand: Knöpfe „Testhand ziehen (5)" und „Testhand ziehen (6)", Starter mit gelbem Rahmen, bei weniger Karten so viele wie da; die alte Meldung „Main deck must have at least 5 cards." entfällt.
15. **Starthand-Werte (Spec §6/§10/§11 präzisiert):** exakt ist 40 Karten / 9 Starter / 5 Karten = **74,2 %** (C(31,5)/C(40,5) = 169911/658008 → 0: 25,8 % · 1: 43,0 % · 2+: 31,1 %; 6 Karten 80,8 %, 0: 19,2 % · 1: 39,8 % · 2+: 41,0 %). Die Werte 72,4 %/27,6 %/44,1 %/28,3 % in Spec §6 und „≈ 0,72"/„≈ 72 %" (Spec E §11, E3 §10, §11.5) sind gerundete Beispielwerte; der Test sichert den exakten Wert (dazu ein Abgleich gegen BigInt-Binomialkoeffizienten für N 1–20), die Abnahme erwartet 74,2 %. Prozent mit einer Nachkommastelle über `Math.round(p * 1000)`, Komma, „ %". Reihenfolge der Hinweise: ohne Main-Deck-Karten „Keine Main-Deck-Karten", sonst ohne Starter „Markiere Starthand-Ziele mit dem Stern".
16. **Abgleich (E1) bleibt unverändert:** `deckCoverage` zählt Exemplare je gespeichertem Passcode. Physische Alt-Art-Karten tragen den Haupt-Passcode; eine per YDK importierte Artwork-Deckkarte (z. B. `46986415`) findet also keine Exemplare und zeigt „fehlt". Spec E3 §2 nennt den Abgleich nicht; eine Änderung würde E1-Zwilling und `coverage.json` beidseitig berühren. Als Folgeaufgabe nennen.
17. **Handy `CatalogDb` v4:** Schema als `CREATE_STATEMENTS`/`DROP_STATEMENTS` (JVM-Test: jede angelegte Tabelle wird beim Upgrade verworfen), `meta` bekommt `built_at` und `legality`. Das Upgrade setzt die Version auf 0 → `CatalogSync` lädt beim nächsten Start ohne Tagessperre neu (Spec §9: „Jetzt prüfen"); bis dahin „Katalog fehlt". `CatalogDbTest` (androidTest) bleibt unverändert und kompiliert (nie auf dem Gerät ausführen).
18. **Handy-Format:** „Format: TCG ▾" im Editor-Kopf (DropdownMenu), speichert sofort per PATCH (`setFormat`), danach `SideStores.decks.refreshAndWait()` — der Editor liest das Deck aus dem Speicher, Badge und Liste folgen sofort. Gleiche Auswahl wird nicht gesendet. Kein InFlight (idempotent).
19. **Nicht automatisch getestet:** Desktop-Oberfläche (Seitenleiste, Badge, Icons, Stern, Formatwahl, Meldung), Handy-Screens, SQL-Ausführung, echte Cloud-Aufrufe (`setFormat`, `addCopy`, `incrementCopy`, `saveDeck` gegen Supabase), `CatalogDb` auf dem Gerät. Das prüft die Abnahme (Spec §11). Der UI-Code ist vorab kompiliert (Vite-Build, Lint, Gradle `assembleDebug`).

---
### Task 1: SQL-Datei, Katalog-Bau mit Banlist und Artwork-Zuordnung, Katalog-Index

**Files:**
- Create: `supabase/decks_format_role.sql`
- Modify: `desktop/electron/catalog-build.cjs`
- Modify: `desktop/electron/catalog-build.test.cjs`
- Modify: `desktop/electron/catalog-builder.cjs`
- Modify: `desktop/electron/catalog-prices.cjs`
- Modify: `desktop/electron/catalog-prices.test.cjs`

**Interfaces:**
- Produces (Nutzer): Spalten `public.decks.format text not null default 'tcg'` mit Check `decks_format_check`, `public.deck_cards.role text` mit Check `deck_cards_role_check`.
- Produces (für Task 5, 6): in `catalog-build.cjs` `banOf(card, key: 'ban_tcg'|'ban_ocg') → 'forbidden'|'limited'|'semi'|null`, `mergeCards` schreibt `ban_tcg`/`ban_ocg`, `buildAliases(enCards, cards) → { [Artwork]: Haupt }`, `packCatalog(cards, version, sealedProducts = [], aliases = {})`. In `catalog-prices.cjs` `catalogMainId(userDataPath, id) → string`, `catalogCards(userDataPath, ids?) → { available, cards, aliases }` (mit ids über die Zuordnung), `catalogLegality(userDataPath) → { available, builtAt, aliases, cards: { [id]: { name, type, ban_tcg, ban_ocg } } }`. `readCatalogPrices`, `readCatalogCards`, `catalogPrices` unverändert.
- Consumes (vorhanden): YGOPRODeck-Dump `card_images[].id`, `banlist_info.ban_tcg/ban_ocg`; Katalogdatei `<userData>/catalog/catalog.json.gz`.

- [ ] **Step 1: `supabase/decks_format_role.sql` schreiben (nur Datei, nichts ausführen)**

```sql
-- supabase/decks_format_role.sql — Spec E3 §4/§6/§9. Einmal im Dashboard einspielen (idempotent),
-- VOR dem neuen Desktop-Installer und der APK.
-- decks.format: Legalitaetsformat je Deck (tcg | ocg | free), Standard tcg -- bestehende Decks werden TCG.
-- deck_cards.role: 'starter' fuer Starthand-Ziele (nur Desktop setzt es), leer = normal.
-- Die bestehenden Policies "decks are private" und "deck_cards are private" decken Lesen und Schreiben ab.

alter table public.decks add column if not exists format text not null default 'tcg';
alter table public.decks drop constraint if exists decks_format_check;
alter table public.decks add constraint decks_format_check check (format in ('tcg', 'ocg', 'free'));

alter table public.deck_cards add column if not exists role text;
alter table public.deck_cards drop constraint if exists deck_cards_role_check;
alter table public.deck_cards add constraint deck_cards_role_check check (role in ('starter'));

-- Abnahme (Nutzer, von Hand):
--   select id, name, format from public.decks order by id desc limit 5;
--   select deck_id, card_id, count, section, role from public.deck_cards where role is not null limit 10;
```

- [ ] **Step 2: Tests schreiben**

In `desktop/electron/catalog-build.test.cjs` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```js
const zlib = require('node:zlib');
const { cmPriceOf, mergeCards, attachVerified, packCatalog, sealedKindOf, buildSealedProducts } = require('./catalog-build.cjs');
```
durch:
```js
const zlib = require('node:zlib');
const { cmPriceOf, banOf, mergeCards, buildAliases, attachVerified, packCatalog, sealedKindOf, buildSealedProducts } = require('./catalog-build.cjs');
```

Änderung 2/2 — ersetzen:
```js
  assert.equal(back.cards[0].cm_price, 35.71);
});

```
durch:
```js
  assert.equal(back.cards[0].cm_price, 35.71);
});

// Spec E3 §3 -- Banlist aus banlist_info. Echte Werte im YGOPRODeck-Dump: "Forbidden", "Limited", "Semi-Limited".
test('banOf: Forbidden/Banned -> forbidden, Limited -> limited, Semi-Limited -> semi, sonst null', () => {
  const c = { banlist_info: { ban_tcg: 'Forbidden', ban_ocg: 'Semi-Limited', ban_goat: 'Limited' } };
  assert.equal(banOf(c, 'ban_tcg'), 'forbidden');
  assert.equal(banOf(c, 'ban_ocg'), 'semi');
  assert.equal(banOf({ banlist_info: { ban_tcg: 'Banned' } }, 'ban_tcg'), 'forbidden');
  assert.equal(banOf({ banlist_info: { ban_tcg: 'Limited' } }, 'ban_tcg'), 'limited');
  assert.equal(banOf({ banlist_info: { ban_tcg: 'Limited' } }, 'ban_ocg'), null, 'Schlüssel fehlt');
  assert.equal(banOf({ banlist_info: { ban_tcg: 'Unlimited' } }, 'ban_tcg'), null, 'unbekannter Wert');
  assert.equal(banOf({ banlist_info: { ban_tcg: 'toString' } }, 'ban_tcg'), null);
  assert.equal(banOf({}, 'ban_tcg'), null, 'banlist_info fehlt');
});

test('mergeCards schreibt ban_tcg und ban_ocg, ohne banlist_info null', () => {
  const pot = [{ ...EN[0], id: 55144522, name: 'Pot of Greed', banlist_info: { ban_tcg: 'Forbidden', ban_ocg: 'Limited', ban_goat: 'Limited' } }];
  const [c] = mergeCards(pot, []);
  assert.equal(c.ban_tcg, 'forbidden');
  assert.equal(c.ban_ocg, 'limited');
  const [plain] = mergeCards(EN, DE);
  assert.equal(plain.ban_tcg, null);
  assert.equal(plain.ban_ocg, null);
});

test('buildAliases: alle abweichenden card_images[].id, Haupt-ID nie, nur Karten im Katalog', () => {
  const en = [
    { ...EN[0], card_images: [{ id: 46986414, image_url: 'a' }, { id: 46986415, image_url: 'b' }, { id: 36996508, image_url: 'c' }] },
    { id: 89631139, name: 'Blue-Eyes White Dragon', type: 'Normal Monster', card_images: [{ id: 89631139, image_url: 'd' }, { id: 89631140, image_url: 'e' }] },
    { id: 12345678, name: 'ohne Bild', card_images: [{ id: 12345679 }] },
  ];
  const cards = mergeCards(en, []);
  assert.deepEqual(buildAliases(en, cards), { 46986415: '46986414', 36996508: '46986414', 89631140: '89631139' });
  assert.deepEqual(buildAliases(en, cards.filter((c) => c.id !== 89631139)), { 46986415: '46986414', 36996508: '46986414' });
});

test('buildAliases: eine Artwork-ID, die selbst Haupt-ID ist, wird nicht umgebogen', () => {
  const en = [
    { id: 1, name: 'A', card_images: [{ id: 1, image_url: 'a' }, { id: 2, image_url: 'b' }] },
    { id: 2, name: 'B', card_images: [{ id: 2, image_url: 'b' }] },
  ];
  assert.deepEqual(buildAliases(en, mergeCards(en, [])), {});
});

test('packCatalog schreibt aliases, ohne Angabe leer', () => {
  const plain = JSON.parse(zlib.gunzipSync(packCatalog(mergeCards(EN, DE), 14).buffer).toString('utf8'));
  assert.deepEqual(plain.aliases, {});
  const withAliases = JSON.parse(zlib.gunzipSync(packCatalog(mergeCards(EN, DE), 15, [], { 46986415: '46986414' }).buffer).toString('utf8'));
  assert.deepEqual(withAliases.aliases, { 46986415: '46986414' });
});

```

In `desktop/electron/catalog-prices.test.cjs` (4 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/4 — ersetzen:
```js
const { mergeCards, packCatalog } = require('./catalog-build.cjs');
const { catalogFilePath, saveCatalogFile, readCatalogPrices, readCatalogCards, catalogPrices, catalogCards } = require('./catalog-prices.cjs');
```
durch:
```js
const { mergeCards, packCatalog } = require('./catalog-build.cjs');
const {
  catalogFilePath, saveCatalogFile, readCatalogPrices, readCatalogCards, catalogPrices, catalogCards, catalogMainId, catalogLegality,
} = require('./catalog-prices.cjs');
```

Änderung 2/4 — ersetzen:
```js
    cards: [{ id: '14558127', name_de: 'Asche-Blüte', name_en: 'Karte 14558127', type: 'Effect Monster', image: 'https://x/14558127.jpg' }],
```
durch:
```js
    cards: [{ id: '14558127', name_de: 'Asche-Blüte', name_en: 'Karte 14558127', type: 'Effect Monster', image: 'https://x/14558127.jpg' }],
    aliases: {},
```

Änderung 3/4 — ersetzen:
```js
    ],
```
durch:
```js
    ],
    aliases: {},
```

Änderung 4/4 — ersetzen:
```js
test('Katalog-Index ohne Datei: Katalog fehlt', () => {
  assert.deepEqual(catalogCards(tmpDir(), ['14558127']), { available: false, cards: [] });
  assert.equal(readCatalogCards(tmpDir()), null);
});

```
durch:
```js
test('Katalog-Index ohne Datei: Katalog fehlt', () => {
  assert.deepEqual(catalogCards(tmpDir(), ['14558127']), { available: false, cards: [], aliases: {} });
  assert.equal(readCatalogCards(tmpDir()), null);
});

// Spec E3 §3/§4 -- Artwork-Zuordnung, Banlist und Baudatum aus derselben Datei.
const banned = (id, name, type, banlist_info) => ({ ...card(id), name, type, banlist_info });

function saveE3Catalog(dir) {
  const en = [
    banned(46986414, 'Dark Magician', 'Normal Monster'),
    banned(55144522, 'Pot of Greed', 'Spell Card', { ban_tcg: 'Forbidden', ban_ocg: 'Forbidden' }),
    banned(18144506, "Harpie's Feather Duster", 'Spell Card', { ban_tcg: 'Limited', ban_ocg: 'Semi-Limited' }),
  ];
  const cards = mergeCards(en, [{ id: 46986414, name: 'Dunkler Magier', desc: 'x' }]);
  saveCatalogFile(dir, packCatalog(cards, 8, [], { 46986415: '46986414', 99999998: '11111111' }).buffer);
}

test('Katalog-Index löst Artwork-Passcodes über die Zuordnung auf (Hauptkarte, aliases je Anfrage)', () => {
  const dir = tmpDir();
  saveE3Catalog(dir);
  assert.deepEqual(catalogCards(dir, ['46986415', '46986414', '99999998']), {
    available: true,
    cards: [{ id: '46986414', name_de: 'Dunkler Magier', name_en: 'Dark Magician', type: 'Normal Monster', image: 'https://x/46986414.jpg' }],
    aliases: { 46986415: '46986414' },
  });
  assert.equal(catalogMainId(dir, '46986415'), '46986414');
  assert.equal(catalogMainId(dir, 46986414), '46986414');
  assert.equal(catalogMainId(dir, '99999998'), '99999998', 'Zuordnung auf eine Karte außerhalb des Katalogs zählt nicht');
  assert.equal(catalogMainId(tmpDir(), '46986415'), '46986415', 'ohne Datei unverändert');
});

test('Legalitäts-Index: Name, Typ, Banlist, ganze Zuordnung und Baudatum', () => {
  const dir = tmpDir();
  saveE3Catalog(dir);
  const leg = catalogLegality(dir);
  assert.equal(leg.available, true);
  assert.match(leg.builtAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(leg.aliases, { 46986415: '46986414' });
  assert.deepEqual(leg.cards, {
    46986414: { name: 'Dunkler Magier', type: 'Normal Monster', ban_tcg: null, ban_ocg: null },
    55144522: { name: 'Pot of Greed', type: 'Spell Card', ban_tcg: 'forbidden', ban_ocg: 'forbidden' },
    18144506: { name: "Harpie's Feather Duster", type: 'Spell Card', ban_tcg: 'limited', ban_ocg: 'semi' },
  });
  assert.equal(catalogLegality(dir), leg, 'einmal je Datei gebaut');
});

test('Legalitäts-Index: ohne Datei oder mit Katalog von vor E3 (ohne aliases) nicht verfügbar', () => {
  const empty = { available: false, builtAt: null, aliases: {}, cards: {} };
  assert.deepEqual(catalogLegality(tmpDir()), empty);
  const dir = tmpDir();
  const v7 = { version: 7, built_at: '2026-09-10T03:00:00.000Z', cards: [{ id: 55144522, name_de: 'Topf der Gier', type: 'Spell Card', image: 'i' }], sealed_products: [] };
  saveCatalogFile(dir, require('node:zlib').gzipSync(Buffer.from(JSON.stringify(v7))));
  assert.deepEqual(catalogLegality(dir), empty);
  assert.equal(catalogCards(dir, ['55144522']).cards.length, 1, 'Import liest den alten Katalog weiter');
});

```

- [ ] **Step 3: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/catalog-build.test.cjs electron/catalog-prices.test.cjs`
Expected: FAIL, `ℹ pass 17`, `ℹ fail 10`, u. a. `TypeError: banOf is not a function`, `TypeError: buildAliases is not a function`, `TypeError: catalogLegality is not a function` und die beiden bestehenden Katalog-Index-Tests (Antwort ohne `aliases`).

- [ ] **Step 4: `catalog-build.cjs` und `catalog-builder.cjs`**

In `desktop/electron/catalog-build.cjs` (4 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/4 — ersetzen:
```js
  return Number.isFinite(n) && n > 0 ? n : null;
```
durch:
```js
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Spec E3 §3 — Banlist-Stufe aus banlist_info.ban_tcg/ban_ocg. YGOPRODeck schreibt "Forbidden" (im Dump vom
// 2026-09-16 gemessen: 117x TCG, 91x OCG; nie "Banned"); "Banned" steht in der Spec und wird ebenso verstanden.
// Fehlt banlist_info oder der Schluessel, oder ist der Wert unbekannt -> null = uneingeschraenkt.
const BAN_LEVELS = { Forbidden: 'forbidden', Banned: 'forbidden', Limited: 'limited', 'Semi-Limited': 'semi' };
function banOf(c, key) {
  const raw = c && c.banlist_info ? c.banlist_info[key] : null;
  return raw != null && Object.hasOwn(BAN_LEVELS, raw) ? BAN_LEVELS[raw] : null;
```

Änderung 2/4 — ersetzen:
```js
    });
  }
  return out;
}
```
durch:
```js
      ban_tcg: banOf(c, 'ban_tcg'),
      ban_ocg: banOf(c, 'ban_ocg'),
    });
  }
  return out;
}

// Spec E3 §3 — Artwork-Zuordnung { "<Artwork-Passcode>": "<Haupt-Passcode>" } aus card_images[].id. Nur fuer Karten,
// die im Katalog stehen (`cards` = Ergebnis von mergeCards); die Haupt-ID selbst und IDs, die selbst Haupt-ID einer
// Katalogkarte sind, werden nie aufgenommen (im Dump vom 2026-09-16: 164 Artworks, keine Kollision).
function buildAliases(enCards, cards) {
  const mains = new Set((cards || []).map((c) => String(c.id)));
  const aliases = {};
  for (const c of enCards || []) {
    if (!c || c.id == null || !mains.has(String(c.id))) continue;
    for (const img of Array.isArray(c.card_images) ? c.card_images : []) {
      if (!img || img.id == null) continue;
      const alt = String(Number(img.id));
      if (alt === String(c.id) || mains.has(alt) || Object.hasOwn(aliases, alt)) continue;
      aliases[alt] = String(c.id);
    }
  }
  return aliases;
}
```

Änderung 3/4 — ersetzen:
```js
function packCatalog(cards, version, sealedProducts = []) {
  const json = JSON.stringify({ version, built_at: new Date().toISOString(), cards, sealed_products: sealedProducts });
  const buffer = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
```
durch:
```js
// Spec E3 §3: `aliases` steht immer im Katalog (auch leer) -- sein Fehlen kennzeichnet einen Katalog von vor E3
// ("Katalog fehlt – Banlist unbekannt").
function packCatalog(cards, version, sealedProducts = [], aliases = {}) {
  const json = JSON.stringify({ version, built_at: new Date().toISOString(), cards, sealed_products: sealedProducts, aliases });
  const buffer = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
```

Änderung 4/4 — ersetzen:
```js
}

module.exports = { cmPriceOf, mergeCards, attachVerified, sealedKindOf, buildSealedProducts, packCatalog };
```
durch:
```js
}

module.exports = { cmPriceOf, banOf, mergeCards, buildAliases, attachVerified, sealedKindOf, buildSealedProducts, packCatalog };
```

In `desktop/electron/catalog-builder.cjs` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```js
const { mergeCards, attachVerified, packCatalog } = require('./catalog-build.cjs');
const { sealedProductsForCatalog } = require('./sealed-products.cjs');
```
durch:
```js
const { mergeCards, buildAliases, attachVerified, packCatalog } = require('./catalog-build.cjs');
const { sealedProductsForCatalog } = require('./sealed-products.cjs');
```

Änderung 2/2 — ersetzen:
```js
    const sealedProducts = sealedProductsForCatalog(userDataPath);
    const { buffer, bytes } = packCatalog(cards, version, sealedProducts);
```
durch:
```js
    const sealedProducts = sealedProductsForCatalog(userDataPath);
    // Spec E3 §3: Artwork-Zuordnung aus dem englischen Dump (card_images[].id), nur fuer Karten im Katalog.
    const { buffer, bytes } = packCatalog(cards, version, sealedProducts, buildAliases(dumps.en, cards));
```

- [ ] **Step 5: `catalog-prices.cjs`**

In `desktop/electron/catalog-prices.cjs` (5 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/5 — ersetzen:
```js
let cache = null;

// { prices: Map Passcode -> cm_price|null, cards: Map Passcode -> { id, name_de, name_en, type, image } } oder null,
// wenn keine lesbare Datei da ist.
function readCatalog(userDataPath) {
```
durch:
```js
// Spec E3 §3: dazu Banlist je Karte, die Artwork-Zuordnung und das Baudatum.
let cache = null;

// { prices: Map Passcode -> cm_price|null, cards: Map Passcode -> { id, name_de, name_en, type, image, ban_tcg, ban_ocg },
//   aliases: Map Artwork-Passcode -> Haupt-Passcode, legality: bool (Katalog traegt aliases, also auch Ban-Felder),
//   builtAt } oder null, wenn keine lesbare Datei da ist.
function readCatalog(userDataPath) {
```

Änderung 2/5 — ersetzen:
```js
    for (const c of Array.isArray(json.cards) ? json.cards : []) {
```
durch:
```js
    const banOf = (v) => (v === 'forbidden' || v === 'limited' || v === 'semi' ? v : null);
    for (const c of Array.isArray(json.cards) ? json.cards : []) {
```

Änderung 3/5 — ersetzen:
```js
      cards.set(id, { id, name_de: c.name_de || '', name_en: c.name_en || '', type: c.type || '', image: c.image || null });
    }
    cache = { key, prices, cards };
    return cache;
```
durch:
```js
      cards.set(id, {
        id, name_de: c.name_de || '', name_en: c.name_en || '', type: c.type || '', image: c.image || null,
        ban_tcg: banOf(c.ban_tcg), ban_ocg: banOf(c.ban_ocg),
      });
    }
    // Katalog von vor E3: kein aliases-Objekt -> legality false ("Katalog fehlt – Banlist unbekannt").
    const legality = !!json.aliases && typeof json.aliases === 'object' && !Array.isArray(json.aliases);
    const aliases = new Map();
    if (legality) {
      for (const [alt, main] of Object.entries(json.aliases)) if (cards.has(String(main))) aliases.set(String(alt), String(main));
    }
    cache = { key, prices, cards, aliases, legality, builtAt: typeof json.built_at === 'string' ? json.built_at : null, legalityIndex: null };
    return cache;
```

Änderung 4/5 — ersetzen:
```js
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
durch:
```js
// Spec E3 §3: Haupt-Passcode eines Deckkarten-Passcodes (Artwork -> Hauptkarte), sonst der Passcode selbst.
// Gleiche Regel wie deckImport.js#canonicalPasscode; ohne lesbare Datei unveraendert.
function catalogMainId(userDataPath, id) {
  const catalog = readCatalog(userDataPath);
  const key = String(id);
  return (catalog && catalog.aliases.get(key)) || key;
}

// Spec E2 §4 -- fuer den Renderer-Import: mit ids nur diese Passcodes (samt Bild, fuer YDK/YDKE), ohne ids alle Karten
// kompakt ohne Bild (Textliste, ~1,5 MB). available = false ohne Datei ("Katalog fehlt").
// Spec E3 §3: mit ids laufen Artwork-Passcodes ueber die Zuordnung -- geliefert wird die Hauptkarte, und `aliases`
// nennt fuer jeden angefragten Artwork-Passcode seinen Haupt-Passcode (die Aufloesung selbst macht deckImport.js).
function catalogCards(userDataPath, ids) {
  const catalog = readCatalog(userDataPath);
  if (!catalog) return { available: false, cards: [], aliases: {} };
  const pick = ({ id, name_de, name_en, type }) => ({ id, name_de, name_en, type });
  if (Array.isArray(ids)) {
    const out = [];
    const aliases = {};
    const seen = new Set();
    for (const raw of new Set(ids.map(String))) {
      const main = catalog.aliases.get(raw);
      if (main) aliases[raw] = main;
      const id = main || raw;
      const c = catalog.cards.get(id);
      if (c && !seen.has(id)) { seen.add(id); out.push({ ...pick(c), image: c.image }); }
    }
    return { available: true, cards: out, aliases };
  }
  return { available: true, cards: Array.from(catalog.cards.values(), pick), aliases: {} };
}

// Spec E3 §4/§7 -- fuer die Legalitaet im Renderer: alle Karten mit Name, Typ und Banlist, die ganze Artwork-Zuordnung
// und das Baudatum ("Banlist-Stand"). available = false ohne Datei ODER mit einem Katalog von vor E3 (ohne aliases):
// dann gilt "Katalog fehlt – Banlist unbekannt". Einmal je Katalogdatei gebaut und behalten.
function catalogLegality(userDataPath) {
  const catalog = readCatalog(userDataPath);
  if (!catalog || !catalog.legality) return { available: false, builtAt: null, aliases: {}, cards: {} };
  if (!catalog.legalityIndex) {
    const cards = {};
    for (const c of catalog.cards.values()) {
      cards[c.id] = { name: c.name_de || c.name_en || null, type: c.type || null, ban_tcg: c.ban_tcg, ban_ocg: c.ban_ocg };
    }
    catalog.legalityIndex = { available: true, builtAt: catalog.builtAt, aliases: Object.fromEntries(catalog.aliases), cards };
  }
  return catalog.legalityIndex;
}
```

Änderung 5/5 — ersetzen:
```js
}

module.exports = { catalogFilePath, saveCatalogFile, readCatalogPrices, readCatalogCards, catalogPrices, catalogCards };
```
durch:
```js
}

module.exports = { catalogFilePath, saveCatalogFile, readCatalogPrices, readCatalogCards, catalogPrices, catalogCards, catalogMainId, catalogLegality };
```

- [ ] **Step 6: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/catalog-build.test.cjs electron/catalog-prices.test.cjs` → `ℹ tests 27`, `ℹ pass 27`, `ℹ fail 0`.
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 251`, `ℹ fail 0`.

- [ ] **Step 7: Schutz-Nachweis**

(a) In `buildAliases` `if (alt === String(c.id) || mains.has(alt) || Object.hasOwn(aliases, alt)) continue;` kurz durch `if (alt === String(c.id) || Object.hasOwn(aliases, alt)) continue;` ersetzen → `✖ buildAliases: eine Artwork-ID, die selbst Haupt-ID ist, wird nicht umgebogen` (gemessen). Zitieren, zurücknehmen.
(b) In `catalogLegality` `if (!catalog || !catalog.legality) return …` kurz zu `if (!catalog) return …` ändern → `✖ Legalitäts-Index: ohne Datei oder mit Katalog von vor E3 (ohne aliases) nicht verfügbar` (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add supabase/decks_format_role.sql desktop/electron/catalog-build.cjs desktop/electron/catalog-build.test.cjs desktop/electron/catalog-builder.cjs desktop/electron/catalog-prices.cjs desktop/electron/catalog-prices.test.cjs
git commit -m "feat(e3): decks.format/deck_cards.role (SQL), Katalog mit Banlist und Artwork-Zuordnung, Legalitäts-Index

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: JS-Zwilling `canonicalPasscode` und E2-Import über die Artwork-Zuordnung

**Files:**
- Modify: `docs/fixtures/decks/import.json`
- Modify: `desktop/src/utils/deckImport.js`
- Modify: `desktop/src/utils/deckImport.test.js`

**Interfaces:**
- Produces (für Task 3, 6, 7): `canonicalPasscode(passcode, aliases|null) → string`; `resolveImport(parsed, catalogCards, aliases = null)` (Passcode-Zeilen über die Zuordnung, Kandidat mit Artwork-Passcode); `prepareImport(text, format, loadCatalog)` nutzt `catalog.aliases` des Laders.
- Produces (Fixture, für Task 7): `import.json` bekommt `aliases` (oberste Ebene), `canonical[] { passcode, aliases: bool, expected }` und zwei `resolve`-Fälle (einer mit `"aliases": true`).
- Consumes (Task 1): `get-catalog-cards` liefert `aliases` (der Renderer-Lader reicht die Antwort unverändert durch).

- [ ] **Step 1: Fixture ergänzen**

Handrechnung: Mit Zuordnung werden `46986415` (1× Main) und `46986416` (1× Side) zur Hauptkarte Dunkler Magier aufgelöst, behalten aber ihren Passcode; `46986414` bleibt eine eigene Zeile (2×); `90448280` → Göttliches Arsenal (Extra). Zähler Main 1 + 2 = 3, Extra 1, Side 1. Ohne Zuordnung ist `46986415` „Unbekannter Passcode".

In `docs/fixtures/decks/import.json` (3 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/3 — ersetzen:
```json
  "_comment": "Spec E2 §4/§5 — Namensaufloesung, Abschnittsregel, Vorschau-Plan, Texte. Leser: desktop/src/utils/deckImport.test.js und android DeckImportTest.kt. resolve[].catalog false = kein Katalog (null). expected.rows[].candidates sind Passcodes; plans[].choices: Zeilenindex -> Passcode. Passcodes 1000xxxx sind erfundene Testkarten.",
  "catalog": [
```
durch:
```json
  "_comment": "Spec E2 §4/§5 — Namensaufloesung, Abschnittsregel, Vorschau-Plan, Texte. Leser: desktop/src/utils/deckImport.test.js und android DeckImportTest.kt. resolve[].catalog false = kein Katalog (null). expected.rows[].candidates sind Passcodes; plans[].choices: Zeilenindex -> Passcode. Passcodes 1000xxxx sind erfundene Testkarten. Spec E3 §3: aliases = Artwork-Zuordnung; resolve[].aliases true = mit Zuordnung (sonst null); canonical[] prueft canonicalPasscode.",
  "catalog": [
```

Änderung 2/3 — ersetzen:
```json
    {"id":10000051,"name_de":"","name_en":"Only English","type":"Spell Card"}
```
durch:
```json
    {"id":10000051,"name_de":"","name_en":"Only English","type":"Spell Card"}
  ],
  "aliases": {"46986415":"46986414","46986416":"46986414","90448280":"90448279"},
  "canonical": [
    {"passcode":"46986415","aliases":true,"expected":"46986414"},
    {"passcode":"46986414","aliases":true,"expected":"46986414"},
    {"passcode":"12345678","aliases":true,"expected":"12345678"},
    {"passcode":"46986415","aliases":false,"expected":"46986415"}
```

Änderung 3/3 — ersetzen:
```json
      "name": "Katalog fehlt: Passcodes werden unbekannt",
```
durch:
```json
      "name": "per Passcode mit Artwork-Zuordnung: Name und Typ der Hauptkarte, Deckkarte behält den Artwork-Passcode",
      "catalog": true,
      "aliases": true,
      "parsed": {"format":"ydk","cards":[{"passcode":"46986415","count":1,"section":"main"},{"passcode":"46986414","count":2,"section":"main"},{"passcode":"90448280","count":1,"section":"extra"},{"passcode":"46986416","count":1,"section":"side"}],"unresolved":[]},
      "expected": {"catalogMissing":false,"rows":[
        {"status":"ok","count":1,"section":"main","source":"46986415","candidates":["46986415"]},
        {"status":"ok","count":2,"section":"main","source":"46986414","candidates":["46986414"]},
        {"status":"ok","count":1,"section":"extra","source":"90448280","candidates":["90448280"]},
        {"status":"ok","count":1,"section":"side","source":"46986416","candidates":["46986416"]}
      ]},
      "plans": [
        {"choices":{},"expected":{
          "cards":[{"card_id":"46986415","name":"Dunkler Magier","count":1,"section":"main"},{"card_id":"46986414","name":"Dunkler Magier","count":2,"section":"main"},{"card_id":"90448280","name":"Göttliches Arsenal AA-ZEUS – Himmelsdonner","count":1,"section":"extra"},{"card_id":"46986416","name":"Dunkler Magier","count":1,"section":"side"}],
          "counts":{"main":3,"extra":1,"side":1},
          "skipped":[],
          "skippedLabels":[],
          "notes":null,
          "countsText":"Main 3 · Extra 1 · Side 1",
          "skippedText":null
        }}
      ]
    },
    {
      "name": "per Passcode ohne Zuordnung: Artwork-Passcodes sind unbekannt",
      "catalog": true,
      "parsed": {"format":"ydke","cards":[{"passcode":"46986415","count":1,"section":"main"},{"passcode":"46986414","count":2,"section":"main"}],"unresolved":[]},
      "expected": {"catalogMissing":false,"rows":[
        {"status":"unknownPasscode","count":1,"section":"main","source":"46986415","candidates":[]},
        {"status":"ok","count":2,"section":"main","source":"46986414","candidates":["46986414"]}
      ]},
      "plans": [
        {"choices":{},"expected":{"cards":[{"card_id":"46986414","name":"Dunkler Magier","count":2,"section":"main"}],"counts":{"main":2,"extra":0,"side":0},"skipped":["Unbekannter Passcode 46986415"],"skippedLabels":["Unbekannter Passcode 46986415"],"notes":"Nicht übernommen beim Import:\nUnbekannter Passcode 46986415","countsText":"Main 2 · Extra 0 · Side 0","skippedText":"1 nicht übernommen"}}
      ]
    },
    {
      "name": "Katalog fehlt: Passcodes werden unbekannt",
```

- [ ] **Step 2: Test schreiben**

In `desktop/src/utils/deckImport.test.js` (4 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/4 — ersetzen:
```js
  failedText, deckNameFor, suggestionText, ambiguousOptionText, unknownPasscodeText, prepareImport,
} from './deckImport.js';
```
durch:
```js
  failedText, deckNameFor, suggestionText, ambiguousOptionText, unknownPasscodeText, prepareImport, canonicalPasscode,
} from './deckImport.js';
```

Änderung 2/4 — ersetzen:
```js
    const resolved = resolveImport(c.parsed, c.catalog ? FIX.catalog : null);
    assert.equal(resolved.catalogMissing, c.expected.catalogMissing);
```
durch:
```js
    const resolved = resolveImport(c.parsed, c.catalog ? FIX.catalog : null, c.aliases ? FIX.aliases : null);
    assert.equal(resolved.catalogMissing, c.expected.catalogMissing);
```

Änderung 3/4 — ersetzen:
```js
  });
}
```
durch:
```js
  });
}

// Spec E3 §3 -- aliases[p] ?? p; ohne Zuordnung (kein Katalog) steht jeder Passcode fuer sich.
test('Fixture: Haupt-Passcode über die Artwork-Zuordnung', () => {
  for (const c of FIX.canonical) {
    assert.equal(canonicalPasscode(c.passcode, c.aliases ? FIX.aliases : null), c.expected, JSON.stringify(c));
  }
  assert.equal(canonicalPasscode(46986415, FIX.aliases), '46986414', 'Zahl als Passcode');
  assert.equal(canonicalPasscode('toString', {}), 'toString', 'nur eigene Schlüssel');
});
```

Änderung 4/4 — ersetzen:
```js
  assert.equal(missing.resolved.catalogMissing, true);
});

```
durch:
```js
  assert.equal(missing.resolved.catalogMissing, true);
});

// Spec E3 §3 -- der Lader liefert fuer Artwork-Passcodes die Hauptkarte und die Zuordnung; die Deckkarte behaelt den
// Artwork-Passcode.
test('Vorschau vorbereiten: Artwork-Passcode über aliases des Laders aufgelöst', async () => {
  const main = FIX.catalog.find((c) => c.id === 46986414);
  const ydk = await prepareImport('#main\n46986415\n', undefined, async () => ({ available: true, cards: [main], aliases: { 46986415: '46986414' } }));
  assert.deepEqual(ydk.resolved.rows[0].candidates, [{ passcode: '46986415', name: 'Dunkler Magier', type: 'Normal Monster' }]);
  const old = await prepareImport('#main\n46986415\n', undefined, async () => ({ available: true, cards: [main] }));
  assert.equal(old.resolved.rows[0].status, 'unknownPasscode', 'Lader ohne aliases (alter Katalog)');
});

```

- [ ] **Step 3: Fehlschlag bestätigen**

Run (in `desktop/`): `node --test src/utils/deckImport.test.js`
Expected: FAIL — `SyntaxError: The requested module './deckImport.js' does not provide an export named 'canonicalPasscode'` (die Datei lädt nicht, `ℹ fail 1`).

- [ ] **Step 4: `deckImport.js`**

In `desktop/src/utils/deckImport.js` (6 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/6 — ersetzen:
```js
export const moveLabel = (section) => (section === 'side' ? '→ Deck' : '→ Side');
```
durch:
```js
export const moveLabel = (section) => (section === 'side' ? '→ Deck' : '→ Side');

// Spec E3 §3: Haupt-Passcode eines (Artwork-)Passcodes -- aliases[p] ?? p. aliases: { "<Artwork>": "<Haupt>" } oder
// null/undefined (kein Katalog: jeder Passcode steht fuer sich). Gilt fuer Import-Aufloesung, Legalitaet und Kopien-Grenze.
export function canonicalPasscode(passcode, aliases) {
  const p = String(passcode);
  return aliases && Object.hasOwn(aliases, p) ? String(aliases[p]) : p;
}
```

Änderung 2/6 — ersetzen:
```js
const candidate = (c) => ({ passcode: String(c.id), name: displayName(c), type: c.type || '' });
const byNameThenPasscode = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.passcode < b.passcode ? -1 : a.passcode > b.passcode ? 1 : 0);
```
durch:
```js
// passcode: bei einem Artwork-Passcode bleibt der importierte Passcode stehen (Export bleibt artwork-treu), Name und
// Typ kommen von der Hauptkarte (Spec E3 §3).
const candidate = (c, passcode = String(c.id)) => ({ passcode, name: displayName(c), type: c.type || '' });
const byNameThenPasscode = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.passcode < b.passcode ? -1 : a.passcode > b.passcode ? 1 : 0);
```

Änderung 3/6 — ersetzen:
```js
// source = Passcode (YDK/YDKE) bzw. Rohzeile (Textliste).
export function resolveImport(parsed, catalogCards) {
  const index = buildIndex(catalogCards);
```
durch:
```js
// source = Passcode (YDK/YDKE) bzw. Rohzeile (Textliste). aliases (Spec E3 §3): Passcodes laufen ueber canonicalPasscode.
export function resolveImport(parsed, catalogCards, aliases = null) {
  const index = buildIndex(catalogCards);
```

Änderung 4/6 — ersetzen:
```js
      const c = index.byId.get(String(card.passcode));
      return c
        ? { status: 'ok', ...base, source: card.passcode, candidates: [candidate(c)] }
        : { status: 'unknownPasscode', ...base, source: card.passcode, candidates: [] };
```
durch:
```js
      const c = index.byId.get(canonicalPasscode(card.passcode, aliases));
      return c
        ? { status: 'ok', ...base, source: card.passcode, candidates: [candidate(c, String(card.passcode))] }
        : { status: 'unknownPasscode', ...base, source: card.passcode, candidates: [] };
```

Änderung 5/6 — ersetzen:
```js
// loadCatalog(ids | null) -> { available, cards }. Ergebnis { error } oder { resolved }.
export async function prepareImport(text, format, loadCatalog) {
```
durch:
```js
// loadCatalog(ids | null) -> { available, cards, aliases? }; mit ids liefert der Lader fuer Artwork-Passcodes die
// Hauptkarte und die Zuordnung in `aliases` (Spec E3 §3). Ergebnis { error } oder { resolved }.
export async function prepareImport(text, format, loadCatalog) {
```

Änderung 6/6 — ersetzen:
```js
  return { resolved: resolveImport(parsed, catalog && catalog.available ? catalog.cards : null) };
}
```
durch:
```js
  const available = !!(catalog && catalog.available);
  return { resolved: resolveImport(parsed, available ? catalog.cards : null, available ? catalog.aliases || null : null) };
}
```

- [ ] **Step 5: Tests und Lint**

Run (in `desktop/`): `node --test src/utils/deckImport.test.js` → `ℹ tests 16`, `ℹ pass 16`, `ℹ fail 0`.
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 189`.
Run (in `desktop/`): `npx eslint .` → `5 errors` (unverändert).

- [ ] **Step 6: Schutz-Nachweis**

(a) In `resolveImport` `index.byId.get(canonicalPasscode(card.passcode, aliases))` kurz durch `index.byId.get(String(card.passcode))` ersetzen → `✖ Fixture auflösen: per Passcode mit Artwork-Zuordnung: …` und `✖ Vorschau vorbereiten: Artwork-Passcode über aliases des Laders aufgelöst` (gemessen). Zitieren, zurücknehmen.
(b) `candidates: [candidate(c, String(card.passcode))]` kurz zu `candidates: [candidate(c)]` → dieselben zwei Tests scheitern (Kandidat trüge den Haupt-Passcode, der Export wäre nicht mehr artwork-treu; gemessen). Zitieren, zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add docs/fixtures/decks/import.json desktop/src/utils/deckImport.js desktop/src/utils/deckImport.test.js
git commit -m "feat(e3): canonicalPasscode und Import-Auflösung über die Artwork-Zuordnung (JS-Zwilling)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: JS-Zwilling `deckLegality` mit Fixture

**Files:**
- Create: `docs/fixtures/decks/legality.json`
- Create: `desktop/src/utils/deckLegality.js`
- Create: `desktop/src/utils/deckLegality.test.js`

**Interfaces:**
- Produces (für Task 6, 7): `FORMATS`, `FORMAT_LABELS`, `CATALOG_MISSING_BANLIST`, `COPY_LIMIT`, `FORMAT_SAVE_FAILED`, `BAN_LABELS`, `normalizeFormat(format) → 'tcg'|'ocg'|'free'`, `banOf(passcode, format, catalog|null) → 'forbidden'|'limited'|'semi'|null`, `deckLegality(cards: [{ card_id, name?, count, section }], format, catalog|null) → { legal, violations: [{ rule, cardId, text }], warnings: [{ cardId, text }] }` mit `catalog = { aliases, cards: { [id]: { name, type, ban_tcg, ban_ocg } } }`, `violationCountText(n)`, `badgeText(result, format)`, `badgeKind(result, format) → 'legal'|'warn'|'crit'|'free'`, `banlistDateText(builtAt) → string|null`, `canAddCopy(deckCards, passcode, format, aliases|null) → boolean`.
- Produces (Fixture, für Task 7): `legality.json` mit `catalog { aliases, cards }`, `bases { main37, main40, main60, extra15, side15 }`, `legality[] { name, format, catalog: bool, base: [..], cards, expected { legal, violations, warnings, badge, badgeKind } }`, `formats[]`, `ban[]`, `banlistDate[]`, `violationCount[]`, `canAddCopy[] { name, format, aliases: bool, cards, passcode, expected }`.
- Consumes (Task 2): `canonicalPasscode`, `deckSectionFor`.

- [ ] **Step 1: Fixture schreiben**

Handrechnung der Basen: `main37` = Füller 1–12 × 3 + Füller 13 × 1, `main40` = Füller 1–13 × 3 + Füller 14 × 1, `main60` = Füller 1–20 × 3, `extra15` = Fusion 1–5 × 3, `side15` = Füller 16–20 × 3 (überschneidet sich nicht mit `main40`). „Reihenfolge": Eingabe Side → Extra → Main; ausgewertet wird Main (Harpie's, Decode Talker), Extra (Asche-Blüte), Side (Topf, Dunkler Magier) → Regel 4 Decode Talker vor Asche-Blüte, Regel 5 Dunkler Magier, Regel 6 Harpie's vor Topf. „Katalog fehlt": 37 + Topf + Decode Talker = 39 (Regel 1), 46986414 × 2 und 46986415 × 2 zählen ohne Zuordnung einzeln (keine Regel 5), Topf und Decode Talker ohne Regeln 4/6.

```json
{
  "_comment": "Spec E3 §4/§5 — Legalitaet TCG/OCG/Frei, Badge, Banlist-Stufe, Banlist-Stand, Kopien-Grenze. Leser: desktop/src/utils/deckLegality.test.js und android DeckLegalityTest.kt. legality[].cards = Zeilen der genannten bases (in dieser Reihenfolge) plus cards; catalog false = kein Katalog (null). Passcodes 1000xxxx und 12345678/87654321 sind erfundene Testkarten; 12345678/87654321 fehlen absichtlich im Katalog.",
  "catalog": {
    "aliases": {"46986415":"46986414","55144523":"55144522"},
    "cards": {
      "46986414": {"name":"Dunkler Magier","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "55144522": {"name":"Topf der Gier","type":"Spell Card","ban_tcg":"forbidden","ban_ocg":"forbidden"},
      "18144506": {"name":"Harpie's Feather Duster","type":"Spell Card","ban_tcg":"limited","ban_ocg":"semi"},
      "14558127": {"name":"Asche-Blüte & Freudiger Frühling","type":"Tuner Monster","ban_tcg":null,"ban_ocg":"semi"},
      "1861629": {"name":"Decode Talker","type":"Link Monster","ban_tcg":null,"ban_ocg":null},
      "10000099": {"name":"Ohne Typ","type":null,"ban_tcg":null,"ban_ocg":null},
      "10000001": {"name":"Füller 1","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000002": {"name":"Füller 2","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000003": {"name":"Füller 3","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000004": {"name":"Füller 4","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000005": {"name":"Füller 5","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000006": {"name":"Füller 6","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000007": {"name":"Füller 7","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000008": {"name":"Füller 8","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000009": {"name":"Füller 9","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000010": {"name":"Füller 10","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000011": {"name":"Füller 11","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000012": {"name":"Füller 12","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000013": {"name":"Füller 13","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000014": {"name":"Füller 14","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000015": {"name":"Füller 15","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000016": {"name":"Füller 16","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000017": {"name":"Füller 17","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000018": {"name":"Füller 18","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000019": {"name":"Füller 19","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000020": {"name":"Füller 20","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000021": {"name":"Füller 21","type":"Normal Monster","ban_tcg":null,"ban_ocg":null},
      "10000101": {"name":"Fusion 1","type":"Fusion Monster","ban_tcg":null,"ban_ocg":null},
      "10000102": {"name":"Fusion 2","type":"Fusion Monster","ban_tcg":null,"ban_ocg":null},
      "10000103": {"name":"Fusion 3","type":"Fusion Monster","ban_tcg":null,"ban_ocg":null},
      "10000104": {"name":"Fusion 4","type":"Fusion Monster","ban_tcg":null,"ban_ocg":null},
      "10000105": {"name":"Fusion 5","type":"Fusion Monster","ban_tcg":null,"ban_ocg":null}
    }
  },
  "bases": {
    "main37": [{"card_id":"10000001","name":null,"count":3,"section":"main"},{"card_id":"10000002","name":null,"count":3,"section":"main"},{"card_id":"10000003","name":null,"count":3,"section":"main"},{"card_id":"10000004","name":null,"count":3,"section":"main"},{"card_id":"10000005","name":null,"count":3,"section":"main"},{"card_id":"10000006","name":null,"count":3,"section":"main"},{"card_id":"10000007","name":null,"count":3,"section":"main"},{"card_id":"10000008","name":null,"count":3,"section":"main"},{"card_id":"10000009","name":null,"count":3,"section":"main"},{"card_id":"10000010","name":null,"count":3,"section":"main"},{"card_id":"10000011","name":null,"count":3,"section":"main"},{"card_id":"10000012","name":null,"count":3,"section":"main"},{"card_id":"10000013","name":null,"count":1,"section":"main"}],
    "main40": [{"card_id":"10000001","name":null,"count":3,"section":"main"},{"card_id":"10000002","name":null,"count":3,"section":"main"},{"card_id":"10000003","name":null,"count":3,"section":"main"},{"card_id":"10000004","name":null,"count":3,"section":"main"},{"card_id":"10000005","name":null,"count":3,"section":"main"},{"card_id":"10000006","name":null,"count":3,"section":"main"},{"card_id":"10000007","name":null,"count":3,"section":"main"},{"card_id":"10000008","name":null,"count":3,"section":"main"},{"card_id":"10000009","name":null,"count":3,"section":"main"},{"card_id":"10000010","name":null,"count":3,"section":"main"},{"card_id":"10000011","name":null,"count":3,"section":"main"},{"card_id":"10000012","name":null,"count":3,"section":"main"},{"card_id":"10000013","name":null,"count":3,"section":"main"},{"card_id":"10000014","name":null,"count":1,"section":"main"}],
    "main60": [{"card_id":"10000001","name":null,"count":3,"section":"main"},{"card_id":"10000002","name":null,"count":3,"section":"main"},{"card_id":"10000003","name":null,"count":3,"section":"main"},{"card_id":"10000004","name":null,"count":3,"section":"main"},{"card_id":"10000005","name":null,"count":3,"section":"main"},{"card_id":"10000006","name":null,"count":3,"section":"main"},{"card_id":"10000007","name":null,"count":3,"section":"main"},{"card_id":"10000008","name":null,"count":3,"section":"main"},{"card_id":"10000009","name":null,"count":3,"section":"main"},{"card_id":"10000010","name":null,"count":3,"section":"main"},{"card_id":"10000011","name":null,"count":3,"section":"main"},{"card_id":"10000012","name":null,"count":3,"section":"main"},{"card_id":"10000013","name":null,"count":3,"section":"main"},{"card_id":"10000014","name":null,"count":3,"section":"main"},{"card_id":"10000015","name":null,"count":3,"section":"main"},{"card_id":"10000016","name":null,"count":3,"section":"main"},{"card_id":"10000017","name":null,"count":3,"section":"main"},{"card_id":"10000018","name":null,"count":3,"section":"main"},{"card_id":"10000019","name":null,"count":3,"section":"main"},{"card_id":"10000020","name":null,"count":3,"section":"main"}],
    "extra15": [{"card_id":"10000101","name":null,"count":3,"section":"extra"},{"card_id":"10000102","name":null,"count":3,"section":"extra"},{"card_id":"10000103","name":null,"count":3,"section":"extra"},{"card_id":"10000104","name":null,"count":3,"section":"extra"},{"card_id":"10000105","name":null,"count":3,"section":"extra"}],
    "side15": [{"card_id":"10000016","name":null,"count":3,"section":"side"},{"card_id":"10000017","name":null,"count":3,"section":"side"},{"card_id":"10000018","name":null,"count":3,"section":"side"},{"card_id":"10000019","name":null,"count":3,"section":"side"},{"card_id":"10000020","name":null,"count":3,"section":"side"}]
  },
  "legality": [
    {
      "name": "TCG: 40 Main-Deck-Karten sind legal", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [],
      "expected": {"legal":true,"violations":[],"warnings":[],"badge":"Legal","badgeKind":"legal"}
    },
    {
      "name": "Regel 1: 39 Main-Deck-Karten", "format": "tcg", "catalog": true, "base": ["main37"],
      "cards": [{"card_id":"10000014","name":null,"count":2,"section":"main"}],
      "expected": {"legal":false,"violations":[{"rule":1,"cardId":null,"text":"Main Deck: 39 Karten (erlaubt 40–60)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Regel 1: 60 Main-Deck-Karten sind legal", "format": "tcg", "catalog": true, "base": ["main60"],
      "cards": [],
      "expected": {"legal":true,"violations":[],"warnings":[],"badge":"Legal","badgeKind":"legal"}
    },
    {
      "name": "Regel 1: 61 Main-Deck-Karten", "format": "tcg", "catalog": true, "base": ["main60"],
      "cards": [{"card_id":"10000021","name":null,"count":1,"section":"main"}],
      "expected": {"legal":false,"violations":[{"rule":1,"cardId":null,"text":"Main Deck: 61 Karten (erlaubt 40–60)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Regel 2/3: Extra 15 und Side 15 sind legal", "format": "tcg", "catalog": true, "base": ["main40","extra15","side15"],
      "cards": [],
      "expected": {"legal":true,"violations":[],"warnings":[],"badge":"Legal","badgeKind":"legal"}
    },
    {
      "name": "Regel 2/3: Extra 16 und Side 16", "format": "tcg", "catalog": true, "base": ["main40","extra15","side15"],
      "cards": [{"card_id":"1861629","name":null,"count":1,"section":"extra"},{"card_id":"10000021","name":null,"count":1,"section":"side"}],
      "expected": {"legal":false,"violations":[{"rule":2,"cardId":null,"text":"Extra Deck: 16 Karten (höchstens 15)"},{"rule":3,"cardId":null,"text":"Side Deck: 16 Karten (höchstens 15)"}],"warnings":[],"badge":"2 Verstöße","badgeKind":"crit"}
    },
    {
      "name": "Regel 5: 3 Kopien über Main und Side sind legal", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"14558127","name":"Asche-Blüte","count":2,"section":"main"},{"card_id":"14558127","name":"Asche-Blüte","count":1,"section":"side"}],
      "expected": {"legal":true,"violations":[],"warnings":[],"badge":"Legal","badgeKind":"legal"}
    },
    {
      "name": "Regel 5: 4 Kopien über Main und Side", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"14558127","name":"Asche-Blüte","count":2,"section":"main"},{"card_id":"14558127","name":"Asche-Blüte","count":2,"section":"side"}],
      "expected": {"legal":false,"violations":[{"rule":5,"cardId":"14558127","text":"Asche-Blüte: 4 Kopien (höchstens 3)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Regel 5: Doppelzeilen desselben Passcodes zählen zusammen", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"14558127","name":"Asche-Blüte","count":1,"section":"main"},{"card_id":"14558127","name":"Asche-Blüte","count":3,"section":"main"}],
      "expected": {"legal":false,"violations":[{"rule":5,"cardId":"14558127","text":"Asche-Blüte: 4 Kopien (höchstens 3)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Regel 5: Artwork und Normalversion zählen zusammen (Name der ersten Zeile)", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"46986414","name":"Dunkler Magier","count":2,"section":"main"},{"card_id":"46986415","name":"Dark Magician","count":2,"section":"side"}],
      "expected": {"legal":false,"violations":[{"rule":5,"cardId":"46986414","text":"Dunkler Magier: 4 Kopien (höchstens 3)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Regel 6: verboten", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"55144522","name":"Pot of Greed","count":1,"section":"main"}],
      "expected": {"legal":false,"violations":[{"rule":6,"cardId":"55144522","text":"Pot of Greed ist verboten"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Regel 6: limitiert 1 legal, 2 Kopien Verstoß (über Abschnitte)", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"18144506","name":"Harpie's Feather Duster","count":1,"section":"main"},{"card_id":"18144506","name":"Harpie's Feather Duster","count":1,"section":"side"}],
      "expected": {"legal":false,"violations":[{"rule":6,"cardId":"18144506","text":"Harpie's Feather Duster: 2 Kopien (limitiert 1)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Regel 6: limitiert mit 1 Kopie ist legal", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"18144506","name":"Harpie's Feather Duster","count":1,"section":"main"}],
      "expected": {"legal":true,"violations":[],"warnings":[],"badge":"Legal","badgeKind":"legal"}
    },
    {
      "name": "OCG: dieselbe Karte ist semi-limitiert, 2 Kopien legal", "format": "ocg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"18144506","name":"Harpie's Feather Duster","count":2,"section":"main"}],
      "expected": {"legal":true,"violations":[],"warnings":[],"badge":"Legal","badgeKind":"legal"}
    },
    {
      "name": "OCG: semi-limitiert mit 3 Kopien", "format": "ocg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"18144506","name":"Harpie's Feather Duster","count":3,"section":"main"}],
      "expected": {"legal":false,"violations":[{"rule":6,"cardId":"18144506","text":"Harpie's Feather Duster: 3 Kopien (semi-limitiert 2)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "OCG gegen TCG: in TCG uneingeschränkt, in OCG semi-limitiert", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"14558127","name":"Asche-Blüte","count":3,"section":"main"}],
      "expected": {"legal":true,"violations":[],"warnings":[],"badge":"Legal","badgeKind":"legal"}
    },
    {
      "name": "OCG gegen TCG: dieselben 3 Kopien in OCG", "format": "ocg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"14558127","name":"Asche-Blüte","count":3,"section":"main"}],
      "expected": {"legal":false,"violations":[{"rule":6,"cardId":"14558127","text":"Asche-Blüte: 3 Kopien (semi-limitiert 2)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Vorrang: verboten mit 4 Kopien zeigt nur Regel 6", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"55144522","name":"Pot of Greed","count":4,"section":"main"}],
      "expected": {"legal":false,"violations":[{"rule":6,"cardId":"55144522","text":"Pot of Greed ist verboten"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Vorrang: limitiert mit 4 Kopien zeigt nur Regel 6", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"18144506","name":"Harpie's Feather Duster","count":4,"section":"main"}],
      "expected": {"legal":false,"violations":[{"rule":6,"cardId":"18144506","text":"Harpie's Feather Duster: 4 Kopien (limitiert 1)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Regel 4: Link im Main, Monster im Extra (Katalogname), ohne Typ und Side ungeprüft", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"1861629","name":"Decode Talker","count":1,"section":"main"},{"card_id":"14558127","name":null,"count":1,"section":"extra"},{"card_id":"10000099","name":"Ohne Typ","count":1,"section":"extra"},{"card_id":"1861629","name":"Decode Talker","count":1,"section":"side"}],
      "expected": {"legal":false,"violations":[{"rule":4,"cardId":"1861629","text":"Decode Talker im Main Deck gehört ins Extra Deck"},{"rule":4,"cardId":"14558127","text":"Asche-Blüte & Freudiger Frühling im Extra Deck gehört ins Main Deck"}],"warnings":[],"badge":"2 Verstöße","badgeKind":"crit"}
    },
    {
      "name": "Reihenfolge: Regeln nacheinander, innerhalb erstes Auftreten in Main, Extra, Side", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"55144522","name":"Pot of Greed","count":1,"section":"side"},{"card_id":"14558127","name":"Asche-Blüte","count":1,"section":"extra"},{"card_id":"18144506","name":"Harpie's Feather Duster","count":2,"section":"main"},{"card_id":"1861629","name":"Decode Talker","count":1,"section":"main"},{"card_id":"46986414","name":"Dunkler Magier","count":4,"section":"side"}],
      "expected": {"legal":false,"violations":[{"rule":4,"cardId":"1861629","text":"Decode Talker im Main Deck gehört ins Extra Deck"},{"rule":4,"cardId":"14558127","text":"Asche-Blüte im Extra Deck gehört ins Main Deck"},{"rule":5,"cardId":"46986414","text":"Dunkler Magier: 4 Kopien (höchstens 3)"},{"rule":6,"cardId":"18144506","text":"Harpie's Feather Duster: 2 Kopien (limitiert 1)"},{"rule":6,"cardId":"55144522","text":"Pot of Greed ist verboten"}],"warnings":[],"badge":"5 Verstöße","badgeKind":"crit"}
    },
    {
      "name": "Unbekannte Karte: eine Warnung je Haupt-Passcode", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"12345678","name":"Unbekannte Karte","count":1,"section":"main"},{"card_id":"12345678","name":"Unbekannte Karte","count":1,"section":"side"}],
      "expected": {"legal":true,"violations":[],"warnings":[{"cardId":"12345678","text":"Banlist unbekannt: Passcode 12345678"}],"badge":"Legal · 1 Warnung","badgeKind":"warn"}
    },
    {
      "name": "Unbekannte Karten: zwei Warnungen, Regel 5 gilt trotzdem (Name fällt auf den Passcode zurück)", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"12345678","name":"Unbekannte Karte","count":1,"section":"main"},{"card_id":"87654321","name":null,"count":4,"section":"side"}],
      "expected": {"legal":false,"violations":[{"rule":5,"cardId":"87654321","text":"87654321: 4 Kopien (höchstens 3)"}],"warnings":[{"cardId":"12345678","text":"Banlist unbekannt: Passcode 12345678"},{"cardId":"87654321","text":"Banlist unbekannt: Passcode 87654321"}],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Unbekannte Karten ohne Verstoß: Plural der Warnungen", "format": "tcg", "catalog": true, "base": ["main40"],
      "cards": [{"card_id":"12345678","name":null,"count":1,"section":"main"},{"card_id":"87654321","name":null,"count":1,"section":"side"}],
      "expected": {"legal":true,"violations":[],"warnings":[{"cardId":"12345678","text":"Banlist unbekannt: Passcode 12345678"},{"cardId":"87654321","text":"Banlist unbekannt: Passcode 87654321"}],"badge":"Legal · 2 Warnungen","badgeKind":"warn"}
    },
    {
      "name": "Katalog fehlt: eine Warnung, Regeln 1–3 und 5 laufen (5 ohne Zuordnung), 4 und 6 entfallen", "format": "tcg", "catalog": false, "base": ["main37"],
      "cards": [{"card_id":"55144522","name":"Pot of Greed","count":1,"section":"main"},{"card_id":"1861629","name":"Decode Talker","count":1,"section":"main"},{"card_id":"46986414","name":"Dunkler Magier","count":2,"section":"side"},{"card_id":"46986415","name":"Dark Magician","count":2,"section":"side"}],
      "expected": {"legal":false,"violations":[{"rule":1,"cardId":null,"text":"Main Deck: 39 Karten (erlaubt 40–60)"}],"warnings":[{"cardId":null,"text":"Katalog fehlt – Banlist unbekannt"}],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Katalog fehlt: Regel 5 ohne Zuordnung", "format": "ocg", "catalog": false, "base": ["main40"],
      "cards": [{"card_id":"14558127","name":"Asche-Blüte","count":4,"section":"main"}],
      "expected": {"legal":false,"violations":[{"rule":5,"cardId":"14558127","text":"Asche-Blüte: 4 Kopien (höchstens 3)"}],"warnings":[{"cardId":null,"text":"Katalog fehlt – Banlist unbekannt"}],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Katalog fehlt und sonst nichts: Legal mit einer Warnung", "format": "tcg", "catalog": false, "base": ["main40"],
      "cards": [],
      "expected": {"legal":true,"violations":[],"warnings":[{"cardId":null,"text":"Katalog fehlt – Banlist unbekannt"}],"badge":"Legal · 1 Warnung","badgeKind":"warn"}
    },
    {
      "name": "Frei: keine Regeln, keine Warnungen", "format": "free", "catalog": true, "base": ["main60"],
      "cards": [{"card_id":"10000021","name":null,"count":1,"section":"main"},{"card_id":"55144522","name":"Pot of Greed","count":4,"section":"main"},{"card_id":"1861629","name":"Decode Talker","count":1,"section":"main"},{"card_id":"12345678","name":null,"count":1,"section":"side"}],
      "expected": {"legal":true,"violations":[],"warnings":[],"badge":"Frei","badgeKind":"free"}
    },
    {
      "name": "Frei ohne Katalog: keine Warnung", "format": "free", "catalog": false, "base": [],
      "cards": [],
      "expected": {"legal":true,"violations":[],"warnings":[],"badge":"Frei","badgeKind":"free"}
    },
    {
      "name": "Unbekanntes Format zählt als TCG", "format": "goat", "catalog": true, "base": ["main37"],
      "cards": [],
      "expected": {"legal":false,"violations":[{"rule":1,"cardId":null,"text":"Main Deck: 37 Karten (erlaubt 40–60)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    },
    {
      "name": "Leeres Deck", "format": "tcg", "catalog": true, "base": [],
      "cards": [],
      "expected": {"legal":false,"violations":[{"rule":1,"cardId":null,"text":"Main Deck: 0 Karten (erlaubt 40–60)"}],"warnings":[],"badge":"1 Verstoß","badgeKind":"crit"}
    }
  ],
  "formats": [
    {"format":"tcg","normalized":"tcg","label":"TCG"},
    {"format":"ocg","normalized":"ocg","label":"OCG"},
    {"format":"free","normalized":"free","label":"Frei"},
    {"format":null,"normalized":"tcg","label":"TCG"},
    {"format":"goat","normalized":"tcg","label":"TCG"}
  ],
  "ban": [
    {"passcode":"55144522","format":"tcg","catalog":true,"expected":"forbidden","label":"Verboten"},
    {"passcode":"55144523","format":"ocg","catalog":true,"expected":"forbidden","label":"Verboten"},
    {"passcode":"18144506","format":"tcg","catalog":true,"expected":"limited","label":"1"},
    {"passcode":"18144506","format":"ocg","catalog":true,"expected":"semi","label":"2"},
    {"passcode":"14558127","format":"tcg","catalog":true,"expected":null,"label":null},
    {"passcode":"14558127","format":"ocg","catalog":true,"expected":"semi","label":"2"},
    {"passcode":"55144522","format":"free","catalog":true,"expected":null,"label":null},
    {"passcode":"55144522","format":"tcg","catalog":false,"expected":null,"label":null},
    {"passcode":"12345678","format":"tcg","catalog":true,"expected":null,"label":null}
  ],
  "banlistDate": [
    {"builtAt":"2026-09-16T03:12:45.123Z","text":"Banlist-Stand: 16.09.2026"},
    {"builtAt":"2026-01-02","text":"Banlist-Stand: 02.01.2026"},
    {"builtAt":null,"text":null},
    {"builtAt":"kaputt","text":null}
  ],
  "violationCount": [
    {"n":0,"text":"0 Verstöße"},
    {"n":1,"text":"1 Verstoß"},
    {"n":3,"text":"3 Verstöße"}
  ],
  "canAddCopy": [
    {"name":"2 Kopien, eine dazu","format":"tcg","aliases":true,"cards":[{"card_id":"46986414","name":null,"count":2,"section":"main"}],"passcode":"46986414","expected":true},
    {"name":"3 Kopien, vierte blockiert","format":"tcg","aliases":true,"cards":[{"card_id":"46986414","name":null,"count":3,"section":"main"}],"passcode":"46986414","expected":false},
    {"name":"über Abschnitte gezählt","format":"tcg","aliases":true,"cards":[{"card_id":"46986414","name":null,"count":2,"section":"main"},{"card_id":"46986414","name":null,"count":1,"section":"side"}],"passcode":"46986414","expected":false},
    {"name":"Doppelzeilen im selben Abschnitt","format":"tcg","aliases":true,"cards":[{"card_id":"46986414","name":null,"count":1,"section":"main"},{"card_id":"46986414","name":null,"count":2,"section":"main"}],"passcode":"46986414","expected":false},
    {"name":"Artwork über die Zuordnung","format":"tcg","aliases":true,"cards":[{"card_id":"46986414","name":null,"count":2,"section":"main"},{"card_id":"46986415","name":null,"count":1,"section":"side"}],"passcode":"46986415","expected":false},
    {"name":"Artwork ohne Zuordnung zählt einzeln","format":"tcg","aliases":false,"cards":[{"card_id":"46986414","name":null,"count":2,"section":"main"},{"card_id":"46986415","name":null,"count":1,"section":"side"}],"passcode":"46986415","expected":true},
    {"name":"OCG wie TCG","format":"ocg","aliases":true,"cards":[{"card_id":"46986414","name":null,"count":3,"section":"main"}],"passcode":"46986414","expected":false},
    {"name":"Frei immer","format":"free","aliases":true,"cards":[{"card_id":"46986414","name":null,"count":3,"section":"main"}],"passcode":"46986414","expected":true},
    {"name":"unbekanntes Format zählt als TCG","format":null,"aliases":true,"cards":[{"card_id":"46986414","name":null,"count":3,"section":"main"}],"passcode":"46986414","expected":false},
    {"name":"Banlist blockiert nie","format":"tcg","aliases":true,"cards":[{"card_id":"55144522","name":null,"count":2,"section":"main"}],"passcode":"55144522","expected":true},
    {"name":"leeres Deck","format":"tcg","aliases":true,"cards":[],"passcode":"55144522","expected":true}
  ]
}
```

- [ ] **Step 2: Test schreiben**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deckLegality, badgeText, badgeKind, banOf, BAN_LABELS, banlistDateText, canAddCopy, normalizeFormat, FORMAT_LABELS,
  violationCountText,
} from './deckLegality.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DeckLegalityTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/legality.json', import.meta.url), 'utf8'));
const cardsOf = (c) => [...c.base.flatMap((b) => FIX.bases[b]), ...c.cards];

for (const c of FIX.legality) {
  test(`Fixture Legalität: ${c.name}`, () => {
    const result = deckLegality(cardsOf(c), c.format, c.catalog ? FIX.catalog : null);
    const { badge, badgeKind: kind, ...expected } = c.expected;
    assert.deepEqual(result, expected);
    assert.equal(badgeText(result, c.format), badge);
    assert.equal(badgeKind(result, c.format), kind);
  });
}

test('Fixture: Formate', () => {
  for (const f of FIX.formats) {
    assert.equal(normalizeFormat(f.format), f.normalized, String(f.format));
    assert.equal(FORMAT_LABELS[normalizeFormat(f.format)], f.label);
  }
});

test('Fixture: Banlist-Stufe und Icon-Text', () => {
  for (const b of FIX.ban) {
    const ban = banOf(b.passcode, b.format, b.catalog ? FIX.catalog : null);
    assert.equal(ban, b.expected, JSON.stringify(b));
    assert.equal(ban ? BAN_LABELS[ban] : null, b.label);
  }
});

test('Fixture: Banlist-Stand und Anzahl Verstöße', () => {
  for (const d of FIX.banlistDate) assert.equal(banlistDateText(d.builtAt), d.text, String(d.builtAt));
  for (const v of FIX.violationCount) assert.equal(violationCountText(v.n), v.text);
});

for (const c of FIX.canAddCopy) {
  test(`Fixture Kopien-Grenze: ${c.name}`, () => {
    assert.equal(canAddCopy(c.cards, c.passcode, c.format, c.aliases ? FIX.catalog.aliases : null), c.expected);
  });
}
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run (in `desktop/`): `node --test src/utils/deckLegality.test.js`
Expected: FAIL mit `Cannot find module …/deckLegality.js`.

- [ ] **Step 4: `deckLegality.js` anlegen**

```js
// Spec E3 §4/§5 — Format, Legalitaetsregeln TCG/OCG, Badge-Texte, Banlist-Stufe und Kopien-Grenze.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/DeckLegality.kt. Beide laufen gegen
// docs/fixtures/decks/legality.json. Wer eine Seite aendert, aendert beide.
import { canonicalPasscode, deckSectionFor } from './deckImport.js';

export const FORMATS = ['tcg', 'ocg', 'free'];
export const FORMAT_LABELS = { tcg: 'TCG', ocg: 'OCG', free: 'Frei' };
export const CATALOG_MISSING_BANLIST = 'Katalog fehlt – Banlist unbekannt';
export const COPY_LIMIT = 'Höchstens 3 Kopien je Karte';
export const FORMAT_SAVE_FAILED = 'Format konnte nicht gespeichert werden';
// Anzeige der Banlist-Stufe an der Kartenzeile (rot "Verboten", orange "1", gelb "2").
export const BAN_LABELS = { forbidden: 'Verboten', limited: '1', semi: '2' };

const SECTION_ORDER = ['main', 'extra', 'side'];
const MAX_COPIES = 3;
const BAN_MAX = { forbidden: 0, limited: 1, semi: 2 };

// Spec E3 §8: fehlt die Spalte format (SQL nicht eingespielt) oder steht Unbekanntes darin -> TCG.
export function normalizeFormat(format) {
  return FORMATS.includes(format) ? format : 'tcg';
}

// catalog: null (kein Katalog) oder { aliases: { Artwork: Haupt }, cards: { [Haupt-Passcode]: { name, type, ban_tcg, ban_ocg } } }.
function mainIdOf(passcode, catalog) {
  return catalog ? canonicalPasscode(passcode, catalog.aliases) : String(passcode);
}

// Banlist-Stufe einer Deckkarte im Format: 'forbidden' | 'limited' | 'semi' | null (uneingeschraenkt, Frei, unbekannt).
export function banOf(passcode, format, catalog) {
  const f = normalizeFormat(format);
  if (f === 'free' || !catalog) return null;
  const info = catalog.cards[mainIdOf(passcode, catalog)];
  const ban = info ? info[f === 'ocg' ? 'ban_ocg' : 'ban_tcg'] : null;
  return Object.hasOwn(BAN_MAX, ban || '') ? ban : null;
}

// cards: [{ card_id, name?, count, section }] (gespeicherter oder Editor-Stand; mehrere Zeilen je Passcode erlaubt).
// Ergebnis { legal, violations: [{ rule, cardId, text }], warnings: [{ cardId, text }] }; cardId = Haupt-Passcode oder null.
export function deckLegality(cards, format, catalog) {
  const f = normalizeFormat(format);
  if (f === 'free') return { legal: true, violations: [], warnings: [] };
  const rows = SECTION_ORDER.flatMap((s) => (cards || []).filter((c) => c && c.section === s && Number(c.count) > 0));
  const total = (s) => rows.filter((c) => c.section === s).reduce((a, c) => a + Number(c.count), 0);
  const violations = [];
  const warnings = [];

  const main = total('main');
  const extra = total('extra');
  const side = total('side');
  if (main < 40 || main > 60) violations.push({ rule: 1, cardId: null, text: `Main Deck: ${main} Karten (erlaubt 40–60)` });
  if (extra > 15) violations.push({ rule: 2, cardId: null, text: `Extra Deck: ${extra} Karten (höchstens 15)` });
  if (side > 15) violations.push({ rule: 3, cardId: null, text: `Side Deck: ${side} Karten (höchstens 15)` });
  if (!catalog) warnings.push({ cardId: null, text: CATALOG_MISSING_BANLIST });

  // Je Haupt-Passcode: erster Name (gespeicherter Deckkartenname, sonst Katalog, sonst Passcode), Summe, Abschnitte.
  const groups = new Map();
  for (const c of rows) {
    const id = mainIdOf(c.card_id, catalog);
    const info = catalog ? catalog.cards[id] : undefined;
    let g = groups.get(id);
    if (!g) {
      g = { id, name: c.name || (info && info.name) || id, info, count: 0, sections: [] };
      groups.set(id, g);
    }
    g.count += Number(c.count);
    if (!g.sections.includes(c.section)) g.sections.push(c.section);
  }

  const rule5 = [];
  const rule6 = [];
  for (const g of groups.values()) {
    if (catalog && !g.info) warnings.push({ cardId: g.id, text: `Banlist unbekannt: Passcode ${g.id}` });
    if (catalog && g.info && g.info.type) {
      const home = deckSectionFor(g.info.type);
      if (g.sections.includes('main') && home === 'extra') {
        violations.push({ rule: 4, cardId: g.id, text: `${g.name} im Main Deck gehört ins Extra Deck` });
      }
      if (g.sections.includes('extra') && home === 'main') {
        violations.push({ rule: 4, cardId: g.id, text: `${g.name} im Extra Deck gehört ins Main Deck` });
      }
    }
    const ban = catalog && g.info ? banOf(g.id, f, catalog) : null;
    if (ban === 'forbidden') rule6.push({ rule: 6, cardId: g.id, text: `${g.name} ist verboten` });
    else if (ban === 'limited' && g.count > 1) rule6.push({ rule: 6, cardId: g.id, text: `${g.name}: ${g.count} Kopien (limitiert 1)` });
    else if (ban === 'semi' && g.count > 2) rule6.push({ rule: 6, cardId: g.id, text: `${g.name}: ${g.count} Kopien (semi-limitiert 2)` });
    else if (g.count > MAX_COPIES) rule5.push({ rule: 5, cardId: g.id, text: `${g.name}: ${g.count} Kopien (höchstens 3)` });
  }
  violations.push(...rule5, ...rule6);
  return { legal: violations.length === 0, violations, warnings };
}

export const violationCountText = (n) => (n === 1 ? '1 Verstoß' : `${n} Verstöße`);

// "Legal" | "Legal · 1 Warnung" | "Legal · 2 Warnungen" | "1 Verstoß" | "3 Verstöße" | "Frei".
export function badgeText(result, format) {
  if (normalizeFormat(format) === 'free') return 'Frei';
  if (result.violations.length > 0) return violationCountText(result.violations.length);
  const w = result.warnings.length;
  if (w === 0) return 'Legal';
  return `Legal · ${w} ${w === 1 ? 'Warnung' : 'Warnungen'}`;
}

// Farbe des Badges: 'free' grau, 'legal' gruen, 'warn' gelb, 'crit' rot.
export function badgeKind(result, format) {
  if (normalizeFormat(format) === 'free') return 'free';
  if (result.violations.length > 0) return 'crit';
  return result.warnings.length > 0 ? 'warn' : 'legal';
}

// "Banlist-Stand: TT.MM.JJJJ" aus built_at (ISO, UTC-Datum wie gespeichert); ohne gueltiges Datum null.
export function banlistDateText(builtAt) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(String(builtAt || ''));
  return m ? `Banlist-Stand: ${m[3]}.${m[2]}.${m[1]}` : null;
}

// Spec E3 §5: darf eine weitere Kopie von `passcode` ins Deck? TCG/OCG: nicht, wenn die Karte (Haupt-Passcode, ueber alle
// Abschnitte) danach mehr als 3 Kopien haette; Frei immer. Die Banlist blockiert nie. aliases null = ohne Zuordnung.
export function canAddCopy(deckCards, passcode, format, aliases) {
  if (normalizeFormat(format) === 'free') return true;
  const id = canonicalPasscode(passcode, aliases);
  const have = (deckCards || [])
    .filter((c) => c && canonicalPasscode(c.card_id, aliases) === id)
    .reduce((a, c) => a + Math.max(0, Number(c.count) || 0), 0);
  return have + 1 <= MAX_COPIES;
}
```

- [ ] **Step 5: Tests und Lint**

Run (in `desktop/`): `node --test src/utils/deckLegality.test.js` → `ℹ tests 45`, `ℹ pass 45`, `ℹ fail 0`.
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 234`.
Run (in `desktop/`): `npx eslint .` → `5 errors`.

- [ ] **Step 6: Schutz-Nachweis**

(a) Vorrang Regel 6 vor 5: `    else if (g.count > MAX_COPIES) rule5.push(` kurz zu `    if (g.count > MAX_COPIES) rule5.push(` → `✖ Fixture Legalität: Vorrang: verboten mit 4 Kopien zeigt nur Regel 6`, `✖ … Vorrang: limitiert mit 4 Kopien zeigt nur Regel 6` (gemessen).
(b) Artwork zusammen: `    const id = mainIdOf(c.card_id, catalog);` kurz zu `    const id = String(c.card_id);` → `✖ Fixture Legalität: Regel 5: Artwork und Normalversion zählen zusammen (Name der ersten Zeile)` (gemessen).
(c) Reihenfolge Main/Extra/Side: `const rows = SECTION_ORDER.flatMap(…)` kurz zu `const rows = (cards || []).filter((c) => c && SECTION_ORDER.includes(c.section) && Number(c.count) > 0);` → `✖ Fixture Legalität: Reihenfolge: …` (gemessen).
(d) Kopien-Grenze über die Zuordnung: in `canAddCopy` `.filter((c) => c && canonicalPasscode(c.card_id, aliases) === id)` kurz zu `.filter((c) => c && String(c.card_id) === String(passcode))` → `✖ Fixture Kopien-Grenze: Artwork über die Zuordnung` (gemessen).
Jeweils zitieren und zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add docs/fixtures/decks/legality.json desktop/src/utils/deckLegality.js desktop/src/utils/deckLegality.test.js
git commit -m "feat(e3): Legalitätsregeln, Badge, Banlist-Stufe und Kopien-Grenze als JS-Zwilling mit Fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Starthand-Wahrscheinlichkeiten und Testhand (`deckOdds.js`, nur Desktop)

**Files:**
- Create: `desktop/src/utils/deckOdds.js`
- Create: `desktop/src/utils/deckOdds.test.js`

**Interfaces:**
- Produces (für Task 6): `NO_MAIN`, `NO_STARTERS`, `HAND_SIZES = [5, 6]`, `handOdds(N, K, n) → { p0, p1, p2plus, atLeastOne } | null` (N = 0 → null), `percentText(p) → "74,2 %"`, `oddsTexts(mainCards: [{ quantity|count, role }]) → { message } | { lines: [{ size, atLeastOne, distribution }] }`, `drawHand(mainCards, size, rng = Math.random) → Karten-Objekte`.
- Consumes: nichts.

- [ ] **Step 1: Test schreiben**

Handrechnung: C(40,5) = 658008, C(31,5) = 169911, C(31,4) = 31465 → P(0) = 169911/658008 = 25,8 %, P(1) = 9 · 31465/658008 = 283185/658008 = 43,0 %, P(2+) = 204912/658008 = 31,1 %, P(≥1) = 74,2 %. Mit 6 Karten: C(40,6) = 3838380, C(31,6) = 736281 → 19,2 %, P(1) = 9 · 169911/3838380 = 39,8 %, 2+ = 41,0 %, ≥1 = 80,8 %. Testhand mit `rng = [0.5, 0.1, 0.9]` auf dem Stapel `a a b c c c c`: i=0 → j=3 (c), i=1 → j=1 (a), i=2 → j=6 (c) → `c a c`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handOdds, percentText, oddsTexts, drawHand, NO_MAIN, NO_STARTERS } from './deckOdds.js';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg}: ${a} != ${b}`);

// Exakte Werte mit BigInt-Binomialkoeffizienten, unabhaengig von der Produktformel.
function binom(n, k) {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 1n; i <= BigInt(k); i++) r = (r * (BigInt(n) - BigInt(k) + i)) / i;
  return r;
}
const ratio = (a, b) => Number((a * 10n ** 15n) / b) / 1e15;

test('40 Karten, 9 Starter, 5 Karten: 74,2 % (C(31,5)/C(40,5) = 169911/658008)', () => {
  const o = handOdds(40, 9, 5);
  close(o.p0, 169911 / 658008, 'P(0)');
  close(o.p1, 283185 / 658008, 'P(1)');
  close(o.p2plus, 204912 / 658008, 'P(2+)');
  close(o.atLeastOne, 488097 / 658008, 'P(>=1)');
  assert.equal(percentText(o.atLeastOne), '74,2 %');
});

test('Produktformel stimmt mit den Binomialkoeffizienten überein (N 1–20, alle K, n 1–7)', () => {
  for (let N = 1; N <= 20; N++) {
    for (let K = 0; K <= N; K++) {
      for (let n = 1; n <= 7; n++) {
        const d = Math.min(n, N);
        const all = binom(N, d);
        const o = handOdds(N, K, n);
        const tag = `N=${N} K=${K} n=${n}`;
        assert.ok(Math.abs(o.p0 - ratio(binom(N - K, d), all)) < 1e-9, `${tag} P(0)`);
        assert.ok(Math.abs(o.p1 - ratio(binom(K, 1) * binom(N - K, d - 1), all)) < 1e-9, `${tag} P(1)`);
      }
    }
  }
});

test('Kanten: K = 0, K = N, n > N, N = 0', () => {
  assert.deepEqual(handOdds(40, 0, 5), { p0: 1, p1: 0, p2plus: 0, atLeastOne: 0 });
  const all = handOdds(40, 40, 5);
  assert.equal(all.p0, 0);
  assert.equal(all.atLeastOne, 1);
  assert.equal(handOdds(1, 1, 5).p1, 1, 'n auf N begrenzt');
  const small = handOdds(3, 1, 5);
  assert.equal(small.p0, 0);
  close(small.p1, 1, 'alle 3 Karten gezogen: genau 1 Starter');
  assert.equal(handOdds(0, 0, 5), null);
});

test('Prozenttext: eine Nachkommastelle mit Komma', () => {
  assert.equal(percentText(0.25822), '25,8 %');
  assert.equal(percentText(0.43037), '43,0 %');
  assert.equal(percentText(1), '100,0 %');
  assert.equal(percentText(0), '0,0 %');
  assert.equal(percentText(0.00049), '0,0 %');
  assert.equal(percentText(0.0005), '0,1 %');
});

test('Texte für 5 und 6 Karten; ohne Main Deck bzw. ohne Starter der Hinweis', () => {
  const main = [
    { card_id: '1', quantity: 3, role: 'starter' }, { card_id: '2', quantity: 3, role: 'starter' },
    { card_id: '3', quantity: 3, role: 'starter' }, { card_id: '4', quantity: 31, role: null },
  ];
  assert.deepEqual(oddsTexts(main), {
    lines: [
      { size: 5, atLeastOne: '5 Karten: mindestens 1 Starter 74,2 %', distribution: '0: 25,8 % · 1: 43,0 % · 2+: 31,1 %' },
      { size: 6, atLeastOne: '6 Karten: mindestens 1 Starter 80,8 %', distribution: '0: 19,2 % · 1: 39,8 % · 2+: 41,0 %' },
    ],
  });
  assert.deepEqual(oddsTexts([]), { message: NO_MAIN });
  assert.deepEqual(oddsTexts([{ card_id: '4', quantity: 40, role: null }]), { message: NO_STARTERS });
  assert.deepEqual(oddsTexts([{ card_id: '1', count: 2, role: 'starter' }, { card_id: '4', count: 38 }]).lines[0].size, 5, 'count statt quantity');
});

test('Testhand: austauschbare Zufallsquelle, Kopien einzeln, höchstens so viele wie da', () => {
  const a = { card_id: 'a', quantity: 2 };
  const b = { card_id: 'b', quantity: 1, role: 'starter' };
  const c = { card_id: 'c', quantity: 4 };
  const ids = (hand) => hand.map((x) => x.card_id);
  assert.deepEqual(ids(drawHand([a, b, c], 5, () => 0)), ['a', 'a', 'b', 'c', 'c']);
  assert.deepEqual(ids(drawHand([a, b, c], 2, () => 0.999999)), ['c', 'a']);
  const seq = [0.5, 0.1, 0.9];
  let k = 0;
  assert.deepEqual(ids(drawHand([a, b, c], 3, () => seq[k++])), ['c', 'a', 'c']);
  assert.equal(drawHand([a, b, c], 6, Math.random).length, 6);
  assert.equal(drawHand([b], 5, () => 0).length, 1);
  assert.deepEqual(drawHand([], 5, () => 0), []);
  assert.equal(drawHand([a, b, c], 7, () => 0).filter((x) => x.role === 'starter').length, 1, 'Starter-Markierung bleibt am Objekt');
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `node --test src/utils/deckOdds.test.js`
Expected: FAIL mit `Cannot find module …/deckOdds.js`.

- [ ] **Step 3: `deckOdds.js` anlegen**

```js
// Spec E3 §6 — Starthand-Wahrscheinlichkeiten (exakt, hypergeometrisch) und Testhand. Nur Desktop, kein Zwilling.

export const NO_MAIN = 'Keine Main-Deck-Karten';
export const NO_STARTERS = 'Markiere Starthand-Ziele mit dem Stern';
export const HAND_SIZES = [5, 6];

// P(genau 0), P(genau 1), P(mindestens 2), P(mindestens 1) fuer N Karten, K Starter, n gezogene Karten -- ueber Produkte
// von Bruechen (keine grossen Binomialkoeffizienten). n wird auf N begrenzt; K >= N -> P(0) = 0; N = 0 -> null.
export function handOdds(N, K, n) {
  if (!(N > 0)) return null;
  const k = Math.min(Math.max(0, K), N);
  const draw = Math.min(Math.max(0, n), N);
  // P(0) = prod_{i<draw} (N-K-i)/(N-i)
  let p0 = 1;
  for (let i = 0; i < draw; i++) p0 *= Math.max(0, N - k - i) / (N - i);
  // P(1) = draw * K/N * prod_{i<draw-1} (N-K-i)/(N-1-i)
  let p1 = 0;
  if (draw >= 1 && k >= 1) {
    p1 = (draw * k) / N;
    for (let i = 0; i < draw - 1; i++) p1 *= Math.max(0, N - k - i) / (N - 1 - i);
  }
  const p2plus = Math.max(0, 1 - p0 - p1);
  return { p0, p1, p2plus, atLeastOne: 1 - p0 };
}

// "74,2 %" -- eine Nachkommastelle, deutsches Komma.
export function percentText(p) {
  const tenths = Math.round(p * 1000);
  return `${Math.floor(tenths / 10)},${tenths % 10} %`;
}

// mainCards: [{ quantity|count, role }] des Main Decks. Ergebnis { message } oder { lines: [{ size, atLeastOne, distribution }] }.
export function oddsTexts(mainCards) {
  const countOf = (c) => Math.max(0, Number(c.quantity ?? c.count) || 0);
  const N = (mainCards || []).reduce((a, c) => a + countOf(c), 0);
  const K = (mainCards || []).filter((c) => c.role === 'starter').reduce((a, c) => a + countOf(c), 0);
  if (N === 0) return { message: NO_MAIN };
  if (K === 0) return { message: NO_STARTERS };
  return {
    lines: HAND_SIZES.map((size) => {
      const o = handOdds(N, K, size);
      return {
        size,
        atLeastOne: `${size} Karten: mindestens 1 Starter ${percentText(o.atLeastOne)}`,
        distribution: `0: ${percentText(o.p0)} · 1: ${percentText(o.p1)} · 2+: ${percentText(o.p2plus)}`,
      };
    }),
  };
}

// Testhand: `size` zufaellige Karten aus dem Main Deck, Kopien einzeln (hoechstens so viele, wie da sind).
// rng liefert Zahlen in [0, 1) und ist austauschbar (Tests). Teil-Fisher-Yates, Reihenfolge = Ziehreihenfolge.
export function drawHand(mainCards, size, rng = Math.random) {
  const pile = [];
  for (const c of mainCards || []) {
    const n = Math.max(0, Number(c.quantity ?? c.count) || 0);
    for (let i = 0; i < n; i++) pile.push(c);
  }
  const take = Math.min(size, pile.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (pile.length - i));
    [pile[i], pile[j]] = [pile[j], pile[i]];
  }
  return pile.slice(0, take);
}
```

- [ ] **Step 4: Tests und Lint**

Run (in `desktop/`): `node --test src/utils/deckOdds.test.js` → `ℹ tests 6`, `ℹ pass 6`, `ℹ fail 0`.
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 240`.
Run (in `desktop/`): `npx eslint .` → `5 errors`.

- [ ] **Step 5: Schutz-Nachweis**

`  const draw = Math.min(Math.max(0, n), N);` kurz zu `  const draw = Math.max(0, n);` → `✖ Produktformel stimmt mit den Binomialkoeffizienten überein (N 1–20, alle K, n 1–7)` und `✖ Kanten: K = 0, K = N, n > N, N = 0` (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/utils/deckOdds.js desktop/src/utils/deckOdds.test.js
git commit -m "feat(e3): exakte Starthand-Wahrscheinlichkeiten und Testhand mit austauschbarer Zufallsquelle

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: Desktop-Hauptprozess — Save Deck mit `role` und `format`, Legalitäts-Kanal, Hauptkarte für Bild und Typ

**Files:**
- Modify: `desktop/electron/decks.cjs`
- Modify: `desktop/electron/decks.test.cjs`
- Modify: `desktop/electron/main.cjs`
- Modify: `desktop/electron/preload.cjs`
- Modify: `desktop/electron/ipc-channels.test.cjs`
- Modify: `desktop/src/utils/saveDeckPayload.js`
- Modify: `desktop/src/utils/saveDeckPayload.test.js`

**Interfaces:**
- Produces (für Task 6): in `decks.cjs` `FORMAT_SAVE_FAILED`, `saveDeckRows(deckId, cards: [{ id, type, quantity, name, image_url, role }], detailOf) → rows`, `async saveDeck(client, { deckId, cards, notes, format }, detailOf) → { success: true, roleSaved }` (wirft bei Fehler). Renderer-Brücke: `window.api.saveDeck(deckId, cards, notes?, format?)`, `window.api.getCatalogLegality() → { available, builtAt, aliases, cards }`; `getDeckDetails` liefert je Karte `role` (`'starter'|null`). `buildSaveDeckCards` liefert `role`.
- Consumes (Task 1): `catalogMainId`, `catalogLegality`, `readCatalogCards`.

- [ ] **Step 1: Tests schreiben**

In `desktop/electron/decks.test.cjs` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```js
const copies = require('./copies.cjs');
const { DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck } = require('./decks.cjs');
```
durch:
```js
const copies = require('./copies.cjs');
const {
  DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck,
  FORMAT_SAVE_FAILED, saveDeckRows, saveDeck,
} = require('./decks.cjs');
```

Änderung 2/2 — ersetzen:
```js
  assert.deepEqual(readYdkFile(file), { canceled: false, name: 'Tenpai Dragon', text: '#main\n14558127\n!side\n' });
});

```
durch:
```js
  assert.deepEqual(readYdkFile(file), { canceled: false, name: 'Tenpai Dragon', text: '#main\n14558127\n!side\n' });
});

// Spec E3 §6/§8 -- Attrappe fuer "Save Deck": deck_cards.delete().eq(), deck_cards.insert(rows), decks.update().eq().
// insertErrors: Fehler je Insert-Aufruf in Reihenfolge; updateErrors: Fehler je Update-Feld (notes/format).
function saveClient({ insertErrors = [], updateErrors = {} } = {}) {
  const calls = { deleted: [], inserts: [], updates: [] };
  return {
    calls,
    from(table) {
      return {
        delete: () => ({ eq: async (col, val) => { calls.deleted.push({ table, col, val }); return { error: null }; } }),
        insert: async (rows) => { calls.inserts.push(rows); return { error: insertErrors[calls.inserts.length - 1] || null }; },
        update: (patch) => ({
          eq: async (col, val) => {
            calls.updates.push({ table, patch, col, val });
            return { error: updateErrors[Object.keys(patch)[0]] || null };
          },
        }),
      };
    },
  };
}

const SAVE_CARDS = [
  { id: '14558127', type: 'main', quantity: 3, name: 'Asche-Blüte', image_url: 'a.jpg', role: 'starter' },
  { id: '1861629', type: 'extra', quantity: 1, name: 'Decode Talker', image_url: null, role: 'starter' },
  { id: '27204311', type: 'side', quantity: 2, name: null, image_url: null, role: null },
];

test('Save Deck: role nur an Starter-Zeilen des Main Decks, Name/Bild mit lokalem Rückfall', () => {
  const rows = saveDeckRows(7, SAVE_CARDS, (id) => (id === '27204311' ? { name: 'Nibiru', image_url: 'n.jpg' } : null));
  assert.deepEqual(rows, [
    { deck_id: 7, card_id: '14558127', name: 'Asche-Blüte', image_url: 'a.jpg', count: 3, section: 'main', role: 'starter' },
    { deck_id: 7, card_id: '1861629', name: 'Decode Talker', image_url: null, count: 1, section: 'extra' },
    { deck_id: 7, card_id: '27204311', name: 'Nibiru', image_url: 'n.jpg', count: 2, section: 'side' },
  ]);
});

test('Save Deck: löscht, fügt mit role ein und schreibt das geänderte Format', async () => {
  const c = saveClient();
  const res = await saveDeck(c, { deckId: 7, cards: SAVE_CARDS, notes: undefined, format: 'ocg' });
  assert.deepEqual(res, { success: true, roleSaved: true });
  assert.deepEqual(c.calls.deleted, [{ table: 'deck_cards', col: 'deck_id', val: 7 }]);
  assert.equal(c.calls.inserts.length, 1);
  assert.equal(c.calls.inserts[0][0].role, 'starter');
  assert.deepEqual(c.calls.updates, [{ table: 'decks', patch: { format: 'ocg' }, col: 'id', val: 7 }]);
});

test('Save Deck: ohne Format- und Notizänderung kein Update, ohne Sterne keine role-Spalte', async () => {
  const c = saveClient();
  await saveDeck(c, { deckId: 7, cards: [{ ...SAVE_CARDS[0], role: null }] });
  assert.deepEqual(c.calls.updates, []);
  assert.equal('role' in c.calls.inserts[0][0], false);
});

test('Save Deck: fehlt die Spalte role, landen die Karten ohne Sterne statt verloren zu gehen', async () => {
  const c = saveClient({ insertErrors: [{ message: "Could not find the 'role' column of 'deck_cards'" }] });
  const res = await saveDeck(c, { deckId: 7, cards: SAVE_CARDS });
  assert.deepEqual(res, { success: true, roleSaved: false });
  assert.equal(c.calls.inserts.length, 2);
  assert.equal(c.calls.inserts[1].some((r) => 'role' in r), false);
  assert.equal(c.calls.inserts[1].length, 3);
});

test('Save Deck: scheitert auch der Insert ohne role, kommt die Rohmeldung', async () => {
  const c = saveClient({ insertErrors: [{ message: 'kaputt' }, { message: 'immer noch kaputt' }] });
  await assert.rejects(saveDeck(c, { deckId: 7, cards: SAVE_CARDS }), { message: 'immer noch kaputt' });
});

test('Save Deck: fehlt die Spalte format, meldet es "Format konnte nicht gespeichert werden"', async () => {
  const c = saveClient({ updateErrors: { format: { message: "Could not find the 'format' column of 'decks'" } } });
  await assert.rejects(saveDeck(c, { deckId: 7, cards: [], notes: 'Notiz', format: 'free' }), { message: FORMAT_SAVE_FAILED });
  assert.equal(FORMAT_SAVE_FAILED, 'Format konnte nicht gespeichert werden');
  assert.deepEqual(c.calls.updates.map((u) => u.patch), [{ notes: 'Notiz' }, { format: 'free' }]);
});

```

In `desktop/electron/ipc-channels.test.cjs` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```js
for (const ch of [...E1_CHANNELS, ...E2_CHANNELS]) {
  test(`Kanal ${ch} steht in main.cjs und preload.cjs`, () => {
```
durch:
```js
// Spec E3 §10: neuer Kanal fuer die Legalitaet plus die umgebauten Deck-Kanaele (Format, Starter).
const E3_CHANNELS = ['get-catalog-legality', 'get-deck-details'];

for (const ch of [...E1_CHANNELS, ...E2_CHANNELS, ...E3_CHANNELS]) {
  test(`Kanal ${ch} steht in main.cjs und preload.cjs`, () => {
```

In `desktop/src/utils/saveDeckPayload.test.js` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```js
  assert.deepEqual(buildSaveDeckCards({ mainDeck, extraDeck, sideDeck }), [
    { id: '1', type: 'main', quantity: 2, name: 'Karte A', image_url: 'a.jpg' },
    { id: '2', type: 'extra', quantity: 1, name: 'Karte B', image_url: 'b.jpg' },
    { id: '3', type: 'side', quantity: 3, name: 'Karte C', image_url: null },
  ]);
});

```
durch:
```js
  assert.deepEqual(buildSaveDeckCards({ mainDeck, extraDeck, sideDeck }), [
    { id: '1', type: 'main', quantity: 2, name: 'Karte A', image_url: 'a.jpg', role: null },
    { id: '2', type: 'extra', quantity: 1, name: 'Karte B', image_url: 'b.jpg', role: null },
    { id: '3', type: 'side', quantity: 3, name: 'Karte C', image_url: null, role: null },
  ]);
});

// Spec E3 §6: ohne role verliert "Save Deck" (Loeschen + Neu-Einfuegen) jeden Starter-Stern.
test('buildSaveDeckCards: role der Main-Deck-Starter mitgeschickt, in Extra/Side nie', () => {
  const mainDeck = [{ card_id: '1', quantity: 3, name: 'A', image_url: null, role: 'starter' }, { card_id: '4', quantity: 1, name: 'D', image_url: null }];
  const extraDeck = [{ card_id: '2', quantity: 1, name: 'B', image_url: null, role: 'starter' }];
  const sideDeck = [{ card_id: '1', quantity: 1, name: 'A', image_url: null, role: 'starter' }];
  assert.deepEqual(buildSaveDeckCards({ mainDeck, extraDeck, sideDeck }).map((c) => [c.id, c.type, c.role]), [
    ['1', 'main', 'starter'], ['4', 'main', null], ['2', 'extra', null], ['1', 'side', null],
  ]);
});

```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/decks.test.cjs electron/ipc-channels.test.cjs`
Expected: FAIL, `TypeError: saveDeckRows is not a function`, `TypeError: saveDeck is not a function` und `main.cjs fehlt ipcMain.handle('get-catalog-legality'`.
Run (in `desktop/`): `node --test src/utils/saveDeckPayload.test.js` → FAIL (beide Tests: `role` fehlt im Payload).

- [ ] **Step 3: `decks.cjs`**

In `desktop/electron/decks.cjs` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```js

module.exports = { DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck };

```
durch:
```js

const FORMAT_SAVE_FAILED = 'Format konnte nicht gespeichert werden';

// Spec E3 §6 -- Zeilen fuer "Save Deck". role steht nur an Starter-Zeilen des Main Decks: so bleibt ein Deck ohne Sterne
// auch vor decks_format_role.sql speicherbar (supabase-js nennt im Insert nur Spalten, die in einer Zeile vorkommen).
// detailOf(passcode) -> { name, image_url } aus der lokalen Sammlung (Rueckfall, wenn der Renderer nichts mitschickt).
function saveDeckRows(deckId, cards, detailOf = () => null) {
  return (Array.isArray(cards) ? cards : []).map((card) => {
    const det = detailOf(String(card.id)) || {};
    const row = {
      deck_id: deckId, card_id: String(card.id),
      name: card.name || det.name || null,
      image_url: card.image_url || det.image_url || null,
      count: card.quantity || 1,
      section: card.type || 'main',
    };
    if (card.role === 'starter' && row.section === 'main') row.role = 'starter';
    return row;
  });
}

// "Save Deck" (bisher direkt in main.cjs): alle Deckkarten loeschen und neu einfuegen, dann Notizen (Spec E2 §5) und
// Format (Spec E3 §4), jeweils nur, wenn der Renderer sie mitschickt (er tut es nur bei einer Aenderung).
// Spec E3 §8: scheitert der Insert mit Sternen (Spalte role fehlt noch), werden dieselben Zeilen ohne role eingefuegt --
// sonst waeren die Deckkarten nach dem Loeschen verloren; roleSaved = false. Ein gescheitertes Format meldet
// "Format konnte nicht gespeichert werden".
async function saveDeck(client, { deckId, cards, notes, format } = {}, detailOf = () => null) {
  await client.from('deck_cards').delete().eq('deck_id', deckId);
  let roleSaved = true;
  const rows = saveDeckRows(deckId, cards, detailOf);
  if (rows.length) {
    let { error } = await client.from('deck_cards').insert(rows);
    if (error && rows.some((r) => r.role)) {
      ({ error } = await client.from('deck_cards').insert(rows.map(({ role: _role, ...rest }) => rest)));
      if (!error) roleSaved = false;
    }
    if (error) throw new Error(error.message);
  }
  if (notes !== undefined) {
    const { error } = await client.from('decks').update({ notes: notes || null }).eq('id', deckId);
    if (error) throw new Error(error.message);
  }
  if (format !== undefined) {
    const { error } = await client.from('decks').update({ format }).eq('id', deckId);
    if (error) throw new Error(FORMAT_SAVE_FAILED);
  }
  return { success: true, roleSaved };
}

module.exports = {
  DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck,
  FORMAT_SAVE_FAILED, saveDeckRows, saveDeck,
};

```

- [ ] **Step 4: `main.cjs`**

In `desktop/electron/main.cjs` (4 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/4 — ersetzen:
```js
const { collectionSql, parseImportCsv } = require('./collection-query.cjs');
const { setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck } = require('./decks.cjs');
const { catalogPrices, catalogCards, readCatalogCards } = require('./catalog-prices.cjs');
```
durch:
```js
const { collectionSql, parseImportCsv } = require('./collection-query.cjs');
const { setDeckContainer, addMissingToWishlist, moveCopiesToContainer, readYdkFile, createImportedDeck, saveDeck } = require('./decks.cjs');
const { catalogPrices, catalogCards, readCatalogCards, catalogMainId, catalogLegality } = require('./catalog-prices.cjs');
```

Änderung 2/4 — ersetzen:
```js
ipcMain.handle('save-deck', async (event, { deckId, cards, notes }) => {
    const c = await dealsClient();
    await c.from('deck_cards').delete().eq('deck_id', deckId);
    if (cards && cards.length) {
        const lookup = db.prepare('SELECT name, image_url FROM cards WHERE id = ? LIMIT 1');
        const rows = cards.map(card => {
            const det = lookup.get(String(card.id)) || {};
            return {
                deck_id: deckId, card_id: String(card.id),
                name: card.name || det.name || null,
                image_url: card.image_url || det.image_url || null,
                count: card.quantity || 1,
                section: card.type || 'main',
            };
        });
        const { error } = await c.from('deck_cards').insert(rows);
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
durch:
```js
// Spec E3 §6: die Regeln (role an Starter-Zeilen, Rueckfall ohne role, Notizen und Format nur bei Aenderung) wohnen
// in decks.cjs#saveDeck; hier nur Client und lokaler Namens-/Bild-Rueckfall.
ipcMain.handle('save-deck', async (event, { deckId, cards, notes, format }) => {
    const c = await dealsClient();
    const lookup = db.prepare('SELECT name, image_url FROM cards WHERE id = ? LIMIT 1');
    return saveDeck(c, { deckId, cards, notes, format }, (id) => lookup.get(id));
});
```

Änderung 3/4 — ersetzen:
```js
    // Spec E2 §6: "→ Deck" braucht den Kartentyp auch fuer nicht besessene Karten -- Rueckfall auf den Katalog.
    const catalog = readCatalogCards(userDataPath);
    return (data || []).map(dc => {
        const d = detail.get(String(dc.card_id)) || {};
        const cat = (catalog && catalog.get(String(dc.card_id))) || {};
        return {
            deck_id: dc.deck_id, card_id: dc.card_id, type: dc.section, quantity: dc.count,
            name: dc.name || d.name || null, image_url: dc.image_url || d.image_url || null,
```
durch:
```js
    // Spec E2 §6: "→ Deck" braucht den Kartentyp auch fuer nicht besessene Karten -- Rueckfall auf den Katalog
    // (Spec E3 §3: fuer Artwork-Passcodes ueber die Hauptkarte).
    const catalog = readCatalogCards(userDataPath);
    return (data || []).map(dc => {
        const d = detail.get(String(dc.card_id)) || {};
        const cat = (catalog && catalog.get(catalogMainId(userDataPath, dc.card_id))) || {};
        return {
            deck_id: dc.deck_id, card_id: dc.card_id, type: dc.section, quantity: dc.count,
            // Spec E3 §6: Starter-Stern; ohne Spalte role (SQL fehlt) undefined -> null.
            role: dc.role === 'starter' ? 'starter' : null,
            name: dc.name || d.name || null, image_url: dc.image_url || d.image_url || null,
```

Änderung 4/4 — ersetzen:
```js
    const catalog = readCatalogCards(userDataPath);
    return createImportedDeck(c, input, (id) => (catalog && catalog.get(id) ? catalog.get(id).image : null));
});
```
durch:
```js
    const catalog = readCatalogCards(userDataPath);
    // Spec E3 §3: Artwork-Passcodes bekommen das Bild der Hauptkarte; die Deckkarte behaelt den Artwork-Passcode.
    const imageOf = (id) => { const cat = catalog && catalog.get(catalogMainId(userDataPath, id)); return cat ? cat.image : null; };
    return createImportedDeck(c, input, imageOf);
});

// --- Spec E3: Legalitaet & Simulation ---
// Name, Typ und Banlist aller Katalogkarten, Artwork-Zuordnung und Baudatum; ohne (E3-)Katalog available = false.
ipcMain.handle('get-catalog-legality', () => catalogLegality(userDataPath));
```

- [ ] **Step 5: `preload.cjs`**

In `desktop/electron/preload.cjs` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```js
  saveDeck: (deckId, cards, notes) => ipcRenderer.invoke('save-deck', { deckId, cards, notes }),
  getDeckDetails: (deckId) => ipcRenderer.invoke('get-deck-details', deckId),
```
durch:
```js
  saveDeck: (deckId, cards, notes, format) => ipcRenderer.invoke('save-deck', { deckId, cards, notes, format }),
  getDeckDetails: (deckId) => ipcRenderer.invoke('get-deck-details', deckId),
```

Änderung 2/2 — ersetzen:
```js
  createImportedDeck: (data) => ipcRenderer.invoke('create-imported-deck', data),
```
durch:
```js
  createImportedDeck: (data) => ipcRenderer.invoke('create-imported-deck', data),
  // Spec E3: Legalitaet & Simulation
  getCatalogLegality: () => ipcRenderer.invoke('get-catalog-legality'),
```

- [ ] **Step 6: `saveDeckPayload.js`**

In `desktop/src/utils/saveDeckPayload.js` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```js
export function buildSaveDeckCards({ mainDeck, extraDeck, sideDeck }) {
  const map = (list, type) => list.map((c) => ({
    id: c.card_id, type, quantity: c.quantity, name: c.name, image_url: c.image_url,
  }));
```
durch:
```js
// Spec E3 §6: role MUSS ebenso mit -- save-deck loescht alle Deckkarten und fuegt sie neu ein; ohne role waeren die
// Starter-Sterne nach jedem Speichern weg. Starter gibt es nur im Main Deck.
export function buildSaveDeckCards({ mainDeck, extraDeck, sideDeck }) {
  const map = (list, type) => list.map((c) => ({
    id: c.card_id, type, quantity: c.quantity, name: c.name, image_url: c.image_url,
    role: type === 'main' && c.role === 'starter' ? 'starter' : null,
  }));
```

- [ ] **Step 7: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ tests 259`, `ℹ pass 259`, `ℹ fail 0`.
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` → alle Zeilen `PASS`, Exit-Code 0.
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 241`.
Run (in `desktop/`): `npx eslint .` → `5 errors`.

- [ ] **Step 8: Schutz-Nachweis**

(a) Rückfall ohne `role`: in `saveDeck` `    if (error && rows.some((r) => r.role)) {` kurz zu `    if (false) {` → `✖ Save Deck: fehlt die Spalte role, landen die Karten ohne Sterne statt verloren zu gehen` und `✖ Save Deck: scheitert auch der Insert ohne role, kommt die Rohmeldung` (gemessen).
(b) Payload trägt `role`: in `buildSaveDeckCards` `    role: type === 'main' && c.role === 'starter' ? 'starter' : null,` kurz zu `    role: null,` → `✖ buildSaveDeckCards: role der Main-Deck-Starter mitgeschickt, in Extra/Side nie` (gemessen).
(c) Kanal in beiden Dateien: in `preload.cjs` die Zeile `  getCatalogLegality: () => ipcRenderer.invoke('get-catalog-legality'),` kurz löschen → `✖ Kanal get-catalog-legality steht in main.cjs und preload.cjs` (gemessen).
Jeweils zitieren und zurücknehmen. Im Bericht die Aufrufer-Analyse aus Plan-Ergänzung 13 bestätigen (`save-deck`, `buildSaveDeckCards`, `get-deck-details`, `create-imported-deck` per Suche im Renderer).

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/decks.cjs desktop/electron/decks.test.cjs desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/ipc-channels.test.cjs desktop/src/utils/saveDeckPayload.js desktop/src/utils/saveDeckPayload.test.js
git commit -m "feat(e3): Save Deck trägt role und format (Rückfall ohne role), Legalitäts-Kanal, Bild/Typ über die Hauptkarte

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Desktop-Oberfläche — Format, Badge, Banlist-Icons, Starter-Stern, Seitenleiste, Kopien-Grenze

**Files:**
- Create: `desktop/src/components/DeckLegalityBadge.jsx`
- Create: `desktop/src/components/DeckBanIcon.jsx`
- Create: `desktop/src/components/DeckSidebar.jsx`
- Modify: `desktop/src/components/DeckBuilder.jsx`

**Interfaces:**
- Produces: `<DeckLegalityBadge result format showFormat? />` (result `null` → „…"), `<DeckBanIcon ban />`, `<DeckSidebar mainDeck extraDeck sideDeck legality builtAt />` (Reiter Statistik/Simulation/Verstöße; enthält `DeckStats`).
- Consumes: Task 3 (`deckLegality`, `badgeText`, `badgeKind`, `banOf`, `canAddCopy`, `normalizeFormat`, `FORMATS`, `FORMAT_LABELS`, `BAN_LABELS`, `COPY_LIMIT`, `banlistDateText`), Task 4 (`oddsTexts`, `drawHand`, `NO_MAIN`), Task 5 (`getCatalogLegality`, `saveDeck(…, format)`, `role` aus `getDeckDetails`), vorhanden `CustomSelect`, `LOADING`.

- [ ] **Step 1: `DeckLegalityBadge.jsx` anlegen**

```jsx
import { LOADING } from '../utils/deckCoverage';
import { FORMAT_LABELS, badgeKind, badgeText, normalizeFormat } from '../utils/deckLegality';

const KIND_CLASSES = {
  legal: 'bg-good/15 text-good border-good/40',
  warn: 'bg-warn/15 text-warn border-warn/40',
  crit: 'bg-crit/15 text-crit border-crit/40',
  free: 'bg-gray-700/40 text-gray-300 border-gray-600',
};

// Spec E3 §7 — Format-Chip und Legalitaets-Badge (gruen "Legal", gelb "Legal · n Warnungen", rot "n Verstöße",
// grau "Frei"). result null = Katalog-Index noch nicht geladen: "…", nie ein vorlaeufiges "Legal".
export default function DeckLegalityBadge({ result, format, showFormat = false }) {
  const f = normalizeFormat(format);
  return (
    <span className="inline-flex items-center gap-1.5">
      {showFormat && (
        <span className="px-1.5 py-0.5 rounded border border-gray-700 text-[10px] font-mono text-gray-400">{FORMAT_LABELS[f]}</span>
      )}
      {result ? (
        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${KIND_CLASSES[badgeKind(result, f)]}`}>{badgeText(result, f)}</span>
      ) : (
        <span className="text-[10px] text-gray-500">{LOADING}</span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: `DeckBanIcon.jsx` anlegen**

```jsx
import { BAN_LABELS } from '../utils/deckLegality';

const BAN_CLASSES = {
  forbidden: 'bg-crit text-white',
  limited: 'bg-orange-500 text-white',
  semi: 'bg-warn text-black',
};

// Spec E3 §7 — Banlist-Icon an der Kartenzeile: rot "Verboten", orange "1", gelb "2"; uneingeschraenkt kein Icon.
export default function DeckBanIcon({ ban }) {
  if (!ban) return null;
  return (
    <span className={`px-1.5 rounded text-[10px] font-bold leading-4 flex-shrink-0 ${BAN_CLASSES[ban]}`}>{BAN_LABELS[ban]}</span>
  );
}
```

- [ ] **Step 3: `DeckSidebar.jsx` anlegen**

`DeckStats` wird aus `DeckBuilder.jsx` unverändert übernommen (nur zweite Zeile des Rasters → einspaltig mit festen Höhen).

```jsx
import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { LOADING } from '../utils/deckCoverage';
import { NO_MAIN, drawHand, oddsTexts } from '../utils/deckOdds';
import { banlistDateText } from '../utils/deckLegality';

const TABS = [['stats', 'Statistik'], ['simulation', 'Simulation'], ['violations', 'Verstöße']];

// Spec E3 §7 — Seitenleiste neben dem Editor: Statistik (wie bisher), Simulation (§6), Verstöße (§4 plus Banlist-Stand).
// Alles aus dem ungespeicherten Editor-Stand. legality null = Katalog-Index noch nicht geladen.
export default function DeckSidebar({ mainDeck, extraDeck, sideDeck, legality, builtAt }) {
  const [tab, setTab] = useState('stats');
  return (
    <div className="w-80 flex-shrink-0 bg-[#1E1E1E] p-4 rounded-2xl border border-gray-800 flex flex-col min-h-0">
      <div className="flex gap-1 mb-4">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)}
            className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium ${tab === value ? 'bg-space-violet text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {tab === 'stats' && <DeckStats mainDeck={mainDeck} extraDeck={extraDeck} sideDeck={sideDeck} />}
        {tab === 'simulation' && <DeckSimulation mainDeck={mainDeck} />}
        {tab === 'violations' && <DeckViolations legality={legality} builtAt={builtAt} />}
      </div>
    </div>
  );
}

function DeckSimulation({ mainDeck }) {
  const [hand, setHand] = useState(null);
  const odds = oddsTexts(mainDeck);
  const draw = (size) => setHand(drawHand(mainDeck, size));
  return (
    <div className="space-y-4">
      {odds.message ? (
        <p className="text-sm text-gray-400">{odds.message}</p>
      ) : (
        odds.lines.map((line) => (
          <div key={line.size} className="p-3 bg-black/30 rounded-xl border border-gray-800">
            <div className="text-sm text-white">{line.atLeastOne}</div>
            <div className="text-xs font-mono text-gray-400 mt-1">{line.distribution}</div>
          </div>
        ))
      )}
      <div className="flex gap-2">
        {[5, 6].map((size) => (
          <button key={size} type="button" onClick={() => draw(size)}
            className="flex-1 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs border border-gray-700">
            Testhand ziehen ({size})
          </button>
        ))}
      </div>
      {hand && hand.length === 0 && <p className="text-sm text-gray-400">{NO_MAIN}</p>}
      {hand && hand.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {hand.map((card, idx) => (
            <div key={idx} className={`aspect-[2/3] rounded overflow-hidden border-2 ${card.role === 'starter' ? 'border-warn' : 'border-gray-700'}`}>
              <img src={card.image_url} alt={card.name || ''} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeckViolations({ legality, builtAt }) {
  if (!legality) return <p className="text-sm text-gray-400">{LOADING}</p>;
  const date = banlistDateText(builtAt);
  return (
    <div className="space-y-2">
      {legality.violations.length === 0 && legality.warnings.length === 0 && <p className="text-sm text-gray-400">Keine Verstöße</p>}
      {legality.violations.map((v, i) => <p key={`v${i}`} className="text-sm text-crit">{v.text}</p>)}
      {legality.warnings.map((w, i) => <p key={`w${i}`} className="text-sm text-warn">{w.text}</p>)}
      {date && <p className="pt-2 text-xs text-gray-500">{date}</p>}
    </div>
  );
}

const DeckStats = ({ mainDeck, extraDeck, sideDeck }) => {
    const allCards = [...mainDeck, ...extraDeck, ...sideDeck];
    // Type breakdown (Monster, Spell, Trap) - Main Deck Only usually matters for ratios
    let monsters = 0, spells = 0, traps = 0;
    mainDeck.forEach(c => {
        if (c.type && c.type.includes('Monster')) monsters += c.quantity;
        else if (c.type && c.type.includes('Spell')) spells += c.quantity;
        else if (c.type && c.type.includes('Trap')) traps += c.quantity;
    });

    const typeData = [
        { name: 'Monster', value: monsters, color: '#A68349' }, // Orange/Brown
        { name: 'Spell', value: spells, color: '#1D9E74' },   // Green
        { name: 'Trap', value: traps, color: '#BC5A84' }     // Pink
    ].filter(d => d.value > 0);

    // Attribute breakdown (All cards)
    const attrCounts = {};
    allCards.forEach(c => {
        if (c.attribute) {
            attrCounts[c.attribute] = (attrCounts[c.attribute] || 0) + c.quantity;
        }
    });
    const attrData = Object.keys(attrCounts).map(k => ({ name: k, value: attrCounts[k] }));

    return (
        <div className="grid grid-cols-1 gap-4">
            <div className="bg-black/30 p-4 rounded-xl border border-gray-800 h-56">
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Card Types (Main)</h4>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                            {typeData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                            ))}
                        </Pie>
                        <RechartsTooltip contentStyle={{ backgroundColor: '#1E1E1E', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <div className="bg-black/30 p-4 rounded-xl border border-gray-800 h-56">
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Attributes</h4>
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={attrData}>
                        <XAxis dataKey="name" stroke="#666" fontSize={10} />
                        <YAxis stroke="#666" fontSize={10} />
                        <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ backgroundColor: '#1E1E1E', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
                        <Bar dataKey="value" fill="#9D00FF" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
```

- [ ] **Step 4: `DeckBuilder.jsx` anpassen**

Die letzte Änderung löscht die Komponente `DeckStats` am Dateiende (sie wohnt jetzt in `DeckSidebar.jsx`). Hinweis React Compiler (Lint): `addToDeck` darf nicht auf `activeCards` zugreifen (später deklariertes `useMemo` → „Existing memoization could not be preserved"); deshalb baut es seine Zählliste selbst.

In `desktop/src/components/DeckBuilder.jsx` (26 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/26 — ersetzen:
```jsx
import { Trash2, Save, FileUp, BarChart2, PieChart as PieChartIcon, Play } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { LOADING, boxLabel, deckCoverage, listText } from '../utils/deckCoverage';
```
durch:
```jsx
import { Trash2, Save, FileUp, Star } from 'lucide-react';
import { LOADING, boxLabel, deckCoverage, listText } from '../utils/deckCoverage';
```

Änderung 2/26 — ersetzen:
```jsx
import { buildSaveDeckCards } from '../utils/saveDeckPayload';
```
durch:
```jsx
import { buildSaveDeckCards } from '../utils/saveDeckPayload';
import CustomSelect from './CustomSelect';
import DeckSidebar from './DeckSidebar';
import DeckLegalityBadge from './DeckLegalityBadge';
import DeckBanIcon from './DeckBanIcon';
import { COPY_LIMIT, FORMATS, FORMAT_LABELS, banOf, canAddCopy, deckLegality, normalizeFormat } from '../utils/deckLegality';

const FORMAT_OPTIONS = FORMATS.map((f) => ({ value: f, label: FORMAT_LABELS[f] }));
```

Änderung 3/26 — ersetzen:
```jsx
  const [filter, setFilter] = useState('');
  const [showStats, setShowStats] = useState(false);
  const [testHand, setTestHand] = useState([]);
  const [showTestHand, setShowTestHand] = useState(false);
```
durch:
```jsx
  const [filter, setFilter] = useState('');
  // Spec E3: Format des offenen Decks (gespeichert mit "Save Deck"), Katalog-Index fuer die Legalitaet (null = laedt),
  // Meldung der Kopien-Grenze beim Hinzufuegen.
  const [format, setFormat] = useState('tcg');
  const [legalityData, setLegalityData] = useState(null);
  const [limitMessage, setLimitMessage] = useState(null);
```

Änderung 4/26 — ersetzen:
```jsx
        fetchCoverageData().then(setCoverageData).catch((e) => setCoverageError(e.message || String(e)));
```
durch:
```jsx
        fetchCoverageData().then(setCoverageData).catch((e) => setCoverageError(e.message || String(e)));
        window.api.getCatalogLegality().then(setLegalityData);
```

Änderung 5/26 — ersetzen:
```jsx
  const ready = decksLoaded && !!coverageData;
```
durch:
```jsx
  const ready = decksLoaded && !!coverageData;
  // Spec E3 §3/§8: ohne (E3-)Katalog null -> "Katalog fehlt – Banlist unbekannt", keine Icons, Artworks einzeln.
  const legalityCatalog = useMemo(() => (legalityData && legalityData.available
      ? { aliases: legalityData.aliases, cards: legalityData.cards } : null), [legalityData]);
```

Änderung 6/26 — ersetzen:
```jsx
  const handleCreateDeck = async (e) => {
```
durch:
```jsx
  // Spec E3 §7: Badge der Deck-Liste aus den gespeicherten Deckkarten und dem gespeicherten Format.
  const listLegality = useMemo(() => {
      if (!ready || !legalityData) return null;
      const byDeck = new Map();
      for (const dc of coverageData.deckCards) {
          if (!byDeck.has(dc.deck_id)) byDeck.set(dc.deck_id, []);
          byDeck.get(dc.deck_id).push(dc);
      }
      return new Map(decks.map((d) => [d.id, deckLegality(byDeck.get(d.id) || [], d.format, legalityCatalog)]));
  }, [ready, coverageData, decks, legalityData, legalityCatalog]);

  const handleCreateDeck = async (e) => {
```

Änderung 7/26 — ersetzen:
```jsx
          setMainDeck([]);
```
durch:
```jsx
          setFormat(normalizeFormat(newDeck.format));
          setMainDeck([]);
```

Änderung 8/26 — ersetzen:
```jsx
          setNotes(deck.notes || '');
```
durch:
```jsx
          setNotes(deck.notes || '');
          setFormat(normalizeFormat(deck.format));
          setLimitMessage(null);
```

Änderung 9/26 — ersetzen:
```jsx
      try {
          await window.api.saveDeck(deckId, allCards, notesChanged ? notes : undefined);
      } catch (e) {
```
durch:
```jsx
      // Spec E3 §4/§8: Format nur mitschicken, wenn es sich geaendert hat (vor decks_format_role.sql zaehlt alles als TCG).
      const formatChanged = format !== normalizeFormat(activeDeck.format);
      try {
          await window.api.saveDeck(deckId, allCards, notesChanged ? notes : undefined, formatChanged ? format : undefined);
      } catch (e) {
```

Änderung 10/26 — ersetzen:
```jsx
          setActiveDeck((prev) => (prev?.id === deckId ? { ...prev, notes } : prev));
```
durch:
```jsx
          setActiveDeck((prev) => (prev?.id === deckId ? { ...prev, notes } : prev));
      }
      if (formatChanged) {
          setDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, format } : d)));
          setActiveDeck((prev) => (prev?.id === deckId ? { ...prev, format } : prev));
```

Änderung 11/26 — ersetzen:
```jsx
  const drawTestHand = () => {
      // Create a flat array of all main deck cards based on quantity
      const deck = [];
      mainDeck.forEach(c => {
          for (let i = 0; i < c.quantity; i++) deck.push(c);
      });

      if (deck.length < 5) {
          alert("Main deck must have at least 5 cards.");
          return;
      }

      // Shuffle and pick 5
      const shuffled = [...deck].sort(() => 0.5 - Math.random());
      setTestHand(shuffled.slice(0, 5));
      setShowTestHand(true);
  };

  const addToDeck = (card) => {
```
durch:
```jsx
  const addToDeck = (card) => {
```

Änderung 12/26 — ersetzen:
```jsx
      // Check limit (3 copies)
      const existing = targetDeck.find(c => c.card_id === card.id);
      if (existing) {
          if (existing.quantity >= 3) return;
          setTarget(prev => prev.map(c => c.card_id === card.id ? { ...c, quantity: c.quantity + 1 } : c));
```
durch:
```jsx
      // Spec E3 §5: hoechstens 3 Kopien je Karte ueber alle Abschnitte (Haupt-Passcode), im Format "Frei" ohne Grenze.
      const current = [...mainDeck, ...extraDeck, ...sideDeck].map((c) => ({ card_id: String(c.card_id), count: c.quantity }));
      if (!canAddCopy(current, card.id, format, legalityCatalog ? legalityCatalog.aliases : null)) {
          setLimitMessage(COPY_LIMIT);
          return;
      }
      setLimitMessage(null);
      const existing = targetDeck.find(c => c.card_id === card.id);
      if (existing) {
          setTarget(prev => prev.map(c => c.card_id === card.id ? { ...c, quantity: c.quantity + 1 } : c));
```

Änderung 13/26 — ersetzen:
```jsx
      removeFromDeck(card.card_id, from);
      setTo((prev) => (prev.some((c) => c.card_id === card.card_id)
          ? prev.map((c) => (c.card_id === card.card_id ? { ...c, quantity: c.quantity + 1 } : c))
          : [...prev, { ...card, quantity: 1 }]));
  };
```
durch:
```jsx
      removeFromDeck(card.card_id, from);
      // Spec E3 §6: Starter gibt es nur im Main Deck -- eine verschobene Kopie nimmt den Stern nicht mit.
      setTo((prev) => (prev.some((c) => c.card_id === card.card_id)
          ? prev.map((c) => (c.card_id === card.card_id ? { ...c, quantity: c.quantity + 1 } : c))
          : [...prev, { ...card, quantity: 1, role: null }]));
  };

  // Spec E3 §6: Starter-Stern an Main-Deck-Zeilen (gespeichert mit "Save Deck").
  const toggleStarter = (cardId) => setMainDeck((prev) => prev.map((c) => (
      c.card_id === cardId ? { ...c, role: c.role === 'starter' ? null : 'starter' } : c)));
```

Änderung 14/26 — ersetzen:
```jsx
  const openFillBox = () => setDialog({
```
durch:
```jsx
  // Spec E3 §7: Legalitaet aus dem UNGESPEICHERTEN Editor-Stand; null, solange der Katalog-Index laedt.
  const legalityCards = useMemo(() => [
      ...mainDeck.map((c) => ({ card_id: String(c.card_id), name: c.name, count: c.quantity, section: 'main' })),
      ...extraDeck.map((c) => ({ card_id: String(c.card_id), name: c.name, count: c.quantity, section: 'extra' })),
      ...sideDeck.map((c) => ({ card_id: String(c.card_id), name: c.name, count: c.quantity, section: 'side' })),
  ], [mainDeck, extraDeck, sideDeck]);
  const activeLegality = useMemo(() => (legalityData ? deckLegality(legalityCards, format, legalityCatalog) : null),
      [legalityCards, format, legalityData, legalityCatalog]);
  const banFor = (cardId) => banOf(cardId, format, legalityCatalog);

  const openFillBox = () => setDialog({
```

Änderung 15/26 — ersetzen:
```jsx
  });

  // Stats Components
  const deckStatsProps = { mainDeck, extraDeck, sideDeck };
```
durch:
```jsx
  });
```

Änderung 16/26 — ersetzen:
```jsx
                                <span className="block truncate">{deck.name}</span>
                                <span className="block truncate text-[11px] font-mono text-gray-500">
```
durch:
```jsx
                                <span className="flex items-center gap-2 min-w-0">
                                    <span className="truncate">{deck.name}</span>
                                    <DeckLegalityBadge showFormat format={deck.format} result={listLegality ? listLegality.get(deck.id) : null} />
                                </span>
                                <span className="block truncate text-[11px] font-mono text-gray-500">
```

Änderung 17/26 — ersetzen:
```jsx
                </div>
                <div className="mb-4">
```
durch:
```jsx
                    {limitMessage && <span className="text-crit">{limitMessage}</span>}
                </div>
                <div className="mb-4">
```

Änderung 18/26 — ersetzen:
```jsx
                            <button
                                onClick={() => setShowStats(!showStats)}
                                className={`p-1.5 rounded-lg transition-colors ${showStats ? 'bg-space-violet text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                                title="Toggle Stats"
                            >
                                {showStats ? <PieChartIcon className="w-4 h-4" /> : <BarChart2 className="w-4 h-4" />}
                            </button>
                        </div>
                        <div className="flex gap-2">
                             <button onClick={drawTestHand} className="flex items-center px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors text-sm font-medium border border-gray-700">
                                <Play className="w-4 h-4 mr-2" />
                                Test Hand
                            </button>
                            <DeckExportMenu deckName={activeDeck.name} entries={exportEntries} />
```
durch:
```jsx
                            <CustomSelect className="w-24" value={format} onChange={(f) => { setFormat(normalizeFormat(f)); setLimitMessage(null); }} options={FORMAT_OPTIONS} />
                            <DeckLegalityBadge format={format} result={activeLegality} />
                        </div>
                        <div className="flex gap-2">
                            <DeckExportMenu deckName={activeDeck.name} entries={exportEntries} />
```

Änderung 19/26 — ersetzen:
```jsx
                    {showStats && <DeckStats {...deckStatsProps} />}

                    {showTestHand && (
                        <div className="mb-6 p-4 bg-black/40 rounded-xl border border-gray-800 animate-in fade-in slide-in-from-top-4">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-sm font-bold text-white">Opening Hand (5 Cards)</h3>
                                <div className="flex gap-2">
                                    <button onClick={drawTestHand} className="text-xs text-space-violet hover:underline">Redraw</button>
                                    <button onClick={() => setShowTestHand(false)} className="text-xs text-gray-500 hover:text-white">Close</button>
                                </div>
                            </div>
                            <div className="flex gap-2 justify-center">
                                {testHand.map((card, idx) => (
                                    <div key={idx} className="w-20 aspect-[2/3] relative group animate-in zoom-in duration-300" style={{ animationDelay: `${idx * 50}ms` }}>
                                        <img src={card.image_url} alt="" className="w-full h-full object-cover rounded border border-gray-700 shadow-lg" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
```
durch:
```jsx
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 pr-2">
```

Änderung 20/26 — ersetzen:
```jsx
                                {mainDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="main" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} />)}
                            </div>
```
durch:
```jsx
                                {mainDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="main" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} onToggleStarter={toggleStarter} />)}
                            </div>
```

Änderung 21/26 — ersetzen:
```jsx
                                {extraDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="extra" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} />)}
                            </div>
```
durch:
```jsx
                                {extraDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="extra" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} />)}
                            </div>
```

Änderung 22/26 — ersetzen:
```jsx
                                {sideDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="side" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} />)}
                            </div>
```
durch:
```jsx
                                {sideDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="side" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} />)}
                            </div>
```

Änderung 23/26 — ersetzen:
```jsx
            )}
        </div>
```
durch:
```jsx
            )}
        </div>

        {activeDeck && (
            <DeckSidebar mainDeck={mainDeck} extraDeck={extraDeck} sideDeck={sideDeck} legality={activeLegality}
                builtAt={legalityData && legalityData.available ? legalityData.builtAt : null} />
        )}
```

Änderung 24/26 — ersetzen:
```jsx
const DeckCardRow = ({ card, type, numbers, removeFromDeck, onMove }) => {
    const missing = !!numbers && numbers.missing > 0;
```
durch:
```jsx
// Spec E3 §7: Banlist-Icon nach Format; Main-Deck-Zeilen mit Starter-Stern (onToggleStarter nur dort).
const DeckCardRow = ({ card, type, numbers, removeFromDeck, onMove, ban, onToggleStarter }) => {
    const missing = !!numbers && numbers.missing > 0;
```

Änderung 25/26 — ersetzen:
```jsx
            </div>
            <div className="flex items-center gap-2">
                <DeckCardNumbers card={numbers} />
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(card, type); }}
```
durch:
```jsx
                <DeckBanIcon ban={ban} />
            </div>
            <div className="flex items-center gap-2">
                <DeckCardNumbers card={numbers} />
                {onToggleStarter && (
                    <button type="button" title="Starter" onClick={(e) => { e.stopPropagation(); onToggleStarter(card.card_id); }}
                        className={card.role === 'starter' ? 'text-warn' : 'text-gray-600 hover:text-gray-300'}>
                        <Star className="w-4 h-4" fill={card.role === 'starter' ? 'currentColor' : 'none'} />
                    </button>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); onMove(card, type); }}
```

Änderung 26/26 — ersetzen:
```jsx
};

const DeckStats = ({ mainDeck, extraDeck, sideDeck }) => {
    const allCards = [...mainDeck, ...extraDeck, ...sideDeck];
    // Type breakdown (Monster, Spell, Trap) - Main Deck Only usually matters for ratios
    let monsters = 0, spells = 0, traps = 0;
    mainDeck.forEach(c => {
        if (c.type && c.type.includes('Monster')) monsters += c.quantity;
        else if (c.type && c.type.includes('Spell')) spells += c.quantity;
        else if (c.type && c.type.includes('Trap')) traps += c.quantity;
    });

    const typeData = [
        { name: 'Monster', value: monsters, color: '#A68349' }, // Orange/Brown
        { name: 'Spell', value: spells, color: '#1D9E74' },   // Green
        { name: 'Trap', value: traps, color: '#BC5A84' }     // Pink
    ].filter(d => d.value > 0);

    // Attribute breakdown (All cards)
    const attrCounts = {};
    allCards.forEach(c => {
        if (c.attribute) {
            attrCounts[c.attribute] = (attrCounts[c.attribute] || 0) + c.quantity;
        }
    });
    const attrData = Object.keys(attrCounts).map(k => ({ name: k, value: attrCounts[k] }));

    return (
        <div className="grid grid-cols-2 gap-4 h-64 mb-4">
            <div className="bg-black/30 p-4 rounded-xl border border-gray-800">
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Card Types (Main)</h4>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                            {typeData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                            ))}
                        </Pie>
                        <RechartsTooltip contentStyle={{ backgroundColor: '#1E1E1E', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <div className="bg-black/30 p-4 rounded-xl border border-gray-800">
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Attributes</h4>
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={attrData}>
                        <XAxis dataKey="name" stroke="#666" fontSize={10} />
                        <YAxis stroke="#666" fontSize={10} />
                        <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ backgroundColor: '#1E1E1E', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
                        <Bar dataKey="value" fill="#9D00FF" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
```
durch:
```jsx
};

```

- [ ] **Step 5: Lint, Helfer, Build**

Run (in `desktop/`): `npx eslint .` → `5 errors` (3 Warnungen, unverändert).
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 241`.
Run (in `desktop/`): `npx vite build` → `✓ built`.

- [ ] **Step 6: Kein neuer Schutz-Test**

Oberfläche ohne automatische Tests (Plan-Ergänzung 19); die Regeln sind in Task 3–5 geschützt. Im Bericht per Suche bestätigen: kein Aufruf von `drawTestHand`, `showStats`, `testHand` bleibt; `canAddCopy` ist die einzige Kopien-Grenze in `addToDeck`.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/DeckLegalityBadge.jsx desktop/src/components/DeckBanIcon.jsx desktop/src/components/DeckSidebar.jsx desktop/src/components/DeckBuilder.jsx
git commit -m "feat(e3): Desktop-Deckbuilder mit Format, Legalitäts-Badge, Banlist-Icons, Starter-Stern und Seitenleiste Statistik/Simulation/Verstöße

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Kotlin-Zwillinge `DeckImport.canonicalPasscode`/Auflösung und `DeckLegality`

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ml/DeckImport.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/DeckLegality.kt`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/DeckImportTest.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/DeckLegalityTest.kt`

**Interfaces:**
- Produces (für Task 8–10): `DeckImport.canonicalPasscode(passcode, aliases: Map<String, String>?)`, `DeckImport.resolve(parsed, catalog, aliases = null)`, `DeckImport.prepare(text, format, loadAliases = { emptyMap() }, loadCatalog)`. In `DeckLegality.kt`: `LegalityInfo(name, type, banTcg, banOcg)`, `LegalityCatalog(aliases, cards, builtAt = null)`, `LegalityCard(cardId, name, count, section)`, `LegalityIssue(rule: Int?, cardId, text)`, `LegalityResult(legal, violations, warnings)`, `object DeckLegality { FORMATS, FORMAT_LABELS, CATALOG_MISSING_BANLIST, COPY_LIMIT, FORMAT_SAVE_FAILED, BAN_LABELS, normalizeFormat, banOf, check, violationCountText, badgeText, badgeKind, banlistDateText, canAddCopy }` (JS `deckLegality` ↔ Kotlin `check`).
- Consumes (Task 2, 3): `import.json`, `legality.json`.

- [ ] **Step 1: Tests schreiben**

In `android/app/src/test/java/com/example/yugiohscanner/DeckImportTest.kt` (4 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/4 — ersetzen:
```kotlin
        CatalogNameRow(it.get("id").toString(), str(it, "name_de"), str(it, "name_en"), str(it, "type"))
    }
```
durch:
```kotlin
        CatalogNameRow(it.get("id").toString(), str(it, "name_de"), str(it, "name_en"), str(it, "type"))
    }
    private val aliases: Map<String, String> = fix.getJSONObject("aliases").let { o -> o.keys().asSequence().associateWith { o.getString(it) } }
```

Änderung 2/4 — ersetzen:
```kotlin
            val resolved = DeckImport.resolve(parsed, if (c.getBoolean("catalog")) catalog else null)
            val e = c.getJSONObject("expected")
```
durch:
```kotlin
            val resolved = DeckImport.resolve(parsed, if (c.getBoolean("catalog")) catalog else null, if (c.optBoolean("aliases")) aliases else null)
            val e = c.getJSONObject("expected")
```

Änderung 3/4 — ersetzen:
```kotlin
    @Test fun `Fixture Texte`() {
```
durch:
```kotlin
    // Spec E3 §3 -- aliases[p] ?: p; ohne Zuordnung (kein Katalog) steht jeder Passcode fuer sich.
    @Test fun `Fixture Haupt-Passcode ueber die Artwork-Zuordnung`() {
        for (c in fix.getJSONArray("canonical").objects()) {
            assertEquals(c.toString(), c.getString("expected"), DeckImport.canonicalPasscode(c.getString("passcode"), if (c.getBoolean("aliases")) aliases else null))
        }
    }

    @Test fun `Fixture Texte`() {
```

Änderung 4/4 — ersetzen:
```kotlin
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
durch:
```kotlin
        val ydke = DeckImport.prepare("ydke://ryPeAA==!!!", null, loadCatalog = load)
        assertEquals(listOf(listOf("14558127")), calls)
        assertEquals("ok", ydke.resolved!!.rows[0].status)
        val text = DeckImport.prepare("3 Raigeki", null, loadCatalog = load)
        assertEquals(null, calls[1])
        assertEquals(listOf("12580477"), text.resolved!!.rows[0].candidates.map { it.passcode })
        assertEquals("Kein gültiger YDKE-Link", DeckImport.prepare("ydke://kaputt", null, loadCatalog = load).error)
        assertEquals("Keine Deckliste erkannt", DeckImport.prepare("3 Raigeki", "ydk", loadCatalog = load).error)
        assertEquals("ohne gelesene Karte kein Katalogzugriff", 2, calls.size)
        assertEquals(true, DeckImport.prepare("3 Raigeki", null) { null }.resolved!!.catalogMissing)
    }

    // Spec E3 §3 -- erst die Zuordnung der gelesenen Passcodes, dann die Hauptkarten; die Deckkarte behaelt den Artwork-Passcode.
    @Test fun `Vorschau vorbereiten loest Artwork-Passcodes ueber die Zuordnung auf`() {
        val loaded = mutableListOf<List<String>?>()
        val prepared = DeckImport.prepare("#main\n46986415\n", null, { ids -> aliases.filterKeys { it in ids } }) { ids -> loaded.add(ids); catalog }
        assertEquals(listOf(listOf("46986414")), loaded)
        assertEquals(listOf(ImportCandidate("46986415", "Dunkler Magier", "Normal Monster")), prepared.resolved!!.rows[0].candidates)
        val old = DeckImport.prepare("#main\n46986415\n", null) { catalog }
        assertEquals("ohne Zuordnung (alter Katalog)", "unknownPasscode", old.resolved!!.rows[0].status)
    }
}
```

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.DeckLegality
import com.example.yugiohscanner.ml.LegalityCard
import com.example.yugiohscanner.ml.LegalityCatalog
import com.example.yugiohscanner.ml.LegalityInfo
import com.example.yugiohscanner.ml.LegalityIssue
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/deckLegality.test.js -- dieselbe Fixture docs/fixtures/decks/legality.json. */
class DeckLegalityTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/legality.json"))
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)

    private val catalog: LegalityCatalog = fix.getJSONObject("catalog").let { c ->
        val a = c.getJSONObject("aliases")
        val cards = c.getJSONObject("cards")
        LegalityCatalog(
            aliases = a.keys().asSequence().associateWith { a.getString(it) },
            cards = cards.keys().asSequence().associateWith { id ->
                val o = cards.getJSONObject(id)
                LegalityInfo(str(o, "name"), str(o, "type"), str(o, "ban_tcg"), str(o, "ban_ocg"))
            },
        )
    }

    private fun rows(arr: JSONArray): List<LegalityCard> =
        arr.objects().map { LegalityCard(it.getString("card_id"), str(it, "name"), it.getInt("count"), it.getString("section")) }

    private fun issues(arr: JSONArray, withRule: Boolean): List<LegalityIssue> = arr.objects().map {
        LegalityIssue(if (withRule) it.getInt("rule") else null, str(it, "cardId"), it.getString("text"))
    }

    @Test fun `Fixture Legalitaet und Badge`() {
        val bases = fix.getJSONObject("bases")
        for (c in fix.getJSONArray("legality").objects()) {
            val name = c.getString("name")
            val base = c.getJSONArray("base")
            val cards = (0 until base.length()).flatMap { rows(bases.getJSONArray(base.getString(it))) } + rows(c.getJSONArray("cards"))
            val format = str(c, "format")
            val result = DeckLegality.check(cards, format, if (c.getBoolean("catalog")) catalog else null)
            val e = c.getJSONObject("expected")
            assertEquals("$name violations", issues(e.getJSONArray("violations"), true), result.violations)
            assertEquals("$name warnings", issues(e.getJSONArray("warnings"), false), result.warnings)
            assertEquals("$name legal", e.getBoolean("legal"), result.legal)
            assertEquals("$name badge", e.getString("badge"), DeckLegality.badgeText(result, format))
            assertEquals("$name badgeKind", e.getString("badgeKind"), DeckLegality.badgeKind(result, format))
        }
    }

    @Test fun `Fixture Formate, Banlist-Stufe, Banlist-Stand, Anzahl Verstoesse`() {
        for (f in fix.getJSONArray("formats").objects()) {
            val n = DeckLegality.normalizeFormat(str(f, "format"))
            assertEquals(f.toString(), f.getString("normalized"), n)
            assertEquals(f.getString("label"), DeckLegality.FORMAT_LABELS[n])
        }
        for (b in fix.getJSONArray("ban").objects()) {
            val ban = DeckLegality.banOf(b.getString("passcode"), b.getString("format"), if (b.getBoolean("catalog")) catalog else null)
            assertEquals(b.toString(), str(b, "expected"), ban)
            assertEquals(b.toString(), str(b, "label"), ban?.let { DeckLegality.BAN_LABELS[it] })
        }
        for (d in fix.getJSONArray("banlistDate").objects()) assertEquals(d.toString(), str(d, "text"), DeckLegality.banlistDateText(str(d, "builtAt")))
        for (v in fix.getJSONArray("violationCount").objects()) assertEquals(v.getString("text"), DeckLegality.violationCountText(v.getInt("n")))
    }

    @Test fun `Fixture Kopien-Grenze`() {
        for (c in fix.getJSONArray("canAddCopy").objects()) {
            assertEquals(
                c.getString("name"), c.getBoolean("expected"),
                DeckLegality.canAddCopy(rows(c.getJSONArray("cards")), c.getString("passcode"), str(c, "format"), if (c.getBoolean("aliases")) catalog.aliases else null),
            )
        }
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest`
Expected: FAIL in `compileDebugUnitTestKotlin` mit `Unresolved reference 'DeckLegality'` (bzw. `'LegalityCard'`, `'canonicalPasscode'`, `No parameter with name 'loadCatalog'`).

- [ ] **Step 3: `ml/DeckImport.kt`**

In `android/app/src/main/java/com/example/yugiohscanner/ml/DeckImport.kt` (4 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/4 — ersetzen:
```kotlin
    fun normalizeName(s: String?): String {
```
durch:
```kotlin
    /**
     * Spec E3 §3: Haupt-Passcode eines (Artwork-)Passcodes -- aliases[p] ?: p. [aliases] null = kein Katalog (jeder Passcode
     * steht fuer sich). Gilt fuer Import-Aufloesung, Legalitaet und Kopien-Grenze.
     */
    fun canonicalPasscode(passcode: String, aliases: Map<String, String>?): String = aliases?.get(passcode) ?: passcode

    fun normalizeName(s: String?): String {
```

Änderung 2/4 — ersetzen:
```kotlin
    private fun candidate(c: CatalogNameRow) = ImportCandidate(c.id, displayName(c), c.type ?: "")
    // Codeeinheiten-Vergleich wie "<" im JS-Zwilling (kein Locale-Vergleich).
```
durch:
```kotlin
    // passcode: bei einem Artwork-Passcode bleibt der importierte Passcode stehen (Export bleibt artwork-treu), Name und
    // Typ kommen von der Hauptkarte (Spec E3 §3).
    private fun candidate(c: CatalogNameRow, passcode: String = c.id) = ImportCandidate(passcode, displayName(c), c.type ?: "")
    // Codeeinheiten-Vergleich wie "<" im JS-Zwilling (kein Locale-Vergleich).
```

Änderung 3/4 — ersetzen:
```kotlin
    /** [catalog] null = kein Katalog. Fuer YDK/YDKE reichen die Zeilen der gelesenen Passcodes, fuer Text alle. */
    fun resolve(parsed: ParsedDeck, catalog: List<CatalogNameRow>?): ResolvedImport {
        val index = Index(catalog ?: emptyList())
        val rows = parsed.cards.map { card ->
            if (card.passcode != null) {
                val c = index.byId[card.passcode]
                if (c != null) ImportRow("ok", card.count, card.section, card.passcode, listOf(candidate(c)))
                else ImportRow("unknownPasscode", card.count, card.section, card.passcode, emptyList())
```
durch:
```kotlin
    /**
     * [catalog] null = kein Katalog. Fuer YDK/YDKE reichen die Zeilen der gelesenen Passcodes, fuer Text alle.
     * [aliases] (Spec E3 §3): Passcodes laufen ueber [canonicalPasscode].
     */
    fun resolve(parsed: ParsedDeck, catalog: List<CatalogNameRow>?, aliases: Map<String, String>? = null): ResolvedImport {
        val index = Index(catalog ?: emptyList())
        val rows = parsed.cards.map { card ->
            if (card.passcode != null) {
                val c = index.byId[canonicalPasscode(card.passcode, aliases)]
                if (c != null) ImportRow("ok", card.count, card.section, card.passcode, listOf(candidate(c, card.passcode)))
                else ImportRow("unknownPasscode", card.count, card.section, card.passcode, emptyList())
```

Änderung 4/4 — ersetzen:
```kotlin
     */
    fun prepare(text: String, format: String?, loadCatalog: (List<String>?) -> List<CatalogNameRow>?): PreparedImport {
        val parsed = if (format != null) DeckFormats.parseDeckText(text, format) else DeckFormats.parseDeckText(text)
        if (parsed.error != null) return PreparedImport(parsed.error, null)
        val ids = if (parsed.format == "text") null else parsed.cards.mapNotNull { it.passcode }
        return PreparedImport(null, resolve(parsed, loadCatalog(ids)))
    }
```
durch:
```kotlin
     * Spec E3 §3: fuer YDK/YDKE liefert [loadAliases] zuerst die Artwork-Zuordnung der gelesenen Passcodes; geladen werden
     * dann die Hauptkarten. (Der Desktop-Lader erledigt beides in einem Aufruf; die Aufloesung ist dieselbe.)
     * [loadAliases] steht vor [loadCatalog], damit `prepare(text, format) { ids -> … }` weiter den Katalog-Lader meint.
     */
    fun prepare(
        text: String,
        format: String?,
        loadAliases: (List<String>) -> Map<String, String> = { emptyMap() },
        loadCatalog: (List<String>?) -> List<CatalogNameRow>?,
    ): PreparedImport {
        val parsed = if (format != null) DeckFormats.parseDeckText(text, format) else DeckFormats.parseDeckText(text)
        if (parsed.error != null) return PreparedImport(parsed.error, null)
        val ids = if (parsed.format == "text") null else parsed.cards.mapNotNull { it.passcode }
        val aliases = if (ids != null) loadAliases(ids) else emptyMap()
        val catalog = loadCatalog(ids?.map { canonicalPasscode(it, aliases) })
        return PreparedImport(null, resolve(parsed, catalog, if (catalog != null) aliases else null))
    }
```

- [ ] **Step 4: `ml/DeckLegality.kt` anlegen**

```kotlin
package com.example.yugiohscanner.ml

/** Katalogdaten einer Hauptkarte fuer die Legalitaet; ban_* = "forbidden" | "limited" | "semi" | null. */
data class LegalityInfo(val name: String?, val type: String?, val banTcg: String?, val banOcg: String?)

/** aliases: Artwork-Passcode -> Haupt-Passcode; cards: Haupt-Passcode -> Info; builtAt = Baudatum des Katalogs. */
data class LegalityCatalog(val aliases: Map<String, String>, val cards: Map<String, LegalityInfo>, val builtAt: String? = null)

/** Deckzeile fuer die Legalitaet (gespeicherter Stand; mehrere Zeilen je Passcode erlaubt). */
data class LegalityCard(val cardId: String, val name: String?, val count: Int, val section: String)

/** rule null = Warnung; cardId = Haupt-Passcode oder null. */
data class LegalityIssue(val rule: Int?, val cardId: String?, val text: String)

data class LegalityResult(val legal: Boolean, val violations: List<LegalityIssue>, val warnings: List<LegalityIssue>)

/**
 * Spec E3 §4/§5 -- Format, Legalitaetsregeln TCG/OCG, Badge-Texte, Banlist-Stufe und Kopien-Grenze.
 * ZWILLING: desktop/src/utils/deckLegality.js. Beide laufen gegen docs/fixtures/decks/legality.json.
 * Wer eine Seite aendert, aendert beide. (JS deckLegality <-> Kotlin check.)
 */
object DeckLegality {
    val FORMATS = listOf("tcg", "ocg", "free")
    val FORMAT_LABELS = mapOf("tcg" to "TCG", "ocg" to "OCG", "free" to "Frei")
    const val CATALOG_MISSING_BANLIST = "Katalog fehlt – Banlist unbekannt"
    const val COPY_LIMIT = "Höchstens 3 Kopien je Karte"
    const val FORMAT_SAVE_FAILED = "Format konnte nicht gespeichert werden"
    /** Anzeige der Banlist-Stufe an der Kartenzeile (rot "Verboten", orange "1", gelb "2"). */
    val BAN_LABELS = mapOf("forbidden" to "Verboten", "limited" to "1", "semi" to "2")

    private val SECTION_ORDER = listOf("main", "extra", "side")
    private const val MAX_COPIES = 3
    private val BUILT_AT = Regex("^([0-9]{4})-([0-9]{2})-([0-9]{2})")

    /** Spec E3 §8: fehlt die Spalte format oder steht Unbekanntes darin -> TCG. */
    fun normalizeFormat(format: String?): String = if (format != null && format in FORMATS) format else "tcg"

    private fun mainIdOf(passcode: String, catalog: LegalityCatalog?): String =
        if (catalog != null) DeckImport.canonicalPasscode(passcode, catalog.aliases) else passcode

    /** Banlist-Stufe einer Deckkarte im Format; null = uneingeschraenkt, Frei oder unbekannt. */
    fun banOf(passcode: String, format: String?, catalog: LegalityCatalog?): String? {
        val f = normalizeFormat(format)
        if (f == "free" || catalog == null) return null
        val info = catalog.cards[mainIdOf(passcode, catalog)] ?: return null
        val ban = if (f == "ocg") info.banOcg else info.banTcg
        return ban?.takeIf { it in BAN_LABELS }
    }

    private class Group(val id: String, val name: String, val info: LegalityInfo?) {
        var count = 0
        val sections = mutableListOf<String>()
    }

    fun check(cards: List<LegalityCard>, format: String?, catalog: LegalityCatalog?): LegalityResult {
        val f = normalizeFormat(format)
        if (f == "free") return LegalityResult(true, emptyList(), emptyList())
        val rows = SECTION_ORDER.flatMap { s -> cards.filter { it.section == s && it.count > 0 } }
        fun total(s: String) = rows.filter { it.section == s }.sumOf { it.count }
        val violations = mutableListOf<LegalityIssue>()
        val warnings = mutableListOf<LegalityIssue>()

        val main = total("main")
        val extra = total("extra")
        val side = total("side")
        if (main < 40 || main > 60) violations.add(LegalityIssue(1, null, "Main Deck: $main Karten (erlaubt 40–60)"))
        if (extra > 15) violations.add(LegalityIssue(2, null, "Extra Deck: $extra Karten (höchstens 15)"))
        if (side > 15) violations.add(LegalityIssue(3, null, "Side Deck: $side Karten (höchstens 15)"))
        if (catalog == null) warnings.add(LegalityIssue(null, null, CATALOG_MISSING_BANLIST))

        // Je Haupt-Passcode: erster Name (gespeicherter Deckkartenname, sonst Katalog, sonst Passcode), Summe, Abschnitte.
        val groups = LinkedHashMap<String, Group>()
        for (c in rows) {
            val id = mainIdOf(c.cardId, catalog)
            val g = groups.getOrPut(id) {
                val info = catalog?.cards?.get(id)
                Group(id, c.name?.takeIf { it.isNotEmpty() } ?: info?.name?.takeIf { it.isNotEmpty() } ?: id, info)
            }
            g.count += c.count
            if (c.section !in g.sections) g.sections.add(c.section)
        }

        val rule5 = mutableListOf<LegalityIssue>()
        val rule6 = mutableListOf<LegalityIssue>()
        for (g in groups.values) {
            if (catalog != null && g.info == null) warnings.add(LegalityIssue(null, g.id, "Banlist unbekannt: Passcode ${g.id}"))
            val type = g.info?.type
            if (catalog != null && !type.isNullOrEmpty()) {
                val home = DeckImport.deckSectionFor(type)
                if ("main" in g.sections && home == "extra") violations.add(LegalityIssue(4, g.id, "${g.name} im Main Deck gehört ins Extra Deck"))
                if ("extra" in g.sections && home == "main") violations.add(LegalityIssue(4, g.id, "${g.name} im Extra Deck gehört ins Main Deck"))
            }
            val ban = if (catalog != null && g.info != null) banOf(g.id, f, catalog) else null
            when {
                ban == "forbidden" -> rule6.add(LegalityIssue(6, g.id, "${g.name} ist verboten"))
                ban == "limited" && g.count > 1 -> rule6.add(LegalityIssue(6, g.id, "${g.name}: ${g.count} Kopien (limitiert 1)"))
                ban == "semi" && g.count > 2 -> rule6.add(LegalityIssue(6, g.id, "${g.name}: ${g.count} Kopien (semi-limitiert 2)"))
                g.count > MAX_COPIES -> rule5.add(LegalityIssue(5, g.id, "${g.name}: ${g.count} Kopien (höchstens 3)"))
            }
        }
        violations.addAll(rule5)
        violations.addAll(rule6)
        return LegalityResult(violations.isEmpty(), violations, warnings)
    }

    fun violationCountText(n: Int): String = if (n == 1) "1 Verstoß" else "$n Verstöße"

    /** "Legal" | "Legal · 1 Warnung" | "Legal · 2 Warnungen" | "1 Verstoß" | "3 Verstöße" | "Frei". */
    fun badgeText(result: LegalityResult, format: String?): String {
        if (normalizeFormat(format) == "free") return "Frei"
        if (result.violations.isNotEmpty()) return violationCountText(result.violations.size)
        val w = result.warnings.size
        return if (w == 0) "Legal" else "Legal · $w ${if (w == 1) "Warnung" else "Warnungen"}"
    }

    /** Farbe des Badges: "free" grau, "legal" gruen, "warn" gelb, "crit" rot. */
    fun badgeKind(result: LegalityResult, format: String?): String = when {
        normalizeFormat(format) == "free" -> "free"
        result.violations.isNotEmpty() -> "crit"
        result.warnings.isNotEmpty() -> "warn"
        else -> "legal"
    }

    /** "Banlist-Stand: TT.MM.JJJJ" aus built_at (UTC-Datum wie gespeichert); ohne gueltiges Datum null. */
    fun banlistDateText(builtAt: String?): String? {
        val m = BUILT_AT.find(builtAt ?: "") ?: return null
        val (y, mo, d) = m.destructured
        return "Banlist-Stand: $d.$mo.$y"
    }

    /**
     * Spec E3 §5: darf eine weitere Kopie von [passcode] ins Deck? TCG/OCG: nicht, wenn die Karte (Haupt-Passcode, ueber
     * alle Abschnitte) danach mehr als 3 Kopien haette; Frei immer. Die Banlist blockiert nie. [aliases] null = ohne Zuordnung.
     */
    fun canAddCopy(deckCards: List<LegalityCard>, passcode: String, format: String?, aliases: Map<String, String>?): Boolean {
        if (normalizeFormat(format) == "free") return true
        val id = DeckImport.canonicalPasscode(passcode, aliases)
        val have = deckCards.filter { DeckImport.canonicalPasscode(it.cardId, aliases) == id }.sumOf { maxOf(0, it.count) }
        return have + 1 <= MAX_COPIES
    }
}
```

- [ ] **Step 5: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug` → `BUILD SUCCESSFUL`; `DeckLegalityTest` 3 Tests, `DeckImportTest` 8 Tests, gesamt 520 Tests/0 Fehler (aus `android/app/build/test-results/testDebugUnitTest/*.xml`).

- [ ] **Step 6: Schutz-Nachweis**

(a) Vorrang Regel 6 vor 5 (Kotlin): in `check` den `when`-Zweig `                g.count > MAX_COPIES -> rule5.add(LegalityIssue(5, g.id, "${g.name}: ${g.count} Kopien (höchstens 3)"))` kurz durch `                else -> {}` ersetzen und nach der schließenden Klammer des `when` `            if (g.count > MAX_COPIES) rule5.add(LegalityIssue(5, g.id, "${g.name}: ${g.count} Kopien (höchstens 3)"))` einfügen → `DeckLegalityTest > Fixture Legalitaet und Badge FAILED` (gemessen).
(b) Auflösung über die Zuordnung: in `resolve` `index.byId[canonicalPasscode(card.passcode, aliases)]` kurz zu `index.byId[card.passcode]` → `DeckImportTest > Fixture aufloesen und Plan FAILED` und `DeckImportTest > Vorschau vorbereiten loest Artwork-Passcodes ueber die Zuordnung auf FAILED` (gemessen).
Jeweils zitieren und zurücknehmen. Zwillingstreue im Bericht bestätigen: `[0-9]` im Datumsmuster beidseitig, leerer Name = fehlend, Gruppenreihenfolge Main/Extra/Side, `banOf` nur `forbidden|limited|semi`.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/DeckImport.kt android/app/src/main/java/com/example/yugiohscanner/ml/DeckLegality.kt android/app/src/test/java/com/example/yugiohscanner/DeckImportTest.kt android/app/src/test/java/com/example/yugiohscanner/DeckLegalityTest.kt
git commit -m "feat(e3): Kotlin-Zwillinge canonicalPasscode/Import über die Zuordnung und DeckLegality auf denselben Fixtures

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: Handy-Katalog v4 — Ban-Spalten, `card_aliases`, Baudatum, Legalitätsdaten

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogDb.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/CatalogSealedTest.kt`

**Interfaces:**
- Produces (für Task 10): `CatalogDb.VERSION = 4`, `CatalogDb.CREATE_STATEMENTS`, `CatalogDb.DROP_STATEMENTS`, `CatalogDb.meta(key)`; `CatalogCard.banTcg/banOcg` (Vorgabe `null`), `ParsedCatalog.aliases` (Vorgabe leer), `ParsedCatalog.hasLegality` (Vorgabe `false`), `CatalogParser.parseAliases(json, cardIds)`; `CatalogRepository.aliasesQuery(ids)`, `legalityQuery(ids)`, `aliases(ids) → Map<String, String>`, `builtAt() → String?`, `legalityCatalog(ids) → LegalityCatalog?`.
- Consumes (Task 1, 7): Katalog-JSON mit `aliases`, `ban_tcg`, `ban_ocg`; `DeckImport.canonicalPasscode`, `LegalityCatalog`, `LegalityInfo`.

- [ ] **Step 1: Tests schreiben**

In `android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```kotlin
import com.example.yugiohscanner.cloud.CatalogParser
```
durch:
```kotlin
import com.example.yugiohscanner.cloud.CatalogDb
import com.example.yugiohscanner.cloud.CatalogParser
```

Änderung 2/2 — ersetzen:
```kotlin
    }
}
```
durch:
```kotlin
    }

    // Spec E3 §3: Banlist je Karte und Artwork-Zuordnung; ein Katalog von vor E3 bleibt lesbar (ohne Legalitaet).
    @Test fun `liest ban_tcg, ban_ocg und aliases, nur Zuordnungen auf Katalogkarten`() {
        val json = """{"version":8,"built_at":"2026-09-16T03:00:00.000Z","aliases":{"46986415":"46986414","99999998":"11111111"},"cards":[
          {"id":46986414,"name_de":"Dunkler Magier","name_en":"Dark Magician","type":"Normal Monster","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"ban_tcg":null,"ban_ocg":null},
          {"id":55144522,"name_de":"Topf der Gier","name_en":"Pot of Greed","type":"Spell Card","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"ban_tcg":"forbidden","ban_ocg":"semi"},
          {"id":18144506,"name_de":"H","name_en":"H","type":"Spell Card","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"ban_tcg":"Unlimited"}]}"""
        val p = CatalogParser.parse(gz(json))
        assertEquals("2026-09-16T03:00:00.000Z", p.builtAt)
        assertTrue(p.hasLegality)
        assertEquals(mapOf("46986415" to "46986414"), p.aliases)
        assertEquals(listOf(null, "forbidden", null), p.cards.map { it.banTcg })
        assertEquals(listOf(null, "semi", null), p.cards.map { it.banOcg })
    }

    @Test fun `Katalog von vor E3 ohne aliases und Ban-Felder bleibt lesbar`() {
        val p = CatalogParser.parse(gz(sample))
        assertEquals(false, p.hasLegality)
        assertEquals(emptyMap<String, String>(), p.aliases)
        assertEquals(null, p.cards[0].banTcg)
        assertEquals(null, p.cards[0].banOcg)
    }

    @Test fun `Abfragen fuer Zuordnung und Legalitaet haben einen Platzhalter je Passcode`() {
        val (aliasSql, aliasArgs) = CatalogRepository.aliasesQuery(listOf("46986415", "1"))
        assertEquals("SELECT alt_id, card_id FROM card_aliases WHERE alt_id IN (?,?)", aliasSql)
        assertEquals(listOf("46986415", "1"), aliasArgs.toList())
        val (legSql, legArgs) = CatalogRepository.legalityQuery(listOf("46986414"))
        assertEquals("SELECT id, name_de, name_en, type, ban_tcg, ban_ocg FROM cards WHERE id IN (?)", legSql)
        assertEquals(listOf("46986414"), legArgs.toList())
    }

    // Spec E3 §9: v4 verwirft beim Upgrade den alten Katalog. Jede angelegte Tabelle muss in onUpgrade verworfen werden,
    // sonst scheitert onCreate beim naechsten Upgrade an "table already exists".
    @Test fun `CatalogDb v4 legt Ban-Spalten und card_aliases an und verwirft beim Upgrade jede Tabelle`() {
        assertEquals(4, CatalogDb.VERSION)
        val created = CatalogDb.CREATE_STATEMENTS.mapNotNull { Regex("^CREATE TABLE (\\w+)").find(it)?.groupValues?.get(1) }.toSet()
        val dropped = CatalogDb.DROP_STATEMENTS.mapNotNull { Regex("^DROP TABLE IF EXISTS (\\w+)$").find(it)?.groupValues?.get(1) }.toSet()
        assertEquals(setOf("cards", "printings", "meta", "sealed_products", "card_aliases"), created)
        assertEquals(created, dropped)
        assertTrue(CatalogDb.CREATE_STATEMENTS.first().contains("ban_tcg TEXT, ban_ocg TEXT"))
    }
}
```

In `android/app/src/test/java/com/example/yugiohscanner/CatalogSealedTest.kt` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```kotlin
    @Test fun `Katalog-Schema ist Version 3`() {
        // Spec E1 §5: v3 bringt cards.cm_price (v2 brachte sealed_products).
        assertEquals(3, CatalogDb.VERSION)
    }
```
durch:
```kotlin
    @Test fun `Katalog-Schema ist Version 4`() {
        // Spec E3 §3: v4 bringt ban_tcg/ban_ocg und card_aliases (v3 brachte cards.cm_price, v2 sealed_products).
        assertEquals(4, CatalogDb.VERSION)
    }
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest`
Expected: FAIL in `compileDebugUnitTestKotlin` mit `Unresolved reference 'hasLegality'` bzw. `'aliases'`, `'banTcg'`, `'aliasesQuery'`, `'legalityQuery'`, `'CREATE_STATEMENTS'`, `'DROP_STATEMENTS'`.

- [ ] **Step 3: `cloud/CatalogDb.kt`**

In `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogDb.kt` (6 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/6 — ersetzen:
```kotlin
         * onUpgrade verwirft den alten Katalog, CatalogSync laedt neu (ein Katalog v5 ohne cm_price bleibt lesbar).
         */
        const val VERSION = 3
    }
```
durch:
```kotlin
         * Spec E3 §3: v4 bringt `cards.ban_tcg`/`ban_ocg` und `card_aliases` (Artwork-Passcode -> Haupt-Passcode).
         * onUpgrade verwirft den alten Katalog, CatalogSync laedt neu (ein Katalog v5 ohne cm_price bleibt lesbar).
         */
        const val VERSION = 4

        /** Schema als Liste, damit ohne Geraet pruefbar ist, dass onUpgrade jede angelegte Tabelle verwirft. */
        internal val CREATE_STATEMENTS = listOf(
            """
            CREATE TABLE cards (
              id TEXT PRIMARY KEY, name_de TEXT, name_en TEXT, type TEXT, desc_de TEXT,
              atk INTEGER, def INTEGER, level INTEGER, race TEXT, attribute TEXT,
              image TEXT, image_small TEXT, cm_price REAL, ban_tcg TEXT, ban_ocg TEXT)
            """.trimIndent(),
            """
            CREATE TABLE printings (
              card_id TEXT NOT NULL, code TEXT NOT NULL, rarity TEXT NOT NULL,
              lang TEXT, verified INTEGER NOT NULL DEFAULT 0, ord INTEGER NOT NULL)
            """.trimIndent(),
            "CREATE INDEX printings_card_idx ON printings(card_id)",
            "CREATE INDEX cards_name_de_idx ON cards(name_de)",
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)",
            "CREATE TABLE sealed_products (cm_product_id INTEGER PRIMARY KEY, name TEXT, kind TEXT, trend REAL)",
            "CREATE INDEX sealed_products_name_idx ON sealed_products(name)",
            "CREATE TABLE card_aliases (alt_id TEXT PRIMARY KEY, card_id TEXT NOT NULL)",
        )

        internal val DROP_STATEMENTS = listOf(
            "DROP TABLE IF EXISTS printings",
            "DROP TABLE IF EXISTS cards",
            "DROP TABLE IF EXISTS meta",
            "DROP TABLE IF EXISTS sealed_products",
            "DROP TABLE IF EXISTS card_aliases",
        )
    }
```

Änderung 2/6 — ersetzen:
```kotlin
        db.execSQL(
            """
            CREATE TABLE cards (
              id TEXT PRIMARY KEY, name_de TEXT, name_en TEXT, type TEXT, desc_de TEXT,
              atk INTEGER, def INTEGER, level INTEGER, race TEXT, attribute TEXT,
              image TEXT, image_small TEXT, cm_price REAL)
            """.trimIndent()
        )
        db.execSQL(
            """
            CREATE TABLE printings (
              card_id TEXT NOT NULL, code TEXT NOT NULL, rarity TEXT NOT NULL,
              lang TEXT, verified INTEGER NOT NULL DEFAULT 0, ord INTEGER NOT NULL)
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX printings_card_idx ON printings(card_id)")
        db.execSQL("CREATE INDEX cards_name_de_idx ON cards(name_de)")
        db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")
        db.execSQL("CREATE TABLE sealed_products (cm_product_id INTEGER PRIMARY KEY, name TEXT, kind TEXT, trend REAL)")
        db.execSQL("CREATE INDEX sealed_products_name_idx ON sealed_products(name)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS printings")
        db.execSQL("DROP TABLE IF EXISTS cards")
        db.execSQL("DROP TABLE IF EXISTS meta")
        db.execSQL("DROP TABLE IF EXISTS sealed_products")
        onCreate(db)
```
durch:
```kotlin
        CREATE_STATEMENTS.forEach { db.execSQL(it) }
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        DROP_STATEMENTS.forEach { db.execSQL(it) }
        onCreate(db)
```

Änderung 3/6 — ersetzen:
```kotlin
            db.delete("sealed_products", null, null)
```
durch:
```kotlin
            db.delete("sealed_products", null, null)
            db.delete("card_aliases", null, null)
```

Änderung 4/6 — ersetzen:
```kotlin
                db.insertOrThrow("cards", null, cardValues)
```
durch:
```kotlin
                // Spec E3 §3: Banlist je Karte (null = uneingeschraenkt).
                if (card.banTcg == null) cardValues.putNull("ban_tcg") else cardValues.put("ban_tcg", card.banTcg)
                if (card.banOcg == null) cardValues.putNull("ban_ocg") else cardValues.put("ban_ocg", card.banOcg)
                db.insertOrThrow("cards", null, cardValues)
```

Änderung 5/6 — ersetzen:
```kotlin
            val metaValues = ContentValues()
            metaValues.put("key", "version")
```
durch:
```kotlin
            // Spec E3 §3: Artwork-Zuordnung in derselben Transaktion.
            val aliasValues = ContentValues()
            for ((alt, main) in parsed.aliases) {
                aliasValues.clear()
                aliasValues.put("alt_id", alt)
                aliasValues.put("card_id", main)
                db.insertWithOnConflict("card_aliases", null, aliasValues, SQLiteDatabase.CONFLICT_REPLACE)
            }

            // Spec E3 §3/§7: Baudatum ("Banlist-Stand") und ob der Katalog Ban-/Artwork-Felder traegt; version zuletzt.
            val metaValues = ContentValues()
            metaValues.put("key", "built_at")
            metaValues.put("value", parsed.builtAt)
            db.insertWithOnConflict("meta", null, metaValues, SQLiteDatabase.CONFLICT_REPLACE)
            metaValues.clear()
            metaValues.put("key", "legality")
            metaValues.put("value", if (parsed.hasLegality) "1" else "0")
            db.insertWithOnConflict("meta", null, metaValues, SQLiteDatabase.CONFLICT_REPLACE)
            metaValues.clear()
            metaValues.put("key", "version")
```

Änderung 6/6 — ersetzen:
```kotlin
    fun version(): Int {
        readableDatabase.query("meta", arrayOf("value"), "key = ?", arrayOf("version"), null, null, null).use { c ->
            if (c.moveToFirst()) return c.getString(0).toIntOrNull() ?: 0
        }
        return 0
    }
```
durch:
```kotlin
    fun version(): Int = meta("version")?.toIntOrNull() ?: 0

    /** Spec E3: Wert aus `meta` (z. B. "built_at", "legality"), null ohne Eintrag. */
    fun meta(key: String): String? {
        readableDatabase.query("meta", arrayOf("value"), "key = ?", arrayOf(key), null, null, null).use { c ->
            if (c.moveToFirst()) return c.getString(0)
        }
        return null
    }
```

- [ ] **Step 4: `cloud/CatalogParser.kt`**

Hinweis: `JSONObject.keys()` ist auf Android als `Iterator<*>` typisiert — deshalb `key.toString()`.

In `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt` (6 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/6 — ersetzen:
```kotlin
    val cmPrice: Double? = null,
```
durch:
```kotlin
    val cmPrice: Double? = null,
    // Spec E3 §3: Banlist "forbidden" | "limited" | "semi", null = uneingeschraenkt (oder Katalog von vor E3).
    val banTcg: String? = null,
    val banOcg: String? = null,
```

Änderung 2/6 — ersetzen:
```kotlin
    val sealedProducts: List<CatalogSealedProduct> = emptyList(),
```
durch:
```kotlin
    val sealedProducts: List<CatalogSealedProduct> = emptyList(),
    // Spec E3 §3: Artwork-Passcode -> Haupt-Passcode; hasLegality = der Katalog traegt `aliases` (also auch Ban-Felder).
    val aliases: Map<String, String> = emptyMap(),
    val hasLegality: Boolean = false,
```

Änderung 3/6 — ersetzen:
```kotlin
                // Parse printings and printings_verified
```
durch:
```kotlin
                // Spec E3 §3: fehlt (Katalog von vor E3), null oder unbekannt -> null.
                val banTcg = banOf(cardJson, "ban_tcg")
                val banOcg = banOf(cardJson, "ban_ocg")

                // Parse printings and printings_verified
```

Änderung 4/6 — ersetzen:
```kotlin
                )
```
durch:
```kotlin
                    banTcg = banTcg,
                    banOcg = banOcg,
                )
```

Änderung 5/6 — ersetzen:
```kotlin
        return ParsedCatalog(
```
durch:
```kotlin
        val aliasesJson = rootJson.optJSONObject("aliases")
        return ParsedCatalog(
```

Änderung 6/6 — ersetzen:
```kotlin
        )
    }
```
durch:
```kotlin
            aliases = parseAliases(aliasesJson, cards.mapTo(HashSet()) { it.id }),
            hasLegality = aliasesJson != null,
        )
    }

    private val BAN_LEVELS = setOf("forbidden", "limited", "semi")

    private fun banOf(card: JSONObject, key: String): String? =
        if (card.has(key) && !card.isNull(key)) card.optString(key).takeIf { it in BAN_LEVELS } else null

    /** Spec E3 §3: nur Zuordnungen auf Karten, die im Katalog stehen (gleiche Regel wie catalog-prices.cjs am Desktop). */
    internal fun parseAliases(aliases: JSONObject?, cardIds: Set<String>): Map<String, String> {
        if (aliases == null) return emptyMap()
        val out = LinkedHashMap<String, String>()
        for (key in aliases.keys()) {
            val alt = key.toString()
            val main = aliases.optString(alt)
            if (main in cardIds) out[alt] = main
        }
        return out
    }
```

- [ ] **Step 5: `cloud/CatalogRepository.kt`**

In `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```kotlin
import com.example.yugiohscanner.ml.CatalogNameRow
```
durch:
```kotlin
import com.example.yugiohscanner.ml.CatalogNameRow
import com.example.yugiohscanner.ml.DeckImport
import com.example.yugiohscanner.ml.LegalityCatalog
import com.example.yugiohscanner.ml.LegalityInfo
```

Änderung 2/2 — ersetzen:
```kotlin
    private fun escapeLike(input: String): String =
```
durch:
```kotlin
    /** Spec E3 §3: SQL der Artwork-Zuordnung mehrerer Passcodes -- rein, damit ohne SQLite testbar. */
    internal fun aliasesQuery(ids: List<String>): Pair<String, Array<String>> =
        "SELECT alt_id, card_id FROM card_aliases WHERE alt_id IN (${ids.joinToString(",") { "?" }})" to ids.toTypedArray()

    /** Spec E3 §4: SQL der Legalitaetsdaten mehrerer Haupt-Passcodes -- rein, damit ohne SQLite testbar. */
    internal fun legalityQuery(ids: List<String>): Pair<String, Array<String>> =
        "SELECT id, name_de, name_en, type, ban_tcg, ban_ocg FROM cards WHERE id IN (${ids.joinToString(",") { "?" }})" to ids.toTypedArray()

    /** Spec E3 §3: Artwork-Passcode -> Haupt-Passcode fuer die [ids], die Artworks sind (Bloecke zu 500). Ohne Katalog leer. */
    fun aliases(ids: Collection<String>): Map<String, String> {
        val database = db?.readableDatabase ?: return emptyMap()
        val out = HashMap<String, String>()
        for (chunk in ids.distinct().chunked(500)) {
            val (sql, args) = aliasesQuery(chunk)
            database.rawQuery(sql, args).use { c -> while (c.moveToNext()) out[c.getString(0)] = c.getString(1) }
        }
        return out
    }

    /** Spec E3 §7: Baudatum des importierten Katalogs ("Banlist-Stand"), null ohne Katalog. */
    fun builtAt(): String? = db?.meta("built_at")

    /**
     * Spec E3 §4: Legalitaetsdaten fuer die Deckkarten-Passcodes [ids] -- Zuordnung und die Hauptkarten mit Name, Typ und
     * Banlist. null ohne Katalog oder mit einem Katalog von vor E3 (meta.legality != "1") -> "Katalog fehlt – Banlist
     * unbekannt". Aufrufer lesen abseits des Hauptthreads.
     */
    fun legalityCatalog(ids: Collection<String>): LegalityCatalog? {
        val helper = db ?: return null
        if (!isReady() || helper.meta("legality") != "1") return null
        val database = helper.readableDatabase
        val aliases = aliases(ids)
        val cards = HashMap<String, LegalityInfo>()
        for (chunk in ids.map { DeckImport.canonicalPasscode(it, aliases) }.distinct().chunked(500)) {
            val (sql, args) = legalityQuery(chunk)
            database.rawQuery(sql, args).use { c ->
                while (c.moveToNext()) {
                    fun s(i: Int) = if (c.isNull(i)) null else c.getString(i)
                    cards[c.getString(0)] = LegalityInfo(s(1)?.takeIf { it.isNotEmpty() } ?: s(2)?.takeIf { it.isNotEmpty() }, s(3), s(4), s(5))
                }
            }
        }
        return LegalityCatalog(aliases, cards, helper.meta("built_at"))
    }

    private fun escapeLike(input: String): String =
```

- [ ] **Step 6: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug compileDebugAndroidTestKotlin` → `BUILD SUCCESSFUL`; `CatalogParserTest` 12 Tests, gesamt 524 Tests/0 Fehler. (`compileDebugAndroidTestKotlin` nur kompilieren — `CatalogDbTest` nie auf dem Gerät ausführen.)

- [ ] **Step 7: Schutz-Nachweis**

(a) Upgrade verwirft jede Tabelle: in `DROP_STATEMENTS` die Zeile `            "DROP TABLE IF EXISTS card_aliases",` kurz löschen → `CatalogParserTest > CatalogDb v4 legt Ban-Spalten und card_aliases an und verwirft beim Upgrade jede Tabelle FAILED` (gemessen).
(b) Zuordnung nur auf Katalogkarten: in `parseAliases` `            if (main in cardIds) out[alt] = main` kurz zu `            out[alt] = main` → `CatalogParserTest > liest ban_tcg, ban_ocg und aliases, nur Zuordnungen auf Katalogkarten FAILED` (gemessen).
Jeweils zitieren und zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogDb.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt android/app/src/test/java/com/example/yugiohscanner/CatalogSealedTest.kt
git commit -m "feat(e3): CatalogDb v4 mit Banlist, Artwork-Zuordnung und Baudatum; Legalitätsdaten je Deckkarte

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 9: Handy-Repository — Format speichern, Hinzufügen erhöht die Zeile, Kopien-Grenze

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/DecksRepositoryTest.kt`

**Interfaces:**
- Produces (für Task 10): `Deck(id, name, containerId = null, notes = null, format = "tcg")`, `sealed interface AddCopyPlan { Blocked; Increment(deckCardId, count); Insert }`, `DecksRepository.setFormat(deckId, format)` (wirft „Format konnte nicht gespeichert werden"), `addCopyPlan(cards, cardId, section, format, aliases) → AddCopyPlan` (internal, rein), `addCopy(deckId, cards, cardId, name, imageUrl, section, format, aliases)` (wirft „Höchstens 3 Kopien je Karte"), `incrementCopy(card, cards, format, aliases)`.
- Consumes (Task 7): `DeckLegality.canAddCopy`, `normalizeFormat`, `COPY_LIMIT`, `FORMAT_SAVE_FAILED`, `LegalityCard`.

- [ ] **Step 1: Tests schreiben**

In `android/app/src/test/java/com/example/yugiohscanner/DecksRepositoryTest.kt` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```kotlin
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
```
durch:
```kotlin
import com.example.yugiohscanner.cloud.AddCopyPlan
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
```

Änderung 2/2 — ersetzen:
```kotlin
        assertEquals(null, DecksRepository.parseDeck(JSONObject("""{"id":6,"name":"Alt"}""")).notes)
```
durch:
```kotlin
        assertEquals(null, DecksRepository.parseDeck(JSONObject("""{"id":6,"name":"Alt"}""")).notes)
    }

    // Spec E3 §4/§8: fehlt die Spalte format (SQL nicht eingespielt) oder steht Unbekanntes darin -> TCG.
    @Test fun `Deck liest format, fehlend und unbekannt werden tcg`() {
        assertEquals("ocg", DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"A","format":"ocg"}""")).format)
        assertEquals("free", DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"A","format":"free"}""")).format)
        assertEquals("tcg", DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"A"}""")).format)
        assertEquals("tcg", DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"A","format":null}""")).format)
        assertEquals("tcg", DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"A","format":"goat"}""")).format)
    }

    private fun dc(id: Long, cardId: String, count: Int, section: String) = DeckCard(id, cardId, null, null, count, section)

    // Spec E3 §5: "Hinzufügen" erhoeht die bestehende Zeile statt eine neue anzulegen; die 4. Kopie ist blockiert.
    @Test fun `Hinzufuegen erhoeht die bestehende Zeile im selben Abschnitt`() {
        val cards = listOf(dc(7, "46986414", 1, "main"), dc(8, "46986414", 1, "side"))
        assertEquals(AddCopyPlan.Increment(7, 2), DecksRepository.addCopyPlan(cards, "46986414", "main", "tcg", null))
        assertEquals(AddCopyPlan.Increment(8, 2), DecksRepository.addCopyPlan(cards, "46986414", "side", "tcg", null))
        assertEquals(AddCopyPlan.Insert, DecksRepository.addCopyPlan(cards, "55144522", "main", "tcg", null))
        assertEquals(AddCopyPlan.Insert, DecksRepository.addCopyPlan(listOf(dc(9, "46986414", 1, "side")), "46986414", "main", "tcg", null))
    }

    @Test fun `Hinzufuegen blockiert die vierte Kopie ueber Abschnitte und Artworks, im Format Frei nie`() {
        val cards = listOf(dc(7, "46986414", 2, "main"), dc(8, "46986415", 1, "side"))
        val aliases = mapOf("46986415" to "46986414")
        assertEquals(AddCopyPlan.Blocked, DecksRepository.addCopyPlan(cards, "46986414", "main", "tcg", aliases))
        assertEquals(AddCopyPlan.Blocked, DecksRepository.addCopyPlan(cards, "46986415", "side", "ocg", aliases))
        assertEquals(AddCopyPlan.Increment(7, 3), DecksRepository.addCopyPlan(cards, "46986414", "main", "tcg", null))
        assertEquals(AddCopyPlan.Increment(7, 3), DecksRepository.addCopyPlan(cards, "46986414", "main", "free", aliases))
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest`
Expected: FAIL in `compileDebugUnitTestKotlin` mit `Unresolved reference 'AddCopyPlan'`, `'addCopyPlan'`, `'format'`.

- [ ] **Step 3: `cloud/DecksRepository.kt`**

In `android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt` (4 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/4 — ersetzen:
```kotlin
import com.example.yugiohscanner.ml.ImportCard
import kotlinx.coroutines.Dispatchers
```
durch:
```kotlin
import com.example.yugiohscanner.ml.DeckLegality
import com.example.yugiohscanner.ml.ImportCard
import com.example.yugiohscanner.ml.LegalityCard
import kotlinx.coroutines.Dispatchers
```

Änderung 2/4 — ersetzen:
```kotlin
data class Deck(val id: Long, val name: String, val containerId: String? = null, val notes: String? = null)
data class DeckCard(
```
durch:
```kotlin
// Spec E3 §4: format tcg | ocg | free; fehlt die Spalte (SQL nicht eingespielt) -> tcg.
data class Deck(val id: Long, val name: String, val containerId: String? = null, val notes: String? = null, val format: String = "tcg")

/** Spec E3 §5: Ergebnis der Pruefung vor "Hinzufügen" -- blockiert, bestehende Zeile erhoehen oder neue Zeile anlegen. */
sealed interface AddCopyPlan {
    object Blocked : AddCopyPlan
    data class Increment(val deckCardId: Long, val count: Int) : AddCopyPlan
    object Insert : AddCopyPlan
}
data class DeckCard(
```

Änderung 3/4 — ersetzen:
```kotlin
        }.use { r -> if (!r.isSuccessful) throw RuntimeException(containerErrorMessage(r.code, r.body?.string() ?: "")) }
```
durch:
```kotlin
        }.use { r -> if (!r.isSuccessful) throw RuntimeException(containerErrorMessage(r.code, r.body?.string() ?: "")) }
    }

    /** Spec E3 §4/§7: Format sofort speichern. Lehnt die Cloud ab (z. B. Spalte fehlt), "Format konnte nicht gespeichert werden". */
    suspend fun setFormat(deckId: Long, format: String) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/decks".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.$deckId").build()
        val body = JSONObject().put("format", DeckLegality.normalizeFormat(format)).toString()
        executeWithReauth {
            base(url).addHeader("Content-Type", "application/json")
                .patch(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) throw RuntimeException(DeckLegality.FORMAT_SAVE_FAILED) }
    }

    private fun legalityCards(cards: List<DeckCard>) = cards.map { LegalityCard(it.cardId, it.name, it.count, it.section) }

    /**
     * Spec E3 §5 -- rein, damit ohne Netz testbar: TCG/OCG blockiert die 4. Kopie (Haupt-Passcode, alle Abschnitte), Frei nie.
     * Sonst erhoeht "Hinzufügen" die bestehende Zeile desselben Passcodes im selben Abschnitt (bei Doppelzeilen die erste)
     * statt eine neue anzulegen. [cards] = frischer Stand des Decks.
     */
    internal fun addCopyPlan(cards: List<DeckCard>, cardId: String, section: String, format: String, aliases: Map<String, String>?): AddCopyPlan {
        if (!DeckLegality.canAddCopy(legalityCards(cards), cardId, format, aliases)) return AddCopyPlan.Blocked
        val existing = cards.firstOrNull { it.cardId == cardId && it.section == section }
        return if (existing != null) AddCopyPlan.Increment(existing.id, existing.count + 1) else AddCopyPlan.Insert
    }

    /** Spec E3 §5: "Hinzufügen" aus der Suche. Blockiert -> Fehler "Höchstens 3 Kopien je Karte" (die Oberflaeche zeigt ihn). */
    suspend fun addCopy(
        deckId: Long, cards: List<DeckCard>, cardId: String, name: String?, imageUrl: String?, section: String,
        format: String, aliases: Map<String, String>?,
    ) {
        when (val plan = addCopyPlan(cards, cardId, section, format, aliases)) {
            AddCopyPlan.Blocked -> throw IllegalStateException(DeckLegality.COPY_LIMIT)
            is AddCopyPlan.Increment -> setCount(plan.deckCardId, plan.count)
            AddCopyPlan.Insert -> addCard(deckId, cardId, name, imageUrl, section)
        }
    }

    /** Spec E3 §5: "+" an einer Zeile -- dieselbe Grenze; gezaehlt wird mit dem frischen Stand [cards]. */
    suspend fun incrementCopy(card: DeckCard, cards: List<DeckCard>, format: String, aliases: Map<String, String>?) {
        if (!DeckLegality.canAddCopy(legalityCards(cards), card.cardId, format, aliases)) throw IllegalStateException(DeckLegality.COPY_LIMIT)
        val current = cards.firstOrNull { it.id == card.id } ?: card
        setCount(current.id, current.count + 1)
```

Änderung 4/4 — ersetzen:
```kotlin
        notes = if (o.isNull("notes")) null else o.optString("notes"),
```
durch:
```kotlin
        notes = if (o.isNull("notes")) null else o.optString("notes"),
        format = DeckLegality.normalizeFormat(if (o.isNull("format")) null else o.optString("format")),
```

- [ ] **Step 4: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug` → `BUILD SUCCESSFUL`; `DecksRepositoryTest` 11 Tests, gesamt 527 Tests/0 Fehler.

- [ ] **Step 5: Schutz-Nachweis**

(a) Grenze: in `addCopyPlan` die Zeile `        if (!DeckLegality.canAddCopy(legalityCards(cards), cardId, format, aliases)) return AddCopyPlan.Blocked` kurz löschen → `DecksRepositoryTest > Hinzufuegen blockiert die vierte Kopie ueber Abschnitte und Artworks, im Format Frei nie FAILED` (gemessen).
(b) Zeile im selben Abschnitt: `        val existing = cards.firstOrNull { it.cardId == cardId && it.section == section }` kurz zu `        val existing = cards.firstOrNull { it.cardId == cardId }` → `DecksRepositoryTest > Hinzufuegen erhoeht die bestehende Zeile im selben Abschnitt FAILED` (gemessen).
Jeweils zitieren und zurücknehmen. Aufrufer von `Deck(...)` und `addCard` im Bericht nennen (unverändert: `moveOne`, Liste „Leer", Import).

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt android/app/src/test/java/com/example/yugiohscanner/DecksRepositoryTest.kt
git commit -m "feat(e3): Handy speichert das Format, Hinzufügen erhöht die bestehende Zeile, 4. Kopie blockiert

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 10: Handy-Oberfläche — Format, Badge, aufklappbare Verstöße, Banlist-Icons, Grenze; Import über die Zuordnung

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/DeckImportScreen.kt`

**Interfaces:**
- Produces: `LegalityLoad(ids, catalog)`, `rememberLegalityCatalog(ids)`, `LegalityBadge(format, result)`, `BanIcon(ban)`, `DeckLegalityHead(format, legality, builtAt, error, onPickFormat)`; `DeckRow(deck, summary, legality, …)`, `DeckCardRow(card, numbers, ban, onMove, onPlus, busy, mutate)`.
- Consumes: Task 7 (`DeckLegality`, `DeckImport.canonicalPasscode`, `prepare(…, loadAliases, loadCatalog)`), Task 8 (`CatalogRepository.aliases`, `legalityCatalog`), Task 9 (`Deck.format`, `setFormat`, `addCopy`, `incrementCopy`), vorhanden `InFlight`, `SideStores.decks`, `SideStores.deckCards`, `moveOne`.

- [ ] **Step 1: `DecksScreen.kt` anpassen**

In `android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt` (20 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/20 — ersetzen:
```kotlin
import androidx.compose.material.icons.filled.Image
```
durch:
```kotlin
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Image
```

Änderung 2/20 — ersetzen:
```kotlin
import androidx.compose.ui.layout.ContentScale
```
durch:
```kotlin
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
```

Änderung 3/20 — ersetzen:
```kotlin
import com.example.yugiohscanner.ml.CoverageCard
```
durch:
```kotlin
import com.example.yugiohscanner.ml.DeckLegality
import com.example.yugiohscanner.ml.LegalityCard
import com.example.yugiohscanner.ml.LegalityCatalog
import com.example.yugiohscanner.ml.LegalityResult
import com.example.yugiohscanner.ml.CoverageCard
```

Änderung 4/20 — ersetzen:
```kotlin
    return prices
```
durch:
```kotlin
    return prices
}

/**
 * Spec E3 §4: gelesener Legalitaets-Katalog fuer genau diese [ids]; catalog null = kein (E3-)Katalog.
 * ids gehoert dazu, damit eine neu hinzugefuegte Karte nie kurz als "Banlist unbekannt" erscheint.
 */
private data class LegalityLoad(val ids: Set<String>, val catalog: LegalityCatalog?)

/** Spec E3 §4/§7: Legalitaetsdaten der Deckkarten-Passcodes, abseits des Hauptthreads gelesen; null = laedt ("…"). */
@Composable
private fun rememberLegalityCatalog(ids: Set<String>?): LegalityLoad? {
    val load by produceState<LegalityLoad?>(initialValue = null, ids) {
        if (ids != null) value = withContext(Dispatchers.IO) { LegalityLoad(ids, runCatching { CatalogRepository.legalityCatalog(ids) }.getOrNull()) }
    }
    return load?.takeIf { it.ids == ids }
}

private fun legalityCardsOf(cards: List<DeckCard>) = cards.map { LegalityCard(it.cardId, it.name, it.count, it.section) }

private val BanOrange = Color(0xFFFF9800)

/** Spec E3 §7: Format-Chip und Badge (gruen "Legal", gelb "Legal · n Warnungen", rot "n Verstöße", grau "Frei"); null = "…". */
@Composable
private fun LegalityBadge(format: String, result: LegalityResult?) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(DeckLegality.FORMAT_LABELS[format] ?: "TCG", color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
        if (result == null) Text(DeckCoverage.LOADING, color = Muted, style = MaterialTheme.typography.labelSmall)
        else {
            val color = when (DeckLegality.badgeKind(result, format)) { "legal" -> Good; "warn" -> Gold; "crit" -> ErrorColor; else -> Muted }
            Text(DeckLegality.badgeText(result, format), color = color, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** Spec E3 §7: Banlist-Icon rot "Verboten", orange "1", gelb "2"; uneingeschraenkt kein Icon. */
@Composable
private fun BanIcon(ban: String?) {
    val label = ban?.let { DeckLegality.BAN_LABELS[it] } ?: return
    val bg = when (ban) { "forbidden" -> ErrorColor; "limited" -> BanOrange; else -> Gold }
    Box(Modifier.clip(RoundedCornerShape(4.dp)).background(bg).padding(horizontal = 5.dp)) {
        Text(label, color = Color.Black, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelSmall)
    }
```

Änderung 5/20 — ersetzen:
```kotlin
            decks.associate { d -> d.id to DeckCoverage.compute(d.id, byDeck[d.id] ?: emptyList(), r.copies, r.cards, decks, r.containers, prices) }
```
durch:
```kotlin
            decks.associate { d -> d.id to DeckCoverage.compute(d.id, byDeck[d.id] ?: emptyList(), r.copies, r.cards, decks, r.containers, prices) }
        }
    }
    // Spec E3 §7: Badge der Deck-Liste aus dem gespeicherten Stand; null, solange Deckkarten oder Katalog laden.
    val legalityLoad = rememberLegalityCatalog(priceIds)
    val legalities: Map<Long, LegalityResult>? = remember(cache.value, allCards, legalityLoad) {
        val load = legalityLoad
        if (cache.value == null || allCards == null || load == null) null
        else {
            val byDeck = allCards.groupBy { it.deckId }
            decks.associate { d -> d.id to DeckLegality.check(legalityCardsOf(byDeck[d.id] ?: emptyList()), d.format, load.catalog) }
```

Änderung 6/20 — ersetzen:
```kotlin
                            deck, summary,
                            onOpen = { openDeckId = deck.id },
```
durch:
```kotlin
                            deck, summary, legalities?.get(deck.id),
                            onOpen = { openDeckId = deck.id },
```

Änderung 7/20 — ersetzen:
```kotlin
private fun DeckRow(deck: Deck, summary: String, onOpen: () -> Unit, onDelete: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
```
durch:
```kotlin
private fun DeckRow(deck: Deck, summary: String, legality: LegalityResult?, onOpen: () -> Unit, onDelete: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
```

Änderung 8/20 — ersetzen:
```kotlin
                Text(summary, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1)
```
durch:
```kotlin
                LegalityBadge(deck.format, legality)
                Text(summary, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1)
```

Änderung 9/20 — ersetzen:
```kotlin
    // Spec E2 Task 8 Fix 1: ein Lauf gleichzeitig -- sonst kann ein Doppel-Tipp (+/-, entfernen, verschieben)
```
durch:
```kotlin
    // Spec E3 §7: Legalitaet aus dem GESPEICHERTEN Stand; Format speichert sofort.
    val legalityLoad = rememberLegalityCatalog(priceIds)
    val legality: LegalityResult? = remember(deck.format, cache.value, legalityLoad) {
        val dc = cache.value
        val load = legalityLoad
        if (dc == null || load == null) null else DeckLegality.check(legalityCardsOf(dc), deck.format, load.catalog)
    }
    var formatError by remember { mutableStateOf<String?>(null) }
    // Spec E2 Task 8 Fix 1: ein Lauf gleichzeitig -- sonst kann ein Doppel-Tipp (+/-, entfernen, verschieben)
```

Änderung 10/20 — ersetzen:
```kotlin
    LaunchedEffect(deck.id) { deckCache.refresh() }
```
durch:
```kotlin
    LaunchedEffect(deck.id) { deckCache.refresh() }

    // Spec E3 §5: frischer Stand und Artwork-Zuordnung fuer die Kopien-Grenze -- innerhalb von mutate gelesen, damit ein
    // Tipp direkt nach einer Aenderung nicht mit dem Stand von vor der Aenderung zaehlt.
    suspend fun freshCardsAndAliases(extraId: String): Pair<List<DeckCard>, Map<String, String>> {
        val fresh = deckCache.state.value.value ?: cards
        val aliases = withContext(Dispatchers.IO) { runCatching { CatalogRepository.aliases(fresh.map { it.cardId } + extraId) }.getOrDefault(emptyMap()) }
        return fresh to aliases
    }
```

Änderung 11/20 — ersetzen:
```kotlin
            DeckCoverageHead(
```
durch:
```kotlin
            DeckLegalityHead(
                format = deck.format, legality = legality, builtAt = legalityLoad?.catalog?.builtAt, error = formatError,
                onPickFormat = { f ->
                    scope.launch {
                        try { DecksRepository.setFormat(deck.id, f); SideStores.decks.refreshAndWait(); formatError = null }
                        catch (e: Exception) { formatError = e.message ?: DeckLegality.FORMAT_SAVE_FAILED }
                    }
                },
            )
            DeckCoverageHead(
```

Änderung 12/20 — ersetzen:
```kotlin
                                DecksRepository.addCard(
                                    deck.id, cardId = r.id, name = r.name,
                                    imageUrl = r.imageUrl, section = if (addToSide) "side" else DeckImport.deckSectionFor(r.type),
                                )
```
durch:
```kotlin
                                // Spec E3 §5: bestehende Zeile erhoehen, 4. Kopie blockiert ("Höchstens 3 Kopien je Karte").
                                val (fresh, aliases) = freshCardsAndAliases(r.id)
                                DecksRepository.addCopy(
                                    deck.id, fresh, cardId = r.id, name = r.name, imageUrl = r.imageUrl,
                                    section = if (addToSide) "side" else DeckImport.deckSectionFor(r.type),
                                    format = deck.format, aliases = aliases,
                                )
```

Änderung 13/20 — ersetzen:
```kotlin
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
durch:
```kotlin
                // Spec E3 §3: Typ ueber den Haupt-Passcode; frischer Stand (Verschieben aendert die Summe nicht, nie blockiert).
                val move: (DeckCard) -> Unit = { card ->
                    mutate {
                        val (fresh, aliases) = freshCardsAndAliases(card.cardId)
                        val type = if (card.section == "side") withContext(Dispatchers.IO) {
                            CatalogRepository.importRows(listOf(DeckImport.canonicalPasscode(card.cardId, aliases))).firstOrNull()?.type
                        } else null
                        DecksRepository.moveOne(deck.id, fresh.firstOrNull { it.id == card.id } ?: card, fresh, type)
                    }
                }
                // Spec E3 §5: "+" an einer Zeile mit derselben Grenze wie "Hinzufügen".
                val plusOne: (DeckCard) -> Unit = { card ->
                    mutate {
                        val (fresh, aliases) = freshCardsAndAliases(card.cardId)
                        DecksRepository.incrementCopy(card, fresh, deck.format, aliases)
                    }
                }
                val banOf: (DeckCard) -> String? = { card -> DeckLegality.banOf(card.cardId, deck.format, legalityLoad?.catalog) }
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
```

Änderung 14/20 — ersetzen:
```kotlin
                    items(main, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), move, mutating) { block -> mutate(block) } }
                    item {
```
durch:
```kotlin
                    items(main, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), move, plusOne, mutating) { block -> mutate(block) } }
                    item {
```

Änderung 15/20 — ersetzen:
```kotlin
                    items(extra, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), move, mutating) { block -> mutate(block) } }
                    item {
```
durch:
```kotlin
                    items(extra, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), move, plusOne, mutating) { block -> mutate(block) } }
                    item {
```

Änderung 16/20 — ersetzen:
```kotlin
                    items(side, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), move, mutating) { block -> mutate(block) } }
                }
```
durch:
```kotlin
                    items(side, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), move, plusOne, mutating) { block -> mutate(block) } }
                }
```

Änderung 17/20 — ersetzen:
```kotlin
        )
    }
```
durch:
```kotlin
        )
    }
}

/**
 * Spec E3 §7: Format-Auswahl (speichert sofort) und Badge; darunter aufklappbar "n Verstöße" mit Warnungen und
 * "Banlist-Stand". Im Format "Frei" gibt es keine Liste.
 */
@Composable
private fun DeckLegalityHead(format: String, legality: LegalityResult?, builtAt: String?, error: String?, onPickFormat: (String) -> Unit) {
    var menuOpen by remember { mutableStateOf(false) }
    var issuesOpen by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box {
                Row(Modifier.clickable { menuOpen = true }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Format: ${DeckLegality.FORMAT_LABELS[format] ?: "TCG"}", color = OnSurface, style = MaterialTheme.typography.bodyMedium)
                    Icon(Icons.Default.ArrowDropDown, "Format wählen", tint = Muted)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    DeckLegality.FORMATS.forEach { f ->
                        DropdownMenuItem(text = { Text(DeckLegality.FORMAT_LABELS.getValue(f)) }, onClick = { menuOpen = false; if (f != format) onPickFormat(f) })
                    }
                }
            }
            if (legality == null) Text(DeckCoverage.LOADING, color = Muted, style = MaterialTheme.typography.labelMedium)
            else {
                val color = when (DeckLegality.badgeKind(legality, format)) { "legal" -> Good; "warn" -> Gold; "crit" -> ErrorColor; else -> Muted }
                Text(DeckLegality.badgeText(legality, format), color = color, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium)
            }
        }
        if (legality != null && DeckLegality.normalizeFormat(format) != "free") {
            Row(Modifier.clickable { issuesOpen = !issuesOpen }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(DeckLegality.violationCountText(legality.violations.size), color = if (legality.legal) Muted else ErrorColor, style = MaterialTheme.typography.labelMedium)
                Icon(if (issuesOpen) Icons.Default.ExpandLess else Icons.Default.ExpandMore, null, tint = Muted)
            }
            if (issuesOpen) {
                legality.violations.forEach { Text(it.text, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
                legality.warnings.forEach { Text(it.text, color = Gold, style = MaterialTheme.typography.labelSmall) }
                DeckLegality.banlistDateText(builtAt)?.let { Text(it, color = Muted, style = MaterialTheme.typography.labelSmall) }
            }
        }
        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
    }
```

Änderung 18/20 — ersetzen:
```kotlin
private fun DeckCardRow(card: DeckCard, numbers: CoverageCard?, onMove: (DeckCard) -> Unit, busy: Boolean, mutate: ((suspend () -> Unit)) -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
```
durch:
```kotlin
private fun DeckCardRow(
    card: DeckCard, numbers: CoverageCard?, ban: String?, onMove: (DeckCard) -> Unit, onPlus: (DeckCard) -> Unit, busy: Boolean,
    mutate: ((suspend () -> Unit)) -> Unit,
) {
    SpaceCard(Modifier.fillMaxWidth()) {
```

Änderung 19/20 — ersetzen:
```kotlin
                Text(
                    card.name ?: card.cardId, color = OnSurface, maxLines = 2,
                    style = MaterialTheme.typography.bodyMedium,
                )
                // Spec E1 §8: "Box 1 · verfügbar 2 · gebraucht 3" (rot bei Fehlenden) und gelb "1 in Deck Tenpai".
```
durch:
```kotlin
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        card.name ?: card.cardId, color = OnSurface, maxLines = 2,
                        style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f, fill = false),
                    )
                    // Spec E3 §7: Banlist-Icon nach Format, kein Stern am Handy.
                    BanIcon(ban)
                }
                // Spec E1 §8: "Box 1 · verfügbar 2 · gebraucht 3" (rot bei Fehlenden) und gelb "1 in Deck Tenpai".
```

Änderung 20/20 — ersetzen:
```kotlin
            IconButton(onClick = { mutate { DecksRepository.setCount(card.id, card.count + 1) } }, enabled = !busy) {
                Text("+", color = OnSurface, style = MaterialTheme.typography.titleLarge.copy(fontFamily = MonoFontFamily))
```
durch:
```kotlin
            IconButton(onClick = { onPlus(card) }, enabled = !busy) {
                Text("+", color = OnSurface, style = MaterialTheme.typography.titleLarge.copy(fontFamily = MonoFontFamily))
```

- [ ] **Step 2: `DeckImportScreen.kt` anpassen**

In `android/app/src/main/java/com/example/yugiohscanner/ui/DeckImportScreen.kt` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```kotlin
                DeckImport.prepare(text, null) { ids -> if (CatalogRepository.isReady()) CatalogRepository.importRows(ids) else null }
            } catch (e: Exception) {
```
durch:
```kotlin
                // Spec E3 §3: Artwork-Passcodes erst ueber die Zuordnung, dann die Hauptkarten.
                DeckImport.prepare(
                    text, null, { ids -> if (CatalogRepository.isReady()) CatalogRepository.aliases(ids) else emptyMap() },
                ) { ids -> if (CatalogRepository.isReady()) CatalogRepository.importRows(ids) else null }
            } catch (e: Exception) {
```

Änderung 2/2 — ersetzen:
```kotlin
                                        val images = withContext(Dispatchers.IO) {
                                            CatalogRepository.importRows(plan.cards.map { it.cardId }).associate { it.id to it.image }
                                        }
```
durch:
```kotlin
                                        // Spec E3 §3: Bild der Hauptkarte, die Deckkarte behaelt den Artwork-Passcode.
                                        val images = withContext(Dispatchers.IO) {
                                            val ids = plan.cards.map { it.cardId }
                                            val aliases = CatalogRepository.aliases(ids)
                                            val byMain = CatalogRepository.importRows(ids.map { DeckImport.canonicalPasscode(it, aliases) }).associate { it.id to it.image }
                                            ids.associateWith { byMain[DeckImport.canonicalPasscode(it, aliases)] }
                                        }
```

- [ ] **Step 3: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug` → `BUILD SUCCESSFUL`, 527 Tests/0 Fehler.

- [ ] **Step 4: Kein neuer Schutz-Test**

Oberfläche ohne automatische Tests (Plan-Ergänzung 19); Regeln in Task 7–9 geschützt. Im Bericht bestätigen: jeder Aufruf von `addCopy`, `incrementCopy`, `moveOne` liegt in `mutate { … }` und liest `freshCardsAndAliases`; `DecksRepository.addCard` wird aus `DecksScreen` nicht mehr direkt aufgerufen; `legalityCatalog`/`aliases` laufen nur auf `Dispatchers.IO`.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/DeckImportScreen.kt
git commit -m "feat(e3): Handy zeigt Format, Legalitäts-Badge, aufklappbare Verstöße und Banlist-Icons; Grenze und Import über die Zuordnung

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Controller-Abschluss (kein Subagent)

- [ ] **Gesamtlauf:** Desktop SQLite-Suite (erwartet 259), `electron/test-sync.cjs` (alle PASS), Desktop-Helfer (241), Lint genau 5 Fehler, `npx vite build`, Android `testDebugUnitTest assembleDebug` (527/0). Die Zahlen kommen ins Ledger (Android aus `android/app/build/test-results/testDebugUnitTest/*.xml`).
- [ ] **Abschlussreview** mit dem besten Modell über den gesamten Zweig (`review-package`, Basis = Plan-Commit), danach eine Fix-Welle und ein scoped Re-Review. Besonders prüfen:
  - Zwillinge regelgleich: `canonicalPasscode` (nur eigene Schlüssel), Gruppierung je Haupt-Passcode, Reihenfolge Main/Extra/Side, Vorrang Regel 6 vor 5, Regel 4 nur mit Katalog und Typ, Warnung je Haupt-Passcode, „Katalog fehlt" nur einmal und ohne Regeln 4/6, Badge-Einzahl, `[0-9]` im Datumsmuster; beide Seiten lesen `legality.json` und `import.json`.
  - „Save Deck": `role` und `format` überleben Löschen+Neu-Einfügen; ohne Stern keine `role`-Spalte im Insert; Rückfall ohne `role` bei Fehler; Format nur bei Änderung; eine verschobene Kopie nimmt den Stern nicht mit.
  - Artwork-Passcodes: Deckkarte behält den importierten Passcode (Desktop und Handy), Bild/Name/Typ von der Hauptkarte, Legalität und Grenze zählen zusammen.
  - Kein Platzhalter täuscht: Badge „…" solange Katalog-Index bzw. `LegalityLoad` fehlt oder zu anderen ids gehört; nie vorläufig „Legal" oder „Banlist unbekannt".
  - Handy: jede Mutation im `InFlight`-Gatter mit frischem Stand; „+" und „Hinzufügen" blockieren die 4. Kopie, Verschieben nie; Format-Wechsel meldet „Format konnte nicht gespeichert werden".
  - Aufrufer geteilter Funktionen (Plan-Ergänzung 13) unverändert; Kanal `get-catalog-legality` in `main.cjs` und `preload.cjs`.
  - Kein App-Code schreibt `cards.quantity`, `cards.deleted` oder `price_first_ed` (E3 berührt die lokale Sammlung nicht).
- [ ] **Übergabe an den Nutzer, in dieser Reihenfolge (Spec §9):**
  1. `supabase/decks_format_role.sql` im Dashboard einspielen.
  2. Desktop-Installer bauen und installieren, **nicht** aus dem Worktree mit Junction-`node_modules` (nach dem Merge im Hauptcheckout bauen); danach in den Einstellungen „Katalog jetzt bauen" (neue Katalog-Version mit `aliases`, `ban_tcg`, `ban_ocg`). Ohne diesen Bau zeigt der Deck-Builder „Katalog fehlt – Banlist unbekannt".
  3. APK installieren (`CatalogDb` v4 verwirft den alten Katalog); am Handy in den Einstellungen „Jetzt prüfen", bis die neue Katalog-Version geladen ist. `connectedDebugAndroidTest` nie auf dem Gerät ausführen.
  Keine Edge Function, kein Deploy.
- [ ] **Abnahme** (Checkliste im Ledger, Spec §11):
  1. Desktop: Deck auf TCG bzw. OCG stellen und speichern; mit 38 Main-Deck-Karten, einer 4. Kopie und einer doppelt enthaltenen limitierten Karte zeigt der Badge „3 Verstöße" und der Reiter „Verstöße" die drei Texte; das Handy zeigt nach dem Laden dieselbe Liste (aufgeklappt) und denselben Badge.
  2. Banlist-Icons (rot „Verboten", orange „1", gelb „2") auf beiden Geräten an den richtigen Karten, im Format „Frei" keine; „Banlist-Stand: TT.MM.JJJJ" zeigt das Datum des eben gebauten Katalogs (Desktop-Reiter „Verstöße", Handy-Aufklapper).
  3. Ein Deck mit Artwork-Variante (z. B. YDK mit `46986415` Dunkler Magier) importiert ohne „Unbekannter Passcode", Bild und Name der Hauptkarte erscheinen, der YDK-Export enthält weiter `46986415`; `46986414` × 2 plus `46986415` × 2 zeigt „Dunkler Magier: 4 Kopien (höchstens 3)".
  4. Eine 4. Kopie hinzufügen ist auf beiden Geräten blockiert („Höchstens 3 Kopien je Karte"; Handy auch über „+"); im Format „Frei" nicht.
  5. Am Desktop Starter markieren, „Save Deck", Deck neu öffnen → Sterne sind da; 40 Karten mit 9 Starter-Kopien zeigen „5 Karten: mindestens 1 Starter 74,2 %" (Plan-Ergänzung 15), „Testhand ziehen (5)" hebt Starter hervor.
  6. Handy „+ Hinzufügen" einer Karte, die schon im Zielabschnitt liegt, erhöht deren Anzahl statt eine neue Zeile anzulegen.
- [ ] **Folgeaufgaben nennen:** Abgleich (E1) für Artwork-Deckkarten (Plan-Ergänzung 16); bestehende Doppelzeilen am Handy (Spec §2, nicht drin).
- [ ] **Merge-Frage** an den Nutzer.

---

## Selbstprüfung

**Spec-Abdeckung:**

| Spec | Umsetzung |
|---|---|
| §3 Katalogdaten (Artwork-Zuordnung `aliases` im Katalog, Desktop über den Index, Handy `card_aliases`; `canonicalPasscode`; E2-Import über die Zuordnung mit Artwork-Passcode in der Deckkarte; Legalität/Grenze/Ban über Haupt-Passcode; `ban_tcg`/`ban_ocg` aus `banlist_info`, fehlend = null; Handy-Spalten mit v4-Upgrade; keine Desktop-`cards`-Spalten; „Unbekannt"; „Banlist-Stand" aus `built_at`) | Task 1 (`banOf`, `buildAliases`, `packCatalog`, `catalogCards`/`catalogMainId`/`catalogLegality`), Task 2/7 (`canonicalPasscode`, `resolveImport`/`resolve`, `prepare`), Task 5 (Bild/Typ über Hauptkarte), Task 8 (`CatalogDb` v4, Parser, `aliases`, `legalityCatalog`, `builtAt`), Task 10 (`DeckImportScreen`), Task 3/7 (`banlistDateText`); Plan-Ergänzungen 1–7, 17 |
| §4 Format und Regeln (`decks.format` mit Check und Anzeige TCG/OCG/Frei; Regeln 1–6 mit Texten und Reihenfolge; Zählung über Main+Extra+Side; Vorrang 6 vor 5; ohne Typ keine Regel 4; Namen-Rückfall; Warnungen „Banlist unbekannt" und „Katalog fehlt"; Frei ohne Regeln; Ergebnisform; Badge-Texte) | Task 1 (SQL), Task 3 `deckLegality.js` + `legality.json` (30 Legalitätsfälle, Formate, Banlist-Stufen, Datum, Anzahl), Task 7 `DeckLegality.kt`; Plan-Ergänzungen 8, 9 |
| §5 Kopien-Grenze (`canAddCopy` beidseitig; Frei immer; Banlist blockiert nie; Hinzufügen und Verschieben, Verschieben nie blockiert; Meldung; Handy-Hinzufügen erhöht bestehende Zeile, Doppelzeilen bleiben und zählen zusammen) | Task 3/7 (`canAddCopy`, 11 Fixture-Fälle inkl. Doppelzeilen und Artwork), Task 6 (`addToDeck`, Meldung), Task 9 (`AddCopyPlan`, `addCopy`, `incrementCopy`), Task 10 (Hinzufügen, „+", Verschieben ungebremst, frischer Stand); Plan-Ergänzungen 10, 11 |
| §6 Starter und Starthand (`deck_cards.role` mit Check; Stern nur Main; Save Deck trägt `role`; Handy unangetastet; exakte Rechnung über Bruch-Produkte mit Kanten; Anzeige 5/6 Karten und Verteilung; Hinweis ohne Starter; keine 1000-Hände; Testhand 5/6 mit austauschbarer Zufallsquelle, Starter hervorgehoben) | Task 1 (SQL), Task 4 `deckOdds.js` (`handOdds`, `percentText`, `oddsTexts`, `drawHand`), Task 5 (`saveDeckRows`/`saveDeck`, `buildSaveDeckCards`, `get-deck-details.role`), Task 6 (Stern, Simulation-Reiter, Testhand); Plan-Ergänzungen 12, 14, 15 |
| §7 Anzeige Desktop (Liste Chip+Badge, Kopf Format+Badge aus ungespeichertem Stand, Icons, Stern, Seitenleiste Statistik/Simulation/Verstöße mit Banlist-Stand) und Handy (Liste Chip+Badge, Kopf Format sofort gespeichert + Badge, aufklappbar mit Warnungen und Banlist-Stand, Icons ohne Stern, gespeicherter Stand) | Task 6 (`DeckLegalityBadge`, `DeckBanIcon`, `DeckSidebar`, `DeckBuilder`), Task 9 (`setFormat`), Task 10 (`LegalityBadge`, `DeckLegalityHead`, `BanIcon`, `rememberLegalityCatalog`); Plan-Ergänzungen 4, 5, 9, 14, 18 |
| §8 Fehlerfälle (Katalog fehlt/ohne Felder; Spalte `format` fehlt → TCG + Meldung; Spalte `role` fehlt → Sterne nicht gespeichert; Deck ohne Main; Karte in mehreren Abschnitten; Artwork+Haupt zusammen) | Task 1 (`catalogLegality` ohne `aliases`), Task 8 (`meta.legality`), Task 3/7 (`normalizeFormat`, „Katalog fehlt", „Leeres Deck", Artwork-Fälle), Task 5 (`FORMAT_SAVE_FAILED`, Rückfall ohne `role`), Task 9 (`setFormat`-Meldung, `parseDeck` → tcg), Task 4 (`NO_MAIN`, `NO_STARTERS`); Plan-Ergänzungen 3, 12 |
| §9 Einspiel-Reihenfolge SQL → Installer + „Katalog jetzt bauen" → APK + „Jetzt prüfen" | Task 11 Übergabe |
| §10 Tests (Katalog-Bau: Zuordnung, Ban-Werte, fehlend = null; Handy-Parser inkl. alter Katalog; Legalität jede Grenze JS+Kotlin; `canAddCopy`/`canonicalPasscode` JS+Kotlin; Starthand bekannte Werte und Kanten, Testhand; Desktop Save Deck behält `role`/`format`, Import löst Artworks, IPC in beiden Dateien; Handy Hinzufügen erhöht Zeile, Grenze, v4-Upgrade; Schutz-Tests scheitern ohne Schutz; E1/E2-Aufrufer geprüft) | Task 1 (catalog-build/-prices Tests), Task 2/3/4 (Fixtures, `deckOdds.test.js` inkl. BigInt-Abgleich), Task 5 (`decks.test.cjs`, `saveDeckPayload.test.js`, `ipc-channels`), Task 7/8/9 (Kotlin-Tests, `CatalogDb`-Schema-Test, `AddCopyPlan`); gemessene Schutz-Nachweise in Task 1, 2, 3, 4, 5, 7, 8, 9; Aufrufer: Plan-Ergänzung 13 |
| §11 Abnahme 1–6 | Task 11 Abnahme (5 mit exaktem Wert, Plan-Ergänzung 15) |

**Platzhalter-Suche:** Kein „TBD", kein „wie in Task N". Jeder Code-Schritt enthält den vollständigen Code bzw. exakte, im Zielstand eindeutige Ersetzungsblöcke; beides stammt unverändert aus der vorab geprüften Scratch-Kopie.

**Namens- und Typkonsistenz:**
- SQL: `decks.format` (`decks_format_check`), `deck_cards.role` (`deck_cards_role_check`); Katalog-JSON: `aliases`, `ban_tcg`, `ban_ocg`, `built_at`; Handy: `card_aliases(alt_id, card_id)`, `meta.built_at`, `meta.legality`.
- Texte (gleichnamig in JS und Kotlin, Werte aus `legality.json`): „Main Deck: n Karten (erlaubt 40–60)", „Extra Deck: n Karten (höchstens 15)", „Side Deck: n Karten (höchstens 15)", „… im Main Deck gehört ins Extra Deck", „… im Extra Deck gehört ins Main Deck", „…: n Kopien (höchstens 3)", „… ist verboten", „…: n Kopien (limitiert 1)", „…: n Kopien (semi-limitiert 2)", „Banlist unbekannt: Passcode …", `CATALOG_MISSING_BANLIST` „Katalog fehlt – Banlist unbekannt", `COPY_LIMIT` „Höchstens 3 Kopien je Karte", `FORMAT_SAVE_FAILED` „Format konnte nicht gespeichert werden", `FORMAT_LABELS` „TCG"/„OCG"/„Frei", `BAN_LABELS` „Verboten"/„1"/„2", Badge „Legal"/„Legal · n Warnung(en)"/„n Verstoß/Verstöße"/„Frei", „Banlist-Stand: TT.MM.JJJJ". Nur Desktop: `NO_MAIN` „Keine Main-Deck-Karten", `NO_STARTERS` „Markiere Starthand-Ziele mit dem Stern", „n Karten: mindestens 1 Starter x,x %", „0: … · 1: … · 2+: …", „Testhand ziehen (5|6)", Reiter „Statistik"/„Simulation"/„Verstöße", „Keine Verstöße". Nur Handy: „Format: TCG ▾".
- JS ↔ Kotlin: `canonicalPasscode` ↔ `DeckImport.canonicalPasscode`, `resolveImport(parsed, cards, aliases)` ↔ `DeckImport.resolve(parsed, catalog, aliases)`, `deckLegality` ↔ `DeckLegality.check`, übrige Legalitäts-Helfer gleichnamig; Karten JS `{ card_id, name, count, section }` ↔ `LegalityCard(cardId, name, count, section)`; Katalog JS `{ aliases, cards: { id: { name, type, ban_tcg, ban_ocg } } }` ↔ `LegalityCatalog(aliases, cards: Map<String, LegalityInfo(name, type, banTcg, banOcg)>, builtAt)`; Ergebnis `{ legal, violations: [{ rule, cardId, text }], warnings: [{ cardId, text }] }` ↔ `LegalityResult(legal, violations: List<LegalityIssue(rule, cardId, text)>, warnings)`.
- IPC: `get-catalog-legality`/`getCatalogLegality()`, `save-deck`/`saveDeck(deckId, cards, notes, format)`, `get-deck-details` (+`role`), `get-catalog-cards` (+`aliases`).
- Fixture-Schlüssel: `catalog`, `bases`, `legality`, `formats`, `ban`, `banlistDate`, `violationCount`, `canAddCopy` (legality); zusätzlich `aliases`, `canonical`, `resolve[].aliases` (import) gleich in allen Lesern.
