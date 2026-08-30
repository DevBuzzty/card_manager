from ml import detector_data, config


def test_write_data_yaml(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DET_DIR", tmp_path)
    p = detector_data.write_data_yaml()
    assert p == tmp_path / "data.yaml"
    text = p.read_text()
    assert "train: images/train" in text
    assert "val: images/val" in text
    assert "card" in text
    assert tmp_path.as_posix() in text
