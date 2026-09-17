"""Detektor-Neutraining in Google Colab (Spec 2026-09-17, Teil D-3). Anleitung: ml/colab/README.md.

Erwartet das entpackte Paket unter DATA (ml/, full_cards/, cards/, artwork_window.json). Szenen werden
in Colab erzeugt (schneller als hochladen), Training schreibt Checkpoints nach Drive und kann nach
einer Trennung mit --resume weiterlaufen. Ergebnis: Drive ygo_out/out/detector_v2.onnx (mit NMS, Drop-in).
"""
import argparse
import shutil
import sys
import time
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="/content/ygo-detector-v2")
    ap.add_argument("--drive-out", default="/content/drive/MyDrive/ygo_out/out")
    ap.add_argument("--scenes", type=int, default=10000)
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--resume", action="store_true")
    a = ap.parse_args()
    t0 = time.time()
    data = Path(a.data)
    sys.path.insert(0, str(data))
    from ml import config
    config.DATA_DIR = data
    config.CARDS_DIR = data / "cards"
    config.BG_DIR = Path("/content/backgrounds")
    config.OUT_DIR = Path("/content/out")
    runs = Path(a.drive_out) / "runs_detector_v2"
    scenes = Path("/content/out/detect_v2")

    # Auch beim Fortsetzen: eine neue Colab-Sitzung hat /content leer; gleicher Seed -> gleiche Szenen.
    if not (scenes / "data.yaml").exists():
        from ml import download_backgrounds
        print("[1/3] DTD-Hintergruende laden ...", flush=True)
        download_backgrounds.download_dtd(config.BG_DIR)
        print(f"[2/3] {a.scenes} Szenen erzeugen ...", flush=True)
        # Im selben Prozess: config ist oben umgebogen, ein Unterprozess saehe die Standardpfade.
        from ml import generate_fullcard
        sys.argv = ["generate_fullcard", "--scenes", str(a.scenes), "--out", str(scenes), "--debug", "30"]
        generate_fullcard.main()

    from ultralytics import YOLO
    if a.resume:
        print("[3/3] Training fortsetzen ...", flush=True)
        YOLO(str(runs / "detector_v2" / "weights" / "last.pt")).train(resume=True)
    else:
        print(f"[3/3] YOLO11n trainieren: {a.epochs} Epochen, imgsz 640 ...", flush=True)
        YOLO("yolo11n.pt").train(data=str(scenes / "data.yaml"), epochs=a.epochs, imgsz=640, batch=a.batch,
                                 device=0, project=str(runs), name="detector_v2", exist_ok=True,
                                 save_period=1, patience=15)
    best = runs / "detector_v2" / "weights" / "best.pt"
    onnx = YOLO(str(best)).export(format="onnx", nms=True, imgsz=640)
    shutil.copy(onnx, Path(a.drive_out) / "detector_v2.onnx")
    print(f"FERTIG in {(time.time() - t0) / 60:.0f} min -> {Path(a.drive_out) / 'detector_v2.onnx'}", flush=True)


if __name__ == "__main__":
    main()
