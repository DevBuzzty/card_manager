#!/usr/bin/env python
"""
Kaggle GPU production training for the Yu-Gi-Oh scanner.

Run this in a Kaggle notebook (GPU accelerator ON, Internet ON) after attaching a
Dataset that contains the repo's `ml/` package AND a `cards/` folder (artworks +
manifest.json). See ml/kaggle/README.md for the exact steps.

It fine-tunes the embedder (unfrozen, full card set), trains the YOLO detector at
imgsz 640, and exports both to ONNX in /kaggle/working for you to download.
The index.bin is rebuilt locally afterwards with the downloaded embedder.
"""
import sys
import time
from pathlib import Path

# ---- Tunables --------------------------------------------------------------
EPOCHS_EMB = 25          # embedder fine-tune epochs
EPOCHS_DET = 80          # detector epochs
IMGSZ_DET = 640          # detector image size (production)
N_SCENES = 3000          # synthetic detector scenes to generate
BG_FRACTION = 0.15       # fraction of card-less negative scenes (cuts false positives)
BATCH_EMB = 128          # embedder batch size (GPU)
NUM_WORKERS = 4          # dataloader workers (Kaggle has several CPUs)
EVAL_SUBSET = 2000       # cards used for the top-1 retrieval eval (speed)
# ---------------------------------------------------------------------------

KAGGLE_INPUT = Path("/kaggle/input")
WORK = Path("/kaggle/working")


def find_data_root() -> Path:
    """Find the dir holding cards/manifest.json (+ ml/), anywhere under /kaggle/input
    (robust to however Kaggle nests the extracted dataset)."""
    for m in KAGGLE_INPUT.rglob("manifest.json"):
        if m.parent.name == "cards":
            return m.parent.parent
    raise SystemExit(
        "Could not find cards/manifest.json under /kaggle/input — is the dataset attached "
        "with a cards/ folder (+ ml/)?"
    )


def main() -> None:
    t_start = time.time()
    data_root = find_data_root()
    print(f"[setup] data root: {data_root}")
    sys.path.insert(0, str(data_root))  # make `import ml` resolve to the uploaded code

    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[setup] torch {torch.__version__}, device={device}, "
          f"gpu={torch.cuda.get_device_name(0) if device == 'cuda' else '-'}")

    # Repoint config: inputs are read-only under /kaggle/input, outputs go to /kaggle/working.
    from ml import config
    config.CARDS_DIR = data_root / "cards"
    config.DATA_DIR = WORK / "data"
    config.BG_DIR = WORK / "data" / "backgrounds"
    config.OUT_DIR = WORK / "out"
    config.DET_DIR = WORK / "out" / "detect"
    config.EMB_DIR = WORK / "out" / "embed"

    from ml.generate import load_card_manifest
    items = load_card_manifest()
    print(f"[setup] artworks available: {len(items)}")

    # 1) Backgrounds (DTD) ---------------------------------------------------
    from ml import download_backgrounds
    print("[1/6] downloading DTD backgrounds ...")
    download_backgrounds.download_dtd(config.BG_DIR)

    # 2) Synthetic detector scenes ------------------------------------------
    from ml import generate
    print(f"[2/6] generating {N_SCENES} detector scenes ({BG_FRACTION:.0%} card-less negatives) ...")
    generate.generate_detection_set(N_SCENES, seed=1, bg_fraction=BG_FRACTION)

    # 3) Fine-tune the embedder (unfrozen, full card set) --------------------
    from ml import train as train_mod
    emb_ckpt = WORK / "out" / "embedder.pt"
    print(f"[3/6] fine-tuning embedder: {len(items)} classes, {EPOCHS_EMB} epochs, unfrozen ...")
    train_mod.train(
        items, emb_ckpt, epochs=EPOCHS_EMB, freeze_backbone=False, pretrained=True,
        batch=BATCH_EMB, device=device, num_workers=NUM_WORKERS,
    )

    # 4) Retrieval top-1 eval (subset) --------------------------------------
    from ml import eval_retrieval
    print(f"[4/6] evaluating top-1 retrieval on {EVAL_SUBSET} cards ...")
    acc = eval_retrieval.evaluate(emb_ckpt, items[:EVAL_SUBSET], n_queries_per=3)
    print(f"[4/6] >>> TOP-1 (subset of {EVAL_SUBSET}): {acc:.3f}")

    # 5) Export embedder ONNX -----------------------------------------------
    from ml import build_index
    emb_onnx = WORK / "embedder.onnx"
    build_index.export_onnx(emb_ckpt, emb_onnx)
    print(f"[5/6] exported {emb_onnx}")

    # 6) Train detector @640 + export ONNX ----------------------------------
    from ml import detector_data, detector_train, export_assets
    data_yaml = detector_data.write_data_yaml()
    print(f"[6/6] training YOLO detector: imgsz {IMGSZ_DET}, {EPOCHS_DET} epochs ...")
    best = detector_train.train_detector(
        data_yaml, epochs=EPOCHS_DET, imgsz=IMGSZ_DET,
        device=("0" if device == "cuda" else "cpu"),
    )
    det_onnx = WORK / "detector.onnx"
    export_assets.export_detector_nms(best, det_onnx)
    print(f"[6/6] exported {det_onnx}")

    # keep the embedder checkpoint too (needed to rebuild the full index locally)
    import shutil
    shutil.copy(emb_ckpt, WORK / "embedder.pt")

    mins = (time.time() - t_start) / 60
    print("\n===================== DONE =====================")
    print(f"total wall time: {mins:.1f} min")
    print("Download from /kaggle/working:")
    print("  - embedder.onnx   (production embedder)")
    print("  - detector.onnx   (production detector, imgsz 640, NMS)")
    print("  - embedder.pt     (checkpoint; used locally to rebuild index.bin over all cards)")
    print("================================================")


if __name__ == "__main__":
    main()
