#!/usr/bin/env python
"""Measure OCR zones from DIGITAL card images instead of photos.

Why this exists next to measure_zones.py: zone geometry is a property of the card DESIGN, not of
the photograph. The labelled eBay corpus is skewed towards rarities, so some layouts are too thin
to measure — PENDULUM had 32 usable photos against a 40-sample minimum, and PENDULUM is the whole
reason Spec D2 exists (its set code sits bottom-left under the pendulum box, not bottom-right).

YGOPRODeck's card images are perspective-free, evenly lit and exist for all 14,523 cards, so every
layout can be measured, including SKILL and legacy frames that barely appear in the photo corpus.
The photos keep their real job in measure_zones.py: proving the zones survive a real capture —
angled, glared, out of focus.

    python ml/measure_zones_digital.py --layout PENDULUM            # download + measure
    python ml/measure_zones_digital.py --layout PENDULUM --download-only
    python ml/measure_zones_digital.py --layout PENDULUM --limit 200

Out: ml/data/zones/measured_digital.json   (same shape as measured.json, per layout)
     ml/data/zones/<layout>_digital/*.png  (evidence renders)
"""
import argparse
import gzip
import json
import time
import urllib.request
from pathlib import Path

import measure_zones as MZ  # detection, OCR, span-finding, stats — all reused, nothing duplicated

ML_DIR = Path(__file__).resolve().parent
DIGITAL = ML_DIR / "data" / "digital"
OUT_JSON = MZ.ZONES_DIR / "measured_digital.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YuGiOhCardManager/1.0"
SLEEP_S = 0.12          # be polite to YGOPRODeck's image host


def cards_for_layout(layout, limit):
    """Catalog cards whose type maps to `layout`, with an image URL. Deterministic order.

    MZ.load_catalog() returns only {id: type} — we need the image URL too, so read the cached
    gzip directly (MZ has already downloaded it if it was missing)."""
    MZ.load_catalog()                       # ensures CATALOG_CACHE exists
    data = json.loads(gzip.decompress(MZ.CATALOG_CACHE.read_bytes()))
    out = []
    for c in data["cards"]:
        if MZ.layout_for_type(c.get("type")) != layout:
            continue
        img = c.get("image")
        if not img:
            continue
        out.append((str(c["id"]), img))
    out.sort(key=lambda t: t[0])          # stable across runs — no Math.random-style drift
    return out[:limit]


def fetch(url, dest):
    if dest.exists() and dest.stat().st_size > 1024:
        return True
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        if len(data) < 1024:
            return False
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(dest)                  # never leave a half-written jpg behind
        return True
    except Exception as e:
        print(f"  download failed {dest.name}: {type(e).__name__}")
        return False


def download(layout, limit):
    d = DIGITAL / layout
    d.mkdir(parents=True, exist_ok=True)
    todo = cards_for_layout(layout, limit)
    print(f"{layout}: {len(todo)} Karten im Katalog (Limit {limit})")
    have = 0
    for i, (pc, url) in enumerate(todo, 1):
        dest = d / f"{pc}.jpg"
        fresh = not dest.exists()
        if fetch(url, dest):
            have += 1
        if fresh:
            time.sleep(SLEEP_S)
        if i % 25 == 0:
            print(f"  {i}/{len(todo)} geladen ({have} vorhanden)")
    print(f"{layout}: {have} Bilder verfuegbar in {d}")
    return [(pc, d / f"{pc}.jpg") for pc, _ in todo if (d / f"{pc}.jpg").exists()]


def measure(layout, pairs):
    pass_s, set_s, evid = [], [], []
    for i, (pc, path) in enumerate(pairs, 1):
        r = MZ.measure_one(path, pc)
        if not r:
            continue
        if "passcode" in r:
            pass_s.append(r["passcode"])
        if "setcode" in r:
            set_s.append(r["setcode"])
        if len(evid) < 3 and "passcode" in r:
            evid.append((path, r))
        if i % 25 == 0:
            print(f"  {i}/{len(pairs)}  passcode={len(pass_s)}  setcode={len(set_s)}")

    entry = {}
    for name, samples in (("PASSCODE", pass_s), ("SET_CODE", set_s)):
        e, n_raw, n = MZ.summarize(samples)
        if e is None:
            print(f"{layout} {name}: zu wenig Daten ({n} von {n_raw} nach Ausreisser-Filter, "
                  f"noetig >= {MZ.MIN_SAMPLES})")
        else:
            entry[name] = e
            print(f"{layout} {name}: n={e['n']}  x={e['x']}  y={e['y']}  "
                  f"std(y1)={e['std']['y1']}")
    if evid:
        outdir = MZ.ZONES_DIR / f"{layout.lower()}_digital"
        outdir.mkdir(parents=True, exist_ok=True)
        for path, r in evid:
            MZ.draw_evidence(path, r.get("passcode"), r.get("setcode"), r["box"],
                             outdir / f"{path.stem}.png")
        print(f"Belege: {outdir}")
    return entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", required=True, choices=MZ.LAYOUTS)
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--download-only", action="store_true")
    a = ap.parse_args()

    pairs = download(a.layout, a.limit)
    if a.download_only:
        return
    MZ.ZONES_DIR.mkdir(parents=True, exist_ok=True)
    entry = measure(a.layout, pairs)
    all_out = {}
    if OUT_JSON.exists():
        all_out = json.loads(OUT_JSON.read_text())
    all_out[a.layout] = entry
    OUT_JSON.write_text(json.dumps(all_out, indent=2))
    print(f"geschrieben: {OUT_JSON}")


if __name__ == "__main__":
    main()
