use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{Emitter, Manager};

// Notification lines are duplicated in the log (queued + displayed); events
// are deduplicated on (timestamp, detail). Names can contain quotes
// (`Arclight "Midnight" Pistol`), hence the greedy capture up to `: " [n]`.
static BLUEPRINT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^<([^>]+)>.*Added notification "Received Blueprint: (.*): " \[\d+\]"#).unwrap()
});
static REFINERY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"^<([^>]+)>.*Added notification "A Refinery Work Order has been Completed at (.*): " \[\d+\]"#,
    )
    .unwrap()
});

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Hash)]
pub struct LogEvent {
    pub kind: String, // "blueprint" | "refinery_completed"
    pub timestamp: String,
    pub detail: String, // blueprint name, or refinery station
    // Canonical item class resolved via the player's localization file
    // (e.g. POWR_TYDT_S01_SonicLite). The logged name is the *localized*
    // display string — players with custom global.ini packs log entirely
    // different names for the same blueprint, so this is the real identity.
    pub item_class: Option<String>,
    pub file: String,
}

#[derive(Serialize)]
pub struct ScanResult {
    pub live_dir: String,
    pub files_scanned: usize,
    pub localization_entries: usize,
    pub events: Vec<LogEvent>,
}

/// Normalize a display name for matching: lossy quotes/glyphs and the
/// decorative trailing icon characters some localization packs append.
fn normalize_name(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| match c {
            '\u{2018}' | '\u{2019}' => '\'',
            '\u{201C}' | '\u{201D}' => '"',
            _ => c,
        })
        .filter(|c| c.is_ascii_graphic() || *c == ' ')
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Parse the loose localization file (data/Localization/<lang>/global.ini)
/// into display-name → canonical item class. Entries look like
/// `item_NamePOWR_TYDT_S01_SonicLite=STL-1C "SonicLite"`; the key suffix is
/// the item class shared by all players.
fn load_localization(live_dir: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(langs) = fs::read_dir(live_dir.join("data/Localization")) else {
        return map;
    };

    for lang in langs.flatten() {
        let ini = lang.path().join("global.ini");
        let Ok(bytes) = fs::read(&ini) else { continue };
        let text = String::from_utf8_lossy(&bytes);

        for line in text.lines() {
            let line = line.trim_start_matches('\u{FEFF}');
            let Some((key, value)) = line.split_once('=') else { continue };
            let lower = key.to_ascii_lowercase();
            let Some(rest) = lower.strip_prefix("item_name") else { continue };
            // Some packs decorate keys with glyph suffixes after a comma
            // (`item_Name<class>,P`); the class ends at the comma.
            let class = key[key.len() - rest.len()..]
                .split(',')
                .next()
                .unwrap_or_default()
                .trim_start_matches('_')
                .trim_end_matches("_SCItem")
                .to_string();
            if class.is_empty() {
                continue;
            }
            // First writer wins; `_SCItem` duplicates collapse to one class.
            let norm = normalize_name(value);
            // Some packs glue an icon glyph to the closing quote (e.g.
            // `STL-1C "SonicLite"P`); the HUD notification drops it, so also
            // index the glyph-stripped form.
            if let Some(qpos) = norm.rfind('"') {
                let tail = &norm[qpos + 1..];
                if !tail.is_empty() && tail.len() <= 2 && tail.chars().all(|c| c.is_ascii_alphabetic()) {
                    map.entry(norm[..qpos + 1].to_string()).or_insert_with(|| class.clone());
                }
            }
            map.entry(norm).or_insert(class);
        }
    }

    map
}

/// Candidate LIVE directories on this machine, most likely first.
fn candidate_live_dirs() -> Vec<PathBuf> {
    let mut dirs_found = Vec::new();
    let suffix = "Program Files/Roberts Space Industries/StarCitizen/LIVE";

    if cfg!(windows) {
        for drive in ["C", "D", "E"] {
            dirs_found.push(PathBuf::from(format!(
                "{drive}:/Program Files/Roberts Space Industries/StarCitizen/LIVE"
            )));
        }
    }

    if let Some(home) = dirs::home_dir() {
        // Lutris/Wine defaults, including the LUG-helper layout.
        for prefix in [
            "Games/star-citizen/drive_c",
            "Games/Star Citizen/drive_c",
            ".local/share/lutris/runners/wine/star-citizen/drive_c",
        ] {
            dirs_found.push(home.join(prefix).join(suffix));
        }
    }

    dirs_found
}

#[tauri::command]
fn detect_game_log() -> Option<String> {
    candidate_live_dirs()
        .into_iter()
        .find(|d| d.join("Game.log").is_file() || d.join("logbackups").is_dir())
        .map(|d| d.to_string_lossy().into_owned())
}

fn parse_line(line: &str, localization: &HashMap<String, String>, file: &str) -> Option<LogEvent> {
    let (kind, caps) = if let Some(c) = BLUEPRINT_RE.captures(line) {
        ("blueprint", c)
    } else if let Some(c) = REFINERY_RE.captures(line) {
        ("refinery_completed", c)
    } else {
        return None;
    };

    let detail = caps[2].trim().to_string();
    let item_class = (kind == "blueprint")
        .then(|| localization.get(&normalize_name(&detail)).cloned())
        .flatten();

    Some(LogEvent {
        kind: kind.to_string(),
        timestamp: caps[1].to_string(),
        detail,
        item_class,
        file: file.to_string(),
    })
}

fn scan_file(
    path: &Path,
    localization: &HashMap<String, String>,
    events: &mut Vec<LogEvent>,
    seen: &mut HashSet<(String, String)>,
) {
    // Logs can be ISO-8859 with CRLF; read lossily rather than assuming UTF-8.
    let Ok(bytes) = fs::read(path) else { return };
    let text = String::from_utf8_lossy(&bytes);
    let file = path
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();

    for line in text.lines() {
        if let Some(ev) = parse_line(line, localization, &file) {
            if seen.insert((ev.timestamp.clone(), ev.detail.clone())) {
                events.push(ev);
            }
        }
    }
}

#[derive(Serialize, Clone)]
pub struct ScanProgress {
    pub current: usize,
    pub total: usize,
    pub file: String,
}

/// Scan Game.log plus the whole logbackups history — this is the first-run
/// import that reconstructs blueprint acquisitions from every session on disk.
/// Reports per-file progress through the callback so the UI never sits silent.
fn scan_backlog_impl(
    live_dir: String,
    mut progress: impl FnMut(ScanProgress),
) -> Result<ScanResult, String> {
    let dir = PathBuf::from(&live_dir);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {live_dir}"));
    }

    let mut files = Vec::new();
    let game_log = dir.join("Game.log");
    if game_log.is_file() {
        files.push(game_log);
    }
    if let Ok(entries) = fs::read_dir(dir.join("logbackups")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "log") {
                files.push(path);
            }
        }
    }

    let localization = load_localization(&dir);
    let mut events = Vec::new();
    let mut seen = HashSet::new();
    let total = files.len();

    for (i, path) in files.iter().enumerate() {
        progress(ScanProgress {
            current: i + 1,
            total,
            file: path
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_default(),
        });
        scan_file(path, &localization, &mut events, &mut seen);
    }

    events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

    Ok(ScanResult {
        live_dir,
        files_scanned: total,
        localization_entries: localization.len(),
        events,
    })
}

// Async + spawn_blocking keeps the scan off the main thread, so the UI
// keeps painting and progress messages arrive while the scan runs.
#[tauri::command]
async fn scan_backlog(
    live_dir: String,
    on_progress: tauri::ipc::Channel<ScanProgress>,
) -> Result<ScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_backlog_impl(live_dir, |p| {
            let _ = on_progress.send(p);
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Server connection ──────────────────────────────────────────────────────
// The device token lives only in the client's config file; the UI never
// sees it — it only sees whether the client is paired and as whom.

#[derive(Serialize, Deserialize, Clone, Default)]
struct StoredSettings {
    server_url: String,
    token: String,
    user_name: String,
}

#[derive(Serialize, Clone)]
pub struct ConnectionView {
    pub paired: bool,
    pub server_url: String,
    pub user_name: String,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn load_settings(app: &tauri::AppHandle) -> Option<StoredSettings> {
    let bytes = fs::read(settings_path(app).ok()?).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn view(settings: Option<&StoredSettings>) -> ConnectionView {
    match settings {
        Some(s) if !s.token.is_empty() => ConnectionView {
            paired: true,
            server_url: s.server_url.clone(),
            user_name: s.user_name.clone(),
        },
        _ => ConnectionView {
            paired: false,
            server_url: String::new(),
            user_name: String::new(),
        },
    }
}

#[tauri::command]
fn get_connection(app: tauri::AppHandle) -> ConnectionView {
    view(load_settings(&app).as_ref())
}

#[tauri::command]
fn unpair(app: tauri::AppHandle) -> Result<ConnectionView, String> {
    let path = settings_path(&app)?;
    let _ = fs::remove_file(path);
    Ok(view(None))
}

async fn error_body(resp: reqwest::Response) -> String {
    let status = resp.status();
    let msg = resp
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_default();
    format!("Server said {status}: {msg}")
}

#[tauri::command]
async fn pair_device(
    app: tauri::AppHandle,
    server_url: String,
    code: String,
) -> Result<ConnectionView, String> {
    let base = server_url.trim().trim_end_matches('/').to_string();
    let device_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "desktop".into());

    let resp = reqwest::Client::new()
        .post(format!("{base}/api/devices/pair"))
        .json(&serde_json::json!({ "code": code.trim(), "device_name": device_name }))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Could not reach server: {e}"))?;

    if !resp.status().is_success() {
        return Err(error_body(resp).await);
    }

    #[derive(Deserialize)]
    struct PairResponse {
        token: String,
        user: PairUser,
    }
    #[derive(Deserialize)]
    struct PairUser {
        name: String,
    }

    let pair: PairResponse = resp.json().await.map_err(|e| e.to_string())?;
    let settings = StoredSettings {
        server_url: base,
        token: pair.token,
        user_name: pair.user.name,
    };
    fs::write(
        settings_path(&app)?,
        serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(view(Some(&settings)))
}

async fn post_events(
    settings: &StoredSettings,
    events: &[LogEvent],
) -> Result<SyncSummary, String> {
    let payload: Vec<_> = events
        .iter()
        .map(|e| {
            serde_json::json!({
                "kind": e.kind,
                "timestamp": e.timestamp,
                "detail": e.detail,
                "item_class": e.item_class,
            })
        })
        .collect();

    let resp = reqwest::Client::new()
        .post(format!("{}/api/ingest/events", settings.server_url))
        .bearer_auth(&settings.token)
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "events": payload }))
        .send()
        .await
        .map_err(|e| format!("Could not reach server: {e}"))?;

    if !resp.status().is_success() {
        return Err(error_body(resp).await);
    }

    resp.json().await.map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize)]
pub struct SyncSummary {
    pub accepted: usize,
    pub duplicates: usize,
    pub blueprints_added: usize,
    pub refinery_completed: usize,
}

#[tauri::command]
async fn sync_events(app: tauri::AppHandle, events: Vec<LogEvent>) -> Result<SyncSummary, String> {
    let settings = load_settings(&app).ok_or("Not paired with a server yet.")?;
    post_events(&settings, &events).await
}

// ── Live log watcher ────────────────────────────────────────────────────────
// Polls Game.log every 2 s from the end of the file, parses new lines,
// streams events to the UI ("watcher-event") and auto-syncs them to the
// server when paired ("watcher-sync" carries the result). Rotation (the
// game recreates the log on restart) is detected by the file shrinking.

#[derive(Default)]
pub struct WatcherState(Mutex<Option<Arc<AtomicBool>>>);

#[derive(Serialize, Clone)]
struct WatcherStatus {
    running: bool,
    log_path: String,
}

#[tauri::command]
fn watcher_status(state: tauri::State<WatcherState>) -> bool {
    state.0.lock().unwrap().as_ref().is_some_and(|f| !f.load(Ordering::Relaxed))
}

#[tauri::command]
fn stop_watcher(state: tauri::State<WatcherState>) {
    if let Some(flag) = state.0.lock().unwrap().take() {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn start_watcher(
    app: tauri::AppHandle,
    state: tauri::State<WatcherState>,
    live_dir: String,
) -> Result<(), String> {
    let log_path = PathBuf::from(&live_dir).join("Game.log");
    if !log_path.is_file() {
        return Err(format!("No Game.log in {live_dir} — is the game installed there?"));
    }

    let mut guard = state.0.lock().unwrap();
    if let Some(flag) = guard.take() {
        flag.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    *guard = Some(stop.clone());
    drop(guard);

    let localization = load_localization(Path::new(&live_dir));

    tauri::async_runtime::spawn(async move {
        let mut offset = fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0);
        let mut carry = String::new();

        let _ = app.emit("watcher-status", WatcherStatus {
            running: true,
            log_path: log_path.to_string_lossy().into_owned(),
        });

        while !stop.load(Ordering::Relaxed) {
            tokio_sleep().await;

            let Ok(meta) = fs::metadata(&log_path) else { continue };
            let size = meta.len();
            if size < offset {
                // Log rotated: the game restarted; read the new file fully.
                offset = 0;
                carry.clear();
            }
            if size == offset {
                continue;
            }

            let Ok(mut f) = fs::File::open(&log_path) else { continue };
            if f.seek(SeekFrom::Start(offset)).is_err() {
                continue;
            }
            let mut buf = Vec::with_capacity((size - offset) as usize);
            if f.read_to_end(&mut buf).is_err() {
                continue;
            }
            offset = size;

            let chunk = format!("{carry}{}", String::from_utf8_lossy(&buf));
            let (complete, rest) = match chunk.rfind('\n') {
                Some(i) => chunk.split_at(i + 1),
                None => ("", chunk.as_str()),
            };
            carry = rest.to_string();

            let events: Vec<LogEvent> = complete
                .lines()
                .filter_map(|l| parse_line(l, &localization, "Game.log"))
                .collect();
            if events.is_empty() {
                continue;
            }

            for ev in &events {
                let _ = app.emit("watcher-event", ev);
            }
            if let Some(settings) = load_settings(&app) {
                match post_events(&settings, &events).await {
                    Ok(summary) => {
                        let _ = app.emit("watcher-sync", &summary);
                    }
                    Err(message) => {
                        let _ = app.emit("watcher-sync-error", &message);
                    }
                }
            }
        }

        let _ = app.emit("watcher-status", WatcherStatus {
            running: false,
            log_path: log_path.to_string_lossy().into_owned(),
        });
    });

    Ok(())
}

async fn tokio_sleep() {
    tauri::async_runtime::spawn_blocking(|| std::thread::sleep(std::time::Duration::from_secs(2)))
        .await
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    // Runs against a real installation when STARMAKER_TEST_LIVE_DIR is set;
    // skips silently otherwise so CI stays green without game files.
    #[test]
    fn scans_real_logs() {
        let Ok(dir) = std::env::var("STARMAKER_TEST_LIVE_DIR") else {
            return;
        };
        let result = scan_backlog_impl(dir, |_| {}).expect("scan should succeed");
        let blueprints: Vec<_> = result.events.iter().filter(|e| e.kind == "blueprint").collect();
        let resolved = blueprints.iter().filter(|e| e.item_class.is_some()).count();
        let refinery = result.events.len() - blueprints.len();
        println!(
            "scanned {} files ({} localization entries): {} blueprint events ({} resolved to item classes), {} refinery completions",
            result.files_scanned, result.localization_entries, blueprints.len(), resolved, refinery
        );
        for e in blueprints.iter().take(5) {
            println!("  {} -> {:?}", e.detail, e.item_class);
        }
        assert!(result.files_scanned > 0);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The AppImage bundles Ubuntu-22.04-era WebKitGTK, whose DMABUF renderer
    // aborts with EGL_BAD_PARAMETER against newer Mesa/driver stacks (white
    // window). Disable it unless the user has set the variable themselves.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            detect_game_log,
            scan_backlog,
            get_connection,
            pair_device,
            unpair,
            sync_events,
            start_watcher,
            stop_watcher,
            watcher_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
