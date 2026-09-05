# Spec F — Import und Export: Dragon Shield, YGOPRODeck, generische CSV, Fremdformate

**Datum:** 2026-09-05
**Status:** Entwurf, vom User im Brainstorming abgesegnet
**Teil von:** „Supercharge"-Programm (Specs A–H). Setzt **A** (Exemplare mit Zustand/Edition), **B** (Behälter für Ordner), **D** (Katalog für Namensauflösung, sprachneutrales Set-Code-Matching) voraus. Desktop-only.

## 1. Problem

Der heutige CSV-Import liest nur eine Passcode-Spalte (Semikolon, Spalte 2) und verliert alles andere. Wer aus Dragon Shield, YGOPRODeck, Collectr oder einer Excel-Liste kommt, muss abtippen. Es gibt keinen Export außer Datenbank-Backup und dem Passcode-CSV, also auch keinen Weg hinaus.

## 2. Ziel

- Ein Import-Kanal mit **Profilen**: Dragon Shield, YGOPRODeck, Card Dex (eigenes Format, verlustfrei), Generisch (Spalten-Zuordnung, gespeichert).
- **Auflösung** ohne stilles Raten: Passcode → Set-Code → Name; Unklares landet in der Vorschau.
- **Vorschau mit Ampel** und wählbarer Regel für Bestehendes; Import läuft ganz oder gar nicht.
- Ordner werden Behälter, Zustand/Edition werden Exemplare.
- **Export** in Card Dex CSV, Dragon Shield CSV, YGOPRODeck CSV, Cardmarket-Wantslist, Verkaufsliste (Text).

## 3. Nicht-Ziele

- Import am Handy.
- Collectr-/TCGplayer-Spezialprofile (laufen über Generisch mit Zuordnung).
- Bild-, Deck- oder Preis-Historien-Import; Decks kommen über YDK/YDKE (E).
- Automatischer Abgleich mit Online-Konten (kein API-Zugang bei den genannten Apps).

## 4. Entscheidungen

| Entscheidung | Verworfen | Warum |
|---|---|---|
| Ein Zwischenformat, mehrere Reader | Ein Parser pro Quelle bis in die DB | Auflösung, Vorschau und Ausführung sind für alle Quellen gleich; nur das Lesen unterscheidet sich. |
| Unklare Zeilen blockieren nicht, werden aber nie geraten | Fuzzy-Treffer still übernehmen | Falsche Karten in der Sammlung sind teurer als drei Klicks in der Vorschau. |
| Ordner → Behälter der Art `box` ohne Seite/Fach | Binder mit Fächern rekonstruieren | Fremdformate kennen keine Fächer; der Einsortier-Modus (B) füllt sie später. |
| Ganz oder gar nicht (Transaktion) | Zeilenweise mit Fehlerliste | Halbimporte hinterlassen unklare Zustände, besonders bei „Ersetzen". |
| UTF-8 mit BOM, Trennzeichen automatisch | Festes Semikolon | Excel (DE) schreibt Semikolon, Dragon Shield Komma; BOM rettet Umlaute in Excel. |

## 5. Zwischenformat

```js
// Eine Zeile nach dem Lesen, vor der Auflösung. Alles optional außer count.
{
  passcode: '46986414' | null,
  name: 'Dunkler Magier' | null,      // wie in der Datei
  setCode: 'LOB-DE005' | null,
  setName: 'Legend of Blue Eyes…' | null,
  rarity: 'Ultra Rare' | null,       // roh, wird normalisiert
  language: 'DE' | null,
  count: 3,
  condition: 'NM' | null,            // normalisiert
  edition: 'first' | null,           // normalisiert
  container: 'Binder Blau' | null,   // Ordnername
  tags: ['…'] | null, note: null,    // nur Card-Dex-Profil
  page: null, slot: null,            // nur Card-Dex-Profil
  purchasePrice: null,               // gelesen, aber in A nicht gespeichert → Protokoll-Hinweis
  sourceLine: 17
}
```

## 6. Reader (Profile)

### 6.1 Erkennung
Reihenfolge: Card-Dex-Kopfzeile (`carddex_version` als erste Spalte) → Dragon Shield (erste Zeile beginnt mit `sep=` **oder** Kopfzeile enthält `Folder Name` und `Card Number`) → YGOPRODeck (Kopfzeile enthält `cardname` und `cardq`) → Generisch (Zuordnung nötig). Der Nutzer kann das erkannte Profil überschreiben.

CSV-Grundlagen für alle: Trennzeichen aus Kopfzeile ermitteln (`,` `;` `\t`), RFC-4180-Quoting, BOM entfernen, Leerzeilen überspringen. Eigener kleiner Parser in `csv-parse.cjs` (kein Paket; Tests decken Quoting ab).

### 6.2 Dragon Shield
- Zwei Kopfzeilen überspringen (`sep=,` und Spaltennamen). Spalten per Name: `Folder Name`, `Quantity`, `Trade Quantity`, `Card Name`, `Set Code`, `Set Name`, `Card Number`, `Condition`, `Printing`, `Language`, `Price Bought`, `Date Bought`, `LOW`, `MID`, `MARKET`.
- `Set Code` + `Card Number` → `setCode` (`LOB` + `EN005` → `LOB-EN005`; wenn `Card Number` schon den vollen Code enthält, so übernehmen).
- `Printing`: `1st Edition`/`First` → `first`, `Unlimited` → `unlimited`, `Limited` → `limited`, sonst `unknown`.
- `Condition`: Dragon-Shield-Skala (`Mint`, `Near Mint`, `Excellent`, `Good`, `Light Played`, `Played`, `Poor`) → `MT NM EX GD LP PL PO`.
- `Language`: `German`→`DE`, `English`→`EN`, `Japanese`→`JP`, `French`→`FR`, `Italian`→`IT`, `Spanish`→`SP`, `Portuguese`→`PT`.
- `Folder Name` → `container`; `Trade Quantity` → Tag `tausch` auf so vielen Exemplaren.

### 6.3 YGOPRODeck
Spalten: `cardname`, `cardq`, `cardrarity`, `card_edition`, `cardset`, `cardcode`, optional `cardid`, `print_id`. `cardid` → `passcode`, `cardcode` → `setCode`, `card_edition` (`1st Edition`/`Unlimited`/`Limited`) → `edition`. Sprache aus dem Set-Code-Infix. Kein Zustand, kein Ordner.

### 6.4 Card Dex (eigenes Format)
Verlustfrei, eine Zeile pro Exemplar-Gruppe (gleiches Printing, Edition, Zustand, Behälter, Seite, Fach, Tags, Notiz):
`carddex_version, passcode, name, set_code, rarity, language, count, edition, condition, container, container_kind, page, slot, tags, note`
(`tags` als `|`-getrennt). Import setzt Seite/Fach nur, wenn der Behälter ein Binder ist oder neu angelegt wird.

### 6.5 Generisch
Dialog mit Dropdown pro Zwischenformat-Feld → Spalte der Datei (oder „–"). Pflicht: `count` **und** mindestens eines von `passcode`, `setCode`, `name`. Zuordnung wird in `settings` unter dem Schlüssel `import_mapping:<sha1 der normalisierten Kopfzeile>` gespeichert und beim nächsten Mal vorgeschlagen. Zusätzlich: Sprache und Zustand als **Konstante** für die ganze Datei setzbar, wenn die Datei keine Spalte hat.

## 7. Auflösung (`resolveRow`, reine Funktion + Katalog/DB-Lookups)

Reihenfolge, erster Treffer gewinnt:
1. **Passcode** vorhanden und im Katalog/`cards` → Karte fest.
2. **Set-Code**: englischer Code → eindeutig Karte + Rarity (YGOPRODeck `card_sets` im Katalog). Anderssprachiger Code → sprachneutrales Matching aus D (Präfix+Nummer, Region aus dem Code). Widerspricht der Name deutlich (Fuzzy-Distanz > 3 zu DE- und EN-Namen) → Status **Unklar** mit beiden Kandidaten.
3. **Name**: exakt (DE, EN) → normalisiert (Satzzeichen, Groß/Klein, Umlaute) → Fuzzy (Levenshtein ≤ 2). Mehrere Treffer → **Unklar** mit Liste.
4. Nichts → **Unklar**.

Danach Printing bestimmen: `setCode` aus Datei; fehlt er → **Unknown**-Printing (gelb, „Set unbekannt"). Rarity: aus Datei (normalisiert über die bestehende Rank-Tabelle), sonst aus dem Set-Code-Treffer, sonst niedrigste des Codes (gelb). Sprache: aus Datei, sonst aus Set-Code-Infix, sonst Konstante/`DE`. Zustand fehlt → Default aus A (gelb, „Zustand: Standard"). Edition fehlt → Default (gelb).

Status pro Zeile: **grün** (Karte, Printing, Rarity, Zustand, Edition alle aus der Datei bestimmt), **gelb** (mindestens eine Annahme), **rot** (Unklar).

## 8. Vorschau und Ausführung

### 8.1 Vorschau (`ImportPreview.jsx`)
- Kopf: Profil, Datei, Zusammenfassung „412 Zeilen · 398 eindeutig · 11 mit Annahme · 3 unklar · 2 Behälter werden angelegt · 1 Spalte ignoriert (Price Bought)".
- Tabelle (react-window): Ampel, Zeile, gelesener Name, aufgelöste Karte (Bild klein), Printing, Menge, Zustand, Edition, Behälter, Grund bei gelb/rot. Filter: Alle / Nur gelb / Nur rot.
- Rote Zeilen: Klick öffnet Kandidatenliste (Name-Treffer, Set-Code-Kandidaten) oder Kartensuche (bestehendes `CardSearchModal`); Auswahl macht die Zeile grün. „Auslassen" entfernt sie aus dem Import (bleibt im Protokoll).
- **Regel für Bestehendes** (Radio): *Hinzufügen* (Standard: Exemplare kommen dazu), *Ersetzen* (Menge der in der Datei vorkommenden Printings wird auf die Datei gesetzt: überzählige Exemplare werden soft-gelöscht, Standard-Exemplare zuerst, wie die Minus-Regel aus A), *Überspringen* (Printings, die schon existieren, bleiben unverändert).
- **Übernehmen** ist erst aktiv, wenn keine rote Zeile mehr übrig ist (aufgelöst oder ausgelassen).

### 8.2 Ausführung (`import-run` IPC, eine SQLite-Transaktion)
1. Behälter anlegen (Art `box`, Name aus Datei; Card-Dex-Profil: `container_kind` und bei Bindern `pockets_per_page` aus Datei oder 9).
2. Printings anlegen/aktualisieren (`cards` ohne Preis; Stammdaten aus Katalog/`api_cache`, sonst Nachladen über YGOPRODeck nach dem Import durch den bestehenden Poller).
3. Exemplare erzeugen (A) mit Edition, Zustand, Behälter, Seite/Fach, Tags, Notiz; bei *Ersetzen* zuerst angleichen.
4. Protokoll schreiben: `userData/imports/<datum>-<profil>.json` (Zeilen, Status, Entscheidungen, ignorierte Spalten). Dialog nach Abschluss: Zusammenfassung + „Protokoll speichern unter…".
Sync (A/B) trägt Behälter und Exemplare zum Handy; Reihenfolge Cards → Containers → Copies ist bereits Regel.

## 9. Export

Erreichbar über Einstellungen › Daten › Export und über das Menü in Sammlung › Karten (mit aktuellem Filter als Umfang).

| Format | Umfang | Spalten |
|---|---|---|
| **Card Dex CSV** | alle lebenden Exemplare, gruppiert wie 6.4 | 6.4 |
| **Dragon Shield CSV** | Exemplare | zwei Kopfzeilen (`sep=,` + Namen), Spalten wie 6.2; `Folder Name` = Behälter oder „Sammlung", `Printing` aus Edition, `Condition` in Dragon-Shield-Wörtern, `Language` ausgeschrieben, Preise `MARKET` = Printing-Preis, `LOW`/`MID` leer |
| **YGOPRODeck CSV** | Exemplare gruppiert nach Printing + Edition | `cardname, cardq, cardrarity, card_edition, cardset, cardcode, cardid` (englischer Name aus Katalog) |
| **Cardmarket Wantslist** | Wunschliste | `Menge Name` je Zeile, optional `[Set-Code]`; Textdatei zum Einfügen in Cardmarkets Wantslist-Import |
| **Verkaufsliste (Text)** | Exemplare mit Tag `verkauf` oder aktueller Filter | `Anzahl × Name (Set-Code, Rarity, Zustand, Edition) – Preis €` |

Alle CSV: UTF-8 mit BOM, RFC-4180-Quoting, Trennzeichen Komma (Dragon Shield/YGOPRODeck erwarten Komma; Card Dex ebenfalls Komma, weil der eigene Reader beides liest).

## 10. Betroffene Dateien

**Desktop main:** neu `electron/import/csv-parse.cjs`, `electron/import/readers.cjs` (Profile 6.2–6.5 + Erkennung), `electron/import/resolve.cjs` (§7), `electron/import/run.cjs` (§8.2), `electron/export/writers.cjs` (§9); `main.cjs` (IPC `import-open` → Datei + Profil + Zeilen, `import-resolve`, `import-run`, `export-run`, `import-mapping-get/set`; alter `import-csv`-Handler entfällt), `preload.cjs`.
**Desktop renderer:** neu `components/ImportWizard.jsx` (Datei → Profil/Zuordnung → Vorschau → Ergebnis), `components/ImportPreview.jsx`, `components/MappingDialog.jsx`; Einstellungen › Daten (C) verlinkt Import/Export; Sammlung-Menü „Exportieren…"; `StagingArea` verliert den CSV-Knopf (wandert in den Wizard).
**Tests:** `csv-parse.test.cjs` (Quoting, BOM, Trennzeichen), `readers.test.cjs` (je Profil eine Fixture-Datei unter `desktop/electron/import/fixtures/`), `resolve.test.cjs` (Reihenfolge, Unklar-Fälle, Normalisierung Zustand/Edition/Rarity), `run.test.cjs` (Transaktion, drei Regeln, Behälter-Anlage; Electron-Node-Trick), `writers.test.cjs` (Roundtrip Card Dex → Import → identische Exemplare; Dragon-Shield-Kopfzeilen).

## 11. Fehlerfälle

- Datei nicht lesbar / keine Kopfzeile → Meldung, kein Profil.
- Profil erkannt, aber Pflichtspalte fehlt → Wechsel auf Generisch mit vorbelegter Zuordnung.
- Katalog fehlt (D noch nicht geladen) → Namensauflösung nur gegen lokale `cards`; Hinweis in der Vorschau, dass mehr Zeilen unklar sein können.
- Fehler während der Ausführung → Rollback, Meldung mit Zeile, nichts geändert.
- „Ersetzen" würde Exemplare mit Standort/Tags löschen → Vorschau warnt mit Zahl; Standard-Exemplare (ohne Standort/Tags) werden zuerst entfernt.
- `purchasePrice`/`Date Bought` in der Datei → wird nicht gespeichert (A ohne Kaufpreis); Protokoll und Zusammenfassung nennen die ignorierte Spalte.

## 12. Risiken

- **Dragon-Shield-Spaltenreihenfolge** kann sich ändern → Zugriff über Spaltennamen, nicht Position; unbekannte Kopfzeile → Generisch.
- **Namensdubletten** (gleicher Name, mehrere Karten, z. B. Token) → Unklar, Liste zeigt Passcode und Typ.
- **Große Dateien** (10 000+ Zeilen) → Auflösung im Main-Prozess mit Fortschritts-Event, Vorschau virtualisiert.
