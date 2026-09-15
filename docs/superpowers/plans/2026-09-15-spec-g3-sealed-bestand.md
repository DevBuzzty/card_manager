# Spec G3 Sealed-Bestand — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Versiegelte Produkte (Displays, Booster, Tins, Decks, Special Editions, Sonstiges) auf Desktop und Handy anlegen, zählen, öffnen und löschen; Preis = Cardmarket-Trend pro Einheit; Gesamtwert = Karten + Sealed auf beiden Geräten, Tageswert mit `sealed_value`.

**Architecture:** Die Produktliste entsteht am Desktop aus dem Cardmarket-Cache (`products_nonsingles_3.json` + `price_guide_3.json`) und reist als `sealed_products` im Offline-Katalog aufs Handy. Der Bestand liegt in `sealed_items` (SQLite und Supabase, ohne `user_id`, nur Soft-Delete); der Desktop synchronisiert ihn als vierten Strom, das Handy liest und schreibt per REST in einen `ListCache`. Preise setzen der Desktop-Bulk-Lauf (Schritt C) und die tägliche Edge Function (RPC `apply_cardmarket_sealed_prices`) mit derselben Trend-Regel (Zwilling Deno ↔ Node). Wert, Veraltung, Art-Bezeichnung und Listenreihenfolge sind ein JS/Kotlin-Zwilling gegen gemeinsame Fixtures.

**Tech Stack:** Deno (Edge Function, `jsr:@supabase/supabase-js@2`, `jsr:@std/assert@1`), Postgres/PostgREST, Electron CJS + better-sqlite3, React/Vite, Kotlin/Compose (Material3), OkHttp + org.json, SQLiteOpenHelper, kotlinx-coroutines-test.

**Spec:** `docs/superpowers/specs/2026-09-15-spec-g-nachtrag-g3-sealed-bestand.md` (ändert `docs/superpowers/specs/2026-09-05-spec-g-portfolio-pro-design.md`; setzt G1 `4a1ab8b` und G2 `554d731` voraus).

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus und verbinden sich nie mit Supabase (auch keine Edge-Function-Aufrufe, kein Deploy). SQL schreibt der Nutzer von Hand im Dashboard ein; der Plan liefert nur die SQL-Dateien. Ebenso deployt der Nutzer Funktionen.
- Immer explizite Pfade stagen, nie `git add -A`, nie `git stash` (der Stash-Stack ist mit den Worktrees geteilt).
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI). `desktop/node_modules` ist im Worktree eine Junction.
- `cards.quantity` und `cards.deleted` pflegen Trigger, die App schreibt sie nie. Nur Soft-Delete (auch für `sealed_items`).
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs`.
- Sichtbare Texte deutsch mit echten Umlauten, „Fächer" statt „Taschen". Gespeichertes `Unknown`/leer erscheint als „Unbekannt".
- Regeln wohnen in reinen, getesteten Helfern (Android `ml/`, Desktop `src/utils/` bzw. `electron/`, Cloud in eigenen `.ts`-Dateien der Funktion). Absichtliche Zwillinge werden im Kopfkommentar markiert und beidseitig getestet.
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`); ein sechster ist ein Fehlschlag.
- „Heute" ist überall das UTC-Datum.
- kotlinx-coroutines-test: `advanceUntilIdle()` treibt Arbeit in `backgroundScope` NICHT an; Endlosschleifen nie mit `advanceUntilIdle()`. Für jeden Schutz-Test nachweisen, dass er ohne den Schutz scheitert (kurz sabotieren, Fehlschlag im Bericht zitieren, zurücknehmen).
- Teure Rechnungen nie ungemerkt in der Komposition (`remember`/Memo).
- Ein Platzhalter darf nie wie eine leere Liste aussehen („0,00 €" o. ä.).
- M3 1.2.1 Pull-to-refresh greift nur über scrollbarem Inhalt und braucht `clipToBounds()` (steckt in `RefreshableBox`; Inhalte darin sind `LazyColumn`).
- `react-hooks/set-state-in-effect`: kein synchrones setState im Effekt-Körper (Lazy-Init, setState nur in Promise-Callbacks/Handlern). `react-hooks/purity`: kein `Date.now()` im Render — „Preis veraltet" kommt fertig über IPC.
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- G3-spezifisch: Kein Bild, kein Freitext-Produkt, keine Alarme auf Sealed, kein Sealed-Preisverlauf (`sealed_price_history` entfällt), keine zweite Fläche im Wertverlauf, Sealed nicht in „Aufteilung", keine Deals-Kopplung, keine Rückrechnung alter Tageswerte (Spec §2 „Nicht drin").
- G3-spezifisch: `kind` ∈ `display`, `booster`, `tin`, `deck`, `special`, `other`; die Zuordnung aus der Cardmarket-Kategorie steht an genau einer Stelle (`desktop/electron/catalog-build.cjs#sealedKindOf`). Trend-Regel: nur `trend > 0` und `≠ price` schreibt; kein Rückfall auf `low`/`avg`. „Preis veraltet" = `price_updated_at` älter als 30 Tage; der Wert zählt weiter.
- `deno.lock` in der Repo-Wurzel ist ungetrackt und wird nie gestaged, auch wenn `deno test` ihn anfasst.

**Befehle (aus der Worktree-Wurzel, sofern nicht anders angegeben):**
- Deno: `deno test --allow-read --node-modules-dir=none supabase/functions/refresh-cardmarket-prices/`
- Deno-Typprüfung: `deno check --node-modules-dir=none supabase/functions/refresh-cardmarket-prices/index.ts`
- Desktop-Hauptprozess (rein, ohne SQLite): `node --test desktop/electron/sealed-value.test.cjs desktop/electron/sealed-prices.test.cjs`
- Desktop SQLite-Suite (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Desktop-Helfer (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs`
- Desktop-Lint (in `desktop/`): `npx eslint .` → genau `5 errors` (gelintet werden nur `*.js`/`*.jsx`, nicht `*.cjs`/`*.mjs`)
- Desktop-Build (in `desktop/`): `npx vite build`
- Android: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `docs/fixtures/portfolio/sealed-value.json` (neu) | Wert, Veraltung, Art-Bezeichnung, Reihenfolge | 1 |
| `desktop/electron/sealed-value.cjs` + `.test.cjs` (neu) | Zwilling JS | 1 |
| `android/.../cloud/SealedItem.kt` (neu) | Zeile des Sealed-Bestands | 1 |
| `android/.../ml/SealedValue.kt` + `SealedValueTest.kt` (neu) | Zwilling Kotlin | 1 |
| `docs/fixtures/portfolio/sealed-prices.json` (neu) | Fälle der Trend-Regel | 2 |
| `supabase/functions/refresh-cardmarket-prices/sealed.ts` + `sealed_test.ts` (neu) | Trend-Regel Deno | 2 |
| `desktop/electron/sealed-prices.cjs` + `.test.cjs` (neu) | Trend-Regel Node | 2 |
| `supabase/sealed_items_schema.sql` (neu) | Tabelle, Trigger, RLS, RPC | 3 |
| `supabase/functions/refresh-cardmarket-prices/index.ts` | Sealed-Durchgang | 4 |
| `desktop/electron/catalog-build.cjs` + `catalog-build.test.cjs` | Art-Zuordnung, `sealed_products` im Katalog | 5 |
| `desktop/electron/sealed-products.cjs` + `.test.cjs` (neu) | Produktliste aus dem Cache, Suche | 5 |
| `desktop/electron/catalog-builder.cjs`, `main.cjs` (2 Aufrufe) | Katalog-Bau mit Produktliste | 5 |
| `desktop/electron/sealed-items.cjs` + `.test.cjs` (neu) | SQLite-Schema und Datenhelfer, Schritt C | 6 |
| `desktop/electron/database.cjs` | Schema registrieren | 6 |
| `desktop/electron/cardmarket-bulk.cjs` + `.test.cjs` | Bulk-Schritt C | 6 |
| `desktop/electron/portfolio-value.cjs` + `.test.cjs` | Gesamtwert Karten + Sealed, `sealed_value` | 7 |
| `desktop/electron/sync.cjs` | vierter Strom, Tageswert mit `sealed_value` | 7 |
| `desktop/electron/sealed-sync.test.cjs` (neu) | Push, Pull, Echo-Skip, Soft-Delete, Reihenfolge | 7 |
| `desktop/electron/main.cjs`, `preload.cjs` | IPC, `get-portfolio`, `sealed-changed` nach Bulk | 8 |
| `desktop/src/utils/routes.js`, `i18n-de.js` (+ Tests) | Route und Vokabel | 8 |
| `desktop/src/components/SealedList.jsx`, `SealedAddDialog.jsx` (neu) | Sammlung › Sealed | 8 |
| `desktop/src/components/SammlungLayout.jsx`, `App.jsx`, `Start.jsx`, `Portfolio.jsx` | Einbau | 8 |
| `android/.../cloud/CatalogParser.kt`, `CatalogDb.kt`, `CatalogRepository.kt` | Katalog v2, Import, Suche | 9 |
| `android/.../CatalogSealedTest.kt` (neu) | Parser, Version, Suchargumente | 9 |
| `android/.../cloud/SealedRepository.kt` (neu), `SnapshotsRepository.kt`, `SideStores.kt` | REST, Speicher | 10 |
| `android/.../ml/SealedSnapshot.kt` + `SealedSnapshotTest.kt`, `SealedRepositoryTest.kt` (neu) | Tageswert-Schutz, Abfragen | 10 |
| `android/.../ui/StartScreen.kt`, `AppNav.kt` | Nachladen, Tageswert | 10 |
| `android/.../ui/SealedScreen.kt`, `SealedSearchScreen.kt` (neu) | Sammlung › Sealed, Suche | 11 |
| `android/.../ui/SammlungScreen.kt`, `AppNav.kt`, `StartScreen.kt` | Segment, Route, Wert-Karte | 11 |

`android/...` = `android/app/src/main/java/com/example/yugiohscanner`, Tests unter `android/app/src/test/java/com/example/yugiohscanner/` (Paket `com.example.yugiohscanner`, Fixture-Lesen über `Fixtures.text("docs/fixtures/...")`). Die Android-Unit-Tests laufen auf der JVM ohne Robolectric — echtes SQLite gibt es dort nicht.

**Bewusste Ergänzungen gegenüber der Spec (vom Plan entschieden, im Ledger vermerkt):**
1. Die Listenreihenfolge (Zeilensumme absteigend, ohne Preis ans Ende, dann Name, dann `sealed_id`) ist Teil des Zwillings (`sortSealed`), weil beide Geräte „Inhalt wie Desktop" zeigen; die Spec nennt nur die Sortierung am Desktop.
2. Der Zwilling enthält `toUtcMillis`, das beide Zeitstempelformen liest (lokal `2026-09-15 05:00:03`, Cloud `2026-09-15T05:00:03.123456+00:00`). Der Desktop-Sync wandelt `price_updated_at` damit in beide Richtungen um (lokal sekundengenau ohne Zone, Cloud ISO mit `Z`) — derselbe Grund wie bei `CONTAINER_LOCAL_COLS`.
3. `sealed_id` ist `text` mit UUID-Werten (wie `copy_id`/`container_id`), `price` ist `double precision` bzw. `REAL` (wie `price_history.price`), damit der RPC-Vergleich `is distinct from` exakt gegen JSON-Zahlen läuft; `cm_product_id` ist `integer`.
4. Die RPC wird nur `service_role` freigegeben (wie `apply_cardmarket_prices`); das Handy schreibt direkt in die Tabelle.
5. Bei doppelten `idProduct` im Price-Guide gilt der erste gültige Trend (wie `pickTrends`). Dieselbe Funktion `trendById` liefert auch den Startpreis `trend` im Katalog.
6. `portfolioTotals(db)` in `portfolio-value.cjs` ist die einzige Stelle für „Karten + Sealed" am Desktop (`get-portfolio`, `recordPortfolioValue`, `syncSnapshot`). Gespeicherte Summen werden wie `totalValue` auf Cent gerundet; `sealedValue` selbst rundet nicht.
7. `openSealed` löscht bei Menge 1 weich; die Rückfrage stellt die Oberfläche vorher. „Menge −" bei Menge 1 fragt und ruft dann `sealed-delete`.
8. Desktop-Hinweis „Geöffnet — Jetzt scannen" steht in der Zeile; ist die Zeile nach dem Öffnen weg (Menge war 1), steht er über der Liste.
9. Handy-Start bei gescheiterter Sealed-Liste ohne früheren Stand: Kartenwert plus Hinweis „Sealed-Wert nicht geladen — zum Aktualisieren ziehen" statt eines endlosen Ladezustands; ein Tageswert wird dann nicht geschrieben.
10. `CatalogDb` v2 wird auf der JVM über Parser, Versionskonstante und reine Suchargumente getestet; der Datenbank-Rundlauf (Import und Suche) ist Teil der Geräte-Abnahme, weil das Projekt kein Robolectric hat.
11. Pull und Push des Sealed-Stroms sind einzeln nicht-fatal (Fehler loggen, Zyklus läuft weiter) — sonst bräche eine fehlende Cloud-Tabelle auch die Preishistorie, den Tageswert und die Preis-Alarme ab.
12. `sealed-changed` feuert auch nach einem Bulk-Lauf, der Sealed-Preise geändert hat; Sammlung › Sealed, Start und Insights › Wert laden darauf neu.
13. `runCatalogBuild` bekommt die Option `userDataPath`; ohne sie oder ohne Cache bleibt `sealed_products` leer.
14. Die Antwort der Edge Function bekommt ein Feld `sealed` (`{ needed, updated }` oder `{ error }`); ohne Karten-IDs läuft der Sealed-Durchgang trotzdem.
15. Das Segment „Sealed" steht auf beiden Geräten als letztes.

---
### Task 1: Wert-Zwilling (JS und Kotlin) mit Fixture

**Files:**
- Create: `docs/fixtures/portfolio/sealed-value.json`
- Create: `desktop/electron/sealed-value.cjs`
- Create: `desktop/electron/sealed-value.test.cjs`
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/SealedItem.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/SealedValue.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/SealedValueTest.kt`

**Interfaces:**
- Produces (JS, für Task 5–8): `SEALED_KINDS: string[]`, `KIND_LABELS`, `sealedValue(items) → number`, `lineValue(item) → number|null`, `toUtcMillis(ts) → number|null`, `isPriceStale(priceUpdatedAt, nowMs) → boolean`, `kindLabel(kind) → string`, `sortSealed(items) → items` (neue Liste). `items` sind Objekte mit `sealed_id, name, quantity, price, deleted` (0/1 oder Boolean).
- Produces (Kotlin, für Task 9–11): `data class SealedItem(sealedId: String, cmProductId: Long, name: String, kind: String, quantity: Int, price: Double?, priceUpdatedAt: String?, createdAt: String? = null, deleted: Boolean = false)`; `SealedValue.KIND_LABELS: Map<String, String>`, `kindLabel(kind: String?)`, `lineValue(item)`, `sealedValue(items)`, `toUtcMillis(ts: String?): Long?`, `isPriceStale(priceUpdatedAt: String?, nowMs: Long)`, `sortSealed(items)`.

- [ ] **Step 1: Fixture schreiben**

`docs/fixtures/portfolio/sealed-value.json` (Stichtag `2026-09-15T12:00:00Z`, 30 Tage davor = `2026-08-16T12:00:00Z`):
```json
{
  "_comment": "Spec G3 §6 — desktop/electron/sealed-value.test.cjs und SealedValueTest.kt lesen diese Datei.",
  "value": [
    { "name": "leer", "items": [], "value": 0 },
    {
      "name": "Menge mal Preis über zwei Zeilen",
      "items": [
        { "quantity": 2, "price": 499.25, "deleted": false },
        { "quantity": 1, "price": 34.5, "deleted": false }
      ],
      "value": 1033
    },
    {
      "name": "Zeile ohne Preis zählt nicht",
      "items": [
        { "quantity": 3, "price": null, "deleted": false },
        { "quantity": 1, "price": 12.75, "deleted": false }
      ],
      "value": 12.75
    },
    {
      "name": "gelöschte Zeile zählt nicht (Boolean)",
      "items": [
        { "quantity": 2, "price": 10, "deleted": true },
        { "quantity": 2, "price": 10, "deleted": false }
      ],
      "value": 20
    },
    {
      "name": "gelöschte Zeile zählt nicht (SQLite 0/1)",
      "items": [
        { "quantity": 5, "price": 100, "deleted": 1 },
        { "quantity": 1, "price": 0.5, "deleted": 0 }
      ],
      "value": 0.5
    }
  ],
  "now": "2026-09-15T12:00:00Z",
  "stale": [
    { "name": "ohne Zeitstempel", "price_updated_at": null, "stale": false },
    { "name": "leerer Zeitstempel", "price_updated_at": "", "stale": false },
    { "name": "unlesbarer Zeitstempel", "price_updated_at": "kaputt", "stale": false },
    { "name": "lokal, fünf Tage alt", "price_updated_at": "2026-09-10 08:00:00", "stale": false },
    { "name": "genau 30 Tage ist nicht veraltet", "price_updated_at": "2026-08-16T12:00:00Z", "stale": false },
    { "name": "lokal, 30 Tage und 1 Sekunde", "price_updated_at": "2026-08-16 11:59:59", "stale": true },
    { "name": "Cloud mit Mikrosekunden", "price_updated_at": "2026-08-01T09:30:00.123456+00:00", "stale": true },
    { "name": "Cloud mit einer Nachkommastelle, jung", "price_updated_at": "2026-08-20T10:15:00.5+00:00", "stale": false },
    { "name": "Zeitzone +02:00 zählt in UTC", "price_updated_at": "2026-08-16T13:00:00+02:00", "stale": true }
  ],
  "kinds": [
    { "kind": "display", "label": "Display" },
    { "kind": "booster", "label": "Booster" },
    { "kind": "tin", "label": "Tin" },
    { "kind": "deck", "label": "Deck" },
    { "kind": "special", "label": "Special Edition" },
    { "kind": "other", "label": "Sonstiges" },
    { "kind": "karton", "label": "Sonstiges" },
    { "kind": null, "label": "Sonstiges" }
  ],
  "order": [
    {
      "name": "Zeilensumme absteigend, gleiche Summe nach Name, ohne Preis ans Ende",
      "items": [
        { "sealed_id": "s-a", "name": "Metal Raiders Booster Box", "quantity": 1, "price": 499.29, "deleted": false },
        { "sealed_id": "s-b", "name": "Force of the Breaker Booster", "quantity": 20, "price": 34.22, "deleted": false },
        { "sealed_id": "s-c", "name": "Legend of Blue Eyes White Dragon Booster Box", "quantity": 1, "price": null, "deleted": false },
        { "sealed_id": "s-d", "name": "Collector Tin 2024", "quantity": 2, "price": null, "deleted": false },
        { "sealed_id": "s-e", "name": "Spell Ruler Booster Box", "quantity": 1, "price": 97.05, "deleted": false },
        { "sealed_id": "s-f", "name": "Magic Ruler Booster Box", "quantity": 1, "price": 97.05, "deleted": false }
      ],
      "expected": ["s-b", "s-a", "s-f", "s-e", "s-d", "s-c"]
    },
    {
      "name": "gleicher Name und gleiche Summe nach sealed_id",
      "items": [
        { "sealed_id": "s-2", "name": "Spell Ruler Booster Box", "quantity": 1, "price": 97.05, "deleted": false },
        { "sealed_id": "s-1", "name": "Spell Ruler Booster Box", "quantity": 1, "price": 97.05, "deleted": false }
      ],
      "expected": ["s-1", "s-2"]
    }
  ]
}
```

- [ ] **Step 2: JS-Test schreiben**

`desktop/electron/sealed-value.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { sealedValue, isPriceStale, kindLabel, sortSealed, SEALED_KINDS } = require('./sealed-value.cjs');

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/SealedValueTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'portfolio', 'sealed-value.json'), 'utf8'));

test('Sealed-Wert', () => {
  for (const c of FIX.value) {
    const v = sealedValue(c.items);
    assert.ok(Math.abs(v - c.value) < 1e-9, `${c.name}: ${v} statt ${c.value}`);
  }
});

test('Preis veraltet', () => {
  const now = Date.parse(FIX.now);
  for (const c of FIX.stale) assert.equal(isPriceStale(c.price_updated_at, now), c.stale, c.name);
});

test('Art-Bezeichnungen', () => {
  for (const c of FIX.kinds) assert.equal(kindLabel(c.kind), c.label, String(c.kind));
  assert.deepStrictEqual(SEALED_KINDS, ['display', 'booster', 'tin', 'deck', 'special', 'other']);
});

test('Reihenfolge der Liste', () => {
  for (const c of FIX.order) {
    const before = c.items.map((i) => i.sealed_id);
    assert.deepStrictEqual(sortSealed(c.items).map((i) => i.sealed_id), c.expected, c.name);
    assert.deepStrictEqual(c.items.map((i) => i.sealed_id), before, 'sortSealed darf die Eingabe nicht umsortieren');
  }
});
```

- [ ] **Step 3: Kotlin-Test schreiben**

`android/app/src/test/java/com/example/yugiohscanner/SealedValueTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SealedItem
import com.example.yugiohscanner.ml.SealedValue
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

/** ZWILLING von desktop/electron/sealed-value.test.cjs -- dieselbe Fixture docs/fixtures/portfolio/sealed-value.json. */
class SealedValueTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/portfolio/sealed-value.json"))

    private fun item(o: JSONObject) = SealedItem(
        sealedId = o.optString("sealed_id", "x"),
        cmProductId = o.optLong("cm_product_id", 1L),
        name = o.optString("name", ""),
        kind = o.optString("kind", "display"),
        quantity = o.getInt("quantity"),
        price = if (o.isNull("price")) null else o.getDouble("price"),
        priceUpdatedAt = null,
        deleted = when (val d = o.opt("deleted")) {
            is Boolean -> d
            is Number -> d.toInt() != 0
            else -> false
        },
    )

    private fun items(a: JSONArray) = (0 until a.length()).map { item(a.getJSONObject(it)) }

    @Test fun `Sealed-Wert`() {
        val cases = fix.getJSONArray("value")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            assertEquals(c.getString("name"), c.getDouble("value"), SealedValue.sealedValue(items(c.getJSONArray("items"))), 1e-9)
        }
    }

    @Test fun `Preis veraltet`() {
        val now = Instant.parse(fix.getString("now")).toEpochMilli()
        val cases = fix.getJSONArray("stale")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val ts = if (c.isNull("price_updated_at")) null else c.getString("price_updated_at")
            assertEquals(c.getString("name"), c.getBoolean("stale"), SealedValue.isPriceStale(ts, now))
        }
    }

    @Test fun `Art-Bezeichnungen`() {
        val cases = fix.getJSONArray("kinds")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val kind = if (c.isNull("kind")) null else c.getString("kind")
            assertEquals("$kind", c.getString("label"), SealedValue.kindLabel(kind))
        }
        assertEquals(listOf("display", "booster", "tin", "deck", "special", "other"), SealedValue.KIND_LABELS.keys.toList())
    }

    @Test fun `Reihenfolge der Liste`() {
        val cases = fix.getJSONArray("order")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val expected = c.getJSONArray("expected").let { a -> (0 until a.length()).map { a.getString(it) } }
            assertEquals(c.getString("name"), expected, SealedValue.sortSealed(items(c.getJSONArray("items"))).map { it.sealedId })
        }
    }
}
```

- [ ] **Step 4: Fehlschlag bestätigen**

Run: `node --test desktop/electron/sealed-value.test.cjs`
Expected: FAIL — `Cannot find module './sealed-value.cjs'`.
Den Kotlin-Fehlschlag (`Unresolved reference: SealedValue`/`SealedItem`) nicht eigens bauen; er zeigt sich im Gradle-Lauf von Step 8, wenn Step 6/7 fehlen.

- [ ] **Step 5: `desktop/electron/sealed-value.cjs` schreiben**

```js
// Spec G3 §6 — Wert, Veraltung, Art-Bezeichnung und Listenreihenfolge des Sealed-Bestands.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/SealedValue.kt. Beide laufen gegen
// docs/fixtures/portfolio/sealed-value.json (sealed-value.test.cjs bzw. SealedValueTest.kt).
// Wer eine Seite aendert, aendert beide. Gerundet wird nur in der Anzeige.
const DAY_MS = 86400000;
const STALE_DAYS = 30;
const ZONE = /(Z|[+-]\d{2}:\d{2})$/;

// Reihenfolge = Reihenfolge der Schluessel; die Schluessel sind die Werte der Spalte sealed_items.kind.
const KIND_LABELS = {
  display: 'Display',
  booster: 'Booster',
  tin: 'Tin',
  deck: 'Deck',
  special: 'Special Edition',
  other: 'Sonstiges',
};
const SEALED_KINDS = Object.keys(KIND_LABELS);

const kindLabel = (kind) => (kind != null && Object.hasOwn(KIND_LABELS, kind) ? KIND_LABELS[kind] : 'Sonstiges');

const lineValue = (item) => (item.price == null ? null : Number(item.quantity) * Number(item.price));

// Summe quantity × price ueber lebende Zeilen mit Preis. deleted ist lokal 0/1, in der Cloud Boolean.
function sealedValue(items) {
  let sum = 0;
  for (const item of items || []) {
    if (item.deleted || item.price == null) continue;
    sum += Number(item.quantity) * Number(item.price);
  }
  return sum;
}

// Liest lokal "2026-09-15 05:00:03" (naive UTC) und Cloud "2026-09-15T05:00:03.123456+00:00".
// Nachkommastellen werden auf Millisekunden gekuerzt bzw. aufgefuellt, wie toEpochMilli() in Kotlin.
function toUtcMillis(ts) {
  if (ts == null || String(ts).trim() === '') return null;
  let s = String(ts).trim().replace(' ', 'T').replace(/\.(\d+)/, (m, d) => `.${(d + '00').slice(0, 3)}`);
  if (!ZONE.test(s)) s += 'Z';
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

// "aelter als 30 Tage": genau 30 Tage ist noch nicht veraltet.
function isPriceStale(priceUpdatedAt, nowMs) {
  const t = toUtcMillis(priceUpdatedAt);
  return t != null && nowMs - t > STALE_DAYS * DAY_MS;
}

const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// Zeilensumme absteigend, Zeilen ohne Preis ans Ende, dann Name, dann sealed_id. Neue Liste.
function sortSealed(items) {
  return [...(items || [])].sort((a, b) => {
    const va = lineValue(a);
    const vb = lineValue(b);
    if (va != null && vb == null) return -1;
    if (va == null && vb != null) return 1;
    if (va != null && vb != null && va !== vb) return vb - va;
    return cmp(a.name, b.name) || cmp(a.sealed_id, b.sealed_id);
  });
}

module.exports = { SEALED_KINDS, KIND_LABELS, kindLabel, lineValue, sealedValue, toUtcMillis, isPriceStale, sortSealed };
```

- [ ] **Step 6: `cloud/SealedItem.kt` schreiben**

```kotlin
package com.example.yugiohscanner.cloud

/**
 * Spec G3 §4.1 -- eine Zeile aus `sealed_items` (supabase/sealed_items_schema.sql). `price` ist der
 * Cardmarket-Trend pro Einheit, `priceUpdatedAt`/`createdAt` sind die rohen Cloud-Zeitstempel.
 */
data class SealedItem(
    val sealedId: String,
    val cmProductId: Long,
    val name: String,
    val kind: String,
    val quantity: Int,
    val price: Double?,
    val priceUpdatedAt: String?,
    val createdAt: String? = null,
    val deleted: Boolean = false,
)
```

- [ ] **Step 7: `ml/SealedValue.kt` schreiben**

```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.SealedItem
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

/**
 * Spec G3 §6 -- Wert, Veraltung, Art-Bezeichnung und Listenreihenfolge des Sealed-Bestands.
 * ZWILLING: desktop/electron/sealed-value.cjs. Beide laufen gegen docs/fixtures/portfolio/sealed-value.json.
 * Wer eine Seite aendert, aendert beide. Gerundet wird nur in der Anzeige.
 */
object SealedValue {
    private const val DAY_MS = 86_400_000L
    private const val STALE_DAYS = 30
    private val ZONE = Regex("""(Z|[+-]\d{2}:\d{2})$""")

    /** Reihenfolge = Reihenfolge der Schluessel; die Schluessel sind die Werte der Spalte sealed_items.kind. */
    val KIND_LABELS: Map<String, String> = linkedMapOf(
        "display" to "Display",
        "booster" to "Booster",
        "tin" to "Tin",
        "deck" to "Deck",
        "special" to "Special Edition",
        "other" to "Sonstiges",
    )

    fun kindLabel(kind: String?): String = kind?.let { KIND_LABELS[it] } ?: "Sonstiges"

    fun lineValue(item: SealedItem): Double? = item.price?.let { item.quantity * it }

    /** Summe quantity x price ueber lebende Zeilen mit Preis. */
    fun sealedValue(items: List<SealedItem>): Double {
        var sum = 0.0
        for (item in items) {
            if (item.deleted) continue
            val p = item.price ?: continue
            sum += item.quantity * p
        }
        return sum
    }

    /** Liest lokal "2026-09-15 05:00:03" (naive UTC) und Cloud "2026-09-15T05:00:03.123456+00:00". */
    fun toUtcMillis(ts: String?): Long? {
        if (ts.isNullOrBlank()) return null
        var s = ts.trim().replaceFirst(' ', 'T')
        if (!ZONE.containsMatchIn(s)) s += "Z"
        return try {
            OffsetDateTime.parse(s).toInstant().toEpochMilli()
        } catch (e: DateTimeParseException) {
            null
        }
    }

    /** "aelter als 30 Tage": genau 30 Tage ist noch nicht veraltet. */
    fun isPriceStale(priceUpdatedAt: String?, nowMs: Long): Boolean {
        val t = toUtcMillis(priceUpdatedAt) ?: return false
        return nowMs - t > STALE_DAYS * DAY_MS
    }

    /** Zeilensumme absteigend, Zeilen ohne Preis ans Ende, dann Name, dann sealedId. */
    fun sortSealed(items: List<SealedItem>): List<SealedItem> = items.sortedWith(Comparator { a, b ->
        val va = lineValue(a)
        val vb = lineValue(b)
        when {
            va != null && vb == null -> -1
            va == null && vb != null -> 1
            va != null && vb != null && va != vb -> vb.compareTo(va)
            else -> a.name.compareTo(b.name).takeIf { it != 0 } ?: a.sealedId.compareTo(b.sealedId)
        }
    })
}
```

- [ ] **Step 8: Tests laufen lassen**

Run: `node --test desktop/electron/sealed-value.test.cjs` → PASS (4).
Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "com.example.yugiohscanner.SealedValueTest"` → PASS (4).

- [ ] **Step 9: Schutz-Nachweis**

In `sealed-value.cjs#isPriceStale` kurz `>` durch `>=` ersetzen → `node --test` scheitert am Fall „genau 30 Tage ist nicht veraltet"; Fehlschlag zitieren, zurücknehmen. Dasselbe in `SealedValue.kt#isPriceStale` mit `--tests "com.example.yugiohscanner.SealedValueTest"`.

- [ ] **Step 10: Commit**

```bash
git add docs/fixtures/portfolio/sealed-value.json desktop/electron/sealed-value.cjs desktop/electron/sealed-value.test.cjs android/app/src/main/java/com/example/yugiohscanner/cloud/SealedItem.kt android/app/src/main/java/com/example/yugiohscanner/ml/SealedValue.kt android/app/src/test/java/com/example/yugiohscanner/SealedValueTest.kt
git commit -m "feat(g3): Sealed-Wert, Veraltung, Art und Reihenfolge als JS/Kotlin-Zwilling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: Trend-Regel für Sealed als Zwilling (Deno und Node)

**Files:**
- Create: `docs/fixtures/portfolio/sealed-prices.json`
- Create: `supabase/functions/refresh-cardmarket-prices/sealed.ts`
- Create: `supabase/functions/refresh-cardmarket-prices/sealed_test.ts`
- Create: `desktop/electron/sealed-prices.cjs`
- Create: `desktop/electron/sealed-prices.test.cjs`

**Interfaces:**
- Produces (Deno, für Task 4): Typen `SealedRow = { sealed_id: string; cm_product_id: number; price: number | null }`, `SealedUpdate = { sealed_id: string; cm_product_id: number; price: number }`; `trendById(priceGuides: unknown): Map<number, number>`, `pickSealedUpdates(rows: SealedRow[], priceGuides: unknown): SealedUpdate[]`.
- Produces (Node, für Task 5 und 6): `trendById(priceGuides)`, `pickSealedUpdates(rows, priceGuides)` — gleiche Semantik. `priceGuides` ist das Array `priceGuides` aus `price_guide_3.json` (nicht das ganze Objekt).

- [ ] **Step 1: Fixture schreiben**

`docs/fixtures/portfolio/sealed-prices.json` (Produkt-IDs und Trends aus dem echten Cache vom 2026-09-14, `999001`/`555555` erfunden):
```json
{
  "_comment": "Spec G3 §5 — Trend-Regel fuer Sealed. sealed_test.ts (Deno) und desktop/electron/sealed-prices.test.cjs lesen diese Datei.",
  "cases": [
    {
      "name": "neu: Zeile ohne Preis bekommt den Trend",
      "items": [{ "sealed_id": "s1", "cm_product_id": 254469, "price": null }],
      "guide": [{ "idProduct": 254469, "idCategory": 42, "avg": 6500, "low": 465, "trend": 499.29 }],
      "expected": [{ "sealed_id": "s1", "cm_product_id": 254469, "price": 499.29 }]
    },
    {
      "name": "geändert: anderer Trend ersetzt den Preis",
      "items": [{ "sealed_id": "s1", "cm_product_id": 254469, "price": 450 }],
      "guide": [{ "idProduct": 254469, "idCategory": 42, "avg": 6500, "low": 465, "trend": 499.29 }],
      "expected": [{ "sealed_id": "s1", "cm_product_id": 254469, "price": 499.29 }]
    },
    {
      "name": "unverändert: gleicher Trend schreibt nichts",
      "items": [{ "sealed_id": "s1", "cm_product_id": 254469, "price": 499.29 }],
      "guide": [{ "idProduct": 254469, "idCategory": 42, "avg": 6500, "low": 465, "trend": 499.29 }],
      "expected": []
    },
    {
      "name": "Trend 0 zählt nicht",
      "items": [{ "sealed_id": "s1", "cm_product_id": 999001, "price": 12 }],
      "guide": [{ "idProduct": 999001, "idCategory": 42, "avg": null, "low": 0.02, "trend": 0 }],
      "expected": []
    },
    {
      "name": "fehlend: Produkt nicht im Price-Guide",
      "items": [{ "sealed_id": "s1", "cm_product_id": 555555, "price": 12 }],
      "guide": [{ "idProduct": 254469, "idCategory": 42, "avg": 6500, "low": 465, "trend": 499.29 }],
      "expected": []
    },
    {
      "name": "Trend null, kein Rückfall auf low oder avg",
      "items": [{ "sealed_id": "s1", "cm_product_id": 230006, "price": null }],
      "guide": [{ "idProduct": 230006, "idCategory": 6, "avg": 35, "low": 20, "trend": null }],
      "expected": []
    },
    {
      "name": "Trend als Text zählt nicht",
      "items": [{ "sealed_id": "s1", "cm_product_id": 230006, "price": null }],
      "guide": [{ "idProduct": 230006, "idCategory": 6, "avg": 35, "low": 20, "trend": "34.22" }],
      "expected": []
    },
    {
      "name": "doppelter Eintrag: erster gültiger Trend gilt",
      "items": [{ "sealed_id": "s1", "cm_product_id": 230007, "price": null }],
      "guide": [
        { "idProduct": 230007, "idCategory": 6, "trend": 0 },
        { "idProduct": 230007, "idCategory": 6, "trend": 46.11 },
        { "idProduct": 230007, "idCategory": 6, "trend": 50 }
      ],
      "expected": [{ "sealed_id": "s1", "cm_product_id": 230007, "price": 46.11 }]
    },
    {
      "name": "zwei Zeilen desselben Produkts, nur die geänderte",
      "items": [
        { "sealed_id": "s2", "cm_product_id": 230007, "price": 40 },
        { "sealed_id": "s3", "cm_product_id": 230007, "price": 46.11 }
      ],
      "guide": [{ "idProduct": 230007, "idCategory": 6, "avg": 48, "low": 45, "trend": 46.11 }],
      "expected": [{ "sealed_id": "s2", "cm_product_id": 230007, "price": 46.11 }]
    },
    {
      "name": "kaputter Price-Guide",
      "items": [{ "sealed_id": "s1", "cm_product_id": 254469, "price": null }],
      "guide": null,
      "expected": []
    }
  ]
}
```

- [ ] **Step 2: Deno-Test schreiben**

`supabase/functions/refresh-cardmarket-prices/sealed_test.ts`:
```ts
import { assertEquals } from "jsr:@std/assert@1";
import { pickSealedUpdates, type SealedRow } from "./sealed.ts";

// Spec G3 §10 — ZWILLING: desktop/electron/sealed-prices.test.cjs liest dieselbe Fixture.
const FIX = JSON.parse(
  await Deno.readTextFile(new URL("../../../docs/fixtures/portfolio/sealed-prices.json", import.meta.url)),
) as { cases: { name: string; items: SealedRow[]; guide: unknown; expected: unknown }[] };

for (const c of FIX.cases) {
  Deno.test(`sealed: ${c.name}`, () => {
    assertEquals(pickSealedUpdates(c.items, c.guide), c.expected);
  });
}
```

- [ ] **Step 3: Node-Test schreiben**

`desktop/electron/sealed-prices.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pickSealedUpdates, trendById } = require('./sealed-prices.cjs');

// ZWILLING: supabase/functions/refresh-cardmarket-prices/sealed_test.ts liest dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'fixtures', 'portfolio', 'sealed-prices.json'), 'utf8'));

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    assert.deepStrictEqual(pickSealedUpdates(c.items, c.guide), c.expected);
  });
}

test('trendById nimmt nur positive Zahlen', () => {
  const m = trendById([{ idProduct: 1, trend: 0 }, { idProduct: 1, trend: 2.5 }, { idProduct: 2, trend: -1 }, { idProduct: 3, trend: NaN }]);
  assert.deepStrictEqual([...m.entries()], [[1, 2.5]]);
});
```

- [ ] **Step 4: Fehlschlag bestätigen**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/refresh-cardmarket-prices/` → FAIL (`Module not found ... sealed.ts`).
Run: `node --test desktop/electron/sealed-prices.test.cjs` → FAIL (`Cannot find module './sealed-prices.cjs'`).

- [ ] **Step 5: `sealed.ts` schreiben**

```ts
// supabase/functions/refresh-cardmarket-prices/sealed.ts
// Spec G3 §5 — Trend-Regel fuer Sealed-Zeilen. Rein, ohne Netz; index.ts laedt und schreibt.
// ZWILLING: desktop/electron/sealed-prices.cjs (Desktop-Bulk-Schritt C). Beide laufen gegen
// docs/fixtures/portfolio/sealed-prices.json (sealed_test.ts bzw. sealed-prices.test.cjs).
// Wer eine Seite aendert, aendert beide.
export type SealedRow = { sealed_id: string; cm_product_id: number; price: number | null };
export type SealedUpdate = { sealed_id: string; cm_product_id: number; price: number };

/** Erster gueltiger Trend (endliche Zahl > 0) je idProduct. 0, null und Text zaehlen nicht; kein Rueckfall auf low/avg. */
export function trendById(priceGuides: unknown): Map<number, number> {
  const out = new Map<number, number>();
  if (!Array.isArray(priceGuides)) return out;
  for (const g of priceGuides as Array<{ idProduct?: unknown; trend?: unknown } | null>) {
    const id = Number(g?.idProduct);
    const t = g?.trend;
    if (out.has(id) || typeof t !== "number" || !Number.isFinite(t) || t <= 0) continue;
    out.set(id, t);
  }
  return out;
}

/** Neue Preise nur, wenn ein gueltiger Trend existiert und er vom gespeicherten Preis abweicht. Reihenfolge der Zeilen. */
export function pickSealedUpdates(rows: SealedRow[], priceGuides: unknown): SealedUpdate[] {
  const trends = trendById(priceGuides);
  const out: SealedUpdate[] = [];
  for (const r of rows) {
    const t = trends.get(Number(r.cm_product_id));
    if (t == null) continue;
    if (r.price != null && Number(r.price) === t) continue;
    out.push({ sealed_id: r.sealed_id, cm_product_id: Number(r.cm_product_id), price: t });
  }
  return out;
}
```

- [ ] **Step 6: `sealed-prices.cjs` schreiben**

```js
// desktop/electron/sealed-prices.cjs
// Spec G3 §5 — Trend-Regel fuer Sealed-Zeilen (Bulk-Schritt C) und Startpreis im Katalog.
// ZWILLING: supabase/functions/refresh-cardmarket-prices/sealed.ts. Beide laufen gegen
// docs/fixtures/portfolio/sealed-prices.json (sealed-prices.test.cjs bzw. sealed_test.ts).
// Wer eine Seite aendert, aendert beide.

// Erster gueltiger Trend (endliche Zahl > 0) je idProduct. 0, null und Text zaehlen nicht; kein Rueckfall auf low/avg.
function trendById(priceGuides) {
  const out = new Map();
  if (!Array.isArray(priceGuides)) return out;
  for (const g of priceGuides) {
    const id = Number(g && g.idProduct);
    const t = g && g.trend;
    if (out.has(id) || typeof t !== 'number' || !Number.isFinite(t) || t <= 0) continue;
    out.set(id, t);
  }
  return out;
}

// rows: [{ sealed_id, cm_product_id, price }]. Neue Preise nur bei gueltigem, abweichendem Trend; Reihenfolge der Zeilen.
function pickSealedUpdates(rows, priceGuides) {
  const trends = trendById(priceGuides);
  const out = [];
  for (const r of rows || []) {
    const t = trends.get(Number(r.cm_product_id));
    if (t == null) continue;
    if (r.price != null && Number(r.price) === t) continue;
    out.push({ sealed_id: r.sealed_id, cm_product_id: Number(r.cm_product_id), price: t });
  }
  return out;
}

module.exports = { trendById, pickSealedUpdates };
```

- [ ] **Step 7: Tests laufen lassen**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/refresh-cardmarket-prices/` → PASS, 14 Tests (4 `prices_test.ts` + 10 `sealed_test.ts`).
Run: `node --test desktop/electron/sealed-prices.test.cjs` → PASS (11).

- [ ] **Step 8: Schutz-Nachweis**

(a) In beiden Dateien die Zeile `if (r.price != null && Number(r.price) === t) continue;` kurz entfernen → Fall „unverändert: gleicher Trend schreibt nichts" scheitert in Deno und Node. (b) In beiden `t <= 0` durch `t < 0` ersetzen → Fall „Trend 0 zählt nicht" scheitert. Fehlschläge zitieren, zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add docs/fixtures/portfolio/sealed-prices.json supabase/functions/refresh-cardmarket-prices/sealed.ts supabase/functions/refresh-cardmarket-prices/sealed_test.ts desktop/electron/sealed-prices.cjs desktop/electron/sealed-prices.test.cjs
git commit -m "feat(g3): Trend-Regel fuer Sealed als Deno/Node-Zwilling

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: SQL für `sealed_items` und RPC (nur Datei, nichts ausführen)

**Files:**
- Create: `supabase/sealed_items_schema.sql`

**Interfaces:**
- Produces: `public.sealed_items` mit genau den Spalten, die Task 4, 7 und 10 benutzen (`sealed_id, cm_product_id, name, kind, quantity, price, price_updated_at, created_at, updated_at, deleted`), Upsert-Konflikt `sealed_id`; RPC `public.apply_cardmarket_sealed_prices(prices jsonb) returns integer` mit Elementen `{ id_product, trend }` (gleiche Form wie `apply_cardmarket_prices`).
- Consumes (vorhanden): `public.set_updated_at()` aus `supabase/schema.sql`.

- [ ] **Step 1: `supabase/sealed_items_schema.sql` schreiben**

```sql
-- supabase/sealed_items_schema.sql — Spec G3 §4.1/§5. Einmal im Dashboard einspielen (idempotent).
-- Gegenstueck zu desktop/electron/sealed-items.cjs. Setzt voraus: public.set_updated_at() (supabase/schema.sql).
-- Einzelnutzer-Modell wie card_copies: keine user_id, jede angemeldete Sitzung darf lesen und schreiben.
-- Nur Soft-Delete (deleted = true); Menge >= 1.

create table if not exists public.sealed_items (
  sealed_id        text primary key,               -- UUID, vom anlegenden Geraet erzeugt
  cm_product_id    integer not null,               -- Cardmarket idProduct
  name             text not null,                  -- englischer Cardmarket-Name beim Anlegen
  kind             text not null check (kind in ('display', 'booster', 'tin', 'deck', 'special', 'other')),
  quantity         integer not null check (quantity >= 1),
  price            double precision,               -- Cardmarket-Trend pro Einheit, null = kein Trend
  price_updated_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted          boolean not null default false
);

create index if not exists sealed_items_updated_idx on public.sealed_items (updated_at);
create index if not exists sealed_items_product_idx on public.sealed_items (cm_product_id) where deleted = false;

-- updated_at wird IMMER serverseitig gestempelt: der Desktop-Sync zieht ueber `updated_at > cursor`.
drop trigger if exists trg_sealed_items_updated_at on public.sealed_items;
create trigger trg_sealed_items_updated_at
  before insert or update on public.sealed_items
  for each row execute function public.set_updated_at();

alter table public.sealed_items enable row level security;
drop policy if exists sealed_items_authenticated_all on public.sealed_items;
create policy sealed_items_authenticated_all on public.sealed_items
  for all to authenticated using (true) with check (true);

-- Taegliche Cardmarket-Aktualisierung (Edge Function refresh-cardmarket-prices). Keine Historie (Spec G3 §1).
-- Nur Zeilen, deren Preis sich wirklich aendert; price_updated_at = now(); gibt die Anzahl zurueck.
create or replace function public.apply_cardmarket_sealed_prices(prices jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.sealed_items s
     set price = v.trend,
         price_updated_at = now()
    from jsonb_to_recordset(prices) as v(id_product integer, trend double precision)
   where s.cm_product_id = v.id_product
     and s.deleted = false
     and v.trend > 0
     and s.price is distinct from v.trend;
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.apply_cardmarket_sealed_prices(jsonb) from public;
grant execute on function public.apply_cardmarket_sealed_prices(jsonb) to service_role;
```

- [ ] **Step 2: Gegenprüfung ohne Datenbank**

Per Grep (lesend) bestätigen: die sechs `kind`-Werte in der SQL-Datei sind genau `SEALED_KINDS` aus `desktop/electron/sealed-value.cjs`; die Spaltennamen `id_product`/`trend` stehen gleich in `apply_cardmarket_prices` (`supabase/price_history_schema.sql`). Nichts ausführen, nicht mit Supabase verbinden.

- [ ] **Step 3: Commit**

```bash
git add supabase/sealed_items_schema.sql
git commit -m "feat(g3): SQL fuer sealed_items mit RLS und RPC apply_cardmarket_sealed_prices

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Edge Function `refresh-cardmarket-prices` — Sealed-Durchgang

**Files:**
- Modify: `supabase/functions/refresh-cardmarket-prices/index.ts` (ganze Datei, siehe unten)

**Interfaces:**
- Consumes (Task 2): `pickSealedUpdates`, `SealedRow` aus `./sealed.ts`; (vorhanden) `pickTrends` aus `./prices.ts`.
- Consumes (Task 3, erst beim Nutzer live): Tabelle `sealed_items`, RPC `apply_cardmarket_sealed_prices`.
- Produces: Antwort `{ needed, found, updated, sealed: { needed, updated } | { error } }`; Kartenfehler weiterhin `{ error }` mit 500/502.

Kein neuer Unit-Test (die Regel ist in Task 2 getestet); Prüfung per `deno check`. **Niemals deployen oder aufrufen.**

- [ ] **Step 1: `index.ts` ersetzen**

```ts
// supabase/functions/refresh-cardmarket-prices/index.ts
// Supabase Edge Function: apply Cardmarket's daily `trend` price to every cloud row whose
// cm_product_id the desktop has mirrored, so the phone stays current without the desktop.
// Spec G3 §5: zusaetzlich die lebenden sealed_items (Regel in sealed.ts, RPC apply_cardmarket_sealed_prices).
// Fehlt die Tabelle sealed_items noch, laeuft der Kartendurchgang unveraendert; die Antwort traegt dann sealed.error.
// Deploy:  supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
//   (--no-verify-jwt so pg_cron can call it; optional secret below)
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//   Optional hardening: set CM_TRIGGER_SECRET to require header `x-cm-secret` on every call.
// See supabase/README_cardmarket_cloud.md and docs/superpowers/specs/2026-09-02-cardmarket-cloud-prices-design.md.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { pickTrends } from "./prices.ts";
import { pickSealedUpdates, type SealedRow } from "./sealed.ts";

const GUIDE_URL = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_3.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YuGiOhCardManager/1.0";
const PAGE = 1000; // PostgREST default max rows per request

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CM_TRIGGER_SECRET");
  if (secret && req.headers.get("x-cm-secret") !== secret) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Every distinct Cardmarket product id we must price (skip deleted rows and manual prices).
  const ids = new Set<number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("cards")
      .select("cm_product_id")
      .not("cm_product_id", "is", null)
      .eq("deleted", false)
      .neq("price_locked", 2)
      .order("id", { ascending: true }).order("set_code").order("language").order("rarity")
      .range(from, from + PAGE - 1);
    if (error) return json({ error: `select: ${error.message}` }, 500);
    for (const r of data ?? []) if (r.cm_product_id != null) ids.add(Number(r.cm_product_id));
    if (!data || data.length < PAGE) break;
  }

  // 1b. Spec G3 §5: lebende Sealed-Zeilen, seitenweise ueber eine stabile Ordnung. Nie fatal fuer die Karten.
  const sealedRows: SealedRow[] = [];
  let sealedError: string | null = null;
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("sealed_items")
        .select("sealed_id,cm_product_id,price")
        .eq("deleted", false)
        .order("sealed_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        sealedRows.push({
          sealed_id: String(r.sealed_id),
          cm_product_id: Number(r.cm_product_id),
          price: r.price == null ? null : Number(r.price),
        });
      }
      if (!data || data.length < PAGE) break;
    }
  } catch (e) {
    sealedError = (e as Error).message;
    sealedRows.length = 0;
    console.error("[refresh-cardmarket-prices] sealed skipped:", sealedError);
  }
  const sealedBody = (updated: number) => (sealedError ? { error: sealedError } : { needed: sealedRows.length, updated });

  if (ids.size === 0 && sealedRows.length === 0) {
    return json({ needed: 0, found: 0, updated: 0, sealed: sealedBody(0) });
  }

  // 2. Today's price guide (≈17 MB; parses in well under the 2 s CPU limit).
  let res: Response;
  try { res = await fetch(GUIDE_URL, { headers: { "User-Agent": UA } }); }
  catch (e) { return json({ error: `guide fetch: ${(e as Error).message}` }, 502); }
  if (!res.ok) return json({ error: `guide HTTP ${res.status}` }, 502);
  let guide: unknown;
  try { guide = await res.json(); } catch (e) { return json({ error: `guide parse: ${(e as Error).message}` }, 502); }

  // 3. Cards: one UPDATE for everything; only rows whose price actually changes are touched.
  const prices = pickTrends(guide, ids);
  let updated = 0;
  if (prices.length > 0) {
    const { data, error: rpcErr } = await supabase.rpc("apply_cardmarket_prices", { prices });
    if (rpcErr) return json({ error: `rpc: ${rpcErr.message}` }, 500);
    updated = Number(data ?? 0);
  }

  // 4. Sealed: gleiche Trend-Regel wie der Desktop-Bulk-Schritt C (Zwilling sealed.ts ↔ electron/sealed-prices.cjs).
  let sealedUpdated = 0;
  const updates = pickSealedUpdates(sealedRows, (guide as { priceGuides?: unknown } | null)?.priceGuides);
  if (updates.length > 0) {
    const byProduct = new Map<number, { id_product: number; trend: number }>();
    for (const u of updates) byProduct.set(u.cm_product_id, { id_product: u.cm_product_id, trend: u.price });
    const { data, error } = await supabase.rpc("apply_cardmarket_sealed_prices", { prices: [...byProduct.values()] });
    if (error) {
      sealedError = `rpc: ${error.message}`;
      console.error("[refresh-cardmarket-prices] sealed rpc:", error.message);
    } else {
      sealedUpdated = Number(data ?? 0);
    }
  }

  const body = { needed: ids.size, found: prices.length, updated, sealed: sealedBody(sealedUpdated) };
  console.log("[refresh-cardmarket-prices]", JSON.stringify(body));
  return json(body);
});
```

- [ ] **Step 2: Typprüfung**

Run: `deno check --node-modules-dir=none supabase/functions/refresh-cardmarket-prices/index.ts`
Expected: keine Fehler. Scheitert die Prüfung **nur** an Supabase-Generics (Zeilentyp von `data` bzw. Rückgabetyp von `rpc`), die betroffene Zeile mit einer Typangabe `as { sealed_id: unknown; cm_product_id: unknown; price: unknown }[] | null` bzw. `as unknown` lösen — keine Logikänderung. Andere Fehler beheben.

- [ ] **Step 3: Tests weiter grün**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/refresh-cardmarket-prices/` → PASS (14).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/refresh-cardmarket-prices/index.ts
git commit -m "feat(g3): Cardmarket-Cloud-Lauf aktualisiert auch Sealed-Preise

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: Produktliste — Art-Zuordnung, `sealed_products` im Katalog, Desktop-Suche

**Files:**
- Modify: `desktop/electron/catalog-build.cjs` (Import oben, zwei neue Funktionen vor `packCatalog`, `packCatalog`, `module.exports`)
- Modify: `desktop/electron/catalog-build.test.cjs` (Import Zeile 4, neue Tests am Ende)
- Create: `desktop/electron/sealed-products.cjs`
- Create: `desktop/electron/sealed-products.test.cjs`
- Modify: `desktop/electron/catalog-builder.cjs` (Import, `runCatalogBuild`)
- Modify: `desktop/electron/main.cjs` (die zwei `runCatalogBuild`-Aufrufe)

**Interfaces:**
- Consumes (Task 1): `kindLabel` aus `./sealed-value.cjs`; (Task 2) `trendById` aus `./sealed-prices.cjs`.
- Produces (für Task 6/8): `sealedKindOf(categoryName) → kind`; `buildSealedProducts(nonsingles, priceGuides) → [{ cm_product_id: number, name: string, kind: string, trend: number|null }]`; `packCatalog(cards, version, sealedProducts = [])` schreibt `{ version, built_at, cards, sealed_products }`.
- Produces (für Task 8): `readSealedProducts(userDataPath) → products[] | null` (null = kein oder unlesbarer Cache), `sealedProductsForCatalog(userDataPath) → products[]`, `searchSealedProducts(products, query, limit = 50) → [{ cm_product_id, name, kind, trend, kindLabel }]`.
- Produces (für Task 9): `catalog.json.gz` mit `sealed_products`; `runCatalogBuild(db, { ensureClient, force, userDataPath })` liefert zusätzlich `sealed: <Anzahl>`.

- [ ] **Step 1: Tests für den Katalog-Build erweitern**

In `desktop/electron/catalog-build.test.cjs` Zeile 4 ersetzen:
```js
const { mergeCards, attachVerified, packCatalog, sealedKindOf, buildSealedProducts } = require('./catalog-build.cjs');
```
Am Dateiende anhängen:
```js

// Spec G3 §3 — Art-Zuordnung aus der Cardmarket-Kategorie. Die neun Kategorien stehen so im echten
// products_nonsingles_3.json (Stand 2026-09-09).
test('sealedKindOf ordnet alle neun Kategorien und Unbekanntes zu', () => {
  const cases = [
    ['Yugioh Display', 'display'],
    ['Yugioh Booster', 'booster'],
    ['Yugioh Collector Tins', 'tin'],
    ['Yugioh Structure Deck', 'deck'],
    ['Yugioh Starter Deck', 'deck'],
    ['Yugioh Special Edition', 'special'],
    ['Yugioh Promo Products', 'other'],
    ['Yugioh Lot', 'other'],
    ['Yugioh Event Tickets', 'other'],
    ['Yugioh Playmat', 'other'],
    [undefined, 'other'],
    ['toString', 'other'],
  ];
  for (const [category, kind] of cases) assert.equal(sealedKindOf(category), kind, String(category));
});

test('buildSealedProducts: Name, Art, Trend nur > 0, doppelte und kaputte Produkte übersprungen', () => {
  const nonsingles = [
    { idProduct: 254469, name: 'Metal Raiders Booster Box', idCategory: 42, categoryName: 'Yugioh Display', idExpansion: 1016, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
    { idProduct: 230006, name: 'Force of the Breaker Booster', idCategory: 6, categoryName: 'Yugioh Booster', idExpansion: 1011, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
    { idProduct: 999001, name: 'Beispiel-Turnierticket', idCategory: 1024, categoryName: 'Yugioh Event Tickets', idExpansion: 0, idMetacard: 0, dateAdded: '2020-01-01 00:00:00' },
    { idProduct: 254469, name: 'Metal Raiders Booster Box', idCategory: 42, categoryName: 'Yugioh Display', idExpansion: 1016, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
    { idProduct: 0, name: 'ohne gültige ID', idCategory: 6, categoryName: 'Yugioh Booster' },
    { idProduct: 230007, name: '', idCategory: 6, categoryName: 'Yugioh Booster' },
  ];
  const guide = [
    { idProduct: 254469, idCategory: 42, avg: 6500, low: 465, trend: 499.29 },
    { idProduct: 230006, idCategory: 6, avg: 35, low: 20, trend: 0 },
  ];
  assert.deepEqual(buildSealedProducts(nonsingles, guide), [
    { cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', trend: 499.29 },
    { cm_product_id: 230006, name: 'Force of the Breaker Booster', kind: 'booster', trend: null },
    { cm_product_id: 999001, name: 'Beispiel-Turnierticket', kind: 'other', trend: null },
  ]);
  assert.deepEqual(buildSealedProducts(null, null), []);
});

test('packCatalog schreibt sealed_products, ohne Angabe leer', () => {
  const plain = JSON.parse(zlib.gunzipSync(packCatalog(mergeCards(EN, DE), 12).buffer).toString('utf8'));
  assert.deepEqual(plain.sealed_products, []);
  const products = [{ cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', trend: 499.29 }];
  const withSealed = JSON.parse(zlib.gunzipSync(packCatalog(mergeCards(EN, DE), 13, products).buffer).toString('utf8'));
  assert.deepEqual(withSealed.sealed_products, products);
  assert.equal(withSealed.cards.length, 1);
});
```

- [ ] **Step 2: Tests für die Desktop-Produktliste schreiben**

`desktop/electron/sealed-products.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSealedProducts, sealedProductsForCatalog, searchSealedProducts } = require('./sealed-products.cjs');

// Echte Zeilen aus dem Cardmarket-Cache (products_nonsingles_3.json vom 2026-09-09, price_guide_3.json vom 2026-09-14).
const PRODUCTS = [
  { idProduct: 254470, name: 'Spell Ruler Booster Box', idCategory: 42, categoryName: 'Yugioh Display', idExpansion: 1250, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
  { idProduct: 254469, name: 'Metal Raiders Booster Box', idCategory: 42, categoryName: 'Yugioh Display', idExpansion: 1016, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
  { idProduct: 230006, name: 'Force of the Breaker Booster', idCategory: 6, categoryName: 'Yugioh Booster', idExpansion: 1011, idMetacard: 0, dateAdded: '2007-01-01 00:00:00' },
];
const GUIDES = [
  { idProduct: 254470, idCategory: 42, avg: null, low: 1200, trend: 97.05 },
  { idProduct: 254469, idCategory: 42, avg: 6500, low: 465, trend: 499.29 },
  { idProduct: 230006, idCategory: 6, avg: 35, low: 20, trend: 34.22 },
];

// Jeder Test bekommt ein eigenes userData-Verzeichnis (der Modul-Cache ist nach Verzeichnis geschluesselt).
function userData(withCache) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3-sealed-'));
  if (withCache) {
    fs.mkdirSync(path.join(dir, 'cardmarket'));
    fs.writeFileSync(path.join(dir, 'cardmarket', 'products_nonsingles_3.json'),
      JSON.stringify({ version: 1, createdAt: '2026-09-09T12:40:29+0200', products: PRODUCTS }));
    fs.writeFileSync(path.join(dir, 'cardmarket', 'price_guide_3.json'),
      JSON.stringify({ version: 1, createdAt: '2026-09-14T21:19:43+0200', priceGuides: GUIDES }));
  }
  return dir;
}

test('ohne Cardmarket-Cache: keine Produktliste, der Katalog bekommt []', () => {
  const dir = userData(false);
  assert.equal(readSealedProducts(dir), null);
  assert.deepStrictEqual(sealedProductsForCatalog(dir), []);
  assert.deepStrictEqual(sealedProductsForCatalog(null), []);
});

test('unlesbarer Price-Guide: keine Produktliste', () => {
  const dir = userData(true);
  fs.writeFileSync(path.join(dir, 'cardmarket', 'price_guide_3.json'), '{ kaputt');
  assert.equal(readSealedProducts(dir), null);
  assert.deepStrictEqual(sealedProductsForCatalog(dir), []);
});

test('Produktliste aus dem Cache mit Art und Trend', () => {
  const dir = userData(true);
  const expected = [
    { cm_product_id: 254470, name: 'Spell Ruler Booster Box', kind: 'display', trend: 97.05 },
    { cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', trend: 499.29 },
    { cm_product_id: 230006, name: 'Force of the Breaker Booster', kind: 'booster', trend: 34.22 },
  ];
  assert.deepStrictEqual(readSealedProducts(dir), expected);
  assert.deepStrictEqual(sealedProductsForCatalog(dir), expected);
});

test('Suche: Teilstring ohne Groß-/Kleinschreibung, nach Name sortiert, höchstens limit, mit kindLabel', () => {
  const products = readSealedProducts(userData(true));
  assert.deepStrictEqual(searchSealedProducts(products, 'booster box').map((p) => p.name),
    ['Metal Raiders Booster Box', 'Spell Ruler Booster Box']);
  assert.deepStrictEqual(searchSealedProducts(products, 'BOOSTER', 1).map((p) => p.name), ['Force of the Breaker Booster']);
  assert.deepStrictEqual(searchSealedProducts(products, 'force'), [
    { cm_product_id: 230006, name: 'Force of the Breaker Booster', kind: 'booster', trend: 34.22, kindLabel: 'Booster' },
  ]);
  assert.deepStrictEqual(searchSealedProducts(products, '   '), []);
  assert.deepStrictEqual(searchSealedProducts(products, '100%'), []);
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run: `node --test desktop/electron/catalog-build.test.cjs desktop/electron/sealed-products.test.cjs`
Expected: FAIL — `sealedKindOf is not a function` bzw. `Cannot find module './sealed-products.cjs'`.

- [ ] **Step 4: `catalog-build.cjs` erweitern**

Nach `const zlib = require('node:zlib');`:
```js
const { trendById } = require('./sealed-prices.cjs');
```

Direkt vor `function packCatalog(cards, version) {`:
```js
// Spec G3 §3 — Art eines Sealed-Produkts aus der Cardmarket-Kategorie. EINZIGE Stelle dieser Zuordnung;
// die Werte sind die sechs erlaubten sealed_items.kind (sealed-value.cjs#SEALED_KINDS).
const SEALED_KIND_BY_CATEGORY = {
  'Yugioh Display': 'display',
  'Yugioh Booster': 'booster',
  'Yugioh Collector Tins': 'tin',
  'Yugioh Structure Deck': 'deck',
  'Yugioh Starter Deck': 'deck',
  'Yugioh Special Edition': 'special',
};
function sealedKindOf(categoryName) {
  return categoryName != null && Object.hasOwn(SEALED_KIND_BY_CATEGORY, categoryName)
    ? SEALED_KIND_BY_CATEGORY[categoryName]
    : 'other';
}

// Produktliste fuer Suche und Katalog: jedes Nicht-Einzelkarten-Produkt einmal, mit Art und dem Trend
// zum Bauzeitpunkt (null bei fehlendem oder 0 — gleiche Auswahl wie die Preisregel, sealed-prices.cjs).
function buildSealedProducts(nonsingles, priceGuides) {
  const trends = trendById(priceGuides);
  const seen = new Set();
  const out = [];
  for (const p of nonsingles || []) {
    const id = Number(p && p.idProduct);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id) || !p.name) continue;
    seen.add(id);
    out.push({ cm_product_id: id, name: String(p.name), kind: sealedKindOf(p.categoryName), trend: trends.get(id) ?? null });
  }
  return out;
}

```

`packCatalog` ersetzen:
```js
function packCatalog(cards, version, sealedProducts = []) {
  const json = JSON.stringify({ version, built_at: new Date().toISOString(), cards, sealed_products: sealedProducts });
  const buffer = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
  return { buffer, json, bytes: buffer.length };
}
```

`module.exports` ersetzen:
```js
module.exports = { mergeCards, attachVerified, sealedKindOf, buildSealedProducts, packCatalog };
```

- [ ] **Step 5: `desktop/electron/sealed-products.cjs` schreiben**

```js
// desktop/electron/sealed-products.cjs
// Spec G3 §3/§7.2 — die Cardmarket-Produktliste fuer Sealed am Desktop, gelesen aus dem Cache, den der
// Bulk-Lauf (cardmarket-bulk.cjs) unter <userData>/cardmarket anlegt. Hier wird nichts heruntergeladen:
// fehlt der Cache, gibt es keine Liste (null) und der Katalog bekommt []. Art und Trend: catalog-build.cjs.
const fs = require('fs');
const path = require('path');
const { buildSealedProducts } = require('./catalog-build.cjs');
const { kindLabel } = require('./sealed-value.cjs');

// Der Price-Guide ist ~17 MB: einmal parsen und behalten, bis sich eine der beiden Dateien aendert.
let cache = null;

function readSealedProducts(userDataPath) {
  if (!userDataPath) return null;
  const dir = path.join(userDataPath, 'cardmarket');
  const nonsinglesPath = path.join(dir, 'products_nonsingles_3.json');
  const guidePath = path.join(dir, 'price_guide_3.json');
  let key;
  try { key = `${dir}|${fs.statSync(nonsinglesPath).mtimeMs}|${fs.statSync(guidePath).mtimeMs}`; }
  catch { return null; }
  if (cache && cache.key === key) return cache.products;
  try {
    const nonsingles = JSON.parse(fs.readFileSync(nonsinglesPath, 'utf8')).products;
    const guides = JSON.parse(fs.readFileSync(guidePath, 'utf8')).priceGuides;
    if (!Array.isArray(nonsingles) || !Array.isArray(guides)) return null;
    cache = { key, products: buildSealedProducts(nonsingles, guides) };
    return cache.products;
  } catch (e) {
    console.error('[sealed-products] Cardmarket-Cache nicht lesbar:', e.message);
    return null;
  }
}

// Spec G3 §3: fehlt der Cache beim Katalog-Bau, bleibt sealed_products leer; der Bau scheitert nicht.
const sealedProductsForCatalog = (userDataPath) => readSealedProducts(userDataPath) || [];

const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// Name enthaelt Suchtext (ohne Gross-/Kleinschreibung), sortiert nach Name, hoechstens `limit`.
function searchSealedProducts(products, query, limit = 50) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  return (products || [])
    .filter((p) => p.name.toLowerCase().includes(q))
    .sort((a, b) => cmp(a.name, b.name) || a.cm_product_id - b.cm_product_id)
    .slice(0, limit)
    .map((p) => ({ ...p, kindLabel: kindLabel(p.kind) }));
}

module.exports = { readSealedProducts, sealedProductsForCatalog, searchSealedProducts };
```

- [ ] **Step 6: `catalog-builder.cjs` anpassen**

Nach `const { mergeCards, attachVerified, packCatalog } = require('./catalog-build.cjs');`:
```js
const { sealedProductsForCatalog } = require('./sealed-products.cjs');
```
Zeile `async function runCatalogBuild(db, { ensureClient, force = false } = {}) {` ersetzen durch:
```js
async function runCatalogBuild(db, { ensureClient, force = false, userDataPath = null } = {}) {
```
Zeile `const { buffer, bytes } = packCatalog(cards, version);` ersetzen durch:
```js
    // Spec G3 §3: Sealed-Produktliste aus dem Cardmarket-Cache; ohne Cache [].
    const sealedProducts = sealedProductsForCatalog(userDataPath);
    const { buffer, bytes } = packCatalog(cards, version, sealedProducts);
```
Zeile `return { version, bytes, url, cards: cards.length, verified: verifiedByPasscode.size };` ersetzen durch:
```js
    return { version, bytes, url, cards: cards.length, verified: verifiedByPasscode.size, sealed: sealedProducts.length };
```

- [ ] **Step 7: `main.cjs` — Katalog-Bau bekommt `userDataPath`**

In `startCatalogScheduler` die Zeile
`const res = await runCatalogBuild(db, { ensureClient: sync.ensureClient });`
ersetzen durch:
```js
      const res = await runCatalogBuild(db, { ensureClient: sync.ensureClient, userDataPath });
```
Im Handler `catalog-build-now` die Zeile
`return await runCatalogBuild(db, { ensureClient, force: true });`
ersetzen durch:
```js
    return await runCatalogBuild(db, { ensureClient, force: true, userDataPath });
```

- [ ] **Step 8: Tests laufen lassen**

Run: `node --test desktop/electron/catalog-build.test.cjs desktop/electron/sealed-products.test.cjs` → PASS (12 + 4).
Run: `node --check desktop/electron/catalog-builder.cjs && node --check desktop/electron/main.cjs` → keine Ausgabe.
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → alle grün.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/catalog-build.cjs desktop/electron/catalog-build.test.cjs desktop/electron/sealed-products.cjs desktop/electron/sealed-products.test.cjs desktop/electron/catalog-builder.cjs desktop/electron/main.cjs
git commit -m "feat(g3): Sealed-Produktliste aus dem Cardmarket-Cache in Katalog und Desktop-Suche

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Desktop-SQLite — Schema, Datenhelfer, Bulk-Schritt C

**Files:**
- Create: `desktop/electron/sealed-items.cjs`
- Create: `desktop/electron/sealed-items.test.cjs`
- Modify: `desktop/electron/database.cjs` (Import Zeile 5, Aufruf nach `ensureContainersSchema(db);`)
- Modify: `desktop/electron/cardmarket-bulk.cjs` (Kopfkommentar, Import, `runBulkRefresh`)
- Modify: `desktop/electron/cardmarket-bulk.test.cjs` (`makeDb`, neuer Test)

**Interfaces:**
- Consumes (Task 1): `SEALED_KINDS, sealedValue, lineValue, isPriceStale, kindLabel, sortSealed`; (Task 2) `pickSealedUpdates`.
- Produces (für Task 7/8):
  - `class SealedError extends Error` (deutsche, nutzersichtbare Meldung)
  - `SEALED_COLS = ['sealed_id','cm_product_id','name','kind','quantity','price','price_updated_at','created_at','updated_at','deleted']`
  - `ensureSealedSchema(db)`
  - `listSealed(db, nowMs = Date.now()) → { items: [row + { lineValue, stale, kindLabel }], sealedValue }` (lebend, sortiert)
  - `addSealed(db, product, quantity) → { sealed_id, merged }` (`product = { cm_product_id, name, kind, trend }`)
  - `setSealedQuantity(db, { sealed_id, quantity })`, `openSealed(db, sealedId) → { quantity, deleted }`, `deleteSealed(db, sealedId)`
  - `applySealedPrices(db, priceGuides) → Anzahl geänderter Zeilen`
  - `runBulkRefresh(...)` liefert zusätzlich `sealedPriced`.

- [ ] **Step 1: Tests schreiben**

`desktop/electron/sealed-items.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const S = require('./sealed-items.cjs');

// Produkte wie aus sealed-products.cjs (echte IDs und Trends aus dem Cardmarket-Cache).
const DISPLAY = { cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', trend: 499.29 };
const BOOSTER = { cm_product_id: 230006, name: 'Force of the Breaker Booster', kind: 'booster', trend: 34.22 };
const NO_TREND = { cm_product_id: 254468, name: 'Legend of Blue Eyes White Dragon Booster Box', kind: 'display', trend: null };

function freshDb() {
  const db = new Database(':memory:');
  S.ensureSealedSchema(db);
  return db;
}
const row = (db, id) => db.prepare('SELECT * FROM sealed_items WHERE sealed_id = ?').get(id);
const count = (db) => db.prepare('SELECT COUNT(*) AS n FROM sealed_items').get().n;

test('ensureSealedSchema ist idempotent und legt genau die Spalten an', () => {
  const db = freshDb();
  S.ensureSealedSchema(db);
  assert.deepEqual(db.prepare('PRAGMA table_info(sealed_items)').all().map((c) => c.name), S.SEALED_COLS);
});

test('checks: Art nur die sechs Werte, Menge mindestens 1', () => {
  const db = freshDb();
  const ins = db.prepare('INSERT INTO sealed_items (sealed_id, cm_product_id, name, kind, quantity) VALUES (?, 1, ?, ?, ?)');
  assert.throws(() => ins.run('k1', 'Falsch', 'karton', 1));
  assert.throws(() => ins.run('k2', 'Null', 'display', 0));
  for (const kind of ['display', 'booster', 'tin', 'deck', 'special', 'other']) {
    assert.doesNotThrow(() => ins.run(`ok-${kind}`, kind, kind, 1));
  }
});

test('addSealed legt mit Startpreis an; ohne Trend ohne Preis und ohne Zeitstempel', () => {
  const db = freshDb();
  const a = S.addSealed(db, DISPLAY, 2);
  assert.equal(a.merged, false);
  const r = row(db, a.sealed_id);
  assert.match(r.sealed_id, /^[0-9a-f-]{36}$/);
  assert.equal(r.cm_product_id, 254469);
  assert.equal(r.name, 'Metal Raiders Booster Box');
  assert.equal(r.kind, 'display');
  assert.equal(r.quantity, 2);
  assert.equal(r.price, 499.29);
  assert.ok(r.price_updated_at);
  assert.equal(r.deleted, 0);
  const b = row(db, S.addSealed(db, NO_TREND, 1).sealed_id);
  assert.equal(b.price, null);
  assert.equal(b.price_updated_at, null);
});

test('addSealed desselben lebenden Produkts erhöht die Menge statt einer neuen Zeile', () => {
  const db = freshDb();
  const a = S.addSealed(db, DISPLAY, 2);
  const b = S.addSealed(db, DISPLAY, 3);
  assert.deepEqual(b, { sealed_id: a.sealed_id, merged: true });
  assert.equal(count(db), 1);
  assert.equal(row(db, a.sealed_id).quantity, 5);
});

test('nach Soft-Delete legt addSealed eine neue Zeile an', () => {
  const db = freshDb();
  const a = S.addSealed(db, DISPLAY, 1);
  S.deleteSealed(db, a.sealed_id);
  const b = S.addSealed(db, DISPLAY, 1);
  assert.notEqual(b.sealed_id, a.sealed_id);
  assert.equal(count(db), 2);
});

test('ungültige Menge, fehlendes Produkt und unbekannte Zeile werfen SealedError', () => {
  const db = freshDb();
  assert.throws(() => S.addSealed(db, DISPLAY, 0), S.SealedError);
  assert.throws(() => S.addSealed(db, DISPLAY, 1.5), S.SealedError);
  assert.throws(() => S.addSealed(db, undefined, 1), S.SealedError);
  const a = S.addSealed(db, DISPLAY, 1);
  assert.throws(() => S.setSealedQuantity(db, { sealed_id: a.sealed_id, quantity: 0 }), S.SealedError);
  assert.throws(() => S.setSealedQuantity(db, { sealed_id: 'gibtsnicht', quantity: 2 }), S.SealedError);
  assert.throws(() => S.deleteSealed(db, 'gibtsnicht'), S.SealedError);
  assert.equal(count(db), 1);
  assert.equal(row(db, a.sealed_id).quantity, 1);
});

test('setSealedQuantity setzt die Menge und stempelt updated_at neu', () => {
  const db = freshDb();
  const a = S.addSealed(db, DISPLAY, 1);
  db.prepare("UPDATE sealed_items SET updated_at = '2000-01-01 00:00:00' WHERE sealed_id = ?").run(a.sealed_id);
  S.setSealedQuantity(db, { sealed_id: a.sealed_id, quantity: 4 });
  const r = row(db, a.sealed_id);
  assert.equal(r.quantity, 4);
  assert.notEqual(r.updated_at, '2000-01-01 00:00:00', 'der Push saehe die Aenderung sonst nie');
});

test('openSealed zählt bis 1 herunter und löscht dann nur weich', () => {
  const db = freshDb();
  const a = S.addSealed(db, BOOSTER, 2);
  assert.deepEqual(S.openSealed(db, a.sealed_id), { quantity: 1, deleted: false });
  assert.deepEqual(S.openSealed(db, a.sealed_id), { quantity: 1, deleted: true });
  const r = row(db, a.sealed_id);
  assert.ok(r, 'die Zeile bleibt als Soft-Delete stehen');
  assert.equal(r.deleted, 1);
  assert.equal(r.quantity, 1);
  assert.throws(() => S.openSealed(db, a.sealed_id), S.SealedError);
});

test('deleteSealed löscht weich', () => {
  const db = freshDb();
  const a = S.addSealed(db, BOOSTER, 3);
  S.deleteSealed(db, a.sealed_id);
  assert.equal(row(db, a.sealed_id).deleted, 1);
  assert.equal(count(db), 1);
});

test('listSealed: lebende Zeilen sortiert, mit Zeilensumme, Veraltung, Art und Sealed-Wert', () => {
  const db = freshDb();
  const display = S.addSealed(db, DISPLAY, 1).sealed_id;
  const booster = S.addSealed(db, BOOSTER, 20).sealed_id;
  const noTrend = S.addSealed(db, NO_TREND, 1).sealed_id;
  const gone = S.addSealed(db, { cm_product_id: 999001, name: 'Weg', kind: 'other', trend: 5 }, 1).sealed_id;
  S.deleteSealed(db, gone);
  db.prepare("UPDATE sealed_items SET price_updated_at = '2026-08-01 09:30:00' WHERE sealed_id = ?").run(display);
  const { items, sealedValue } = S.listSealed(db, Date.parse('2026-09-15T12:00:00Z'));
  assert.deepEqual(items.map((i) => i.sealed_id), [booster, display, noTrend]);
  assert.ok(Math.abs(items[0].lineValue - 684.4) < 1e-9);
  assert.equal(items[2].lineValue, null);
  assert.deepEqual(items.map((i) => i.stale), [false, true, false]);
  assert.deepEqual(items.map((i) => i.kindLabel), ['Booster', 'Display', 'Display']);
  assert.ok(Math.abs(sealedValue - (684.4 + 499.29)) < 1e-9);
});

test('applySealedPrices schreibt nur geänderte Trends lebender Zeilen und stempelt price_updated_at', () => {
  const db = freshDb();
  const same = S.addSealed(db, DISPLAY, 1).sealed_id;
  const changed = S.addSealed(db, BOOSTER, 1).sealed_id;
  const empty = S.addSealed(db, NO_TREND, 1).sealed_id;
  const gone = S.addSealed(db, { cm_product_id: 230007, name: 'Dark Revelation 2 Booster', kind: 'booster', trend: 40 }, 1).sealed_id;
  S.deleteSealed(db, gone);
  db.prepare("UPDATE sealed_items SET price_updated_at = '2000-01-01 00:00:00'").run();
  const n = S.applySealedPrices(db, [
    { idProduct: 254469, trend: 499.29 },
    { idProduct: 230006, trend: 36.5 },
    { idProduct: 254468, trend: 0.02 },
    { idProduct: 230007, trend: 46.11 },
  ]);
  assert.equal(n, 2);
  assert.equal(row(db, same).price_updated_at, '2000-01-01 00:00:00');
  assert.equal(row(db, changed).price, 36.5);
  assert.notEqual(row(db, changed).price_updated_at, '2000-01-01 00:00:00');
  assert.equal(row(db, empty).price, 0.02);
  assert.equal(row(db, gone).price, 40, 'geloeschte Zeilen bekommen keinen Preis');
});
```

In `desktop/electron/cardmarket-bulk.test.cjs` nach `const { ensureCopiesSchema } = require('./copies-schema.cjs');`:
```js
const { ensureSealedSchema, addSealed } = require('./sealed-items.cjs');
```
In `makeDb()` nach `ensureCopiesSchema(db); // recordPrice (wired into applyPrices) needs price_history`:
```js
  ensureSealedSchema(db); // Spec G3 Schritt C liest sealed_items
```
Am Dateiende:
```js

test('Schritt C: runBulkRefresh setzt Sealed-Preise aus demselben Price-Guide, nur bei Aenderung', async () => {
  const db = makeDb();
  // cm_product_id 741145 steht im Test-Guide oben mit trend 12.5.
  addSealed(db, { cm_product_id: 741145, name: 'Testdisplay', kind: 'display', trend: 10 }, 2);
  const res = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(res.sealedPriced, 1);
  assert.equal(db.prepare('SELECT price FROM sealed_items').get().price, 12.5);
  const res2 = await runBulkRefresh(db, { userDataPath: null, files });
  assert.equal(res2.sealedPriced, 0);
  const failed = await runBulkRefresh(db, { userDataPath: null, files: { error: new Error('boom') } });
  assert.equal(failed.sealedPriced, 0);
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/sealed-items.test.cjs electron/cardmarket-bulk.test.cjs`
Expected: FAIL — `Cannot find module './sealed-items.cjs'`.

- [ ] **Step 3: `desktop/electron/sealed-items.cjs` schreiben**

```js
// desktop/electron/sealed-items.cjs
// Spec G3 §4.1 — Sealed-Bestand lokal (SQLite). Gegenstueck zu supabase/sealed_items_schema.sql.
// Menge >= 1, darunter nur Soft-Delete (deleted = 1). Ein zweites Anlegen desselben lebenden Produkts
// erhoeht die Menge der vorhandenen Zeile. Wert, Veraltung, Art und Reihenfolge: sealed-value.cjs (Zwilling),
// Trend-Regel: sealed-prices.cjs (Zwilling). Der Sync (sync.cjs) schiebt die Aenderungen in die Cloud.
const crypto = require('crypto');
const { SEALED_KINDS, sealedValue, lineValue, isPriceStale, kindLabel, sortSealed } = require('./sealed-value.cjs');
const { pickSealedUpdates } = require('./sealed-prices.cjs');

// Erwartete, nutzersichtbare Fehler (deutsch). main.cjs reicht sie unveraendert durch, alles andere nicht.
class SealedError extends Error {}

const SEALED_COLS = ['sealed_id', 'cm_product_id', 'name', 'kind', 'quantity', 'price', 'price_updated_at', 'created_at', 'updated_at', 'deleted'];

function ensureSealedSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sealed_items (
      sealed_id        TEXT PRIMARY KEY,
      cm_product_id    INTEGER NOT NULL,
      name             TEXT NOT NULL,
      kind             TEXT NOT NULL CHECK (kind IN (${SEALED_KINDS.map((k) => `'${k}'`).join(',')})),
      quantity         INTEGER NOT NULL CHECK (quantity >= 1),
      price            REAL,
      price_updated_at DATETIME,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted          INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS sealed_items_updated_idx ON sealed_items (updated_at);
    CREATE INDEX IF NOT EXISTS sealed_items_product_idx ON sealed_items (cm_product_id, deleted);
  `);
  // Wie trg_containers_updated (containers-schema.cjs): stempelt updated_at bei jedem UPDATE, das es nicht
  // selbst setzt -- sonst saehe der Push (updated_at > cursor) die Aenderung nie.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_sealed_updated AFTER UPDATE ON sealed_items FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE sealed_items SET updated_at = CURRENT_TIMESTAMP WHERE sealed_id = NEW.sealed_id; END;
  `);
}

const liveRow = (db, sealedId) =>
  db.prepare('SELECT * FROM sealed_items WHERE sealed_id = ? AND deleted = 0').get(String(sealedId));

function requireQuantity(quantity) {
  const q = Number(quantity);
  if (!Number.isInteger(q) || q < 1) throw new SealedError('Die Menge muss mindestens 1 sein.');
  return q;
}

// Lebende Zeilen fuer die Liste, schon sortiert, mit Zeilensumme, Veraltung und Art-Bezeichnung.
function listSealed(db, nowMs = Date.now()) {
  const rows = db.prepare('SELECT * FROM sealed_items WHERE deleted = 0').all();
  const items = sortSealed(rows).map((r) => ({
    ...r,
    lineValue: lineValue(r),
    stale: r.price != null && isPriceStale(r.price_updated_at, nowMs),
    kindLabel: kindLabel(r.kind),
  }));
  return { items, sealedValue: sealedValue(rows) };
}

// product: { cm_product_id, name, kind, trend } aus der Produktliste (sealed-products.cjs).
// Gibt es das Produkt schon lebend, waechst die aelteste lebende Zeile; sonst neue Zeile mit Startpreis.
function addSealed(db, product, quantity) {
  const q = requireQuantity(quantity);
  if (!product) throw new SealedError('Produkt nicht in der Produktliste gefunden.');
  return db.transaction(() => {
    const live = db.prepare(`SELECT sealed_id FROM sealed_items WHERE cm_product_id = ? AND deleted = 0
      ORDER BY created_at, sealed_id LIMIT 1`).get(product.cm_product_id);
    if (live) {
      db.prepare('UPDATE sealed_items SET quantity = quantity + ? WHERE sealed_id = ?').run(q, live.sealed_id);
      return { sealed_id: live.sealed_id, merged: true };
    }
    const sealedId = crypto.randomUUID();
    const price = product.trend ?? null;
    db.prepare(`INSERT INTO sealed_items (sealed_id, cm_product_id, name, kind, quantity, price, price_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)`)
      .run(sealedId, product.cm_product_id, product.name, product.kind, q, price, price);
    return { sealed_id: sealedId, merged: false };
  })();
}

function setSealedQuantity(db, { sealed_id, quantity } = {}) {
  const q = requireQuantity(quantity);
  if (!liveRow(db, sealed_id)) throw new SealedError('Dieser Eintrag existiert nicht mehr.');
  db.prepare('UPDATE sealed_items SET quantity = ? WHERE sealed_id = ? AND quantity IS NOT ?').run(q, String(sealed_id), q);
}

// "Geoeffnet": Menge - 1; bei Menge 1 weich loeschen (die Oberflaeche fragt vorher, Spec G3 §4.1).
function openSealed(db, sealedId) {
  const row = liveRow(db, sealedId);
  if (!row) throw new SealedError('Dieser Eintrag existiert nicht mehr.');
  if (row.quantity > 1) {
    db.prepare('UPDATE sealed_items SET quantity = quantity - 1 WHERE sealed_id = ?').run(row.sealed_id);
    return { quantity: row.quantity - 1, deleted: false };
  }
  db.prepare('UPDATE sealed_items SET deleted = 1 WHERE sealed_id = ?').run(row.sealed_id);
  return { quantity: row.quantity, deleted: true };
}

function deleteSealed(db, sealedId) {
  if (!liveRow(db, sealedId)) throw new SealedError('Dieser Eintrag existiert nicht mehr.');
  db.prepare('UPDATE sealed_items SET deleted = 1 WHERE sealed_id = ?').run(String(sealedId));
}

// Bulk-Schritt C (Spec G3 §5): Trend auf alle lebenden Zeilen, nur Aenderungen schreiben.
// Der Trigger stempelt updated_at, damit der Sync die neuen Preise in die Cloud schiebt.
function applySealedPrices(db, priceGuides) {
  const rows = db.prepare('SELECT sealed_id, cm_product_id, price FROM sealed_items WHERE deleted = 0').all();
  const updates = pickSealedUpdates(rows, priceGuides);
  const upd = db.prepare('UPDATE sealed_items SET price = ?, price_updated_at = CURRENT_TIMESTAMP WHERE sealed_id = ?');
  db.transaction(() => { for (const u of updates) upd.run(u.price, u.sealed_id); })();
  return updates.length;
}

module.exports = {
  SealedError, SEALED_COLS, ensureSealedSchema, listSealed, addSealed, setSealedQuantity, openSealed, deleteSealed,
  applySealedPrices,
};
```

- [ ] **Step 4: `database.cjs` registrieren**

Nach `const { ensureContainersSchema } = require('./containers-schema.cjs');`:
```js
const { ensureSealedSchema } = require('./sealed-items.cjs');
```
Nach der Zeile `ensureContainersSchema(db);` in `runMigrations()`:
```js
        ensureSealedSchema(db);   // Spec G3: Sealed-Bestand
```

- [ ] **Step 5: `cardmarket-bulk.cjs` — Schritt C**

Kopfkommentar: nach der Zeile `// resolved printing in one transaction (Step B). Ambiguous printings stay NULL for the scraper.` einfügen:
```js
// Step C (Spec G3 §5) applies the same guide's trend to every live sealed_items row (sealed-items.cjs).
```
Nach `const { recordPrice } = require('./price-history.cjs');`:
```js
const { applySealedPrices } = require('./sealed-items.cjs');
```
In `runBulkRefresh` die Fehler-Rückgabe
`return { error: 'download', message: e.message, resolved: 0, priced: 0, skipped: 0, unchanged: 0, unresolved: countUnresolved(db), reasons: {} };`
ersetzen durch:
```js
    return { error: 'download', message: e.message, resolved: 0, priced: 0, skipped: 0, unchanged: 0, sealedPriced: 0, unresolved: countUnresolved(db), reasons: {} };
```
Die Zeilen
```js
  const b = applyPrices(db, data.guide);
```
und
```js
  const out = { resolved: a.resolved, reasons: a.reasons, priced: b.priced, skipped: b.skipped, unchanged: b.unchanged, unresolved: countUnresolved(db) };
```
ersetzen durch:
```js
  const b = applyPrices(db, data.guide);
  const sealedPriced = applySealedPrices(db, data.guide); // Step C
```
bzw.
```js
  const out = { resolved: a.resolved, reasons: a.reasons, priced: b.priced, skipped: b.skipped, unchanged: b.unchanged, sealedPriced, unresolved: countUnresolved(db) };
```

- [ ] **Step 6: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
Expected: alle grün, darunter `sealed-items.test.cjs` (11) und `cardmarket-bulk.test.cjs` (8).

- [ ] **Step 7: Schutz-Nachweis**

In `addSealed` den Zweig `if (live) { … }` kurz durch `if (false && live) { … }` ersetzen → „addSealed desselben lebenden Produkts erhöht die Menge" scheitert. In `applySealedPrices` `WHERE deleted = 0` entfernen → „applySealedPrices … geloeschte Zeilen bekommen keinen Preis" scheitert. Fehlschläge zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/sealed-items.cjs desktop/electron/sealed-items.test.cjs desktop/electron/database.cjs desktop/electron/cardmarket-bulk.cjs desktop/electron/cardmarket-bulk.test.cjs
git commit -m "feat(g3): Sealed-Bestand in SQLite mit Anlegen, Menge, Geoeffnet und Bulk-Schritt C

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Desktop — Sync-Strom `sealed_items` und Gesamtwert mit Sealed

**Files:**
- Modify: `desktop/electron/portfolio-value.cjs` (ganze Datei)
- Modify: `desktop/electron/portfolio-value.test.cjs` (Import, `db()`, neue Tests)
- Modify: `desktop/electron/sync.cjs` (Imports Zeile 2–5, Abbildung nach `applyRemoteContainer`, Echo-Karte, Strom-Funktionen, `syncSnapshot`, `cycle()`, `module.exports`)
- Create: `desktop/electron/sealed-sync.test.cjs`

**Interfaces:**
- Consumes (Task 1): `sealedValue`, `toUtcMillis`; (Task 6) `SEALED_COLS`, `ensureSealedSchema`, `addSealed`.
- Produces (für Task 8): `portfolioTotals(db) → { cards, sealed, total, sealedCount }` (Summen auf Cent gerundet); `recordPortfolioValue(db)` schreibt `total_value = cards + sealed` und `sealed_value`.
- Produces: Renderer-Ereignis `sealed-changed` nach gezogenen Sealed-Änderungen; Settings `sync_sealed_last_pull`, `sync_sealed_last_push`; Tageswert `portfolio_snapshots` mit `sealed_value`.
- Produces (Tests): `sealedToRemote`, `remoteToLocalSealed`, `applyRemoteSealed`, `_recentlyPushedSealed`, `_applyPulledSealed`, `_sealedPushRows`.

- [ ] **Step 1: Tests schreiben**

`desktop/electron/portfolio-value.test.cjs` — Import-Zeilen 4–5 ersetzen durch:
```js
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureSealedSchema, addSealed } = require('./sealed-items.cjs');
const { recordPortfolioValue, portfolioTotals } = require('./portfolio-value.cjs');
```
In `db()` nach `ensureCopiesSchema(d);`:
```js
  ensureSealedSchema(d);
```
Am Dateiende:
```js

test('ohne Sealed: Gesamtwert = Kartenwert, sealed_value 0', () => {
  const d = db();
  assert.deepEqual(portfolioTotals(d), { cards: 10, sealed: 0, total: 10, sealedCount: 0 });
  recordPortfolioValue(d);
  assert.deepEqual({ ...d.prepare('SELECT total_value, sealed_value FROM portfolio_history').get() }, { total_value: 10, sealed_value: 0 });
});

test('Spec G3 §4.2: Sealed zählt zum Gesamtwert und steht in sealed_value', () => {
  const d = db();
  addSealed(d, { cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', trend: 499.29 }, 2);
  addSealed(d, { cm_product_id: 254468, name: 'Legend of Blue Eyes White Dragon Booster Box', kind: 'display', trend: null }, 1);
  assert.deepEqual(portfolioTotals(d), { cards: 10, sealed: 998.58, total: 1008.58, sealedCount: 2 });
  assert.equal(recordPortfolioValue(d), true);
  assert.deepEqual({ ...d.prepare('SELECT total_value, sealed_value FROM portfolio_history').get() }, { total_value: 1008.58, sealed_value: 998.58 });
});
```

`desktop/electron/sealed-sync.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { sealedToRemote, remoteToLocalSealed, _recentlyPushedSealed, _applyPulledSealed, _sealedPushRows } = require('./sync.cjs');
const { ensureSealedSchema } = require('./sealed-items.cjs');

// Spec G3 §7.1 — Sealed-Bestand als vierter Sync-Strom. startSync() selbst laeuft hier nicht (echte
// Zeitgeber, Supabase); getestet werden die Abbildung, das Anwenden gezogener Seiten mit Echo-Sperre und
// die Auswahl der zu schiebenden Zeilen -- genau die Stuecke, die pullSealed/pushSealed benutzen.

function freshDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);');
  ensureSealedSchema(db);
  return db;
}
const REMOTE = {
  sealed_id: 's1', cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', quantity: 2,
  price: 499.29, price_updated_at: '2026-09-15T05:00:03.123456+00:00',
  created_at: '2026-09-14T18:00:00.5+00:00', updated_at: '2026-09-15T05:00:04.654321+00:00', deleted: false,
};
const row = (db, id) => db.prepare('SELECT * FROM sealed_items WHERE sealed_id = ?').get(id);

test('sealedToRemote: Boolean, keine eigenen Zeitstempel, price_updated_at als UTC-ISO', () => {
  const local = {
    sealed_id: 's1', cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', quantity: 2,
    price: 499.29, price_updated_at: '2026-09-15 05:00:03', created_at: '2026-09-01 10:00:00', updated_at: '2026-09-15 05:00:03', deleted: 0,
  };
  assert.deepEqual(sealedToRemote(local), {
    sealed_id: 's1', cm_product_id: 254469, name: 'Metal Raiders Booster Box', kind: 'display', quantity: 2,
    price: 499.29, price_updated_at: '2026-09-15T05:00:03.000Z', deleted: false,
  });
  const gone = sealedToRemote({ ...local, price: null, price_updated_at: null, deleted: 1 });
  assert.equal(gone.deleted, true);
  assert.equal(gone.price, null);
  assert.equal(gone.price_updated_at, null);
});

test('remoteToLocalSealed: Cloud-Zeitstempel in lokaler Form, deleted als 0/1', () => {
  const l = remoteToLocalSealed({ ...REMOTE, deleted: true });
  assert.equal(l.price_updated_at, '2026-09-15 05:00:03');
  assert.equal(l.deleted, 1);
  assert.ok(!('updated_at' in l) && !('created_at' in l), 'Cloud-Zeitstempel landen nie in den lokalen Spalten');
});

test('Pull legt eine am Handy angelegte Zeile an, lokale Zeitstempel ohne T', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  assert.equal(_applyPulledSealed(db, [REMOTE]), 1);
  const r = row(db, 's1');
  assert.equal(r.quantity, 2);
  assert.equal(r.price, 499.29);
  assert.equal(r.price_updated_at, '2026-09-15 05:00:03');
  assert.ok(!String(r.updated_at).includes('T') && !String(r.created_at).includes('T'));
});

test('Echo-Sperre: die eigene gepushte Zeile wird nicht erneut angewandt', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  _recentlyPushedSealed.set('s1', REMOTE.updated_at);
  assert.equal(_applyPulledSealed(db, [REMOTE]), 0);
  assert.equal(row(db, 's1'), undefined);
  assert.equal(_recentlyPushedSealed.has('s1'), false, 'Echo-Eintrag muss verbraucht sein');
});

test('fremde Aenderung wird angewandt, auch wenn die Zeile zuvor gepusht wurde', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  _applyPulledSealed(db, [REMOTE]);
  _recentlyPushedSealed.set('s1', REMOTE.updated_at);
  assert.equal(_applyPulledSealed(db, [{ ...REMOTE, quantity: 3, updated_at: '2026-09-15T06:00:00+00:00' }]), 1);
  assert.equal(row(db, 's1').quantity, 3);
});

test('Soft-Delete kommt als deleted = 1 an, die Zeile bleibt', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  _applyPulledSealed(db, [REMOTE]);
  _applyPulledSealed(db, [{ ...REMOTE, deleted: true, updated_at: '2026-09-15T07:00:00+00:00' }]);
  assert.equal(row(db, 's1').deleted, 1);
});

test('unveraenderte gezogene Zeile stempelt updated_at nicht neu', () => {
  const db = freshDb();
  _recentlyPushedSealed.clear();
  _applyPulledSealed(db, [REMOTE]);
  db.prepare("UPDATE sealed_items SET updated_at = '2000-01-01 00:00:00' WHERE sealed_id = 's1'").run();
  _applyPulledSealed(db, [{ ...REMOTE, updated_at: '2026-09-15T08:00:00+00:00' }]);
  assert.equal(row(db, 's1').updated_at, '2000-01-01 00:00:00', 'sonst schoebe der naechste Push die Zeile grundlos zurueck');
});

test('Push-Auswahl: nach dem Cursor, ohne die laufende Sekunde, mit Soft-Deletes', () => {
  const db = freshDb();
  const ins = db.prepare(`INSERT INTO sealed_items (sealed_id, cm_product_id, name, kind, quantity, deleted, updated_at)
    VALUES (?, 254469, 'Metal Raiders Booster Box', 'display', 1, ?, ?)`);
  ins.run('s-alt', 0, '2026-09-13 00:00:00');
  ins.run('s-neu', 0, '2026-09-15 05:00:00');
  ins.run('s-weg', 1, '2026-09-15 06:00:00');
  ins.run('s-jetzt', 0, '2999-01-01 00:00:00');
  const rows = _sealedPushRows(db, '2026-09-14 00:00:00');
  assert.deepEqual(rows.map((r) => r.sealed_id).sort(), ['s-neu', 's-weg']);
  assert.equal(sealedToRemote(rows.find((r) => r.sealed_id === 's-weg')).deleted, true);
});

// Quelltext-Zaun wie in test-sync.cjs: prueft die Reihenfolge der Aufrufe in cycle(), keine Semantik.
test('Zyklus: Sealed nach den Exemplaren gezogen und geschoben, vor Preishistorie, Tageswert und Alarmen', () => {
  const src = fs.readFileSync(path.join(__dirname, 'sync.cjs'), 'utf8');
  const start = src.indexOf('async function cycle(');
  const end = src.indexOf('setInterval(cycle', start);
  assert.ok(start >= 0 && end > start, 'cycle() muss gefunden werden');
  const body = src.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const at = (s) => { const i = body.indexOf(s); assert.ok(i >= 0, `fehlt in cycle(): ${s}`); return i; };
  assert.ok(at('pullCopies(c)') < at('pullSealedSafe(c)'));
  assert.ok(at('pullSealedSafe(c)') < at('await push(c)'));
  assert.ok(at('pushCopies(c)') < at('pushSealedSafe(c)'));
  assert.ok(at('pushSealedSafe(c)') < at('pullPriceHistory(c)'));
  assert.ok(at('syncSnapshot(c)') < at('syncPriceAlerts(c)'));
  assert.ok(body.includes("'sealed-changed'"), 'nach gezogenen Sealed-Aenderungen muss sealed-changed gesendet werden');
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/portfolio-value.test.cjs electron/sealed-sync.test.cjs`
Expected: FAIL — `portfolioTotals is not a function`, `sealedToRemote is not a function` bzw. `fehlt in cycle(): pullSealedSafe(c)`.

- [ ] **Step 3: `portfolio-value.cjs` ersetzen**

```js
// Spec G1 §4.4 — eine Zeile in portfolio_history nach JEDEM Preisschreiber (YGOPRODeck-Poller,
// "Alle aktualisieren", Cardmarket-Bulk, Scraper, manueller Preis), sobald sich der Gesamtwert
// gegenueber der letzten Zeile um mehr als 0,50 EUR bewegt hat.
// Spec G3 §4.2/§6: Gesamtwert = Karten + Sealed. portfolioTotals ist die einzige Stelle dafuer am Desktop
// (get-portfolio, recordPortfolioValue, syncSnapshot); gespeichert wird auf Cent gerundet wie totalValue.
const { totalValue } = require('./valuation.cjs');
const { sealedValue } = require('./sealed-value.cjs');

const THRESHOLD_EUR = 0.5;
const cents = (x) => Math.round(x * 100) / 100;

function portfolioTotals(db) {
  const cards = totalValue(db);
  const rows = db.prepare('SELECT quantity, price, deleted FROM sealed_items WHERE deleted = 0').all();
  const sealed = cents(sealedValue(rows));
  return { cards, sealed, total: cents(cards + sealed), sealedCount: rows.length };
}

function recordPortfolioValue(db) {
  const { total, sealed } = portfolioTotals(db);
  const last = db.prepare('SELECT total_value FROM portfolio_history ORDER BY id DESC LIMIT 1').get();
  if (last && Math.abs((last.total_value || 0) - total) <= THRESHOLD_EUR) return false;
  db.prepare('INSERT INTO portfolio_history (total_value, sealed_value) VALUES (?, ?)').run(total, sealed);
  return true;
}

module.exports = { portfolioTotals, recordPortfolioValue };
```

- [ ] **Step 4: `sync.cjs` — Imports**

Zeile `const { totalValue, copyCount } = require('./valuation.cjs');` ersetzen durch:
```js
const { copyCount } = require('./valuation.cjs');
const { portfolioTotals } = require('./portfolio-value.cjs');
const { SEALED_COLS } = require('./sealed-items.cjs');
const { toUtcMillis } = require('./sealed-value.cjs');
```

- [ ] **Step 5: `sync.cjs` — Abbildung**

Direkt vor `function getSetting(db, key) {`:
```js
// Spec G3 §7.1 — Sealed-Bestand als vierter Strom, gebaut wie die Behaelter. created_at/updated_at wandern
// aus denselben Gruenden wie bei CONTAINER_PUSH_COLS/CONTAINER_LOCAL_COLS in keine Richtung mit.
// price_updated_at MUSS mit, wird aber umgeformt: lokal sekundengenau ohne Zone ('2026-09-15 05:00:03'),
// in der Cloud timestamptz. So bleibt jeder lokale Vergleich ein Vergleich gleicher Formen.
const SEALED_SYNC_COLS = SEALED_COLS.filter(c => c !== 'updated_at' && c !== 'created_at');
function tsLocalToCloud(s) {
  const ms = toUtcMillis(s);
  return ms == null ? null : new Date(ms).toISOString();
}
function tsCloudToLocal(s) {
  const ms = toUtcMillis(s);
  return ms == null ? null : new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}
function sealedToRemote(row) {
  const out = {};
  for (const c of SEALED_SYNC_COLS) out[c] = row[c] ?? null;
  out.deleted = !!row.deleted;
  out.price_updated_at = tsLocalToCloud(row.price_updated_at);
  return out;
}
function remoteToLocalSealed(r) {
  const out = {};
  for (const c of SEALED_SYNC_COLS) out[c] = r[c] ?? null;
  out.sealed_id = String(r.sealed_id);
  out.cm_product_id = Number(r.cm_product_id);
  out.quantity = Number(r.quantity);
  out.price = r.price == null ? null : Number(r.price);
  out.price_updated_at = tsCloudToLocal(r.price_updated_at);
  out.deleted = r.deleted ? 1 : 0;
  return out;
}
// Nur schreiben, wenn sich etwas unterscheidet -- sonst stempelte trg_sealed_updated die Zeile neu und der
// naechste Push schoebe sie grundlos zurueck.
function applyRemoteSealed(db, r) {
  const l = remoteToLocalSealed(r);
  const cur = db.prepare('SELECT * FROM sealed_items WHERE sealed_id = ?').get(l.sealed_id);
  if (!cur) {
    db.prepare(`INSERT INTO sealed_items (${SEALED_SYNC_COLS.join(',')})
                VALUES (${SEALED_SYNC_COLS.map(c => '@' + c).join(',')})`).run(l);
    return;
  }
  const changed = SEALED_SYNC_COLS.some(c => c !== 'sealed_id' && (cur[c] ?? null) !== (l[c] ?? null));
  if (!changed) return;
  const sets = SEALED_SYNC_COLS.filter(c => c !== 'sealed_id').map(c => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE sealed_items SET ${sets} WHERE sealed_id = @sealed_id`).run(l);
}

```

- [ ] **Step 6: `sync.cjs` — Echo-Karte und Seitenanwendung**

Nach `const recentlyPushedContainers = new Map();`:
```js
const recentlyPushedSealed = new Map();
```
Direkt vor `function startSync(db, getWindow, { onPriceAlerts } = {}) {`:
```js
// Spec G3 §7.1: eine gezogene Seite Sealed-Zeilen anwenden, das Echo des eigenen Pushs ueberspringen.
function applyPulledSealed(db, rows) {
  let applied = 0;
  for (const r of rows) {
    if (recentlyPushedSealed.get(r.sealed_id) === r.updated_at) {
      recentlyPushedSealed.delete(r.sealed_id);
      continue;
    }
    applyRemoteSealed(db, r);
    applied++;
  }
  return applied;
}

// Lokale Sealed-Zeilen seit dem Push-Cursor, ohne die der laufenden Sekunde (Begruendung in push()).
function sealedPushRows(db, cursor) {
  return db.prepare("SELECT * FROM sealed_items WHERE updated_at > ? AND updated_at < strftime('%Y-%m-%d %H:%M:%S','now')").all(cursor);
}

```

- [ ] **Step 7: `sync.cjs` — Strom-Funktionen in `startSync`**

Direkt vor dem Kommentar `// Spec G1 §4.12 — the daily cloud Edge Function writes source='cloud' rows the desktop would`:
```js
  async function pullSealed(c) {
    const cursor = getSetting(db, 'sync_sealed_last_pull') || '1970-01-01T00:00:00Z';
    const PAGE = 1000; let applied = 0; let lastTs = null;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from('sealed_items').select('*')
        .gt('updated_at', cursor).order('updated_at', { ascending: true }).order('sealed_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error('Pull sealed failed: ' + error.message);
      if (!data || data.length === 0) break;
      db.transaction(() => { applied += applyPulledSealed(db, data); })();
      lastTs = data[data.length - 1].updated_at;
      if (data.length < PAGE) break;
    }
    if (lastTs) setSetting(db, 'sync_sealed_last_pull', lastTs);
    return applied;
  }

  async function pushSealed(c) {
    const cursor = getSetting(db, 'sync_sealed_last_push') || '1970-01-01T00:00:00Z';
    const changed = sealedPushRows(db, cursor);
    if (changed.length === 0) return;
    for (let i = 0; i < changed.length; i += 500) {
      const { data, error } = await c.from('sealed_items')
        .upsert(changed.slice(i, i + 500).map(sealedToRemote), { onConflict: 'sealed_id' }).select('sealed_id,updated_at');
      if (error) throw new Error('Push sealed failed: ' + error.message);
      for (const r of (data || [])) recentlyPushedSealed.set(r.sealed_id, r.updated_at);
    }
    setSetting(db, 'sync_sealed_last_push', changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor));
  }

  // Spec G3 §7.1: fehlt die Cloud-Tabelle sealed_items noch (SQL nicht eingespielt) oder scheitert der
  // Strom sonst, laufen Preishistorie, Tageswert und Preis-Alarme trotzdem. Die Cursor bleiben dann stehen.
  async function pullSealedSafe(c) {
    try { return await pullSealed(c); }
    catch (e) { console.error('[sync] sealed pull:', e.message); return 0; }
  }
  async function pushSealedSafe(c) {
    try { await pushSealed(c); }
    catch (e) { console.error('[sync] sealed push:', e.message); }
  }

```

- [ ] **Step 8: `sync.cjs` — Tageswert**

`syncSnapshot` ersetzen:
```js
  // Additive: record today's collection value to Supabase so the phone's value chart fills
  // even when only the desktop runs. One row per user per day (merge-duplicates). Non-fatal.
  // Spec G3 §4.2: total_value = Karten + Sealed, sealed_value = Sealed-Anteil.
  async function syncSnapshot(c) {
    try {
      const t = portfolioTotals(db);
      await c.from('portfolio_snapshots')
        .upsert({ total_value: t.total, sealed_value: t.sealed, card_count: copyCount(db) }, { onConflict: 'user_id,day' });
    } catch (e) {
      // table may not be created yet, or a transient error — never break the sync cycle
    }
  }
```

- [ ] **Step 9: `sync.cjs` — `cycle()`**

Den Block von `const pulledContainers = await pullContainers(c);` bis einschließlich der Zeile `emit('idle', totalPulled > 0 ? …);` ersetzen durch:
```js
      const pulledContainers = await pullContainers(c);
      const pulledCopies = await pullCopies(c);
      // Spec G3 §7.1: Sealed als vierter Strom nach den Exemplaren, in beide Richtungen; nie fatal.
      const pulledSealed = await pullSealedSafe(c);
      await push(c);
      await pushContainers(c);
      await pushCopies(c);
      await pushSealedSafe(c);
      await pullPriceHistory(c);
      await pushPriceHistory(c);
      await syncSnapshot(c);
      await syncPriceAlerts(c);
      const pulledCollection = pulled + pulledContainers + pulledCopies;
      if (pulledCollection > 0) { const w = getWindow(); if (w) w.webContents.send('collection-changed'); }
      if (pulledSealed > 0) { const w = getWindow(); if (w) w.webContents.send('sealed-changed'); }
      const totalPulled = pulledCollection + pulledSealed;
      emit('idle', totalPulled > 0 ? `pulled ${totalPulled}` : 'up to date');
```
(Der Kommentar über `pullContainers` zur Reihenfolge Behälter vor Exemplaren bleibt unverändert davor stehen.)

- [ ] **Step 10: `sync.cjs` — Exporte**

In `module.exports` nach `containerToRemote, remoteToLocalContainer, applyRemoteContainer,`:
```js
  sealedToRemote, remoteToLocalSealed, applyRemoteSealed,
```
und nach `_applyPulledContainers: applyPulledContainers,`:
```js
  // Test-only hooks for the sealed stream (sealed-sync.test.cjs), same reasoning as the containers hooks.
  _recentlyPushedSealed: recentlyPushedSealed,
  _applyPulledSealed: applyPulledSealed,
  _sealedPushRows: sealedPushRows,
```

- [ ] **Step 11: Prüfen**

1. `node --check desktop/electron/sync.cjs && node --check desktop/electron/portfolio-value.cjs` → keine Ausgabe.
2. Per Grep: `totalValue` kommt in `sync.cjs` nicht mehr vor.
3. In `desktop/`: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → alle grün (neu: `sealed-sync.test.cjs` 9, `portfolio-value.test.cjs` 4).
4. In `desktop/`: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` → alle `PASS`-Zeilen, kein Fehler.

- [ ] **Step 12: Schutz-Nachweis**

(a) In `applyPulledSealed` die `if (recentlyPushedSealed…) { … continue; }`-Sperre kurz entfernen → „Echo-Sperre" scheitert. (b) In `applyRemoteSealed` die Zeile `if (!changed) return;` entfernen → „unveraenderte gezogene Zeile stempelt updated_at nicht neu" scheitert. Fehlschläge zitieren, zurücknehmen.

- [ ] **Step 13: Commit**

```bash
git add desktop/electron/portfolio-value.cjs desktop/electron/portfolio-value.test.cjs desktop/electron/sync.cjs desktop/electron/sealed-sync.test.cjs
git commit -m "feat(g3): Sealed als vierter Sync-Strom, Gesamt- und Tageswert mit Sealed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: Desktop — IPC, Sammlung › Sealed, Hinzufügen-Dialog, Start-Unterzeile

**Files:**
- Modify: `desktop/electron/main.cjs` (Imports Zeilen 16 und 20, `get-portfolio`, neuer Sealed-Block direkt danach, `notifyBulk`)
- Modify: `desktop/electron/preload.cjs` (nach `onOpenPriceAlerts`)
- Modify: `desktop/src/utils/routes.js`, `desktop/src/utils/routes.test.mjs`
- Modify: `desktop/src/utils/i18n-de.js`, `desktop/src/utils/i18n-de.test.mjs`
- Modify: `desktop/src/components/SammlungLayout.jsx` (`SEGMENTS`)
- Modify: `desktop/src/App.jsx` (Import, Route)
- Create: `desktop/src/components/SealedList.jsx`
- Create: `desktop/src/components/SealedAddDialog.jsx`
- Modify: `desktop/src/components/Start.jsx` (Effekt, Unterzeile)
- Modify: `desktop/src/components/Portfolio.jsx` (Listener)

**Interfaces:**
- Consumes (Task 5): `readSealedProducts`, `searchSealedProducts`; (Task 6) `SealedError`, `listSealed`, `addSealed`, `setSealedQuantity`, `openSealed`, `deleteSealed`; (Task 7) `portfolioTotals`, Ereignis `sealed-changed`.
- Produces (Renderer über `window.api`):
  - `listSealed()` → `{ items: [{ sealed_id, cm_product_id, name, kind, quantity, price, price_updated_at, lineValue, stale, kindLabel, … }], sealedValue }` (wirft bei DB-Fehler)
  - `addSealed({ cm_product_id, quantity })` → `{ success: true, sealed_id, merged }` | `{ success: false, error }`
  - `setSealedQuantity({ sealed_id, quantity })`, `deleteSealed(sealedId)` → `{ success }` | `{ success: false, error }`
  - `openSealed(sealedId)` → `{ success: true, quantity, deleted }` | `{ success: false, error }`
  - `searchSealedProducts(query)` → `{ available: boolean, results: [{ cm_product_id, name, kind, trend, kindLabel }] }`
  - `onSealedChanged(cb)` → Abmeldefunktion
  - `getPortfolio()` → zusätzlich `cardValue`, `sealedValue`, `hasSealed`; `totalValue` = Karten + Sealed
- Produces: `ROUTES.sealed = '/sammlung/sealed'`, `T.sealed = 'Sealed'`.

Keine Komponenten-Tests im Projekt; Prüfung per Helfer-Tests, Lint und Build. setState nur in Promise-Callbacks und Handlern.

- [ ] **Step 1: Helfer-Tests erweitern (Route, Vokabel)**

`desktop/src/utils/routes.test.mjs` — nach `assert.equal(ROUTES.karten, '/sammlung/karten');`:
```js
assert.equal(ROUTES.sealed, '/sammlung/sealed');
```
`desktop/src/utils/i18n-de.test.mjs` — in der Schlüsselliste `'decks', 'deals',` ersetzen durch:
```js
'decks', 'sealed', 'deals',
```
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → FAIL (`ROUTES.sealed` undefined, `missing vocabulary key: sealed`).

- [ ] **Step 2: Route und Vokabel**

`desktop/src/utils/routes.js` — nach `decks: '/sammlung/decks',`:
```js
  sealed: '/sammlung/sealed',
```
`desktop/src/utils/i18n-de.js` — nach `decks: 'Decks',`:
```js
  sealed: 'Sealed',
```
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → PASS.

- [ ] **Step 3: `main.cjs` — Imports**

Zeile `const { recordPortfolioValue } = require('./portfolio-value.cjs');` ersetzen durch:
```js
const { recordPortfolioValue, portfolioTotals } = require('./portfolio-value.cjs');
```
Nach `const { deleteContainer } = require('./containers-schema.cjs');`:
```js
const sealed = require('./sealed-items.cjs');
const { readSealedProducts, searchSealedProducts } = require('./sealed-products.cjs');
```

- [ ] **Step 4: `main.cjs` — `get-portfolio` und Sealed-Block**

Den Handler `ipcMain.handle('get-portfolio', () => { … });` ersetzen durch:
```js
ipcMain.handle('get-portfolio', () => {
    try {
        const unique = db.prepare('SELECT COUNT(*) AS n FROM cards WHERE quantity > 0 AND deleted = 0').get().n || 0;
        // Spec G3 §6/§7.3: totalValue = Karten + Sealed (Start, Insights › Wert); die Unterzeile nur mit Sealed-Bestand.
        const t = portfolioTotals(db);
        return { totalValue: t.total, cardValue: t.cards, sealedValue: t.sealed, hasSealed: t.sealedCount > 0, totalCards: copyCount(db), uniqueCards: unique };
    } catch (e) { return { totalValue: 0, cardValue: 0, sealedValue: 0, hasSealed: false, totalCards: 0, uniqueCards: 0 }; }
});

// --- Spec G3: Sealed-Bestand (lokal in SQLite; der Sync schiebt in die Cloud) ---
const SEALED_NO_PRODUCTS = 'Produktliste nicht verfügbar — Cardmarket-Preise einmal aktualisieren.';
// Wie containerCopyErrorMessage: erwartete Fehler (SealedError) tragen schon eine deutsche Meldung.
function sealedErrorMessage(e, channel) {
    if (e instanceof sealed.SealedError) return e.message;
    console.error(`[${channel}]`, e);
    return CONTAINER_COPY_ERROR_MSG;
}
ipcMain.handle('sealed-list', () => {
    try { return sealed.listSealed(db); }
    catch (e) { console.error('[sealed-list]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});
// Name, Art und Startpreis kommen aus der lokalen Produktliste, nie vom Renderer.
ipcMain.handle('sealed-add', (event, { cm_product_id, quantity } = {}) => {
    try {
        const products = readSealedProducts(userDataPath);
        if (!products) return { success: false, error: SEALED_NO_PRODUCTS };
        const product = products.find((p) => p.cm_product_id === Number(cm_product_id));
        return { success: true, ...sealed.addSealed(db, product, quantity) };
    } catch (e) { return { success: false, error: sealedErrorMessage(e, 'sealed-add') }; }
});
ipcMain.handle('sealed-set-quantity', (event, { sealed_id, quantity } = {}) => {
    try { sealed.setSealedQuantity(db, { sealed_id, quantity }); return { success: true }; }
    catch (e) { return { success: false, error: sealedErrorMessage(e, 'sealed-set-quantity') }; }
});
ipcMain.handle('sealed-open', (event, sealedId) => {
    try { return { success: true, ...sealed.openSealed(db, sealedId) }; }
    catch (e) { return { success: false, error: sealedErrorMessage(e, 'sealed-open') }; }
});
ipcMain.handle('sealed-delete', (event, sealedId) => {
    try { sealed.deleteSealed(db, sealedId); return { success: true }; }
    catch (e) { return { success: false, error: sealedErrorMessage(e, 'sealed-delete') }; }
});
ipcMain.handle('sealed-products-search', (event, query) => {
    const products = readSealedProducts(userDataPath);
    if (!products) return { available: false, results: [] };
    return { available: true, results: searchSealedProducts(products, query) };
});
```

- [ ] **Step 5: `main.cjs` — Bulk meldet Sealed-Änderungen**

`function notifyBulk(res) { … }` ersetzen durch:
```js
function notifyBulk(res) {
  if (res && (res.priced > 0 || res.sealedPriced > 0)) {
    recordPortfolioValue(db);
    if (mainWindow) {
      const stats = { totalValue: totalValue(db) };
      mainWindow.webContents.send('price-update', { updates: [], totalValue: stats.totalValue || 0 });
      // Spec G3: Schritt C hat Sealed-Preise geaendert -- Sealed-Liste, Start und Insights › Wert laden neu.
      if (res.sealedPriced > 0) mainWindow.webContents.send('sealed-changed');
    }
  }
}
```

- [ ] **Step 6: `preload.cjs`**

Nach der Zeile `onOpenPriceAlerts: …,` (vor dem schließenden `});`):
```js

  // Sealed-Bestand (Spec G3) — lokal in SQLite, der Sync schiebt
  listSealed: () => ipcRenderer.invoke('sealed-list'),
  addSealed: (data) => ipcRenderer.invoke('sealed-add', data),
  setSealedQuantity: (data) => ipcRenderer.invoke('sealed-set-quantity', data),
  openSealed: (sealedId) => ipcRenderer.invoke('sealed-open', sealedId),
  deleteSealed: (sealedId) => ipcRenderer.invoke('sealed-delete', sealedId),
  searchSealedProducts: (query) => ipcRenderer.invoke('sealed-products-search', query),
  onSealedChanged: (cb) => { const s = (_e) => cb(); ipcRenderer.on('sealed-changed', s); return () => ipcRenderer.removeListener('sealed-changed', s); },
```

- [ ] **Step 7: `src/components/SealedAddDialog.jsx`**

```jsx
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { X, Search, Loader2 } from 'lucide-react';
import { fmtEUR } from '../utils/format';
import { T } from '../utils/i18n-de';

const NO_PRODUCTS = 'Produktliste nicht verfügbar — Cardmarket-Preise einmal aktualisieren.';
const SAVE_ERROR = 'Speichern fehlgeschlagen.';

// Spec G3 §7.3 — Hinzufügen-Dialog: Suche in der Cardmarket-Produktliste (sealed-products-search), Treffer mit
// Name, Art und Trend, Feld „Menge“, „Hinzufügen“ (sealed-add). Name, Art und Startpreis setzt der Hauptprozess.
export default function SealedAddDialog({ onClose, onAdded }) {
  const [query, setQuery] = useState('');
  const [available, setAvailable] = useState(null); // null = noch unbekannt
  const [search, setSearch] = useState({ busy: false, results: null, error: null });
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [save, setSave] = useState({ busy: false, error: null });

  // Ohne Cardmarket-Cache soll der Hinweis sofort stehen, nicht erst nach der ersten Suche.
  useEffect(() => {
    let alive = true;
    window.api.searchSealedProducts('')
      .then((r) => { if (alive) setAvailable(!!r?.available); })
      .catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  const runSearch = (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearch((s) => ({ ...s, busy: true, error: null }));
    window.api.searchSealedProducts(query)
      .then((r) => {
        setAvailable(!!r?.available);
        setSearch({ busy: false, results: r?.results || [], error: null });
        setSelected(null);
      })
      .catch(() => setSearch({ busy: false, results: null, error: 'Suche fehlgeschlagen.' }));
  };

  const qty = Number(quantity);
  const qtyValid = Number.isInteger(qty) && qty >= 1;

  const add = () => {
    if (!selected || !qtyValid) return;
    setSave({ busy: true, error: null });
    window.api.addSealed({ cm_product_id: selected.cm_product_id, quantity: qty })
      .then((r) => {
        if (r?.success) onAdded();
        else setSave({ busy: false, error: r?.error || SAVE_ERROR });
      })
      .catch(() => setSave({ busy: false, error: SAVE_ERROR }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-obsidian-700 border border-line rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">Sealed hinzufügen</h3>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        {available === false && <p className="text-sm text-crit">{NO_PRODUCTS}</p>}

        <form onSubmit={runSearch} className="flex gap-2">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Produktname, z. B. Booster Box"
            className="flex-1 bg-obsidian border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet"
          />
          <button type="submit" disabled={search.busy || !query.trim() || available === false}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line text-sm text-ink-muted hover:text-ink disabled:opacity-50">
            {search.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} {T.suchen}
          </button>
        </form>

        {search.error && <p className="text-sm text-crit">{search.error}</p>}
        {search.results && search.results.length === 0 && available !== false && (
          <p className="text-sm text-ink-faint">{T.keineTreffer}</p>
        )}
        {search.results && search.results.length > 0 && (
          <div className="max-h-72 overflow-auto divide-y divide-line border border-line rounded-xl">
            {search.results.map((p) => (
              <button key={p.cm_product_id} type="button" onClick={() => setSelected(p)}
                      className={clsx('w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                        selected?.cm_product_id === p.cm_product_id ? 'bg-space-violet/15' : 'hover:bg-white/5')}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink truncate">{p.name}</span>
                  <span className="block text-[11px] text-ink-faint">{p.kindLabel}</span>
                </span>
                <span className="font-mono text-sm text-ink-muted">{p.trend == null ? '—' : fmtEUR(p.trend)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs font-bold text-ink-muted mb-1 uppercase tracking-wider">Menge</label>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-24 bg-obsidian border border-line text-ink rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet"
            />
          </div>
          <div className="flex-1 min-w-0 text-sm text-ink-muted truncate pb-2">{selected ? selected.name : 'Kein Produkt gewählt'}</div>
        </div>

        {!qtyValid && <p className="text-sm text-crit">Die Menge muss mindestens 1 sein.</p>}
        {save.error && <p className="text-sm text-crit">{save.error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">{T.abbrechen}</button>
          <button type="button" onClick={add} disabled={!selected || !qtyValid || save.busy}
                  className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {save.busy ? 'Wird gespeichert…' : 'Hinzufügen'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: `src/components/SealedList.jsx`**

```jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Minus, PackageOpen, Trash2, Loader2 } from 'lucide-react';
import SealedAddDialog from './SealedAddDialog';
import { fmtEUR } from '../utils/format';
import { ROUTES } from '../utils/routes';

const LOAD_ERROR = 'Sealed-Bestand konnte nicht geladen werden.';
const WRITE_ERROR = 'Speichern fehlgeschlagen.';

// Spec G3 §7.3 — Sammlung › Sealed. Reihenfolge, Summen, „Preis veraltet“ und Art-Bezeichnung kommen fertig aus
// dem Hauptprozess (sealed-list, Regeln in electron/sealed-value.cjs); hier wird nur angezeigt und geschrieben.
export default function SealedList() {
  const [state, setState] = useState(() => (window.api?.listSealed
    ? { loading: true, error: null, data: null }
    : { loading: false, error: LOAD_ERROR, data: null }));
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [opened, setOpened] = useState(null); // { sealed_id, name, deleted } der zuletzt geöffneten Zeile
  const [writeError, setWriteError] = useState(null);

  useEffect(() => {
    if (!window.api?.listSealed) return undefined;
    let alive = true;
    const load = () => window.api.listSealed()
      .then((data) => { if (alive) setState({ loading: false, error: null, data }); })
      .catch(() => { if (alive) setState((s) => ({ loading: false, error: LOAD_ERROR, data: s.data })); });
    load();
    const off = window.api.onSealedChanged?.(() => load());
    return () => { alive = false; off?.(); };
  }, [reload]);

  const write = (promise, afterSuccess) => promise
    .then((r) => {
      if (r && r.success === false) { setWriteError(r.error || WRITE_ERROR); return; }
      setWriteError(null);
      afterSuccess?.(r);
    })
    .catch(() => setWriteError(WRITE_ERROR))
    .finally(() => setReload((n) => n + 1));

  const setQuantity = (item, quantity) => write(window.api.setSealedQuantity({ sealed_id: item.sealed_id, quantity }));
  const remove = (item) => {
    if (!confirm(`„${item.name}“ löschen?`)) return;
    write(window.api.deleteSealed(item.sealed_id));
  };
  // Spec G3 §4.1: Menge − bis 1; bei 1 nach Rückfrage Soft-Delete.
  const minus = (item) => (item.quantity > 1 ? setQuantity(item, item.quantity - 1) : remove(item));
  const open = (item) => {
    if (item.quantity === 1 && !confirm(`Letztes Exemplar von „${item.name}“ geöffnet? Der Eintrag wird entfernt.`)) return;
    write(window.api.openSealed(item.sealed_id),
      (r) => setOpened({ sealed_id: item.sealed_id, name: item.name, deleted: !!r?.deleted }));
  };

  const data = state.data;
  const scanHint = (
    <span className="text-xs text-good">
      Geöffnet — <Link to={ROUTES.scannen} className="underline hover:text-ink">Jetzt scannen</Link>
    </span>
  );

  return (
    <div className="h-full overflow-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <div className="font-display text-[11px] tracking-[0.14em] uppercase text-ink-muted">Sealed-Wert</div>
          <div className="font-display font-bold text-2xl text-ink mt-1">{data ? fmtEUR(data.sealedValue) : '—'}</div>
        </div>
        <button type="button" onClick={() => setAdding(true)}
                className="flex items-center gap-2 bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <Plus className="w-4 h-4" /> Hinzufügen
        </button>
      </div>

      {writeError && <p className="text-sm text-crit mb-3">{writeError}</p>}
      {state.error && <p className="text-sm text-crit mb-3">{state.error}</p>}
      {/* Die Zeile ist nach dem Öffnen des letzten Exemplars weg — der Hinweis steht dann hier. */}
      {opened?.deleted && <p className="text-sm text-ink mb-3">„{opened.name}“ · {scanHint}</p>}

      {!data && state.loading && (
        <div className="flex items-center justify-center gap-2 text-ink-muted py-10">
          <Loader2 className="w-5 h-5 animate-spin" /> Sealed-Bestand wird geladen …
        </div>
      )}
      {data && data.items.length === 0 && (
        <div className="text-center text-ink-faint py-10">Noch kein Sealed-Bestand</div>
      )}
      {data && data.items.length > 0 && (
        <div className="bg-obsidian-700 border border-line rounded-2xl divide-y divide-line">
          {data.items.map((item) => (
            <div key={item.sealed_id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">{item.kindLabel}</div>
                <div className="text-sm text-ink truncate">{item.name}</div>
                {opened && !opened.deleted && opened.sealed_id === item.sealed_id && scanHint}
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => minus(item)} title="Menge verringern"
                        className="p-1.5 rounded-lg border border-line text-ink-muted hover:text-ink"><Minus className="w-3.5 h-3.5" /></button>
                <span className="w-8 text-center font-mono text-sm text-ink">{item.quantity}</span>
                <button type="button" onClick={() => setQuantity(item, item.quantity + 1)} title="Menge erhöhen"
                        className="p-1.5 rounded-lg border border-line text-ink-muted hover:text-ink"><Plus className="w-3.5 h-3.5" /></button>
              </div>
              <div className="w-28 text-right">
                <div className="font-mono text-xs text-ink-muted">je {item.price == null ? '—' : fmtEUR(item.price)}</div>
                {item.stale && <div className="text-[11px] text-gold">Preis veraltet</div>}
              </div>
              <div className="w-28 text-right font-mono text-sm text-ink">{item.lineValue == null ? '—' : fmtEUR(item.lineValue)}</div>
              <button type="button" onClick={() => open(item)}
                      className="flex items-center gap-1 text-xs text-ink-muted hover:text-ink border border-line rounded-lg px-2 py-1">
                <PackageOpen className="w-3.5 h-3.5" /> Geöffnet
              </button>
              <button type="button" onClick={() => remove(item)} title="Löschen"
                      className="p-1.5 rounded-lg text-crit hover:bg-crit/10"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <SealedAddDialog
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); setReload((n) => n + 1); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 9: Segment und Route**

`desktop/src/components/SammlungLayout.jsx` — nach `{ to: ROUTES.decks, label: T.decks },`:
```jsx
  { to: ROUTES.sealed, label: T.sealed },
```
`desktop/src/App.jsx` — nach `import SetCompletion from './components/SetCompletion';`:
```jsx
import SealedList from './components/SealedList';
```
nach `<Route path="decks" element={<DeckBuilder />} />`:
```jsx
                      <Route path="sealed" element={<SealedList />} />
```

- [ ] **Step 10: `Start.jsx` — Unterzeile und Nachladen**

Im ersten `useEffect` nach dem `listUnsortedCopies`-Aufruf (vor der schließenden `}, []);`):
```jsx
    // Spec G3: Sealed-Änderungen (Sync, Bulk-Schritt C) ändern Gesamtwert und Unterzeile.
    const offSealed = window.api.onSealedChanged?.(() => window.api.getPortfolio().then(d => d && setStats(d)));
    return () => offSealed?.();
```
Nach `<div className="font-display font-bold text-4xl text-ink mt-2">{money(stats.totalValue)}</div>`:
```jsx
          {/* Spec G3 §7.3: Aufteilung nur bei Sealed-Bestand */}
          {stats.hasSealed && (
            <div className="text-xs text-ink-muted mt-1">Karten {money(stats.cardValue)} · Sealed {money(stats.sealedValue)}</div>
          )}
```

- [ ] **Step 11: `Portfolio.jsx` — Insights › Wert lädt bei Sealed-Änderungen neu**

Nach dem Block `const cleanupSync = window.api.onCollectionChanged && window.api.onCollectionChanged(() => { … });`:
```jsx

            // Spec G3: Sealed-Änderungen ändern den Gesamtwert
            const cleanupSealed = window.api.onSealedChanged && window.api.onSealedChanged(() => {
                setTimeout(() => loadData(), 0);
            });
```
und in der Aufräumfunktion nach `if (cleanupSync) cleanupSync();`:
```jsx
                if (cleanupSealed) cleanupSealed();
```

- [ ] **Step 12: Prüfen**

1. `node --check desktop/electron/main.cjs && node --check desktop/electron/preload.cjs` → keine Ausgabe.
2. Kanal-Parität: für `sealed-list sealed-add sealed-set-quantity sealed-open sealed-delete sealed-products-search` per Grep bestätigen, dass jeder in `main.cjs` UND `preload.cjs` steht; `sealed-changed` in `sync.cjs` bzw. `main.cjs` UND `preload.cjs`.
3. In `desktop/`: `node --test src/utils/*.test.js src/utils/*.test.mjs` → PASS.
4. In `desktop/`: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → alle grün.
5. In `desktop/`: `npx eslint .` → genau `5 errors`.
6. In `desktop/`: `npx vite build` → erfolgreich.
7. Per Grep: kein sichtbarer Text „Unknown" oder „Taschen" in `SealedList.jsx`/`SealedAddDialog.jsx`.

- [ ] **Step 13: Commit**

```bash
git add desktop/electron/main.cjs desktop/electron/preload.cjs desktop/src/utils/routes.js desktop/src/utils/routes.test.mjs desktop/src/utils/i18n-de.js desktop/src/utils/i18n-de.test.mjs desktop/src/components/SammlungLayout.jsx desktop/src/App.jsx desktop/src/components/SealedList.jsx desktop/src/components/SealedAddDialog.jsx desktop/src/components/Start.jsx desktop/src/components/Portfolio.jsx
git commit -m "feat(g3): Sammlung > Sealed am Desktop mit Suche, Menge, Geoeffnet und Gesamtwert

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 9: Handy-Katalog — `CatalogDb` v2 mit `sealed_products`, Import, Suche

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogDb.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/CatalogSealedTest.kt`
- Modify: `android/app/src/androidTest/java/com/example/yugiohscanner/CatalogDbTest.kt` (nur kompilieren, nicht auf den Handys des Nutzers ausführen)

**Interfaces:**
- Consumes (Task 1): `SealedValue.KIND_LABELS`; (Task 5) `sealed_products` im Katalog.
- Produces (für Task 10/11): `data class CatalogSealedProduct(cmProductId: Long, name: String, kind: String, trend: Double?)`; `ParsedCatalog.sealedProducts: List<CatalogSealedProduct>` (Standard leer); `CatalogParser.parseSealedProducts(root: JSONObject)` (internal); `CatalogDb.VERSION = 2`, `CatalogDb.sealedProductCount()`; `CatalogRepository.sealedProductCount(): Int`, `CatalogRepository.searchSealed(name: String, limit: Int = 50): List<CatalogSealedProduct>`, `CatalogRepository.sealedSearchQuery(name, limit): Pair<String, Array<String>>` (internal).

- [ ] **Step 1: JVM-Test schreiben**

`android/app/src/test/java/com/example/yugiohscanner/CatalogSealedTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CatalogDb
import com.example.yugiohscanner.cloud.CatalogParser
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CatalogSealedProduct
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

/**
 * Spec G3 §3/§10 -- CatalogDb v2 auf der JVM: Parser, Schema-Version und die reinen Suchargumente. Der
 * SQLite-Rundlauf (Import und Suche) steht in androidTest/CatalogDbTest und in der Geraete-Abnahme.
 */
class CatalogSealedTest {

    private fun gz(json: String): ByteArray {
        val bos = ByteArrayOutputStream()
        GZIPOutputStream(bos).use { it.write(json.toByteArray(Charsets.UTF_8)) }
        return bos.toByteArray()
    }

    @Test fun `Katalog-Schema ist Version 2`() {
        assertEquals(2, CatalogDb.VERSION)
    }

    @Test fun `liest sealed_products, unbekannte Art wird other, Trend 0 wird null, kaputte Eintraege fallen weg`() {
        val json = """{"version":14,"built_at":"2026-09-15T03:00:00Z","cards":[],"sealed_products":[
          {"cm_product_id":254469,"name":"Metal Raiders Booster Box","kind":"display","trend":499.29},
          {"cm_product_id":230006,"name":"Force of the Breaker Booster","kind":"booster","trend":null},
          {"cm_product_id":999001,"name":"Beispiel-Turnierticket","kind":"karton","trend":0},
          {"cm_product_id":0,"name":"ohne gültige ID","kind":"booster","trend":1.0},
          {"name":"ohne ID","kind":"booster","trend":1.0},
          {"cm_product_id":230007,"name":"","kind":"booster","trend":46.11}
        ]}"""
        assertEquals(
            listOf(
                CatalogSealedProduct(254469L, "Metal Raiders Booster Box", "display", 499.29),
                CatalogSealedProduct(230006L, "Force of the Breaker Booster", "booster", null),
                CatalogSealedProduct(999001L, "Beispiel-Turnierticket", "other", null),
            ),
            CatalogParser.parse(gz(json)).sealedProducts,
        )
    }

    @Test fun `alter Katalog ohne sealed_products ergibt eine leere Liste`() {
        val json = """{"version":13,"built_at":"x","cards":[]}"""
        assertTrue(CatalogParser.parse(gz(json)).sealedProducts.isEmpty())
    }

    @Test fun `Sealed-Suche escaped LIKE-Zeichen, sortiert nach Name, hoechstens 50`() {
        val (sql, args) = CatalogRepository.sealedSearchQuery("  100%_Box\\ ")
        assertEquals(
            "SELECT cm_product_id, name, kind, trend FROM sealed_products WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?",
            sql,
        )
        assertEquals(listOf("%100\\%\\_Box\\\\%", "50"), args.toList())
        assertEquals("7", CatalogRepository.sealedSearchQuery("x", 7).second[1])
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "com.example.yugiohscanner.CatalogSealedTest"`
Expected: FAIL — `Unresolved reference: CatalogSealedProduct`, `VERSION`, `sealedSearchQuery`.

- [ ] **Step 3: `CatalogParser.kt`**

Import nach `import org.json.JSONObject`:
```kotlin
import com.example.yugiohscanner.ml.SealedValue
```
Nach dem Block `data class CatalogPrinting( … )`:
```kotlin

/** Spec G3 §3 -- ein Sealed-Produkt aus `sealed_products` im Katalog; `trend` ist der Cardmarket-Trend beim Bau oder null. */
data class CatalogSealedProduct(
    val cmProductId: Long,
    val name: String,
    val kind: String,
    val trend: Double?,
)
```
`data class ParsedCatalog( … )` ersetzen durch:
```kotlin
data class ParsedCatalog(
    val version: Int,
    val builtAt: String,
    val cards: List<CatalogCard>,
    val sealedProducts: List<CatalogSealedProduct> = emptyList(),
)
```
Den Schluss von `parse`
```kotlin
        return ParsedCatalog(
            version = version,
            builtAt = builtAt,
            cards = cards
        )
    }
```
ersetzen durch:
```kotlin
        return ParsedCatalog(
            version = version,
            builtAt = builtAt,
            cards = cards,
            sealedProducts = parseSealedProducts(rootJson),
        )
    }

    /**
     * Spec G3 §3: fehlt der Schluessel (Katalog von vor G3), bleibt die Liste leer. Eintraege ohne gueltige
     * ID oder ohne Namen fallen weg; eine unbekannte Art wird "other", ein Trend <= 0 wird null.
     */
    internal fun parseSealedProducts(root: JSONObject): List<CatalogSealedProduct> {
        val arr = root.optJSONArray("sealed_products") ?: return emptyList()
        val out = mutableListOf<CatalogSealedProduct>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            if (o.isNull("cm_product_id") || o.isNull("name")) continue
            val id = o.optLong("cm_product_id", 0L)
            val name = o.optString("name")
            if (id <= 0L || name.isBlank()) continue
            val kind = o.optString("kind").takeIf { it in SealedValue.KIND_LABELS } ?: "other"
            val trend = if (o.isNull("trend")) null else o.optDouble("trend").takeIf { it > 0.0 }
            out.add(CatalogSealedProduct(id, name, kind, trend))
        }
        return out
    }
```

- [ ] **Step 4: `CatalogDb.kt`**

Kopfzeile `class CatalogDb(context: Context) : SQLiteOpenHelper(context.applicationContext, "catalog.db", null, 1) {` ersetzen durch:
```kotlin
class CatalogDb(context: Context) : SQLiteOpenHelper(context.applicationContext, "catalog.db", null, VERSION) {

    companion object {
        /** Spec G3 §3: v2 bringt `sealed_products`. onUpgrade verwirft den alten Katalog, CatalogSync laedt neu. */
        const val VERSION = 2
    }
```
In `onCreate` nach `db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)")`:
```kotlin
        db.execSQL("CREATE TABLE sealed_products (cm_product_id INTEGER PRIMARY KEY, name TEXT, kind TEXT, trend REAL)")
        db.execSQL("CREATE INDEX sealed_products_name_idx ON sealed_products(name)")
```
In `onUpgrade` vor `onCreate(db)`:
```kotlin
        db.execSQL("DROP TABLE IF EXISTS sealed_products")
```
In `importAll` nach `db.delete("cards", null, null)`:
```kotlin
            db.delete("sealed_products", null, null)
```
In `importAll` direkt vor `val metaValues = ContentValues()`:
```kotlin
            // Spec G3 §3: Sealed-Produktliste in derselben Transaktion (doppelte IDs ersetzen einander).
            val sealedValues = ContentValues()
            for (p in parsed.sealedProducts) {
                sealedValues.clear()
                sealedValues.put("cm_product_id", p.cmProductId)
                sealedValues.put("name", p.name)
                sealedValues.put("kind", p.kind)
                if (p.trend == null) sealedValues.putNull("trend") else sealedValues.put("trend", p.trend)
                db.insertWithOnConflict("sealed_products", null, sealedValues, SQLiteDatabase.CONFLICT_REPLACE)
            }

```
Nach `fun cardCount(): Int { … }`:
```kotlin

    fun sealedProductCount(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM sealed_products", null).use { c ->
            if (c.moveToFirst()) return c.getInt(0)
        }
        return 0
    }
```

- [ ] **Step 5: `CatalogRepository.kt`**

Nach `fun cardCount(): Int = db?.cardCount() ?: 0`:
```kotlin

    /** Anzahl der Sealed-Produkte im importierten Katalog; 0 ohne Katalog oder mit Katalog von vor G3. */
    fun sealedProductCount(): Int = db?.sealedProductCount() ?: 0
```
Direkt vor `private fun escapeLike(input: String): String =`:
```kotlin
    /** Spec G3 §3: SQL und Argumente der Sealed-Suche -- rein, damit die Escape-Regel ohne SQLite testbar ist. */
    internal fun sealedSearchQuery(name: String, limit: Int = 50): Pair<String, Array<String>> =
        "SELECT cm_product_id, name, kind, trend FROM sealed_products WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?" to
            arrayOf("%${escapeLike(name.trim())}%", limit.toString())

    /** Name enthaelt Suchtext (escaptes LIKE wie [search]), max. [limit], sortiert nach Name. */
    fun searchSealed(name: String, limit: Int = 50): List<CatalogSealedProduct> {
        val database = db?.readableDatabase ?: return emptyList()
        if (name.isBlank()) return emptyList()
        val (sql, args) = sealedSearchQuery(name, limit)
        val results = mutableListOf<CatalogSealedProduct>()
        database.rawQuery(sql, args).use { c ->
            while (c.moveToNext()) {
                results.add(
                    CatalogSealedProduct(
                        cmProductId = c.getLong(0),
                        name = c.getString(1) ?: "",
                        kind = c.getString(2) ?: "other",
                        trend = if (c.isNull(3)) null else c.getDouble(3),
                    )
                )
            }
        }
        return results
    }

```

- [ ] **Step 6: Geräte-Test erweitern (nur kompilieren)**

In `android/app/src/androidTest/java/com/example/yugiohscanner/CatalogDbTest.kt`:
Import nach `import com.example.yugiohscanner.cloud.CatalogRepository`:
```kotlin
import com.example.yugiohscanner.cloud.CatalogSealedProduct
```
Den Helfer `private fun catalog(version: Int, cards: List<CatalogCard>) =` samt Folgezeile ersetzen durch:
```kotlin
    private fun sealedProducts() = listOf(
        CatalogSealedProduct(254470L, "Spell Ruler Booster Box", "display", 97.05),
        CatalogSealedProduct(254469L, "Metal Raiders Booster Box", "display", 499.29),
        CatalogSealedProduct(230006L, "Force of the Breaker Booster", "booster", null),
    )

    private fun catalog(version: Int, cards: List<CatalogCard>, sealed: List<CatalogSealedProduct> = emptyList()) =
        ParsedCatalog(version = version, builtAt = "2026-09-06T00:00:00Z", cards = cards, sealedProducts = sealed)
```
`db.importAll(catalog(12, listOf(darkMagician(), blueEyes())))` ersetzen durch:
```kotlin
        db.importAll(catalog(12, listOf(darkMagician(), blueEyes()), sealedProducts()))
```
Nach `assertTrue(CatalogRepository.search("zzz").isEmpty())`:
```kotlin

        // Spec G3 §3: Sealed-Produkte importiert; Suche nach Name sortiert, LIKE-Zeichen escaped.
        assertEquals(3, db.sealedProductCount())
        assertEquals(
            listOf("Metal Raiders Booster Box", "Spell Ruler Booster Box"),
            CatalogRepository.searchSealed("booster box").map { it.name },
        )
        assertNull(CatalogRepository.searchSealed("force").single().trend)
        assertTrue(CatalogRepository.searchSealed("100%").isEmpty())
```
Nach `assertNull(CatalogRepository.card("46986414"))`:
```kotlin
        assertEquals(0, db.sealedProductCount())
```
`db.importAll(catalog(99, listOf(blueEyes(), blueEyes())))` ersetzen durch:
```kotlin
            db.importAll(catalog(99, listOf(blueEyes(), blueEyes()), sealedProducts()))
```
Nach `assertTrue("importAll sollte bei doppelter id werfen", threw)`:
```kotlin
        assertEquals(0, db.sealedProductCount())
```

- [ ] **Step 7: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug compileDebugAndroidTestKotlin`
Expected: BUILD SUCCESSFUL, alle Tests grün (neu: `CatalogSealedTest` 4). `CatalogDbTest` wird nur kompiliert: `connectedDebugAndroidTest` löscht `catalog.db` der installierten App und deinstalliert sie nach dem Lauf — nie auf den Handys des Nutzers ausführen.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogDb.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt android/app/src/test/java/com/example/yugiohscanner/CatalogSealedTest.kt android/app/src/androidTest/java/com/example/yugiohscanner/CatalogDbTest.kt
git commit -m "feat(g3): Handy-Katalog v2 mit Sealed-Produktliste und Suche

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 10: Handy-Daten — Repository, Speicher, Nachladen, Tageswert-Schutz

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/SealedRepository.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/SealedSnapshot.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/SealedRepositoryTest.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/SealedSnapshotTest.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/SnapshotsRepository.kt` (`upsertToday`)
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt` (`ForegroundTick.run(onEnter = …)`)
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt` (Import, Tageswert im `LaunchedEffect`, `RefreshableBox`)

**Interfaces:**
- Consumes (Task 1): `SealedItem`, `SealedValue.sealedValue`; (Task 9) `CatalogSealedProduct`; (vorhanden) `SupabaseCloud.base()/key()/token()/http()/signIn()/jsonMedia`, `ListCache`, `CacheState`.
- Produces (für Task 11):
  - `sealed interface SealedAddPlan { data class Increase(sealedId: String, quantity: Int); data class Insert(product: CatalogSealedProduct, quantity: Int) }`
  - `SealedRepository.listParams()`, `liveRowParams(sealedId)`, `parse(text)`, `planAdd(live, product, quantity)`, `insertBody(sealedId, product, quantity, nowIso)`; `suspend loadLive()`, `add(product, quantity)`, `setQuantity(sealedId, quantity)`, `delete(sealedId)`, `open(item)` (alle `suspend` werfen bei Fehler)
  - `SideStores.sealedItems: ListCache<List<SealedItem>>`
  - `SealedSnapshot.Values(total: Double, sealed: Double)`, `SealedSnapshot.decide(cardTotal: Double, sealed: CacheState<List<SealedItem>>): Values?`
  - `SnapshotsRepository.upsertBody(totalValue, cardCount, sealedValue): JSONObject`, `upsertToday(totalValue: Double, cardCount: Int, sealedValue: Double)`

- [ ] **Step 1: Tests schreiben**

`android/app/src/test/java/com/example/yugiohscanner/SealedRepositoryTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CatalogSealedProduct
import com.example.yugiohscanner.cloud.SealedAddPlan
import com.example.yugiohscanner.cloud.SealedItem
import com.example.yugiohscanner.cloud.SealedRepository
import com.example.yugiohscanner.cloud.SnapshotsRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SealedRepositoryTest {
    private val display = CatalogSealedProduct(254469L, "Metal Raiders Booster Box", "display", 499.29)
    private val noTrend = CatalogSealedProduct(254468L, "Legend of Blue Eyes White Dragon Booster Box", "display", null)

    private fun item(id: String, product: Long, quantity: Int, createdAt: String?, deleted: Boolean = false) =
        SealedItem(id, product, "x", "display", quantity, null, null, createdAt, deleted)

    @Test fun `lebende Zeilen in stabiler Ordnung, Schreibziel nur lebend`() {
        assertEquals(
            listOf(
                "select" to "sealed_id,cm_product_id,name,kind,quantity,price,price_updated_at,created_at,deleted",
                "deleted" to "eq.false", "order" to "created_at.asc,sealed_id.asc", "limit" to "1000",
            ),
            SealedRepository.listParams(),
        )
        assertEquals(listOf("sealed_id" to "eq.s1", "deleted" to "eq.false"), SealedRepository.liveRowParams("s1"))
    }

    @Test fun `parse mit Nullwerten`() {
        val rows = SealedRepository.parse(
            """[{"sealed_id":"s1","cm_product_id":254469,"name":"Metal Raiders Booster Box","kind":"display","quantity":2,"price":499.29,"price_updated_at":"2026-09-15T05:00:03.123456+00:00","created_at":"2026-09-14T18:00:00+00:00","deleted":false},
               {"sealed_id":"s2","cm_product_id":254468,"name":"Legend of Blue Eyes White Dragon Booster Box","kind":"display","quantity":1,"price":null,"price_updated_at":null,"created_at":null,"deleted":false}]""",
        )
        assertEquals(
            listOf(
                SealedItem("s1", 254469L, "Metal Raiders Booster Box", "display", 2, 499.29, "2026-09-15T05:00:03.123456+00:00", "2026-09-14T18:00:00+00:00", false),
                SealedItem("s2", 254468L, "Legend of Blue Eyes White Dragon Booster Box", "display", 1, null, null, null, false),
            ),
            rows,
        )
    }

    @Test fun `Anlegen: lebende Zeile desselben Produkts waechst, die aelteste zuerst`() {
        val live = listOf(
            item("s-neu", 254469L, 1, "2026-09-15T10:00:00+00:00"),
            item("s-alt", 254469L, 2, "2026-09-01T10:00:00+00:00"),
            item("s-anders", 230006L, 5, "2026-08-01T10:00:00+00:00"),
        )
        assertEquals(SealedAddPlan.Increase("s-alt", 5), SealedRepository.planAdd(live, display, 3))
    }

    @Test fun `Anlegen: geloeschte und fremde Zeilen zaehlen nicht`() {
        val live = listOf(
            item("s-weg", 254469L, 2, "2026-09-01T10:00:00+00:00", deleted = true),
            item("s-anders", 230006L, 5, null),
        )
        assertEquals(SealedAddPlan.Insert(display, 1), SealedRepository.planAdd(live, display, 1))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `Anlegen mit Menge 0 wirft`() {
        SealedRepository.planAdd(emptyList(), display, 0)
    }

    @Test fun `neue Zeile traegt Name, Art und Startpreis aus der Produktliste`() {
        val body = SealedRepository.insertBody("u-1", display, 2, "2026-09-15T12:00:00Z")
        assertEquals("u-1", body.getString("sealed_id"))
        assertEquals(254469L, body.getLong("cm_product_id"))
        assertEquals("Metal Raiders Booster Box", body.getString("name"))
        assertEquals("display", body.getString("kind"))
        assertEquals(2, body.getInt("quantity"))
        assertEquals(499.29, body.getDouble("price"), 1e-9)
        assertEquals("2026-09-15T12:00:00Z", body.getString("price_updated_at"))
        assertFalse(body.has("deleted"))
        val none = SealedRepository.insertBody("u-2", noTrend, 1, "2026-09-15T12:00:00Z")
        assertTrue(none.isNull("price"))
        assertTrue(none.isNull("price_updated_at"))
    }

    @Test fun `Tageswert-Body mit sealed_value`() {
        val b = SnapshotsRepository.upsertBody(1008.5, 12, 998.5)
        assertEquals(1008.5, b.getDouble("total_value"), 1e-9)
        assertEquals(12, b.getInt("card_count"))
        assertEquals(998.5, b.getDouble("sealed_value"), 1e-9)
    }
}
```

`android/app/src/test/java/com/example/yugiohscanner/SealedSnapshotTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CacheState
import com.example.yugiohscanner.cloud.SealedItem
import com.example.yugiohscanner.ml.SealedSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Spec G3 §8: Tageswert nur mit an diesem Start geladener Sealed-Liste. */
class SealedSnapshotTest {
    private val display = SealedItem("s1", 254469L, "Metal Raiders Booster Box", "display", 2, 499.25, "2026-09-15T05:00:03+00:00")

    @Test fun `noch nie geladen oder ladend ohne Stand: kein Tageswert`() {
        assertNull(SealedSnapshot.decide(10.0, CacheState()))
        assertNull(SealedSnapshot.decide(10.0, CacheState(value = null, loading = true)))
    }

    @Test fun `Ladefehler ohne Stand: kein Tageswert`() {
        assertNull(SealedSnapshot.decide(10.0, CacheState(value = null, error = "Sealed-Bestand laden fehlgeschlagen (404)")))
    }

    @Test fun `Ladefehler an diesem Start mit altem Stand: kein Tageswert`() {
        assertNull(SealedSnapshot.decide(10.0, CacheState(value = listOf(display), error = "Sealed-Bestand laden fehlgeschlagen (500)")))
    }

    @Test fun `geladen und leer: Kartenwert, sealed 0`() {
        assertEquals(SealedSnapshot.Values(10.0, 0.0), SealedSnapshot.decide(10.0, CacheState(value = emptyList())))
    }

    @Test fun `geladen: Karten plus Sealed`() {
        assertEquals(SealedSnapshot.Values(1008.5, 998.5), SealedSnapshot.decide(10.0, CacheState(value = listOf(display))))
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest`
Expected: FAIL — `Unresolved reference: SealedRepository`, `SealedAddPlan`, `SealedSnapshot`, `upsertBody`.

- [ ] **Step 3: `cloud/SealedRepository.kt`**

```kotlin
package com.example.yugiohscanner.cloud

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** Spec G3 §4.1/§8 -- was "Hinzufuegen" in der Cloud tut. */
sealed interface SealedAddPlan {
    /** Lebende Zeile desselben Produkts: Menge auf [quantity] setzen. */
    data class Increase(val sealedId: String, val quantity: Int) : SealedAddPlan
    /** Neue Zeile mit Name, Art und Startpreis aus der Produktliste. */
    data class Insert(val product: CatalogSealedProduct, val quantity: Int) : SealedAddPlan
}

/**
 * Spec G3 §8 -- Sealed-Bestand ueber REST (supabase/sealed_items_schema.sql, ohne user_id wie card_copies).
 * Kleine Liste, voll neu geladen (SideStores.sealedItems). Nur Soft-Delete. Auth/Reauth wie ContainersRepository.
 */
object SealedRepository {
    const val SELECT = "sealed_id,cm_product_id,name,kind,quantity,price,price_updated_at,created_at,deleted"

    fun listParams(): List<Pair<String, String>> = listOf(
        "select" to SELECT, "deleted" to "eq.false", "order" to "created_at.asc,sealed_id.asc", "limit" to "1000",
    )

    /** Schreibziel: genau diese Zeile, und nur solange sie lebt. */
    fun liveRowParams(sealedId: String): List<Pair<String, String>> =
        listOf("sealed_id" to "eq.$sealedId", "deleted" to "eq.false")

    fun parse(text: String): List<SealedItem> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            SealedItem(
                sealedId = o.getString("sealed_id"),
                cmProductId = o.getLong("cm_product_id"),
                name = o.optString("name"),
                kind = o.optString("kind", "other"),
                quantity = o.getInt("quantity"),
                price = if (o.isNull("price")) null else o.getDouble("price"),
                priceUpdatedAt = if (o.isNull("price_updated_at")) null else o.getString("price_updated_at"),
                createdAt = if (o.isNull("created_at")) null else o.getString("created_at"),
                deleted = o.optBoolean("deleted", false),
            )
        }
    }

    /** Spec G3 §4.1: lebende Zeile mit gleicher cm_product_id -> Menge erhoehen (die aelteste, wie am Desktop), sonst neu. */
    fun planAdd(live: List<SealedItem>, product: CatalogSealedProduct, quantity: Int): SealedAddPlan {
        require(quantity >= 1) { "Die Menge muss mindestens 1 sein." }
        val existing = live
            .filter { !it.deleted && it.cmProductId == product.cmProductId }
            .sortedWith(compareBy<SealedItem>({ it.createdAt ?: "" }, { it.sealedId }))
            .firstOrNull()
        return if (existing != null) SealedAddPlan.Increase(existing.sealedId, existing.quantity + quantity)
        else SealedAddPlan.Insert(product, quantity)
    }

    /** Ohne deleted/created_at/updated_at: die Spalten haben Standardwerte, updated_at stempelt der Server. */
    fun insertBody(sealedId: String, product: CatalogSealedProduct, quantity: Int, nowIso: String): JSONObject = JSONObject()
        .put("sealed_id", sealedId)
        .put("cm_product_id", product.cmProductId)
        .put("name", product.name)
        .put("kind", product.kind)
        .put("quantity", quantity)
        .put("price", product.trend ?: JSONObject.NULL)
        .put("price_updated_at", if (product.trend != null) nowIso else JSONObject.NULL)

    suspend fun loadLive(): List<SealedItem> = parse(getText(listParams()))

    /** Laedt die lebenden Zeilen frisch, damit die Anlege-Entscheidung nicht auf einem alten Stand fusst. */
    suspend fun add(product: CatalogSealedProduct, quantity: Int) {
        when (val plan = planAdd(loadLive(), product, quantity)) {
            is SealedAddPlan.Increase ->
                patch(liveRowParams(plan.sealedId), JSONObject().put("quantity", plan.quantity), "Sealed hinzufügen")
            is SealedAddPlan.Insert ->
                post(insertBody(UUID.randomUUID().toString(), plan.product, plan.quantity, Instant.now().toString()), "Sealed hinzufügen")
        }
    }

    suspend fun setQuantity(sealedId: String, quantity: Int) {
        require(quantity >= 1) { "Die Menge muss mindestens 1 sein." }
        patch(liveRowParams(sealedId), JSONObject().put("quantity", quantity), "Menge speichern")
    }

    suspend fun delete(sealedId: String) {
        patch(liveRowParams(sealedId), JSONObject().put("deleted", true), "Löschen")
    }

    /** "Geoeffnet": Menge - 1; bei Menge 1 weich loeschen (die Oberflaeche fragt vorher). */
    suspend fun open(item: SealedItem) {
        if (item.quantity > 1) setQuantity(item.sealedId, item.quantity - 1) else delete(item.sealedId)
    }

    private fun url(params: List<Pair<String, String>>): HttpUrl =
        "${SupabaseCloud.base()}/rest/v1/sealed_items".toHttpUrl().newBuilder()
            .apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    private suspend fun getText(params: List<Pair<String, String>>): String = withContext(Dispatchers.IO) {
        executeWithReauth { base(url(params)).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("Sealed-Bestand laden fehlgeschlagen (${r.code}): $text")
            text
        }
    }

    private suspend fun patch(params: List<Pair<String, String>>, body: JSONObject, what: String) = withContext(Dispatchers.IO) {
        executeWithReauth {
            base(url(params)).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .patch(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err(what, r) }
    }

    private suspend fun post(body: JSONObject, what: String) = withContext(Dispatchers.IO) {
        executeWithReauth {
            base(url(emptyList())).addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "return=minimal")
                .post(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) err(what, r) }
    }

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url)
            .addHeader("apikey", SupabaseCloud.key())
            .addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

    private fun err(what: String, r: Response): Nothing =
        throw RuntimeException("$what fehlgeschlagen (${r.code}): ${r.body?.string()}")

    // Bei 401 (Token nach ~1 h abgelaufen) einmal neu anmelden und wiederholen.
    private suspend fun executeWithReauth(build: () -> Request): Response = withContext(Dispatchers.IO) {
        val first = SupabaseCloud.http().newCall(build()).execute()
        if (first.code != 401) return@withContext first
        first.close()
        SupabaseCloud.signIn()
        SupabaseCloud.http().newCall(build()).execute()
    }
}
```

- [ ] **Step 4: `ml/SealedSnapshot.kt`**

```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CacheState
import com.example.yugiohscanner.cloud.SealedItem

/**
 * Spec G3 §8 -- ob und mit welchen Werten der Start den Tageswert schreibt. Der Aufrufer laedt die
 * Sealed-Liste an diesem Start neu (refreshAndWait). Ohne geladene Liste oder mit Ladefehler an diesem Start
 * wird KEIN Tageswert geschrieben -- sonst stuende ein Tag ohne Sealed-Anteil im Wertverlauf.
 */
object SealedSnapshot {
    data class Values(val total: Double, val sealed: Double)

    fun decide(cardTotal: Double, sealed: CacheState<List<SealedItem>>): Values? {
        val items = sealed.value ?: return null
        if (sealed.error != null) return null
        val s = SealedValue.sealedValue(items)
        return Values(cardTotal + s, s)
    }
}
```

- [ ] **Step 5: `SnapshotsRepository.kt`**

`suspend fun upsertToday(totalValue: Double, cardCount: Int) = withContext(Dispatchers.IO) {` samt den beiden folgenden Zeilen
```kotlin
        val body = JSONObject()
            .put("total_value", totalValue).put("card_count", cardCount).toString()
```
ersetzen durch:
```kotlin
    // Spec G3 §4.2: total_value = Karten + Sealed, sealed_value = Sealed-Anteil.
    fun upsertBody(totalValue: Double, cardCount: Int, sealedValue: Double): JSONObject = JSONObject()
        .put("total_value", totalValue).put("card_count", cardCount).put("sealed_value", sealedValue)

    suspend fun upsertToday(totalValue: Double, cardCount: Int, sealedValue: Double) = withContext(Dispatchers.IO) {
        val body = upsertBody(totalValue, cardCount, sealedValue).toString()
```

- [ ] **Step 6: `SideStores.kt`**

Nach `val priceAlertTargets = ListCache(scope) { PriceAlertsRepository.loadTargets() }`:
```kotlin

    // Spec G3 §8: Sealed-Bestand. Kleine Liste, voll neu laden: beim Start, beim Vordergrund (AppNav, mit den
    // Preis-Alarmen), per Ziehen und nach eigenem Speichern (refreshAndWait).
    val sealedItems = ListCache(scope) { SealedRepository.loadLive() }
```
In `clearAll()` nach `priceAlertEvents.clear(); priceAlertMoveRule.clear(); priceAlertTargets.clear()`:
```kotlin
        sealedItems.clear()
```

- [ ] **Step 7: `AppNav.kt` — Vordergrund**

Den Block
```kotlin
                onEnter = {
                    SideStores.priceAlertEvents.refresh()
                    SideStores.priceAlertTargets.refresh()
                },
```
ersetzen durch:
```kotlin
                onEnter = {
                    SideStores.priceAlertEvents.refresh()
                    SideStores.priceAlertTargets.refresh()
                    SideStores.sealedItems.refresh()   // Spec G3 §8
                },
```

- [ ] **Step 8: `StartScreen.kt` — Tageswert erst mit Sealed-Liste**

Import nach `import com.example.yugiohscanner.ml.SnapshotSeries`:
```kotlin
import com.example.yugiohscanner.ml.SealedSnapshot
```
Im `LaunchedEffect(Unit)` die Zeilen
```kotlin
                val dash = withContext(Dispatchers.Default) { DashboardMemo.get(r.cards, r.copies) }
                // Record today's value + read the history for the chart. Non-fatal if the
                // portfolio_snapshots table isn't set up yet.
                SnapshotsRepository.upsertToday(dash.totalValue, dash.totalCards)
                val snaps = SideStores.snapshots
                if (snaps.state.value.value == null) snaps.refreshAndWait()
                else snaps.update { SnapshotSeries.withToday(it, UtcDay.today(), dash.totalValue) }
```
ersetzen durch:
```kotlin
                val dash = withContext(Dispatchers.Default) { DashboardMemo.get(r.cards, r.copies) }
                // Spec G3 §8: Tageswert = Karten + Sealed, erst mit an diesem Start geladener Sealed-Liste;
                // bei Ladefehler kein Tageswert. Den Verlauf fuer das Diagramm trotzdem laden.
                // Non-fatal if the portfolio_snapshots table isn't set up yet.
                SideStores.sealedItems.refreshAndWait()
                val values = SealedSnapshot.decide(dash.totalValue, SideStores.sealedItems.state.value)
                val snaps = SideStores.snapshots
                if (values != null) {
                    SnapshotsRepository.upsertToday(values.total, dash.totalCards, values.sealed)
                    if (snaps.state.value.value == null) snaps.refreshAndWait()
                    else snaps.update { SnapshotSeries.withToday(it, UtcDay.today(), values.total) }
                } else if (snaps.state.value.value == null) {
                    snaps.refreshAndWait()
                }
```
In `RefreshableBox(onRefresh = { … })` nach `SideStores.priceAlertTargets.refreshAndWait()`:
```kotlin
            SideStores.sealedItems.refreshAndWait()
```

- [ ] **Step 9: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, alle Tests grün (neu: `SealedRepositoryTest` 7, `SealedSnapshotTest` 5). Per Grep: `upsertToday(` hat keinen Aufrufer mit zwei Argumenten mehr.

- [ ] **Step 10: Schutz-Nachweis**

In `SealedSnapshot.decide` die Zeile `if (sealed.error != null) return null` kurz entfernen, `--tests "com.example.yugiohscanner.SealedSnapshotTest"` laufen lassen, den Fehlschlag von „Ladefehler an diesem Start mit altem Stand: kein Tageswert" (`expected null, but was:<Values(total=1008.5, sealed=998.5)>`) zitieren, Zeile wiederherstellen, Test wieder grün. Ebenso `val items = sealed.value ?: return null` kurz zu `val items = sealed.value ?: emptyList()` machen → „noch nie geladen …" scheitert; zurücknehmen.

- [ ] **Step 11: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/SealedRepository.kt android/app/src/main/java/com/example/yugiohscanner/ml/SealedSnapshot.kt android/app/src/test/java/com/example/yugiohscanner/SealedRepositoryTest.kt android/app/src/test/java/com/example/yugiohscanner/SealedSnapshotTest.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SnapshotsRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt
git commit -m "feat(g3): Handy laedt und schreibt Sealed-Bestand, Tageswert erst mit Sealed-Liste

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 11: Handy-Ansichten — Sammlung › Sealed, Produktsuche, Wert-Karte

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/SealedScreen.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/SealedSearchScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/SammlungScreen.kt` (ganze Datei)
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt` (`Routes`, `SammlungScreen`-Aufruf, neue Destination)
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt` (Import, Zustand, Wert-Karte)

**Interfaces:**
- Consumes (Task 1): `SealedValue.sortSealed/sealedValue/lineValue/isPriceStale/kindLabel`; (Task 9) `CatalogRepository.sealedProductCount/searchSealed`, `CatalogSealedProduct`; (Task 10) `SealedRepository.add/setQuantity/delete/open`, `SideStores.sealedItems`.
- Produces: `SealedScreen(onOpenScan: () -> Unit, onOpenSuche: () -> Unit)`, `SealedSearchScreen(onClose: () -> Unit)`, `Routes.SEALED_SUCHE = "sammlung/sealed/suche"`, Segment-ID `sealed`.

Keine Compose-UI-Tests im Projekt; Prüfung per Build. Alle Listen und Platzhalter in `LazyColumn` (Pull-to-refresh), Summen und Veraltung per `remember`.

- [ ] **Step 1: `ui/SealedScreen.kt`**

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.SealedItem
import com.example.yugiohscanner.cloud.SealedRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.SealedValue
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.launch

private const val SEALED_LOAD_ERROR = "Sealed-Bestand konnte nicht geladen werden — zum Aktualisieren ziehen"

/** Was nach einer Rueckfrage passieren soll. */
private enum class SealedConfirm { OPEN_LAST, DELETE }

/**
 * Spec G3 §8 -- Sammlung › Sealed. Liste aus SideStores.sealedItems, Schreiben per REST (SealedRepository),
 * danach refreshAndWait. Reihenfolge, Summen und "Preis veraltet" aus ml/SealedValue (Zwilling des Desktops).
 */
@Composable
fun SealedScreen(onOpenScan: () -> Unit, onOpenSuche: () -> Unit) {
    val scope = rememberCoroutineScope()
    val cache by SideStores.sealedItems.state.collectAsState()
    val rows = remember(cache.value) { cache.value?.let { SealedValue.sortSealed(it) } }
    val total = remember(cache.value) { cache.value?.let { SealedValue.sealedValue(it) } }
    // "jetzt" und die Veraltung nur neu, wenn sich die Liste aendert -- nicht bei jeder Komposition.
    val staleIds = remember(cache.value) {
        val now = System.currentTimeMillis()
        cache.value.orEmpty().filter { it.price != null && SealedValue.isPriceStale(it.priceUpdatedAt, now) }
            .map { it.sealedId }.toSet()
    }
    var busy by remember { mutableStateOf(false) }
    var writeError by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<Pair<SealedItem, SealedConfirm>?>(null) }
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(Unit) { SideStores.sealedItems.refresh() }

    fun write(block: suspend () -> Unit, afterSuccess: () -> Unit = {}) {
        scope.launch {
            busy = true
            try {
                block()
                writeError = null
                afterSuccess()
            } catch (e: Exception) {
                writeError = e.message ?: "Speichern fehlgeschlagen"
            } finally {
                SideStores.sealedItems.refreshAndWait()
                busy = false
            }
        }
    }

    // Eigener launch: showSnackbar haelt an, bis der Schnipsel verschwindet (wie in SortIntoBinderScreen).
    fun showOpened() {
        scope.launch {
            val r = snackbar.showSnackbar(message = "Geöffnet", actionLabel = "Jetzt scannen", duration = SnackbarDuration.Short)
            if (r == SnackbarResult.ActionPerformed) onOpenScan()
        }
    }

    fun open(item: SealedItem) {
        if (item.quantity > 1) write({ SealedRepository.open(item) }, { showOpened() })
        else confirm = item to SealedConfirm.OPEN_LAST
    }

    fun minus(item: SealedItem) {
        if (item.quantity > 1) write({ SealedRepository.setQuantity(item.sealedId, item.quantity - 1) })
        else confirm = item to SealedConfirm.DELETE
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    SectionHeader("Sealed-Wert")
                    if (total != null) ValueText(total, style = MaterialTheme.typography.titleLarge)
                    else Text("…", style = MaterialTheme.typography.titleLarge, color = Muted)
                }
                Button(onClick = onOpenSuche, enabled = !busy) {
                    Icon(Icons.Default.Add, null)
                    Spacer(Modifier.width(4.dp))
                    Text("Hinzufügen")
                }
            }
            writeError?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall)
            }
            if (cache.error != null && rows != null) {
                // Spec G3 §9: letzter Stand bleibt sichtbar, mit Hinweis.
                Spacer(Modifier.height(6.dp))
                Text(SEALED_LOAD_ERROR, color = ErrorColor, style = MaterialTheme.typography.labelSmall)
            }
            Spacer(Modifier.height(12.dp))
            when {
                rows == null && cache.error == null -> LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = Primary)
                        }
                    }
                }
                rows == null -> LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            Text(SEALED_LOAD_ERROR, color = ErrorColor)
                        }
                    }
                }
                rows.isEmpty() -> LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            Text("Noch kein Sealed-Bestand", color = Muted)
                        }
                    }
                }
                else -> LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(rows, key = { it.sealedId }) { item ->
                        SealedRow(
                            item = item,
                            stale = item.sealedId in staleIds,
                            enabled = !busy,
                            onPlus = { write({ SealedRepository.setQuantity(item.sealedId, item.quantity + 1) }) },
                            onMinus = { minus(item) },
                            onOpen = { open(item) },
                            onDelete = { confirm = item to SealedConfirm.DELETE },
                        )
                    }
                }
            }
        }
        SnackbarHost(hostState = snackbar, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp))
    }

    confirm?.let { (item, kind) ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (kind == SealedConfirm.OPEN_LAST) "Letztes Exemplar geöffnet?" else "„${item.name}“ löschen?") },
            text = {
                Text(
                    if (kind == SealedConfirm.OPEN_LAST) "„${item.name}“ wird aus dem Sealed-Bestand entfernt."
                    else "Der Eintrag wird aus dem Sealed-Bestand entfernt.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    if (kind == SealedConfirm.OPEN_LAST) write({ SealedRepository.open(item) }, { showOpened() })
                    else write({ SealedRepository.delete(item.sealedId) })
                }) { Text("Entfernen", color = ErrorColor) }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun SealedRow(
    item: SealedItem,
    stale: Boolean,
    enabled: Boolean,
    onPlus: () -> Unit,
    onMinus: () -> Unit,
    onOpen: () -> Unit,
    onDelete: () -> Unit,
) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(SealedValue.kindLabel(item.kind), style = MaterialTheme.typography.labelSmall, color = Muted)
                    Text(item.name, style = MaterialTheme.typography.bodyMedium, color = OnSurface,
                        fontWeight = FontWeight.SemiBold, maxLines = 2)
                }
                IconButton(onClick = onDelete, enabled = enabled) { Icon(Icons.Default.Delete, "Löschen", tint = ErrorColor) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onMinus, enabled = enabled) { Icon(Icons.Default.Remove, "Menge verringern", tint = OnSurface) }
                Text("${item.quantity}", style = MaterialTheme.typography.titleMedium, color = OnSurface)
                IconButton(onClick = onPlus, enabled = enabled) { Icon(Icons.Default.Add, "Menge erhöhen", tint = OnSurface) }
                Spacer(Modifier.weight(1f))
                Column(horizontalAlignment = Alignment.End) {
                    Text(item.price?.let { "je %.2f €".format(it) } ?: "je —",
                        style = MaterialTheme.typography.labelSmall, color = Muted)
                    if (stale) Text("Preis veraltet", style = MaterialTheme.typography.labelSmall, color = Gold)
                    ValueText(SealedValue.lineValue(item), style = MaterialTheme.typography.bodyMedium)
                }
            }
            TextButton(onClick = onOpen, enabled = enabled) { Text("Geöffnet") }
        }
    }
}
```

- [ ] **Step 2: `ui/SealedSearchScreen.kt`**

```kotlin
package com.example.yugiohscanner.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CatalogSealedProduct
import com.example.yugiohscanner.cloud.SealedRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ml.SealedValue
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.components.ValueText
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Spec G3 §8 -- Suche in `sealed_products` (catalog.db), Treffer mit Name, Art und Trend; Menge; "Hinzufuegen".
 * Leere Tabelle (Katalog von vor G3 oder noch nie geladen): Hinweis auf die Einstellungen.
 */
@Composable
fun SealedSearchScreen(onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<CatalogSealedProduct>?>(null) }
    var available by remember { mutableStateOf<Boolean?>(null) }
    var selected by remember { mutableStateOf<CatalogSealedProduct?>(null) }
    var quantity by remember { mutableStateOf("1") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // SQLite nie aus der Komposition lesen (wie catalogReady in StartScreen).
    LaunchedEffect(Unit) {
        available = withContext(Dispatchers.IO) {
            runCatching { CatalogRepository.sealedProductCount() > 0 }.getOrDefault(false)
        }
    }

    BackHandler(selected != null) { selected = null; error = null }

    Column(Modifier.fillMaxSize().padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { if (selected != null) { selected = null; error = null } else onClose() }) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück")
            }
            Text("Sealed hinzufügen", style = MaterialTheme.typography.titleLarge)
        }

        val product = selected
        if (product != null) {
            SpaceCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(product.name, style = MaterialTheme.typography.titleMedium, color = OnSurface)
                    Text(SealedValue.kindLabel(product.kind), style = MaterialTheme.typography.labelSmall, color = Muted)
                    ValueText(product.trend, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = quantity, onValueChange = { quantity = it.filter(Char::isDigit) },
                label = { Text("Menge") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.width(140.dp),
            )
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(12.dp))
            Button(enabled = !busy, onClick = {
                val qty = quantity.toIntOrNull()
                if (qty == null || qty < 1) {
                    error = "Die Menge muss mindestens 1 sein."
                } else {
                    busy = true
                    scope.launch {
                        try {
                            SealedRepository.add(product, qty)
                            SideStores.sealedItems.refreshAndWait()
                            onClose()
                        } catch (e: Exception) {
                            error = e.message ?: "Speichern fehlgeschlagen"
                        }
                        busy = false
                    }
                }
            }) { Text(if (busy) "Wird gespeichert…" else "Hinzufügen") }
        } else {
            if (available == false) {
                Text("Produktliste noch nicht geladen — Katalog in den Einstellungen prüfen",
                    color = ErrorColor, style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(8.dp))
            }
            OutlinedTextField(query, { query = it }, label = { Text("Produktname") },
                singleLine = true, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            Button(enabled = !busy && query.isNotBlank() && available == true, onClick = {
                busy = true
                scope.launch {
                    results = try {
                        error = null
                        withContext(Dispatchers.IO) { CatalogRepository.searchSealed(query) }
                    } catch (e: Exception) {
                        error = e.message ?: "Suche fehlgeschlagen"
                        null
                    }
                    busy = false
                }
            }) { Text(if (busy) "Suche…" else "Suchen") }
            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
            results?.let { list ->
                if (list.isEmpty()) {
                    Text("Keine Treffer", color = Muted, style = MaterialTheme.typography.bodySmall)
                } else {
                    LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(list, key = { it.cmProductId }) { p ->
                            SpaceCard(Modifier.fillMaxWidth().clickable { error = null; quantity = "1"; selected = p }) {
                                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(p.name, style = MaterialTheme.typography.bodyMedium, color = OnSurface, maxLines = 2)
                                        Text(SealedValue.kindLabel(p.kind), style = MaterialTheme.typography.labelSmall, color = Muted)
                                    }
                                    ValueText(p.trend, style = MaterialTheme.typography.bodyMedium)
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

- [ ] **Step 3: `ui/SammlungScreen.kt` ersetzen**

```kotlin
package com.example.yugiohscanner.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.ui.components.RefreshableBox
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary

// Karten · Binder · Wunschliste · Sets · Decks · Sealed -- the two most-used segments lead (Spec §11),
// Sealed (Spec G3 §8) comes last.
private val SEGMENTS = listOf(
    "karten" to "Karten",
    "binder" to "Binder",
    "wunschliste" to "Wunschliste",
    "sets" to "Sets",
    "decks" to "Decks",
    "sealed" to "Sealed",
)

// Everything that is "my collection" lives on one tab; the tabs swap the content below.
// Five segments no longer fit un-scrolled (Spec §11 risk) -- ScrollableTabRow instead of a
// plain Row, so nothing gets cut off on narrow screens.
@Composable
fun SammlungScreen(
    segment: String,
    onSegment: (String) -> Unit,
    onOpenSuche: () -> Unit,
    onOpenBehaelter: (String) -> Unit,
    onOpenScan: () -> Unit,
    onOpenSealedSuche: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Text("Sammlung", style = MaterialTheme.typography.headlineSmall, color = OnSurface,
            modifier = Modifier.padding(start = 16.dp, top = 12.dp))
        SyncHint(Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        val selected = SEGMENTS.indexOfFirst { it.first == segment }.coerceAtLeast(0)
        ScrollableTabRow(
            selectedTabIndex = selected,
            containerColor = Background,
            contentColor = Primary,
            edgePadding = 16.dp,
        ) {
            SEGMENTS.forEachIndexed { i, (id, label) ->
                Tab(selected = i == selected, onClick = { onSegment(id) }, text = { Text(label) })
            }
        }
        RefreshableBox(
            onRefresh = {
                when (segment) {
                    "wunschliste" -> SideStores.wishlist.refreshAndWait()
                    "decks" -> SideStores.decks.refreshAndWait()
                    "sets" -> { CollectionStore.awaitSync(); SideStores.sets.refreshAndWait() }
                    "sealed" -> SideStores.sealedItems.refreshAndWait()
                    else -> CollectionStore.awaitSync()
                }
            },
            modifier = Modifier.weight(1f),
        ) {
            when (segment) {
                "binder" -> BindersScreen(onOpenBehaelter)
                "wunschliste" -> WishlistScreen()
                "sets" -> SetCompletionScreen()
                "decks" -> DecksScreen()
                "sealed" -> SealedScreen(onOpenScan = onOpenScan, onOpenSuche = onOpenSealedSuche)
                else -> CollectionScreen(onOpenSuche = onOpenSuche)
            }
        }
    }
}
```

- [ ] **Step 4: `ui/AppNav.kt` — Route und Destination**

In `object Routes` nach `const val SUCHE = "suche"`:
```kotlin
    // Spec G3 §8: Suche in der Sealed-Produktliste. Unter "sammlung/", damit die untere Leiste Sammlung
    // markiert; drei Segmente mit "sealed" als zweitem kollidieren weder mit "sammlung/{segment}" noch mit
    // "sammlung/binder/{containerId}".
    const val SEALED_SUCHE = "sammlung/sealed/suche"
```
Im `SammlungScreen(`-Aufruf nach `onOpenBehaelter = { nav.navigate(Routes.behaelter(it)) },`:
```kotlin
                    onOpenScan = { nav.navigate(Routes.SCAN) { launchSingleTop = true } },
                    onOpenSealedSuche = { nav.navigate(Routes.SEALED_SUCHE) },
```
Nach dem Block `composable(Routes.SUCHE) { … }`:
```kotlin
            composable(Routes.SEALED_SUCHE) {
                if (cloudReady) SealedSearchScreen(onClose = { nav.popBackStack() })
                else CloudLoginScreen(prefs) { resetSession(); cloudReady = true }
            }
```

- [ ] **Step 5: `ui/StartScreen.kt` — Wert-Karte**

Import nach `import com.example.yugiohscanner.ml.SealedSnapshot`:
```kotlin
import com.example.yugiohscanner.ml.SealedValue
```
Nach `val snapshots = snapshotsCache.value ?: emptyList()`:
```kotlin
    // Spec G3 §8: Sealed-Anteil des Gesamtwerts; die Summe nur neu, wenn sich die Liste aendert.
    val sealedCache by SideStores.sealedItems.state.collectAsState()
    val sealedTotal = remember(sealedCache.value) { sealedCache.value?.let { SealedValue.sealedValue(it) } }
```
In der Wert-Karte den Block von `val dash = d` bis einschließlich des `else { … "Wert wird berechnet …" … }`-Zweigs ersetzen durch:
```kotlin
                    val dash = d
                    // Spec G3 §8: solange die Sealed-Liste noch nie geladen wurde, zeigt die Karte den Ladezustand.
                    val sealedLoading = sealedCache.value == null && sealedCache.error == null
                    if (dash != null && !sealedLoading) {
                        val total = dash.totalValue + (sealedTotal ?: 0.0)
                        Text("%.2f €".format(total), style = MaterialTheme.typography.displaySmall,
                            fontFamily = MonoFontFamily, fontWeight = FontWeight.Bold, color = Gold)
                        Text("${dash.totalCards} Karten · ${dash.entries} Einträge",
                            style = MaterialTheme.typography.bodySmall, color = Muted)
                        if (sealedTotal == null) {
                            // Ladefehler ohne frueheren Stand: nur der Kartenwert, mit Hinweis (kein Tageswert, Task 10).
                            Text("Sealed-Wert nicht geladen — zum Aktualisieren ziehen",
                                style = MaterialTheme.typography.labelSmall, color = ErrorColor)
                        } else if (sealedCache.value?.isNotEmpty() == true) {
                            Text("Karten %.2f € · Sealed %.2f €".format(dash.totalValue, sealedTotal),
                                style = MaterialTheme.typography.bodySmall, color = Muted)
                        }
                        if (windowSnaps.size >= 2) {
                            val startVal = windowSnaps.firstOrNull()?.totalValue ?: total
                            val change = total - startVal
                            val changePct = if (startVal > 0) change / startVal * 100 else 0.0
                            val up = change >= 0
                            Text(
                                "${if (up) "+" else ""}%.2f € (%.1f%%)".format(change, changePct),
                                style = MaterialTheme.typography.bodyMedium,
                                fontFamily = MonoFontFamily, color = if (up) Good else ErrorColor,
                            )
                        }
                    } else {
                        // Review-Fund 2: kein Nullwert-Platzhalter, der wie eine leere Sammlung
                        // aussieht -- echter Ladehinweis im selben Textslot wie der Wert, damit
                        // die Karte in etwa ihre Hoehe behaelt.
                        Text("Wert wird berechnet …", style = MaterialTheme.typography.displaySmall,
                            fontFamily = MonoFontFamily, fontWeight = FontWeight.Bold, color = Muted)
                    }
```

- [ ] **Step 6: Build und Tests**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, alle Tests grün. Per Grep: kein sichtbarer Text „Unknown" oder „Taschen" in `SealedScreen.kt`/`SealedSearchScreen.kt`; `SammlungScreen(` hat nur den einen Aufrufer in `AppNav.kt`.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/SealedScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SealedSearchScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SammlungScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt
git commit -m "feat(g3): Sealed-Bestand am Handy mit Suche, Geoeffnet-Snackbar und Gesamtwert

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Controller-Abschluss (kein Subagent)

- [ ] **Gesamtlauf:** Deno (`deno test --allow-read --node-modules-dir=none supabase/functions/` und `deno check --node-modules-dir=none supabase/functions/refresh-cardmarket-prices/index.ts`), Desktop SQLite-Suite, `electron/test-sync.cjs`, Desktop-Helfer, Lint genau 5, `npx vite build`, Android `testDebugUnitTest assembleDebug compileDebugAndroidTestKotlin`. Zahlen im Ledger festhalten (Android aus `android/app/build/test-results/testDebugUnitTest/*.xml`). `deno.lock` nicht stagen.
- [ ] **Abschlussreview** mit dem besten Modell über den gesamten Zweig (`review-package` Basis = Plan-Commit), danach eine Fix-Welle und ein scoped Re-Review. Besonders prüfen: Echo-Verhalten des Sealed-Stroms (eine gezogene Preisänderung wird genau einmal zurückgeschoben, nicht endlos), `price_updated_at`-Umformung in beide Richtungen, kein `Date.now()` im Render.
- [ ] **Übergabe an den Nutzer, in dieser Reihenfolge (Spec §11):**
  1. `supabase/sealed_items_schema.sql` im Dashboard einspielen (Tabelle, Trigger, RLS, RPC `apply_cardmarket_sealed_prices`).
  2. Aus dem Repo-Stammverzeichnis (nach dem Merge oder aus dem Worktree): `supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn`.
  3. Desktop-Installer bauen und installieren — **nicht** aus dem Worktree mit Junction-`node_modules` (vorher durch `robocopy`-Kopie ersetzen oder nach dem Merge im Hauptcheckout bauen). Stiller NSIS-Installer `/S` startet die App selbst. Danach in den Einstellungen „Cardmarket-Preise aktualisieren" und „Katalog jetzt bauen" (Ergebnis zeigt `sealed` > 0).
  4. Erst danach die APK auf beide Handys (adb). `connectedDebugAndroidTest` dort nie ausführen.
- [ ] **Abnahme** (Checkliste im Ledger):
  - Handy: Sammlung › Sealed → „Hinzufügen" → Suche „Booster Box" liefert Treffer mit Art und Trend (Katalog-v2-Import und -Suche am Gerät); ein Display mit Menge 2 anlegen.
  - Desktop: nach ≤ 20 s erscheint das Display in Sammlung › Sealed mit Preis (spätestens nach dem nächsten Preislauf); Start zeigt „Karten … € · Sealed … €"; Gesamtwert auf Start und in Insights › Wert steigt um genau 2 × Preis.
  - Handy: Start zeigt denselben Gesamtwert (nach Ziehen), Unterzeile wie Desktop; während die Sealed-Liste lädt, „Wert wird berechnet …".
  - Desktop: dasselbe Produkt noch einmal hinzufügen → Menge 3 in derselben Zeile.
  - „Geöffnet" am Handy → Menge 2, Snackbar „Geöffnet" mit „Jetzt scannen" öffnet den Scanner; am Desktop → Menge 1 mit Hinweis „Geöffnet — Jetzt scannen"; noch einmal → Rückfrage, danach Zeile weg (Soft-Delete, Supabase-Zeile `deleted = true`).
  - Produkt ohne Trend zeigt „—" und zählt nicht; ein von Hand auf ein altes `price_updated_at` gesetzter Eintrag zeigt „Preis veraltet".
  - Ohne Cardmarket-Cache (Testprofil) zeigt der Desktop-Dialog „Produktliste nicht verfügbar — Cardmarket-Preise einmal aktualisieren."
  - `portfolio_snapshots` und `portfolio_history` des Tages tragen `sealed_value`.
- [ ] **Merge-Frage** an den Nutzer.

---

## Selbstprüfung

**Spec-Abdeckung:**

| Spec | Umsetzung |
|---|---|
| §1 Änderungen gegenüber Spec G (kein Freitext, `kind` aus Kategorie, keine Historie, Segment in der Sammlung, Handy `ListCache`, Desktop vierter Strom, Snackbar/Inline-Hinweis) | Tasks 3, 5, 6, 7, 8, 10, 11 |
| §2 Umfang, „Nicht drin", Erfolgskriterium | Global Constraints; Abnahme in Task 12 |
| §3 Produktliste: Build aus dem Cache, `trend`, Art-Zuordnung (einzige Stelle), fehlender Cache → `[]` | Task 5 (`sealedKindOf`, `buildSealedProducts`, `sealedProductsForCatalog`) |
| §3 Handy `CatalogDb` v2, `onUpgrade`, Import, Suche (escaptes LIKE, 50, nach Name) | Task 9 |
| §4.1 Tabelle SQLite/Supabase, Checks, ohne `user_id`, RLS, Zusammenlegen, Soft-Delete, „Geöffnet" bis 1 | Task 3 (Cloud), Task 6 (Desktop), Task 10 (`planAdd`, `open`) |
| §4.2 Tageswert mit `sealed_value` | Task 7 (Desktop `recordPortfolioValue`, `syncSnapshot`), Task 10 (Handy) |
| §5 Trend-Regel (Zwilling), Bulk-Schritt C, Cloud-RPC, „Preis veraltet" | Task 2, Task 6, Tasks 3–4, Task 1 |
| §6 `sealedValue`, `isPriceStale`, Art-Bezeichnungen (Zwilling), Gesamtwert auf beiden Geräten | Task 1, Task 7/8 (Desktop), Task 11 (Handy) |
| §7.1 Sync-Strom, Reihenfolge, fehlende Tabelle nicht fatal, `sealed-changed` | Task 7 |
| §7.2 IPC-Kanäle in `main.cjs` und `preload.cjs` | Task 8 |
| §7.3 Sammlung › Sealed, Dialog, Hinweis ohne Cache, Start-Unterzeile, Insights › Wert | Task 8 |
| §8 Handy Repository, `SideStores`, Nachladen, Sealed-Seite, Suche, Start, Tageswert-Schutz | Tasks 10 und 11 |
| §9 Fehlerfälle | Task 4 (Tabelle fehlt, Cloud), Task 7 (Desktop-Zyklus), Task 8/11 („—", Ladefehler mit Hinweis), Task 11 (leere Produkttabelle) |
| §10 Tests | Task 5 (Art-Zuordnung, `sealed_products`, fehlender Cache), Task 2 (Trend Deno/Node), Task 1 (Wert JS/Kotlin), Tasks 6–7 (SQLite: Checks, Zusammenlegen, Geöffnet, Sync, Tageswert), Tasks 9–10 (Handy: Abfragen, Anlege-Entscheidung, `CatalogDb` v2, Tageswert-Schutz mit Schutz-Nachweis); Lint in Task 8 |
| §11 Einspielen | Task 12 |

**Platzhalter-Suche:** Kein „TBD", kein „wie in Task N", kein „Fehlerbehandlung ergänzen"; jeder Code-Schritt enthält den vollständigen Code, jeder Test konkrete Werte (Beträge nachgerechnet: 2 × 499,25 + 34,5 = 1033; 20 × 34,22 = 684,4; 2 × 499,29 = 998,58; 10 + 998,58 = 1008,58; 2 × 499,25 = 998,5).

**Namens- und Typkonsistenz:** JS `sealedValue`, `lineValue`, `isPriceStale`, `kindLabel`, `sortSealed`, `toUtcMillis`, `SEALED_KINDS` (Task 1) ↔ Kotlin gleichnamig in `SealedValue` · `trendById`, `pickSealedUpdates` (Task 2, Deno und Node) · `sealedKindOf`, `buildSealedProducts`, `packCatalog(cards, version, sealedProducts)` (Task 5) · `readSealedProducts`, `sealedProductsForCatalog`, `searchSealedProducts` (Task 5 → 8) · `SealedError`, `SEALED_COLS`, `ensureSealedSchema`, `listSealed`, `addSealed(db, product, quantity)`, `setSealedQuantity(db, { sealed_id, quantity })`, `openSealed`, `deleteSealed`, `applySealedPrices` (Task 6 → 7/8) · `portfolioTotals → { cards, sealed, total, sealedCount }` (Task 7 → 8) · IPC `sealed-list`, `sealed-add`, `sealed-set-quantity`, `sealed-open`, `sealed-delete`, `sealed-products-search`, Ereignis `sealed-changed` ↔ `window.api.listSealed/addSealed/setSealedQuantity/openSealed/deleteSealed/searchSealedProducts/onSealedChanged` · Kotlin `SealedItem` (Task 1), `CatalogSealedProduct`, `CatalogDb.VERSION`, `CatalogRepository.sealedProductCount/searchSealed/sealedSearchQuery` (Task 9), `SealedAddPlan`, `SealedRepository.listParams/liveRowParams/parse/planAdd/insertBody/loadLive/add/setQuantity/delete/open`, `SideStores.sealedItems`, `SealedSnapshot.decide/Values`, `SnapshotsRepository.upsertBody/upsertToday(total, cardCount, sealed)` (Task 10 → 11) · `Routes.SEALED_SUCHE`, `SealedScreen(onOpenScan, onOpenSuche)`, `SealedSearchScreen(onClose)` (Task 11). Spalten `sealed_id, cm_product_id, name, kind, quantity, price, price_updated_at, created_at, updated_at, deleted` gleich in SQL (Task 3), SQLite (Task 6), Sync (Task 7) und REST (Task 10); RPC-Elemente `{ id_product, trend }` gleich in SQL und `index.ts`.

