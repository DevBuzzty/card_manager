import torch
from ml import model as M


def test_embedder_output_is_normalised():
    emb = M.Embedder(embed_dim=128, freeze_backbone=True, pretrained=False).eval()
    x = torch.randn(2, 3, 224, 224)
    with torch.no_grad():
        out = emb(x)
    assert tuple(out.shape) == (2, 128)
    norms = out.norm(dim=1)
    assert torch.allclose(norms, torch.ones(2), atol=1e-4)


def test_embedder_freezes_backbone():
    emb = M.Embedder(freeze_backbone=True, pretrained=False)
    assert all(not p.requires_grad for p in emb.features.parameters())
    assert all(p.requires_grad for p in emb.head.parameters())


def test_arcface_logits_shape_and_loss():
    arc = M.ArcFace(embed_dim=128, n_classes=5)
    emb = torch.nn.functional.normalize(torch.randn(4, 128), dim=1)
    labels = torch.tensor([0, 1, 2, 3])
    logits = arc(emb, labels)
    assert tuple(logits.shape) == (4, 5)
    loss = torch.nn.functional.cross_entropy(logits, labels)
    assert torch.isfinite(loss)
