import shutil
import struct
from pathlib import Path

import numpy as np
from ultralytics import YOLO


def export_index_binary(npz_path, out_path) -> Path:
    data = np.load(npz_path)
    emb = np.ascontiguousarray(data["embeddings"], dtype="<f4")
    pc = np.ascontiguousarray(data["passcodes"], dtype="<i4")
    n, dim = emb.shape
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<II", n, dim))
        f.write(emb.tobytes())
        f.write(pc.tobytes())
    return out_path


def export_detector_nms(weights, out_path) -> Path:
    src = YOLO(weights).export(format="onnx", nms=True)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, out_path)
    return out_path
