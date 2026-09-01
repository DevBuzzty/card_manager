import argparse
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from ml import config, dataset
from ml import model as M
from ml.generate import load_card_manifest


def _load_embedder_weights(emb, path, device):
    """Warm-start: load just the embedder weights, tolerating several checkpoint layouts
    (raw state_dict, or wrapped under 'state_dict'/'emb'/'model')."""
    ck = torch.load(path, map_location=device)
    if isinstance(ck, dict):
        sd = ck.get("state_dict") or ck.get("emb") or ck.get("model") or ck
    else:
        sd = ck
    emb.load_state_dict(sd)


def train(items, out_path, epochs: int = 5, embed_dim: int = 128,
          freeze_backbone: bool = True, pretrained: bool = True,
          batch: int = 64, lr: float = 1e-3, device: str = "cpu", seed: int = 0,
          num_workers: int = 0, views_per_class: int = 1, margin: float = 0.5,
          warmup_epochs: int = 5, resume: str = None, init_from: str = None) -> Path:
    torch.manual_seed(seed)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ckpt_path = out_path.with_suffix(".ckpt")  # full-state checkpoint, written every epoch

    ds = dataset.ArtworkDataset(items, seed=seed, views_per_class=views_per_class)
    dl = DataLoader(ds, batch_size=batch, shuffle=True, num_workers=num_workers,
                    pin_memory=(device != "cpu"))

    emb = M.Embedder(embed_dim, freeze_backbone=freeze_backbone, pretrained=pretrained).to(device)
    arc = M.ArcFace(embed_dim, ds.num_classes(), m=margin).to(device)
    params = [p for p in emb.parameters() if p.requires_grad] + list(arc.parameters())
    opt = torch.optim.Adam(params, lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    loss_fn = torch.nn.CrossEntropyLoss()

    start_epoch = 0
    if init_from:
        # Warm start from a weights-only checkpoint (e.g. a per-epoch save from the notebook):
        # keep the learned embedder, but start a fresh optimizer/schedule.
        _load_embedder_weights(emb, init_from, device)
        print(f"warm-started embedder from {init_from}")
    if resume:
        # Full resume: continue the exact run (optimizer + schedule + epoch counter). Requires the
        # SAME dataset (same cards/seed) because ArcFace's classifier is per-class.
        ck = torch.load(resume, map_location=device)
        emb.load_state_dict(ck["emb"])
        arc.load_state_dict(ck["arc"])
        opt.load_state_dict(ck["opt"])
        sched.load_state_dict(ck["sched"])
        start_epoch = ck["epoch"] + 1
        print(f"resumed from epoch {ck['epoch']} -> continuing at {start_epoch} ({resume})")

    for ep in range(start_epoch, epochs):
        # Margin warmup: start as plain cosine-softmax (m=0) and ramp to the full
        # angular margin, so the hard margin doesn't stall training from scratch.
        arc.m = margin * min(1.0, ep / max(1, warmup_epochs))
        emb.train()
        running = 0.0
        for x, y in dl:
            x, y = x.to(device), y.to(device)
            loss = loss_fn(arc(emb(x), y), y)
            opt.zero_grad()
            loss.backward()
            opt.step()
            running += loss.item() * len(y)
        sched.step()
        print(f"epoch {ep}: loss {running / len(ds):.4f} "
              f"(m={arc.m:.2f}, lr={sched.get_last_lr()[0]:.2e})")
        # Persist a full-state checkpoint every epoch so a killed run (Colab limits) can resume.
        torch.save({"epoch": ep, "embed_dim": embed_dim, "emb": emb.state_dict(),
                    "arc": arc.state_dict(), "opt": opt.state_dict(),
                    "sched": sched.state_dict(), "passcodes": ds.passcodes}, ckpt_path)

    torch.save({"embed_dim": embed_dim, "state_dict": emb.state_dict(),
                "passcodes": ds.passcodes}, out_path)
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cards-limit", type=int, default=None)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--no-freeze", dest="freeze", action="store_false")
    parser.add_argument("--out", default=str(config.OUT_DIR / "embedder.pt"))
    args = parser.parse_args()
    items = load_card_manifest()
    if args.cards_limit:
        items = items[: args.cards_limit]
    train(items, out_path=args.out, epochs=args.epochs, freeze_backbone=args.freeze)
    print(f"trained on {len(items)} artworks -> {args.out}")


if __name__ == "__main__":
    main()
