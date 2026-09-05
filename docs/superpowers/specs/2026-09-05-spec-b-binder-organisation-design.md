# Spec B — Organisation: Binder mit Seite/Fach, Tags und Notizen

**Datum:** 2026-09-05
**Status:** Entwurf, vom User im Brainstorming abgesegnet
**Teil von:** „Supercharge"-Programm (Specs A–H). **Setzt A voraus** (Standort, Tags und Notiz hängen am Exemplar `card_copies`) und **C** (Segment „Binder" unter Sammlung, Navigation, Scan-Shell).

## 1. Problem

Die Sammlung ist eine flache Liste. Es gibt keine Antwort auf „Wo liegt diese Karte physisch?" und „Was ist Binder 3 wert?". Dragon Shield bietet Binder mit Fächern, Collectr Tags; hier gibt es nichts davon.

## 2. Ziel

- Jedes Exemplar kann in genau einem **Behälter** liegen (Binder, Box, Deckbox); in Bindern zusätzlich auf **Seite und Fach**.
- Einsortieren geschieht in **einem Durchgang mit dem Scanner**: physisch einlegen, Handy erkennt, Fach rückt weiter.
- Freie **Tags** und eine **Notiz** pro Exemplar.
- Binder-Ansicht als Seiten-Raster zum Nachschauen und Korrigieren.
- Wert pro Behälter, Zähler „Nicht einsortiert".

## 3. Nicht-Ziele

- Thematische Sammlungen / Mehrfachzugehörigkeit (vom User nicht gewünscht).
- Drag-and-Drop im Raster.
- Einsortier-Modus am Desktop über den Handy-Socket (später möglich, nicht jetzt).
- Binder-Wert-Verlauf, Kapazitäts-Warnungen, Binder-Deckblätter.

## 4. Entscheidungen

| Entscheidung | Verworfen | Warum |
|---|---|---|
| Standort als Spalten am Exemplar (`container_id`, `page`, `slot`) | Eigene Tabelle `placements` | Ein Exemplar hat höchstens einen Standort; Spalten reichen und sparen einen Sync-Strom. |
| Zwei Karten im selben Fach erlaubt | Unique-Constraint auf (container, page, slot) | Doppelt gesleevte Commons sind real; ein Constraint würde Sync-Konflikte erzeugen. UI zeigt eine „2". |
| Tags als JSON-Array-Text am Exemplar | Tabelle `copy_tags` | Kleine Datenmenge; symmetrisch in SQLite und Postgres; Filter über LIKE reicht. |
| „Nicht einsortiert" = `container_id IS NULL`, kein Pseudo-Behälter | Behälter „Unsortiert" | Kein Sonderfall im Sync, kein löschbarer Systemeintrag. |
| Binder-Ansicht bewusst schlank (Tipp, Langdruck/Rechtsklick, Sheet) | Drag-and-Drop | Korrektur muss möglich sein; Drag-and-Drop ist teuer und auf dem Handy fehleranfällig. |

## 5. Datenmodell

### 5.1 `containers` (SQLite und Supabase identisch)

```sql
CREATE TABLE IF NOT EXISTS containers (
  container_id     TEXT PRIMARY KEY,      -- UUID v4
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('binder','box','deckbox')),
  pockets_per_page INTEGER,               -- nur binder: 4 | 9 | 12
  color            TEXT,                  -- Hex, optional
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted          INTEGER NOT NULL DEFAULT 0
);
```

Supabase: `user_id` + RLS, `updated_at` server-gestempelt, `deleted boolean`.

### 5.2 Erweiterung `card_copies` (aus A)

```sql
ALTER TABLE card_copies ADD COLUMN container_id TEXT;   -- NULL = nicht einsortiert
ALTER TABLE card_copies ADD COLUMN page INTEGER;        -- nur binder, 1-basiert
ALTER TABLE card_copies ADD COLUMN slot INTEGER;        -- nur binder, 1..pockets_per_page
ALTER TABLE card_copies ADD COLUMN tags TEXT;           -- JSON-Array, z. B. ["Kratzer","Tausch Max"]
ALTER TABLE card_copies ADD COLUMN note TEXT;
CREATE INDEX IF NOT EXISTS card_copies_location_idx ON card_copies (container_id, page, slot);
```

Regeln (im Code, nicht als Constraint): Box/Deckbox → `page`/`slot` NULL. Kein FK auf `containers` (Sync-Reihenfolge, siehe 8).

### 5.3 Abgeleitete Werte

- **Belegung** eines Binders = Anzahl Exemplare mit diesem `container_id`; Kapazität = `pages_used × pockets_per_page` (Seiten werden nicht vorab angelegt; die höchste belegte Seite bestimmt die Anzeige).
- **Wert** eines Behälters = Σ `valueOf(price, copies)` über seine Exemplare (A).
- **Nicht einsortiert** = lebende Exemplare mit `container_id IS NULL`.
- **Tag-Vorschläge** = distinct Tags über alle lebenden Exemplare.

## 6. Einsortier-Modus (Handy)

Einstieg: Sammlung › Binder › Binder öffnen › **Einsortieren**.

1. **Start-Sheet:** Vorschlag = erstes freie Fach nach dem letzten belegten (Seite/Fach), editierbar. Bestätigen öffnet die Kamera.
2. **Kamera-Shell** aus C (`ScanScreen`) in einem Modus `SORT`: Kopf zeigt groß **„<Binder> · Seite p · Fach s"**, Fuß zeigt die zuletzt eingelegte Karte (Thumbnail, Name, Fach) und **Rückgängig**. Kein Staging-Zähler, kein Prüfen-Button, kein Desktop-Spiegel.
3. **Pro erkannter Karte** (Passcode + Set-Code-Kandidaten aus der Pipeline):
   - Kandidaten = lebende, **nicht einsortierte** Exemplare dieses Passcodes; bei Set-Code-Treffer auf dieses Printing eingegrenzt.
   - **Genau ein Kandidat** → zuweisen, Fach vorrücken, kurzes Haptik-Feedback.
   - **Mehrere Kandidaten** (mehrere Printings oder Zustände/Editionen) → **Auswahl-Sheet** mit den Gruppen; Standard-Exemplare stehen oben. Auswahl → zuweisen.
   - **Kein Kandidat, aber Printing vorhanden und alle Exemplare bereits einsortiert** → Sheet „Alle Exemplare sind einsortiert: <Standorte>. Eines hierher verschieben?" → verschieben oder abbrechen.
   - **Karte nicht in der Sammlung** → Sheet „Nicht in der Sammlung. Hinzufügen und einsortieren?" → legt ein Exemplar mit den Standards (A) im gewählten Printing an (Set-Auswahl wie im Staging, falls mehrdeutig) und weist zu.
   - Dedup: dieselbe Karte wird erst wieder erkannt, wenn sie das Bild verlassen hat (bestehendes IoU-Tracking der Pipeline).
4. **Fach vorrücken:** `next(page, slot, pockets)`: `slot+1`, bei `slot == pockets` → `page+1, slot 1`. Reine Funktion, getestet.
5. **Rückgängig:** setzt Standort des letzten Exemplars zurück (bzw. bei „Hinzufügen und einsortieren" löscht das Exemplar soft) und rückt das Fach zurück. Stack-Tiefe: die ganze Sitzung.
6. **Fertig** → zurück zur Binder-Ansicht auf der zuletzt bearbeiteten Seite.

Persistenz pro Zuweisung sofort (Cloud-Write über Repository); bei Netzfehler bleibt die Zuweisung in einer lokalen Warteschlange und wird beim nächsten Erfolg nachgeholt, der Modus läuft weiter.

## 7. Ansichten

### 7.1 Sammlung › Binder (beide Geräte)

- Neues Segment neben Karten · Wunschliste · Sets · Decks (Handy: scrollbare TabRow).
- Oben **Nicht einsortiert: n Exemplare** (Tipp → Liste dieser Exemplare, mit Detail-Sprung).
- Liste der Behälter als `SpaceCard`: Farbe, Name, Art, Belegung („212 Exemplare · 24 Seiten"), Wert. Sortierbar per `sort_order` (Handy: Langdruck-Umsortieren nicht in B; Desktop: Pfeile hoch/runter).
- **Plus** → Dialog: Name, Art, Fächer pro Seite (nur binder), Farbe.
- Langdruck/Rechtsklick auf Behälter → Umbenennen, Löschen (Bestätigung: „n Exemplare werden auf ‚nicht einsortiert' gesetzt").

### 7.2 Binder-Ansicht

- Kopf: Name, „Seite p von P", Wert dieser Seite, Button **Einsortieren** (nur Handy).
- **Raster** je Seite: 2×2, 3×3 oder 3×4 nach `pockets_per_page`; Kartenbild im Fach, Menge-Badge bei mehreren Exemplaren im selben Fach, leeres Fach gestrichelt.
- Handy: horizontales Wischen blättert (`HorizontalPager`). Desktop: Doppelseite nebeneinander, Pfeile links/rechts, Tastatur ←/→.
- Tipp auf Karte → Karten-Detail. Langdruck (Handy) / Rechtsklick (Desktop) → Sheet: **Verschieben nach…** (Behälter, Seite, Fach), **Aus Fach nehmen**.
- Tipp auf leeres Fach → Suche über nicht einsortierte Exemplare (Name), Auswahl legt hinein.
- Box/Deckbox: statt Raster eine Liste der Exemplare (Name, Printing, Standort-Chip „Box").

### 7.3 Karten-Detail (Erweiterung von A)

Innerhalb jeder Exemplar-Gruppe zeigt jedes Exemplar eine Zeile: **Standort-Chip** („Blau · S3 · F7", „Box Alt", „—") und Tag-Chips. Tipp → **Exemplar-Sheet**:
- Standort: Behälter-Auswahl; bei Binder Seite und Fach (Vorschlag: nächstes freies Fach).
- Tags: Chip-Eingabe mit Vorschlägen aus 5.3, Enter legt an, X entfernt.
- Notiz: mehrzeiliges Feld.
- Entfernen (Soft-Delete des Exemplars, Bestätigung).
Einzige Stelle, an der Tags und Notiz geschrieben werden.

### 7.4 Sammlung › Karten

Filter-Sheet (C) erhält **Behälter** (Mehrfach) und **Tag** (Mehrfach). Ist ein Behälter-Filter aktiv, zeigt jede Zeile den Standort-Chip. Textsuche findet auch Tags und Notizen.

### 7.5 Start

Arbeitslisten-Zähler (C) bekommt „Nicht einsortiert" mit Sprung auf 7.1.

## 8. Sync (`sync.cjs`)

- **Dritter Strom `containers`**: UUID, Cursor `sync_containers_last_pull/push`, Soft-Delete, Echo-Skip, `onConflict: 'container_id'`.
- **Copies-Strom** (A) spiegelt zusätzlich `container_id, page, slot, tags, note`.
- **Reihenfolge im Zyklus:** pull cards → pull containers → pull copies → push cards → push containers → push copies → price_history → snapshot. Ein Copy zeigt so nie auf einen lokal unbekannten Behälter.
- **Behälter löschen:** in einer Transaktion `containers.deleted=1` + alle seine Copies `container_id/page/slot = NULL`; beide Änderungen tragen `updated_at` und werden im selben Zyklus gepusht. Android macht dasselbe über zwei REST-Calls (Copies zuerst, dann Behälter), damit ein Abbruch nie Copies auf einen gelöschten Behälter zeigen lässt.
- **Konflikt:** dasselbe Exemplar auf beiden Geräten in verschiedene Fächer → letzter Schreiber gewinnt (Zeilenebene, wie A). Zwei Exemplare im selben Fach → erlaubt, kein Konflikt.
- **Migration:** rein additiv. Kein Backfill. Supabase-SQL `supabase/containers_schema.sql` (Tabelle, RLS, Trigger) + `supabase/card_copies_location_migration.sql` (fünf Spalten, Index).

## 9. Betroffene Dateien

**Desktop main:** `database.cjs` (Tabelle, Spalten, Index), `sync.cjs` (Strom, Spiegel-Spalten, Reihenfolge), `main.cjs` (IPC: `list-containers`, `save-container`, `delete-container`, `list-binder-page`, `set-copy-location`, `set-copy-tags-note`, `list-unsorted-copies`, `list-tags`), `preload.cjs`.
**Desktop renderer:** neu `components/Binders.jsx` (Segment), `components/BinderView.jsx` (Doppelseite), `components/CopySheet.jsx` (Exemplar-Sheet); Erweiterungen `CardDetailPanel.jsx`, `CollectionList.jsx` (Filter), `Start`.
**Android:** neu `cloud/ContainersRepository.kt`, `cloud/CopyRow.kt` (+5 Felder), `ui/BindersScreen.kt`, `ui/BinderPageScreen.kt`, `ui/SortIntoBinderScreen.kt` (Kamera-Shell im Modus SORT), `ui/CopySheet.kt`, `ui/SlotMath.kt` (`next`, `firstFree`); Erweiterungen `CollectionRepository.kt` (Location/Tags-Patches, unsorted-Query), `CardDetailScreen.kt`, `CollectionScreen.kt` (Filter), `StartScreen.kt`, `ScanScreen.kt` (Modus-Parameter).
**Supabase:** `containers_schema.sql`, `card_copies_location_migration.sql`.

## 10. Tests

- `SlotMath`: `next` über Seitenende bei 4/9/12 Fächern; `firstFree` bei leerem Binder, Lücken, voller letzter Seite. (Kotlin-Unit-Test + JS-Pendant für den Desktop-Vorschlag.)
- Zuordnung: Standard-Exemplar vor abweichendem; Set-Code-Treffer grenzt auf Printing ein; kein Kandidat → korrekte Sheet-Variante (reine Funktion `pickCandidate(copies, passcode, setCodes)` mit Tests).
- Behälter-Löschung räumt Standorte in einer Transaktion (SQLite-Test).
- Sync: Reihenfolge Containers vor Copies; Spiegel-Spalten im Push-Payload; Echo-Skip (Erweiterung `test-sync.cjs`).
- Filter Tag/Behälter (Desktop-Handler-Test).
- On-Device: Binder anlegen, 10 Karten einsortieren (eine mehrdeutig, eine nicht in Sammlung), eine rückgängig, eine verschieben, Desktop zeigt dieselben Fächer; Behälter löschen → Exemplare unsortiert auf beiden Geräten.

## 11. Risiken

- **Erkennungsfehler im Einsortier-Modus** legen die falsche Karte ins Fach. Abgesichert durch Thumbnail der letzten Zuweisung + Rückgängig; Genauigkeit selbst ist Thema von Spec D.
- **Offline-Warteschlange** im Modus: bei App-Abbruch gehen ungepushte Zuweisungen verloren. Akzeptiert für B; Warteschlange wird beim Verlassen des Modus mit einer Meldung geleert oder verworfen.
- **Fünf Segmente** am Handy sind viel; TabRow scrollbar, Reihenfolge Karten · Binder · Wunschliste · Sets · Decks, damit die beiden häufigsten zuerst stehen.
