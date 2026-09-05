# Spec E — Deckbuilder Pro: Sammlungsabgleich, Deckbox, Legalität, Simulation, Import

**Datum:** 2026-09-05
**Status:** Entwurf, vom User im Brainstorming abgesegnet
**Teil von:** „Supercharge"-Programm (Specs A–H). Setzt **A** (Exemplare), **B** (Behälter/Deckbox, Einsortier-Modus), **C** (Decks-Segment, Navigation) und **D** (Katalog mit Banlist-Feld) voraus.

## 1. Problem

Der Deckbuilder ist eine Liste mit YDK-Import/-Export, Testhand und einem roten „fehlt"-Hinweis. Er weiß nicht, was das Vervollständigen kostet, ob das Deck legal ist, welche Karten schon physisch in der Deckbox stecken oder in einem anderen Deck verplant sind, und Listen aus dem Netz muss man abtippen.

## 2. Ziel

- **Planen aus der Sammlung:** pro Deck-Karte gebraucht / verfügbar / in der Box; Fehlende mit Kosten; ein Klick auf die Wunschliste (→ Deal-Watches).
- **Physisch:** Deck ↔ Deckbox (B). Exemplare in der Box sind „im Deck"; Karten in anderen Decks gelten nicht als verfügbar.
- **Spielen:** Legalität (TCG/OCG/Frei), Banlist aus dem Katalog, Handsimulation mit Wahrscheinlichkeiten.
- **Listen übernehmen:** YDK, YDKE-Link, Textliste, YGOPRODeck-URL (best effort). Export YDK, YDKE, Text.
- Handy: Abgleich, Legalität, Import/Export; Simulation nur Desktop.

## 3. Nicht-Ziele

- Combo-/Sequenz-Simulation, Mulligan-Logik.
- Master-Duel-Meta-Exportcodes (proprietär für den Spiel-Client), Master-Duel-Konto-Kopplung.
- Deck-Preis-Verlauf, Deck-Sharing mit anderen Nutzern.
- Printing-genaue Decklisten (Deck-Karten bleiben Passcode-Ebene; die Printings stecken physisch in der Deckbox).

## 4. Entscheidungen

| Entscheidung | Verworfen | Warum |
|---|---|---|
| Deck-Karten bleiben Passcode-Ebene; Physik über Deckbox-Behälter aus B | Printing/Exemplar-Referenz pro Deck-Karte | Ein Plan sagt „3× Ash Blossom", nicht welches Printing; die Box beantwortet „welche Exemplare". Keine neue Verknüpfungstabelle. |
| „Verfügbar" schließt Exemplare in **anderen** Deckboxen aus | Alle Exemplare zählen | Sonst zeigt jedes Deck 3/3, obwohl die Karte in Deck X steckt. |
| Banlist aus dem Katalog (D), nicht live | Live-API pro Deck-Öffnung | Offline-fähig, ein Datenpfad, wöchentlich frisch reicht. |
| YDKE als Austauschformat für Neuron/Konami-DB | Deck-Foto, Neuron-API | Neuron hat keine API; YDKE → Konami-DB → Neuron ist der etablierte Weg. |
| YGOPRODeck-URL nur best effort | Parser für die Seite als Kernfeature | HTML ändert sich; YDKE-String aus der Seite ziehen, sonst klare Meldung. |

## 5. Datenmodell

### 5.1 `decks` (Supabase, lokale Spiegelung wie heute über IPC)

```sql
alter table public.decks add column if not exists format       text not null default 'tcg';  -- tcg | ocg | free
alter table public.decks add column if not exists container_id text;                          -- Deckbox aus B, optional
alter table public.decks add column if not exists notes        text;
alter table public.decks add column if not exists updated_at   timestamptz not null default now();
```

### 5.2 `deck_cards`

```sql
alter table public.deck_cards add column if not exists role text;   -- 'starter' | null  (Handsimulation)
```

Kein weiteres Schema. Der Katalog (D) liefert pro Karte `ban_tcg`, `ban_ocg`; der Desktop hält dieselben Felder in `api_cache`/`cards` (Migration: `cards.ban_tcg`, `cards.ban_ocg` als Spalten, vom Poller mitgeschrieben, damit auch der Desktop ohne Katalog prüfen kann).

### 5.3 Abgleich (reine Funktion `deckCoverage`)

Eingabe: Deck-Karten, alle lebenden Exemplare (A) mit `container_id` (B), Liste der Deckboxen aller Decks.
Pro Deck-Karte:
- `needed` = count
- `inBox` = Exemplare dieses Passcodes in der Deckbox dieses Decks
- `available` = Exemplare dieses Passcodes, die in **keiner** Deckbox eines anderen Decks liegen (inkl. `inBox` und nicht einsortierte)
- `missing` = max(0, needed − available)
- `reservedElsewhere` = Exemplare in anderen Deckboxen (für die Markierung „in Deck X")
- `missingCost` = missing × günstigster Printing-Preis (Cardmarket-Trend aus `cards`/Katalog; 0 → „Preis unbekannt")
Deck-Summe: `owned = Σ min(needed, available)`, `missing = Σ missing`, `cost = Σ missingCost`.

### 5.4 Legalität (reine Funktion `deckLegality(deck, format)`)

| Regel | TCG / OCG | Frei |
|---|---|---|
| Main 40–60 | ✓ | – |
| Extra ≤ 15, Side ≤ 15 | ✓ | – |
| ≤ 3 Kopien pro Karte (Main+Side zusammen) | ✓ | – |
| Banlist: Forbidden = 0, Limited ≤ 1, Semi-Limited ≤ 2 (`ban_tcg` bzw. `ban_ocg`) | ✓ | – |
| Karte ohne Banlist-Daten | Warnung „unbekannt" | – |
Ergebnis: `{ legal: bool, violations: [{ rule, cardId?, text }] }`.

### 5.5 Handsimulation (reine Funktionen)

- `pAtLeastOne(deckSize, starters, hand)` hypergeometrisch: `1 − C(N−K, n) / C(N, n)`, für Hand 5 und 6.
- `simulateHands(deck, 1000)`: Anteil Hände mit ≥ 1 `role = 'starter'`, plus Verteilung 0/1/2+.
Starter = Deck-Karten mit `role = 'starter'`; keine Starter markiert → Anzeige „Markiere Starthand-Ziele".

## 6. Import und Export

### 6.1 Import

| Quelle | Erkennung | Verhalten |
|---|---|---|
| YDK-Datei | bestehend | unverändert |
| **YDKE-Link** | Text beginnt mit `ydke://` | drei Base64-Blöcke (main!extra!side) → je Liste von Little-Endian-uint32-Passcodes |
| **Textliste** | Zeilen wie `3 Ash Blossom & Joyous Spring`, `2x Nibiru, the Primal Being`, `Nibiru x2`, Abschnittsüberschriften `Main/Extra/Side` optional | Namen gegen Katalog (DE + EN) exakt, dann normalisiert (Satzzeichen, Groß/Klein), dann Fuzzy (Levenshtein ≤ 2). Unklare Namen → Dialog mit Vorschlägen; nichts wird still geraten. Ohne Abschnitte: Extra-Deck-Typen automatisch nach Extra. |
| **YGOPRODeck-URL** | `ygoprodeck.com/deck/…` | Seite laden, `ydke://…` per Regex extrahieren → YDKE-Pfad. Nicht gefunden → „Konnte die Liste nicht lesen. Lade die YDK-Datei auf der Seite herunter und importiere sie." |
| Zwischenablage / Teilen (Handy) | Share-Intent `text/plain` oder Einfügen | Inhalt wird als YDKE oder Textliste erkannt |

Nach jedem Import: Vorschau-Dialog (Karten, erkannte Abschnitte, unaufgelöste Zeilen) → Deckname → Anlegen. Bereits vorhandene Passcodes werden aus dem lokalen `cards`/Katalog benannt; unbekannte per YGOPRODeck nachgeladen (bestehender Fallback).

### 6.2 Export

- YDK-Datei (bestehend), **YDKE-Link** in die Zwischenablage, **Textliste** in die Zwischenablage (`3 Name` je Zeile, Abschnitte). Handy: YDKE per Teilen-Dialog.

## 7. Bedienung

### 7.1 Desktop (Sammlung › Decks)

- **Liste:** Name, Format-Chip, Legalitäts-Badge (grün „Legal" / rot „3 Verstöße"), „37/40 vorhanden", Deckbox-Name. Neu-Button mit Menü: Leer · YDK · YDKE/Text einfügen · URL.
- **Editor-Kopf:** Name, Format-Select, Deckbox-Select (Deckboxen aus B, „Neue Deckbox anlegen"), Kennzahlen „vorhanden / fehlen / ca. Kosten", Buttons **Fehlende auf die Wunschliste**, **Box befüllen** (öffnet die Deckbox-Ansicht aus B mit Vorschlag der noch fehlenden Exemplare), Export-Menü.
- **Kartenzeile:** Anzahl, Name, drei kleine Zahlen `Box / verfügbar / gebraucht` als Mini-Balken, Markierung „in Deck X" (gelb), Banlist-Icon (rot/orange), Starter-Stern (toggle `role`).
- **Seitenleiste rechts:** Tabs Statistik (bestehend) · Simulation (5/6 Karten, Wahrscheinlichkeit, 1000 Hände, Testhand ziehen) · Verstöße.
- Karten-Detail via Overlay-Route (C).

### 7.2 Handy (Sammlung › Decks)

- Liste wie Desktop (Badge, Zähler). Plus → Leer · Einfügen (Text/YDKE) · YDK-Datei (Dateiauswahl).
- Editor: Kopf mit Kennzahlen, Buttons Fehlende auf die Wunschliste / Box befüllen (→ B-Einsortieren für die Deckbox) / Teilen (YDKE). Kartenzeilen mit `Box/verfügbar/gebraucht` und Banlist-Icon. Verstöße als aufklappbare Liste. Keine Simulation.
- Share-Intent-Empfang: App als Ziel für Text registrieren; erkennt YDKE/Textliste → Import-Vorschau.

## 8. Wunschlisten-Kopplung

**Fehlende auf die Wunschliste** legt pro fehlender Karte einen Wunschlisten-Eintrag (Passcode, Menge = missing, `max_price` = 1,2 × günstigster Preis, gerundet) an, sofern nicht schon vorhanden (dann Menge erhöhen). Der bestehende Mechanismus erzeugt daraus die Deal-Watches. Rückmeldung: „3 Karten auf der Wunschliste, Deal-Suche läuft."

## 9. Betroffene Dateien

**Shared (Desktop):** neu `desktop/src/utils/deck.js` (`deckCoverage`, `deckLegality`, `pAtLeastOne`, `simulateHands`, `parseYdke`, `buildYdke`, `parseTextList`) mit Tests `deck.test.mjs`.
**Desktop main:** `main.cjs` (`get-deck-details` liefert Coverage-Rohdaten: Exemplare je Passcode mit Container; `save-deck` schreibt `format/container_id/notes/role`; neu `import-deck-url`, `deck-missing-to-wishlist`; Poller schreibt `ban_tcg/ban_ocg`), `database.cjs` (zwei Spalten), `preload.cjs`.
**Desktop renderer:** `DeckBuilder.jsx` aufteilen in `DeckList.jsx`, `DeckEditor.jsx`, `DeckSidebar.jsx` (Statistik/Simulation/Verstöße), `DeckImportDialog.jsx`.
**Supabase:** `supabase/decks_pro_migration.sql`.
**Android:** `cloud/DecksRepository.kt` (neue Felder), neu `ui/deck/DeckMath.kt` (Coverage/Legality-Port + Tests), `ui/deck/DeckImport.kt` (YDKE/Text), `ui/DecksScreen.kt` (Liste/Editor), `AndroidManifest.xml` (Share-Intent-Filter), `ScanScreen`/B-Einsortieren mit Deckbox-Ziel.

## 10. Fehlerfälle

- Deckbox gelöscht (B) → `container_id` wird NULL, Deck zeigt „keine Box"; Coverage rechnet mit `inBox = 0`.
- Katalog/Banlist fehlt → Legalität zeigt „Banlist unbekannt", andere Regeln laufen.
- Import mit unaufgelösten Zeilen → Vorschau listet sie, Import legt nur Aufgelöste an, Rest bleibt als Textnotiz im Deck (`notes`).
- YDKE ungültig (Base64/Länge) → „Kein gültiger YDKE-Link".
- Wunschliste: Karte ohne Preis → `max_price` leer, Eintrag trotzdem.

## 11. Tests

- `deckCoverage`: Karte in anderer Deckbox nicht verfügbar; nicht einsortierte zählen; `inBox` ≤ `available`; Kosten mit unbekanntem Preis.
- `deckLegality`: alle Regeln pro Format, Semi-Limited-Grenze, Main+Side zusammen, Frei ohne Regeln.
- `pAtLeastOne` gegen bekannte Werte (40 Karten, 9 Starter, Hand 5 ≈ 0,72); `simulateHands` deterministisch mit Seed.
- `parseYdke`/`buildYdke` Roundtrip; bekannte YDKE-Beispiele; `parseTextList` mit allen Zeilenformen und Abschnitten.
- Kotlin: Port-Tests für DeckMath und DeckImport mit denselben Fixtures (JSON-Fixtures geteilt unter `docs/fixtures/decks/`).
- Manuell: Deck aus YDKE importieren → Fehlende auf Wunschliste → Deal-Watch erscheint; Deckbox befüllen → Zahlen stimmen auf beiden Geräten; Banlist-Verstoß sichtbar.

## 12. Risiken

- **Textlisten-Namensauflösung** bei deutschen/englischen Mischlisten: beide Namensspalten prüfen, Fuzzy-Grenze konservativ, Dialog statt Rateversuch.
- **Preis „günstigstes Printing"** kann ein exotisches Printing sein; Anzeige „ca.", Wunschlisten-Preis 1,2× als Puffer.
- **YGOPRODeck-URL-Import** bricht bei Seitenänderung; als best effort gekennzeichnet.
