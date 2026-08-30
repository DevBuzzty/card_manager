import numpy as np
from ml import compose_scene, config


def test_compose_returns_one_box_per_card():
    rng = np.random.default_rng(0)
    bg = np.full((300, 300, 3), 50, dtype=np.uint8)
    arts = [
        (111, np.full((120, 80, 3), 200, dtype=np.uint8)),
        (222, np.full((120, 80, 3), 150, dtype=np.uint8)),
    ]
    scene, boxes = compose_scene.compose_scene(bg, arts, rng)
    assert scene.shape == (config.SCENE_SIZE, config.SCENE_SIZE, 3)
    assert len(boxes) == 2
    assert {b[0] for b in boxes} == {111, 222}


def test_quad_to_yolo_normalised():
    quad = np.float32([[100, 100], [300, 100], [300, 500], [100, 500]])
    cx, cy, w, h = compose_scene.quad_to_yolo(quad, size=640)
    for v in (cx, cy, w, h):
        assert 0.0 <= v <= 1.0
    assert abs(cx - (200 / 640)) < 1e-6
    assert abs(h - (400 / 640)) < 1e-6


def test_augment_crop_size():
    rng = np.random.default_rng(1)
    art = np.full((120, 80, 3), 180, dtype=np.uint8)
    crop = compose_scene.augment_crop(art, rng)
    assert crop.shape == (config.CROP_SIZE, config.CROP_SIZE, 3)
