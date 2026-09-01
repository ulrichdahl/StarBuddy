#!/usr/bin/env bash
# One-time environment setup for Stage A training on the 7900 XTX.
#
# System python is 3.14, which has no torch/ROCm wheels yet, so this pins 3.12
# into a local venv via uv.
set -euo pipefail
ml_dir="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ml_dir"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed. Install it first:  curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi

uv venv --python 3.12
uv sync

echo
echo "Checking that torch sees the GPU…"
uv run python - <<'PY'
import torch
print("torch", torch.__version__)
print("hip", getattr(torch.version, "hip", None))
print("gpu visible:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("device:", torch.cuda.get_device_name(0))
    free, total = torch.cuda.mem_get_info()
    print(f"vram: {total/1e9:.1f} GB total, {free/1e9:.1f} GB free")
else:
    print("! no GPU. If ROCm is installed, the wheel index in pyproject.toml may")
    print("  need to match your ROCm version (found /opt/rocm 7.2.4).")
PY
