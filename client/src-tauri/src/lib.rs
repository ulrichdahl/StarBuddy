use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

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

#[derive(Serialize, Clone, PartialEq, Eq, Hash)]
pub struct LogEvent {
    pub kind: String, // "blueprint" | "refinery_completed"
    pub timestamp: String,
    pub detail: String, // blueprint name, or refinery station
    pub file: String,
}

#[derive(Serialize)]
pub struct ScanResult {
    pub live_dir: String,
    pub files_scanned: usize,
    pub events: Vec<LogEvent>,
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

fn scan_file(path: &Path, events: &mut Vec<LogEvent>, seen: &mut HashSet<(String, String)>) {
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
            events.push(LogEvent {
                kind: kind.to_string(),
                timestamp,
                detail,
                file: file.clone(),
            });
        }
    }
}

/// Scan Game.log plus the whole logbackups history — this is the first-run
/// import that reconstructs blueprint acquisitions from every session on disk.
#[tauri::command]
fn scan_backlog(live_dir: String) -> Result<ScanResult, String> {
    let dir = PathBuf::from(&live_dir);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {live_dir}"));
    }

    let mut events = Vec::new();
    let mut seen = HashSet::new();
    let mut files_scanned = 0;

    let game_log = dir.join("Game.log");
    if game_log.is_file() {
        scan_file(&game_log, &mut events, &mut seen);
        files_scanned += 1;
    }

    if let Ok(entries) = fs::read_dir(dir.join("logbackups")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "log") {
                scan_file(&path, &mut events, &mut seen);
                files_scanned += 1;
            }
        }
    }

    events.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));

    Ok(ScanResult {
        live_dir,
        files_scanned,
        events,
    })
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
        let result = scan_backlog(dir).expect("scan should succeed");
        let blueprints = result.events.iter().filter(|e| e.kind == "blueprint").count();
        let refinery = result.events.len() - blueprints;
        println!(
            "scanned {} files: {} blueprint events, {} refinery completions",
            result.files_scanned, blueprints, refinery
        );
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
        .invoke_handler(tauri::generate_handler![detect_game_log, scan_backlog])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
