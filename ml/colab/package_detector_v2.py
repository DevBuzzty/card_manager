"""Upload-Paket fuer das Detektor-Neutraining in Colab (Spec 2026-09-17, Teil D-3).

Schreibt colab_upload/ygo-detector-v2.zip mit:
  ml/                 -- Code (ml/*.py, ml/colab/*.py)
  full_cards/         -- Stichprobe ganzer Kartenbilder (je frameType geschichtet), JPEG q85 + manifest.json
  cards/              -- Stichprobe nackter Artworks (fuer die ~20 % Szenen alter Art) + manifest.json
  artwork_window.json -- vermessene Artwork-Fenster je frameType
    python -m ml.colab.package_detector_v2 --full 5000 --arts 3000
"""
import argparse
import json
import random
import zipfile
from collections import defaultdict
from pathlib import Path

import cv2

from ml import config

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "colab_upload" / "ygo-detector-v2.zip"


def _jpg(path: Path) -> bytes:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buf.tobytes() if ok else path.read_bytes()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", type=int, default=5000)
    ap.add_argument("--arts", type=int, default=3000)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    full_dir = config.DATA_DIR / "full_cards"
    windows = json.loads((config.DATA_DIR / "artwork_window.json").read_text())

    full = [e for e in json.loads((full_dir / "manifest.json").read_text())
            if e["frame_type"] in windows and (full_dir / f"{e['artwork_id']}.jpg").exists()]
    by = defaultdict(list)
    for e in full:
        by[e["frame_type"]].append(e)
    pick = []
    for ft, es in by.items():
        # Pendel-Karten vollstaendig: sie sind selten (~2,7 %) und die Schwachstelle von v2.
        k = len(es) if "pendulum" in ft else max(20, round(a.full * len(es) / len(full)))
        pick += rng.sample(es, min(k, len(es)))

    arts = [e for e in json.loads((config.CARDS_DIR / "manifest.json").read_text())
            if (config.CARDS_DIR / f"{e['artwork_id']}.jpg").exists()]
    arts = rng.sample(arts, min(a.arts, len(arts)))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_STORED) as z:
        for p in sorted((ROOT / "ml").glob("*.py")) + sorted((ROOT / "ml" / "colab").glob("*.py")):
            z.write(p, p.relative_to(ROOT).as_posix())
        z.writestr("artwork_window.json", json.dumps(windows))
        z.writestr("full_cards/manifest.json", json.dumps(pick))
        for e in pick:
            z.writestr(f"full_cards/{e['artwork_id']}.jpg", _jpg(full_dir / f"{e['artwork_id']}.jpg"))
        z.writestr("cards/manifest.json", json.dumps(arts))
        for e in arts:
            z.writestr(f"cards/{e['artwork_id']}.jpg", _jpg(config.CARDS_DIR / f"{e['artwork_id']}.jpg"))
    print(f"{OUT}: {len(pick)} ganze Karten, {len(arts)} Artworks, {OUT.stat().st_size / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
