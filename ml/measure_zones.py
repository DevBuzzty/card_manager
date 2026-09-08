#!/usr/bin/env python
"""Measure real OCR-zone rectangles (in artwork-box units), per card layout, from the labelled
harvest corpus -- instead of hand-guessing them like `CardStrip.kt`'s current single bottom band.

For every photo in `ml/data/harvest/labeled/<passcode>/` we already know the passcode PRINTED on
the card (that's how the corpus was labelled). So for each photo: run the trained detector to get
the artwork box, run EasyOCR on the region below it, and look for the one word/line whose text
equals the known passcode under the project's usual OCR digit-confusion tolerance (0/O, 1/I/l,
5/S, 8/B, ... -- see `android/.../ml/OcrText.kt`). Its position relative to the box, averaged (with
outlier rejection) over every layout's photos, is the real PASSCODE zone -- in the same
box-relative convention `CardStrip.kt` already uses: x from the box's LEFT edge in box-width
units, y from the box's BOTTOM edge (y2), downward, in box-height units.

We only have passcode ground truth right now (Task 3 adds set-code labels later). SET_CODE is
measured too, but on a positional heuristic rather than ground truth -- see `find_setcode_span`
docstring for why the brief's original "same line as the passcode" assumption turned out to be
wrong once real cards were inspected, and what was measured instead.

Restricts to the ~4,985 photos in `labeled_crops/crops_manifest.json` -- these are exactly the
photos where the detector already found a valid artwork box (the rest are known detector
failures, not worth re-running).

    python ml/measure_zones.py               # full run, writes ml/data/zones/
    python ml/measure_zones.py --dry-run      # 50 photos, prints stats, writes nothing
"""
import argparse
import gzip
import json
import random
import re
import statistics
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
import easyocr

# Reused from ml/crop_artworks.py: the detector was trained on artwork patches that are SMALL in
# a 640 scene, so a frame-filling eBay photo is out of distribution. Fix is a scale-sweep -- render
# the photo at a few sizes on a gray canvas, detect at each. See crop_artworks.py's docstring.
from crop_artworks import _sceneify

ML_DIR = Path(__file__).resolve().parent
HARV = ML_DIR / "data" / "harvest"
LABELED = HARV / "labeled"
CROPS_MANIFEST = HARV / "labeled_crops" / "crops_manifest.json"
DETECTOR = ML_DIR / "data" / "out" / "detector_fp32_backup.onnx"
ZONES_DIR = ML_DIR / "data" / "zones"

CATALOG_URL = ("https://uirfqwklvavgjklgqpnn.supabase.co/storage/v1/object/public/"
               "catalog/catalog.v3.json.gz")
CATALOG_CACHE = ML_DIR / "data" / "catalog.v3.json.gz"

# Same scale-sweep constants as crop_artworks.py.
SCALES = (0.40, 0.55, 0.70)
MIN_SCORE = 0.15

MIN_SAMPLES = 40          # below this, report "insufficient data" instead of guessing
PCTL = 0.95                # coverage target per zone edge
MARGIN = 0.02               # small margin added past the percentile edge, in box units
OUTLIER_K = 3.5             # robust-z reject threshold (MAD-scaled)
CAP = {"STANDARD": 400, "SPELL_TRAP": 400}   # bound runtime on the two big layouts; others use all

LAYOUTS = ["STANDARD", "PENDULUM", "LINK", "SPELL_TRAP", "SKILL"]

# Ported from android/app/src/main/java/com/example/yugiohscanner/ml/OcrText.kt's `confuse` map --
# the project's existing OCR digit-confusion tolerance (0/O, 1/I/l, 5/S, 8/B, ...).
CONFUSE = {
    'O': '0', 'o': '0', 'Q': '0', 'D': '0',
    'I': '1', 'l': '1', '|': '1', 'i': '1',
    'Z': '2', 'z': '2',
    'E': '3',
    'A': '4',
    'S': '5', 's': '5',
    'G': '6', 'b': '6',
    'T': '7',
    'B': '8',
    'g': '9', 'q': '9',
}

SETCODE_RE = re.compile(r"[A-Z0-9]{2,6}-[A-Z]{2}[A-Z0-9]{3,4}")


def layout_for_type(card_type):
    """Same mapping Task 4 hard-codes in Kotlin."""
    if card_type is None:
        return None
    # "Pendulum" anywhere, not startswith: YGOPRODeck also ships "XYZ Pendulum Effect Monster" (10)
    # and "Synchro Pendulum Effect Monster" (8). Those carry the Pendulum frame — and therefore the
    # Pendulum set-code position — but a startswith check silently filed all 18 under STANDARD.
    if "Pendulum" in card_type:
        return "PENDULUM"
    if card_type == "Link Monster":
        return "LINK"
    if card_type in ("Spell Card", "Trap Card"):
        return "SPELL_TRAP"
    if card_type == "Skill Card":
        return "SKILL"
    return "STANDARD"


def load_catalog():
    if not CATALOG_CACHE.exists():
        CATALOG_CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"Downloading catalog -> {CATALOG_CACHE}")
        urllib.request.urlretrieve(CATALOG_URL, CATALOG_CACHE)
    data = json.loads(gzip.decompress(CATALOG_CACHE.read_bytes()))
    return {int(c["id"]): c.get("type") for c in data["cards"]}


_det_sess = None


def det_sess():
    global _det_sess
    if _det_sess is None:
        _det_sess = ort.InferenceSession(str(DETECTOR))
    return _det_sess


_ocr_reader = None


def ocr_reader():
    global _ocr_reader
    if _ocr_reader is None:
        _ocr_reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    return _ocr_reader


def detect_box(img):
    """Scale-sweep artwork detection -- adapted from crop_artworks.py's `best_crop()`. Returns
    (x1, y1, x2, y2, score) in ORIGINAL image pixel coords, or None. Unlike `best_crop`, this
    returns the raw box instead of a resized square crop: we need the box's own position to
    measure OCR text relative to it, not a cropped copy of its pixels."""
    H, W = img.shape[:2]
    best, best_score = None, 0.0
    for f in SCALES:
        canvas, r, left, top = _sceneify(img, f)
        inp = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        out = det_sess().run(None, {"images": inp.transpose(2, 0, 1)[None]})[0][0]
        for x1, y1, x2, y2, score, _ in out:
            if score < MIN_SCORE:
                continue
            ox1, oy1 = (x1 - left) / r, (y1 - top) / r
            ox2, oy2 = (x2 - left) / r, (y2 - top) / r
            bw, bh = ox2 - ox1, oy2 - oy1
            if bw <= 0 or bh <= 0:
                continue
            # artwork is roughly square and a big chunk of the card -- rejects holo-sticker /
            # rarity-stamp false hits, same filter as crop_artworks.py.
            if not (0.6 < bw / bh < 1.7 and (bw * bh) / (W * H) > 0.10):
                continue
            if score > best_score:
                best_score = float(score)
                best = (max(0.0, ox1), max(0.0, oy1), min(float(W), ox2), min(float(H), oy2))
    if best is None:
        return None
    return (*best, best_score)


def _confusable_span(text, target):
    """Return the (start, end) char span in `text` whose digit-confusion-corrected content equals
    `target`, else None. Mirrors OcrText.kt's `findPasscode`: only correct a window that already
    looks passcode-like (>=6 of its chars already digits), so real words don't get mangled into
    false matches. Unlike OcrText.kt (which doesn't know the target and takes the first \\d{8} run
    it can find), we know the target passcode, so a single windowed compare replaces its two-pass
    fast-path/correction-pass split -- an all-digit window just maps to itself under CONFUSE."""
    n = len(target)
    for i in range(len(text) - n + 1):
        window = text[i:i + n]
        if sum(ch.isdigit() for ch in window) < 6:
            continue
        fixed = "".join(CONFUSE.get(ch, ch) for ch in window)
        if fixed == target:
            return (i, i + n)
    return None


def _sub_box(box, start, end, total_len):
    """Interpolate the pixel bounding box of a [start:end) character span within an EasyOCR word
    box that may span more text than just our match (e.g. '00102380 1 Auflage' merged into one
    detection). Assumes roughly uniform character width along the box's top/bottom edges."""
    (x1, y1), (x2, y2), (x3, y3), (x4, y4) = box  # top-left, top-right, bottom-right, bottom-left
    f0, f1 = start / total_len, end / total_len
    top_a, top_b = x1 + f0 * (x2 - x1), x1 + f1 * (x2 - x1)
    bot_a, bot_b = x4 + f0 * (x3 - x4), x4 + f1 * (x3 - x4)
    nx1, nx2 = min(top_a, bot_a), max(top_b, bot_b)
    ny1, ny2 = min(y1, y2), max(y3, y4)
    return (float(nx1), float(ny1), float(nx2), float(ny2))


def find_passcode_span(ocr_results, passcode):
    """First OCR box whose (confusion-corrected) text contains the exact passcode, as a pixel
    sub-box. A photo where nothing matches confidently contributes nothing -- no fallback to
    "the lowest text row"."""
    for box, text, _conf in ocr_results:
        span = _confusable_span(text, passcode)
        if span:
            return _sub_box(box, span[0], span[1], len(text))
    return None


def find_setcode_span(box_rel_y2, box_h, box_x1, box_w, ocr_results):
    """Positional+shape heuristic for the set-code text -- NOT ground truth (Task 3 will label
    set codes; this task only has passcode ground truth).

    The brief's original assumption was that the set code sits "on the same line, at the opposite
    side" of the passcode (mirroring CardStrip.kt's single bottom band covering both). Inspecting
    real photos (e.g. ml/data/harvest/labeled/00102380/ebay_1139.jpg, a Lava Golem RA01-DE001)
    shows this is wrong: the set code prints immediately below-right of the ARTWORK BOX itself
    (measured there at x_rel~[0.75,0.95], y_rel~[0.01,0.05] below the box), while the passcode
    sits at the very bottom of the whole card, y_rel~[0.39,0.46] below the box in that same photo
    -- a completely different line. So this looks for a code-shaped token (`SETCODE_RE`, e.g.
    "RA01-DE001") in a narrow band close under the box's right half, not near the passcode line.
    """
    for box, text, _conf in ocr_results:
        (x1, y1), (x2, _y2), _br, (x4, y4) = box
        cx = (x1 + x2) / 2
        cy = (y1 + y4) / 2
        rel_x = (cx - box_x1) / box_w
        rel_y = (cy - box_rel_y2) / box_h
        if not (0.35 < rel_x and -0.08 < rel_y < 0.35):
            continue
        m = SETCODE_RE.search(text.upper())
        if m:
            return _sub_box(box, m.start(), m.end(), len(text))
    return None


def measure_one(path, passcode):
    """Return dict with 'passcode' and optionally 'setcode' box-relative (x1,y1,x2,y2) samples,
    or None if detection failed."""
    img = cv2.imread(str(path))
    if img is None:
        return None
    det = detect_box(img)
    if det is None:
        return None
    bx1, by1, bx2, by2, _score = det
    bw, bh = bx2 - bx1, by2 - by1
    H, W = img.shape[:2]
    y_start = max(0, int(by1 + 0.85 * bh))   # comfortably above box.y2, covers set-code + passcode
    roi = img[y_start:H, 0:W]
    if roi.size == 0:
        return None
    results = ocr_reader().readtext(roi)
    # shift ROI-local OCR boxes back into full-image coords
    results = [([[px, py + y_start] for px, py in pts], text, conf) for pts, text, conf in results]

    out = {}
    pbox = find_passcode_span(results, passcode)
    if pbox:
        px1, py1, px2, py2 = pbox
        out["passcode"] = ((px1 - bx1) / bw, (py1 - by2) / bh, (px2 - bx1) / bw, (py2 - by2) / bh)
    sbox = find_setcode_span(by2, bh, bx1, bw, results)
    if sbox:
        sx1, sy1, sx2, sy2 = sbox
        out["setcode"] = ((sx1 - bx1) / bw, (sy1 - by2) / bh, (sx2 - bx1) / bw, (sy2 - by2) / bh)
    out["box"] = (bx1, by1, bx2, by2)
    return out


def reject_outliers(samples):
    """Robust (MAD-based) per-edge outlier rejection. Drops a sample if ANY of its 4 edges is
    more than OUTLIER_K scaled-MADs from that edge's median."""
    if len(samples) < 8:
        return samples
    arr = np.array(samples)  # (n, 4)
    med = np.median(arr, axis=0)
    mad = np.median(np.abs(arr - med), axis=0) * 1.4826
    mad = np.where(mad == 0, 1e-6, mad)
    keep = np.all(np.abs(arr - med) <= OUTLIER_K * mad, axis=1)
    return arr[keep].tolist()


def summarize(samples):
    """samples: list of (x1,y1,x2,y2) in box units. Returns the measured.json entry, or None if
    too few samples remain after outlier rejection."""
    n_raw = len(samples)
    clean = reject_outliers(samples)
    n = len(clean)
    if n < MIN_SAMPLES:
        return None, n_raw, n
    arr = np.array(clean)
    x1s, y1s, x2s, y2s = arr[:, 0], arr[:, 1], arr[:, 2], arr[:, 3]
    x_lo = float(np.percentile(x1s, (1 - PCTL) * 100)) - MARGIN
    x_hi = float(np.percentile(x2s, PCTL * 100)) + MARGIN
    y_lo = float(np.percentile(y1s, (1 - PCTL) * 100)) - MARGIN
    y_hi = float(np.percentile(y2s, PCTL * 100)) + MARGIN
    entry = {
        "x": [round(x_lo, 4), round(x_hi, 4)],
        "y": [round(y_lo, 4), round(y_hi, 4)],
        "n": n,
        "median": {
            "x1": round(float(np.median(x1s)), 4), "y1": round(float(np.median(y1s)), 4),
            "x2": round(float(np.median(x2s)), 4), "y2": round(float(np.median(y2s)), 4),
        },
        "std": {
            "x1": round(float(np.std(x1s)), 4), "y1": round(float(np.std(y1s)), 4),
            "x2": round(float(np.std(x2s)), 4), "y2": round(float(np.std(y2s)), 4),
        },
    }
    return entry, n_raw, n


def draw_evidence(path, passcode_zone, setcode_zone, box, out_path):
    img = cv2.imread(str(path))
    if img is None:
        return
    bx1, by1, bx2, by2 = box
    bw, bh = bx2 - bx1, by2 - by1
    cv2.rectangle(img, (int(bx1), int(by1)), (int(bx2), int(by2)), (0, 200, 0), 3)
    if passcode_zone:
        (x1, x2), (y1, y2) = passcode_zone["x"], passcode_zone["y"]
        p1 = (int(bx1 + x1 * bw), int(by2 + y1 * bh))
        p2 = (int(bx1 + x2 * bw), int(by2 + y2 * bh))
        cv2.rectangle(img, p1, p2, (0, 0, 255), 3)
    if setcode_zone:
        (x1, x2), (y1, y2) = setcode_zone["x"], setcode_zone["y"]
        p1 = (int(bx1 + x1 * bw), int(by2 + y1 * bh))
        p2 = (int(bx1 + x2 * bw), int(by2 + y2 * bh))
        cv2.rectangle(img, p1, p2, (255, 128, 0), 3)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    small = cv2.resize(img, (0, 0), fx=0.35, fy=0.35) if max(img.shape[:2]) > 900 else img
    cv2.imwrite(str(out_path), small, [cv2.IMWRITE_JPEG_QUALITY, 70])


def run(dry_run):
    catalog = load_catalog()
    manifest = json.loads(CROPS_MANIFEST.read_text())
    random.Random(0).shuffle(manifest)

    by_layout = {L: [] for L in LAYOUTS}
    for m in manifest:
        t = catalog.get(int(m["passcode"]))
        layout = layout_for_type(t)
        if layout:
            by_layout[layout].append(m)

    if dry_run:
        pool = manifest[:50]
        print(f"DRY RUN: {len(pool)} photos (diagnostic only, nothing written to disk)\n")
        buckets = {L: [] for L in LAYOUTS}
        for m in pool:
            t = catalog.get(int(m["passcode"]))
            layout = layout_for_type(t)
            if not layout:
                continue
            path = LABELED / m["file"]
            res = measure_one(path, m["passcode"])
            if res and "passcode" in res:
                buckets[layout].append(res["passcode"])
        for L, samples in buckets.items():
            if not samples:
                continue
            arr = np.array(samples)
            print(f"{L}: n={len(samples)}")
            print(f"  x1 median={np.median(arr[:,0]):.3f}  x2 median={np.median(arr[:,2]):.3f}")
            print(f"  y1 median={np.median(arr[:,1]):.3f}  y2 median={np.median(arr[:,3]):.3f}")
        return

    t0 = time.time()
    passcode_samples = {L: [] for L in LAYOUTS}
    setcode_samples = {L: [] for L in LAYOUTS}
    evidence_candidates = {L: [] for L in LAYOUTS}   # (path, per-image result) for evidence images
    total_tried = 0
    for L in LAYOUTS:
        pool = by_layout[L][:CAP.get(L)]
        for i, m in enumerate(pool, 1):
            path = LABELED / m["file"]
            total_tried += 1
            res = measure_one(path, m["passcode"])
            if res is None:
                continue
            if "passcode" in res:
                passcode_samples[L].append(res["passcode"])
                if "setcode" in res and len(evidence_candidates[L]) < 3:
                    evidence_candidates[L].append((path, res))
                elif len(evidence_candidates[L]) < 3:
                    evidence_candidates[L].append((path, res))
            if "setcode" in res:
                setcode_samples[L].append(res["setcode"])
            if i % 100 == 0:
                print(f"  {L}: {i}/{len(pool)} photos, {len(passcode_samples[L])} passcode matches")
        print(f"{L}: {len(pool)} tried, {len(passcode_samples[L])} passcode matches, "
              f"{len(setcode_samples[L])} setcode candidates")

    measured = {}
    for L in LAYOUTS:
        entry = {}
        p_entry, p_raw, p_clean = summarize(passcode_samples[L])
        if p_entry is None:
            entry["PASSCODE"] = "insufficient data"
            print(f"{L} PASSCODE: insufficient data (n={p_raw} raw, {p_clean} after outlier "
                  f"rejection, need >= {MIN_SAMPLES})")
        else:
            entry["PASSCODE"] = p_entry
        s_entry, s_raw, s_clean = summarize(setcode_samples[L])
        if s_entry is None:
            if s_raw:
                print(f"{L} SET_CODE: insufficient data (n={s_raw} raw, {s_clean} after outlier "
                      f"rejection, need >= {MIN_SAMPLES})")
        else:
            entry["SET_CODE"] = s_entry
        measured[L] = entry

    ZONES_DIR.mkdir(parents=True, exist_ok=True)
    (ZONES_DIR / "measured.json").write_text(json.dumps(measured, indent=2))

    for L in LAYOUTS:
        p_zone = measured[L].get("PASSCODE") if isinstance(measured[L].get("PASSCODE"), dict) else None
        s_zone = measured[L].get("SET_CODE")
        for idx, (path, res) in enumerate(evidence_candidates[L][:3], 1):
            draw_evidence(path, p_zone, s_zone, res["box"], ZONES_DIR / L / f"evidence_{idx}.jpg")

    dt = time.time() - t0
    print(f"\nDone: {total_tried} photos in {dt:.0f}s ({dt/max(total_tried,1):.2f}s/photo) "
          f"-> {ZONES_DIR / 'measured.json'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    run(args.dry_run)


if __name__ == "__main__":
    main()
