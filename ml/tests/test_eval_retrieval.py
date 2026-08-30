import numpy as np
from ml import eval_retrieval, compose_scene


def test_top1_accuracy_pure():
    # index has two clearly separated unit vectors
    index_emb = np.array([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32)
    index_pc = np.array([111, 222])
    # queries near each of them
    query_emb = np.array([[0.9, 0.1], [0.1, 0.9]], dtype=np.float32)
    query_emb /= np.linalg.norm(query_emb, axis=1, keepdims=True)
    query_pc = np.array([111, 222])
    assert eval_retrieval.top1_accuracy(index_emb, index_pc, query_emb, query_pc) == 1.0
    # swap query labels -> all wrong
    assert eval_retrieval.top1_accuracy(index_emb, index_pc, query_emb, np.array([222, 111])) == 0.0


def test_evaluate_returns_fraction(tmp_path, monkeypatch):
    import torch
    from ml import model as M
    monkeypatch.setattr(compose_scene, "load_art_bgr",
                        lambda p: np.full((120, 80, 3), 180, np.uint8))
    emb = M.Embedder(embed_dim=128, freeze_backbone=True, pretrained=False)
    ckpt = tmp_path / "ckpt.pt"
    torch.save({"embed_dim": 128, "state_dict": emb.state_dict(), "passcodes": [1, 2]}, ckpt)
    acc = eval_retrieval.evaluate(ckpt, [(1, "a"), (2, "b")], n_queries_per=2, seed=0)
    assert 0.0 <= acc <= 1.0
