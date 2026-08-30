import argparse
import json
import urllib.request
from pathlib import Path

from ml import config


def fetch_card_manifest(url: str = config.CARDINFO_URL) -> list[dict]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    entries: list[dict] = []
    for card in payload["data"]:
        passcode = int(card["id"])
        for img in card.get("card_images", []):
            entries.append({
                "passcode": passcode,
                "artwork_id": int(img["id"]),
                "url": img["image_url_cropped"],
            })
    return entries


def save_manifest(entries: list[dict], dest: Path = config.CARDS_DIR) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / "manifest.json"
    path.write_text(json.dumps(entries))
    return path


def download_artworks(entries: list[dict], dest: Path = config.CARDS_DIR, limit: int | None = None) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for e in entries[: limit or len(entries)]:
        target = dest / f"{e['artwork_id']}.jpg"
        if target.exists():
            continue
        try:
            urllib.request.urlretrieve(e["url"], target)
            n += 1
        except Exception as exc:  # noqa: BLE001 — einzelne Fehl-Downloads dürfen den Lauf nicht killen
            print(f"skip {e['artwork_id']}: {exc}")
    return n


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    entries = fetch_card_manifest()
    save_manifest(entries)
    got = download_artworks(entries, limit=args.limit)
    print(f"manifest: {len(entries)} artworks; downloaded {got} new files")


if __name__ == "__main__":
    main()
