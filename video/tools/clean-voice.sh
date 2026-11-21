#!/usr/bin/env bash
# Prepare a voice recording for cloning: cut rumble, light denoise, trim the
# silence at both ends, even out the level. Prints the speech-to-noise check.
#   video/tools/clean-voice.sh ~/.cache/starbuddy-video/voices/me-da.wav
# writes me-da-clean.wav next to it. Aim for 15-20 s, speech 20+ dB over the
# noise floor (the per-half-second levels: speech around -40, pauses -60).
set -euo pipefail
in=$1
out=${in%.wav}-clean.wav
echo "levels (dB per 0.5 s):"
ffmpeg -hide_banner -i "$in" -af "asetnsamples=22050,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" -f null - 2>&1 |
  grep -oE "RMS_level=[-0-9.inf]+" | awk -F= '{printf "%s ", int($2)} END {print ""}'
ffmpeg -v error -y -i "$in" -af "highpass=f=80,afftdn=nf=-60:nr=10,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.25,areverse,loudnorm=I=-18:TP=-2" -ar 44100 "$out"
echo "$out: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out") s"
