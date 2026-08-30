import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

from ml import compose_scene

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def to_model_tensor(bgr_uint8: np.ndarray) -> torch.Tensor:
    rgb = cv2.cvtColor(bgr_uint8, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    rgb = (rgb - IMAGENET_MEAN) / IMAGENET_STD
    return torch.from_numpy(rgb.transpose(2, 0, 1).copy())


class ArtworkDataset(Dataset):
    """One class per artwork. Each __getitem__ returns a freshly augmented
    224x224 view of the artwork plus its class index. `views_per_class` makes
    every artwork appear that many times per epoch (each a different augmentation),
    which is what gives ArcFace enough gradient steps to actually converge."""

    def __init__(self, items, seed: int = 0, views_per_class: int = 1):
        self.items = list(items)                       # [(passcode, path)]
        self.passcodes = [int(pc) for pc, _ in self.items]
        self.views_per_class = views_per_class
        self._seed = seed
        self._rng = None                               # created lazily, per worker

    def __len__(self) -> int:
        return len(self.items) * self.views_per_class

    def num_classes(self) -> int:
        return len(self.items)

    def __getitem__(self, idx: int):
        if self._rng is None:
            # Decorrelate augmentations across dataloader workers (each holds a fork);
            # without a per-worker seed all workers would emit identical crops.
            info = torch.utils.data.get_worker_info()
            wid = info.id if info is not None else 0
            self._rng = np.random.default_rng([self._seed, wid])
        cls = idx % len(self.items)                    # views collapse to the same class
        _pc, path = self.items[cls]
        art = compose_scene.load_art_bgr(path)
        crop = compose_scene.augment_crop(art, self._rng)   # 224x224 BGR uint8
        return to_model_tensor(crop), cls
