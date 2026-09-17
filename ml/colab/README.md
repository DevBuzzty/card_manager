# Detektor-Neutraining in Google Colab

Spec: `docs/superpowers/specs/2026-09-17-spec-detektor-neutraining.md`.

## 1. Paket hochladen
`colab_upload/ygo-detector-v2.zip` in Google Drive hochladen, direkt in **Meine Ablage** (neben `ygo_out`).

## 2. Notebook
colab.research.google.com → **Neues Notebook** → **Laufzeit → Laufzeittyp ändern → T4-GPU**.

Zelle 1 – Drive verbinden, Paket entpacken, Pakete installieren:
```python
from google.colab import drive
drive.mount('/content/drive')
!mkdir -p /content/ygo-detector-v2 && cd /content/ygo-detector-v2 && unzip -q -o /content/drive/MyDrive/ygo-detector-v2.zip
!pip install -q ultralytics onnx onnxslim
```

Zelle 2 – Training starten (Szenen erzeugen + trainieren + ONNX nach Drive, mehrere Stunden):
```python
!cd /content/ygo-detector-v2 && python -m ml.colab.train_detector_v2
```

Das Ergebnis landet in Drive unter `ygo_out/out/detector_v2.onnx`.

## 3. Falls Colab die Verbindung trennt
Checkpoints liegen nach jeder Epoche in Drive (`ygo_out/out/runs_detector_v2`). Neue Sitzung:
Zelle 1 erneut ausführen, dann:
```python
!cd /content/ygo-detector-v2 && python -m ml.colab.train_detector_v2 --resume
```

## 4. Danach (lokal)
`detector_v2.onnx` aus Drive herunterladen und messen:
```bash
python -m ml.detector_bench --detector <pfad>/detector_v2.onnx --n 600
```
