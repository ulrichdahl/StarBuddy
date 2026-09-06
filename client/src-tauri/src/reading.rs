//! Reading the game's screen: switched on by the player, off by default.
//!
//! Everything that reads a panel — the refinery order, the live scan, a
//! training capture — needs the game's window, and getting at it is not the
//! same job on every desktop:
//!
//! * On Wayland a program may not look at a window it does not own, so the
//!   desktop portal asks the player which window and streams it over PipeWire.
//!   That stream is a running thing with a cost, and the desktop shows that it
//!   is running, so it is started and stopped deliberately.
//! * On Windows a window can be captured by its handle whenever, so "on" is
//!   just a window having been chosen.
//! * On X11 the game's window is found by name, so nothing needs choosing —
//!   but the switch still exists, so that what the client is doing is the same
//!   question on every machine.
//!
//! Off by default and off again when asked, because a client that watches the
//! screen from the moment it starts is not something to discover afterwards.

use serde::Serialize;

/// What the client can see, and whether it is looking.
#[derive(Serialize, Clone, Default)]
pub struct Reading {
    /// Frames are being received, or a window is chosen and readable.
    pub on: bool,
    /// Whether this machine can read the screen at all.
    pub available: bool,
    /// What is being read, in words: a window's name, or how it was found.
    pub source: Option<String>,
    /// Why it is not reading, when it is not.
    pub error: Option<String>,
    /// Whether choosing means picking from a list this client provides
    /// (Windows) rather than the desktop's own picker (Wayland).
    pub picks_from_list: bool,
}

#[cfg(target_os = "linux")]
pub fn state(app: &tauri::AppHandle) -> Reading {
    let _ = app;
    Reading {
        on: crate::portal::on(),
        available: true,
        source: crate::portal::streaming().then(|| "the window you chose".to_string()),
        error: crate::portal::trouble(),
        picks_from_list: false,
    }
}

/// Start reading. On Linux the desktop asks which window, unless it has been
/// asked before and the answer still stands.
#[cfg(target_os = "linux")]
pub async fn start(app: tauri::AppHandle, _window: Option<String>) -> Result<Reading, String> {
    let remembered = crate::load_client_prefs(&app).screen_source;
    let token = crate::portal::start(remembered.clone()).await?;
    if token.is_some() && token != remembered {
        let mut prefs = crate::load_client_prefs(&app);
        prefs.screen_source = token;
        crate::save_client_prefs(&app, &prefs)?;
    }
    Ok(state(&app))
}

#[cfg(target_os = "linux")]
pub fn stop(app: &tauri::AppHandle) -> Reading {
    crate::portal::stop();
    state(app)
}

/// The windows worth offering. Only Windows picks from a list; elsewhere the
/// desktop does the asking.
#[cfg(target_os = "linux")]
pub fn windows() -> Vec<String> {
    Vec::new()
}

#[cfg(windows)]
pub fn state(app: &tauri::AppHandle) -> Reading {
    let chosen = crate::load_client_prefs(app).screen_source;
    Reading {
        on: chosen.is_some(),
        available: true,
        source: chosen,
        error: None,
        picks_from_list: true,
    }
}

/// A window is chosen from the list this client draws, and captured by its
/// handle from then on — Windows lets a program read a window it does not own,
/// so nothing has to be streamed and nothing has to be in front.
#[cfg(windows)]
pub async fn start(app: tauri::AppHandle, window: Option<String>) -> Result<Reading, String> {
    let window = window.ok_or("Choose the game's window first.")?;
    let mut prefs = crate::load_client_prefs(&app);
    prefs.screen_source = Some(window);
    crate::save_client_prefs(&app, &prefs)?;
    Ok(state(&app))
}

#[cfg(windows)]
pub fn stop(app: &tauri::AppHandle) -> Reading {
    let mut prefs = crate::load_client_prefs(app);
    prefs.screen_source = None;
    let _ = crate::save_client_prefs(app, &prefs);
    state(app)
}

#[cfg(windows)]
pub fn windows() -> Vec<String> {
    xcap::Window::all()
        .map(|all| {
            all.into_iter()
                .filter(|w| !w.is_minimized().unwrap_or(true))
                .filter_map(|w| w.title().ok())
                .filter(|title| !title.trim().is_empty())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn state(_app: &tauri::AppHandle) -> Reading {
    Reading::default()
}

#[cfg(not(any(target_os = "linux", windows)))]
pub async fn start(_app: tauri::AppHandle, _window: Option<String>) -> Result<Reading, String> {
    Err("Reading the screen is not supported on this platform yet.".into())
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn stop(app: &tauri::AppHandle) -> Reading {
    state(app)
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn windows() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
pub fn screen_reading(app: tauri::AppHandle) -> Reading {
    state(&app)
}

#[tauri::command]
pub fn screen_reading_windows() -> Vec<String> {
    windows()
}

#[tauri::command]
pub async fn screen_reading_start(app: tauri::AppHandle, window: Option<String>) -> Result<Reading, String> {
    let reading = start(app.clone(), window).await?;
    let _ = tauri::Emitter::emit(&app, "screen-reading", &reading);
    Ok(reading)
}

#[tauri::command]
pub fn screen_reading_stop(app: tauri::AppHandle) -> Reading {
    let reading = stop(&app);
    let _ = tauri::Emitter::emit(&app, "screen-reading", &reading);
    reading
}
