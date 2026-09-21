# Spec H2 — Verkaufs-Historie & Preisvorschläge

**Datum:** 2026-09-21
**Status:** vom Nutzer Abschnitt für Abschnitt abgesegnet (Brainstorming 2026-09-21)
**Teil von:** Programm H (Aufteilung siehe `2026-09-17-spec-h-nachtrag-h1-duplikate-verkaufsliste.md` §1).
**Setzt voraus:** A (Exemplare, `card_copies`, Soft-Delete), B (Standort/Tags/Notiz, Binder-Fächer), G3 (Sync-Muster für eigene Tabellen), G4 (1.-Auflage-Preis), H1 (Verkaufsliste, `for_sale`, gemergt 2026-09-21 als `92ae4e0`).
**Nicht Teil von H2:** Marktplatz-Anbindung (eBay-API, Cardmarket/Kleinanzeigen halbautomatisch) → H3. Einkaufspreise.

---

## 1. Problem

Wer eine Karte verkauft, löscht heute das Exemplar. Danach weiß die App nicht mehr, dass es verkauft wurde, wofür und über welchen Kanal — keine Antwort auf „Was habe ich mit Verkaufen eingenommen, und habe ich gut verkauft?". Und wer etwas einstellen will, rechnet den Preis von Hand aus.

## 2. Ziel

- **Verkauf buchen:** ein Verkauf mit einer oder mehreren Karten, Kanal, Datum, Gesamtpreis, optional Gebühren und Versand. Auf **beiden** Geräten.
- **Bearbeiten, Teil-Rückgabe, Storno** ohne Datenverlust: ein zurückgenommenes Exemplar kommt mit allem zurück, was es vorher hatte.
- **Übersicht:** Netto-Erlös gegenüber dem Marktwert zum Verkaufszeitpunkt, je Zeitraum, je Kanal, als Liste und Diagramm.
- **Preisvorschlag** je Exemplar nach einer festen, einstellbaren Regel, an vier Stellen sichtbar.

## 3. Entscheidungen

| Entscheidung | Verworfen | Warum |
|---|---|---|
| „Gewinn" = Netto-Erlös gegen **Marktwert beim Verkauf** | Gegen Einkaufspreis | Die App kennt keine Einkaufspreise; Kostenerfassung wäre ein eigenes Projekt (Nutzer). |
| **Ein Verkauf, mehrere Karten**, Erlös nach Marktwert verteilt | Jede Karte einzeln | Passt zu Bestellungen mit vielen Karten (Nutzer). |
| Gebühren und Versand **optional** erfasst, Gebühr je Kanal vorbelegt | Nur ein Betrag | Nutzer. |
| Buchen auf **beiden** Geräten | Nur PC | Nutzer. |
| **Eigene Tabellen** `sales`, `sale_items`, `sale_channels` + `card_copies.sold_in` | Spalten am Exemplar; nur Cloud | Storno/Bearbeiten eines Verkaufs mit 20 Karten bleibt eine Änderung; offline buchen am PC bleibt möglich (Nutzer: Ansatz A). |
| Storno statt nur Bearbeiten | — | Geplatzte Verkäufe kommen vor (Nutzer). |
| Kanäle: feste Liste + eigene | Freitext; nur feste | Vergleichbare Übersicht, trotzdem eigene Kanäle (Nutzer). |
| Vorschlag = Trend-Marktwert − Abschlag | Am Tiefstpreis ausrichten | Keine neuen Daten, nachvollziehbar (Nutzer). |
| Verkaufsdatum als **reines Datum** `YYYY-MM-DD` | Zeitstempel | Die App speichert Zeitstempel naiv in UTC; ein Verkauf um 0:30 Uhr läge sonst im Vormonat. |

## 4. Datenmodell

### 4.1 SQLite (Desktop), additive Migration in `database.cjs` / neues `sales-schema.cjs`

```sql
CREATE TABLE IF NOT EXISTS sale_channels (
  channel_id   TEXT PRIMARY KEY,            -- UUID; die fünf festen tragen feste Schlüssel
  name         TEXT NOT NULL,
  fee_percent  REAL NOT NULL DEFAULT 0 CHECK (fee_percent >= 0 AND fee_percent <= 100),
  builtin      INTEGER NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 100,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  sale_id      TEXT PRIMARY KEY,            -- UUID
  sold_on      TEXT NOT NULL,               -- 'YYYY-MM-DD', lokales Datum, OHNE Uhrzeit (§3)
  channel_id   TEXT NOT NULL,
  channel_name TEXT NOT NULL,               -- Name zum Zeitpunkt der Buchung (§8, Kanal ausgeblendet)
  gross        REAL NOT NULL CHECK (gross >= 0),
  fees         REAL,                        -- NULL = nicht erfasst
  shipping     REAL,                        -- NULL = nicht erfasst
  status       TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','storniert')),
  note         TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sale_items (
  sale_id       TEXT NOT NULL,
  copy_id       TEXT NOT NULL,
  value_at_sale REAL NOT NULL DEFAULT 0,    -- Marktwert beim Buchen, EINGEFROREN (§6.1)
  share         REAL NOT NULL DEFAULT 0,    -- Anteil am Netto-Erlös (§5.3)
  was_for_sale  INTEGER NOT NULL DEFAULT 0, -- stand vor dem Verkauf auf der Verkaufsliste (Storno stellt es wieder her)
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted       INTEGER NOT NULL DEFAULT 0, -- 1 = Teil-Rückgabe (Position aus dem Verkauf genommen)
  PRIMARY KEY (sale_id, copy_id)
);

ALTER TABLE card_copies ADD COLUMN sold_in TEXT;   -- sale_id, NULL = nicht verkauft
```

Zeitstempel-Trigger wie `trg_sealed_updated` für alle drei Tabellen. Die fünf festen Kanäle werden beim ersten Start angelegt (feste IDs `cardmarket`, `ebay`, `kleinanzeigen`, `tausch`, `privat`): Cardmarket 5 %, alle anderen 0 %, alle änderbar. Die Einstellungen weisen darauf hin, die Gebühren mit den eigenen Konditionen abzugleichen.

### 4.2 Supabase

Neue Datei `supabase/sales_schema.sql` (vom Nutzer auszuführen, wie bei allen früheren Specs): dieselben drei Tabellen (Postgres-Typen: `date`, `numeric`, `boolean`, `timestamptz`), `updated_at`-Trigger, `card_copies.sold_in` (`text`). Dazu drei **Datenbankfunktionen** für das Handy, jede eine einzige Transaktion:

- `book_sale(sale jsonb, items jsonb)` — legt Verkauf und Positionen an und blendet die Exemplare aus; bricht ab, wenn ein Exemplar schon verkauft oder gelöscht ist.
- `update_sale(sale jsonb, returned_copy_ids text[])` — ändert Kopfdaten, verteilt neu, nimmt zurückgegebene Positionen heraus.
- `cancel_sale(sale_id text)` — Storno.

Die Fach-Konflikt-Regel (§6.3) steckt in `cancel_sale` und `update_sale` genauso wie in der Desktop-Fassung.

### 4.3 Abgleich

Drei neue Ströme in `sync.cjs` nach dem Sealed-Muster (G3): Push `updated_at > Cursor` ohne die laufende Sekunde, Pull seitenweise, Echo-Sperre. `sold_in` reist im bestehenden Exemplar-Strom mit (`COPY_COLS`, am Handy `CopyRow.kt` / `StoreQueries.COPY_COLS`). Konflikte löst wie überall die jüngere Zeile.

## 5. Buchen

### 5.1 Einstieg

- **Verkaufsliste** (H1, PC und Handy): Exemplare anhaken → „Verkauft buchen".
- **Kartenansicht**: an jedem Exemplar „Verkauft" — auch ohne vorherige Markierung (Spontanverkauf).

### 5.2 Dialog

Kanal (Auswahl + „Neuer Kanal…"), Datum (heute), Gesamtpreis (vorbelegt mit der Summe der Preisvorschläge, §9), Gebühren (vorbelegt: Gesamtpreis × Kanalgebühr, änderbar, beim Kanalwechsel neu vorbelegt, solange nicht von Hand geändert), Versand (leer = nicht erfasst), Notiz.
Laufend angezeigt: Anzahl Karten, Marktwert zusammen, **Netto = Gesamtpreis − Gebühren − Versand**, Differenz zum Marktwert (grün/rot, € und %).

### 5.3 Verteilung (Zwillinge JS/Kotlin, §11)

- **Marktwert je Exemplar** = `Valuation.unitPrice × Zustandsfaktor` (wie der Sammlungswert; 1. Auflage über G4). Wird beim Buchen als `value_at_sale` eingefroren.
- **Anteil** = Netto × Marktwert / Summe Marktwert. Ist die Summe 0, gleichmäßig.
- Auf Cent gerundet; die Rundungsdifferenz geht an die Position mit dem größten Marktwert (bei Gleichstand: die erste), sodass die Summe der Anteile **exakt** dem Netto entspricht — auch bei negativem Netto.

### 5.4 Nach dem Buchen

Exemplare: `deleted = 1`, `sold_in = sale_id`, `for_sale = 0`; Standort, Tags, Notiz, Zustand, Auflage **bleiben unverändert** (Storno). `quantity`/`deleted` der Drucke folgen wie immer über die Trigger. Hinweis „N Karten als verkauft gebucht · Rückgängig"; Rückgängig = sofortiges Storno.

### 5.5 Prüfungen

Mindestens ein Exemplar; Gesamtpreis ≥ 0; Gebühren/Versand ≥ 0. Übersteigen Gebühren + Versand den Preis, wird gebucht und der Verlust deutlich angezeigt — kein Eingabefehler.

## 6. Bearbeiten, Teil-Rückgabe, Storno

### 6.1 Bearbeiten
Kanal, Datum, Gesamtpreis, Gebühren, Versand, Notiz änderbar. Anteile werden neu verteilt, `value_at_sale` bleibt **eingefroren**.

### 6.2 Teil-Rückgabe
Eine Position aus dem Verkauf nehmen: Position `deleted = 1`, ihr Exemplar kommt zurück (§6.3), Anteile der übrigen werden neu verteilt. Karten nachträglich hinzufügen gibt es nicht (dafür ein zweiter Verkauf).

### 6.3 Storno und die Rückkehr eines Exemplars
Storno setzt `status = 'storniert'`; alle Positionen kehren zurück. Rückkehr eines Exemplars: `deleted = 0`, `sold_in = NULL`, `for_sale = was_for_sale`.
**Fach-Konflikt:** Ist das Binder-Fach (`container_id` + `page` + `slot`) inzwischen von einem lebenden Exemplar belegt, kommt das Exemplar trotzdem zurück — `page`/`slot` geleert, `container_id` bleibt —, mit `needs_review = 1` und `review_reason = 'Fach inzwischen belegt'`. Nie zwei Karten in einem Fach, nie ein verlorenes Exemplar.
Ein stornierter Verkauf bleibt sichtbar (durchgestrichen) und zählt nirgends mit. Er lässt sich nicht wieder aktivieren.

## 7. Übersicht

Neuer Reiter **„Verkäufe"** unter Insights (PC `Insights.jsx`, Handy `InsightsScreen.kt`):

- Zeitraum: dieser Monat · dieses Jahr · gesamt.
- Kacheln: Netto-Erlös, Marktwert beim Verkauf, Differenz (€ und %), Anzahl Verkäufe und Karten.
- Je Kanal: Verkäufe · Netto · Gebühren · Differenz.
- Diagramm: Netto je Monat, letzte 12 Monate (Balken).
- Liste, neueste zuerst: Datum, Kanal, Karten, Netto, Differenz; storniert durchgestrichen; antippen → Positionen (Bild, Name, Druck, Marktwert, Anteil) mit Bearbeiten und Stornieren.

**Kartenansicht** (PC `CardDetailPanel.jsx`, Handy `CardDetailScreen.kt`): Abschnitt „Verkauft" mit den verkauften Exemplaren dieser Karte (Datum, Kanal, Anteil). Der Handy-Screen schließt sich heute, wenn eine Karte keinen lebenden Druck mehr hat — für eine komplett verkaufte Karte bleibt er offen, solange es Verkaufs-Positionen gibt.

**Rechenregeln:** nur Verkäufe mit `status = 'aktiv'` und `deleted = 0`; nur Positionen mit `deleted = 0`, deren Exemplar mit `sold_in` auf **diesen** Verkauf zeigt (§8, doppelt verkauft); Zuordnung zum Monat über `sold_on`.

## 8. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Handy ohne Netz | „Verkauft buchen", Bearbeiten und Storno gesperrt mit Hinweis; nichts halb gebucht (§4.2, eine Transaktion). |
| Exemplar schon verkauft/gelöscht (ein Gerät) | Buchung abgelehnt: „bereits verkauft". |
| Dasselbe Exemplar auf beiden Geräten verkauft (PC offline) | Nach dem Abgleich zeigt `sold_in` auf einen der beiden Verkäufe. Der andere Verkauf trägt eine Position, deren Exemplar nicht auf ihn zeigt → beide Verkäufe mit **„Karte doppelt verkauft"** markiert; die Position zählt nur im Verkauf, auf den `sold_in` zeigt. Der Nutzer storniert einen. |
| Kanal ausgeblendet | Nur `deleted = 1`; alte Verkäufe zeigen `channel_name`. Feste Kanäle lassen sich nicht ausblenden. |
| Exemplar ohne Marktwert | `value_at_sale = 0`; Verteilung nach §5.3; Differenz zählt 0. |
| Zurückkehrendes Fach belegt | §6.3. |

## 9. Preisvorschlag (H2b)

```
Vorschlag = Marktwert × (1 − Abschlag), auf 0,05 € abgerundet, nie unter dem Mindestpreis
```

- Marktwert wie §5.3. Kein Marktwert → **kein** Vorschlag („–").
- Einstellungen: Abschlag (Standard 5 %), Mindestpreis (Standard 0,10 €). PC `settings`, Handy `Prefs`; **kein** Sync, wie `keep_per_card` (H1) — die Einstellungen weisen darauf hin.
- Sichtbar: Verkaufsliste (je Exemplar, PC + Handy), Export der Verkaufsliste (F1 `saleListText`: Preisspalte), Buchungsdialog (Summe als Vorbelegung, §5.2), Karten-Info im Scanner (bei eigenen Drucken zusätzlich „Vorschlag X €").

## 10. Betroffene Dateien

**Desktop:** `electron/sales-schema.cjs` (neu), `electron/sales.cjs` (neu: buchen/bearbeiten/stornieren/lesen, reine Rechenteile getrennt), `electron/database.cjs` (Migration aufrufen), `electron/sync.cjs` (drei Ströme, `sold_in` in `COPY_COLS`), `electron/main.cjs` + `electron/preload.cjs` (Kanäle), `electron/export-formats.cjs` (Preisspalte in `saleListText`), `src/utils/sales.js` (neu, Zwilling), `src/utils/priceSuggestion.js` (neu, Zwilling), `src/components/SaleDialog.jsx` (neu), `src/components/SalesPanel.jsx` (neu), `src/components/Insights.jsx`, `src/components/ForSaleList.jsx` (Verkaufsliste: Anhaken + Buchen + Vorschlag), `src/components/CardDetailPanel.jsx`, `src/components/Settings.jsx`.
**Android:** `cloud/SalesRepository.kt` (neu, ruft die RPCs), `ml/Sales.kt` (neu, Zwilling), `ml/PriceSuggestion.kt` (neu, Zwilling), `cloud/CopyRow.kt` + `StoreQueries` (`sold_in`), `ui/SaleSheet.kt` (neu), `ui/SalesScreen.kt` (neu), `ui/InsightsScreen.kt`, `ui/SaleLists.kt` (Verkaufsliste), `ui/CardDetailScreen.kt`, `ui/KartenInfoSheet.kt`, `ui/SettingsScreen.kt`.
**Cloud:** `supabase/sales_schema.sql` (neu).
**Tests:** `docs/fixtures/sales/sales.json` (gemeinsame Fixture), Zwillings-Tests JS/Kotlin, SQLite-Tests für §5–§8, Sync-Tests nach `sealed-sync.test.cjs`.

## 11. Tests

- **Zwillinge gegen eine Fixture** (`docs/fixtures/sales/sales.json`): Verteilung inkl. Rest-Cent und negativem Netto, Preisvorschlag inkl. Abrundung und Mindestpreis, Monatszuordnung über `sold_on`, Gebühren-Vorbelegung, Doppelverkaufs-Erkennung.
- **SQLite** (echte Datenbank): Buchen, Bearbeiten (eingefrorener Marktwert), Teil-Rückgabe, Storno inkl. `was_for_sale`, Fach-Konflikt, „bereits verkauft".
- **Abgleich:** drei Ströme, Echo-Sperre, `sold_in` im Exemplar-Strom.
- **Am Gerät** (Lehre vom 2026-09-21, `(?U)`-Absturz): App starten und `adb logcat -b crash` prüfen; einen Verkauf am Handy buchen und stornieren.

## 12. Bau-Reihenfolge

- **H2a — Buchen und Übersicht:** §4–§8 und der „Verkauft"-Abschnitt; erst Desktop (Schema, Rechenteile, Dialog, Übersicht), dann Cloud-SQL (Nutzer führt aus), dann Handy.
- **H2b — Preisvorschlag:** §9 an seinen vier Stellen.

## 13. Risiken

- **Cloud-SQL muss vor dem Handy-Teil laufen.** Ohne die RPCs kann das Handy nicht buchen — der Plan setzt einen ausdrücklichen Schritt „Nutzer führt `sales_schema.sql` aus" vor die Handy-Aufgaben.
- **Doppelverkauf über Geräte** ist erkennbar, nicht verhinderbar (PC darf offline buchen). §8 macht ihn sichtbar statt ihn still zu verrechnen.
- **Rest-Cent-Regel** muss auf beiden Geräten identisch sein, sonst zeigen sie verschiedene Anteile — deshalb die gemeinsame Fixture.
