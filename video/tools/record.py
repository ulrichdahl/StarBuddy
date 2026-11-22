"""Record a video's narration yourself, one line at a time, like a teleprompter.

    python3 video/tools/record.py <video> <lang> <voice name> [line keys...] [--target <mic id>]

Shows each line of video/<video>/lines.<lang>.json, records while you read it
(Enter to start, Enter to stop), cleans the take and plays it back. Cleaning
uses DeepFilterNet's deep-filter binary from ~/.cache/starbuddy-video/bin/
(github.com/Rikorose/DeepFilterNet releases) and falls back to ffmpeg's
denoiser without it. Keep it, redo it or replay
it. Kept takes land in video/work/<video>/voice/<voice name>/<key>.wav, the
same place the TTS scripts write, so `render.py final da:<voice name>` uses
them. Lines already recorded are skipped unless you name their keys. Raw takes
stay in raw/ beside them. The mic is the default source unless --target gives
an id from `wpctl status`.
"""
import json, os, subprocess, sys, tempfile

VIDEO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[1:]
target = None
if "--target" in args:
    i = args.index("--target")
    target = args[i + 1]
    del args[i:i + 2]
name, lang, voice_name, *only = args
lines = json.load(open(os.path.join(VIDEO, name, f"lines.{lang}.json")))
out = os.path.join(VIDEO, "work", name, "voice", voice_name)
raw_dir = os.path.join(out, "raw")
os.makedirs(raw_dir, exist_ok=True)

DEEP_FILTER = os.path.expanduser("~/.cache/starbuddy-video/bin/deep-filter")

# After the denoiser: a mild gate on the pauses (down 16 dB, not to silence),
# less boxiness at 280 Hz, presence at 4 kHz, softer s'es, light compression,
# silence trimmed with a little air kept at each end, level evened.
POST = ("agate=threshold=0.015:range=0.15:ratio=2:attack=8:release=250,"
        "equalizer=f=280:t=o:w=1.2:g=-2.5,equalizer=f=4200:t=o:w=1.5:g=2.5,highshelf=f=10000:g=1,"
        "deesser=i=0.35,acompressor=threshold=-18dB:ratio=2.5:attack=8:release=160:makeup=2,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.25,areverse,"
        "loudnorm=I=-18:TP=-2:LRA=7")
# Without DeepFilterNet: ffmpeg's own adaptive denoiser in its place.
FALLBACK = "afftdn=nr=20:nf=-38:tn=1,"


def record(path):
    cmd = ["pw-record", "--channels", "1", "--rate", "44100"] + (["--target", target] if target else []) + [path]
    input("  Enter to start recording ")
    proc = subprocess.Popen(cmd, stderr=subprocess.DEVNULL)
    input("  \033[31m● REC\033[0m  read the line, then Enter to stop ")
    proc.terminate()
    proc.wait()


def peak_db(path):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return next((float(l.split(":")[1].split()[0]) for l in err.splitlines() if "max_volume" in l), -99.0)


def clean(raw, dest):
    """Gain to a -3 dB peak, cut rumble, denoise with DeepFilterNet (full
    strength, post-filter on), then POST. The gain follows the take, so a
    louder read is not clipped and a quiet one still reaches the denoiser."""
    level = peak_db(raw)
    gain = max(0.0, min(30.0, -3.0 - level))
    pre = f"aformat=sample_fmts=fltp,highpass=f=80,volume={gain:.1f}dB"
    with tempfile.TemporaryDirectory() as tmp:
        if os.access(DEEP_FILTER, os.X_OK):
            src = os.path.join(tmp, "in.wav")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-af", pre, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", src], check=True)
            subprocess.run([DEEP_FILTER, "-D", "--pf", "-o", os.path.join(tmp, "out"), src], check=True, capture_output=True)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(tmp, "out", "in.wav"), "-af", POST, "-ar", "44100", dest], check=True)
        else:
            print("  (DeepFilterNet not found, using ffmpeg's denoiser)")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-af", f"{pre},{FALLBACK}{POST}", "-ar", "44100", dest], check=True)
    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dest],
                         capture_output=True, text=True).stdout.strip()
    hint = "  (clipped: lower the mic gain or move back)" if level > -0.5 else "  (quiet: speak up or raise the mic gain)" if level < -15 else ""
    print(f"  {float(dur or 0):.1f} s, raw peak {level:.1f} dB{hint}")


keys = [k for k in lines if k in only] if only else [k for k in lines if not os.path.exists(f"{out}/{k}.wav")]
print(f"{len(keys)} line(s) to record into {out}\n")
for n, key in enumerate(keys, 1):
    print(f"\033[1m[{n}/{len(keys)}] {key}\033[0m\n\n  {lines[key]}\n")
    raw, dest, take = f"{raw_dir}/{key}.wav", f"{out}/{key}.take.wav", True
    while True:
        if take:
            record(raw)
            clean(raw, dest)
            subprocess.run(["pw-play", dest])
        choice = input("  [Enter] keep  [r] redo  [p] play again  [q] quit: ").strip().lower()
        if choice == "q":
            os.path.exists(dest) and os.remove(dest)
            sys.exit(0)
        if choice == "p":
            subprocess.run(["pw-play", dest])
            take = False
            continue
        if choice == "r":
            take = True
            continue
        os.replace(dest, f"{out}/{key}.wav")
        print()
        break
print("Done. Render with: python3 video/intro/render.py final ... " + f"{lang}:{voice_name}")
