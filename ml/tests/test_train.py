import numpy as np
import torch
from ml import train, dataset


def test_train_writes_checkpoint(tmp_path, monkeypatch):
    monkeypatch.setattr(dataset.compose_scene, "load_art_bgr",
                        lambda p: np.full((120, 80, 3), 180, np.uint8))
    items = [(111, "a"), (222, "b"), (333, "c"), (444, "d")]
    out = tmp_path / "ckpt.pt"
    result = train.train(items, out_path=out, epochs=1, pretrained=False, batch=2, seed=0)
    assert result == out and out.exists()
    ckpt = torch.load(out, map_location="cpu", weights_only=True)
    assert ckpt["embed_dim"] == 128
    assert ckpt["passcodes"] == [111, 222, 333, 444]
    assert "state_dict" in ckpt
