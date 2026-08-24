use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri::Manager;

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
            let class = key[key.len() - rest.len()..]
                .trim_start_matches('_')
                .trim_end_matches("_SCItem")
                .to_string();
            if class.is_empty() {
                continue;
            }
            // First writer wins; `_SCItem` duplicates collapse to one class.
            map.entry(normalize_name(value)).or_insert(class);
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
        let (kind, caps) = if let Some(c) = BLUEPRINT_RE.captures(line) {
            ("blueprint", c)
        } else if let Some(c) = REFINERY_RE.captures(line) {
            ("refinery_completed", c)
        } else {
            continue;
        };

        let timestamp = caps[1].to_string();
        let detail = caps[2].trim().to_string();
        if seen.insert((timestamp.clone(), detail.clone())) {
            let item_class = (kind == "blueprint")
                .then(|| localization.get(&normalize_name(&detail)).cloned())
                .flatten();
            events.push(LogEvent {
                kind: kind.to_string(),
                timestamp,
                detail,
                item_class,
                file: file.clone(),
            });
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
        .invoke_handler(tauri::generate_handler![
            detect_game_log,
            scan_backlog,
            get_connection,
            pair_device,
            unpair,
            sync_events
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
