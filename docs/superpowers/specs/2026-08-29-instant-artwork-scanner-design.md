# Instant Multi-Card Artwork-Scanner — Master-Design

**Datum:** 2026-08-29
**Status:** Master-Plan abgesegnet. Detailplanung (Phase 1) folgt.
**Kontext:** Ersetzt die bisherige Scan-Erkennung (ML-Kit-OCR des 8-stelligen Passcodes,
`CardAnalyzer` in `android/.../MainActivity.kt`). Ziel: „instant, Multi-Karte, draufhalten"
auf Neuron-/Delver-Niveau, plus exakte Rarity.

---

## Warum der Umbau

Die aktuelle Pipeline ankert die Identität am **Passcode** — dem physisch kleinsten Text
auf der Karte. Folgen: Kamera muss nah+scharf auf die Ecke, viele Frames scheitern,
3 Bestätigungen nötig (zäh), Rarity fast nie (hängt am ebenfalls winzigen Set-Code),
und jeder Treffer geht per WebSocket zum Desktop (Latenz + Desktop-Abhängigkeit).

Die „guten" Apps ankern am **Artwork**, nicht am Text:
- **Konami Neuron**: KI-Bilderkennung, >9000 Karten, bis 20 gleichzeitig. Erkennt aber
  **keine Rarity** — Rarity steckt nicht im Artwork.
- **Delver Lens / TCGplayer**: Perceptual Hash (pHash) bzw. gelernte Modelle, on-device.

**Kern-Erkenntnis Rarity:** Artwork ist in allen Sprachen identisch → gibt die *Karte*,
nie die *Auflage/Rarity*. Rarity kommt ausschließlich aus dem **Set-Code → Printing-Lookup**.
→ Zwei Signale nötig: Artwork (Identität, instant) + Set-Code-OCR (Rarity, wenn lesbar).

---

## Abgesegnete Entscheidungen

| Frage | Entscheidung |
|---|---|
| Ansatz | Voll bildbasiert (Artwork-Match), nicht OCR-des-Passcodes |
| Match-Ort | **On-Device** (Phone matcht offline; Index wird am Desktop gebaut) |
| Was hashen/erkennen | **Nur Artwork** (sprachunabhängig; YGOPRODeck `image_url_cropped`) |
| Erfassung | **Auto-Detection** (kein Ausricht-Rahmen) |
| Umfang | **Multi-Karte** von Anfang an eingeplant |
| Matching-Methode | **Deep Embeddings** (nicht pHash — nötig für Robustheit ohne Rahmen) |
| Modell-Tiefe | **Selbst trainieren** (eigener Detector + Embedder, synthetische Daten) |
| Index-Lieferung | **Über Supabase Cloud**, Phone cached, offline nutzbar |
| Rarity | Set-Code-OCR pro Kartenregion, sonst `Unknown`-Bucket (bestehend) |
| Emit | Bestehender `card_scanned`-Vertrag, erweitert zu **Batch** |

---

## Architektur: drei entkoppelte Subsysteme

Verbunden **nur über Daten-Verträge**, nicht über Code. Jedes isoliert baubar/testbar.

- **A — ML-Training** (neu, `ml/`, Python): erzeugt zwei Modelle aus synthetischen Daten.
- **B — Desktop** (`desktop/electron/`): baut Embedding-Index, hostet Modelle+Index (Supabase).
- **C — Android**: Kamera → Detection → Warp → Matching → Multi-Karte-Tracking →
  Rarity-OCR → Batch-Emit.

### Geteiltes Fundament: Daten & synthetischer Generator
- Bulk-Download aller ~13k Karten (`cardinfo.php` ohne Filter) inkl. aller
  `image_url_cropped` (Alt-Artworks als separate Einträge). Lokal gecacht.
- **Synthese-Generator** (`ml/`): komponiert Kartenbilder auf zufällige Hintergründe mit
  Perspektive, Beleuchtung, **Foil-Glanz**, Unschärfe, Rauschen, **Überlappung**.
  Liefert (a) Szenen mit Bounding-Boxen für den Detector, (b) augmentierte Einzel-Arts
  für den Embedder. Ein Generator, zwei Abnehmer. Macht Training ohne Hand-Labeling möglich.

### Subsystem A — Training (offline, GPU nötig)
- **Detector**: kompaktes YOLO-nano → Instanz-Boxen je Karte (verkraftet Überlappung
  besser als Segmentierung). Danach Eck-Verfeinerung → Perspektiv-Warp.
- **Embedder**: MobileNetV3-small → **128-d Embedding**, Metric-Learning (ArcFace/Triplet)
  über ~20k Artwork-„Klassen".
- **Stack**: PyTorch → Export **ONNX**. Ein Export, zwei Runtimes:
  ONNX (Desktop-Index) + ONNX→TFLite (Phone).
- Artefakte: `detector.{onnx,tflite}`, `embedder.{onnx,tflite}`, versioniert.

### Subsystem B — Desktop
- **Index-Builder** (`electron/artwork-index.cjs`, neu): Embedder via `onnxruntime-node`
  über alle Artwork-Crops → Embedding-Index `[{vec: f32[128], passcode}]`.
  ~20k × 512 B ≈ **~10 MB**.
- **Asset-Hosting**: Modelle + Index + **Manifest** (`version`, counts, `createdAt`,
  `embedderVersion`) in Supabase Storage.
- Settings-Button „Scan-Assets aktualisieren"; Crops + Embeddings inkrementell cachen.

### Subsystem C — Android
- **Asset-Sync**: beim Scanner-Start Manifest vergleichen → Modelle+Index einmal laden,
  cachen, offline lauffähig.
- **Pipeline pro Frame**: Detector → N Boxen → je Box perspektiv-entzerren → Embedder →
  **Cosinus-NN** über Index (Brute-Force ~20k×128 = sub-ms/Karte; kein ANN nötig).
- **Multi-Karte + Stabilität**: Detections über Frames per IoU-Tracking → Voting pro
  *physischer* Karte.
- **Rarity**: pro bestätigter Karte Set-Code-OCR in ihrer Region (bestehende ML-Kit-Logik)
  → exakte Printing/Rarity, sonst `Unknown`.
- **Emit**: Batch [{passcode, setCodes}]; Desktop-Staging zeigt den Stapel.

---

## Daten-Verträge (die einzigen Kopplungen)
1. **Modell-I/O-Shapes** (Input-Auflösung, Output-Tensoren) — A↔B↔C.
2. **Index-Binärformat + Manifest** — B↔C. Index nur gültig für den Embedder, mit dem
   er gebaut wurde → Manifest erzwingt `embedderVersion`-Kompatibilität.
3. **Batch-Emit-Schema** — C↔Desktop-Staging.

---

## Empfohlene Defaults (in Detailplanung justierbar)
YOLO-nano Detector · MobileNetV3-small / 128-d Embedder · PyTorch→ONNX→TFLite ·
Brute-Force-NN · ~20 MB Gesamt-Assets aufs Phone.

---

## Phasen (Step by Step, jede verifizierbar)
1. **Fundament**: Bulk-Download + Synthese-Generator → verify: Szenen+Labels und
   augmentierte Arts plausibel.
2. **Embedder + Desktop-Index** → verify: Query-Art matcht korrekten Passcode auf
   Halte-Set (Top-1-Genauigkeit).
3. **Detector** → verify: Karten in Multi-Karten-Testbildern korrekt lokalisiert (mAP/IoU).
4. **Android Single-Card** (Detector→Warp→Embedder→NN) → verify: bekannte Karte <1 s,
   freihand ohne Rahmen.
5. **Android Multi-Card** (Tracking + Batch-Emit + Set-Code-OCR je Region) → verify:
   Stapel von N Karten in einem Schwenk + Rarity.
6. **Tuning**: Schwellen, Glanz, Randfälle (Pendulum/Full-Art) → verify: Trefferquote/
   Fehlmatches an echtem Stapel.

---

## Risiken
- **Training braucht GPU** (lokal/Cloud) + ML-Iteration.
- **Überlappende Karten** = härtester Detection-Fall → Synthese muss das stark abdecken.
- **Foil-Glanz** → Augmentierung muss Glanz/Reflexe realistisch simulieren, sonst
  Praxis-Lücke.
- **Modell↔Index-Versionierung** streng halten (Manifest).

---

## Offene Detailfragen für morgen (Phase-1-Planung)
- Synthese-Generator: Bibliothek/Sprache (OpenCV+PIL vs. Blender-Renders?), wie viele
  Szenen, Verteilung Karten-pro-Szene, Hintergrund-Quelle.
- Foil-Glanz realistisch modellieren — konkrete Augmentierungs-Technik.
- Detector-Output exakt: Boxen vs. orientierte Boxen vs. Eck-Regression für den Warp.
- Embedder-Loss konkret (ArcFace vs. Sub-Center-ArcFace vs. Triplet) + Klassen-Handling
  bei ~20k.
- Trainings-Compute: lokal vs. Cloud, Budget/Zeit.
- Exakte Modell-Input-Auflösungen (fixiert den Vertrag).
- Batch-Emit-Schema-Details + wie die Desktop-Staging N Karten anzeigt.
- Ob gescannte Karten (perspektivisch) auch direkt in die Phone-Cloud-Collection sollen
  statt nur Desktop-Staging (offen gelassen).

---

## Bewusst NICHT in v1 (YAGNI)
Kein pHash-Fallback als Dauerlösung · kein ANN (Brute-Force reicht bei 20k) ·
keine perfekte Behandlung von Pendulum/Full-Art in Phase 1.
