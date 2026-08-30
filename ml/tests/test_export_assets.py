import struct
import numpy as np
from ml import export_assets


def test_export_index_binary_roundtrip(tmp_path):
    emb = np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float32)
    pc = np.array([111, 222], dtype=np.int64)
    npz = tmp_path / "idx.npz"
    np.savez(npz, embeddings=emb, passcodes=pc)

    out = export_assets.export_index_binary(npz, tmp_path / "index.bin")
    raw = out.read_bytes()

    n, dim = struct.unpack_from("<II", raw, 0)
    assert (n, dim) == (2, 3)
    floats = np.frombuffer(raw, dtype="<f4", count=n * dim, offset=8)
    assert floats.reshape(n, dim).tolist() == emb.tolist()
    codes = np.frombuffer(raw, dtype="<i4", count=n, offset=8 + n * dim * 4)
    assert codes.tolist() == [111, 222]


def test_export_detector_nms_invokes_export(monkeypatch, tmp_path):
    calls = {}

    class FakeYOLO:
        def __init__(self, w):
            calls["w"] = w

        def export(self, **kw):
            calls["kw"] = kw
            p = tmp_path / "src.onnx"
            p.write_bytes(b"onnx")
            return str(p)

    monkeypatch.setattr(export_assets, "YOLO", FakeYOLO)
    out = export_assets.export_detector_nms("best.pt", tmp_path / "detector.onnx")
    assert calls["kw"]["format"] == "onnx"
    assert calls["kw"]["nms"] is True
    assert out.read_bytes() == b"onnx"
