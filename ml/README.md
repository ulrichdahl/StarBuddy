# Stage A — panel detector

The client's OCR reads the game's in-world panels badly because those panels are
physical objects in the scene: perspective-warped, low contrast, glare, partly
blocked by the player model. Stage A fixes the geometry before OCR ever runs.

For each capture it predicts:

- `quad` — the four corners of the panel's display area, so the client can
  rectify it by homography into a flat, front-on image;
- `screen` — which kiosk or panel this is, so the client knows what to parse;
- `hud_colour`, `occluded` — cheap auxiliaries that help routing and let you
  measure the detector's weak cases.

It predicts **no text**. Reading glyphs stays with the existing `ocrs` +
`rten` pipeline in `client/src-tauri`, which is already good at flat text.

This is a small CNN, not a VLM. Corner location is a geometry problem, and a
ResNet18 keypoint head is ~45 MB fp32 (~11 MB int8), exports to plain ONNX, and
trains usefully on a few hundred labelled captures — which is what makes it
shippable inside the Tauri client. If Stage A closes the gap, no VLM is needed;
if it does not, the end-to-end metric below will say the residual errors are
semantic rather than geometric, and that is when Stage B is worth building.

## Setup

```sh
ml/scripts/setup.sh          # uv venv on python 3.12 + torch/ROCm, then a GPU check
```

System python is 3.14 and has no torch wheels; the venv pins 3.12. ROCm 7.2.4 is
installed here, and `pyproject.toml` points at the `rocm7.0` wheel index — the
closest published one. If `torch.cuda.is_available()` comes back false, try the
`rocm6.4` index instead. gfx1100 (Navi 31) is officially supported, so no
`HSA_OVERRIDE_GFX_VERSION` override is needed.

Notes for this GPU: use bf16 (the config default) and SDPA attention. Skip
`bitsandbytes` and `flash-attn` — neither is reliable on ROCm, and neither is
needed at this model size.

## Smoke test before labelling anything

Two rough labels ship in `datasets/scan-v1/labels.seed.jsonl` — corners eyeballed
from a downscaled view, **not** ground truth. They exist only to prove the
pipeline runs end to end:

```sh
ln -s ../../../screenshots datasets/scan-v1/images   # or copy the captures in
uv run python -m starbuddy_ml.train --config configs/stage_a.yaml \
    --labels datasets/scan-v1/labels.seed.jsonl --overfit 2
```

Mean corner error must fall to single digits within a couple of hundred epochs.
It should, because the model is memorising two images. If it does not, the
geometry or the label handling is broken and more data will not help.

`--overfit` evaluates with BatchNorm using batch statistics rather than its
running averages. On two samples those averages never settle, so plain eval mode
reports a corner error three times the training loss and the smoke test looks
broken when it is not. Real runs use the running averages, as they must.

## Real workflow

1. **Label.** Run Label Studio, import `label-studio/config.xml` as the labeling
   interface, load the captures, click the four panel corners and the choice
   groups. Corner click order does not matter — the converter reorders.
   ```sh
   uvx label-studio start
   ```
   Contributors using StarBuddy's own submit page skip steps 1 and 2 entirely:
   the manager downloads an archive from the review queue, unpacks it into
   `datasets/`, and goes straight to training. That archive carries a
   `screens.yaml` naming its own label encoding, which the trainer picks up
   automatically when it sits beside `labels.jsonl` — contributors can name a
   panel nobody has submitted before, so the encoding travels with the data
   rather than living only in `configs/stage_a.yaml`.

2. **Convert.** Only for screenshots labelled by hand in Label Studio. Export
   the project as JSON (not JSON-MIN):
   ```sh
   uv run python -m starbuddy_ml.convert ~/Downloads/export.json \
       --out datasets/scan-v1/labels.jsonl
   ```
3. **Train.**
   ```sh
   uv run python -m starbuddy_ml.train --config configs/stage_a.yaml
   ```
4. **Look at the quads.** Numbers hide a lot; overlays do not.
   ```sh
   uv run python -m starbuddy_ml.predict --checkpoint runs/<run>/best.pt \
       --overlay ../screenshots/*.png
   ```
5. **Measure end to end.** The only metric that decides anything:
   ```sh
   scripts/eval_e2e.sh runs/<run>/best.pt ../screenshots/*.png
   ```
6. **Export for the client.**
   ```sh
   uv run python -m starbuddy_ml.export_onnx --checkpoint runs/<run>/best.pt --out stage_a.onnx
   ```
   The script prints the exact letterbox and normalisation the Rust side must
   reproduce. Load it with `ort`; `rten` will not run this graph.

## Data rules that matter

- **Split by capture session, not randomly.** Two shots of one kiosk from one
  seat are near-duplicates; a random split leaks them across train and val and
  reports an accuracy the client will never reach. `session` in the label file
  controls this, and the converter derives it from the corpus filename.
- **Different HUD colours matter most**, as `screenshots/README.md` already says.
  The detector must stay colour-agnostic, so collect amber, teal, blue and green
  panels, not twenty amber ones.
- **Keep the MangoHud overlay in shot if that is how you play**, and label the
  panel quad only. Cropping it out of training data would leave the client
  surprised by it in the field.
- **Target counts:** ~150 labelled captures for a first honest signal, 300–500
  for something worth shipping. The 27 in the corpus today are a smoke test.

## Layout

```
configs/stage_a.yaml         screens, hud colours, loss weights, augmentation
label-studio/config.xml      annotation interface for the schema above
datasets/scan-v1/
  images/                    captures (gitignored — symlink or copy)
  labels.jsonl               ground truth, one JSON object per capture (committed)
  labels.seed.jsonl          two approximate labels, smoke test only
src/starbuddy_ml/
  schema.py                  label types, quad ordering, letterbox geometry
  dataset.py                 loading + homography-consistent augmentation
  model.py                   ResNet18 backbone, four heads, loss
  metrics.py                 corner error, quad IoU, classification accuracy
  train.py                   training loop, --overfit smoke mode
  predict.py                 inference, rectification, overlays
  convert.py                 Label Studio export -> labels.jsonl
  export_onnx.py             ONNX export + the preprocessing contract
scripts/eval_e2e.sh          raw-vs-rectified OCR comparison via the Rust harness
runs/                        checkpoints and history (gitignored)
```

## Reading the metrics

- `corner_err_mean` — normalised units x1000. On a 2560-wide capture, 10 is about
  23 px. Under ~10 rectifies cleanly for OCR in practice; over ~25 and text near
  the panel edges shears.
- `quad_iou_ge_0.95` — fraction of captures located well enough to trust. This is
  the number to watch across a run, not the mean.
- `screen_acc` — should saturate early. If it does not, the screen taxonomy in
  `configs/stage_a.yaml` is probably splitting one visual thing into two labels.
