import argparse

import numpy as np
import torch

from ml import build_index, compose_scene, dataset
from ml.generate import load_card_manifest


def top1_accuracy(index_emb, index_passcodes, query_emb, query_passcodes) -> float:
    sims = query_emb @ index_emb.T           # (Q, N), both L2-normalised
    nn = sims.argmax(axis=1)
    pred = np.asarray(index_passcodes)[nn]
    return float((pred == np.asarray(query_passcodes)).mean())


def evaluate(ckpt_path, items, n_queries_per: int = 3, seed: int = 123) -> float:
    emb, _ = build_index.load_embedder(ckpt_path)
    index_emb = build_index.embed_clean(emb, items)
    index_pc = np.array([int(pc) for pc, _ in items], dtype=np.int64)

    rng = np.random.default_rng(seed)
    q_emb, q_pc = [], []
    with torch.no_grad():
        for pc, path in items:
            bgr = compose_scene.load_art_bgr(path)
            for _ in range(n_queries_per):
                crop = compose_scene.augment_crop(bgr, rng)
                t = dataset.to_model_tensor(crop).unsqueeze(0)
                q_emb.append(emb(t).numpy()[0])
                q_pc.append(int(pc))
    return top1_accuracy(index_emb, index_pc, np.stack(q_emb).astype(np.float32), np.array(q_pc))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cards-limit", type=int, default=None)
    parser.add_argument("--ckpt", required=True)
    parser.add_argument("--queries", type=int, default=3)
    args = parser.parse_args()
    items = load_card_manifest()
    if args.cards_limit:
        items = items[: args.cards_limit]
    acc = evaluate(args.ckpt, items, n_queries_per=args.queries)
    print(f"top-1 retrieval accuracy on {len(items)} artworks "
          f"({args.queries} queries each): {acc:.3f}")


if __name__ == "__main__":
    main()
