# Spec H — Nachtrag H1: Duplikate & Verkaufsliste

**Datum:** 2026-09-17
**Ändert:** `docs/superpowers/specs/2026-09-05-spec-h-selling-design.md` §2–§3 (Aufteilung, Nicht-Ziele), §5–§12
**Setzt voraus:** A (Exemplare, `for_sale`-Spalte schon angelegt), B (Standort/Tags/Notiz, Exemplar-Sheet), C (Start, Sammlungs-Chips am PC), E3 (Artwork-Zuordnung `catalogMainId`), F1 (Verkaufsliste als Text), G4 (1.-Auflage-Preis).
**Status:** vom Nutzer Abschnitt für Abschnitt abgesegnet (2026-09-17).

---

## 1. Aufteilung von Spec H

Der Nutzer erweitert H um Verkaufs-Historie, Preisvorschläge und Marktplätze; die Nicht-Ziele aus Spec §3 entfallen dafür. H wird geteilt:

- **H1 Duplikate & Verkaufsliste (dieser Nachtrag).**
- **H2 Verkaufs-Historie & Preisvorschläge:** Verkauf buchen („verkauft für X € über Kanal Y", Exemplar entfernen), Übersicht Erlös/Gewinn gegenüber Wert, Preisvorschläge nach Regeln. Der Knopf „Verkauft" kommt erst hier.
- **H3 Marktplätze:** eBay über die offizielle API (Developer-Konto vorhanden: einstellen, ändern, beenden, Verkäufe zurückholen). Cardmarket (API nimmt keine Anträge an) und Kleinanzeigen (keine öffentliche API) halbautomatisch: die App bereitet Daten, Preisvorschlag und Link vor, der Nutzer stellt von Hand ein und bucht den Verkauf in der App.

## 2. Abgleich Spec H ↔ Code (2026-09-17)

| Spec H | Stand im Code |
|---|---|
| `for_sale` am Exemplar | Existiert seit A: `copies-schema.cjs` (SQLite), `sync.cjs` (`COPY_COLS`/`COPY_BOOLS`), `copies.cjs`, `supabase/card_copies_schema.sql` (`boolean not null default false`). Ungenutzt. |
| Handy liest `for_sale` | Nein: `cloud/CopyRow.kt` und `StoreQueries.COPY_COLS` kennen die Spalte nicht (ebenso `needs_review`/`review_reason`). |
| Duplikat-Berechnung, `keep_per_card` | Existiert nicht. |
| Arbeitslisten-Chips | PC `CollectionList.jsx`: `Alle · Unbekannt · Unvollständig · Foils`. Handy `CollectionScreen.kt`: keine Chip-Zeile, nur Filter-Chips. |
| Verkaufsliste als Text | F1 `export-formats.cjs#saleListText` nimmt eine beliebige Exemplar-Liste. |
| Bewertung | `valuation.cjs` / `valuation.js` / `Valuation.kt` (`unitPrice`, Zustandsfaktor, G4). |
| Einstellungen | PC `settings`-Tabelle, Handy `Prefs.kt`. |

## 3. Umfang H1

**Drin:** Duplikate (Regel §4, Liste, Markieren je Karte und alle), Verkaufsliste (Liste, Zurück in die Sammlung, Export über F1), Schalter/Icon/Zusätze überall (§5.3), Handy: Spalte nachziehen und Chip-Zeile `Alle · Duplikate · Zum Verkauf`.

**Nicht drin:** „Verkauft" (→ H2), „Nachprüfen"-Chip, Unbekannt/Unvollständig/Foils am Handy, Export am Handy, Wischgesten, Per-Karte-Behalte-Wert, Sync von `keep_per_card`.

## 4. Duplikat-Regel

**Gleiche Karte:** alle lebenden Exemplare mit demselben **Haupt-Passcode** über alle Printings, Sprachen und Seltenheiten. Artwork-Passcodes werden über den Katalog (`catalogMainId`, E3) der Hauptkarte zugeordnet. `Unknown`-Printings zählen mit. Ohne Katalog zählt der gespeicherte Passcode.

**Überschuss:** `max(0, Anzahl − keep_per_card)`; 0 → Karte erscheint nicht.

**Vorschlag** = die ersten `Überschuss` Exemplare nach stabiler Sortierung (erstes Kriterium zuerst):

1. Bereits `for_sale` vor nicht markierten.
2. Ohne Standort, Tags und Notiz vor solchen mit (Standort = `container_id` gesetzt).
3. Nicht 1. Auflage vor 1. Auflage (`edition != 'first'` zuerst).
4. Schlechterer Zustand zuerst: PO < PL < LP < GD < EX < NM < MT.
5. Billigeres Printing zuerst: `unitPrice` (bei `first` der 1.-Auflage-Preis aus G4), ohne Preis = 0.
6. Zuletzt angelegt zuerst (`created_at` absteigend).

Kriterium 2 ordnet nur, es schließt nichts aus.

**`keep_per_card`:** Einstellungen › Standards, ganze Zahl 1–99, Standard 3; kein Sync; Hinweis „auf beiden Geräten gleich einstellen". Ungültige Werte → 3.

**Umsetzung:** reine Funktion `duplicates(copies, keep, mainIdOf)` als markierter Zwilling JS ↔ Kotlin, gemeinsame Fixtures unter `docs/fixtures/duplicates/`. Ergebnis je Karte: Haupt-Passcode, Anzahl, Überschuss, vorgeschlagene `copy_id`s (in Sortierreihenfolge), Summe des Werts der Vorschläge.

## 5. Ansichten

### 5.1 PC — Sammlung › Karten

Chip-Zeile: `Alle · Unbekannt · Duplikate · Zum Verkauf · Unvollständig · Foils`.

**Duplikate:**
- Kopf: „14 Karten · 31 Exemplare über Playset · ca. 62 €", Knopf **Alle Vorschläge auf die Verkaufsliste** mit Bestätigung „31 Exemplare von 14 Karten markieren?".
- Zeile je Karte: Bild, Name, „5 Exemplare · 2 über Playset", darunter der Vorschlag in Worten (z. B. „2× LOB-DE001 Common · NM · Unlimited"), rechts Schalter **Auf die Verkaufsliste**.
- Klick auf die Zeile → Karten-Detail (Exemplare dort einzeln im Sheet umschaltbar).

**Zum Verkauf:**
- Kopf: „23 Exemplare · 84,30 €", Knopf **Exportieren** → F1-Export, Format Verkaufsliste, Umfang genau diese Exemplare.
- Nur Printings mit mindestens einem markierten Exemplar; Exemplar-Zeilen mit Zustand, Edition, Standort, Wert je Exemplar (Wertanzeige-Formel).
- Knopf je Exemplar: **Zurück in die Sammlung** (`for_sale = 0`).

### 5.2 Handy — Sammlung

Chip-Zeile über der Liste: `Alle · Duplikate · Zum Verkauf`. Inhalte wie am PC; „Zurück in die Sammlung" als Knopf in der Exemplar-Zeile. Kein Export.

### 5.3 Überall sonst (beide Geräte, soweit die Stelle existiert)

- Exemplar-Sheet: Schalter **Zum Verkauf**.
- Karten-Detail: Preisschild-Icon an markierten Exemplaren.
- Sammlungszeile: Zusatz „(2 zum Verkauf)".
- Start: Zähler „Zum Verkauf: 23 Exemplare · 84 €" und „Duplikate: 14 Karten"; Tipp öffnet die Liste.
- Wert: markierte Exemplare zählen weiter zum Gesamtwert; darunter „davon zum Verkauf: 84 €".
- Deckbuilder: markierte Exemplare gelten als verfügbar, mit Preisschild.
- Minus in der Sammlung: entfernt markierte Exemplare zuerst (vor der bestehenden A-Reihenfolge).

### 5.4 Zeilen-Schalter „Auf die Verkaufsliste"

- **An:** `for_sale = 1` auf allen vorgeschlagenen Exemplaren der Karte.
- **Aus:** `for_sale = 0` auf den vorgeschlagenen Exemplaren, **außer** denen, die in dieser Ansicht schon vor dem Einschalten markiert waren. Ohne diese Vorgeschichte (neue Ansicht, Neustart) nimmt „Aus" alle vorgeschlagenen Exemplare zurück.
- Angezeigter Zustand „An": alle vorgeschlagenen Exemplare sind markiert.

## 6. Sync

- PC: `for_sale` läuft im Copies-Strom mit; Umschalten setzt `updated_at` (wie Standort/Tags).
- Handy: `CopyRow.forSale`, Spalte in `COPY_COLS`, `CollectionRepository.setForSale(copyIds, value)` als Patch durch das `InFlight`-Gatter.
- Konflikte: letzter Schreiber je Zeile (wie A).

## 7. Fehlerfälle

| Fall | Verhalten |
|---|---|
| `keep_per_card` auf beiden Geräten verschieden | unterschiedliche Duplikat-Listen; Hinweis in den Einstellungen |
| Exemplar auf dem anderen Gerät gelöscht | verschwindet nach dem nächsten Sync aus beiden Listen |
| Karte ohne Preis | Wert „—", Summe rechnet 0 |
| Katalog fehlt | Gruppierung über gespeicherten Passcode, Alt-Arts getrennt, kein Hinweis |
| Doppeltipp auf „Alle Vorschläge" / Zeilen-Schalter / Zurück | PC Busy-Guard (früher Return im Handler + deaktiviert), Handy `InFlight`; Schalter während laufendem Umschalten gesperrt |
| Berechnung läuft | Platzhalter „…", nie „0 Karten" |

## 8. Tests

- `duplicates()` Zwilling JS + Kotlin, gemeinsame Fixtures: Playset-Grenze (3 → 0, 4 → 1), jedes der 6 Kriterien einzeln, Artwork-Zusammenfassung, Katalog fehlt, `keep` einstellbar.
- SQLite: `set-for-sale` idempotent und setzt `updated_at`; Minus-Regel entfernt `for_sale` zuerst; `quantity` nie direkt geschrieben.
- Sync PC: `for_sale` im Push-Payload und beim Pull übernommen. Handy: `forSale` gelesen und gepatcht.
- Schutz-Nachweise (sabotieren, zitieren, zurücknehmen): Minus-Regel, Busy-Guard/InFlight, Artwork-Zusammenfassung.

## 9. SQL

Keine Änderung geplant. Prüfabfrage an den Nutzer, ob `public.card_copies.for_sale` existiert; fehlt sie, wird die Zeile aus `supabase/card_copies_schema.sql` nachgereicht.

## 10. Abnahme

1. PC: Einstellungen `keep_per_card` = 3; Chip „Duplikate": Zahlen und Vorschläge plausibel, Exemplare mit Binder-Standort geschont.
2. Bei einer Karte „Auf die Verkaufsliste", dann „Zum Verkauf": Exemplare, Summe, Preisschild im Detail.
3. „Exportieren" aus „Zum Verkauf" enthält genau diese Exemplare.
4. Handy nach Sync: Chips „Duplikate" und „Zum Verkauf"; ein Exemplar „Zurück in die Sammlung" → am PC nach Sync nicht mehr in der Liste.
5. Minus in der Sammlung bei einer Karte mit markiertem Exemplar entfernt das markierte.
6. Start-Zähler, Wert-Zusatz, Preisschild im Deckbuilder.
