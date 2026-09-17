# Befund: Kartenerkennung im Stapel-Aufbau (17.09.)

Nachbau von DetectorModel + ScanPipeline in Python (`det_replica.py`, Modelle aus `android/app/src/main/assets`)
auf den Diagnosefotos `../2026-09-17-stapel-lichtschranke/abnahme-4-karte5.jpg` und `performance-3-*.jpg`
(exakt die Analysebilder des Handys, 1440x1920).

## Detektor (detector.onnx, YOLO11n, conf 0.6)
- Auf allen drei Fotos: **keine einzige Box** (hoechster Score 0,0 -- unter der eingebauten NMS-Schwelle).
- Auch Ausschnitte (ganze Karte bildfuellend, Artwork mit 0-200 px Kartenrand) -> nichts.
- **Dasselbe Artwork, ausgeschnitten und auf grau/Rauschen/das Foto geklebt** (20-45 % der Szene) -> 0,95-0,97.
- Kontrast x1,8 bzw. 90 Grad gedreht -> vereinzelt schiefe Teil-Boxen (0,53-0,69).
- Ursache: Training (`ml/generate.py` -> `compose_scene`) klebt **nackte Artworks** (`image_url_cropped`) auf
  DTD-Texturen. Ein Artwork **im Kartenrahmen** hat der Detektor nie gesehen.
- Folge am Handy: fast alle Treffer aus der Ganzbild-OCR (jedes 3. Bild, Box 18/12/82/88 %), langsam,
  Passcode einmal verlesen.

## Embedder + Index (embedder.onnx, index.bin 14 493 Karten)
- Artwork von Hand ausgeschnitten: **77044671 auf allen drei Fotos**, sim 0,78-0,84 (minSim 0,6), auch EN-Karte.
- Ausschnitt 40-60 px verschoben / 30-40 px groesser/kleiner: weiter richtig, sim 0,68-0,83.
- Erst grob daneben (150 px hoch, 120 px groesser): falsch (sim 0,45, unter minSim -> verworfen).

=> Nicht Glitzer, nicht Kartengroesse: **der Detektor ist der Engpass**, der Rest der Kette funktioniert.

## Umrandungs-Suche am Geraet (feat/umrandungs-erkennung)
- Geraet 1 (geraet-1-roh.log): 10/10 Einwuerfe gebucht, Einwurf->+1 0,4-1,9 s, keine Haenger. Umrandung am
  Geraet 0,235-0,765 x 0,208-0,792 -> ARTWORK_REL nachkalibriert (0,16/0,27/0,87/0,70, Skala 0,9).
- Geraet 2 (geraet-2-roh.log): 167 Umrandungs-Treffer, 5/5 gebucht. Set-Code nur 1/5 gesendet: Bestaetigung
  ~0,3 s nach Einwurf (zu frueh fuer OCR-Belege) und Zonen-OCR fuer Umrandungs-Boxen uebersprungen
  (Seitenverhaeltnis 1,12 durch Schraegsicht, "Box ist kein Artwork"). -> eigener Schritt.
