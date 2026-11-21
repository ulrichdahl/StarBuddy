# StarBuddy videos

Narrated videos about StarBuddy (intro, help, how-tos), made from the real website and desktop client running on the local dev stack with fake data. Every video folder (like `intro/`) has the script in two languages and a `render.py` that describes what each scene shows. `tools/` holds the shared parts.

Output: 1920×1080 at 30 fps, with English and Danish narration tracks over CC0 music. The music ducks under the voice, and loudness is -16 LUFS. You also get one web file per language, because a `<video>` tag cannot switch audio tracks.

## One-time setup

```
video/setup.sh
```

This installs the two text-to-speech stacks, the models and the music into `~/.cache/starbuddy-video`, which is about 12 GB. It is on the home disk because `/tmp` is a RAM disk on this machine. It assumes an AMD GPU (ROCm). For NVIDIA, change the torch index in `setup.sh`.

- **English:** [Ming-3.0-tts-0.5B](https://huggingface.co/inclusionAI/Ming-3.0-tts-0.5B) (MIT). It has built-in voices `US_Emma`, `UK_George` and `UK_Charlotte`, or it can clone a voice.
- **Danish:** [Røst-v3-chatterbox-500m](https://huggingface.co/CoRal-project/roest-v3-chatterbox-500m) from CoRal / the Alexandra Institute (OpenRAIL). It has its own voice, or it can clone one. It reads English words with a Danish accent, so prefer Danish wording.
- **Music:** "Claimed by the Void" by Vitalezzz, CC0, from [OpenGameArt](https://opengameart.org/content/claimed-by-the-void).

## Making a video

Run everything from the repo root, with the dev stack running (`localhost:8090`).

1. **Fake data.** Run `video/tools/demo-data.sh seed`. It backs up the dev DB first, then adds 5 orgs and 30 pilots. You are "Kestrel" in "Nova Vanguard". It writes `video/work/seed.json`, which holds a dev session cookie and device token, so it is git-ignored.
2. **Client preview.** Run `npm --prefix client run build`, then `node video/tools/preview-server.cjs &`. This serves the desktop client on port 8767 with a Tauri stub (`tools/preview-stub.js`). The stub says where the player is and what the refinery terminal showed. Server calls go to the dev site as Kestrel.
3. **Screenshots.** `node video/tools/capture.cjs` writes 2x shots of the website pages, the client pages and the overlays to `video/work/hi/`.
4. **Cards.** `node video/tools/cards.cjs` writes the title cards and scene labels from `tools/cards.html` to `video/work/cards/`. To add a label, add an element with an id.
5. **Draft.** `python3 video/intro/render.py preview` makes a silent 10 fps draft timed from word counts.
6. **Narration.** Each command writes one wav per line to `video/work/<video>/voice/<name>/`. Add line keys at the end to redo only those lines.
   ```
   ~/.cache/starbuddy-video/ming-venv/bin/python video/tools/tts_en.py intro emma US_Emma
   ~/.cache/starbuddy-video/roest-venv/bin/python video/tools/tts_da.py intro roest
   ```
7. **Final.** `python3 video/intro/render.py final en:emma da:roest` times each scene to the longer of the two languages. It writes `video/work/intro/starbuddy-intro-….mp4` with both tracks, plus `starbuddy-intro.en.web.mp4` and `starbuddy-intro.da.web.mp4`.
8. **Clean up.** Run `video/tools/demo-data.sh unseed` and stop the preview server.

The game backgrounds come from `screenshots/` and are blurred, so no player names or chat can be read. Check any new background for names before using it.

## Your own voice

Recordings stay in `~/.cache/starbuddy-video/voices/` and never go into the repo (`*.wav` is ignored here). Note that a published video in your voice gives anyone enough clean speech to clone it.

1. Record 15–20 seconds with a headset mic: `pw-record --target <mic id from wpctl status> --channels 1 --rate 44100 ~/.cache/starbuddy-video/voices/me-en.wav`.
2. Clean it with `video/tools/clean-voice.sh ~/.cache/starbuddy-video/voices/me-en.wav`. Speech should be about 20 dB louder than the pauses.
3. For English, the model also needs the exact text you read, in `voices/me-en.txt`. Then run `tts_en.py intro en-me clone:me-en-clean.wav:me-en.txt`.
4. For Danish, run `tts_da.py intro da-me me-da-clean.wav`.

Sample texts that cover most sounds:

- **en:** Welcome aboard. Tonight we're heading out from Port Tressler, and our first stop is the mining fields near Yela. Keep an eye on the scanner, check your fuel, and make sure the cargo is secured. When the refinery job is done, we'll share the yield with the whole crew. Good work, everyone. See you out there among the stars.
- **da:** Velkommen ombord. I aften flyver vi ud fra Port Tressler, og første stop er minerne ved Yela. Hold øje med radaren, tjek brændstoffet, og sørg for, at lasten er sikret. Når ordren er færdig på raffinaderiet, deler vi udbyttet med hele holdet. Godt arbejde, alle sammen. Vi ses derude blandt stjernerne.

## A new video

Copy `intro/` to a new folder. Write `lines.en.json` and `lines.da.json`, one key per scene, in order, written the way they are spoken: "Game dot log", "F8". Then change `scene()` in `render.py` to show what each line is about. `tools/compose.py` has the helpers: pan or zoom over a 2x shot, a window on a blurred backdrop, overlays popping in, labels and title cards.
