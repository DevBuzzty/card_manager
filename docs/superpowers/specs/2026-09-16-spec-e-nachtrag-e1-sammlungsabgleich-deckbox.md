# Spec E — Nachtrag: Aufteilung in E1–E3 und E1 „Sammlungsabgleich & Deckbox"

**Datum:** 2026-09-16
**Ändert:** `docs/superpowers/specs/2026-09-05-spec-e-deckbuilder-pro-design.md` §5.1, §5.2 (Kosten), §5.3, §7 (Abgleich, Deckbox), §8, §9, §10, §11
**Setzt voraus:** A, B1/B2, C, D1 sowie G1–G4 (gemergt, zuletzt `bf3115c`).
**Status:** vom Nutzer Abschnitt für Abschnitt abgesegnet (2026-09-16).

---

## 1. Abgleich Spec E ↔ Code (2026-09-16)

| Annahme in Spec E | Stand im Code |
|---|---|
| §5.1 Decks „lokale Spiegelung wie heute über IPC" | Decks und Deckkarten liegen **nur in der Cloud** (`supabase/decks_schema.sql`: `decks(id,user_id,name,created_at)`, `deck_cards(id,deck_id,user_id,card_id,name,image_url,count,section,created_at)`). Desktop liest/schreibt direkt per `dealsClient()` (`main.cjs` `get-decks`, `create-deck`, `delete-deck`, `save-deck`, `get-deck-details`, `import-deck-ydk`, `export-deck-ydk`). Die gleichnamigen SQLite-Tabellen in `database.cjs` sind unbenutzt. |
| §5.1 `format`, `container_id`, `notes`, `updated_at`; §5.2 `role` | Keine dieser Spalten existiert. |
| §9 Android „neu `DecksRepository.kt`, `DecksScreen.kt`" | Beide existieren: Liste, Editor mit Suche (Main/Extra, **kein Side-Deck**), YDK-Export per Teilen, Cache über `SideStores.decks`/`deckCards(id)`. |
| §7.1 Desktop | `DeckBuilder.jsx` (454 Zeilen) unter `#/sammlung/decks`: YDK-Import/-Export, Testhand, Statistik, roter „fehlt"-Hinweis (`card.quantity > ownedQty`). |
| B „Deckbox, Einsortier-Modus" | `containers.kind` kennt `deckbox`; `card_copies.container_id/page/slot` existieren. Einsortieren (Handy) ist rein Binder-bezogen. **Keine** Deck↔Behälter-Verknüpfung. |
| §5.2 Banlist „aus dem Katalog (D)" | Offline-Katalog (D1, Version 5) existiert und wird aus YGOPRODeck `cardinfo.php` gebaut, liest aber weder Banlist noch Preise. Keine Ban-Spalten irgendwo. |
| §8 Wunschliste „Menge erhöhen" | `wishlist(id,user_id,card_id,name,image_url,max_price,watch_id,created_at)`, `unique(user_id,card_id)`, **keine Menge**. Ein Eintrag mit Preis erzeugt schon heute einen Deal-Watch (Desktop `add-to-wishlist`, Handy `WishlistRepository`); der Desktop löst die Cloud-Suche pro Eintrag aus. |
| §6 Namens-Fuzzy vorhanden | Levenshtein nur für Set-Codes (`setCodeMatch.js`, `SetCodeMatch.kt`), nicht für Kartennamen. YDKE nirgends. |
| §5.3 „günstigster Printing-Preis" | Preise nur für besessene Printings (`cards.price`); am Handy kein Katalogpreis. Keine Aggregation pro Passcode. |
| §7.2 Share-Intent | `AndroidManifest.xml` hat nur den Launcher-Filter. |

## 2. Aufteilung und Reihenfolge (Nutzerentscheidung 2026-09-16)

| Teil | Inhalt |
|---|---|
| **E1 Sammlungsabgleich & Deckbox** | dieser Nachtrag |
| **E2 Import & Export** | YDKE, Textliste mit Namensauflösung, YGOPRODeck-URL, Share-Intent am Handy, Side-Deck am Handy, `decks.notes` |
| **E3 Legalität & Simulation** | Banlist in Katalog und Desktop, `decks.format`, Legalität, `deck_cards.role`, Handsimulation |

Reihenfolge **E1 → E2 → E3**, je eigener Nachtrag, Plan und Abnahme.

**E1 nicht drin:** Import/Export-Erweiterungen, Side-Deck am Handy, Legalität, Simulation, `format`/`notes`/`role`/`updated_at`, lokale Spiegelung der Decks, Scanner-Führung in die Deckbox, Aktion zum Herausnehmen überzähliger Exemplare, Aufteilen von `DeckBuilder.jsx` in vier Dateien.

## 3. Datenmodell

Decks bleiben cloud-only; kein lokaler Spiegel. Neue SQL-Datei `supabase/decks_container.sql` (der Nutzer spielt sie ein):

```sql
alter table public.decks add column if not exists container_id text;   -- Deckbox, optional
create unique index if not exists decks_container_unique
  on public.decks (container_id) where container_id is not null;
```

- Ein Deck hat höchstens eine Deckbox, eine Deckbox gehört höchstens einem Deck.
- Kein Fremdschlüssel (Behälter werden nur soft-gelöscht). Eine gelöschte oder nicht mehr `kind = 'deckbox'`-Box gilt als „keine Box"; die Spalte wird nicht automatisch geleert.
- Auswahl: nur lebende Behälter mit `kind = 'deckbox'`, die keinem anderen Deck gehören, plus die eigene.
- Deck-Karten bleiben auf Passcode-Ebene.

## 4. Abgleichsregel `deckCoverage` (Zwilling)

JS `desktop/src/utils/deckCoverage.js` ↔ Kotlin `ml/DeckCoverage.kt`, gemeinsame Fixture `docs/fixtures/decks/coverage.json`.

**Eingabe:** Karten des Decks (`card_id`, `count`, `section`); alle lebenden Exemplare (`card_id`, `container_id`) lebender Printings; alle Decks mit gültiger Deckbox (`deck_id`, `name`, `container_id`); Katalogpreise je Passcode (§5).

**Pro Passcode des Decks:**

| Wert | Regel |
|---|---|
| `needed` | Summe `count` über main, extra, side |
| `inBox` | lebende Exemplare in der gültigen Deckbox **dieses** Decks |
| `reservedElsewhere` | lebende Exemplare in gültigen Deckboxen **anderer** Decks, mit deren Namen |
| `available` | alle lebenden Exemplare − `reservedElsewhere` |
| `missing` | max(0, `needed` − `available`) |
| `missingCost` | `missing × cm_price`, `null` ohne Preis (§5) |

Verfügbar sind auch unsortierte Exemplare und solche in Ordnern, Boxen und keinem Deck zugeordneten Deckboxen. Exemplare eines `Unknown`-Printings zählen (Passcode bekannt). Gelöschte Exemplare und Printings zählen nicht.

**Deck-Summen:** `owned = Σ min(needed, available)`, `boxed = Σ min(needed, inBox)`, `missing = Σ missing`, `cost = Σ missingCost` über Karten mit Preis, `unpriced` = Anzahl fehlender Passcodes ohne Preis.

**Datenquelle:** Desktop — neuer IPC-Kanal liefert lebende Exemplare je Passcode mit `container_id` (plus die Behälterliste); Decks aus der Cloud wie heute. Handy — `CollectionStore`-Exemplare, `SideStores.decks`/`deckCards`, Behälter aus dem vorhandenen Store.

## 5. Kosten: Katalogpreis `cm_price`

- `catalog-build.cjs` liest je Karte `card_prices[0].cardmarket_price` aus der vorhandenen `cardinfo.php`-Antwort; Wert > 0 → `cm_price` (Zahl), sonst `null`. Katalog **Version 6**.
- Handy `CatalogDb` **Schema v3** importiert `cm_price`; ein Katalog v5 bleibt lesbar (Preis dann `null`).
- Desktop liest `cm_price` aus derselben Katalogdatei, die er baut (kein zusätzlicher Abruf).
- Anzeige „ca. 42,80 €"; mit Karten ohne Preis „ca. 42,80 € + 2 ohne Preis"; nur ohne Preise „Preis unbekannt".

## 6. Wunschlisten-Kopplung

**„Fehlende auf die Wunschliste":**
- Kandidaten: jeder Passcode mit `missing > 0`, der noch nicht auf der Wunschliste steht. Vorhandene Einträge bleiben unverändert.
- `max_price = round(1,2 × cm_price, 2)`; ohne Preis leer → Eintrag trotzdem, **kein** Deal-Watch (bestehende Regel).
- Bestätigung vorab: „8 fehlende Karten auf die Wunschliste setzen? 2 stehen schon drauf, 1 hat keinen Preis und bekommt keine Deal-Suche." — *Hinzufügen* / *Abbrechen*.
- Cloud-Suche **einmal** am Ende, nicht pro Karte.
- Rückmeldung: „8 Karten auf der Wunschliste, Deal-Suche läuft."; bei Teilfehlern „5 von 8 hinzugefügt, 3 fehlgeschlagen".
- Regeln als Zwilling: `wishlistMaxPrice(cmPrice)`, `missingForWishlist(coverage, wishlistCardIds)`.

## 7. Box befüllen

Nur mit gültiger Deckbox. **Vorschlagsregel `fillBoxProposal`** (Zwilling, Fixture): pro Passcode `min(needed − inBox, available − inBox)` Exemplare, gewählt aus den verfügbaren Exemplaren außerhalb dieser Box in der Reihenfolge
1. unsortiert (kein Behälter),
2. Boxen und keinem Deck zugeordnete Deckboxen,
3. Ordner (Lücke im Ordner zuletzt),

innerhalb der Gruppe günstigstes Exemplar zuerst (`unitPrice × Zustandsfaktor` aus G4), bei Gleichstand stabil nach `copy_id`.

**Dialog (Desktop) / Sheet (Handy):** Zeilen mit Name, Printing (Set-Code, Rarity, Edition) und aktuellem Ort („Ordner Blau · S. 3 · Fach 2", „Box Tausch", „unsortiert"), alle vorab angehakt. **„In die Box verschieben"** setzt `container_id` = Deckbox und leert `page`/`slot` über die bestehenden Standort-Helfer, Exemplar für Exemplar; Fehlschläge werden pro Zeile gezeigt. Danach Zahlen neu.
- Reicht `available` nicht: „3 fehlen noch – nicht in der Sammlung" mit Verweis auf „Fehlende auf die Wunschliste".
- Überzählige Exemplare in der Box: nur Anzeige („2 überzählig in der Box").

## 8. Anzeige

**Desktop Deck-Liste:** Deckbox-Name bzw. „keine Box", „37/40 vorhanden", bei Fehlenden „ca. 42,80 €".

**Desktop Editor-Kopf:** Deckbox-Auswahl („Keine Box" + freie Deckboxen + eigene; ohne Deckboxen „Noch keine Deckbox" mit Link zur Behälter-Seite); Kennzahlen „vorhanden 37/40 · in der Box 12/40 · fehlen 3 · ca. 42,80 €"; Buttons **Fehlende auf die Wunschliste** (aus ohne Fehlende) und **Box befüllen** (aus ohne Box).

**Desktop Kartenzeile:** statt rotem „fehlt" drei Zahlen „Box 1 · verfügbar 2 · gebraucht 3" (rot bei Fehlenden), gelbe Markierung „1 in Deck Tenpai".

**Code-Struktur Desktop:** `DeckBuilder.jsx` bleibt; neue Teile als eigene Komponenten (Abgleich-Kopf, Kartenzeilen-Zahlen, Box-befüllen-Dialog).

**Handy:** Deck-Liste mit denselben Zahlen; Editor-Kopf mit Deckbox-Auswahl, Kennzahlen und beiden Buttons; Kartenzeilen mit „Box/verfügbar/gebraucht" und „in Deck X".

**Ladezustand:** Solange Exemplare oder Decks nicht geladen sind, zeigen die Zahlen „…", nie „0/40".

## 9. Fehlerfälle

- Deckbox gelöscht/umgestellt → „keine Box", `inBox = 0`, Exemplare wieder verfügbar.
- Zwei Geräte ordnen dieselbe Box gleichzeitig zu → Unique-Index lehnt ab: „Diese Deckbox gehört schon zu einem anderen Deck".
- Katalog < v6 oder fehlt (Handy) → alle Kosten „Preis unbekannt", Rest läuft.
- Cloud nicht erreichbar → Desktop zeigt den Fehler wie heute; Handy zeigt den letzten Stand aus dem Zwischenspeicher, Schreiben scheitert mit Meldung.
- Wunschliste teilweise fehlgeschlagen → siehe §6.
- Verschieben teilweise fehlgeschlagen → siehe §7.

## 10. Einspiel-Reihenfolge

1. Nutzer spielt `supabase/decks_container.sql` ein.
2. Installer; am Desktop „Katalog jetzt bauen" (v6).
3. Erst dann APK (CatalogDb v3).

## 11. Tests

- `deckCoverage`: andere Deckbox nicht verfügbar; unsortiert und nicht zugeordnete Box verfügbar; Summe über Abschnitte; gelöschte Exemplare/Printings zählen nicht; `Unknown`-Printing zählt; ungültige Box = keine Box; Kosten mit/ohne Preis; Deck-Summen. JS + Kotlin mit `docs/fixtures/decks/coverage.json`.
- `fillBoxProposal`: Gruppenreihenfolge, günstigstes zuerst, Gleichstand stabil, Lücke bei zu wenig Exemplaren, Box-Exemplare nicht erneut vorgeschlagen. JS + Kotlin mit Fixture.
- `missingForWishlist`/`wishlistMaxPrice`: vorhandene Einträge übersprungen, Rundung, ohne Preis. JS + Kotlin mit Fixture.
- Katalog-Build: `cm_price` gelesen, 0/fehlend → `null`, Version 6. Handy-Parser liest das Feld, Katalog v5 bleibt lesbar.
- IPC: neue Kanäle in `main.cjs` **und** `preload.cjs`; Cloud-Suche beim Massen-Hinzufügen genau einmal.
- Jeder Schutz-Test scheitert nachweislich ohne den Schutz.

## 12. Abnahme

1. Desktop: Deck eine Deckbox zuordnen → Handy zeigt dieselbe Box.
2. Kennzahlen (vorhanden, in der Box, fehlen, Kosten) auf beiden Geräten gleich.
3. Zweites Deck mit derselben Karte → „in Deck X" erscheint, `available` sinkt.
4. „Box befüllen" am Desktop → Ort und Zahlen auf beiden Geräten aktuell.
5. „Fehlende auf die Wunschliste" → Einträge und Deal-Watches erscheinen, Cloud-Suche einmal ausgelöst.
6. Dieselbe Box einem zweiten Deck zuordnen → Meldung, nichts geändert.

Spec E §3 (Nicht-Ziele), §4 und die E2/E3-Teile von §5–§12 gelten fort, vorbehaltlich der dort anstehenden Nachträge und der Korrekturen in §1 dieses Dokuments.
