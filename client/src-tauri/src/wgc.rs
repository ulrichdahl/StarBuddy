//! One window, streamed by Windows itself.
//!
//! The counterpart to the desktop portal on Linux, and the same idea:
//! Windows.Graphics.Capture streams a single window from the compositor, so
//! frames keep arriving while the window is behind something or not focused —
//! which reading a game's panel while an overlay has the mouse requires.
//!
//! It is switched on by the player like the portal is, and for the same
//! reason: a stream is a running thing, and the system shows it as one.

use crate::scan::Captured;
use std::sync::{Mutex, OnceLock};
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl};
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

/// The running capture, if screen reading is on.
struct Running {
    control: windows_capture::capture::CaptureControl<Reader, String>,
}

fn running() -> &'static Mutex<Option<Running>> {
    static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(None))
}

/// Receives frames and keeps the newest.
struct Reader;

impl GraphicsCaptureApiHandler for Reader {
    type Flags = ();
    type Error = String;

    fn new(_: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self)
    }

    fn on_frame_arrived(&mut self, frame: &mut Frame, _: InternalCaptureControl) -> Result<(), Self::Error> {
        let buffer = frame.buffer().map_err(|e| e.to_string())?;
        let (width, height) = (buffer.width(), buffer.height());
        // Rows come out padded to the texture's pitch; this is where they are
        // packed, into scratch we own for the length of the copy.
        let mut scratch = Vec::new();
        let pixels = buffer.as_nopadding_buffer(&mut scratch);
        // Asked for as Rgba8, so red comes first and the fourth byte is the
        // alpha the reader has no use for.
        let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
        for pixel in pixels.chunks_exact(4) {
            rgb.extend_from_slice(&[pixel[0], pixel[1], pixel[2]]);
        }
        crate::reading::set_frame(Captured {
            rgb,
            width,
            height,
            source: "window (Windows capture)".into(),
            full_height: height,
        });
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        crate::reading::set_stopped(Some("The window closed.".into()));
        Ok(())
    }
}

/// Every window worth offering, by title.
pub fn open_windows() -> Vec<String> {
    Window::enumerate()
        .map(|all| {
            all.into_iter()
                .filter(|w| w.is_valid())
                .filter_map(|w| w.title().ok())
                .filter(|title| !title.trim().is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Start streaming the window with this title.
pub fn start(title: &str) -> Result<(), String> {
    stop();
    if !GraphicsCaptureApi::is_supported().unwrap_or(false) {
        return Err("This Windows can't stream a window. Windows 10 version 1903 or newer is needed.".into());
    }
    let window = Window::from_name(title)
        .map_err(|_| format!("The window \"{title}\" is not open — is the game running?"))?;

    // Windows 10 has the capture API but not every switch on it, and asking
    // for one it lacks fails the whole capture. So ask only where it answers,
    // and take the compositor's own default elsewhere: a cursor or a border in
    // the frame is worth far more than no frames at all.
    let cursor = if GraphicsCaptureApi::is_cursor_settings_supported().unwrap_or(false) {
        CursorCaptureSettings::WithoutCursor
    } else {
        CursorCaptureSettings::Default
    };
    // A border would be captured too, and every area framed inside the window
    // would be off by its width.
    let border = if GraphicsCaptureApi::is_border_settings_supported().unwrap_or(false) {
        DrawBorderSettings::WithoutBorder
    } else {
        DrawBorderSettings::Default
    };

    let settings = Settings::new(
        window,
        cursor,
        border,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        (),
    );

    let control = Reader::start_free_threaded(settings).map_err(|e| format!("Windows refused the capture: {e}"))?;
    *running().lock().map_err(|_| "screen reading is in a bad state")? = Some(Running { control });
    Ok(())
}

/// Stop streaming. Safe to call when nothing is running.
pub fn stop() {
    let Ok(mut slot) = running().lock() else { return };
    if let Some(was) = slot.take() {
        let _ = was.control.stop();
    }
    crate::reading::set_stopped(None);
}

/// Whether a stream is set up at all, frames or not.
pub fn on() -> bool {
    running().lock().map(|r| r.is_some()).unwrap_or(false)
}
