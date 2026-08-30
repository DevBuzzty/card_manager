import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models


class Embedder(nn.Module):
    def __init__(self, embed_dim: int = 128, freeze_backbone: bool = True, pretrained: bool = True):
        super().__init__()
        weights = models.MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
        backbone = models.mobilenet_v3_small(weights=weights)
        self.features = backbone.features
        self.pool = nn.AdaptiveAvgPool2d(1)
        in_dim = backbone.classifier[0].in_features   # 576 for mobilenet_v3_small
        self.head = nn.Linear(in_dim, embed_dim)
        if freeze_backbone:
            for p in self.features.parameters():
                p.requires_grad = False

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = self.pool(x).flatten(1)
        x = self.head(x)
        return F.normalize(x, dim=1)


class ArcFace(nn.Module):
    """Additive angular margin head. `emb` is expected L2-normalised."""

    def __init__(self, embed_dim: int, n_classes: int, s: float = 30.0, m: float = 0.5):
        super().__init__()
        self.weight = nn.Parameter(torch.empty(n_classes, embed_dim))
        nn.init.xavier_uniform_(self.weight)
        self.s = s
        self.m = m

    def forward(self, emb: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        cos = emb @ F.normalize(self.weight, dim=1).t()
        cos = cos.clamp(-1 + 1e-7, 1 - 1e-7)
        theta = torch.acos(cos)
        onehot = torch.zeros_like(cos)
        onehot.scatter_(1, labels.view(-1, 1), 1.0)
        margined = torch.cos(theta + self.m * onehot)
        return self.s * margined
