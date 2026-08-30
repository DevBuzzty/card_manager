#!/usr/bin/env python
"""
Package the `ml/` code into `kaggle_upload/` for a small Kaggle Dataset upload.

The Kaggle notebook downloads the ~14.7k card artworks itself, so this bundles only the
code (a few KB) — no multi-GB upload. See ml/kaggle/README.md for the full flow.
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

    print(f"packaged code -> {dst}")
    print("Upload this folder (just the ml/ code, a few KB) as a Kaggle Dataset "
          "(see ml/kaggle/README.md).")
    print("The notebook downloads the ~14.7k card artworks itself — no large upload needed.")


if __name__ == "__main__":
    main()
