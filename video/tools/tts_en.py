"""English narration with Ming-3.0-tts: one wav per line of a video's lines.en.json.

    ~/.cache/starbuddy-video/ming-venv/bin/python video/tools/tts_en.py <video> <voice name> <voice> [line keys...]

<voice> is a built-in voice (US_Emma, UK_George, UK_Charlotte) or
clone:<wav>:<txt>, a recording and exactly what it says, both under
~/.cache/starbuddy-video/voices/. Output: video/work/<video>/voice/<voice name>/.
Give line keys to redo only those lines.
"""
import json, os, sys, time

CACHE = os.path.expanduser("~/.cache/starbuddy-video")
VIDEO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(CACHE, "ming"))
from ming_tts import MingTTS  # noqa: E402

name, voice_name, voice = sys.argv[1:4]
only = set(sys.argv[4:])
lines = json.load(open(os.path.join(VIDEO, name, "lines.en.json")))
out = os.path.join(VIDEO, "work", name, "voice", voice_name)
os.makedirs(out, exist_ok=True)
# No pynini here: write lines as they are said ("Game dot log").
model = MingTTS(os.path.join(CACHE, "ming-ckpt"), text_normalization=False)
for key, text in lines.items():
    if only and key not in only:
        continue
    t = time.time()
    if voice.startswith("clone:"):
        ref, said = (os.path.join(CACHE, "voices", p) for p in voice[6:].split(":", 1))
        model.synthesize(task="TTS", language_id="English", text=text, prompt_wav_path=ref,
                         prompt_text=open(said).read().strip(), use_spk_emb=True, output_path=f"{out}/{key}.wav")
    else:
        model.synthesize(task="IP", text=text, controls={"ip": voice}, use_zero_spk_emb=True, output_path=f"{out}/{key}.wav")
    print(key, f"{time.time() - t:.1f}s", flush=True)
