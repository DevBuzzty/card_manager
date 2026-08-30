import numpy as np
from ml import augment


def _rng():
    return np.random.default_rng(0)


def test_perspective_warp_shapes():
    card = np.full((100, 70, 4), 255, dtype=np.uint8)
    warped, quad = augment.perspective_warp(card, _rng())
    assert warped.ndim == 3 and warped.shape[2] == 4
    assert quad.shape == (4, 2)
    # Ecken liegen innerhalb der Leinwand
    assert quad[:, 0].min() >= -0.5 and quad[:, 0].max() <= warped.shape[1] + 0.5
    assert quad[:, 1].min() >= -0.5 and quad[:, 1].max() <= warped.shape[0] + 0.5


def test_foil_glare_brightens():
    img = np.full((50, 50, 3), 100, dtype=np.uint8)
    out = augment.add_foil_glare(img, _rng())
    assert out.shape == img.shape
    assert out.mean() > img.mean()  # Glanz hellt auf


def test_jitter_is_deterministic_with_seed():
    img = np.full((20, 20, 3), 120, dtype=np.uint8)
    a = augment.jitter_lighting(img, np.random.default_rng(7))
    b = augment.jitter_lighting(img, np.random.default_rng(7))
    assert np.array_equal(a, b)
