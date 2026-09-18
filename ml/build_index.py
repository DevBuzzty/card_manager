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


# Pendel-Karten (18.09.2026): ihr `image_url_cropped` ist das GANZE Artwork (hoch, h > 1,15 w), auf der
# Karte ist aber nur der obere Teil sichtbar -- der Rest liegt hinter dem Pendel-Textfeld. Der Detektor
# boxt das sichtbare Fenster (Seitenverhaeltnis ~1,36); mit nur dem ganzen Artwork im Index traf der
# Embedder die Karte mit sim 0,44-0,69 (Schwelle 0,6). Darum bekommt jedes hohe Artwork einen zweiten
# Eintrag: der obere Teil mit Seitenverhaeltnis PENDULUM_VIEW_ASPECT, gleicher Passcode.
# Messkorb: Pendel-Fotos 27,9 -> 90,7 %, uebrige Koerbe unveraendert oder besser.
PENDULUM_VIEW_ASPECT = 1.36
TALL_RATIO = 1.15


def pendulum_view(bgr: np.ndarray):
    """Sichtbarer oberer Teil eines hohen (Pendel-)Artworks, sonst None."""
    h, w = bgr.shape[:2]
    if h <= TALL_RATIO * w:
        return None
    return bgr[: int(round(w / PENDULUM_VIEW_ASPECT))]


def _embed_bgr(emb, bgr, device):
    crop = cv2.resize(compose_scene.pad_to_square(bgr), (config.CROP_SIZE, config.CROP_SIZE))
    t = dataset.to_model_tensor(crop).unsqueeze(0).to(device)
    return emb(t).cpu().numpy()[0]


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
    passcodes = [int(pc) for pc, _ in items]
    extra = []
    with torch.no_grad():
        for pc, path in items:
            view = pendulum_view(compose_scene.load_art_bgr(path))
            if view is not None:
                extra.append(_embed_bgr(emb, view, "cpu"))
                passcodes.append(int(pc))
    if extra:
        embeddings = np.vstack([embeddings, np.stack(extra).astype(np.float32)])
    passcodes = np.array(passcodes, dtype=np.int64)
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
