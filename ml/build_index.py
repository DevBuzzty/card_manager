from pathlib import Path

import cv2
import numpy as np
import torch

from ml import config, dataset
from ml import model as M
from ml import compose_scene


def load_embedder(ckpt_path, device: str = "cpu"):
    # weights_only=True: our checkpoint holds only tensors + simple types (int, list),
    # and avoids arbitrary-code execution on unpickle (important once ckpts come from elsewhere).
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=True)
    emb = M.Embedder(ckpt["embed_dim"], freeze_backbone=True, pretrained=False)
    emb.load_state_dict(ckpt["state_dict"])
    emb.eval().to(device)
    return emb, ckpt["passcodes"]


def embed_clean(emb, items, device: str = "cpu") -> np.ndarray:
    vecs = []
    with torch.no_grad():
        for _pc, path in items:
            bgr = compose_scene.load_art_bgr(path)
            crop = cv2.resize(compose_scene.pad_to_square(bgr), (config.CROP_SIZE, config.CROP_SIZE))
            t = dataset.to_model_tensor(crop).unsqueeze(0).to(device)
            vecs.append(emb(t).cpu().numpy()[0])
    return np.stack(vecs).astype(np.float32)


def build_index(ckpt_path, items, out_npz) -> Path:
    out_npz = Path(out_npz)
    out_npz.parent.mkdir(parents=True, exist_ok=True)
    emb, _ = load_embedder(ckpt_path)
    embeddings = embed_clean(emb, items)
    passcodes = np.array([int(pc) for pc, _ in items], dtype=np.int64)
    np.savez(out_npz, embeddings=embeddings, passcodes=passcodes)
    return out_npz


def export_onnx(ckpt_path, out_onnx) -> Path:
    out_onnx = Path(out_onnx)
    out_onnx.parent.mkdir(parents=True, exist_ok=True)
    emb, _ = load_embedder(ckpt_path)
    dummy = torch.zeros(1, 3, config.CROP_SIZE, config.CROP_SIZE)
    torch.onnx.export(
        emb, dummy, str(out_onnx),
        input_names=["img"], output_names=["emb"],
        dynamic_axes={"img": {0: "n"}, "emb": {0: "n"}},
        opset_version=17,
        dynamo=False,
    )
    return out_onnx
