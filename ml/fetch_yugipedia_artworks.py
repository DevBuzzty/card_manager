"""Alternativ-Artworks von Yugipedia, die YGOPRODeck nicht fuehrt (Schritt 2, 18.09.2026).

1. `Card Artworks:`-Seiten (Namensraum 3012) lesen, Galerie-Dateien je Karte sammeln.
2. Karten, bei denen Yugipedia mehr offizielle Artworks (`-OW`, Master-Duel `VG-artwork`) kennt als
   YGOPRODeck Bilder -> Kandidaten.
3. Vorschaubilder (400 px) nach ml/data/yugipedia_art/<passcode>__<datei>.png laden, gedrosselt.

Ob ein Kandidat wirklich NEU ist (und nicht nur eine JP/EN-Fassung desselben Bildes), entscheidet
ml/select_extra_artworks.py per Embedding-Abstand.
    python -m ml.fetch_yugipedia_artworks
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

from ml import config

UA = {"User-Agent": "YuGiOhCardManager/1.0 (private collection tool; s.f.falser@gmail.com)"}
API = "https://yugipedia.com/api.php"
OUT = config.DATA_DIR / "yugipedia_art"
BAD = re.compile(r"anime|rush|manga|-RD|RD-|SEVENS|-DL-|DuelLinks|unused|concept", re.I)
GOOD = re.compile(r"-OW(-\d+)?\.|VG-artwork", re.I)


def api(**p):
    p["format"] = "json"
    data = urllib.parse.urlencode(p).encode()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(API, data=data, headers=UA), timeout=90) as r:
                return json.load(r)
        except Exception:  # noqa: BLE001 -- Netzaussetzer: kurz warten, erneut
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("Yugipedia nicht erreichbar")


def artwork_pages() -> dict:
    titles, cont = [], {}
    while True:
        r = api(action="query", list="allpages", apnamespace=3012, aplimit=500, **cont)
        titles += [p["title"] for p in r["query"]["allpages"]]
        if "continue" not in r:
            break
        cont = {"apcontinue": r["continue"]["apcontinue"]}
        time.sleep(0.5)
    out = {}
    for i in range(0, len(titles), 50):
        r = api(action="query", prop="revisions", rvprop="content", titles="|".join(titles[i:i + 50]))
        for pg in r["query"]["pages"].values():
            try:
                txt = pg["revisions"][0]["*"]
            except (KeyError, IndexError):
                continue
            rows = re.findall(r"^\s*([^|\n<>{}=\[\]]+?\.(?:png|jpg|jpeg))\s*\|([^\n]*)$", txt, flags=re.M | re.I)
            out[pg["title"].split(":", 1)[1]] = [f.strip() for f, c in rows
                                                 if GOOD.search(f) and not BAD.search(f) and not BAD.search(c)]
        time.sleep(0.6)
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request("https://db.ygoprodeck.com/api/v7/cardinfo.php", headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        byname = {c["name"]: c for c in json.load(r)["data"]}
    cands = []
    for name, files in artwork_pages().items():
        c = byname.get(name)
        if c and len(files) > len(c["card_images"]):
            cands += [(c["id"], f) for f in files]
    (OUT / "kandidaten.json").write_text(json.dumps(cands))
    print(f"{len(cands)} Kandidaten-Bilder", flush=True)
    todo = [(pc, f) for pc, f in cands if not (OUT / f"{pc}__{Path(f).stem}.png").exists()]
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        r = api(action="query", prop="imageinfo", iiprop="url", iiurlwidth=400,
                titles="|".join("File:" + f for _, f in batch))
        urls = {}
        for pg in r["query"]["pages"].values():
            info = (pg.get("imageinfo") or [{}])[0]
            if "thumburl" in info:
                urls[pg["title"].split(":", 1)[1].replace(" ", "_")] = info["thumburl"]
        for pc, f in batch:
            u = urls.get(f.replace(" ", "_"))
            if not u:
                continue
            try:
                with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as resp:
                    (OUT / f"{pc}__{Path(f).stem}.png").write_bytes(resp.read())
            except Exception as exc:  # noqa: BLE001
                print(f"skip {f}: {exc}", flush=True)
            time.sleep(0.3)
        print(f"{min(i + 50, len(todo))}/{len(todo)}", flush=True)


if __name__ == "__main__":
    main()
