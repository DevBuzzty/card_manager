import numpy as np
import torch
from ml import build_index, compose_scene
from ml import model as M


def _make_ckpt(tmp_path):
    emb = M.Embedder(embed_dim=128, freeze_backbone=True, pretrained=False)
    ckpt = tmp_path / "ckpt.pt"
    torch.save({"embed_dim": 128, "state_dict": emb.state_dict(),
                "passcodes": [111, 222]}, ckpt)
    return ckpt


def test_build_index_shapes(tmp_path, monkeypatch):
    monkeypatch.setattr(compose_scene, "load_art_bgr",
                        lambda p: np.full((120, 80, 3), 180, np.uint8))
    ckpt = _make_ckpt(tmp_path)
    items = [(111, "a"), (222, "b")]
    out = tmp_path / "index.npz"
    build_index.build_index(ckpt, items, out)
    data = np.load(out)
    assert data["embeddings"].shape == (2, 128)
    assert list(data["passcodes"]) == [111, 222]
    # embeddings are L2-normalised
    norms = np.linalg.norm(data["embeddings"], axis=1)
    assert np.allclose(norms, 1.0, atol=1e-4)


def test_export_onnx_runs(tmp_path, monkeypatch):
    import onnxruntime as ort
    ckpt = _make_ckpt(tmp_path)
    out = tmp_path / "embedder.onnx"
    build_index.export_onnx(ckpt, out)
    assert out.exists()
    sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
    dummy = np.zeros((1, 3, 224, 224), dtype=np.float32)
    (emb,) = sess.run(None, {"img": dummy})
    assert emb.shape == (1, 128)
