#!/usr/bin/env python
"""Harvest real Yu-Gi-Oh! card photos from Kleinanzeigen, labelled by passcode.

Strategy (clean labels, no title-parsing): we SEARCH per card name, so every photo from that
search is (very likely) that card -> label = the searched card's passcode. For each card we grab
the listing thumbnails (Kleinanzeigen serves a large `$_59` variant right on the search page).

Output:
  ml/data/harvest/<passcode>/<passcode>_<i>.jpg
  ml/data/harvest/manifest.json   # [{file, passcode, name, ad_title, url}]

Later (separate step): OCR-verify the passcode in each photo to drop mismatches (bundles / wrong
card), then use the (photo, passcode) pairs to fine-tune the embedder (digital->photo domain gap).

Usage:
  python ml/harvest_photos.py                       # uses the built-in SEED list
  python ml/harvest_photos.py "Dark Magician" ...   # specific card names
  python ml/harvest_photos.py --file names.txt      # one card name per line
Be polite: this sleeps between requests. For personal training-data use.
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
OUT = Path(__file__).resolve().parent / "data" / "harvest"
IMG_RE = re.compile(r'https://img\.kleinanzeigen\.de/api/v1/prod-ads/images/[a-f0-9/\-]+\?rule=\$_59\.AUTO')
HREF_RE = re.compile(r'data-href="([^"]+)"')


def _get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def resolve_passcode(name):
    """Card name -> (passcode, canonical_name) via YGOPRODeck fuzzy name search."""
    try:
        u = "https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=" + urllib.parse.quote(name)
        data = json.loads(_get(u).decode("utf-8", "replace"))
        arr = data.get("data") or []
        if arr:
            return str(arr[0]["id"]), arr[0]["name"]
    except Exception as e:
        print(f"   [ygoprodeck] {name}: {e}")
    return None, None


def search_images(query, limit=25):
    """Return [(image_url, ad_title)] from the Kleinanzeigen search page for `query`."""
    slug = urllib.parse.quote(query.strip().lower()).replace("%20", "-")
    slug = re.sub(r"[^a-z0-9\-%]", "", slug, flags=re.I)
    try:
        page = _get(f"https://www.kleinanzeigen.de/s-{slug}/k0").decode("utf-8", "replace")
    except Exception as e:
        print(f"   [search] {query}: {e}")
        return []
    out = []
    for block in page.split('<article class="aditem"')[1:]:
        img = IMG_RE.search(block)
        if not img:
            continue
        href = HREF_RE.search(block)
        title = ""
        if href:
            # the ad slug carries the human title, e.g. .../yu-gi-oh-dark-magician-ultra/123-45
            title = html.unescape(href.group(1).split("/")[2].replace("-", " ")) if "/" in href.group(1) else ""
        out.append((img.group(0), title))
        if len(out) >= limit:
            break
    return out


def harvest(names, per_card=25):
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name in names:
        pc, canon = resolve_passcode(name)
        if not pc:
            print(f"[skip] no passcode for '{name}'")
            continue
        d = OUT / pc
        d.mkdir(exist_ok=True)
        n = 0
        for url, title in search_images(name, per_card):
            try:
                (d / f"{pc}_{n}.jpg").write_bytes(_get(url))
                manifest.append({"file": f"{pc}/{pc}_{n}.jpg", "passcode": pc,
                                 "name": canon, "ad_title": title, "url": url})
                n += 1
                time.sleep(0.4)
            except Exception as e:
                print(f"   img failed: {e}")
        print(f"[{pc}] {canon}: {n} photos")
        time.sleep(1.0)
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(f"\nDONE: {len(manifest)} photos from {len(names)} cards -> {OUT}")


# A small seed of popular / foil-heavy cards (good Kleinanzeigen yield). Extend or pass your own.
SEED = [
    "Dark Magician", "Blue-Eyes White Dragon", "Ash Blossom & Joyous Spring",
    "Accesscode Talker", "Allied Code Talker @Ignister", "Snake-Eyes Ash",
    "Kashtira Fenrir", "Maxx C", "Elemental HERO Sparkman", "Wheel Synchron",
]


def main():
    args = sys.argv[1:]
    if args and args[0] == "--file":
        names = [l.strip() for l in Path(args[1]).read_text(encoding="utf-8").splitlines() if l.strip()]
    else:
        names = args or SEED
    harvest(names)


if __name__ == "__main__":
    main()
