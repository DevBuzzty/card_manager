import argparse
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from ml import config, dataset
from ml import model as M
from ml.generate import load_card_manifest


def train(items, out_path, epochs: int = 5, embed_dim: int = 128,
          freeze_backbone: bool = True, pretrained: bool = True,
          batch: int = 64, lr: float = 1e-3, device: str = "cpu", seed: int = 0,
          num_workers: int = 0, views_per_class: int = 1, margin: float = 0.5,
          warmup_epochs: int = 5) -> Path:
    torch.manual_seed(seed)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    ds = dataset.ArtworkDataset(items, seed=seed, views_per_class=views_per_class)
    dl = DataLoader(ds, batch_size=batch, shuffle=True, num_workers=num_workers,
                    pin_memory=(device != "cpu"))

    emb = M.Embedder(embed_dim, freeze_backbone=freeze_backbone, pretrained=pretrained).to(device)
    arc = M.ArcFace(embed_dim, ds.num_classes(), m=margin).to(device)
    params = [p for p in emb.parameters() if p.requires_grad] + list(arc.parameters())
    opt = torch.optim.Adam(params, lr=lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)
    loss_fn = torch.nn.CrossEntropyLoss()

    for ep in range(epochs):
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
