from pathlib import Path
from ml import detector_train


def test_train_detector_invokes_yolo(tmp_path, monkeypatch):
    calls = {}

    class FakeYOLO:
        def __init__(self, model):
            calls["model"] = model

        def train(self, **kw):
            calls["train"] = kw

    monkeypatch.setattr(detector_train, "YOLO", FakeYOLO)
    out = detector_train.train_detector(
        "data.yaml", epochs=3, imgsz=320, device="cpu",
        project=str(tmp_path), name="run",
    )
    assert calls["model"] == "yolo11n.pt"
    assert calls["train"]["data"] == "data.yaml"
    assert calls["train"]["epochs"] == 3
    assert calls["train"]["imgsz"] == 320
    assert calls["train"]["device"] == "cpu"
    assert calls["train"]["exist_ok"] is True
    assert out == tmp_path / "run" / "weights" / "best.pt"
