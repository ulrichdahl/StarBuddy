//! In-game overlay windows: frameless, transparent, always-on-top panels
//! that the player toggles with a hotkey. Each window keeps its own prefs
//! (placement mode, size state, opacity, position) in overlay.json.
//!
//! Placement modes: `floating` (drag anywhere), `dock-left` / `dock-right`
//! (pinned to that edge, slides up and down), `dock-top` / `dock-bottom`
//! (strip pinned to that edge, slides left and right; centred until moved).
//! Size: `full` or `minimal`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use crate::lock::LockExt;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// The RSI status window — the first overlay surface.
pub const STATUS: &str = "status";
/// The dashboard trackers: tracked pools, gathering, refinery orders, points.
pub const TRACKERS: [&str; 4] = ["pools", "gathering", "orders", "points"];
/// Default per action. F6 is unbound in Star Citizen's current default
/// keyset (F1 mobiGlas, F2 starmap, F4 camera, F11 comms, F12 chat are not).
/// F8 reads the refinery panel, F9 sends the frame for training, F10 switches
/// reading the screen on and off. None is bound in Star Citizen's current
/// default keyset, like F6 and F7.
///
/// The rest open and close one overlay window each, or hide and show them all
/// at once. They have no key until the player gives them one: a key the game
/// or another program uses is worse than none.
pub const DEFAULT_HOTKEYS: [(&str, &str); 13] = [
    // Insert: bound to nothing in Star Citizen's default profile
    // (Data/Libs/Config/defaultProfile.xml, 4.x), where F12 is chat.
    ("main", "Insert"),
    ("status", "F6"),
    ("scan", "F7"),
    ("refinery", "F8"),
    ("capture", "F9"),
    ("reading", "F10"),
    ("overlays", ""),
    ("overlay-scan", ""),
    ("overlay-refinery", ""),
    ("overlay-pools", ""),
    ("overlay-gathering", ""),
    ("overlay-orders", ""),
    ("overlay-points", ""),
];

/// Every overlay window, in the order the "overlays" key goes through them.
pub fn overlay_windows() -> impl Iterator<Item = &'static str> {
    [STATUS, crate::scan::SCAN, crate::refinery::REFINERY].into_iter().chain(TRACKERS)
}
/// Every overlay's window is destroyed after it has been hidden this long.
/// A hidden webview is a whole browser process kept alive for nothing: measured
/// on Linux, about 55 MB each, since WebKitGTK cannot suspend one. Rebuilding
/// the window on the next hotkey is not noticeable to the player, and the delay
/// keeps a quick hide and show instant. On Windows the webview is suspended
/// (`webview_power`) for the time it waits. The scan window waits longer while
/// the live scan runs: see [`destroy_when_idle`].
const IDLE_DESTROY_AFTER: Duration = Duration::from_secs(30);
/// Pre-F6 default; a stored copy of it is migrated to the new default.
const LEGACY_DEFAULT_HOTKEY: &str = "Ctrl+Alt+S";
/// CLI flag a second launch (or a desktop-environment keybinding) uses to
/// toggle the status window — the hotkey path for Wayland desktops.
pub const TOGGLE_FLAG: &str = "--toggle-status";
/// The same thing for any action: `--action refinery`. A desktop that will not
/// bind a key to the portal's shortcuts will still run a command on one, and
/// this is that command — the second launch hands the argument to the running
/// client and exits.
pub const ACTION_FLAG: &str = "--action";

/// The action a command line asks for, if it asks for one.
pub fn action_in(args: &[String]) -> Option<String> {
    if args.iter().any(|a| a == TOGGLE_FLAG) {
        return Some("status".into());
    }
    let at = args.iter().position(|a| a == ACTION_FLAG)?;
    let wanted = args.get(at + 1)?;
    DEFAULT_HOTKEYS.iter().find(|(a, _)| a == wanted).map(|(a, _)| a.to_string())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct WindowPrefs {
    pub mode: String,
    pub size: String,
    pub opacity: f64,
    /// Logical position for floating; for dock-left/right only `y` matters.
    pub x: f64,
    pub y: f64,
    /// Along-edge offset for dock-top/bottom; None = centred.
    pub dock_x: Option<f64>,
    /// Last content size the webview asked for (logical px).
    pub width: f64,
    pub height: f64,
    /// Visible when the app last quit → restored on next start.
    pub open: bool,
}

impl Default for WindowPrefs {
    fn default() -> Self {
        Self {
            mode: "floating".into(),
            size: "full".into(),
            opacity: 1.0,
            x: 40.0,
            y: 40.0,
            dock_x: None,
            width: 440.0,
            height: 200.0,
            open: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct OverlayPrefs {
    /// Legacy single hotkey (status window); folded into `hotkeys` on load.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub hotkey: String,
    /// action → shortcut; missing actions use DEFAULT_HOTKEYS.
    pub hotkeys: HashMap<String, String>,
    pub windows: HashMap<String, WindowPrefs>,
}

impl OverlayPrefs {
    fn migrate(mut self) -> Self {
        if !self.hotkey.is_empty() {
            if self.hotkey != LEGACY_DEFAULT_HOTKEY && !self.hotkeys.contains_key("status") {
                self.hotkeys.insert("status".into(), std::mem::take(&mut self.hotkey));
            }
            self.hotkey.clear();
        }
        self
    }

    pub fn hotkey_for(&self, action: &str) -> Option<String> {
        self.hotkeys
            .get(action)
            .cloned()
            .or_else(|| DEFAULT_HOTKEYS.iter().find(|(a, _)| *a == action).map(|(_, k)| k.to_string()))
    }

    /// Every action with its effective shortcut.
    pub fn all_hotkeys(&self) -> Vec<(String, String)> {
        DEFAULT_HOTKEYS
            .iter()
            .map(|(a, _)| (a.to_string(), self.hotkey_for(a).unwrap_or_default()))
            .filter(|(_, k)| !k.is_empty())
            .collect()
    }
}

pub struct OverlayState {
    prefs: Mutex<OverlayPrefs>,
    last_saved: Mutex<Instant>,
    /// Per window: ignore Moved events until this instant. Set around our
    /// own show()/set_position() calls, because the window manager may
    /// re-place a re-shown window and report that as a move — which must
    /// not overwrite the position the player chose.
    quiet_until: Mutex<HashMap<String, Instant>>,
    /// Currently registered global shortcuts and the action each triggers.
    registered: Mutex<Vec<(Shortcut, String)>>,
    /// action → why its shortcut is not live. A key another program owns
    /// registers as an error rather than a press that never arrives, and the
    /// player can only act on that if it reaches the settings panel.
    failures: Mutex<HashMap<String, String>>,
    /// Per window: what the visibility hooks know about it.
    presence: Mutex<HashMap<String, Presence>>,
}

/// One overlay window as [`on_shown`] and [`on_hidden`] last left it.
#[derive(Default)]
struct Presence {
    /// On screen. Overlay-only events are delivered only while this is true.
    shown: bool,
    /// Bumped on every show, hide and destroy, so an idle timer started at one
    /// hide can tell that the window has been shown since and stand down.
    generation: u64,
    /// Bumped each time the window is built. The event handler of a destroyed
    /// window carries its own number, so it cannot act on a rebuilt one.
    instance: u64,
    /// Overlay-only events sent while the window was hidden: the latest payload
    /// of each, oldest first, replayed when it is shown again so it does not
    /// come back showing what it last saw.
    missed: Vec<(String, serde_json::Value)>,
}

impl OverlayState {
    pub fn load(app: &AppHandle) -> Self {
        let prefs: OverlayPrefs = prefs_path(app).and_then(|p| crate::fs_atomic::read_json(&p)).unwrap_or_default();
        Self {
            prefs: Mutex::new(prefs.migrate()),
            registered: Mutex::new(Vec::new()),
            failures: Mutex::new(HashMap::new()),
            last_saved: Mutex::new(Instant::now() - Duration::from_secs(10)),
            quiet_until: Mutex::new(HashMap::new()),
            presence: Mutex::new(HashMap::new()),
        }
    }
}

fn quiet(app: &AppHandle, name: &str, ms: u64) {
    app.state::<OverlayState>().quiet_until.lock_or_recover().insert(name.to_string(), Instant::now() + Duration::from_millis(ms));
}

fn is_quiet(app: &AppHandle, name: &str) -> bool {
    app.state::<OverlayState>().quiet_until.lock_or_recover().get(name).is_some_and(|t| Instant::now() < *t)
}

fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("overlay.json"))
}

fn save(app: &AppHandle, force: bool) {
    let state = app.state::<OverlayState>();
    {
        let mut last = state.last_saved.lock_or_recover();
        if !force && last.elapsed() < Duration::from_millis(400) {
            return;
        }
        *last = Instant::now();
    }
    if let Some(path) = prefs_path(app) {
        // Held across the write, so two saves land in the order they were made.
        let prefs = state.prefs.lock_or_recover();
        if let Ok(json) = serde_json::to_vec_pretty(&*prefs) {
            if let Err(e) = crate::fs_atomic::write(&path, &json) {
                log::warn!("{} could not be written: {e}", path.display());
            }
        }
    }
}

fn label(name: &str) -> String {
    format!("overlay-{name}")
}

fn name_of(label: &str) -> Option<&str> {
    label.strip_prefix("overlay-")
}

fn window_prefs(app: &AppHandle, name: &str) -> WindowPrefs {
    app.state::<OverlayState>().prefs.lock_or_recover().windows.get(name).cloned().unwrap_or_else(|| first_place(name))
}

/// Where a window opens the first time: the trackers down the right of the
/// default spot rather than all on top of each other and the status window.
fn first_place(name: &str) -> WindowPrefs {
    let mut prefs = WindowPrefs::default();
    if let Some(i) = TRACKERS.iter().position(|t| *t == name) {
        prefs.x = 500.0;
        prefs.y = 40.0 + 230.0 * i as f64;
    }
    prefs
}

fn update_prefs(app: &AppHandle, name: &str, f: impl FnOnce(&mut WindowPrefs)) -> WindowPrefs {
    let state = app.state::<OverlayState>();
    let mut prefs = state.prefs.lock_or_recover();
    let w = prefs.windows.entry(name.to_string()).or_insert_with(|| first_place(name));
    f(w);
    w.clone()
}

/// Show the window if hidden (creating it on first use), hide it if shown.
/// Returns the new visibility. Must run on the main thread — window
/// creation is main-thread-only on Windows; callers off it use
/// [`toggle_from_anywhere`].
pub fn toggle(app: &AppHandle, name: &str) -> Result<bool, String> {
    let now_visible = if let Some(win) = app.get_webview_window(&label(name)) {
        let visible = win.is_visible().map_err(|e| e.to_string())?;
        if visible {
            win.hide().map_err(|e| e.to_string())?;
            on_hidden(app, name, &win);
        } else {
            quiet(app, name, 1000);
            // Woken before it is shown, so the first frame on screen is the
            // panel rather than a blank sheet; on_shown's resume is then a no-op.
            crate::webview_power::resume(&win);
            win.show().map_err(|e| e.to_string())?;
            let _ = apply_layout(app, name);
            on_shown(app, name, &win);
        }
        !visible
    } else {
        // create() runs on_shown itself: show_if_open builds windows too.
        create(app, name)?;
        true
    };
    update_prefs(app, name, |w| w.open = now_visible);
    save(app, true);
    Ok(now_visible)
}

/// The "overlays" key: hide every overlay window that is showing, or, when
/// none is, show again every one the player has open.
///
/// Hidden this way a window stays open in the player's settings, so the next
/// press, and the next start, bring it back. Main thread only, like [`toggle`].
pub fn toggle_all(app: &AppHandle) {
    let showing: Vec<&str> = overlay_windows()
        .filter(|n| app.get_webview_window(&label(n)).is_some_and(|w| w.is_visible().unwrap_or(false)))
        .collect();
    let result = if showing.is_empty() {
        overlay_windows().filter(|n| window_prefs(app, n).open).try_for_each(|n| toggle(app, n).map(|_| ()))
    } else {
        showing.iter().try_for_each(|n| {
            toggle(app, n)?;
            update_prefs(app, n, |w| w.open = true);
            Ok::<_, String>(())
        })
    };
    save(app, true);
    if let Err(e) = result {
        log::error!("overlays toggle failed: {e}");
    }
}

/// Whether an overlay window is on screen now.
pub fn is_showing(app: &AppHandle, name: &str) -> bool {
    app.get_webview_window(&label(name)).is_some_and(|w| w.is_visible().unwrap_or(false))
}

/// Show (never hide) — for actions that need the window up, like a scan.
/// Main thread only, like [`toggle`].
pub fn show(app: &AppHandle, name: &str) -> Result<(), String> {
    match app.get_webview_window(&label(name)) {
        Some(win) if win.is_visible().map_err(|e| e.to_string())? => Ok(()),
        Some(_) | None => toggle(app, name).map(|_| ()),
    }
}

/// Toggle from a command/async thread: hop to the main thread and wait.
pub async fn toggle_from_anywhere(app: AppHandle, name: String) -> Result<bool, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(toggle(&app2, &name));
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|_| "toggle did not complete".to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

/// Flush prefs to disk — positions are kept in memory during drags and
/// written here on exit so the last drop always sticks.
pub fn save_now(app: &AppHandle) {
    save(app, true);
}

pub fn show_if_open(app: &AppHandle, name: &str) {
    if window_prefs(app, name).open && app.get_webview_window(&label(name)).is_none() {
        let _ = create(app, name);
    }
}

fn create(app: &AppHandle, name: &str) -> Result<(), String> {
    let prefs = window_prefs(app, name);
    quiet(app, name, 1500);
    // A new page asks for the state it shows when it mounts, so nothing missed
    // by an earlier window needs replaying into it.
    let instance = {
        let state = app.state::<OverlayState>();
        let mut presence = state.presence.lock_or_recover();
        let p = presence.entry(name.to_string()).or_default();
        p.missed.clear();
        p.instance += 1;
        p.instance
    };
    // The name travels as a global set before any page script runs; the
    // query string is kept for `vite dev`, where it is the only channel.
    let url = WebviewUrl::App(format!("index.html?window={name}").into());
    // EXPERIMENT E2: see `webview2_args`.
    let win = crate::webview2_args::apply(WebviewWindowBuilder::new(app, label(name), url))
        .initialization_script(format!(
            "window.__STARBUDDY_WINDOW__ = {}; window.__STARBUDDY_DEBUG_BOUNDS__ = {};",
            serde_json::json!(name),
            // STARBUDDY_DEBUG_BOUNDS=1 outlines the whole window, painted or
            // not. A window is solid to the mouse over its entire rectangle,
            // and the part it does not paint is invisible until something is
            // moved underneath it and stops taking clicks.
            std::env::var("STARBUDDY_DEBUG_BOUNDS").is_ok(),
        ))
        .title(format!("StarBuddy — {name}"))
        .focused(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .maximizable(false)
        .minimizable(false)
        // Resizable, and then pinned to a size. Built non-resizable, the
        // window's minimum and maximum are frozen at whatever it was created
        // with, later changes to them are ignored, and every resize is clamped
        // back — so the panel drew itself smaller while the window kept its
        // first rectangle and went on taking clicks over all of it. Nothing
        // draws a resize grip on it, and the pinned bounds are what stop it
        // being dragged by an edge.
        .resizable(true)
        .inner_size(prefs.width, prefs.height)
        .position(prefs.x, prefs.y)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;
    crate::webkit_tuning::tune_overlay(&win);

    // The size it was created at, pinned the way a fit pins one, so the window
    // is no more draggable by its edges than it was before.
    let created = LogicalSize::new(prefs.width, prefs.height);
    let _ = win.set_min_size(Some(created));
    let _ = win.set_max_size(Some(created));

    // KDE would otherwise stack the focused fullscreen game above us.
    crate::kde_rule::ensure(app);

    let app2 = app.clone();
    let name2 = name.to_string();
    win.on_window_event(move |event| {
        // A window destroyed and rebuilt under the same label must not have
        // the old one's late events move or forget the new one.
        if !is_instance(&app2, &name2, instance) {
            return;
        }
        match event {
            WindowEvent::Moved(pos) => on_moved(&app2, &name2, *pos),
            WindowEvent::Destroyed => forget(&app2, &name2),
            _ => {}
        }
    });
    if let Err(e) = apply_layout(app, name) {
        log::warn!("overlay {name}: initial layout skipped: {e}");
    }
    // Built visible, so this is a show like any other.
    on_shown(app, name, &win);
    Ok(())
}

// ── Visibility hooks ───────────────────────────────────────────────────────

/// Every way an overlay comes on screen ends here: toggle, show, and the
/// window being built. Main thread only, like the calls that show it.
fn on_shown(app: &AppHandle, name: &str, win: &WebviewWindow) {
    // Wake the webview on_hidden put to sleep. It has to run before the replay
    // below, or the replayed events land in a page that is not running.
    crate::webview_power::resume(win);
    let _ = app.emit("overlay-visibility", (name.to_string(), true));
    // The missed events are sent outside the lock, and the window only counts
    // as shown once none are left. An event sent meanwhile is queued behind
    // them instead of overtaking them, so the page ends on the newest state.
    loop {
        let missed = {
            let state = app.state::<OverlayState>();
            let mut presence = state.presence.lock_or_recover();
            let p = presence.entry(name.to_string()).or_default();
            if p.missed.is_empty() {
                p.shown = true;
                p.generation += 1;
                break;
            }
            std::mem::take(&mut p.missed)
        };
        for (event, payload) in missed {
            let _ = app.emit_to(win.label(), &event, payload);
        }
    }
}

/// Every way an overlay leaves the screen ends here: toggle and the panel's
/// own close button. Main thread only.
fn on_hidden(app: &AppHandle, name: &str, win: &WebviewWindow) {
    let generation = {
        let state = app.state::<OverlayState>();
        let mut presence = state.presence.lock_or_recover();
        let p = presence.entry(name.to_string()).or_default();
        p.shown = false;
        p.generation += 1;
        p.generation
    };
    let _ = app.emit("overlay-visibility", (name.to_string(), false));
    log::debug!("overlay {}: hidden", win.label());
    // After the broadcast above, so this page hears that it is hidden before it
    // sleeps. on_shown wakes it.
    crate::webview_power::suspend(win);
    destroy_when_idle(app, name, generation);
}

/// Destroy the window if it is still hidden, unshown since, after
/// [`IDLE_DESTROY_AFTER`]. The wait is a timer on the async runtime, not a
/// sleeping thread. The scan window is spared while the live scan runs: the
/// player started it and its results go to that window. The timer is then set
/// again for the same hide, so the first check after the scan stops closes it.
fn destroy_when_idle(app: &AppHandle, name: &str, generation: u64) {
    let app = app.clone();
    let name = name.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(IDLE_DESTROY_AFTER).await;
        let app2 = app.clone();
        // Windows are destroyed on the main thread, where every show and hide
        // also runs, so nothing can show it between the check and the destroy.
        let _ = app.run_on_main_thread(move || {
            let idle = app2
                .state::<OverlayState>()
                .presence
                .lock_or_recover()
                .get(&name)
                .is_some_and(|p| !p.shown && p.generation == generation);
            if !idle {
                return;
            }
            let Some(win) = app2.get_webview_window(&label(&name)) else { return };
            if win.is_visible().unwrap_or(true) {
                return;
            }
            if name == crate::scan::SCAN && crate::scan::live_running(&app2) {
                destroy_when_idle(&app2, &name, generation);
                return;
            }
            log::info!("overlay {name}: hidden for {} s, closing its webview", IDLE_DESTROY_AFTER.as_secs());
            // The next toggle or show finds no window and builds a new one;
            // prefs keep `open` false, as the hide left it. On Linux the web
            // process ends with it only through `webkit_tuning`'s destroy hook.
            if let Err(e) = win.destroy() {
                log::warn!("overlay {name}: could not destroy the idle window: {e}");
            }
        });
    });
}

/// Whether `instance` is still the live build of this overlay's window.
fn is_instance(app: &AppHandle, name: &str, instance: u64) -> bool {
    app.state::<OverlayState>().presence.lock_or_recover().get(name).is_some_and(|p| p.instance == instance)
}

/// The window is gone: drop what was kept for it, and stand down any timer.
fn forget(app: &AppHandle, name: &str) {
    let was_shown = {
        let state = app.state::<OverlayState>();
        let mut presence = state.presence.lock_or_recover();
        let p = presence.entry(name.to_string()).or_default();
        p.missed.clear();
        p.generation += 1;
        std::mem::replace(&mut p.shown, false)
    };
    app.state::<OverlayState>().quiet_until.lock_or_recover().remove(name);
    // Only an outside close gets here while shown; say so, as a hide would.
    if was_shown {
        let _ = app.emit("overlay-visibility", (name.to_string(), false));
    }
}

/// Send an event meant only for one overlay's page.
///
/// Delivered while that window exists and is on screen. While it is hidden
/// the latest payload of each event is kept and replayed by [`on_shown`];
/// while it does not exist the event is dropped, since a new page asks for
/// its state when it mounts. Use it only for events no other window listens
/// to: Tauri hands an event aimed at one label to every page that listens
/// to it globally, so it is the skipping while hidden that saves the work,
/// not the label.
pub fn emit_to_overlay<S: Serialize + Clone>(app: &AppHandle, name: &str, event: &str, payload: S) {
    let label = label(name);
    if app.get_webview_window(&label).is_none() {
        return;
    }
    if let Some(state) = app.try_state::<OverlayState>() {
        let mut presence = state.presence.lock_or_recover();
        let p = presence.entry(name.to_string()).or_default();
        if !p.shown {
            if let Ok(value) = serde_json::to_value(&payload) {
                p.missed.retain(|(e, _)| e != event);
                p.missed.push((event.to_string(), value));
            }
            return;
        }
    }
    let _ = app.emit_to(label.as_str(), event, payload);
}

/// Floating windows remember where they were dropped; edge-docked windows
/// keep only the along-edge coordinate (y for left/right, x for top/bottom)
/// and snap back to their edge.
fn on_moved(app: &AppHandle, name: &str, pos: PhysicalPosition<i32>) {
    if is_quiet(app, name) {
        return;
    }
    let Some(win) = app.get_webview_window(&label(name)) else { return };
    if !win.is_visible().unwrap_or(false) {
        return;
    }
    let scale = win.scale_factor().unwrap_or(1.0);
    let logical: LogicalPosition<f64> = pos.to_logical(scale);
    let mode = window_prefs(app, name).mode;
    match mode.as_str() {
        "floating" => {
            update_prefs(app, name, |w| {
                w.x = logical.x;
                w.y = logical.y;
            });
            save(app, false);
        }
        "dock-left" | "dock-right" => {
            update_prefs(app, name, |w| w.y = logical.y);
            let _ = apply_layout(app, name);
            save(app, false);
        }
        "dock-top" | "dock-bottom" => {
            update_prefs(app, name, |w| w.dock_x = Some(logical.x));
            let _ = apply_layout(app, name);
            save(app, false);
        }
        _ => {}
    }
}

/// Put the window where its mode says, on the monitor it is currently on.
pub fn apply_layout(app: &AppHandle, name: &str) -> Result<(), String> {
    let win = app.get_webview_window(&label(name)).ok_or("window not open")?;
    let monitor = win
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| win.primary_monitor().ok().flatten())
        .ok_or("no monitor")?;
    let scale = monitor.scale_factor();
    let m_pos: LogicalPosition<f64> = monitor.position().to_logical(scale);
    let m_size: LogicalSize<f64> = monitor.size().to_logical(scale);
    let size: LogicalSize<f64> = win.outer_size().map_err(|e| e.to_string())?.to_logical(scale);
    let prefs = window_prefs(app, name);

    let clamp_y = |y: f64| y.max(m_pos.y).min(m_pos.y + m_size.height - size.height);
    let clamp_x = |x: f64| x.max(m_pos.x).min(m_pos.x + m_size.width - size.width);
    let strip_x = prefs.dock_x.map(clamp_x).unwrap_or_else(|| m_pos.x + ((m_size.width - size.width) / 2.0).round());

    let target = match prefs.mode.as_str() {
        "dock-left" => LogicalPosition::new(m_pos.x, clamp_y(prefs.y)),
        "dock-right" => LogicalPosition::new(m_pos.x + m_size.width - size.width, clamp_y(prefs.y)),
        "dock-top" => LogicalPosition::new(strip_x, m_pos.y),
        "dock-bottom" => LogicalPosition::new(strip_x, m_pos.y + m_size.height - size.height),
        _ => LogicalPosition::new(clamp_x(prefs.x), clamp_y(prefs.y)),
    };

    let current: LogicalPosition<f64> = win.outer_position().map_err(|e| e.to_string())?.to_logical(scale);
    if (current.x - target.x).abs() > 0.5 || (current.y - target.y).abs() > 0.5 {
        quiet(app, name, 300);
        win.set_position(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn overlay_toggle(app: AppHandle, name: String) -> Result<bool, String> {
    toggle_from_anywhere(app, name).await
}

/// Show without toggling (main-thread hop like overlay_toggle).
#[tauri::command]
pub async fn overlay_show(app: AppHandle, name: String) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(show(&app2, &name));
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|_| "show did not complete".to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn overlay_prefs(app: AppHandle, name: String) -> WindowPrefs {
    window_prefs(&app, &name)
}

#[derive(Deserialize)]
pub struct WindowPatch {
    pub mode: Option<String>,
    pub size: Option<String>,
    pub opacity: Option<f64>,
}

const MODES: [&str; 5] = ["floating", "dock-left", "dock-top", "dock-right", "dock-bottom"];

#[tauri::command]
pub fn overlay_update(app: AppHandle, name: String, patch: WindowPatch) -> Result<WindowPrefs, String> {
    if let Some(m) = &patch.mode {
        if !MODES.contains(&m.as_str()) {
            return Err(format!("unknown mode {m}"));
        }
    }
    let prefs = update_prefs(&app, &name, |w| {
        if let Some(m) = patch.mode {
            w.mode = m;
        }
        if let Some(s) = patch.size {
            w.size = if s == "minimal" { "minimal".into() } else { "full".into() };
        }
        if let Some(o) = patch.opacity {
            w.opacity = o.clamp(0.25, 1.0);
        }
    });
    let _ = apply_layout(&app, &name);
    save(&app, true);
    Ok(prefs)
}

/// The webview reports its content size; the window wraps it exactly and
/// is re-laid-out so docked windows stay flush with their edge.
#[tauri::command]
pub fn overlay_fit(app: AppHandle, window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    let name = name_of(window.label()).ok_or("not an overlay window")?.to_string();
    let width = width.max(120.0).round();
    let height = height.max(32.0).round();
    // Both bounds move to the new size, and then the window is asked for it.
    // The bounds are what actually decide it: a resize is a request the
    // compositor answers in its own time, and a window whose minimum and
    // maximum say one size cannot settle at another. It is also what keeps
    // the window from being dragged by an edge, now that it is resizable —
    // which it has to be, or the bounds are ignored and the window keeps the
    // rectangle it was created with while the panel draws itself smaller.
    let target = LogicalSize::new(width, height);
    let _ = window.set_min_size(Some(target));
    let _ = window.set_max_size(Some(target));
    window.set_size(target).map_err(|e| e.to_string())?;
    // What the window actually became, beside what the panel asked for. A
    // window is solid to the mouse over its whole rectangle, painted or not,
    // so any surplus here is a strip of screen where clicks stop reaching the
    // game — which is invisible until someone tries to click through it.
    if let (Ok(scale), Ok(outer)) = (window.scale_factor(), window.outer_size()) {
        let outer: LogicalSize<f64> = outer.to_logical(scale);
        if (outer.width - width).abs() > 1.0 || (outer.height - height).abs() > 1.0 {
            log::debug!(
                "overlay {name}: panel asked for {width}×{height}, window is {}×{} (scale {scale})",
                outer.width,
                outer.height,
            );
        }
    }
    update_prefs(&app, &name, |w| {
        w.width = width;
        w.height = height;
    });
    apply_layout(&app, &name)?;
    save(&app, false);
    Ok(())
}

/// Title-bar drag. Docked windows are snapped back to their edge after
/// the drop (see on_moved), so only the along-edge coordinate sticks.
#[tauri::command]
pub fn overlay_start_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    name_of(window.label()).ok_or("not an overlay window")?;
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn overlay_close(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    let name = name_of(window.label()).ok_or("not an overlay window")?.to_string();
    window.hide().map_err(|e| e.to_string())?;
    update_prefs(&app, &name, |w| w.open = false);
    save(&app, true);
    on_hidden(&app, &name, &window);
    Ok(())
}

#[derive(Serialize)]
pub struct HotkeyInfo {
    /// action → shortcut, e.g. {"status": "F6"}. Actions without a key are
    /// left out.
    pub hotkeys: HashMap<String, String>,
    /// Every action, with a key or not, in the order they are listed.
    pub actions: Vec<String>,
    /// False on Wayland sessions, where X11-style global grabs do not reach
    /// the compositor; the CLI toggle is the way there.
    pub global_supported: bool,
    pub toggle_command: String,
    /// The same for any action: this with the action's name after it. What a
    /// desktop that will not bind the portal's shortcuts can be given instead.
    pub action_command: String,
    /// action → why that shortcut is not currently registered.
    pub failed: HashMap<String, String>,
    /// The actions whose shortcut is registered and waiting for a key.
    pub live: Vec<String>,
    /// True where the desktop has taken the shortcuts but put no key on any of
    /// them, which is where they have to be assigned in its own settings.
    pub desktop_offered: bool,
    /// True where the desktop itself delivers the hotkeys (the portal's global
    /// shortcuts). The keys are then the desktop's to change, and what the
    /// client stores is only what it asked for.
    pub desktop_owned: bool,
    /// action → the trigger the desktop bound, when it is the one delivering.
    pub triggers: HashMap<String, String>,
    /// Windows has two ways for a hotkey to do nothing that no error reports:
    /// another program holding the combination, and a game running as
    /// administrator, which Windows will not let a normal program's hotkeys
    /// reach. The window says so there rather than leaving it a mystery.
    pub windows: bool,
}

fn on_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").map(|v| v == "wayland").unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[tauri::command]
pub fn overlay_hotkey(app: AppHandle) -> HotkeyInfo {
    let hotkeys = app.state::<OverlayState>().prefs.lock_or_recover().all_hotkeys().into_iter().collect();
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "starbuddy".into());
    HotkeyInfo {
        hotkeys,
        actions: DEFAULT_HOTKEYS.iter().map(|(a, _)| a.to_string()).collect(),
        global_supported: crate::shortcuts::in_charge()
            || !(cfg!(target_os = "linux") && on_wayland() && std::env::var("GDK_BACKEND").as_deref() != Ok("x11")),
        desktop_offered: crate::shortcuts::registered(),
        desktop_owned: crate::shortcuts::in_charge(),
        triggers: crate::shortcuts::triggers(),
        toggle_command: format!("\"{exe}\" {TOGGLE_FLAG}"),
        action_command: format!("\"{exe}\" {ACTION_FLAG} "),
        failed: app.state::<OverlayState>().failures.lock_or_recover().clone(),
        live: app.state::<OverlayState>().registered.lock_or_recover().iter().map(|(_, a)| a.clone()).collect(),
        windows: cfg!(windows),
    }
}

#[tauri::command]
pub fn overlay_set_hotkey(app: AppHandle, action: String, hotkey: String) -> Result<HotkeyInfo, String> {
    if !DEFAULT_HOTKEYS.iter().any(|(a, _)| *a == action) {
        return Err(format!("unknown action {action}"));
    }
    // The desktop has the last word on a key it put on an action, and does
    // not take requests: KDE ignores the key asked for. Changed there or not
    // at all, so say where.
    if let Some(key) = crate::shortcuts::desktop_key(&action) {
        return Err(format!(
            "{key} is set in your desktop's keyboard shortcut settings (StarBuddy). Change or remove it there."
        ));
    }
    let hotkey = hotkey.trim().to_string();
    // An empty key takes the action's key away. Stored as "" rather than
    // removed, so an action with a default does not fall back to it.
    if hotkey.is_empty() {
        app.state::<OverlayState>().prefs.lock_or_recover().hotkeys.insert(action, String::new());
        let _ = register_hotkeys(&app);
        save(&app, true);
        return Ok(overlay_hotkey(app));
    }
    let wanted = hotkey.parse::<Shortcut>().map_err(|e| format!("Not a valid shortcut: {e}"))?;
    if let Some(other) = desktop_holds(&hotkey) {
        return Err(format!("{hotkey} is the {other} shortcut in your desktop's keyboard shortcut settings."));
    }

    // One shortcut cannot serve two actions: the second registration fails as
    // already taken, which reads as the key doing nothing. Refusing it here
    // says which action already has it, instead of leaving the player to work
    // that out from a key that stopped responding.
    let clash = {
        let state = app.state::<OverlayState>();
        let prefs = state.prefs.lock_or_recover();
        prefs
            .all_hotkeys()
            .into_iter()
            // The capture key is not grabbed for a player who is not a tester,
            // so it is free for them to use elsewhere.
            .filter(|(other, _)| other != "capture" || crate::tester::is_tester())
            .find(|(other, key)| *other != action && key.parse::<Shortcut>().is_ok_and(|s| s == wanted))
            .map(|(other, _)| other)
    };
    if let Some(other) = clash {
        return Err(format!("{hotkey} is already the {other} shortcut."));
    }

    let previous = app.state::<OverlayState>().prefs.lock_or_recover().hotkeys.insert(action.clone(), hotkey.clone());
    // Only this action's own failure is a reason to refuse the change. Another
    // action's shortcut may be unavailable for good — a key some other program
    // owns — and that must not make every later rebind fail with it.
    let mine = register_hotkeys(&app)
        .err()
        .and_then(|_| app.state::<OverlayState>().failures.lock_or_recover().get(&action).cloned());
    if let Some(e) = mine {
        // Roll back so a shortcut another app owns never sticks.
        {
            let state = app.state::<OverlayState>();
            let mut prefs = state.prefs.lock_or_recover();
            match previous {
                Some(old) => prefs.hotkeys.insert(action, old),
                None => prefs.hotkeys.remove(&action),
            };
        }
        let _ = register_hotkeys(&app);
        return Err(format!("Could not register {hotkey}: {e}"));
    }
    save(&app, true);
    Ok(overlay_hotkey(app))
}

/// Every action and its key, if it has one: what the desktop's shortcut
/// settings are offered, so a key can be given there to an action that has
/// none yet.
pub fn all_actions(app: &AppHandle) -> Vec<(String, Option<String>)> {
    let state = app.state::<OverlayState>();
    let prefs = state.prefs.lock_or_recover();
    DEFAULT_HOTKEYS
        .iter()
        .map(|(a, _)| (a.to_string(), prefs.hotkey_for(a).filter(|k| !k.is_empty())))
        .collect()
}

/// What an action does, in words.
///
/// The desktop shows this beside the key in its own shortcut settings, where
/// "refinery" on its own would tell nobody anything.
pub fn describe_action(action: &str) -> &'static str {
    match action {
        "main" => "Show or hide StarBuddy over the game",
        "status" => "Show or hide the server status window",
        "scan" => "Start or stop reading mining scans",
        "refinery" => "Read the refinery order on screen",
        "capture" => "Send a screenshot for training",
        "reading" => "Switch screen reading on or off",
        "overlays" => "Hide or show all open overlay windows",
        "overlay-scan" => "Open or close the scan window",
        "overlay-refinery" => "Open or close the refinery order window",
        "overlay-pools" => "Open or close the blueprint pools window",
        "overlay-gathering" => "Open or close the gathering window",
        "overlay-orders" => "Open or close the refinery orders window",
        "overlay-points" => "Open or close the points window",
        _ => "StarBuddy",
    }
}

/// Every key back to its default: the ones StarBuddy grabs itself. Keys the
/// player gave actions in the desktop's settings stay; only the desktop can
/// take those away.
#[tauri::command]
pub fn overlay_reset_hotkeys(app: AppHandle) -> HotkeyInfo {
    app.state::<OverlayState>().prefs.lock_or_recover().hotkeys.clear();
    if let Err(e) = register_hotkeys(&app) {
        log::warn!("hotkeys after a reset: {e}");
    }
    save(&app, true);
    log::info!("hotkeys reset to their defaults");
    overlay_hotkey(app)
}

/// The action the desktop has bound `key` to, if it has.
///
/// KDE names keys its own way ("F9", "Meta+Shift+R"); both sides are parsed
/// where they can be, and compared as text, ignoring case, where they cannot.
fn desktop_holds(key: &str) -> Option<String> {
    let mine = key.parse::<Shortcut>().ok();
    crate::shortcuts::triggers().into_iter().find_map(|(action, trigger)| {
        if trigger.is_empty() {
            return None;
        }
        let same = match (mine, trigger.parse::<Shortcut>().ok()) {
            (Some(a), Some(b)) => a == b,
            _ => trigger.eq_ignore_ascii_case(key),
        };
        same.then_some(action)
    })
}

/// (Re)register every action's shortcut. Errors are returned so the
/// caller can decide; at startup they are only logged — another app may
/// own the combination.
pub fn register_hotkeys(app: &AppHandle) -> Result<(), String> {
    // Not the actions the desktop delivers, nor any key it holds: a key held
    // both ways fires twice, or fires two actions, whenever StarBuddy has focus.
    let state = app.state::<OverlayState>();
    let mut failures = HashMap::new();
    let wanted: Vec<(String, String)> = state
        .prefs
        .lock_or_recover()
        .all_hotkeys()
        .into_iter()
        // Training captures are for testers only. For anyone else the key is
        // not grabbed at all, so it stays free for the game and everything else.
        .filter(|(action, _)| action != "capture" || crate::tester::is_tester())
        .filter(|(action, _)| crate::shortcuts::desktop_key(action).is_none())
        .filter(|(action, key)| match desktop_holds(key) {
            // Said on the row, or the key just looks dead.
            Some(other) => {
                failures.insert(action.clone(), format!("{key} is given to {other} in the desktop's shortcut settings"));
                false
            }
            None => true,
        })
        .collect();
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let mut registered = Vec::new();
    let mut first_err = None;
    let names: Vec<String> = wanted.iter().map(|(a, k)| format!("{a}={k}")).collect();
    for (action, key) in wanted.clone() {
        let outcome = key
            .parse::<Shortcut>()
            .map_err(|e| e.to_string())
            .and_then(|shortcut| gs.register(shortcut).map(|()| shortcut).map_err(|e| e.to_string()));
        match outcome {
            Ok(shortcut) => registered.push((shortcut, action)),
            Err(e) => {
                first_err.get_or_insert(format!("{key}: {e}"));
                failures.insert(action, format!("{key}: {e}"));
            }
        }
    }
    crate::winkeys::set_bindings(&wanted);
    log::info!("hotkeys wanted: {}; registered {}, refused {}", names.join(" "), registered.len(), failures.len());
    for (action, why) in &failures {
        log::warn!("hotkey {action} refused: {why}");
    }
    *state.registered.lock_or_recover() = registered;
    *state.failures.lock_or_recover() = failures;
    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// Handler for the global-shortcut plugin: dispatch by action.
pub fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, state: ShortcutState) {
    if state != ShortcutState::Pressed {
        return;
    }
    let action = app
        .state::<OverlayState>()
        .registered
        .lock_or_recover()
        .iter()
        .find(|(s, _)| s == shortcut)
        .map(|(_, a)| a.clone());
    match action {
        Some(action) => run_action(app, &action),
        None => log::warn!("shortcut fired with no action bound to it"),
    }
}

/// The last hotkey to arrive, and when — the fact a report about hotkeys
/// turns on, and what stops one press being acted on twice.
fn last_heard() -> &'static Mutex<Option<(String, Instant)>> {
    static LAST: OnceLock<Mutex<Option<(String, Instant)>>> = OnceLock::new();
    LAST.get_or_init(|| Mutex::new(None))
}

/// The last hotkey the client heard, and how long ago.
pub fn heard() -> Option<(String, Duration)> {
    last_heard().lock().ok()?.as_ref().map(|(action, at)| (action.clone(), at.elapsed()))
}

/// Do what a hotkey asks, wherever the key came from.
///
/// The plugin's X11 grab and the desktop portal both end up here, and both
/// call from a thread of their own.
pub fn run_action(app: &AppHandle, action: &str) {
    // Two roads carry a key here on Windows — the system's hotkey table and
    // the keyboard watcher — and on a machine where both work, both arrive.
    // One press is one action.
    {
        let mut last = last_heard().lock_or_recover();
        if let Some((was, when)) = last.as_ref() {
            if was == action && when.elapsed() < Duration::from_millis(300) {
                return;
            }
        }
        *last = Some((action.to_string(), Instant::now()));
    }
    // Logged for the reports that say a key does nothing: this line is the
    // difference between a hotkey that never reached the client and one that
    // reached it and then failed at something else.
    log::info!("hotkey: {action}");
    // Said out loud so the window can show that a key arrived at all. "The
    // hotkey does nothing" is two different faults — a key that never reaches
    // the client, and one that reaches it and fails at what it asks for — and
    // nothing else on screen tells them apart.
    let _ = app.emit("hotkey-fired", action);
    let app2 = app.clone();
    let action = action.to_string();
    // The plugin calls this from its own listener thread, and anything that
    // may build or show a window has to be on the main thread — on Linux the
    // toolkit is not thread-safe, so a hotkey that opens a window silently
    // does nothing from here. A hotkey whose window already exists appears to
    // work, which is what made this look like two broken keys rather than one
    // broken thread.
    let dispatch = move || match action.as_str() {
        "main" => crate::main_window::toggle(&app2),
        "status" => {
            if let Err(e) = toggle(&app2, STATUS) {
                log::error!("overlay toggle failed: {e}");
            }
        }
        "scan" => crate::scan::trigger(&app2),
        "refinery" => crate::refinery::trigger(&app2),
        "capture" => crate::training::trigger(&app2),
        "reading" => crate::reading::trigger(&app2),
        "overlays" => toggle_all(&app2),
        other if other.starts_with("overlay-") => {
            let name = &other["overlay-".len()..];
            if let Err(e) = toggle(&app2, name) {
                log::error!("overlay toggle failed: {e}");
            }
        }
        other => log::warn!("unhandled shortcut action {other:?}"),
    };
    if let Err(e) = app.run_on_main_thread(dispatch) {
        log::error!("shortcut dispatch failed: {e}");
    }
}
