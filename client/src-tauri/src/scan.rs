//! Scan v1 — capture the game screen, find the signature badge, read it.
//!
//! In scan mode the game shows a pinged contact's radar signature as a
//! small amber badge (pin icon + number such as "2,000" or "15,600") next
//! to the contact. Full-frame OCR misses that small text; a 3× upscaled
//! crop next to the icon reads it reliably (see screenshots/ and the
//! ocr_file example). So: find icon-sized amber blobs, OCR the strip to
//! the right of each, keep the ones that read as a number, and prefer the
//! one nearest the screen centre. The full-frame readout is kept as a
//! debug aid. Nothing leaves the machine: the OCR models are downloaded
//! once, the capture lives in memory only.

use ocrs::{ImageSource, OcrEngine, OcrEngineParams, TextItem};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Window name of the scan overlay.
pub const SCAN: &str = "scan";

const DETECTION_URL: &str = "https://ocrs-models.s3-accelerate.amazonaws.com/text-detection.rten";
const RECOGNITION_URL: &str = "https://ocrs-models.s3-accelerate.amazonaws.com/text-recognition.rten";

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct OcrLine {
    pub text: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Serialize, Clone, Debug)]
pub struct Badge {
    /// Icon position/size in capture pixels.
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    /// The number read to the right of the icon.
    pub value: f64,
    pub text: String,
    /// How closely the icon matched the pin template (0–1).
    pub shape: f32,
}

#[derive(Serialize, Clone, Debug)]
pub struct ScanResult {
    /// Unix millis of the capture.
    pub captured_at: u64,
    /// "window: <title>" or "monitor" — what was captured.
    pub source: String,
    pub width: u32,
    pub height: u32,
    pub elapsed_ms: u128,
    pub lines: Vec<OcrLine>,
    /// Every number read, in reading order (the v1 parser's raw material).
    pub numbers: Vec<f64>,
    /// Signature badges found (icon + number), nearest the centre first.
    pub badges: Vec<Badge>,
    /// The signature: value of the badge nearest the centre, else a number
    /// next to a "signature"/"RS" label in the full-frame readout.
    pub signature: Option<f64>,
    /// Best-effort: the number next to a "mass" label.
    pub mass: Option<f64>,
    /// What the signature means (reference table lookup).
    pub matches: Vec<crate::sigs::SigMatch>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ScanStatus {
    /// idle | downloading | capturing | ocr | done | error
    pub phase: String,
    pub detail: String,
    pub progress: Option<f64>,
}

/// Where the signature badge lives on screen, as fractions of the game
/// frame. From the corpus: badge centred horizontally at ~0.50, at ~0.33
/// of the height; the box leaves room for it to drift with the contact.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct ScanRegion {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Default for ScanRegion {
    fn default() -> Self {
        Self { x: 0.40, y: 0.26, w: 0.20, h: 0.14 }
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct LiveReading {
    pub at: u64,
    pub signature: Option<f64>,
    pub matches: Vec<crate::sigs::SigMatch>,
    pub badges: Vec<Badge>,
    pub region_px: (i32, i32, i32, i32),
    pub elapsed_ms: u128,
}

#[derive(Default)]
pub struct ScanState {
    engine: Mutex<Option<OcrEngine>>,
    last: Mutex<Option<ScanResult>>,
    busy: Mutex<bool>,
    /// Stop flag of the running live loop, if any.
    live: Mutex<Option<Arc<AtomicBool>>>,
}

fn status(app: &AppHandle, phase: &str, detail: impl Into<String>, progress: Option<f64>) {
    let detail = detail.into();
    if phase == "error" {
        log::error!("scan: {detail}");
    } else {
        log::debug!("scan: {phase} {detail}");
    }
    let _ = app.emit("scan-status", ScanStatus { phase: phase.into(), detail, progress });
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("ocr");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Download the two OCR models on first use (≈ 15 MB total). Written to a
/// temp name and renamed so a torn download never poses as a model.
pub(crate) async fn ensure_models(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let dir = models_dir(app)?;
    let targets = [("text-detection.rten", DETECTION_URL), ("text-recognition.rten", RECOGNITION_URL)];
    for (i, (name, url)) in targets.iter().enumerate() {
        let path = dir.join(name);
        if path.exists() {
            continue;
        }
        status(app, "downloading", format!("OCR model {}/2", i + 1), Some(i as f64 / 2.0));
        let bytes = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .map_err(|e| e.to_string())?
            .get(*url)
            .send()
            .await
            .map_err(|e| format!("model download failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("model download failed: {e}"))?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;
        let tmp = dir.join(format!("{name}.part"));
        fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    }
    Ok((dir.join("text-detection.rten"), dir.join("text-recognition.rten")))
}

pub struct Captured {
    pub rgb: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub source: String,
    /// Height of the whole game frame this came from (== height unless a
    /// region crop); scales the badge-icon size window.
    pub full_height: u32,
}

/// Windows: the game window if it is up, else the primary monitor.
#[cfg(windows)]
pub(crate) fn capture() -> Result<Captured, String> {
    let game = xcap::Window::all()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|w| {
            let title = w.title().unwrap_or_default();
            title.contains("Star Citizen") && !w.is_minimized().unwrap_or(true)
        });
    let (img, source) = match game {
        Some(w) => (w.capture_image().map_err(|e| e.to_string())?, format!("window: {}", w.title().unwrap_or_default())),
        None => {
            let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
            let m = monitors
                .iter()
                .find(|m| m.is_primary().unwrap_or(false))
                .or(monitors.first())
                .ok_or("no monitor")?;
            (m.capture_image().map_err(|e| e.to_string())?, "monitor".to_string())
        }
    };
    let (width, height) = img.dimensions();
    let rgb = img.pixels().flat_map(|p| [p[0], p[1], p[2]]).collect();
    Ok(Captured { rgb, width, height, source, full_height: height })
}

/// Linux: GetImage on the game's own X window. The client runs through
/// XWayland like the Wine game, but XWayland is rootless — the root window
/// has no pixels (GetImage on it is a BadMatch) — so the window itself is
/// read. If the game is not an X client (native Wayland Wine) or the read
/// fails, the desktop's screenshot tool grabs the *active* window.
///
/// Always the game's window, never the desktop. A scan region is fractions of
/// the frame it was chosen on, so the frame has to be the same thing every
/// time: a game running in half the screen's width had its region land on the
/// right-hand half of the panel at half the size whenever a read went to the
/// desktop instead, and a read like that comes back empty. Better to say the
/// game was not found than to read the wrong rectangle.
#[cfg(target_os = "linux")]
pub(crate) fn capture() -> Result<Captured, String> {
    match capture_x11_window() {
        Ok(c) => Ok(c),
        Err(x11_err) => capture_with_tool().map_err(|tool_err| format!("{x11_err}; {tool_err}")),
    }
}

#[cfg(target_os = "linux")]
fn capture_x11_window() -> Result<Captured, String> {
    capture_x11_rect(None)
}

/// GetImage on the game window, whole or a sub-rectangle (relative region).
#[cfg(target_os = "linux")]
fn capture_x11_rect(region: Option<ScanRegion>) -> Result<Captured, String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt, ImageFormat, Window};

    let (conn, screen_num) = x11rb::connect(None).map_err(|e| format!("X11 connect failed: {e}"))?;
    let root = conn.setup().roots[screen_num].root;
    let net_wm_name = conn.intern_atom(false, b"_NET_WM_NAME").map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?.atom;
    let utf8 = conn.intern_atom(false, b"UTF8_STRING").map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?.atom;

    fn name_of(conn: &impl Connection, win: Window, net_wm_name: u32, utf8: u32) -> String {
        for (prop, ty) in [(net_wm_name, utf8), (AtomEnum::WM_NAME.into(), AtomEnum::STRING.into())] {
            if let Ok(Ok(r)) = conn.get_property(false, win, prop, ty, 0, 256).map(|c| c.reply()) {
                if !r.value.is_empty() {
                    return String::from_utf8_lossy(&r.value).into_owned();
                }
            }
        }
        String::new()
    }

    // Breadth-first over the tree: WMs may reparent the game window once.
    let mut queue = vec![root];
    let mut depth = 0;
    let mut game: Option<(Window, String)> = None;
    while !queue.is_empty() && depth < 3 && game.is_none() {
        let mut next = Vec::new();
        for win in queue.drain(..) {
            let Ok(Ok(tree)) = conn.query_tree(win).map(|c| c.reply()) else { continue };
            for child in tree.children {
                let name = name_of(&conn, child, net_wm_name, utf8);
                if name.contains("Star Citizen") {
                    game = Some((child, name));
                    break;
                }
                next.push(child);
            }
            if game.is_some() {
                break;
            }
        }
        queue = next;
        depth += 1;
    }
    let (win, title) = game.ok_or("no Star Citizen X11 window")?;
    let geo = conn.get_geometry(win).map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?;
    let (fx, fy, fw, fh) = match region {
        Some(r) => region_px(r, geo.width as u32, geo.height as u32),
        None => (0, 0, geo.width as i32, geo.height as i32),
    };
    let (width, height) = (fw as u32, fh as u32);
    let img = conn
        .get_image(ImageFormat::Z_PIXMAP, win, fx as i16, fy as i16, fw as u16, fh as u16, !0)
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| format!("X11 GetImage on the game window failed: {e}"))?;
    let bpp = img.data.len() / (width as usize * height as usize);
    if bpp < 3 {
        return Err(format!("unexpected pixel format ({bpp} bytes/px)"));
    }
    // ZPixmap is BGRx in memory on little-endian servers.
    let rgb = img.data.chunks_exact(bpp).flat_map(|px| [px[2], px[1], px[0]]).collect();
    Ok(Captured { rgb, width, height, source: format!("window: {title}"), full_height: geo.height as u32 })
}

/// Region fractions → pixel rect inside a frame of the given size.
pub(crate) fn region_px(r: ScanRegion, width: u32, height: u32) -> (i32, i32, i32, i32) {
    let x = (r.x.clamp(0.0, 0.95) * width as f32) as i32;
    let y = (r.y.clamp(0.0, 0.95) * height as f32) as i32;
    let w = ((r.w.clamp(0.02, 1.0) * width as f32) as i32).min(width as i32 - x);
    let h = ((r.h.clamp(0.02, 1.0) * height as f32) as i32).min(height as i32 - y);
    (x, y, w.max(8), h.max(8))
}

/// Only the signature region of the game frame (the live loop's capture).
fn capture_region(region: ScanRegion) -> Result<Captured, String> {
    #[cfg(target_os = "linux")]
    {
        match capture_x11_rect(Some(region)) {
            Ok(c) => return Ok(c),
            // Native-Wayland game: whole-screen tool capture, then crop.
            Err(x11_err) => {
                let full = capture_with_tool().map_err(|tool_err| format!("{x11_err}; {tool_err}"))?;
                return crop_region(full, region);
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        crop_region(capture()?, region)
    }
}

pub(crate) fn crop_region(full: Captured, region: ScanRegion) -> Result<Captured, String> {
    let (x, y, w, h) = region_px(region, full.width, full.height);
    let img = image::RgbImage::from_raw(full.width, full.height, full.rgb).ok_or("bad frame")?;
    let crop = image::imageops::crop_imm(&img, x as u32, y as u32, w as u32, h as u32).to_image();
    Ok(Captured { rgb: crop.into_raw(), width: w as u32, height: h as u32, source: full.source, full_height: full.height })
}

/// KDE spectacle / wlroots grim / GNOME screenshot into a temp PNG.
/// This is the route for a game running as a native Wayland client (Wine's
/// Wayland driver), which has no X11 window to read. Spectacle first grabs
/// the *active window* — while playing that is the game frame itself, so
/// the region fractions apply to the real frame regardless of monitor size
/// — and falls back to the current screen when the active window cannot be
/// the game (too small: our own overlay that was just clicked, a dialog).
/// Tools run through host_command so the AppImage's library paths never
/// reach them.
#[cfg(target_os = "linux")]
fn capture_with_tool() -> Result<Captured, String> {
    let out = std::env::temp_dir().join(format!("starbuddy-scan-{}.png", std::process::id()));
    let out_s = out.to_string_lossy().into_owned();
    // The active window only. A whole-screen grab would succeed and give the
    // wrong frame, which is worse than not reading at all: the region means
    // fractions of the game's window, and the desktop is a different size.
    let attempts: [(&str, &str, Vec<String>); 1] =
        [("spectacle", "window", vec!["-b".into(), "-n".into(), "-a".into(), "-o".into(), out_s.clone()])];
    let mut tried = Vec::new();
    for (tool, what, args) in attempts {
        let _ = fs::remove_file(&out);
        let output = match crate::host_command(tool).args(&args).output() {
            Ok(o) => o,
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    log::debug!("{tool}: {e}");
                }
                tried.push(format!("{tool} (not installed)"));
                continue;
            }
        };
        if !(output.status.success() && out.exists()) {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::warn!("{tool} {what}: exited {} without an image: {}", output.status, stderr.trim());
            tried.push(format!("{tool} {what} ({})", output.status));
            continue;
        }
        let img = image::open(&out).map_err(|e| e.to_string())?.into_rgb8();
        let _ = fs::remove_file(&out);
        let (width, height) = img.dimensions();
        // Not the game: too small, or not a widescreen frame (the client's
        // own window is ~1130×858 — that is what was captured once). The
        // active window is whatever was clicked last, so this is the only
        // check standing between a read and somebody's file manager.
        if width < 1280 || height < 720 || (width as f32 / height as f32) < 1.5 {
            log::debug!("active window is {width}×{height}, which is not the game");
            tried.push(format!("{tool} window ({width}×{height})"));
            continue;
        }
        return Ok(Captured { rgb: img.into_raw(), width, height, source: format!("{what} ({tool})"), full_height: height });
    }
    Err(format!(
        "The game's window could not be found — is Star Citizen running, and was it the last window you clicked? (tried {})",
        tried.join(", ")
    ))
}

#[cfg(not(any(windows, target_os = "linux")))]
pub(crate) fn capture() -> Result<Captured, String> {
    Err("screen capture is not supported on this platform yet".into())
}

pub(crate) fn load_engine(det: &PathBuf, rec: &PathBuf) -> Result<OcrEngine, String> {
    let detection_model = rten::Model::load_file(det).map_err(|e| format!("detection model: {e}"))?;
    let recognition_model = rten::Model::load_file(rec).map_err(|e| format!("recognition model: {e}"))?;
    OcrEngine::new(OcrEngineParams {
        detection_model: Some(detection_model),
        recognition_model: Some(recognition_model),
        ..Default::default()
    })
    .map_err(|e| e.to_string())
}

pub(crate) fn run_ocr(engine: &OcrEngine, cap: &Captured) -> Result<Vec<OcrLine>, String> {
    let source = ImageSource::from_bytes(&cap.rgb, (cap.width, cap.height)).map_err(|e| e.to_string())?;
    let input = engine.prepare_input(source).map_err(|e| e.to_string())?;
    let words = engine.detect_words(&input).map_err(|e| e.to_string())?;
    let line_rects = engine.find_text_lines(&input, &words);
    let lines = engine.recognize_text(&input, &line_rects).map_err(|e| e.to_string())?;
    let mut out: Vec<OcrLine> = lines
        .into_iter()
        .flatten()
        .filter(|l| l.to_string().trim().len() > 1)
        .map(|l| {
            let r = l.bounding_rect();
            OcrLine { text: l.to_string().trim().to_string(), x: r.left(), y: r.top(), w: r.width(), h: r.height() }
        })
        .collect();
    out.sort_by_key(|l| (l.y / 12, l.x));
    Ok(out)
}

// ── Signature badge detection ───────────────────────────────────────────────

/// A HUD pixel: saturated and bright, whatever the hue. The badge is drawn
/// in the ship's HUD colour (amber on one MOLE, cyan on an F7C-M), so the
/// detector must not care about the colour — the pin shape and the number
/// next to it are what identify the badge. Space, rock and cockpit are
/// dark or grey and drop out.
fn is_hud(r: u8, g: u8, b: u8) -> bool {
    let max = r.max(g).max(b) as f32;
    let min = r.min(g).min(b) as f32;
    max >= 140.0 && (max - min) / max.max(1.0) >= 0.40
}

struct Blob {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    /// Similarity to the pin icon, 0–1 (see `pin_score`).
    shape: f32,
}

/// The badge's icon: a map pin (teardrop head with a hole, over a flat
/// ellipse base), drawn here on a 12×14 grid. Candidates are compared to
/// it so only the signature badge is read — other amber HUD marks of
/// similar size (contact markers, warnings) are not.
const PIN_TEMPLATE: [&str; 14] = [
    ".....##.....",
    "...######...",
    "..###..###..",
    "..##....##..",
    "..###..###..",
    "...######...",
    "...######...",
    "....####....",
    "....####....",
    ".....##.....",
    ".####..####.",
    "############",
    "############",
    "...######...",
];
/// Corpus (HUD mask): real pins score 0.78–0.89, every other blob of pin
/// size and aspect ≤ 0.65, a solid square 0.50.
const PIN_MIN_SCORE: f32 = 0.70;

/// 1 − mean absolute difference between the blob's amber mask, resampled
/// to the template grid by area averaging, and the template.
fn pin_score_mask(mask: &[bool], w: usize, h: usize) -> f32 {
    let (tw, th) = (PIN_TEMPLATE[0].len(), PIN_TEMPLATE.len());
    if w == 0 || h == 0 {
        return 0.0;
    }
    let mut diff = 0.0f32;
    for j in 0..th {
        let y0 = j * h / th;
        let y1 = ((j + 1) * h / th).max(y0 + 1).min(h);
        for i in 0..tw {
            let x0 = i * w / tw;
            let x1 = ((i + 1) * w / tw).max(x0 + 1).min(w);
            let mut on = 0usize;
            let mut n = 0usize;
            for y in y0..y1 {
                for x in x0..x1 {
                    on += mask[y * w + x] as usize;
                    n += 1;
                }
            }
            let cell = on as f32 / n.max(1) as f32;
            let want = if PIN_TEMPLATE[j].as_bytes()[i] == b'#' { 1.0 } else { 0.0 };
            diff += (cell - want).abs();
        }
    }
    1.0 - diff / (tw * th) as f32
}

/// Shape score of a blob's bounding box at full resolution.
fn pin_score(cap: &Captured, x: i32, y: i32, w: i32, h: i32) -> f32 {
    let (w, h) = (w as usize, h as usize);
    let mut mask = vec![false; w * h];
    for yy in 0..h {
        for xx in 0..w {
            let (px, py) = (x as usize + xx, y as usize + yy);
            if px < cap.width as usize && py < cap.height as usize {
                let i = (py * cap.width as usize + px) * 3;
                mask[yy * w + xx] = is_hud(cap.rgb[i], cap.rgb[i + 1], cap.rgb[i + 2]);
            }
        }
    }
    pin_score_mask(&mask, w, h)
}

/// Icon-sized HUD-coloured blobs shaped like the badge's pin icon, on a
/// 2× downsampled mask.
fn find_amber_icons(cap: &Captured) -> Vec<Blob> {
    let (w, h) = ((cap.width / 2) as usize, (cap.height / 2) as usize);
    let mut mask = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = ((y * 2) * cap.width as usize + x * 2) * 3;
            mask[y * w + x] = is_hud(cap.rgb[i], cap.rgb[i + 1], cap.rgb[i + 2]);
        }
    }
    let mut seen = vec![false; w * h];
    let mut blobs = Vec::new();
    let mut stack = Vec::new();
    for start in 0..w * h {
        if !mask[start] || seen[start] {
            continue;
        }
        seen[start] = true;
        stack.push(start);
        let (mut minx, mut maxx, mut miny, mut maxy, mut n) = (usize::MAX, 0usize, usize::MAX, 0usize, 0usize);
        while let Some(i) = stack.pop() {
            let (x, y) = (i % w, i / w);
            n += 1;
            minx = minx.min(x);
            maxx = maxx.max(x);
            miny = miny.min(y);
            maxy = maxy.max(y);
            for (dx, dy) in [(1i32, 0i32), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)] {
                let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                    continue;
                }
                let j = ny as usize * w + nx as usize;
                if mask[j] && !seen[j] {
                    seen[j] = true;
                    stack.push(j);
                }
            }
        }
        let (bw, bh) = ((maxx - minx + 1) * 2, (maxy - miny + 1) * 2);
        let fill = (n * 4) as f32 / (bw * bh) as f32;
        // Pin icon is ~20×22 px at 1440p; scale the window with resolution.
        let k = cap.full_height as f32 / 1440.0;
        let (lo, hi) = ((10.0 * k) as usize, (36.0 * k).ceil() as usize);
        // The pin is about as tall as it is wide (22×22, 20×24, 18×22 seen).
        let aspect = bh as f32 / bw as f32;
        if (lo..=hi).contains(&bw) && (lo..=hi).contains(&bh) && fill > 0.35 && (0.8..=1.5).contains(&aspect) {
            let (x, y, w, h) = ((minx * 2) as i32, (miny * 2) as i32, bw as i32, bh as i32);
            let shape = pin_score(cap, x, y, w, h);
            if shape >= PIN_MIN_SCORE {
                blobs.push(Blob { x, y, w, h, shape });
            } else if shape >= PIN_MIN_SCORE - 0.1 {
                log::debug!("amber blob at {x},{y} {w}×{h} rejected: pin score {shape:.2}");
            }
        }
    }
    // Nearest the centre first — the pinged contact is what the player looks at.
    let (cx, cy) = (cap.width as i32 / 2, cap.height as i32 / 2);
    blobs.sort_by_key(|b| (b.x + b.w / 2 - cx).pow(2) + (b.y + b.h / 2 - cy).pow(2));
    blobs.truncate(10);
    blobs
}

/// Crop a strip to the right of the icon and upscale it for the OCR.
fn crop_upscaled(cap: &Captured, x: i32, y: i32, w: i32, h: i32, scale: u32) -> Option<image::RgbImage> {
    let img = image::RgbImage::from_raw(cap.width, cap.height, cap.rgb.clone())?;
    let x0 = x.max(0) as u32;
    let y0 = y.max(0) as u32;
    let cw = (w as u32).min(cap.width.saturating_sub(x0));
    let ch = (h as u32).min(cap.height.saturating_sub(y0));
    if cw < 4 || ch < 4 {
        return None;
    }
    let crop = image::imageops::crop_imm(&img, x0, y0, cw, ch).to_image();
    Some(image::imageops::resize(&crop, cw * scale, ch * scale, image::imageops::FilterType::CatmullRom))
}

fn ocr_text(engine: &OcrEngine, img: &image::RgbImage) -> Result<String, String> {
    let source = ImageSource::from_bytes(img.as_raw(), img.dimensions()).map_err(|e| e.to_string())?;
    let input = engine.prepare_input(source).map_err(|e| e.to_string())?;
    let words = engine.detect_words(&input).map_err(|e| e.to_string())?;
    let lines = engine.find_text_lines(&input, &words);
    let texts = engine.recognize_text(&input, &lines).map_err(|e| e.to_string())?;
    Ok(texts.into_iter().flatten().map(|l| l.to_string()).collect::<Vec<_>>().join(" "))
}

/// "V 15,600" → 15600; "2,000" → 2000; "SCAN" → None. Signatures are
/// whole numbers of at least three digits, thousands separated by , or .
fn badge_number(text: &str) -> Option<f64> {
    let token = text
        .split_whitespace()
        .filter(|t| t.chars().any(|c| c.is_ascii_digit()))
        .max_by_key(|t| t.chars().filter(|c| c.is_ascii_digit()).count())?;
    if token.chars().any(|c| !c.is_ascii_digit() && c != ',' && c != '.') {
        return None;
    }
    // Groups: a leading 1–3 digits, then only exact thousands groups —
    // "15,600" and "2,000" pass, "11.8" and "7.4" do not.
    let mut groups = token.split([',', '.']);
    let first = groups.next()?;
    if first.is_empty() || first.len() > 3 || !groups.clone().all(|g| g.len() == 3) {
        return None;
    }
    let digits: String = token.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 3 {
        return None;
    }
    digits.parse().ok()
}

/// Find signature badges: OCR the strip right of every icon candidate.
pub fn find_badges(engine: &OcrEngine, cap: &Captured) -> Vec<Badge> {
    let k = cap.full_height as f32 / 1440.0;
    let mut out = Vec::new();
    for b in find_amber_icons(cap) {
        let Some(crop) = crop_upscaled(cap, b.x + b.w - (4.0 * k) as i32, b.y - (8.0 * k) as i32, (150.0 * k) as i32, b.h + (16.0 * k) as i32, 3) else { continue };
        let Ok(text) = ocr_text(engine, &crop) else { continue };
        if let Some(value) = badge_number(&text) {
            out.push(Badge { x: b.x, y: b.y, w: b.w, h: b.h, shape: b.shape, value, text: text.trim().to_string() });
        }
    }
    out
}

/// Whole analysis of one capture — shared by the app and the harness.
pub fn analyze(engine: &OcrEngine, cap: &Captured, started: Instant) -> Result<ScanResult, String> {
    let badges = find_badges(engine, cap);
    let lines = run_ocr(engine, cap)?;
    let numbers = lines.iter().flat_map(|l| numbers_in(&l.text)).collect();
    // Badges only: a text-label fallback once read our own overlay's
    // "Signature …" title back as a reading.
    let signature = badges.first().map(|b| b.value);
    let mass = labelled(&lines, &["MASS"]);
    Ok(ScanResult {
        captured_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
        source: cap.source.clone(),
        width: cap.width,
        height: cap.height,
        elapsed_ms: started.elapsed().as_millis(),
        lines,
        numbers,
        badges,
        signature,
        mass,
        matches: Vec::new(),
    })
}

/// Load the OCR engine from a models directory (app or harness).
pub fn engine_from_dir(dir: &std::path::Path) -> Result<OcrEngine, String> {
    load_engine(&dir.join("text-detection.rten"), &dir.join("text-recognition.rten"))
}

fn numbers_in(text: &str) -> Vec<f64> {
    // 1850 · 4,120 · 3.600 · 18.0% — thousands separators are dropped.
    let mut out = Vec::new();
    let mut cur = String::new();
    let flush = |cur: &mut String, out: &mut Vec<f64>| {
        if !cur.is_empty() {
            let cleaned = cur.replace(',', "");
            if let Ok(v) = cleaned.parse::<f64>() {
                out.push(v);
            }
            cur.clear();
        }
    };
    for ch in text.chars() {
        if ch.is_ascii_digit() || ((ch == '.' || ch == ',') && !cur.is_empty()) {
            cur.push(ch);
        } else {
            flush(&mut cur, &mut out);
        }
    }
    flush(&mut cur, &mut out);
    out
}

/// Number labelled by any of the given words: on the same line after the
/// label, else the first number on the next line.
fn labelled(lines: &[OcrLine], labels: &[&str]) -> Option<f64> {
    for (i, line) in lines.iter().enumerate() {
        let upper = line.text.to_uppercase();
        if let Some(pos) = labels.iter().filter_map(|l| upper.find(l)).min() {
            let after = &line.text[pos..];
            if let Some(n) = numbers_in(after).into_iter().next() {
                return Some(n);
            }
            if let Some(n) = lines.get(i + 1).and_then(|l| numbers_in(&l.text).into_iter().next()) {
                return Some(n);
            }
        }
    }
    None
}

/// The whole pipeline. Runs on a blocking thread; progress goes out as
/// "scan-status" events, the result as "scan-result".
pub async fn scan(app: AppHandle) -> Result<ScanResult, String> {
    {
        let state = app.state::<ScanState>();
        let mut busy = state.busy.lock().unwrap();
        if *busy {
            return Err("a scan is already running".into());
        }
        *busy = true;
    }
    crate::sigs::refresh_in_background(&app);
    let result = scan_inner(&app).await.map(|mut r| {
        r.matches = r.signature.map(|v| crate::sigs::lookup(&app, v)).unwrap_or_default();
        r
    });
    *app.state::<ScanState>().busy.lock().unwrap() = false;
    match &result {
        Ok(r) => {
            *app.state::<ScanState>().last.lock().unwrap() = Some(r.clone());
            let _ = app.emit("scan-result", r.clone());
            status(&app, "done", format!("{} lines in {} ms", r.lines.len(), r.elapsed_ms), None);
        }
        Err(e) => status(&app, "error", e.clone(), None),
    }
    result
}

async fn scan_inner(app: &AppHandle) -> Result<ScanResult, String> {
    let (det, rec) = ensure_models(app).await?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let state = app2.state::<ScanState>();
        let mut engine = state.engine.lock().unwrap();
        if engine.is_none() {
            status(&app2, "ocr", "loading OCR models", None);
            *engine = Some(load_engine(&det, &rec)?);
        }
        let engine = engine.as_ref().unwrap();

        status(&app2, "capturing", "capturing screen", None);
        let cap = capture()?;
        status(&app2, "ocr", format!("reading {}×{}", cap.width, cap.height), None);
        analyze(engine, &cap, started)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hotkey path: make sure the scan window is up, then toggle the live loop.
pub fn trigger(app: &AppHandle) {
    let _ = crate::overlay::show(app, SCAN);
    let running = live_toggle(app);
    log::info!("live scan {}", if running { "started" } else { "stopped" });
}

// ── Live loop: region capture, change detection, badge read ────────────────

/// Mean absolute difference of two equally sized frames (sampled).
fn frame_diff(a: &[u8], b: &[u8]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 255.0;
    }
    let mut sum = 0u64;
    let mut n = 0u64;
    for i in (0..a.len()).step_by(24) {
        sum += (a[i] as i16 - b[i] as i16).unsigned_abs() as u64;
        n += 1;
    }
    sum as f32 / n.max(1) as f32
}

pub fn current_region(app: &AppHandle) -> ScanRegion {
    crate::load_client_prefs(app).scan_region.unwrap_or_default()
}

/// Start or stop the live loop; returns whether it is running afterwards.
pub fn live_toggle(app: &AppHandle) -> bool {
    let state = app.state::<ScanState>();
    let mut live = state.live.lock().unwrap();
    if let Some(stop) = live.take() {
        stop.store(true, Ordering::Relaxed);
        let _ = app.emit("scan-live-state", false);
        return false;
    }
    let stop = Arc::new(AtomicBool::new(false));
    *live = Some(stop.clone());
    drop(live);
    let _ = app.emit("scan-live-state", true);
    crate::sigs::refresh_in_background(app);
    let app2 = app.clone();
    std::thread::Builder::new()
        .name("scan-live".into())
        .spawn(move || live_loop(app2, stop))
        .expect("spawn live scan thread");
    true
}

fn live_loop(app: AppHandle, stop: Arc<AtomicBool>) {
    let mut prev: Option<Vec<u8>> = None;
    let mut last_error = String::new();
    let mut idle_since = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        let region = current_region(&app);
        let cap = match capture_region(region) {
            Ok(c) => c,
            Err(e) => {
                if e != last_error {
                    log::warn!("live scan capture: {e}");
                    status(&app, "error", format!("live: {e}"), None);
                    last_error = e;
                }
                std::thread::sleep(Duration::from_millis(2000));
                continue;
            }
        };
        if !last_error.is_empty() {
            // Recovered: clear the error the window is showing, or its
            // red accent would outlive the hiccup.
            status(&app, "idle", "", None);
            last_error.clear();
        }

        // Skip OCR while the region is static (badge already read, or no HUD).
        let changed = prev.as_ref().map(|p| frame_diff(p, &cap.rgb) > 4.0).unwrap_or(true);
        prev = Some(cap.rgb.clone());
        if !changed && idle_since.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(if cap.source.contains(" (") { 400 } else { 250 }));
            continue;
        }
        idle_since = Instant::now();

        let started = Instant::now();
        let reading = {
            let state = app.state::<ScanState>();
            let mut engine = state.engine.lock().unwrap();
            if engine.is_none() {
                let dir = match models_dir(&app) {
                    Ok(d) => d,
                    Err(e) => {
                        status(&app, "error", e, None);
                        break;
                    }
                };
                match engine_from_dir(&dir) {
                    Ok(e) => *engine = Some(e),
                    Err(e) => {
                        status(&app, "error", format!("OCR models not ready ({e}) — press Scan now once to download them"), None);
                        break;
                    }
                }
            }
            let badges = find_badges(engine.as_ref().unwrap(), &cap);
            LiveReading {
                at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
                signature: badges.first().map(|b| b.value),
                matches: badges.first().map(|b| crate::sigs::lookup(&app, b.value)).unwrap_or_default(),
                badges,
                region_px: region_px(region, cap.width, cap.full_height),
                elapsed_ms: started.elapsed().as_millis(),
            }
        };
        if reading.signature.is_some() {
            log::debug!("live scan: signature {:?} in {} ms", reading.signature, reading.elapsed_ms);
        }
        let _ = app.emit("scan-live", &reading);
        // A screenshot tool costs ~0.7 s per frame on its own; a short pause
        // keeps the loop near one reading per second without spinning.
        let pause = if cap.source.contains(" (") { 300 } else { 400 };
        std::thread::sleep(Duration::from_millis(pause));
    }
    // Loop ended on its own (error) — reflect that in the state.
    let state = app.state::<ScanState>();
    let mut live = state.live.lock().unwrap();
    if live.as_ref().is_some_and(|s| Arc::ptr_eq(s, &stop)) {
        *live = None;
        let _ = app.emit("scan-live-state", false);
    }
    log::info!("live scan loop ended");
}

#[tauri::command]
pub fn scan_live_toggle(app: AppHandle) -> bool {
    live_toggle(&app)
}

#[tauri::command]
pub fn scan_live_running(app: AppHandle) -> bool {
    app.state::<ScanState>().live.lock().unwrap().is_some()
}

#[tauri::command]
pub fn scan_region_get(app: AppHandle) -> ScanRegion {
    current_region(&app)
}

#[tauri::command]
pub fn scan_region_set(app: AppHandle, region: ScanRegion) -> Result<ScanRegion, String> {
    let mut prefs = crate::load_client_prefs(&app);
    prefs.scan_region = Some(region);
    crate::save_client_prefs(&app, &prefs)?;
    log::info!("scan region set to {region:?}");
    Ok(region)
}

#[tauri::command]
pub async fn scan_now(app: AppHandle) -> Result<ScanResult, String> {
    scan(app).await
}

#[tauri::command]
pub fn scan_last(app: AppHandle) -> Option<ScanResult> {
    app.state::<ScanState>().last.lock().unwrap().clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_and_labels() {
        assert_eq!(numbers_in("MASS 4,120 kg · SIG 1850"), vec![4120.0, 1850.0]);
        assert_eq!(numbers_in("3.600 (18.0%)"), vec![3.6, 18.0]);
        let lines = vec![
            OcrLine { text: "SIGNATURE".into(), x: 0, y: 0, w: 10, h: 10 },
            OcrLine { text: "1850".into(), x: 0, y: 12, w: 10, h: 10 },
            OcrLine { text: "Mass 4,120".into(), x: 0, y: 24, w: 10, h: 10 },
        ];
        assert_eq!(labelled(&lines, &["SIGNATURE"]), Some(1850.0));
        assert_eq!(labelled(&lines, &["MASS"]), Some(4120.0));
        assert_eq!(labelled(&lines, &["RESISTANCE"]), None);
    }

    /// Real captures from screenshots/ — needs the OCR models, so it is
    /// opt-in:  cargo test --release --lib scan -- --ignored
    #[test]
    #[ignore]
    fn corpus_signatures() {
        let expected = [
            ("4.10.0-argo_mole-scanning_signature-a.jpg", 2000.0),
            ("4.10.0-argo_mole-scanning_signature-b.jpg", 15600.0),
            // Cyan HUD, whole 5120×1440 desktop with the game centred.
            ("4.10.0-anvil-f7c-m-scanning-signature.png", 10200.0),
        ];
        let models = dirs::data_dir().unwrap().join("io.github.ulrichdahl.starbuddy").join("ocr");
        let engine = engine_from_dir(&models).expect("OCR models present");
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../screenshots");
        for (file, want) in expected {
            let img = image::open(root.join(file)).unwrap().into_rgb8();
            let cap = Captured { rgb: img.as_raw().clone(), width: img.width(), height: img.height(), source: file.into(), full_height: img.height() };
            let result = analyze(&engine, &cap, Instant::now()).unwrap();
            assert_eq!(result.signature, Some(want), "{file}");
            assert_eq!(result.badges.len(), 1, "{file}: exactly one badge");
        }
    }

    #[test]
    fn pin_template_scoring() {
        // The template itself scores 1; a solid block or nothing at all
        // sits at 0.5, well under the acceptance threshold.
        let (w, h) = (PIN_TEMPLATE[0].len(), PIN_TEMPLATE.len());
        let exact: Vec<bool> = PIN_TEMPLATE.iter().flat_map(|r| r.bytes().map(|c| c == b'#')).collect();
        assert!((pin_score_mask(&exact, w, h) - 1.0).abs() < 1e-6);
        assert!((pin_score_mask(&vec![true; 20 * 20], 20, 20) - 0.5).abs() < 0.01);
        assert!(pin_score_mask(&vec![false; 20 * 20], 20, 20) < PIN_MIN_SCORE);
        // Resampling keeps the score: the template drawn at 2× still matches.
        let big: Vec<bool> = (0..h * 2).flat_map(|y| (0..w * 2).map(move |x| PIN_TEMPLATE[y / 2].as_bytes()[x / 2] == b'#')).collect();
        assert!(pin_score_mask(&big, w * 2, h * 2) > 0.99);
    }

    #[test]
    fn badge_numbers() {
        assert_eq!(badge_number("V 15,600"), Some(15600.0));
        assert_eq!(badge_number("2,000"), Some(2000.0));
        assert_eq!(badge_number("15.600"), Some(15600.0));
        assert_eq!(badge_number("SCAN"), None);
        assert_eq!(badge_number("99%"), None);
        assert_eq!(badge_number("7.4km"), None);
        assert_eq!(badge_number("11.8 C"), None);
        assert_eq!(badge_number("1,234,500"), Some(1234500.0));
        assert_eq!(badge_number("960"), Some(960.0));
        assert!(is_hud(220, 120, 30)); // amber pin
        assert!(is_hud(64, 202, 202)); // cyan pin (F7C-M HUD)
        assert!(!is_hud(200, 200, 200)); // grey
        assert!(!is_hud(40, 70, 70)); // dark cockpit teal
    }
}
