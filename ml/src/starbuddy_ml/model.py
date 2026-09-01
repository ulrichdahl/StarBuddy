"""The Stage A network: one small backbone, four heads.

Deliberately not a VLM. Corner regression is a geometry problem, and a 512-input
ResNet18 with a keypoint head is ~45 MB of fp32 weights (~11 MB int8), exports to
ONNX without special cases, and trains to useful accuracy on a few hundred
labelled captures. That is what makes it shippable inside the Tauri client.
"""

from __future__ import annotations

import torch
from torch import nn
from torchvision import models


class PanelNet(nn.Module):
    def __init__(
        self,
        n_screens: int,
        n_hud_colours: int,
        backbone: str = "resnet18",
        pretrained: bool = True,
    ) -> None:
        super().__init__()
        factory = {"resnet18": models.resnet18, "resnet34": models.resnet34}[backbone]
        weights = "IMAGENET1K_V1" if pretrained else None
        net = factory(weights=weights)
        features = net.fc.in_features
        net.fc = nn.Identity()
        self.backbone = net

        self.quad = nn.Sequential(nn.Linear(features, 256), nn.ReLU(inplace=True), nn.Linear(256, 8))
        self.screen = nn.Linear(features, n_screens)
        self.hud_colour = nn.Linear(features, n_hud_colours)
        self.occluded = nn.Linear(features, 1)

    def forward(self, image: torch.Tensor) -> dict[str, torch.Tensor]:
        h = self.backbone(image)
        return {
            # Raw coordinates, not sigmoid-squashed: a corner can legitimately sit
            # outside the frame when the panel runs off the edge of the capture.
            "quad": self.quad(h),
            "screen": self.screen(h),
            "hud_colour": self.hud_colour(h),
            "occluded": self.occluded(h).squeeze(-1),
        }


def compute_loss(out: dict[str, torch.Tensor], batch: dict[str, torch.Tensor], weights: dict[str, float]):
    quad = nn.functional.smooth_l1_loss(out["quad"], batch["quad"], beta=0.02)
    screen = nn.functional.cross_entropy(out["screen"], batch["screen"])
    hud = nn.functional.cross_entropy(out["hud_colour"], batch["hud_colour"])
    occluded = nn.functional.binary_cross_entropy_with_logits(out["occluded"], batch["occluded"])
    total = (
        weights.get("quad", 1.0) * quad
        + weights.get("screen", 0.0) * screen
        + weights.get("hud_colour", 0.0) * hud
        + weights.get("occluded", 0.0) * occluded
    )
    return total, {"quad": quad.item(), "screen": screen.item(), "hud_colour": hud.item(), "occluded": occluded.item()}
