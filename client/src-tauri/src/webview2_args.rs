//! EXPERIMENT E2: every StarBuddy webview in one WebView2 renderer process.
//!
//! On Windows each window (main, every overlay, the region selector) gets its
//! own `msedgewebview2.exe --type=renderer`, although they all show the same
//! app origin. The experiment asks Chromium to keep them in one, to see what
//! that saves with several overlays open.
//!
//! Switch: run the client with `STARBUDDY_WEBVIEW2_SHARED_RENDERER=1`
//! (`--renderer-process-limit=1`) or `=site` (that plus `--process-per-site`).
//! Anything else, or unset, changes nothing. See `client/EXPERIMENTS.md`.
//! Remove this file and its three calls (`run()` and `setup` in `lib.rs`,
//! `overlay::create`, `region::open_selector`) to end it.
//!
//! Why every window has to be told, and not just the overlays: all windows
//! share one user data folder (Tauri forces the app's local data dir), so
//! they share one browser process, and WebView2 refuses to create a webview
//! whose environment options differ from the ones that browser process was
//! started with (`HRESULT_FROM_WIN32(ERROR_INVALID_STATE)`, 0x8007139F). The
//! main window comes from `tauri.conf.json`, so it gets the same arguments by
//! editing the loaded config before the app is built.
//!
//! Why not the `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` environment variable,
//! which would reach every window with one `set_var`: WebView2 ignores every
//! `WEBVIEW2_*` variable when the host runs elevated, and players do run the
//! client as administrator to get their hotkeys past the game. Arguments
//! passed through the API are honoured either way.

/// What wry 0.57 passes when a window names no browser arguments, and what
/// naming any replaces (`wry/src/webview2/mod.rs`, `create_environment`).
/// The autoplay switch is part of it because wry's `autoplay` defaults to on
/// and Tauri never turns it off. Kept, so the only change is the experiment.
#[cfg(windows)]
const WRY_DEFAULTS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// The browser arguments every webview is built with while the experiment is
/// on. Read once, so every window in a run gets the identical string.
#[cfg(windows)]
fn shared_renderer() -> Option<&'static str> {
    static ARGS: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    ARGS.get_or_init(|| {
        let extra = match std::env::var("STARBUDDY_WEBVIEW2_SHARED_RENDERER").as_deref() {
            Ok("1") => "--renderer-process-limit=1",
            Ok("site") => "--renderer-process-limit=1 --process-per-site",
            _ => return None,
        };
        Some(format!("{WRY_DEFAULTS} {extra}"))
    })
    .as_deref()
}

/// Give the windows declared in `tauri.conf.json` the experiment's arguments.
/// Call before the app is built. Does nothing unless the experiment is on.
pub fn apply_to_config(config: &mut tauri::Config) {
    #[cfg(windows)]
    if let Some(args) = shared_renderer() {
        for window in &mut config.app.windows {
            window.additional_browser_args = Some(args.to_string());
        }
    }
    #[cfg(not(windows))]
    let _ = config;
}

/// Give a window built in code the experiment's arguments. Does nothing
/// unless the experiment is on.
pub fn apply<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    #[cfg(windows)]
    if let Some(args) = shared_renderer() {
        return builder.additional_browser_args(args);
    }
    builder
}

/// Say at info level which arguments the webviews are created with. Call once
/// the logger is up.
pub fn log_effective() {
    #[cfg(windows)]
    {
        match shared_renderer() {
            Some(args) => log::info!("webview2 shared renderer experiment on, browser args: {args}"),
            None => log::info!("webview2 shared renderer experiment off, browser args: wry defaults"),
        }
        // Appended by WebView2 on top of whatever the app passes, unless the
        // client runs elevated, in which case it is ignored.
        if let Ok(env) = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
            log::info!("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is set: {env}");
        }
    }
}
