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
import re
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


_CODE_KEY_RE = re.compile(r"^([A-Z0-9]{2,6})-[A-Z]{1,3}[A-Z]?(\d{2,4})$")


def code_key(code):
    """(prefix, number) with the REGION dropped, e.g. 'DIFO-DE019' and 'DIFO-EN019' both give
    ('DIFO', '19').

    Necessary because the offline catalog carries English codes only -- measured: 0 of its 14,014
    cards with printings has a single DE or G code, while every card being photographed here is
    German. Matching the full string would therefore never succeed.

    This is safe HERE and only here. The project's standing rule is never to derive a German set
    code from an English one, because the region infix genuinely differs (DE vs G) and guessing it
    would write a wrong code into the collection. Nothing is written here: the key is used purely
    to confirm that a token on the card is that card's set code, so that its POSITION can be
    measured. Prefix plus number is specific enough for that -- and the code that gets recorded
    is the one OCR actually read, never a reconstructed one.
    """
    m = _CODE_KEY_RE.match(code)
    return (m.group(1), m.group(2).lstrip("0") or "0") if m else None


def find_setcode_span_by_catalog(box_y2, box_h, box_x1, box_w, results, known_codes, y_range):
    """Locate the set code by matching against `known_codes` (this card's real printings) rather
    than by where we expect it to be. Returns (code, pixel_sub_box) or (None, None)."""
    lo, hi = y_range
    known_keys = {k for k in (code_key(c) for c in known_codes) if k}
    for box, text, _conf in results:
        (_x1, y1), (_x2, _y2), _br, (_x4, y4) = box
        if not (lo < ((y1 + y4) / 2 - box_y2) / box_h < hi):
            continue
        upper = text.upper()
        for m in MZ.SETCODE_RE.finditer(upper):
            if code_key(m.group(0)) in known_keys:
                return m.group(0), MZ._sub_box(box, m.start(), m.end(), len(text))
    return None, None


ROTATIONS = (0, 90, 180, 270)
_CV_ROT = {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}


def measure_one(path, catalog_types, want_layout, rot_hint=0):
    """One photo -> a measurement dict, or {'skip': reason}.

    Photographing a portrait card with the phone held landscape leaves the card lying on its
    side, and then the whole geometry is nonsense: the ROI under the artwork covers table, not
    card. Observed on the user's first ten photos -- every one detected its artwork fine (score
    0.90) at aspect 0.76, which is 1/1.31, a Pendulum box turned 90 degrees, and every one
    yielded no passcode.

    So try the four right-angle rotations and keep the first that produces a catalog-valid
    passcode of the wanted layout. That check is strict enough to make a wrong rotation
    essentially unacceptable, so this cannot silently pick a bad orientation. `rot_hint` (the
    rotation that worked on the previous photo) is tried first, because a person holding the
    phone one way holds it that way for the whole batch -- so in practice this costs one attempt
    per photo, not four.
    """
    order = [rot_hint] + [r for r in ROTATIONS if r != rot_hint]
    first_skip = None
    for rot in order:
        r = _measure_at(path, catalog_types, want_layout, rot)
        if "skip" not in r:
            r["rot"] = rot
            return r
        if first_skip is None:
            first_skip = r["skip"]
    return {"skip": first_skip or "kein gueltiger Passcode gelesen"}


def _measure_at(path, catalog_types, want_layout, rot):
    """One photo at one rotation. Detection and OCR run once each."""
    img = cv2.imread(str(path))
    if img is None:
        return {"skip": "unlesbar"}
    if rot:
        img = cv2.rotate(img, _CV_ROT[rot])
    det = MZ.detect_box(img)
    if det is None:
        return {"skip": "keine Artwork-Box"}
    bx1, by1, bx2, by2, _score = det
    bw, bh = bx2 - bx1, by2 - by1
    H, W = img.shape[:2]
    # ROI: start above the box's lower edge so the set code (just under the box on STANDARD) and
    # the passcode (card foot) both fall inside, as in measure_zones.measure_one -- but BOUNDED,
    # not "everything below, full width".
    #
    # That mattered more than expected. A 12 MP phone photo gave a 2646x1653 full-width strip,
    # EasyOCR downscales an input that large internally, and the passcode line -- perfectly
    # legible to the eye at full size, DIFO-DE083 / 26435595 -- came back as nothing on 4 of 11
    # photos. The photos were fine; the ROI was wrong. Cropping to the card and upscaling makes
    # the text large relative to whatever EasyOCR resizes to.
    # Two ROI strategies, tried in order until one yields a catalog-valid passcode.
    #
    # "tight" crops to the card and upscales; "wide" is measure_zones' original everything-below-
    # full-width strip. Neither dominates: tight recovered two photos wide had missed, and wide
    # holds two that tight loses -- EasyOCR's internal resizing is simply not monotonic in input
    # size. Since the catalog validates every hit, taking the first that works costs only a second
    # OCR pass on photos that would otherwise have failed outright, and can never accept a worse
    # answer. Measured on the same 11 photos: wide 7, tight 8, both 9.
    for mode in ("tight", "wide"):
        if mode == "tight":
            x_lo, x_hi = max(0, int(bx1 - 0.35 * bw)), min(W, int(bx2 + 0.35 * bw))
            y_start, y_end = max(0, int(by1 + 0.85 * bh)), min(H, int(by2 + 1.6 * bh))
        else:
            x_lo, x_hi = 0, W
            y_start, y_end = max(0, int(by1 + 0.85 * bh)), H
        roi = img[y_start:y_end, x_lo:x_hi]
        if roi.size == 0:
            continue
        scale = 1.0
        if mode == "tight":
            # A 12 MP photo gives a ~2600 px strip; EasyOCR downscales an input that large, and a
            # passcode line perfectly legible at full size (DIFO-DE083 / 26435595) came back empty
            # on 4 of 11 photos. Normalising the crop to ~1600 px makes the text large relative to
            # whatever EasyOCR resizes to.
            scale = 1600.0 / roi.shape[1]
            interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
            roi = cv2.resize(roi, None, fx=scale, fy=scale, interpolation=interp)
        raw = MZ.ocr_reader().readtext(roi)
        # OCR ran on a scaled crop; map every box back to full-image coordinates.
        results = [([[px / scale + x_lo, py / scale + y_start] for px, py in pts], text, conf)
                   for pts, text, conf in raw]
        pc, pbox = discover_passcode_span(results, catalog_types, want_layout)
        if pc is not None:
            break
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
    rot_hint = 0
    with jsonl.open("a", encoding="utf-8") as fh:
        for i, p in enumerate(photos, 1):
            if p.name in done:
                continue
            try:
                r = measure_one(p, catalog, a.layout, rot_hint)
            except Exception as e:                      # one bad photo must not kill the run
                r = {"skip": f"{type(e).__name__}: {e}"}
            r["file"] = p.name
            if "rot" in r:
                rot_hint = r["rot"]                     # the batch is shot one way; remember it
            fh.write(json.dumps(r) + "\n")
            fh.flush()                                   # checkpoint, jedes Foto
            done[p.name] = r
            if "skip" in r:
                skips[r["skip"]] = skips.get(r["skip"], 0) + 1
            print(f"  {i}/{len(photos)} {p.name[:34]:<36} "
                  f"{'pc=' + r['pc'] + ' ar=' + str(r['ar']) + ' rot=' + str(r['rot']) if 'pc' in r else r.get('skip')}")

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
        if r.get("rot"):
            # Die Boxkoordinaten liegen im gedrehten Bild; der Beleg muss dieselbe Drehung haben.
            rotated = cv2.rotate(cv2.imread(str(src)), _CV_ROT[r["rot"]])
            src = MZ.ZONES_DIR / f"_rot_{src.name}"
            cv2.imwrite(str(src), rotated)
        MZ.draw_evidence(src, as_zone(r["passcode"]),
                         as_zone(r["setcode"]) if "setcode" in r else None,
                         tuple(r["box"]), outdir / f"{src.stem}.png")
        drawn += 1
    if drawn:
        print(f"\nBelege: {outdir}")


if __name__ == "__main__":
    main()
