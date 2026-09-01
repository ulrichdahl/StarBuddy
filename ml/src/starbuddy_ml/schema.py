"""Label schema, quad conventions, and the letterbox geometry shared by all stages.

Quads are always four (x, y) pairs in top-left, top-right, bottom-right,
bottom-left order, normalised to 0..1 against the *original* image. Consistent
ordering is not cosmetic: the corner regression loss compares point 0 to point 0,
so a quad stored in a different winding trains the model toward the average of
two incompatible answers.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

CORNER_ORDER = ("top_left", "top_right", "bottom_right", "bottom_left")


@dataclass
class Sample:
    """One labelled capture. Mirrors a line of labels.jsonl."""

    image: str
    screen: str
    quad: list[list[float]]  # 4 x [x, y], normalised 0..1, TL/TR/BR/BL
    patch: str = "unknown"
    hud_colour: str = "unknown"
    occluded: bool = False
    session: str = ""  # capture session; splits are grouped by this, never random
    regions: list[dict] = field(default_factory=list)  # Stage B only, ignored here

    def quad_array(self) -> np.ndarray:
        return np.asarray(self.quad, dtype=np.float32).reshape(4, 2)


def order_quad(points: np.ndarray) -> np.ndarray:
    """Sort four arbitrary points into TL, TR, BR, BL.

    Label tools emit polygon vertices in click order, which annotators get wrong
    often enough that normalising here is cheaper than policing it by hand.

    Uses the sum/difference rule rather than angle sorting: for a panel that is
    roughly upright — which every in-world screen is, since the game does not
    render them rotated past a few degrees — x+y is smallest at the top-left and
    largest at the bottom-right, while x-y separates the other two.
    """
    pts = np.asarray(points, dtype=np.float32).reshape(4, 2)
    total = pts.sum(axis=1)
    diff = pts[:, 0] - pts[:, 1]
    top_left, bottom_right = int(np.argmin(total)), int(np.argmax(total))
    remaining = [i for i in range(4) if i not in (top_left, bottom_right)]
    top_right, bottom_left = sorted(remaining, key=lambda i: -diff[i])
    order = [top_left, top_right, bottom_right, bottom_left]
    if len(set(order)) != 4:
        raise ValueError(f"cannot order degenerate quad {pts.tolist()}")
    return pts[order]


def load_labels(path: str | Path) -> list[Sample]:
    samples: list[Sample] = []
    with open(path, encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            line = line.strip()
            if not line or line.startswith("//"):
                continue
            raw = json.loads(line)
            quad = np.asarray(raw["quad"], dtype=np.float32).reshape(4, 2)
            if quad.max() > 1.5:  # tolerate 0..1000 files by scaling once, here
                quad = quad / 1000.0
            raw["quad"] = quad.tolist()
            raw.pop("_comment", None)
            try:
                samples.append(Sample(**raw))
            except TypeError as exc:
                raise ValueError(f"{path}:{line_no}: {exc}") from exc
    return samples


def split_by_session(samples: list[Sample], val_fraction: float, seed: int) -> tuple[list[Sample], list[Sample]]:
    """Hold out whole capture sessions.

    Two shots of the same kiosk from the same seat are near-duplicates. Splitting
    them randomly leaks the validation set into training and reports an accuracy
    the client will never see.
    """
    rng = np.random.default_rng(seed)
    sessions = sorted({s.session or s.image for s in samples})
    rng.shuffle(sessions)
    n_val = max(1, round(len(sessions) * val_fraction)) if len(sessions) > 1 else 0
    val_sessions = set(sessions[:n_val])
    train = [s for s in samples if (s.session or s.image) not in val_sessions]
    val = [s for s in samples if (s.session or s.image) in val_sessions]
    return train, val


# --- letterbox geometry -------------------------------------------------------
# The corpus mixes 2560x1440 and 5120x1440. Squashing an ultrawide shot to a
# fixed square would distort the panel differently per resolution, so every image
# is letterboxed into a square with aspect preserved and the quad moved with it.


def letterbox_transform(width: int, height: int, size: int) -> tuple[float, float, float]:
    """Return (scale, pad_x, pad_y) mapping original pixels into a size x size canvas."""
    scale = min(size / width, size / height)
    pad_x = (size - width * scale) / 2.0
    pad_y = (size - height * scale) / 2.0
    return scale, pad_x, pad_y


def quad_to_letterbox(quad_norm: np.ndarray, width: int, height: int, size: int) -> np.ndarray:
    """Normalised-original quad -> normalised-letterbox quad."""
    scale, pad_x, pad_y = letterbox_transform(width, height, size)
    px = quad_norm[:, 0] * width * scale + pad_x
    py = quad_norm[:, 1] * height * scale + pad_y
    return np.stack([px / size, py / size], axis=1).astype(np.float32)


def quad_from_letterbox(quad_lb: np.ndarray, width: int, height: int, size: int) -> np.ndarray:
    """Normalised-letterbox quad -> original pixel quad."""
    scale, pad_x, pad_y = letterbox_transform(width, height, size)
    px = (quad_lb[:, 0] * size - pad_x) / scale
    py = (quad_lb[:, 1] * size - pad_y) / scale
    return np.stack([px, py], axis=1).astype(np.float32)
