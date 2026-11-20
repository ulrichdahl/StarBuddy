//! The main window as a desktop window or as an overlay over the game.
//!
//! The player chooses. As an overlay it has no frame, stays above the game,
//! opens centred on the screen the first time and where it was left after
//! that, and the "main" hotkey (Insert by default) shows and hides it. As a
//! window it is an ordinary one. It is always a window when the game is not
//! running: there is nothing to sit over, and a frameless window above every
//! other is a nuisance on a desktop.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

use crate::lock::LockExt;
use crate::prefs::{load_client_prefs, save_client_prefs};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub(crate) enum MainMode {
    #[default]
    Window,
    Overlay,
}

/// Where the overlay was left, in physical pixels.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub(crate) struct Placement {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

/// What the window says about itself to its own page.
#[derive(Serialize, Clone, Debug)]
pub struct MainState {
    /// What the player chose.
    pub mode: MainMode,
    /// What the window is now: the choice, unless the game is not running.
    pub showing_as: MainMode,
    pub game_running: bool,
}

/// The game's process is there.
///
/// Linux runs it under Wine, where the process name is the Windows executable's
/// own. On Windows its window is looked for by title, the one thing screen
/// reading already lists.
pub(crate) fn game_running() -> bool {
    // For trying the overlay without the game: STARBUDDY_GAME_RUNNING=1.
    if std::env::var_os("STARBUDDY_GAME_RUNNING").is_some_and(|v| v == "1") {
        return true;
    }
    #[cfg(target_os = "linux")]
    {
        let Ok(dir) = std::fs::read_dir("/proc") else { return false };
        dir.flatten().any(|entry| {
            std::fs::read_to_string(entry.path().join("comm")).is_ok_and(|comm| comm.trim() == "StarCitizen.exe")
        })
    }
    #[cfg(windows)]
    {
        crate::wgc::open_windows().iter().any(|title| title.trim() == "Star Citizen")
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        false
    }
}

/// Where the window moved to last, and as which mode, kept until it is put
/// away, loses focus or StarBuddy quits.
fn moved_to() -> &'static std::sync::Mutex<Option<(MainMode, Placement)>> {
    static AT: std::sync::OnceLock<std::sync::Mutex<Option<(MainMode, Placement)>>> = std::sync::OnceLock::new();
    AT.get_or_init(|| std::sync::Mutex::new(None))
}

fn main(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn state(app: &AppHandle, showing_as: MainMode, game_running: bool) -> MainState {
    MainState { mode: load_client_prefs(app).main_mode, showing_as, game_running }
}

/// Give the window the look of a mode: frame, stacking, and for the overlay
/// its place over the game.
fn dress(app: &AppHandle, win: &WebviewWindow, as_mode: MainMode, running: bool) {
    let overlay = as_mode == MainMode::Overlay;
    let was_overlay = !win.is_decorated().unwrap_or(true);
    let _ = win.set_decorations(!overlay);
    let _ = win.set_always_on_top(overlay);
    // Back from the overlay: the window's own place, not the overlay's.
    if !overlay && was_overlay {
        if let Some(p) = load_client_prefs(app).main_window_at.filter(|p| on_a_screen(win, p)) {
            place(win, &p);
        }
    }
    if overlay {
        match load_client_prefs(app).main_overlay_at {
            Some(p) => {
                let _ = win.set_size(PhysicalSize::new(p.width, p.height));
                let _ = win.set_position(PhysicalPosition::new(p.x, p.y));
            }
            // The first time: centred on the screen it is on, three quarters
            // of it at most, and no wider than the panels inside it can use —
            // on an ultrawide, three quarters is a strip 3840 pixels long.
            None => {
                if let Ok(Some(monitor)) = win.current_monitor() {
                    let size = monitor.size();
                    let scale = monitor.scale_factor();
                    let w = (size.width * 3 / 4).min((1400.0 * scale) as u32);
                    let h = (size.height * 3 / 4).min((900.0 * scale) as u32);
                    let pos = monitor.position();
                    let _ = win.set_size(PhysicalSize::new(w, h));
                    let _ = win.set_position(PhysicalPosition::new(
                        pos.x + (size.width - w) as i32 / 2,
                        pos.y + (size.height - h) as i32 / 2,
                    ));
                }
            }
        }
    }
    let _ = app.emit("main-mode", state(app, as_mode, running));
}

/// The mode the window should take now.
fn wanted(app: &AppHandle) -> (MainMode, bool) {
    let running = game_running();
    let mode = load_client_prefs(app).main_mode;
    (if running { mode } else { MainMode::Window }, running)
}

fn place(win: &WebviewWindow, p: &Placement) {
    let _ = win.set_size(PhysicalSize::new(p.width, p.height));
    let _ = win.set_position(PhysicalPosition::new(p.x, p.y));
}

/// The place is on a screen that is still connected: a window put back where a
/// since-unplugged monitor was would open where nobody can see it.
fn on_a_screen(win: &WebviewWindow, p: &Placement) -> bool {
    win.available_monitors().is_ok_and(|monitors| {
        monitors.iter().any(|m| {
            let (pos, size) = (m.position(), m.size());
            p.x >= pos.x - 40
                && p.y >= pos.y - 40
                && p.x < pos.x + size.width as i32 - 80
                && p.y < pos.y + size.height as i32 - 80
        })
    })
}

/// Keep where the window was left, as a window or as the overlay.
pub(crate) fn remember(app: &AppHandle) {
    let Some((mode, at)) = moved_to().lock_or_recover().take() else { return };
    let mut prefs = load_client_prefs(app);
    let slot = match mode {
        MainMode::Overlay => &mut prefs.main_overlay_at,
        MainMode::Window => &mut prefs.main_window_at,
    };
    if *slot != Some(at) {
        *slot = Some(at);
        if let Err(e) = save_client_prefs(app, &prefs) {
            log::warn!("could not keep the main window's place: {e}");
        }
    }
}

/// At start: always a window then, so the player can find StarBuddy and see
/// what it is; the overlay is for when the hotkey asks for it in game.
pub(crate) fn setup(app: &AppHandle) {
    let Some(win) = main(app) else { return };
    // Where the window was when StarBuddy last closed.
    if let Some(p) = load_client_prefs(app).main_window_at.filter(|p| on_a_screen(&win, p)) {
        place(&win, &p);
    }
    let handle = app.clone();
    win.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let Some(win) = main(&handle) else { return };
            // A minimised or maximised window's place is not one to come back to.
            if win.is_minimized().unwrap_or(false) || win.is_maximized().unwrap_or(false) || !win.is_visible().unwrap_or(true) {
                return;
            }
            let mode = if win.is_decorated().unwrap_or(true) { MainMode::Window } else { MainMode::Overlay };
            if let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) {
                *moved_to().lock_or_recover() =
                    Some((mode, Placement { x: pos.x, y: pos.y, width: size.width, height: size.height }));
            }
        }
        WindowEvent::Focused(false) => remember(&handle),
        _ => {}
    });
}

/// The hotkey: show the main window in the mode it should have, or hide it
/// when it is the overlay and already in front.
pub(crate) fn toggle(app: &AppHandle) {
    let Some(win) = main(app) else { return };
    let showing_overlay = !win.is_decorated().unwrap_or(true);
    let in_front = win.is_visible().unwrap_or(false) && win.is_focused().unwrap_or(false);
    if showing_overlay && in_front {
        hide(app);
        return;
    }
    let (mode, running) = wanted(app);
    dress(app, &win, mode, running);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

/// Put the overlay away. A window is minimised instead: hiding one would leave
/// nothing on the taskbar to bring it back by.
pub(crate) fn hide(app: &AppHandle) {
    let Some(win) = main(app) else { return };
    remember(app);
    if win.is_decorated().unwrap_or(true) {
        let _ = win.minimize();
    } else {
        let _ = win.hide();
    }
}

#[tauri::command]
pub fn main_mode_get(app: AppHandle) -> MainState {
    let showing = main(&app).map(|w| w.is_decorated().unwrap_or(true)).unwrap_or(true);
    state(&app, if showing { MainMode::Window } else { MainMode::Overlay }, game_running())
}

/// Choose how the window opens over the game. Takes effect at once while the
/// game runs; otherwise the next time the hotkey asks for it in game.
#[tauri::command]
pub fn main_mode_set(app: AppHandle, mode: MainMode) -> Result<MainState, String> {
    let mut prefs = load_client_prefs(&app);
    prefs.main_mode = mode;
    save_client_prefs(&app, &prefs)?;
    let (as_mode, running) = wanted(&app);
    if let Some(win) = main(&app) {
        dress(&app, &win, as_mode, running);
    }
    Ok(state(&app, as_mode, running))
}

#[tauri::command]
pub fn main_hide(app: AppHandle) {
    hide(&app);
}

/// Quit StarBuddy. As the overlay the window has no frame to close it by, and
/// closing it only puts it away; this is the way out.
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    remember(&app);
    crate::overlay::save_now(&app);
    app.exit(0);
}
