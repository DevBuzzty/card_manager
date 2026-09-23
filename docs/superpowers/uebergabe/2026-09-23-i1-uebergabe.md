# Übergabe I1 — Neustruktur und Gestaltung (Stand 23.09.2026)

Diese Notiz ist für die Fortsetzung auf einem anderen Rechner. Das Arbeits-Ledger und die Sitzungsnotizen liegen nur auf dem Heim-PC; alles Nötige steht hier.

## Wo die Arbeit steht

- **Zweig:** `feat/i1-struktur-gestaltung` (auf origin). **Nicht** in `main` gemergt — die Abnahme am Gerät steht aus.
- **Spec:** `docs/superpowers/specs/2026-09-22-spec-i-neustruktur-und-gestaltung.md`
- **Plan:** `docs/superpowers/plans/2026-09-22-spec-i1-struktur-und-gestaltung.md` (11 Aufgaben)
- **Entwürfe:** `docs/superpowers/mockups/design-richtungen.html` (gewählt: „Katalog“, hell als Vorgabe)

| Aufgabe | Inhalt | Stand |
|---|---|---|
| 1 | Farbrollen als gemeinsame Token-Datei `docs/fixtures/design/tokens.json` | fertig, geprüft |
| 2 | PC: CSS-Variablen, Umschalter Hell/Dunkel/System | fertig, geprüft |
| 3 | PC: Seitenleiste in vier Gruppen, Verkaufen und Decks eigenständig, Weiterleitungen | fertig, geprüft |
| 4 | PC: Verkaufen mit Kandidaten, Zum Verkauf, Angebote, Verkäufe | fertig, geprüft |
| 5 | PC: Kartenliste ohne Chip-Wand, gespeicherte Filter | fertig, geprüft |
| 6 | PC: Unbekannte bei Scannen, Zähler in der Leiste | fertig, geprüft |
| 7 | PC: alle Bildschirme auf Farbrollen, Wächter-Test | fertig, geprüft |
| 8 | Handy: Farbrollen, zwei Schemata, Umschalter | fertig, geprüft |
| 9 | Handy: vier Ziele + Scan-Knopf, Verkaufen, Decks über Start | fertig, geprüft |
| 10 | Handy: Filter-Voreinstellungen als Zwilling | fertig, geprüft |
| — | Abschlussreview über den ganzen Zweig, Fixwelle (849a58e, 71ed8bd, 4a0668d), Restrunde (95882ed, cf947ff), letzte Korrekturen (228d457) | fertig, nachgeprüft |
| 11 | Bauen, aufspielen, Abnahme am Gerät | **offen** |

Letzter Prüfstand (auf 228d457): Helfer-Tests 355/355, SQLite 480/480, ESLint genau 5 (Altlast), `vite build` ok, Android 758 Tests grün, APK gebaut. Die App läuft auf dem Entwicklungs-Handy (P30 Pro, 360 dp) ohne Absturz; weiter als bis zur Anmeldung ist dort noch niemand gekommen.

## Was als Nächstes zu tun ist

1. **Aufgabe 11:** PC-Installer bauen (`cd desktop && npm run dist`, Ergebnis in `desktop/dist-electron/`), im gebauten `app.asar` prüfen, dass der Kanal `nav-counts` enthalten ist, installieren. APK aufs Handy.
2. **Abnahme** nach Spec §8, Punkte 1, 2, 3, 7, 8, 9, 10 (die Punkte 4–6 gehören zu I2).
3. Danach Merge in `main` und Push — erst nach bestandener Abnahme.
4. Anschließend **I2** planen: Exemplarzeile, Exemplar-Dialog, Verkaufsweg mit drei Wegen (Spec §4, §5).

### Einrichtung auf einem neuen Rechner

- `cd desktop && npm install`, danach `npx @electron/rebuild -f -w better-sqlite3 -v 40.1.0` (sonst schlagen die SQLite-Tests mit ABI-Fehler fehl).
- Die Sammlung kommt über die Cloud-Anmeldung, nicht aus einer lokalen Datei.
- Android: `ANDROID_HOME` auf das SDK setzen; `android/local.properties` gehört nicht ins Repo und darf nicht mitcommittet werden.

### Beim Merge beachten

Im Haupt-Checkout des Heim-PCs liegt eine **unkommittete** Änderung an der Spec (`accent-fg` dunkel `#0f1013`). Dieselbe Änderung ist im Zweig enthalten. Vor dem Merge dort verwerfen (`git checkout -- docs/superpowers/specs/2026-09-22-spec-i-neustruktur-und-gestaltung.md`), sonst bricht der Merge ab.

## Worauf die Abnahme gezielt achten sollte

- Hell **und** Dunkel auf jedem Bereich einmal öffnen (PC und Handy).
- Verkaufen: die vier Stationen mit Anzahlen; Verkäufe **nicht** mehr unter Insights.
- Kartenliste: keine Chip-Zeile; „Unvollständige Daten“ und „Nur Foils“ im Filterbereich, entfernbar.
- Scannen: unbekannte Karten als Liste, einzeln öffnen und Set wählen; Sammelaktionen.
- Zähler an Scannen und Verkaufen ziehen nach eigenen Aktionen sofort nach.
- Handy: vier Ziele passen bei 360 dp (am P30 Pro bereits gesehen: passt); Start-Kacheln öffnen den richtigen Verkaufen-Reiter; Herunterziehen aktualisiert Verkaufen und Decks.
- Handy-Dialoge und Auswahlblätter ohne Lavendel-Töne; gewählte Filter-Chips noch unterscheidbar.
- Handy: gewählte Filter-Chips, aktive Filter und Tags im Exemplar-Dialog sind voll violett (am PC nur getönt) — bewusst so, damit der Zustand erkennbar ist; bei Nichtgefallen in `Theme.kt` `secondaryContainer` ändern.
- Handy-Scanner: Karten-Info-Knopf ist ruhig grau statt violett; auf dem Kamerabild prüfen, ob er gut sichtbar ist.
- Zahlen an den Verkaufen-Reitern zeigen genau, was die Liste im Standardzustand zeigt (Verkäufe: aktueller Monat samt Stornos); das Leisten-Abzeichen „Verkaufen“ zählt dagegen, was auf dich wartet (vorgemerkt ohne Angebot + aktive Angebote).
- Preise sind nicht mehr golden, sondern Textfarbe — so gewollt (Spec §6.2 Regel 4).
- Die Start-Kachel „Fehlende Daten“ zählt jetzt nach Set-Code, Seltenheit und Preis (nicht mehr nach ATK/DEF/Bild) — die Zahl kann sich ändern.

## Entscheidungen, die während der Umsetzung getroffen wurden

Jede davon lässt sich zurückdrehen, falls sie nicht passt.

- **Farbwerte angepasst (Kontrast):** `accent-fg` dunkel `#14151a` → `#0f1013`; `accent` dunkel `#8b6ad6` → `#a48be3`; `warn` hell `#9a6b1f` → `#8a5f18`; `good` hell `#3f7d54` → `#37704a`. Die Spec-Tabelle ist mitgeändert. Folge: Violett im Dunkelmodus etwas heller.
- **Getönte Abzeichen und aktive Navigation** tragen Text in normaler Textfarbe; Farbe nur als Tönung oder Rand.
- **Transparenz auf Rollen** läuft über `color-mix(...)` in `tailwind.config.js`; die Hex-Werte in `index.css` bleiben die einzige Quelle.
- **Filter-Regel:** Eine Karte mit mehreren Drucken trifft einen Filter, sobald irgendein Druck trifft; Foil-Erkennung folgt `getRarityInfo` in `desktop/src/utils/rarity.js` (Handy als Zwilling).
- **Zähler „Verkaufen“** = vorgemerkte Exemplare ohne laufendes Angebot + aktive Angebote (keine Doppelzählung). Unbekannte zählen als Karten, nicht als Datenbankzeilen.
- **Behälter-Farbauswahl:** Die erste Voreinstellung ist jetzt `#7C3AED` statt des alten Neonvioletts `#9D00FF`, auf PC und Handy gleich. Gespeicherte Behälterfarben sind unverändert.
- **Handy:** Seltenheits- und Typ-Plaketten ohne Farbe (Seltenheit fett); Banlisten-Symbol wie am PC; ein Wechsel des System-Nachtmodus baut die Bildschirme nicht mehr neu auf (`uiMode` in `configChanges`).
- **Reihenfolge:** Alle Aufgaben strikt nacheinander, weil mehrere Paare sich Dateien teilen.

## Nach I2 verschoben

- Schriften und Ecken aus Spec §6.3 (Ziffernbreite ist bereits umgesetzt).
- Aufteilen von `desktop/src/components/CollectionList.jsx` (Spec §10).
- Handy-Sortierung als Chip-Reihe.
- Heller Fenstergrund beim Handystart im Dunkelmodus, Systemleisten folgen dem Modus nicht.
- `SalesPanel.jsx` stürzt ohne `window.api` ab (nur in der reinen Vite-Vorschau).

## Kleinigkeiten ohne Eile

- `text-bad/70` im Gefahrenzone-Eintrag der Einstellungen-Navigation liegt vermutlich knapp unter 4,5:1.
- Wisch-Aktualisierung wirkt im Eingabezustand des Deck-Imports nicht (kein scrollbarer Inhalt) — harmlos.

## Nachprüfung

Abschlussreview → Fixwelle → Nachprüfung → Restrunde → Nachprüfung → zwei Einzeiler. Alle beauftragten Punkte sind behoben. Geparkt (kann warten): doppeltes Laden der Verkaufsdaten in `VerkaufenLayout`/`StagingArea`; `DropdownMenu` am Handy ohne Rand auf `surface`-Karten.
