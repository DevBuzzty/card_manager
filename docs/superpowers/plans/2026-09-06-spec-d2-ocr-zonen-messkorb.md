# Spec D2 — Layout-abhängige OCR-Zonen und Messkorb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Scanner liest Set-Code, Passcode und Edition bei jedem Kartenlayout an der richtigen Stelle — und jede Änderung daran wird an einem festen Messkorb belegt statt behauptet.

**Architecture:** Heute liest `CardStrip.bottomBand` **ein** Band über die volle Kartenbreite, 0,55–1,05 Artwork-Boxhöhen unter dem Artwork. Das trifft bei Standardkarten Passcode und Set-Code gemeinsam, bei Pendulum-Karten aber daneben, weil der Set-Code dort links unter dem Pendel-Kasten sitzt. D2 ersetzt das eine Band durch **Zonen pro Layout** (`SET_CODE`, `PASSCODE`, `EDITION`), wählt das Layout über den Kartentyp aus dem Offline-Katalog (D1), und macht aus `bandText` ein `zoneTexts: Map<Zone, String>`. Die Zonenwerte werden **aus echten Fotos ausgemessen**, nicht geschätzt: der bekannte Passcode aus dem gelabelten eBay-Korpus dient als Ground Truth, um die Textlage relativ zur Artwork-Box zu bestimmen. Ein Messkorb aus demselben Korpus plus ~20 Aufnahmen aus dem echten Speed-Aufbau macht jede Maßnahme vorher/nachher vergleichbar.

**Tech Stack:** Kotlin/Android (ML Kit Text Recognition, CameraX, ONNX Runtime), Python (`ultralytics` YOLO + `onnxruntime` für den Detektor, EasyOCR für die Offline-Labelung), Android-Instrumentation für die Messung auf dem Gerät.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-05-spec-d-scan-flow-design.md`, Abschnitte **§4** (Verifikation der Audit-Fixes), **§7b** (Layout-Zonen) und **§7c** (Qualitätsprogramm). Alles andere aus Spec D ist **D3** (Printing-Auflösung, Edition, Ampel) und **D4** (Speed-Scan) — hier nicht anfangen.
- **Die ONNX-Pipeline bleibt unangetastet**, soweit es nicht ausdrücklich um die Zonengeometrie geht: Detektor, Embedder, `IndexSearcher`, `HybridPipeline`s Schwellwerte, `BoxTracker`, die Overlay-Mathematik und die `DisposableEffect`-Teardown-Reihenfolge (unbind → Executor leeren → `analyzer.close()` → `pipeline.close()`). Fünf aufeinanderfolgende Reviews haben diese Bereiche als byte-identisch zum Ausgangsstand bestätigt; das bleibt so.
- **Jede benutzersichtbare Zeichenkette ist deutsch.** Yu-Gi-Oh-Begriffe bleiben englisch (Rarity, Set-Code, Passcode, Secret Rare). Dieser Plan erzeugt fast keine UI — was er erzeugt, ist deutsch.
- Kotlin 2.0.0 / AGP 8.2.2 / compileSdk 34. **Keine neue Android-Abhängigkeit.** Python-Werkzeuge dürfen `requirements-train.txt` erweitern.
- Android-Verifikation: `./gradlew :app:compileDebugKotlin` und `:app:testDebugUnitTest` müssen BUILD SUCCESSFUL sein. Instrumentation nur, wo ein Task es sagt — und dann mit `-Pandroid.testInstrumentationRunnerArguments.class=<FQN>`, **nicht** mit `--tests` (das lehnt `connectedDebugAndroidTest` ab). Schlägt die Installation des androidTest-APK mit `INSTALL_FAILED_USER_RESTRICTED` fehl, erst `adb install -r -t app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`, dann Gradle.
- **Nie committen:** `android/app/src/main/assets/embedder.onnx` und `index.bin` (feinjustierte Gewichte des Nutzers, absichtlich als geändert-aber-ungestaged im Baum), `android/local.properties`. Immer explizite Pfade stagen, **niemals `git add -A`**.
- **Korpusdaten bleiben draußen.** `ml/data/**` ist git-ignoriert und bleibt es. Committet werden nur Skripte, Konstanten, die `labels.csv`-Struktur (leer oder mit ein paar Beispielzeilen) und **wenige** kleine Belegausschnitte unter `ml/data/zones/<layout>/` — eigene Karten, je Layout höchstens drei Bilder unter 100 kB.
- Commit-Stil: `feat(android|ml): …` / `fix(…): …`, ein Commit pro Task, Nachricht endet auf `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Zwei Eigenheiten dieses Plans, die die Ausführung betreffen

**1. Messtasks sind keine Implementierungstasks.** Tasks 7–10 lauten „Maßnahme umsetzen **und die Vorher/Nachher-Zahlen berichten"** — nicht „Maßnahme umsetzen, fertig". Ob eine Maßnahme bleibt, entscheidet die Zahl, nicht der Implementer. Verschlechtert eine Maßnahme den Messkorb, wird sie **zurückgenommen** und das im Ledger vermerkt; das ist ein Erfolg des Verfahrens, kein Fehlschlag des Tasks. Der Controller trifft diese Entscheidung zusammen mit dem Nutzer.

**2. Der Nutzer liefert einen Teil des Messkorbs.** Task 6 braucht ~20 Aufnahmen aus dem echten Speed-Aufbau (Handy auf einer Erhöhung, Karte darunter). Nur die messen die Bedingungen, unter denen die Funktion später läuft; die eBay-Fotos sind zu sauber. Der Controller fordert sie rechtzeitig an.

## File Structure

| Datei | Verantwortung |
|---|---|
| `ml/measure_zones.py` (neu) | Detektor über gelabelte Korpusfotos laufen lassen, den bekannten Passcode per OCR im Bild finden, daraus die Zonenrechtecke **in Artwork-Box-Einheiten** je Layout statistisch bestimmen. Schreibt `ml/data/zones/<layout>/` (Belegausschnitte) und gibt die Konstanten aus. |
| `ml/label_setcodes.py` (neu) | Ergänzt den Korpus um `set_code` und `edition` als Ground Truth: starkes Offline-OCR über das untere Band, Abgleich der gelesenen Codes gegen die bekannten Printings der Karte (Passcode ist bekannt) aus dem Katalog. Nur exakte Treffer werden Label. |
| `ml/ocr_bench/labels.csv` (Struktur committet, Daten nicht) | `file,passcode,set_code,edition,layout,source` — `source ∈ ebay|rig`. |
| `ml/ocr_bench.py` (neu) | Exportiert die Zonen-Crops für den Messkorb (gleiche Geometrie wie Android), schiebt sie aufs Gerät, startet `OcrBench`, holt `results.json`, rechnet Trefferquoten pro Feld / Layout / Quelle aus und schreibt eine Vergleichstabelle. |
| `android/.../ml/CardLayout.kt` (neu) | `enum Layout { STANDARD, SPELL_TRAP, PENDULUM, LINK, SKILL, LEGACY }`, `zones(layout): Map<Zone, RectF>` in Artwork-Box-Einheiten, `layoutFor(type: String?, tcgDate: String?): Layout`. Rein, unittestbar. |
| `android/.../ml/CardZones.kt` (neu, ersetzt `CardStrip` nicht sofort) | Schneidet aus einem Frame die Zonen einer Box für ein Layout heraus. `CardStrip.bottomBand` bleibt als `LEGACY`-Fallback bestehen. |
| `android/.../ml/HybridPipeline.kt`, `ScanPipeline.kt` | `bandText: String` → `zoneTexts: Map<Zone, String>`; unbekannter Typ ⇒ STANDARD **und** PENDULUM lesen. |
| `android/.../ml/SetCodeEvidence.kt`, `PasscodeOcr.kt`, `SetCodeOcr.kt` | Pooling pro Zone statt pro Band. |
| `android/app/src/androidTest/.../OcrBench.kt` (neu) | Instrumentation: liest die exportierten Crops von der Gerätekarte, jagt sie durch dieselbe ML-Kit-Konfiguration wie der Scanner, schreibt `results.json`. |
| `android/app/src/test/.../CardLayoutTest.kt` (neu) | Typ→Layout für jeden Katalogtyp; Zonen liegen innerhalb der Kartenfläche. |

---

### Task 1: Die Audit-Fixes am Gerät verifizieren (Voraussetzung aus Spec §4)

**Files:** keine Quelländerung erwartet; nur ein Messbericht. Fällt die Messung schlecht aus, ändert dieser Task **nur** die beiden Bandfaktoren in `ml/CardStrip.kt`.

**Warum zuerst:** Die Audit-Fixes P1–P7 vom 2026-09-02 (1080p-Analyseframes, das neue `CardStrip`-Band, `SetCodeEvidence`, `SetCodeMatch`, Fallback-Drossel, `ScanCache`, ORT-Tuning) sind gebaut und installiert, aber **nie funktional am Gerät geprüft**. D2 baut auf dem Bandtext auf. Auf einer unbestätigten Grundlage zu messen, hieße jede spätere Zahl in Frage zu stellen.

- [ ] **Schritt 1: Messen**

Gerät verbinden, App installieren, dann mitschneiden:
```bash
adb logcat -c && adb logcat -s MlScan:V OrtPerf:V PasscodeOcr:V
```
Zehn Karten scannen, darunter mindestens zwei Pendulum-, zwei Zauber-/Fallen- und zwei Foil-Karten. Für jede festhalten: wurde ein Passcode gelesen, wurde ein Set-Code gelesen, wie lange dauerte ein Frame (`OrtPerf`).

- [ ] **Schritt 2: Auswerten und nur bei Bedarf korrigieren**

Liegt der Passcode bei Standardkarten **nicht** im Bandtext, sind die Faktoren `0.55f`/`1.05f` in `CardStrip.kt` nachzujustieren — und zwar an gedumpten Crops belegt, nicht geraten. Liegt er drin, bleibt die Datei unverändert.

- [ ] **Schritt 3: Bericht**

Der Task liefert eine Tabelle der zehn Karten mit den drei Beobachtungen und ein klares Urteil: „Grundlage bestätigt" oder „Faktoren auf X/Y korrigiert, Beleg in `ml/data/zones/_baseline/`". Ohne dieses Urteil beginnt Task 2 nicht.

- [ ] **Schritt 4: Committen** (nur falls Schritt 2 etwas geändert hat)

---

### Task 2: Zonen automatisch ausmessen (`ml/measure_zones.py`)

**Files:** Create `ml/measure_zones.py`; schreibt nach `ml/data/zones/<layout>/` (git-ignoriert bis auf wenige Belege).

**Interfaces:**
- Produces: eine Konsolenausgabe **und** `ml/data/zones/measured.json` der Form
  `{ "<layout>": { "SET_CODE": {"x":[lo,hi], "y":[lo,hi], "n": <anzahl>, "std": {...}}, "PASSCODE": {...}, "EDITION": {...} } }`,
  alle Werte **in Artwork-Box-Einheiten** (x relativ zur Boxbreite ab Boxlinks, y relativ zur Boxhöhe ab Boxunterkante — dieselbe Konvention wie `CardStrip`).
- Consumes: `ml/data/harvest/labeled/**` (5.657 Fotos, nach aufgedrucktem Passcode gelabelt), den Detektor (`ml/data/out/…` bzw. der Pfad aus `ml/config.py`), den Offline-Katalog für den Kartentyp.

**Das Verfahren, in Worten:** Für jedes Foto ist der Passcode bekannt. Detektor liefert die Artwork-Box. Ein starkes Offline-OCR (EasyOCR, GPU falls vorhanden — `label_photos.py` zeigt das Muster) liest das gesamte untere Kartendrittel mit Wortboxen. Wir suchen die Wortbox, deren Text dem bekannten Passcode entspricht (Confusion-tolerant), und rechnen ihre Lage in Boxeinheiten um. Dasselbe für den Set-Code, sobald Task 3 ihn gelabelt hat, und für die Editionsmarker. Über alle Fotos eines Layouts ergibt das Median und Streuung je Zonenkante.

- [ ] **Schritt 1: Layout je Foto bestimmen**

Aus dem Passcode den Kartentyp holen (Katalog oder YGOPRODeck-Dump) und auf ein Layout abbilden — dieselbe Abbildung, die Task 4 in Kotlin festschreibt: `Pendulum*` → PENDULUM, `Link Monster` → LINK, `Spell Card`/`Trap Card` → SPELL_TRAP, `Skill Card` → SKILL, sonst STANDARD.

- [ ] **Schritt 2: Messen und aggregieren**

Pro Layout **mindestens 40** verwertbare Fotos verlangen; darunter wird das Layout als „zu wenig Daten" ausgegeben statt geraten. Ausreißer über die Streuung verwerfen. Für jede Zone die Kanten so wählen, dass **95 %** der gefundenen Textboxen hineinfallen, plus einen kleinen Rand.

- [ ] **Schritt 3: Belegen**

Je Layout drei Beispielbilder mit eingezeichneten Zonen nach `ml/data/zones/<layout>/` schreiben — das ist der Beleg, den Spec §7b verlangt, und das Mittel, mit dem ein Mensch in zehn Sekunden sieht, ob die Zone sinnvoll liegt.

- [ ] **Schritt 4: Verifizieren**

`python ml/measure_zones.py --dry-run` auf 50 Fotos muss ohne Fehler durchlaufen und für STANDARD plausible Werte liefern (der Passcode sitzt unten links, also grob `x ∈ [0.0, 0.4]`, `y` unterhalb der Box). Weicht das stark ab, stimmt die Boxkonvention nicht — dann erst das klären, nicht die Zahlen hinbiegen.

- [ ] **Schritt 5: Committen** (nur das Skript und die wenigen Belegbilder)

---

### Task 3: Set-Code und Edition im Korpus labeln (`ml/label_setcodes.py`)

**Files:** Create `ml/label_setcodes.py`, `ml/ocr_bench/labels.csv` (Struktur).

**Interfaces:**
- Produces: `ml/ocr_bench/labels.csv` mit `file,passcode,set_code,edition,layout,source`.
- Consumes: den gelabelten Korpus, den Katalog (bekannte Printings je Passcode), EasyOCR.

**Die Regel, die alles trägt:** Ein `set_code`-Label entsteht **nur** bei einem exakten Treffer gegen die bekannten Printings genau dieser Karte. Wir kennen den Passcode, also kennen wir die Kandidatenmenge. Liest das OCR etwas, das keinem Printing der Karte entspricht, gibt es **kein Label** — lieber weniger Labels als falsche. Ein falsches Label würde jede spätere Messung still verfälschen.

`edition`: `first`, wenn ein Marker aus der Liste in Spec §7 gelesen wird (`1st Edition`, `1. Auflage`, `1ª Edición`, `1ère Édition`, `1ª Edizione`, `1ª Edição`), `limited` bei den entsprechenden Markern, sonst `unlimited`, wenn die Passcode-Zeile sicher gelesen wurde, sonst leer (**kein** Label).

- [ ] **Schritt 1: Implementieren**
- [ ] **Schritt 2: Ausführen und die Ausbeute berichten**

Erwartung im Bericht: wie viele der 5.657 Fotos ein `set_code`-Label bekommen und wie viele ein `edition`-Label. Fällt die Set-Code-Ausbeute unter ~30 %, ist das ein Befund über die Bildqualität, kein Grund, die Regel zu lockern.

- [ ] **Schritt 3: Committen** (Skript und die leere/beispielhafte `labels.csv`, **keine Fotos**)

---

### Task 4: `CardLayout.kt` — Layouts und Zonen als Konstanten

**Files:** Create `android/.../ml/CardLayout.kt`, `android/app/src/test/.../CardLayoutTest.kt`.

**Interfaces:**
- Produces: `enum class Layout { STANDARD, SPELL_TRAP, PENDULUM, LINK, SKILL, LEGACY }`, `enum class Zone { SET_CODE, PASSCODE, EDITION }`, `object CardLayout { fun layoutFor(type: String?, tcgDate: String? = null): Layout; fun zones(layout: Layout): Map<Zone, RectF> }`.
- Consumes: die gemessenen Werte aus Task 2 (`measured.json`) — **als Konstanten eingetragen**, mit einem Kommentar, der Datum, Stichprobengröße und Streuung nennt.

Die `RectF`-Werte sind in Artwork-Box-Einheiten, mit derselben Konvention wie `CardStrip`: x relativ zur Boxbreite ab Boxlinks (darf negativ sein und über 1 hinausgehen, die Karte ist breiter als das Artwork), y relativ zur Boxhöhe ab **Boxunterkante** nach unten.

- [ ] **Schritt 1: Test schreiben** — Typ→Layout für jeden im Katalog vorkommenden `type`-Wert; jede Zone liegt innerhalb einer plausiblen Kartenfläche (`x ∈ [-0.2, 1.2]`, `y ∈ [0, 1.4]`); STANDARD und PENDULUM haben **unterschiedliche** `SET_CODE`-Zonen (sonst wäre der ganze Task wirkungslos).
- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Implementieren**
- [ ] **Schritt 4: `./gradlew :app:testDebugUnitTest`**
- [ ] **Schritt 5: Committen**

---

### Task 5: Zonen aus dem Frame schneiden (`CardZones.kt`)

**Files:** Create `android/.../ml/CardZones.kt`. `CardStrip.kt` bleibt unverändert bestehen.

**Interfaces:**
- Produces: `object CardZones { fun crop(frame: Bitmap, box: Box, layout: Layout): Map<Zone, Bitmap> }` — überspringt Zonen, die aus dem Frame fallen, statt zu werfen.
- Consumes: `CardLayout.zones`, dieselbe `Box`-Definition wie `CardStrip`.

`CardStrip.bottomBand` **bleibt** und wird die `LEGACY`-Zone: Karten vor 2004 und alles, was auf kein Layout passt, lesen weiterhin das ganze Band. Das ist der Sicherheitsgurt — fällt die Zonenlogik für einen Sonderdruck daneben, gibt es weiterhin einen Treffer.

- [ ] **Schritt 1: Implementieren** — pro Zone eigenständige Vorverarbeitung über `OcrPrep.enhance`, nicht ein gemeinsames Bild.
- [ ] **Schritt 2: `compileDebugKotlin`, `testDebugUnitTest`**
- [ ] **Schritt 3: Committen**

---

### Task 6: Messkorb zusammenstellen und Grundmessung

**Files:** Create `android/app/src/androidTest/.../OcrBench.kt`, `ml/ocr_bench.py`.

**Interfaces:**
- `OcrBench` (Instrumentation) liest Crops aus `/sdcard/Android/data/com.example.yugiohscanner/files/ocr_bench/in/`, erkennt sie mit **derselben** ML-Kit-Konfiguration wie der Scanner, schreibt `…/out/results.json` (`[{file, text}]`).
- `ml/ocr_bench.py` exportiert die Crops, `adb push`t sie, startet die Instrumentation, `adb pull`t das Ergebnis, rechnet Trefferquoten und schreibt `ml/ocr_bench/report-<datum>.md`.

**Der Korpus, zweiteilig — beide Teile sind nötig:**
- **Masse:** mindestens 300 Fotos aus dem gelabelten eBay-Bestand, geschichtet über die Layouts (so gleichmäßig wie die Daten es hergeben) und mit Foils darin. Kostet den Nutzer nichts.
- **Wirklichkeit:** ~20 Aufnahmen aus dem echten Speed-Aufbau, `source = rig`. eBay-Galeriefotos sind gerade, scharf und gut ausgeleuchtet; der Aufbau liefert schräge, kleinere, oft spiegelnde Frames. **Ohne diesen Teil misst der Korbstand das Falsche.** Der Controller fordert die Fotos beim Nutzer an, bevor dieser Task startet.

Die Trefferquoten werden **getrennt nach Quelle** ausgewiesen. Eine Maßnahme, die auf eBay hilft und im Aufbau schadet, ist keine Verbesserung.

- [ ] **Schritt 1: `OcrBench` schreiben und die Instrumentation zum Laufen bringen**
- [ ] **Schritt 2: `ocr_bench.py` schreiben**
- [ ] **Schritt 3: Grundmessung fahren** — mit der **heutigen** Bandgeometrie, vor Task 7. Das ist die Nulllinie, gegen die alles Weitere gemessen wird.
- [ ] **Schritt 4: Bericht** — Tabelle: Trefferquote je Feld (`set_code`, `passcode`, `edition`) × Layout × Quelle, plus Stichprobengrößen.
- [ ] **Schritt 5: Committen** (Skripte und der Bericht; **keine Fotos**)

---

### Task 7: Maßnahme 1 — Zonen pro Layout verdrahten

**Files:** Modify `ml/HybridPipeline.kt`, `ml/ScanPipeline.kt`, `ml/SetCodeEvidence.kt`, `ml/PasscodeOcr.kt`, `ml/SetCodeOcr.kt`.

`bandText: String` wird zu `zoneTexts: Map<Zone, String>`. Ist der Kartentyp bekannt (Passcode erkannt → Katalog → Typ → Layout), werden dessen Zonen gelesen. Ist er **unbekannt**, werden STANDARD und PENDULUM beide gelesen und die Ergebnisse vereinigt — das ist die Regel aus Spec §7b und deckt die zwei häufigsten Fälle ab, ohne auf die Identifikation zu warten.

**Die Pipeline-Grenze:** Diese Dateien gehören zum ML-Pfad. Geändert wird **nur** die Geometrie und die Textweitergabe — Modellaufrufe, Schwellwerte, `BoxTracker`, Overlay und Teardown bleiben identisch. Der Task belegt das mit einem `git diff --stat` je Datei im Bericht.

- [ ] **Schritt 1: Umsetzen**
- [ ] **Schritt 2: Messen** — `ml/ocr_bench.py` erneut, Vorher/Nachher-Tabelle in den Bericht.
- [ ] **Schritt 3: Committen** (auch wenn die Zahlen enttäuschen — die Messung ist das Ergebnis)

---

### Task 8: Maßnahme 2 — Vorverarbeitung pro Zone

Perspektivische Entzerrung aus der Box, Hochskalieren auf **≥ 32 px Zeilenhöhe**, Kontrast/Binarisierung über das bestehende `OcrPrep`, **zwei Skalen** probieren und das bessere Ergebnis nehmen.

- [ ] **Schritt 1: Umsetzen** — [ ] **Schritt 2: Messen** — [ ] **Schritt 3: Committen**

---

### Task 9: Maßnahme 3 — Grammatik-Nachbearbeitung

Set-Code-Muster `PREFIX-REGION+NUMMER`; Ziffern-Whitelist für den Passcode; die bestehende Confusion-Tabelle; und als Plausibilitätsmaß: **der Passcode muss im Katalog existieren** (D1 macht das zu einer lokalen Abfrage statt einem Netzaufruf).

- [ ] **Schritt 1: Umsetzen** — [ ] **Schritt 2: Messen** — [ ] **Schritt 3: Committen**

---

### Task 10: Maßnahme 4 — Mehrframe-Voting pro Zone

Heute stimmt `SetCodeEvidence` über das gesamte Band ab. Neu wird **pro Zone** abgestimmt, damit ein guter Set-Code-Frame nicht von einem schlechten Passcode-Frame verwässert wird.

- [ ] **Schritt 1: Umsetzen** — [ ] **Schritt 2: Messen** — [ ] **Schritt 3: Committen**

---

### Task 11: Gate auswerten

**Files:** nur ein Bericht: `ml/ocr_bench/gate-<datum>.md`.

Das Gate aus Spec §7c: **Set-Code ≥ 90 %, Passcode ≥ 97 %, Edition ≥ 90 %** — gemessen am Messkorb, und zwar auf dem `rig`-Teil, nicht nur auf eBay.

- [ ] **Schritt 1: Endmessung** gegen die Nulllinie aus Task 6.
- [ ] **Schritt 2: Urteil** — je Feld erreicht/verfehlt, mit dem Beitrag jeder Maßnahme.
- [ ] **Schritt 3: Empfehlung** — bei Verfehlung ist Phase 2 aus Spec §7c fällig (ein eigenes CRNN-Bandmodell, trainiert über die bestehende Synthese-Pipeline). **Dieser Plan baut Phase 2 nicht.** Er liefert die Zahl, die die Entscheidung trägt, und die Entscheidung trifft der Nutzer.

---

## Spec-Abdeckung (Selbstprüfung)

| Spec-D-Abschnitt | Task |
|---|---|
| §4 Verifikation der Audit-Fixes am Gerät | 1 |
| §7b Layouts, Zonen je Layout, Zuordnung Typ → Layout, Belege im Repo | 2, 4, 5, 7 |
| §7b unbekannter Typ ⇒ zwei Layouts lesen | 7 |
| §7c Messkorb, `ocr_bench`, Kennzahlen je Feld/Layout/Aufbau | 3, 6 |
| §7c Maßnahmen 1–4, jede mit Vorher/Nachher | 7, 8, 9, 10 |
| §7c Gate und die Phase-2-Entscheidung | 11 |

**Bewusste Abweichungen (im Ledger festhalten):**
1. **`CardStrip` wird nicht gelöscht**, sondern zur `LEGACY`-Zone. Sonderdrucke (Promo-Rahmen, Jubiläumslayouts) fallen sonst durch jedes Raster; das ganze Band zu lesen ist dort besser als eine falsch platzierte Zone.
2. **Die Zonen werden gemessen, nicht von Hand gesetzt** (Task 2). Das Spec verlangt „ausgemessen, nicht geraten", sagt aber nicht wie; der gelabelte Korpus macht es automatisierbar, und die Streuung je Kante ist eine Aussage, die Handmessung nicht liefert.
3. **Der Messkorb ist zweiteilig** (eBay-Masse + ~20 Aufbau-Aufnahmen) statt der im Spec genannten 60–100 selbst fotografierten Karten. Grund: die 5.657 bereits gelabelten Fotos gibt es, und sie decken Layouts und Foils breiter ab, als der Nutzer an einem Abend fotografieren würde. Die Aufbau-Aufnahmen bleiben nötig, weil eBay-Fotos zu sauber sind.
4. **Phase 2 (eigenes CRNN) ist nicht Teil dieses Plans**, auch wenn das Gate sie auslöst. Sie wäre ein eigener Plan mit eigenem Trainings- und Auslieferungsweg (D1 liefert die Modelldateien bereits aus).
