# Design: Konkurrenzfähiges Scannen — robuste Set-Code-Erkennung, Rarity-Vorwahl, Speed

**Datum:** 2026-08-25
**Status:** Approved (Design)

## Problem

Kommerzielle Yu-Gi-Oh-Scanner-Apps (YuScan, Collectr, Ludus, Omi) erkennen Karte,
exakte Auflage und Rarity in <1 s und tragen sie quasi ohne Klicks ein. Recherche
(siehe unten) zeigt: Der verlässliche Rarity-Signalweg ist überall **Set-Code lesen →
Datenbank-Lookup**, nicht optische Foil-Erkennung. Kein Open-Source-Projekt liefert eine
zuverlässige, on-device-mobile Foil-Klassifikation; das einzige YGO-Projekt mit Rarity
([DJ-Cat-N-Cheese/Yu-Gi-Oh-Card-Tracker](https://github.com/DJ-Cat-N-Cheese/Yu-Gi-Oh-Card-Tracker))
nutzt Foil-Analyse nur als schwachen Heuristik-Beitrag neben dem Set-Code und ist ein
schwerer Desktop-Python-Stack.

Unsere App liest bereits Passcode **+** Set-Code per ML-Kit-OCR über Multi-Frame-Bestätigung
und wählt im Staging die passende Auflage/Rarity vor. Schwächen gegenüber der Konkurrenz:

- Set-Code-OCR ist fragil: strenges Regex, keine Fehlerkorrektur bei OCR-Verwechslern
  (`O/0`, `I/1`, `S/5`, `B/8`, `Z/2`). Ein einziger Fehl-Lesefehler → gar kein Set-Code-Match.
- Fremdtext (Flavor-Text, Hintergrund) erzeugt Rausch-Kandidaten.
- Bestätigung im Staging ist Maus-lastig (Klick pro Karte), kein Batch, kein Tastatur-Flow.

## Ziel / Nicht-Ziel

**Ziel:** Set-Code wird deutlich häufiger korrekt erkannt (auch aus fehlerhaftem OCR),
Rarity dadurch automatisch vorausgewählt, und das Eintragen im Staging wird schnell
(Tastatur + Batch). Kein ML-Modell nötig.

**Nicht-Ziel (bewusst draußen):**
- Optische Foil-/Rarity-Klassifikation (unzuverlässig, kein fertiges Modell/Datensatz).
- Echter Auto-Commit ohne Staging (Nutzer will Kontrolle behalten → Staging bleibt).
- Art-Matching / Karten-Identifikation per Artwork (eigene spätere Ausbaustufe).

## Kernidee

OCR ist immer etwas fehlerhaft, **aber die wahre Set-Code-Liste einer Karte ist klein und
bekannt** (aus YGOPRODeck `card_sets` + Yugipedia `de_sets`). Statt einen evtl. falsch
gelesenen Code blind zu übernehmen, liest das Handy **mehrere Kandidaten** und der Desktop
**gleicht sie per confusion-aware Fuzzy-Match gegen die echten Auflagen der Karte ab**. So
korrigiert sich `DOOO-DE038` → `DOOD-DE038` von selbst.

## Architektur / Datenfluss

Unverändert: Handy → Socket.io `card_scanned` → `main.cjs` forwardet als `card-scanned`
→ `App.jsx` erzeugt Staging-Objekt → `StagingArea.jsx` holt Kartendaten + Sets, wählt
Auflage/Rarity vor, Nutzer bestätigt.

Änderungen liegen an drei Stellen:

### Teil A — Android: Kandidaten-basierte Set-Code-Erkennung
Datei: `android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt` (Klasse `CardAnalyzer`)

1. **ROI-Crop:** Nur den Bildbereich innerhalb des angezeigten Karten-Rahmens (die
   `aspectRatio(0.68f)`-Box, ~80 % Breite, zentriert) an ML Kit übergeben. Reduziert
   Fremdtext und OCR-Last. Umsetzung über `InputImage.fromBitmap` mit vorab gecropptem
   Bitmap **oder** `imageProxy`-Crop-Rect; die konkrete Variante wird in der Implementierung
   gewählt (Crop-Rect bevorzugt, wenn ohne Bitmap-Kopie machbar).
2. **Regex lockern:** Set-Code-Muster erweitern, sodass mehr Regionscodes und Ziffernlängen
   sowie OCR-ambige Zeichen als Kandidaten erfasst werden — Ziel ist **hohe Recall**, die
   Präzision stellt der Desktop-Fuzzy-Match her. Aktuell:
   `\b[A-Z0-9]{2,5}-[A-Z]{2}\d{2,4}\b`.
3. **Alle Kandidaten sammeln:** Über das bestehende `setWindow` **alle** gesehenen
   Set-Codes mit Häufigkeit zählen (nicht nur `maxByOrNull`). Beim Bestätigen eines
   Passcodes die **Top-3** Kandidaten (nach Häufigkeit) mitsenden.
4. **Neues Socket-Feld:** `card_scanned`-JSON erhält `setCodeCandidates: ["DOOO-DE038", ...]`.
   `setCode` (bester einzelner) **bleibt** für Rückwärtskompatibilität gesetzt.
   `passcode` und Multi-Frame-Passcode-Bestätigung unverändert.

### Teil B — Desktop: Fuzzy-Matching + Confidence
Dateien: `desktop/src/App.jsx`, `desktop/src/components/StagingArea.jsx`,
neu: `desktop/src/utils/setCodeMatch.js`

1. **`App.jsx`:** Neben `scannedSetCode` auch `scannedSetCandidates: data.setCodeCandidates || (data.setCode ? [data.setCode] : [])` ins Staging-Objekt übernehmen.
2. **`setCodeMatch.js` (neu, rein, testbar):**
   - `normalize(code)` — Großschreibung, Whitespace weg.
   - `confusionDistance(a, b)` — Levenshtein, aber Substitutionskosten für bekannte
     OCR-Paare (`O↔0`, `I↔1`, `S↔5`, `B↔8`, `Z↔2`, `D↔O` nur wo plausibel) = 0.5 statt 1.
   - `matchCandidates(candidates, sets)` → `{ set, score, exact }`:
     bester Set aus `sets` (jeweils `set.set_code`) über alle Kandidaten; `exact` wenn
     ein Kandidat nach `normalize` identisch ist; sonst `score` = kleinste Distanz.
     Schwelle: Distanz ≤ 1.5 gilt als „fuzzy match", darüber „kein Match".
3. **`StagingArea.jsx`:** `matchSet` (aktuell exakt, Zeile 10) durch `matchCandidates`
   ersetzen — sowohl beim ersten Laden (`data.card_sets`, Zeile 55) als auch im
   Yugipedia-Nachlauf (`germanSets`, Zeile 68). Ergebnis-Confidence in den Card-State:
   - `setMatchConfidence: 'exact' | 'fuzzy' | 'none'`.
   - `setAutoDetected` bleibt `true` für exact **und** fuzzy (beide sind vorausgewählt).
4. **UI-Anzeige:** kleiner Badge an der vorgewählten Auflage — grün „erkannt" (exact),
   gelb „geprüft?" (fuzzy), nichts/manuell (none). Bestehendes Auto-Detected-Styling
   wiederverwenden.

### Teil C — Speed & Minimal-Klick
Datei: `desktop/src/components/StagingArea.jsx`

1. **Tastatur:** Enter übernimmt die **oberste geladene** Karte (`handleAdd`) und
   fokussiert die nächste. Listener sauber in `useEffect` registrieren/abmelden; keine
   Auslösung während ein Eingabefeld/Select fokussiert ist.
2. **Batch-Button** „Alle eindeutig erkannten übernehmen": trägt alle Karten mit
   `status==='loaded'` **und** `setMatchConfidence==='exact'` in Folge ein (nutzt
   bestehendes `handleAdd` je Karte). Gelbe (fuzzy) und manuelle bleiben stehen.
3. Bestehende Parallelisierung (`MAX_CONCURRENT_FETCHES=5`) + Sofort-Anzeige der Karte
   bleiben unverändert.

## Fehlerbehandlung / Edge Cases

- **Kein Set-Code lesbar:** `scannedSetCandidates` leer → wie heute: erste Auflage als
  Fallback, `setMatchConfidence='none'`, manuelle Auswahl möglich.
- **Fuzzy trifft mehrere gleich gut:** deterministisch den ersten (stabil sortiert) wählen,
  als `fuzzy` markieren, damit der Nutzer prüft.
- **Rückwärtskompatibilität:** Altes Handy ohne `setCodeCandidates` → Desktop nutzt
  `[data.setCode]` als einzigen Kandidaten; alter Desktop mit neuem Handy ignoriert
  `setCodeCandidates` und liest weiter `setCode`.
- **Passcode-Dedup in `App.jsx:30`** (blockt identischen Passcode gleichzeitig im Staging)
  bleibt unverändert — außerhalb dieses Scopes.

## Verifikation

- **Unit-Tests** für `setCodeMatch.js` (das einzige rein-testbare Stück): reale Fehl-Scans
  → korrekte Auflage. Fälle mind.: `DOOO-DE038`→`DOOD-DE038` (exact-nach-Korrektur=fuzzy),
  `LO8-EN00I`→`LOB-EN001`, exakter Treffer, kein Treffer (Distanz zu groß), leere Kandidaten,
  mehrere Kandidaten (bester gewinnt).
  Test-Runner: leichtgewichtig (`node --test`), da im Projekt kein Test-Setup existiert.
- **Manuell (Android):** Fehl-belichtete Karten scannen, prüfen dass Top-3-Kandidaten
  sinnvoll sind und ROI-Crop keinen echten Code abschneidet.
- **Manuell (Desktop):** Enter trägt oberste Karte ein und rückt nach; Batch-Button trägt
  nur grüne ein; `(id, set_code, language)` in DB korrekt.

## Rollout

Additiv und rückwärtskompatibel — keine DB-Migration, kein Breaking Change am Socket-Protokoll.
Android-APK muss neu gebaut/installiert werden, damit `setCodeCandidates` gesendet wird;
bis dahin läuft der Desktop über den `setCode`-Fallback weiter.
