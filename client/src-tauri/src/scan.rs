//! Scan v0 — capture the game screen, run OCR locally, show what was read.
//!
//! This is the "eyes" foundation for the signature/rock-contents window:
//! v0 proves the pipeline (capture → on-device OCR → readout in an overlay)
//! and surfaces the raw text so the real scan-screen parser can be written
//! against what the game actually renders. Nothing leaves the machine: the
//! OCR models are downloaded once, the capture lives in memory only.

use ocrs::{ImageSource, OcrEngine, OcrEngineParams, TextItem};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

/// Window name of the scan overlay.
pub const SCAN: &str = "scan";

const DETECTION_URL: &str = "https://ocrs-models.s3-accelerate.amazonaws.com/text-detection.rten";
const RECOGNITION_URL: &str = "https://ocrs-models.s3-accelerate.amazonaws.com/text-recognition.rten";

#[derive(Serialize, Clone, Debug)]
pub struct OcrLine {
    pub text: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
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
    /// Best-effort: the number next to a "signature"/"RS" label.
    pub signature: Option<f64>,
    /// Best-effort: the number next to a "mass" label.
    pub mass: Option<f64>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ScanStatus {
    /// idle | downloading | capturing | ocr | done | error
    pub phase: String,
    pub detail: String,
    pub progress: Option<f64>,
}

#[derive(Default)]
pub struct ScanState {
    engine: Mutex<Option<OcrEngine>>,
    last: Mutex<Option<ScanResult>>,
    busy: Mutex<bool>,
}

fn status(app: &AppHandle, phase: &str, detail: impl Into<String>, progress: Option<f64>) {
    let _ = app.emit("scan-status", ScanStatus { phase: phase.into(), detail: detail.into(), progress });
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("ocr");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Download the two OCR models on first use (≈ 15 MB total). Written to a
/// temp name and renamed so a torn download never poses as a model.
async fn ensure_models(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
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

struct Captured {
    rgb: Vec<u8>,
    width: u32,
    height: u32,
    source: String,
}

/// Windows: the game window if it is up, else the primary monitor.
#[cfg(windows)]
fn capture() -> Result<Captured, String> {
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
    Ok(Captured { rgb, width, height, source })
}

/// Linux: the X11 root window. The client runs through XWayland like the
/// Wine game, so the root shows exactly the game's pixels.
#[cfg(target_os = "linux")]
fn capture() -> Result<Captured, String> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{ConnectionExt, ImageFormat};

    let (conn, screen_num) = x11rb::connect(None).map_err(|e| format!("X11 connect failed: {e}"))?;
    let screen = &conn.setup().roots[screen_num];
    let (width, height) = (screen.width_in_pixels as u32, screen.height_in_pixels as u32);
    let img = conn
        .get_image(ImageFormat::Z_PIXMAP, screen.root, 0, 0, width as u16, height as u16, !0)
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| format!("X11 capture failed: {e}"))?;
    let bpp = img.data.len() / (width as usize * height as usize);
    if bpp < 3 {
        return Err(format!("unexpected pixel format ({bpp} bytes/px)"));
    }
    // ZPixmap is BGRx in memory on little-endian servers.
    let rgb = img.data.chunks_exact(bpp).flat_map(|px| [px[2], px[1], px[0]]).collect();
    Ok(Captured { rgb, width, height, source: "monitor".into() })
}

#[cfg(not(any(windows, target_os = "linux")))]
fn capture() -> Result<Captured, String> {
    Err("screen capture is not supported on this platform yet".into())
}

fn load_engine(det: &PathBuf, rec: &PathBuf) -> Result<OcrEngine, String> {
    let detection_model = rten::Model::load_file(det).map_err(|e| format!("detection model: {e}"))?;
    let recognition_model = rten::Model::load_file(rec).map_err(|e| format!("recognition model: {e}"))?;
    OcrEngine::new(OcrEngineParams {
        detection_model: Some(detection_model),
        recognition_model: Some(recognition_model),
        ..Default::default()
    })
    .map_err(|e| e.to_string())
}

fn run_ocr(engine: &OcrEngine, cap: &Captured) -> Result<Vec<OcrLine>, String> {
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
    let result = scan_inner(&app).await;
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
        let lines = run_ocr(engine, &cap)?;

        let numbers = lines.iter().flat_map(|l| numbers_in(&l.text)).collect();
        let signature = labelled(&lines, &["SIGNATURE", "SIGN.", " RS ", "RS:"]);
        let mass = labelled(&lines, &["MASS"]);
        Ok(ScanResult {
            captured_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            source: cap.source,
            width: cap.width,
            height: cap.height,
            elapsed_ms: started.elapsed().as_millis(),
            lines,
            numbers,
            signature,
            mass,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Hotkey path: make sure the scan window is up, then scan.
pub fn trigger(app: &AppHandle) {
    let _ = crate::overlay::show(app, SCAN);
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = scan(app2).await {
            eprintln!("scan failed: {e}");
        }
    });
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
}
