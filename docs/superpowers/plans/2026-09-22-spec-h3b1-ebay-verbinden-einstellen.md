# Spec H3b1 eBay: Verbinden und Einstellen — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein H3a-Angebot auf dem Kanal **eBay** wird in der Cloud automatisch zu einer echten eBay-Anzeige auf eBay.de: **einstellen, ändern, Menge senken, zurückziehen** über die offizielle Sell-API, mit eigenen Fotos (PC + Handy) zusätzlich zum Katalogbild. Verbinden, Einrichtungs-Check (Richtlinien, Artikelstandort) und „Jetzt abgleichen“ in den Einstellungen beider Geräte; Marken „auf eBay online“ / „wartet auf eBay“ / „eBay-Fehler: … – Erneut versuchen“ in Übersicht und Detail. H3b2 (Bestellungen, Gebühren, Hinweise) ist **nicht** Teil dieses Plans.

**Architecture:** Zwei neue Supabase Edge Functions (Deno, nur `fetch`, kein SDK): `ebay-auth` (OAuth-Zustimmung, Rücksprung, Check/Auswahl, Standort, Umgebung, Trennen) und `ebay-sync` (Abgleicher Soll/Ist: Schritt 1 Token, Schritt 4 Angebote, Schritt 5 Stand; Zeitplan alle 5 min mit `x-ebay-secret` und sofortiger Anstoß durch die Geräte). Alle Regeln wohnen in reinen, getesteten Deno-Modulen unter `supabase/functions/_shared/` (`listing-text.ts` = Deno-Zwilling der H3a-Titel-/Stückpreisregel, `ebay-map.ts` Abbildung + Prüfsumme, `ebay-plan.ts` Entscheidungstabelle, `ebay-client.ts` eBay-Aufrufe); IO hängt an einer schmalen `Store`-Schnittstelle (echte Fassung `ebay-store.ts`, Tests mit `fake-store.ts` und nachgebautem eBay `fake-ebay.ts`). Neue Cloud-Tabellen `ebay_account` (nur Dienstrolle), Ansicht `ebay_status` (ohne Tokens), `ebay_listings` (nur die Funktion schreibt), `listing_photos` und Speicher `listing-photos`. Der PC zieht `ebay_listings` als **Nur-Lese-Strom** und `ebay_status` in einen Zwischenspeicher, `listing_photos` als normalen Strom (wie `listings`, `localWinsUnpushed`); er ruft die Funktionen über die schon angemeldete Supabase-Sitzung (`sync.ensureClient`). Das Handy liest per REST mit Schlüssel-Blättern und ruft die Funktionen per OkHttp.

**Tech Stack:** Deno 2 (`jsr:@std/assert@1`, `jsr:@supabase/supabase-js@2`), Postgres/PostgREST + Storage, eBay Sell Inventory/Account API, Commerce Taxonomy API, OAuth 2 Authorization-Code; Electron CJS + better-sqlite3 + `nativeImage`, React/Vite + Tailwind; Kotlin/Compose (Material3), OkHttp + org.json, `BitmapFactory`/`ExifInterface`, `ActivityResultContracts.TakePicture`/`PickVisualMedia`, JUnit4.

**Spec:** `docs/superpowers/specs/2026-09-22-spec-h3b-ebay-api.md` (Commit `159b09a`), Umfang §11 „H3b1“. Setzt H2 (`87dc5d9`) und H3a (`7b23e93`) voraus; Stand `main` = `159b09a`.

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- **Agents führen niemals SQL aus, verbinden sich nie mit Supabase, rufen keine Edge Function auf und deployen nichts** (weder `supabase functions deploy` noch `curl` auf `/functions/v1/…`, weder `supabase secrets set` noch `cron.schedule`). SQL, Secrets, Deploy und Zeitplan macht der Nutzer nach der Anleitung `supabase/README_ebay_cloud.md` (Task 10). Die Funktionen werden nur mit `deno test`/`deno check` geprüft.
- **Keine Tokens, Codes, Secrets oder `Authorization`-Köpfe in Protokollen, Fehlermeldungen, Antworten an Geräte oder Test-Ausgaben** (Spec §9). Fehlermeldungen tragen nur eBays `longMessage`/`message`/`error_description`. Tests benutzen erfundene Werte (`"AT"`, `"RT"`, `"geheim"`).
- **Kein Implementer und kein Reviewer legt Worktrees, Arbeitskopien, Kopien von `node_modules` oder Junctions an, und niemand löscht etwas** (Dateien, Ordner, Zweige). Der Controller legt den einen Worktree an; `desktop/node_modules` darin ist eine **Kopie**, nie eine Junction (Lehre H2 16:15 / Junction-Löschfalle).
- Immer explizite Pfade stagen, nie `git add -A`, NIE `git stash` (auch nicht für Schutz-Nachweise: per Edit sabotieren, Fehlschlag zitieren, per Edit zurücknehmen). **`deno.lock` in der Repo-Wurzel ist ungetrackt und wird nie gestaged**, auch wenn `deno test` ihn anfasst.
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI).
- `cards.quantity`, `cards.deleted`, `cards.price_first_ed` schreibt die App nie. Nur weiches Löschen — auch für Fotos (`listing_photos.deleted = 1/true`); Dateien im Speicher werden nie gelöscht (Spec §6).
- **Nur-Lese-Ströme schieben nie:** `ebay_listings`, `ebay_status`, `ebay_account` stehen nie in `SALES_STREAMS` und werden von keinem Gerät geschrieben (Wächter-Test Task 6). Nur die Funktion schreibt `ebay_listings`/`ebay_account`.
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs` UND in `ipc-channels.test.cjs`.
- Sichtbare Texte deutsch mit echten Umlauten; Code-Kommentare dürfen Umschreibungen (ae/oe/ue) nutzen wie bisher.
- Regeln wohnen in reinen, getesteten Helfern. Absichtliche Zwillinge im Kopfkommentar markieren (mit Nennung der anderen Fassungen) und gegen die gemeinsame Fixture testen: `_shared/listing-text.ts` ↔ H3a-Zwillinge (`docs/fixtures/listings/listings.json`), `ebayMarks.js` ↔ `EbayMarks.kt` (`docs/fixtures/ebay/marks.json`). Namensabweichungen JS ↔ Kotlin stehen im Kopfkommentar.
- **Geld in ganzen Cent.** JS/TS `Math.round`, Kotlin `java.lang.Math.round`; Stückpreis = `pieceCents(total, n) = Math.round(total / n)` wie `listing-text.cjs:82-84`.
- **Vergleiche und Sortierungen per Codeeinheiten** (`<`/`>`), nie `localeCompare`/`Collator`. Gleichstände deterministisch (Angebote nach `listing_id`, Positionen nach `copy_id`, Fotos nach `sort`, dann `photo_id`).
- Kein `(?U)` und keine anderen JVM-only-Regex-Kennzeichen im Android-Code (`AndroidRegexWaechterTest`).
- Leere Strings werden wie `null` behandelt.
- **Links nur http(s):** Der PC öffnet eBay-Links nur über `listing-open-url` (prüft `^https?://`), die Zustimmungs-URL nur, wenn sie mit `https://` beginnt; das Handy nur über `ml/WebLink.kt#openWebLink`. `item_url` wird in den Marken nur mit `https://` angezeigt.
- **Bilder:** PC nimmt nur `.jpg/.jpeg/.png` bis 25 MB Eingabe, lädt nur JPEG < 500 KB (Bucket erlaubt nur `image/jpeg` bis 2 MB); Handy verkleinert vor dem Hochladen gleich. Längste Seite mindestens 500 px (eBay).
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`; der Controller misst vor Task 1 auf `main`). Ein sechster ist ein Fehlschlag. `.cjs` lintet die Konfiguration nicht, `.js`/`.jsx` schon.
- Ein Schutz-Test muss nachweislich ohne den Schutz scheitern (sabotieren, Fehlschlag zitieren, zurücknehmen).
- **Handy-Mutationen** laufen durch `InFlight` und laden **innerhalb** des Gatters frisch (`SideStores.listingPhotos.refreshAndWait()`, `SideStores.listings.refreshAndWait()`), bevor sie entscheiden (Fotoanzahl ≤ 12, Angebot noch vorhanden). PC-Schreibaktionen durch `createBusyGate()`.
- **Handy-Listen über 1000 Zeilen:** PostgREST kappt bei 1000. `ebay_listings` und `listing_photos` blättern per `KeysetPager` + `Keyset.after` (Muster `ListingsRepository.listingsPageParams`). Auch die Funktion blättert (`ebay-store.ts#all`).
- **Ein Platzhalter sieht nie wie eine leere Liste aus:** solange der eBay-Stand lädt, steht „…“ (Marke `kind: 'laden'`), nie „nicht verbunden“.
- **React-Effekte mit Arrays:** stabile Schlüssel (`idsKey = ids.join(',')`), nie das Array selbst. `react-hooks/set-state-in-effect`: setState nur in Promise-Callbacks. Kein `Date.now()`/`new Date()` im Render (`todayLocal()` in Handlern oder `useState(() => todayLocal())`).
- **Verschachtelte Dialoge und Escape (PC):** der obere Dialog hat den eigenen Escape-Handler, der untere setzt seinen aus (Muster `ListingDetail.jsx:68-74`).
- **Sheets am Handy:** genau EINE Aufrufstelle außerhalb von Verzweigungen und vor jedem frühen `return` (Muster `SaleLists.kt:225-229`). Die Foto-Aufnahme-Launcher (`rememberLauncherForActivityResult`) stehen oben im Composable, nie in einem Zweig.
- **Sync-Regeln:** Pull vor Push; gezogene Zeilen bekommen `updated_at` über `pulledUpdatedAtCeiling` (nicht zurückschieben); `listing_photos` bekommt `localWinsUnpushed: true` wie `listings` (Abschluss-Fix I1 H3a).
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Neue Commits, nie `--amend`.
- **Installer:** gebaut in `desktop/dist-electron` (`package.json` `build.directories.output`), nie aus einem Junction-Worktree. Die PC-Abnahme gilt erst, wenn das **installierte** `app.asar` den neuen Kanal enthält (`grep -c "ebay-sync-now" …/app.asar` ≥ 1; Lehre H2-Nachtrag).
- Nach dem APK-Einspielen die App **starten** und `adb logcat -b crash` prüfen (Lehre `(?U)`).
- H3b1-spezifisch nicht drin (Spec §7/§11): Bestellungen abholen/buchen, Gebühren, `sale_notices`, `ebay_orders`, Käufer-Storno, Windows-Benachrichtigungen, andere Marktplätze, Aufräumen alter Foto-Dateien.

**Befehle:**
- Deno (Repo-Wurzel): `deno test --allow-read --node-modules-dir=none supabase/functions/_shared/ supabase/functions/ebay-auth/ supabase/functions/ebay-sync/`
- Deno-Typprüfung: `deno check --node-modules-dir=none supabase/functions/ebay-auth/index.ts supabase/functions/ebay-sync/index.ts`
- Deno gesamt (Abschluss): `deno test --allow-read --node-modules-dir=none supabase/functions/` (enthält die alten Funktionen)
- Desktop SQLite-Suite (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Desktop Sync-Skript (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
- Desktop-Helfer (in `desktop/`): `node --test src/utils/*.test.js src/utils/*.test.mjs`
- Desktop-Lint (in `desktop/`): `npx eslint .` → genau `5 errors`
- Desktop-Build (in `desktop/`): `npx vite build`
- Android (Repo-Wurzel): `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`; Testzahl = Summe der `tests=`-Attribute in `android/app/build/test-results/testDebugUnitTest/*.xml`.

Vor Task 1 misst der Controller die Ausgangszahlen auf `main` (Deno gesamt, SQLite-Suite, Helfer, Lint, Android-Tests) und trägt sie in den Bericht ein; jeder Task nennt danach seine Zahlen. Die Deno-Module in Task 1, 2, 4, 5 sind vom Plan-Autor in einer Scratch-Kopie **ausgeführt** worden (47 Tests grün, `deno check` beider `index.ts` grün, alle Schutz-Nachweise der Tasks 1, 2, 4, 5 geprüft); ebenso Task 6 (`ebay-sync.test.cjs` 5, `listing-photos.test.cjs` 5, bestehende `listings-sync`/`sales-sync` weiter grün) und die Renderer-Fixture (`ebayMarks.test.js` 4). Kotlin und die Oberflächen sind nicht kompiliert.

## SQL + Deploy — Reihenfolge ist Pflicht

Alles hier macht **der Nutzer**; der Controller legt die Schritte nach Task 3 bzw. Task 10 vor. Ausführlich mit Hintergrund in `supabase/README_ebay_cloud.md` (Task 10). Projekt-Ref wie bei den anderen Funktionen: `uirfqwklvavgjklgqpnn`.

1. **SQL einspielen** — Dashboard › SQL Editor › Inhalt von `supabase/ebay_schema.sql` (Task 3) › Run. Idempotent. **Vor** dem Deploy und **vor** dem neuen PC-/Handy-Build (ohne die Tabellen protokolliert der PC je Abgleich `[sync] ebay_listings pull: …` bzw. `[sync] listing_photos …` und zeigt „wartet auf eBay“; alle anderen Ströme laufen weiter; das Handy zeigt „eBay-Stand nicht geladen“).
   Prüfabfragen:

```sql
select table_name as tabelle, count(*) as spalten
  from information_schema.columns
 where table_schema = 'public' and table_name in ('ebay_account', 'ebay_listings', 'listing_photos', 'ebay_status')
 group by table_name order by table_name;
select tablename as tabelle, policyname as regel
  from pg_policies
 where schemaname = 'public' and tablename in ('ebay_account', 'ebay_listings', 'listing_photos')
 order by tablename;
select policyname as regel from pg_policies where schemaname = 'storage' and policyname = 'listing_photos_objects_insert';
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'listing-photos';
select proname as funktion from pg_proc where proname in ('ebay_try_lock', 'ebay_unlock') order by 1;
select id, environment, marketplace, refresh_token is null as ohne_token from public.ebay_account;
select has_table_privilege('authenticated', 'public.ebay_account', 'select') as geraet_liest_konto,
       has_table_privilege('authenticated', 'public.ebay_status', 'select') as geraet_liest_status;
```

   Erwartet: `ebay_account 24`, `ebay_listings 15`, `ebay_status 19`, `listing_photos 7`; zwei Regeln (`ebay_listings_authenticated_read`, `listing_photos_authenticated_all`), **keine** Regel für `ebay_account`; die Speicher-Regel `listing_photos_objects_insert`; Bucket `listing-photos | true | 2097152 | {image/jpeg}`; zwei Funktionen; eine Kontozeile `1 | sandbox | EBAY_DE | true`; `geraet_liest_konto = false`, `geraet_liest_status = true`.

2. **eBay-Entwicklerkonto** (developer.ebay.com, je Umgebung): Keyset (App ID = Client ID, Cert ID = Client Secret) und unter „User Tokens › Get a Token from eBay via Your Application“ eine **RuName** anlegen mit
   - *Your auth accepted URL*: `https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/ebay-auth?action=callback`
   - *Your auth declined URL*: `https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/ebay-auth?action=declined`
   - *Privacy Policy URL*: beliebige eigene Seite (Pflichtfeld bei eBay).
   Die Funktion erkennt den Rücksprung auch ohne `action`, sobald `code` in der Adresse steht (falls eBay die Abfrage anders anhängt).

3. **Secrets setzen** (Platzhalter ersetzen; nie in Dateien oder Chats kopieren):

```bash
supabase secrets set --project-ref uirfqwklvavgjklgqpnn \
  EBAY_SANDBOX_CLIENT_ID=<sandbox-app-id> EBAY_SANDBOX_CLIENT_SECRET=<sandbox-cert-id> EBAY_SANDBOX_RUNAME=<sandbox-runame> \
  EBAY_PROD_CLIENT_ID=<prod-app-id> EBAY_PROD_CLIENT_SECRET=<prod-cert-id> EBAY_PROD_RUNAME=<prod-runame> \
  EBAY_CRON_SECRET=<zufallswert-mind-32-zeichen>
```

   Die Produktions-Werte dürfen zunächst fehlen; `ebay-auth start` meldet dann „eBay-Zugangsdaten für Produktion fehlen (Secrets EBAY_PROD_…).“ `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` (Deals-Scraper, Befund 12) bleiben unberührt.

4. **Deploy** (beide mit `--no-verify-jwt`; die Funktionen prüfen das JWT selbst, der eBay-Rücksprung und der Zeitplan kommen ohne Anmeldung):

```bash
supabase functions deploy ebay-auth --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
supabase functions deploy ebay-sync --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
```

5. **Zeitplan** (SQL Editor; `<zufallswert…>` = `EBAY_CRON_SECRET`):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('ebay-sync', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/ebay-sync',
    headers := '{"Content-Type": "application/json", "x-ebay-secret": "<zufallswert-mind-32-zeichen>"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);
```

   Prüfen: `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'ebay-sync') order by start_time desc limit 5;` und `select last_run_at, last_run_summary, last_error from public.ebay_status;`. Abschalten: `select cron.unschedule('ebay-sync');`.

## Abweichungen von der Spec (bitte dem Nutzer vorlegen)

1. **Rücksprung-Seite ist Text, nicht HTML** (Spec §4.3 „schlichte HTML-Seite“). Supabase schreibt auf der Standard-Domain `text/html` zu `text/plain` um (Befund Doku 17); die Funktion antwortet deshalb gleich mit `text/plain; charset=utf-8` und denselben Sätzen („Verbunden – du kannst das Fenster schließen.“ / „Verbindung fehlgeschlagen: …“). Für HTML bräuchte es eine eigene Domain (kostenpflichtig).
2. **„Nur ein Durchgang gleichzeitig“ über eine Mietsperre statt `pg_try_advisory_lock`** (Spec §8). Jeder PostgREST-Aufruf läuft in einer eigenen Transaktion auf einer Verbindung aus dem Pool; eine Sitzungssperre bliebe an einer fremden Verbindung hängen, eine Transaktionssperre endet sofort. Stattdessen `ebay_try_lock(holder, 300 s)`/`ebay_unlock(holder)` auf zwei neuen Spalten `ebay_account.sync_lock_holder/_until`; stirbt ein Lauf, läuft die Sperre nach 5 Minuten ab. Verhalten wie Spec: zweiter Aufruf antwortet „läuft schon“.
3. **Zusätzliche Spalten** (Spec §4.2/§5.1): `ebay_account.{payment,fulfillment,return}_policy_name` (die Ansicht soll die Namen zeigen, §4.2), `ebay_listings.failed_hash` (ein abgelehntes, unverändertes Angebot wird nicht alle 5 Minuten erneut an eBay geschickt; wiederholt wird nach „Erneut versuchen“ oder nach einer Änderung), `ebay_listings.sold_seen` (Schutz vor Überverkauf: hat eBay seit dem letzten Abgleich verkauft, ändert der Abgleicher die Anzeige nicht, sondern meldet „Auf eBay verkauft – bitte den Verkauf in der App buchen, danach „Erneut versuchen“.“; „Erneut versuchen“ übernimmt die Zahl), `ebay_listings.created_at`.
4. **Präzisierungen der Abbildung** (§5.2): leere Beschreibung → H3a-Beschreibungsregel (eBay verlangt eine Beschreibung); ohne jedes Bild → `fehler` „Kein Bild vorhanden – bitte ein eigenes Foto hinzufügen.“ ohne eBay-Aufruf (eBay veröffentlicht nicht ohne Bild); Merkmal-Namen werden über eine feste Liste deutscher/englischer Namen zugeordnet (Spiel/Game, Hersteller, Kartenname, Set, Seltenheit, Sprache, Besonderheiten), „Set“ = Set-Code (die Sammlung kennt keine Set-Namen), „1. Auflage“ nur, wenn eBay den Wert („1. Auflage“ oder „1st Edition“) zulässt; Titel über 80 Zeichen wird hart gekürzt. Die Prüfsumme deckt genau Titel, Text, Preis, Menge, Zustand, Bilder ab (Merkmale und Richtlinien nicht, Spec-wörtlich).
5. **„Manuell auf eBay beendet“ wird per Stichprobe erkannt:** eine unveränderte Online-Anzeige wird höchstens einmal je Stunde gelesen (`getOffer`), sonst erst beim nächsten Ändern. „Erneut versuchen“ an einer so beendeten Anzeige stellt sie neu ein (Spec „erneut einstellen“).
6. **Zurückziehen braucht die Verbindung:** ist die Verbindung weg, bleibt eine Online-Anzeige online, bis wieder verbunden ist; dann zieht der nächste Lauf sie zurück.
7. **Umgebung wechseln wird verweigert, solange in der alten Umgebung Anzeigen online sind** („Zuerst die n eBay-Anzeigen in der Sandbox beenden – sonst bleiben sie dort online.“). Ohne diese Sperre bliebe eine echte Produktions-Anzeige nach einem Wechsel zur Sandbox für immer stehen, weil der Abgleicher Zeilen der anderen Umgebung nie anfasst (§5.3).
8. **Fotos erst am gespeicherten Angebot:** „Foto hinzufügen“ gibt es im Angebots-Detail (PC `ListingDetail`, Handy `ListingDetailSheet`), nicht im Anlegen-Dialog — der Speicherpfad braucht die `listing_id`. Der Anlegen-Dialog zeigt den Hinweis „Eigene Fotos fügst du nach dem Speichern im Angebot hinzu.“ Eigene Fotos gelten auch für „Bilder“ (PC-Ordner, Handy-Teilen) aller Kanäle.
10. **Konvolute in Kategorie 183455** (Nutzer 22.09., Spec §5.2 nannte 183454 für alle): Einzelkarten/gleiche Karten → `183454`, Konvolut → `183455` „Sammlungen & Lots“ (`categoryFor`, `Built.categoryId`); Pflichtmerkmale je Kategorie; der Kartenzustand-Deskriptor `40001` nur bei 183454 (eBay listet ihn für 183455 nicht) — ob eBay bei 183455 `USED_VERY_GOOD` ohne Deskriptor annimmt, prüft die Sandbox-Abnahme.
9. **Anstoß am PC nach jeder Angebots-Schreibaktion** (nicht nur für eBay-Angebote), nach `sale-book` und nach Foto-Änderungen, entprellt (1,5 s) und nur, wenn der Zwischenspeicher „verbunden“ sagt; der PC schiebt vorher (`sync.syncNow()`), damit die Funktion die Änderung sieht. Am Handy stößt `ListingsRepository.run` nach jeder erfolgreichen Schreibfolge an. Die Funktion ist gleichbleibend (Soll/Ist), überflüssige Anstöße kosten nur einen Lauf.

## Befunde aus dem Code-Abgleich

1. **Angebots-Momentaufnahme reicht für eBay:** `listing_items` trägt `name` (deutscher Anzeigename, Rückfall `cards.name`), `set_code`, `rarity`, `language`, `edition`, `condition`, `image_url` (`supabase/listings_schema.sql:24-39`, `desktop/electron/listings.cjs:99-104`, H3a-Abweichung 3). Die Funktion liest nur `listings`, `listing_items`, `card_copies` (Lebendigkeit: `deleted = false and sold_in is null`, wie `listings.cjs:31-36`) und `listing_photos`.
2. **Titel/Stückpreis-Regel:** `listing-text.cjs:27-43` (`groupItems`), `:45-51` (`truncateTitle`), `:59-70` (`listingTitle`), `:72-77` (`listingDescription`), `:82-84` (`pieceCents`), `euroCentsText` in `sales-math.cjs:155-160`. Der Deno-Zwilling (Task 1) übernimmt genau diese Teilmenge und besteht die Fixture-Fälle `titles`, `descriptions`, `pieceCents` aus `docs/fixtures/listings/listings.json`.
3. **Stückpreis steigt nach Teil-Herausnahme:** H3a lässt bei Nicht-Cardmarket-Kanälen nach einem Teilverkauf den Gesamtpreis stehen (`listing-text.cjs:97-102`, `askAdjust`). Für eBay heißt das: 3 Karten zu 12,00 € = 4,00 €/Stück; wird eine anderswo verkauft, stehen 2 zu je 6,00 € online, bis der Nutzer den Preis anpasst (H3a fragt „Preis für die übrigen Karten anpassen?“ nur beim Verkauf aus *diesem* Angebot). Spec-wörtlich; steht unter „Risiken“.
4. **Sync-Mechanik:** `SALES_STREAMS` (`sync.cjs:255-265`) schiebt jede eingetragene Tabelle (`pushSalesTable`, `sync.cjs:609-624`) — deshalb bekommen die Nur-Lese-Tabellen einen eigenen Mechanismus `READ_ONLY_STREAMS` ohne Push. `LISTING_TABLES` (`sync.cjs:639`) steuert `listings-changed`; `listing_photos` kommt dazu. `startSync` gibt heute nur `{ ensureClient }` zurück (`sync.cjs:797`); H3b1 ergänzt `syncNow`.
5. **Supabase-Sitzung am PC:** `sync.ensureClient()` (`sync.cjs:413-425`) meldet sich mit E-Mail/Passwort an; Funktionen ruft der PC schon so auf (`main.cjs:271-273` `scrape-deals`, `:320-325` `trigger-deal-scrape`), Speicher-Upload wie `catalog-builder.cjs:269-272`. `nativeImage` ist noch nicht importiert (`main.cjs:1`).
6. **IPC-Muster:** `listingWrite` (`main.cjs:930-933`) umhüllt alle Angebots-Schreibaktionen — dort wird der eBay-Anstoß eingehängt; `sale-book` (`main.cjs:906-910`) ebenso. `listing-open-url` (`main.cjs:948-953`) öffnet nur http(s). Kanäle-Wächter `ipc-channels.test.cjs:35`.
7. **Bilder-Ordner/Teilen nutzen heute nur Katalogbilder:** PC `ListingDetail.jsx:101-105` (`imageUrls(items)`), `ListingDialog.jsx:85-94`; Handy `ListingsScreen.kt:407`, `ListingSheet.kt:347`. Hinweis „Käufer erwarten oft eigene Fotos.“ `ListingDetail.jsx:248`, `ListingDialog.jsx:199`.
8. **Einstellungen:** PC `Settings.jsx:14-21` (`SECTIONS`, Routen `/einstellungen/:bereich`), Abschnitts-Karten wie `:254-302`; Handy `SettingsScreen.kt:274` (`SaleChannelSettings()` vor „Über“).
9. **Handy-REST-Muster:** `ListingsRepository.kt:237-250` (`run`, einzige Schreibstelle der Angebote — hier wird `EbayRepository.kick()` eingehängt), `:264-274` (`base`, `executeWithReauth`), `SupabaseCloud.kt:71-74` (`http/base/key/token`). OkHttp-Standard-Lesezeit 10 s (`SupabaseCloud.kt:16`) ist für `ebay-sync` zu kurz → eigener Client mit 150 s.
10. **FileProvider existiert** (`AndroidManifest.xml:53-61`, `res/xml/file_paths.xml` nur `listing_images/`); für die Kamera-Aufnahme kommt `listing_photos/` dazu. `ListingShareConfigTest` prüft nur `contains`, bleibt grün. `CAMERA`-Berechtigung ist erklärt (`AndroidManifest.xml:10`) — `ACTION_IMAGE_CAPTURE` verlangt dann die erteilte Berechtigung.
11. **Marken:** PC `ListingDetail.jsx:16-27` (`ListingMarks`), Zeile `ListingsList.jsx:59-73`; Handy `ListingsScreen.kt:80` (`MarksRow`), `:190-209` (`ListingRowView`), Detail `:223-300`.
12. **Vorhandene eBay-Secrets:** `supabase/functions/scrape-deals/ebay.ts:45` nutzt `EBAY_CLIENT_ID/EBAY_CLIENT_SECRET` (Produktions-App-Token für die Browse-API). H3b1 bleibt bei den Spec-Namen `EBAY_PROD_*`; dieselben Werte dürfen doppelt gesetzt werden.
13. **Edge-Function-Muster:** `refresh-cardmarket-prices/index.ts:6-31` (`--no-verify-jwt`, Geheimwert-Kopf, Dienstrolle), Deploy/Cron `supabase/README_cardmarket_cloud.md:190-225`, Tests `prices_test.ts` mit `jsr:@std/assert@1`. Neu ist `_shared/` (Supabase-Konvention für geteilte Module, wird beim Deploy mitgebündelt).
14. **Installer:** `desktop/package.json` `build.directories.output = dist-electron`; installiert nach `C:\Users\Buzzty\AppData\Local\Programs\yugioh-card-manager` (`resources\app.asar`).

## Befunde aus der eBay-Doku

`developer.ebay.com` antwortet auf direkte Abrufe mit 403; die Fakten stammen aus den offiziellen Seiten über die Suche (Auszüge) und den Context7-Index von developer.ebay.com. Unbestätigtes ist markiert und wird in der Sandbox-Abnahme (Task 11) geprüft.

1. **Zustimmung** (https://developer.ebay.com/api-docs/static/oauth-consent-request.html): `https://auth.sandbox.ebay.com/oauth2/authorize?client_id=…&redirect_uri=<RuName>&response_type=code&scope=<Liste>&state=…` (Produktion `https://auth.ebay.com/oauth2/authorize`); `redirect_uri` ist die RuName, die Accept-/Decline-URL steht in der RuName.
2. **Code tauschen** (https://developer.ebay.com/api-docs/static/oauth-auth-code-grant-request.html): `POST https://api.sandbox.ebay.com/identity/v1/oauth2/token` (Produktion `api.ebay.com`), `Content-Type: application/x-www-form-urlencoded`, `Authorization: Basic base64(client_id:client_secret)`, Body `grant_type=authorization_code&code=…&redirect_uri=<RuName>`; Antwort `access_token`, `expires_in`, `refresh_token`, `refresh_token_expires_in` = 47304000 s (≈ 18 Monate).
3. **Erneuern** (https://developer.ebay.com/api-docs/static/oauth-refresh-token-request.html): gleicher Endpunkt, `grant_type=refresh_token&refresh_token=…&scope=…` (Scope optional, höchstens die ursprünglichen); `expires_in` = 7200 s; abgelehnt als `invalid_grant`. Scopes (https://developer.ebay.com/api-docs/static/oauth-scopes.html): `https://api.ebay.com/oauth/api_scope/sell.inventory`, `…/sell.account`, `…/sell.fulfillment`, `…/sell.finances`; dieselben Adressen in der Sandbox (Auszug, Abnahme).
4. **Richtlinien** (https://developer.ebay.com/api-docs/sell/account/resources/fulfillment_policy/methods/getFulfillmentPolicies, ebenso `payment_policy`, `return_policy`): `GET /sell/account/v1/{payment|fulfillment|return}_policy?marketplace_id=EBAY_DE` → `paymentPolicies[]`/`fulfillmentPolicies[]`/`returnPolicies[]` mit `…PolicyId` und `name`.
5. **Opt-in nötig** (https://developer.ebay.com/api-docs/sell/static/seller-accounts/business-policies.html, https://developer.ebay.com/api-docs/sell/account/resources/program/methods/getOptedInPrograms): Geschäftsrichtlinien wirken nur mit Programm `SELLING_POLICY_MANAGEMENT`; `GET /sell/account/v1/program/get_opted_in_programs` → `programs[].programType`. Der Check meldet es (`programOk`).
6. **Zustand „Ungraded“** (https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionEnum): in Sammelkarten-Kategorien `LIKE_NEW` (2750) = Graded, `USED_VERY_GOOD` (4000) = Ungraded; beide verlangen `conditionDescriptors`; für Ungraded nur der Deskriptor „Card Condition“ (https://developer.ebay.com/api-docs/sell/inventory/types/slr:ConditionDescriptor: `name`, `values[]`, `additionalInfo`).
7. **Kartenzustand-Werte** (https://developer.ebay.com/api-docs/user-guides/static/mip-user-guide/mip-enum-condition-descriptor-ids-for-trading-cards.html): Deskriptor `40001` (Card Condition); **Sammelkartenspiele**: `400010` Near mint or better, `400015` Lightly played (Excellent), `400016` Moderately played (Very good), `400017` Heavily played (Poor); die Sport-/Nicht-Sport-Werte `400011–400013` gelten für CCG nicht. Kategorien 183050, 183454, 261328. Die Spec-Zuordnung (MT/NM → Near mint or better; EX → Lightly played; GD/LP → Moderately played; PL/PO → Heavily played) passt zu den CCG-Bezeichnungen.
8. **Inventar-Artikel** (https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem): `PUT /sell/inventory/v1/inventory_item/{sku}`, vollständiger Ersatz (alle Felder jedes Mal), `product.title/description/aspects/imageUrls`, `condition`, `conditionDescriptors`, `availability.shipToLocationAvailability.quantity`; Kopf `Content-Language` (`de-DE` unterstützt, https://developer.ebay.com/develop/guides-v2).
9. **Offers** (https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/createOffer, …/updateOffer, …/publishOffer, …/withdrawOffer, …/getOffers): `POST /offer` → `offerId`; `PUT /offer/{id}` ersetzt vollständig und ändert eine veröffentlichte Anzeige sofort; `POST /offer/{id}/publish` → `listingId`; `POST /offer/{id}/withdraw` beendet die Anzeige, die Offer bleibt `UNPUBLISHED` und lässt sich neu veröffentlichen; `GET /offer?sku=…` liefert `offers[]` mit `status` und (nur veröffentlicht) `listing.listingId/listingStatus/soldQuantity`; ohne Offer 404. Offer-Felder `sku, marketplaceId, format FIXED_PRICE, availableQuantity, categoryId, listingDescription, listingDuration GTC, listingPolicies.{fulfillment,payment,return}PolicyId, merchantLocationKey, pricingSummary.price {value, currency}` (https://developer.ebay.com/develop/guides-v2/listing-creation/listing-creation).
10. **ListingStatusEnum** (https://developer.ebay.com/api-docs/sell/inventory/types/slr:ListingStatusEnum): Werte nicht einsehbar (403). Der Plan wertet nur `ACTIVE` und `OUT_OF_STOCK` als lebend, alles andere (und `status ≠ PUBLISHED`) als beendet.
11. **Standorte** (https://developer.ebay.com/api-docs/sell/inventory/resources/location/methods/createInventoryLocation, …/getInventoryLocations): `POST /sell/inventory/v1/location/{merchantLocationKey}` mit `location.address.{postalCode, city, country}`, `name`, `merchantLocationStatus ENABLED`, `locationTypes [WAREHOUSE]`; `GET /sell/inventory/v1/location?limit=…` → `locations[].merchantLocationKey`.
12. **Taxonomy** (https://developer.ebay.com/api-docs/commerce/taxonomy/resources/category_tree/methods/getItemAspectsForCategory, …/getDefaultCategoryTreeId): verlangt ein **Anwendungs-Token** (client_credentials, Scope `https://api.ebay.com/oauth/api_scope`), in der Sandbox unter `api.sandbox.ebay.com`; `GET /commerce/taxonomy/v1/category_tree/{id}/get_item_aspects_for_category?category_id=…` → `aspects[]` mit `localizedAspectName`, `aspectConstraint.aspectRequired/aspectMode/itemToAspectCardinality`, `aspectValues[].localizedValue`, Pflichtmerkmale zuerst. Die Baum-ID **77** für EBAY_DE war in der Doku nicht bestätigbar (Seite „supportedmarketplaces“ 403) → der Plan liest sie je Lauf mit `get_default_category_tree_id?marketplace_id=EBAY_DE`.
13. **Bilder** (https://developer.ebay.com/api-docs/sell/static/inventory/managing-image-media.html): nur `https`, bis 24 Bilder, mindestens eines zum Veröffentlichen.
14. **Fehlerform** (https://developer.ebay.com/api-docs/static/handling-error-messages.html): `errors[]` mit `errorId`, `domain`, `category`, `message`, `longMessage`, `parameters`.
15. **Kategorie** 183454 auf eBay.de = „Einzelne Yu-Gi-Oh! TCG Karten“ (https://www.ebay.de/b/Einzelne-Yu-Gi-Oh-TCG-Trading-Card-Game-Karten/183454/bn_12943245); daneben gibt es 183455 „Sammlungen & Lots“ (https://www.ebay.de/b/Yu-Gi-Oh-TCG-Trading-Card-Game-Card-Sammlungen-Lots/183455/bn_16580948) — Risiko für Konvolute (Spec: 183454 für alle).
16. **Sandbox-Anzeigen-Adresse** `https://sandbox.ebay.de/itm/<id>` ist nicht belegt (Abnahme; falls falsch, nur `itemUrl` in `ebay-map.ts` ändern).
17. **Supabase** (https://supabase.com/docs/guides/functions/http-methods, https://supabase.com/docs/guides/functions/limits): „GET requests that return text/html will be rewritten to text/plain“ ohne eigene Domain → Abweichung 1.

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `supabase/functions/_shared/listing-text.ts` + `_test.ts` (neu) | Deno-Zwilling Titel/Beschreibung/Stückpreis (H3a-Fixture) | 1 |
| `supabase/functions/_shared/ebay-map.ts` + `_test.ts`, `docs/fixtures/ebay/map.json` (neu) | Abbildung, Prüfsumme, Zustand, Merkmale, Bilder | 1 |
| `supabase/functions/_shared/ebay-plan.ts` + `_test.ts`, `docs/fixtures/ebay/plan.json` (neu) | Entscheidungstabelle Soll/Ist | 1 |
| `supabase/functions/_shared/ebay-client.ts` + `_test.ts`, `fake-fetch.ts` (neu) | eBay-Client (OAuth, Account, Inventory, Taxonomy), Fehlerform | 2 |
| `supabase/ebay_schema.sql` (neu) | Tabellen, Ansicht, RLS, Speicher, Sperre | 3 |
| `supabase/functions/_shared/{ebay-store,http,supabase-deps,fake-store,fake-ebay}.ts`, `supabase/functions/ebay-auth/{setup,handler,index}.ts` + Tests (neu) | Funktion `ebay-auth` | 4 |
| `supabase/functions/ebay-sync/{sync,handler,index}.ts` + Tests (neu) | Funktion `ebay-sync` Schritte 1/4/5 | 5 |
| `desktop/electron/ebay-schema.cjs`, `listing-photos.cjs` + Tests, `ebay-sync.test.cjs` (neu); `sync.cjs`, `database.cjs`, `main.cjs`, `preload.cjs`, `ipc-channels.test.cjs` | PC: Ströme, Anstoß, IPC, Fotos | 6 |
| `desktop/src/utils/ebayMarks.js` + `.test.js`, `docs/fixtures/ebay/marks.json`, `useEbayData.js`, `components/EbaySettings.jsx`, `components/ListingPhotos.jsx` (neu); `Settings.jsx`, `ListingsList.jsx`, `ListingDetail.jsx`, `ListingDialog.jsx` | PC-Oberfläche | 7 |
| `android/.../ml/EbayMarks.kt`, `ml/PhotoScale.kt`, `cloud/EbayRepository.kt`, Tests `EbayMarksTest.kt`, `EbayRepositoryTest.kt` (neu); `cloud/SideStores.kt`, `cloud/ListingsRepository.kt` | Handy-Daten | 8 |
| `android/.../ui/PhotoImport.kt`, `ui/ListingPhotos.kt`, `ui/EbaySettings.kt` (neu); `ui/SettingsScreen.kt`, `ui/ListingsScreen.kt`, `ui/ListingSheet.kt`, `res/xml/file_paths.xml` | Handy-Oberfläche | 9 |
| `supabase/README_ebay_cloud.md` (neu) | Anleitung | 10 |

`android/...` steht für `android/app/src/main/java/com/example/yugiohscanner`. Android-Tests liegen unter `android/app/src/test/java/com/example/yugiohscanner/` und lesen Fixtures über `Fixtures.text("docs/fixtures/...")`.

Reihenfolge 1 → 11 im selben Worktree. Parallel erlaubt (disjunkte Dateien, Commits nie gleichzeitig): 2 ∥ 3; 6 ∥ 8 (nach 3); 7 nach 6; 9 nach 8; 10 jederzeit nach 5. **Kein harter Halt für SQL/Deploy:** kein Code-Task braucht die Cloud. Nach Task 3 legt der Controller dem Nutzer Schritt 1 („SQL einspielen“) vor, nach Task 10 die Schritte 2–5; gebraucht wird alles erst für Installation und Abnahme (Task 11).

---


### Task 1: Reine Deno-Regeln — Titel-Zwilling, Abbildung, Prüfsumme, Entscheidungstabelle (mit Fixtures)

**Files:**
- Create: `supabase/functions/_shared/listing-text.ts`, `supabase/functions/_shared/listing-text_test.ts`
- Create: `supabase/functions/_shared/ebay-map.ts`, `supabase/functions/_shared/ebay-map_test.ts`, `docs/fixtures/ebay/map.json`
- Create: `supabase/functions/_shared/ebay-plan.ts`, `supabase/functions/_shared/ebay-plan_test.ts`, `docs/fixtures/ebay/plan.json`

**Interfaces:**
- Consumes: `docs/fixtures/listings/listings.json` (H3a, unverändert: `items`, `titles`, `descriptions`, `pieceCents`).
- Produces (`listing-text.ts`): `TITLE_MAX = 65`, `LANGUAGE_NAMES`, `type LineItem`, `type Group`, `euroCentsText(c)`, `groupItems(items)`, `truncateTitle(text, ellipsis)`, `listingTitle(items)`, `listingDescription(items, priceCents|null)`, `pieceCents(total, n)` — Namen und Verhalten wie `desktop/electron/listing-text.cjs`.
- Produces (`ebay-map.ts`): Konstanten `MARKETPLACE = "EBAY_DE"`, `CATEGORY_ID = "183454"`, `CATEGORY_LOTS = "183455"`, `EBAY_TITLE_MAX = 80`, `MAX_IMAGES = 24`, `MAX_OWN_PHOTOS = 12`, `PHOTO_BUCKET = "listing-photos"`, `CONDITION_UNGRADED = "USED_VERY_GOOD"`, `CARD_CONDITION_DESCRIPTOR = "40001"`, `CARD_CONDITION_VALUE`, `NO_IMAGE`; Typen `SollListing`, `SollItem`, `Photo`, `AspectDef`, `Policies`, `Built`; Funktionen `toCents`, `skuOf(listingId) -> "L-<id>"`, `desired(listing|null, items, liveCopyIds) -> { active, liveItems }`, `photoUrl(baseUrl, path)`, `ownPhotos(photos, listingId)`, `imageList(photoUrls, liveItems)`, `worstCondition(items)`, `escapeHtml(s)`, `descriptionHtml(text)`, `aspectCandidates(liveItems)`, `fillAspects(defs, liveItems) -> { aspects, missing }`, `missingText(missing)`, `categoryFor(liveItems) -> "183454" | "183455"`, `buildListing(listing, liveItems, photoUrls, defs) -> Built` (mit `categoryId`), `inventoryItemBody(b)`, `offerBody(b, policies)`, `hashOf(b) -> Promise<hex>`, `itemUrl(env, itemId)`.
- Produces (`ebay-plan.ts`): `type RowState`, `type EbayRow` (Spalten von `ebay_listings` ohne Zeitstempel der Tabelle), `type Action = "none"|"wait"|"end_local"|"publish"|"revise"|"withdraw"|"check"`, `CHECK_EVERY_MS`, `decide(input) -> Action`, `offerEnded(offer|null)`, Texte `ENDED_ON_EBAY`, `SOLD_ON_EBAY`, `EXPIRED`, `type Summary`, `emptySummary()`, `summaryText(s)`.

- [ ] **Step 1: Fixtures schreiben**

`docs/fixtures/ebay/map.json` (wörtlich; die `expected`-Werte hat der Plan-Autor mit genau dem Algorithmus aus Step 4 erzeugt und von Hand gegengeprüft: `l1` 2 lebende von 4 Positionen (`dm3` Exemplar tot, `dm9` Position gelöscht) → gleich, Menge 2, Stückpreis `round(1001/2) = round(500,5) = 501`; `l2` drei verschiedene Drucke → Konvolut, Menge 1, 2500, schlechtester Zustand PL → `400017`, das `http://`-Katalogbild fällt weg; `l6` Titel 97 Zeichen → 80, IT ist bei „Sprache“ nicht erlaubt und entfällt, kein Bild → `problem`; die Prüfsummen sind SHA-256 über `JSON.stringify([title, descriptionHtml, pieceCents, quantity, conditionValue, imageUrls])`):

```json
{
  "_comment": "Spec H3b §5.2/§5.3 -- Fixture fuer supabase/functions/_shared/ebay-map.ts. Geld in Cent, price wie PostgREST (Text oder Zahl).",
  "baseUrl": "https://proj.supabase.co",
  "listings": {
    "l1": {"listing_id":"l1","channel_id":"ebay","title":"Dunkler Magier LOB-DE005 1. Auflage NM","description":"Zwei Stück.\r\nVersand <sicher> & \"schnell\"","price":"10.01","status":"aktiv","deleted":false},
    "l2": {"listing_id":"l2","channel_id":"ebay","title":"  ","description":null,"price":25,"status":"aktiv","deleted":false},
    "l3": {"listing_id":"l3","channel_id":"cardmarket","title":null,"description":null,"price":"5.00","status":"aktiv","deleted":false},
    "l4": {"listing_id":"l4","channel_id":"ebay","title":"Alt","description":null,"price":"5.00","status":"beendet","deleted":false},
    "l5": {"listing_id":"l5","channel_id":"ebay","title":"Nur tote Karte","description":null,"price":"5.00","status":"aktiv","deleted":false},
    "l6": {"listing_id":"l6","channel_id":"ebay","title":"Yu-Gi-Oh! Sehr langer Titel mit vielen Worten der die Grenze von achtzig Zeichen weit überschreitet","description":"Text","price":"0.99","status":"aktiv","deleted":false}
  },
  "items": [
    {"listing_id":"l1","copy_id":"dm1","card_id":"46986414","name":"Dunkler Magier","set_code":"LOB-DE005","language":"DE","rarity":"Ultra Rare","edition":"first","condition":"NM","image_url":"https://images.ygoprodeck.com/images/cards/46986414.jpg","deleted":false},
    {"listing_id":"l1","copy_id":"dm2","card_id":"46986414","name":"Dunkler Magier","set_code":"LOB-DE005","language":"DE","rarity":"Ultra Rare","edition":"first","condition":"NM","image_url":"https://images.ygoprodeck.com/images/cards/46986414.jpg","deleted":false},
    {"listing_id":"l1","copy_id":"dm3","card_id":"46986414","name":"Dunkler Magier","set_code":"LOB-DE005","language":"DE","rarity":"Ultra Rare","edition":"first","condition":"NM","image_url":"https://images.ygoprodeck.com/images/cards/46986414.jpg","deleted":false},
    {"listing_id":"l1","copy_id":"dm9","card_id":"46986414","name":"Dunkler Magier","set_code":"LOB-DE005","language":"DE","rarity":"Ultra Rare","edition":"first","condition":"NM","image_url":"https://images.ygoprodeck.com/images/cards/46986414.jpg","deleted":true},
    {"listing_id":"l2","copy_id":"be1","card_id":"89631139","name":"Blauäugiger w. Drache","set_code":"SDK-DE001","language":"DE","rarity":"Common","edition":"unlimited","condition":"EX","image_url":"https://images.ygoprodeck.com/images/cards/89631139.jpg","deleted":false},
    {"listing_id":"l2","copy_id":"ab1","card_id":"14558127","name":"Aschblüte & Freudiger Frühling","set_code":"MACR-DE036","language":"DE","rarity":"Secret Rare","edition":"limited","condition":"MT","image_url":"https://images.ygoprodeck.com/images/cards/14558127.jpg","deleted":false},
    {"listing_id":"l2","copy_id":"tg1","card_id":"55144522","name":"Topf der Gier","set_code":"Unknown","language":"EN","rarity":"","edition":"unknown","condition":"PL","image_url":"http://unsicher.example/55144522.jpg","deleted":false},
    {"listing_id":"l3","copy_id":"cm1","card_id":"46986414","name":"Dunkler Magier","set_code":"LOB-DE005","language":"DE","rarity":"Ultra Rare","edition":"first","condition":"NM","image_url":null,"deleted":false},
    {"listing_id":"l4","copy_id":"old1","card_id":"46986414","name":"Dunkler Magier","set_code":"LOB-DE005","language":"DE","rarity":"Ultra Rare","edition":"first","condition":"NM","image_url":null,"deleted":false},
    {"listing_id":"l5","copy_id":"dead1","card_id":"46986414","name":"Dunkler Magier","set_code":"LOB-DE005","language":"DE","rarity":"Ultra Rare","edition":"first","condition":"NM","image_url":null,"deleted":false},
    {"listing_id":"l6","copy_id":"nn1","card_id":"12345678","name":null,"set_code":"ABC-DE001","language":"IT","rarity":"Rare","edition":"first","condition":"LP","image_url":null,"deleted":false}
  ],
  "liveCopyIds": ["dm1","dm2","dm9","be1","ab1","tg1","cm1","old1","nn1"],
  "photos": [
    {"photo_id":"p2","listing_id":"l1","path":"l1/b b.jpg","sort":1,"deleted":false},
    {"photo_id":"p1","listing_id":"l1","path":"l1/a.jpg","sort":0,"deleted":false},
    {"photo_id":"p3","listing_id":"l1","path":"l1/c.jpg","sort":0,"deleted":true},
    {"photo_id":"p4","listing_id":"l2","path":"l2/x.jpg","sort":0,"deleted":false}
  ],
  "defs": [
    {"localizedAspectName":"Spiel","aspectConstraint":{"aspectRequired":true,"aspectMode":"SELECTION_ONLY","itemToAspectCardinality":"SINGLE"},"aspectValues":[{"localizedValue":"Pokémon TCG"},{"localizedValue":"Yu-Gi-Oh! TCG"}]},
    {"localizedAspectName":"Kartenname","aspectConstraint":{"aspectRequired":true,"aspectMode":"FREE_TEXT","itemToAspectCardinality":"SINGLE"}},
    {"localizedAspectName":"Hersteller","aspectConstraint":{"aspectRequired":false,"aspectMode":"FREE_TEXT","itemToAspectCardinality":"SINGLE"}},
    {"localizedAspectName":"Set","aspectConstraint":{"aspectRequired":false,"aspectMode":"FREE_TEXT","itemToAspectCardinality":"MULTI"}},
    {"localizedAspectName":"Seltenheit","aspectConstraint":{"aspectRequired":false,"aspectMode":"FREE_TEXT","itemToAspectCardinality":"SINGLE"}},
    {"localizedAspectName":"Sprache","aspectConstraint":{"aspectRequired":false,"aspectMode":"SELECTION_ONLY","itemToAspectCardinality":"MULTI"},"aspectValues":[{"localizedValue":"Deutsch"},{"localizedValue":"English"}]},
    {"localizedAspectName":"Besonderheiten","aspectConstraint":{"aspectRequired":false,"aspectMode":"SELECTION_ONLY","itemToAspectCardinality":"MULTI"},"aspectValues":[{"localizedValue":"1st Edition"},{"localizedValue":"Holo"}]},
    {"localizedAspectName":"Grad","aspectConstraint":{"aspectRequired":false,"aspectMode":"FREE_TEXT","itemToAspectCardinality":"SINGLE"}}
  ],
  "strictExtra": [
    {"localizedAspectName":"Charakter","aspectConstraint":{"aspectRequired":true,"aspectMode":"FREE_TEXT","itemToAspectCardinality":"SINGLE"}},
    {"localizedAspectName":"Kartentyp","aspectConstraint":{"aspectRequired":true,"aspectMode":"FREE_TEXT","itemToAspectCardinality":"SINGLE"}}
  ],
  "policies": {"payment_policy_id":"PAY1","fulfillment_policy_id":"FUL1","return_policy_id":"RET1","location_key":"ygo-default"},
  "expected": {
    "l1": {
      "active": true,
      "live": ["dm1","dm2"],
      "kind": "gleich",
      "quantity": 2,
      "pieceCents": 501,
      "condition": "NM",
      "problem": null,
      "hash": "82f58543772383ee082ca4f2e9f4092cf3ced3f5ee6c5191679f50f137d58456",
      "inventoryItem": {"availability":{"shipToLocationAvailability":{"quantity":2}},"condition":"USED_VERY_GOOD","conditionDescriptors":[{"name":"40001","values":["400010"]}],"product":{"title":"Dunkler Magier LOB-DE005 1. Auflage NM","description":"Zwei Stück.<br>Versand &lt;sicher&gt; &amp; &quot;schnell&quot;","aspects":{"Spiel":["Yu-Gi-Oh! TCG"],"Kartenname":["Dunkler Magier"],"Hersteller":["Konami"],"Set":["LOB-DE005"],"Seltenheit":["Ultra Rare"],"Sprache":["Deutsch"],"Besonderheiten":["1st Edition"]},"imageUrls":["https://proj.supabase.co/storage/v1/object/public/listing-photos/l1/a.jpg","https://proj.supabase.co/storage/v1/object/public/listing-photos/l1/b%20b.jpg","https://images.ygoprodeck.com/images/cards/46986414.jpg"]}},
      "offer": {"sku":"L-l1","marketplaceId":"EBAY_DE","format":"FIXED_PRICE","availableQuantity":2,"categoryId":"183454","listingDescription":"Zwei Stück.<br>Versand &lt;sicher&gt; &amp; &quot;schnell&quot;","listingDuration":"GTC","listingPolicies":{"fulfillmentPolicyId":"FUL1","paymentPolicyId":"PAY1","returnPolicyId":"RET1"},"merchantLocationKey":"ygo-default","pricingSummary":{"price":{"value":"5.01","currency":"EUR"}}},
      "strictMissing": ["Charakter","Kartentyp"]
    },
    "l2": {
      "active": true,
      "live": ["ab1","be1","tg1"],
      "kind": "konvolut",
      "quantity": 1,
      "pieceCents": 2500,
      "condition": "PL",
      "problem": null,
      "hash": "bc330cd26c1d93f0746c43d5836ca8ed3c22190370381d83a74b702aaa68d1ec",
      "inventoryItem": {"availability":{"shipToLocationAvailability":{"quantity":1}},"condition":"USED_VERY_GOOD","product":{"title":"Yu-Gi-Oh! Konvolut 3 Karten – Aschblüte & Freudiger Frühling…","description":"1× Aschblüte &amp; Freudiger Frühling – MACR-DE036 – Secret Rare – Limitiert – MT<br>1× Blauäugiger w. Drache – SDK-DE001 – Common – Unlimitiert – EX<br>1× Topf der Gier – PL<br><br>Preis: 25,00 €<br><br>Privatverkauf, keine Garantie oder Rücknahme.","aspects":{"Spiel":["Yu-Gi-Oh! TCG"],"Kartenname":["Aschblüte & Freudiger Frühling"],"Hersteller":["Konami"],"Set":["MACR-DE036","SDK-DE001"],"Seltenheit":["Secret Rare"],"Sprache":["Deutsch","English"]},"imageUrls":["https://proj.supabase.co/storage/v1/object/public/listing-photos/l2/x.jpg","https://images.ygoprodeck.com/images/cards/14558127.jpg","https://images.ygoprodeck.com/images/cards/89631139.jpg"]}},
      "offer": {"sku":"L-l2","marketplaceId":"EBAY_DE","format":"FIXED_PRICE","availableQuantity":1,"categoryId":"183455","listingDescription":"1× Aschblüte &amp; Freudiger Frühling – MACR-DE036 – Secret Rare – Limitiert – MT<br>1× Blauäugiger w. Drache – SDK-DE001 – Common – Unlimitiert – EX<br>1× Topf der Gier – PL<br><br>Preis: 25,00 €<br><br>Privatverkauf, keine Garantie oder Rücknahme.","listingDuration":"GTC","listingPolicies":{"fulfillmentPolicyId":"FUL1","paymentPolicyId":"PAY1","returnPolicyId":"RET1"},"merchantLocationKey":"ygo-default","pricingSummary":{"price":{"value":"25.00","currency":"EUR"}}},
      "strictMissing": ["Charakter","Kartentyp"]
    },
    "l3": {
      "active": false,
      "live": ["cm1"]
    },
    "l4": {
      "active": false,
      "live": ["old1"]
    },
    "l5": {
      "active": false,
      "live": []
    },
    "l6": {
      "active": true,
      "live": ["nn1"],
      "kind": "gleich",
      "quantity": 1,
      "pieceCents": 99,
      "condition": "LP",
      "problem": "Kein Bild vorhanden – bitte ein eigenes Foto hinzufügen.",
      "hash": "1d0dbb14ad769f63c34e92a6c232bed8c49a2a3f1db0ff3e8f3b388f6e821c12",
      "inventoryItem": {"availability":{"shipToLocationAvailability":{"quantity":1}},"condition":"USED_VERY_GOOD","conditionDescriptors":[{"name":"40001","values":["400016"]}],"product":{"title":"Yu-Gi-Oh! Sehr langer Titel mit vielen Worten der die Grenze von achtzig Zeichen","description":"Text","aspects":{"Spiel":["Yu-Gi-Oh! TCG"],"Kartenname":["12345678"],"Hersteller":["Konami"],"Set":["ABC-DE001"],"Seltenheit":["Rare"],"Besonderheiten":["1st Edition"]},"imageUrls":[]}},
      "offer": {"sku":"L-l6","marketplaceId":"EBAY_DE","format":"FIXED_PRICE","availableQuantity":1,"categoryId":"183454","listingDescription":"Text","listingDuration":"GTC","listingPolicies":{"fulfillmentPolicyId":"FUL1","paymentPolicyId":"PAY1","returnPolicyId":"RET1"},"merchantLocationKey":"ygo-default","pricingSummary":{"price":{"value":"0.99","currency":"EUR"}}},
      "strictMissing": ["Charakter","Kartentyp"]
    }
  },
  "missingTexts": [
    {"missing":["Kartenname"],"text":"eBay verlangt das Merkmal „Kartenname“."},
    {"missing":["Charakter","Kartentyp"],"text":"eBay verlangt die Merkmale „Charakter“, „Kartentyp“."}
  ]
}
```

`docs/fixtures/ebay/plan.json` (wörtlich; `nowMs` = `Date.parse("2026-09-22T12:00:00Z")`; `onlineOld` ist genau 60 Minuten alt → Stichprobe, `online` 30 Minuten → nichts):

```json
{
  "_comment": "Spec H3b §5.3/§8/§9 -- Entscheidungstabelle fuer supabase/functions/_shared/ebay-plan.ts#decide. nowMs = 2026-09-22T12:00:00Z. row: null = keine ebay_listings-Zeile; Felder, die fehlen, sind null.",
  "nowMs": 1790078400000,
  "rows": {
    "online":      { "listing_id": "l1", "environment": "sandbox", "state": "online",  "offer_id": "O1", "synced_hash": "h1", "failed_hash": null, "sold_seen": 0, "synced_at": "2026-09-22T11:30:00Z" },
    "onlineOld":   { "listing_id": "l1", "environment": "sandbox", "state": "online",  "offer_id": "O1", "synced_hash": "h1", "failed_hash": null, "sold_seen": 0, "synced_at": "2026-09-22T11:00:00Z" },
    "onlineOther": { "listing_id": "l1", "environment": "production", "state": "online", "offer_id": "P1", "synced_hash": "h1", "failed_hash": null, "sold_seen": 0, "synced_at": "2026-09-22T11:30:00Z" },
    "wartet":      { "listing_id": "l1", "environment": "sandbox", "state": "wartet",  "offer_id": null, "synced_hash": null, "failed_hash": null, "sold_seen": null, "synced_at": null },
    "fehlerNew":   { "listing_id": "l1", "environment": "sandbox", "state": "fehler",  "offer_id": null, "synced_hash": null, "failed_hash": "h1", "sold_seen": null, "synced_at": null },
    "fehlerOnl":   { "listing_id": "l1", "environment": "sandbox", "state": "fehler",  "offer_id": "O1", "synced_hash": "h0", "failed_hash": "h1", "sold_seen": 0, "synced_at": "2026-09-22T10:00:00Z" },
    "beendet":     { "listing_id": "l1", "environment": "sandbox", "state": "beendet", "offer_id": "O1", "synced_hash": "h1", "failed_hash": null, "sold_seen": 0, "synced_at": "2026-09-22T10:00:00Z" }
  },
  "cases": [
    { "name": "neu, verbunden, eingerichtet -> einstellen", "active": true, "hash": "h1", "row": null, "connected": true, "setupOk": true, "retry": false, "action": "publish" },
    { "name": "neu, nicht verbunden -> wartet", "active": true, "hash": "h1", "row": null, "connected": false, "setupOk": false, "retry": false, "action": "wait" },
    { "name": "neu, Einrichtung unvollstaendig -> wartet", "active": true, "hash": "h1", "row": null, "connected": true, "setupOk": false, "retry": false, "action": "wait" },
    { "name": "wartet bleibt wartet ohne Einrichtung (kein Schreiben)", "active": true, "hash": "h1", "row": "wartet", "connected": true, "setupOk": false, "retry": false, "action": "none" },
    { "name": "wartet, jetzt eingerichtet -> einstellen", "active": true, "hash": "h1", "row": "wartet", "connected": true, "setupOk": true, "retry": false, "action": "publish" },
    { "name": "online, gleiche Pruefsumme, frisch geprueft -> nichts", "active": true, "hash": "h1", "row": "online", "connected": true, "setupOk": true, "retry": false, "action": "none" },
    { "name": "online, gleiche Pruefsumme, vor 1 h geprueft -> Stichprobe", "active": true, "hash": "h1", "row": "onlineOld", "connected": true, "setupOk": true, "retry": false, "action": "check" },
    { "name": "online, Pruefsumme geaendert (Preis/Menge/Text) -> aendern", "active": true, "hash": "h2", "row": "online", "connected": true, "setupOk": true, "retry": false, "action": "revise" },
    { "name": "online, Erneut versuchen -> aendern", "active": true, "hash": "h1", "row": "online", "connected": true, "setupOk": true, "retry": true, "action": "revise" },
    { "name": "online, Verbindung weg -> Anzeige bleibt unberuehrt", "active": true, "hash": "h2", "row": "online", "connected": false, "setupOk": false, "retry": false, "action": "none" },
    { "name": "Soll beendet, online -> zurueckziehen", "active": false, "hash": null, "row": "online", "connected": true, "setupOk": true, "retry": false, "action": "withdraw" },
    { "name": "Soll beendet, online, nicht verbunden -> spaeter zurueckziehen", "active": false, "hash": null, "row": "online", "connected": false, "setupOk": false, "retry": false, "action": "none" },
    { "name": "Soll beendet, wartet ohne Offer -> lokal beenden", "active": false, "hash": null, "row": "wartet", "connected": false, "setupOk": false, "retry": false, "action": "end_local" },
    { "name": "Soll beendet, schon beendet -> nichts", "active": false, "hash": null, "row": "beendet", "connected": true, "setupOk": true, "retry": false, "action": "none" },
    { "name": "Soll beendet, Zeile aus anderer Umgebung -> nie anfassen", "active": false, "hash": null, "row": "onlineOther", "connected": true, "setupOk": true, "retry": false, "action": "none" },
    { "name": "Soll aktiv, Zeile aus anderer Umgebung -> neu einstellen", "active": true, "hash": "h1", "row": "onlineOther", "connected": true, "setupOk": true, "retry": false, "action": "publish" },
    { "name": "Fehler beim Einstellen, unveraendert -> nicht wiederholen", "active": true, "hash": "h1", "row": "fehlerNew", "connected": true, "setupOk": true, "retry": false, "action": "none" },
    { "name": "Fehler beim Einstellen, Erneut versuchen -> einstellen", "active": true, "hash": "h1", "row": "fehlerNew", "connected": true, "setupOk": true, "retry": true, "action": "publish" },
    { "name": "Fehler beim Einstellen, geaendert -> einstellen", "active": true, "hash": "h2", "row": "fehlerNew", "connected": true, "setupOk": true, "retry": false, "action": "publish" },
    { "name": "Fehler mit Offer, unveraendert -> nicht wiederholen", "active": true, "hash": "h1", "row": "fehlerOnl", "connected": true, "setupOk": true, "retry": false, "action": "none" },
    { "name": "Fehler mit Offer, Erneut versuchen -> aendern", "active": true, "hash": "h1", "row": "fehlerOnl", "connected": true, "setupOk": true, "retry": true, "action": "revise" },
    { "name": "Fehler mit Offer, Soll beendet -> zurueckziehen", "active": false, "hash": null, "row": "fehlerOnl", "connected": true, "setupOk": true, "retry": false, "action": "withdraw" },
    { "name": "beendet, Soll wieder aktiv -> aendern und neu veroeffentlichen", "active": true, "hash": "h1", "row": "beendet", "connected": true, "setupOk": true, "retry": false, "action": "revise" }
  ],
  "ended": [
    { "offer": null, "ended": true },
    { "offer": { "status": "UNPUBLISHED" }, "ended": true },
    { "offer": { "status": "PUBLISHED", "listing": { "listingStatus": "ACTIVE" } }, "ended": false },
    { "offer": { "status": "PUBLISHED", "listing": { "listingStatus": "OUT_OF_STOCK" } }, "ended": false },
    { "offer": { "status": "PUBLISHED", "listing": { "listingStatus": "ENDED" } }, "ended": true },
    { "offer": { "status": "PUBLISHED" }, "ended": true }
  ],
  "summaries": [
    { "s": { "published": 2, "revised": 1, "withdrawn": 0, "waiting": 0, "checked": 3, "errors": 1, "deferred": 0 }, "text": "2 eingestellt · 1 geändert · 0 beendet · 1 Fehler" },
    { "s": { "published": 0, "revised": 0, "withdrawn": 1, "waiting": 2, "checked": 0, "errors": 0, "deferred": 4 }, "text": "0 eingestellt · 0 geändert · 1 beendet · 0 Fehler · 2 wartet · 4 im nächsten Lauf" }
  ]
}
```

- [ ] **Step 2: Failing Tests schreiben**

`supabase/functions/_shared/listing-text_test.ts`:

```ts
// Spec H3b §10 -- Deno-Zwilling gegen dieselbe Fixture wie listing-text.cjs / listingText.js / ListingText.kt.
import { assertEquals } from "jsr:@std/assert@1";
import { listingDescription, listingTitle, type LineItem, pieceCents } from "./listing-text.ts";

const F = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/listings/listings.json", import.meta.url)));
const items = (ids: string[]): LineItem[] => ids.map((id) => F.items[id]);

Deno.test("Titel wie H3a (alle Fixture-Fälle)", () => {
  for (const c of F.titles) {
    const t = listingTitle(items(c.items));
    assertEquals(t, c.title, c.name);
    assertEquals(t.length, c.length, c.name);
  }
});

Deno.test("Beschreibung wie H3a (alle Fixture-Fälle)", () => {
  for (const c of F.descriptions) assertEquals(listingDescription(items(c.items), c.priceCents), c.text, c.name);
});

Deno.test("Stückpreis wie H3a (alle Fixture-Fälle)", () => {
  for (const c of F.pieceCents) assertEquals(pieceCents(c.total, c.quantity), c.cents);
});
```

`supabase/functions/_shared/ebay-map_test.ts`:

```ts
// Spec H3b §5.2/§5.3/§10 -- Abbildung Angebot -> Inventar-Artikel/Offer gegen docs/fixtures/ebay/map.json.
import { assertEquals } from "jsr:@std/assert@1";
import * as M from "./ebay-map.ts";

const F = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/ebay/map.json", import.meta.url)));
const live = new Set<string>(F.liveCopyIds);
const built = (id: string, defs = F.defs) => {
  const d = M.desired(F.listings[id], F.items, live);
  const urls = M.ownPhotos(F.photos, id).map((p) => M.photoUrl(F.baseUrl, p.path));
  return M.buildListing(F.listings[id], d.liveItems, urls, defs);
};

Deno.test("Soll: aktiv nur eBay + aktiv + lebende Position mit lebendem Exemplar", () => {
  for (const id of Object.keys(F.listings)) {
    const d = M.desired(F.listings[id], F.items, live);
    assertEquals(d.active, F.expected[id].active, id);
    assertEquals(d.liveItems.map((i) => i.copy_id), F.expected[id].live, id);
  }
  assertEquals(M.desired(null, F.items, live).active, false);
});

Deno.test("Menge, Stückpreis, Art, Zustand, Hinweis", () => {
  for (const id of Object.keys(F.expected).filter((k) => F.expected[k].active)) {
    const b = built(id), e = F.expected[id];
    assertEquals([b.kind, b.quantity, b.pieceCents, b.condition, b.problem], [e.kind, e.quantity, e.pieceCents, e.condition, e.problem], id);
  }
});

Deno.test("Inventar-Artikel und Offer wörtlich (Titel, HTML, Merkmale, Bilder, Richtlinien)", () => {
  for (const id of Object.keys(F.expected).filter((k) => F.expected[k].active)) {
    const b = built(id);
    assertEquals(M.inventoryItemBody(b), F.expected[id].inventoryItem, id);
    assertEquals(M.offerBody(b, F.policies), F.expected[id].offer, id);
  }
});

Deno.test("Prüfsumme stabil und empfindlich", async () => {
  for (const id of Object.keys(F.expected).filter((k) => F.expected[k].active)) {
    assertEquals(await M.hashOf(built(id)), F.expected[id].hash, id);
  }
  const b = built("l1");
  assertEquals(await M.hashOf({ ...b, quantity: 1 }) === F.expected.l1.hash, false, "Menge ändert die Prüfsumme");
  assertEquals(await M.hashOf({ ...b, aspects: {} }), F.expected.l1.hash, "Merkmale gehören nicht zur Prüfsumme");
});

Deno.test("Pflichtmerkmale ohne Wert -> missing, Text", () => {
  for (const id of Object.keys(F.expected).filter((k) => F.expected[k].active)) {
    assertEquals(built(id, [...F.defs, ...F.strictExtra]).missing, F.expected[id].strictMissing, id);
  }
  for (const c of F.missingTexts) assertEquals(M.missingText(c.missing), c.text);
});

Deno.test("HTML-Entschärfung und Zeilenumbrüche", () => {
  assertEquals(M.descriptionHtml("a<b>&'\"\r\nx\ry\nz"), "a&lt;b&gt;&amp;&#39;&quot;<br>x<br>y<br>z");
});

Deno.test("Bilder: höchstens 24, nur https, ohne Doppelte; eigene Fotos höchstens 12", () => {
  const many = Array.from({ length: 30 }, (_, i) => `https://x/${i}.jpg`);
  assertEquals(M.imageList([...many, "http://x/a.jpg", "https://x/0.jpg"], []).length, 24);
  const photos = Array.from({ length: 14 }, (_, i) => ({ photo_id: `p${i}`, listing_id: "l", path: `l/${i}.jpg`, sort: 13 - i, deleted: false }));
  const own = M.ownPhotos(photos, "l");
  assertEquals([own.length, own[0].photo_id], [12, "p13"]);
});
```

`supabase/functions/_shared/ebay-plan_test.ts`:

```ts
// Spec H3b §5.3/§8/§9 -- Entscheidungstabelle des Abgleichers gegen docs/fixtures/ebay/plan.json.
import { assertEquals } from "jsr:@std/assert@1";
import { decide, type EbayRow, offerEnded, summaryText } from "./ebay-plan.ts";

const F = JSON.parse(await Deno.readTextFile(new URL("../../../docs/fixtures/ebay/plan.json", import.meta.url)));
const row = (k: string | null): EbayRow | null =>
  k == null ? null : { sku: null, item_id: null, item_url: null, published_qty: null, error: null, ...F.rows[k] };

Deno.test("decide: alle Fälle der Tabelle", () => {
  for (const c of F.cases) {
    const got = decide({ active: c.active, hash: c.hash, row: row(c.row), env: "sandbox", connected: c.connected,
      setupOk: c.setupOk, retry: c.retry, nowMs: F.nowMs });
    assertEquals(got, c.action, c.name);
  }
});

Deno.test("offerEnded: nur PUBLISHED mit ACTIVE/OUT_OF_STOCK lebt", () => {
  for (const c of F.ended) assertEquals(offerEnded(c.offer), c.ended, JSON.stringify(c.offer));
});

Deno.test("summaryText", () => {
  for (const c of F.summaries) assertEquals(summaryText(c.s), c.text);
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/_shared/`
Expected: FAIL — `Module not found "file:///…/supabase/functions/_shared/listing-text.ts"` (ebenso `ebay-map.ts`, `ebay-plan.ts`).

- [ ] **Step 4: Module schreiben**

`supabase/functions/_shared/listing-text.ts` (Zwilling; Kopfkommentar nennt die anderen Fassungen):

```ts
// supabase/functions/_shared/listing-text.ts
// Spec H3b §5.2/§10 -- Deno-ZWILLING (Teilmenge) von desktop/electron/listing-text.cjs: groupItems, truncateTitle,
// listingTitle, listingDescription, pieceCents, dazu euroCentsText aus desktop/electron/sales-math.cjs.
// Weitere Fassungen: desktop/src/utils/listingText.js, android .../ml/ListingText.kt. Gemeinsame Fixture:
// docs/fixtures/listings/listings.json (titles, descriptions, pieceCents). Wer eine Fassung aendert, aendert alle.
// Laengen in UTF-16-Codeeinheiten, Vergleiche per Codeeinheiten (kein localeCompare).

export type LineItem = {
  copy_id: string; card_id: string; name?: string | null; set_code: string; language: string; rarity: string;
  edition: string; condition: string; image_url?: string | null;
};
export type Group = {
  card_id: string; name: string | null; set_code: string; language: string; rarity: string; edition: string;
  condition: string; image_url: string | null; count: number; copy_ids: string[];
};

export const TITLE_MAX = 65;
export const LANGUAGE_NAMES: Record<string, string> = {
  DE: "Deutsch", EN: "Englisch", FR: "Französisch", IT: "Italienisch", SP: "Spanisch", PT: "Portugiesisch", JP: "Japanisch",
};
const TITLE_EDITION: Record<string, string> = { first: "1. Auflage", limited: "Limitiert" };
const LINE_EDITION: Record<string, string> = { first: "1. Auflage", unlimited: "Unlimitiert", limited: "Limitiert" };
const EDITION_ORDER = ["first", "unlimited", "limited", "unknown"];
const CONDITION_ORDER = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];
const DISCLAIMER = "Privatverkauf, keine Garantie oder Rücknahme.";
const MINUS = "−";

const known = (v: string | null | undefined) => v != null && v !== "" && v !== "Unknown";
const nameOf = (g: { name?: string | null; card_id: string }) => (g.name != null && g.name !== "" ? g.name : String(g.card_id));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const foldName = (s: string) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

export function euroCentsText(c: number): string {
  const abs = Math.abs(c);
  const euros = Math.floor(abs / 100).toString().replace(/\B(?=([0-9]{3})+(?![0-9]))/g, ".");
  const txt = `${euros},${String(abs % 100).padStart(2, "0")} €`;
  return c < 0 ? MINUS + txt : txt;
}

export function groupItems(items: LineItem[]): Group[] {
  const m = new Map<string, Group>();
  for (const it of items || []) {
    const k = [String(it.card_id), it.set_code, it.language, it.rarity, it.edition, it.condition].join("|");
    const g = m.get(k);
    if (g) { g.count += 1; g.copy_ids.push(it.copy_id); continue; }
    m.set(k, {
      card_id: String(it.card_id), name: it.name ?? null, set_code: it.set_code, language: it.language, rarity: it.rarity,
      edition: it.edition, condition: it.condition, image_url: it.image_url ?? null, count: 1, copy_ids: [it.copy_id],
    });
  }
  const out = [...m.values()];
  for (const g of out) g.copy_ids.sort(cmp);
  return out.sort((a, b) => cmp(foldName(nameOf(a)), foldName(nameOf(b))) || cmp(a.set_code, b.set_code)
    || cmp(a.rarity, b.rarity) || cmp(a.language, b.language)
    || EDITION_ORDER.indexOf(a.edition) - EDITION_ORDER.indexOf(b.edition)
    || CONDITION_ORDER.indexOf(a.condition) - CONDITION_ORDER.indexOf(b.condition) || cmp(a.card_id, b.card_id));
}

export function truncateTitle(text: string, ellipsis: boolean): string {
  if (text.length <= TITLE_MAX) return text;
  const room = ellipsis ? TITLE_MAX - 1 : TITLE_MAX;
  const cut = text.lastIndexOf(" ", room);
  const head = (cut > 0 ? text.slice(0, cut) : text.slice(0, room)).replace(/[ ,–]+$/, "");
  return ellipsis ? `${head}…` : head;
}

function titleParts(g: Group): string {
  return ["Yu-Gi-Oh!", nameOf(g), known(g.set_code) ? g.set_code : null, known(g.rarity) ? g.rarity : null,
    TITLE_EDITION[g.edition] ?? null, known(g.condition) ? g.condition : null, LANGUAGE_NAMES[g.language] ?? null]
    .filter((p) => p != null).join(" ");
}

export function listingTitle(items: LineItem[]): string {
  const groups = groupItems(items);
  if (groups.length === 0) return "";
  if (groups.length === 1) {
    const g = groups[0];
    return truncateTitle(g.count > 1 ? `${g.count}× ${titleParts(g)}` : titleParts(g), false);
  }
  const n = groups.reduce((a, g) => a + g.count, 0);
  const names: string[] = [];
  for (const g of groups) if (!names.includes(nameOf(g))) names.push(nameOf(g));
  return truncateTitle(`Yu-Gi-Oh! Konvolut ${n} Karten – ${names.join(", ")}`, true);
}

export function listingDescription(items: LineItem[], priceCents: number | null): string {
  const lines = groupItems(items).map((g) => [`${g.count}× ${nameOf(g)}`, known(g.set_code) ? g.set_code : null,
    known(g.rarity) ? g.rarity : null, LINE_EDITION[g.edition] ?? null, known(g.condition) ? g.condition : null]
    .filter((p) => p != null).join(" – "));
  return [...lines, "", `Preis: ${priceCents == null ? "–" : euroCentsText(priceCents)}`, "", DISCLAIMER].join("\n");
}

export function pieceCents(totalCents: number, quantity: number): number {
  return Math.round(totalCents / quantity);
}
```

`supabase/functions/_shared/ebay-map.ts`:

```ts
// supabase/functions/_shared/ebay-map.ts
// Spec H3b §5.2/§5.3 -- reine Abbildung Angebot -> eBay-Inventar-Artikel/Offer, Prüfsumme, Zustand, Merkmale, Bilder.
// Keine Netz- oder Datenbankzugriffe (Tests: ebay-map_test.ts gegen docs/fixtures/ebay/map.json).
// Titel/Beschreibung/Stückpreis aus dem Deno-Zwilling listing-text.ts (Regeln aus H3a).
import { groupItems, LANGUAGE_NAMES, type LineItem, listingDescription, listingTitle, pieceCents } from "./listing-text.ts";

export const MARKETPLACE = "EBAY_DE";
export const CATEGORY_ID = "183454";      // Einzelkarten (Nutzer 22.09.: Konvolute in 183455)
export const CATEGORY_LOTS = "183455";    // „Sammlungen & Lots“ (Befund Doku 15)
export const EBAY_TITLE_MAX = 80;
export const MAX_IMAGES = 24;
export const MAX_OWN_PHOTOS = 12;
export const PHOTO_BUCKET = "listing-photos";
// Inventory API ConditionEnum fuer Condition-ID 4000 = „Ungraded“ in den Sammelkarten-Kategorien (Befund eBay-Doku 6).
export const CONDITION_UNGRADED = "USED_VERY_GOOD";
export const CARD_CONDITION_DESCRIPTOR = "40001";
// CCG-Werte (Befund eBay-Doku 7): 400010 Near mint or better, 400015 Lightly played (Excellent),
// 400016 Moderately played (Very good), 400017 Heavily played (Poor).
export const CARD_CONDITION_VALUE: Record<string, string> = {
  MT: "400010", NM: "400010", EX: "400015", GD: "400016", LP: "400016", PL: "400017", PO: "400017",
};
const CONDITION_ORDER = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];
const LANGUAGE_EN: Record<string, string> = {
  DE: "German", EN: "English", FR: "French", IT: "Italian", SP: "Spanish", PT: "Portuguese", JP: "Japanese",
};

export type SollListing = {
  listing_id: string; channel_id: string; title: string | null; description: string | null;
  price: number | string; status: string; deleted: boolean;
};
export type SollItem = LineItem & { listing_id: string; deleted: boolean };
export type Photo = { photo_id: string; listing_id: string; path: string; sort: number; deleted: boolean };
export type AspectDef = {
  localizedAspectName: string;
  aspectConstraint?: { aspectRequired?: boolean; aspectMode?: string; itemToAspectCardinality?: string };
  aspectValues?: { localizedValue: string }[];
};
export type Policies = {
  payment_policy_id: string | null; fulfillment_policy_id: string | null; return_policy_id: string | null;
  location_key: string | null;
};
export type Built = {
  sku: string; kind: "gleich" | "konvolut"; quantity: number; totalCents: number; pieceCents: number;
  title: string; descriptionHtml: string; condition: string; conditionValue: string; imageUrls: string[];
  aspects: Record<string, string[]>; missing: string[]; problem: string | null; categoryId: string;
};

// Abweichung 10: Konvolut (mehrere Drucke) -> Kategorie 183455, sonst 183454. Vor buildListing aufrufbar, damit der
// Abgleicher die Pflichtmerkmale der richtigen Kategorie laden kann.
export function categoryFor(liveItems: SollItem[]): string {
  return groupItems(liveItems).length === 1 ? CATEGORY_ID : CATEGORY_LOTS;
}

const blank = (v: string | null | undefined) => v == null || v.trim() === "";
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const toCents = (v: number | string) => Math.round(Number(v) * 100);
export const skuOf = (listingId: string) => `L-${listingId}`;

// Spec §5.3 Soll: Angebot auf Kanal ebay, Status aktiv, nicht gelöscht, mit mindestens einer lebenden Position,
// deren Exemplar lebt (liveCopyIds = card_copies deleted = false und sold_in is null). Positionen nach copy_id.
export function desired(listing: SollListing | null, items: SollItem[], liveCopyIds: Set<string>) {
  if (!listing) return { active: false, liveItems: [] as SollItem[] };
  const liveItems = items
    .filter((it) => it.listing_id === listing.listing_id && !it.deleted && liveCopyIds.has(it.copy_id))
    .sort((a, b) => cmp(a.copy_id, b.copy_id));
  const active = listing.channel_id === "ebay" && listing.status === "aktiv" && !listing.deleted && liveItems.length > 0;
  return { active, liveItems };
}

// Öffentliche Adresse eines Fotos im Speicher (Bucket öffentlich lesbar, Spec §6). Pfad-Teile einzeln kodiert.
export function photoUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${PHOTO_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
}
// Eigene Fotos eines Angebots in Reihenfolge (sort, dann photo_id), höchstens 12, gelöschte nicht.
export function ownPhotos(photos: Photo[], listingId: string): Photo[] {
  return photos.filter((p) => p.listing_id === listingId && !p.deleted)
    .sort((a, b) => a.sort - b.sort || cmp(a.photo_id, b.photo_id)).slice(0, MAX_OWN_PHOTOS);
}

// Spec §5.2 Bilder: eigene Fotos (Reihenfolge), danach Katalogbild je Druck (Gruppenreihenfolge wie H3a), nur https,
// ohne Doppelte, höchstens 24.
export function imageList(photoUrls: string[], liveItems: LineItem[]): string[] {
  const out: string[] = [];
  for (const u of [...photoUrls, ...groupItems(liveItems).map((g) => g.image_url)]) {
    if (typeof u !== "string" || !/^https:\/\//i.test(u) || out.includes(u)) continue;
    out.push(u);
    if (out.length === MAX_IMAGES) break;
  }
  return out;
}

// Konvolut: schlechtester Zustand (höchster Index in MT…PO); unbekannte Kennungen zählen als NM.
export function worstCondition(items: LineItem[]): string {
  let worst = "NM";
  for (const it of items) {
    const i = CONDITION_ORDER.indexOf(it.condition);
    if (i > CONDITION_ORDER.indexOf(worst)) worst = it.condition;
  }
  return worst;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
export function descriptionHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>");
}

// Merkmal-Namen (klein, getrimmt) -> Begriff. eBay.de liefert die Namen lokalisiert; die englischen stehen als
// Rückfall (Sandbox). Unbekannte Namen bleiben leer; sind sie Pflicht, stehen sie in missing (Spec §5.2).
const CONCEPT_BY_NAME: Record<string, string> = {
  "spiel": "game", "game": "game",
  "hersteller": "manufacturer", "manufacturer": "manufacturer",
  "kartenname": "cardName", "card name": "cardName",
  "set": "set",
  "seltenheit": "rarity", "rarität": "rarity", "rarity": "rarity",
  "sprache": "language", "language": "language",
  "besonderheiten": "features", "features": "features", "merkmale": "features",
};
const knownValue = (v: string | null | undefined) => v != null && v !== "" && v !== "Unknown";
function distinct(list: string[]): string[] {
  const out: string[] = [];
  for (const v of list) if (!out.includes(v)) out.push(v);
  return out;
}
// Je Begriff eine Liste von Werten; jeder Wert ist eine Liste gleichwertiger Schreibweisen (erste = bevorzugt).
export function aspectCandidates(liveItems: LineItem[]): Record<string, string[][]> {
  const groups = groupItems(liveItems);
  return {
    game: [["Yu-Gi-Oh! TCG"]],
    manufacturer: [["Konami"]],
    cardName: distinct(groups.map((g) => (g.name != null && g.name !== "" ? g.name : g.card_id))).map((v) => [v]),
    set: distinct(groups.map((g) => g.set_code).filter(knownValue)).map((v) => [v]),
    rarity: distinct(groups.map((g) => g.rarity).filter(knownValue)).map((v) => [v]),
    language: distinct(groups.map((g) => g.language)).filter((l) => LANGUAGE_NAMES[l])
      .map((l) => [LANGUAGE_NAMES[l], LANGUAGE_EN[l]]),
    features: groups.some((g) => g.edition === "first") ? [["1. Auflage", "1st Edition"]] : [],
  };
}
function matchAllowed(alts: string[], allowed: { localizedValue: string }[] | undefined): string | null {
  for (const a of alts) {
    const hit = (allowed || []).find((v) => v.localizedValue.toLowerCase() === a.toLowerCase());
    if (hit) return hit.localizedValue;
  }
  return null;
}
export function fillAspects(defs: AspectDef[], liveItems: LineItem[]) {
  const cand = aspectCandidates(liveItems);
  const aspects: Record<string, string[]> = {};
  const missing: string[] = [];
  for (const d of defs || []) {
    const name = d.localizedAspectName;
    const concept = CONCEPT_BY_NAME[name.trim().toLowerCase()];
    const c = d.aspectConstraint || {};
    const multi = c.itemToAspectCardinality === "MULTI";
    const values: string[] = [];
    for (const alts of concept ? cand[concept] : []) {
      const v = c.aspectMode === "SELECTION_ONLY" ? matchAllowed(alts, d.aspectValues) : alts[0];
      if (v != null && !values.includes(v)) values.push(v);
      if (!multi && values.length > 0) break;
    }
    if (values.length > 0) aspects[name] = values;
    else if (c.aspectRequired) missing.push(name);
  }
  return { aspects, missing };
}
export const NO_IMAGE = "Kein Bild vorhanden – bitte ein eigenes Foto hinzufügen.";
export function missingText(missing: string[]): string {
  return missing.length === 1
    ? `eBay verlangt das Merkmal „${missing[0]}“.`
    : `eBay verlangt die Merkmale ${missing.map((m) => `„${m}“`).join(", ")}.`;
}

// Spec §5.2: gleiche Karten -> Menge n, Stückpreis = pieceCents(Preis, n); Konvolut -> Menge 1, Gesamtpreis.
// Titel: Angebotstitel, leer -> H3a-Titelregel; höchstens 80. Beschreibung: Angebotstext, leer -> H3a-Beschreibung.
export function buildListing(
  listing: SollListing, liveItems: SollItem[], photoUrls: string[], defs: AspectDef[],
): Built {
  const totalCents = toCents(listing.price);
  const same = groupItems(liveItems).length === 1;
  const quantity = same ? liveItems.length : 1;
  const condition = worstCondition(liveItems);
  const title = (blank(listing.title) ? listingTitle(liveItems) : listing.title!.trim()).slice(0, EBAY_TITLE_MAX).trimEnd();
  const text = blank(listing.description) ? listingDescription(liveItems, totalCents) : listing.description!;
  const { aspects, missing } = fillAspects(defs, liveItems);
  const imageUrls = imageList(photoUrls, liveItems);
  // Vor jedem eBay-Aufruf prüfbar: eBay veröffentlicht nur mit mindestens einem Bild und allen Pflichtmerkmalen.
  const problem = imageUrls.length === 0 ? NO_IMAGE : missing.length > 0 ? missingText(missing) : null;
  return {
    sku: skuOf(listing.listing_id), kind: same ? "gleich" : "konvolut", quantity, totalCents,
    pieceCents: same ? pieceCents(totalCents, quantity) : totalCents, title, descriptionHtml: descriptionHtml(text),
    condition, conditionValue: CARD_CONDITION_VALUE[condition], imageUrls, aspects, missing, problem,
    categoryId: same ? CATEGORY_ID : CATEGORY_LOTS,
  };
}

const money = (cents: number) => ({ value: (cents / 100).toFixed(2), currency: "EUR" });

export function inventoryItemBody(b: Built) {
  return {
    availability: { shipToLocationAvailability: { quantity: b.quantity } },
    condition: CONDITION_UNGRADED,
    // Kartenzustand-Deskriptor nur in der Einzelkarten-Kategorie (eBay listet ihn für 183050/183454/261328, nicht für 183455).
    ...(b.categoryId === CATEGORY_ID ? { conditionDescriptors: [{ name: CARD_CONDITION_DESCRIPTOR, values: [b.conditionValue] }] } : {}),
    product: { title: b.title, description: b.descriptionHtml, aspects: b.aspects, imageUrls: b.imageUrls },
  };
}
export function offerBody(b: Built, p: Policies) {
  return {
    sku: b.sku, marketplaceId: MARKETPLACE, format: "FIXED_PRICE", availableQuantity: b.quantity,
    categoryId: b.categoryId, listingDescription: b.descriptionHtml, listingDuration: "GTC",
    listingPolicies: {
      fulfillmentPolicyId: p.fulfillment_policy_id, paymentPolicyId: p.payment_policy_id, returnPolicyId: p.return_policy_id,
    },
    merchantLocationKey: p.location_key, pricingSummary: { price: money(b.pieceCents) },
  };
}

// Spec §5.3 Prüfsumme über Titel, Text, Preis, Menge, Zustand, Bilder (SHA-256, hex).
export async function hashOf(b: Built): Promise<string> {
  const data = new TextEncoder().encode(
    JSON.stringify([b.title, b.descriptionHtml, b.pieceCents, b.quantity, b.conditionValue, b.imageUrls]),
  );
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Link der Anzeige je Umgebung (Befund eBay-Doku 12: Sandbox-Adresse ist bei der Abnahme zu prüfen).
export function itemUrl(env: string, itemId: string): string {
  return env === "production" ? `https://www.ebay.de/itm/${itemId}` : `https://sandbox.ebay.de/itm/${itemId}`;
}
```

`supabase/functions/_shared/ebay-plan.ts`:

```ts
// supabase/functions/_shared/ebay-plan.ts
// Spec H3b §5.3/§8/§9 -- reine Entscheidung je Angebot: was der Abgleicher tun muss (Soll/Ist). Keine Aufrufe.
// Tests: ebay-plan_test.ts gegen docs/fixtures/ebay/plan.json.

export type RowState = "wartet" | "online" | "fehler" | "beendet";
export type EbayRow = {
  listing_id: string; environment: string; state: RowState; sku: string | null; offer_id: string | null;
  item_id: string | null; item_url: string | null; published_qty: number | null; synced_hash: string | null;
  failed_hash: string | null; sold_seen: number | null; error: string | null; synced_at: string | null;
};
export type Action = "none" | "wait" | "end_local" | "publish" | "revise" | "withdraw" | "check";

// Stichprobe (Spec §5.3 „manuell auf eBay beendet“): eine unveränderte Online-Anzeige wird höchstens stündlich gelesen.
export const CHECK_EVERY_MS = 60 * 60 * 1000;

export type DecideInput = {
  active: boolean; hash: string | null; row: EbayRow | null; env: string;
  connected: boolean; setupOk: boolean; retry: boolean; nowMs: number;
};

export function decide(x: DecideInput): Action {
  // Spec §5.3 Umgebung: eine Zeile aus der anderen Umgebung wird nie angefasst; sie gilt als „beendet (andere Umgebung)“.
  const r = x.row && x.row.environment === x.env ? x.row : null;
  if (!x.active) {
    if (!r || r.state === "beendet") return "none";
    // Zurückziehen braucht die Verbindung; bis dahin bleibt die Zeile, wie sie ist (nächster Lauf nach dem Verbinden).
    return r.offer_id ? (x.connected ? "withdraw" : "none") : "end_local";
  }
  // Spec §4.4/§9: ohne Verbindung oder Einrichtung bleiben Angebote „wartet“; eine Online-Anzeige bleibt unberührt.
  if (!x.connected || !x.setupOk) {
    if (r && (r.state === "online" || r.state === "wartet")) return "none";
    return "wait";
  }
  if (!r || !r.offer_id) {
    if (r && r.state === "fehler" && r.failed_hash === x.hash && !x.retry) return "none";
    return "publish";
  }
  // Ein Fehler wird nur nach „Erneut versuchen“ oder nach einer Änderung (neue Prüfsumme) wiederholt.
  if (r.state === "fehler") return r.failed_hash === x.hash && !x.retry ? "none" : "revise";
  if (r.state !== "online" || r.synced_hash !== x.hash || x.retry) return "revise";
  const last = r.synced_at ? Date.parse(r.synced_at) : NaN;
  return !Number.isFinite(last) || x.nowMs - last >= CHECK_EVERY_MS ? "check" : "none";
}

// Anzeige auf eBay gilt als lebend bei ACTIVE oder OUT_OF_STOCK (Befund eBay-Doku 8); alles andere = beendet.
export function offerEnded(o: { status?: string; listing?: { listingStatus?: string } } | null): boolean {
  if (!o || o.status !== "PUBLISHED") return true;
  const s = o.listing?.listingStatus;
  return s !== "ACTIVE" && s !== "OUT_OF_STOCK";
}

export const ENDED_ON_EBAY = "auf eBay beendet – in der App beenden oder erneut einstellen";
export const SOLD_ON_EBAY = "Auf eBay verkauft – bitte den Verkauf in der App buchen, danach „Erneut versuchen“.";
export const EXPIRED = "Verbindung abgelaufen – bitte neu verbinden";

export type Summary = { published: number; revised: number; withdrawn: number; waiting: number; checked: number; errors: number; deferred: number };
export const emptySummary = (): Summary => ({ published: 0, revised: 0, withdrawn: 0, waiting: 0, checked: 0, errors: 0, deferred: 0 });
export function summaryText(s: Summary): string {
  const parts = [`${s.published} eingestellt`, `${s.revised} geändert`, `${s.withdrawn} beendet`, `${s.errors} Fehler`];
  if (s.waiting > 0) parts.push(`${s.waiting} wartet`);
  if (s.deferred > 0) parts.push(`${s.deferred} im nächsten Lauf`);
  return parts.join(" · ");
}
```

- [ ] **Step 5: Tests grün**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/_shared/`
Expected: PASS, 13 Tests (3 `listing-text_test.ts` + 7 `ebay-map_test.ts` + 3 `ebay-plan_test.ts`).

- [ ] **Step 6: Schutz-Nachweise** (je: per Edit sabotieren, Fehlschlag zitieren, per Edit zurücknehmen)

1. `listing-text.ts#truncateTitle`: `replace(/[ ,–]+$/, "")` → `replace(/[ ]+$/, "")`. „Titel wie H3a“ scheitert am Fall „Konvolut, gekuerzt mit Auslassungszeichen, Komma entfernt“.
2. `ebay-map.ts#desired`: `&& liveCopyIds.has(it.copy_id)` entfernen. „Soll: aktiv nur …“ scheitert (`l1` liefert `dm3` mit, `l5` wird aktiv).
3. `ebay-map.ts#CARD_CONDITION_VALUE`: `PL: "400017"` → `PL: "400013"` (Sport-Wert statt CCG). „Inventar-Artikel und Offer wörtlich“ und „Prüfsumme stabil“ scheitern bei `l2` (vom Plan-Autor ausgeführt). Zurücknehmen.
4. `ebay-plan.ts#decide`: in der Fehler-Zeile `&& !x.retry` entfernen. „decide: alle Fälle“ scheitert bei „Fehler mit Offer, Erneut versuchen -> aendern“.
5. `ebay-plan.ts#decide`: die Umgebungsprüfung `x.row.environment === x.env ?` durch `x.row ?` ersetzen. Scheitert bei „Soll beendet, Zeile aus anderer Umgebung -> nie anfassen“.

- [ ] **Step 7: Commit** (`deno.lock` NICHT stagen)

```bash
git add supabase/functions/_shared/listing-text.ts supabase/functions/_shared/listing-text_test.ts supabase/functions/_shared/ebay-map.ts supabase/functions/_shared/ebay-map_test.ts supabase/functions/_shared/ebay-plan.ts supabase/functions/_shared/ebay-plan_test.ts docs/fixtures/ebay/map.json docs/fixtures/ebay/plan.json
git commit -m "feat(h3b1): reine Deno-Regeln fuer eBay (Titel-Zwilling, Abbildung, Pruefsumme, Entscheidung)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: eBay-Client mit eingespeistem `fetch` (OAuth, Account, Inventory, Taxonomy)

**Files:**
- Create: `supabase/functions/_shared/ebay-client.ts`, `supabase/functions/_shared/ebay-client_test.ts`, `supabase/functions/_shared/fake-fetch.ts`

**Interfaces:**
- Consumes: `ebay-map.ts#MARKETPLACE, AspectDef` (Task 1).
- Produces: `type Env = "sandbox"|"production"`, `type Fetch`, `type Creds = { clientId, clientSecret, ruName }`, `HOSTS`, `USER_SCOPES`, `APP_SCOPE`, `class EbayError(message, status, transient, auth)`, `credsFor(env, get)`, `consentUrl(env, creds, state)`, `type TokenSet`, `exchangeCode(fetch, env, creds, code, now) -> TokenSet`, `refreshAccess(fetch, env, creds, refreshToken, now)`, `appToken(fetch, env, creds)`, `ensureAccess(fetch, env, creds, acc, now) -> { token, patch|null }`, `type Offer`, `ebayApi(fetch, env, token)` mit `optedInPrograms, paymentPolicies, fulfillmentPolicies, returnPolicies, locations, createLocation, putInventoryItem, getOffers, getOffer, createOffer, updateOffer, publishOffer, withdrawOffer`, `type EbayApi`, `categoryAspects(fetch, env, appToken, categoryId)`.
- Produces (nur Tests): `fake-fetch.ts#fakeFetch(routes) -> { fetchFn, calls }`.

- [ ] **Step 1: Failing Test und Test-Helfer schreiben**

`supabase/functions/_shared/fake-fetch.ts`:

```ts
// supabase/functions/_shared/fake-fetch.ts -- NUR für Tests: nachgebautes HTTP ohne Netz.
// routes: "METHOD https://host/pfad?query" (genau) oder "METHOD https://host/pfad" (ohne Query) -> Antwort oder Funktion.
export type Call = { method: string; url: string; headers: Record<string, string>; body: string | null };
export type Reply = { status?: number; body?: unknown } | ((c: Call) => { status?: number; body?: unknown });

export function fakeFetch(routes: Record<string, Reply>) {
  const calls: Call[] = [];
  const fetchFn = (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    const c: Call = { method, url, headers, body: typeof init.body === "string" ? init.body : null };
    calls.push(c);
    const r = routes[`${method} ${url}`] ?? routes[`${method} ${url.split("?")[0]}`];
    if (!r) return Promise.resolve(new Response(JSON.stringify({ errors: [{ message: `keine Route ${method} ${url}` }] }), { status: 599 }));
    const x = typeof r === "function" ? r(c) : r;
    const status = x.status ?? 200;
    const text = x.body === undefined ? null : JSON.stringify(x.body);
    return Promise.resolve(new Response(status === 204 ? null : text, { status }));
  };
  return { fetchFn, calls };
}
```

`supabase/functions/_shared/ebay-client_test.ts` (die Ablaufzeit `2028-03-23T00:00:00.000Z` = 12:00 + 47 304 000 s = 547,5 Tage, nachgerechnet mit `new Date(Date.parse("2026-09-22T12:00:00Z") + 47304000e3)`):

```ts
// Spec H3b §4.3/§9 -- eBay-Client gegen nachgebaute Antworten (kein Netz).
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  categoryAspects, consentUrl, credsFor, EbayError, ebayApi, ensureAccess, exchangeCode, refreshAccess,
} from "./ebay-client.ts";
import { fakeFetch } from "./fake-fetch.ts";

const C = { clientId: "app-id", clientSecret: "geheim", ruName: "Ru-Name-1" };
const NOW = new Date("2026-09-22T12:00:00Z");
const TOKEN = "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
const API = "https://api.sandbox.ebay.com";

Deno.test("Zustimmungs-URL Sandbox/Produktion mit allen vier Rechten und state", () => {
  const scope = "https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.inventory+https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.account+https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.fulfillment+https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.finances";
  assertEquals(consentUrl("sandbox", C, "s1"),
    `https://auth.sandbox.ebay.com/oauth2/authorize?client_id=app-id&redirect_uri=Ru-Name-1&response_type=code&scope=${scope}&state=s1`);
  assertEquals(consentUrl("production", C, "s1").startsWith("https://auth.ebay.com/oauth2/authorize?"), true);
});

Deno.test("Secrets je Umgebung; fehlend -> Einrichtungsfehler ohne Wert", () => {
  const env: Record<string, string> = { EBAY_PROD_CLIENT_ID: "a", EBAY_PROD_CLIENT_SECRET: "b", EBAY_PROD_RUNAME: "c" };
  assertEquals(credsFor("production", (k) => env[k]), { clientId: "a", clientSecret: "b", ruName: "c" });
  try { credsFor("sandbox", (k) => env[k]); throw new Error("kein Fehler"); }
  catch (e) { assertEquals((e as Error).message, "eBay-Zugangsdaten für Sandbox fehlen (Secrets EBAY_SANDBOX_…)."); }
});

Deno.test("Code tauschen: Basic-Kopf, Formular, Ablaufzeiten", async () => {
  const f = fakeFetch({ [`POST ${TOKEN}`]: { body: { access_token: "AT", expires_in: 7200, refresh_token: "RT", refresh_token_expires_in: 47304000, token_type: "User Access Token" } } });
  const t = await exchangeCode(f.fetchFn, "sandbox", C, "v^1.1#i^1", NOW);
  assertEquals(t, { access_token: "AT", access_expires_at: "2026-09-22T14:00:00.000Z", refresh_token: "RT", refresh_expires_at: "2028-03-23T00:00:00.000Z" });
  assertEquals(f.calls[0].headers["authorization"], `Basic ${btoa("app-id:geheim")}`);
  assertEquals(f.calls[0].headers["content-type"], "application/x-www-form-urlencoded");
  assertEquals(f.calls[0].body, "grant_type=authorization_code&code=v%5E1.1%23i%5E1&redirect_uri=Ru-Name-1");
});

Deno.test("Token erneuern nur, wenn weniger als 5 Minuten übrig", async () => {
  const f = fakeFetch({ [`POST ${TOKEN}`]: { body: { access_token: "AT2", expires_in: 7200 } } });
  const fresh = await ensureAccess(f.fetchFn, "sandbox", C, { access_token: "AT", access_expires_at: "2026-09-22T12:06:00Z", refresh_token: "RT" }, NOW);
  assertEquals([fresh.token, fresh.patch, f.calls.length], ["AT", null, 0]);
  const old = await ensureAccess(f.fetchFn, "sandbox", C, { access_token: "AT", access_expires_at: "2026-09-22T12:04:00Z", refresh_token: "RT" }, NOW);
  assertEquals(old, { token: "AT2", patch: { access_token: "AT2", access_expires_at: "2026-09-22T14:00:00.000Z" } });
  assertEquals(f.calls[0].body?.startsWith("grant_type=refresh_token&refresh_token=RT&scope="), true);
});

Deno.test("Fehler: invalid_grant = auth, 500/429 = vorübergehend, longMessage bevorzugt", async () => {
  const bad = fakeFetch({ [`POST ${TOKEN}`]: { status: 400, body: { error: "invalid_grant", error_description: "the provided authorization refresh token is invalid" } } });
  const e1 = await assertRejects(() => refreshAccess(bad.fetchFn, "sandbox", C, "RT", NOW), EbayError);
  assertEquals([e1.auth, e1.transient, e1.message], [true, false, "the provided authorization refresh token is invalid"]);
  const busy = fakeFetch({ [`GET ${API}/sell/inventory/v1/offer/O1`]: { status: 503, body: {} } });
  const e2 = await assertRejects(() => ebayApi(busy.fetchFn, "sandbox", "AT").getOffer("O1"), EbayError);
  assertEquals([e2.transient, e2.auth], [true, false]);
  const rej = fakeFetch({ [`POST ${API}/sell/inventory/v1/offer/O1/publish`]: { status: 400, body: { errors: [{ errorId: 25002, message: "kurz", longMessage: "Das Merkmal Spiel fehlt." }] } } });
  const e3 = await assertRejects(() => ebayApi(rej.fetchFn, "sandbox", "AT").publishOffer("O1"), EbayError);
  assertEquals([e3.message, e3.transient, e3.auth], ["Das Merkmal Spiel fehlt.", false, false]);
  const net = await assertRejects(() => ebayApi(() => Promise.reject(new Error("dns")), "sandbox", "AT").getOffer("O1"), EbayError);
  assertEquals(net.transient, true);
});

Deno.test("API-Aufrufe: Pfade, Kopfzeilen, 404 bei getOffers/getOffer", async () => {
  const f = fakeFetch({
    [`PUT ${API}/sell/inventory/v1/inventory_item/L-l1`]: { status: 204 },
    [`GET ${API}/sell/inventory/v1/offer?sku=L-l1&marketplace_id=EBAY_DE`]: { status: 404, body: { errors: [{ errorId: 25713 }] } },
    [`GET ${API}/sell/inventory/v1/offer/O9`]: { status: 404, body: {} },
    [`POST ${API}/sell/inventory/v1/offer`]: { status: 201, body: { offerId: "O1" } },
    [`GET ${API}/sell/account/v1/payment_policy?marketplace_id=EBAY_DE`]: { body: { paymentPolicies: [{ paymentPolicyId: "P1", name: "PayPal" }] } },
    [`GET ${API}/sell/inventory/v1/location?limit=100`]: { body: { locations: [{ merchantLocationKey: "ygo-default", name: "Lager", merchantLocationStatus: "ENABLED" }, { merchantLocationKey: "alt", merchantLocationStatus: "DISABLED" }] } },
  });
  const api = ebayApi(f.fetchFn, "sandbox", "AT");
  await api.putInventoryItem("L-l1", { a: 1 });
  assertEquals(await api.getOffers("L-l1"), []);
  assertEquals(await api.getOffer("O9"), null);
  assertEquals(await api.createOffer({}), "O1");
  assertEquals(await api.paymentPolicies(), [{ id: "P1", name: "PayPal" }]);
  assertEquals(await api.locations(), [{ id: "ygo-default", name: "Lager" }]);
  assertEquals(f.calls[0].headers["content-language"], "de-DE");
  assertEquals(f.calls[0].headers["authorization"], "Bearer AT");
  assertEquals(f.calls[0].body, '{"a":1}');
});

Deno.test("Taxonomy: Baum-ID holen, dann Merkmale der Kategorie", async () => {
  const base = "https://api.sandbox.ebay.com/commerce/taxonomy/v1";
  const f = fakeFetch({
    [`GET ${base}/get_default_category_tree_id?marketplace_id=EBAY_DE`]: { body: { categoryTreeId: "77", categoryTreeVersion: "129" } },
    [`GET ${base}/category_tree/77/get_item_aspects_for_category?category_id=183454`]: { body: { aspects: [{ localizedAspectName: "Spiel" }] } },
  });
  assertEquals(await categoryAspects(f.fetchFn, "sandbox", "APP", "183454"), [{ localizedAspectName: "Spiel" }]);
  assertEquals(f.calls.map((c) => c.headers["authorization"]), ["Bearer APP", "Bearer APP"]);
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/_shared/ebay-client_test.ts`
Expected: FAIL — `Module not found … ebay-client.ts`.

- [ ] **Step 3: `ebay-client.ts` schreiben**

```ts
// supabase/functions/_shared/ebay-client.ts
// Spec H3b §4/§5 -- schlanker eBay-Client nur mit fetch (kein SDK). fetch wird hereingereicht (Tests: nachgebautes eBay,
// kein Netz). Fehler kommen einheitlich als EbayError (transient = Durchgang abbrechen, auth = neu verbinden).
// NIE Tokens, Codes oder Secrets protokollieren oder in Fehlermeldungen übernehmen.
import { type AspectDef, MARKETPLACE } from "./ebay-map.ts";

export type Env = "sandbox" | "production";
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type Creds = { clientId: string; clientSecret: string; ruName: string };

export const HOSTS: Record<Env, { auth: string; api: string }> = {
  sandbox: { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com" },
  production: { auth: "https://auth.ebay.com", api: "https://api.ebay.com" },
};
// Befund eBay-Doku 3: dieselben Scope-Adressen in Sandbox und Produktion.
export const USER_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
];
// Befund eBay-Doku 9: Taxonomy verlangt ein Anwendungs-Token (client_credentials) mit dem Basis-Scope.
export const APP_SCOPE = "https://api.ebay.com/oauth/api_scope";

export class EbayError extends Error {
  constructor(message: string, readonly status: number, readonly transient: boolean, readonly auth: boolean) {
    super(message);
  }
}

// Secrets je Umgebung (Spec §4.1); fehlen sie, ist das ein Einrichtungsfehler, kein eBay-Fehler.
export function credsFor(env: Env, get: (k: string) => string | undefined): Creds {
  const p = env === "production" ? "EBAY_PROD" : "EBAY_SANDBOX";
  const clientId = get(`${p}_CLIENT_ID`), clientSecret = get(`${p}_CLIENT_SECRET`), ruName = get(`${p}_RUNAME`);
  if (!clientId || !clientSecret || !ruName) {
    throw new EbayError(`eBay-Zugangsdaten für ${env === "production" ? "Produktion" : "Sandbox"} fehlen (Secrets ${p}_…).`, 0, false, false);
  }
  return { clientId, clientSecret, ruName };
}

export function consentUrl(env: Env, c: Creds, state: string): string {
  const q = new URLSearchParams({
    client_id: c.clientId, redirect_uri: c.ruName, response_type: "code", scope: USER_SCOPES.join(" "), state,
  });
  return `${HOSTS[env].auth}/oauth2/authorize?${q.toString()}`;
}

const basic = (c: Creds) => `Basic ${btoa(`${c.clientId}:${c.clientSecret}`)}`;
const isoIn = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString();

async function readJson(r: Response): Promise<any> {
  const t = await r.text();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; }
}
// eBay-REST-Fehler: { errors: [{ errorId, message, longMessage }] }; OAuth: { error, error_description }.
function errorText(body: any, status: number): string {
  const e = body?.errors?.[0];
  const text = e?.longMessage || e?.message || body?.error_description || body?.error || body?.raw;
  return text ? String(text) : `eBay-Aufruf fehlgeschlagen (${status})`;
}
function toError(body: any, status: number, oauth: boolean): EbayError {
  const transient = status === 429 || status >= 500;
  const auth = status === 401 || (oauth && (status === 400 || status === 401) && /invalid_grant|invalid_client/i.test(String(body?.error ?? "")));
  return new EbayError(errorText(body, status), status, transient, auth);
}
async function send(fetchFn: Fetch, url: string, init: RequestInit, oauth = false): Promise<any> {
  let r: Response;
  try { r = await fetchFn(url, init); }
  catch (e) { throw new EbayError(`eBay nicht erreichbar: ${(e as Error).message}`, 0, true, false); }
  const body = await readJson(r);
  if (!r.ok) throw toError(body, r.status, oauth);
  return body;
}

export type TokenSet = { access_token: string; access_expires_at: string; refresh_token: string; refresh_expires_at: string };

async function tokenCall(fetchFn: Fetch, env: Env, c: Creds, form: Record<string, string>) {
  return await send(fetchFn, `${HOSTS[env].api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basic(c) },
    body: new URLSearchParams(form).toString(),
  }, true);
}
export async function exchangeCode(fetchFn: Fetch, env: Env, c: Creds, code: string, now: Date): Promise<TokenSet> {
  const b = await tokenCall(fetchFn, env, c, { grant_type: "authorization_code", code, redirect_uri: c.ruName });
  return {
    access_token: b.access_token, access_expires_at: isoIn(now, Number(b.expires_in)),
    refresh_token: b.refresh_token, refresh_expires_at: isoIn(now, Number(b.refresh_token_expires_in)),
  };
}
export async function refreshAccess(fetchFn: Fetch, env: Env, c: Creds, refreshToken: string, now: Date) {
  const b = await tokenCall(fetchFn, env, c, { grant_type: "refresh_token", refresh_token: refreshToken, scope: USER_SCOPES.join(" ") });
  return { access_token: String(b.access_token), access_expires_at: isoIn(now, Number(b.expires_in)) };
}
export async function appToken(fetchFn: Fetch, env: Env, c: Creds): Promise<string> {
  const b = await tokenCall(fetchFn, env, c, { grant_type: "client_credentials", scope: APP_SCOPE });
  return String(b.access_token);
}

// Gültiges Nutzer-Token: das gespeicherte, solange es noch mindestens 5 Minuten gilt, sonst erneuert.
// -> { token, patch } (patch = zu speichernde neue Werte oder null).
export async function ensureAccess(
  fetchFn: Fetch, env: Env, c: Creds,
  acc: { access_token: string | null; access_expires_at: string | null; refresh_token: string | null }, now: Date,
) {
  if (acc.access_token && acc.access_expires_at && Date.parse(acc.access_expires_at) - now.getTime() > 5 * 60 * 1000) {
    return { token: acc.access_token, patch: null };
  }
  if (!acc.refresh_token) throw new EbayError("Nicht mit eBay verbunden.", 401, false, true);
  const p = await refreshAccess(fetchFn, env, c, acc.refresh_token, now);
  return { token: p.access_token, patch: p };
}

export type Offer = {
  offerId: string; sku?: string; marketplaceId?: string; status?: string;
  listing?: { listingId?: string; listingStatus?: string; soldQuantity?: number };
};

export function ebayApi(fetchFn: Fetch, env: Env, token: string) {
  const base = HOSTS[env].api;
  const call = (method: string, path: string, body?: unknown) =>
    send(fetchFn, `${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json",
        "Content-Language": "de-DE", "Accept-Language": "de-DE",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const enc = encodeURIComponent;
  const mp = `marketplace_id=${MARKETPLACE}`;
  return {
    optedInPrograms: async () => ((await call("GET", "/sell/account/v1/program/get_opted_in_programs"))?.programs ?? [])
      .map((p: any) => String(p.programType)),
    paymentPolicies: async () => ((await call("GET", `/sell/account/v1/payment_policy?${mp}`))?.paymentPolicies ?? [])
      .map((p: any) => ({ id: String(p.paymentPolicyId), name: String(p.name ?? "") })),
    fulfillmentPolicies: async () => ((await call("GET", `/sell/account/v1/fulfillment_policy?${mp}`))?.fulfillmentPolicies ?? [])
      .map((p: any) => ({ id: String(p.fulfillmentPolicyId), name: String(p.name ?? "") })),
    returnPolicies: async () => ((await call("GET", `/sell/account/v1/return_policy?${mp}`))?.returnPolicies ?? [])
      .map((p: any) => ({ id: String(p.returnPolicyId), name: String(p.name ?? "") })),
    locations: async () => ((await call("GET", "/sell/inventory/v1/location?limit=100"))?.locations ?? [])
      .filter((l: any) => l.merchantLocationStatus !== "DISABLED")
      .map((l: any) => ({ id: String(l.merchantLocationKey), name: String(l.name ?? l.merchantLocationKey) })),
    createLocation: (key: string, body: unknown) => call("POST", `/sell/inventory/v1/location/${enc(key)}`, body),
    putInventoryItem: (sku: string, body: unknown) => call("PUT", `/sell/inventory/v1/inventory_item/${enc(sku)}`, body),
    // Keine Offer zur SKU: eBay antwortet 404 -> leere Liste.
    getOffers: async (sku: string): Promise<Offer[]> => {
      try { return (await call("GET", `/sell/inventory/v1/offer?sku=${enc(sku)}&${mp}`))?.offers ?? []; }
      catch (e) { if (e instanceof EbayError && e.status === 404) return []; throw e; }
    },
    getOffer: async (offerId: string): Promise<Offer | null> => {
      try { return await call("GET", `/sell/inventory/v1/offer/${enc(offerId)}`); }
      catch (e) { if (e instanceof EbayError && e.status === 404) return null; throw e; }
    },
    createOffer: async (body: unknown) => String((await call("POST", "/sell/inventory/v1/offer", body)).offerId),
    updateOffer: (offerId: string, body: unknown) => call("PUT", `/sell/inventory/v1/offer/${enc(offerId)}`, body),
    publishOffer: async (offerId: string) => String((await call("POST", `/sell/inventory/v1/offer/${enc(offerId)}/publish`)).listingId),
    withdrawOffer: (offerId: string) => call("POST", `/sell/inventory/v1/offer/${enc(offerId)}/withdraw`),
  };
}
export type EbayApi = ReturnType<typeof ebayApi>;

// Taxonomy mit Anwendungs-Token (Befund eBay-Doku 9/10): Baum-ID für EBAY_DE, dann die Merkmale der Kategorie.
export async function categoryAspects(fetchFn: Fetch, env: Env, appTok: string, categoryId: string) {
  const h = { headers: { Authorization: `Bearer ${appTok}`, Accept: "application/json", "Accept-Language": "de-DE" } };
  const base = `${HOSTS[env].api}/commerce/taxonomy/v1`;
  const tree = await send(fetchFn, `${base}/get_default_category_tree_id?marketplace_id=${MARKETPLACE}`, h);
  const treeId = String(tree.categoryTreeId);
  const a = await send(fetchFn, `${base}/category_tree/${encodeURIComponent(treeId)}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`, h);
  return (a?.aspects ?? []) as AspectDef[];
}
```

- [ ] **Step 4: Tests grün**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/_shared/`
Expected: PASS, 20 Tests (13 aus Task 1 + 7).

- [ ] **Step 5: Schutz-Nachweise**

1. `toError`: `status >= 500` → `status > 503`. „Fehler: invalid_grant …“ scheitert (503 nicht vorübergehend; vom Plan-Autor ausgeführt). Zurücknehmen.
2. `ensureAccess`: `> 5 * 60 * 1000` → `> 0`. „Token erneuern nur, wenn weniger als 5 Minuten übrig“ scheitert (kein Erneuern bei 4 min). Zurücknehmen.
3. `ebayApi.call`: Kopf `"Content-Language": "de-DE"` entfernen. „API-Aufrufe …“ scheitert. Zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ebay-client.ts supabase/functions/_shared/ebay-client_test.ts supabase/functions/_shared/fake-fetch.ts
git commit -m "feat(h3b1): eBay-Client nur mit fetch (OAuth, Richtlinien, Inventar, Offers, Taxonomy)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Cloud-SQL `supabase/ebay_schema.sql` (nur Datei, nichts ausführen)

**Files:**
- Create: `supabase/ebay_schema.sql`

**Interfaces:**
- Produces: Tabellen `public.ebay_account` (24 Spalten, eine Zeile `id = 1`), `public.ebay_listings` (15), `public.listing_photos` (7), Ansicht `public.ebay_status` (19), Bucket `listing-photos`, Regeln `ebay_listings_authenticated_read`, `listing_photos_authenticated_all`, `storage.objects: listing_photos_objects_insert`, Funktionen `public.ebay_try_lock(p_holder text, p_seconds integer) returns boolean`, `public.ebay_unlock(p_holder text) returns void` (nur `service_role`). Spaltennamen = `ebay-store.ts` (Task 4) = `ebay-schema.cjs` (Task 6) = `EbayRepository.kt` (Task 8).

- [ ] **Step 1: Datei schreiben** (wörtlich)

```sql
-- supabase/ebay_schema.sql — Spec H3b1 §4.2/§5.1/§6/§8. Einmal im Dashboard einspielen (idempotent), BEVOR ebay-auth/ebay-sync
-- deployt werden und bevor der neue PC-/Handy-Build läuft. Setzt voraus: public.set_updated_at() (schema.sql),
-- public.listings/listing_items (listings_schema.sql), public.card_copies (card_copies_schema.sql).
-- Einzelnutzer-Modell wie listings: keine user_id. Tokens stehen NUR in ebay_account; dafür gibt es KEINE Regel für
-- authenticated/anon (nur die Dienstrolle der Funktionen liest/schreibt). Geräte lesen ebay_status (ohne Tokens).

-- 1. Konto (eine Zeile, id = 1)
create table if not exists public.ebay_account (
  id                      smallint primary key default 1 check (id = 1),
  environment             text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  marketplace             text not null default 'EBAY_DE',
  refresh_token           text,
  refresh_expires_at      timestamptz,
  access_token            text,
  access_expires_at       timestamptz,
  oauth_state             text,
  oauth_state_expires_at  timestamptz,
  payment_policy_id       text,
  payment_policy_name     text,
  fulfillment_policy_id   text,
  fulfillment_policy_name text,
  return_policy_id        text,
  return_policy_name      text,
  location_key            text,
  orders_cursor           text,
  sync_lock_holder        text,
  sync_lock_until         timestamptz,
  last_run_at             timestamptz,
  last_run_summary        text,
  last_error              text,
  connected_at            timestamptz,
  updated_at              timestamptz not null default now()
);
insert into public.ebay_account (id) values (1) on conflict (id) do nothing;

drop trigger if exists trg_ebay_account_updated_at on public.ebay_account;
create trigger trg_ebay_account_updated_at before insert or update on public.ebay_account
  for each row execute function public.set_updated_at();

alter table public.ebay_account enable row level security;
revoke all on public.ebay_account from anon, authenticated;

-- 2. Stand für die Geräte (ohne Tokens). Die Ansicht gehört postgres und liest ebay_account daher trotz RLS.
create or replace view public.ebay_status as
select a.environment,
       (a.refresh_token is not null and (a.refresh_expires_at is null or a.refresh_expires_at > now())) as connected,
       a.refresh_expires_at,
       a.payment_policy_id is not null     as has_payment_policy,
       a.fulfillment_policy_id is not null as has_fulfillment_policy,
       a.return_policy_id is not null      as has_return_policy,
       a.location_key is not null          as has_location,
       a.payment_policy_id, a.payment_policy_name,
       a.fulfillment_policy_id, a.fulfillment_policy_name,
       a.return_policy_id, a.return_policy_name,
       a.location_key,
       a.last_run_at, a.last_run_summary, a.last_error, a.connected_at, a.updated_at
  from public.ebay_account a
 where a.id = 1;
revoke all on public.ebay_status from anon;
grant select on public.ebay_status to authenticated;

-- 3. eBay-Stand je Angebot (nur die Funktion schreibt; Geräte lesen)
create table if not exists public.ebay_listings (
  listing_id    text primary key,
  environment   text not null check (environment in ('sandbox', 'production')),
  state         text not null check (state in ('wartet', 'online', 'fehler', 'beendet')),
  sku           text,
  offer_id      text,
  item_id       text,
  item_url      text,
  published_qty integer,
  synced_hash   text,
  failed_hash   text,
  sold_seen     integer,
  error         text,
  synced_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ebay_listings_updated_idx on public.ebay_listings (updated_at);
drop trigger if exists trg_ebay_listings_updated_at on public.ebay_listings;
create trigger trg_ebay_listings_updated_at before insert or update on public.ebay_listings
  for each row execute function public.set_updated_at();
alter table public.ebay_listings enable row level security;
drop policy if exists ebay_listings_authenticated_read on public.ebay_listings;
create policy ebay_listings_authenticated_read on public.ebay_listings for select to authenticated using (true);

-- 4. Eigene Fotos (Strom in beide Richtungen wie listings; weiches Löschen)
create table if not exists public.listing_photos (
  photo_id   text primary key,
  listing_id text not null,
  path       text not null,
  sort       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);
create index if not exists listing_photos_updated_idx on public.listing_photos (updated_at);
create index if not exists listing_photos_listing_idx on public.listing_photos (listing_id);
drop trigger if exists trg_listing_photos_updated_at on public.listing_photos;
create trigger trg_listing_photos_updated_at before insert or update on public.listing_photos
  for each row execute function public.set_updated_at();
alter table public.listing_photos enable row level security;
drop policy if exists listing_photos_authenticated_all on public.listing_photos;
create policy listing_photos_authenticated_all on public.listing_photos for all to authenticated using (true) with check (true);

-- 5. Speicher listing-photos: öffentlich lesbar (eBay lädt die Bilder selbst), hochladen nur angemeldet,
--    nur JPEG bis 2 MB (die Geräte verkleinern auf < 500 KB). Kein Löschen/Überschreiben (Dateinamen sind UUIDs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 2097152, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];
drop policy if exists listing_photos_objects_insert on storage.objects;
create policy listing_photos_objects_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'listing-photos');

-- 6. Nur ein ebay-sync gleichzeitig (Spec §8, Abweichung 2): Mietsperre in ebay_account statt pg_try_advisory_lock,
--    weil jeder PostgREST-Aufruf eine eigene Verbindung/Transaktion ist. Läuft nach p_seconds von selbst ab.
create or replace function public.ebay_try_lock(p_holder text, p_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.ebay_account
     set sync_lock_holder = p_holder, sync_lock_until = now() + make_interval(secs => p_seconds)
   where id = 1 and (sync_lock_until is null or sync_lock_until < now());
  return found;
end;
$$;
create or replace function public.ebay_unlock(p_holder text)
returns void language sql security definer set search_path = public as $$
  update public.ebay_account set sync_lock_holder = null, sync_lock_until = null where id = 1 and sync_lock_holder = p_holder;
$$;
revoke all on function public.ebay_try_lock(text, integer) from public, anon, authenticated;
revoke all on function public.ebay_unlock(text) from public, anon, authenticated;
grant execute on function public.ebay_try_lock(text, integer) to service_role;
grant execute on function public.ebay_unlock(text) to service_role;
```

- [ ] **Step 2: Selbstprüfung ohne Datenbank**

Spalten zählen (Kopf „SQL + Deploy“: 24/15/19/7), `create … if not exists`/`drop … if exists`/`on conflict` überall (idempotent), keine `grant` an `anon`, keine Regel auf `ebay_account`. `grep -n "authenticated" supabase/ebay_schema.sql` zeigt nur: `revoke … from anon, authenticated` (Konto), `grant select on public.ebay_status to authenticated`, die zwei Tabellen-Regeln, die Speicher-Regel und die `revoke`s der Sperr-Funktionen. **Nicht ausführen.**

- [ ] **Step 3: Commit**

```bash
git add supabase/ebay_schema.sql
git commit -m "feat(h3b1): Cloud-SQL fuer eBay-Konto, eBay-Stand, eigene Fotos und Abgleich-Sperre

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Danach legt der Controller dem Nutzer Schritt 1 aus „SQL + Deploy“ vor (einspielen + Prüfabfragen).

---

### Task 4: Edge Function `ebay-auth` (start, callback, check, select, create_location, set_environment, disconnect)

**Files:**
- Create: `supabase/functions/_shared/ebay-store.ts`, `supabase/functions/_shared/http.ts`, `supabase/functions/_shared/supabase-deps.ts`
- Create (nur Tests): `supabase/functions/_shared/fake-store.ts`, `supabase/functions/_shared/fake-ebay.ts`
- Create: `supabase/functions/ebay-auth/setup.ts`, `supabase/functions/ebay-auth/handler.ts`, `supabase/functions/ebay-auth/handler_test.ts`, `supabase/functions/ebay-auth/index.ts`

**Interfaces:**
- Consumes: Task 1 (`ebay-map.ts`, `ebay-plan.ts` Typen), Task 2 (`ebay-client.ts`), Task 3 (Tabellen/RPC-Namen).
- Produces (`ebay-store.ts`): `type Account` (Spalten von `ebay_account` ohne `id`, Sperre, `orders_cursor`, `updated_at`), `type SollData`, `interface Store { photoBase, account(), saveAccount(patch), tryLock(holder, s), unlock(holder), openRows(extraId), soll(ids), saveRow(row), liveOfferCount(env) }`, `supabaseStore(sb, url)`.
- Produces (`http.ts`): `json(body, status)`, `text(body, status)`, `safeEqual(a, b)`, `bearer(header)`. (`supabase-deps.ts`): `serviceDeps() -> { store, verifyUser(authorization), env(k) }`.
- Produces (`ebay-auth`): Aufruf `POST /functions/v1/ebay-auth` mit JSON `{ action, … }` und `Authorization: Bearer <Nutzer-JWT>`; Antworten:
  - `start` → `{ ok: true, url }` (Zustimmungs-URL; das Gerät öffnet sie)
  - `check` / `select { payment_policy_id?, fulfillment_policy_id?, return_policy_id?, location_key? }` / `create_location { postal_code, city }` → `{ ok: true, programOk, policyPage, payment|fulfillment|return|location: { options: [{ id, name }], selected } }`
  - `set_environment { environment }` / `disconnect` → `{ ok: true }`
  - erwartete Fehler → `{ ok: false, error: "<deutsch>" }` mit Status 200; ohne Anmeldung 401 `{ ok: false, error: "Nicht angemeldet." }`.
  - `GET /functions/v1/ebay-auth?action=callback&state=…&code=…` (oder ohne `action`, sobald `code` da ist) und `?action=declined` → `text/plain; charset=utf-8` `OK_PAGE` bzw. `failPage(…)`.
- Produces (nur Tests): `fake-store.ts#account(patch)`, `fakeStore(init) -> { store, state }`; `fake-ebay.ts#fakeEbay(opts) -> { fetchFn, calls, ebayCalls(), items, offers }`.

- [ ] **Step 1: Test-Helfer schreiben**

`supabase/functions/_shared/fake-store.ts`:

```ts
// supabase/functions/_shared/fake-store.ts -- NUR für Tests: Store im Speicher, Sperre wie ebay_try_lock.
import type { Photo, SollItem, SollListing } from "./ebay-map.ts";
import type { EbayRow } from "./ebay-plan.ts";
import type { Account, Store } from "./ebay-store.ts";

export function account(patch: Partial<Account> = {}): Account {
  return {
    environment: "sandbox", marketplace: "EBAY_DE", refresh_token: "RT", refresh_expires_at: "2028-01-01T00:00:00Z",
    access_token: "AT", access_expires_at: "2026-09-22T14:00:00Z", oauth_state: null, oauth_state_expires_at: null,
    payment_policy_id: "PAY1", payment_policy_name: "Zahlung", fulfillment_policy_id: "FUL1", fulfillment_policy_name: "Versand",
    return_policy_id: "RET1", return_policy_name: "Keine Rücknahme", location_key: "ygo-default",
    last_run_at: null, last_run_summary: null, last_error: null, connected_at: "2026-09-01T00:00:00Z", ...patch,
  };
}

export function fakeStore(init: {
  account?: Account; listings?: SollListing[]; items?: SollItem[]; live?: string[]; photos?: Photo[]; rows?: EbayRow[];
}) {
  const state = {
    account: init.account ?? account(),
    listings: init.listings ?? [], items: init.items ?? [], live: new Set(init.live ?? []), photos: init.photos ?? [],
    rows: new Map((init.rows ?? []).map((r) => [r.listing_id, r])),
    lockHolder: null as string | null, unlocked: 0,
  };
  const store: Store = {
    photoBase: "https://proj.supabase.co",
    account: () => Promise.resolve({ ...state.account }),
    saveAccount: (p) => { state.account = { ...state.account, ...p }; return Promise.resolve(); },
    tryLock: (h) => { if (state.lockHolder) return Promise.resolve(false); state.lockHolder = h; return Promise.resolve(true); },
    unlock: (h) => { if (state.lockHolder === h) state.lockHolder = null; state.unlocked++; return Promise.resolve(); },
    openRows: (extra) => Promise.resolve([...state.rows.values()].filter((r) => r.state !== "beendet" || r.listing_id === extra)),
    soll: (ids) => Promise.resolve({
      listings: state.listings.filter((l) => (l.channel_id === "ebay" && l.status === "aktiv" && !l.deleted) || ids.includes(l.listing_id)),
      items: state.items.filter((i) => !i.deleted), liveCopyIds: state.live, photos: state.photos.filter((p) => !p.deleted),
    }),
    saveRow: (r) => { state.rows.set(r.listing_id, { ...r }); return Promise.resolve(); },
    liveOfferCount: (env) => Promise.resolve([...state.rows.values()]
      .filter((r) => r.environment === env && (r.state === "online" || r.state === "fehler") && r.offer_id).length),
  };
  return { store, state };
}
```

`supabase/functions/_shared/fake-ebay.ts` (nachgebautes eBay; zählt Offer- und Anzeigen-Nummern gemeinsam hoch: erste Offer `O1`, erste Anzeige `I2`):

```ts
// supabase/functions/_shared/fake-ebay.ts -- NUR für Tests: nachgebautes eBay (Token, Taxonomy, Inventory) im Speicher.
import type { AspectDef } from "./ebay-map.ts";

type FakeOffer = {
  offerId: string; sku: string; marketplaceId: string; status: "PUBLISHED" | "UNPUBLISHED"; body: any;
  listing?: { listingId: string; listingStatus: string; soldQuantity: number };
};
export type FakeEbayOpts = {
  aspects?: AspectDef[]; rejectPublish?: Record<string, string>; down?: boolean; publishDown?: boolean;
  refreshInvalid?: boolean; codeInvalid?: boolean;
  programs?: string[]; payment?: { id: string; name: string }[]; fulfillment?: { id: string; name: string }[];
  returns?: { id: string; name: string }[]; locations?: { key: string; name: string }[];
};

export function fakeEbay(opts: FakeEbayOpts = {}) {
  const items = new Map<string, any>();
  const offers = new Map<string, FakeOffer>();
  const calls: { method: string; url: string; body: string | null; auth: string | null }[] = [];
  let n = 0;
  const reply = (status: number, body?: unknown) =>
    Promise.resolve(new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status }));
  const fetchFn = (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? init.body : null;
    calls.push({ method, url, body, auth: new Headers(init.headers).get("authorization") });
    if (opts.down) return reply(503, { errors: [{ message: "Service Unavailable" }] });
    const u = new URL(url);
    const p = u.pathname;
    if (p === "/identity/v1/oauth2/token") {
      const f = new URLSearchParams(body ?? "");
      if (f.get("grant_type") === "client_credentials") return reply(200, { access_token: "APP", expires_in: 7200 });
      if (f.get("grant_type") === "authorization_code") {
        return opts.codeInvalid ? reply(400, { error: "invalid_grant", error_description: "code expired" })
          : reply(200, { access_token: "AT", expires_in: 7200, refresh_token: "RT", refresh_token_expires_in: 47304000 });
      }
      if (opts.refreshInvalid) return reply(400, { error: "invalid_grant", error_description: "refresh token is invalid" });
      return reply(200, { access_token: "AT2", expires_in: 7200 });
    }
    if (p === "/commerce/taxonomy/v1/get_default_category_tree_id") return reply(200, { categoryTreeId: "77" });
    if (p === "/commerce/taxonomy/v1/category_tree/77/get_item_aspects_for_category") return reply(200, { aspects: opts.aspects ?? [] });
    const pol = (list: { id: string; name: string }[] | undefined, def: string, key: string) =>
      (list ?? [{ id: def, name: `Richtlinie ${def}` }]).map((x) => ({ [key]: x.id, name: x.name }));
    if (p === "/sell/account/v1/program/get_opted_in_programs") {
      return reply(200, { programs: (opts.programs ?? ["SELLING_POLICY_MANAGEMENT"]).map((programType) => ({ programType })) });
    }
    if (p === "/sell/account/v1/payment_policy") return reply(200, { paymentPolicies: pol(opts.payment, "PAY1", "paymentPolicyId") });
    if (p === "/sell/account/v1/fulfillment_policy") return reply(200, { fulfillmentPolicies: pol(opts.fulfillment, "FUL1", "fulfillmentPolicyId") });
    if (p === "/sell/account/v1/return_policy") return reply(200, { returnPolicies: pol(opts.returns, "RET1", "returnPolicyId") });
    if (p === "/sell/inventory/v1/location" && method === "GET") {
      return reply(200, { locations: (opts.locations ?? []).map((l) => ({ merchantLocationKey: l.key, name: l.name, merchantLocationStatus: "ENABLED" })) });
    }
    const loc = p.match(/^\/sell\/inventory\/v1\/location\/(.+)$/);
    if (loc && method === "POST") {
      opts.locations = [...(opts.locations ?? []), { key: decodeURIComponent(loc[1]), name: JSON.parse(body!).name }];
      return reply(204);
    }
    let m = p.match(/^\/sell\/inventory\/v1\/inventory_item\/(.+)$/);
    if (m && method === "PUT") { items.set(decodeURIComponent(m[1]), JSON.parse(body!)); return reply(204); }
    if (p === "/sell/inventory/v1/offer" && method === "GET") {
      const list = [...offers.values()].filter((o) => o.sku === u.searchParams.get("sku"));
      return list.length ? reply(200, { offers: list.map(view) }) : reply(404, { errors: [{ errorId: 25713, message: "not found" }] });
    }
    if (p === "/sell/inventory/v1/offer" && method === "POST") {
      const b = JSON.parse(body!);
      const offerId = `O${++n}`;
      offers.set(offerId, { offerId, sku: b.sku, marketplaceId: b.marketplaceId, status: "UNPUBLISHED", body: b });
      return reply(201, { offerId });
    }
    m = p.match(/^\/sell\/inventory\/v1\/offer\/([^/]+)(\/publish|\/withdraw)?$/);
    if (m) {
      const o = offers.get(m[1]);
      if (!o) return reply(404, { errors: [{ errorId: 25713, message: "offer not found" }] });
      if (!m[2] && method === "GET") return reply(200, view(o));
      if (!m[2] && method === "PUT") { o.body = JSON.parse(body!); return reply(204); }
      if (m[2] === "/publish") {
        if (opts.publishDown) return reply(503, { errors: [{ message: "Service Unavailable" }] });
        const why = opts.rejectPublish?.[o.sku];
        if (why) return reply(400, { errors: [{ errorId: 25002, longMessage: why }] });
        o.status = "PUBLISHED";
        o.listing = { listingId: `I${++n}`, listingStatus: "ACTIVE", soldQuantity: 0 };
        return reply(200, { listingId: o.listing.listingId });
      }
      if (m[2] === "/withdraw") { o.status = "UNPUBLISHED"; delete o.listing; return reply(200, { offerId: o.offerId }); }
    }
    return reply(599, { errors: [{ message: `keine Route ${method} ${url}` }] });
  };
  const view = (o: FakeOffer) => ({ offerId: o.offerId, sku: o.sku, marketplaceId: o.marketplaceId, status: o.status, listing: o.listing });
  const ebayCalls = () => calls.filter((c) => c.url.includes("/sell/"));
  return { fetchFn, calls, ebayCalls, items, offers };
}
```

- [ ] **Step 2: Failing Test schreiben**

`supabase/functions/ebay-auth/handler_test.ts`:

```ts
// Spec H3b §4.3/§9 -- ebay-auth mit nachgebautem eBay und Speicher-Store (kein Netz, keine Datenbank).
import { assertEquals } from "jsr:@std/assert@1";
import { failPage, handleAuth, OK_PAGE } from "./handler.ts";
import { pick, resolveSetup } from "./setup.ts";
import { fakeEbay, type FakeEbayOpts } from "../_shared/fake-ebay.ts";
import { account } from "../_shared/fake-store.ts";
import type { Account } from "../_shared/ebay-store.ts";

const NOW = new Date("2026-09-22T12:00:00Z");
const ENV: Record<string, string> = { EBAY_SANDBOX_CLIENT_ID: "id", EBAY_SANDBOX_CLIENT_SECRET: "sec", EBAY_SANDBOX_RUNAME: "ru" };
const FN = "https://proj.supabase.co/functions/v1/ebay-auth";

function setup(acc: Partial<Account> = {}, ebay: FakeEbayOpts = {}, user = true, liveOffers = 0) {
  const st = { account: account(acc) };
  const eb = fakeEbay(ebay);
  const d = {
    store: {
      account: () => Promise.resolve({ ...st.account }),
      saveAccount: (p: Partial<Account>) => { st.account = { ...st.account, ...p }; return Promise.resolve(); },
      liveOfferCount: (env: string) => Promise.resolve(env === st.account.environment ? liveOffers : 0),
    },
    fetch: eb.fetchFn, env: (k: string) => ENV[k], now: () => NOW,
    verifyUser: (h: string | null) => Promise.resolve(user && h === "Bearer JWT"), randomState: () => "state-123",
  };
  const post = (body: unknown) => handleAuth(new Request(FN, { method: "POST", headers: { Authorization: "Bearer JWT" }, body: JSON.stringify(body) }), d);
  const get = (q: string) => handleAuth(new Request(`${FN}?${q}`), d);
  return { st, eb, post, get };
}

Deno.test("ohne Anmeldung: 401, kein Zugriff", async () => {
  const w = setup({}, {}, false);
  const r = await w.post({ action: "start" });
  assertEquals([r.status, (await r.json()).error], [401, "Nicht angemeldet."]);
  assertEquals(w.eb.calls.length, 0);
});

Deno.test("start: state 10 Minuten gültig, Zustimmungs-URL der gespeicherten Umgebung", async () => {
  const w = setup({ refresh_token: null });
  const b = await (await w.post({ action: "start" })).json();
  assertEquals(b.ok, true);
  assertEquals(b.url.startsWith("https://auth.sandbox.ebay.com/oauth2/authorize?client_id=id&redirect_uri=ru&response_type=code&scope="), true);
  assertEquals(b.url.endsWith("&state=state-123"), true);
  assertEquals([w.st.account.oauth_state, w.st.account.oauth_state_expires_at], ["state-123", "2026-09-22T12:10:00.000Z"]);
});

Deno.test("Rücksprung: gültiger state -> Tokens gespeichert, state geleert, Einzel-Richtlinien gewählt, Textseite", async () => {
  const w = setup({ refresh_token: null, access_token: null, oauth_state: "state-123", oauth_state_expires_at: "2026-09-22T12:05:00Z",
    payment_policy_id: null, fulfillment_policy_id: null, return_policy_id: null, location_key: null },
    { locations: [{ key: "ygo-default", name: "Lager" }] });
  const r = await w.get("action=callback&state=state-123&code=abc&expires_in=299");
  assertEquals([r.status, r.headers.get("content-type"), await r.text()], [200, "text/plain; charset=utf-8", OK_PAGE]);
  const a = w.st.account;
  assertEquals([a.refresh_token, a.access_token, a.oauth_state, a.connected_at], ["RT", "AT", null, "2026-09-22T12:00:00.000Z"]);
  assertEquals([a.payment_policy_id, a.payment_policy_name, a.fulfillment_policy_id, a.return_policy_id, a.location_key],
    ["PAY1", "Richtlinie PAY1", "FUL1", "RET1", "ygo-default"]);
});

Deno.test("Rücksprung: falscher/abgelaufener state -> kein Tausch; abgelehnt -> Hinweis; state nur einmal", async () => {
  const bad = setup({ oauth_state: "state-123", oauth_state_expires_at: "2026-09-22T12:05:00Z" });
  assertEquals(await (await bad.get("action=callback&state=falsch&code=abc")).text(),
    failPage("Anmeldelink abgelaufen oder ungültig – bitte in der App neu verbinden."));
  const old = setup({ oauth_state: "state-123", oauth_state_expires_at: "2026-09-22T11:59:00Z" });
  assertEquals((await old.get("action=callback&state=state-123&code=abc")).status, 400);
  assertEquals([bad.eb.calls.length, old.eb.calls.length], [0, 0]);
  const dec = setup();
  assertEquals(await (await dec.get("action=declined")).text(), failPage("bei eBay abgelehnt."));
  const once = setup({ oauth_state: "state-123", oauth_state_expires_at: "2026-09-22T12:05:00Z" }, { codeInvalid: true });
  assertEquals(await (await once.get("state=state-123&code=abc")).text(), failPage("code expired"));
  assertEquals((await once.get("state=state-123&code=abc")).status, 400, "zweiter Versuch mit demselben state scheitert");
  assertEquals(once.eb.calls.length, 1);
});

Deno.test("check: mehrere Zahlungsrichtlinien -> keine Auswahl; select speichert ID und Namen; unbekannt -> Fehler", async () => {
  const w = setup({ payment_policy_id: null, location_key: null },
    { payment: [{ id: "P1", name: "PayPal" }, { id: "P2", name: "Überweisung" }], programs: [] });
  const c = await (await w.post({ action: "check" })).json();
  assertEquals([c.ok, c.programOk, c.payment.selected, c.payment.options.length, c.location.selected], [true, false, null, 2, null]);
  assertEquals(c.policyPage, "https://www.bizpolicy.sandbox.ebay.de/businesspolicy/manage");
  const s = await (await w.post({ action: "select", payment_policy_id: "P2" })).json();
  assertEquals([s.payment.selected, w.st.account.payment_policy_id, w.st.account.payment_policy_name], ["P2", "P2", "Überweisung"]);
  const x = await (await w.post({ action: "select", payment_policy_id: "P9" })).json();
  assertEquals(x, { ok: false, error: "Auswahl gibt es bei eBay nicht mehr – bitte neu prüfen." });
});

Deno.test("create_location: PLZ geprüft, Standort angelegt und gewählt", async () => {
  const w = setup({ location_key: null });
  assertEquals(await (await w.post({ action: "create_location", postal_code: "123", city: "Wien" })).json(),
    { ok: false, error: "Bitte eine fünfstellige Postleitzahl angeben." });
  const r = await (await w.post({ action: "create_location", postal_code: "80331", city: "München" })).json();
  assertEquals([r.ok, r.location.selected, w.st.account.location_key], [true, "ygo-default", "ygo-default"]);
  const call = w.eb.calls.find((c) => c.method === "POST" && c.url.endsWith("/sell/inventory/v1/location/ygo-default"))!;
  assertEquals(JSON.parse(call.body!).location.address, { postalCode: "80331", city: "München", country: "DE" });
});

Deno.test("set_environment verweigert, solange Anzeigen der alten Umgebung online sind", async () => {
  const w = setup({}, {}, true, 2);
  assertEquals(await (await w.post({ action: "set_environment", environment: "production" })).json(),
    { ok: false, error: "Zuerst die 2 eBay-Anzeigen in der Sandbox beenden – sonst bleiben sie dort online." });
  assertEquals([w.st.account.environment, w.st.account.refresh_token], ["sandbox", "RT"]);
});

Deno.test("set_environment trennt und leert die Einrichtung; disconnect löscht nur Tokens", async () => {
  const w = setup();
  assertEquals(await (await w.post({ action: "set_environment", environment: "production" })).json(), { ok: true });
  const a = w.st.account;
  assertEquals([a.environment, a.refresh_token, a.access_token, a.payment_policy_id, a.location_key], ["production", null, null, null, null]);
  const d = setup();
  await d.post({ action: "disconnect" });
  assertEquals([d.st.account.refresh_token, d.st.account.payment_policy_id], [null, "PAY1"]);
  assertEquals(await (await d.post({ action: "check" })).json(), { ok: false, error: "Nicht mit eBay verbunden." });
});

Deno.test("Einrichtung rein: bisherige Wahl bleibt, genau eine -> automatisch", () => {
  const o = [{ id: "A", name: "a" }, { id: "B", name: "b" }];
  assertEquals([pick(o, "B", undefined)?.id, pick(o, "X", undefined), pick([o[0]], null, undefined)?.id], ["B", null, "A"]);
  const r = resolveSetup({ payment: o, fulfillment: [o[0]], return: [], location: [] }, { payment: null, fulfillment: null, return: "R", location: null });
  assertEquals(r.patch, { payment_policy_id: null, payment_policy_name: null, fulfillment_policy_id: "A", fulfillment_policy_name: "a",
    return_policy_id: null, return_policy_name: null, location_key: null });
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/ebay-auth/`
Expected: FAIL — `Module not found … ebay-auth/handler.ts` (bzw. `_shared/ebay-store.ts`).

- [ ] **Step 4: Gemeinsame Module schreiben**

`supabase/functions/_shared/ebay-store.ts`:

```ts
// supabase/functions/_shared/ebay-store.ts
// Spec H3b §4.2/§5.1/§8 -- Datenbankzugriff der eBay-Funktionen hinter einer schmalen Schnittstelle (Tests: fake-store.ts).
// Die echte Fassung nutzt die Dienstrolle (SUPABASE_SERVICE_ROLE_KEY): nur sie liest/schreibt ebay_account/ebay_listings.
// PostgREST kappt Antworten bei 1000 Zeilen -> jede wachsende Abfrage blättert über eine stabile Ordnung.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Photo, SollItem, SollListing } from "./ebay-map.ts";
import type { EbayRow } from "./ebay-plan.ts";

export type Account = {
  environment: string; marketplace: string;
  refresh_token: string | null; refresh_expires_at: string | null; access_token: string | null; access_expires_at: string | null;
  oauth_state: string | null; oauth_state_expires_at: string | null;
  payment_policy_id: string | null; payment_policy_name: string | null;
  fulfillment_policy_id: string | null; fulfillment_policy_name: string | null;
  return_policy_id: string | null; return_policy_name: string | null;
  location_key: string | null; last_run_at: string | null; last_run_summary: string | null; last_error: string | null;
  connected_at: string | null;
};
export type SollData = { listings: SollListing[]; items: SollItem[]; liveCopyIds: Set<string>; photos: Photo[] };

export interface Store {
  photoBase: string;
  account(): Promise<Account>;
  saveAccount(patch: Partial<Account>): Promise<void>;
  tryLock(holder: string, seconds: number): Promise<boolean>;
  unlock(holder: string): Promise<void>;
  // ebay_listings mit state <> 'beendet', dazu die Zeile extraId (Erneut versuchen), falls vorhanden.
  openRows(extraId: string | null): Promise<EbayRow[]>;
  // Aktive eBay-Angebote und zusätzlich die Angebote ids (auch beendete/gelöschte), mit Positionen, lebenden Exemplaren, Fotos.
  soll(ids: string[]): Promise<SollData>;
  saveRow(row: EbayRow): Promise<void>;
  liveOfferCount(env: string): Promise<number>;
}

const PAGE = 1000;
const CHUNK = 100;
const LISTING_COLS = "listing_id,channel_id,title,description,price,status,deleted";
const ITEM_COLS = "listing_id,copy_id,card_id,name,set_code,language,rarity,edition,condition,image_url,deleted";
const ROW_COLS = "listing_id,environment,state,sku,offer_id,item_id,item_url,published_qty,synced_hash,failed_hash,sold_seen,error,synced_at";

function chunks<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}
function fail(what: string, e: { message: string } | null): never {
  throw new Error(`${what}: ${e?.message ?? "unbekannt"}`);
}

export function supabaseStore(sb: SupabaseClient, supabaseUrl: string): Store {
  // Alle Seiten einer Abfrage; build(from, to) liefert die Abfrage mit .range(from, to) und fester Ordnung.
  async function all<T>(what: string, build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error) fail(what, error);
      out.push(...(data ?? []));
      if (!data || data.length < PAGE) return out;
    }
  }
  return {
    photoBase: supabaseUrl,
    async account() {
      const { data, error } = await sb.from("ebay_account").select("*").eq("id", 1).single();
      if (error) fail("ebay_account", error);
      return data as Account;
    },
    async saveAccount(patch) {
      const { error } = await sb.from("ebay_account").update(patch).eq("id", 1);
      if (error) fail("ebay_account speichern", error);
    },
    async tryLock(holder, seconds) {
      const { data, error } = await sb.rpc("ebay_try_lock", { p_holder: holder, p_seconds: seconds });
      if (error) fail("ebay_try_lock", error);
      return data === true;
    },
    async unlock(holder) {
      const { error } = await sb.rpc("ebay_unlock", { p_holder: holder });
      if (error) console.error("[ebay] unlock:", error.message);
    },
    async openRows(extraId) {
      const rows = await all<EbayRow>("ebay_listings", (f, t) =>
        sb.from("ebay_listings").select(ROW_COLS).neq("state", "beendet").order("listing_id").range(f, t));
      if (extraId && !rows.some((r) => r.listing_id === extraId)) {
        const { data, error } = await sb.from("ebay_listings").select(ROW_COLS).eq("listing_id", extraId).maybeSingle();
        if (error) fail("ebay_listings", error);
        if (data) rows.push(data as EbayRow);
      }
      return rows;
    },
    async soll(ids) {
      const listings = await all<SollListing>("listings", (f, t) =>
        sb.from("listings").select(LISTING_COLS).eq("channel_id", "ebay").eq("status", "aktiv").eq("deleted", false)
          .order("listing_id").range(f, t));
      const have = new Set(listings.map((l) => l.listing_id));
      for (const part of chunks(ids.filter((id) => !have.has(id)), CHUNK)) {
        const { data, error } = await sb.from("listings").select(LISTING_COLS).in("listing_id", part);
        if (error) fail("listings", error);
        listings.push(...((data ?? []) as SollListing[]));
      }
      const listingIds = listings.map((l) => l.listing_id);
      const items: SollItem[] = [];
      const photos: Photo[] = [];
      for (const part of chunks(listingIds, CHUNK)) {
        items.push(...await all<SollItem>("listing_items", (f, t) =>
          sb.from("listing_items").select(ITEM_COLS).in("listing_id", part).eq("deleted", false)
            .order("listing_id").order("copy_id").range(f, t)));
        photos.push(...await all<Photo>("listing_photos", (f, t) =>
          sb.from("listing_photos").select("photo_id,listing_id,path,sort,deleted").in("listing_id", part).eq("deleted", false)
            .order("photo_id").range(f, t)));
      }
      const liveCopyIds = new Set<string>();
      for (const part of chunks([...new Set(items.map((i) => i.copy_id))], CHUNK)) {
        const { data, error } = await sb.from("card_copies").select("copy_id").in("copy_id", part)
          .eq("deleted", false).is("sold_in", null);
        if (error) fail("card_copies", error);
        for (const r of data ?? []) liveCopyIds.add(String(r.copy_id));
      }
      return { listings, items, liveCopyIds, photos };
    },
    async liveOfferCount(env) {
      const { count, error } = await sb.from("ebay_listings").select("listing_id", { count: "exact", head: true })
        .eq("environment", env).in("state", ["online", "fehler"]).not("offer_id", "is", null);
      if (error) fail("ebay_listings zählen", error);
      return count ?? 0;
    },
    async saveRow(row) {
      const { error } = await sb.from("ebay_listings").upsert(row, { onConflict: "listing_id" });
      if (error) fail("ebay_listings speichern", error);
    },
  };
}
```

`supabase/functions/_shared/http.ts`:

```ts
// supabase/functions/_shared/http.ts -- Antworten und Prüfungen, die ebay-auth und ebay-sync teilen.
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
// Abweichung 1: Supabase schreibt text/html auf der Standard-Domain zu text/plain um -> die Rücksprung-Seite ist Text.
export function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
// Vergleich ohne frühen Abbruch (Geheimwert, OAuth-state).
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || a.length === 0) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return m ? m[1].trim() : null;
}
```

`supabase/functions/_shared/supabase-deps.ts`:

```ts
// supabase/functions/_shared/supabase-deps.ts -- echte Abhängigkeiten der eBay-Funktionen (nicht unit-getestet; deno check).
// SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY stellt Supabase selbst bereit.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bearer } from "./http.ts";
import { supabaseStore } from "./ebay-store.ts";

export function serviceDeps() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // JWT eines angemeldeten Nutzers prüfen (Einzelnutzer-Modell: jede gültige Anmeldung dieses Projekts).
  const verifyUser = async (authorization: string | null) => {
    const jwt = bearer(authorization);
    if (!jwt) return false;
    const { data, error } = await sb.auth.getUser(jwt);
    return !error && !!data?.user;
  };
  return { store: supabaseStore(sb, url), verifyUser, env: (k: string) => Deno.env.get(k) };
}
```

- [ ] **Step 5: `ebay-auth` schreiben**

`supabase/functions/ebay-auth/setup.ts`:

```ts
// supabase/functions/ebay-auth/setup.ts
// Spec H3b §4.3/§4.4 -- Einrichtungs-Check rein: je Art (Zahlung, Versand, Rücknahme, Standort) die Auswahl bestimmen.
// Genau eine Möglichkeit -> automatisch; die bisherige Wahl bleibt, solange es sie noch gibt; mehrere -> Auswahl am Gerät.

export type Option = { id: string; name: string };
export type Kind = "payment" | "fulfillment" | "return" | "location";
export const KINDS: Kind[] = ["payment", "fulfillment", "return", "location"];
export type Lists = Record<Kind, Option[]>;
export type Current = Record<Kind, string | null>;
export type Chosen = Partial<Record<Kind, string>>;

export class SetupError extends Error {}

export function pick(options: Option[], current: string | null, chosen: string | undefined): Option | null {
  if (chosen !== undefined) {
    const o = options.find((x) => x.id === chosen);
    if (!o) throw new SetupError("Auswahl gibt es bei eBay nicht mehr – bitte neu prüfen.");
    return o;
  }
  return options.find((x) => x.id === current) ?? (options.length === 1 ? options[0] : null);
}

export function resolveSetup(lists: Lists, current: Current, chosen: Chosen = {}) {
  const sel = {} as Record<Kind, Option | null>;
  for (const k of KINDS) sel[k] = pick(lists[k], current[k], chosen[k]);
  return {
    selected: sel,
    patch: {
      payment_policy_id: sel.payment?.id ?? null, payment_policy_name: sel.payment?.name ?? null,
      fulfillment_policy_id: sel.fulfillment?.id ?? null, fulfillment_policy_name: sel.fulfillment?.name ?? null,
      return_policy_id: sel.return?.id ?? null, return_policy_name: sel.return?.name ?? null,
      location_key: sel.location?.id ?? null,
    },
  };
}

// Seiten im Verkäuferkonto, wenn eine Art fehlt (Risiko: Adressen bei der Abnahme prüfen).
export const POLICY_PAGE: Record<string, string> = {
  production: "https://www.bizpolicy.ebay.de/businesspolicy/manage",
  sandbox: "https://www.bizpolicy.sandbox.ebay.de/businesspolicy/manage",
};

export const PLZ = /^[0-9]{5}$/;
export function locationBody(postalCode: string, city: string) {
  return {
    location: { address: { postalCode, city, country: "DE" } },
    name: "Yu-Gi-Oh Sammlung", merchantLocationStatus: "ENABLED", locationTypes: ["WAREHOUSE"],
  };
}
export function checkLocationInput(postalCode: unknown, city: unknown): string | null {
  if (typeof postalCode !== "string" || !PLZ.test(postalCode.trim())) return "Bitte eine fünfstellige Postleitzahl angeben.";
  if (typeof city !== "string" || city.trim() === "" || city.trim().length > 60) return "Bitte den Ort angeben.";
  return null;
}
```

`supabase/functions/ebay-auth/handler.ts`:

```ts
// supabase/functions/ebay-auth/handler.ts
// Spec H3b §4.3 -- Verbinden und Einrichten. Deploy mit --no-verify-jwt (der eBay-Rücksprung kommt ohne Anmeldung);
// alle anderen Aktionen prüfen das JWT hier selbst. Tokens nie protokollieren, nie an Geräte zurückgeben.
import {
  consentUrl, credsFor, type EbayApi, ebayApi, EbayError, ensureAccess, type Env, exchangeCode, type Fetch,
} from "../_shared/ebay-client.ts";
import type { Account } from "../_shared/ebay-store.ts";
import { json, safeEqual, text } from "../_shared/http.ts";
import { type Chosen, checkLocationInput, KINDS, type Lists, locationBody, POLICY_PAGE, resolveSetup, SetupError } from "./setup.ts";

export type AuthStore = {
  account(): Promise<Account>; saveAccount(p: Partial<Account>): Promise<void>;
  // Anzeigen mit Offer, die in dieser Umgebung noch nicht beendet sind (online oder fehler).
  liveOfferCount(env: string): Promise<number>;
};
export type AuthDeps = {
  store: AuthStore; fetch: Fetch; env: (k: string) => string | undefined; now: () => Date;
  verifyUser: (authorization: string | null) => Promise<boolean>; randomState: () => string;
};

export const STATE_MINUTES = 10;
export const LOCATION_KEY = "ygo-default";
export const OK_PAGE = "Verbunden – du kannst das Fenster schließen.";
export const failPage = (why: string) => `Verbindung fehlgeschlagen: ${why}`;
const TOKENS_NULL = { refresh_token: null, refresh_expires_at: null, access_token: null, access_expires_at: null, connected_at: null };
const SETUP_NULL = {
  payment_policy_id: null, payment_policy_name: null, fulfillment_policy_id: null, fulfillment_policy_name: null,
  return_policy_id: null, return_policy_name: null, location_key: null,
};

async function userApi(d: AuthDeps, acc: Account): Promise<EbayApi> {
  if (!acc.refresh_token) throw new SetupError("Nicht mit eBay verbunden.");
  const env = acc.environment as Env;
  const t = await ensureAccess(d.fetch, env, credsFor(env, d.env), acc, d.now());
  if (t.patch) await d.store.saveAccount(t.patch);
  return ebayApi(d.fetch, env, t.token);
}

// Einrichtungs-Check (Spec §4.3 check/select): Listen lesen, Auswahl bestimmen, IDs + Namen speichern.
async function runCheck(d: AuthDeps, chosen: Chosen = {}) {
  const acc = await d.store.account();
  const api = await userApi(d, acc);
  const programs = await api.optedInPrograms();
  const lists: Lists = {
    payment: await api.paymentPolicies(), fulfillment: await api.fulfillmentPolicies(),
    return: await api.returnPolicies(), location: await api.locations(),
  };
  const r = resolveSetup(lists, {
    payment: acc.payment_policy_id, fulfillment: acc.fulfillment_policy_id, return: acc.return_policy_id, location: acc.location_key,
  }, chosen);
  await d.store.saveAccount(r.patch);
  const out: Record<string, unknown> = {
    ok: true, programOk: programs.includes("SELLING_POLICY_MANAGEMENT"), policyPage: POLICY_PAGE[acc.environment] ?? null,
  };
  for (const k of KINDS) out[k] = { options: lists[k], selected: r.selected[k]?.id ?? null };
  return out;
}

async function callback(url: URL, d: AuthDeps): Promise<Response> {
  if (url.searchParams.get("action") === "declined") return text(failPage("bei eBay abgelehnt."));
  const acc = await d.store.account();
  const state = url.searchParams.get("state");
  const valid = safeEqual(state, acc.oauth_state) && !!acc.oauth_state_expires_at &&
    Date.parse(acc.oauth_state_expires_at) > d.now().getTime();
  if (!valid) return text(failPage("Anmeldelink abgelaufen oder ungültig – bitte in der App neu verbinden."), 400);
  // Einmalig: state sofort leeren, auch wenn der Tausch danach scheitert.
  await d.store.saveAccount({ oauth_state: null, oauth_state_expires_at: null });
  const code = url.searchParams.get("code");
  if (!code) return text(failPage("eBay hat keinen Code geliefert."), 400);
  try {
    const env = acc.environment as Env;
    const t = await exchangeCode(d.fetch, env, credsFor(env, d.env), code, d.now());
    await d.store.saveAccount({ ...t, connected_at: d.now().toISOString(), last_error: null });
  } catch (e) {
    return text(failPage((e as Error).message), 400);
  }
  // Genau eine Richtlinie je Art -> gleich wählen (Spec §4.3); ein Fehler hier ändert nichts an der Verbindung.
  try { await runCheck(d); } catch (e) { console.error("[ebay-auth] Check nach dem Verbinden:", (e as Error).message); }
  return text(OK_PAGE);
}

export async function handleAuth(req: Request, d: AuthDeps): Promise<Response> {
  const url = new URL(req.url);
  const qa = url.searchParams.get("action");
  if (req.method === "GET" && (qa === "callback" || qa === "declined" || (qa == null && url.searchParams.has("code")))) {
    return await callback(url, d);
  }
  if (req.method !== "POST") return json({ ok: false, error: "Nur POST." }, 405);
  if (!(await d.verifyUser(req.headers.get("authorization")))) return json({ ok: false, error: "Nicht angemeldet." }, 401);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? qa ?? "");
  try {
    switch (action) {
      case "start": {
        const acc = await d.store.account();
        const env = acc.environment as Env;
        const creds = credsFor(env, d.env);
        const state = d.randomState();
        await d.store.saveAccount({
          oauth_state: state, oauth_state_expires_at: new Date(d.now().getTime() + STATE_MINUTES * 60000).toISOString(),
        });
        return json({ ok: true, url: consentUrl(env, creds, state) });
      }
      case "check":
        return json(await runCheck(d));
      case "select": {
        const chosen: Chosen = {};
        for (const [k, f] of [["payment", "payment_policy_id"], ["fulfillment", "fulfillment_policy_id"], ["return", "return_policy_id"], ["location", "location_key"]] as const) {
          if (typeof body[f] === "string") chosen[k] = body[f] as string;
        }
        return json(await runCheck(d, chosen));
      }
      case "create_location": {
        const bad = checkLocationInput(body.postal_code, body.city);
        if (bad) return json({ ok: false, error: bad });
        const api = await userApi(d, await d.store.account());
        try { await api.createLocation(LOCATION_KEY, locationBody(String(body.postal_code).trim(), String(body.city).trim())); }
        catch (e) { if (!(e instanceof EbayError && e.status === 409)) throw e; } // gibt es schon -> weiter
        return json(await runCheck(d, { location: LOCATION_KEY }));
      }
      case "set_environment": {
        const env = body.environment;
        if (env !== "sandbox" && env !== "production") return json({ ok: false, error: "Unbekannte Umgebung." });
        const acc = await d.store.account();
        if (env === acc.environment) return json({ ok: true });
        // Abweichung 7: ein Wechsel ließe die Anzeigen der alten Umgebung für immer online (niemand zieht sie zurück).
        const n = await d.store.liveOfferCount(acc.environment);
        if (n > 0) {
          const where = acc.environment === "production" ? "der Produktion" : "der Sandbox";
          return json({ ok: false, error: `Zuerst die ${n} eBay-Anzeige${n === 1 ? "" : "n"} in ${where} beenden – sonst bleiben sie dort online.` });
        }
        await d.store.saveAccount({ environment: env, ...TOKENS_NULL, ...SETUP_NULL, oauth_state: null, oauth_state_expires_at: null, last_error: null });
        return json({ ok: true });
      }
      case "disconnect":
        await d.store.saveAccount({ ...TOKENS_NULL });
        return json({ ok: true });
      default:
        return json({ ok: false, error: "Unbekannte Aktion." }, 400);
    }
  } catch (e) {
    if (e instanceof SetupError) return json({ ok: false, error: e.message });
    if (e instanceof EbayError) return json({ ok: false, error: e.auth ? "Verbindung abgelaufen – bitte neu verbinden" : e.message });
    console.error("[ebay-auth]", action, (e as Error).message);
    return json({ ok: false, error: "Interner Fehler." }, 500);
  }
}
```

`supabase/functions/ebay-auth/index.ts`:

```ts
// supabase/functions/ebay-auth/index.ts
// Spec H3b §4.3 -- Verbinden/Einrichten. Deploy (macht der Nutzer, nie ein Agent):
//   supabase functions deploy ebay-auth --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
// --no-verify-jwt, weil eBays Rücksprung ohne Anmeldung kommt; alle anderen Aktionen prüfen das JWT in handler.ts.
import { serviceDeps } from "../_shared/supabase-deps.ts";
import { handleAuth } from "./handler.ts";

const randomState = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve((req) => {
  const s = serviceDeps();
  return handleAuth(req, { store: s.store, fetch, env: s.env, now: () => new Date(), verifyUser: s.verifyUser, randomState });
});
```

- [ ] **Step 6: Tests grün, Typprüfung**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/_shared/ supabase/functions/ebay-auth/`
Expected: PASS, 29 Tests (20 + 9).
Run: `deno check --node-modules-dir=none supabase/functions/ebay-auth/index.ts`
Expected: `Check …/ebay-auth/index.ts`, kein Fehler. **Niemals deployen oder aufrufen.**

- [ ] **Step 7: Schutz-Nachweise**

1. `callback`: `safeEqual(state, acc.oauth_state) &&` entfernen. „Rücksprung: falscher/abgelaufener state …“ scheitert (Tausch mit fremdem state). Zurücknehmen.
2. `callback`: die Zeile `await d.store.saveAccount({ oauth_state: null, oauth_state_expires_at: null });` entfernen. „Rücksprung: … state nur einmal“ scheitert (zweiter Tausch, `calls.length` 2; vom Plan-Autor ausgeführt). Zurücknehmen.
3. `handleAuth`: die `verifyUser`-Prüfung auskommentieren. „ohne Anmeldung: 401“ scheitert. Zurücknehmen.
4. `set_environment`: den `liveOfferCount`-Block entfernen. „set_environment verweigert, solange …“ scheitert. Zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/ebay-store.ts supabase/functions/_shared/http.ts supabase/functions/_shared/supabase-deps.ts supabase/functions/_shared/fake-store.ts supabase/functions/_shared/fake-ebay.ts supabase/functions/ebay-auth/setup.ts supabase/functions/ebay-auth/handler.ts supabase/functions/ebay-auth/handler_test.ts supabase/functions/ebay-auth/index.ts
git commit -m "feat(h3b1): Edge Function ebay-auth (Verbinden, Ruecksprung, Einrichtungs-Check, Standort, Umgebung)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Edge Function `ebay-sync` — Schritte 1/4/5, Sperre, Einzelfehler, höchstens 50

**Files:**
- Create: `supabase/functions/ebay-sync/sync.ts`, `supabase/functions/ebay-sync/sync_test.ts`, `supabase/functions/ebay-sync/handler.ts`, `supabase/functions/ebay-sync/handler_test.ts`, `supabase/functions/ebay-sync/index.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4 (`Store`, `fakeStore`, `fakeEbay`, `serviceDeps`, `json`, `safeEqual`).
- Produces: `runSync(deps, { retry?, max? }) -> SyncResult` mit `SyncResult = { ok: true, busy: true, text: "läuft schon" } | { ok: true, busy: false, summary, text } | { ok: false, error }`; `LOCK_SECONDS = 300`, `MAX_PER_RUN = 50`; `handleSync(req, { cronSecret, verifyUser, run })`. Aufruf `POST /functions/v1/ebay-sync` mit `x-ebay-secret` (Zeitplan) oder `Authorization: Bearer <JWT>` und optional `{ "retry": "<listing_id>" }`.
- Zeilen in `ebay_listings` nach dem Lauf: `online` mit `sku = L-<id>`, `offer_id`, `item_id`, `item_url`, `published_qty`, `synced_hash`, `sold_seen`; `fehler` mit `error`, `failed_hash`; `wartet`; `beendet`.

- [ ] **Step 1: Failing Tests schreiben**

`supabase/functions/ebay-sync/sync_test.ts` (nachgebautes eBay + Speicher-Store; deckt Spec §10 ab: einstellen, ändern, Menge senken, zurückziehen, manuell beendet, Token abgelaufen, Einzelfehler, zweiter paralleler Lauf, dazu Pflichtmerkmal, eBay-Verkauf, Abbruch bei Überlastung, Umgebung, Obergrenze):

```ts
// Spec H3b §8/§9/§10 -- Abgleicher mit nachgebautem eBay und Speicher-Store (kein Netz, keine Datenbank).
import { assertEquals } from "jsr:@std/assert@1";
import { runSync } from "./sync.ts";
import { fakeEbay, type FakeEbayOpts } from "../_shared/fake-ebay.ts";
import { account, fakeStore } from "../_shared/fake-store.ts";
import type { AspectDef, SollItem, SollListing } from "../_shared/ebay-map.ts";
import { ENDED_ON_EBAY, EXPIRED, SOLD_ON_EBAY } from "../_shared/ebay-plan.ts";

const NOW = new Date("2026-09-22T12:00:00Z");
const ENV: Record<string, string> = { EBAY_SANDBOX_CLIENT_ID: "id", EBAY_SANDBOX_CLIENT_SECRET: "sec", EBAY_SANDBOX_RUNAME: "ru" };
const ASPECTS: AspectDef[] = [
  { localizedAspectName: "Spiel", aspectConstraint: { aspectRequired: true, aspectMode: "SELECTION_ONLY" }, aspectValues: [{ localizedValue: "Yu-Gi-Oh! TCG" }] },
  { localizedAspectName: "Kartenname", aspectConstraint: { aspectRequired: true, aspectMode: "FREE_TEXT" } },
];
const L = (id: string, patch: Partial<SollListing> = {}): SollListing =>
  ({ listing_id: id, channel_id: "ebay", title: `Titel ${id}`, description: "Text", price: "10.00", status: "aktiv", deleted: false, ...patch });
const I = (listing: string, copy: string): SollItem => ({
  listing_id: listing, copy_id: copy, card_id: "46986414", name: "Dunkler Magier", set_code: "LOB-DE005", language: "DE",
  rarity: "Ultra Rare", edition: "first", condition: "NM", image_url: "https://images.ygoprodeck.com/images/cards/46986414.jpg", deleted: false,
});

function world(init: Parameters<typeof fakeStore>[0] = {}, ebay: FakeEbayOpts = {}) {
  const st = fakeStore({ listings: [L("l1")], items: [I("l1", "c1"), I("l1", "c2")], live: ["c1", "c2"], ...init });
  const eb = fakeEbay({ aspects: ASPECTS, ...ebay });
  let clock = NOW;
  const run = (retry: string | null = null, max?: number) =>
    runSync({ store: st.store, fetch: eb.fetchFn, env: (k) => ENV[k], now: () => clock, holder: "t" }, { retry, max });
  const later = (ms: number) => { clock = new Date(clock.getTime() + ms); };
  return { ...st, eb, run, later };
}

Deno.test("einstellen: Inventar-Artikel, Offer, veröffentlichen -> online mit Link; Stand geschrieben", async () => {
  const w = world();
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.text, "1 eingestellt · 0 geändert · 0 beendet · 0 Fehler");
  const row = w.state.rows.get("l1")!;
  assertEquals([row.state, row.offer_id, row.item_id, row.item_url, row.published_qty, row.sku], ["online", "O1", "I2", "https://sandbox.ebay.de/itm/I2", 2, "L-l1"]);
  assertEquals(w.eb.offers.get("O1")!.body.pricingSummary.price, { value: "5.00", currency: "EUR" });
  assertEquals(w.eb.items.get("L-l1").availability.shipToLocationAvailability.quantity, 2);
  assertEquals([w.state.account.last_run_at, w.state.account.last_error], ["2026-09-22T12:00:00.000Z", null]);
  assertEquals([w.state.lockHolder, w.state.unlocked], [null, 1]);
});

Deno.test("ändern: neuer Preis -> Offer aktualisiert, nichts neu angelegt; unverändert -> keine eBay-Aufrufe", async () => {
  const w = world();
  await w.run();
  w.state.listings[0] = L("l1", { price: "12.00" });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.summary.revised, 1);
  assertEquals(w.eb.offers.size, 1);
  assertEquals(w.eb.offers.get("O1")!.body.pricingSummary.price.value, "6.00");
  const before = w.eb.ebayCalls().length;
  await w.run();
  assertEquals(w.eb.ebayCalls().length, before, "gleiche Prüfsumme, frisch geprüft: kein Aufruf");
});

Deno.test("Menge senken: Karte anderswo verkauft -> Menge 1", async () => {
  const w = world();
  await w.run();
  w.state.live.delete("c2");
  await w.run();
  assertEquals(w.eb.items.get("L-l1").availability.shipToLocationAvailability.quantity, 1);
  assertEquals(w.eb.offers.get("O1")!.body.availableQuantity, 1);
  assertEquals(w.state.rows.get("l1")!.published_qty, 1);
});

Deno.test("zurückziehen: Angebot beendet oder Menge 0 -> withdraw -> beendet", async () => {
  const w = world();
  await w.run();
  w.state.listings[0] = L("l1", { status: "verkauft" });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && r.summary.withdrawn, 1);
  assertEquals([w.state.rows.get("l1")!.state, w.eb.offers.get("O1")!.status], ["beendet", "UNPUBLISHED"]);
  const w2 = world();
  await w2.run();
  w2.state.live.clear();
  await w2.run();
  assertEquals(w2.state.rows.get("l1")!.state, "beendet");
});

Deno.test("manuell auf eBay beendet -> fehler, nicht wiederholt, Erneut versuchen stellt neu ein", async () => {
  const w = world();
  await w.run();
  w.eb.offers.get("O1")!.listing!.listingStatus = "ENDED";
  w.later(60 * 60 * 1000);
  await w.run();
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l1")!.error], ["fehler", ENDED_ON_EBAY]);
  const before = w.eb.ebayCalls().length;
  await w.run();
  assertEquals(w.eb.ebayCalls().length, before, "Fehler ohne Änderung wird nicht wiederholt");
  await w.run("l1");
  assertEquals([w.state.rows.get("l1")!.state, w.eb.offers.get("O1")!.listing!.listingStatus], ["online", "ACTIVE"]);
});

Deno.test("auf eBay verkauft (soldQuantity) -> fehler vor dem Ändern; Erneut versuchen übernimmt die Zahl", async () => {
  const w = world();
  await w.run();
  w.eb.offers.get("O1")!.listing!.soldQuantity = 1;
  w.state.listings[0] = L("l1", { price: "11.00" });
  await w.run();
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l1")!.error], ["fehler", SOLD_ON_EBAY]);
  assertEquals(w.eb.offers.get("O1")!.body.pricingSummary.price.value, "5.00", "nichts überschrieben");
  await w.run("l1");
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l1")!.sold_seen], ["online", 1]);
});

Deno.test("Token abgelaufen/widerrufen -> getrennt, Hinweis, neue Angebote warten, keine Inventar-Aufrufe", async () => {
  const w = world({ account: account({ access_expires_at: "2026-09-22T11:00:00Z" }) }, { refreshInvalid: true });
  const r = await w.run();
  assertEquals(r.ok, true);
  assertEquals([w.state.account.refresh_token, w.state.account.access_token, w.state.account.last_error], [null, null, EXPIRED]);
  assertEquals(w.state.rows.get("l1")!.state, "wartet");
  assertEquals(w.eb.ebayCalls().length, 0);
});

Deno.test("Einrichtung unvollständig -> wartet ohne eBay-Aufruf", async () => {
  const w = world({ account: account({ return_policy_id: null }) });
  await w.run();
  assertEquals([w.state.rows.get("l1")!.state, w.eb.ebayCalls().length], ["wartet", 0]);
});

Deno.test("Einzelfehler: abgelehnte Anzeige nur für dieses Angebot", async () => {
  const w = world({ listings: [L("l1"), L("l2")], items: [I("l1", "c1"), I("l2", "c3")], live: ["c1", "c3"] },
    { rejectPublish: { "L-l2": "Das Merkmal Sprache fehlt." } });
  const r = await w.run();
  assertEquals(r.ok && !r.busy && [r.summary.published, r.summary.errors], [1, 1]);
  assertEquals([w.state.rows.get("l1")!.state, w.state.rows.get("l2")!.state, w.state.rows.get("l2")!.error], ["online", "fehler", "Das Merkmal Sprache fehlt."]);
});

Deno.test("Pflichtmerkmal ohne Wert -> fehler ohne Veröffentlichen", async () => {
  const w = world({}, { aspects: [...ASPECTS, { localizedAspectName: "Charakter", aspectConstraint: { aspectRequired: true } }] });
  await w.run();
  assertEquals(w.state.rows.get("l1")!.error, "eBay verlangt das Merkmal „Charakter“.");
  assertEquals(w.eb.ebayCalls().length, 0);
});

Deno.test("zweiter paralleler Lauf -> „läuft schon“, keine Aufrufe", async () => {
  const w = world();
  w.state.lockHolder = "anderer";
  assertEquals(await w.run(), { ok: true, busy: true, text: "läuft schon" });
  assertEquals(w.eb.calls.length, 0);
});

Deno.test("eBay nicht erreichbar -> Durchgang bricht ab, letzter Fehler, Sperre frei, Zeilen unverändert", async () => {
  const w = world({ account: account({ access_expires_at: "2026-09-22T11:00:00Z" }) }, { down: true });
  const r = await w.run();
  assertEquals([r.ok, w.state.account.last_error, w.state.rows.size, w.state.lockHolder], [false, "Service Unavailable", 0, null]);
  assertEquals(w.state.account.refresh_token, "RT", "vorübergehend: nicht trennen");
});

Deno.test("eBay mitten im Lauf überlastet -> Abbruch statt Einzelfehler, nichts gespeichert", async () => {
  const w = world({}, { publishDown: true });
  const r = await w.run();
  assertEquals([r.ok, w.state.account.last_error, w.state.rows.size, w.state.lockHolder], [false, "Service Unavailable", 0, null]);
});

Deno.test("höchstens N je Durchgang, Rest im nächsten Lauf", async () => {
  const w = world({ listings: [L("l1"), L("l2")], items: [I("l1", "c1"), I("l2", "c3")], live: ["c1", "c3"] });
  const r = await w.run(null, 1);
  assertEquals(r.ok && !r.busy && [r.summary.published, r.summary.deferred], [1, 1]);
  await w.run(null, 1);
  assertEquals(w.state.rows.get("l2")!.state, "online");
});

Deno.test("Zeile aus der Produktion wird nicht angefasst; in der Sandbox neu eingestellt", async () => {
  const prodRow = { listing_id: "l1", environment: "production", state: "online" as const, sku: "L-l1", offer_id: "P9", item_id: "X",
    item_url: "https://www.ebay.de/itm/X", published_qty: 2, synced_hash: "h", failed_hash: null, sold_seen: 0, error: null, synced_at: null };
  const w = world({ rows: [prodRow] });
  await w.run();
  assertEquals(w.eb.calls.some((c) => c.url.startsWith("https://api.ebay.com")), false);
  assertEquals([w.state.rows.get("l1")!.environment, w.state.rows.get("l1")!.offer_id], ["sandbox", "O1"]);
});
```

`supabase/functions/ebay-sync/handler_test.ts`:

```ts
// Spec H3b §8/§9 -- Zugang zu ebay-sync: Zeitplan nur mit Geheimwert, sonst Anmeldung; retry nur vom Gerät.
import { assertEquals } from "jsr:@std/assert@1";
import { handleSync } from "./handler.ts";

const FN = "https://proj.supabase.co/functions/v1/ebay-sync";
function deps(cronSecret: string | undefined) {
  const runs: (string | null)[] = [];
  return {
    runs,
    d: {
      cronSecret, verifyUser: (h: string | null) => Promise.resolve(h === "Bearer JWT"),
      run: (retry: string | null) => { runs.push(retry); return Promise.resolve({ ok: true as const, busy: true as const, text: "läuft schon" }); },
    },
  };
}
const req = (headers: Record<string, string>, body: unknown = {}) => new Request(FN, { method: "POST", headers, body: JSON.stringify(body) });

Deno.test("Zeitplan mit richtigem Geheimwert läuft, retry wird ignoriert", async () => {
  const x = deps("s3cret");
  const r = await handleSync(req({ "x-ebay-secret": "s3cret" }, { retry: "l1" }), x.d);
  assertEquals([r.status, x.runs], [200, [null]]);
});

Deno.test("falscher oder fehlender Geheimwert ohne Anmeldung -> 401; ohne EBAY_CRON_SECRET nie offen", async () => {
  for (const [secret, h] of [["s3cret", { "x-ebay-secret": "falsch" }], [undefined, { "x-ebay-secret": "" }], [undefined, {}]] as const) {
    const x = deps(secret);
    assertEquals((await handleSync(req(h as Record<string, string>), x.d)).status, 401);
    assertEquals(x.runs.length, 0);
  }
});

Deno.test("angemeldetes Gerät: Anstoß und Erneut versuchen", async () => {
  const x = deps("s3cret");
  await handleSync(req({ Authorization: "Bearer JWT" }), x.d);
  await handleSync(req({ Authorization: "Bearer JWT" }, { retry: "l7" }), x.d);
  assertEquals(x.runs, [null, "l7"]);
  assertEquals((await handleSync(new Request(FN), x.d)).status, 405);
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/ebay-sync/`
Expected: FAIL — `Module not found … ebay-sync/sync.ts`.

- [ ] **Step 3: `sync.ts` schreiben**

```ts
// supabase/functions/ebay-sync/sync.ts
// Spec H3b §8 -- ein Durchgang des Abgleichers, H3b1: Schritt 1 (Token), 4 (Angebote abgleichen, höchstens 50),
// 5 (Stand schreiben). Nur ein Durchgang gleichzeitig (Sperre in ebay_account, Abweichung 2). Einzelne Ablehnungen
// betreffen nur ihr Angebot; eBay nicht erreichbar / Verbindung weg bricht den Durchgang ab (Spec §9).
import {
  appToken, categoryAspects, credsFor, type EbayApi, ebayApi, EbayError, ensureAccess, type Env, type Fetch, type Offer,
} from "../_shared/ebay-client.ts";
import {
  type AspectDef, type Built, buildListing, categoryFor, desired, hashOf, inventoryItemBody, itemUrl, MARKETPLACE,
  offerBody, ownPhotos, photoUrl, type Policies,
} from "../_shared/ebay-map.ts";
import {
  decide, type EbayRow, emptySummary, ENDED_ON_EBAY, EXPIRED, offerEnded, SOLD_ON_EBAY, type Summary, summaryText,
} from "../_shared/ebay-plan.ts";
import type { Store } from "../_shared/ebay-store.ts";

export const LOCK_SECONDS = 300;
export const MAX_PER_RUN = 50;

export type SyncDeps = { store: Store; fetch: Fetch; env: (k: string) => string | undefined; now: () => Date; holder: string };
export type SyncResult =
  | { ok: true; busy: true; text: string }
  | { ok: true; busy: false; summary: Summary; text: string }
  | { ok: false; error: string };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
class ListingProblem extends Error {}

function freshRow(id: string, env: string): EbayRow {
  return {
    listing_id: id, environment: env, state: "wartet", sku: null, offer_id: null, item_id: null, item_url: null,
    published_qty: null, synced_hash: null, failed_hash: null, sold_seen: null, error: null, synced_at: null,
  };
}

async function publish(api: EbayApi, b: Built, p: Policies): Promise<{ offerId: string; listingId: string; sold: number }> {
  await api.putInventoryItem(b.sku, inventoryItemBody(b));
  // Nach einem Abbruch mitten im Einstellen gibt es die Offer schon: wiederverwenden statt doppelt anlegen.
  const existing = (await api.getOffers(b.sku)).find((o) => (o.marketplaceId ?? MARKETPLACE) === MARKETPLACE) ?? null;
  if (!existing) {
    const offerId = await api.createOffer(offerBody(b, p));
    return { offerId, listingId: await api.publishOffer(offerId), sold: 0 };
  }
  await api.updateOffer(existing.offerId, offerBody(b, p));
  if (!offerEnded(existing)) {
    return { offerId: existing.offerId, listingId: String(existing.listing?.listingId), sold: existing.listing?.soldQuantity ?? 0 };
  }
  return { offerId: existing.offerId, listingId: await api.publishOffer(existing.offerId), sold: 0 };
}

async function revise(api: EbayApi, b: Built, p: Policies, row: EbayRow, ack: boolean) {
  const offer: Offer | null = await api.getOffer(row.offer_id!);
  if (!offer) return await publish(api, b, p);
  const ended = offerEnded(offer);
  const sold = offer.listing?.soldQuantity ?? 0;
  if (ended && !ack) throw new ListingProblem(ENDED_ON_EBAY);
  if (!ended && sold > (row.sold_seen ?? 0) && !ack) throw new ListingProblem(SOLD_ON_EBAY);
  await api.putInventoryItem(b.sku, inventoryItemBody(b));
  await api.updateOffer(offer.offerId, offerBody(b, p));
  if (ended) return { offerId: offer.offerId, listingId: await api.publishOffer(offer.offerId), sold: 0 };
  return { offerId: offer.offerId, listingId: String(offer.listing?.listingId), sold };
}

export async function runSync(d: SyncDeps, opts: { retry?: string | null; max?: number } = {}): Promise<SyncResult> {
  const retryId = opts.retry ?? null;
  const max = opts.max ?? MAX_PER_RUN;
  if (!(await d.store.tryLock(d.holder, LOCK_SECONDS))) return { ok: true, busy: true, text: "läuft schon" };
  const now = d.now();
  const nowIso = now.toISOString();
  const s = emptySummary();
  try {
    const acc = await d.store.account();
    const env = acc.environment as Env;
    let lastError: string | null = null;
    let api: EbayApi | null = null;
    let connected = !!acc.refresh_token;
    const expired = !!acc.refresh_expires_at && Date.parse(acc.refresh_expires_at) <= now.getTime();
    const creds = connected ? credsFor(env, d.env) : null;
    // Schritt 1: Token erneuern. Abgelehnt (invalid_grant) oder abgelaufen -> trennen, Angebote bleiben „wartet“.
    if (connected && !expired) {
      try {
        const t = await ensureAccess(d.fetch, env, creds!, acc, now);
        if (t.patch) await d.store.saveAccount(t.patch);
        api = ebayApi(d.fetch, env, t.token);
      } catch (e) {
        if (!(e instanceof EbayError && e.auth)) throw e;
        connected = false;
      }
    } else connected = false;
    if (!connected && acc.refresh_token) {
      await d.store.saveAccount({ refresh_token: null, refresh_expires_at: null, access_token: null, access_expires_at: null });
      lastError = EXPIRED;
    }
    const setupOk = connected && !!(acc.payment_policy_id && acc.fulfillment_policy_id && acc.return_policy_id && acc.location_key);
    const policies: Policies = acc;

    // Schritt 4: Angebote abgleichen.
    const rows = await d.store.openRows(retryId);
    const rowById = new Map(rows.map((r) => [r.listing_id, r]));
    const soll = await d.store.soll([...rowById.keys()]);
    const listingById = new Map(soll.listings.map((l) => [l.listing_id, l]));
    const ids = [...new Set([...listingById.keys(), ...rowById.keys()])].sort(cmp);
    // Abweichung 10: Merkmale je Kategorie (Einzelkarten 183454, Konvolute 183455), einmal je Durchgang.
    const aspectsByCategory = new Map<string, AspectDef[]>();
    const loadAspects = async (categoryId: string) => {
      const hit = aspectsByCategory.get(categoryId);
      if (hit) return hit;
      let aspects: AspectDef[];
      try { aspects = await categoryAspects(d.fetch, env, await appToken(d.fetch, env, creds!), categoryId); }
      catch (e) {
        // Ohne Merkmale scheitert jedes Einstellen gleich -> Durchgang abbrechen statt 50 gleiche Fehler.
        throw new EbayError(`eBay-Merkmale nicht lesbar: ${(e as Error).message}`, (e as EbayError).status ?? 0, true, false);
      }
      aspectsByCategory.set(categoryId, aspects);
      return aspects;
    };
    let used = 0;
    for (const id of ids) {
      const listing = listingById.get(id) ?? null;
      const want = desired(listing, soll.items, soll.liveCopyIds);
      const photoUrls = ownPhotos(soll.photos, id).map((p) => photoUrl(d.store.photoBase, p.path));
      const hash = want.active ? await hashOf(buildListing(listing!, want.liveItems, photoUrls, [])) : null;
      const row = rowById.get(id) ?? null;
      const sameEnv = row && row.environment === env ? row : null;
      const action = decide({ active: want.active, hash, row, env, connected, setupOk, retry: id === retryId, nowMs: now.getTime() });
      if (action === "none") continue;
      if (used >= max) { s.deferred++; continue; }
      used++;
      const base = sameEnv ?? freshRow(id, env);
      try {
        if (action === "wait") {
          await d.store.saveRow({ ...freshRow(id, env), synced_at: nowIso });
          s.waiting++;
        } else if (action === "end_local") {
          await d.store.saveRow({ ...base, state: "beendet", error: null, synced_at: nowIso });
          s.withdrawn++;
        } else if (action === "withdraw") {
          const offer = await api!.getOffer(base.offer_id!);
          if (offer && offer.status === "PUBLISHED") await api!.withdrawOffer(offer.offerId);
          await d.store.saveRow({ ...base, state: "beendet", published_qty: 0, error: null, synced_at: nowIso });
          s.withdrawn++;
        } else if (action === "check") {
          const offer = await api!.getOffer(base.offer_id!);
          if (offerEnded(offer)) throw new ListingProblem(ENDED_ON_EBAY);
          if ((offer!.listing?.soldQuantity ?? 0) > (base.sold_seen ?? 0)) throw new ListingProblem(SOLD_ON_EBAY);
          await d.store.saveRow({ ...base, synced_at: nowIso });
          s.checked++;
        } else {
          const b = buildListing(listing!, want.liveItems, photoUrls, await loadAspects(categoryFor(want.liveItems)));
          if (b.problem) throw new ListingProblem(b.problem);
          const ack = id === retryId || base.state === "beendet";
          const r = action === "publish" || !base.offer_id ? await publish(api!, b, policies) : await revise(api!, b, policies, base, ack);
          await d.store.saveRow({
            ...base, state: "online", sku: b.sku, offer_id: r.offerId, item_id: r.listingId, item_url: itemUrl(env, r.listingId),
            published_qty: b.quantity, synced_hash: hash, failed_hash: null, sold_seen: r.sold, error: null, synced_at: nowIso,
          });
          if (action === "publish") s.published++; else s.revised++;
        }
      } catch (e) {
        // Verbindung/Netz: ganzer Durchgang bricht ab (der nächste versucht es erneut). Sonst nur dieses Angebot.
        if (e instanceof EbayError && (e.transient || e.auth)) throw e;
        await d.store.saveRow({ ...base, state: "fehler", error: (e as Error).message, failed_hash: hash, synced_at: nowIso });
        s.errors++;
      }
    }
    // Schritt 5: Stand schreiben.
    const text = summaryText(s);
    await d.store.saveAccount({ last_run_at: nowIso, last_run_summary: text, last_error: lastError });
    return { ok: true, busy: false, summary: s, text };
  } catch (e) {
    const msg = e instanceof EbayError && e.auth ? EXPIRED : (e as Error).message;
    try { await d.store.saveAccount({ last_run_at: nowIso, last_error: msg }); }
    catch (e2) { console.error("[ebay-sync] Stand nicht gespeichert:", (e2 as Error).message); }
    return { ok: false, error: msg };
  } finally {
    await d.store.unlock(d.holder);
  }
}
```

- [ ] **Step 4: `handler.ts` und `index.ts` schreiben**

```ts
// supabase/functions/ebay-sync/handler.ts
// Spec H3b §8 -- Aufruf durch pg_cron (Header x-ebay-secret = EBAY_CRON_SECRET) oder durch ein angemeldetes Gerät
// (Anstoß nach eBay-relevanter Änderung, „Jetzt abgleichen“, „Erneut versuchen“ mit { retry: listing_id }).
// Ohne gesetzten EBAY_CRON_SECRET ist der Zeitplan-Weg zu (nie offen).
import { json, safeEqual } from "../_shared/http.ts";
import type { SyncResult } from "./sync.ts";

export type SyncHandlerDeps = {
  cronSecret: string | undefined;
  verifyUser: (authorization: string | null) => Promise<boolean>;
  run: (retry: string | null) => Promise<SyncResult>;
};

export async function handleSync(req: Request, d: SyncHandlerDeps): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "Nur POST." }, 405);
  const cron = !!d.cronSecret && safeEqual(req.headers.get("x-ebay-secret"), d.cronSecret);
  if (!cron && !(await d.verifyUser(req.headers.get("authorization")))) return json({ ok: false, error: "Nicht angemeldet." }, 401);
  const body = await req.json().catch(() => ({})) as { retry?: unknown };
  const retry = !cron && typeof body.retry === "string" && body.retry !== "" ? body.retry : null;
  return json(await d.run(retry));
}
```

```ts
// supabase/functions/ebay-sync/index.ts
// Spec H3b §8 -- Abgleicher. Deploy (macht der Nutzer, nie ein Agent):
//   supabase functions deploy ebay-sync --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn
// Secrets: EBAY_SANDBOX_*/EBAY_PROD_* und EBAY_CRON_SECRET (supabase/README_ebay_cloud.md). Keine Tokens in Protokollen.
import { serviceDeps } from "../_shared/supabase-deps.ts";
import { handleSync } from "./handler.ts";
import { runSync } from "./sync.ts";

Deno.serve((req) => {
  const s = serviceDeps();
  return handleSync(req, {
    cronSecret: Deno.env.get("EBAY_CRON_SECRET"),
    verifyUser: s.verifyUser,
    run: (retry) => runSync({ store: s.store, fetch, env: s.env, now: () => new Date(), holder: crypto.randomUUID() }, { retry }),
  });
});
```

- [ ] **Step 5: Tests grün, Typprüfung**

Run: `deno test --allow-read --node-modules-dir=none supabase/functions/_shared/ supabase/functions/ebay-auth/ supabase/functions/ebay-sync/`
Expected: PASS, 47 Tests (29 + 15 + 3).
Run: `deno check --node-modules-dir=none supabase/functions/ebay-auth/index.ts supabase/functions/ebay-sync/index.ts`
Expected: zwei `Check`-Zeilen, kein Fehler.
Run (Abschluss-Kontrolle, alte Funktionen unverändert): `deno test --allow-read --node-modules-dir=none supabase/functions/` → Ausgangszahl + 47.

- [ ] **Step 6: Schutz-Nachweise**

1. `runSync`: `if (!(await d.store.tryLock(…))) return …` durch `await d.store.tryLock(…);` ersetzen. „zweiter paralleler Lauf“ scheitert. Zurücknehmen.
2. `runSync` catch je Angebot: `if (e instanceof EbayError && (e.transient || e.auth)) throw e;` entfernen. „eBay mitten im Lauf überlastet …“ scheitert (`ok: true`, Zeile `fehler`; vom Plan-Autor ausgeführt). Zurücknehmen.
3. `revise`: die Zeile mit `SOLD_ON_EBAY` entfernen. „auf eBay verkauft (soldQuantity) …“ scheitert (Preis überschrieben). Zurücknehmen.
4. `runSync`: `if (used >= max) { s.deferred++; continue; }` entfernen. „höchstens N je Durchgang“ scheitert. Zurücknehmen.
5. `handleSync`: `const cron = …` durch `const cron = safeEqual(req.headers.get("x-ebay-secret"), d.cronSecret) || d.cronSecret === undefined;` ersetzen (Zeitplan ohne Geheimwert offen). „falscher oder fehlender Geheimwert …“ scheitert (vom Plan-Autor ausgeführt). Zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/ebay-sync/sync.ts supabase/functions/ebay-sync/sync_test.ts supabase/functions/ebay-sync/handler.ts supabase/functions/ebay-sync/handler_test.ts supabase/functions/ebay-sync/index.ts
git commit -m "feat(h3b1): Edge Function ebay-sync (Token, Angebote abgleichen, Stand; Sperre, Einzelfehler, 50 je Lauf)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---


### Task 6: PC — Schema, Nur-Lese-Ströme, Foto-Strom, `syncNow`, Foto-Helfer, IPC, Anstoß

**Files:**
- Create: `desktop/electron/ebay-schema.cjs`, `desktop/electron/listing-photos.cjs`, `desktop/electron/listing-photos.test.cjs`, `desktop/electron/ebay-sync.test.cjs`
- Modify: `desktop/electron/database.cjs` (nach `ensureListingsSchema(db);`, Zeile 286), `desktop/electron/sync.cjs`, `desktop/electron/main.cjs`, `desktop/electron/preload.cjs`, `desktop/electron/ipc-channels.test.cjs`

**Interfaces:**
- Consumes: Cloud-Spalten aus Task 3; Funktions-Antworten aus Task 4/5.
- Produces (`ebay-schema.cjs`): `ensureEbaySchema(db)`, `EBAY_LISTING_COLS` (15), `LISTING_PHOTO_COLS` (7).
- Produces (`sync.cjs`): Strom `listing_photos` in `SALES_STREAMS` (Zeiger `sync_listing_photos_last_pull/_last_push`, `localWinsUnpushed`), Nur-Lese-Strom `ebay_listings` (Zeiger `sync_ebay_listings_last_pull`), Zwischenspeicher `settings.ebay_status_cache` (JSON der Ansicht oder `null`), Renderer-Ereignis `ebay-changed`; `startSync(...)` gibt `{ ensureClient, syncNow }` zurück; Exporte `listingPhotoToRemote, remoteToLocalListingPhoto, _applyPulledListingPhotos, _recentlyPushedListingPhotos, _pullReadOnlyTable(c, db, table), _pullEbayStatus(c, db), _READ_ONLY_TABLES, _PUSHED_TABLES`.
- Produces (`listing-photos.cjs`): `PhotoError`, `MAX_PHOTOS = 12`, `MAX_EDGE = 1600`, `MIN_EDGE = 500`, `TARGET_BYTES = 512000`, `QUALITIES = [85, 75, 65, 55, 50]`, `scaleSize(w, h)`, `encodeUnder(encode)`, `photoPath(listingId, uuid)`, `publicPhotoUrl(baseUrl, path)`, `listPhotos(db, listingId, baseUrl) -> [{ photo_id, path, sort, url }]`, `addPhoto(db, { listingId, filePath }, deps) -> { photo_id, path, bytes }`, `deletePhoto(db, photoId)`, `reorderPhotos(db, listingId, photoIds)`.
- Produces (`window.api`): `ebayStatus() -> { status: object|null }`, `ebayListings() -> { [listing_id]: row }`, `ebayAuth({ action, … }) -> Antwort der Funktion` (bei `start` öffnet der Hauptprozess die URL und antwortet `{ ok: true }`), `ebaySyncNow({ retry? }) -> { ok, busy?, text?, summary?, error? }`, `listingPhotos(listingId)`, `addListingPhotos(listingId) -> { success, added, error? }`, `deleteListingPhoto(photoId) -> { success, error? }`, `reorderListingPhotos({ listing_id, photoIds }) -> { success, error? }`, `onEbayChanged(cb) -> off`. Neue IPC-Kanäle: `ebay-status`, `ebay-listings`, `ebay-auth`, `ebay-sync-now`, `listing-photos`, `listing-photo-add`, `listing-photo-delete`, `listing-photo-reorder`.

- [ ] **Step 1: Failing Tests**

`desktop/electron/ebay-sync.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const Sync = require('./sync.cjs');
const { ensureCopiesSchema } = require('./copies-schema.cjs');
const { ensureSalesSchema } = require('./sales-schema.cjs');
const { ensureListingsSchema } = require('./listings-schema.cjs');
const { ensureEbaySchema } = require('./ebay-schema.cjs');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cards (id TEXT, set_code TEXT, language TEXT DEFAULT 'DE', rarity TEXT DEFAULT 'Unknown', name TEXT, image_url TEXT,
      quantity INTEGER DEFAULT 0, price REAL, deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id, set_code, language, rarity));
    CREATE TABLE portfolio_history (id INTEGER PRIMARY KEY AUTOINCREMENT, total_value REAL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  ensureCopiesSchema(db); ensureSalesSchema(db); ensureListingsSchema(db); ensureEbaySchema(db);
  return db;
}
// Nachgebauter Supabase-Client: nur Lese-Ketten; jeder Aufruf wird protokolliert (Wächter gegen Schreiben).
function fakeClient(pages) {
  const calls = [];
  const q = {};
  for (const m of ['select', 'gt', 'order', 'eq']) q[m] = (...a) => { calls.push(m); return q; };
  for (const m of ['upsert', 'insert', 'update', 'delete']) q[m] = () => { calls.push(m); return q; };
  q.range = () => { calls.push('range'); return Promise.resolve({ data: pages.shift() ?? [], error: null }); };
  q.maybeSingle = () => { calls.push('maybeSingle'); return Promise.resolve({ data: pages.shift() ?? null, error: null }); };
  return { calls, from: (t) => { calls.push(`from:${t}`); return q; } };
}
const ROW = { listing_id: 'l1', environment: 'sandbox', state: 'online', sku: 'L-l1', offer_id: 'O1', item_id: 'I2',
  item_url: 'https://sandbox.ebay.de/itm/I2', published_qty: 2, synced_hash: 'h', failed_hash: null, sold_seen: 0, error: null,
  synced_at: '2026-09-22T12:00:00+00:00', created_at: '2026-09-22T12:00:00+00:00', updated_at: '2026-09-22T12:00:00.5+00:00' };

test('ebay_listings: Nur-Lese-Strom übernimmt Zeilen wörtlich, setzt den Zeiger und schreibt nie', async () => {
  const db = freshDb();
  const c = fakeClient([[ROW, { ...ROW, listing_id: 'l2', state: 'fehler', error: 'Merkmal fehlt', updated_at: '2026-09-22T12:01:00+00:00' }]]);
  assert.equal(await Sync._pullReadOnlyTable(c, db, 'ebay_listings'), 2);
  assert.deepEqual(db.prepare('SELECT listing_id, state, error, published_qty FROM ebay_listings ORDER BY listing_id').all(),
    [{ listing_id: 'l1', state: 'online', error: null, published_qty: 2 }, { listing_id: 'l2', state: 'fehler', error: 'Merkmal fehlt', published_qty: 2 }]);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'sync_ebay_listings_last_pull'").get().value, '2026-09-22T12:01:00+00:00');
  assert.deepEqual(c.calls.filter((m) => ['upsert', 'insert', 'update', 'delete'].includes(m)), []);
  const again = fakeClient([[{ ...ROW, state: 'beendet', updated_at: '2026-09-22T13:00:00+00:00' }]]);
  await Sync._pullReadOnlyTable(again, db, 'ebay_listings');
  assert.equal(db.prepare("SELECT state FROM ebay_listings WHERE listing_id = 'l1'").get().state, 'beendet');
});

test('Wächter: Nur-Lese-Tabellen werden nie geschoben', () => {
  for (const t of [...Sync._READ_ONLY_TABLES, 'ebay_status', 'ebay_account']) assert.ok(!Sync._PUSHED_TABLES.includes(t), t);
  const src = fs.readFileSync(path.join(__dirname, 'sync.cjs'), 'utf8');
  assert.doesNotMatch(src, /from\((['"`])ebay_(listings|status|account)\1\)\s*\.\s*(upsert|insert|update|delete)/);
});

test('ebay_status: Zwischenspeicher nur bei Änderung, leerer Stand = null', async () => {
  const db = freshDb();
  const S = { environment: 'sandbox', connected: true, has_payment_policy: true };
  assert.equal(await Sync._pullEbayStatus(fakeClient([S]), db), true);
  assert.equal(await Sync._pullEbayStatus(fakeClient([{ ...S }]), db), false);
  assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'ebay_status_cache'").get().value), S);
  assert.equal(await Sync._pullEbayStatus(fakeClient([null]), db), true);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'ebay_status_cache'").get().value, 'null');
});

const PHOTO = { photo_id: 'p1', listing_id: 'l1', path: 'l1/p1.jpg', sort: 2, created_at: '2026-09-22T10:00:00+00:00',
  updated_at: '2026-09-22T10:00:01.5+00:00', deleted: false };

test('listing_photos: Abbildung, Echo, gezogene Zeilen nicht zurückschieben, lokale Änderung schieben', () => {
  const db = freshDb();
  const l = Sync.remoteToLocalListingPhoto(PHOTO);
  assert.deepEqual(l, { photo_id: 'p1', listing_id: 'l1', path: 'l1/p1.jpg', sort: 2, deleted: 0 });
  assert.equal(Sync.listingPhotoToRemote({ ...PHOTO, deleted: 1 }).deleted, true);
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_listing_photos_last_push', '2026-09-20T00:00:00Z')").run();
  Sync._recentlyPushedListingPhotos.clear();
  assert.equal(Sync._applyPulledListingPhotos(db, [PHOTO]), 1);
  assert.deepEqual(Sync._salesPushRows(db, 'listing_photos', '2026-09-20 00:00:00'), []);
  Sync._recentlyPushedListingPhotos.set('p1', PHOTO.updated_at);
  assert.equal(Sync._applyPulledListingPhotos(db, [PHOTO]), 0, 'Echo');
  db.prepare("INSERT INTO listing_photos (photo_id, listing_id, path, sort, updated_at) VALUES ('p2', 'l1', 'l1/p2.jpg', 0, '2026-09-21 08:00:00')").run();
  assert.deepEqual(Sync._salesPushRows(db, 'listing_photos', '2026-09-20 00:00:00').map((r) => r.photo_id), ['p2']);
});

test('listing_photos: lokal ungeschoben gewinnt gegen den Pull (localWinsUnpushed)', () => {
  const db = freshDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('sync_listing_photos_last_push', '2026-09-21T00:00:00Z')").run();
  db.prepare("INSERT INTO listing_photos (photo_id, listing_id, path, sort, deleted, updated_at) VALUES ('p1', 'l1', 'l1/p1.jpg', 0, 1, '2026-09-22 09:00:00')").run();
  Sync._recentlyPushedListingPhotos.clear();
  Sync._applyPulledListingPhotos(db, [{ ...PHOTO, sort: 5 }]);
  assert.deepEqual(db.prepare("SELECT sort, deleted FROM listing_photos WHERE photo_id = 'p1'").get(), { sort: 0, deleted: 1 });
});
```

`desktop/electron/listing-photos.test.cjs` (gefälschtes Bild; `sizes` legt die JPEG-Größe je Qualität fest: 85 → 900 kB, 75 → 600 kB, 65 → 450 kB < 500 KiB):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { ensureListingsSchema } = require('./listings-schema.cjs');
const { ensureEbaySchema } = require('./ebay-schema.cjs');
const P = require('./listing-photos.cjs');

function freshDb() {
  const db = new Database(':memory:');
  ensureListingsSchema(db); ensureEbaySchema(db);
  db.prepare("INSERT INTO listings (listing_id, channel_id, channel_name, price, listed_on) VALUES ('l1', 'ebay', 'eBay', 5, '2026-09-22')").run();
  return db;
}
// Gefälschtes Bild: toJPEG liefert je Qualität eine feste Größe; resize merkt sich die Zielgröße.
function fakeDeps({ width = 4000, height = 3000, sizes = { 85: 900e3, 75: 600e3, 65: 450e3 }, fileSize = 3e6 } = {}) {
  const uploads = []; let n = 0; let resized = null;
  return {
    uploads, resizedTo: () => resized,
    deps: {
      fileSize: () => fileSize, readFile: () => Buffer.from('x'),
      decode: () => ({ width, height, resize: (s) => { resized = s; return { toJPEG: (q) => Buffer.alloc(sizes[q] ?? 100e3) }; } }),
      upload: async (p, buf) => { uploads.push([p, buf.length]); },
      uuid: () => `u${++n}`,
    },
  };
}

test('Größe: längste Seite höchstens 1600, Seitenverhältnis bleibt', () => {
  assert.deepEqual(P.scaleSize(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(P.scaleSize(1000, 3000), { width: 533, height: 1600 });
  assert.deepEqual(P.scaleSize(800, 600), { width: 800, height: 600 });
});

test('Qualität sinkt, bis unter 500 KB; letzte Stufe wird genommen', () => {
  const seen = [];
  assert.equal(P.encodeUnder((q) => { seen.push(q); return Buffer.alloc(q === 65 ? 400e3 : 700e3); }).length, 400e3);
  assert.deepEqual(seen, [85, 75, 65]);
  assert.equal(P.encodeUnder(() => Buffer.alloc(600e3)).length, 600e3);
});

test('Foto hinzufügen: verkleinert, hochgeladen unter <listing_id>/<uuid>.jpg, Reihenfolge hinten angehängt', async () => {
  const db = freshDb();
  const f = fakeDeps();
  const r = await P.addPhoto(db, { listingId: 'l1', filePath: 'C:\\Fotos\\a.JPG' }, f.deps);
  assert.deepEqual([r.photo_id, r.path, r.bytes], ['u1', 'l1/u1.jpg', 450e3]);
  assert.deepEqual(f.resizedTo(), { width: 1600, height: 1200 });
  assert.deepEqual(f.uploads, [['l1/u1.jpg', 450e3]]);
  await P.addPhoto(db, { listingId: 'l1', filePath: 'b.png' }, f.deps);
  assert.deepEqual(P.listPhotos(db, 'l1', 'https://proj.supabase.co/rest/v1').map((p) => [p.photo_id, p.sort, p.url]), [
    ['u1', 0, 'https://proj.supabase.co/storage/v1/object/public/listing-photos/l1/u1.jpg'],
    ['u2', 1, 'https://proj.supabase.co/storage/v1/object/public/listing-photos/l1/u2.jpg'],
  ]);
});

test('Prüfungen: Angebot, Anzahl 12, Dateityp, Größe, Mindestmaß -- ohne Hochladen', async () => {
  const db = freshDb();
  const reject = async (input, deps, msg) => {
    await assert.rejects(() => P.addPhoto(db, input, deps.deps), (e) => e instanceof P.PhotoError && e.message === msg);
    assert.equal(deps.uploads.length, 0);
  };
  await reject({ listingId: 'nix', filePath: 'a.jpg' }, fakeDeps(), 'Angebot nicht gefunden.');
  await reject({ listingId: 'l1', filePath: 'a.gif' }, fakeDeps(), 'Nur JPG- oder PNG-Bilder.');
  await reject({ listingId: 'l1', filePath: 'a.jpg' }, fakeDeps({ fileSize: 30e6 }), 'Bild ist zu groß (höchstens 25 MB).');
  await reject({ listingId: 'l1', filePath: 'a.jpg' }, fakeDeps({ width: 499, height: 300 }), 'Foto zu klein – mindestens 500 Pixel an der längeren Seite.');
  const ins = db.prepare("INSERT INTO listing_photos (photo_id, listing_id, path, sort) VALUES (?, 'l1', ?, ?)");
  for (let i = 0; i < 12; i++) ins.run(`x${i}`, `l1/x${i}.jpg`, i);
  await reject({ listingId: 'l1', filePath: 'a.jpg' }, fakeDeps(), 'Höchstens 12 eigene Fotos je Angebot.');
});

test('Löschen weich, Reihenfolge nur mit genau den lebenden Fotos', () => {
  const db = freshDb();
  const ins = db.prepare("INSERT INTO listing_photos (photo_id, listing_id, path, sort) VALUES (?, 'l1', ?, ?)");
  ins.run('a', 'l1/a.jpg', 0); ins.run('b', 'l1/b.jpg', 1); ins.run('c', 'l1/c.jpg', 2);
  P.deletePhoto(db, 'b');
  assert.equal(db.prepare("SELECT deleted FROM listing_photos WHERE photo_id = 'b'").get().deleted, 1);
  assert.throws(() => P.deletePhoto(db, 'b'), /Foto nicht gefunden/);
  P.reorderPhotos(db, 'l1', ['c', 'a']);
  assert.deepEqual(P.listPhotos(db, 'l1', 'https://x').map((p) => p.photo_id), ['c', 'a']);
  assert.throws(() => P.reorderPhotos(db, 'l1', ['c']), /inzwischen geändert/);
  assert.throws(() => P.reorderPhotos(db, 'l1', ['c', 'b']), /inzwischen geändert/);
});
```

In `ipc-channels.test.cjs` nach `H3A_CHANNELS` ergänzen und `...H3B1_CHANNELS` in die Schleife aufnehmen:

```js
// Spec H3b1 §4.4/§5.4/§6: eBay-Stand, eBay-Zeilen, Verbinden/Einrichten, Abgleich anstoßen, eigene Fotos.
const H3B1_CHANNELS = ['ebay-status', 'ebay-listings', 'ebay-auth', 'ebay-sync-now', 'listing-photos', 'listing-photo-add',
  'listing-photo-delete', 'listing-photo-reorder'];
```

- [ ] **Step 2: Fehlschlag bestätigen**

SQLite-Suite: `Cannot find module './ebay-schema.cjs'` (beide neuen Dateien) und 8 neue Kanal-Fehlschläge.

- [ ] **Step 3: `ebay-schema.cjs` schreiben und einhängen**

```js
// desktop/electron/ebay-schema.cjs — Spec H3b1 §5.1/§6. Gegenstück zu supabase/ebay_schema.sql.
// ebay_listings ist ein NUR-LESE-Spiegel (Strom ohne Push, sync.cjs READ_ONLY_STREAMS): Zeitstempel bleiben der Cloud-Text,
// kein Auslöser, nie geschoben. listing_photos ist ein Strom in beide Richtungen wie listings (Auslöser wie trg_listings_updated).
const EBAY_LISTING_COLS = ['listing_id', 'environment', 'state', 'sku', 'offer_id', 'item_id', 'item_url', 'published_qty', 'synced_hash',
  'failed_hash', 'sold_seen', 'error', 'synced_at', 'created_at', 'updated_at'];
const LISTING_PHOTO_COLS = ['photo_id', 'listing_id', 'path', 'sort', 'created_at', 'updated_at', 'deleted'];

function ensureEbaySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ebay_listings (
      listing_id TEXT PRIMARY KEY, environment TEXT NOT NULL, state TEXT NOT NULL, sku TEXT, offer_id TEXT, item_id TEXT,
      item_url TEXT, published_qty INTEGER, synced_hash TEXT, failed_hash TEXT, sold_seen INTEGER, error TEXT, synced_at TEXT,
      created_at TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS listing_photos (
      photo_id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, path TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS listing_photos_updated_idx ON listing_photos (updated_at);
    CREATE INDEX IF NOT EXISTS listing_photos_listing_idx ON listing_photos (listing_id);
    CREATE TRIGGER IF NOT EXISTS trg_listing_photos_updated AFTER UPDATE ON listing_photos FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN UPDATE listing_photos SET updated_at = CURRENT_TIMESTAMP WHERE photo_id = NEW.photo_id; END;
  `);
}

module.exports = { ensureEbaySchema, EBAY_LISTING_COLS, LISTING_PHOTO_COLS };
```

In `database.cjs` oben `const { ensureEbaySchema } = require('./ebay-schema.cjs');` und nach `ensureListingsSchema(db); // Spec H3a: Angebote` die Zeile `ensureEbaySchema(db);   // Spec H3b1: eBay-Stand (nur lesen), eigene Fotos`.

- [ ] **Step 4: `sync.cjs` erweitern** (sieben Stellen, alles andere unverändert)

1. Unter `const { LISTING_COLS, LISTING_ITEM_COLS } = require('./listings-schema.cjs');` (Zeile 10):

```js
const { EBAY_LISTING_COLS, LISTING_PHOTO_COLS } = require('./ebay-schema.cjs');
```

2. `SALES_STREAMS` (Zeile 255–265) nach dem `listing_items`-Eintrag, und `recentlyPushedSalesByTable` (Zeile 266) um `listing_photos: new Map()`:

```js
  // Spec H3b1 §6 -- eigene Fotos, dieselbe Bauart wie listings (beide Richtungen, lokal ungeschoben gewinnt).
  listing_photos: { cols: noStamps(LISTING_PHOTO_COLS), bools: new Set(['deleted']), key: ['photo_id'], cursor: 'sync_listing_photos', localWinsUnpushed: true },
```

3. Direkt vor `function getSetting(db, key) {` (Modulebene, damit testbar):

```js
// Spec H3b1 §5.1 -- NUR-LESE-Ströme: die Cloud (Funktion ebay-sync) schreibt, der PC zieht und schiebt NIE.
// Deshalb stehen sie bewusst NICHT in SALES_STREAMS (dort würde pushSalesTable sie hochladen). Die Zeilen werden
// wörtlich übernommen (auch die Zeitstempel als Cloud-Text) -- kein Push-Zeiger vergleicht sie.
const READ_ONLY_STREAMS = {
  ebay_listings: { cols: EBAY_LISTING_COLS, key: 'listing_id', cursor: 'sync_ebay_listings_last_pull' },
};
async function pullReadOnlyTable(c, db, table) {
  const s = READ_ONLY_STREAMS[table];
  const cursor = getSetting(db, s.cursor) || '1970-01-01T00:00:00Z';
  const put = db.prepare(`INSERT OR REPLACE INTO ${table} (${s.cols.join(',')}) VALUES (${s.cols.map((k) => '@' + k).join(',')})`);
  const PAGE = 1000; let applied = 0; let lastTs = null;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await c.from(table).select('*').gt('updated_at', cursor)
      .order('updated_at', { ascending: true }).order(s.key, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`Pull ${table} failed: ` + error.message);
    if (!data || data.length === 0) break;
    db.transaction(() => {
      for (const r of data) { put.run(Object.fromEntries(s.cols.map((k) => [k, r[k] ?? null]))); applied++; }
    })();
    lastTs = data[data.length - 1].updated_at;
    if (data.length < PAGE) break;
  }
  if (lastTs) setSetting(db, s.cursor, lastTs);
  return applied;
}
// Spec H3b1 §4.2 -- ebay_status (eine Zeile, ohne Tokens) als JSON in settings.ebay_status_cache. -> true, wenn geändert.
async function pullEbayStatus(c, db) {
  const { data, error } = await c.from('ebay_status').select('*').maybeSingle();
  if (error) throw new Error('Pull ebay_status failed: ' + error.message);
  const next = JSON.stringify(data ?? null);
  if (getSetting(db, 'ebay_status_cache') === next) return false;
  setSetting(db, 'ebay_status_cache', next);
  return true;
}
```

4. `LISTING_TABLES` (Zeile 639) → `['listings', 'listing_items', 'listing_photos']` (Fotos pullen/pushen wie Angebote, `listings-changed` feuert auch für Fotos). Direkt vor `// Spec G1 §4.12 — the daily cloud Edge Function`:

```js
  // Spec H3b1: eBay-Stand nur ziehen; fehlen die Cloud-Tabellen (ebay_schema.sql nicht eingespielt), laufen alle
  // anderen Ströme weiter. -> true, wenn sich etwas geändert hat (Renderer-Ereignis ebay-changed).
  async function pullEbaySafe(c) {
    let changed = false;
    try { changed = (await pullReadOnlyTable(c, db, 'ebay_listings')) > 0; } catch (e) { console.error('[sync] ebay_listings pull:', e.message); }
    try { changed = (await pullEbayStatus(c, db)) || changed; } catch (e) { console.error('[sync] ebay_status pull:', e.message); }
    return changed;
  }
```

5. In `cycle()` nach `await pushListingsSafe(c);` (Zeile 763): `const ebayChanged = await pullEbaySafe(c);` — nach dem Push, damit ein direkt folgender Anstoß die eigenen Änderungen schon in der Cloud findet. Nach der `listings-changed`-Zeile: `if (ebayChanged) { const w = getWindow(); if (w) w.webContents.send('ebay-changed'); }`.

6. Vor `return { ensureClient };` (Zeile 797), und die Rückgabe ersetzen:

```js
  // Spec H3b1 §5.4: „jetzt“ abgleichen (vor/nach dem Anstoß von ebay-sync) -- wartet einen laufenden Zyklus ab
  // und startet dann einen eigenen, damit lokale Änderungen sicher geschoben und der eBay-Stand gezogen ist.
  async function syncNow() {
    while (running) await new Promise((r) => setTimeout(r, 200));
    await cycle();
  }

  // Expose the authed client so other main-process features (deals) can use the same
  // signed-in Supabase session instead of a separate local store.
  return { ensureClient, syncNow };
```

7. Exporte nach `_recentlyPushedListingItems: recentlyPushedSalesByTable.listing_items,`:

```js
  listingPhotoToRemote: (r) => salesRowToRemote('listing_photos', r), remoteToLocalListingPhoto: (r) => remoteToLocalSalesRow('listing_photos', r),
  _applyPulledListingPhotos: (db, rows) => applyPulledSalesRows(db, 'listing_photos', rows),
  _recentlyPushedListingPhotos: recentlyPushedSalesByTable.listing_photos,
  // Spec H3b1: Test-Haken der Nur-Lese-Ströme (ebay-sync.test.cjs) und die Liste der geschobenen Tabellen (Wächter).
  _pullReadOnlyTable: pullReadOnlyTable, _pullEbayStatus: pullEbayStatus,
  _READ_ONLY_TABLES: Object.keys(READ_ONLY_STREAMS), _PUSHED_TABLES: Object.keys(SALES_STREAMS),
```

- [ ] **Step 5: `listing-photos.cjs` schreiben**

```js
// desktop/electron/listing-photos.cjs — Spec H3b1 §6: eigene Fotos je Angebot (höchstens 12), vor dem Hochladen auf
// höchstens 1600 px lange Seite verkleinert, JPEG unter 500 KB; eBay verlangt mindestens 500 px. Löschen ist weich.
// Rein bis auf die hereingereichten deps (Test: Fälschungen, nie Platte/Netz). Gegenstück am Handy: ml/PhotoScale.kt
// (gleiche Grenzen, gleiche Qualitätsstufen, gleicher Pfad) und cloud/EbayRepository.kt.
const path = require('path');

const MAX_PHOTOS = 12;
const MAX_EDGE = 1600;
const MIN_EDGE = 500;
const TARGET_BYTES = 500 * 1024;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const QUALITIES = [85, 75, 65, 55, 50];
const EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const BUCKET = 'listing-photos';

class PhotoError extends Error {}

function scaleSize(width, height, maxEdge = MAX_EDGE) {
  const m = Math.max(width, height);
  if (m <= maxEdge) return { width, height };
  const f = maxEdge / m;
  return { width: Math.max(1, Math.round(width * f)), height: Math.max(1, Math.round(height * f)) };
}
// Qualität stufenweise senken, bis das JPEG unter dem Ziel liegt; die letzte Stufe wird genommen, wie sie ist.
function encodeUnder(encode, target = TARGET_BYTES) {
  let last = null;
  for (const q of QUALITIES) { last = encode(q); if (last.length < target) return last; }
  return last;
}
const photoPath = (listingId, uuid) => `${listingId}/${uuid}.jpg`;
// Öffentliche Adresse -- dieselbe wie supabase/functions/_shared/ebay-map.ts#photoUrl und ml/PhotoScale.kt#publicUrl (hier zusätzlich ohne /rest/v1).
function publicPhotoUrl(baseUrl, p) {
  return `${String(baseUrl || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '')}/storage/v1/object/public/${BUCKET}/${p.split('/').map(encodeURIComponent).join('/')}`;
}

function livePhotos(db, listingId) {
  return db.prepare('SELECT * FROM listing_photos WHERE listing_id = ? AND deleted = 0 ORDER BY sort, photo_id').all(listingId);
}
function listPhotos(db, listingId, baseUrl) {
  return livePhotos(db, listingId).map((p) => ({ photo_id: p.photo_id, path: p.path, sort: p.sort, url: publicPhotoUrl(baseUrl, p.path) }));
}

// deps = { fileSize(file) -> Bytes, readFile(file) -> Buffer, decode(buf) -> { width, height, resize({width,height}) -> img,
//          toJPEG(q) -> Buffer } | null, upload(path, jpeg) -> Promise, uuid() -> string }
async function addPhoto(db, { listingId, filePath }, deps) {
  const l = db.prepare('SELECT listing_id FROM listings WHERE listing_id = ? AND deleted = 0').get(listingId);
  if (!l) throw new PhotoError('Angebot nicht gefunden.');
  if (livePhotos(db, listingId).length >= MAX_PHOTOS) throw new PhotoError(`Höchstens ${MAX_PHOTOS} eigene Fotos je Angebot.`);
  if (!EXTENSIONS.includes(path.extname(String(filePath || '')).toLowerCase())) throw new PhotoError('Nur JPG- oder PNG-Bilder.');
  if (deps.fileSize(filePath) > MAX_INPUT_BYTES) throw new PhotoError('Bild ist zu groß (höchstens 25 MB).');
  const img = deps.decode(deps.readFile(filePath));
  if (!img || !(img.width > 0) || !(img.height > 0)) throw new PhotoError('Bild konnte nicht gelesen werden.');
  if (Math.max(img.width, img.height) < MIN_EDGE) throw new PhotoError('Foto zu klein – mindestens 500 Pixel an der längeren Seite.');
  const scaled = img.resize(scaleSize(img.width, img.height));
  const jpeg = encodeUnder((q) => scaled.toJPEG(q));
  const photoId = deps.uuid();
  const p = photoPath(listingId, photoId);
  await deps.upload(p, jpeg);
  // Erst nach dem Hochladen die Zeile: ohne Datei gibt es kein Foto. Frisch zählen (ein zweites Fenster/Handy).
  db.transaction(() => {
    if (livePhotos(db, listingId).length >= MAX_PHOTOS) throw new PhotoError(`Höchstens ${MAX_PHOTOS} eigene Fotos je Angebot.`);
    const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM listing_photos WHERE listing_id = ? AND deleted = 0').get(listingId).s;
    db.prepare('INSERT INTO listing_photos (photo_id, listing_id, path, sort) VALUES (?, ?, ?, ?)').run(photoId, listingId, p, sort);
  })();
  return { photo_id: photoId, path: p, bytes: jpeg.length };
}

function deletePhoto(db, photoId) {
  const r = db.prepare('UPDATE listing_photos SET deleted = 1 WHERE photo_id = ? AND deleted = 0').run(photoId);
  if (r.changes === 0) throw new PhotoError('Foto nicht gefunden.');
}

// Neue Reihenfolge = genau die lebenden Fotos des Angebots; nur geänderte Zeilen werden gestempelt.
function reorderPhotos(db, listingId, photoIds) {
  db.transaction(() => {
    const live = livePhotos(db, listingId).map((p) => p.photo_id);
    const ids = Array.isArray(photoIds) ? photoIds : [];
    if (ids.length !== live.length || new Set(ids).size !== ids.length || ids.some((id) => !live.includes(id))) {
      throw new PhotoError('Fotos wurden inzwischen geändert – bitte neu öffnen.');
    }
    const upd = db.prepare('UPDATE listing_photos SET sort = ? WHERE photo_id = ? AND sort <> ?');
    ids.forEach((id, i) => upd.run(i, id, i));
  })();
}

module.exports = {
  PhotoError, MAX_PHOTOS, MAX_EDGE, MIN_EDGE, TARGET_BYTES, QUALITIES, scaleSize, encodeUnder, photoPath, publicPhotoUrl,
  listPhotos, addPhoto, deletePhoto, reorderPhotos,
};
```

- [ ] **Step 6: Handler in `main.cjs`**

Zeile 1: `nativeImage` in die Electron-Importe aufnehmen (`const { app, BrowserWindow, ipcMain, dialog, Notification, shell, nativeImage } = require('electron');`). Bei den `require`s: `const photos = require('./listing-photos.cjs');`.

`listingWrite` (Zeile 930–933) stößt nach Erfolg an:

```js
const listingWrite = (channel, fn) => (event, d) => {
    try { const r = { success: true, ...fn(d) }; kickEbay(); return r; }
    catch (e) { return { success: false, error: listingErrorMessage(e, channel) }; }
};
```

`sale-book` (Zeile 906–910): vor dem `return` die Zeile `kickEbay(); // Spec H3b1: Aufräumen kann eBay-Angebote verkleinern/beenden`.

Neuer Block direkt vor `// --- Other Handlers ---` (Zeile 971):

```js
// --- Spec H3b1: eBay (Verbinden, Einstellen, eigene Fotos) ---
// Alles eBay-Wissen liegt in den Edge Functions; hier nur Aufrufe, der Nur-Lese-Stand (sync.cjs) und Fotos (listing-photos.cjs).
const EBAY_AUTH_ACTIONS = ['start', 'check', 'select', 'create_location', 'set_environment', 'disconnect'];
const EBAY_OFFLINE = 'Cloud nicht verbunden — Supabase-Login in den Einstellungen prüfen.';
function ebayStatusCached() {
    try { return JSON.parse(getSetting('ebay_status_cache') || 'null'); } catch { return null; }
}
// Funktion aufrufen: erwartete Fehler kommen als { ok: false, error } mit Status 200, 401 als FunctionsHttpError.
async function invokeEbay(name, body) {
    const c = sync && await sync.ensureClient();
    if (!c) return { ok: false, error: EBAY_OFFLINE };
    const { data, error } = await c.functions.invoke(name, { body });
    if (!error) return data && typeof data === 'object' ? data : { ok: false, error: 'Unerwartete Antwort der eBay-Funktion.' };
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* Text behalten */ }
    return { ok: false, error: msg };
}
// Spec §5.4 (Abweichung 9): nach Angebots-/Foto-Änderungen anstoßen -- entprellt, nur wenn verbunden; erst schieben,
// dann ebay-sync, dann den neuen eBay-Stand ziehen. Fehler nur ins Protokoll (der Zeitplan holt es nach).
let ebayKickTimer = null;
function kickEbay() {
    if (!sync || !ebayStatusCached()?.connected) return;
    clearTimeout(ebayKickTimer);
    ebayKickTimer = setTimeout(async () => {
        try {
            await sync.syncNow();
            const r = await invokeEbay('ebay-sync', {});
            if (r?.ok === false) console.error('[ebay-kick]', r.error);
            await sync.syncNow();
        } catch (e) { console.error('[ebay-kick]', e.message); }
    }, 1500);
}
ipcMain.handle('ebay-status', () => ({ status: ebayStatusCached() }));
ipcMain.handle('ebay-listings', () => Object.fromEntries(db.prepare('SELECT * FROM ebay_listings').all().map((r) => [r.listing_id, r])));
ipcMain.handle('ebay-auth', async (event, d) => {
    const action = d?.action;
    if (!EBAY_AUTH_ACTIONS.includes(action)) return { ok: false, error: 'Unbekannte Aktion.' };
    try {
        const r = await invokeEbay('ebay-auth', { ...d, action });
        if (action === 'start') {
            if (!r?.ok) return r;
            // Nur eine https-Adresse an den Browser (Global Constraints: Links nur http(s), hier strenger https).
            if (!/^https:\/\//i.test(String(r.url || ''))) return { ok: false, error: 'Ungültige Adresse von eBay.' };
            await shell.openExternal(r.url);
            return { ok: true };
        }
        if (r?.ok && sync) await sync.syncNow(); // ebay_status frisch ziehen -> Einstellungen zeigen den neuen Stand
        return r;
    } catch (e) { console.error('[ebay-auth]', action, e.message); return { ok: false, error: 'eBay-Aufruf fehlgeschlagen.' }; }
});
ipcMain.handle('ebay-sync-now', async (event, d) => {
    try {
        if (sync) await sync.syncNow();
        const r = await invokeEbay('ebay-sync', d?.retry ? { retry: String(d.retry) } : {});
        if (sync) await sync.syncNow();
        return r;
    } catch (e) { console.error('[ebay-sync-now]', e.message); return { ok: false, error: 'eBay-Abgleich fehlgeschlagen.' }; }
});
// Spec §6: Fotos verkleinern mit nativeImage (Hauptprozess), hochladen in den Speicher der angemeldeten Sitzung.
function photoDeps(c) {
    return {
        fileSize: (f) => fs.statSync(f).size,
        readFile: (f) => fs.readFileSync(f),
        decode: (buf) => {
            const img = nativeImage.createFromBuffer(buf);
            if (img.isEmpty()) return null;
            const { width, height } = img.getSize();
            return { width, height, resize: (s) => { const r = img.resize({ ...s, quality: 'best' }); return { toJPEG: (q) => r.toJPEG(q) }; } };
        },
        upload: async (p, buf) => {
            const { error } = await c.storage.from('listing-photos').upload(p, buf, { contentType: 'image/jpeg', upsert: false });
            if (error) throw new photos.PhotoError(`Hochladen fehlgeschlagen: ${error.message}`);
        },
        uuid: () => require('crypto').randomUUID(),
    };
}
ipcMain.handle('listing-photos', (event, listingId) => {
    try { return photos.listPhotos(db, listingId, getSetting('supabase_url')); }
    catch (e) { console.error('[listing-photos]', e); throw new Error('Fotos konnten nicht geladen werden.'); }
});
ipcMain.handle('listing-photo-add', async (event, listingId) => {
    const c = sync && await sync.ensureClient();
    if (!c) return { success: false, added: 0, error: 'Fotos brauchen die Cloud – Supabase-Login in den Einstellungen prüfen.' };
    const pick = await dialog.showOpenDialog(mainWindow, { title: 'Fotos wählen', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Bilder', extensions: ['jpg', 'jpeg', 'png'] }] });
    if (pick.canceled || pick.filePaths.length === 0) return { success: true, added: 0 };
    let added = 0;
    for (const f of pick.filePaths) {
        try { await photos.addPhoto(db, { listingId, filePath: f }, photoDeps(c)); added++; }
        catch (e) {
            if (added > 0) kickEbay();
            if (!(e instanceof photos.PhotoError)) console.error('[listing-photo-add]', e);
            return { success: false, added, error: e instanceof photos.PhotoError ? e.message : 'Foto konnte nicht hinzugefügt werden.' };
        }
    }
    kickEbay();
    return { success: true, added };
});
const photoWrite = (channel, fn) => (event, d) => {
    try { fn(d); kickEbay(); return { success: true }; }
    catch (e) {
        if (e instanceof photos.PhotoError) return { success: false, error: e.message };
        console.error(`[${channel}]`, e);
        return { success: false, error: 'Speichern fehlgeschlagen.' };
    }
};
ipcMain.handle('listing-photo-delete', photoWrite('listing-photo-delete', (id) => photos.deletePhoto(db, id)));
ipcMain.handle('listing-photo-reorder', photoWrite('listing-photo-reorder', (d) => photos.reorderPhotos(db, d?.listing_id, d?.photoIds)));
```

`kickEbay` ist eine Funktionsdeklaration (gehoben); `listingWrite` ruft sie erst zur Laufzeit, wenn `ebayKickTimer` längst belegt ist.

- [ ] **Step 7: `preload.cjs`** (nach `onListingsChanged`, Zeile 127)

```js
  // Spec H3b1: eBay und eigene Fotos
  ebayStatus: () => ipcRenderer.invoke('ebay-status'),
  ebayListings: () => ipcRenderer.invoke('ebay-listings'),
  ebayAuth: (data) => ipcRenderer.invoke('ebay-auth', data),
  ebaySyncNow: (data) => ipcRenderer.invoke('ebay-sync-now', data),
  listingPhotos: (listingId) => ipcRenderer.invoke('listing-photos', listingId),
  addListingPhotos: (listingId) => ipcRenderer.invoke('listing-photo-add', listingId),
  deleteListingPhoto: (photoId) => ipcRenderer.invoke('listing-photo-delete', photoId),
  reorderListingPhotos: (data) => ipcRenderer.invoke('listing-photo-reorder', data),
  onEbayChanged: (cb) => { const s = (_e) => cb(); ipcRenderer.on('ebay-changed', s); return () => ipcRenderer.removeListener('ebay-changed', s); },
```

- [ ] **Step 8: Tests grün**

SQLite-Suite: bisher + 5 (`ebay-sync.test.cjs`) + 5 (`listing-photos.test.cjs`) + 8 Kanäle; `listings-sync.test.cjs` und `sales-sync.test.cjs` unverändert grün (vom Plan-Autor mit den Änderungen ausgeführt). `test-sync.cjs` PASS, exit 0.

- [ ] **Step 9: Schutz-Nachweise**

1. `ebay_listings` testweise in `SALES_STREAMS` eintragen (`ebay_listings: { cols: EBAY_LISTING_COLS, bools: new Set(), key: ['listing_id'], cursor: 'sync_ebay_listings' },`). „Wächter: Nur-Lese-Tabellen werden nie geschoben“ scheitert. Zurücknehmen.
2. `listing_photos` in `SALES_STREAMS` ohne `localWinsUnpushed: true`. „lokal ungeschoben gewinnt …“ scheitert (`sort 5, deleted 0`). Zurücknehmen.
3. `listing-photos.cjs#addPhoto`: die Zeile mit `MIN_EDGE` entfernen. „Prüfungen …“ scheitert (Upload ohne Fehler). Zurücknehmen.

- [ ] **Step 10: Commit**

```bash
git add desktop/electron/ebay-schema.cjs desktop/electron/listing-photos.cjs desktop/electron/listing-photos.test.cjs desktop/electron/ebay-sync.test.cjs desktop/electron/database.cjs desktop/electron/sync.cjs desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/ipc-channels.test.cjs
git commit -m "feat(h3b1): PC-Stroeme fuer eBay-Stand (nur lesen) und Fotos, IPC, Anstoss von ebay-sync

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: PC-Oberfläche — Einstellungen „eBay“, Marken, „Erneut versuchen“, Fotos

**Files:**
- Create: `desktop/src/utils/ebayMarks.js`, `desktop/src/utils/ebayMarks.test.js`, `docs/fixtures/ebay/marks.json`, `desktop/src/utils/useEbayData.js`, `desktop/src/components/EbaySettings.jsx`, `desktop/src/components/ListingPhotos.jsx`
- Modify: `desktop/src/components/Settings.jsx`, `desktop/src/components/ListingsList.jsx`, `desktop/src/components/ListingDetail.jsx`, `desktop/src/components/ListingDialog.jsx`

**Interfaces:**
- Consumes: `window.api.ebayStatus, ebayListings, ebayAuth, ebaySyncNow, listingPhotos, addListingPhotos, deleteListingPhoto, reorderListingPhotos, onEbayChanged, openListingUrl, saveListingImages` (Task 6), `createBusyGate`, `createLatestOnly`, `todayLocal`, `LOADING`, `imageUrls`.
- Produces (`ebayMarks.js`, Zwilling von `EbayMarks.kt`): `MAX_OWN_PHOTOS = 12`, `ebayMark(listing{channel_id,status,deleted}, row|null, status|null|undefined) -> { kind: 'laden'|'wartet'|'online'|'fehler'|'beendet'|'andere', text, url, retry } | null`, `setupItems(status) -> [{ label, ok }]`, `setupOk(status)`, `expiryText(status, today)`, `photoCountText(n)`.
- Produces (`useEbayData.js`): `useEbayData() -> { status (undefined = lädt, null = kein Stand), rows: { [listing_id]: row }, reload }`, lädt beim Einhängen, bei `ebay-changed` und beim Fenster-Ereignis `listings-dirty`.
- Produces: `<EbaySettings />`, `<ListingPhotos listingId onChanged={(photos) => void} />`, `<EbayMark mark onRetry busy />` (in `ListingDetail.jsx` exportiert wie `ListingMarks`).

- [ ] **Step 1: Fixture und Zwilling mit Test**

`docs/fixtures/ebay/marks.json` (wörtlich; Werte mit `ebayMarks.js` erzeugt und nachgeprüft, z. B. Ablauf 23.03.2028: vom 22.02.2028 sind es 7 + 23 = 30 Tage → Hinweis, vom 21.02. 31 Tage → keiner):

```json
{
  "_comment": "Spec H3b §4.4/§5.4 -- gemeinsame Fixture fuer desktop/src/utils/ebayMarks.js und android ml/EbayMarks.kt. status: \"U\" = laedt (undefined/Kotlin Loading), \"N\" = kein Stand (null), \"S\" = status unten.",
  "status": {
    "environment": "sandbox",
    "connected": true,
    "refresh_expires_at": "2028-03-23T00:00:00Z",
    "has_payment_policy": true,
    "payment_policy_name": "PayPal",
    "has_fulfillment_policy": true,
    "fulfillment_policy_name": "Brief",
    "has_return_policy": false,
    "return_policy_name": null,
    "has_location": true,
    "location_key": "ygo-default"
  },
  "marks": [
    {"name":"kein eBay-Angebot","listing":{"channel_id":"cardmarket","status":"aktiv","deleted":false},"row":{"listing_id":"l1","environment":"sandbox","state":"online","item_url":"https://sandbox.ebay.de/itm/I2","error":null},"status":"S","mark":null},
    {"name":"Stand lädt","listing":{"channel_id":"ebay","status":"aktiv","deleted":false},"row":null,"status":"U","mark":{"kind":"laden","text":"…","url":null,"retry":false}},
    {"name":"kein Stand (Tabellen fehlen), aktiv","listing":{"channel_id":"ebay","status":"aktiv","deleted":false},"row":null,"status":"N","mark":{"kind":"wartet","text":"wartet auf eBay","url":null,"retry":false}},
    {"name":"kein Stand, beendet","listing":{"channel_id":"ebay","status":"beendet","deleted":false},"row":null,"status":"N","mark":null},
    {"name":"keine Zeile, aktiv","listing":{"channel_id":"ebay","status":"aktiv","deleted":false},"row":null,"status":"S","mark":{"kind":"wartet","text":"wartet auf eBay","url":null,"retry":false}},
    {"name":"keine Zeile, beendet","listing":{"channel_id":"ebay","status":"beendet","deleted":false},"row":null,"status":"S","mark":null},
    {"name":"online mit Link","listing":{"channel_id":"ebay","status":"aktiv","deleted":false},"row":{"listing_id":"l1","environment":"sandbox","state":"online","item_url":"https://sandbox.ebay.de/itm/I2","error":null},"status":"S","mark":{"kind":"online","text":"auf eBay online","url":"https://sandbox.ebay.de/itm/I2","retry":false}},
    {"name":"online, Link nicht https","listing":{"channel_id":"ebay","status":"aktiv","deleted":false},"row":{"listing_id":"l1","environment":"sandbox","state":"online","item_url":"http://x/itm/1","error":null},"status":"S","mark":{"kind":"online","text":"auf eBay online","url":null,"retry":false}},
    {"name":"Fehler, aktiv -> Erneut versuchen","listing":{"channel_id":"ebay","status":"aktiv","deleted":false},"row":{"listing_id":"l1","environment":"sandbox","state":"fehler","item_url":"https://sandbox.ebay.de/itm/I2","error":"Das Merkmal Spiel fehlt."},"status":"S","mark":{"kind":"fehler","text":"eBay-Fehler: Das Merkmal Spiel fehlt.","url":"https://sandbox.ebay.de/itm/I2","retry":true}},
    {"name":"Fehler, beendet -> kein Erneut versuchen","listing":{"channel_id":"ebay","status":"beendet","deleted":false},"row":{"listing_id":"l1","environment":"sandbox","state":"fehler","item_url":null,"error":null},"status":"S","mark":{"kind":"fehler","text":"eBay-Fehler: unbekannt","url":null,"retry":false}},
    {"name":"wartet","listing":{"channel_id":"ebay","status":"aktiv","deleted":false},"row":{"listing_id":"l1","environment":"sandbox","state":"wartet","item_url":null,"error":null},"status":"S","mark":{"kind":"wartet","text":"wartet auf eBay","url":null,"retry":false}},
    {"name":"beendet","listing":{"channel_id":"ebay","status":"beendet","deleted":false},"row":{"listing_id":"l1","environment":"sandbox","state":"beendet","item_url":"https://sandbox.ebay.de/itm/I2","error":null},"status":"S","mark":{"kind":"beendet","text":"auf eBay beendet","url":null,"retry":false}},
    {"name":"andere Umgebung, aktiv -> wartet","listing":{"channel_id":"ebay","status":"aktiv","deleted":false},"row":{"listing_id":"l1","environment":"production","state":"online","item_url":"https://sandbox.ebay.de/itm/I2","error":null},"status":"S","mark":{"kind":"wartet","text":"wartet auf eBay","url":null,"retry":false}},
    {"name":"andere Umgebung, beendet","listing":{"channel_id":"ebay","status":"beendet","deleted":false},"row":{"listing_id":"l1","environment":"production","state":"online","item_url":"https://sandbox.ebay.de/itm/I2","error":null},"status":"S","mark":{"kind":"andere","text":"auf eBay beendet (andere Umgebung)","url":null,"retry":false}},
    {"name":"gelöscht","listing":{"channel_id":"ebay","status":"aktiv","deleted":true},"row":{"listing_id":"l1","environment":"sandbox","state":"wartet","item_url":"https://sandbox.ebay.de/itm/I2","error":null},"status":"S","mark":null}
  ],
  "setup": [
    {"status":"S","items":[{"label":"Mit eBay verbunden","ok":true},{"label":"Zahlungsrichtlinie: PayPal","ok":true},{"label":"Versandrichtlinie: Brief","ok":true},{"label":"Rücknahmerichtlinie","ok":false},{"label":"Artikelstandort: ygo-default","ok":true}],"ok":false},
    {"status":"N","items":[{"label":"Mit eBay verbunden","ok":false},{"label":"Zahlungsrichtlinie","ok":false},{"label":"Versandrichtlinie","ok":false},{"label":"Rücknahmerichtlinie","ok":false},{"label":"Artikelstandort","ok":false}],"ok":false}
  ],
  "expiry": [
    {"today":"2028-02-22","text":"Verbindung läuft am 23.03.2028 ab – bitte neu verbinden."},
    {"today":"2028-02-21","text":null},
    {"today":"2028-03-23","text":"Verbindung läuft am 23.03.2028 ab – bitte neu verbinden."},
    {"today":"2028-02-22","disconnected":true,"text":null}
  ],
  "photoCount": [
    {"n":0,"text":"0/12 Fotos"},
    {"n":12,"text":"12/12 Fotos"}
  ]
}
```

`desktop/src/utils/ebayMarks.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from './ebayMarks.js';

// ZWILLING: android EbayMarksTest.kt liest dieselbe Fixture.
const F = JSON.parse(readFileSync(new URL('../../../docs/fixtures/ebay/marks.json', import.meta.url), 'utf8'));
const statusOf = (k) => (k === 'U' ? undefined : k === 'N' ? null : F.status);

test('Marken aller Fixture-Fälle', () => {
  for (const c of F.marks) assert.deepEqual(E.ebayMark(c.listing, c.row, statusOf(c.status)), c.mark, c.name);
});
test('Check-Liste', () => {
  for (const c of F.setup) {
    assert.deepEqual(E.setupItems(statusOf(c.status)), c.items);
    assert.equal(E.setupOk(statusOf(c.status)), c.ok);
  }
});
test('Ablauf-Hinweis 30 Tage vorher', () => {
  for (const c of F.expiry) {
    const s = c.disconnected ? { ...F.status, connected: false } : F.status;
    assert.equal(E.expiryText(s, c.today), c.text, c.today);
  }
});
test('Fotozähler', () => {
  for (const c of F.photoCount) assert.equal(E.photoCountText(c.n), c.text);
});
```

Fehlschlag bestätigen (`Cannot find module './ebayMarks.js'`), dann `desktop/src/utils/ebayMarks.js`:

```js
// desktop/src/utils/ebayMarks.js
// Spec H3b §4.4/§5.4 -- eBay-Marken und Einrichtungs-Check-Liste für die Anzeige. ZWILLING:
// android/app/src/main/java/com/example/yugiohscanner/ml/EbayMarks.kt. Gemeinsame Fixture: docs/fixtures/ebay/marks.json.
// Wer eine Fassung ändert, ändert beide. status: undefined = lädt, null = kein Stand (Tabellen fehlen/nie verbunden).

export const MAX_OWN_PHOTOS = 12;
const WAITING = { kind: 'wartet', text: 'wartet auf eBay', url: null, retry: false };

const isActive = (l) => l.status === 'aktiv' && !l.deleted;
const webUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim() : null);

export function ebayMark(listing, row, status) {
  if (!listing || listing.channel_id !== 'ebay') return null;
  if (status === undefined) return { kind: 'laden', text: '…', url: null, retry: false };
  const active = isActive(listing);
  if (!status || !row) return active ? WAITING : null;
  if (row.environment !== status.environment) {
    return active ? WAITING : { kind: 'andere', text: 'auf eBay beendet (andere Umgebung)', url: null, retry: false };
  }
  if (row.state === 'online') return { kind: 'online', text: 'auf eBay online', url: webUrl(row.item_url), retry: false };
  if (row.state === 'fehler') {
    return { kind: 'fehler', text: `eBay-Fehler: ${row.error || 'unbekannt'}`, url: webUrl(row.item_url), retry: active };
  }
  if (row.state === 'beendet') return { kind: 'beendet', text: 'auf eBay beendet', url: null, retry: false };
  return active ? WAITING : null;
}

export function setupItems(status) {
  const s = status || {};
  const named = (label, ok, name) => ({ label: ok && name ? `${label}: ${name}` : label, ok: !!ok });
  return [
    { label: 'Mit eBay verbunden', ok: !!s.connected },
    named('Zahlungsrichtlinie', s.has_payment_policy, s.payment_policy_name),
    named('Versandrichtlinie', s.has_fulfillment_policy, s.fulfillment_policy_name),
    named('Rücknahmerichtlinie', s.has_return_policy, s.return_policy_name),
    named('Artikelstandort', s.has_location, s.location_key),
  ];
}
export const setupOk = (status) => setupItems(status).every((i) => i.ok);

// Spec §4.3: 30 Tage vor Ablauf des Refresh-Tokens ein Hinweis. today = 'YYYY-MM-DD' (lokal).
export function expiryText(status, today) {
  if (!status || !status.connected || !status.refresh_expires_at) return null;
  const day = String(status.refresh_expires_at).slice(0, 10);
  const utc = (s) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const days = Math.round((utc(day) - utc(today)) / 86400000);
  if (days > 30) return null;
  return `Verbindung läuft am ${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)} ab – bitte neu verbinden.`;
}

export const photoCountText = (n) => `${n}/${MAX_OWN_PHOTOS} Fotos`;
```

Helfer grün (+4).

- [ ] **Step 2: `useEbayData.js`**

```js
import { useState, useEffect, useCallback, useRef } from 'react';
import { createLatestOnly } from './busyGate.js';

// Spec H3b1 §5.4 -- eBay-Stand (Zwischenspeicher der Ansicht ebay_status) und eBay-Zeilen je Angebot.
// status: undefined = lädt ("…"), null = kein Stand (Tabellen fehlen / nie gezogen). Die zuletzt gestartete Abfrage gewinnt.
export function useEbayData() {
  const [state, setState] = useState(() => ({ status: undefined, rows: {} }));
  const latest = useRef(createLatestOnly());
  const reload = useCallback(() => {
    const token = latest.current.start();
    if (!window.api?.ebayStatus) return Promise.resolve().then(() => setState({ status: null, rows: {} }));
    return Promise.all([window.api.ebayStatus(), window.api.ebayListings()])
      .then(([s, rows]) => { if (latest.current.isCurrent(token)) setState({ status: s?.status ?? null, rows: rows || {} }); })
      .catch(() => { if (latest.current.isCurrent(token)) setState((x) => ({ status: x.status === undefined ? null : x.status, rows: x.rows })); });
  }, []);
  useEffect(() => {
    const seq = latest.current;
    reload();
    const onDirty = () => { reload(); };
    const off = window.api?.onEbayChanged?.(onDirty);
    window.addEventListener('listings-dirty', onDirty);
    return () => { seq.start(); off?.(); window.removeEventListener('listings-dirty', onDirty); };
  }, [reload]);
  return { status: state.status, rows: state.rows, reload };
}
```

- [ ] **Step 3: `EbaySettings.jsx` und Abschnitt in `Settings.jsx`**

`Settings.jsx`: in `SECTIONS` nach `preise` den Eintrag `{ id: 'ebay', label: 'eBay' }`; im Inhalt nach dem `preise`-Block `{active === 'ebay' && <EbaySettings />}`; Import `import EbaySettings from './EbaySettings';`.

`EbaySettings.jsx` (Karte wie `Settings.jsx:254-302`, Klassen wie dort; Zustand über `useEbayData`, Schreibaktionen durch `createBusyGate()`, `busy`/`error`/`notice` wie `ListingDetail.jsx`). Gerüst wörtlich, Markup nach der Beschreibung:

```jsx
import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { createBusyGate } from '../utils/busyGate';
import { todayLocal } from '../utils/today';
import { useEbayData } from '../utils/useEbayData';
import { setupItems, expiryText } from '../utils/ebayMarks';

const KIND_LABEL = { payment: 'Zahlungsrichtlinie', fulfillment: 'Versandrichtlinie', return: 'Rücknahmerichtlinie', location: 'Artikelstandort' };
const SELECT_FIELD = { payment: 'payment_policy_id', fulfillment: 'fulfillment_policy_id', return: 'return_policy_id', location: 'location_key' };

// Spec H3b §4.4 -- Abschnitt „eBay“: Umgebung, Verbinden/Trennen, Check-Liste, Richtlinien-Auswahl, Standort anlegen,
// „Jetzt abgleichen“, letzter Lauf/Fehler. Alles eBay-Wissen liegt in ebay-auth/ebay-sync (Task 4/5).
export default function EbaySettings() {
  const { status } = useEbayData();
  const [gate] = useState(createBusyGate);
  const [today] = useState(() => todayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [check, setCheck] = useState(null); // letzte Antwort von check/select/create_location
  const [loc, setLoc] = useState({ postal_code: '', city: '' });

  const run = (fn) => gate.run(async () => {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); } catch (e) { setError(e?.message || 'eBay-Aufruf fehlgeschlagen.'); } finally { setBusy(false); }
  });
  const auth = (data, after) => run(async () => {
    const r = await window.api.ebayAuth(data);
    if (!r?.ok) { setError(r?.error || 'eBay-Aufruf fehlgeschlagen.'); return; }
    if (r.payment) setCheck(r);
    after?.(r);
  });
  const connect = () => auth({ action: 'start' }, () => setNotice('Browser geöffnet – nach dem Bestätigen hier „Prüfen“ drücken.'));
  const disconnect = () => { if (window.confirm('eBay trennen? Neue eBay-Angebote warten dann.')) auth({ action: 'disconnect' }, () => setCheck(null)); };
  const switchEnv = (env) => {
    if (!window.confirm('Umgebung wechseln trennt die Verbindung und leert die Einrichtung. Fortfahren?')) return;
    auth({ action: 'set_environment', environment: env }, () => setCheck(null));
  };
  const select = (kind, id) => auth({ action: 'select', [SELECT_FIELD[kind]]: id });
  const createLocation = () => auth({ action: 'create_location', ...loc }, () => setLoc({ postal_code: '', city: '' }));
  const syncNow = () => run(async () => {
    const r = await window.api.ebaySyncNow({});
    if (!r?.ok) { setError(r?.error || 'eBay-Abgleich fehlgeschlagen.'); return; }
    setNotice(r.busy ? 'Abgleich läuft schon.' : `Abgleich fertig: ${r.text}`);
  });
  // … Markup (siehe unten)
}
```

Markup (Reihenfolge):
1. Kopf mit Icon `ShoppingBag`, Titel „eBay“.
2. `status === undefined` → nur „…“. `status === null` → „eBay-Stand nicht geladen – Cloud-Sync aktiv? ebay_schema.sql eingespielt?“ (Fehlerfarbe) und kein weiterer Inhalt außer „Jetzt abgleichen“ gesperrt.
3. Umgebung: zwei Knöpfe „Sandbox“ / „Produktion“ (aktive hervorgehoben, `switchEnv` nur für die andere).
4. Verbindung: `status.connected` → „Verbunden seit TT.MM.JJJJ“ (aus `connected_at`, `slice(0,10)` umgestellt) + „Trennen“; sonst „Verbinden“ (`connect`). `expiryText(status, today)` → gelber Hinweis.
5. Check-Liste: `setupItems(status)` als Zeilen mit „✓“ (grün) / „✗“ (rot). Knopf „Prüfen“ (`auth({ action: 'check' })`), gesperrt ohne Verbindung. Nach einer Antwort (`check`): `check.programOk === false` → Hinweis „Geschäftsrichtlinien sind im eBay-Konto nicht aktiviert.“; je Art mit `options.length > 1` ein `<select>` (Wert `selected ?? ''`, erste Option „— wählen —“, `onChange` → `select(kind, value)`); je Art mit `options.length === 0` außer `location` der Text „Keine {KIND_LABEL} bei eBay – bitte im Verkäuferkonto anlegen.“ mit Knopf „Seite öffnen“ (`window.api.openListingUrl(check.policyPage)`, nur wenn `policyPage`).
6. Standort anlegen (sichtbar, wenn verbunden und `!status.has_location`): Felder „PLZ“ (5 Ziffern, `inputMode="numeric"`) und „Ort“, Knopf „Standort anlegen“ (`createLocation`).
7. „Jetzt abgleichen“ (`syncNow`), gesperrt solange `busy`; darunter „Letzter Abgleich: TT.MM.JJJJ HH:MM – {last_run_summary}“ (Zeit mit `new Date(status.last_run_at).toLocaleString('de-DE')` im Render ist erlaubt — keine Uhrzeit von „jetzt“) und `last_error` in Fehlerfarbe.
8. `notice` grün, `error` rot. Hinweis-Text: „Solange der Check nicht vollständig ist, bleiben eBay-Angebote auf „wartet“.“

- [ ] **Step 4: Marken in Übersicht und Detail, „Erneut versuchen“**

`ListingDetail.jsx`: neue benannte Ausfuhr

```jsx
// Spec H3b §5.4 -- eBay-Marke (Liste und Detail). mark aus ebayMarks.js#ebayMark; onRetry nur im Detail.
export function EbayMark({ mark, onRetry, busy }) {
  if (!mark) return null;
  const chip = 'inline-block text-[10px] px-1.5 py-0.5 rounded';
  const color = mark.kind === 'online' ? 'bg-emerald-500/15 text-emerald-400' : mark.kind === 'fehler' ? 'bg-crit/20 text-crit' : 'bg-gold/15 text-gold';
  return (
    <>
      <span className={`${chip} ${color}`}>{mark.text}</span>
      {mark.retry && onRetry && (
        <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); onRetry(); }}
          className="text-[10px] px-1.5 py-0.5 rounded border border-crit/40 text-crit disabled:opacity-50">Erneut versuchen</button>
      )}
    </>
  );
}
```

`ListingsList.jsx`: `const ebay = useEbayData();` oben; in der Zeile nach `<ListingMarks marks={l.marks} />` → `<EbayMark mark={ebayMark(l, ebay.rows[l.listing_id] ?? null, ebay.status)} />` (ohne `onRetry`).

`ListingDetail.jsx`: `const ebay = useEbayData();`; `const mark = listing ? ebayMark(listing, ebay.rows[listing.listing_id] ?? null, ebay.status) : null;` Im Kopf unter den `ListingMarks`: `<EbayMark mark={mark} busy={busy} onRetry={retryEbay} />` und, wenn `mark?.url`, ein Knopf „Auf eBay ansehen“ (`openUrl(mark.url)`). `retryEbay = () => write(async () => { const r = await window.api.ebaySyncNow({ retry: listing.listing_id }); if (!r?.ok) { setError(r?.error || 'eBay-Abgleich fehlgeschlagen.'); return; } setNotice(r.busy ? 'Abgleich läuft schon – gleich noch einmal versuchen.' : 'eBay-Abgleich angestoßen.'); await ebay.reload(); }, 'eBay-Abgleich fehlgeschlagen.')`.

- [ ] **Step 5: Fotos (`ListingPhotos.jsx`) im Detail; eigene Fotos in „Bilder“**

`ListingPhotos.jsx`: Props `listingId`, `onChanged(photos)`. Lädt `window.api.listingPhotos(listingId)` beim Einhängen, bei `onListingsChanged` und nach jeder eigenen Aktion (latest-only wie `ListingDetail.load`); `photos === null` → „…“. Zeigt Vorschaubilder (`<img src={p.url}>`, 64 px) in Reihenfolge mit „←“ / „→“ (tauscht mit dem Nachbarn und ruft `reorderListingPhotos({ listing_id, photoIds })` mit der **vollen** neuen Reihenfolge) und „✕“ (`window.confirm('Foto entfernen?')` → `deleteListingPhoto`). Kopfzeile `photoCountText(photos.length)` und Knopf „Fotos hinzufügen“ (gesperrt bei `photos.length >= MAX_OWN_PHOTOS` oder `busy`), der `addListingPhotos(listingId)` ruft; Antwort `{ added, error }` → `error` anzeigen, bei `added > 0` neu laden. Alle Aktionen durch `createBusyGate()`. Nach jedem Neuladen `onChanged?.(photos)`.

`ListingDetail.jsx`: `ListingPhotos` unter den Positionen (für **alle** Kanäle, Spec §6), `const [photoUrls, setPhotoUrls] = useState([]);` über `onChanged={(ps) => setPhotoUrls(ps.map((p) => p.url))}`; in `saveImages` `urls: [...photoUrls, ...imageUrls(items)]`; den Hinweis „Käufer erwarten oft eigene Fotos.“ (Zeile 248) ersetzen durch „Eigene Fotos gehen vor dem Katalogbild zu eBay und in „Bilder“.“.

`ListingDialog.jsx`: den Hinweis (Zeile 199) ersetzen durch „Eigene Fotos fügst du nach dem Speichern im Angebot hinzu.“ (Abweichung 8). Ist `form.channel_id === 'ebay'` und `useEbayData().status` nicht `setupOk`, darunter „eBay ist noch nicht eingerichtet – das Angebot wartet, bis der Check in den Einstellungen vollständig ist.“ (`status === undefined` → nichts anzeigen).

- [ ] **Step 6: Prüfen**

Helfer (+4), Lint genau 5 Fehler, `npx vite build` grün. Im Fenster geklickt wird erst in der Abnahme (Task 11).

- [ ] **Step 7: Schutz-Nachweis**

`ebayMarks.js#ebayMark`: `if (status === undefined) return { kind: 'laden', … }` entfernen. „Marken aller Fixture-Fälle“ scheitert bei „Stand lädt“ (Platzhalter sähe wie „wartet“ aus). Zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add desktop/src/utils/ebayMarks.js desktop/src/utils/ebayMarks.test.js docs/fixtures/ebay/marks.json desktop/src/utils/useEbayData.js desktop/src/components/EbaySettings.jsx desktop/src/components/ListingPhotos.jsx desktop/src/components/Settings.jsx desktop/src/components/ListingsList.jsx desktop/src/components/ListingDetail.jsx desktop/src/components/ListingDialog.jsx
git commit -m "feat(h3b1): PC eBay-Einstellungen, Marken mit Erneut versuchen, eigene Fotos am Angebot

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Handy — Daten (eBay-Stand, eBay-Zeilen, Fotos, Funktionsaufrufe, Anstoß)

**Files:**
- Create: `android/.../ml/EbayMarks.kt`, `android/.../ml/PhotoScale.kt`, `android/.../cloud/EbayRepository.kt`
- Create (Tests): `android/app/src/test/java/com/example/yugiohscanner/EbayMarksTest.kt`, `EbayRepositoryTest.kt`
- Modify: `android/.../cloud/SideStores.kt`, `android/.../cloud/ListingsRepository.kt`

**Interfaces:**
- Consumes: `docs/fixtures/ebay/marks.json` (Task 7), Tabellen/Funktionen aus Task 3–5, `SupabaseCloud.http/base/key/token/signIn`, `KeysetPager`, `Keyset.after`, `StoreQueries.PAGE`, `SalesRepository.dbErrorMessage`.
- Produces (`EbayMarks`, Zwilling von `ebayMarks.js`): `Mark`, `ListingHead`, `Row`, `Status`, `StatusState { Loading, None, Known(status) }`, `SetupItem`, `mark(head, row, state)`, `setupItems(status)`, `setupOk(status)`, `expiryText(status, today)`, `photoCountText(n)`, `webUrl(u)`.
- Produces (`PhotoScale`): `MAX_PHOTOS, MAX_EDGE, MIN_EDGE, TARGET_BYTES, QUALITIES, BUCKET, TOO_SMALL, TOO_MANY`, `scaleSize(w, h)`, `sampleSize(w, h)`, `encodeUnder(encode)`, `rotationForExif(o)`, `photoPath(listingId, uuid)`, `publicUrl(base, path)`.
- Produces (`EbayRepository`): `EbayListingRow(listingId, environment, state, itemUrl, error, publishedQty).row()`, `ListingPhoto(photoId, listingId, path, sort, deleted)`, `RunInfo(lastRunAt, summary, lastError)`, `loadStatus(): Pair<Status, RunInfo>?`, `loadRows(): Map<String, EbayListingRow>`, `loadPhotos(): List<ListingPhoto>`, `photosOf(all, listingId)`, `invoke(name, body): JSONObject`, `auth(action, extra)`, `syncNow(retryListingId?)`, `kick()`, `addPhoto(listingId, jpeg, nextSort)`, `deletePhoto(photoId)`, `reorder(current, orderedIds)`; intern testbar `parseStatus, parseRunInfo, parseRows, parsePhotos, rowsPageParams, photosPageParams, reorderPatches, photoInsertBody`.
- Produces (`SideStores`): `ebayStatus: ListCache<List<Pair<EbayMarks.Status, EbayRepository.RunInfo>>>` (0 oder 1 Element, weil `ListCache` `null` für „nie geladen“ braucht — Muster `priceAlertMoveRule`), `ebayRows: ListCache<Map<String, EbayListingRow>>`, `listingPhotos: ListCache<List<ListingPhoto>>`; alle drei in `clearAll()`.

- [ ] **Step 1: Failing Tests**

`EbayMarksTest.kt` (Zwilling von `ebayMarks.test.js`):

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.DeckFixtureWorld.Companion.objects
import com.example.yugiohscanner.ml.EbayMarks
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/** ZWILLING von desktop/src/utils/ebayMarks.test.js -- dieselbe Fixture docs/fixtures/ebay/marks.json. */
class EbayMarksTest {
    private val fix = JSONObject(Fixtures.text("docs/fixtures/ebay/marks.json"))
    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)
    private fun status(o: JSONObject) = EbayMarks.Status(
        o.getString("environment"), o.getBoolean("connected"), str(o, "refresh_expires_at"),
        o.getBoolean("has_payment_policy"), str(o, "payment_policy_name"),
        o.getBoolean("has_fulfillment_policy"), str(o, "fulfillment_policy_name"),
        o.getBoolean("has_return_policy"), str(o, "return_policy_name"),
        o.getBoolean("has_location"), str(o, "location_key"),
    )
    private val known = status(fix.getJSONObject("status"))
    private fun state(k: String): EbayMarks.StatusState = when (k) {
        "U" -> EbayMarks.StatusState.Loading
        "N" -> EbayMarks.StatusState.None
        else -> EbayMarks.StatusState.Known(known)
    }
    private fun markOf(o: JSONObject?): EbayMarks.Mark? =
        o?.let { EbayMarks.Mark(it.getString("kind"), it.getString("text"), str(it, "url"), it.getBoolean("retry")) }

    @Test fun `Marken aller Fixture-Faelle`() {
        for (c in fix.getJSONArray("marks").objects()) {
            val l = c.getJSONObject("listing")
            val head = EbayMarks.ListingHead(l.getString("channel_id"), l.getString("status"), l.getBoolean("deleted"))
            val row = if (c.isNull("row")) null else c.getJSONObject("row").let {
                EbayMarks.Row(it.getString("environment"), it.getString("state"), str(it, "item_url"), str(it, "error"))
            }
            val want = if (c.isNull("mark")) null else markOf(c.getJSONObject("mark"))
            assertEquals(c.getString("name"), want, EbayMarks.mark(head, row, state(c.getString("status"))))
        }
    }
    @Test fun `Check-Liste`() {
        for (c in fix.getJSONArray("setup").objects()) {
            val s = if (c.getString("status") == "S") known else null
            val want = c.getJSONArray("items").objects().map { EbayMarks.SetupItem(it.getString("label"), it.getBoolean("ok")) }
            assertEquals(want, EbayMarks.setupItems(s))
            assertEquals(c.getBoolean("ok"), EbayMarks.setupOk(s))
        }
    }
    @Test fun `Ablauf-Hinweis 30 Tage vorher`() {
        for (c in fix.getJSONArray("expiry").objects()) {
            val s = if (c.optBoolean("disconnected", false)) known.copy(connected = false) else known
            assertEquals(c.getString("today"), str(c, "text"), EbayMarks.expiryText(s, c.getString("today")))
        }
    }
    @Test fun `Fotozaehler`() {
        for (c in fix.getJSONArray("photoCount").objects()) assertEquals(c.getString("text"), EbayMarks.photoCountText(c.getInt("n")))
    }
}
```

`EbayRepositoryTest.kt`:

```kotlin
package com.example.yugiohscanner

import com.example.yugiohscanner.cloud.EbayRepository
import com.example.yugiohscanner.cloud.ListingPhoto
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.PhotoScale
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class EbayRepositoryTest {
    @Test fun `Stand lesen -- ohne Zeile null, ohne Tokens`() {
        assertNull(EbayRepository.parseStatus("[]"))
        val s = EbayRepository.parseStatus("""[{"environment":"sandbox","connected":true,"refresh_expires_at":"2028-03-23T00:00:00+00:00","has_payment_policy":true,"payment_policy_name":"PayPal","has_fulfillment_policy":false,"fulfillment_policy_name":null,"has_return_policy":true,"return_policy_name":"Keine","has_location":true,"location_key":"ygo-default","last_run_at":"2026-09-22T12:00:00+00:00","last_run_summary":"1 eingestellt","last_error":null}]""")!!
        assertEquals(listOf("sandbox", "PayPal", "ygo-default"), listOf(s.environment, s.paymentPolicyName, s.locationKey))
        assertEquals(false, s.hasFulfillmentPolicy)
        val r = EbayRepository.parseRunInfo("""[{"environment":"sandbox","last_run_at":"x","last_run_summary":"1 eingestellt","last_error":null}]""")!!
        assertEquals(listOf("x", "1 eingestellt", null), listOf(r.lastRunAt, r.summary, r.lastError))
    }
    @Test fun `eBay-Zeilen und Fotos blaettern ueber 1000 per Schluessel`() = runBlocking {
        assertEquals("or" to "(listing_id.gt.\"l9\")", EbayRepository.rowsPageParams("l9").last())
        assertEquals("deleted" to "eq.false", EbayRepository.photosPageParams(null)[1])
        val all = (1..1500).map { "p%05d".format(it) }
        var pages = 0
        val got = KeysetPager.all(1000) { after: String? ->
            pages++
            EbayRepository.photosPageParams(after)
            val from = if (after == null) 0 else all.indexOf(after) + 1
            all.subList(from, minOf(from + 1000, all.size))
        }
        assertEquals(listOf(1500, 2), listOf(got.size, pages))
    }
    @Test fun `Zeilen lesen -- Menge null oder Zahl`() {
        val r = EbayRepository.parseRows("""[{"listing_id":"l1","environment":"sandbox","state":"online","item_url":"https://sandbox.ebay.de/itm/I2","error":null,"published_qty":2},{"listing_id":"l2","environment":"sandbox","state":"wartet","item_url":null,"error":null,"published_qty":null}]""")
        assertEquals(listOf(2, null), r.map { it.publishedQty })
        assertEquals("online", r[0].row().state)
    }
    private fun ph(id: String, sort: Int, deleted: Boolean = false) = ListingPhoto(id, "l1", "l1/$id.jpg", sort, deleted)
    @Test fun `Fotos je Angebot sortiert, Reihenfolge nur geaenderte, fremde Menge abgelehnt`() {
        val cur = listOf(ph("b", 1), ph("a", 0), ph("c", 2), ph("x", 0, deleted = true))
        assertEquals(listOf("a", "b", "c"), EbayRepository.photosOf(cur, "l1").map { it.photoId })
        val live = EbayRepository.photosOf(cur, "l1")
        assertEquals(listOf("c" to 0, "a" to 2), EbayRepository.reorderPatches(live, listOf("c", "b", "a")))
        assertThrows(IllegalArgumentException::class.java) { EbayRepository.reorderPatches(live, listOf("c", "b")) }
        val body = JSONObject(EbayRepository.photoInsertBody("u1", "l1", "l1/u1.jpg", 3))
        assertEquals(listOf("u1", "l1", "l1/u1.jpg", 3), listOf(body.getString("photo_id"), body.getString("listing_id"), body.getString("path"), body.getInt("sort")))
    }
    @Test fun `Fotoregeln wie am PC`() {
        assertEquals(1600 to 1200, PhotoScale.scaleSize(4000, 3000))
        assertEquals(533 to 1600, PhotoScale.scaleSize(1000, 3000))
        assertEquals(800 to 600, PhotoScale.scaleSize(800, 600))
        assertEquals(2, PhotoScale.sampleSize(4000, 3000))
        assertEquals(1, PhotoScale.sampleSize(3000, 2000))
        val seen = ArrayList<Int>()
        assertEquals(400_000, PhotoScale.encodeUnder({ q -> seen += q; ByteArray(if (q == 65) 400_000 else 700_000) }).size)
        assertEquals(listOf(85, 75, 65), seen)
        assertEquals(600_000, PhotoScale.encodeUnder({ ByteArray(600_000) }).size)
        assertEquals(listOf(90, 180, 270, 0), listOf(6, 3, 8, 1).map { PhotoScale.rotationForExif(it) })
        assertEquals("l1/u1.jpg", PhotoScale.photoPath("l1", "u1"))
        assertEquals("https://proj.supabase.co/storage/v1/object/public/listing-photos/l1/u1.jpg",
            PhotoScale.publicUrl("https://proj.supabase.co/rest/v1", "l1/u1.jpg"))
    }
}
```

- [ ] **Step 2: Fehlschlag bestätigen** (Kompilierfehler `Unresolved reference: EbayMarks` / `EbayRepository` / `PhotoScale`).

- [ ] **Step 3: `ml/EbayMarks.kt`**

```kotlin
package com.example.yugiohscanner.ml

import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * Spec H3b §4.4/§5.4 -- eBay-Marken und Einrichtungs-Check-Liste. ZWILLING von desktop/src/utils/ebayMarks.js,
 * gemeinsame Fixture docs/fixtures/ebay/marks.json. Wer eine Fassung ändert, ändert beide.
 * Namensabweichungen: JS-status `undefined` = [StatusState.Loading], `null` = [StatusState.None]; Felder camelCase.
 */
object EbayMarks {
    const val MAX_OWN_PHOTOS = 12

    data class Mark(val kind: String, val text: String, val url: String?, val retry: Boolean)
    data class ListingHead(val channelId: String, val status: String, val deleted: Boolean)
    data class Row(val environment: String, val state: String, val itemUrl: String?, val error: String?)
    data class Status(
        val environment: String, val connected: Boolean, val refreshExpiresAt: String?,
        val hasPaymentPolicy: Boolean, val paymentPolicyName: String?,
        val hasFulfillmentPolicy: Boolean, val fulfillmentPolicyName: String?,
        val hasReturnPolicy: Boolean, val returnPolicyName: String?,
        val hasLocation: Boolean, val locationKey: String?,
    )
    sealed interface StatusState {
        data object Loading : StatusState
        data object None : StatusState
        data class Known(val status: Status) : StatusState
    }
    data class SetupItem(val label: String, val ok: Boolean)

    private val WAITING = Mark("wartet", "wartet auf eBay", null, false)
    private val HTTPS = Regex("^https://", RegexOption.IGNORE_CASE)

    fun webUrl(u: String?): String? = u?.trim()?.takeIf { HTTPS.containsMatchIn(it) }

    fun mark(l: ListingHead, row: Row?, st: StatusState): Mark? {
        if (l.channelId != "ebay") return null
        if (st is StatusState.Loading) return Mark("laden", "…", null, false)
        val active = l.status == "aktiv" && !l.deleted
        val s = (st as? StatusState.Known)?.status
        if (s == null || row == null) return if (active) WAITING else null
        if (row.environment != s.environment) {
            return if (active) WAITING else Mark("andere", "auf eBay beendet (andere Umgebung)", null, false)
        }
        return when (row.state) {
            "online" -> Mark("online", "auf eBay online", webUrl(row.itemUrl), false)
            "fehler" -> Mark("fehler", "eBay-Fehler: ${row.error?.takeIf { it.isNotEmpty() } ?: "unbekannt"}", webUrl(row.itemUrl), active)
            "beendet" -> Mark("beendet", "auf eBay beendet", null, false)
            else -> if (active) WAITING else null
        }
    }

    fun setupItems(s: Status?): List<SetupItem> {
        fun named(label: String, ok: Boolean, name: String?) =
            SetupItem(if (ok && !name.isNullOrEmpty()) "$label: $name" else label, ok)
        return listOf(
            SetupItem("Mit eBay verbunden", s?.connected == true),
            named("Zahlungsrichtlinie", s?.hasPaymentPolicy == true, s?.paymentPolicyName),
            named("Versandrichtlinie", s?.hasFulfillmentPolicy == true, s?.fulfillmentPolicyName),
            named("Rücknahmerichtlinie", s?.hasReturnPolicy == true, s?.returnPolicyName),
            named("Artikelstandort", s?.hasLocation == true, s?.locationKey),
        )
    }
    fun setupOk(s: Status?): Boolean = setupItems(s).all { it.ok }

    /** Spec §4.3: 30 Tage vor Ablauf ein Hinweis. [today] = "YYYY-MM-DD" (lokal). */
    fun expiryText(s: Status?, today: String): String? {
        if (s == null || !s.connected || s.refreshExpiresAt.isNullOrEmpty()) return null
        val day = s.refreshExpiresAt.take(10)
        val days = ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(day))
        if (days > 30) return null
        return "Verbindung läuft am ${day.substring(8, 10)}.${day.substring(5, 7)}.${day.substring(0, 4)} ab – bitte neu verbinden."
    }

    fun photoCountText(n: Int): String = "$n/$MAX_OWN_PHOTOS Fotos"
}
```

- [ ] **Step 4: `ml/PhotoScale.kt`**

```kotlin
package com.example.yugiohscanner.ml

/**
 * Spec H3b1 §6 -- reine Regeln für eigene Fotos, gleiche Grenzen wie desktop/electron/listing-photos.cjs
 * (MAX_EDGE 1600, MIN_EDGE 500, Ziel < 500 KB, Qualitätsstufen 85/75/65/55/50, höchstens 12, Pfad <listing_id>/<uuid>.jpg).
 * Adresse wie supabase/functions/_shared/ebay-map.ts#photoUrl.
 */
object PhotoScale {
    const val MAX_PHOTOS = 12
    const val MAX_EDGE = 1600
    const val MIN_EDGE = 500
    const val TARGET_BYTES = 500 * 1024
    val QUALITIES = listOf(85, 75, 65, 55, 50)
    const val BUCKET = "listing-photos"
    const val TOO_SMALL = "Foto zu klein – mindestens 500 Pixel an der längeren Seite."
    const val TOO_MANY = "Höchstens 12 eigene Fotos je Angebot."

    /** Zielgröße: längste Seite höchstens [maxEdge], Seitenverhältnis bleibt (java.lang.Math.round wie JS Math.round). */
    fun scaleSize(width: Int, height: Int, maxEdge: Int = MAX_EDGE): Pair<Int, Int> {
        val m = maxOf(width, height)
        if (m <= maxEdge) return width to height
        val f = maxEdge.toDouble() / m
        return maxOf(1, Math.round(width * f).toInt()) to maxOf(1, Math.round(height * f).toInt())
    }

    /** BitmapFactory.inSampleSize: größte Zweierpotenz, bei der die längste Seite noch >= [maxEdge] bleibt. */
    fun sampleSize(width: Int, height: Int, maxEdge: Int = MAX_EDGE): Int {
        var s = 1
        while (maxOf(width, height) / (s * 2) >= maxEdge) s *= 2
        return s
    }

    /** Qualität senken, bis unter dem Ziel; die letzte Stufe wird genommen, wie sie ist. */
    fun encodeUnder(encode: (Int) -> ByteArray, target: Int = TARGET_BYTES): ByteArray {
        var last = ByteArray(0)
        for (q in QUALITIES) { last = encode(q); if (last.size < target) return last }
        return last
    }

    /** EXIF-Ausrichtung -> Drehung in Grad (6 = 90°, 3 = 180°, 8 = 270°, sonst 0). */
    fun rotationForExif(orientation: Int): Int = when (orientation) { 6 -> 90; 3 -> 180; 8 -> 270; else -> 0 }

    fun photoPath(listingId: String, uuid: String): String = "$listingId/$uuid.jpg"

    /** Pfade bestehen nur aus UUID-Zeichen; URLEncoder genügt dort (gleiches Ergebnis wie encodeURIComponent). */
    fun publicUrl(baseUrl: String, path: String): String =
        baseUrl.trimEnd('/').removeSuffix("/rest/v1") + "/storage/v1/object/public/$BUCKET/" +
            path.split("/").joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
}
```

- [ ] **Step 5: `cloud/EbayRepository.kt`**

```kotlin
package com.example.yugiohscanner.cloud

import com.example.yugiohscanner.ml.EbayMarks
import com.example.yugiohscanner.ml.Keyset
import com.example.yugiohscanner.ml.KeysetPager
import com.example.yugiohscanner.ml.PhotoScale
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Spec H3b1 §5.1 -- Zeile aus ebay_listings (nur die Funktion schreibt, das Handy liest). */
data class EbayListingRow(
    val listingId: String, val environment: String, val state: String, val itemUrl: String?, val error: String?,
    val publishedQty: Int?,
) {
    fun row(): EbayMarks.Row = EbayMarks.Row(environment, state, itemUrl, error)
}

/** Spec H3b1 §6 -- eigenes Foto (Strom wie listings, weiches Löschen). */
data class ListingPhoto(val photoId: String, val listingId: String, val path: String, val sort: Int, val deleted: Boolean)

/**
 * Spec H3b1 -- eBay am Handy über REST (supabase/ebay_schema.sql) und die Funktionen ebay-auth/ebay-sync. Bauart wie
 * ListingsRepository (Auth-Kopf, bei 401 einmal neu anmelden, Blättern per KeysetPager über 1000 Zeilen).
 * Die Geräte sehen nie Tokens: gelesen wird nur ebay_status, geschrieben nur listing_photos und Speicher-Dateien.
 */
object EbayRepository {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jpeg = "image/jpeg".toMediaType()
    private const val ROW_COLS = "listing_id,environment,state,item_url,error,published_qty"
    private const val PHOTO_COLS = "photo_id,listing_id,path,sort,deleted"
    // Ein Durchgang von ebay-sync dauert länger als OkHttps 10 s Standard (bis zu 50 Angebote).
    private val slow by lazy { SupabaseCloud.http().newBuilder().readTimeout(150, TimeUnit.SECONDS).callTimeout(160, TimeUnit.SECONDS).build() }

    private fun str(o: JSONObject, k: String): String? = if (!o.has(k) || o.isNull(k)) null else o.getString(k)

    internal fun parseStatus(text: String): EbayMarks.Status? {
        val a = JSONArray(text)
        if (a.length() == 0) return null
        val o = a.getJSONObject(0)
        return EbayMarks.Status(
            o.getString("environment"), o.optBoolean("connected", false), str(o, "refresh_expires_at"),
            o.optBoolean("has_payment_policy", false), str(o, "payment_policy_name"),
            o.optBoolean("has_fulfillment_policy", false), str(o, "fulfillment_policy_name"),
            o.optBoolean("has_return_policy", false), str(o, "return_policy_name"),
            o.optBoolean("has_location", false), str(o, "location_key"),
        )
    }
    /** Letzter Lauf/Fehler aus derselben Zeile (für die Einstellungen). */
    data class RunInfo(val lastRunAt: String?, val summary: String?, val lastError: String?)
    internal fun parseRunInfo(text: String): RunInfo? {
        val a = JSONArray(text)
        if (a.length() == 0) return null
        val o = a.getJSONObject(0)
        return RunInfo(str(o, "last_run_at"), str(o, "last_run_summary"), str(o, "last_error"))
    }
    internal fun parseRows(text: String): List<EbayListingRow> {
        val a = JSONArray(text)
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            EbayListingRow(o.getString("listing_id"), o.getString("environment"), o.getString("state"), str(o, "item_url"),
                str(o, "error"), if (o.isNull("published_qty")) null else o.getInt("published_qty"))
        }
    }
    internal fun parsePhotos(text: String): List<ListingPhoto> {
        val a = JSONArray(text)
        return (0 until a.length()).map { i ->
            val o = a.getJSONObject(i)
            ListingPhoto(o.getString("photo_id"), o.getString("listing_id"), o.getString("path"), o.optInt("sort", 0), o.optBoolean("deleted", false))
        }
    }

    internal fun rowsPageParams(after: String?): List<Pair<String, String>> {
        val p = arrayListOf("select" to ROW_COLS, "order" to "listing_id.asc", "limit" to StoreQueries.PAGE.toString())
        if (after != null) p += "or" to Keyset.after(listOf("listing_id"), listOf(after))
        return p
    }
    internal fun photosPageParams(after: String?): List<Pair<String, String>> {
        val p = arrayListOf("select" to PHOTO_COLS, "deleted" to "eq.false", "order" to "photo_id.asc", "limit" to StoreQueries.PAGE.toString())
        if (after != null) p += "or" to Keyset.after(listOf("photo_id"), listOf(after))
        return p
    }

    /** Je Angebot die eigenen Fotos in Reihenfolge (sort, dann photo_id) -- wie ebay-map.ts#ownPhotos. */
    fun photosOf(all: List<ListingPhoto>, listingId: String): List<ListingPhoto> =
        all.filter { it.listingId == listingId && !it.deleted }.sortedWith(compareBy<ListingPhoto> { it.sort }.thenBy { it.photoId })

    /** Neue Reihenfolge -> nur die Fotos, deren sort sich ändert (photo_id to neuer sort). */
    internal fun reorderPatches(current: List<ListingPhoto>, orderedIds: List<String>): List<Pair<String, Int>> {
        val byId = current.associateBy { it.photoId }
        require(orderedIds.size == current.size && orderedIds.toSet() == byId.keys) { "Fotos wurden inzwischen geändert – bitte neu öffnen." }
        return orderedIds.mapIndexedNotNull { i, id -> if (byId.getValue(id).sort != i) id to i else null }
    }
    internal fun photoInsertBody(photoId: String, listingId: String, path: String, sort: Int): String =
        JSONObject().put("photo_id", photoId).put("listing_id", listingId).put("path", path).put("sort", sort).toString()

    // ---- Lesen ----------------------------------------------------------------------------------------------------

    suspend fun loadStatus(): Pair<EbayMarks.Status, RunInfo>? {
        val text = getText("ebay_status", listOf("select" to "*", "limit" to "1"), "eBay-Stand laden")
        val s = parseStatus(text) ?: return null
        return s to (parseRunInfo(text) ?: RunInfo(null, null, null))
    }
    suspend fun loadRows(): Map<String, EbayListingRow> =
        KeysetPager.all(StoreQueries.PAGE) { after: EbayListingRow? -> parseRows(getText("ebay_listings", rowsPageParams(after?.listingId), "eBay-Angebote laden")) }
            .associateBy { it.listingId }
    suspend fun loadPhotos(): List<ListingPhoto> =
        KeysetPager.all(StoreQueries.PAGE) { after: ListingPhoto? -> parsePhotos(getText("listing_photos", photosPageParams(after?.photoId), "Fotos laden")) }

    // ---- Funktionen -----------------------------------------------------------------------------------------------

    /** POST /functions/v1/<name>; die Funktionen antworten { ok, error?, ... } (auch bei erwarteten Fehlern mit 200). */
    suspend fun invoke(name: String, body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        executeWithReauth(slow) {
            base("${SupabaseCloud.base()}/functions/v1/$name".toHttpUrl()).addHeader("Content-Type", "application/json")
                .post(body.toString().toRequestBody(SupabaseCloud.jsonMedia)).build()
        }.use { r ->
            val text = r.body?.string().orEmpty()
            val o = runCatching { JSONObject(text) }.getOrNull()
            if (o != null && o.has("ok")) return@use o
            JSONObject().put("ok", false).put("error", "eBay-Funktion nicht erreichbar (${r.code}).")
        }
    }
    suspend fun auth(action: String, extra: JSONObject = JSONObject()): JSONObject = invoke("ebay-auth", extra.put("action", action))

    /** „Jetzt abgleichen“/„Erneut versuchen“: wartet auf den Durchgang und lädt danach den eBay-Stand neu. */
    suspend fun syncNow(retryListingId: String? = null): JSONObject {
        val r = invoke("ebay-sync", JSONObject().apply { if (retryListingId != null) put("retry", retryListingId) })
        SideStores.ebayStatus.refreshAndWait()
        SideStores.ebayRows.refreshAndWait()
        return r
    }

    /** Spec §5.4: nach jeder eBay-relevanten Änderung anstoßen -- nur wenn verbunden, ohne zu warten, nie werfend. */
    fun kick() {
        if (SideStores.ebayStatus.state.value.value?.firstOrNull()?.first?.connected != true) return
        scope.launch { runCatching { syncNow() } }
    }

    // ---- Fotos ----------------------------------------------------------------------------------------------------

    /** Lädt [jpegBytes] nach listing-photos/<listing_id>/<uuid>.jpg und legt die Zeile an (sort = hinten). */
    suspend fun addPhoto(listingId: String, jpegBytes: ByteArray, nextSort: Int): ListingPhoto = withContext(Dispatchers.IO) {
        val id = UUID.randomUUID().toString()
        val path = PhotoScale.photoPath(listingId, id)
        executeWithReauth {
            base("${SupabaseCloud.base()}/storage/v1/object/${PhotoScale.BUCKET}/$path".toHttpUrl())
                .addHeader("x-upsert", "false").post(jpegBytes.toRequestBody(jpeg)).build()
        }.use { r -> if (!r.isSuccessful) throw RuntimeException("Foto hochladen fehlgeschlagen (${r.code}): ${r.body?.string().orEmpty()}") }
        write("POST", "listing_photos", emptyList(), photoInsertBody(id, listingId, path, nextSort))
        ListingPhoto(id, listingId, path, nextSort, false)
    }
    suspend fun deletePhoto(photoId: String) =
        write("PATCH", "listing_photos", listOf("photo_id" to "eq.$photoId", "deleted" to "eq.false"), JSONObject().put("deleted", true).toString())
    suspend fun reorder(current: List<ListingPhoto>, orderedIds: List<String>) {
        for ((id, sort) in reorderPatches(current, orderedIds)) {
            write("PATCH", "listing_photos", listOf("photo_id" to "eq.$id"), JSONObject().put("sort", sort).toString())
        }
    }

    // ---- HTTP -----------------------------------------------------------------------------------------------------

    private suspend fun write(method: String, table: String, params: List<Pair<String, String>>, body: String) = withContext(Dispatchers.IO) {
        executeWithReauth {
            val b = base(url(table, params)).addHeader("Content-Type", "application/json").addHeader("Prefer", "return=minimal")
            val rb = body.toRequestBody(SupabaseCloud.jsonMedia)
            (if (method == "POST") b.post(rb) else b.patch(rb)).build()
        }.use { r -> if (!r.isSuccessful) throw RuntimeException(SalesRepository.dbErrorMessage(r.body?.string(), r.code)) }
    }
    private fun url(table: String, params: List<Pair<String, String>>): HttpUrl =
        "${SupabaseCloud.base()}/rest/v1/$table".toHttpUrl().newBuilder().apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
    private suspend fun getText(table: String, params: List<Pair<String, String>>, what: String): String = withContext(Dispatchers.IO) {
        executeWithReauth { base(url(table, params)).get().build() }.use { r ->
            val text = r.body?.string() ?: "[]"
            if (!r.isSuccessful) throw RuntimeException("$what fehlgeschlagen (${r.code}): $text")
            text
        }
    }
    private fun base(url: HttpUrl): Request.Builder =
        Request.Builder().url(url).addHeader("apikey", SupabaseCloud.key()).addHeader("Authorization", "Bearer ${SupabaseCloud.token()}")
    private suspend fun executeWithReauth(client: okhttp3.OkHttpClient = SupabaseCloud.http(), build: () -> Request): Response =
        withContext(Dispatchers.IO) {
            val first = client.newCall(build()).execute()
            if (first.code != 401) return@withContext first
            first.close()
            SupabaseCloud.signIn()
            client.newCall(build()).execute()
        }
}
```

- [ ] **Step 6: `SideStores.kt` und Anstoß in `ListingsRepository.run`**

`SideStores.kt` nach `val listings = …` (Zeile 120):

```kotlin
    // Spec H3b1: eBay-Stand (0 oder 1 Zeile, Muster priceAlertMoveRule), eBay-Zeilen je Angebot, eigene Fotos (geblättert).
    val ebayStatus = ListCache(scope) { listOfNotNull(EbayRepository.loadStatus()) }
    val ebayRows = ListCache(scope) { EbayRepository.loadRows() }
    val listingPhotos = ListCache(scope) { EbayRepository.loadPhotos() }
```

und in `clearAll()` nach `listings.clear()`: `ebayStatus.clear(); ebayRows.clear(); listingPhotos.clear()`.

`ListingsRepository.run` (Zeile 237–250): nach der `for`-Schleife (alle Schreibaufrufe erfolgreich) `EbayRepository.kick()` — einzige Schreibstelle der Angebote am Handy (Anlegen, Bearbeiten, Herausnehmen, Beenden, Aufräumen nach `book_sale`), also stößt jede eBay-relevante Änderung an (Abweichung 9). `kick()` wirft nie und wartet nicht.

- [ ] **Step 7: Android-Tests grün** (+9), Regex-Wächter grün.

- [ ] **Step 8: Schutz-Nachweise**

1. `EbayMarks.mark`: den `Loading`-Fall entfernen. „Marken aller Fixture-Faelle“ scheitert bei „Stand lädt“. Zurücknehmen.
2. `EbayRepository.photosPageParams`: den `or`-Parameter weglassen. Der Blätter-Test läuft in eine Endlosschleife bzw. liefert 2000 Zeilen → scheitert (Test mit Zeitlimit abbrechen, Fehlschlag zitieren). Zurücknehmen.

- [ ] **Step 9: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ml/EbayMarks.kt android/app/src/main/java/com/example/yugiohscanner/ml/PhotoScale.kt android/app/src/main/java/com/example/yugiohscanner/cloud/EbayRepository.kt android/app/src/main/java/com/example/yugiohscanner/cloud/SideStores.kt android/app/src/main/java/com/example/yugiohscanner/cloud/ListingsRepository.kt android/app/src/test/java/com/example/yugiohscanner/EbayMarksTest.kt android/app/src/test/java/com/example/yugiohscanner/EbayRepositoryTest.kt
git commit -m "feat(h3b1): Handy-Daten fuer eBay-Stand, eBay-Zeilen, eigene Fotos und Anstoss

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Handy-Oberfläche — Einstellungen „eBay“, Marken, „Erneut versuchen“, Fotos per Kamera/Galerie

**Files:**
- Create: `android/.../ui/PhotoImport.kt`, `android/.../ui/ListingPhotos.kt`, `android/.../ui/EbaySettings.kt`
- Modify: `android/.../ui/SettingsScreen.kt` (nach `SaleChannelSettings()`, Zeile 274), `android/.../ui/ListingsScreen.kt`, `android/.../ui/ListingSheet.kt`, `android/app/src/main/res/xml/file_paths.xml`

**Interfaces:**
- Consumes: Task 8 (`EbayRepository`, `EbayMarks`, `PhotoScale`, `SideStores.ebayStatus/ebayRows/listingPhotos`), `InFlight`, `openWebLink`, `ListingShare.AUTHORITY_SUFFIX`.
- Produces: `PhotoImport.jpegFrom(ctx, uri): ByteArray` (wirft `IllegalArgumentException` mit deutscher Meldung), `PhotoImport.cameraUri(ctx): Uri`; `@Composable ListingPhotos(listingId, enabled)`; `@Composable EbaySettings()`; `@Composable EbayMarkRow(mark, onRetry?)`.

- [ ] **Step 1: `file_paths.xml`** — zweite Zeile `<cache-path name="listing_photos" path="listing_photos/" />` (Kamera-Aufnahme; `ListingShareConfigTest` bleibt grün).

- [ ] **Step 2: `ui/PhotoImport.kt`** (wörtlich)

```kotlin
package com.example.yugiohscanner.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import androidx.core.content.FileProvider
import com.example.yugiohscanner.ml.PhotoScale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Spec H3b1 §6 -- Foto (Kamera-Datei oder Galerie) vor dem Hochladen verkleinern: längste Seite ≤ 1600 px, JPEG < 500 KB,
 * Drehung aus EXIF angewandt, mindestens 500 px (eBay). Regeln in ml/PhotoScale.kt (Zwilling der PC-Grenzen).
 */
object PhotoImport {
    private const val UNREADABLE = "Foto konnte nicht gelesen werden."
    const val CAMERA_DIR = "listing_photos"

    suspend fun jpegFrom(ctx: Context, uri: Uri): ByteArray = withContext(Dispatchers.IO) {
        val cr = ctx.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) } ?: throw IllegalArgumentException(UNREADABLE)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException(UNREADABLE)
        if (maxOf(bounds.outWidth, bounds.outHeight) < PhotoScale.MIN_EDGE) throw IllegalArgumentException(PhotoScale.TOO_SMALL)
        val opts = BitmapFactory.Options().apply { inSampleSize = PhotoScale.sampleSize(bounds.outWidth, bounds.outHeight) }
        val decoded = cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: throw IllegalArgumentException(UNREADABLE)
        val orientation = cr.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
            ?: ExifInterface.ORIENTATION_NORMAL
        val (w, h) = PhotoScale.scaleSize(decoded.width, decoded.height)
        val m = Matrix().apply {
            postScale(w.toFloat() / decoded.width, h.toFloat() / decoded.height)
            val rot = PhotoScale.rotationForExif(orientation)
            if (rot != 0) postRotate(rot.toFloat())
        }
        val out = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
        PhotoScale.encodeUnder({ q -> ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, q, it) }.toByteArray() })
    }

    /** Ziel-Datei für die Kamera (TakePicture) im freigegebenen Cache-Ordner; wird bei jeder Aufnahme überschrieben. */
    fun cameraUri(ctx: Context): Uri {
        val f = File(File(ctx.cacheDir, CAMERA_DIR).apply { mkdirs() }, "aufnahme.jpg")
        return FileProvider.getUriForFile(ctx, ctx.packageName + ListingShare.AUTHORITY_SUFFIX, f)
    }
}
```

- [ ] **Step 3: `ui/ListingPhotos.kt`**

Composable `ListingPhotos(listingId: String, enabled: Boolean)`: liest `SideStores.listingPhotos.state` (`LaunchedEffect(listingId) { SideStores.listingPhotos.ensureLoaded() }`), `photos = EbayRepository.photosOf(value, listingId)`; `value == null && error == null` → „…“; Fehler → „Fotos nicht geladen“ + „Erneut versuchen“. Zeile `EbayMarks.photoCountText(photos.size)`; `LazyRow` der Vorschaubilder (`AsyncImage(model = PhotoScale.publicUrl(SupabaseCloud.base(), p.path))`, 72 dp) mit „◀“ „▶“ „✕“. Oben im Composable (nie in einem Zweig, Global Constraints) drei Launcher:

```kotlin
    var pendingCamera by remember { mutableStateOf<Uri?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) pendingCamera?.let { add(it) } }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) add(uri) }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) { val u = PhotoImport.cameraUri(ctx); pendingCamera = u; camera.launch(u) } else error = "Kamera nicht erlaubt."
    }
```

Knöpfe „Foto aufnehmen“ (prüft `ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA)`: erteilt → direkt `camera.launch`, sonst `cameraPermission.launch(Manifest.permission.CAMERA)`; Befund 10) und „Aus Galerie“ (`gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))`), beide gesperrt bei `!enabled || busy || photos.size >= PhotoScale.MAX_PHOTOS`.

`add(uri)`, Löschen und Verschieben laufen durch `InFlight` und laden **im** Gatter frisch:

```kotlin
    fun add(uri: Uri) {
        if (!inFlight.tryStart()) return
        busy = true; error = null
        scope.launch {
            try {
                val jpeg = PhotoImport.jpegFrom(ctx, uri)
                SideStores.listingPhotos.refreshAndWait()
                val fresh = SideStores.listingPhotos.state.value.value ?: throw IllegalStateException("Fotos nicht geladen.")
                val mine = EbayRepository.photosOf(fresh, listingId)
                if (mine.size >= PhotoScale.MAX_PHOTOS) throw IllegalStateException(PhotoScale.TOO_MANY)
                EbayRepository.addPhoto(listingId, jpeg, (mine.maxOfOrNull { it.sort } ?: -1) + 1)
                SideStores.listingPhotos.refreshAndWait()
                EbayRepository.kick()
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Foto konnte nicht hinzugefügt werden." }
            finally { inFlight.finish(); busy = false }
        }
    }
```

Löschen: Bestätigungsdialog „Foto entfernen?“ → `deletePhoto` → `refreshAndWait()` → `kick()`. Verschieben: frisch laden, neue Reihenfolge der frischen Liste bilden (Nachbar tauschen), `EbayRepository.reorder(fresh, ids)` (wirft „Fotos wurden inzwischen geändert – bitte neu öffnen.“ bei abweichender Menge), `refreshAndWait()`, `kick()`.

- [ ] **Step 4: Marken, „Erneut versuchen“, Fotos im Angebot (`ListingsScreen.kt`)**

Oben in `ListingsSection` und `ListingDetailSheet`: `val ebayState by SideStores.ebayStatus.state.collectAsState()`, `val ebayRows by SideStores.ebayRows.state.collectAsState()`, beim Öffnen `LaunchedEffect(Unit) { SideStores.ebayStatus.refresh(); SideStores.ebayRows.refresh() }`. Zustand für die Marke:

```kotlin
private fun ebayState(s: CacheState<List<Pair<EbayMarks.Status, EbayRepository.RunInfo>>>): EbayMarks.StatusState = when {
    s.value == null && s.error == null -> EbayMarks.StatusState.Loading
    s.value?.firstOrNull() == null -> EbayMarks.StatusState.None
    else -> EbayMarks.StatusState.Known(s.value!!.first().first)
}
```

Marke je Angebot: `EbayMarks.mark(EbayMarks.ListingHead(l.channelId, l.status, l.deleted), ebayRows.value?.get(l.listingId)?.row(), ebayState(ebayState))`. Neues Composable `EbayMarkRow(mark, onRetry: (() -> Unit)?)` mit `MarkChip` (Farbe `Good` für online, `ErrorColor` für fehler, sonst `Gold`) und, wenn `mark.retry && onRetry != null`, `TextButton("Erneut versuchen")`. In `ListingRowView` (Zeile 190–209) nach `MarksRow(r.marks)` ohne `onRetry`; im Detail nach `MarksRow(overviewRow?.marks)` (Zeile 335) mit `onRetry = { write(requireActive = true) { _, l -> val r = EbayRepository.syncNow(l.listingId); if (!r.optBoolean("ok")) error = r.optString("error"); else notice = if (r.optBoolean("busy")) "Abgleich läuft schon – gleich noch einmal versuchen." else "eBay-Abgleich angestoßen." } }` und, wenn `mark.url != null`, `OutlinedButton("Auf eBay ansehen") { if (!openWebLink(ctx, mark.url)) error = "Link konnte nicht geöffnet werden." }`.

Im Detail unter den Positionen `ListingPhotos(listingId, enabled = active && !offline)` (alle Kanäle). „Bilder“ (Zeile 407) teilt `EbayRepository.photosOf(SideStores.listingPhotos.state.value.value.orEmpty(), listingId).map { PhotoScale.publicUrl(SupabaseCloud.base(), it.path) } + ListingText.imageUrls(…)`.

`ListingSheet.kt`: Hinweis „Eigene Fotos fügst du nach dem Speichern im Angebot hinzu.“ (Abweichung 8); bei Kanal `ebay` und `!EbayMarks.setupOk(status)` (Stand geladen) zusätzlich „eBay ist noch nicht eingerichtet – das Angebot wartet, bis der Check in den Einstellungen vollständig ist.“

- [ ] **Step 5: `ui/EbaySettings.kt` und Abschnitt in `SettingsScreen.kt`**

`SettingsScreen.kt` nach `SaleChannelSettings()` (Zeile 274): `EbaySettings()`. `EbaySettings` (Muster `SaleChannelSettings` Zeile 299 ff.: `SectionHeader("eBay")`, `SpaceCard`, `InFlight`, Fehler/Erfolg als Text) zeigt dasselbe wie der PC (Task 7 Step 3, Punkte 2–8): Laden „…“; kein Stand → „eBay-Stand nicht geladen“ + „Erneut versuchen“ (`SideStores.ebayStatus.refresh()`); Umgebung (zwei `FilterChip`s, Wechsel mit Bestätigungsdialog → `EbayRepository.auth("set_environment", JSONObject().put("environment", env))`); „Verbinden“ → `auth("start")`, bei `ok` `openWebLink(ctx, r.getString("url"))` (nur https wird geöffnet; sonst „Ungültige Adresse von eBay.“) und Hinweis „Browser geöffnet – nach dem Bestätigen hier „Prüfen“ tippen.“; „Trennen“ (Bestätigung) → `auth("disconnect")`; Check-Liste `EbayMarks.setupItems(status)` mit ✓/✗; „Prüfen“ → `auth("check")`, Antwort merken; Auswahl je Art mit mehreren `options` als `ExposedDropdownMenuBox` → `auth("select", JSONObject().put("<feld>", id))`; keine Möglichkeit → Text + „Seite öffnen“ (`openWebLink(ctx, policyPage)`); `programOk == false` → Hinweis; Standort (PLZ 5 Ziffern, Ort) → `auth("create_location", …)`; „Jetzt abgleichen“ → `EbayRepository.syncNow()` → „Abgleich fertig: …“ / „Abgleich läuft schon.“; letzter Lauf (`RunInfo.lastRunAt` als lokale Zeit, `summary`) und `lastError` in `ErrorColor`; `EbayMarks.expiryText(status, LocalDate.now().toString())`. Nach jeder erfolgreichen Aktion `SideStores.ebayStatus.refreshAndWait()`. Alle Aufrufe im `InFlight`-Gatter auf `rememberCoroutineScope()`.

- [ ] **Step 6: Prüfen**

Android `testDebugUnitTest assembleDebug` grün (Testzahl wie nach Task 8), Regex-Wächter grün. Geklickt wird in der Abnahme.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/ui/PhotoImport.kt android/app/src/main/java/com/example/yugiohscanner/ui/ListingPhotos.kt android/app/src/main/java/com/example/yugiohscanner/ui/EbaySettings.kt android/app/src/main/java/com/example/yugiohscanner/ui/SettingsScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/ListingsScreen.kt android/app/src/main/java/com/example/yugiohscanner/ui/ListingSheet.kt android/app/src/main/res/xml/file_paths.xml
git commit -m "feat(h3b1): Handy eBay-Einstellungen, Marken mit Erneut versuchen, Fotos per Kamera und Galerie

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Anleitung `supabase/README_ebay_cloud.md`

**Files:**
- Create: `supabase/README_ebay_cloud.md`

- [ ] **Step 1: Datei schreiben** — deutsch, Aufbau wie `README_cardmarket_cloud.md`, Inhalt **wörtlich aus dem Abschnitt „SQL + Deploy — Reihenfolge ist Pflicht“ dieses Plans** (Schritte 1–5 mit Prüfabfragen, RuName-Adressen, `supabase secrets set` mit Platzhaltern, beide Deploy-Befehle mit `--no-verify-jwt`, Cron-SQL mit `x-ebay-secret`, `cron.job_run_details`, `cron.unschedule`), dazu:
  - **6. Von Hand testen** (nur der Nutzer): „In der App: Einstellungen › eBay › Verbinden (Sandbox) → Browser zeigt „Verbunden – du kannst das Fenster schließen.“ → Prüfen → Check grün.“ und `curl -s -X POST https://uirfqwklvavgjklgqpnn.supabase.co/functions/v1/ebay-sync -H "x-ebay-secret: <zufallswert>"` → `{"ok":true,"busy":false,…,"text":"0 eingestellt · 0 geändert · 0 beendet · 0 Fehler"}` bzw. `{"ok":true,"busy":true,"text":"läuft schon"}`.
  - **7. Sandbox → Produktion:** zuerst alle Sandbox-Angebote beenden (sonst verweigert der Wechsel, Abweichung 7), dann Umgebung „Produktion“, neu verbinden, Check, ein echtes Angebot.
  - **8. Was wo steht:** Tokens nur in `ebay_account` (keine Regel für Geräte), Geräte lesen `ebay_status`; die Rücksprung-Seite ist Text (Abweichung 1); Fehlersuche `supabase functions logs ebay-sync` (keine Tokens in den Protokollen); abgelaufene Verbindung → „Verbindung abgelaufen – bitte neu verbinden“.
  - **9. Risiken:** Pflichtmerkmale ändern sich (Anzeige geht mit eBays Meldung auf „fehler“), Konvolut-Kategorie (Befund Doku 15), Sandbox-Link (Befund Doku 16), Foto-Adressen öffentlich.

- [ ] **Step 2: Commit**

```bash
git add supabase/README_ebay_cloud.md
git commit -m "docs(h3b1): Anleitung eBay in der Cloud (SQL, RuName, Secrets, Deploy, Zeitplan)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Controller-Abschluss (kein Subagent)

- [ ] Endstand messen: Deno gesamt (Ausgangszahl + 47) und `deno check` beider `index.ts`, SQLite-Suite (+ 10 + 8 Kanäle), `test-sync.cjs`, Helfer (+ 4), Lint (5), `vite build`, Android `testDebugUnitTest assembleDebug` (+ 9). `deno.lock` bleibt ungestaged.
- [ ] Abschlussreview über den ganzen Zweig. Schwerpunkte: keine Tokens/Secrets in Logs oder Antworten; JWT-Prüfung auf allen Aktionen außer Rücksprung; `state` einmalig und 10 min; Zeitplan nur mit `EBAY_CRON_SECRET`; Nur-Lese-Ströme ohne Push; `listing_photos` mit `localWinsUnpushed`; Einzelfehler vs. Abbruch; `failed_hash`/`sold_seen`; Umgebungs-Sperre; Blättern > 1000 (Funktion und Handy); „…“-Platzhalter; http(s)-Links; Bildprüfungen; InFlight + frisch laden; Launcher außerhalb von Zweigen; keine Worktrees/Kopien/Löschungen durch Agents.
- [ ] Nutzer spielt SQL ein und bestätigt die Prüfabfragen; setzt Secrets, legt RuName an, deployt beide Funktionen, legt den Zeitplan an (Anleitung Task 10). Der Controller führt nichts davon aus.
- [ ] Installer bauen — im **Hauptordner** `desktop/` (echte `node_modules`, keine Junction): `git -C C:/Users/Buzzty/Downloads/yugi switch --detach <Spitze des Zweigs>`, dann die bewährte Reihenfolge (`npm rebuild better-sqlite3` → Tests → `npx @electron/rebuild -f -w better-sqlite3 -v 40.1.0` → `npm run dist` → `process.dlopen`-Prüfung auf `win-unpacked`), danach `git switch main`. Ausgabe in `desktop/dist-electron` (neuer Zeitstempel von `Setup 0.1.0.exe`).
- [ ] Nutzer installiert. **Prüfung des installierten Builds:** `grep -c "ebay-sync-now" "C:/Users/Buzzty/AppData/Local/Programs/yugioh-card-manager/resources/app.asar"` → mindestens 1. Erst dann gilt eine PC-Abnahme.
- [ ] APK installieren, App **starten**, `adb logcat -b crash` leer.
- [ ] Abnahme mit dem Nutzer in der **Sandbox** (Spec §10; vorher ein Sandbox-Testkonto mit Zahlungs-, Versand- und Rücknahmerichtlinie für EBAY_DE):
  1. PC: Einstellungen › eBay › Umgebung Sandbox › Verbinden → Browser → eBay-Anmeldung (Sandbox-Nutzer) → Textseite „Verbunden – du kannst das Fenster schließen.“ → Prüfen: Check-Liste grün (bei mehreren Richtlinien Auswahl treffen; ohne Standort „Standort anlegen“ mit PLZ/Ort).
  2. Handy: Einstellungen › eBay zeigt denselben Stand (verbunden, Häkchen, letzter Lauf).
  3. PC: zwei gleiche Karten auf Kanal eBay anbieten (Preis 10,00 €) → nach ≤ 10 s „auf eBay online“ mit „Auf eBay ansehen“; die Sandbox-Anzeige zeigt Menge 2, Stückpreis 5,00 €, Zustand „Ungraded – Near mint or better“, Merkmale, Katalogbild. (Stimmt der Link nicht, Befund Doku 16.)
  4. Handy: im selben Angebot ein Foto aufnehmen → nach dem Anstoß erscheint das Foto als erstes Bild der Anzeige; Reihenfolge ändern, ein Foto löschen → Anzeige folgt.
  5. PC: Preis auf 12,00 € ändern → Anzeige 6,00 €/Stück. Eine der Karten am Handy auf einem anderen Kanal als verkauft buchen → eBay-Menge 1.
  6. PC: ein Konvolut (zwei verschiedene Karten, eine EX, eine PL) auf eBay anbieten → Menge 1, Gesamtpreis, Zustand „Heavily played (Poor)“. Scheitert eBay (z. B. Kategorie/Merkmal), steht die Meldung als „eBay-Fehler: …“ da; „Erneut versuchen“ nach einer Korrektur.
  7. In der Sandbox-Verkäuferansicht eine Anzeige von Hand beenden → spätestens nach einer Stunde „eBay-Fehler: auf eBay beendet – …“; „Erneut versuchen“ stellt sie neu ein.
  8. PC: ein eBay-Angebot beenden → Anzeige zurückgezogen, Marke „auf eBay beendet“.
  9. Umgebung auf Produktion wechseln, solange ein Sandbox-Angebot online ist → Meldung „Zuerst die 1 eBay-Anzeige in der Sandbox beenden – …“.
  10. Danach (Spec §10) Produktion mit einer echten Karte: Umgebung wechseln, verbinden, Check, einstellen, Link prüfen, beenden.
- [ ] Merge in `main` erst nach der Abnahme, Push nur auf Zuruf.
- [ ] Gedächtnis: `spec-h3b1-status.md` anlegen und im Index eintragen (Antworten an den Nutzer auf Deutsch).


## Selbstprüfung

**Abdeckung der Spec (H3b1-Umfang §11):**

| Spec | Task |
|---|---|
| §3 Cloud, Einrichtungs-Check + Schalter Sandbox/Produktion, ein Abgleicher Soll/Ist, eigene Tabelle `ebay_listings` | 3, 4, 5 |
| §4.1 Secrets je Umgebung, `EBAY_CRON_SECRET`, Geräte sehen keine | 2 (`credsFor`), 5 (`handleSync`), 10 |
| §4.2 `ebay_account` (RLS ohne Regel), Ansicht `ebay_status` ohne Tokens, mit Namen | 3 (+ Abweichung 3) |
| §4.3 `ebay-auth`: start (JWT, `state` 10 min, vier Rechte), callback (einmalig, Tausch, Textseite), check (Richtlinien + Standorte, genau eine → automatisch), select, create_location (`ygo-default`), set_environment (trennt), disconnect; 30-Tage-Hinweis | 2, 4 (+ Abweichung 1, 7), 7/9 (`expiryText`) |
| §4.4 Einstellungen PC + Handy | 7, 9 |
| §5.1 `ebay_listings`, Nur-Lese-Strom am PC | 3, 5, 6, 8 |
| §5.2 Abbildung (Menge/Stückpreis, SKU, Titel ≤ 80 mit H3a-Rückfall, HTML, 183454/Festpreis/GTC, Merkmale live, Zustand Ungraded + CCG-Werte, Bilder ≤ 24, Richtlinien/Standort) | 1, 2 (Taxonomy), 5 (+ Abweichung 4) |
| §5.3 Einstellen, Ändern (Prüfsumme), Menge senken, Zurückziehen, manuell beendet, Umgebung | 1 (`decide`), 5 (+ Abweichung 5, 6) |
| §5.4 Marken, „Erneut versuchen“, Anstoß nach Änderungen | 6, 7, 8, 9 (+ Abweichung 9) |
| §6 Fotos: Speicher öffentlich lesbar / angemeldet schreiben, Pfad, `listing_photos` Strom, Kamera/Galerie/Datei, Löschen weich, Reihenfolge, ≤ 1600 px, JPEG < 500 KB, ≥ 500 px, ≤ 12, für alle Kanäle | 3, 6, 7, 8, 9 (+ Abweichung 8) |
| §8 Zeitplan 5 min mit `x-ebay-secret`, sofort, nur ein Durchgang, Schritte 1/4/5, ≤ 50 | 5 (+ Abweichung 2), 10 |
| §9 Fehlerfälle (eBay weg → Abbruch; Einzelfehler; Token abgelaufen; Einrichtung unvollständig; Umgebung; manuell geändert) und Sicherheit | 2, 4, 5, Global Constraints |
| §10 Tests: Deno-Zwilling `pieceCents`/Mengenregel, Abbildung gegen `docs/fixtures/ebay/*.json`, Abgleicher mit nachgebautem eBay (einstellen, ändern, Menge senken, zurückziehen, manuell beendet, Token abgelaufen, Einzelfehler, zweiter paralleler Lauf), PC/Handy Ströme, Foto-Verkleinern, Marken, Einstellungen, Sandbox-Abnahme | 1, 2, 4, 5, 6, 7, 8, 11 |
| §11 Anleitung (Secrets, RuName-Rücksprung, Deploy, Cron) | 10, Kopf „SQL + Deploy“ |

**Namen quer geprüft:**
- Tabellen/Spalten: `ebay_account` (24) = `ebay_schema.sql` = `ebay-store.ts#Account` (+ `id`, Sperre, `orders_cursor`, `updated_at`); `ebay_listings` (15) = SQL = `EBAY_LISTING_COLS` (`ebay-schema.cjs`) ⊇ `ebay-plan.ts#EbayRow` = `ROW_COLS` (`ebay-store.ts`) ⊇ `EbayRepository.ROW_COLS`; `listing_photos` (7) = SQL = `LISTING_PHOTO_COLS` = `PHOTO_COLS`; `ebay_status` (19) = `ebayMarks.js`/`EbayMarks.Status`-Felder (`has_*`, `*_name`, `location_key`, `refresh_expires_at`, `connected`, `environment`) + `RunInfo`.
- RPC: `ebay_try_lock(p_holder, p_seconds)`, `ebay_unlock(p_holder)` in SQL = `supabaseStore.tryLock/unlock`.
- Funktionen: `ebay-auth` Aktionen `start, check, select, create_location, set_environment, disconnect` = `EBAY_AUTH_ACTIONS` (main.cjs) = Handy `EbayRepository.auth(...)`; `select`-Felder `payment_policy_id, fulfillment_policy_id, return_policy_id, location_key` in `handler.ts`, `EbaySettings.jsx` (`SELECT_FIELD`), `EbaySettings.kt`; `ebay-sync` Körper `{ retry }` = `ebaySyncNow({ retry })` = `EbayRepository.syncNow(retryListingId)`.
- IPC: `ebay-status, ebay-listings, ebay-auth, ebay-sync-now, listing-photos, listing-photo-add, listing-photo-delete, listing-photo-reorder` in `main.cjs`, `preload.cjs` (`ebayStatus, ebayListings, ebayAuth, ebaySyncNow, listingPhotos, addListingPhotos, deleteListingPhoto, reorderListingPhotos, onEbayChanged`), `ipc-channels.test.cjs` (`H3B1_CHANNELS`) und Task 7.
- Zwillinge: `ebayMark/setupItems/setupOk/expiryText/photoCountText` (JS) = `mark/setupItems/setupOk/expiryText/photoCountText` (Kotlin, Abweichung der Status-Form im Kopfkommentar); `listing-text.ts` = Teilmenge von `listing-text.cjs` (gleiche Namen); Foto-Grenzen `listing-photos.cjs` = `PhotoScale.kt`; Foto-Adresse `ebay-map.ts#photoUrl` = `listing-photos.cjs#publicPhotoUrl` = `PhotoScale.publicUrl`.
- Texte: `ENDED_ON_EBAY`, `SOLD_ON_EBAY`, `EXPIRED` (ebay-plan.ts) erscheinen am Gerät nur über `ebay_listings.error` bzw. `last_error`; `NO_IMAGE`, `missingText` ebenso.

**Bekannte Grenzen:**
- Die Funktionen sind nur gegen nachgebautes eBay getestet; echte Pflichtmerkmal-Namen auf eBay.de, die Sandbox-Anzeigen-Adresse, `ListingStatusEnum`-Werte und die Seiten-Adresse der Geschäftsrichtlinien prüft erst die Sandbox-Abnahme.
- `ebay-store.ts` (echter Datenbankzugriff) und `supabase-deps.ts` sind nur typgeprüft (`deno check`), nie gegen eine Datenbank gelaufen (Agents dürfen nicht).
- Oberflächen (Task 7, 9) und Kotlin sind nicht im Fenster/am Gerät geklickt bzw. vom Plan-Autor nicht kompiliert.
- `nativeImage` wendet keine EXIF-Drehung an: ein hochkant fotografiertes Handy-Bild, das am PC gewählt wird, kann gedreht ankommen (am Handy wird gedreht).
- Zwischen einem eBay-Verkauf und dem Buchen in der App (H3b2 fehlt) schützt nur `sold_seen`: Änderungen an dieser Anzeige werden verweigert, bis „Erneut versuchen“; eine ganz ausverkaufte Anzeige erscheint als „auf eBay beendet“.
- Nach einem Teilverkauf anderswo steigt der eBay-Stückpreis (Befund Code 3), bis der Nutzer den Angebotspreis anpasst.
- Ohne Anstoß vergehen bis zu 5 Minuten zwischen Änderung und eBay (Spec §12); ein Handy ohne Netz stößt nicht an, der Zeitplan holt es nach.

**Widersprüche und Lücken in der Spec (dem Nutzer vorlegen):**
- §4.3 „HTML-Seite“ ist auf der Supabase-Standard-Domain nicht möglich (Abweichung 1).
- §8 `pg_try_advisory_lock` wirkt über PostgREST nicht über einen ganzen Lauf (Abweichung 2).
- §5.2: Konvolute in 183455 (Abweichung 10, Nutzer 22.09.); Zustand ohne Deskriptor in 183455 unbestätigt — Sandbox.
- §5.3 sagt nichts dazu, wie oft „manuell beendet“ geprüft wird und was ein unverändertes, abgelehntes Angebot tut (Abweichungen 3, 5).
- §4.3 `set_environment` „trennt“ — ohne Sperre blieben Anzeigen der alten Umgebung für immer online (Abweichung 7).
