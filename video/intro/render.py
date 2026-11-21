"""The StarBuddy intro: what it is, the website, the desktop client.

    python3 video/intro/render.py preview
    python3 video/intro/render.py final en:emma da:roest
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
from compose import *  # noqa: E402,F403

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = list(json.load(open(os.path.join(HERE, "lines.en.json"))))

shot = images(os.path.join(WORK, "hi"))      # tools/capture.cjs
card = images(os.path.join(WORK, "cards"))   # tools/cards.cjs
for k in [k for k in shot if k.startswith("ov_")]:
    shot[k] = overlay_1x(shot[k], max_height=545 if k == "ov_refinery" else None)  # refinery: the setup order only

bg_space = backdrop("4.10.0-argo_mole-scan_mode--none-2.png", 22, 0.45)
bg_game = backdrop("4.10.0-argo_mole-scan_mode--none-2.png", 3.5, 0.85)
bg_refinery = backdrop("4.10.0-levski-refinery-order-setup.png", 3.5, 0.8)
# 1200 of 1920: about the size the client sits on a real desktop.
client_home = window(shot["client_home"], 1200)
client_org = window(shot["client_org"], 1200)

# Web pages: (shot, label, from-box, to-box); boxes are (x, y, width) on the 2x shot.
WEB = {
    "02_dashboard": ("web_dash", "l-dashboard", (0, 0, 3840), (440, 150, 2400)),
    "03_members": ("web_dash_full", "l-dashboard", (440, 150, 2400), (0, 1176, 3840)),
    "04_craft": ("web_craft", "l-craft", (0, 0, 3840), (430, 140, 2700)),
    "05_gathering": ("web_gathering", "l-gathering", (0, 0, 3840), (440, 150, 2900)),
    "06_blueprints": ("web_blueprints", "l-blueprints", (0, 0, 3840), (440, 150, 2900)),
    "07_refinery": ("web_refinery", "l-refinery", (0, 0, 3840), (440, 150, 3000)),
}

def centred(f, im, lt):
    a = ease(lt / 0.8)
    put(f, im, ((1920 - im.width) / 2, (1080 - im.height) / 2 + 30 * (1 - a)), a)

def scene(key, lt, d):
    k = lt / d
    if key in WEB:
        name, lab, a, b = WEB[key]
        f = pan(shot[name], a, b, ease(k))
        label(f, card[lab], lt)
        return f
    if key == "01_intro":
        f = pan(bg_space, (0, 0, 1920), (60, 34, 1800), k)
        c = card["intro"]
        s = 0.94 + 0.06 * ease((lt - 0.3) / 2.0)
        c = c.resize((round(c.width * s), round(c.height * s)))
        put(f, c, ((1920 - c.width) / 2, (1080 - c.height) / 2), ease((lt - 0.3) / 1.0))
        return f
    if key in ("08_client", "10_org"):
        f = pan(bg_space, (0, 0, 1920), (40, 22, 1840), k)
        centred(f, client_home if key == "08_client" else client_org, lt)
        label(f, card["l-client" if key == "08_client" else "l-org"], lt)
        return f
    if key == "09_overlays":
        split = d * 0.55
        if lt < split:
            # Trackers pop in one by one, two columns at the right.
            f = pan(bg_game, (0, 0, 1920), (30, 17, 1860), lt / split)
            for i, (n, x, y) in enumerate([("ov_pools", 1000, 50), ("ov_points", 1000, 300), ("ov_gathering", 1460, 50), ("ov_orders", 1460, 380)]):
                a = ease((lt - 0.4 - i * 0.7) / 0.4)
                put(f, shot[n], (x + 24 * (1 - a), y), a)
            label(f, card["l-overlays"], lt)
        else:
            u = lt - split
            f = pan(bg_refinery, (0, 0, 1920), (40, 22, 1840), u / (d - split))
            a = ease((u - 0.3) / 0.5)
            put(f, shot["ov_refinery"], (1400 + 30 * (1 - a), (1080 - shot["ov_refinery"].height) / 2), a)
            label(f, card["l-f8"], u)
        return f
    if key == "11_outro":
        f = pan(bg_space, (60, 34, 1800), (0, 0, 1920), k)
        put(f, card["outro"], (0, 0), ease((lt - 0.2) / 1.0) * (1 - ease((lt - (d - 0.8)) / 0.8)))
        return f
    raise KeyError(key)

if __name__ == "__main__":
    run("intro", KEYS, scene, ("en", "da"), long_keys=("01_intro", "11_outro"))
