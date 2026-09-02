//! Framing a capture area by dragging over the live game.
//!
//! The selector is a borderless, transparent, always-on-top window covering the
//! whole screen. The player drags a rectangle over the real panel and it is
//! stored as fractions of the frame, so the same framing holds at any
//! resolution and on any monitor.
//!
//! Fractions rather than pixels also mean the area keeps working when the game
//! is captured as a window on one machine and as a monitor on another, which is
//! the difference between the X11 and the screenshot-tool capture paths.

use crate::scan::ScanRegion;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Window label of the full-screen selector.
const SELECTOR: &str = "region-selector";

/// The frame the selector is drawn on, grabbed just before it opens.
#[derive(Default)]
pub struct SelectorState {
    frame: Mutex<Option<Frame>>,
}

/// A still of the screen as a data URI, with the size it was captured at.
#[derive(Serialize, Clone)]
pub struct Frame {
    /// `data:image/jpeg;base64,…` — small enough to hand to a webview whole.
    pub image: String,
    pub width: u32,
    pub height: u32,
    pub source: String,
}

/// Grab what the selector will be drawn over.
///
/// The selector used to be a transparent hole onto the live game, which is
/// prettier but depends on the compositor keeping a fullscreen always-on-top
/// window translucent — and over a fullscreen game it can end up painted
/// black instead, which hides the very thing being framed.
///
/// A still removes the dependency, and is better in two further ways: the
/// picture cannot move while it is being framed, and it is the frame the
/// capture itself produces, so a rectangle drawn on it means exactly what it
/// looks like even when the capture is a game window rather than the monitor.
fn grab_frame() -> Result<Frame, String> {
    let cap = crate::scan::capture()?;
    let buffer = image::RgbImage::from_raw(cap.width, cap.height, cap.rgb.clone())
        .ok_or("capture did not fit its own dimensions")?;
    let mut out = std::io::Cursor::new(Vec::new());
    // JPEG, not PNG: this is a photograph of a screen that travels as text in
    // a data URI, and a lossless copy of it is several times the size for no
    // benefit to someone dragging a box on it.
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 82)
        .encode_image(&buffer)
        .map_err(|e| format!("could not encode the frame: {e}"))?;

    Ok(Frame {
        image: format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())),
        width: cap.width,
        height: cap.height,
        source: cap.source,
    })
}

/// The still the selector is drawn on. None means the grab failed, and the
/// selector falls back to being a transparent sheet over the live screen.
#[tauri::command]
pub fn region_frame(app: AppHandle) -> Option<Frame> {
    app.state::<SelectorState>().frame.lock().unwrap().clone()
}

/// What a selection is being framed for. One purpose, one stored area.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    /// The refinery order panel.
    Refinery,
    /// The mining scan signature badge (the existing scan region).
    Scan,
}

impl Purpose {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "refinery" => Ok(Self::Refinery),
            "scan" => Ok(Self::Scan),
            other => Err(format!("unknown capture area {other}")),
        }
    }
}

/// Open the selector over whatever is on screen.
///
/// Runs on the main thread: window creation is main-thread-only on Windows.
#[tauri::command]
pub async fn region_select(app: AppHandle, purpose: String) -> Result<(), String> {
    Purpose::parse(&purpose)?;
    let (tx, rx) = std::sync::mpsc::channel();
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(open_selector(&app2, &purpose));
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|_| "selector did not open".to_string())?)
        .await
        .map_err(|e| e.to_string())?
}

fn open_selector(app: &AppHandle, purpose: &str) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(SELECTOR) {
        let _ = existing.close();
    }

    // Before the window exists, or the still would be a picture of the
    // selector rather than of what it is meant to frame.
    let frame = grab_frame()
        .inspect_err(|e| log::warn!("region selector: no backdrop ({e})"))
        .ok();
    *app.state::<SelectorState>().frame.lock().unwrap() = frame;

    let url = WebviewUrl::App(format!("index.html?window=region&purpose={purpose}").into());
    let win = WebviewWindowBuilder::new(app, SELECTOR, url)
        .initialization_script(format!(
            "window.__STARBUDDY_WINDOW__ = 'region'; window.__STARBUDDY_PURPOSE__ = {};",
            serde_json::json!(purpose)
        ))
        .title("StarBuddy — pick the capture area")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .fullscreen(true)
        // The player must be able to drag on it, so unlike the read-only
        // overlays this window takes focus and mouse events.
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;

    // KDE would otherwise keep the fullscreen game stacked above us.
    crate::kde_rule::ensure(app);
    let _ = win.set_focus();
    Ok(())
}

/// The player finished dragging (or pressed Escape, which sends no area).
///
/// Coordinates arrive as fractions of the selector window, which covers the
/// same screen the capture comes from.
#[tauri::command]
pub fn region_selected(
    app: AppHandle,
    purpose: String,
    area: Option<ScanRegion>,
) -> Result<Option<ScanRegion>, String> {
    let purpose = Purpose::parse(&purpose)?;
    if let Some(win) = app.get_webview_window(SELECTOR) {
        let _ = win.close();
    }

    let Some(area) = area else {
        return Ok(current(&app, &purpose));
    };
    let area = sanity_check(area)?;

    let mut prefs = crate::load_client_prefs(&app);
    match purpose {
        Purpose::Refinery => prefs.refinery_region = Some(area),
        Purpose::Scan => prefs.scan_region = Some(area),
    }
    crate::save_client_prefs(&app, &prefs)?;
    let _ = app.emit("region-updated", serde_json::json!({ "purpose": purpose, "area": area }));
    Ok(Some(area))
}

/// The area currently framed for a purpose, if any.
#[tauri::command]
pub fn region_current(app: AppHandle, purpose: String) -> Result<Option<ScanRegion>, String> {
    Ok(current(&app, &Purpose::parse(&purpose)?))
}

/// Forget a framed area; the capture falls back to the whole frame.
#[tauri::command]
pub fn region_clear(app: AppHandle, purpose: String) -> Result<(), String> {
    let purpose = Purpose::parse(&purpose)?;
    let mut prefs = crate::load_client_prefs(&app);
    match purpose {
        Purpose::Refinery => prefs.refinery_region = None,
        Purpose::Scan => prefs.scan_region = None,
    }
    crate::save_client_prefs(&app, &prefs)
}

fn current(app: &AppHandle, purpose: &Purpose) -> Option<ScanRegion> {
    let prefs = crate::load_client_prefs(app);
    match purpose {
        Purpose::Refinery => prefs.refinery_region,
        Purpose::Scan => prefs.scan_region,
    }
}

/// Reject a selection too small to hold readable text.
///
/// A stray click registers as a rectangle a few pixels across, and silently
/// storing it would make every later capture come back empty with no clue why.
fn sanity_check(area: ScanRegion) -> Result<ScanRegion, String> {
    let clamp = |v: f32| v.clamp(0.0, 1.0);
    let area = ScanRegion {
        x: clamp(area.x.min(area.x + area.w)),
        y: clamp(area.y.min(area.y + area.h)),
        w: clamp(area.w.abs()),
        h: clamp(area.h.abs()),
    };
    if area.w < 0.02 || area.h < 0.02 {
        return Err("That area is too small to read. Drag across the whole panel.".into());
    }
    Ok(area)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_backwards_drag_is_normalised() {
        // Dragged from bottom-right to top-left.
        let area = sanity_check(ScanRegion { x: 0.8, y: 0.7, w: -0.5, h: -0.4 }).unwrap();
        assert!((area.x - 0.3).abs() < 1e-6, "x: {}", area.x);
        assert!((area.y - 0.3).abs() < 1e-6, "y: {}", area.y);
        assert!((area.w - 0.5).abs() < 1e-6);
        assert!((area.h - 0.4).abs() < 1e-6);
    }

    #[test]
    fn a_stray_click_is_refused() {
        assert!(sanity_check(ScanRegion { x: 0.5, y: 0.5, w: 0.001, h: 0.001 }).is_err());
    }

    #[test]
    fn purposes_are_closed() {
        assert!(Purpose::parse("refinery").is_ok());
        assert!(Purpose::parse("scan").is_ok());
        assert!(Purpose::parse("inventory").is_err());
    }
}
