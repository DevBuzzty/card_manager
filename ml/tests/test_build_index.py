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
    monkeypatch.setattr(build_index, "MANUAL_DIR", tmp_path / "keine")
    monkeypatch.setattr(build_index, "EXTRA_LIST", tmp_path / "keine.json")
    monkeypatch.setattr(compose_scene, "load_art_bgr",
                        lambda p: np.full((80, 80, 3), 180, np.uint8))
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


def test_pendulum_view_nur_fuer_hohe_artworks():
    assert build_index.pendulum_view(np.zeros((100, 100, 3), np.uint8)) is None
    assert build_index.pendulum_view(np.zeros((100, 135, 3), np.uint8)) is None  # schon sichtbares Fenster, 1,35 breit
    top = build_index.pendulum_view(np.zeros((908, 712, 3), np.uint8))
    assert top.shape[:2] == (round(712 / build_index.PENDULUM_VIEW_ASPECT), 712)


def test_build_index_haengt_pendel_ansicht_an(tmp_path, monkeypatch):
    monkeypatch.setattr(build_index, "MANUAL_DIR", tmp_path / "keine")
    monkeypatch.setattr(build_index, "EXTRA_LIST", tmp_path / "keine.json")
    shapes = {"quadrat": (80, 80, 3), "pendel": (120, 80, 3)}
    monkeypatch.setattr(compose_scene, "load_art_bgr", lambda p: np.full(shapes[p], 180, np.uint8))
    ckpt = _make_ckpt(tmp_path)
    out = tmp_path / "index.npz"
    build_index.build_index(ckpt, [(111, "quadrat"), (222, "pendel")], out)
    data = np.load(out)
    assert list(data["passcodes"]) == [111, 222, 222]
    assert data["embeddings"].shape == (3, 128)


def test_manual_items_liest_passcode_aus_dateinamen(tmp_path):
    (tmp_path / "63166095_mamo_1.jpg").write_bytes(b"x")
    (tmp_path / "63166095_mamo_2.jpg").write_bytes(b"x")
    (tmp_path / "notiz.jpg").write_bytes(b"x")
    items = build_index.manual_items(tmp_path)
    assert [pc for pc, _ in items] == [63166095, 63166095]


def test_build_index_haengt_manuelle_artworks_an(tmp_path, monkeypatch):
    manual = tmp_path / "manual"; manual.mkdir()
    (manual / "999_a.jpg").write_bytes(b"x")
    monkeypatch.setattr(build_index, "MANUAL_DIR", manual)
    monkeypatch.setattr(build_index, "EXTRA_LIST", tmp_path / "keine.json")
    monkeypatch.setattr(compose_scene, "load_art_bgr", lambda p: np.full((80, 80, 3), 180, np.uint8))
    out = tmp_path / "index.npz"
    build_index.build_index(_make_ckpt(tmp_path), [(111, "a")], out)
    assert list(np.load(out)["passcodes"]) == [111, 999]


def test_extra_items_liest_liste_und_warnt_bei_fehlenden(tmp_path, capsys):
    art = tmp_path / "art"; art.mkdir()
    (art / "5__X-OW.png").write_bytes(b"x")
    lst = tmp_path / "extra.json"
    lst.write_text('[[5, "5__X-OW.png"], [6, "6__fehlt.png"]]')
    items = build_index.extra_items(lst, art)
    assert [pc for pc, _ in items] == [5]
    assert "WARNUNG" in capsys.readouterr().out
