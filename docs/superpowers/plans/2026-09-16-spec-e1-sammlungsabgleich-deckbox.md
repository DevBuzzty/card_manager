# Spec E1 Sammlungsabgleich & Deckbox — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Deck bekommt optional eine Deckbox. Desktop und Handy zeigen pro Deck und pro Karte, was aus der Sammlung vorhanden ist, was schon in der Box steckt, was in einem anderen Deck verplant ist und was fehlt, mit Kosten aus dem Katalogpreis `cm_price`. Zwei Aktionen hängen daran: „Fehlende auf die Wunschliste" (Einträge mit 1,2 × Preis, Deal-Watches, **eine** Cloud-Suche) und „Box befüllen" (Vorschlag nach fester Reihenfolge, Exemplare in die Deckbox verschieben).

**Architecture:** Decks bleiben cloud-only; neu ist nur `decks.container_id` mit Unique-Index (SQL-Datei, spielt der Nutzer ein). Der Katalog-Bau liest `card_prices[0].cardmarket_price` als `cm_price` (Katalog Version 6); der Desktop legt die gebaute Datei zusätzlich lokal ab und liest die Preise daraus, das Handy importiert sie in `CatalogDb` Schema v3. Alle Regeln wohnen in drei reinen Zwillingen: `deckCoverage` (Abgleich, Kennzahlen, Texte, Deckbox-Auswahl), `fillBoxProposal` (Vorschlag, Ortstext, Hinweise) und `deckWishlist` (Auswahl, Höchstpreis, Texte), JS in `desktop/src/utils/`, Kotlin in `android/.../ml/`, beide gegen `docs/fixtures/decks/*.json`. Der Desktop-Hauptprozess bekommt sechs IPC-Kanäle; die Orchestrierung (Unique-Meldung, Cloud-Suche genau einmal, Verschieben Exemplar für Exemplar) steht in `desktop/electron/decks.cjs` und ist mit einer Client-Attrappe getestet. Oberflächen: Desktop neue Komponenten neben `DeckBuilder.jsx`, Handy `DecksScreen.kt`.

**Tech Stack:** Electron CJS + better-sqlite3, React/Vite, Postgres (nur SQL-Datei), Kotlin/Compose (Material3), org.json, node:test, JUnit4, kotlinx-coroutines-test.

**Spec:** `docs/superpowers/specs/2026-09-16-spec-e-nachtrag-e1-sammlungsabgleich-deckbox.md` (vom Nutzer abgesegnet). Sie ändert `docs/superpowers/specs/2026-09-05-spec-e-deckbuilder-pro-design.md` §5.1, §5.2 (Kosten), §5.3, §7 (Abgleich, Deckbox), §8–§11 und setzt A, B1/B2, C, D1 und G1–G4 voraus (zuletzt `bf3115c`; Plan-Basis `f9f008e`).

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus und verbinden sich nie mit Supabase. Das gilt auch für Edge-Function-Aufrufe und Deploys. SQL spielt der Nutzer von Hand im Dashboard ein; der Plan liefert nur die SQL-Datei.
- Immer explizite Pfade stagen, nie `git add -A` und nie `git stash`. Der Stash-Stack ist mit den Worktrees geteilt.
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI). `desktop/node_modules` ist im Worktree eine Junction.
- `cards.quantity` und `cards.deleted` pflegen Trigger; die App schreibt sie nie. Es gibt nur Soft-Delete. (Seit G4 gilt dasselbe für `cards.price_first_ed`.)
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs`.
- Sichtbare Texte sind deutsch mit echten Umlauten, „Fächer" statt „Taschen".
- Regeln wohnen in reinen, getesteten Helfern. Absichtliche Zwillinge werden im Kopfkommentar markiert, der den anderen Zwilling nennt, und auf beiden Seiten gegen gemeinsame Fixtures getestet.
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`). Ein sechster ist ein Fehlschlag.
- Deutsche Set-Codes werden nie aus englischen abgeleitet.
- Ein Test, der gegen einen Fehler schützt, muss nachweislich ohne den Schutz scheitern. Dazu den Schutz kurz sabotieren, den Fehlschlag im Bericht zitieren und die Sabotage zurücknehmen.
- Ein Platzhalter darf nie wie eine leere Sammlung aussehen: solange Daten fehlen, steht „…", nie „0/40".
- Teure Berechnungen laufen in Compose nie unmemoisiert in der Komposition (`remember` mit Schlüsseln; Vorschläge erst im Klick).
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- E1-spezifisch: Nicht drin sind Import/Export-Erweiterungen, Side-Deck am Handy, Legalität, Simulation, `format`/`notes`/`role`/`updated_at`, lokale Spiegelung der Decks, Scanner-Führung in die Deckbox, Herausnehmen überzähliger Exemplare und das Aufteilen von `DeckBuilder.jsx` (Spec §2).
- E1-spezifisch: Keine Edge Function ändert sich. Die Cloud-Suche `scrape-deals` löst weiterhin nur App-Code aus (`triggerCloudScrape` bzw. `DealsRepository.triggerScrape`), nie ein Agent; Tests nutzen Attrappen.

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
| `supabase/decks_container.sql` (neu) | `decks.container_id` + Unique-Index | 1 |
| `desktop/electron/catalog-build.cjs` + `.test.cjs` | `cmPriceOf`, `cm_price` je Karte | 1 |
| `desktop/electron/catalog-prices.cjs` + `.test.cjs` (neu) | Katalogdatei lokal ablegen, `cm_price` lesen | 1 |
| `desktop/electron/catalog-builder.cjs` | Datei nach erfolgreichem Upload speichern | 1 |
| `docs/fixtures/decks/coverage.json`, `fill-box.json`, `wishlist.json` (neu) | gemeinsame Fälle der drei Zwillinge | 2 |
| `desktop/src/utils/deckCoverage.js` + `.test.js` (neu) | Abgleich, Kennzahlen, Texte, Deckbox-Auswahl | 2 |
| `desktop/src/utils/fillBoxProposal.js` + `.test.js` (neu) | Vorschlag „Box befüllen", Ortstext, Hinweise | 2 |
| `desktop/src/utils/deckWishlist.js` + `.test.js` (neu) | Kandidaten, Höchstpreis, Bestätigung, Rückmeldung | 2 |
| `desktop/electron/copies.cjs`, `copies-location.test.cjs` | `listDeckCopies` | 3 |
| `desktop/electron/decks.cjs` + `.test.cjs` (neu) | Deckbox zuordnen, Wunschliste (eine Cloud-Suche), Verschieben | 3 |
| `desktop/electron/main.cjs`, `preload.cjs`, `ipc-channels.test.cjs` (neu) | sechs Kanäle | 3 |
| `desktop/src/components/DeckCoverageHeader.jsx`, `DeckCardNumbers.jsx`, `FillBoxDialog.jsx`, `DeckWishlistDialog.jsx` (neu) | Abgleich-Kopf, Kartenzeilen-Zahlen, Dialoge | 4 |
| `desktop/src/components/DeckBuilder.jsx` | Daten laden, Liste, Kopf, Zeilen, Dialoge | 4 |
| `android/.../cloud/CatalogParser.kt`, `CatalogDb.kt`, `CatalogRepository.kt` | `cm_price`, Schema v3, `cmPrices` | 5 |
| `android/.../CatalogParserTest.kt`, `CatalogSealedTest.kt` | Parser v6/v5, Abfrage, Schema 3 | 5 |
| `android/.../cloud/DecksRepository.kt` (nur Datenklassen) | `Deck.containerId`, `DeckCard.deckId` | 6 |
| `android/.../ml/DeckCoverage.kt`, `FillBoxProposal.kt`, `DeckWishlist.kt` (neu) | Kotlin-Zwillinge | 6 |
| `android/.../DeckFixtureWorld.kt`, `DeckCoverageTest.kt`, `FillBoxProposalTest.kt`, `DeckWishlistTest.kt` (neu) | Fixture-Tests | 6 |
| `android/.../cloud/DecksRepository.kt`, `WishlistRepository.kt`, `SideStores.kt`, `DecksRepositoryTest.kt` (neu) | Cloud-Zugriffe, Cache aller Deckkarten | 7 |
| `android/.../ui/DecksScreen.kt`, `SammlungScreen.kt` | Liste, Editor-Kopf, Zeilen, Sheet, Dialog | 7 |

`android/...` steht für `android/app/src/main/java/com/example/yugiohscanner` (Paket `com.example.yugiohscanner`). Die Tests liegen unter `android/app/src/test/java/com/example/yugiohscanner/` und lesen Fixtures über `Fixtures.text("docs/fixtures/...")`. Die Android-Unit-Tests laufen auf der JVM ohne Robolectric.

Reihenfolge: 1 → 2 → 3 → 4 (Desktop), 5 → 6 → 7 (Handy). Task 5 und 6 hängen nicht von 1–4 ab und dürfen parallel laufen; 7 braucht 5 und 6.

## Plan-Ergänzungen (vom Plan entschieden, bitte dem Nutzer vorlegen)

1. **„Katalog Version 6" ist die nächste gebaute Versionsnummer, kein Formatfeld.** `version` im Katalog ist der fortlaufende Zähler aus `catalog_versions` (heute 5). Der Plan führt kein Formatfeld ein: Ein Leser erkennt Preise am Vorhandensein von `cm_price`; fehlt das Feld (Katalog ≤ 5), ist der Preis `null`.
2. **Der Desktop hält die gebaute Katalogdatei bisher nicht vor** (`runCatalogBuild` lädt den Puffer nur hoch). Neu legt er ihn **nach** erfolgreichem Hochladen und Verbuchen als `<userData>/catalog/catalog.json.gz` ab (temporär schreiben, dann umbenennen). `catalog-prices.cjs` liest daraus `cm_price` und behält das Ergebnis, bis sich Änderungszeit oder Größe der Datei ändern. Erst nach dem Upload, damit Desktop und Handy mit derselben Datei rechnen (Abnahme §12.2). Bis zum ersten Bau nach dem Update gibt es keine Datei: alle Kosten „Preis unbekannt". Ein Fehler beim Ablegen ist nicht fatal für den Bau.
3. **`cardmarket_price` kommt von YGOPRODeck als Zeichenkette** („4.50"). `cmPriceOf` wandelt in eine Zahl; leer, „0.00", unlesbar oder fehlend ergibt `null`.
4. **Sechs neue Desktop-Kanäle** statt Umbau von `get-deck-details`: `list-deck-copies`, `get-all-deck-cards`, `set-deck-container`, `get-catalog-prices`, `deck-missing-to-wishlist`, `move-copies-to-container`. `get-decks` liefert `container_id` schon heute über `select('*')`. Ein Test prüft, dass alle sechs in `main.cjs` und `preload.cjs` stehen.
5. **Eingabeform der Zwillinge.** JS bekommt Exemplare mit `deleted`/`printing_deleted`; Kotlin bekommt `CopyRow`s und die `CardRow`s lebender Printings (ein Exemplar ohne passende `CardRow` zählt nicht). Deckkarten werden je Passcode in der Reihenfolge des ersten Auftretens summiert (mehrere Zeilen je Passcode kommen am Handy vor). `reservedElsewhere` ist nach der Deckliste geordnet. `missingCost` ist `null` ohne Preis, sonst `round2(missing × cm_price)` (also `0` bei nichts Fehlendem); `totals.cost` summiert gerundete Einzelkosten und rundet erneut. Zusätzlich `totals.missingCards` (Passcodes mit Fehlenden), damit „Preis unbekannt" von „+ n ohne Preis" unterscheidbar ist.
6. **Kennzahlen-Texte:** Ohne Fehlende entfällt der Kostenteil („vorhanden 40/40 · in der Box 12/40 · fehlen 0"). „in der Box n/N" steht auch ohne gültige Box (dann 0). Deck-Liste: „Deckbox Rot · 37/40 vorhanden · ca. 42,80 €" bzw. „keine Box · …". Euro-Beträge als „42,80 €" mit Tausenderpunkt, auf beiden Seiten mit normalem Leerzeichen (JS `fmtNum` + „ €", Kotlin `%,.2f €`).
7. **Einzahl und leere Teile:** „1 fehlt noch – nicht in der Sammlung", „1 fehlende Karte auf die Wunschliste setzen?", „1 steht schon drauf", „1 hat keinen Preis und bekommt keine Deal-Suche", „1 Karte auf der Wunschliste". Nebensätze mit 0 entfallen. Gibt es keine Kandidaten, lautet der Dialog „Alle fehlenden Karten stehen schon auf der Wunschliste." ohne „Hinzufügen".
8. **„Deal-Suche läuft." nur mit Deal-Watch.** Die Cloud-Suche wird höchstens einmal und nur dann angestoßen, wenn mindestens ein Deal-Watch entstand; die Rückmeldung heißt sonst „8 Karten auf der Wunschliste.". Ein gescheiterter Eintrag (auch ein Eintrag, den ein anderes Gerät inzwischen angelegt hat) zählt als fehlgeschlagen. Ein gescheiterter Deal-Watch lässt den Eintrag bestehen (bestehende Regel von `add-to-wishlist`). Als Name dient der Deckkartenname, sonst der Passcode (`wishlist.name` ist `not null`).
9. **Deckbox-Auswahl als Zwillingsregel `deckBoxChoices`** (Fixture-Abschnitt `choices`): lebende Deckboxen, deren `container_id` kein anderes Deck trägt, in der Reihenfolge der Behälterliste; davor „Keine Box".
10. **Ortstext:** Behältername ohne Artpräfix (in den Beispielen der Spec ist „Ordner Blau" bzw. „Box Tausch" der Name), bei einem Ordner mit Seite und Fach „Ordner Blau · S. 3 · Fach 2", sonst nur der Name, ohne Behälter „unsortiert". Ein Exemplar, dessen Behälter nicht (mehr) in der Liste steht, gilt als unsortiert (Text und Gruppe 1).
11. **Überzählig** zählt alle lebenden Exemplare in der Box über dem Bedarf, auch solche, deren Passcode gar nicht im Deck steht. „fehlen noch" ist die Deck-Summe `missing`. Beides steht nur im Dialog/Sheet.
12. **Vorschlag eingefroren, Ziel geprüft.** Der Vorschlag wird beim Öffnen berechnet und bleibt stehen, während die Zahlen nach dem Verschieben neu laden. Desktop: `moveCopiesToContainer` prüft vorab, dass das Ziel eine lebende Deckbox ist. Handy: `CollectionRepository.setCopyLocation` wie bisher, Exemplar für Exemplar, danach `CollectionStore.awaitSync()`.
13. **Ladezustand:** „…" gilt, bis Decks, alle Deckkarten, Exemplare/Behälter **und** die Katalogpreise gelesen sind; sonst blitzte kurz „Preis unbekannt" auf. Desktop lädt die Abgleichsdaten zusätzlich bei `collection-changed` (Pull vom Handy) nach.
14. **Desktop-Liste vs. Editor:** Die Deck-Liste rechnet mit den gespeicherten Deckkarten, der Editor-Kopf mit dem ungespeicherten Stand; nach „Save Deck" werden die Daten neu geladen. Englische Alt-Texte in `DeckBuilder.jsx` bleiben (chirurgisch), alle neuen Texte sind deutsch.
15. **„Noch keine Deckbox":** Desktop mit Link „Zu den Behältern" (`ROUTES.binder`). Das Handy zeigt nur den Text (die Spec verlangt den Link nur am Desktop).
16. **Handy-Daten:** `loadDecks` fragt `select=*` statt einer Spaltenliste ab (robust, falls die SQL-Datei später kommt). Alle Deckkarten kommen über einen neuen Cache `SideStores.allDeckCards` in einer Abfrage, ohne Seitenlauf; wie das bestehende `loadCards` gilt die PostgREST-Grenze von 1000 Zeilen, dasselbe für `get-all-deck-cards` am Desktop.
17. **`CatalogDb` v3** nutzt den bestehenden `onUpgrade` (Tabellen verwerfen, `CatalogSync` lädt neu). `CatalogSealedTest` prüft deshalb Version 3 statt 2.
18. **Handy-Wunschliste:** `WishlistRepository.addToWishlist(..., triggerScrape: Boolean = true)` gibt neu zurück, ob ein Deal-Watch entstand. `addMissing` nutzt die reine Orchestrierung `DeckWishlist.addAll` (Kotlin-Gegenstück zu `decks.cjs#addMissingToWishlist`, getestet mit Zähler).
19. **Unique-Verletzung am Handy:** PostgREST antwortet mit 409 und `"code":"23505"` im Körper; `DecksRepository.containerErrorMessage` macht daraus „Diese Deckbox gehört schon zu einem anderen Deck".
20. **`listDeckCopies` Test mit Faktor statt `price_first_ed`:** `price_first_ed` pflegt seit G4 ein Trigger; der Test setzt `cm_first_ed_factor`. Ein Printing mit lebendem Exemplar kann lokal nur über einen Pull gelöscht ankommen (der Recount-Trigger belebt es beim Einfügen); der Test tombstonet deshalb nach dem Einfügen.
21. **Nicht automatisch getestet:** das Ablegen in `runCatalogBuild` (braucht Netz und Cloud-Client) und die Oberflächen. Beides prüft die Abnahme (Übergabe Schritt 2, Abnahme 1–6).

---
### Task 1: SQL-Datei und Katalogpreis `cm_price` (Bau und lokale Datei)

**Files:**
- Create: `supabase/decks_container.sql`
- Modify: `desktop/electron/catalog-build.cjs`
- Modify: `desktop/electron/catalog-build.test.cjs`
- Create: `desktop/electron/catalog-prices.cjs`
- Create: `desktop/electron/catalog-prices.test.cjs`
- Modify: `desktop/electron/catalog-builder.cjs`

**Interfaces:**
- Produces (für Task 3, 5, Nutzer): Cloud-Spalte `public.decks.container_id text` mit Index `decks_container_unique`; `cmPriceOf(apiCard) → number | null` und das Feld `cm_price` je Karte in `mergeCards`; `catalogFilePath(userDataPath) → string`, `saveCatalogFile(userDataPath, buffer) → void`, `readCatalogPrices(userDataPath) → Map<string, number|null> | null`, `catalogPrices(userDataPath) → { available: boolean, prices: { [passcode]: number|null } }` in `catalog-prices.cjs`.
- Consumes (vorhanden): `mergeCards(enCards, deCards)`, `packCatalog(cards, version, sealedProducts)`, `runCatalogBuild(db, { ensureClient, force, userDataPath })`.

- [ ] **Step 1: `supabase/decks_container.sql` schreiben (nur Datei, nichts ausführen)**

```sql
-- supabase/decks_container.sql — Spec E1 §3. Einmal im Dashboard einspielen (idempotent),
-- VOR dem neuen Desktop-Installer und der APK (Spec §10).
-- Ein Deck hat hoechstens eine Deckbox, eine Deckbox gehoert hoechstens einem Deck. Kein Fremdschluessel:
-- Behaelter werden nur soft-geloescht; eine geloeschte oder umgestellte Box gilt in der App als "keine Box",
-- die Spalte wird nicht automatisch geleert. Die bestehende Policy "decks are private" deckt das Update ab.

alter table public.decks add column if not exists container_id text;   -- Deckbox, optional
create unique index if not exists decks_container_unique
  on public.decks (container_id) where container_id is not null;

-- Abnahme (Nutzer, von Hand): select id, name, container_id from public.decks order by id;
```

- [ ] **Step 2: Tests für `cm_price` schreiben**

In `desktop/electron/catalog-build.test.cjs` die Zeile 4 ersetzen:
```js
const { cmPriceOf, mergeCards, attachVerified, packCatalog, sealedKindOf, buildSealedProducts } = require('./catalog-build.cjs');
```
Am Dateiende anhängen:
```js

// Spec E1 §5 — cm_price aus card_prices[0].cardmarket_price; 0 oder fehlend wird null. Katalog Version 6.
test('cmPriceOf liest den Cardmarket-Preis, 0/leer/fehlend wird null', () => {
  assert.equal(cmPriceOf({ card_prices: [{ cardmarket_price: '4.50', tcgplayer_price: '9.99' }] }), 4.5);
  assert.equal(cmPriceOf({ card_prices: [{ cardmarket_price: 12.5 }] }), 12.5);
  assert.equal(cmPriceOf({ card_prices: [{ cardmarket_price: '0.00' }] }), null);
  assert.equal(cmPriceOf({ card_prices: [{ cardmarket_price: '' }] }), null);
  assert.equal(cmPriceOf({ card_prices: [{ cardmarket_price: 'n/a' }] }), null);
  assert.equal(cmPriceOf({ card_prices: [{}] }), null);
  assert.equal(cmPriceOf({ card_prices: [] }), null);
  assert.equal(cmPriceOf({}), null);
});

test('mergeCards schreibt cm_price, der gepackte Katalog Version 6 trägt ihn', () => {
  const withPrice = [{ ...EN[0], card_prices: [{ cardmarket_price: '35.71' }] }];
  assert.equal(mergeCards(withPrice, DE)[0].cm_price, 35.71);
  assert.equal(mergeCards(EN, DE)[0].cm_price, null, 'EN ohne card_prices');
  const back = JSON.parse(zlib.gunzipSync(packCatalog(mergeCards(withPrice, DE), 6).buffer).toString('utf8'));
  assert.equal(back.version, 6);
  assert.equal(back.cards[0].cm_price, 35.71);
});
```

`desktop/electron/catalog-prices.test.cjs` anlegen:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergeCards, packCatalog } = require('./catalog-build.cjs');
const { catalogFilePath, saveCatalogFile, readCatalogPrices, catalogPrices } = require('./catalog-prices.cjs');

const card = (id, cardmarket_price) => ({
  id, name: `Karte ${id}`, type: 'Effect Monster', desc: 'd',
  card_images: [{ image_url: `https://x/${id}.jpg` }],
  card_prices: cardmarket_price === undefined ? undefined : [{ cardmarket_price }],
});
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-prices-'));

test('ohne Katalogdatei: nicht verfügbar, alle Preise unbekannt', () => {
  const dir = tmpDir();
  assert.equal(readCatalogPrices(dir), null);
  assert.deepEqual(catalogPrices(dir), { available: false, prices: {} });
});

test('liest cm_price aus der gespeicherten Katalogdatei (Version 6)', () => {
  const dir = tmpDir();
  saveCatalogFile(dir, packCatalog(mergeCards([card(14558127, '4.50'), card(10045474, '0.00')], []), 6).buffer);
  assert.ok(fs.existsSync(catalogFilePath(dir)));
  assert.deepEqual(catalogPrices(dir), { available: true, prices: { '14558127': 4.5, '10045474': null } });
});

test('ein Katalog von vor Version 6 bleibt lesbar, Preise null', () => {
  const dir = tmpDir();
  const v5 = { version: 5, built_at: 'x', cards: [{ id: 23434538, name_de: 'Maxx "C"', image: 'i' }], sealed_products: [] };
  saveCatalogFile(dir, require('node:zlib').gzipSync(Buffer.from(JSON.stringify(v5))));
  assert.deepEqual(catalogPrices(dir), { available: true, prices: { '23434538': null } });
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/catalog-build.test.cjs electron/catalog-prices.test.cjs`
Expected: FAIL. `cmPriceOf is not a function` bzw. `Cannot find module './catalog-prices.cjs'`.

- [ ] **Step 4: `catalog-build.cjs` erweitern**

Direkt über dem Kommentar `// Die Kartenliste des englischen Dumps ist das Gerüst (vollständige Printings, Stats, Bilder);` einfügen:
```js
// Spec E1 §5 — Cardmarket-Preis je Passcode aus card_prices[0].cardmarket_price. YGOPRODeck liefert ihn als
// Zeichenkette ("4.50"); > 0 wird Zahl, alles andere (fehlt, "0.00", unlesbar) null. Ab Katalog Version 6.
function cmPriceOf(c) {
  const raw = Array.isArray(c.card_prices) && c.card_prices[0] ? c.card_prices[0].cardmarket_price : null;
  const n = raw == null || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

```
In `mergeCards` die Zeile `      printings_verified: [],` ersetzen durch:
```js
      printings_verified: [],
      cm_price: cmPriceOf(c),
```
Export:
```js
module.exports = { cmPriceOf, mergeCards, attachVerified, sealedKindOf, buildSealedProducts, packCatalog };
```

- [ ] **Step 5: `catalog-prices.cjs` anlegen**

```js
// Spec E1 §5 — der Desktop liest cm_price aus DERSELBEN Katalogdatei, die er baut und hochlaedt. runCatalogBuild legt
// sie nach erfolgreichem Hochladen unter <userData>/catalog/catalog.json.gz ab; so rechnen Desktop und Handy mit
// denselben Preisen. Kein zusaetzlicher Abruf.
const fs = require('fs');
const path = require('path');
const zlib = require('node:zlib');

const catalogFilePath = (userDataPath) => path.join(userDataPath, 'catalog', 'catalog.json.gz');

function saveCatalogFile(userDataPath, buffer) {
  const file = catalogFilePath(userDataPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, file);   // erst vollstaendig schreiben, dann tauschen: ein Leser sieht nie eine halbe Datei
}

// Der entpackte Katalog ist gross: einmal lesen und behalten, bis sich die Datei aendert (Muster sealed-products.cjs).
let cache = null;

// Map Passcode -> cm_price (Zahl oder null); null, wenn keine lesbare Datei da ist.
function readCatalogPrices(userDataPath) {
  if (!userDataPath) return null;
  const file = catalogFilePath(userDataPath);
  let key;
  try { const st = fs.statSync(file); key = `${file}|${st.mtimeMs}|${st.size}`; }
  catch { return null; }
  if (cache && cache.key === key) return cache.prices;
  try {
    const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    const prices = new Map();
    for (const c of Array.isArray(json.cards) ? json.cards : []) {
      if (!c || c.id == null) continue;
      // Katalog vor Version 6 hat kein cm_price: dann null ("Preis unbekannt").
      prices.set(String(c.id), typeof c.cm_price === 'number' && c.cm_price > 0 ? c.cm_price : null);
    }
    cache = { key, prices };
    return prices;
  } catch (e) {
    console.error('[catalog-prices] Katalogdatei nicht lesbar:', e.message);
    return null;
  }
}

// Fuer den Renderer: alle Preise als Objekt. available = false ohne Datei (dann ist jeder Preis unbekannt).
function catalogPrices(userDataPath) {
  const map = readCatalogPrices(userDataPath);
  if (!map) return { available: false, prices: {} };
  return { available: true, prices: Object.fromEntries(map) };
}

module.exports = { catalogFilePath, saveCatalogFile, readCatalogPrices, catalogPrices };
```

- [ ] **Step 6: `catalog-builder.cjs` legt die Datei ab**

Nach `const { sealedProductsForCatalog } = require('./sealed-products.cjs');` einfügen:
```js
const { saveCatalogFile } = require('./catalog-prices.cjs');
```
In `runCatalogBuild` nach der Zeile `    setSetting(db, 'catalog_bytes', bytes);` einfügen:
```js
    // Spec E1 §5: dieselbe Datei lokal ablegen -- der Desktop liest cm_price daraus und rechnet so mit denselben
    // Preisen wie das Handy. Erst nach dem erfolgreichen Hochladen; ein Fehler hier ist nie fatal fuer den Bau.
    if (userDataPath) {
      try { saveCatalogFile(userDataPath, buffer); }
      catch (e) { console.error('[catalog-builder] Katalogdatei nicht gespeichert:', e.message); }
    }
```

- [ ] **Step 7: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
Expected: alle grün, darunter 2 neue Tests in `catalog-build.test.cjs` und 3 in `catalog-prices.test.cjs`.
Run (in `desktop/`): `node --check electron/catalog-builder.cjs` → keine Ausgabe.

- [ ] **Step 8: Schutz-Nachweis**

(a) In `cmPriceOf` kurz ` && n > 0` entfernen → `cmPriceOf liest den Cardmarket-Preis …` scheitert mit `AssertionError [ERR_ASSERTION]: 0 == null` (gemessen). Zitieren, zurücknehmen.
(b) In `readCatalogPrices` die Zeile `prices.set(String(c.id), typeof c.cm_price === 'number' && c.cm_price > 0 ? c.cm_price : null);` kurz durch `prices.set(String(c.id), c.cm_price);` ersetzen → `ein Katalog von vor Version 6 bleibt lesbar, Preise null` scheitert (`'23434538': undefined` statt `null`). Zitieren, zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add supabase/decks_container.sql desktop/electron/catalog-build.cjs desktop/electron/catalog-build.test.cjs desktop/electron/catalog-prices.cjs desktop/electron/catalog-prices.test.cjs desktop/electron/catalog-builder.cjs
git commit -m "feat(e1): decks.container_id (SQL) und Katalogpreis cm_price mit lokaler Katalogdatei

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: JS-Zwillinge `deckCoverage`, `fillBoxProposal`, `deckWishlist` und Fixtures

**Files:**
- Create: `docs/fixtures/decks/coverage.json`
- Create: `docs/fixtures/decks/fill-box.json`
- Create: `docs/fixtures/decks/wishlist.json`
- Create: `desktop/src/utils/deckCoverage.js`
- Create: `desktop/src/utils/deckCoverage.test.js`
- Create: `desktop/src/utils/fillBoxProposal.js`
- Create: `desktop/src/utils/fillBoxProposal.test.js`
- Create: `desktop/src/utils/deckWishlist.js`
- Create: `desktop/src/utils/deckWishlist.test.js`

**Interfaces:**
- Produces (für Task 4, 6): in `deckCoverage.js` `LOADING = '…'`, `validDeckboxIds(containers) → Set`, `deckBoxChoices(deckId, decks, containers) → Container[]`, `deckBoxId(deck, containers) → string|null`, `deckCoverage({ deckId, deckCards, copies, decks, containers, prices }) → { boxId, cards: [{ card_id, needed, inBox, available, missing, price, missingCost, reservedElsewhere: [{ deck_id, name, count }] }], totals: { needed, owned, boxed, missing, missingCards, cost, unpriced } }`, `eur(v)`, `costText(totals) → string|null`, `headerText(cov)`, `listText(cov)`, `boxLabel(deck, containers)`, `rowText(card)`, `reservedTexts(card) → string[]`. In `fillBoxProposal.js` `fillBoxProposal({ deckId, deckCards, copies, decks, containers }) → { rows: [{ copy_id, card_id, group }], short, surplus } | null`, `locationText(copy, container)`, `shortText(n)`, `surplusText(n)`. In `deckWishlist.js` `wishlistMaxPrice(cmPrice) → number|null`, `missingForWishlist(coverage, wishlistCardIds) → { candidates: [{ card_id, max_price }], alreadyListed, withoutPrice }`, `wishlistConfirmText(plan)`, `wishlistResultText({ total, added, watches })`.
- Produces (Fixtures, für Task 6): `coverage.json` mit `world { containers, decks, copies, prices }`, `cases[] { name, deckId, deckCards, prices?, expected { boxId, cards, totals, texts { box, header, list, cost, rows, reserved } } }`, `choices[] { deckId, container_ids }`; `fill-box.json` mit `world`, `cases[] { name, deckId, deckCards, expected | null }`, `location[] { name, copy, text }`, `texts[] { n, short, surplus }`; `wishlist.json` mit `maxPrice[]`, `missing[]`, `confirm[]`, `result[]`.
- Consumes (vorhanden): `fmtNum` aus `format.js`, `unitPrice`/`conditionFactor` aus `valuation.js` (G4).

- [ ] **Step 1: Fixtures schreiben**

Alle erwarteten Werte sind mit der Referenzfassung dieses Plans gerechnet und von Hand nachgeprüft. Labrynth: needed 3+3+1+3+2+1 = 13; owned 3+3+0+1+2+0 = 9; boxed 1+2 = 3; Kosten 12,50 + 0,35 = 12,85, ein Passcode (10045474) ohne Preis. Höchstpreise: 8,99 × 1,2 = 10,788 → 10,79; 35,71 × 1,2 = 42,852 → 42,85; 1,005 × 1,2 = 1,206 → 1,21. Box befüllen Labrynth: P1 braucht 3 − 1 = 2, Gruppe 1 hat p1c und p1g (je 5,00, Gleichstand nach `copy_id`); P2 braucht 2, Gruppe 2 in Wertfolge p2b (3 × 0,2 = 0,60), p2d (1st Ed 1,00), p2a (3,00), der billigere Ordner-Fall p2c (0,10) kommt als Gruppe 3 nicht dran; P3 hat nur p3a (p3b gelöscht) → 2 fehlen; P4 hat 2 in der Box bei Bedarf 1, dazu z1 ohne Deckbezug → 2 überzählig.

`docs/fixtures/decks/coverage.json`:
```json
{
  "_comment": "Spec E1 §4/§5/§8 — deckCoverage und Texte. Leser: desktop/src/utils/deckCoverage.test.js und android DeckCoverageTest.kt. copies[].printing_deleted = Printing geloescht (Kotlin: keine CardRow). Fehlt ein Passcode in prices, hat er keinen Katalogpreis.",
  "world": {
    "containers": [
      {"container_id":"box-rot","name":"Deckbox Rot","kind":"deckbox","deleted":false},
      {"container_id":"box-gruen","name":"Deckbox Grün","kind":"deckbox","deleted":false},
      {"container_id":"box-frei","name":"Deckbox Frei","kind":"deckbox","deleted":false},
      {"container_id":"box-tausch","name":"Box Tausch","kind":"box","deleted":false},
      {"container_id":"ordner-blau","name":"Ordner Blau","kind":"binder","deleted":false},
      {"container_id":"box-alt","name":"Deckbox Alt","kind":"deckbox","deleted":true},
      {"container_id":"box-umgestellt","name":"Ex-Deckbox","kind":"box","deleted":false}
    ],
    "decks": [{"id":1,"name":"Labrynth","container_id":"box-rot"},{"id":2,"name":"Tenpai","container_id":"box-gruen"},{"id":3,"name":"Snake-Eye","container_id":"box-alt"},{"id":4,"name":"Kashtira","container_id":"box-umgestellt"},{"id":5,"name":"Ohne Box","container_id":null}],
    "copies": [
      {"copy_id":"a1","card_id":"14558127","set_code":"RA01-DE008","container_id":"box-rot","deleted":false,"printing_deleted":false},
      {"copy_id":"a2","card_id":"14558127","set_code":"RA01-DE008","container_id":"box-gruen","deleted":false,"printing_deleted":false},
      {"copy_id":"a3","card_id":"14558127","set_code":"RA01-DE008","container_id":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"a4","card_id":"14558127","set_code":"RA01-DE008","container_id":"box-frei","deleted":false,"printing_deleted":false},
      {"copy_id":"a5","card_id":"14558127","set_code":"RA01-DE008","container_id":"ordner-blau","deleted":true,"printing_deleted":false},
      {"copy_id":"a6","card_id":"14558127","set_code":"MP23-DE150","container_id":null,"deleted":false,"printing_deleted":true},
      {"copy_id":"b1","card_id":"23434538","set_code":"RA01-DE010","container_id":"box-tausch","deleted":false,"printing_deleted":false},
      {"copy_id":"b2","card_id":"23434538","set_code":"RA01-DE010","container_id":"box-alt","deleted":false,"printing_deleted":false},
      {"copy_id":"b3","card_id":"23434538","set_code":"Unknown","container_id":"box-umgestellt","deleted":false,"printing_deleted":false},
      {"copy_id":"d1","card_id":"10045474","set_code":"TAMA-DE060","container_id":"ordner-blau","deleted":false,"printing_deleted":false},
      {"copy_id":"e1","card_id":"73642296","set_code":"RA01-DE009","container_id":"box-rot","deleted":false,"printing_deleted":false},
      {"copy_id":"e2","card_id":"73642296","set_code":"RA01-DE009","container_id":"box-rot","deleted":false,"printing_deleted":false},
      {"copy_id":"e3","card_id":"73642296","set_code":"RA01-DE009","container_id":"box-rot","deleted":false,"printing_deleted":false},
      {"copy_id":"f1","card_id":"24224830","set_code":"RA01-DE074","container_id":"box-gruen","deleted":false,"printing_deleted":false},
      {"copy_id":"z1","card_id":"46986414","set_code":"LOB-DE005","container_id":"box-rot","deleted":false,"printing_deleted":false}
    ],
    "prices": {"14558127":4.5,"23434538":8.99,"24224830":0.35,"73642296":1.1,"86066372":12.5}
  },
  "cases": [
    {
      "name": "Labrynth: andere Deckbox reserviert, freie Deckbox und unsortiert verfügbar, Abschnitte summiert, gelöscht zählt nicht, Kosten mit und ohne Preis",
      "deckId": 1,
      "deckCards": [
        {"card_id":"14558127","count":2,"section":"main"},
        {"card_id":"14558127","count":1,"section":"side"},
        {"card_id":"23434538","count":3,"section":"main"},
        {"card_id":"86066372","count":1,"section":"extra"},
        {"card_id":"10045474","count":2,"section":"main"},
        {"card_id":"10045474","count":1,"section":"main"},
        {"card_id":"73642296","count":2,"section":"side"},
        {"card_id":"24224830","count":1,"section":"main"}
      ],
      "expected": {
        "boxId": "box-rot",
        "cards": [
          {"card_id":"14558127","needed":3,"inBox":1,"available":3,"missing":0,"price":4.5,"missingCost":0,"reservedElsewhere":[{"deck_id":2,"name":"Tenpai","count":1}]},
          {"card_id":"23434538","needed":3,"inBox":0,"available":3,"missing":0,"price":8.99,"missingCost":0,"reservedElsewhere":[]},
          {"card_id":"86066372","needed":1,"inBox":0,"available":0,"missing":1,"price":12.5,"missingCost":12.5,"reservedElsewhere":[]},
          {"card_id":"10045474","needed":3,"inBox":0,"available":1,"missing":2,"price":null,"missingCost":null,"reservedElsewhere":[]},
          {"card_id":"73642296","needed":2,"inBox":3,"available":3,"missing":0,"price":1.1,"missingCost":0,"reservedElsewhere":[]},
          {"card_id":"24224830","needed":1,"inBox":0,"available":0,"missing":1,"price":0.35,"missingCost":0.35,"reservedElsewhere":[{"deck_id":2,"name":"Tenpai","count":1}]}
        ],
        "totals": {"needed":13,"owned":9,"boxed":3,"missing":4,"missingCards":3,"cost":12.85,"unpriced":1},
        "texts": {
          "box": "Deckbox Rot",
          "header": "vorhanden 9/13 · in der Box 3/13 · fehlen 4 · ca. 12,85 € + 1 ohne Preis",
          "list": "9/13 vorhanden · ca. 12,85 € + 1 ohne Preis",
          "cost": "ca. 12,85 € + 1 ohne Preis",
          "rows": ["Box 1 · verfügbar 3 · gebraucht 3","Box 0 · verfügbar 3 · gebraucht 3","Box 0 · verfügbar 0 · gebraucht 1","Box 0 · verfügbar 1 · gebraucht 3","Box 3 · verfügbar 3 · gebraucht 2","Box 0 · verfügbar 0 · gebraucht 1"],
          "reserved": [["1 in Deck Tenpai"],[],[],[],[],["1 in Deck Tenpai"]]
        }
      }
    },
    {
      "name": "Tenpai sieht die Labrynth-Box als reserviert",
      "deckId": 2,
      "deckCards": [{"card_id":"14558127","count":1,"section":"main"},{"card_id":"24224830","count":1,"section":"main"}],
      "expected": {
        "boxId": "box-gruen",
        "cards": [{"card_id":"14558127","needed":1,"inBox":1,"available":3,"missing":0,"price":4.5,"missingCost":0,"reservedElsewhere":[{"deck_id":1,"name":"Labrynth","count":1}]},{"card_id":"24224830","needed":1,"inBox":1,"available":1,"missing":0,"price":0.35,"missingCost":0,"reservedElsewhere":[]}],
        "totals": {"needed":2,"owned":2,"boxed":2,"missing":0,"missingCards":0,"cost":0,"unpriced":0},
        "texts": {"box":"Deckbox Grün","header":"vorhanden 2/2 · in der Box 2/2 · fehlen 0","list":"2/2 vorhanden","cost":null,"rows":["Box 1 · verfügbar 3 · gebraucht 1","Box 1 · verfügbar 1 · gebraucht 1"],"reserved":[["1 in Deck Labrynth"],[]]}
      }
    },
    {
      "name": "gelöschte Deckbox = keine Box",
      "deckId": 3,
      "deckCards": [{"card_id":"73642296","count":2,"section":"main"}],
      "expected": {
        "boxId": null,
        "cards": [{"card_id":"73642296","needed":2,"inBox":0,"available":0,"missing":2,"price":1.1,"missingCost":2.2,"reservedElsewhere":[{"deck_id":1,"name":"Labrynth","count":3}]}],
        "totals": {"needed":2,"owned":0,"boxed":0,"missing":2,"missingCards":1,"cost":2.2,"unpriced":0},
        "texts": {"box":"keine Box","header":"vorhanden 0/2 · in der Box 0/2 · fehlen 2 · ca. 2,20 €","list":"0/2 vorhanden · ca. 2,20 €","cost":"ca. 2,20 €","rows":["Box 0 · verfügbar 0 · gebraucht 2"],"reserved":[["3 in Deck Labrynth"]]}
      }
    },
    {
      "name": "umgestellte Deckbox = keine Box, Unknown-Printing zählt",
      "deckId": 4,
      "deckCards": [{"card_id":"23434538","count":3,"section":"main"}],
      "expected": {
        "boxId": null,
        "cards": [{"card_id":"23434538","needed":3,"inBox":0,"available":3,"missing":0,"price":8.99,"missingCost":0,"reservedElsewhere":[]}],
        "totals": {"needed":3,"owned":3,"boxed":0,"missing":0,"missingCards":0,"cost":0,"unpriced":0},
        "texts": {"box":"keine Box","header":"vorhanden 3/3 · in der Box 0/3 · fehlen 0","list":"3/3 vorhanden","cost":null,"rows":["Box 0 · verfügbar 3 · gebraucht 3"],"reserved":[[]]}
      }
    },
    {
      "name": "nur Fehlende ohne Preis",
      "deckId": 5,
      "deckCards": [{"card_id":"10045474","count":3,"section":"main"}],
      "expected": {
        "boxId": null,
        "cards": [{"card_id":"10045474","needed":3,"inBox":0,"available":1,"missing":2,"price":null,"missingCost":null,"reservedElsewhere":[]}],
        "totals": {"needed":3,"owned":1,"boxed":0,"missing":2,"missingCards":1,"cost":0,"unpriced":1},
        "texts": {"box":"keine Box","header":"vorhanden 1/3 · in der Box 0/3 · fehlen 2 · Preis unbekannt","list":"1/3 vorhanden · Preis unbekannt","cost":"Preis unbekannt","rows":["Box 0 · verfügbar 1 · gebraucht 3"],"reserved":[[]]}
      }
    },
    {
      "name": "Tausenderpunkt",
      "deckId": 5,
      "deckCards": [{"card_id":"99999999","count":3,"section":"main"}],
      "prices": {"99999999":411.5},
      "expected": {
        "boxId": null,
        "cards": [{"card_id":"99999999","needed":3,"inBox":0,"available":0,"missing":3,"price":411.5,"missingCost":1234.5,"reservedElsewhere":[]}],
        "totals": {"needed":3,"owned":0,"boxed":0,"missing":3,"missingCards":1,"cost":1234.5,"unpriced":0},
        "texts": {"box":"keine Box","header":"vorhanden 0/3 · in der Box 0/3 · fehlen 3 · ca. 1.234,50 €","list":"0/3 vorhanden · ca. 1.234,50 €","cost":"ca. 1.234,50 €","rows":["Box 0 · verfügbar 0 · gebraucht 3"],"reserved":[[]]}
      }
    },
    {
      "name": "leeres Deck",
      "deckId": 5,
      "deckCards": [],
      "expected": {"boxId":null,"cards":[],"totals":{"needed":0,"owned":0,"boxed":0,"missing":0,"missingCards":0,"cost":0,"unpriced":0},"texts":{"box":"keine Box","header":"vorhanden 0/0 · in der Box 0/0 · fehlen 0","list":"0/0 vorhanden","cost":null,"rows":[],"reserved":[]}}
    }
  ],
  "choices": [{"deckId":1,"container_ids":["box-rot","box-frei"]},{"deckId":2,"container_ids":["box-gruen","box-frei"]},{"deckId":3,"container_ids":["box-frei"]},{"deckId":5,"container_ids":["box-frei"]}]
}
```

`docs/fixtures/decks/fill-box.json`:
```json
{
  "_comment": "Spec E1 §7 — fillBoxProposal, Ortstext, Hinweistexte. Leser: desktop/src/utils/fillBoxProposal.test.js und android FillBoxProposalTest.kt. rows in Vorschlagsreihenfolge; group 1 unsortiert, 2 Box/freie Deckbox, 3 Ordner. expected null = kein Vorschlag (keine gueltige Deckbox).",
  "world": {
    "containers": [
      {"container_id":"box-rot","name":"Deckbox Rot","kind":"deckbox","deleted":false},
      {"container_id":"box-gruen","name":"Deckbox Grün","kind":"deckbox","deleted":false},
      {"container_id":"box-frei","name":"Deckbox Frei","kind":"deckbox","deleted":false},
      {"container_id":"box-tausch","name":"Box Tausch","kind":"box","deleted":false},
      {"container_id":"ordner-blau","name":"Ordner Blau","kind":"binder","deleted":false}
    ],
    "decks": [{"id":1,"name":"Labrynth","container_id":"box-rot"},{"id":2,"name":"Tenpai","container_id":"box-gruen"},{"id":3,"name":"Ohne Box","container_id":null}],
    "copies": [
      {"copy_id":"p1a","card_id":"11111111","set_code":"AAA-DE001","rarity":"Common","edition":"unlimited","condition":"NM","container_id":"box-rot","page":null,"slot":null,"price":1,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p1b","card_id":"11111111","set_code":"AAA-DE002","rarity":"Common","edition":"unlimited","condition":"NM","container_id":"ordner-blau","page":3,"slot":2,"price":2,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p1c","card_id":"11111111","set_code":"AAA-DE003","rarity":"Common","edition":"unlimited","condition":"NM","container_id":null,"page":null,"slot":null,"price":5,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p1d","card_id":"11111111","set_code":"AAA-DE004","rarity":"Common","edition":"unlimited","condition":"EX","container_id":"box-tausch","page":null,"slot":null,"price":5,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p1e","card_id":"11111111","set_code":"AAA-DE005","rarity":"Common","edition":"unlimited","condition":"NM","container_id":"box-frei","page":null,"slot":null,"price":1,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p1f","card_id":"11111111","set_code":"AAA-DE006","rarity":"Common","edition":"unlimited","condition":"NM","container_id":"box-gruen","page":null,"slot":null,"price":1,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p1g","card_id":"11111111","set_code":"AAA-DE003","rarity":"Common","edition":"unlimited","condition":"NM","container_id":null,"page":null,"slot":null,"price":5,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p2a","card_id":"22222222","set_code":"BBB-DE001","rarity":"Common","edition":"unlimited","condition":"NM","container_id":"box-tausch","page":null,"slot":null,"price":3,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p2b","card_id":"22222222","set_code":"BBB-DE002","rarity":"Common","edition":"unlimited","condition":"PO","container_id":"box-frei","page":null,"slot":null,"price":3,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p2c","card_id":"22222222","set_code":"BBB-DE003","rarity":"Common","edition":"unlimited","condition":"NM","container_id":"ordner-blau","page":1,"slot":1,"price":0.1,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p2d","card_id":"22222222","set_code":"BBB-DE004","rarity":"Common","edition":"first","condition":"NM","container_id":"box-tausch","page":null,"slot":null,"price":3,"price_first_ed":1,"deleted":false,"printing_deleted":false},
      {"copy_id":"p3a","card_id":"33333333","set_code":"CCC-DE001","rarity":"Common","edition":"unlimited","condition":"NM","container_id":"ordner-blau","page":2,"slot":5,"price":1,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p3b","card_id":"33333333","set_code":"CCC-DE001","rarity":"Common","edition":"unlimited","condition":"NM","container_id":null,"page":null,"slot":null,"price":1,"price_first_ed":null,"deleted":true,"printing_deleted":false},
      {"copy_id":"p4a","card_id":"44444444","set_code":"DDD-DE001","rarity":"Common","edition":"unlimited","condition":"NM","container_id":"box-rot","page":null,"slot":null,"price":1,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"p4b","card_id":"44444444","set_code":"DDD-DE001","rarity":"Common","edition":"unlimited","condition":"NM","container_id":"box-rot","page":null,"slot":null,"price":1,"price_first_ed":null,"deleted":false,"printing_deleted":false},
      {"copy_id":"z1","card_id":"99999999","set_code":"ZZZ-DE001","rarity":"Common","edition":"unlimited","condition":"NM","container_id":"box-rot","page":null,"slot":null,"price":1,"price_first_ed":null,"deleted":false,"printing_deleted":false}
    ]
  },
  "cases": [
    {
      "name": "Labrynth: Gruppen, günstigstes zuerst, 1st-Ed-Preis, Gleichstand nach copy_id, Lücke, Box-Exemplare nicht erneut, überzählig",
      "deckId": 1,
      "deckCards": [{"card_id":"11111111","count":3,"section":"main"},{"card_id":"22222222","count":2,"section":"main"},{"card_id":"33333333","count":3,"section":"extra"},{"card_id":"44444444","count":1,"section":"side"}],
      "expected": {"rows":[{"copy_id":"p1c","card_id":"11111111","group":1},{"copy_id":"p1g","card_id":"11111111","group":1},{"copy_id":"p2b","card_id":"22222222","group":2},{"copy_id":"p2d","card_id":"22222222","group":2},{"copy_id":"p3a","card_id":"33333333","group":3}],"short":2,"surplus":2}
    },
    {"name":"Tenpai: fremde Deckbox nicht vorgeschlagen","deckId":2,"deckCards":[{"card_id":"11111111","count":2,"section":"main"}],"expected":{"rows":[{"copy_id":"p1c","card_id":"11111111","group":1}],"short":0,"surplus":0}},
    {"name":"ohne Deckbox kein Vorschlag","deckId":3,"deckCards":[{"card_id":"11111111","count":1,"section":"main"}],"expected":null}
  ],
  "location": [
    {"name":"unsortiert","copy":{"container_id":null,"page":null,"slot":null},"text":"unsortiert"},
    {"name":"Ordner mit Seite und Fach","copy":{"container_id":"ordner-blau","page":3,"slot":2},"text":"Ordner Blau · S. 3 · Fach 2"},
    {"name":"Ordner ohne Fach","copy":{"container_id":"ordner-blau","page":null,"slot":null},"text":"Ordner Blau"},
    {"name":"Box","copy":{"container_id":"box-tausch","page":null,"slot":null},"text":"Box Tausch"},
    {"name":"unbekannter Behälter","copy":{"container_id":"weg","page":null,"slot":null},"text":"unsortiert"}
  ],
  "texts": [
    {"n":0,"short":null,"surplus":null},
    {"n":1,"short":"1 fehlt noch – nicht in der Sammlung","surplus":"1 überzählig in der Box"},
    {"n":2,"short":"2 fehlen noch – nicht in der Sammlung","surplus":"2 überzählig in der Box"},
    {"n":3,"short":"3 fehlen noch – nicht in der Sammlung","surplus":"3 überzählig in der Box"}
  ]
}
```

`docs/fixtures/decks/wishlist.json`:
```json
{
  "_comment": "Spec E1 §6 — wishlistMaxPrice, missingForWishlist, Bestaetigungs- und Rueckmeldungstext. Leser: desktop/src/utils/deckWishlist.test.js und android DeckWishlistTest.kt. confirm.candidates ist die Anzahl der Kandidaten.",
  "maxPrice": [{"cm_price":35.71,"max_price":42.85},{"cm_price":0.04,"max_price":0.05},{"cm_price":12.5,"max_price":15},{"cm_price":0.125,"max_price":0.15},{"cm_price":2.675,"max_price":3.21},{"cm_price":1.005,"max_price":1.21},{"cm_price":null,"max_price":null},{"cm_price":0,"max_price":null}],
  "missing": [
    {
      "name": "vorhandene Einträge übersprungen, ohne Preis mitgenommen, nichts Fehlendes ausgelassen",
      "coverage": {"cards":[{"card_id":"14558127","missing":0,"price":4.5},{"card_id":"23434538","missing":2,"price":8.99},{"card_id":"86066372","missing":1,"price":12.5},{"card_id":"10045474","missing":2,"price":null},{"card_id":"24224830","missing":1,"price":0.35}]},
      "wishlist": ["86066372","46986414"],
      "expected": {"candidates":[{"card_id":"23434538","max_price":10.79},{"card_id":"10045474","max_price":null},{"card_id":"24224830","max_price":0.42}],"alreadyListed":1,"withoutPrice":1}
    },
    {"name":"alles schon drauf","coverage":{"cards":[{"card_id":"1","missing":1,"price":1}]},"wishlist":["1"],"expected":{"candidates":[],"alreadyListed":1,"withoutPrice":0}}
  ],
  "confirm": [
    {"candidates":8,"alreadyListed":2,"withoutPrice":1,"text":"8 fehlende Karten auf die Wunschliste setzen? 2 stehen schon drauf, 1 hat keinen Preis und bekommt keine Deal-Suche."},
    {"candidates":1,"alreadyListed":0,"withoutPrice":0,"text":"1 fehlende Karte auf die Wunschliste setzen?"},
    {"candidates":3,"alreadyListed":1,"withoutPrice":2,"text":"3 fehlende Karten auf die Wunschliste setzen? 1 steht schon drauf, 2 haben keinen Preis und bekommen keine Deal-Suche."},
    {"candidates":0,"alreadyListed":4,"withoutPrice":0,"text":"Alle fehlenden Karten stehen schon auf der Wunschliste."}
  ],
  "result": [{"total":8,"added":8,"watches":7,"text":"8 Karten auf der Wunschliste, Deal-Suche läuft."},{"total":1,"added":1,"watches":0,"text":"1 Karte auf der Wunschliste."},{"total":8,"added":5,"watches":4,"text":"5 von 8 hinzugefügt, 3 fehlgeschlagen"}]
}
```

- [ ] **Step 2: Tests schreiben**

`desktop/src/utils/deckCoverage.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deckCoverage, deckBoxChoices, boxLabel, headerText, listText, costText, rowText, reservedTexts, LOADING } from './deckCoverage.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DeckCoverageTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/coverage.json', import.meta.url), 'utf8'));
const W = FIX.world;

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    const cov = deckCoverage({ deckId: c.deckId, deckCards: c.deckCards, copies: W.copies, decks: W.decks, containers: W.containers, prices: c.prices || W.prices });
    const { texts, ...numbers } = c.expected;
    assert.deepEqual(cov, numbers);
    const deck = W.decks.find((d) => d.id === c.deckId);
    assert.equal(boxLabel(deck, W.containers), texts.box);
    assert.equal(headerText(cov), texts.header);
    assert.equal(listText(cov), texts.list);
    assert.equal(costText(cov.totals), texts.cost);
    assert.deepEqual(cov.cards.map(rowText), texts.rows);
    assert.deepEqual(cov.cards.map(reservedTexts), texts.reserved);
  });
}

test('Fixture: Deckbox-Auswahl', () => {
  for (const c of FIX.choices) {
    assert.deepEqual(deckBoxChoices(c.deckId, W.decks, W.containers).map((x) => x.container_id), c.container_ids, `Deck ${c.deckId}`);
  }
});

test('Platzhalter ist nie eine Null', () => {
  assert.equal(LOADING, '…');
});
```

`desktop/src/utils/fillBoxProposal.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fillBoxProposal, locationText, shortText, surplusText } from './fillBoxProposal.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/FillBoxProposalTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/fill-box.json', import.meta.url), 'utf8'));
const W = FIX.world;

for (const c of FIX.cases) {
  test(`Fixture: ${c.name}`, () => {
    assert.deepEqual(
      fillBoxProposal({ deckId: c.deckId, deckCards: c.deckCards, copies: W.copies, decks: W.decks, containers: W.containers }),
      c.expected,
    );
  });
}

test('Fixture: Ortstext', () => {
  const byId = new Map(W.containers.map((c) => [c.container_id, c]));
  for (const l of FIX.location) assert.equal(locationText(l.copy, byId.get(l.copy.container_id)), l.text, l.name);
});

test('Fixture: Hinweistexte', () => {
  for (const t of FIX.texts) {
    assert.equal(shortText(t.n), t.short, `short ${t.n}`);
    assert.equal(surplusText(t.n), t.surplus, `surplus ${t.n}`);
  }
});
```

`desktop/src/utils/deckWishlist.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wishlistMaxPrice, missingForWishlist, wishlistConfirmText, wishlistResultText } from './deckWishlist.js';

// ZWILLING: android/app/src/test/java/com/example/yugiohscanner/DeckWishlistTest.kt liest dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/decks/wishlist.json', import.meta.url), 'utf8'));

test('Fixture: Höchstpreis', () => {
  for (const c of FIX.maxPrice) assert.equal(wishlistMaxPrice(c.cm_price), c.max_price, String(c.cm_price));
});

for (const m of FIX.missing) {
  test(`Fixture: ${m.name}`, () => {
    assert.deepEqual(missingForWishlist(m.coverage, m.wishlist), m.expected);
  });
}

test('Fixture: Bestätigung', () => {
  for (const c of FIX.confirm) {
    const plan = { candidates: Array.from({ length: c.candidates }, (_, i) => ({ card_id: String(i), max_price: null })), alreadyListed: c.alreadyListed, withoutPrice: c.withoutPrice };
    assert.equal(wishlistConfirmText(plan), c.text);
  }
});

test('Fixture: Rückmeldung', () => {
  for (const r of FIX.result) assert.equal(wishlistResultText(r), r.text);
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run (in `desktop/`): `node --test src/utils/deckCoverage.test.js src/utils/fillBoxProposal.test.js src/utils/deckWishlist.test.js`
Expected: FAIL mit `Cannot find module …/deckCoverage.js` (bzw. `fillBoxProposal.js`, `deckWishlist.js`).

- [ ] **Step 4: `deckCoverage.js` anlegen**

```js
import { fmtNum } from './format.js';

// Spec E1 §4/§5/§8 — Abgleich eines Decks mit der Sammlung und die Texte dazu.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/DeckCoverage.kt. Beide laufen gegen
// docs/fixtures/decks/coverage.json. Wer eine Seite aendert, aendert beide.

export const LOADING = '…';

const round2 = (v) => Math.round(v * 100) / 100;

// Gueltige Deckbox = lebender Behaelter mit kind 'deckbox'. Eine geloeschte oder umgestellte Box gilt als "keine Box".
export function validDeckboxIds(containers) {
  const out = new Set();
  for (const c of containers || []) if (c && !c.deleted && c.kind === 'deckbox') out.add(c.container_id);
  return out;
}

// Spec E1 §3: waehlbar sind gueltige Deckboxen, die keinem ANDEREN Deck gehoeren (die eigene also mit),
// in der Reihenfolge der Behaelterliste.
export function deckBoxChoices(deckId, decks, containers) {
  const taken = new Set((decks || []).filter((d) => d.id !== deckId && d.container_id).map((d) => d.container_id));
  return (containers || []).filter((c) => !c.deleted && c.kind === 'deckbox' && !taken.has(c.container_id));
}

export function deckBoxId(deck, containers) {
  const id = deck && deck.container_id;
  return id && validDeckboxIds(containers).has(id) ? id : null;
}

// input: { deckId, deckCards: [{card_id, count, section}], copies: [{copy_id, card_id, container_id, deleted?, printing_deleted?}],
//          decks: [{id, name, container_id}], containers: [{container_id, name, kind, deleted?}], prices: {passcode: number|null} }
export function deckCoverage({ deckId, deckCards, copies, decks, containers, prices }) {
  const valid = validDeckboxIds(containers);
  const boxOf = (d) => (d.container_id && valid.has(d.container_id) ? d.container_id : null);
  const own = (decks || []).find((d) => d.id === deckId);
  const boxId = own ? boxOf(own) : null;
  const otherBox = new Map(); // container_id -> Deck
  for (const d of decks || []) {
    const b = boxOf(d);
    if (d.id !== deckId && b) otherBox.set(b, d);
  }

  const byCard = new Map();
  for (const dc of deckCards || []) {
    const id = String(dc.card_id);
    const e = byCard.get(id) || { card_id: id, needed: 0, inBox: 0, live: 0, reserved: new Map() };
    e.needed += Number(dc.count) || 0;
    byCard.set(id, e);
  }
  for (const cp of copies || []) {
    if (cp.deleted || cp.printing_deleted) continue;
    const e = byCard.get(String(cp.card_id));
    if (!e) continue;
    e.live += 1;
    if (boxId && cp.container_id === boxId) e.inBox += 1;
    else if (cp.container_id && otherBox.has(cp.container_id)) {
      const d = otherBox.get(cp.container_id);
      const r = e.reserved.get(d.id) || { deck_id: d.id, name: d.name, count: 0 };
      r.count += 1;
      e.reserved.set(d.id, r);
    }
  }

  const deckOrder = new Map((decks || []).map((d, i) => [d.id, i]));
  const cards = [];
  const totals = { needed: 0, owned: 0, boxed: 0, missing: 0, missingCards: 0, cost: 0, unpriced: 0 };
  for (const e of byCard.values()) {
    // Reihenfolge der Deckliste, damit beide Geraete die Markierungen gleich ordnen.
    const reservedElsewhere = Array.from(e.reserved.values()).sort((a, b) => deckOrder.get(a.deck_id) - deckOrder.get(b.deck_id));
    const reservedCount = reservedElsewhere.reduce((s, r) => s + r.count, 0);
    const available = e.live - reservedCount;
    const missing = Math.max(0, e.needed - available);
    const p = prices ? prices[e.card_id] : null;
    const price = typeof p === 'number' && p > 0 ? p : null;
    const missingCost = price == null ? null : round2(missing * price);
    cards.push({ card_id: e.card_id, needed: e.needed, inBox: e.inBox, available, missing, price, missingCost, reservedElsewhere });
    totals.needed += e.needed;
    totals.owned += Math.min(e.needed, available);
    totals.boxed += Math.min(e.needed, e.inBox);
    totals.missing += missing;
    if (missing > 0) {
      totals.missingCards += 1;
      if (price == null) totals.unpriced += 1;
      else totals.cost += missingCost;
    }
  }
  totals.cost = round2(totals.cost);
  return { boxId, cards, totals };
}

export const eur = (v) => `${fmtNum(v)} €`;

export function costText(totals) {
  if (!totals || totals.missing === 0) return null;
  if (totals.unpriced === totals.missingCards) return 'Preis unbekannt';
  if (totals.unpriced > 0) return `ca. ${eur(totals.cost)} + ${totals.unpriced} ohne Preis`;
  return `ca. ${eur(totals.cost)}`;
}

export function headerText(cov) {
  const t = cov.totals;
  const cost = costText(t);
  return `vorhanden ${t.owned}/${t.needed} · in der Box ${t.boxed}/${t.needed} · fehlen ${t.missing}${cost ? ` · ${cost}` : ''}`;
}

export function listText(cov) {
  const t = cov.totals;
  const cost = costText(t);
  return `${t.owned}/${t.needed} vorhanden${cost ? ` · ${cost}` : ''}`;
}

export function boxLabel(deck, containers) {
  const id = deckBoxId(deck, containers);
  const c = id && (containers || []).find((x) => x.container_id === id);
  return c ? c.name : 'keine Box';
}

export const rowText = (card) => `Box ${card.inBox} · verfügbar ${card.available} · gebraucht ${card.needed}`;

export const reservedTexts = (card) => card.reservedElsewhere.map((r) => `${r.count} in Deck ${r.name}`);
```

- [ ] **Step 5: `fillBoxProposal.js` anlegen**

```js
import { conditionFactor, unitPrice } from './valuation.js';
import { deckCoverage, validDeckboxIds } from './deckCoverage.js';

// Spec E1 §7 — Vorschlag "Box befüllen" und die Texte des Dialogs.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/FillBoxProposal.kt. Beide laufen gegen
// docs/fixtures/decks/fill-box.json. Wer eine Seite aendert, aendert beide.

// Gruppen: 1 unsortiert (auch: Behaelter unbekannt), 2 Box oder keinem Deck zugeordnete Deckbox, 3 Ordner.
function groupOf(copy, containersById) {
  const c = copy.container_id ? containersById.get(copy.container_id) : null;
  if (!c) return 1;
  return c.kind === 'binder' ? 3 : 2;
}

// input wie deckCoverage, copies zusaetzlich mit edition, condition, price, price_first_ed.
// Ergebnis null ohne gueltige Deckbox; sonst { rows: [{ copy_id, card_id, group }], short, surplus }.
export function fillBoxProposal(input) {
  const cov = deckCoverage({ ...input, prices: {} });
  if (!cov.boxId) return null;
  const valid = validDeckboxIds(input.containers);
  const reservedBoxes = new Set(
    (input.decks || []).filter((d) => d.id !== input.deckId && d.container_id && valid.has(d.container_id)).map((d) => d.container_id),
  );
  const containersById = new Map((input.containers || []).filter((c) => !c.deleted).map((c) => [c.container_id, c]));
  const live = (input.copies || []).filter((cp) => !cp.deleted && !cp.printing_deleted);

  const rows = [];
  for (const card of cov.cards) {
    const take = Math.max(0, Math.min(card.needed - card.inBox, card.available - card.inBox));
    if (take === 0) continue;
    const candidates = live
      .filter((cp) => String(cp.card_id) === card.card_id && cp.container_id !== cov.boxId && !reservedBoxes.has(cp.container_id))
      .map((cp) => ({ cp, group: groupOf(cp, containersById), value: unitPrice(cp, cp) * conditionFactor(cp.condition) }))
      .sort((a, b) => a.group - b.group || a.value - b.value || (a.cp.copy_id < b.cp.copy_id ? -1 : a.cp.copy_id > b.cp.copy_id ? 1 : 0));
    for (const c of candidates.slice(0, take)) rows.push({ copy_id: c.cp.copy_id, card_id: card.card_id, group: c.group });
  }

  const needed = new Map(cov.cards.map((c) => [c.card_id, c.needed]));
  const inBox = new Map();
  for (const cp of live) if (cp.container_id === cov.boxId) inBox.set(String(cp.card_id), (inBox.get(String(cp.card_id)) || 0) + 1);
  let surplus = 0;
  for (const [id, n] of inBox) surplus += Math.max(0, n - (needed.get(id) || 0));

  return { rows, short: cov.totals.missing, surplus };
}

export function locationText(copy, container) {
  if (!copy || !copy.container_id || !container) return 'unsortiert';
  if (container.kind === 'binder' && copy.page != null && copy.slot != null) return `${container.name} · S. ${copy.page} · Fach ${copy.slot}`;
  return container.name;
}

export function shortText(n) {
  if (!n) return null;
  return n === 1 ? '1 fehlt noch – nicht in der Sammlung' : `${n} fehlen noch – nicht in der Sammlung`;
}

export const surplusText = (n) => (n ? `${n} überzählig in der Box` : null);
```

- [ ] **Step 6: `deckWishlist.js` anlegen**

```js
// Spec E1 §6 — "Fehlende auf die Wunschliste": Auswahl, Hoechstpreis und Texte.
// ZWILLING: android/app/src/main/java/com/example/yugiohscanner/ml/DeckWishlist.kt. Beide laufen gegen
// docs/fixtures/decks/wishlist.json. Wer eine Seite aendert, aendert beide.

// max_price = 1,2 x Katalogpreis, auf Cent gerundet; ohne Preis null (dann kein Deal-Watch).
export function wishlistMaxPrice(cmPrice) {
  if (typeof cmPrice !== 'number' || !(cmPrice > 0)) return null;
  return Math.round(cmPrice * 1.2 * 100) / 100;
}

// coverage: Ergebnis von deckCoverage; wishlistCardIds: Passcodes, die schon auf der Wunschliste stehen.
export function missingForWishlist(coverage, wishlistCardIds) {
  const listed = new Set((wishlistCardIds || []).map(String));
  const candidates = [];
  let alreadyListed = 0;
  let withoutPrice = 0;
  for (const c of coverage.cards) {
    if (c.missing <= 0) continue;
    if (listed.has(c.card_id)) { alreadyListed += 1; continue; }
    const maxPrice = wishlistMaxPrice(c.price);
    if (maxPrice == null) withoutPrice += 1;
    candidates.push({ card_id: c.card_id, max_price: maxPrice });
  }
  return { candidates, alreadyListed, withoutPrice };
}

const karten = (n) => (n === 1 ? 'Karte' : 'Karten');

export function wishlistConfirmText({ candidates, alreadyListed, withoutPrice }) {
  const n = candidates.length;
  if (n === 0) return 'Alle fehlenden Karten stehen schon auf der Wunschliste.';
  const parts = [];
  if (alreadyListed > 0) parts.push(`${alreadyListed} ${alreadyListed === 1 ? 'steht' : 'stehen'} schon drauf`);
  if (withoutPrice > 0) {
    parts.push(withoutPrice === 1
      ? '1 hat keinen Preis und bekommt keine Deal-Suche'
      : `${withoutPrice} haben keinen Preis und bekommen keine Deal-Suche`);
  }
  return `${n} fehlende ${karten(n)} auf die Wunschliste setzen?${parts.length ? ` ${parts.join(', ')}.` : ''}`;
}

// result: { total, added, watches } — watches = Anzahl angelegter Deal-Watches.
export function wishlistResultText({ total, added, watches }) {
  const failed = total - added;
  if (failed > 0) return `${added} von ${total} hinzugefügt, ${failed} fehlgeschlagen`;
  return `${added} ${karten(added)} auf der Wunschliste${watches > 0 ? ', Deal-Suche läuft.' : '.'}`;
}
```

- [ ] **Step 7: Tests und Lint**

Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → alle grün, darunter 19 neue (9 + 5 + 5; gemessen mit der Referenzfassung).
Run (in `desktop/`): `npx eslint .` → genau `5 errors`.

- [ ] **Step 8: Schutz-Nachweis**

(a) In `deckCoverage` die Bedingung `else if (cp.container_id && otherBox.has(cp.container_id))` kurz zu `else if (false)` machen → drei Fälle scheitern: „Labrynth: …", „Tenpai sieht die Labrynth-Box als reserviert", „gelöschte Deckbox = keine Box" (gemessen). Zitieren, zurücknehmen.
(b) In `fillBoxProposal` im Sortierer `a.group - b.group || ` entfernen → „Labrynth: Gruppen, …" und „Tenpai: fremde Deckbox nicht vorgeschlagen" scheitern (günstigere Box-Exemplare verdrängen die unsortierten; gemessen). Zitieren, zurücknehmen.
(c) In `missingForWishlist` die Zeile `if (listed.has(c.card_id)) { alreadyListed += 1; continue; }` entfernen → „vorhandene Einträge übersprungen, …" und „alles schon drauf" scheitern (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add docs/fixtures/decks/coverage.json docs/fixtures/decks/fill-box.json docs/fixtures/decks/wishlist.json desktop/src/utils/deckCoverage.js desktop/src/utils/deckCoverage.test.js desktop/src/utils/fillBoxProposal.js desktop/src/utils/fillBoxProposal.test.js desktop/src/utils/deckWishlist.js desktop/src/utils/deckWishlist.test.js
git commit -m "feat(e1): Regeln Deck-Abgleich, Box befüllen und Wunschliste als JS-Zwillinge mit Fixtures

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: Desktop-Hauptprozess — Exemplare, Deckbox, Wunschliste, Verschieben, sechs Kanäle

**Files:**
- Modify: `desktop/electron/copies.cjs`
- Modify: `desktop/electron/copies-location.test.cjs`
- Create: `desktop/electron/decks.cjs`
- Create: `desktop/electron/decks.test.cjs`
- Modify: `desktop/electron/main.cjs`
- Modify: `desktop/electron/preload.cjs`
- Create: `desktop/electron/ipc-channels.test.cjs`

**Interfaces:**
- Produces (für Task 4): `copies.listDeckCopies(db) → [{ copy_id, card_id, set_code, language, rarity, edition, condition, container_id, page, slot, card_name, price, price_first_ed }]`; in `decks.cjs` `DECKBOX_TAKEN`, `deckContainerErrorMessage(error) → string`, `setDeckContainer(client, { deckId, containerId }) → Promise<{ success, error? }>`, `addMissingToWishlist(client, items, triggerScrape) → Promise<{ total, added, watches, failed: string[] }>`, `moveCopiesToContainer(db, { copyIds, containerId }, messageOf) → [{ copy_id, success, error? }]` (wirft `ValidationError` ohne lebende Deckbox). Renderer-Brücke: `window.api.listDeckCopies() → { copies, containers }`, `getAllDeckCards() → [{ deck_id, card_id, name, count, section }]`, `setDeckContainer({ deckId, containerId }) → { success, error? }`, `getCatalogPrices() → { available, prices }`, `addMissingToWishlist(items) → { total, added, watches, failed }`, `moveCopiesToContainer({ copyIds, containerId }) → { success, results? , error? }`.
- Consumes (Task 1): `catalogPrices(userDataPath)`. Consumes (vorhanden): `setCopyLocation`, `ValidationError`, `listContainers` (copies.cjs), `dealsClient()`, `triggerCloudScrape(c)`, `containerCopyErrorMessage(e, channel)`, `CONTAINER_COPY_ERROR_MSG` (main.cjs).

- [ ] **Step 1: Tests schreiben**

(a) In `desktop/electron/copies-location.test.cjs` am Dateiende anhängen:
```js

// Spec E1 §4: Exemplare fuer den Deck-Abgleich -- nur lebende Exemplare lebender Printings, mit Standort und Preisfeldern.
test('listDeckCopies liefert lebende Exemplare lebender Printings mit Standort und Preisen', () => {
  const db = freshDb();
  addContainer(db, 'c1', 'Ordner Blau', 'binder', 9);
  db.prepare("UPDATE cards SET name = 'Dunkler Magier', price = 2.5, cm_first_ed_factor = 1.2 WHERE id = '46986414'").run();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price) VALUES ('46986414','Unknown','DE','Unknown', 0)").run();
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price) VALUES ('46986414','SDY-DE006','DE','Common', 1)").run();
  addCopy(db, 'lebt', { container_id: 'c1', page: 3, slot: 2 });
  addCopy(db, 'weg', { deleted: 1 });
  db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity) VALUES
              ('unknown','46986414','Unknown','DE','Unknown'), ('printing-weg','46986414','SDY-DE006','DE','Common')`).run();
  // Erst nach dem Exemplar tombstonen: der Recount-Trigger belebt ein Printing beim Einfuegen eines Exemplars wieder.
  // Das JOIN auf c.deleted = 0 bleibt der Schutz fuer einen Pull, der das Printing geloescht herunterbringt.
  db.prepare("UPDATE cards SET deleted = 1 WHERE id = '46986414' AND set_code = 'SDY-DE006'").run();
  const rows = copies.listDeckCopies(db);
  assert.deepEqual(rows.map((r) => r.copy_id), ['lebt', 'unknown']);
  const [lebt] = rows;
  assert.equal(lebt.container_id, 'c1');
  assert.equal(lebt.page, 3);
  assert.equal(lebt.slot, 2);
  assert.equal(lebt.card_name, 'Dunkler Magier');
  assert.equal(lebt.price, 2.5);
  assert.equal(lebt.price_first_ed, 3);
  assert.equal(lebt.edition, 'unknown');
  assert.equal(lebt.condition, 'NM');
});
```

(b) `desktop/electron/decks.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const copies = require('./copies.cjs');
const { DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer } = require('./decks.cjs');

// Attrappe des Supabase-Clients: merkt sich jede Schreibung; `fail` bestimmt je Tabelle, welche card_id/query scheitert.
function fakeClient({ fail = {}, updateError = null } = {}) {
  const calls = { wishlist: [], deal_watches: [], updates: [] };
  return {
    calls,
    from(table) {
      return {
        insert: async (row) => {
          calls[table].push(row);
          const key = table === 'wishlist' ? row.card_id : row.query;
          return { error: (fail[table] || []).includes(key) ? { message: 'kaputt' } : null };
        },
        update: (row) => ({ eq: async (col, val) => { calls.updates.push({ table, row, col, val }); return { error: updateError }; } }),
      };
    },
  };
}

test('Fehlende auf die Wunschliste: Cloud-Suche genau einmal, Watch nur mit Preis', async () => {
  const c = fakeClient();
  let scrapes = 0;
  const res = await addMissingToWishlist(c, [
    { card_id: '23434538', name: 'Maxx "C"', image_url: 'u1', max_price: 10.79 },
    { card_id: '10045474', name: 'Unendliche Vergänglichkeit', image_url: null, max_price: null },
    { card_id: '24224830', name: 'Vom Friedhof gerufen', image_url: 'u3', max_price: 0.42 },
  ], () => { scrapes += 1; });
  assert.equal(scrapes, 1);
  assert.deepEqual(res, { total: 3, added: 3, watches: 2, failed: [] });
  assert.deepEqual(c.calls.wishlist.map((r) => [r.card_id, r.max_price]), [['23434538', 10.79], ['10045474', null], ['24224830', 0.42]]);
  assert.deepEqual(c.calls.deal_watches, [{ query: 'Maxx "C"', max_price: 10.79 }, { query: 'Vom Friedhof gerufen', max_price: 0.42 }]);
});

test('Fehlende auf die Wunschliste: ohne Preise keine Cloud-Suche, Teilfehler gezählt', async () => {
  const c = fakeClient({ fail: { wishlist: ['2'] } });
  let scrapes = 0;
  const res = await addMissingToWishlist(c, [
    { card_id: '1', name: 'A', max_price: null },
    { card_id: '2', name: 'B', max_price: 3 },
  ], () => { scrapes += 1; });
  assert.equal(scrapes, 0);
  assert.deepEqual(res, { total: 2, added: 1, watches: 0, failed: ['2'] });
  assert.equal(c.calls.deal_watches.length, 0, 'gescheiterter Eintrag bekommt keinen Watch');
});

test('Deckbox zuordnen: Unique-Verletzung wird zur deutschen Meldung', async () => {
  assert.equal(deckContainerErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "decks_container_unique"' }), DECKBOX_TAKEN);
  assert.equal(deckContainerErrorMessage({ code: '42501', message: 'permission denied' }), 'permission denied');
  const taken = fakeClient({ updateError: { code: '23505', message: 'duplicate key' } });
  assert.deepEqual(await setDeckContainer(taken, { deckId: 7, containerId: 'box-rot' }), { success: false, error: DECKBOX_TAKEN });
  const ok = fakeClient();
  assert.deepEqual(await setDeckContainer(ok, { deckId: 7, containerId: '' }), { success: true });
  assert.deepEqual(ok.calls.updates, [{ table: 'decks', row: { container_id: null }, col: 'id', val: 7 }]);
});

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE cards (
    id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
    quantity INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, price REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id, set_code, language, rarity));
  CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  db.prepare("INSERT INTO cards (id, set_code, language, rarity, price) VALUES ('14558127','RA01-DE008','DE','Common', 4.5)").run();
  db.prepare("INSERT INTO containers (container_id, name, kind, pockets_per_page) VALUES ('box-rot','Deckbox Rot','deckbox',NULL), ('ordner-blau','Ordner Blau','binder',9)").run();
  return db;
}

test('In die Box verschieben: Seite und Fach geleert, Fehlschlag nur für seine Zeile', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, container_id, page, slot)
              VALUES ('k1','14558127','RA01-DE008','DE','Common','ordner-blau',3,2)`).run();
  const res = moveCopiesToContainer(db, { copyIds: ['k1', 'gibt-es-nicht'], containerId: 'box-rot' }, (e) => e.message);
  assert.deepEqual(res, [
    { copy_id: 'k1', success: true },
    { copy_id: 'gibt-es-nicht', success: false, error: 'Exemplar nicht gefunden.' },
  ]);
  const k1 = db.prepare("SELECT container_id, page, slot FROM card_copies WHERE copy_id = 'k1'").get();
  assert.deepEqual({ ...k1 }, { container_id: 'box-rot', page: null, slot: null });
});

test('In die Box verschieben: nur in eine lebende Deckbox', () => {
  const db = freshDb();
  assert.throws(() => moveCopiesToContainer(db, { copyIds: ['k1'], containerId: 'ordner-blau' }, (e) => e.message), copies.ValidationError);
  assert.throws(() => moveCopiesToContainer(db, { copyIds: ['k1'], containerId: null }, (e) => e.message), copies.ValidationError);
});
```

(c) `desktop/electron/ipc-channels.test.cjs`:
```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Spec E1 §11: jeder neue Kanal steht in main.cjs (Handler) UND in preload.cjs (Bruecke) -- fehlt einer, kann der
// Renderer ihn nicht aufrufen, und das faellt erst beim Klicken auf.
const MAIN = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
const PRELOAD = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
const E1_CHANNELS = [
  'list-deck-copies', 'get-all-deck-cards', 'set-deck-container',
  'get-catalog-prices', 'deck-missing-to-wishlist', 'move-copies-to-container',
];

for (const ch of E1_CHANNELS) {
  test(`Kanal ${ch} steht in main.cjs und preload.cjs`, () => {
    assert.ok(MAIN.includes(`ipcMain.handle('${ch}'`), `main.cjs fehlt ipcMain.handle('${ch}'`);
    assert.ok(PRELOAD.includes(`ipcRenderer.invoke('${ch}'`), `preload.cjs fehlt ipcRenderer.invoke('${ch}'`);
  });
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/copies-location.test.cjs electron/decks.test.cjs electron/ipc-channels.test.cjs`
Expected: FAIL. `copies.listDeckCopies is not a function`, `Cannot find module './decks.cjs'` und sechs Mal `main.cjs fehlt ipcMain.handle(…`.

- [ ] **Step 3: `listDeckCopies` in `copies.cjs`**

Direkt über dem Kommentar `// Vorschlagsliste ueber alle lebenden Exemplare: entdoppelt (ohne Ruecksicht auf` einfügen:
```js
// Spec E1 §4/§7: lebende Exemplare LEBENDER Printings mit Standort und den Preisfeldern, die der Abgleich und
// "Box befüllen" brauchen (unitPrice x Zustandsfaktor, G4). Ausgeschriebene Spaltenliste wie listUnsortedCopies:
// cards und card_copies teilen sich created_at/updated_at/deleted. Ein Exemplar eines Unknown-Printings zaehlt mit.
function listDeckCopies(db) {
  return db.prepare(`
    SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition,
           cp.container_id, cp.page, cp.slot,
           c.name AS card_name, c.price AS price, c.price_first_ed AS price_first_ed
      FROM card_copies cp
      JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code
                  AND c.language = cp.language AND c.rarity = cp.rarity
     WHERE cp.deleted = 0 AND c.deleted = 0
     ORDER BY cp.card_id, cp.copy_id`).all();
}

```
Im `module.exports` `listUnsortedCopies, listTags,` ersetzen durch `listUnsortedCopies, listDeckCopies, listTags,`.

- [ ] **Step 4: `decks.cjs` anlegen**

```js
// Spec E1 §3/§6/§7 — Hauptprozess-Helfer der Decks: Deckbox zuordnen, Fehlende auf die Wunschliste, Exemplare in die
// Deckbox. `client` ist der Supabase-Client aus dealsClient(); die Tests reichen eine Attrappe herein.
const { ValidationError, setCopyLocation } = require('./copies.cjs');

const DECKBOX_TAKEN = 'Diese Deckbox gehört schon zu einem anderen Deck';

// Postgres unique_violation (Index decks_container_unique) -> deutsche Meldung; sonst die Rohmeldung wie bei den
// uebrigen Cloud-Kanaelen der Decks.
function deckContainerErrorMessage(error) {
  if (error && error.code === '23505') return DECKBOX_TAKEN;
  return (error && error.message) || 'Speichern fehlgeschlagen.';
}

async function setDeckContainer(client, { deckId, containerId } = {}) {
  const { error } = await client.from('decks').update({ container_id: containerId || null }).eq('id', deckId);
  if (error) return { success: false, error: deckContainerErrorMessage(error) };
  return { success: true };
}

// items: [{ card_id, name, image_url, max_price }]. Eintrag fuer Eintrag; ein Eintrag mit Preis bekommt wie
// add-to-wishlist einen Deal-Watch (dessen Fehler bricht den Eintrag nicht ab). Die Cloud-Suche wird hoechstens
// EINMAL am Ende angestossen, und nur, wenn mindestens ein Deal-Watch entstanden ist (Spec E1 §6).
async function addMissingToWishlist(client, items, triggerScrape) {
  const list = Array.isArray(items) ? items : [];
  let added = 0;
  let watches = 0;
  const failed = [];
  for (const it of list) {
    const cardId = String(it.card_id);
    const name = it.name || cardId;
    const maxPrice = typeof it.max_price === 'number' ? it.max_price : null;
    let error;
    try {
      ({ error } = await client.from('wishlist').insert({ card_id: cardId, name, image_url: it.image_url || null, max_price: maxPrice }));
    } catch (e) { error = e; }
    if (error) { failed.push(cardId); continue; }
    added += 1;
    if (maxPrice == null) continue;
    try {
      const { error: watchError } = await client.from('deal_watches').insert({ query: name, max_price: maxPrice });
      if (!watchError) watches += 1;
    } catch { /* wie add-to-wishlist: nie fatal */ }
  }
  if (watches > 0) triggerScrape(client);
  return { total: list.length, added, watches, failed };
}

// Exemplar fuer Exemplar ueber setCopyLocation (leert page/slot, weil eine Deckbox keine Seiten hat). Ein Fehlschlag
// betrifft nur seine Zeile; `messageOf` ist containerCopyErrorMessage aus main.cjs.
function moveCopiesToContainer(db, { copyIds, containerId } = {}, messageOf) {
  const box = containerId
    ? db.prepare('SELECT kind FROM containers WHERE container_id = ? AND deleted = 0').get(containerId)
    : null;
  if (!box || box.kind !== 'deckbox') throw new ValidationError('Die Deckbox wurde nicht gefunden.');
  return (Array.isArray(copyIds) ? copyIds : []).map((copy_id) => {
    try {
      setCopyLocation(db, { copy_id, container_id: containerId, page: null, slot: null });
      return { copy_id, success: true };
    } catch (e) {
      return { copy_id, success: false, error: messageOf(e) };
    }
  });
}

module.exports = { DECKBOX_TAKEN, deckContainerErrorMessage, setDeckContainer, addMissingToWishlist, moveCopiesToContainer };
```

- [ ] **Step 5: Kanäle in `main.cjs`**

Nach `const { collectionSql, parseImportCsv } = require('./collection-query.cjs');` einfügen:
```js
const { setDeckContainer, addMissingToWishlist, moveCopiesToContainer } = require('./decks.cjs');
const { catalogPrices } = require('./catalog-prices.cjs');
```
Direkt über `// --- Other Handlers ---` (nach dem Handler `export-deck-ydk`) einfügen:
```js
// --- Spec E1: Sammlungsabgleich & Deckbox ---
// Lebende Exemplare lebender Printings mit Standort und Preisfeldern, dazu die Behaelterliste (lokal, SQLite).
ipcMain.handle('list-deck-copies', () => {
    try { return { copies: copies.listDeckCopies(db), containers: copies.listContainers(db) }; }
    catch (e) { console.error('[list-deck-copies]', e); throw new Error(CONTAINER_COPY_ERROR_MSG); }
});
// Alle Deckkarten aller Decks in einer Abfrage (Deck-Liste mit Zahlen, "in Deck X").
ipcMain.handle('get-all-deck-cards', async () => {
    const c = await dealsClient();
    const { data, error } = await c.from('deck_cards').select('deck_id, card_id, name, count, section').order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
});
// Deckbox zuordnen; die Unique-Verletzung kommt als deutsche Meldung zurueck, nichts wird geaendert.
ipcMain.handle('set-deck-container', async (event, { deckId, containerId } = {}) => {
    const c = await dealsClient();
    return setDeckContainer(c, { deckId, containerId });
});
// Katalogpreise (cm_price) aus der zuletzt gebauten Katalogdatei; ohne Datei available = false.
ipcMain.handle('get-catalog-prices', () => catalogPrices(userDataPath));
// Fehlende auf die Wunschliste: Eintrag fuer Eintrag, die Cloud-Suche hoechstens einmal am Ende.
ipcMain.handle('deck-missing-to-wishlist', async (event, items) => {
    const c = await dealsClient();
    return addMissingToWishlist(c, items, triggerCloudScrape);
});
// Box befuellen: Exemplar fuer Exemplar in die Deckbox, Fehlschlaege je Zeile.
ipcMain.handle('move-copies-to-container', (event, { copyIds, containerId } = {}) => {
    try {
        const results = moveCopiesToContainer(db, { copyIds, containerId }, (e) => containerCopyErrorMessage(e, 'move-copies-to-container'));
        return { success: true, results };
    } catch (e) { return { success: false, error: containerCopyErrorMessage(e, 'move-copies-to-container') }; }
});
```

- [ ] **Step 6: Brücke in `preload.cjs`**

Nach `  exportDeckYdk: (data) => ipcRenderer.invoke('export-deck-ydk', data),` einfügen:
```js
  // Spec E1: Sammlungsabgleich & Deckbox
  listDeckCopies: () => ipcRenderer.invoke('list-deck-copies'),
  getAllDeckCards: () => ipcRenderer.invoke('get-all-deck-cards'),
  setDeckContainer: (data) => ipcRenderer.invoke('set-deck-container', data),
  getCatalogPrices: () => ipcRenderer.invoke('get-catalog-prices'),
  addMissingToWishlist: (items) => ipcRenderer.invoke('deck-missing-to-wishlist', items),
  moveCopiesToContainer: (data) => ipcRenderer.invoke('move-copies-to-container', data),
```

- [ ] **Step 7: Tests laufen lassen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
Expected: alle grün, darunter 1 neuer Test in `copies-location.test.cjs`, 5 in `decks.test.cjs`, 6 in `ipc-channels.test.cjs`.
Run (in `desktop/`): `node --check electron/main.cjs` → keine Ausgabe.
Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` → alle `PASS`-Zeilen (unverändert, `copies.cjs` wird dort mitgeladen).

- [ ] **Step 8: Schutz-Nachweis**

(a) In `listDeckCopies` ` AND c.deleted = 0` entfernen → der Test scheitert mit `+   'printing-weg',` (gemessen). Zitieren, zurücknehmen.
(b) In `addMissingToWishlist` `if (watches > 0) triggerScrape(client);` kurz durch `for (let i = 0; i < watches; i++) triggerScrape(client);` ersetzen → „Cloud-Suche genau einmal …" scheitert mit `actual: 2, expected: 1` (gemessen). Zitieren, zurücknehmen.
(c) In `deckContainerErrorMessage` die Zeile `if (error && error.code === '23505') return DECKBOX_TAKEN;` entfernen → „Deckbox zuordnen: …" scheitert mit `+ 'duplicate key value violates unique constraint "decks_container_unique"'` / `- 'Diese Deckbox gehört schon zu einem anderen Deck'` (gemessen). Zitieren, zurücknehmen.
(d) In `preload.cjs` `invoke('get-catalog-prices')` kurz umbenennen → `ipc-channels.test.cjs` scheitert mit `preload.cjs fehlt ipcRenderer.invoke('get-catalog-prices'` (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/copies.cjs desktop/electron/copies-location.test.cjs desktop/electron/decks.cjs desktop/electron/decks.test.cjs desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/ipc-channels.test.cjs
git commit -m "feat(e1): Desktop-Kanäle für Deck-Abgleich, Deckbox, Fehlende auf die Wunschliste und Box befüllen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Desktop-Oberfläche — Deck-Liste, Abgleich-Kopf, Kartenzeilen, Dialoge

**Files:**
- Create: `desktop/src/components/DeckCoverageHeader.jsx`
- Create: `desktop/src/components/DeckCardNumbers.jsx`
- Create: `desktop/src/components/FillBoxDialog.jsx`
- Create: `desktop/src/components/DeckWishlistDialog.jsx`
- Modify: `desktop/src/components/DeckBuilder.jsx`

**Interfaces:**
- Produces: `<DeckCoverageHeader deck decks coverage containers error boxError onChangeBox onOpenWishlist onOpenFillBox />`, `<DeckCardNumbers card />`, `<FillBoxDialog boxId boxName proposal copiesById containersById onClose onMoved onOpenWishlist />`, `<DeckWishlistDialog coverage cardInfo onClose />`.
- Consumes (Task 2): alle Helfer aus `deckCoverage.js`, `fillBoxProposal.js`, `deckWishlist.js`. Consumes (Task 3): `window.api.listDeckCopies`, `getAllDeckCards`, `getCatalogPrices`, `setDeckContainer`, `addMissingToWishlist`, `moveCopiesToContainer`; vorhanden `getDecks`, `getWishlist`, `onCollectionChanged`, `ROUTES.binder`, `CustomSelect`, `EDITION_LABELS`.

- [ ] **Step 1: `DeckCoverageHeader.jsx` anlegen**

```jsx
import { useNavigate } from 'react-router-dom';
import { Heart, PackageOpen } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { ROUTES } from '../utils/routes';
import { LOADING, deckBoxChoices, deckBoxId, headerText } from '../utils/deckCoverage';

// Spec E1 §8 — Abgleich-Kopf im Deck-Editor: Deckbox-Auswahl, Kennzahlen, "Fehlende auf die Wunschliste", "Box befüllen".
// coverage/containers null = noch nicht geladen: dann "…", nie 0/40.
export default function DeckCoverageHeader({ deck, decks, coverage, containers, error, boxError, onChangeBox, onOpenWishlist, onOpenFillBox }) {
  const navigate = useNavigate();
  const hasDeckboxes = !!containers && containers.some((c) => !c.deleted && c.kind === 'deckbox');
  const options = containers
    ? [{ value: '', label: 'Keine Box' }, ...deckBoxChoices(deck.id, decks, containers).map((c) => ({ value: c.container_id, label: c.name }))]
    : [];

  return (
    <div className="mb-4 p-3 bg-black/30 rounded-xl border border-gray-800 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-bold uppercase text-gray-500">Deckbox</span>
        {!containers ? (
          <span className="text-sm text-gray-400">{LOADING}</span>
        ) : hasDeckboxes ? (
          <CustomSelect className="w-56" value={deckBoxId(deck, containers) || ''} onChange={onChangeBox} options={options} />
        ) : (
          <span className="text-sm text-gray-400">
            Noch keine Deckbox ·{' '}
            <button type="button" onClick={() => navigate(ROUTES.binder)} className="text-space-violet hover:underline">Zu den Behältern</button>
          </span>
        )}
        <span className="font-mono text-sm text-gray-300">{coverage ? headerText(coverage) : LOADING}</span>
      </div>
      <div className="flex gap-2">
        <button
          type="button" onClick={onOpenWishlist} disabled={!coverage || coverage.totals.missing === 0}
          className="flex items-center px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm border border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Heart className="w-4 h-4 mr-2" /> Fehlende auf die Wunschliste
        </button>
        <button
          type="button" onClick={onOpenFillBox} disabled={!coverage || !coverage.boxId}
          className="flex items-center px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm border border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <PackageOpen className="w-4 h-4 mr-2" /> Box befüllen
        </button>
      </div>
      {boxError && <p className="text-sm text-red-400">{boxError}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: `DeckCardNumbers.jsx` anlegen**

```jsx
import { LOADING, reservedTexts, rowText } from '../utils/deckCoverage';

// Spec E1 §8 — Kartenzeilen-Zahlen "Box 1 · verfügbar 2 · gebraucht 3" (rot bei Fehlenden) und gelb "1 in Deck Tenpai".
// card null = Abgleich noch nicht geladen: "…".
export default function DeckCardNumbers({ card }) {
  if (!card) return <span className="text-xs font-mono text-gray-500">{LOADING}</span>;
  return (
    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
      <span className={`text-xs font-mono ${card.missing > 0 ? 'text-red-400' : 'text-gray-400'}`}>{rowText(card)}</span>
      {reservedTexts(card).map((t) => (
        <span key={t} className="text-[10px] px-1.5 rounded bg-yellow-500/15 text-yellow-400">{t}</span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `FillBoxDialog.jsx` anlegen**

```jsx
import { useState } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';
import { EDITION_LABELS } from '../utils/valuation';
import { locationText, shortText, surplusText } from '../utils/fillBoxProposal';

// Spec E1 §7 — Dialog "Box befüllen". Der Vorschlag wird beim Oeffnen eingefroren (proposal): laden die Zahlen nach
// dem Verschieben neu, bleiben die Zeilen mit ihrer Rueckmeldung stehen. Verschoben wird Exemplar fuer Exemplar im
// Hauptprozess (move-copies-to-container); ein Fehlschlag steht an seiner Zeile.
export default function FillBoxDialog({ boxId, boxName, proposal, copiesById, containersById, onClose, onMoved, onOpenWishlist }) {
  const [checked, setChecked] = useState(() => new Set(proposal.rows.map((r) => r.copy_id)));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const toggle = (id) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      const copyIds = proposal.rows.filter((r) => checked.has(r.copy_id)).map((r) => r.copy_id);
      const res = await window.api.moveCopiesToContainer({ copyIds, containerId: boxId });
      if (res.success) {
        setResults(new Map(res.results.map((r) => [r.copy_id, r])));
        onMoved();
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };

  const short = shortText(proposal.short);
  const surplus = surplusText(proposal.surplus);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-obsidian-700 border border-line rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">Box befüllen · {boxName}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
          {proposal.rows.length === 0 && <p className="text-sm text-ink-muted">Nichts zu verschieben.</p>}
          {proposal.rows.map((r) => {
            const cp = copiesById.get(r.copy_id);
            const result = results && results.get(r.copy_id);
            return (
              <label key={r.copy_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-obsidian-600 text-sm">
                <input type="checkbox" checked={checked.has(r.copy_id)} disabled={busy || !!results} onChange={() => toggle(r.copy_id)} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-ink">{cp.card_name || cp.card_id}</span>
                  <span className="block truncate font-mono text-xs text-ink-muted">
                    {cp.set_code} · {cp.rarity} · {EDITION_LABELS[cp.edition] || cp.edition}
                  </span>
                </span>
                <span className="text-xs text-ink-muted">{locationText(cp, containersById.get(cp.container_id))}</span>
                {result && result.success && <Check className="w-4 h-4 text-good" />}
                {result && !result.success && <span className="text-xs text-crit">{result.error}</span>}
              </label>
            );
          })}
        </div>

        {short && (
          <p className="text-sm text-warn flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {short} ·{' '}
            <button type="button" onClick={onOpenWishlist} className="text-space-violet hover:underline">Fehlende auf die Wunschliste</button>
          </p>
        )}
        {surplus && <p className="text-sm text-ink-muted">{surplus}</p>}
        {error && <p className="text-sm text-crit">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Schließen</button>
          {!results && (
            <button
              type="button" onClick={move} disabled={busy || checked.size === 0}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'Wird verschoben…' : 'In die Box verschieben'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `DeckWishlistDialog.jsx` anlegen**

```jsx
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { LOADING } from '../utils/deckCoverage';
import { missingForWishlist, wishlistConfirmText, wishlistResultText } from '../utils/deckWishlist';

// Spec E1 §6 — Bestaetigung und Rueckmeldung fuer "Fehlende auf die Wunschliste". Die Wunschliste wird beim Oeffnen
// frisch gelesen, damit "stehen schon drauf" stimmt. Anlegen und die EINE Cloud-Suche macht der Hauptprozess.
export default function DeckWishlistDialog({ coverage, cardInfo, onClose }) {
  const [plan, setPlan] = useState(null);
  const [state, setState] = useState({ busy: false, result: null, error: null });

  useEffect(() => {
    let alive = true;
    window.api.getWishlist()
      .then((list) => { if (alive) setPlan(missingForWishlist(coverage, (list || []).map((w) => w.card_id))); })
      .catch((e) => { if (alive) setState((s) => ({ ...s, error: e.message || String(e) })); });
    return () => { alive = false; };
  }, [coverage]);

  const add = async () => {
    setState({ busy: true, result: null, error: null });
    try {
      const items = plan.candidates.map((c) => {
        const info = cardInfo.get(c.card_id) || {};
        return { card_id: c.card_id, name: info.name || c.card_id, image_url: info.image_url || null, max_price: c.max_price };
      });
      const result = await window.api.addMissingToWishlist(items);
      setState({ busy: false, result, error: null });
    } catch (e) {
      setState({ busy: false, result: null, error: e.message || String(e) });
    }
  };

  const text = state.result ? wishlistResultText(state.result) : plan ? wishlistConfirmText(plan) : LOADING;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={state.busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-obsidian-700 border border-line rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">Fehlende auf die Wunschliste</h3>
          <button type="button" onClick={onClose} disabled={state.busy} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-ink">{text}</p>
        {state.error && <p className="text-sm text-crit">{state.error}</p>}
        <div className="flex justify-end gap-2">
          {state.result ? (
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Schließen</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={state.busy} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Abbrechen</button>
              <button
                type="button" onClick={add} disabled={state.busy || !plan || plan.candidates.length === 0}
                className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {state.busy ? 'Wird hinzugefügt…' : 'Hinzufügen'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `DeckBuilder.jsx` anpassen**

(a) Zeilen 1–6 (Importe bis einschließlich `  const [decks, setDecks] = useState([]);`) ersetzen durch:
```jsx
import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Save, Upload, FileUp, Download, BarChart2, PieChart as PieChartIcon, Play } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { LOADING, boxLabel, deckBoxId, deckCoverage, listText } from '../utils/deckCoverage';
import { fillBoxProposal } from '../utils/fillBoxProposal';
import DeckCoverageHeader from './DeckCoverageHeader';
import DeckCardNumbers from './DeckCardNumbers';
import FillBoxDialog from './FillBoxDialog';
import DeckWishlistDialog from './DeckWishlistDialog';

// Spec E1 §4: alles, was der Abgleich braucht, in einem Rutsch -- lokale Exemplare und Behaelter, alle Deckkarten
// aus der Cloud, Katalogpreise. Die Decks selbst kommen wie bisher ueber getDecks.
function fetchCoverageData() {
  return Promise.all([window.api.listDeckCopies(), window.api.getAllDeckCards(), window.api.getCatalogPrices()])
    .then(([local, deckCards, catalog]) => ({ copies: local.copies, containers: local.containers, deckCards: deckCards || [], prices: catalog.prices }));
}

export default function DeckBuilder() {
  const [decks, setDecks] = useState([]);
  // Spec E1 §8: bis Decks UND Abgleichsdaten da sind, zeigen alle Zahlen "…" -- nie 0/40.
  const [decksLoaded, setDecksLoaded] = useState(false);
  const [coverageData, setCoverageData] = useState(null);
  const [coverageError, setCoverageError] = useState(null);
  const [boxError, setBoxError] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'fill', proposal } | { kind: 'wishlist' } | null
```
(`AlertTriangle` fällt weg, weil Schritt (h) die rote „fehlt"-Anzeige ersetzt.)

(b) Den ersten `useEffect` ersetzen:
```jsx
  useEffect(() => {
    if (window.api) {
        window.api.getDecks().then((d) => { setDecks(d); setDecksLoaded(true); });
        window.api.getCollection().then(setCollection);
        fetchCoverageData().then(setCoverageData).catch((e) => setCoverageError(e.message || String(e)));
    }
  }, []);

  // Spec E1 §12.4: zieht der Sync Exemplar-Aenderungen vom Handy herein, stimmen Ort und Zahlen auch hier.
  useEffect(() => window.api?.onCollectionChanged?.(() => {
      fetchCoverageData().then(setCoverageData).catch((e) => setCoverageError(e.message || String(e)));
  }), []);

  const reloadCoverage = () => fetchCoverageData()
      .then((d) => { setCoverageData(d); setCoverageError(null); })
      .catch((e) => setCoverageError(e.message || String(e)));

  const ready = decksLoaded && !!coverageData;

  // Deck-Liste: gespeicherte Deckkarten je Deck (nicht die ungespeicherten Aenderungen im Editor).
  const listCoverage = useMemo(() => {
      if (!ready) return null;
      const byDeck = new Map();
      for (const dc of coverageData.deckCards) {
          if (!byDeck.has(dc.deck_id)) byDeck.set(dc.deck_id, []);
          byDeck.get(dc.deck_id).push(dc);
      }
      return new Map(decks.map((d) => [d.id, deckCoverage({
          deckId: d.id, deckCards: byDeck.get(d.id) || [], copies: coverageData.copies,
          decks, containers: coverageData.containers, prices: coverageData.prices,
      })]));
  }, [ready, coverageData, decks]);
```

(c) In `handleSaveDeck` die beiden letzten Zeilen `      alert("Deck saved!");` und `  };` ersetzen durch (lädt neu und hängt den Box-Handler an):
```jsx
      reloadCoverage();   // Spec E1: die Deck-Liste rechnet mit den gespeicherten Deckkarten
      alert("Deck saved!");
  };

  // Spec E1 §3/§9: Deckbox zuordnen. Lehnt die Cloud ab (Unique-Index), bleibt alles, wie es war, und die Meldung steht.
  const handleChangeBox = async (containerId) => {
      if (!activeDeck || !window.api) return;
      setBoxError(null);
      try {
          const res = await window.api.setDeckContainer({ deckId: activeDeck.id, containerId: containerId || null });
          if (!res.success) { setBoxError(res.error); return; }
          setDecks((prev) => prev.map((d) => (d.id === activeDeck.id ? { ...d, container_id: containerId || null } : d)));
          setActiveDeck((prev) => ({ ...prev, container_id: containerId || null }));
      } catch (e) {
          setBoxError(e.message || String(e));
      }
  };
```

(d) Nach `  const filteredCollection = collection.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()));` einfügen:
```jsx

  // Spec E1 §4/§8: Abgleich des geoeffneten Decks mit den Karten, wie sie gerade im Editor stehen.
  const activeCards = useMemo(() => [
      ...mainDeck.map((c) => ({ card_id: String(c.card_id), count: c.quantity, section: 'main' })),
      ...extraDeck.map((c) => ({ card_id: String(c.card_id), count: c.quantity, section: 'extra' })),
      ...sideDeck.map((c) => ({ card_id: String(c.card_id), count: c.quantity, section: 'side' })),
  ], [mainDeck, extraDeck, sideDeck]);
  const activeCoverage = useMemo(() => (ready && activeDeck ? deckCoverage({
      deckId: activeDeck.id, deckCards: activeCards, copies: coverageData.copies,
      decks, containers: coverageData.containers, prices: coverageData.prices,
  }) : null), [ready, activeDeck, activeCards, coverageData, decks]);
  const coverageByCard = useMemo(() => new Map((activeCoverage ? activeCoverage.cards : []).map((c) => [c.card_id, c])), [activeCoverage]);
  const deckCardInfo = useMemo(() => new Map([...mainDeck, ...extraDeck, ...sideDeck].map((c) => [String(c.card_id), c])), [mainDeck, extraDeck, sideDeck]);
  const copiesById = useMemo(() => new Map((coverageData ? coverageData.copies : []).map((c) => [c.copy_id, c])), [coverageData]);
  const containersById = useMemo(() => new Map((coverageData ? coverageData.containers : []).map((c) => [c.container_id, c])), [coverageData]);
  const numbersFor = (cardId) => (activeCoverage ? coverageByCard.get(String(cardId)) : null);

  const openFillBox = () => setDialog({
      kind: 'fill',
      proposal: fillBoxProposal({ deckId: activeDeck.id, deckCards: activeCards, copies: coverageData.copies, decks, containers: coverageData.containers }),
  });
```

(e) In der Deck-Liste `                            <span className="truncate">{deck.name}</span>` ersetzen:
```jsx
                            <div className="min-w-0">
                                <span className="block truncate">{deck.name}</span>
                                <span className="block truncate text-[11px] font-mono text-gray-500">
                                    {listCoverage ? `${boxLabel(deck, coverageData.containers)} · ${listText(listCoverage.get(deck.id))}` : LOADING}
                                </span>
                            </div>
```

(f) `                    {showStats && <DeckStats {...deckStatsProps} />}` ersetzen:
```jsx
                    <DeckCoverageHeader
                        deck={activeDeck} decks={decks} coverage={activeCoverage}
                        containers={coverageData ? coverageData.containers : null}
                        error={coverageError} boxError={boxError}
                        onChangeBox={handleChangeBox}
                        onOpenWishlist={() => setDialog({ kind: 'wishlist' })}
                        onOpenFillBox={openFillBox}
                    />

                    {showStats && <DeckStats {...deckStatsProps} />}
```

(g) In den drei `DeckCardRow`-Aufrufen (Main, Extra, Side) jeweils ` collection={collection} ` durch ` numbers={numbersFor(c.card_id)} ` ersetzen.

(h) Am Ende der Komponente die Zeilen
```jsx
                    <p className="text-lg">Select or Create a Deck</p>
                </div>
            )}
        </div>
    </div>
  );
}
```
ersetzen durch:
```jsx
                    <p className="text-lg">Select or Create a Deck</p>
                </div>
            )}
        </div>

        {dialog && dialog.kind === 'fill' && activeCoverage && (
            <FillBoxDialog
                boxId={deckBoxId(activeDeck, coverageData.containers)}
                boxName={boxLabel(activeDeck, coverageData.containers)}
                proposal={dialog.proposal} copiesById={copiesById} containersById={containersById}
                onClose={() => setDialog(null)} onMoved={reloadCoverage}
                onOpenWishlist={() => setDialog({ kind: 'wishlist' })}
            />
        )}
        {dialog && dialog.kind === 'wishlist' && activeCoverage && (
            <DeckWishlistDialog coverage={activeCoverage} cardInfo={deckCardInfo} onClose={() => setDialog(null)} />
        )}
    </div>
  );
}
```
und `DeckCardRow` umstellen: den Kopf
```jsx
// Sub-component for a card row in deck list
const DeckCardRow = ({ card, type, collection, removeFromDeck }) => {
    // Check ownership
    const owned = collection.find(c => c.id === card.card_id);
    const ownedQty = owned ? owned.quantity : 0;
    const missing = card.quantity > ownedQty;
```
ersetzen durch
```jsx
// Sub-component for a card row in deck list
// Spec E1 §8: statt des roten "fehlt" die drei Zahlen aus dem Abgleich (numbers null = noch nicht geladen).
const DeckCardRow = ({ card, type, numbers, removeFromDeck }) => {
    const missing = !!numbers && numbers.missing > 0;
```
und den sechszeiligen Block, der mit `{missing && (` beginnt und das `AlertTriangle` mit `{ownedQty}/{card.quantity}` zeigt, ersetzen durch:
```jsx
            <DeckCardNumbers card={numbers} />
```
Per Grep (lesend) prüfen: `Grep "collection=\{collection\}|AlertTriangle|ownedQty" desktop/src/components/DeckBuilder.jsx` findet nichts mehr.

- [ ] **Step 6: Lint, Helfer, Build**

Run (in `desktop/`): `npx eslint .` → genau `5 errors` (die neuen Dateien sind mit der Referenzfassung ohne Befund gelintet).
Run (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs` → alle grün.
Run (in `desktop/`): `npx vite build` → erfolgreich.

- [ ] **Step 7: Kein neuer Schutz-Test**

Dieser Task ist reine Oberfläche; die Regeln sind in Task 2 und 3 geschützt. Im Bericht per Grep (lesend) belegen, dass jede Zahlenstelle einen `LOADING`-Zweig hat: `Grep "LOADING" desktop/src/components` zeigt `DeckBuilder.jsx` (Liste), `DeckCoverageHeader.jsx` (Auswahl und Kennzahlen), `DeckCardNumbers.jsx` (Zeile) und `DeckWishlistDialog.jsx` (Text vor dem Laden der Wunschliste). Die Anzeige prüft die Abnahme (Plan-Ergänzung 21).

- [ ] **Step 8: Commit**

```bash
git add desktop/src/components/DeckCoverageHeader.jsx desktop/src/components/DeckCardNumbers.jsx desktop/src/components/FillBoxDialog.jsx desktop/src/components/DeckWishlistDialog.jsx desktop/src/components/DeckBuilder.jsx
git commit -m "feat(e1): Deckbuilder zeigt Abgleich, Deckbox-Auswahl, Box befüllen und Fehlende auf die Wunschliste

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: Handy-Katalog — `cm_price`, `CatalogDb` Schema v3, Preisabfrage

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogDb.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt`
- Modify: `android/app/src/test/java/com/example/yugiohscanner/CatalogSealedTest.kt`

**Interfaces:**
- Produces (für Task 7): `CatalogCard.cmPrice: Double? = null`; `CatalogDb.VERSION = 3` mit Spalte `cards.cm_price REAL`; `CatalogRepository.cmPriceQuery(ids: List<String>): Pair<String, Array<String>>` (internal), `CatalogRepository.cmPrices(ids: Collection<String>): Map<String, Double?>`.
- Consumes (Task 1): Katalog-JSON mit `cards[].cm_price` (Zahl oder `null`, ab Version 6).

- [ ] **Step 1: Tests schreiben**

(a) In `CatalogParserTest.kt` den Import `import com.example.yugiohscanner.cloud.CatalogRepository` ergänzen und vor der letzten schließenden Klammer der Klasse einfügen:
```kotlin

    // Spec E1 §5: Katalog ab Version 6 traegt cm_price; fehlt oder <= 0 -> null.
    @Test fun `liest cm_price ab Katalog 6, null und 0 werden null`() {
        val json = """{"version":6,"built_at":"x","cards":[
          {"id":1,"name_de":"A","name_en":"A","type":"t","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"cm_price":35.71},
          {"id":2,"name_de":"B","name_en":"B","type":"t","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"cm_price":null},
          {"id":3,"name_de":"C","name_en":"C","type":"t","desc_de":"d","image":"i","image_small":"s","printings":[],"printings_verified":[],"cm_price":0}]}"""
        val cards = CatalogParser.parse(gz(json)).cards
        assertEquals(35.71, cards[0].cmPrice!!, 1e-9)
        assertEquals(null, cards[1].cmPrice)
        assertEquals(null, cards[2].cmPrice)
    }

    @Test fun `Katalog 5 ohne cm_price bleibt lesbar`() {
        val c = CatalogParser.parse(gz(sample)).cards[0]
        assertEquals("Dunkler Magier", c.nameDe)
        assertEquals(null, c.cmPrice)
    }

    @Test fun `Preisabfrage hat einen Platzhalter je Passcode`() {
        val (sql, args) = CatalogRepository.cmPriceQuery(listOf("14558127", "23434538"))
        assertEquals("SELECT id, cm_price FROM cards WHERE id IN (?,?)", sql)
        assertEquals(listOf("14558127", "23434538"), args.toList())
    }
```

(b) In `CatalogSealedTest.kt` den Test
```kotlin
    @Test fun `Katalog-Schema ist Version 2`() {
        assertEquals(2, CatalogDb.VERSION)
    }
```
ersetzen durch
```kotlin
    @Test fun `Katalog-Schema ist Version 3`() {
        // Spec E1 §5: v3 bringt cards.cm_price (v2 brachte sealed_products).
        assertEquals(3, CatalogDb.VERSION)
    }
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "com.example.yugiohscanner.CatalogParserTest" --tests "com.example.yugiohscanner.CatalogSealedTest"`
Expected: FAIL beim Kompilieren mit `Unresolved reference: cmPrice` und `Unresolved reference: cmPriceQuery`.

- [ ] **Step 3: `CatalogParser.kt`**

In `data class CatalogCard` die letzte Zeile `    val printings: List<CatalogPrinting>` ersetzen durch:
```kotlin
    val printings: List<CatalogPrinting>,
    // Spec E1 §5: Cardmarket-Preis je Passcode (Katalog ab Version 6), sonst null.
    val cmPrice: Double? = null,
```
In `parse` direkt vor `// Parse printings and printings_verified` einfügen:
```kotlin
                // Spec E1 §5: cm_price ab Katalog 6; fehlt (Katalog 5), null oder <= 0 -> null.
                val cmPrice = if (cardJson.has("cm_price") && !cardJson.isNull("cm_price"))
                    cardJson.optDouble("cm_price").takeIf { it > 0.0 } else null

```
Im `CatalogCard(...)`-Aufruf `                    printings = printings` ersetzen durch:
```kotlin
                    printings = printings,
                    cmPrice = cmPrice,
```

- [ ] **Step 4: `CatalogDb.kt`**

Companion ersetzen:
```kotlin
    companion object {
        /**
         * Spec G3 §3: v2 bringt `sealed_products`. Spec E1 §5: v3 bringt `cards.cm_price`.
         * onUpgrade verwirft den alten Katalog, CatalogSync laedt neu (ein Katalog v5 ohne cm_price bleibt lesbar).
         */
        const val VERSION = 3
    }
```
In `onCreate` `              image TEXT, image_small TEXT)` ersetzen durch `              image TEXT, image_small TEXT, cm_price REAL)`.
In `importAll` nach `                cardValues.put("image_small", card.imageSmall)` einfügen:
```kotlin
                if (card.cmPrice == null) cardValues.putNull("cm_price") else cardValues.put("cm_price", card.cmPrice)
```

- [ ] **Step 5: `CatalogRepository.kt`**

Vor `    private fun escapeLike(input: String): String =` einfügen:
```kotlin
    /** Spec E1 §5: SQL und Argumente fuer die Katalogpreise mehrerer Passcodes -- rein, damit ohne SQLite testbar. */
    internal fun cmPriceQuery(ids: List<String>): Pair<String, Array<String>> =
        "SELECT id, cm_price FROM cards WHERE id IN (${ids.joinToString(",") { "?" }})" to ids.toTypedArray()

    /**
     * Katalogpreis je Passcode; fehlt der Passcode, steht er nicht in der Map (gilt als "ohne Preis"). In Bloecken zu
     * 500, weil SQLite hoechstens 999 Parameter annimmt. Aufrufer lesen abseits des Hauptthreads.
     */
    fun cmPrices(ids: Collection<String>): Map<String, Double?> {
        val database = db?.readableDatabase ?: return emptyMap()
        val out = HashMap<String, Double?>()
        for (chunk in ids.distinct().chunked(500)) {
            val (sql, args) = cmPriceQuery(chunk)
            database.rawQuery(sql, args).use { c ->
                while (c.moveToNext()) out[c.getString(0)] = if (c.isNull(1)) null else c.getDouble(1)
            }
        }
        return out
    }

```
In `readCard` im `CatalogCard(...)`-Aufruf `            printings = emptyList()` ersetzen durch:
```kotlin
            printings = emptyList(),
            cmPrice = c.getColumnIndex("cm_price").takeIf { it >= 0 && !c.isNull(it) }?.let { c.getDouble(it) },
```

- [ ] **Step 6: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, alle Tests grün, `CatalogParserTest` mit 3 neuen Tests.

- [ ] **Step 7: Schutz-Nachweis**

In `CatalogParser.parse` `.takeIf { it > 0.0 }` kurz entfernen → `liest cm_price ab Katalog 6, …` scheitert mit `expected:<null> but was:<0.0>`. Zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogParser.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogDb.kt android/app/src/main/java/com/example/yugiohscanner/cloud/CatalogRepository.kt android/app/src/test/java/com/example/yugiohscanner/CatalogParserTest.kt android/app/src/test/java/com/example/yugiohscanner/CatalogSealedTest.kt
git commit -m "feat(e1): Handy-Katalog v3 liest cm_price, Katalog v5 bleibt lesbar

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Kotlin-Zwillinge `DeckCoverage`, `FillBoxProposal`, `DeckWishlist`

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt` (nur die beiden Datenklassen)
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/DeckCoverage.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/FillBoxProposal.kt`
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/DeckWishlist.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/DeckFixtureWorld.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/DeckCoverageTest.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/FillBoxProposalTest.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/DeckWishlistTest.kt`

**Interfaces:**
- Produces (für Task 7): `Deck(id: Long, name: String, containerId: String? = null)`, `DeckCard(..., deckId: Long = 0L)`; `Reserved`, `CoverageCard`, `CoverageTotals`, `Coverage`; `DeckCoverage.LOADING`, `validDeckboxIds`, `deckBoxChoices(deckId, decks, containers)`, `deckBoxId(deck, containers)`, `compute(deckId, deckCards, copies, cards, decks, containers, prices): Coverage`, `eur`, `costText`, `headerText`, `listText`, `boxLabel`, `rowText`, `reservedTexts`; `FillRow(copy, card, group)`, `FillProposal(rows, short, surplus)`, `FillBoxProposal.compute(deckId, deckCards, copies, cards, decks, containers): FillProposal?`, `locationText(copy, container)`, `shortText(n)`, `surplusText(n)`; `WishCandidate`, `WishPlan`, `WishResult`, `DeckWishlist.wishlistMaxPrice`, `missingForWishlist`, `confirmText`, `resultText(total, added, watches)`, `suspend addAll(candidates, add, triggerScrape): WishResult`.
- Consumes (Task 2): die drei Fixtures. Consumes (vorhanden): `CopyRow`, `CardRow`, `printingKey()`, `ContainerRow`, `Valuation.unitPrice/factor` (G4).

Die Kotlin-Fassungen dieses Tasks sind mit dem Kotlin-2.0.0-Compiler des Projekts gegen dieselben Fixtures kompiliert und ausgeführt worden (10 Tests grün, Schutz-Nachweis (a) gemessen).

- [ ] **Step 1: Datenklassen in `DecksRepository.kt`**

```kotlin
data class Deck(val id: Long, val name: String, val containerId: String? = null)
data class DeckCard(
    val id: Long, val cardId: String, val name: String?, val imageUrl: String?,
    val count: Int, val section: String,
    // Spec E1 §4: nur bei loadAllCards gesetzt (Deck-Liste mit Zahlen); loadCards(deckId) kennt das Deck ohnehin.
    val deckId: Long = 0L,
)
```
(ersetzt die beiden bisherigen Zeilen 13–17; `Deck.containerId` ist Spec E1 §3.)

- [ ] **Step 2: Tests schreiben**

`DeckFixtureWorld.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.printingKey
import org.json.JSONArray
import org.json.JSONObject

/**
 * Spec E1 -- liest die "world" der Deck-Fixtures (docs/fixtures/decks/coverage.json, fill-box.json) in die Typen des
 * Handys. Ein Exemplar mit printing_deleted bekommt KEINE CardRow (der Speicher fuehrt nur lebende Printings).
 */
class DeckFixtureWorld(world: JSONObject) {
    val containers: List<ContainerRow> = world.getJSONArray("containers").objects().map {
        ContainerRow(it.getString("container_id"), it.getString("name"), it.getString("kind"), null, null, 0, deleted = it.getBoolean("deleted"))
    }
    val decks: List<Deck> = world.getJSONArray("decks").objects().map {
        Deck(it.getLong("id"), it.getString("name"), if (it.isNull("container_id")) null else it.getString("container_id"))
    }
    val copies: List<CopyRow> = world.getJSONArray("copies").objects().map {
        CopyRow(
            it.getString("copy_id"), it.getString("card_id"), it.getString("set_code"), "DE", it.optString("rarity", "Common"),
            it.optString("edition", "unknown"), it.optString("condition", "NM"), it.getBoolean("deleted"),
            containerId = if (it.isNull("container_id")) null else it.getString("container_id"),
            page = if (it.isNull("page")) null else it.optInt("page"),
            slot = if (it.isNull("slot")) null else it.optInt("slot"),
            tags = null, note = null,
        )
    }
    val cards: List<CardRow> = world.getJSONArray("copies").objects()
        .filter { !it.getBoolean("printing_deleted") }
        .map {
            CardRow(
                it.getString("card_id"), it.getString("set_code"), "DE", null, null, it.optString("rarity", "Common"), 1,
                if (it.isNull("price")) null else it.optDouble("price"),
                priceFirstEd = if (it.isNull("price_first_ed")) null else it.optDouble("price_first_ed"),
            )
        }
        .distinctBy { it.printingKey() }

    companion object {
        fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

        fun deckCards(arr: JSONArray): List<DeckCard> = arr.objects().mapIndexed { i, o ->
            DeckCard(i.toLong(), o.getString("card_id"), null, null, o.getInt("count"), o.getString("section"))
        }

        fun prices(o: JSONObject?): Map<String, Double?> =
            o?.keys()?.asSequence()?.associateWith { if (o.isNull(it)) null else o.getDouble(it) } ?: emptyMap()
    }
}
```

`DeckCoverageTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.DeckCoverage
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/deckCoverage.test.js -- dieselbe Fixture docs/fixtures/decks/coverage.json. */
class DeckCoverageTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/coverage.json"))
    private val w = DeckFixtureWorld(fix.getJSONObject("world"))
    private val worldPrices = DeckFixtureWorld.prices(fix.getJSONObject("world").getJSONObject("prices"))

    private fun dbl(o: JSONObject, k: String): Double? = if (o.isNull(k)) null else o.getDouble(k)
    private fun str(o: JSONObject, k: String): String? = if (o.isNull(k)) null else o.getString(k)

    @Test fun `alle Fixture-Faelle`() {
        for (c in fix.getJSONArray("cases").objects()) {
            val name = c.getString("name")
            val deckId = c.getLong("deckId")
            val prices = if (c.has("prices")) DeckFixtureWorld.prices(c.getJSONObject("prices")) else worldPrices
            val cov = DeckCoverage.compute(deckId, DeckFixtureWorld.deckCards(c.getJSONArray("deckCards")), w.copies, w.cards, w.decks, w.containers, prices)
            val e = c.getJSONObject("expected")
            assertEquals("$name boxId", str(e, "boxId"), cov.boxId)

            val ec = e.getJSONArray("cards").objects()
            assertEquals("$name cards", ec.size, cov.cards.size)
            cov.cards.zip(ec).forEach { (got, exp) ->
                val n = "$name ${exp.getString("card_id")}"
                assertEquals(n, exp.getString("card_id"), got.cardId)
                assertEquals("$n needed", exp.getInt("needed"), got.needed)
                assertEquals("$n inBox", exp.getInt("inBox"), got.inBox)
                assertEquals("$n available", exp.getInt("available"), got.available)
                assertEquals("$n missing", exp.getInt("missing"), got.missing)
                assertEquals("$n price", dbl(exp, "price"), got.price)
                assertEquals("$n missingCost", dbl(exp, "missingCost"), got.missingCost)
                assertEquals("$n reserved", exp.getJSONArray("reservedElsewhere").objects().map { Triple(it.getLong("deck_id"), it.getString("name"), it.getInt("count")) },
                    got.reservedElsewhere.map { Triple(it.deckId, it.name, it.count) })
            }

            val t = e.getJSONObject("totals")
            assertEquals("$name needed", t.getInt("needed"), cov.totals.needed)
            assertEquals("$name owned", t.getInt("owned"), cov.totals.owned)
            assertEquals("$name boxed", t.getInt("boxed"), cov.totals.boxed)
            assertEquals("$name missing", t.getInt("missing"), cov.totals.missing)
            assertEquals("$name missingCards", t.getInt("missingCards"), cov.totals.missingCards)
            assertEquals("$name cost", t.getDouble("cost"), cov.totals.cost, 1e-9)
            assertEquals("$name unpriced", t.getInt("unpriced"), cov.totals.unpriced)

            val x = e.getJSONObject("texts")
            val deck = w.decks.first { it.id == deckId }
            assertEquals("$name box", x.getString("box"), DeckCoverage.boxLabel(deck, w.containers))
            assertEquals("$name header", x.getString("header"), DeckCoverage.headerText(cov))
            assertEquals("$name list", x.getString("list"), DeckCoverage.listText(cov))
            assertEquals("$name cost", str(x, "cost"), DeckCoverage.costText(cov.totals))
            val rows = x.getJSONArray("rows")
            assertEquals("$name rows", (0 until rows.length()).map { rows.getString(it) }, cov.cards.map { DeckCoverage.rowText(it) })
            val reserved = x.getJSONArray("reserved")
            assertEquals("$name reserved", (0 until reserved.length()).map { i -> reserved.getJSONArray(i).let { a -> (0 until a.length()).map { a.getString(it) } } },
                cov.cards.map { DeckCoverage.reservedTexts(it) })
        }
    }

    @Test fun `Fixture Deckbox-Auswahl`() {
        for (c in fix.getJSONArray("choices").objects()) {
            val ids = c.getJSONArray("container_ids")
            assertEquals("Deck ${c.getLong("deckId")}", (0 until ids.length()).map { ids.getString(it) },
                DeckCoverage.deckBoxChoices(c.getLong("deckId"), w.decks, w.containers).map { it.containerId })
        }
    }

    @Test fun `Platzhalter ist nie eine Null`() {
        assertEquals("…", DeckCoverage.LOADING)
    }
}
```

`FillBoxProposalTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.ml.FillBoxProposal
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** ZWILLING von desktop/src/utils/fillBoxProposal.test.js -- dieselbe Fixture docs/fixtures/decks/fill-box.json. */
class FillBoxProposalTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/fill-box.json"))
    private val w = DeckFixtureWorld(fix.getJSONObject("world"))

    @Test fun `alle Fixture-Faelle`() {
        for (c in fix.getJSONArray("cases").objects()) {
            val name = c.getString("name")
            val got = FillBoxProposal.compute(c.getLong("deckId"), DeckFixtureWorld.deckCards(c.getJSONArray("deckCards")), w.copies, w.cards, w.decks, w.containers)
            if (c.isNull("expected")) { assertNull(name, got); continue }
            val e = c.getJSONObject("expected")
            assertEquals("$name rows", e.getJSONArray("rows").objects().map { Triple(it.getString("copy_id"), it.getString("card_id"), it.getInt("group")) },
                got!!.rows.map { Triple(it.copy.copyId, it.copy.cardId, it.group) })
            assertEquals("$name short", e.getInt("short"), got.short)
            assertEquals("$name surplus", e.getInt("surplus"), got.surplus)
        }
    }

    @Test fun `Fixture Ortstext`() {
        val byId = w.containers.associateBy { it.containerId }
        for (l in fix.getJSONArray("location").objects()) {
            val o = l.getJSONObject("copy")
            val cid = if (o.isNull("container_id")) null else o.getString("container_id")
            val copy = CopyRow("x", "1", "X", "DE", "Common", "unknown", "NM", false,
                containerId = cid, page = if (o.isNull("page")) null else o.getInt("page"),
                slot = if (o.isNull("slot")) null else o.getInt("slot"), tags = null, note = null)
            assertEquals(l.getString("name"), l.getString("text"), FillBoxProposal.locationText(copy, cid?.let { byId[it] }))
        }
    }

    @Test fun `Fixture Hinweistexte`() {
        for (t in fix.getJSONArray("texts").objects()) {
            val n = t.getInt("n")
            assertEquals("short $n", if (t.isNull("short")) null else t.getString("short"), FillBoxProposal.shortText(n))
            assertEquals("surplus $n", if (t.isNull("surplus")) null else t.getString("surplus"), FillBoxProposal.surplusText(n))
        }
    }
}
```

`DeckWishlistTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.Coverage
import com.example.yugiohscanner.ml.CoverageCard
import com.example.yugiohscanner.ml.CoverageTotals
import com.example.yugiohscanner.ml.DeckWishlist
import com.example.yugiohscanner.ml.WishCandidate
import com.example.yugiohscanner.ml.WishPlan
import com.example.yugiohscanner.ml.WishResult
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/deckWishlist.test.js (Fixture docs/fixtures/decks/wishlist.json) und decks.test.cjs (eine Cloud-Suche). */
class DeckWishlistTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/decks/wishlist.json"))
    private fun dbl(o: JSONObject, k: String): Double? = if (o.isNull(k)) null else o.getDouble(k)

    @Test fun `Fixture Hoechstpreis`() {
        for (c in fix.getJSONArray("maxPrice").objects()) {
            assertEquals("${dbl(c, "cm_price")}", dbl(c, "max_price"), DeckWishlist.wishlistMaxPrice(dbl(c, "cm_price")))
        }
    }

    @Test fun `Fixture Auswahl`() {
        for (m in fix.getJSONArray("missing").objects()) {
            val cards = m.getJSONObject("coverage").getJSONArray("cards").objects().map {
                CoverageCard(it.getString("card_id"), 0, 0, 0, it.getInt("missing"), dbl(it, "price"), null, emptyList())
            }
            val coverage = Coverage(null, cards, CoverageTotals(0, 0, 0, 0, 0, 0.0, 0))
            val wl = m.getJSONArray("wishlist").let { a -> (0 until a.length()).map { a.getString(it) } }
            val e = m.getJSONObject("expected")
            val expected = WishPlan(
                e.getJSONArray("candidates").objects().map { WishCandidate(it.getString("card_id"), dbl(it, "max_price")) },
                e.getInt("alreadyListed"), e.getInt("withoutPrice"),
            )
            assertEquals(m.getString("name"), expected, DeckWishlist.missingForWishlist(coverage, wl))
        }
    }

    @Test fun `Fixture Bestaetigung und Rueckmeldung`() {
        for (c in fix.getJSONArray("confirm").objects()) {
            val plan = WishPlan(List(c.getInt("candidates")) { WishCandidate("$it", null) }, c.getInt("alreadyListed"), c.getInt("withoutPrice"))
            assertEquals(c.getString("text"), DeckWishlist.confirmText(plan))
        }
        for (r in fix.getJSONArray("result").objects()) {
            assertEquals(r.getString("text"), DeckWishlist.resultText(r.getInt("total"), r.getInt("added"), r.getInt("watches")))
        }
    }

    @Test fun `Cloud-Suche genau einmal und nur mit Watch`() = runTest {
        var scrapes = 0
        val items = listOf(WishCandidate("1", 10.79), WishCandidate("2", null), WishCandidate("3", 0.42), WishCandidate("4", 5.0))
        val res = DeckWishlist.addAll(items, add = { c ->
            if (c.cardId == "4") throw RuntimeException("kaputt")
            c.maxPrice != null
        }, triggerScrape = { scrapes++ })
        assertEquals(1, scrapes)
        assertEquals(WishResult(4, 3, 2, listOf("4")), res)

        var none = 0
        DeckWishlist.addAll(listOf(WishCandidate("2", null)), add = { false }, triggerScrape = { none++ })
        assertEquals(0, none)
    }
}
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "com.example.yugiohscanner.DeckCoverageTest"`
Expected: FAIL beim Kompilieren mit `Unresolved reference: DeckCoverage` (bzw. `FillBoxProposal`, `DeckWishlist`).

- [ ] **Step 4: `ml/DeckCoverage.kt` anlegen**

```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.printingKey
import java.util.Locale

data class Reserved(val deckId: Long, val name: String, val count: Int)

data class CoverageCard(
    val cardId: String,
    val needed: Int,
    val inBox: Int,
    val available: Int,
    val missing: Int,
    val price: Double?,
    val missingCost: Double?,
    val reservedElsewhere: List<Reserved>,
)

data class CoverageTotals(
    val needed: Int, val owned: Int, val boxed: Int, val missing: Int,
    val missingCards: Int, val cost: Double, val unpriced: Int,
)

data class Coverage(val boxId: String?, val cards: List<CoverageCard>, val totals: CoverageTotals)

/**
 * Spec E1 §4/§5/§8 -- Abgleich eines Decks mit der Sammlung und die Texte dazu.
 * ZWILLING: desktop/src/utils/deckCoverage.js. Beide laufen gegen docs/fixtures/decks/coverage.json.
 * Wer eine Seite aendert, aendert beide.
 *
 * Ein Exemplar zaehlt nur, wenn es lebt UND sein Printing in [cards] steht (der Speicher fuehrt nur lebende
 * Printings; die JS-Fassung liest dafuer `printing_deleted`).
 */
object DeckCoverage {
    const val LOADING = "…"

    private fun round2(v: Double) = Math.round(v * 100.0) / 100.0

    /** Gueltige Deckbox = lebender Behaelter mit kind "deckbox". Geloescht oder umgestellt gilt als "keine Box". */
    fun validDeckboxIds(containers: List<ContainerRow>): Set<String> =
        containers.filter { !it.deleted && it.kind == "deckbox" }.mapTo(HashSet()) { it.containerId }

    /** Spec E1 §3: gueltige Deckboxen, die keinem ANDEREN Deck gehoeren, in der Reihenfolge der Behaelterliste. */
    fun deckBoxChoices(deckId: Long, decks: List<Deck>, containers: List<ContainerRow>): List<ContainerRow> {
        val taken = decks.filter { it.id != deckId }.mapNotNullTo(HashSet()) { it.containerId }
        return containers.filter { !it.deleted && it.kind == "deckbox" && it.containerId !in taken }
    }

    fun deckBoxId(deck: Deck, containers: List<ContainerRow>): String? =
        deck.containerId?.takeIf { it in validDeckboxIds(containers) }

    private class Acc(val cardId: String) {
        var needed = 0
        var inBox = 0
        var live = 0
        val reserved = LinkedHashMap<Long, Reserved>()
    }

    fun compute(
        deckId: Long,
        deckCards: List<DeckCard>,
        copies: List<CopyRow>,
        cards: List<CardRow>,
        decks: List<Deck>,
        containers: List<ContainerRow>,
        prices: Map<String, Double?>,
    ): Coverage {
        val valid = validDeckboxIds(containers)
        fun boxOf(d: Deck): String? = d.containerId?.takeIf { it in valid }
        val boxId = decks.firstOrNull { it.id == deckId }?.let { boxOf(it) }
        val otherBox = HashMap<String, Deck>()
        for (d in decks) {
            val b = boxOf(d)
            if (d.id != deckId && b != null) otherBox[b] = d
        }
        val liveKeys = cards.filter { !it.deleted }.mapTo(HashSet()) { it.printingKey() }

        val byCard = LinkedHashMap<String, Acc>()
        for (dc in deckCards) byCard.getOrPut(dc.cardId) { Acc(dc.cardId) }.needed += dc.count
        for (cp in copies) {
            if (cp.deleted || cp.printingKey() !in liveKeys) continue
            val e = byCard[cp.cardId] ?: continue
            e.live++
            val cid = cp.containerId
            if (boxId != null && cid == boxId) {
                e.inBox++
            } else if (cid != null) {
                val d = otherBox[cid] ?: continue
                val r = e.reserved[d.id] ?: Reserved(d.id, d.name, 0)
                e.reserved[d.id] = r.copy(count = r.count + 1)
            }
        }

        val deckOrder = decks.withIndex().associate { it.value.id to it.index }
        val out = ArrayList<CoverageCard>()
        var needed = 0; var owned = 0; var boxed = 0; var missingSum = 0
        var missingCards = 0; var cost = 0.0; var unpriced = 0
        for (e in byCard.values) {
            // Reihenfolge der Deckliste, damit beide Geraete die Markierungen gleich ordnen.
            val reserved = e.reserved.values.sortedBy { deckOrder[it.deckId] ?: Int.MAX_VALUE }
            val available = e.live - reserved.sumOf { it.count }
            val missing = maxOf(0, e.needed - available)
            val price = prices[e.cardId]?.takeIf { it > 0.0 }
            val missingCost = price?.let { round2(missing * it) }
            out.add(CoverageCard(e.cardId, e.needed, e.inBox, available, missing, price, missingCost, reserved))
            needed += e.needed
            owned += minOf(e.needed, available)
            boxed += minOf(e.needed, e.inBox)
            missingSum += missing
            if (missing > 0) {
                missingCards++
                if (missingCost == null) unpriced++ else cost += missingCost
            }
        }
        return Coverage(boxId, out, CoverageTotals(needed, owned, boxed, missingSum, missingCards, round2(cost), unpriced))
    }

    fun eur(v: Double): String = String.format(Locale.GERMANY, "%,.2f €", v)

    fun costText(t: CoverageTotals): String? = when {
        t.missing == 0 -> null
        t.unpriced == t.missingCards -> "Preis unbekannt"
        t.unpriced > 0 -> "ca. ${eur(t.cost)} + ${t.unpriced} ohne Preis"
        else -> "ca. ${eur(t.cost)}"
    }

    fun headerText(c: Coverage): String {
        val t = c.totals
        val cost = costText(t)?.let { " · $it" } ?: ""
        return "vorhanden ${t.owned}/${t.needed} · in der Box ${t.boxed}/${t.needed} · fehlen ${t.missing}$cost"
    }

    fun listText(c: Coverage): String {
        val t = c.totals
        val cost = costText(t)?.let { " · $it" } ?: ""
        return "${t.owned}/${t.needed} vorhanden$cost"
    }

    fun boxLabel(deck: Deck, containers: List<ContainerRow>): String {
        val id = deckBoxId(deck, containers) ?: return "keine Box"
        return containers.firstOrNull { it.containerId == id }?.name ?: "keine Box"
    }

    fun rowText(card: CoverageCard): String = "Box ${card.inBox} · verfügbar ${card.available} · gebraucht ${card.needed}"

    fun reservedTexts(card: CoverageCard): List<String> = card.reservedElsewhere.map { "${it.count} in Deck ${it.name}" }
}
```

- [ ] **Step 5: `ml/FillBoxProposal.kt` anlegen**

```kotlin
package com.example.yugiohscanner.ml

import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.CopyRow
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.printingKey

data class FillRow(val copy: CopyRow, val card: CardRow, val group: Int)

data class FillProposal(val rows: List<FillRow>, val short: Int, val surplus: Int)

/**
 * Spec E1 §7 -- Vorschlag "Box befüllen" und die Texte des Sheets.
 * ZWILLING: desktop/src/utils/fillBoxProposal.js. Beide laufen gegen docs/fixtures/decks/fill-box.json.
 * Wer eine Seite aendert, aendert beide.
 */
object FillBoxProposal {
    /** 1 unsortiert (auch: Behaelter unbekannt), 2 Box oder keinem Deck zugeordnete Deckbox, 3 Ordner. */
    private fun groupOf(copy: CopyRow, containersById: Map<String, ContainerRow>): Int {
        val c = copy.containerId?.let { containersById[it] } ?: return 1
        return if (c.kind == "binder") 3 else 2
    }

    /** null ohne gueltige Deckbox. */
    fun compute(
        deckId: Long,
        deckCards: List<DeckCard>,
        copies: List<CopyRow>,
        cards: List<CardRow>,
        decks: List<Deck>,
        containers: List<ContainerRow>,
    ): FillProposal? {
        val cov = DeckCoverage.compute(deckId, deckCards, copies, cards, decks, containers, emptyMap())
        val box = cov.boxId ?: return null
        val valid = DeckCoverage.validDeckboxIds(containers)
        val reservedBoxes = decks.filter { it.id != deckId }.mapNotNullTo(HashSet()) { d -> d.containerId?.takeIf { it in valid } }
        val containersById = containers.filter { !it.deleted }.associateBy { it.containerId }
        val cardsByKey = cards.filter { !it.deleted }.associateBy { it.printingKey() }
        val live = copies.filter { !it.deleted && cardsByKey.containsKey(it.printingKey()) }

        val rows = ArrayList<FillRow>()
        for (c in cov.cards) {
            val take = maxOf(0, minOf(c.needed - c.inBox, c.available - c.inBox))
            if (take == 0) continue
            live.asSequence()
                .filter { it.cardId == c.cardId && it.containerId != box && (it.containerId == null || it.containerId !in reservedBoxes) }
                .map { cp ->
                    val card = cardsByKey.getValue(cp.printingKey())
                    Triple(FillRow(cp, card, groupOf(cp, containersById)), Valuation.unitPrice(card, cp) * Valuation.factor(cp.condition), cp.copyId)
                }
                .sortedWith(compareBy<Triple<FillRow, Double, String>>({ it.first.group }, { it.second }, { it.third }))
                .take(take)
                .forEach { rows.add(it.first) }
        }

        val needed = cov.cards.associate { it.cardId to it.needed }
        var surplus = 0
        for ((cardId, n) in live.filter { it.containerId == box }.groupingBy { it.cardId }.eachCount()) {
            surplus += maxOf(0, n - (needed[cardId] ?: 0))
        }
        return FillProposal(rows, cov.totals.missing, surplus)
    }

    fun locationText(copy: CopyRow, container: ContainerRow?): String {
        if (copy.containerId == null || container == null) return "unsortiert"
        if (container.kind == "binder" && copy.page != null && copy.slot != null) return "${container.name} · S. ${copy.page} · Fach ${copy.slot}"
        return container.name
    }

    fun shortText(n: Int): String? = when (n) {
        0 -> null
        1 -> "1 fehlt noch – nicht in der Sammlung"
        else -> "$n fehlen noch – nicht in der Sammlung"
    }

    fun surplusText(n: Int): String? = if (n == 0) null else "$n überzählig in der Box"
}
```

- [ ] **Step 6: `ml/DeckWishlist.kt` anlegen**

```kotlin
package com.example.yugiohscanner.ml

data class WishCandidate(val cardId: String, val maxPrice: Double?)

data class WishPlan(val candidates: List<WishCandidate>, val alreadyListed: Int, val withoutPrice: Int)

/** added = angelegte Eintraege, watches = angelegte Deal-Watches, failed = Passcodes ohne Eintrag. */
data class WishResult(val total: Int, val added: Int, val watches: Int, val failed: List<String>)

/**
 * Spec E1 §6 -- "Fehlende auf die Wunschliste": Auswahl, Hoechstpreis und Texte.
 * ZWILLING: desktop/src/utils/deckWishlist.js (Regeln/Texte) und desktop/electron/decks.cjs#addMissingToWishlist
 * (eine Cloud-Suche am Ende). Fixture docs/fixtures/decks/wishlist.json. Wer eine Seite aendert, aendert beide.
 */
object DeckWishlist {
    /** max_price = 1,2 x Katalogpreis, auf Cent gerundet; ohne Preis null (dann kein Deal-Watch). */
    fun wishlistMaxPrice(cmPrice: Double?): Double? =
        if (cmPrice == null || !(cmPrice > 0.0)) null else Math.round(cmPrice * 1.2 * 100.0) / 100.0

    fun missingForWishlist(coverage: Coverage, wishlistCardIds: Collection<String>): WishPlan {
        val listed = wishlistCardIds.toHashSet()
        val candidates = ArrayList<WishCandidate>()
        var alreadyListed = 0
        var withoutPrice = 0
        for (c in coverage.cards) {
            if (c.missing <= 0) continue
            if (c.cardId in listed) { alreadyListed++; continue }
            val mp = wishlistMaxPrice(c.price)
            if (mp == null) withoutPrice++
            candidates.add(WishCandidate(c.cardId, mp))
        }
        return WishPlan(candidates, alreadyListed, withoutPrice)
    }

    private fun karten(n: Int) = if (n == 1) "Karte" else "Karten"

    fun confirmText(plan: WishPlan): String {
        val n = plan.candidates.size
        if (n == 0) return "Alle fehlenden Karten stehen schon auf der Wunschliste."
        val parts = ArrayList<String>()
        if (plan.alreadyListed > 0) parts.add("${plan.alreadyListed} ${if (plan.alreadyListed == 1) "steht" else "stehen"} schon drauf")
        if (plan.withoutPrice > 0) {
            parts.add(
                if (plan.withoutPrice == 1) "1 hat keinen Preis und bekommt keine Deal-Suche"
                else "${plan.withoutPrice} haben keinen Preis und bekommen keine Deal-Suche"
            )
        }
        val tail = if (parts.isEmpty()) "" else " ${parts.joinToString(", ")}."
        return "$n fehlende ${karten(n)} auf die Wunschliste setzen?$tail"
    }

    fun resultText(total: Int, added: Int, watches: Int): String {
        val failed = total - added
        if (failed > 0) return "$added von $total hinzugefügt, $failed fehlgeschlagen"
        return "$added ${karten(added)} auf der Wunschliste${if (watches > 0) ", Deal-Suche läuft." else "."}"
    }

    /**
     * Legt Eintrag fuer Eintrag an. [add] liefert true, wenn zusaetzlich ein Deal-Watch entstand, und wirft, wenn der
     * Eintrag scheitert. Die Cloud-Suche [triggerScrape] laeuft hoechstens EINMAL am Ende, nur wenn ein Watch entstand.
     */
    suspend fun addAll(
        candidates: List<WishCandidate>,
        add: suspend (WishCandidate) -> Boolean,
        triggerScrape: suspend () -> Unit,
    ): WishResult {
        var added = 0
        var watches = 0
        val failed = ArrayList<String>()
        for (c in candidates) {
            val watch = try { add(c) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { failed.add(c.cardId); continue }
            added++
            if (watch) watches++
        }
        if (watches > 0) triggerScrape()
        return WishResult(candidates.size, added, watches, failed)
    }
}
```

- [ ] **Step 7: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL; `DeckCoverageTest` (3), `FillBoxProposalTest` (3), `DeckWishlistTest` (4) grün, alle übrigen unverändert grün.

- [ ] **Step 8: Schutz-Nachweis**

(a) In `DeckCoverage.compute` die Zeile `val d = otherBox[cid] ?: continue` kurz zu `val d = (if (false) otherBox[cid] else null) ?: continue` machen → `alle Fixture-Faelle` scheitert mit `Labrynth: … 14558127 available expected:<3> but was:<4>` (gemessen). Zitieren, zurücknehmen.
(b) In `FillBoxProposal.compute` den Selektor `{ it.first.group }, ` aus `compareBy` entfernen → `alle Fixture-Faelle` scheitert an „Labrynth: Gruppen, …" (`rows`). Zitieren, zurücknehmen.
(c) In `DeckWishlist.addAll` `if (watches > 0) triggerScrape()` durch `repeat(watches) { triggerScrape() }` ersetzen → `Cloud-Suche genau einmal und nur mit Watch` scheitert mit `expected:<1> but was:<2>`. Zitieren, zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt android/app/src/main/java/com/example/yugiohscanner/ml/DeckCoverage.kt android/app/src/main/java/com/example/yugiohscanner/ml/FillBoxProposal.kt android/app/src/main/java/com/example/yugiohscanner/ml/DeckWishlist.kt android/app/src/test/java/com/example/yugiohscanner/DeckFixtureWorld.kt android/app/src/test/java/com/example/yugiohscanner/DeckCoverageTest.kt android/app/src/test/java/com/example/yugiohscanner/FillBoxProposalTest.kt android/app/src/test/java/com/example/yugiohscanner/DeckWishlistTest.kt
git commit -m "feat(e1): Kotlin-Zwillinge für Deck-Abgleich, Box befüllen und Wunschliste

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: Handy — Cloud-Zugriffe und Oberfläche der Decks

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/WishlistRepository.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/ui/SammlungScreen.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/DecksRepositoryTest.kt`

**Interfaces:**
- Produces: `DecksRepository.DECKBOX_TAKEN`, `containerErrorMessage(code: Int, body: String): String` (internal), `parseDeck(o)`/`parseCard(o)` (internal), `suspend loadAllCards(): List<DeckCard>`, `suspend setContainer(deckId: Long, containerId: String?)`; `WishlistRepository.addToWishlist(cardId, name, imageUrl, maxPrice, triggerScrape: Boolean = true): Boolean`, `suspend addMissing(candidates, nameOf, imageOf): WishResult`; `SideStores.allDeckCards: ListCache<List<DeckCard>>`.
- Consumes (Task 5): `CatalogRepository.cmPrices`. Consumes (Task 6): alle Zwillinge und Datenklassen. Consumes (vorhanden): `CollectionStore.state/awaitSync`, `StoreState.Ready`, `CollectionRepository.setCopyLocation`, `DealsRepository.addWatch/triggerScrape`, `SideStores.wishlist/dealWatches/decks/deckCards`.

- [ ] **Step 1: Test schreiben**

`DecksRepositoryTest.kt`:
```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.DecksRepository
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** Spec E1 §3/§9 -- Deck liest container_id, Deckkarte liest deck_id, Unique-Verletzung wird zur deutschen Meldung. */
class DecksRepositoryTest {
    @Test fun `Deck liest container_id, null und fehlend werden null`() {
        assertEquals(Deck(1, "Labrynth", "box-rot"), DecksRepository.parseDeck(JSONObject("""{"id":1,"name":"Labrynth","container_id":"box-rot"}""")))
        assertEquals(Deck(2, "Tenpai", null), DecksRepository.parseDeck(JSONObject("""{"id":2,"name":"Tenpai","container_id":null}""")))
        assertEquals(Deck(3, "Alt", null), DecksRepository.parseDeck(JSONObject("""{"id":3,"name":"Alt"}""")))
    }

    @Test fun `Deckkarte liest deck_id`() {
        assertEquals(
            DeckCard(7, "14558127", "Aschblüte", null, 3, "main", deckId = 1),
            DecksRepository.parseCard(JSONObject("""{"id":7,"deck_id":1,"card_id":"14558127","name":"Aschblüte","image_url":null,"count":3,"section":"main"}""")),
        )
    }

    @Test fun `Unique-Verletzung wird zur deutschen Meldung`() {
        val body = """{"code":"23505","details":"Key (container_id)=(box-rot) already exists.","hint":null,"message":"duplicate key value violates unique constraint \"decks_container_unique\""}"""
        assertEquals("Diese Deckbox gehört schon zu einem anderen Deck", DecksRepository.containerErrorMessage(409, body))
        assertEquals("Deckbox zuordnen fehlgeschlagen (403): nein", DecksRepository.containerErrorMessage(403, "nein"))
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest --tests "com.example.yugiohscanner.DecksRepositoryTest"`
Expected: FAIL beim Kompilieren (`Cannot access 'parseDeck': it is private`, `Unresolved reference: containerErrorMessage`).

- [ ] **Step 3: `DecksRepository.kt`**

(a) In `loadDecks` `.addQueryParameter("select", "id,name")` ersetzen durch `.addQueryParameter("select", "*")` und darüber kommentieren: `// Spec E1: select=* liefert container_id mit, sobald decks_container.sql eingespielt ist.`

(b) Nach `loadCards` einfügen:
```kotlin
    /** Spec E1 §4: alle Deckkarten aller Decks in einer Abfrage (Deck-Liste mit Zahlen, "in Deck X"). */
    suspend fun loadAllCards(): List<DeckCard> = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/deck_cards".toHttpUrl().newBuilder()
            .addQueryParameter("select", "id,deck_id,card_id,name,image_url,count,section")
            .addQueryParameter("order", "id.asc")
            .build()
        getArray(url).let { arr -> (0 until arr.length()).map { parseCard(arr.getJSONObject(it)) } }
    }

    const val DECKBOX_TAKEN = "Diese Deckbox gehört schon zu einem anderen Deck"

    /** Spec E1 §9: PostgREST meldet die Unique-Verletzung (decks_container_unique) als 409 mit code 23505. */
    internal fun containerErrorMessage(code: Int, body: String): String =
        if (body.contains("\"23505\"")) DECKBOX_TAKEN else "Deckbox zuordnen fehlgeschlagen ($code): $body"

    /** Spec E1 §3: Deckbox zuordnen (null = keine Box). Lehnt die Cloud ab, bleibt die Zeile unveraendert. */
    suspend fun setContainer(deckId: Long, containerId: String?) = withContext(Dispatchers.IO) {
        val url = "${SupabaseCloud.base()}/rest/v1/decks".toHttpUrl().newBuilder()
            .addQueryParameter("id", "eq.$deckId").build()
        val body = JSONObject().put("container_id", containerId ?: JSONObject.NULL).toString()
        executeWithReauth {
            base(url).addHeader("Content-Type", "application/json")
                .patch(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r -> if (!r.isSuccessful) throw RuntimeException(containerErrorMessage(r.code, r.body?.string() ?: "")) }
    }
```

(c) Die beiden Parser am Dateiende ersetzen:
```kotlin
    // internal statt private: DecksRepositoryTest prueft container_id und deck_id (Spec E1).
    internal fun parseDeck(o: JSONObject) = Deck(
        id = o.optLong("id"), name = o.optString("name"),
        containerId = if (o.isNull("container_id")) null else o.optString("container_id"),
    )

    internal fun parseCard(o: JSONObject) = DeckCard(
        id = o.optLong("id"), cardId = o.optString("card_id"),
        name = if (o.isNull("name")) null else o.optString("name"),
        imageUrl = if (o.isNull("image_url")) null else o.optString("image_url"),
        count = o.optInt("count", 1), section = o.optString("section", "main"),
        deckId = o.optLong("deck_id"),
    )
```

- [ ] **Step 4: `WishlistRepository.kt`**

Importe ergänzen: `import com.example.yugiohscanner.ml.DeckWishlist`, `import com.example.yugiohscanner.ml.WishCandidate`, `import com.example.yugiohscanner.ml.WishResult`.
`addToWishlist` ersetzen:
```kotlin
    // Spec E1 §6: triggerScrape = false beim Massen-Hinzufuegen (die Cloud-Suche laeuft dort einmal am Ende).
    // Rueckgabe: true, wenn zusaetzlich ein Deal-Watch entstand.
    suspend fun addToWishlist(cardId: String, name: String, imageUrl: String?, maxPrice: Double?, triggerScrape: Boolean = true): Boolean =
        withContext(Dispatchers.IO) {
            val body = JSONObject()
                .put("card_id", cardId).put("name", name)
                .put("image_url", imageUrl ?: JSONObject.NULL)
                .put("max_price", maxPrice ?: JSONObject.NULL)
                .toString()
            executeWithReauth {
                base("${SupabaseCloud.base()}/rest/v1/wishlist".toHttpUrl())
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", "return=minimal")
                    .post(body.toRequestBody(SupabaseCloud.jsonMedia)).build()
            }.use { r -> if (!r.isSuccessful) err("Wunschkarte anlegen", r) }

            // Also hunt for it as a deal-watch (best-effort — must not fail the wishlist add).
            if (maxPrice == null) return@withContext false
            try {
                DealsRepository.addWatch(name, maxPrice)
                if (triggerScrape) DealsRepository.triggerScrape()
                true
            } catch (_: Exception) { false /* non-fatal */ }
        }

    /** Spec E1 §6: "Fehlende auf die Wunschliste" -- Eintrag fuer Eintrag, die Cloud-Suche hoechstens einmal (DeckWishlist.addAll). */
    suspend fun addMissing(candidates: List<WishCandidate>, nameOf: (String) -> String, imageOf: (String) -> String?): WishResult =
        DeckWishlist.addAll(
            candidates,
            add = { c -> addToWishlist(c.cardId, nameOf(c.cardId), imageOf(c.cardId), c.maxPrice, triggerScrape = false) },
            triggerScrape = { DealsRepository.triggerScrape() },
        )
```
Per Grep (lesend) prüfen, dass kein bestehender Aufrufer von `addToWishlist` das bisherige `Unit`-Ergebnis verwendet (`Grep "addToWishlist\(" android/app/src/main`).

- [ ] **Step 5: `SideStores.kt`**

Nach `    val decks = ListCache(scope) { DecksRepository.loadDecks() }` einfügen:
```kotlin
    // Spec E1 §8: alle Deckkarten fuer die Zahlen der Deck-Liste. Klein, voll neu laden wie decks.
    val allDeckCards = ListCache(scope) { DecksRepository.loadAllCards() }
```
In `clearAll` `wishlist.clear(); decks.clear();` ersetzen durch `wishlist.clear(); decks.clear(); allDeckCards.clear();`.

- [ ] **Step 6: `DecksScreen.kt` ersetzen**

```kotlin
package com.example.yugiohscanner.ui

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.yugiohscanner.cloud.CardRow
import com.example.yugiohscanner.cloud.CardSearchRepository
import com.example.yugiohscanner.cloud.CatalogRepository
import com.example.yugiohscanner.cloud.CollectionRepository
import com.example.yugiohscanner.cloud.CollectionStore
import com.example.yugiohscanner.cloud.ContainerRow
import com.example.yugiohscanner.cloud.Deck
import com.example.yugiohscanner.cloud.DeckCard
import com.example.yugiohscanner.cloud.DecksRepository
import com.example.yugiohscanner.cloud.SideStores
import com.example.yugiohscanner.cloud.StoreState
import com.example.yugiohscanner.cloud.Valuation
import com.example.yugiohscanner.cloud.WishlistRepository
import com.example.yugiohscanner.ml.Coverage
import com.example.yugiohscanner.ml.CoverageCard
import com.example.yugiohscanner.ml.DeckCoverage
import com.example.yugiohscanner.ml.DeckWishlist
import com.example.yugiohscanner.ml.FillBoxProposal
import com.example.yugiohscanner.ml.FillProposal
import com.example.yugiohscanner.ml.WishPlan
import com.example.yugiohscanner.ml.WishResult
import com.example.yugiohscanner.ui.components.SectionHeader
import com.example.yugiohscanner.ui.components.SpaceCard
import com.example.yugiohscanner.ui.theme.Background
import com.example.yugiohscanner.ui.theme.ErrorColor
import com.example.yugiohscanner.ui.theme.Gold
import com.example.yugiohscanner.ui.theme.Good
import com.example.yugiohscanner.ui.theme.MonoFontFamily
import com.example.yugiohscanner.ui.theme.Muted
import com.example.yugiohscanner.ui.theme.OnSurface
import com.example.yugiohscanner.ui.theme.Primary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Spec E1 §5: Katalogpreise der Passcodes, abseits des Hauptthreads gelesen. null = noch nicht gelesen -- die Zahlen
 * zeigen dann "…" statt kurz "Preis unbekannt". Ohne Katalog (oder vor Version 6) ist jeder Preis null.
 */
@Composable
private fun rememberCatalogPrices(ids: Set<String>?): Map<String, Double?>? {
    val prices by produceState<Map<String, Double?>?>(initialValue = null, ids) {
        if (ids != null) value = withContext(Dispatchers.IO) { runCatching { CatalogRepository.cmPrices(ids) }.getOrDefault(emptyMap()) }
    }
    return prices
}

@Composable
fun DecksScreen(onClose: (() -> Unit)? = null) {
    var openDeckId by remember { mutableStateOf<Long?>(null) }
    val cache by SideStores.decks.state.collectAsState()
    val decks = cache.value ?: emptyList()

    // The editor is a sub-view of this destination — system back closes it, not the destination.
    BackHandler(openDeckId != null) { openDeckId = null }
    openDeckId?.let { id ->
        // Spec E1: der Editor liest das Deck aus dem Speicher, damit eine neu zugeordnete Deckbox sofort erscheint.
        val deck = decks.firstOrNull { it.id == id }
        if (deck != null) {
            DeckEditor(deck, decks, onBack = { openDeckId = null })
            return
        }
    }

    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var writeError by remember { mutableStateOf<String?>(null) }
    val loading = busy || (cache.value == null && cache.error == null)
    val error = writeError ?: cache.error

    // Spec E1 §8: Zahlen der Deck-Liste. Alles null, bis Decks, alle Deckkarten, Sammlung und Preise da sind -> "…".
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val allCardsCache by SideStores.allDeckCards.state.collectAsState()
    val allCards = allCardsCache.value
    val priceIds = remember(allCards) { allCards?.mapTo(HashSet()) { it.cardId } }
    val prices = rememberCatalogPrices(priceIds)
    val coverages: Map<Long, Coverage>? = remember(cache.value, allCards, ready, prices) {
        val r = ready
        if (cache.value == null || allCards == null || r == null || prices == null) null
        else {
            val byDeck = allCards.groupBy { it.deckId }
            decks.associate { d -> d.id to DeckCoverage.compute(d.id, byDeck[d.id] ?: emptyList(), r.copies, r.cards, decks, r.containers, prices) }
        }
    }

    LaunchedEffect(Unit) { SideStores.decks.refresh(); SideStores.allDeckCards.refresh() }

    val create = {
        val n = name.trim()
        if (n.isNotBlank()) {
            name = ""
            scope.launch {
                busy = true
                try { DecksRepository.createDeck(n); SideStores.decks.refreshAndWait(); writeError = null }
                catch (e: Exception) { writeError = e.message }
                busy = false
            }
        }
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            if (onClose != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onClose) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface)
                    }
                    Spacer(Modifier.width(4.dp))
                    Text("Decks", style = MaterialTheme.typography.headlineSmall, color = OnSurface)
                }
                Spacer(Modifier.height(12.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = name, onValueChange = { name = it },
                    placeholder = { Text("Deckname") }, singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(onClick = create) { Icon(Icons.Default.Add, "Anlegen") }
            }

            error?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall)
            }

            Spacer(Modifier.height(12.dp))
            if (loading) {
                // Spec §8: scrollbarer Nachfahre statt eines nackten Box -- sonst greift
                // Nach-unten-ziehen (verschachteltes Scrollen) hier nie.
                LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = Primary)
                        }
                    }
                }
            } else if (decks.isEmpty()) {
                LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            Text("Noch keine Decks.", color = Muted)
                        }
                    }
                }
            } else {
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(decks, key = { it.id }) { deck ->
                        val summary = coverages?.get(deck.id)?.let { cov ->
                            "${DeckCoverage.boxLabel(deck, ready?.containers ?: emptyList())} · ${DeckCoverage.listText(cov)}"
                        } ?: DeckCoverage.LOADING
                        DeckRow(
                            deck, summary,
                            onOpen = { openDeckId = deck.id },
                            onDelete = {
                                scope.launch {
                                    try { DecksRepository.deleteDeck(deck.id); SideStores.decks.refreshAndWait(); SideStores.allDeckCards.refresh() }
                                    catch (e: Exception) { writeError = e.message }
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DeckRow(deck: Deck, summary: String, onOpen: () -> Unit, onDelete: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    deck.name, color = OnSurface, fontWeight = FontWeight.SemiBold,
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(summary, color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall, maxLines = 1)
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, "Löschen", tint = ErrorColor)
            }
        }
    }
}

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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeckEditor(deck: Deck, decks: List<Deck>, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val deckCache = remember(deck.id) { SideStores.deckCards(deck.id) }
    val cache by deckCache.state.collectAsState()
    val cards = cache.value ?: emptyList()
    var writeError by remember { mutableStateOf<String?>(null) }
    val loading = cache.value == null && cache.error == null
    val error = writeError ?: cache.error

    var query by remember { mutableStateOf("") }
    val results = remember { mutableStateListOf<CardRow>() }
    var searching by remember { mutableStateOf(false) }

    // Spec E1 §4/§8: Abgleich dieses Decks. null, solange Deckkarten, Sammlung oder Preise fehlen -> "…".
    val store by CollectionStore.state.collectAsState()
    val ready = store as? StoreState.Ready
    val priceIds = remember(cache.value) { cache.value?.mapTo(HashSet()) { it.cardId } }
    val prices = rememberCatalogPrices(priceIds)
    val coverage: Coverage? = remember(deck, decks, cache.value, ready, prices) {
        val r = ready
        val dc = cache.value
        if (dc == null || r == null || prices == null) null
        else DeckCoverage.compute(deck.id, dc, r.copies, r.cards, decks, r.containers, prices)
    }
    val numbers = remember(coverage) { coverage?.cards?.associateBy { it.cardId } }
    var boxError by remember { mutableStateOf<String?>(null) }
    var fill by remember { mutableStateOf<FillProposal?>(null) }
    var wishlistOpen by remember { mutableStateOf(false) }

    LaunchedEffect(deck.id) { deckCache.refresh() }

    fun mutate(block: suspend () -> Unit) {
        scope.launch {
            try { block(); deckCache.refreshAndWait(); SideStores.allDeckCards.refresh(); writeError = null } catch (e: Exception) { writeError = e.message }
        }
    }

    val search = {
        val q = query.trim()
        if (q.isNotBlank()) {
            scope.launch {
                searching = true
                try {
                    val found = CardSearchRepository.search(q)
                    results.clear(); results.addAll(found.take(8))
                    writeError = null
                } catch (e: Exception) { writeError = e.message }
                searching = false
            }
        }
    }

    Surface(Modifier.fillMaxSize(), color = Background) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück", tint = OnSurface)
                }
                Spacer(Modifier.width(4.dp))
                Text(
                    deck.name, style = MaterialTheme.typography.headlineSmall,
                    color = OnSurface, modifier = Modifier.weight(1f),
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

            DeckCoverageHead(
                deck = deck, decks = decks, containers = ready?.containers, coverage = coverage, boxError = boxError,
                onPickBox = { containerId ->
                    scope.launch {
                        try { DecksRepository.setContainer(deck.id, containerId); SideStores.decks.refreshAndWait(); boxError = null }
                        catch (e: Exception) { boxError = e.message }
                    }
                },
                onWishlist = { wishlistOpen = true },
                onFillBox = {
                    val r = ready
                    val dc = cache.value
                    if (r != null && dc != null) fill = FillBoxProposal.compute(deck.id, dc, r.copies, r.cards, decks, r.containers)
                },
            )

            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = query, onValueChange = { query = it },
                    placeholder = { Text("Karte suchen (Name/Passcode)") }, singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                FilledIconButton(onClick = search) { Icon(Icons.Default.Search, "Suchen") }
            }

            error?.let {
                Spacer(Modifier.height(6.dp))
                Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall)
            }

            if (searching) {
                Spacer(Modifier.height(8.dp))
                CircularProgressIndicator(color = Primary, modifier = Modifier.size(20.dp))
            } else if (results.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    results.forEach { r ->
                        SearchResultRow(r, onAdd = {
                            mutate {
                                DecksRepository.addCard(
                                    deck.id, cardId = r.id, name = r.name,
                                    imageUrl = r.imageUrl, section = extraOrMain(r.type),
                                )
                            }
                        })
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            if (loading) {
                // Spec §8: scrollbarer Nachfahre statt eines nackten Box -- sonst greift
                // Nach-unten-ziehen (verschachteltes Scrollen) hier nie.
                LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = Primary)
                        }
                    }
                }
            } else {
                val main = cards.filter { it.section == "main" }
                val extra = cards.filter { it.section == "extra" }
                LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item {
                        SectionHeader("Main · ${main.sumOf { it.count }}")
                        Spacer(Modifier.height(6.dp))
                    }
                    items(main, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId)) { block -> mutate(block) } }
                    item {
                        Spacer(Modifier.height(10.dp))
                        SectionHeader("Extra · ${extra.sumOf { it.count }}")
                        Spacer(Modifier.height(6.dp))
                    }
                    items(extra, key = { it.id }) { DeckCardRow(it, numbers?.get(it.cardId)) { block -> mutate(block) } }
                }
            }
        }
    }

    fill?.let { proposal ->
        val r = ready
        if (r != null) {
            FillBoxSheet(
                proposal = proposal, boxId = DeckCoverage.deckBoxId(deck, r.containers), containers = r.containers,
                onDismiss = { fill = null },
                onOpenWishlist = { fill = null; wishlistOpen = true },
            )
        }
    }

    if (wishlistOpen && coverage != null) {
        DeckWishlistDialog(
            coverage = coverage,
            nameOf = { id -> cards.firstOrNull { it.cardId == id }?.name ?: id },
            imageOf = { id -> cards.firstOrNull { it.cardId == id }?.imageUrl },
            onDismiss = { wishlistOpen = false },
        )
    }
}

/** Spec E1 §8: Editor-Kopf mit Deckbox-Auswahl, Kennzahlen und den beiden Knoepfen (Gegenstueck zu DeckCoverageHeader.jsx). */
@Composable
private fun DeckCoverageHead(
    deck: Deck,
    decks: List<Deck>,
    containers: List<ContainerRow>?,
    coverage: Coverage?,
    boxError: String?,
    onPickBox: (String?) -> Unit,
    onWishlist: () -> Unit,
    onFillBox: () -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        when {
            containers == null -> Text(DeckCoverage.LOADING, color = Muted, style = MaterialTheme.typography.bodyMedium)
            containers.none { it.kind == "deckbox" } -> Text("Noch keine Deckbox", color = Muted, style = MaterialTheme.typography.bodyMedium)
            else -> Box {
                Row(Modifier.clickable { expanded = true }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Deckbox: ${DeckCoverage.deckBoxId(deck, containers)?.let { id -> containers.firstOrNull { it.containerId == id }?.name } ?: "Keine Box"}",
                        color = OnSurface, style = MaterialTheme.typography.bodyMedium)
                    Icon(Icons.Default.ArrowDropDown, "Deckbox wählen", tint = Muted)
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    DropdownMenuItem(text = { Text("Keine Box") }, onClick = { expanded = false; onPickBox(null) })
                    DeckCoverage.deckBoxChoices(deck.id, decks, containers).forEach { c ->
                        DropdownMenuItem(text = { Text(c.name) }, onClick = { expanded = false; onPickBox(c.containerId) })
                    }
                }
            }
        }
        Text(coverage?.let { DeckCoverage.headerText(it) } ?: DeckCoverage.LOADING,
            color = OnSurface, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onWishlist, enabled = coverage != null && coverage.totals.missing > 0) { Text("Fehlende auf die Wunschliste") }
            OutlinedButton(onClick = onFillBox, enabled = coverage?.boxId != null) { Text("Box befüllen") }
        }
        boxError?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
    }
}

/** Spec E1 §7: Sheet "Box befüllen". Vorschlag beim Oeffnen eingefroren; verschoben wird Exemplar fuer Exemplar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FillBoxSheet(
    proposal: FillProposal,
    boxId: String?,
    containers: List<ContainerRow>,
    onDismiss: () -> Unit,
    onOpenWishlist: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val containersById = remember(containers) { containers.associateBy { it.containerId } }
    val checked = remember(proposal) { mutableStateMapOf<String, Boolean>().apply { proposal.rows.forEach { put(it.copy.copyId, true) } } }
    // copyId -> null = verschoben, Text = Fehlermeldung; leer = noch nichts versucht.
    val results = remember(proposal) { mutableStateMapOf<String, String?>() }
    var busy by remember { mutableStateOf(false) }
    var done by remember(proposal) { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = { if (!busy) onDismiss() }) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Box befüllen", style = MaterialTheme.typography.titleMedium, color = OnSurface, fontWeight = FontWeight.Bold)
            if (proposal.rows.isEmpty()) Text("Nichts zu verschieben.", color = Muted, style = MaterialTheme.typography.bodySmall)
            proposal.rows.forEach { row ->
                val id = row.copy.copyId
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = checked[id] == true, enabled = !busy && !done, onCheckedChange = { checked[id] = it })
                    Column(Modifier.weight(1f)) {
                        Text(row.card.name ?: row.copy.cardId, color = OnSurface, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                        Text(
                            "${row.copy.setCode} · ${row.copy.rarity} · ${Valuation.EDITION_LABELS[row.copy.edition] ?: row.copy.edition}",
                            color = Muted, fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall,
                        )
                        Text(FillBoxProposal.locationText(row.copy, row.copy.containerId?.let { containersById[it] }),
                            color = Muted, style = MaterialTheme.typography.labelSmall)
                        if (results.containsKey(id)) {
                            val err = results[id]
                            Text(err ?: "Verschoben", color = if (err == null) Good else ErrorColor, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
            FillBoxProposal.shortText(proposal.short)?.let {
                Text(it, color = Gold, style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = onOpenWishlist, enabled = !busy) { Text("Fehlende auf die Wunschliste") }
            }
            FillBoxProposal.surplusText(proposal.surplus)?.let { Text(it, color = Muted, style = MaterialTheme.typography.bodySmall) }
            if (!done) {
                Button(
                    onClick = {
                        val box = boxId ?: return@Button
                        busy = true
                        scope.launch {
                            for (row in proposal.rows) {
                                if (checked[row.copy.copyId] != true) continue
                                results[row.copy.copyId] = try {
                                    CollectionRepository.setCopyLocation(row.copy.copyId, box, null, null); null
                                } catch (e: Exception) { e.message ?: "Verschieben fehlgeschlagen" }
                            }
                            CollectionStore.awaitSync()
                            busy = false
                            done = true
                        }
                    },
                    enabled = !busy && boxId != null && checked.values.any { it },
                ) { Text(if (busy) "Wird verschoben…" else "In die Box verschieben") }
            } else {
                TextButton(onClick = onDismiss) { Text("Schließen") }
            }
        }
    }
}

/** Spec E1 §6: Bestaetigung und Rueckmeldung. Die Wunschliste wird beim Oeffnen frisch geladen. */
@Composable
private fun DeckWishlistDialog(coverage: Coverage, nameOf: (String) -> String, imageOf: (String) -> String?, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var plan by remember { mutableStateOf<WishPlan?>(null) }
    var result by remember { mutableStateOf<WishResult?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        SideStores.wishlist.refreshAndWait()
        val s = SideStores.wishlist.state.value
        val list = s.value
        if (list == null) error = s.error ?: "Wunschliste nicht geladen"
        else plan = DeckWishlist.missingForWishlist(coverage, list.map { it.cardId })
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Fehlende auf die Wunschliste") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val r = result
                val p = plan
                Text(
                    when {
                        r != null -> DeckWishlist.resultText(r.total, r.added, r.watches)
                        p != null -> DeckWishlist.confirmText(p)
                        else -> DeckCoverage.LOADING
                    },
                )
                error?.let { Text(it, color = ErrorColor, style = MaterialTheme.typography.labelSmall) }
            }
        },
        confirmButton = {
            if (result != null) {
                TextButton(onClick = onDismiss) { Text("Schließen") }
            } else {
                val p = plan
                TextButton(
                    enabled = !busy && p != null && p.candidates.isNotEmpty(),
                    onClick = {
                        if (p == null) return@TextButton
                        busy = true
                        scope.launch {
                            try {
                                result = WishlistRepository.addMissing(p.candidates, nameOf, imageOf)
                                SideStores.wishlist.refresh()
                                SideStores.dealWatches.refresh()
                            } catch (e: Exception) { error = e.message }
                            busy = false
                        }
                    },
                ) { Text(if (busy) "Wird hinzugefügt…" else "Hinzufügen") }
            }
        },
        dismissButton = {
            if (result == null) TextButton(onClick = onDismiss, enabled = !busy) { Text("Abbrechen") }
        },
    )
}

@Composable
private fun SearchResultRow(r: CardRow, onAdd: () -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumb(r.imageUrl, r.name)
            Spacer(Modifier.width(10.dp))
            Text(
                r.name ?: r.id, color = OnSurface, maxLines = 2,
                style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onAdd) { Icon(Icons.Default.Add, "Hinzufügen", tint = Primary) }
        }
    }
}

@Composable
private fun DeckCardRow(card: DeckCard, numbers: CoverageCard?, mutate: ((suspend () -> Unit)) -> Unit) {
    SpaceCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumb(card.imageUrl, card.name)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    card.name ?: card.cardId, color = OnSurface, maxLines = 2,
                    style = MaterialTheme.typography.bodyMedium,
                )
                // Spec E1 §8: "Box 1 · verfügbar 2 · gebraucht 3" (rot bei Fehlenden) und gelb "1 in Deck Tenpai".
                Text(
                    numbers?.let { DeckCoverage.rowText(it) } ?: DeckCoverage.LOADING,
                    color = if (numbers != null && numbers.missing > 0) ErrorColor else Muted,
                    fontFamily = MonoFontFamily, style = MaterialTheme.typography.labelSmall,
                )
                numbers?.let { DeckCoverage.reservedTexts(it) }?.forEach {
                    Text(it, color = Gold, style = MaterialTheme.typography.labelSmall)
                }
            }
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = { mutate { DecksRepository.setCount(card.id, card.count - 1) } }) {
                Text("−", color = OnSurface, style = MaterialTheme.typography.titleLarge.copy(fontFamily = MonoFontFamily))
            }
            Text(
                card.count.toString(), color = OnSurface,
                style = MaterialTheme.typography.titleMedium.copy(fontFamily = MonoFontFamily),
            )
            IconButton(onClick = { mutate { DecksRepository.setCount(card.id, card.count + 1) } }) {
                Text("+", color = OnSurface, style = MaterialTheme.typography.titleLarge.copy(fontFamily = MonoFontFamily))
            }
            IconButton(onClick = { mutate { DecksRepository.removeCard(card.id) } }) {
                Icon(Icons.Default.Delete, "Entfernen", tint = ErrorColor)
            }
        }
    }
}

@Composable
private fun Thumb(imageUrl: String?, contentDescription: String?) {
    Box(
        Modifier.size(40.dp).clip(RoundedCornerShape(6.dp)).background(Background),
        contentAlignment = Alignment.Center,
    ) {
        if (!imageUrl.isNullOrBlank()) {
            AsyncImage(
                model = imageUrl, contentDescription = contentDescription,
                contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize(),
            )
        } else {
            Icon(Icons.Default.Image, null, tint = Muted, modifier = Modifier.size(18.dp))
        }
    }
}
```

- [ ] **Step 7: `SammlungScreen.kt`**

Die Zeile `                    "decks" -> SideStores.decks.refreshAndWait()` ersetzen durch:
```kotlin
                    "decks" -> { SideStores.decks.refreshAndWait(); SideStores.allDeckCards.refreshAndWait(); CollectionStore.awaitSync() }
```
(`CollectionStore` ist in der Datei bereits importiert; sonst `import com.example.yugiohscanner.cloud.CollectionStore` ergänzen.)

- [ ] **Step 8: Tests und Build**

Run: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`
Expected: BUILD SUCCESSFUL, alle Tests grün, darunter `DecksRepositoryTest` (3).
Per Grep (lesend): `Grep "DeckCoverage.compute|FillBoxProposal.compute" android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt` zeigt `DeckCoverage.compute` nur innerhalb von `remember(...)`-Blöcken und `FillBoxProposal.compute` nur im `onFillBox`-Klick.

- [ ] **Step 9: Schutz-Nachweis**

In `DecksRepository.containerErrorMessage` kurz `if (body.contains("\"23505\"")) DECKBOX_TAKEN else ` entfernen → `Unique-Verletzung wird zur deutschen Meldung` scheitert (`expected:<Diese Deckbox gehört schon …> but was:<Deckbox zuordnen fehlgeschlagen (409): …>`). Zitieren, zurücknehmen.

- [ ] **Step 10: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/DecksRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/WishlistRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt android/app/src/main/java/com/example/yugiohscanner/ui/DecksScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SammlungScreen.kt android/app/src/test/java/com/example/yugiohscanner/DecksRepositoryTest.kt
git commit -m "feat(e1): Handy zeigt Abgleich und Deckbox, befüllt die Box und setzt Fehlende auf die Wunschliste

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Controller-Abschluss (kein Subagent)

- [ ] **Gesamtlauf:** Desktop SQLite-Suite, `electron/test-sync.cjs`, Desktop-Helfer, Lint genau 5, `npx vite build`, Android `testDebugUnitTest assembleDebug`. Die Zahlen kommen ins Ledger (Android aus `android/app/build/test-results/testDebugUnitTest/*.xml`).
- [ ] **Abschlussreview** mit dem besten Modell über den gesamten Zweig (`review-package`, Basis = Plan-Commit), danach eine Fix-Welle und ein scoped Re-Review. Besonders prüfen:
  - Die Zwillinge sind zeichengleich in der Regel: gleiche Gruppenfolge, gleicher Gleichstand (`copy_id`), gleiche Rundung (`round2` je Karte, dann Summe), gleiche Texte inklusive Einzahl; beide Seiten lesen dieselben drei Fixtures.
  - Die Cloud-Suche beim Massen-Hinzufügen läuft höchstens einmal (Desktop `decks.cjs`, Handy `DeckWishlist.addAll`), und nur mit Deal-Watch.
  - Kein Platzhalter zeigt „0/…": Desktop-Liste, Kopf und Zeilen sowie Handy-Liste, Kopf und Zeilen zeigen „…", bis Decks, Deckkarten, Exemplare **und** Preise da sind.
  - Die Unique-Verletzung ändert nichts: Desktop setzt `decks`/`activeDeck` nur bei `success`, das Handy lädt `decks` nur nach Erfolg.
  - Verschieben geht Exemplar für Exemplar über die bestehenden Standort-Helfer; `page`/`slot` werden geleert; kein App-Code schreibt `cards.quantity`, `cards.deleted` oder `price_first_ed`.
  - `CatalogDb` v3 verwirft den alten Katalog genau einmal; ein Katalog v5 ergibt überall „Preis unbekannt".
  - Compose: `DeckCoverage.compute` nur in `remember`, `FillBoxProposal.compute` nur im Klick.
- [ ] **Übergabe an den Nutzer, in dieser Reihenfolge (Spec §10):**
  1. `supabase/decks_container.sql` im Dashboard einspielen.
  2. Desktop-Installer bauen und installieren, **nicht** aus dem Worktree mit Junction-`node_modules` (nach dem Merge im Hauptcheckout bauen). Danach am Desktop „Katalog jetzt bauen" drücken: die Statuszeile meldet Version 6, und `<userData>/catalog/catalog.json.gz` existiert.
  3. Erst dann die APK installieren (CatalogDb v3 lädt den Katalog v6). `connectedDebugAndroidTest` nie auf dem Gerät ausführen.
  Keine Edge Function, kein Deploy.
- [ ] **Abnahme** (Checkliste im Ledger, Spec §12):
  1. Desktop: einem Deck eine Deckbox zuordnen → das Handy zeigt dieselbe Box (Liste und Editor-Kopf).
  2. Kennzahlen (vorhanden, in der Box, fehlen, Kosten) sind auf beiden Geräten gleich, für ein Deck mit und eines ohne Box.
  3. Ein zweites Deck mit derselben Karte und eigener Deckbox, in der ein Exemplar steckt → im ersten Deck erscheint gelb „1 in Deck X", `verfügbar` sinkt um 1.
  4. „Box befüllen" am Desktop → Vorschlag in der Reihenfolge unsortiert, Box/freie Deckbox, Ordner; nach „In die Box verschieben" stimmen Ort und Zahlen am Desktop sofort und am Handy nach dem Abgleich.
  5. „Fehlende auf die Wunschliste" → Bestätigung mit den richtigen Zahlen; danach Einträge mit 1,2 × Katalogpreis und Deal-Watches in Wunschliste/Deals; die Cloud-Suche wurde genau einmal ausgelöst (Desktop-Konsole bzw. Supabase-Funktionsprotokoll, vom Nutzer eingesehen).
  6. Dieselbe Box einem zweiten Deck zuordnen → „Diese Deckbox gehört schon zu einem anderen Deck", die Zuordnung beider Decks bleibt unverändert (auch nach Neuladen).
- [ ] **Merge-Frage** an den Nutzer.

---

## Selbstprüfung

**Spec-Abdeckung:**

| Spec | Umsetzung |
|---|---|
| §1 Abgleich Spec ↔ Code (Decks cloud-only, keine Spalten, Android-Dateien vorhanden, `DeckBuilder.jsx`, keine Deck↔Behälter-Verknüpfung, Katalog ohne Preise, Wunschliste ohne Menge, Preise nur für besessene Printings) | Architektur; Task 1 (Spalte, Katalogpreis), Task 3/7 (Deckbox über Cloud), Task 6/7 (bestehende `DecksRepository`/`DecksScreen` erweitert), Plan-Ergänzungen 1, 2, 16 |
| §2 Aufteilung, E1 „nicht drin" | Global Constraints E1-spezifisch; keine Änderung an Import/Export, Side-Deck am Handy, Legalität, Simulation, `DeckBuilder.jsx`-Aufteilung |
| §3 Datenmodell (`container_id`, Unique-Index, kein FK, ungültige Box = keine Box, Auswahl nur freie + eigene, Passcode-Ebene) | Task 1 Step 1 (SQL); Task 2/6 `validDeckboxIds`, `deckBoxId`, `deckBoxChoices` (Fixture `choices`, Fälle „gelöschte"/„umgestellte Deckbox"); Task 3 `setDeckContainer`; Task 7 `setContainer` |
| §4 `deckCoverage` (needed über Abschnitte, inBox, reservedElsewhere mit Namen, available, missing, missingCost, unsortiert/Box/Ordner/freie Deckbox verfügbar, `Unknown` zählt, gelöscht zählt nicht, Deck-Summen, Datenquellen Desktop/Handy) | Task 2 (JS + Fixture), Task 6 (Kotlin), Task 3 `listDeckCopies` + `list-deck-copies`/`get-all-deck-cards`, Task 7 `CollectionStore` + `SideStores.allDeckCards`; Plan-Ergänzung 5 |
| §5 Kosten (`cm_price` aus `cardinfo.php`, > 0 sonst null, Version 6, Handy v3 mit v5 lesbar, Desktop aus derselben Datei, Anzeige „ca. …", „+ n ohne Preis", „Preis unbekannt") | Task 1 (`cmPriceOf`, `catalog-prices.cjs`, Ablage in `runCatalogBuild`), Task 5 (Parser/DB v3/`cmPrices`), Task 2/6 `costText` (Fixture-Fälle mit/ohne Preis, nur ohne Preis, Tausenderpunkt); Plan-Ergänzungen 1–3, 6 |
| §6 Wunschlisten-Kopplung (Kandidaten ohne vorhandene, `round(1,2 × cm_price, 2)`, ohne Preis kein Watch, Bestätigungstext, Cloud-Suche einmal, Rückmeldung inkl. Teilfehler, Zwillinge `wishlistMaxPrice`/`missingForWishlist`) | Task 2/6 `deckWishlist` (Fixture `maxPrice`, `missing`, `confirm`, `result`), Task 3 `addMissingToWishlist` (Test „genau einmal"), Task 6 `DeckWishlist.addAll` (Test), Task 4 `DeckWishlistDialog`, Task 7 `addMissing` + Dialog; Plan-Ergänzungen 7, 8, 18 |
| §7 Box befüllen (nur mit gültiger Box, `min(needed − inBox, available − inBox)`, Reihenfolge unsortiert → Box/freie Deckbox → Ordner, günstigstes nach `unitPrice × Zustandsfaktor`, Gleichstand `copy_id`, Dialog/Sheet mit Name, Printing, Ort, vorab angehakt, Verschieben über Standort-Helfer Exemplar für Exemplar, Fehler je Zeile, Zahlen neu, „n fehlen noch" mit Verweis, „n überzählig") | Task 2/6 `fillBoxProposal` (Fixture: Gruppen, günstigstes zuerst, 1st-Ed-Preis, Gleichstand, Lücke, Box-Exemplare nicht erneut, fremde Deckbox, ohne Box), `locationText`, `shortText`, `surplusText`; Task 3 `moveCopiesToContainer` (Test: Seite/Fach geleert, Fehler je Zeile); Task 4 `FillBoxDialog`; Task 7 `FillBoxSheet`; Plan-Ergänzungen 10–12 |
| §8 Anzeige (Desktop-Liste, Editor-Kopf mit Auswahl, „Noch keine Deckbox" + Link, Kennzahlen, zwei Buttons mit Sperre; Kartenzeile mit drei Zahlen rot, gelb „in Deck X"; neue Komponenten neben `DeckBuilder.jsx`; Handy Liste/Kopf/Zeilen; Ladezustand „…") | Task 2/6 `headerText`, `listText`, `boxLabel`, `rowText`, `reservedTexts`, `LOADING`; Task 4 (vier Komponenten + `DeckBuilder.jsx`); Task 7 (`DecksScreen.kt`); Plan-Ergänzungen 6, 13–15 |
| §9 Fehlerfälle (Box gelöscht/umgestellt, gleichzeitige Zuordnung → Unique-Meldung, Katalog < v6/fehlt → „Preis unbekannt", Cloud nicht erreichbar Desktop wie heute / Handy letzter Stand + Schreibfehler, Teilfehler Wunschliste/Verschieben) | Fixture-Fälle „gelöschte"/„umgestellte Deckbox" (Task 2/6); `deckContainerErrorMessage`/`containerErrorMessage` mit Tests (Task 3/7); `catalog-prices.test.cjs` + `CatalogParserTest` (Task 1/5); Desktop `coverageError`/`boxError`, Handy `ListCache`-Stand + `boxError`/`writeError` (Task 4/7); Teilfehler-Tests in `decks.test.cjs` und `DeckWishlistTest` |
| §10 Einspiel-Reihenfolge SQL → Installer + „Katalog jetzt bauen" (v6) → APK | Task 8 Übergabe |
| §11 Tests (deckCoverage, fillBoxProposal, missingForWishlist/wishlistMaxPrice je JS + Kotlin mit Fixture; Katalog-Build `cm_price`/0→null/Version 6; Handy-Parser + v5 lesbar; IPC in beiden Dateien; Cloud-Suche genau einmal; jeder Schutz-Test scheitert ohne Schutz) | Task 2 + 6 (Fixtures), Task 1 Step 2 (Build), Task 5 Step 1 (Parser), Task 3 `ipc-channels.test.cjs` + `decks.test.cjs`, Schutz-Nachweise in jedem Task |
| §12 Abnahme 1–6 | Task 8 Abnahme |

**Platzhalter-Suche:** Kein „TBD", kein „wie in Task N". Jeder Code-Schritt enthält den vollständigen Code. Die JS-, CJS- und Kotlin-Fassungen der Helfer, Tests und Fixtures sind vor dem Schreiben dieses Plans gegen die echten Projektabhängigkeiten ausgeführt worden: Helfer-Tests 19 grün, Hauptprozess-Tests (`decks`, `catalog-prices`, `catalog-build`, `copies-location`, `ipc-channels`) grün, Kotlin-Zwillinge mit Kotlin 2.0.0 kompiliert und 10 Tests grün, ESLint auf den neuen Renderer-Dateien ohne Befund. Nicht ausgeführt wurden `DecksScreen.kt`, `DecksRepository.kt`/`WishlistRepository.kt`/`SideStores.kt`, die Katalog-Änderungen am Handy und `npx vite build` (brauchen den vollständigen Android- bzw. Vite-Build im Worktree).

**Namens- und Typkonsistenz:**
- SQL: `decks.container_id`, Index `decks_container_unique`; Meldung `DECKBOX_TAKEN` = „Diese Deckbox gehört schon zu einem anderen Deck" (Desktop `decks.cjs`, Handy `DecksRepository`).
- Katalog: Feld `cm_price` (Task 1 Bau, `catalog-prices.cjs`, Task 5 Parser/DB-Spalte, `CatalogCard.cmPrice`, `CatalogRepository.cmPrices`).
- JS ↔ Kotlin: `deckCoverage` ↔ `DeckCoverage.compute`; `deckBoxChoices`/`deckBoxId`/`validDeckboxIds`/`headerText`/`listText`/`costText`/`boxLabel`/`rowText`/`reservedTexts`/`LOADING` gleichnamig; `fillBoxProposal` ↔ `FillBoxProposal.compute`, `locationText`/`shortText`/`surplusText` gleichnamig; `wishlistMaxPrice`/`missingForWishlist` gleichnamig, `wishlistConfirmText` ↔ `confirmText`, `wishlistResultText` ↔ `resultText`; `decks.cjs#addMissingToWishlist` ↔ `DeckWishlist.addAll`.
- Ergebnisfelder: JS `card_id/needed/inBox/available/missing/price/missingCost/reservedElsewhere[{deck_id,name,count}]` ↔ Kotlin `cardId/needed/inBox/available/missing/price/missingCost/reservedElsewhere[Reserved(deckId,name,count)]`; Summen `needed/owned/boxed/missing/missingCards/cost/unpriced` beidseitig; Vorschlag JS `{copy_id, card_id, group}` ↔ Kotlin `FillRow(copy, card, group)`.
- IPC: `list-deck-copies`/`listDeckCopies`, `get-all-deck-cards`/`getAllDeckCards`, `set-deck-container`/`setDeckContainer`, `get-catalog-prices`/`getCatalogPrices`, `deck-missing-to-wishlist`/`addMissingToWishlist`, `move-copies-to-container`/`moveCopiesToContainer`.
- Fixture-Schlüssel: `world`, `cases`, `choices` (coverage), `world`, `cases`, `location`, `texts` (fill-box), `maxPrice`, `missing`, `confirm`, `result` (wishlist) gleich in allen Lesern.
