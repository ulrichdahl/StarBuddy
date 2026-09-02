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
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// The RSI status window — the first overlay surface.
pub const STATUS: &str = "status";
/// Default per action. F6 is unbound in Star Citizen's current default
/// keyset (F1 mobiGlas, F2 starmap, F4 camera, F11 comms, F12 chat are not).
/// F8 reads the refinery panel, F9 sends the frame for training. Neither is
/// bound in Star Citizen's current default keyset, like F6 and F7.
pub const DEFAULT_HOTKEYS: [(&str, &str); 4] =
    [("status", "F6"), ("scan", "F7"), ("refinery", "F8"), ("capture", "F9")];
/// Pre-F6 default; a stored copy of it is migrated to the new default.
const LEGACY_DEFAULT_HOTKEY: &str = "Ctrl+Alt+S";
/// CLI flag a second launch (or a desktop-environment keybinding) uses to
/// toggle the status window — the hotkey path for Wayland desktops.
pub const TOGGLE_FLAG: &str = "--toggle-status";

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
}

impl OverlayState {
    pub fn load(app: &AppHandle) -> Self {
        let prefs: OverlayPrefs = prefs_path(app)
            .and_then(|p| fs::read(p).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self {
            prefs: Mutex::new(prefs.migrate()),
            registered: Mutex::new(Vec::new()),
            last_saved: Mutex::new(Instant::now() - Duration::from_secs(10)),
            quiet_until: Mutex::new(HashMap::new()),
        }
    }
}

fn quiet(app: &AppHandle, name: &str, ms: u64) {
    app.state::<OverlayState>().quiet_until.lock().unwrap().insert(name.to_string(), Instant::now() + Duration::from_millis(ms));
}

fn is_quiet(app: &AppHandle, name: &str) -> bool {
    app.state::<OverlayState>().quiet_until.lock().unwrap().get(name).is_some_and(|t| Instant::now() < *t)
}

fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("overlay.json"))
}

fn save(app: &AppHandle, force: bool) {
    let state = app.state::<OverlayState>();
    {
        let mut last = state.last_saved.lock().unwrap();
        if !force && last.elapsed() < Duration::from_millis(400) {
            return;
        }
        *last = Instant::now();
    }
    if let Some(path) = prefs_path(app) {
        let prefs = state.prefs.lock().unwrap().clone();
        if let Ok(json) = serde_json::to_vec_pretty(&prefs) {
            let _ = fs::write(path, json);
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
    app.state::<OverlayState>().prefs.lock().unwrap().windows.get(name).cloned().unwrap_or_default()
}

fn update_prefs(app: &AppHandle, name: &str, f: impl FnOnce(&mut WindowPrefs)) -> WindowPrefs {
    let state = app.state::<OverlayState>();
    let mut prefs = state.prefs.lock().unwrap();
    let w = prefs.windows.entry(name.to_string()).or_default();
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
        } else {
            quiet(app, name, 1000);
            win.show().map_err(|e| e.to_string())?;
            let _ = apply_layout(app, name);
        }
        !visible
    } else {
        create(app, name)?;
        true
    };
    update_prefs(app, name, |w| w.open = now_visible);
    save(app, true);
    let _ = app.emit("overlay-visibility", (name.to_string(), now_visible));
    Ok(now_visible)
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
    // The name travels as a global set before any page script runs; the
    // query string is kept for `vite dev`, where it is the only channel.
    let url = WebviewUrl::App(format!("index.html?window={name}").into());
    let win = WebviewWindowBuilder::new(app, label(name), url)
        .initialization_script(format!("window.__STARBUDDY_WINDOW__ = {};", serde_json::json!(name)))
        .title(format!("StarBuddy — {name}"))
        .focused(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .inner_size(prefs.width, prefs.height)
        .position(prefs.x, prefs.y)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;

    // KDE would otherwise stack the focused fullscreen game above us.
    crate::kde_rule::ensure(app);

    let app2 = app.clone();
    let name2 = name.to_string();
    win.on_window_event(move |event| {
        if let WindowEvent::Moved(pos) = event {
            on_moved(&app2, &name2, *pos);
        }
    });
    if let Err(e) = apply_layout(app, name) {
        log::warn!("overlay {name}: initial layout skipped: {e}");
    }
    Ok(())
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
    window.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
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
    let _ = app.emit("overlay-visibility", (name, false));
    Ok(())
}

#[derive(Serialize)]
pub struct HotkeyInfo {
    /// action → shortcut, e.g. {"status": "F6"}.
    pub hotkeys: HashMap<String, String>,
    /// False on Wayland sessions, where X11-style global grabs do not reach
    /// the compositor; the CLI toggle is the way there.
    pub global_supported: bool,
    pub toggle_command: String,
}

fn on_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").map(|v| v == "wayland").unwrap_or(false)
        || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

#[tauri::command]
pub fn overlay_hotkey(app: AppHandle) -> HotkeyInfo {
    let hotkeys = app.state::<OverlayState>().prefs.lock().unwrap().all_hotkeys().into_iter().collect();
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "starbuddy".into());
    HotkeyInfo {
        hotkeys,
        global_supported: !(cfg!(target_os = "linux") && on_wayland() && std::env::var("GDK_BACKEND").as_deref() != Ok("x11")),
        toggle_command: format!("\"{exe}\" {TOGGLE_FLAG}"),
    }
}

#[tauri::command]
pub fn overlay_set_hotkey(app: AppHandle, action: String, hotkey: String) -> Result<HotkeyInfo, String> {
    if !DEFAULT_HOTKEYS.iter().any(|(a, _)| *a == action) {
        return Err(format!("unknown action {action}"));
    }
    let hotkey = hotkey.trim().to_string();
    hotkey.parse::<Shortcut>().map_err(|e| format!("Not a valid shortcut: {e}"))?;
    let previous = app.state::<OverlayState>().prefs.lock().unwrap().hotkeys.insert(action.clone(), hotkey.clone());
    if let Err(e) = register_hotkeys(&app) {
        // Roll back so a shortcut another app owns never sticks.
        {
            let state = app.state::<OverlayState>();
            let mut prefs = state.prefs.lock().unwrap();
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

/// (Re)register every action's shortcut. Errors are returned so the
/// caller can decide; at startup they are only logged — another app may
/// own the combination.
pub fn register_hotkeys(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<OverlayState>();
    let wanted = state.prefs.lock().unwrap().all_hotkeys();
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let mut registered = Vec::new();
    let mut first_err = None;
    for (action, key) in wanted {
        match key.parse::<Shortcut>() {
            Ok(shortcut) => match gs.register(shortcut) {
                Ok(()) => registered.push((shortcut, action)),
                Err(e) => {
                    first_err.get_or_insert(format!("{key}: {e}"));
                }
            },
            Err(e) => {
                first_err.get_or_insert(format!("{key}: {e}"));
            }
        }
    }
    *state.registered.lock().unwrap() = registered;
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
        .lock()
        .unwrap()
        .iter()
        .find(|(s, _)| s == shortcut)
        .map(|(_, a)| a.clone());
    match action.as_deref() {
        Some("status") => {
            if let Err(e) = toggle(app, STATUS) {
                log::error!("overlay toggle failed: {e}");
            }
        }
        Some("scan") => crate::scan::trigger(app),
        Some("refinery") => crate::refinery::trigger(app),
        Some("capture") => crate::training::trigger(app),
        other => log::warn!("unhandled shortcut action {other:?}"),
    }
}
