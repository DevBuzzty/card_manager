"""Detektor-Messkorb (Spec 2026-09-17-spec-detektor-neutraining.md, Teil D-1).

Misst einen detector.onnx Ende-zu-Ende auf echten Fotos, genau wie die App (DetectorModel +
ScanPipeline.embedBox): Letterbox 640, conf-Schwelle, jede Box -> Embedder -> Index. Ein Foto gilt
als Treffer, wenn IRGENDEINE Box den gelabelten Passcode mit sim >= MIN_SIM liefert. Box-Labels
braucht es dafuer nicht.

Koerbe:
  ebay   -- gelabelte Ernte (ml/ocr_bench/labels.csv -> ml/data/harvest/pool/<datei>), geschichtete
            Stichprobe je Layout, fester Seed
  stapel -- Diagnosefotos aus der Stapel-Halterung (docs/superpowers/ledgers/...), Passcode im Namen/Liste

Aufruf:
  python -m ml.detector_bench --detector android/app/src/main/assets/detector.onnx --n 600
"""
import argparse
import csv
import json
import random
import struct
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "android" / "app" / "src" / "main" / "assets"
LABELS = ROOT / "ml" / "ocr_bench" / "labels.csv"
POOL = ROOT / "ml" / "data" / "harvest" / "pool"
STAPEL = [
    (ROOT / "docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/abnahme-4-karte5.jpg", 77044671),
    (ROOT / "docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/performance-3-einwurf-1789648704793.jpg", 77044671),
    (ROOT / "docs/superpowers/ledgers/2026-09-17-stapel-lichtschranke/performance-3-einwurf-1789648716154.jpg", 77044671),
]
STAPEL_DIR = ROOT / "ml" / "data" / "stapel_fotos"   # weitere Halterungsfotos: <passcode>_<beliebig>.jpg
MIN_SIM = 0.6
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


class Pipeline:
    def __init__(self, detector: Path, conf: float):
        opts = ort.SessionOptions()
        self.det = ort.InferenceSession(str(detector), opts)
        self.emb = ort.InferenceSession(str(ASSETS / "embedder.onnx"), opts)
        raw = (ASSETS / "index.bin").read_bytes()
        n, dim = struct.unpack_from("<II", raw, 0)
        self.E = np.frombuffer(raw, "<f4", n * dim, 8).reshape(n, dim)
        self.P = np.frombuffer(raw, "<i4", n, 8 + n * dim * 4)
        self.conf = conf

    def boxes(self, img: Image.Image):
        w, h = img.size
        s = 640 / max(w, h)
        nw, nh = round(w * s), round(h * s)
        px, py = (640 - nw) / 2, (640 - nh) / 2
        L = Image.new("RGB", (640, 640), (114, 114, 114))
        L.paste(img.resize((nw, nh), Image.BILINEAR), (int(px), int(py)))
        x = np.asarray(L, np.float32).transpose(2, 0, 1)[None] / 255
        out = self.det.run(None, {self.det.get_inputs()[0].name: x})[0][0]
        return [((d[0] - px) / s, (d[1] - py) / s, (d[2] - px) / s, (d[3] - py) / s, float(d[4]))
                for d in out if d[4] >= self.conf]

    def embed(self, img: Image.Image, b):
        x1, y1 = max(0, int(b[0])), max(0, int(b[1]))
        x2, y2 = min(img.width, max(x1 + 1, int(b[2]))), min(img.height, max(y1 + 1, int(b[3])))
        c = img.crop((x1, y1, x2, y2))
        side = max(c.size)
        sq = Image.new("RGB", (side, side), (127, 127, 127))
        sq.paste(c, ((side - c.width) // 2, (side - c.height) // 2))
        t = ((np.asarray(sq.resize((224, 224), Image.BILINEAR), np.float32) / 255 - MEAN) / STD).transpose(2, 0, 1)[None]
        q = self.emb.run(None, {self.emb.get_inputs()[0].name: t})[0][0]
        q = q / np.linalg.norm(q)
        sims = self.E @ q
        i = int(np.argmax(sims))
        return int(self.P[i]), float(sims[i])


def ebay_korb(n: int, seed: int):
    rows = [r for r in csv.DictReader(open(LABELS, encoding="utf-8")) if r["passcode"].isdigit()]
    by = defaultdict(list)
    for r in rows:
        by[r["layout"] or "UNBEKANNT"].append(r)
    rng = random.Random(seed)
    out = []
    for layout, rs in sorted(by.items()):
        k = max(10, round(n * len(rs) / len(rows)))
        for r in rng.sample(rs, min(k, len(rs))):
            out.append((POOL / r["file"].split("/")[-1], int(r["passcode"]), layout))
    return out


def stapel_korb():
    out = [(p, pc, "STAPEL") for p, pc in STAPEL]
    if STAPEL_DIR.exists():
        for p in sorted(STAPEL_DIR.glob("*.jpg")):
            pc = p.stem.split("_")[0]
            if pc.isdigit():
                out.append((p, int(pc), "STAPEL"))
    return out


def run(pipe: Pipeline, korb):
    stats = defaultdict(lambda: [0, 0, 0])  # gruppe -> [fotos, mit_box, treffer]
    misses = []
    t0 = time.time()
    for path, pc, group in korb:
        img = Image.open(path).convert("RGB")
        bs = pipe.boxes(img)
        hit = any(p == pc and s >= MIN_SIM for p, s in (pipe.embed(img, b) for b in bs[:5]))
        for g in (group, "GESAMT"):
            st = stats[g]
            st[0] += 1
            st[1] += bool(bs)
            st[2] += hit
        if not hit:
            misses.append(str(path.name))
    return stats, misses, (time.time() - t0) / max(1, len(korb))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--detector", default=str(ASSETS / "detector.onnx"))
    ap.add_argument("--conf", type=float, default=0.6)
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=None, help="JSON-Ergebnis schreiben")
    a = ap.parse_args()
    pipe = Pipeline(Path(a.detector), a.conf)
    result = {"detector": a.detector, "conf": a.conf, "n": a.n, "seed": a.seed, "koerbe": {}}
    for name, korb in (("stapel", stapel_korb()), ("ebay", ebay_korb(a.n, a.seed))):
        stats, misses, sec = run(pipe, korb)
        print(f"== {name}: {len(korb)} Fotos, {sec * 1000:.0f} ms/Foto")
        for g, (f, b, h) in sorted(stats.items()):
            print(f"   {g:12s} fotos={f:4d}  mit Box={b / f:6.1%}  Treffer={h / f:6.1%}")
        result["koerbe"][name] = {g: {"fotos": f, "mit_box": b, "treffer": h} for g, (f, b, h) in stats.items()}
        result["koerbe"][name]["_fehlgriffe"] = misses[:50]
    if a.out:
        Path(a.out).write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
