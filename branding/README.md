# StarBuddy branding

- `starbuddy-mark.svg` — the logo mark (guide star + amber companion star on an orbit arc), transparent background. Source for `frontend/public/logo.svg`, `favicon.svg`, and `client/public/logo.svg`.
- `starbuddy-icon.svg` — the mark on the deep-space plate, square canvas. Source for app icons: `rsvg-convert -w 1024 -h 1024 starbuddy-icon.svg -o starbuddy-icon-1024.png && (cd ../client && npx tauri icon ../branding/starbuddy-icon-1024.png)` regenerates `client/src-tauri/icons/`; `frontend/public/apple-touch-icon.png` is the same at 180px.
- Palette: cyan `#5BC8DB` (theme primary), amber `#E8B45A` (theme secondary), ground `#0C1117`.

## Made by the Community logo

`made-by-the-community.svg` is Cloud Imperium's fan-kit badge, used under the
[Star Citizen Fan Kit](https://robertsspaceindustries.com/fankit) terms: it may
only be resized or have its opacity changed (never below 50%), never recolored,
distorted, inverted or textured. It appears in every footer together with the
required notice and a link to <https://robertsspaceindustries.com/>.
