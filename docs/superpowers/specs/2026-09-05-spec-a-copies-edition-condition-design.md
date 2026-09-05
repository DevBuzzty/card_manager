# Spec A — Exemplare mit Edition und Zustand (Datenmodell-Genauigkeit)

**Datum:** 2026-09-05
**Status:** Entwurf, vom User im Brainstorming abgesegnet
**Teil von:** „Supercharge"-Programm (Specs A–H). A ist das Fundament, auf dem B (Binder), D (Scan-Flow), G (Portfolio Pro) und H (Verkaufen) aufsetzen.

## 1. Problem

Die Tabelle `cards` beschreibt ein **Printing** (Passcode, Set-Code, Sprache, Rarity) mit einer Menge. Edition (1st Edition vs. Unlimited) und Zustand (NM, EX, …) sind aber Eigenschaften eines **einzelnen physischen Exemplars** und fehlen komplett. Bei Yu-Gi-Oh entscheiden genau diese beiden Merkmale zwischen 0,50 € und vierstelligen Beträgen. Konkurrenten (Dragon Shield, Collectr, YuScan) führen beide Felder; die App bewertet heute jedes Exemplar wie NM.

## 2. Ziel

- Jedes physische Exemplar hat Edition und Zustand.
- Der Scan-Ablauf bleibt unverändert schnell: **nie ein Pflicht-Dialog**, Standards werden gesetzt, Abweichung nur auf Wunsch.
- Mischbestände (2× NM 1st Ed + 1× GD Unlimited desselben Printings) sind natürlich abgebildet.
- Bewertung berücksichtigt den Zustand über feste Faktoren.
- Preisänderungen werden ab jetzt pro Printing historisiert (nur Sammeln, keine UI).
- Desktop, Supabase und Android bleiben synchron, ohne dritte Änderung am Primärschlüssel von `cards`.

## 3. Nicht-Ziele

- Edition-Erkennung beim Scan (→ Spec D).
- Preis-Charts pro Karte, Gewinner/Verlierer, echter 1st-Edition-Aufschlag per Scraper (→ Spec G).
- Standort/Binder pro Exemplar (→ Spec B). Das Schema ist dafür vorbereitet (Copy-Zeile = Anker), aber keine Spalte wird jetzt angelegt.
- Kaufpreis, Grading (vom User explizit ausgeschlossen).
- Editierbare Zustandsfaktoren (bräuchten Settings-Sync zum Handy, den es nicht gibt).

## 4. Entscheidungen (mit Begründung)

| Entscheidung | Alternative(n) verworfen | Warum |
|---|---|---|
| Neue Tabelle `card_copies`, eine Zeile pro Exemplar, UUID-Schlüssel | (2) Edition+Zustand in den PK von `cards`; (3) zwei Default-Spalten pro Printing | (2) ist die dritte PK-Migration über drei Schichten und eine Sackgasse für jede weitere Pro-Exemplar-Eigenschaft; (3) ist falsch, sobald zwei Exemplare sich unterscheiden. UUID macht Sync ohne zusammengesetzten Schlüssel möglich. |
| `cards.quantity` bleibt als **Cache**, gepflegt per Trigger | `quantity` entfernen | Alles, was heute nur liest (Listen, Set-Completion, Phone-Filter `quantity > 0`, Snapshots), läuft unverändert weiter. |
| Feste Zustandsfaktoren im Code, identische Tabelle in JS und Kotlin | Editierbar in Settings | Kein Settings-Sync vorhanden; sonst rechnen Desktop und Handy verschiedene Werte. |
| Migration erzeugt Copies **nur auf dem Desktop** | Auch per Cloud-SQL | Beide Seiten würden Duplikate erzeugen. Desktop ist Owner, pusht die Copies hoch. |
| Preishistorie: ein Eintrag pro Printing und Tag, nur bei Änderung | Jede Preisschreibung loggen | Poller läuft alle 60 s; ohne Dedup explodiert die Tabelle. |

## 5. Datenmodell

### 5.1 `card_copies` (SQLite und Supabase identisch)

```sql
CREATE TABLE IF NOT EXISTS card_copies (
  copy_id    TEXT PRIMARY KEY,                -- UUID v4, erzeugt vom Schreiber
  card_id    TEXT NOT NULL,                   -- = cards.id (Passcode)
  set_code   TEXT NOT NULL,
  language   TEXT NOT NULL DEFAULT 'DE',
  rarity     TEXT NOT NULL DEFAULT 'Unknown',
  edition    TEXT NOT NULL DEFAULT 'unknown'
             CHECK (edition IN ('first','unlimited','limited','unknown')),
  condition  TEXT NOT NULL DEFAULT 'NM'
             CHECK (condition IN ('MT','NM','EX','GD','LP','PL','PO')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS card_copies_printing_idx
  ON card_copies (card_id, set_code, language, rarity);
```

Supabase-Fassung: `deleted boolean`, `updated_at timestamptz` server-gestempelt (gleicher Trigger-Stil wie `cards`), `user_id` + RLS wie bei `cards`. Kein FK auf `cards` in Postgres (Sync-Reihenfolge Copy-vor-Card wäre sonst ein Fehler); Konsistenz kommt aus dem Desktop, der immer Card vor Copy pusht.

### 5.2 Zähler-Trigger (Kern-Invariante)

Nach jedem INSERT/UPDATE/DELETE auf `card_copies`:

```
quantity(printing) = COUNT(copies WHERE deleted = 0 AND printing matcht)
deleted(printing)  = 1 wenn quantity = 0, sonst 0
```

Umsetzung: je ein Trigger in SQLite (`trg_copies_recount`) und Postgres (`trg_copies_recount`, `plpgsql`), die beide `cards` per UPDATE anfassen. Der bestehende `trg_cards_updated` stempelt dadurch `updated_at`, sodass der Zähler wie gehabt zum jeweils anderen Gerät synchronisiert — aber siehe 6.1, `quantity` wird nicht mehr gepusht, nur `deleted`.

Beim Umhängen (UPDATE der Printing-Spalten einer Copy) werden **beide** Printings neu gezählt (OLD und NEW).

### 5.3 Zustandsfaktoren (fest)

| Zustand | Faktor |
|---|---|
| MT | 1,00 |
| NM | 1,00 |
| EX | 0,85 |
| GD | 0,70 |
| LP | 0,50 |
| PL | 0,35 |
| PO | 0,20 |

Edition hat in A keinen Faktor (`unknown` und `unlimited` = 1,0; `first` = 1,0 bis Spec G einen echten Aufschlag liefert).

`valueOf(price, copies) = price × Σ factor(copy.condition)` über lebende Copies. Reine Funktion in `desktop/src/utils/valuation.js` (Renderer) und `desktop/electron/valuation.cjs` (Main, für Snapshot) — beide importieren dieselbe Faktor-Tabelle aus `desktop/shared/condition-factors.json`. Android bekommt `cloud/Valuation.kt` mit derselben Tabelle als Kotlin-Konstante plus einen Unit-Test, der die JSON-Datei einliest und die beiden Tabellen vergleicht.

### 5.4 `price_history`

```sql
CREATE TABLE IF NOT EXISTS price_history (
  card_id     TEXT NOT NULL,
  set_code    TEXT NOT NULL,
  language    TEXT NOT NULL,
  rarity      TEXT NOT NULL,
  day         TEXT NOT NULL,          -- 'YYYY-MM-DD' UTC
  price       REAL NOT NULL,
  source      TEXT NOT NULL,          -- 'ygoprodeck' | 'cm_bulk' | 'cm_scrape' | 'manual' | 'cloud'
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (card_id, set_code, language, rarity, day)
);
```

Schreibregel (überall gleich): **nur wenn** der neue Preis vom zuletzt gespeicherten Preis dieses Printings abweicht; pro Tag maximal ein Eintrag (Upsert auf den PK, letzter gewinnt).

Schreiber:
- Desktop: YGOPRODeck-Poller, `cardmarket-bulk.cjs` Step B, `cardmarket-scraper.cjs`, `set-card-price` (manual).
- Cloud: RPC `apply_cardmarket_prices` bekommt einen zweiten Statement-Block, der nach dem UPDATE die geänderten Zeilen in `price_history` upsertet (`source = 'cloud'`).

Sync: Desktop **pusht nur** (Append, Cursor auf `recorded_at`), pullt nie. Handy liest die Cloud-Tabelle (UI erst in Spec G).

### 5.5 Settings (nur Desktop-SQLite `settings`)

| Key | Default | Bedeutung |
|---|---|---|
| `default_condition` | `NM` | Zustand neuer Exemplare |
| `default_edition` | `unknown` | Edition neuer Exemplare |
| `copies_migrated` | – | Flag, dass 7.1 gelaufen ist |

Android hat eigene Prefs `default_condition` / `default_edition` mit denselben Defaults (kein Settings-Sync, bewusst).

## 6. Sync (`desktop/electron/sync.cjs`)

### 6.1 Änderungen am `cards`-Strom

- `MIRROR_COLS` verliert `quantity`. Beide Seiten rechnen den Zähler selbst.
- `applyRemoteRow` patcht bei bestehenden Zeilen **nur noch `deleted`** (bisher `quantity` + `deleted`). Bei neuen Zeilen (phone-created) wird `quantity` aus dem Remote mitgenommen, bis die Copies eintreffen; der Trigger korrigiert danach.
- Reihenfolge im Cycle: `pull cards → pull copies → push cards → push copies → push price_history → snapshot`. Cards vor Copies, damit Copies nie auf ein lokal unbekanntes Printing zeigen.

### 6.2 Neuer `card_copies`-Strom

Spiegelbild des Card-Stroms:
- Cursor `sync_copies_last_pull` / `sync_copies_last_push` (Settings).
- Pull: Seiten über `updated_at, copy_id` (stabile Ordnung, gleiches Muster wie bei Cards), Upsert lokal; Echo-Skip über `recentlyPushedCopies: Map<copy_id, updated_at>`.
- Push: alle lokalen Zeilen mit `updated_at > cursor`, `upsert(onConflict: 'copy_id')`.
- Soft-Delete beidseitig, nie `DELETE`.

### 6.3 Konflikte

| Fall | Ergebnis |
|---|---|
| Beide löschen dieselbe Copy | Soft-Delete idempotent, ein Ergebnis. |
| Beide legen gleichzeitig ein Exemplar an | Zwei Copies, zwei UUIDs — **korrekt**, es sind zwei Karten. |
| Handy ändert Zustand, Desktop ändert Edition derselben Copy im selben Fenster | Last-writer-wins auf Zeilenebene (wie heute bei `cards`). Akzeptiert, extrem selten. |
| Desktop pusht Card, während Cloud-Trigger `quantity` neu setzt | Kein Konflikt mehr, weil `quantity` nicht mehr gepusht wird. |

## 7. Migration

### 7.1 Desktop (einmalig, beim Start, in `database.cjs`)

Wenn `copies_migrated` fehlt:
1. Tabellen + Trigger anlegen (idempotent).
2. Für jede Zeile in `cards` mit `deleted = 0 AND quantity > 0`: `quantity` Copies einfügen (`edition='unknown'`, `condition='NM'`, `updated_at = CURRENT_TIMESTAMP`, damit sie gepusht werden).
3. `copies_migrated = '1'`.

In einer Transaktion. Zweiter Lauf tut nichts.

### 7.2 Supabase (User führt SQL im Dashboard aus: `supabase/card_copies_schema.sql`, `supabase/price_history_schema.sql`)

Nur Tabellen, Trigger, RLS, RPC-Erweiterung. **Kein Backfill.** Bis zum ersten Desktop-Sync sieht das Handy den alten Zähler, danach die Copies.

### 7.3 Android

Kein Datenschritt. Neue Repository-Methoden lesen/schreiben `card_copies`; wenn ein Printing noch keine Copies hat (Cloud-Backfill noch nicht durch), zeigt das Detail „n× NM · Unbek. (nicht migriert)" und **Plus/Minus sind für dieses Printing deaktiviert**, bis der Desktop gesynct hat. Verhindert, dass das Handy Copies erzeugt, die der Desktop dann doppelt anlegt.

## 8. Bedienung

### 8.1 Standards

Zwei Settings (Desktop) bzw. Prefs (Android): Default-Zustand (Start NM), Default-Edition (Start Unbekannt). Einmal umstellen, nie wieder daran denken.

### 8.2 Staging (Desktop `StagingArea.jsx`, Android `ScanStagingScreen.kt`)

- Ablauf unverändert: Karte rein, Set wählen, Enter/Tap committet. Menge n → n Copies mit den Standards.
- Neu pro Printing-Zeile: ein kleiner Chip mit den aktuellen Werten, z. B. `NM · Unbek.`. Tippen klappt zwei Auswahlreihen (Zustand, Edition) auf, gültig nur für diese Zeile und diesen Scan. Der Chip merkt sich nichts über den Scan hinaus.
- Mischbestand im selben Scan: wie heute eine zweite Printing-Zeile anlegen und dort abweichend setzen.
- Commit-Payload erweitert: `{ …printing, copies: [{edition, condition, count}] }`. Der Handler `add-card` (Desktop) bzw. `addScanned` (Android) legt die Copies an; `quantity` entsteht durch den Trigger.

### 8.3 Karten-Detail (Desktop `CardDetailModal.jsx`, Android `CardDetailScreen.kt`)

- Pro Printing statt „× Menge" die **Exemplar-Gruppen**: `2× NM 1st Ed`, `1× GD Unlimited`. Gruppe = (edition, condition).
- Jede Gruppe: Plus, Minus, Wert (Preis × Faktor × Anzahl), zwei Selects zum Umstellen der Gruppe (verschiebt alle Copies der Gruppe).
- „Exemplar hinzufügen" legt eines mit den Standards an.
- Minus-Regel: entfernt eine Copy **dieser Gruppe**.

### 8.4 Sammlungs-Liste (Desktop `CollectionList.jsx`, Android `CollectionScreen.kt`)

- Weiter eine Zeile pro Printing mit Gesamtmenge.
- Neu: Filter Zustand und Edition (Zeile erscheint, wenn mindestens eine Copy matcht).
- Kleiner Punkt/Indiz an der Menge, wenn mindestens eine Copy vom Standard abweicht.
- Wert der Zeile = `valueOf(price, copies)`, nicht mehr Menge × Preis.
- Plus/Minus in der Liste: Plus legt eine Standard-Copy an; **Minus entfernt zuerst eine Standard-Copy, erst dann eine abweichende**, damit das seltene 1st-Ed-Exemplar nicht versehentlich verschwindet.

### 8.5 Bestehende Mengen-Verschieber

`merge-unknown-cards`, `convert-unknowns-to-default`, `downgrade-to-lowest-rarity` hängen künftig die Copies um (UPDATE der Printing-Spalten), Edition und Zustand bleiben erhalten. Trigger zählen beide Printings neu; die `Unknown`-Zeile fällt auf `deleted = 1`.

### 8.6 CSV

- Export: eine Zeile pro Exemplar-Gruppe, neue Spalten `edition`, `condition`, `count`.
- Import: beide Spalten optional; fehlen sie, Standards. Vorhandene Exporte bleiben importierbar.
- YDK unberührt.

## 9. Bewertung an allen Rechenstellen

Alle Stellen, die heute `quantity * price` rechnen, wechseln auf `valueOf`:
- Desktop: Portfolio-Gesamtwert, Dashboard, Insights/Statistics, `syncSnapshot` in `sync.cjs`, Portfolio-History-Append im Poller.
- Android: `computeDashboard`, `PortfolioScreen`, Detail.

Das Handy lädt dafür einmal pro Session alle lebenden Copies (Größenordnung ~1.000 Zeilen, Pagination wie bei `cards`).

## 10. Betroffene Dateien (Übersicht für den Plan)

**Desktop main:** `database.cjs` (Tabellen, Trigger, Migration), `sync.cjs` (Copies-Strom, `quantity` raus, price_history-Push), `main.cjs` (add-card, Detail-IPC neu: `list-copies`, `add-copy`, `remove-copy`, `update-copy-group`; Unknown-Handler; CSV; Poller → price_history), `cardmarket-bulk.cjs`, `cardmarket-scraper.cjs` (price_history), `preload.cjs`, neu `valuation.cjs`, `shared/condition-factors.json`.
**Desktop renderer:** `StagingArea.jsx`, `CardDetailModal.jsx`, `CollectionList.jsx`, `Settings.jsx`, `Portfolio.jsx`, `Dashboard.jsx`, `Statistics.jsx`, neu `utils/valuation.js`.
**Supabase:** `card_copies_schema.sql`, `price_history_schema.sql` (inkl. RPC-Erweiterung).
**Android:** `cloud/CollectionRepository.kt` (`loadCopies`, `addCopy`, `removeCopy`, `updateCopyGroup`; `setQuantity` entfällt), neu `cloud/CopyRow.kt`, `cloud/Valuation.kt`, `ui/CardDetailScreen.kt`, `ui/ScanStagingScreen.kt`, `ui/CollectionScreen.kt`, `ui/SettingsScreen.kt`, `ui/Dashboard.kt`, `ui/PortfolioScreen.kt`.

## 11. Tests

- **SQLite-Trigger** (`electron/copies.test.cjs`, Electron-Node-Trick wie bestehende Tests): Zähler nach Insert/Soft-Delete, `deleted` bei 0 und Reaktivierung, Umhängen zählt beide Printings.
- **Migration** (`electron/migration.test.cjs` erweitern): Bestands-DB → richtige Copy-Anzahl, Defaults; zweiter Lauf idempotent.
- **Sync** (`electron/test-sync.cjs` erweitern): Copies pull/push, Echo-Skip über UUID, „Handy erhöht, Desktop pusht gleichzeitig" → Zähler korrekt, `quantity` nicht im Push-Payload.
- **Bewertung:** `valueOf` Unit-Test (JS) + Kotlin-Test, der `condition-factors.json` mit der Kotlin-Tabelle vergleicht.
- **price_history:** gleicher Preis am selben Tag → kein zweiter Eintrag; Änderung → Upsert.
- **Android:** statischer Check; On-Device: Scan → Commit → Detail zeigt Gruppe; Plus/Minus; Handy-Anlage taucht am Desktop auf und umgekehrt.

## 12. Risiken

- **Doppelte Copies durch fehlerhafte Migration.** Abgesichert durch Desktop-only-Backfill, Flag, Android-Sperre für unmigrierte Printings.
- **Vergessene `quantity`-Schreiber.** Plan-Task: `grep -n "quantity" desktop/electron android/…` und jede Schreibstelle explizit auf Copies umstellen; Lesestellen bleiben.
- **Cloud-RPC-Erweiterung** wird vom User manuell eingespielt; bis dahin fehlt `source='cloud'` in der Historie, sonst keine Auswirkung.
