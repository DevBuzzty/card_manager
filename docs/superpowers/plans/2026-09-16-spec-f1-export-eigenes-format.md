# Spec F1 Export & eigenes Format — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Desktop liest und schreibt das eigene, verlustfreie Card-Dex-CSV (Import mit Vorschau, Ampel, Regel für Bestehendes, Transaktion, Protokoll) und exportiert zusätzlich Dragon Shield CSV, YGOPRODeck CSV, Cardmarket-Wantslist und Verkaufsliste — aus Einstellungen › Daten und aus der Sammlung (Umfang „Aktueller Filter").

**Architecture:** Alle Regeln wohnen in reinen, getesteten CommonJS-Helfern im Hauptprozess: `csv.cjs` (RFC 4180, Trennzeichen-Erkennung, BOM), `carddex-format.cjs` (Gruppen, Schreiben, Lesen), `export-formats.cjs` (vier Formatierer), `carddex-resolve.cjs` (Ampel, Behälter-Plan, Hinzufügen/Ersetzen/Überspringen, Texte). `carddex-import.cjs` lädt den Datenbank-Stand, hält die Vorschau-Sitzung (verbraucht beim Übernehmen = Busy-Schutz), schreibt in EINER Transaktion und legt das Protokoll ab; `collection-export.cjs` lädt den Umfang und baut die Datei. `main.cjs` zeigt nur Dialoge und schreibt Dateien (5 neue Kanäle). Der Sync schiebt `cards` künftig wie Exemplare und Behälter in Blöcken zu 500. Im Renderer kommen zwei Dialoge und zwei kleine Helfer (`exportScope.js`, `importPreview.js`) dazu. Kein SQL, kein Handy.

**Tech Stack:** Electron CJS + better-sqlite3, React/Vite + react-window 2 + lucide-react, node:test.

**Spec:** `docs/superpowers/specs/2026-09-16-spec-f-nachtrag-f1-export-eigenes-format.md` (verbindlich, vom Nutzer Abschnitt für Abschnitt abgesegnet). Hintergrund: `docs/superpowers/specs/2026-09-05-spec-f-import-export-design.md` (der Nachtrag hat Vorrang). Plan-Basis `102d3c6`.

## Global Constraints

- `android/local.properties` niemals lesen, ausgeben, ändern, kopieren oder committen.
- Agents führen niemals SQL aus, verbinden sich nie mit Supabase und rufen keine Edge Functions auf.
- Immer explizite Pfade stagen, nie `git add -A` und nie `git stash`.
- Kein nacktes `npm install` in `desktop/` (better-sqlite3-ABI).
- `cards.quantity`, `cards.deleted` und `cards.price_first_ed` schreibt die App nie; es gibt nur Soft-Delete.
- Jeder IPC-Kanal steht in `desktop/electron/main.cjs` UND in `desktop/electron/preload.cjs`.
- Sichtbare Texte sind deutsch mit echten Umlauten, „Fächer" statt „Taschen".
- Regeln wohnen in reinen, getesteten Helfern.
- Desktop-Lint-Baseline: genau 5 Fehler (`npx eslint .` in `desktop/`). Ein sechster ist ein Fehlschlag.
- Deutsche Set-Codes werden nie aus englischen abgeleitet.
- Ein Test, der gegen einen Fehler schützt, muss nachweislich ohne den Schutz scheitern: Schutz kurz sabotieren, Fehlschlag im Bericht zitieren, Sabotage zurücknehmen.
- Commit-Trailer wörtlich: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Neue Commits, nie `--amend`.
- Ein Schutz, der in eine geteilte Funktion wandert, darf das Verhalten der anderen Aufrufer nicht ändern — alle Aufrufer prüfen (Lehre aus E1 F3).
- Ein Platzhalter darf nie wie eine leere Sammlung aussehen: solange gezählt wird, steht „…", nie „Nichts zu exportieren".
- F1-spezifisch nicht drin (Nachtrag §1): Fremd-Import (Dragon Shield, YGOPRODeck, Generisch, Kartensuche für rote Zeilen), Entfernen des alten Staging-Knopfs `import-csv`, Wunschliste im lokalen Backup, Export/Import am Handy. Keine Zwillinge (Handy nicht beteiligt).

**Befehle (in `desktop/`):**
- SQLite-Suite: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs`
- Sync-Skript: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs`
- Helfer: `node --test src/utils/*.test.js src/utils/*.test.mjs`
- Lint: `npx eslint .` → genau `5 errors` (3 warnings). Gelintet werden nur `*.js`/`*.jsx`.
- Build: `npx vite build`
- Android ist nicht beteiligt.

Ausgangszahlen auf `102d3c6` (gemessen): SQLite-Suite 261, `test-sync.cjs` 16× PASS (exit 0), Helfer 242, Lint 5 Fehler/3 Warnungen, `vite build` ok.

## Dateiübersicht

| Datei | Aufgabe | Task |
|---|---|---|
| `desktop/electron/csv.cjs` + `csv.test.cjs` (neu) | `parseCsv`, `toCsv`, `detectDelimiter`, `BOM` | 1 |
| `desktop/electron/copies.cjs` | exportiert zusätzlich `normalizeTagList`, `CONTAINER_KINDS`, `BINDER_POCKETS` | 2 |
| `desktop/electron/carddex-format.cjs` + `.test.cjs` (neu) | Spalten, `carddexGroups`, `writeCarddex`, `readCarddex`, `tagsOfCell` | 2 |
| `docs/fixtures/import-export/export-input.json`, `export-carddex.csv`, `carddex-semikolon.csv`, `carddex-neuer.csv` (neu) | Eingabe der Formatierer, Card-Dex-Soll, Leser-Fälle | 2 |
| `desktop/electron/export-formats.cjs` + `.test.cjs` (neu) | Dragon Shield, YGOPRODeck, Wantslist, Verkaufsliste | 3 |
| `docs/fixtures/import-export/export-dragonshield.csv`, `export-ygoprodeck.csv`, `export-wantslist.txt`, `export-verkaufsliste.txt` (neu) | Soll-Ausgaben | 3 |
| `desktop/electron/carddex-resolve.cjs` + `.test.cjs` (neu) | Ampel, Behälter, Seite/Fach, Regeln, Texte | 4 |
| `desktop/electron/carddex-import.cjs`, `collection-export.cjs`, `carddex-import.test.cjs` (neu) | DB-Stand, Sitzungen, Transaktion, Protokoll, `importRun`; Export-Umfang, `buildExport` | 5 |
| `desktop/electron/sync.cjs`, `sync-push-chunks.test.cjs` (neu) | `cards`-Push in Blöcken zu 500 | 6 |
| `desktop/electron/main.cjs`, `preload.cjs`, `ipc-channels.test.cjs` | Kanäle `import-open`, `import-resolve`, `import-run`, `export-count`, `export-run` | 7 |
| `desktop/src/utils/exportScope.js`, `importPreview.js` + Tests (neu) | Formatliste, Umfang, „Aktueller Filter", Vorschau-Filter, Übernehmen-Regel | 8 |
| `desktop/src/components/ImportDialog.jsx`, `ExportDialog.jsx` (neu), `Settings.jsx`, `CollectionList.jsx` | Oberfläche | 9 |

Jede Datei wird in genau einem Task geändert. Reihenfolge strikt 1 → 9 im selben Worktree; jeder Task testet für sich grün. Abhängigkeiten: 2 braucht 1; 3 braucht 1 und die Fixture `export-input.json` aus 2; 4 braucht 2 (`normalizeTagList`, `CONTAINER_KINDS`, `BINDER_POCKETS`); 5 braucht 2, 3, 4; 7 braucht 5; 8 ist unabhängig; 9 braucht 7 und 8. Task 6 ist unabhängig.

**Vorab geprüft (Plan-Autor, Scratch-Kopie von `102d3c6` außerhalb des Repos per `git archive`, `desktop/node_modules` als Junction):** Aller Code dieses Plans stand dort genau so; neue Dateien sind aus dieser Kopie eingefügt, die Änderungsblöcke wurden nach dem Schreiben des Plans maschinell auf eine frische Kopie von `102d3c6` angewendet und mit dem Endstand verglichen (jeder alte Block steht an seiner Stelle genau einmal). Ergebnisse am Endstand: SQLite-Suite 305/305, `test-sync.cjs` 16× PASS (exit 0), Helfer 249/249, `npx eslint .` 5 Fehler/3 Warnungen, `vite build` ok. Alle Schutz-Nachweise unten sind gemessen (Sabotage angewendet, Fehlschlag zitiert, zurückgenommen). Die Oberfläche (Task 9) ist nur kompiliert und gelintet, nicht im Fenster geklickt.

## Befunde aus dem Code-Abgleich

1. **Sync-Push paginiert `cards` nicht.** `push()` in `sync.cjs` schickt alle geänderten `cards`-Zeilen in EINEM Upsert und verlangt alle Zeilen zurück (`.select(...)` für die Echo-Sperre); `pushCopies`, `pushContainers`, `pushSealed` und `pushPriceHistory` schieben schon in Blöcken zu 500. Nach einem Import mit tausenden neuen Printings wäre das eine sehr große Anfrage, und die zurückgegebene Liste liegt über der PostgREST-Grenze von 1000 Zeilen. Anpassung im bestehenden Push-Weg (Task 6): `upsertCardsInChunks` mit 500er-Blöcken, Cursor erst nach dem letzten Block (wie bisher). Die Pull-Seiten paginieren bereits (`range` je 1000, Cursor erst nach dem Leerlaufen); das Handy lädt über `KeysetPager`. Reihenfolge im Zyklus bleibt Cards → Containers → Copies. Die „laufende Sekunde" wird wie bisher im nächsten Zyklus geschoben.
2. **`collection-changed` existiert:** gesendet von `sync.cjs#cycle` nach gezogenen Änderungen, Brücke `onCollectionChanged` in `preload.cjs`, gehört von `CollectionList`, `DeckBuilder`, `Portfolio`, `useMovers`. Der Import sendet dasselbe Ereignis (kein neuer Kanal) und schreibt zusätzlich den Tageswert (`recordPortfolioValueSafe`, wie Sealed M1).
3. **Speicherung am Exemplar (`card_copies`):** `tags` = Text mit JSON-Array (leer → `NULL`, normalisiert über `copies.cjs#normalizeTagList`; kaputte Zelle = keine Tags), `note` = Text, `page`/`slot` = INTEGER, `container_id` ohne Fremdschlüssel. Behälter (`containers`): `kind` ∈ `binder`/`box`/`deckbox`, `pockets_per_page` nur beim Binder und nur 4/9/12 (`saveContainer` wirft sonst), Seite/Fach nur beim Binder (`setCopyLocation`). Mehrere Exemplare dürfen im selben Fach liegen (B2, Mengen-Abzeichen). Die Spaltenzuordnung von Nachtrag §2 ist darauf abgebildet.
4. **`cards`-Schema:** `quantity INTEGER DEFAULT 1`, `deleted INTEGER DEFAULT 0`. Ein neues Printing wird OHNE diese Spalten eingefügt; der Recount-Trigger (`copies-schema.cjs`) setzt beide beim ersten Exemplar in derselben Transaktion. Ein vorhandener Grabstein (`deleted = 1`) bleibt per `INSERT OR IGNORE` stehen und wird vom Trigger wiederbelebt.
5. **Katalog:** `readCatalogCards` liefert `{ id, name_de, name_en, type, image }` je Haupt-Passcode, `catalogMainId` die Artwork-Zuordnung; ohne Datei `null`. Der Katalog kennt keine deutschen Set-Codes je Karte für die Prüfung — Set-Codes aus der Datei werden unverändert übernommen, nie abgeleitet.
6. **Wertanzeige:** `valuation.cjs#unitPrice` (1.-Auflage-Preis bei `edition = 'first'`, G4) × `conditionFactor`; dieselbe Formel nutzt die Verkaufsliste (`pieceValue`).
7. **Wunschliste liegt nur in Supabase** (`public.wishlist`: `card_id`, `name`, `image_url`, `max_price`; eindeutig je `card_id`, keine Menge, kein Printing). Die Wantslist braucht deshalb die Cloud-Verbindung.
8. **Doppelklick-Schutz:** better-sqlite3 arbeitet synchron; zwei `import-run`-Aufrufe laufen nacheinander, nie gleichzeitig. Ein reines „läuft gerade"-Flag würde den zweiten Aufruf also nicht aufhalten — er käme nach dem ersten und importierte alles noch einmal. Der Schutz ist deshalb die Vorschau-Sitzung, die `importRun` als Erstes verbraucht (`take`); zusätzlich sperrt der Dialog den Knopf.
9. **Kein Sammlungs-Menü:** `CollectionList` hat nur „Filter" und das Aufklapp-Menü „Preise". „Exportieren…" kommt als eigener Knopf daneben.
10. Außerhalb von F1 gesehen, nicht angefasst: `add-card-to-db` setzt `cards.deleted = 0` direkt; `recentlyPushed` in `sync.cjs` hat einen Schlüssel ohne `rarity`; „Duplikate zusammenführen" in Einstellungen ruft `cleanupDatabase` (VACUUM) und liest `res.merged`.

## Offene Punkte / Abweichungen (bitte dem Nutzer vorlegen)

1. **Wantslist (Nachtrag §4 nicht voll erfüllbar):** Die Wunschliste hat weder Menge noch Set-Code. Plan: eine Zeile je Eintrag `1 <englischer Name>` (Name aus dem Katalog über die Artwork-Zuordnung, sonst der gespeicherte Name), alphabetisch, ohne Klammer-Set-Code. Das Beispiel `2 Dark Magician (LOB-EN005)` entsteht erst, wenn die Wunschliste Menge/Printing bekommt (Folgeaufgabe). Empfehlung: so übernehmen.
2. **Dragon-Shield-Kopfzeile ist geraten:** Die Import-Vorlage liegt nicht im Repo. Plan: `Quantity,Card Name,Set Code,Rarity,Language,Printing,Condition,Price`, ohne `sep=`-Zeile; Name englisch (Katalog, sonst lokal); Sprache ausgeschrieben (`German`, `English`, … wie Spec F §6.2); Printing `1st Edition`/`Unlimited`/`Limited`/leer; Preis = Stückwert (wie Verkaufsliste) mit Punkt und 2 Stellen. Empfehlung: Abnahme 5 um einen echten Dragon-Shield-Import ergänzen; die Kopfzeile steht an einer Stelle (`dragonShieldCsv`).
3. **YGOPRODeck-Kopfzeile:** `cardname,cardq,cardrarity,cardcode,cardid` (Namen aus Spec F §6.3, Reihenfolge nach Nachtrag §4), englischer Name. Unknown-Printings: Set-Code leer, Seltenheit bleibt `Unknown` (auch bei Dragon Shield).
4. **Verkaufsliste, Einzelheiten:** Preis je Zeile = Stückwert (`unitPrice × Zustandsfaktor`, auf Cent), Summe = Σ Anzahl × Stückwert, Schlusszeile `Summe: 7 Karten · 70,43 €`; Edition `1. Auflage`/`Unlimitiert`/`Limitiert`, `unknown` ohne Abschnitt; Preis 0 → `ohne Preis`; Name lokal (deutsch). Textdateien UTF-8 ohne BOM, Zeilenende LF; CSV mit BOM und CRLF. Ergebnis: `6 Exemplare exportiert · 1 Exemplar ohne Set-Code weggelassen`.
5. **„Fach belegt":** Belegt ist ein Fach eines VORHANDENEN Behälters, in dem ein lebendes Exemplar liegt (gleich welches Printing), das nicht durch *Ersetzen* weggeht. Zeilen derselben Datei belegen sich nicht gegenseitig (B2 erlaubt mehrere Exemplare je Fach), neue Behälter sind immer frei. Folge: Wer die eigene Datei mit *Hinzufügen* in dieselbe Sammlung liest, bekommt die Zusatz-Exemplare ohne Seite/Fach (gelb). Seite/Fach ungültig (keine ganze Zahl ≥ 1, nur eines von beiden, Fach > Fächerzahl) → ebenfalls „ohne Seite/Fach" (gelb, eigener Grund).
6. **Behälter über den Namen:** exakter Vergleich (Groß-/Kleinschreibung zählt); bei mehreren lebenden gleichnamigen der erste nach `sort_order, name, container_id`. Für einen VORHANDENEN Behälter gelten dessen Art und Fächerzahl, die Angaben der Datei werden nicht verglichen (gelb nur, wenn dadurch Seite/Fach wegfällt). Neuer Behälter: ungültige/leere Art → `box` (gelb „Behälter-Art ungültig – Box"), Binder mit ungültiger Fächerzahl (nicht 4/9/12) → 9 (gelb „Fächerzahl ungültig – 9"), ohne Angabe 9 ohne Hinweis. Die Abweichungs-Regel („erste Zeile gilt") vergleicht Art und — nur bei Binder — Fächerzahl als Text.
7. **Gelb je Zeile wie in Nachtrag §3 wörtlich:** „Behälter „X“ wird angelegt" und „Printing wird angelegt" stehen an JEDER betroffenen Zeile. Ein Rundlauf in eine leere Datenbank zeigt daher „0 bereit" (alles gelb). Empfehlung: so lassen (ehrlich), alternativ nur die erste Zeile je Behälter markieren.
8. ***Überspringen*:** betroffene Zeilen werden gelb („Printing vorhanden – übersprungen") und planen keinen Behälter; das Ergebnis bekommt „· N übersprungen" (nur wenn N > 0). *Hinzufügen* ist Standard; unbekannte Regel = *Hinzufügen*.
9. **Normalisierungen beim Lesen (nicht in der Spec):** leerer `set_code`/`rarity` → `Unknown`, leere Sprache → `DE`, Sprache und Zustand in Großbuchstaben, Edition exakt (`first` …), führende Nullen im Passcode zählen nicht (lokal gewinnt die gespeicherte Schreibweise), Menge ganzzahlig 1–1000 (größer = „Menge ungültig", rot), Tags getrimmt ohne Dubletten (`|` getrennt), leere Notiz → `NULL`. Datei nur mit Kopfzeile oder ohne `passcode`/`count`-Spalte → „Datei nicht lesbar". Nicht lesbare Versionsnummer zählt als 1. Tags, die selbst `|` enthalten, werden beim Wiedereinlesen geteilt (das Format kennt kein Escape) — Empfehlung: hinnehmen.
10. **Kodierung:** Gelesen wird UTF-8 (mit/ohne BOM). Eine in Excel als „CSV (Trennzeichen-getrennt)" gespeicherte Datei ist Windows-1252 — Umlaute kämen kaputt an. Empfehlung: in der Abnahme „CSV UTF-8" speichern; Erkennung als Folgeaufgabe.
11. **Busy-Schutz = verbrauchte Sitzung** (Befund 8). Folge: Scheitert der Import (Rollback), muss die Datei neu geöffnet werden; die Meldung „Import fehlgeschlagen: Zeile N: …" bleibt im Dialog stehen. Nicht ausgelassene rote Zeilen (nur möglich, wenn der Renderer umgangen wird) → „Import fehlgeschlagen: Zeile N: unbekannte Zeile zuerst auslassen".
12. **Fehlertext:** Unerwartete Datenbankfehler erscheinen wie im restlichen Projekt generisch („Import fehlgeschlagen: Zeile 4: Unerwarteter Datenbankfehler."), der Rohtext geht in die Konsole. `copies.ValidationError` (z. B. aus `saveContainer`) wird wörtlich gezeigt.
13. **Protokoll-Dateiname mit Uhrzeit:** `userData/imports/2026-09-16T14-03-22-carddex.json` (UTC) statt nur Datum — sonst überschriebe der zweite Import eines Tages den ersten. Geschrieben nur nach Erfolg; Inhalt: Datei, Zeitpunkt, Regel, Ergebnis, je Zeile `line`, `status`, `action` (`import`/`omitted`/`skip-existing`), Gründe, Printing, Menge, Behälter. Ein Schreibfehler des Protokolls macht den Import nicht rückgängig (Konsole).
14. **Neue Printings:** Name/Typ/Bild aus einer vorhandenen lokalen `cards`-Zeile desselben Passcodes, sonst Katalog (`name_de` vor `name_en`, Hauptkarte bei Artwork-Passcodes); `price` bleibt `NULL` (der YGOPRODeck-Poller nimmt `last_updated IS NULL` zuerst), `desc`/ATK/DEF leer bis „Fehlende Daten holen".
15. **„Aktueller Filter":** Exemplar-genau über die Printing-Filter (Sprache, Seltenheit, Set-Kürzel) und Exemplar-Filter (Zustand, Edition, Behälter, Tags); Textsuche, Typ, Attribut, Rasse und Segment wirken wie in der Liste auf ganze Gruppen. Die IDs werden beim Öffnen des Dialogs festgehalten. Umfang „Ein Behälter" nur, wenn es Behälter gibt; „Aktueller Filter" nur aus der Sammlung.
16. **Card-Dex-Export:** Ein Exemplar, dessen `container_id` auf einen gelöschten/unbekannten Behälter zeigt, wird ohne Behälter geschrieben. Zwei lebende Behälter gleichen Namens ergeben getrennte Zeilen, beim Import landen sie im ersten.
17. **Abnahme 3 (Test-Datenbank) ist mit den vorhandenen Knöpfen riskant:** „Speicherort verschieben“ KOPIERT die aktuelle Sammlung in den gewählten Ordner und stellt `userData/config.json` darauf um — es entsteht keine leere Datenbank. „Zurückwechseln“ über denselben Knopf kopiert die TEST-Datenbank über die Datei im Zielordner (bei Wahl des alten Ordners also über das Original). „Alles zurücksetzen“ löscht immer `userData/cards.db`, nicht die verschobene Datei. Die Kopie synchronisiert außerdem mit derselben Cloud (erster Zyklus 3 s nach dem Start), Test-Änderungen landen so auch in der echten Sammlung. Der Rundlauf in eine leere Datenbank ist in Task 5 automatisiert. Empfehlung für die Abnahme: vorher „Datenbank sichern“ und „Sync aktivieren“ AUS (wird mitkopiert); verschieben; in der Kopie den Export mit *Ersetzen* importieren und Anzahl/Standorte vergleichen; zum Zurückwechseln die App schließen und `userData/config.json` von Hand löschen (Nutzer), dann Sync wieder einschalten. Eine echte leere Test-Datenbank bräuchte einen eigenen Menüpunkt (Folgeaufgabe).

---
### Task 1: CSV lesen und schreiben (`csv.cjs`)

**Files:**
- Create: `desktop/electron/csv.cjs`
- Create: `desktop/electron/csv.test.cjs`

**Interfaces:**
- Produces (für Task 2, 3): `BOM = '﻿'`; `detectDelimiter(text) → ',' | ';' | '\t'`; `parseCsv(text) → { delimiter, rows: [{ line: number, cells: string[] }] }` (BOM entfernt, Leerzeilen ausgelassen, `line` = Dateizeile des Zeilenanfangs); `toCsv(rows: any[][], { delimiter = ',', bom = true } = {}) → string` (CRLF, abschließendes CRLF).

- [ ] **Step 1: Test schreiben** — `desktop/electron/csv.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { BOM, detectDelimiter, parseCsv, toCsv } = require('./csv.cjs');

const cells = (text) => parseCsv(text).rows.map((r) => r.cells);

test('Trennzeichen: Komma, Semikolon, Tab aus der Kopfzeile; Gleichstand Komma; Zeichen in Anführungszeichen zählen nicht', () => {
  assert.equal(detectDelimiter('a,b,c\n1;2;3;4;5'), ',');
  assert.equal(detectDelimiter('a;b;c\n1,2,3,4,5'), ';');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('"a;b;c",d'), ',');
  assert.equal(detectDelimiter('abc'), ',');
});

test('BOM wird entfernt, Leerzeilen übersprungen, Zeilennummer der Datei bleibt', () => {
  const { delimiter, rows } = parseCsv(`${BOM}a;b\r\n\r\n1;2\r\n;\r\n3;4`);
  assert.equal(delimiter, ';');
  assert.deepEqual(rows, [
    { line: 1, cells: ['a', 'b'] },
    { line: 3, cells: ['1', '2'] },
    { line: 5, cells: ['3', '4'] },
  ]);
});

test('Anführungszeichen: Trennzeichen, doppelte Anführungszeichen und Zeilenumbruch im Feld', () => {
  const { rows } = parseCsv('a,b\n"x, y","sagt ""hallo"""\n"zwei\nZeilen",z\nw,v');
  assert.deepEqual(rows.map((r) => r.cells), [['a', 'b'], ['x, y', 'sagt "hallo"'], ['zwei\nZeilen', 'z'], ['w', 'v']]);
  assert.deepEqual(rows.map((r) => r.line), [1, 2, 3, 5]);
});

test('leere Zellen und fehlender Zeilenumbruch am Ende', () => {
  assert.deepEqual(cells('a,b,c\n1,,3'), [['a', 'b', 'c'], ['1', '', '3']]);
  assert.deepEqual(cells(''), []);
  assert.deepEqual(cells(BOM), []);
});

test('toCsv: BOM, CRLF, nur nötige Felder in Anführungszeichen, Umlaute unverändert', () => {
  const out = toCsv([['name', 'note'], ['Dunkler Magier', 'Fächer 3, oben'], ['Ä"Ö', 'a\nb'], [7, null]]);
  assert.equal(out, `${BOM}name,note\r\nDunkler Magier,"Fächer 3, oben"\r\n"Ä""Ö","a\nb"\r\n7,\r\n`);
  assert.equal(toCsv([['a;b', 'c']], { delimiter: ';', bom: false }), '"a;b";c\r\n');
});

test('Rundlauf toCsv -> parseCsv', () => {
  const data = [['a', 'b', 'c'], ['x, "y"', 'zwei\r\nZeilen', ''], ['Ü', '|', 'ß']];
  assert.deepEqual(cells(toCsv(data)), data);
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run (in `desktop/`): `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/csv.test.cjs` → FAIL mit `Cannot find module './csv.cjs'`.

- [ ] **Step 3: `desktop/electron/csv.cjs` anlegen**

```js
// Spec F1 §2 -- CSV lesen und schreiben (RFC 4180), ohne Paket. Der Leser erkennt Komma, Semikolon und Tab an der
// Kopfzeile (Excel DE schreibt Semikolon), entfernt ein BOM und ueberspringt Leerzeilen. Jede Zeile traegt die
// Dateizeile, in der sie beginnt (ein Feld in Anfuehrungszeichen darf Zeilenumbrueche enthalten).
const BOM = '﻿';
const DELIMITERS = [',', ';', '\t'];

// Trennzeichen der ersten logischen Zeile (ausserhalb von Anfuehrungszeichen); Gleichstand -> Komma.
function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of String(text)) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && Object.hasOwn(counts, ch)) counts[ch] += 1;
  }
  let best = ',';
  for (const d of DELIMITERS) if (counts[d] > counts[best]) best = d;
  return best;
}

// -> { delimiter, rows: [{ line, cells: string[] }] }; Zeilen, deren Zellen alle leer sind, fehlen.
function parseCsv(input) {
  let text = String(input ?? '');
  if (text.startsWith(BOM)) text = text.slice(1);
  const delimiter = detectDelimiter(text);
  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || cells.length > 0) endRow();
  return { delimiter, rows };
}

function csvCell(value, delimiter) {
  const s = value == null ? '' : String(value);
  return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

// rows: Array von Zellen-Arrays (Kopfzeile zuerst). UTF-8 mit BOM, CRLF (Excel), Komma.
function toCsv(rows, { delimiter = ',', bom = true } = {}) {
  const body = rows.map((r) => r.map((c) => csvCell(c, delimiter)).join(delimiter)).join('\r\n');
  return `${bom ? BOM : ''}${body}\r\n`;
}

module.exports = { BOM, detectDelimiter, parseCsv, toCsv };
```

- [ ] **Step 4: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/csv.test.cjs` → `ℹ tests 6`, `ℹ pass 6`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 267`, `ℹ fail 0`.

- [ ] **Step 5: Schutz-Nachweis**

In `parseCsv` den Block
```js
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
```
kurz zu
```js
      if (ch === '"') {
        quoted = false;
```
ändern → `✖ Anführungszeichen: Trennzeichen, doppelte Anführungszeichen und Zeilenumbruch im Feld` und `✖ Rundlauf toCsv -> parseCsv` (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/csv.cjs desktop/electron/csv.test.cjs
git commit -m "feat(f1): CSV lesen und schreiben (RFC 4180, Trennzeichen-Erkennung, BOM)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 2: Card-Dex-Format (Gruppen, Schreiben, Lesen) mit Fixtures

**Files:**
- Modify: `desktop/electron/copies.cjs` (nur `module.exports`)
- Create: `desktop/electron/carddex-format.cjs`
- Create: `desktop/electron/carddex-format.test.cjs`
- Create: `docs/fixtures/import-export/export-input.json`
- Create: `docs/fixtures/import-export/export-carddex.csv`
- Create: `docs/fixtures/import-export/carddex-semikolon.csv`
- Create: `docs/fixtures/import-export/carddex-neuer.csv`

**Interfaces:**
- Consumes (Task 1): `parseCsv`, `toCsv`, `BOM`.
- Produces (für Task 4, 5): aus `copies.cjs` zusätzlich `normalizeTagList(list) → string[]`, `CONTAINER_KINDS = ['binder','box','deckbox']`, `BINDER_POCKETS = [4, 9, 12]` (reine Sichtbarkeit, kein Verhalten; übrige Aufrufer unverändert).
- Produces (für Task 5): `CARDDEX_VERSION = 1`, `CARDDEX_COLUMNS` (16 Spalten wie Nachtrag §2), `READ_ERRORS`, `tagsOfCell(text) → string[]`, `carddexGroups(copies) → [{ passcode, name, set_code, rarity, language, edition, condition, container_id, container, container_kind, pockets_per_page, page, slot, tags: string[], note, count }]` (sortiert), `writeCarddex(groups) → string`, `readCarddex(text) → { ok: true, rows: [{ line, passcode, name, set_code, rarity, language, count, edition, condition, container, container_kind, pockets_per_page, page, slot, tags: string[], note }] } | { ok: false, error: 'unreadable'|'not-carddex'|'newer-version', text }` (Werte außer `tags` als getrimmter Text).
- Produces (Fixture, für Task 3): `export-input.json` mit `copies` (Zeilen wie `loadExportCopies`), `namesEn`, `wishlist`.

- [ ] **Step 1: Fixtures anlegen** (UTF-8 ohne BOM, LF; die Tests normalisieren Zeilenenden)

`docs/fixtures/import-export/export-input.json`:
```json
{
  "_comment": "Spec F1 §4/§6 -- Eingabe der Export-Formatierer: Zeilen wie collection-export.cjs#loadExportCopies, englische Katalognamen, Wunschliste. Erwartete Ausgaben: export-*.csv/.txt (ohne BOM, LF; der Test normalisiert).",
  "copies": [
    { "copy_id": "k1", "card_id": "46986414", "name": "Dunkler Magier", "set_code": "LOB-DE005", "rarity": "Ultra Rare", "language": "DE", "edition": "first", "condition": "NM", "price": 12.5, "price_first_ed": 20, "container_id": "c1", "container_name": "Binder Blau", "container_kind": "binder", "pockets_per_page": 9, "page": 1, "slot": 1, "tags": "[\"Deck\",\"Tausch\"]", "note": null },
    { "copy_id": "k2", "card_id": "46986414", "name": "Dunkler Magier", "set_code": "LOB-DE005", "rarity": "Ultra Rare", "language": "DE", "edition": "first", "condition": "NM", "price": 12.5, "price_first_ed": 20, "container_id": "c1", "container_name": "Binder Blau", "container_kind": "binder", "pockets_per_page": 9, "page": 1, "slot": 1, "tags": "[\"Deck\",\"Tausch\"]", "note": "" },
    { "copy_id": "k3", "card_id": "46986414", "name": "Dunkler Magier", "set_code": "LOB-DE005", "rarity": "Ultra Rare", "language": "DE", "edition": "unknown", "condition": "EX", "price": 12.5, "price_first_ed": 20, "container_id": null, "container_name": null, "container_kind": null, "pockets_per_page": null, "page": null, "slot": null, "tags": null, "note": "Kante, \"leicht\" bestoßen" },
    { "copy_id": "k4", "card_id": "89631139", "name": "Blauäugiger w. Drache", "set_code": "SDK-DE001", "rarity": "Ultra Rare", "language": "DE", "edition": "unlimited", "condition": "GD", "price": 8, "price_first_ed": null, "container_id": "c2", "container_name": "Box Tausch", "container_kind": "box", "pockets_per_page": null, "page": 2, "slot": 3, "tags": "[\"verkauf\"]", "note": null },
    { "copy_id": "k5", "card_id": "89631139", "name": "Blauäugiger w. Drache", "set_code": "SDK-DE001", "rarity": "Ultra Rare", "language": "DE", "edition": "unlimited", "condition": "GD", "price": 8, "price_first_ed": null, "container_id": "c2", "container_name": "Box Tausch", "container_kind": "box", "pockets_per_page": null, "page": null, "slot": null, "tags": "[\"verkauf\"]", "note": null },
    { "copy_id": "k6", "card_id": "55144522", "name": "Topf der Gier", "set_code": "Unknown", "rarity": "Unknown", "language": "DE", "edition": "unknown", "condition": "NM", "price": 0, "price_first_ed": null, "container_id": null, "container_name": null, "container_kind": null, "pockets_per_page": null, "page": null, "slot": null, "tags": "kaputt", "note": null },
    { "copy_id": "k7", "card_id": "46986415", "name": "Dunkler Magier", "set_code": "CT13-DE003", "rarity": "Ultra Rare", "language": "DE", "edition": "limited", "condition": "PO", "price": 3, "price_first_ed": null, "container_id": "c1", "container_name": "Binder Blau", "container_kind": "binder", "pockets_per_page": 9, "page": 1, "slot": 2, "tags": "[]", "note": null },
    { "copy_id": "k8", "card_id": "89631139", "name": "Blauäugiger w. Drache", "set_code": "SDK-DE001", "rarity": "Ultra Rare", "language": "DE", "edition": "first", "condition": "MT", "price": 8, "price_first_ed": null, "container_id": "c1", "container_name": "Binder Blau", "container_kind": "binder", "pockets_per_page": 9, "page": 2, "slot": 1, "tags": "[\"Überschuss\"]", "note": null }
  ],
  "namesEn": { "46986414": "Dark Magician", "46986415": "Dark Magician", "89631139": "Blue-Eyes White Dragon", "55144522": "Pot of Greed" },
  "wishlist": [
    { "card_id": "46986414", "name": "Dunkler Magier" },
    { "card_id": "14558127", "name": "Aschenblüte" }
  ]
}
```

`docs/fixtures/import-export/export-carddex.csv`:
```csv
carddex_version,passcode,name,set_code,rarity,language,count,edition,condition,container,container_kind,pockets_per_page,page,slot,tags,note
1,46986414,Dunkler Magier,LOB-DE005,Ultra Rare,DE,2,first,NM,Binder Blau,binder,9,1,1,Deck|Tausch,
1,46986415,Dunkler Magier,CT13-DE003,Ultra Rare,DE,1,limited,PO,Binder Blau,binder,9,1,2,,
1,89631139,Blauäugiger w. Drache,SDK-DE001,Ultra Rare,DE,1,first,MT,Binder Blau,binder,9,2,1,Überschuss,
1,89631139,Blauäugiger w. Drache,SDK-DE001,Ultra Rare,DE,2,unlimited,GD,Box Tausch,box,,,,verkauf,
1,46986414,Dunkler Magier,LOB-DE005,Ultra Rare,DE,1,unknown,EX,,,,,,,"Kante, ""leicht"" bestoßen"
1,55144522,Topf der Gier,Unknown,Unknown,DE,1,unknown,NM,,,,,,,
```

`docs/fixtures/import-export/carddex-semikolon.csv`:
```csv
carddex_version;passcode;name;set_code;rarity;language;count;edition;condition;container;container_kind;pockets_per_page;page;slot;tags;note
1;46986414;Dunkler Magier;LOB-DE005;Ultra Rare;DE;2;first;NM;Binder Blau;binder;9;1;1; Deck | Tausch |deck;Kante, leicht bestoßen
1;89631139;Blauäugiger w. Drache;SDK-DE001;Ultra Rare;DE;1;unlimited;GD;;;;;;;
```

`docs/fixtures/import-export/carddex-neuer.csv`:
```csv
carddex_version,passcode,name,set_code,rarity,language,count,edition,condition,container,container_kind,pockets_per_page,page,slot,tags,note
1,46986414,Dunkler Magier,LOB-DE005,Ultra Rare,DE,1,first,NM,,,,,,,
2,46986414,Dunkler Magier,LOB-DE005,Ultra Rare,DE,1,first,NM,,,,,,,,future
```

- [ ] **Step 2: Test schreiben** — `desktop/electron/carddex-format.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { BOM } = require('./csv.cjs');
const { CARDDEX_COLUMNS, carddexGroups, writeCarddex, readCarddex, tagsOfCell } = require('./carddex-format.cjs');

// Spec F1 §2/§6 -- Card Dex schreiben gegen die Fixture-Datei, lesen mit BOM, Semikolon, Anfuehrungszeichen.
// Die Fixture-Dateien stehen ohne BOM und mit LF (Git kann Zeilenenden umschreiben); geprueft wird mit normalisierten Zeilenenden.
const DIR = path.join(__dirname, '..', '..', 'docs', 'fixtures', 'import-export');
const fixture = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
const IN = JSON.parse(fixture('export-input.json'));

test('Card Dex schreiben: BOM, CRLF, Gruppen, Sortierung (Behälter, Seite, Fach, Name, Set-Code), Box ohne Seite/Fach, Tags, Notiz', () => {
  const out = writeCarddex(carddexGroups(IN.copies));
  assert.ok(out.startsWith(BOM));
  assert.ok(out.includes('\r\n'));
  assert.equal(out.slice(1).replace(/\r\n/g, '\n'), fixture('export-carddex.csv').replace(/\r\n/g, '\n'));
});

test('Card Dex lesen: eigene Exportdatei mit BOM, Werte als Text, Tags als Liste, Zeilennummer', () => {
  const r = readCarddex(`${BOM}${fixture('export-carddex.csv')}`);
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 6);
  assert.deepEqual(r.rows[0], {
    line: 2, passcode: '46986414', name: 'Dunkler Magier', set_code: 'LOB-DE005', rarity: 'Ultra Rare', language: 'DE',
    count: '2', edition: 'first', condition: 'NM', container: 'Binder Blau', container_kind: 'binder', pockets_per_page: '9',
    page: '1', slot: '1', tags: ['Deck', 'Tausch'], note: '',
  });
  assert.equal(r.rows[4].note, 'Kante, "leicht" bestoßen');
  assert.deepEqual(r.rows[4].tags, []);
  assert.equal(r.rows[5].set_code, 'Unknown');
});

test('Card Dex lesen: Semikolon (Excel DE), Tags getrimmt und ohne Dubletten', () => {
  const r = readCarddex(fixture('carddex-semikolon.csv'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => [x.line, x.passcode, x.count, x.container]), [[2, '46986414', '2', 'Binder Blau'], [3, '89631139', '1', '']]);
  assert.deepEqual(r.rows[0].tags, ['Deck', 'Tausch']);
  assert.equal(r.rows[0].note, 'Kante, leicht bestoßen');
});

test('Card Dex lesen: Spalten über den Namen, nicht über die Position', () => {
  const text = 'carddex_version,count,passcode,note\n1,3,46986414,x\n';
  const r = readCarddex(text);
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].passcode, '46986414');
  assert.equal(r.rows[0].count, '3');
  assert.equal(r.rows[0].container, '');
});

test('Fehlerfälle: leer, ohne Kopfzeile/Pflichtspalte, fremdes Format, neuere Version', () => {
  assert.deepEqual(readCarddex(''), { ok: false, error: 'unreadable', text: 'Datei nicht lesbar' });
  assert.deepEqual(readCarddex(`${BOM}\r\n\r\n`), { ok: false, error: 'unreadable', text: 'Datei nicht lesbar' });
  assert.equal(readCarddex('carddex_version,passcode\n1,46986414\n').error, 'unreadable', 'count fehlt');
  assert.equal(readCarddex(`${CARDDEX_COLUMNS.join(',')}\n`).error, 'unreadable', 'nur Kopfzeile');
  assert.deepEqual(readCarddex('Folder Name,Quantity,Card Name\nA,1,B\n'),
    { ok: false, error: 'not-carddex', text: 'Nur Card-Dex-CSV – andere Formate folgen' });
  assert.deepEqual(readCarddex(fixture('carddex-neuer.csv')),
    { ok: false, error: 'newer-version', text: 'Datei stammt aus einer neueren Card-Dex-Version' });
});

test('tagsOfCell: JSON-Array normalisiert, kaputte Zelle ohne Tags', () => {
  assert.deepEqual(tagsOfCell('[" a ","A","b",3]'), ['a', 'b']);
  assert.deepEqual(tagsOfCell('kaputt'), []);
  assert.deepEqual(tagsOfCell(null), []);
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/carddex-format.test.cjs` → FAIL mit `Cannot find module './carddex-format.cjs'`.

- [ ] **Step 4: `copies.cjs` — Exporte ergänzen**

`desktop/electron/copies.cjs` — Änderung 1/1 — ersetzen:
```js
  setCopyLocation, deleteCopy, setCopyTagsNote, listUnsortedCopies, listDeckCopies, listTags, listContainers, saveContainer,
};
```
durch:
```js
  setCopyLocation, deleteCopy, setCopyTagsNote, listUnsortedCopies, listDeckCopies, listTags, listContainers, saveContainer,
  normalizeTagList, CONTAINER_KINDS, BINDER_POCKETS,
};
```

- [ ] **Step 5: `desktop/electron/carddex-format.cjs` anlegen**

```js
// Spec F1 §2 -- das eigene, verlustfreie Format: eine Zeile je Exemplar-Gruppe (gleiches Printing, Edition, Zustand,
// Behaelter, Seite, Fach, Tags, Notiz). Schreiben (Export) und Lesen (Import) wohnen zusammen, damit der Rundlauf an
// genau einer Spaltenliste haengt. Preise, price_locked, Cardmarket-IDs, Preisverlauf, Sealed, Decks und Wunschliste
// stehen absichtlich nicht drin.
const { parseCsv, toCsv } = require('./csv.cjs');
const { EDITIONS, CONDITIONS } = require('./valuation.cjs');
const { normalizeTagList } = require('./copies.cjs');

const CARDDEX_VERSION = 1;
const CARDDEX_COLUMNS = [
  'carddex_version', 'passcode', 'name', 'set_code', 'rarity', 'language', 'count', 'edition', 'condition',
  'container', 'container_kind', 'pockets_per_page', 'page', 'slot', 'tags', 'note',
];
const READ_ERRORS = {
  unreadable: 'Datei nicht lesbar',
  'not-carddex': 'Nur Card-Dex-CSV – andere Formate folgen',
  'newer-version': 'Datei stammt aus einer neueren Card-Dex-Version',
};

// card_copies.tags ist ein JSON-Array als Text; eine kaputte Zelle heisst "keine Tags" (wie tags.js#parseTags).
function tagsOfCell(text) {
  if (text == null || text === '') return [];
  try { return normalizeTagList(JSON.parse(text)); } catch { return []; }
}

const byText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'de');
const byNullableNumber = (a, b) => (a == null) - (b == null) || (Number(a) || 0) - (Number(b) || 0);

// copies: Zeilen aus collection-export.cjs#loadExportCopies. Ein Exemplar ohne lebenden Behaelter hat keinen Standort;
// Seite/Fach und Faecher je Seite gibt es nur bei einem Binder. -> Gruppen, sortiert nach Spec §2.
function carddexGroups(copies) {
  const groups = new Map();
  for (const cp of copies || []) {
    const inContainer = !!cp.container_id && !!cp.container_name;
    const binder = inContainer && cp.container_kind === 'binder';
    const tags = tagsOfCell(cp.tags);
    const g = {
      passcode: String(cp.card_id), name: cp.name ?? '', set_code: cp.set_code, rarity: cp.rarity, language: cp.language,
      edition: cp.edition, condition: cp.condition,
      container_id: inContainer ? cp.container_id : null,
      container: inContainer ? cp.container_name : null,
      container_kind: inContainer ? cp.container_kind : null,
      pockets_per_page: binder ? (cp.pockets_per_page ?? null) : null,
      page: binder ? (cp.page ?? null) : null,
      slot: binder ? (cp.slot ?? null) : null,
      tags, note: cp.note == null || cp.note === '' ? null : String(cp.note),
    };
    const key = JSON.stringify([g.passcode, g.set_code, g.rarity, g.language, g.edition, g.condition, g.container_id, g.page, g.slot, tags, g.note]);
    const hit = groups.get(key);
    if (hit) hit.count += 1; else groups.set(key, { ...g, count: 1 });
  }
  return [...groups.values()].sort((a, b) => (a.container == null) - (b.container == null)
    || byText(a.container, b.container)
    || byNullableNumber(a.page, b.page)
    || byNullableNumber(a.slot, b.slot)
    || byText(a.name, b.name)
    || byText(a.set_code, b.set_code)
    || byText(a.rarity, b.rarity)
    || byText(a.language, b.language)
    || EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition)
    || CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition));
}

function writeCarddex(groups) {
  const blank = (v) => (v == null ? '' : v);
  return toCsv([CARDDEX_COLUMNS, ...groups.map((g) => [
    CARDDEX_VERSION, g.passcode, g.name, g.set_code, g.rarity, g.language, g.count, g.edition, g.condition,
    blank(g.container), blank(g.container_kind), blank(g.pockets_per_page), blank(g.page), blank(g.slot),
    g.tags.join('|'), blank(g.note),
  ])]);
}

// -> { ok: true, rows: [{ line, passcode, name, set_code, rarity, language, count, edition, condition, container,
//      container_kind, pockets_per_page, page, slot, tags: string[], note }] } (alles Text ausser tags)
//    | { ok: false, error: 'unreadable'|'not-carddex'|'newer-version', text }
function readCarddex(text) {
  const fail = (error) => ({ ok: false, error, text: READ_ERRORS[error] });
  const { rows } = parseCsv(text);
  if (rows.length === 0) return fail('unreadable');
  const header = rows[0].cells.map((h) => h.trim().toLowerCase());
  if (header[0] !== 'carddex_version') return fail('not-carddex');
  const col = Object.fromEntries(CARDDEX_COLUMNS.map((c) => [c, header.indexOf(c)]));
  if (col.passcode < 0 || col.count < 0 || rows.length < 2) return fail('unreadable');
  const out = [];
  for (const r of rows.slice(1)) {
    const get = (c) => (col[c] >= 0 ? String(r.cells[col[c]] ?? '').trim() : '');
    const version = Number(get('carddex_version'));
    if (Number.isFinite(version) && version > CARDDEX_VERSION) return fail('newer-version');
    const row = { line: r.line };
    for (const c of CARDDEX_COLUMNS.slice(1)) row[c] = get(c);
    row.tags = normalizeTagList(row.tags.split('|'));
    out.push(row);
  }
  return { ok: true, rows: out };
}

module.exports = { CARDDEX_VERSION, CARDDEX_COLUMNS, READ_ERRORS, tagsOfCell, carddexGroups, writeCarddex, readCarddex };
```

- [ ] **Step 6: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/carddex-format.test.cjs` → `ℹ tests 6`, `ℹ pass 6`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 273`, `ℹ fail 0`.

- [ ] **Step 7: Schutz-Nachweis**

In `readCarddex` die Zeile `    if (Number.isFinite(version) && version > CARDDEX_VERSION) return fail('newer-version');` kurz löschen → `✖ Fehlerfälle: leer, ohne Kopfzeile/Pflichtspalte, fremdes Format, neuere Version`. Zitieren, zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/copies.cjs desktop/electron/carddex-format.cjs desktop/electron/carddex-format.test.cjs docs/fixtures/import-export/export-input.json docs/fixtures/import-export/export-carddex.csv docs/fixtures/import-export/carddex-semikolon.csv docs/fixtures/import-export/carddex-neuer.csv
git commit -m "feat(f1): Card-Dex-CSV schreiben und lesen (Gruppen je Exemplar-Gruppe, Sortierung, Fehlerfälle)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: Export-Formatierer Dragon Shield, YGOPRODeck, Wantslist, Verkaufsliste

**Files:**
- Create: `desktop/electron/export-formats.cjs`
- Create: `desktop/electron/export-formats.test.cjs`
- Create: `docs/fixtures/import-export/export-dragonshield.csv`
- Create: `docs/fixtures/import-export/export-ygoprodeck.csv`
- Create: `docs/fixtures/import-export/export-wantslist.txt`
- Create: `docs/fixtures/import-export/export-verkaufsliste.txt`

**Interfaces:**
- Consumes: `toCsv`, `BOM` (Task 1); `export-input.json` (Task 2); `valuation.cjs#unitPrice`, `conditionFactor`, `EDITIONS`, `CONDITIONS` (vorhanden).
- Produces (für Task 5): `dragonShieldCsv(copies, nameEn) → string`, `ygoprodeckCsv(copies, nameEn) → string`, `cardmarketWantslist(wishlist: [{ card_id, name }], nameEn) → string`, `saleListText(copies) → { text, omitted }`, `pieceValue(copy) → number`, `euroText(n) → '1.234,50 €'`; `nameEn(passcode) → string|null`.

- [ ] **Step 1: Soll-Dateien anlegen** (UTF-8 ohne BOM, LF)

`docs/fixtures/import-export/export-dragonshield.csv`:
```csv
Quantity,Card Name,Set Code,Rarity,Language,Printing,Condition,Price
1,Blue-Eyes White Dragon,SDK-DE001,Ultra Rare,German,1st Edition,Near Mint,8.00
2,Blue-Eyes White Dragon,SDK-DE001,Ultra Rare,German,Unlimited,Good,5.60
1,Dark Magician,CT13-DE003,Ultra Rare,German,Limited,Poor,0.60
2,Dark Magician,LOB-DE005,Ultra Rare,German,1st Edition,Near Mint,20.00
1,Dark Magician,LOB-DE005,Ultra Rare,German,,Excellent,10.63
1,Pot of Greed,,Unknown,German,,Near Mint,0.00
```

`docs/fixtures/import-export/export-ygoprodeck.csv`:
```csv
cardname,cardq,cardrarity,cardcode,cardid
Blue-Eyes White Dragon,3,Ultra Rare,SDK-DE001,89631139
Dark Magician,1,Ultra Rare,CT13-DE003,46986415
Dark Magician,3,Ultra Rare,LOB-DE005,46986414
Pot of Greed,1,Unknown,,55144522
```

`docs/fixtures/import-export/export-wantslist.txt`:
```text
1 Aschenblüte
1 Dark Magician
```

`docs/fixtures/import-export/export-verkaufsliste.txt` (Gedankenstriche `–` U+2013, Malzeichen `×` U+00D7, normales Leerzeichen vor `€`, eine Leerzeile vor der Summe):
```text
1× Blauäugiger w. Drache – SDK-DE001 – Ultra Rare – 1. Auflage – MT – 8,00 €
2× Blauäugiger w. Drache – SDK-DE001 – Ultra Rare – Unlimitiert – GD – 5,60 €
1× Dunkler Magier – CT13-DE003 – Ultra Rare – Limitiert – PO – 0,60 €
2× Dunkler Magier – LOB-DE005 – Ultra Rare – 1. Auflage – NM – 20,00 €
1× Dunkler Magier – LOB-DE005 – Ultra Rare – EX – 10,63 €

Summe: 7 Karten · 70,43 €
```

Handrechnung Verkaufsliste: Blauäugiger 1. Auflage MT = 8,00 (kein 1.-Auflage-Preis) × 1,0; Unlimitiert GD = 8 × 0,7 = 5,60 (×2); CT13 Limitiert PO = 3 × 0,2 = 0,60; LOB 1. Auflage NM = 20 × 1,0 (×2); LOB EX = 12,5 × 0,85 = 10,625 → 10,63. Summe 8 + 11,20 + 0,60 + 40 + 10,63 = 70,43 bei 7 Karten; `Topf der Gier` (Unknown) fehlt, `omitted = 1`.

- [ ] **Step 2: Test schreiben** — `desktop/electron/export-formats.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { BOM } = require('./csv.cjs');
const { dragonShieldCsv, ygoprodeckCsv, cardmarketWantslist, saleListText, pieceValue, euroText } = require('./export-formats.cjs');

// Spec F1 §4/§6 -- je Format ein Formatierer gegen eine Fixture-Datei. Die Fixture-Dateien stehen ohne BOM und mit LF
// (Git kann Zeilenenden umschreiben); geprueft wird BOM bzw. kein BOM getrennt, der Inhalt mit normalisierten Zeilenenden.
const DIR = path.join(__dirname, '..', '..', 'docs', 'fixtures', 'import-export');
const IN = JSON.parse(fs.readFileSync(path.join(DIR, 'export-input.json'), 'utf8'));
const expected = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').replace(/\r\n/g, '\n');
const nameEn = (id) => IN.namesEn[id] || null;
const csvBody = (out) => {
  assert.ok(out.startsWith(BOM), 'CSV beginnt mit BOM');
  assert.ok(out.includes('\r\n'), 'CSV mit CRLF');
  return out.slice(1).replace(/\r\n/g, '\n');
};

test('Dragon Shield: Zeile je Printing × Edition × Zustand, englischer Name, Zustandswörter, Stückwert, Unknown ohne Set-Code', () => {
  assert.equal(csvBody(dragonShieldCsv(IN.copies, nameEn)), expected('export-dragonshield.csv'));
});

test('YGOPRODeck: Zeile je Printing mit Menge und Passcode', () => {
  assert.equal(csvBody(ygoprodeckCsv(IN.copies, nameEn)), expected('export-ygoprodeck.csv'));
});

test('Cardmarket-Wantslist: eine Zeile je Wunsch, englischer Name, Rückfall auf den gespeicherten Namen', () => {
  const out = cardmarketWantslist(IN.wishlist, nameEn);
  assert.ok(!out.startsWith(BOM));
  assert.equal(out, expected('export-wantslist.txt'));
  assert.equal(cardmarketWantslist([], nameEn), '');
});

test('Verkaufsliste: Stückwert wie die Wertanzeige (1.-Auflage-Preis, Zustandsfaktor), Summe, Unknown weggelassen', () => {
  const { text, omitted } = saleListText(IN.copies);
  assert.ok(!text.startsWith(BOM));
  assert.equal(text, expected('export-verkaufsliste.txt'));
  assert.equal(omitted, 1);
});

test('Verkaufsliste: ohne Preis, Einzahl, Tausenderpunkt; leer ohne bekannte Printings', () => {
  const base = IN.copies[3];
  const { text } = saleListText([{ ...base, price: 0 }]);
  assert.equal(text, '1× Blauäugiger w. Drache – SDK-DE001 – Ultra Rare – Unlimitiert – GD – ohne Preis\n\nSumme: 1 Karte · 0,00 €\n');
  assert.equal(euroText(1234.5), '1.234,50 €');
  assert.deepEqual(saleListText([IN.copies[5]]), { text: '', omitted: 1 });
});

test('Stückwert: 1.-Auflage-Preis nur bei edition first, sonst Basispreis, mal Zustandsfaktor, auf Cent gerundet', () => {
  assert.equal(pieceValue({ price: 12.5, price_first_ed: 20, edition: 'first', condition: 'EX' }), 17);
  assert.equal(pieceValue({ price: 12.5, price_first_ed: 20, edition: 'unlimited', condition: 'EX' }), 10.63);
  assert.equal(pieceValue({ price: 12.5, price_first_ed: null, edition: 'first', condition: 'NM' }), 12.5);
});
```

- [ ] **Step 3: Fehlschlag bestätigen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/export-formats.test.cjs` → FAIL mit `Cannot find module './export-formats.cjs'`.

- [ ] **Step 4: `desktop/electron/export-formats.cjs` anlegen**

```js
// Spec F1 §4 -- Formatierer fuer die Exporte ausser Card Dex (carddex-format.cjs). Rein: Eingabe sind die Exemplar-Zeilen
// aus collection-export.cjs#loadExportCopies bzw. die Wunschliste, dazu ein Nachschlagen des englischen Namens.
// Unknown-Printings: leerer Set-Code in den CSV-Formaten, in der Verkaufsliste weggelassen (gezaehlt in `omitted`).
const { toCsv } = require('./csv.cjs');
const { EDITIONS, CONDITIONS, unitPrice, conditionFactor } = require('./valuation.cjs');

const DS_CONDITION = { MT: 'Near Mint', NM: 'Near Mint', EX: 'Excellent', GD: 'Good', LP: 'Light Played', PL: 'Played', PO: 'Poor' };
const DS_PRINTING = { first: '1st Edition', unlimited: 'Unlimited', limited: 'Limited', unknown: '' };
const DS_LANGUAGE = { DE: 'German', EN: 'English', JP: 'Japanese', FR: 'French', IT: 'Italian', SP: 'Spanish', PT: 'Portuguese' };
const SALE_EDITION = { first: '1. Auflage', unlimited: 'Unlimitiert', limited: 'Limitiert', unknown: null };

const isUnknown = (cp) => !cp.set_code || cp.set_code === 'Unknown';
const byText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'de');
const cents = (v) => Math.round(v * 100) / 100;
const eur = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euroText = (v) => `${eur.format(cents(v))} €`;

// Stueckwert wie in der Wertanzeige: unitPrice (1.-Auflage-Preis bei edition = 'first', G4) x Zustandsfaktor.
const pieceValue = (cp) => cents(unitPrice(cp, cp) * conditionFactor(cp.condition));

// Gruppen gleicher Schluessel mit Anzahl; `keyOf` bestimmt die Gruppierung, die erste Zeile traegt die Felder.
function groupBy(copies, keyOf) {
  const m = new Map();
  for (const cp of copies || []) {
    const k = JSON.stringify(keyOf(cp));
    const hit = m.get(k);
    if (hit) hit.count += 1; else m.set(k, { ...cp, count: 1 });
  }
  return [...m.values()];
}
const printingOf = (cp) => [String(cp.card_id), cp.set_code, cp.language, cp.rarity];
const sortGroups = (groups, nameOf) => groups.sort((a, b) => byText(nameOf(a), nameOf(b))
  || byText(a.set_code, b.set_code) || byText(a.rarity, b.rarity) || byText(a.language, b.language)
  || EDITIONS.indexOf(a.edition) - EDITIONS.indexOf(b.edition)
  || CONDITIONS.indexOf(a.condition) - CONDITIONS.indexOf(b.condition));

// nameEn(passcode) -> englischer Katalogname oder null; Rueckfall ist der lokale Name.
const englishName = (nameEn, cp) => (nameEn && nameEn(String(cp.card_id))) || cp.name || '';

function dragonShieldCsv(copies, nameEn) {
  const groups = sortGroups(groupBy(copies, (cp) => [...printingOf(cp), cp.edition, cp.condition]), (g) => englishName(nameEn, g));
  return toCsv([
    ['Quantity', 'Card Name', 'Set Code', 'Rarity', 'Language', 'Printing', 'Condition', 'Price'],
    ...groups.map((g) => [
      g.count, englishName(nameEn, g), isUnknown(g) ? '' : g.set_code, g.rarity, DS_LANGUAGE[g.language] || g.language,
      DS_PRINTING[g.edition] ?? '', DS_CONDITION[g.condition] || '', pieceValue(g).toFixed(2),
    ]),
  ]);
}

function ygoprodeckCsv(copies, nameEn) {
  const groups = sortGroups(groupBy(copies, printingOf), (g) => englishName(nameEn, g));
  return toCsv([
    ['cardname', 'cardq', 'cardrarity', 'cardcode', 'cardid'],
    ...groups.map((g) => [englishName(nameEn, g), g.count, g.rarity, isUnknown(g) ? '' : g.set_code, String(g.card_id)]),
  ]);
}

// wishlist: Zeilen aus get-wishlist ({ card_id, name }). Eine Zeile je Eintrag, Menge 1 (die Wunschliste kennt keine
// Menge und kein Printing).
function cardmarketWantslist(wishlist, nameEn) {
  const lines = (wishlist || [])
    .map((w) => ({ name: (nameEn && nameEn(String(w.card_id))) || w.name || String(w.card_id) }))
    .sort((a, b) => byText(a.name, b.name))
    .map((w) => `1 ${w.name}`);
  return lines.length ? `${lines.join('\n')}\n` : '';
}

// -> { text, omitted } ; omitted = Anzahl weggelassener Unknown-Exemplare.
function saleListText(copies) {
  const known = (copies || []).filter((cp) => !isUnknown(cp));
  const groups = sortGroups(groupBy(known, (cp) => [...printingOf(cp), cp.edition, cp.condition]), (g) => g.name);
  let total = 0;
  let sum = 0;
  const lines = groups.map((g) => {
    const piece = pieceValue(g);
    total += g.count;
    sum += piece * g.count;
    const parts = [`${g.count}× ${g.name || String(g.card_id)}`, g.set_code, g.rarity, SALE_EDITION[g.edition], g.condition,
      piece > 0 ? euroText(piece) : 'ohne Preis'];
    return parts.filter((p) => p != null && p !== '').join(' – ');
  });
  const text = lines.length ? `${lines.join('\n')}\n\nSumme: ${total} ${total === 1 ? 'Karte' : 'Karten'} · ${euroText(sum)}\n` : '';
  return { text, omitted: (copies || []).length - known.length };
}

module.exports = { DS_CONDITION, DS_PRINTING, DS_LANGUAGE, pieceValue, euroText, dragonShieldCsv, ygoprodeckCsv, cardmarketWantslist, saleListText };
```

- [ ] **Step 5: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/export-formats.test.cjs` → `ℹ tests 6`, `ℹ pass 6`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 279`, `ℹ fail 0`.

- [ ] **Step 6: Schutz-Nachweis**

In `export-formats.cjs` `const pieceValue = (cp) => cents(unitPrice(cp, cp) * conditionFactor(cp.condition));` kurz zu `const pieceValue = (cp) => cents(Number(cp.price) * conditionFactor(cp.condition));` → `✖ Dragon Shield: …`, `✖ Verkaufsliste: Stückwert wie die Wertanzeige …`, `✖ Stückwert: 1.-Auflage-Preis nur bei edition first …` (1.-Auflage-Preis aus G4 fehlt). Zitieren, zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/export-formats.cjs desktop/electron/export-formats.test.cjs docs/fixtures/import-export/export-dragonshield.csv docs/fixtures/import-export/export-ygoprodeck.csv docs/fixtures/import-export/export-wantslist.txt docs/fixtures/import-export/export-verkaufsliste.txt
git commit -m "feat(f1): Export-Formatierer Dragon Shield, YGOPRODeck, Cardmarket-Wantslist und Verkaufsliste gegen Fixtures

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 4: Zeilenauflösung mit Ampel und Regeln (`carddex-resolve.cjs`)

**Files:**
- Create: `desktop/electron/carddex-resolve.cjs`
- Create: `desktop/electron/carddex-resolve.test.cjs`

**Interfaces:**
- Consumes (Task 2): `normalizeTagList`, `CONTAINER_KINDS`, `BINDER_POCKETS` aus `copies.cjs`; Zeilen aus `readCarddex`.
- Produces (für Task 5): `printingKey({ id, set_code, language, rarity }) → 'id|set|lang|rarity'`, `slotKey(containerId, page, slot) → string`, `resolveCarddexRows(rows, ctx, rule = 'add') → { rows: [Resolved], summary }` mit
  `Resolved = { line, status: 'green'|'yellow'|'red', action: 'import'|'skip-existing'|'red', reasons: string[], name, printing: { id, set_code, language, rarity }, count: number|null, edition, condition, container: null | { name, kind, pockets_per_page, container_id: string|null, create: boolean }, page: number|null, slot: number|null, tags: string[], note: string|null, meta: null | { name, type, image_url } }` (`meta` nur für neue Printings) und
  `summary = { rule, total, green, yellow, red, containersToCreate, replaced, replacedLocated, skippedExisting, catalogMissing }`;
  `ctx = { catalog: null | { card(passcode) }, localCards: Map, printings: Map<printingKey, { live, located }>, containers: [{ container_id, name, kind, pockets_per_page }], occupied: Map<slotKey, Set<printingKey>>, defaults: { edition, condition } }`;
  `previewHeaderText(summary)`, `replaceWarningText(summary) → string|null`, `importResultText({ imported, containersCreated, omitted, skipped })`; `RULES`, `MAX_COUNT = 1000`, `REASON`.

- [ ] **Step 1: Test schreiben** — `desktop/electron/carddex-resolve.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveCarddexRows, printingKey, slotKey, previewHeaderText, replaceWarningText, importResultText,
} = require('./carddex-resolve.cjs');

// Eine gelesene Zeile wie readCarddex sie liefert (alles Text, tags als Liste).
const row = (over = {}) => ({
  line: 2, passcode: '46986414', name: 'Dunkler Magier', set_code: 'LOB-DE005', rarity: 'Ultra Rare', language: 'DE',
  count: '1', edition: 'first', condition: 'NM', container: '', container_kind: '', pockets_per_page: '', page: '', slot: '',
  tags: [], note: '', ...over,
});
const LOB = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ultra Rare' };
const CATALOG = new Map([
  ['46986414', { name_de: 'Dunkler Magier', name_en: 'Dark Magician', type: 'Normal Monster', image: 'img-dm' }],
  ['89631139', { name_de: '', name_en: 'Blue-Eyes White Dragon', type: 'Normal Monster', image: 'img-bewd' }],
]);
const ALIASES = new Map([['46986415', '46986414']]);
function ctx(over = {}) {
  return {
    catalog: { card: (p) => CATALOG.get(ALIASES.get(p) || p) || null },
    localCards: new Map(),
    printings: new Map(),
    containers: [],
    occupied: new Map(),
    defaults: { edition: 'unknown', condition: 'NM' },
    ...over,
  };
}
const one = (r, c = ctx(), rule = 'add') => resolveCarddexRows([r], c, rule).rows[0];

test('Grün: Printing vorhanden, Karte in der lokalen Sammlung, alle Felder gültig', () => {
  const c = ctx({ catalog: null, localCards: new Map([['46986414', { name: 'Dunkler Magier', type: 'x', image_url: 'u' }]]),
    printings: new Map([[printingKey(LOB), { live: 2, located: 0 }]]) });
  const r = one(row({ tags: ['Deck'], note: 'Notiz' }), c);
  assert.equal(r.status, 'green');
  assert.equal(r.action, 'import');
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.printing, LOB);
  assert.equal(r.count, 1);
  assert.deepEqual([r.edition, r.condition, r.tags, r.note, r.meta], ['first', 'NM', ['Deck'], 'Notiz', null]);
});

test('Katalog über die Artwork-Zuordnung: Passcode bleibt, Name/Typ/Bild der Hauptkarte; neues Printing gelb', () => {
  const r = one(row({ passcode: '46986415', set_code: 'CT13-DE003' }));
  assert.equal(r.status, 'yellow');
  assert.deepEqual(r.reasons, ['Printing wird angelegt']);
  assert.equal(r.printing.id, '46986415');
  assert.deepEqual(r.meta, { name: 'Dunkler Magier', type: 'Normal Monster', image_url: 'img-dm' });
  assert.equal(one(row({ passcode: '89631139' })).meta.name, 'Blue-Eyes White Dragon', 'ohne deutschen Namen der englische');
});

test('Rot: Passcode unbekannt oder Menge ungültig; ohne Katalog nur lokale Sammlung', () => {
  assert.deepEqual(one(row({ passcode: '12345678' })).reasons, ['Passcode unbekannt']);
  assert.deepEqual(one(row({ passcode: 'abc' })).reasons, ['Passcode unbekannt']);
  for (const count of ['0', '', '-1', '1.5', 'zwei', '1001']) {
    const r = one(row({ count }));
    assert.equal(r.status, 'red', count);
    assert.deepEqual(r.reasons, ['Menge ungültig'], count);
  }
  assert.equal(one(row({ count: '1000' })).status, 'yellow');
  const noCatalog = resolveCarddexRows([row()], ctx({ catalog: null }));
  assert.equal(noCatalog.rows[0].status, 'red');
  assert.equal(noCatalog.summary.catalogMissing, true);
});

test('Führende Nullen: Katalog ohne, lokale Sammlung mit gespeicherter Schreibweise', () => {
  assert.equal(one(row({ passcode: '046986414' })).printing.id, '46986414');
  const c = ctx({ catalog: null, localCards: new Map([['04031928', { name: 'X', type: null, image_url: null }]]) });
  assert.equal(one(row({ passcode: '04031928' }), c).printing.id, '04031928');
});

test('Gelb: Edition/Zustand ungültig -> Standard aus settings; leere Felder: Unknown, Sprache DE', () => {
  const r = one(row({ edition: '1st', condition: 'nm' }), ctx({ defaults: { edition: 'unlimited', condition: 'EX' } }));
  assert.deepEqual([r.edition, r.condition], ['unlimited', 'NM']);
  assert.deepEqual(r.reasons, ['Edition ungültig – Standard unlimited', 'Printing wird angelegt']);
  const bad = one(row({ condition: 'mint' }));
  assert.equal(bad.condition, 'NM');
  assert.ok(bad.reasons.includes('Zustand ungültig – Standard NM'));
  const blank = one(row({ set_code: '', rarity: '', language: 'en' }));
  assert.deepEqual(blank.printing, { id: '46986414', set_code: 'Unknown', language: 'EN', rarity: 'Unknown' });
});

test('Behälter: neu anlegen (Art und Fächerzahl aus der Datei, Binder ohne Angabe 9), vorhandener über den Namen', () => {
  const rows = [
    row({ line: 2, container: 'Binder Blau', container_kind: 'binder', pockets_per_page: '12', page: '1', slot: '12' }),
    row({ line: 3, container: 'Neu', container_kind: 'binder', page: '1', slot: '9' }),
    row({ line: 4, container: 'Box 1', container_kind: 'box' }),
  ];
  const c = ctx({ containers: [{ container_id: 'b1', name: 'Box 1', kind: 'box', pockets_per_page: null }] });
  const { rows: out, summary } = resolveCarddexRows(rows, c);
  assert.deepEqual(out[0].container, { name: 'Binder Blau', kind: 'binder', pockets_per_page: 12, container_id: null, create: true });
  assert.deepEqual([out[0].page, out[0].slot], [1, 12]);
  assert.ok(out[0].reasons.includes('Behälter „Binder Blau“ wird angelegt'));
  assert.equal(out[1].container.pockets_per_page, 9);
  assert.deepEqual(out[2].container, { name: 'Box 1', kind: 'box', pockets_per_page: null, container_id: 'b1', create: false });
  assert.ok(!out[2].reasons.some((x) => x.startsWith('Behälter')));
  assert.equal(summary.containersToCreate, 2);
});

test('Behälter: ungültige Art -> Box, ungültige Fächerzahl -> 9, abweichende Zeilen gelb (erste Zeile gilt)', () => {
  const rows = [
    row({ line: 2, container: 'A', container_kind: 'schrank' }),
    row({ line: 3, container: 'B', container_kind: 'binder', pockets_per_page: '8' }),
    row({ line: 4, container: 'B', container_kind: 'binder', pockets_per_page: '8' }),
    row({ line: 5, container: 'B', container_kind: 'binder', pockets_per_page: '4', page: '1', slot: '9' }),
    row({ line: 6, container: 'B', container_kind: 'box' }),
  ];
  const out = resolveCarddexRows(rows, ctx()).rows;
  assert.equal(out[0].container.kind, 'box');
  assert.ok(out[0].reasons.includes('Behälter-Art ungültig – Box'));
  assert.equal(out[1].container.pockets_per_page, 9);
  assert.ok(out[1].reasons.includes('Fächerzahl ungültig – 9'));
  assert.ok(!out[2].reasons.some((x) => x.includes('weicht ab')), 'gleiche Angaben wie die erste Zeile');
  assert.ok(out[3].reasons.includes('Behälter „B“ weicht ab – Art und Fächerzahl aus Zeile 3'));
  assert.deepEqual([out[3].container.pockets_per_page, out[3].page, out[3].slot], [9, 1, 9], 'Fach passt zur geltenden Fächerzahl');
  assert.ok(out[4].reasons.includes('Behälter „B“ weicht ab – Art und Fächerzahl aus Zeile 3'));
  assert.equal(out[4].container.kind, 'binder');
});

test('Seite/Fach: kein Binder, ungültig, über der Fächerzahl oder belegt -> ohne Seite/Fach in den Behälter', () => {
  const OTHER = { id: '89631139', set_code: 'SDK-DE001', language: 'DE', rarity: 'Ultra Rare' };
  const c = ctx({
    containers: [{ container_id: 'b1', name: 'Blau', kind: 'binder', pockets_per_page: 9 }, { container_id: 'x1', name: 'Box', kind: 'box', pockets_per_page: null }],
    occupied: new Map([[slotKey('b1', 1, 1), new Set([printingKey(OTHER)])]]),
  });
  const rows = [
    row({ line: 2, container: 'Box', container_kind: 'box', page: '1', slot: '1' }),
    row({ line: 3, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: '1', slot: '10' }),
    row({ line: 4, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: 'x', slot: '1' }),
    row({ line: 5, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: '1', slot: '' }),
    row({ line: 6, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: '1', slot: '1' }),
    row({ line: 7, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: '1', slot: '2' }),
  ];
  const out = resolveCarddexRows(rows, c).rows;
  const expectReason = (r, reason) => {
    assert.ok(r.reasons.includes(reason), `${r.line}: ${r.reasons}`);
    assert.deepEqual([r.page, r.slot], [null, null]);
    assert.ok(r.container);
  };
  expectReason(out[0], 'Behälter ist kein Binder – ohne Seite/Fach');
  expectReason(out[1], 'Seite/Fach ungültig – ohne Seite/Fach');
  expectReason(out[2], 'Seite/Fach ungültig – ohne Seite/Fach');
  expectReason(out[3], 'Seite/Fach ungültig – ohne Seite/Fach');
  expectReason(out[4], 'Fach belegt – ohne Seite/Fach');
  assert.deepEqual([out[5].page, out[5].slot], [1, 2]);
});

test('Regeln: Hinzufügen (Standard), Ersetzen (Zählung, belegte Fächer der ersetzten Printings frei), Überspringen', () => {
  const c = ctx({
    printings: new Map([[printingKey(LOB), { live: 3, located: 2 }]]),
    containers: [{ container_id: 'b1', name: 'Blau', kind: 'binder', pockets_per_page: 9 }],
    occupied: new Map([[slotKey('b1', 1, 1), new Set([printingKey(LOB)])]]),
  });
  const rows = [
    row({ line: 2, container: 'Blau', container_kind: 'binder', pockets_per_page: '9', page: '1', slot: '1' }),
    row({ line: 3, count: '2' }),
    row({ line: 4, passcode: '89631139', set_code: 'SDK-DE001' }),
    row({ line: 5, passcode: '99999999' }),
  ];
  const add = resolveCarddexRows(rows, c, 'add');
  assert.ok(add.rows[0].reasons.includes('Fach belegt – ohne Seite/Fach'));
  assert.deepEqual([add.summary.replaced, add.summary.skippedExisting], [0, 0]);
  assert.equal(replaceWarningText(add.summary), null);

  const replace = resolveCarddexRows(rows, c, 'replace');
  assert.deepEqual([replace.rows[0].page, replace.rows[0].slot], [1, 1], 'das ersetzte Exemplar gibt sein Fach frei');
  assert.deepEqual([replace.summary.replaced, replace.summary.replacedLocated], [3, 2], 'je Printing einmal gezählt');
  assert.equal(replaceWarningText(replace.summary), '3 vorhandene Exemplare werden ersetzt, davon 2 mit Standort oder Tags');

  const skip = resolveCarddexRows(rows, c, 'skip');
  assert.deepEqual(skip.rows.map((r) => r.action), ['skip-existing', 'skip-existing', 'import', 'red']);
  assert.deepEqual(skip.rows[1].reasons, ['Printing vorhanden – übersprungen']);
  assert.equal(skip.rows[0].container, null, 'übersprungene Zeilen planen keinen Behälter');
  assert.equal(skip.summary.skippedExisting, 2);
  assert.equal(resolveCarddexRows(rows, c, 'quatsch').summary.rule, 'add');
});

test('Zusammenfassung und Texte', () => {
  const rows = [
    row({ line: 2, container: 'Neu', container_kind: 'box' }),
    row({ line: 3 }),
    row({ line: 4, passcode: '1' }),
  ];
  const c = ctx({ printings: new Map([[printingKey(LOB), { live: 1, located: 0 }]]) });
  const { summary } = resolveCarddexRows(rows, c);
  assert.deepEqual(summary, { rule: 'add', total: 3, green: 1, yellow: 1, red: 1, containersToCreate: 1, replaced: 0, replacedLocated: 0, skippedExisting: 0, catalogMissing: false });
  assert.equal(previewHeaderText(summary), '3 Zeilen · 1 bereit · 1 mit Hinweis · 1 unbekannt · 1 Behälter wird angelegt');
  assert.equal(previewHeaderText({ total: 412, green: 398, yellow: 11, red: 3, containersToCreate: 2 }), '412 Zeilen · 398 bereit · 11 mit Hinweis · 3 unbekannt · 2 Behälter werden angelegt');
  assert.equal(previewHeaderText({ total: 1, green: 1, yellow: 0, red: 0, containersToCreate: 0 }), '1 Zeile · 1 bereit · 0 mit Hinweis · 0 unbekannt');
  assert.equal(replaceWarningText({ rule: 'replace', replaced: 1, replacedLocated: 0 }), '1 vorhandenes Exemplar wird ersetzt, davon 0 mit Standort oder Tags');
  assert.equal(importResultText({ imported: 398, containersCreated: 2, omitted: 3, skipped: 0 }), '398 Exemplare importiert · 2 Behälter angelegt · 3 ausgelassen');
  assert.equal(importResultText({ imported: 1, containersCreated: 0, omitted: 0, skipped: 4 }), '1 Exemplar importiert · 0 Behälter angelegt · 0 ausgelassen · 4 übersprungen');
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/carddex-resolve.test.cjs` → FAIL mit `Cannot find module './carddex-resolve.cjs'`.

- [ ] **Step 3: `desktop/electron/carddex-resolve.cjs` anlegen**

```js
// Spec F1 §2/§3 -- Aufloesung der gelesenen Card-Dex-Zeilen mit Ampel und die Regel fuer Bestehendes (Hinzufuegen,
// Ersetzen, Ueberspringen). Rein: der Datenbank-Stand kommt als `ctx` herein (carddex-import.cjs#loadResolveContext).
//
// ctx = {
//   catalog: null | { card(passcode) -> { name_de, name_en, type, image } | null }   // schon ueber die Artwork-Zuordnung
//   localCards: Map passcode -> { name, type, image_url }                              // jede cards-Zeile, auch geloeschte
//   printings: Map printingKey -> { live, located }                                    // lebende Printings, lebende Exemplare
//   containers: [{ container_id, name, kind, pockets_per_page }]                       // lebend, sort_order/name/container_id
//   occupied: Map slotKey -> Set printingKey                                            // lebende Exemplare mit Seite/Fach
//   defaults: { edition, condition }
// }
const { EDITIONS, CONDITIONS } = require('./valuation.cjs');
const { CONTAINER_KINDS, BINDER_POCKETS, normalizeTagList } = require('./copies.cjs');

const RULES = ['add', 'replace', 'skip'];
const MAX_COUNT = 1000;
const DEFAULT_POCKETS = 9;

const printingKey = (p) => [String(p.id), p.set_code, p.language, p.rarity].join('|');
const slotKey = (containerId, page, slot) => `${containerId}|${page}|${slot}`;
const positiveInt = (s) => (/^[0-9]+$/.test(String(s)) && Number(s) >= 1 ? Number(s) : null);

const REASON = {
  unknownPasscode: 'Passcode unbekannt',
  badCount: 'Menge ungültig',
  badEdition: (d) => `Edition ungültig – Standard ${d}`,
  badCondition: (d) => `Zustand ungültig – Standard ${d}`,
  newPrinting: 'Printing wird angelegt',
  skipExisting: 'Printing vorhanden – übersprungen',
  newContainer: (name) => `Behälter „${name}“ wird angelegt`,
  badKind: 'Behälter-Art ungültig – Box',
  badPockets: `Fächerzahl ungültig – ${DEFAULT_POCKETS}`,
  conflict: (name, line) => `Behälter „${name}“ weicht ab – Art und Fächerzahl aus Zeile ${line}`,
  notBinder: 'Behälter ist kein Binder – ohne Seite/Fach',
  badSlot: 'Seite/Fach ungültig – ohne Seite/Fach',
  occupied: 'Fach belegt – ohne Seite/Fach',
};

// Karte ueber lokale Sammlung (Passcode wie gespeichert) oder Katalog; fuehrende Nullen zaehlen nicht.
function findCard(raw, ctx) {
  if (!/^[0-9]{1,10}$/.test(raw)) return null;
  const norm = raw.replace(/^0+(?=[0-9])/, '');
  for (const id of [raw, norm]) if (ctx.localCards.has(id)) return { id, meta: ctx.localCards.get(id) };
  const cat = ctx.catalog ? ctx.catalog.card(norm) : null;
  if (!cat) return null;
  return { id: norm, meta: { name: cat.name_de || cat.name_en || null, type: cat.type || null, image_url: cat.image || null } };
}

function resolveBasics(row, ctx, rule) {
  const reasons = [];
  const card = findCard(row.passcode, ctx);
  if (!card) reasons.push(REASON.unknownPasscode);
  const count = positiveInt(row.count);
  if (count == null || count > MAX_COUNT) reasons.push(REASON.badCount);
  const printing = {
    id: card ? card.id : row.passcode, set_code: row.set_code || 'Unknown',
    language: (row.language || 'DE').toUpperCase(), rarity: row.rarity || 'Unknown',
  };
  const base = { line: row.line, name: row.name, printing, count, tags: normalizeTagList(row.tags), note: row.note || null,
    container: null, page: null, slot: null, meta: null };
  if (reasons.length) return { ...base, status: 'red', action: 'red', reasons, edition: row.edition, condition: row.condition };

  const edition = EDITIONS.includes(row.edition) ? row.edition : ctx.defaults.edition;
  if (edition !== row.edition) reasons.push(REASON.badEdition(ctx.defaults.edition));
  const cond = String(row.condition || '').toUpperCase();
  const condition = CONDITIONS.includes(cond) ? cond : ctx.defaults.condition;
  if (condition !== cond) reasons.push(REASON.badCondition(ctx.defaults.condition));

  const existing = ctx.printings.get(printingKey(printing));
  if (!existing) reasons.push(REASON.newPrinting);
  const skip = rule === 'skip' && !!existing;
  if (skip) reasons.push(REASON.skipExisting);
  return { ...base, edition, condition, reasons, meta: existing ? null : card.meta, action: skip ? 'skip-existing' : 'import' };
}

// Liegt in diesem Fach schon ein lebendes Exemplar, das nicht ersetzt wird?
function isOccupied(ctx, containerId, page, slot, replacedKeys) {
  const set = ctx.occupied.get(slotKey(containerId, page, slot));
  if (!set) return false;
  for (const key of set) if (!replacedKeys.has(key)) return true;
  return false;
}

function resolveContainer(r, row, ctx, plans, replacedKeys) {
  const name = row.container;
  if (!name) return;
  const fileKind = String(row.container_kind || '').toLowerCase();
  const filePockets = fileKind === 'binder' ? row.pockets_per_page : '';
  let plan = plans.get(name);
  if (!plan) {
    const existing = ctx.containers.find((c) => c.name === name);
    if (existing) {
      plan = { line: r.line, fileKind, filePockets, create: false, container_id: existing.container_id, kind: existing.kind, pockets: existing.pockets_per_page };
    } else {
      const kind = CONTAINER_KINDS.includes(fileKind) ? fileKind : 'box';
      if (kind !== fileKind) r.reasons.push(REASON.badKind);
      let pockets = null;
      if (kind === 'binder') {
        pockets = BINDER_POCKETS.includes(Number(filePockets)) ? Number(filePockets) : DEFAULT_POCKETS;
        if (filePockets !== '' && pockets !== Number(filePockets)) r.reasons.push(REASON.badPockets);
      }
      plan = { line: r.line, fileKind, filePockets, create: true, container_id: null, kind, pockets };
    }
    plans.set(name, plan);
  } else if (plan.fileKind !== fileKind || plan.filePockets !== filePockets) {
    r.reasons.push(REASON.conflict(name, plan.line));
  }
  if (plan.create) r.reasons.push(REASON.newContainer(name));
  r.container = { name, kind: plan.kind, pockets_per_page: plan.pockets, container_id: plan.container_id, create: plan.create };

  if (row.page === '' && row.slot === '') return;
  if (plan.kind !== 'binder') { r.reasons.push(REASON.notBinder); return; }
  const page = positiveInt(row.page);
  const slot = positiveInt(row.slot);
  const pockets = plan.pockets > 0 ? plan.pockets : 4;   // wie slotMath.js#clampPockets
  if (page == null || slot == null || slot > pockets) { r.reasons.push(REASON.badSlot); return; }
  if (!plan.create && isOccupied(ctx, plan.container_id, page, slot, replacedKeys)) { r.reasons.push(REASON.occupied); return; }
  r.page = page;
  r.slot = slot;
}

// rows: readCarddex(...).rows -> { rows: [aufgeloeste Zeile], summary }
function resolveCarddexRows(rows, ctx, rule = 'add') {
  const r0 = RULES.includes(rule) ? rule : 'add';
  const out = rows.map((row) => resolveBasics(row, ctx, r0));

  const replacedKeys = new Set();
  let replaced = 0;
  let replacedLocated = 0;
  if (r0 === 'replace') {
    for (const r of out) {
      if (r.action !== 'import') continue;
      const key = printingKey(r.printing);
      const existing = ctx.printings.get(key);
      if (!existing || replacedKeys.has(key)) continue;
      replacedKeys.add(key);
      replaced += existing.live;
      replacedLocated += existing.located;
    }
  }

  const plans = new Map();
  rows.forEach((row, i) => { if (out[i].action === 'import') resolveContainer(out[i], row, ctx, plans, replacedKeys); });
  for (const r of out) if (r.action !== 'red') r.status = r.reasons.length ? 'yellow' : 'green';

  const count = (pred) => out.filter(pred).length;
  return {
    rows: out,
    summary: {
      rule: r0, total: out.length, green: count((r) => r.status === 'green'), yellow: count((r) => r.status === 'yellow'),
      red: count((r) => r.status === 'red'), containersToCreate: [...plans.values()].filter((p) => p.create).length,
      replaced, replacedLocated, skippedExisting: count((r) => r.action === 'skip-existing'), catalogMissing: !ctx.catalog,
    },
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function previewHeaderText(s) {
  const parts = [plural(s.total, 'Zeile', 'Zeilen'), `${s.green} bereit`, `${s.yellow} mit Hinweis`, `${s.red} unbekannt`];
  if (s.containersToCreate > 0) parts.push(`${s.containersToCreate} Behälter ${s.containersToCreate === 1 ? 'wird' : 'werden'} angelegt`);
  return parts.join(' · ');
}

function replaceWarningText(s) {
  if (s.rule !== 'replace' || !s.replaced) return null;
  return `${plural(s.replaced, 'vorhandenes Exemplar wird', 'vorhandene Exemplare werden')} ersetzt, davon ${s.replacedLocated} mit Standort oder Tags`;
}

function importResultText(r) {
  const parts = [plural(r.imported, 'Exemplar importiert', 'Exemplare importiert'), `${r.containersCreated} Behälter angelegt`, `${r.omitted} ausgelassen`];
  if (r.skipped > 0) parts.push(`${r.skipped} übersprungen`);
  return parts.join(' · ');
}

module.exports = {
  RULES, MAX_COUNT, REASON, printingKey, slotKey, resolveCarddexRows, previewHeaderText, replaceWarningText, importResultText,
};
```

- [ ] **Step 4: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/carddex-resolve.test.cjs` → `ℹ tests 10`, `ℹ pass 10`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 289`, `ℹ fail 0`.

- [ ] **Step 5: Schutz-Nachweise**

(a) Ersetzen gibt Fächer frei: in `isOccupied` `  for (const key of set) if (!replacedKeys.has(key)) return true;` kurz zu `  for (const key of set) return true;` → `✖ Regeln: Hinzufügen (Standard), Ersetzen (Zählung, belegte Fächer der ersetzten Printings frei), Überspringen` (gemessen).
(b) Erste Zeile gilt: in `resolveContainer` `  } else if (plan.fileKind !== fileKind || plan.filePockets !== filePockets) {` kurz zu `  } else if (false) {` → `✖ Behälter: ungültige Art -> Box, ungültige Fächerzahl -> 9, abweichende Zeilen gelb (erste Zeile gilt)` (gemessen).
Jeweils zitieren und zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/carddex-resolve.cjs desktop/electron/carddex-resolve.test.cjs
git commit -m "feat(f1): Card-Dex-Zeilenauflösung mit Ampel, Behälter-Plan, Seite/Fach und Regeln Hinzufügen/Ersetzen/Überspringen

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 5: Import-Ausführung (Transaktion, Sitzung, Protokoll) und Export-Umfang

**Files:**
- Create: `desktop/electron/carddex-import.cjs`
- Create: `desktop/electron/collection-export.cjs`
- Create: `desktop/electron/carddex-import.test.cjs`

**Interfaces:**
- Consumes: Task 2 (`readCarddex`, `tagsOfCell`, `carddexGroups`, `writeCarddex`), Task 3 (Formatierer), Task 4 (`resolveCarddexRows`, `printingKey`, `slotKey`, Texte); vorhanden `copies.defaults`, `copies.saveContainer`, `copies.ValidationError`, `database.cjs#initDatabase` (Tests).
- Produces (für Task 7):
  - `loadResolveContext(db, catalog) → ctx` (Task 4).
  - `createImportSessions() → { open(payload) → token, peek(token) → payload|null, take(token) → payload|null }` (eine offene Sitzung; `take` verbraucht).
  - `importOpen(db, sessions, { fileName, text }, catalog) → { token, fileName, preview } | { error }` mit `preview = { rows, summary, headerText, warningText: string|null, catalogText: 'Offline-Katalog fehlt'|null }` (Regel *Hinzufügen*).
  - `importResolve(db, sessions, { token, rule }, catalog) → { preview } | { error: 'Vorschau abgelaufen – Datei bitte neu öffnen.' }`.
  - `applyCarddexImport(db, resolved, { omitLines }) → { imported, containersCreated, omitted, skipped }`, wirft `Error('Import fehlgeschlagen: Zeile N: …')`.
  - `importRun(db, sessions, { token, rule, omitLines }, { catalog, logDir, now: Date, onChanged }) → { success: true, imported, containersCreated, omitted, skipped, text, logFile } | { success: false, error } | { success: false, busy: true, error: 'Dieser Import läuft bereits oder ist abgeschlossen.' }`.
  - `importLogName(now) → '2026-09-16T14-03-22-carddex.json'`, `writeImportLog(dir, now, entry) → path`.
  - `loadExportCopies(db, scope) → Zeilen { copy_id, card_id, set_code, language, rarity, edition, condition, page, slot, tags, note, name, price, price_first_ed, container_id, container_name, container_kind, pockets_per_page }` mit `scope = { kind: 'all' } | { kind: 'container', containerId } | { kind: 'copies', copyIds }`.
  - `buildExport(db, { format, scope }, { nameEn, wishlist, now }) → { content, count, omitted, unit: 'copy'|'wish', defaultName, ext }` für `format ∈ carddex|dragonshield|ygoprodeck|wantslist|salelist`; `exportResultText(built)`; `EXPORT_FORMATS`.

- [ ] **Step 1: Test schreiben** — `desktop/electron/carddex-import.test.cjs` (echte Datenbank über `initDatabase` in einem Temp-Ordner, volles Schema samt Triggern):

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initDatabase } = require('./database.cjs');
const copies = require('./copies.cjs');
const { tagsOfCell } = require('./carddex-format.cjs');
const { createImportSessions, importOpen, importResolve, importRun, importLogName } = require('./carddex-import.cjs');
const { buildExport, loadExportCopies, exportResultText } = require('./collection-export.cjs');
const { deleteContainer } = require('./containers-schema.cjs');

// Spec F1 §6 -- import-run gegen eine echte SQLite-Datenbank mit dem vollen Schema aus database.cjs (Trigger inklusive).
function tempDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carddex-'));
  const log = console.log;
  console.log = () => {};
  const db = initDatabase(dir);
  console.log = log;
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, dir };
}

const DM = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ultra Rare' };
const DM_ALT = { id: '46986415', set_code: 'CT13-DE003', language: 'DE', rarity: 'Ultra Rare' };
const BEWD = { id: '89631139', set_code: 'SDK-DE001', language: 'DE', rarity: 'Ultra Rare' };
const POT = { id: '55144522', set_code: 'Unknown', language: 'DE', rarity: 'Unknown' };
const META = {
  46986414: { name: 'Dunkler Magier', type: 'Normal Monster', image: 'img-dm' },
  46986415: { name: 'Dunkler Magier', type: 'Normal Monster', image: 'img-dm2' },
  89631139: { name: 'Blauäugiger w. Drache', type: 'Normal Monster', image: 'img-bewd' },
  55144522: { name: 'Topf der Gier', type: 'Spell Card', image: 'img-pot' },
};
const catalog = { card: (p) => (META[p] ? { name_de: META[p].name, name_en: '', type: META[p].type, image: META[p].image } : null) };

function addPrinting(db, p, price = 1) {
  db.prepare(`INSERT INTO cards (id, set_code, language, rarity, name, type, image_url, price)
              VALUES (@id, @set_code, @language, @rarity, @name, @type, @image_url, @price)`)
    .run({ ...p, name: META[p.id].name, type: META[p.id].type, image_url: META[p.id].image, price });
}

// Sammlung mit Binder, Box, Tags, Notizen, Unknown-Printing und Artwork-Passcode.
function seedCollection(db) {
  for (const p of [DM, DM_ALT, BEWD, POT]) addPrinting(db, p, 5);
  const binder = copies.saveContainer(db, { name: 'Binder Blau', kind: 'binder', pockets_per_page: 9 });
  const box = copies.saveContainer(db, { name: 'Box Tausch', kind: 'box' });
  const place = (ids, loc, tags, note) => ids.forEach((copy_id) => {
    if (loc) copies.setCopyLocation(db, { copy_id, ...loc });
    if (tags || note) copies.setCopyTagsNote(db, { copy_id, tags: tags || [], note: note || null });
  });
  place(copies.addCopies(db, DM, { edition: 'first', condition: 'NM', count: 2 }), { container_id: binder, page: 1, slot: 1 }, ['Deck', 'Tausch']);
  place(copies.addCopies(db, DM, { edition: 'unknown', condition: 'EX', count: 1 }), null, null, 'Kante, "leicht" bestoßen\nzweite Zeile');
  place(copies.addCopies(db, BEWD, { edition: 'unlimited', condition: 'GD', count: 2 }), { container_id: box }, ['verkauf']);
  place(copies.addCopies(db, DM_ALT, { edition: 'limited', condition: 'PO', count: 1 }), { container_id: binder, page: 1, slot: 2 });
  copies.addCopies(db, POT, { edition: 'unknown', condition: 'NM', count: 1 });
  return { binder, box };
}

// Vergleichbare Sicht auf alle lebenden Exemplare (ohne copy_id und Behaelter-ID).
function copySignature(db) {
  return db.prepare(`SELECT cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition, cp.page, cp.slot, cp.tags, cp.note,
                            ct.name AS container, ct.kind, ct.pockets_per_page
                       FROM card_copies cp LEFT JOIN containers ct ON ct.container_id = cp.container_id AND ct.deleted = 0
                      WHERE cp.deleted = 0`).all()
    .map((r) => JSON.stringify({ ...r, tags: tagsOfCell(r.tags) }))
    .sort();
}
const quantities = (db) => db.prepare('SELECT id, set_code, rarity, quantity, deleted FROM cards ORDER BY id, set_code').all();
const deps = (dir, extra = {}) => ({ catalog, logDir: path.join(dir, 'imports'), now: new Date('2026-09-16T14:03:22Z'), ...extra });
const csv = (lines) => `carddex_version,passcode,name,set_code,rarity,language,count,edition,condition,container,container_kind,pockets_per_page,page,slot,tags,note\n${lines.join('\n')}\n`;

test('Rundlauf: Card-Dex-Export einer Sammlung, Import in eine leere Datenbank ergibt dieselben Exemplare', (t) => {
  const a = tempDb(t);
  seedCollection(a.db);
  const exported = buildExport(a.db, { format: 'carddex', scope: { kind: 'all' } });
  assert.equal(exported.count, 7);

  const b = tempDb(t);
  const sessions = createImportSessions();
  let changed = 0;
  const opened = importOpen(b.db, sessions, { fileName: 'carddex.csv', text: exported.content }, catalog);
  assert.equal(opened.preview.summary.red, 0);
  assert.equal(opened.preview.headerText, '5 Zeilen · 0 bereit · 5 mit Hinweis · 0 unbekannt · 2 Behälter werden angelegt');
  const res = importRun(b.db, sessions, { token: opened.token, rule: 'add', omitLines: [] }, deps(b.dir, { onChanged: () => { changed += 1; } }));
  assert.equal(res.success, true, res.error);
  assert.equal(res.text, '7 Exemplare importiert · 2 Behälter angelegt · 0 ausgelassen');
  assert.equal(changed, 1);
  assert.deepEqual(copySignature(b.db), copySignature(a.db));
  assert.deepEqual(quantities(b.db).map((r) => [r.id, r.set_code, r.quantity, r.deleted]), quantities(a.db).map((r) => [r.id, r.set_code, r.quantity, r.deleted]));
  const newCard = b.db.prepare('SELECT name, type, image_url, price FROM cards WHERE id = ?').get(DM_ALT.id);
  assert.deepEqual(newCard, { name: 'Dunkler Magier', type: 'Normal Monster', image_url: 'img-dm2', price: null }, 'Stammdaten aus dem Katalog, Preis kommt später');
  const log = JSON.parse(fs.readFileSync(res.logFile, 'utf8'));
  assert.equal(path.basename(res.logFile), '2026-09-16T14-03-22-carddex.json');
  assert.equal(log.file, 'carddex.csv');
  assert.equal(log.rows.length, 5);
});

test('Rollback: ein Fehler in Zeile N lässt die Datenbank unverändert und nennt die Zeile', (t) => {
  const { db, dir } = tempDb(t);
  addPrinting(db, BEWD);
  copies.addCopies(db, BEWD, { count: 1 });
  db.exec(`CREATE TRIGGER boom BEFORE INSERT ON card_copies WHEN NEW.note = 'BOOM' BEGIN SELECT RAISE(ABORT, 'kaputt'); END;`);
  const before = { sig: copySignature(db), q: quantities(db), containers: db.prepare('SELECT COUNT(*) AS n FROM containers').get().n };
  const sessions = createImportSessions();
  const opened = importOpen(db, sessions, { fileName: 'x.csv', text: csv([
    '1,46986414,,LOB-DE005,Ultra Rare,DE,2,first,NM,Neu,binder,9,1,1,,',
    '1,89631139,,SDK-DE001,Ultra Rare,DE,1,first,NM,,,,,,,',
    '1,55144522,,Unknown,Unknown,DE,1,unknown,NM,,,,,,,BOOM',
  ]) }, catalog);
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a);
  const res = importRun(db, sessions, { token: opened.token, rule: 'replace' }, deps(dir));
  console.error = orig;
  assert.deepEqual(res, { success: false, error: 'Import fehlgeschlagen: Zeile 4: Unerwarteter Datenbankfehler.' });
  assert.ok(String(errors[0][1]).includes('kaputt'), 'Rohmeldung in der Konsole');
  assert.deepEqual(copySignature(db), before.sig);
  assert.deepEqual(quantities(db), before.q);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM containers').get().n, before.containers);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM card_copies WHERE deleted = 1").get().n, 0, 'Ersetzen zurückgerollt');
  assert.ok(!fs.existsSync(path.join(dir, 'imports')), 'kein Protokoll bei Fehler');
});

test('Ersetzen löscht nur weich: alte Exemplare bleiben als deleted = 1, Menge folgt der Datei', (t) => {
  const { db, dir } = tempDb(t);
  addPrinting(db, DM);
  const binder = copies.saveContainer(db, { name: 'Binder Blau', kind: 'binder', pockets_per_page: 9 });
  const old = copies.addCopies(db, DM, { edition: 'unknown', condition: 'NM', count: 3 });
  copies.setCopyLocation(db, { copy_id: old[0], container_id: binder, page: 1, slot: 1 });
  copies.setCopyTagsNote(db, { copy_id: old[1], tags: ['Deck'], note: null });
  const sessions = createImportSessions();
  const text = csv(['1,46986414,,LOB-DE005,Ultra Rare,DE,2,first,MT,Binder Blau,binder,9,1,1,,']);
  const opened = importOpen(db, sessions, { fileName: 'x.csv', text }, catalog);
  assert.ok(opened.preview.rows[0].reasons.includes('Fach belegt – ohne Seite/Fach'), 'Hinzufügen: Fach belegt');
  const replace = importResolve(db, sessions, { token: opened.token, rule: 'replace' }, catalog).preview;
  assert.equal(replace.warningText, '3 vorhandene Exemplare werden ersetzt, davon 2 mit Standort oder Tags');
  assert.equal(replace.rows[0].status, 'green');
  const res = importRun(db, sessions, { token: opened.token, rule: 'replace' }, deps(dir));
  assert.equal(res.success, true, res.error);
  const rows = db.prepare('SELECT copy_id, deleted, edition, condition, page, slot FROM card_copies ORDER BY deleted DESC, copy_id').all();
  assert.equal(rows.length, 5, 'keine Zeile hart gelöscht');
  assert.deepEqual(rows.filter((r) => r.deleted === 1).map((r) => r.copy_id).sort(), [...old].sort());
  assert.deepEqual(rows.filter((r) => r.deleted === 0).map((r) => [r.edition, r.condition, r.page, r.slot]), [['first', 'MT', 1, 1], ['first', 'MT', 1, 1]]);
  assert.deepEqual(db.prepare('SELECT quantity, deleted FROM cards WHERE id = ?').get(DM.id), { quantity: 2, deleted: 0 });
});

test('Busy-Schutz: ein zweiter Aufruf mit derselben Vorschau importiert nichts', (t) => {
  const { db, dir } = tempDb(t);
  const sessions = createImportSessions();
  const opened = importOpen(db, sessions, { fileName: 'x.csv', text: csv(['1,46986414,,LOB-DE005,Ultra Rare,DE,3,first,NM,,,,,,,']) }, catalog);
  const first = importRun(db, sessions, { token: opened.token }, deps(dir));
  const second = importRun(db, sessions, { token: opened.token }, deps(dir));
  assert.equal(first.imported, 3);
  assert.deepEqual(second, { success: false, busy: true, error: 'Dieser Import läuft bereits oder ist abgeschlossen.' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_copies').get().n, 3);
  assert.deepEqual(importResolve(db, sessions, { token: opened.token, rule: 'add' }, catalog), { error: 'Vorschau abgelaufen – Datei bitte neu öffnen.' });
});

test('cards.quantity und cards.deleted schreibt der Import nie (Anweisungen mitgeschnitten)', (t) => {
  const { db, dir } = tempDb(t);
  addPrinting(db, BEWD);
  copies.addCopies(db, BEWD, { count: 2 });
  const sessions = createImportSessions();
  const opened = importOpen(db, sessions, { fileName: 'x.csv', text: csv([
    '1,46986414,,LOB-DE005,Ultra Rare,DE,1,first,NM,Neu,box,,,,,',
    '1,89631139,,SDK-DE001,Ultra Rare,DE,1,first,NM,,,,,,,',
  ]) }, catalog);
  const seen = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => { seen.push(sql); return prepare(sql); };
  const res = importRun(db, sessions, { token: opened.token, rule: 'replace' }, deps(dir));
  db.prepare = prepare;
  assert.equal(res.success, true, res.error);
  const writesCards = seen.filter((sql) => /\b(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE)\s+cards\b/i.test(sql));
  assert.ok(writesCards.length > 0, 'neues Printing wurde angelegt');
  for (const sql of writesCards) assert.ok(!/\b(quantity|deleted)\b/i.test(sql), sql);
  assert.deepEqual(db.prepare('SELECT id, quantity, deleted FROM cards ORDER BY id').all(),
    [{ id: '46986414', quantity: 1, deleted: 0 }, { id: '89631139', quantity: 1, deleted: 0 }]);
});

test('Rote Zeilen: ohne Auslassen kein Import, mit Auslassen importiert und im Protokoll; Überspringen lässt Vorhandenes', (t) => {
  const { db, dir } = tempDb(t);
  addPrinting(db, BEWD);
  copies.addCopies(db, BEWD, { count: 1 });
  const text = csv([
    '1,46986414,,LOB-DE005,Ultra Rare,DE,1,first,NM,,,,,,,',
    '1,12345678,,XXX-DE001,Common,DE,1,first,NM,,,,,,,',
    '1,89631139,,SDK-DE001,Ultra Rare,DE,5,first,NM,,,,,,,',
  ]);
  const sessions = createImportSessions();
  let opened = importOpen(db, sessions, { fileName: 'x.csv', text }, catalog);
  assert.deepEqual(importRun(db, sessions, { token: opened.token, rule: 'skip', omitLines: [] }, deps(dir)),
    { success: false, error: 'Import fehlgeschlagen: Zeile 3: unbekannte Zeile zuerst auslassen' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM card_copies').get().n, 1);

  opened = importOpen(db, sessions, { fileName: 'x.csv', text }, catalog);
  const res = importRun(db, sessions, { token: opened.token, rule: 'skip', omitLines: [3] }, deps(dir));
  assert.equal(res.text, '1 Exemplar importiert · 0 Behälter angelegt · 1 ausgelassen · 1 übersprungen');
  assert.deepEqual(db.prepare('SELECT id, quantity FROM cards ORDER BY id').all(), [{ id: '46986414', quantity: 1 }, { id: '89631139', quantity: 1 }]);
  const log = JSON.parse(fs.readFileSync(res.logFile, 'utf8'));
  assert.deepEqual(log.rows.map((r) => [r.line, r.action]), [[2, 'import'], [3, 'omitted'], [4, 'skip-existing']]);
  assert.equal(importLogName(new Date('2026-01-02T03:04:05.678Z')), '2026-01-02T03-04-05-carddex.json');
});

test('Datei nicht lesbar / fremdes Format / Offline-Katalog fehlt', (t) => {
  const { db } = tempDb(t);
  const sessions = createImportSessions();
  assert.deepEqual(importOpen(db, sessions, { fileName: 'x.csv', text: '' }, catalog), { error: 'Datei nicht lesbar' });
  assert.deepEqual(importOpen(db, sessions, { fileName: 'x.csv', text: 'a,b\n1,2\n' }, catalog), { error: 'Nur Card-Dex-CSV – andere Formate folgen' });
  const opened = importOpen(db, sessions, { fileName: 'x.csv', text: csv(['1,46986414,,LOB-DE005,Ultra Rare,DE,1,first,NM,,,,,,,']) }, null);
  assert.equal(opened.preview.catalogText, 'Offline-Katalog fehlt');
  assert.equal(opened.preview.rows[0].status, 'red');
});

test('Export-Umfang: ganze Sammlung, ein Behälter, aktueller Filter; Wantslist aus der Wunschliste; Ergebnistext', (t) => {
  const { db } = tempDb(t);
  const { binder } = seedCollection(db);
  assert.equal(loadExportCopies(db, { kind: 'all' }).length, 7);
  assert.equal(loadExportCopies(db, { kind: 'container', containerId: binder }).length, 3);
  const some = loadExportCopies(db).slice(0, 2).map((r) => r.copy_id);
  assert.deepEqual(loadExportCopies(db, { kind: 'copies', copyIds: [...some, 'weg'] }).map((r) => r.copy_id), some);
  const box = db.prepare("SELECT container_id FROM containers WHERE name = 'Box Tausch'").get().container_id;
  deleteContainer(db, box);
  assert.equal(loadExportCopies(db).filter((r) => r.container_id).length, 3, 'gelöschter Behälter zählt nicht');

  const sale = buildExport(db, { format: 'salelist', scope: { kind: 'all' } }, { now: new Date('2026-09-16T10:00:00Z') });
  assert.deepEqual([sale.count, sale.omitted, sale.defaultName], [6, 1, 'verkaufsliste-2026-09-16.txt']);
  assert.equal(exportResultText(sale), '6 Exemplare exportiert · 1 Exemplar ohne Set-Code weggelassen');
  const wants = buildExport(db, { format: 'wantslist' }, { wishlist: [{ card_id: '46986414', name: 'Dunkler Magier' }], nameEn: () => 'Dark Magician' });
  assert.deepEqual([wants.content, wants.count], ['1 Dark Magician\n', 1]);
  assert.equal(exportResultText(wants), '1 Wunsch exportiert');
  assert.equal(buildExport(db, { format: 'carddex', scope: { kind: 'copies', copyIds: [] } }).count, 0);
  assert.throws(() => buildExport(db, { format: 'pdf' }), /Unbekanntes Exportformat/);
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/carddex-import.test.cjs` → FAIL mit `Cannot find module './carddex-import.cjs'`.

- [ ] **Step 3: `desktop/electron/carddex-import.cjs` anlegen**

```js
// Spec F1 §3 -- Card-Dex-Import gegen die Datenbank: Stand fuer die Aufloesung laden, Vorschau-Sitzungen, Ausfuehrung in
// EINER Transaktion (ganz oder gar nicht) und das Protokoll. Die Regeln selbst stehen in carddex-resolve.cjs.
// cards.quantity und cards.deleted schreibt hier nichts: neue Printings entstehen ohne diese Spalten, die Trigger aus
// copies-schema.cjs zaehlen sie nach jedem Exemplar nach. Ersetzen loescht Exemplare nur weich.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const copies = require('./copies.cjs');
const { readCarddex, tagsOfCell } = require('./carddex-format.cjs');
const {
  printingKey, slotKey, resolveCarddexRows, previewHeaderText, replaceWarningText, importResultText,
} = require('./carddex-resolve.cjs');

function loadResolveContext(db, catalog) {
  const localCards = new Map();
  for (const c of db.prepare('SELECT id, name, type, image_url FROM cards ORDER BY deleted ASC').all()) {
    const id = String(c.id);
    if (!localCards.has(id)) localCards.set(id, { name: c.name ?? null, type: c.type ?? null, image_url: c.image_url ?? null });
  }
  const printings = new Map();
  for (const c of db.prepare('SELECT id, set_code, language, rarity FROM cards WHERE deleted = 0').all()) {
    printings.set(printingKey(c), { live: 0, located: 0 });
  }
  const occupied = new Map();
  const liveCopies = db.prepare(`SELECT card_id AS id, set_code, language, rarity, container_id, page, slot, tags
                                   FROM card_copies WHERE deleted = 0`).all();
  for (const cp of liveCopies) {
    const key = printingKey(cp);
    const p = printings.get(key);
    if (p) {
      p.live += 1;
      if (cp.container_id || tagsOfCell(cp.tags).length > 0) p.located += 1;
    }
    if (cp.container_id && cp.page != null && cp.slot != null) {
      const k = slotKey(cp.container_id, cp.page, cp.slot);
      if (!occupied.has(k)) occupied.set(k, new Set());
      occupied.get(k).add(key);
    }
  }
  const containers = db.prepare(`SELECT container_id, name, kind, pockets_per_page FROM containers
                                  WHERE deleted = 0 ORDER BY sort_order, name, container_id`).all();
  return { catalog: catalog || null, localCards, printings, containers, occupied, defaults: copies.defaults(db) };
}

// Eine offene Vorschau je Datei. `take` gibt die Sitzung genau einmal heraus -- ein zweiter Klick auf "Übernehmen"
// findet keine mehr (Busy-Schutz: better-sqlite3 arbeitet synchron, zwei IPC-Aufrufe laufen nacheinander, nie
// gleichzeitig; ohne das Verbrauchen liefe der zweite Aufruf nach dem ersten einfach noch einmal).
function createImportSessions() {
  const sessions = new Map();
  return {
    open(payload) {
      sessions.clear();
      const token = crypto.randomUUID();
      sessions.set(token, payload);
      return token;
    },
    peek: (token) => sessions.get(token) || null,
    take(token) {
      const s = sessions.get(token) || null;
      sessions.delete(token);
      return s;
    },
  };
}

// Vorschau fuer den Renderer: Zeilen, Zaehler und die fertigen Texte.
function previewOf(resolved) {
  return {
    rows: resolved.rows,
    summary: resolved.summary,
    headerText: previewHeaderText(resolved.summary),
    warningText: replaceWarningText(resolved.summary),
    catalogText: resolved.summary.catalogMissing ? 'Offline-Katalog fehlt' : null,
  };
}

// Datei gelesen -> Sitzung + Vorschau (Regel Hinzufuegen) | { error }.
function importOpen(db, sessions, { fileName, text }, catalog) {
  const read = readCarddex(text);
  if (!read.ok) return { error: read.text };
  const token = sessions.open({ fileName, rows: read.rows });
  return { token, fileName, preview: previewOf(resolveCarddexRows(read.rows, loadResolveContext(db, catalog), 'add')) };
}

function importResolve(db, sessions, { token, rule } = {}, catalog) {
  const s = sessions.peek(token);
  if (!s) return { error: 'Vorschau abgelaufen – Datei bitte neu öffnen.' };
  return { preview: previewOf(resolveCarddexRows(s.rows, loadResolveContext(db, catalog), rule)) };
}

const errorText = (e) => {
  if (e instanceof copies.ValidationError) return e.message;
  console.error('[import-run]', e);
  return 'Unerwarteter Datenbankfehler.';
};

// Schreibt die aufgeloesten Zeilen in EINER Transaktion. Wirft Error('Import fehlgeschlagen: Zeile N: …'), dann ist nichts
// geaendert. -> { imported, containersCreated, omitted, skipped }
function applyCarddexImport(db, resolved, { omitLines = [] } = {}) {
  const omit = new Set((omitLines || []).map(Number));
  const rule = resolved.summary.rule;
  const todo = resolved.rows.filter((r) => r.action === 'import');
  const insPrinting = db.prepare(`INSERT OR IGNORE INTO cards (id, set_code, language, rarity, name, type, image_url)
                                  VALUES (@id, @set_code, @language, @rarity, @name, @type, @image_url)`);
  const softDelete = db.prepare(`UPDATE card_copies SET deleted = 1, updated_at = CURRENT_TIMESTAMP
                                  WHERE card_id = @id AND set_code = @set_code AND language = @language AND rarity = @rarity AND deleted = 0`);
  const insCopy = db.prepare(`INSERT INTO card_copies
      (copy_id, card_id, set_code, language, rarity, edition, condition, container_id, page, slot, tags, note)
      VALUES (@copy_id, @id, @set_code, @language, @rarity, @edition, @condition, @container_id, @page, @slot, @tags, @note)`);
  let line = null;
  try {
    return db.transaction(() => {
      const open = resolved.rows.find((r) => r.action === 'red' && !omit.has(r.line));
      if (open) { line = open.line; throw new copies.ValidationError('unbekannte Zeile zuerst auslassen'); }
      if (rule === 'replace') {
        const done = new Set();
        for (const r of todo) {
          const key = printingKey(r.printing);
          if (done.has(key)) continue;
          done.add(key);
          line = r.line;
          softDelete.run(r.printing);
        }
      }
      const created = new Map();
      let imported = 0;
      for (const r of todo) {
        line = r.line;
        let containerId = null;
        if (r.container && r.container.create) {
          containerId = created.get(r.container.name)
            ?? copies.saveContainer(db, { name: r.container.name, kind: r.container.kind, pockets_per_page: r.container.pockets_per_page });
          created.set(r.container.name, containerId);
        } else if (r.container) {
          containerId = r.container.container_id;
        }
        if (r.meta) insPrinting.run({ ...r.printing, name: r.meta.name, type: r.meta.type, image_url: r.meta.image_url });
        const copy = {
          ...r.printing, edition: r.edition, condition: r.condition, container_id: containerId, page: r.page, slot: r.slot,
          tags: r.tags.length ? JSON.stringify(r.tags) : null, note: r.note,
        };
        for (let i = 0; i < r.count; i += 1) insCopy.run({ ...copy, copy_id: crypto.randomUUID() });
        imported += r.count;
      }
      return {
        imported, containersCreated: created.size,
        omitted: resolved.rows.filter((r) => r.action === 'red').length,
        skipped: resolved.rows.filter((r) => r.action === 'skip-existing').length,
      };
    })();
  } catch (e) {
    throw new Error(`Import fehlgeschlagen: ${line != null ? `Zeile ${line}: ` : ''}${errorText(e)}`);
  }
}

const importLogName = (now) => `${now.toISOString().slice(0, 19).replace(/:/g, '-')}-carddex.json`;

function writeImportLog(dir, now, entry) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, importLogName(now));
  fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf8');
  return file;
}

// Der ganze Kanal import-run ohne Electron. deps = { catalog, logDir, now: Date, onChanged() }.
function importRun(db, sessions, { token, rule, omitLines } = {}, deps) {
  const session = sessions.take(token);
  if (!session) return { success: false, busy: true, error: 'Dieser Import läuft bereits oder ist abgeschlossen.' };
  const resolved = resolveCarddexRows(session.rows, loadResolveContext(db, deps.catalog), rule);
  let result;
  try {
    result = applyCarddexImport(db, resolved, { omitLines });
  } catch (e) {
    return { success: false, error: e.message };
  }
  const omit = new Set((omitLines || []).map(Number));
  let logFile = null;
  try {
    logFile = writeImportLog(deps.logDir, deps.now, {
      file: session.fileName, at: deps.now.toISOString(), rule: resolved.summary.rule, result,
      rows: resolved.rows.map((r) => ({
        line: r.line, status: r.status, action: r.action === 'red' && omit.has(r.line) ? 'omitted' : r.action,
        reasons: r.reasons, passcode: r.printing.id, set_code: r.printing.set_code, rarity: r.printing.rarity,
        language: r.printing.language, count: r.count, container: r.container ? r.container.name : null,
      })),
    });
  } catch (e) {
    console.error('[import-run] Protokoll nicht geschrieben:', e);
  }
  if (deps.onChanged) deps.onChanged();
  return { success: true, ...result, text: importResultText(result), logFile };
}

module.exports = {
  loadResolveContext, createImportSessions, importOpen, importResolve, applyCarddexImport, importLogName, writeImportLog, importRun,
};
```

- [ ] **Step 4: `desktop/electron/collection-export.cjs` anlegen**

```js
// Spec F1 §4 -- Exporte: Umfang aus der Datenbank laden und die Datei bauen. Das Speichern (Dialog, Schreiben) macht
// main.cjs; die Formatierer stehen in carddex-format.cjs und export-formats.cjs.
const { carddexGroups, writeCarddex } = require('./carddex-format.cjs');
const { dragonShieldCsv, ygoprodeckCsv, cardmarketWantslist, saleListText } = require('./export-formats.cjs');

// Dateiname und Endung je Format; die Beschriftungen fuer den Dialog stehen in src/utils/exportScope.js.
const EXPORT_FORMATS = {
  carddex: { file: 'carddex', ext: 'csv' },
  dragonshield: { file: 'dragonshield', ext: 'csv' },
  ygoprodeck: { file: 'ygoprodeck', ext: 'csv' },
  wantslist: { file: 'wantslist', ext: 'txt' },
  salelist: { file: 'verkaufsliste', ext: 'txt' },
};

// Lebende Exemplare lebender Printings mit Preisfeldern und lebendem Behaelter.
// scope: { kind: 'all' } | { kind: 'container', containerId } | { kind: 'copies', copyIds: string[] }
function loadExportCopies(db, scope = { kind: 'all' }) {
  const rows = db.prepare(`
    SELECT cp.copy_id, cp.card_id, cp.set_code, cp.language, cp.rarity, cp.edition, cp.condition,
           cp.page, cp.slot, cp.tags, cp.note,
           c.name, c.price, c.price_first_ed,
           ct.container_id, ct.name AS container_name, ct.kind AS container_kind, ct.pockets_per_page
      FROM card_copies cp
      JOIN cards c ON c.id = cp.card_id AND c.set_code = cp.set_code AND c.language = cp.language AND c.rarity = cp.rarity
      LEFT JOIN containers ct ON ct.container_id = cp.container_id AND ct.deleted = 0
     WHERE cp.deleted = 0 AND c.deleted = 0
     ORDER BY cp.created_at, cp.copy_id`).all();
  if (scope.kind === 'container') return rows.filter((r) => r.container_id === scope.containerId);
  if (scope.kind === 'copies') {
    const ids = new Set(Array.isArray(scope.copyIds) ? scope.copyIds.map(String) : []);
    return rows.filter((r) => ids.has(r.copy_id));
  }
  return rows;
}

const dateStamp = (now) => now.toISOString().slice(0, 10);

// -> { content, count, omitted, unit: 'copy'|'wish', defaultName, ext }; count = exportierte Exemplare bzw. Wuensche.
// deps = { nameEn(passcode) -> string|null, wishlist: Array|undefined, now: Date }
function buildExport(db, { format, scope } = {}, deps = {}) {
  const f = EXPORT_FORMATS[format];
  if (!f) throw new Error('Unbekanntes Exportformat');
  const now = deps.now || new Date();
  const defaultName = `${f.file}-${dateStamp(now)}.${f.ext}`;
  if (format === 'wantslist') {
    const wishlist = deps.wishlist || [];
    return { content: cardmarketWantslist(wishlist, deps.nameEn), count: wishlist.length, omitted: 0, unit: 'wish', defaultName, ext: f.ext };
  }
  const list = loadExportCopies(db, scope);
  const done = (content, omitted = 0) => ({ content, count: list.length - omitted, omitted, unit: 'copy', defaultName, ext: f.ext });
  if (format === 'carddex') return done(writeCarddex(carddexGroups(list)));
  if (format === 'dragonshield') return done(dragonShieldCsv(list, deps.nameEn));
  if (format === 'ygoprodeck') return done(ygoprodeckCsv(list, deps.nameEn));
  const sale = saleListText(list);
  return done(sale.text, sale.omitted);
}

function exportResultText({ count, omitted, unit }) {
  const noun = unit === 'wish' ? (count === 1 ? 'Wunsch' : 'Wünsche') : (count === 1 ? 'Exemplar' : 'Exemplare');
  const base = `${count} ${noun} exportiert`;
  return omitted > 0 ? `${base} · ${omitted} ${omitted === 1 ? 'Exemplar' : 'Exemplare'} ohne Set-Code weggelassen` : base;
}

module.exports = { EXPORT_FORMATS, loadExportCopies, buildExport, exportResultText };
```

- [ ] **Step 5: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/carddex-import.test.cjs` → `ℹ tests 8`, `ℹ pass 8`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 297`, `ℹ fail 0`.

- [ ] **Step 6: Schutz-Nachweise** (jeweils einzeln sabotieren, Testdatei laufen lassen, zitieren, zurücknehmen)

(a) **Rollback:** in `applyCarddexImport` `    return db.transaction(() => {` kurz zu `    return (() => {` → `✖ Rollback: ein Fehler in Zeile N lässt die Datenbank unverändert und nennt die Zeile` (gemessen, sonst alles grün).
(b) **Soft-Delete:** in der Anweisung `softDelete` den Anfang `UPDATE card_copies SET deleted = 1, updated_at = CURRENT_TIMESTAMP` kurz durch `DELETE FROM card_copies` ersetzen (die `WHERE`-Zeile bleibt) → `✖ Ersetzen löscht nur weich: alte Exemplare bleiben als deleted = 1, Menge folgt der Datei` (gemessen).
(c) **Busy-Schutz:** in `createImportSessions#take` `      sessions.delete(token);` kurz zu `      if (false) sessions.delete(token);` → `✖ Busy-Schutz: ein zweiter Aufruf mit derselben Vorschau importiert nichts` (gemessen).
(d) **quantity nie geschrieben:** `insPrinting` kurz auf `INSERT OR IGNORE INTO cards (id, set_code, language, rarity, name, type, image_url, quantity)` / `VALUES (@id, @set_code, @language, @rarity, @name, @type, @image_url, 0)` ändern → `✖ cards.quantity und cards.deleted schreibt der Import nie (Anweisungen mitgeschnitten)` (gemessen).

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/carddex-import.cjs desktop/electron/collection-export.cjs desktop/electron/carddex-import.test.cjs
git commit -m "feat(f1): Card-Dex-Import in einer Transaktion mit verbrauchter Vorschau-Sitzung und Protokoll; Export-Umfang und Dateibau

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 6: Sync — `cards`-Push in Blöcken zu 500

**Files:**
- Modify: `desktop/electron/sync.cjs`
- Create: `desktop/electron/sync-push-chunks.test.cjs`

**Interfaces:**
- Produces: `upsertCardsInChunks(c, rows) → Promise<[{ id, set_code, language, updated_at }]>` (Blöcke zu `CARDS_PUSH_CHUNK = 500`, Fehler → `Error('Push failed: …')`, kein weiterer Block); Test-Haken `_upsertCardsInChunks`. `push()` verhält sich sonst unverändert (Cursor nach dem letzten Block, Echo-Sperre für alle Zeilen). Einziger Aufrufer von `push()` ist `cycle()`.

- [ ] **Step 1: Test schreiben** — `desktop/electron/sync-push-chunks.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { _upsertCardsInChunks } = require('./sync.cjs');

// Spec F1 §3 -- nach einem grossen Import schiebt der Push die cards-Zeilen in Bloecken zu 500 (wie Exemplare und Behaelter).
function fakeClient({ failOnCall = null } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        upsert(rows, opts) {
          calls.push({ table, rows, opts });
          const n = calls.length;
          return {
            select: async (cols) => {
              if (n === failOnCall) return { data: null, error: { message: 'kaputt' } };
              return { data: rows.map((r) => ({ id: r.id, set_code: r.set_code, language: r.language, updated_at: `ts-${n}`, cols })), error: null };
            },
          };
        },
      };
    },
  };
}
const localRows = (n) => Array.from({ length: n }, (_, i) => ({
  id: String(10000000 + i), set_code: 'LOB-DE001', language: 'DE', rarity: 'Common', name: 'X', quantity: 3, deleted: 0, price: 1,
}));

test('cards-Push in Blöcken zu 500, gespiegelte Spalten ohne quantity, alle Echo-Zeilen zurück', async () => {
  const c = fakeClient();
  const pushed = await _upsertCardsInChunks(c, localRows(1201));
  assert.deepEqual(c.calls.map((x) => [x.table, x.rows.length, x.opts.onConflict]),
    [['cards', 500, 'id,set_code,language,rarity'], ['cards', 500, 'id,set_code,language,rarity'], ['cards', 201, 'id,set_code,language,rarity']]);
  assert.equal(pushed.length, 1201);
  assert.ok(!('quantity' in c.calls[0].rows[0]), 'quantity wird nicht gespiegelt');
  assert.equal(c.calls[0].rows[0].deleted, false);
  assert.equal(pushed[1200].updated_at, 'ts-3');
});

test('cards-Push: ein Fehler im zweiten Block bricht ab, kein dritter Block', async () => {
  const c = fakeClient({ failOnCall: 2 });
  await assert.rejects(_upsertCardsInChunks(c, localRows(1201)), /Push failed: kaputt/);
  assert.equal(c.calls.length, 2);
  assert.deepEqual(await _upsertCardsInChunks(fakeClient(), []), []);
});

// Quelltext-Zaun: push() benutzt den Blockweg und rueckt den Cursor erst danach vor.
test('push() schiebt über upsertCardsInChunks, Cursor danach', () => {
  const src = fs.readFileSync(path.join(__dirname, 'sync.cjs'), 'utf8');
  const start = src.indexOf('async function push(c)');
  const end = src.indexOf('async function pullCopies(', start);
  const body = src.slice(start, end);
  assert.ok(body.includes('await upsertCardsInChunks(c, changed)'), 'push() muss in Blöcken schieben');
  assert.ok(!body.includes(".from('cards')"), 'kein ungeteilter Upsert mehr in push()');
  assert.ok(body.indexOf('upsertCardsInChunks') < body.indexOf("setSetting(db, 'sync_last_push'"));
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/sync-push-chunks.test.cjs` → `✖` in allen drei Tests (`_upsertCardsInChunks is not a function` bzw. `push() muss in Blöcken schieben`).

- [ ] **Step 3: `sync.cjs` ändern** (3 Änderungen, in dieser Reihenfolge; jeder alte Block steht genau einmal in der Datei)

Änderung 1/3 — ersetzen:
```js
// Lokale Sealed-Zeilen seit dem Push-Cursor, ohne die der laufenden Sekunde (Begruendung in push()).
```
durch:
```js
// Spec F1 §3: ein Card-Dex-Import legt auf einen Schlag tausende Printings an. Wie pushCopies/pushContainers in Bloecken
// schieben: kleine Anfragen, und die zurueckgegebenen Zeilen (fuer die Echo-Sperre) bleiben unter der PostgREST-Grenze von
// 1000 Zeilen je Antwort. Ein Fehler bricht ab, bevor der Cursor weiterrueckt -- der naechste Zyklus schiebt alles erneut
// (Upsert, also ohne Doppel).
const CARDS_PUSH_CHUNK = 500;
async function upsertCardsInChunks(c, rows) {
  const pushed = [];
  for (let i = 0; i < rows.length; i += CARDS_PUSH_CHUNK) {
    const { data, error } = await c.from('cards')
      .upsert(rows.slice(i, i + CARDS_PUSH_CHUNK).map(rowToRemote), { onConflict: 'id,set_code,language,rarity' })
      .select('id,set_code,language,updated_at');
    if (error) throw new Error('Push failed: ' + error.message);
    pushed.push(...(data || []));
  }
  return pushed;
}

// Lokale Sealed-Zeilen seit dem Push-Cursor, ohne die der laufenden Sekunde (Begruendung in push()).
```

Änderung 2/3 — ersetzen:
```js
    if (changed.length > 0) {
      const { data, error } = await c.from('cards')
        .upsert(changed.map(rowToRemote), { onConflict: 'id,set_code,language,rarity' })
        .select('id,set_code,language,updated_at');
      if (error) throw new Error('Push failed: ' + error.message);
      const maxTs = changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor);
      setSetting(db, 'sync_last_push', maxTs);
      // Remember the cloud updated_at the trigger stamped on each row we just pushed,
      // so the next pull can recognize its own echo and skip re-applying it.
      for (const r of (data || [])) {
```
durch:
```js
    if (changed.length > 0) {
      const data = await upsertCardsInChunks(c, changed);
      const maxTs = changed.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor);
      setSetting(db, 'sync_last_push', maxTs);
      // Remember the cloud updated_at the trigger stamped on each row we just pushed,
      // so the next pull can recognize its own echo and skip re-applying it.
      for (const r of data) {
```

Änderung 3/3 — ersetzen:
```js
  _sealedPushRows: sealedPushRows,
};
```
durch:
```js
  _sealedPushRows: sealedPushRows,
  // Test-only hook (sync-push-chunks.test.cjs): the chunked cards upsert that push() uses.
  _upsertCardsInChunks: upsertCardsInChunks,
};
```

- [ ] **Step 4: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/sync-push-chunks.test.cjs` → `ℹ pass 3`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 300`, `ℹ fail 0`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` → 16 × `PASS`, Exit-Code 0.

- [ ] **Step 5: Schutz-Nachweis**

`const CARDS_PUSH_CHUNK = 500;` kurz zu `const CARDS_PUSH_CHUNK = Infinity;` → `✖ cards-Push in Blöcken zu 500, gespiegelte Spalten ohne quantity, alle Echo-Zeilen zurück` und `✖ cards-Push: ein Fehler im zweiten Block bricht ab, kein dritter Block` (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/sync.cjs desktop/electron/sync-push-chunks.test.cjs
git commit -m "fix(f1): Sync schiebt cards in Blöcken zu 500 wie Exemplare und Behälter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 7: IPC-Kanäle für Import und Export

**Files:**
- Modify: `desktop/electron/main.cjs`
- Modify: `desktop/electron/preload.cjs`
- Modify: `desktop/electron/ipc-channels.test.cjs`

**Interfaces:**
- Consumes (Task 5): `createImportSessions`, `importOpen`, `importResolve`, `importRun`, `buildExport`, `exportResultText`; vorhanden `readCatalogCards`, `catalogMainId`, `dealsClient`, `recordPortfolioValueSafe`, `CONTAINER_COPY_ERROR_MSG`.
- Produces (für Task 9), Renderer-Brücke:
  - `window.api.importOpen() → { canceled: true } | { error } | { token, fileName, preview }` (Dateidialog im Hauptprozess)
  - `window.api.importResolve({ token, rule }) → { preview } | { error }`
  - `window.api.importRun({ token, rule, omitLines }) → { success: true, text, … } | { success: false, error, busy? }`; sendet danach `collection-changed`
  - `window.api.exportCount({ format, scope }) → { count, error? }`
  - `window.api.exportRun({ format, scope }) → { success: true, text } | { canceled: true } | { success: false, error }` (Speichern-Dialog im Hauptprozess; Fehler „Export fehlgeschlagen: …", leer „Nichts zu exportieren").

- [ ] **Step 1: Test ergänzen** — `desktop/electron/ipc-channels.test.cjs`, Änderung 1/1 — ersetzen:

```js
for (const ch of [...E1_CHANNELS, ...E2_CHANNELS, ...E3_CHANNELS]) {
```
durch:
```js
// Spec F1 §3/§4: Card-Dex-Import (Datei öffnen, Regel wechseln, Übernehmen) und Export (Anzahl, Datei schreiben).
const F1_CHANNELS = ['import-open', 'import-resolve', 'import-run', 'export-count', 'export-run'];

for (const ch of [...E1_CHANNELS, ...E2_CHANNELS, ...E3_CHANNELS, ...F1_CHANNELS]) {
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/ipc-channels.test.cjs` → 5 × `✖ Kanal import-open steht in main.cjs und preload.cjs` usw.

- [ ] **Step 3: `main.cjs`** (2 Änderungen)

Änderung 1/2 — ersetzen:
```js
const { catalogPrices, catalogCards, readCatalogCards, catalogMainId, catalogLegality } = require('./catalog-prices.cjs');
```
durch:
```js
const { catalogPrices, catalogCards, readCatalogCards, catalogMainId, catalogLegality } = require('./catalog-prices.cjs');
const { createImportSessions, importOpen, importResolve, importRun } = require('./carddex-import.cjs');
const { buildExport, exportResultText } = require('./collection-export.cjs');
```

Änderung 2/2 — ersetzen:
```js
ipcMain.handle('get-catalog-legality', () => catalogLegality(userDataPath));
```
durch:
```js
ipcMain.handle('get-catalog-legality', () => catalogLegality(userDataPath));

// --- Spec F1: Export & eigenes Format ---
// Regeln in carddex-format/-resolve/-import.cjs, export-formats.cjs und collection-export.cjs; hier nur Dialoge und Dateien.
const importSessions = createImportSessions();
// Katalogkarte ueber die Artwork-Zuordnung (Name, Typ, Bild der Hauptkarte); ohne Datei null ("Offline-Katalog fehlt").
function importCatalog() {
    const cards = readCatalogCards(userDataPath);
    return cards ? { card: (p) => cards.get(catalogMainId(userDataPath, p)) || null } : null;
}
ipcMain.handle('import-open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Card-Dex-CSV importieren', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    let text;
    try { text = fs.readFileSync(result.filePaths[0], 'utf8'); }
    catch (e) { console.error('[import-open]', e); return { error: 'Datei nicht lesbar' }; }
    try { return importOpen(db, importSessions, { fileName: path.basename(result.filePaths[0]), text }, importCatalog()); }
    catch (e) { console.error('[import-open]', e); return { error: CONTAINER_COPY_ERROR_MSG }; }
});
ipcMain.handle('import-resolve', (event, input) => {
    try { return importResolve(db, importSessions, input, importCatalog()); }
    catch (e) { console.error('[import-resolve]', e); return { error: CONTAINER_COPY_ERROR_MSG }; }
});
// Busy-Schutz am Anfang von importRun: die Vorschau-Sitzung wird verbraucht, ein zweiter Klick findet keine mehr.
ipcMain.handle('import-run', (event, input) => {
    try {
        return importRun(db, importSessions, input, {
            catalog: importCatalog(), logDir: path.join(userDataPath, 'imports'), now: new Date(),
            onChanged: () => {
                recordPortfolioValueSafe();
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('collection-changed');
            },
        });
    } catch (e) { console.error('[import-run]', e); return { success: false, error: `Import fehlgeschlagen: ${CONTAINER_COPY_ERROR_MSG}` }; }
});
// Wunschliste nur fuer die Wantslist (Cloud); englische Namen aus dem Katalog.
async function exportBuild({ format, scope } = {}) {
    const catalog = importCatalog();
    const nameEn = (p) => { const c = catalog && catalog.card(p); return (c && c.name_en) || null; };
    let wishlist;
    if (format === 'wantslist') {
        const c = await dealsClient();
        const { data, error } = await c.from('wishlist').select('card_id, name');
        if (error) throw new Error(error.message);
        wishlist = data || [];
    }
    return buildExport(db, { format, scope }, { nameEn, wishlist, now: new Date() });
}
ipcMain.handle('export-count', async (event, input) => {
    try { return { count: (await exportBuild(input)).count }; }
    catch (e) { return { count: 0, error: e.message }; }
});
ipcMain.handle('export-run', async (event, input) => {
    let built;
    try { built = await exportBuild(input); }
    catch (e) { return { success: false, error: `Export fehlgeschlagen: ${e.message}` }; }
    if (built.count === 0) return { success: false, error: 'Nichts zu exportieren' };
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Exportieren', defaultPath: built.defaultName,
        filters: [{ name: built.ext === 'csv' ? 'CSV' : 'Text', extensions: [built.ext] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    try { fs.writeFileSync(result.filePath, built.content, 'utf8'); }
    catch (e) { return { success: false, error: `Export fehlgeschlagen: ${e.message}` }; }
    return { success: true, text: exportResultText(built) };
});
```

- [ ] **Step 4: `preload.cjs`** — Änderung 1/1 — ersetzen:

```js
  getCatalogLegality: () => ipcRenderer.invoke('get-catalog-legality'),
```
durch:
```js
  getCatalogLegality: () => ipcRenderer.invoke('get-catalog-legality'),
  // Spec F1: Export & eigenes Format
  importOpen: () => ipcRenderer.invoke('import-open'),
  importResolve: (data) => ipcRenderer.invoke('import-resolve', data),
  importRun: (data) => ipcRenderer.invoke('import-run', data),
  exportCount: (data) => ipcRenderer.invoke('export-count', data),
  exportRun: (data) => ipcRenderer.invoke('export-run', data),
```

- [ ] **Step 5: Tests laufen lassen**

Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ tests 305`, `ℹ pass 305`, `ℹ fail 0`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron electron/test-sync.cjs` → 16 × `PASS`, Exit-Code 0.
Run: `node -e "new Function(require('fs').readFileSync('electron/main.cjs','utf8'))"` → keine Ausgabe (Syntax ok).

- [ ] **Step 6: Schutz-Nachweis**

In `preload.cjs` die Zeile `  importRun: (data) => ipcRenderer.invoke('import-run', data),` kurz löschen → `✖ Kanal import-run steht in main.cjs und preload.cjs` (gemessen). Zitieren, zurücknehmen.
Aufrufer-Prüfung im Bericht bestätigen: `readCatalogCards`/`catalogMainId` werden nur gelesen (keine Verhaltensänderung für `get-deck-details`, `create-imported-deck`); `recordPortfolioValueSafe` unverändert; `import-csv` bleibt (F2).

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/main.cjs desktop/electron/preload.cjs desktop/electron/ipc-channels.test.cjs
git commit -m "feat(f1): Kanäle import-open/-resolve/-run und export-count/-run mit Datei-Dialogen und collection-changed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 8: Renderer-Helfer — Export-Umfang und Import-Vorschau

**Files:**
- Create: `desktop/src/utils/exportScope.js`
- Create: `desktop/src/utils/exportScope.test.js`
- Create: `desktop/src/utils/importPreview.js`
- Create: `desktop/src/utils/importPreview.test.js`

**Interfaces:**
- Consumes (vorhanden): `parseTags` (`tags.js`), `printingKey` (`printingKey.js`).
- Produces (für Task 9): `EXPORT_FORMAT_OPTIONS` (value/label je Format), `NOTHING_TO_EXPORT = 'Nichts zu exportieren'`, `filterCopyIds(groups, copiesByPrinting, { lang, rarity, set, condition, edition, containers, tags }) → string[]`, `exportScope(kind: 'all'|'container'|'filter', { containerId, copyIds }) → scope`; `PREVIEW_FILTERS`, `IMPORT_RULES`, `visibleRows(rows, 'all'|'hints'|'unknown')`, `canApply(rows, omitted: Set<number>) → boolean`, `omitAllUnknown(rows) → Set<number>`, `rowLabel(row) → string`.

- [ ] **Step 1: Tests schreiben**

`desktop/src/utils/exportScope.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterCopyIds, exportScope, EXPORT_FORMAT_OPTIONS } from './exportScope.js';
import { printingKey } from './printingKey.js';

const DE = { id: '1', set_code: 'LOB-DE001', language: 'DE', rarity: 'Ultra Rare' };
const EN = { id: '1', set_code: 'LOB-EN001', language: 'EN', rarity: 'Ultra Rare' };
const SDK = { id: '2', set_code: 'SDK-DE001', language: 'DE', rarity: 'Common' };
const copy = (p, copy_id, over = {}) => ({ copy_id, card_id: p.id, set_code: p.set_code, language: p.language, rarity: p.rarity,
  edition: 'unknown', condition: 'NM', container_id: null, tags: null, ...over });
const GROUPS = [{ variants: [DE, EN] }, { variants: [SDK] }];
const COPIES = {
  [printingKey(DE)]: [copy(DE, 'a', { condition: 'EX', container_id: 'b1', tags: '["Tausch"]' }), copy(DE, 'b', { edition: 'first' })],
  [printingKey(EN)]: [copy(EN, 'c', { container_id: 'b1' })],
  [printingKey(SDK)]: [copy(SDK, 'd', { tags: '["tausch","Deck"]' })],
};

test('ohne Filter alle Exemplare der gefilterten Gruppen', () => {
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, {}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(filterCopyIds([GROUPS[1]], COPIES), ['d'], 'nur Gruppen, die die Liste zeigt');
  assert.deepEqual(filterCopyIds(null, null), []);
});

test('Printing-Filter: Sprache, Seltenheit, Set-Kürzel', () => {
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { lang: 'DE' }), ['a', 'b', 'd']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { rarity: 'Common' }), ['d']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { set: 'LOB' }), ['a', 'b', 'c']);
});

test('Exemplar-Filter: Zustand, Edition, Behälter, Tags (ohne Groß/Klein)', () => {
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { condition: 'EX' }), ['a']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { edition: 'first' }), ['b']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { containers: ['b1'] }), ['a', 'c']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { tags: ['TAUSCH'] }), ['a', 'd']);
  assert.deepEqual(filterCopyIds(GROUPS, COPIES, { lang: 'DE', containers: ['b1'], tags: ['Tausch'] }), ['a']);
});

test('Umfang für den Hauptprozess und Formatliste', () => {
  assert.deepEqual(exportScope('all'), { kind: 'all' });
  assert.deepEqual(exportScope('container', { containerId: 'b1' }), { kind: 'container', containerId: 'b1' });
  assert.deepEqual(exportScope('filter', { copyIds: ['a'] }), { kind: 'copies', copyIds: ['a'] });
  assert.deepEqual(EXPORT_FORMAT_OPTIONS.map((o) => o.value), ['carddex', 'dragonshield', 'ygoprodeck', 'wantslist', 'salelist']);
});
```

`desktop/src/utils/importPreview.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleRows, canApply, omitAllUnknown, rowLabel, PREVIEW_FILTERS, IMPORT_RULES } from './importPreview.js';

const P = { id: '46986414', set_code: 'LOB-DE005', language: 'DE', rarity: 'Ultra Rare' };
const ROWS = [
  { line: 2, status: 'green', action: 'import', printing: P, name: 'Dunkler Magier', count: 2, edition: 'first', condition: 'NM', container: { name: 'Binder Blau' }, page: 1, slot: 3 },
  { line: 3, status: 'yellow', action: 'import', printing: P, name: '', count: 1, edition: 'unknown', condition: 'EX', container: { name: 'Box' }, page: null, slot: null },
  { line: 4, status: 'red', action: 'red', printing: { ...P, id: '1' }, name: 'X', count: null, edition: 'x', condition: 'y', container: null, page: null, slot: null },
];

test('Filter Alle / Hinweise / Unbekannt', () => {
  assert.deepEqual(visibleRows(ROWS, 'all').map((r) => r.line), [2, 3, 4]);
  assert.deepEqual(visibleRows(ROWS, 'hints').map((r) => r.line), [3]);
  assert.deepEqual(visibleRows(ROWS, 'unknown').map((r) => r.line), [4]);
  assert.deepEqual(visibleRows(null, 'all'), []);
  assert.deepEqual(PREVIEW_FILTERS.map((f) => f.label), ['Alle', 'Hinweise', 'Unbekannt']);
  assert.deepEqual(IMPORT_RULES.map((f) => f.value), ['add', 'replace', 'skip']);
});

test('Übernehmen erst, wenn alle roten Zeilen ausgelassen sind und etwas übrig bleibt', () => {
  assert.equal(canApply(ROWS, new Set()), false);
  assert.equal(canApply(ROWS, new Set([4])), true);
  assert.deepEqual([...omitAllUnknown(ROWS)], [4]);
  assert.equal(canApply([ROWS[2]], new Set([4])), false, 'nur ausgelassene Zeilen');
  assert.equal(canApply(ROWS.map((r) => (r.action === 'import' ? { ...r, action: 'skip-existing' } : r)), new Set([4])), false, 'alles übersprungen');
});

test('Zeilentext', () => {
  assert.equal(rowLabel(ROWS[0]), 'Dunkler Magier · LOB-DE005 · Ultra Rare · DE · 2× · first/NM · Binder Blau · S1 · F3');
  assert.equal(rowLabel(ROWS[1]), '46986414 · LOB-DE005 · Ultra Rare · DE · 1× · unknown/EX · Box');
  assert.equal(rowLabel(ROWS[2]), 'X · LOB-DE005 · Ultra Rare · DE · x/y');
});
```

- [ ] **Step 2: Fehlschlag bestätigen**

Run: `node --test src/utils/exportScope.test.js src/utils/importPreview.test.js` → FAIL mit `Cannot find module …/exportScope.js` bzw. `…/importPreview.js`.

- [ ] **Step 3: `desktop/src/utils/exportScope.js` anlegen**

```js
// Spec F1 §4 -- Export-Dialog: Formate, Umfang und "Aktueller Filter" der Sammlung als Exemplar-IDs.
// Die Sammlungsliste filtert Gruppen (ein Passcode, mehrere Printings); exportiert werden nur die Exemplare, die auch die
// Printing-Filter (Sprache, Seltenheit, Set) und die Exemplar-Filter (Zustand, Edition, Behälter, Tags) erfüllen.
import { parseTags } from './tags.js';
import { printingKey } from './printingKey.js';

export const EXPORT_FORMAT_OPTIONS = [
  { value: 'carddex', label: 'Card Dex (CSV)' },
  { value: 'dragonshield', label: 'Dragon Shield (CSV)' },
  { value: 'ygoprodeck', label: 'YGOPRODeck (CSV)' },
  { value: 'wantslist', label: 'Cardmarket-Wantslist (Text)' },
  { value: 'salelist', label: 'Verkaufsliste (Text)' },
];
export const NOTHING_TO_EXPORT = 'Nichts zu exportieren';

const ALL = 'All';
const setOf = (code) => String(code || '').split('-')[0];

// groups: gefilterte Gruppen der Sammlungsliste ({ variants: [cards-Zeile] }); copiesByPrinting: printingKey -> Exemplare;
// filters: { lang, rarity, set, condition, edition, containers: string[], tags: string[] } ('All'/leer = kein Filter).
export function filterCopyIds(groups, copiesByPrinting, filters = {}) {
  const f = { lang: ALL, rarity: ALL, set: ALL, condition: ALL, edition: ALL, containers: [], tags: [], ...filters };
  const wantedTags = f.tags.map((t) => t.toLowerCase());
  const ids = [];
  for (const g of groups || []) {
    for (const v of g.variants || []) {
      if (f.lang !== ALL && v.language !== f.lang) continue;
      if (f.rarity !== ALL && v.rarity !== f.rarity) continue;
      if (f.set !== ALL && setOf(v.set_code) !== f.set) continue;
      for (const cp of (copiesByPrinting && copiesByPrinting[printingKey(v)]) || []) {
        if (f.condition !== ALL && cp.condition !== f.condition) continue;
        if (f.edition !== ALL && cp.edition !== f.edition) continue;
        if (f.containers.length > 0 && !f.containers.includes(cp.container_id)) continue;
        if (wantedTags.length > 0 && !parseTags(cp.tags).some((t) => wantedTags.includes(t.toLowerCase()))) continue;
        ids.push(cp.copy_id);
      }
    }
  }
  return ids;
}

// Umfang fuer den Hauptprozess (collection-export.cjs#loadExportCopies).
export function exportScope(kind, { containerId = null, copyIds = [] } = {}) {
  if (kind === 'container') return { kind: 'container', containerId };
  if (kind === 'filter') return { kind: 'copies', copyIds };
  return { kind: 'all' };
}
```

- [ ] **Step 4: `desktop/src/utils/importPreview.js` anlegen**

```js
// Spec F1 §3 -- Vorschau-Regeln im Renderer: Filter Alle/Hinweise/Unbekannt, Auslassen roter Zeilen, wann "Übernehmen"
// aktiv ist. Die Zeilen selbst löst der Hauptprozess auf (electron/carddex-resolve.cjs).
export const PREVIEW_FILTERS = [
  { value: 'all', label: 'Alle' },
  { value: 'hints', label: 'Hinweise' },
  { value: 'unknown', label: 'Unbekannt' },
];
export const IMPORT_RULES = [
  { value: 'add', label: 'Hinzufügen' },
  { value: 'replace', label: 'Ersetzen' },
  { value: 'skip', label: 'Überspringen' },
];

export function visibleRows(rows, filter) {
  const list = Array.isArray(rows) ? rows : [];
  if (filter === 'hints') return list.filter((r) => r.status === 'yellow');
  if (filter === 'unknown') return list.filter((r) => r.status === 'red');
  return list;
}

// omitted: Set der ausgelassenen Zeilennummern. Aktiv erst, wenn jede rote Zeile ausgelassen ist und etwas übrig bleibt.
export function canApply(rows, omitted) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.some((r) => r.status === 'red' && !omitted.has(r.line))) return false;
  return list.some((r) => r.action === 'import');
}

export function omitAllUnknown(rows) {
  return new Set((Array.isArray(rows) ? rows : []).filter((r) => r.status === 'red').map((r) => r.line));
}

// Eine Zeile der Liste, z. B. "Dunkler Magier · LOB-DE005 · Ultra Rare · DE · 2× · first/NM · Binder Blau · S1 · F3".
export function rowLabel(r) {
  const where = r.container ? [r.container.name, r.page != null ? `S${r.page} · F${r.slot}` : null].filter(Boolean).join(' · ') : null;
  return [r.name || r.printing.id, r.printing.set_code, r.printing.rarity, r.printing.language,
    r.count != null ? `${r.count}×` : null, `${r.edition}/${r.condition}`, where].filter(Boolean).join(' · ');
}
```

- [ ] **Step 5: Tests und Lint**

Run: `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ tests 249`, `ℹ pass 249`.
Run: `npx eslint .` → `5 errors`.

- [ ] **Step 6: Schutz-Nachweis**

In `canApply` die Zeile `  if (list.some((r) => r.status === 'red' && !omitted.has(r.line))) return false;` kurz löschen → `✖ Übernehmen erst, wenn alle roten Zeilen ausgelassen sind und etwas übrig bleibt` (gemessen). Zitieren, zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/utils/exportScope.js desktop/src/utils/exportScope.test.js desktop/src/utils/importPreview.js desktop/src/utils/importPreview.test.js
git commit -m "feat(f1): Renderer-Helfer für Export-Umfang (aktueller Filter) und Import-Vorschau

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 9: Oberfläche — Import- und Export-Dialog, Einstellungen › Daten, Sammlung

**Files:**
- Create: `desktop/src/components/ImportDialog.jsx`
- Create: `desktop/src/components/ExportDialog.jsx`
- Modify: `desktop/src/components/Settings.jsx`
- Modify: `desktop/src/components/CollectionList.jsx`

**Interfaces:**
- Consumes: Task 7 (`window.api.importOpen/importResolve/importRun/exportCount/exportRun`, vorhanden `listContainers`), Task 8 (Helfer).
- Produces: `<ImportDialog opened onClose />` (`opened` = Antwort von `importOpen()`; der Aufrufer öffnet den Dateidialog VOR dem Einhängen — StrictMode hängt Effekte doppelt ein, ein Dateidialog im Effekt käme zweimal); `<ExportDialog onClose filterCopyIds? />` (`filterCopyIds` = Array → Umfang „Aktueller Filter" vorausgewählt, `null` → „Ganze Sammlung").

- [ ] **Step 1: `desktop/src/components/ImportDialog.jsx` anlegen**

```jsx
import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { List } from 'react-window';
import { PREVIEW_FILTERS, IMPORT_RULES, visibleRows, canApply, omitAllUnknown, rowLabel } from '../utils/importPreview';

const DOT = { green: 'bg-good', yellow: 'bg-gold', red: 'bg-crit' };

// Eine Zeile der virtualisierten Vorschau (react-window 2: Props kommen über rowProps).
function PreviewRow({ index, style, rows, omitted, toggleOmit }) {
  const r = rows[index];
  return (
    <div style={style} className="flex items-center gap-2 px-2 border-b border-line/50 text-xs">
      <span className={clsx('w-2 h-2 rounded-full shrink-0', DOT[r.status])} />
      <span className="font-mono text-ink-faint w-10 shrink-0">Z. {r.line}</span>
      <div className="min-w-0 flex-1">
        <div className={clsx('truncate', omitted.has(r.line) ? 'text-ink-faint line-through' : 'text-ink')}>{rowLabel(r)}</div>
        {r.reasons.length > 0 && <div className="truncate text-ink-muted">{r.reasons.join(' · ')}</div>}
      </div>
      {r.status === 'red' && (
        <button type="button" onClick={() => toggleOmit(r.line)} className="px-2 py-1 rounded bg-obsidian border border-line text-ink-muted hover:text-ink shrink-0">
          {omitted.has(r.line) ? 'Zurücknehmen' : 'Auslassen'}
        </button>
      )}
    </div>
  );
}

// Spec F1 §3 — Card-Dex-Import: Vorschau mit Ampel, Regel für Bestehendes, Übernehmen.
// opened: Antwort von window.api.importOpen() ({ token, fileName, preview } oder { error }); den Dateidialog öffnet der
// Aufrufer, bevor er diesen Dialog zeigt (kein Seiteneffekt beim Einhängen, StrictMode hängt Effekte doppelt ein).
export default function ImportDialog({ opened, onClose }) {
  const [phase, setPhase] = useState(opened.error ? 'done' : 'preview'); // preview | running | done
  const [preview, setPreview] = useState(opened.preview || null);
  const [rule, setRule] = useState('add');
  const [filter, setFilter] = useState('all');
  const [omitted, setOmitted] = useState(new Set());
  const [error, setError] = useState(opened.error || null);
  const [result, setResult] = useState(null);
  const { token, fileName } = opened;

  const changeRule = async (next) => {
    setRule(next);
    const res = await window.api.importResolve({ token, rule: next });
    if (res.error) setError(res.error); else setPreview(res.preview);
  };

  const toggleOmit = (line) => setOmitted((prev) => {
    const next = new Set(prev);
    if (next.has(line)) next.delete(line); else next.add(line);
    return next;
  });

  const rows = useMemo(() => visibleRows(preview?.rows, filter), [preview, filter]);
  const ready = preview && canApply(preview.rows, omitted);

  const apply = async () => {
    if (phase !== 'preview' || !ready) return;
    setPhase('running');
    setError(null);
    try {
      const res = await window.api.importRun({ token, rule, omitLines: [...omitted] });
      if (res.success) setResult(res.text); else setError(res.error);
    } catch (e) {
      setError(`Import fehlgeschlagen: ${e.message || e}`);
    }
    setPhase('done');
  };

  const busy = phase === 'running';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-obsidian-700 border border-line rounded-2xl p-6 gap-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">Importieren{fileName && ` – ${fileName}`}</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        {preview && phase !== 'done' && (
          <>
            <p className="font-mono text-sm text-ink">{preview.headerText}</p>
            {preview.catalogText && <p className="text-sm text-gold">{preview.catalogText}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-faint uppercase tracking-wide">Bestehendes</span>
              {IMPORT_RULES.map((o) => (
                <button key={o.value} type="button" onClick={() => changeRule(o.value)} disabled={busy}
                  className={clsx('px-3 py-1 rounded-lg text-xs border', rule === o.value ? 'bg-space-violet text-white border-space-violet' : 'bg-obsidian border-line text-ink-muted hover:text-ink')}>
                  {o.label}
                </button>
              ))}
            </div>
            {preview.warningText && <p className="text-sm text-crit">{preview.warningText}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {PREVIEW_FILTERS.map((o) => (
                <button key={o.value} type="button" onClick={() => setFilter(o.value)}
                  className={clsx('px-3 py-1 rounded-full text-xs border', filter === o.value ? 'bg-space-violet/20 border-space-violet/50 text-ink' : 'bg-obsidian border-line text-ink-muted hover:text-ink')}>
                  {o.label}
                </button>
              ))}
              {preview.summary.red > 0 && (
                <button type="button" onClick={() => setOmitted(omitAllUnknown(preview.rows))} className="ml-auto text-xs text-ink-muted hover:text-ink">
                  Alle unbekannten auslassen
                </button>
              )}
            </div>
            <div className="h-[45vh] border border-line rounded-xl overflow-hidden">
              <List rowComponent={PreviewRow} rowCount={rows.length} rowHeight={44} rowProps={{ rows, omitted, toggleOmit }} />
            </div>
          </>
        )}

        {result && <p className="text-sm text-good">{result}</p>}
        {error && <p className="text-sm text-crit">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">
            {phase === 'done' ? 'Schließen' : 'Abbrechen'}
          </button>
          {phase !== 'done' && (
            <button type="button" onClick={apply} disabled={busy || !ready}
              className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium disabled:opacity-50">
              {phase === 'running' ? 'Wird importiert…' : 'Übernehmen'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `desktop/src/components/ExportDialog.jsx` anlegen**

```jsx
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import CustomSelect from './CustomSelect';
import { EXPORT_FORMAT_OPTIONS, NOTHING_TO_EXPORT, exportScope } from '../utils/exportScope';

// Spec F1 §4 — Export: Format und Umfang wählen, dann Speichern-Dialog im Hauptprozess.
// filterCopyIds: Exemplar-IDs des aktuellen Sammlungsfilters oder null (dann gibt es den Umfang "Aktueller Filter" nicht).
export default function ExportDialog({ onClose, filterCopyIds = null }) {
  const [format, setFormat] = useState('carddex');
  const [scopeKind, setScopeKind] = useState(filterCopyIds ? 'filter' : 'all');
  const [containers, setContainers] = useState([]);
  const [containerId, setContainerId] = useState(null);
  const [count, setCount] = useState(null); // null = wird gezählt
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);   // { ok, text }

  useEffect(() => {
    window.api.listContainers().then((list) => {
      setContainers(list || []);
      if (list && list.length) setContainerId(list[0].container_id);
    }).catch(() => setContainers([]));
  }, []);

  const wants = format === 'wantslist';
  const scope = exportScope(scopeKind, { containerId, copyIds: filterCopyIds || [] });

  useEffect(() => {
    let alive = true;
    setCount(null);
    window.api.exportCount({ format, scope }).then((res) => {
      if (!alive) return;
      setCount(res.count);
      if (res.error) setNote({ ok: false, text: res.error });
    });
    return () => { alive = false; };
    // scope ist bei jedem Rendern ein neues Objekt; gezählt wird nur, wenn sich seine Teile ändern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, scopeKind, containerId, filterCopyIds]);

  const run = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await window.api.exportRun({ format, scope });
      if (res.success) setNote({ ok: true, text: res.text });
      else if (res.error) setNote({ ok: false, text: res.error });
    } catch (e) {
      setNote({ ok: false, text: `Export fehlgeschlagen: ${e.message || e}` });
    }
    setBusy(false);
  };

  const scopeOptions = [
    { value: 'all', label: 'Ganze Sammlung' },
    ...(filterCopyIds ? [{ value: 'filter', label: 'Aktueller Filter' }] : []),
    ...(containers.length ? [{ value: 'container', label: 'Ein Behälter' }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-obsidian-700 border border-line rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-ink">Exportieren</h3>
          <button type="button" onClick={onClose} disabled={busy} className="text-ink-faint hover:text-ink"><X className="w-4 h-4" /></button>
        </div>
        <label className="block text-xs text-ink-muted">Format
          <CustomSelect value={format} onChange={setFormat} options={EXPORT_FORMAT_OPTIONS} className="mt-1 w-full" />
        </label>
        {wants ? (
          <p className="text-sm text-ink-muted">Umfang: Wunschliste</p>
        ) : (
          <>
            <label className="block text-xs text-ink-muted">Umfang
              <CustomSelect value={scopeKind} onChange={setScopeKind} options={scopeOptions} className="mt-1 w-full" />
            </label>
            {scopeKind === 'container' && (
              <label className="block text-xs text-ink-muted">Behälter
                <CustomSelect value={containerId} onChange={setContainerId}
                  options={containers.map((c) => ({ value: c.container_id, label: c.name }))} className="mt-1 w-full" />
              </label>
            )}
          </>
        )}
        <p className="text-sm text-ink-muted">{count == null ? '…' : count === 0 ? NOTHING_TO_EXPORT : `${count} ${wants ? (count === 1 ? 'Wunsch' : 'Wünsche') : (count === 1 ? 'Exemplar' : 'Exemplare')}`}</p>
        {note && <p className={`text-sm ${note.ok ? 'text-good' : 'text-crit'}`}>{note.text}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Schließen</button>
          <button type="button" onClick={run} disabled={busy || !count}
            className="px-4 py-2 rounded-lg bg-space-violet hover:bg-space-violet-dark text-white text-sm font-medium disabled:opacity-50">
            {busy ? 'Wird exportiert…' : 'Speichern…'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `Settings.jsx`** (4 Änderungen, in dieser Reihenfolge)

Änderung 1/4 — ersetzen:
```jsx
import PriceAlertSettings from './PriceAlertSettings';
```
durch:
```jsx
import PriceAlertSettings from './PriceAlertSettings';
import ImportDialog from './ImportDialog';
import ExportDialog from './ExportDialog';
```

Änderung 2/4 — ersetzen:
```jsx
    const [modelResult, setModelResult] = useState(null); // { ok, text }
```
durch:
```jsx
    const [modelResult, setModelResult] = useState(null); // { ok, text }
    const [importOpened, setImportOpened] = useState(null); // Spec F1: Antwort von importOpen() solange die Vorschau offen ist
    const [exportOpen, setExportOpen] = useState(false);
```

Änderung 3/4 — ersetzen:
```jsx
    const handleBuildCatalog = async () => {
```
durch:
```jsx
    // Spec F1 §3: erst der Dateidialog im Hauptprozess, dann die Vorschau (abgebrochen: nichts).
    const handleImport = async () => {
        if (!window.api) return;
        const res = await window.api.importOpen();
        if (res && !res.canceled) setImportOpened(res);
    };

    const handleBuildCatalog = async () => {
```

Änderung 4/4 — ersetzen:
```jsx
                                <p className="text-sm text-space-violet/60 group-hover:text-space-violet">Führt alte 'Unknown'-Karten mit den passenden Sets zusammen, um doppelte Wertanzeige zu vermeiden.</p>
                            </button>
                        </div>
                    </div>
```
durch:
```jsx
                                <p className="text-sm text-space-violet/60 group-hover:text-space-violet">Führt alte 'Unknown'-Karten mit den passenden Sets zusammen, um doppelte Wertanzeige zu vermeiden.</p>
                            </button>

                            <button
                                onClick={handleImport}
                                className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group"
                            >
                                <div className="flex items-center text-ink mb-2">
                                    <FileUp className="w-5 h-5 mr-2" />
                                    <h4 className="font-bold">Importieren…</h4>
                                </div>
                                <p className="text-sm text-ink-muted group-hover:text-ink">Liest eine Card-Dex-CSV mit Vorschau ein – Exemplare, Behälter, Seite/Fach, Tags und Notizen.</p>
                            </button>

                            <button
                                onClick={() => setExportOpen(true)}
                                className="p-4 bg-obsidian/50 hover:bg-obsidian rounded-xl border border-line hover:border-space-violet/50 transition-all text-left group"
                            >
                                <div className="flex items-center text-ink mb-2">
                                    <Download className="w-5 h-5 mr-2" />
                                    <h4 className="font-bold">Exportieren…</h4>
                                </div>
                                <p className="text-sm text-ink-muted group-hover:text-ink">Card Dex, Dragon Shield, YGOPRODeck, Cardmarket-Wantslist oder Verkaufsliste.</p>
                            </button>
                        </div>
                        {importOpened && <ImportDialog opened={importOpened} onClose={() => setImportOpened(null)} />}
                        {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
                    </div>
```

`FileUp` und `Download` sind in `Settings.jsx` schon importiert.

- [ ] **Step 4: `CollectionList.jsx`** (5 Änderungen, in dieser Reihenfolge)

Änderung 1/5 — ersetzen:
```jsx
import { Search, LayoutGrid, List as ListIcon, FilterX, SlidersHorizontal, Coins, X, AlertCircle } from 'lucide-react';
```
durch:
```jsx
import { Search, LayoutGrid, List as ListIcon, FilterX, SlidersHorizontal, Coins, X, AlertCircle, Download } from 'lucide-react';
```

Änderung 2/5 — ersetzen:
```jsx
import { printingKey } from '../utils/printingKey';
```
durch:
```jsx
import { printingKey } from '../utils/printingKey';
import ExportDialog from './ExportDialog';
import { filterCopyIds } from '../utils/exportScope';
```

Änderung 3/5 — ersetzen:
```jsx
  const [cmStatus, setCmStatus] = useState(null); // { lastRun, resolvedCount, unresolvedCount }
```
durch:
```jsx
  const [cmStatus, setCmStatus] = useState(null); // { lastRun, resolvedCount, unresolvedCount }
  const [exportCopyIds, setExportCopyIds] = useState(null); // Spec F1 §4: offen = Exemplar-IDs des aktuellen Filters
```

Änderung 4/5 — ersetzen:
```jsx
  const toggleContainerFilter = (id) => setFilterContainers(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
```
durch:
```jsx
  // Spec F1 §4: der Export-Dialog bekommt den aktuellen Filter als Exemplar-IDs (Stand beim Öffnen).
  const openExport = () => setExportCopyIds(filterCopyIds(filtered, copiesByPrinting, {
    lang: filterLang, rarity: filterRarity, set: filterSet, condition: filterCondition, edition: filterEdition,
    containers: filterContainers, tags: filterTags,
  }));

  const toggleContainerFilter = (id) => setFilterContainers(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
```

Änderung 5/5 — ersetzen:
```jsx
                <div className="relative">
                    <button onClick={() => setPricesOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-obsidian-700 border border-line text-ink-muted hover:text-ink">
```
durch:
```jsx
                <button onClick={openExport} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-obsidian-700 border border-line text-ink-muted hover:text-ink">
                    <Download className="w-4 h-4" /> Exportieren…
                </button>
                {exportCopyIds && <ExportDialog filterCopyIds={exportCopyIds} onClose={() => setExportCopyIds(null)} />}
                <div className="relative">
                    <button onClick={() => setPricesOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-obsidian-700 border border-line text-ink-muted hover:text-ink">
```

- [ ] **Step 5: Lint, Helfer, Build, Suite**

Run: `npx eslint .` → `✖ 8 problems (5 errors, 3 warnings)` (dieselben fünf wie auf `102d3c6`).
Run: `node --test src/utils/*.test.js src/utils/*.test.mjs` → `ℹ pass 249`.
Run: `npx vite build` → `✓ built in …`.
Run: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/*.test.cjs` → `ℹ pass 305`.

- [ ] **Step 6: Kein neuer Schutz-Test**

Die Oberfläche trifft keine Regel selbst (Übernehmen-Sperre: `canApply`, Task 8; Busy-Schutz: `importRun`, Task 5). Geprüft wird sie in der Abnahme (Spec §8).

- [ ] **Step 7: Commit**

```bash
git add desktop/src/components/ImportDialog.jsx desktop/src/components/ExportDialog.jsx desktop/src/components/Settings.jsx desktop/src/components/CollectionList.jsx
git commit -m "feat(f1): Import-Vorschau und Export-Dialog in Einstellungen › Daten, Exportieren aus der Sammlung mit aktuellem Filter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
## Abnahme (Nutzer, Spec §8)

1. Einstellungen › Daten › „Exportieren…" › Card Dex (CSV) › Ganze Sammlung → Datei speichern; Meldung „N Exemplare exportiert".
2. Datei im Texteditor und in Excel öffnen: Umlaute korrekt, 16 Spalten, Behälter/Seite/Fach/Tags/Notizen.
3. Test-Datenbank nach Offenem Punkt 17: sichern, Sync aus, „Speicherort verschieben“ (Kopie), „Importieren…“ mit *Ersetzen*: Kopfzeile und Warnung prüfen, Übernehmen, Anzahl und Standorte vergleichen; zurück über das Löschen von `config.json` bei geschlossener App, Sync wieder an.
4. In der echten Sammlung eine kleine bearbeitete Datei mit *Hinzufügen* und *Ersetzen* importieren (je eine unbekannte Passcode-Zeile, eine ungültige Menge, ein neuer Behälter, ein belegtes Fach); Warnung bei *Ersetzen* lesen; rote Zeilen auslassen; Protokoll unter `%APPDATA%/…/imports/` ansehen.
5. Verkaufsliste und Wantslist exportieren und in Kleinanzeigen bzw. Cardmarket einfügen; Dragon Shield CSV testweise in Dragon Shield importieren (Offener Punkt 2).
6. Am Handy nach dem nächsten Sync prüfen, dass importierte Exemplare, Printings und Behälter da sind.
