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
          num_workers: int = 0) -> Path:
    torch.manual_seed(seed)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    ds = dataset.ArtworkDataset(items, seed=seed)
    dl = DataLoader(ds, batch_size=batch, shuffle=True, num_workers=num_workers,
                    pin_memory=(device != "cpu"))

    emb = M.Embedder(embed_dim, freeze_backbone=freeze_backbone, pretrained=pretrained).to(device)
    arc = M.ArcFace(embed_dim, ds.num_classes()).to(device)
    params = [p for p in emb.parameters() if p.requires_grad] + list(arc.parameters())
    opt = torch.optim.Adam(params, lr=lr)
    loss_fn = torch.nn.CrossEntropyLoss()

    for ep in range(epochs):
        emb.train()
        running = 0.0
        for x, y in dl:
            x, y = x.to(device), y.to(device)
            loss = loss_fn(arc(emb(x), y), y)
            opt.zero_grad()
            loss.backward()
            opt.step()
            running += loss.item() * len(y)
        print(f"epoch {ep}: loss {running / len(ds):.4f}")

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
