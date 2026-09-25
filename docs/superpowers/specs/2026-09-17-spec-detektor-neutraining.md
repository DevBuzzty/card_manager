# Spec: Detektor neu trainieren – ganze Karten statt nackter Artworks

Stand 17.09.2026 · **Umgesetzt** (Nachtrag 26.09.2026)

> **Ergebnis:** Detektor v2 (ganze Karten, `4e7036e`/`d597177`, gemergt `3a5597c`) und v3 (Pendel, `dd0504a`/`469506d`) sind in der App.
> Messkorb `ml/detector_bench.py`, Ende-zu-Ende-Trefferquote, conf 0,6:
>
> | Korb | alt | v2 | v3 |
> |---|---|---|---|
> | eigene Fotos (Halterung + Boden) | 0/3 | 3/3 | **93/94 (98,9 %)** — Ziel ≥ 95 % erreicht |
> | eBay/Kleinanzeigen gesamt | 44,4 % | 77,5 % | **79,4 %** — Ziel ≥ 85 % nicht erreicht |
> | davon Pendel | 0 % | 20 % | 80 % |
>
> Der Detektor findet auf 605/608 eBay-Fotos eine Box (99,5 %). Die restlichen ~20 % Fehlgriffe entstehen danach beim
> **Embedder** (falsche Karte gewählt) — der ist nach §7 nicht Teil dieser Spec. Messdateien: `ml/ocr_bench/detector-*.json`.

## 1. Warum
Befund `docs/superpowers/ledgers/2026-09-17-kartenerkennung-befund/befund.md`:
- `detector.onnx` (YOLO11n, 640, eine Klasse) wurde mit **nackten Artworks** (`image_url_cropped`) auf
  DTD-Texturen trainiert (`ml/compose_scene.py`). Ein Artwork **im Kartenrahmen** kennt er nicht.
- Auf den Diagnosefotos aus der Stapel-Halterung: 0 Boxen. Dasselbe Artwork ausgeschnitten und aufgeklebt: 0,97.
- Der Embedder erkennt ausgeschnittene Artworks sicher (0,73–0,85) – der Detektor ist der einzige Engpass.
- Die Umrandungs-Suche (gemergt 4835a5b) überbrückt das nur im festen Aufbau; aus der Hand, mehrere Karten
  nebeneinander oder außerhalb der Umrandung hilft nur ein Detektor, der echte Karten sieht.

## 2. Ziel
Ein neuer `detector.onnx`, der **Drop-in** ist (gleiche Ein-/Ausgabe: `images [1,3,640,640]` →
`output0 [1,300,6]` mit NMS), und auf echten Fotos das **Artwork-Fenster ganzer Karten** boxt – so eng,
dass Embedder und Zonen-OCR (Set-Code, Passcode) wie heute darauf aufsetzen.

Die Box bleibt das **Artwork** (nicht die ganze Karte): Embedder-Index, `CardZones`/`CardLayout`-Geometrie und
die Umrandungs-Suche hängen daran. Keine App-Änderung nötig außer dem Modell.

## 3. Messung zuerst (Abnahmekriterium)
Neues Skript `ml/detector_bench.py` (reines Python, onnxruntime, Nachbau wie `det_replica.py`):
- **Messkorb echte Fotos**: (a) Stapel-Diagnosefotos + neue Fotos aus der Halterung, (b) die gelabelten
  eBay-/Kleinanzeigen-Fotos aus `ml/ocr_bench/labels.csv` (5 651 Einträge, Passcode je Foto).
- **Metrik ohne Box-Labels**: Anteil Fotos, bei denen *irgendeine* Detektor-Box → Embedder den **richtigen
  Passcode** mit sim ≥ 0,6 liefert („Ende-zu-Ende-Trefferquote"), dazu Anteil Fotos mit ≥ 1 Box und
  Laufzeit. Gleiches Skript für alt und neu.
- **Baseline heute messen**, bevor trainiert wird.
- **Abnahme**: Trefferquote neu deutlich über alt (Ziel ≥ 85 % auf dem eBay-Korb, Stapel-Fotos ≥ 95 %),
  keine Verschlechterung auf nackten Artworks (Regressionskorb aus synthetischen Szenen alter Art).
  Am Gerät: Stapel-Test 10/10 mit Treffern überwiegend aus dem Detektor (Umrandungs-Suche nur Rückfall),
  plus Handscan einzelner Karten und zwei Karten nebeneinander.

## 4. Trainingsdaten (neu)
Erweiterung von `ml/compose_scene.py`/`ml/generate.py`, bestehende Augmentierungen bleiben:
1. **Ganze Kartenbilder** (`image_url` statt `image_url_cropped`) als Vordergrund. Label = Artwork-Fenster,
   aus der Rahmen-Geometrie je Kartentyp berechnet (normal/Zauber/Falle quadratisch, Pendel breit, Link
   quadratisch) und **durch dieselbe Perspektiv-Warp-Matrix** transformiert wie die Karte.
   Die Geometrie wird an den digitalen Vollbildern vermessen (`ml/measure_zones_digital.py` liefert die
   Grundlage) und per Stichprobe mit Debug-Overlays geprüft.
2. **Mischung**: ~70 % ganze Karten, ~20 % nackte Artworks (bisheriges Verhalten erhalten), ~10 % Szenen
   ohne Karte (`--bg-fraction`, gibt es schon).
3. **Realistischere Szenen**: Karten **gestapelt/versetzt** (wie in der Box), teils überlappend, Karte füllt
   bis ~80 % der Szene (heute max. 45 %), Karton-/Holz-/Tisch-Hintergründe, Finger-/Hand-Verdeckung am Rand,
   Glitzer/Foil (vorhanden), leichte Unschärfe, Schrägsicht.
4. Größe: ~20–30 k Szenen (heute: bisheriger Produktionslauf), Validierung 10 %.

## 5. Training & Auslieferung
- Wie beim Embedder-Training: **Google Colab** mit GPU und Drive-Anbindung (Ergebnisse unter Drive `ygo_out/out/`),
  Trainingscode aus `ml/kaggle/train_production.py` (nur Detektor-Teil), Paket über `ml/kaggle/package_data.py`
  um ganze Kartenbilder erweitert. **Hochladen und Starten in Colab macht der Nutzer**; Anleitung als Notebook-Zellen.
- Export ONNX mit NMS, gleiche I/O; lokal `ml/detector_bench.py` alt vs. neu.
- Auslieferung: als APK-Asset und/oder über `ModelStore` (Supabase-Bucket, Versionsnummer +1) – Entscheidung
  nach Messung. Rückweg: altes Modell bleibt im Bucket als vorherige Version.

## 6. Aufteilung
1. **D-1 Messung**: `detector_bench.py`, Messkorb zusammenstellen, Baseline alt. *Braucht die Daten (§8).*
2. **D-2 Daten**: ganze Kartenbilder laden, Artwork-Geometrie je Typ, Szenen-Generator erweitern, Overlays prüfen.
3. **D-3 Training**: Paket, Colab-Lauf (Nutzer), Export, Messung neu vs. alt.
4. **D-4 Gerät**: Modell ausliefern, Stapel- und Handscan-Abnahme.

## 7. Nicht Teil davon
Embedder-Neutraining, Index-Neubau, Passcode-/Set-Code-OCR-Logik, Umrandungs-Suche (bleibt als Rückfall).

## 8. Offene Fragen an den Nutzer
1. ~~Trainingsdaten~~: auf Drive (`ygo-scanner-data.zip` 2,1 GB, `ygo-pool.zip` 4,2 GB), Nutzer hat Laden freigegeben.
2. ~~Trainingsumgebung~~: Google Colab (wie beim Embedder).
3. Dürfen für den Messkorb **ein paar Dutzend Fotos aus der Halterung** gesammelt werden (verschiedene
   Karten, auch aus der Hand)? Dafür käme ein einfacher Foto-Knopf in eine Mess-APK.
