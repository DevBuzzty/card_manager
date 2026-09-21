# Spec H3a Angebote (halbautomatisch) — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Angebote als eigener Zustand auf PC und Handy: Exemplare auf einem Kanal (`sale_channels`) zu einem Preis anbieten, Titel/Beschreibung/Cardmarket-Eintragwerte, Link zum Einstellen und Kartenbilder vorbereiten, Übersicht „Angebote“ mit Marken, und aus einem Angebot mit einem Schritt einen H2-Verkauf buchen. Nach **jedem** Verkauf werden dieselben Exemplare aus allen anderen aktiven Angeboten genommen, und die App erinnert daran, sie auch auf dem Marktplatz herauszunehmen.

**Architecture:** Zwei neue Tabellen `listings` + `listing_items` (lokal SQLite, Cloud Postgres), keine neue Datenbankfunktion. Der PC schreibt in lokalen Transaktionen (`listings.cjs`); das Aufräumen nach einem Verkauf läuft **in derselben Transaktion wie `sales.cjs#bookSale`** (`bookSaleDetailed`). Abgleich über zwei weitere Ströme im bestehenden `SALES_STREAMS`-Mechanismus von `sync.cjs`. Das Handy lädt beide Tabellen per Schlüssel-Blättern (`KeysetPager`) und schreibt per REST; „Verkauft“ bucht wie H2 über `book_sale`, danach folgen die Angebots-Schreibvorgänge. Alle Text- und Rechenregeln wohnen in reinen Zwillingen: `desktop/electron/listing-text.cjs` (maßgeblich am PC), `desktop/src/utils/listingText.js` (Renderer, wortgleich) und `android/.../ml/ListingText.kt`, alle gegen `docs/fixtures/listings/listings.json`.

**Tech Stack:** Electron CJS + better-sqlite3, React/Vite + Tailwind, Postgres/PostgREST, Kotlin/Compose (Material3), OkHttp + org.json, JUnit4, androidx.core `FileProvider`.

**Spec:** `docs/superpowers/specs/2026-09-21-spec-h3a-angebote-halbautomatisch.md` (Commit `3535ca6`). Setzt H2 (`87dc5d9`) voraus; Stand `main` = `8a7de43`.

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus, verbinden sich nie mit Supabase und rufen keine Edge Functions auf. SQL liefert der Plan nur als Datei; der Nutzer spielt sie von Hand ein.
- **Kein Implementer und kein Reviewer legt Worktrees, Arbeitskopien, Kopien von `node_modules` oder Junctions an, und niemand löscht etwas** (Dateien, Ordner, Zweige). Lehre H2 16:15: ein Reviewer hat mit einer eigenen Kopie das `node_modules` des Hauptordners geleert. Der Controller legt den einen Worktree an; alle arbeiten darin.
- Immer explizite Pfade stagen, nie `git add -A`, NIE `git stash` (auch nicht für Schutz-Nachweise: per Edit sabotieren, Fehlschlag zitieren, per Edit zurücknehmen).
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI).
- `cards.quantity`, `cards.deleted`, `cards.price_first_ed` schreibt die App nie. Nur Soft-Delete — auch für Angebote und Positionen (`deleted = 1`). `card_copies` wird nur über `copies.cjs` geschrieben (`setForSale`) bzw. am Handy über `CollectionRepository.setForSale`.
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs` UND in `ipc-channels.test.cjs`.
- Sichtbare Texte deutsch mit echten Umlauten.
- Regeln wohnen in reinen, getesteten Helfern. Absichtliche Zwillinge im Kopfkommentar markieren (mit Nennung der anderen Fassungen) und gegen die gemeinsame Fixture testen. Namensabweichungen zwischen JS und Kotlin stehen im Kopfkommentar.
- **Geld in ganzen Cent.** JS `Math.round`, Kotlin `java.lang.Math.round` (nie `kotlin.math.round`), derselbe Ausdruck in derselben Reihenfolge.
- **Textlängen in UTF-16-Codeeinheiten** (JS `.length` = Kotlin `String.length`). „–“, „…“, „×“, „ä“ zählen je 1. Keine Zeichen außerhalb der BMP in Texten oder Fixture.
- **Vergleiche und Sortierungen in den Zwillingen per Codeeinheiten** (JS `<`/`>`, Kotlin `String.compareTo`), nie `localeCompare`/`Collator` (H2-Minor: `Collator(GERMAN)` ≠ `localeCompare('de')`). Gleichstände deterministisch: Kopien nach `copy_id`, Angebote nach `listing_id`.
- Kein `(?U)` und keine anderen JVM-only-Regex-Kennzeichen im Android-Code (`AndroidRegexWaechterTest`).
- Leere Strings werden wie `null` behandelt.
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`, am 21.09. auf `main` gemessen: `8 problems (5 errors, 3 warnings)`). Ein sechster ist ein Fehlschlag. `.cjs`-Dateien lintet die Konfiguration nicht (`files: ['**/*.{js,jsx}']`), `.js`/`.jsx` schon.
- Ein Schutz-Test muss nachweislich ohne den Schutz scheitern (sabotieren, Fehlschlag zitieren, zurücknehmen).
- **Handy-Mutationen** laufen durch `InFlight` und laden **innerhalb** des Gatters frisch (`SideStores.listings.refreshAndWait()`, `CollectionStore.state.value`), bevor sie entscheiden (H2-Fix I2). Ist das Angebot inzwischen nicht mehr aktiv: Meldung „Angebot wurde inzwischen geändert – bitte neu öffnen.“ ohne Schreibaufruf. PC-Schreibaktionen durch `createBusyGate()`.
- **Handy-Listen über 1000 Zeilen:** PostgREST kappt `limit` bei 1000. Jede Handy-Abfrage, die wachsen kann, blättert per `KeysetPager` + `Keyset.after` (Muster `SalesRepository.salesPageParams`).
- **Ein Platzhalter sieht nie wie eine leere Liste aus:** solange geladen wird, steht „…“, nie „0 Angebote“ oder „0,00 €“.
- **React-Effekte mit Arrays:** Wer ein Array (`copyIds`) als Prop bekommt, hängt den Effekt an einen stabilen Schlüssel `const idsKey = copyIds.join(',')`, nie an das Array selbst (Muster `SaleDialog.jsx:33-54`).
- `react-hooks/set-state-in-effect`: kein synchrones setState im Effekt-Körper, nur in Promise-Callbacks. `react-hooks/purity`: kein `Date.now()`/`new Date()` im Render — „heute“ über `todayLocal()` in Handlern oder `useState(() => todayLocal())`.
- **Verschachtelte Dialoge und Escape (PC):** Ein Dialog über einem anderen hat einen eigenen Escape-Handler; der darunterliegende setzt seinen Handler aus, solange der obere offen ist (Muster `CopySheet.jsx:90-95` mit `sellingOpen`).
- **Sheets, die einen Zweigwechsel überleben müssen (Handy):** genau EINE Aufrufstelle außerhalb von Verzweigungen und vor jedem frühen `return` (Muster `SaleLists.kt:225-229`, `CardDetailScreen.kt:274-279`). Ein `SaleSheet`/`ListingSheet` darf nie in einem Zweig stehen, der während des Speicherns verschwinden kann.
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Neue Commits, nie `--amend`.
- **Installer:** gebaut in `desktop/dist-electron` (`package.json` `build.directories.output`), nie aus einem Junction-Worktree. Die Abnahme am PC gilt erst, wenn das **installierte** `app.asar` den neuen Kanal enthält (Lehre H2-Nachtrag 19:55: abgenommen wurde ein alter Build).
- H3a-spezifisch nicht drin (Spec §7/§12): automatisches Einstellen/Ändern/Beenden auf einem Marktplatz, Abholen von Verkäufen, eBay-API (H3b), Karten zu einem bestehenden Angebot hinzufügen, eigene Fotos.

**Befehle:**
- Desktop SQLite-Suite (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Desktop Sync-Skript (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
- Desktop-Helfer (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs`
- Einzelner reiner Test ohne SQLite (in `desktop/`): `node --test electron/listing-text.test.cjs`
- Desktop-Lint (in `desktop/`): `npx eslint .` → genau `5 errors`
- Desktop-Build (in `desktop/`): `npx vite build`
- Android (Repo-Wurzel): `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`; Testzahl = Summe der `tests=`-Attribute in `android/app/build/test-results/testDebugUnitTest/*.xml`.

Vor Task 1 misst der Controller die Ausgangszahlen auf `main` (SQLite-Suite, Helfer, Lint, Android-Tests) und trägt sie in den Bericht ein; jeder Task nennt danach seine Zahlen.

## Abweichungen von der Spec (bitte dem Nutzer vorlegen)

1. **Anlegen am Handy schreibt drei Tabellen nacheinander** (Spec §4.2: „je Aktion eine Tabelle“ stimmt für Anlegen nicht — Kopf, Positionen und `card_copies.for_sale` gehören zusammen). Ohne neue Datenbankfunktion (Spec) geht das nur nacheinander. Reihenfolge: erst `listing_items`, dann `listings`, zuletzt `for_sale`. Bricht es nach den Positionen ab, bleiben nur unsichtbare Positionen ohne Kopf (alle Regeln lesen Positionen nur zu vorhandenen, aktiven Angeboten); bricht es vor `for_sale` ab, steht das Angebot und die Meldung sagt „Angebot gespeichert, „Zum Verkauf“ nicht gesetzt“. Ebenso berühren „Verkauft“ (Kopf + Positionen) und das Aufräumen am Handy zwei Tabellen nacheinander; der Verkauf selbst (`book_sale`) ist davon unabhängig gültig (Spec §7.2).
2. **Reihenfolge der Gruppen** (Beschreibung, Konvolut-Titel, Cardmarket-Aufteilung, Bilder): nach dem Namen in Kleinbuchstaben mit ä→ae, ö→oe, ü→ue, ß→ss, verglichen per Codeeinheiten, dann Set-Code, Seltenheit, Sprache, Auflage (`first, unlimited, limited, unknown`), Zustand (`MT…PO`), Passcode. Die F1-Verkaufsliste sortiert mit `localeCompare('de')`; das ist am Handy nicht gleich nachzubauen (H2-Minor Collator). Die Zeilen selbst haben das F1-Format.
3. **Name in Titel, Beschreibung, Produkt und Momentaufnahme** = deutscher Katalogname (Katalog über die Artwork-Zuordnung), Rückfall `cards.name`. Grund: `cards.name` ist auf beiden Geräten der **englische** Name (`main.cjs:494-497`), das Spec-Beispiel verlangt „Dunkler Magier“. Die Momentaufnahme `listing_items.name` speichert diesen Anzeigenamen (bei `sale_items.name` ist es `cards.name`). Für die Cardmarket-Suche gilt der englische Katalogname, Rückfall `cards.name`.
4. **Präzisierungen der Textregeln** (keine andere Absicht): Seltenheit `Unknown` gilt wie eine leere; eine unbekannte Sprachkennung entfällt im Titel (in den Cardmarket-Eintragwerten steht dann die Kennung selbst); im Konvolut-Titel steht jeder Name nur einmal; beim Kürzen werden ein angeschnittenes „, “ oder „ – “ am Ende entfernt; ohne Leerzeichen vor der Grenze wird hart geschnitten. Cardmarket-Suche mit unbekanntem Set-Code: nur der englische Name.
5. **Cardmarket-Teilverkauf nie 0 €:** Rest-Preis = `max(1 Cent, Stückpreis × Rest)`. Ohne diese Grenze würde ein Angebot für 0,01 € über 3 Karten nach einem Teilverkauf 0 € kosten und die `CHECK (price > 0)`-Regel die ganze Buchung ablehnen.
6. **Verkauft aus einem inzwischen nicht mehr aktiven Angebot:** Der Verkauf wird trotzdem gebucht, das Angebot bleibt unverändert, nur aufgeräumt wird; der Dialog sagt „Angebot war nicht mehr aktiv – nur der Verkauf wurde gebucht.“ (PC wie Handy, wo `book_sale` vor dem Angebot geschrieben wird).
7. **Erinnerung im Buchungsdialog:** Nach dem Buchen zeigt der H2-Dialog (PC `SaleDialog`, Handy `SaleSheet`) einen Abschluss-Schritt „Auch dort herausnehmen: …“ (mit „Anzeige öffnen“, wenn ein Link hinterlegt ist) und ggf. „Preis für die übrigen Karten anpassen?“, bevor er schließt. Ohne betroffene Angebote schließt er wie bisher sofort.
8. **Link der Anzeige nur http(s):** `external_url` muss mit `http://` oder `https://` beginnen („Der Link muss mit http:// oder https:// beginnen.“), und „Link öffnen“ läuft über einen eigenen Kanal `listing-open-url`, der nur solche Links an `shell.openExternal` gibt. Der vorhandene Kanal `open-external` (`main.cjs:325`) prüft nichts.

## SQL — Reihenfolge ist Pflicht

`supabase/listings_schema.sql` (Task 3) muss der Nutzer einspielen, **bevor das Handy Angebote nutzt**, und sinnvollerweise **vor dem neuen PC-Build**. Anders als bei H2 (`sold_in`) ist der Fehlerfall ohne die Tabellen gutartig: `card_copies` ändert sich nicht, der PC protokolliert nur für die zwei neuen Ströme einen Fehler je Abgleich (`[sync] listings push: …`) und schiebt die Angebote nach, sobald die Tabellen da sind (der Push-Zeiger rückt bei einem Fehler nicht vor). Das Handy zeigt ohne Tabellen „Keine Verbindung – Angebote nicht geladen“ und sperrt Anlegen/Bearbeiten/Verkauft/Beenden; das Aufräumen nach einem Handy-Verkauf scheitert dann mit Hinweis, der Verkauf bleibt gültig.

Prüfabfrage für den Nutzer nach dem Einspielen:

```sql
select table_name as tabelle, count(*) as spalten
  from information_schema.columns
 where table_schema = 'public' and table_name in ('listings', 'listing_items')
 group by table_name order by table_name;
select tablename as tabelle, policyname as regel
  from pg_policies
 where schemaname = 'public' and tablename in ('listings', 'listing_items')
 order by tablename;
select distinct event_object_table as tabelle, trigger_name as ausloeser
  from information_schema.triggers
 where event_object_schema = 'public' and event_object_table in ('listings', 'listing_items')
 order by 1;
```

Erwartet: `listing_items 13`, `listings 14`; zwei Regeln (`listing_items_authenticated_all`, `listings_authenticated_all`); zwei Auslöser (`trg_listing_items_updated_at`, `trg_listings_updated_at`).

## Befunde aus dem Code-Abgleich

1. **Deutscher Name steht nicht in der Sammlung.** `cards.name` ist englisch; den deutschen Namen hängt `main.cjs:494-506` (`withGermanNames`) aus dem Offline-Katalog an (`readCatalogCards` + `name_de`). Artwork-Passcodes laufen über `catalog-prices.cjs:76-80` (`catalogMainId`). Am Handy: `CardRow.name` ebenfalls englisch; Katalog über `CatalogRepository.aliases(ids)` (`CatalogRepository.kt:167`) und `CatalogRepository.importRows(ids)` (`:143`, liefert `nameDe`/`nameEn`), beide SQLite-Lesen abseits des Hauptthreads (Muster `SaleLists.kt:70-74`).
2. **`cards.cm_url` gibt es nur am PC** (`database.cjs:270-274`, geschrieben vom Scraper); `sync.cjs` spiegelt sie nicht (`MIRROR_COLS`, `sync.cjs:16-18`). Am Handy gibt es daher für Cardmarket nur die Suche (Spec §13).
3. **`copies.setForSale`** (`copies.cjs:241-253`) ist idempotent, stempelt nur geänderte Zeilen und öffnet eine eigene Transaktion; better-sqlite3 schachtelt sie als Savepoint in eine äußere. `copies.deleteCopy` (`:140`) für Tests „Karte fehlt“.
4. **`bookSale`** (`sales.cjs:85-111`) bucht in einer Transaktion und gibt die `sale_id` als String zurück; `sales.test.cjs` und `main.cjs:904` verlassen sich darauf. H3a ergänzt `bookSaleDetailed` (gleicher Ablauf, Ergebnis `{ saleId, reminders, askAdjust, listingSkipped }`) und lässt `bookSale` als dünne Hülle bestehen. `sales.cjs` hat **CRLF**-Zeilenenden.
5. **`sales.test.cjs#freshDb`** legt keine Angebots-Tabellen an. Das Aufräumen prüft deshalb `sqlite_master` und tut ohne Tabelle nichts (`listings.cjs#hasListings`); so bleiben H2-Tests und Alt-Datenbanken unberührt. Produktiv legt `database.cjs:283-285` die Tabellen immer an.
6. **`SALES_STREAMS`** (`sync.cjs:254-258`) ist allgemein (Spalten, Booleans, Schlüssel, Zeiger). Zwei Stellen sind auf Verkaufsspalten zugeschnitten: die Zahlenumwandlung (`sync.cjs:270`, braucht `price`) und das Datum (`sync.cjs:271`, braucht `listed_on`). `pullSalesSafe`/`pushSalesSafe` (`sync.cjs:617-628`) laufen über eine feste Liste; die Angebote bekommen eine eigene Liste und eigene `…Safe`-Funktionen, damit `listings-changed` getrennt von `sales-changed` feuert (`cycle`, `sync.cjs:733`, `738`, `751-752`).
7. **Zeitstempel-Trigger** wie `trg_sales_updated` (`sales-schema.cjs:37-39`): ohne sie sähe der Push nichts. Gezogene Zeilen bekommen `updated_at` über `pulledUpdatedAtCeiling` (Fix I2) — der Mechanismus gilt für jede Tabelle in `SALES_STREAMS` automatisch.
8. **Links/Dateien am PC:** `open-external` existiert ohne Prüfung (`main.cjs:325`, `preload.cjs:153`, genutzt in `Deals.jsx:163`). Speichern-Dialoge nur für Exporte (`main.cjs:731`, `862`). Globales `fetch` und `fs` stehen im Hauptprozess bereit (`main.cjs:948`, `main.cjs:3`). `shell` ist importiert (`main.cjs:1`). Zwischenablage im Renderer über `navigator.clipboard.writeText` (`DeckExportMenu.jsx:14`).
9. **Android teilt heute nur Text** (`DecksScreen.kt:324-331`) und öffnet Links per `ACTION_VIEW` (`DealsScreen.kt:249`). **Es gibt keinen `FileProvider`**: `AndroidManifest.xml` hat keinen `<provider>`, `res/` hat keinen `xml/`-Ordner. `androidx.core:core-ktx:1.12.0` (`build.gradle.kts:58`) bringt `androidx.core.content.FileProvider` mit; Task 10 legt Provider und `res/xml/file_paths.xml` an. `applicationId` ohne Suffix (`build.gradle.kts:19`).
10. **Handy-Blättern:** `SalesRepository.kt:105-186` zeigt das Muster (`KeysetPager.all(StoreQueries.PAGE)`, `Keyset.after`), `StoreQueries.PAGE = 1000` (`StoreQueries.kt:18`). Fehlermeldungen der Cloud über `SalesRepository.dbErrorMessage` (`:310-313`, `internal`). `in.(…)`-Listen wie `CollectionRepository.forSalePatchParams` (`CollectionRepository.kt:169-173`).
11. **Einzige Aufrufstellen am Handy:** `ForSaleList` ruft `SaleSheet` vor dem frühen `return` (`SaleLists.kt:225-229`); `CardDetailScreen` ruft `CopySheet` genau einmal außerhalb der Verzweigung (`CardDetailScreen.kt:274-279`); `CopySheet` ruft `SaleSheet` am Ende (`CopySheet.kt:311-313`). `ListingSheet` und der Abschluss-Schritt des `SaleSheet` folgen demselben Muster.
12. **Chips:** PC `CollectionList.jsx:588-605` (Segmente `all|unknown|duplicates|forsale|incomplete|foils`, Zähler `segmentCounts` `:320-327`, Start öffnet über `location.state.segment` `:89`); Handy `CollectionScreen.kt:224-228` (drei `FilterChip`s in einer `Row`, ein vierter braucht `horizontalScroll`), Anfrage von Start über `CollectionChip` (`SaleLists.kt:48-57`, `AppNav.kt:231-232`).
13. **Start:** PC `Start.jsx:210-215` (Kacheln „Zum Verkauf“/„Duplikate“ mit `LOADING`), Handy `StartScreen.kt:359-374`, Pull-to-refresh lädt die Seitenspeicher in `StartScreen.kt:186-191`.
14. **Buchungsdialoge:** PC `SaleDialog.jsx` (eigener Escape-Handler `:27-31`, `idsKey` `:37-54`, `bookSale` `:69-79`); Handy `SaleSheet.kt:62` (Signatur), Buchen `:157-198`, „gebucht ist gebucht“ `:188-191`.
15. **Verkaufsliste:** PC `ForSaleList.jsx` Knopf „Verkauft buchen“ `:88-91`, Dialog `:100-107`, Häkchen `:138`; Handy `SaleLists.kt:245-247`, Häkchen `:283`.
16. **Kartenansicht:** PC Exemplar-Zeilen `CardDetailPanel.jsx:322-339`, einzige `CopySheet`-Stelle `:452-458`, „zuletzt gestartete Abfrage gewinnt“ über `createLatestOnly` (`:34-44`); Handy `CopyLocationRow` (`CardDetailScreen.kt:236`, `:297`).
17. **F1-Zeilenformat:** `export-formats.cjs:11` (`SALE_EDITION`: 1. Auflage / Unlimitiert / Limitiert, unbekannt entfällt), Zeile `:93-95` mit „ – “.
18. **Preisvorschlag:** Regel aus `settings` (`sale_discount_percent`, `sale_min_price`), am PC gelesen wie `collection-export.cjs:8-12`/`:61`; Handy `Prefs.saleSuggestion(ctx, valueCents)`.
19. **Installer:** `desktop/package.json:20-21` (`directories.output = dist-electron`); installiert nach `C:\Users\Buzzty\AppData\Local\Programs\yugioh-card-manager` (`resources\app.asar`).

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `docs/fixtures/listings/listings.json` (neu) | gemeinsame Fixture: Titel, Beschreibung, Cardmarket, Stückpreis, Teilverkauf, Links, Kürzel, Marken, Aufräumen | 1 |
| `desktop/electron/listing-text.cjs` + `.test.cjs` (neu) | Zwilling Hauptprozess (maßgeblich) | 1 |
| `desktop/src/utils/listingText.js` + `.test.js` (neu) | Zwilling Renderer (wortgleich) | 1 |
| `android/.../ml/ListingText.kt`, `ListingTextTest.kt` (neu) | Zwilling Kotlin | 2 |
| `supabase/listings_schema.sql` (neu) | Tabellen, Trigger, RLS | 3 |
| `desktop/electron/listings-schema.cjs`, `listings.cjs`, `listings.test.cjs` (neu); `sales.cjs`, `database.cjs` | Schema, Helfer, Aufräumen in `bookSale` | 4 |
| `desktop/electron/sync.cjs`, `listings-sync.test.cjs` (neu) | zwei Ströme | 5 |
| `desktop/electron/listing-images.cjs` + `.test.cjs` (neu), `main.cjs`, `preload.cjs`, `ipc-channels.test.cjs` | IPC, Bilder-Ordner, Link öffnen | 6 |
| `desktop/src/components/ListingDialog.jsx` (neu), `ForSaleList.jsx`, `CopySheet.jsx` | PC Anlegen, Cardmarket-Aufteilung | 7 |
| `desktop/src/utils/useListingsData.js` (neu), `desktop/src/components/ListingsList.jsx`, `ListingDetail.jsx` (neu), `CollectionList.jsx`, `CardDetailPanel.jsx`, `Start.jsx`, `SaleDialog.jsx` | PC Übersicht, Detail, Marken, Kartenansicht, Start, Verkauft/Teilverkauf/Erinnerung | 8 |
| `android/.../cloud/Listing.kt`, `cloud/ListingsRepository.kt`, `ListingsRepositoryTest.kt` (neu); `cloud/SideStores.kt` | Handy-Daten, Blättern, REST-Nutzlasten | 9 |
| `android/.../ui/ListingSheet.kt`, `ui/ListingShare.kt`, `res/xml/file_paths.xml`, `ListingShareConfigTest.kt` (neu); `AndroidManifest.xml`, `ui/SaleLists.kt`, `ui/CopySheet.kt` | Handy Anlegen, Teilen | 10 |
| `android/.../ui/ListingsScreen.kt` (neu); `ui/SaleLists.kt`, `ui/CollectionScreen.kt`, `ui/CardDetailScreen.kt`, `ui/StartScreen.kt`, `ui/AppNav.kt`, `ui/SaleSheet.kt` | Handy Übersicht, Detail, Marken, Start, Verkauft/Teilverkauf, Aufräumen nach `book_sale` | 11 |

`android/...` steht für `android/app/src/main/java/com/example/yugiohscanner`. Android-Tests liegen unter `android/app/src/test/java/com/example/yugiohscanner/` und lesen Fixtures über `Fixtures.text("docs/fixtures/...")`.

Reihenfolge strikt 1 → 11 im selben Worktree (Tasks mit disjunkten Dateien darf der Controller parallel geben: 2 ∥ 3; 9 ∥ 7/8). **Kein harter Halt für die SQL:** Kein Code-Task braucht die Cloud-Tabellen (Agents verbinden sich nie mit Supabase). Nach Task 3 legt der Controller dem Nutzer die SQL-Datei samt Prüfabfrage vor; gebraucht wird sie erst für Installation und Abnahme (Task 12). Task 12 macht der Controller.

---

### Task 1: Text- und Regel-Zwillinge JS (Hauptprozess + Renderer) mit gemeinsamer Fixture

**Files:**
- Create: `docs/fixtures/listings/listings.json`
- Create: `desktop/electron/listing-text.cjs`, `desktop/electron/listing-text.test.cjs`
- Create: `desktop/src/utils/listingText.js`, `desktop/src/utils/listingText.test.js`

**Interfaces:**
- Consumes: `desktop/electron/sales-math.cjs#toCents, euroCentsText` (Renderer: `desktop/src/utils/saleMath.js`, gleiche Namen).
- Produces (`listing-text.cjs`, CommonJS; `listingText.js` exportiert dieselben Namen per `export`):
  - `TITLE_MAX = 65`, `LANGUAGE_NAMES`
  - `groupItems(items) -> [{ card_id, name, name_en, set_code, language, rarity, edition, condition, image_url, count, copy_ids }]` (Gruppe = Druck + Sprache + Auflage + Zustand; `copy_ids` sortiert; Reihenfolge siehe Abweichung 2). `items`: `{ copy_id, card_id, name, name_en?, set_code, language, rarity, edition, condition, image_url? }`.
  - `truncateTitle(text, ellipsis) -> string`, `listingTitle(items) -> string`, `listingDescription(items, priceCents|null) -> string`
  - `cardmarketProduct(group) -> string`, `pieceCents(totalCents, quantity) -> number`, `cardmarketEntry(group, priceCents|null) -> { product, quantity, language, condition, firstEdition, pieceCents }`
  - `afterListingSale(listing{channel_id, price, status}, liveCopyIds, soldCopyIds) -> { status, removeCopyIds, priceCents, askAdjust }`
  - `listingLink(channelId, { cmUrl, nameEn, setCode }) -> string|null`, `channelShort(channelId, name) -> string`
  - `rowTitle(listing{channel_id, title}, liveItems) -> string`, `sortListings(listings) -> listings`
  - `listingMarks(listings, items, copyLive(id)->bool, saleStatusOf(saleId)->string|null, suggestionOf(copyId)->cents|null) -> { [listing_id]: { alsoOn: string[], missing, underSuggestion, saleCancelled } }`
  - `activeByCopy(listings, items) -> { [copy_id]: [{ listing_id, channel_id, channel_name, priceCents }] }`, `offeredText(offers) -> string|null`, `copyBadges(offers) -> string[]`
  - `cleanupAfterSale(listings, items, soldCopyIds, exceptListingId|null) -> { removeItems: [{listing_id, copy_id}], endListings: string[], remind: [{ listing_id, channel_name, title, external_url }] }`
  - `listingsSummary(listings, items) -> { listings, cards, priceCents }`, `summaryText(summary)`, `startText(n)`
  - `daysSince('YYYY-MM-DD', today) -> number`, `sinceText(days)`, `suggestionSum((cents|null)[]) -> cents|null`, `imageUrls(items) -> string[]`, `imagesText(saved, total)`
  - `listings`-Zeilen haben die Spalten der Tabelle (`price` in Euro wie in der Datenbank), `items` die Spalten von `listing_items` (`deleted` 0/1 oder Boolean).

- [ ] **Step 1: Fixture schreiben**

`docs/fixtures/listings/listings.json` (wörtlich; alle Werte sind mit dem Algorithmus aus Step 4 nachgerechnet und von Hand gegengeprüft, siehe Rechenweg):

```json
{
  "_comment": "Spec H3a §5.3-§7.2 -- gemeinsame Fixture fuer desktop/electron/listing-text.cjs, desktop/src/utils/listingText.js und android ml/ListingText.kt. Geld in Cent (price in Euro wie in der Datenbank). Laengen in UTF-16-Codeeinheiten. Alle Zeichen in der BMP.",
  "items": {
    "dm1": { "copy_id": "dm1", "card_id": "46986414", "name": "Dunkler Magier", "name_en": "Dark Magician", "set_code": "LOB-DE005", "language": "DE", "rarity": "Ultra Rare", "edition": "first", "condition": "NM", "image_url": "https://images.ygoprodeck.com/images/cards/46986414.jpg" },
    "dm2": { "copy_id": "dm2", "card_id": "46986414", "name": "Dunkler Magier", "name_en": "Dark Magician", "set_code": "LOB-DE005", "language": "DE", "rarity": "Ultra Rare", "edition": "first", "condition": "NM", "image_url": "https://images.ygoprodeck.com/images/cards/46986414.jpg" },
    "dm3": { "copy_id": "dm3", "card_id": "46986414", "name": "Dunkler Magier", "name_en": "Dark Magician", "set_code": "LOB-DE005", "language": "DE", "rarity": "Ultra Rare", "edition": "first", "condition": "NM", "image_url": "https://images.ygoprodeck.com/images/cards/46986414.jpg" },
    "dm4": { "copy_id": "dm4", "card_id": "46986414", "name": "Dunkler Magier", "name_en": "Dark Magician", "set_code": "SDY-DE006", "language": "DE", "rarity": "Common", "edition": "unlimited", "condition": "NM", "image_url": "https://images.ygoprodeck.com/images/cards/46986414.jpg" },
    "dm5": { "copy_id": "dm5", "card_id": "46986414", "name": "Dunkler Magier", "name_en": "Dark Magician", "set_code": "LOB-DE005", "language": "DE", "rarity": "Ultra Rare", "edition": "first", "condition": "EX", "image_url": "https://images.ygoprodeck.com/images/cards/46986414.jpg" },
    "be1": { "copy_id": "be1", "card_id": "89631139", "name": "Blauäugiger w. Drache", "name_en": "Blue-Eyes White Dragon", "set_code": "SDK-DE001", "language": "DE", "rarity": "Common", "edition": "unlimited", "condition": "EX", "image_url": "https://images.ygoprodeck.com/images/cards/89631139.jpg" },
    "be2": { "copy_id": "be2", "card_id": "89631139", "name": "Blauäugiger w. Drache", "name_en": "Blue-Eyes White Dragon", "set_code": "SDK-DE001", "language": "DE", "rarity": "Common", "edition": "unlimited", "condition": "EX", "image_url": "https://images.ygoprodeck.com/images/cards/89631139.jpg" },
    "ab1": { "copy_id": "ab1", "card_id": "14558127", "name": "Aschblüte & Freudiger Frühling", "name_en": "Ash Blossom & Joyous Spring", "set_code": "MACR-DE036", "language": "DE", "rarity": "Secret Rare", "edition": "limited", "condition": "MT", "image_url": "https://images.ygoprodeck.com/images/cards/14558127.jpg" },
    "tg1": { "copy_id": "tg1", "card_id": "55144522", "name": "Topf der Gier", "name_en": "Pot of Greed", "set_code": "Unknown", "language": "EN", "rarity": "", "edition": "unknown", "condition": "GD", "image_url": null },
    "nn1": { "copy_id": "nn1", "card_id": "12345678", "name": null, "name_en": null, "set_code": "ABC-DE001", "language": "IT", "rarity": "Rare", "edition": "first", "condition": "LP", "image_url": null }
  },
  "titles": [
    { "name": "eine Karte: Spec-Beispiel (67 Zeichen) wird an der Wortgrenze gekuerzt", "items": ["dm1"], "title": "Yu-Gi-Oh! Dunkler Magier LOB-DE005 Ultra Rare 1. Auflage NM", "length": 59 },
    { "name": "eine Karte: unlimitiert entfaellt", "items": ["be1"], "title": "Yu-Gi-Oh! Blauäugiger w. Drache SDK-DE001 Common EX Deutsch", "length": 59 },
    { "name": "unbekannte Angaben entfallen", "items": ["tg1"], "title": "Yu-Gi-Oh! Topf der Gier GD Englisch", "length": 35 },
    { "name": "ohne Namen steht der Passcode", "items": ["nn1"], "title": "Yu-Gi-Oh! 12345678 ABC-DE001 Rare 1. Auflage LP Italienisch", "length": 59 },
    { "name": "n gleiche", "items": ["be2", "be1"], "title": "2× Yu-Gi-Oh! Blauäugiger w. Drache SDK-DE001 Common EX Deutsch", "length": 62 },
    { "name": "n gleiche, gekuerzt ohne Auslassungszeichen", "items": ["dm3", "dm1", "dm2"], "title": "3× Yu-Gi-Oh! Dunkler Magier LOB-DE005 Ultra Rare 1. Auflage NM", "length": 62 },
    { "name": "Konvolut, gekuerzt mit Auslassungszeichen, Komma entfernt", "items": ["dm1", "be1", "ab1"], "title": "Yu-Gi-Oh! Konvolut 3 Karten – Aschblüte & Freudiger Frühling…", "length": 61 },
    { "name": "Konvolut ohne Kuerzung", "items": ["tg1", "dm1"], "title": "Yu-Gi-Oh! Konvolut 2 Karten – Dunkler Magier, Topf der Gier", "length": 59 },
    { "name": "Konvolut: gleicher Name nur einmal", "items": ["dm4", "dm1"], "title": "Yu-Gi-Oh! Konvolut 2 Karten – Dunkler Magier", "length": 44 },
    { "name": "Konvolut: Zustaende getrennt, Anzahl zaehlt alle Karten", "items": ["dm5", "dm1", "dm2"], "title": "Yu-Gi-Oh! Konvolut 3 Karten – Dunkler Magier", "length": 44 },
    { "name": "leer", "items": [], "title": "", "length": 0 }
  ],
  "descriptions": [
    { "name": "zwei Gruppen, Reihenfolge wie Konvolut-Titel", "items": ["dm2", "be1", "dm1"], "priceCents": 1250, "text": "1× Blauäugiger w. Drache – SDK-DE001 – Common – Unlimitiert – EX\n2× Dunkler Magier – LOB-DE005 – Ultra Rare – 1. Auflage – NM\n\nPreis: 12,50 €\n\nPrivatverkauf, keine Garantie oder Rücknahme." },
    { "name": "unbekannte Angaben entfallen, ohne Preis", "items": ["tg1"], "priceCents": null, "text": "1× Topf der Gier – GD\n\nPreis: –\n\nPrivatverkauf, keine Garantie oder Rücknahme." },
    { "name": "limitiert", "items": ["ab1"], "priceCents": 1999, "text": "1× Aschblüte & Freudiger Frühling – MACR-DE036 – Secret Rare – Limitiert – MT\n\nPreis: 19,99 €\n\nPrivatverkauf, keine Garantie oder Rücknahme." }
  ],
  "cardmarketGroups": [
    { "name": "gemischte Auswahl wird zu 4 Gruppen", "items": ["dm1", "be1", "dm2", "ab1", "dm5"], "groups": [
      { "product": "Aschblüte & Freudiger Frühling MACR-DE036", "condition": "MT", "count": 1, "copy_ids": ["ab1"] },
      { "product": "Blauäugiger w. Drache SDK-DE001", "condition": "EX", "count": 1, "copy_ids": ["be1"] },
      { "product": "Dunkler Magier LOB-DE005", "condition": "NM", "count": 2, "copy_ids": ["dm1", "dm2"] },
      { "product": "Dunkler Magier LOB-DE005", "condition": "EX", "count": 1, "copy_ids": ["dm5"] }
    ] }
  ],
  "cardmarketEntries": [
    { "items": ["dm2", "dm1"], "priceCents": 1001, "entry": { "product": "Dunkler Magier LOB-DE005", "quantity": 2, "language": "Deutsch", "condition": "NM", "firstEdition": true, "pieceCents": 501 } },
    { "items": ["tg1"], "priceCents": 150, "entry": { "product": "Topf der Gier", "quantity": 1, "language": "Englisch", "condition": "GD", "firstEdition": false, "pieceCents": 150 } },
    { "items": ["be1", "be2"], "priceCents": null, "entry": { "product": "Blauäugiger w. Drache SDK-DE001", "quantity": 2, "language": "Deutsch", "condition": "EX", "firstEdition": false, "pieceCents": null } }
  ],
  "pieceCents": [
    { "total": 1000, "quantity": 3, "cents": 333 },
    { "total": 1001, "quantity": 2, "cents": 501 },
    { "total": 999, "quantity": 4, "cents": 250 },
    { "total": 100, "quantity": 1, "cents": 100 }
  ],
  "afterSale": [
    { "name": "Cardmarket Teilverkauf: 500 je Stueck x 1 Rest", "listing": { "channel_id": "cardmarket", "price": 10.0, "status": "aktiv" }, "live": ["c1", "c2"], "sold": ["c1"], "result": { "status": "aktiv", "removeCopyIds": ["c1"], "priceCents": 500, "askAdjust": false } },
    { "name": "Cardmarket Teilverkauf: 333 je Stueck x 2 Rest", "listing": { "channel_id": "cardmarket", "price": 10.0, "status": "aktiv" }, "live": ["c1", "c2", "c10"], "sold": ["c10"], "result": { "status": "aktiv", "removeCopyIds": ["c10"], "priceCents": 666, "askAdjust": false } },
    { "name": "alles verkauft", "listing": { "channel_id": "ebay", "price": 12.0, "status": "aktiv" }, "live": ["c1", "c3"], "sold": ["c3", "c1"], "result": { "status": "verkauft", "removeCopyIds": [], "priceCents": 1200, "askAdjust": false } },
    { "name": "anderer Kanal Teilverkauf: Preis bleibt, Hinweis", "listing": { "channel_id": "ebay", "price": 12.0, "status": "aktiv" }, "live": ["c1", "c3"], "sold": ["c3"], "result": { "status": "aktiv", "removeCopyIds": ["c3"], "priceCents": 1200, "askAdjust": true } },
    { "name": "Cardmarket Teilverkauf: nie 0 Cent", "listing": { "channel_id": "cardmarket", "price": 0.01, "status": "aktiv" }, "live": ["c1", "c2", "c3"], "sold": ["c2"], "result": { "status": "aktiv", "removeCopyIds": ["c2"], "priceCents": 1, "askAdjust": false } },
    { "name": "nichts davon verkauft", "listing": { "channel_id": "ebay", "price": 12.0, "status": "aktiv" }, "live": ["c1"], "sold": ["c9"], "result": { "status": "aktiv", "removeCopyIds": [], "priceCents": 1200, "askAdjust": false } }
  ],
  "links": [
    { "channel_id": "cardmarket", "cmUrl": "https://www.cardmarket.com/de/YuGiOh/Products/Singles/Legend-of-Blue-Eyes-White-Dragon/Dark-Magician", "nameEn": "Dark Magician", "setCode": "LOB-DE005", "url": "https://www.cardmarket.com/de/YuGiOh/Products/Singles/Legend-of-Blue-Eyes-White-Dragon/Dark-Magician" },
    { "channel_id": "cardmarket", "cmUrl": null, "nameEn": "Ash Blossom & Joyous Spring", "setCode": "MACR-DE036", "url": "https://www.cardmarket.com/de/YuGiOh/Products/Search?searchString=Ash%20Blossom%20%26%20Joyous%20Spring%20MACR-DE036" },
    { "channel_id": "cardmarket", "cmUrl": "", "nameEn": null, "setCode": "LOB-DE005", "url": "https://www.cardmarket.com/de/YuGiOh/Products/Search?searchString=LOB-DE005" },
    { "channel_id": "cardmarket", "cmUrl": null, "nameEn": "Harpie's Feather Duster", "setCode": "Unknown", "url": "https://www.cardmarket.com/de/YuGiOh/Products/Search?searchString=Harpie's%20Feather%20Duster" },
    { "channel_id": "kleinanzeigen", "cmUrl": null, "nameEn": "Dark Magician", "setCode": "LOB-DE005", "url": "https://www.kleinanzeigen.de/p-anzeige-aufgeben.html" },
    { "channel_id": "ebay", "cmUrl": null, "nameEn": null, "setCode": null, "url": "https://www.ebay.de/sl/sell" },
    { "channel_id": "tausch", "cmUrl": null, "nameEn": null, "setCode": null, "url": null },
    { "channel_id": "privat", "cmUrl": null, "nameEn": null, "setCode": null, "url": null },
    { "channel_id": "5d0c1c52-0000-4000-8000-000000000001", "cmUrl": null, "nameEn": "Dark Magician", "setCode": "LOB-DE005", "url": null }
  ],
  "shorts": [
    { "channel_id": "cardmarket", "name": "Cardmarket", "short": "CM" },
    { "channel_id": "ebay", "name": "eBay", "short": "EB" },
    { "channel_id": "kleinanzeigen", "name": "Kleinanzeigen", "short": "KA" },
    { "channel_id": "tausch", "name": "Tausch", "short": "TA" },
    { "channel_id": "privat", "name": "Privat", "short": "PR" },
    { "channel_id": "x1", "name": "Flohmarkt", "short": "FL" },
    { "channel_id": "x2", "name": " börse", "short": "BÖ" },
    { "channel_id": "x3", "name": "", "short": "??" }
  ],
  "badges": [
    { "offers": [ { "listing_id": "l2", "channel_id": "ebay", "channel_name": "eBay", "priceCents": 1200 }, { "listing_id": "l9", "channel_id": "x1", "channel_name": "Flohmarkt", "priceCents": 300 }, { "listing_id": "l1", "channel_id": "cardmarket", "channel_name": "Cardmarket", "priceCents": 1000 }, { "listing_id": "l8", "channel_id": "ebay", "channel_name": "eBay", "priceCents": 900 } ], "badges": ["CM", "EB", "FL"] },
    { "offers": [], "badges": [] }
  ],
  "imageUrls": [
    { "items": ["dm1", "dm2", "be1", "tg1"], "urls": ["https://images.ygoprodeck.com/images/cards/89631139.jpg", "https://images.ygoprodeck.com/images/cards/46986414.jpg"] },
    { "items": ["dm4", "dm1"], "urls": ["https://images.ygoprodeck.com/images/cards/46986414.jpg"] },
    { "items": ["nn1"], "urls": [] }
  ],
  "imagesText": [
    { "saved": 3, "total": 4, "text": "3 von 4 Bildern gespeichert" },
    { "saved": 4, "total": 4, "text": "4 Bilder gespeichert" },
    { "saved": 1, "total": 1, "text": "1 Bild gespeichert" },
    { "saved": 0, "total": 2, "text": "0 von 2 Bildern gespeichert" },
    { "saved": 0, "total": 0, "text": "Keine Bilder vorhanden." }
  ],
  "since": [
    { "listed_on": "2026-09-15", "today": "2026-09-21", "days": 6, "text": "seit 6 Tagen" },
    { "listed_on": "2026-09-20", "today": "2026-09-21", "days": 1, "text": "seit 1 Tag" },
    { "listed_on": "2026-09-21", "today": "2026-09-21", "days": 0, "text": "seit heute" },
    { "listed_on": "2026-08-31", "today": "2026-09-01", "days": 1, "text": "seit 1 Tag" },
    { "listed_on": "2025-12-31", "today": "2026-03-01", "days": 60, "text": "seit 60 Tagen" },
    { "listed_on": "2026-09-22", "today": "2026-09-21", "days": 0, "text": "seit heute" }
  ],
  "suggestionSum": [
    { "values": [190, null, 250], "sum": 440 },
    { "values": [null, null], "sum": null },
    { "values": [], "sum": null },
    { "values": [0], "sum": 0 }
  ],
  "summaryTexts": [
    { "listings": 1, "cards": 1, "priceCents": 250, "text": "1 Angebot · 1 Karte · 2,50 €" },
    { "listings": 0, "cards": 0, "priceCents": 0, "text": "0 Angebote · 0 Karten · 0,00 €" },
    { "listings": 8, "cards": 34, "priceCents": 11250, "text": "8 Angebote · 34 Karten · 112,50 €" }
  ],
  "startTexts": [ { "n": 8, "text": "Angebote: 8 aktiv" }, { "n": 0, "text": "Angebote: 0 aktiv" } ],
  "rowTitleCases": [
    { "listing": { "channel_id": "cardmarket", "title": null }, "items": [], "title": "(ohne Karten)" },
    { "listing": { "channel_id": "cardmarket", "title": null }, "items": ["dm2", "dm1"], "title": "2× Dunkler Magier LOB-DE005" },
    { "listing": { "channel_id": "ebay", "title": "  " }, "items": ["dm1"], "title": "(ohne Titel)" },
    { "listing": { "channel_id": "ebay", "title": "Dunkler Magier NM" }, "items": ["dm1"], "title": "Dunkler Magier NM" }
  ],
  "board": {
    "today": "2026-09-21",
    "base": { "card_id": "46986414", "name": "Dunkler Magier", "name_en": "Dark Magician", "set_code": "LOB-DE005", "language": "DE", "rarity": "Ultra Rare", "edition": "first", "condition": "NM", "image_url": null },
    "listings": [
      { "listing_id": "l1", "channel_id": "cardmarket", "channel_name": "Cardmarket", "title": null, "price": 10.0, "status": "aktiv", "listed_on": "2026-09-10", "created_at": "2026-09-10 10:00:00", "sale_id": null, "external_url": null, "deleted": false },
      { "listing_id": "l2", "channel_id": "ebay", "channel_name": "eBay", "title": "Yu-Gi-Oh! Konvolut 2 Karten – Dunkler Magier", "price": 12.0, "status": "aktiv", "listed_on": "2026-09-15", "created_at": "2026-09-15 11:00:00", "sale_id": null, "external_url": "https://www.ebay.de/itm/123", "deleted": false },
      { "listing_id": "l3", "channel_id": "kleinanzeigen", "channel_name": "Kleinanzeigen", "title": "Dunkler Magier NM", "price": 5.0, "status": "aktiv", "listed_on": "2026-09-15", "created_at": "2026-09-15 09:00:00", "sale_id": null, "external_url": null, "deleted": false },
      { "listing_id": "l4", "channel_id": "ebay", "channel_name": "eBay", "title": "Dunkler Magier (eBay)", "price": 8.0, "status": "verkauft", "listed_on": "2026-09-01", "created_at": "2026-09-01 08:00:00", "sale_id": "s1", "external_url": null, "deleted": false },
      { "listing_id": "l5", "channel_id": "privat", "channel_name": "Privat", "title": "Privat-Angebot", "price": 3.0, "status": "beendet", "listed_on": "2026-09-15", "created_at": "2026-09-15 09:00:00", "sale_id": null, "external_url": null, "deleted": false },
      { "listing_id": "l6", "channel_id": "kleinanzeigen", "channel_name": "Kleinanzeigen", "title": "Kleinanzeige alt", "price": 4.0, "status": "verkauft", "listed_on": "2026-08-30", "created_at": "2026-08-30 08:00:00", "sale_id": "s2", "external_url": null, "deleted": false },
      { "listing_id": "l7", "channel_id": "tausch", "channel_name": "Tausch", "title": "", "price": 10.01, "status": "aktiv", "listed_on": "2026-09-15", "created_at": "2026-09-15 12:00:00", "sale_id": null, "external_url": null, "deleted": false }
    ],
    "items": [
      { "listing_id": "l1", "copy_id": "c1", "deleted": false },
      { "listing_id": "l1", "copy_id": "c2", "deleted": false },
      { "listing_id": "l2", "copy_id": "c1", "deleted": false },
      { "listing_id": "l2", "copy_id": "c3", "deleted": false },
      { "listing_id": "l3", "copy_id": "c4", "deleted": false },
      { "listing_id": "l3", "copy_id": "c5", "deleted": true },
      { "listing_id": "l4", "copy_id": "c6", "deleted": false },
      { "listing_id": "l5", "copy_id": "c1", "deleted": false },
      { "listing_id": "l6", "copy_id": "c7", "deleted": false },
      { "listing_id": "l7", "copy_id": "c8", "deleted": false }
    ],
    "copyLive": ["c1", "c2", "c3", "c5", "c8"],
    "saleStatus": { "s1": "storniert", "s2": "aktiv" },
    "suggestions": { "c1": 600, "c2": 600, "c3": null, "c8": 1201 },
    "marks": {
      "l1": { "alsoOn": ["eBay"], "missing": false, "underSuggestion": true, "saleCancelled": false },
      "l2": { "alsoOn": ["Cardmarket"], "missing": false, "underSuggestion": false, "saleCancelled": false },
      "l3": { "alsoOn": [], "missing": true, "underSuggestion": false, "saleCancelled": false },
      "l4": { "alsoOn": [], "missing": false, "underSuggestion": false, "saleCancelled": true },
      "l5": { "alsoOn": [], "missing": false, "underSuggestion": false, "saleCancelled": false },
      "l6": { "alsoOn": [], "missing": false, "underSuggestion": false, "saleCancelled": false },
      "l7": { "alsoOn": [], "missing": false, "underSuggestion": false, "saleCancelled": false }
    },
    "order": ["l7", "l2", "l3", "l5", "l1", "l4", "l6"],
    "summary": { "listings": 4, "cards": 6, "priceCents": 3701 },
    "summaryText": "4 Angebote · 6 Karten · 37,01 €",
    "rowTitles": { "l1": "2× Dunkler Magier LOB-DE005", "l2": "Yu-Gi-Oh! Konvolut 2 Karten – Dunkler Magier", "l3": "Dunkler Magier NM", "l7": "(ohne Titel)" },
    "byCopy": {
      "c1": [ { "listing_id": "l1", "channel_id": "cardmarket", "channel_name": "Cardmarket", "priceCents": 1000 }, { "listing_id": "l2", "channel_id": "ebay", "channel_name": "eBay", "priceCents": 1200 } ],
      "c2": [ { "listing_id": "l1", "channel_id": "cardmarket", "channel_name": "Cardmarket", "priceCents": 1000 } ],
      "c3": [ { "listing_id": "l2", "channel_id": "ebay", "channel_name": "eBay", "priceCents": 1200 } ],
      "c4": [ { "listing_id": "l3", "channel_id": "kleinanzeigen", "channel_name": "Kleinanzeigen", "priceCents": 500 } ],
      "c8": [ { "listing_id": "l7", "channel_id": "tausch", "channel_name": "Tausch", "priceCents": 1001 } ]
    },
    "offeredText": { "c1": "angeboten auf Cardmarket für 10,00 €, eBay für 12,00 €", "c8": "angeboten auf Tausch für 10,01 €", "c9": null },
    "cleanup": [
      { "name": "Verkauf aus der Verkaufsliste (ohne Angebot)", "sold": ["c3", "c1"], "except": null, "result": {
        "removeItems": [ { "listing_id": "l1", "copy_id": "c1" }, { "listing_id": "l2", "copy_id": "c1" }, { "listing_id": "l2", "copy_id": "c3" } ],
        "endListings": ["l2"],
        "remind": [
          { "listing_id": "l1", "channel_name": "Cardmarket", "title": "2× Dunkler Magier LOB-DE005", "external_url": null },
          { "listing_id": "l2", "channel_name": "eBay", "title": "Yu-Gi-Oh! Konvolut 2 Karten – Dunkler Magier", "external_url": "https://www.ebay.de/itm/123" }
        ] } },
      { "name": "Verkauf ueber Angebot l1: l1 selbst bleibt unberuehrt", "sold": ["c1", "c2"], "except": "l1", "result": {
        "removeItems": [ { "listing_id": "l2", "copy_id": "c1" } ],
        "endListings": [],
        "remind": [ { "listing_id": "l2", "channel_name": "eBay", "title": "Yu-Gi-Oh! Konvolut 2 Karten – Dunkler Magier", "external_url": "https://www.ebay.de/itm/123" } ] } },
      { "name": "letzte Position: Angebot endet", "sold": ["c4"], "except": null, "result": {
        "removeItems": [ { "listing_id": "l3", "copy_id": "c4" } ],
        "endListings": ["l3"],
        "remind": [ { "listing_id": "l3", "channel_name": "Kleinanzeigen", "title": "Dunkler Magier NM", "external_url": null } ] } },
      { "name": "Exemplar in keinem Angebot", "sold": ["c9"], "except": null, "result": { "removeItems": [], "endListings": [], "remind": [] } }
    ]
  }
}
```

Rechenweg der Fälle, die man leicht verwechselt (Merkhilfe für den Implementierer; Positionen 0-basiert, Längen in Codeeinheiten):
- **Spec-Beispiel ist 67 Zeichen lang** und wird gekürzt: „Yu-Gi-Oh!“ 0–8, Leerzeichen bei 9, 17, 24, 34, 40, 45, 48, 56, **59**, „Deutsch“ 60–66. Ohne Auslassungszeichen ist der Platz 65; `lastIndexOf(' ', 65)` = 59 → die ersten 59 Zeichen „…1. Auflage NM“. Die Sprache fällt weg (siehe Widerspruch in der Selbstprüfung).
- **„3× …“ Dunkler Magier:** „3×“ + Leerzeichen verschiebt alles um 3: Leerzeichen bei 59 und **62**, „Deutsch“ 63–69, Länge 70 → Schnitt bei 62.
- **Konvolut gekürzt:** Präfix „Yu-Gi-Oh! Konvolut 3 Karten – “ hat 30 Zeichen (Gedankenstrich bei 28). Gruppen gefaltet sortiert: „aschbluete…“ < „blauaeugiger…“ < „dunkler…“. „Aschblüte“ 30–38, „&“ 40, „Freudiger“ 42–50, „Frühling“ 52–59, „,“ 60, Leerzeichen **61**, „Blauäugiger“ 62–72. Mit Auslassungszeichen ist der Platz 64; `lastIndexOf(' ', 64)` = 61 → 61 Zeichen enden auf „Frühling,“ → Komma weg (60) → „…“ dazu = 61.
- **Konvolut ohne Kürzung:** 30 + „Dunkler Magier“ 14 + „, “ 2 + „Topf der Gier“ 13 = 59.
- **Blauäugiger-Titel:** 9 + 12 + 3 + 7 + 10 + 7 + 3 + 8 = 59; mit „2× “ 62. „ä“ ist ein Zeichen (vorkomponiert, U+00E4).
- **Stückpreis:** 1001/2 = 500,5 → `Math.round` 501 (JS und `java.lang.Math.round` runden ,5 nach oben); 999/4 = 249,75 → 250; 1000/3 = 333,33 → 333.
- **Cardmarket-Teilverkauf:** 1000 Cent, 3 Karten, 1 verkauft → 333 × 2 = 666; 0,01 € über 3 Karten → 0 × 2 = 0 → `max(1, 0)` = 1 (Abweichung 5).
- **120 %-Grenze:** l1 Summe der Vorschläge 600 + 600 = 1200 gegen Preis 1000: `1200 × 100 = 120000 ≥ 1000 × 120 = 120000` → Marke. l7: `1201 × 100 = 120100 ≥ 1001 × 120 = 120120`? nein → keine Marke. Nur Positionen mit lebendem Exemplar zählen (l3/c4 fehlt, Vorschlag 0).
- **„auch auf“:** c1 steckt in l1 (Cardmarket, aktiv), l2 (eBay, aktiv) und l5 (Privat, **beendet** → zählt nicht). l1 zeigt „eBay“, l2 „Cardmarket“.
- **Sortierung:** `listed_on` absteigend (2026-09-15: l2, l3, l5, l7), darin `created_at` absteigend (l7 12:00, l2 11:00, l3/l5 beide 09:00 → `listing_id` l3 vor l5), dann l1 (09-10), l4 (09-01), l6 (08-30).
- **Kopf:** aktiv sind l1, l2, l3, l7 = 4; lebende Positionen 2 + 2 + 1 (c5 herausgenommen) + 1 = 6; Preis 1000 + 1200 + 500 + 1001 = 3701 → „37,01 €“. `toCents(10.01)` = `Math.round(1000,9999…)` = 1001.
- **Aufräumen c1 + c3 ohne Angebot:** l1 verliert c1 (c2 bleibt, aktiv), l2 verliert c1 und c3 (leer → beendet); Erinnerung für l1 („2× Dunkler Magier LOB-DE005“, Zeilentitel VOR dem Aufräumen) und l2 (mit Link). Aus Angebot l1 verkauft (`except = l1`): nur l2 verliert c1 und bleibt aktiv.
- **Link:** `encodeURIComponent` kodiert Leerzeichen als `%20`, `&` als `%26` und lässt `'` stehen; die Kotlin-Fassung baut genau das nach (kein `URLEncoder`, der `+` und `%27` schriebe).

- [ ] **Step 2: Failing Test für den Hauptprozess schreiben**

`desktop/electron/listing-text.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const T = require('./listing-text.cjs');

// ZWILLING: desktop/src/utils/listingText.test.js und android ListingTextTest.kt lesen dieselbe Fixture.
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/fixtures/listings/listings.json'), 'utf8'));
const pick = (ids) => ids.map((id) => FIX.items[id]);
const B = FIX.board;
const boardItems = B.items.map((it) => ({ ...B.base, ...it }));
const live = new Set(B.copyLive);
const liveOf = (id) => boardItems.filter((it) => it.listing_id === id && !it.deleted);

test('Titel', () => {
  for (const c of FIX.titles) {
    const t = T.listingTitle(pick(c.items));
    assert.equal(t, c.title, c.name);
    assert.equal(t.length, c.length, `${c.name}: Länge`);
    assert.ok(t.length <= T.TITLE_MAX, `${c.name}: höchstens 65`);
  }
});
test('Beschreibung', () => {
  for (const c of FIX.descriptions) assert.equal(T.listingDescription(pick(c.items), c.priceCents), c.text, c.name);
});
test('Cardmarket-Aufteilung', () => {
  for (const c of FIX.cardmarketGroups) {
    const got = T.groupItems(pick(c.items)).map((g) => ({ product: T.cardmarketProduct(g), condition: g.condition, count: g.count, copy_ids: g.copy_ids }));
    assert.deepEqual(got, c.groups, c.name);
  }
});
test('Cardmarket-Eintragwerte', () => {
  for (const c of FIX.cardmarketEntries) {
    const groups = T.groupItems(pick(c.items));
    assert.equal(groups.length, 1);
    assert.deepEqual(T.cardmarketEntry(groups[0], c.priceCents), c.entry);
  }
});
test('Stückpreis', () => {
  for (const c of FIX.pieceCents) assert.equal(T.pieceCents(c.total, c.quantity), c.cents, JSON.stringify(c));
});
test('Verkauf aus einem Angebot (ganz/teilweise)', () => {
  for (const c of FIX.afterSale) assert.deepEqual(T.afterListingSale(c.listing, c.live, c.sold), c.result, c.name);
});
test('Links je Kanal', () => {
  for (const c of FIX.links) assert.equal(T.listingLink(c.channel_id, { cmUrl: c.cmUrl, nameEn: c.nameEn, setCode: c.setCode }), c.url, c.channel_id);
});
test('Kanal-Kürzel und Marken der Verkaufsliste', () => {
  for (const c of FIX.shorts) assert.equal(T.channelShort(c.channel_id, c.name), c.short, c.channel_id);
  for (const c of FIX.badges) assert.deepEqual(T.copyBadges(c.offers), c.badges);
});
test('Bilder', () => {
  for (const c of FIX.imageUrls) assert.deepEqual(T.imageUrls(pick(c.items)), c.urls);
  for (const c of FIX.imagesText) assert.equal(T.imagesText(c.saved, c.total), c.text);
});
test('seit N Tagen', () => {
  for (const c of FIX.since) {
    assert.equal(T.daysSince(c.listed_on, c.today), c.days, JSON.stringify(c));
    assert.equal(T.sinceText(c.days), c.text);
  }
});
test('Vorschlags-Summe', () => {
  for (const c of FIX.suggestionSum) assert.equal(T.suggestionSum(c.values), c.sum, JSON.stringify(c.values));
});
test('Texte: Kopf und Start', () => {
  for (const c of FIX.summaryTexts) assert.equal(T.summaryText(c), c.text);
  for (const c of FIX.startTexts) assert.equal(T.startText(c.n), c.text);
});
test('Zeilentitel', () => {
  for (const c of FIX.rowTitleCases) assert.equal(T.rowTitle(c.listing, pick(c.items)), c.title);
  for (const [id, title] of Object.entries(B.rowTitles)) assert.equal(T.rowTitle(B.listings.find((l) => l.listing_id === id), liveOf(id)), title, id);
});
test('Marken: auch auf, Karte fehlt, Preis unter Vorschlag (120 %), Verkauf storniert', () => {
  const m = T.listingMarks(B.listings, boardItems, (id) => live.has(id), (s) => B.saleStatus[s] ?? null, (id) => B.suggestions[id] ?? null);
  assert.deepEqual(m, B.marks);
});
test('Sortierung und Kopf', () => {
  assert.deepEqual(T.sortListings(B.listings).map((l) => l.listing_id), B.order);
  const s = T.listingsSummary(B.listings, boardItems);
  assert.deepEqual(s, B.summary);
  assert.equal(T.summaryText(s), B.summaryText);
});
test('Angebote je Exemplar', () => {
  const by = T.activeByCopy(B.listings, boardItems);
  assert.deepEqual(by, B.byCopy);
  for (const [id, text] of Object.entries(B.offeredText)) assert.equal(T.offeredText(by[id] || []), text, id);
});
test('Aufräumen nach dem Verkauf', () => {
  for (const c of B.cleanup) assert.deepEqual(T.cleanupAfterSale(B.listings, boardItems, c.sold, c.except), c.result, c.name);
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag bestätigen**

Run (in `desktop/`): `node --test electron/listing-text.test.cjs`
Expected: FAIL mit `Cannot find module './listing-text.cjs'`.

- [ ] **Step 4: `listing-text.cjs` schreiben**

```js
// desktop/electron/listing-text.cjs
// Spec H3a §5.3–§7.2 -- Texte und Regeln fuer Angebote. MASSGEBLICH am PC (listings.cjs).
// ZWILLINGE: desktop/src/utils/listingText.js (wortgleich, ESM) und
// android/app/src/main/java/com/example/yugiohscanner/ml/ListingText.kt. Gemeinsame Fixture: docs/fixtures/listings/listings.json.
// Wer eine Fassung aendert, aendert alle drei. Laengen in UTF-16-Codeeinheiten (JS .length = Kotlin .length); alle
// Texte bleiben in der BMP. Vergleiche per Codeeinheiten (kein localeCompare/Collator -- Geraetegleichheit).
const { toCents, euroCentsText } = require('./sales-math.cjs');

const TITLE_MAX = 65;
const LANGUAGE_NAMES = { DE: 'Deutsch', EN: 'Englisch', FR: 'Französisch', IT: 'Italienisch', SP: 'Spanisch', PT: 'Portugiesisch', JP: 'Japanisch' };
const TITLE_EDITION = { first: '1. Auflage', limited: 'Limitiert' };
// Wie export-formats.cjs#SALE_EDITION (F1-Verkaufsliste).
const LINE_EDITION = { first: '1. Auflage', unlimited: 'Unlimitiert', limited: 'Limitiert' };
const EDITION_ORDER = ['first', 'unlimited', 'limited', 'unknown'];
const CONDITION_ORDER = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];
const FIXED_SHORT = { cardmarket: 'CM', ebay: 'EB', kleinanzeigen: 'KA', tausch: 'TA', privat: 'PR' };
const LINKS = { kleinanzeigen: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben.html', ebay: 'https://www.ebay.de/sl/sell' };
const CM_SEARCH = 'https://www.cardmarket.com/de/YuGiOh/Products/Search?searchString=';
const DISCLAIMER = 'Privatverkauf, keine Garantie oder Rücknahme.';

const known = (v) => v != null && v !== '' && v !== 'Unknown';
const nameOf = (g) => (g.name != null && g.name !== '' ? g.name : String(g.card_id));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const foldName = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const isActive = (l) => l.status === 'aktiv' && !l.deleted;

function groupItems(items) {
  const m = new Map();
  for (const it of items || []) {
    const k = [String(it.card_id), it.set_code, it.language, it.rarity, it.edition, it.condition].join('|');
    const g = m.get(k);
    if (g) { g.count += 1; g.copy_ids.push(it.copy_id); continue; }
    m.set(k, { card_id: String(it.card_id), name: it.name ?? null, name_en: it.name_en ?? null, set_code: it.set_code,
      language: it.language, rarity: it.rarity, edition: it.edition, condition: it.condition, image_url: it.image_url ?? null,
      count: 1, copy_ids: [it.copy_id] });
  }
  const out = [...m.values()];
  for (const g of out) g.copy_ids.sort(cmp);
  return out.sort((a, b) => cmp(foldName(nameOf(a)), foldName(nameOf(b))) || cmp(a.set_code, b.set_code)
    || cmp(a.rarity, b.rarity) || cmp(a.language, b.language)
    || EDITION_ORDER.indexOf(a.edition) - EDITION_ORDER.indexOf(b.edition)
    || CONDITION_ORDER.indexOf(a.condition) - CONDITION_ORDER.indexOf(b.condition) || cmp(a.card_id, b.card_id));
}

function truncateTitle(text, ellipsis) {
  if (text.length <= TITLE_MAX) return text;
  const room = ellipsis ? TITLE_MAX - 1 : TITLE_MAX;
  const cut = text.lastIndexOf(' ', room);
  const head = (cut > 0 ? text.slice(0, cut) : text.slice(0, room)).replace(/[ ,–]+$/, '');
  return ellipsis ? `${head}…` : head;
}

function titleParts(g) {
  return ['Yu-Gi-Oh!', nameOf(g), known(g.set_code) ? g.set_code : null, known(g.rarity) ? g.rarity : null,
    TITLE_EDITION[g.edition] ?? null, known(g.condition) ? g.condition : null, LANGUAGE_NAMES[g.language] ?? null]
    .filter((p) => p != null).join(' ');
}

function listingTitle(items) {
  const groups = groupItems(items);
  if (groups.length === 0) return '';
  if (groups.length === 1) {
    const g = groups[0];
    return truncateTitle(g.count > 1 ? `${g.count}× ${titleParts(g)}` : titleParts(g), false);
  }
  const n = groups.reduce((a, g) => a + g.count, 0);
  const names = [];
  for (const g of groups) if (!names.includes(nameOf(g))) names.push(nameOf(g));
  return truncateTitle(`Yu-Gi-Oh! Konvolut ${n} Karten – ${names.join(', ')}`, true);
}

function listingDescription(items, priceCents) {
  const lines = groupItems(items).map((g) => [`${g.count}× ${nameOf(g)}`, known(g.set_code) ? g.set_code : null,
    known(g.rarity) ? g.rarity : null, LINE_EDITION[g.edition] ?? null, known(g.condition) ? g.condition : null]
    .filter((p) => p != null).join(' – '));
  return [...lines, '', `Preis: ${priceCents == null ? '–' : euroCentsText(priceCents)}`, '', DISCLAIMER].join('\n');
}

function cardmarketProduct(g) {
  return [nameOf(g), known(g.set_code) ? g.set_code : null].filter((p) => p != null).join(' ');
}
function pieceCents(totalCents, quantity) {
  return Math.round(totalCents / quantity);
}
function cardmarketEntry(g, priceCents) {
  return { product: cardmarketProduct(g), quantity: g.count, language: LANGUAGE_NAMES[g.language] ?? g.language,
    condition: g.condition, firstEdition: g.edition === 'first', pieceCents: priceCents == null ? null : pieceCents(priceCents, g.count) };
}

function afterListingSale(listing, liveCopyIds, soldCopyIds) {
  const live = [...new Set(liveCopyIds)];
  const sold = new Set(soldCopyIds);
  const hit = live.filter((id) => sold.has(id)).sort(cmp);
  const price = toCents(listing.price);
  if (hit.length === 0) return { status: listing.status, removeCopyIds: [], priceCents: price, askAdjust: false };
  if (hit.length === live.length) return { status: 'verkauft', removeCopyIds: [], priceCents: price, askAdjust: false };
  if (listing.channel_id === 'cardmarket') {
    // Nie 0 € (Spec §5.5): ein Stueckpreis, der auf 0 Cent faellt, ergaebe ein ungueltiges Angebot.
    const rest = Math.max(1, pieceCents(price, live.length) * (live.length - hit.length));
    return { status: 'aktiv', removeCopyIds: hit, priceCents: rest, askAdjust: false };
  }
  return { status: 'aktiv', removeCopyIds: hit, priceCents: price, askAdjust: true };
}

function listingLink(channelId, { cmUrl = null, nameEn = null, setCode = null } = {}) {
  if (channelId === 'cardmarket') {
    if (cmUrl != null && cmUrl !== '') return cmUrl;
    const q = [nameEn != null && nameEn !== '' ? nameEn : null, known(setCode) ? setCode : null].filter((p) => p != null).join(' ');
    return CM_SEARCH + encodeURIComponent(q);
  }
  return LINKS[channelId] ?? null;
}

function channelShort(channelId, name) {
  if (FIXED_SHORT[channelId]) return FIXED_SHORT[channelId];
  return String(name ?? '').trim().slice(0, 2).toUpperCase() || '??';
}

function rowTitle(listing, liveItems) {
  if (listing.channel_id === 'cardmarket') {
    const groups = groupItems(liveItems);
    if (groups.length === 0) return '(ohne Karten)';
    return `${groups.reduce((a, g) => a + g.count, 0)}× ${cardmarketProduct(groups[0])}`;
  }
  return listing.title != null && listing.title.trim() !== '' ? listing.title : '(ohne Titel)';
}

function sortListings(listings) {
  return [...listings].sort((a, b) => cmp(b.listed_on, a.listed_on) || cmp(b.created_at ?? '', a.created_at ?? '')
    || cmp(a.listing_id, b.listing_id));
}

function listingMarks(listings, items, copyLive, saleStatusOf, suggestionOf) {
  const active = new Map(listings.filter(isActive).map((l) => [l.listing_id, l]));
  const liveItems = (items || []).filter((it) => !it.deleted);
  const byCopy = new Map();
  for (const it of liveItems) {
    if (!active.has(it.listing_id)) continue;
    if (!byCopy.has(it.copy_id)) byCopy.set(it.copy_id, []);
    byCopy.get(it.copy_id).push(it.listing_id);
  }
  const out = {};
  for (const l of listings) {
    const act = isActive(l);
    const also = new Set();
    let missing = false;
    let sugg = 0;
    if (act) {
      for (const it of liveItems) {
        if (it.listing_id !== l.listing_id) continue;
        for (const other of byCopy.get(it.copy_id) || []) if (other !== l.listing_id) also.add(active.get(other).channel_name);
        if (copyLive(it.copy_id)) sugg += suggestionOf(it.copy_id) ?? 0;
        else missing = true;
      }
    }
    out[l.listing_id] = {
      alsoOn: [...also].sort(cmp),
      missing,
      underSuggestion: act && sugg > 0 && sugg * 100 >= toCents(l.price) * 120,
      saleCancelled: l.status === 'verkauft' && l.sale_id != null && saleStatusOf(l.sale_id) === 'storniert',
    };
  }
  return out;
}

function activeByCopy(listings, items) {
  const active = new Map(listings.filter(isActive).map((l) => [l.listing_id, l]));
  const out = {};
  for (const it of items || []) {
    if (it.deleted || !active.has(it.listing_id)) continue;
    const l = active.get(it.listing_id);
    (out[it.copy_id] = out[it.copy_id] || []).push({ listing_id: l.listing_id, channel_id: l.channel_id, channel_name: l.channel_name,
      priceCents: toCents(l.price) });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => cmp(a.channel_name, b.channel_name) || cmp(a.listing_id, b.listing_id));
  return out;
}
function offeredText(offers) {
  if (!offers || offers.length === 0) return null;
  return `angeboten auf ${offers.map((o) => `${o.channel_name} für ${euroCentsText(o.priceCents)}`).join(', ')}`;
}
function copyBadges(offers) {
  return [...new Set((offers || []).map((o) => channelShort(o.channel_id, o.channel_name)))].sort(cmp);
}

function cleanupAfterSale(listings, items, soldCopyIds, exceptListingId = null) {
  const sold = new Set(soldCopyIds);
  const removeItems = [];
  const endListings = [];
  const remind = [];
  const active = listings.filter((l) => isActive(l) && l.listing_id !== exceptListingId).sort((a, b) => cmp(a.listing_id, b.listing_id));
  for (const l of active) {
    const live = (items || []).filter((it) => it.listing_id === l.listing_id && !it.deleted);
    const hit = live.map((it) => it.copy_id).filter((id) => sold.has(id)).sort(cmp);
    if (hit.length === 0) continue;
    for (const id of hit) removeItems.push({ listing_id: l.listing_id, copy_id: id });
    if (hit.length === live.length) endListings.push(l.listing_id);
    remind.push({ listing_id: l.listing_id, channel_name: l.channel_name, title: rowTitle(l, live), external_url: l.external_url ?? null });
  }
  return { removeItems, endListings, remind };
}

function listingsSummary(listings, items) {
  const act = listings.filter(isActive);
  const ids = new Set(act.map((l) => l.listing_id));
  return {
    listings: act.length,
    cards: (items || []).filter((it) => !it.deleted && ids.has(it.listing_id)).length,
    priceCents: act.reduce((a, l) => a + toCents(l.price), 0),
  };
}
function summaryText(s) {
  return `${s.listings} ${s.listings === 1 ? 'Angebot' : 'Angebote'} · ${s.cards} ${s.cards === 1 ? 'Karte' : 'Karten'} · ${euroCentsText(s.priceCents)}`;
}
function startText(n) {
  return `Angebote: ${n} aktiv`;
}

function daysSince(listedOn, today) {
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.max(0, Math.round((utc(today) - utc(listedOn)) / 86400000));
}
function sinceText(days) {
  if (days <= 0) return 'seit heute';
  return days === 1 ? 'seit 1 Tag' : `seit ${days} Tagen`;
}

function suggestionSum(list) {
  let s = null;
  for (const v of list || []) if (v != null) s = (s ?? 0) + v;
  return s;
}

function imageUrls(items) {
  return [...new Set(groupItems(items).map((g) => g.image_url).filter((u) => u != null && u !== ''))];
}
function imagesText(saved, total) {
  if (total === 0) return 'Keine Bilder vorhanden.';
  if (saved === total) return `${total} ${total === 1 ? 'Bild' : 'Bilder'} gespeichert`;
  return `${saved} von ${total} Bildern gespeichert`;
}

module.exports = {
  TITLE_MAX, LANGUAGE_NAMES, groupItems, truncateTitle, listingTitle, listingDescription, cardmarketProduct, pieceCents,
  cardmarketEntry, afterListingSale, listingLink, channelShort, rowTitle, sortListings, listingMarks, activeByCopy,
  offeredText, copyBadges, cleanupAfterSale, listingsSummary, summaryText, startText, daysSince, sinceText,
  suggestionSum, imageUrls, imagesText,
};
```

- [ ] **Step 5: Test grün**

Run (in `desktop/`): `node --test electron/listing-text.test.cjs` → PASS, 17 Tests. Scheitert ein Fixture-Wert, zuerst den Rechenweg nachvollziehen. Die Fixture ist der Vertrag; ein geänderter Wert nur mit Begründung im Bericht und für alle drei Zwillinge.

- [ ] **Step 6: Renderer-Zwilling mit Test**

`desktop/src/utils/listingText.js` ist `listing-text.cjs` **wortgleich**, mit genau drei Änderungen:
1. Kopfkommentar: `// Spec H3a -- ZWILLING (wortgleich) von desktop/electron/listing-text.cjs und android ml/ListingText.kt. Fixture: docs/fixtures/listings/listings.json.`
2. Statt `const { toCents, euroCentsText } = require('./sales-math.cjs');` steht `import { toCents, euroCentsText } from './saleMath.js';`.
3. Jede in `module.exports` genannte Konstante/Funktion bekommt `export` vor `const`/`function`; der `module.exports`-Block entfällt.

`desktop/src/utils/listingText.test.js` ist der Test aus Step 2 mit ESM-Kopf:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from './listingText.js';

// ZWILLING: desktop/electron/listing-text.test.cjs und android ListingTextTest.kt lesen dieselbe Fixture.
const FIX = JSON.parse(readFileSync(new URL('../../../docs/fixtures/listings/listings.json', import.meta.url), 'utf8'));
// … ab `const pick = …` wörtlich wie listing-text.test.cjs …
```

Run (in `desktop/`): `node --test src/utils/listingText.test.js` → PASS, 17 Tests. Dann `npx eslint .` → genau 5 Fehler.

- [ ] **Step 7: Schutz-Nachweise**

1. In `truncateTitle` das `.replace(/[ ,–]+$/, '')` per Edit entfernen. „Titel“ scheitert beim Fall „Konvolut, gekuerzt mit Auslassungszeichen“ (`…Frühling,…` statt `…Frühling…`). Zitieren, zurücknehmen.
2. In `cleanupAfterSale` die Bedingung `&& l.listing_id !== exceptListingId` entfernen. „Aufräumen nach dem Verkauf“ scheitert beim Fall „Verkauf ueber Angebot l1“. Zitieren, zurücknehmen.
3. In `listingMarks` `>=` durch `>` ersetzen. „Marken“ scheitert (l1 `underSuggestion`). Zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add docs/fixtures/listings/listings.json desktop/electron/listing-text.cjs desktop/electron/listing-text.test.cjs desktop/src/utils/listingText.js desktop/src/utils/listingText.test.js
git commit -m "feat(h3a): Text- und Regel-Zwillinge fuer Angebote (JS) mit gemeinsamer Fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Kotlin-Zwilling `ListingText`

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ml/ListingText.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/ListingTextTest.kt`

**Interfaces:**
- Consumes: Fixture aus Task 1, `ml.SalesMath.toCents/euroCentsText`.
- Produces (`object ListingText` in `com.example.yugiohscanner.ml`, Namen wie JS; Abweichungen im Kopfkommentar):
  - `data class Item(copyId, cardId, name: String?, setCode, language, rarity, edition, condition, nameEn: String? = null, imageUrl: String? = null, listingId: String = "", deleted: Boolean = false)`
  - `data class Group(cardId, name: String?, nameEn: String?, setCode, language, rarity, edition, condition, imageUrl: String?, count: Int, copyIds: List<String>)`
  - `data class Head(listingId, channelId, channelName, title: String?, priceCents: Long, status, listedOn, createdAt: String? = null, saleId: String? = null, externalUrl: String? = null, deleted: Boolean = false)`
  - `data class CmEntry(product, quantity: Int, language, condition, firstEdition: Boolean, pieceCents: Long?)`, `AfterSale(status, removeCopyIds: List<String>, priceCents: Long, askAdjust: Boolean)`, `Marks(alsoOn: List<String>, missing, underSuggestion, saleCancelled)`, `Offer(listingId, channelId, channelName, priceCents: Long)`, `RemoveItem(listingId, copyId)`, `Remind(listingId, channelName, title, externalUrl: String?)`, `Cleanup(removeItems, endListings, remind)`, `Summary(listings: Int, cards: Int, priceCents: Long)`
  - Funktionen: `groupItems`, `truncateTitle`, `listingTitle`, `listingDescription(items, priceCents: Long?)`, `cardmarketProduct`, `pieceCents(totalCents: Long, quantity: Int): Long`, `cardmarketEntry`, `afterListingSale(channelId, status, priceCents, liveCopyIds, soldCopyIds)`, `encodeUriComponent`, `listingLink(channelId, cmUrl, nameEn, setCode)`, `channelShort`, `rowTitle(channelId, title, liveItems)` + `rowTitle(head, liveItems)`, `sortListings`, `listingMarks(...): Map<String, Marks>`, `activeByCopy(...): Map<String, List<Offer>>`, `offeredText`, `copyBadges`, `cleanupAfterSale(listings, items, sold, exceptListingId: String?)`, `listingsSummary`, `summaryText`, `startText`, `daysSince`, `sinceText`, `suggestionSum(List<Long?>)`, `imageUrls`, `imagesText`.

- [ ] **Step 1: Failing Test schreiben**

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.ListingText
import com.example.yugiohscanner.ml.SalesMath
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** ZWILLING von desktop/electron/listing-text.test.cjs -- dieselbe Fixture docs/fixtures/listings/listings.json. */
class ListingTextTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/listings/listings.json"))
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    private fun strings(a: JSONArray) = (0 until a.length()).map { a.getString(it) }
    private fun longOrNull(o: JSONObject, k: String): Long? = if (o.isNull(k)) null else o.getLong(k)
    private fun item(o: JSONObject) = ListingText.Item(
        copyId = o.getString("copy_id"), cardId = o.getString("card_id"), name = str(o, "name"),
        setCode = o.getString("set_code"), language = o.getString("language"), rarity = o.getString("rarity"),
        edition = o.getString("edition"), condition = o.getString("condition"), nameEn = str(o, "name_en"),
        imageUrl = str(o, "image_url"), listingId = str(o, "listing_id") ?: "", deleted = o.optBoolean("deleted", false),
    )
    private val pool = fix.getJSONObject("items")
    private fun pick(a: JSONArray) = strings(a).map { item(pool.getJSONObject(it)) }
    private val board = fix.getJSONObject("board")
    private val base = board.getJSONObject("base")
    private val boardItems = board.getJSONArray("items").objects().map { o ->
        val merged = JSONObject(base.toString())
        for (k in o.keys()) merged.put(k, o.get(k))
        item(merged)
    }
    private fun head(o: JSONObject) = ListingText.Head(
        o.getString("listing_id"), o.getString("channel_id"), o.getString("channel_name"), str(o, "title"),
        SalesMath.toCents(o.getDouble("price"))!!, o.getString("status"), o.getString("listed_on"), str(o, "created_at"),
        str(o, "sale_id"), str(o, "external_url"), o.optBoolean("deleted", false),
    )
    private val listings = board.getJSONArray("listings").objects().map { head(it) }
    private val live = strings(board.getJSONArray("copyLive")).toSet()
    private fun liveOf(id: String) = boardItems.filter { it.listingId == id && !it.deleted }
    private fun offer(o: JSONObject) = ListingText.Offer(o.getString("listing_id"), o.getString("channel_id"), o.getString("channel_name"), o.getLong("priceCents"))

    @Test fun titel() {
        for (c in fix.getJSONArray("titles").objects()) {
            val t = ListingText.listingTitle(pick(c.getJSONArray("items")))
            assertEquals(c.getString("name"), c.getString("title"), t)
            assertEquals(c.getString("name"), c.getInt("length"), t.length)
            assertTrue(t.length <= ListingText.TITLE_MAX)
        }
    }
    @Test fun beschreibung() {
        for (c in fix.getJSONArray("descriptions").objects())
            assertEquals(c.getString("name"), c.getString("text"), ListingText.listingDescription(pick(c.getJSONArray("items")), longOrNull(c, "priceCents")))
    }
    @Test fun cardmarketAufteilung() {
        for (c in fix.getJSONArray("cardmarketGroups").objects()) {
            val exp = c.getJSONArray("groups").objects().map { listOf(it.getString("product"), it.getString("condition"), it.getInt("count"), strings(it.getJSONArray("copy_ids"))) }
            val got = ListingText.groupItems(pick(c.getJSONArray("items"))).map { listOf(ListingText.cardmarketProduct(it), it.condition, it.count, it.copyIds) }
            assertEquals(c.getString("name"), exp, got)
        }
    }
    @Test fun cardmarketEintragwerte() {
        for (c in fix.getJSONArray("cardmarketEntries").objects()) {
            val groups = ListingText.groupItems(pick(c.getJSONArray("items")))
            assertEquals(1, groups.size)
            val e = c.getJSONObject("entry")
            assertEquals(ListingText.CmEntry(e.getString("product"), e.getInt("quantity"), e.getString("language"), e.getString("condition"),
                e.getBoolean("firstEdition"), longOrNull(e, "pieceCents")), ListingText.cardmarketEntry(groups[0], longOrNull(c, "priceCents")))
        }
    }
    @Test fun stueckpreis() {
        for (c in fix.getJSONArray("pieceCents").objects())
            assertEquals(c.toString(), c.getLong("cents"), ListingText.pieceCents(c.getLong("total"), c.getInt("quantity")))
    }
    @Test fun verkaufAusAngebot() {
        for (c in fix.getJSONArray("afterSale").objects()) {
            val l = c.getJSONObject("listing"); val r = c.getJSONObject("result")
            assertEquals(c.getString("name"),
                ListingText.AfterSale(r.getString("status"), strings(r.getJSONArray("removeCopyIds")), r.getLong("priceCents"), r.getBoolean("askAdjust")),
                ListingText.afterListingSale(l.getString("channel_id"), l.getString("status"), SalesMath.toCents(l.getDouble("price"))!!,
                    strings(c.getJSONArray("live")), strings(c.getJSONArray("sold"))))
        }
    }
    @Test fun links() {
        for (c in fix.getJSONArray("links").objects())
            assertEquals(c.getString("channel_id"), str(c, "url"),
                ListingText.listingLink(c.getString("channel_id"), str(c, "cmUrl"), str(c, "nameEn"), str(c, "setCode")))
    }
    @Test fun kuerzelUndMarken() {
        for (c in fix.getJSONArray("shorts").objects())
            assertEquals(c.getString("channel_id"), c.getString("short"), ListingText.channelShort(c.getString("channel_id"), c.getString("name")))
        for (c in fix.getJSONArray("badges").objects())
            assertEquals(strings(c.getJSONArray("badges")), ListingText.copyBadges(c.getJSONArray("offers").objects().map { offer(it) }))
    }
    @Test fun bilder() {
        for (c in fix.getJSONArray("imageUrls").objects())
            assertEquals(strings(c.getJSONArray("urls")), ListingText.imageUrls(pick(c.getJSONArray("items"))))
        for (c in fix.getJSONArray("imagesText").objects())
            assertEquals(c.getString("text"), ListingText.imagesText(c.getInt("saved"), c.getInt("total")))
    }
    @Test fun seitNTagen() {
        for (c in fix.getJSONArray("since").objects()) {
            assertEquals(c.toString(), c.getInt("days"), ListingText.daysSince(c.getString("listed_on"), c.getString("today")))
            assertEquals(c.getString("text"), ListingText.sinceText(c.getInt("days")))
        }
    }
    @Test fun vorschlagsSumme() {
        for (c in fix.getJSONArray("suggestionSum").objects()) {
            val a = c.getJSONArray("values")
            val values = (0 until a.length()).map { if (a.isNull(it)) null else a.getLong(it) }
            assertEquals(a.toString(), longOrNull(c, "sum"), ListingText.suggestionSum(values))
        }
    }
    @Test fun texte() {
        for (c in fix.getJSONArray("summaryTexts").objects())
            assertEquals(c.getString("text"), ListingText.summaryText(ListingText.Summary(c.getInt("listings"), c.getInt("cards"), c.getLong("priceCents"))))
        for (c in fix.getJSONArray("startTexts").objects()) assertEquals(c.getString("text"), ListingText.startText(c.getInt("n")))
    }
    @Test fun zeilentitel() {
        for (c in fix.getJSONArray("rowTitleCases").objects()) {
            val l = c.getJSONObject("listing")
            assertEquals(c.getString("title"), ListingText.rowTitle(l.getString("channel_id"), str(l, "title"), pick(c.getJSONArray("items"))))
        }
        val rt = board.getJSONObject("rowTitles")
        for (id in rt.keys()) assertEquals(id, rt.getString(id), ListingText.rowTitle(listings.first { it.listingId == id }, liveOf(id)))
    }
    @Test fun marken() {
        val sugg = board.getJSONObject("suggestions")
        val status = board.getJSONObject("saleStatus")
        val got = ListingText.listingMarks(listings, boardItems, { it in live }, { str(status, it) }, { if (!sugg.has(it) || sugg.isNull(it)) null else sugg.getLong(it) })
        val m = board.getJSONObject("marks")
        val exp = m.keys().asSequence().associateWith { k ->
            val o = m.getJSONObject(k)
            ListingText.Marks(strings(o.getJSONArray("alsoOn")), o.getBoolean("missing"), o.getBoolean("underSuggestion"), o.getBoolean("saleCancelled"))
        }
        assertEquals(exp, got)
    }
    @Test fun sortierungUndKopf() {
        assertEquals(strings(board.getJSONArray("order")), ListingText.sortListings(listings).map { it.listingId })
        val s = board.getJSONObject("summary")
        val got = ListingText.listingsSummary(listings, boardItems)
        assertEquals(ListingText.Summary(s.getInt("listings"), s.getInt("cards"), s.getLong("priceCents")), got)
        assertEquals(board.getString("summaryText"), ListingText.summaryText(got))
    }
    @Test fun angeboteJeExemplar() {
        val by = ListingText.activeByCopy(listings, boardItems)
        val e = board.getJSONObject("byCopy")
        assertEquals(e.keys().asSequence().associateWith { k -> e.getJSONArray(k).objects().map { offer(it) } }, by)
        val t = board.getJSONObject("offeredText")
        for (id in t.keys()) assertEquals(id, str(t, id), ListingText.offeredText(by[id] ?: emptyList()))
    }
    @Test fun aufraeumen() {
        for (c in board.getJSONArray("cleanup").objects()) {
            val r = c.getJSONObject("result")
            val exp = ListingText.Cleanup(
                r.getJSONArray("removeItems").objects().map { ListingText.RemoveItem(it.getString("listing_id"), it.getString("copy_id")) },
                strings(r.getJSONArray("endListings")),
                r.getJSONArray("remind").objects().map { ListingText.Remind(it.getString("listing_id"), it.getString("channel_name"), it.getString("title"), str(it, "external_url")) },
            )
            assertEquals(c.getString("name"), exp, ListingText.cleanupAfterSale(listings, boardItems, strings(c.getJSONArray("sold")), str(c, "except")))
        }
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: der Android-Befehl. Expected: Kompilierfehler `Unresolved reference: ListingText`.

- [ ] **Step 3: `ListingText.kt` schreiben**

```kotlin
package com.example.yugiohscanner.ml

import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Spec H3a §5.3–§7.2 -- Texte und Regeln für Angebote.
 * ZWILLING von desktop/electron/listing-text.cjs (maßgeblich am PC) und desktop/src/utils/listingText.js.
 * Gemeinsame Fixture docs/fixtures/listings/listings.json (ListingTextTest). Wer eine Fassung ändert, ändert alle drei.
 * Längen in UTF-16-Codeeinheiten (String.length = JS .length), alle Texte in der BMP. Vergleiche über String.compareTo
 * (Codeeinheiten, wie JS `<`), nie Collator. Rundung über java.lang.Math.round (wie JS Math.round).
 * Namensabweichungen zum JS: Felder camelCase; Angebote tragen priceCents statt price (Euro); afterListingSale und
 * rowTitle nehmen die Angebotsfelder einzeln; listingLink nimmt cmUrl/nameEn/setCode einzeln; Maps statt Objekte.
 */
object ListingText {
    const val TITLE_MAX = 65
    const val CM_SEARCH = "https://www.cardmarket.com/de/YuGiOh/Products/Search?searchString="
    const val DISCLAIMER = "Privatverkauf, keine Garantie oder Rücknahme."
    val LANGUAGE_NAMES = mapOf(
        "DE" to "Deutsch", "EN" to "Englisch", "FR" to "Französisch", "IT" to "Italienisch",
        "SP" to "Spanisch", "PT" to "Portugiesisch", "JP" to "Japanisch",
    )
    private val TITLE_EDITION = mapOf("first" to "1. Auflage", "limited" to "Limitiert")
    // Wie export-formats.cjs#SALE_EDITION (F1-Verkaufsliste).
    private val LINE_EDITION = mapOf("first" to "1. Auflage", "unlimited" to "Unlimitiert", "limited" to "Limitiert")
    private val EDITION_ORDER = listOf("first", "unlimited", "limited", "unknown")
    private val CONDITION_ORDER = listOf("MT", "NM", "EX", "GD", "LP", "PL", "PO")
    private val FIXED_SHORT = mapOf("cardmarket" to "CM", "ebay" to "EB", "kleinanzeigen" to "KA", "tausch" to "TA", "privat" to "PR")
    private val LINKS = mapOf(
        "kleinanzeigen" to "https://www.kleinanzeigen.de/p-anzeige-aufgeben.html",
        "ebay" to "https://www.ebay.de/sl/sell",
    )
    // Zeichen, die JS encodeURIComponent unverändert lässt.
    private const val UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

    data class Item(
        val copyId: String, val cardId: String, val name: String?, val setCode: String, val language: String,
        val rarity: String, val edition: String, val condition: String, val nameEn: String? = null,
        val imageUrl: String? = null, val listingId: String = "", val deleted: Boolean = false,
    )
    data class Group(
        val cardId: String, val name: String?, val nameEn: String?, val setCode: String, val language: String,
        val rarity: String, val edition: String, val condition: String, val imageUrl: String?, val count: Int, val copyIds: List<String>,
    )
    data class Head(
        val listingId: String, val channelId: String, val channelName: String, val title: String?, val priceCents: Long,
        val status: String, val listedOn: String, val createdAt: String? = null, val saleId: String? = null,
        val externalUrl: String? = null, val deleted: Boolean = false,
    )
    data class CmEntry(val product: String, val quantity: Int, val language: String, val condition: String, val firstEdition: Boolean, val pieceCents: Long?)
    data class AfterSale(val status: String, val removeCopyIds: List<String>, val priceCents: Long, val askAdjust: Boolean)
    data class Marks(val alsoOn: List<String>, val missing: Boolean, val underSuggestion: Boolean, val saleCancelled: Boolean)
    data class Offer(val listingId: String, val channelId: String, val channelName: String, val priceCents: Long)
    data class RemoveItem(val listingId: String, val copyId: String)
    data class Remind(val listingId: String, val channelName: String, val title: String, val externalUrl: String?)
    data class Cleanup(val removeItems: List<RemoveItem>, val endListings: List<String>, val remind: List<Remind>)
    data class Summary(val listings: Int, val cards: Int, val priceCents: Long)

    private fun known(v: String?) = v != null && v != "" && v != "Unknown"
    private fun nameOf(g: Group): String = g.name?.takeIf { it.isNotEmpty() } ?: g.cardId
    private fun foldName(s: String) =
        s.lowercase(Locale.ROOT).replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    private fun isActive(l: Head) = l.status == "aktiv" && !l.deleted

    private val GROUP_ORDER = Comparator<Group> { a, b ->
        var c = foldName(nameOf(a)).compareTo(foldName(nameOf(b)))
        if (c == 0) c = a.setCode.compareTo(b.setCode)
        if (c == 0) c = a.rarity.compareTo(b.rarity)
        if (c == 0) c = a.language.compareTo(b.language)
        if (c == 0) c = EDITION_ORDER.indexOf(a.edition) - EDITION_ORDER.indexOf(b.edition)
        if (c == 0) c = CONDITION_ORDER.indexOf(a.condition) - CONDITION_ORDER.indexOf(b.condition)
        if (c == 0) c = a.cardId.compareTo(b.cardId)
        c
    }

    fun groupItems(items: List<Item>): List<Group> {
        val m = LinkedHashMap<String, MutableList<Item>>()
        for (item in items) {
            val k = listOf(item.cardId, item.setCode, item.language, item.rarity, item.edition, item.condition).joinToString("|")
            m.getOrPut(k) { ArrayList() }.add(item)
        }
        return m.values.map { l ->
            val f = l.first()
            Group(f.cardId, f.name, f.nameEn, f.setCode, f.language, f.rarity, f.edition, f.condition, f.imageUrl, l.size, l.map { it.copyId }.sorted())
        }.sortedWith(GROUP_ORDER)
    }

    fun truncateTitle(text: String, ellipsis: Boolean): String {
        if (text.length <= TITLE_MAX) return text
        val room = if (ellipsis) TITLE_MAX - 1 else TITLE_MAX
        val cut = text.lastIndexOf(' ', room)
        val head = (if (cut > 0) text.substring(0, cut) else text.substring(0, room)).trimEnd(' ', ',', '–')
        return if (ellipsis) "$head…" else head
    }

    private fun titleParts(g: Group): String = listOfNotNull(
        "Yu-Gi-Oh!", nameOf(g), g.setCode.takeIf { known(it) }, g.rarity.takeIf { known(it) },
        TITLE_EDITION[g.edition], g.condition.takeIf { known(it) }, LANGUAGE_NAMES[g.language],
    ).joinToString(" ")

    fun listingTitle(items: List<Item>): String {
        val groups = groupItems(items)
        if (groups.isEmpty()) return ""
        if (groups.size == 1) {
            val g = groups[0]
            return truncateTitle(if (g.count > 1) "${g.count}× ${titleParts(g)}" else titleParts(g), false)
        }
        val n = groups.sumOf { it.count }
        val names = groups.map { nameOf(it) }.distinct()
        return truncateTitle("Yu-Gi-Oh! Konvolut $n Karten – ${names.joinToString(", ")}", true)
    }

    fun listingDescription(items: List<Item>, priceCents: Long?): String {
        val lines = groupItems(items).map { g ->
            listOfNotNull("${g.count}× ${nameOf(g)}", g.setCode.takeIf { known(it) }, g.rarity.takeIf { known(it) },
                LINE_EDITION[g.edition], g.condition.takeIf { known(it) }).joinToString(" – ")
        }
        val price = priceCents?.let { SalesMath.euroCentsText(it) } ?: "–"
        return (lines + listOf("", "Preis: $price", "", DISCLAIMER)).joinToString("\n")
    }

    fun cardmarketProduct(g: Group): String = listOfNotNull(nameOf(g), g.setCode.takeIf { known(it) }).joinToString(" ")

    fun pieceCents(totalCents: Long, quantity: Int): Long = Math.round(totalCents.toDouble() / quantity)

    fun cardmarketEntry(g: Group, priceCents: Long?): CmEntry = CmEntry(
        cardmarketProduct(g), g.count, LANGUAGE_NAMES[g.language] ?: g.language, g.condition, g.edition == "first",
        priceCents?.let { pieceCents(it, g.count) },
    )

    fun afterListingSale(channelId: String, status: String, priceCents: Long, liveCopyIds: List<String>, soldCopyIds: Collection<String>): AfterSale {
        val live = liveCopyIds.distinct()
        val sold = soldCopyIds.toSet()
        val hit = live.filter { it in sold }.sorted()
        if (hit.isEmpty()) return AfterSale(status, emptyList(), priceCents, false)
        if (hit.size == live.size) return AfterSale("verkauft", emptyList(), priceCents, false)
        if (channelId == "cardmarket") {
            // Nie 0 € (Spec §5.5): ein Stückpreis, der auf 0 Cent fällt, ergäbe ein ungültiges Angebot.
            val rest = maxOf(1L, pieceCents(priceCents, live.size) * (live.size - hit.size))
            return AfterSale("aktiv", hit, rest, false)
        }
        return AfterSale("aktiv", hit, priceCents, true)
    }

    /** Wie JS encodeURIComponent: UTF-8, unreservierte Zeichen bleiben, alles andere %XX (Großbuchstaben). */
    fun encodeUriComponent(s: String): String {
        val sb = StringBuilder()
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val c = b.toInt() and 0xFF
            if (c < 128 && UNRESERVED.indexOf(c.toChar()) >= 0) sb.append(c.toChar())
            else sb.append('%').append(String.format(Locale.ROOT, "%02X", c))
        }
        return sb.toString()
    }

    fun listingLink(channelId: String, cmUrl: String?, nameEn: String?, setCode: String?): String? {
        if (channelId == "cardmarket") {
            if (!cmUrl.isNullOrEmpty()) return cmUrl
            val q = listOfNotNull(nameEn?.takeIf { it.isNotEmpty() }, setCode?.takeIf { known(it) }).joinToString(" ")
            return CM_SEARCH + encodeUriComponent(q)
        }
        return LINKS[channelId]
    }

    fun channelShort(channelId: String, name: String?): String =
        FIXED_SHORT[channelId] ?: (name ?: "").trim().take(2).uppercase(Locale.ROOT).ifEmpty { "??" }

    fun rowTitle(channelId: String, title: String?, liveItems: List<Item>): String {
        if (channelId == "cardmarket") {
            val groups = groupItems(liveItems)
            if (groups.isEmpty()) return "(ohne Karten)"
            return "${groups.sumOf { it.count }}× ${cardmarketProduct(groups[0])}"
        }
        return if (title != null && title.isNotBlank()) title else "(ohne Titel)"
    }
    fun rowTitle(l: Head, liveItems: List<Item>): String = rowTitle(l.channelId, l.title, liveItems)

    fun sortListings(listings: List<Head>): List<Head> = listings.sortedWith(Comparator<Head> { a, b ->
        var c = b.listedOn.compareTo(a.listedOn)
        if (c == 0) c = (b.createdAt ?: "").compareTo(a.createdAt ?: "")
        if (c == 0) c = a.listingId.compareTo(b.listingId)
        c
    })

    fun listingMarks(
        listings: List<Head>, items: List<Item>, copyLive: (String) -> Boolean,
        saleStatusOf: (String) -> String?, suggestionOf: (String) -> Long?,
    ): Map<String, Marks> {
        val active = listings.filter { isActive(it) }.associateBy { it.listingId }
        val liveItems = items.filter { !it.deleted }
        val byCopy = HashMap<String, MutableList<String>>()
        for (item in liveItems) if (item.listingId in active) byCopy.getOrPut(item.copyId) { ArrayList() }.add(item.listingId)
        val out = LinkedHashMap<String, Marks>()
        for (l in listings) {
            val act = isActive(l)
            val also = HashSet<String>()
            var missing = false
            var sugg = 0L
            if (act) {
                for (item in liveItems) {
                    if (item.listingId != l.listingId) continue
                    for (other in byCopy[item.copyId] ?: emptyList<String>()) if (other != l.listingId) also.add(active.getValue(other).channelName)
                    if (copyLive(item.copyId)) sugg += suggestionOf(item.copyId) ?: 0L else missing = true
                }
            }
            val saleId = l.saleId
            out[l.listingId] = Marks(
                alsoOn = also.sorted(),
                missing = missing,
                underSuggestion = act && sugg > 0 && sugg * 100 >= l.priceCents * 120,
                saleCancelled = l.status == "verkauft" && saleId != null && saleStatusOf(saleId) == "storniert",
            )
        }
        return out
    }

    fun activeByCopy(listings: List<Head>, items: List<Item>): Map<String, List<Offer>> {
        val active = listings.filter { isActive(it) }.associateBy { it.listingId }
        val out = LinkedHashMap<String, MutableList<Offer>>()
        for (item in items) {
            if (item.deleted) continue
            val l = active[item.listingId] ?: continue
            out.getOrPut(item.copyId) { ArrayList() }.add(Offer(l.listingId, l.channelId, l.channelName, l.priceCents))
        }
        return out.mapValues { (_, v) -> v.sortedWith(compareBy<Offer> { it.channelName }.thenBy { it.listingId }) }
    }

    fun offeredText(offers: List<Offer>): String? =
        if (offers.isEmpty()) null
        else "angeboten auf " + offers.joinToString(", ") { "${it.channelName} für ${SalesMath.euroCentsText(it.priceCents)}" }

    fun copyBadges(offers: List<Offer>): List<String> = offers.map { channelShort(it.channelId, it.channelName) }.distinct().sorted()

    fun cleanupAfterSale(listings: List<Head>, items: List<Item>, soldCopyIds: Collection<String>, exceptListingId: String?): Cleanup {
        val sold = soldCopyIds.toSet()
        val remove = ArrayList<RemoveItem>()
        val end = ArrayList<String>()
        val remind = ArrayList<Remind>()
        for (l in listings.filter { isActive(it) && it.listingId != exceptListingId }.sortedBy { it.listingId }) {
            val live = items.filter { it.listingId == l.listingId && !it.deleted }
            val hit = live.map { it.copyId }.filter { it in sold }.sorted()
            if (hit.isEmpty()) continue
            hit.forEach { remove += RemoveItem(l.listingId, it) }
            if (hit.size == live.size) end += l.listingId
            remind += Remind(l.listingId, l.channelName, rowTitle(l, live), l.externalUrl)
        }
        return Cleanup(remove, end, remind)
    }

    fun listingsSummary(listings: List<Head>, items: List<Item>): Summary {
        val act = listings.filter { isActive(it) }
        val ids = act.map { it.listingId }.toSet()
        return Summary(act.size, items.count { !it.deleted && it.listingId in ids }, act.sumOf { it.priceCents })
    }
    fun summaryText(s: Summary): String =
        "${s.listings} ${if (s.listings == 1) "Angebot" else "Angebote"} · ${s.cards} ${if (s.cards == 1) "Karte" else "Karten"} · ${SalesMath.euroCentsText(s.priceCents)}"
    fun startText(n: Int): String = "Angebote: $n aktiv"

    fun daysSince(listedOn: String, today: String): Int =
        maxOf(0, ChronoUnit.DAYS.between(LocalDate.parse(listedOn.take(10)), LocalDate.parse(today.take(10))).toInt())
    fun sinceText(days: Int): String = if (days <= 0) "seit heute" else if (days == 1) "seit 1 Tag" else "seit $days Tagen"

    fun suggestionSum(values: List<Long?>): Long? = if (values.all { it == null }) null else values.sumOf { it ?: 0L }

    fun imageUrls(items: List<Item>): List<String> = groupItems(items).mapNotNull { g -> g.imageUrl?.takeIf { it.isNotEmpty() } }.distinct()
    fun imagesText(saved: Int, total: Int): String = when {
        total == 0 -> "Keine Bilder vorhanden."
        saved == total -> "$total ${if (total == 1) "Bild" else "Bilder"} gespeichert"
        else -> "$saved von $total Bildern gespeichert"
    }
}
```

Hinweise: `trimEnd(' ', ',', '–')` entspricht JS `.replace(/[ ,–]+$/, '')`. `lastIndexOf(' ', room)` sucht in Kotlin wie in JS rückwärts ab `room` einschließlich. `distinct()` behält die erste Reihenfolge wie die `includes`-Schleife in JS. `String.format(Locale.ROOT, "%02X", …)` schreibt Großbuchstaben wie `encodeURIComponent`.

- [ ] **Step 4: Android-Tests grün**

Run: Android-Befehl → `BUILD SUCCESSFUL`, Testzahl = Ausgang + 17, `AndroidRegexWaechterTest` grün.

- [ ] **Step 5: Schutz-Nachweise**

1. In `encodeUriComponent` die Bedingung `c < 128 && UNRESERVED.indexOf(...) >= 0` durch `c.toChar().isLetterOrDigit()` ersetzen. `links` scheitert (`'` wird `%27`, `-` wird `%2D`). Zitieren, zurücknehmen.
2. In `cleanupAfterSale` `&& it.listingId != exceptListingId` entfernen. `aufraeumen` scheitert. Zitieren, zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/ListingText.kt android/app/src/test/java/com/example/yugiohscanner/ListingTextTest.kt
git commit -m "feat(h3a): Kotlin-Zwilling ListingText gegen die gemeinsame Fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Cloud-SQL `supabase/listings_schema.sql` (nur Datei, nichts ausführen)

**Files:**
- Create: `supabase/listings_schema.sql`

**Interfaces:**
- Produces (Cloud, Namen verbindlich für Tasks 5, 9): Tabellen `public.listings` (14 Spalten) und `public.listing_items` (13 Spalten) mit genau den Spalten von `listings-schema.cjs` (Task 4), Trigger `trg_listings_updated_at`, `trg_listing_items_updated_at`, Regeln `listings_authenticated_all`, `listing_items_authenticated_all`. **Keine** Funktion.

- [ ] **Step 1: Datei schreiben**

```sql
-- supabase/listings_schema.sql — Spec H3a §4.2. Einmal im Dashboard einspielen (idempotent), BEVOR das Handy Angebote
-- nutzt; empfohlen vor dem neuen PC-Build (ohne die Tabellen protokolliert der PC-Abgleich nur für diese zwei Ströme
-- einen Fehler, alle anderen laufen weiter). Setzt voraus: public.set_updated_at() (schema.sql).
-- Einzelnutzer-Modell wie sales/card_copies: keine user_id. KEINE Datenbankfunktion (Spec §4.2): das Handy schreibt per
-- REST, "Verkauft" bucht über book_sale (sales_schema.sql). Gegenstück lokal: desktop/electron/listings-schema.cjs.

create table if not exists public.listings (
  listing_id   text primary key,
  channel_id   text not null,
  channel_name text not null,
  title        text,
  description  text,
  price        numeric(12,2) not null check (price > 0),
  status       text not null default 'aktiv' check (status in ('aktiv', 'verkauft', 'beendet')),
  listed_on    date not null,
  sale_id      text,
  external_url text,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);

create table if not exists public.listing_items (
  listing_id text not null,
  copy_id    text not null,
  card_id    text not null,
  set_code   text not null,
  language   text not null,
  rarity     text not null,
  edition    text not null,
  condition  text not null,
  name       text,
  image_url  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (listing_id, copy_id)
);

create index if not exists listings_updated_idx on public.listings (updated_at);
create index if not exists listing_items_updated_idx on public.listing_items (updated_at);
create index if not exists listing_items_copy_idx on public.listing_items (copy_id);

drop trigger if exists trg_listings_updated_at on public.listings;
create trigger trg_listings_updated_at before insert or update on public.listings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_listing_items_updated_at on public.listing_items;
create trigger trg_listing_items_updated_at before insert or update on public.listing_items
  for each row execute function public.set_updated_at();

alter table public.listings enable row level security;
alter table public.listing_items enable row level security;
drop policy if exists listings_authenticated_all on public.listings;
create policy listings_authenticated_all on public.listings for all to authenticated using (true) with check (true);
drop policy if exists listing_items_authenticated_all on public.listing_items;
create policy listing_items_authenticated_all on public.listing_items for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Selbstprüfung ohne Datenbank**

Keine Ausführung. Prüfen:
- `grep -c "create table if not exists" supabase/listings_schema.sql` → 2; `grep -c "function public\.\(listing\|book\)" supabase/listings_schema.sql` → 0 (keine neue Funktion).
- Spaltenzahlen = Prüfabfrage im Plan-Kopf: `listings` 14, `listing_items` 13; dieselben Namen und dieselbe Reihenfolge wie `LISTING_COLS`/`LISTING_ITEM_COLS` in Task 4.
- Jede Tabelle hat Trigger, RLS und Regel.

- [ ] **Step 3: Commit**

```bash
git add supabase/listings_schema.sql
git commit -m "feat(h3a): Cloud-SQL fuer Angebote (Tabellen, Trigger, RLS)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Controller nach Task 3:** Datei und Prüfabfrage dem Nutzer vorlegen. Kein Halt für die folgenden Code-Tasks.

---

### Task 4: Desktop-SQLite — Schema, Angebots-Helfer, Aufräumen in `bookSale`

**Files:**
- Create: `desktop/electron/listings-schema.cjs`, `desktop/electron/listings.cjs`, `desktop/electron/listings.test.cjs`
- Modify: `desktop/electron/sales.cjs` (`bookSale` → `bookSaleDetailed` + Hülle; CRLF-Datei)
- Modify: `desktop/electron/database.cjs` (`require` Zeile ~6, Aufruf nach `ensureSalesSchema(db);` Zeile 284)

**Interfaces:**
- Consumes: `listing-text.cjs` (Task 1), `sales-math.cjs#toCents, marketValueCents, suggestionCents, normalizeDiscount, normalizeMinPrice`, `copies.cjs#setForSale`.
- Produces:
  - `listings-schema.cjs`: `ensureListingsSchema(db)`, `LISTING_COLS` (14), `LISTING_ITEM_COLS` (13) — volle lokale Spaltenlisten, der Sync filtert Zeitstempel.
  - `listings.cjs`: `ListingError`, `hasListings(db)`, `previewListing(db, copyIds, namesOf) -> { items: [{copy_id, card_id, set_code, language, rarity, edition, condition, name, name_en, image_url, cm_url, valueCents, alsoOn}], missing: string[], rule: {discount, minCents} }`, `createListings(db, { listings: [{ channel_id, listed_on, price, title, description, external_url, note, copyIds }] }, namesOf) -> string[]`, `updateListing(db, { listing_id, price, title, description, external_url, note, removeCopyIds }) -> { ended }`, `removeListingItems(db, listingId, copyIds) -> { ended }`, `endListing(db, listingId)`, `relistPrefill(db, listingId) -> { channel_id, title, description, priceCents, copyIds }`, `applySaleToListings(db, saleId, soldCopyIds, listingId|null) -> { reminders, askAdjust, listingSkipped }`, `listingsOverview(db, { today }) -> { listings: [row + { cards, rowTitle, marketCents, days, marks }], items: [{listing_id, copy_id}], byCopy }`, `listingDetail(db, listingId, { today }) -> { listing, items: [row + { copyLive, marketCents }] }`, `listingOffers(db) -> byCopy`.
  - `namesOf(passcode) -> { de, en } | null` (main.cjs reicht den Katalog herein; Tests eine Tabelle).
  - `sales.cjs`: zusätzlich `bookSaleDetailed(db, input) -> { saleId, reminders, askAdjust, listingSkipped }`; `input.listing_id` optional. `bookSale(db, input) -> saleId` unverändert.

- [ ] **Step 1: Failing Tests schreiben**

`desktop/electron/listings.test.cjs` (echte SQLite im Speicher):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureContainersSchema } = require('./containers-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');
const copies = require('./copies.cjs');
const { ensureListingsSchema } = require('./listings-schema.cjs');
const L = require('./listings.cjs');
const S = require('./sales.cjs');

function freshDb({ listings = true } = {}) {
  const db = new Database(':memory:');
  // Wie sales.test.cjs; dazu cm_url (database.cjs legt die Spalte an, ensureCopiesSchema nicht).
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0, cm_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureContainersSchema(db);
  ensureSalesSchema(db);
  if (listings) ensureListingsSchema(db);
  return db;
}
// n Exemplare eines Drucks; Passcode `id`, Preis in Euro; extra.condition/edition fuer eigene Gruppen.
function addCard(db, id, price, n, extra = {}) {
  db.prepare(`INSERT OR IGNORE INTO cards (id, set_code, language, rarity, name, image_url, price, cm_url)
    VALUES (?, 'LOB-DE005', 'DE', 'Ultra Rare', ?, ?, ?, ?)`).run(id, `Card ${id}`, `https://img/${id}.jpg`, price, extra.cmUrl ?? null);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const copyId = `${id}-${extra.tag ?? ''}${i}`;
    db.prepare(`INSERT INTO card_copies (copy_id, card_id, set_code, language, rarity, edition, condition)
      VALUES (?, ?, 'LOB-DE005', 'DE', 'Ultra Rare', ?, ?)`).run(copyId, id, extra.edition ?? 'first', extra.condition ?? 'NM');
    ids.push(copyId);
  }
  return ids;
}
const NAMES = (id) => (id === '1' ? { de: 'Dunkler Magier', en: 'Dark Magician' } : null);
const base = (over) => ({ channel_id: 'ebay', listed_on: '2026-09-21', price: 12, title: 'T', description: 'D', external_url: null, note: null, ...over });
const sale = { channel_id: 'ebay', sold_on: '2026-09-21', gross: 10, fees: null, shipping: null, note: null };
const listing = (db, id) => db.prepare('SELECT * FROM listings WHERE listing_id = ?').get(id);
const liveItems = (db, id) => db.prepare('SELECT copy_id FROM listing_items WHERE listing_id = ? AND deleted = 0 ORDER BY copy_id').all(id).map((r) => r.copy_id);

test('Anlegen: Momentaufnahme mit deutschem Namen, for_sale = 1, Kanalname eingefroren', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const [id] = L.createListings(db, { listings: [base({ copyIds: [b, a] })] }, NAMES);
  const l = listing(db, id);
  assert.deepEqual([l.channel_id, l.channel_name, l.price, l.status, l.title], ['ebay', 'eBay', 12, 'aktiv', 'T']);
  const items = db.prepare('SELECT * FROM listing_items WHERE listing_id = ? ORDER BY copy_id').all(id);
  assert.deepEqual(items.map((i) => [i.copy_id, i.name, i.image_url, i.edition]), [[a, 'Dunkler Magier', 'https://img/1.jpg', 'first'], [b, 'Dunkler Magier', 'https://img/1.jpg', 'first']]);
  assert.deepEqual(db.prepare('SELECT for_sale FROM card_copies ORDER BY copy_id').all().map((r) => r.for_sale), [1, 1]);
});

test('Prüfungen §5.7: nichts halb angelegt', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const [b] = addCard(db, '2', 1, 1);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [] })] }), /Mindestens eine Karte/);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a], price: 0 })] }), /über 0 €/);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a], price: 0.004 })] }), /über 0 €/);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a], listed_on: '21.09.2026' })] }), /Datum/);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a], external_url: 'ftp://x' })] }), /Link/);
  const own = S.saveChannel(db, { name: 'Flohmarkt', fee_percent: 0 });
  S.hideChannel(db, own);
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a], channel_id: own })] }), /Kanal/);
  S.bookSale(db, { ...sale, copyIds: [b] });
  // Zwei Angebote in einem Aufruf, das zweite scheitert: auch das erste entsteht nicht.
  assert.throws(() => L.createListings(db, { listings: [base({ copyIds: [a] }), base({ copyIds: [b] })] }), /bereits verkauft/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM listings').get().n, 0);
  assert.equal(db.prepare('SELECT for_sale FROM card_copies WHERE copy_id = ?').get(a).for_sale, 0);
});

test('Cardmarket: genau eine Gruppe, Aufteilung als mehrere Angebote in einem Aufruf, ohne Titel/Text', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const [e] = addCard(db, '1', 3, 1, { condition: 'EX', tag: 'x' });
  assert.throws(() => L.createListings(db, { listings: [base({ channel_id: 'cardmarket', copyIds: [a, e] })] }), /nur gleiche Karten/);
  const ids = L.createListings(db, { listings: [base({ channel_id: 'cardmarket', copyIds: [a] }), base({ channel_id: 'cardmarket', copyIds: [e], price: 2.5 })] });
  assert.equal(ids.length, 2);
  assert.deepEqual([listing(db, ids[0]).title, listing(db, ids[0]).description, listing(db, ids[1]).price], [null, null, 2.5]);
});

test('Vorschau: Namen, cm_url, Marktwert, "auch auf", fehlende Exemplare', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2, { cmUrl: 'https://www.cardmarket.com/x' });
  L.createListings(db, { listings: [base({ copyIds: [a] })] });
  S.bookSale(db, { ...sale, copyIds: [b] });
  const pv = L.previewListing(db, [b, a], NAMES);
  assert.deepEqual(pv.missing, [b]);
  assert.deepEqual(pv.items.map((i) => [i.copy_id, i.name, i.name_en, i.cm_url, i.valueCents, i.alsoOn]),
    [[a, 'Dunkler Magier', 'Dark Magician', 'https://www.cardmarket.com/x', 300, ['eBay']]]);
  assert.deepEqual(pv.rule, { discount: 5, minCents: 10 });
});

test('Verkauft ganz: Status verkauft, sale_id gesetzt, Positionen bleiben', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const [id] = L.createListings(db, { listings: [base({ copyIds: [a, b] })] });
  const r = S.bookSaleDetailed(db, { ...sale, gross: 12, copyIds: [a, b], listing_id: id });
  assert.deepEqual([listing(db, id).status, listing(db, id).sale_id], ['verkauft', r.saleId]);
  assert.deepEqual(liveItems(db, id), [a, b]);
  assert.deepEqual([r.reminders, r.askAdjust, r.listingSkipped], [[], false, false]);
});

test('Teilverkauf Cardmarket: Stückpreis x Rest; anderer Kanal: Preis bleibt, Hinweis', () => {
  const db = freshDb();
  const cm3 = addCard(db, '1', 3, 3);
  const [cm] = L.createListings(db, { listings: [base({ channel_id: 'cardmarket', copyIds: cm3, price: 10 })] });
  const r1 = S.bookSaleDetailed(db, { ...sale, gross: 3.33, copyIds: [cm3[0]], listing_id: cm });
  assert.deepEqual([listing(db, cm).status, listing(db, cm).price, listing(db, cm).sale_id, r1.askAdjust], ['aktiv', 6.66, null, false]);
  assert.deepEqual(liveItems(db, cm), [cm3[1], cm3[2]]);
  const eb = addCard(db, '2', 1, 2);
  const [e] = L.createListings(db, { listings: [base({ copyIds: eb })] });
  const r2 = S.bookSaleDetailed(db, { ...sale, copyIds: [eb[1]], listing_id: e });
  assert.deepEqual([listing(db, e).status, listing(db, e).price, r2.askAdjust], ['aktiv', 12, true]);
  assert.deepEqual(liveItems(db, e), [eb[0]]);
});

test('Aufräumen in derselben Transaktion -- auch bei Buchung ohne Angebot', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const [e] = L.createListings(db, { listings: [base({ copyIds: [a, b], external_url: 'https://www.ebay.de/itm/1' })] });
  const [k] = L.createListings(db, { listings: [base({ channel_id: 'kleinanzeigen', copyIds: [a], title: 'Magier' })] });
  const r = S.bookSaleDetailed(db, { ...sale, copyIds: [a] });
  assert.deepEqual(liveItems(db, e), [b]);
  assert.deepEqual([listing(db, e).status, listing(db, k).status], ['aktiv', 'beendet']);
  assert.deepEqual(r.reminders.map((x) => [x.channel_name, x.title, x.external_url]).sort(),
    [['Kleinanzeigen', 'Magier', null], ['eBay', 'T', 'https://www.ebay.de/itm/1']]);
  // Scheitert die Buchung, bleibt auch das Aufraeumen aus (eine Transaktion).
  const [c] = addCard(db, '2', 1, 1);
  L.createListings(db, { listings: [base({ copyIds: [c] })] });
  assert.throws(() => S.bookSaleDetailed(db, { ...sale, copyIds: [c, a] }), /bereits verkauft/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM listing_items WHERE copy_id = ? AND deleted = 0").get(c).n, 1);
});

test('Angebot inzwischen beendet: Verkauf gilt, nur aufgeräumt', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const [id] = L.createListings(db, { listings: [base({ copyIds: [a] })] });
  L.endListing(db, id);
  const r = S.bookSaleDetailed(db, { ...sale, copyIds: [a], listing_id: id });
  assert.equal(r.listingSkipped, true);
  assert.equal(listing(db, id).status, 'beendet');
  assert.equal(db.prepare('SELECT deleted FROM card_copies WHERE copy_id = ?').get(a).deleted, 1);
});

test('Beenden: Positionen und for_sale bleiben, danach nicht mehr bearbeitbar', () => {
  const db = freshDb();
  const [a] = addCard(db, '1', 3, 1);
  const [id] = L.createListings(db, { listings: [base({ copyIds: [a] })] });
  L.endListing(db, id);
  assert.equal(listing(db, id).status, 'beendet');
  assert.deepEqual(liveItems(db, id), [a]);
  assert.equal(db.prepare('SELECT for_sale FROM card_copies WHERE copy_id = ?').get(a).for_sale, 1);
  assert.throws(() => L.updateListing(db, { listing_id: id, price: 5 }), /Nur aktive/);
});

test('Bearbeiten: Preis/Link, Position herausnehmen, letzte Position -> beendet', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const [id] = L.createListings(db, { listings: [base({ copyIds: [a, b] })] });
  assert.deepEqual(L.updateListing(db, { listing_id: id, price: '9.5', title: 'Neu', description: '', external_url: 'https://x', note: ' ', removeCopyIds: [a] }), { ended: false });
  const l = listing(db, id);
  assert.deepEqual([l.price, l.title, l.description, l.external_url, l.note], [9.5, 'Neu', null, 'https://x', null]);
  assert.throws(() => L.updateListing(db, { listing_id: id, price: 0 }), /über 0 €/);
  assert.deepEqual(L.removeListingItems(db, id, [b]), { ended: true });
  assert.equal(listing(db, id).status, 'beendet');
});

test('Karte fehlt, Storno-Marke, Erneut anbieten, Übersicht', () => {
  const db = freshDb();
  const [a, b] = addCard(db, '1', 3, 2);
  const [k] = L.createListings(db, { listings: [base({ channel_id: 'kleinanzeigen', copyIds: [a], title: 'K' })] });
  const [e] = L.createListings(db, { listings: [base({ copyIds: [b], price: 2 })] });
  copies.deleteCopy(db, { copy_id: a }); // anderes Geraet hat geloescht
  const r = S.bookSaleDetailed(db, { ...sale, copyIds: [b], listing_id: e });
  S.cancelSale(db, r.saleId);
  const ov = L.listingsOverview(db, { today: '2026-09-23' });
  const row = (id) => ov.listings.find((x) => x.listing_id === id);
  assert.equal(row(k).marks.missing, true);
  assert.equal(row(e).marks.saleCancelled, true);
  assert.deepEqual([row(e).status, row(k).days, row(k).rowTitle, row(k).cards], ['verkauft', 2, 'K', 1]);
  assert.deepEqual(L.relistPrefill(db, e), { channel_id: 'ebay', title: 'T', description: 'D', priceCents: 200, copyIds: [b] });
  assert.deepEqual(L.relistPrefill(db, k).copyIds, []);
  assert.deepEqual(L.listingOffers(db), { [a]: [{ listing_id: k, channel_id: 'kleinanzeigen', channel_name: 'Kleinanzeigen', priceCents: 1200 }] });
  const d = L.listingDetail(db, k, { today: '2026-09-23' });
  assert.deepEqual(d.items.map((i) => [i.copy_id, i.copyLive, i.marketCents]), [[a, false, null]]);
  assert.deepEqual(L.removeListingItems(db, k, [a]), { ended: true });
});

test('Ohne Angebots-Tabellen bucht bookSale wie bisher', () => {
  const db = freshDb({ listings: false });
  const [a] = addCard(db, '1', 3, 1);
  assert.equal(typeof S.bookSale(db, { ...sale, copyIds: [a] }), 'string');
  assert.deepEqual(L.listingOffers(db), {});
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: SQLite-Suite. Expected: FAIL `Cannot find module './listings-schema.cjs'`.

- [ ] **Step 3: `listings-schema.cjs` schreiben und einhängen**

```js
// desktop/electron/listings-schema.cjs — Spec H3a §4.1. Gegenstueck zu supabase/listings_schema.sql.
// Zeitstempel-Trigger wie trg_sales_updated (sales-schema.cjs): ohne sie saehe der Push (updated_at > cursor) nichts.
// Keine Aenderung an card_copies.
const LISTING_COLS = ['listing_id', 'channel_id', 'channel_name', 'title', 'description', 'price', 'status', 'listed_on', 'sale_id',
  'external_url', 'note', 'created_at', 'updated_at', 'deleted'];
const LISTING_ITEM_COLS = ['listing_id', 'copy_id', 'card_id', 'set_code', 'language', 'rarity', 'edition', 'condition', 'name',
  'image_url', 'created_at', 'updated_at', 'deleted'];

function ensureListingsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      listing_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, channel_name TEXT NOT NULL, title TEXT, description TEXT,
      price REAL NOT NULL CHECK (price > 0),
      status TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','verkauft','beendet')),
      listed_on TEXT NOT NULL, sale_id TEXT, external_url TEXT, note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS listing_items (
      listing_id TEXT NOT NULL, copy_id TEXT NOT NULL,
      card_id TEXT NOT NULL, set_code TEXT NOT NULL, language TEXT NOT NULL, rarity TEXT NOT NULL,
      edition TEXT NOT NULL, condition TEXT NOT NULL, name TEXT, image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (listing_id, copy_id));
    CREATE INDEX IF NOT EXISTS listings_updated_idx ON listings (updated_at);
    CREATE INDEX IF NOT EXISTS listing_items_updated_idx ON listing_items (updated_at);
    CREATE INDEX IF NOT EXISTS listing_items_copy_idx ON listing_items (copy_id);
    CREATE TRIGGER IF NOT EXISTS trg_listings_updated AFTER UPDATE ON listings FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE listings SET updated_at = CURRENT_TIMESTAMP WHERE listing_id = NEW.listing_id; END;
    CREATE TRIGGER IF NOT EXISTS trg_listing_items_updated AFTER UPDATE ON listing_items FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE listing_items SET updated_at = CURRENT_TIMESTAMP WHERE listing_id = NEW.listing_id AND copy_id = NEW.copy_id; END;
  `);
}

module.exports = { ensureListingsSchema, LISTING_COLS, LISTING_ITEM_COLS };
```

In `database.cjs` neben den anderen `require`s `const { ensureListingsSchema } = require('./listings-schema.cjs');` ergänzen und direkt nach `ensureSalesSchema(db);    // Spec H2: Verkaeufe` die Zeile `ensureListingsSchema(db); // Spec H3a: Angebote` einfügen.

- [ ] **Step 4: `listings.cjs` schreiben**

```js
// desktop/electron/listings.cjs — Spec H3a §5–§8: Angebote anlegen, bearbeiten, Positionen herausnehmen, beenden,
// erneut anbieten, lesen, nach einem Verkauf aufraeumen. Regeln ausschliesslich aus listing-text.cjs (Zwilling).
// Jede Schreibaktion ist EINE Transaktion; applySaleToListings laeuft INNERHALB der bookSale-Transaktion (sales.cjs).
const crypto = require('crypto');
const M = require('./sales-math.cjs');
const T = require('./listing-text.cjs');
const copies = require('./copies.cjs');

class ListingError extends Error {}

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const URL_OK = /^https?:\/\//i;
const blank = (v) => v == null || String(v).trim() === '';
const textOrNull = (v) => (blank(v) ? null : String(v).trim());

// H2-Test-Datenbanken (sales.test.cjs) und Datenbanken vor H3a haben keine Angebots-Tabellen: nichts aufzuraeumen.
function hasListings(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'listings'").get();
}

function getSetting(db, key) {
  try { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return r ? r.value : null; }
  catch { return null; }
}
// Spec H2 §9: Preisvorschlag-Regel aus den Einstellungen (gleiche Normalisierung wie collection-export.cjs).
function suggestionRule(db) {
  return { discount: M.normalizeDiscount(getSetting(db, 'sale_discount_percent')), minCents: M.normalizeMinPrice(getSetting(db, 'sale_min_price')) };
}

// Lebende, unverkaufte Exemplare mit Kartendaten, ausgeschriebene Spalten wie sales.cjs#liveCopies, dazu cm_url.
const LIVE_COPY_SQL = `
  SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition,
         c.name AS card_name, c.image_url, c.price, c.price_first_ed, c.cm_url
    FROM card_copies cp
    LEFT JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
   WHERE cp.copy_id = ? AND cp.deleted = 0 AND cp.sold_in IS NULL`;

// Anzeigename = deutscher Katalogname, sonst cards.name (der englisch ist, main.cjs#withGermanNames). Englischer Name
// fuer die Cardmarket-Suche = Katalog name_en, sonst cards.name. namesOf(passcode) -> { de, en } | null.
function withNames(r, namesOf) {
  const n = namesOf(String(r.card_id)) || {};
  return { ...r, card_id: String(r.card_id), name: n.de || r.card_name || null, name_en: n.en || r.card_name || null };
}

function activeChannelsOf(db, copyId) {
  return db.prepare(`SELECT DISTINCT l.channel_name FROM listing_items li JOIN listings l ON l.listing_id = li.listing_id
     WHERE li.copy_id = ? AND li.deleted = 0 AND l.status = 'aktiv' AND l.deleted = 0 ORDER BY l.channel_name`).all(copyId)
    .map((r) => r.channel_name);
}

// Spec §5.2/§5.7 -- Vorschau fuer den Dialog: lebende, unverkaufte Exemplare (nach copy_id) mit Namen, Bild, cm_url,
// Marktwert (Cent) und "auch auf" (Kanaele aktiver Angebote); missing = die uebrigen copy_ids; rule = Vorschlagsregel.
function previewListing(db, copyIds, namesOf = () => null) {
  const q = db.prepare(LIVE_COPY_SQL);
  const items = [];
  const missing = [];
  for (const id of [...new Set(Array.isArray(copyIds) ? copyIds : [])].sort()) {
    const r = q.get(id);
    if (!r) { missing.push(id); continue; }
    const x = withNames(r, namesOf);
    items.push({ copy_id: x.copy_id, card_id: x.card_id, set_code: x.set_code, language: x.language, rarity: x.rarity,
      edition: x.edition, condition: x.condition, name: x.name, name_en: x.name_en, image_url: x.image_url ?? null,
      cm_url: x.cm_url ?? null, valueCents: M.marketValueCents(x, x), alsoOn: activeChannelsOf(db, id) });
  }
  return { items, missing, rule: suggestionRule(db) };
}

function checkFields(l) {
  if (!DATE.test(String(l.listed_on || ''))) throw new ListingError('Ungültiges Datum.');
  const cents = blank(l.price) ? null : M.toCents(l.price);
  if (cents == null || cents <= 0) throw new ListingError('Der Angebotspreis muss über 0 € liegen.');
  if (!blank(l.external_url) && !URL_OK.test(String(l.external_url).trim())) {
    throw new ListingError('Der Link muss mit http:// oder https:// beginnen.');
  }
  return cents;
}

function createOne(db, l, namesOf) {
  const copyIds = [...new Set(Array.isArray(l.copyIds) ? l.copyIds : [])].sort();
  if (copyIds.length === 0) throw new ListingError('Mindestens eine Karte auswählen.');
  const cents = checkFields(l);
  const ch = db.prepare('SELECT channel_id, name FROM sale_channels WHERE channel_id = ? AND deleted = 0').get(l.channel_id);
  if (!ch) throw new ListingError('Kanal nicht gefunden.');
  const q = db.prepare(LIVE_COPY_SQL);
  const rows = copyIds.map((id) => q.get(id));
  if (rows.some((r) => !r)) throw new ListingError('Karte bereits verkauft oder gelöscht.');
  const items = rows.map((r) => withNames(r, namesOf));
  const cm = ch.channel_id === 'cardmarket';
  if (cm && T.groupItems(items).length !== 1) {
    throw new ListingError('Ein Cardmarket-Angebot enthält nur gleiche Karten (Druck, Sprache, Zustand, Auflage).');
  }
  const listingId = crypto.randomUUID();
  db.prepare(`INSERT INTO listings (listing_id, channel_id, channel_name, title, description, price, listed_on, external_url, note)
    VALUES (@listing_id, @channel_id, @channel_name, @title, @description, @price, @listed_on, @external_url, @note)`).run({
    listing_id: listingId, channel_id: ch.channel_id, channel_name: ch.name,
    title: cm ? null : textOrNull(l.title), description: cm ? null : textOrNull(l.description),
    price: cents / 100, listed_on: l.listed_on, external_url: textOrNull(l.external_url), note: textOrNull(l.note),
  });
  const ins = db.prepare(`INSERT INTO listing_items (listing_id, copy_id, card_id, set_code, language, rarity, edition, condition, name, image_url)
    VALUES (@listing_id, @copy_id, @card_id, @set_code, @language, @rarity, @edition, @condition, @name, @image_url)`);
  for (const it of items) {
    ins.run({ listing_id: listingId, copy_id: it.copy_id, card_id: it.card_id, set_code: it.set_code, language: it.language,
      rarity: it.rarity, edition: it.edition, condition: it.condition, name: it.name, image_url: it.image_url ?? null });
  }
  copies.setForSale(db, { copyIds, value: true }); // Spec §5.2: Anlegen setzt for_sale = 1 (H1), idempotent
  return listingId;
}

// Spec §5.2/§5.4 -- ein oder mehrere Angebote (Cardmarket-Aufteilung) in EINER Transaktion: scheitert eines, entsteht keines.
function createListings(db, input = {}, namesOf = () => null) {
  const list = Array.isArray(input.listings) ? input.listings : [];
  if (list.length === 0) throw new ListingError('Mindestens eine Karte auswählen.');
  const ids = [];
  db.transaction(() => { for (const l of list) ids.push(createOne(db, l || {}, namesOf)); })();
  return ids;
}

function getListing(db, listingId) {
  const l = db.prepare('SELECT * FROM listings WHERE listing_id = ? AND deleted = 0').get(listingId);
  if (!l) throw new ListingError('Angebot nicht gefunden.');
  return l;
}
function activeListing(db, listingId) {
  const l = getListing(db, listingId);
  if (l.status !== 'aktiv') throw new ListingError('Nur aktive Angebote lassen sich ändern.');
  return l;
}

// Positionen herausnehmen; bleibt keine lebende Position, endet das Angebot (Spec §8). -> true, wenn es endete.
function removeItemsIn(db, listingId, copyIds) {
  const upd = db.prepare('UPDATE listing_items SET deleted = 1 WHERE listing_id = ? AND copy_id = ? AND deleted = 0');
  for (const id of new Set(Array.isArray(copyIds) ? copyIds : [])) upd.run(listingId, id);
  const left = db.prepare('SELECT COUNT(*) AS n FROM listing_items WHERE listing_id = ? AND deleted = 0').get(listingId).n;
  if (left > 0) return false;
  db.prepare("UPDATE listings SET status = 'beendet' WHERE listing_id = ? AND status = 'aktiv'").run(listingId);
  return true;
}

// Spec §6 Bearbeiten: Preis, Titel, Text, Link, Notiz; Positionen herausnehmen; keine Karten hinzufuegen.
function updateListing(db, input = {}) {
  let ended = false;
  db.transaction(() => {
    const l = activeListing(db, input.listing_id);
    const cents = checkFields({ ...input, listed_on: l.listed_on });
    const cm = l.channel_id === 'cardmarket';
    db.prepare(`UPDATE listings SET price = @price, title = @title, description = @description, external_url = @external_url,
      note = @note WHERE listing_id = @listing_id`).run({
      listing_id: l.listing_id, price: cents / 100, title: cm ? null : textOrNull(input.title),
      description: cm ? null : textOrNull(input.description), external_url: textOrNull(input.external_url), note: textOrNull(input.note),
    });
    ended = removeItemsIn(db, l.listing_id, input.removeCopyIds);
  })();
  return { ended };
}

// Spec §8 "Karte fehlt": Antippen nimmt die Position heraus, leeres Angebot -> beendet.
function removeListingItems(db, listingId, copyIds) {
  let ended = false;
  db.transaction(() => { activeListing(db, listingId); ended = removeItemsIn(db, listingId, copyIds); })();
  return { ended };
}

// Spec §7.3: status = beendet; Positionen und for_sale bleiben. Schon beendet/verkauft: nichts zu tun.
function endListing(db, listingId) {
  db.transaction(() => {
    getListing(db, listingId);
    db.prepare("UPDATE listings SET status = 'beendet' WHERE listing_id = ? AND status = 'aktiv'").run(listingId);
  })();
}

// Spec §7.4: Vorbelegung fuer ein neues Angebot -- Kanal, Titel, Beschreibung, Preis und die noch lebenden,
// unverkauften Exemplare der lebenden Positionen des alten.
function relistPrefill(db, listingId) {
  const l = getListing(db, listingId);
  const copyIds = db.prepare(`SELECT li.copy_id FROM listing_items li JOIN card_copies cp ON cp.copy_id = li.copy_id
     WHERE li.listing_id = ? AND li.deleted = 0 AND cp.deleted = 0 AND cp.sold_in IS NULL ORDER BY li.copy_id`).all(listingId)
    .map((r) => r.copy_id);
  return { channel_id: l.channel_id, title: l.title, description: l.description, priceCents: M.toCents(l.price), copyIds };
}

// Spec §7.1/§7.2 -- INNERHALB der bookSale-Transaktion: das Angebot, aus dem verkauft wurde (listingId), wird verkauft
// oder teilweise verkauft; danach werden die verkauften Exemplare aus allen ANDEREN aktiven Angeboten genommen.
// Ist das Angebot nicht mehr aktiv (anderes Geraet), bleibt der Verkauf gueltig und es wird nur aufgeraeumt
// (listingSkipped) -- wie am Handy, wo book_sale vor dem Angebot geschrieben wird.
function applySaleToListings(db, saleId, soldCopyIds, listingId = null) {
  const out = { reminders: [], askAdjust: false, listingSkipped: false };
  if (!hasListings(db)) return out;
  if (listingId) {
    const l = db.prepare('SELECT * FROM listings WHERE listing_id = ? AND deleted = 0').get(listingId);
    if (!l || l.status !== 'aktiv') {
      out.listingSkipped = true;
    } else {
      const live = db.prepare('SELECT copy_id FROM listing_items WHERE listing_id = ? AND deleted = 0 ORDER BY copy_id')
        .all(listingId).map((r) => r.copy_id);
      const r = T.afterListingSale(l, live, soldCopyIds);
      if (r.status === 'verkauft') {
        db.prepare("UPDATE listings SET status = 'verkauft', sale_id = ? WHERE listing_id = ?").run(saleId, listingId);
      } else {
        const del = db.prepare('UPDATE listing_items SET deleted = 1 WHERE listing_id = ? AND copy_id = ?');
        for (const id of r.removeCopyIds) del.run(listingId, id);
        if (r.priceCents !== M.toCents(l.price)) db.prepare('UPDATE listings SET price = ? WHERE listing_id = ?').run(r.priceCents / 100, listingId);
      }
      out.askAdjust = r.askAdjust;
    }
  }
  const listings = db.prepare('SELECT * FROM listings WHERE deleted = 0').all();
  const items = db.prepare('SELECT * FROM listing_items WHERE deleted = 0').all();
  const c = T.cleanupAfterSale(listings, items, soldCopyIds, out.listingSkipped ? null : listingId);
  const del = db.prepare('UPDATE listing_items SET deleted = 1 WHERE listing_id = ? AND copy_id = ?');
  for (const it of c.removeItems) del.run(it.listing_id, it.copy_id);
  const end = db.prepare("UPDATE listings SET status = 'beendet' WHERE listing_id = ? AND status = 'aktiv'");
  for (const id of c.endListings) end.run(id);
  out.reminders = c.remind;
  return out;
}

// Spec §6 -- Uebersicht: alle nicht geloeschten Angebote in Anzeige-Reihenfolge mit Zeilentitel, Kartenzahl, heutigem
// Marktwert (lebende Positionen mit lebendem Exemplar, aktueller Zustand/Auflage des Exemplars), Tagen und Marken;
// items (lebende Positionen) fuer den Kopf, byCopy fuer die Kanal-Kuerzel.
function listingsOverview(db, { today } = {}) {
  const listings = T.sortListings(db.prepare('SELECT * FROM listings WHERE deleted = 0').all());
  const items = db.prepare('SELECT * FROM listing_items WHERE deleted = 0 ORDER BY listing_id, copy_id').all();
  const copyRows = new Map(db.prepare(`
    SELECT cp.copy_id, cp.edition, cp.condition, c.price, c.price_first_ed FROM card_copies cp
      LEFT JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
     WHERE cp.deleted = 0 AND cp.sold_in IS NULL
       AND cp.copy_id IN (SELECT copy_id FROM listing_items WHERE deleted = 0)`).all().map((r) => [r.copy_id, r]));
  const saleStatus = new Map(db.prepare('SELECT sale_id, status FROM sales WHERE deleted = 0').all().map((s) => [s.sale_id, s.status]));
  const rule = suggestionRule(db);
  const valueOf = (id) => { const r = copyRows.get(id); return r ? M.marketValueCents(r, r) : null; };
  const suggestionOf = (id) => { const v = valueOf(id); return v == null ? null : M.suggestionCents(v, rule.discount, rule.minCents); };
  const marks = T.listingMarks(listings, items, (id) => copyRows.has(id), (sid) => saleStatus.get(sid) ?? null, suggestionOf);
  const rows = listings.map((l) => {
    const live = items.filter((it) => it.listing_id === l.listing_id);
    return { ...l, cards: live.length, rowTitle: T.rowTitle(l, live), marketCents: live.reduce((a, it) => a + (valueOf(it.copy_id) ?? 0), 0),
      days: today ? T.daysSince(l.listed_on, today) : 0, marks: marks[l.listing_id] };
  });
  return { listings: rows, items: items.map(({ listing_id, copy_id }) => ({ listing_id, copy_id })), byCopy: T.activeByCopy(listings, items) };
}

// Detail: Zeile wie in der Uebersicht plus lebende Positionen mit Bild, Druck, heutigem Marktwert und copyLive.
function listingDetail(db, listingId, { today } = {}) {
  getListing(db, listingId);
  const listing = listingsOverview(db, { today }).listings.find((l) => l.listing_id === listingId);
  const items = db.prepare(`
    SELECT li.*, (cp.copy_id IS NOT NULL) AS copy_live, cp.edition AS copy_edition, cp.condition AS copy_condition,
           c.price, c.price_first_ed
      FROM listing_items li
      LEFT JOIN card_copies cp ON cp.copy_id = li.copy_id AND cp.deleted = 0 AND cp.sold_in IS NULL
      LEFT JOIN cards c ON c.id = li.card_id AND c.set_code = li.set_code AND c.language = li.language AND c.rarity = li.rarity
     WHERE li.listing_id = ? AND li.deleted = 0 ORDER BY li.copy_id`).all(listingId).map((it) => {
    const { copy_live, copy_edition, copy_condition, price, price_first_ed, ...rest } = it;
    const copyLive = !!copy_live;
    return { ...rest, copyLive,
      marketCents: copyLive ? M.marketValueCents({ price, price_first_ed }, { edition: copy_edition, condition: copy_condition }) : null };
  });
  return { listing, items };
}

// Kanal-Kuerzel/"angeboten auf" je Exemplar (Verkaufsliste, Kartenansicht).
function listingOffers(db) {
  if (!hasListings(db)) return {};
  return T.activeByCopy(db.prepare('SELECT * FROM listings WHERE deleted = 0').all(),
    db.prepare('SELECT * FROM listing_items WHERE deleted = 0').all());
}

module.exports = {
  ListingError, hasListings, previewListing, createListings, updateListing, removeListingItems, endListing, relistPrefill,
  applySaleToListings, listingsOverview, listingDetail, listingOffers,
};
```

- [ ] **Step 5: `sales.cjs` — Aufräumen in derselben Transaktion**

1. Unter `const M = require('./sales-math.cjs');` einfügen: `const listings = require('./listings.cjs');` (kein Kreis: `listings.cjs` lädt `sales.cjs` nicht).
2. `function bookSale(db, input = {}) {` umbenennen in `function bookSaleDetailed(db, input = {}) {`.
3. Direkt nach `const saleId = crypto.randomUUID();` die Zeile `let after = null;` einfügen.
4. Innerhalb von `db.transaction(() => { … })`, direkt nach dem `rows.forEach(…)`-Block (nach `sell.run(saleId, r.copy_id);` und `});`), einfügen:

```js
    // Spec H3a §7.2: Aufraeumen in DERSELBEN Transaktion -- auch bei einer Buchung ohne Angebot.
    after = listings.applySaleToListings(db, saleId, rows.map((r) => r.copy_id), input.listing_id || null);
```

5. `return saleId;` am Ende von `bookSaleDetailed` ersetzen durch `return { saleId, ...after };` und darunter die Hülle ergänzen:

```js
function bookSale(db, input = {}) {
  return bookSaleDetailed(db, input).saleId;
}
```

6. `module.exports` um `bookSaleDetailed` erweitern (nach `bookSale`).

Die Datei hat CRLF-Zeilenenden; die Edits übernehmen sie.

- [ ] **Step 6: Tests grün**

Run: SQLite-Suite → alle bisherigen (inkl. `sales.test.cjs` unverändert) + 12 neue grün.

- [ ] **Step 7: Schutz-Nachweise**

1. In `bookSaleDetailed` den `applySaleToListings`-Aufruf per Edit vor `db.transaction(` ziehen (mit `ids` statt `rows.map(…)`). „Aufräumen in derselben Transaktion“ scheitert beim zweiten Teil (die Position von `c` ist trotz gescheiterter Buchung herausgenommen). Zitieren, zurücknehmen.
2. In `createListings` `db.transaction(() => { … })()` durch einen direkten Schleifenlauf ersetzen. „Prüfungen §5.7“ scheitert (`1` Angebot statt `0`). Zitieren, zurücknehmen.
3. In `hasListings` immer `true` zurückgeben. „Ohne Angebots-Tabellen bucht bookSale wie bisher“ scheitert (`no such table: listings`). Zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/listings-schema.cjs desktop/electron/listings.cjs desktop/electron/listings.test.cjs desktop/electron/sales.cjs desktop/electron/database.cjs
git commit -m "feat(h3a): SQLite-Schema und Angebots-Helfer; Aufraeumen in derselben Transaktion wie bookSale

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Desktop-Sync — zwei Ströme `listings`, `listing_items`

**Files:**
- Modify: `desktop/electron/sync.cjs`
- Create: `desktop/electron/listings-sync.test.cjs`

**Interfaces:**
- Consumes: `LISTING_COLS, LISTING_ITEM_COLS` (Task 4).
- Produces: in `module.exports` zusätzlich `listingToRemote, remoteToLocalListing, listingItemToRemote, remoteToLocalListingItem`, Test-Haken `_applyPulledListings, _applyPulledListingItems, _recentlyPushedListings, _recentlyPushedListingItems` (`_salesPushRows(db, table, cursor)` gilt für jede Tabelle in `SALES_STREAMS`). Renderer-Ereignis `listings-changed`. Zeiger `sync_listings_last_pull/_last_push`, `sync_listing_items_last_pull/_last_push`.

- [ ] **Step 1: Failing Tests**

`desktop/electron/listings-sync.test.cjs` (gebaut wie `sales-sync.test.cjs`):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const Sync = require('./sync.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');
const { ensureListingsSchema } = require('./listings-schema.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db);
  ensureSalesSchema(db);
  ensureListingsSchema(db);
  return db;
}
// So liefert PostgREST: numeric als Text, date als 'YYYY-MM-DD', timestamptz mit Zone.
const LISTING = { listing_id: 'l1', channel_id: 'ebay', channel_name: 'eBay', title: 'T', description: null, price: '12.50', status: 'aktiv',
  listed_on: '2026-09-21', sale_id: null, external_url: null, note: null, created_at: '2026-09-21T10:00:00+00:00',
  updated_at: '2026-09-21T10:00:01.5+00:00', deleted: false };
const ITEM = { listing_id: 'l1', copy_id: 'c1', card_id: '1', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ultra Rare', edition: 'first',
  condition: 'NM', name: 'Dunkler Magier', image_url: null, created_at: '2026-09-21T10:00:00+00:00', updated_at: '2026-09-21T10:00:01.5+00:00', deleted: false };

test('Abbildung: Preis als Zahl, Datum als Text, Booleans, keine Zeitstempel', () => {
  const l = Sync.remoteToLocalListing(LISTING);
  assert.equal(l.price, 12.5);
  assert.equal(l.listed_on, '2026-09-21');
  assert.equal(l.deleted, 0);
  assert.ok(!('updated_at' in l) && !('created_at' in l));
  const r = Sync.listingToRemote({ ...LISTING, price: 12.5, deleted: 1, updated_at: 'x', created_at: 'y' });
  assert.equal(r.deleted, true);
  assert.ok(!('updated_at' in r) && !('created_at' in r));
  assert.equal(Sync.listingItemToRemote({ ...ITEM, deleted: 0 }).deleted, false);
  assert.equal(Sync.remoteToLocalListingItem({ ...ITEM, deleted: true }).deleted, 1);
});

test('Pull legt Angebot und Position an, Echo wird übersprungen', () => {
  const db = freshDb();
  Sync._recentlyPushedListings.clear(); Sync._recentlyPushedListingItems.clear();
  assert.equal(Sync._applyPulledListings(db, [LISTING]), 1);
  assert.equal(Sync._applyPulledListingItems(db, [ITEM]), 1);
  assert.equal(db.prepare('SELECT price FROM listings').get().price, 12.5);
  Sync._recentlyPushedListings.set('l1', LISTING.updated_at);
  assert.equal(Sync._applyPulledListings(db, [LISTING]), 0, 'Echo');
  Sync._recentlyPushedListingItems.set('l1|c1', ITEM.updated_at);
  assert.equal(Sync._applyPulledListingItems(db, [ITEM]), 0, 'Echo Position');
});

test('Gezogene Zeilen werden nicht zurückgeschoben (Fix I2), auch nicht nach einer Änderung', () => {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_listings_last_push', '2026-09-20T00:00:00Z'), ('sync_listing_items_last_push', '2026-09-20T00:00:00Z')").run();
  Sync._recentlyPushedListings.clear(); Sync._recentlyPushedListingItems.clear();
  Sync._applyPulledListings(db, [LISTING]);
  Sync._applyPulledListingItems(db, [ITEM]);
  Sync._applyPulledListings(db, [{ ...LISTING, status: 'beendet', updated_at: '2026-09-21T11:00:00+00:00' }]);
  assert.equal(db.prepare('SELECT status FROM listings').get().status, 'beendet');
  assert.deepEqual(Sync._salesPushRows(db, 'listings', '2026-09-20 00:00:00'), []);
  assert.deepEqual(Sync._salesPushRows(db, 'listing_items', '2026-09-20 00:00:00'), []);
});

test('Lokale Änderung wird geschoben', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO listings (listing_id, channel_id, channel_name, price, listed_on, updated_at)
    VALUES ('l2', 'ebay', 'eBay', 5, '2026-09-21', '2026-09-21 08:00:00')`).run();
  assert.deepEqual(Sync._salesPushRows(db, 'listings', '2026-09-20 00:00:00').map((r) => r.listing_id), ['l2']);
});
```

- [ ] **Step 2: Fehlschlag bestätigen** (SQLite-Suite: `Sync.remoteToLocalListing is not a function`).

- [ ] **Step 3: `sync.cjs` erweitern**

1. Unter `const { CHANNEL_COLS, SALE_COLS, ITEM_COLS } = require('./sales-schema.cjs');` (Zeile 9):

```js
const { LISTING_COLS, LISTING_ITEM_COLS } = require('./listings-schema.cjs');
```

2. `SALES_STREAMS` (Zeile 254–258) nach dem `sale_items`-Eintrag um zwei Einträge ergänzen:

```js
  // Spec H3a §4.3 -- Angebote und ihre Positionen, dieselbe Bauart (Echo-Sperre, Obergrenze Fix I2).
  listings: { cols: noStamps(LISTING_COLS), bools: new Set(['deleted']), key: ['listing_id'], cursor: 'sync_listings' },
  listing_items: { cols: noStamps(LISTING_ITEM_COLS), bools: new Set(['deleted']), key: ['listing_id', 'copy_id'], cursor: 'sync_listing_items' },
```

3. `recentlyPushedSalesByTable` (Zeile 259) um `listings: new Map(), listing_items: new Map()` erweitern.
4. In `remoteToLocalSalesRow` (Zeile 270–271): `'price'` in die Liste der Zahlenfelder aufnehmen und die Datumszeile ersetzen durch

```js
  for (const k of ['sold_on', 'listed_on']) if (k in out && out[k]) out[k] = String(out[k]).slice(0, 10);
```

5. In `startSync` direkt nach `pushSalesSafe`:

```js
  // Spec H3a §4.3: Angebote als zwei weitere Stroeme nach den Verkaeufen; fehlt eine Cloud-Tabelle
  // (listings_schema.sql nicht eingespielt), laufen alle anderen Stroeme weiter.
  const LISTING_TABLES = ['listings', 'listing_items'];
  async function pullListingsSafe(c) {
    let n = 0;
    for (const t of LISTING_TABLES) {
      try { n += await pullSalesTable(c, t); } catch (e) { console.error(`[sync] ${t} pull:`, e.message); }
    }
    return n;
  }
  async function pushListingsSafe(c) {
    for (const t of LISTING_TABLES) {
      try { await pushSalesTable(c, t); } catch (e) { console.error(`[sync] ${t} push:`, e.message); }
    }
  }
```

6. In `cycle()`: nach `const pulledSales = await pullSalesSafe(c);` die Zeile `const pulledListings = await pullListingsSafe(c);`, nach `await pushSalesSafe(c);` die Zeile `await pushListingsSafe(c);`. Nach der `sales-changed`-Zeile: `if (pulledListings > 0) { const w = getWindow(); if (w) w.webContents.send('listings-changed'); }`, und `totalPulled` um `+ pulledListings` erweitern.
7. Exporte nach `_salesPushRows: salesPushRows,`:

```js
  listingToRemote: (r) => salesRowToRemote('listings', r), remoteToLocalListing: (r) => remoteToLocalSalesRow('listings', r),
  listingItemToRemote: (r) => salesRowToRemote('listing_items', r), remoteToLocalListingItem: (r) => remoteToLocalSalesRow('listing_items', r),
  _applyPulledListings: (db, rows) => applyPulledSalesRows(db, 'listings', rows),
  _applyPulledListingItems: (db, rows) => applyPulledSalesRows(db, 'listing_items', rows),
  _recentlyPushedListings: recentlyPushedSalesByTable.listings,
  _recentlyPushedListingItems: recentlyPushedSalesByTable.listing_items,
```

`table` kommt weiterhin nur aus den festen Schlüsseln von `SALES_STREAMS`; die Tabellennamen im SQL sind unbedenklich.

- [ ] **Step 4: Tests grün**

SQLite-Suite (bisher + 4) und `test-sync.cjs` (alle PASS, exit 0).

- [ ] **Step 5: Schutz-Nachweise**

1. `'price'` wieder aus der Zahlenliste nehmen. „Abbildung“ scheitert (`'12.50'` statt `12.5`). Zitieren, zurücknehmen.
2. In `applyPulledSalesRows` die Echo-Prüfung entfernen. „Echo“ scheitert. Zitieren, zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/sync.cjs desktop/electron/listings-sync.test.cjs
git commit -m "feat(h3a): Sync-Stroeme fuer Angebote und Positionen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: IPC-Kanäle, Bilder-Ordner, Link öffnen

**Files:**
- Create: `desktop/electron/listing-images.cjs`, `desktop/electron/listing-images.test.cjs`
- Modify: `desktop/electron/main.cjs` (`require`s oben; `sale-book` im H2-Block Zeile 904; neuer H3a-Block nach dem H2-Block, vor `// --- Other Handlers ---`)
- Modify: `desktop/electron/preload.cjs` (nach `onSalesChanged`)
- Modify: `desktop/electron/ipc-channels.test.cjs`

**Interfaces:**
- Consumes: `listings.cjs`, `sales.cjs#bookSaleDetailed`, `catalog-prices.cjs#readCatalogCards, catalogMainId` (schon importiert, `main.cjs:27`).
- Produces (`window.api`): `previewListing(copyIds)`, `createListings({ listings })` → `{ success, listing_ids }`, `updateListing(data)` → `{ success, ended }`, `removeListingItems({ listing_id, copyIds })` → `{ success, ended }`, `endListing(listingId)`, `relistPrefill(listingId)`, `listingsOverview({ today })`, `listingDetail({ listing_id, today })`, `listingOffers()`, `openListingUrl(url)` → `{ success }`, `saveListingImages({ title, urls })` → `{ success, saved, total, folder }`, `onListingsChanged(cb) -> off`. `bookSale(data)` antwortet jetzt `{ success, sale_id, reminders, askAdjust, listingSkipped }`.
- Produces (`listing-images.cjs`): `safeFolderName(title)`, `imageFileName(index, url)`, `saveListingImages({ baseDir, title, urls }, deps)`.

- [ ] **Step 1: Failing Tests**

`desktop/electron/listing-images.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { safeFolderName, imageFileName, saveListingImages } = require('./listing-images.cjs');

test('Ordnername dateinamen-sicher', () => {
  assert.equal(safeFolderName('Yu-Gi-Oh! Konvolut 3 Karten – A/B: "C"?'), 'Yu-Gi-Oh! Konvolut 3 Karten – A B C');
  assert.equal(safeFolderName('  Titel mit Punkt am Ende...  '), 'Titel mit Punkt am Ende');
  assert.equal(safeFolderName('<>:|?*\\\t'), 'Angebot');
  assert.equal(safeFolderName(null), 'Angebot');
  assert.equal(safeFolderName('x'.repeat(90)).length, 80);
});

test('Dateinamen', () => {
  assert.equal(imageFileName(0, 'https://a/b/46986414.jpg'), '01.jpg');
  assert.equal(imageFileName(9, 'https://a/b/x.PNG?v=2'), '10.png');
  assert.equal(imageFileName(2, 'https://a/b/x'), '03.jpg');
});

test('Bilder speichern: nicht ladbare überspringen, doppelte einmal, nur https', async () => {
  const written = []; const dirs = [];
  const ok = (bytes) => ({ ok: true, arrayBuffer: async () => new Uint8Array(bytes).buffer });
  const deps = {
    mkdir: (d) => dirs.push(d),
    writeFile: (f, b) => written.push([path.basename(f), b.length]),
    fetch: async (u) => {
      if (u.endsWith('/1.jpg')) return ok([1, 2, 3]);
      if (u.endsWith('/2.png')) return ok([4]);
      if (u.endsWith('/3.jpg')) return { ok: false };
      throw new Error('offline');
    },
  };
  const urls = ['https://i/1.jpg', 'https://i/2.png', 'https://i/1.jpg', 'https://i/3.jpg', 'http://i/5.jpg', 'https://i/4.jpg', null, ''];
  const r = await saveListingImages({ baseDir: 'C:\Bilder', title: 'Dunkler Magier: NM', urls }, deps);
  assert.deepEqual([r.saved, r.total], [2, 5]);
  assert.equal(r.folder, path.join('C:\Bilder', 'Yu-Gi-Oh Angebote', 'Dunkler Magier NM'));
  assert.deepEqual(dirs, [r.folder]);
  assert.deepEqual(written, [['01.jpg', 3], ['02.png', 1]]);
});
```

In `ipc-channels.test.cjs` ergänzen:

```js
// Spec H3a §5–§7: Vorschau, Anlegen, Bearbeiten, Herausnehmen, Beenden, Erneut anbieten, Übersicht, Detail, Kürzel, Link, Bilder.
const H3A_CHANNELS = ['listing-preview', 'listing-create', 'listing-update', 'listing-remove-items', 'listing-end', 'listing-relist',
  'listings-overview', 'listing-detail', 'listing-offers', 'listing-open-url', 'listing-save-images'];
```

und `...H3A_CHANNELS` in die Schleife aufnehmen. SQLite-Suite: 11 neue Fehlschläge plus `Cannot find module './listing-images.cjs'`.

- [ ] **Step 2: `listing-images.cjs` schreiben**

```js
// desktop/electron/listing-images.cjs — Spec H3a §5.6: Katalogbilder eines Angebots in
// Bilder\Yu-Gi-Oh Angebote\<Titel>\ speichern. Rein bis auf die hereingereichten deps (Test: Faelschungen, nie die Platte).
const path = require('path');

// Windows-sicherer Ordnername: verbotene Zeichen und Steuerzeichen -> Leerzeichen, Leerraum zusammengefasst,
// hoechstens 80 Zeichen, keine Punkte/Leerzeichen am Ende; leer -> "Angebot".
function safeFolderName(title) {
  const FORBIDDEN = '<>:"/\\|?*';
  const s = Array.from(String(title ?? ''), (ch) => (ch.charCodeAt(0) < 32 || FORBIDDEN.includes(ch) ? ' ' : ch)).join('')
    .replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '');
  return s || 'Angebot';
}
const extOf = (url) => { const m = /\.(jpe?g|png|webp)(?:$|\?)/i.exec(url); return m ? `.${m[1].toLowerCase()}` : '.jpg'; };
// "01.jpg", "02.png" … -- Zwilling der Dateinamen am Handy: ListingShare.fileName.
const imageFileName = (index, url) => `${String(index + 1).padStart(2, '0')}${extOf(url)}`;

// deps = { fetch(url) -> Response-artig, mkdir(dir), writeFile(file, Buffer) }. Nicht ladbare Bilder werden
// uebersprungen (Spec §5.6), nur https. -> { saved, total, folder }.
async function saveListingImages({ baseDir, title, urls }, deps) {
  const list = [...new Set((Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && u !== ''))];
  const folder = path.join(baseDir, 'Yu-Gi-Oh Angebote', safeFolderName(title));
  deps.mkdir(folder);
  let saved = 0;
  for (let i = 0; i < list.length; i++) {
    if (!/^https:\/\//i.test(list[i])) continue;
    try {
      const r = await deps.fetch(list[i]);
      if (!r || !r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length === 0) continue;
      deps.writeFile(path.join(folder, imageFileName(i, list[i])), buf);
      saved += 1;
    } catch { /* Bild uebersprungen */ }
  }
  return { saved, total: list.length, folder };
}

module.exports = { safeFolderName, imageFileName, saveListingImages };
```

- [ ] **Step 3: Handler in `main.cjs`**

Oben bei den `require`s: `const listings = require('./listings.cjs');` und `const { saveListingImages } = require('./listing-images.cjs');`.

Im H2-Block `sale-book` ersetzen durch:

```js
ipcMain.handle('sale-book', saleWrite('sale-book', (d) => {
    // Spec H3a §7: dieselbe Buchung, dazu Erinnerung/Teilverkauf aus dem Aufraeumen in derselben Transaktion.
    const r = sales.bookSaleDetailed(db, d || {});
    return { sale_id: r.saleId, reminders: r.reminders, askAdjust: r.askAdjust, listingSkipped: r.listingSkipped };
}));
```

Nach dem H2-Block:

```js
// --- Spec H3a: Angebote (halbautomatisch) ---
// Regeln in listings.cjs/listing-text.cjs; hier nur die Kanaele. Erwartete Fehler (ListingError) tragen eine deutsche Meldung.
// Anzeigename/englischer Name aus dem Offline-Katalog ueber die Artwork-Zuordnung (Befund 1); ohne Katalog null.
function listingNames(id) {
    const cards = readCatalogCards(userDataPath);
    const c = cards && cards.get(catalogMainId(userDataPath, id));
    return c ? { de: c.name_de || null, en: c.name_en || null } : null;
}
function listingErrorMessage(e, channel) {
    if (e instanceof listings.ListingError) return e.message;
    console.error(`[${channel}]`, e);
    return CONTAINER_COPY_ERROR_MSG;
}
const listingWrite = (channel, fn) => (event, d) => {
    try { return { success: true, ...fn(d) }; }
    catch (e) { return { success: false, error: listingErrorMessage(e, channel) }; }
};
const listingRead = (channel, fn) => (event, d) => {
    try { return fn(d); }
    catch (e) { throw new Error(listingErrorMessage(e, channel)); }
};
ipcMain.handle('listing-preview', listingRead('listing-preview', (ids) => listings.previewListing(db, ids, listingNames)));
ipcMain.handle('listing-create', listingWrite('listing-create', (d) => ({ listing_ids: listings.createListings(db, d || {}, listingNames) })));
ipcMain.handle('listing-update', listingWrite('listing-update', (d) => listings.updateListing(db, d || {})));
ipcMain.handle('listing-remove-items', listingWrite('listing-remove-items', (d) => listings.removeListingItems(db, d?.listing_id, d?.copyIds)));
ipcMain.handle('listing-end', listingWrite('listing-end', (id) => { listings.endListing(db, id); return {}; }));
ipcMain.handle('listing-relist', listingRead('listing-relist', (id) => listings.relistPrefill(db, id)));
ipcMain.handle('listings-overview', listingRead('listings-overview', (d) => listings.listingsOverview(db, d || {})));
ipcMain.handle('listing-detail', listingRead('listing-detail', (d) => listings.listingDetail(db, d?.listing_id, d || {})));
ipcMain.handle('listing-offers', listingRead('listing-offers', () => listings.listingOffers(db)));
// Spec §5.5/§6: nur http(s) an den Browser (Abweichung 8) -- open-external prueft nichts.
ipcMain.handle('listing-open-url', async (event, url) => {
    const u = String(url ?? '').trim();
    if (!/^https?:\/\//i.test(u)) return { success: false, error: 'Ungültiger Link.' };
    try { await shell.openExternal(u); return { success: true }; }
    catch (e) { console.error('[listing-open-url]', e); return { success: false, error: 'Link konnte nicht geöffnet werden.' }; }
});
// Spec §5.6: Katalogbilder nach Bilder\Yu-Gi-Oh Angebote\<Titel>\, danach den Ordner im Explorer oeffnen.
ipcMain.handle('listing-save-images', async (event, d) => {
    try {
        const r = await saveListingImages({ baseDir: app.getPath('pictures'), title: d?.title, urls: d?.urls }, {
            fetch: (u) => fetch(u, { signal: AbortSignal.timeout(15000) }),
            mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
            writeFile: (file, buf) => fs.writeFileSync(file, buf),
        });
        const openError = await shell.openPath(r.folder); // '' bei Erfolg
        if (openError) console.error('[listing-save-images] Ordner:', openError);
        return { success: true, ...r };
    } catch (e) {
        console.error('[listing-save-images]', e);
        return { success: false, error: 'Bilder konnten nicht gespeichert werden.' };
    }
});
```

`fs` ist in `main.cjs` bereits geladen (`main.cjs:3`).

- [ ] **Step 4: `preload.cjs`**

```js
  // Spec H3a: Angebote
  previewListing: (copyIds) => ipcRenderer.invoke('listing-preview', copyIds),
  createListings: (data) => ipcRenderer.invoke('listing-create', data),
  updateListing: (data) => ipcRenderer.invoke('listing-update', data),
  removeListingItems: (data) => ipcRenderer.invoke('listing-remove-items', data),
  endListing: (listingId) => ipcRenderer.invoke('listing-end', listingId),
  relistPrefill: (listingId) => ipcRenderer.invoke('listing-relist', listingId),
  listingsOverview: (data) => ipcRenderer.invoke('listings-overview', data),
  listingDetail: (data) => ipcRenderer.invoke('listing-detail', data),
  listingOffers: () => ipcRenderer.invoke('listing-offers'),
  openListingUrl: (url) => ipcRenderer.invoke('listing-open-url', url),
  saveListingImages: (data) => ipcRenderer.invoke('listing-save-images', data),
  onListingsChanged: (cb) => { const s = (_e) => cb(); ipcRenderer.on('listings-changed', s); return () => ipcRenderer.removeListener('listings-changed', s); },
```

- [ ] **Step 5: Tests grün** (SQLite-Suite: + 11 Kanäle + 3 Bilder-Tests, `test-sync.cjs`).

- [ ] **Step 6: Schutz-Nachweis**

In `safeFolderName` den Rückstrich aus `FORBIDDEN` entfernen (`'<>:"/|?*'`). „Ordnername dateinamen-sicher“ scheitert (`'\\'` bleibt stehen). Zitieren, zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/listing-images.cjs desktop/electron/listing-images.test.cjs desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/ipc-channels.test.cjs
git commit -m "feat(h3a): IPC-Kanaele fuer Angebote, Bilder-Ordner, Link oeffnen; sale-book meldet Erinnerungen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: PC — Angebotsdialog und Einstiege (Verkaufsliste, Exemplar-Sheet), Cardmarket-Aufteilung

**Files:**
- Create: `desktop/src/components/ListingDialog.jsx`
- Modify: `desktop/src/components/ForSaleList.jsx`, `desktop/src/components/CopySheet.jsx`

**Interfaces:**
- Consumes: `window.api.listSaleChannels, previewListing, createListings, openListingUrl, saveListingImages, listingOffers, onListingsChanged`, `listingText.js` (`TITLE_MAX, groupItems, listingTitle, listingDescription, cardmarketProduct, cardmarketEntry, listingLink, suggestionSum, imageUrls, imagesText, copyBadges`), `saleMath.js` (`toCents, suggestionCents, euroCentsText`), `createBusyGate`, `createLatestOnly`, `todayLocal`.
- Produces: `<ListingDialog copyIds={string[]} prefill={{ channel_id, title, description, priceCents } | null} onClose={() => void} onSaved={(listingIds) => void} />`. Nach dem Speichern feuert der Dialog `collection-dirty` und `listings-dirty` (Fenster-Ereignisse).

- [ ] **Step 1: `ListingDialog.jsx` schreiben**

Gerüst (Zustand, Laden, Ableitungen, Speichern) wörtlich; das Markup folgt der Beschreibung darunter, mit denselben Klassen wie `SaleDialog.jsx` (`fixed inset-0 z-50 … bg-black/80`, Karte `max-w-lg bg-obsidian-700 border border-line rounded-2xl p-5 space-y-3`, Felder `field` wie dort).

```jsx
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { createBusyGate } from '../utils/busyGate';
import { toCents, suggestionCents, euroCentsText } from '../utils/saleMath';
import { todayLocal } from '../utils/today';
import {
  TITLE_MAX, groupItems, listingTitle, listingDescription, cardmarketProduct, cardmarketEntry, listingLink,
  suggestionSum, imageUrls, imagesText,
} from '../utils/listingText';

const toInput = (cents) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));
const parse = (s) => (String(s ?? '').trim() === '' ? null : Number(String(s).replace(',', '.')));
const groupKey = (g) => g.copy_ids.join(',');

// Spec H3a §5.2–§5.7 -- Angebot erstellen, auch "Erneut anbieten" (prefill). Geprueft und gespeichert wird im
// Hauptprozess (listings.cjs); hier nur Vorschau, Texte (Zwilling listingText.js), Kopieren, Link, Bilder.
export default function ListingDialog({ copyIds, prefill = null, onClose, onSaved }) {
  const [gate] = useState(createBusyGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [channels, setChannels] = useState(null);
  const [preview, setPreview] = useState(null); // { items, missing, rule }
  const [form, setForm] = useState(() => ({
    channel_id: prefill?.channel_id ?? 'cardmarket', listed_on: todayLocal(),
    price: prefill?.priceCents != null ? toInput(prefill.priceCents) : '', priceTouched: prefill?.priceCents != null,
    title: prefill?.title ?? '', titleTouched: prefill?.title != null,
    description: prefill?.description ?? '', descTouched: prefill?.description != null,
    external_url: '', note: '',
  }));
  const [cmPrices, setCmPrices] = useState({}); // groupKey -> Eingabe, erst nach einer Aenderung gesetzt

  // Eigener Escape-Handler; der Aufrufer (CopySheet, ListingDetail) setzt seinen aus, solange der Dialog offen ist.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // idsKey statt copyIds: CopySheet uebergibt ein Inline-Array (neue Referenz je Rendern), siehe SaleDialog.jsx.
  const idsKey = copyIds.join(',');
  useEffect(() => {
    let alive = true;
    Promise.all([window.api.listSaleChannels(), window.api.previewListing(copyIds)])
      .then(([ch, pv]) => {
        if (!alive) return;
        setChannels(ch);
        setPreview(pv);
        setForm((f) => {
          const next = { ...f };
          // Ausgeblendeter Kanal (Erneut anbieten): neue Angebote nur auf lebenden Kanaelen (Spec §8).
          if (!ch.some((c) => c.channel_id === f.channel_id)) next.channel_id = ch[0]?.channel_id ?? f.channel_id;
          if (!f.priceTouched) {
            next.price = toInput(suggestionSum(pv.items.map((it) => suggestionCents(it.valueCents, pv.rule.discount, pv.rule.minCents))));
          }
          return next;
        });
      })
      .catch((e) => { if (alive) setError(e?.message || 'Laden fehlgeschlagen.'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const items = useMemo(() => preview?.items ?? [], [preview]);
  const groups = useMemo(() => groupItems(items), [items]);
  const cm = form.channel_id === 'cardmarket';
  const suggestionOf = (it) => suggestionCents(it.valueCents, preview.rule.discount, preview.rule.minCents);
  const itemsOf = (g) => items.filter((it) => g.copy_ids.includes(it.copy_id));
  const cmPriceInput = (g) => cmPrices[groupKey(g)] ?? toInput(suggestionSum(itemsOf(g).map(suggestionOf)));
  const priceCents = toCents(parse(form.price));
  const title = form.titleTouched ? form.title : listingTitle(items);
  const description = form.descTouched ? form.description : listingDescription(items, priceCents);
  const canSave = !busy && items.length > 0 && (cm
    ? groups.every((g) => (toCents(parse(cmPriceInput(g))) ?? 0) > 0)
    : (priceCents ?? 0) > 0);

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); setNotice('Kopiert.'); }
    catch { setError('Kopieren fehlgeschlagen.'); }
  };
  const openUrl = async (url) => {
    const res = await window.api.openListingUrl(url);
    if (!res?.success) setError(res?.error || 'Link konnte nicht geöffnet werden.');
  };
  const saveImages = (folderTitle, its) => gate.run(async () => {
    setBusy(true); setError(null);
    try {
      const res = await window.api.saveListingImages({ title: folderTitle, urls: imageUrls(its) });
      if (!res?.success) { setError(res?.error || 'Bilder konnten nicht gespeichert werden.'); return; }
      setNotice(imagesText(res.saved, res.total));
    } catch (e) { setError(e?.message || 'Bilder konnten nicht gespeichert werden.'); }
    finally { setBusy(false); }
  });

  const save = () => gate.run(async () => {
    setBusy(true); setError(null);
    try {
      const head = { channel_id: form.channel_id, listed_on: form.listed_on, external_url: form.external_url, note: form.note };
      // Spec §5.4: Cardmarket = ein Angebot je Gruppe, vor dem Speichern geteilt.
      const listings = cm
        ? groups.map((g) => ({ ...head, copyIds: g.copy_ids, price: parse(cmPriceInput(g)), title: null, description: null }))
        : [{ ...head, copyIds: items.map((it) => it.copy_id), price: parse(form.price), title, description }];
      const res = await window.api.createListings({ listings });
      if (!res?.success) { setError(res?.error || 'Speichern fehlgeschlagen.'); return; }
      window.dispatchEvent(new Event('collection-dirty'));
      window.dispatchEvent(new Event('listings-dirty'));
      onSaved?.(res.listing_ids);
    } catch (e) { setError(e?.message || 'Speichern fehlgeschlagen.'); }
    finally { setBusy(false); }
  });

  // … Markup siehe unten …
}
```

Markup (von oben nach unten), solange `!preview || !channels` nur `<p className="text-ink-faint">…</p>`:
- Kopf „Angebot erstellen“ (bei `prefill`: „Erneut anbieten“) mit Schließen-Knopf (X).
- Zeile „N Karten · Marktwert X“ (`euroCentsText(Σ valueCents)`); `preview.missing.length > 0` → Hinweis „N Karten nicht mehr verfügbar – werden nicht angeboten.“ (`text-crit`).
- Je Exemplar mit `alsoOn.length > 0`: „<Name> – auch auf <Kanäle, mit „, “> eingestellt“ (`text-gold`, kein Fehler, Spec §5.7).
- Kanal (`select` über `channels`, Wert `form.channel_id`), Datum (`type="date"`).
- **Nicht Cardmarket:** Preis (€, `inputMode="decimal"`, `priceTouched` beim Tippen), Titel (Eingabe, `titleTouched`), darunter Zähler `${title.length}/${TITLE_MAX}` (rot, wenn größer), Beschreibung (`textarea rows={6}`, `descTouched`), Knöpfe „Titel kopieren“, „Beschreibung kopieren“ (`copyText`), „Zum Einstellen öffnen“ nur wenn `listingLink(form.channel_id, {})` nicht `null` ist (`openUrl`), „Bilder“ (`saveImages(title || 'Angebot', items)`).
- **Cardmarket:** bei `groups.length > 1` oben „wird zu N Cardmarket-Angeboten“. Je Gruppe ein Kasten mit den Eintragwerten aus `cardmarketEntry(g, toCents(parse(cmPriceInput(g))))`: Produkt, Menge, Sprache, Zustand, „1. Auflage: ja/nein“, „Preis je Stück: X“ (bzw. „–“), darunter Preis-Eingabe für die Gruppe (`setCmPrices((p) => ({ ...p, [groupKey(g)]: v }))`), Knöpfe „Zum Einstellen öffnen“ (`listingLink('cardmarket', { cmUrl: first.cm_url, nameEn: first.name_en, setCode: g.set_code })` mit `first = itemsOf(g)[0]`) und „Bilder“ (`saveImages(`${g.count}× ${cardmarketProduct(g)}`, itemsOf(g))`). Kein Titel, keine Beschreibung.
- Link der Anzeige (optional), Notiz.
- Hinweis „Käufer erwarten oft eigene Fotos.“ (`text-ink-faint text-xs`).
- `notice` (`text-emerald-400`), `error` (`text-crit`).
- Fuß: „Abbrechen“, „Angebot speichern“ (`disabled={!canSave}`, während `busy` „Wird gespeichert…“).

Hinweis: `setForm` im `.then` ist ein Promise-Callback (kein setState im Effekt-Körper); `todayLocal()` läuft im `useState`-Initialisierer.

- [ ] **Step 2: Einstieg Verkaufsliste (`ForSaleList.jsx`)**

- Imports: `ListingDialog`, `copyBadges` aus `../utils/listingText`, `createLatestOnly` aus `../utils/busyGate`, `useCallback, useRef` aus React.
- State `const [listingFor, setListingFor] = useState(null); // copyIds | null`.
- Neben „Verkauft buchen (n)“ den Knopf „Angebot erstellen ({pickedLive.size})“, gleiche Klassen, `disabled={pickedLive.size === 0 || busy}`, `onClick={() => setListingFor([...pickedLive])}`.
- **Eine** Aufrufstelle, neben dem `SaleDialog`: `{listingFor && <ListingDialog copyIds={listingFor} onClose={() => setListingFor(null)} onSaved={async () => { setListingFor(null); setPicked(new Set()); await reload(); }} />}`.
- Kanal-Kürzel je Exemplar (Spec §6 „Überall sonst“):

```jsx
  const [offers, setOffers] = useState({});
  const offersSeq = useRef(createLatestOnly());
  const loadOffers = useCallback(() => {
    const token = offersSeq.current.start();
    window.api?.listingOffers?.()
      .then((o) => { if (offersSeq.current.isCurrent(token)) setOffers(o || {}); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadOffers();
    const off = window.api?.onListingsChanged?.(loadOffers);
    window.addEventListener('listings-dirty', loadOffers);
    window.addEventListener('collection-dirty', loadOffers);
    return () => { off?.(); window.removeEventListener('listings-dirty', loadOffers); window.removeEventListener('collection-dirty', loadOffers); };
  }, [loadOffers]);
```

  In jeder Exemplar-Zeile nach dem Standort: `{copyBadges(offers[id] || []).map((b) => <span key={b} className="px-1 rounded bg-space-violet/15 text-space-violet text-[10px] font-mono">{b}</span>)}`.

- [ ] **Step 3: Einstieg Exemplar-Sheet (`CopySheet.jsx`)**

- State `const [listingOpen, setListingOpen] = useState(false);`.
- Escape-Effekt (Zeile 90–95): `if (sellingOpen || listingOpen) return;` und `listingOpen` in die Abhängigkeiten.
- Neben „Verkauft…“ den Knopf „Anbieten…“ (gleiche Klassen, gleiche Sperre `saving || removing || markingSale`), `onClick={() => setListingOpen(true)}`, nur wenn `copy?.copy_id`.
- Neben dem `SaleDialog` am Ende: `{listingOpen && <ListingDialog copyIds={[copy.copy_id]} onClose={() => setListingOpen(false)} onSaved={() => { setListingOpen(false); setForSale(true); onSaved?.(); }} />}` (das Sheet bleibt offen; der Schalter „Zum Verkauf“ steht danach an, weil das Anlegen `for_sale = 1` setzt).

- [ ] **Step 4: Prüfen**

In `desktop/`: `npx eslint .` → genau 5 Fehler; `npx vite build` ok; Helfer-Tests grün.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/components/ListingDialog.jsx desktop/src/components/ForSaleList.jsx desktop/src/components/CopySheet.jsx
git commit -m "feat(h3a): PC Angebot erstellen aus Verkaufsliste und Exemplar-Sheet, Cardmarket-Aufteilung, Kanal-Kuerzel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: PC — Übersicht „Angebote“, Detail, Marken, Kartenansicht, Start, Verkauft/Teilverkauf/Erinnerung

**Files:**
- Create: `desktop/src/utils/useListingsData.js`, `desktop/src/components/ListingsList.jsx`, `desktop/src/components/ListingDetail.jsx`
- Modify: `desktop/src/components/CollectionList.jsx`, `desktop/src/components/CardDetailPanel.jsx`, `desktop/src/components/Start.jsx`, `desktop/src/components/SaleDialog.jsx`

**Interfaces:**
- Consumes: `window.api.listingsOverview, listingDetail, updateListing, removeListingItems, endListing, relistPrefill, listingOffers, openListingUrl, saveListingImages, bookSale, onListingsChanged, onSalesChanged, onCollectionChanged`, `listingText.js` (`listingsSummary, summaryText, startText, sinceText, offeredText, imageUrls, imagesText, TITLE_MAX`), `saleMath.js` (`toCents, euroCentsText, diffText`), `ListingDialog` (Task 7).
- Produces: `useListingsData() -> { data: { listings, items, byCopy } | null, error, reload }`; `<ListingsList data error reload onOpenCard />`; `<ListingDetail listingId onClose onChanged onOpenCard />`; `SaleDialog` bekommt die optionalen Props `listing = null` (`{ listing_id, channel_id, priceCents }`) und `onAdjustListing = null`.

- [ ] **Step 1: `useListingsData.js`**

```js
import { useState, useEffect, useCallback, useRef } from 'react';
import { createLatestOnly } from './busyGate.js';
import { todayLocal } from './today.js';

const LOAD_ERROR = 'Angebote konnten nicht geladen werden.';

// Spec H3a §6 -- Uebersicht aller Angebote (listings-overview). Laedt beim Einhaengen, bei Abgleich (Angebote,
// Sammlung, Verkaeufe) und bei den Fenster-Ereignissen 'listings-dirty'/'collection-dirty'. data null = laedt ("…").
// Ein Ladefehler behaelt den letzten Stand. Die zuletzt gestartete Abfrage gewinnt (wie useSaleData).
export function useListingsData() {
  const [state, setState] = useState(() => ({ data: null, error: window.api?.listingsOverview ? null : LOAD_ERROR }));
  const alive = useRef(true);
  const latest = useRef(createLatestOnly());
  const reload = useCallback(() => {
    if (!window.api?.listingsOverview) return Promise.resolve();
    const token = latest.current.start();
    return window.api.listingsOverview({ today: todayLocal() })
      .then((d) => { if (alive.current && latest.current.isCurrent(token)) setState({ data: d, error: null }); })
      .catch(() => { if (alive.current && latest.current.isCurrent(token)) setState((s) => ({ data: s.data, error: LOAD_ERROR })); });
  }, []);
  useEffect(() => {
    alive.current = true;
    reload();
    const onDirty = () => { reload(); };
    const offs = [window.api?.onListingsChanged?.(onDirty), window.api?.onCollectionChanged?.(onDirty), window.api?.onSalesChanged?.(onDirty)];
    window.addEventListener('listings-dirty', onDirty);
    window.addEventListener('collection-dirty', onDirty);
    return () => {
      alive.current = false;
      offs.forEach((off) => off?.());
      window.removeEventListener('listings-dirty', onDirty);
      window.removeEventListener('collection-dirty', onDirty);
    };
  }, [reload]);
  return { data: state.data, error: state.error, reload };
}
```

- [ ] **Step 2: `ListingsList.jsx`**

- Props `{ data, error, reload, onOpenCard }`; `data === null` → „…“ (mittig, wie `ForSaleList`), `error` sichtbar über der Liste.
- Filter: `FilterChip`-artige Knöpfe „Aktiv“ (Standard) · „Verkauft“ · „Beendet“ · „Alle“ (`status` ∈ `aktiv|verkauft|beendet|alle`), daneben `select` „Alle Kanäle“ + je in `data.listings` vorkommendem `channel_id` der `channel_name` des jüngsten Angebots.
- `rows = data.listings.filter(status/kanal)` (Reihenfolge kommt schon sortiert aus `listingsOverview`).
- Kopf nur bei `aktiv`/`alle`: `summaryText(listingsSummary(rows, data.items))` — die Funktion zählt nur aktive (Spec §6).
- Zeile (Knopf, öffnet `ListingDetail`): Kanal · `rowTitle` · „N Karten“ · `euroCentsText(toCents(price))` · `sinceText(days)`; bei aktiv zusätzlich `diffText(toCents(price), marketCents)` „gegenüber Marktwert“ (grün ≥ 0, sonst rot). Marken als kleine Chips: `alsoOn.length > 0` → „auch auf <Kanäle>“ (gold), `missing` → „Karte fehlt“ (rot), `underSuggestion` → „Preis unter Vorschlag“ (gold), `saleCancelled` → „Verkauf storniert“ (rot). Status `verkauft`/`beendet` ausgegraut mit dem Status als Zusatz.
- Leer: „Keine Angebote.“
- `{openId && <ListingDetail listingId={openId} onClose={() => setOpenId(null)} onChanged={reload} onOpenCard={onOpenCard} />}` genau einmal am Ende.

- [ ] **Step 3: `ListingDetail.jsx`**

- Lädt `window.api.listingDetail({ listing_id: listingId, today: todayLocal() })` im Promise-Callback (Latest-only-Token wie `CardDetailPanel.loadSold`), neu bei `listings-dirty` und `onListingsChanged`. Solange `null`: „…“.
- Eigener Escape-Handler, ausgesetzt solange `selling || relist || editing` (verschachtelte Dialoge).
- Kopf: Kanal, Status, `listed_on` als `TT.MM.JJJJ` + `sinceText`, Preis, Zeilentitel, Marken wie in der Liste, Notiz.
- Positionen: Bild (`image_url`), Name, `set_code · rarity · language`, `condition · edition`, heutiger Marktwert (`marketCents == null ? '–' : euroCentsText(marketCents)`). `copyLive === false` → rote Marke „Karte fehlt“ und Knopf „Herausnehmen“ (nur bei aktiv) → `removeListingItems({ listing_id, copyIds: [copy_id] })` über `gate.run`; bei `ended` Hinweis „Angebot beendet – keine Karte mehr übrig.“. Tipp auf die Zeile → `onOpenCard(item)`.
- Knöpfe:
  - „Titel kopieren“, „Beschreibung kopieren“ (nur Nicht-Cardmarket, Text aus `listing.title`/`listing.description`), „Bilder“ (`saveListingImages({ title: rowTitle, urls: imageUrls(items) })`, Hinweis `imagesText`).
  - Link der Anzeige: gesetzt → „Anzeige öffnen“ (`openListingUrl`); sonst (aktiv) Feld + „Link speichern“ über `updateListing` mit den übrigen Feldern unverändert.
  - Nur aktiv: **Bearbeiten** (Formular: Preis, Titel mit Zähler `n/65`, Beschreibung, Link, Notiz — Titel/Beschreibung ausgeblendet bei Cardmarket; je Position Häkchen „herausnehmen“) → `updateListing({ listing_id, price, title, description, external_url, note, removeCopyIds })`; **Verkauft** → `setSelling(true)`; **Beenden** → `confirm('Angebot beenden? Die Karten bleiben auf der Verkaufsliste.')` → `endListing`.
  - Nur `beendet`/`verkauft`: **Erneut anbieten** → `relistPrefill(listing_id)`; `copyIds.length === 0` → Hinweis „Keine Karte mehr verfügbar.“, sonst `setRelist(prefill)`.
- Nach jeder Schreibaktion: `listings-dirty` feuern, `onChanged?.()`, neu laden; Fehler aus `res.error` sichtbar.
- Am Ende genau je eine Aufrufstelle:
  - `{selling && <SaleDialog copyIds={items.filter((i) => i.copyLive).map((i) => i.copy_id)} initialGrossCents={toCents(listing.price)} listing={{ listing_id: listing.listing_id, channel_id: listing.channel_id, priceCents: toCents(listing.price) }} onClose={() => setSelling(false)} onBooked={() => { setSelling(false); onChanged?.(); load(); }} onAdjustListing={() => setEditing(true)} />}`
  - `{relist && <ListingDialog copyIds={relist.copyIds} prefill={relist} onClose={() => setRelist(null)} onSaved={() => { setRelist(null); onChanged?.(); load(); }} />}`
  - „Verkauft“ ist gesperrt, wenn keine Position ein lebendes Exemplar hat („Keine verkaufbare Karte – bitte herausnehmen oder beenden.“).

- [ ] **Step 4: `SaleDialog.jsx` — Vorbelegung aus einem Angebot, Teilverkauf, Erinnerung**

1. Signatur: `export default function SaleDialog({ copyIds, initialGrossCents = null, listing = null, onClose, onBooked, onAdjustListing = null })`.
2. State `const [picked, setPicked] = useState(() => new Set(copyIds));` und `const [done, setDone] = useState(null); // Antwort von bookSale, solange der Abschluss-Schritt steht`.
3. Im Lade-`.then` innerhalb `setForm((f) => …)`: ist `listing` gesetzt und `ch.some((c) => c.channel_id === listing.channel_id)`, dann `channel_id: listing.channel_id` (vor der Gebühren-Vorbelegung, damit die Gebühr zum Kanal des Angebots passt).
4. Nur mit `listing`: unter der Kopfzeile je `preview.items`-Eintrag ein Häkchen (Name/Druck/Zustand), alle angehakt; abwählbar (Teilverkauf, Spec §7.1). Anzahl und Marktwert rechnen dann über `preview.items.filter((i) => picked.has(i.copy_id))`. Buchen gesperrt bei `picked.size === 0`.
5. `book()`: `copyIds: listing ? [...picked] : copyIds` und `listing_id: listing?.listing_id ?? null` mitschicken. Nach Erfolg zusätzlich `window.dispatchEvent(new Event('listings-dirty'))`. Dann:

```jsx
      if ((res.reminders?.length ?? 0) > 0 || res.askAdjust || res.listingSkipped) { setDone(res); return; }
      onBooked?.(res.sale_id);
```

6. `const finish = () => onBooked?.(done.sale_id);` Solange `done` steht, rufen Escape, X und Klick auf den Hintergrund `finish` statt `onClose` (der Escape-Effekt bekommt `done` in die Abhängigkeiten). Abschluss-Schritt statt Formular:

```jsx
          <>
            <p className="text-sm text-ink">Gebucht.</p>
            {done.listingSkipped && <p className="text-sm text-gold">Angebot war nicht mehr aktiv – nur der Verkauf wurde gebucht.</p>}
            {done.reminders.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm text-ink">Auch dort herausnehmen:</p>
                {done.reminders.map((r) => (
                  <div key={r.listing_id} className="flex items-center gap-2 text-xs text-ink-muted">
                    <span className="flex-1 truncate">{r.channel_name} – {r.title}</span>
                    {r.external_url && <button type="button" onClick={() => window.api.openListingUrl(r.external_url)} className="text-space-violet hover:underline">Anzeige öffnen</button>}
                  </div>
                ))}
              </div>
            )}
            {done.askAdjust && (
              <p className="text-sm text-ink">Preis für die übrigen Karten anpassen?{' '}
                <button type="button" onClick={() => { finish(); onAdjustListing?.(); }} className="text-space-violet hover:underline">Bearbeiten</button>
              </p>
            )}
            <div className="flex justify-end"><button type="button" onClick={finish} className="px-4 py-2 rounded-lg text-sm bg-space-violet text-white">Fertig</button></div>
          </>
```

Aufrufer ohne `listing` (Verkaufsliste, Exemplar-Sheet) ändern sich nicht; sie bekommen die Erinnerung automatisch, weil jede Buchung aufräumt (Spec §7.2).

- [ ] **Step 5: `CollectionList.jsx` — Chip „Angebote“**

- `import { useListingsData } from '../utils/useListingsData';`, `import ListingsList from './ListingsList';`, `import { listingsSummary } from '../utils/listingText';`.
- `const listingsData = useListingsData();` neben `useSaleData()`.
- Segmentliste (Zeile 588–595): nach `{ id: 'forsale', label: 'Zum Verkauf' }` → `{ id: 'listings', label: 'Angebote' }`. Zähler in `segmentCounts`: `listings: listingsData.data ? listingsSummary(listingsData.data.listings, listingsData.data.items).listings : LOADING` (und `listingsData.data` in die Abhängigkeiten). Kommentar Zeile 88 um `listings` ergänzen.
- Anzeige (Zeile 681–684): vor dem `filtered.length === 0`-Zweig `segment === 'listings' ? <ListingsList data={listingsData.data} error={listingsData.error} reload={listingsData.reload} onOpenCard={openSaleCopy} />`. Positionen tragen `card_id, set_code, language, rarity`, also passt `openSaleCopy` unverändert.

- [ ] **Step 6: `CardDetailPanel.jsx` — „angeboten auf …“ am Exemplar**

- State `const [offers, setOffers] = useState({});` und `const offersSeq = useRef(createLatestOnly());`; `loadOffers` wie `loadSold` (Token, `window.api.listingOffers?.()`, Fehler → `{}`), aufgerufen in `loadCard` und im Effekt, der auf `onSalesChanged`/`collection-dirty` hört, zusätzlich auf `onListingsChanged` und `listings-dirty`.
- In der Exemplar-Zeile (Zeile 322–339) nach dem Standort-`span`: `{offeredText(offers[c.copy_id] || []) && <span className="text-[10px] text-gold font-mono truncate">{offeredText(offers[c.copy_id] || [])}</span>}`.
- `CopySheet`-`onSaved` (Zeile 456) ruft zusätzlich `loadOffers()`.

- [ ] **Step 7: `Start.jsx` — „Angebote: N aktiv“**

`const listingsData = useListingsData();` und unter den Kacheln „Zum Verkauf“/„Duplikate“ (Zeile 210–215) eine dritte im selben Stil: `onClick={() => navigate(ROUTES.karten, { state: { segment: 'listings' } })}`, Text `listingsData.data ? startText(listingsSummary(listingsData.data.listings, listingsData.data.items).listings) : listingsData.error ? 'Angebote: —' : `Angebote: ${LOADING}``, Symbol `Store` aus `lucide-react` (oder `Tag`, falls schon importiert).

- [ ] **Step 8: Prüfen**

Lint genau 5 Fehler, `vite build` ok, Helfer grün, SQLite-Suite grün.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/utils/useListingsData.js desktop/src/components/ListingsList.jsx desktop/src/components/ListingDetail.jsx desktop/src/components/CollectionList.jsx desktop/src/components/CardDetailPanel.jsx desktop/src/components/Start.jsx desktop/src/components/SaleDialog.jsx
git commit -m "feat(h3a): PC Uebersicht Angebote mit Marken, Detail, Verkauft/Teilverkauf/Erinnerung, Kartenansicht und Start

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Handy — Daten, Blättern, REST-Nutzlasten

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/cloud/Listing.kt`, `cloud/ListingsRepository.kt`
- Create: `android/app/src/test/java/com/example/yugiohscanner/ListingsRepositoryTest.kt`
- Modify: `android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt`

**Interfaces:**
- Consumes: `ListingText` (Task 2), `Keyset`, `KeysetPager`, `StoreQueries.PAGE`, `SalesRepository.dbErrorMessage`, `CollectionRepository.setForSale`, Cloud-Tabellen aus Task 3.
- Produces:
  - `data class ListingRow(listingId, channelId, channelName, title: String?, description: String?, price: Double, status, listedOn, saleId: String?, externalUrl: String?, note: String?, createdAt: String?, deleted: Boolean) { val priceCents; fun head(): ListingText.Head }`
  - `data class ListingItemRow(listingId, copyId, cardId, setCode, language, rarity, edition, condition, name: String?, imageUrl: String?, deleted: Boolean) { fun item(): ListingText.Item }`
  - `data class ListingsData(listings, items) { heads(); lineItems(); liveItemsOf(id); byCopy() }`
  - `data class NewListing(channelId, channelName, listedOn, priceCents: Long, title: String?, description: String?, externalUrl: String?, note: String?, items: List<ListingText.Item>)`
  - `object ListingsRepository { const val CHANGED; data class Op(method, table, params, body, expectRow = false); data class AfterBooking(reminders, askAdjust, listingSkipped); internal fun listingsPageParams(after: String?); internal fun itemsPageParams(after: ListingItemRow?); internal fun parseListings(text); internal fun parseItems(text); suspend fun load(): ListingsData; internal fun checkNew(l, liveCopyIds, liveChannelIds): String?; internal fun createOps(ids, list): List<Op>; suspend fun create(list): List<String>; internal fun updateOps(...); suspend fun update(...): Boolean; internal fun removeOps(listingId, removeCopyIds, liveCopyIds); suspend fun removeItems(...): Boolean; internal fun endOps(listingId); suspend fun end(listingId); internal fun afterBookingOps(data, saleId, sold, fromListingId): Pair<List<Op>, AfterBooking>; suspend fun afterBooking(...): AfterBooking; internal fun inList(ids) }`
  - `SideStores.listings: ListCache<ListingsData>` (in `clearAll()` leeren).

- [ ] **Step 1: Failing Test (reine Teile)**

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.ListingItemRow
import com.example.yugiohscanner.cloud.ListingRow
import com.example.yugiohscanner.cloud.ListingsData
import com.example.yugiohscanner.cloud.ListingsRepository
import com.example.yugiohscanner.cloud.NewListing
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.ListingText
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ListingsRepositoryTest {
    private fun row(id: String, channel: String, price: Double, status: String = "aktiv") =
        ListingRow(id, channel, if (channel == "cardmarket") "Cardmarket" else "eBay", "T", null, price, status, "2026-09-21", null, null, null, null, false)
    private fun item(listing: String, copy: String) =
        ListingItemRow(listing, copy, "1", "LOB-DE005", "DE", "Ultra Rare", "first", "NM", "Dunkler Magier", null, false)
    private fun li(copy: String, condition: String = "NM") =
        ListingText.Item(copy, "1", "Dunkler Magier", "LOB-DE005", "DE", "Ultra Rare", "first", condition)

    @Test fun `Angebote-Seite nur lebende, nach listing_id, Folgeseite mit or`() {
        val p = ListingsRepository.listingsPageParams(null)
        assertEquals("deleted" to "eq.false", p[1])
        assertEquals("order" to "listing_id.asc", p[2])
        assertEquals("limit" to "1000", p[3])
        assertEquals("or" to "(listing_id.gt.\"l9\")", ListingsRepository.listingsPageParams("l9").last())
    }
    @Test fun `Positionen-Seite blaettert nach listing_id,copy_id`() {
        assertEquals("deleted" to "eq.false", ListingsRepository.itemsPageParams(null)[1])
        assertEquals("or" to "(listing_id.gt.\"l1\",and(listing_id.eq.\"l1\",copy_id.gt.\"c7\"))",
            ListingsRepository.itemsPageParams(item("l1", "c7")).last())
    }
    @Test fun `Blaettern ueber 1000 Zeilen -- zweite Seite nach dem letzten Schluessel`() = runBlocking {
        val all = (1..1234).map { "l%05d".format(it) }
        val seen = ArrayList<List<Pair<String, String>>>()
        val got = KeysetPager.all(1000) { after: String? ->
            val p = ListingsRepository.listingsPageParams(after); seen += p
            val from = if (after == null) 0 else all.indexOf(after) + 1
            all.subList(from, minOf(from + 1000, all.size))
        }
        assertEquals(1234, got.size)
        assertEquals(2, seen.size)
        assertEquals("or" to "(listing_id.gt.\"l01000\")", seen[1].last())
    }
    @Test fun `Lesen -- numeric als Text oder Zahl, Datum, null`() {
        val l = ListingsRepository.parseListings("""[{"listing_id":"l1","channel_id":"ebay","channel_name":"eBay","title":null,"description":null,"price":"12.50","status":"aktiv","listed_on":"2026-09-21","sale_id":null,"external_url":null,"note":null,"created_at":"2026-09-21T10:00:00+00:00","deleted":false}]""")
        assertEquals(1250L, l.first().priceCents)
        assertNull(l.first().title)
        val i = ListingsRepository.parseItems("""[{"listing_id":"l1","copy_id":"c1","card_id":"1","set_code":"X","language":"DE","rarity":"Common","edition":"unknown","condition":"NM","name":null,"image_url":null,"deleted":false}]""")
        assertEquals("c1", i.first().copyId)
    }
    @Test fun `Pruefungen wie am PC`() {
        val ok = NewListing("ebay", "eBay", "2026-09-21", 1200, "T", "D", null, null, listOf(li("c1")))
        val live = setOf("c1", "c2"); val ch = setOf("ebay", "cardmarket")
        assertNull(ListingsRepository.checkNew(ok, live, ch))
        assertEquals("Der Angebotspreis muss über 0 € liegen.", ListingsRepository.checkNew(ok.copy(priceCents = 0), live, ch))
        assertEquals("Ungültiges Datum.", ListingsRepository.checkNew(ok.copy(listedOn = "21.09.2026"), live, ch))
        assertEquals("Der Link muss mit http:// oder https:// beginnen.", ListingsRepository.checkNew(ok.copy(externalUrl = "ftp://x"), live, ch))
        assertEquals("Kanal nicht gefunden.", ListingsRepository.checkNew(ok.copy(channelId = "weg"), live, ch))
        assertEquals("Karte bereits verkauft oder gelöscht.", ListingsRepository.checkNew(ok.copy(items = listOf(li("c9"))), live, ch))
        assertTrue(ListingsRepository.checkNew(ok.copy(channelId = "cardmarket", items = listOf(li("c1"), li("c2", "EX"))), live, ch)!!.startsWith("Ein Cardmarket-Angebot"))
        assertEquals("Mindestens eine Karte auswählen.", ListingsRepository.checkNew(ok.copy(items = emptyList()), live, ch))
    }
    @Test fun `Anlegen -- erst Positionen, dann Koepfe; Cardmarket ohne Titel und Text`() {
        val ops = ListingsRepository.createOps(listOf("L1"), listOf(NewListing("cardmarket", "Cardmarket", "2026-09-21", 1001, "X", "Y", " ", null, listOf(li("c2"), li("c1")))))
        assertEquals(listOf("listing_items", "listings"), ops.map { it.table })
        assertTrue(ops.all { it.method == "POST" })
        val items = JSONArray(ops[0].body)
        assertEquals(listOf("c1", "c2"), (0 until items.length()).map { items.getJSONObject(it).getString("copy_id") })
        assertEquals("L1", items.getJSONObject(0).getString("listing_id"))
        val head = JSONArray(ops[1].body).getJSONObject(0)
        assertTrue(head.isNull("title") && head.isNull("description") && head.isNull("external_url"))
        assertEquals(10.01, head.getDouble("price"), 0.0)
        assertEquals("Cardmarket", head.getString("channel_name"))
    }
    @Test fun `Herausnehmen -- letzte Position beendet das Angebot`() {
        val one = ListingsRepository.removeOps("l1", listOf("c1"), listOf("c1", "c2"))
        assertEquals(1, one.size)
        assertEquals(listOf("listing_id" to "eq.l1", "copy_id" to "in.(\"c1\")", "deleted" to "eq.false"), one[0].params)
        val all = ListingsRepository.removeOps("l1", listOf("c2", "c1"), listOf("c1", "c2"))
        assertEquals(2, all.size)
        assertEquals("""{"status":"beendet"}""", all[1].body)
        assertEquals(listOf("listing_id" to "eq.l1", "status" to "eq.aktiv", "deleted" to "eq.false"), all[1].params)
        assertTrue(ListingsRepository.removeOps("l1", listOf("c9"), listOf("c1")).isEmpty())
    }
    @Test fun `Bearbeiten -- nur aktives Angebot, Antwort muss eine Zeile haben`() {
        val ops = ListingsRepository.updateOps(row("l1", "ebay", 12.0), 950, "Neu", "", "https://x", null, emptyList(), listOf("c1"))
        assertEquals(1, ops.size)
        assertTrue(ops[0].expectRow)
        val b = JSONObject(ops[0].body)
        assertEquals(9.5, b.getDouble("price"), 0.0)
        assertTrue(b.isNull("description") && b.isNull("note"))
    }
    @Test fun `Nach book_sale -- Teilverkauf Cardmarket und Aufraeumen der anderen Angebote`() {
        val data = ListingsData(listOf(row("l1", "cardmarket", 10.0), row("l2", "ebay", 12.0)),
            listOf(item("l1", "c1"), item("l1", "c2"), item("l2", "c1"), item("l2", "c3")))
        val (ops, r) = ListingsRepository.afterBookingOps(data, "s1", listOf("c1"), "l1")
        assertEquals(listOf(
            Triple("listing_items", "in.(\"c1\")", """{"deleted":true}"""),
            Triple("listings", null, JSONObject().put("price", 5.0).toString()),
            Triple("listing_items", "in.(\"c1\")", """{"deleted":true}"""),
        ), ops.map { Triple(it.table, it.params.firstOrNull { p -> p.first == "copy_id" }?.second, it.body) })
        assertEquals(listOf("listing_id" to "eq.l2", "copy_id" to "in.(\"c1\")", "deleted" to "eq.false"), ops[2].params)
        assertEquals(listOf("l2"), r.reminders.map { it.listingId })
        assertEquals(false, r.askAdjust)
    }
    @Test fun `Nach book_sale -- ganz verkauft; ohne Angebot nur Aufraeumen; beendetes Angebot wird uebersprungen`() {
        val data = ListingsData(listOf(row("l1", "ebay", 12.0), row("l2", "ebay", 5.0), row("l3", "ebay", 3.0, "beendet")),
            listOf(item("l1", "c1"), item("l2", "c1"), item("l3", "c1")))
        val (whole, r1) = ListingsRepository.afterBookingOps(data, "s1", listOf("c1"), "l1")
        assertEquals(JSONObject().put("status", "verkauft").put("sale_id", "s1").toString(), whole[0].body)
        assertEquals(listOf("listings", "listing_items", "listings"), whole.map { it.table })
        assertEquals("""{"status":"beendet"}""", whole[2].body)
        assertEquals(listOf("l2"), r1.reminders.map { it.listingId })
        val (plain, r2) = ListingsRepository.afterBookingOps(data, "s2", listOf("c1"), null)
        assertEquals(4, plain.size) // l1 und l2: je Position herausnehmen + beenden
        assertEquals(listOf("l1", "l2"), r2.reminders.map { it.listingId })
        val (_, r3) = ListingsRepository.afterBookingOps(data, "s3", listOf("c1"), "l3")
        assertTrue(r3.listingSkipped)
    }
    @Test fun `in-Liste maskiert Anfuehrungszeichen`() {
        assertEquals("in.(\"a\",\"b\\\"c\")", ListingsRepository.inList(listOf("a", "b\"c")))
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen** (Kompilierfehler).

- [ ] **Step 3: `Listing.kt`**

```kotlin
package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.ListingText
import com.example.yugiohscanner.ml.SalesMath

/** Spec H3a §4.2 -- Zeile aus listings. channel_name ist die Momentaufnahme beim Anlegen (wie sales.channel_name). */
data class ListingRow(
    val listingId: String, val channelId: String, val channelName: String, val title: String?, val description: String?,
    val price: Double, val status: String, val listedOn: String, val saleId: String?, val externalUrl: String?,
    val note: String?, val createdAt: String?, val deleted: Boolean,
) {
    val priceCents: Long get() = SalesMath.toCents(price) ?: 0L
    fun head(): ListingText.Head =
        ListingText.Head(listingId, channelId, channelName, title, priceCents, status, listedOn, createdAt, saleId, externalUrl, deleted)
}

/** Spec H3a §4.2 -- Position (Momentaufnahme des Exemplars beim Anlegen; name = Anzeigename, Abweichung 3). */
data class ListingItemRow(
    val listingId: String, val copyId: String, val cardId: String, val setCode: String, val language: String,
    val rarity: String, val edition: String, val condition: String, val name: String?, val imageUrl: String?, val deleted: Boolean,
) {
    fun item(): ListingText.Item = ListingText.Item(copyId, cardId, name, setCode, language, rarity, edition, condition,
        imageUrl = imageUrl, listingId = listingId, deleted = deleted)
}

/** Voll neu geladener Stand (SideStores.listings): alle nicht gelöschten Angebote, nur lebende Positionen. */
data class ListingsData(val listings: List<ListingRow>, val items: List<ListingItemRow>) {
    fun heads(): List<ListingText.Head> = listings.map { it.head() }
    fun lineItems(): List<ListingText.Item> = items.map { it.item() }
    fun liveItemsOf(listingId: String): List<ListingItemRow> = items.filter { it.listingId == listingId && !it.deleted }
    fun byCopy(): Map<String, List<ListingText.Offer>> = ListingText.activeByCopy(heads(), lineItems())
}

/** Eingabe für ein neues Angebot. [items] ist die Momentaufnahme (Name = Anzeigename). */
data class NewListing(
    val channelId: String, val channelName: String, val listedOn: String, val priceCents: Long,
    val title: String?, val description: String?, val externalUrl: String?, val note: String?, val items: List<ListingText.Item>,
)
```

- [ ] **Step 4: `ListingsRepository.kt`**

```kotlin
package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.Keyset
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.ListingText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Spec H3a §4.2/§4.3/§7 -- Angebote über REST (supabase/listings_schema.sql), keine Datenbankfunktion. Bauart wie
 * SalesRepository (Auth-Kopf, executeWithReauth bei 401, Blättern per KeysetPager, PostgREST kappt limit bei 1000).
 * Jede Schreibaktion ist als reine [Op]-Liste beschrieben (testbar ohne Server) und wird der Reihe nach ausgeführt.
 * Abweichung 1: Anlegen schreibt listing_items -> listings -> for_sale nacheinander; ein Abbruch hinterlässt höchstens
 * unsichtbare Positionen ohne Kopf.
 */
object ListingsRepository {
    const val CHANGED = "Angebot wurde inzwischen geändert – bitte neu öffnen."
    private const val LISTING_COLS =
        "listing_id,channel_id,channel_name,title,description,price,status,listed_on,sale_id,external_url,note,created_at,deleted"
    private const val ITEM_COLS = "listing_id,copy_id,card_id,set_code,language,rarity,edition,condition,name,image_url,deleted"
    private val DATE = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
    private val URL_OK = Regex("^https?://", RegexOption.IGNORE_CASE)

    /** Eine REST-Schreibaktion. [expectRow]: PATCH mit return=representation, eine leere Antwort heißt [CHANGED]. */
    data class Op(val method: String, val table: String, val params: List<Pair<String, String>>, val body: String, val expectRow: Boolean = false)
    data class AfterBooking(val reminders: List<ListingText.Remind>, val askAdjust: Boolean, val listingSkipped: Boolean)

    private fun num(o: JSONObject, k: String): Double? {
        if (!o.has(k) || o.isNull(k)) return null
        return when (val v = o.get(k)) { is Number -> v.toDouble(); is String -> v.toDouble(); else -> null }
    }
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    private fun String?.orNull(): Any = this?.trim()?.takeIf { it.isNotEmpty() } ?: JSONObject.NULL

    internal fun parseListings(text: String): List<ListingRow> {
        val a = JSONArray(text)
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            ListingRow(o.getString("listing_id"), o.getString("channel_id"), o.getString("channel_name"), str(o, "title"),
                str(o, "description"), num(o, "price") ?: 0.0, o.getString("status"), o.getString("listed_on").take(10),
                str(o, "sale_id"), str(o, "external_url"), str(o, "note"), str(o, "created_at"), o.optBoolean("deleted", false))
        }
    }
    internal fun parseItems(text: String): List<ListingItemRow> {
        val a = JSONArray(text)
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            ListingItemRow(o.getString("listing_id"), o.getString("copy_id"), o.getString("card_id"), o.getString("set_code"),
                o.getString("language"), o.getString("rarity"), o.getString("edition"), o.getString("condition"),
                str(o, "name"), str(o, "image_url"), o.optBoolean("deleted", false))
        }
    }

    internal fun listingsPageParams(after: String?): List<Pair<String, String>> {
        val p = arrayListOf("select" to LISTING_COLS, "deleted" to "eq.false", "order" to "listing_id.asc", "limit" to StoreQueries.PAGE.toString())
        if (after != null) p += "or" to Keyset.after(listOf("listing_id"), listOf(after))
        return p
    }
    internal fun itemsPageParams(after: ListingItemRow?): List<Pair<String, String>> {
        val p = arrayListOf("select" to ITEM_COLS, "deleted" to "eq.false", "order" to "listing_id.asc,copy_id.asc", "limit" to StoreQueries.PAGE.toString())
        if (after != null) p += "or" to Keyset.after(listOf("listing_id", "copy_id"), listOf(after.listingId, after.copyId))
        return p
    }

    suspend fun load(): ListingsData {
        val listings = KeysetPager.all(StoreQueries.PAGE) { after: ListingRow? ->
            parseListings(getText("listings", listingsPageParams(after?.listingId), "Angebote laden"))
        }
        val items = KeysetPager.all(StoreQueries.PAGE) { after: ListingItemRow? ->
            parseItems(getText("listing_items", itemsPageParams(after), "Positionen laden"))
        }
        return ListingsData(listings, items)
    }

    internal fun inList(ids: List<String>) = "in.(${ids.joinToString(",") { Keyset.quote(it) }})"
    private fun activeFilter(id: String) = listOf("listing_id" to "eq.$id", "status" to "eq.aktiv", "deleted" to "eq.false")
    private fun itemsFilter(listingId: String, copyIds: List<String>) =
        listOf("listing_id" to "eq.$listingId", "copy_id" to inList(copyIds), "deleted" to "eq.false")
    private val DELETED = JSONObject().put("deleted", true).toString()
    private val ENDED = JSONObject().put("status", "beendet").toString()

    /** Spec §5.7 -- dieselben Prüfungen und Texte wie listings.cjs#createOne, in derselben Reihenfolge. */
    internal fun checkNew(l: NewListing, liveCopyIds: Set<String>, liveChannelIds: Set<String>): String? = when {
        l.items.isEmpty() -> "Mindestens eine Karte auswählen."
        !DATE.matches(l.listedOn) -> "Ungültiges Datum."
        l.priceCents <= 0 -> "Der Angebotspreis muss über 0 € liegen."
        !l.externalUrl.isNullOrBlank() && !URL_OK.containsMatchIn(l.externalUrl.trim()) -> "Der Link muss mit http:// oder https:// beginnen."
        l.channelId !in liveChannelIds -> "Kanal nicht gefunden."
        l.items.any { it.copyId !in liveCopyIds } -> "Karte bereits verkauft oder gelöscht."
        l.channelId == "cardmarket" && ListingText.groupItems(l.items).size != 1 ->
            "Ein Cardmarket-Angebot enthält nur gleiche Karten (Druck, Sprache, Zustand, Auflage)."
        else -> null
    }

    internal fun createOps(ids: List<String>, list: List<NewListing>): List<Op> {
        val items = JSONArray()
        val heads = JSONArray()
        list.forEachIndexed { i, l ->
            val id = ids[i]
            val cm = l.channelId == "cardmarket"
            heads.put(JSONObject().put("listing_id", id).put("channel_id", l.channelId).put("channel_name", l.channelName)
                .put("title", if (cm) JSONObject.NULL else l.title.orNull())
                .put("description", if (cm) JSONObject.NULL else l.description.orNull())
                .put("price", l.priceCents / 100.0).put("listed_on", l.listedOn)
                .put("external_url", l.externalUrl.orNull()).put("note", l.note.orNull()))
            for (item in l.items.sortedBy { it.copyId }) {
                items.put(JSONObject().put("listing_id", id).put("copy_id", item.copyId).put("card_id", item.cardId)
                    .put("set_code", item.setCode).put("language", item.language).put("rarity", item.rarity).put("edition", item.edition)
                    .put("condition", item.condition).put("name", item.name ?: JSONObject.NULL).put("image_url", item.imageUrl ?: JSONObject.NULL))
            }
        }
        return listOf(Op("POST", "listing_items", emptyList(), items.toString()), Op("POST", "listings", emptyList(), heads.toString()))
    }

    /** Legt die Angebote an und setzt danach for_sale (Spec §5.2). Gibt die neuen listing_ids zurück. */
    suspend fun create(list: List<NewListing>): List<String> {
        val ids = list.map { UUID.randomUUID().toString() }
        run(createOps(ids, list))
        try {
            CollectionRepository.setForSale(list.flatMap { l -> l.items.map { it.copyId } }.distinct(), true)
        } catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: Exception) { throw IllegalStateException("Angebot gespeichert, „Zum Verkauf“ nicht gesetzt: ${e.message}") }
        return ids
    }

    internal fun removeOps(listingId: String, removeCopyIds: List<String>, liveCopyIds: List<String>): List<Op> {
        val live = liveCopyIds.distinct()
        val remove = removeCopyIds.distinct().filter { it in live }.sorted()
        if (remove.isEmpty()) return emptyList()
        val ops = arrayListOf(Op("PATCH", "listing_items", itemsFilter(listingId, remove), DELETED))
        if (live.all { it in remove }) ops += Op("PATCH", "listings", activeFilter(listingId), ENDED)
        return ops
    }

    internal fun updateOps(
        l: ListingRow, priceCents: Long, title: String?, description: String?, externalUrl: String?, note: String?,
        removeCopyIds: List<String>, liveCopyIds: List<String>,
    ): List<Op> {
        val cm = l.channelId == "cardmarket"
        val body = JSONObject().put("price", priceCents / 100.0)
            .put("title", if (cm) JSONObject.NULL else title.orNull())
            .put("description", if (cm) JSONObject.NULL else description.orNull())
            .put("external_url", externalUrl.orNull()).put("note", note.orNull())
        return listOf(Op("PATCH", "listings", activeFilter(l.listingId), body.toString(), expectRow = true)) +
            removeOps(l.listingId, removeCopyIds, liveCopyIds)
    }

    /** Bearbeiten; [fresh] = innerhalb des InFlight-Gatters frisch geladen. -> true, wenn das Angebot dabei endete. */
    suspend fun update(fresh: ListingsData, listingId: String, priceCents: Long, title: String?, description: String?,
                       externalUrl: String?, note: String?, removeCopyIds: List<String>): Boolean {
        val l = fresh.listings.find { it.listingId == listingId && it.status == "aktiv" } ?: throw IllegalStateException(CHANGED)
        val live = fresh.liveItemsOf(listingId).map { it.copyId }
        val ops = updateOps(l, priceCents, title, description, externalUrl, note, removeCopyIds, live)
        run(ops)
        return ops.any { it.body == ENDED }
    }

    /** "Karte fehlt" antippen / Position herausnehmen. -> true, wenn das Angebot dabei endete. */
    suspend fun removeItems(fresh: ListingsData, listingId: String, copyIds: List<String>): Boolean {
        if (fresh.listings.none { it.listingId == listingId && it.status == "aktiv" }) throw IllegalStateException(CHANGED)
        val ops = removeOps(listingId, copyIds, fresh.liveItemsOf(listingId).map { it.copyId })
        run(ops)
        return ops.any { it.body == ENDED }
    }

    internal fun endOps(listingId: String): List<Op> = listOf(Op("PATCH", "listings", activeFilter(listingId), ENDED))
    suspend fun end(listingId: String) = run(endOps(listingId))

    /**
     * Spec §7.1/§7.2 -- nach erfolgreichem book_sale: das Angebot, aus dem verkauft wurde, verkauft/teilweise verkauft,
     * danach die verkauften Exemplare aus allen ANDEREN aktiven Angeboten nehmen. [data] frisch geladen.
     * Gegenstück: listings.cjs#applySaleToListings (dort in der bookSale-Transaktion).
     */
    internal fun afterBookingOps(data: ListingsData, saleId: String, soldCopyIds: List<String>, fromListingId: String?): Pair<List<Op>, AfterBooking> {
        val ops = ArrayList<Op>()
        var askAdjust = false
        var skipped = false
        if (fromListingId != null) {
            val l = data.listings.find { it.listingId == fromListingId }
            if (l == null || l.status != "aktiv" || l.deleted) {
                skipped = true
            } else {
                val live = data.liveItemsOf(l.listingId).map { it.copyId }
                val r = ListingText.afterListingSale(l.channelId, l.status, l.priceCents, live, soldCopyIds)
                if (r.status == "verkauft") {
                    ops += Op("PATCH", "listings", activeFilter(l.listingId), JSONObject().put("status", "verkauft").put("sale_id", saleId).toString())
                } else {
                    if (r.removeCopyIds.isNotEmpty()) ops += Op("PATCH", "listing_items", itemsFilter(l.listingId, r.removeCopyIds), DELETED)
                    if (r.priceCents != l.priceCents) ops += Op("PATCH", "listings", activeFilter(l.listingId), JSONObject().put("price", r.priceCents / 100.0).toString())
                }
                askAdjust = r.askAdjust
            }
        }
        val c = ListingText.cleanupAfterSale(data.heads(), data.lineItems(), soldCopyIds, if (skipped) null else fromListingId)
        for ((lid, list) in c.removeItems.groupBy { it.listingId }) ops += Op("PATCH", "listing_items", itemsFilter(lid, list.map { it.copyId }), DELETED)
        for (lid in c.endListings) ops += Op("PATCH", "listings", activeFilter(lid), ENDED)
        return ops to AfterBooking(c.remind, askAdjust, skipped)
    }

    suspend fun afterBooking(data: ListingsData, saleId: String, soldCopyIds: List<String>, fromListingId: String?): AfterBooking {
        val (ops, r) = afterBookingOps(data, saleId, soldCopyIds, fromListingId)
        run(ops)
        return r
    }

    private suspend fun run(ops: List<Op>) = withContext(Dispatchers.IO) {
        for (op in ops) {
            executeWithReauth {
                val b = base(url(op.table, op.params)).addHeader("Content-Type", "application/json")
                    .addHeader("Prefer", if (op.expectRow) "return=representation" else "return=minimal")
                val body = op.body.toRequestBody(SupabaseCloud.jsonMedia)
                (if (op.method == "POST") b.post(body) else b.patch(body)).build()
            }.use { r ->
                val text = r.body?.string()
                if (!r.isSuccessful) throw RuntimeException(SalesRepository.dbErrorMessage(text, r.code))
                if (op.expectRow && (text.isNullOrBlank() || JSONArray(text).length() == 0)) throw IllegalStateException(CHANGED)
            }
        }
    }

    private fun url(table: String, params: List<Pair<String, String>>): HttpUrl =
        "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder()
            .apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()

    private suspend fun getText(table: String, params: List<Pair<String, String>>, what: String): String = withContext(Dispatchers.IO) {
        executeWithReauth { base(url(table, params)).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("$what fehlgeschlagen (${r.code}): $text")
            text
        }
    }

    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url).addHeader("apikey", SupabaseCloud.key()).addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")

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

Hinweis: `JSONObject().put("price", 5.0).toString()` schreibt org.json als `{"price":5}` — der Test vergleicht deshalb gegen denselben Aufbau, nie gegen ein festes Literal mit Nachkommastellen. PostgREST nimmt beide Formen.

- [ ] **Step 5: `SideStores.kt`**

Nach `val sales = …`: `// Spec H3a §4.3: Angebote. Voll neu laden (geblättert), wie sales.` und `val listings = ListCache(scope) { ListingsRepository.load() }`; in `clearAll()` `listings.clear()` nach `sales.clear()`.

- [ ] **Step 6: Android-Tests grün** (+11), Regex-Wächter grün.

- [ ] **Step 7: Schutz-Nachweis**

In `afterBookingOps` beim Aufräumen `if (skipped) null else fromListingId` durch `null` ersetzen. „Teilverkauf Cardmarket und Aufraeumen“ scheitert (eine zusätzliche Op für l1). Zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/cloud/Listing.kt android/app/src/main/java/com/example/yugiohscanner/cloud/ListingsRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt android/app/src/test/java/com/example/yugiohscanner/ListingsRepositoryTest.kt
git commit -m "feat(h3a): Handy-Daten fuer Angebote mit Schluessel-Blaettern und REST-Nutzlasten

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Handy — Angebot erstellen, Teilen der Bilder (FileProvider), Einstiege

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/ListingSheet.kt`, `ui/ListingShare.kt`
- Create: `android/app/src/main/res/xml/file_paths.xml`
- Create: `android/app/src/test/java/com/example/yugiohscanner/ListingShareConfigTest.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`, `android/.../ui/SaleLists.kt` (`ForSaleList`), `android/.../ui/CopySheet.kt`

**Interfaces:**
- Consumes: `ListingsRepository`, `SideStores.listings`, `SideStores.sales` (Kanäle), `CollectionStore`, `CatalogRepository.aliases/importRows`, `Prefs.saleSuggestion`, `ListingText`, `InFlight`.
- Produces:
  - `data class ListingPrefill(val channelId: String, val title: String?, val description: String?, val priceCents: Long?)`
  - `@Composable fun ListingSheet(copyIds: List<String>, prefill: ListingPrefill? = null, onDismiss: () -> Unit, onSaved: (List<String>) -> Unit)`
  - `object ListingShare { const val CACHE_DIR = "listing_images"; const val AUTHORITY_SUFFIX = ".fileprovider"; fun fileName(index: Int, url: String): String; suspend fun shareImages(ctx: Context, title: String, urls: List<String>): Pair<Int, Int> }`

- [ ] **Step 1: Failing Test (Konfiguration + Dateinamen)**

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.ui.ListingShare
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Spec H3a §5.6 -- Bilder teilen braucht einen FileProvider. Ohne ihn wirft getUriForFile erst am Gerät; diese Tests
 * lesen Manifest und Pfad-Datei (wie AndroidRegexWaechterTest die Quellen), damit Code und Konfiguration zusammenpassen.
 */
class ListingShareConfigTest {
    @Test fun `Manifest meldet den FileProvider mit passender Authority und Pfad-Datei`() {
        val m = File("src/main/AndroidManifest.xml").readText()
        assertTrue(m.contains("androidx.core.content.FileProvider"))
        assertTrue(m.contains("android:authorities=\"\${applicationId}${ListingShare.AUTHORITY_SUFFIX}\""))
        assertTrue(m.contains("android:exported=\"false\""))
        assertTrue(m.contains("android:grantUriPermissions=\"true\""))
        assertTrue(m.contains("@xml/file_paths"))
    }
    @Test fun `Pfad-Datei gibt genau den Cache-Ordner der Bilder frei`() {
        val x = File("src/main/res/xml/file_paths.xml").readText()
        assertTrue(x.contains("<cache-path"))
        assertTrue(x.contains("path=\"${ListingShare.CACHE_DIR}/\""))
    }
    @Test fun `Dateinamen wie am PC`() {
        assertEquals("01.jpg", ListingShare.fileName(0, "https://a/b/46986414.jpg"))
        assertEquals("10.png", ListingShare.fileName(9, "https://a/b/x.PNG?v=2"))
        assertEquals("03.jpg", ListingShare.fileName(2, "https://a/b/x"))
    }
}
```

Fehlschlag bestätigen (Kompilierfehler `ListingShare`).

- [ ] **Step 2: FileProvider anlegen**

`android/app/src/main/res/xml/file_paths.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- Spec H3a §5.6: nur der Cache-Ordner der Angebotsbilder wird über den FileProvider geteilt (ListingShare.CACHE_DIR). -->
<paths>
    <cache-path name="listing_images" path="listing_images/" />
</paths>
```

In `AndroidManifest.xml` innerhalb von `<application>`, nach `</activity>`:

```xml
        <!-- Spec H3a §5.6: Angebotsbilder über das Teilen-Menü (ListingShare). Nur der Cache-Ordner, nur mit Leserecht je Teilen. -->
        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths" />
        </provider>
```

- [ ] **Step 3: `ListingShare.kt`**

```kotlin
package com.example.yugiohscanner.ui

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.example.yugiohscanner.cloud.SupabaseCloud
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.util.Locale

/**
 * Spec H3a §5.6 -- Katalogbilder in den App-Cache laden und über das Android-Teilen-Menü teilen. Nicht ladbare Bilder
 * werden übersprungen; nur https. Dateinamen wie am PC (listing-images.cjs#imageFileName). Gleichnamige Dateien werden
 * beim nächsten Teilen überschrieben; geteilt werden nur die in diesem Lauf geschriebenen.
 */
object ListingShare {
    const val CACHE_DIR = "listing_images"
    const val AUTHORITY_SUFFIX = ".fileprovider"
    private val EXT = Regex("\\.(jpe?g|png|webp)(?:$|\\?)", RegexOption.IGNORE_CASE)

    fun fileName(index: Int, url: String): String =
        String.format(Locale.ROOT, "%02d", index + 1) + (EXT.find(url)?.groupValues?.get(1)?.lowercase(Locale.ROOT)?.let { ".$it" } ?: ".jpg")

    /** -> (geteilt, gesamt). Öffnet das Teilen-Menü nur, wenn mindestens ein Bild geladen wurde. */
    suspend fun shareImages(ctx: Context, title: String, urls: List<String>): Pair<Int, Int> {
        val list = urls.filter { it.isNotEmpty() }.distinct()
        val uris = ArrayList<Uri>()
        withContext(Dispatchers.IO) {
            val dir = File(ctx.cacheDir, CACHE_DIR).apply { mkdirs() }
            list.forEachIndexed { i, u ->
                if (!u.startsWith("https://", ignoreCase = true)) return@forEachIndexed
                try {
                    SupabaseCloud.http().newCall(Request.Builder().url(u).build()).execute().use { r ->
                        val bytes = if (r.isSuccessful) r.body?.bytes() else null
                        if (bytes != null && bytes.isNotEmpty()) {
                            val f = File(dir, fileName(i, u))
                            f.writeBytes(bytes)
                            uris += FileProvider.getUriForFile(ctx, ctx.packageName + AUTHORITY_SUFFIX, f)
                        }
                    }
                } catch (e: CancellationException) { throw e }
                catch (_: Exception) { /* Bild übersprungen (Spec §5.6) */ }
            }
        }
        if (uris.isNotEmpty()) {
            val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = "image/*"
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
                putExtra(Intent.EXTRA_TITLE, title)
                // Leserecht muss über ClipData auch den Auswahldialog erreichen.
                clipData = ClipData.newRawUri(title, uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ctx.startActivity(Intent.createChooser(send, "Bilder teilen").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }
        return uris.size to list.size
    }
}
```

- [ ] **Step 4: `ListingSheet.kt`**

`ModalBottomSheet` wie `SaleSheet` (Wischen gesperrt, solange `busy`). Aufbau:

- **Sperre:** `val listingsState by SideStores.listings.state.collectAsState()`, `val salesState by SideStores.sales.state.collectAsState()`, `LaunchedEffect(Unit) { SideStores.listings.ensureLoaded(); SideStores.sales.ensureLoaded() }`. `offline = listingsState.value == null || listingsState.error != null || salesState.value == null || salesState.error != null` → Zeile „Keine Verbindung – Angebote nicht geladen“ (`ErrorColor`) + „Erneut versuchen“ (`SideStores.listings.refresh(); SideStores.sales.refresh()`), Speichern gesperrt.
- **Namen** (Abweichung 3), abseits des Hauptthreads, einmal je `copyIds`:

```kotlin
    val names by produceState<Map<String, Pair<String?, String?>>?>(null, ready?.cards, copyIds) {
        val r = ready ?: return@produceState
        val ids = r.copies.filter { it.copyId in copyIds }.map { it.cardId }.distinct()
        value = withContext(Dispatchers.IO) {
            runCatching {
                val main = CatalogRepository.aliases(ids)
                val rows = CatalogRepository.importRows(ids.map { main[it] ?: it }).associateBy { it.id }
                ids.associateWith { id -> rows[main[id] ?: id]?.let { it.nameDe?.takeIf { s -> s.isNotEmpty() } to it.nameEn?.takeIf { s -> s.isNotEmpty() } } ?: (null to null) }
            }.getOrDefault(emptyMap())
        }
    }
```

- **Positionen** aus dem Speicher (rein, als private Funktion wie `saleValues` im `SaleSheet`):

```kotlin
private fun listingItems(ready: StoreState.Ready, copyIds: List<String>, names: Map<String, Pair<String?, String?>>): List<ListingText.Item>? {
    val copies = ready.copies.associateBy { it.copyId }
    val cards = ready.cards.associateBy { it.printingKey() }
    return copyIds.sorted().map { id ->
        val copy = copies[id] ?: return null
        val card = cards[copy.printingKey()] ?: return null
        val (de, en) = names[copy.cardId] ?: (null to null)
        ListingText.Item(copy.copyId, copy.cardId, de ?: card.name, copy.setCode, copy.language, copy.rarity, copy.edition, copy.condition,
            nameEn = en ?: card.name, imageUrl = card.imageUrl)
    }
}
```

  Fehlt ein Exemplar: „Karte nicht mehr in der Sammlung“, Speichern gesperrt. Vorschlag je Exemplar `Prefs.saleSuggestion(ctx, SalesMath.marketValueCents(card, copy))`.
- **Felder** wie am PC: Kanal (`ExposedDropdownMenuBox` über `salesState.value.channels`, Vorbelegung `prefill?.channelId`, sonst `cardmarket`; ausgeblendeter Kanal → erster lebender), Datum (`LocalDate.now().toString()`, `SaleInput.dateOk`), Preis (`SaleInput.parseMoney`/`moneyOk`, vorbelegt `prefill?.priceCents ?: ListingText.suggestionSum(Vorschläge)`, sonst leer), Titel mit Zähler „n/65“ (rot > 65, Vorbelegung `ListingText.listingTitle(items)` bis zur ersten Eingabe), Beschreibung (`ListingText.listingDescription(items, preisCents)` bis zur ersten Eingabe), Link der Anzeige, Notiz. „auch auf <Kanäle> eingestellt“ je Exemplar aus `listingsState.value.byCopy()[copyId]` (Namen über `channelName`, ohne Doppel).
- **Cardmarket:** Gruppen `ListingText.groupItems(items)`; bei > 1 „wird zu N Cardmarket-Angeboten“; je Gruppe `ListingText.cardmarketEntry(g, preisCents)` anzeigen (Produkt, Menge, Sprache, Zustand, 1. Auflage ja/nein, Preis je Stück), eigene Preis-Eingabe je Gruppe (Vorbelegung Vorschlags-Summe der Gruppe). Kein Titel, keine Beschreibung.
- **Knöpfe:** „Titel kopieren“/„Beschreibung kopieren“ (`LocalClipboardManager.current.setText(AnnotatedString(text))`, Hinweis „Kopiert.“); „Zum Einstellen öffnen“ nur, wenn `ListingText.listingLink(channelId, null, first.nameEn, first.setCode)` nicht `null` ist (am Handy nie `cm_url`, Befund 2) → `runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }`; „Bilder“ → `scope.launch { val (s, t) = ListingShare.shareImages(ctx, title, ListingText.imageUrls(items)); notice = ListingText.imagesText(s, t) }`; Hinweis „Käufer erwarten oft eigene Fotos.“; „Angebot speichern“.
- **Speichern** über `InFlight`, alles frisch innerhalb des Gatters:

```kotlin
    fun save() {
        if (!inFlight.tryStart()) return
        busy = true; error = null
        scope.launch {
            try {
                SideStores.listings.refreshAndWait()
                val fresh = CollectionStore.state.value as? StoreState.Ready ?: throw IllegalStateException("Sammlung ist nicht geladen.")
                val its = listingItems(fresh, copyIds, names ?: emptyMap()) ?: throw IllegalStateException("Karte bereits verkauft oder gelöscht.")
                val ch = SideStores.sales.state.value.value?.channels?.find { it.channelId == channelId } ?: throw IllegalStateException("Kanal nicht gefunden.")
                val list = if (ch.channelId == "cardmarket") ListingText.groupItems(its).map { g ->
                    NewListing(ch.channelId, ch.name, date.trim(), groupCents(g) ?: 0L, null, null, link, note, its.filter { it.copyId in g.copyIds })
                } else listOf(NewListing(ch.channelId, ch.name, date.trim(), priceCents ?: 0L, title, description, link, note, its))
                val liveIds = fresh.copies.map { it.copyId }.toSet()
                val chIds = SideStores.sales.state.value.value?.channels?.map { it.channelId }?.toSet() ?: emptySet()
                list.firstNotNullOfOrNull { ListingsRepository.checkNew(it, liveIds, chIds) }?.let { throw IllegalStateException(it) }
                val ids = ListingsRepository.create(list)
                try { CollectionStore.awaitSync(); SideStores.listings.refreshAndWait() } catch (e: CancellationException) { throw e } catch (_: Exception) { }
                onSaved(ids)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = "Nicht gespeichert: ${e.message ?: "Unbekannter Fehler"}" }
            finally { inFlight.finish(); busy = false }
        }
    }
```

  (`groupCents(g)` = geparste Gruppen-Eingabe in Cent; `link`/`note` = getrimmte Eingaben oder `null`.) Scheitert nur `for_sale` („Angebot gespeichert, …“), steht die Meldung ebenso da; das Angebot existiert dann und erscheint nach dem Nachladen.

- [ ] **Step 5: Einstieg Verkaufsliste (`SaleLists.kt#ForSaleList`)**

- `var listingFor by remember { mutableStateOf<List<String>?>(null) }`.
- **Eine** Aufrufstelle direkt neben `selling?.let { SaleSheet(…) }` — also VOR dem frühen `return` (Zeile 225–229): `listingFor?.let { ListingSheet(it, onDismiss = { listingFor = null }, onSaved = { listingFor = null; picked = emptySet() }) }`.
- Neben „Verkauft buchen (n)“: `OutlinedButton(onClick = { listingFor = livePicked }, enabled = !busy && livePicked.isNotEmpty()) { Text("Angebot erstellen (${livePicked.size})") }` (beide Knöpfe in einer `Row` mit `Arrangement.spacedBy(8.dp)`).
- Kanal-Kürzel: `val listingsState by SideStores.listings.state.collectAsState()`, `LaunchedEffect(Unit) { SideStores.listings.ensureLoaded() }`, `val byCopy = remember(listingsState.value) { listingsState.value?.byCopy() ?: emptyMap() }`; je Exemplar-Zeile nach dem Standort `ListingText.copyBadges(byCopy[id] ?: emptyList()).joinToString(" ")` als `labelSmall` in `Primary` (leer → nichts).

- [ ] **Step 6: Einstieg Exemplar-Sheet (`CopySheet.kt`)**

Neben „Verkauft…“ (Zeile 296–297) `TextButton(onClick = { if (!savingRef[0]) listing = true }, enabled = !saving && !removing && !markingSale) { Text("Anbieten…") }` mit `var listing by remember { mutableStateOf(false) }`; neben dem `SaleSheet`-Aufruf (Zeile 311–313): `if (listing) ListingSheet(listOf(copy.copyId), onDismiss = { listing = false }, onSaved = { listing = false; onSaved() })`.

- [ ] **Step 7: Prüfen**

Android-Befehl → `BUILD SUCCESSFUL`, Testzahl + 3, `AndroidRegexWaechterTest` grün.

- [ ] **Step 8: Schutz-Nachweis**

Im Manifest `android:authorities` auf `${applicationId}.files` ändern. `Manifest meldet den FileProvider …` scheitert. Zitieren, zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ListingSheet.kt android/app/src/main/java/com/example/yugiohscanner/ui/ListingShare.kt android/app/src/main/res/xml/file_paths.xml android/app/src/main/AndroidManifest.xml android/app/src/main/java/com/example/yugiohscanner/ui/SaleLists.kt android/app/src/main/java/com/example/yugiohscanner/ui/CopySheet.kt android/app/src/test/java/com/example/yugiohscanner/ListingShareConfigTest.kt
git commit -m "feat(h3a): Handy Angebot erstellen, Bilder teilen ueber FileProvider, Kanal-Kuerzel in der Verkaufsliste

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Handy — Übersicht, Detail, Marken, Kartenansicht, Start; Verkauft/Teilverkauf und Aufräumen nach `book_sale`

**Files:**
- Create: `android/app/src/main/java/com/example/yugiohscanner/ui/ListingsScreen.kt`
- Modify: `android/.../ui/SaleLists.kt` (`CollectionChip.ANGEBOTE`), `ui/CollectionScreen.kt`, `ui/CardDetailScreen.kt`, `ui/StartScreen.kt`, `ui/AppNav.kt`, `ui/SaleSheet.kt`

**Interfaces:**
- Consumes: `SideStores.listings`, `ListingsRepository`, `ListingText`, `ListingSheet`/`ListingPrefill` (Task 10), `SaleSheet`, `CollectionStore`, `Prefs.saleSuggestion`, `SalesMath`.
- Produces:
  - `CollectionChip.ANGEBOTE = "angebote"`.
  - `@Composable fun ListingsSection(onOpenCard: (String) -> Unit, modifier: Modifier = Modifier)` (enthält Liste, Detail-Sheet und die einzigen Aufrufstellen von `SaleSheet`/`ListingSheet` für diesen Bereich).
  - `data class ListingSale(val listingId: String, val channelId: String, val priceCents: Long)`; `SaleSheet(copyIds, initialGrossCents = null, listing: ListingSale? = null, onAdjustListing: (() -> Unit)? = null, onDismiss, onBooked)`.
  - `StartScreen(…, onOpenListings: () -> Unit)`.

- [ ] **Step 1: `SaleSheet.kt` — Vorbelegung, Teilverkauf, Aufräumen, Erinnerung**

1. Signatur um `listing: ListingSale? = null` und `onAdjustListing: (() -> Unit)? = null` erweitern (nach `initialGrossCents`; bestehende Aufrufer bleiben gültig). `data class ListingSale` steht oben in der Datei.
2. `var channelId` vorbelegen: `remember { mutableStateOf<String?>(listing?.channelId) }` (fehlt der Kanal in `channels`, greift der bestehende Rückfall auf `cardmarket`).
3. Mit `listing`: `var picked by remember { mutableStateOf(copyIds.toSet()) }`, je Exemplar eine `Checkbox` (Name aus dem Speicher, Druck, Zustand); `saleValues(it, copyIds.filter { id -> id in picked })` statt `copyIds`; Buchen gesperrt bei `picked.isEmpty()`. Ohne `listing` gilt `picked = copyIds` (unverändert).
4. Zustand `var done by remember { mutableStateOf<DoneStep?>(null) }` mit `private data class DoneStep(val saleId: String, val count: Int, val after: ListingsRepository.AfterBooking?, val cleanupError: String?)`.
5. In `book()` nach „Gebucht ist gebucht“ (Zeile 188–191) und VOR `onBooked` — weiterhin innerhalb des `InFlight`-Gatters:

```kotlin
                // Spec H3a §7.2: nach JEDEM book_sale aufräumen. Scheitert das, bleibt der Verkauf gültig; die
                // Angebote zeigen dann "Karte fehlt".
                var after: ListingsRepository.AfterBooking? = null
                var cleanupError: String? = null
                try {
                    SideStores.listings.refreshAndWait()
                    val ls = SideStores.listings.state.value
                    val data = ls.value
                    if (data == null || ls.error != null) throw IllegalStateException("Angebote nicht geladen.")
                    after = ListingsRepository.afterBooking(data, saleId, bookedIds, listing?.listingId)
                    SideStores.listings.refreshAndWait()
                } catch (e: CancellationException) { throw e }
                catch (e: Exception) { cleanupError = e.message ?: "Unbekannter Fehler" }
                if (cleanupError != null || after?.reminders?.isNotEmpty() == true || after?.askAdjust == true || after?.listingSkipped == true) {
                    done = DoneStep(saleId, count, after, cleanupError)
                } else onBooked(saleId, count)
```

   (`bookedIds` wie `saleId`/`count` vor dem inneren `try` als `val bookedIds: List<String>` deklarieren und dort mit `items.map { it.first }` belegen — die Liste, mit der `SalesRepository.book` gebucht hat.)
6. Abschluss-Schritt: Solange `done != null`, zeigt das Sheet statt des Formulars „Gebucht.“; `cleanupError` → „Angebote nicht aufgeräumt: <Meldung> – sie zeigen „Karte fehlt“.“ (`ErrorColor`); `listingSkipped` → „Angebot war nicht mehr aktiv – nur der Verkauf wurde gebucht.“; Erinnerungen „Auch dort herausnehmen:“ je Zeile `"${r.channelName} – ${r.title}"` plus `TextButton("Anzeige öffnen")` (`ACTION_VIEW`) bei `externalUrl`; `askAdjust` → „Preis für die übrigen Karten anpassen?“ + `TextButton("Bearbeiten") { onBooked(...); onAdjustListing?.invoke() }`; Knopf „Fertig“ → `onBooked(done.saleId, done.count)`. `onDismissRequest` ruft im Abschluss-Schritt ebenfalls `onBooked` (nicht `onDismiss`), damit die Aufrufer ihren Stand (Rückgängig-Zeile, Auswahl) wie nach einem Buchen setzen.

- [ ] **Step 2: `ListingsScreen.kt`**

`ListingsSection(onOpenCard, modifier)`:
- `val state by SideStores.listings.state.collectAsState()`, `LaunchedEffect(Unit) { SideStores.listings.refresh() }` (frischer Stand beim Öffnen, H2-Fix I2). `val store by CollectionStore.state.collectAsState()`, `val ready = store as? StoreState.Ready`.
- **Einzige Aufrufstellen**, ganz oben vor jedem frühen `return`: `var openId by rememberSaveable { mutableStateOf<String?>(null) }`, `var editRequested by remember { mutableStateOf(false) }`, `var selling by remember { mutableStateOf<Pair<List<String>, ListingSale>?>(null) }`, `var relist by remember { mutableStateOf<Pair<List<String>, ListingPrefill>?>(null) }`; dann

```kotlin
    selling?.let { (ids, l) ->
        SaleSheet(ids, initialGrossCents = l.priceCents, listing = l, onAdjustListing = { openId = l.listingId; editRequested = true },
            onDismiss = { selling = null }, onBooked = { _, _ -> selling = null })
    }
    relist?.let { (ids, p) -> ListingSheet(ids, prefill = p, onDismiss = { relist = null }, onSaved = { relist = null }) }
    openId?.let { id ->
        ListingDetailSheet(id, startEditing = editRequested, onDismiss = { openId = null; editRequested = false }, onOpenCard = onOpenCard,
            onSell = { ids, l -> openId = null; selling = ids to l }, onRelist = { ids, p -> openId = null; relist = ids to p })
    }
```

- `state.value == null` → „…“ (bzw. bei `error` „Keine Verbindung – Angebote nicht geladen“ + „Erneut versuchen“) und `return`.
- Rechnen per `remember(state.value, ready)`: `heads = data.heads()`, `items = data.lineItems()`, `copyLive = { id -> ready.copies.any … }` (einmal als `Set` der lebenden `copyId`s), `suggestionOf = { id -> Exemplar + Druck aus ready → Prefs.saleSuggestion(ctx, SalesMath.marketValueCents(card, copy)) }`, `saleStatusOf` aus `SideStores.sales.state.value.value?.sales` (`SaleHead.status` je `saleId`; ungeladen → `null`, dann keine Storno-Marke), `marks = ListingText.listingMarks(...)`, `rows = ListingText.sortListings(heads)`, Marktwert je Angebot = Σ `SalesMath.marketValueCents(card, copy)` über lebende Positionen mit lebendem Exemplar.
- Filter wie am PC (`FilterChip`s „Aktiv“ · „Verkauft“ · „Beendet“ · „Alle“ in einer `Row(Modifier.horizontalScroll(rememberScrollState()))`, dazu Kanal-Auswahl), Kopf `ListingText.summaryText(ListingText.listingsSummary(gefiltert, items))` bei aktiv/alle, Zeilen und Marken mit denselben Texten wie am PC (`rowTitle`, „N Karten“, Preis, `sinceText(daysSince(listedOn, LocalDate.now().toString()))`, `SalesMath.diffText(priceCents, marketCents)`, „auch auf …“, „Karte fehlt“, „Preis unter Vorschlag“, „Verkauf storniert“), `LazyColumn` mit `key = { it.listingId }`.

`ListingDetailSheet(listingId, startEditing, onDismiss, onOpenCard, onSell, onRelist)` (`ModalBottomSheet`, `LaunchedEffect(listingId) { SideStores.listings.refresh() }`):
- Kopf, Positionen (Bild `AsyncImage`, Name, Druck, Zustand, heutiger Marktwert oder „–“; fehlt das Exemplar im Speicher: Marke „Karte fehlt“ + `TextButton("Herausnehmen")`).
- Knöpfe wie am PC: Titel/Beschreibung kopieren, Bilder (`ListingShare.shareImages`), Anzeige öffnen / Link nachtragen, Bearbeiten (inline, `startEditing` öffnet es sofort), Verkauft, Beenden (`AlertDialog` „Angebot beenden?“ / „Die Karten bleiben auf der Verkaufsliste.“), Erneut anbieten (beendet/verkauft).
- **Jede Schreibaktion** über `InFlight`: zuerst `SideStores.listings.refreshAndWait()`, dann den frischen Stand lesen; ist das Angebot nicht mehr aktiv → `error = ListingsRepository.CHANGED` ohne Aufruf. Sonst `ListingsRepository.update(fresh, …)` / `removeItems(fresh, …)` / `end(id)`, danach `CollectionStore.awaitSync()` (nur wenn nötig) und `SideStores.listings.refreshAndWait()`. Ein `IllegalStateException(CHANGED)` aus dem Repository zeigt dieselbe Meldung.
- **Verkauft:** `onSell(lebende Positionen mit lebendem Exemplar, ListingSale(id, channelId, priceCents))`; keine solche → „Keine verkaufbare Karte – bitte herausnehmen oder beenden.“
- **Erneut anbieten:** `onRelist(lebende Positionen mit lebendem Exemplar, ListingPrefill(channelId, title, description, priceCents))`; leer → „Keine Karte mehr verfügbar.“
- Gesperrt, solange offline (Sperre wie `ListingSheet`) oder `status != "aktiv"` (außer „Erneut anbieten“, Kopieren, Bilder, Anzeige öffnen).

- [ ] **Step 3: Chip „Angebote“**

- `SaleLists.kt#CollectionChip`: `const val ANGEBOTE = "angebote"`.
- `CollectionScreen.kt`: die Chip-`Row` (Zeile 224) bekommt `Modifier.horizontalScroll(rememberScrollState())` und einen vierten `FilterChip(chip == CollectionChip.ANGEBOTE, { chip = CollectionChip.ANGEBOTE }, label = { Text("Angebote") })`; im Inhalt (Zeile 253–256) `else if (chip == CollectionChip.ANGEBOTE) { ListingsSection(onOpenCard = { detailId = it }, modifier = Modifier.weight(1f)) }`.

- [ ] **Step 4: Kartenansicht (`CardDetailScreen.kt`)**

`val listingsState by SideStores.listings.state.collectAsState()`, `LaunchedEffect(Unit) { SideStores.listings.ensureLoaded() }`, `val offers = remember(listingsState.value) { listingsState.value?.byCopy() ?: emptyMap() }`. `CopyLocationRow` bekommt einen Parameter `offered: String?` und zeigt ihn als zweite Zeile (`labelSmall`, `Gold`); Aufruf (Zeile 236) mit `ListingText.offeredText(offers[c.copyId] ?: emptyList())`.

- [ ] **Step 5: Start (`StartScreen.kt`, `AppNav.kt`)**

- `StartScreen` bekommt `onOpenListings: () -> Unit` (nach `onOpenDuplicates`). In der Karte „Zum Verkauf/Duplikate“ (Zeile 359–374) eine dritte Zeile im selben Stil mit `Icons.Default.Storefront`: Text `listingsState.value?.let { ListingText.startText(ListingText.listingsSummary(it.heads(), it.lineItems()).listings) } ?: if (listingsState.error != null) "Angebote: —" else "Angebote: …"`. `LaunchedEffect(Unit) { SideStores.listings.ensureLoaded() }`; im Pull-to-refresh-Block (Zeile 186–191) `SideStores.listings.refreshAndWait()` ergänzen.
- `AppNav.kt` (Zeile 231–232): `onOpenListings = { CollectionChip.open(CollectionChip.ANGEBOTE); nav.openSammlungKarten() },`.

- [ ] **Step 6: Prüfen**

Android-Befehl → `BUILD SUCCESSFUL`, Testzahl wie Task 10, `AndroidRegexWaechterTest` grün.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/ListingsScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/SaleLists.kt android/app/src/main/java/com/example/yugiohscanner/ui/CollectionScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/CardDetailScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/StartScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/AppNav.kt android/app/src/main/java/com/example/yugiohscanner/ui/SaleSheet.kt
git commit -m "feat(h3a): Handy Uebersicht Angebote, Detail, Verkauft/Teilverkauf mit Aufraeumen nach book_sale, Kartenansicht, Start

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Controller-Abschluss (kein Subagent)

- [ ] Endstand messen: SQLite-Suite, `test-sync.cjs`, Helfer, Lint (5), `vite build`, Android `testDebugUnitTest assembleDebug`; Testzahlen je Stufe in den Bericht (erwartet grob: SQLite + 12 + 4 + 3 + 11 Kanäle, Helfer + 17, Android + 17 + 11 + 3).
- [ ] Abschlussreview über den ganzen Zweig. Schwerpunkte: Zwillinge wortgleich (JS ↔ JS, JS ↔ Kotlin: Sortierung, Kürzen, `max(1, …)`, Kodierung), Aufräumen in derselben Transaktion wie `bookSale`, `except`-Angebot, Echo-Sperren der zwei Ströme, InFlight + frisch laden vor jeder Handy-Schreibaktion, „…“-Platzhalter, `idsKey`, Escape-Kette PC, einzige Aufrufstellen der Sheets, Blättern über 1000, keine Worktrees/Kopien/Löschungen durch Agents.
- [ ] Installer bauen — im **Hauptordner** `desktop/` (echte `node_modules`, keine Junction): `git -C C:/Users/Buzzty/Downloads/yugi switch --detach <Spitze des Zweigs>`, dann die in H2 Task 14 bewährte Reihenfolge (`npm rebuild better-sqlite3` → Tests → `npx @electron/rebuild -f -w better-sqlite3 -v 40.1.0` → `npm run dist` → `process.dlopen`-Prüfung auf `win-unpacked`), danach `git switch main`. Ausgabe liegt in `desktop/dist-electron` (neuer Zeitstempel des `Setup 0.1.0.exe` prüfen).
- [ ] Nutzer installiert. **Prüfung des installierten Builds** (Lehre H2-Nachtrag): `grep -c "listing-create" "C:/Users/Buzzty/AppData/Local/Programs/yugioh-card-manager/resources/app.asar"` → mindestens 1. Erst dann gilt eine PC-Abnahme.
- [ ] APK installieren, App **starten**, `adb logcat -b crash` leer (Lehre `(?U)`).
- [ ] Abnahme mit dem Nutzer (nachdem `supabase/listings_schema.sql` eingespielt und die Prüfabfrage bestätigt ist) — Spec §10 „Am Gerät“:
  1. PC: in der Verkaufsliste zwei Karten anhaken → „Angebot erstellen“ auf **Kleinanzeigen**: Titel (Konvolut) mit Zähler, Beschreibung, „Titel kopieren“, „Zum Einstellen öffnen“ öffnet `kleinanzeigen.de/p-anzeige-aufgeben.html`, „Bilder“ legt `Bilder\Yu-Gi-Oh Angebote\<Titel>\` an und öffnet den Ordner, Hinweis „n Bilder gespeichert“. Speichern; die Karten stehen auf „Zum Verkauf“.
  2. PC: dieselbe eine Karte zusätzlich auf **Cardmarket** anbieten (mit einer zweiten, andersartigen Karte gemischt → „wird zu 2 Cardmarket-Angeboten“, Eintragwerte und Stückpreis). Hinweis „auch auf Kleinanzeigen eingestellt“. In „Angebote“ zeigen beide Angebote die Marke „auch auf …“, die Verkaufsliste die Kürzel „CM KA“, die Kartenansicht „angeboten auf …“.
  3. Handy: nach dem Abgleich erscheinen die Angebote unter Sammlung › Angebote mit denselben Zahlen, Marken und „Angebote: n aktiv“ auf Start.
  4. Handy: das Cardmarket-Angebot „Verkauft“ → Buchungs-Sheet vorbelegt (Kanal, Preis, Karten); buchen. Abschluss-Schritt „Auch dort herausnehmen: Kleinanzeigen – …“. Das Kleinanzeigen-Angebot hat die Karte nicht mehr (bzw. ist beendet); am PC nach dem Abgleich ebenso.
  5. PC: ein Angebot mit zwei Karten (anderer Kanal) teilweise verkaufen (eine Karte abwählen) → Angebot bleibt aktiv, Hinweis „Preis für die übrigen Karten anpassen?“ → Bearbeiten.
  6. PC: den Verkauf aus 5 in Insights › Verkäufe stornieren → ein ganz verkauftes Angebot zeigt „Verkauf storniert“ und „Erneut anbieten“ (vorbelegt).
  7. Handy: ein Angebot beenden; „Bilder“ teilt die Katalogbilder über das Android-Teilen-Menü (z. B. in Kleinanzeigen oder Dateien).
  8. Handy: eine Karte, die in einem Angebot steckt, am PC löschen → nach dem Abgleich am Handy „Karte fehlt“, Antippen nimmt sie heraus; leeres Angebot → beendet.
- [ ] Merge in `main` erst nach der Abnahme, Push nur auf Zuruf.
- [ ] Gedächtnis: `spec-h3a-status.md` anlegen und im Index eintragen (Antworten an den Nutzer auf Deutsch).

## Selbstprüfung

**Abdeckung der Spec:**

| Spec | Task |
|---|---|
| §3 Entscheidungen (eigene Tabellen, beliebig viele Exemplare, Mehrfach-Einstellen mit Hinweis, `sale_channels`) | 3, 4, 7, 10 |
| §4.1 SQLite | 4 |
| §4.2 Supabase | 3 (keine Funktion; Abweichung 1) |
| §4.3 Abgleich (zwei Ströme, Echo, Obergrenze, `listings-changed`, Handy blättert) | 5, 9 |
| §5.1 Einstieg Verkaufsliste / Exemplar-Sheet | 7 (PC), 10 (Handy) |
| §5.2 Dialog, `for_sale = 1` | 4, 7, 10 |
| §5.3 Texte (Titel, Konvolut, n×, Kürzen, Zähler, Beschreibung, Cardmarket-Eintragwerte) | 1, 2, 7, 10 |
| §5.4 Cardmarket-Aufteilung | 1, 2, 4, 7, 10 |
| §5.5 Links | 1, 2, 6 (`listing-open-url`), 7, 10 |
| §5.6 Bilder (PC Ordner, Handy Teilen, Überspringen, Hinweis) | 6, 7, 10 |
| §5.7 Prüfungen, „auch auf …“ | 4 (PC), 9 (`checkNew`), 7/10 (Hinweis) |
| §6 Übersicht, Filter, Zeile, Marken, Sortierung, Kopf, Detail, Kürzel, Kartenansicht, Start | 1, 2, 4, 8, 11 |
| §7.1 Verkauft ganz/teilweise, Cardmarket-Stückpreis, Hinweis | 1, 2, 4, 8, 9, 11 |
| §7.2 Aufräumen nach jedem Verkauf (PC gleiche Transaktion, Handy nach `book_sale`, Erinnerung) | 1, 2, 4, 8, 9, 11 |
| §7.3 Beenden | 4, 8, 9, 11 |
| §7.4 Erneut anbieten | 4, 7, 8, 11 |
| §7.5 Storno-Marke | 1, 2, 4, 8, 11 |
| §8 Fehlerfälle (offline, Karte fehlt, beide Geräte, Kanal ausgeblendet, ohne Marktwert, Link unbekannt, Bild, Titel zu lang, Konvolut für Cardmarket) | 4, 7, 8, 9, 10, 11; 1/2 (Texte) |
| §9 Betroffene Dateien | Dateiübersicht; zusätzlich `listing-images.cjs`, `useListingsData.js`, `ListingShare.kt`, `file_paths.xml`, `AndroidManifest.xml`, `AppNav.kt` |
| §10 Tests (Zwillinge, SQLite, Abgleich, Handy-Blättern/Aufräumen/Nutzlasten, am Gerät) | 1, 2, 4, 5, 9, 10, 12 |
| §11 Bau-Reihenfolge | Taskfolge 1–2 → 3 → 4–8 → 9–11 → 12 |
| §13 Risiken | Abschnitt SQL, Befund 2, Hinweis im Dialog |

**Namen quer geprüft:**
- Zwillinge: `groupItems, truncateTitle, listingTitle, listingDescription, cardmarketProduct, pieceCents, cardmarketEntry, afterListingSale, listingLink, channelShort, rowTitle, sortListings, listingMarks, activeByCopy, offeredText, copyBadges, cleanupAfterSale, listingsSummary, summaryText, startText, daysSince, sinceText, suggestionSum, imageUrls, imagesText` in JS (beide Fassungen) und Kotlin gleich; Kotlin zusätzlich `encodeUriComponent`, Abweichungen der Parameterform im Kopfkommentar.
- Tabellen/Spalten: `LISTING_COLS` (14) = `listings_schema.sql` = `ListingsRepository.LISTING_COLS`; `LISTING_ITEM_COLS` (13) = SQL = `ITEM_COLS`; Zeiger `sync_listings_*`, `sync_listing_items_*`.
- IPC: `listing-preview, listing-create, listing-update, listing-remove-items, listing-end, listing-relist, listings-overview, listing-detail, listing-offers, listing-open-url, listing-save-images` in Task 6 (main, preload, Test) und Task 7/8 (`previewListing, createListings, updateListing, removeListingItems, endListing, relistPrefill, listingsOverview, listingDetail, listingOffers, openListingUrl, saveListingImages, onListingsChanged`). `sale-book` antwortet `{ sale_id, reminders, askAdjust, listingSkipped }` — gelesen in `SaleDialog` (Task 8).
- `bookSaleDetailed` (Task 4) ↔ `sale-book` (Task 6); `applySaleToListings` ↔ `ListingsRepository.afterBooking` (gleiche Regel, gleiche Meldung „Angebot war nicht mehr aktiv …“).
- Fenster-Ereignis `listings-dirty` (Task 7, 8) und Sync-Ereignis `listings-changed` (Task 5, `onListingsChanged`).

**Bekannte Grenzen:**
- Die Oberflächen-Tasks (7, 8, 10, 11) sind gebaut und gelintet, nicht im Fenster oder am Gerät geklickt; das übernimmt die Abnahme in Task 12.
- Die Cloud-Tabellen werden nie gegen eine Datenbank getestet (Agents dürfen kein SQL ausführen); die PC-Fassung derselben Regeln ist mit echter SQLite getestet, die Handy-Schreibvorgänge nur als Nutzlasten.
- „Verkauft“ aus einem Angebot mit einer „Karte fehlt“-Position lässt das Angebot aktiv (die fehlende Position bleibt, Spec-wörtlich); erst Antippen von „Karte fehlt“ beendet es.
- Wird am anderen Gerät verkauft, räumt dieses Gerät nicht nach (Spec §7.2); die Marke „Karte fehlt“ fängt es auf.
- Mehrere Angebote desselben Kanals für dieselbe Karte werden nicht verhindert (Spec §3: erlaubt, mit Hinweis).
- Der Titel wird beim Speichern nicht auf 65 Zeichen beschnitten, wenn der Nutzer ihn von Hand verlängert; der Zähler wird rot.

**Widersprüche und Lücken in der Spec (dem Nutzer vorlegen):**
- §5.3: Das Titel-Beispiel „Yu-Gi-Oh! Dunkler Magier LOB-DE005 Ultra Rare 1. Auflage NM Deutsch“ hat 67 Zeichen; nach der Regel „höchstens 65, an der Wortgrenze kürzen“ wird daraus „… 1. Auflage NM“ ohne Sprache (Fixture-Fall 1). Soll stattdessen z. B. „Deutsch“ vor dem Kürzen als Erstes entfallen, ist das eine Regeländerung für alle drei Zwillinge.
- §4.2: „Angebote schreiben betrifft je Aktion eine Tabelle“ stimmt für Anlegen (Kopf + Positionen + `for_sale`), „Verkauft“ und das Aufräumen nicht; ohne Datenbankfunktion geht es nur nacheinander (Abweichung 1).
- §5.3/§7.1: Ein Cardmarket-Stückpreis kann auf 0 Cent fallen; „Stückpreis × Rest“ widerspräche dann §5.5 „nie 0 €“ (Abweichung 5).
- §5.5: Für Cardmarket mit unbekanntem Set-Code und bekanntem englischem Namen sagt die Spec nichts; der Plan sucht nur nach dem Namen (Abweichung 4).
