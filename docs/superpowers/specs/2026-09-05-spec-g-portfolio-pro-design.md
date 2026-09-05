# Spec G — Portfolio Pro: Sealed-Bestand, Karten-Charts, Gewinner/Verlierer, Alerts, 1st-Edition-Aufschlag

**Datum:** 2026-09-05
**Status:** Entwurf, vom User im Brainstorming abgesegnet
**Teil von:** „Supercharge"-Programm (Specs A–H). Setzt **A** (Exemplare, Zustandsfaktor, `price_history`), **B** (Binder für die Aufteilung), **C** (Start, Insights, Detail-Panel) und **D** (Katalog als Träger der Sealed-Produktliste) voraus. Nutzt die bestehende Cardmarket-Preispipeline (Bulk-Datei, Scraper, Cloud-Funktion `refresh-cardmarket-prices`).

## 1. Problem

Das Portfolio ist eine Zahl mit Verlauf und einer Top-Liste. Es fehlen: Sealed-Produkte als Besitz (Displays werden über Deals gejagt, aber nie erfasst), Preisverlauf pro Karte, die Frage „was hat sich bewegt", Benachrichtigungen bei Bewegungen der eigenen Karten, und ein Preis für Erste-Auflage-Exemplare, die A jetzt kennt.

## 2. Ziel

- **Sealed-Bestand** mit Cardmarket-Trend, getrennt ausgewiesen, auf beiden Geräten pflegbar.
- **Preisverlauf pro Printing** im Detail; **Gewinner/Verlierer** über 7 und 30 Tage auf Start und in Insights; Aufteilung nach Typ, Set, Rarity, Binder.
- **Alerts auf eigene Karten:** globale Bewegungsregel plus Zielpreise pro Karte, ausgelöst am Desktop und in der Cloud, sichtbar auf beiden Geräten.
- **1st-Edition-Aufschlag** per Scraper für Printings ab Schwellwert-Rarity; Erste-Auflage-Exemplare werden damit bewertet.

## 3. Nicht-Ziele

- Push-Benachrichtigungen aufs Handy (keine FCM-Infrastruktur; späterer Schritt).
- Kaufpreise, realisierte Gewinne, Steuer-Reports (Kaufpreis wurde in A ausgeschlossen).
- Sealed-Preise aus anderen Quellen als Cardmarket; Sealed-Zustand (nur „ungeöffnet", Öffnen entfernt).
- Graded-Karten-Preise.

## 4. Entscheidungen

| Entscheidung | Verworfen | Warum |
|---|---|---|
| Eigene Tabelle `sealed_items` mit Menge | Sealed als Sonderzeilen in `cards` | Andere Identität (Cardmarket-Produkt-ID statt Passcode), andere Felder, kein Printing-Schlüssel. |
| Sealed-Produktliste im Katalog (D) | Nur Desktop kann Sealed anlegen | Das Handy soll Displays am Regal anlegen können; die Liste ist klein (wenige tausend Einträge). |
| Bewegungen am Handy per Supabase-RPC | Historie clientseitig laden | Eigene Printings × 35 Tage sind zu viele Zeilen für jede App-Öffnung. |
| Alert-Regeln in der Cloud (eine Quelle) | Regeln lokal auf beiden Geräten | Kein Settings-Sync; sonst lösen Desktop und Cloud mit verschiedenen Schwellen aus. |
| `price_history` bekommt `variant` (Basis/Erste Auflage) | Zweite Tabelle für 1st-Ed-Historie | Eine Reihe pro Printing und Variante, gleiche Abfragen, ein Chart mit zwei Linien. |
| Eigene `sealed_price_history` | Sealed in `price_history` mit Pseudo-Schlüssel | Anderer Schlüssel (Produkt-ID); ein Pseudo-Schlüssel wäre eine versteckte Konvention. |

## 5. Datenmodell

### 5.1 `sealed_items` (SQLite und Supabase identisch, synchronisiert wie `card_copies`)

```sql
CREATE TABLE IF NOT EXISTS sealed_items (
  sealed_id      TEXT PRIMARY KEY,          -- UUID v4
  cm_product_id  INTEGER,                   -- Cardmarket nonsingles idProduct (NULL bei Freitext)
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('display','booster','tin','box_set','deck','other')),
  expansion      TEXT,
  quantity       INTEGER NOT NULL DEFAULT 1,
  price          REAL,                      -- Cardmarket trend pro Einheit
  price_updated_at DATETIME,
  note           TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sealed_price_history (
  cm_product_id INTEGER NOT NULL, day TEXT NOT NULL, price REAL NOT NULL, source TEXT NOT NULL,
  PRIMARY KEY (cm_product_id, day)
);
```

`kind` wird beim Anlegen aus dem Cardmarket-Namen abgeleitet (bestehende `SUFFIX_RE` in `cardmarket-bulk-parse.cjs`: „Booster Box"/„Display"/„Case" → display, „Booster"/„Pack" → booster, „Tin" → tin, „Box Set"/„Special Edition"/„Bundle" → box_set, „Deck" → deck), änderbar.

### 5.2 Katalog-Erweiterung (D)

`catalog.json.gz` bekommt `sealed_products: [{ cm_product_id, name, expansion, kind }]` aus `products_nonsingles_3.json` (nur Yu-Gi-Oh-Spiel-ID). Handy-`catalog.db` bekommt die Tabelle `sealed_products` mit Namenssuche.

### 5.3 Erweiterungen an bestehenden Tabellen

```sql
-- A-Änderung: Variante in der Preishistorie
ALTER TABLE price_history ADD COLUMN variant TEXT NOT NULL DEFAULT 'base';   -- 'base' | 'first'
-- PK wird (card_id, set_code, language, rarity, variant, day)  → Migration: Tabelle neu anlegen + kopieren (SQLite), ALTER PRIMARY KEY (Postgres)
-- 1st-Edition-Preis am Printing
ALTER TABLE cards ADD COLUMN price_first_ed REAL;
ALTER TABLE cards ADD COLUMN cm_first_ed_updated_at DATETIME;
-- Snapshots getrennt
ALTER TABLE portfolio_history ADD COLUMN sealed_value REAL NOT NULL DEFAULT 0;
alter table public.portfolio_snapshots add column if not exists sealed_value numeric not null default 0;
```

`price_first_ed` kommt in die Spiegel-Spalten des Cards-Stroms (`MIRROR_COLS`).

### 5.4 Alerts (nur Supabase; Desktop liest/schreibt über `sync.ensureClient()` wie Wunschliste/Decks)

```sql
create table public.price_alert_rules (
  id          bigint generated by default as identity primary key,
  user_id     uuid not null default auth.uid(),
  kind        text not null check (kind in ('global_move','above','below')),
  card_id     text, set_code text, language text, rarity text,   -- null bei global_move
  pct         numeric,          -- global_move: Mindestbewegung in %, Default 20
  min_eur     numeric,          -- global_move: Mindestbewegung in €, Default 2
  days        integer,          -- global_move: Fenster, Default 7
  threshold   numeric,          -- above/below: Zielpreis
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create table public.price_alert_events (
  id          bigint generated by default as identity primary key,
  user_id     uuid not null,
  rule_id     bigint references public.price_alert_rules (id) on delete cascade,
  card_id text, set_code text, language text, rarity text,
  old_price   numeric, new_price numeric, pct numeric,
  found_at    timestamptz not null default now(),
  dismissed   boolean not null default false,
  unique (rule_id, card_id, set_code, language, rarity, found_at)
);
```
Genau eine `global_move`-Regel pro Nutzer (Upsert). RLS wie `deal_alerts`.

### 5.5 Bewertung (Erweiterung von A)

`valueOf(printing, copies)`:
`Σ factor(condition) × (edition == 'first' && price_first_ed != null ? price_first_ed : price)`.
Portfolio-Gesamt = `Σ valueOf` über Printings **+** `Σ sealed.quantity × sealed.price`.

## 6. Preisquellen

### 6.1 Sealed-Trend
- Desktop `cardmarket-bulk.cjs` Step C: für jede `sealed_items`-Zeile mit `cm_product_id` den `trend` aus `price_guide_3.json` setzen (nur bei Änderung, `> 0`), `sealed_price_history` upserten.
- Cloud `refresh-cardmarket-prices`: gleiche Logik gegen `sealed_items` in Supabase (Produkt-IDs sammeln, Trend anwenden, `sealed_price_history` upserten). Damit bleibt das Handy ohne Desktop aktuell.

### 6.2 1st-Edition-Aufschlag (Scraper)
- `cardmarket-scraper.cjs` bekommt einen zweiten Durchgang „Erste Auflage": Kandidaten = Printings mit Rarity ≥ Schwellwert (bestehendes `minRank`) **und** mindestens einem lebenden Exemplar mit `edition = 'first'` **und** `cm_first_ed_updated_at` älter als 7 Tage.
- Pro Kandidat: Produktseite (bekannt über `cm_product_id` bzw. `cm_url`) mit Filter `isFirstEd=Y` laden, Ab-Preis lesen → `price_first_ed`, `cm_first_ed_updated_at`; `price_history` mit `variant='first'`, `source='cm_scrape'`.
- Kein Angebot mit dem Filter → `price_first_ed = NULL` (Basispreis gilt), Zeitstempel trotzdem setzen (kein Dauer-Retry).
- Läuft im bestehenden Auto-Poller (`cm_auto_enabled`) nach dem Basis-Durchgang, gleicher `cmRunning`-Guard, gleiche Drossel.

### 6.3 Alert-Auswertung
Reine Funktion `evaluateAlerts(rules, changes)` mit `changes = [{ key, oldPrice, newPrice, priceNDaysAgo }]`:
- `global_move`: `|new − priceDaysAgo| / priceDaysAgo ≥ pct/100` **und** `|new − priceDaysAgo| ≥ min_eur` → Event (einmal pro Printing und Tag).
- `above`/`below`: Schwelle überschritten und beim vorigen Preis nicht → Event.
Aufrufer:
- Desktop: nach jedem Preisschreiber (YGOPRODeck-Poller, Bulk, Scraper, manuell) für die geänderten Printings; `priceNDaysAgo` aus `price_history`. Events per `ensureClient()` in die Cloud; zusätzlich Electron-`Notification` („Blue-Eyes White Dragon LOB-DE001 Ultra Rare: +24 % (38,00 → 47,10 €)").
- Cloud: `refresh-cardmarket-prices` liest die Regeln, rechnet mit `price_history` (Cloud-Kopie) und schreibt Events. Dedup über den Unique-Key plus „ein Event pro Printing und Tag" (Prüfung vor Insert).

## 7. Ansichten

### 7.1 Start (C)
- Wert-Karte zeigt Gesamt, darunter klein „Karten 3.120 € · Sealed 890 €"; Δ 7/30 Tage aus `portfolio_history`/`portfolio_snapshots` (Gesamt).
- Neue Karte **Bewegungen**: Top 3 Gewinner und Top 3 Verlierer (7 Tage) mit Δ € und Δ %, Tipp → Detail; „Alle" → Insights.
- Neue Karte **Preis-Alerts** (nur wenn Events offen): Anzahl + erste zwei; Tipp → Liste, Wegwischen/Erledigt setzt `dismissed`.

### 7.2 Insights (Desktop) / Wert-Bereich (Handy: Start-Unterseite „Insights")
- **Bewegungen:** Tabs 7 Tage · 30 Tage, Listen Gewinner/Verlierer Top 10 (Name, Printing, alt → neu, Δ €, Δ %, Anzahl Exemplare).
- **Aufteilung:** Umschalter Typ · Set · Rarity · **Binder** (B) · Karten/Sealed. Kuchen + Liste.
- **Sealed:** Liste der Sealed-Items (Bild aus Cardmarket-Produkt, Name, Menge, Einzelpreis, Gesamt, Δ 30 Tage), Plus zum Anlegen (Suche in `sealed_products`, Menge), Aktionen: Menge ±, **Geöffnet** (Menge −1, Snackbar „Jetzt scannen?" → Scan), Löschen.
- Verlauf-Chart mit zwei Flächen (Karten, Sealed) statt einer.

### 7.3 Karten-Detail (Panel/Handy)
- Unter dem Preis ein **Verlauf-Chart** (recharts bzw. Canvas wie `ValueChart`) mit 30 · 90 · 365 Tagen aus `price_history`; zweite Linie „Erste Auflage", wenn `variant='first'` Daten hat. Leerzustand „Noch kein Verlauf".
- **Alarm-Zeile:** „Alarm bei ≥ … € / ≤ … €" (zwei Felder, Speichern legt `above`/`below`-Regeln an, Löschen deaktiviert).
- Preis-Zeile zeigt bei vorhandenem `price_first_ed` beide Werte: „Basis 38,00 € · 1st Ed 47,10 €".

### 7.4 Einstellungen › Preise
- Bereich **Alerts:** globale Regel (%, €, Tage), Schalter aktiv; Hinweis, dass Alerts am Handy beim Öffnen erscheinen.
- Bereich **Cardmarket:** neuer Schalter „Erste-Auflage-Preise scrapen" (Default an, wenn Auto-Scraper an).

## 8. Sync

- `sealed_items`: vierter Strom nach dem Copies-Muster (UUID, Cursor, Soft-Delete, Echo-Skip). Reihenfolge im Zyklus: … → push copies → **push sealed** → price_history (inkl. `variant`) → **sealed_price_history push** → snapshot (mit `sealed_value`).
- `cards.price_first_ed` in `MIRROR_COLS`; `applyRemoteRow` bleibt bei „nur `deleted`" (Preise fließen nur Desktop → Cloud, außer Cloud-Trend, der beide Seiten gleich setzt).
- Alerts: keine lokale Kopie; Desktop liest Regeln/Events direkt aus der Cloud (wie Deals).

## 9. Betroffene Dateien

**Desktop main:** `database.cjs` (Tabellen, Spalten, `price_history`-PK-Migration), `sync.cjs` (Sealed-Strom, Spiegel-Spalten, Snapshot), `cardmarket-bulk.cjs` (Step C Sealed), `cardmarket-scraper.cjs` (1st-Ed-Durchgang), `main.cjs` (IPC `list-sealed`, `add-sealed`, `update-sealed`, `open-sealed`, `search-sealed-products`, `get-movers`, `get-card-history`, `alert-rules-get/set`, `alert-events-list/dismiss`; Preisschreiber rufen `evaluateAlerts`), neu `alerts.cjs` (`evaluateAlerts`), `valuation.cjs` (A-Erweiterung), `catalog-builder.cjs` (D: `sealed_products`), `preload.cjs`.
**Desktop renderer:** `Insights.jsx` (Bewegungen, Aufteilung-Umschalter, Sealed), neu `SealedList.jsx`, `MoversList.jsx`, `PriceHistoryChart.jsx`; `CardDetailPanel.jsx` (Chart, Alarm-Zeile, 1st-Ed-Preis); Start (C) (Bewegungen, Alerts); Einstellungen › Preise.
**Supabase:** `sealed_schema.sql` (Tabelle, RLS, Trigger), `price_alerts_schema.sql`, `price_history_variant_migration.sql`, `cards_first_ed_migration.sql`, `snapshots_sealed_migration.sql`, RPC `portfolio_movers(days int)` (eigene Printings, Δ aus `price_history`, gewichtet mit Zustandsfaktoren aus `card_copies`), Edge Function `refresh-cardmarket-prices` (Sealed-Trend, Alert-Auswertung).
**Android:** neu `cloud/SealedRepository.kt`, `cloud/AlertsRepository.kt`, `cloud/PriceHistoryRepository.kt` (RPC + Historie), `ui/SealedScreen.kt`, `ui/MoversSection.kt`, `ui/PriceHistoryChart.kt`; geändert `StartScreen.kt`, `CardDetailScreen.kt`, `Valuation.kt` (1st-Ed), `CatalogDb.kt` (`sealed_products`), `SettingsScreen.kt`.

## 10. Fehlerfälle

- Sealed ohne `cm_product_id` (Freitext) → kein Preis, in Listen mit „—", zählt nicht zum Wert.
- Preisdatei ohne Trend für ein Produkt → Preis bleibt, Zeitstempel bleibt; nach 30 Tagen Hinweis „Preis veraltet" in der Sealed-Liste.
- 1st-Ed-Scrape ohne Angebote → `NULL`, Basispreis gilt, kein Retry vor 7 Tagen.
- Alert-Auswertung ohne Historie (neues Printing) → keine Bewegung möglich, nur above/below.
- Cloud und Desktop werten am selben Tag aus → Unique-Key + Tages-Dedup verhindern doppelte Events.
- RPC `portfolio_movers` bei leerer Historie → leere Listen, Start-Karte zeigt „Noch keine Bewegungen".

## 11. Tests

- `evaluateAlerts`: alle drei Regelarten, Schwellen genau auf der Grenze, kein Doppel-Event am selben Tag, Übergang above nur beim Überschreiten (JS-Test; Deno-Test in der Edge Function mit denselben Fixtures).
- `valueOf` mit `price_first_ed`: nur `first`-Exemplare nutzen ihn; `NULL` fällt auf Basis zurück (JS + Kotlin).
- Movers-Berechnung: Desktop-SQL und RPC liefern für eine Fixture-DB dieselben Top-Listen (Fixture unter `docs/fixtures/portfolio/`).
- `price_history`-Migration: bestehende Zeilen bekommen `variant='base'`, PK-Umbau verlustfrei.
- Bulk Step C: Sealed-Trend nur bei Änderung, Historie ein Eintrag pro Tag.
- Scraper 1st-Ed: Kandidatenauswahl (Rarity-Schwelle, first-Exemplar, 7-Tage-Frist), Parser für die gefilterte Seite (Fixture-HTML), `NULL`-Fall.
- Sync: Sealed-Strom Roundtrip, `price_first_ed` im Push-Payload, Snapshot mit `sealed_value`.
- Manuell: Display anlegen am Handy → erscheint am Desktop mit Preis nach Bulk-Lauf; Karte mit Zielpreis → Preis manuell setzen → Event am Desktop und Karte auf Handy-Start; Erste-Auflage-Exemplar zeigt eigenen Preis.

## 12. Risiken

- **Cardmarket-Filterparameter** (`isFirstEd=Y`) kann sich ändern → Scraper-Durchgang isoliert, Ausfall betrifft nur `price_first_ed`.
- **Trend für Sealed** ist bei seltenen Produkten `0`/null → bewusst kein Fallback auf „Ab"-Preis, Anzeige „—".
- **Doppelte Alert-Auslösung** Desktop/Cloud → Dedup wie beschrieben; im Zweifel ein Event zu viel, nie eines zu wenig.
- **`price_history`-PK-Migration** berührt A; Reihenfolge im Programm: A vor G bauen, Migration in G testet den Bestandsfall.
