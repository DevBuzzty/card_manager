import numpy as np

from ml import compose_fullcard


def test_warp_window_identitaet():
    quad = np.float32([[0, 0], [100, 0], [100, 200], [0, 200]])
    win = compose_fullcard.warp_window(100, 200, quad, (0.1, 0.2, 0.9, 0.7))
    assert np.allclose(win, [[10, 40], [90, 40], [90, 140], [10, 140]], atol=1e-3)


def test_warp_window_folgt_der_verschiebung_und_skalierung():
    quad = np.float32([[50, 60], [250, 60], [250, 460], [50, 460]])  # x2 skaliert, verschoben
    win = compose_fullcard.warp_window(100, 200, quad, (0.1, 0.2, 0.9, 0.7))
    assert np.allclose(win[0], [70, 140], atol=1e-3)
    assert np.allclose(win[2], [230, 340], atol=1e-3)


def test_compose_verdeckte_karte_ohne_label():
    rng = np.random.default_rng(1)
    bg = np.full((640, 640, 3), 90, np.uint8)
    card = np.full((614, 421, 3), 200, np.uint8)
    rel = (0.1156, 0.1797, 0.8856, 0.708)
    scene, boxes = compose_fullcard.compose(bg, [(1, card, rel, 0.5, 0.6)], rng, 640)
    assert scene.shape == (640, 640, 3)
    assert len(boxes) <= 4 and all(b[0] == 1 for b in boxes)
