"""Danish narration with CoRal's Røst-v3 Chatterbox: one wav per line of a video's lines.da.json.

    ~/.cache/starbuddy-video/roest-venv/bin/python video/tools/tts_da.py <video> <voice name> [voice.wav] [line keys...]

Without a wav it uses the model's own voice; with one (under
~/.cache/starbuddy-video/voices/, 10-20 s of clean Danish) it clones it.
Output: video/work/<video>/voice/<voice name>/. The model handles sentences
best, so each line is said sentence by sentence with a short pause between.
"""
import json, os, re, sys, time
import torch, torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

CACHE = os.path.expanduser("~/.cache/starbuddy-video")
VIDEO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name, voice_name, *rest = sys.argv[1:]
prompt = os.path.join(CACHE, "voices", rest.pop(0)) if rest and rest[0].endswith(".wav") else None
only = set(rest)
lines = json.load(open(os.path.join(VIDEO, name, "lines.da.json")))
out = os.path.join(VIDEO, "work", name, "voice", voice_name)
os.makedirs(out, exist_ok=True)
torch.manual_seed(7)
model = ChatterboxMultilingualTTS.from_local(os.path.join(CACHE, "roest-ckpt"), device="cuda")
for key, text in lines.items():
    if only and key not in only:
        continue
    t = time.time()
    pause = torch.zeros(1, int(model.sr * 0.28))
    wavs = []
    for s in [s for s in re.split(r"(?<=[.!?:])\s+", text) if s]:
        wavs += [model.generate(s, language_id="da", audio_prompt_path=prompt, temperature=0.7, cfg_weight=0.5).cpu(), pause]
    ta.save(f"{out}/{key}.wav", torch.cat(wavs[:-1], dim=1), model.sr)
    print(key, f"{time.time() - t:.1f}s", flush=True)
