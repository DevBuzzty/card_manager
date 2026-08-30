from ml import config


def test_paths_are_under_ml_data():
    assert config.CARDS_DIR.parent == config.DATA_DIR
    assert config.DET_DIR.parent == config.OUT_DIR


def test_size_constants():
    assert config.SCENE_SIZE == 640
    assert config.CROP_SIZE == 224
    assert config.CARD_CLASS == 0
