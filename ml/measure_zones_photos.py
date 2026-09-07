#!/usr/bin/env python
"""Measure OCR zones from the user's OWN card photos, discovering the passcode instead of
being told it.

Why this exists next to measure_zones.py: PENDULUM stayed unmeasured because the labelled eBay
corpus only held 32 usable Pendulum photos against a 40-sample threshold, and Pendulum is the
layout that matters most -- its artwork window is genuinely WIDER than tall (measured on the
user's own rig frames: aspect 1.28-1.35 over 11 frames, against ~1.01 for every other layout),
so STANDARD's placeholder geometry is wrong for it twice over: wrong offsets AND a wrong
reference width.

Two things are different from measure_zones.py, and both follow from the input:

1. No label is supplied. The eBay corpus knew each photo's passcode from the harvest; a pile of
   fresh photos knows nothing. So the passcode is DISCOVERED: read the bottom of the card, take
   any 8-character run that corrects to all-digits, and accept it only if that number is a real
   card in the catalog AND that card has the layout we are measuring. With 14,523 valid passcodes
   out of 10^8, a misread landing on a real passcode of the right layout is vanishingly unlikely,
   so the catalog IS the label. The same OCR box that proved the passcode also locates it, so
   discovery costs no extra pass.

2. Checkpointed per photo. measure_zones.py only wrote at the end and a killed run lost 50
   minutes of work. Every photo's result is appended to a JSONL immediately; re-running skips
   what is already in there.

Scans are NOT usable for this. Measured on 11 real rig frames, only 1 yielded a passcode
location -- at 1440x1920 with the card filling a fraction of the frame, the passcode line is a
few pixels tall. Zone geometry is a property of the card DESIGN, so a sharp photo is the right
instrument; the analyzer's frames are the right instrument for judging OCR, which is Task 6's job.

    python ml/measure_zones_photos.py --dir ml/data/photos/pendulum --layout PENDULUM
    python ml/measure_zones_photos.py --dir ... --layout PENDULUM --limit 10   # Zehnerprobe

Out: ml/data/zones/photos_<layout>.jsonl    per-photo samples (checkpoint, resumable)
     ml/data/zones/photos_<layout>/*.png    evidence renders
     stdout                                  the measured entry, ready for zones_measured.json
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

import measure_zones as MZ  # detector, OCR reader, span maths, outlier rejection, summarize


def load_catalog_full():
    """{passcode:int -> (layout, {set codes})}. MZ.load_catalog() returns only {id: type}; the
    catalog-as-label rule needs each card's printings too."""
    import gzip
    if not MZ.CATALOG_CACHE.exists():
        MZ.load_catalog()                       # downloads it
    data = json.loads(gzip.decompress(MZ.CATALOG_CACHE.read_bytes()))
    out = {}
    for c in data["cards"]:
        codes = {p["code"].upper() for p in (c.get("printings") or []) if p.get("code")}
        out[int(c["id"])] = (MZ.layout_for_type(c.get("type")), codes)
    return out


def discover_passcode_span(results, catalog_types, want_layout):
    """Find the passcode by reading it, then prove it against the catalog.

    Returns (passcode_str, pixel_sub_box) or (None, None). Mirrors measure_zones._confusable_span's
    windowing rule -- only correct a window that is already >=6 digits, so ordinary words are never
    mangled into a number -- but compares against the catalog rather than a known target.
    """
    for box, text, _conf in results:
        for i in range(len(text) - 7):
            window = text[i:i + 8]
            if sum(ch.isdigit() for ch in window) < 6:
                continue
            fixed = "".join(MZ.CONFUSE.get(ch, ch) for ch in window)
            if not fixed.isdigit():
                continue
            entry = catalog_types.get(int(fixed))
            if entry is None:
                continue
            if entry[0] != want_layout:
                # A real passcode of the WRONG layout means the photo is not what we asked for
                # (or the sweep boxed a neighbouring card). Either way it is not a sample for
                # this layout -- skip it rather than silently mixing geometries.
                continue
            return fixed, MZ._sub_box(box, i, i + 8, len(text))
    return None, None


# measure_zones.find_setcode_span looks only in -0.08 < rel_y < 0.35 AND rel_x > 0.35 -- a
# position prior measured on STANDARD cards, where the set code prints immediately below the
# artwork on the right. That prior is actively wrong here, and looking at two cards side by side
# shows why: on a STANDARD card (01035143) the bottom line carries only the passcode and the
# edition, because the set code sits up under the artwork. On a PENDULUM card (13331639, Oberster
# Koenig Z-ARC) that space is taken by the pendulum effect box, so MP18-DE011 has moved down to
# the ATK/DEF line at the card's LEFT edge. Reusing STANDARD's window would have answered "the
# set code is where STANDARD says it is" by construction -- and in fact silently found it on only
# 2 of 10 photos.
#
# So: no position prior at all. Instead the CATALOG decides, exactly as the plan's Task 3 rule
# does -- we discovered the passcode, so we know that card's real printings, and a code-shaped
# token is accepted only if it IS one of them. That is strictly stronger than any window: it
# rejects the false positives a wide-open search would otherwise invite (SETCODE_RE happily
# matches "PEZIAL-BESCHW" inside "SPEZIALBESCHWOERUNG"), and it cannot bias the measurement
# toward a position we assumed in advance.
SETCODE_Y_RANGE = (-0.30, 1.60)   # only to stay below the artwork; deliberately far too wide


def find_setcode_span_by_catalog(box_y2, box_h, box_x1, box_w, results, known_codes, y_range):
    """Locate the set code by matching against `known_codes` (this card's real printings) rather
    than by where we expect it to be. Returns (code, pixel_sub_box) or (None, None)."""
    lo, hi = y_range
    for box, text, _conf in results:
        (_x1, y1), (_x2, _y2), _br, (_x4, y4) = box
        if not (lo < ((y1 + y4) / 2 - box_y2) / box_h < hi):
            continue
        upper = text.upper()
        for m in MZ.SETCODE_RE.finditer(upper):
            if m.group(0) in known_codes:
                return m.group(0), MZ._sub_box(box, m.start(), m.end(), len(text))
    return None, None


def measure_one(path, catalog_types, want_layout):
    """One photo -> {'passcode': rel-box, 'setcode': rel-box, 'box': px-box, 'pc': str} or a
    dict with 'skip' explaining why. Detection and OCR run once each."""
    img = cv2.imread(str(path))
    if img is None:
        return {"skip": "unlesbar"}
    det = MZ.detect_box(img)
    if det is None:
        return {"skip": "keine Artwork-Box"}
    bx1, by1, bx2, by2, _score = det
    bw, bh = bx2 - bx1, by2 - by1
    H, W = img.shape[:2]
    # Same ROI rule as measure_zones.measure_one: start comfortably above the box's lower edge so
    # both the set code (just under the box) and the passcode (card bottom) fall inside.
    y_start = max(0, int(by1 + 0.85 * bh))
    roi = img[y_start:H, 0:W]
    if roi.size == 0:
        return {"skip": "ROI leer"}
    results = MZ.ocr_reader().readtext(roi)
    results = [([[px, py + y_start] for px, py in pts], text, conf) for pts, text, conf in results]

    pc, pbox = discover_passcode_span(results, catalog_types, want_layout)
    if pc is None:
        return {"skip": "kein gueltiger Passcode gelesen"}

    # The detector hands back numpy float32; json.dumps refuses those, so every number that
    # reaches the checkpoint goes through float() first.
    out = {"pc": pc, "box": [float(v) for v in (bx1, by1, bx2, by2)],
           "ar": round(float(bw) / max(float(bh), 1.0), 3)}
    px1, py1, px2, py2 = pbox
    out["passcode"] = [float((px1 - bx1) / bw), float((py1 - by2) / bh),
                       float((px2 - bx1) / bw), float((py2 - by2) / bh)]
    code, sbox = find_setcode_span_by_catalog(
        by2, bh, bx1, bw, results, catalog_types[int(pc)][1], SETCODE_Y_RANGE)
    if sbox:
        sx1, sy1, sx2, sy2 = sbox
        out["code"] = code
        out["setcode"] = [float((sx1 - bx1) / bw), float((sy1 - by2) / bh),
                          float((sx2 - bx1) / bw), float((sy2 - by2) / bh)]
    return out


def load_done(jsonl):
    """Files already measured, so a re-run resumes instead of restarting."""
    done = {}
    if jsonl.exists():
        for line in jsonl.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                r = json.loads(line)
                done[r["file"]] = r
            except json.JSONDecodeError:
                continue          # a half-written last line from a killed run
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="Ordner mit Kartenfotos (eine Karte je Foto)")
    ap.add_argument("--layout", default="PENDULUM", choices=MZ.LAYOUTS)
    ap.add_argument("--limit", type=int, default=0, help="nur die ersten N Fotos (Zehnerprobe)")
    a = ap.parse_args()

    catalog = load_catalog_full()
    photos = sorted(p for p in Path(a.dir).iterdir()
                    if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if a.limit:
        photos = photos[:a.limit]
    print(f"{len(photos)} Fotos in {a.dir}, Layout {a.layout}")

    MZ.ZONES_DIR.mkdir(parents=True, exist_ok=True)
    jsonl = MZ.ZONES_DIR / f"photos_{a.layout}.jsonl"
    done = load_done(jsonl)
    if done:
        print(f"{len(done)} davon bereits gemessen, wird uebersprungen")

    skips = {}
    with jsonl.open("a", encoding="utf-8") as fh:
        for i, p in enumerate(photos, 1):
            if p.name in done:
                continue
            try:
                r = measure_one(p, catalog, a.layout)
            except Exception as e:                      # one bad photo must not kill the run
                r = {"skip": f"{type(e).__name__}: {e}"}
            r["file"] = p.name
            fh.write(json.dumps(r) + "\n")
            fh.flush()                                   # checkpoint, jedes Foto
            done[p.name] = r
            if "skip" in r:
                skips[r["skip"]] = skips.get(r["skip"], 0) + 1
            print(f"  {i}/{len(photos)} {p.name[:34]:<36} "
                  f"{'pc=' + r['pc'] + ' ar=' + str(r['ar']) if 'pc' in r else r.get('skip')}")

    rows = list(done.values())
    pass_s = [r["passcode"] for r in rows if "passcode" in r]
    set_s = [r["setcode"] for r in rows if "setcode" in r]
    ars = [r["ar"] for r in rows if "ar" in r]

    print()
    print(f"=== Ausbeute {a.layout}: {len(rows)} Fotos, "
          f"{len(pass_s)} mit Passcode ({100*len(pass_s)//max(len(rows),1)}%), "
          f"{len(set_s)} mit Set-Code ({100*len(set_s)//max(len(rows),1)}%) ===")
    for reason, n in sorted(skips.items(), key=lambda t: -t[1]):
        print(f"    verworfen: {reason} ({n})")
    if ars:
        print(f"    Seitenverhaeltnis der Boxen: min={min(ars):.2f} "
              f"median={float(np.median(ars)):.2f} max={max(ars):.2f}")

    entry = {}
    for name, samples in (("PASSCODE", pass_s), ("SET_CODE", set_s)):
        e, n_raw, n = MZ.summarize([tuple(s) for s in samples])
        if e is None:
            print(f"{name}: zu wenig Daten ({n} von {n_raw} nach Ausreisser-Filter, "
                  f"noetig >= {MZ.MIN_SAMPLES})")
        else:
            entry[name] = e
            print(f"{name}: n={e['n']}  x={e['x']}  y={e['y']}")
    if entry:
        print()
        print("--- fuer ml/zones_measured.json ---")
        print(json.dumps({a.layout: entry}, indent=2))

    # Evidence: the first few hits, box and located zones drawn on the real photo. Looking at one
    # of these has settled every geometry question in this project faster than reasoning about it.
    outdir = MZ.ZONES_DIR / f"photos_{a.layout.lower()}"
    outdir.mkdir(parents=True, exist_ok=True)
    def as_zone(s):
        """draw_evidence takes a summarize-shaped {"x": (lo, hi), "y": (lo, hi)}, not the flat
        (x1, y1, x2, y2) sample we store."""
        return {"x": (s[0], s[2]), "y": (s[1], s[3])}

    drawn = 0
    for r in rows:
        if drawn >= 3 or "passcode" not in r:
            continue
        src = Path(a.dir) / r["file"]
        if not src.exists():
            continue
        MZ.draw_evidence(src, as_zone(r["passcode"]),
                         as_zone(r["setcode"]) if "setcode" in r else None,
                         tuple(r["box"]), outdir / f"{src.stem}.png")
        drawn += 1
    if drawn:
        print(f"\nBelege: {outdir}")


if __name__ == "__main__":
    main()
