# Spec F — Nachtrag F1: Export & eigenes Format

**Datum:** 2026-09-16
**Ändert:** `docs/superpowers/specs/2026-09-05-spec-f-import-export-design.md` §2 (Aufteilung), §6.4 (Card-Dex-Spalten), §7–§12 für den Card-Dex-Teil
**Setzt voraus:** A (Exemplare), B (Behälter), D (Offline-Katalog mit Artwork-Zuordnung seit E3), G4 (1.-Auflage-Preis in der Wertanzeige).
**Status:** vom Nutzer Abschnitt für Abschnitt abgesegnet (2026-09-16).

---

## 1. Aufteilung

Spec F wird geteilt:

- **F1 Export & eigenes Format (dieser Nachtrag):** Card-Dex-CSV lesen und schreiben, dazu die Exporte Dragon Shield CSV, YGOPRODeck CSV, Cardmarket-Wantslist, Verkaufsliste.
- **F2 Fremd-Import (später):** Dragon Shield, YGOPRODeck, Generisch mit Spalten-Zuordnung, Kartensuche für rote Zeilen, Namensauflösung aus E2 wiederverwenden. Erst mit F2 verschwindet der alte CSV-Knopf im Staging (`import-csv`).
- **Eigene Folgeaufgabe, nicht Teil von F:** Wunschliste fehlt im lokalen Backup.

Nur Desktop. Das Handy bekommt in F1 keinen Export und keinen Import; es sieht importierte Exemplare über den normalen Sync.

## 2. Card-Dex-CSV

Eine Zeile je **Exemplar-Gruppe**: gleiches Printing, Edition, Zustand, Behälter, Seite, Fach, Tags, Notiz.

| Spalte | Inhalt |
|---|---|
| `carddex_version` | `1` |
| `passcode` | gespeicherter Passcode (Artwork bleibt erhalten) |
| `name` | nur zur Lesbarkeit, wird beim Import nicht ausgewertet |
| `set_code` | Set-Code; `Unknown` bleibt `Unknown` |
| `rarity` | Seltenheit |
| `language` | Sprache |
| `count` | Anzahl Exemplare der Gruppe (≥ 1) |
| `edition` | interner Code (`first`/`unlimited`/`limited`/`unknown`) |
| `condition` | interner Code (`MT`/`NM`/`EX`/`GD`/`LP`/`PL`/`PO`) |
| `container` | Behältername, leer ohne Behälter |
| `container_kind` | Behälter-Art, leer ohne Behälter |
| `pockets_per_page` | Fächer je Seite (neu gegenüber §6.4), leer ohne Binder |
| `page` | Seite, nur bei Binder |
| `slot` | Fach, nur bei Binder |
| `tags` | mit `|` getrennt |
| `note` | Notiz |

- UTF-8 mit BOM, Trennzeichen Komma, übliche Anführungszeichen-Regeln. Der Reader erkennt `,` `;` und Tab.
- Sortierung: Behältername (ohne Behälter zuletzt), Seite, Fach, Name, Set-Code.
- **Nicht enthalten:** Preise, `price_locked`, Cardmarket-IDs, Preisverlauf, Sealed, Decks, Wunschliste.
- **Behälter beim Import** über den Namen: Ein lebender gleichnamiger Behälter wird genutzt, sonst angelegt (Art und Fächerzahl aus der Datei, Binder ohne Angabe 9). Seite/Fach nur bei Binder. Kommt ein Name mit verschiedener Art oder Fächerzahl vor, gilt die erste Zeile; die übrigen werden gelb.

## 3. Card-Dex-Import

**Einstieg:** Einstellungen › Daten › „Importieren…" öffnet einen Dateidialog. Ist die erste Spalte `carddex_version`, folgt die Vorschau. Andere Dateien: „Nur Card-Dex-CSV – andere Formate folgen".

**Auflösung je Zeile** (reiner Helfer, Ampel):

- **Grün:** Passcode im Katalog (über die Artwork-Zuordnung) oder in der lokalen Sammlung, alle Felder gültig.
- **Gelb** (wird übernommen, mit Hinweis):
  - Behälter wird neu angelegt.
  - Seite/Fach belegt oder Behälter kein Binder: Exemplar kommt ohne Seite/Fach in den Behälter.
  - Edition oder Zustand ungültig: Standardwert aus `settings`.
  - Printing existiert lokal noch nicht: wird angelegt; Name, Typ, Bild aus dem Katalog, Preis später über den bestehenden Preisabruf.
  - Behältername mit abweichender Art/Fächerzahl (siehe §2).
- **Rot:** Passcode unbekannt oder Menge ungültig. In F1 nur „Auslassen".

**Vorschau:**

- Kopfzeile, z. B. „412 Zeilen · 398 bereit · 11 mit Hinweis · 3 unbekannt · 2 Behälter werden angelegt".
- Virtualisierte Liste, Filter Alle / Hinweise / Unbekannt, Grund bei Gelb und Rot.
- **Regel für Bestehendes:**
  - *Hinzufügen* (Standard): Exemplare kommen zusätzlich dazu.
  - *Ersetzen*: Für jedes Printing der Datei werden die vorhandenen lebenden Exemplare soft-gelöscht und durch die der Datei ersetzt. Warnung vorab, z. B. „37 vorhandene Exemplare werden ersetzt, davon 12 mit Standort oder Tags".
  - *Überspringen*: Printings mit vorhandenen Exemplaren bleiben unverändert.
- **Übernehmen** ist erst aktiv, wenn keine rote Zeile übrig ist (alle ausgelassen).

**Ausführung (`import-run`):**

- Eine SQLite-Transaktion, ganz oder gar nicht: Behälter anlegen, fehlende Printings anlegen, bei *Ersetzen* angleichen, Exemplare in Blöcken erzeugen.
- Fehler: Rollback, Meldung „Import fehlgeschlagen: …" mit Zeilennummer, nichts geändert.
- Danach: Zusammenfassung „398 Exemplare importiert · 2 Behälter angelegt · 3 ausgelassen"; Protokoll `userData/imports/<Datum>-carddex.json` mit Zeilen, Status und Entscheidungen; Ereignis `collection-changed`.
- `cards.quantity` und `cards.deleted` werden nie direkt geschrieben; nur Soft-Delete.

**Sync:** Neue Exemplare, Printings und Behälter gehen über den normalen Sync-Zyklus in die Cloud. Wie der Push bei tausenden Zeilen in Seiten schiebt, prüft der Plan; Anpassungen bleiben im bestehenden Push-Weg.

## 4. Exporte

**Einstieg:** Einstellungen › Daten › „Exportieren…" öffnet einen Dialog mit Format und Umfang, danach den Speichern-Dialog. Im Sammlungs-Menü derselbe Dialog mit „Aktueller Filter" vorausgewählt.

**Umfang:** Ganze Sammlung · Aktueller Filter · ein Behälter.

| Format | Inhalt |
|---|---|
| **Card Dex (CSV)** | §2; einziges verlustfrei wieder einlesbares Format |
| **Dragon Shield (CSV)** | Zeile je Printing × Edition × Zustand; Spalten nach deren Import-Vorlage: Menge, Name, Set-Code, Seltenheit, Sprache, Edition, Zustand, Preis. Zustände: MT/NM → Near Mint, EX → Excellent, GD → Good, LP → Light Played, PL → Played, PO → Poor |
| **YGOPRODeck (CSV)** | Zeile je Printing: Menge, Name, Set-Code, Seltenheit, Passcode |
| **Cardmarket-Wantslist (Text)** | Nur Wunschliste (Umfang fest). Zeile je Karte, z. B. `2 Dark Magician (LOB-EN005)`; englische Namen |
| **Verkaufsliste (Text)** | Zeile je Gruppe, z. B. `2× Dark Magician – LOB-DE005 – Ultra Rare – 1. Auflage – NM – 12,50 €`; Summe am Ende; Preis wie in der Wertanzeige (Zustandsfaktor, 1.-Auflage-Preis aus G4) |

- `Unknown`-Printings: leerer Set-Code; in Wantslist und Verkaufsliste weggelassen, Anzahl im Ergebnis-Hinweis.
- Je Format ein reiner, getesteter Formatierer gegen Fixture-Dateien.

## 5. Fehlerfälle

| Fall | Verhalten |
|---|---|
| Datei leer, nicht lesbar, ohne Kopfzeile | „Datei nicht lesbar", keine Vorschau |
| `carddex_version` größer als 1 | „Datei stammt aus einer neueren Card-Dex-Version", nichts importiert |
| Offline-Katalog fehlt | Prüfung nur gegen lokale Sammlung, übrige Zeilen rot, Hinweis „Offline-Katalog fehlt" |
| Doppelklick auf Übernehmen | Busy-Schutz am Anfang des Handlers, kein zweiter Lauf |
| Behältername mit verschiedener Art/Fächerzahl | erste Zeile gilt, übrige gelb |
| Schreibfehler beim Export | „Export fehlgeschlagen: …" |
| Leerer Umfang | Knopf deaktiviert, „Nichts zu exportieren" |

## 6. Tests

- **Reine Helfer**, Fixtures unter `docs/fixtures/import-export/`:
  - Card Dex schreiben/lesen, Rundlauf: Export und Import in eine leere Datenbank ergeben dieselben Exemplare.
  - Trennzeichen-Erkennung, BOM, Anführungszeichen.
  - Zeilenauflösung mit Ampel.
  - Regeln Hinzufügen / Ersetzen / Überspringen.
  - Ein Formatierer je Exportformat.
- **`import-run`** gegen SQLite-Testdatenbank: Rollback bei Fehler in Zeile N; *Ersetzen* nur soft-löschend; `quantity` nie direkt geschrieben.
- **Schutz-Nachweise** (sabotieren, zitieren, zurücknehmen) für Rollback, Busy-Schutz, Soft-Delete.
- Keine Zwillinge (Handy nicht beteiligt).

## 7. SQL

Keins. Alle Tabellen und Spalten existieren.

## 8. Abnahme (PC)

1. Ganze Sammlung als Card Dex exportieren.
2. Datei in Texteditor/Excel ansehen: Umlaute, Spalten.
3. Test-Datenbank anlegen (Einstellungen › Datenbank verschieben), Datei importieren, Anzahl und Standorte vergleichen, zurückwechseln.
4. In der echten Sammlung eine kleine bearbeitete Datei mit *Hinzufügen* und *Ersetzen* importieren, mit gelben und roten Zeilen.
5. Verkaufsliste und Wantslist exportieren, in Kleinanzeigen bzw. Cardmarket einfügen.
6. Am Handy prüfen, dass importierte Exemplare nach dem Sync da sind.
