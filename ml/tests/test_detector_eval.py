from ml import detector_eval


def test_evaluate_detector_returns_metrics(monkeypatch):
    class FakeBox:
        map50 = 0.82
        map = 0.61

    class FakeResults:
        box = FakeBox()

    class FakeYOLO:
        def __init__(self, w):
            pass

        def val(self, **kw):
            assert kw["data"] == "data.yaml"
            assert "project" in kw
            assert kw["name"] == "val"
            return FakeResults()

    monkeypatch.setattr(detector_eval, "YOLO", FakeYOLO)
    m = detector_eval.evaluate_detector("best.pt", "data.yaml")
    assert m == {"mAP50": 0.82, "mAP50_95": 0.61}


def test_export_detector_onnx(monkeypatch):
    calls = {}

    class FakeYOLO:
        def __init__(self, w):
            calls["w"] = w

        def export(self, **kw):
            calls["format"] = kw.get("format")
            return "runs/detector/weights/best.onnx"

    monkeypatch.setattr(detector_eval, "YOLO", FakeYOLO)
    p = detector_eval.export_detector_onnx("best.pt")
    assert calls["w"] == "best.pt"
    assert calls["format"] == "onnx"
    assert p.endswith(".onnx")
