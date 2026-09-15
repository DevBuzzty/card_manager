# Spec G4 Erste-Auflage-Preis — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exemplare mit `edition = 'first'` werden mit einem eigenen 1st-Ed-Preis bewertet. Der Preis ist `price × cm_first_ed_factor`. Den Faktor liest ein zweiter Cardmarket-Durchgang aus den Ab-Preisen der Produktseite, einmal ohne und einmal mit Filter `isFirstEd=Y`. Desktop und Handy rechnen dieselbe Regel, und das Karten-Detail zeigt „Basis … · 1st Ed … (×…)".

**Architecture:** Der Faktor liegt als `cards.cm_first_ed_factor` lokal (SQLite) und in der Cloud (Postgres). `price_first_ed` schreibt nie die App: Auf beiden Seiten führt ein Trigger den Wert aus `price × Faktor` nach (Zwilling SQLite ↔ Postgres). Der Scraper-Durchgang in `cardmarket-scraper.cjs` lädt je Kandidat drei Seiten: Versionen, Produkt und Produkt mit `?isFirstEd=Y`. Er nutzt reine Helfer aus `cardmarket-parse.cjs` (`selectVersionRow`, `productUrl`, `parseFromPrice`, `firstEdFactor`) und schreibt nur Faktor und Zeitstempel. Die Bewertung `unitPrice(card, copy) × Zustandsfaktor` ist ein Zwilling in vier Fassungen: JS main, daraus SQL, JS Renderer und Kotlin. Alle lesen die Fixture `docs/fixtures/valuation/first-ed.json`. Der Sync spiegelt `cm_first_ed_factor` wie `price_first_ed`.

**Tech Stack:** Electron CJS + better-sqlite3, React/Vite, Postgres (nur SQL-Datei), Kotlin/Compose (Material3), org.json, node:test, JUnit4.

**Spec:** `docs/superpowers/specs/2026-09-15-spec-g-nachtrag-g4-erste-auflage-preis.md`. Sie ändert `docs/superpowers/specs/2026-09-05-spec-g-portfolio-pro-design.md` und setzt G1 `4a1ab8b`, G2 `554d731`, G3 `82d689e` und den Echo-Push-Fix `6490ec4` voraus.

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus und verbinden sich nie mit Supabase. Das gilt auch für Edge-Function-Aufrufe und Deploys. SQL spielt der Nutzer von Hand im Dashboard ein; der Plan liefert nur die SQL-Datei.
- Immer explizite Pfade stagen, nie `git add -A` und nie `git stash`. Der Stash-Stack ist mit den Worktrees geteilt.
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI). `desktop/node_modules` ist im Worktree eine Junction.
- `cards.quantity` und `cards.deleted` pflegen Trigger; die App schreibt sie nie. Es gibt nur Soft-Delete.
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs`. G4 legt keinen neuen Kanal an.
- Sichtbare Texte sind deutsch mit echten Umlauten. Gespeichertes `Unknown` oder Leeres erscheint als „Unbekannt".
- Regeln wohnen in reinen, getesteten Helfern. Absichtliche Zwillinge werden im Kopfkommentar markiert, der den anderen Zwilling nennt, und auf beiden Seiten getestet.
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`). Ein sechster ist ein Fehlschlag.
- Deutsche Set-Codes werden nie aus englischen abgeleitet.
- Ein Test, der gegen einen Fehler schützt, muss nachweislich ohne den Schutz scheitern. Dazu den Schutz kurz sabotieren, den Fehlschlag im Bericht zitieren und die Sabotage zurücknehmen.
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- G4-spezifisch: `price_first_ed` wird von keiner App-Stelle geschrieben, nur von den Triggern. Der Scraper schreibt `cm_first_ed_factor` und `cm_first_ed_updated_at`, sonst nichts. Er legt keine `price_history`-Zeile an und hat keinen Einstellungs-Schalter.
- G4-spezifisch: Beim Basispreis bleiben `movers.cjs`/`Movers.kt`, `price-reference.cjs`, `price_reference_rpc.sql`, die Preis-Alarme und `evaluate-price-alerts`. Keine Edge Function ändert sich.
- G4-spezifisch: Der Tageswert von Desktop und Handy wird **im selben Merge** umgestellt (Task 3 und Task 7 gehören in denselben Zweig, G1 Lücke 6). Ohne die Handy-Umstellung würden beide Geräte verschiedene Gesamtwerte in `portfolio_snapshots` schreiben.

**Befehle (aus der Worktree-Wurzel, sofern nicht anders angegeben):**
- Desktop SQLite-Suite (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Desktop Sync-Skript (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
- Desktop-Helfer (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs`
- Desktop-Lint (in `desktop/`): `npx eslint .` → genau `5 errors`. Gelintet werden nur `*.js`/`*.jsx`, nicht `*.cjs`/`*.mjs`.
- Desktop-Build (in `desktop/`): `npx vite build`
- Android: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `docs/fixtures/valuation/first-ed.json` (neu) | Fälle für Einzelpreis, Wert, Trigger und Preiszeile | 1 |
| `desktop/electron/copies-schema.cjs` + `.test.cjs` | Spalte, zwei Trigger, Nachrechnen | 1 |
| `desktop/electron/containers-schema.test.cjs` | Test-Tabelle bekommt `price` (Trigger braucht sie) | 1 |
| `supabase/cards_first_ed_factor.sql` (neu) | Cloud-Spalte, Trigger-Zwilling, Nachrechnen | 2 |
| `desktop/electron/sync.cjs`, `test-sync.cjs` | `cm_first_ed_factor` spiegeln | 2 |
| `desktop/electron/valuation.cjs` + `.test.cjs` | `unitPrice`, `valueOf(card, copies)`, `unitPriceCaseSql`, `totalValue` | 3 |
| `desktop/electron/copies.cjs`, `copies-location.test.cjs` | `listContainers` editionsbewusst | 3 |
| `desktop/electron/collection-query.cjs`, `handlers.test.cjs` | Sammlungswert editionsbewusst | 3 |
| `desktop/src/utils/valuation.js` + `valuation.test.mjs` | Renderer-Zwilling, `firstEdLine` | 4 |
| `desktop/src/utils/breakdown.js` + `breakdown.test.js` | Binder-Aufteilung | 4 |
| `desktop/src/components/BinderView.jsx`, `CardDetailPanel.jsx` | Seitenwert, Gruppenwert, Preiszeile | 4 |
| `desktop/electron/cardmarket-parse.cjs` + `cardmarket-parse.test.cjs` | `selectVersionRow`, `productUrl`, `firstEdUrl`, `parseFromPrice`, `firstEdFactor` | 5 |
| `desktop/electron/cardmarket-scraper.cjs` | `EXTRACT_JS` mit `href`, Basis-Durchgang über `selectVersionRow` | 5 |
| `desktop/electron/cardmarket-scraper.cjs`, `cardmarket-first-ed.test.cjs` (neu) | `firstEdCandidates`, `runFirstEdPass` | 6 |
| `desktop/electron/main.cjs` | Aufruf im Knopf-IPC und im Poller | 6 |
| `android/.../cloud/CardRow.kt`, `CollectionRepository.kt` | `priceFirstEd`, `cmFirstEdFactor` lesen | 7 |
| `android/.../cloud/Valuation.kt`, `ValuationTest.kt`, `CardRowParseTest.kt` (neu) | Kotlin-Zwilling, Preiszeile, Parser | 7 |
| `android/.../ui/Dashboard.kt`, `BinderPageScreen.kt`, `BindersScreen.kt`, `CardDetailScreen.kt`, `ml/BinderBreakdown.kt`, `BinderBreakdownTest.kt` | Wert-Stellen, Preiszeile | 7 |

`android/...` steht für `android/app/src/main/java/com/example/yugiohscanner`. Die Tests liegen unter `android/app/src/test/java/com/example/yugiohscanner/` (Paket `com.example.yugiohscanner`) und lesen Fixtures über `Fixtures.text("docs/fixtures/...")`. Die Android-Unit-Tests laufen auf der JVM ohne Robolectric.

## Plan-Ergänzungen (vom Plan entschieden, bitte dem Nutzer vorlegen)

1. **Rundung SQLite mit `+ 1e-7`.** Gemessen: SQLite `ROUND(10 * 1.0005, 2)` = `10.0`, weil `10.004999…` binär unter der Grenze liegt. Postgres rechnet in `numeric` exakt `10.01`. Damit die Zwillinge gleich runden, rechnet SQLite `ROUND(price * factor + 1e-7, 2)`. Die Postgres-Fassung rechnet exakt: `round(price::numeric * factor, 2)::double precision`. Das `1e-7` liegt unter der kleinsten echten Stelle (Preis 2 und Faktor 4 Nachkommastellen ergeben 6). Der Fixture-Fall „,xx5" ist `10 × 1.0005 → 10.01`.
2. **Trigger bei jedem Start neu, Nachrechnen bei jedem Start.** Die Trigger werden wie die Recount-Trigger jedes Mal gelöscht und neu angelegt. Das Nachrechnen ist ein idempotentes `UPDATE … WHERE price_first_ed IS NOT <Formel>` ohne Settings-Flag und schreibt im Normalfall keine Zeile.
3. **Die Schutzbedingung „nur wenn verschieden" steht im `WHEN` beider SQLite-Trigger.** Der Schutz-Test zählt Schreibvorgänge auf `price_first_ed` über einen Test-Trigger. `updated_at` taugt dafür nicht, weil der äußere Preis-UPDATE ihn ohnehin stempelt.
4. **Die Fixture hat vier Abschnitte:** `unitPrice`, `valueOf` (JS main, SQL, Renderer, Kotlin), `trigger` (SQLite automatisch, Postgres per Nutzer-SELECT in der Abnahme) und `line` (Preiszeile, Renderer und Kotlin).
5. **Die Preiszeile ist ein getesteter Helfer `firstEdLine(card)` in zwei Fassungen** (Renderer `valuation.js`, Kotlin `Valuation.kt`). Das Format ist „Basis 73,85 € · 1st Ed 77,87 € (×1,05)" mit Tausenderpunkt und Faktor auf 2 Nachkommastellen. Ohne `cm_first_ed_factor` entfällt „(×…)". Ohne `price_first_ed` gibt der Helfer `null` zurück, und die bisherige Anzeige bleibt.
6. **Handy-Kartenmodell:** Neben `price_first_ed` liest es auch `cm_first_ed_factor`, weil die Preiszeile den Faktor zeigt.
7. **Sync:** `cm_first_ed_factor` steht in `MIRROR_COLS`, in `rowToRemote` (explizit `?? null`) und im Einfüge-Zweig von `applyRemoteRow` (`remoteToLocalFull` und INSERT-Spaltenliste) — das sind die „lokalen Spiegel-INSERTs" der Spec. Der Patch-Zweig (`remoteToLocalPatch`/UPDATE) bleibt unverändert.
8. **„Geschriebener Faktor"** zählt jede Schreibung, auch `NULL` („kein Angebot mit Filter"). Ein entfernter Faktor kann den Wert senken; `recordPortfolioValue` ist ohnehin schwellwertgebunden.
9. **Poller-Grenze:** Gezählt wird jeder bearbeitete Kandidat, auch gescheiterte (Challenge, kein Treffer). Sonst könnte ein Cloudflare-Lauf alle Kandidaten in einem Tick anfassen.
10. **Manueller Lauf:** Wie beim Basis-Durchgang heute gibt es `recordPortfolioValue` ohne `price-update`. Die IPC-Antwort bekommt ein zusätzliches Feld `firstEd: { candidates, updated, noOffers, skipped, errors }`. Der Meldungstext in `CollectionList.jsx` bleibt unverändert (keine UI-Änderung, Spec §7).
11. **Der gemeinsame Auswahl-Helfer `selectVersionRow(rows, printing, lookupSetName)`** übernimmt die Basis-Logik wörtlich. Ein Code-Treffer verlangt einen Ab-Preis in der Versionszeile (`trend != null`); der Set-Name wird nur bei fehlendem Code-Treffer nachgeschlagen. Ein Printing ohne jedes Angebot auf der Versions-Seite fällt damit auf den Set-Namen zurück oder ergibt keinen Treffer, und es wird nichts geschrieben.
12. **Testbarkeit:** `firstEdCandidates(db, { minRank, force, nowMs, limit })` bekommt die Uhrzeit von außen. `runFirstEdPass` nimmt `deps` (`makeWindow`, `loadPage`, `readRows`, `readInfoPairs`, `sleep`, `setNameFor`, `cardName`), die der Test durch Attrappen ersetzt. `cardmarket-scraper.cjs` lässt sich unter `ELECTRON_RUN_AS_NODE` laden (geprüft).
13. **Kandidaten** verlangen zusätzlich `c.deleted = 0` für das Printing. Reihenfolge bei gleichem Zeitstempel ist der 4-Spalten-Schlüssel. Fehlt `cards.name`, kommt der englische Name aus YGOPRODeck (wie im Basis-Durchgang).
14. **Alte Signaturen fallen weg:** `valueOf(price, copies)` wird in allen drei Code-Fassungen durch `valueOf(card, copies)` ersetzt, ohne Überladung. Alle Aufrufer werden umgestellt.
15. **`CollectionRepository.parse`** wird `internal` statt `private`, damit `CardRowParseTest` das Lesen der beiden neuen Felder prüfen kann. Das Objekt hat keine Android-Initialisierung.
16. **`containers-schema.test.cjs`** bekommt eine `price`-Spalte in seiner Test-Tabelle. Die neuen Trigger und das Nachrechnen verweisen auf `cards.price`, und die echte Datenbank hat die Spalte immer.

---
### Task 1: SQLite-Spalte, Trigger-Zwilling (SQLite-Seite) und Fixture

**Files:**
- Create: `docs/fixtures/valuation/first-ed.json`
- Modify: `desktop/electron/copies-schema.cjs`
- Modify: `desktop/electron/copies-schema.test.cjs`
- Modify: `desktop/electron/containers-schema.test.cjs`

**Interfaces:**
- Produces (für Task 3, 4, 6, 7): Spalte `cards.cm_first_ed_factor REAL` und die Trigger `trg_cards_first_ed_ins` / `trg_cards_first_ed_upd`, die `cards.price_first_ed` nachführen. Die Fixture `docs/fixtures/valuation/first-ed.json` hat die Abschnitte `unitPrice[] { name, card, copy, unit }`, `valueOf[] { name, card, copies, value }`, `trigger[] { name, price, factor, price_first_ed }` und `line[] { name, card, line }`. `card` hat die Schlüssel `price`, `price_first_ed` und `cm_first_ed_factor`; `copy` hat `edition`, `condition` und optional `count`.
- Consumes (vorhanden): `ensureCopiesSchema(db)`, `addColumnIfMissing` in `copies-schema.cjs`.

- [ ] **Step 1: Fixture schreiben**

`docs/fixtures/valuation/first-ed.json`. Die Werte sind nachgerechnet: 12,5 + 12,5 × 0,7 + 10 + 10 × 0,85 = 39,75; 12,35 × 0,85 = 10,4975 → 10,5; SQLite `ROUND(73.85 * 1.0545 + 1e-7, 2)` = 77,87 und `ROUND(10 * 1.0005 + 1e-7, 2)` = 10,01 (gemessen).
```json
{
  "_comment": "Spec G4 §5/§6 — Bewertung mit 1st-Ed-Preis. Leser: desktop/electron/valuation.test.cjs (JS main + SQL totalValue), desktop/electron/copies-location.test.cjs (SQL listContainers), desktop/src/utils/valuation.test.mjs (Renderer), android ValuationTest.kt (Kotlin), desktop/electron/copies-schema.test.cjs (Abschnitt trigger). Abschnitt trigger prueft der Nutzer in der Cloud per SELECT.",
  "unitPrice": [
    { "name": "first mit price_first_ed", "card": { "price": 73.85, "price_first_ed": 77.87 }, "copy": { "edition": "first", "condition": "NM" }, "unit": 77.87 },
    { "name": "first ohne price_first_ed fällt auf price", "card": { "price": 73.85, "price_first_ed": null }, "copy": { "edition": "first", "condition": "NM" }, "unit": 73.85 },
    { "name": "unlimited ignoriert price_first_ed", "card": { "price": 73.85, "price_first_ed": 77.87 }, "copy": { "edition": "unlimited", "condition": "NM" }, "unit": 73.85 },
    { "name": "unknown ignoriert price_first_ed", "card": { "price": 73.85, "price_first_ed": 77.87 }, "copy": { "edition": "unknown", "condition": "NM" }, "unit": 73.85 },
    { "name": "limited ignoriert price_first_ed", "card": { "price": 73.85, "price_first_ed": 77.87 }, "copy": { "edition": "limited", "condition": "NM" }, "unit": 73.85 },
    { "name": "price NULL, unknown", "card": { "price": null, "price_first_ed": null }, "copy": { "edition": "unknown", "condition": "NM" }, "unit": 0 },
    { "name": "price NULL, first ohne price_first_ed", "card": { "price": null, "price_first_ed": null }, "copy": { "edition": "first", "condition": "NM" }, "unit": 0 }
  ],
  "valueOf": [
    {
      "name": "Zustand mal Edition gemischt",
      "card": { "price": 10, "price_first_ed": 12.5 },
      "copies": [
        { "edition": "first", "condition": "NM" },
        { "edition": "first", "condition": "GD" },
        { "edition": "unknown", "condition": "NM" },
        { "edition": "unlimited", "condition": "EX" }
      ],
      "value": 39.75
    },
    { "name": "Gruppe mit count", "card": { "price": 10, "price_first_ed": 12.5 }, "copies": [{ "edition": "first", "condition": "NM", "count": 2 }], "value": 25 },
    { "name": "MAMO-DE020 Beispiel", "card": { "price": 73.85, "price_first_ed": 77.87 }, "copies": [{ "edition": "first", "condition": "NM" }], "value": 77.87 },
    { "name": "first ohne price_first_ed zählt mit Basispreis", "card": { "price": 73.85, "price_first_ed": null }, "copies": [{ "edition": "first", "condition": "EX" }], "value": 62.77 },
    { "name": "price NULL", "card": { "price": null, "price_first_ed": null }, "copies": [{ "edition": "first", "condition": "NM" }], "value": 0 },
    { "name": "keine Exemplare", "card": { "price": 10, "price_first_ed": 12.5 }, "copies": [], "value": 0 },
    { "name": "Rundungsfall auf Cent", "card": { "price": 11, "price_first_ed": 12.35 }, "copies": [{ "edition": "first", "condition": "EX" }], "value": 10.5 }
  ],
  "trigger": [
    { "name": "MAMO-DE020", "price": 73.85, "factor": 1.0545, "price_first_ed": 77.87 },
    { "name": "Rundung auf ,xx5 kaufmännisch", "price": 10, "factor": 1.0005, "price_first_ed": 10.01 },
    { "name": "ohne Faktor", "price": 10, "factor": null, "price_first_ed": null },
    { "name": "ohne Preis", "price": null, "factor": 1.05, "price_first_ed": null }
  ],
  "line": [
    { "name": "mit Faktor", "card": { "price": 73.85, "price_first_ed": 77.87, "cm_first_ed_factor": 1.0545 }, "line": "Basis 73,85 € · 1st Ed 77,87 € (×1,05)" },
    { "name": "Tausenderpunkt", "card": { "price": 1234.5, "price_first_ed": 1301.16, "cm_first_ed_factor": 1.054 }, "line": "Basis 1.234,50 € · 1st Ed 1.301,16 € (×1,05)" },
    { "name": "ohne Faktor keine Klammer", "card": { "price": 73.85, "price_first_ed": 77.87, "cm_first_ed_factor": null }, "line": "Basis 73,85 € · 1st Ed 77,87 €" },
    { "name": "ohne price_first_ed keine Zeile", "card": { "price": 73.85, "price_first_ed": null, "cm_first_ed_factor": 1.0545 }, "line": null }
  ]
}
```
Nachrechnen: 73,85 × 0,85 = 62,7725 → 62,77 (in JS gemessen).

- [ ] **Step 2: Trigger-Tests schreiben**

In `desktop/electron/copies-schema.test.cjs`:

(a) Im ersten Test (`ensureCopiesSchema is idempotent …`) nach der Zeile `assert.ok(cols(db, 'cards').includes('cm_first_ed_updated_at'));` einfügen:
```js
  assert.ok(cols(db, 'cards').includes('cm_first_ed_factor'));
```

(b) Oben unter den `require`-Zeilen ergänzen:
```js
const fs = require('fs');
const path = require('path');
// Spec G4 §5 — Abschnitt `trigger` der gemeinsamen Fixture. ZWILLING der Cloud-Fassung supabase/cards_first_ed_factor.sql.
const FIRST_ED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'valuation', 'first-ed.json'), 'utf8'));
const KEY = "id='1' AND set_code='MAMO-DE020' AND language='DE' AND rarity='Ultra Rare'";
const firstEd = (db) => db.prepare(`SELECT price_first_ed AS pfe, cm_first_ed_factor AS f FROM cards WHERE ${KEY}`).get();
const insertMamo = (db, price) => db.prepare("INSERT INTO cards (id, set_code, language, rarity, quantity, price) VALUES ('1','MAMO-DE020','DE','Ultra Rare',0,?)").run(price);
```

(c) Am Dateiende anhängen:
```js
test('1st-Ed-Trigger: Fixture-Fälle (Faktor setzen)', () => {
  for (const c of FIRST_ED.trigger) {
    const db = freshDb(); ensureCopiesSchema(db);
    insertMamo(db, c.price);
    db.prepare(`UPDATE cards SET cm_first_ed_factor = ? WHERE ${KEY}`).run(c.factor);
    assert.strictEqual(firstEd(db).pfe, c.price_first_ed, c.name);
  }
});

test('1st-Ed-Trigger: Preis ändern zieht nach, Faktor leeren und Preis NULL leeren', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  insertMamo(db, 73.85);
  db.prepare(`UPDATE cards SET cm_first_ed_factor = 1.0545 WHERE ${KEY}`).run();
  assert.strictEqual(firstEd(db).pfe, 77.87);
  db.prepare(`UPDATE cards SET price = 80 WHERE ${KEY}`).run();
  assert.strictEqual(firstEd(db).pfe, 84.36, 'Preisänderung rechnet neu');
  db.prepare(`UPDATE cards SET price = NULL WHERE ${KEY}`).run();
  assert.strictEqual(firstEd(db).pfe, null, 'Preis NULL → price_first_ed NULL');
  db.prepare(`UPDATE cards SET price = 73.85 WHERE ${KEY}`).run();
  assert.strictEqual(firstEd(db).pfe, 77.87);
  db.prepare(`UPDATE cards SET cm_first_ed_factor = NULL WHERE ${KEY}`).run();
  assert.strictEqual(firstEd(db).pfe, null, 'Faktor leeren → price_first_ed NULL');
});

test('1st-Ed-Trigger: INSERT mit Faktor', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, quantity, price, cm_first_ed_factor) VALUES ('1','MAMO-DE020','DE','Ultra Rare',0,73.85,1.0545)").run();
  assert.strictEqual(firstEd(db).pfe, 77.87);
});

test('1st-Ed-Trigger schreibt price_first_ed nicht neu, wenn der Wert gleich bleibt', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  insertMamo(db, 73.85);
  db.prepare(`UPDATE cards SET cm_first_ed_factor = 1.0545 WHERE ${KEY}`).run();
  // Test-Zaehler: jede Schreibung auf price_first_ed hinterlaesst eine Zeile.
  db.exec(`CREATE TABLE first_ed_writes (n INTEGER);
           CREATE TRIGGER test_first_ed_count AFTER UPDATE OF price_first_ed ON cards
           BEGIN INSERT INTO first_ed_writes VALUES (1); END;`);
  const writes = () => db.prepare('SELECT COUNT(*) AS n FROM first_ed_writes').get().n;
  db.prepare(`UPDATE cards SET price = 73.85 WHERE ${KEY}`).run();
  db.prepare(`UPDATE cards SET cm_first_ed_factor = 1.0545 WHERE ${KEY}`).run();
  assert.equal(writes(), 0, 'gleicher Preis und gleicher Faktor dürfen price_first_ed nicht neu schreiben');
  db.prepare(`UPDATE cards SET price = 80 WHERE ${KEY}`).run();
  assert.equal(writes(), 1, 'eine echte Änderung schreibt genau einmal');
});

test('ensureCopiesSchema rechnet price_first_ed beim Start nach und legt die Trigger neu an', () => {
  const db = freshDb(); ensureCopiesSchema(db);
  insertMamo(db, 73.85);
  db.exec('DROP TRIGGER trg_cards_first_ed_upd');
  db.prepare(`UPDATE cards SET cm_first_ed_factor = 1.0545 WHERE ${KEY}`).run();
  assert.strictEqual(firstEd(db).pfe, null, 'ohne Trigger bleibt der Wert stehen');
  ensureCopiesSchema(db);
  assert.strictEqual(firstEd(db).pfe, 77.87, 'Nachrechnen beim Start');
  db.prepare(`UPDATE cards SET price = 80 WHERE ${KEY}`).run();
  assert.strictEqual(firstEd(db).pfe, 84.36, 'Trigger ist wieder da');
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-schema.test.cjs`
Expected: FAIL. Der erste Test scheitert an `cm_first_ed_factor`, die neuen an `no such column: cm_first_ed_factor`.

- [ ] **Step 4: `copies-schema.cjs` erweitern**

Direkt über `function ensureCopiesSchema(db) {` einfügen:
```js
// Spec G4 §5 — 1st-Ed-Preis = Basispreis x Aufschlagsfaktor, nachgefuehrt per Trigger; kein Preisschreiber
// muss price_first_ed kennen. ZWILLING: supabase/cards_first_ed_factor.sql (public.cards_price_first_ed).
// `p` ist 'NEW.' im Trigger und '' im Nachrechnen. Das `+ 1e-7` gleicht die Binaerdarstellung aus:
// 10 * 1.0005 ist in double 10.004999..., SQLite ROUND ergaebe 10.0, Postgres rechnet in numeric exakt 10.01.
// Es liegt unter der kleinsten echten Stelle (Preis 2 + Faktor 4 Nachkommastellen = 6). Fixture:
// docs/fixtures/valuation/first-ed.json, Abschnitt trigger.
const FIRST_ED_SQL = (p) =>
  `(CASE WHEN ${p}cm_first_ed_factor IS NOT NULL AND ${p}price IS NOT NULL THEN ROUND(${p}price * ${p}cm_first_ed_factor + 1e-7, 2) END)`;
// WHEN-Bedingung "nur wenn verschieden" (IS NOT statt != wegen NULL): kein Neuschreiben bei gleichem Wert,
// also kein erneuter updated_at-Stempel und kein unnoetiger Push.
const FIRST_ED_TRIGGER_BODY = `
    WHEN NEW.price_first_ed IS NOT ${FIRST_ED_SQL('NEW.')}
    BEGIN
      UPDATE cards SET price_first_ed = ${FIRST_ED_SQL('NEW.')}
       WHERE id = NEW.id AND set_code = NEW.set_code AND language = NEW.language AND rarity = NEW.rarity;
    END;`;
```

In `ensureCopiesSchema` nach der Zeile `addColumnIfMissing(db, 'portfolio_history', 'sealed_value', 'REAL NOT NULL DEFAULT 0');` einfügen:
```js
  // Spec G4 §5: Aufschlagsfaktor der Ersten Auflage. Trigger bei jedem Start neu (wie die Recount-Trigger),
  // danach einmal idempotent nachrechnen -- schreibt im Normalfall keine Zeile.
  addColumnIfMissing(db, 'cards', 'cm_first_ed_factor', 'REAL');
  db.exec(`
    DROP TRIGGER IF EXISTS trg_cards_first_ed_ins;
    DROP TRIGGER IF EXISTS trg_cards_first_ed_upd;
    CREATE TRIGGER trg_cards_first_ed_ins AFTER INSERT ON cards FOR EACH ROW ${FIRST_ED_TRIGGER_BODY}
    CREATE TRIGGER trg_cards_first_ed_upd AFTER UPDATE OF price, cm_first_ed_factor ON cards FOR EACH ROW ${FIRST_ED_TRIGGER_BODY}
  `);
  db.exec(`UPDATE cards SET price_first_ed = ${FIRST_ED_SQL('')} WHERE price_first_ed IS NOT ${FIRST_ED_SQL('')}`);
```

- [ ] **Step 5: `containers-schema.test.cjs` anpassen**

In `freshDb()` die Zeile `    quantity INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0,` ersetzen durch:
```js
    quantity INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, price REAL,
```
(Die Trigger aus Task 1 verweisen auf `cards.price`; die echte Tabelle in `database.cjs` hat die Spalte.)

- [ ] **Step 6: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
Expected: alle grün, darunter 5 neue Tests in `copies-schema.test.cjs`.
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` → alle `PASS`-Zeilen, denn `freshSyncDb` ruft `ensureCopiesSchema`.

- [ ] **Step 7: Schutz-Nachweis**

In `FIRST_ED_TRIGGER_BODY` die Zeile `    WHEN NEW.price_first_ed IS NOT ${FIRST_ED_SQL('NEW.')}` kurz entfernen. Dann `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-schema.test.cjs` laufen lassen: Der Test „1st-Ed-Trigger schreibt price_first_ed nicht neu, wenn der Wert gleich bleibt" scheitert mit `2 !== 0` (je eine Schreibung für Preis und Faktor). Fehlschlag zitieren, zurücknehmen, erneut grün.
Zweiter Nachweis: `+ 1e-7` kurz entfernen → Fixture-Fall „Rundung auf ,xx5 kaufmännisch" scheitert mit `10 !== 10.01`. Zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add docs/fixtures/valuation/first-ed.json desktop/electron/copies-schema.cjs desktop/electron/copies-schema.test.cjs desktop/electron/containers-schema.test.cjs
git commit -m "feat(g4): cm_first_ed_factor mit Trigger fuer price_first_ed (SQLite) und Bewertungs-Fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: Cloud-SQL (Trigger-Zwilling Postgres) und Sync-Spiegel

**Files:**
- Create: `supabase/cards_first_ed_factor.sql`
- Modify: `desktop/electron/sync.cjs`
- Modify: `desktop/electron/test-sync.cjs`

**Interfaces:**
- Produces: Cloud-Spalte `public.cards.cm_first_ed_factor numeric`, Funktion `public.cards_price_first_ed()`, Trigger `trg_cards_price_first_ed`. `rowToRemote(row)` liefert zusätzlich `cm_first_ed_factor` (Zahl oder `null`), `remoteToLocalFull(r)` ebenso, und der Einfüge-Zweig von `applyRemoteRow` schreibt die Spalte.
- Consumes (Task 1): lokale Spalte `cards.cm_first_ed_factor`.

- [ ] **Step 1: `supabase/cards_first_ed_factor.sql` schreiben (nur Datei, nichts ausführen)**

```sql
-- supabase/cards_first_ed_factor.sql — Spec G4 §5. Einmal im Dashboard einspielen (idempotent),
-- VOR dem neuen Desktop-Installer: der Push sendet cm_first_ed_factor, ohne Spalte scheitert jeder Push.
-- price_first_ed = round(price x cm_first_ed_factor, 2), nachgefuehrt per Trigger. Die Edge Function
-- refresh-cardmarket-prices setzt nur price; dieser Trigger rechnet den 1st-Ed-Preis mit demselben Faktor nach.
-- ZWILLING: desktop/electron/copies-schema.cjs (FIRST_ED_SQL, trg_cards_first_ed_ins/_upd).
-- Rundung exakt in numeric (price::numeric), damit ,xx5 kaufmaennisch rundet wie SQLite mit + 1e-7.
-- Abnahme-Fixture: docs/fixtures/valuation/first-ed.json, Abschnitt trigger.

alter table public.cards add column if not exists cm_first_ed_factor numeric;

create or replace function public.cards_price_first_ed()
returns trigger language plpgsql as $$
begin
  new.price_first_ed := case
    when new.cm_first_ed_factor is not null and new.price is not null
      then round(new.price::numeric * new.cm_first_ed_factor, 2)::double precision
  end;
  return new;
end $$;

drop trigger if exists trg_cards_price_first_ed on public.cards;
create trigger trg_cards_price_first_ed
  before insert or update on public.cards
  for each row execute function public.cards_price_first_ed();

-- Einmaliges Nachrechnen; aendert nur abweichende Zeilen (der Trigger setzt den Wert beim UPDATE selbst).
update public.cards
   set price_first_ed = case
         when cm_first_ed_factor is not null and price is not null
           then round(price::numeric * cm_first_ed_factor, 2)::double precision
       end
 where price_first_ed is distinct from case
         when cm_first_ed_factor is not null and price is not null
           then round(price::numeric * cm_first_ed_factor, 2)::double precision
       end;

-- Abnahme (Nutzer, von Hand): Fixture-Faelle pruefen, erwartet 77.87 | 10.01 | null | null
-- select round(73.85::numeric * 1.0545, 2)::double precision, round(10::numeric * 1.0005, 2)::double precision;
```

- [ ] **Step 2: Sync-Test schreiben**

In `desktop/electron/test-sync.cjs`:

(a) Nach der Zeile `assert.strictEqual(rowToRemote({ ...local, price_locked: 1 }).price_locked, 1);` einfügen:
```js

// Spec G4 §5: cm_first_ed_factor reist im Push-Payload mit (null, wenn nicht gesetzt) und beim Einfuegen
// einer fehlenden Zeile; price_first_ed bleibt ebenfalls im Payload.
assert.strictEqual(remote.cm_first_ed_factor, null, 'fehlender Faktor spiegelt als null');
{
  const withFactor = rowToRemote({ ...local, cm_first_ed_factor: 1.0545, price_first_ed: 77.87 });
  assert.strictEqual(withFactor.cm_first_ed_factor, 1.0545, 'Faktor im Push-Payload');
  assert.strictEqual(withFactor.price_first_ed, 77.87, 'price_first_ed bleibt im Push-Payload');
  assert.strictEqual(remoteToLocalFull({ id: '9', set_code: 'MAMO-DE020', cm_first_ed_factor: 1.0545 }).cm_first_ed_factor, 1.0545);
  assert.strictEqual(remoteToLocalFull({ id: '9', set_code: 'MAMO-DE020' }).cm_first_ed_factor, null);
  console.log('sync cm_first_ed_factor mapping test: PASS');
}
```

(b) Im Block `applyRemoteRow must not re-dirty …` in der `CREATE TABLE cards` die Zeile `    cm_product_id INTEGER, price_locked INTEGER DEFAULT 0, price_first_ed REAL,` ersetzen durch:
```js
    cm_product_id INTEGER, price_locked INTEGER DEFAULT 0, price_first_ed REAL, cm_first_ed_factor REAL,
```
und nach `  assert.strictEqual(ins.price_locked, 2, 'price_locked carried on insert');` einfügen:
```js
  applyRemoteRow(db, { id: '3', set_code: 'MAMO-DE020', language: 'DE', rarity: 'Ultra Rare', deleted: false, price: 73.85, price_first_ed: 77.87, cm_first_ed_factor: 1.0545 });
  const fe = db.prepare("SELECT price_first_ed, cm_first_ed_factor FROM cards WHERE id='3'").get();
  assert.strictEqual(fe.cm_first_ed_factor, 1.0545, 'cm_first_ed_factor carried on insert');
  assert.strictEqual(fe.price_first_ed, 77.87, 'price_first_ed carried on insert');
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
Expected: FAIL mit `AssertionError … fehlender Faktor spiegelt als null` (`undefined !== null`).

- [ ] **Step 4: `sync.cjs` anpassen**

(a) `MIRROR_COLS`:
```js
const MIRROR_COLS = ['id', 'set_code', 'language', 'name', 'type', 'desc',
  'image_url', 'atk', 'def', 'level', 'race', 'attribute',
  'rarity', 'price', 'deleted', 'cm_product_id', 'price_locked', 'price_first_ed', 'cm_first_ed_factor'];
```
Den Kommentar darüber um diese Zeile ergänzen: `// Spec G4 §5: cm_first_ed_factor mit; die Cloud rechnet price_first_ed per Trigger aus price x Faktor.`

(b) In `rowToRemote` nach `else if (c === 'price_first_ed') out.price_first_ed = row.price_first_ed ?? null;`:
```js
    else if (c === 'cm_first_ed_factor') out.cm_first_ed_factor = row.cm_first_ed_factor ?? null;
```

(c) In `remoteToLocalFull` nach `    price_first_ed: r.price_first_ed ?? null,`:
```js
    cm_first_ed_factor: r.cm_first_ed_factor ?? null,
```

(d) Im Einfüge-Zweig von `applyRemoteRow` Spaltenliste und Werte ersetzen:
```js
    db.prepare(`INSERT OR IGNORE INTO cards
      (id, set_code, language, name, type, desc, image_url, atk, def, level, race, attribute, quantity, rarity, price, deleted, cm_product_id, price_locked, price_first_ed, cm_first_ed_factor)
      VALUES (@id,@set_code,@language,@name,@type,@desc,@image_url,@atk,@def,@level,@race,@attribute,@quantity,@rarity,@price,@deleted,@cm_product_id,@price_locked,@price_first_ed,@cm_first_ed_factor)`)
      .run(remoteToLocalFull(r));
```
Der Patch-Zweig (`UPDATE cards SET deleted = @deleted …`) bleibt unverändert.

- [ ] **Step 5: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` → alle `PASS`-Zeilen, darunter `sync cm_first_ed_factor mapping test: PASS`.
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → alle grün. `sealed-sync.test.cjs` baut Karten über `ensureCopiesSchema`.
Per Grep (lesend) bestätigen, dass `test-sync-insert.cjs` und `test-consolidation-rename.cjs` kein `applyRemoteRow` mit eigener `cards`-Tabelle ohne `cm_first_ed_factor` aufrufen: `Grep "applyRemoteRow" desktop/electron`. Tut es eines, bekommt dessen `CREATE TABLE cards` die Spalte `cm_first_ed_factor REAL`, und die Datei wird mit gestaged.

- [ ] **Step 6: Commit**

```bash
git add supabase/cards_first_ed_factor.sql desktop/electron/sync.cjs desktop/electron/test-sync.cjs
git commit -m "feat(g4): Cloud-Spalte cm_first_ed_factor mit Trigger und Sync-Spiegel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: Bewertungs-Zwilling JS main + SQL; Gesamtwert, Behälter, Sammlung

**Files:**
- Modify: `desktop/electron/valuation.cjs`
- Modify: `desktop/electron/valuation.test.cjs`
- Modify: `desktop/electron/copies.cjs`
- Modify: `desktop/electron/copies-location.test.cjs`
- Modify: `desktop/electron/collection-query.cjs`
- Modify: `desktop/electron/handlers.test.cjs`

**Interfaces:**
- Produces (für Task 4 als Vorbild und für `portfolio-value.cjs`/`sync.cjs` unverändert über `totalValue`): `unitPrice(card, copy) → number`, `valueOf(card, copies) → number` (auf Cent gerundet; `copies` sind `[{ edition, condition, count? }]`), `unitPriceCaseSql(cardAlias, copyAlias) → string`, `totalValue(db)` editionsbewusst. `listContainers(db)[].value` und `collectionSql()`-Spalte `value` rechnen editionsbewusst; `factor_sum` bleibt.
- Consumes (Task 1): Fixture-Abschnitte `unitPrice`, `valueOf`; Spalte `cards.price_first_ed`.

- [ ] **Step 1: Tests schreiben**

(a) `desktop/electron/valuation.test.cjs` ersetzen durch:
```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { CONDITIONS, EDITIONS, conditionFactor, unitPrice, valueOf, factorCaseSql, unitPriceCaseSql, totalValue, copyCount } = require('./valuation.cjs');

// Spec G4 §6 — ZWILLING: desktop/src/utils/valuation.test.mjs und android ValuationTest.kt lesen dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'valuation', 'first-ed.json'), 'utf8'));

test('condition codes and factors', () => {
  assert.deepStrictEqual(CONDITIONS, ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
  assert.deepStrictEqual(EDITIONS, ['first', 'unlimited', 'limited', 'unknown']);
  assert.equal(conditionFactor('NM'), 1);
  assert.equal(conditionFactor('GD'), 0.7);
  assert.equal(conditionFactor(''), 1, 'blank condition counts as NM');
  assert.equal(conditionFactor('XX'), 1, 'unknown code counts as NM');
});

test('valueOf sums unit price × factor over copies (count optional)', () => {
  assert.equal(valueOf({ price: 10 }, [{ condition: 'NM' }, { condition: 'GD' }]), 17);
  assert.equal(valueOf({ price: 10 }, [{ condition: 'NM', count: 2 }, { condition: 'PO', count: 1 }]), 22);
  assert.equal(valueOf({ price: null }, [{ condition: 'NM' }]), 0);
  assert.equal(valueOf({ price: 10 }, []), 0);
  assert.equal(valueOf(undefined, [{ condition: 'NM' }]), 0, 'fehlende Karte zählt 0');
});

test('Fixture: unitPrice', () => {
  for (const c of FIX.unitPrice) assert.strictEqual(unitPrice(c.card, c.copy), c.unit, c.name);
});

test('Fixture: valueOf', () => {
  for (const c of FIX.valueOf) assert.strictEqual(valueOf(c.card, c.copies), c.value, c.name);
});

test('unitPriceCaseSql entspricht der Spec wörtlich', () => {
  assert.equal(unitPriceCaseSql('c', 'cp'),
    "CASE WHEN cp.edition = 'first' AND c.price_first_ed IS NOT NULL THEN c.price_first_ed ELSE COALESCE(c.price, 0) END");
});

function tinyDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT, rarity TEXT, price REAL, price_first_ed REAL, deleted INTEGER DEFAULT 0);
           CREATE TABLE card_copies (copy_id TEXT PRIMARY KEY, card_id TEXT, set_code TEXT, language TEXT, rarity TEXT,
             edition TEXT DEFAULT 'unknown', condition TEXT, deleted INTEGER DEFAULT 0);`);
  return db;
}

test('factorCaseSql + totalValue/copyCount against a tiny db', () => {
  const db = tinyDb();
  db.exec(`INSERT INTO cards VALUES ('1','LOB-DE001','DE','Ultra Rare',10,NULL,0);
           INSERT INTO card_copies VALUES ('a','1','LOB-DE001','DE','Ultra Rare','unknown','NM',0);
           INSERT INTO card_copies VALUES ('b','1','LOB-DE001','DE','Ultra Rare','unknown','GD',0);
           INSERT INTO card_copies VALUES ('c','1','LOB-DE001','DE','Ultra Rare','unknown','NM',1);`);
  assert.match(factorCaseSql('cp.condition'), /CASE cp\.condition WHEN 'MT' THEN 1/);
  assert.equal(totalValue(db), 17);
  assert.equal(copyCount(db), 2);
});

test('Fixture: totalValue (SQL-Fassung)', () => {
  for (const c of FIX.valueOf) {
    const db = tinyDb();
    db.prepare("INSERT INTO cards VALUES ('1','MAMO-DE020','DE','Ultra Rare',?,?,0)").run(c.card.price, c.card.price_first_ed);
    const ins = db.prepare("INSERT INTO card_copies VALUES (?,'1','MAMO-DE020','DE','Ultra Rare',?,?,0)");
    let n = 0;
    for (const cp of c.copies) for (let i = 0; i < (cp.count || 1); i++) ins.run(`k${n++}`, cp.edition, cp.condition);
    assert.strictEqual(totalValue(db), c.value, c.name);
  }
});
```

(b) In `desktop/electron/copies-location.test.cjs` oben ergänzen:
```js
const fs = require('fs');
const path = require('path');
const FIRST_ED = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'valuation', 'first-ed.json'), 'utf8'));
```
und nach dem Test `listContainers zaehlt nur lebende Exemplare und ueberspringt geloeschte Behaelter` einfügen:
```js
test('listContainers bewertet 1st-Ed-Exemplare mit price_first_ed (Fixture valueOf)', () => {
  for (const c of FIRST_ED.valueOf) {
    const db = freshDb();
    addContainer(db, 'c1', 'Blau');
    // Erst den Preis (der Trigger rechnet price_first_ed aus dem leeren Faktor = NULL), dann price_first_ed
    // direkt: ein UPDATE nur dieser Spalte loest den 1st-Ed-Trigger nicht aus.
    db.prepare("UPDATE cards SET price = ? WHERE id = '46986414'").run(c.card.price);
    db.prepare("UPDATE cards SET price_first_ed = ? WHERE id = '46986414'").run(c.card.price_first_ed);
    const ins = db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition, container_id)
                            VALUES (?, '46986414', 'LOB-DE005', 'DE', 'Common', ?, ?, 'c1')`);
    let n = 0;
    for (const cp of c.copies) for (let i = 0; i < (cp.count || 1); i++) ins.run(`k${n++}`, cp.edition, cp.condition);
    const [row] = copies.listContainers(db);
    assert.strictEqual(row.value, c.value, c.name);
  }
});
```

(c) In `desktop/electron/handlers.test.cjs` am Ende des ersten Tests (nach `assert.deepStrictEqual(rows[0].editions.split(',').sort(), ['first', 'unknown']);`) einfügen:
```js
  // Spec G4 §6: das 1st-Ed-Exemplar (GD) zaehlt mit price_first_ed, die beiden unknown mit price.
  d.prepare("UPDATE cards SET price_first_ed = 20 WHERE id = '1'").run();
  const [fe] = d.prepare(collectionSql()).all({ def_condition: 'NM', def_edition: 'unknown' });
  assert.equal(fe.value, 34, '2 × 10 × 1,0 + 20 × 0,7');
  assert.ok(Math.abs(fe.factor_sum - 2.7) < 1e-9, 'factor_sum bleibt die reine Faktorsumme');
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/valuation.test.cjs electron/copies-location.test.cjs electron/handlers.test.cjs`
Expected: FAIL. `unitPrice is not a function`, `unitPriceCaseSql is not a function`, `valueOf` liefert mit einem Objekt 0, `listContainers`/`collectionSql` liefern Basiswerte (z. B. `35.5 !== 39.75`, `27 !== 34`).

- [ ] **Step 3: `valuation.cjs` umstellen**

`valueOf` ersetzen und `unitPrice`/`unitPriceCaseSql` ergänzen; `totalValue` umstellen. Die Datei lautet danach:
```js
const FACTORS = require('./condition-factors.json');

const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
const EDITIONS = ['first', 'unlimited', 'limited', 'unknown'];

function conditionFactor(code) {
  const f = FACTORS[String(code || '').toUpperCase()];
  return typeof f === 'number' ? f : 1;
}

// Spec G4 §6 — Bewertungsregel: Exemplarwert = Zustandsfaktor x unitPrice(card, copy).
// ZWILLING in vier Fassungen: unitPrice/valueOf hier, unitPriceCaseSql (SQL, unten), desktop/src/utils/valuation.js
// (unitPrice/valueOf) und android/app/src/main/java/com/example/yugiohscanner/cloud/Valuation.kt (unitPrice/valueOf).
// Gemeinsame Fixture: docs/fixtures/valuation/first-ed.json. Wer eine Fassung aendert, aendert alle.
function unitPrice(card, copy) {
  if (copy && copy.edition === 'first' && card && card.price_first_ed != null) return Number(card.price_first_ed);
  return Number(card && card.price) || 0;
}

// copies: [{ edition, condition, count? }] — count defaults to 1.
function valueOf(card, copies) {
  if (!copies || copies.length === 0) return 0;
  let v = 0;
  for (const c of copies) v += unitPrice(card, c) * conditionFactor(c.condition) * (Number(c.count) || 1);
  return Math.round(v * 100) / 100;
}

// SQL CASE expression turning a condition column into its factor (for SUM(unitPrice * factor)).
function factorCaseSql(col) {
  const whens = CONDITIONS.map(c => `WHEN '${c}' THEN ${FACTORS[c]}`).join(' ');
  return `CASE ${col} ${whens} ELSE 1.0 END`;
}

// SQL-Fassung von unitPrice (Zwilling, siehe oben).
function unitPriceCaseSql(cardAlias, copyAlias) {
  return `CASE WHEN ${copyAlias}.edition = 'first' AND ${cardAlias}.price_first_ed IS NOT NULL THEN ${cardAlias}.price_first_ed ELSE COALESCE(${cardAlias}.price, 0) END`;
}

// Live copies of live printings, joined on the 4-column printing key.
const LIVE_JOIN = `FROM card_copies cp JOIN cards c
  ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
  WHERE cp.deleted = 0 AND c.deleted = 0`;

function totalValue(db) {
  const r = db.prepare(`SELECT COALESCE(SUM(${unitPriceCaseSql('c', 'cp')} * ${factorCaseSql('cp.condition')}), 0) AS total ${LIVE_JOIN}`).get();
  return Math.round((r.total || 0) * 100) / 100;
}

function copyCount(db) {
  return db.prepare(`SELECT COUNT(*) AS n ${LIVE_JOIN}`).get().n || 0;
}

module.exports = { FACTORS, CONDITIONS, EDITIONS, conditionFactor, unitPrice, valueOf, factorCaseSql, unitPriceCaseSql, totalValue, copyCount };
```

- [ ] **Step 4: `copies.cjs#listContainers` umstellen**

Import in Zeile 2:
```js
const { CONDITIONS, EDITIONS, conditionFactor, factorCaseSql, unitPriceCaseSql } = require('./valuation.cjs');
```
In `listContainers` die Wert-Zeile ersetzen:
```js
           COALESCE(SUM(${unitPriceCaseSql('c', 'cp')} * ${factorCaseSql('cp.condition')}), 0) AS value
```
Den Kommentar über `listContainers` („Preis x Zustandsfaktor, derselbe Weg wie valuation.cjs#totalValue") ergänzen um: `Seit Spec G4: unitPrice (1st-Ed-Preis fuer edition = 'first') x Zustandsfaktor.`

- [ ] **Step 5: `collection-query.cjs#collectionSql` umstellen**

```js
const { factorCaseSql, unitPriceCaseSql, EDITIONS, CONDITIONS } = require('./valuation.cjs');

// One row per live printing, plus copy-derived value columns. Params: @def_condition, @def_edition.
// Spec G4 §6: value = Summe unitPrice x Zustandsfaktor je lebendem Exemplar (1st-Ed-Preis fuer edition = 'first');
// factor_sum bleibt die reine Faktorsumme.
function collectionSql() {
  const f = factorCaseSql('cp.condition');
  const unit = unitPriceCaseSql('pc', 'cp');
  return `
    SELECT c.*,
      COALESCE(v.factor_sum, 0)            AS factor_sum,
      ROUND(COALESCE(v.value_sum, 0), 2)   AS value,
      COALESCE(v.nonstandard, 0)           AS nonstandard,
      COALESCE(v.conditions, '')           AS conditions,
      COALESCE(v.editions, '')             AS editions
    FROM cards c
    LEFT JOIN (
      SELECT cp.card_id, cp.set_code, cp.language, cp.rarity,
        SUM(${f}) AS factor_sum,
        SUM(${unit} * ${f}) AS value_sum,
        SUM(CASE WHEN cp.condition <> @def_condition OR cp.edition <> @def_edition THEN 1 ELSE 0 END) AS nonstandard,
        GROUP_CONCAT(DISTINCT cp.condition) AS conditions,
        GROUP_CONCAT(DISTINCT cp.edition) AS editions
      FROM card_copies cp
      JOIN cards pc ON pc.id = cp.card_id AND pc.set_code = cp.set_code AND pc.language = cp.language AND pc.rarity = cp.rarity
      WHERE cp.deleted = 0
      GROUP BY cp.card_id, cp.set_code, cp.language, cp.rarity
    ) v ON v.card_id = c.id AND v.set_code = c.set_code AND v.language = c.language AND v.rarity = c.rarity
    WHERE c.quantity > 0 AND c.deleted = 0
    ORDER BY c.created_at DESC`;
}
```
`parseImportCsv` bleibt unverändert.

- [ ] **Step 6: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → alle grün. `portfolio-value.test.cjs` bleibt grün, weil seine Karten `unknown`-Exemplare haben.
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` → alle `PASS`.
Per Grep (lesend) bestätigen, dass kein Aufrufer mehr `valueOf(<Zahl>, …)` aus `valuation.cjs` nutzt: `Grep "valueOf\(" desktop/electron` zeigt nur `valuation.cjs` und `valuation.test.cjs`.

- [ ] **Step 7: Schutz-Nachweis**

In `unitPriceCaseSql` kurz `${copyAlias}.edition = 'first' AND ` entfernen. Dann laufen `Fixture: totalValue (SQL-Fassung)` (Fall „Zustand mal Edition gemischt", `44.38 !== 39.75`) und der `listContainers`-Fixture-Test rot. Zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/valuation.cjs desktop/electron/valuation.test.cjs desktop/electron/copies.cjs desktop/electron/copies-location.test.cjs desktop/electron/collection-query.cjs desktop/electron/handlers.test.cjs
git commit -m "feat(g4): editionsbewusste Bewertung im Hauptprozess und in SQL

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Renderer-Zwilling, Binder-Aufteilung, Binder-Ansicht und Karten-Detail

**Files:**
- Modify: `desktop/src/utils/valuation.js`
- Modify: `desktop/src/utils/valuation.test.mjs`
- Modify: `desktop/src/utils/breakdown.js`
- Modify: `desktop/src/utils/breakdown.test.js`
- Modify: `desktop/src/components/BinderView.jsx`
- Modify: `desktop/src/components/CardDetailPanel.jsx`

**Interfaces:**
- Produces: `unitPrice(card, copy) → number`, `valueOf(card, copies) → number`, `firstEdLine(card) → string | null` in `desktop/src/utils/valuation.js`.
- Consumes (Task 1): Fixture-Abschnitte `unitPrice`, `valueOf`, `line`. Consumes (Task 3): `get-collection` liefert `c.*` mit `price_first_ed` und `cm_first_ed_factor`.

- [ ] **Step 1: Tests schreiben**

(a) `desktop/src/utils/valuation.test.mjs` ersetzen:
```js
import assert from 'node:assert';
import fs from 'node:fs';
import { CONDITIONS, EDITIONS, EDITION_LABELS, conditionFactor, unitPrice, valueOf, firstEdLine, groupCopies } from './valuation.js';

// Spec G4 §6/§7 — ZWILLING: desktop/electron/valuation.test.cjs und android ValuationTest.kt lesen dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(new URL('../../../docs/fixtures/valuation/first-ed.json', import.meta.url), 'utf8'));

assert.deepStrictEqual(CONDITIONS, ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO']);
assert.deepStrictEqual(EDITIONS, ['first', 'unlimited', 'limited', 'unknown']);
assert.equal(EDITION_LABELS.first, '1st Ed');
assert.equal(EDITION_LABELS.unknown, 'Unbek.');
assert.equal(conditionFactor('LP'), 0.5);
assert.equal(valueOf({ price: 4 }, [{ condition: 'NM' }, { condition: 'EX' }]), 7.4);

for (const c of FIX.unitPrice) assert.strictEqual(unitPrice(c.card, c.copy), c.unit, c.name);
for (const c of FIX.valueOf) assert.strictEqual(valueOf(c.card, c.copies), c.value, c.name);
// Intl setzt ein geschuetztes Leerzeichen vor das Euro-Zeichen; die Fixture schreibt ein normales.
for (const c of FIX.line) {
  const got = firstEdLine(c.card);
  assert.strictEqual(got == null ? null : got.replace(/\u00a0/g, ' '), c.line, c.name);
}

const groups = groupCopies([
  { copy_id: 'a', edition: 'unknown', condition: 'NM' },
  { copy_id: 'b', edition: 'first', condition: 'GD' },
  { copy_id: 'c', edition: 'unknown', condition: 'NM' },
]);
assert.deepStrictEqual(groups, [
  { edition: 'first', condition: 'GD', count: 1 },
  { edition: 'unknown', condition: 'NM', count: 2 },
]);
console.log('valuation renderer test: PASS');
```

(b) In `desktop/src/utils/breakdown.test.js` am Ende anhängen:
```js
test('Binder: 1st-Ed-Exemplar zählt mit price_first_ed', () => {
  const cardsFe = [{ id: '5', set_code: 'MAMO-DE020', language: 'DE', rarity: 'Ultra Rare', type: 'Effect Monster', price: 73.85, price_first_ed: 77.87, quantity: 2, value: 0 }];
  const copiesFe = [
    { card_id: '5', set_code: 'MAMO-DE020', language: 'DE', rarity: 'Ultra Rare', edition: 'first', condition: 'NM', container_id: 'b1' },
    { card_id: '5', set_code: 'MAMO-DE020', language: 'DE', rarity: 'Ultra Rare', edition: 'unknown', condition: 'NM', container_id: 'b1' },
  ];
  assert.deepEqual(valueBreakdown({ cards: cardsFe, copies: copiesFe, containers, dimension: 'binder' }), [
    { label: 'Ordner Blau', count: 2, value: 151.72 },
  ]);
});
```
(77,87 + 73,85 = 151,72.)

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `node --test src/utils/valuation.test.mjs src/utils/breakdown.test.js`
Expected: FAIL. `does not provide an export named 'unitPrice'` bzw. im Binder-Test `147.7 !== 151.72`.

- [ ] **Step 3: `src/utils/valuation.js` umstellen**

```js
import FACTORS from '../../electron/condition-factors.json' with { type: 'json' };
import { fmtEUR, fmtNum } from './format.js';

export const CONDITIONS = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
export const EDITIONS = ['first', 'unlimited', 'limited', 'unknown'];
export const EDITION_LABELS = { first: '1st Ed', unlimited: 'Unlimited', limited: 'Limited', unknown: 'Unbek.' };

export function conditionFactor(code) {
  const f = FACTORS[String(code || '').toUpperCase()];
  return typeof f === 'number' ? f : 1;
}

// Spec G4 §6 — ZWILLING: desktop/electron/valuation.cjs (unitPrice/valueOf/unitPriceCaseSql) und
// android/app/src/main/java/com/example/yugiohscanner/cloud/Valuation.kt (unitPrice/valueOf).
// Gemeinsame Fixture: docs/fixtures/valuation/first-ed.json. Wer eine Fassung aendert, aendert alle.
export function unitPrice(card, copy) {
  if (copy && copy.edition === 'first' && card && card.price_first_ed != null) return Number(card.price_first_ed);
  return Number(card && card.price) || 0;
}

// copies: [{ edition, condition, count? }] — count defaults to 1.
export function valueOf(card, copies) {
  if (!copies || copies.length === 0) return 0;
  let v = 0;
  for (const c of copies) v += unitPrice(card, c) * conditionFactor(c.condition) * (Number(c.count) || 1);
  return Math.round(v * 100) / 100;
}

// Spec G4 §7 — Preiszeile im Karten-Detail. ZWILLING: Valuation.firstEdLine (Kotlin), Fixture-Abschnitt line.
export function firstEdLine(card) {
  if (!card || card.price_first_ed == null) return null;
  const line = `Basis ${fmtEUR(card.price)} · 1st Ed ${fmtEUR(card.price_first_ed)}`;
  return card.cm_first_ed_factor == null ? line : `${line} (×${fmtNum(card.cm_first_ed_factor)})`;
}

// [{edition, condition, ...}] -> [{edition, condition, count}] in display order.
export function groupCopies(copies) {
  const m = new Map();
  for (const c of copies || []) {
    const key = `${c.edition || 'unknown'}|${c.condition || 'NM'}`;
    m.set(key, (m.get(key) || 0) + (Number(c.count) || 1));
  }
  return Array.from(m.entries())
    .map(([k, count]) => { const [edition, condition] = k.split('|'); return { edition, condition, count }; })
    .sort((a, b) => (EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition))
      || (CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition)));
}
```

- [ ] **Step 4: `src/utils/breakdown.js` umstellen**

Import:
```js
import { conditionFactor, unitPrice } from './valuation.js';
```
Den Kopfkommentar ergänzen: `// Spec G4: die Binder-Dimension nutzt unitPrice (1st-Ed-Preis fuer edition = 'first').`
Den Binder-Zweig ersetzen:
```js
  if (dimension === 'binder') {
    const byKey = new Map(cards.map((c) => [keyOf(c.id, c.set_code, c.language, c.rarity), c]));
    const names = new Map(containers.map((c) => [c.container_id, c.name]));
    for (const cp of copies) {
      const label = (cp.container_id && names.get(cp.container_id)) || UNSORTED_LABEL;
      add(label, 1, unitPrice(byKey.get(keyOf(cp.card_id, cp.set_code, cp.language, cp.rarity)), cp) * conditionFactor(cp.condition));
    }
    return finish(m);
  }
```
Per Grep (lesend) prüfen, woher der Binder-Aufrufer von `valueBreakdown` seine `copies` bekommt. Liefern sie `edition` nicht mit (z. B. über `listAllCopies`, das `edition` enthält), ist das im Bericht zu vermerken.

- [ ] **Step 5: `BinderView.jsx` umstellen**

Import (Zeile 9):
```js
import { EDITION_LABELS, conditionFactor, unitPrice } from '../utils/valuation';
```
`valueOf` (Zeile 117–120) ersetzen:
```js
  // Spec G4 §6: unitPrice nimmt fuer edition = 'first' den 1st-Ed-Preis der Druckvariante.
  const valueOf = (list) => list.reduce(
    (sum, cp) => sum + unitPrice(cardsByKey.get(copyKey(cp)), cp) * conditionFactor(cp.condition),
    0,
  );
```

- [ ] **Step 6: `CardDetailPanel.jsx` umstellen**

Import (Zeile 9):
```js
import { groupCopies, valueOf, firstEdLine, CONDITIONS, EDITIONS, EDITION_LABELS } from '../utils/valuation';
```
Preiszeile (Zeile 255) ersetzen:
```jsx
                              <span className="text-xs text-space-violet">{firstEdLine(variant) ?? fmtEUR(variant.price || 0)}</span>
```
Gruppenwert (Zeile 301) ersetzen:
```jsx
                                  <span className="ml-auto font-mono text-xs text-gold">{fmtEUR(valueOf(variant, [g]))}</span>
```

- [ ] **Step 7: Tests, Lint, Build**

Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → alle grün.
Run (in `desktop/`): `npx eslint .` → genau `5 errors`.
Run (in `desktop/`): `npx vite build` → erfolgreich.
Per Grep (lesend) bestätigen: `Grep "valueOf\(" desktop/src` zeigt keinen Aufruf mehr mit einem Preis als erstem Argument.

- [ ] **Step 8: Schutz-Nachweis**

In `src/utils/valuation.js#unitPrice` kurz `copy.edition === 'first' && ` entfernen → Fixture-Fall „unlimited ignoriert price_first_ed" scheitert (`77.87 !== 73.85`). Zitieren, zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/utils/valuation.js desktop/src/utils/valuation.test.mjs desktop/src/utils/breakdown.js desktop/src/utils/breakdown.test.js desktop/src/components/BinderView.jsx desktop/src/components/CardDetailPanel.jsx
git commit -m "feat(g4): Renderer bewertet 1st Ed mit eigenem Preis und zeigt die Preiszeile

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: Reine Scraper-Helfer und gemeinsame Versionszeilen-Auswahl

**Files:**
- Modify: `desktop/electron/cardmarket-parse.cjs`
- Modify: `desktop/electron/cardmarket-parse.test.cjs`
- Modify: `desktop/electron/cardmarket-scraper.cjs`

**Cardmarket-Fakten (Messversuch 2026-09-15, Spec §1):**
- Versions-Seite `https://www.cardmarket.com/en/YuGiOh/Cards/{Name}/Versions`. Jede Printing-Spalte ist `#ReprintSection .card-column` und trägt den Produkt-Link `a[href*="/Products/Singles/"]` mit der Form `/en/YuGiOh/Products/Singles/{Expansion}/{Karte}[-V{n}-{Rarity}]`.
- Auf der Produktseite hat der Infokasten `.info-list-container` `dt`/`dd`-Paare. Das Label heißt „From" (en) bzw. „Ab" (de), der Wert sieht aus wie `58,00 €` oder `1.234,56 €`.
- Filter `?isFirstEd=Y`: Die Angebote werden gefiltert, und „Ab" folgt dem Filter; Trend und Durchschnitte bleiben produktweit.
- Nach etwa acht schnellen Aufrufen kommt die Cloudflare-Prüfung. Die Erkennung (`looksLikeChallenge`/`loadPage`) existiert bereits.

**Interfaces:**
- Produces (für Task 6): `selectVersionRow(rows, printing, lookupSetName) → Promise<row|null>` (`printing` hat `set_code` und `rarity`; `lookupSetName` ist eine async-Funktion und wird nur ohne Code-Treffer gerufen); `productUrl(href) → string|null` (absolut, ohne Query); `firstEdUrl(url) → string`; `parseFromPrice(pairs) → number|null` (`pairs` = `[{ label, value }]`); `firstEdFactor(fromAll, fromFirst) → { write: boolean, factor: number|null }`. `EXTRACT_JS`-Zeilen haben zusätzlich `href`.
- Consumes (vorhanden): `matchRow`, `normName`, `rarityKey` in `cardmarket-parse.cjs`.

- [ ] **Step 1: Tests schreiben**

`desktop/electron/cardmarket-parse.test.cjs`: Die `require`-Zeile ersetzen durch
```js
const { normRarity, normName, matchRow, selectVersionRow, productUrl, firstEdUrl, parseFromPrice, firstEdFactor } = require('./cardmarket-parse.cjs');
```
und am Dateiende anhängen:
```js
// --- Spec G4 §4: gemeinsame Versionszeilen-Auswahl (Basis- und 1st-Ed-Durchgang) ---
const noLookup = async () => { throw new Error('lookupSetName darf bei Code-Treffer nicht gerufen werden'); };

test('selectVersionRow: eine Zeile im Set ohne Rarity-Label ist eindeutig', async () => {
  const v = [{ expansion: 'Maze of Memories', code: 'MAMO', rarity: '', trend: 55, href: '/a' }];
  const hit = await selectVersionRow(v, { set_code: 'MAMO-DE020', rarity: 'Ultra Rare' }, noLookup);
  assert.equal(hit.href, '/a');
});

test('selectVersionRow: mehrere Zeilen im Set -> Rarity, bei Gleichstand die guenstigste', async () => {
  const v = [
    { expansion: 'X', code: 'RA01', rarity: 'Secret Rare', trend: 9, href: '/s1' },
    { expansion: 'X', code: 'RA01', rarity: 'Secret Rare', trend: 4, href: '/s2' },
    { expansion: 'X', code: 'RA01', rarity: 'Ultra Rare', trend: 2, href: '/u' },
  ];
  assert.equal((await selectVersionRow(v, { set_code: 'RA01-DE001', rarity: 'Secret Rare' }, noLookup)).href, '/s2');
  assert.equal((await selectVersionRow(v, { set_code: 'RA01-DE001', rarity: 'Ultra Rare' }, noLookup)).href, '/u');
});

test('selectVersionRow: ohne Code-Treffer ueber den Set-Namen (lookup wird gerufen)', async () => {
  let called = 0;
  const hit = await selectVersionRow(rows, { set_code: 'SDWL-DE001', rarity: 'Secret Rare' },
    async () => { called++; return 'Structure Deck: Wave of Light'; });
  assert.equal(called, 1);
  assert.equal(hit.trend, 1.20);
});

test('selectVersionRow: kein Treffer -> null', async () => {
  assert.equal(await selectVersionRow(rows, { set_code: 'ZZZ-DE001', rarity: 'Ghost Rare' }, async () => null), null);
});

test('productUrl: relativ -> absolut ohne Query, fremde oder fehlende Links -> null', () => {
  assert.equal(productUrl('/en/YuGiOh/Products/Singles/Maze-of-Memories/Card-V1-Ultra-Rare?language=3'),
    'https://www.cardmarket.com/en/YuGiOh/Products/Singles/Maze-of-Memories/Card-V1-Ultra-Rare');
  assert.equal(productUrl('https://www.cardmarket.com/en/YuGiOh/Products/Singles/X/Y'), 'https://www.cardmarket.com/en/YuGiOh/Products/Singles/X/Y');
  assert.equal(productUrl('/en/YuGiOh/Cards/Y/Versions'), null);
  assert.equal(productUrl('https://example.com/Products/Singles/X/Y'), null);
  assert.equal(productUrl(null), null);
  assert.equal(firstEdUrl('https://www.cardmarket.com/en/YuGiOh/Products/Singles/X/Y'), 'https://www.cardmarket.com/en/YuGiOh/Products/Singles/X/Y?isFirstEd=Y');
});

test('parseFromPrice: From/Ab, Tausenderpunkt, fehlend, andere Labels ignoriert', () => {
  assert.equal(parseFromPrice([{ label: 'Available items', value: '50' }, { label: 'From', value: '58,00 €' }, { label: 'Price Trend', value: '72,33 €' }]), 58);
  assert.equal(parseFromPrice([{ label: 'Ab', value: '1.234,56\u00a0€' }]), 1234.56);
  assert.equal(parseFromPrice([{ label: 'Ab:', value: '0,15 €' }]), 0.15);
  assert.equal(parseFromPrice([{ label: 'Price Trend', value: '72,33 €' }]), null);
  assert.equal(parseFromPrice([{ label: 'From', value: 'N/A' }]), null);
  assert.equal(parseFromPrice([]), null);
  assert.equal(parseFromPrice(null), null);
});

test('firstEdFactor: Untergrenze 1, 4 Stellen, fromAll 0/NULL, fromFirst NULL', () => {
  assert.deepStrictEqual(firstEdFactor(55, 58), { write: true, factor: 1.0545 });
  assert.deepStrictEqual(firstEdFactor(3, 4), { write: true, factor: 1.3333 });
  assert.deepStrictEqual(firstEdFactor(58, 55), { write: true, factor: 1 }, 'Ausreisser nach unten wird auf 1 begrenzt');
  assert.deepStrictEqual(firstEdFactor(0, 58), { write: false, factor: null });
  assert.deepStrictEqual(firstEdFactor(null, 58), { write: false, factor: null });
  assert.deepStrictEqual(firstEdFactor(55, null), { write: true, factor: null }, 'kein Angebot mit Filter');
  assert.deepStrictEqual(firstEdFactor(55, 0), { write: true, factor: null });
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-parse.test.cjs`
Expected: FAIL mit `selectVersionRow is not a function`; die fünf bestehenden `matchRow`-Tests bleiben grün.

- [ ] **Step 3: Helfer in `cardmarket-parse.cjs` ergänzen**

Vor `module.exports` einfügen:
```js
// Spec G4 §4 — gemeinsame Zeilenauswahl fuer Basis- und 1st-Ed-Durchgang (wortgleich aus runCardmarketScrape
// gezogen). Primaer Set-Code-Praefix <-> Cardmarket-Symbol ("25LP-DE085" -> "25LP"); eine Zeile im Set ist
// eindeutig (Cardmarket laesst dann die Rarity weg); mehrere -> Rarity, bei Gleichstand die guenstigste.
// Sonst matchRow ueber den Set-Namen; lookupSetName (async) wird NUR dann gerufen.
async function selectVersionRow(rows, printing, lookupSetName) {
  const list = rows || [];
  const codePrefix = String(printing.set_code || '').split('-')[0];
  const wantRar = rarityKey(printing.rarity), wantCode = normName(codePrefix);
  const codeRows = list.filter(r => r.code && r.trend != null && normName(r.code) === wantCode);
  let hit = null;
  if (codeRows.length === 1) {
    hit = codeRows[0];
  } else if (codeRows.length > 1) {
    const rarHits = codeRows.filter(r => rarityKey(r.rarity) === wantRar);
    if (rarHits.length) hit = rarHits.reduce((a, b) => (b.trend < a.trend ? b : a));
  }
  if (!hit) {
    const setName = lookupSetName ? await lookupSetName() : null;
    hit = setName ? matchRow(list, setName, printing.rarity) : null;
  }
  return hit;
}

const CM_ORIGIN = 'https://www.cardmarket.com';

// Produkt-Link einer Versionszeile -> absolute Produkt-URL ohne Query; nur Singles auf cardmarket.com.
function productUrl(href) {
  if (!href) return null;
  let u;
  try { u = new URL(href, CM_ORIGIN); } catch { return null; }
  if (u.origin !== CM_ORIGIN || !u.pathname.includes('/Products/Singles/')) return null;
  return `${u.origin}${u.pathname}`;
}

const firstEdUrl = (url) => `${url}?isFirstEd=Y`;

// "58,00 €" / "1.234,56 €" -> Zahl; alles andere -> null.
function parseEuro(text) {
  const m = String(text || '').replace(/\s/g, '').match(/(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})/);
  return m ? Number(`${m[1].replace(/\./g, '')}.${m[2]}`) : null;
}

// Ab-Preis aus den dt/dd-Paaren des Infokastens (.info-list-container); Label "From" (en) oder "Ab" (de).
function parseFromPrice(pairs) {
  for (const p of pairs || []) {
    if (p && /^(from|ab):?$/i.test(String(p.label || '').trim())) return parseEuro(p.value);
  }
  return null;
}

// Spec G4 §3: factor = max(1, round4(fromFirst / fromAll)). fromAll fehlt/0 -> nichts schreiben;
// fromFirst fehlt/0 -> Faktor NULL schreiben (kein Angebot mit Filter).
function firstEdFactor(fromAll, fromFirst) {
  if (!(Number(fromAll) > 0)) return { write: false, factor: null };
  if (!(Number(fromFirst) > 0)) return { write: true, factor: null };
  return { write: true, factor: Math.max(1, Math.round((Number(fromFirst) / Number(fromAll)) * 10000) / 10000) };
}
```
Die Exportzeile ersetzen:
```js
module.exports = { normRarity, normName, rarityKey, rarityRank, RARITY_SYNONYMS, matchRow, selectVersionRow, productUrl, firstEdUrl, parseFromPrice, firstEdFactor };
```

- [ ] **Step 4: `cardmarket-scraper.cjs` — `href` in `EXTRACT_JS`, Basis-Durchgang über den Helfer**

(a) Import in Zeile 6:
```js
const { normName, rarityKey, rarityRank, selectVersionRow } = require('./cardmarket-parse.cjs');
```
Nach der Umstellung ist `matchRow` hier ungenutzt. Ob `normName`/`rarityKey` im Rest der Datei noch vorkommen, per Grep prüfen und nur Genutztes importieren.

(b) In `EXTRACT_JS` die Zeile `    if (!col.querySelector('a[href*="/Products/Singles/"]')) return;` ersetzen durch:
```js
    const link = col.querySelector('a[href*="/Products/Singles/"]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
```
und `rows.push({ expansion: exp, code, rarity, trend: price, imgSrc });` durch:
```js
    if (rarity || code) rows.push({ expansion: exp, code, rarity, trend: price, imgSrc, href });
```
(Die bisherige Zeile beginnt bereits mit `if (rarity || code)`; nur das Objekt wächst um `href`.) Den Kommentar über `EXTRACT_JS` ergänzen: `// Spec G4: href = Produkt-Link der Printing-Spalte (/Products/Singles/{Expansion}/{Karte}[-V{n}-{Rarity}]).`

(c) In `runCardmarketScrape` den Block von `const codePrefix = (p.set_code || '').split('-')[0];` bis einschließlich der schließenden Klammer von `if (!hit) { … }` ersetzen durch:
```js
          const hit = await selectVersionRow(rows, p, () => setNameFor(cards[i].id, p.set_code));
```
Der Kommentar darüber bleibt stehen. Der Rest (`if (hit && hit.trend != null) { … } else { … }`) bleibt unverändert.

- [ ] **Step 5: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → alle grün, darunter die bestehenden `matchRow`-Fälle.
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "console.log(Object.keys(require('./electron/cardmarket-scraper.cjs')))"` → `[ 'runCardmarketScrape' ]`. Das Modul lädt ohne Syntaxfehler.

- [ ] **Step 6: Schutz-Nachweis**

In `firstEdFactor` kurz `Math.max(1, …)` entfernen (nur `Math.round(...)/10000` zurückgeben) → Fall „Ausreisser nach unten wird auf 1 begrenzt" scheitert mit `0.9483 !== 1`. Zitieren, zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/cardmarket-parse.cjs desktop/electron/cardmarket-parse.test.cjs desktop/electron/cardmarket-scraper.cjs
git commit -m "feat(g4): reine Helfer fuer Produkt-Link, Ab-Preis und 1st-Ed-Faktor; gemeinsame Zeilenauswahl

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Durchgang „Erste Auflage" mit Kandidatenauswahl, Poller und Knopf

**Files:**
- Modify: `desktop/electron/cardmarket-scraper.cjs`
- Create: `desktop/electron/cardmarket-first-ed.test.cjs`
- Modify: `desktop/electron/main.cjs`

**Interfaces:**
- Produces: `firstEdCandidates(db, { minRank = 1, force = false, nowMs = Date.now(), limit = Infinity }) → [{ id, name, set_code, language, rarity, cm_first_ed_updated_at }]`; `runFirstEdPass(db, { minRank, force, maxCards, headless, onChallenge, shouldAbort, onProgress, deps }) → Promise<{ candidates, updated, noOffers, skipped, errors }>`. `deps` ist optional: `{ makeWindow(), loadPage(win, url, onChallenge, headless) → bool, readRows(win) → rows, readInfoPairs(win) → pairs, sleep() → Promise, setNameFor(id, setCode), cardName(candidate) }`. Die IPC-Antwort `scrape-cardmarket-prices` bekommt zusätzlich `firstEd`.
- Consumes (Task 1): Trigger für `price_first_ed`. Consumes (Task 5): `selectVersionRow`, `productUrl`, `firstEdUrl`, `parseFromPrice`, `firstEdFactor`, `EXTRACT_JS` mit `href`. Consumes (vorhanden): `rarityRank`, `resolveUrl`, `loadPage`, `makeWindow`, `setNameFor`, `fetchCardData`, `recordPortfolioValue`, `portfolioTotals`, `getSetting`.

- [ ] **Step 1: Tests schreiben**

`desktop/electron/cardmarket-first-ed.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { addCopies } = require('./copies.cjs');
const { firstEdCandidates, runFirstEdPass } = require('./cardmarket-scraper.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (id TEXT, name TEXT, quantity INTEGER DEFAULT 0, rarity TEXT DEFAULT 'Unknown', set_code TEXT,
             price REAL, language TEXT DEFAULT 'DE', price_locked INTEGER DEFAULT 0, cm_product_id INTEGER,
             updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, deleted INTEGER DEFAULT 0,
             PRIMARY KEY (id, set_code, language, rarity));
           CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  return db;
}

function printing(db, { id, set_code, rarity, name = 'Test Card', price = 10, locked = 0, pid = null, ts = null }, copies) {
  db.prepare(`INSERT INTO cards (id, name, set_code, language, rarity, price, price_locked, cm_product_id, cm_first_ed_updated_at)
              VALUES (?, ?, ?, 'DE', ?, ?, ?, ?, ?)`).run(id, name, set_code, rarity, price, locked, pid, ts);
  const P = { id, set_code, language: 'DE', rarity };
  for (const c of copies) addCopies(db, P, { edition: c.edition, condition: 'NM', count: 1 });
  return P;
}

const NOW = Date.parse('2026-09-15T12:00:00Z');

function candidateDb() {
  const db = freshDb();
  printing(db, { id: '1', set_code: 'LOB-DE001', rarity: 'Ultra Rare' }, [{ edition: 'first' }]);
  printing(db, { id: '2', set_code: 'LOB-DE002', rarity: 'Ultra Rare' }, [{ edition: 'unknown' }]);
  printing(db, { id: '3', set_code: 'LOB-DE003', rarity: 'Ultra Rare' }, [{ edition: 'first' }, { edition: 'unknown' }]);
  db.prepare("UPDATE card_copies SET deleted = 1 WHERE card_id = '3' AND edition = 'first'").run();
  printing(db, { id: '4', set_code: 'LOB-DE004', rarity: 'Ultra Rare', locked: 2 }, [{ edition: 'first' }]);
  printing(db, { id: '5', set_code: 'LOB-DE005', rarity: 'Common' }, [{ edition: 'first' }]);
  printing(db, { id: '6', set_code: 'LOB-DE006', rarity: 'Ultra Rare', ts: '2026-09-13 12:00:00' }, [{ edition: 'first' }]);
  printing(db, { id: '7', set_code: 'LOB-DE007', rarity: 'Secret Rare', pid: 904608, ts: '2026-09-05 12:00:00' }, [{ edition: 'first' }]);
  return db;
}
const ids = (list) => list.map((c) => c.id);

test('Kandidaten: Edition first, Schwelle, price_locked 2, 7-Tage-Frist, Bulk zählt, gelöschte Exemplare nicht, Reihenfolge', () => {
  const db = candidateDb();
  assert.deepEqual(ids(firstEdCandidates(db, { minRank: 4, nowMs: NOW })), ['1', '7']);
});

test('Kandidaten: force ignoriert die Frist', () => {
  assert.deepEqual(ids(firstEdCandidates(candidateDb(), { minRank: 4, force: true, nowMs: NOW })), ['1', '7', '6']);
});

test('Kandidaten: Schwelle 1 nimmt Common mit, gleiche Zeit nach Schlüssel', () => {
  assert.deepEqual(ids(firstEdCandidates(candidateDb(), { minRank: 1, nowMs: NOW })), ['1', '5', '7']);
});

test('Kandidaten: limit', () => {
  assert.deepEqual(ids(firstEdCandidates(candidateDb(), { minRank: 1, nowMs: NOW, limit: 1 })), ['1']);
});

// --- Durchgang mit gestubbtem Fenster ---
const VERSIONS = 'https://www.cardmarket.com/en/YuGiOh/Cards/Test-Card/Versions';
const PRODUCT = 'https://www.cardmarket.com/en/YuGiOh/Products/Singles/Maze-of-Memories/Test-Card-V1-Ultra-Rare';
const FIRST = `${PRODUCT}?isFirstEd=Y`;
const ROWS = [{ expansion: 'Maze of Memories', code: 'MAMO', rarity: '', trend: 55, imgSrc: '', href: '/en/YuGiOh/Products/Singles/Maze-of-Memories/Test-Card-V1-Ultra-Rare' }];

function stub(pages, { challenge = [] } = {}) {
  const visited = [];
  return {
    visited,
    deps: {
      makeWindow: async () => ({ url: null, destroy() {} }),
      loadPage: async (win, url) => { visited.push(url); win.url = url; return !challenge.includes(url); },
      readRows: async (win) => (pages[win.url] && pages[win.url].rows) || [],
      readInfoPairs: async (win) => (pages[win.url] && pages[win.url].pairs) || [],
      sleep: async () => {},
      setNameFor: async () => null,
      cardName: async (c) => c.name,
    },
  };
}
const MAMO = (db) => db.prepare("SELECT price_first_ed AS pfe, cm_first_ed_factor AS f, cm_first_ed_updated_at AS ts FROM cards WHERE id = 'm'").get();
const mamoDb = () => {
  const db = freshDb();
  printing(db, { id: 'm', set_code: 'MAMO-DE020', rarity: 'Ultra Rare', price: 73.85 }, [{ edition: 'first' }]);
  return db;
};

test('Durchgang: Treffer schreibt Faktor und Zeitstempel, Trigger setzt price_first_ed, keine price_history', async () => {
  const db = mamoDb();
  const s = stub({
    [VERSIONS]: { rows: ROWS },
    [PRODUCT]: { pairs: [{ label: 'From', value: '55,00 €' }, { label: 'Price Trend', value: '72,33 €' }] },
    [FIRST]: { pairs: [{ label: 'From', value: '58,00 €' }] },
  });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PRODUCT, FIRST]);
  assert.deepEqual({ updated: out.updated, noOffers: out.noOffers, skipped: out.skipped, errors: out.errors }, { updated: 1, noOffers: 0, skipped: 0, errors: 0 });
  const r = MAMO(db);
  assert.equal(r.f, 1.0545);
  assert.equal(r.pfe, 77.87);
  assert.ok(r.ts, 'cm_first_ed_updated_at gesetzt');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM price_history').get().n, 0);
});

test('Durchgang: kein Angebot mit Filter -> Faktor NULL, price_first_ed NULL, Zeitstempel gesetzt', async () => {
  const db = mamoDb();
  db.prepare("UPDATE cards SET cm_first_ed_factor = 1.2 WHERE id = 'm'").run();
  assert.equal(MAMO(db).pfe, 88.62);
  const s = stub({
    [VERSIONS]: { rows: ROWS },
    [PRODUCT]: { pairs: [{ label: 'From', value: '55,00 €' }] },
    [FIRST]: { pairs: [{ label: 'From', value: 'N/A' }] },
  });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.equal(out.updated, 1);
  assert.equal(out.noOffers, 1);
  const r = MAMO(db);
  assert.equal(r.f, null);
  assert.equal(r.pfe, null);
  assert.ok(r.ts);
});

test('Durchgang: Cloudflare-Pruefung auf der Produktseite -> nichts geschrieben', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS } }, { challenge: [PRODUCT] });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PRODUCT]);
  assert.equal(out.updated, 0);
  assert.equal(out.skipped, 1);
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});

test('Durchgang: fromAll fehlt -> gefilterte Seite nicht geladen, nichts geschrieben', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: ROWS }, [PRODUCT]: { pairs: [] } });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS, PRODUCT]);
  assert.equal(out.skipped, 1);
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});

test('Durchgang: kein Produkt-Link oder keine Zeile -> nichts geschrieben', async () => {
  const db = mamoDb();
  const s = stub({ [VERSIONS]: { rows: [{ ...ROWS[0], href: '' }] } });
  const out = await runFirstEdPass(db, { force: true, deps: s.deps });
  assert.deepEqual(s.visited, [VERSIONS]);
  assert.equal(out.skipped, 1);
  assert.deepEqual(MAMO(db), { pfe: null, f: null, ts: null });
});

test('Durchgang: maxCards begrenzt die Kandidaten (Poller 2)', async () => {
  const db = freshDb();
  for (const id of ['a', 'b', 'c']) printing(db, { id, set_code: `MAMO-DE02${id === 'a' ? 0 : id === 'b' ? 1 : 2}`, rarity: 'Ultra Rare' }, [{ edition: 'first' }]);
  const s = stub({});
  const out = await runFirstEdPass(db, { force: true, maxCards: 2, deps: s.deps });
  assert.equal(out.candidates, 2);
  assert.equal(s.visited.length, 2, 'je Kandidat nur die Versions-Seite (ohne Zeilen)');
});
```
(73,85 × 1,2 = 88,62, gemessen in SQLite.)

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-first-ed.test.cjs`
Expected: FAIL mit `firstEdCandidates is not a function`.

- [ ] **Step 3: `cardmarket-scraper.cjs` — Kandidaten und Durchgang**

(a) Import in Zeile 6 erweitern:
```js
const { rarityRank, selectVersionRow, productUrl, firstEdUrl, parseFromPrice, firstEdFactor } = require('./cardmarket-parse.cjs');
```
Weitere in Task 5 genutzte Namen (`normName`, `rarityKey`) behalten, falls noch verwendet.

(b) Nach `EXTRACT_JS` einfügen:
```js
// Spec G4 §4 — dt/dd-Paare des Infokastens einer Produktseite; die Auswertung (Label "From"/"Ab") macht
// der reine Parser parseFromPrice in cardmarket-parse.cjs.
const INFO_PAIRS_JS = `(() => {
  const out = [];
  document.querySelectorAll('.info-list-container dt').forEach(dt => {
    const dd = dt.nextElementSibling;
    if (dd && dd.tagName === 'DD') out.push({ label: (dt.textContent || '').trim(), value: (dd.textContent || '').trim() });
  });
  return out;
})()`;
```

(c) Vor `// Set NAME for a (passcode, set_code) …` einfügen:
```js
// Spec G4 §4 — Kandidaten des 1st-Ed-Durchgangs: Printings mit mindestens einem lebenden Exemplar edition = 'first',
// Rarity ab minRank, nicht manuell gesperrt (price_locked 2), 1st-Ed-Stand aelter als 7 Tage (force ignoriert die Frist),
// unabhaengig von cm_product_id (Bulk-Printings zaehlen). Aeltester Stand zuerst.
function firstEdCandidates(db, { minRank = 1, force = false, nowMs = Date.now(), limit = Infinity } = {}) {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.set_code, c.language, c.rarity, c.cm_first_ed_updated_at
      FROM cards c
     WHERE c.deleted = 0 AND COALESCE(c.price_locked, 0) != 2
       AND EXISTS (SELECT 1 FROM card_copies cp
                    WHERE cp.card_id = c.id AND cp.set_code = c.set_code AND cp.language = c.language
                      AND cp.rarity = c.rarity AND cp.deleted = 0 AND cp.edition = 'first')
     ORDER BY COALESCE(c.cm_first_ed_updated_at, '1970-01-01') ASC, c.id, c.set_code, c.language, c.rarity`).all();
  return rows
    .filter(r => rarityRank(r.rarity) >= minRank
      && (force || !r.cm_first_ed_updated_at || (nowMs - new Date(r.cm_first_ed_updated_at + 'Z').getTime()) > FRESH_MS))
    .slice(0, limit);
}

// Spec G4 §4 — zweiter Durchgang: je Kandidat Versions-Seite (Zeile + Produkt-Link), Produktseite ohne Filter
// (fromAll) und mit ?isFirstEd=Y (fromFirst). Schreibt nur cm_first_ed_factor + cm_first_ed_updated_at;
// price_first_ed setzt der Trigger (copies-schema.cjs). Keine price_history-Zeile. Challenge, keine Zeile,
// kein Link oder fehlendes fromAll: nichts schreiben, der naechste Lauf versucht es wieder.
// `deps` ersetzt im Test Fenster, Netz und Pausen.
async function runFirstEdPass(db, { minRank = 1, force = false, maxCards = Infinity, headless = false, onChallenge, shouldAbort, onProgress, deps = {} } = {}) {
  const d = {
    makeWindow,
    loadPage,
    readRows: (win) => win.webContents.executeJavaScript(EXTRACT_JS).catch(() => []),
    readInfoPairs: (win) => win.webContents.executeJavaScript(INFO_PAIRS_JS).catch(() => []),
    sleep: () => sleep(DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS)),
    setNameFor,
    cardName: async (c) => c.name || (await fetchCardData(c.id))?.data?.[0]?.name,
    ...deps,
  };
  const list = firstEdCandidates(db, { minRank, force, nowMs: Date.now(), limit: maxCards });
  const out = { candidates: list.length, updated: 0, noOffers: 0, skipped: 0, errors: 0 };
  if (list.length === 0) return out;
  const write = db.prepare('UPDATE cards SET cm_first_ed_factor = ?, cm_first_ed_updated_at = CURRENT_TIMESTAMP WHERE id = ? AND set_code = ? AND language = ? AND rarity = ?');
  const win = await d.makeWindow();
  try {
    for (let i = 0; i < list.length; i++) {
      if (shouldAbort && shouldAbort()) break;
      const p = list[i];
      onProgress && onProgress({ current: i + 1, total: list.length, name: p.name });
      try {
        const name = await d.cardName(p);
        const versionsUrl = name ? resolveUrl(name) : null;
        if (!versionsUrl || !(await d.loadPage(win, versionsUrl, onChallenge, headless))) { out.skipped++; continue; }
        const hit = await selectVersionRow(await d.readRows(win), p, () => d.setNameFor(p.id, p.set_code));
        const product = hit ? productUrl(hit.href) : null;
        if (!product) { out.skipped++; continue; }
        await d.sleep();
        if (!(await d.loadPage(win, product, onChallenge, headless))) { out.skipped++; continue; }
        const fromAll = parseFromPrice(await d.readInfoPairs(win));
        if (!(fromAll > 0)) { out.skipped++; continue; }
        await d.sleep();
        if (!(await d.loadPage(win, firstEdUrl(product), onChallenge, headless))) { out.skipped++; continue; }
        const { write: ok, factor } = firstEdFactor(fromAll, parseFromPrice(await d.readInfoPairs(win)));
        if (!ok) { out.skipped++; continue; }
        write.run(factor, String(p.id), p.set_code, p.language, p.rarity);
        out.updated++;
        if (factor == null) out.noOffers++;
      } catch (e) {
        out.errors++;
      } finally {
        await d.sleep();
      }
    }
  } finally { win.destroy(); }
  return out;
}
```

(d) Export ersetzen:
```js
module.exports = { runCardmarketScrape, runFirstEdPass, firstEdCandidates };
```

- [ ] **Step 4: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/cardmarket-first-ed.test.cjs` → PASS (10).
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → alle grün.

- [ ] **Step 5: Schutz-Nachweise**

(a) In `firstEdCandidates` kurz `AND cp.deleted = 0` entfernen → Test „Kandidaten: Edition first, …" scheitert (`['1', '3', '7']`). Zitieren, zurücknehmen.
(b) In `runFirstEdPass` die Zeile `if (!(fromAll > 0)) { out.skipped++; continue; }` kurz entfernen → Test „fromAll fehlt" scheitert, weil `visited` die gefilterte Seite enthält. Zitieren, zurücknehmen.

- [ ] **Step 6: `main.cjs` verdrahten**

(a) Zeile 10:
```js
const { runCardmarketScrape, runFirstEdPass } = require('./cardmarket-scraper.cjs');
```

(b) Den Handler `scrape-cardmarket-prices` ersetzen:
```js
ipcMain.handle('scrape-cardmarket-prices', async (event, { minRank } = {}) => {
  if (cmRunning) return { updated: 0, noMatch: 0, errors: 0, noMatchList: [], busy: true };
  cmAbort = false; cmRunning = true;
  const send = (p) => { try { event.sender.send('update-progress', p); } catch (e) {} };
  const onChallenge = (win) => { cmWin = win; try { event.sender.send('cm-challenge'); } catch (e) {} };
  try {
    const res = await runCardmarketScrape(db, {
      minRank: Number(minRank) || 1,
      force: true, // a manual click means "re-fetch now" — ignore the 7-day freshness window
      onProgress: (p) => send({ current: p.current, total: p.total }),
      shouldAbort: () => cmAbort,
      onChallenge,
    });
    // Spec G4 §4: 1st-Ed-Durchgang nach dem Basis-Durchgang, im selben cmRunning-Schutz, ohne Grenze.
    // Eigener try/catch: ein Ausfall hier laesst das Basis-Ergebnis unberuehrt.
    let firstEd = { candidates: 0, updated: 0, noOffers: 0, skipped: 0, errors: 0 };
    try {
      firstEd = await runFirstEdPass(db, {
        minRank: Number(minRank) || 1,
        force: true,
        onProgress: (p) => send({ current: p.current, total: p.total }),
        shouldAbort: () => cmAbort,
        onChallenge,
      });
    } catch (e) { console.error('[cardmarket] 1st-Ed-Durchgang:', e); }
    if ((res && res.updated > 0) || firstEd.updated > 0) recordPortfolioValue(db);
    send({ current: 1, total: 1 }); // clears the bar
    return { ...res, firstEd };
  } finally { cmRunning = false; cmWin = null; }
});
```

(c) In `startCardmarketPoller` den `try`-Block ersetzen:
```js
    try {
      const minRank = Number(getSetting('cm_auto_min_rank')) || 5;
      const res = await runCardmarketScrape(db, {
        minRank,
        maxCards: 4,      // small polite batch per tick
        headless: true,   // never surface a window; skip challenged cards silently, retry next tick
        shouldAbort: () => cmAbort,
      });
      // Spec G4 §4: danach hoechstens 2 Kandidaten der Ersten Auflage; eigener try/catch.
      let firstEdUpdated = 0;
      try {
        const fe = await runFirstEdPass(db, { minRank, maxCards: 2, headless: true, shouldAbort: () => cmAbort });
        firstEdUpdated = fe.updated;
      } catch (e) { console.error('Cardmarket 1st-Ed poller error:', e); }
      if (res.updated > 0 || firstEdUpdated > 0) {
        recordPortfolioValue(db);
        if (mainWindow) {
          const stats = { totalValue: portfolioTotals(db).total };
          mainWindow.webContents.send('price-update', { updates: [], totalValue: stats.totalValue || 0 });
        }
      }
    } catch (e) { console.error('Cardmarket poller error:', e); }
```
Den Kommentar über `startCardmarketPoller` um die Zeile ergänzen: `// Spec G4: danach bis zu 2 Printings mit 1st-Ed-Exemplaren (Aufschlagsfaktor, runFirstEdPass).`

- [ ] **Step 7: Prüfen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "require('./electron/cardmarket-scraper.cjs')"` → kein Fehler.
Run (in `desktop/`): `node --check electron/main.cjs` → keine Ausgabe.
Run (in `desktop/`): `npx eslint .` → genau `5 errors`.
Per Grep (lesend): `runFirstEdPass` hat genau zwei Aufrufer in `main.cjs`; `preload.cjs` bleibt unverändert (kein neuer Kanal).

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/cardmarket-scraper.cjs desktop/electron/cardmarket-first-ed.test.cjs desktop/electron/main.cjs
git commit -m "feat(g4): Cardmarket-Durchgang Erste Auflage im Knopf und im Poller

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Handy — Kartenmodell, Kotlin-Zwilling, Wert-Stellen, Preiszeile

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CardRow.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/Valuation.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/Dashboard.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/BinderPageScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/BindersScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ml/BinderBreakdown.kt`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/ValuationTest.kt`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/BinderBreakdownTest.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/CardRowParseTest.kt`

**Interfaces:**
- Produces: `CardRow.priceFirstEd: Double? = null`, `CardRow.cmFirstEdFactor: Double? = null`; `Valuation.unitPrice(card: CardRow, copy: CopyRow): Double`, `Valuation.valueOf(card: CardRow, copies: List<CopyRow>): Double` (ersetzt `valueOf(price, copies)`), `Valuation.firstEdLine(card: CardRow): String?`; `CollectionRepository.parse(arr: JSONArray): List<CardRow>` wird `internal`.
- Consumes (Task 1): Fixture `docs/fixtures/valuation/first-ed.json` (Abschnitte `unitPrice`, `valueOf`, `line`). Consumes (Cloud): `cards` wird per `select=*` geladen und liefert `price_first_ed` (vorhanden) sowie `cm_first_ed_factor` (nach Task 2 beim Nutzer).

- [ ] **Step 1: Tests schreiben**

(a) `ValuationTest.kt` ersetzen:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Spec G4 §6 -- ZWILLING von desktop/electron/valuation.test.cjs und desktop/src/utils/valuation.test.mjs (Fixture docs/fixtures/valuation/first-ed.json). */
class ValuationTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/valuation/first-ed.json"))

    private fun copy(cond: String, ed: String = "unknown", id: String = "id-$cond-$ed-${System.nanoTime()}") =
        CopyRow(id, "1", "LOB-DE001", "DE", "Ultra Rare", ed, cond, false,
            containerId = null, page = null, slot = null, tags = null, note = null)

    private fun dbl(o: JSONObject, k: String): Double? = if (o.isNull(k)) null else o.getDouble(k)

    private fun card(o: JSONObject) = CardRow("1", "LOB-DE001", "DE", "Test", null, "Ultra Rare", 1, dbl(o, "price"),
        priceFirstEd = dbl(o, "price_first_ed"), cmFirstEdFactor = dbl(o, "cm_first_ed_factor"))

    private fun plain(price: Double?) = CardRow("1", "LOB-DE001", "DE", "Test", null, "Ultra Rare", 1, price)

    @Test
    fun factorsMatchTheSharedJsonFile() {
        // Gradle runs unit tests with the module dir (android/app) as working directory.
        val f = File("../../desktop/electron/condition-factors.json")
        assertTrue("shared factor file must exist at ${f.absolutePath}", f.exists())
        val json = JSONObject(f.readText())
        for (c in Valuation.CONDITIONS) assertEquals("factor $c", json.getDouble(c), Valuation.factor(c), 1e-9)
        assertEquals(json.length(), Valuation.CONDITIONS.size)
    }

    @Test
    fun valueOfSumsUnitPriceTimesFactor() {
        assertEquals(17.0, Valuation.valueOf(plain(10.0), listOf(copy("NM"), copy("GD"))), 1e-9)
        assertEquals(0.0, Valuation.valueOf(plain(null), listOf(copy("NM"))), 1e-9)
        assertEquals(1.0, Valuation.factor(""), 1e-9)
        assertEquals(1.0, Valuation.factor("XX"), 1e-9)
        assertEquals("geloeschte Exemplare zaehlen nicht", 10.0,
            Valuation.valueOf(plain(10.0), listOf(copy("NM"), copy("NM").copy(deleted = true))), 1e-9)
    }

    @Test
    fun `Fixture unitPrice`() {
        val cases = fix.getJSONArray("unitPrice")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val cp = c.getJSONObject("copy")
            assertEquals(c.getString("name"), c.getDouble("unit"),
                Valuation.unitPrice(card(c.getJSONObject("card")), copy(cp.getString("condition"), cp.getString("edition"))), 1e-9)
        }
    }

    @Test
    fun `Fixture valueOf`() {
        val cases = fix.getJSONArray("valueOf")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val arr = c.getJSONArray("copies")
            val copies = (0 until arr.length()).flatMap { j ->
                val o = arr.getJSONObject(j)
                (0 until o.optInt("count", 1)).map { k -> copy(o.getString("condition"), o.getString("edition"), "c$j-$k") }
            }
            assertEquals(c.getString("name"), c.getDouble("value"), Valuation.valueOf(card(c.getJSONObject("card")), copies), 1e-9)
        }
    }

    @Test
    fun `Fixture Preiszeile`() {
        val cases = fix.getJSONArray("line")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val expected = if (c.isNull("line")) null else c.getString("line")
            assertEquals(c.getString("name"), expected, Valuation.firstEdLine(card(c.getJSONObject("card"))))
        }
    }

    @Test
    fun groupOrdersByEditionThenCondition() {
        val g = Valuation.group(listOf(copy("NM"), copy("GD", "first"), copy("NM")))
        assertEquals(listOf(Valuation.Group("first", "GD", 1), Valuation.Group("unknown", "NM", 2)), g)
    }
}
```

(b) `CardRowParseTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CollectionRepository
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Spec G4 §6 -- das Kartenmodell liest price_first_ed und cm_first_ed_factor; fehlend oder null ergibt null. */
class CardRowParseTest {
    @Test fun `liest 1st-Ed-Felder`() {
        val rows = CollectionRepository.parse(JSONArray("""[
            {"id":"1","set_code":"MAMO-DE020","language":"DE","rarity":"Ultra Rare","quantity":1,"price":73.85,"price_first_ed":77.87,"cm_first_ed_factor":1.0545},
            {"id":"2","set_code":"X-1","price":1.0,"price_first_ed":null,"cm_first_ed_factor":null},
            {"id":"3","set_code":"X-2","price":2.0}
        ]"""))
        assertEquals(77.87, rows[0].priceFirstEd!!, 1e-9)
        assertEquals(1.0545, rows[0].cmFirstEdFactor!!, 1e-9)
        assertNull(rows[1].priceFirstEd); assertNull(rows[1].cmFirstEdFactor)
        assertNull(rows[2].priceFirstEd); assertNull(rows[2].cmFirstEdFactor)
    }
}
```

(c) In `BinderBreakdownTest.kt` einen zweiten Test anhängen (vor der letzten schließenden Klammer der Klasse):
```kotlin
    @Test fun `1st-Ed-Exemplar zaehlt mit price_first_ed`() {
        val cards = listOf(CardRow("5", "MAMO-DE020", "DE", "M", null, "Ultra Rare", 2, 73.85, priceFirstEd = 77.87))
        val copies = listOf(
            CopyRow("f", "5", "MAMO-DE020", "DE", "Ultra Rare", "first", "NM", false, containerId = "b1", page = null, slot = null, tags = null, note = null),
            CopyRow("u", "5", "MAMO-DE020", "DE", "Ultra Rare", "unknown", "NM", false, containerId = "b1", page = null, slot = null, tags = null, note = null),
        )
        val containers = listOf(ContainerRow("b1", "Ordner Blau", "binder", 9, null, 0))
        assertEquals(listOf(ValueGroup("Ordner Blau", 2, 151.72)), BinderBreakdown.compute(cards, copies, containers))
    }
```

- [ ] **Step 2: Kartenmodell und Parser**

`CardRow.kt`: nach `    val priceLocked: Int = 0,` einfügen:
```kotlin
    // Spec G4 §6: 1st-Ed-Preis (Cloud-Trigger aus price x cm_first_ed_factor) und Aufschlagsfaktor. Nur gelesen.
    val priceFirstEd: Double? = null,
    val cmFirstEdFactor: Double? = null,
```

`CollectionRepository.kt`: `private fun parse(arr: JSONArray): List<CardRow> {` → `internal fun parse(arr: JSONArray): List<CardRow> {`. Darüber den Kommentar setzen: `// internal statt private: CardRowParseTest prueft das Lesen der 1st-Ed-Felder (Spec G4).` Im `CardRow(...)`-Aufruf nach `priceLocked = …,` einfügen:
```kotlin
                    priceFirstEd = if (o.isNull("price_first_ed")) null else o.optDouble("price_first_ed"),
                    cmFirstEdFactor = if (o.isNull("cm_first_ed_factor")) null else o.optDouble("cm_first_ed_factor"),
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "com.example.yugiohscanner.ValuationTest"`
Expected: FAIL beim Kompilieren mit `Unresolved reference: unitPrice` / `firstEdLine` und einem `Type mismatch` bei `valueOf(plain(…), …)`.

- [ ] **Step 4: `Valuation.kt` umstellen**

```kotlin
package com.example.yugiohscanner.cloud

import java.util.Locale

// Fixed condition factors — MUST equal desktop/electron/condition-factors.json (ValuationTest checks).
object Valuation {
    val CONDITIONS = listOf("MT", "NM", "EX", "GD", "LP", "PL", "PO")
    val EDITIONS = listOf("first", "unlimited", "limited", "unknown")
    val EDITION_LABELS = mapOf("first" to "1st Ed", "unlimited" to "Unlimited", "limited" to "Limited", "unknown" to "Unbek.")
    private val FACTORS = mapOf("MT" to 1.0, "NM" to 1.0, "EX" to 0.85, "GD" to 0.7, "LP" to 0.5, "PL" to 0.35, "PO" to 0.2)

    fun factor(condition: String?): Double = FACTORS[condition?.uppercase() ?: ""] ?: 1.0

    /**
     * Spec G4 §6 -- Einzelpreis eines Exemplars: 1st-Ed-Preis fuer edition = "first", sonst Basispreis.
     * ZWILLING: desktop/electron/valuation.cjs (unitPrice/valueOf/unitPriceCaseSql) und desktop/src/utils/valuation.js.
     * Gemeinsame Fixture docs/fixtures/valuation/first-ed.json (ValuationTest). Wer eine Fassung aendert, aendert alle.
     */
    fun unitPrice(card: CardRow, copy: CopyRow): Double {
        val first = card.priceFirstEd
        return if (copy.edition == "first" && first != null) first else card.price ?: 0.0
    }

    /** Summe unitPrice x Zustandsfaktor ueber lebende Exemplare, auf Cent gerundet. */
    fun valueOf(card: CardRow, copies: List<CopyRow>): Double {
        if (copies.isEmpty()) return 0.0
        var v = 0.0
        for (c in copies) if (!c.deleted) v += unitPrice(card, c) * factor(c.condition)
        return Math.round(v * 100.0) / 100.0
    }

    /** Spec G4 §7 -- Preiszeile "Basis … · 1st Ed … (×…)". ZWILLING: firstEdLine in desktop/src/utils/valuation.js. */
    fun firstEdLine(card: CardRow): String? {
        val first = card.priceFirstEd ?: return null
        val line = String.format(Locale.GERMANY, "Basis %,.2f € · 1st Ed %,.2f €", card.price ?: 0.0, first)
        val f = card.cmFirstEdFactor ?: return line
        return line + String.format(Locale.GERMANY, " (×%.2f)", f)
    }

    data class Group(val edition: String, val condition: String, val count: Int)

    fun group(copies: List<CopyRow>): List<Group> =
        copies.filter { !it.deleted }
            .groupBy { it.edition to it.condition }
            .map { (k, v) -> Group(k.first, k.second, v.size) }
            .sortedWith(compareBy({ EDITIONS.indexOf(it.edition) }, { CONDITIONS.indexOf(it.condition) }))
}
```

- [ ] **Step 5: Wert-Stellen umstellen**

`Dashboard.kt` (`printingValue`):
```kotlin
// Value of one printing, from its cached prices and the copies actually owned of it (Spec G4: 1st Ed mit eigenem Preis).
internal fun printingValue(c: CardRow, byKey: Map<String, List<CopyRow>>): Double =
    Valuation.valueOf(c, byKey[c.printingKey()] ?: emptyList())
```

`BinderPageScreen.kt` (`valueOf`, Zeile 171–172):
```kotlin
    fun valueOf(list: List<CopyRow>): Double =
        list.sumOf { c -> (cardOf(c)?.let { Valuation.unitPrice(it, c) } ?: 0.0) * Valuation.factor(c.condition) }
```

`BindersScreen.kt` (`valueFor`, Zeile 117):
```kotlin
    fun valueFor(id: String) = copiesByContainer[id]?.sumOf { c -> (cardsByKey[c.printingKey()]?.let { Valuation.unitPrice(it, c) } ?: 0.0) * Valuation.factor(c.condition) } ?: 0.0
```

`ml/BinderBreakdown.kt`: Den Kommentar ergänzen mit `Spec G4: Einzelpreis ueber Valuation.unitPrice (1st Ed mit eigenem Preis).` und in `compute` ersetzen:
```kotlin
        val byKey = cards.associateBy { it.printingKey() }
```
(statt `val price = …`) sowie
```kotlin
            value[label] = (value[label] ?: 0.0) + (byKey[c.printingKey()]?.let { Valuation.unitPrice(it, c) } ?: 0.0) * Valuation.factor(c.condition)
```

`CardDetailScreen.kt`:
- Zeile 169: `ValueText(Valuation.valueOf(v, mine), style = MaterialTheme.typography.bodyMedium)`
- Zeile 193: `ValueText(Valuation.valueOf(v, mine.filter { it.edition == g.edition && it.condition == g.condition }), style = MaterialTheme.typography.bodySmall)`
- Direkt nach der schließenden Klammer der `Row` mit `RarityChip` (vor `PriceHistoryChart(v)`) einfügen:
```kotlin
                    // Spec G4 §7: Preiszeile nur bei gesetztem 1st-Ed-Preis (Gegenstueck zu CardDetailPanel.jsx).
                    Valuation.firstEdLine(v)?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, fontFamily = MonoFontFamily, color = Muted)
                    }
```

- [ ] **Step 6: Build und Tests**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, alle Tests grün, darunter `ValuationTest` (6), `CardRowParseTest` (1) und `BinderBreakdownTest` (2).
Per Grep (lesend): `Grep "Valuation.valueOf\(" android/app/src/main` zeigt nur Aufrufe mit einer `CardRow` als erstem Argument, und `Grep "\.price \?: 0.0\) \* Valuation.factor"` findet nichts mehr. `ml/Movers.kt` bleibt unverändert (Basispreis, Spec §6).

- [ ] **Step 7: Schutz-Nachweis**

In `Valuation.unitPrice` kurz `copy.edition == "first" && ` entfernen → `Fixture unitPrice` scheitert am Fall „unlimited ignoriert price_first_ed". Zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CardRow.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/Valuation.kt android/app/src/main/java/com/example/yugiohscanner/ui/Dashboard.kt android/app/src/main/java/com/example/yugiohscanner/ui/BinderPageScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/BindersScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/ml/BinderBreakdown.kt android/app/src/test/java/com/example/yugiohscanner/ValuationTest.kt android/app/src/test/java/com/example/yugiohscanner/BinderBreakdownTest.kt android/app/src/test/java/com/example/yugiohscanner/CardRowParseTest.kt
git commit -m "feat(g4): Handy bewertet 1st Ed mit eigenem Preis und zeigt die Preiszeile

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Controller-Abschluss (kein Subagent)

- [ ] **Gesamtlauf:** Desktop SQLite-Suite, `electron/test-sync.cjs`, Desktop-Helfer, Lint genau 5, `npx vite build`, Android `testDebugUnitTest assembleDebug`. Die Zahlen kommen ins Ledger (Android aus `android/app/build/test-results/testDebugUnitTest/*.xml`).
- [ ] **Abschlussreview** mit dem besten Modell über den gesamten Zweig (`review-package`, Basis = Plan-Commit), danach eine Fix-Welle und ein scoped Re-Review. Besonders prüfen:
  - Kein App-Code schreibt `price_first_ed` (Grep `price_first_ed =` außerhalb von `copies-schema.cjs`, der SQL-Datei und den Tests).
  - Beide Trigger-Fassungen runden gleich (Fixture-Abschnitt `trigger`).
  - Der Basis-Durchgang verhält sich unverändert: gleiche Zeilenwahl, gleiche Schreibungen, `setNameFor` nur ohne Code-Treffer.
  - Der Poller überschreitet nie 2 Kandidaten.
  - Desktop- und Handy-Tageswert sind im selben Zweig umgestellt.
- [ ] **Übergabe an den Nutzer, in dieser Reihenfolge (Spec §8):**
  1. `supabase/cards_first_ed_factor.sql` im Dashboard einspielen — **vor** dem Installer, sonst scheitert jeder Push an der unbekannten Spalte.
  2. Desktop-Installer bauen und installieren, **nicht** aus dem Worktree mit Junction-`node_modules` (nach dem Merge im Hauptcheckout bauen).
  3. APK installieren (unabhängig; `price_first_ed` existiert in der Cloud bereits). `connectedDebugAndroidTest` nie auf dem Gerät ausführen.
  Keine Edge Function, kein Deploy.
- [ ] **Abnahme** (Checkliste im Ledger, Spec §11):
  1. SQL eingespielt; Installer und APK installiert.
  2. Desktop: „Cardmarket" drücken → MAMO-DE020 bekommt `cm_first_ed_factor` und `price_first_ed`; das Karten-Detail zeigt „Basis … · 1st Ed … (×…)".
  3. Der Gesamtwert am Desktop steigt um (1st-Ed-Preis − Basispreis) × Zustandsfaktor des Exemplars.
  4. Nach dem Sync zeigt das Handy-Detail dieselbe Preiszeile, und der Handy-Gesamtwert ist gleich dem Desktop.
  5. Nutzer-SELECT in der Cloud: Faktor und `price_first_ed` wie am Desktop. Die Rundungsprobe aus dem Dateiende der SQL-Datei liefert `77.87 | 10.01`. `price` testweise von Hand ändern → `price_first_ed` zieht nach; danach zurücksetzen.
  6. Ein unlimited-Exemplar desselben Printings (falls vorhanden) bleibt beim Basispreis.
  7. Beobachtung Ab-Preis-Rauschen (Spec §12): Faktor mit dem Messversuch vergleichen (erwartet etwa 1,05 bei 55 € / 58 €).
- [ ] **Merge-Frage** an den Nutzer.

---

## Selbstprüfung

**Spec-Abdeckung:**

| Spec | Umsetzung |
|---|---|
| §1 Faktor statt Ab-Preis, keine `price_history` mit `variant='first'`, keine zweite Chart-Linie, Produkt-Link von der Versions-Seite, Bulk-Printings sind Kandidaten, Trigger statt Preisschreiber, kein Schalter, Zwilling in vier Fassungen | Tasks 1, 2 (Trigger); 5, 6 (Link, Kandidaten, keine Historie, kein Schalter); 3, 4, 7 (Zwilling) |
| §2 Umfang und „Nicht drin" (kein Altbestand-Werkzeug, kein Verlauf/Alarm/Bewegung, keine Sprach-/Zustandsfilter, kein Schalter) | Global Constraints G4-spezifisch; Task 3/7 lassen Movers unberührt |
| §3 Preisregel (`round4`, Untergrenze 1, `fromAll` fehlt → nichts, `fromFirst` fehlt → NULL + Zeitstempel) | Task 5 (`firstEdFactor`), Task 6 (Schreiben), Task 1/2 (`price_first_ed` gerundet) |
| §4 Durchgang: Ort, Aufruf nach Basis im `cmRunning`-Schutz, Drossel, Poller 2 / manuell ohne Grenze, Kandidaten (Edition, Schwelle, Lock, 7 Tage, force, unabhängig von `cm_product_id`, Reihenfolge), drei Seiten, gemeinsamer Auswahl-Helfer, `parseFromPrice`, Schreiben, `recordPortfolioValue` + `price-update` | Task 5 (Helfer, `href`), Task 6 (`firstEdCandidates`, `runFirstEdPass`, `main.cjs`) |
| §5 SQLite-Spalte + Trigger (INSERT, UPDATE OF price/Faktor, nur wenn verschieden, `IS NOT`), Nachrechnen; Postgres-Datei mit BEFORE-Trigger und Nachrechnen; Zwillings-Kommentare; Sync `MIRROR_COLS` + Spiegel-INSERT, `applyRemoteRow`-Patch unverändert; Rundung mit ,xx5-Fall | Task 1, Task 2; Plan-Ergänzungen 1–3, 7 |
| §6 Bewertung `unitPrice`/`valueOf`/`unitPriceCaseSql`, gemeinsame Fixture, umgestellte Stellen (Desktop `valueOf`, `totalValue` → Gesamtwert/`recordPortfolioValue`/`syncSnapshot`, `listContainers`, `collection-query`, `breakdown.js`, `BinderView.jsx`, `CardDetailPanel.jsx`; Handy `valueOf`, `Dashboard.kt`, `BinderPageScreen.kt`, `BindersScreen.kt`, `BinderBreakdown.kt`, `CardDetailScreen.kt`), Basispreis bleibt bei Movers/Referenz/Alarmen, Tageswert im selben Zug | Task 3 (main + SQL), Task 4 (Renderer), Task 7 (Kotlin); Global Constraint „selber Merge" |
| §7 Anzeige: Preiszeile Desktop und Handy, sonst unverändert, kein Hinweis bei „keine Angebote", keine UI-Änderung sonst | Task 4 Step 6, Task 7 Step 5; Plan-Ergänzungen 5, 10 |
| §8 Einspiel-Reihenfolge SQL → Installer → APK, keine Edge Function | Task 8 Übergabe |
| §9 Fehlerfälle (Challenge, keine Zeile/kein Link, `fromAll` fehlt, kein Angebot → NULL + 7 Tage, letztes 1st-Ed-Exemplar weg → fällt aus Kandidaten, `price` NULL → NULL, Markup-Änderung isoliert) | Task 6 Tests (Challenge, Link, fromAll, kein Angebot, gelöschte Exemplare), Task 1 Test (Preis NULL), Task 6 Step 6 (eigener try/catch) |
| §10 Tests: `parseFromPrice`, Faktor-Helfer, Auswahl-Helfer mit Basis-Fällen, Kandidaten, SQLite-Trigger mit Schutz-Test, Bewertungs-Fixture JS main/Renderer/Kotlin + SQL `totalValue`/`listContainers`, Sync-Payload, Durchgang mit gestubbtem Fenster | Tasks 5, 6, 1, 3, 4, 7, 2 |
| §11 Abnahme | Task 8 |
| §12 Risiken (Markup isoliert, Cloudflare-Grenze, geringe Wirkung, Ab-Preis-Rauschen beobachten) | Task 6 (try/catch, `maxCards: 2`, `headless`), Task 8 Abnahme 7 |

**Platzhalter-Suche:** Es gibt kein „TBD" und kein „wie in Task N". Jeder Code-Schritt enthält den vollständigen Code, und die Beträge sind nachgerechnet bzw. gemessen:
- SQLite `ROUND(x + 1e-7, 2)`: 73,85 × 1,0545 → 77,87; 10 × 1,0005 → 10,01; 80 × 1,0545 → 84,36; 73,85 × 1,2 → 88,62.
- JS: 58/55 → 1,0545; 4/3 → 1,3333; 12,35 × 0,85 → 10,5; 73,85 × 0,85 → 62,77; 12,5 + 8,75 + 10 + 8,5 = 39,75; 77,87 + 73,85 = 151,72.
- Formatierung: `fmtEUR(1234.5)` → „1.234,50 €", `fmtNum(1.0545)` → „1,05".

**Namens- und Typkonsistenz:**
- Spalte und Trigger: `cm_first_ed_factor` (Tasks 1, 2, 6, 7); `FIRST_ED_SQL`, `trg_cards_first_ed_ins`/`_upd` ↔ `public.cards_price_first_ed()`/`trg_cards_price_first_ed`.
- Bewertung: `unitPrice(card, copy)`, `valueOf(card, copies)`, `unitPriceCaseSql(cardAlias, copyAlias)` (Task 3) ↔ `unitPrice`, `valueOf`, `firstEdLine` (Task 4) ↔ `Valuation.unitPrice/valueOf/firstEdLine` (Task 7).
- Scraper: `selectVersionRow(rows, printing, lookupSetName)`, `productUrl`, `firstEdUrl`, `parseFromPrice(pairs)`, `firstEdFactor(fromAll, fromFirst) → { write, factor }` (Task 5 → 6); `firstEdCandidates(db, { minRank, force, nowMs, limit })`, `runFirstEdPass(db, { …, deps }) → { candidates, updated, noOffers, skipped, errors }` (Task 6); IPC-Antwort-Feld `firstEd`.
- Kotlin: `CardRow.priceFirstEd`, `CardRow.cmFirstEdFactor`, `CollectionRepository.parse` (internal).
- Fixture-Schlüssel: `unitPrice`/`valueOf`/`trigger`/`line`, Kartenfelder `price`, `price_first_ed`, `cm_first_ed_factor` gleich in allen Lesern.
