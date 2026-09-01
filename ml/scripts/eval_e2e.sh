#!/usr/bin/env bash
# End-to-end check: does rectifying by the predicted quad make the existing OCR
# read better? This is the only metric that says whether Stage A earned its place.
#
#   ml/scripts/eval_e2e.sh runs/<run>/best.pt ../screenshots/*.png
#
# Prints two OCR runs per image — raw capture, then rectified panel — using the
# client's own harness so the comparison is against what ships.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: $0 <checkpoint> <image>..." >&2
  exit 2
fi

checkpoint="$1"; shift
ml_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$ml_dir/.." && pwd)"
out_dir="$ml_dir/datasets/scan-v1/rectified"

python -m starbuddy_ml.predict --checkpoint "$checkpoint" --out "$out_dir" --overlay "$@"

echo
echo "=== baseline: OCR on the raw captures ==="
(cd "$repo/client/src-tauri" && cargo run --release --quiet --example ocr_file -- "$@")

echo
echo "=== rectified: OCR on the predicted panel ==="
mapfile -t rectified < <(ls "$out_dir"/*.rectified.png 2>/dev/null || true)
if [ ${#rectified[@]} -eq 0 ]; then
  echo "no rectified images produced — check predict output above" >&2
  exit 1
fi
(cd "$repo/client/src-tauri" && cargo run --release --quiet --example ocr_file -- "${rectified[@]}")

echo
echo "Compare line counts and whether quantities/labels came out intact."
echo "Overlays for eyeballing the quad: $out_dir/*.overlay.png"
