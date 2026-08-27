# Screenshot corpus

Real in-game captures used to verify the client's on-device OCR (Scan v0+)
against what the game actually renders — different ships, resolutions,
HUD colours and states. Nothing here is processed by a server; the client
runs OCR locally, and this folder is only test data.

## Naming

```
<patch>-<ship>-<screen>-<letter>.<jpg|png>
4.10.0-argo_mole-scanning_signature-a.jpg
```

- `patch` — game version the shot was taken on (`4.10.0`).
- `ship` — lowercase, underscores (`argo_mole`, `misc_prospector`, `drake_vulture`).
- `screen` — what is on display: `scanning_signature` (scan mode with a
  pinged contact's signature badge), `scan_result` (the composition readout
  after a full scan), `refinery_order`, `inventory`, …
- `letter` — a, b, c… for several shots of the same kind.

Keep the native resolution and no HUD mods. Please avoid shots with other
players' names visible where you can; blur them otherwise.

## Running the OCR over the corpus

```sh
cd client/src-tauri
cargo run --release --example ocr_file -- screenshots/*.jpg
# small badges read better upscaled:
cargo run --release --example ocr_file -- --scale 2 ../../screenshots/4.10.0-argo_mole-scanning_signature-a.jpg
# or only a region:  --crop x,y,w,h
```

The harness downloads the two OCR models (≈15 MB) into the same app data
directory the client uses, then prints every recognised line with its
position (`x,y w×h text`).
