use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use crate::prefs::{load_client_prefs, save_client_prefs};

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

/// A contract the player finished: `Contract Complete: <name>: " [n]`, written
/// once when queued and once when shown, like every notification.
static MISSION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^<([^>]+)>.*Added notification "Contract Complete: (.*): " \[\d+\]"#).unwrap()
});
/// The game's own markup in a contract's name: `<EM4>[300 Rep] [BP]*</EM4>`.
static MARKUP_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<EM\d>.*?</EM\d>|</?EM\d>").unwrap());

pub(crate) const MISSION_COMPLETED: &str = "mission_completed";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub struct LogEvent {
    pub kind: String, // "blueprint" | "refinery_completed" | "mission_completed"
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
pub(crate) fn load_localization(live_dir: &Path) -> HashMap<String, String> {
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

/// The game's channels, as the launcher names its folders.
///
/// LIVE and HOTFIX are the two a player is normally in, and which of them holds
/// the current build is not something the folder names settle: a hotfix is
/// often installed by renaming LIVE to HOTFIX and back, and sometimes by
/// copying it, so both can exist with either one being the stale copy. Auto
/// detection picks between those two by which was last written to.
///
/// PTU and TECH-PREVIEW are separate installs a player opts into, and nobody
/// wants their evening's play recorded against a test server because a folder
/// happened to be there. They are offered, never chosen.
const AUTO_CHANNELS: [&str; 2] = ["LIVE", "HOTFIX"];
const PICK_CHANNELS: [&str; 3] = ["PTU", "EPTU", "TECH-PREVIEW"];

/// One channel folder found on this machine.
#[derive(Serialize, Clone)]
pub struct GameChannel {
    /// LIVE, HOTFIX, PTU, …
    pub name: String,
    pub path: String,
    /// When its Game.log was last written, as unix milliseconds — the only
    /// honest answer to which of two channels is the one being played, and in
    /// milliseconds because two of them can be touched in the same second.
    pub played_at: Option<i64>,
    /// Whether detection may choose this one on its own.
    pub automatic: bool,
}

/// Candidate StarCitizen install roots on this machine, most likely first.
fn candidate_install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let suffix = "Program Files/Roberts Space Industries/StarCitizen";

    if cfg!(windows) {
        for drive in ["C", "D", "E"] {
            roots.push(PathBuf::from(format!("{drive}:/{suffix}")));
        }
    }

    if let Some(home) = dirs::home_dir() {
        // Lutris/Wine defaults, including the LUG-helper layout.
        for prefix in [
            "Games/star-citizen/drive_c",
            "Games/Star Citizen/drive_c",
            ".local/share/lutris/runners/wine/star-citizen/drive_c",
        ] {
            roots.push(home.join(prefix).join(suffix));
        }
    }

    roots
}

fn log_written_at(dir: &Path) -> Option<i64> {
    let modified = fs::metadata(dir.join("Game.log")).ok()?.modified().ok()?;
    let since = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(since.as_millis() as i64)
}

/// Every channel folder that exists, from every install root, newest first
/// within each kind. The same channel found under two roots is listed once.
fn game_channels_found() -> Vec<GameChannel> {
    let mut out: Vec<GameChannel> = Vec::new();
    for root in candidate_install_roots() {
        for (name, automatic) in AUTO_CHANNELS
            .iter()
            .map(|n| (*n, true))
            .chain(PICK_CHANNELS.iter().map(|n| (*n, false)))
        {
            let dir = root.join(name);
            if !looks_like_live_dir(&dir) {
                continue;
            }
            let path = dir.to_string_lossy().into_owned();
            if out.iter().any(|c| c.path == path) {
                continue;
            }
            out.push(GameChannel { name: name.to_string(), path, played_at: log_written_at(&dir), automatic });
        }
    }
    out
}

/// The channels on this machine, for the player to choose from.
#[tauri::command]
pub fn game_channels() -> Vec<GameChannel> {
    game_channels_found()
}

/// The channel auto-detection would pick: the most recently played of LIVE and
/// HOTFIX. A folder with no Game.log has never been played and loses to one
/// that has.
fn best_automatic_channel() -> Option<GameChannel> {
    game_channels_found()
        .into_iter()
        .filter(|c| c.automatic)
        .max_by_key(|c| c.played_at.unwrap_or(i64::MIN))
}

/// A LIVE folder has Game.log (once the game has run) or Bin64; accept the
/// StarCitizen folder too and step into its LIVE.
fn looks_like_live_dir(path: &Path) -> bool {
    path.join("Game.log").is_file() || path.join("Bin64").is_dir() || path.join("logbackups").is_dir()
}

/// The channel folder a browsed path means.
///
/// A player browsing to the install root means "whichever of these I am
/// playing", not LIVE in particular — the folder named LIVE is as likely as
/// not to be last month's build on a machine where hotfixes are installed by
/// renaming. A test channel is only ever reached by naming it outright.
fn normalize_live_dir(path: &Path) -> Option<PathBuf> {
    if looks_like_live_dir(path) {
        return Some(path.to_path_buf());
    }
    let mut channels: Vec<(PathBuf, Option<i64>)> = AUTO_CHANNELS
        .iter()
        .map(|name| path.join(name))
        .filter(|dir| looks_like_live_dir(dir))
        .map(|dir| {
            let played = log_written_at(&dir);
            (dir, played)
        })
        .collect();
    channels.sort_by_key(|(_, played)| std::cmp::Reverse(played.unwrap_or(i64::MIN)));
    channels.into_iter().next().map(|(dir, _)| dir)
}

/// Remember a folder the player browsed to; returns the LIVE folder used.
#[tauri::command]
pub fn set_live_dir(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let chosen = PathBuf::from(path.trim());
    let live = normalize_live_dir(&chosen).ok_or_else(|| {
        format!(
            "{} is not one of Star Citizen's game folders — pick a channel (LIVE, HOTFIX, PTU, …) or the StarCitizen folder holding them.",
            chosen.display()
        )
    })?;
    let live_str = live.to_string_lossy().into_owned();
    let mut prefs = load_client_prefs(&app);
    prefs.live_dir = Some(live_str.clone());
    save_client_prefs(&app, &prefs)?;
    log::info!("game folder set to {live_str}");
    Ok(live_str)
}

/// The folder to watch: whatever the player last chose, else the channel that
/// was last played of the two that may be chosen automatically.
#[tauri::command]
pub fn detect_game_log(app: tauri::AppHandle) -> Option<String> {
    if let Some(saved) = load_client_prefs(&app).live_dir {
        if looks_like_live_dir(Path::new(&saved)) {
            return Some(saved);
        }
    }
    best_automatic_channel().map(|c| c.path)
}

pub(crate) fn parse_line(line: &str, localization: &HashMap<String, String>, file: &str) -> Option<LogEvent> {
    let (kind, caps) = if let Some(c) = BLUEPRINT_RE.captures(line) {
        ("blueprint", c)
    } else if let Some(c) = REFINERY_RE.captures(line) {
        ("refinery_completed", c)
    } else {
        (MISSION_COMPLETED, MISSION_RE.captures(line)?)
    };

    let detail = if kind == MISSION_COMPLETED {
        // The reward tags are the game's decoration, not the contract's name.
        MARKUP_RE.replace_all(&caps[2], "").trim().chars().take(255).collect()
    } else {
        caps[2].trim().to_string()
    };
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
pub async fn scan_backlog(
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_completed_contract_is_a_mission_without_its_reward_tags() {
        let no_names = HashMap::new();
        let line = r#"<2026-01-29T18:23:04.557Z> [Notice] <SHUDEvent_OnNotification> Added notification "Contract Complete: Ship In Distress <EM4>[300 Rep] [BP]*</EM4>: " [59] to queue. New queue size: 2, MissionId: [97a792bb-1518-4003-a6b5-5078d0d131ff], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]"#;
        let e = parse_line(line, &no_names, "Game.log").expect("a mission");
        assert_eq!(e.kind, MISSION_COMPLETED);
        assert_eq!(e.timestamp, "2026-01-29T18:23:04.557Z");
        assert_eq!(e.detail, "Ship In Distress");
        let line = r#"<2026-01-29T17:56:31.036Z> [Notice] <SHUDEvent_OnNotification> Added notification "Contract Complete: Alliance Aid: Small Supply of Research Resource: " [13] to queue."#;
        assert_eq!(parse_line(line, &no_names, "Game.log").unwrap().detail, "Alliance Aid: Small Supply of Research Resource");
        // Shared and accepted contracts are not completed ones.
        let line = r#"<2026-01-29T17:56:31.036Z> [Notice] <SHUDEvent_OnNotification> Added notification "Contract Shared: RSI Disc. Month: UCM Order (M): " [13] to queue."#;
        assert!(parse_line(line, &no_names, "Game.log").is_none());
    }

    /// A StarCitizen folder with the named channels in it. They are written in
    /// order, so the last one named has the newest Game.log — which is the
    /// only thing that separates two channels that both exist. `false` gives a
    /// channel that was installed and never launched.
    fn install_with(channels: &[(&str, bool)]) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("starbuddy-channels-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = fs::remove_dir_all(&root);
        for (name, played) in channels {
            let dir = root.join(name);
            fs::create_dir_all(&dir).expect("channel dir");
            if *played {
                fs::write(dir.join("Game.log"), b"x").expect("Game.log");
                // Coarse clocks exist; a channel written later must read later.
                std::thread::sleep(std::time::Duration::from_millis(20));
            } else {
                fs::create_dir_all(dir.join("Bin64")).expect("Bin64");
            }
        }
        root
    }

    #[test]
    fn the_install_folder_means_whichever_channel_was_played_last() {
        // A hotfix installed by renaming, then reverted: both folders exist and
        // only the clock says which one the player is in.
        let root = install_with(&[("LIVE", true), ("HOTFIX", true)]);
        assert_eq!(normalize_live_dir(&root), Some(root.join("HOTFIX")));
    }

    #[test]
    fn a_channel_that_has_never_been_played_loses_to_one_that_has() {
        // A copied install that was never launched is not where the log is,
        // however new the folder itself looks.
        let root = install_with(&[("HOTFIX", true), ("LIVE", false)]);
        assert_eq!(normalize_live_dir(&root), Some(root.join("HOTFIX")));
    }

    #[test]
    fn a_test_channel_is_never_chosen_for_the_player() {
        // PTU beside nothing else: browsing to the install folder finds no
        // channel at all rather than quietly recording an evening against a
        // test server. Naming the folder itself still works.
        let root = install_with(&[("PTU", true)]);
        assert_eq!(normalize_live_dir(&root), None);
        assert_eq!(normalize_live_dir(&root.join("PTU")), Some(root.join("PTU")));
    }

    #[test]
    fn a_channel_folder_names_itself() {
        let root = install_with(&[("HOTFIX", true)]);
        assert_eq!(normalize_live_dir(&root.join("HOTFIX")), Some(root.join("HOTFIX")));
    }

    // Runs against a real installation when STARBUDDY_TEST_LIVE_DIR is set;
    // skips silently otherwise so CI stays green without game files.
    #[test]
    fn scans_real_logs() {
        let Ok(dir) = std::env::var("STARBUDDY_TEST_LIVE_DIR") else {
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
