#!/usr/bin/env bash
# One-time setup for making StarBuddy videos. Everything large goes to
# ~/.cache/starbuddy-video (home disk; /tmp is RAM on this machine):
#   ming/ ming-ckpt/ ming-venv/     English TTS: Ming-3.0-tts-0.5B (MIT)
#   roest-ckpt/ roest-venv/         Danish TTS: CoRal Røst-v3 Chatterbox (OpenRAIL)
#   music/                          CC0 tracks from OpenGameArt
#   voices/                         your own voice recordings: never commit these
# Both TTS stacks pin torch 2.6.0 on ROCm 6.2.4 (AMD GPU); on NVIDIA use the
# cu124 index instead. They need separate venvs: Chatterbox pulls transformers 5.
set -euo pipefail
C=~/.cache/starbuddy-video
ROCM=https://download.pytorch.org/whl/rocm6.2.4
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$C/music" "$C/voices"

npm --prefix "$here" install --no-fund --no-audit

if [ ! -d "$C/ming" ]; then
  git clone -q https://github.com/inclusionAI/Ming-3.0-tts.git "$C/ming"
  git -C "$C/ming" checkout -q c88c023ea6ccc08fd1e7a1d289cb6246c21deff1
fi
if [ ! -x "$C/ming-venv/bin/python" ]; then
  uv venv -q -p 3.11 "$C/ming-venv"
  VIRTUAL_ENV=$C/ming-venv uv pip install -q torch==2.6.0 torchaudio==2.6.0 --index-url $ROCM
  VIRTUAL_ENV=$C/ming-venv uv pip install -q -r "$C/ming/requirements.txt" "huggingface_hub[cli]" --index-strategy unsafe-best-match --extra-index-url $ROCM
fi
[ -f "$C/ming-ckpt/model.safetensors" ] || "$C/ming-venv/bin/hf" download inclusionAI/Ming-3.0-tts-0.5B --local-dir "$C/ming-ckpt"

if [ ! -x "$C/roest-venv/bin/python" ]; then
  uv venv -q -p 3.11 "$C/roest-venv"
  VIRTUAL_ENV=$C/roest-venv uv pip install -q torch==2.6.0 torchaudio==2.6.0 --index-url $ROCM
  # setuptools<81: the watermarker (perth) still imports pkg_resources.
  VIRTUAL_ENV=$C/roest-venv uv pip install -q chatterbox-tts huggingface_hub "setuptools<81" torch==2.6.0 torchaudio==2.6.0 --index-strategy unsafe-best-match --extra-index-url $ROCM
fi
[ -f "$C/roest-ckpt/t3_mtl23ls_v2.safetensors" ] || "$C/roest-venv/bin/hf" download CoRal-project/roest-v3-chatterbox-500m --local-dir "$C/roest-ckpt"

# Music, all CC0 (https://opengameart.org): "Claimed by the Void" (Vitalezzz) is the default.
[ -f "$C/music/void.mp3" ] || curl -sSLo "$C/music/void.mp3" https://opengameart.org/sites/default/files/claimed_by_the_void_0.mp3
[ -f "$C/music/magic_space.mp3" ] || curl -sSLo "$C/music/magic_space.mp3" "https://opengameart.org/sites/default/files/magic%20space.mp3"
[ -f "$C/music/outer_space.mp3" ] || curl -sSLo "$C/music/outer_space.mp3" https://opengameart.org/sites/default/files/outer_space_2.mp3
echo "ready: $C"
