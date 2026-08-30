import cv2
import numpy as np
from ml import generate, config


def test_generate_detection_set_writes_pairs(tmp_path, monkeypatch):
    # Karten-Manifest, Hintergrund-Liste und Bild-Loader durch Fakes ersetzen
    monkeypatch.setattr(generate, "load_card_manifest",
                        lambda *a, **k: [(111, "c1"), (222, "c2")])
    monkeypatch.setattr(generate, "list_backgrounds", lambda *a, **k: ["bg"])
    monkeypatch.setattr(generate.compose_scene, "load_art_bgr",
                        lambda p: np.full((120, 80, 3), 180, np.uint8))
    monkeypatch.setattr(config, "DET_DIR", tmp_path)

    generate.generate_detection_set(n_scenes=3, seed=0, val_split=0.0)

    imgs = sorted((tmp_path / "images" / "train").glob("*.jpg"))
    lbls = sorted((tmp_path / "labels" / "train").glob("*.txt"))
    assert len(imgs) == 3 and len(lbls) == 3
    # Label-Zeilen: 5 Felder, Klasse 0, Werte in [0,1]
    for line in lbls[0].read_text().strip().splitlines():
        parts = line.split()
        assert len(parts) == 5 and parts[0] == "0"
        assert all(0.0 <= float(v) <= 1.0 for v in parts[1:])
