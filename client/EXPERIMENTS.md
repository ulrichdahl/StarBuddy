# Overlay memory experiments

Switches for A/B measuring what the overlay windows cost. Every one is off by
default and is turned on without a code change. Each is marked `EXPERIMENT:`
in the source, which is also where to look when removing it.

| Experiment | Platform | Switch | Where |
|---|---|---|---|
| E1 WebKitGTK software rendering | Linux | `STARBUDDY_WEBKIT_SOFTWARE=1` at runtime | `src-tauri/src/webkit_tuning.rs` |
| E2 One shared WebView2 renderer | Windows | `STARBUDDY_WEBVIEW2_SHARED_RENDERER=1` (or `=site`) at runtime | `src-tauri/src/webview2_args.rs` |
| E3 Preact instead of React | all | `STARBUDDY_PREACT=1` at build time | `vite.config.ts` |

## E1 — software rendering for overlays (Linux)

Sets each overlay view's `hardware-acceleration-policy` to `Never`, so WebKit
draws the panel on the CPU instead of holding a GPU/GL context per web
process. The question is whether a small, mostly static panel is cheaper that
way, and whether transparency still works.

```sh
STARBUDDY_WEBKIT_SOFTWARE=1 src-tauri/target/release/starbuddy-client
```

The log line `webkit tuning for <label>: hardware-acceleration-policy …`
(info level) says which policy each overlay ended up with. The policy is set
right after the window is built; nothing reloads the page to apply it.

## E2 — one shared WebView2 renderer (Windows)

Every window (main, each overlay, the region selector) normally gets its own
`msedgewebview2.exe --type=renderer`, although all of them show the same app
origin. This asks Chromium to keep them in one renderer process, to see how
much that saves with several overlays open.

```powershell
# Either --renderer-process-limit=1 ...
$env:STARBUDDY_WEBVIEW2_SHARED_RENDERER = '1'
# ... or that plus --process-per-site:
$env:STARBUDDY_WEBVIEW2_SHARED_RENDERER = 'site'

src-tauri\target\release\starbuddy-client.exe

# Off again:
Remove-Item Env:STARBUDDY_WEBVIEW2_SHARED_RENDERER
```

Any other value, or none, leaves the client as it is. Start the client from
the same PowerShell window that sets the variable; to test it running as
administrator, set it in a PowerShell window that is itself run as
administrator.

The arguments go to every window through the WebView2 API, with wry's own
defaults (`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection
--autoplay-policy=no-user-gesture-required`) kept in front of them, so nothing
else changes. The `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable
is not used for it: WebView2 ignores that variable when the client runs as
administrator. The log says which arguments were used, at info level, just
after `running as administrator: …`:

```
webview2 shared renderer experiment on, browser args: --disable-features=… --renderer-process-limit=1
```

Every window must be created with the same arguments, because they share one
user data folder and so one browser process. If one does not match, WebView2
refuses to create it (`0x8007139F`, `ERROR_INVALID_STATE`). The same check
applies across runs: before switching the experiment on or off, close the
client and wait until no `msedgewebview2.exe` is left from it, or the main
window can fail to open.

What to measure, with `scripts/overlay-mem.ps1`, off and then on, in each of
the three situations under Measuring:

- The `Role` column: with the experiment on there should be one `renderer`
  row however many overlays are open. Off, there is one per window, plus
  sometimes a spare. If there are still several, try `=site`.
- The process count and the `Private` and `WorkingSet` totals.
- That the `browser` row's command line carries the arguments:
  `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Select-Object ProcessId, CommandLine`.

Things to watch for while it is on:

- One renderer means one crash takes every window down at once, main window
  included, instead of only the overlay it happened in.
- One busy page (a scan, the main window's lists) can make every overlay
  stutter, since they share a main thread.
- Hidden overlays are put to sleep (`webview_power.rs`). With a shared
  renderer that cannot give a whole process back while the main window is
  visible, so the "hidden, wait 30 s" number may gain less from sleeping
  than it does with the experiment off.

## E3 — Preact build

Aliases `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime` and
`react/jsx-dev-runtime` to `preact/compat` and Preact's JSX runtime. It covers
the whole bundle, main window included: every window loads the same
`index.html`, so there is no per-window seam.

```sh
STARBUDDY_PREACT=1 npm run build          # frontend only
STARBUDDY_PREACT=1 npx tauri build --no-bundle
```

Build-time only: the `tauri dev` server keeps React's Fast Refresh and is not
expected to work with it. A build that compiles is not proof that it runs;
click through the main window and every overlay before measuring.

## Measuring

`scripts/overlay-mem.sh` (Linux, PSS from `/proc`) and
`scripts/overlay-mem.ps1` (Windows, private bytes) total the client and every
web process it spawned. Both take `--watch N` / `-Watch N` to repeat.

Run each of these with the experiment off, then on, and compare totals:

1. Only the main window open.
2. All overlays open.
3. Overlays opened, then hidden; wait 30 s before measuring.
