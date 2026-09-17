# Spec H1 Duplikate & Verkaufsliste — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beide Geräte erkennen Duplikate (alles über `keep_per_card` je Haupt-Passcode, mit Vorschlag, welche Exemplare gehen) und führen eine Verkaufsliste als Zustand am Exemplar (`card_copies.for_sale`): PC-Chips „Duplikate" und „Zum Verkauf" mit Markieren, „Zurück in die Sammlung" und F1-Export, Handy-Chip-Zeile `Alle · Duplikate · Zum Verkauf`, Schalter im Exemplar-Sheet, Preisschild im Karten-Detail und im Deckbuilder, Zusatz „(n zum Verkauf)", Start-Zähler, „davon zum Verkauf", Minus-Regel „markierte zuerst" und die Einstellung `keep_per_card`.

**Architecture:** Die Regeln (Gruppierung über den Haupt-Passcode, Überschuss, Vorschlags-Sortierung nach den Kriterien 1–6, Summen, alle Texte, Zeilen-Schalter-Regel §5.4, `keep_per_card`) wohnen im Zwilling `desktop/src/utils/duplicates.js` ↔ `android/.../ml/Duplicates.kt`, beide gegen `docs/fixtures/duplicates/duplicates.json` getestet. Der PC-Hauptprozess liefert über den neuen Kanal `list-sale-copies` alle lebenden Exemplare lebender Printings samt Preisfeldern und `main_id` (E3-Artwork-Zuordnung `catalogMainId`) und schaltet über `set-for-sale` um (`copies.cjs#setForSale`, idempotent, stempelt `updated_at` nur bei Änderung); die Minus-Regel (`copies.cjs#removeCopies`) nimmt markierte Exemplare zuerst. Der Renderer rechnet Duplikate/Verkaufsliste mit dem Zwilling (`useSaleData`), Schreibaktionen laufen durch ein getestetes Busy-Gatter (`busyGate.js`). Das Handy liest `for_sale` (CopyRow, `StoreQueries.COPY_COLS`), patcht es über `CollectionRepository.setForSale` durch das `InFlight`-Gatter mit frischem Stand und nimmt beim Minus markierte zuerst (`removalOrder`). Der PC-Sync (`sync.cjs`) spiegelt `for_sale` seit Spec A und bleibt unverändert. Kein SQL.

**Tech Stack:** Electron CJS + better-sqlite3, React/Vite + lucide-react, node:test; Kotlin/Compose (Material3), org.json, JUnit4.

**Spec:** `docs/superpowers/specs/2026-09-17-spec-h-nachtrag-h1-duplikate-verkaufsliste.md` (verbindlich, vom Nutzer Abschnitt für Abschnitt abgesegnet). Hintergrund: `docs/superpowers/specs/2026-09-05-spec-h-selling-design.md` (der Nachtrag hat Vorrang). Plan-Basis `c8f584f`.

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus, verbinden sich nie mit Supabase und rufen keine Edge Functions auf.
- Immer explizite Pfade stagen, nie `git add -A` und NIE `git stash` — auch nicht für Schutz-Nachweise: Schutz per Edit sabotieren, Fehlschlag zitieren, Sabotage per Edit zurücknehmen.
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI).
- `cards.quantity`, `cards.deleted` und `cards.price_first_ed` schreibt die App nie; es gibt nur Soft-Delete.
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs`.
- Sichtbare Texte sind deutsch mit echten Umlauten, „Fächer" statt „Taschen".
- Regeln wohnen in reinen, getesteten Helfern.
- Absichtliche Zwillinge werden im Kopfkommentar markiert (mit Nennung des anderen Zwillings) und auf beiden Seiten gegen gemeinsame Fixtures getestet.
- Kotlin-Rundung von Geld und Zahlen mit `java.lang.Math.round` (nie `kotlin.math.round`).
- Regex-Zwillinge: Ziffern als `[0-9]` (nie `\d`), Unicode-Leerraum JS `\s` ↔ Kotlin `(?U)`.
- Leere Strings werden wie `null` behandelt.
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`). Ein sechster ist ein Fehlschlag.
- Ein Test, der gegen einen Fehler schützt, muss nachweislich ohne den Schutz scheitern: Schutz kurz sabotieren, Fehlschlag im Bericht zitieren, Sabotage zurücknehmen.
- Handy-Mutationen laufen durch das `InFlight`-Gatter und rechnen mit dem frischen Stand (innerhalb der Mutation gelesen), nie mit dem Kompositions-Schnappschuss.
- Ein Platzhalter darf nie wie eine leere Sammlung aussehen: solange gerechnet wird, steht „…", nie „0 Karten".
- Geteilte Funktionen: Ein Schutz oder eine Erweiterung in einer geteilten Funktion darf das Verhalten der anderen Aufrufer nicht ändern — alle Aufrufer prüfen.
- Legalität und Kopien (hier: Duplikate) zählen über den Haupt-Passcode.
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Neue Commits, nie `--amend`.
- H1-spezifisch nicht drin (Nachtrag §3): „Verkauft" (→ H2), „Nachprüfen"-Chip, Unbekannt/Unvollständig/Foils am Handy, Export am Handy, Wischgesten, Per-Karte-Behalte-Wert, Sync von `keep_per_card`. Keine SQL-Datei, kein Deploy.

**Befehle:**
- Desktop SQLite-Suite (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Desktop Sync-Skript (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
- Desktop-Helfer (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs`
- Desktop-Lint (in `desktop/`): `npx eslint .` → genau `5 errors` (3 warnings). Gelintet werden nur `*.js`/`*.jsx`.
- Desktop-Build (in `desktop/`): `npx vite build`
- Android (aus der Worktree-Wurzel): `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug` — Testzahl aus `android/app/build/test-results/testDebugUnitTest/*.xml` (Summe der `tests=`-Attribute).

Ausgangszahlen auf `c8f584f` (gemessen): SQLite-Suite 308, `test-sync.cjs` 16× PASS (exit 0), Helfer 250, Lint 5 Fehler/3 Warnungen, `vite build` ok, Android `testDebugUnitTest assembleDebug` BUILD SUCCESSFUL mit 527 Tests/0 Fehlern.

## SQL: keine Änderung — Prüfabfrage für den Nutzer

Laut Nachtrag §9 keine Migration. Der Nutzer führt vor der Installation der neuen APK diese Abfrage im Supabase-SQL-Editor aus (Aliase, weil der Editor gleichnamige Spalten nur einmal zeigt):

```sql
select c.table_schema   as schema_name,
       c.table_name     as tabelle,
       c.column_name    as spalte,
       c.data_type      as datentyp,
       c.is_nullable    as nullbar,
       c.column_default as standardwert
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name   = 'card_copies'
   and c.column_name  = 'for_sale';
```

Erwartet: genau eine Zeile `public | card_copies | for_sale | boolean | NO | false`. Keine Zeile → die Spalte fehlt; dann spielt der Nutzer die Zeile aus `supabase/card_copies_schema.sql` von Hand nach: `alter table public.card_copies add column if not exists for_sale boolean not null default false;` (Agents führen das nie aus). Wichtig: Ab Task 8 fragt das Handy `for_sale` in jeder Exemplar-Abfrage mit ab — fehlt die Spalte, scheitert das Laden aller Exemplare am Handy (PostgREST 400).

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `docs/fixtures/duplicates/duplicates.json` (neu) | gemeinsame Fixture: Kriterien 1–6 einzeln gegen alle späteren, Playset-Grenze, Artwork, Katalog fehlt, `keep`, Texte, Verkaufsliste, Schalter | 1 |
| `desktop/src/utils/duplicates.js` + `.test.js` (neu) | JS-Zwilling: `keepPerCard`, `duplicates`, Summen, `forSaleGroups`, Texte, Schalter-Regel | 1 |
| `desktop/src/utils/busyGate.js` + `.test.js` (neu), `useSaleData.js` (neu) | Busy-Gatter (PC-Gegenstück zu `InFlight`), Lade-Hook für `list-sale-copies` + `keep_per_card` | 2 |
| `desktop/electron/copies.cjs`, `copies-for-sale.test.cjs` (neu) | `setForSale`, `listSaleCopies`, Minus-Regel, `listDeckCopies` + `for_sale` | 3 |
| `desktop/electron/main.cjs`, `preload.cjs`, `ipc-channels.test.cjs` | Kanäle `list-sale-copies`, `set-for-sale` | 4 |
| `desktop/src/components/CollectionList.jsx`, `CardTile.jsx`, `ExportDialog.jsx`, `DuplicatesList.jsx` (neu), `ForSaleList.jsx` (neu) | Chips, Duplikate-Liste, Verkaufsliste mit Export, Zusatz „(n zum Verkauf)" | 5 |
| `desktop/src/components/CopySheet.jsx`, `CardDetailPanel.jsx`, `Start.jsx`, `Settings.jsx`, `DeckBuilder.jsx` | Schalter, Preisschild, Start-Zähler, „davon zum Verkauf", `keep_per_card`, Deckbuilder-Preisschild | 6 |
| `android/.../cloud/CopyRow.kt`, `ml/Duplicates.kt` (neu), `DuplicatesTest.kt` (neu) | `CopyRow.forSale`, Kotlin-Zwilling | 7 |
| `android/.../cloud/StoreQueries.kt`, `cloud/CollectionRepository.kt`, `StoreQueriesTest.kt`, `SaleCopiesRepoTest.kt` (neu) | `for_sale` lesen, `setForSale`, `removalOrder` | 8 |
| `android/.../ui/SaleLists.kt` (neu), `ui/CollectionScreen.kt`, `Prefs.kt`, `ui/SettingsScreen.kt` | Chip-Zeile, Duplikate/Zum Verkauf am Handy, `keep_per_card` | 9 |
| `android/.../ui/CopySheet.kt`, `ui/CardDetailScreen.kt`, `ui/StartScreen.kt`, `ui/AppNav.kt`, `ui/DecksScreen.kt` | Schalter, Preisschild, Start-Zähler, Chip öffnen, Deck-Preisschild | 10 |

`android/...` steht für `android/app/src/main/java/com/example/yugiohscanner` (Paket `com.example.yugiohscanner`). Android-Tests liegen unter `android/app/src/test/java/com/example/yugiohscanner/`, lesen Fixtures über `Fixtures.text("docs/fixtures/...")` und laufen auf der JVM ohne Robolectric; `DeckFixtureWorld.Companion.objects` (E1) wird wiederverwendet.

Jede Datei wird in genau einem Task geändert. Reihenfolge strikt 1 → 10 im selben Worktree, Task 11 macht der Controller. Abhängigkeiten: 2 braucht 1; 4 braucht 3; 5 braucht 1, 2, 4; 6 braucht 1, 2, 4 (und zur Laufzeit den Anfangs-Chip aus 5); 7 braucht die Fixture aus 1; 8 braucht 7; 9 braucht 7, 8; 10 braucht 8, 9. Jeder Task baut und testet für sich grün.

**Vorab geprüft (Plan-Autor, Scratch-Kopie von `c8f584f` außerhalb des Repos per `git archive`, `desktop/node_modules` als Junction, ohne `local.properties`):** Aller Code dieses Plans stand dort genau so. Neue Dateien sind aus der Kopie eingefügt; die Änderungsblöcke sind maschinell gegen `c8f584f` erzeugt. Danach wurde der fertige Plan maschinell auf eine frische Kopie von `c8f584f` angewendet (jeder alte Block kommt an seiner Stelle genau einmal vor), Task für Task mit den Befehlen oben geprüft und der Endstand mit der Scratch-Kopie verglichen: Alle Änderungsblöcke ließen sich eindeutig anwenden, die 37 betroffenen Dateien sind danach zeichengleich mit der Scratch-Kopie (Zeilenenden normalisiert). Gemessen je Task: Task 1 Helfer 274, Task 2 Helfer 276, Task 3 SQLite-Suite 316, Task 4 SQLite-Suite 318 und `test-sync.cjs` 16× PASS, Tasks 1/2/5/6 Lint 5 Fehler/3 Warnungen, Tasks 5/6 `vite build` ok, Task 7 Android 533 Tests/0 Fehler, Tasks 8–10 Android 537 Tests/0 Fehler (jeweils `BUILD SUCCESSFUL`, am Endstand zusätzlich `compileDebugAndroidTestKotlin` ok); jeder Schritt „Fehlschlag bestätigen" ist an genau seiner Stelle gemessen. Endstand: SQLite-Suite 318/318, `test-sync.cjs` 16× PASS (exit 0), Helfer 276/276, `npx eslint .` 5 Fehler/3 Warnungen, `vite build` ok, Android 537 Tests/0 Fehler. Alle Schutz-Nachweise unten sind gemessen (Sabotage angewendet, Fehlschlag zitiert, zurückgenommen). Die Oberflächen (Tasks 5, 6, 9, 10) sind nur kompiliert, gelintet bzw. per Gradle gebaut, nicht im Fenster/am Gerät geklickt.

## Befunde aus dem Code-Abgleich

1. **`for_sale` ist am PC komplett verdrahtet und getestet:** SQLite-Spalte (`copies-schema.cjs`), `sync.cjs` `COPY_COLS`/`COPY_BOOLS` (Push als Boolean, Pull als 0/1; der Pull-Vergleich `applyRemoteCopy` läuft über alle `COPY_COLS`), `test-sync.cjs` prüft `copyToRemote`/`remoteToLocalCopy` mit `for_sale` bereits (Nachtrag §8 „Sync PC" ist damit abgedeckt). `sync.cjs` bleibt unverändert. Weil der PC `for_sale` seit Spec A in jedem Exemplar-Push mitschickt, würde eine fehlende Cloud-Spalte schon heute jeden Copies-Push scheitern lassen — die Spalte existiert daher sehr wahrscheinlich; die Prüfabfrage bestätigt es.
2. **Handy kennt `for_sale` nicht:** `CopyRow`, `StoreQueries.COPY_COLS` und `CollectionRepository.parseCopies` fehlen die Spalte (ebenso `needs_review`/`review_reason`, bleibt so). `StoreQueriesTest` prüft `COPY_COLS` zeichengenau und wird in Task 8 mitgezogen.
3. **`updated_at`:** `trg_copies_updated` stempelt am PC ohnehin jedes UPDATE; `setForSale` setzt `updated_at` trotzdem ausdrücklich (Muster `setCopyLocation`) und schreibt nur Zeilen mit anderem Wert (`for_sale IS NOT @v`), damit ein Doppelaufruf weder neu stempelt noch einen Push auslöst. In der Cloud stempelt `trg_card_copies_updated_at` (before update); der Handy-PATCH filtert deshalb ebenfalls `for_sale=eq.<alt>`.
4. **Minus am PC:** Die Oberfläche ruft `remove-copy` nur aus `CardDetailPanel.changeGroup` und immer MIT Edition/Zustand (Gruppenzweig, bisher `ORDER BY created_at DESC`). Der Standardzweig (ohne Gruppe) wird nur von `update-card-meta` benutzt, das keinen Renderer-Aufrufer hat (nur `preload.cjs#updateCardMeta`). H1 stellt `for_sale` in BEIDEN Zweigen voran — sonst wäre die Regel in der Oberfläche wirkungslos. Die bestehenden `copies.test.cjs`-Fälle (ohne markierte Exemplare) bleiben unverändert grün. Handy: `removeCopies` wird nur vom „−" in `CardDetailScreen` gerufen; `removalOrder` ändert nur die Reihenfolge der frisch vom Server gelesenen Gruppe.
5. **Geteilte Funktionen, Aufrufer geprüft:** `copies.listDeckCopies` (nur `list-deck-copies` → `DeckBuilder.fetchCoverageData`; neue Spalte `for_sale`, E1-Abgleich zählt unverändert), `copies.removeCopies` (Befund 4), `ExportDialog` (Aufrufer `CollectionList`, `Settings`; neue Props mit Vorgabe, Verhalten unverändert), `CardTile` (Aufrufer `CollectionList`, `Start`; neues Prop `saleNote` mit Vorgabe `null`), `CopyRow(...)` (neues Feld `forSale` mit Vorgabe am Ende, alle bestehenden Konstruktoraufrufe kompilieren), `CollectionRepository.parseCopies` (nur `private` → `internal`), `StartScreen(...)` (einziger Aufrufer `AppNav`, zwei neue Pflicht-Callbacks im selben Task), `DeckCardRow` (Handy: drei Aufrufer in `DecksScreen`, alle mitgezogen). `listAllCopies`, `listCopies` (`SELECT *` liefert `for_sale` schon) und `sync.cjs` bleiben unverändert.
6. **Artwork-Zuordnung:** PC im Hauptprozess `catalog-prices.cjs#catalogMainId` (ohne Katalogdatei der gespeicherte Passcode; je Aufruf ein `fs.statSync`, deshalb memoisiert `listSaleCopies` je Passcode). Handy `CatalogRepository.aliases(ids)` (E3, Katalog v4; ohne Katalog leer → gespeicherter Passcode). Der Renderer bekommt `main_id` je Exemplar geliefert und muss keinen 1,4-MB-Legalitätsindex laden.
7. **Sammlung PC ist ein Kachelraster** (`CardTile`, `react-window`), keine Zeile mit Mengenspalte: der Zusatz „(n zum Verkauf)" steht in der Kachel unter dem Namen. Handy: in der Listenansicht unter dem Namen; die Rasteransicht (nur Bild, Menge, Wert) bekommt keinen Zusatz.
8. **Deckbuilder:** Verfügbarkeit (E1 `deckCoverage`/`DeckCoverage`) zählt alle lebenden Exemplare, markierte also weiter mit — nichts zu ändern. Das Preisschild hängt am selben Schlüssel wie der Abgleich (gespeicherter Passcode der Deckkarte, vgl. E3 Plan-Ergänzung 16).
9. **Export:** `ExportDialog` kann bereits einen festen Exemplar-Umfang (`filterCopyIds` → `{ kind: 'copies' }`); F1 `saleListText` lässt Unknown-Exemplare weg und meldet „… ohne Set-Code weggelassen". „Exportieren" aus „Zum Verkauf" öffnet den Dialog mit Format „Verkaufsliste (Text)" und Umfang „Zum Verkauf" (genau die markierten Exemplare); Format und Umfang bleiben im Dialog änderbar.
10. **Einstellungen:** PC über die vorhandenen Kanäle `get-settings`/`save-setting` (Schlüssel `keep_per_card`, kein neuer Kanal), Handy `Prefs` (SharedPreferences). Beide normalisieren über den Zwilling `keepPerCard`.
11. **Start → Liste:** PC navigiert mit `state.segment` nach `/sammlung/karten` (`CollectionList` liest den Anfangs-Chip daraus). Handy: prozessweites Postfach `CollectionChip` (Muster `DeckImportInbox`) und Navigation ohne `restoreState` (Lehre F2 aus E2: `navigateTop` stellt sonst einen gespeicherten Sammlungs-Reiter wieder her).
12. **Doppeltipp-Schutz:** PC-Listen über `busyGate.js` (synchron vor dem ersten `await`, getestet, Knöpfe/Schalter zusätzlich `disabled`); `CopySheet.jsx` nutzt sein bestehendes `busyRef` (geteilt mit Speichern/Entfernen). Handy-Listen über `InFlight` + frischen Stand (`freshSaleData` liest `CollectionStore.state.value` innerhalb der Mutation) und `CollectionStore.awaitSync()` vor der Freigabe; `CopySheet.kt` nutzt sein bestehendes `savingRef`-Gatter (geteilt mit Speichern/Entfernen, gleiche Wirkung).
13. Außerhalb von H1 gesehen, nicht angefasst: `update-card-meta` hat keinen Renderer-Aufrufer (Befund 4); `CollectionList` hält `viewMode` ungenutzt (Teil der Lint-Baseline).

## Offene Punkte / Abweichungen (bitte dem Nutzer vorlegen)

1. **Reihenfolge der Duplikat-Liste (Spec schweigt):** Überschuss absteigend, dann Wert des Vorschlags absteigend, dann Haupt-Passcode. Empfehlung: so übernehmen.
2. **Gleichstand in allen sechs Kriterien:** kleinere `copy_id` zuerst. Grund: die Eingabereihenfolge unterscheidet sich zwischen PC (`created_at`) und Handy (Speicher), „stabil" allein ergäbe verschiedene Vorschläge. Leeres `created_at` zählt als ältestes. Empfehlung: übernehmen.
3. **Kriterium 2 im Detail:** „mit Standort/Tags/Notiz" = `container_id` nicht leer ODER mindestens ein Tag (kaputte Tags-Zelle = keine Tags) ODER Notiz nicht nur Leerraum. Unbekannter Zustand ordnet wie NM (Kriterium 4). Kriterium 5 vergleicht `unitPrice` (ohne Zustandsfaktor).
4. **Zeilen-Schalter §5.4:** „An" schreibt alle Vorschläge (bereits markierte werden durch den Idempotenz-Filter nicht neu geschrieben). Die Vorgeschichte „vorher markiert" gilt je Haupt-Passcode, solange die Ansicht offen ist (PC: bis der Chip gewechselt oder die Seite verlassen wird; Handy: bis die Liste verlassen wird). Wird ein Vorschlag durch Markierungen an anderer Stelle so verändert, dass mehr markierte Exemplare als Überschuss existieren, rechnet der Schalter mit dem aktuellen Vorschlag. Empfehlung: übernehmen.
5. **Zahlformate:** „ca. 62 €", „Zum Verkauf: … · 84 €", „davon zum Verkauf: 84 €" in ganzen Euro (kaufmännisch über `Math.round`, Tausenderpunkt), „84,30 €" und Wert je Exemplar in Cent; Karte ohne Preis „—", Summen rechnen 0. „über Playset" steht auch, wenn `keep_per_card` ≠ 3 (Spec-Wortlaut). Empfehlung: übernehmen; alternativ bei `keep` ≠ 3 „über Behalten-Grenze" (würde Zwilling und Fixture ändern).
6. **Neue Texte (nicht in der Spec):** „Keine Duplikate.", „Keine Exemplare zum Verkauf.", „Verkaufsdaten konnten nicht geladen werden.", Start bei Ladefehler „Zum Verkauf: —"/„Duplikate: —", PC-Einstellung „Duplikate: behalten je Karte" mit „Alles über dieser Anzahl je Karte (über alle Printings) erscheint unter „Duplikate“. Ganze Zahl 1–99, Standard 3. Wird nicht synchronisiert – auf beiden Geräten gleich einstellen.", Handy „Duplikate: behalten je Karte" + „Ganze Zahl 1–99, Standard 3. Wird nicht synchronisiert – auf beiden Geräten gleich einstellen.", Handy-Bestätigung Titel „Auf die Verkaufsliste", Knöpfe „Markieren"/„Abbrechen" (PC nutzt `confirm()` mit „31 Exemplare von 14 Karten markieren?"), Fehler „Ungültige Exemplar-Liste.", „Ungültiger Wert für „Zum Verkauf".", „Verkaufsliste ändern fehlgeschlagen (Code): …".
7. **Chip-Zähler:** PC „Duplikate" zählt Karten, „Zum Verkauf" Exemplare, beide „…" während des Ladens. Handy-Chips ohne Zähler (Spec nennt nur die Namen). Suche, Sortierung und Filter der Sammlung wirken nicht auf Duplikate/Zum Verkauf (PC: Filterleiste bleibt sichtbar; Handy: Sortierung und aktive Filter werden dort ausgeblendet).
8. **Zeilen-Klick:** Duplikate-Zeile öffnet das Karten-Detail des Printings des ersten Vorschlags, Verkaufsliste das des Printings. Bei einer Artwork-Gruppe kann das ein Alt-Art-Passcode sein; das Detail zeigt nur die Printings dieses gespeicherten Passcodes.
9. **„davon zum Verkauf"** nur auf der Start-Wertkarte (PC „Sammlungswert", Handy „Gesamtwert") und nur, wenn mindestens ein Exemplar markiert ist; Insights › Wert bleibt unverändert. Empfehlung: übernehmen.
10. **Wert je Exemplar in der Verkaufsliste** über die Wertanzeige-Formel, Summe = gerundete Summe der ungerundeten Einzelwerte (wie `valueOf`); F1-`saleListText` rundet dagegen je Stück — Cent-Abweichungen zwischen Kopf und exportierter Datei sind möglich. Empfehlung: hinnehmen.
11. **Handy-Rechenweg:** Duplikate/Verkaufsliste werden bei jeder Speicheränderung abseits des Hauptthreads neu gerechnet (inklusive Artwork-Nachschlagen in Blöcken zu 500); bis dahin „…". Der Speicher liefert bei einem Abgleich ohne Änderung dieselbe Liste, dann bleibt die Anzeige stehen.
12. **Abnahme 4 (Handy → PC):** hängt an der Prüfabfrage (Abschnitt SQL). APK erst installieren, wenn sie eine Zeile liefert.

---
### Task 1: JS-Zwilling `duplicates.js` mit gemeinsamer Fixture

**Files:**
- Create: `docs/fixtures/duplicates/duplicates.json`
- Create: `desktop/src/utils/duplicates.test.js`
- Create: `desktop/src/utils/duplicates.js`

**Interfaces:**
- Consumes: `valuation.js` (`unitPrice`, `conditionFactor`, `EDITION_LABELS`), `tags.js#parseTags`, `format.js#fmtNum`.
- Produces (für Task 2, 5, 6; Zwilling in Task 7): Exemplar-Zeile `{ copy_id, card_id, main_id?, set_code, language, rarity, edition, condition, container_id, tags, note, for_sale, created_at, deleted?, name, image_url?, price, price_first_ed }`; `KEEP_DEFAULT = 3`, `LOADING = '…'`, `keepPerCard(raw) → number`, `hasPlace(copy) → boolean`, `unitValue(copy) → number`, `duplicates(copies, keep, mainIdOf?: (passcode) => string|null|undefined) → [{ main_id, count, surplus, copy_ids: string[], value }]`, `duplicatesSummary(list) → { cards, copies, value }`, `forSaleSummary(copies) → { copies, value }`, `forSaleGroups(copies) → [{ card_id, set_code, language, rarity, name, copy_ids }]`, `euroCents(v)`, `euroWhole(v)`, `headerText(summary)`, `confirmAllText(summary)`, `rowCountText(entry)`, `proposalTexts(entry, copiesById: Map) → string[]`, `forSaleHeaderText(s)`, `startSaleText(s)`, `startDuplicatesText(summary)`, `saleShareText(s)`, `forSaleSuffix(n) → string|null`, `copyValueText(copy)`, `toggleIsOn(entry, forSaleIds: Set)`, `premarkedIds(entry, forSaleIds) → string[]`, `toggleTargets(entry, on, premarked|null) → { ids, value }`, `allProposalIds(list, forSaleIds) → string[]`.
- Produces (Fixture, für Task 7): `docs/fixtures/duplicates/duplicates.json` mit `base`, `aliases`, `cases[]` (`name`, `keep`, `catalog`, `copies`, `expected`, optional `texts`, `allProposalIds`), `keep[]`, `euro[]`, `forSale` (`copies`, `expected`, `texts`, `copyValues`, `groups`), `summaryTexts[]`, `suffix[]`, `toggle` (`entry`, `cases[]`).

- [ ] **Step 1: Fixture anlegen** — `docs/fixtures/duplicates/duplicates.json` (UTF-8, LF):

Vollständiger Inhalt von `docs/fixtures/duplicates/duplicates.json`:

```json
{
  "_comment": "Spec H1 §4/§5 -- gemeinsame Fixture fuer desktop/src/utils/duplicates.js und android ml/Duplicates.kt. Jedes Exemplar in cases[].copies und forSale.copies ist `base` plus die angegebenen Felder. catalog = true: Artwork-Passcodes laufen ueber `aliases` zur Hauptkarte. Die Kriterien-Faelle stellen das gepruefte Kriterium gegen alle spaeteren (das andere Exemplar gewinnt dort jedes Mal).",
  "base": {
    "card_id": "46986414", "name": "Dunkler Magier", "set_code": "LOB-DE005", "language": "DE", "rarity": "Common",
    "edition": "unlimited", "condition": "NM", "container_id": null, "tags": null, "note": null,
    "for_sale": false, "deleted": false, "created_at": "2026-09-01 10:00:00", "price": 2, "price_first_ed": null
  },
  "aliases": { "46986415": "46986414" },
  "cases": [
    {
      "name": "Playset-Grenze: 3 Exemplare, kein Überschuss",
      "keep": "3", "catalog": true,
      "copies": [
        { "copy_id": "a1", "created_at": "2026-09-01 10:00:01" },
        { "copy_id": "a2", "created_at": "2026-09-01 10:00:02" },
        { "copy_id": "a3", "created_at": "2026-09-01 10:00:03" }
      ],
      "expected": [],
      "texts": { "header": "0 Karten · 0 Exemplare über Playset · ca. 0 €", "confirm": "0 Exemplare von 0 Karten markieren?", "startDuplicates": "Duplikate: 0 Karten", "rows": [], "proposals": [] }
    },
    {
      "name": "Playset-Grenze: 4 Exemplare, 1 über Playset (das neueste)",
      "keep": "3", "catalog": true,
      "copies": [
        { "copy_id": "b1", "created_at": "2026-09-01 10:00:01" },
        { "copy_id": "b2", "created_at": "2026-09-01 10:00:02" },
        { "copy_id": "b3", "created_at": "2026-09-01 10:00:03" },
        { "copy_id": "b4", "created_at": "2026-09-01 10:00:04" }
      ],
      "expected": [{ "main_id": "46986414", "count": 4, "surplus": 1, "copy_ids": ["b4"], "value": 2 }],
      "texts": {
        "header": "1 Karte · 1 Exemplar über Playset · ca. 2 €", "confirm": "1 Exemplar von 1 Karte markieren?", "startDuplicates": "Duplikate: 1 Karte",
        "rows": ["4 Exemplare · 1 über Playset"], "proposals": [["1× LOB-DE005 Common · NM · Unlimited"]]
      }
    },
    {
      "name": "Kriterium 1: bereits markiert vor nicht markiert",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c1a", "for_sale": true, "container_id": "k1", "edition": "first", "condition": "MT", "rarity": "Ultra Rare", "price": 10, "price_first_ed": 12, "created_at": "2026-09-01 09:00:00" },
        { "copy_id": "c1b", "set_code": "SDK-DE001", "condition": "PO", "price": 1, "created_at": "2026-09-05 09:00:00" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c1a"], "value": 12 }],
      "texts": {
        "header": "1 Karte · 1 Exemplar über Playset · ca. 12 €", "confirm": "1 Exemplar von 1 Karte markieren?", "startDuplicates": "Duplikate: 1 Karte",
        "rows": ["2 Exemplare · 1 über Playset"], "proposals": [["1× LOB-DE005 Ultra Rare · MT · 1st Ed"]]
      }
    },
    {
      "name": "Kriterium 2: Standort schont",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c2a", "edition": "first", "condition": "MT", "rarity": "Ultra Rare", "price": 10, "price_first_ed": 12, "created_at": "2026-09-01 09:00:00" },
        { "copy_id": "c2b", "container_id": "k1", "set_code": "SDK-DE001", "condition": "PO", "price": 1, "created_at": "2026-09-05 09:00:00" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c2a"], "value": 12 }]
    },
    {
      "name": "Kriterium 2: Tags schonen",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c3a", "edition": "first", "condition": "MT", "rarity": "Ultra Rare", "price": 10, "price_first_ed": 12, "created_at": "2026-09-01 09:00:00" },
        { "copy_id": "c3b", "tags": "[\"Deck\"]", "set_code": "SDK-DE001", "condition": "PO", "price": 1, "created_at": "2026-09-05 09:00:00" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c3a"], "value": 12 }]
    },
    {
      "name": "Kriterium 2: Notiz schont",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c4a", "edition": "first", "condition": "MT", "rarity": "Ultra Rare", "price": 10, "price_first_ed": 12, "created_at": "2026-09-01 09:00:00" },
        { "copy_id": "c4b", "note": "Tausch", "set_code": "SDK-DE001", "condition": "PO", "price": 1, "created_at": "2026-09-05 09:00:00" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c4a"], "value": 12 }]
    },
    {
      "name": "Kriterium 2: leerer Standort, leere Tags und leere Notiz zählen als ohne",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c5a", "container_id": "", "tags": "[]", "note": "  ", "edition": "first", "condition": "MT", "rarity": "Ultra Rare", "price": 10, "price_first_ed": 12, "created_at": "2026-09-01 09:00:00" },
        { "copy_id": "c5b", "tags": "[\"Deck\"]", "set_code": "SDK-DE001", "condition": "PO", "price": 1, "created_at": "2026-09-05 09:00:00" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c5a"], "value": 12 }]
    },
    {
      "name": "Kriterium 3: nicht 1. Auflage vor 1. Auflage",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c6a", "condition": "MT", "price": 10, "created_at": "2026-09-01 09:00:00" },
        { "copy_id": "c6b", "set_code": "SDK-DE001", "edition": "first", "condition": "PO", "price": 1, "created_at": "2026-09-05 09:00:00" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c6a"], "value": 10 }]
    },
    {
      "name": "Kriterium 4: schlechterer Zustand zuerst",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c7a", "condition": "PL", "price": 10, "created_at": "2026-09-01 09:00:00" },
        { "copy_id": "c7b", "set_code": "SDK-DE001", "condition": "NM", "price": 1, "created_at": "2026-09-05 09:00:00" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c7a"], "value": 3.5 }]
    },
    {
      "name": "Kriterium 4: Rangfolge PO < PL < LP < GD < EX < NM < MT",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "r1", "condition": "MT" },
        { "copy_id": "r2", "condition": "NM" },
        { "copy_id": "r3", "condition": "EX" },
        { "copy_id": "r4", "condition": "GD" },
        { "copy_id": "r5", "condition": "LP" },
        { "copy_id": "r6", "condition": "PL" },
        { "copy_id": "r7", "condition": "PO" }
      ],
      "expected": [{ "main_id": "46986414", "count": 7, "surplus": 6, "copy_ids": ["r7", "r6", "r5", "r4", "r3", "r2"], "value": 7.2 }],
      "texts": {
        "header": "1 Karte · 6 Exemplare über Playset · ca. 7 €", "confirm": "6 Exemplare von 1 Karte markieren?", "startDuplicates": "Duplikate: 1 Karte",
        "rows": ["7 Exemplare · 6 über Playset"],
        "proposals": [[
          "1× LOB-DE005 Common · PO · Unlimited", "1× LOB-DE005 Common · PL · Unlimited", "1× LOB-DE005 Common · LP · Unlimited",
          "1× LOB-DE005 Common · GD · Unlimited", "1× LOB-DE005 Common · EX · Unlimited", "1× LOB-DE005 Common · NM · Unlimited"
        ]]
      }
    },
    {
      "name": "Kriterium 5: billigeres Printing zuerst, ohne Preis = 0",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c8a", "price": null, "created_at": "2026-09-01 09:00:00" },
        { "copy_id": "c8b", "set_code": "SDK-DE001", "price": 3, "created_at": "2026-09-05 09:00:00" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c8a"], "value": 0 }]
    },
    {
      "name": "Kriterium 5: bei 1. Auflage zählt der 1.-Auflage-Preis",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c9a", "edition": "first", "price": 1, "price_first_ed": 9, "created_at": "2026-09-05 09:00:00" },
        { "copy_id": "c9b", "set_code": "SDK-DE001", "edition": "first", "price": 5, "created_at": "2026-09-01 09:00:00" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c9b"], "value": 5 }]
    },
    {
      "name": "Kriterium 6: zuletzt angelegt zuerst",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c10a", "created_at": "2026-09-02 09:00:00" },
        { "copy_id": "c10b", "created_at": "2026-09-01 09:00:00" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c10a"], "value": 2 }]
    },
    {
      "name": "Gleichstand in allen Kriterien: kleinere copy_id zuerst",
      "keep": "1", "catalog": true,
      "copies": [
        { "copy_id": "c11b" },
        { "copy_id": "c11a" }
      ],
      "expected": [{ "main_id": "46986414", "count": 2, "surplus": 1, "copy_ids": ["c11a"], "value": 2 }]
    },
    {
      "name": "Artwork-Passcodes zählen zur Hauptkarte",
      "keep": "3", "catalog": true,
      "copies": [
        { "copy_id": "d1", "created_at": "2026-09-01 10:00:01" },
        { "copy_id": "d2", "created_at": "2026-09-01 10:00:02" },
        { "copy_id": "d3", "created_at": "2026-09-01 10:00:03" },
        { "copy_id": "d4", "card_id": "46986415", "set_code": "CT13-DE003", "rarity": "Ultra Rare", "price": 3, "created_at": "2026-09-01 10:00:04" },
        { "copy_id": "d5", "card_id": "46986415", "set_code": "CT13-DE003", "rarity": "Ultra Rare", "price": 3, "created_at": "2026-09-01 10:00:05" }
      ],
      "expected": [{ "main_id": "46986414", "count": 5, "surplus": 2, "copy_ids": ["d3", "d2"], "value": 4 }],
      "texts": {
        "header": "1 Karte · 2 Exemplare über Playset · ca. 4 €", "confirm": "2 Exemplare von 1 Karte markieren?", "startDuplicates": "Duplikate: 1 Karte",
        "rows": ["5 Exemplare · 2 über Playset"], "proposals": [["2× LOB-DE005 Common · NM · Unlimited"]]
      }
    },
    {
      "name": "Katalog fehlt: gespeicherter Passcode, Artworks getrennt",
      "keep": "3", "catalog": false,
      "copies": [
        { "copy_id": "d1", "created_at": "2026-09-01 10:00:01" },
        { "copy_id": "d2", "created_at": "2026-09-01 10:00:02" },
        { "copy_id": "d3", "created_at": "2026-09-01 10:00:03" },
        { "copy_id": "d4", "card_id": "46986415", "set_code": "CT13-DE003", "rarity": "Ultra Rare", "price": 3, "created_at": "2026-09-01 10:00:04" },
        { "copy_id": "d5", "card_id": "46986415", "set_code": "CT13-DE003", "rarity": "Ultra Rare", "price": 3, "created_at": "2026-09-01 10:00:05" }
      ],
      "expected": []
    },
    {
      "name": "keep einstellbar: 2",
      "keep": "2", "catalog": true,
      "copies": [
        { "copy_id": "e1", "created_at": "2026-09-01 10:00:01" },
        { "copy_id": "e2", "created_at": "2026-09-01 10:00:02" },
        { "copy_id": "e3", "created_at": "2026-09-01 10:00:03" }
      ],
      "expected": [{ "main_id": "46986414", "count": 3, "surplus": 1, "copy_ids": ["e3"], "value": 2 }]
    },
    {
      "name": "keep ungültig (0) gilt als 3",
      "keep": "0", "catalog": true,
      "copies": [
        { "copy_id": "f1", "created_at": "2026-09-01 10:00:01" },
        { "copy_id": "f2", "created_at": "2026-09-01 10:00:02" },
        { "copy_id": "f3", "created_at": "2026-09-01 10:00:03" }
      ],
      "expected": []
    },
    {
      "name": "Mehrere Karten: Unknown zählt mit, gelöschte nicht, Reihenfolge nach Überschuss und Wert",
      "keep": "3", "catalog": true,
      "copies": [
        { "copy_id": "x1", "created_at": "2026-09-01 10:00:01" },
        { "copy_id": "x2", "created_at": "2026-09-01 10:00:02" },
        { "copy_id": "x3", "created_at": "2026-09-01 10:00:03" },
        { "copy_id": "x4", "created_at": "2026-09-01 10:00:04" },
        { "copy_id": "x5", "set_code": "Unknown", "rarity": "Unknown", "edition": "unknown", "price": 0, "created_at": "2026-09-01 10:00:05" },
        { "copy_id": "x6", "deleted": true, "created_at": "2026-09-01 10:00:06" },
        { "copy_id": "z1", "card_id": "55144522", "name": "Topf der Gier", "set_code": "LOB-DE046", "price": 1, "created_at": "2026-09-01 10:00:01" },
        { "copy_id": "z2", "card_id": "55144522", "name": "Topf der Gier", "set_code": "LOB-DE046", "price": 1, "created_at": "2026-09-01 10:00:02" },
        { "copy_id": "z3", "card_id": "55144522", "name": "Topf der Gier", "set_code": "LOB-DE046", "price": 1, "created_at": "2026-09-01 10:00:03" },
        { "copy_id": "z4", "card_id": "55144522", "name": "Topf der Gier", "set_code": "LOB-DE046", "price": 1, "created_at": "2026-09-01 10:00:04" },
        { "copy_id": "y1", "card_id": "89631139", "name": "Blauäugiger w. Drache", "set_code": "SDK-DE001", "rarity": "Ultra Rare", "condition": "EX", "price": 8, "created_at": "2026-09-01 10:00:01" },
        { "copy_id": "y2", "card_id": "89631139", "name": "Blauäugiger w. Drache", "set_code": "SDK-DE001", "rarity": "Ultra Rare", "price": 8, "created_at": "2026-09-01 10:00:02" },
        { "copy_id": "y3", "card_id": "89631139", "name": "Blauäugiger w. Drache", "set_code": "SDK-DE001", "rarity": "Ultra Rare", "price": 8, "created_at": "2026-09-01 10:00:03" },
        { "copy_id": "y4", "card_id": "89631139", "name": "Blauäugiger w. Drache", "set_code": "SDK-DE001", "rarity": "Ultra Rare", "price": 8, "created_at": "2026-09-01 10:00:04" }
      ],
      "expected": [
        { "main_id": "46986414", "count": 5, "surplus": 2, "copy_ids": ["x5", "x4"], "value": 2 },
        { "main_id": "89631139", "count": 4, "surplus": 1, "copy_ids": ["y1"], "value": 6.8 },
        { "main_id": "55144522", "count": 4, "surplus": 1, "copy_ids": ["z4"], "value": 1 }
      ],
      "texts": {
        "header": "3 Karten · 4 Exemplare über Playset · ca. 10 €", "confirm": "4 Exemplare von 3 Karten markieren?", "startDuplicates": "Duplikate: 3 Karten",
        "rows": ["5 Exemplare · 2 über Playset", "4 Exemplare · 1 über Playset", "4 Exemplare · 1 über Playset"],
        "proposals": [
          ["1× Unknown Unknown · NM · Unbek.", "1× LOB-DE005 Common · NM · Unlimited"],
          ["1× SDK-DE001 Ultra Rare · EX · Unlimited"],
          ["1× LOB-DE046 Common · NM · Unlimited"]
        ]
      },
      "allProposalIds": { "forSale": ["x5"], "ids": ["x4", "y1", "z4"] }
    }
  ],
  "keep": [
    { "raw": "3", "expected": 3 },
    { "raw": "1", "expected": 1 },
    { "raw": "99", "expected": 99 },
    { "raw": "07", "expected": 7 },
    { "raw": " 5 ", "expected": 5 },
    { "raw": "0", "expected": 3 },
    { "raw": "100", "expected": 3 },
    { "raw": "-2", "expected": 3 },
    { "raw": "4.5", "expected": 3 },
    { "raw": "abc", "expected": 3 },
    { "raw": "", "expected": 3 },
    { "raw": null, "expected": 3 }
  ],
  "euro": [
    { "value": 0, "cents": "0,00 €", "whole": "0 €" },
    { "value": 84.3, "cents": "84,30 €", "whole": "84 €" },
    { "value": 61.5, "cents": "61,50 €", "whole": "62 €" },
    { "value": 1234.5, "cents": "1.234,50 €", "whole": "1.235 €" },
    { "value": 0.125, "cents": "0,13 €", "whole": "0 €" },
    { "value": 1.005, "cents": "1,00 €", "whole": "1 €" }
  ],
  "forSale": {
    "copies": [
      { "copy_id": "s1", "for_sale": true, "condition": "EX", "price": 8 },
      { "copy_id": "s2", "for_sale": true, "price": null, "created_at": "2026-09-02 10:00:00" },
      { "copy_id": "s3", "price": 5 },
      { "copy_id": "s4", "for_sale": true, "deleted": true, "price": 100 },
      { "copy_id": "s5", "for_sale": true, "edition": "first", "price": 1, "price_first_ed": 2.5 },
      { "copy_id": "s6", "for_sale": true, "card_id": "89631139", "name": "Blauäugiger w. Drache", "set_code": "SDK-DE001", "rarity": "Ultra Rare", "price": null }
    ],
    "expected": { "copies": 4, "value": 9.3 },
    "texts": { "header": "4 Exemplare · 9,30 €", "start": "Zum Verkauf: 4 Exemplare · 9 €", "share": "davon zum Verkauf: 9 €" },
    "copyValues": { "s1": "6,80 €", "s2": "—", "s3": "5,00 €", "s5": "2,50 €", "s6": "—" },
    "groups": [
      { "card_id": "89631139", "set_code": "SDK-DE001", "language": "DE", "rarity": "Ultra Rare", "name": "Blauäugiger w. Drache", "copy_ids": ["s6"] },
      { "card_id": "46986414", "set_code": "LOB-DE005", "language": "DE", "rarity": "Common", "name": "Dunkler Magier", "copy_ids": ["s1", "s5", "s2"] }
    ]
  },
  "summaryTexts": [
    { "summary": { "copies": 1, "value": 1.5 }, "header": "1 Exemplar · 1,50 €", "start": "Zum Verkauf: 1 Exemplar · 2 €", "share": "davon zum Verkauf: 2 €" },
    { "summary": { "copies": 0, "value": 0 }, "header": "0 Exemplare · 0,00 €", "start": "Zum Verkauf: 0 Exemplare · 0 €", "share": "davon zum Verkauf: 0 €" }
  ],
  "suffix": [
    { "n": 0, "text": null },
    { "n": 1, "text": "(1 zum Verkauf)" },
    { "n": 2, "text": "(2 zum Verkauf)" }
  ],
  "toggle": {
    "entry": { "main_id": "46986414", "count": 6, "surplus": 3, "copy_ids": ["t1", "t2", "t3"], "value": 6 },
    "cases": [
      { "name": "nichts markiert", "forSale": [], "isOn": false, "premarked": [], "on": ["t1", "t2", "t3"], "offWithHistory": ["t1", "t2", "t3"], "offWithoutHistory": ["t1", "t2", "t3"] },
      { "name": "t1 vorher markiert", "forSale": ["t1", "x9"], "isOn": false, "premarked": ["t1"], "on": ["t1", "t2", "t3"], "offWithHistory": ["t2", "t3"], "offWithoutHistory": ["t1", "t2", "t3"] },
      { "name": "alle markiert", "forSale": ["t1", "t2", "t3"], "isOn": true, "premarked": ["t1", "t2", "t3"], "on": ["t1", "t2", "t3"], "offWithHistory": [], "offWithoutHistory": ["t1", "t2", "t3"] }
    ]
  }
}
```

- [ ] **Step 2: Test schreiben** — `desktop/src/utils/duplicates.test.js`:

Vollständiger Inhalt von `desktop/src/utils/duplicates.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEEP_DEFAULT, LOADING, keepPerCard, duplicates, duplicatesSummary, forSaleSummary, forSaleGroups, euroCents, euroWhole,
  headerText, confirmAllText, rowCountText, proposalTexts, forSaleHeaderText, startSaleText, startDuplicatesText,
  saleShareText, forSaleSuffix, copyValueText, toggleIsOn, premarkedIds, toggleTargets, allProposalIds,
} from './duplicates.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DuplicatesTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/duplicates/duplicates.json', import.meta.url), 'utf8'));
const withBase = (list) => list.map((c) => ({ ...FIX.base, ...c }));
const mainIdOf = (p) => FIX.aliases[p] ?? p;

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    const copies = withBase(c.copies);
    const list = duplicates(copies, c.keep, c.catalog ? mainIdOf : null);
    assert.deepEqual(list, c.expected);
    if (c.texts) {
      const summary = duplicatesSummary(list);
      const byId = new Map(copies.map((x) => [x.copy_id, x]));
      assert.equal(headerText(summary), c.texts.header);
      assert.equal(confirmAllText(summary), c.texts.confirm);
      assert.equal(startDuplicatesText(summary), c.texts.startDuplicates);
      assert.deepEqual(list.map(rowCountText), c.texts.rows);
      assert.deepEqual(list.map((e) => proposalTexts(e, byId)), c.texts.proposals);
    }
    if (c.allProposalIds) {
      assert.deepEqual(allProposalIds(list, new Set(c.allProposalIds.forSale)), c.allProposalIds.ids);
    }
  });
}

test('Fixture: keep_per_card', () => {
  for (const k of FIX.keep) assert.equal(keepPerCard(k.raw), k.expected, JSON.stringify(k.raw));
  assert.equal(KEEP_DEFAULT, 3);
});

test('Fixture: Euro-Texte', () => {
  for (const e of FIX.euro) {
    assert.equal(euroCents(e.value), e.cents, String(e.value));
    assert.equal(euroWhole(e.value), e.whole, String(e.value));
  }
});

test('Fixture: Verkaufsliste, Summen und Texte', () => {
  const copies = withBase(FIX.forSale.copies);
  const s = forSaleSummary(copies);
  assert.deepEqual(s, FIX.forSale.expected);
  assert.deepEqual(forSaleGroups(copies), FIX.forSale.groups);
  assert.equal(forSaleHeaderText(s), FIX.forSale.texts.header);
  assert.equal(startSaleText(s), FIX.forSale.texts.start);
  assert.equal(saleShareText(s), FIX.forSale.texts.share);
  for (const [id, text] of Object.entries(FIX.forSale.copyValues)) {
    assert.equal(copyValueText(copies.find((c) => c.copy_id === id)), text, id);
  }
  for (const t of FIX.summaryTexts) {
    assert.equal(forSaleHeaderText(t.summary), t.header);
    assert.equal(startSaleText(t.summary), t.start);
    assert.equal(saleShareText(t.summary), t.share);
  }
  for (const x of FIX.suffix) assert.equal(forSaleSuffix(x.n), x.text);
});

test('Fixture: Zeilen-Schalter', () => {
  const entry = FIX.toggle.entry;
  for (const c of FIX.toggle.cases) {
    const marked = new Set(c.forSale);
    const pre = premarkedIds(entry, marked);
    assert.equal(toggleIsOn(entry, marked), c.isOn, c.name);
    assert.deepEqual(pre, c.premarked, c.name);
    assert.deepEqual(toggleTargets(entry, true, pre), { ids: c.on, value: true }, c.name);
    assert.deepEqual(toggleTargets(entry, false, pre), { ids: c.offWithHistory, value: false }, c.name);
    assert.deepEqual(toggleTargets(entry, false, null), { ids: c.offWithoutHistory, value: false }, c.name);
  }
});

test('Platzhalter ist nie eine Null', () => {
  assert.equal(LOADING, '…');
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run (in `desktop/`): `node --test src/utils/duplicates.test.js` → FAIL mit `ERR_MODULE_NOT_FOUND` (`Cannot find module '…/src/utils/duplicates.js'`).

- [ ] **Step 4: `desktop/src/utils/duplicates.js` anlegen**

Vollständiger Inhalt von `desktop/src/utils/duplicates.js`:

```js
// Spec H1 §4/§5 -- Duplikate (Überschuss über keep_per_card je Haupt-Passcode, Vorschlag), Verkaufsliste und die Texte dazu.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/Duplicates.kt. Beide laufen gegen
// docs/fixtures/duplicates/duplicates.json. Wer eine Seite aendert, aendert beide.
// Ein Exemplar ist eine Zeile wie main.cjs 'list-sale-copies' (copies.cjs#listSaleCopies): Exemplarfelder plus
// name, image_url, price, price_first_ed des Printings. Der Wert je Exemplar ist die Wertanzeige-Formel
// unitPrice (1.-Auflage-Preis bei edition = 'first', G4) x Zustandsfaktor.
import { unitPrice, conditionFactor, EDITION_LABELS } from './valuation.js';
import { parseTags } from './tags.js';
import { fmtNum } from './format.js';

export const KEEP_DEFAULT = 3;
export const LOADING = '…';

// Schlechtester Zustand zuerst; ein unbekannter Zustand ordnet wie NM.
const CONDITION_RANK = ['PO', 'PL', 'LP', 'GD', 'EX', 'NM', 'MT'];
const KEEP_RE = /^\s*([0-9]{1,2})\s*$/;
const BLANK_RE = /^\s*$/;

const round2 = (v) => Math.round(v * 100) / 100;
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const flag = (v) => (v ? 1 : 0);
const rank = (condition) => {
  const i = CONDITION_RANK.indexOf(condition);
  return i < 0 ? CONDITION_RANK.indexOf('NM') : i;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const WHOLE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

// Einstellung keep_per_card: ganze Zahl 1–99 (Text oder Zahl), alles andere -> 3.
export function keepPerCard(raw) {
  const m = KEEP_RE.exec(raw == null ? '' : String(raw));
  if (!m) return KEEP_DEFAULT;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : KEEP_DEFAULT;
}

// Standort (container_id), Tags oder Notiz gesetzt; leere Werte zaehlen wie nicht gesetzt.
export function hasPlace(copy) {
  const container = copy.container_id;
  if (container != null && container !== '') return true;
  if (parseTags(copy.tags).length > 0) return true;
  return copy.note != null && !BLANK_RE.test(copy.note);
}

// Wert eines Exemplars (ungerundet); ohne Preis 0.
export const unitValue = (copy) => unitPrice(copy, copy) * conditionFactor(copy.condition);

// Stabile Vorschlags-Reihenfolge (Spec H1 §4, Kriterien 1–6); zuletzt copy_id, damit beide Geraete gleich ordnen.
function proposalOrder(a, b) {
  return (flag(b.for_sale) - flag(a.for_sale))
    || (flag(hasPlace(a)) - flag(hasPlace(b)))
    || (flag(a.edition === 'first') - flag(b.edition === 'first'))
    || (rank(a.condition) - rank(b.condition))
    || (unitPrice(a, a) - unitPrice(b, b))
    || cmpStr(String(b.created_at ?? ''), String(a.created_at ?? ''))
    || cmpStr(String(a.copy_id), String(b.copy_id));
}

// copies: lebende Exemplare; keep: keep_per_card (roh oder Zahl); mainIdOf(passcode) -> Haupt-Passcode (null = ohne Katalog).
// -> [{ main_id, count, surplus, copy_ids (Vorschlag in Sortierreihenfolge), value }], nur Karten mit Überschuss,
//    sortiert nach Überschuss, dann Wert des Vorschlags (beide absteigend), dann Haupt-Passcode.
export function duplicates(copies, keep, mainIdOf) {
  const k = keepPerCard(keep);
  const groups = new Map();
  for (const c of copies || []) {
    if (!c || c.deleted) continue;
    const stored = String(c.card_id);
    const mapped = mainIdOf ? mainIdOf(stored) : null;
    const id = mapped == null || mapped === '' ? stored : String(mapped);
    const list = groups.get(id);
    if (list) list.push(c); else groups.set(id, [c]);
  }
  const out = [];
  for (const [id, list] of groups) {
    const surplus = Math.max(0, list.length - k);
    if (surplus === 0) continue;
    const pick = [...list].sort(proposalOrder).slice(0, surplus);
    out.push({
      main_id: id, count: list.length, surplus,
      copy_ids: pick.map((c) => String(c.copy_id)),
      value: round2(pick.reduce((s, c) => s + unitValue(c), 0)),
    });
  }
  return out.sort((a, b) => (b.surplus - a.surplus) || (b.value - a.value) || cmpStr(a.main_id, b.main_id));
}

export function duplicatesSummary(list) {
  const entries = list || [];
  return {
    cards: entries.length,
    copies: entries.reduce((s, e) => s + e.surplus, 0),
    value: round2(entries.reduce((s, e) => s + e.value, 0)),
  };
}

// Lebende Exemplare mit for_sale.
export function forSaleSummary(copies) {
  const marked = (copies || []).filter((c) => c && !c.deleted && c.for_sale);
  return { copies: marked.length, value: round2(marked.reduce((s, c) => s + unitValue(c), 0)) };
}

// Verkaufsliste nach Printing: nur Printings mit markierten lebenden Exemplaren, sortiert nach Name, Set-Code, Sprache,
// Seltenheit (Codeeinheiten wie der Kotlin-Zwilling), Exemplare nach created_at, dann copy_id.
// -> [{ card_id, set_code, language, rarity, name, copy_ids }]
export function forSaleGroups(copies) {
  const groups = new Map();
  for (const c of copies || []) {
    if (!c || c.deleted || !c.for_sale) continue;
    const key = JSON.stringify([String(c.card_id), c.set_code, c.language, c.rarity]);
    const g = groups.get(key);
    if (g) g.copies.push(c);
    else groups.set(key, { card_id: String(c.card_id), set_code: c.set_code, language: c.language, rarity: c.rarity, name: c.name ?? null, copies: [c] });
  }
  const byCreated = (a, b) => cmpStr(String(a.created_at ?? ''), String(b.created_at ?? '')) || cmpStr(String(a.copy_id), String(b.copy_id));
  return [...groups.values()]
    .map(({ copies: list, ...g }) => ({ ...g, copy_ids: [...list].sort(byCreated).map((c) => String(c.copy_id)) }))
    .sort((a, b) => cmpStr(a.name ?? '', b.name ?? '') || cmpStr(a.set_code, b.set_code)
      || cmpStr(a.language, b.language) || cmpStr(a.rarity, b.rarity) || cmpStr(a.card_id, b.card_id));
}

export const euroCents = (v) => `${fmtNum(round2(v))} €`;
export const euroWhole = (v) => `${WHOLE.format(Math.round(v))} €`;

// "14 Karten · 31 Exemplare über Playset · ca. 62 €"
export const headerText = (s) =>
  `${plural(s.cards, 'Karte', 'Karten')} · ${plural(s.copies, 'Exemplar', 'Exemplare')} über Playset · ca. ${euroWhole(s.value)}`;
// "31 Exemplare von 14 Karten markieren?"
export const confirmAllText = (s) => `${plural(s.copies, 'Exemplar', 'Exemplare')} von ${plural(s.cards, 'Karte', 'Karten')} markieren?`;
// "5 Exemplare · 2 über Playset"
export const rowCountText = (e) => `${plural(e.count, 'Exemplar', 'Exemplare')} · ${e.surplus} über Playset`;

// Vorschlag in Worten, je Set-Code/Seltenheit/Zustand/Edition gezaehlt, in Vorschlagsreihenfolge:
// ["2× LOB-DE001 Common · NM · Unlimited"]. copiesById: Map copy_id -> Exemplar.
export function proposalTexts(entry, copiesById) {
  const groups = new Map();
  for (const id of entry.copy_ids) {
    const c = copiesById.get(id);
    if (!c) continue;
    const key = JSON.stringify([c.set_code, c.rarity, c.condition, c.edition]);
    const g = groups.get(key);
    if (g) g.n += 1; else groups.set(key, { n: 1, c });
  }
  return [...groups.values()].map(({ n, c }) =>
    `${n}× ${c.set_code} ${c.rarity} · ${c.condition} · ${EDITION_LABELS[c.edition] ?? c.edition}`);
}

// "23 Exemplare · 84,30 €"
export const forSaleHeaderText = (s) => `${plural(s.copies, 'Exemplar', 'Exemplare')} · ${euroCents(s.value)}`;
// "Zum Verkauf: 23 Exemplare · 84 €"
export const startSaleText = (s) => `Zum Verkauf: ${plural(s.copies, 'Exemplar', 'Exemplare')} · ${euroWhole(s.value)}`;
// "Duplikate: 14 Karten"
export const startDuplicatesText = (s) => `Duplikate: ${plural(s.cards, 'Karte', 'Karten')}`;
// "davon zum Verkauf: 84 €"
export const saleShareText = (s) => `davon zum Verkauf: ${euroWhole(s.value)}`;
// "(2 zum Verkauf)" an der Sammlungszeile; ohne markierte Exemplare null.
export const forSaleSuffix = (n) => (n > 0 ? `(${n} zum Verkauf)` : null);
// Wert je Exemplar in der Verkaufsliste; ohne Preis "—".
export const copyValueText = (c) => (unitPrice(c, c) > 0 ? euroCents(unitValue(c)) : '—');

// Spec H1 §5.4 -- Zeilen-Schalter "Auf die Verkaufsliste". forSaleIds: Set der markierten copy_ids.
export const toggleIsOn = (entry, forSaleIds) => entry.copy_ids.length > 0 && entry.copy_ids.every((id) => forSaleIds.has(id));
// Beim Einschalten merken: diese Vorschlaege waren schon vorher markiert.
export const premarkedIds = (entry, forSaleIds) => entry.copy_ids.filter((id) => forSaleIds.has(id));
// An: alle Vorschlaege auf for_sale = 1. Aus: alle Vorschlaege ausser den vorher markierten (premarked null = keine
// Vorgeschichte in dieser Ansicht) auf for_sale = 0.
export function toggleTargets(entry, on, premarked) {
  if (on) return { ids: [...entry.copy_ids], value: true };
  const keep = new Set(premarked || []);
  return { ids: entry.copy_ids.filter((id) => !keep.has(id)), value: false };
}
// "Alle Vorschläge auf die Verkaufsliste": alle vorgeschlagenen, noch nicht markierten Exemplare.
export const allProposalIds = (list, forSaleIds) =>
  (list || []).flatMap((e) => e.copy_ids).filter((id) => !forSaleIds.has(id));
```

- [ ] **Step 5: Tests laufen lassen**

Run: `node --test src/utils/duplicates.test.js` → `ℹ tests 24`, `ℹ pass 24`.
Run: `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 274`, `ℹ fail 0`.
Run: `npx eslint .` → `5 errors`.

- [ ] **Step 6: Schutz-Nachweise**

(a) Artwork-Zusammenfassung: in `duplicates` die Zeile `    const mapped = mainIdOf ? mainIdOf(stored) : null;` kurz zu `    const mapped = null;` ändern → `✖ Fixture: Artwork-Passcodes zählen zur Hauptkarte` (gemessen). Zitieren, per Edit zurücknehmen.
(b) Kriterium 1 vor 2–6: in `proposalOrder` die Zeilen `  return (flag(b.for_sale) - flag(a.for_sale))` + `    || (flag(hasPlace(a)) - flag(hasPlace(b)))` kurz zu `  return (flag(hasPlace(a)) - flag(hasPlace(b)))` zusammenziehen → nur `✖ Fixture: Kriterium 1: bereits markiert vor nicht markiert` (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add docs/fixtures/duplicates/duplicates.json desktop/src/utils/duplicates.js desktop/src/utils/duplicates.test.js
git commit -m "feat(h1): JS-Zwilling Duplikate und Verkaufsliste mit gemeinsamer Fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: Busy-Gatter und Lade-Hook (PC-Renderer)

**Files:**
- Create: `desktop/src/utils/busyGate.test.js`
- Create: `desktop/src/utils/busyGate.js`
- Create: `desktop/src/utils/useSaleData.js`

**Interfaces:**
- Consumes (Task 1): `keepPerCard`. Zur Laufzeit (Task 4): `window.api.listSaleCopies()`, `window.api.getSettings()`, `window.api.onCollectionChanged(cb)`.
- Produces (für Task 5, 6): `createBusyGate() → { running: boolean (getter), run(action: () => any|Promise) → Promise<boolean> }` (false = verworfen, action nicht aufgerufen; wirft action, ist das Gatter wieder frei); `useSaleData() → { data: { copies, keep } | null, error: string|null, reload: () => Promise<void> }` (laedt bei Einhängen, `collection-changed` und `collection-dirty`).

- [ ] **Step 1: Test schreiben** — `desktop/src/utils/busyGate.test.js`:

Vollständiger Inhalt von `desktop/src/utils/busyGate.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBusyGate } from './busyGate.js';

test('Doppelklick: der zweite Start waehrend eines Laufs wird verworfen', async () => {
  const gate = createBusyGate();
  let calls = 0;
  let release;
  const first = gate.run(() => { calls += 1; return new Promise((r) => { release = r; }); });
  assert.equal(gate.running, true);
  assert.equal(await gate.run(() => { calls += 1; }), false);
  release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
  assert.equal(gate.running, false);
  assert.equal(await gate.run(() => { calls += 1; }), true);
  assert.equal(calls, 2);
});

test('eine werfende Aktion gibt das Gatter wieder frei', async () => {
  const gate = createBusyGate();
  await assert.rejects(gate.run(async () => { throw new Error('kaputt'); }), /kaputt/);
  assert.equal(gate.running, false);
  assert.equal(await gate.run(() => {}), true);
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `node --test src/utils/busyGate.test.js` → FAIL mit `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: `desktop/src/utils/busyGate.js` anlegen**

Vollständiger Inhalt von `desktop/src/utils/busyGate.js`:

```js
// Spec H1 §7 -- Ein-Lauf-Gatter fuer Schreibaktionen am PC (Gegenstueck zu android ui/InFlight.kt): solange eine Aktion
// laeuft, wird jeder weitere Start sofort verworfen -- synchron, bevor der erste await laeuft. Ein React-State kaeme
// gegen einen Doppelklick zu spaet. Wirft die Aktion, ist das Gatter trotzdem wieder frei.
export function createBusyGate() {
  let running = false;
  return {
    get running() { return running; },
    // -> true, wenn die Aktion lief; false, wenn schon eine lief (dann wird action gar nicht aufgerufen).
    async run(action) {
      if (running) return false;
      running = true;
      try {
        await action();
        return true;
      } finally {
        running = false;
      }
    },
  };
}
```

- [ ] **Step 4: `desktop/src/utils/useSaleData.js` anlegen** (Hook, kein eigener Test; Regeln stehen in `duplicates.js`)

Vollständiger Inhalt von `desktop/src/utils/useSaleData.js`:

```js
import { useState, useEffect, useCallback, useRef } from 'react';
import { keepPerCard } from './duplicates.js';

const LOAD_ERROR = 'Verkaufsdaten konnten nicht geladen werden.';

// Spec H1 §5 -- lebende Exemplare fuer Duplikate und Verkaufsliste (list-sale-copies) plus keep_per_card.
// Laedt beim Einhaengen, bei Sammlungsaenderung (Sync) und bei 'collection-dirty' (Karten-Detail) neu; reload()
// liefert ein Promise, damit ein Schreibvorgang erst nach dem frischen Stand freigibt.
// data null = laedt noch: die Oberflaeche zeigt "…", nie "0 Karten". Ein Ladefehler behaelt den letzten Stand.
export function useSaleData() {
  const [state, setState] = useState(() => ({ data: null, error: window.api?.listSaleCopies ? null : LOAD_ERROR }));
  const alive = useRef(true);
  const reload = useCallback(() => {
    if (!window.api?.listSaleCopies) return Promise.resolve();
    return Promise.all([window.api.listSaleCopies(), window.api.getSettings()])
      .then(([copies, settings]) => {
        if (alive.current) setState({ data: { copies: Array.isArray(copies) ? copies : [], keep: keepPerCard(settings?.keep_per_card) }, error: null });
      })
      .catch(() => { if (alive.current) setState((s) => ({ data: s.data, error: LOAD_ERROR })); });
  }, []);
  useEffect(() => {
    alive.current = true;
    reload();
    const onDirty = () => { reload(); };
    const off = window.api?.onCollectionChanged?.(onDirty);
    window.addEventListener('collection-dirty', onDirty);
    return () => { alive.current = false; off?.(); window.removeEventListener('collection-dirty', onDirty); };
  }, [reload]);
  return { data: state.data, error: state.error, reload };
}
```

- [ ] **Step 5: Tests, Lint**

Run: `node --test src/utils/busyGate.test.js` → `ℹ tests 2`, `ℹ pass 2`.
Run: `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 276`, `ℹ fail 0`.
Run: `npx eslint .` → `5 errors`.

- [ ] **Step 6: Schutz-Nachweis**

In `run` die Zeile `      if (running) return false;` kurz entfernen → `✖ Doppelklick: der zweite Start waehrend eines Laufs wird verworfen` (gemessen). Zitieren, per Edit zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/utils/busyGate.js desktop/src/utils/busyGate.test.js desktop/src/utils/useSaleData.js
git commit -m "feat(h1): Busy-Gatter und Lade-Hook fuer Duplikate und Verkaufsliste

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: SQLite — Verkaufsliste umschalten, laden, Minus-Regel

**Files:**
- Create: `desktop/electron/copies-for-sale.test.cjs`
- Modify: `desktop/electron/copies.cjs`

**Interfaces:**
- Produces (für Task 4): `copies.setForSale(db, { copyIds: string[], value: boolean }) → number` (geänderte Exemplare; nur lebende, nur anderer Wert, setzt `updated_at`; `ValidationError` bei ungültiger Eingabe), `copies.listSaleCopies(db, mainIdOf = (id) => id) → [{ copy_id, card_id, set_code, language, rarity, edition, condition, container_id, page, slot, tags, note, for_sale, created_at, name, image_url, price, price_first_ed, main_id }]` (lebende Exemplare lebender Printings, sortiert `created_at, copy_id`, `mainIdOf` je Passcode einmal; leer/null → gespeicherter Passcode), `removeCopies` nimmt `for_sale = 1` in beiden Zweigen zuerst, `listDeckCopies` liefert zusätzlich `for_sale`.

- [ ] **Step 1: Test schreiben** — `desktop/electron/copies-for-sale.test.cjs`:

Vollständiger Inhalt von `desktop/electron/copies-for-sale.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const copies = require('./copies.cjs');

// Spec H1 §5.3/§6/§8 -- Verkaufsliste am Exemplar: Umschalten (idempotent, updated_at), Minus-Regel (markierte zuerst),
// Laden fuer Duplikate/Verkaufsliste (Haupt-Passcode), Deck-Abgleich traegt for_sale.
const P = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Common' };
const OLD = '2000-01-01 00:00:00';

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown',
    name TEXT, image_url TEXT,
    quantity INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, price REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code, language, rarity));
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, name, image_url, price)
              VALUES ('46986414','LOB-DE005','DE','Common','Dunkler Magier','https://img/46986414.jpg', 2.0)`).run();
  return db;
}

const addCopy = (db, copyId, over = {}) =>
  db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition, for_sale, deleted, created_at)
              VALUES (@copy_id, @card_id, @set_code, 'DE', @rarity, @edition, @condition, @for_sale, @deleted, @created_at)`)
    .run({ copy_id: copyId, card_id: '46986414', set_code: 'LOB-DE005', rarity: 'Common', edition: 'unknown', condition: 'NM',
      for_sale: 0, deleted: 0, created_at: '2026-09-01 10:00:00', ...over });
const readCopy = (db, id) => db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(id);
const live = (db) => db.prepare('SELECT copy_id FROM card_copies WHERE deleted = 0 ORDER BY copy_id').all().map((r) => r.copy_id);

test('setForSale markiert, setzt updated_at und ist idempotent', () => {
  const db = freshDb();
  addCopy(db, 'k1');
  addCopy(db, 'k2');
  db.prepare('UPDATE card_copies SET updated_at = ?').run(OLD);
  assert.equal(copies.setForSale(db, { copyIds: ['k1', 'k2', 'k1'], value: true }), 2);
  assert.equal(readCopy(db, 'k1').for_sale, 1);
  assert.notEqual(readCopy(db, 'k1').updated_at, OLD, 'Umschalten stempelt updated_at (Sync)');
  db.prepare('UPDATE card_copies SET updated_at = ?').run(OLD);
  assert.equal(copies.setForSale(db, { copyIds: ['k1', 'k2'], value: true }), 0, 'zweiter gleicher Aufruf aendert nichts');
  assert.equal(readCopy(db, 'k1').updated_at, OLD, 'und stempelt nicht neu');
  assert.equal(copies.setForSale(db, { copyIds: ['k2'], value: false }), 1);
  assert.equal(readCopy(db, 'k2').for_sale, 0);
  assert.equal(readCopy(db, 'k1').for_sale, 1);
});

test('setForSale ueberspringt geloeschte und unbekannte Exemplare, prueft die Eingabe', () => {
  const db = freshDb();
  addCopy(db, 'weg', { deleted: 1 });
  assert.equal(copies.setForSale(db, { copyIds: ['weg', 'gibt-es-nicht'], value: true }), 0);
  assert.equal(readCopy(db, 'weg').for_sale, 0);
  assert.throws(() => copies.setForSale(db, { copyIds: 'k1', value: true }), copies.ValidationError);
  assert.throws(() => copies.setForSale(db, { copyIds: [''], value: true }), copies.ValidationError);
  assert.throws(() => copies.setForSale(db, { copyIds: ['k1'], value: 1 }), copies.ValidationError);
});

test('setForSale schreibt cards.quantity nie', () => {
  const db = freshDb();
  addCopy(db, 'k1');
  addCopy(db, 'k2');
  db.prepare('UPDATE cards SET updated_at = ?').run(OLD);
  copies.setForSale(db, { copyIds: ['k1', 'k2'], value: true });
  const card = db.prepare('SELECT quantity, deleted, updated_at FROM cards WHERE id = ?').get('46986414');
  assert.deepEqual(card, { quantity: 2, deleted: 0, updated_at: OLD });
  assert.ok(!/UPDATE\s+cards/i.test(copies.setForSale.toString()), 'kein Schreibweg auf cards');
});

test('Minus mit Gruppe entfernt markierte Exemplare zuerst', () => {
  const db = freshDb();
  addCopy(db, 'alt-markiert', { for_sale: 1, created_at: '2026-09-01 10:00:00' });
  addCopy(db, 'neu', { created_at: '2026-09-05 10:00:00' });
  assert.equal(copies.removeCopies(db, P, { edition: 'unknown', condition: 'NM', count: 1 }), 1);
  assert.deepEqual(live(db), ['neu']);
});

test('Minus ohne Gruppe entfernt markierte Exemplare vor dem Standard', () => {
  const db = freshDb();
  addCopy(db, 'standard', { created_at: '2026-09-05 10:00:00' });
  addCopy(db, 'markiert-erste', { for_sale: 1, edition: 'first', condition: 'MT', created_at: '2026-09-01 10:00:00' });
  assert.equal(copies.removeCopies(db, P, { count: 1 }), 1);
  assert.deepEqual(live(db), ['standard']);
  assert.equal(db.prepare('SELECT quantity FROM cards WHERE id = ?').get('46986414').quantity, 1, 'Trigger zaehlt');
});

test('listSaleCopies: lebende Exemplare lebender Printings mit Preisfeldern und Haupt-Passcode', () => {
  const db = freshDb();
  db.prepare("UPDATE cards SET cm_first_ed_factor = 1.5 WHERE id = '46986414'").run();
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, name, price)
              VALUES ('46986415','CT13-DE003','DE','Ultra Rare','Dunkler Magier', 3), ('89631139','SDK-DE001','DE','Ultra Rare','Blauäugiger w. Drache', 8)`).run();
  addCopy(db, 'k1', { for_sale: 1, edition: 'first', created_at: '2026-09-01 10:00:00' });
  addCopy(db, 'k2', { card_id: '46986415', set_code: 'CT13-DE003', rarity: 'Ultra Rare', created_at: '2026-09-02 10:00:00' });
  addCopy(db, 'k3', { card_id: '89631139', set_code: 'SDK-DE001', rarity: 'Ultra Rare', created_at: '2026-09-03 10:00:00' });
  addCopy(db, 'weg', { deleted: 1, created_at: '2026-09-04 10:00:00' });
  db.prepare("UPDATE card_copies SET container_id = 'c1', tags = '[\"Deck\"]', note = 'x' WHERE copy_id = 'k1'").run();
  const calls = [];
  const rows = copies.listSaleCopies(db, (id) => { calls.push(id); return id === '46986415' ? '46986414' : (id === '89631139' ? '' : null); });
  assert.deepEqual(rows.map((r) => [r.copy_id, r.main_id]), [['k1', '46986414'], ['k2', '46986414'], ['k3', '89631139']]);
  assert.deepEqual(calls, ['46986414', '46986415', '89631139'], 'je Passcode einmal nachgeschlagen');
  const [k1] = rows;
  assert.equal(k1.for_sale, 1);
  assert.equal(k1.name, 'Dunkler Magier');
  assert.equal(k1.image_url, 'https://img/46986414.jpg');
  assert.equal(k1.price, 2);
  assert.equal(k1.price_first_ed, 3);
  assert.equal(k1.container_id, 'c1');
  assert.equal(k1.tags, '["Deck"]');
  assert.equal(k1.note, 'x');
  assert.equal(k1.created_at, '2026-09-01 10:00:00');
  assert.equal(k1.edition, 'first');
});

test('listSaleCopies ohne Nachschlagen nimmt den gespeicherten Passcode, geloeschtes Printing faellt weg', () => {
  const db = freshDb();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price) VALUES ('46986414','SDY-DE006','DE','Common', 1)").run();
  addCopy(db, 'k1');
  addCopy(db, 'printing-weg', { set_code: 'SDY-DE006' });
  db.prepare("UPDATE cards SET deleted = 1 WHERE set_code = 'SDY-DE006'").run();
  assert.deepEqual(copies.listSaleCopies(db).map((r) => [r.copy_id, r.main_id]), [['k1', '46986414']]);
});

test('listDeckCopies traegt for_sale fuer das Preisschild im Deckbuilder', () => {
  const db = freshDb();
  addCopy(db, 'k1', { for_sale: 1 });
  assert.equal(copies.listDeckCopies(db)[0].for_sale, 1);
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-for-sale.test.cjs` → `ℹ pass 0`, `ℹ fail 8` (`TypeError: copies.setForSale is not a function`, `TypeError: copies.listSaleCopies is not a function`, Minus-Fälle mit falschem Rest, `for_sale` fehlt in `listDeckCopies`).

- [ ] **Step 3: `desktop/electron/copies.cjs` ändern**

In `desktop/electron/copies.cjs` (5 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/5 — ersetzen:
```js
// most valuable (highest factor, non-default edition) are removed LAST.
function removeCopies(db, printing, { edition, condition, count = 1 } = {}) {
```
durch:
```js
// most valuable (highest factor, non-default edition) are removed LAST.
// Spec H1 §5.3: in beiden Zweigen gehen Exemplare mit for_sale = 1 vor allen anderen (sie sollen ohnehin weg).
function removeCopies(db, printing, { edition, condition, count = 1 } = {}) {
```

Änderung 2/5 — ersetzen:
```js
      AND (@edition IS NULL OR edition = @edition) AND (@condition IS NULL OR condition = @condition)
      ORDER BY created_at DESC, copy_id LIMIT @n`).all({ ...p, edition: edition || null, condition: condition || null, n });
  } else {
    const d = defaults(db);
    const all = db.prepare(`SELECT copy_id, edition, condition, created_at FROM card_copies WHERE ${KEY} AND deleted = 0`).all(p);
    all.sort((a, b) => {
      const sa = (a.edition === d.edition && a.condition === d.condition) ? 0 : 1;
```
durch:
```js
      AND (@edition IS NULL OR edition = @edition) AND (@condition IS NULL OR condition = @condition)
      ORDER BY for_sale DESC, created_at DESC, copy_id LIMIT @n`).all({ ...p, edition: edition || null, condition: condition || null, n });
  } else {
    const d = defaults(db);
    const all = db.prepare(`SELECT copy_id, edition, condition, created_at, for_sale FROM card_copies WHERE ${KEY} AND deleted = 0`).all(p);
    all.sort((a, b) => {
      const va = a.for_sale ? 0 : 1, vb = b.for_sale ? 0 : 1;
      if (va !== vb) return va - vb;                                   // for sale first (Spec H1)
      const sa = (a.edition === d.edition && a.condition === d.condition) ? 0 : 1;
```

Änderung 3/5 — ersetzen:
```js
    SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition,
           cp.container_id, cp.page, cp.slot,
           c.name AS card_name, c.price AS price, c.price_first_ed AS price_first_ed
```
durch:
```js
    SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition,
           cp.container_id, cp.page, cp.slot, cp.for_sale,
           c.name AS card_name, c.price AS price, c.price_first_ed AS price_first_ed
```

Änderung 4/5 — ersetzen:
```js
     ORDER BY cp.card_id, cp.copy_id`).all();
}
```
durch:
```js
     ORDER BY cp.card_id, cp.copy_id`).all();
}

// Spec H1 §6: Verkaufsliste umschalten. Nur lebende Exemplare, nur Zeilen mit anderem Wert -- ein zweiter gleicher
// Aufruf aendert nichts und stempelt updated_at nicht neu (kein unnoetiger Push). Unbekannte oder anderswo geloeschte
// copy_ids werden uebersprungen. -> Anzahl geaenderter Exemplare.
function setForSale(db, { copyIds, value } = {}) {
  if (!Array.isArray(copyIds) || copyIds.some((id) => typeof id !== 'string' || id === '')) {
    throw new ValidationError('Ungültige Exemplar-Liste.');
  }
  if (typeof value !== 'boolean') throw new ValidationError('Ungültiger Wert für „Zum Verkauf“.');
  const upd = db.prepare(`UPDATE card_copies SET for_sale = @v, updated_at = CURRENT_TIMESTAMP
                           WHERE copy_id = @id AND deleted = 0 AND for_sale IS NOT @v`);
  let changed = 0;
  db.transaction(() => {
    for (const id of new Set(copyIds)) changed += upd.run({ id, v: value ? 1 : 0 }).changes;
  })();
  return changed;
}

// Spec H1 §4/§5: lebende Exemplare lebender Printings fuer Duplikate und Verkaufsliste, mit den Printing-Feldern der
// Wertanzeige (name, image_url, price, price_first_ed) und main_id = Haupt-Passcode (mainIdOf, E3-Artwork-Zuordnung;
// ohne Katalog der gespeicherte Passcode). Ausgeschriebene Spaltenliste wie listUnsortedCopies (created_at/deleted
// muessen die des Exemplars sein).
function listSaleCopies(db, mainIdOf = (id) => id) {
  const rows = db.prepare(`
    SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition,
           cp.container_id, cp.page, cp.slot, cp.tags, cp.note, cp.for_sale, cp.created_at,
           c.name, c.image_url, c.price, c.price_first_ed
      FROM card_copies cp
      JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code
                  AND c.language = cp.language AND c.rarity = cp.rarity
     WHERE cp.deleted = 0 AND c.deleted = 0
     ORDER BY cp.created_at, cp.copy_id`).all();
  const memo = new Map();
  return rows.map((r) => {
    const id = String(r.card_id);
    if (!memo.has(id)) {
      const m = mainIdOf(id);
      memo.set(id, m == null || m === '' ? id : String(m));
    }
    return { ...r, main_id: memo.get(id) };
  });
}
```

Änderung 5/5 — ersetzen:
```js
  setCopyLocation, deleteCopy, setCopyTagsNote, listUnsortedCopies, listDeckCopies, listTags, listContainers, saveContainer,
  normalizeTagList, CONTAINER_KINDS, BINDER_POCKETS,
};
```
durch:
```js
  setCopyLocation, deleteCopy, setCopyTagsNote, listUnsortedCopies, listDeckCopies, listTags, listContainers, saveContainer,
  normalizeTagList, CONTAINER_KINDS, BINDER_POCKETS, setForSale, listSaleCopies,
};
```

- [ ] **Step 4: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-for-sale.test.cjs` → `ℹ tests 8`, `ℹ pass 8`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 316`, `ℹ fail 0` (die bestehenden `copies.test.cjs`-Minus-Fälle bleiben grün).

- [ ] **Step 5: Schutz-Nachweise**

(a) Minus mit Gruppe: `ORDER BY for_sale DESC, created_at DESC, copy_id LIMIT @n` kurz zu `ORDER BY created_at DESC, copy_id LIMIT @n` → `✖ Minus mit Gruppe entfernt markierte Exemplare zuerst` (gemessen).
(b) Minus ohne Gruppe: die Zeile `      if (va !== vb) return va - vb;                                   // for sale first (Spec H1)` kurz entfernen → `✖ Minus ohne Gruppe entfernt markierte Exemplare vor dem Standard` (gemessen).
(c) Idempotenz: in `setForSale` ` AND for_sale IS NOT @v` kurz entfernen → `✖ setForSale markiert, setzt updated_at und ist idempotent` (gemessen).
Jeweils zitieren und per Edit zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/copies.cjs desktop/electron/copies-for-sale.test.cjs
git commit -m "feat(h1): Verkaufsliste am Exemplar umschalten und laden, Minus nimmt markierte zuerst

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: IPC-Kanäle `list-sale-copies` und `set-for-sale`

**Files:**
- Modify: `desktop/electron/ipc-channels.test.cjs`
- Modify: `desktop/electron/main.cjs`
- Modify: `desktop/electron/preload.cjs`

**Interfaces:**
- Consumes (Task 3): `copies.listSaleCopies`, `copies.setForSale`; vorhanden: `catalogMainId(userDataPath, id)`, `containerCopyErrorMessage`, `CONTAINER_COPY_ERROR_MSG`.
- Produces (für Task 2, 5, 6): `window.api.listSaleCopies() → Promise<Zeilen wie listSaleCopies>` (wirft bei DB-Fehler mit generischer deutscher Meldung), `window.api.setForSale({ copyIds, value }) → Promise<{ success: true, changed } | { success: false, error }>`.

- [ ] **Step 1: Test erweitern** — `desktop/electron/ipc-channels.test.cjs`:

In `desktop/electron/ipc-channels.test.cjs` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```js
const F1_CHANNELS = ['import-open', 'import-resolve', 'import-run', 'export-count', 'export-run'];

for (const ch of [...E1_CHANNELS, ...E2_CHANNELS, ...E3_CHANNELS, ...F1_CHANNELS]) {
  test(`Kanal ${ch} steht in main.cjs und preload.cjs`, () => {
```
durch:
```js
const F1_CHANNELS = ['import-open', 'import-resolve', 'import-run', 'export-count', 'export-run'];

// Spec H1 §6: Exemplare fuer Duplikate/Verkaufsliste laden, Verkaufsliste umschalten.
const H1_CHANNELS = ['list-sale-copies', 'set-for-sale'];

for (const ch of [...E1_CHANNELS, ...E2_CHANNELS, ...E3_CHANNELS, ...F1_CHANNELS, ...H1_CHANNELS]) {
  test(`Kanal ${ch} steht in main.cjs und preload.cjs`, () => {
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/ipc-channels.test.cjs` → `✖ Kanal list-sale-copies steht in main.cjs und preload.cjs` und `✖ Kanal set-for-sale …` (`main.cjs fehlt ipcMain.handle('list-sale-copies'`).

- [ ] **Step 3: `desktop/electron/main.cjs` ändern**

In `desktop/electron/main.cjs` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```js
});

// --- Other Handlers ---
```
durch:
```js
});

// --- Spec H1: Duplikate & Verkaufsliste ---
// Regeln in copies.cjs (setForSale, listSaleCopies, Minus-Regel) und src/utils/duplicates.js; hier nur die Kanaele.
// Exemplare fuer Duplikate/Verkaufsliste mit Haupt-Passcode ueber die Artwork-Zuordnung (ohne Katalog der gespeicherte).
ipcMain.handle('list-sale-copies', () => {
    try { return copies.listSaleCopies(db, (id) => catalogMainId(userDataPath, id)); }
    catch (e) { console.error('[list-sale-copies]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});
// { copyIds: string[], value: boolean } -> { success, changed }; idempotent, setzt updated_at nur bei Aenderung.
ipcMain.handle('set-for-sale', (event, d) => {
    try { return { success: true, changed: copies.setForSale(db, d || {}) }; }
    catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'set-for-sale') }; }
});

// --- Other Handlers ---
```

- [ ] **Step 4: `desktop/electron/preload.cjs` ändern**

In `desktop/electron/preload.cjs` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```js
  exportRun: (data) => ipcRenderer.invoke('export-run', data),

  // Wishlist
```
durch:
```js
  exportRun: (data) => ipcRenderer.invoke('export-run', data),
  // Spec H1: Duplikate & Verkaufsliste
  listSaleCopies: () => ipcRenderer.invoke('list-sale-copies'),
  setForSale: (data) => ipcRenderer.invoke('set-for-sale', data),

  // Wishlist
```

- [ ] **Step 5: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 318`, `ℹ fail 0`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` → 16× `PASS`, exit 0 (Sync unverändert).

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/ipc-channels.test.cjs
git commit -m "feat(h1): Kanaele list-sale-copies und set-for-sale

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: PC Sammlung › Karten — Chips „Duplikate" und „Zum Verkauf"

**Files:**
- Create: `desktop/src/components/DuplicatesList.jsx`
- Create: `desktop/src/components/ForSaleList.jsx`
- Modify: `desktop/src/components/ExportDialog.jsx`
- Modify: `desktop/src/components/CardTile.jsx`
- Modify: `desktop/src/components/CollectionList.jsx`

**Interfaces:**
- Consumes: Task 1 (`duplicates`, Summen, Texte, Schalter-Regel, `forSaleGroups`, `copyValueText`, `forSaleSuffix`, `LOADING`), Task 2 (`createBusyGate`, `useSaleData`), Task 4 (`window.api.setForSale`), vorhanden `formatCopyLocation`, `EDITION_LABELS`, `cardRoute`.
- Produces: `<DuplicatesList list copies reload onOpenCard />`, `<ForSaleList copies containers reload onOpenCard />`, `<ExportDialog … initialFormat='carddex' filterLabel='Aktueller Filter' />` (Vorgaben = bisheriges Verhalten), `<CardTile … saleNote={string|null} />`; `CollectionList` liest den Anfangs-Chip aus `location.state.segment` (`'duplicates'` | `'forsale'`, für Task 6).

- [ ] **Step 1: `desktop/src/components/DuplicatesList.jsx` anlegen**

Vollständiger Inhalt von `desktop/src/components/DuplicatesList.jsx`:

```jsx
import { useMemo, useRef, useState } from 'react';
import {
  LOADING, duplicatesSummary, headerText, confirmAllText, rowCountText, proposalTexts,
  toggleIsOn, premarkedIds, toggleTargets, allProposalIds,
} from '../utils/duplicates';
import { createBusyGate } from '../utils/busyGate';

// Spec H1 §5.1 -- Sammlung › Karten › Duplikate. list: Ergebnis von duplicates() (null = laedt), copies: Zeilen aus
// list-sale-copies, reload(): Promise, onOpenCard(copy): Karten-Detail. Jede Schreibaktion laeuft durch das
// Busy-Gatter (frueher Return, Schalter und Knopf gesperrt) und gibt erst nach dem frischen Stand frei.
export default function DuplicatesList({ list, copies, reload, onOpenCard }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // §5.4: je Haupt-Passcode die Vorschlaege, die beim Einschalten in dieser Ansicht schon markiert waren.
  const history = useRef(new Map());

  const byId = useMemo(() => new Map((copies || []).map((c) => [c.copy_id, c])), [copies]);
  const forSaleIds = useMemo(() => new Set((copies || []).filter((c) => c.for_sale).map((c) => c.copy_id)), [copies]);
  const summary = useMemo(() => (list ? duplicatesSummary(list) : null), [list]);

  // -> true, wenn geschrieben wurde (oder nichts zu schreiben war).
  const write = async (ids, value) => {
    if (ids.length === 0) return true;
    const res = await window.api.setForSale({ copyIds: ids, value });
    if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return false; }
    return true;
  };

  const run = (action) => gate.run(async () => {
    setBusy(true);
    setError(null);
    try {
      if (await action()) await reload();
    } catch (e) {
      setError(e?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  });

  const toggle = (entry) => run(() => {
    const on = !toggleIsOn(entry, forSaleIds);
    if (on) history.current.set(entry.main_id, premarkedIds(entry, forSaleIds));
    const t = toggleTargets(entry, on, on ? null : (history.current.get(entry.main_id) ?? null));
    if (!on) history.current.delete(entry.main_id);
    return write(t.ids, t.value);
  });

  const markAll = () => {
    if (gate.running || !summary) return;
    if (!confirm(confirmAllText(summary))) return;
    run(() => write(allProposalIds(list, forSaleIds), true));
  };

  if (!list) return <div className="h-full flex items-center justify-center text-ink-faint">{LOADING}</div>;

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 bg-obsidian-700 border border-line rounded-xl px-4 py-3 shrink-0">
        <span className="text-sm text-ink flex-1">{headerText(summary)}</span>
        <button type="button" onClick={markAll} disabled={busy || list.length === 0}
          className="px-3 py-1.5 bg-space-violet hover:bg-space-violet-dark text-white rounded-lg text-xs font-medium disabled:opacity-50">
          Alle Vorschläge auf die Verkaufsliste
        </button>
      </div>
      {error && <p className="text-sm text-crit">{error}</p>}
      {list.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-600">Keine Duplikate.</div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {list.map((entry) => {
            const first = byId.get(entry.copy_ids[0]) || {};
            const on = toggleIsOn(entry, forSaleIds);
            return (
              <div key={entry.main_id} onClick={() => onOpenCard(first)}
                className="flex items-center gap-3 bg-obsidian-700 hover:bg-obsidian-600 border border-line rounded-xl p-3 cursor-pointer">
                <div className="w-12 h-16 rounded overflow-hidden bg-obsidian-800 shrink-0">
                  {first.image_url && <img src={first.image_url} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-ink truncate">{first.name || entry.main_id}</div>
                  <div className="text-xs text-ink-muted">{rowCountText(entry)}</div>
                  {proposalTexts(entry, byId).map((t) => <div key={t} className="text-[11px] font-mono text-ink-faint truncate">{t}</div>)}
                </div>
                <label onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 text-xs text-ink-muted shrink-0 cursor-pointer select-none">
                  <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={() => toggle(entry)} className="accent-space-violet" />
                  Auf die Verkaufsliste
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `desktop/src/components/ForSaleList.jsx` anlegen**

Vollständiger Inhalt von `desktop/src/components/ForSaleList.jsx`:

```jsx
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import ExportDialog from './ExportDialog';
import { LOADING, forSaleSummary, forSaleGroups, forSaleHeaderText, copyValueText } from '../utils/duplicates';
import { createBusyGate } from '../utils/busyGate';
import { EDITION_LABELS } from '../utils/valuation';
import { formatCopyLocation } from '../utils/copyLocation';

// Spec H1 §5.1 -- Sammlung › Karten › Zum Verkauf. copies: Zeilen aus list-sale-copies (null = laedt), containers fuer
// den Standort, reload(): Promise, onOpenCard(copy). "Exportieren" oeffnet den F1-Export mit Format Verkaufsliste und
// genau diesen Exemplaren; "Zurück in die Sammlung" setzt for_sale = 0 (Busy-Gatter wie in DuplicatesList).
export default function ForSaleList({ copies, containers, reload, onOpenCard }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [exportIds, setExportIds] = useState(null);

  const byId = useMemo(() => new Map((copies || []).map((c) => [c.copy_id, c])), [copies]);
  const groups = useMemo(() => (copies ? forSaleGroups(copies) : null), [copies]);
  const summary = useMemo(() => (copies ? forSaleSummary(copies) : null), [copies]);

  const giveBack = (copyId) => gate.run(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.setForSale({ copyIds: [copyId], value: false });
      if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return; }
      await reload();
    } catch (e) {
      setError(e?.message || 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  });

  if (!groups) return <div className="h-full flex items-center justify-center text-ink-faint">{LOADING}</div>;

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 bg-obsidian-700 border border-line rounded-xl px-4 py-3 shrink-0">
        <span className="text-sm text-ink flex-1">{forSaleHeaderText(summary)}</span>
        <button type="button" onClick={() => setExportIds(groups.flatMap((g) => g.copy_ids))} disabled={summary.copies === 0}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-obsidian-600 border border-line text-ink hover:border-space-violet/40 disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /> Exportieren
        </button>
      </div>
      {exportIds && (
        <ExportDialog filterCopyIds={exportIds} initialFormat="salelist" filterLabel="Zum Verkauf" onClose={() => setExportIds(null)} />
      )}
      {error && <p className="text-sm text-crit">{error}</p>}
      {groups.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-gray-600">Keine Exemplare zum Verkauf.</div>
      ) : (
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {groups.map((g) => {
            const first = byId.get(g.copy_ids[0]) || {};
            return (
              <div key={`${g.card_id}|${g.set_code}|${g.language}|${g.rarity}`} className="bg-obsidian-700 border border-line rounded-xl p-3">
                <button type="button" onClick={() => onOpenCard(first)} className="w-full flex items-center gap-3 text-left">
                  <div className="w-9 h-12 rounded overflow-hidden bg-obsidian-800 shrink-0">
                    {first.image_url && <img src={first.image_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-ink truncate">{g.name || g.card_id}</div>
                    <div className="text-[11px] font-mono text-ink-faint">{g.set_code} · {g.rarity} · {g.language}</div>
                  </div>
                </button>
                <div className="mt-2 space-y-1">
                  {g.copy_ids.map((id) => {
                    const c = byId.get(id);
                    return (
                      <div key={id} className="flex items-center gap-2 px-2 py-1 rounded-lg bg-black/20 border border-gray-800 text-[11px]">
                        <span className="font-mono text-ink-muted">{c.condition} · {EDITION_LABELS[c.edition] || c.edition}</span>
                        <span className="font-mono text-ink-faint truncate">{formatCopyLocation(c, (containers || []).find((ct) => ct.container_id === c.container_id))}</span>
                        <span className="ml-auto font-mono text-gold">{copyValueText(c)}</span>
                        <button type="button" onClick={() => giveBack(id)} disabled={busy}
                          className="px-2 py-0.5 rounded text-[11px] bg-obsidian-600 border border-line text-ink-muted hover:text-ink disabled:opacity-50">
                          Zurück in die Sammlung
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `desktop/src/components/ExportDialog.jsx` ändern** (Aufrufer `CollectionList` „Exportieren…" und `Settings` bleiben ohne neue Props beim bisherigen Verhalten)

In `desktop/src/components/ExportDialog.jsx` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```jsx
// filterCopyIds: Exemplar-IDs des aktuellen Sammlungsfilters oder null (dann gibt es den Umfang "Aktueller Filter" nicht).
export default function ExportDialog({ onClose, filterCopyIds = null }) {
  const [format, setFormat] = useState('carddex');
  const [scopeKind, setScopeKind] = useState(filterCopyIds ? 'filter' : 'all');
```
durch:
```jsx
// filterCopyIds: Exemplar-IDs des aktuellen Sammlungsfilters oder null (dann gibt es den Umfang "Aktueller Filter" nicht).
// Spec H1 §5.1: aus "Zum Verkauf" mit initialFormat 'salelist' und filterLabel "Zum Verkauf" (Umfang genau diese Exemplare).
export default function ExportDialog({ onClose, filterCopyIds = null, initialFormat = 'carddex', filterLabel = 'Aktueller Filter' }) {
  const [format, setFormat] = useState(initialFormat);
  const [scopeKind, setScopeKind] = useState(filterCopyIds ? 'filter' : 'all');
```

Änderung 2/2 — ersetzen:
```jsx
    { value: 'all', label: 'Ganze Sammlung' },
    ...(filterCopyIds ? [{ value: 'filter', label: 'Aktueller Filter' }] : []),
    ...(containers.length ? [{ value: 'container', label: 'Ein Behälter' }] : []),
```
durch:
```jsx
    { value: 'all', label: 'Ganze Sammlung' },
    ...(filterCopyIds ? [{ value: 'filter', label: filterLabel }] : []),
    ...(containers.length ? [{ value: 'container', label: 'Ein Behälter' }] : []),
```

- [ ] **Step 4: `desktop/src/components/CardTile.jsx` ändern** (Aufrufer `Start` übergibt kein `saleNote`)

In `desktop/src/components/CardTile.jsx` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```jsx
import { fmtEUR } from '../utils/format';

export default function CardTile({ card, onClick }) {
  const frame = getFrameColor(card.type);
```
durch:
```jsx
import { fmtEUR } from '../utils/format';

// saleNote: Spec H1 §5.3 Zusatz "(2 zum Verkauf)" der Sammlungszeile, sonst null.
export default function CardTile({ card, onClick, saleNote = null }) {
  const frame = getFrameColor(card.type);
```

Änderung 2/2 — ersetzen:
```jsx
        <h4 className="text-xs font-bold text-ink leading-tight truncate">{card.name}</h4>
        <div className="flex justify-between items-center mt-1 mb-1.5">
```
durch:
```jsx
        <h4 className="text-xs font-bold text-ink leading-tight truncate">{card.name}</h4>
        {saleNote && <div className="text-[9.5px] text-gold truncate">{saleNote}</div>}
        <div className="flex justify-between items-center mt-1 mb-1.5">
```

- [ ] **Step 5: `desktop/src/components/CollectionList.jsx` ändern**

In `desktop/src/components/CollectionList.jsx` (8 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/8 — ersetzen:
```jsx
import { filterCopyIds } from '../utils/exportScope';

// Simple AutoSizer replacement
```
durch:
```jsx
import { filterCopyIds } from '../utils/exportScope';
import DuplicatesList from './DuplicatesList';
import ForSaleList from './ForSaleList';
import { LOADING, duplicates, forSaleSummary, forSaleSuffix } from '../utils/duplicates';
import { useSaleData } from '../utils/useSaleData';

// Simple AutoSizer replacement
```

Änderung 2/8 — ersetzen:
```jsx
  const [copiesLoadError, setCopiesLoadError] = useState(null);
  const [segment, setSegment] = useState('all'); // all | unknown | incomplete | foils
  const [segmentBusy, setSegmentBusy] = useState(false);
```
durch:
```jsx
  const [copiesLoadError, setCopiesLoadError] = useState(null);
  // all | unknown | duplicates | forsale | incomplete | foils; Start oeffnet Duplikate/Zum Verkauf ueber location.state.
  const [segment, setSegment] = useState(() => location.state?.segment || 'all');
  const sale = useSaleData(); // Spec H1: Exemplare fuer Duplikate/Verkaufsliste, data null = laedt
  const [segmentBusy, setSegmentBusy] = useState(false);
```

Änderung 3/8 — ersetzen:
```jsx
  const hasFoilVariant = (c) => Array.from(c.rarities).some(r => !!getRarityInfo(r).foil);

  const segmentCounts = useMemo(() => ({
```
durch:
```jsx
  const hasFoilVariant = (c) => Array.from(c.rarities).some(r => !!getRarityInfo(r).foil);

  // Spec H1 §4: Duplikate je Haupt-Passcode (main_id kommt aus list-sale-copies), Zusatz "(n zum Verkauf)" je Passcode.
  const saleDuplicates = useMemo(() => {
      if (!sale.data) return null;
      const mainIds = new Map(sale.data.copies.map(c => [String(c.card_id), c.main_id]));
      return duplicates(sale.data.copies, sale.data.keep, (id) => mainIds.get(id));
  }, [sale.data]);
  const forSaleByCard = useMemo(() => {
      const m = new Map();
      for (const c of (sale.data ? sale.data.copies : [])) if (c.for_sale) m.set(String(c.card_id), (m.get(String(c.card_id)) || 0) + 1);
      return m;
  }, [sale.data]);

  const segmentCounts = useMemo(() => ({
```

Änderung 4/8 — ersetzen:
```jsx
      unknown: groupedCards.filter(hasUnknownVariant).length,
      incomplete: groupedCards.filter(isIncomplete).length,
      foils: groupedCards.filter(hasFoilVariant).length,
  }), [groupedCards]);

  const filtered = useMemo(() => {
```
durch:
```jsx
      unknown: groupedCards.filter(hasUnknownVariant).length,
      duplicates: saleDuplicates ? saleDuplicates.length : LOADING,
      forsale: sale.data ? forSaleSummary(sale.data.copies).copies : LOADING,
      incomplete: groupedCards.filter(isIncomplete).length,
      foils: groupedCards.filter(hasFoilVariant).length,
  }), [groupedCards, saleDuplicates, sale.data]);

  const filtered = useMemo(() => {
```

Änderung 5/8 — ersetzen:
```jsx
  // The panel walks the list with the arrow buttons, so it gets the current order handed over.
  const openCard = (card) => {
```
durch:
```jsx
  // The panel walks the list with the arrow buttons, so it gets the current order handed over.
  // Spec H1: aus Duplikate/Zum Verkauf ins Karten-Detail des Printings dieses Exemplars.
  const openSaleCopy = (copy) => {
    if (!copy || copy.card_id == null) return;
    navigate(cardRoute({ id: copy.card_id, set_code: copy.set_code, language: copy.language, rarity: copy.rarity }), { state: { background: location, list: [] } });
  };

  const openCard = (card) => {
```

Änderung 6/8 — ersetzen:
```jsx
          <div style={{ ...style, padding: 8 }}>
              <CardTile card={card} onClick={() => openCard(card)} />
              {filterContainers.length > 0 && locationCopy && (
```
durch:
```jsx
          <div style={{ ...style, padding: 8 }}>
              <CardTile card={card} onClick={() => openCard(card)} saleNote={forSaleSuffix(forSaleByCard.get(String(card.id)) || 0)} />
              {filterContainers.length > 0 && locationCopy && (
```

Änderung 7/8 — ersetzen:
```jsx
                    { id: 'unknown', label: 'Unbekannt' },
                    { id: 'incomplete', label: 'Unvollständig' },
```
durch:
```jsx
                    { id: 'unknown', label: 'Unbekannt' },
                    { id: 'duplicates', label: 'Duplikate' },
                    { id: 'forsale', label: 'Zum Verkauf' },
                    { id: 'incomplete', label: 'Unvollständig' },
```

Änderung 8/8 — ersetzen:
```jsx
        <div className="flex-1 overflow-hidden">
            {filtered.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-600">Keine Karten gefunden.</div>
```
durch:
```jsx
        <div className="flex-1 overflow-hidden">
            {sale.error && (segment === 'duplicates' || segment === 'forsale') && (
                <div className="flex items-center gap-2 px-4 py-3 mb-3 rounded-xl border border-crit/40 bg-crit/10 text-sm text-crit">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{sale.error}</span>
                </div>
            )}
            {segment === 'duplicates' ? (
                <DuplicatesList list={saleDuplicates} copies={sale.data ? sale.data.copies : null} reload={sale.reload} onOpenCard={openSaleCopy} />
            ) : segment === 'forsale' ? (
                <ForSaleList copies={sale.data ? sale.data.copies : null} containers={containers} reload={sale.reload} onOpenCard={openSaleCopy} />
            ) : filtered.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-600">Keine Karten gefunden.</div>
```

- [ ] **Step 6: Lint, Build, Helfer**

Run (in `desktop/`): `npx eslint .` → genau `5 errors` (3 warnings; keine neue Meldung in den geänderten Dateien).
Run: `npx vite build` → `✓ built`.
Run: `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 276`.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/DuplicatesList.jsx desktop/src/components/ForSaleList.jsx desktop/src/components/ExportDialog.jsx desktop/src/components/CardTile.jsx desktop/src/components/CollectionList.jsx
git commit -m "feat(h1): Sammlung am PC mit Chips Duplikate und Zum Verkauf, Export der Verkaufsliste

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: PC überall sonst — Exemplar-Sheet, Karten-Detail, Start, Einstellungen, Deckbuilder

**Files:**
- Modify: `desktop/src/components/CopySheet.jsx`
- Modify: `desktop/src/components/CardDetailPanel.jsx`
- Modify: `desktop/src/components/Start.jsx`
- Modify: `desktop/src/components/Settings.jsx`
- Modify: `desktop/src/components/DeckBuilder.jsx`

**Interfaces:**
- Consumes: Task 1 (`KEEP_DEFAULT`, `keepPerCard`, `duplicates`, `duplicatesSummary`, `forSaleSummary`, `startSaleText`, `startDuplicatesText`, `saleShareText`, `LOADING`), Task 2 (`useSaleData`), Task 3 (`list-deck-copies` liefert `for_sale`; `list-copies` liefert es über `SELECT *` schon), Task 4 (`window.api.setForSale`), Task 5 (`CollectionList` liest `location.state.segment`).
- Produces: nichts für spätere Tasks.

- [ ] **Step 1: `desktop/src/components/CopySheet.jsx` ändern** — Schalter „Zum Verkauf" schreibt sofort, dieselbe `busyRef`-Sperre wie Speichern/Entfernen, ruft danach `onSaved` (Karten-Detail lädt nach und meldet `collection-dirty`)

In `desktop/src/components/CopySheet.jsx` (5 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/5 — ersetzen:
```jsx
  const [removing, setRemoving] = useState(false);
  const busyRef = useRef(false); // gleiche Bauart wie Binders.jsx's savingRef -- wirkt synchron, eine State-Flag kaeme zu spaet gegen einen zweiten Klick
```
durch:
```jsx
  const [removing, setRemoving] = useState(false);
  // Spec H1 §5.3: Schalter "Zum Verkauf" schreibt sofort (eigener Knopfzustand, dasselbe busyRef wie Speichern/Entfernen).
  const [forSale, setForSale] = useState(!!copy?.for_sale);
  const [markingSale, setMarkingSale] = useState(false);
  const busyRef = useRef(false); // gleiche Bauart wie Binders.jsx's savingRef -- wirkt synchron, eine State-Flag kaeme zu spaet gegen einen zweiten Klick
```

Änderung 2/5 — ersetzen:
```jsx
      setSaving(false);
    }
```
durch:
```jsx
      setSaving(false);
    }
  };

  const toggleForSale = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setMarkingSale(true);
    setError(null);
    try {
      const next = !forSale;
      const result = await window.api?.setForSale?.({ copyIds: [copy.copy_id], value: next });
      if (!result?.success) {
        setError(result?.error || 'Speichern fehlgeschlagen.');
        return;
      }
      setForSale(next);
      onSaved?.();
    } finally {
      busyRef.current = false;
      setMarkingSale(false);
    }
```

Änderung 3/5 — ersetzen:
```jsx
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Notiz</label>
```
durch:
```jsx
          </div>

          <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Zum Verkauf</span>
            <input type="checkbox" role="switch" checked={forSale} disabled={markingSale || saving || removing}
              onChange={toggleForSale} className="accent-space-violet w-4 h-4" />
          </label>

          <div>
            <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">Notiz</label>
```

Änderung 4/5 — ersetzen:
```jsx
        <div className="p-6 border-t border-gray-700 bg-[#252525] flex items-center justify-between">
          <button type="button" onClick={removeExemplar} disabled={removing || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-crit hover:bg-crit/10 rounded-lg transition-colors disabled:opacity-50">
```
durch:
```jsx
        <div className="p-6 border-t border-gray-700 bg-[#252525] flex items-center justify-between">
          <button type="button" onClick={removeExemplar} disabled={removing || saving || markingSale}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-crit hover:bg-crit/10 rounded-lg transition-colors disabled:opacity-50">
```

Änderung 5/5 — ersetzen:
```jsx
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors">Abbrechen</button>
            <button type="button" onClick={save} disabled={saving || removing}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
```
durch:
```jsx
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors">Abbrechen</button>
            <button type="button" onClick={save} disabled={saving || removing || markingSale}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
```

- [ ] **Step 2: `desktop/src/components/CardDetailPanel.jsx` ändern** — Preisschild an markierten Exemplaren

In `desktop/src/components/CardDetailPanel.jsx` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```jsx
import { ChevronUp, ChevronDown, X, Minus, Plus, Trash2 } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
```
durch:
```jsx
import { ChevronUp, ChevronDown, X, Minus, Plus, Trash2, Tag } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
```

Änderung 2/2 — ersetzen:
```jsx
                                          className="w-full flex items-center gap-2 px-2 py-1 rounded-lg bg-black/20 hover:bg-black/40 border border-gray-800 text-left transition-colors">
                                          <span className="text-[11px] text-gray-400 font-mono truncate">
```
durch:
```jsx
                                          className="w-full flex items-center gap-2 px-2 py-1 rounded-lg bg-black/20 hover:bg-black/40 border border-gray-800 text-left transition-colors">
                                          {/* Spec H1 §5.3: Preisschild an markierten Exemplaren */}
                                          {!!c.for_sale && <Tag className="w-3 h-3 text-gold shrink-0" aria-label="Zum Verkauf" />}
                                          <span className="text-[11px] text-gray-400 font-mono truncate">
```

- [ ] **Step 3: `desktop/src/components/Start.jsx` ändern** — Zähler „Zum Verkauf"/„Duplikate" (Tipp öffnet die Liste) und „davon zum Verkauf"

In `desktop/src/components/Start.jsx` (5 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/5 — ersetzen:
```jsx
import { useNavigate } from 'react-router-dom';
import { Search, Plus, ScanLine, ArrowRight, Clock, TriangleAlert, FileWarning, Award, PackageOpen } from 'lucide-react';
import CardTile from './CardTile';
```
durch:
```jsx
import { useNavigate } from 'react-router-dom';
import { Search, Plus, ScanLine, ArrowRight, Clock, TriangleAlert, FileWarning, Award, PackageOpen, Tag, Copy } from 'lucide-react';
import CardTile from './CardTile';
```

Änderung 2/5 — ersetzen:
```jsx
import { T } from '../utils/i18n-de';

export default function Start({ onOpenPalette }) {
```
durch:
```jsx
import { T } from '../utils/i18n-de';
import { LOADING, duplicates, duplicatesSummary, forSaleSummary, startSaleText, startDuplicatesText, saleShareText } from '../utils/duplicates';
import { useSaleData } from '../utils/useSaleData';

export default function Start({ onOpenPalette }) {
```

Änderung 3/5 — ersetzen:
```jsx
  const [unsortedError, setUnsortedError] = useState(false);

  useEffect(() => {
```
durch:
```jsx
  const [unsortedError, setUnsortedError] = useState(false);
  // Spec H1 §5.3: Zaehler "Zum Verkauf"/"Duplikate" und "davon zum Verkauf"; data null = laedt ("…").
  const sale = useSaleData();
  const saleSummary = useMemo(() => (sale.data ? forSaleSummary(sale.data.copies) : null), [sale.data]);
  const duplicateSummary = useMemo(() => {
    if (!sale.data) return null;
    const mainIds = new Map(sale.data.copies.map(c => [String(c.card_id), c.main_id]));
    return duplicatesSummary(duplicates(sale.data.copies, sale.data.keep, (id) => mainIds.get(id)));
  }, [sale.data]);

  useEffect(() => {
```

Änderung 4/5 — ersetzen:
```jsx
          )}
          <div className="flex gap-4 mt-1.5">
```
durch:
```jsx
          )}
          {/* Spec H1 §5.3: markierte Exemplare zaehlen weiter zum Wert */}
          {saleSummary && saleSummary.copies > 0 && (
            <div className="text-xs text-ink-muted mt-1">{saleShareText(saleSummary)}</div>
          )}
          <div className="flex gap-4 mt-1.5">
```

Änderung 5/5 — ersetzen:
```jsx
          </div>
          <button onClick={() => navigate(ROUTES.scannen)} className="mt-auto flex items-center justify-center gap-2 bg-gradient-to-br from-space-violet to-space-violet-dark text-white font-display font-semibold text-sm py-3 rounded-xl shadow-[0_10px_24px_-10px_#9D00FF]">
```
durch:
```jsx
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => navigate(ROUTES.karten, { state: { segment: 'forsale' } })} className="flex-1 flex items-center gap-2 text-left rounded-xl px-3 py-2.5 border border-gold/30 bg-gold/5 hover:bg-gold/10 transition-colors text-xs text-ink">
              <Tag className="w-4 h-4 text-gold shrink-0" />{saleSummary ? startSaleText(saleSummary) : sale.error ? 'Zum Verkauf: —' : `Zum Verkauf: ${LOADING}`}
            </button>
            <button onClick={() => navigate(ROUTES.karten, { state: { segment: 'duplicates' } })} className="flex-1 flex items-center gap-2 text-left rounded-xl px-3 py-2.5 border border-space-violet/30 bg-space-violet/5 hover:bg-space-violet/10 transition-colors text-xs text-ink">
              <Copy className="w-4 h-4 text-violet-soft shrink-0" />{duplicateSummary ? startDuplicatesText(duplicateSummary) : sale.error ? 'Duplikate: —' : `Duplikate: ${LOADING}`}
            </button>
          </div>
          <button onClick={() => navigate(ROUTES.scannen)} className="mt-auto flex items-center justify-center gap-2 bg-gradient-to-br from-space-violet to-space-violet-dark text-white font-display font-semibold text-sm py-3 rounded-xl shadow-[0_10px_24px_-10px_#9D00FF]">
```

- [ ] **Step 4: `desktop/src/components/Settings.jsx` ändern** — Einstellungen › Standards: `keep_per_card`

In `desktop/src/components/Settings.jsx` (5 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/5 — ersetzen:
```jsx
import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';
import { T } from '../utils/i18n-de';
```
durch:
```jsx
import { CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';
import { KEEP_DEFAULT, keepPerCard } from '../utils/duplicates';
import { T } from '../utils/i18n-de';
```

Änderung 2/5 — ersetzen:
```jsx
    const [defaults, setDefaults] = useState({ edition: 'unknown', condition: 'NM' });
    const [ipAddress, setIpAddress] = useState('…');
```
durch:
```jsx
    const [defaults, setDefaults] = useState({ edition: 'unknown', condition: 'NM' });
    // Spec H1 §4: keep_per_card als Text im Eingabefeld; gespeichert wird der normalisierte Wert (ungültig -> 3).
    const [keepInput, setKeepInput] = useState(String(KEEP_DEFAULT));
    const [ipAddress, setIpAddress] = useState('…');
```

Änderung 3/5 — ersetzen:
```jsx
                }));
            });
```
durch:
```jsx
                }));
                setKeepInput(String(keepPerCard(settings?.keep_per_card)));
            });
```

Änderung 4/5 — ersetzen:
```jsx
        if (window.api) await window.api.saveSetting({ key: key === 'edition' ? 'default_edition' : 'default_condition', value });
    };
```
durch:
```jsx
        if (window.api) await window.api.saveSetting({ key: key === 'edition' ? 'default_edition' : 'default_condition', value });
    };

    const saveKeep = async () => {
        const k = keepPerCard(keepInput);
        setKeepInput(String(k));
        if (window.api) await window.api.saveSetting({ key: 'keep_per_card', value: String(k) });
    };
```

Änderung 5/5 — ersetzen:
```jsx
                            </div>
                        </div>
                    </div>
                )}
```
durch:
```jsx
                            </div>
                        </div>
                        <div className="mt-6 pt-6 border-t border-gray-800">
                            <label className="block text-sm font-bold text-gray-400 mb-2 uppercase tracking-wider">Duplikate: behalten je Karte</label>
                            <input type="number" min="1" max="99" step="1" value={keepInput}
                                onChange={e => setKeepInput(e.target.value)} onBlur={saveKeep}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className="w-24 bg-black/40 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-space-violet" />
                            <p className="text-xs text-gray-500 mt-2">Alles über dieser Anzahl je Karte (über alle Printings) erscheint unter „Duplikate“. Ganze Zahl 1–99, Standard 3. Wird nicht synchronisiert – auf beiden Geräten gleich einstellen.</p>
                        </div>
                    </div>
                )}
```

- [ ] **Step 5: `desktop/src/components/DeckBuilder.jsx` ändern** — Preisschild an Deckzeilen mit markierten Exemplaren (Verfügbarkeit unverändert)

In `desktop/src/components/DeckBuilder.jsx` (7 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/7 — ersetzen:
```jsx
import { useState, useEffect, useMemo } from 'react';
import { Trash2, Save, FileUp, Star } from 'lucide-react';
import { LOADING, boxLabel, deckCoverage, listText } from '../utils/deckCoverage';
```
durch:
```jsx
import { useState, useEffect, useMemo } from 'react';
import { Trash2, Save, FileUp, Star, Tag } from 'lucide-react';
import { LOADING, boxLabel, deckCoverage, listText } from '../utils/deckCoverage';
```

Änderung 2/7 — ersetzen:
```jsx
  const numbersFor = (cardId) => (activeCoverage ? coverageByCard.get(String(cardId)) : null);

  // Spec E3 §7: Legalitaet aus dem UNGESPEICHERTEN Editor-Stand; null, solange der Katalog-Index laedt.
```
durch:
```jsx
  const numbersFor = (cardId) => (activeCoverage ? coverageByCard.get(String(cardId)) : null);
  // Spec H1 §5.3: markierte Exemplare bleiben verfuegbar, die Deckzeile zeigt das Preisschild (gleicher Schluessel wie der Abgleich).
  const forSaleCards = useMemo(() => new Set((coverageData ? coverageData.copies : []).filter((c) => c.for_sale).map((c) => String(c.card_id))), [coverageData]);

  // Spec E3 §7: Legalitaet aus dem UNGESPEICHERTEN Editor-Stand; null, solange der Katalog-Index laedt.
```

Änderung 3/7 — ersetzen:
```jsx
                                {mainDeck.length === 0 && <p className="text-gray-600 text-sm italic">Drag or click cards to add.</p>}
                                {mainDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="main" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} onToggleStarter={toggleStarter} />)}
                            </div>
```
durch:
```jsx
                                {mainDeck.length === 0 && <p className="text-gray-600 text-sm italic">Drag or click cards to add.</p>}
                                {mainDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="main" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} onToggleStarter={toggleStarter} forSale={forSaleCards.has(String(c.card_id))} />)}
                            </div>
```

Änderung 4/7 — ersetzen:
```jsx
                            <div className="space-y-1">
                                {extraDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="extra" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} />)}
                            </div>
```
durch:
```jsx
                            <div className="space-y-1">
                                {extraDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="extra" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} forSale={forSaleCards.has(String(c.card_id))} />)}
                            </div>
```

Änderung 5/7 — ersetzen:
```jsx
                            <div className="space-y-1">
                                {sideDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="side" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} />)}
                            </div>
```
durch:
```jsx
                            <div className="space-y-1">
                                {sideDeck.map(c => <DeckCardRow key={c.card_id} card={c} type="side" numbers={numbersFor(c.card_id)} removeFromDeck={removeFromDeck} onMove={moveOne} ban={banFor(c.card_id)} forSale={forSaleCards.has(String(c.card_id))} />)}
                            </div>
```

Änderung 6/7 — ersetzen:
```jsx
// Spec E3 §7: Banlist-Icon nach Format; Main-Deck-Zeilen mit Starter-Stern (onToggleStarter nur dort).
const DeckCardRow = ({ card, type, numbers, removeFromDeck, onMove, ban, onToggleStarter }) => {
    const missing = !!numbers && numbers.missing > 0;
```
durch:
```jsx
// Spec E3 §7: Banlist-Icon nach Format; Main-Deck-Zeilen mit Starter-Stern (onToggleStarter nur dort).
// Spec H1 §5.3: forSale = mindestens ein Exemplar dieses Passcodes ist zum Verkauf markiert (Preisschild).
const DeckCardRow = ({ card, type, numbers, removeFromDeck, onMove, ban, onToggleStarter, forSale }) => {
    const missing = !!numbers && numbers.missing > 0;
```

Änderung 7/7 — ersetzen:
```jsx
                <DeckBanIcon ban={ban} />
            </div>
```
durch:
```jsx
                <DeckBanIcon ban={ban} />
                {forSale && <Tag className="w-3.5 h-3.5 text-gold shrink-0" aria-label="Zum Verkauf markiert" />}
            </div>
```

- [ ] **Step 6: Lint, Build, Suiten**

Run (in `desktop/`): `npx eslint .` → genau `5 errors`.
Run: `npx vite build` → `✓ built`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 318`; `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 276`.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/CopySheet.jsx desktop/src/components/CardDetailPanel.jsx desktop/src/components/Start.jsx desktop/src/components/Settings.jsx desktop/src/components/DeckBuilder.jsx
git commit -m "feat(h1): Zum-Verkauf-Schalter, Preisschild, Start-Zaehler, keep_per_card und Deckbuilder am PC

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Kotlin-Zwilling `Duplicates` und `CopyRow.forSale`

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CopyRow.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/DuplicatesTest.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/Duplicates.kt`

**Interfaces:**
- Consumes: Fixture aus Task 1; vorhanden `Valuation.unitPrice/factor/EDITION_LABELS`, `Tags.parse`, `CopyRow.printingKey()`, `CardRow.printingKey()`.
- Produces (für Task 8–10): `CopyRow.forSale: Boolean = false` (letztes Feld); in `ml/Duplicates.kt`: `SaleCopy(copy: CopyRow, card: CardRow?)`, `DuplicateEntry(mainId, count, surplus, copyIds: List<String>, value: Double)`, `DuplicatesSummary(cards, copies, value)`, `ForSaleSummary(copies, value)`, `ForSaleGroup(cardId, setCode, language, rarity, name: String?, copyIds)`, `ToggleTargets(ids, value)`, `object Duplicates { KEEP_DEFAULT, LOADING, keepPerCard(raw: String?): Int, hasPlace(c: CopyRow), unitValue(s), duplicates(copies: List<SaleCopy>, keep: String?, mainIdOf: ((String) -> String?)?), summary(list), forSaleSummary(copies), forSaleGroups(copies), euroCents, euroWhole, headerText, confirmAllText, rowCountText, proposalTexts(e, byId: Map<String, SaleCopy>), forSaleHeaderText, startSaleText, startDuplicatesText, saleShareText, forSaleSuffix(n): String?, copyValueText(s), toggleIsOn, premarkedIds, toggleTargets(e, on, premarked: List<String>?), allProposalIds, saleCopies(copies: List<CopyRow>, cards: List<CardRow>): List<SaleCopy> }` (JS `duplicatesSummary` ↔ Kotlin `summary`).

- [ ] **Step 1: `cloud/CopyRow.kt` ändern** (neues Feld mit Vorgabe am Ende; alle bestehenden Konstruktoraufrufe in `main` und `test` kompilieren unverändert)

In `android/app/src/main/java/com/example/yugiohscanner/cloud/CopyRow.kt` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```kotlin
    val updatedAt: String? = null,
) {
```
durch:
```kotlin
    val updatedAt: String? = null,
    // Spec H1 §6: Exemplar steht auf der Verkaufsliste. Geschrieben nur ueber CollectionRepository.setForSale.
    val forSale: Boolean = false,
) {
```

- [ ] **Step 2: Test schreiben** — `android/app/src/test/java/com/example/yugiohscanner/DuplicatesTest.kt`:

Vollständiger Inhalt von `android/app/src/test/java/com/example/yugiohscanner/DuplicatesTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.DuplicateEntry
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.DuplicatesSummary
import com.example.yugiohscanner.ml.ForSaleGroup
import com.example.yugiohscanner.ml.ForSaleSummary
import com.example.yugiohscanner.ml.SaleCopy
import com.example.yugiohscanner.ml.ToggleTargets
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/duplicates.test.js -- dieselbe Fixture docs/fixtures/duplicates/duplicates.json. */
class DuplicatesTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/duplicates/duplicates.json"))
    private val base = fix.getJSONObject("base")
    private val aliases: Map<String, String> = fix.getJSONObject("aliases").let { o -> o.keys().asSequence().associateWith { o.getString(it) } }

    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    private fun dbl(o: JSONObject, k: String): Double? = if (!o.has(k) || o.isNull(k)) null else o.getDouble(k)
    private fun strings(a: JSONArray): List<String> = (0 until a.length()).map { a.getString(it) }

    /** Exemplar = base plus die Felder des Eintrags; das Printing traegt Name und Preise. */
    private fun saleCopy(partial: JSONObject): SaleCopy {
        val o = JSONObject(base.toString())
        for (k in partial.keys()) o.put(k, partial.get(k))
        val copy = CopyRow(
            copyId = o.getString("copy_id"), cardId = o.getString("card_id"), setCode = o.getString("set_code"),
            language = o.getString("language"), rarity = o.getString("rarity"), edition = o.getString("edition"),
            condition = o.getString("condition"), deleted = o.getBoolean("deleted"),
            containerId = str(o, "container_id"), page = null, slot = null, tags = str(o, "tags"), note = str(o, "note"),
            createdAt = str(o, "created_at"), forSale = o.getBoolean("for_sale"),
        )
        val card = CardRow(
            id = copy.cardId, setCode = copy.setCode, language = copy.language, name = str(o, "name"), imageUrl = null,
            rarity = copy.rarity, quantity = 1, price = dbl(o, "price"), priceFirstEd = dbl(o, "price_first_ed"),
        )
        return SaleCopy(copy, card)
    }

    private fun entry(o: JSONObject) =
        DuplicateEntry(o.getString("main_id"), o.getInt("count"), o.getInt("surplus"), strings(o.getJSONArray("copy_ids")), o.getDouble("value"))

    @Test fun `Fixture Duplikate und Texte`() {
        for (c in fix.getJSONArray("cases").objects()) {
            val name = c.getString("name")
            val copies = c.getJSONArray("copies").objects().map { saleCopy(it) }
            val list = Duplicates.duplicates(copies, str(c, "keep"), if (c.getBoolean("catalog")) { p -> aliases[p] ?: p } else null)
            assertEquals(name, c.getJSONArray("expected").objects().map { entry(it) }, list)
            if (c.has("texts")) {
                val t = c.getJSONObject("texts")
                val summary = Duplicates.summary(list)
                val byId = copies.associateBy { it.copy.copyId }
                assertEquals(name, t.getString("header"), Duplicates.headerText(summary))
                assertEquals(name, t.getString("confirm"), Duplicates.confirmAllText(summary))
                assertEquals(name, t.getString("startDuplicates"), Duplicates.startDuplicatesText(summary))
                assertEquals(name, strings(t.getJSONArray("rows")), list.map { Duplicates.rowCountText(it) })
                val proposals = t.getJSONArray("proposals")
                assertEquals(name, (0 until proposals.length()).map { strings(proposals.getJSONArray(it)) }, list.map { Duplicates.proposalTexts(it, byId) })
            }
            if (c.has("allProposalIds")) {
                val a = c.getJSONObject("allProposalIds")
                assertEquals(name, strings(a.getJSONArray("ids")), Duplicates.allProposalIds(list, strings(a.getJSONArray("forSale")).toSet()))
            }
        }
    }

    @Test fun `Fixture keep_per_card`() {
        for (k in fix.getJSONArray("keep").objects()) assertEquals(k.toString(), k.getInt("expected"), Duplicates.keepPerCard(str(k, "raw")))
        assertEquals(3, Duplicates.KEEP_DEFAULT)
    }

    @Test fun `Fixture Euro-Texte`() {
        for (e in fix.getJSONArray("euro").objects()) {
            assertEquals(e.toString(), e.getString("cents"), Duplicates.euroCents(e.getDouble("value")))
            assertEquals(e.toString(), e.getString("whole"), Duplicates.euroWhole(e.getDouble("value")))
        }
    }

    @Test fun `Fixture Verkaufsliste, Summen und Texte`() {
        val f = fix.getJSONObject("forSale")
        val copies = f.getJSONArray("copies").objects().map { saleCopy(it) }
        val s = Duplicates.forSaleSummary(copies)
        val e = f.getJSONObject("expected")
        assertEquals(ForSaleSummary(e.getInt("copies"), e.getDouble("value")), s)
        assertEquals(
            f.getJSONArray("groups").objects().map {
                ForSaleGroup(it.getString("card_id"), it.getString("set_code"), it.getString("language"), it.getString("rarity"), str(it, "name"), strings(it.getJSONArray("copy_ids")))
            },
            Duplicates.forSaleGroups(copies),
        )
        val t = f.getJSONObject("texts")
        assertEquals(t.getString("header"), Duplicates.forSaleHeaderText(s))
        assertEquals(t.getString("start"), Duplicates.startSaleText(s))
        assertEquals(t.getString("share"), Duplicates.saleShareText(s))
        val values = f.getJSONObject("copyValues")
        for (id in values.keys()) assertEquals(id, values.getString(id), Duplicates.copyValueText(copies.first { it.copy.copyId == id }))
        for (x in fix.getJSONArray("summaryTexts").objects()) {
            val o = x.getJSONObject("summary")
            val sum = ForSaleSummary(o.getInt("copies"), o.getDouble("value"))
            assertEquals(x.getString("header"), Duplicates.forSaleHeaderText(sum))
            assertEquals(x.getString("start"), Duplicates.startSaleText(sum))
            assertEquals(x.getString("share"), Duplicates.saleShareText(sum))
        }
        for (x in fix.getJSONArray("suffix").objects()) assertEquals(str(x, "text"), Duplicates.forSaleSuffix(x.getInt("n")))
    }

    @Test fun `Fixture Zeilen-Schalter`() {
        val t = fix.getJSONObject("toggle")
        val e = entry(t.getJSONObject("entry"))
        for (c in t.getJSONArray("cases").objects()) {
            val name = c.getString("name")
            val marked = strings(c.getJSONArray("forSale")).toSet()
            val pre = Duplicates.premarkedIds(e, marked)
            assertEquals(name, c.getBoolean("isOn"), Duplicates.toggleIsOn(e, marked))
            assertEquals(name, strings(c.getJSONArray("premarked")), pre)
            assertEquals(name, ToggleTargets(strings(c.getJSONArray("on")), true), Duplicates.toggleTargets(e, true, pre))
            assertEquals(name, ToggleTargets(strings(c.getJSONArray("offWithHistory")), false), Duplicates.toggleTargets(e, false, pre))
            assertEquals(name, ToggleTargets(strings(c.getJSONArray("offWithoutHistory")), false), Duplicates.toggleTargets(e, false, null))
        }
    }

    @Test fun `Platzhalter ist nie eine Null und leere Liste hat Summe null`() {
        assertEquals("…", Duplicates.LOADING)
        assertEquals(DuplicatesSummary(0, 0, 0.0), Duplicates.summary(emptyList()))
    }
}
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest`
Expected: FAIL in `compileDebugUnitTestKotlin` mit `Unresolved reference 'DuplicateEntry'` (ebenso `'Duplicates'`, `'SaleCopy'` …).

- [ ] **Step 4: `ml/Duplicates.kt` anlegen**

Vollständiger Inhalt von `android/app/src/main/java/com/example/yugiohscanner/ml/Duplicates.kt`:

```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey
import java.util.Locale

/** Ein lebendes Exemplar mit seinem Printing (Preis, 1.-Auflage-Preis, Name, Bild); card null = Printing fehlt, Preis 0. */
data class SaleCopy(val copy: CopyRow, val card: CardRow?)

/** Ein Duplikat-Eintrag je Haupt-Passcode; copyIds = Vorschlag in Sortierreihenfolge, value = Wert des Vorschlags. */
data class DuplicateEntry(val mainId: String, val count: Int, val surplus: Int, val copyIds: List<String>, val value: Double)

data class DuplicatesSummary(val cards: Int, val copies: Int, val value: Double)

data class ForSaleSummary(val copies: Int, val value: Double)

/** Ein Printing der Verkaufsliste mit seinen markierten Exemplaren (nach created_at, dann copy_id). */
data class ForSaleGroup(
    val cardId: String, val setCode: String, val language: String, val rarity: String, val name: String?, val copyIds: List<String>,
)

data class ToggleTargets(val ids: List<String>, val value: Boolean)

/**
 * Spec H1 §4/§5 -- Duplikate (Überschuss über keep_per_card je Haupt-Passcode, Vorschlag), Verkaufsliste und die Texte dazu.
 * ZWILLING: desktop/src/utils/duplicates.js. Beide laufen gegen docs/fixtures/duplicates/duplicates.json.
 * Wer eine Seite aendert, aendert beide. Wert je Exemplar = Valuation.unitPrice x Zustandsfaktor (Wertanzeige-Formel).
 */
object Duplicates {
    const val KEEP_DEFAULT = 3
    const val LOADING = "…"

    /** Schlechtester Zustand zuerst; ein unbekannter Zustand ordnet wie NM. */
    private val CONDITION_RANK = listOf("PO", "PL", "LP", "GD", "EX", "NM", "MT")
    private val KEEP_RE = Regex("(?U)^\\s*([0-9]{1,2})\\s*$")
    private val BLANK_RE = Regex("(?U)^\\s*$")

    private fun round2(v: Double) = Math.round(v * 100.0) / 100.0
    private fun rank(condition: String): Int = CONDITION_RANK.indexOf(condition).let { if (it < 0) CONDITION_RANK.indexOf("NM") else it }
    private fun plural(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"

    /** Einstellung keep_per_card: ganze Zahl 1–99, alles andere -> 3. */
    fun keepPerCard(raw: String?): Int {
        val m = KEEP_RE.find(raw ?: "") ?: return KEEP_DEFAULT
        val n = m.groupValues[1].toInt()
        return if (n in 1..99) n else KEEP_DEFAULT
    }

    /** Standort, Tags oder Notiz gesetzt; leere Werte zaehlen wie nicht gesetzt. */
    fun hasPlace(c: CopyRow): Boolean =
        !c.containerId.isNullOrEmpty() || Tags.parse(c.tags).isNotEmpty() || (c.note != null && !BLANK_RE.matches(c.note))

    private fun unitPrice(s: SaleCopy): Double = s.card?.let { Valuation.unitPrice(it, s.copy) } ?: 0.0

    /** Wert eines Exemplars (ungerundet); ohne Preis 0. */
    fun unitValue(s: SaleCopy): Double = unitPrice(s) * Valuation.factor(s.copy.condition)

    private fun flag(b: Boolean) = if (b) 1 else 0

    /** Stabile Vorschlags-Reihenfolge (Kriterien 1–6); zuletzt copy_id, damit beide Geraete gleich ordnen. */
    private val PROPOSAL_ORDER = Comparator<SaleCopy> { a, b ->
        var r = flag(b.copy.forSale) - flag(a.copy.forSale)
        if (r == 0) r = flag(hasPlace(a.copy)) - flag(hasPlace(b.copy))
        if (r == 0) r = flag(a.copy.edition == "first") - flag(b.copy.edition == "first")
        if (r == 0) r = rank(a.copy.condition) - rank(b.copy.condition)
        if (r == 0) r = unitPrice(a).compareTo(unitPrice(b))
        if (r == 0) r = (b.copy.createdAt ?: "").compareTo(a.copy.createdAt ?: "")
        if (r == 0) r = a.copy.copyId.compareTo(b.copy.copyId)
        r
    }

    /**
     * [copies]: Exemplare (geloeschte werden uebersprungen); [keep]: roh; [mainIdOf]: Passcode -> Haupt-Passcode (null = ohne
     * Katalog). Nur Karten mit Überschuss, sortiert nach Überschuss, dann Wert (beide absteigend), dann Haupt-Passcode.
     */
    fun duplicates(copies: List<SaleCopy>, keep: String?, mainIdOf: ((String) -> String?)?): List<DuplicateEntry> {
        val k = keepPerCard(keep)
        val groups = LinkedHashMap<String, MutableList<SaleCopy>>()
        for (s in copies) {
            if (s.copy.deleted) continue
            val stored = s.copy.cardId
            val mapped = mainIdOf?.invoke(stored)
            val id = if (mapped.isNullOrEmpty()) stored else mapped
            groups.getOrPut(id) { ArrayList() }.add(s)
        }
        val out = ArrayList<DuplicateEntry>()
        for ((id, list) in groups) {
            val surplus = maxOf(0, list.size - k)
            if (surplus == 0) continue
            val pick = list.sortedWith(PROPOSAL_ORDER).take(surplus)
            out.add(DuplicateEntry(id, list.size, surplus, pick.map { it.copy.copyId }, round2(pick.sumOf { unitValue(it) })))
        }
        return out.sortedWith(compareByDescending<DuplicateEntry> { it.surplus }.thenByDescending { it.value }.thenBy { it.mainId })
    }

    fun summary(list: List<DuplicateEntry>) = DuplicatesSummary(list.size, list.sumOf { it.surplus }, round2(list.sumOf { it.value }))

    fun forSaleSummary(copies: List<SaleCopy>): ForSaleSummary {
        val marked = copies.filter { !it.copy.deleted && it.copy.forSale }
        return ForSaleSummary(marked.size, round2(marked.sumOf { unitValue(it) }))
    }

    /** Verkaufsliste nach Printing, sortiert nach Name, Set-Code, Sprache, Seltenheit (Codeeinheiten wie in JS), Passcode. */
    fun forSaleGroups(copies: List<SaleCopy>): List<ForSaleGroup> {
        val groups = LinkedHashMap<String, MutableList<SaleCopy>>()
        for (s in copies) {
            if (s.copy.deleted || !s.copy.forSale) continue
            groups.getOrPut(s.copy.printingKey()) { ArrayList() }.add(s)
        }
        return groups.values.map { list ->
            val c = list.first().copy
            ForSaleGroup(
                c.cardId, c.setCode, c.language, c.rarity, list.first().card?.name,
                list.map { it.copy }.sortedWith(compareBy<CopyRow> { it.createdAt ?: "" }.thenBy { it.copyId }).map { it.copyId },
            )
        }.sortedWith(
            compareBy<ForSaleGroup> { it.name ?: "" }.thenBy { it.setCode }.thenBy { it.language }.thenBy { it.rarity }.thenBy { it.cardId },
        )
    }

    fun euroCents(v: Double): String = String.format(Locale.GERMANY, "%,.2f €", round2(v))
    fun euroWhole(v: Double): String = String.format(Locale.GERMANY, "%,d €", Math.round(v))

    fun headerText(s: DuplicatesSummary) =
        "${plural(s.cards, "Karte", "Karten")} · ${plural(s.copies, "Exemplar", "Exemplare")} über Playset · ca. ${euroWhole(s.value)}"
    fun confirmAllText(s: DuplicatesSummary) = "${plural(s.copies, "Exemplar", "Exemplare")} von ${plural(s.cards, "Karte", "Karten")} markieren?"
    fun rowCountText(e: DuplicateEntry) = "${plural(e.count, "Exemplar", "Exemplare")} · ${e.surplus} über Playset"

    /** Vorschlag in Worten, je Set-Code/Seltenheit/Zustand/Edition gezaehlt, in Vorschlagsreihenfolge. */
    fun proposalTexts(e: DuplicateEntry, byId: Map<String, SaleCopy>): List<String> {
        val groups = LinkedHashMap<List<String>, Pair<Int, CopyRow>>()
        for (id in e.copyIds) {
            val c = byId[id]?.copy ?: continue
            val key = listOf(c.setCode, c.rarity, c.condition, c.edition)
            val g = groups[key]
            groups[key] = if (g == null) 1 to c else (g.first + 1) to g.second
        }
        return groups.values.map { (n, c) -> "$n× ${c.setCode} ${c.rarity} · ${c.condition} · ${Valuation.EDITION_LABELS[c.edition] ?: c.edition}" }
    }

    fun forSaleHeaderText(s: ForSaleSummary) = "${plural(s.copies, "Exemplar", "Exemplare")} · ${euroCents(s.value)}"
    fun startSaleText(s: ForSaleSummary) = "Zum Verkauf: ${plural(s.copies, "Exemplar", "Exemplare")} · ${euroWhole(s.value)}"
    fun startDuplicatesText(s: DuplicatesSummary) = "Duplikate: ${plural(s.cards, "Karte", "Karten")}"
    fun saleShareText(s: ForSaleSummary) = "davon zum Verkauf: ${euroWhole(s.value)}"
    fun forSaleSuffix(n: Int): String? = if (n > 0) "($n zum Verkauf)" else null
    fun copyValueText(s: SaleCopy): String = if (unitPrice(s) > 0) euroCents(unitValue(s)) else "—"

    /** Spec H1 §5.4: "An" = alle Vorschlaege markiert. */
    fun toggleIsOn(e: DuplicateEntry, forSaleIds: Set<String>) = e.copyIds.isNotEmpty() && e.copyIds.all { it in forSaleIds }
    /** Beim Einschalten merken: diese Vorschlaege waren schon vorher markiert. */
    fun premarkedIds(e: DuplicateEntry, forSaleIds: Set<String>) = e.copyIds.filter { it in forSaleIds }
    /** An: alle Vorschlaege auf true. Aus: alle ausser den vorher markierten ([premarked] null = keine Vorgeschichte). */
    fun toggleTargets(e: DuplicateEntry, on: Boolean, premarked: List<String>?): ToggleTargets =
        if (on) ToggleTargets(e.copyIds.toList(), true)
        else (premarked ?: emptyList()).toSet().let { keep -> ToggleTargets(e.copyIds.filter { it !in keep }, false) }
    /** "Alle Vorschläge auf die Verkaufsliste": alle vorgeschlagenen, noch nicht markierten Exemplare. */
    fun allProposalIds(list: List<DuplicateEntry>, forSaleIds: Set<String>) = list.flatMap { it.copyIds }.filter { it !in forSaleIds }

    /** Exemplare des Speichers mit ihrem Printing; wie am Desktop (JOIN) nur lebende Exemplare lebender Printings. */
    fun saleCopies(copies: List<CopyRow>, cards: List<CardRow>): List<SaleCopy> {
        val byKey = cards.filter { !it.deleted }.associateBy { it.printingKey() }
        return copies.mapNotNull { c -> if (c.deleted) null else byKey[c.printingKey()]?.let { SaleCopy(c, it) } }
    }
}
```

- [ ] **Step 5: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug` → `BUILD SUCCESSFUL`; `DuplicatesTest` 6 Tests, gesamt 533 Tests/0 Fehler.

- [ ] **Step 6: Schutz-Nachweis und Zwillingstreue**

In `duplicates` die Zeile `            val mapped = mainIdOf?.invoke(stored)` kurz zu `            val mapped: String? = null` ändern → `DuplicatesTest > Fixture Duplikate und Texte FAILED` (gemessen). Zitieren, per Edit zurücknehmen. Im Bericht bestätigen: `[0-9]` und `(?U)` in `KEEP_RE`/`BLANK_RE`, `Math.round` beim Runden, leerer `mainIdOf`-Wert = gespeicherter Passcode, Vergleiche in Codeeinheiten (`compareTo`), Tiebreak `copy_id`, `%,d`/`%,.2f` mit `Locale.GERMANY`.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CopyRow.kt android/app/src/main/java/com/example/yugiohscanner/ml/Duplicates.kt android/app/src/test/java/com/example/yugiohscanner/DuplicatesTest.kt
git commit -m "feat(h1): Kotlin-Zwilling Duplikate und Verkaufsliste auf derselben Fixture, CopyRow.forSale

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: Handy-Repository — `for_sale` lesen, patchen, Minus-Reihenfolge

**Files:**
- Modify: `android/app/src/test/java/com/example/yugiohscanner/StoreQueriesTest.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/SaleCopiesRepoTest.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/StoreQueries.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt`

**Interfaces:**
- Consumes (Task 7): `CopyRow.forSale`, `Duplicates.saleCopies`, `Duplicates.hasPlace`.
- Produces (für Task 9, 10): `StoreQueries.COPY_COLS` mit `for_sale` (Speicher-Voll-/Delta-Abfragen und `copiesOf` lesen es), `CollectionRepository.parseCopies` (`internal`, liest `for_sale`, fehlend/null = false), `CollectionRepository.removalOrder(copies): List<CopyRow>` (`internal`, markierte zuerst, sonst stabil), `CollectionRepository.forSalePatchParams(ids, value): List<Pair<String, String>>` (`internal`), `suspend fun CollectionRepository.setForSale(copyIds: List<String>, value: Boolean)` (Blöcke zu 100, wirft `RuntimeException("Verkaufsliste ändern fehlgeschlagen (…)")`).

- [ ] **Step 1: Tests schreiben**

`StoreQueriesTest.kt`:

In `android/app/src/test/java/com/example/yugiohscanner/StoreQueriesTest.kt` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```kotlin
        assertEquals(
            "copy_id,card_id,set_code,language,rarity,edition,condition,deleted,container_id,page,slot,tags,note,created_at,updated_at",
            StoreQueries.COPY_COLS,
```
durch:
```kotlin
        assertEquals(
            "copy_id,card_id,set_code,language,rarity,edition,condition,deleted,container_id,page,slot,tags,note,for_sale,created_at,updated_at",
            StoreQueries.COPY_COLS,
```

`SaleCopiesRepoTest.kt` anlegen:

Vollständiger Inhalt von `android/app/src/test/java/com/example/yugiohscanner/SaleCopiesRepoTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.Duplicates
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Spec H1 §5.3/§6/§8 -- das Handy liest for_sale, patcht es idempotent und entfernt markierte Exemplare zuerst. */
class SaleCopiesRepoTest {
    private fun copy(id: String, forSale: Boolean = false, deleted: Boolean = false, setCode: String = "LOB-DE005") = CopyRow(
        copyId = id, cardId = "46986414", setCode = setCode, language = "DE", rarity = "Common",
        edition = "unknown", condition = "NM", deleted = deleted, containerId = null, page = null, slot = null,
        tags = null, note = null, forSale = forSale,
    )

    @Test fun `liest for_sale, fehlend oder null ist false`() {
        val rows = CollectionRepository.parseCopies(JSONArray("""[
            {"copy_id":"a","card_id":"1","for_sale":true},
            {"copy_id":"b","card_id":"1","for_sale":false},
            {"copy_id":"c","card_id":"1","for_sale":null},
            {"copy_id":"d","card_id":"1"}
        ]"""))
        assertEquals(listOf(true, false, false, false), rows.map { it.forSale })
    }

    @Test fun `Minus nimmt markierte Exemplare zuerst, sonst bleibt die Reihenfolge`() {
        // copiesOf liefert neueste zuerst: n3, n2, m1 (m1 ist das aelteste, aber markiert).
        val order = CollectionRepository.removalOrder(listOf(copy("n3"), copy("m2", forSale = true), copy("n2"), copy("m1", forSale = true)))
        assertEquals(listOf("m2", "m1", "n3", "n2"), order.map { it.copyId })
    }

    @Test fun `PATCH-Parameter treffen nur lebende Exemplare mit anderem Wert`() {
        assertEquals(
            listOf("copy_id" to "in.(\"u1\",\"u2\")", "deleted" to "eq.false", "for_sale" to "eq.false"),
            CollectionRepository.forSalePatchParams(listOf("u1", "u2"), true),
        )
        assertEquals("eq.true", CollectionRepository.forSalePatchParams(listOf("u1"), false)[2].second)
    }

    @Test fun `Verkaufs-Exemplare nur lebend und mit lebendem Printing`() {
        val live = CardRow("46986414", "LOB-DE005", "DE", "Dunkler Magier", null, "Common", 2, 2.0)
        val gone = CardRow("46986414", "SDY-DE006", "DE", "Dunkler Magier", null, "Common", 0, 1.0, deleted = true)
        val sale = Duplicates.saleCopies(
            listOf(copy("k1"), copy("weg", deleted = true), copy("ohne-printing", setCode = "XXX-DE001"), copy("printing-weg", setCode = "SDY-DE006")),
            listOf(live, gone),
        )
        assertEquals(listOf("k1"), sale.map { it.copy.copyId })
        assertEquals(live, sale.single().card)
        assertTrue(Duplicates.hasPlace(copy("x").copy(note = "Tausch")))
        assertFalse(Duplicates.hasPlace(copy("x").copy(containerId = "", tags = "[]", note = " ")))
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest`
Expected: FAIL in `compileDebugUnitTestKotlin` mit `Cannot access 'fun parseCopies…': it is private` bzw. `Unresolved reference 'removalOrder'`/`'forSalePatchParams'`.

- [ ] **Step 3: `cloud/StoreQueries.kt` ändern**

In `android/app/src/main/java/com/example/yugiohscanner/cloud/StoreQueries.kt` (1 Änderung, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/1 — ersetzen:
```kotlin
    const val COPY_COLS =
        "copy_id,card_id,set_code,language,rarity,edition,condition,deleted,container_id,page,slot,tags,note,created_at,updated_at"
    const val CONTAINER_COLS = "container_id,name,kind,pockets_per_page,color,sort_order,deleted,updated_at"
```
durch:
```kotlin
    const val COPY_COLS =
        "copy_id,card_id,set_code,language,rarity,edition,condition,deleted,container_id,page,slot,tags,note,for_sale,created_at,updated_at"
    const val CONTAINER_COLS = "container_id,name,kind,pockets_per_page,color,sort_order,deleted,updated_at"
```

- [ ] **Step 4: `cloud/CollectionRepository.kt` ändern**

In `android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt` (3 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/3 — ersetzen:
```kotlin
    }

    suspend fun removeCopies(printing: CardRow, edition: String, condition: String, count: Int = 1): Int = withContext(Dispatchers.IO) {
        val victims = copiesOf(printing, edition, condition).take(maxOf(1, count))
        for (c in victims) patchCopy(c.copyId, JSONObject().put("deleted", true))
```
durch:
```kotlin
    }

    // Spec H1 §5.3: markierte Exemplare (for_sale) zuerst, sonst die bisherige Reihenfolge (neueste zuerst, wie copiesOf liefert).
    internal fun removalOrder(copies: List<CopyRow>): List<CopyRow> = copies.sortedByDescending { it.forSale }

    suspend fun removeCopies(printing: CardRow, edition: String, condition: String, count: Int = 1): Int = withContext(Dispatchers.IO) {
        val victims = removalOrder(copiesOf(printing, edition, condition)).take(maxOf(1, count))
        for (c in victims) patchCopy(c.copyId, JSONObject().put("deleted", true))
```

Änderung 2/3 — ersetzen:
```kotlin
    }

    private fun parseCopies(arr: JSONArray): List<CopyRow> = (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
```
durch:
```kotlin
    }

    // internal statt private: SaleCopiesRepoTest prueft das Lesen von for_sale (Spec H1 §8).
    internal fun parseCopies(arr: JSONArray): List<CopyRow> = (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
```

Änderung 3/3 — ersetzen:
```kotlin
            updatedAt = if (o.isNull("updated_at")) null else o.optString("updated_at"),
        )
    }
```
durch:
```kotlin
            updatedAt = if (o.isNull("updated_at")) null else o.optString("updated_at"),
            forSale = o.optBoolean("for_sale", false),
        )
    }

    /**
     * Spec H1 §6: Query-Parameter eines for_sale-PATCH fuer einen Block copy_ids -- nur lebende Exemplare und nur solche mit
     * anderem Wert, damit ein wiederholter Aufruf nichts neu stempelt. Rein, damit ohne Server testbar.
     */
    internal fun forSalePatchParams(ids: List<String>, value: Boolean): List<Pair<String, String>> = listOf(
        "copy_id" to "in.(${ids.joinToString(",") { "\"$it\"" }})",
        "deleted" to "eq.false",
        "for_sale" to "eq.${!value}",
    )

    /**
     * Spec H1 §6: Verkaufsliste umschalten, in Bloecken zu 100 copy_ids. `updated_at` stempelt der Server (Delta-Abgleich).
     * Aufrufer laufen durch das InFlight-Gatter und gleichen danach mit CollectionStore.awaitSync() ab.
     */
    suspend fun setForSale(copyIds: List<String>, value: Boolean) = withContext(Dispatchers.IO) {
        for (chunk in copyIds.distinct().chunked(100)) {
            val b = "${SupabaseCloud.base()}/rest/v1/card_copies".toHttpUrl().newBuilder()
            for ((k, v) in forSalePatchParams(chunk, value)) b.addQueryParameter(k, v)
            val body = JSONObject().put("for_sale", value)
            executeWithReauth {
                auth(Request.Builder().url(b.build())).addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "return=minimal")
                    .patch(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
            }.use { resp -> if (!resp.isSuccessful) throw RuntimeException("Verkaufsliste ändern fehlgeschlagen (${resp.code}): ${resp.body?.string()}") }
        }
    }
```

- [ ] **Step 5: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug` → `BUILD SUCCESSFUL`; `SaleCopiesRepoTest` 4 Tests, `StoreQueriesTest` 8 Tests, gesamt 537 Tests/0 Fehler.

- [ ] **Step 6: Schutz-Nachweise**

(a) Minus-Regel: in `removalOrder` `copies.sortedByDescending { it.forSale }` kurz zu `copies` → `SaleCopiesRepoTest > Minus nimmt markierte Exemplare zuerst, sonst bleibt die Reihenfolge FAILED` (gemessen).
(b) `InFlight`-Gatter (bestehend, von Task 9/10 benutzt): in `ui/InFlight.kt` die Zeile `        if (running) return false` kurz entfernen → `InFlightTest > zweiter tryStart waehrend eines Laufs liefert false, nach finish wieder true FAILED` (gemessen). `InFlight.kt` wird nicht geändert.
Jeweils zitieren und per Edit zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/StoreQueries.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt android/app/src/test/java/com/example/yugiohscanner/StoreQueriesTest.kt android/app/src/test/java/com/example/yugiohscanner/SaleCopiesRepoTest.kt
git commit -m "feat(h1): Handy liest und patcht for_sale, Minus nimmt markierte zuerst

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 9: Handy Sammlung — Chip-Zeile, Duplikate, Zum Verkauf, `keep_per_card`

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/Prefs.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/SaleLists.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt`

**Interfaces:**
- Consumes: Task 7 (`Duplicates`, `SaleCopy`, `DuplicateEntry`), Task 8 (`CollectionRepository.setForSale`), vorhanden `InFlight`, `CollectionStore.state/awaitSync`, `CatalogRepository.aliases`, `CopyLocation.format`.
- Produces (für Task 10): `Prefs.keepPerCard(ctx): Int`, `Prefs.setKeepPerCard(ctx, raw): Int`; in `ui/SaleLists.kt`: `object CollectionChip { ALLE, DUPLIKATE, VERKAUF, request: StateFlow<String?>, open(chip), take(): String? }`, `class SaleData(cards, copies, keep, sale: List<SaleCopy>, duplicates: List<DuplicateEntry>) { byId, forSaleIds }`, `suspend fun freshSaleData(ctx): SaleData?`, `@Composable fun rememberSaleData(): SaleData?` (null = wird gerechnet), `@Composable fun DuplicatesList(data, onOpenCard: (String) -> Unit, modifier)`, `@Composable fun ForSaleList(data, onOpenCard, modifier)`.

- [ ] **Step 1: `Prefs.kt` ändern**

In `android/app/src/main/java/com/example/yugiohscanner/Prefs.kt` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```kotlin
import com.example.yugiohscanner.cloud.Valuation

object Prefs {
```
durch:
```kotlin
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.Duplicates

object Prefs {
```

Änderung 2/2 — ersetzen:
```kotlin
        p(ctx).edit().putString("scan_mode", if (v == "stapel") "stapel" else "einzeln").apply()
}
```
durch:
```kotlin
        p(ctx).edit().putString("scan_mode", if (v == "stapel") "stapel" else "einzeln").apply()

    /** Spec H1 §4: keep_per_card, ganze Zahl 1–99, ungültig oder fehlend -> 3 (Duplicates.keepPerCard). Kein Sync. */
    fun keepPerCard(ctx: Context): Int = Duplicates.keepPerCard(p(ctx).getString("keep_per_card", null))
    /** Speichert den normalisierten Wert und liefert ihn zurueck (fuer das Eingabefeld). */
    fun setKeepPerCard(ctx: Context, raw: String): Int =
        Duplicates.keepPerCard(raw).also { p(ctx).edit().putString("keep_per_card", it.toString()).apply() }
}
```

- [ ] **Step 2: `ui/SettingsScreen.kt` ändern** — Einstellungen › Standards

In `android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt` (3 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/3 — ersetzen:
```kotlin
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
```
durch:
```kotlin
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
```

Änderung 2/3 — ersetzen:
```kotlin
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
```
durch:
```kotlin
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
```

Änderung 3/3 — ersetzen:
```kotlin
                        label = { Text(com.example.yugiohscanner.cloud.Valuation.EDITION_LABELS[e] ?: e) })
                }
            }
        }

        // ---- Über -------------------------------------------------------------
```
durch:
```kotlin
                        label = { Text(com.example.yugiohscanner.cloud.Valuation.EDITION_LABELS[e] ?: e) })
                }
            }
            // Spec H1 §4: keep_per_card -- gespeichert beim Verlassen des Felds oder "Fertig", normalisiert (ungültig -> 3).
            var keepInput by remember { mutableStateOf(com.example.yugiohscanner.Prefs.keepPerCard(ctx).toString()) }
            var keepFocused by remember { mutableStateOf(false) }
            fun saveKeep() { keepInput = com.example.yugiohscanner.Prefs.setKeepPerCard(ctx, keepInput).toString() }
            Text("Duplikate: behalten je Karte", style = MaterialTheme.typography.labelSmall, color = Muted)
            OutlinedTextField(
                value = keepInput, onValueChange = { keepInput = it.filter(Char::isDigit).take(2) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { saveKeep() }),
                modifier = Modifier.width(96.dp).onFocusChanged { f ->
                    if (keepFocused && !f.isFocused) saveKeep()
                    keepFocused = f.isFocused
                },
            )
            Text("Ganze Zahl 1–99, Standard 3. Wird nicht synchronisiert – auf beiden Geräten gleich einstellen.",
                style = MaterialTheme.typography.bodySmall, color = Muted)
        }

        // ---- Über -------------------------------------------------------------
```

- [ ] **Step 3: `ui/SaleLists.kt` anlegen** — Mutationen: `InFlight.tryStart()`, frischer Stand über `freshSaleData` innerhalb der Mutation, `CollectionStore.awaitSync()` vor `finish()`

Vollständiger Inhalt von `android/app/src/main/java/com/example/yugiohscanner/ui/SaleLists.kt`:

```kotlin
package com.example.yugiohscanner.ui

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.Prefs
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.CopyLocation
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.ml.DuplicateEntry
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.SaleCopy
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Spec H1 §5.2: Start oeffnet einen Chip der Sammlung -- einmalige Anfrage, CollectionScreen nimmt sie heraus. */
object CollectionChip {
    const val ALLE = "alle"
    const val DUPLIKATE = "duplikate"
    const val VERKAUF = "verkauf"
    private val pending = MutableStateFlow<String?>(null)
    val request: StateFlow<String?> = pending

    fun open(chip: String) { pending.value = chip }
    fun take(): String? = pending.getAndUpdate { null }
}

/**
 * Spec H1 §4/§5: Verkaufs-Exemplare und Duplikate zu genau einem Speicherstand ([cards]/[copies] per Identitaet) und keep.
 * Gerechnet abseits des Hauptthreads (Artwork-Zuordnung ist ein SQLite-Lesen).
 */
class SaleData(val cards: List<CardRow>, val copies: List<CopyRow>, val keep: String, val sale: List<SaleCopy>, val duplicates: List<DuplicateEntry>) {
    val byId: Map<String, SaleCopy> = sale.associateBy { it.copy.copyId }
    val forSaleIds: Set<String> = sale.filter { it.copy.forSale }.map { it.copy.copyId }.toSet()
}

private fun keepOf(ctx: Context) = Prefs.keepPerCard(ctx).toString()

private suspend fun computeSaleData(cards: List<CardRow>, copies: List<CopyRow>, keep: String): SaleData = withContext(Dispatchers.Default) {
    val sale = Duplicates.saleCopies(copies, cards)
    val aliases = withContext(Dispatchers.IO) { runCatching { CatalogRepository.aliases(sale.map { it.copy.cardId }) }.getOrDefault(emptyMap()) }
    SaleData(cards, copies, keep, sale, Duplicates.duplicates(sale, keep) { aliases[it] })
}

/** Frischer Stand fuer Mutationen (innerhalb des InFlight-Gatters gelesen, nie der Kompositions-Schnappschuss). */
suspend fun freshSaleData(ctx: Context): SaleData? {
    val r = CollectionStore.state.value as? StoreState.Ready ?: return null
    return computeSaleData(r.cards, r.copies, keepOf(ctx))
}

/** Verkaufsdaten zum aktuellen Speicherstand; null, solange (neu) gerechnet wird -> "…", nie "0 Karten". */
@Composable
fun rememberSaleData(): SaleData? {
    val ctx = LocalContext.current
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val keep = keepOf(ctx)
    val data by produceState<SaleData?>(null, ready?.cards, ready?.copies, keep) {
        val r = ready ?: return@produceState
        value = computeSaleData(r.cards, r.copies, keep)
    }
    return data?.takeIf { ready != null && it.cards === ready.cards && it.copies === ready.copies && it.keep == keep }
}

/** Ein-Lauf-Mutation: InFlight-Gatter, danach Abgleich mit dem Speicher, erst dann frei (Spec H1 §7). */
@Composable
private fun rememberMutation(onError: (String?) -> Unit): Pair<Boolean, (suspend () -> Unit) -> Unit> {
    val scope = rememberCoroutineScope()
    val inFlight = remember { InFlight() }
    var busy by remember { mutableStateOf(false) }
    val mutate: (suspend () -> Unit) -> Unit = { block ->
        if (inFlight.tryStart()) {
            busy = true
            scope.launch {
                try { block(); CollectionStore.awaitSync(); onError(null) }
                catch (e: Exception) { onError(e.message ?: "Speichern fehlgeschlagen.") }
                finally { inFlight.finish(); busy = false }
            }
        }
    }
    return busy to mutate
}

/** Spec H1 §5.2: Duplikate am Handy -- Kopf mit "Alle Vorschläge", je Karte Zeile mit Schalter; Tipp oeffnet das Detail. */
@Composable
fun DuplicatesList(data: SaleData?, onOpenCard: (String) -> Unit, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    var error by remember { mutableStateOf<String?>(null) }
    val (busy, mutate) = rememberMutation { error = it }
    // §5.4: je Haupt-Passcode die Vorschlaege, die beim Einschalten in dieser Ansicht schon markiert waren.
    val history = remember { HashMap<String, List<String>>() }
    var confirmAll by remember { mutableStateOf(false) }

    if (data == null) {
        Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Text(Duplicates.LOADING, color = Muted) }
        return
    }
    val summary = remember(data) { Duplicates.summary(data.duplicates) }

    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(Duplicates.headerText(summary), color = OnSurface, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        }
        TextButton(onClick = { confirmAll = true }, enabled = !busy && data.duplicates.isNotEmpty(), contentPadding = PaddingValues(0.dp)) {
            Text("Alle Vorschläge auf die Verkaufsliste")
        }
        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
        if (data.duplicates.isEmpty()) {
            Text("Keine Duplikate.", color = Muted, modifier = Modifier.padding(top = 16.dp))
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 88.dp)) {
                items(data.duplicates, key = { it.mainId }) { e ->
                    val first = data.byId[e.copyIds.first()]
                    SpaceCard(Modifier.fillMaxWidth()) {
                        Row(Modifier.clickable { first?.let { onOpenCard(it.copy.cardId) } }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            AsyncImage(model = first?.card?.imageUrl, contentDescription = first?.card?.name,
                                modifier = Modifier.width(40.dp).height(58.dp).clip(RoundedCornerShape(6.dp)))
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(first?.card?.name ?: e.mainId, color = OnSurface, fontWeight = FontWeight.Bold, maxLines = 2)
                                Text(Duplicates.rowCountText(e), color = Muted, style = MaterialTheme.typography.bodySmall)
                                Duplicates.proposalTexts(e, data.byId).forEach {
                                    Text(it, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                                }
                            }
                            Switch(
                                checked = Duplicates.toggleIsOn(e, data.forSaleIds), enabled = !busy,
                                onCheckedChange = {
                                    mutate {
                                        val d = freshSaleData(ctx) ?: return@mutate
                                        val fresh = d.duplicates.firstOrNull { it.mainId == e.mainId } ?: return@mutate
                                        val on = !Duplicates.toggleIsOn(fresh, d.forSaleIds)
                                        if (on) history[fresh.mainId] = Duplicates.premarkedIds(fresh, d.forSaleIds)
                                        val t = Duplicates.toggleTargets(fresh, on, if (on) null else history[fresh.mainId])
                                        if (!on) history.remove(fresh.mainId)
                                        if (t.ids.isNotEmpty()) CollectionRepository.setForSale(t.ids, t.value)
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }

    if (confirmAll) {
        AlertDialog(
            onDismissRequest = { confirmAll = false },
            title = { Text("Auf die Verkaufsliste") },
            text = { Text(Duplicates.confirmAllText(summary)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmAll = false
                    mutate {
                        val d = freshSaleData(ctx) ?: return@mutate
                        val ids = Duplicates.allProposalIds(d.duplicates, d.forSaleIds)
                        if (ids.isNotEmpty()) CollectionRepository.setForSale(ids, true)
                    }
                }) { Text("Markieren") }
            },
            dismissButton = { TextButton(onClick = { confirmAll = false }) { Text("Abbrechen") } },
        )
    }
}

/** Spec H1 §5.2: Zum Verkauf am Handy -- Printings mit markierten Exemplaren, je Exemplar "Zurück in die Sammlung". Kein Export. */
@Composable
fun ForSaleList(data: SaleData?, onOpenCard: (String) -> Unit, modifier: Modifier = Modifier) {
    var error by remember { mutableStateOf<String?>(null) }
    val (busy, mutate) = rememberMutation { error = it }
    val store by CollectionStore.state.collectAsState()
    val containers = (store as? StoreState.Ready)?.containers ?: emptyList()

    if (data == null) {
        Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { Text(Duplicates.LOADING, color = Muted) }
        return
    }
    val summary = remember(data) { Duplicates.forSaleSummary(data.sale) }
    val groups = remember(data) { Duplicates.forSaleGroups(data.sale) }

    Column(modifier) {
        Text(Duplicates.forSaleHeaderText(summary), color = OnSurface, style = MaterialTheme.typography.bodyMedium)
        error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall) }
        if (groups.isEmpty()) {
            Text("Keine Exemplare zum Verkauf.", color = Muted, modifier = Modifier.padding(top = 16.dp))
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(top = 8.dp, bottom = 88.dp)) {
                items(groups, key = { "${it.cardId}|${it.setCode}|${it.language}|${it.rarity}" }) { g ->
                    SpaceCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(10.dp)) {
                            Column(Modifier.fillMaxWidth().clickable { onOpenCard(g.cardId) }) {
                                Text(g.name ?: g.cardId, color = OnSurface, fontWeight = FontWeight.Bold, maxLines = 2)
                                Text("${g.setCode} · ${g.rarity} · ${g.language}", color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                            }
                            g.copyIds.forEach { id ->
                                val s = data.byId[id] ?: return@forEach
                                Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text("${s.copy.condition} · ${Valuation.EDITION_LABELS[s.copy.edition] ?: s.copy.edition}", color = OnSurface,
                                            fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                                        Text(CopyLocation.format(s.copy, containers.find { it.containerId == s.copy.containerId }), color = Muted,
                                            fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1)
                                    }
                                    Text(Duplicates.copyValueText(s), color = Gold, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall)
                                    Spacer(Modifier.width(6.dp))
                                    TextButton(onClick = { mutate { CollectionRepository.setForSale(listOf(id), false) } }, enabled = !busy) {
                                        Text("Zurück in die Sammlung", style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 4: `ui/CollectionScreen.kt` ändern** — Chip-Zeile, Listen, Zusatz „(n zum Verkauf)" in der Listenansicht

In `android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt` (10 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/10 — ersetzen:
```kotlin
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
```
durch:
```kotlin
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
```

Änderung 2/10 — ersetzen:
```kotlin
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.Tags
```
durch:
```kotlin
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.Tags
```

Änderung 3/10 — ersetzen:
```kotlin
    val locationLabel: String? = null,
)
```
durch:
```kotlin
    val locationLabel: String? = null,
    // Spec H1 §5.3: Zusatz "(2 zum Verkauf)", sonst null.
    val saleNote: String? = null,
)
```

Änderung 4/10 — ersetzen:
```kotlin
    var detailId by remember { mutableStateOf<String?>(null) }

    var searchOpen by remember { mutableStateOf(false) }
```
durch:
```kotlin
    var detailId by remember { mutableStateOf<String?>(null) }
    // Spec H1 §5.2: Chip-Zeile Alle · Duplikate · Zum Verkauf; Start oeffnet einen Chip ueber CollectionChip.
    var chip by rememberSaveable { mutableStateOf(CollectionChip.ALLE) }
    val requestedChip by CollectionChip.request.collectAsState()
    LaunchedEffect(requestedChip) { CollectionChip.take()?.let { chip = it } }
    val sale = rememberSaleData()

    var searchOpen by remember { mutableStateOf(false) }
```

Änderung 5/10 — ersetzen:
```kotlin
    val byKey = remember(copies) { copies.groupBy { it.printingKey() } }

    val setOptions = remember(cards) { cards.map { it.setCode.substringBefore('-') }.distinct().sorted() }
```
durch:
```kotlin
    val byKey = remember(copies) { copies.groupBy { it.printingKey() } }
    val forSaleByCard = remember(copies) { copies.filter { !it.deleted && it.forSale }.groupingBy { it.cardId }.eachCount() }

    val setOptions = remember(cards) { cards.map { it.setCode.substringBefore('-') }.distinct().sorted() }
```

Änderung 6/10 — ersetzen:
```kotlin
        fContainers.size + fTags.size

    val groups = remember(cards, copies, query, sort, fSet, fRarity, fType, fLang, fCondition, fEdition, fContainers.toList(), fTags.toList(), containers) {
        fun copiesOfGroup(g: CardGroup): List<CopyRow> = g.variants.flatMap { byKey[it.printingKey()] ?: emptyList() }
```
durch:
```kotlin
        fContainers.size + fTags.size

    val groups = remember(cards, copies, query, sort, fSet, fRarity, fType, fLang, fCondition, fEdition, fContainers.toList(), fTags.toList(), containers, forSaleByCard) {
        fun copiesOfGroup(g: CardGroup): List<CopyRow> = g.variants.flatMap { byKey[it.printingKey()] ?: emptyList() }
```

Änderung 7/10 — ersetzen:
```kotlin
            }
            out.add(if (locationLabel != null) g0.copy(locationLabel = locationLabel) else g0)
        }
```
durch:
```kotlin
            }
            out.add(g0.copy(locationLabel = locationLabel, saleNote = Duplicates.forSaleSuffix(forSaleByCard[g0.id] ?: 0)))
        }
```

Änderung 8/10 — ersetzen:
```kotlin
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(sort == "total", { sort = "total" }, label = { Text("Wert") })
                FilterChip(sort == "single", { sort = "single" }, label = { Text("Preis") })
                FilterChip(sort == "name", { sort = "name" }, label = { Text("Name") })
            }
            if (activeFilterCount > 0) {
                Spacer(Modifier.height(8.dp))
```
durch:
```kotlin
            Spacer(Modifier.height(8.dp))
            // Spec H1 §5.2: Chip-Zeile ueber der Liste; Sortierung und aktive Filter gelten nur fuer "Alle".
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(chip == CollectionChip.ALLE, { chip = CollectionChip.ALLE }, label = { Text("Alle") })
                FilterChip(chip == CollectionChip.DUPLIKATE, { chip = CollectionChip.DUPLIKATE }, label = { Text("Duplikate") })
                FilterChip(chip == CollectionChip.VERKAUF, { chip = CollectionChip.VERKAUF }, label = { Text("Zum Verkauf") })
            }
            if (chip == CollectionChip.ALLE) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(sort == "total", { sort = "total" }, label = { Text("Wert") })
                    FilterChip(sort == "single", { sort = "single" }, label = { Text("Preis") })
                    FilterChip(sort == "name", { sort = "name" }, label = { Text("Name") })
                }
            }
            if (activeFilterCount > 0 && chip == CollectionChip.ALLE) {
                Spacer(Modifier.height(8.dp))
```

Änderung 9/10 — ersetzen:
```kotlin
            Spacer(Modifier.height(8.dp))
            if (grid) {
                LazyVerticalGrid(
```
durch:
```kotlin
            Spacer(Modifier.height(8.dp))
            if (chip == CollectionChip.DUPLIKATE) {
                DuplicatesList(sale, onOpenCard = { detailId = it }, modifier = Modifier.weight(1f))
            } else if (chip == CollectionChip.VERKAUF) {
                ForSaleList(sale, onOpenCard = { detailId = it }, modifier = Modifier.weight(1f))
            } else if (grid) {
                LazyVerticalGrid(
```

Änderung 10/10 — ersetzen:
```kotlin
                        color = MaterialTheme.colorScheme.onSurface, maxLines = 2)
                    Spacer(Modifier.height(4.dp))
```
durch:
```kotlin
                        color = MaterialTheme.colorScheme.onSurface, maxLines = 2)
                    group.saleNote?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Muted) }
                    Spacer(Modifier.height(4.dp))
```

- [ ] **Step 5: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug` → `BUILD SUCCESSFUL`, 537 Tests/0 Fehler.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/Prefs.kt android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SaleLists.kt android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt
git commit -m "feat(h1): Handy-Sammlung mit Chips Duplikate und Zum Verkauf, keep_per_card

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 10: Handy überall sonst — Exemplar-Sheet, Karten-Detail, Start, Navigation, Decks

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CopySheet.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt`

**Interfaces:**
- Consumes: Task 7 (`Duplicates`), Task 8 (`CollectionRepository.setForSale`), Task 9 (`rememberSaleData`, `CollectionChip`).
- Produces: `StartScreen(…, onOpenForSale: () -> Unit, onOpenDuplicates: () -> Unit)` (einziger Aufrufer `AppNav`, im selben Task), `DeckCardRow(card, numbers, ban, forSale: Boolean, …)` (drei Aufrufer in `DecksScreen`, im selben Task).

- [ ] **Step 1: `ui/CopySheet.kt` ändern** — Schalter „Zum Verkauf" (sofort, `savingRef`-Sperre)

In `android/app/src/main/java/com/example/yugiohscanner/ui/CopySheet.kt` (3 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/3 — ersetzen:
```kotlin
    var pendingRemove by remember { mutableStateOf(false) }
    // Plain (non-Compose-state) guard, geprueft SYNCHRON ganz am Anfang von save()/remove() -- ein
```
durch:
```kotlin
    var pendingRemove by remember { mutableStateOf(false) }
    // Spec H1 §5.3: Schalter "Zum Verkauf" schreibt sofort -- dieselbe Doppel-Tap-Sperre (savingRef) wie Speichern/Entfernen.
    var forSale by remember { mutableStateOf(copy.forSale) }
    var markingSale by remember { mutableStateOf(false) }
    // Plain (non-Compose-state) guard, geprueft SYNCHRON ganz am Anfang von save()/remove() -- ein
```

Änderung 2/3 — ersetzen:
```kotlin
                saving = false
                savingRef[0] = false
```
durch:
```kotlin
                saving = false
                savingRef[0] = false
            }
        }
    }

    fun toggleForSale(next: Boolean) {
        if (savingRef[0]) return
        savingRef[0] = true
        markingSale = true
        error = null
        scope.launch {
            try {
                CollectionRepository.setForSale(listOf(copy.copyId), next)
                forSale = next
                onSaved()
            } catch (e: Exception) {
                error = e.message ?: "Speichern fehlgeschlagen."
            } finally {
                markingSale = false
                savingRef[0] = false
```

Änderung 3/3 — ersetzen:
```kotlin
            }

            Column {
                Text("Notiz", style = MaterialTheme.typography.labelMedium, color = Muted)
```
durch:
```kotlin
            }

            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Zum Verkauf", style = MaterialTheme.typography.labelMedium, color = Muted, modifier = Modifier.weight(1f))
                Switch(checked = forSale, onCheckedChange = { toggleForSale(it) }, enabled = !saving && !removing && !markingSale)
            }

            Column {
                Text("Notiz", style = MaterialTheme.typography.labelMedium, color = Muted)
```

- [ ] **Step 2: `ui/CardDetailScreen.kt` ändern** — Preisschild

In `android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt` (3 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/3 — ersetzen:
```kotlin
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
```
durch:
```kotlin
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material3.*
```

Änderung 2/3 — ersetzen:
```kotlin
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.Good
```
durch:
```kotlin
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Good
```

Änderung 3/3 — ersetzen:
```kotlin
    ) {
        Text(
```
durch:
```kotlin
    ) {
        // Spec H1 §5.3: Preisschild an markierten Exemplaren.
        if (copy.forSale) {
            Icon(Icons.Default.Sell, "Zum Verkauf", tint = Gold, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(
```

- [ ] **Step 3: `ui/StartScreen.kt` ändern** — Zähler und „davon zum Verkauf"

In `android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt` (4 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/4 — ersetzen:
```kotlin
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.SealedSnapshot
```
durch:
```kotlin
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.Duplicates
import com.example.yugiohscanner.ml.SealedSnapshot
```

Änderung 2/4 — ersetzen:
```kotlin
    onOpenAlerts: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    // Spec §5: Karten und Exemplare aus dem Speicher; der Ladebildschirm garantiert Ready.
```
durch:
```kotlin
    onOpenAlerts: () -> Unit,
    onOpenForSale: () -> Unit,
    onOpenDuplicates: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    // Spec H1 §5.3: Zaehler und "davon zum Verkauf"; null = wird gerechnet ("…").
    val sale = rememberSaleData()
    val saleSummary = remember(sale) { sale?.let { Duplicates.forSaleSummary(it.sale) } }
    val duplicateSummary = remember(sale) { sale?.let { Duplicates.summary(it.duplicates) } }
    // Spec §5: Karten und Exemplare aus dem Speicher; der Ladebildschirm garantiert Ready.
```

Änderung 3/4 — ersetzen:
```kotlin
                        }
                        // Fix M2 (final-review-report.md): ohne bekannten Sealed-Wert waere die Basis-Momentaufnahme
```
durch:
```kotlin
                        }
                        // Spec H1 §5.3: markierte Exemplare zaehlen weiter zum Wert.
                        if (saleSummary != null && saleSummary.copies > 0) {
                            Text(Duplicates.saleShareText(saleSummary), style = MaterialTheme.typography.bodySmall, color = Muted)
                        }
                        // Fix M2 (final-review-report.md): ohne bekannten Sealed-Wert waere die Basis-Momentaufnahme
```

Änderung 4/4 — ersetzen:
```kotlin
                            "Nicht einsortiert",
                            style = MaterialTheme.typography.labelSmall, color = Muted,
                        )
                    }
                }
            }
```
durch:
```kotlin
                            "Nicht einsortiert",
                            style = MaterialTheme.typography.labelSmall, color = Muted,
                        )
                    }
                }
            }

            // Spec H1 §5.3: "Zum Verkauf" und "Duplikate", Tipp oeffnet den Chip der Sammlung.
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth().clickable { onOpenForSale() }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Sell, null, tint = Gold)
                        Spacer(Modifier.width(12.dp))
                        Text(saleSummary?.let { Duplicates.startSaleText(it) } ?: "Zum Verkauf: ${Duplicates.LOADING}",
                            style = MaterialTheme.typography.bodyMedium, color = OnSurface)
                    }
                    Row(Modifier.fillMaxWidth().clickable { onOpenDuplicates() }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Style, null, tint = Primary)
                        Spacer(Modifier.width(12.dp))
                        Text(duplicateSummary?.let { Duplicates.startDuplicatesText(it) } ?: "Duplikate: ${Duplicates.LOADING}",
                            style = MaterialTheme.typography.bodyMedium, color = OnSurface)
                    }
                }
            }
```

- [ ] **Step 4: `ui/AppNav.kt` ändern** — Tipp öffnet den Chip (ohne `restoreState`)

In `android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt` (2 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/2 — ersetzen:
```kotlin
                    onOpenAlerts = { nav.navigate(Routes.insights("alarme")) { launchSingleTop = true } },
                ) else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
```
durch:
```kotlin
                    onOpenAlerts = { nav.navigate(Routes.insights("alarme")) { launchSingleTop = true } },
                    // Spec H1 §5.3: wie das Deck-Postfach (F2) ohne restoreState -- sonst stellt navigateTop einen
                    // gespeicherten Sammlungs-Reiter (z. B. Binder) wieder her und der Chip erscheint nie.
                    onOpenForSale = { CollectionChip.open(CollectionChip.VERKAUF); nav.openSammlungKarten() },
                    onOpenDuplicates = { CollectionChip.open(CollectionChip.DUPLIKATE); nav.openSammlungKarten() },
                ) else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
```

Änderung 2/2 — ersetzen:
```kotlin
}

// Switching tabs must not stack them: pop to the graph's start, keep each tab's own state.
```
durch:
```kotlin
}

// Spec H1 §5.3: Sammlung › Karten sicher oeffnen (ohne gespeicherten Reiter wiederherzustellen).
private fun NavHostController.openSammlungKarten() = navigate(Routes.sammlung()) {
    popUpTo(graph.findStartDestination().id) { saveState = false }
    launchSingleTop = true
}

// Switching tabs must not stack them: pop to the graph's start, keep each tab's own state.
```

- [ ] **Step 5: `ui/DecksScreen.kt` ändern** — Preisschild an Deckzeilen

In `android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt` (7 Änderungen, in dieser Reihenfolge anwenden; jeder alte Block steht an dieser Stelle genau einmal in der Datei):

Änderung 1/7 — ersetzen:
```kotlin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
```
durch:
```kotlin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Share
```

Änderung 2/7 — ersetzen:
```kotlin
    val numbers = remember(coverage) { coverage?.cards?.associateBy { it.cardId } }
    var boxError by remember { mutableStateOf<String?>(null) }
```
durch:
```kotlin
    val numbers = remember(coverage) { coverage?.cards?.associateBy { it.cardId } }
    // Spec H1 §5.3: Passcodes mit mindestens einem markierten Exemplar (Preisschild; gleicher Schluessel wie der Abgleich).
    val forSaleCards = remember(ready?.copies) { ready?.copies?.filter { !it.deleted && it.forSale }?.map { it.cardId }?.toSet() ?: emptySet() }
    var boxError by remember { mutableStateOf<String?>(null) }
```

Änderung 3/7 — ersetzen:
```kotlin
                    }
                    items(main, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), move, plusOne, mutating) { block -> mutate(block) } }
                    item {
```
durch:
```kotlin
                    }
                    items(main, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), it.cardId in forSaleCards, move, plusOne, mutating) { block -> mutate(block) } }
                    item {
```

Änderung 4/7 — ersetzen:
```kotlin
                    }
                    items(extra, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), move, plusOne, mutating) { block -> mutate(block) } }
                    item {
```
durch:
```kotlin
                    }
                    items(extra, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), it.cardId in forSaleCards, move, plusOne, mutating) { block -> mutate(block) } }
                    item {
```

Änderung 5/7 — ersetzen:
```kotlin
                    }
                    items(side, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), move, plusOne, mutating) { block -> mutate(block) } }
                }
```
durch:
```kotlin
                    }
                    items(side, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId), banOf(it), it.cardId in forSaleCards, move, plusOne, mutating) { block -> mutate(block) } }
                }
```

Änderung 6/7 — ersetzen:
```kotlin
private fun DeckCardRow(
    card: DeckCard, numbers: CoverageCard?, ban: String?, onMove: (DeckCard) -> Unit, onPlus: (DeckCard) -> Unit, busy: Boolean,
    mutate: ((suspend () -> Unit)) -> Unit,
```
durch:
```kotlin
private fun DeckCardRow(
    card: DeckCard, numbers: CoverageCard?, ban: String?, forSale: Boolean, onMove: (DeckCard) -> Unit, onPlus: (DeckCard) -> Unit, busy: Boolean,
    mutate: ((suspend () -> Unit)) -> Unit,
```

Änderung 7/7 — ersetzen:
```kotlin
                    BanIcon(ban)
                }
```
durch:
```kotlin
                    BanIcon(ban)
                    // Spec H1 §5.3: markierte Exemplare bleiben verfuegbar, mit Preisschild.
                    if (forSale) Icon(Icons.Default.Sell, "Zum Verkauf markiert", tint = Gold, modifier = Modifier.size(16.dp))
                }
```

- [ ] **Step 6: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug` → `BUILD SUCCESSFUL`, 537 Tests/0 Fehler.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/CopySheet.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt
git commit -m "feat(h1): Zum-Verkauf-Schalter, Preisschild, Start-Zaehler und Deck-Preisschild am Handy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Controller-Abschluss (kein Subagent)

- [ ] **Gesamtlauf:** Desktop SQLite-Suite (erwartet 318), `electron/test-sync.cjs` (16× PASS), Desktop-Helfer (276), Lint genau 5 Fehler, `npx vite build`, Android `testDebugUnitTest assembleDebug` (537/0, Zahl aus den XML-Berichten). Zahlen ins Ledger.
- [ ] **Abschlussreview** mit dem besten Modell über den gesamten Zweig (Basis = Plan-Commit), danach eine Fix-Welle und ein scoped Re-Review. Besonders prüfen:
  - Zwillinge regelgleich: Kriterien 1–6 in dieser Reihenfolge, Tiebreak `copy_id`, leere Werte = ohne Standort/Tags/Notiz, unbekannter Zustand = NM, `keepPerCard` (`[0-9]{1,2}`, 1–99, sonst 3), Rundung, Zahlformate, `mainIdOf` leer = gespeicherter Passcode; beide Seiten lesen `duplicates.json`.
  - Minus-Regel: PC beide Zweige, Handy `removalOrder`; bestehende Minus-Tests unverändert grün.
  - `set-for-sale`/`setForSale` idempotent (kein Neustempeln, kein Push-Echo), nie `cards.quantity`/`deleted`/`price_first_ed` geschrieben, nur lebende Exemplare.
  - Kein Platzhalter täuscht: „…" solange `useSaleData`/`rememberSaleData` rechnen; Start-Fehler „—".
  - Doppeltipp: PC `busyGate` + `disabled`, Handy `InFlight` mit frischem Stand und `awaitSync` vor der Freigabe.
  - Aufrufer geteilter Funktionen (Befund 5) unverändert; Kanäle in `main.cjs` und `preload.cjs`.
- [ ] **Übergabe an den Nutzer, in dieser Reihenfolge:**
  1. Prüfabfrage (Abschnitt SQL) im Supabase-SQL-Editor ausführen; bei keiner Zeile die `alter table`-Zeile von Hand einspielen. Agents führen kein SQL aus.
  2. Desktop-Installer nach dem Merge im Hauptcheckout bauen und installieren (nie aus dem Worktree mit Junction-`node_modules`).
  3. APK installieren (erst nach Schritt 1). Keine Edge Function, kein Deploy.
- [ ] **Abnahme** (Checkliste im Ledger, Nachtrag §10):
  1. PC: Einstellungen › Standards `keep_per_card` = 3; Chip „Duplikate": Zahlen und Vorschläge plausibel, Exemplare mit Binder-Standort geschont.
  2. Bei einer Karte „Auf die Verkaufsliste", dann „Zum Verkauf": Exemplare, Summe, Preisschild im Karten-Detail.
  3. „Exportieren" aus „Zum Verkauf" (Format „Verkaufsliste (Text)", Umfang „Zum Verkauf") enthält genau diese Exemplare (Unknown-Exemplare werden mit Hinweis weggelassen).
  4. Handy nach Sync: Chips „Duplikate" und „Zum Verkauf"; ein Exemplar „Zurück in die Sammlung" → am PC nach Sync nicht mehr in der Liste.
  5. Minus im Karten-Detail bei einer Gruppe mit markiertem Exemplar entfernt das markierte (beide Geräte).
  6. Start-Zähler (Tipp öffnet die Liste), „davon zum Verkauf", Preisschild im Deckbuilder (beide Geräte).
- [ ] **Folgeaufgaben nennen:** H2 (Verkauft buchen, Historie, Preisvorschläge), H3 (Marktplätze); Offener Punkt 5 (Text bei `keep` ≠ 3), falls gewünscht.
- [ ] **Merge-Frage** an den Nutzer.

---

## Selbstprüfung

**Spec-Abdeckung:**

| Nachtrag | Umsetzung |
|---|---|
| §1 Aufteilung H1/H2/H3 | nur H1; „Verkauft" fehlt bewusst (Global Constraints) |
| §2 Abgleich Spec ↔ Code | Befunde 1, 2, 6, 7, 9, 10 |
| §3 Umfang | Tasks 1–10; Nicht-Ziele in Global Constraints |
| §4 Duplikat-Regel (Haupt-Passcode über Katalog, Unknown zählt mit, ohne Katalog gespeicherter Passcode, Überschuss, Vorschlag Kriterien 1–6, Kriterium 2 ordnet nur, `keep_per_card` 1–99/Standard 3/kein Sync/Hinweis/ungültig → 3, reine Funktion als Zwilling mit Fixtures, Ergebnisform) | Task 1 (`duplicates.js` + Fixture), Task 7 (`Duplicates.kt`), Task 3 (`listSaleCopies` mit `main_id`), Task 9 (`rememberSaleData` mit `CatalogRepository.aliases`), Task 6/9 (Einstellung); Offene Punkte 1–3 |
| §5.1 PC Duplikate (Kopf, Knopf mit Bestätigung, Zeile mit Bild/Name/Zahlen/Vorschlag in Worten/Schalter, Klick → Detail) und Zum Verkauf (Kopf, Exportieren → F1 Verkaufsliste mit genau diesen Exemplaren, nur Printings mit Markierung, Exemplar-Zeilen mit Zustand/Edition/Standort/Wert, Zurück in die Sammlung) | Task 5 (`DuplicatesList.jsx`, `ForSaleList.jsx`, `ExportDialog`, `CollectionList`) |
| §5.2 Handy Chip-Zeile und Inhalte, kein Export | Task 9 (`SaleLists.kt`, `CollectionScreen.kt`) |
| §5.3 Exemplar-Sheet, Preisschild, Zusatz, Start-Zähler mit Tipp, Wert-Zusatz, Deckbuilder, Minus-Regel | Task 6 und 10 (Sheet, Detail, Start, Deckbuilder), Task 5/9 (Zusatz), Task 3/8 (Minus); Befunde 4, 7, 8, 11; Offener Punkt 9 |
| §5.4 Zeilen-Schalter An/Aus mit Vorgeschichte, angezeigter Zustand | Task 1/7 (`toggleIsOn`, `premarkedIds`, `toggleTargets`, Fixture `toggle`), Task 5/9 (Vorgeschichte je Ansicht); Offener Punkt 4 |
| §6 Sync (PC Copies-Strom + `updated_at`, Handy `CopyRow.forSale`, `COPY_COLS`, `setForSale` durch `InFlight`, letzter Schreiber) | Befund 1 (PC unverändert), Task 3 (`updated_at`), Task 7/8 (Handy), Task 9/10 (`InFlight`) |
| §7 Fehlerfälle (verschiedene `keep`, gelöscht, ohne Preis, Katalog fehlt, Doppeltipp, Platzhalter) | Hinweis in beiden Einstellungen (Task 6/9); nur lebende Exemplare (Task 3/7/8); `copyValueText` „—" (Task 1/7); Fixture „Katalog fehlt" (Task 1/7); `busyGate`/`InFlight`/`busyRef`/`savingRef` (Task 2, 5, 6, 9, 10; Befund 12); `LOADING` (Task 1, 5, 6, 9, 10) |
| §8 Tests (Zwilling mit Playset-Grenze, 6 Kriterien einzeln, Artwork, Katalog fehlt, `keep`; SQLite idempotent + `updated_at`, Minus-Regel, `quantity` nie direkt; Sync PC; Handy gelesen/gepatcht; Schutz-Nachweise Minus, Busy/InFlight, Artwork) | Task 1/7 (Fixture-Fälle), Task 3 (`copies-for-sale.test.cjs`), Befund 1 (`test-sync.cjs`), Task 8 (`SaleCopiesRepoTest`: gelesen, PATCH-Parameter), Schutz-Nachweise Task 1, 2, 3, 7, 8 |
| §9 SQL: keine Änderung, Prüfabfrage | Abschnitt „SQL", Task 11 Übergabe |
| §10 Abnahme 1–6 | Task 11 |

**Platzhalter-Suche:** Kein „TBD", kein „wie in Task N". Jeder Code-Schritt enthält den vollständigen Code bzw. exakte, im Zielstand eindeutige Ersetzungsblöcke; beides stammt unverändert aus der vorab geprüften Scratch-Kopie.

**Namens- und Typkonsistenz:**
- JS ↔ Kotlin: `keepPerCard` ↔ `keepPerCard(String?)`, `duplicates(copies, keep, mainIdOf)` ↔ `duplicates(List<SaleCopy>, String?, ((String) -> String?)?)`, `duplicatesSummary` ↔ `summary`, übrige Helfer gleichnamig; Eintrag `{ main_id, count, surplus, copy_ids, value }` ↔ `DuplicateEntry(mainId, count, surplus, copyIds, value)`; Gruppe `{ card_id, set_code, language, rarity, name, copy_ids }` ↔ `ForSaleGroup(cardId, setCode, language, rarity, name, copyIds)`; Schalter `{ ids, value }` ↔ `ToggleTargets(ids, value)`.
- IPC: `list-sale-copies`/`listSaleCopies()`, `set-for-sale`/`setForSale({ copyIds, value })`; Einstellung `keep_per_card` (PC `settings`, Handy `SharedPreferences` `scanner_prefs`).
- Chips: PC `segment` `'duplicates'`/`'forsale'` (auch `location.state.segment` aus Start), Handy `CollectionChip.DUPLIKATE`/`VERKAUF`.
- Texte (Werte aus `duplicates.json`): „14 Karten · 31 Exemplare über Playset · ca. 62 €", „31 Exemplare von 14 Karten markieren?", „5 Exemplare · 2 über Playset", „2× LOB-DE001 Common · NM · Unlimited", „23 Exemplare · 84,30 €", „Zum Verkauf: 23 Exemplare · 84 €", „Duplikate: 14 Karten", „davon zum Verkauf: 84 €", „(2 zum Verkauf)", „—", „…"; Knöpfe „Alle Vorschläge auf die Verkaufsliste", „Auf die Verkaufsliste", „Exportieren", „Zurück in die Sammlung", Schalter „Zum Verkauf".
