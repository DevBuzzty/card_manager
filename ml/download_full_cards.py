"""Ganze Kartenbilder (mit Rahmen) fuer das Detektor-Neutraining (Spec 2026-09-17, Teil D-2).

Wie download_cards.py, aber `image_url` statt `image_url_cropped`, plus `frameType` je Karte (fuer die
Artwork-Geometrie im Rahmen). Ziel: ml/data/full_cards/<artwork_id>.jpg + manifest.json.
Hoeflich gedrosselt (YGOPRODeck-Grenze 20 Anfragen/s).
"""
import argparse
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ml import config

DEST = config.DATA_DIR / "full_cards"
UA = {"User-Agent": "Mozilla/5.0"}


def fetch_manifest() -> list[dict]:
    req = urllib.request.Request(config.CARDINFO_URL, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    out = []
    for card in payload["data"]:
        for img in card.get("card_images", []):
            out.append({
                "passcode": int(card["id"]),
                "artwork_id": int(img["id"]),
                "frame_type": card.get("frameType", ""),
                "url": img["image_url"],
            })
    return out


def _get(e: dict) -> bool:
    target = DEST / f"{e['artwork_id']}.jpg"
    if target.exists() and target.stat().st_size > 0:
        return False
    for attempt in range(3):
        try:
            req = urllib.request.Request(e["url"], headers=UA)
            with urllib.request.urlopen(req, timeout=30) as resp:
                target.write_bytes(resp.read())
            time.sleep(0.25)  # 4 Threads x ~4/s -> deutlich unter 20/s
            return True
        except Exception as exc:  # noqa: BLE001 -- einzelne Fehlschlaege duerfen den Lauf nicht beenden
            if attempt == 2:
                print(f"skip {e['artwork_id']}: {exc}", flush=True)
            time.sleep(2)
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    DEST.mkdir(parents=True, exist_ok=True)
    entries = fetch_manifest()
    (DEST / "manifest.json").write_text(json.dumps(entries))
    todo = entries[: a.limit] if a.limit else entries
    n = 0
    with ThreadPoolExecutor(4) as ex:
        for i, ok in enumerate(ex.map(_get, todo), 1):
            n += ok
            if i % 1000 == 0:
                print(f"{i}/{len(todo)} geladen={n}", flush=True)
    print(f"fertig: {n} neu, {len(todo)} gesamt", flush=True)


if __name__ == "__main__":
    main()
