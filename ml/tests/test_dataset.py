import numpy as np
from ml import dataset, config


def test_to_model_tensor_shape_and_range():
    bgr = np.full((224, 224, 3), 127, dtype=np.uint8)
    t = dataset.to_model_tensor(bgr)
    assert tuple(t.shape) == (3, config.CROP_SIZE, config.CROP_SIZE)
    assert t.dtype.is_floating_point


def test_dataset_len_classes_and_item(monkeypatch):
    items = [(111, "a"), (222, "b"), (111, "c")]  # 3 artworks, note passcode 111 twice
    monkeypatch.setattr(dataset.compose_scene, "load_art_bgr",
                        lambda p: np.full((120, 80, 3), 180, np.uint8))
    ds = dataset.ArtworkDataset(items, seed=0)
    assert len(ds) == 3
    assert ds.num_classes() == 3
    assert ds.passcodes == [111, 222, 111]
    t, y = ds[1]
    assert tuple(t.shape) == (3, 224, 224)
    assert y == 1
