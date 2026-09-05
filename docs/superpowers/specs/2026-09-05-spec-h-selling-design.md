# Spec H — Verkaufen: Duplikate und Verkaufsliste

**Datum:** 2026-09-05
**Status:** Entwurf, vom User im Brainstorming abgesegnet
**Teil von:** „Supercharge"-Programm (Specs A–H). Setzt **A** (Exemplare, Bewertung), **B** (Standort/Tags/Notiz als Schutz vor dem Vorschlag, Exemplar-Sheet), **C** (Arbeitslisten-Chips, Start) und **F** (Export „Verkaufsliste (Text)") voraus; nutzt **G** für den 1st-Edition-Preis in der Bewertung, falls vorhanden.

## 1. Problem

Es gibt keine Antwort auf „Was habe ich doppelt?" und keinen Ort, an dem Karten stehen, die weg sollen. Wer verkauft, zählt von Hand und löscht Exemplare, ohne dass die App den Zwischenzustand kennt.

## 2. Ziel

- **Duplikate** automatisch erkennen: alles über einem Playset (3 Exemplare pro Karte über alle Printings), mit sinnvollem Vorschlag, *welche* Exemplare gehen.
- **Verkaufsliste als Zustand am Exemplar:** bleibt in Sammlung und Wert sichtbar, bis das Exemplar tatsächlich weg ist.
- Beide Geräte, gleiche Listen.

## 3. Nicht-Ziele (vom User so entschieden)

- Verkaufs-Historie / „Verkauft für X €"-Buchung.
- Preisvorschläge mit Regeln.
- Cardmarket-Bulk-Listing-CSV, eBay-/Kleinanzeigen-Anbindung.
- Per-Karte-Behalte-Wert (nur globaler Standard).

## 4. Entscheidungen

| Entscheidung | Verworfen | Warum |
|---|---|---|
| `for_sale` als Spalte am Exemplar | Eigene Tabelle „Verkaufsliste" | Ein Exemplar ist entweder zum Verkauf oder nicht; die Spalte reist im bestehenden Copies-Sync mit. |
| Playset über **alle Printings** einer Karte | Pro Printing | Spielergedanke (User): drei von der Karte reichen für jedes Deck, egal aus welchem Set. |
| Vorschlag schont Exemplare mit Standort, Tags oder Notiz | Reiner Wert-Sort | Wer eine Karte in den Binder gelegt oder beschriftet hat, will genau die behalten. |
| „Verkauft" = Exemplar entfernen ohne Buchung | Verkaufseintrag | User wollte keine Historie; die Spalte lässt eine spätere Buchung zu, ohne Umbau. |

## 5. Datenmodell

```sql
ALTER TABLE card_copies ADD COLUMN for_sale INTEGER NOT NULL DEFAULT 0;   -- SQLite; Supabase: boolean
-- Spiegel-Spalte im Copies-Strom (sync.cjs) und in CopyRow.kt
```

Setting (Desktop `settings`, Android Prefs): `keep_per_card`, Default `3`. Kein Sync, beide Seiten Default 3; wer ihn ändert, ändert ihn auf beiden Geräten (Hinweis in den Einstellungen).

## 6. Duplikate

### 6.1 Berechnung (reine Funktion `duplicates(copiesByCard, keep)`)

Eingabe: lebende Exemplare gruppiert nach Passcode (über alle Printings), `keep` (Default 3).
Pro Karte: `surplus = max(0, count − keep)`; `surplus = 0` → nicht in der Liste.

**Vorschlag** = die `surplus` geringwertigsten Exemplare in dieser Reihenfolge (stabil sortiert, erstes Kriterium zuerst):
1. Exemplare **ohne** Standort (B `container_id IS NULL`), ohne Tags, ohne Notiz vor solchen mit.
2. Nicht Erste Auflage vor Erste Auflage (`edition != 'first'` zuerst).
3. Schlechterer Zustand zuerst (PO < PL < LP < GD < EX < NM < MT).
4. Billigeres Printing zuerst (`price`, bei `first` mit `price_first_ed` aus G, sonst Basis).
5. Zuletzt angelegt zuerst (`created_at` absteigend), als Tiebreak.

Bereits als `for_sale` markierte Exemplare werden dem Vorschlag zuerst zugerechnet (sie zählen als „gehen schon"), damit die Liste nicht dieselbe Karte doppelt vorschlägt.

### 6.2 Ansicht (beide Geräte)

Neuer Arbeitslisten-Chip **Duplikate** in Sammlung › Karten (Reihenfolge: Alle · Unbekannt · Nachprüfen · Duplikate · Zum Verkauf · Unvollständig · Foils).
Zeile pro Karte: Bild, Name, „5 Exemplare · 2 über Playset", darunter der Vorschlag in Worten („2× LOB-DE001 Common NM Unlimited"), rechts Schalter **Auf die Verkaufsliste** (setzt `for_sale` auf genau die vorgeschlagenen Exemplare; erneut tippen nimmt sie zurück). Tipp auf die Zeile → Karten-Detail, wo im Exemplar-Sheet einzeln umgeschaltet werden kann.
Kopf: „14 Karten · 31 Exemplare über Playset · ca. 62 €" und Knopf **Alle Vorschläge auf die Verkaufsliste** (Bestätigung mit Zahl).

## 7. Verkaufsliste

### 7.1 Ansicht (beide Geräte)

Chip **Zum Verkauf** in Sammlung › Karten; die Liste zeigt nur Printings mit mindestens einem `for_sale`-Exemplar, gruppiert wie die normale Liste, aber mit Exemplar-Zeilen sichtbar: Zustand, Edition, Standort (B), Wert (A/G-Bewertung pro Exemplar).
Kopf: „23 Exemplare · 84,30 €", Knopf **Exportieren** → F „Verkaufsliste (Text)" mit genau diesen Exemplaren.
Aktionen pro Exemplar (Swipe am Handy, Hover-Buttons am Desktop):
- **Zurück in die Sammlung** → `for_sale = 0`.
- **Verkauft** → Bestätigung „Exemplar entfernen? Es gibt keine Verkaufs-Historie." → Soft-Delete des Exemplars (A); Standort wird damit frei, Zähler laufen über die Trigger.

### 7.2 Überall sonst

- Exemplar-Sheet (B): Schalter **Zum Verkauf**.
- Karten-Detail: Exemplar-Zeile zeigt ein kleines Preisschild-Icon, wenn `for_sale`.
- Sammlungs-Liste: Menge bekommt Zusatz „(2 zum Verkauf)" in der Zeile, wenn zutreffend; Filter-Sheet (C) erhält den Zustand „Zum Verkauf".
- Start (C): Arbeitslisten-Zähler „Zum Verkauf: 23 Exemplare · 84 €" und „Duplikate: 14 Karten".
- Wert: Exemplare zum Verkauf **zählen weiter** zum Gesamtwert (User-Entscheidung); die Wert-Karte zeigt darunter „davon zum Verkauf: 84 €".
- Deckbuilder (E): `for_sale`-Exemplare gelten weiterhin als verfügbar (sie sind noch da); die Deck-Kartenzeile markiert sie mit dem Preisschild, damit man nicht verkauft, was ein Deck braucht.
- Minus-Regel (A): beim Entfernen aus der Sammlungs-Liste werden `for_sale`-Exemplare **vor** anderen Standard-Exemplaren entfernt (sie sollten ohnehin weg).

## 8. Sync

`for_sale` in den Spiegel-Spalten des Copies-Stroms (A), Supabase-Spalte `boolean`. Keine weitere Änderung; Konflikte wie bei A (letzter Schreiber pro Zeile).

## 9. Betroffene Dateien

**Desktop main:** `database.cjs` (Spalte), `sync.cjs` (Spiegel-Spalte), `main.cjs` (IPC `list-duplicates`, `set-for-sale` (Liste von `copy_id`, bool), `sell-copy`; `remove-copy`-Minus-Regel angepasst), neu `duplicates.cjs` (`duplicates()` + Test), `preload.cjs`.
**Desktop renderer:** `CollectionList.jsx` (zwei Chips, Zusatz in der Mengenanzeige, Filter), neu `DuplicatesList.jsx`, `ForSaleList.jsx`; `CardDetailPanel.jsx`/`CopySheet.jsx` (Schalter, Icon); Start (Zähler); `DeckEditor.jsx` (Icon); Einstellungen › Standards (`keep_per_card`).
**Supabase:** `card_copies_for_sale_migration.sql`.
**Android:** `cloud/CopyRow.kt` (+`forSale`), `cloud/CollectionRepository.kt` (`setForSale`, `sellCopy`), neu `ui/Duplicates.kt` (Berechnung + Screen), `ui/ForSaleScreen.kt`; geändert `CollectionScreen.kt` (Chips, Filter), `CardDetailScreen.kt`/`CopySheet.kt`, `StartScreen.kt`, `SettingsScreen.kt`.

## 10. Fehlerfälle

- `keep_per_card` auf beiden Geräten unterschiedlich → verschiedene Duplikat-Listen; Hinweis in den Einstellungen, kein Sync (bewusst).
- Exemplar wird verkauft, während es auf dem anderen Gerät noch als `for_sale` gezeigt wird → Soft-Delete gewinnt beim nächsten Sync, Liste aktualisiert sich.
- Karte ohne Preis → Wert „—", Summe rechnet sie als 0, Vorschlag sortiert sie als billigstes Printing.
- Alle Exemplare einer Karte haben Standort/Tags → Vorschlag nimmt trotzdem die geringwertigsten (Kriterium 1 ordnet nur, schließt nicht aus).

## 11. Tests

- `duplicates()`: Playset-Grenze (3 → 0 Überschuss, 4 → 1), Kriterienreihenfolge (Standort schützt, Erste Auflage bleibt, PO vor NM, billigeres Printing zuerst), bereits markierte Exemplare zählen zum Vorschlag, `keep` konfigurierbar (JS + Kotlin mit denselben JSON-Fixtures unter `docs/fixtures/duplicates/`).
- `set-for-sale` idempotent; `sell-copy` soft-deletet und löst den Trigger aus (SQLite-Test).
- Minus-Regel: `for_sale` vor Standard vor abweichend (Erweiterung des A-Tests).
- Sync: `for_sale` im Push-Payload und beim Pull übernommen.
- Manuell: Duplikate am Desktop markieren → Handy zeigt Chip-Zähler und Preisschild; „Verkauft" am Handy → Desktop-Liste ohne das Exemplar; Export aus F enthält genau die Liste.

## 12. Risiken

- **Playset-Regel** passt nicht für Karten, von denen man bewusst viele sammelt (z. B. 20× Blue-Eyes) → sie erscheinen in Duplikate; der Schalter pro Zeile ignoriert sie einfach. Ein Per-Karte-Behalte-Wert wurde ausgeschlossen und bleibt als spätere Ergänzung möglich.
