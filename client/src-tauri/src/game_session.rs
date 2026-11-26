//! What Game.log says about the session being played: which build, where the
//! player last was, which ship they last boarded, and whether the game is
//! still up. The watcher feeds it every line it reads; the windows show it.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use regex::Regex;
use tauri::{Emitter, Manager};

use crate::lock::LockExt;

/// The event the windows listen to; carries a `GameSession`.
pub const EVENT: &str = "game-session";

static ENVIRONMENT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\bEnvironment:\s+(\S+)").unwrap());
static BRANCH_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^<[^>]+>\s+Branch:\s+(\S+)").unwrap());
static LOCATION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"<RequestLocationInventory> Player\[([^\]]+)\] requested inventory for Location\[([^\]]+)\]").unwrap()
});
/// `<Join PU> address[…] port[…] shard[pub_euw1b_13165946_320] …`
static SHARD_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<Join PU> .*?\bshard\[([^\]]+)\]").unwrap());
static LOGIN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"<AccountLoginCharacterStatus_Character> Character: .*?\bgeid (\d+) - accountId (\d+) .*?- name (\S+) - state STATE_CURRENT").unwrap()
});
static CHANNEL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"Added notification "You have joined channel '([^']+)'"#).unwrap());

/// What the log has told so far. Everything is the last thing it said, so a
/// session that has ended still shows where it was left.
#[derive(Serialize, Clone, Default, PartialEq, Debug)]
pub struct GameSession {
    /// LIVE is "PUB" in the log; PTU, EPTU, TECH-PREVIEW as they are.
    pub environment: Option<String>,
    /// The build, as `sc-alpha-4.10.0`.
    pub branch: Option<String>,
    /// Whether the log's last line is not the game shutting down.
    pub running: bool,
    /// The location as the game names it to players, where that is known.
    pub location: Option<String>,
    /// The location's code, as the log writes it.
    pub location_code: Option<String>,
    /// The ship whose channel the player last joined.
    pub ship: Option<String>,
    /// The player's handle, from the same lines.
    pub player: Option<String>,
    /// The server the player joined: two players on the same one can meet.
    pub shard: Option<String>,
    /// Who is logged in, from the login line.
    pub character: Option<crate::game_dir::Character>,
}

/// A line the game writes as it goes down: after it, nothing is running.
fn ends_session(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("shutdown") || lower.contains("endsession") || lower.contains("crash handler")
}

impl GameSession {
    /// Fold one log line in. Returns whether anything changed.
    pub fn feed(&mut self, line: &str, names: &mut Names) -> bool {
        let before = self.clone();
        let line = line.trim_end();
        if line.is_empty() {
            return false;
        }
        self.running = !ends_session(line);
        if let Some(c) = ENVIRONMENT_RE.captures(line) {
            self.environment = Some(c[1].to_string());
        } else if let Some(c) = BRANCH_RE.captures(line) {
            self.branch = Some(c[1].to_string());
        } else if let Some(c) = SHARD_RE.captures(line) {
            self.shard = Some(c[1].to_string());
        } else if let Some(c) = LOGIN_RE.captures(line) {
            let character = crate::game_dir::Character { geid: c[1].to_string(), account_id: c[2].to_string(), name: c[3].to_string() };
            self.player = Some(character.name.clone());
            self.character = Some(character);
        } else if let Some(c) = LOCATION_RE.captures(line) {
            self.player = Some(c[1].to_string());
            let code = c[2].to_string();
            if code != "INVALID_LOCATION_ID" {
                self.location = Some(names.location(&code));
                self.location_code = Some(code);
            }
        } else if let Some(c) = CHANNEL_RE.captures(line) {
            // A ship's channel is "<ship> : <owner>"; the owner may be someone
            // else's ship the player boarded.
            let channel = c[1].trim();
            let ship = channel.split(" : ").next().unwrap_or(channel).trim();
            if !ship.is_empty() {
                self.ship = Some(names.ship(ship));
            }
        }
        *self != before
    }
}

/// Names the game shows players, looked up in its own localization file.
#[derive(Default)]
pub struct Names {
    ini: Option<PathBuf>,
    cache: HashMap<String, String>,
    keys: HashMap<String, Option<String>>,
}

/// Codes whose name lives under a key the code does not lead to.
const ALIASES: &[(&str, &str)] = &[
    ("RR_HUR_LEO", "Stanton1_Transfer"),
    ("RR_CRU_LEO", "Stanton2_Transfer_Seraphim"),
    ("RR_ARC_LEO", "Stanton3_Transfer"),
    ("RR_MIC_LEO", "Stanton4_Transfer"),
    ("Nyx_Levski", "Delamar_Levski"),
];

static SOCIAL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^AsteroidClusterBase_(\w+?)_Social_(\w+?)_(\d+)$").unwrap());
static JUMP_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^RR_JP_([A-Z][a-z]+)([A-Z][a-z]+)$").unwrap());
static LEO_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(RR_P\d+)_LEO$").unwrap());
static PLANET_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(Stanton|Pyro|Nyx)\d*[a-z]?$").unwrap());
static HDMS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^HDMS([A-Z]\w*)$").unwrap());
/// A lower-case letter followed by a word or a number: where to put a space.
static CAMEL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"([a-z])([A-Z][a-z]|[0-9])").unwrap());

impl Names {
    pub fn new(live_dir: &Path) -> Self {
        let ini = ["Data", "data"]
            .iter()
            .map(|d| live_dir.join(d).join("Localization/english/global.ini"))
            .find(|p| p.is_file());
        Self { ini, cache: HashMap::new(), keys: HashMap::new() }
    }

    /// The text under one global.ini key, looked up once.
    pub fn key(&mut self, key: &str) -> Option<String> {
        if let Some(v) = self.keys.get(key) {
            return v.clone();
        }
        let v = self.lookup(&[key.to_string()]);
        self.keys.insert(key.to_string(), v.clone());
        v
    }

    /// The keys a location code may be named under, most exact first.
    fn location_keys(code: &str) -> Vec<String> {
        let mut keys = vec![code.to_string()];
        if let Some((_, key)) = ALIASES.iter().find(|(c, _)| c.eq_ignore_ascii_case(code)) {
            keys.push((*key).to_string());
        }
        if let Some(c) = SOCIAL_RE.captures(code) {
            keys.push(format!("{}_{}_Segment_Social_{}", &c[1], &c[2], &c[3]));
        }
        if let Some(c) = JUMP_RE.captures(code) {
            keys.push(format!("{}_JumpPoint_{}", &c[1], &c[2]));
        }
        if let Some(c) = LEO_RE.captures(code) {
            keys.push(c[1].to_string());
        }
        keys
    }

    /// Look keys up in global.ini in one pass; the first key with a value wins.
    fn lookup(&self, keys: &[String]) -> Option<String> {
        let wanted: HashSet<String> = keys.iter().map(|k| k.to_ascii_lowercase()).collect();
        let text = std::fs::read(self.ini.as_ref()?).ok()?;
        let text = String::from_utf8_lossy(&text);
        let mut found: HashMap<String, String> = HashMap::new();
        for line in text.lines() {
            let line = line.trim_start_matches('\u{FEFF}');
            let Some((key, value)) = line.split_once('=') else { continue };
            let key = key.split(',').next().unwrap_or(key).to_ascii_lowercase();
            if wanted.contains(&key) && !value.trim().is_empty() {
                found.entry(key).or_insert_with(|| value.trim().to_string());
            }
        }
        keys.iter().find_map(|k| found.get(&k.to_ascii_lowercase()).cloned())
    }

    pub fn location(&mut self, code: &str) -> String {
        if let Some(name) = self.cache.get(code) {
            return name.clone();
        }
        let name = self
            .lookup(&Self::location_keys(code))
            .or_else(|| self.numbered_like_the_first(code))
            .unwrap_or_else(|| readable(code));
        self.cache.insert(code.to_string(), name.clone());
        name
    }

    /// The game names only the first of a belt's social stations
    /// ("Keeger Social Station 001"); the others are numbered the same way.
    fn numbered_like_the_first(&self, code: &str) -> Option<String> {
        let c = SOCIAL_RE.captures(code)?;
        let first = self.lookup(&[format!("{}_{}_Segment_Social_001", &c[1], &c[2])])?;
        first.strip_suffix("001").map(|stem| format!("{stem}{}", &c[3]))
    }

    /// Ships are named in plain words, except where the channel carries the
    /// localization key itself (`@vehicle_NameANVL_Asgard`).
    pub fn ship(&mut self, ship: &str) -> String {
        let Some(key) = ship.strip_prefix('@') else { return ship.to_string() };
        if let Some(name) = self.cache.get(ship) {
            return name.clone();
        }
        let name = self.lookup(&[key.to_string()]).unwrap_or_else(|| key.to_string());
        self.cache.insert(ship.to_string(), name.clone());
        name
    }
}

/// A code made readable when the game has no name for it:
/// `Stanton1_HurdynMining_HDMSThedus` → `Hurdyn Mining HDMS-Thedus`.
fn readable(code: &str) -> String {
    let words: Vec<String> = code
        .split('_')
        .filter(|w| !w.is_empty() && !PLANET_RE.is_match(w) && *w != "RR" && *w != "AsteroidClusterBase")
        .map(|w| match HDMS_RE.captures(w) {
            Some(c) => format!("HDMS-{}", &c[1]),
            None if w.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) => w.to_string(),
            None => CAMEL_RE.replace_all(w, "$1 $2").into_owned(),
        })
        .collect();
    if words.is_empty() { code.to_string() } else { words.join(" ") }
}

/// The session as the client knows it, and the names it has looked up.
#[derive(Default)]
pub struct SessionState(Mutex<(GameSession, Names)>);

impl SessionState {
    /// Start over for a log: its whole text, read once, then what follows.
    pub fn reset(&self, live_dir: &Path, text: &str) -> GameSession {
        let mut guard = self.0.lock_or_recover();
        let mut session = GameSession::default();
        let mut names = Names::new(live_dir);
        for line in text.lines() {
            session.feed(line, &mut names);
        }
        *guard = (session.clone(), names);
        session
    }

    /// Lines read since; Some when the session changed.
    pub fn feed<'a>(&self, lines: impl Iterator<Item = &'a str>) -> Option<GameSession> {
        let mut guard = self.0.lock_or_recover();
        let (session, names) = &mut *guard;
        let mut changed = false;
        for line in lines {
            changed |= session.feed(line, names);
        }
        changed.then(|| session.clone())
    }

    pub fn current(&self) -> GameSession {
        self.0.lock_or_recover().0.clone()
    }
}

pub fn emit(app: &tauri::AppHandle, session: &GameSession) {
    let _ = app.emit(EVENT, session);
}

#[tauri::command]
pub fn game_session(app: tauri::AppHandle) -> GameSession {
    app.try_state::<SessionState>().map(|s| s.current()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fold(lines: &[&str]) -> GameSession {
        let mut s = GameSession::default();
        let mut names = Names::default();
        for l in lines {
            s.feed(l, &mut names);
        }
        s
    }

    #[test]
    fn the_build_location_and_ship_come_from_their_lines() {
        let s = fold(&[
            "<2026-11-20T15:38:26.508Z> [Trace] Environment:   PTU",
            "<2026-11-20T15:38:27.156Z> Branch: sc-alpha-5.0.0",
            r#"<2026-11-20T15:50:46.179Z> [Notice] <SHUDEvent_OnNotification> Added notification "You have joined channel 'RSI Galaxy : RavenMind'."#,
            "<2026-11-20T11:54:09.940Z> [Notice] <RequestLocationInventory> Player[RavenMind] requested inventory for Location[RR_ARC_LEO] [Team_CoreGameplayFeatures][Inventory]",
        ]);
        assert_eq!(s.environment.as_deref(), Some("PTU"));
        assert_eq!(s.branch.as_deref(), Some("sc-alpha-5.0.0"));
        assert_eq!(s.ship.as_deref(), Some("RSI Galaxy"));
        assert_eq!(s.location_code.as_deref(), Some("RR_ARC_LEO"));
        assert_eq!(s.player.as_deref(), Some("RavenMind"));
        assert!(s.running);
        let s = fold(&["<2026-11-20T11:41:31.094Z> [Notice] <Join PU> address[34.62.232.110] port[64332] shard[pub_euw1b_13165946_320] locationId[562954248454145] [Team_GameServices][GIM][Matchmaking]"]);
        assert_eq!(s.shard.as_deref(), Some("pub_euw1b_13165946_320"));
    }

    #[test]
    fn a_shutdown_or_crash_as_the_last_line_means_the_game_is_not_running() {
        assert!(!fold(&["<x> Branch: sc-alpha-4.10.0", "<x> [CIG] CCIGBroker::FastShutdown", ""]).running);
        assert!(!fold(&["Cloud Imperium Games public crash handler taking over..."]).running);
        assert!(!fold(&["<x> [Notice] <EOS_Logging> [AntiCheatClient] [EndSession-001] Mode: -1"]).running);
    }

    #[test]
    fn codes_without_a_name_are_made_readable() {
        assert_eq!(readable("Stanton1_HurdynMining_HDMSThedus"), "Hurdyn Mining HDMS-Thedus");
        assert_eq!(readable("Stanton1d_ASD_Delve_Facility_008"), "ASD Delve Facility 008");
        assert_eq!(readable("GrimHEX"), "GrimHEX");
        assert_eq!(readable("Stanton3b_ArcCorp_Area056"), "Arc Corp Area 056");
    }

    #[test]
    fn location_codes_lead_to_the_keys_their_names_are_under() {
        assert!(Names::location_keys("AsteroidClusterBase_Nyx_Social_Keeger_003").contains(&"Nyx_Keeger_Segment_Social_003".to_string()));
        assert!(Names::location_keys("RR_JP_NyxCastra").contains(&"Nyx_JumpPoint_Castra".to_string()));
        assert!(Names::location_keys("RR_P3_LEO").contains(&"RR_P3".to_string()));
        assert!(Names::location_keys("RR_ARC_LEO").contains(&"Stanton3_Transfer".to_string()));
    }

    /// STARBUDDY_LIVE_DIR=<a LIVE folder> cargo test real_names -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_names() {
        let dir = std::env::var("STARBUDDY_LIVE_DIR").expect("STARBUDDY_LIVE_DIR");
        let mut names = Names::new(Path::new(&dir));
        for code in ["RR_ARC_LEO", "RR_P3_LEO", "RR_JP_NyxCastra", "AsteroidClusterBase_Nyx_Social_Keeger_003", "Nyx_Levski", "Stanton1_Lorville", "Stanton1_HurdynMining_HDMSThedus"] {
            println!("{code} => {}", names.location(code));
        }
        println!("ship => {}", names.ship("@vehicle_NameANVL_Asgard"));
    }
}
