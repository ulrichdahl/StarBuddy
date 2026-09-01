"""Label Studio export -> labels.jsonl.

    python -m starbuddy_ml.convert export.json --out datasets/scan-v1/labels.jsonl

Handles the polygon (panel quad), the three choice groups, and the optional
Stage B rectangles/keypoints if they are present, so the same annotation project
can serve both stages later.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np

from .schema import order_quad

SESSION_RE = re.compile(r"^(?P<patch>[\d.]+)-(?P<rest>.+?)(?:-\d+|-[a-z])?$")


def _session_of(filename: str) -> str:
    """Group shots of one screen taken in one sitting.

    The corpus naming (`<patch>-<ship>-<screen>-<letter>`) already encodes it:
    everything but the trailing index belongs to one session.
    """
    match = SESSION_RE.match(Path(filename).stem)
    return match.group(0)[: match.start("rest") + len(match.group("rest"))] if match else Path(filename).stem


def _first(annotation: list[dict], type_name: str, from_name: str | None = None) -> dict | None:
    for item in annotation:
        if item.get("type") == type_name and (from_name is None or item.get("from_name") == from_name):
            return item
    return None


def convert(export: list[dict]) -> list[dict]:
    rows = []
    for task in export:
        annotations = task.get("annotations") or []
        if not annotations:
            continue
        result = annotations[0].get("result", [])
        image_ref = task.get("data", {}).get("image", "")
        filename = Path(image_ref.split("?")[0]).name
        # Label Studio prefixes uploads with a hash; strip it so the name matches
        # the file the capture corpus actually ships.
        filename = re.sub(r"^[0-9a-f]{8}-", "", filename)

        polygon = _first(result, "polygonlabels") or _first(result, "polygon")
        if not polygon:
            print(f"! {filename}: no panel polygon, skipped")
            continue
        points = np.asarray(polygon["value"]["points"], dtype=np.float32) / 100.0  # LS uses percent
        if len(points) != 4:
            print(f"! {filename}: polygon has {len(points)} points, need 4, skipped")
            continue

        def choice(from_name: str, default: str) -> str:
            item = _first(result, "choices", from_name)
            values = (item or {}).get("value", {}).get("choices") or []
            return values[0] if values else default

        rows.append(
            {
                "image": filename,
                "patch": choice("patch", "unknown"),
                "screen": choice("screen", "other"),
                "hud_colour": choice("hud_colour", "unknown"),
                "occluded": choice("occluded", "no") == "yes",
                "session": _session_of(filename),
                "quad": order_quad(points).round(5).tolist(),
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("export", help="Label Studio JSON export (JSON, not JSON-MIN)")
    parser.add_argument("--out", default="datasets/scan-v1/labels.jsonl")
    args = parser.parse_args()

    export = json.loads(Path(args.export).read_text())
    rows = convert(export)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    print(f"{len(rows)} labelled captures -> {args.out}")
    screens: dict[str, int] = {}
    for row in rows:
        screens[row["screen"]] = screens.get(row["screen"], 0) + 1
    for screen, count in sorted(screens.items(), key=lambda kv: -kv[1]):
        print(f"  {count:4d}  {screen}")


if __name__ == "__main__":
    main()
