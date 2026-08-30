import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

from ml import compose_scene, config

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def to_model_tensor(bgr_uint8: np.ndarray) -> torch.Tensor:
    rgb = cv2.cvtColor(bgr_uint8, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    rgb = (rgb - IMAGENET_MEAN) / IMAGENET_STD
    return torch.from_numpy(rgb.transpose(2, 0, 1).copy())


class ArtworkDataset(Dataset):
    """One class per artwork. Each __getitem__ returns a freshly augmented
    224x224 view of the artwork plus its class index."""

    def __init__(self, items, seed: int = 0):
        self.items = list(items)                       # [(passcode, path)]
        self.passcodes = [int(pc) for pc, _ in self.items]
        self._rng = np.random.default_rng(seed)

    def __len__(self) -> int:
        return len(self.items)

    def num_classes(self) -> int:
        return len(self.items)

    def __getitem__(self, idx: int):
        _pc, path = self.items[idx]
        art = compose_scene.load_art_bgr(path)
        crop = compose_scene.augment_crop(art, self._rng)   # 224x224 BGR uint8
        return to_model_tensor(crop), idx
