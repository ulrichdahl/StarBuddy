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
pub struct Badge {
    /// Icon position/size in capture pixels.
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    /// The number read to the right of the icon.
    pub value: f64,
    pub text: String,
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

pub struct Captured {
    pub rgb: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub source: String,
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

/// Linux: GetImage on the game's own X window. The client runs through
/// XWayland like the Wine game, but XWayland is rootless — the root window
/// has no pixels (GetImage on it is a BadMatch) — so the window itself is
/// read. If the game is not an X client (native Wayland Wine) or the read
/// fails, fall back to the desktop's screenshot tool.
#[cfg(target_os = "linux")]
fn capture() -> Result<Captured, String> {
    match capture_x11_window() {
        Ok(c) => Ok(c),
        Err(x11_err) => capture_with_tool().map_err(|tool_err| format!("{x11_err}; {tool_err}")),
    }
}

#[cfg(target_os = "linux")]
fn capture_x11_window() -> Result<Captured, String> {
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
    let (width, height) = (geo.width as u32, geo.height as u32);
    let img = conn
        .get_image(ImageFormat::Z_PIXMAP, win, 0, 0, geo.width, geo.height, !0)
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| format!("X11 GetImage on the game window failed: {e}"))?;
    let bpp = img.data.len() / (width as usize * height as usize);
    if bpp < 3 {
        return Err(format!("unexpected pixel format ({bpp} bytes/px)"));
    }
    // ZPixmap is BGRx in memory on little-endian servers.
    let rgb = img.data.chunks_exact(bpp).flat_map(|px| [px[2], px[1], px[0]]).collect();
    Ok(Captured { rgb, width, height, source: format!("window: {title}") })
}

/// KDE spectacle / wlroots grim / GNOME screenshot into a temp PNG.
#[cfg(target_os = "linux")]
fn capture_with_tool() -> Result<Captured, String> {
    let out = std::env::temp_dir().join(format!("starbuddy-scan-{}.png", std::process::id()));
    let tools: [(&str, Vec<String>); 3] = [
        ("spectacle", vec!["-b".into(), "-n".into(), "-f".into(), "-o".into(), out.to_string_lossy().into_owned()]),
        ("grim", vec![out.to_string_lossy().into_owned()]),
        ("gnome-screenshot", vec!["-f".into(), out.to_string_lossy().into_owned()]),
    ];
    let mut tried = Vec::new();
    for (tool, args) in tools {
        let ok = std::process::Command::new(tool).args(&args).status().map(|s| s.success()).unwrap_or(false);
        if ok && out.exists() {
            let img = image::open(&out).map_err(|e| e.to_string())?.into_rgb8();
            let _ = fs::remove_file(&out);
            let (width, height) = img.dimensions();
            return Ok(Captured { rgb: img.into_raw(), width, height, source: format!("monitor ({tool})") });
        }
        tried.push(tool);
    }
    Err(format!("no screenshot tool worked (tried {})", tried.join(", ")))
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

// ── Signature badge detection ───────────────────────────────────────────────

fn is_amber(r: u8, g: u8, b: u8) -> bool {
    r > 150 && (60..170).contains(&g) && b < 90 && r as i16 - g as i16 > 40
}

struct Blob {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// Icon-sized amber blobs (the badge's pin icon), on a 2× downsampled mask.
fn find_amber_icons(cap: &Captured) -> Vec<Blob> {
    let (w, h) = ((cap.width / 2) as usize, (cap.height / 2) as usize);
    let mut mask = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = ((y * 2) * cap.width as usize + x * 2) * 3;
            mask[y * w + x] = is_amber(cap.rgb[i], cap.rgb[i + 1], cap.rgb[i + 2]);
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
        let k = cap.height as f32 / 1440.0;
        let (lo, hi) = ((10.0 * k) as usize, (36.0 * k).ceil() as usize);
        if (lo..=hi).contains(&bw) && (lo..=hi).contains(&bh) && fill > 0.35 {
            blobs.push(Blob { x: (minx * 2) as i32, y: (miny * 2) as i32, w: bw as i32, h: bh as i32 });
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
    let k = cap.height as f32 / 1440.0;
    let mut out = Vec::new();
    for b in find_amber_icons(cap) {
        let Some(crop) = crop_upscaled(cap, b.x + b.w - (4.0 * k) as i32, b.y - (8.0 * k) as i32, (150.0 * k) as i32, b.h + (16.0 * k) as i32, 3) else { continue };
        let Ok(text) = ocr_text(engine, &crop) else { continue };
        if let Some(value) = badge_number(&text) {
            out.push(Badge { x: b.x, y: b.y, w: b.w, h: b.h, value, text: text.trim().to_string() });
        }
    }
    out
}

/// Whole analysis of one capture — shared by the app and the harness.
pub fn analyze(engine: &OcrEngine, cap: &Captured, started: Instant) -> Result<ScanResult, String> {
    let badges = find_badges(engine, cap);
    let lines = run_ocr(engine, cap)?;
    let numbers = lines.iter().flat_map(|l| numbers_in(&l.text)).collect();
    let signature = badges.first().map(|b| b.value).or_else(|| labelled(&lines, &["SIGNATURE", "SIGN.", " RS ", "RS:"]));
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
        analyze(engine, &cap, started)
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

    /// Real captures from screenshots/ — needs the OCR models, so it is
    /// opt-in:  cargo test --release --lib scan -- --ignored
    #[test]
    #[ignore]
    fn corpus_signatures() {
        let expected = [
            ("4.10.0-argo_mole-scanning_signature-a.jpg", 2000.0),
            ("4.10.0-argo_mole-scanning_signature-b.jpg", 15600.0),
        ];
        let models = dirs::data_dir().unwrap().join("io.github.ulrichdahl.starbuddy").join("ocr");
        let engine = engine_from_dir(&models).expect("OCR models present");
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../screenshots");
        for (file, want) in expected {
            let img = image::open(root.join(file)).unwrap().into_rgb8();
            let cap = Captured { rgb: img.as_raw().clone(), width: img.width(), height: img.height(), source: file.into() };
            let result = analyze(&engine, &cap, Instant::now()).unwrap();
            assert_eq!(result.signature, Some(want), "{file}");
            assert_eq!(result.badges.len(), 1, "{file}: exactly one badge");
        }
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
        assert!(is_amber(220, 120, 30));
        assert!(!is_amber(200, 200, 200));
    }
}
