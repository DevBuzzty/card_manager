#!/usr/bin/env python
"""Harvest real card photos from the eBay Browse API into the harvest pool (unlabeled).

eBay has far more single-card listings than Kleinanzeigen, with clean gallery photos — the best
free source of real (foil) card photos. We dump the listing images into the shared pool; then
label_photos.py OCR-labels each by the passcode PRINTED on the card (ground truth), so noisy
titles / bundles don't matter.

Needs your eBay PRODUCTION keyset (developer.ebay.com -> Application Keys):
    set EBAY_APP_ID=...     (Client ID / App ID)      # PowerShell: $env:EBAY_APP_ID="..."
    set EBAY_CERT_ID=...    (Client Secret / Cert ID)
Optional:  EBAY_MARKET=EBAY_DE   (default; use EBAY_US for more variety)

    python ml/harvest_ebay.py                       # broad foil/rarity queries
    python ml/harvest_ebay.py "blue-eyes ghost rare"
Then:  python ml/label_photos.py
"""
import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

APP = os.environ.get("EBAY_APP_ID")
CERT = os.environ.get("EBAY_CERT_ID")
MARKET = os.environ.get("EBAY_MARKET", "EBAY_DE")
OUT = Path(__file__).resolve().parent / "data" / "harvest" / "pool"

QUERIES = [
    "yugioh secret rare", "yugioh ultra rare 1st edition", "yugioh ghost rare",
    "yugioh ultimate rare", "yugioh quarter century secret rare", "yugioh collector rare",
    "yugioh starlight rare", "yugioh prismatic secret rare", "yugioh platinum secret rare",
    "yugioh secret rare deutsch", "yu gi oh 1. auflage secret", "yugioh gold rare",
]


def get_token():
    if not APP or not CERT:
        sys.exit("Set EBAY_APP_ID and EBAY_CERT_ID (eBay production keyset).")
    body = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "scope": "https://api.ebay.com/oauth/api_scope",
    }).encode()
    auth = base64.b64encode(f"{APP}:{CERT}".encode()).decode()
    req = urllib.request.Request(
        "https://api.ebay.com/identity/v1/oauth2/token", data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "Authorization": "Basic " + auth})
    return json.loads(urllib.request.urlopen(req, timeout=25).read())["access_token"]


def search(tok, q, limit=200, offset=0):
    url = "https://api.ebay.com/buy/browse/v1/item_summary/search?" + urllib.parse.urlencode(
        {"q": q, "limit": limit, "offset": offset})
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + tok, "X-EBAY-C-MARKETPLACE-ID": MARKET})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


def get_img(url):
    url = re.sub(r"s-l\d+", "s-l1600", url)   # upgrade eBay thumbnail -> full-res
    req = urllib.request.Request(url, headers={"User-Agent": "harvest/1.0"})
    return urllib.request.urlopen(req, timeout=20).read()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tok = get_token()
    print(f"token ok, marketplace {MARKET}", flush=True)
    queries = sys.argv[1:] or QUERIES
    n = len(list(OUT.glob("*.jpg")))
    for q in queries:
        got = 0
        for offset in (0, 200, 400, 600):   # up to ~800 listings per query
            try:
                data = search(tok, q, 200, offset)
            except Exception as e:
                print(f"  search '{q}' @{offset}: {e}", flush=True)
                break
            items = data.get("itemSummaries") or []
            if not items:
                break
            for it in items:
                img = (it.get("image") or {}).get("imageUrl")
                if not img:
                    continue
                try:
                    (OUT / f"ebay_{n}.jpg").write_bytes(get_img(img))
                    n += 1
                    got += 1
                except Exception:
                    pass
            time.sleep(0.4)
        print(f"[ebay] '{q}': +{got}", flush=True)
        time.sleep(0.4)
    print(f"\nEBAY POOL: {n} total in {OUT}  (run label_photos.py to OCR-label)", flush=True)


if __name__ == "__main__":
    main()
