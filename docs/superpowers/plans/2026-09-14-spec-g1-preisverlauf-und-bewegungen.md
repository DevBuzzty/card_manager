# Spec G1 — Preisverlauf & Bewegungen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preisverlauf pro Printing im Kartendetail und Gewinner/Verlierer über 7/30 Tage auf Start und in Insights, auf Desktop und Handy mit denselben Zahlen; dazu Aufteilung nach Wert/Binder und ein reparierter Wertverlauf.

**Architecture:** Zwei reine Regeln als markierte JS/Kotlin-Zwillinge gegen gemeinsame JSON-Fixtures: `movers` (was als Bewegung zählt) und `priceSteps` (Stufenlinie). Der Desktop rechnet aus seiner SQLite; das Handy holt Referenzpreise über eine lesende RPC in `SideStores` (einmal pro UTC-Tag) und rechnet gegen `CollectionStore`. Kein Faktor und keine Familienregel im SQL.

**Tech Stack:** Electron (CJS main) + better-sqlite3, React 19 + recharts 3 (ESM renderer), Kotlin 2.0 + Compose (M3 1.2.1), OkHttp gegen PostgREST, JUnit 4, org.json im Test, node:test.

**Spec:** `docs/superpowers/specs/2026-09-14-spec-g-nachtrag-g1-preisverlauf-und-bewegungen.md` (§4) — lies §4 vor deiner Task. Hintergrund: `docs/superpowers/specs/2026-09-05-spec-g-portfolio-pro-design.md`.

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus und verbinden sich nie mit Supabase. SQL-Dateien werden nur geschrieben; eingespielt werden sie vom Nutzer von Hand.
- Immer explizite Pfade stagen, nie `git add -A`, nie `git stash` (der Stash-Stack ist mit den Worktrees geteilt).
- Kein nacktes `npm install` in desktop/ (better-sqlite3-ABI). `desktop/node_modules` ist im Worktree eine Junction: vor dem Entfernen des Worktrees lösen.
- `cards.quantity` und `cards.deleted` pflegen Trigger, die App schreibt sie nie. Nur Soft-Delete.
- Jeder IPC-Kanal steht in `main.cjs` UND in `preload.cjs`.
- Sichtbare Texte deutsch mit echten Umlauten, „Fächer" statt „Taschen".
- Regeln wohnen in reinen, getesteten Helfern (Android `ml/`, Desktop `src/utils/` bzw. `electron/`). Absichtliche Kotlin/JS-Zwillinge werden markiert und beidseitig getestet.
- Desktop-Lint-Baseline: genau 5 Fehler; ein sechster ist ein Fehlschlag.
- Deutsche Set-Codes nie aus englischen ableiten.
- Commit-Trailer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- „Heute" ist überall das **UTC-Datum** im Format `YYYY-MM-DD`.
- Ein Platzhalter darf nie wie eine leere Sammlung aussehen (kein „0,00 €" beim Laden).
- Teure Rechnungen nie ungemerkt in der Komposition: Bewegungen über `MoversMemo` auf `Dispatchers.Default`.
- kotlinx-coroutines-test: `advanceUntilIdle()` treibt `backgroundScope` NICHT. Für jeden Schutz-Test nachweisen (Schutz kurz entfernen, Test rot sehen, zurück), dass er ohne den Schutz scheitert; im Bericht nennen.

**Befehle (im Worktree-Wurzelverzeichnis):**
- SQLite-/Main-Tests: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Renderer-Helfer: `cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs`
- Lint: `cd desktop && npm run lint` → genau 5 Fehler
- Android: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`

**Pfad-Präfixe:** `M = android/app/src/main/java/com/example/yugiohscanner`, `T = android/app/src/test/java/com/example/yugiohscanner`.

---

## Dateiübersicht

**Neu Desktop:** `electron/price-families.json`, `electron/movers.cjs` (+`.test.cjs`), `electron/price-reference.cjs` (+`.test.cjs`), `electron/portfolio-value.cjs` (+`.test.cjs`), `src/utils/priceSteps.js` (+`.test.js`), `src/utils/moversText.js` (+`.test.js`), `src/utils/useMovers.js`, `src/utils/breakdown.js` (+`.test.js`), `src/components/MoversList.jsx`, `src/components/MoversCard.jsx`, `src/components/MoversPanel.jsx`, `src/components/ValueBreakdown.jsx`, `src/components/PriceHistoryChart.jsx`.
**Geändert Desktop:** `electron/price-history.cjs` (+Test), `electron/database.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `src/components/Start.jsx`, `src/components/Insights.jsx`, `src/components/Portfolio.jsx`, `src/components/CardDetailPanel.jsx`.
**Neu Supabase:** `supabase/price_reference_rpc.sql`, `supabase/price_history_seed.sql`.
**Neu Fixtures:** `docs/fixtures/portfolio/movers.json`, `docs/fixtures/portfolio/price-steps.json`.
**Neu Android:** `M/ml/PriceFamily.kt`, `M/ml/Movers.kt`, `M/ml/PriceSteps.kt`, `M/ml/BoundedMap.kt`, `M/ml/SnapshotSeries.kt`, `M/ml/BinderBreakdown.kt`, `M/cloud/PriceHistoryRepository.kt`, `M/cloud/DailyListCache.kt`, `M/ui/MoversMemo.kt`, `M/ui/MoversSection.kt`, `M/ui/InsightsScreen.kt`, `M/ui/PriceHistoryChart.kt`; Tests `T/Fixtures.kt`, `T/PriceFamilyTest.kt`, `T/MoversTest.kt`, `T/PriceStepsTest.kt`, `T/BoundedMapTest.kt`, `T/SnapshotSeriesTest.kt`, `T/PriceHistoryQueriesTest.kt`, `T/DailyListCacheTest.kt`, `T/MoversMemoTest.kt`, `T/BinderBreakdownTest.kt`.
**Geändert Android:** `M/cloud/CardRow.kt`, `M/cloud/CollectionRepository.kt`, `M/cloud/SnapshotsRepository.kt`, `M/cloud/SideStores.kt`, `M/ui/StartScreen.kt`, `M/ui/Dashboard.kt`, `M/ui/CardDetailScreen.kt`, `M/ui/AppNav.kt`.

**Bewusste Abweichungen von der Spec (im Ledger festhalten):**
1. `get-card-history` und `PriceHistoryRepository.history` laden **alle** `base`-Zeilen des Printings (höchstens eine pro Tag, `order=day.desc&limit=1000`, dann umgedreht) statt „365 Tage + eine davor". Das Fenster schneidet `priceSteps`; das Ergebnis ist identisch, die Abfrage einfacher.
2. Die Referenz-RPC liefert pro Printing die letzte Zeile ≤ Stichtag **oder, falls keine, die früheste Zeile**. Nur so kann das Handy „erscheinen ab TT.MM." berechnen. Die Regel filtert selbst.
3. Die Binder-Aufteilung am Handy rechnet `ml/BinderBreakdown` in eigenem `produceState` auf `Dispatchers.Default` statt in `DashboardMemo` (keine Signaturänderung an `computeDashboard`).

---

### Task 1: Regel „Bewegung" — Desktop (`movers.cjs`) + gemeinsame Fixture

**Files:**
- Create: `desktop/electron/price-families.json`
- Create: `desktop/electron/movers.cjs`
- Create: `docs/fixtures/portfolio/movers.json`
- Test: `desktop/electron/movers.test.cjs`

**Interfaces:**
- Produces:
  - `price-families.json`: `{ "cm_bulk": "cm", "cm_scrape": "cm", "cloud": "cm", "ygoprodeck": "ygo", "manual": "manual" }`
  - `movers.cjs` exports `{ computeMovers, familyOfSource, familyOfLock, addDays, keyOf }`
  - `computeMovers({ cards, copies, references, today, days, top = 10 })` → `{ status: 'ok'|'no_reference', firstDay: string|null, winners: Mover[], losers: Mover[] }`
  - `Mover = { key, id, set_code, language, rarity, name, image_url, oldPrice, newPrice, deltaUnit, pct, weight, copies, deltaHolding }`
  - Eingaben: `cards [{id,set_code,language,rarity,name,image_url,price,price_locked,deleted?}]`, `copies [{card_id,set_code,language,rarity,condition,deleted?}]`, `references [{card_id,set_code,language,rarity,day,price,source}]`

- [ ] **Step 1: Familien-Datei anlegen**

`desktop/electron/price-families.json`:
```json
{ "cm_bulk": "cm", "cm_scrape": "cm", "cloud": "cm", "ygoprodeck": "ygo", "manual": "manual" }
```

- [ ] **Step 2: Fixture schreiben**

`docs/fixtures/portfolio/movers.json` (von JS und Kotlin gelesen; Zahlen sind mit IEEE-Double nachgerechnet, nicht ändern ohne beide Seiten):
```json
{
  "cases": [
    {
      "name": "Gewinner und Verlierer nach Bestandsdelta; Stichtag zaehlt; Auswahl der Referenzzeile",
      "input": {
        "today": "2026-09-20", "days": 7, "top": 10,
        "cards": [
          { "id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "name": "A", "image_url": null, "price": 12.0, "price_locked": 1 },
          { "id": "2", "set_code": "MRD-DE002", "language": "DE", "rarity": "Common", "name": "B", "image_url": null, "price": 1.6, "price_locked": 1 },
          { "id": "3", "set_code": "SDK-DE003", "language": "DE", "rarity": "Secret Rare", "name": "C", "image_url": null, "price": 30.0, "price_locked": 0 }
        ],
        "copies": [
          { "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "condition": "NM" },
          { "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "condition": "NM" },
          { "card_id": "2", "set_code": "MRD-DE002", "language": "DE", "rarity": "Common", "condition": "EX" },
          { "card_id": "3", "set_code": "SDK-DE003", "language": "DE", "rarity": "Secret Rare", "condition": "NM" },
          { "card_id": "3", "set_code": "SDK-DE003", "language": "DE", "rarity": "Secret Rare", "condition": "LP" }
        ],
        "references": [
          { "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-05", "price": 9.0, "source": "cm_bulk" },
          { "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-10", "price": 10.0, "source": "cm_bulk" },
          { "card_id": "1", "set_code": "LOB-DE001", "language": "DE", "rarity": "Ultra Rare", "day": "2026-09-15", "price": 11.5, "source": "cm_bulk" },
          { "card_id": "2", "set_code": "MRD-DE002", "language": "DE", "rarity": "Common", "day": "2026-09-13", "price": 2.0, "source": "cloud" },
          { "card_id": "3", "set_code": "SDK-DE003", "language": "DE", "rarity": "Secret Rare", "day": "2026-09-01", "price": 25.0, "source": "ygoprodeck" }
        ]
      },
      "expected": {
        "status": "ok", "firstDay": null,
        "winners": [
          { "key": "3|SDK-DE003|DE|Secret Rare", "oldPrice": 25.0, "newPrice": 30.0, "deltaUnit": 5.0, "pct": 20.0, "weight": 1.5, "copies": 2, "deltaHolding": 7.5 },
          { "key": "1|LOB-DE001|DE|Ultra Rare", "oldPrice": 10.0, "newPrice": 12.0, "deltaUnit": 2.0, "pct": 20.0, "weight": 2.0, "copies": 2, "deltaHolding": 4.0 }
        ],
        "losers": [
          { "key": "2|MRD-DE002|DE|Common", "oldPrice": 2.0, "newPrice": 1.6, "deltaUnit": -0.4, "pct": -20.0, "weight": 0.85, "copies": 1, "deltaHolding": -0.34 }
        ]
      }
    },
    {
      "name": "Quellenwechsel, manuell, unbekannte Quelle, kein Damals, Delta 0, ohne lebende Exemplare",
      "input": {
        "today": "2026-09-20", "days": 7, "top": 10,
        "cards": [
          { "id": "4", "set_code": "X-DE004", "language": "DE", "rarity": "Rare", "name": "D", "image_url": null, "price": 20.0, "price_locked": 1 },
          { "id": "5", "set_code": "X-DE005", "language": "DE", "rarity": "Rare", "name": "E", "image_url": null, "price": 5.0, "price_locked": 2 },
          { "id": "6", "set_code": "X-DE006", "language": "DE", "rarity": "Rare", "name": "F", "image_url": null, "price": 5.0, "price_locked": 1 },
          { "id": "7", "set_code": "X-DE007", "language": "DE", "rarity": "Rare", "name": "G", "image_url": null, "price": 8.0, "price_locked": 1 },
          { "id": "8", "set_code": "X-DE008", "language": "DE", "rarity": "Rare", "name": "H", "image_url": null, "price": 3.0, "price_locked": 1 },
          { "id": "9", "set_code": "X-DE009", "language": "DE", "rarity": "Rare", "name": "I", "image_url": null, "price": 9.0, "price_locked": 1 }
        ],
        "copies": [
          { "card_id": "4", "set_code": "X-DE004", "language": "DE", "rarity": "Rare", "condition": "NM" },
          { "card_id": "5", "set_code": "X-DE005", "language": "DE", "rarity": "Rare", "condition": "NM" },
          { "card_id": "6", "set_code": "X-DE006", "language": "DE", "rarity": "Rare", "condition": "NM" },
          { "card_id": "7", "set_code": "X-DE007", "language": "DE", "rarity": "Rare", "condition": "NM" },
          { "card_id": "8", "set_code": "X-DE008", "language": "DE", "rarity": "Rare", "condition": "NM" },
          { "card_id": "9", "set_code": "X-DE009", "language": "DE", "rarity": "Rare", "condition": "NM", "deleted": true }
        ],
        "references": [
          { "card_id": "4", "set_code": "X-DE004", "language": "DE", "rarity": "Rare", "day": "2026-09-01", "price": 10.0, "source": "ygoprodeck" },
          { "card_id": "5", "set_code": "X-DE005", "language": "DE", "rarity": "Rare", "day": "2026-09-01", "price": 4.0, "source": "manual" },
          { "card_id": "6", "set_code": "X-DE006", "language": "DE", "rarity": "Rare", "day": "2026-09-01", "price": 4.0, "source": "import" },
          { "card_id": "7", "set_code": "X-DE007", "language": "DE", "rarity": "Rare", "day": "2026-09-15", "price": 7.0, "source": "cm_bulk" },
          { "card_id": "8", "set_code": "X-DE008", "language": "DE", "rarity": "Rare", "day": "2026-09-01", "price": 3.0, "source": "cm_bulk" },
          { "card_id": "9", "set_code": "X-DE009", "language": "DE", "rarity": "Rare", "day": "2026-09-01", "price": 1.0, "source": "cm_bulk" }
        ]
      },
      "expected": { "status": "ok", "firstDay": null, "winners": [], "losers": [] }
    },
    {
      "name": "Noch kein Damals: no_reference mit fruehestem Tag",
      "input": {
        "today": "2026-09-20", "days": 7, "top": 10,
        "cards": [
          { "id": "20", "set_code": "Y-DE020", "language": "DE", "rarity": "Common", "name": "J", "image_url": null, "price": 4.0, "price_locked": 1 },
          { "id": "21", "set_code": "Y-DE021", "language": "DE", "rarity": "Common", "name": "K", "image_url": null, "price": 2.0, "price_locked": 1 },
          { "id": "22", "set_code": "Y-DE022", "language": "DE", "rarity": "Common", "name": "L", "image_url": null, "price": 2.0, "price_locked": 1 }
        ],
        "copies": [
          { "card_id": "20", "set_code": "Y-DE020", "language": "DE", "rarity": "Common", "condition": "NM" },
          { "card_id": "21", "set_code": "Y-DE021", "language": "DE", "rarity": "Common", "condition": "NM" },
          { "card_id": "22", "set_code": "Y-DE022", "language": "DE", "rarity": "Common", "condition": "NM" }
        ],
        "references": [
          { "card_id": "20", "set_code": "Y-DE020", "language": "DE", "rarity": "Common", "day": "2026-09-19", "price": 3.5, "source": "cm_bulk" },
          { "card_id": "20", "set_code": "Y-DE020", "language": "DE", "rarity": "Common", "day": "2026-09-16", "price": 3.0, "source": "cm_bulk" },
          { "card_id": "21", "set_code": "Y-DE021", "language": "DE", "rarity": "Common", "day": "2026-09-18", "price": 1.0, "source": "cm_bulk" }
        ]
      },
      "expected": { "status": "no_reference", "firstDay": "2026-09-23", "winners": [], "losers": [] }
    },
    {
      "name": "Gleichstand nach Schluessel, Top N, fehlende Raritaet als Unknown, 30 Tage",
      "input": {
        "today": "2026-09-20", "days": 30, "top": 2,
        "cards": [
          { "id": "11", "set_code": "AAA-DE002", "language": "DE", "rarity": "Common", "name": "N", "image_url": null, "price": 3.0, "price_locked": 1 },
          { "id": "10", "set_code": "AAA-DE001", "language": "DE", "rarity": "Common", "name": "M", "image_url": null, "price": 3.0, "price_locked": 1 },
          { "id": "12", "set_code": "AAA-DE003", "language": "DE", "rarity": null, "name": "P", "image_url": null, "price": 2.5, "price_locked": 1 }
        ],
        "copies": [
          { "card_id": "10", "set_code": "AAA-DE001", "language": "DE", "rarity": "Common", "condition": "NM" },
          { "card_id": "11", "set_code": "AAA-DE002", "language": "DE", "rarity": "Common", "condition": "NM" },
          { "card_id": "12", "set_code": "AAA-DE003", "language": "DE", "rarity": "Unknown", "condition": "NM" }
        ],
        "references": [
          { "card_id": "10", "set_code": "AAA-DE001", "language": "DE", "rarity": "Common", "day": "2026-08-01", "price": 2.0, "source": "cm_scrape" },
          { "card_id": "11", "set_code": "AAA-DE002", "language": "DE", "rarity": "Common", "day": "2026-08-01", "price": 2.0, "source": "cm_scrape" },
          { "card_id": "12", "set_code": "AAA-DE003", "language": "DE", "rarity": "Unknown", "day": "2026-08-01", "price": 2.0, "source": "cloud" }
        ]
      },
      "expected": {
        "status": "ok", "firstDay": null,
        "winners": [
          { "key": "10|AAA-DE001|DE|Common", "oldPrice": 2.0, "newPrice": 3.0, "deltaUnit": 1.0, "pct": 50.0, "weight": 1.0, "copies": 1, "deltaHolding": 1.0 },
          { "key": "11|AAA-DE002|DE|Common", "oldPrice": 2.0, "newPrice": 3.0, "deltaUnit": 1.0, "pct": 50.0, "weight": 1.0, "copies": 1, "deltaHolding": 1.0 }
        ],
        "losers": []
      }
    }
  ]
}
```

- [ ] **Step 3: Failing test**

`desktop/electron/movers.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { computeMovers, familyOfSource, familyOfLock, addDays } = require('./movers.cjs');

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/MoversTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'portfolio', 'movers.json'), 'utf8'));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);
const pick = (m) => ({ key: m.key, oldPrice: m.oldPrice, newPrice: m.newPrice, deltaUnit: m.deltaUnit, pct: m.pct, weight: m.weight, copies: m.copies, deltaHolding: m.deltaHolding });

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    const r = computeMovers(c.input);
    assert.equal(r.status, c.expected.status);
    assert.equal(r.firstDay, c.expected.firstDay);
    for (const list of ['winners', 'losers']) {
      assert.equal(r[list].length, c.expected[list].length, list);
      r[list].forEach((m, i) => {
        const e = c.expected[list][i];
        const got = pick(m);
        assert.equal(got.key, e.key, `${list}[${i}].key`);
        assert.equal(got.copies, e.copies, `${list}[${i}].copies`);
        for (const f of ['oldPrice', 'newPrice', 'deltaUnit', 'pct', 'weight', 'deltaHolding']) near(got[f], e[f], `${list}[${i}].${f}`);
      });
    }
  });
}

test('Familien: Quelle und Sperre', () => {
  assert.equal(familyOfSource('cm_bulk'), 'cm');
  assert.equal(familyOfSource('cloud'), 'cm');
  assert.equal(familyOfSource('ygoprodeck'), 'ygo');
  assert.equal(familyOfSource('irgendwas'), 'unknown');
  assert.equal(familyOfLock(null), 'ygo');
  assert.equal(familyOfLock(1), 'cm');
  assert.equal(familyOfLock(2), 'manual');
  assert.equal(familyOfLock(7), 'unknown');
});

test('addDays rechnet in UTC ueber Monatsgrenzen', () => {
  assert.equal(addDays('2026-09-20', -30), '2026-08-21');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
```

- [ ] **Step 4: Run → FAIL** (`Cannot find module './movers.cjs'`)

Run: `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/movers.test.cjs`

- [ ] **Step 5: Implementieren**

`desktop/electron/movers.cjs`:
```js
// Spec G1 §4.2 — was als Bewegung zaehlt.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/Movers.kt. Beide laufen gegen
// docs/fixtures/portfolio/movers.json. Wer eine Seite aendert, aendert beide.
const FAMILIES = require('./price-families.json');
const { conditionFactor } = require('./valuation.cjs');

const familyOfSource = (source) => FAMILIES[source] || 'unknown';

function familyOfLock(priceLocked) {
  const n = priceLocked == null ? 0 : Number(priceLocked);
  if (n === 0) return 'ygo';
  if (n === 1) return 'cm';
  if (n === 2) return 'manual';
  return 'unknown';
}

const keyOf = (id, setCode, language, rarity) =>
  `${id}|${setCode || 'Unknown'}|${language || 'DE'}|${rarity || 'Unknown'}`;

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const round = (x, f) => Math.round(x * f) / f;

// Pro Printing: die letzte Zeile <= Stichtag; gibt es keine, die frueheste (fuer "erscheinen ab").
function better(a, b, cutoff) {
  if (!a) return b;
  const aIn = a.day <= cutoff;
  const bIn = b.day <= cutoff;
  if (aIn !== bIn) return aIn ? a : b;
  if (aIn) return b.day > a.day ? b : a;
  return b.day < a.day ? b : a;
}

function computeMovers({ cards, copies, references, today, days, top = 10 }) {
  const cutoff = addDays(today, -days);

  const owned = new Map();
  for (const c of copies || []) {
    if (c.deleted) continue;
    const k = keyOf(c.card_id, c.set_code, c.language, c.rarity);
    const e = owned.get(k) || { weight: 0, count: 0 };
    e.weight += conditionFactor(c.condition);
    e.count += 1;
    owned.set(k, e);
  }

  const refs = new Map();
  for (const r of references || []) {
    const k = keyOf(r.card_id, r.set_code, r.language, r.rarity);
    refs.set(k, better(refs.get(k), r, cutoff));
  }

  let hasReference = false;
  let firstDay = null;
  const movers = [];
  for (const c of cards || []) {
    if (c.deleted) continue;
    const k = keyOf(c.id, c.set_code, c.language, c.rarity);
    const own = owned.get(k);
    const ref = refs.get(k);
    if (!own || !ref) continue;
    if (ref.day > cutoff) {
      const d = addDays(ref.day, days);
      if (firstDay == null || d < firstDay) firstDay = d;
      continue;
    }
    hasReference = true;
    const oldPrice = Number(ref.price);
    const newPrice = Number(c.price);
    if (!(newPrice > 0) || !(oldPrice > 0)) continue;
    const fam = familyOfSource(ref.source);
    if (fam !== familyOfLock(c.price_locked) || fam === 'manual' || fam === 'unknown') continue;
    const deltaUnit = round(newPrice - oldPrice, 100);
    if (deltaUnit === 0) continue;
    movers.push({
      key: k, id: c.id, set_code: c.set_code, language: c.language, rarity: c.rarity,
      name: c.name, image_url: c.image_url,
      oldPrice, newPrice, deltaUnit,
      pct: round(((newPrice - oldPrice) / oldPrice) * 100, 10),
      weight: round(own.weight, 100),
      copies: own.count,
      deltaHolding: round((newPrice - oldPrice) * own.weight, 100),
    });
  }

  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const winners = movers.filter((m) => m.deltaHolding > 0)
    .sort((a, b) => (b.deltaHolding - a.deltaHolding) || byKey(a, b)).slice(0, top);
  const losers = movers.filter((m) => m.deltaHolding < 0)
    .sort((a, b) => (a.deltaHolding - b.deltaHolding) || byKey(a, b)).slice(0, top);
  const status = hasReference ? 'ok' : 'no_reference';
  return { status, firstDay: status === 'no_reference' ? firstDay : null, winners, losers };
}

module.exports = { computeMovers, familyOfSource, familyOfLock, addDays, keyOf };
```

- [ ] **Step 6: Run → PASS** (gleicher Befehl, dann die ganze Suite `electron/*.test.cjs`)

- [ ] **Step 7: Commit**
```bash
git add desktop/electron/price-families.json desktop/electron/movers.cjs desktop/electron/movers.test.cjs docs/fixtures/portfolio/movers.json
git commit -m "feat(desktop): Regel fuer Preisbewegungen (G1) mit gemeinsamer Fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Regel „Bewegung" — Kotlin-Zwilling (`ml/Movers.kt`)

**Files:**
- Create: `M/ml/PriceFamily.kt`, `M/ml/Movers.kt`
- Create: `T/Fixtures.kt`, `T/PriceFamilyTest.kt`, `T/MoversTest.kt`
- Modify: `M/cloud/CardRow.kt` (Feld `priceLocked`), `M/cloud/CollectionRepository.kt:305-332` (`parse`)

**Interfaces:**
- Consumes: `docs/fixtures/portfolio/movers.json`, `desktop/electron/price-families.json` (Task 1); `Valuation.factor(condition)`; `CardRow.printingKey()`, `CopyRow.printingKey()`.
- Produces:
  - `data class PriceRef(val cardId: String, val setCode: String, val language: String, val rarity: String, val day: String, val price: Double, val source: String) { fun key(): String }`
  - `object PriceFamily { val BY_SOURCE: Map<String,String>; val LABELS: Map<String,String>; fun ofSource(source: String?): String; fun ofLock(priceLocked: Int?): String }`
  - `object UtcDay { fun today(): String; fun add(day: String, n: Int): String; fun formatDe(day: String): String /* "23.09." */ }`
  - `data class Mover(val key: String, val card: CardRow, val oldPrice: Double, val newPrice: Double, val deltaUnit: Double, val pct: Double, val weight: Double, val copies: Int, val deltaHolding: Double)`
  - `data class MoversResult(val status: String, val firstDay: String?, val winners: List<Mover>, val losers: List<Mover>)` mit `status` ∈ `"ok"`, `"no_reference"`
  - `object Movers { fun compute(cards: List<CardRow>, copies: List<CopyRow>, references: List<PriceRef>, today: String, days: Int, top: Int = 10): MoversResult }`
  - `CardRow.priceLocked: Int = 0` (letzter Parameter)

- [ ] **Step 1: `CardRow` erweitern und parsen**

In `M/cloud/CardRow.kt` nach `val updatedAt: String? = null,` ergänzen:
```kotlin
    // Spec G1 §4.2: Quellenfamilie des aktuellen Preises (0 YGOPRODeck, 1 Cardmarket, 2 manuell). Nur gelesen.
    val priceLocked: Int = 0,
```
In `CollectionRepository.parse` nach `updatedAt = o.strOrNull("updated_at"),`:
```kotlin
                    priceLocked = if (o.isNull("price_locked")) 0 else o.optInt("price_locked", 0),
```

- [ ] **Step 2: Test-Hilfe für Fixtures**

`T/Fixtures.kt`:
```kotlin
package com.example.yugiohscanner

import java.io.File

/** Liest eine Datei relativ zur Repo-Wurzel; sucht vom Arbeitsverzeichnis (android/app) aufwaerts. */
object Fixtures {
    fun text(relative: String): String {
        var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
        while (dir != null) {
            val f = File(dir, relative)
            if (f.exists()) return f.readText()
            dir = dir.parentFile
        }
        error("Fixture nicht gefunden: $relative")
    }
}
```

- [ ] **Step 3: Failing tests**

`T/PriceFamilyTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.PriceFamily
import com.example.yugiohscanner.ml.UtcDay
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class PriceFamilyTest {
    @Test fun `Zuordnung gleicht desktop price-families json`() {
        val json = JSONObject(Fixtures.text("desktop/electron/price-families.json"))
        val fromJson = json.keys().asSequence().associateWith { json.getString(it) }
        assertEquals(fromJson, PriceFamily.BY_SOURCE)
    }

    @Test fun `Familie aus Quelle und Sperre`() {
        assertEquals("cm", PriceFamily.ofSource("cloud"))
        assertEquals("unknown", PriceFamily.ofSource("import"))
        assertEquals("unknown", PriceFamily.ofSource(null))
        assertEquals("ygo", PriceFamily.ofLock(null))
        assertEquals("ygo", PriceFamily.ofLock(0))
        assertEquals("cm", PriceFamily.ofLock(1))
        assertEquals("manual", PriceFamily.ofLock(2))
        assertEquals("unknown", PriceFamily.ofLock(7))
    }

    @Test fun `Tage in UTC und deutsches Kurzdatum`() {
        assertEquals("2026-08-21", UtcDay.add("2026-09-20", -30))
        assertEquals("2027-01-01", UtcDay.add("2026-12-31", 1))
        assertEquals("23.09.", UtcDay.formatDe("2026-09-23"))
    }
}
```

`T/MoversTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.Movers
import com.example.yugiohscanner.ml.PriceRef
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/electron/movers.test.cjs -- dieselbe Fixture docs/fixtures/portfolio/movers.json. */
class MoversTest {
    private fun JSONObject.strOrNull(k: String): String? = if (isNull(k)) null else getString(k)

    private fun cards(a: JSONArray) = (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        CardRow(
            id = o.getString("id"), setCode = o.getString("set_code"), language = o.getString("language"),
            name = o.strOrNull("name"), imageUrl = o.strOrNull("image_url"), rarity = o.strOrNull("rarity"),
            quantity = 1, price = if (o.isNull("price")) null else o.getDouble("price"),
            deleted = o.optBoolean("deleted", false), priceLocked = o.optInt("price_locked", 0),
        )
    }

    private fun copies(a: JSONArray) = (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        CopyRow(
            copyId = "c$i", cardId = o.getString("card_id"), setCode = o.getString("set_code"),
            language = o.getString("language"), rarity = o.getString("rarity"), edition = "unknown",
            condition = o.getString("condition"), deleted = o.optBoolean("deleted", false),
            containerId = null, page = null, slot = null, tags = null, note = null,
        )
    }

    private fun refs(a: JSONArray) = (0 until a.length()).map { i ->
        val o = a.getJSONObject(i)
        PriceRef(o.getString("card_id"), o.getString("set_code"), o.getString("language"), o.getString("rarity"),
            o.getString("day"), o.getDouble("price"), o.getString("source"))
    }

    @Test fun `alle Fixture-Faelle`() {
        val cases = JSONObject(Fixtures.text("docs/fixtures/portfolio/movers.json")).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val inp = c.getJSONObject("input")
            val exp = c.getJSONObject("expected")
            val r = Movers.compute(
                cards(inp.getJSONArray("cards")), copies(inp.getJSONArray("copies")), refs(inp.getJSONArray("references")),
                inp.getString("today"), inp.getInt("days"), inp.getInt("top"),
            )
            assertEquals(name, exp.getString("status"), r.status)
            assertEquals(name, if (exp.isNull("firstDay")) null else exp.getString("firstDay"), r.firstDay)
            for ((listName, got) in listOf("winners" to r.winners, "losers" to r.losers)) {
                val e = exp.getJSONArray(listName)
                assertEquals("$name $listName", e.length(), got.size)
                got.forEachIndexed { j, m ->
                    val x = e.getJSONObject(j)
                    val at = "$name $listName[$j]"
                    assertEquals(at, x.getString("key"), m.key)
                    assertEquals(at, x.getInt("copies"), m.copies)
                    assertEquals(at, x.getDouble("oldPrice"), m.oldPrice, 1e-9)
                    assertEquals(at, x.getDouble("newPrice"), m.newPrice, 1e-9)
                    assertEquals(at, x.getDouble("deltaUnit"), m.deltaUnit, 1e-9)
                    assertEquals(at, x.getDouble("pct"), m.pct, 1e-9)
                    assertEquals(at, x.getDouble("weight"), m.weight, 1e-9)
                    assertEquals(at, x.getDouble("deltaHolding"), m.deltaHolding, 1e-9)
                }
            }
        }
    }
}
```

- [ ] **Step 4: Run → FAIL** (Kompilierfehler: `PriceFamily`, `Movers` unbekannt)

- [ ] **Step 5: Implementieren**

`M/ml/PriceFamily.kt`:
```kotlin
package com.example.yugiohscanner.ml

import java.time.LocalDate
import java.time.ZoneOffset

/** Eine Zeile aus price_history (Variante base): Referenzpreis oder Verlaufspunkt (Spec G1 §4.2/§4.5). */
data class PriceRef(
    val cardId: String, val setCode: String, val language: String, val rarity: String,
    val day: String, val price: Double, val source: String,
) {
    fun key(): String = "$cardId|$setCode|$language|$rarity"
}

/**
 * Quellenfamilien (Spec G1 §4.2). MUSS desktop/electron/price-families.json gleichen -- PriceFamilyTest
 * vergleicht beide. ofLock ist der Zwilling von movers.cjs#familyOfLock.
 */
object PriceFamily {
    val BY_SOURCE: Map<String, String> = mapOf(
        "cm_bulk" to "cm", "cm_scrape" to "cm", "cloud" to "cm", "ygoprodeck" to "ygo", "manual" to "manual",
    )
    val LABELS: Map<String, String> = mapOf(
        "cm" to "Cardmarket", "ygo" to "YGOPRODeck", "manual" to "manuell", "unknown" to "unbekannt",
    )

    fun ofSource(source: String?): String = BY_SOURCE[source] ?: "unknown"

    fun ofLock(priceLocked: Int?): String = when (priceLocked ?: 0) {
        0 -> "ygo"
        1 -> "cm"
        2 -> "manual"
        else -> "unknown"
    }
}

/** "Heute" ist ueberall das UTC-Datum (Spec G1 §4.2). */
object UtcDay {
    fun today(): String = LocalDate.now(ZoneOffset.UTC).toString()
    fun add(day: String, n: Int): String = LocalDate.parse(day).plusDays(n.toLong()).toString()
    fun formatDe(day: String): String = "${day.substring(8, 10)}.${day.substring(5, 7)}."
}
```

`M/ml/Movers.kt`:
```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey

data class Mover(
    val key: String, val card: CardRow,
    val oldPrice: Double, val newPrice: Double, val deltaUnit: Double, val pct: Double,
    val weight: Double, val copies: Int, val deltaHolding: Double,
)

data class MoversResult(val status: String, val firstDay: String?, val winners: List<Mover>, val losers: List<Mover>)

/**
 * Spec G1 §4.2 -- was als Bewegung zaehlt.
 * ZWILLING: desktop/electron/movers.cjs. Beide laufen gegen docs/fixtures/portfolio/movers.json.
 * Wer eine Seite aendert, aendert beide.
 */
object Movers {
    private fun round(x: Double, f: Double): Double = Math.round(x * f).toDouble() / f

    private fun better(a: PriceRef?, b: PriceRef, cutoff: String): PriceRef {
        if (a == null) return b
        val aIn = a.day <= cutoff
        val bIn = b.day <= cutoff
        if (aIn != bIn) return if (aIn) a else b
        return if (aIn) { if (b.day > a.day) b else a } else { if (b.day < a.day) b else a }
    }

    fun compute(
        cards: List<CardRow>, copies: List<CopyRow>, references: List<PriceRef>,
        today: String, days: Int, top: Int = 10,
    ): MoversResult {
        val cutoff = UtcDay.add(today, -days)

        val weight = HashMap<String, Double>()
        val count = HashMap<String, Int>()
        for (c in copies) {
            if (c.deleted) continue
            val k = c.printingKey()
            weight[k] = (weight[k] ?: 0.0) + Valuation.factor(c.condition)
            count[k] = (count[k] ?: 0) + 1
        }

        val refs = HashMap<String, PriceRef>()
        for (r in references) refs[r.key()] = better(refs[r.key()], r, cutoff)

        var hasReference = false
        var firstDay: String? = null
        val movers = ArrayList<Mover>()
        for (c in cards) {
            if (c.deleted) continue
            val k = c.printingKey()
            val w = weight[k] ?: continue
            val ref = refs[k] ?: continue
            if (ref.day > cutoff) {
                val d = UtcDay.add(ref.day, days)
                if (firstDay == null || d < firstDay) firstDay = d
                continue
            }
            hasReference = true
            val oldPrice = ref.price
            val newPrice = c.price ?: 0.0
            if (newPrice <= 0.0 || oldPrice <= 0.0) continue
            val fam = PriceFamily.ofSource(ref.source)
            if (fam != PriceFamily.ofLock(c.priceLocked) || fam == "manual" || fam == "unknown") continue
            val deltaUnit = round(newPrice - oldPrice, 100.0)
            if (deltaUnit == 0.0) continue
            movers += Mover(
                key = k, card = c, oldPrice = oldPrice, newPrice = newPrice, deltaUnit = deltaUnit,
                pct = round((newPrice - oldPrice) / oldPrice * 100.0, 10.0),
                weight = round(w, 100.0), copies = count[k] ?: 0,
                deltaHolding = round((newPrice - oldPrice) * w, 100.0),
            )
        }

        val winners = movers.filter { it.deltaHolding > 0.0 }
            .sortedWith(compareByDescending<Mover> { it.deltaHolding }.thenBy { it.key }).take(top)
        val losers = movers.filter { it.deltaHolding < 0.0 }
            .sortedWith(compareBy<Mover> { it.deltaHolding }.thenBy { it.key }).take(top)
        val status = if (hasReference) "ok" else "no_reference"
        return MoversResult(status, if (status == "no_reference") firstDay else null, winners, losers)
    }
}
```
Hinweis: `deltaUnit == 0.0` ist für `-0.0` in Kotlin `true` (primitiver Vergleich) — genau wie `=== 0` in JS.

- [ ] **Step 6: Run → PASS** (Android-Befehl aus den Global Constraints; alle Tests grün)

- [ ] **Step 7: Commit**
```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/PriceFamily.kt android/app/src/main/java/com/example/yugiohscanner/ml/Movers.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CardRow.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CollectionRepository.kt android/app/src/test/java/com/example/yugiohscanner/Fixtures.kt android/app/src/test/java/com/example/yugiohscanner/PriceFamilyTest.kt android/app/src/test/java/com/example/yugiohscanner/MoversTest.kt
git commit -m "feat(android): Kotlin-Zwilling der Bewegungsregel (G1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Stufenlinie — Desktop (`priceSteps.js`) + gemeinsame Fixture

**Files:**
- Create: `desktop/src/utils/priceSteps.js`
- Create: `docs/fixtures/portfolio/price-steps.json`
- Test: `desktop/src/utils/priceSteps.test.js`

**Interfaces:**
- Consumes: `desktop/electron/price-families.json` (Task 1)
- Produces (ESM):
  - `familyOfSource(source) → 'cm'|'ygo'|'manual'|'unknown'`
  - `FAMILY_LABELS = { cm: 'Cardmarket', ygo: 'YGOPRODeck', manual: 'manuell', unknown: 'unbekannt' }`
  - `todayUtc(now = new Date()) → 'YYYY-MM-DD'`, `addDaysUtc(day, n) → 'YYYY-MM-DD'`, `fmtDayDE(day) → 'TT.MM.'`
  - `computeSteps(rows, today, windowDays)` mit `rows [{day, price, source}]` →
    `{ kind: 'none', points: [], markers: [] }` |
    `{ kind: 'flat', flatDay, flatPrice, points: [], markers: [] }` |
    `{ kind: 'series', points: [{day, price}], markers: [{day, family}] }`

**Regel (Spec §4.5):** Zeilen nach `day` sortieren. 0 Zeilen → `none`. 1 Zeile → `flat`. Sonst: `start = today − windowDays`; die letzte Zeile mit `day < start` ist der Anfangswert und wird als Punkt bei `start` gesetzt (nicht, wenn die erste Zeile im Fenster genau auf `start` liegt). Jede Zeile mit `start ≤ day ≤ today` wird Punkt. Eine Wechselmarke entsteht an jeder Fenster-Zeile, deren Quellenfamilie sich von der **unmittelbar vorigen Zeile der ganzen Liste** unterscheidet (Familie der neuen Zeile). Liegt der letzte Punkt nicht auf `today`, wird er mit gleichem Preis bis `today` verlängert. Liegen alle Zeilen vor dem Fenster, besteht die Linie aus `start` und `today` mit dem letzten Preis.

- [ ] **Step 1: Fixture schreiben**

`docs/fixtures/portfolio/price-steps.json`:
```json
{
  "cases": [
    { "name": "keine Zeile", "today": "2026-09-20", "window": 30, "rows": [],
      "expected": { "kind": "none", "points": [], "markers": [] } },
    { "name": "eine Zeile", "today": "2026-09-20", "window": 30,
      "rows": [ { "day": "2026-09-05", "price": 12.4, "source": "cm_bulk" } ],
      "expected": { "kind": "flat", "flatDay": "2026-09-05", "flatPrice": 12.4, "points": [], "markers": [] } },
    { "name": "Anfangswert vor dem Fenster, Wechselmarke, Verlaengerung bis heute", "today": "2026-09-20", "window": 30,
      "rows": [
        { "day": "2026-08-01", "price": 10, "source": "ygoprodeck" },
        { "day": "2026-09-01", "price": 12, "source": "cm_bulk" },
        { "day": "2026-09-10", "price": 11, "source": "cm_bulk" }
      ],
      "expected": { "kind": "series",
        "points": [ { "day": "2026-08-21", "price": 10 }, { "day": "2026-09-01", "price": 12 }, { "day": "2026-09-10", "price": 11 }, { "day": "2026-09-20", "price": 11 } ],
        "markers": [ { "day": "2026-09-01", "family": "cm" } ] } },
    { "name": "alles im Fenster, letzter Punkt heute, cloud und cm_bulk sind eine Familie", "today": "2026-09-20", "window": 30,
      "rows": [
        { "day": "2026-09-15", "price": 3, "source": "cloud" },
        { "day": "2026-09-20", "price": 4, "source": "cm_bulk" }
      ],
      "expected": { "kind": "series",
        "points": [ { "day": "2026-09-15", "price": 3 }, { "day": "2026-09-20", "price": 4 } ],
        "markers": [] } },
    { "name": "unsortierte Eingabe, 7 Tage", "today": "2026-09-20", "window": 7,
      "rows": [
        { "day": "2026-09-18", "price": 5, "source": "ygoprodeck" },
        { "day": "2026-09-12", "price": 6, "source": "ygoprodeck" }
      ],
      "expected": { "kind": "series",
        "points": [ { "day": "2026-09-13", "price": 6 }, { "day": "2026-09-18", "price": 5 }, { "day": "2026-09-20", "price": 5 } ],
        "markers": [] } },
    { "name": "alle Zeilen vor dem Fenster", "today": "2026-09-20", "window": 30,
      "rows": [
        { "day": "2026-07-01", "price": 5, "source": "ygoprodeck" },
        { "day": "2026-07-15", "price": 6, "source": "ygoprodeck" }
      ],
      "expected": { "kind": "series",
        "points": [ { "day": "2026-08-21", "price": 6 }, { "day": "2026-09-20", "price": 6 } ],
        "markers": [] } },
    { "name": "erste Fensterzeile genau am Fensteranfang", "today": "2026-09-20", "window": 7,
      "rows": [
        { "day": "2026-09-01", "price": 2, "source": "manual" },
        { "day": "2026-09-13", "price": 3, "source": "cm_scrape" }
      ],
      "expected": { "kind": "series",
        "points": [ { "day": "2026-09-13", "price": 3 }, { "day": "2026-09-20", "price": 3 } ],
        "markers": [ { "day": "2026-09-13", "family": "cm" } ] } }
  ]
}
```

- [ ] **Step 2: Failing test**

`desktop/src/utils/priceSteps.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeSteps, familyOfSource, addDaysUtc, fmtDayDE, todayUtc } from './priceSteps.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/PriceStepsTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/portfolio/price-steps.json', import.meta.url), 'utf8'));

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    assert.deepEqual(computeSteps(c.rows, c.today, c.window), c.expected);
  });
}

test('Hilfen: Familie, Tage, Kurzdatum, heute', () => {
  assert.equal(familyOfSource('cm_scrape'), 'cm');
  assert.equal(familyOfSource(undefined), 'unknown');
  assert.equal(addDaysUtc('2026-03-01', -1), '2026-02-28');
  assert.equal(fmtDayDE('2026-09-23'), '23.09.');
  assert.equal(todayUtc(new Date('2026-09-20T23:30:00-02:00')), '2026-09-21');
});
```

- [ ] **Step 3: Run → FAIL** — `cd desktop && node --test src/utils/priceSteps.test.js`

- [ ] **Step 4: Implementieren**

`desktop/src/utils/priceSteps.js`:
```js
import FAMILIES from '../../electron/price-families.json' with { type: 'json' };

// Spec G1 §4.5 — Stufenlinie des Preisverlaufs.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/PriceSteps.kt. Beide laufen gegen
// docs/fixtures/portfolio/price-steps.json. Wer eine Seite aendert, aendert beide.

export const familyOfSource = (source) => FAMILIES[source] || 'unknown';
export const FAMILY_LABELS = { cm: 'Cardmarket', ygo: 'YGOPRODeck', manual: 'manuell', unknown: 'unbekannt' };

export const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

export function addDaysUtc(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const fmtDayDE = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}.`;

export function computeSteps(rows, today, windowDays) {
  const sorted = [...(rows || [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  if (sorted.length === 0) return { kind: 'none', points: [], markers: [] };
  if (sorted.length === 1) {
    return { kind: 'flat', flatDay: sorted[0].day, flatPrice: Number(sorted[0].price), points: [], markers: [] };
  }
  const start = addDaysUtc(today, -windowDays);
  const points = [];
  const markers = [];
  let before = null;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.day < start) { before = r; continue; }
    if (r.day > today) continue;
    if (points.length === 0 && before && r.day !== start) points.push({ day: start, price: Number(before.price) });
    points.push({ day: r.day, price: Number(r.price) });
    const prev = sorted[i - 1];
    if (prev && familyOfSource(prev.source) !== familyOfSource(r.source)) {
      markers.push({ day: r.day, family: familyOfSource(r.source) });
    }
  }
  if (points.length === 0 && before) points.push({ day: start, price: Number(before.price) });
  const last = points[points.length - 1];
  if (last && last.day !== today) points.push({ day: today, price: last.price });
  return { kind: 'series', points, markers };
}
```

- [ ] **Step 5: Run → PASS** (gleicher Befehl, dann `node --test src/utils/*.test.js src/utils/*.test.mjs`)

- [ ] **Step 6: Commit**
```bash
git add desktop/src/utils/priceSteps.js desktop/src/utils/priceSteps.test.js docs/fixtures/portfolio/price-steps.json
git commit -m "feat(desktop): Stufenlinie fuer den Preisverlauf (G1) mit gemeinsamer Fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Stufenlinie — Kotlin-Zwilling (`ml/PriceSteps.kt`)

**Files:**
- Create: `M/ml/PriceSteps.kt`
- Test: `T/PriceStepsTest.kt`

**Interfaces:**
- Consumes: `PriceRef`, `PriceFamily.ofSource`, `UtcDay.add` (Task 2); Fixture aus Task 3.
- Produces:
  - `data class StepPoint(val day: String, val price: Double)`
  - `data class StepMarker(val day: String, val family: String)`
  - `data class Steps(val kind: String, val flatDay: String? = null, val flatPrice: Double? = null, val points: List<StepPoint> = emptyList(), val markers: List<StepMarker> = emptyList())` mit `kind` ∈ `"none"`, `"flat"`, `"series"`
  - `object PriceSteps { fun compute(rows: List<PriceRef>, today: String, windowDays: Int): Steps }`

- [ ] **Step 1: Failing test**

`T/PriceStepsTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.PriceRef
import com.example.yugiohscanner.ml.PriceSteps
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/priceSteps.test.js -- dieselbe Fixture docs/fixtures/portfolio/price-steps.json. */
class PriceStepsTest {
    @Test fun `alle Fixture-Faelle`() {
        val cases = JSONObject(Fixtures.text("docs/fixtures/portfolio/price-steps.json")).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val name = c.getString("name")
            val rowsJson = c.getJSONArray("rows")
            val rows = (0 until rowsJson.length()).map { j ->
                val o = rowsJson.getJSONObject(j)
                PriceRef("1", "X", "DE", "Common", o.getString("day"), o.getDouble("price"), o.getString("source"))
            }
            val s = PriceSteps.compute(rows, c.getString("today"), c.getInt("window"))
            val e = c.getJSONObject("expected")
            assertEquals(name, e.getString("kind"), s.kind)
            if (e.has("flatDay")) {
                assertEquals(name, e.getString("flatDay"), s.flatDay)
                assertEquals(name, e.getDouble("flatPrice"), s.flatPrice!!, 1e-9)
            }
            val ep = e.getJSONArray("points")
            assertEquals("$name points", ep.length(), s.points.size)
            s.points.forEachIndexed { j, p ->
                assertEquals("$name points[$j]", ep.getJSONObject(j).getString("day"), p.day)
                assertEquals("$name points[$j]", ep.getJSONObject(j).getDouble("price"), p.price, 1e-9)
            }
            val em = e.getJSONArray("markers")
            assertEquals("$name markers", em.length(), s.markers.size)
            s.markers.forEachIndexed { j, m ->
                assertEquals("$name markers[$j]", em.getJSONObject(j).getString("day"), m.day)
                assertEquals("$name markers[$j]", em.getJSONObject(j).getString("family"), m.family)
            }
        }
    }
}
```

- [ ] **Step 2: Run → FAIL** (Kompilierfehler `PriceSteps`)

- [ ] **Step 3: Implementieren**

`M/ml/PriceSteps.kt`:
```kotlin
package com.example.yugiohscanner.ml

data class StepPoint(val day: String, val price: Double)
data class StepMarker(val day: String, val family: String)
data class Steps(
    val kind: String,
    val flatDay: String? = null,
    val flatPrice: Double? = null,
    val points: List<StepPoint> = emptyList(),
    val markers: List<StepMarker> = emptyList(),
)

/**
 * Spec G1 §4.5 -- Stufenlinie des Preisverlaufs.
 * ZWILLING: desktop/src/utils/priceSteps.js. Beide laufen gegen docs/fixtures/portfolio/price-steps.json.
 * Wer eine Seite aendert, aendert beide.
 */
object PriceSteps {
    fun compute(rows: List<PriceRef>, today: String, windowDays: Int): Steps {
        val sorted = rows.sortedBy { it.day }
        if (sorted.isEmpty()) return Steps("none")
        if (sorted.size == 1) return Steps("flat", flatDay = sorted[0].day, flatPrice = sorted[0].price)
        val start = UtcDay.add(today, -windowDays)
        val points = ArrayList<StepPoint>()
        val markers = ArrayList<StepMarker>()
        var before: PriceRef? = null
        for (i in sorted.indices) {
            val r = sorted[i]
            if (r.day < start) { before = r; continue }
            if (r.day > today) continue
            val b = before
            if (points.isEmpty() && b != null && r.day != start) points += StepPoint(start, b.price)
            points += StepPoint(r.day, r.price)
            if (i > 0) {
                val prevFam = PriceFamily.ofSource(sorted[i - 1].source)
                val fam = PriceFamily.ofSource(r.source)
                if (prevFam != fam) markers += StepMarker(r.day, fam)
            }
        }
        val b = before
        if (points.isEmpty() && b != null) points += StepPoint(start, b.price)
        val last = points.lastOrNull()
        if (last != null && last.day != today) points += StepPoint(today, last.price)
        return Steps("series", points = points, markers = markers)
    }
}
```

- [ ] **Step 4: Run → PASS** (Android-Befehl)

- [ ] **Step 5: Commit**
```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/PriceSteps.kt android/app/src/test/java/com/example/yugiohscanner/PriceStepsTest.kt
git commit -m "feat(android): Kotlin-Zwilling der Stufenlinie (G1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Desktop-Datenwege — Referenzabfrage, Kartenverlauf, Startzeile, Wertverlauf, IPC

**Files:**
- Create: `desktop/electron/price-reference.cjs`, `desktop/electron/price-reference.test.cjs`
- Create: `desktop/electron/portfolio-value.cjs`, `desktop/electron/portfolio-value.test.cjs`
- Modify: `desktop/electron/price-history.cjs` (Export `norm`, neue `seedPriceHistory`), `desktop/electron/price-history.test.cjs`
- Modify: `desktop/electron/database.cjs:4` (require) und `:282-283` (Startzeile nach `reconcileCopies`)
- Modify: `desktop/electron/main.cjs` (requires; IPC `get-movers`, `get-card-history`; `recordPortfolioValue` in allen Preisschreibern)
- Modify: `desktop/electron/preload.cjs`

**Interfaces:**
- Consumes: `computeMovers`, `addDays` (Task 1); `copies.listAllCopies(db)` (liefert nur `deleted = 0`); `totalValue(db)` aus `valuation.cjs`.
- Produces:
  - `price-reference.cjs`: `referenceRows(db, cutoff) → [{card_id,set_code,language,rarity,day,price,source}]` (pro Printing letzte `base`-Zeile mit `day <= cutoff`, sonst die früheste); `cardHistory(db, printing) → [{day,price,source}]` aufsteigend, höchstens 1000 jüngste.
  - `price-history.cjs`: zusätzlich `norm(printing)` und `seedPriceHistory(db, today?) → { inserted: number, skipped: boolean }` (Setting `price_history_seeded`).
  - `portfolio-value.cjs`: `recordPortfolioValue(db) → boolean` (schreibt `portfolio_history`, wenn noch keine Zeile da ist oder `|totalValue − letzte total_value| > 0.5`).
  - IPC `get-movers` mit `{ days }` (7 oder 30, alles andere → 7) → Rückgabe von `computeMovers` mit `top: 10`; wirft bei DB-Fehler.
  - IPC `get-card-history` mit `{ id, set_code, language, rarity }` → `cardHistory`; wirft bei DB-Fehler.
  - preload: `getMovers(days)`, `getCardHistory(printing)`.

- [ ] **Step 1: Failing tests Referenzabfrage + Kartenverlauf**

`desktop/electron/price-reference.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { referenceRows, cardHistory } = require('./price-reference.cjs');

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d);
  const ins = d.prepare(`INSERT INTO price_history (card_id,set_code,language,rarity,variant,day,price,source) VALUES (?,?,?,?,?,?,?,?)`);
  ins.run('1', 'P-DE001', 'DE', 'Rare', 'base', '2026-09-01', 10, 'cm_bulk');
  ins.run('1', 'P-DE001', 'DE', 'Rare', 'base', '2026-09-10', 11, 'cm_bulk');
  ins.run('1', 'P-DE001', 'DE', 'Rare', 'base', '2026-09-15', 12, 'cm_bulk');
  ins.run('1', 'P-DE001', 'DE', 'Rare', 'first', '2026-09-12', 99, 'cm_scrape');
  ins.run('2', 'Q-DE002', 'DE', 'Common', 'base', '2026-09-18', 3, 'cloud');
  ins.run('2', 'Q-DE002', 'DE', 'Common', 'base', '2026-09-16', 2, 'cloud');
  ins.run('3', 'R-DE003', 'DE', 'Common', 'first', '2026-09-01', 5, 'cm_scrape');
  return d;
}

test('referenceRows: letzte Zeile bis Stichtag, sonst frueheste; Variante first zaehlt nie', () => {
  const rows = referenceRows(db(), '2026-09-13').sort((a, b) => a.card_id.localeCompare(b.card_id));
  assert.deepStrictEqual(rows, [
    { card_id: '1', set_code: 'P-DE001', language: 'DE', rarity: 'Rare', day: '2026-09-10', price: 11, source: 'cm_bulk' },
    { card_id: '2', set_code: 'Q-DE002', language: 'DE', rarity: 'Common', day: '2026-09-16', price: 2, source: 'cloud' },
  ]);
});

test('referenceRows: Zeile genau am Stichtag zaehlt', () => {
  const rows = referenceRows(db(), '2026-09-10').filter((r) => r.card_id === '1');
  assert.equal(rows[0].day, '2026-09-10');
});

test('cardHistory: nur base, aufsteigend', () => {
  const rows = cardHistory(db(), { id: '1', set_code: 'P-DE001', language: 'DE', rarity: 'Rare' });
  assert.deepStrictEqual(rows.map((r) => r.day), ['2026-09-01', '2026-09-10', '2026-09-15']);
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['day', 'price', 'source']);
});
```

- [ ] **Step 2: Run → FAIL**, dann `desktop/electron/price-reference.cjs` implementieren:
```js
// Spec G1 §4.3 — Referenzpreise und Kartenverlauf aus der lokalen price_history (nur Variante base).
// Die Cloud-RPC supabase/price_reference_rpc.sql liefert DIESELBE Auswahl; wer eine aendert, aendert beide.
const { norm } = require('./price-history.cjs');

function referenceRows(db, cutoff) {
  return db.prepare(`
    SELECT card_id, set_code, language, rarity, day, price, source FROM (
      SELECT card_id, set_code, language, rarity, day, price, source,
             ROW_NUMBER() OVER (
               PARTITION BY card_id, set_code, language, rarity
               ORDER BY (day <= @cutoff) DESC,
                        CASE WHEN day <= @cutoff THEN day END DESC,
                        day ASC
             ) AS rn
        FROM price_history
       WHERE variant = 'base'
    ) WHERE rn = 1`).all({ cutoff });
}

function cardHistory(db, printing) {
  const rows = db.prepare(`
    SELECT day, price, source FROM price_history
     WHERE card_id = @card_id AND set_code = @set_code AND language = @language AND rarity = @rarity AND variant = 'base'
     ORDER BY day DESC LIMIT 1000`).all(norm(printing));
  return rows.reverse();
}

module.exports = { referenceRows, cardHistory };
```
In `desktop/electron/price-history.cjs` die letzte Zeile ändern zu:
```js
module.exports = { recordPrice, lastRecorded, norm, seedPriceHistory };
```
(`seedPriceHistory` folgt in Step 4; bis dahin den Export nur um `norm` erweitern.) Run → PASS.

- [ ] **Step 3: Failing tests Startzeile**

In `desktop/electron/price-history.test.cjs` anhängen:
```js
const { seedPriceHistory } = require('./price-history.cjs');

function seedDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, price_locked INTEGER DEFAULT 0, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY, total_value REAL);`);
  ensureCopiesSchema(d);
  const card = d.prepare('INSERT INTO cards (id,set_code,language,rarity,price,price_locked,quantity,deleted) VALUES (?,?,?,?,?,?,0,0)');
  card.run('1', 'A-DE001', 'DE', 'Rare', 5, 1);     // CM, lebend, ohne Zeile -> cm_bulk
  card.run('2', 'A-DE002', 'DE', 'Rare', 3, 0);     // YGO, lebend, ohne Zeile -> ygoprodeck
  card.run('3', 'A-DE003', 'DE', 'Rare', 4, 2);     // manuell -> manual
  card.run('4', 'A-DE004', 'DE', 'Rare', 7, 1);     // hat schon eine Zeile -> unberuehrt
  card.run('5', 'A-DE005', 'DE', 'Rare', null, 1);  // ohne Preis -> keine
  card.run('6', 'A-DE006', 'DE', 'Rare', 9, 1);     // ohne lebendes Exemplar -> keine
  const cp = d.prepare(`INSERT INTO card_copies (copy_id,card_id,set_code,language,rarity,deleted) VALUES (?,?,?,?,?,?)`);
  ['1', '2', '3', '4', '5'].forEach((id) => cp.run(`c${id}`, id, `A-DE00${id}`, 'DE', 'Rare', 0));
  cp.run('c6', '6', 'A-DE006', 'DE', 'Rare', 1);
  d.prepare(`INSERT INTO price_history (card_id,set_code,language,rarity,variant,day,price,source) VALUES ('4','A-DE004','DE','Rare','base','2026-09-01',6,'cm_bulk')`).run();
  return d;
}

test('seedPriceHistory: Startzeile nur fuer lebende Printings mit Preis und ohne base-Zeile, Quelle aus price_locked', () => {
  const d = seedDb();
  const r = seedPriceHistory(d, '2026-09-14');
  assert.deepStrictEqual(r, { inserted: 3, skipped: false });
  const rows = d.prepare(`SELECT card_id, day, price, source, variant FROM price_history ORDER BY card_id`).all();
  assert.deepStrictEqual(rows, [
    { card_id: '1', day: '2026-09-14', price: 5, source: 'cm_bulk', variant: 'base' },
    { card_id: '2', day: '2026-09-14', price: 3, source: 'ygoprodeck', variant: 'base' },
    { card_id: '3', day: '2026-09-14', price: 4, source: 'manual', variant: 'base' },
    { card_id: '4', day: '2026-09-01', price: 6, source: 'cm_bulk', variant: 'base' },
  ]);
});

test('seedPriceHistory: laeuft nur einmal (Setting price_history_seeded)', () => {
  const d = seedDb();
  seedPriceHistory(d, '2026-09-14');
  d.prepare(`UPDATE cards SET price = 8 WHERE id = '6'`).run();
  d.prepare(`UPDATE card_copies SET deleted = 0 WHERE copy_id = 'c6'`).run();
  assert.deepStrictEqual(seedPriceHistory(d, '2026-09-15'), { inserted: 0, skipped: true });
});

test('seedPriceHistory: ohne Setting, aber mit vorhandenen Zeilen idempotent', () => {
  const d = seedDb();
  seedPriceHistory(d, '2026-09-14');
  d.prepare(`DELETE FROM settings WHERE key = 'price_history_seeded'`).run();
  assert.deepStrictEqual(seedPriceHistory(d, '2026-09-14'), { inserted: 0, skipped: false });
});
```

- [ ] **Step 4: Run → FAIL**, dann in `price-history.cjs` vor `module.exports` ergänzen:
```js
// Spec G1 §4.2 — einmalige Startzeile: ohne sie haette die erste Preisaenderung eines Printings kein
// "Damals", weil recordPrice nur den NEUEN Preis schreibt. Quelle aus price_locked (1 CM, 2 manuell,
// sonst YGOPRODeck). Die Cloud-Absicherung supabase/price_history_seed.sql folgt derselben Regel.
function seedPriceHistory(db, today = new Date().toISOString().slice(0, 10)) {
  const flag = db.prepare(`SELECT value FROM settings WHERE key = 'price_history_seeded'`).get();
  if (flag && flag.value === '1') return { inserted: 0, skipped: true };
  let inserted = 0;
  db.transaction(() => {
    inserted = db.prepare(`
      INSERT OR IGNORE INTO price_history (card_id, set_code, language, rarity, variant, day, price, source, recorded_at)
      SELECT c.id, c.set_code, c.language, c.rarity, 'base', @today, c.price,
             CASE COALESCE(c.price_locked, 0) WHEN 1 THEN 'cm_bulk' WHEN 2 THEN 'manual' ELSE 'ygoprodeck' END,
             CURRENT_TIMESTAMP
        FROM cards c
       WHERE c.deleted = 0 AND c.price > 0
         AND EXISTS (SELECT 1 FROM card_copies cp WHERE cp.card_id = c.id AND cp.set_code = c.set_code
                       AND cp.language = c.language AND cp.rarity = c.rarity AND cp.deleted = 0)
         AND NOT EXISTS (SELECT 1 FROM price_history h WHERE h.card_id = c.id AND h.set_code = c.set_code
                       AND h.language = c.language AND h.rarity = c.rarity AND h.variant = 'base')`)
      .run({ today }).changes;
    db.prepare(`INSERT INTO settings (key, value) VALUES ('price_history_seeded', '1')
                ON CONFLICT(key) DO UPDATE SET value = '1'`).run();
  })();
  return { inserted, skipped: false };
}
```
Export wie in Step 2 angegeben. Hinweis: Das Einfügen von Exemplaren im Test löst den Recount-Trigger aus; `cards.deleted` wird dadurch für Printing 6 auf 1 gesetzt, das ist gewollt. Run → PASS.

- [ ] **Step 5: Failing test Wertverlauf**

`desktop/electron/portfolio-value.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { recordPortfolioValue } = require('./portfolio-value.cjs');

function db() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE cards (id TEXT, quantity INTEGER, rarity TEXT, set_code TEXT, price REAL, language TEXT, updated_at DATETIME, deleted INTEGER DEFAULT 0, PRIMARY KEY (id,set_code,language,rarity));
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
          CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(d);
  d.prepare(`INSERT INTO cards (id,set_code,language,rarity,price,quantity,deleted) VALUES ('1','A-DE001','DE','Rare',10,0,0)`).run();
  d.prepare(`INSERT INTO card_copies (copy_id,card_id,set_code,language,rarity,condition) VALUES ('c1','1','A-DE001','DE','Rare','NM')`).run();
  return d;
}
const count = (d) => d.prepare('SELECT COUNT(*) n FROM portfolio_history').get().n;

test('erste Zeile wird immer geschrieben', () => {
  const d = db();
  assert.equal(recordPortfolioValue(d), true);
  assert.equal(d.prepare('SELECT total_value FROM portfolio_history').get().total_value, 10);
});

test('0,50 EUR oder weniger Aenderung schreibt nichts, mehr schreibt', () => {
  const d = db();
  recordPortfolioValue(d);
  d.prepare(`UPDATE cards SET price = 10.5 WHERE id = '1'`).run();
  assert.equal(recordPortfolioValue(d), false);
  assert.equal(count(d), 1);
  d.prepare(`UPDATE cards SET price = 10.51 WHERE id = '1'`).run();
  assert.equal(recordPortfolioValue(d), true);
  assert.equal(count(d), 2);
});
```

- [ ] **Step 6: Run → FAIL**, dann `desktop/electron/portfolio-value.cjs`:
```js
// Spec G1 §4.4 — eine Zeile in portfolio_history nach JEDEM Preisschreiber (YGOPRODeck-Poller,
// "Alle aktualisieren", Cardmarket-Bulk, Scraper, manueller Preis), sobald sich der Gesamtwert
// gegenueber der letzten Zeile um mehr als 0,50 EUR bewegt hat.
const { totalValue } = require('./valuation.cjs');

const THRESHOLD_EUR = 0.5;

function recordPortfolioValue(db) {
  const total = totalValue(db);
  const last = db.prepare('SELECT total_value FROM portfolio_history ORDER BY id DESC LIMIT 1').get();
  if (last && Math.abs((last.total_value || 0) - total) <= THRESHOLD_EUR) return false;
  db.prepare('INSERT INTO portfolio_history (total_value) VALUES (?)').run(total);
  return true;
}

module.exports = { recordPortfolioValue };
```
Run → PASS.

- [ ] **Step 7: Startzeile beim Start**

`desktop/electron/database.cjs` Zeile 4 danach ergänzen:
```js
const { seedPriceHistory } = require('./price-history.cjs');
```
Nach Zeile 283 (`if (!rc.skipped && rc.created > 0) …`) ergänzen:
```js
        const seed = seedPriceHistory(db);
        if (!seed.skipped) console.log(`Price history seed: ${seed.inserted} start row(s).`);
```

- [ ] **Step 8: `main.cjs` verdrahten**

Oben bei den requires (nach Zeile 13 `const { recordPrice } = …`):
```js
const { computeMovers, addDays } = require('./movers.cjs');
const { referenceRows, cardHistory } = require('./price-reference.cjs');
const { recordPortfolioValue } = require('./portfolio-value.cjs');
```
Direkt nach dem Handler `get-price-history` (Zeile 553-557) einfügen:
```js
// Spec G1 §4.3: Gewinner/Verlierer ueber 7 oder 30 Tage (Regel in movers.cjs).
ipcMain.handle('get-movers', (event, { days } = {}) => {
    try {
        const n = Number(days) === 30 ? 30 : 7;
        const today = new Date().toISOString().slice(0, 10);
        const cards = db.prepare('SELECT id, set_code, language, rarity, name, image_url, price, price_locked FROM cards WHERE deleted = 0').all();
        return computeMovers({ cards, copies: copies.listAllCopies(db), references: referenceRows(db, addDays(today, -n)), today, days: n, top: 10 });
    } catch (e) { console.error('[get-movers]', e); throw new Error('Bewegungen konnten nicht geladen werden.'); }
});

ipcMain.handle('get-card-history', (event, printing) => {
    try { return cardHistory(db, printing || {}); }
    catch (e) { console.error('[get-card-history]', e); throw new Error('Verlauf nicht verfügbar.'); }
});
```
Preisschreiber (jede Stelle einzeln):
1. `set-card-price` (Zeile 624): nach `recordPrice(db, …, 'manual');` die Zeile `recordPortfolioValue(db);`.
2. `scrape-cardmarket-prices` (Zeile 643-651): nach `const res = await runCardmarketScrape(…);` die Zeile `if (res && res.updated > 0) recordPortfolioValue(db);`.
3. `startCardmarketPoller` (Zeile 671-674): im Block `if (res.updated > 0 && mainWindow) {` als erste Zeile `recordPortfolioValue(db);`.
4. `notifyBulk` (Zeile 688-691): im Block `if (res && res.priced > 0 && mainWindow) {` als erste Zeile `recordPortfolioValue(db);`.
5. `startPricePoller` (Zeile 851-857) ersetzen durch:
```js
            if (updates.length > 0) {
                recordPortfolioValue(db);
                mainWindow.webContents.send('price-update', { updates, totalValue: totalValue(db) });
            }
```
   und die dadurch verwaisten Zeilen `let totalValueChange = 0;` (Zeile 805) und `totalValueChange += (newPrice - (localCard.price || 0));` (Zeile 843) entfernen.
6. `update-all-cards` (Zeile 965-969) ersetzen durch:
```js
        try {
            recordPortfolioValue(db);
            if (mainWindow) mainWindow.webContents.send('price-update', { updates: [], totalValue: totalValue(db) });
        } catch (e) { /* history snapshot is best-effort */ }
```
Danach per Grep prüfen: `INSERT INTO portfolio_history` kommt in `main.cjs` nicht mehr vor.

- [ ] **Step 9: `preload.cjs`**

Nach `getPriceHistory: …` (Zeile 43):
```js
  getMovers: (days) => ipcRenderer.invoke('get-movers', { days }),
  getCardHistory: (printing) => ipcRenderer.invoke('get-card-history', printing),
```

- [ ] **Step 10: Verifizieren**

Run: ganze Suite `electron/*.test.cjs` → PASS; `node --check desktop/electron/main.cjs`; Lint → genau 5 Fehler.

- [ ] **Step 11: Commit**
```bash
git add desktop/electron/price-reference.cjs desktop/electron/price-reference.test.cjs desktop/electron/portfolio-value.cjs desktop/electron/portfolio-value.test.cjs desktop/electron/price-history.cjs desktop/electron/price-history.test.cjs desktop/electron/database.cjs desktop/electron/main.cjs desktop/electron/preload.cjs
git commit -m "feat(desktop): Referenzpreise, Kartenverlauf, Startzeile und Wertverlauf nach jedem Preisschreiber (G1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Cloud-SQL schreiben (nicht ausführen)

**Files:**
- Create: `supabase/price_reference_rpc.sql`, `supabase/price_history_seed.sql`

**Interfaces:**
- Produces: RPC `public.price_reference(days integer)` → Tabelle `(card_id text, set_code text, language text, rarity text, day date, price double precision, source text)`, gleiche Auswahl wie `referenceRows` (Task 5). Aufruf vom Handy: `POST /rest/v1/rpc/price_reference` mit Body `{"days":7}` und Query-Parametern `order`, `limit`, `or`.

**Keine Ausführung, keine Verbindung.** Die Dateien werden nur geschrieben und committet; der Nutzer spielt sie ein (Reihenfolge in Spec §4.10).

- [ ] **Step 1: `supabase/price_reference_rpc.sql`**
```sql
-- supabase/price_reference_rpc.sql — Spec G1 §4.3. Einmal einspielen (idempotent).
-- Pro Printing die letzte price_history-Zeile (Variante base) mit day <= heute - days;
-- gibt es keine, die frueheste (daraus rechnet das Handy "Bewegungen erscheinen ab TT.MM.").
-- Gewichtung und Quellenfamilie stehen bewusst NICHT hier, sondern in ml/Movers.kt bzw. electron/movers.cjs.
-- Gleiche Auswahl wie desktop/electron/price-reference.cjs#referenceRows.
create or replace function public.price_reference(days integer)
returns table (card_id text, set_code text, language text, rarity text, day date, price double precision, source text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (h.card_id, h.set_code, h.language, h.rarity)
         h.card_id, h.set_code, h.language, h.rarity, h.day, h.price, h.source
    from public.price_history h
   where h.variant = 'base'
   order by h.card_id, h.set_code, h.language, h.rarity,
            (h.day <= current_date - days) desc,
            case when h.day <= current_date - days then h.day end desc nulls last,
            h.day asc
$$;

revoke all on function public.price_reference(integer) from public;
revoke all on function public.price_reference(integer) from anon;
grant execute on function public.price_reference(integer) to authenticated;
```

- [ ] **Step 2: `supabase/price_history_seed.sql`**
```sql
-- supabase/price_history_seed.sql — Spec G1 §4.2/§4.10. Absicherung, NACH price_reference_rpc.sql und
-- nachdem der neue Desktop-Build einmal lief. Fuegt nichts hinzu, wenn der Desktop die Startzeilen schon
-- hochgeschoben hat. Gleiche Regel wie desktop/electron/price-history.cjs#seedPriceHistory.
insert into public.price_history (card_id, set_code, language, rarity, variant, day, price, source)
select c.id, c.set_code, c.language, c.rarity, 'base', current_date, c.price,
       case coalesce(c.price_locked, 0) when 1 then 'cm_bulk' when 2 then 'manual' else 'ygoprodeck' end
  from public.cards c
 where c.deleted = false
   and c.price > 0
   and exists (select 1 from public.card_copies cp
                where cp.card_id = c.id and cp.set_code = c.set_code
                  and cp.language = c.language and cp.rarity = c.rarity and cp.deleted = false)
   and not exists (select 1 from public.price_history h
                    where h.card_id = c.id and h.set_code = c.set_code
                      and h.language = c.language and h.rarity = c.rarity and h.variant = 'base')
on conflict (card_id, set_code, language, rarity, variant, day) do nothing;
```

- [ ] **Step 3: Commit**
```bash
git add supabase/price_reference_rpc.sql supabase/price_history_seed.sql
git commit -m "feat(supabase): RPC price_reference und Startzeilen-Absicherung (G1, noch nicht eingespielt)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Desktop — Bewegungen auf Start und in Insights

**Files:**
- Create: `desktop/src/utils/moversText.js`, `desktop/src/utils/moversText.test.js`, `desktop/src/utils/useMovers.js`
- Create: `desktop/src/components/MoversList.jsx` (inkl. `MoversSkeleton`), `desktop/src/components/MoversCard.jsx`, `desktop/src/components/MoversPanel.jsx`
- Modify: `desktop/src/components/Start.jsx` (Karte nach der Hero-Zeile, vor „Zuletzt hinzugefügt", Zeile 185/187)
- Modify: `desktop/src/components/Insights.jsx` (Reiter **Wert · Bewegungen · Aufteilung**; Anfangsreiter aus `location.state?.tab`)

**Interfaces:**
- Consumes: `window.api.getMovers(days)` (Task 5), `fmtDayDE` (Task 3), `cardRoute`, `ROUTES` (`utils/routes.js`), `fmtEUR`, `fmtSignedEUR` (`utils/format.js`).
- Produces:
  - `moversMessage(result, days) → string|null` — `null`, wenn Listen gezeigt werden sollen.
  - `<MoversList movers={Mover[]} full={bool} />` — Zeilen; Klick öffnet das Karten-Panel.
  - `<MoversCard />` — Start-Karte, 7 Tage, je Top 3.
  - `<MoversPanel />` — Insights-Reiter, Umschalter 7/30, je Top 10.
  - `Insights` akzeptiert `navigate(ROUTES.insights, { state: { tab: 'bewegungen' } })`.

- [ ] **Step 1: Failing test Texte**

`desktop/src/utils/moversText.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moversMessage } from './moversText.js';

test('no_reference mit Tag', () => {
  assert.equal(moversMessage({ status: 'no_reference', firstDay: '2026-09-23', winners: [], losers: [] }, 7),
    'Noch nicht genug Verlauf — Bewegungen erscheinen ab 23.09.');
});
test('no_reference ohne Tag', () => {
  assert.equal(moversMessage({ status: 'no_reference', firstDay: null, winners: [], losers: [] }, 30), 'Noch nicht genug Verlauf');
});
test('ok ohne Bewegung', () => {
  assert.equal(moversMessage({ status: 'ok', firstDay: null, winners: [], losers: [] }, 30), 'Keine Bewegungen in 30 Tagen');
});
test('ok mit Bewegung -> Listen zeigen', () => {
  assert.equal(moversMessage({ status: 'ok', firstDay: null, winners: [{}], losers: [] }, 7), null);
});
```

- [ ] **Step 2: Run → FAIL**, dann `desktop/src/utils/moversText.js`:
```js
import { fmtDayDE } from './priceSteps.js';

// Spec G1 §4.8 — Leertexte der Bewegungen. Das Handy (ui/MoversSection.kt) zeigt dieselben Saetze.
export function moversMessage(result, days) {
  if (result.status === 'no_reference') {
    return result.firstDay ? `Noch nicht genug Verlauf — Bewegungen erscheinen ab ${fmtDayDE(result.firstDay)}` : 'Noch nicht genug Verlauf';
  }
  if (result.winners.length === 0 && result.losers.length === 0) return `Keine Bewegungen in ${days} Tagen`;
  return null;
}
```
Run → PASS.

- [ ] **Step 3: `MoversList.jsx`**
```jsx
import { useNavigate, useLocation } from 'react-router-dom';
import { cardRoute } from '../utils/routes';
import { fmtEUR, fmtSignedEUR } from '../utils/format';

// Spec G1 §4.6 — eine Liste Gewinner oder Verlierer. `full` zeigt alt → neu und Exemplare (Insights).
export default function MoversList({ movers, full = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  if (movers.length === 0) return <div className="text-xs text-ink-faint py-2">—</div>;
  const list = movers.map((m) => cardRoute(m));
  return (
    <div className="divide-y divide-line">
      {movers.map((m) => {
        const up = m.deltaHolding > 0;
        return (
          <button key={m.key} type="button"
            onClick={() => navigate(cardRoute(m), { state: { background: location, list } })}
            className="w-full flex items-center gap-3 py-2 text-left hover:bg-white/5 rounded-lg px-2 transition-colors">
            {m.image_url
              ? <img src={m.image_url} alt="" className="w-7 h-10 object-cover rounded border border-line shrink-0" />
              : <div className="w-7 h-10 rounded border border-line bg-obsidian-800 shrink-0" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink truncate">{m.name || m.id}</div>
              <div className="text-[11px] text-ink-faint font-mono truncate">
                {m.set_code} · {m.rarity}{full ? ` · ${fmtEUR(m.oldPrice)} → ${fmtEUR(m.newPrice)} · ${m.copies}×` : ''}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className={`font-mono text-sm ${up ? 'text-good' : 'text-crit'}`}>{fmtSignedEUR(m.deltaHolding)}</div>
              <div className={`font-mono text-[11px] ${up ? 'text-good' : 'text-crit'}`}>{up ? '+' : ''}{m.pct.toFixed(1)} %</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Lade-Hook, Platzhalter und `MoversCard.jsx`**

`desktop/src/utils/useMovers.js` (eigene Datei, damit `react-refresh/only-export-components` in den `.jsx`-Dateien nicht anschlägt):
```js
import { useState, useEffect } from 'react';

// Laedt get-movers und laedt bei Preis- oder Sammlungsaenderung neu. Kein Nullwert beim Laden (Spec §4.8).
export function useMovers(days) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    if (!window.api?.getMovers) { setState({ loading: false, error: 'Bewegungen konnten nicht geladen werden.', data: null }); return undefined; }
    let alive = true;
    const load = () => window.api.getMovers(days)
      .then((data) => { if (alive) setState({ loading: false, error: null, data }); })
      .catch(() => { if (alive) setState((s) => ({ loading: false, error: 'Bewegungen konnten nicht geladen werden.', data: s.data })); });
    load();
    const offPrice = window.api.onPriceUpdate?.(() => load());
    const offColl = window.api.onCollectionChanged?.(() => load());
    return () => { alive = false; offPrice?.(); offColl?.(); };
  }, [days]);
  return state;
}
```

In `desktop/src/components/MoversList.jsx` (Step 3) am Dateiende zusätzlich exportieren (eine weitere Komponente ist für die Lint-Regel erlaubt):
```jsx
export function MoversSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-2 py-1">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-obsidian-800 animate-pulse" />)}
    </div>
  );
}
```

`desktop/src/components/MoversCard.jsx`:
```jsx
import { useNavigate } from 'react-router-dom';
import { TrendingUp, ArrowRight } from 'lucide-react';
import MoversList, { MoversSkeleton } from './MoversList';
import { useMovers } from '../utils/useMovers';
import { moversMessage } from '../utils/moversText';
import { ROUTES } from '../utils/routes';

export default function MoversCard() {
  const navigate = useNavigate();
  const { loading, error, data } = useMovers(7);
  const message = data ? moversMessage(data, 7) : null;
  return (
    <div className="bg-obsidian-700 border border-line rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-sm tracking-[0.12em] uppercase text-ink-muted flex items-center gap-2">
          <TrendingUp className="w-4 h-4" strokeWidth={1.8} /> Bewegungen · 7 Tage
        </h3>
        <button onClick={() => navigate(ROUTES.insights, { state: { tab: 'bewegungen' } })}
          className="text-xs text-violet-soft hover:underline flex items-center gap-1">Alle <ArrowRight className="w-3 h-3" /></button>
      </div>
      {!data && loading && <MoversSkeleton />}
      {!data && !loading && error && <div className="text-sm text-crit">{error}</div>}
      {data && error && <div className="text-[11px] text-ink-faint mb-2">Stand von zuvor — Aktualisieren fehlgeschlagen.</div>}
      {data && message && <div className="text-sm text-ink-faint">{message}</div>}
      {data && !message && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div><div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1">Gewinner</div><MoversList movers={data.winners.slice(0, 3)} /></div>
          <div><div className="text-[11px] uppercase tracking-wide text-ink-faint mb-1">Verlierer</div><MoversList movers={data.losers.slice(0, 3)} /></div>
        </div>
      )}
    </div>
  );
}
```
Die Lint-Zahl muss bei 5 bleiben.

- [ ] **Step 5: `MoversPanel.jsx`**
```jsx
import { useState } from 'react';
import MoversList, { MoversSkeleton } from './MoversList';
import { useMovers } from '../utils/useMovers';
import { moversMessage } from '../utils/moversText';

// Spec G1 §4.6 — Insights-Reiter Bewegungen: 7 oder 30 Tage, je Top 10.
export default function MoversPanel() {
  const [days, setDays] = useState(7);
  const { loading, error, data } = useMovers(days);
  const message = data ? moversMessage(data, days) : null;
  return (
    <div className="space-y-4">
      <div className="inline-flex bg-obsidian-700 border border-line rounded-xl p-1 gap-1">
        {[7, 30].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={`px-4 py-1.5 rounded-lg text-sm ${days === d ? 'bg-space-violet text-white' : 'text-ink-muted hover:text-ink'}`}>
            {d} Tage
          </button>
        ))}
      </div>
      {!data && loading && <MoversSkeleton rows={6} />}
      {!data && !loading && error && <div className="text-sm text-crit">{error}</div>}
      {data && error && <div className="text-[11px] text-ink-faint">Stand von zuvor — Aktualisieren fehlgeschlagen.</div>}
      {data && message && <div className="text-sm text-ink-faint">{message}</div>}
      {data && !message && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-obsidian-700 border border-line rounded-2xl p-5">
            <h3 className="font-display text-sm uppercase tracking-[0.12em] text-ink-muted mb-2">Gewinner</h3>
            <MoversList movers={data.winners} full />
          </div>
          <div className="bg-obsidian-700 border border-line rounded-2xl p-5">
            <h3 className="font-display text-sm uppercase tracking-[0.12em] text-ink-muted mb-2">Verlierer</h3>
            <MoversList movers={data.losers} full />
          </div>
        </div>
      )}
    </div>
  );
}
```
Hinweis: `useMovers(days)` lädt beim Wechsel von 7 auf 30 neu; der alte Stand (`data`) bleibt bis dahin sichtbar. Beim Wechsel muss `loading` nicht erneut `true` werden — die alten Listen stehen, bis die neuen da sind.

- [ ] **Step 6: Start und Insights einbinden**

`Start.jsx`: `import MoversCard from './MoversCard';` und zwischen `{/* Hero row */}…</div>` (endet Zeile 185) und `{/* Recently added */}` einfügen:
```jsx
      {/* Spec G1: Bewegungen */}
      <MoversCard />
```

`Insights.jsx` komplett:
```jsx
import { useState, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { TrendingUp, BarChart3, ArrowUpDown, Loader2 } from 'lucide-react';
import Statistics from './Statistics';
import MoversPanel from './MoversPanel';

const Portfolio = lazy(() => import('./Portfolio'));

const Tab = ({ id, icon, label, view, setView }) => {
  const Icon = icon;
  return (
    <button
      onClick={() => setView(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-display text-sm font-medium transition-colors ${
        view === id ? 'bg-space-violet text-white shadow-[0_6px_16px_-8px_#9D00FF]' : 'text-ink-muted hover:text-ink'
      }`}
    >
      <Icon className="w-4 h-4" strokeWidth={1.8} /> {label}
    </button>
  );
};

export default function Insights() {
  const location = useLocation();
  const [view, setView] = useState(location.state?.tab || 'value');

  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
      <div className="inline-flex self-start bg-obsidian-700 border border-line rounded-xl p-1 gap-1 mb-5">
        <Tab id="value" icon={TrendingUp} label="Wert" view={view} setView={setView} />
        <Tab id="bewegungen" icon={ArrowUpDown} label="Bewegungen" view={view} setView={setView} />
        <Tab id="breakdown" icon={BarChart3} label="Aufteilung" view={view} setView={setView} />
      </div>
      <div className="flex-1 overflow-auto">
        {view === 'value' && (
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-space-violet"><Loader2 className="w-8 h-8 animate-spin" /></div>}>
            <Portfolio />
          </Suspense>
        )}
        {view === 'bewegungen' && <MoversPanel />}
        {view === 'breakdown' && <Statistics />}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verifizieren** — `node --test src/utils/*.test.js src/utils/*.test.mjs` PASS; `npm run build` ohne Fehler; Lint genau 5.

- [ ] **Step 8: Commit**
```bash
git add desktop/src/utils/moversText.js desktop/src/utils/moversText.test.js desktop/src/utils/useMovers.js desktop/src/components/MoversList.jsx desktop/src/components/MoversCard.jsx desktop/src/components/MoversPanel.jsx desktop/src/components/Start.jsx desktop/src/components/Insights.jsx
git commit -m "feat(desktop): Bewegungen auf Start und als Insights-Reiter (G1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Desktop — Aufteilung nach Wert und Binder, Umbenennung

**Files:**
- Create: `desktop/src/utils/breakdown.js`, `desktop/src/utils/breakdown.test.js`
- Create: `desktop/src/components/ValueBreakdown.jsx`
- Modify: `desktop/src/components/Insights.jsx` (Reiter Aufteilung bekommt Umschalter **Anzahl · Wert**)
- Modify: `desktop/src/components/Portfolio.jsx:209` („Top Performers" → „Wertvollste Bestände")

**Interfaces:**
- Consumes: `window.api.getCollection()` (Zeilen mit `value`, `quantity`, `type`, `set_code`, `rarity`), `window.api.listAllCopies()`, `window.api.listContainers()` (`container_id`, `name`), `conditionFactor` (`utils/valuation.js`).
- Produces:
  - `typeGroup(type) → 'Monster'|'Zauber'|'Falle'|'Sonstige'`
  - `UNSORTED_LABEL = 'Nicht einsortiert'`
  - `valueBreakdown({ cards, copies, containers, dimension }) → [{ label, count, value }]`, `dimension` ∈ `'type'|'set'|'rarity'|'binder'`, sortiert nach `value` absteigend, dann `label`; `value` auf Cent gerundet.

- [ ] **Step 1: Failing test**

`desktop/src/utils/breakdown.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueBreakdown, typeGroup, UNSORTED_LABEL } from './breakdown.js';

const cards = [
  { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare', type: 'Normal Monster', price: 10, quantity: 2, value: 18.5 },
  { id: '2', set_code: 'LOB-DE002', language: 'DE', rarity: 'Common', type: 'Spell Card', price: 1, quantity: 1, value: 1 },
  { id: '3', set_code: 'MRD-DE003', language: 'DE', rarity: 'Common', type: 'Trap Card', price: 4, quantity: 1, value: 4 },
];
const copies = [
  { card_id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare', condition: 'NM', container_id: 'b1' },
  { card_id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare', condition: 'EX', container_id: null },
  { card_id: '2', set_code: 'LOB-DE002', language: 'DE', rarity: 'Common', condition: 'NM', container_id: 'b1' },
  { card_id: '3', set_code: 'MRD-DE003', language: 'DE', rarity: 'Common', condition: 'NM', container_id: 'weg' },
];
const containers = [{ container_id: 'b1', name: 'Ordner Blau' }];

test('typeGroup', () => {
  assert.equal(typeGroup('Effect Monster'), 'Monster');
  assert.equal(typeGroup('Spell Card'), 'Zauber');
  assert.equal(typeGroup('Trap Card'), 'Falle');
  assert.equal(typeGroup(null), 'Sonstige');
});

test('Typ nach Wert', () => {
  assert.deepEqual(valueBreakdown({ cards, copies, containers, dimension: 'type' }), [
    { label: 'Monster', count: 2, value: 18.5 },
    { label: 'Falle', count: 1, value: 4 },
    { label: 'Zauber', count: 1, value: 1 },
  ]);
});

test('Set nach Praefix', () => {
  assert.deepEqual(valueBreakdown({ cards, copies, containers, dimension: 'set' }), [
    { label: 'LOB', count: 3, value: 19.5 },
    { label: 'MRD', count: 1, value: 4 },
  ]);
});

test('Binder: Exemplare mit Zustandsfaktor, ohne oder unbekannter Behaelter = Nicht einsortiert', () => {
  assert.deepEqual(valueBreakdown({ cards, copies, containers, dimension: 'binder' }), [
    { label: 'Ordner Blau', count: 2, value: 11 },
    { label: UNSORTED_LABEL, count: 2, value: 12.5 },
  ].sort((a, b) => b.value - a.value));
});
```

- [ ] **Step 2: Run → FAIL**, dann `desktop/src/utils/breakdown.js`:
```js
import { conditionFactor } from './valuation.js';

// Spec G1 §4.6 — Aufteilung nach Wert. Karten-Dimensionen nutzen `value`/`quantity` aus get-collection;
// die Binder-Dimension rechnet pro lebendem Exemplar (Preis x Zustandsfaktor).
export const UNSORTED_LABEL = 'Nicht einsortiert';

export function typeGroup(type) {
  const t = String(type || '');
  if (t.includes('Spell')) return 'Zauber';
  if (t.includes('Trap')) return 'Falle';
  if (t.includes('Monster')) return 'Monster';
  return 'Sonstige';
}

const round2 = (x) => Math.round(x * 100) / 100;
const keyOf = (id, s, l, r) => `${id}|${s || 'Unknown'}|${l || 'DE'}|${r || 'Unknown'}`;

function finish(map) {
  return Array.from(map.entries())
    .map(([label, g]) => ({ label, count: g.count, value: round2(g.value) }))
    .sort((a, b) => (b.value - a.value) || a.label.localeCompare(b.label));
}

export function valueBreakdown({ cards = [], copies = [], containers = [], dimension }) {
  const m = new Map();
  const add = (label, count, value) => {
    const g = m.get(label) || { count: 0, value: 0 };
    g.count += count; g.value += value; m.set(label, g);
  };
  if (dimension === 'binder') {
    const price = new Map(cards.map((c) => [keyOf(c.id, c.set_code, c.language, c.rarity), Number(c.price) || 0]));
    const names = new Map(containers.map((c) => [c.container_id, c.name]));
    for (const cp of copies) {
      const label = (cp.container_id && names.get(cp.container_id)) || UNSORTED_LABEL;
      add(label, 1, (price.get(keyOf(cp.card_id, cp.set_code, cp.language, cp.rarity)) || 0) * conditionFactor(cp.condition));
    }
    return finish(m);
  }
  for (const c of cards) {
    const label = dimension === 'type' ? typeGroup(c.type)
      : dimension === 'set' ? (c.set_code ? c.set_code.split('-')[0] : 'Unknown')
      : (c.rarity || 'Unknown');
    add(label, Number(c.quantity) || 0, Number(c.value) || 0);
  }
  return finish(m);
}
```
Nachrechnen Binder: Ordner Blau = 10×1 (NM) + 1×1 = 11; Nicht einsortiert = 10×0,85 + 4×1 = 12,5. Run → PASS.

- [ ] **Step 3: `ValueBreakdown.jsx`**
```jsx
import { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { valueBreakdown } from '../utils/breakdown';
import { fmtEUR } from '../utils/format';

const DIMENSIONS = [
  { id: 'type', label: 'Typ' }, { id: 'set', label: 'Set' }, { id: 'rarity', label: 'Rarität' }, { id: 'binder', label: 'Binder' },
];
const COLORS = ['#9D00FF', '#F5C542', '#00C49F', '#FF8042', '#4FA3FF', '#FF5DA2', '#8BD450', '#B0B0B0'];

// Spec G1 §4.6 — Aufteilung nach Wert: Kuchen + Liste.
export default function ValueBreakdown() {
  const [dimension, setDimension] = useState('type');
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!window.api) return;
    Promise.all([window.api.getCollection(), window.api.listAllCopies(), window.api.listContainers()])
      .then(([cards, copies, containers]) => setSrc({ cards: cards || [], copies: copies || [], containers: containers || [] }))
      .catch(() => setError('Aufteilung konnte nicht geladen werden.'));
  }, []);

  const groups = useMemo(() => (src ? valueBreakdown({ ...src, dimension }) : []), [src, dimension]);
  const top = groups.slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="inline-flex bg-obsidian-700 border border-line rounded-xl p-1 gap-1">
        {DIMENSIONS.map((d) => (
          <button key={d.id} onClick={() => setDimension(d.id)}
            className={`px-4 py-1.5 rounded-lg text-sm ${dimension === d.id ? 'bg-space-violet text-white' : 'text-ink-muted hover:text-ink'}`}>{d.label}</button>
        ))}
      </div>
      {error && <div className="text-sm text-crit">{error}</div>}
      {!src && !error && <div className="h-64 rounded-2xl bg-obsidian-700 animate-pulse" />}
      {src && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 bg-obsidian-700 border border-line rounded-2xl p-6">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={top} dataKey="value" nameKey="label" innerRadius={60} outerRadius={95} paddingAngle={2} isAnimationActive={false}>
                  {top.map((g, i) => <Cell key={g.label} fill={COLORS[i % COLORS.length]} stroke="none" />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#121212', borderRadius: '8px', border: '1px solid #333' }} itemStyle={{ color: '#fff' }} formatter={(v) => fmtEUR(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="divide-y divide-line">
            {groups.length === 0 && <div className="text-sm text-ink-faint">Keine Daten</div>}
            {groups.map((g, i) => (
              <div key={g.label} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: i < 8 ? COLORS[i] : '#555' }} />
                <span className="flex-1 truncate text-ink">{g.label}</span>
                <span className="font-mono text-ink-faint">{g.count}×</span>
                <span className="font-mono text-gold w-28 text-right">{fmtEUR(g.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Insights-Reiter Aufteilung mit Umschalter**

In `Insights.jsx` (Stand nach Task 7): `import ValueBreakdown from './ValueBreakdown';`, einen Zustand `const [metric, setMetric] = useState('count');` und die Zeile `{view === 'breakdown' && <Statistics />}` ersetzen durch:
```jsx
        {view === 'breakdown' && (
          <div className="space-y-4">
            <div className="inline-flex bg-obsidian-700 border border-line rounded-xl p-1 gap-1">
              {[{ id: 'count', label: 'Anzahl' }, { id: 'value', label: 'Wert' }].map((m) => (
                <button key={m.id} onClick={() => setMetric(m.id)}
                  className={`px-4 py-1.5 rounded-lg text-sm ${metric === m.id ? 'bg-space-violet text-white' : 'text-ink-muted hover:text-ink'}`}>{m.label}</button>
              ))}
            </div>
            {metric === 'count' ? <Statistics /> : <ValueBreakdown />}
          </div>
        )}
```

- [ ] **Step 5: Umbenennung** — `Portfolio.jsx:209` `Top Performers` → `Wertvollste Bestände`. Sonst nichts in der Datei ändern.

- [ ] **Step 6: Verifizieren** — Helfer-Tests PASS, `npm run build` ok, Lint genau 5.

- [ ] **Step 7: Commit**
```bash
git add desktop/src/utils/breakdown.js desktop/src/utils/breakdown.test.js desktop/src/components/ValueBreakdown.jsx desktop/src/components/Insights.jsx desktop/src/components/Portfolio.jsx
git commit -m "feat(desktop): Aufteilung nach Wert und Binder, Wertvollste Bestaende (G1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Desktop — Preisverlauf im Karten-Panel

**Files:**
- Create: `desktop/src/components/PriceHistoryChart.jsx`
- Modify: `desktop/src/components/CardDetailPanel.jsx` (Import; Chart direkt nach dem Block `<div className="flex items-start justify-between">…</div>` jedes Printings, Zeile 247-273)

**Interfaces:**
- Consumes: `window.api.getCardHistory(printing)` (Task 5), `computeSteps`, `todayUtc`, `fmtDayDE`, `FAMILY_LABELS` (Task 3), `fmtEUR`.
- Produces: `<PriceHistoryChart printing={{ id, set_code, language, rarity }} />`

- [ ] **Step 1: Komponente**
```jsx
import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { computeSteps, todayUtc, fmtDayDE, FAMILY_LABELS } from '../utils/priceSteps';
import { fmtEUR } from '../utils/format';

const WINDOWS = [30, 90, 365];
const ts = (day) => Date.parse(`${day}T00:00:00Z`);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

// Spec G1 §4.6 — Stufenlinie pro Printing. Laedt beim Oeffnen und bei jeder Preisaenderung neu.
export default function PriceHistoryChart({ printing }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);
  const [windowDays, setWindowDays] = useState(30);
  const { id, set_code, language, rarity } = printing;

  useEffect(() => {
    if (!window.api?.getCardHistory) { setError(true); return undefined; }
    let alive = true;
    const load = () => window.api.getCardHistory({ id, set_code, language, rarity })
      .then((r) => { if (alive) { setRows(r || []); setError(false); } })
      .catch(() => { if (alive) setError(true); });
    load();
    const off = window.api.onPriceUpdate?.(() => load());
    return () => { alive = false; off?.(); };
  }, [id, set_code, language, rarity]);

  const steps = useMemo(() => (rows ? computeSteps(rows, todayUtc(), windowDays) : null), [rows, windowDays]);

  if (!rows) {
    return <div className="text-[11px] text-ink-faint py-1">{error ? 'Verlauf nicht verfügbar' : 'Verlauf lädt …'}</div>;
  }
  if (steps.kind === 'none') return <div className="text-[11px] text-ink-faint py-1">Noch kein Verlauf</div>;
  if (steps.kind === 'flat') {
    return <div className="text-[11px] text-ink-faint py-1">Seit {fmtDayDE(steps.flatDay)} unverändert {fmtEUR(steps.flatPrice)}</div>;
  }
  const data = steps.points.map((p) => ({ t: ts(p.day), price: p.price }));
  return (
    <div className="mt-1">
      <div className="flex gap-1 mb-1">
        {WINDOWS.map((w) => (
          <button key={w} onClick={() => setWindowDays(w)}
            className={`px-2 py-0.5 rounded text-[10px] ${windowDays === w ? 'bg-space-violet text-white' : 'text-ink-faint hover:text-ink border border-line'}`}>{w} T</button>
        ))}
      </div>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 14, right: 6, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={{ fontSize: 9, fill: '#888' }} tickFormatter={(t) => fmtDayDE(dayOf(t))} />
            <YAxis width={48} tick={{ fontSize: 9, fill: '#888' }} domain={['auto', 'auto']} tickFormatter={(v) => fmtEUR(v)} />
            <Tooltip contentStyle={{ backgroundColor: '#121212', borderRadius: '8px', border: '1px solid #333', fontSize: 11 }}
              labelFormatter={(t) => fmtDayDE(dayOf(t))} formatter={(v) => [fmtEUR(v), 'Preis']} />
            <Line type="stepAfter" dataKey="price" stroke="#9D00FF" strokeWidth={2} dot={false} isAnimationActive={false} />
            {steps.markers.map((m) => (
              <ReferenceLine key={m.day} x={ts(m.day)} stroke="#F5C542" strokeDasharray="4 3"
                label={{ value: `Quelle: ${FAMILY_LABELS[m.family]}`, position: 'insideTopLeft', fill: '#F5C542', fontSize: 9 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Einbinden**

`CardDetailPanel.jsx`: `import PriceHistoryChart from './PriceHistoryChart';` und direkt nach dem schließenden `</div>` des Blocks `<div className="flex items-start justify-between">` (vor `<div>` mit `groupCopies`, Zeile 274-275):
```jsx
                      <PriceHistoryChart printing={printingOf(variant)} />
```

- [ ] **Step 3: Sichtprüfung im Dev-Fenster**

`npm run build` ok, Lint genau 5. Dann (nur wenn die installierte App geschlossen ist, sonst EADDRINUSE auf :4000) `cd desktop && npm run electron:dev`, eine Karte mit Preiszeilen öffnen und prüfen: Chips 30/90/365 schalten, Leertext bei Karte ohne Verlauf, keine Konsolenfehler. Einen Screenshot für das Ledger ablegen.

- [ ] **Step 4: Commit**
```bash
git add desktop/src/components/PriceHistoryChart.jsx desktop/src/components/CardDetailPanel.jsx
git commit -m "feat(desktop): Preisverlauf als Stufenlinie im Karten-Panel (G1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Android — Datenwege (Referenzpreise, Verlauf, Snapshots) in `SideStores`

**Files:**
- Create: `M/ml/BoundedMap.kt`, `M/ml/SnapshotSeries.kt`, `M/cloud/DailyListCache.kt`, `M/cloud/PriceHistoryRepository.kt`
- Modify: `M/cloud/SnapshotsRepository.kt`, `M/cloud/SideStores.kt`
- Test: `T/BoundedMapTest.kt`, `T/SnapshotSeriesTest.kt`, `T/DailyListCacheTest.kt`, `T/PriceHistoryQueriesTest.kt`

**Interfaces:**
- Consumes: `PriceRef`, `UtcDay` (Task 2); `ListCache`, `Keyset`, `KeysetPager`, `StoreQueries.PAGE`, `SupabaseCloud`.
- Produces:
  - `class BoundedMap<K, V>(max: Int) { fun getOrPut(key: K, create: () -> V): V; fun values(): List<V>; fun clear(); val size: Int }` (am längsten nicht benutzter Eintrag fällt heraus)
  - `object SnapshotSeries { fun withToday(list: List<Snapshot>, day: String, total: Double): List<Snapshot> }`
  - `class DailyListCache<T>(scope: CoroutineScope, today: () -> String = UtcDay::today, loader: suspend () -> T) { val state: StateFlow<CacheState<T>>; fun ensureFresh(); suspend fun refreshAndWait(); fun clear() }`
  - `object PriceHistoryRepository { fun referenceParams(after: PriceRef?): List<Pair<String,String>>; fun historyParams(card: CardRow): List<Pair<String,String>>; fun parse(text: String): List<PriceRef>; suspend fun reference(days: Int): List<PriceRef>; suspend fun history(card: CardRow): List<PriceRef> }`
  - `SnapshotsRepository.snapshotParams(): List<Pair<String,String>>`, `SnapshotsRepository.parseSnapshots(text: String): List<Snapshot>` (aufsteigend)
  - `SideStores.reference7`, `SideStores.reference30`: `DailyListCache<List<PriceRef>>`; `SideStores.snapshots: ListCache<List<Snapshot>>`; `SideStores.history(card: CardRow): ListCache<List<PriceRef>>` (höchstens 20 Printings)

- [ ] **Step 1: Failing tests (reine Teile)**

`T/BoundedMapTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ml.BoundedMap
import org.junit.Assert.assertEquals
import org.junit.Test

class BoundedMapTest {
    @Test fun `faellt der am laengsten unbenutzte Eintrag heraus`() {
        var created = 0
        val m = BoundedMap<String, Int>(2)
        m.getOrPut("a") { ++created }
        m.getOrPut("b") { ++created }
        m.getOrPut("a") { ++created }      // a frisch benutzt
        m.getOrPut("c") { ++created }      // b faellt heraus
        assertEquals(2, m.size)
        assertEquals(3, created)
        m.getOrPut("a") { ++created }      // noch da
        assertEquals(3, created)
        m.getOrPut("b") { ++created }      // neu angelegt
        assertEquals(4, created)
    }
}
```

`T/SnapshotSeriesTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.Snapshot
import com.example.yugiohscanner.ml.SnapshotSeries
import org.junit.Assert.assertEquals
import org.junit.Test

class SnapshotSeriesTest {
    @Test fun `heutigen Punkt ersetzen`() {
        val l = listOf(Snapshot("2026-09-13", 10.0), Snapshot("2026-09-14", 11.0))
        assertEquals(listOf(Snapshot("2026-09-13", 10.0), Snapshot("2026-09-14", 12.5)), SnapshotSeries.withToday(l, "2026-09-14", 12.5))
    }
    @Test fun `heutigen Punkt anhaengen`() {
        val l = listOf(Snapshot("2026-09-13", 10.0))
        assertEquals(listOf(Snapshot("2026-09-13", 10.0), Snapshot("2026-09-14", 9.0)), SnapshotSeries.withToday(l, "2026-09-14", 9.0))
    }
    @Test fun `leere Liste`() {
        assertEquals(listOf(Snapshot("2026-09-14", 9.0)), SnapshotSeries.withToday(emptyList(), "2026-09-14", 9.0))
    }
}
```

`T/PriceHistoryQueriesTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.PriceHistoryRepository
import com.example.yugiohscanner.cloud.SnapshotsRepository
import com.example.yugiohscanner.ml.PriceRef
import org.junit.Assert.assertEquals
import org.junit.Test

class PriceHistoryQueriesTest {
    @Test fun `Referenz erste Seite nach Schluessel sortiert`() {
        assertEquals(
            listOf("order" to "card_id.asc,set_code.asc,language.asc,rarity.asc", "limit" to "1000"),
            PriceHistoryRepository.referenceParams(null),
        )
    }

    @Test fun `Referenz Folgeseite mit Keyset-Filter`() {
        val p = PriceHistoryRepository.referenceParams(PriceRef("1", "LOB-DE001", "DE", "Secret Rare", "2026-09-01", 1.0, "cm_bulk"))
        assertEquals("or", p.last().first)
        assertEquals(
            "(card_id.gt.\"1\",and(card_id.eq.\"1\",set_code.gt.\"LOB-DE001\"),and(card_id.eq.\"1\",set_code.eq.\"LOB-DE001\",language.gt.\"DE\"),and(card_id.eq.\"1\",set_code.eq.\"LOB-DE001\",language.eq.\"DE\",rarity.gt.\"Secret Rare\"))",
            p.last().second,
        )
    }

    @Test fun `Verlauf eines Printings, fehlende Raritaet als Unknown, neueste zuerst`() {
        val card = CardRow("1", "LOB-DE001", "DE", "A", null, null, 1, 2.0)
        assertEquals(
            listOf(
                "select" to "card_id,set_code,language,rarity,day,price,source",
                "card_id" to "eq.1", "set_code" to "eq.LOB-DE001", "language" to "eq.DE", "rarity" to "eq.Unknown",
                "variant" to "eq.base", "order" to "day.desc", "limit" to "1000",
            ),
            PriceHistoryRepository.historyParams(card),
        )
    }

    @Test fun `parse liest Zeilen`() {
        val r = PriceHistoryRepository.parse("""[{"card_id":"1","set_code":"A","language":"DE","rarity":"Common","day":"2026-09-01","price":2.5,"source":"cloud"}]""")
        assertEquals(listOf(PriceRef("1", "A", "DE", "Common", "2026-09-01", 2.5, "cloud")), r)
    }

    @Test fun `Snapshots juengste 1000, aufsteigend geliefert`() {
        assertEquals(
            listOf("select" to "day,total_value", "order" to "day.desc", "limit" to "1000"),
            SnapshotsRepository.snapshotParams(),
        )
        val s = SnapshotsRepository.parseSnapshots("""[{"day":"2026-09-14","total_value":2},{"day":"2026-09-13","total_value":1}]""")
        assertEquals(listOf("2026-09-13", "2026-09-14"), s.map { it.day })
    }
}
```

`T/DailyListCacheTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.DailyListCache
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** Spec G1 §4.3: Referenzpreise einmal pro UTC-Tag; Seitenwechsel (ensureFresh) laden sonst nicht. */
@OptIn(ExperimentalCoroutinesApi::class)
class DailyListCacheTest {
    @Test fun `am selben Tag nur einmal, am naechsten Tag erneut`() = runTest {
        var day = "2026-09-20"
        var n = 0
        val c = DailyListCache(this, { day }) { n++; listOf(n) }
        c.ensureFresh(); advanceUntilIdle()
        c.ensureFresh(); advanceUntilIdle()
        c.ensureFresh(); advanceUntilIdle()
        assertEquals(1, n)
        day = "2026-09-21"
        c.ensureFresh(); advanceUntilIdle()
        assertEquals(2, n)
        assertEquals(listOf(2), c.state.value.value)
    }

    @Test fun `gescheitertes Laden wird beim naechsten Aufruf wiederholt`() = runTest {
        var fail = true
        var n = 0
        val c = DailyListCache(this, { "2026-09-20" }) { n++; if (fail) throw RuntimeException("offline"); listOf(1) }
        c.ensureFresh(); advanceUntilIdle()
        assertEquals("offline", c.state.value.error)
        fail = false
        c.ensureFresh(); advanceUntilIdle()
        assertEquals(2, n)
        assertEquals(listOf(1), c.state.value.value)
    }

    @Test fun `nach clear wird trotz gleichem Tag neu geladen`() = runTest {
        var n = 0
        val c = DailyListCache(this, { "2026-09-20" }) { n++; listOf(n) }
        c.ensureFresh(); advanceUntilIdle()
        c.clear()
        c.ensureFresh(); advanceUntilIdle()
        assertEquals(2, n)
    }
}
```
Die Tests laufen im `runTest`-Bereich selbst (nicht `backgroundScope`), wie `ListCacheTest`. **Schutz-Nachweis:** Im ersten Test nach dem Grünwerden in `ensureFresh` die Bedingung `loadedDay != today()` vorübergehend durch `true` ersetzen → Test muss mit `n = 3` rot werden; zurücksetzen. Im Bericht nennen.

- [ ] **Step 2: Run → FAIL** (Kompilierfehler)

- [ ] **Step 3: Implementieren**

`M/ml/BoundedMap.kt`:
```kotlin
package com.example.yugiohscanner.ml

/** Kleiner Zwischenspeicher mit Obergrenze: der am laengsten nicht benutzte Eintrag faellt heraus (Spec G1 §4.3). */
class BoundedMap<K, V>(private val max: Int) {
    private val map = object : LinkedHashMap<K, V>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<K, V>?): Boolean = size > max
    }

    fun getOrPut(key: K, create: () -> V): V = synchronized(map) {
        map[key] ?: create().also { map[key] = it }
    }

    fun values(): List<V> = synchronized(map) { map.values.toList() }
    fun clear() = synchronized(map) { map.clear() }
    val size: Int get() = synchronized(map) { map.size }
}
```

`M/ml/SnapshotSeries.kt`:
```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.Snapshot

/** Spec G1 §4.4: den heutigen Tageswert in die gemerkte Reihe eintragen, statt alles neu zu laden. */
object SnapshotSeries {
    fun withToday(list: List<Snapshot>, day: String, total: Double): List<Snapshot> {
        val last = list.lastOrNull()
        return if (last != null && last.day == day) list.dropLast(1) + Snapshot(day, total) else list + Snapshot(day, total)
    }
}
```

`M/cloud/DailyListCache.kt`:
```kotlin
package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.UtcDay
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * Spec G1 §4.3: eine ListCache, die hoechstens einmal pro UTC-Tag laedt. Referenzpreise aendern sich
 * praktisch nur mit dem Datum; Seitenwechsel rufen ensureFresh() und laden deshalb nicht erneut.
 * Pull-to-refresh nimmt refreshAndWait(). Ein gescheitertes Laden setzt den Tag nicht -- der naechste
 * Besuch versucht es wieder.
 */
class DailyListCache<T>(
    scope: CoroutineScope,
    private val today: () -> String = UtcDay::today,
    loader: suspend () -> T,
) {
    @Volatile private var loadedDay: String? = null

    private val cache = ListCache(scope) {
        val d = today()
        val v = loader()
        loadedDay = d
        v
    }

    val state: StateFlow<CacheState<T>> get() = cache.state

    fun ensureFresh() {
        val s = cache.state.value
        if (!s.loading && (s.value == null || loadedDay != today())) cache.refresh()
    }

    suspend fun refreshAndWait() = cache.refreshAndWait()

    fun clear() {
        loadedDay = null
        cache.clear()
    }
}
```

`M/cloud/PriceHistoryRepository.kt`:
```kotlin
package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.Keyset
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.PriceRef
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject

/**
 * Spec G1 §4.3: Referenzpreise ueber die RPC price_reference (supabase/price_reference_rpc.sql) und
 * der Verlauf eines Printings aus price_history. Nur lesend.
 */
object PriceHistoryRepository {
    private val KEY = listOf("card_id", "set_code", "language", "rarity")

    fun referenceParams(after: PriceRef?): List<Pair<String, String>> {
        val p = arrayListOf(
            "order" to KEY.joinToString(",") { "$it.asc" },
            "limit" to StoreQueries.PAGE.toString(),
        )
        if (after != null) p += "or" to Keyset.after(KEY, listOf(after.cardId, after.setCode, after.language, after.rarity))
        return p
    }

    fun historyParams(card: CardRow): List<Pair<String, String>> = listOf(
        "select" to "card_id,set_code,language,rarity,day,price,source",
        "card_id" to "eq.${card.id}",
        "set_code" to "eq.${card.setCode}",
        "language" to "eq.${card.language}",
        "rarity" to "eq.${card.rarity ?: "Unknown"}",
        "variant" to "eq.base",
        "order" to "day.desc",
        "limit" to "1000",
    )

    fun parse(text: String): List<PriceRef> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            PriceRef(
                o.getString("card_id"), o.getString("set_code"), o.getString("language"), o.getString("rarity"),
                o.getString("day"), o.getDouble("price"), o.optString("source", "unknown"),
            )
        }
    }

    suspend fun reference(days: Int): List<PriceRef> = KeysetPager.all(StoreQueries.PAGE) { after ->
        val url = "${SupabaseCloud.base()}/rest/v1/rpc/price_reference".toHttpUrl().newBuilder()
            .apply { referenceParams(after).forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        val body = JSONObject().put("days", days).toString()
        executeWithReauth {
            base(url).addHeader("Content-Type", "application/json")
                .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Bewegungen laden fehlgeschlagen (${r.code}): $text")
            parse(text)
        }
    }

    suspend fun history(card: CardRow): List<PriceRef> {
        val url = "${SupabaseCloud.base()}/rest/v1/price_history".toHttpUrl().newBuilder()
            .apply { historyParams(card).forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        return executeWithReauth { base(url).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Verlauf laden fehlgeschlagen (${r.code}): $text")
            parse(text).reversed()
        }
    }

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url)
            .addHeader("apikey", SupabaseCloud.key())
            .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    private suspend fun executeWithReauth(build: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(build()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(build()).execute()
    }
}
```

`M/cloud/SnapshotsRepository.kt`: `loadSnapshots` ersetzen durch:
```kotlin
    // Spec G1 §4.4: die JUENGSTEN 1000 Tage (vorher `day.asc&limit=120` = die aeltesten 120).
    fun snapshotParams(): List<Pair<String, String>> =
        listOf("select" to "day,total_value", "order" to "day.desc", "limit" to "1000")

    fun parseSnapshots(text: String): List<Snapshot> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            Snapshot(o.optString("day"), o.optDouble("total_value", 0.0))
        }.reversed()
    }

    suspend fun loadSnapshots(): List<Snapshot> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/portfolio_snapshots".toHttpUrl().newBuilder()
            .apply { snapshotParams().forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        executeWithReauth { base(url).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Verlauf laden fehlgeschlagen (${r.code}): $text")
            parseSnapshots(text)
        }
    }
```
Den Kommentar über `object SnapshotsRepository` so anpassen, dass er „Start" statt „Wert screen" nennt, falls er dadurch falsch wird.

`M/cloud/SideStores.kt`: nach `val sets = …`:
```kotlin
    // Spec G1 §4.3/§4.4: Referenzpreise einmal pro UTC-Tag, Wertverlauf, Preisverlauf je Printing (max. 20).
    val reference7 = DailyListCache(scope) { PriceHistoryRepository.reference(7) }
    val reference30 = DailyListCache(scope) { PriceHistoryRepository.reference(30) }
    val snapshots = ListCache(scope) { SnapshotsRepository.loadSnapshots() }

    private val historyCaches = com.example.yugiohscanner.ml.BoundedMap<String, ListCache<List<com.example.yugiohscanner.ml.PriceRef>>>(20)

    fun history(card: CardRow): ListCache<List<com.example.yugiohscanner.ml.PriceRef>> =
        historyCaches.getOrPut(card.printingKey()) { ListCache(scope) { PriceHistoryRepository.history(card) } }

    fun reference(days: Int): DailyListCache<List<com.example.yugiohscanner.ml.PriceRef>> = if (days == 30) reference30 else reference7
```
(Die voll qualifizierten Namen als `import`-Zeilen oben schreiben, nicht inline.) In `clearAll()` ergänzen:
```kotlin
        reference7.clear(); reference30.clear(); snapshots.clear()
        historyCaches.values().forEach { it.clear() }
        historyCaches.clear()
```

- [ ] **Step 4: Run → PASS** (Android-Befehl; Schutz-Nachweis aus Step 1 durchführen)

- [ ] **Step 5: Commit**
```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/BoundedMap.kt android/app/src/main/java/com/example/yugiohscanner/ml/SnapshotSeries.kt android/app/src/main/java/com/example/yugiohscanner/cloud/DailyListCache.kt android/app/src/main/java/com/example/yugiohscanner/cloud/PriceHistoryRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SnapshotsRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt android/app/src/test/java/com/example/yugiohscanner/BoundedMapTest.kt android/app/src/test/java/com/example/yugiohscanner/SnapshotSeriesTest.kt android/app/src/test/java/com/example/yugiohscanner/DailyListCacheTest.kt android/app/src/test/java/com/example/yugiohscanner/PriceHistoryQueriesTest.kt
git commit -m "feat(android): Referenzpreise, Preisverlauf und Wertverlauf im Zwischenspeicher (G1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Android — Bewegungen auf Start, Insights-Seite, Wertverlauf aus dem Speicher

**Files:**
- Create: `M/ui/MoversMemo.kt`, `M/ui/MoversSection.kt`, `M/ui/InsightsScreen.kt`
- Test: `T/MoversMemoTest.kt`
- Modify: `M/ui/StartScreen.kt`, `M/ui/Dashboard.kt` (`StatSection` wandert hierher), `M/ui/AppNav.kt`

**Interfaces:**
- Consumes: `Movers.compute`, `MoversResult`, `Mover`, `PriceRef`, `UtcDay` (Task 2); `SideStores.reference(days)`, `SideStores.snapshots`, `SnapshotSeries.withToday` (Task 10); `CollectionStore.state`, `RefreshableBox`, `CardDetailScreen(cardId, onClose)`.
- Produces:
  - `object MoversMemo { fun get(cards: List<CardRow>, copies: List<CopyRow>, refs: List<PriceRef>, today: String, days: Int): MoversResult; fun peek(cards, copies, refs, today, days): MoversResult? }` — rechnet nur neu, wenn eine der drei Listen als **Referenz** wechselt oder `today` sich ändert; je `days` ein eigener Merker.
  - `@Composable fun MoversSection(days: Int, top: Int, full: Boolean, onOpenCard: (String) -> Unit, onOpenAll: (() -> Unit)?)`
  - `@Composable fun InsightsScreen(onBack: () -> Unit)` (in dieser Task nur Bewegungen; Task 12 ergänzt Aufteilung)
  - `@Composable internal fun StatSection(title: String, groups: List<StatGroup>, byValue: Boolean = false)` in `Dashboard.kt`
  - `Routes.INSIGHTS = "start/insights"`; `StartScreen(..., onOpenInsights: () -> Unit)`

- [ ] **Step 1: Failing test Merker**

`T/MoversMemoTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.PriceRef
import com.example.yugiohscanner.ui.MoversMemo
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Test

/** Spec G1 §4.3: Bewegungen nach Identitaet gemerkt -- wie DashboardMemoTest. */
class MoversMemoTest {
    private val cards = listOf(CardRow("1", "A-DE001", "DE", "A", null, "Common", 1, 3.0, priceLocked = 1))
    private val copies = listOf(CopyRow("c1", "1", "A-DE001", "DE", "Common", "unknown", "NM", false,
        containerId = null, page = null, slot = null, tags = null, note = null))
    private val refs = listOf(PriceRef("1", "A-DE001", "DE", "Common", "2026-09-01", 2.0, "cm_bulk"))

    @Test fun `gleiche Referenzen und gleicher Tag liefern dieselbe Instanz`() {
        val a = MoversMemo.get(cards, copies, refs, "2026-09-20", 7)
        assertSame(a, MoversMemo.get(cards, copies, refs, "2026-09-20", 7))
        assertSame(a, MoversMemo.peek(cards, copies, refs, "2026-09-20", 7))
    }

    @Test fun `neue Referenzliste, neuer Tag oder anderes Fenster rechnet neu`() {
        val a = MoversMemo.get(cards, copies, refs, "2026-09-20", 7)
        assertNotSame(a, MoversMemo.get(cards, copies, refs.toList(), "2026-09-20", 7))
        val b = MoversMemo.get(cards, copies, refs, "2026-09-20", 7)
        assertNotSame(b, MoversMemo.get(cards, copies, refs, "2026-09-21", 7))
        val c = MoversMemo.get(cards, copies, refs, "2026-09-21", 7)
        val d = MoversMemo.get(cards, copies, refs, "2026-09-21", 30)
        assertSame(c, MoversMemo.get(cards, copies, refs, "2026-09-21", 7))
        assertSame(d, MoversMemo.get(cards, copies, refs, "2026-09-21", 30))
    }
}
```
**Schutz-Nachweis:** Nach Grün in `get` den Identitätsvergleich vorübergehend entfernen (immer neu rechnen) → erster Test rot; zurücksetzen.

- [ ] **Step 2: Run → FAIL**, dann `M/ui/MoversMemo.kt`:
```kotlin
package com.example.yugiohscanner.ui

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.Movers
import com.example.yugiohscanner.ml.MoversResult
import com.example.yugiohscanner.ml.PriceRef

/**
 * Merkt Movers.compute ueber Navigationen hinweg (Spec G1 §4.7, Muster DashboardMemo): Speicher und
 * ListCache liefern bei unveraenderten Daten dieselben Listeninstanzen, also genuegt `===`.
 * Ein Merker je Fenster (7/30), damit der Umschalter nicht staendig neu rechnet.
 */
object MoversMemo {
    private class Entry(
        val cards: List<CardRow>, val copies: List<CopyRow>, val refs: List<PriceRef>,
        val today: String, val result: MoversResult,
    )

    private val lock = Any()
    private val entries = HashMap<Int, Entry>()

    private fun hit(e: Entry?, cards: List<CardRow>, copies: List<CopyRow>, refs: List<PriceRef>, today: String) =
        e != null && e.cards === cards && e.copies === copies && e.refs === refs && e.today == today

    fun get(cards: List<CardRow>, copies: List<CopyRow>, refs: List<PriceRef>, today: String, days: Int): MoversResult =
        synchronized(lock) {
            val e = entries[days]
            if (hit(e, cards, copies, refs, today)) return@synchronized e!!.result
            Movers.compute(cards, copies, refs, today, days).also { entries[days] = Entry(cards, copies, refs, today, it) }
        }

    fun peek(cards: List<CardRow>, copies: List<CopyRow>, refs: List<PriceRef>, today: String, days: Int): MoversResult? =
        synchronized(lock) { entries[days]?.takeIf { hit(it, cards, copies, refs, today) }?.result }
}
```
Run → PASS.

- [ ] **Step 3: `M/ui/MoversSection.kt`**
```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.ml.Mover
import com.example.yugiohscanner.ml.MoversResult
import com.example.yugiohscanner.ml.UtcDay
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.Line
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Spec G1 §4.7/§4.8 -- Gewinner und Verlierer. Referenzpreise aus SideStores (einmal pro UTC-Tag),
 * Rechnung ueber MoversMemo im Hintergrund. Die Leertexte gleichen desktop/src/utils/moversText.js.
 */
@Composable
fun MoversSection(days: Int, top: Int, full: Boolean, onOpenCard: (String) -> Unit, onOpenAll: (() -> Unit)?) {
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val cache = SideStores.reference(days)
    val refState by cache.state.collectAsState()
    LaunchedEffect(days) { cache.ensureFresh() }

    val cards = ready?.cards
    val copies = ready?.copies
    val refs = refState.value
    val today = remember { UtcDay.today() }
    val result by produceState(
        if (cards != null && copies != null && refs != null) MoversMemo.peek(cards, copies, refs, today, days) else null,
        cards, copies, refs, days,
    ) {
        value = if (cards != null && copies != null && refs != null)
            withContext(Dispatchers.Default) { MoversMemo.get(cards, copies, refs, today, days) } else null
    }

    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                SectionHeader(if (onOpenAll != null) "Bewegungen · $days Tage" else "Bewegungen")
                Spacer(Modifier.weight(1f))
                if (onOpenAll != null) {
                    Text("Alle", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.clickable { onOpenAll() }.padding(4.dp))
                }
            }
            Spacer(Modifier.height(8.dp))
            val r = result
            when {
                refs == null && refState.error != null && !refState.loading ->
                    Text("Bewegungen konnten nicht geladen werden — zum Aktualisieren ziehen",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                r == null -> Placeholders(if (full) 6 else 3)
                else -> {
                    if (refState.error != null) {
                        Text("Stand von zuvor — Aktualisieren fehlgeschlagen", style = MaterialTheme.typography.labelSmall, color = Muted)
                        Spacer(Modifier.height(4.dp))
                    }
                    val message = moversMessage(r, days)
                    if (message != null) {
                        Text(message, style = MaterialTheme.typography.bodySmall, color = Muted)
                    } else {
                        MoverList("Gewinner", r.winners.take(top), full, onOpenCard)
                        Spacer(Modifier.height(10.dp))
                        MoverList("Verlierer", r.losers.take(top), full, onOpenCard)
                    }
                }
            }
        }
    }
}

internal fun moversMessage(r: MoversResult, days: Int): String? = when {
    r.status == "no_reference" ->
        r.firstDay?.let { "Noch nicht genug Verlauf — Bewegungen erscheinen ab ${UtcDay.formatDe(it)}" } ?: "Noch nicht genug Verlauf"
    r.winners.isEmpty() && r.losers.isEmpty() -> "Keine Bewegungen in $days Tagen"
    else -> null
}

@Composable
private fun Placeholders(rows: Int) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(rows) { Box(Modifier.fillMaxWidth().height(28.dp).background(Line, RoundedCornerShape(6.dp))) }
    }
}

@Composable
private fun MoverList(title: String, movers: List<Mover>, full: Boolean, onOpenCard: (String) -> Unit) {
    Text(title, style = MaterialTheme.typography.labelSmall, color = Muted)
    if (movers.isEmpty()) {
        Text("—", style = MaterialTheme.typography.bodySmall, color = Muted)
        return
    }
    movers.forEach { m ->
        val up = m.deltaHolding > 0
        val tint = if (up) Good else ErrorColor
        Row(Modifier.fillMaxWidth().clickable { onOpenCard(m.card.id) }.padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(m.card.name ?: m.card.id, maxLines = 1, style = MaterialTheme.typography.bodySmall, color = OnSurface)
                val extra = if (full) " · %.2f € → %.2f € · %d×".format(m.oldPrice, m.newPrice, m.copies) else ""
                Text("${m.card.setCode} · ${m.card.rarity ?: "Unknown"}$extra", maxLines = 1,
                    style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = Muted)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("%+.2f €".format(m.deltaHolding), style = MaterialTheme.typography.bodySmall, fontFamily = MonoFontFamily, color = tint)
                Text("%+.1f %%".format(m.pct), style = MaterialTheme.typography.labelSmall, fontFamily = MonoFontFamily, color = tint)
            }
        }
    }
}
```

- [ ] **Step 4: `StatSection` nach `Dashboard.kt` verschieben**

Die private `StatSection` am Ende von `StartScreen.kt` (Zeile 405-416) entfernen und in `Dashboard.kt` nach `StatBar` einfügen (Imports `Spacer`, `height`, `SectionHeader`, `Muted` ergänzen):
```kotlin
// Spec G1 §4.7: eine Aufteilung als Balken; `byValue` sortiert und misst nach Wert statt nach Anzahl.
@Composable
internal fun StatSection(title: String, groups: List<StatGroup>, byValue: Boolean = false) {
    Spacer(Modifier.height(16.dp))
    SectionHeader(title)
    Spacer(Modifier.height(4.dp))
    if (groups.isEmpty()) {
        Text("Keine Daten", style = MaterialTheme.typography.bodySmall, color = Muted)
        return
    }
    val shown = if (byValue) groups.sortedByDescending { it.value } else groups
    val maxCount = shown.maxOf { it.count }.coerceAtLeast(1)
    val maxValue = shown.maxOf { it.value }.coerceAtLeast(1e-6)
    shown.forEach { g ->
        val fraction = if (byValue) (g.value / maxValue).toFloat() else g.count.toFloat() / maxCount
        StatBar(g.label, g.count, g.value, fraction)
    }
}
```

- [ ] **Step 5: `StartScreen.kt` umbauen**

1. Signatur um `onOpenInsights: () -> Unit` erweitern (letzter Parameter).
2. `var snapshots by remember { mutableStateOf<List<Snapshot>>(emptyList()) }` ersetzen durch:
```kotlin
    val snapshotsCache by SideStores.snapshots.state.collectAsState()
    val snapshots = snapshotsCache.value ?: emptyList()
    // Spec G1 §4.7: Kartendetail aus Start heraus, wie in CollectionScreen (Detail bleibt verschachtelt).
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
```
3. Im `LaunchedEffect(Unit)` die zwei Zeilen `SnapshotsRepository.upsertToday(...)` / `snapshots = SnapshotsRepository.loadSnapshots()` ersetzen durch:
```kotlin
                SnapshotsRepository.upsertToday(dash.totalValue, dash.totalCards)
                val snaps = SideStores.snapshots
                if (snaps.state.value.value == null) snaps.refreshAndWait()
                else snaps.update { SnapshotSeries.withToday(it, UtcDay.today(), dash.totalValue) }
```
4. Direkt vor `Surface(Modifier.fillMaxSize(), color = Background) {`:
```kotlin
    BackHandler(detailId != null) { detailId = null }
    detailId?.let { id ->
        CardDetailScreen(cardId = id, onClose = { detailId = null })
        return
    }
```
5. `RefreshableBox(onRefresh = { … })` ersetzen durch:
```kotlin
        RefreshableBox(onRefresh = {
            CollectionStore.awaitSync()
            SideStores.dealAlerts.refreshAndWait()
            SideStores.snapshots.refreshAndWait()
            SideStores.reference7.refreshAndWait()
        }) {
```
6. Fehlerzeile `(error ?: setsCache.error ?: alertsCache.error)` → `(error ?: setsCache.error ?: alertsCache.error ?: snapshotsCache.error)`.
7. Direkt nach der Wert-Karte (nach dem `SpaceCard` „Gesamtwert", vor `// Quick actions.`):
```kotlin
            MoversSection(days = 7, top = 3, full = false, onOpenCard = { detailId = it }, onOpenAll = onOpenInsights)
```
8. Die vier Zeilen `StatSection("Nach Rarität", …)` bis `StatSection("Nach Attribut", …)` ersetzen durch:
```kotlin
                SpaceCard(Modifier.fillMaxWidth().clickable { onOpenInsights() }) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Aufteilung ansehen", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = OnSurface)
                        Text("→", style = MaterialTheme.typography.bodyMedium, color = Primary)
                    }
                }
```
9. Imports ergänzen: `androidx.activity.compose.BackHandler`, `androidx.compose.runtime.saveable.rememberSaveable`, `com.example.yugiohscanner.ml.SnapshotSeries`, `com.example.yugiohscanner.ml.UtcDay`. Nicht mehr benutzte Imports entfernen (`Snapshot` nur, falls unbenutzt).

- [ ] **Step 6: `M/ui/InsightsScreen.kt` (nur Bewegungen)**
```kotlin
package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ui.components.RefreshableBox
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.OnSurface

/** Spec G1 §4.7 -- Insights, Unterseite von Start (Route "start/insights"). */
@Composable
fun InsightsScreen(onBack: () -> Unit) {
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    var days by rememberSaveable { mutableStateOf(7) }
    BackHandler(detailId != null) { detailId = null }
    detailId?.let { id ->
        CardDetailScreen(cardId = id, onClose = { detailId = null })
        return
    }
    Surface(Modifier.fillMaxSize(), color = Background) {
        RefreshableBox(onRefresh = { CollectionStore.awaitSync(); SideStores.reference(days).refreshAndWait() }) {
            Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") }
                    Text("Insights", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(7, 30).forEach { d ->
                        FilterChip(selected = days == d, onClick = { days = d }, label = { Text("$d Tage") })
                    }
                }
                MoversSection(days = days, top = 10, full = true, onOpenCard = { detailId = it }, onOpenAll = null)
            }
        }
    }
}
```

- [ ] **Step 7: Route in `AppNav.kt`**

In `object Routes` nach `const val START = "start"`:
```kotlin
    // Spec G1 §4.7: Unterseite von Start. Erstes Segment "start", damit die untere Leiste Start markiert.
    const val INSIGHTS = "start/insights"
```
Im `StartScreen(...)`-Aufruf ergänzen: `onOpenInsights = { nav.navigate(Routes.INSIGHTS) { launchSingleTop = true } },`.
Nach `composable(Routes.START) { … }`:
```kotlin
            composable(Routes.INSIGHTS) {
                if (cloudReady) InsightsScreen(onBack = { nav.popBackStack() })
                else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
```

- [ ] **Step 8: Verifizieren** — Android-Befehl grün (Schutz-Nachweis aus Step 1 im Bericht).

- [ ] **Step 9: Commit**
```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/MoversMemo.kt android/app/src/main/java/com/example/yugiohscanner/ui/MoversSection.kt android/app/src/main/java/com/example/yugiohscanner/ui/InsightsScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/Dashboard.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt android/app/src/test/java/com/example/yugiohscanner/MoversMemoTest.kt
git commit -m "feat(android): Bewegungen auf Start und Insights-Seite, Wertverlauf aus dem Speicher (G1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Android — Aufteilung in Insights (Anzahl · Wert, mit Binder)

**Files:**
- Create: `M/ml/BinderBreakdown.kt`
- Test: `T/BinderBreakdownTest.kt`
- Modify: `M/ui/InsightsScreen.kt`

**Interfaces:**
- Consumes: `DashboardMemo`, `StatGroup`, `StatSection` (Task 11), `Valuation.factor`, `ContainerRow`, `CollectionStore.state` (`Ready.containers`).
- Produces:
  - `data class ValueGroup(val label: String, val count: Int, val value: Double)`
  - `object BinderBreakdown { const val UNSORTED = "Nicht einsortiert"; fun compute(cards: List<CardRow>, copies: List<CopyRow>, containers: List<ContainerRow>): List<ValueGroup> }` — lebende Exemplare, Wert = Preis × Zustandsfaktor, ohne oder mit unbekanntem/gelöschtem Behälter → `UNSORTED`; sortiert nach Wert absteigend, dann Name; Wert auf Cent.

- [ ] **Step 1: Failing test**

`T/BinderBreakdownTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.BinderBreakdown
import com.example.yugiohscanner.ml.ValueGroup
import org.junit.Assert.assertEquals
import org.junit.Test

class BinderBreakdownTest {
    private fun copy(id: String, card: String, cond: String, container: String?, deleted: Boolean = false) =
        CopyRow(id, card, "S-DE00$card", "DE", "Common", "unknown", cond, deleted,
            containerId = container, page = null, slot = null, tags = null, note = null)

    @Test fun `Wert je Behaelter, Nicht einsortiert fuer ohne, unbekannt oder geloescht`() {
        val cards = listOf(
            CardRow("1", "S-DE001", "DE", "A", null, "Common", 2, 10.0),
            CardRow("2", "S-DE002", "DE", "B", null, "Common", 1, 4.0),
        )
        val copies = listOf(
            copy("a", "1", "NM", "b1"),
            copy("b", "1", "EX", null),
            copy("c", "2", "NM", "weg"),
            copy("d", "2", "NM", "alt"),
            copy("e", "2", "NM", "b1", deleted = true),
        )
        val containers = listOf(
            ContainerRow("b1", "Ordner Blau", "binder", 9, null, 0),
            ContainerRow("alt", "Alte Box", "box", null, null, 1, deleted = true),
        )
        assertEquals(
            listOf(ValueGroup(BinderBreakdown.UNSORTED, 3, 16.5), ValueGroup("Ordner Blau", 1, 10.0)),
            BinderBreakdown.compute(cards, copies, containers),
        )
    }
}
```
Nachrechnen: Nicht einsortiert = 10 × 0,85 + 4 + 4 = 16,5 (3 Exemplare); Ordner Blau = 10.

- [ ] **Step 2: Run → FAIL**, dann `M/ml/BinderBreakdown.kt`:
```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey

data class ValueGroup(val label: String, val count: Int, val value: Double)

/**
 * Spec G1 §4.7 -- Aufteilung nach Binder: lebende Exemplare je Behaelter mit Preis x Zustandsfaktor.
 * Gegenstueck der Binder-Dimension in desktop/src/utils/breakdown.js (kein Zwilling: dort zaehlt der
 * Desktop auch Typ/Set/Raritaet anders zusammen).
 */
object BinderBreakdown {
    const val UNSORTED = "Nicht einsortiert"

    fun compute(cards: List<CardRow>, copies: List<CopyRow>, containers: List<ContainerRow>): List<ValueGroup> {
        val price = cards.associate { it.printingKey() to (it.price ?: 0.0) }
        val names = containers.filter { !it.deleted }.associate { it.containerId to it.name }
        val count = LinkedHashMap<String, Int>()
        val value = HashMap<String, Double>()
        for (c in copies) {
            if (c.deleted) continue
            val label = c.containerId?.let { names[it] } ?: UNSORTED
            count[label] = (count[label] ?: 0) + 1
            value[label] = (value[label] ?: 0.0) + (price[c.printingKey()] ?: 0.0) * Valuation.factor(c.condition)
        }
        return count.keys
            .map { ValueGroup(it, count[it] ?: 0, Math.round((value[it] ?: 0.0) * 100.0) / 100.0) }
            .sortedWith(compareByDescending<ValueGroup> { it.value }.thenBy { it.label })
    }
}
```
Run → PASS.

- [ ] **Step 3: `InsightsScreen.kt` um Reiter und Aufteilung erweitern**

Zustände ergänzen: `var tab by rememberSaveable { mutableStateOf("bewegungen") }` und `var byValue by rememberSaveable { mutableStateOf(false) }`. Unter der Titelzeile die Reiter:
```kotlin
                TabRow(selectedTabIndex = if (tab == "bewegungen") 0 else 1) {
                    Tab(selected = tab == "bewegungen", onClick = { tab = "bewegungen" }, text = { Text("Bewegungen") })
                    Tab(selected = tab == "aufteilung", onClick = { tab = "aufteilung" }, text = { Text("Aufteilung") })
                }
```
Die bisherigen Tage-Chips + `MoversSection` in `if (tab == "bewegungen") { … }` legen und daneben:
```kotlin
                if (tab == "aufteilung") {
                    val store by CollectionStore.state.collectAsState()
                    val ready = store as? StoreState.Ready
                    val cards = ready?.cards ?: emptyList()
                    val copies = ready?.copies ?: emptyList()
                    val containers = ready?.containers ?: emptyList()
                    val dash by produceState(DashboardMemo.peek(cards, copies), cards, copies) {
                        value = withContext(Dispatchers.Default) { DashboardMemo.get(cards, copies) }
                    }
                    val binders by produceState<List<StatGroup>?>(null, cards, copies, containers) {
                        value = withContext(Dispatchers.Default) {
                            BinderBreakdown.compute(cards, copies, containers).map { StatGroup(it.label, it.count, it.value) }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FilterChip(selected = !byValue, onClick = { byValue = false }, label = { Text("Anzahl") })
                        FilterChip(selected = byValue, onClick = { byValue = true }, label = { Text("Wert") })
                    }
                    val d = dash
                    val b = binders
                    if (d == null || b == null) {
                        Text("Aufteilung wird berechnet …", style = MaterialTheme.typography.bodySmall, color = Muted)
                    } else {
                        StatSection("Nach Typ", d.byType, byValue)
                        StatSection("Nach Set", d.bySet, byValue)
                        StatSection("Nach Rarität", d.byRarity, byValue)
                        StatSection("Nach Attribut", d.byAttribute, byValue)
                        StatSection("Nach Binder", b, byValue)
                    }
                }
```
`RefreshableBox.onRefresh` bleibt; bei Reiter Aufteilung genügt `CollectionStore.awaitSync()` (steht schon an erster Stelle). Imports ergänzen: `StoreState`, `BinderBreakdown`, `Muted`, `Dispatchers`, `withContext`.

- [ ] **Step 4: Verifizieren** — Android-Befehl grün.

- [ ] **Step 5: Commit**
```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/BinderBreakdown.kt android/app/src/test/java/com/example/yugiohscanner/BinderBreakdownTest.kt android/app/src/main/java/com/example/yugiohscanner/ui/InsightsScreen.kt
git commit -m "feat(android): Aufteilung in Insights nach Anzahl oder Wert, mit Binder (G1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Android — Preisverlauf im Kartendetail

**Files:**
- Create: `M/ui/PriceHistoryChart.kt`
- Modify: `M/ui/CardDetailScreen.kt` (nach der Kopfzeile jedes Printings, Zeile 166-173)

**Interfaces:**
- Consumes: `SideStores.history(card)` (Task 10), `PriceSteps.compute`, `PriceFamily.LABELS`, `UtcDay` (Tasks 2/4).
- Produces: `@Composable fun PriceHistoryChart(card: CardRow)`

- [ ] **Step 1: Komponente**

`M/ui/PriceHistoryChart.kt`:
```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.printingKey
import com.example.yugiohscanner.ml.PriceFamily
import com.example.yugiohscanner.ml.PriceSteps
import com.example.yugiohscanner.ml.UtcDay
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.Primary
import java.time.LocalDate

/**
 * Spec G1 §4.7 -- Stufenlinie pro Printing. Gemerkter Stand aus SideStores sofort, beim Oeffnen
 * Abgleich im Hintergrund. Leertexte wie desktop/src/components/PriceHistoryChart.jsx.
 */
@Composable
fun PriceHistoryChart(card: CardRow) {
    val key = card.printingKey()
    val cache = remember(key) { SideStores.history(card) }
    val state by cache.state.collectAsState()
    LaunchedEffect(key) { cache.refresh() }
    var window by rememberSaveable(key) { mutableStateOf(30) }
    val today = remember { UtcDay.today() }
    val rows = state.value
    val steps = remember(rows, window, today) { rows?.let { PriceSteps.compute(it, today, window) } }

    if (steps == null) {
        Text(if (state.error != null && !state.loading) "Verlauf nicht verfügbar" else "Verlauf lädt …",
            style = MaterialTheme.typography.labelSmall, color = Muted)
        return
    }
    when (steps.kind) {
        "none" -> Text("Noch kein Verlauf", style = MaterialTheme.typography.labelSmall, color = Muted)
        "flat" -> Text("Seit ${UtcDay.formatDe(steps.flatDay!!)} unverändert %.2f €".format(steps.flatPrice),
            style = MaterialTheme.typography.labelSmall, color = Muted)
        else -> Column(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(30, 90, 365).forEach { w ->
                    FilterChip(selected = window == w, onClick = { window = w },
                        label = { Text("$w T", style = MaterialTheme.typography.labelSmall) })
                }
            }
            val pts = steps.points
            val ords = pts.map { LocalDate.parse(it.day).toEpochDay() }
            val markerOrds = steps.markers.map { LocalDate.parse(it.day).toEpochDay() }
            Canvas(Modifier.fillMaxWidth().height(90.dp).padding(vertical = 6.dp)) {
                val min = pts.minOf { it.price }
                val max = pts.maxOf { it.price }
                val range = (max - min).coerceAtLeast(1e-6)
                val minOrd = ords.first()
                val ordRange = (ords.last() - minOrd).coerceAtLeast(1L).toFloat()
                fun x(o: Long) = (o - minOrd).toFloat() / ordRange * size.width
                fun y(v: Double) = (size.height - ((v - min) / range).toFloat() * size.height)
                val path = Path()
                pts.forEachIndexed { i, p ->
                    if (i == 0) path.moveTo(x(ords[0]), y(p.price))
                    else { path.lineTo(x(ords[i]), y(pts[i - 1].price)); path.lineTo(x(ords[i]), y(p.price)) }
                }
                drawPath(path, Primary, style = Stroke(width = 3f))
                markerOrds.forEach { o ->
                    drawLine(Gold, Offset(x(o), 0f), Offset(x(o), size.height), strokeWidth = 2f,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 6f)))
                }
            }
            Text("%.2f € – %.2f €".format(pts.minOf { it.price }, pts.maxOf { it.price }),
                style = MaterialTheme.typography.labelSmall, color = Muted)
            steps.markers.forEach { m ->
                Text("Quelle: ${PriceFamily.LABELS[m.family]} ab ${UtcDay.formatDe(m.day)}",
                    style = MaterialTheme.typography.labelSmall, color = Gold)
            }
        }
    }
}
```

- [ ] **Step 2: Einbinden** — In `CardDetailScreen.kt` direkt nach der schließenden Klammer der Kopfzeilen-`Row` (die mit `RarityChip(v.rarity)` … Löschen-Knopf, endet Zeile 173):
```kotlin
                    PriceHistoryChart(v)
```

- [ ] **Step 3: Verifizieren** — Android-Befehl grün.

- [ ] **Step 4: Commit**
```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/PriceHistoryChart.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt
git commit -m "feat(android): Preisverlauf als Stufenlinie im Kartendetail (G1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Abschluss — Gesamtprüfung, Builds, Abnahme-Vorbereitung (Controller)

Diese Task führt der Controller selbst aus, nicht ein Implementierungs-Subagent.

- [ ] **Step 1: Alles grün** — SQLite-Suite, Renderer-Helfer, Lint (genau 5), `npm run build`, Android `testDebugUnitTest assembleDebug`. Testzahlen ins Ledger.
- [ ] **Step 2: Zwillings-Kreuzprobe** — `movers.cjs` ↔ `Movers.kt` und `priceSteps.js` ↔ `PriceSteps.kt` Zeile für Zeile nebeneinander lesen (Rundung, `-0`, Sortierung, Grenzfälle Stichtag/Fensteranfang). Außerdem `price-reference.cjs#referenceRows` ↔ `supabase/price_reference_rpc.sql` (Sortierschlüssel identisch).
- [ ] **Step 3: Abschlussreview** mit dem besten Modell über den ganzen Zweig (`git diff main...HEAD`), Brief mit den Harten Regeln wörtlich. Funde beheben, Nachreview.
- [ ] **Step 4: Builds** — Desktop-Installer (`npm run dist`) und Debug-APK.
- [ ] **Step 5: Anhalten für den Nutzer** — Reihenfolge nach Spec §4.10: (1) Nutzer installiert Desktop-Build und startet ihn einmal, (2) Nutzer spielt `supabase/price_reference_rpc.sql` ein, (3) Nutzer spielt `supabase/price_history_seed.sql` ein. Erst danach APK auf Dev-Handy `22X0219322003405` per adb.
- [ ] **Step 6: Abnahme am Gerät** (adb, selbst tippen/messen) und am Desktop:
  1. Start (beide): Karte „Bewegungen · 7 Tage" erscheint ohne 0-€-Platzhalter; Leertext entspricht der Datenlage.
  2. Stichprobe: ein Printing aus der Liste auf beiden Geräten mit gleichem Δ € und Δ %.
  3. Insights (beide): 7/30 umschalten; Aufteilung Anzahl/Wert inkl. Binder mit „Nicht einsortiert".
  4. Kartendetail (beide): Chart, Chips, Leer-/Flat-Text; eine Karte mit Quellenwechsel zeigt die Marke.
  5. Handy: Seitenwechsel Start ↔ Sammlung ↔ Start löst keine RPC erneut aus (logcat/Netzwerk nicht mehr als einmal pro Tag); Pull-to-refresh lädt neu.
  6. Handy: Wertverlauf-Chart zeigt die jüngsten Tage; nach Pull-to-refresh aktuell.
  7. Desktop: nach „Preise jetzt aktualisieren" bzw. Bulk-Lauf entsteht eine `portfolio_history`-Zeile (sichtbar im Wert-Chart), sofern sich der Wert um mehr als 0,50 € bewegt hat.
- [ ] **Step 7: Nutzer fragen, ob gemergt wird.**

