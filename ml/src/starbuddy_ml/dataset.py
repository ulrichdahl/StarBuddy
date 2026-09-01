"""Dataset and augmentation for Stage A.

Augmentation is doing most of the work while the corpus is small: every geometric
transform is applied as a single homography so the image and the four labelled
corners can never drift apart.
"""

from __future__ import annotations

import random
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

from .schema import Sample, letterbox_transform, quad_to_letterbox

IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def _letterbox(image: np.ndarray, size: int) -> np.ndarray:
    h, w = image.shape[:2]
    scale, pad_x, pad_y = letterbox_transform(w, h, size)
    resized = cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
    canvas = np.zeros((size, size, 3), dtype=image.dtype)
    y0, x0 = round(pad_y), round(pad_x)
    canvas[y0 : y0 + resized.shape[0], x0 : x0 + resized.shape[1]] = resized
    return canvas


def _geometric_homography(size: int, cfg: dict, rng: random.Random) -> np.ndarray:
    """Random similarity + perspective warp of the whole letterboxed canvas."""
    src = np.array([[0, 0], [size, 0], [size, size], [0, size]], dtype=np.float32)
    dst = src.copy()

    jitter = cfg.get("perspective", 0.0) * size
    if jitter:
        dst += np.array([[rng.uniform(-jitter, jitter) for _ in range(2)] for _ in range(4)], dtype=np.float32)

    lo, hi = cfg.get("scale", [1.0, 1.0])
    s = rng.uniform(lo, hi)
    angle = np.deg2rad(rng.uniform(-cfg.get("rotate_deg", 0.0), cfg.get("rotate_deg", 0.0)))
    t = cfg.get("translate", 0.0) * size
    centre = np.array([size / 2.0, size / 2.0], dtype=np.float32)
    rot = np.array(
        [[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]],
        dtype=np.float32,
    )
    dst = (dst - centre) @ rot.T * s + centre
    dst += np.array([rng.uniform(-t, t), rng.uniform(-t, t)], dtype=np.float32)

    return cv2.getPerspectiveTransform(src, dst.astype(np.float32))


def _apply_homography(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    homogeneous = np.concatenate([points, np.ones((len(points), 1), dtype=np.float32)], axis=1)
    warped = homogeneous @ matrix.T
    return (warped[:, :2] / warped[:, 2:3]).astype(np.float32)


def _colour_jitter(image: np.ndarray, cfg: dict, rng: random.Random) -> np.ndarray:
    out = image.astype(np.float32) / 255.0

    b = cfg.get("brightness", 0.0)
    if b:
        out *= 1.0 + rng.uniform(-b, b)
    c = cfg.get("contrast", 0.0)
    if c:
        mean = out.mean()
        out = (out - mean) * (1.0 + rng.uniform(-c, c)) + mean

    s, hue = cfg.get("saturation", 0.0), cfg.get("hue", 0.0)
    if s or hue:
        hsv = cv2.cvtColor(np.clip(out, 0, 1), cv2.COLOR_RGB2HSV)
        if s:
            hsv[..., 1] *= 1.0 + rng.uniform(-s, s)
        if hue:
            hsv[..., 0] = (hsv[..., 0] + rng.uniform(-hue, hue) * 180.0) % 180.0
        out = cv2.cvtColor(np.clip(hsv, 0, [180, 1, 1]), cv2.COLOR_HSV2RGB)

    n = cfg.get("noise", 0.0)
    if n:
        out += np.random.normal(0.0, n, out.shape).astype(np.float32)

    return (np.clip(out, 0.0, 1.0) * 255.0).astype(np.uint8)


class PanelDataset(Dataset):
    def __init__(
        self,
        samples: list[Sample],
        images_dir: str | Path,
        size: int,
        screens: list[str],
        hud_colours: list[str],
        augment: dict | None = None,
    ) -> None:
        self.samples = samples
        self.images_dir = Path(images_dir)
        self.size = size
        self.screens = screens
        self.hud_colours = hud_colours
        self.augment = augment or {}

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> dict[str, torch.Tensor]:
        sample = self.samples[index]
        path = self.images_dir / sample.image
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            raise FileNotFoundError(f"cannot read {path}")
        h, w = image.shape[:2]
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        quad = quad_to_letterbox(sample.quad_array(), w, h, self.size) * self.size
        canvas = _letterbox(image, self.size)

        if self.augment:
            rng = random.Random()
            matrix = _geometric_homography(self.size, self.augment, rng)
            canvas = cv2.warpPerspective(canvas, matrix, (self.size, self.size), flags=cv2.INTER_LINEAR)
            quad = _apply_homography(quad, matrix)
            canvas = _colour_jitter(canvas, self.augment, rng)

        tensor = (canvas.astype(np.float32) / 255.0 - IMAGENET_MEAN) / IMAGENET_STD
        tensor = torch.from_numpy(tensor.transpose(2, 0, 1).copy())

        return {
            "image": tensor,
            # Corners may land slightly outside the canvas after warping. They are
            # kept unclamped: the panel's true corner is off-screen in those shots,
            # and clamping would teach the model to stop at the frame edge.
            "quad": torch.from_numpy((quad / self.size).astype(np.float32).reshape(-1)),
            "screen": torch.tensor(self._index(self.screens, sample.screen), dtype=torch.long),
            "hud_colour": torch.tensor(self._index(self.hud_colours, sample.hud_colour), dtype=torch.long),
            "occluded": torch.tensor(float(sample.occluded), dtype=torch.float32),
            "index": torch.tensor(index, dtype=torch.long),
        }

    @staticmethod
    def _index(vocabulary: list[str], value: str) -> int:
        if value not in vocabulary:
            raise ValueError(f"{value!r} is not in the configured list {vocabulary}")
        return vocabulary.index(value)
