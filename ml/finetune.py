#!/usr/bin/env python
"""Domain-adaptation fine-tune: warm-start the 0.993 embedder, then train on a BALANCED mix of
synthetic augmented artworks (all ~14.5k classes, keeps the long tail) + real eBay artwork crops
(the ~2k cards we harvested, closes the Sim2Real/foil gap).

Real crops come from crop_artworks.py (detector -> 224 artwork crop), so they match what the
embedder sees at inference. They are appended as extra dataset items mapped to their card's
PRIMARY art class, and get only light geometry/photo aug (NOT synthetic foil — they are already
real foils). Recipe (proven at 0.993): unfrozen backbone lr=1e-4, head+ArcFace lr=1e-3, margin
warmup, per-epoch checkpoint so a killed Colab run resumes.
"""
import json
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

from ml import augment, compose_scene, config, dataset
from ml import model as M


def real_augment(crop_bgr, rng):
    """Light aug for an already-real 224 artwork crop: geometry + mild photo domain, no foil synth."""
    x = augment.jitter_lighting(crop_bgr, rng)
    x = augment.photo_domain(x, rng)
    x = augment.add_blur_noise(x, rng)
    bgra = cv2.cvtColor(x, cv2.COLOR_BGR2BGRA)
    warped, _ = augment.perspective_warp(bgra, rng, max_warp=0.12)   # gentler than synthetic 0.25
    h, w = warped.shape[:2]
    side = max(h, w)
    canvas = np.full((side, side, 3), 127, np.uint8)
    compose_scene._paste_rgba(canvas, warped, (side - w) // 2, (side - h) // 2)
    return cv2.resize(canvas, (config.CROP_SIZE, config.CROP_SIZE))


class MixedDataset(Dataset):
    """synth_items: [(passcode, art_path)] — class index = list position (ArcFace class space).
    real_items:  [(class_index, crop_path)] — real crops attached to their card's primary class."""

    def __init__(self, synth_items, real_items, seed: int = 0, views_per_class: int = 2):
        self.synth = list(synth_items)
        self.passcodes = [int(pc) for pc, _ in self.synth]
        self.views = views_per_class
        self.real = list(real_items)
        self._seed = seed
        self._rng = None

    def __len__(self):
        return len(self.synth) * self.views + len(self.real)

    def num_classes(self):
        return len(self.synth)

    def _rng_(self):
        if self._rng is None:
            info = torch.utils.data.get_worker_info()
            self._rng = np.random.default_rng([self._seed, info.id if info else 0])
        return self._rng

    def __getitem__(self, idx):
        rng = self._rng_()
        n_synth = len(self.synth) * self.views
        if idx < n_synth:
            cls = idx % len(self.synth)
            crop = compose_scene.augment_crop(compose_scene.load_art_bgr(self.synth[cls][1]), rng)
            return dataset.to_model_tensor(crop), cls
        cls, path = self.real[idx - n_synth]
        crop = real_augment(compose_scene.load_art_bgr(path), rng)
        return dataset.to_model_tensor(crop), cls


def build_real_items(synth_items, crops_dir: Path):
    """Map each real crop to its card's PRIMARY art class (first occurrence of that passcode)."""
    primary = {}
    for i, (pc, _) in enumerate(synth_items):
        primary.setdefault(int(pc), i)
    man = json.loads((crops_dir / "crops_manifest.json").read_text())
    real, skipped = [], 0
    for m in man:
        pc = int(m["passcode"])
        if pc in primary:
            real.append((primary[pc], crops_dir / m["file"]))
        else:
            skipped += 1
    return real, skipped


def finetune(synth_items, real_items, out_path, init_ckpt: str = None, epochs: int = 10,
             embed_dim: int = 128, batch: int = 64, device: str = "cpu", seed: int = 0,
             num_workers: int = 0, views: int = 2, margin: float = 0.5, warmup: int = 5,
             bb_lr: float = 1e-4, head_lr: float = 1e-3, resume: str = None) -> Path:
    torch.manual_seed(seed)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ckpt_path = out_path.with_suffix(".ckpt")

    ds = MixedDataset(synth_items, real_items, seed=seed, views_per_class=views)
    dl = DataLoader(ds, batch_size=batch, shuffle=True, num_workers=num_workers,
                    pin_memory=(device != "cpu"))

    emb = M.Embedder(embed_dim, freeze_backbone=False, pretrained=(init_ckpt is None)).to(device)
    if init_ckpt:
        ck = torch.load(init_ckpt, map_location=device, weights_only=True)
        sd = ck.get("state_dict") or ck.get("emb") or ck.get("model") or ck if isinstance(ck, dict) else ck
        emb.load_state_dict(sd)
        print(f"warm-started embedder from {init_ckpt}")
    arc = M.ArcFace(embed_dim, ds.num_classes(), m=margin).to(device)

    opt = torch.optim.Adam([
        {"params": list(emb.features.parameters()), "lr": bb_lr},
        {"params": list(emb.head.parameters()) + list(arc.parameters()), "lr": head_lr},
    ])
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    loss_fn = torch.nn.CrossEntropyLoss()

    start = 0
    if resume:
        ck = torch.load(resume, map_location=device, weights_only=True)
        emb.load_state_dict(ck["emb"]); arc.load_state_dict(ck["arc"])
        opt.load_state_dict(ck["opt"]); sched.load_state_dict(ck["sched"])
        start = ck["epoch"] + 1
        print(f"resumed at epoch {start}")

    for ep in range(start, epochs):
        arc.m = margin * min(1.0, ep / max(1, warmup))
        emb.train()
        running = 0.0
        for x, y in dl:
            x, y = x.to(device), y.to(device)
            loss = loss_fn(arc(emb(x), y), y)
            opt.zero_grad(); loss.backward(); opt.step()
            running += loss.item() * len(y)
        sched.step()
        lrs = sched.get_last_lr()
        print(f"epoch {ep}: loss {running/len(ds):.4f} (m={arc.m:.2f}, lr_bb={lrs[0]:.1e}, lr_head={lrs[1]:.1e})")
        torch.save({"epoch": ep, "embed_dim": embed_dim, "emb": emb.state_dict(),
                    "arc": arc.state_dict(), "opt": opt.state_dict(),
                    "sched": sched.state_dict(), "passcodes": ds.passcodes}, ckpt_path)

    torch.save({"embed_dim": embed_dim, "state_dict": emb.state_dict(),
                "passcodes": ds.passcodes}, out_path)
    return out_path
