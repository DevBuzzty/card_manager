# Spec E — Nachtrag E3: Legalität & Simulation

**Datum:** 2026-09-16
**Ändert:** `docs/superpowers/specs/2026-09-05-spec-e-deckbuilder-pro-design.md` §5.1 (`format`), §5.2 (`role`, Ban-Felder), §5.4, §5.5, §7.1/§7.2 (Format, Badge, Banlist-Icons, Starter, Seitenleiste, Verstöße), §10–§12
**Setzt voraus:** E1 (`bcc579d`), E2 (`392d123`, Nachtrag `2026-09-16-spec-e-nachtrag-e2-import-export.md`).
**Status:** vom Nutzer Abschnitt für Abschnitt abgesegnet (2026-09-16).

---

## 1. Abgleich Spec E ↔ Code (2026-09-16)

| Annahme | Stand im Code |
|---|---|
| Banlist `ban_tcg`/`ban_ocg` aus dem Katalog; Desktop-`cards` bekommt Ban-Spalten | Nirgends gelesen oder gespeichert. Katalog-Bau (`catalog-build.cjs`) packt `id, name_de, name_en, type, desc_de, atk, def, level, race, attribute, image, image_small, printings, printings_verified, cm_price`; Version ist ein fortlaufender Zähler. Handy `CatalogDb` Schema v3 ohne Ban-Felder. Desktop-`cards` ohne Ban-Spalten. |
| Desktop-Katalogindex | Seit E2 (`catalog-prices.cjs`) mit `id, name_de, name_en, type[, image]`; Ban-Felder billig ergänzbar. |
| `decks.format`, `deck_cards.role` | Existieren nicht (vorhanden: `decks.container_id`, `decks.notes`). |
| Legalität, Badge, Verstöße, Banlist-Icons | Nirgends gebaut. |
| Handsimulation | Nur `drawTestHand` am Desktop: `Array.sort(() => 0.5 - Math.random())`, 5 Karten, nicht seedbar, keine Wahrscheinlichkeiten. Keine Kombinatorik-/Seed-Helfer im Repo. |
| Seitenleiste Statistik · Simulation · Verstöße | `DeckBuilder.jsx` hat einen Statistik-Umschalter (`showStats`/`DeckStats`) und die Testhand inline, keine Seitenleiste. |
| Kopien-Grenze | Desktop `addToDeck`: 3 je Abschnitt (nicht über Abschnitte); `moveOne` ohne Grenze. Handy `addCard` legt immer eine neue Zeile an, ohne Grenze; `moveOne` ohne Grenze. |
| Kartenidentität | `deck_cards.card_id` = Passcode. Katalog kennt nur die Haupt-ID je Karte; alternative Artworks (YGOPRODeck `card_images[].id`) fehlen → Ban-Lookup, 3-Kopien-Regel und E2-Import („Unbekannter Passcode") scheitern an Artwork-Passcodes. |
| Speichern | Desktop `save-deck` löscht alle Deckkarten und fügt sie mit fester Spaltenliste neu ein → `role` ginge verloren, solange nicht mitgeschickt. Handy mutiert zeilenweise. |

## 2. Umfang

**Drin:** Artwork-Zuordnung im Katalog (behebt auch die E2-Folgeaufgabe „Unbekannter Passcode" bei Alt-Arts), Ban-Felder im Katalog, `decks.format`, Legalitätsregeln als Zwilling, Anzeige auf beiden Geräten, `deck_cards.role` mit Starter-Stern und exakten Starthand-Wahrscheinlichkeiten (nur Desktop), einheitliche Kopien-Grenze beim Hinzufügen/Verschieben, Handy-„Hinzufügen" erhöht bestehende Zeile.

**Nicht drin:** GOAT/Genesys/sonstige Formate, OCG-spezifische Deckregeln außer der Banlist, Aufräumen bestehender Doppelzeilen am Handy, Simulation am Handy, Klick auf Verstoß markiert Zeile, Desktop-`cards`-Ban-Spalten (abweichend von Spec §5.2).

## 3. Katalogdaten

**Artwork-Zuordnung:** Für jede Karte werden alle `card_images[].id`, die von der Haupt-`id` abweichen, in ein neues Katalog-Feld auf oberster Ebene geschrieben: `aliases: { "<Artwork-Passcode>": "<Haupt-Passcode>" }` (Passcodes als Strings ohne führende Nullen, wie in E2). Desktop liest es über den Katalogindex; Handy speichert es in `CatalogDb` v4 als Tabelle `card_aliases(alt_id TEXT PRIMARY KEY, card_id TEXT NOT NULL)`.

Regel (Zwilling `canonicalPasscode(p, aliases)`): `aliases[p] ?? p`.
- **E2-Import:** Passcode-Auflösung läuft über die Zuordnung (Name, Typ, Bild von der Hauptkarte); die Deckkarte **behält den importierten Artwork-Passcode** (Export bleibt artwork-treu).
- **Legalität, Kopien-Grenze, Ban-Lookup:** immer über den Haupt-Passcode.

**Banlist:** je Katalogkarte `ban_tcg` und `ban_ocg` aus `banlist_info`: `Banned` → `forbidden`, `Limited` → `limited`, `Semi-Limited` → `semi`; fehlendes `banlist_info` bzw. fehlender Schlüssel → `null` = uneingeschränkt. Handy: Spalten `ban_tcg`, `ban_ocg` in `CatalogDb` v4 (Upgrade verwirft den Katalog bis zum nächsten Sync). Desktop: über den Katalogindex, keine neuen `cards`-Spalten.

**„Unbekannt"** heißt: Passcode auch über die Zuordnung nicht im Katalog, oder kein Katalog vorhanden.

**Frische:** Katalog wöchentlich bzw. sofort per „Katalog jetzt bauen". Die Deck-Ansicht zeigt „Banlist-Stand: TT.MM.JJJJ" (Datum `built_at` des Katalogs).

## 4. Format und Legalitätsregeln (Zwilling `deckLegality.js` ↔ `DeckLegality.kt`)

Gemeinsame Fixture `docs/fixtures/decks/legality.json`.

**Format:** `decks.format text not null default 'tcg' check (format in ('tcg','ocg','free'))`; Anzeige „TCG", „OCG", „Frei".

**Regeln TCG/OCG** (Banlist-Liste je Format: `ban_tcg` bzw. `ban_ocg`), in dieser Reihenfolge:

| # | Regel | Verstoß-Text (Muster) |
|---|---|---|
| 1 | Main Deck 40–60 Karten | „Main Deck: 38 Karten (erlaubt 40–60)" |
| 2 | Extra Deck ≤ 15 | „Extra Deck: 16 Karten (höchstens 15)" |
| 3 | Side Deck ≤ 15 | „Side Deck: 17 Karten (höchstens 15)" |
| 4 | Keine Extra-Deck-Karte im Main Deck; im Extra Deck nur Extra-Deck-Karten (Typ per `deckSectionFor`) | „Tri-Brigade Rugal im Main Deck gehört ins Extra Deck" / „Ash Blossom im Extra Deck gehört ins Main Deck" |
| 5 | Höchstens 3 Kopien je Karte, gezählt über den Haupt-Passcode über Main + Extra + Side | „Ash Blossom: 4 Kopien (höchstens 3)" |
| 6 | Banlist: verboten 0, limitiert ≤ 1, semi-limitiert ≤ 2, gezählt über alle Abschnitte | „Pot of Greed ist verboten" / „Harpie's Feather Duster: 2 Kopien (limitiert 1)" / „…: 3 Kopien (semi-limitiert 2)" |

- Regel 5 zählt Main + Extra + Side (offizielle Regel; Spec §5.4 nannte nur Main + Side).
- Verletzt eine Karte Regel 5 und 6, erscheint nur der strengere Verstoß (Regel 6).
- Karten ohne Typ (unbekannt) werden von Regel 4 nicht geprüft.
- Namen in Texten: gespeicherter Deckkartenname, sonst Katalogname, sonst Passcode.
- Reihenfolge innerhalb einer Regel: Reihenfolge des ersten Auftretens im Deck (Main, Extra, Side).

**Warnungen** (nie Verstoß): Karte auch über die Zuordnung nicht im Katalog → „Banlist unbekannt: Passcode 12345678" (je Haupt-Passcode einmal). Kein Katalog → genau eine Warnung „Katalog fehlt – Banlist unbekannt"; Regeln 1–3 und 5 laufen weiter (Regel 5 dann ohne Zuordnung), Regeln 4 und 6 entfallen.

**Frei:** keine Regeln, keine Warnungen.

**Ergebnis:** `{ legal, violations: [{ rule, cardId?, text }], warnings: [{ cardId?, text }] }`, `legal = violations leer`.

**Badge-Text (Zwilling):** „Legal", „Legal · 1 Warnung" / „Legal · 2 Warnungen", „1 Verstoß" / „3 Verstöße", „Frei".

## 5. Kopien-Grenze (Zwilling `canAddCopy`)

`canAddCopy(deckCards, passcode, format, aliases) → boolean`: TCG/OCG → `false`, wenn die Karte (Haupt-Passcode, über alle Abschnitte) danach mehr als 3 Kopien hätte; Frei → immer `true`. Die Banlist blockiert nie. Gilt beim Hinzufügen und Verschieben auf beiden Geräten; Meldung „Höchstens 3 Kopien je Karte". Verschieben zwischen Abschnitten ändert die Summe nicht und wird daher nie blockiert.

**Handy-Hinzufügen:** erhöht die bestehende Zeile derselben Karte (gleicher Passcode) im selben Abschnitt statt eine neue Zeile anzulegen. Bestehende Doppelzeilen bleiben; Legalität zählt sie zusammen.

## 6. Starter und Starthand-Wahrscheinlichkeiten (nur Desktop, `deckOdds.js`)

**Starter:** `deck_cards.role text check (role in ('starter'))`, leer = normal (gleiche SQL-Datei wie `format`). Stern-Umschalter nur an Main-Deck-Zeilen. Desktop „Save Deck" schickt `role` mit (überlebt Löschen+Neu-Einfügen). Handy lässt das Feld unangetastet und zeigt keinen Stern.

**Rechnung exakt (hypergeometrisch):** N = Main-Deck-Größe, K = Starter-Kopien im Main Deck, n = 5 (anfangen) und 6 (nachziehen). Je n: P(0), P(1), P(≥2) und P(≥1) = 1 − P(0). Berechnung über Produkte von Brüchen (keine großen Binomialkoeffizienten). Kanten: K = 0 → P(0) = 1; K ≥ N → P(0) = 0 (sofern n ≥ 1); n > N → n wird auf N begrenzt; N = 0 → „Keine Main-Deck-Karten".

**Anzeige:** „5 Karten: mindestens 1 Starter 72,4 %" und „0: 27,6 % · 1: 44,1 % · 2+: 28,3 %"; dasselbe für 6 Karten. Ohne markierte Starter: „Markiere Starthand-Ziele mit dem Stern".

**Abweichung von Spec §5.5:** keine Simulation von 1000 Händen (die exakte Verteilung liefert dasselbe, immer gleich, ohne Seed).

**Testhand:** „Testhand ziehen" bleibt; zieht 5 oder 6 zufällige Karten aus dem Main Deck (Kopien einzeln), Starter hervorgehoben. Ziehen als reiner Helfer mit austauschbarer Zufallsquelle.

## 7. Anzeige

**Desktop:**
- Deck-Liste: Format-Chip und Badge (grün „Legal", gelb „Legal · n Warnungen", rot „n Verstöße", grau „Frei").
- Editor-Kopf: Format-Auswahl neben dem Namen und Badge; Legalität aus dem **ungespeicherten** Editor-Stand; Format wird mit „Save Deck" gespeichert.
- Kartenzeile: Banlist-Icon nach Format (rot „Verboten", orange „1", gelb „2"; uneingeschränkt kein Icon); Main-Deck-Zeilen zusätzlich Starter-Stern.
- Die bisherige Statistik wird zu einer Seitenleiste neben dem Editor mit Reitern „Statistik" (wie bisher), „Simulation" (§6) und „Verstöße" (Liste aus §4 plus „Banlist-Stand: …").

**Handy:**
- Deck-Liste: Format-Chip und Badge.
- Editor-Kopf: Format-Auswahl (speichert sofort) und Badge; darunter aufklappbar „n Verstöße" (inkl. Warnungen und „Banlist-Stand").
- Kartenzeile: Banlist-Icons wie am Desktop, kein Stern.
- Legalität aus dem gespeicherten Stand.

## 8. Fehlerfälle

- Kein Katalog / Katalog ohne Ban- und Artwork-Felder → Warnung „Katalog fehlt – Banlist unbekannt", keine Banlist-Icons, Artwork-Passcodes zählen einzeln.
- Spalte `format` fehlt (SQL noch nicht eingespielt) → Anzeige als TCG; Formatwechsel meldet „Format konnte nicht gespeichert werden".
- Spalte `role` fehlt → Sterne werden nicht gespeichert; Simulation zeigt „Markiere Starthand-Ziele mit dem Stern".
- Deck ohne Main-Deck-Karten → Simulation „Keine Main-Deck-Karten", Legalität Regel 1.
- Karte in mehreren Abschnitten → Kopien summiert; Starter nur im Main Deck.
- Artwork- und Haupt-Passcode derselben Karte im Deck → zusammen gezählt, Banlist einmal.

## 9. Einspiel-Reihenfolge

1. Nutzer spielt `supabase/decks_format_role.sql` ein (`decks.format` mit Default und Check, `deck_cards.role` mit Check).
2. Installer; am Desktop „Katalog jetzt bauen" (neue Version mit `aliases`, `ban_tcg`, `ban_ocg`).
3. APK (`CatalogDb` v4); am Handy in den Einstellungen „Jetzt prüfen".

## 10. Tests

- **Katalog-Bau:** Artwork-Zuordnung (Haupt-ID nicht aufgenommen, mehrere Artworks), Ban-Werte umgesetzt, fehlendes `banlist_info` = `null`; Handy-Parser liest `aliases` und Ban-Felder, älterer Katalog bleibt lesbar.
- **Legalität:** jede Regel mit Grenzen (39/40/60/61, 15/16, 3/4 Kopien, verboten/limitiert/semi), Zählung über Abschnitte, Artwork zusammen, OCG vs. TCG, Frei, unbekannte Karte, Katalog fehlt, Regel-4-Typen, Vorrang Regel 6 vor 5, Reihenfolge, Badge-Texte inkl. Einzahl. JS + Kotlin mit `legality.json`.
- **`canAddCopy`, `canonicalPasscode`:** JS + Kotlin mit Fixture.
- **Starthand (JS):** bekannte Werte (40/9/5 ≈ 0,72), K = 0, K = N, n > N, N = 0; Testhand mit austauschbarer Zufallsquelle.
- **Desktop:** „Save Deck" behält `role` und `format`; E2-Import löst Artwork-Passcodes auf; IPC-Änderungen in `main.cjs` **und** `preload.cjs`.
- **Handy:** Hinzufügen erhöht bestehende Zeile, Grenze; `CatalogDb` v4-Upgrade.
- Jeder Schutz-Test scheitert nachweislich ohne den Schutz; E1/E2-Aufrufer geänderter geteilter Funktionen geprüft.

## 11. Abnahme

1. Desktop: Deck auf TCG/OCG stellen; mit 38 Main-Deck-Karten, 4. Kopie und doppelt limitierter Karte zeigt der Badge die Verstöße; das Handy zeigt dieselbe Liste.
2. Banlist-Icons auf beiden Geräten korrekt; „Banlist-Stand" zeigt das Katalogdatum.
3. Deck mit Artwork-Variante (z. B. Dark Magician) importiert ohne „Unbekannter Passcode"; Artwork + Normalversion zählen zusammen.
4. 4. Kopie hinzufügen auf beiden Geräten blockiert; im Format „Frei" nicht.
5. Starter markieren, speichern, neu öffnen → Sterne da; 40 Karten / 9 Starter / 5 Karten ≈ 72 %.
6. Handy „+ Hinzufügen" erhöht die Anzahl statt eine neue Zeile anzulegen.

Spec E §3 (Nicht-Ziele) und §4 gelten fort, vorbehaltlich der Korrekturen in §1 und der Abweichungen in §2, §4 und §6 dieses Dokuments.
