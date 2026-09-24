# Spec H3b2 — eBay-Verkäufe automatisch: Umsetzungsplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development` (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte sind Kästchen (`- [ ]`).

**Ziel:** eBay-Bestellungen zu App-Angeboten werden in der Cloud automatisch als H2-Verkauf gebucht. Dabei gilt:
- Preis und Versand kommen aus der Bestellung.
- Die Gebühren sind zuerst vorläufig und werden später durch die echten aus eBays Finanzdaten ersetzt.
- Danach wird wie bei einer Buchung von Hand aufgeräumt: Das Angebot ist ganz oder teilweise verkauft, und die Karten verschwinden aus anderen Angeboten.

Storniert der Käufer vor dem Versand, wird der Verkauf storniert, und die Karten kommen zurück. Hinweise erscheinen auf Start und als Banner unter „Angebote“ (PC und Handy), am PC zusätzlich als Windows-Benachrichtigung. Das Handy braucht dafür keinen PC.

**Architektur:** Der bestehende Abgleicher `ebay-sync` bekommt die Schritte 2 (Bestellungen abholen und buchen) und 3 (Gebühren nachtragen) aus Spec §8.
- **Regeln:** Alle Regeln liegen in reinen Deno-Modulen unter `supabase/functions/_shared/`. Es gibt zwei neue Zwillinge: `sales-math.ts` (Marktwert und Aufteilung) und die Erweiterung von `listing-text.ts` (Verkauf aus dem Angebot, Aufräumen). Dazu kommt `ebay-orders.ts` (Bestellung → Buchung, Gebühren-Regel).
- **Ein- und Ausgabe:** Die IO läuft über die bestehende `Store`-Schnittstelle. Tests nutzen `fake-store.ts` und `fake-ebay.ts`, beide werden um Bestellungen und Finanzdaten erweitert.
- **Buchen:** Die Funktion bucht über die bestehenden SQL-Funktionen `book_sale`, `update_sale` und `cancel_sale`. Es gibt also keine zweite Buchungslogik.
- **Neue Cloud-Tabellen:**
  - `ebay_orders` schreibt nur die Funktion. Die Geräte lesen sie und leiten daraus die Marke „Gebühren vorläufig“ ab.
  - `sale_notices` schreibt ebenfalls die Funktion. Die Geräte lesen sie und dürfen nur `dismissed` setzen.

**Technik:** Deno 2 (`jsr:@std/assert@1`, `jsr:@supabase/supabase-js@2`), eBay Sell Fulfillment API und Sell Finances API, Postgres/PostgREST, Electron CJS mit better-sqlite3 und `Notification`, React/Vite mit Tailwind, Kotlin/Compose mit OkHttp und JUnit4.

**Spec:** `docs/superpowers/specs/2026-09-22-spec-h3b-ebay-api.md` §7, §8 (Schritte 2 und 3), §9, §10 und §11 „H3b2“. **Setzt voraus:** H3b1 (`911c31f`), H2 und H3a. Stand `main` = `e6019ae`.

---

## Vor dem Start: Fragen an den Nutzer

1. **Ist H3b1 bei dir eingerichtet?** Gemeint sind SQL `ebay_schema.sql`, die Secrets, der Deploy von `ebay-auth` und `ebay-sync` und der Zeitplan. Außerdem die Frage, ob in der Sandbox schon verbunden und der Check grün ist. Ohne das lässt sich H3b2 nur mit nachgebautem eBay testen, die Abnahme (Task 11) setzt es voraus.
2. **Deno installieren.** Deno fehlt auf diesem Laptop, alle Cloud-Tests brauchen es. Vorschlag: `winget install DenoLand.Deno`. Das ist ein Download und braucht dein Okay.
3. **Die Abweichungen unten** (A1–A6) bitte absegnen.

## Abweichungen von der Spec (bitte absegnen)

| # | Spec | Vorschlag | Warum |
|---|---|---|---|
| A1 | §7.2 vorläufige Gebühren = Preis × Kanal-Prozentsatz | **eBays `totalMarketplaceFee` aus der Bestellung**. Nur wenn das Feld fehlt, gilt der Prozentsatz. | Der Kanal „eBay“ steht auf 0 %, die vorläufige Gebühr wäre also immer 0 €. Die Bestellung liefert laut eBay-Vertrag die aufgelaufenen Gebühren gleich mit. Die Finanzdaten bleiben die endgültige Quelle (§7.3). |
| A2 | §7.3 Gebühren „per `update_sale` nachtragen“ | Nur wenn die Gebühr im Verkauf **noch dem vorläufigen Wert entspricht**. Hat der Nutzer sie inzwischen selbst geändert, bleibt seine Zahl, und die Marke entfällt trotzdem. | Eine Eingabe von Hand wird nie still überschrieben. |
| A3 | §7.1 Status `gebucht`, `storniert`, `fehler` | Zusätzlich **`fremd`** für Bestellungen ohne App-SKU (`L-…`). | Wer auf eBay auch von Hand verkauft, soll dadurch weder Fehler noch jede Runde einen neuen Versuch bekommen. |
| A4 | §7.1 „Bestellungen seit `orders_cursor`“ | Der erste Lauf beginnt beim **Verbindungszeitpunkt** (`connected_at`). Jeder Lauf fragt ab Cursor minus **10 Minuten Überlappung**. | Alte Bestellungen von vor der App werden nicht gebucht. Die Überlappung fängt spät geschriebene Änderungen auf, `ebay_orders` verhindert doppelte Buchungen. |
| A5 | §7.6 „PC zieht sie als Strom (Wegtippen wird geschoben)“ | Der PC zieht `sale_notices` als **Nur-Lese-Strom**. Wegtippen schreibt direkt in die Cloud, wie „Erledigt“ bei den Preis-Alarmen (`price-alerts-event-dismiss`). | Das ist dasselbe Muster wie bei den Preis-Alarmen, braucht keinen zweiten Schreibweg und keinen Konflikt um `dismissed`. Offline ist Wegtippen deshalb gesperrt. |
| A6 | H3a-Regel `afterListingSale`: bei Teilverkauf außerhalb von Cardmarket bleibt der Gesamtpreis, dazu `askAdjust` | **eBay wie Cardmarket:** Der Rest kostet Stückpreis × Restmenge. Das gilt in allen vier Fassungen, dazu kommt ein Fixture-Fall. | eBay rechnet mit Stückpreis (H3b1 §5.2). Bliebe der Gesamtpreis, würde der Stückpreis des Rests nach jedem Teilverkauf steigen, und ein automatischer Weg kann niemanden fragen. |

## Befunde aus der eBay-Doku

Quelle sind die OpenAPI-Verträge `sell_fulfillment_v1_oas3.json` und `sell_finances_v1_oas3.json` von developer.ebay.com, gelesen am 24.09.2026.

- **Bestellungen abholen:**
  - Aufruf: `GET {api}/sell/fulfillment/v1/order?filter=lastmodifieddate:[<ISO>..]&limit=200&offset=<n>`, höchstens 200 je Seite.
  - Antwort: `orders`, `total`, `next`, `offset`, `limit`.
  - `getOrders` liefert nur abgeschlossene Kaufabwicklungen, also keine offenen Zahlungen.
- **Bestellung (`Order`):**
  - Kopffelder: `orderId`, `creationDate`, `lastModifiedDate`, `orderFulfillmentStatus`, `orderPaymentStatus`.
  - `cancelStatus.cancelState` ist immer da, ohne Storno steht dort `NONE_REQUESTED`, storniert ist `CANCELED`.
  - Beträge: `pricingSummary.priceSubtotal`, `pricingSummary.deliveryCost`, `pricingSummary.total` und `totalMarketplaceFee`.
  - Positionen: `lineItems[]` mit `lineItemId`, `sku`, `legacyItemId`, `quantity`, `lineItemCost` (Stückpreis × Menge) und `deliveryCost.shippingCost`.
  - Alle Beträge sind `{ value: string, currency }`.
- **Finanzdaten:**
  - Aufruf: `GET {apiz}/sell/finances/v1/transaction?filter=orderId:{<id>}&filter=transactionType:{SALE}`.
  - **Eigener Host:** `apiz.ebay.com`. Für die Sandbox vermutlich `apiz.sandbox.ebay.com`, das prüft erst die Abnahme.
  - Der Kopf **`X-EBAY-C-MARKETPLACE-ID: EBAY_DE`** ist Pflicht, sonst gilt EBAY_US.
  - `Transaction.totalFeeAmount` ist die Summe der Verkaufsgebühren der Bestellung und kommt auch mit 0.
  - Recht: `sell.finances`. Das ist schon in `USER_SCOPES`, also muss niemand neu verbinden.
- **`order_earnings`** gibt es nur für US, China und Hongkong. Es kommt nicht in Frage.

## Globale Vorgaben

- Es gelten alle Global Constraints aus dem H3b1-Plan (`2026-09-22-spec-h3b1-…`, Abschnitt „Global Constraints“), besonders diese:
  - Agents führen kein SQL aus, deployen nichts und rufen keine Edge Function auf.
  - Keine Tokens in Protokollen.
  - `deno.lock` wird nie gestaged.
  - Geld in ganzen Cent.
  - Vergleiche per Codeeinheiten.
  - Nur-Lese-Ströme schieben nie.
- **Kein Doppelbuchen.** `sale_id = 'ebay-' + environment + '-' + orderId`. Meldet `book_sale` „Verkauf bereits gebucht.“, gilt die Bestellung als gebucht (Wiederanlauf nach Abbruch). `ebay_orders` wird erst **nach** der Buchung geschrieben.
- **Exemplar-Auswahl ist deterministisch:** je Position die ersten q lebenden Angebots-Positionen, sortiert nach `copy_id` (Spec §7.2).
- **Datum:** `creationDate` wird in das Kalenderdatum in Europe/Berlin umgerechnet (`Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' })`).
- **Zwillinge:** Kopfkommentar mit allen Fassungen, gemeinsame Fixture, und jede Fassung besteht dieselben Fälle.
- Prüfläufe nach jeder Aufgabe:
  - Deno (Repo-Wurzel): `deno test --allow-read --node-modules-dir=none supabase/functions/`
  - `deno check --node-modules-dir=none supabase/functions/ebay-sync/index.ts supabase/functions/ebay-auth/index.ts`
  - `cd desktop && node --test src/utils/*.test.js src/utils/*.test.mjs`
  - `cd desktop && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
  - `cd desktop && npx eslint .`: genau 5 Fehler
  - `cd desktop && npx vite build`
  - `cd android && ./gradlew testDebugUnitTest assembleRelease` (JBR als `JAVA_HOME`, `local.properties` nie anfassen)
- Commits deutsch, Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Kein `git stash`, nur explizite Pfade stagen.

---

## Dateiübersicht

| Datei | Inhalt | Task |
|---|---|---|
| `_shared/sales-math.ts` (neu) mit Test, `_shared/condition-factors.ts` (neu) | Deno-Zwilling: `toCents`, `unitPrice`, `conditionFactor`, `marketValueCents`, `netCents`, `feeDefaultCents`, `distribute` | 1 |
| `_shared/listing-text.ts` mit Test | dazu `afterListingSale`, `cleanupAfterSale`, `rowTitle` | 2 |
| `docs/fixtures/listings/listings.json`, `listing-text.cjs`, `src/utils/listingText.js`, `ml/ListingText.kt` | A6: eBay-Teilverkauf wie Cardmarket | 2 |
| `docs/fixtures/ebay/orders.json` (neu), `_shared/ebay-orders.ts` (neu) mit Test | Bestellung → Buchung, Gebühren-Regel, Hinweistexte | 3 |
| `_shared/ebay-client.ts`, `fake-ebay.ts` | `getOrders`, `saleTransactions` (Host `apiz`, Marktplatz-Kopf) | 4 |
| `supabase/ebay_orders_schema.sql` (neu) | `ebay_orders`, `sale_notices`, Regeln, Rechte, `grant execute` an `service_role` | 5 |
| `_shared/ebay-store.ts`, `fake-store.ts`, `ebay-sync/sync.ts` mit Test | Schritte 2 und 3, Hinweise, `sold_seen` | 6 |
| `desktop/electron/ebay-schema.cjs`, `sync.cjs`, `main.cjs`, `preload.cjs`, `ipc-channels.test.cjs`, `notice-notify.cjs` (neu) | PC: zwei Nur-Lese-Ströme, Wegtippen, Windows-Benachrichtigung | 7 |
| `src/utils/saleNotices.js` (neu), `Start.jsx`, `ListingsList.jsx`, Verkaufsliste und Verkaufsdetail | PC-Oberfläche | 8 |
| `cloud/EbayRepository.kt`, `SideStores.kt`, `ui/StartScreen.kt`, `ui/ListingsScreen.kt`, `ui/SalesScreen.kt`, `ml/SaleNotices.kt` (neu) | Handy | 9 |
| `supabase/README_ebay_cloud.md` | Anleitung: SQL, erneuter Deploy von `ebay-sync` | 10 |

Reihenfolge: 1 → 2 → 3 → 4 → 5 → 6, danach 7 → 8 und 9 (8 und 9 dürfen parallel laufen, weil sie getrennte Dateien betreffen), zuletzt 10 und 11.

---

### Task 1: Deno-Zwilling `sales-math.ts`

**Dateien:** `supabase/functions/_shared/sales-math.ts`, `sales-math_test.ts`, `condition-factors.ts`

- [ ] `condition-factors.ts` exportiert die Faktoren als Konstante. Ein Test liest `desktop/electron/condition-factors.json` und verlangt Gleichheit. Hintergrund: Der Deploy bündelt nur `supabase/functions/`, ein Import außerhalb würde dort brechen.
- [ ] Folgende Funktionen genau wie `desktop/electron/sales-math.cjs` bauen: `toCents`, `unitPrice(card, copy)` (1. Auflage: `price_first_ed`, falls vorhanden), `conditionFactor`, `marketValueCents`, `netCents`, `feeDefaultCents` und `distribute` (Rest an die erste Position mit dem größten Gewicht, bei W = 0 alle Gewichte 1).
- [ ] Tests laufen gegen `docs/fixtures/sales/sales.json`, Abschnitte `marketValue`, `net`, `feeDefault` und `distribute`, jeder Fall einzeln.
- [ ] Kopfkommentar: ZWILLING von `sales-math.cjs`, `src/utils/saleMath.js` und `ml/SalesMath.kt`.
- [ ] Schutz-Nachweis: Den Rest in `distribute` testweise an die letzte Position geben, der Fixture-Fall muss scheitern, danach zurücknehmen.
- [ ] Commit `feat(h3b2): Deno-Zwilling sales-math (Marktwert, Aufteilung)`.

### Task 2: `listing-text.ts` erweitern und A6 in allen Fassungen

**Dateien:**
- Deno: `_shared/listing-text.ts` und `listing-text_test.ts`
- PC: `desktop/electron/listing-text.cjs` und `listing-text.test.cjs`, `desktop/src/utils/listingText.js` und `listingText.test.js`
- Handy: `ml/ListingText.kt` und `ListingTextTest.kt`
- Fixture: `docs/fixtures/listings/listings.json`

- [ ] In der Fixture `afterSale` kommt der Fall „eBay-Teilverkauf: Rest = Stückpreis × Restmenge“ dazu: `channel_id: "ebay"`, Preis 10,00, live `c1` bis `c4`, verkauft `c1`. Ergebnis: `aktiv`, `[c1]`, 750 Cent, `askAdjust: false`. Ein bestehender Fall mit `kleinanzeigen` bleibt als Beleg für die unveränderte Regel dort.
- [ ] In allen vier Fassungen gilt `channel_id === 'cardmarket' || channel_id === 'ebay'` als Stückpreis-Kanal. Kommentar: „A6 H3b2“.
- [ ] Deno bekommt `afterListingSale`, `cleanupAfterSale`, `rowTitle` und `isActive` aus `listing-text.cjs`. Die Tests laufen gegen die Fixture-Abschnitte `afterSale`, `rowTitleCases` und `board` (Aufräumen). Welcher Abschnitt die `cleanupAfterSale`-Fälle trägt, zuerst in der Fixture nachsehen.
- [ ] Commit `feat(h3b2): Aufraeumen nach Verkauf als Deno-Zwilling; eBay-Teilverkauf mit Stueckpreis (A6)`.

### Task 3: Bestellung → Buchung als reine Regel (`ebay-orders.ts`)

**Dateien:** `docs/fixtures/ebay/orders.json` (neu), `_shared/ebay-orders.ts`, `ebay-orders_test.ts`

Die Regeln, jeweils rein und ohne Aufrufe:
- [ ] **`parseOrder(o, env)`** liefert `{ orderId, saleId, soldOn, lines: [{ lineItemId, sku, listingId | null, quantity, itemCents, shippingCents }], grossCents, feeCents | null, cancelled, refunded }`.
  - `listingId` stammt aus `sku` `^L-(.+)$`.
  - `grossCents = priceSubtotal + deliveryCost`, beide aus `pricingSummary`.
  - `feeCents` stammt aus `totalMarketplaceFee`, sonst ist es `null`.
  - `cancelled` gilt bei `cancelStatus.cancelState === 'CANCELED'`.
  - `refunded` gilt bei `orderPaymentStatus` `FULLY_REFUNDED` oder `PARTIALLY_REFUNDED`.
- [ ] **`kind(order)`**: `fremd`, wenn keine Position eine App-SKU hat. Gemischte Bestellungen buchen nur die App-Positionen und schreiben den Hinweis „eBay-Bestellung <Nr.> enthält Artikel ohne App-Angebot“.
- [ ] **`pickCopies(lines, liveByListing)`** wählt je Position die ersten q lebenden `copy_id` (sortiert). Das Ergebnis ist `{ copyIds, missing }`, wobei `missing` die Zahl der fehlenden Exemplare für §7.5 ist.
- [ ] **`bookingFor(order, picked, cardsByCopy, feePercent)`** liefert `p_sale` und `p_items` für `book_sale`:
  - Kanal `ebay`, Name „eBay“.
  - `gross` ist `grossCents`.
  - `fees` ist `feeCents` oder `feeDefaultCents(gross, feePercent)` (A1).
  - `shipping` ist `null`.
  - `note` ist „eBay-Bestellung <orderId>“.
  - Die Anteile sind `distribute(net, marketValues)` über die nach `copy_id` sortierten Exemplare.
- [ ] **`feeUpdate({ saleFeesCents, provisionalCents, finalCents })`** (A2):
  - `final` ist null: nichts tun, `fees_final` bleibt false.
  - Die Gebühr im Verkauf entspricht dem vorläufigen Wert: `update`, danach `fees_final`.
  - Sonst: `keep`, danach `fees_final`.
- [ ] **`finalFeeCents(transactions)`**: Summe von `totalFeeAmount` über alle `SALE`-Transaktionen der Bestellung. Ohne Transaktion ist das Ergebnis `null`.
- [ ] **Hinweistexte** als Konstanten (`kind`):
  - `shipping`: „Versandkosten für eBay-Bestellung <Nr.> nachtragen“
  - `error`: „eBay-Verkauf, aber Karte schon anderswo verkauft – bitte prüfen“ (§7.5)
  - `error`: „eBay-Bestellung <Nr.> ohne lebende Karte – nicht gebucht“
  - `reminder`: „eBay-Bestellung <Nr.> storniert – Karten sind zurück. Angebot erneut anbieten?“ (§7.4)
  - `reminder`: „eBay meldet eine Erstattung zu Bestellung <Nr.> – bitte prüfen“
  - Aufräum-Erinnerung je Angebot aus `cleanupAfterSale.remind` (Wortlaut wie in H3a)
  - `token`: „eBay-Verbindung läuft am <Datum> ab – bitte neu verbinden“, 30 Tage vorher
- [ ] Fixture `orders.json`:
  - Einzelkarte
  - drei gleiche Karten als eine Position
  - zwei Positionen
  - fremde SKU
  - gemischt
  - ohne `totalMarketplaceFee`
  - storniert
  - erstattet
  - weniger lebende Exemplare als Menge
  - `creationDate` 23:30 UTC (Berliner Datum = Folgetag)
- [ ] Commit `feat(h3b2): Bestellung zu Buchung als reine Regel mit Fixture`.

### Task 4: eBay-Client für Bestellungen und Finanzdaten

**Dateien:** `_shared/ebay-client.ts`, `ebay-client_test.ts`, `fake-ebay.ts`

- [ ] `HOSTS` bekommt ein Feld `apiz` (`https://apiz.ebay.com` bzw. `https://apiz.sandbox.ebay.com`), Kommentar „Befund prüfen in der Abnahme“.
- [ ] `ebayApi(...).getOrders(sinceIso, offset)` ruft `filter=lastmodifieddate:[<since>..]&limit=200&offset=…` auf, blättert über `next` und `total`, bis alles geholt ist, und gibt die Liste zurück. `saleTransactions(orderId)` ruft `apiz` mit dem Kopf `X-EBAY-C-MARKETPLACE-ID: EBAY_DE` auf.
- [ ] `fake-ebay.ts` bekommt Optionen für `orders`, `transactions` (je `orderId`) und `ordersDown`. Tests decken ab: Blättern über zwei Seiten, Filter-Syntax in der Adresse, Host und Kopf der Finanzabfrage, 401 → `auth`, 503 → `transient`.
- [ ] Commit `feat(h3b2): eBay-Client Bestellungen und Finanzdaten`.

### Task 5: Cloud-SQL `supabase/ebay_orders_schema.sql` (nur Datei, nichts ausführen)

- [ ] Die Datei ist **idempotent**.
- [ ] **`ebay_orders`:**
  - Spalten: `order_id` (Schlüssel), `environment`, `sale_id`, `status` (`gebucht` | `storniert` | `fehler` | `fremd`), `fees_provisional numeric(12,2)`, `fees_final boolean not null default false`, `raw_total numeric(12,2)`, `error text`, `created_at`, `updated_at`.
  - Trigger `set_updated_at`.
  - RLS: nur `select` für `authenticated`.
- [ ] **`sale_notices`:**
  - Spalten: `notice_id text` (Schlüssel, deterministisch, z. B. `ship-<sale_id>`, damit derselbe Hinweis nie doppelt entsteht), `kind` mit Prüfregel, `text`, `sale_id`, `listing_id`, `dismissed boolean`, `created_at`, `updated_at`.
  - RLS: `select` für `authenticated`. `update` nur `dismissed`, per `grant update (dismissed)` und Regel.
- [ ] `grant execute` auf `book_sale`, `update_sale` und `cancel_sale` an `service_role` (sicherheitshalber, auch wenn Supabase das per Voreinstellung schon tun könnte).
- [ ] Prüfabfragen und erwartete Ergebnisse stehen als Kommentar am Ende, wie in `ebay_schema.sql`.
- [ ] Commit `feat(h3b2): Cloud-SQL ebay_orders und sale_notices`.

### Task 6: `ebay-sync` Schritte 2 und 3

**Dateien:** `_shared/ebay-store.ts`, `fake-store.ts`, `ebay-sync/sync.ts`, `sync_test.ts`

- [ ] **`Store` erweitern:**
  - Lesen: `orders(ids)`, `openFeeOrders()` (`gebucht` und nicht `fees_final`), `saleFees(saleId)`, `channelFeePercent('ebay')`, `listingState(listingIds)` (Angebot, Positionen, lebende Exemplare, Karten für den Marktwert).
  - Schreiben: `saveOrder(row)`, `bookSale(p_sale, p_items)` (Fehlertext „Verkauf bereits gebucht.“ zählt als Erfolg), `updateSaleFees(saleId, feesCents)`, `cancelSale(saleId)`, `applyListingSale(listingId, result)`, `cleanup(removeItems, endListings)`, `addNotice(n)` (Upsert mit `ignoreDuplicates`) und `bumpSoldSeen(listingId, qty)`.
  - `supabaseStore` blättert wie bisher.
- [ ] **Schritt 2**, nach Schritt 1 und vor Schritt 4, nur mit Verbindung:
  - `since` wird aus `orders_cursor` oder `connected_at` bestimmt (A4).
  - Für jede Bestellung, sortiert nach `lastModifiedDate` und dann `orderId`:
    - Neu und nicht storniert: buchen (Task-3-Regeln), das Angebot per `afterListingSale` behandeln, die anderen Angebote per `cleanupAfterSale` aufräumen, `sold_seen` erhöhen und die Hinweise schreiben.
    - Schon gebucht und jetzt storniert: `cancel_sale` und Hinweis (§7.4).
    - Storniert, bevor sie gebucht wurde: nur `storniert` festhalten.
  - Ein **Einzelfehler** (z. B. `book_sale` meldet „Karte bereits verkauft …“) betrifft nur diese Bestellung. Sie wird `fehler` mit Hinweis und beim nächsten Lauf **nicht** erneut versucht.
  - `transient` oder `auth` bricht den Durchgang ab, der Cursor bleibt stehen.
  - Den Cursor danach auf das größte `lastModifiedDate` setzen.
- [ ] **Schritt 3:** Für jede offene Gebühren-Bestellung, höchstens 20 je Lauf, `saleTransactions` holen und `feeUpdate` anwenden.
- [ ] **Token-Hinweis:** 30 Tage vor `refresh_expires_at` einmalig, über den deterministischen Schlüssel `token-<Ablaufdatum>`.
- [ ] Das Zeitbudget (`RUN_BUDGET_MS`) gilt für alle Schritte, Reste gehen in den nächsten Lauf. `summaryText` bekommt „n gebucht · n storniert“, aber nur wenn > 0.
- [ ] **`SOLD_ON_EBAY`:** Mit `bumpSoldSeen` löst ein automatisch gebuchter Verkauf beim `check` keinen Fehler mehr aus. Der alte Text bleibt für Bestellungen, die nicht gebucht werden konnten.
- [ ] **Tests** mit nachgebautem eBay:
  - Einzelkarte gebucht, Angebot `verkauft`
  - Teilverkauf 1 von 3 (Rest 2, Preis nach A6)
  - Bestellung doppelt geliefert (Überlappung) → einmal gebucht
  - Abbruch nach `book_sale` und vor `saveOrder` → im nächsten Lauf `gebucht` ohne zweite Buchung
  - Storno nach Buchung (Karten zurück, Hinweis)
  - Storno vor Buchung
  - Karte schon anderswo verkauft (Teilbuchung und Hinweis)
  - keine lebende Karte (`fehler`)
  - fremde SKU
  - Gebühren nachgetragen
  - Gebühr vom Nutzer geändert (bleibt)
  - Finanzdaten noch leer
  - Token-Hinweis
  - eBay nicht erreichbar (Cursor bleibt)
  - zweiter paralleler Lauf
- [ ] Commit `feat(h3b2): ebay-sync bucht Bestellungen, traegt Gebuehren nach, schreibt Hinweise`.

### Task 7: PC-Daten

**Dateien:** `desktop/electron/ebay-schema.cjs`, `sync.cjs`, `main.cjs`, `preload.cjs`, `ipc-channels.test.cjs`, `notice-notify.cjs` (neu) mit Test

- [ ] Lokale Tabellen `ebay_orders` und `sale_notices` ohne Trigger, mit den Cloud-Zeitstempeln. `READ_ONLY_STREAMS` bekommt beide Einträge, mit eigenen Cursorn. Ein Wächter-Test prüft, dass keiner der beiden in `SALES_STREAMS` steht.
- [ ] Neue IPC-Kanäle:
  - `sale-notices` liefert die nicht weggetippten Hinweise, neueste zuerst.
  - `sale-notice-dismiss(id)` schreibt direkt in die Cloud (A5) und setzt die Zeile lokal auf `dismissed = 1`.
  - `ebay-orders` liefert eine Tabelle von `sale_id` zu `{ status, fees_final }`.
- [ ] Ereignis `sale-notices-changed`, wenn der Pull etwas geändert hat.
- [ ] `notice-notify.cjs` arbeitet nach dem Muster von `alert-notify.cjs`: eine Markierung über `created_at`, der erste Lauf benachrichtigt nicht. Eine neue Meldung zeigt ihren Text, mehrere zeigen „n neue eBay-Hinweise“. Ein Klick öffnet `/verkaufen/angebote`.
- [ ] Commit `feat(h3b2): PC zieht eBay-Bestellungen und Hinweise, Windows-Benachrichtigung`.

### Task 8: PC-Oberfläche

- [ ] Reiner Helfer `saleNotices.js` für Sortierung und Kurztext, mit Test.
- [ ] **Start:** Karte „eBay-Hinweise“ über den Preis-Alarmen, nur wenn Hinweise da sind. Sie zeigt höchstens drei, jeder mit „Erledigt“, dazu „Alle ansehen“.
- [ ] **Angebote:** Banner über der Summenzeile mit allen offenen Hinweisen und „Erledigt“ je Hinweis.
- [ ] **Verkäufe:** Marke „Gebühren vorläufig“ in der Liste und im Detail, wenn eine `ebay_orders`-Zeile mit `fees_final = false` dazu existiert.
- [ ] Oberfläche bei 1280 und 1920 px Breite prüfen (CDP-Skripte aus dem Scratchpad), dazu den Kontrast-Audit.
- [ ] Commit `feat(h3b2): PC zeigt eBay-Hinweise und vorlaeufige Gebuehren`.

### Task 9: Handy

- [ ] **`EbayRepository`:** `loadNotices()` (mit `dismissed=eq.false`, blättert), `dismissNotice(id)` (PATCH) und `loadOrders()`. Dazu `SideStores.saleNotices` und `SideStores.ebayOrders`, beide auch in `Preload.startSideStores` und im `ForegroundTick`.
- [ ] **Start:** eine Sektion „eBay-Hinweise“ nach dem Muster von `PriceAlertsSection` (Erledigt, optimistisch aus dem Zwischenspeicher entfernen, Fehlertext), gleich nach `SyncHint`.
- [ ] **Angebote** (`ListingsScreen`): ein Banner über den Filter-Chips.
- [ ] **Verkäufe** (`SalesScreen`): die Marke „Gebühren vorläufig“ in `SaleRowView` (zweite Zeile, wie `DoubleBadge`) und bei „Gebühren“ in `SaleDetailSheet`.
- [ ] Reiner Helfer `ml/SaleNotices.kt` für Sortierung und Marke. Er ist ZWILLING von `saleNotices.js` mit gemeinsamer Fixture `docs/fixtures/ebay/notices.json`.
- [ ] Commit `feat(h3b2): Handy zeigt eBay-Hinweise und vorlaeufige Gebuehren`.

### Task 10: Anleitung

- [ ] Neuer Abschnitt „H3b2“ in `supabase/README_ebay_cloud.md`:
  1. `ebay_orders_schema.sql` einspielen und mit den Prüfabfragen kontrollieren.
  2. `supabase functions deploy ebay-sync --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn`. Der Zeitplan bleibt, wie er ist.
  3. Neue PC- und Handy-Builds installieren.
- [ ] Commit `docs(h3b2): Anleitung Bestellungen und Hinweise`.

### Task 11: Bauen, aufspielen, Abnahme in der Sandbox (mit dem Nutzer)

- [ ] PC-Installer bauen und installieren. Im installierten `app.asar` muss `sale-notices` vorkommen (`grep -c`). Release-APK bauen, aufspielen, App starten und `adb logcat -b crash` prüfen.
- [ ] **Achtung:** Auch Sandbox-Bestellungen buchen **echte** Verkäufe in deiner Sammlung, weil es nur eine Sammlung gibt. Deshalb die Abnahme mit einer billigen Karte machen. Am Ende wird der Sandbox-Verkauf storniert, und die Karte ist wieder da.
- [ ] Ablauf:
  1. Karte über ein eBay-Angebot in die Sandbox stellen.
  2. Ein Sandbox-Käuferkonto kauft.
  3. Innerhalb von 5 Minuten (oder sofort über „Jetzt abgleichen“) erscheint der Verkauf mit Preis und Versand. Die Gebühren sind „vorläufig“, dazu kommt der Hinweis „Versandkosten nachtragen“, am PC auch eine Windows-Benachrichtigung. Das Angebot ist `verkauft`.
  4. Später sind die Gebühren endgültig, die Marke ist weg. Das kann in der Sandbox dauern oder ausbleiben (Befund).
  5. Ein zweiter Kauf wird storniert. Der Verkauf ist dann storniert, die Karte zurück, und der Hinweis erscheint.
  6. Teilverkauf 1 von 2 mit A6-Preis.
  7. Hinweise wegtippen, auf PC und Handy.
- [ ] Abnahme-Protokoll `docs/superpowers/ledgers/2026-09-xx-h3b2-abnahme.md`. Merge in `main` erst danach, Push nur auf Zuruf.

## Risiken

- **Sandbox-Finanzdaten** bleiben oft leer. Schritt 3 ist dann nur mit nachgebautem eBay belegt, und die Marke „vorläufig“ bleibt in der Sandbox stehen.
- **`apiz.sandbox.ebay.com`** ist nicht aus dem Vertrag belegt (dort stehen nur die Produktions-Hosts).
- **Konflikt mit dem PC:** Ändert der PC gerade dasselbe Angebot, ohne es schon geschoben zu haben (`localWinsUnpushed`), gewinnt nach dem nächsten Push die PC-Fassung, und das Aufräumen der Cloud geht verloren. Der Verkauf selbst bleibt gebucht. Das ist selten, eine Prüfung in der Abnahme reicht.
- **Rücksendungen und Erstattungen nach Versand** bleiben manuell (Spec). Es gibt nur einen Hinweis bei `refunded`.
