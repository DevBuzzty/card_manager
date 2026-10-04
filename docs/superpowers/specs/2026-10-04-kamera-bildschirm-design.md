# Kamera-Bildschirm neu gestalten – Design

Stand: 2026-10-04 · Status: Entwurf, im Gespräch mit dem Nutzer abgestimmt (Brainstorming 04.10.)
Vorgänger: `2026-10-04-scan-ergebnis-seite-design.md` (dort als „eigener späterer Schritt“ ausgeklammert)

## 1. Ziel

Der Kamera-Bildschirm (`ui/ScanScreen.kt`) wird übersichtlicher und passt optisch zur übrigen App.
Der Nutzer nannte drei Probleme (04.10.):

- **(a)** Die obere Leiste hat zu viele kleine, unbeschriftete Symbole (9 Stück).
- **(b)** Welcher Modus aktiv ist (Einzeln/Stapel) und wie man wechselt, ist nicht sofort klar.
- **(d)** Der Bildschirm passt optisch nicht zum Rest der App (fest einprogrammierte Farben).

Die Liste „Prüfen & übernehmen“ (`ScanStagingSheet`) gehört **nicht** dazu.

### Abgestimmte Entscheidungen (04.10.)
| Frage | Entscheidung |
|---|---|
| Oft genutzt, also direkt sichtbar | Scan-Sprache, Fokus, Passcode eintippen, PC-Status |
| Selten genutzt, ins ⋯-Menü | Taschenlampe, Fehler melden, **PC-Verbindung …** |
| Grundaufbau | **C – „Alles unten“**: Werkzeuge über dem Auslöser, Modus-Wahl darunter, oben nur ✕ · PC · ⋯, großes Modus-Etikett über dem Rahmen |
| Detailentwurf | abgenommen (`.superpowers/brainstorm/…/kamera-c-detail.html`) |

## 2. Ist-Zustand (Befund 04.10.)

- **Obere Leiste** (`ScanScreen.kt:808-925`): ✕, Titel „Scannen“, PC-Punkt (Antippen = Snackbar),
  Sprach-Pille „🌐 Auto“ (zyklisch Auto→DE→EN→KR→JP), Modus-Symbol (Layers/LooksOne + Toast),
  Fähnchen „Fehler melden“, Fokus, Taschenlampe, Tastatur. Hintergrund `Color.Black` α 0.35.
- **Modi:** nur `"einzeln"` (Foto + Auslöser) und `"stapel"` (Lichtschranke, Zähler), gespeichert in `Prefs.scanMode`.
- **Stapel-Zähler** „+N“ oben in `Color.Yellow` (`:777-786`). **Auslöser** unten nur im Einzelmodus (`:790-805`).
- **Untere Leisten** „N an den PC gesendet“ / „N Karten erkannt · Prüfen (N)“ (`:931-961`), Schwarz α 0.55.
- **Fest einprogrammierte Farben:** Gelb (Zähler, Sprache fest, Stapel, Lampe an), Rot (Fokus fest),
  `0xFFFF8A65` (Fähnchen), `0xFF00FF66` (Erkennungsrahmen und Passcode-Text), Weiß und Schwarz mit Alpha.
- **PC-Adresse** steht in `scanner_prefs` unter `ip_address`, gesetzt in `SettingsScreen.kt:99`;
  `ScanScreen` verbindet sich automatisch über `connectSocket(savedIp)` (`:182-185`).

## 3. Neuer Aufbau (Layout C)

Von oben nach unten:

1. **Obere Leiste** (Verlauf von dunkel nach transparent statt Schwarz-Block):
   - links **✕** (schließen, wie bisher);
   - **PC-Status als Text-Chip**: Punkt + „PC verbunden“ (`Good`) bzw. „nur Handy“ (`Muted`).
     Antippen öffnet den Dialog „PC-Verbindung“ (siehe §5);
   - rechts **⋯** öffnet ein Menü (§4).
   - Der Titel „Scannen“ entfällt.
2. **Modus-Etikett** groß und mittig über dem Kartenrahmen: „EINZELN“ bzw. „STAPEL“ (Akzent-Hintergrund).
3. **Kartenrahmen** wie bisher (Position/Größe unverändert – die Lichtschranke im Stapel-Modus misst daran).
4. **Leiste für Vorgemerktes / Gesendetes** (wie bisher die unteren Streifen, jetzt als abgerundete Karte über den Werkzeugen):
   - ohne PC: Ampelpunkt + „N Karten vorgemerkt“ + Knopf „Prüfen (N)“;
   - mit PC: Ampelpunkt der letzten Karte + „N an den PC gesendet“.
5. **Werkzeug-Chips** in einer Zeile, beschriftet:
   - **Sprache**: „🌐 Auto“ bzw. Flagge + Code (zyklisch wie bisher); fest gewählt → Akzent-Rahmen;
   - **Fokus**: „◎ Fokus“; fest → „◎ Fokus fest“ im Akzent;
   - **Code**: „⌨ Code“ öffnet die Passcode-Eingabe (wie bisher).
6. **Unten Mitte**:
   - Einzeln: **Auslöser** (wie bisher, Akzentfarbe);
   - Stapel: an derselben Stelle der **große Zähler** „+N“ mit „Karten im Stapel“ (ersetzt den gelben Zähler oben).
7. **Modus-Wahl** ganz unten: „EINZELN · STAPEL“ als Text-Reiter; der aktive im Akzent, fett. **Antippen** wechselt
   (kein Wischen – kollidiert mit Pinch-Zoom und Tipp-Fokus). Gespeichert wie bisher in `Prefs.setScanMode`;
   der bisherige Toast entfällt, weil Etikett und Reiter den Modus zeigen.

## 4. ⋯-Menü

- **Taschenlampe** an/aus (Häkchen bzw. „an“ sichtbar, wenn eingeschaltet).
- **Fehler melden** (bisheriges Fähnchen, gleiche Funktion inkl. Toast „Fehler vermerkt“).
- **PC-Verbindung …** öffnet den Dialog aus §5.

## 5. Dialog „PC-Verbindung“

Im Scanner, ohne den Bildschirm zu verlassen:
- Status-Zeile („Verbunden mit 192.168.x.x“ / „Nicht verbunden“).
- Eingabefeld **IP-Adresse**, vorbelegt aus `scanner_prefs.ip_address`; Speichern schreibt denselben Schlüssel wie
  `SettingsScreen` (eine Quelle der Wahrheit).
- Knöpfe **„Verbinden“** (ruft das vorhandene `connectSocket(ip)`) und, wenn verbunden, **„Trennen“**.
- Fehler beim Verbinden wie bisher als Meldung.

## 6. Farben und Stil

- **Keine fest einprogrammierten Farben** mehr auf diesem Bildschirm. Ersetzt durch Rollen aus `ui/theme`:
  - Akzent (`colorScheme.primary`) für aktive Zustände, Auslöser, Modus-Etikett, aktiven Reiter, Stapel-Zähler;
  - `Good` für Erkennungsrahmen + Passcode-Text der Rahmen und „PC verbunden“;
  - `Muted` für „nur Handy“ und inaktive Reiter;
  - Ampel wie bisher über `ScanStagingLogic.dotColor` mit `LocalAppRoles`.
- Überlagerungen auf dem Kamerabild bleiben dunkel-transparent, damit Text auf jedem Bild lesbar ist. Diese Scrim-Werte
  stehen **an einer Stelle** als benannte Konstanten (z. B. `ScanOverlay.scrim`), nicht verstreut.
- Weiß als Schriftfarbe auf der Kamera bleibt zulässig (über dem Scrim), ebenfalls als benannte Konstante.
- Die Kamera-Oberfläche nutzt immer das **dunkle** Rollen-Set (`AppColors.dark`), unabhängig vom App-Theme –
  wie heute schon die Ampel der unteren Leiste. So bleibt der Kontrast auf dem Kamerabild stabil.

## 7. Was gleich bleibt

- Alle Funktionen und Abläufe: Kamera, Pinch-Zoom, Tipp-Fokus, Lichtschranke, Foto → Ergebnis-Seite, Passcode-Dialog,
  Staging-Sheet, Snackbars, Blitz-Effekt, Berechtigungs-Hinweis.
- Kartenrahmen-Geometrie (Lichtschranke!) und Kamera-Auflösung.
- Der Einsortier-Bildschirm (`SortIntoBinderScreen`) ist nicht betroffen.

## 8. Aufteilung im Code

`ScanScreen.kt` ist mit ~1190 Zeilen groß. Die neuen Oberflächen-Teile kommen in eine eigene Datei
`ui/ScanOverlay.kt` (rein darstellend, Zustand und Aktionen als Parameter):
`ScanTopBar`, `ModusEtikett`, `WerkzeugChips`, `ScanLeiste` (Vorgemerkt/Gesendet), `StapelZaehler`, `ModusReiter`,
`MehrMenue`, `PcVerbindungDialog`, dazu die Farb-/Scrim-Konstanten. `ScanScreen.kt` behält Kamera, Erkennung und Zustand
und ruft diese Bausteine auf. Reine Logik (z. B. Text des PC-Chips, Label der Sprach-Chips) als testbare Funktionen.

## 9. Tests und Abnahme

- **Unit-Tests** (JVM) für die reinen Funktionen: PC-Chip-Text/Farbe je Zustand, Sprach-Chip-Text (Auto/DE/…),
  Modus-Reiter-Auswahl, Zähler-Text.
- **Kein Hex-Wert** mehr in `ScanScreen.kt`/`ScanOverlay.kt`: ein Test, der die beiden Dateien nach `Color(0x` und
  `Color.Yellow/Red/Green` durchsucht (analog zum Desktop-Test `noLegacyColors`).
- **Abnahme am Gerät:** beide Modi, Moduswechsel per Reiter, Sprache durchschalten, Fokus fest/lösen, Passcode-Dialog,
  ⋯-Menü (Lampe, Fehler melden, PC-Verbindung), PC verbinden/trennen, Stapel-Lauf mit Zähler und Erkennungsrahmen,
  Foto → Ergebnis-Seite; danach App starten + `adb logcat -b crash` prüfen.

## 10. Nicht Teil dieser Spec

- Liste „Prüfen & übernehmen“ (ScanStagingSheet).
- Neue Scan-Funktionen oder geänderte Erkennung.
- Pendel-Auflagen-Erkennung (läuft getrennt).
