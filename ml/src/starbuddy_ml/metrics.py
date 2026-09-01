"""Stage A metrics.

Corner error is reported in normalised units x1000 so the numbers read on the
same 0..1000 scale as the labels: "mean corner error 9" means nine thousandths of
the image, about 23 px on a 2560-wide capture.
"""

from __future__ import annotations

import cv2
import numpy as np


def corner_error(pred: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Per-corner euclidean distance, normalised units x1000. Shapes: (N, 4, 2)."""
    return np.linalg.norm(pred - target, axis=-1) * 1000.0


def quad_iou(pred: np.ndarray, target: np.ndarray, raster: int = 256) -> float:
    """Mask IoU of two normalised quads, rasterised rather than clipped.

    Rasterising avoids a polygon-clipping dependency and stays correct for the
    self-intersecting quads an undertrained model produces early in a run.
    """
    a = np.zeros((raster, raster), dtype=np.uint8)
    b = np.zeros((raster, raster), dtype=np.uint8)
    cv2.fillPoly(a, [np.round(pred * raster).astype(np.int32)], 1)
    cv2.fillPoly(b, [np.round(target * raster).astype(np.int32)], 1)
    union = np.count_nonzero(a | b)
    return float(np.count_nonzero(a & b) / union) if union else 0.0


def summarise(preds: dict[str, np.ndarray], targets: dict[str, np.ndarray]) -> dict[str, float]:
    quads_p = preds["quad"].reshape(-1, 4, 2)
    quads_t = targets["quad"].reshape(-1, 4, 2)
    errors = corner_error(quads_p, quads_t)
    ious = np.array([quad_iou(p, t) for p, t in zip(quads_p, quads_t)])

    out = {
        "corner_err_mean": float(errors.mean()),
        "corner_err_p90": float(np.percentile(errors, 90)),
        "corner_err_worst": float(errors.max()),
        "quad_iou_mean": float(ious.mean()),
        # A panel this well located rectifies cleanly enough for OCR; below it,
        # text near the edges starts to shear.
        "quad_iou_ge_0.95": float((ious >= 0.95).mean()),
        "screen_acc": float((preds["screen"] == targets["screen"]).mean()),
        "hud_colour_acc": float((preds["hud_colour"] == targets["hud_colour"]).mean()),
        "occluded_acc": float(((preds["occluded"] > 0) == (targets["occluded"] > 0.5)).mean()),
    }
    return out
