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

/// The kinds that say where the player went, for the org ranking. A server
/// from before them refuses a request carrying one, so they travel apart.
pub(crate) const TRAVEL_KINDS: [&str; 4] = ["quantum_arrived", "vehicle_released", "location", "jurisdiction"];

static MISSION_ID_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"MissionId: \[([0-9a-fA-F-]{36})\]").unwrap());
/// Who is playing: written at login, `... geid 2020… - accountId … - name DK-Raven - state STATE_CURRENT`.
static LOGIN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"<AccountLoginCharacterStatus_Character> Character: .*?\bgeid (\d+) - accountId (\d+) .*?- name (\S+) - state STATE_CURRENT").unwrap()
});
/// The pilot picked a quantum destination in their own ship ("Local").
static QT_SELECTED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^<([^>]+)>.*<Player Selected Quantum Target - Local>.*?\| (?:NOT AUTH \| )?\S+?\[(\d+)\]\|.*selected point (\S+) as their destination, routing locally").unwrap()
});
static QT_ARRIVED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^<([^>]+)>.*<Quantum Drive Arrived - Arrived at Final Destination>.*?\| (?:NOT AUTH \| )?\S+?\[(\d+)\]\|").unwrap()
});
static RELEASED_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^<([^>]+)>.*CVehicleMovementBase::ClearDriver: Local client node \[(\d+)\] releasing control token for '[^']*' \[(\d+)\]").unwrap()
});
static LOCATION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^<([^>]+)>.*<RequestLocationInventory> Player\[([^\]]+)\] requested inventory for Location\[([^\]]+)\]").unwrap()
});
static JURISDICTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"^<([^>]+)>.*Added notification "Entered (.+?) Jurisdiction: ""#).unwrap());

/// The character logged in, as the login line names it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub struct Character {
    pub geid: String,
    pub name: String,
    /// The RSI account the character is on: the server scores every
    /// character on an account that one named as the handle has used.
    #[serde(default)]
    pub account_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash, Default)]
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
    /// The log line, untouched, so the server can count it again later.
    #[serde(default)]
    pub raw: Option<String>,
    /// A contract's id, from `MissionId: [uuid]`.
    #[serde(default)]
    pub mission_id: Option<String>,
    /// quantum_arrived, vehicle_released: the ship's id.
    #[serde(default)]
    pub ship_id: Option<String>,
    /// quantum_arrived: the line where the destination was picked.
    #[serde(default)]
    pub raw_selected: Option<String>,
    /// Who was logged in when it happened; sent once per request.
    #[serde(default)]
    pub character: Option<Character>,
}

impl LogEvent {
    fn new(kind: &str, timestamp: &str, detail: String, file: &str, raw: &str) -> Self {
        LogEvent {
            kind: kind.to_string(),
            timestamp: timestamp.to_string(),
            detail,
            item_class: None,
            file: file.to_string(),
            raw: Some(raw.to_string()),
            mission_id: None,
            ship_id: None,
            raw_selected: None,
            character: None,
        }
    }
}

/// Reads a log line by line, keeping what later lines need: who is logged
/// in, and where each of the player's ships was told to quantum to.
#[derive(Default)]
pub(crate) struct LogParser {
    character: Option<Character>,
    /// Ship id → (destination, the selection line).
    selected: HashMap<String, (String, String)>,
}

impl LogParser {
    pub(crate) fn feed(&mut self, line: &str, localization: &HashMap<String, String>, file: &str) -> Option<LogEvent> {
        let line = line.trim_end_matches(['\r', '\n']);
        let mut event = self.event(line, localization, file)?;
        event.character = self.character.clone();
        Some(event)
    }

    fn event(&mut self, line: &str, localization: &HashMap<String, String>, file: &str) -> Option<LogEvent> {
        if let Some(e) = parse_line(line, localization, file) {
            return Some(e);
        }
        if let Some(c) = LOGIN_RE.captures(line) {
            self.character = Some(Character { geid: c[1].to_string(), account_id: c[2].to_string(), name: c[3].to_string() });
            self.selected.clear();
            return None;
        }
        if let Some(c) = QT_SELECTED_RE.captures(line) {
            self.selected.insert(c[2].to_string(), (c[3].to_string(), line.to_string()));
            return None;
        }
        if let Some(c) = QT_ARRIVED_RE.captures(line) {
            // Only an arrival the player routed themselves: anyone else's
            // ship arriving nearby is in the log too.
            let (dest, selected) = self.selected.remove(&c[2])?;
            let mut e = LogEvent::new("quantum_arrived", &c[1], dest, file, line);
            e.ship_id = Some(c[2].to_string());
            e.raw_selected = Some(selected);
            return Some(e);
        }
        if let Some(c) = RELEASED_RE.captures(line) {
            let mut e = LogEvent::new("vehicle_released", &c[1], c[3].to_string(), file, line);
            e.ship_id = Some(c[3].to_string());
            return Some(e);
        }
        if let Some(c) = LOCATION_RE.captures(line) {
            // Only the player's own requests, and only once we know who that is.
            if self.character.as_ref()?.name != c[2] || &c[3] == "INVALID_LOCATION_ID" {
                return None;
            }
            return Some(LogEvent::new("location", &c[1], c[3].to_string(), file, line));
        }
        if let Some(c) = JURISDICTION_RE.captures(line) {
            return Some(LogEvent::new("jurisdiction", &c[1], c[2].trim().to_string(), file, line));
        }
        None
    }
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
    // The game writes `Data`; a case-sensitive file system tells the two apart.
    let langs = ["Data", "data"]
        .iter()
        .filter_map(|d| fs::read_dir(live_dir.join(d).join("Localization")).ok())
        .next();
    let Some(langs) = langs else {
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
    // A watcher on the old folder follows the new one.
    if crate::watcher::running(&app) {
        if let Err(e) = crate::watcher::start(&app, &live_str) {
            log::warn!("log watcher not moved to {live_str}: {e}");
        }
    }
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

/// The build installed in a channel folder, as "<branch> <version>", e.g.
/// "sc-alpha-4.10.0 4.10.201.48085".
///
/// The RSI Launcher writes `build_manifest.id` beside `Data.p4k` when it
/// finishes patching, so this changes before the game is first started on the
/// new build. Game.log only says which build it is once the game runs, and by
/// then the game has already read its language file.
pub fn installed_build(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("build_manifest.id")).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&text).ok()?;
    let data = manifest.get("Data")?;
    let branch = data.get("Branch")?.as_str()?;
    let version = data.get("Version").and_then(|v| v.as_str()).unwrap_or("");
    Some(format!("{branch} {version}").trim().to_string())
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

    let mut event = LogEvent::new(kind, &caps[1], detail, file, line);
    event.item_class = item_class;
    event.mission_id = (kind == MISSION_COMPLETED)
        .then(|| MISSION_ID_RE.captures(line).map(|c| c[1].to_ascii_lowercase()))
        .flatten()
        .filter(|id| id != "00000000-0000-0000-0000-000000000000");
    Some(event)
}

fn scan_file(
    path: &Path,
    localization: &HashMap<String, String>,
    events: &mut Vec<LogEvent>,
    seen: &mut HashSet<(String, String, String)>,
) {
    // Logs can be ISO-8859 with CRLF; read lossily rather than assuming UTF-8.
    let Ok(bytes) = fs::read(path) else { return };
    let text = String::from_utf8_lossy(&bytes);
    let file = path
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();

    // One session per file: who is logged in starts over with each.
    let mut parser = LogParser::default();
    for line in text.lines() {
        if let Some(ev) = parser.feed(line, localization, &file) {
            if seen.insert((ev.kind.clone(), ev.timestamp.clone(), ev.detail.clone())) {
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
    #[test]
    fn installed_build_reads_the_launcher_manifest() {
        let dir = std::env::temp_dir().join(format!("sb-manifest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(installed_build(&dir), None);
        std::fs::write(
            dir.join("build_manifest.id"),
            r#"{"Data":{"Branch":"sc-alpha-4.10.0","BuildId":"x","Version":"4.10.201.48085"}}"#,
        )
        .unwrap();
        assert_eq!(installed_build(&dir).as_deref(), Some("sc-alpha-4.10.0 4.10.201.48085"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    use super::*;

    #[test]
    fn travel_is_read_for_the_logged_in_player_only() {
        let names = HashMap::new();
        let mut p = LogParser::default();
        let feed = |p: &mut LogParser, l: &str| p.feed(l, &names, "Game.log");
        // Before the login line, a location request is nobody's.
        let loc = "<2026-11-20T11:54:09.940Z> [Notice] <RequestLocationInventory> Player[RavenMind] requested inventory for Location[RR_ARC_LEO] [Team_CoreGameplayFeatures][Inventory]";
        assert!(feed(&mut p, loc).is_none());
        assert!(feed(&mut p, "<2026-11-20T11:41:10.407Z> [Notice] <AccountLoginCharacterStatus_Character> Character: createdAt 1794511959284 - updatedAt 1794511959637 - geid 204821589375 - accountId 1953448 - name RavenMind - state STATE_CURRENT [Team_GameServices][Login]").is_none());
        let e = feed(&mut p, loc).expect("a location");
        assert_eq!((e.kind.as_str(), e.detail.as_str()), ("location", "RR_ARC_LEO"));
        assert_eq!(e.character, Some(Character { geid: "204821589375".into(), name: "RavenMind".into(), account_id: "1953448".into() }));
        assert!(feed(&mut p, "<x> [Notice] <RequestLocationInventory> Player[Someone] requested inventory for Location[RR_ARC_LEO] [x]").is_none());

        // Someone else's ship arriving is not the player's travel.
        let other = "<2026-11-20T11:50:51.465Z> [Notice] <Quantum Drive Arrived - Arrived at Final Destination> [ItemNavigation][CL][2236] | NOT AUTH | MISC_Hull_A_8837998186960[8837998186960]|CSCItemNavigation::OnQuantumDriveArrived|Quantum Drive has arrived at final destination [Team_CGP4][QuantumTravel]";
        assert!(feed(&mut p, other).is_none());
        let sel = "<2026-11-20T11:50:34.203Z> [Notice] <Player Selected Quantum Target - Local> [ItemNavigation][CL][2236] | NOT AUTH | ANVL_Hornet_F7_Mk2_Collector_Mod_943842738497[943842738497]|CSCItemNavigation::OnPlayerSelectedQuantumTarget|Player has selected point ab_mine_stanton3_med_007 as their destination, routing locally [Team_CGP4][QuantumTravel]";
        assert!(feed(&mut p, sel).is_none());
        let arr = "<2026-11-20T11:50:51.465Z> [Notice] <Quantum Drive Arrived - Arrived at Final Destination> [ItemNavigation][CL][2236] | NOT AUTH | ANVL_Hornet_F7_Mk2_Collector_Mod_943842738497[943842738497]|CSCItemNavigation::OnQuantumDriveArrived|Quantum Drive has arrived at final destination [Team_CGP4][QuantumTravel]";
        let e = feed(&mut p, arr).expect("an arrival");
        assert_eq!((e.kind.as_str(), e.detail.as_str()), ("quantum_arrived", "ab_mine_stanton3_med_007"));
        assert_eq!(e.ship_id.as_deref(), Some("943842738497"));
        assert_eq!(e.raw.as_deref(), Some(arr));
        assert_eq!(e.raw_selected.as_deref(), Some(sel));
        // One selection, one arrival.
        assert!(feed(&mut p, arr).is_none());

        let e = feed(&mut p, "<2026-11-20T11:55:29.768Z> [Notice] <Vehicle Control Flow> CVehicleMovementBase::ClearDriver: Local client node [204821589375] releasing control token for 'ANVL_Hornet_F7_Mk2_Collector_Mod_943842738497' [943842738497] [Team_CGP4][Vehicle]").expect("a release");
        assert_eq!((e.kind.as_str(), e.detail.as_str()), ("vehicle_released", "943842738497"));

        let e = feed(&mut p, r#"<2026-11-20T11:42:26.555Z> [Notice] <SHUDEvent_OnNotification> Added notification "Entered ArcCorp Jurisdiction: " [1] to queue. New queue size: 2, MissionId: [00000000-0000-0000-0000-000000000000], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]"#).expect("a jurisdiction");
        assert_eq!((e.kind.as_str(), e.detail.as_str()), ("jurisdiction", "ArcCorp"));
        // The displayed copy of the notification is not a second entry.
        assert!(feed(&mut p, r#"<2026-11-20T11:42:26.556Z>    "Entered ArcCorp Jurisdiction: " [1]"#).is_none());
    }

    #[test]
    fn a_completed_contract_is_a_mission_without_its_reward_tags() {
        let no_names = HashMap::new();
        let line = r#"<2026-01-29T18:23:04.557Z> [Notice] <SHUDEvent_OnNotification> Added notification "Contract Complete: Ship In Distress <EM4>[300 Rep] [BP]*</EM4>: " [59] to queue. New queue size: 2, MissionId: [97a792bb-1518-4003-a6b5-5078d0d131ff], ObjectiveId: [] [Team_CoreGameplayFeatures][Missions][Comms]"#;
        let e = parse_line(line, &no_names, "Game.log").expect("a mission");
        assert_eq!(e.kind, MISSION_COMPLETED);
        assert_eq!(e.timestamp, "2026-01-29T18:23:04.557Z");
        assert_eq!(e.detail, "Ship In Distress");
        assert_eq!(e.mission_id.as_deref(), Some("97a792bb-1518-4003-a6b5-5078d0d131ff"));
        assert_eq!(e.raw.as_deref(), Some(line));
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
        let mut kinds: std::collections::BTreeMap<&str, usize> = Default::default();
        for e in &result.events {
            *kinds.entry(e.kind.as_str()).or_default() += 1;
        }
        println!("by kind: {kinds:?}");
        let characters: HashSet<_> = result.events.iter().filter_map(|e| e.character.as_ref()).map(|c| c.name.as_str()).collect();
        println!("characters: {characters:?}");
        assert!(result.files_scanned > 0);
    }
}
