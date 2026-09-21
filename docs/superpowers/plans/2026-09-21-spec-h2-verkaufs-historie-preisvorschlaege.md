# Spec H2 Verkaufs-Historie & Preisvorschläge — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verkäufe (eine oder mehrere Karten, Kanal, Datum, Preis, Gebühren, Versand) auf PC und Handy buchen, bearbeiten, teilweise zurücknehmen und stornieren; Übersicht „Verkäufe" unter Insights; Abschnitt „Verkauft" in der Kartenansicht; danach (H2b) Preisvorschlag je Exemplar an vier Stellen.

**Architecture:** Drei neue Tabellen (`sale_channels`, `sales`, `sale_items`) plus `card_copies.sold_in`, lokal in SQLite und in Supabase. Der PC bucht in einer lokalen Transaktion und synchronisiert die drei Tabellen als neue Ströme nach dem Sealed-Muster (G3); das Handy bucht über drei Supabase-Datenbankfunktionen (`book_sale`, `update_sale`, `cancel_sale`), jede eine Transaktion. Alle Rechenregeln (Marktwert, Verteilung mit Rest-Cent, Kennzahlen, Doppelverkauf, Preisvorschlag) wohnen in reinen Zwillingen: `desktop/electron/sales-math.cjs` (Hauptprozess, maßgeblich), `desktop/src/utils/saleMath.js` (Renderer: Dialog-Vorschau, Vorschlag) und `android/.../ml/SalesMath.kt`, alle gegen `docs/fixtures/sales/sales.json`.

**Tech Stack:** Electron CJS + better-sqlite3, React/Vite + Tailwind + recharts, Postgres/PostgREST (plpgsql), Kotlin/Compose (Material3), OkHttp + org.json, JUnit4.

**Spec:** `docs/superpowers/specs/2026-09-21-spec-h2-verkaufs-historie-preisvorschlaege.md` (Commit `b193d4e`). Setzt H1 (`92ae4e0`) voraus.

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus, verbinden sich nie mit Supabase und rufen keine Edge Functions auf. SQL liefert der Plan nur als Datei; der Nutzer spielt sie von Hand ein.
- Immer explizite Pfade stagen, nie `git add -A`, NIE `git stash` (auch nicht für Schutz-Nachweise: per Edit sabotieren, Fehlschlag zitieren, per Edit zurücknehmen).
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI).
- `cards.quantity`, `cards.deleted`, `cards.price_first_ed` schreibt die App nie. Nur Soft-Delete — auch für Verkäufe, Positionen und Kanäle.
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs` (und in `ipc-channels.test.cjs`).
- Sichtbare Texte deutsch mit echten Umlauten, „Fächer" statt „Taschen".
- Regeln wohnen in reinen, getesteten Helfern. Absichtliche Zwillinge im Kopfkommentar markieren (mit Nennung der anderen Fassungen) und gegen die gemeinsame Fixture testen.
- Geld wird in den Zwillingen **in ganzen Cent** gerechnet. JS `Math.round`, Kotlin `java.lang.Math.round` (nie `kotlin.math.round`), beide rechnen denselben Ausdruck in derselben Reihenfolge.
- Kein `(?U)` und keine anderen JVM-only-Regex-Kennzeichen im Android-Code (`AndroidRegexWaechterTest`).
- Leere Strings werden wie `null` behandelt.
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`). Ein sechster ist ein Fehlschlag.
- Ein Schutz-Test muss nachweislich ohne den Schutz scheitern (sabotieren, Fehlschlag zitieren, zurücknehmen).
- Handy-Mutationen laufen durch `InFlight` und lesen den frischen Stand innerhalb der Mutation. PC-Schreibaktionen durch `createBusyGate()`.
- Ein Platzhalter sieht nie wie eine leere Liste aus: solange geladen wird, steht „…", nie „0 Verkäufe" oder „0,00 €".
- `react-hooks/set-state-in-effect`: kein synchrones setState im Effekt-Körper. `react-hooks/purity`: kein `Date.now()`/`new Date()` im Render — „heute" in Handlern oder per `useState(() => …)`.
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Neue Commits, nie `--amend`.
- H2-spezifisch nicht drin (Spec §2/§3): Marktplatz-Anbindung (H3), Einkaufspreise, Karten nachträglich zu einem Verkauf hinzufügen, Storno rückgängig machen, Sync der Vorschlags-Einstellungen, Preisvorschlag nach Tiefstpreis.

**Befehle:**
- Desktop SQLite-Suite (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Desktop Sync-Skript (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
- Desktop-Helfer (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs`
- Desktop-Lint (in `desktop/`): `npx eslint .` → genau `5 errors`
- Desktop-Build (in `desktop/`): `npx vite build`
- Android (Repo-Wurzel): `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`; Testzahl = Summe der `tests=`-Attribute in `android/app/build/test-results/testDebugUnitTest/*.xml`.

Vor Task 1 misst der Controller die Ausgangszahlen auf `main` (SQLite-Suite, Helfer, Lint, Android-Tests) und trägt sie in den Bericht ein; jeder Task nennt danach seine Zahlen.

## Abweichungen von der Spec (bitte dem Nutzer vorlegen)

1. **Momentaufnahme in `sale_items`** (Spec §4.1 nennt nur `value_at_sale`, `share`, `was_for_sale`): Jede Position speichert zusätzlich `card_id, set_code, language, rarity, edition, condition, name, image_url` zum Zeitpunkt des Verkaufs. Grund: Der Handy-Speicher lädt nur lebende Exemplare und lebende Drucke. Ein verkauftes Exemplar (und oft sein Druck) ist dort nicht mehr vorhanden, und die Übersicht könnte weder Name noch Bild zeigen. Mit der Momentaufnahme lesen beide Geräte die Übersicht allein aus `sales` + `sale_items`.
2. **Doppelverkauf und Rückkehr** (präzisiert Spec §6.3/§8): Nimmt ein Storno oder eine Teil-Rückgabe eine Position heraus, kehrt ihr Exemplar nur zurück, wenn `sold_in` auf **diesen** Verkauf zeigt. Beansprucht ein anderer aktiver Verkauf dasselbe Exemplar noch mit einer lebenden Position, wandert `sold_in` dorthin, und das Exemplar bleibt verkauft. Sonst würde das Stornieren des einen Doppelverkaufs eine Karte zurückbringen, die im anderen noch verkauft ist.
3. **Kennzahlen bei Doppelverkauf:** Netto und Marktwert eines Verkaufs sind die Summe über **gezählte** Positionen (lebend, Exemplar zeigt mit `sold_in` auf diesen Verkauf). Ohne Doppelverkauf ist das exakt das Netto des Verkaufs.
4. **Handy offline** (Spec §8 „gesperrt"): Das Handy hat keinen Netzstatus. Die Sperre hängt am Verkaufs-Speicher: Buchen, Bearbeiten und Storno sind gesperrt, solange die Verkäufe nicht geladen sind oder das letzte Laden scheiterte („Keine Verbindung – Verkäufe nicht geladen"). Scheitert der Aufruf trotzdem, bucht die Datenbankfunktion nichts (eine Transaktion), und die Meldung sagt das.
5. **Abschlag als ganze Prozentzahl 0–90** (Spec §9 nennt nur „Standard 5 %"), Mindestpreis 0,00–100,00 €. Ungültige Eingaben fallen auf die Standardwerte zurück.
6. **Export (H2b):** Die Preisspalte der Verkaufsliste (`saleListText`) zeigt den **Preisvorschlag** statt des Marktwerts, die Summenzeile die Summe der Vorschläge. Ein Exemplar ohne Vorschlag erscheint wie bisher mit „ohne Preis". Der Export ist eine Liste zum Anbieten, also gehört dort der Angebotspreis hin.
7. **Reihenfolge der Ströme:** Verkäufe, Positionen und Kanäle werden nach den Exemplaren gezogen und geschoben (`pullSalesSafe` / `pushSalesSafe`). Fehlt die Cloud-Tabelle noch, bricht nur dieser Strom ab, wie bei Sealed.

## SQL — Reihenfolge ist Pflicht

`supabase/sales_schema.sql` (Task 3) muss der Nutzer einspielen, **bevor** er den neuen PC-Build installiert. Ab Task 5 schickt der PC `sold_in` in jedem Exemplar-Push mit. Fehlt die Spalte in der Cloud, scheitert **jeder** Exemplar-Push (PostgREST `PGRST204`), und der Abgleich steht. Das Handy fragt `sold_in` nur in seinen eigenen Verkaufsabfragen ab (Task 10), nicht im Speicher.

Prüfabfrage für den Nutzer nach dem Einspielen:

```sql
select table_name as tabelle, count(*) as spalten
  from information_schema.columns
 where table_schema = 'public' and table_name in ('sales', 'sale_items', 'sale_channels')
 group by table_name order by table_name;
select column_name as spalte from information_schema.columns
 where table_schema = 'public' and table_name = 'card_copies' and column_name = 'sold_in';
select proname as funktion from pg_proc where proname in ('book_sale', 'update_sale', 'cancel_sale') order by proname;
select channel_id, fee_percent from public.sale_channels order by sort;
```

Erwartet: `sale_channels 8`, `sale_items 16`, `sales 12`; eine Zeile `sold_in`; drei Funktionen; fünf Kanäle (cardmarket 5.00, ebay 0, kleinanzeigen 0, tausch 0, privat 0).

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `docs/fixtures/sales/sales.json` (neu) | gemeinsame Fixture: Marktwert, Verteilung, Netto, Gebühr, Kennzahlen, Doppelverkauf, Vorschlag | 1 |
| `desktop/electron/sales-math.cjs` + `.test.cjs` (neu) | Zwilling Hauptprozess (maßgeblich) | 1 |
| `desktop/src/utils/saleMath.js` + `.test.js` (neu) | Zwilling Renderer (Netto, Gebühr, Vorschlag, Texte) | 1 |
| `android/.../ml/SalesMath.kt` (neu), `android/.../SalesMathTest.kt` (neu) | Zwilling Kotlin | 2 |
| `supabase/sales_schema.sql` (neu) | Tabellen, `sold_in`, Kanal-Seed, drei Funktionen | 3 |
| `desktop/electron/sales-schema.cjs` + `.test.cjs` (neu), `desktop/electron/database.cjs` | SQLite-Schema, Seed, `sold_in` | 4 |
| `desktop/electron/sales.cjs` + `sales.test.cjs` (neu) | Buchen, Bearbeiten, Rückgabe, Storno, Lesen, Kanäle | 4 |
| `desktop/electron/sync.cjs`, `desktop/electron/sales-sync.test.cjs` (neu), `desktop/electron/test-sync.cjs` | drei Ströme, `sold_in` in `COPY_COLS` | 5 |
| `desktop/electron/main.cjs`, `preload.cjs`, `ipc-channels.test.cjs` | Kanäle | 6 |
| `desktop/src/components/SaleDialog.jsx` (neu), `ForSaleList.jsx`, `CopySheet.jsx` | Buchen am PC | 7 |
| `desktop/src/components/SalesPanel.jsx` (neu), `SaleDetail.jsx` (neu), `src/utils/today.js` (neu), `Insights.jsx`, `CardDetailPanel.jsx`, `Settings.jsx` | Übersicht, Detail, Bearbeiten/Storno, „Verkauft", Kanal-Einstellungen | 8 |
| `android/.../cloud/Sale.kt` (neu), `cloud/SalesRepository.kt` (neu), `cloud/SideStores.kt`, `SalesRepositoryTest.kt` (neu) | Handy-Daten und RPC-Aufrufe | 9 |
| `android/.../ui/SaleSheet.kt` (neu), `ui/SaleLists.kt`, `ui/CopySheet.kt` | Buchen am Handy | 10 |
| `android/.../ui/SalesScreen.kt` (neu), `ui/InsightsScreen.kt`, `ui/CardDetailScreen.kt`, `ui/SettingsScreen.kt` | Übersicht, Detail, „Verkauft", Kanäle am Handy | 11 |
| `desktop/src/components/ForSaleList.jsx`, `CopySheet.jsx`, `Settings.jsx`, `electron/export-formats.cjs`, `electron/collection-export.cjs`, `export-formats.test.cjs` | H2b PC: Vorschlag an drei Stellen + Einstellungen | 12 |
| `android/.../Prefs.kt`, `ui/SaleLists.kt`, `ui/SaleSheet.kt`, `ui/KartenInfoSheet.kt`, `ui/SettingsScreen.kt`, `PrefsSaleTest.kt` (neu), `ui/CopySheet.kt` | H2b Handy: Vorschlag an drei Stellen + Einstellungen | 13 |

`android/...` steht für `android/app/src/main/java/com/example/yugiohscanner`. Android-Tests liegen unter `android/app/src/test/java/com/example/yugiohscanner/` und lesen Fixtures über `Fixtures.text("docs/fixtures/...")`.

Reihenfolge strikt 1 → 13 im selben Worktree. **Zwischen Task 6 und Task 9 hält der Controller an:** Der Nutzer spielt `supabase/sales_schema.sql` ein und bestätigt die Prüfabfrage. Erst dann folgen die Handy-Tasks. Task 14 macht der Controller.

## Befunde aus dem Code-Abgleich

1. **Recount-Trigger** (`copies-schema.cjs` `trg_copies_upd`, Cloud `trg_card_copies_recount`): Das Buchen setzt `deleted = 1` am Exemplar. Der Trigger zählt den Druck neu und blendet ihn aus, wenn es das letzte Exemplar war. Eine Rückkehr (`deleted = 0`) belebt ihn wieder. Nichts davon schreibt die App selbst.
2. **`trg_copies_updated`** stempelt jedes UPDATE eines Exemplars. Die Buchung löst also ohne Zutun einen Push aus. `sold_in` muss dazu in `COPY_COLS` stehen (`sync.cjs`), sonst kommt es in der Cloud nie an. `applyRemoteCopy` vergleicht über alle `COPY_COLS`, also wird ein gezogenes `sold_in` erkannt.
3. **Handy-Speicher:** Die Vollabfrage filtert `deleted = eq.false` (`StoreQueries.copies`), der Speicher `cards` außerdem `quantity > 0`. Verkaufte Exemplare fehlen dort, daher kommt die Momentaufnahme dazu (Abweichung 1). `StoreQueries.COPY_COLS` bleibt **unverändert**, und `StoreQueriesTest` bleibt grün.
4. **Kartenansicht am Handy** schließt sich über `gone = ready != null && base == null` (`CardDetailScreen.kt:96`). Für eine komplett verkaufte Karte bleibt sie offen, solange der Verkaufs-Speicher Positionen dieser Karte hat (Task 11).
5. **PC-Werte:** `listSaleCopies` liefert `price`/`price_first_ed`/`condition`/`edition` je Exemplar. Der Marktwert wird im Hauptprozess mit `valuation.cjs#unitPrice` × `conditionFactor` bestimmt, auf Cent gerundet (Zwilling `SalesMath.marketValueCents`).
6. **Fehlerklassen:** `main.cjs` reicht `copies.ValidationError` und `sealed.SealedError` unverändert durch. `sales.cjs` bekommt `SaleError` nach demselben Muster (`saleErrorMessage`).
7. **Einstellungen PC:** `get-settings`/`save-setting` genügen für `sale_discount_percent` und `sale_min_price` (Task 12), es braucht keinen neuen Kanal.

---

### Task 1: Rechen-Zwillinge JS (Hauptprozess + Renderer) mit gemeinsamer Fixture

**Files:**
- Create: `docs/fixtures/sales/sales.json`
- Create: `desktop/electron/sales-math.cjs`, `desktop/electron/sales-math.test.cjs`
- Create: `desktop/src/utils/saleMath.js`, `desktop/src/utils/saleMath.test.js`

**Interfaces:**
- Produces (`sales-math.cjs`, CommonJS):
  - `toCents(v: number|null): number|null`, `fromCents(c: number): number`
  - `marketValueCents(card: {price, price_first_ed}, copy: {edition, condition}): number`
  - `netCents({gross, fees, shipping}): number` (null/leer = 0)
  - `feeDefaultCents(grossCents: number, feePercent: number): number`
  - `distribute(netCents: number, valueCents: number[]): number[]` (Summe = netCents)
  - `countedItems(sale, items, soldInOf: (copyId)=>string|null): item[]`
  - `doubleSold(sales, items): Set<sale_id>`
  - `saleTotals(sales, items, soldInOf): {netCents, marketCents, feesCents, sales, cards}`
  - `periodFilter(sales, period: 'monat'|'jahr'|'gesamt', today: 'YYYY-MM-DD'): sales`
  - `byChannel(sales, items, soldInOf): [{channel_id, channel_name, sales, netCents, feesCents, diffCents}]`
  - `byMonth(sales, items, soldInOf, today, months=12): [{month:'YYYY-MM', netCents}]`
  - `suggestionCents(valueCents: number|null, discountPercent: number, minCents: number): number|null`
  - `normalizeDiscount(raw): number` (0–90, Standard 5), `normalizeMinPrice(raw): number` (Cent 0–10000, Standard 10)
  - `diffText(netCents, marketCents): string`, `euroCentsText(c): string`
- Produces (`saleMath.js`, ESM): dieselben Namen für `toCents, fromCents, netCents, feeDefaultCents, suggestionCents, normalizeDiscount, normalizeMinPrice, diffText, euroCentsText`.

- [ ] **Step 1: Fixture schreiben**

`docs/fixtures/sales/sales.json`:

```json
{
  "_comment": "Spec H2 §5.3/§7/§8/§9 -- gemeinsame Fixture fuer desktop/electron/sales-math.cjs, desktop/src/utils/saleMath.js und android ml/SalesMath.kt. Geld in Cent. soldIn: copy_id -> sale_id, fehlt = null.",
  "marketValue": [
    { "name": "NM unlimitiert", "card": { "price": 2.0, "price_first_ed": null }, "copy": { "edition": "unlimited", "condition": "NM" }, "cents": 200 },
    { "name": "EX Faktor 0,85", "card": { "price": 1.99, "price_first_ed": null }, "copy": { "edition": "unlimited", "condition": "EX" }, "cents": 169 },
    { "name": "1st Ed nimmt price_first_ed", "card": { "price": 2.0, "price_first_ed": 5.5 }, "copy": { "edition": "first", "condition": "GD" }, "cents": 385 },
    { "name": "1st Ed ohne price_first_ed nimmt price", "card": { "price": 2.0, "price_first_ed": null }, "copy": { "edition": "first", "condition": "NM" }, "cents": 200 },
    { "name": "kein Preis", "card": { "price": null, "price_first_ed": null }, "copy": { "edition": "unknown", "condition": "NM" }, "cents": 0 }
  ],
  "net": [
    { "sale": { "gross": 10.0, "fees": 0.5, "shipping": 1.6 }, "cents": 790 },
    { "sale": { "gross": 10.0, "fees": null, "shipping": null }, "cents": 1000 },
    { "sale": { "gross": 1.0, "fees": 0.05, "shipping": 1.6 }, "cents": -65 },
    { "sale": { "gross": 0, "fees": "", "shipping": "" }, "cents": 0 }
  ],
  "feeDefault": [
    { "grossCents": 1000, "percent": 5, "cents": 50 },
    { "grossCents": 999, "percent": 5, "cents": 50 },
    { "grossCents": 1234, "percent": 0, "cents": 0 },
    { "grossCents": 110, "percent": 5, "cents": 6 }
  ],
  "distribute": [
    { "name": "proportional", "net": 1000, "values": [300, 100], "shares": [750, 250] },
    { "name": "Rest-Cent an die groesste Position", "net": 1000, "values": [100, 100, 100], "shares": [334, 333, 333] },
    { "name": "Gleichstand: erste groesste bekommt den Rest", "net": 100, "values": [50, 200, 200], "shares": [11, 45, 44] },
    { "name": "alle 0 -> gleichmaessig", "net": 1000, "values": [0, 0, 0], "shares": [334, 333, 333] },
    { "name": "negatives Netto", "net": -65, "values": [200, 100], "shares": [-43, -22] },
    { "name": "eine Position", "net": 790, "values": [0], "shares": [790] }
  ],
  "suggestion": [
    { "name": "5 % Abschlag, auf 5 ct abgerundet", "value": 200, "discount": 5, "min": 10, "cents": 190 },
    { "name": "abrunden 1,69 -> 1,65", "value": 169, "discount": 0, "min": 10, "cents": 165 },
    { "name": "nie unter Mindestpreis", "value": 8, "discount": 5, "min": 10, "cents": 10 },
    { "name": "kein Marktwert -> kein Vorschlag", "value": 0, "discount": 5, "min": 10, "cents": null },
    { "name": "null -> kein Vorschlag", "value": null, "discount": 5, "min": 10, "cents": null },
    { "name": "10 % von 12,34", "value": 1234, "discount": 10, "min": 10, "cents": 1110 }
  ],
  "normalize": {
    "discount": [ { "raw": "5", "out": 5 }, { "raw": "", "out": 5 }, { "raw": "-1", "out": 5 }, { "raw": "91", "out": 5 }, { "raw": "12", "out": 12 }, { "raw": "7.5", "out": 5 }, { "raw": null, "out": 5 }, { "raw": "0", "out": 0 } ],
    "minPrice": [ { "raw": "0,10", "out": 10 }, { "raw": "0.25", "out": 25 }, { "raw": "", "out": 10 }, { "raw": "-1", "out": 10 }, { "raw": "100,01", "out": 10 }, { "raw": "0", "out": 0 }, { "raw": null, "out": 10 }, { "raw": "abc", "out": 10 } ]
  },
  "texts": [
    { "net": 790, "market": 700, "diff": "+0,90 € (+12,9 %)" },
    { "net": 600, "market": 700, "diff": "−1,00 € (−14,3 %)" },
    { "net": 500, "market": 0, "diff": "+5,00 €" },
    { "net": 0, "market": 0, "diff": "±0,00 €" }
  ],
  "euro": [ { "cents": 123456, "text": "1.234,56 €" }, { "cents": -65, "text": "−0,65 €" }, { "cents": 0, "text": "0,00 €" } ],
  "stats": {
    "today": "2026-09-21",
    "sales": [
      { "sale_id": "s1", "sold_on": "2026-09-02", "channel_id": "cardmarket", "channel_name": "Cardmarket", "gross": 10.0, "fees": 0.5, "shipping": 1.6, "status": "aktiv", "deleted": false },
      { "sale_id": "s2", "sold_on": "2026-08-30", "channel_id": "ebay", "channel_name": "eBay", "gross": 5.0, "fees": null, "shipping": null, "status": "aktiv", "deleted": false },
      { "sale_id": "s3", "sold_on": "2026-09-10", "channel_id": "ebay", "channel_name": "eBay", "gross": 50.0, "fees": null, "shipping": null, "status": "storniert", "deleted": false },
      { "sale_id": "s4", "sold_on": "2025-12-31", "channel_id": "privat", "channel_name": "Privat", "gross": 3.0, "fees": null, "shipping": null, "status": "aktiv", "deleted": false },
      { "sale_id": "s5", "sold_on": "2026-09-15", "channel_id": "tausch", "channel_name": "Tausch", "gross": 4.0, "fees": null, "shipping": null, "status": "aktiv", "deleted": false },
      { "sale_id": "s6", "sold_on": "2026-09-16", "channel_id": "tausch", "channel_name": "Tausch", "gross": 2.0, "fees": null, "shipping": null, "status": "aktiv", "deleted": false }
    ],
    "items": [
      { "sale_id": "s1", "copy_id": "c1", "value_at_sale": 5.0, "share": 5.93, "deleted": false },
      { "sale_id": "s1", "copy_id": "c2", "value_at_sale": 2.0, "share": 1.97, "deleted": false },
      { "sale_id": "s1", "copy_id": "c9", "value_at_sale": 1.0, "share": 0.0, "deleted": true },
      { "sale_id": "s2", "copy_id": "c3", "value_at_sale": 4.0, "share": 5.0, "deleted": false },
      { "sale_id": "s3", "copy_id": "c4", "value_at_sale": 40.0, "share": 50.0, "deleted": false },
      { "sale_id": "s4", "copy_id": "c5", "value_at_sale": 3.0, "share": 3.0, "deleted": false },
      { "sale_id": "s5", "copy_id": "c6", "value_at_sale": 3.0, "share": 4.0, "deleted": false },
      { "sale_id": "s6", "copy_id": "c6", "value_at_sale": 3.0, "share": 2.0, "deleted": false }
    ],
    "soldIn": { "c1": "s1", "c2": "s1", "c3": "s2", "c4": null, "c5": "s4", "c6": "s5" },
    "doubleSold": ["s5", "s6"],
    "periods": {
      "monat": { "netCents": 1190, "marketCents": 1000, "feesCents": 50, "sales": 2, "cards": 3 },
      "jahr": { "netCents": 1690, "marketCents": 1400, "feesCents": 50, "sales": 3, "cards": 4 },
      "gesamt": { "netCents": 1990, "marketCents": 1700, "feesCents": 50, "sales": 4, "cards": 5 }
    },
    "byChannelGesamt": [
      { "channel_id": "cardmarket", "channel_name": "Cardmarket", "sales": 1, "netCents": 790, "feesCents": 50, "diffCents": 90 },
      { "channel_id": "ebay", "channel_name": "eBay", "sales": 1, "netCents": 500, "feesCents": 0, "diffCents": 100 },
      { "channel_id": "tausch", "channel_name": "Tausch", "sales": 1, "netCents": 400, "feesCents": 0, "diffCents": 100 },
      { "channel_id": "privat", "channel_name": "Privat", "sales": 1, "netCents": 300, "feesCents": 0, "diffCents": 0 }
    ],
    "byMonthLast3": [
      { "month": "2026-07", "netCents": 0 },
      { "month": "2026-08", "netCents": 500 },
      { "month": "2026-09", "netCents": 1190 }
    ]
  }
}
```

Rechenweg der Fälle, die man leicht verwechselt (auch als Merkhilfe für den Implementierer):
- **Verteilung „Gleichstand"** `[50,200,200]`, net 100, W 450: roh 11,11 → 11, 44,44 → 44, 44,44 → 44, Summe 99. Der Rest-Cent geht an die **erste** Position mit dem größten Wert (Index 1): `[11,45,44]`.
- **Negatives Netto** `-65 × 200/300 = -43,33 → Math.round = -43`, `-65 × 100/300 = -21,67 → -22`. Summe -65, also kein Rest.
- **Alle 0:** Gewichte `[1,1,1]`, 333,33 → 333 je Position, Rest 1 an Index 0.
- **Doppelverkauf s5/s6:** c6 steckt in zwei aktiven Verkäufen, `soldIn(c6) = s5`. s6 hat damit keine gezählte Position und zählt in keiner Kennzahl.
- **Storniert s3** zählt nirgends.

Regel der Kennzahlen: Es zählen nur aktive, nicht gelöschte Verkäufe und nur gezählte Positionen. Ein Verkauf zählt in `sales`, wenn er mindestens eine gezählte Position hat. `cards` ist die Anzahl gezählter Positionen, `feesCents` die Summe der Gebühren gezählter Verkäufe. Nachgerechnet:
- Monat 2026-09: s1 (Netto 593 + 197 = 790, Marktwert 700, Gebühr 50, 2 Karten), s5 (400/300, 1 Karte), s6 (nichts). Ergibt `1190 / 1000 / 50 / 2 / 3`.
- Jahr 2026: zusätzlich s2 (500/400, 1 Karte). Ergibt `1690 / 1400 / 50 / 3 / 4`.
- Gesamt: zusätzlich s4 (300/300, 1 Karte). Ergibt `1990 / 1700 / 50 / 4 / 5`.

`byChannelGesamt` ist nach `netCents` absteigend sortiert, bei Gleichstand nach `channel_name` (de). Kanäle ohne gezählten Verkauf fehlen. `byMonthLast3` wird mit `months = 3` bis zum Monat von `today` gerechnet, aufsteigend, Monate ohne Verkauf mit 0.

- [ ] **Step 2: Failing Test für den Hauptprozess schreiben**

`desktop/electron/sales-math.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('./sales-math.cjs');

// ZWILLING: desktop/src/utils/saleMath.test.js und android SalesMathTest.kt lesen dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/fixtures/sales/sales.json'), 'utf8'));
const S = FIX.stats;
const soldInOf = (id) => (id in S.soldIn ? S.soldIn[id] : null);

test('Marktwert je Exemplar in Cent', () => {
  for (const c of FIX.marketValue) assert.equal(M.marketValueCents(c.card, c.copy), c.cents, c.name);
});
test('Netto = Preis − Gebühren − Versand', () => {
  for (const c of FIX.net) assert.equal(M.netCents(c.sale), c.cents, JSON.stringify(c.sale));
});
test('Gebühren-Vorbelegung', () => {
  for (const c of FIX.feeDefault) assert.equal(M.feeDefaultCents(c.grossCents, c.percent), c.cents, JSON.stringify(c));
});
test('Verteilung mit Rest-Cent', () => {
  for (const c of FIX.distribute) {
    const s = M.distribute(c.net, c.values);
    assert.deepEqual(s, c.shares, c.name);
    assert.equal(s.reduce((a, b) => a + b, 0), c.net, `${c.name}: Summe`);
  }
});
test('Preisvorschlag', () => {
  for (const c of FIX.suggestion) assert.equal(M.suggestionCents(c.value, c.discount, c.min), c.cents, c.name);
});
test('Einstellungen normalisieren', () => {
  for (const c of FIX.normalize.discount) assert.equal(M.normalizeDiscount(c.raw), c.out, JSON.stringify(c.raw));
  for (const c of FIX.normalize.minPrice) assert.equal(M.normalizeMinPrice(c.raw), c.out, JSON.stringify(c.raw));
});
test('Texte', () => {
  for (const c of FIX.texts) assert.equal(M.diffText(c.net, c.market), c.diff);
  for (const c of FIX.euro) assert.equal(M.euroCentsText(c.cents), c.text);
});
test('Doppelverkauf', () => {
  assert.deepEqual([...M.doubleSold(S.sales, S.items)].sort(), S.doubleSold);
});
test('Kennzahlen je Zeitraum', () => {
  for (const p of ['monat', 'jahr', 'gesamt']) {
    const sales = M.periodFilter(S.sales, p, S.today);
    assert.deepEqual(M.saleTotals(sales, S.items, soldInOf), S.periods[p], p);
  }
});
test('Je Kanal (gesamt)', () => {
  assert.deepEqual(M.byChannel(M.periodFilter(S.sales, 'gesamt', S.today), S.items, soldInOf), S.byChannelGesamt);
});
test('Je Monat', () => {
  assert.deepEqual(M.byMonth(S.sales, S.items, soldInOf, S.today, 3), S.byMonthLast3);
});
test('Verteilung: Summe exakt auch bei vielen Positionen', () => {
  const values = Array.from({ length: 37 }, (_, i) => (i * 37) % 101);
  for (const net of [1, 999, -1234, 100000]) assert.equal(M.distribute(net, values).reduce((a, b) => a + b, 0), net);
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run (in `desktop/`): `node --test electron/sales-math.test.cjs`
Expected: FAIL mit `Cannot find module './sales-math.cjs'`.

- [ ] **Step 4: `sales-math.cjs` schreiben**

```js
// desktop/electron/sales-math.cjs
// Spec H2 §5.3/§7/§8/§9 -- Rechenregeln fuer Verkaeufe, in ganzen Cent. MASSGEBLICH fuer das Buchen am PC.
// ZWILLINGE: desktop/src/utils/saleMath.js (Renderer-Teilmenge) und
// android/app/src/main/java/com/example/yugiohscanner/ml/SalesMath.kt. Gemeinsame Fixture: docs/fixtures/sales/sales.json.
// Wer eine Fassung aendert, aendert alle drei.
const { unitPrice, conditionFactor } = require('./valuation.cjs');

const blank = (v) => v == null || v === '';
const toCents = (v) => (blank(v) || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const fromCents = (c) => c / 100;

// Marktwert eines Exemplars = unitPrice (G4, 1st Ed) x Zustandsfaktor, auf Cent gerundet.
function marketValueCents(card, copy) {
  return Math.round(unitPrice(card, copy) * conditionFactor(copy && copy.condition) * 100);
}

function netCents(sale) {
  return (toCents(sale.gross) || 0) - (toCents(sale.fees) || 0) - (toCents(sale.shipping) || 0);
}

function feeDefaultCents(grossCents, feePercent) {
  return Math.round(grossCents * (Number(feePercent) || 0) / 100);
}

// Anteil_i = round(net * w_i / W); Rest an die erste Position mit dem groessten Gewicht. W = 0 -> alle Gewichte 1.
function distribute(net, valueCents) {
  if (valueCents.length === 0) return [];
  const total = valueCents.reduce((a, b) => a + b, 0);
  const w = total > 0 ? valueCents : valueCents.map(() => 1);
  const W = total > 0 ? total : valueCents.length;
  const shares = w.map((x) => Math.round((net * x) / W));
  let big = 0;
  for (let i = 1; i < w.length; i++) if (w[i] > w[big]) big = i;
  shares[big] += net - shares.reduce((a, b) => a + b, 0);
  return shares;
}

const live = (s) => s.status === 'aktiv' && !s.deleted;

// Gezaehlte Positionen eines Verkaufs: lebend und das Exemplar zeigt mit sold_in auf genau diesen Verkauf (Spec §8).
function countedItems(sale, items, soldInOf) {
  return items.filter((it) => it.sale_id === sale.sale_id && !it.deleted && soldInOf(it.copy_id) === sale.sale_id);
}

// Verkaeufe, die ein Exemplar mit einem anderen aktiven Verkauf teilen (beide lebende Positionen).
function doubleSold(sales, items) {
  const active = new Set(sales.filter(live).map((s) => s.sale_id));
  const byCopy = new Map();
  for (const it of items) {
    if (it.deleted || !active.has(it.sale_id)) continue;
    if (!byCopy.has(it.copy_id)) byCopy.set(it.copy_id, new Set());
    byCopy.get(it.copy_id).add(it.sale_id);
  }
  const out = new Set();
  for (const ids of byCopy.values()) if (ids.size > 1) for (const id of ids) out.add(id);
  return out;
}

function saleTotals(sales, items, soldInOf) {
  const t = { netCents: 0, marketCents: 0, feesCents: 0, sales: 0, cards: 0 };
  for (const s of sales.filter(live)) {
    const counted = countedItems(s, items, soldInOf);
    if (counted.length === 0) continue;
    t.sales += 1;
    t.cards += counted.length;
    t.feesCents += toCents(s.fees) || 0;
    for (const it of counted) { t.netCents += toCents(it.share) || 0; t.marketCents += toCents(it.value_at_sale) || 0; }
  }
  return t;
}

function periodFilter(sales, period, today) {
  if (period === 'monat') return sales.filter((s) => String(s.sold_on).slice(0, 7) === today.slice(0, 7));
  if (period === 'jahr') return sales.filter((s) => String(s.sold_on).slice(0, 4) === today.slice(0, 4));
  return sales;
}

function byChannel(sales, items, soldInOf) {
  const m = new Map();
  for (const s of sales.filter(live)) {
    const t = saleTotals([s], items, soldInOf);
    if (t.sales === 0) continue;
    const r = m.get(s.channel_id) || { channel_id: s.channel_id, channel_name: s.channel_name, sales: 0, netCents: 0, feesCents: 0, diffCents: 0 };
    r.sales += 1; r.netCents += t.netCents; r.feesCents += t.feesCents; r.diffCents += t.netCents - t.marketCents;
    m.set(s.channel_id, r);
  }
  return [...m.values()].sort((a, b) => (b.netCents - a.netCents) || a.channel_name.localeCompare(b.channel_name, 'de'));
}

function byMonth(sales, items, soldInOf, today, months = 12) {
  let y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7));
  const keys = [];
  for (let i = 0; i < months; i++) {
    keys.unshift(`${y}-${String(mo).padStart(2, '0')}`);
    mo -= 1; if (mo === 0) { mo = 12; y -= 1; }
  }
  return keys.map((month) => ({
    month,
    netCents: saleTotals(sales.filter((s) => String(s.sold_on).slice(0, 7) === month), items, soldInOf).netCents,
  }));
}

// Vorschlag = Marktwert x (1 - Abschlag), auf 5 ct abgerundet, nie unter dem Mindestpreis. Kein Marktwert -> null.
function suggestionCents(valueCents, discountPercent, minCents) {
  if (valueCents == null || valueCents <= 0) return null;
  const floored = Math.floor((valueCents * (100 - discountPercent)) / 500) * 5;
  return Math.max(floored, minCents);
}

function normalizeDiscount(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!/^[0-9]{1,2}$/.test(s)) return 5;
  const n = Number(s);
  return n <= 90 ? n : 5;
}
function normalizeMinPrice(raw) {
  const s = raw == null ? '' : String(raw).trim().replace(',', '.');
  if (!/^[0-9]{1,3}(\.[0-9]{1,2})?$/.test(s)) return 10;
  const c = Math.round(Number(s) * 100);
  return c <= 10000 ? c : 10;
}

const MINUS = '−';
function euroCentsText(c) {
  const abs = Math.abs(c);
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=([0-9]{3})+(?![0-9]))/g, '.');
  const txt = `${euros},${String(abs % 100).padStart(2, '0')} €`;
  return c < 0 ? MINUS + txt : txt;
}
function diffText(net, market) {
  const d = net - market;
  const sign = d > 0 ? '+' : d < 0 ? MINUS : '±';
  const money = `${sign}${euroCentsText(Math.abs(d))}`;
  if (market <= 0) return money;
  const pm = Math.round((Math.abs(d) * 1000) / market); // Promille, auf eine Nachkommastelle
  const pct = `${Math.floor(pm / 10)},${pm % 10}`;
  return `${money} (${sign}${pct} %)`;
}

module.exports = {
  toCents, fromCents, marketValueCents, netCents, feeDefaultCents, distribute, countedItems, doubleSold,
  saleTotals, periodFilter, byChannel, byMonth, suggestionCents, normalizeDiscount, normalizeMinPrice,
  euroCentsText, diffText,
};
```

Hinweis für die Fixture: `diffText(0,0)` ergibt `±0,00 €`, weil `market <= 0` keinen Prozentteil hat. `diffText(790,700)` ergibt 90 × 1000 / 700 = 128,57 → 129 ‰ → „12,9 %". `diffText(600,700)`: 100 × 1000 / 700 = 142,86 → 143 → „14,3 %".

- [ ] **Step 5: Test laufen lassen, bis er grün ist**

Run (in `desktop/`): `node --test electron/sales-math.test.cjs`
Expected: PASS, 12 Tests. Scheitert ein Fixture-Wert, zuerst den Rechenweg oben nachvollziehen. Die Fixture ist der Vertrag. Wird ein Wert geändert, dann nur mit Begründung im Bericht, und derselbe Wert gilt für alle drei Zwillinge.

- [ ] **Step 6: Renderer-Zwilling mit Test**

`desktop/src/utils/saleMath.js` enthält dieselben Funktionen `toCents, fromCents, netCents, feeDefaultCents, suggestionCents, normalizeDiscount, normalizeMinPrice, euroCentsText, diffText` als `export function …`. Die Körper sind wortgleich zur CJS-Fassung. Der Kopfkommentar nennt beide Zwillinge. `marketValueCents` kommt dazu und nutzt `unitPrice`/`conditionFactor` aus `./valuation.js`:

```js
// Spec H2 -- ZWILLING (Teilmenge) von desktop/electron/sales-math.cjs und android ml/SalesMath.kt.
// Fixture: docs/fixtures/sales/sales.json. Der Renderer rechnet nur Vorschau und Vorschlag; gebucht wird im Hauptprozess.
import { unitPrice, conditionFactor } from './valuation.js';
// … Funktionen wortgleich zu sales-math.cjs …
export function marketValueCents(card, copy) {
  return Math.round(unitPrice(card, copy) * conditionFactor(copy && copy.condition) * 100);
}
```

`desktop/src/utils/saleMath.test.js` liest die Fixture per `new URL('../../../docs/fixtures/sales/sales.json', import.meta.url)` (Muster `duplicates.test.js`) und prüft `marketValue`, `net`, `feeDefault`, `suggestion`, `normalize`, `texts` und `euro` genauso wie Step 2.

Run (in `desktop/`): `node --test src/utils/saleMath.test.js` → PASS. Dann `npx eslint .` → genau 5 Fehler.

- [ ] **Step 7: Schutz-Nachweis**

In `sales-math.cjs#distribute` die Zeile `shares[big] += …` per Edit auskommentieren. Test laufen lassen: „Rest-Cent an die groesste Position" scheitert mit `[333,333,333]` statt `[334,333,333]`. Fehlschlag zitieren, Edit zurücknehmen, Test wieder grün.

- [ ] **Step 8: Commit**

```bash
git add docs/fixtures/sales/sales.json desktop/electron/sales-math.cjs desktop/electron/sales-math.test.cjs desktop/src/utils/saleMath.js desktop/src/utils/saleMath.test.js
git commit -m "feat(h2): Rechen-Zwillinge fuer Verkaeufe (JS) mit gemeinsamer Fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Kotlin-Zwilling `SalesMath`

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/SalesMath.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/SalesMathTest.kt`

**Interfaces:**
- Consumes: Fixture aus Task 1, `cloud.Valuation.unitPrice/factor`.
- Produces (`object SalesMath` in `com.example.yugiohscanner.ml`):
  - `data class SaleHead(val saleId: String, val soldOn: String, val channelId: String, val channelName: String, val gross: Double, val fees: Double?, val shipping: Double?, val status: String, val deleted: Boolean)`
  - `data class SaleLine(val saleId: String, val copyId: String, val valueAtSale: Double, val share: Double, val deleted: Boolean)`
  - `data class Totals(val netCents: Long, val marketCents: Long, val feesCents: Long, val sales: Int, val cards: Int)`
  - `data class ChannelRow(val channelId: String, val channelName: String, val sales: Int, val netCents: Long, val feesCents: Long, val diffCents: Long)`
  - `data class MonthRow(val month: String, val netCents: Long)`
  - `fun toCents(v: Double?): Long?`, `fun marketValueCents(card: CardRow, copy: CopyRow): Long`, `fun marketValueCents(price: Double?, priceFirstEd: Double?, edition: String, condition: String): Long`
  - `fun netCents(gross: Double?, fees: Double?, shipping: Double?): Long`, `fun feeDefaultCents(grossCents: Long, feePercent: Double): Long`
  - `fun distribute(net: Long, values: List<Long>): List<Long>`
  - `fun doubleSold(sales: List<SaleHead>, items: List<SaleLine>): Set<String>`
  - `fun totals(sales, items, soldInOf: (String) -> String?): Totals`, `fun periodFilter(sales, period: String, today: String)`, `fun byChannel(...)`, `fun byMonth(..., today: String, months: Int = 12)`
  - `fun suggestionCents(valueCents: Long?, discountPercent: Int, minCents: Long): Long?`, `fun normalizeDiscount(raw: String?): Int`, `fun normalizeMinPrice(raw: String?): Long`
  - `fun euroCentsText(c: Long): String`, `fun diffText(net: Long, market: Long): String`

- [ ] **Step 1: Failing Test schreiben**

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.SalesMath
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/electron/sales-math.test.cjs -- dieselbe Fixture docs/fixtures/sales/sales.json. */
class SalesMathTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/sales/sales.json"))
    private fun dbl(o: JSONObject, k: String): Double? =
        if (!o.has(k) || o.isNull(k) || o.optString(k) == "") null else o.getDouble(k)
    private fun longs(a: org.json.JSONArray) = (0 until a.length()).map { a.getLong(it) }
    private val stats = fix.getJSONObject("stats")
    private val sales = stats.getJSONArray("sales").objects().map {
        SalesMath.SaleHead(it.getString("sale_id"), it.getString("sold_on"), it.getString("channel_id"), it.getString("channel_name"),
            it.getDouble("gross"), dbl(it, "fees"), dbl(it, "shipping"), it.getString("status"), it.getBoolean("deleted"))
    }
    private val items = stats.getJSONArray("items").objects().map {
        SalesMath.SaleLine(it.getString("sale_id"), it.getString("copy_id"), it.getDouble("value_at_sale"), it.getDouble("share"), it.getBoolean("deleted"))
    }
    private val soldIn = stats.getJSONObject("soldIn")
    private val soldInOf: (String) -> String? = { id -> if (!soldIn.has(id) || soldIn.isNull(id)) null else soldIn.getString(id) }
    private val today = stats.getString("today")

    @Test fun marktwert() {
        for (c in fix.getJSONArray("marketValue").objects()) {
            val card = c.getJSONObject("card"); val copy = c.getJSONObject("copy")
            assertEquals(c.getString("name"), c.getLong("cents"),
                SalesMath.marketValueCents(dbl(card, "price"), dbl(card, "price_first_ed"), copy.getString("edition"), copy.getString("condition")))
        }
    }
    @Test fun netto() {
        for (c in fix.getJSONArray("net").objects()) {
            val s = c.getJSONObject("sale")
            assertEquals(c.getLong("cents"), SalesMath.netCents(dbl(s, "gross"), dbl(s, "fees"), dbl(s, "shipping")))
        }
    }
    @Test fun gebuehr() {
        for (c in fix.getJSONArray("feeDefault").objects())
            assertEquals(c.getLong("cents"), SalesMath.feeDefaultCents(c.getLong("grossCents"), c.getDouble("percent")))
    }
    @Test fun verteilung() {
        for (c in fix.getJSONArray("distribute").objects()) {
            val s = SalesMath.distribute(c.getLong("net"), longs(c.getJSONArray("values")))
            assertEquals(c.getString("name"), longs(c.getJSONArray("shares")), s)
            assertEquals(c.getLong("net"), s.sum())
        }
    }
    @Test fun vorschlag() {
        for (c in fix.getJSONArray("suggestion").objects()) {
            val v = if (c.isNull("value")) null else c.getLong("value")
            val exp = if (c.isNull("cents")) null else c.getLong("cents")
            assertEquals(c.getString("name"), exp, SalesMath.suggestionCents(v, c.getInt("discount"), c.getLong("min")))
        }
    }
    @Test fun normalisieren() {
        val n = fix.getJSONObject("normalize")
        for (c in n.getJSONArray("discount").objects())
            assertEquals(c.opt("raw").toString(), c.getInt("out"), SalesMath.normalizeDiscount(if (c.isNull("raw")) null else c.getString("raw")))
        for (c in n.getJSONArray("minPrice").objects())
            assertEquals(c.opt("raw").toString(), c.getLong("out"), SalesMath.normalizeMinPrice(if (c.isNull("raw")) null else c.getString("raw")))
    }
    @Test fun texte() {
        for (c in fix.getJSONArray("texts").objects())
            assertEquals(c.getString("diff"), SalesMath.diffText(c.getLong("net"), c.getLong("market")))
        for (c in fix.getJSONArray("euro").objects())
            assertEquals(c.getString("text"), SalesMath.euroCentsText(c.getLong("cents")))
    }
    @Test fun doppelverkauf() {
        val exp = (0 until stats.getJSONArray("doubleSold").length()).map { stats.getJSONArray("doubleSold").getString(it) }
        assertEquals(exp, SalesMath.doubleSold(sales, items).sorted())
    }
    @Test fun kennzahlen() {
        for (p in listOf("monat", "jahr", "gesamt")) {
            val e = stats.getJSONObject("periods").getJSONObject(p)
            assertEquals(p, SalesMath.Totals(e.getLong("netCents"), e.getLong("marketCents"), e.getLong("feesCents"), e.getInt("sales"), e.getInt("cards")),
                SalesMath.totals(SalesMath.periodFilter(sales, p, today), items, soldInOf))
        }
    }
    @Test fun jeKanal() {
        val exp = stats.getJSONArray("byChannelGesamt").objects().map {
            SalesMath.ChannelRow(it.getString("channel_id"), it.getString("channel_name"), it.getInt("sales"), it.getLong("netCents"), it.getLong("feesCents"), it.getLong("diffCents"))
        }
        assertEquals(exp, SalesMath.byChannel(SalesMath.periodFilter(sales, "gesamt", today), items, soldInOf))
    }
    @Test fun jeMonat() {
        val exp = stats.getJSONArray("byMonthLast3").objects().map { SalesMath.MonthRow(it.getString("month"), it.getLong("netCents")) }
        assertEquals(exp, SalesMath.byMonth(sales, items, soldInOf, today, 3))
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: der Android-Befehl. Expected: Kompilierfehler `Unresolved reference: SalesMath`.

- [ ] **Step 3: `SalesMath.kt` schreiben**

```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Valuation
import java.text.Collator
import java.util.Locale

/**
 * Spec H2 §5.3/§7/§8/§9 -- Rechenregeln fuer Verkaeufe in ganzen Cent.
 * ZWILLING von desktop/electron/sales-math.cjs (massgeblich am PC) und desktop/src/utils/saleMath.js.
 * Gemeinsame Fixture docs/fixtures/sales/sales.json (SalesMathTest). Wer eine Fassung aendert, aendert alle drei.
 * Rundung ueber java.lang.Math.round (wie JS Math.round), nie kotlin.math.round.
 */
object SalesMath {
    data class SaleHead(val saleId: String, val soldOn: String, val channelId: String, val channelName: String,
                        val gross: Double, val fees: Double?, val shipping: Double?, val status: String, val deleted: Boolean)
    data class SaleLine(val saleId: String, val copyId: String, val valueAtSale: Double, val share: Double, val deleted: Boolean)
    data class Totals(val netCents: Long, val marketCents: Long, val feesCents: Long, val sales: Int, val cards: Int)
    data class ChannelRow(val channelId: String, val channelName: String, val sales: Int, val netCents: Long, val feesCents: Long, val diffCents: Long)
    data class MonthRow(val month: String, val netCents: Long)

    fun toCents(v: Double?): Long? = if (v == null || v.isNaN() || v.isInfinite()) null else Math.round(v * 100)

    fun marketValueCents(price: Double?, priceFirstEd: Double?, edition: String, condition: String): Long {
        val unit = if (edition == "first" && priceFirstEd != null) priceFirstEd else price ?: 0.0
        return Math.round(unit * Valuation.factor(condition) * 100)
    }
    fun marketValueCents(card: CardRow, copy: CopyRow): Long =
        marketValueCents(card.price, card.priceFirstEd, copy.edition, copy.condition)

    fun netCents(gross: Double?, fees: Double?, shipping: Double?): Long =
        (toCents(gross) ?: 0) - (toCents(fees) ?: 0) - (toCents(shipping) ?: 0)

    fun feeDefaultCents(grossCents: Long, feePercent: Double): Long = Math.round(grossCents * feePercent / 100)

    fun distribute(net: Long, values: List<Long>): List<Long> {
        if (values.isEmpty()) return emptyList()
        val total = values.sum()
        val w = if (total > 0) values else values.map { 1L }
        val bigW = if (total > 0) total else values.size.toLong()
        val shares = w.map { Math.round(net.toDouble() * it / bigW) }.toMutableList()
        var big = 0
        for (i in 1 until w.size) if (w[i] > w[big]) big = i
        shares[big] = shares[big] + (net - shares.sum())
        return shares
    }

    private fun SaleHead.live() = status == "aktiv" && !deleted

    fun countedItems(sale: SaleHead, items: List<SaleLine>, soldInOf: (String) -> String?): List<SaleLine> =
        items.filter { it.saleId == sale.saleId && !it.deleted && soldInOf(it.copyId) == sale.saleId }

    fun doubleSold(sales: List<SaleHead>, items: List<SaleLine>): Set<String> {
        val active = sales.filter { it.live() }.map { it.saleId }.toSet()
        val byCopy = HashMap<String, MutableSet<String>>()
        for (it in items) if (!it.deleted && it.saleId in active) byCopy.getOrPut(it.copyId) { LinkedHashSet() }.add(it.saleId)
        return byCopy.values.filter { it.size > 1 }.flatten().toSet()
    }

    fun totals(sales: List<SaleHead>, items: List<SaleLine>, soldInOf: (String) -> String?): Totals {
        var net = 0L; var market = 0L; var fees = 0L; var n = 0; var cards = 0
        for (s in sales.filter { it.live() }) {
            val counted = countedItems(s, items, soldInOf)
            if (counted.isEmpty()) continue
            n += 1; cards += counted.size; fees += toCents(s.fees) ?: 0
            for (it in counted) { net += toCents(it.share) ?: 0; market += toCents(it.valueAtSale) ?: 0 }
        }
        return Totals(net, market, fees, n, cards)
    }

    fun periodFilter(sales: List<SaleHead>, period: String, today: String): List<SaleHead> = when (period) {
        "monat" -> sales.filter { it.soldOn.take(7) == today.take(7) }
        "jahr" -> sales.filter { it.soldOn.take(4) == today.take(4) }
        else -> sales
    }

    fun byChannel(sales: List<SaleHead>, items: List<SaleLine>, soldInOf: (String) -> String?): List<ChannelRow> {
        val m = LinkedHashMap<String, ChannelRow>()
        for (s in sales.filter { it.live() }) {
            val t = totals(listOf(s), items, soldInOf)
            if (t.sales == 0) continue
            val r = m[s.channelId] ?: ChannelRow(s.channelId, s.channelName, 0, 0, 0, 0)
            m[s.channelId] = r.copy(sales = r.sales + 1, netCents = r.netCents + t.netCents, feesCents = r.feesCents + t.feesCents,
                diffCents = r.diffCents + (t.netCents - t.marketCents))
        }
        val coll = Collator.getInstance(Locale.GERMAN)
        return m.values.sortedWith { a, b -> if (a.netCents != b.netCents) b.netCents.compareTo(a.netCents) else coll.compare(a.channelName, b.channelName) }
    }

    fun byMonth(sales: List<SaleHead>, items: List<SaleLine>, soldInOf: (String) -> String?, today: String, months: Int = 12): List<MonthRow> {
        var y = today.substring(0, 4).toInt(); var mo = today.substring(5, 7).toInt()
        val keys = ArrayList<String>()
        repeat(months) {
            keys.add(0, "%04d-%02d".format(Locale.ROOT, y, mo))
            mo -= 1; if (mo == 0) { mo = 12; y -= 1 }
        }
        return keys.map { k -> MonthRow(k, totals(sales.filter { it.soldOn.take(7) == k }, items, soldInOf).netCents) }
    }

    fun suggestionCents(valueCents: Long?, discountPercent: Int, minCents: Long): Long? {
        if (valueCents == null || valueCents <= 0) return null
        val floored = Math.floorDiv(valueCents * (100 - discountPercent), 500L) * 5
        return maxOf(floored, minCents)
    }

    private val DISCOUNT = Regex("^[0-9]{1,2}$")
    private val MIN_PRICE = Regex("^[0-9]{1,3}(\\.[0-9]{1,2})?$")
    fun normalizeDiscount(raw: String?): Int {
        val s = raw?.trim() ?: ""
        if (!DISCOUNT.matches(s)) return 5
        val n = s.toInt()
        return if (n <= 90) n else 5
    }
    fun normalizeMinPrice(raw: String?): Long {
        val s = (raw?.trim() ?: "").replace(',', '.')
        if (!MIN_PRICE.matches(s)) return 10
        val c = Math.round(s.toDouble() * 100)
        return if (c <= 10000) c else 10
    }

    private const val MINUS = "−"
    fun euroCentsText(c: Long): String {
        val abs = Math.abs(c)
        val euros = String.format(Locale.GERMANY, "%,d", abs / 100)
        val txt = "$euros,${"%02d".format(Locale.ROOT, abs % 100)} €"
        return if (c < 0) MINUS + txt else txt
    }
    fun diffText(net: Long, market: Long): String {
        val d = net - market
        val sign = if (d > 0) "+" else if (d < 0) MINUS else "±"
        val money = sign + euroCentsText(Math.abs(d))
        if (market <= 0) return money
        val pm = Math.round(Math.abs(d) * 1000.0 / market)
        return "$money ($sign${pm / 10},${pm % 10} %)"
    }
}
```

Hinweis: `String.format(Locale.GERMANY, "%,d", …)` setzt den Tausenderpunkt wie die JS-Regex. `Math.floorDiv` rundet wie JS `Math.floor` auch bei negativem Zähler. Der Zähler ist hier nie negativ, weil `valueCents > 0` und `discount ≤ 90`.

- [ ] **Step 4: Android-Tests grün**

Run: Android-Befehl → `BUILD SUCCESSFUL`, Testzahl = Ausgang + 11.

- [ ] **Step 5: Schutz-Nachweis**

In `distribute` die Rest-Zeile per Edit auskommentieren. `verteilung` scheitert. Fehlschlag zitieren, zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/SalesMath.kt android/app/src/test/java/com/example/yugiohscanner/SalesMathTest.kt
git commit -m "feat(h2): Kotlin-Zwilling SalesMath gegen die gemeinsame Fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Cloud-SQL `supabase/sales_schema.sql` (nur Datei, nichts ausführen)

**Files:**
- Create: `supabase/sales_schema.sql`

**Interfaces:**
- Produces (Cloud, Namen verbindlich für Tasks 5, 9):
  - Tabellen `public.sale_channels`, `public.sales`, `public.sale_items` mit den Spalten unten, `public.card_copies.sold_in text`.
  - `public.book_sale(p_sale jsonb, p_items jsonb) returns void`: `p_sale` = `{sale_id, sold_on, channel_id, channel_name, gross, fees, shipping, note}`, `p_items` = `[{copy_id, value_at_sale, share}]`.
  - `public.update_sale(p_sale jsonb, p_shares jsonb, p_returned text[]) returns void`: `p_sale` wie oben (ohne Änderung der `sale_id`), `p_shares` = `[{copy_id, share}]` für die verbleibenden Positionen.
  - `public.cancel_sale(p_sale_id text) returns void`.
  - Fehlertexte beginnen mit einem deutschen Satz, den das Handy anzeigt.

- [ ] **Step 1: Datei schreiben**

```sql
-- supabase/sales_schema.sql — Spec H2 §4.2. Einmal im Dashboard einspielen (idempotent), BEVOR der neue PC-Build
-- installiert wird (der PC schickt ab dann card_copies.sold_in mit). Setzt voraus: public.set_updated_at() (schema.sql),
-- public.card_copies (card_copies_schema.sql). Einzelnutzer-Modell wie card_copies: keine user_id.
-- Gegenstueck lokal: desktop/electron/sales-schema.cjs und sales.cjs (Rueckkehr-Regel dort wortgleich beschrieben).

create table if not exists public.sale_channels (
  channel_id  text primary key,
  name        text not null,
  fee_percent numeric(5,2) not null default 0 check (fee_percent >= 0 and fee_percent <= 100),
  builtin     boolean not null default false,
  sort        integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);
insert into public.sale_channels (channel_id, name, fee_percent, builtin, sort) values
  ('cardmarket', 'Cardmarket', 5, true, 1), ('ebay', 'eBay', 0, true, 2), ('kleinanzeigen', 'Kleinanzeigen', 0, true, 3),
  ('tausch', 'Tausch', 0, true, 4), ('privat', 'Privat', 0, true, 5)
on conflict (channel_id) do nothing;

create table if not exists public.sales (
  sale_id      text primary key,
  sold_on      date not null,
  channel_id   text not null,
  channel_name text not null,
  gross        numeric(12,2) not null check (gross >= 0),
  fees         numeric(12,2) check (fees is null or fees >= 0),
  shipping     numeric(12,2) check (shipping is null or shipping >= 0),
  status       text not null default 'aktiv' check (status in ('aktiv', 'storniert')),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);

create table if not exists public.sale_items (
  sale_id       text not null,
  copy_id       text not null,
  value_at_sale numeric(12,2) not null default 0,
  share         numeric(12,2) not null default 0,
  was_for_sale  boolean not null default false,
  card_id       text not null,
  set_code      text not null,
  language      text not null,
  rarity        text not null,
  edition       text not null,
  condition     text not null,
  name          text,
  image_url     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false,
  primary key (sale_id, copy_id)
);

alter table public.card_copies add column if not exists sold_in text;

create index if not exists sale_channels_updated_idx on public.sale_channels (updated_at);
create index if not exists sales_updated_idx on public.sales (updated_at);
create index if not exists sale_items_updated_idx on public.sale_items (updated_at);
create index if not exists sale_items_copy_idx on public.sale_items (copy_id);

drop trigger if exists trg_sale_channels_updated_at on public.sale_channels;
create trigger trg_sale_channels_updated_at before insert or update on public.sale_channels
  for each row execute function public.set_updated_at();
drop trigger if exists trg_sales_updated_at on public.sales;
create trigger trg_sales_updated_at before insert or update on public.sales
  for each row execute function public.set_updated_at();
drop trigger if exists trg_sale_items_updated_at on public.sale_items;
create trigger trg_sale_items_updated_at before insert or update on public.sale_items
  for each row execute function public.set_updated_at();

alter table public.sale_channels enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
drop policy if exists sale_channels_authenticated_all on public.sale_channels;
create policy sale_channels_authenticated_all on public.sale_channels for all to authenticated using (true) with check (true);
drop policy if exists sales_authenticated_all on public.sales;
create policy sales_authenticated_all on public.sales for all to authenticated using (true) with check (true);
drop policy if exists sale_items_authenticated_all on public.sale_items;
create policy sale_items_authenticated_all on public.sale_items for all to authenticated using (true) with check (true);

-- Rueckkehr eines Exemplars aus dem Verkauf p_sale_id (Spec H2 §6.3, Plan-Abweichung 2). Zeigt sold_in nicht auf
-- diesen Verkauf, bleibt das Exemplar unberuehrt. Beansprucht ein anderer aktiver Verkauf es noch mit einer lebenden
-- Position, wandert sold_in dorthin. Sonst: deleted = false, sold_in = null, for_sale = was_for_sale; ist das Fach
-- (container_id, page, slot) inzwischen von einem lebenden Exemplar belegt, page/slot leeren und needs_review setzen.
create or replace function public.sale_return_copy(p_sale_id text, p_copy_id text, p_was_for_sale boolean)
returns void language plpgsql set search_path = public as $$
declare
  cc public.card_copies%rowtype;
  other text;
begin
  select * into cc from public.card_copies where copy_id = p_copy_id for update;
  if not found or cc.sold_in is distinct from p_sale_id then return; end if;
  select si.sale_id into other
    from public.sale_items si join public.sales s on s.sale_id = si.sale_id
   where si.copy_id = p_copy_id and si.sale_id <> p_sale_id and si.deleted = false
     and s.status = 'aktiv' and s.deleted = false
   order by s.created_at, s.sale_id limit 1;
  if other is not null then
    update public.card_copies set sold_in = other where copy_id = p_copy_id;
    return;
  end if;
  if cc.page is not null and cc.slot is not null and exists (
       select 1 from public.card_copies o
        where o.copy_id <> p_copy_id and o.deleted = false and o.container_id = cc.container_id
          and o.page = cc.page and o.slot = cc.slot) then
    update public.card_copies
       set deleted = false, sold_in = null, for_sale = p_was_for_sale, page = null, slot = null,
           needs_review = true, review_reason = 'Fach inzwischen belegt'
     where copy_id = p_copy_id;
  else
    update public.card_copies set deleted = false, sold_in = null, for_sale = p_was_for_sale where copy_id = p_copy_id;
  end if;
end $$;

create or replace function public.book_sale(p_sale jsonb, p_items jsonb)
returns void language plpgsql set search_path = public as $$
declare
  it jsonb;
  n integer;
  sid text := p_sale->>'sale_id';
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Mindestens eine Karte auswählen.';
  end if;
  insert into public.sales (sale_id, sold_on, channel_id, channel_name, gross, fees, shipping, note)
  values (sid, (p_sale->>'sold_on')::date, p_sale->>'channel_id', p_sale->>'channel_name',
          (p_sale->>'gross')::numeric, nullif(p_sale->>'fees', '')::numeric, nullif(p_sale->>'shipping', '')::numeric,
          nullif(p_sale->>'note', ''));
  for it in select value from jsonb_array_elements(p_items) loop
    insert into public.sale_items (sale_id, copy_id, value_at_sale, share, was_for_sale, card_id, set_code, language,
                                   rarity, edition, condition, name, image_url)
    select sid, cc.copy_id, (it->>'value_at_sale')::numeric, (it->>'share')::numeric, cc.for_sale, cc.card_id,
           cc.set_code, cc.language, cc.rarity, cc.edition, cc.condition, c.name, c.image_url
      from public.card_copies cc
      left join public.cards c on c.id = cc.card_id and c.set_code = cc.set_code
                              and c.language = cc.language and c.rarity = cc.rarity
     where cc.copy_id = it->>'copy_id' and cc.deleted = false and cc.sold_in is null;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'Karte bereits verkauft oder gelöscht (%).', it->>'copy_id'; end if;
    update public.card_copies set deleted = true, sold_in = sid, for_sale = false where copy_id = it->>'copy_id';
  end loop;
end $$;

create or replace function public.update_sale(p_sale jsonb, p_shares jsonb, p_returned text[])
returns void language plpgsql set search_path = public as $$
declare
  sid text := p_sale->>'sale_id';
  st text;
  r record;
begin
  select status into st from public.sales where sale_id = sid and deleted = false for update;
  if st is null then raise exception 'Verkauf nicht gefunden.'; end if;
  if st <> 'aktiv' then raise exception 'Ein stornierter Verkauf lässt sich nicht ändern.'; end if;
  update public.sales
     set sold_on = (p_sale->>'sold_on')::date, channel_id = p_sale->>'channel_id', channel_name = p_sale->>'channel_name',
         gross = (p_sale->>'gross')::numeric, fees = nullif(p_sale->>'fees', '')::numeric,
         shipping = nullif(p_sale->>'shipping', '')::numeric, note = nullif(p_sale->>'note', '')
   where sale_id = sid;
  for r in select copy_id, was_for_sale from public.sale_items
            where sale_id = sid and deleted = false and copy_id = any(coalesce(p_returned, '{}')) loop
    update public.sale_items set deleted = true, share = 0 where sale_id = sid and copy_id = r.copy_id;
    perform public.sale_return_copy(sid, r.copy_id, r.was_for_sale);
  end loop;
  if not exists (select 1 from public.sale_items where sale_id = sid and deleted = false) then
    raise exception 'Mindestens eine Karte muss im Verkauf bleiben – sonst stornieren.';
  end if;
  update public.sale_items si set share = (x->>'share')::numeric
    from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) x
   where si.sale_id = sid and si.copy_id = x->>'copy_id' and si.deleted = false;
end $$;

create or replace function public.cancel_sale(p_sale_id text)
returns void language plpgsql set search_path = public as $$
declare
  st text;
  r record;
begin
  select status into st from public.sales where sale_id = p_sale_id and deleted = false for update;
  if st is null then raise exception 'Verkauf nicht gefunden.'; end if;
  if st <> 'aktiv' then return; end if;
  update public.sales set status = 'storniert' where sale_id = p_sale_id;
  for r in select copy_id, was_for_sale from public.sale_items where sale_id = p_sale_id and deleted = false loop
    perform public.sale_return_copy(p_sale_id, r.copy_id, r.was_for_sale);
  end loop;
end $$;

revoke all on function public.sale_return_copy(text, text, boolean) from public, anon;
grant execute on function public.sale_return_copy(text, text, boolean) to authenticated;
revoke all on function public.book_sale(jsonb, jsonb) from public, anon;
revoke all on function public.update_sale(jsonb, jsonb, text[]) from public, anon;
revoke all on function public.cancel_sale(text) from public, anon;
grant execute on function public.book_sale(jsonb, jsonb) to authenticated;
grant execute on function public.update_sale(jsonb, jsonb, text[]) to authenticated;
grant execute on function public.cancel_sale(text) to authenticated;
```

Hinweis zu `sale_return_copy`: Die öffentlichen Funktionen sind `security invoker` (Standard) und laufen mit den Rechten der angemeldeten Sitzung. Ein Aufruf aus ihnen heraus prüft das EXECUTE-Recht des Aufrufers, deshalb braucht auch die Hilfsfunktion `grant execute … to authenticated`. Nur `anon` wird entzogen.

- [ ] **Step 2: Selbstprüfung ohne Datenbank**

Keine Ausführung. Prüfen:
- `grep -c "create or replace function" supabase/sales_schema.sql` → 4.
- Jede Tabelle hat Trigger, RLS und Policy.
- Die Spaltenzahlen stimmen mit der Prüfabfrage im Plan-Kopf überein: `sale_channels` 8, `sales` 12, `sale_items` 16.

- [ ] **Step 3: Commit**

```bash
git add supabase/sales_schema.sql
git commit -m "feat(h2): Cloud-SQL fuer Verkaeufe (Tabellen, sold_in, book/update/cancel_sale)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Desktop-SQLite — Schema und Verkaufs-Helfer

**Files:**
- Create: `desktop/electron/sales-schema.cjs`, `desktop/electron/sales.cjs`, `desktop/electron/sales.test.cjs`
- Modify: `desktop/electron/database.cjs` (nach `ensureSealedSchema(db);`, Zeile ~282)

**Interfaces:**
- Consumes: `sales-math.cjs` (Task 1), `valuation.cjs#unitPrice/conditionFactor`.
- Produces:
  - `sales-schema.cjs`: `ensureSalesSchema(db)`, `CHANNEL_COLS`, `SALE_COLS`, `ITEM_COLS` (volle lokale Spaltenlisten, Sync-Task filtert Zeitstempel).
  - `sales.cjs`: `SaleError`, `listChannels(db)`, `saveChannel(db, {channel_id?, name, fee_percent})`, `hideChannel(db, channel_id)`, `previewSale(db, copyIds) -> {items:[{copy_id, name, set_code, rarity, language, edition, condition, image_url, valueCents}], marketCents}`, `bookSale(db, {copyIds, channel_id, sold_on, gross, fees, shipping, note}) -> sale_id`, `updateSale(db, {sale_id, channel_id, sold_on, gross, fees, shipping, note, returnCopyIds})`, `cancelSale(db, sale_id)`, `salesOverview(db, {period, today}) -> {totals, byChannel, byMonth, sales:[…mit netCents, marketCents, cards, doubleSold]}`, `saleDetail(db, sale_id) -> {sale, items}`, `cardSales(db, cardId) -> [{sale_id, sold_on, channel_name, share, set_code, rarity, language, edition, condition, status}]`.

- [ ] **Step 1: Failing Tests schreiben**

`desktop/electron/sales.test.cjs` (echte SQLite im Speicher):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');
const S = require('./sales.cjs');

function freshDb() {
  const db = new Database(':memory:');
  // Wie copies-for-sale.test.cjs: ensureCopiesSchema braucht cards (mit price) und portfolio_history.
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  ensureSalesSchema(db);
  return db;
}
function addCard(db, id, price, n, extra = {}) {
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, name, price) VALUES (?, 'LOB-DE001', 'DE', 'Common', ?, ?)`).run(id, `Karte ${id}`, price);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const copyId = `${id}-${i}`;
    db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, condition, for_sale, container_id, page, slot)
      VALUES (?, ?, 'LOB-DE001', 'DE', 'Common', 'NM', ?, ?, ?, ?)`)
      .run(copyId, id, extra.forSale ? 1 : 0, extra.container ?? null, extra.page ?? null, extra.slot ?? null);
    ids.push(copyId);
  }
  return ids;
}
const copy = (db, id) => db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(id);
const base = { channel_id: 'cardmarket', sold_on: '2026-09-21', gross: 10, fees: 0.5, shipping: 1.6, note: null };

test('Kanaele: fuenf feste mit Cardmarket 5 %', () => {
  const db = freshDb();
  const ch = S.listChannels(db);
  assert.deepEqual(ch.map((c) => [c.channel_id, c.fee_percent]), [['cardmarket', 5], ['ebay', 0], ['kleinanzeigen', 0], ['tausch', 0], ['privat', 0]]);
});

test('Buchen: Exemplare verkauft, Anteile exakt, Marktwert eingefroren, Momentaufnahme', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1, { forSale: true });
  const [b] = addCard(db, '2', 1, 1);
  const saleId = S.bookSale(db, { ...base, copyIds: [a, b] });
  // Netto 790 auf 300/100: 592,5 -> 593 und 197,5 -> 198 (Summe 791), der Rest-Cent -1 geht an die groessere Position.
  assert.equal(copy(db, a).deleted, 1);
  assert.equal(copy(db, a).sold_in, saleId);
  assert.equal(copy(db, a).for_sale, 0);
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY copy_id').all(saleId);
  assert.deepEqual(items.map((i) => [i.copy_id, i.value_at_sale, i.share, i.was_for_sale, i.name]),
    [[a, 3, 5.92, 1, 'Karte 1'], [b, 1, 1.98, 0, 'Karte 2']]);
  assert.equal(db.prepare("SELECT deleted FROM cards WHERE id = '1'").get().deleted, 1, 'Trigger blendet den leeren Druck aus');
  db.prepare("UPDATE cards SET price = 99 WHERE id = '1'").run();
  S.updateSale(db, { sale_id: saleId, ...base, gross: 12, returnCopyIds: [] });
  assert.equal(db.prepare('SELECT value_at_sale FROM sale_items WHERE copy_id = ?').get(a).value_at_sale, 3, 'eingefroren');
});

test('Buchen: bereits verkauft oder leer wird abgelehnt, nichts halb gebucht', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  S.bookSale(db, { ...base, copyIds: [a] });
  const [b] = addCard(db, '2', 1, 1);
  assert.throws(() => S.bookSale(db, { ...base, copyIds: [b, a] }), /bereits verkauft/);
  assert.equal(copy(db, b).deleted, 0, 'b bleibt lebend');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1);
  assert.throws(() => S.bookSale(db, { ...base, copyIds: [] }), /Mindestens eine Karte/);
  assert.throws(() => S.bookSale(db, { ...base, gross: -1, copyIds: [b] }), /Preis/);
});

test('Teil-Rueckgabe: Exemplar kommt zurueck, Rest neu verteilt', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1, { forSale: true });
  const [b] = addCard(db, '2', 1, 1);
  const saleId = S.bookSale(db, { ...base, copyIds: [a, b] });
  S.updateSale(db, { sale_id: saleId, ...base, returnCopyIds: [a] });
  assert.equal(copy(db, a).deleted, 0);
  assert.equal(copy(db, a).sold_in, null);
  assert.equal(copy(db, a).for_sale, 1, 'was_for_sale wiederhergestellt');
  assert.equal(db.prepare('SELECT share FROM sale_items WHERE copy_id = ?').get(b).share, 7.9);
  assert.throws(() => S.updateSale(db, { sale_id: saleId, ...base, returnCopyIds: [b] }), /sonst stornieren/);
});

test('Storno: alle zurueck, Status storniert, nicht mehr aenderbar', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const saleId = S.bookSale(db, { ...base, copyIds: [a, b] });
  S.cancelSale(db, saleId);
  assert.equal(copy(db, a).deleted, 0);
  assert.equal(copy(db, b).deleted, 0);
  assert.equal(db.prepare('SELECT status FROM sales WHERE sale_id = ?').get(saleId).status, 'storniert');
  assert.equal(db.prepare("SELECT deleted FROM cards WHERE id = '1'").get().deleted, 0, 'Trigger belebt den Druck');
  assert.throws(() => S.updateSale(db, { sale_id: saleId, ...base, returnCopyIds: [] }), /storniert/);
});

test('Fach-Konflikt: Rueckkehr ohne Fach, needs_review', () => {
  const db = freshDb();
  db.prepare("INSERT INTO containers (container_id, name, kind, pockets_per_page) VALUES ('B', 'Ordner', 'binder', 9)").run();
  const [a] = addCard(db, '1', 3, 1, { container: 'B', page: 1, slot: 4 });
  const saleId = S.bookSale(db, { ...base, copyIds: [a] });
  addCard(db, '2', 1, 1, { container: 'B', page: 1, slot: 4 });
  S.cancelSale(db, saleId);
  const r = copy(db, a);
  assert.deepEqual([r.deleted, r.container_id, r.page, r.slot, r.needs_review, r.review_reason], [0, 'B', null, null, 1, 'Fach inzwischen belegt']);
});

test('Doppelverkauf: Storno des einen laesst das Exemplar im anderen verkauft', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const s1 = S.bookSale(db, { ...base, copyIds: [a] });
  // Zweiter Verkauf desselben Exemplars, wie er nach einem Abgleich von einem anderen Geraet ankommt:
  db.prepare(`INSERT INTO sales (sale_id, sold_on, channel_id, channel_name, gross, updated_at) VALUES ('s2', '2026-09-21', 'ebay', 'eBay', 5, '2000-01-01 00:00:00')`).run();
  db.prepare(`INSERT INTO sale_items (sale_id, copy_id, value_at_sale, share, card_id, set_code, language, rarity, edition, condition)
    VALUES ('s2', ?, 3, 5, '1', 'LOB-DE001', 'DE', 'Common', 'unknown', 'NM')`).run(a);
  const ov = S.salesOverview(db, { period: 'gesamt', today: '2026-09-21' });
  assert.deepEqual(ov.sales.filter((s) => s.doubleSold).map((s) => s.sale_id).sort(), [s1, 's2'].sort());
  S.cancelSale(db, s1);
  assert.equal(copy(db, a).deleted, 1, 'bleibt verkauft');
  assert.equal(copy(db, a).sold_in, 's2', 'sold_in wandert zum anderen Verkauf');
});

test('Uebersicht und Kartenansicht', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const s1 = S.bookSale(db, { ...base, copyIds: [a] });
  S.bookSale(db, { ...base, channel_id: 'ebay', sold_on: '2026-08-01', gross: 4, fees: null, shipping: null, copyIds: [b] });
  const ov = S.salesOverview(db, { period: 'monat', today: '2026-09-21' });
  assert.deepEqual(ov.totals, { netCents: 790, marketCents: 300, feesCents: 50, sales: 1, cards: 1 });
  assert.equal(ov.byMonth.length, 12);
  assert.equal(S.salesOverview(db, { period: 'gesamt', today: '2026-09-21' }).sales[0].sale_id, s1, 'neueste zuerst');
  assert.equal(S.cardSales(db, '1').length, 2);
  assert.equal(S.saleDetail(db, s1).items.length, 1);
});

test('Kanaele: eigener Kanal anlegen, ausblenden; feste nicht ausblendbar', () => {
  const db = freshDb();
  const id = S.saveChannel(db, { name: 'Flohmarkt', fee_percent: 0 });
  assert.ok(S.listChannels(db).some((c) => c.channel_id === id));
  S.hideChannel(db, id);
  assert.ok(!S.listChannels(db).some((c) => c.channel_id === id));
  assert.throws(() => S.hideChannel(db, 'cardmarket'), /Feste Kanäle/);
  S.saveChannel(db, { channel_id: 'cardmarket', name: 'Cardmarket', fee_percent: 6.5 });
  assert.equal(S.listChannels(db)[0].fee_percent, 6.5);
  assert.throws(() => S.saveChannel(db, { name: ' ', fee_percent: 0 }), /Namen/);
  assert.throws(() => S.saveChannel(db, { name: 'X', fee_percent: 101 }), /Gebühr/);
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: SQLite-Suite. Expected: FAIL `Cannot find module './sales-schema.cjs'`.

- [ ] **Step 3: `sales-schema.cjs` schreiben**

```js
// desktop/electron/sales-schema.cjs — Spec H2 §4.1. Gegenstueck zu supabase/sales_schema.sql.
// Zeitstempel-Trigger wie trg_sealed_updated (sealed-items.cjs): ohne sie saehe der Push (updated_at > cursor) nichts.
const CHANNEL_COLS = ['channel_id', 'name', 'fee_percent', 'builtin', 'sort', 'created_at', 'updated_at', 'deleted'];
const SALE_COLS = ['sale_id', 'sold_on', 'channel_id', 'channel_name', 'gross', 'fees', 'shipping', 'status', 'note', 'created_at', 'updated_at', 'deleted'];
const ITEM_COLS = ['sale_id', 'copy_id', 'value_at_sale', 'share', 'was_for_sale', 'card_id', 'set_code', 'language', 'rarity',
  'edition', 'condition', 'name', 'image_url', 'created_at', 'updated_at', 'deleted'];
const BUILTIN = [['cardmarket', 'Cardmarket', 5, 1], ['ebay', 'eBay', 0, 2], ['kleinanzeigen', 'Kleinanzeigen', 0, 3], ['tausch', 'Tausch', 0, 4], ['privat', 'Privat', 0, 5]];

function ensureSalesSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sale_channels (
      channel_id TEXT PRIMARY KEY, name TEXT NOT NULL,
      fee_percent REAL NOT NULL DEFAULT 0 CHECK (fee_percent >= 0 AND fee_percent <= 100),
      builtin INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 100,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sales (
      sale_id TEXT PRIMARY KEY, sold_on TEXT NOT NULL, channel_id TEXT NOT NULL, channel_name TEXT NOT NULL,
      gross REAL NOT NULL CHECK (gross >= 0), fees REAL CHECK (fees IS NULL OR fees >= 0),
      shipping REAL CHECK (shipping IS NULL OR shipping >= 0),
      status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','storniert')), note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sale_items (
      sale_id TEXT NOT NULL, copy_id TEXT NOT NULL, value_at_sale REAL NOT NULL DEFAULT 0, share REAL NOT NULL DEFAULT 0,
      was_for_sale INTEGER NOT NULL DEFAULT 0, card_id TEXT NOT NULL, set_code TEXT NOT NULL, language TEXT NOT NULL,
      rarity TEXT NOT NULL, edition TEXT NOT NULL, condition TEXT NOT NULL, name TEXT, image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (sale_id, copy_id));
    CREATE INDEX IF NOT EXISTS sale_channels_updated_idx ON sale_channels (updated_at);
    CREATE INDEX IF NOT EXISTS sales_updated_idx ON sales (updated_at);
    CREATE INDEX IF NOT EXISTS sale_items_updated_idx ON sale_items (updated_at);
    CREATE INDEX IF NOT EXISTS sale_items_copy_idx ON sale_items (copy_id);
    CREATE TRIGGER IF NOT EXISTS trg_sale_channels_updated AFTER UPDATE ON sale_channels FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE sale_channels SET updated_at = CURRENT_TIMESTAMP WHERE channel_id = NEW.channel_id; END;
    CREATE TRIGGER IF NOT EXISTS trg_sales_updated AFTER UPDATE ON sales FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE sales SET updated_at = CURRENT_TIMESTAMP WHERE sale_id = NEW.sale_id; END;
    CREATE TRIGGER IF NOT EXISTS trg_sale_items_updated AFTER UPDATE ON sale_items FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE sale_items SET updated_at = CURRENT_TIMESTAMP WHERE sale_id = NEW.sale_id AND copy_id = NEW.copy_id; END;
  `);
  const cols = db.prepare('PRAGMA table_info(card_copies)').all().map((c) => c.name);
  if (!cols.includes('sold_in')) db.exec('ALTER TABLE card_copies ADD COLUMN sold_in TEXT');
  // Feste Kanaele mit altem Stempel: die Cloud legt dieselben Zeilen selbst an, ein Push waere ueberfluessig.
  const ins = db.prepare(`INSERT OR IGNORE INTO sale_channels (channel_id, name, fee_percent, builtin, sort, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, '1970-01-01 00:00:00', '1970-01-01 00:00:00')`);
  for (const [id, name, fee, sort] of BUILTIN) ins.run(id, name, fee, sort);
}

module.exports = { ensureSalesSchema, CHANNEL_COLS, SALE_COLS, ITEM_COLS };
```

In `database.cjs` neben den anderen `require`s `const { ensureSalesSchema } = require('./sales-schema.cjs');` ergänzen und direkt nach `ensureSealedSchema(db);   // Spec G3: Sealed-Bestand` die Zeile `ensureSalesSchema(db);    // Spec H2: Verkaeufe` einfügen.

- [ ] **Step 4: `sales.cjs` schreiben**

```js
// desktop/electron/sales.cjs — Spec H2 §5–§8: Verkaeufe buchen, bearbeiten, teilweise zuruecknehmen, stornieren, lesen.
// Rechenregeln ausschliesslich aus sales-math.cjs (Zwilling). Rueckkehr-Regel wortgleich zu
// supabase/sales_schema.sql#sale_return_copy (Plan-Abweichung 2). Jede Schreibaktion ist EINE Transaktion.
const crypto = require('crypto');
const M = require('./sales-math.cjs');

class SaleError extends Error {}

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const blank = (v) => v == null || v === '';

function listChannels(db) {
  return db.prepare('SELECT * FROM sale_channels WHERE deleted = 0 ORDER BY sort, name').all();
}

function saveChannel(db, { channel_id, name, fee_percent } = {}) {
  const n = String(name ?? '').trim();
  if (!n) throw new SaleError('Der Kanal braucht einen Namen.');
  const fee = Number(fee_percent);
  if (!Number.isFinite(fee) || fee < 0 || fee > 100) throw new SaleError('Die Gebühr muss zwischen 0 und 100 % liegen.');
  if (channel_id) {
    const info = db.prepare('UPDATE sale_channels SET name = ?, fee_percent = ? WHERE channel_id = ? AND deleted = 0').run(n, fee, channel_id);
    if (info.changes === 0) throw new SaleError('Kanal nicht gefunden.');
    return channel_id;
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO sale_channels (channel_id, name, fee_percent) VALUES (?, ?, ?)').run(id, n, fee);
  return id;
}

function hideChannel(db, channelId) {
  const row = db.prepare('SELECT builtin FROM sale_channels WHERE channel_id = ? AND deleted = 0').get(channelId);
  if (!row) throw new SaleError('Kanal nicht gefunden.');
  if (row.builtin) throw new SaleError('Feste Kanäle lassen sich nicht ausblenden.');
  db.prepare('UPDATE sale_channels SET deleted = 1 WHERE channel_id = ?').run(channelId);
}

// Lebende, unverkaufte Exemplare mit Kartendaten und Marktwert (Cent). Ausgeschriebene Spalten wie listSaleCopies.
function liveCopies(db, copyIds) {
  const q = db.prepare(`
    SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition, cp.for_sale,
           c.name, c.image_url, c.price, c.price_first_ed
      FROM card_copies cp
      LEFT JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
     WHERE cp.copy_id = ? AND cp.deleted = 0 AND cp.sold_in IS NULL`);
  return copyIds.map((id) => {
    const r = q.get(id);
    return r ? { ...r, valueCents: M.marketValueCents(r, r) } : null;
  });
}

function previewSale(db, copyIds) {
  const rows = liveCopies(db, [...new Set(copyIds || [])]).filter(Boolean);
  return {
    items: rows.map(({ price, price_first_ed, for_sale, ...r }) => r),
    marketCents: rows.reduce((a, r) => a + r.valueCents, 0),
  };
}

function checkHead(db, h) {
  if (!DATE.test(String(h.sold_on || ''))) throw new SaleError('Ungültiges Datum.');
  const gross = Number(h.gross);
  if (blank(h.gross) || !Number.isFinite(gross) || gross < 0) throw new SaleError('Der Preis muss 0 € oder mehr sein.');
  for (const [k, label] of [['fees', 'Gebühren'], ['shipping', 'Versand']]) {
    if (!blank(h[k]) && !(Number(h[k]) >= 0)) throw new SaleError(`${label} müssen 0 € oder mehr sein.`);
  }
  const ch = db.prepare('SELECT channel_id, name FROM sale_channels WHERE channel_id = ?').get(h.channel_id);
  if (!ch) throw new SaleError('Kanal nicht gefunden.');
  return {
    sold_on: h.sold_on, channel_id: ch.channel_id, channel_name: ch.name, gross: M.toCents(gross) / 100,
    fees: blank(h.fees) ? null : M.toCents(h.fees) / 100, shipping: blank(h.shipping) ? null : M.toCents(h.shipping) / 100,
    note: blank(h.note) ? null : String(h.note).trim() || null,
  };
}

function bookSale(db, input = {}) {
  const ids = [...new Set(Array.isArray(input.copyIds) ? input.copyIds : [])];
  if (ids.length === 0) throw new SaleError('Mindestens eine Karte auswählen.');
  const head = checkHead(db, input);
  const saleId = crypto.randomUUID();
  db.transaction(() => {
    const rows = liveCopies(db, ids);
    if (rows.some((r) => !r)) throw new SaleError('Karte bereits verkauft oder gelöscht.');
    const shares = M.distribute(M.netCents(head), rows.map((r) => r.valueCents));
    db.prepare(`INSERT INTO sales (sale_id, sold_on, channel_id, channel_name, gross, fees, shipping, note)
      VALUES (@sale_id, @sold_on, @channel_id, @channel_name, @gross, @fees, @shipping, @note)`).run({ sale_id: saleId, ...head });
    const insItem = db.prepare(`INSERT INTO sale_items (sale_id, copy_id, value_at_sale, share, was_for_sale, card_id, set_code,
      language, rarity, edition, condition, name, image_url) VALUES (@sale_id, @copy_id, @value, @share, @was, @card_id, @set_code,
      @language, @rarity, @edition, @condition, @name, @image_url)`);
    const sell = db.prepare('UPDATE card_copies SET deleted = 1, sold_in = ?, for_sale = 0, updated_at = CURRENT_TIMESTAMP WHERE copy_id = ?');
    rows.forEach((r, i) => {
      insItem.run({ sale_id: saleId, copy_id: r.copy_id, value: r.valueCents / 100, share: shares[i] / 100, was: r.for_sale ? 1 : 0,
        card_id: String(r.card_id), set_code: r.set_code, language: r.language, rarity: r.rarity, edition: r.edition,
        condition: r.condition, name: r.name ?? null, image_url: r.image_url ?? null });
      sell.run(saleId, r.copy_id);
    });
  })();
  return saleId;
}

// Rueckkehr eines Exemplars aus Verkauf saleId -- wortgleich zu supabase sale_return_copy.
function returnCopy(db, saleId, copyId, wasForSale) {
  const cc = db.prepare('SELECT * FROM card_copies WHERE copy_id = ?').get(copyId);
  if (!cc || cc.sold_in !== saleId) return;
  const other = db.prepare(`SELECT si.sale_id FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id
     WHERE si.copy_id = ? AND si.sale_id <> ? AND si.deleted = 0 AND s.status = 'aktiv' AND s.deleted = 0
     ORDER BY s.created_at, s.sale_id LIMIT 1`).get(copyId, saleId);
  if (other) {
    db.prepare('UPDATE card_copies SET sold_in = ?, updated_at = CURRENT_TIMESTAMP WHERE copy_id = ?').run(other.sale_id, copyId);
    return;
  }
  const occupied = cc.page != null && cc.slot != null && db.prepare(`SELECT 1 FROM card_copies
     WHERE copy_id <> ? AND deleted = 0 AND container_id IS ? AND page = ? AND slot = ?`).get(copyId, cc.container_id, cc.page, cc.slot);
  if (occupied) {
    db.prepare(`UPDATE card_copies SET deleted = 0, sold_in = NULL, for_sale = ?, page = NULL, slot = NULL, needs_review = 1,
      review_reason = 'Fach inzwischen belegt', updated_at = CURRENT_TIMESTAMP WHERE copy_id = ?`).run(wasForSale ? 1 : 0, copyId);
  } else {
    db.prepare('UPDATE card_copies SET deleted = 0, sold_in = NULL, for_sale = ?, updated_at = CURRENT_TIMESTAMP WHERE copy_id = ?')
      .run(wasForSale ? 1 : 0, copyId);
  }
}

function activeSale(db, saleId) {
  const s = db.prepare('SELECT * FROM sales WHERE sale_id = ? AND deleted = 0').get(saleId);
  if (!s) throw new SaleError('Verkauf nicht gefunden.');
  return s;
}

function updateSale(db, input = {}) {
  const head = checkHead(db, input);
  const returned = new Set(Array.isArray(input.returnCopyIds) ? input.returnCopyIds : []);
  db.transaction(() => {
    const s = activeSale(db, input.sale_id);
    if (s.status !== 'aktiv') throw new SaleError('Ein stornierter Verkauf lässt sich nicht ändern.');
    db.prepare(`UPDATE sales SET sold_on = @sold_on, channel_id = @channel_id, channel_name = @channel_name, gross = @gross,
      fees = @fees, shipping = @shipping, note = @note WHERE sale_id = @sale_id`).run({ sale_id: s.sale_id, ...head });
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? AND deleted = 0 ORDER BY created_at, copy_id').all(s.sale_id);
    for (const it of items.filter((i) => returned.has(i.copy_id))) {
      db.prepare('UPDATE sale_items SET deleted = 1, share = 0 WHERE sale_id = ? AND copy_id = ?').run(s.sale_id, it.copy_id);
      returnCopy(db, s.sale_id, it.copy_id, it.was_for_sale);
    }
    const rest = items.filter((i) => !returned.has(i.copy_id));
    if (rest.length === 0) throw new SaleError('Mindestens eine Karte muss im Verkauf bleiben – sonst stornieren.');
    const shares = M.distribute(M.netCents(head), rest.map((i) => M.toCents(i.value_at_sale)));
    const upd = db.prepare('UPDATE sale_items SET share = ? WHERE sale_id = ? AND copy_id = ? AND share IS NOT ?');
    rest.forEach((it, i) => upd.run(shares[i] / 100, s.sale_id, it.copy_id, shares[i] / 100));
  })();
}

function cancelSale(db, saleId) {
  db.transaction(() => {
    const s = activeSale(db, saleId);
    if (s.status !== 'aktiv') return;
    db.prepare("UPDATE sales SET status = 'storniert' WHERE sale_id = ?").run(saleId);
    for (const it of db.prepare('SELECT copy_id, was_for_sale FROM sale_items WHERE sale_id = ? AND deleted = 0').all(saleId)) {
      returnCopy(db, saleId, it.copy_id, it.was_for_sale);
    }
  })();
}

function soldInLookup(db) {
  const m = new Map(db.prepare('SELECT copy_id, sold_in FROM card_copies WHERE sold_in IS NOT NULL').all().map((r) => [r.copy_id, r.sold_in]));
  return (id) => m.get(id) ?? null;
}

function salesOverview(db, { period = 'monat', today } = {}) {
  const sales = db.prepare('SELECT * FROM sales WHERE deleted = 0 ORDER BY sold_on DESC, created_at DESC, sale_id').all();
  const items = db.prepare('SELECT sale_id, copy_id, value_at_sale, share, deleted FROM sale_items').all();
  const soldInOf = soldInLookup(db);
  const inPeriod = M.periodFilter(sales, period, today);
  const doubles = M.doubleSold(sales, items);
  return {
    totals: M.saleTotals(inPeriod, items, soldInOf),
    byChannel: M.byChannel(inPeriod, items, soldInOf),
    byMonth: M.byMonth(sales, items, soldInOf, today, 12),
    sales: inPeriod.map((s) => {
      const t = M.saleTotals([{ ...s, status: 'aktiv' }], items, soldInOf);
      return { ...s, netCents: t.netCents, marketCents: t.marketCents,
        cards: items.filter((i) => i.sale_id === s.sale_id && !i.deleted).length, doubleSold: doubles.has(s.sale_id) };
    }),
  };
}

function saleDetail(db, saleId) {
  const sale = activeSale(db, saleId);
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY deleted, value_at_sale DESC, copy_id').all(saleId);
  return { sale, items };
}

function cardSales(db, cardId) {
  return db.prepare(`SELECT si.sale_id, si.copy_id, si.share, si.set_code, si.rarity, si.language, si.edition, si.condition,
                            s.sold_on, s.channel_name, s.status
                       FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id
                      WHERE si.card_id = ? AND si.deleted = 0 AND s.deleted = 0
                      ORDER BY s.sold_on DESC, s.sale_id`).all(String(cardId));
}

module.exports = {
  SaleError, listChannels, saveChannel, hideChannel, previewSale, bookSale, updateSale, cancelSale,
  salesOverview, saleDetail, cardSales,
};
```

Hinweis zur Übersicht eines stornierten Verkaufs: In der Liste zeigt `netCents` eines stornierten Verkaufs den Wert, den er hätte (Aufruf mit `status: 'aktiv'`). Die Oberfläche streicht ihn durch, und er fließt in keine Summe ein.

- [ ] **Step 5: Tests grün**

Run: SQLite-Suite → alle bisherigen + 9 neue grün.

- [ ] **Step 6: Schutz-Nachweise**

1. In `returnCopy` die Zeile `if (!cc || cc.sold_in !== saleId) return;` auf `if (!cc) return;` sabotieren und die `other`-Abfrage auskommentieren. Test „Doppelverkauf" scheitert (`deleted` 0 statt 1). Zitieren, zurücknehmen.
2. In `bookSale` `liveCopies(...)` vor dem `db.transaction` statt darin aufrufen und die Prüfung `rows.some(…)` entfernen. Test „bereits verkauft" scheitert. Zitieren, zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/sales-schema.cjs desktop/electron/sales.cjs desktop/electron/sales.test.cjs desktop/electron/database.cjs
git commit -m "feat(h2): SQLite-Schema und Verkaufs-Helfer (buchen, bearbeiten, Rueckgabe, Storno, Uebersicht)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Desktop-Sync — drei Ströme und `sold_in`

**Files:**
- Modify: `desktop/electron/sync.cjs`
- Create: `desktop/electron/sales-sync.test.cjs`
- Modify: `desktop/electron/test-sync.cjs` (Exemplar-Abbildung mit `sold_in`)

**Interfaces:**
- Consumes: `CHANNEL_COLS, SALE_COLS, ITEM_COLS` (Task 4).
- Produces: in `module.exports` zusätzlich `saleToRemote, remoteToLocalSale, itemToRemote, remoteToLocalItem, channelToRemote, remoteToLocalChannel`, Test-Haken `_applyPulledSales, _applyPulledItems, _applyPulledChannels, _recentlyPushedSales, _recentlyPushedItems, _recentlyPushedChannels, _salesPushRows(db, table, cursor)`. Renderer-Ereignis `sales-changed`.

- [ ] **Step 1: Failing Tests**

`desktop/electron/sales-sync.test.cjs`, gebaut wie `sealed-sync.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const Sync = require('./sync.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');

function freshDb() {
  const db = new Database(':memory:');
  // Wie copies-for-sale.test.cjs: ensureCopiesSchema braucht cards (mit price) und portfolio_history.
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureSalesSchema(db);
  return db;
}
const SALE = { sale_id: 's1', sold_on: '2026-09-21', channel_id: 'ebay', channel_name: 'eBay', gross: 10, fees: null, shipping: 1.6,
  status: 'aktiv', note: null, created_at: '2026-09-21T10:00:00+00:00', updated_at: '2026-09-21T10:00:01.5+00:00', deleted: false };
const ITEM = { sale_id: 's1', copy_id: 'c1', value_at_sale: 3, share: 8.4, was_for_sale: true, card_id: '1', set_code: 'LOB-DE001',
  language: 'DE', rarity: 'Common', edition: 'unknown', condition: 'NM', name: 'X', image_url: null,
  created_at: '2026-09-21T10:00:00+00:00', updated_at: '2026-09-21T10:00:01.5+00:00', deleted: false };

test('Abbildung: Booleans, keine Zeitstempel, Datum bleibt Text', () => {
  const r = Sync.saleToRemote({ ...SALE, deleted: 0, created_at: 'x', updated_at: 'y' });
  assert.equal(r.deleted, false);
  assert.equal(r.sold_on, '2026-09-21');
  assert.ok(!('updated_at' in r) && !('created_at' in r));
  assert.equal(Sync.itemToRemote({ ...ITEM, was_for_sale: 1, deleted: 0 }).was_for_sale, true);
  assert.equal(Sync.remoteToLocalItem(ITEM).was_for_sale, 1);
  assert.ok(!('updated_at' in Sync.remoteToLocalSale(SALE)));
});

test('Pull legt Verkauf und Position an, Echo wird uebersprungen', () => {
  const db = freshDb();
  Sync._recentlyPushedSales.clear(); Sync._recentlyPushedItems.clear();
  assert.equal(Sync._applyPulledSales(db, [SALE]), 1);
  assert.equal(Sync._applyPulledItems(db, [ITEM]), 1);
  assert.equal(db.prepare('SELECT share FROM sale_items').get().share, 8.4);
  Sync._recentlyPushedSales.set('s1', SALE.updated_at);
  assert.equal(Sync._applyPulledSales(db, [SALE]), 0, 'Echo');
  Sync._recentlyPushedItems.set('s1|c1', ITEM.updated_at);
  assert.equal(Sync._applyPulledItems(db, [ITEM]), 0, 'Echo Position');
});

test('Gezogene Zeile wird nicht zurueckgeschoben (Fix I2)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_sales_last_push', '2026-09-20T00:00:00Z')").run();
  Sync._recentlyPushedSales.clear();
  Sync._applyPulledSales(db, [SALE]);
  assert.deepEqual(Sync._salesPushRows(db, 'sales', '2026-09-20 00:00:00'), []);
});

test('Kanaele: feste Kanaele werden ohne Aenderung nicht geschoben', () => {
  const db = freshDb();
  assert.deepEqual(Sync._salesPushRows(db, 'sale_channels', '1970-01-01 00:00:00'), []);
});

test('sold_in reist im Exemplar-Strom mit', () => {
  const r = Sync.copyToRemote({ copy_id: 'c1', card_id: '1', set_code: 'X', language: 'DE', rarity: 'Common', edition: 'unknown',
    condition: 'NM', deleted: 1, for_sale: 0, needs_review: 0, sold_in: 's1' });
  assert.equal(r.sold_in, 's1');
  assert.equal(Sync.remoteToLocalCopy({ copy_id: 'c1', card_id: '1', sold_in: null }).sold_in, null);
});
```

- [ ] **Step 2: Fehlschlag bestätigen** (SQLite-Suite: `Sync.saleToRemote is not a function`).

- [ ] **Step 3: `sync.cjs` erweitern**

1. `COPY_COLS` um `'sold_in'` am Ende erweitern. Das ist die einzige Änderung am Exemplar-Strom.
2. Neben die Sealed-Konstanten setzen:

```js
// Spec H2 §4.3 — Verkaeufe, Positionen und Kanaele als drei weitere Stroeme, gebaut wie Sealed (G3).
// created_at/updated_at wandern aus denselben Gruenden wie bei CONTAINER_PUSH_COLS in keine Richtung mit.
const { CHANNEL_COLS, SALE_COLS, ITEM_COLS } = require('./sales-schema.cjs');
const noStamps = (cols) => cols.filter((c) => c !== 'updated_at' && c !== 'created_at');
const SALES_STREAMS = {
  sale_channels: { cols: noStamps(CHANNEL_COLS), bools: new Set(['builtin', 'deleted']), key: ['channel_id'], cursor: 'sync_sale_channels' },
  sales: { cols: noStamps(SALE_COLS), bools: new Set(['deleted']), key: ['sale_id'], cursor: 'sync_sales' },
  sale_items: { cols: noStamps(ITEM_COLS), bools: new Set(['was_for_sale', 'deleted']), key: ['sale_id', 'copy_id'], cursor: 'sync_sale_items' },
};
const recentlyPushedSalesByTable = { sale_channels: new Map(), sales: new Map(), sale_items: new Map() };
const echoKey = (table, r) => SALES_STREAMS[table].key.map((k) => String(r[k])).join('|');

function salesRowToRemote(table, row) {
  const s = SALES_STREAMS[table]; const out = {};
  for (const c of s.cols) out[c] = s.bools.has(c) ? !!row[c] : (row[c] ?? null);
  return out;
}
function remoteToLocalSalesRow(table, r) {
  const s = SALES_STREAMS[table]; const out = {};
  for (const c of s.cols) out[c] = s.bools.has(c) ? (r[c] ? 1 : 0) : (r[c] ?? null);
  for (const k of ['gross', 'fees', 'shipping', 'value_at_sale', 'share', 'fee_percent']) if (k in out && out[k] != null) out[k] = Number(out[k]);
  if ('sold_on' in out && out.sold_on) out.sold_on = String(out.sold_on).slice(0, 10);
  return out;
}
function applyRemoteSalesRow(db, table, r) {
  const s = SALES_STREAMS[table];
  const l = remoteToLocalSalesRow(table, r);
  const where = s.key.map((k) => `${k} = @${k}`).join(' AND ');
  const cur = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(l);
  const ceiling = pulledUpdatedAtCeiling(db, `${s.cursor}_last_push`);
  if (!cur) {
    l.updated_at = ceiling;
    db.prepare(`INSERT INTO ${table} (${s.cols.join(',')}, updated_at) VALUES (${s.cols.map((c) => '@' + c).join(',')}, @updated_at)`).run(l);
    return;
  }
  if (!s.cols.some((c) => !s.key.includes(c) && (cur[c] ?? null) !== (l[c] ?? null))) return;
  l.updated_at = pulledUpdatedAtFor(ceiling, cur.updated_at);
  const sets = s.cols.filter((c) => !s.key.includes(c)).map((c) => `${c} = @${c}`).join(', ') + ', updated_at = @updated_at';
  db.prepare(`UPDATE ${table} SET ${sets} WHERE ${where}`).run(l);
}
function applyPulledSalesRows(db, table, rows) {
  let applied = 0;
  const echo = recentlyPushedSalesByTable[table];
  for (const r of rows) {
    const k = echoKey(table, r);
    if (echo.get(k) === r.updated_at) { echo.delete(k); continue; }
    applyRemoteSalesRow(db, table, r);
    applied++;
  }
  return applied;
}
function salesPushRows(db, table, cursor) {
  return db.prepare(`SELECT * FROM ${table} WHERE updated_at > ? AND updated_at < strftime('%Y-%m-%d %H:%M:%S','now')`).all(cursor);
}
```

`table` kommt ausschließlich aus den festen Schlüsseln von `SALES_STREAMS`, nie von außen. Die Tabellennamen im SQL sind deshalb unbedenklich.

3. In `startSync` neben `pullSealed`/`pushSealed`:

```js
  async function pullSalesTable(c, table) {
    const s = SALES_STREAMS[table];
    const cursor = getSetting(db, `${s.cursor}_last_pull`) || '1970-01-01T00:00:00Z';
    const PAGE = 1000; let applied = 0; let lastTs = null;
    for (let from = 0; ; from += PAGE) {
      let q = c.from(table).select('*').gt('updated_at', cursor).order('updated_at', { ascending: true });
      for (const k of s.key) q = q.order(k, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(`Pull ${table} failed: ` + error.message);
      if (!data || data.length === 0) break;
      db.transaction(() => { applied += applyPulledSalesRows(db, table, data); })();
      lastTs = data[data.length - 1].updated_at;
      if (data.length < PAGE) break;
    }
    if (lastTs) setSetting(db, `${s.cursor}_last_pull`, lastTs);
    return applied;
  }
  async function pushSalesTable(c, table) {
    const s = SALES_STREAMS[table];
    const cursor = getSetting(db, `${s.cursor}_last_push`) || '1970-01-01T00:00:00Z';
    const changed = salesPushRows(db, table, cursor);
    if (changed.length === 0) return;
    for (let i = 0; i < changed.length; i += 500) {
      const { data, error } = await c.from(table)
        .upsert(changed.slice(i, i + 500).map((r) => salesRowToRemote(table, r)), { onConflict: s.key.join(',') })
        .select(`${s.key.join(',')},updated_at`);
      if (error) throw new Error(`Push ${table} failed: ` + error.message);
      for (const r of (data || [])) recentlyPushedSalesByTable[table].set(echoKey(table, r), r.updated_at);
    }
    setSetting(db, `${s.cursor}_last_push`, changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor));
  }
  // Spec H2 §4.3: fehlen die Cloud-Tabellen (SQL nicht eingespielt), laufen alle anderen Stroeme weiter.
  async function pullSalesSafe(c) {
    let n = 0;
    for (const t of ['sale_channels', 'sales', 'sale_items']) {
      try { n += await pullSalesTable(c, t); } catch (e) { console.error(`[sync] ${t} pull:`, e.message); }
    }
    return n;
  }
  async function pushSalesSafe(c) {
    for (const t of ['sale_channels', 'sales', 'sale_items']) {
      try { await pushSalesTable(c, t); } catch (e) { console.error(`[sync] ${t} push:`, e.message); }
    }
  }
```

4. In `cycle()` nach `const pulledSealed = await pullSealedSafe(c);` die Zeile `const pulledSales = await pullSalesSafe(c);` einfügen, nach `await pushSealedSafe(c);` die Zeile `await pushSalesSafe(c);`. Nach dem Sealed-Block: `if (pulledSales > 0) { const w = getWindow(); if (w) w.webContents.send('sales-changed'); }`, und `totalPulled` um `pulledSales` erweitern.

5. Exporte ergänzen:

```js
  saleToRemote: (r) => salesRowToRemote('sales', r), remoteToLocalSale: (r) => remoteToLocalSalesRow('sales', r),
  itemToRemote: (r) => salesRowToRemote('sale_items', r), remoteToLocalItem: (r) => remoteToLocalSalesRow('sale_items', r),
  channelToRemote: (r) => salesRowToRemote('sale_channels', r), remoteToLocalChannel: (r) => remoteToLocalSalesRow('sale_channels', r),
  _applyPulledSales: (db, rows) => applyPulledSalesRows(db, 'sales', rows),
  _applyPulledItems: (db, rows) => applyPulledSalesRows(db, 'sale_items', rows),
  _applyPulledChannels: (db, rows) => applyPulledSalesRows(db, 'sale_channels', rows),
  _recentlyPushedSales: recentlyPushedSalesByTable.sales,
  _recentlyPushedItems: recentlyPushedSalesByTable.sale_items,
  _recentlyPushedChannels: recentlyPushedSalesByTable.sale_channels,
  _salesPushRows: salesPushRows,
```

6. `test-sync.cjs`: In der bestehenden `copyToRemote`/`remoteToLocalCopy`-Prüfung (Zeile ~90–96) `sold_in: 's1'` in die Eingabe aufnehmen und `assert.strictEqual(c.sold_in, 's1')` ergänzen.

Hinweis zum `pulledUpdatedAtCeiling`: Die Cursor-Schlüssel heißen `sync_sales_last_push` usw. (`${s.cursor}_last_push`). Der Test in Step 1 nutzt genau diesen Schlüssel.

- [ ] **Step 4: Tests grün**

SQLite-Suite (bisher + 5) und `test-sync.cjs` (alle PASS, exit 0).

- [ ] **Step 5: Schutz-Nachweis**

In `applyPulledSalesRows` die Echo-Prüfung per Edit entfernen. „Echo" scheitert. Zitieren, zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/sync.cjs desktop/electron/sales-sync.test.cjs desktop/electron/test-sync.cjs
git commit -m "feat(h2): Sync-Stroeme fuer Verkaeufe, Positionen, Kanaele; sold_in im Exemplar-Strom

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: IPC-Kanäle

**Files:**
- Modify: `desktop/electron/main.cjs` (nach dem H1-Block „Spec H1: Duplikate & Verkaufsliste", vor `// --- Other Handlers ---`)
- Modify: `desktop/electron/preload.cjs` (nach `setForSale`)
- Modify: `desktop/electron/ipc-channels.test.cjs`

**Interfaces:**
- Produces (`window.api`): `listSaleChannels()`, `saveSaleChannel(data)`, `hideSaleChannel(id)`, `previewSale(copyIds)`, `bookSale(data)`, `updateSale(data)`, `cancelSale(saleId)`, `salesOverview({period, today})`, `saleDetail(saleId)`, `cardSales(cardId)`, `onSalesChanged(cb) -> off`. Schreibende Kanäle antworten `{ success: true, … }` oder `{ success: false, error }`.

- [ ] **Step 1: Failing Test**

In `ipc-channels.test.cjs` ergänzen:

```js
// Spec H2 §5–§7: Kanaele, Vorschau, Buchen, Bearbeiten, Storno, Uebersicht, Detail, Kartenansicht.
const H2_CHANNELS = ['sale-channels', 'sale-channel-save', 'sale-channel-hide', 'sale-preview', 'sale-book', 'sale-update',
  'sale-cancel', 'sales-overview', 'sale-detail', 'card-sales'];
```

und `...H2_CHANNELS` in die Schleife aufnehmen. SQLite-Suite: 10 neue Fehlschläge.

- [ ] **Step 2: Handler in `main.cjs`**

Oben bei den `require`s: `const sales = require('./sales.cjs');`. Dann:

```js
// --- Spec H2: Verkaufs-Historie ---
// Regeln in sales.cjs/sales-math.cjs; hier nur die Kanaele. Erwartete Fehler (SaleError) tragen eine deutsche Meldung.
function saleErrorMessage(e, channel) {
    if (e instanceof sales.SaleError) return e.message;
    console.error(`[${channel}]`, e);
    return CONTAINER_COPY_ERROR_MSG;
}
const saleWrite = (channel, fn) => (event, d) => {
    try { return { success: true, ...fn(d) }; }
    catch (e) { return { success: false, error: saleErrorMessage(e, channel) }; }
};
const saleRead = (channel, fn) => (event, d) => {
    try { return fn(d); }
    catch (e) { throw new Error(saleErrorMessage(e, channel)); }
};
ipcMain.handle('sale-channels', saleRead('sale-channels', () => sales.listChannels(db)));
ipcMain.handle('sale-channel-save', saleWrite('sale-channel-save', (d) => ({ channel_id: sales.saveChannel(db, d || {}) })));
ipcMain.handle('sale-channel-hide', saleWrite('sale-channel-hide', (id) => { sales.hideChannel(db, id); return {}; }));
ipcMain.handle('sale-preview', saleRead('sale-preview', (ids) => sales.previewSale(db, ids)));
ipcMain.handle('sale-book', saleWrite('sale-book', (d) => ({ sale_id: sales.bookSale(db, d || {}) })));
ipcMain.handle('sale-update', saleWrite('sale-update', (d) => { sales.updateSale(db, d || {}); return {}; }));
ipcMain.handle('sale-cancel', saleWrite('sale-cancel', (id) => { sales.cancelSale(db, id); return {}; }));
ipcMain.handle('sales-overview', saleRead('sales-overview', (d) => sales.salesOverview(db, d || {})));
ipcMain.handle('sale-detail', saleRead('sale-detail', (id) => sales.saleDetail(db, id)));
ipcMain.handle('card-sales', saleRead('card-sales', (id) => sales.cardSales(db, id)));
```

- [ ] **Step 3: `preload.cjs`**

```js
  // Spec H2: Verkaeufe
  listSaleChannels: () => ipcRenderer.invoke('sale-channels'),
  saveSaleChannel: (data) => ipcRenderer.invoke('sale-channel-save', data),
  hideSaleChannel: (id) => ipcRenderer.invoke('sale-channel-hide', id),
  previewSale: (copyIds) => ipcRenderer.invoke('sale-preview', copyIds),
  bookSale: (data) => ipcRenderer.invoke('sale-book', data),
  updateSale: (data) => ipcRenderer.invoke('sale-update', data),
  cancelSale: (saleId) => ipcRenderer.invoke('sale-cancel', saleId),
  salesOverview: (data) => ipcRenderer.invoke('sales-overview', data),
  saleDetail: (saleId) => ipcRenderer.invoke('sale-detail', saleId),
  cardSales: (cardId) => ipcRenderer.invoke('card-sales', cardId),
  onSalesChanged: (cb) => { const s = (_e) => cb(); ipcRenderer.on('sales-changed', s); return () => ipcRenderer.removeListener('sales-changed', s); },
```

- [ ] **Step 4: Tests grün** (SQLite-Suite, `test-sync.cjs`).

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/ipc-channels.test.cjs
git commit -m "feat(h2): IPC-Kanaele fuer Verkaeufe

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Controller-Halt nach Task 6:** Dem Nutzer `supabase/sales_schema.sql` und die Prüfabfrage vorlegen. Weiter erst nach seiner Bestätigung. Der PC-Build mit Task 5 darf vorher **nicht** installiert werden (siehe Abschnitt SQL).

---

### Task 7: PC — Buchungsdialog und Einstiege

**Files:**
- Create: `desktop/src/components/SaleDialog.jsx`
- Modify: `desktop/src/components/ForSaleList.jsx`, `desktop/src/components/CopySheet.jsx`

**Interfaces:**
- Consumes: `window.api.listSaleChannels/previewSale/bookSale/cancelSale`, `saleMath.js` (`toCents, netCents, feeDefaultCents, diffText, euroCentsText`), `createBusyGate`.
- Produces: `<SaleDialog copyIds={string[]} initialGrossCents={number|null} onClose={() => void} onBooked={(saleId) => void} />`. `initialGrossCents` ist in H2a `null`, dann steht die Summe der Marktwerte als Vorbelegung. H2b (Task 12) übergibt die Summe der Vorschläge.

- [ ] **Step 1: `SaleDialog.jsx` schreiben**

```jsx
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { createBusyGate } from '../utils/busyGate';
import { toCents, netCents, feeDefaultCents, diffText, euroCentsText } from '../utils/saleMath';

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const toInput = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
const parse = (s) => (String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.')));

// Spec H2 §5.2 -- Verkauf buchen. Gebucht und verteilt wird im Hauptprozess (sales.cjs), hier nur Vorschau.
export default function SaleDialog({ copyIds, initialGrossCents = null, onClose, onBooked }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [channels, setChannels] = useState(null);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState(() => ({ channel_id: 'cardmarket', sold_on: todayLocal(), gross: '', fees: '', shipping: '', note: '', feesTouched: false, grossTouched: false }));

  useEffect(() => {
    let alive = true;
    Promise.all([window.api.listSaleChannels(), window.api.previewSale(copyIds)])
      .then(([ch, pv]) => {
        if (!alive) return;
        setChannels(ch);
        setPreview(pv);
        setForm((f) => {
          const grossC = initialGrossCents ?? pv.marketCents;
          const fee = ch.find((c) => c.channel_id === f.channel_id)?.fee_percent ?? 0;
          return f.grossTouched ? f : { ...f, gross: toInput(grossC), fees: f.feesTouched ? f.fees : toInput(feeDefaultCents(grossC, fee)) };
        });
      })
      .catch((e) => { if (alive) setError(e?.message || 'Laden fehlgeschlagen.'); });
    return () => { alive = false; };
  }, [copyIds, initialGrossCents]);

  const feeOf = (id) => channels?.find((c) => c.channel_id === id)?.fee_percent ?? 0;
  const set = (patch) => setForm((f) => {
    const next = { ...f, ...patch };
    if (!next.feesTouched && ('gross' in patch || 'channel_id' in patch)) {
      const g = toCents(parse(next.gross)) ?? 0;
      next.fees = toInput(feeDefaultCents(g, feeOf(next.channel_id)));
    }
    return next;
  });

  const net = useMemo(() => netCents({ gross: parse(form.gross) ?? 0, fees: parse(form.fees), shipping: parse(form.shipping) }), [form]);
  const market = preview?.marketCents ?? 0;

  const book = () => gate.run(async () => {
    setBusy(true); setError(null);
    try {
      const res = await window.api.bookSale({ copyIds, channel_id: form.channel_id, sold_on: form.sold_on,
        gross: parse(form.gross), fees: parse(form.fees), shipping: parse(form.shipping), note: form.note });
      if (!res?.success) { setError(res?.error || 'Buchen fehlgeschlagen.'); return; }
      window.dispatchEvent(new Event('collection-dirty'));
      onBooked?.(res.sale_id);
    } catch (e) { setError(e?.message || 'Buchen fehlgeschlagen.'); }
    finally { setBusy(false); }
  });

  const field = 'w-full bg-obsidian-800 border border-line rounded-lg px-3 py-2 text-sm text-ink';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <div className="w-full max-w-md bg-obsidian-700 border border-line rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Verkauft buchen</h2>
          <button type="button" onClick={onClose} className="p-1 text-ink-muted hover:text-ink" aria-label="Schließen"><X className="w-4 h-4" /></button>
        </div>
        {!preview || !channels ? <p className="text-ink-faint">…</p> : (
          <>
            <p className="text-sm text-ink-muted">{preview.items.length} {preview.items.length === 1 ? 'Karte' : 'Karten'} · Marktwert {euroCentsText(market)}</p>
            <label className="block text-xs text-ink-muted">Kanal
              <select className={field} value={form.channel_id} onChange={(e) => set({ channel_id: e.target.value })}>
                {channels.map((c) => <option key={c.channel_id} value={c.channel_id}>{c.name}{c.fee_percent ? ` (${String(c.fee_percent).replace('.', ',')} %)` : ''}</option>)}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">Datum
              <input type="date" className={field} value={form.sold_on} onChange={(e) => set({ sold_on: e.target.value })} />
            </label>
            <label className="block text-xs text-ink-muted">Gesamtpreis (€)
              <input inputMode="decimal" className={field} value={form.gross} onChange={(e) => set({ gross: e.target.value, grossTouched: true })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-ink-muted">Gebühren (€)
                <input inputMode="decimal" className={field} value={form.fees} onChange={(e) => set({ fees: e.target.value, feesTouched: true })} />
              </label>
              <label className="block text-xs text-ink-muted">Versand (€)
                <input inputMode="decimal" className={field} placeholder="nicht erfasst" value={form.shipping} onChange={(e) => set({ shipping: e.target.value })} />
              </label>
            </div>
            <label className="block text-xs text-ink-muted">Notiz
              <input className={field} value={form.note} onChange={(e) => set({ note: e.target.value })} />
            </label>
            <div className="text-sm">
              <div className="text-ink">Netto {euroCentsText(net)}</div>
              <div className={net >= market ? 'text-emerald-400' : 'text-crit'}>{diffText(net, market)} gegenüber Marktwert</div>
            </div>
            {error && <p className="text-sm text-crit">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Abbrechen</button>
              <button type="button" onClick={book} disabled={busy || preview.items.length === 0}
                className="px-4 py-2 rounded-lg text-sm bg-space-violet text-white disabled:opacity-50">{busy ? 'Wird gebucht…' : 'Buchen'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

Hinweis: `setForm` im `.then` ist ein Promise-Callback, also kein setState im Effekt-Körper. `todayLocal()` läuft im `useState`-Initialisierer, also nicht im Render.

- [ ] **Step 2: Einstieg Verkaufsliste (`ForSaleList.jsx`)**

- State `const [picked, setPicked] = useState(() => new Set());` und `const [selling, setSelling] = useState(null); // copyIds | null` und `const [undo, setUndo] = useState(null); // { saleId, n }`.
- Vor jeder Exemplar-Zeile eine Checkbox: `<input type="checkbox" checked={picked.has(id)} onChange={() => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })} aria-label="Für Verkauf auswählen" />`.
- Im Kopf neben „Exportieren": `<button type="button" disabled={picked.size === 0 || busy} onClick={() => setSelling([...picked])} …>Verkauft buchen ({picked.size})</button>`.
- `{selling && <SaleDialog copyIds={selling} onClose={() => setSelling(null)} onBooked={async (saleId) => { setUndo({ saleId, n: selling.length }); setSelling(null); setPicked(new Set()); await reload(); }} />}`.
- Hinweiszeile, wenn `undo`: `{undo.n} {undo.n === 1 ? 'Karte' : 'Karten'} als verkauft gebucht ·` plus Knopf „Rückgängig", der über `gate.run` `window.api.cancelSale(undo.saleId)` aufruft, dann `collection-dirty` feuert, `reload()` aufruft und `setUndo(null)` setzt. Scheitert der Aufruf, `setError(res.error)`.
- `picked` beim Neuladen bereinigen: `const pickedLive = useMemo(() => new Set([...picked].filter((id) => byId.has(id))), [picked, byId]);`. Knopf und Dialog nutzen `pickedLive`.

- [ ] **Step 3: Einstieg Exemplar-Sheet (`CopySheet.jsx`)**

Neben „Entfernen" einen Knopf „Verkauft…" einfügen. Er ist gesperrt, solange `saving || removing || markingSale` läuft, und setzt `setSellingOpen(true)`. Darunter kommt `{sellingOpen && <SaleDialog copyIds={[copy.copy_id]} onClose={() => setSellingOpen(false)} onBooked={() => { setSellingOpen(false); onSaved?.(); onClose?.(); }} />}`. Der Knopf erscheint nur, wenn `copy?.copy_id` gesetzt ist.

- [ ] **Step 4: Prüfen**

In `desktop/`: `npx eslint .` → genau 5 Fehler; `npx vite build` ok; Helfer-Tests grün.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/SaleDialog.jsx desktop/src/components/ForSaleList.jsx desktop/src/components/CopySheet.jsx
git commit -m "feat(h2): PC Verkauf buchen aus Verkaufsliste und Exemplar-Sheet, mit Rueckgaengig

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: PC — Übersicht, Detail (Bearbeiten/Storno), „Verkauft", Kanäle

**Files:**
- Create: `desktop/src/components/SalesPanel.jsx`, `desktop/src/components/SaleDetail.jsx`
- Modify: `desktop/src/components/Insights.jsx`, `desktop/src/components/CardDetailPanel.jsx`, `desktop/src/components/Settings.jsx`

**Interfaces:**
- Consumes: `window.api.salesOverview/saleDetail/updateSale/cancelSale/cardSales/listSaleChannels/saveSaleChannel/hideSaleChannel/onSalesChanged`, `saleMath.js` (`euroCentsText, diffText, toCents, netCents`).
- Produces: `<SalesPanel />`, `<SaleDetail saleId onClose onChanged />`.

- [ ] **Step 1: `SalesPanel.jsx`**

- State `period` ∈ `monat|jahr|gesamt` (Standard `monat`), `data` (null = „…"), `error`, `openId`. „Heute" per `useState(() => todayLocal())` (dieselbe Funktion wie im Dialog, dort als `export` aus einer neuen Mini-Datei `src/utils/today.js` bereitstellen; `SaleDialog` importiert sie dann ebenfalls).
- Laden: `useCallback` `load = () => window.api.salesOverview({ period, today }).then(setData).catch(() => setError('Verkäufe konnten nicht geladen werden.'))`. Das `useEffect` ruft `load()` auf und hört auf `onSalesChanged` und `collection-dirty`. Nach dem Muster von `useSaleData` wird dort nur im Promise-Callback gesetzt.
- Kopf: drei Knöpfe „Dieser Monat", „Dieses Jahr", „Gesamt".
- Kacheln: „Netto" `euroCentsText(t.netCents)`, „Marktwert beim Verkauf" `euroCentsText(t.marketCents)`, „Differenz" `diffText(t.netCents, t.marketCents)` (grün/rot), „Verkäufe" `${t.sales} · ${t.cards} Karten`.
- Tabelle je Kanal: Spalten Kanal · Verkäufe · Netto · Gebühren · Differenz (`euroCentsText(diffCents)` mit Vorzeichen). Leer: „Keine Verkäufe im Zeitraum."
- Diagramm: recharts `BarChart` über `data.byMonth` (x = `month` als „MM/JJ", y = `netCents / 100`), Tooltip über `euroCentsText`. Import wie in `Portfolio.jsx`: `import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';`.
- Liste: `data.sales` (schon neueste zuerst). Zeile: Datum (`sold_on` als `TT.MM.JJJJ`), Kanal, Karten, Netto, Differenz. Storniert: `line-through text-ink-faint` und Zusatz „storniert". `doubleSold`: rote Marke „Karte doppelt verkauft". Klick → `setOpenId(sale_id)`.
- `{openId && <SaleDetail saleId={openId} onClose={() => setOpenId(null)} onChanged={load} />}`.

- [ ] **Step 2: `SaleDetail.jsx`**

- Lädt `window.api.saleDetail(saleId)` (Promise-Callback) und `listSaleChannels()`.
- Kopf: Datum, Kanal, Status, Notiz. Summen: Preis, Gebühren, Versand, Netto, Marktwert, Differenz.
- Positionen: Bild (`image_url`), Name, `set_code · rarity · language`, `condition · edition`, Marktwert `value_at_sale`, Anteil `share`. Zurückgegebene Positionen (`deleted = 1`) stehen ausgegraut mit „zurückgenommen".
- **Bearbeiten** (nur `status = 'aktiv'`): Formular wie im Dialog (Kanal, Datum, Preis, Gebühren, Versand, Notiz; Gebühren **nicht** automatisch neu belegen, weil der Nutzer bearbeitet). Dazu je lebender Position eine Checkbox „zurücknehmen". Speichern über `gate.run` → `window.api.updateSale({ sale_id, …, returnCopyIds })`, bei Erfolg `collection-dirty`, `onChanged()`, neu laden.
- **Stornieren** (nur aktiv): `confirm('Verkauf stornieren? Alle Karten kommen in die Sammlung zurück.')` → `cancelSale`, bei Erfolg `collection-dirty`, `onChanged()`, `onClose()`.
- Fehler aus `res.error` sichtbar anzeigen.

- [ ] **Step 3: `Insights.jsx`**

Import `import { Receipt } from 'lucide-react';` (ergänzen) und `import SalesPanel from './SalesPanel';`. Neuer Reiter nach „Alarme": `<Tab id="verkaeufe" icon={Receipt} label="Verkäufe" view={view} setView={setView} />` und `{view === 'verkaeufe' && <SalesPanel />}`.

- [ ] **Step 4: `CardDetailPanel.jsx` — Abschnitt „Verkauft"**

- State `const [sold, setSold] = useState([]);`. Laden in dem Effekt, der die Karte lädt (dort, wo `setCard` im Promise-Callback steht): zusätzlich `window.api.cardSales?.(id).then((r) => setSold(Array.isArray(r) ? r : [])).catch(() => setSold([]))`.
- Vor dem Abschnitt „Beschreibung" (Zeile ~409), nur wenn `sold.length > 0`:

```jsx
<div>
  <h3 className="text-lg font-semibold text-gray-300 mb-2">Verkauft</h3>
  <div className="space-y-1">
    {sold.map((s) => (
      <div key={`${s.sale_id}|${s.copy_id}`} className={`flex items-center gap-2 text-[11px] font-mono ${s.status === 'storniert' ? 'line-through text-ink-faint' : 'text-ink-muted'}`}>
        <span>{s.sold_on.split('-').reverse().join('.')}</span><span>{s.channel_name}</span>
        <span>{s.set_code} · {s.rarity} · {s.condition}</span>
        <span className="ml-auto text-gold">{euroCentsText(toCents(s.share))}</span>
      </div>
    ))}
  </div>
</div>
```

Hinweis: `CardDetailPanel` blendet sich bei einer Karte ohne lebenden Druck heute nicht selbst aus. Er wird aus Sammlung und Suche geöffnet. Eine komplett verkaufte Karte erreicht man am PC über die Suche und die Verkaufs-Übersicht. Mehr ist dort nicht zu tun.

- [ ] **Step 5: `Settings.jsx` — Verkaufskanäle**

Neuer Abschnitt „Verkaufskanäle" neben „Duplikate: behalten je Karte":
- Liste aus `listSaleChannels()`. Je Kanal: Name (bei festen Kanälen nur Text, bei eigenen ein Eingabefeld), Gebühr in % (Eingabefeld, Komma erlaubt) und „Speichern" (`saveSaleChannel({ channel_id, name, fee_percent })`). Eigene Kanäle bekommen zusätzlich „Ausblenden" (`hideSaleChannel`).
- Zeile „Neuer Kanal": Name, Gebühr, „Anlegen".
- Hinweistext: „Gebühren sind vorbelegt – bitte mit deinen eigenen Konditionen abgleichen. Alte Verkäufe behalten den Namen, den der Kanal beim Buchen hatte."
- Fehler aus `res.error` anzeigen.

- [ ] **Step 6: Prüfen**

Lint 5 Fehler, `vite build` ok, Helfer grün.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/SalesPanel.jsx desktop/src/components/SaleDetail.jsx desktop/src/components/Insights.jsx desktop/src/components/CardDetailPanel.jsx desktop/src/components/Settings.jsx desktop/src/utils/today.js desktop/src/components/SaleDialog.jsx
git commit -m "feat(h2): PC Verkaufs-Uebersicht, Detail mit Bearbeiten/Storno, Abschnitt Verkauft, Kanal-Einstellungen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Handy — Daten und RPC-Aufrufe

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/Sale.kt`, `cloud/SalesRepository.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/SalesRepositoryTest.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt`

**Interfaces:**
- Consumes: `SalesMath` (Task 2), Cloud-Funktionen aus Task 3.
- Produces:
  - `data class SaleChannel(val channelId: String, val name: String, val feePercent: Double, val builtin: Boolean, val sort: Int)`
  - `data class SaleItemRow(val saleId, val copyId, val valueAtSale: Double, val share: Double, val wasForSale: Boolean, val cardId, val setCode, val language, val rarity, val edition, val condition, val name: String?, val imageUrl: String?, val deleted: Boolean)`
  - `data class SalesData(val sales: List<SalesMath.SaleHead>, val notes: Map<String, String?>, val items: List<SaleItemRow>, val soldIn: Map<String, String?>, val channels: List<SaleChannel>) { fun soldInOf(id: String): String? = soldIn[id]; fun lines(): List<SalesMath.SaleLine> }`
  - `object SalesRepository { suspend fun load(): SalesData; fun bookBody(saleId: String, head: SaleHeadInput, items: List<Pair<String, Long>>, shares: List<Long>): JSONObject; suspend fun book(...); suspend fun update(...); suspend fun cancel(saleId: String); suspend fun saveChannel(...); suspend fun hideChannel(id: String); internal fun parseSales/parseItems/parseChannels(text) }`
  - `data class SaleHeadInput(val soldOn: String, val channelId: String, val channelName: String, val gross: Double, val fees: Double?, val shipping: Double?, val note: String?)`
  - `SideStores.sales: ListCache<SalesData>` (in `clearAll()` leeren).

- [ ] **Step 1: Failing Test (reine Teile)**

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.SaleHeadInput
import com.example.yugiohscanner.cloud.SalesRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SalesRepositoryTest {
    @Test fun `Buchungs-Nutzlast fuer book_sale`() {
        val body = SalesRepository.bookBody("s1", SaleHeadInput("2026-09-21", "ebay", "eBay", 10.0, null, 1.6, " "),
            listOf("c1" to 300L, "c2" to 100L), listOf(630L, 210L))
        val sale = body.getJSONObject("p_sale")
        assertEquals("s1", sale.getString("sale_id"))
        assertTrue(sale.isNull("fees"))
        assertEquals(1.6, sale.getDouble("shipping"), 0.0)
        assertTrue("leere Notiz wird null", sale.isNull("note"))
        val items = body.getJSONArray("p_items")
        assertEquals(3.0, items.getJSONObject(0).getDouble("value_at_sale"), 0.0)
        assertEquals(6.3, items.getJSONObject(0).getDouble("share"), 0.0)
    }
    @Test fun `Verkaeufe und Positionen lesen`() {
        val s = SalesRepository.parseSales("""[{"sale_id":"s1","sold_on":"2026-09-21","channel_id":"ebay","channel_name":"eBay","gross":10,"fees":null,"shipping":"1.60","status":"aktiv","note":null,"deleted":false}]""")
        assertEquals(1.6, s.first().head.shipping!!, 0.0)
        val i = SalesRepository.parseItems("""[{"sale_id":"s1","copy_id":"c1","value_at_sale":3,"share":8.4,"was_for_sale":true,"card_id":"1","set_code":"X","language":"DE","rarity":"Common","edition":"unknown","condition":"NM","name":null,"image_url":null,"deleted":false}]""")
        assertTrue(i.first().wasForSale)
        assertEquals(null, i.first().name)
    }
}
```

`parseSales` liefert `List<ParsedSale>` mit `data class ParsedSale(val head: SalesMath.SaleHead, val note: String?)`. PostgREST kann `numeric` als Zahl oder als Text liefern, daher lesen alle Geldfelder über `optDouble` mit Rückfall auf `getString(...).toDouble()` (Hilfsfunktion `num(o, k): Double?`).

- [ ] **Step 2: Fehlschlag bestätigen** (Kompilierfehler).

- [ ] **Step 3: `Sale.kt` und `SalesRepository.kt`**

`Sale.kt` enthält die Datenklassen aus „Interfaces". `SalesRepository` folgt Bauart und Fehlertexten von `SealedRepository` (Auth-Kopf, `executeWithReauth`, `err(what, r)`):
- `load()`: vier GETs, jeweils `limit=10000`:
  - `sales?select=sale_id,sold_on,channel_id,channel_name,gross,fees,shipping,status,note,deleted&deleted=eq.false&order=sold_on.desc,created_at.desc`
  - `sale_items?select=*`
  - `card_copies?select=copy_id,sold_in&sold_in=not.is.null`
  - `sale_channels?select=channel_id,name,fee_percent,builtin,sort&deleted=eq.false&order=sort.asc,name.asc`
  
  Ergebnis `SalesData`.
- `book(head, items: List<Pair<copyId, valueCents>>)`: `shares = SalesMath.distribute(SalesMath.netCents(head.gross, head.fees, head.shipping), items.map { it.second })`, dann POST `rest/v1/rpc/book_sale` mit `bookBody(UUID, head, items, shares)`. Gibt die `saleId` zurück. Die Fehlermeldung der Datenbank (`message` im JSON) wird unverändert als `RuntimeException` weitergereicht: `JSONObject(text).optString("message")` oder der Rohtext.
- `update(saleId, head, remaining: List<Pair<copyId, valueCents>>, returned: List<String>)`: `shares` wie oben über `remaining`, POST `rpc/update_sale` mit `{p_sale: {..., sale_id}, p_shares: [{copy_id, share}], p_returned: [...]}`.
- `cancel(saleId)`: POST `rpc/cancel_sale` mit `{p_sale_id}`.
- `saveChannel(channelId: String?, name: String, feePercent: Double)`: Name leer → `IllegalArgumentException("Der Kanal braucht einen Namen.")`, Gebühr außerhalb 0–100 → `"Die Gebühr muss zwischen 0 und 100 % liegen."`. Ohne `channelId` POST mit neuer UUID, sonst PATCH `channel_id=eq.<id>&deleted=eq.false`.
- `hideChannel(id)`: PATCH `deleted=true` mit Filter `builtin=eq.false`.

`bookBody` (rein, getestet):

```kotlin
fun bookBody(saleId: String, head: SaleHeadInput, items: List<Pair<String, Long>>, shares: List<Long>): JSONObject =
    JSONObject().put("p_sale", headJson(head).put("sale_id", saleId))
        .put("p_items", JSONArray().apply {
            items.forEachIndexed { i, (id, v) -> put(JSONObject().put("copy_id", id).put("value_at_sale", v / 100.0).put("share", shares[i] / 100.0)) }
        })

private fun headJson(h: SaleHeadInput): JSONObject = JSONObject()
    .put("sold_on", h.soldOn).put("channel_id", h.channelId).put("channel_name", h.channelName).put("gross", h.gross)
    .put("fees", h.fees ?: JSONObject.NULL).put("shipping", h.shipping ?: JSONObject.NULL)
    .put("note", h.note?.trim()?.takeIf { it.isNotEmpty() } ?: JSONObject.NULL)
```

`SideStores`: `val sales = ListCache(scope) { SalesRepository.load() }` und `sales.clear()` in `clearAll()`.

- [ ] **Step 4: Android-Tests grün** (+2).

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/Sale.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SalesRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt android/app/src/test/java/com/example/yugiohscanner/SalesRepositoryTest.kt
git commit -m "feat(h2): Handy-Daten fuer Verkaeufe und Aufrufe der Cloud-Funktionen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Handy — Buchen

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/SaleSheet.kt`
- Modify: `android/.../ui/SaleLists.kt` (`ForSaleList`), `android/.../ui/CopySheet.kt`

**Interfaces:**
- Consumes: `SalesRepository`, `SideStores.sales`, `SalesMath`, `CollectionStore`, `InFlight`.
- Produces: `@Composable fun SaleSheet(copyIds: List<String>, initialGrossCents: Long? = null, onDismiss: () -> Unit, onBooked: (saleId: String, count: Int) -> Unit)`.

- [ ] **Step 1: `SaleSheet.kt`**

- `ModalBottomSheet` wie `KartenInfoSheet`.
- `val sales by SideStores.sales.state.collectAsState()`, dazu `LaunchedEffect(Unit) { SideStores.sales.ensureLoaded() }`.
- **Sperre** (Plan-Abweichung 4): `val offline = sales.value == null || sales.error != null`. Ist sie gesetzt, erscheint die Zeile „Keine Verbindung – Verkäufe nicht geladen" (ErrorColor) mit dem Knopf „Erneut versuchen" (`SideStores.sales.refresh()`), und „Buchen" ist gesperrt.
- Werte aus dem Speicher: `val ready = CollectionStore.state.value as? StoreState.Ready`. Je `copyId` wird die `CopyRow` gesucht und dazu der Druck (`CardRow`, gleicher `printingKey`). `valueCents = SalesMath.marketValueCents(card, copy)`. Fehlt ein Exemplar, steht „Karte nicht mehr in der Sammlung" da, und Buchen ist gesperrt.
- Felder: Kanal (`ExposedDropdownMenuBox` aus `sales.value.channels`), Datum (`OutlinedTextField`, vorbelegt `LocalDate.now().toString()`, gültig nur bei `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`), Gesamtpreis, Gebühren, Versand, Notiz. Vorbelegung und Nachführung wie am PC: Gebühren folgen Preis und Kanal, bis der Nutzer sie anfasst.
- Anzeige: Anzahl Karten, Marktwert, Netto, `SalesMath.diffText`.
- „Buchen" über `InFlight`: Innerhalb der Mutation wird der **frische** Speicherstand gelesen (`CollectionStore.state.value`) und die Werte neu berechnet. Dann `SalesRepository.book(head, items)`, `CollectionStore.awaitSync()`, `SideStores.sales.refreshAndWait()`, `onBooked(saleId, items.size)`. Fehler zeigt die Zeile „Nicht gebucht: <Meldung>".

- [ ] **Step 2: Einstieg Verkaufsliste (`SaleLists.kt#ForSaleList`)**

- `var picked by remember { mutableStateOf(setOf<String>()) }`, `var selling by remember { mutableStateOf<List<String>?>(null) }`, `var undo by remember { mutableStateOf<Pair<String, Int>?>(null) }`.
- Je Exemplar-Zeile vorne eine `Checkbox(checked = id in picked, onCheckedChange = { picked = if (it) picked + id else picked - id })`.
- Unter dem Kopf `Button(onClick = { selling = picked.filter { data.byId.containsKey(it) } }, enabled = !busy && picked.isNotEmpty()) { Text("Verkauft buchen (${picked.size})") }`.
- `selling?.let { SaleSheet(it, onDismiss = { selling = null }, onBooked = { id, n -> undo = id to n; selling = null; picked = emptySet() }) }`.
- `undo`: Zeile „N Karten als verkauft gebucht" plus `TextButton("Rückgängig")`. Er ruft über das bestehende `mutate`-Gatter `SalesRepository.cancel(id)` auf, danach `SideStores.sales.refreshAndWait()`, dann `undo = null`.

- [ ] **Step 3: Einstieg Exemplar-Sheet (`CopySheet.kt`)**

Knopf „Verkauft…" neben „Entfernen". Er ist gesperrt, solange `savingRef[0]`, und öffnet `SaleSheet(listOf(copy.copyId), onDismiss = …, onBooked = { _, _ -> onSaved(); onDismiss() })`.

- [ ] **Step 4: Prüfen**

Android-Befehl → `BUILD SUCCESSFUL`, Testzahl unverändert zu Task 9, `AndroidRegexWaechterTest` grün.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/SaleSheet.kt android/app/src/main/java/com/example/yugiohscanner/ui/SaleLists.kt android/app/src/main/java/com/example/yugiohscanner/ui/CopySheet.kt
git commit -m "feat(h2): Handy Verkauf buchen aus Verkaufsliste und Exemplar-Sheet

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Handy — Übersicht, Detail, „Verkauft", Kanäle

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/SalesScreen.kt`
- Modify: `android/.../ui/InsightsScreen.kt`, `android/.../ui/CardDetailScreen.kt`, `android/.../ui/SettingsScreen.kt`

**Interfaces:**
- Consumes: `SideStores.sales`, `SalesMath`, `SalesRepository`.
- Produces: `@Composable fun SalesSection(onOpenCard: (String) -> Unit)`, `@Composable fun SaleDetailSheet(saleId: String, onDismiss: () -> Unit)`, `@Composable fun CardSoldSection(cardId: String)`.

- [ ] **Step 1: `SalesScreen.kt`**

- `SalesSection`:
  - `FilterChip`s „Monat", „Jahr" und „Gesamt".
  - Die Kennzahlen werden per `remember(data, period, today)` mit `SalesMath.periodFilter` / `totals` / `byChannel` / `byMonth` berechnet (`today = LocalDate.now().toString()`, einmal per `remember`).
  - Solange `data == null`, steht „…" da.
  - Kacheln wie am PC, Kanal-Tabelle als `Row`s.
  - Die 12 Monatsbalken sind ein eigener `Canvas`: Balkenhöhe proportional zu `netCents` (negativ als roter Balken nach unten, Nulllinie in der Mitte, wenn ein Wert negativ ist). Darunter die Monatskürzel.
  - Liste der Verkäufe (neueste zuerst): storniert mit `TextDecoration.LineThrough`, doppelt mit roter Marke „Karte doppelt verkauft". Tipp → `SaleDetailSheet`.
- `SaleDetailSheet`:
  - Kopf, Summen und Positionen (Momentaufnahme: Bild, Name, Druck, Marktwert, Anteil). Zurückgenommene Positionen ausgegraut.
  - **Bearbeiten**: Felder wie im `SaleSheet` plus Checkbox „zurücknehmen" je lebender Position. Speichern über `InFlight` → `SalesRepository.update(saleId, head, remaining, returned)`, dann `CollectionStore.awaitSync()` und `SideStores.sales.refreshAndWait()`.
  - **Stornieren**: `AlertDialog` „Verkauf stornieren?" mit dem Text „Alle Karten kommen in die Sammlung zurück." und den Knöpfen „Stornieren"/„Abbrechen". Danach `SalesRepository.cancel`, `awaitSync` und `refreshAndWait`.
  - Beides ist gesperrt, wenn offline (Sperre wie `SaleSheet`) oder `status != "aktiv"`.
- `CardSoldSection(cardId)`:
  - Positionen `items.filter { it.cardId == cardId && !it.deleted }` samt Verkaufskopf.
  - Datum `TT.MM.JJJJ`, Kanal, Druck, Anteil. Storniert durchgestrichen.
  - Leer → nichts anzeigen.

- [ ] **Step 2: `InsightsScreen.kt`**

Vierter Reiter „Verkäufe" (`tab == "verkaeufe"`, Index 3) und `if (tab == "verkaeufe") SalesSection(onOpenCard = { detailId = it })`. Im `RefreshableBox.onRefresh` zusätzlich `SideStores.sales.refreshAndWait()`. `LaunchedEffect(tab) { if (tab == "verkaeufe") SideStores.sales.ensureLoaded() }`.

- [ ] **Step 3: `CardDetailScreen.kt`**

- `val salesState by SideStores.sales.state.collectAsState()`, dazu `LaunchedEffect(Unit) { SideStores.sales.ensureLoaded() }`.
- `val soldHere = salesState.value?.items?.any { it.cardId == cardId && !it.deleted } == true`.
- `gone` wird zu `ready != null && base == null && !soldHere && salesState.value != null`. Ist `base == null && soldHere`, erscheint statt `return` ein einfacher Kopf (Name aus `catalogCard?.nameDe` oder aus der ersten Position) mit dem Text „Nicht mehr in der Sammlung", darunter `CardSoldSection(cardId)`. Sonst folgt `CardSoldSection(cardId)` am Ende der normalen Ansicht, nach „Deine Exemplare".
- Solange `salesState.value == null` und `base == null`, erscheint „…" statt Schließen (die Verkäufe laden noch).

Wichtig: Diese Änderung darf das bisherige Schließen nach dem Löschen des letzten Drucks nicht brechen. Hat die Karte keine Verkäufe, schließt die Ansicht wie bisher, sobald die Verkäufe geladen sind. Scheitert das Laden (`error != null`), gilt `soldHere = false`, und die Ansicht schließt.

- [ ] **Step 4: `SettingsScreen.kt` — Verkaufskanäle**

Abschnitt wie am PC (Liste, Gebühr ändern, eigenen anlegen und ausblenden, derselbe Hinweistext), über `SalesRepository.saveChannel/hideChannel` und danach `SideStores.sales.refreshAndWait()`.

- [ ] **Step 5: Prüfen**

Android-Befehl → `BUILD SUCCESSFUL`. Testzahl wie Task 9.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/SalesScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/InsightsScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt
git commit -m "feat(h2): Handy Verkaufs-Uebersicht, Detail mit Bearbeiten/Storno, Verkauft in der Kartenansicht, Kanaele

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Ende H2a.** Der Controller fasst den Stand zusammen, bevor H2b beginnt.

---

### Task 12: H2b PC — Preisvorschlag an drei Stellen und Einstellungen

**Files:**
- Modify: `desktop/src/components/ForSaleList.jsx`, `desktop/src/components/CopySheet.jsx`, `desktop/src/components/Settings.jsx`
- Modify: `desktop/electron/export-formats.cjs`, `desktop/electron/collection-export.cjs`, `desktop/electron/export-formats.test.cjs`

**Interfaces:**
- Consumes: `suggestionCents, normalizeDiscount, normalizeMinPrice, marketValueCents` (Renderer `saleMath.js`, Hauptprozess `sales-math.cjs`).
- Produces: `saleListText(copies, rule = { discount: 5, minCents: 10 })`, wobei `rule` optional ist (Vorgabe = Standard). Settings-Schlüssel `sale_discount_percent`, `sale_min_price`.

- [ ] **Step 1: Failing Test (Export)**

In `export-formats.test.cjs` ergänzen:

```js
test('Verkaufsliste zeigt den Preisvorschlag (Spec H2 §9, Plan-Abweichung 6)', () => {
  const cp = { card_id: '1', name: 'Dunkler Magier', set_code: 'LOB-DE005', language: 'DE', rarity: 'Common', edition: 'unlimited', condition: 'NM', price: 2, price_first_ed: null };
  const { text } = saleListText([cp, { ...cp, price: null }], { discount: 5, minCents: 10 });
  assert.match(text, /1× Dunkler Magier – LOB-DE005 – Common – Unlimitiert – NM – 1,90 €/);
  assert.match(text, /– ohne Preis/);
  assert.match(text, /Summe: 2 Karten · 1,90 €/);
});
```

Fehlschlag bestätigen: Der Text enthält noch „2,00 €".

- [ ] **Step 2: `export-formats.cjs`**

`saleListText(copies, rule = { discount: 5, minCents: 10 })`: Je Gruppe gilt `const sugg = suggestionCents(marketValueCents(g, g), rule.discount, rule.minCents)`. Das Stück ist dann `sugg != null ? euroText(sugg / 100) : 'ohne Preis'`, und in die Summe fließt `(sugg ?? 0) * g.count` in Cent. `pieceValue` bleibt für die CSV-Formate unverändert. Den Import `const { suggestionCents, marketValueCents } = require('./sales-math.cjs');` ergänzen.

`collection-export.cjs`: an der Stelle, die `saleListText(...)` aufruft, die Regel aus den Einstellungen lesen: `{ discount: normalizeDiscount(getSetting('sale_discount_percent')), minCents: normalizeMinPrice(getSetting('sale_min_price')) }`. Dabei den vorhandenen Settings-Zugriff der Datei nutzen. Gibt es keinen, `db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value`.

Bestehende Verkaufslisten-Tests in `export-formats.test.cjs`, die Marktwerte erwarten, auf die Vorschläge umstellen und die Änderung im Bericht nennen.

- [ ] **Step 3: Verkaufsliste und Dialog**

- `ForSaleList.jsx`: Einstellungen einmal laden (`window.api.getSettings()` im Promise-Callback) → `rule`. Je Exemplar-Zeile neben dem Marktwert `Vorschlag {sugg == null ? '–' : euroCentsText(sugg)}`. Beim Öffnen des Dialogs `initialGrossCents = Summe der Vorschläge der gewählten Exemplare` übergeben. Hat kein gewähltes Exemplar einen Vorschlag, bleibt es `null` (Vorbelegung = Marktwert).
- `CopySheet.jsx`: `SaleDialog` bekommt `initialGrossCents` aus dem Vorschlag des einen Exemplars. Die Einstellungen lädt das Sheet selbst, nach demselben Muster.

- [ ] **Step 4: `Settings.jsx`**

Zwei Felder unter „Verkaufskanäle":
- „Preisvorschlag: Abschlag in %" (ganze Zahl 0–90, Standard 5).
- „Mindestpreis in €" (Standard 0,10).

Gespeichert wird der normalisierte Wert über `saveSetting`. Hinweis: „Vorschlag = Marktwert minus Abschlag, auf 5 Cent abgerundet, nie unter dem Mindestpreis. Wird nicht synchronisiert – auf beiden Geräten gleich einstellen."

- [ ] **Step 5: Prüfen**

SQLite-Suite grün, Helfer grün, Lint 5 Fehler, `vite build` ok.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/components/ForSaleList.jsx desktop/src/components/CopySheet.jsx desktop/src/components/Settings.jsx desktop/electron/export-formats.cjs desktop/electron/collection-export.cjs desktop/electron/export-formats.test.cjs
git commit -m "feat(h2b): PC Preisvorschlag in Verkaufsliste, Buchung und Export; Einstellungen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: H2b Handy — Preisvorschlag an drei Stellen und Einstellungen

**Files:**
- Modify: `android/.../Prefs.kt`, `android/.../ui/SaleLists.kt`, `android/.../ui/SaleSheet.kt`, `android/.../ui/CopySheet.kt`, `android/.../ui/KartenInfoSheet.kt`, `android/.../ui/SettingsScreen.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/PrefsSaleTest.kt`

**Interfaces:**
- Produces: `Prefs.saleDiscount(ctx): Int`, `Prefs.setSaleDiscount(ctx, raw: String): Int`, `Prefs.saleMinCents(ctx): Long`, `Prefs.setSaleMinPrice(ctx, raw: String): Long`, `Prefs.saleSuggestion(ctx, valueCents: Long?): Long?`. Die Normalisierung läuft über `SalesMath.normalizeDiscount/normalizeMinPrice`.

- [ ] **Step 1: Failing Test**

`PrefsSaleTest` prüft nur die reine Verbindung ohne `Context`. Deshalb bekommt `Prefs` eine reine Hilfsfunktion `internal fun suggestionFor(valueCents: Long?, rawDiscount: String?, rawMin: String?): Long? = SalesMath.suggestionCents(valueCents, SalesMath.normalizeDiscount(rawDiscount), SalesMath.normalizeMinPrice(rawMin))`. Der Test:

```kotlin
class PrefsSaleTest {
    @Test fun `Vorschlag mit Standardwerten bei fehlenden Einstellungen`() {
        assertEquals(190L, Prefs.suggestionFor(200L, null, null))
        assertEquals(10L, Prefs.suggestionFor(8L, "5", "0,10"))
        assertEquals(null, Prefs.suggestionFor(0L, "5", "0,10"))
        assertEquals(180L, Prefs.suggestionFor(200L, "10", "abc"))
    }
}
```

- [ ] **Step 2: `Prefs.kt`** — die Funktionen aus „Interfaces", gespeichert als Text unter `sale_discount_percent` und `sale_min_price`.

- [ ] **Step 3: Anzeigen**

- `SaleLists.kt#ForSaleList`: je Exemplar-Zeile „Vorschlag X €" oder „–" (`Prefs.saleSuggestion(ctx, SalesMath.marketValueCents(s.card, s.copy))`). Den Kopf per `remember(data)` einmal rechnen.
- `SaleSheet.kt`: Bekommt `initialGrossCents == null`, wird die Summe der Vorschläge vorbelegt. Hat kein Exemplar einen Vorschlag, bleibt es beim Marktwert. Die Aufrufer übergeben nichts.
- `KartenInfoSheet.kt`: Bei Zeilen mit `z.anzahl > 0` und EUR-Preis kommt unter die Preiszeile `Text("Vorschlag ${…}", style = labelSmall, color = Muted)`. Wert: `Prefs.saleSuggestion(ctx, SalesMath.toCents(z.preis))`. Das ist der Druckpreis ohne Zustandsfaktor, weil die Karten-Info je Druck zeigt, nicht je Exemplar. Der Hinweis „je NM-Exemplar" steht mit dabei.

- [ ] **Step 4: `SettingsScreen.kt`** — zwei Felder mit Hinweis wie am PC.

- [ ] **Step 5: Prüfen** — Android-Befehl, Testzahl +1.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/Prefs.kt android/app/src/main/java/com/example/yugiohscanner/ui/SaleLists.kt android/app/src/main/java/com/example/yugiohscanner/ui/SaleSheet.kt android/app/src/main/java/com/example/yugiohscanner/ui/CopySheet.kt android/app/src/main/java/com/example/yugiohscanner/ui/KartenInfoSheet.kt android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt android/app/src/test/java/com/example/yugiohscanner/PrefsSaleTest.kt
git commit -m "feat(h2b): Handy Preisvorschlag in Verkaufsliste, Buchung und Karten-Info; Einstellungen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Controller-Abschluss (kein Subagent)

- [ ] Endstand messen: SQLite-Suite, `test-sync.cjs`, Helfer, Lint (5), `vite build`, Android `testDebugUnitTest assembleDebug`, Testzahlen je Stufe in den Bericht.
- [ ] Code-Review über den ganzen Zweig (Schwerpunkte: Rückkehr-Regel PC ↔ SQL wortgleich, Transaktionen, Echo-Sperren, Doppeltipp-Gatter, „…"-Platzhalter).
- [ ] Installer bauen in der festen Reihenfolge: `npm rebuild better-sqlite3` → Tests → `npx @electron/rebuild -f -w better-sqlite3 -v 40.1.0` → `npm run dist` → `process.dlopen`-Prüfung auf `win-unpacked`. Nie aus einem Junction-Worktree.
- [ ] APK installieren, App **starten**, `adb logcat -b crash` leer (Lehre `(?U)`).
- [ ] Abnahme mit dem Nutzer (nachdem er die SQL-Datei eingespielt und die Prüfabfrage bestätigt hat):
  1. PC: zwei Karten aus der Verkaufsliste als ein Verkauf buchen, dann „Rückgängig". Beide Karten sind zurück und wieder markiert.
  2. PC: erneut buchen. Nach dem Abgleich erscheint der Verkauf am Handy in Insights › Verkäufe mit denselben Zahlen.
  3. Handy: eine Karte über das Exemplar-Sheet buchen. Am PC erscheint sie nach dem Abgleich, die Karte ist aus der Sammlung weg.
  4. Handy: Teil-Rückgabe einer Position. Am PC ist die Karte zurück, die Anteile sind neu verteilt.
  5. PC: Storno. Am Handy ist der Verkauf durchgestrichen und zählt nicht mehr.
  6. Eine komplett verkaufte Karte in der Kartenansicht am Handy öffnen: Die Ansicht bleibt offen und zeigt „Verkauft".
  7. H2b: Vorschlag in der Verkaufsliste auf beiden Geräten gleich, Export zeigt die Vorschläge, Karten-Info zeigt „Vorschlag".
- [ ] Merge in `main` erst nach der Abnahme, Push nur auf Zuruf.
- [ ] Gedächtnis: `spec-h2-status.md` anlegen und im Index eintragen.

## Selbstprüfung

**Abdeckung der Spec:**

| Spec | Task |
|---|---|
| §4.1/§4.2 Datenmodell | 3, 4 |
| §4.3 Abgleich | 5 |
| §5.1 Einstieg | 7, 10 |
| §5.2 Dialog | 7, 10 |
| §5.3 Verteilung | 1, 2 |
| §5.4 Rückgängig | 7, 10 |
| §5.5 Prüfungen | 4 (PC), 3 (Cloud) |
| §6.1–§6.3 Bearbeiten/Rückgabe/Storno/Fach | 3, 4, 8, 11 |
| §7 Übersicht | 1, 2, 4, 8, 11 |
| §7 Kartenansicht „Verkauft" | 8, 11 |
| §8 Fehlerfälle | 3, 4 (Doppelverkauf, bereits verkauft, Fach), 10/11 (offline, Abweichung 4), 4 (Kanal ausgeblendet: `channel_name`), 1 (ohne Marktwert) |
| §9 Preisvorschlag | 1, 2, 12, 13 |
| §11 Tests | 1, 2, 4, 5, 9, 13, 14 |
| §12 Reihenfolge H2a → H2b, PC → Cloud → Handy | Taskfolge, Controller-Halt nach 6 |
| §13 Risiken | Abschnitt SQL, Controller-Halt |

**Namen quer geprüft:**
- `marketValueCents`, `distribute`, `netCents`, `feeDefaultCents`, `suggestionCents`, `normalizeDiscount`, `normalizeMinPrice`, `diffText`, `euroCentsText`, `doubleSold`, `saleTotals` (JS) / `totals` (Kotlin, im Kopfkommentar als Namensabweichung zu nennen), `periodFilter`, `byChannel`, `byMonth`.
- Cloud-Funktionen `book_sale(p_sale, p_items)`, `update_sale(p_sale, p_shares, p_returned)`, `cancel_sale(p_sale_id)`, identisch in Task 3 und 9.
- IPC-Namen in Task 6, 7, 8 und 12 identisch. Settings-Schlüssel `sale_discount_percent` / `sale_min_price` auf beiden Geräten.

**Bekannte Grenzen:**
- Die Oberflächen-Tasks (7, 8, 10, 11) sind nur gebaut und gelintet, nicht im Fenster oder am Gerät geklickt. Das übernimmt die Abnahme in Task 14.
- Die Cloud-Funktionen werden nie gegen eine Datenbank getestet (Agents dürfen kein SQL ausführen). Die Abnahme deckt sie ab. Die PC-Fassung derselben Regeln ist in Task 4 mit echter SQLite getestet.
