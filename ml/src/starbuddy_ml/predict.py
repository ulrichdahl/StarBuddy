"""Run a trained Stage A checkpoint over images: quad, screen, rectified crop.

    python -m starbuddy_ml.predict --checkpoint runs/<run>/best.pt \
        --out datasets/scan-v1/rectified ../screenshots/*.png

Writes one rectified PNG per input plus predictions.jsonl. The rectified images
are what `ocrs` is meant to read, so this is also the producer for the
end-to-end comparison in scripts/eval_e2e.sh.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import torch

from .dataset import IMAGENET_MEAN, IMAGENET_STD, _letterbox
from .model import PanelNet
from .schema import quad_from_letterbox


def load_model(checkpoint: str | Path, device: torch.device) -> tuple[PanelNet, dict]:
    blob = torch.load(checkpoint, map_location=device, weights_only=False)
    cfg = blob["config"]
    model = PanelNet(
        n_screens=len(cfg["screens"]),
        n_hud_colours=len(cfg["hud_colours"]),
        backbone=cfg["model"]["backbone"],
        pretrained=False,
    )
    model.load_state_dict(blob["model"])
    return model.to(device).eval(), cfg


def rectify(image: np.ndarray, quad_px: np.ndarray, long_side: int = 1600) -> np.ndarray:
    """Warp the panel quad to a front-on rectangle.

    The output aspect comes from the mean of each pair of opposing edges, so a
    panel seen at an angle is un-skewed rather than stretched to a fixed shape.
    """
    tl, tr, br, bl = quad_px
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2.0
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2.0
    if width <= 1 or height <= 1:
        raise ValueError("degenerate quad")
    scale = long_side / max(width, height)
    w, h = max(2, round(width * scale)), max(2, round(height * scale))
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(quad_px.astype(np.float32), dst)
    return cv2.warpPerspective(image, matrix, (w, h), flags=cv2.INTER_CUBIC)


@torch.no_grad()
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--out", default="datasets/scan-v1/rectified")
    parser.add_argument("--long-side", type=int, default=1600)
    parser.add_argument("--overlay", action="store_true", help="also write the quad drawn on the original")
    parser.add_argument("images", nargs="+")
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, cfg = load_model(args.checkpoint, device)
    size = cfg["model"]["input_size"]
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    records = []
    for path in args.images:
        image = cv2.imread(path, cv2.IMREAD_COLOR)
        if image is None:
            print(f"! skipping unreadable {path}")
            continue
        h, w = image.shape[:2]
        canvas = _letterbox(cv2.cvtColor(image, cv2.COLOR_BGR2RGB), size)
        tensor = (canvas.astype(np.float32) / 255.0 - IMAGENET_MEAN) / IMAGENET_STD
        tensor = torch.from_numpy(tensor.transpose(2, 0, 1).copy()).unsqueeze(0).to(device)

        out = model(tensor)
        quad_lb = out["quad"][0].float().cpu().numpy().reshape(4, 2)
        quad_px = quad_from_letterbox(quad_lb, w, h, size)
        screen = cfg["screens"][int(out["screen"][0].argmax())]
        hud = cfg["hud_colours"][int(out["hud_colour"][0].argmax())]
        occluded = bool(out["occluded"][0].item() > 0)

        stem = Path(path).stem
        try:
            warped = rectify(image, quad_px, args.long_side)
            target = out_dir / f"{stem}.rectified.png"
            cv2.imwrite(str(target), warped)
        except ValueError as exc:
            target = None
            print(f"! {stem}: {exc}")

        if args.overlay:
            marked = image.copy()
            cv2.polylines(marked, [np.round(quad_px).astype(np.int32)], True, (0, 255, 0), 3)
            for i, point in enumerate(np.round(quad_px).astype(int)):
                cv2.putText(marked, str(i), tuple(point), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 255), 3)
            cv2.imwrite(str(out_dir / f"{stem}.overlay.png"), marked)

        records.append(
            {
                "image": Path(path).name,
                "screen": screen,
                "hud_colour": hud,
                "occluded": occluded,
                "quad_px": quad_px.round(1).tolist(),
                "quad_norm_1000": (quad_lb * 1000).round(1).tolist(),
                "rectified": target.name if target else None,
            }
        )
        print(f"{Path(path).name}: {screen} hud={hud} occluded={occluded}")

    (out_dir / "predictions.jsonl").write_text("\n".join(json.dumps(r) for r in records) + "\n")
    print(f"wrote {len(records)} predictions to {out_dir / 'predictions.jsonl'}")


if __name__ == "__main__":
    main()
