# Spec: eBay „zuletzt verkauft“ (E1 Daten, E2 Nutzen)

**Datum:** 2026-10-05
**Setzt voraus:** H3b1/H3b2 (eBay-Client, Secrets `EBAY_PROD_*`, `EBAY_CRON_SECRET`, Nur-Lese-Spiegel-Muster), G4/G4b (1st-Ed-Faktor, Bewertungs-Zwillinge).
**Status:** Entwurf vom Nutzer im Chat Abschnitt für Abschnitt abgesegnet (2026-10-05); Spec zur Durchsicht.
**Abhängigkeit von außen:** Scope `buy.marketplace.insights` (Marketplace Insights API, „Limited Release“) — vom Nutzer am 2026-10-05 bei eBay beantragt, noch nicht freigeschaltet. E1 wird vollständig gebaut und getestet; es schaltet sich **selbst** ein, sobald eBay den Scope gewährt (§5).

---

## 1. Ziel

Je Druck einen zweiten Marktwert aus **tatsächlich verkauften** eBay-Artikeln (EBAY_DE, letzte 90 Tage), neben dem Cardmarket-Preis:
- **Anzeigen** als zweite Meinung (Karten-Detail, Verkaufen).
- **Lücken füllen**, wo Cardmarket nichts hat (kein Basispreis; kein 1.-Auflage-Aufschlag, weil G4b mangels Angeboten NULL liefert).

Cardmarket hat immer Vorrang; eBay überschreibt nie einen Cardmarket-Wert und schreibt nie in `cards.price`/`price_first_ed`.

**Erfolg:** Für wertvolle Drucke steht nach einer Woche ein eBay-Median mit Verkaufszahl und Belegen im Detail; Drucke ohne Cardmarket-Wert bekommen (E2) einen gekennzeichneten eBay-Wert statt 0.

## 2. Aufteilung

| Teil | Inhalt | Braucht |
|---|---|---|
| **E1 Daten** | Messung, Titelfilter + Wert, Cloud-Tabelle + Status, Edge Function (Zeitplan + Einzelabruf), Selbst-Einschalten, Nur-Lese-Spiegel PC + Handy, Anzeige im Karten-Detail, Knopf „jetzt bei eBay prüfen" | — |
| **E2 Nutzen** | Lücken füllen in den vier Bewertungs-Zwillingen, eBay-Median beim Verkaufen, „eBay"-Kennzeichnung an gefüllten Werten | E1 gemergt **und** echte Daten (Regeln am Bestand prüfen) |

E1 und E2 bekommen je einen eigenen Plan. E2 ist hier festgelegt (§9), wird aber erst nach E1 und mit Daten geplant.

## 3. Messung (E1, Task 1)

Vor dem Bau, ohne Insights-Zugang:
1. **Kategorie-Id** der Yu-Gi-Oh!-Einzelkarten auf EBAY_DE per Taxonomy-API (`categoryAspects`-Weg in `ebay-client.ts`, Anwendungs-Token mit Basis-Scope) bestimmen.
2. **Titel-Korpus:** über die Browse-API (`/buy/browse/v1/item_summary/search`, Basis-Scope, schon in `scrape-deals/ebay.ts` genutzt) für ~20 Drucke aus dem Bestand (Mischung DE/EN, Common bis Secret, mit/ohne 1. Auflage, darunter SDJ-G001 und MAMO-DE020) die aktiven Angebote per Set-Code holen und Titel, `conditionId`, Preis als Fixture speichern. Aktive Angebote haben dieselben Titel-Gewohnheiten wie verkaufte; daran wird der Titelfilter (§4) gebaut und gemessen (Trefferquote, Fehlzuordnungen, Anteil mit erkennbarer 1. Auflage).
3. **Antwortformat** von `item_sales/search` aus der eBay-Dokumentation als nachgebaute Antwort (Felder `itemSales[].itemId, title, lastSoldDate, lastSoldPrice{value,currency}, totalSoldQuantity, conditionId, itemWebUrl`); wird bei der Freischaltung gegen eine echte Antwort geprüft (§11).

Messwerkzeug wie in G4b: Wegwerf-Skript im Ledger, nur Fixtures werden eingecheckt (ohne Verkäufernamen). Die Messung ruft eBay-APIs direkt vom PC des Nutzers auf: Der Nutzer setzt `EBAY_PROD_CLIENT_ID`/`EBAY_PROD_CLIENT_SECRET` (aus dem eBay Developer Portal) nur als Umgebungsvariablen in seinem eigenen Terminal und startet das Skript selbst; die Werte landen nie in Repo, Ledger, Log oder Chat. **Keine Edge Function wird von Agents aufgerufen.**

## 4. Zuordnung und Wert (reine Funktionen, Deno/TS, getestet)

**Abfrage je Druck:** `GET /buy/marketplace_insights/v1_beta/item_sales/search?q=<set_code>&category_ids=<§3.1>&limit=200`, Kopf `X-EBAY-C-MARKETPLACE-ID: EBAY_DE`.

**Titelfilter `matchSale(title, conditionId, printing)`** — ein Verkauf zählt nur, wenn alle Regeln passen:
1. **Set-Code im Titel**, normalisiert (Groß/klein, Bindestrich/Leerzeichen egal: `MAMO-DE020` = `MAMODE020` = `MAMO DE020`).
2. **Keine fremde Rarity:** Nennt der Titel eine Rarity, die nicht die des Drucks ist (Rarity-Liste wie `RARITY_SYNONYMS`/`rarityKey` in `cardmarket-parse.cjs`, Lang- und Kurzformen „UR", „ScR", „QCSR", …), fällt er raus. Ohne Rarity-Nennung bleibt er drin.
3. **Ausschlüsse** (Wortgrenzen, Groß/klein egal): gegradet (`PSA`, `BGS`, `CGC`, `Beckett`, `graded`, `gegradet`, eBay-Zustand „Graded" laut Messung), Mengen (`Lot`, `Konvolut`, `Sammlung`, `Bundle`, `Playset`, `\d+\s*x`, `x\s*\d+`), Unechtes (`Proxy`, `Orica`, `Replica`, `Fan Made`, `Custom`), Verändert (`Altered`, `Signed`, `signiert`).
4. **Auflage** aus dem Titel: `1. Auflage`, `1.Auflage`, `1st Edition`, `1st Ed`, `Erstauflage`, `First Edition` → `first`; sonst `unknown`.

Die konkreten Wortlisten werden an der Messung (§3.2) geschärft; jede Regel hat Fixture-Fälle (Treffer und Nicht-Treffer).

**Wert `summarizeSales(sales)`** (nur Verkäufe in EUR, Artikelpreis ohne Versand, eine Zeile je `itemSales`-Eintrag; `totalSoldQuantity` > 1 zählt als ein Verkauf zum Zeilenpreis — Mengen-Angebote sind über Regel 3 ohnehin gefiltert):
- `median_all` = Median aller passenden Verkäufe, **mindestens 3**, sonst NULL.
- `median_first` = Median der passenden Verkäufe mit Auflage `first`, mindestens 3, sonst NULL.
- `n_all`, `n_first`, `last_sold_at`, `last_sold_price` (jüngster passender Verkauf).
- `sales` = die bis zu 20 jüngsten passenden Verkäufe `{ title, price, sold_at, url, first }`.
- `status`: `ok` (median_all gesetzt), `zu_wenig` (0–2 passende), `fehler` (Abruf scheiterte).

## 5. Speicherung und Schalter (Cloud, neue Datei `supabase/ebay_sold_schema.sql`)

**`public.ebay_sold_prices`** — PK `(card_id, set_code, language, rarity)`; Spalten `median_all numeric`, `n_all int`, `median_first numeric`, `n_first int`, `last_sold_at timestamptz`, `last_sold_price numeric`, `sales jsonb`, `status text`, `checked_at timestamptz`, `updated_at timestamptz default now()` (+ Trigger `updated_at` wie die anderen Tabellen). RLS: `select` für `authenticated`; schreiben nur die Edge Function (Service-Rolle) — Muster `ebay_listings`.

**`public.ebay_insights_state`** — eine Zeile (`id = 1`): `access text` (`unbekannt` | `aktiv` | `fehlt`), `last_error text`, `last_run_at timestamptz`, `calls_today int`, `calls_day date`. RLS: `select` für `authenticated`.

**Selbst-Einschalten:** Jeder Lauf fordert zuerst ein Anwendungs-Token **mit** Scope `https://api.ebay.com/oauth/api_scope/buy.marketplace.insights` an (`appToken` in `ebay-client.ts` bekommt einen optionalen Scope-Parameter). Antwortet eBay mit `invalid_scope`/403 → `access = fehlt`, Lauf endet ohne Suchabfrage. Gelingt es → `access = aktiv`. Der tägliche Zeitplan prüft das also jeden Tag mit einem einzigen Token-Aufruf; sobald eBay freischaltet, füllen sich die Werte ohne Zutun.

## 6. Edge Function `ebay-sold-prices` (E1)

Aufbau wie `ebay-sync`: `handler.ts` (Anfrage prüfen) + `run.ts` (Ablauf) + reine Module (`match.ts`, `summarize.ts`); `fetch` und Datenbank werden hereingereicht (Tests ohne Netz).

**Zugang:** pg_cron mit Kopf `x-ebay-secret = EBAY_CRON_SECRET` **oder** angemeldetes Gerät (`verifyUser`) — wie `handleSync`. Ohne `EBAY_CRON_SECRET` ist der Zeitplan-Weg zu.

**Zeitplan-Lauf** (pg_cron täglich 04:30 UTC, vor `refresh-cardmarket-prices` 05:00; Body `{ "minPrice": 5, "budget": 50 }`):
- Kandidaten (Cloud-SQL über `cards` + `card_copies`): lebender Druck (`deleted = false`, `quantity > 0`, `set_code <> 'Unknown'`) **und** mindestens eins von: `price >= minPrice`; ein lebendes Exemplar `edition = 'first'`; ein lebendes Exemplar `for_sale = true`; Druck in einem Angebot (`listing_items`).
- Davon die mit `checked_at` NULL oder älter als **7 Tage**, ältester Stand zuerst, höchstens `budget`.
- Je Kandidat: Abfrage (§4), `matchSale`, `summarizeSales`, Upsert in `ebay_sold_prices` mit `checked_at = now()`.
- `calls_today` zählt Suchabfragen (Tageswechsel setzt zurück).

**Einzelabruf** (Body `{ "printing": { card_id, set_code, language, rarity } }`, nur angemeldet): genau dieser Druck, unabhängig von Mindestwert und Frist; Antwort enthält die neue Zeile. Bei `access = fehlt` Antwort `{ ok: false, access: "fehlt" }` ohne Suchabfrage.

**Fehler:**
| Fall | Verhalten |
|---|---|
| Scope fehlt (`invalid_scope`/403 am Token) | `access = fehlt`, Lauf endet, nichts sonst geschrieben |
| 429 / 5xx / Zeitüberschreitung (transient) | Lauf bricht ab, `last_error`; bereits geschriebene Drucke bleiben; nächster Tag |
| 401 an der Suche | Token einmal neu holen, Abfrage wiederholen; erneut 401 → wie transient |
| Einzelner Druck: unerwartete Antwort | `status = fehler`, `checked_at` gesetzt (kein Dauerversuch), weiter mit dem nächsten |
| Secrets fehlen | Einrichtungsfehler in `last_error`, Lauf endet |

Nie Tokens/Secrets protokollieren (Regel aus `ebay-client.ts`).

## 7. Spiegel auf PC und Handy (E1)

- **PC:** Nur-Lese-Strom wie `ebay_listings` — lokale Tabelle `ebay_sold_prices` (in `ebay-schema.cjs` angelegt, `sales` als JSON-Text), Eintrag in `READ_ONLY_STREAMS`/`pullReadOnlyTable` mit Cursor `sync_ebay_sold_last_pull` auf `updated_at`; `ebay_insights_state` wird bei jedem Pull mitgelesen und in `settings` (`ebay_insights_access`) abgelegt. Kein Push.
- **Handy:** In E1 liest `EbaySoldRepository.kt` die Zeile **eines** Drucks per REST beim Öffnen des Details (plus `ebay_insights_state`) — E1 braucht den Wert nur dort. Der vollständige Delta-Spiegel in den Zwischenspeicher kommt mit E2 (Bewertung). (Präzisiert beim Planen, 05.10.)
- Neue IPC-Kanäle (`main.cjs` + `preload.cjs`): `ebay-sold-get` (Zeile eines Drucks + Zugangsstatus), `ebay-sold-check` (Einzelabruf über die Edge Function, wie die bestehenden eBay-Aufrufe aus H3b; danach Pull).

## 8. Anzeige im Karten-Detail (E1)

PC `CardDetailPanel.jsx`, Handy `CardDetailScreen.kt`, je Druck unter der Preiszeile. Text-Regel als getesteter **Zwilling** (`src/utils/ebaySold.js` ↔ `EbaySold.kt`, gemeinsame Fixture `docs/fixtures/ebay/sold-line.json`):

| Zustand | Zeile |
|---|---|
| `access = fehlt` | „eBay-Verkaufsdaten: Zugang noch nicht freigeschaltet" (einmal je Karte, nicht je Druck) |
| keine Zeile / noch nie geprüft | „eBay: noch nicht geprüft" + Knopf |
| `ok` | „eBay verkauft: 7,50 € · 12 Verkäufe · zuletzt 28.09." und, wenn `median_first`: „ · 1. Aufl. 9,00 € (4)" |
| `zu_wenig` | „eBay: zu wenig Verkäufe (2)" |
| `fehler` | „eBay: Abruf fehlgeschlagen" |

- Antippen/Klick klappt die Belege auf (Titel, Preis, Datum, Link zum eBay-Artikel; extern öffnen).
- Knopf **„jetzt bei eBay prüfen"** (bei `access = fehlt` ausgeblendet); während des Abrufs gesperrt, danach Zeile neu.
- Design-Tokens wie bisher (`theme.test.js`, `noLegacyColors.test.js`); UI-Texte Deutsch.

## 9. E2 Nutzen (festgelegt, eigener Plan nach E1)

**Lücken füllen** — Bewertungsregel, Zwilling in vier Fassungen (`valuation.cjs` inkl. `unitPriceCaseSql`, `src/utils/valuation.js`, `cloud/Valuation.kt`), gemeinsame Fixture `docs/fixtures/valuation/first-ed.json` um eBay-Fälle erweitert. Neue optionale Eingabe `ebay = { median_all, median_first }` des Drucks:

```
base  = price > 0 ? price : (ebay.median_all ?? 0)                         // Quelle: cm | ebay
first = price_first_ed != null              ? price_first_ed               // G4b, Cardmarket
      : price > 0 && ebay.median_first && ebay.median_all
                                            ? round2(price × clamp(round4(median_first / median_all), 1, 10))
      : !(price > 0) && ebay.median_first   ? ebay.median_first
      : base
unitPrice(card, copy) = copy.edition == 'first' ? first : base
```

- Nie Überschreiben: Cardmarket-Werte gewinnen immer.
- **Kennzeichnung:** jede Fassung liefert neben dem Wert die Quelle (`cm` | `ebay`); Detail-Preiszeile zeigt dann „Basis 3,10 € (eBay)" bzw. „1st Ed 9,72 € (×1,20 eBay)" (Erweiterung von `firstEdLine` und Twin).
- **Verkaufen:** Verkaufsliste und „Angebot anlegen" zeigen den eBay-Median neben dem Cardmarket-Preis.
- **Bleibt Cardmarket-only:** Preis-Alarme, Movers, Preisverlauf, Preisreferenz (wie G4).
- Vor der E2-Planung: Abgleich am echten Bestand (wie viele Drucke bekommen einen eBay-Basiswert, wie viele einen eBay-Faktor, Ausreißer).

## 10. Tests (E1)

- `match.ts`: jede Regel aus §4 mit Treffer/Nicht-Treffer, plus Messkorb (§3.2) mit erwarteter Zuordnung je Titel.
- `summarize.ts`: < 3 → NULL, Median gerade/ungerade, 1st-Ed getrennt, Nicht-EUR verworfen, `sales` höchstens 20 und nach Datum, `last_sold_*`.
- `ebay-client.ts`: `appToken` mit Scope; `invalid_scope` wird als „Scope fehlt" erkannt (nicht als auth, nicht als transient).
- Edge Function mit nachgebautem eBay + Datenbank-Stub: Scope fehlt → `access = fehlt`, keine Suche; Scope da → `aktiv`, Kandidatenauswahl (Mindestwert, first, for_sale, Angebot, Frist, Budget, Reihenfolge), 429 bricht ab, 401 holt Token neu, Einzelabruf ignoriert Frist, Zugang nur mit Cron-Secret oder Login.
- SQL: Kandidaten-Abfrage gegen Testdaten (wie bisherige Cloud-SQL-Prüfungen: Abnahme per SELECT).
- PC: Nur-Lese-Strom (Pull, Cursor, kein Push), IPC-Handler.
- Zwilling Anzeige-Zeile: JS + Kotlin gegen `sold-line.json`.
- Handy: Repository-Delta wie bestehende Tests.

## 11. Einspiel-Reihenfolge und Live-Schaltung

1. Nutzer spielt `supabase/ebay_sold_schema.sql` ein (Tabellen, RLS, Statuszeile) — **vor** Installer/APK (sonst scheitert der Pull an der fehlenden Tabelle; der Pull fängt das wie bei `ebay_orders` ab und protokolliert).
2. Nutzer deployt `ebay-sold-prices` (`--no-verify-jwt` wie `ebay-sync`) und legt den pg_cron-Eintrag an; prüft `select * from cron.job`.
3. Installer (nicht aus Junction-Worktree) und APK.
4. **Vor der Freischaltung:** Detail zeigt „Zugang noch nicht freigeschaltet"; `ebay_insights_state.access = 'fehlt'` nach dem ersten Lauf.
5. **Nach der Freischaltung:** nächster Lauf setzt `aktiv`; Nutzer drückt einmal „jetzt bei eBay prüfen" bei SDJ-G001 → echte Antwort wird mit dem nachgebauten Format verglichen (Abweichungen = Fix-Aufgabe), Belege im Detail plausibel.

## 12. Nicht drin

- eBay als wählbare Haupt-Preisquelle (`price_source`).
- Aktive eBay-Angebote als Preisquelle (nur Messung nutzt die Browse-API).
- Andere Marktplätze als EBAY_DE; Versandkosten; Auktion vs. Sofortkauf getrennt.
- Spalten in Sammlungsliste/Binder/Start.
- Preisverlauf aus eBay-Verkäufen.

## 13. Risiken

- **Freischaltung bleibt aus:** E1 bleibt dann unsichtbar bis auf den Hinweis; Aufwand ist bewusst in Kauf genommen. Fallback (z. B. Auslesen der Suchseite) wäre eine eigene Entscheidung des Nutzers.
- **Antwortformat weicht ab** (v1_beta): Abnahmeschritt §11.5 deckt es auf; Mapping ist in einem Modul gekapselt.
- **Titel ohne Auflage-Angabe** → `median_first` oft leer; Gesamtwert trotzdem nutzbar. Messung §3.2 beziffert es.
- **Kontingent:** Budget 50/Tag + Einzelabrufe; `calls_today` macht den Verbrauch sichtbar; Budget im Cron-Body anpassbar, sobald das echte Limit bekannt ist.
- **Fehlzuordnung** (falscher Druck mit ähnlichem Code, Lots ohne Schlüsselwort): Median + Mindestanzahl dämpfen Einzelfälle; Belege im Detail machen sie sichtbar.
