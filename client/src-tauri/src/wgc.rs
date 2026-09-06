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
use windows_capture::graphics_capture_api::InternalCaptureControl;
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
        let (width, height) = (frame.width(), frame.height());
        let mut buffer = frame.buffer().map_err(|e| e.to_string())?;
        let pixels = buffer.as_raw_nopadding_buffer().map_err(|e| e.to_string())?;
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
    let window = Window::from_name(title)
        .map_err(|_| format!("The window \"{title}\" is not open — is the game running?"))?;

    let settings = Settings::new(
        window,
        CursorCaptureSettings::WithoutCursor,
        // No border drawn round the game: it would be captured too, and every
        // area framed inside the window would be off by its width.
        DrawBorderSettings::WithoutBorder,
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
