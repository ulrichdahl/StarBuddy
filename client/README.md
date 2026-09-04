# StarBuddy desktop client

Tauri 2 + React + TypeScript. Watches `Game.log`, reads in-game panels off the
screen with OCR, and shows overlay windows over the game.

## Building it locally

Nothing here needs GitHub. A push to `develop` produces a dev build because it
is convenient to hand someone an installer, not because it is the way to test a
change.

**While working on a window** — `npm run tauri dev`. Vite serves the frontend
with hot reload, so a change to `src/overlay/*.tsx` or `overlay.css` is on
screen as soon as it is saved, with no build at all. Rust changes rebuild the
binary and restart it, which takes under a minute once the dependencies are
compiled. The first run compiles them in the debug profile and is slow.

**To check the real thing** — `npx tauri build --no-bundle`, about a minute
against a warm cache, then run
`src-tauri/target/release/starbuddy-client`. This is the release build with the
frontend baked in, which is what an installer contains; only the packaging is
skipped.

**To produce installers** — `npm run tauri build` writes `.deb`, `.rpm` and
`.AppImage` to `src-tauri/target/release/bundle/`. The AppImage step downloads
its packaging tools the first time. CI is still the place to build for Windows.

All three share the app's config and data directories with an installed copy
(`io.github.ulrichdahl.starbuddy`), so a locally built client is already paired
with whatever server the installed one is paired with, and carries the same
overlay positions and scan region. Two of them running at once will fight over
the global hotkeys.

## Tests

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

The panel parsers are tested against OCR output captured from the real game,
kept verbatim including its misreads. Two opt-in tests read a directory of
captures instead of a fixture, for working on the readers against a labelled
set exported from the training page:

```sh
REFINERY_CORPUS=<dir with images/ and labels.jsonl> \
  cargo test --manifest-path src-tauri/Cargo.toml --release --lib \
  refinery::corpus -- --ignored --nocapture
```

`REFINERY_CORPUS_LINES=1` adds every OCR line with its box, which is what tells
a capture OCR could not read from one the parser threw away.
