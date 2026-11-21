"""Frame compositing and audio mixing shared by the StarBuddy videos.

A video is a list of scenes, one per narration line. Each video folder has a
render.py that describes what its scenes show (a function of the scene key,
the time into the scene and its length) and calls run(). Scene lengths follow
the narration, so changing a line re-times the cut.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

VIDEO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(VIDEO)
WORK = os.path.join(VIDEO, "work")
CACHE = os.path.expanduser("~/.cache/starbuddy-video")
SHOTS = os.path.join(REPO, "screenshots")
SIZE = (1920, 1080)
LEAD, TAIL, XF = 0.5, 0.8, 0.6  # silence before a line, after it, crossfade

def ease(x):
    x = min(1, max(0, x))
    return x * x * (3 - 2 * x)

def load(p):
    return Image.open(p).convert("RGBA")

def cover(im):
    """Scale an image to fill the frame."""
    s = max(SIZE[0] / im.width, SIZE[1] / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - SIZE[0]) // 2, (im.height - SIZE[1]) // 2
    return im.crop((x, y, x + SIZE[0], y + SIZE[1]))

def backdrop(name, blur, brightness):
    """A game screenshot as background. Blur enough that no names or chat can be read."""
    im = cover(load(os.path.join(SHOTS, name)))
    return ImageEnhance.Brightness(im.filter(ImageFilter.GaussianBlur(blur))).enhance(brightness)

def images(folder):
    return {n[:-4]: load(os.path.join(folder, n)) for n in os.listdir(folder) if n.endswith(".png")}

def overlay_1x(im, max_height=None):
    """Overlay shots are taken at 2x on transparency: trim, cut, show at 1x."""
    im = im.crop(im.getbbox())
    if max_height:
        im = im.crop((0, 0, im.width, min(im.height, max_height * 2)))
    return im.resize((im.width // 2, im.height // 2), Image.LANCZOS)

def window(im, w):
    """An app window at width w, with a border and a soft shadow."""
    h = round(im.height * w / im.width)
    win = im.resize((w, h), Image.LANCZOS)
    pad = 60
    sh = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((pad, pad + 14, pad + w, pad + h + 14), fill=(0, 0, 0, 190))
    sh = sh.filter(ImageFilter.GaussianBlur(26))
    sh.alpha_composite(win, (pad, pad))
    ImageDraw.Draw(sh).rectangle((pad, pad, pad + w - 1, pad + h - 1), outline=(60, 201, 240, 120), width=2)
    return sh

def pan(im, a, b, k):
    """Crop box moving from a to b, each (x0, y0, width) at 16:9, scaled to the frame."""
    x, y, w = (a[i] + (b[i] - a[i]) * k for i in range(3))
    return im.resize(SIZE, Image.BICUBIC, box=(x, y, x + w, y + w * 9 / 16))

def put(frame, im, xy, a=1.0):
    if a <= 0:
        return
    if a < 1:
        im = im.copy()
        im.putalpha(im.getchannel("A").point(lambda v: int(v * a)))
    frame.alpha_composite(im, (round(xy[0]), round(xy[1])))

def label(frame, card, lt):
    """A scene label sliding in at the bottom left."""
    a = ease(lt / 0.5)
    put(frame, card, (40 - 30 * (1 - a), 900), a)

def duration(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                                capture_output=True, text=True, check=True).stdout)

def timeline(keys, voice_dirs, estimate=None, long_keys=()):
    """Scenes timed to the longest narration of each line across voice_dirs."""
    scenes, t = [], 0.0
    for key in keys:
        lens = [duration(f"{d}/{key}.wav") for d in voice_dirs if os.path.exists(f"{d}/{key}.wav")]
        spoken = max(lens) if lens else estimate(key)
        d = LEAD + spoken + TAIL + (1.2 if key in long_keys else 0)
        scenes.append({"key": key, "start": t, "dur": d})
        t += d - XF
    return scenes, t + XF

def render(scenes, total, scene_frame, out, fps=30, preview=False):
    """Frames to an H.264 file, crossfading overlapping scenes, fading in from black."""
    def frame_at(t):
        f = None
        for s in scenes:
            lt = t - s["start"]
            if 0 <= lt < s["dur"]:
                g = scene_frame(s["key"], lt, s["dur"])
                a = ease(lt / XF) if s is not scenes[0] else 1.0
                f = g if f is None or a >= 1 else Image.blend(f, g, a)
        if t < 0.6:
            f = Image.blend(Image.new("RGBA", SIZE, (0, 0, 0, 255)), f, ease(t / 0.6))
        return f.convert("RGB")

    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1920x1080", "-r", str(fps),
                            "-i", "-", "-c:v", "libx264", "-preset", "ultrafast" if preview else "medium", "-crf", "18",
                            "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    for i in range(int(total * fps)):
        enc.stdin.write(frame_at(i / fps).tobytes())
        if i % (fps * 10) == 0:
            print(f"{i / fps:.0f}/{total:.0f}s", flush=True)
    enc.stdin.close()
    if enc.wait():
        sys.exit("ffmpeg failed")

def narration_track(scenes, total, voice_dir, music, out, max_tempo=1.15):
    """Lines at their scene starts, music under them, ducked by the voice; -16 LUFS.
    A line longer than its slot is sped up, at most max_tempo."""
    inputs, parts = [], []
    for i, s in enumerate(scenes):
        p = f"{voice_dir}/{s['key']}.wav"
        slot = s["dur"] - LEAD - 0.35 - (1.2 if i == len(scenes) - 1 else 0)
        d = duration(p)
        tempo = min(max_tempo, d / slot) if d > slot else 1.0
        if tempo > 1 or d / tempo > slot + 0.05:
            print(f"  {s['key']}: {d:.1f}s in {slot:.1f}s, tempo {tempo:.2f}")
        inputs += ["-i", p]
        ms = int((s["start"] + LEAD) * 1000)
        parts.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,atempo={tempo:.3f},adelay={ms}|{ms}[v{i}]")
    n = len(scenes)
    g = ";".join(parts) + ";" + "".join(f"[v{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,apad,atrim=0:{total:.2f},asplit[voice][key]"
    g += f";[{n}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.32,afade=t=in:d=2,afade=t=out:st={total - 4:.2f}:d=4,atrim=0:{total:.2f}[mus]"
    g += ";[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=600[duck];[voice][duck]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5[a]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-stream_loop", "-1", "-i", music, "-filter_complex", g,
                    "-map", "[a]", "-c:a", "aac", "-b:a", "192k", out], check=True)

LANG = {"en": ("eng", "English"), "da": ("dan", "Dansk")}

def mux(video, tracks, out):
    """tracks: [(lang, audio file)], the first is the default."""
    args, maps = ["-i", video], ["-map", "0:v"]
    for i, (lang, a) in enumerate(tracks):
        args += ["-i", a]
        maps += ["-map", f"{i + 1}:a", f"-metadata:s:a:{i}", f"language={LANG[lang][0]}", f"-metadata:s:a:{i}", f"title={LANG[lang][1]}",
                 f"-disposition:a:{i}", "default" if i == 0 else "0"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args, *maps, "-c", "copy", "-shortest", out], check=True)

def web_version(src, track, out):
    """One language for a <video> tag (browsers cannot switch tracks): streams at once.
    CRF 20, not 26: at 26 the small UI text and the blurred backdrops showed
    blocking; this is about twice the size (~30 MB for two minutes)."""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-map", "0:v", "-map", f"0:a:{track}", "-c:v", "libx264",
                    "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
                    "-movflags", "+faststart", out], check=True)

def run(name, keys, scene_frame, langs, long_keys=()):
    """CLI for a video folder's render.py:
      render.py preview             silent 10 fps draft, timed from estimates or existing voice
      render.py final <lang:voice>  e.g. en:emma da:roest  (voice = folder under work/<name>/voice/)
    The first language is the default track. Also writes one web file per language."""
    here = os.path.join(WORK, name)
    os.makedirs(here, exist_ok=True)
    lines = {lang: json.load(open(os.path.join(VIDEO, name, f"lines.{lang}.json"))) for lang in ("en", "da")
             if os.path.exists(os.path.join(VIDEO, name, f"lines.{lang}.json"))}
    estimate = lambda k: len(lines["en"][k].split()) / 2.6
    music = os.path.join(CACHE, "music", "void.mp3")
    if sys.argv[1:2] == ["preview"]:
        scenes, total = timeline(keys, [], estimate, long_keys)
        render(scenes, total, scene_frame, os.path.join(here, "preview.mp4"), fps=10, preview=True)
        print("preview", os.path.join(here, "preview.mp4"))
        return
    picks = [a.split(":", 1) for a in sys.argv[2:]]
    dirs = [os.path.join(here, "voice", v) for _, v in picks]
    scenes, total = timeline(keys, dirs, estimate, long_keys)
    json.dump(scenes, open(os.path.join(here, "timing.json"), "w"), indent=1)
    silent = os.path.join(here, "silent.mp4")
    render(scenes, total, scene_frame, silent)
    tracks = []
    for (lang, v), d in zip(picks, dirs):
        a = os.path.join(here, f"{lang}-{v}.m4a")
        print("track", lang, v)
        narration_track(scenes, total, d, music, a)
        tracks.append((lang, a))
    tag = "-".join(f"{l}_{v}" for l, v in picks)
    out = os.path.join(here, f"starbuddy-{name}-{tag}.mp4")
    mux(silent, tracks, out)
    for i, (lang, v) in enumerate(picks):
        web_version(out, i, os.path.join(here, f"starbuddy-{name}.{lang}.web.mp4"))
    os.remove(silent)
    print("done", out)
