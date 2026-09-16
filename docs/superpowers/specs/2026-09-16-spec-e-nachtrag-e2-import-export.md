# Spec E — Nachtrag E2: Import & Export

**Datum:** 2026-09-16
**Ändert:** `docs/superpowers/specs/2026-09-05-spec-e-deckbuilder-pro-design.md` §5.1 (`notes`), §6, §7.1/§7.2 (Import, Export, Side-Deck), §9–§12
**Setzt voraus:** E1 (`docs/superpowers/specs/2026-09-16-spec-e-nachtrag-e1-sammlungsabgleich-deckbox.md`, gemergt `bcc579d`), Katalog Version 6.
**Status:** vom Nutzer Abschnitt für Abschnitt abgesegnet (2026-09-16).

---

## 1. Abgleich Spec E §6 ↔ Code (2026-09-16)

| Annahme | Stand im Code |
|---|---|
| YDK-Import „bestehend, unverändert" | **Nie funktionsfähig:** `import-deck-ydk` (`main.cjs`) liefert `{ canceled, name, cards: [{id,type,quantity}] }`, `DeckBuilder.jsx` prüft `result.deck` → Import-Zweig ist toter Code. |
| YDK-Export | Funktioniert (`#main/#extra/!side`, eine Zeile je Kopie, Speichern-Dialog). |
| Abschnitte | `deck_cards.section` ∈ `main/extra/side`. Extra-Erkennung beidseitig per Typ-Teilstring (Fusion/Synchro/XYZ/Link). |
| Side-Deck | Desktop zeigt Side an, hat aber keinen Weg, Karten hineinzulegen. Handy kennt nur Main/Extra; `buildYdk` schreibt `!side` leer. |
| Namensauflösung, „unbekannte per YGOPRODeck nachgeladen" | Kein Batch-Resolver. Katalogdatei (v6) trägt je Passcode `name_de`, `name_en`, `type`, `cm_price`; Desktop liest daraus bisher nur Preise. Handy `CatalogRepository.search` nur `LIKE '%…%'`. Einziges Levenshtein (`setCodeMatch.js`/`SetCodeMatch.kt`) ist OCR-gewichtet, nicht wiederverwendbar. |
| YDKE, Textliste | Nirgends vorhanden. |
| Zwischenablage/Teilen | Desktop: kein Deck-Bezug. Handy: Manifest nur Launcher, `MainActivity` wertet keine Intents aus, kein Import. Export nur YDK via `ACTION_SEND`. |
| `decks.notes` | Existiert nicht. |
| YGOPRODeck-URL | Kein Code; Seitenabruf wäre Neuland (HTML, Cloudflare). |
| Base64 | Renderer ohne `Buffer` → `atob`/`DataView`; Handy `minSdk 26` → `java.util.Base64` verfügbar. |

## 2. Umfang

**Drin (beide Geräte):** Formate YDK/YDKE/Textliste lesen und schreiben (Zwilling), Namensauflösung gegen den Offline-Katalog (Zwilling), Import mit Vorschau (Desktop: YDK-Datei und Einfügen; Handy: Einfügen und Share-Ziel), Export YDKE/Textliste (Desktop Zwischenablage, Handy Teilen), Side-Deck im Editor beider Geräte, `decks.notes`.

**Nicht drin:** YGOPRODeck-URL-Import (bewusst weggelassen; jede Deckseite bietet YDK-Download und YDKE; ggf. später nach Messversuch), Online-Nachschlagen unbekannter Passcodes, Import in ein bestehendes Deck, Datei-Anhänge per Teilen, Legalität/Simulation (E3), Master-Duel-Codes.

## 3. Formate (Zwilling `deckFormats.js` ↔ `DeckFormats.kt`)

Gemeinsame Fixture `docs/fixtures/decks/formats.json`. Neutrales Ergebnis: `{ cards: [{ passcode, count, section }], unresolved: [line], error? }` mit `section` ∈ `main | extra | side | unknown`.

**Passcodes** werden als Zahl ohne führende Nullen gespeichert (`"04031928"` → `"4031928"`).

**YDK lesen:** `#main`, `#extra`, `!side` schalten den Abschnitt (Groß/Klein egal); andere `#`-Zeilen sind Kommentare; jede Passcode-Zeile ist eine Kopie, gleiche Passcodes je Abschnitt werden summiert (Reihenfolge des ersten Auftretens); Zeilen ohne gültigen Passcode → `unresolved`; vor dem ersten Abschnittskopf gilt `main`.
**YDK schreiben:** wie bisher `#created by YGO Card Manager`, `#main`, `#extra`, `!side`, eine Zeile je Kopie.

**YDKE lesen:** `ydke://<main>!<extra>!<side>!` (letztes `!` optional, Leerzeichen/Zeilenumbrüche drumherum egal); jeder Block Base64 aus 32-Bit-Little-Endian-Passcodes; leerer Block = leerer Abschnitt; Bytelänge nicht durch 4 teilbar, ungültiges Base64 oder weniger als drei Blöcke → `error: "Kein gültiger YDKE-Link"`.
**YDKE schreiben:** `ydke://` + drei Base64-Blöcke je gefolgt von `!`.

**Textliste lesen:**
- Kartenzeilen: `3 Name`, `3x Name`, `3 x Name`, `Name x3`, `Name` (= 1). Anzahl 1–99.
- Überschriften (Groß/Klein egal, optional `:` oder `(n)` dahinter): `Main`, `Main Deck`, `Extra`, `Extra Deck`, `Side`, `Side Deck`.
- Leere Zeilen und Zeilen mit `#` oder `//` am Anfang werden ignoriert.
- Ohne jede Überschrift: `section = unknown` (Zuordnung bei der Namensauflösung, §4).
- Ergebnis-Karten tragen statt `passcode` den Rohnamen (`name`); Auflösung in §4.

**Textliste schreiben:**
```
Main Deck
3 Ash Blossom & Joyous Spring
Extra Deck
1 …
Side Deck
2 …
```
Namen aus den gespeicherten Deckkarten-Namen; leere Abschnitte entfallen.

**Erkennung beim Einfügen:** getrimmter Text beginnt mit `ydke://` → YDKE; enthält eine Zeile `#main` oder `!side` → YDK; sonst Textliste; ohne erkannte Karte → `error: "Keine Deckliste erkannt"`.

## 4. Namensauflösung (Zwilling `deckImport.js` ↔ `DeckImport.kt`)

Gemeinsame Fixture `docs/fixtures/decks/import.json`. Quelle ist der Offline-Katalog (`name_de`, `name_en`, `type` je Passcode): Desktop über die lokale Katalogdatei aus E1 (Leser erweitert von Preisen auf einen Katalog-Index), Handy über `CatalogDb` (Namen nur während des Imports im Speicher).

**Import per Passcode (YDK/YDKE):** Name = `name_de`, sonst `name_en`. Passcode nicht im Katalog → Zeile „Unbekannter Passcode 12345678", nicht übernommen, landet in den Notizen. Keine Online-Abfrage.

**Import per Name (Textliste)**, in dieser Reihenfolge gegen `name_de` und `name_en`:
1. **Exakt** (Groß/Klein ignoriert, getrimmt).
2. **Normalisiert:** Unicode-NFKD, Akzente/Umlaut-Punkte entfernt (ä→a, é→e), `ß`→`ss`, alles außer Buchstaben/Ziffern → Leerzeichen, Leerzeichen zusammengefasst, klein.
3. **Fuzzy:** Levenshtein ≤ 2 auf dem normalisierten Namen, nur bei normalisierter Länge ≥ 6 und Längendifferenz ≤ 2. Ergebnis ist ein **Vorschlag** („Meintest du …?"), höchstens 3 Kandidaten, geringster Abstand zuerst, dann alphabetisch; nichts wird ohne Klick übernommen.
4. **Nichts gefunden** → „Nicht gefunden", nicht übernommen, landet in den Notizen.

**Mehrdeutig:** Trifft Stufe 1 oder 2 mehrere Passcodes, zeigt die Vorschau eine Auswahl statt zu raten.

**Abschnitt ohne Überschrift:** Typ enthält `Fusion`, `Synchro`, `XYZ` oder `Link` (Groß/Klein egal) → `extra`, sonst `main`. Diese Regel ist ein eigener Zwillings-Helfer (`deckSectionFor(type)`), den auch die Editoren beim Hinzufügen nutzen.

## 5. Import-Ablauf, Vorschau, Notizen

- **Import legt immer ein neues Deck an.**
- **Desktop:** Menü „Neues Deck" mit *Leer* · *YDK-Datei* · *Einfügen (YDKE/Text)* (Textfeld). Der YDK-Datei-Weg nutzt den gemeinsamen Parser; der alte Fehler (`result.deck`) entfällt.
- **Handy:** Plus-Menü mit *Leer* · *Einfügen (YDKE/Text)* (Zwischenablage vorbefüllt) sowie Share-Ziel (§6).
- **Vorschau** (Desktop Dialog, Handy Vollbild): Deckname (vorbelegt aus Dateiname, sonst „Importiertes Deck"); Zähler „Main 40 · Extra 15 · Side 15" und ggf. „3 nicht übernommen"; Liste je Abschnitt mit Anzahl und Name; Vorschläge und Mehrdeutige mit Auswahl, bis zur Entscheidung als offen markiert und nicht übernommen; Block „Nicht übernommen" mit den Rohzeilen.
- **Anlegen:** Deck und alle Deckkarten (Name und Bild aus dem Katalog) in einem Zug; bei Erfolg öffnet der Editor das neue Deck. Scheitert das Einfügen der Karten, wird das leere Deck wieder gelöscht; Meldung „Import fehlgeschlagen: …".
- **Notizen:** neue Spalte `decks.notes text` (SQL-Datei `supabase/decks_notes.sql`). Nicht übernommene Zeilen (inkl. offener Vorschläge) als „Nicht übernommen beim Import:" plus je eine Zeile. Desktop-Editor: bearbeitbares Feld unter dem Kopf, gespeichert mit „Save Deck". Handy-Editor: nur Anzeige, wenn vorhanden.

## 6. Export, Teilen, Side-Deck

- **Desktop-Export-Menü:** *YDK-Datei* (wie bisher), *YDKE kopieren*, *Textliste kopieren* (Zwischenablage; Bestätigung „YDKE-Link kopiert" bzw. „Textliste kopiert").
- **Handy-Teilen-Menü:** *YDKE*, *Textliste*, *YDK* über den Android-Teilen-Dialog als Text; YDK enthält jetzt das Side-Deck.
- **Share-Empfang Handy:** Intent-Filter `ACTION_SEND` + `text/plain` auf `MainActivity`; Text aus `EXTRA_TEXT` bei Start und in `onNewIntent` → Import-Vorschau. Nur Text, keine Dateien. Nicht erkannt → „Keine Deckliste erkannt". Ist der Nutzer nicht angemeldet, bleibt der Text erhalten und die Vorschau erscheint nach dem Login.
- **Side-Deck Desktop:** beim Hinzufügen aus der Suche Umschalter „Ziel: Deck | Side" („Deck" = Main/Extra per `deckSectionFor`); pro Zeile Aktion „→ Side" bzw. „→ Deck" (verschiebt eine Kopie; „→ Deck" per `deckSectionFor`).
- **Side-Deck Handy:** dritter Abschnitt „Side" im Editor; gleicher Umschalter im Hinzufügen-Dialog; gleiche Zeilenaktion.

## 7. Fehlerfälle

- Ungültiger YDKE → „Kein gültiger YDKE-Link", nichts angelegt.
- Leerer oder unerkannter Text → „Keine Deckliste erkannt".
- Kein Katalog (Handy direkt nach Katalog-Upgrade, Desktop vor dem ersten Katalog-Bau): Vorschau zeigt „Katalog fehlt – Namen können nicht aufgelöst werden"; Passcode-Importe als „Unbekannter Passcode …", Textlisten als „Nicht gefunden"; Anlegen mit den gefundenen Karten bleibt möglich.
- Anlegen scheitert halb → leeres Deck gelöscht, „Import fehlgeschlagen: …".
- Überlange Liste (mehr als 60/15/15) → wird übernommen; Legalität erst E3.
- Share bei fehlender Anmeldung → Text bleibt erhalten, Vorschau nach dem Login.

## 8. Einspiel-Reihenfolge

1. Nutzer spielt `supabase/decks_notes.sql` ein (`alter table public.decks add column if not exists notes text;`).
2. Installer.
3. APK.
Kein Katalog-Wechsel (v6 trägt Namen und Typ).

## 9. Tests

- **Formate:** YDK, YDKE, Textliste lesen und schreiben, Roundtrip, alle Zeilenformen und Überschriften, führende Nullen, ungültiges Base64/Bytelänge, unerkannter Text, Erkennung. JS + Kotlin mit `formats.json`.
- **Namensauflösung:** exakt, normalisiert (Umlaute, `ß`, Satzzeichen), Fuzzy-Vorschlag (Grenzen: Abstand 2/3, Länge 5/6, Längendifferenz), Mehrdeutigkeit, nicht gefunden, unbekannter Passcode, `deckSectionFor`, Katalog fehlt. JS + Kotlin mit `import.json`.
- **Desktop:** YDK-Import über den gemeinsamen Parser (Antwortform getestet); Anlegen mit Rückbau bei Fehler (Client-Attrappe); neue IPC-Kanäle in `main.cjs` **und** `preload.cjs`; Katalog-Index-Leser.
- **Handy:** Share-Intent-Auswertung und Vorschau-Zustand ohne Gerät; Repository-Anlegen mit Rückbau; `buildYdk` mit Side.
- Jeder Schutz-Test scheitert nachweislich ohne den Schutz.

## 10. Abnahme

1. Desktop: YDK-Datei importieren → Vorschau stimmt, Deck mit Main/Extra/Side angelegt.
2. Desktop: YDKE von YGOPRODeck kopieren und einfügen → wie 1.
3. Textliste mit Tippfehler einfügen → „Meintest du …?"; nicht aufgelöste Zeile landet in den Notizen.
4. Deck am Desktop als YDKE exportieren → am Handy per Einfügen importieren → identisches Deck.
5. Am Handy YDKE oder Textliste aus einer anderen App an die Karten-App teilen → Vorschau öffnet.
6. Side-Deck auf beiden Geräten eine Karte verschieben → YDK-Export enthält `!side` gefüllt.

Spec E §3 (Nicht-Ziele), §4 und die E3-Teile von §5–§12 gelten fort, vorbehaltlich des E3-Nachtrags und der Korrekturen in §1 dieses Dokuments.
