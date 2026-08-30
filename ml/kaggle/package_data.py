#!/usr/bin/env python
"""
Package the code + card artworks into `kaggle_upload/` for a Kaggle Dataset upload.

Run AFTER the full card download (`python -m ml.download_cards`) has finished, so all
~14.7k artworks are present. See ml/kaggle/README.md for the full flow.
"""
import shutil
from pathlib import Path

from ml import config


def main() -> None:
    root = config.ML_DIR.parent            # repo/worktree root
    dst = root / "kaggle_upload"
    if dst.exists():
        shutil.rmtree(dst)

    # 1) code: all top-level ml/*.py + the kaggle subpackage
    (dst / "ml").mkdir(parents=True)
    for p in config.ML_DIR.glob("*.py"):
        shutil.copy(p, dst / "ml" / p.name)
    (dst / "ml" / "kaggle").mkdir()
    for p in (config.ML_DIR / "kaggle").glob("*.py"):
        shutil.copy(p, dst / "ml" / "kaggle" / p.name)

    # 2) cards: manifest + every artwork jpg
    cards_dst = dst / "cards"
    cards_dst.mkdir()
    manifest = config.CARDS_DIR / "manifest.json"
    if not manifest.exists():
        raise SystemExit(f"manifest not found: {manifest} — run `python -m ml.download_cards` first")
    shutil.copy(manifest, cards_dst / "manifest.json")
    n = 0
    for jpg in config.CARDS_DIR.glob("*.jpg"):
        shutil.copy(jpg, cards_dst / jpg.name)
        n += 1

    print(f"packaged {n} artworks + code -> {dst}")
    print("Now zip this folder and upload it as a Kaggle Dataset (see ml/kaggle/README.md).")


if __name__ == "__main__":
    main()
