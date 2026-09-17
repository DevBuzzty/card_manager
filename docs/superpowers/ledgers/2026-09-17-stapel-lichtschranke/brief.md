# Stapel-Scan v2: Lichtschranke + echte Umrandung

Nachfolger von `../2026-09-17-stapel-scan-bewegung/`. Branch `fix/stapel-lichtschranke` von `main` `f0e6a5f`.

## Problem (Nutzertest 17.09.)
Stapel-Modus zählt **manchmal zu wenig**, nie zu viel. Ursache: die Bewegung wird nur in Bildern
gemessen, die auch die Kartenerkennung durchlaufen (~2,3 Bilder/s). Eine Karte rutscht in 0,5–0,9 s
ein → 1–2 Messbilder; fällt sie zwischen zwei Messbilder, sehen Vorher/Nachher (gleiche Karte, gleiche
Stelle) fast gleich aus → kein Ausschlag, kein +1 (Karte 3 in messung-1.txt: Spitze 10,6 knapp über 9).

Zweitens: die Umrandung im Scan-Bildschirm (`ScanScreen.kt`, „Card Frame") ist nur gezeichnet; Erkennung
und Bewegung laufen über das ganze Kamerabild.

## Aufbau beim Nutzer (bestätigt)
- Handy fest montiert, immer gleiche Position.
- Karten kommen **immer von rechts** über eine Rutsche; die Rutsche endet außerhalb des Bildes, die Karte
  tritt an der **rechten Kante der Umrandung** ein und landet in der Umrandung.

## Entscheidungen (Nutzer freigegeben)
1. **Umrandung wird echt – in beiden Modi** (`einzeln` und `stapel`): nur Erkennungen, deren
   Box-Mitte innerhalb der Umrandung liegt, zählen.
2. **Bewegung auf jedem Kamerabild** (~20–30/s), entkoppelt von der Erkennung: der Analyzer misst die
   Bewegung direkt aus der Y-Ebene (kein Bitmap), die Erkennung läuft nur, wenn sie frei ist, auf einem
   eigenen Thread.
3. **Zwei Messflächen**: Lichtschranke = schmaler Streifen am rechten Rand der Umrandung; Kartenfläche =
   Innenraum der Umrandung.
4. **Zählregel (Stapel)**: Lichtschranken-Ausschlag, danach Kartenfläche binnen ~1,5 s ruhig, Karte
   erkannt → +1. Sperrzeit nach jedem +1; lange Unruhe (Hand, Herausnehmen) wird verworfen. Schwellen
   kommen aus der Messung, nicht geschätzt.
5. **Rückmeldung**: kurze Vibration + Ton + großer Zähler bei jedem +1.

## Schritt 1: Mess-App (dieser Stand)
Keine Verhaltensänderung an Zählen/Erkennen. Neu:
- `ml/GuideRegion.kt` (reines Kotlin, getestet): Umrandung View-Koordinaten → aufrechtes Kamerabild
  (FILL_CENTER) → Sensor-Koordinaten (Rotation 0/90/180/270); Streifen = rechte 20 % der Umrandung.
- `MlScanAnalyzer`: pro Kamerabild Bewegung in Streifen und Innenraum (Blockmittel der Luma,
  mittlere absolute Differenz zum Vorbild); Erkennung asynchron auf eigenem Einzel-Thread, nur wenn frei.
- Log-Tag `StapelMess`: `t, strip, inner, ml` pro Bild; pro Erkennungsergebnis Passcodes und ob die
  Box-Mitte in der Umrandung liegt.

Messdurchgang (Nutzer, USB, Modus Stapel): ~10 gleiche Karten einzeln einwerfen (Pausen ~3 s), einmal
Hand in der Umrandung wackeln, einmal Hand von rechts über die Rutsche, einmal Stapel herausnehmen,
eine andere Karte einwerfen.

## Schritt 2 (nach Auswertung)
Zählregel + Umrandungsfilter + Rückmeldung bauen; Messfolgen als JVM-Testdaten.
Abnahme: 20 gleiche Karten → 20× +1; Hand-Wackeln / Herausnehmen → 0×; Karten außerhalb der Umrandung
werden nicht erkannt.

## Regeln
Explizite Pfade stagen, nie `git add -A`, nie `git stash`, nie amend. `android/local.properties` nie
lesen/kopieren (ANDROID_HOME setzen). Trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
Build: `ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" ./android/gradlew -p android testDebugUnitTest assembleDebug`, danach `--stop`.

## Ergebnis (Stand Abschluss, 17.09. nachmittags)
- **ChuteGate** (Lichtschranke): Spitze >= 37, Dauer <= 600 ms, 500 ms ohne Nachbar-Stoss (>= 10) davor/danach.
  Messung 1 14/14, Abnahme 1-4 und Performance 3: alle Karten-Einwuerfe bis auf einen schwachen (28) erkannt,
  kein Hand-/Herausnehmen-Fehlalarm. Tests aus allen Logs.
- **StackCounter**: jeder Einwurf genau +1, eingeloest von der naechsten Bestaetigung, verfaellt nach 15 s.
  Bestaetigung ohne Einwurf zaehlt im Modus stapel nicht.
- **BoxTracker.rearmAll**: Einwurf rearmt alle bestaetigten Karten (im Einwurf-Bild ist oft keine erkannt);
  danach reichen 2 Sichtungen.
- **Umrandung echt** (beide Modi), Zaehler/Ton/Vibration im Stapel-Modus.
- **Haenger behoben**: SetCodeMatch.best in ScanResolver.resolve lief auf dem UI-Thread, wuchs mit den
  OCR-Belegen (1-3 s) und hielt ueber die Vorschau auch die Kamera an (performance-2-roh.log, Thread-Stacks).
  Performance 3: keine Haenger, keine Bildluecken.
- **Offen, eigenes Thema (Kartenerkennung)**: im Aufbau des Nutzers findet der Artwork-Detektor die Karte fast
  nie; Treffer kommen aus der Ganzbild-OCR (jedes 3. Bild, Box = 18/12/82/88 % des Bildes) -> langsam, und
  einmal Passcode verlesen (17704467 statt 77044671). Diagnosefotos: abnahme-4-karte5.jpg, performance-3-*.jpg.
