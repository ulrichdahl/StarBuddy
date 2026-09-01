"""Export a Stage A checkpoint to ONNX for the Rust client.

    python -m starbuddy_ml.export_onnx --checkpoint runs/<run>/best.pt --out stage_a.onnx

The graph takes a letterboxed NCHW float tensor already normalised with the
ImageNet statistics, and returns quad / screen / hud_colour / occluded. The
client must reproduce the same letterbox and normalisation — see the constants
printed at the end of this script.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch

from .dataset import IMAGENET_MEAN, IMAGENET_STD
from .predict import load_model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--out", default="stage_a.onnx")
    # torch 2.10 exports opset 18 by default. Forcing a lower opset runs the
    # ONNX version converter, which fails on this graph, so only pass one if
    # the Rust `ort` build in use actually needs it.
    parser.add_argument("--opset", type=int, default=None)
    args = parser.parse_args()

    model, cfg = load_model(args.checkpoint, torch.device("cpu"))
    size = cfg["model"]["input_size"]
    dummy = torch.zeros(1, 3, size, size)

    class Wrapped(torch.nn.Module):
        """Tuple outputs export more predictably than a dict across runtimes."""

        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, image):
            out = self.inner(image)
            return out["quad"], out["screen"], out["hud_colour"], out["occluded"]

    torch.onnx.export(
        Wrapped(model),
        dummy,
        args.out,
        input_names=["image"],
        output_names=["quad", "screen", "hud_colour", "occluded"],
        dynamic_axes={"image": {0: "batch"}},
        opset_version=args.opset,
        # One self-contained file. The default splits 45 MB of weights into a
        # sidecar .onnx.data, which is one more thing for the client to bundle
        # and keep next to the graph.
        external_data=False,
    )

    # Parity check: an export that loads but drifts from the checkpoint is worse
    # than one that fails outright, because it fails quietly in the client.
    import numpy as np
    import onnxruntime as ort

    session = ort.InferenceSession(args.out, providers=["CPUExecutionProvider"])
    probe = torch.randn(1, 3, size, size)
    with torch.no_grad():
        expected = Wrapped(model)(probe)
    actual = session.run(None, {"image": probe.numpy()})
    worst = max(
        float(np.abs(e.numpy() - a).max()) for e, a in zip(expected, actual)
    )
    print(f"onnxruntime parity: worst absolute difference {worst:.2e}")
    if worst > 1e-4:
        raise SystemExit("export does not match the checkpoint — do not ship this graph")

    print(f"wrote {args.out} ({Path(args.out).stat().st_size / 1e6:.1f} MB)")
    print("client-side preprocessing must match exactly:")
    print(f"  input       : {size}x{size} letterbox, aspect preserved, zero padding, RGB")
    print(f"  normalise   : (pixel/255 - {IMAGENET_MEAN.tolist()}) / {IMAGENET_STD.tolist()}")
    print(f"  screens     : {cfg['screens']}")
    print(f"  hud_colours : {cfg['hud_colours']}")
    print("  quad        : 8 floats, normalised letterbox coords, TL/TR/BR/BL; undo the letterbox to get pixels")


if __name__ == "__main__":
    main()
