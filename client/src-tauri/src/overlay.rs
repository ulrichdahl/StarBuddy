//! In-game overlay windows: frameless, transparent, always-on-top panels
//! that the player toggles with a hotkey. Each window keeps its own prefs
//! (placement mode, size state, opacity, position) in overlay.json.
//!
//! Placement modes: `floating` (drag anywhere), `dock-left` / `dock-right`
//! (pinned to that edge, slides up and down), `dock-top` / `dock-bottom`
//! (centred strip, not draggable). Size: `full` or `minimal`.

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
pub const DEFAULT_HOTKEY: &str = "Ctrl+Alt+S";
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
            width: 440.0,
            height: 200.0,
            open: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct OverlayPrefs {
    pub hotkey: String,
    pub windows: HashMap<String, WindowPrefs>,
}

impl Default for OverlayPrefs {
    fn default() -> Self {
        Self { hotkey: DEFAULT_HOTKEY.into(), windows: HashMap::new() }
    }
}

pub struct OverlayState {
    prefs: Mutex<OverlayPrefs>,
    last_saved: Mutex<Instant>,
}

impl OverlayState {
    pub fn load(app: &AppHandle) -> Self {
        let prefs = prefs_path(app)
            .and_then(|p| fs::read(p).ok())
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self { prefs: Mutex::new(prefs), last_saved: Mutex::new(Instant::now() - Duration::from_secs(10)) }
    }
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
/// Returns the new visibility.
pub fn toggle(app: &AppHandle, name: &str) -> Result<bool, String> {
    let now_visible = if let Some(win) = app.get_webview_window(&label(name)) {
        let visible = win.is_visible().map_err(|e| e.to_string())?;
        if visible {
            win.hide().map_err(|e| e.to_string())?;
        } else {
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
    let url = WebviewUrl::App(format!("index.html?window={name}").into());
    let win = WebviewWindowBuilder::new(app, label(name), url)
        .title(format!("StarBuddy — {name}"))
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
    apply_layout(app, name)
}

/// Floating windows remember where they were dropped; edge-docked windows
/// keep only the along-edge coordinate and snap back to their edge.
fn on_moved(app: &AppHandle, name: &str, pos: PhysicalPosition<i32>) {
    let Some(win) = app.get_webview_window(&label(name)) else { return };
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
    let centred_x = m_pos.x + ((m_size.width - size.width) / 2.0).round();

    let target = match prefs.mode.as_str() {
        "dock-left" => LogicalPosition::new(m_pos.x, clamp_y(prefs.y)),
        "dock-right" => LogicalPosition::new(m_pos.x + m_size.width - size.width, clamp_y(prefs.y)),
        "dock-top" => LogicalPosition::new(centred_x, m_pos.y),
        "dock-bottom" => LogicalPosition::new(centred_x, m_pos.y + m_size.height - size.height),
        _ => LogicalPosition::new(clamp_x(prefs.x), clamp_y(prefs.y)),
    };

    let current: LogicalPosition<f64> = win.outer_position().map_err(|e| e.to_string())?.to_logical(scale);
    if (current.x - target.x).abs() > 0.5 || (current.y - target.y).abs() > 0.5 {
        win.set_position(target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Commands ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn overlay_toggle(app: AppHandle, name: String) -> Result<bool, String> {
    toggle(&app, &name)
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

/// Title-bar drag. Top/bottom strips are fixed, so the request is ignored.
#[tauri::command]
pub fn overlay_start_drag(app: AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    let name = name_of(window.label()).ok_or("not an overlay window")?;
    let mode = window_prefs(&app, name).mode;
    if mode == "dock-top" || mode == "dock-bottom" {
        return Ok(());
    }
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
    pub hotkey: String,
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
    let hotkey = app.state::<OverlayState>().prefs.lock().unwrap().hotkey.clone();
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "starbuddy".into());
    HotkeyInfo {
        hotkey,
        global_supported: !(cfg!(target_os = "linux") && on_wayland() && std::env::var("GDK_BACKEND").as_deref() != Ok("x11")),
        toggle_command: format!("\"{exe}\" {TOGGLE_FLAG}"),
    }
}

#[tauri::command]
pub fn overlay_set_hotkey(app: AppHandle, hotkey: String) -> Result<HotkeyInfo, String> {
    let hotkey = hotkey.trim().to_string();
    let shortcut: Shortcut = hotkey.parse().map_err(|e| format!("Not a valid shortcut: {e}"))?;
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    gs.register(shortcut).map_err(|e| format!("Could not register {hotkey}: {e}"))?;
    app.state::<OverlayState>().prefs.lock().unwrap().hotkey = hotkey;
    save(&app, true);
    Ok(overlay_hotkey(app))
}

/// Register the saved hotkey at startup (errors are logged, never fatal —
/// another app may own the combination).
pub fn register_hotkey(app: &AppHandle) {
    let hotkey = app.state::<OverlayState>().prefs.lock().unwrap().hotkey.clone();
    match hotkey.parse::<Shortcut>() {
        Ok(s) => {
            if let Err(e) = app.global_shortcut().register(s) {
                eprintln!("overlay hotkey {hotkey} not registered: {e}");
            }
        }
        Err(e) => eprintln!("overlay hotkey {hotkey} invalid: {e}"),
    }
}

/// Handler for the global-shortcut plugin: any registered shortcut toggles
/// the status window (there is only ever one registered).
pub fn on_shortcut(app: &AppHandle, _shortcut: &Shortcut, state: ShortcutState) {
    if state == ShortcutState::Pressed {
        if let Err(e) = toggle(app, STATUS) {
            eprintln!("overlay toggle failed: {e}");
        }
    }
}
