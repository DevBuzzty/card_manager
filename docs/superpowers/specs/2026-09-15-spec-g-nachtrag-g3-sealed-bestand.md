# Spec G — Nachtrag G3: Sealed-Bestand

**Datum:** 2026-09-15
**Ändert:** `docs/superpowers/specs/2026-09-05-spec-g-portfolio-pro-design.md` §4 (Sealed-Zeilen), §5.1, §5.2, §5.5 (Sealed-Anteil), §6.1, §7.1 (Wert-Karte), §7.2 (Sealed-Liste, zwei Flächen), §8 (Sealed-Strom), §10, §11
**Setzt voraus:** G1 (`2026-09-14-spec-g-nachtrag-g1-preisverlauf-und-bewegungen.md`, gemergt `4a1ab8b`) und G2 (`2026-09-14-spec-g-nachtrag-g2-preis-alarme.md`, gemergt `554d731`).
**Status:** vom Nutzer Abschnitt für Abschnitt abgesegnet (2026-09-15).

---

## 1. Was sich gegenüber Spec G ändert

| Spec G | G3 |
|---|---|
| §5.1 `sealed_items` mit `cm_product_id` nullable (Freitext), `expansion`, `note`, Menge ≥ 0 | `cm_product_id` Pflicht, kein Freitext; ohne `expansion` und `note`; Menge ≥ 1, darunter Soft-Delete. Tabelle ohne `user_id` wie `card_copies`. |
| §5.1 `kind` aus dem Namen über `SUFFIX_RE` | `kind` aus der Cardmarket-**Kategorie** (`categoryName`), an genau einer Stelle im Katalog-Build. Werte `display`, `booster`, `tin`, `deck`, `special`, `other`. |
| §5.1 `sealed_price_history` | **Entfällt** (kein Sealed-Chart in G3). |
| §5.2 `sealed_products` im Katalog | Bestätigt; zusätzlich `trend` zum Build-Zeitpunkt als Startpreis für das Handy. |
| §6.1 Sealed-Trend in Bulk und Cloud mit Historie | Bulk-Schritt C und Cloud-RPC `apply_cardmarket_sealed_prices`, ohne Historie. |
| §7.2 Sealed-Liste in Insights mit Bild und Δ 30 Tage, zwei Flächen im Chart | Neues Segment **„Sealed" in der Sammlung** auf beiden Geräten; ohne Bild, ohne Δ, ohne zweite Fläche. |
| §8 Handy „synchronisiert wie `card_copies`" | Handy: `ListCache` in `SideStores` (kleine Liste, volles Neuladen), Schreiben per REST wie Behälter. Desktop: vierter Sync-Strom. |
| §7.2 „Geöffnet → Snackbar Jetzt scannen?" | Handy wie beschrieben (Snackbar-Muster existiert); Desktop einfacher Inline-Hinweis mit Link, keine neue Toast-Komponente. |

**Befunde des Code-Abgleichs (2026-09-15):**
- `products_nonsingles_3.json` (lokal gecacht am Desktop) hat pro Produkt `idProduct, name, idCategory, categoryName, idExpansion, idMetacard, dateAdded` — 2.402 Produkte, davon 1.836 mit `trend > 0` im `price_guide_3.json`. Kategorien: Booster 859, Display 765, Structure Deck 232, Special Edition 156, Promo Products 142, Starter Deck 111, Collector Tins 111, Lot 18, Event Tickets 8. **Kein Bild, nur englische Namen.**
- `portfolio_history.sealed_value` und `portfolio_snapshots.sealed_value` existieren (lokal `copies-schema.cjs`, Cloud `card_copies_schema.sql`), niemand schreibt sie.
- `catalog.json.gz` hat heute `{ version, built_at, cards }`; Handy-`CatalogDb` ist Schema-Version 1, `onUpgrade` verwirft alle Tabellen.
- `refresh-cardmarket-prices` sammelt `cm_product_id` aus `cards`, wählt Trends mit `pickTrends` (`prices.ts`) und schreibt über die RPC `apply_cardmarket_prices`.
- Wertberechnung ohne Sealed: Desktop `valuation.cjs#totalValue`, `portfolio-value.cjs#recordPortfolioValue`, `sync.cjs#syncSnapshot`; Handy `Dashboard.kt#computeDashboard`, `SnapshotsRepository.upsertToday` aus `StartScreen`.
- Kein Toast am Desktop; Handy hat Snackbar mit Aktion (`ScanCapture.kt`).

## 2. Umfang

**Drin:**
- Sealed-Bestand auf beiden Geräten: anlegen per Suche in der Cardmarket-Produktliste, Menge ±, „Geöffnet" (Menge −1), löschen.
- Preis = Cardmarket-Trend pro Einheit; Desktop-Bulk-Lauf und tägliche Cloud-Funktion.
- Gesamtwert = Karten + Sealed; Start zeigt „Karten … € · Sealed … €"; Tageswert mit `sealed_value`.

**Nicht drin:** Bilder, Freitext-Produkte, Alarme auf Sealed, Sealed-Preisverlauf, zwei Flächen im Wertverlauf, Sealed als Dimension in „Aufteilung", Kopplung an Deals, Rückrechnung alter Tageswerte.

**Erfolgskriterium:** Ein am Handy angelegtes Display erscheint am Desktop, spätestens nach dem nächsten Preislauf mit Preis, und der Gesamtwert steigt auf beiden Geräten um genau Menge × Preis.

## 3. Produktliste (Offline-Katalog)

- Der Katalog-Build am Desktop liest `products_nonsingles_3.json` und `price_guide_3.json` aus dem Cardmarket-Cache und schreibt `sealed_products: [{ cm_product_id, name, kind, trend }]` in `catalog.json.gz` (`trend` null bei fehlendem oder 0).
- **Art-Zuordnung** (reiner, getesteter Helfer im Katalog-Build, einzige Stelle):
  - „Yugioh Display" → `display`
  - „Yugioh Booster" → `booster`
  - „Yugioh Collector Tins" → `tin`
  - „Yugioh Structure Deck", „Yugioh Starter Deck" → `deck`
  - „Yugioh Special Edition" → `special`
  - alles andere („Promo Products", „Lot", „Event Tickets", unbekannt) → `other`
- Fehlt der Cardmarket-Cache beim Build, bleibt `sealed_products` leer (`[]`); der Build scheitert nicht.
- Handy-`CatalogDb` → Schema-Version 2 mit Tabelle `sealed_products (cm_product_id INTEGER PRIMARY KEY, name TEXT, kind TEXT, trend REAL)`; das bestehende `onUpgrade` verwirft den alten Katalog, `CatalogSync` lädt neu. Import liest `sealed_products`, fehlt der Schlüssel, bleibt die Tabelle leer.
- Suche: Name enthält Suchtext (escaptes `LIKE`, wie `CatalogRepository.search`), max. 50, sortiert nach Name.

## 4. Datenmodell

### 4.1 `sealed_items` (SQLite und Supabase)
| Spalte | Regel |
|---|---|
| `sealed_id` | UUID, Primärschlüssel |
| `cm_product_id` | Integer, Pflicht |
| `name` | Text, Pflicht (englischer Cardmarket-Name beim Anlegen) |
| `kind` | Text, Pflicht, `check` auf die sechs Werte |
| `quantity` | Integer, Pflicht, `check (quantity >= 1)` |
| `price` | Real/numeric, nullable |
| `price_updated_at` | Zeitstempel, nullable |
| `created_at`, `updated_at` | Standard jetzt; `updated_at` lokal per Trigger, in der Cloud per `set_updated_at` |
| `deleted` | 0/1 bzw. boolean, Standard 0 |

- Cloud: keine `user_id`; RLS `for all to authenticated using (true) with check (true)` (wie `card_copies`).
- Anlegen eines Produkts, das lebend im Bestand ist: Menge der vorhandenen Zeile +Menge statt neuer Zeile. Legen zwei Geräte offline dasselbe Produkt an, entstehen zwei Zeilen; sie werden getrennt angezeigt.
- „Geöffnet" und Menge −: bis Menge 1; bei Menge 1 nach Rückfrage Soft-Delete (`deleted = 1`). Kein hartes Löschen.

### 4.2 Tageswert
- `portfolio_history` (Desktop) und `portfolio_snapshots` (Cloud): `total_value` = Karten + Sealed, `sealed_value` = Sealed-Anteil.

## 5. Preise

- **Regel (reiner Helfer, Zwilling Deno ↔ Node):** für eine Zeile mit `cm_product_id`: Trend aus dem Price-Guide nehmen; nur wenn `trend > 0` und `trend ≠ price` → neuer `price`, `price_updated_at = jetzt`; sonst unverändert. Kein Rückfall auf `low`/`avg`.
- **Desktop:** `cardmarket-bulk.cjs` bekommt nach Schritt B einen Schritt C über alle lebenden `sealed_items`; Änderungen stempeln `updated_at` und fließen per Sync in die Cloud.
- **Cloud:** `refresh-cardmarket-prices` sammelt zusätzlich die `cm_product_id` lebender `sealed_items`, wählt die Trends und ruft die neue RPC `apply_cardmarket_sealed_prices(prices jsonb)` (Update nur bei Änderung, `price_updated_at = now()`, gibt die Anzahl zurück).
- **Veraltet:** `price_updated_at` älter als 30 Tage → Anzeige „Preis veraltet"; der Wert zählt weiter.

## 6. Wert (Zwilling)

- `sealedValue(items)` = Σ `quantity × price` über Zeilen mit `deleted = false` und `price != null`. Gerundet wird nur in der Anzeige.
- `isPriceStale(priceUpdatedAt, now)` = älter als 30 Tage.
- Art-Bezeichnungen: `display` → „Display", `booster` → „Booster", `tin` → „Tin", `deck` → „Deck", `special` → „Special Edition", `other` → „Sonstiges".
- Umsetzung `desktop/electron/sealed-value.cjs` ↔ `android/.../ml/SealedValue.kt` gegen `docs/fixtures/portfolio/sealed-value.json`; Kopfkommentare nennen sich gegenseitig. Der Renderer bekommt die Werte über IPC.
- Gesamtwert = bestehender Kartenwert + `sealedValue`, auf beiden Geräten.

## 7. Desktop

### 7.1 Sync
- Vierter Strom `sealed_items` nach dem Exemplare-Muster (`updated_at`-Cursor, seitenweise, Echo-Skip, Soft-Delete; Cursor `sync_sealed_last_pull`/`sync_sealed_last_push`).
- Zyklus: pull Karten → Behälter → Exemplare → **Sealed**; push Karten → Behälter → Exemplare → **Sealed**; Preishistorie; Tageswert (mit `sealed_value`); Preis-Alarme.
- Fehlt die Cloud-Tabelle, darf der Strom den Zyklus nicht abbrechen.
- Nach gezogenen Sealed-Änderungen Renderer-Ereignis `sealed-changed`.

### 7.2 IPC (jeweils `main.cjs` und `preload.cjs`)
`sealed-list` (lebende Zeilen, sortiert nach Zeilensumme absteigend, Zeilen ohne Preis ans Ende, mit `lineValue`, `stale`, `kindLabel`, und `sealedValue`), `sealed-add({ cm_product_id, quantity })` (Name, Art und Startpreis aus der lokalen Produktliste), `sealed-set-quantity({ sealed_id, quantity })`, `sealed-open(sealed_id)`, `sealed-delete(sealed_id)`, `sealed-products-search(query)` (Name, Art, Trend; max. 50). Die Schreib-Handler arbeiten lokal (SQLite); der Sync schiebt.

### 7.3 Ansichten
- **Sammlung › Sealed** (`/sammlung/sealed`): Kopf „Sealed-Wert … €" und „Hinzufügen"; Zeilen mit Art, Name, Menge −/+, Einzelpreis bzw. „—", „Preis veraltet", Zeilensumme, „Geöffnet", Löschen. Leer „Noch kein Sealed-Bestand"; Ladezustand nicht wie eine leere Liste.
- „Geöffnet": Menge −1, danach in der Zeile „Geöffnet — Jetzt scannen" mit Link auf `/scannen`; bei Menge 1 Rückfrage, dann Soft-Delete.
- **Hinzufügen-Dialog:** Suche, Treffer mit Name, Art, Trend; Feld „Menge"; „Hinzufügen". Ohne Cardmarket-Cache: „Produktliste nicht verfügbar — Cardmarket-Preise einmal aktualisieren."
- **Start:** Gesamtwert; darunter „Karten … € · Sealed … €" nur bei Sealed-Bestand. **Insights › Wert** zeigt den Gesamtwert.

## 8. Handy

- `cloud/SealedRepository.kt`: lebende Zeilen laden; anlegen (lebende Zeile mit gleicher `cm_product_id` vorhanden → PATCH `quantity`, sonst POST mit neuer UUID, Name/Art/Startpreis aus `sealed_products`); Menge setzen; Soft-Delete. Auth/Reauth wie `ContainersRepository`.
- `SideStores.sealedItems` (`ListCache`), in `clearAll()` geleert; nachladen beim Start, beim Vordergrund (mit den Preis-Alarmen), per Ziehen und nach eigenem Speichern (`refreshAndWait()`).
- **Sammlung › Sealed** (`sammlung/sealed`): Inhalt wie Desktop; „Geöffnet" zeigt Snackbar „Geöffnet" mit Aktion „Jetzt scannen" → Scanner; bei Menge 1 Dialog. Leer „Noch kein Sealed-Bestand"; Fehler „Sealed-Bestand konnte nicht geladen werden — zum Aktualisieren ziehen".
- **Suche:** eigene Seite über `sealed_products` in `catalog.db`; Treffer mit Name, Art, Trend; Menge; „Hinzufügen". Leere Tabelle: „Produktliste noch nicht geladen — Katalog in den Einstellungen prüfen".
- **Start:** Gesamtwert = `DashboardMemo`-Kartenwert + `sealedValue`, Unterzeile wie Desktop. Solange die Sealed-Liste lädt, zeigt die Wert-Karte den Ladezustand. `SnapshotsRepository.upsertToday` schreibt `total_value` und `sealed_value` erst, wenn die Sealed-Liste geladen ist; bei Ladefehler an diesem Start kein Tageswert.

## 9. Fehlerfälle
- Produkt ohne Trend: Preis leer/unverändert, Anzeige „—", zählt nicht.
- Cloud nicht erreichbar: Desktop arbeitet lokal, Sync holt nach; Handy behält den letzten Stand mit Hinweis, Schreiben meldet den Fehler.
- Cloud-Tabelle fehlt: Desktop-Zyklus läuft weiter; Handy zeigt den Ladefehler.
- Gleichzeitige Änderung derselben Zeile: zuletzt geschriebener Stand gewinnt.
- Katalog ohne Sealed-Liste: Suchhinweis (§8).

## 10. Tests
- Art-Zuordnung aller neun Kategorien und unbekannter Kategorie (Node, Katalog-Build); `sealed_products` im gepackten Katalog; fehlender Cache → `[]`.
- Trend-Regel für Sealed: Deno (`refresh-cardmarket-prices`) und Node (Bulk-Schritt C) gegen `docs/fixtures/portfolio/sealed-prices.json` — Trend 0, fehlend, unverändert, neu.
- `sealedValue`, `isPriceStale`, Art-Bezeichnungen: JS und Kotlin gegen `docs/fixtures/portfolio/sealed-value.json`.
- Desktop SQLite: Schema mit `check`s, Anlegen gleiches Produkt erhöht Menge, „Geöffnet" bis Soft-Delete, Sync-Strom (Push, Pull, Echo-Skip, Soft-Delete), Tageswert mit `sealed_value`. Lint genau 5.
- Handy: Abfrageparameter und Anlege-Entscheidung des Repositorys, `CatalogDb` v2 (Import und Suche), Tageswert nicht ohne geladene Sealed-Liste (Schutz-Nachweis: ohne die Bedingung scheitert der Test).

## 11. Einspielen (Nutzer)
1. `supabase/sealed_items_schema.sql` im Dashboard (Tabelle, Trigger, RLS, RPC `apply_cardmarket_sealed_prices`).
2. `supabase functions deploy refresh-cardmarket-prices --no-verify-jwt --project-ref uirfqwklvavgjklgqpnn` aus dem Repo-Stammverzeichnis (nach dem Merge oder aus dem Worktree).
3. Desktop-Installer installieren (nicht aus einem Worktree mit `node_modules`-Junction gebaut); danach „Cardmarket-Preise aktualisieren" und „Katalog jetzt bauen".
4. Erst danach die APK auf beide Handys.
5. Abnahme: Display am Handy anlegen → erscheint am Desktop mit Preis; Gesamtwert steigt auf beiden Geräten um Menge × Preis; „Geöffnet" senkt die Menge und bietet den Scanner an.
