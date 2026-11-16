# Scraper ohne Prüfbox – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Cardmarket-Scraper zeigt nie mehr eine Cloudflare-Prüfung an: Drucke unter 5 € bekommen einen Schätzpreis aus `price_guide_3.json`, nur Drucke ab 5 € werden noch (still, headless) geladen, und eine gescheiterte Prüfung bedeutet Ruhe statt Dialog.

**Architecture:** Neuer Bulk-Schritt `applyEstimates` in `cardmarket-bulk.cjs` (nach `applyPrices`). Beide Scraper-Durchgänge (`runCardmarketScrape`, `runFirstEdPass`) filtern per Euro-Schwelle, laufen immer headless, stempeln gescheiterte Prüfungen je Druck und brechen den Lauf ab. `main.cjs` setzt danach eine 6-h-Pause. Ein neues Modul `cardmarket-runlog.cjs` hängt Lauf-Zusammenfassungen an ein rotierendes Log.

**Tech Stack:** Electron (CJS main), better-sqlite3, React + Tailwind (Renderer), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-16-scraper-ohne-pruefbox-design.md` (freigegeben 16.11.2026).

## Global Constraints

- Prüfung **nie** automatisch klicken, umgehen oder den Browser-Fingerprint verändern; kein Fenster wird je sichtbar (`show: false` bleibt, kein `win.show()` irgendwo).
- Schwelle: Setting `cm_scrape_min_eur`, Standard `5`; Regel `COALESCE(cm_estimate_max, price) >= cm_scrape_min_eur` (Basis **und** 1st-Ed).
- Ruhe: je Druck **3 Tage** nach gescheiterter Prüfung (`cm_challenge_at` bzw. `cm_first_ed_challenge_at`); ganzer Abruf **6 Stunden** (Setting `cm_pause_until`, ISO-UTC).
- „Prüfung“ für Ruhe = **gescheiterter** Aufruf (Headless-Warten ~10 s ohne Auflösung). Gesehene Prüfungen nur zählen.
- Schätzung stempelt **nie** `cm_updated_at`; nie für `price_locked = 2`, KR, Drucke mit `cm_product_id`, Drucke mit Scrape-Preis (`cm_url IS NOT NULL AND COALESCE(cm_estimate,0) = 0`).
- Schätzpreis = niedrigster Trend (> 0) der Kandidaten × `cm_lang_factor` (wie `applyPrices`); `cm_estimate_max` = höchster.
- Main-Prozess bleibt CommonJS (`.cjs`), Renderer ESM; UI-Text Deutsch; nur Design-Tokens (keine Hex-Farben, `noLegacyColors.test.js`).
- Neue Spalten nur als additive Migration in `database.cjs` (`priceLockCols`); nicht in `sync.cjs` spiegeln.
- `npm run lint`: höchstens die 5 bekannten Altfehler.
- Tests: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` und `node --test src/utils/*.test.js src/utils/*.test.mjs` (in `desktop/`).

## Review Focus

1. Ein Druck mit altem Scrape-Preis ohne ID (z. B. 02.10.) behält seinen Preis nach dem Bulk-Lauf – Test in Task 2.
2. Ein geschätzter Druck, der später per `deriveMissing`/`resolveMissing`/Scrape eine ID bekommt, verliert `cm_estimate` – Tests in Task 2 und Task 3.
3. Alle Kandidaten ohne Trend (> 0) → kein Schätzpreis, Preis unverändert – Test in Task 2.
4. Knopf während aktiver Pause → kein Fenster, Meldung mit Uhrzeit – Test (reine Helfer) in Task 5.
5. Ein Druck mit `cm_challenge_at` vor > 3 Tagen ist wieder Kandidat, vor < 3 Tagen nicht – Test in Task 3 (und 1st-Ed in Task 4).

---

### Task 1: Branch, Spec einchecken, Ausgangsmessung

**Files:**
- Create: `docs/superpowers/ledgers/2026-11-16-scraper-ohne-pruefbox/messung.md`
- Messskript nur im Scratchpad (nicht einchecken)

- [ ] **Step 1:** In `C:/Users/Buzzty/Downloads/yugi` Branch anlegen: `git switch -c feat/scraper-ohne-pruefbox` (kein eigener Worktree – Junction-Falle, siehe Memory).
- [ ] **Step 2:** Messskript schreiben, das die echte DB (`%APPDATA%/yugioh-card-manager/cards.db`, Pfad ggf. aus `config.json` → `dbPath`) **readonly** öffnet und die lokalen Dateien unter `%APPDATA%/yugioh-card-manager/cardmarket/` sowie YGOPRODeck `cardsets` aus `api_cache` liest. Für jeden Nicht-KR-Druck mit `cm_product_id IS NULL`: `resolveProduct` (mit Kandidaten wie in Task 2 geplant) → min/max Trend. Zählen:
  - a) Drucke mit Schätzpreis möglich / ohne (je `reason`)
  - b) Basis-Kandidaten nach neuer Regel (`COALESCE(max, price) >= 5`, ohne Scrape-Preis-Ausnahme)
  - c) 1st-Ed-Kandidaten nach neuer Regel
  - d) Drucke mit Scrape-Preis ohne ID (geschützt)
- [ ] **Step 3:** Ausführen: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron <scratch>/messung.cjs`. Ergebnis in `messung.md` eintragen.
- [ ] **Step 4:** **Haltepunkt:** Ist b) > 50, nicht weiterbauen, sondern dem Nutzer melden (Spec: Spanne nach Seltenheit eingrenzen).
- [ ] **Step 5:** Commit: `git add docs/superpowers/specs/2026-11-16-scraper-ohne-pruefbox-design.md docs/superpowers/plans/2026-11-16-scraper-ohne-pruefbox.md docs/superpowers/ledgers/2026-11-16-scraper-ohne-pruefbox/messung.md && git commit -m "docs(scraper): Spec, Plan und Ausgangsmessung Scraper ohne Pruefbox"`

### Task 2: Schätzpreis-Schritt im Bulk

**Files:**
- Modify: `desktop/electron/database.cjs:278` (`priceLockCols`)
- Modify: `desktop/electron/cardmarket-bulk-parse.cjs:105-112` (`resolveProduct`)
- Modify: `desktop/electron/cardmarket-bulk.cjs` (`resolveMissing:126`, `deriveMissing:158`, neues `applyEstimates`, `runBulkRefresh:216`)
- Test: `desktop/electron/cardmarket-bulk.test.cjs`, `desktop/electron/cardmarket-bulk-parse.test.cjs`

**Interfaces:**
- Produces: Spalten `cm_estimate INTEGER DEFAULT 0`, `cm_estimate_max REAL`, `cm_estimate_at DATETIME`, `cm_challenge_at DATETIME`, `cm_first_ed_challenge_at DATETIME` (alle fünf hier migrieren).
- Produces: `resolveProduct(...)` liefert bei `reason: 'ambiguous'` zusätzlich `candidates: number[]` (idProducts); andere Rückgaben unverändert.
- Produces: `applyEstimates(db, ix, guide) -> { estimated: number, noTrend: number }` (exportiert); `runBulkRefresh` gibt zusätzlich `estimated` zurück.

- [ ] **Step 1: Failing tests** in `cardmarket-bulk-parse.test.cjs`: `resolveProduct: ambiguous liefert candidates` – für „Dark Magician“ in LOB (4 Produkte der Fixture) `assert.deepEqual(res.candidates.sort(), [<die 4 ids>])`; `resolved` hat kein `candidates`.
- [ ] **Step 2: Failing tests** in `cardmarket-bulk.test.cjs` (makeDb um die fünf Spalten erweitern; Guide-Trends für die 4 LOB-Produkte z. B. 2.0, 3.5, 40.0, 0):
  - `Schätzung: mehrdeutiger Druck bekommt min-Trend, max, Markierung` → LOB-DE005: `price = 2.0`, `cm_estimate = 1`, `cm_estimate_max = 40.0`, `price_locked = 1`, `cm_estimate_at` gesetzt, `cm_updated_at` **NULL**.
  - `Schätzung: Sprachfaktor wird angewendet` → mit `cm_lang_factor = 0.5`: `price = 1.0`, `cm_estimate_max = 20.0`.
  - `Schätzung: Scrape-Preis ohne ID bleibt` → `cm_url = 'https://…'`, `price = 9.0`, `cm_estimate = 0` vorher: danach `price = 9.0`, `cm_estimate = 0`.
  - `Schätzung: price_locked 2 und KR bleiben unberührt`.
  - `Schätzung: alle Trends 0/fehlend → nichts geschrieben` (Preis unverändert, `cm_estimate = 0`, `noTrend` zählt).
  - `Schätzung: zweiter Lauf ohne Änderung schreibt nicht` (`updated_at`/`price_history`-Zeilenzahl unverändert).
  - `Schätzung wird zurückgesetzt, wenn resolveMissing/deriveMissing eine ID vergibt` → vorher `cm_estimate = 1, cm_estimate_max = 40`; nach Lauf mit Dateien, die eindeutig auflösen: `cm_estimate = 0`, `cm_estimate_max = NULL`.
- [ ] **Step 3:** Run `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-bulk.test.cjs electron/cardmarket-bulk-parse.test.cjs` → FAIL.
- [ ] **Step 4: Implement.** Migration der fünf Spalten in `priceLockCols`. `resolveProduct` ergänzt `candidates: cands.map(c => c.idProduct)`. In den UPDATEs von `resolveMissing` und `deriveMissing` zusätzlich `cm_estimate = 0, cm_estimate_max = NULL`. `applyEstimates`: Zeilen aus `UNRESOLVED_SQL` + `cm_url, cm_estimate, price_locked, cm_lang_factor`, filtern laut Global Constraints, Trends aus dem Guide (Map wie `applyPrices`), schreiben nur wenn `price`, `cm_estimate_max` oder `cm_estimate` sich ändern; `recordPrice(db, r, t, 'cm_estimate')` nur bei Preisänderung. Aufruf in `runBulkRefresh` nach `applyPrices`, Ergebnis `estimated` in `out`.
- [ ] **Step 5:** Tests erneut → PASS; zusätzlich `electron/cm-resolve-fixture.test.cjs` und `electron/catalog-build*.test.cjs` grün (nutzen `resolveProduct`).
- [ ] **Step 6:** Commit `feat(cm-bulk): Schaetzpreis aus der Cardmarket-Spanne fuer mehrdeutige Drucke`.

### Task 3: Basis-Scraper – Euro-Schwelle, still, Ruhe je Druck, Abbruch

**Files:**
- Modify: `desktop/electron/cardmarket-scraper.cjs:101-113` (`loadPage`), `:139-222` (`runCardmarketScrape`)
- Test: Create `desktop/electron/cardmarket-scraper-base.test.cjs`; Modify `desktop/electron/cardmarket-tempo.test.cjs` nur falls Signatur bricht

**Interfaces:**
- Consumes: Spalten aus Task 2.
- Produces: `loadPage(win, url, zaehler = null) -> Promise<boolean>`; immer 5 Versuche à 2 s, `zaehler.gesehen++` beim ersten Treffer, bei `false` zusätzlich `zaehler.gescheitert++`. Parameter `onChallenge`/`headless` entfallen.
- Produces: `runCardmarketScrape(db, { onProgress, shouldAbort, minEur = 5, maxCards = Infinity, deriver = null, nowMs = Date.now(), deps = {} })` → `{ updated, noMatch, errors, noMatchList, idMissed, derived, seiten, pruefungenGesehen, pruefungenGescheitert, abgebrochen: boolean }`. `deps` wie in `runFirstEdPass`: `makeWindow`, `loadPage`, `readRows`, `sleep`, `cardName`, `setNameFor`.
- Produces: Konstante `REST_MS = 3 * 24 * 3600 * 1000` (exportiert).

- [ ] **Step 1: Failing tests** (Stub-Muster aus `cardmarket-first-ed.test.cjs` übernehmen; DB mit `cm_url, cm_updated_at, cm_product_derived, cm_lang_factor, cm_estimate, cm_estimate_max, cm_challenge_at`):
  - `Basis: nur Drucke ab 5 € (max der Spanne zählt)` → Druck A `price 1, cm_estimate_max 8` lädt; Druck B `price 4, cm_estimate_max NULL` lädt nicht; Druck C `price 6` lädt. `visited` = Seiten von A und C.
  - `Basis: ohne Preis kein Kandidat`.
  - `Basis: gescheiterte Prüfung stempelt cm_challenge_at, bricht ab` → zwei Kandidaten, erster `challenge`: `visited` nur erster, `abgebrochen === true`, `pruefungenGescheitert === 1`, `cm_challenge_at` gesetzt, `cm_updated_at` unverändert.
  - `Basis: Ruhe 3 Tage` → `cm_challenge_at` = nowMs − 2 Tage: kein Kandidat; − 4 Tage: Kandidat.
  - `Basis: Erfolg setzt cm_estimate zurück und löscht cm_challenge_at` → nach Treffer `cm_estimate = 0`, `cm_estimate_max = NULL`, `cm_challenge_at = NULL`, `price_locked = 1`.
  - `loadPage: sich selbst lösende Prüfung zählt gesehen, nicht gescheitert` (Stub-Fenster, Titel 2× „Just a moment“, dann normal).
- [ ] **Step 2:** Run `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-scraper-base.test.cjs` → FAIL.
- [ ] **Step 3: Implement.** Kandidaten-SQL: `cm_product_id IS NULL`, Nicht-KR, `price_locked != 2`, `COALESCE(cm_estimate_max, price) >= ?` (minEur), `cm_challenge_at` NULL oder älter als `REST_MS`; 7-Tage-Frist bleibt; Raritäts-Filter und `force` entfallen. Bei `loadPage === false`: `cm_challenge_at = CURRENT_TIMESTAMP` für die `stale`-Drucke der Karte, `abgebrochen = true`, `break`. Erfolgs-UPDATE (Z. 199) ergänzt `cm_estimate = 0, cm_estimate_max = NULL, cm_challenge_at = NULL`. Pause weiter über `pauseNachPruefungen(zaehler.gesehen)`. `openDiagLog` kommt in Task 5 aus dem Runlog-Modul – hier unverändert lassen.
- [ ] **Step 4:** Tests → PASS; `electron/cardmarket-tempo.test.cjs` grün.
- [ ] **Step 5:** Commit `feat(cm-scraper): Basis-Durchgang nur ab 5 Euro, immer still, Ruhe nach Pruefung`.

### Task 4: 1st-Ed-Durchgang – gleiche Regeln

**Files:**
- Modify: `desktop/electron/cardmarket-scraper.cjs:230-315` (`firstEdCandidates`, `runFirstEdPass`)
- Test: `desktop/electron/cardmarket-first-ed.test.cjs`

**Interfaces:**
- Consumes: `loadPage(win, url, zaehler)` und `REST_MS` aus Task 3.
- Produces: `firstEdCandidates(db, { minEur = 5, force, nowMs, limit })`; `runFirstEdPass(db, { minEur = 5, force, maxCards, shouldAbort, onProgress, deps })` → bisheriges Objekt plus `seiten`, `pruefungenGesehen`, `pruefungenGescheitert`, `abgebrochen`. `minRank`, `headless`, `onChallenge` entfallen.

- [ ] **Step 1: Tests anpassen/ergänzen.** Bestehende Kandidaten-Tests von `minRank` auf `minEur` umstellen (Fixture-Preise so wählen, dass dieselben Erwartungen gelten; `printing()` hat `price` schon). Neu:
  - `Kandidaten: Euro-Schwelle mit cm_estimate_max` → `price 2, cm_estimate_max 9` ist Kandidat, `price 4` nicht.
  - `Kandidaten: Ruhe 3 Tage nach cm_first_ed_challenge_at`.
  - Die zwei bestehenden Cloudflare-Tests (Seite N/Y) erwarten jetzt zusätzlich `out.abgebrochen === true` und gesetztes `cm_first_ed_challenge_at`; Faktor/Zeitstempel weiter unverändert.
  - `Durchgang: nach gescheiterter Prüfung kein zweiter Kandidat geladen`.
- [ ] **Step 2:** Run `… --test electron/cardmarket-first-ed.test.cjs` → FAIL.
- [ ] **Step 3: Implement** analog Task 3; `zaehler` an alle drei `loadPage`-Aufrufe; `d.sleep` bekommt die Pause aus `pauseNachPruefungen(zaehler.gesehen)`.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `feat(cm-scraper): 1st-Ed-Durchgang mit Euro-Schwelle und Ruhe nach Pruefung`.

### Task 5: Lauf-Protokoll und Pause-Helfer

**Files:**
- Create: `desktop/electron/cardmarket-runlog.cjs`
- Create: `desktop/electron/cardmarket-runlog.test.cjs`
- Modify: `desktop/electron/cardmarket-scraper.cjs:132-136` (`openDiagLog` nutzt das Modul)

**Interfaces:**
- Produces: `appendLog(file, entry, { maxBytes = 1_000_000 } = {})` – hängt `JSON.stringify({ at, ...entry }) + '\n'` an; ist die Datei vor dem Schreiben > `maxBytes`, wird sie nach `file + '.1'` umbenannt (altes `.1` überschrieben). Fehler werden geschluckt.
- Produces: `pauseUntilIso(nowMs, hours = 6) -> string` (ISO-UTC), `pauseActive(untilIso, nowMs) -> boolean` (false bei leer/ungültig), `PAUSE_HOURS = 6`.

- [ ] **Step 1: Failing tests:** `appendLog hängt an statt zu leeren` (zwei Aufrufe → 2 Zeilen); `appendLog rotiert über maxBytes` (maxBytes 10 → `.1` existiert, neue Datei hat 1 Zeile); `pauseActive` für `null`, `'kaputt'`, Zukunft, Vergangenheit; `pauseUntilIso(Date.parse('2026-11-16T12:00:00Z'))` → `'2026-11-16T18:00:00.000Z'`. Temp-Dateien via `fs.mkdtempSync(os.tmpdir())`.
- [ ] **Step 2:** Run `… --test electron/cardmarket-runlog.test.cjs` → FAIL.
- [ ] **Step 3: Implement**; `openDiagLog` leert die Datei nicht mehr und schreibt über `appendLog`.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `feat(cm-scraper): Lauf-Protokoll anhaengen und rotieren, Pause-Helfer`.

### Task 6: Verdrahtung in main/preload

**Files:**
- Modify: `desktop/electron/main.cjs:1258-1340` (IPC `scrape-cardmarket-prices`, `reveal-cm-window`, `startCardmarketPoller`)
- Modify: `desktop/electron/preload.cjs:51-54`

**Interfaces:**
- Consumes: Task 3–5.
- Produces: IPC `scrape-cardmarket-prices` ohne Argument → bei aktiver Pause `{ paused: true, until: <ISO> }`; sonst `{ ...basis, firstEd, paused: false, until: <ISO|null> }`. `window.api.scrapeCardmarketPrices()` ohne Parameter. `revealCmWindow`, `onCmChallenge`, Handler `reveal-cm-window`, `cmWin` und das `cm-challenge`-Ereignis entfallen.

- [ ] **Step 1: Implement** einen gemeinsamen Ablauf `runCmPasses(trigger, { maxBase, maxFirstEd, onProgress })` in `main.cjs`: Pause prüfen (`pauseActive(getSetting('cm_pause_until'))`) → `runCardmarketScrape({ minEur, maxCards: maxBase, … })` → falls nicht `abgebrochen`: `runFirstEdPass({ minEur, maxCards: maxFirstEd, … })` → falls irgendein Durchgang `abgebrochen`: Setting `cm_pause_until = pauseUntilIso(Date.now())` → je Durchgang `appendLog(<userData>/cardmarket-scraper.log, { type: 'run', trigger, pass, seiten, pruefungen_gesehen, pruefungen_gescheitert, errors, ms })`. `minEur = Number(getSetting('cm_scrape_min_eur')) || 5`. Knopf: `trigger 'button'`, ohne Grenzen; Poller: `trigger 'poller'`, `maxBase 4`, `maxFirstEd 2`. `cm_auto_min_rank` wird nicht mehr gelesen.
- [ ] **Step 2:** `npm run lint` → höchstens 5 Altfehler; `grep -n "show()\|reveal-cm-window\|cm-challenge" electron/main.cjs electron/preload.cjs electron/cardmarket-scraper.cjs` → keine Treffer.
- [ ] **Step 3:** Commit `feat(cm-scraper): Knopf und Poller still mit 6-Stunden-Pause, Pruef-Dialog entfernt`.

### Task 7: Oberfläche

**Files:**
- Create: `desktop/src/utils/cmEstimate.js`, `desktop/src/utils/cmEstimate.test.js`
- Modify: `desktop/src/components/CollectionList.jsx:58,78-81,86-90,94-98,100-115`
- Modify: `desktop/src/components/CollectionToolbar.jsx:10,58-71`
- Modify: `desktop/src/components/CardDetailPanel.jsx:341`

**Interfaces:**
- Consumes: IPC-Antwort aus Task 6; Varianten-Felder `cm_estimate`, `cm_estimate_max`, `price`.
- Produces: `estimateHint(variant) -> null | { label: 'Schätzung', title: string }`; `title` = `Cardmarket-Spanne ${fmt(price)} – ${fmt(max)}, genaue Version unbekannt` (Euro mit Komma, 2 Stellen). `cmRunMessage(r) -> string` für die Meldung nach dem Knopf.

- [ ] **Step 1: Failing tests** in `cmEstimate.test.js`: `estimateHint` → `null` bei `cm_estimate` 0/undefined; Text für `{cm_estimate:1, price:2, cm_estimate_max:40}` enthält `2,00 €` und `40,00 €`. `cmRunMessage({paused:true, until:'2026-11-16T18:00:00.000Z'})` enthält „Pause bis“ und die lokale Uhrzeit (`HH:MM`); `cmRunMessage({updated:2, firstEd:{updated:1}, pruefungenGesehen:0, …})` enthält „2“ und „0 Prüfungen“; mit `until` gesetzt zusätzlich „Pause bis“.
- [ ] **Step 2:** Run `node --test src/utils/cmEstimate.test.js` → FAIL; implementieren; → PASS.
- [ ] **Step 3: UI.** `CollectionList`: `cmMinRank`-State, `onCmChallenge`-Effekt mit `confirm()`, Speichern von `cm_auto_min_rank` entfernen; `runCardmarket` ruft `scrapeCardmarketPrices()` und zeigt `alert(cmRunMessage(r))` (bisherige `noMatchList`-Ausgabe anhängen). `CollectionToolbar`: Raritäts-Dropdown durch Zeile `Nur Drucke ab 5 € – darunter Schätzpreis aus der Cardmarket-Datei` (`text-klein text-muted`) ersetzen; Props bereinigen. `CardDetailPanel`: vor der `cm_product_derived`-Abfrage `estimateHint(variant)` → `<span className="text-klein text-muted" title={h.title}>≈ Schätzung</span>`.
- [ ] **Step 4:** `node --test src/utils/*.test.js src/utils/*.test.mjs` grün (inkl. `noLegacyColors`, `theme`); `npm run lint` ≤ 5 Altfehler; `npm run build` ok.
- [ ] **Step 5:** Commit `feat(cm-ui): Schaetzpreis-Hinweis, Euro-Schwelle statt Rarity, kein Pruef-Dialog`.

### Task 8: Gesamtprüfung und Abnahme

- [ ] **Step 1:** Alle Tests: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` und `node --test src/utils/*.test.js src/utils/*.test.mjs` → grün bis auf bekannte Altlasten (vorher auf `main` gegenprüfen, z. B. `test-sync.cjs`).
- [ ] **Step 2:** Abnahme 2 per Messskript (readonly) nach einem Bulk-Lauf in `npm run electron:dev` gegen eine **Kopie** der DB: Zahlen in `messung.md`.
- [ ] **Step 3:** Abnahmen 3 und 4 sind Gerätetests mit dem Nutzer (Installer, 24 h Poller, Log lesen) – im Ledger als offen vermerken.
- [ ] **Step 4:** Commit `docs(scraper): Abnahme-Messung`.
