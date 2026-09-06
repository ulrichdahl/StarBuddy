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
//! * On Windows the compositor streams a window the same way, but the client
//!   draws the list of windows itself rather than handing the choice to a
//!   system dialog — so the player picks a title and the stream follows it.
//!
//! Off by default and off again when asked, because a client that watches the
//! screen from the moment it starts is not something to discover afterwards.

use crate::scan::Captured;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};

/// The newest frame the stream has delivered, and what the stream is doing.
///
/// Only ever the newest: a capture is a question about now, so nothing is
/// queued and a reader takes a copy when it wants one.
#[derive(Default)]
struct Feed {
    frame: Option<Captured>,
    live: bool,
    error: Option<String>,
}

fn feed() -> &'static Mutex<Feed> {
    static FEED: OnceLock<Mutex<Feed>> = OnceLock::new();
    FEED.get_or_init(|| Mutex::new(Feed::default()))
}

/// A frame has arrived from whichever stream this platform uses.
pub fn set_frame(frame: Captured) {
    if let Ok(mut feed) = feed().lock() {
        feed.frame = Some(frame);
        feed.live = true;
        feed.error = None;
    }
}

/// The stream stopped, or could not start.
pub fn set_stopped(error: Option<String>) {
    if let Ok(mut feed) = feed().lock() {
        feed.frame = None;
        feed.live = false;
        feed.error = error;
    }
}

/// The newest frame, if one has arrived.
pub fn frame() -> Option<Captured> {
    feed().lock().ok().and_then(|f| f.frame.clone())
}

/// Whether frames are arriving.
pub fn streaming() -> bool {
    feed().lock().map(|f| f.live).unwrap_or(false)
}

/// Why the stream is not running, when it is not.
pub fn trouble() -> Option<String> {
    feed().lock().ok().and_then(|f| f.error.clone())
}

/// The game's frame, waiting a moment for the first one after a start.
///
/// A compositor sends a frame when the window next paints, and a game paints
/// constantly — so this only ever waits at the very beginning.
pub fn game_frame() -> Result<Captured, String> {
    if let Some(frame) = frame() {
        return Ok(frame);
    }
    for _ in 0..40 {
        std::thread::sleep(std::time::Duration::from_millis(50));
        if let Some(frame) = frame() {
            return Ok(frame);
        }
    }
    Err(trouble().unwrap_or_else(|| {
        "The window is not sending anything — is the game still running, and is screen reading on?".into()
    }))
}

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
        source: streaming().then(|| "the window you chose".to_string()),
        error: trouble(),
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
    Reading {
        on: crate::wgc::on(),
        available: true,
        source: crate::load_client_prefs(app).screen_source,
        error: trouble(),
        picks_from_list: true,
    }
}

/// A window is chosen from the list this client draws, and captured by its
/// handle from then on — Windows lets a program read a window it does not own,
/// so nothing has to be streamed and nothing has to be in front.
#[cfg(windows)]
pub async fn start(app: tauri::AppHandle, window: Option<String>) -> Result<Reading, String> {
    // The window chosen now, or the one chosen last time.
    let window = window
        .or_else(|| crate::load_client_prefs(&app).screen_source)
        .ok_or("Choose the game's window first.")?;
    crate::wgc::start(&window)?;
    let mut prefs = crate::load_client_prefs(&app);
    prefs.screen_source = Some(window);
    crate::save_client_prefs(&app, &prefs)?;
    Ok(state(&app))
}

#[cfg(windows)]
pub fn stop(app: &tauri::AppHandle) -> Reading {
    // The window stays remembered; stopping is about the stream, so switching
    // back on does not ask again.
    crate::wgc::stop();
    state(app)
}

#[cfg(windows)]
pub fn windows() -> Vec<String> {
    crate::wgc::open_windows()
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

/// The hotkey: on if it is off, off if it is on.
///
/// Mid-game is exactly when this is wanted — reading is a thing the player
/// turns on for a refinery panel and off again for the rest of the flight —
/// so nothing here opens a window or waits for an answer. The desktop only
/// asks which window the first time; after that it is remembered and the
/// switch is silent.
pub fn trigger(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let reading = if state(&app).on {
            stop(&app)
        } else {
            start(app.clone(), None).await.unwrap_or_else(|e| {
                log::warn!("screen reading would not start: {e}");
                Reading { error: Some(e), ..state(&app) }
            })
        };
        let _ = tauri::Emitter::emit(&app, "screen-reading", &reading);
    });
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
