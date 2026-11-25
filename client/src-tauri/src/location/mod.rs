//! EXPERIMENT: where the player is, read once a second from the game's
//! `r_DisplayInfo` debug text, with one beacon to steer to.
//!
//! The debug text lists the coordinate frames the player is in, innermost
//! first, down to the solar system's and `Root`. A beacon is kept in one
//! frame: the planet's (`OOC_Stanton_4_Microtech`, which turns with the
//! planet, so a point on the ground stays put in it) when set on or near a
//! planet, the solar system's otherwise. Either way it also keeps the exact
//! SolarSystem zone name, whose number is particular to the shard: Nyx and
//! Stanton on one shard were `…370` and `…366`, Nyx on two shards `…073` and
//! `…059`.
//!
//! Runs only while the beacon window is open and screen reading is on.

pub mod glyphs;
pub mod nav;
pub mod parse;
pub mod recorder;
pub mod stable;
pub mod telemetry;

use crate::lock::LockExt;
use nav::Nav;
use parse::{Fix, Zone};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// The overlay window's name.
pub const WINDOW: &str = "beacon";

/// The corner is read once a second; the telemetry's heading and speed come
/// many times a second, so the window is refreshed in between.
const PERIOD: Duration = Duration::from_secs(1);
const TICK: Duration = Duration::from_millis(250);
/// Above this the debug text's speed is quantum travel, during which the
/// telemetry's speed freezes at what it was before the jump.
const QUANTUM: f64 = 1000.0;
/// Two fixes further apart than this say nothing about speed.
const SPEED_GAP: f64 = 5.0;

static TEMPLATES: LazyLock<glyphs::Templates> = LazyLock::new(glyphs::Templates::builtin);

/// The beacon being steered to: one of the player's own, an org mate's
/// shared one from the website, or one set here while offline.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Beacon {
    /// The website's id; None for one never saved there.
    #[serde(default)]
    pub id: Option<serde_json::Value>,
    pub name: String,
    /// The SolarSystem zone's exact name: system and shard.
    pub shard: String,
    /// The star system's name, `Stanton`, when it was known.
    #[serde(default)]
    pub system: Option<String>,
    /// The frame `pos` is in: a planet's (`OOC_Stanton_3_ArcCorp`), which
    /// turns with the planet, or the solar system's.
    pub frame: String,
    pub pos: [f64; 3],
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub server: Option<String>,
    /// Who set it, for an org mate's beacon.
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub mine: bool,
}

/// Where the player is, as a new beacon would be set.
#[derive(Serialize, Clone, Default)]
pub struct Here {
    pub shard: String,
    pub system: Option<String>,
    pub frame: String,
    pub pos: [f64; 3],
    pub location: Option<String>,
    pub server: Option<String>,
    /// A short name for the place, for a new beacon's default name.
    pub area: String,
}

/// What the window shows.
#[derive(Serialize, Clone, Default)]
pub struct View {
    /// `off` (screen reading off), `waiting` (no frame yet), `no-text`
    /// (nothing readable: r_DisplayInfo off?) or `ok`.
    pub status: &'static str,
    /// Seconds since the position was read.
    pub age: Option<f64>,
    pub speed: Option<f64>,
    pub here: Option<Here>,
    pub beacon: Option<Beacon>,
    pub nav: Option<Nav>,
    /// Why there is no way to the beacon: `system` (it is in another star
    /// system) or `frame` (on a planet you are not near).
    pub beacon_elsewhere: Option<&'static str>,
    /// Steering to it, with a doubt: `shard` (set on another shard; the
    /// coordinates match, what was left there may not).
    pub beacon_warning: Option<&'static str>,
    /// The last read was held back as a likely misread.
    pub held: bool,
    /// What the reader saw, for the details.
    pub lines: Vec<String>,
}

#[derive(Default)]
struct State {
    last: Option<(Fix, Instant)>,
    vels: Vec<(String, [f64; 3])>,
    stable: stable::Stabilizer,
    /// Star system names seen per SolarSystem zone, for fixes that do not say.
    systems: std::collections::HashMap<String, String>,
    beacon: Option<Beacon>,
    view: View,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Mutex::default);

fn beacon_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("beacon.json"))
}

fn here(state: &State) -> Option<Here> {
    let (fix, _) = state.last.as_ref()?;
    let system = fix.system()?;
    let frame = fix.planet_zone().unwrap_or(system);
    Some(Here {
        shard: system.name.clone(),
        system: fix.system_name().or_else(|| state.systems.get(&system.name).cloned()),
        frame: frame.name.clone(),
        pos: frame.pos,
        location: fix.location.clone(),
        server: fix.server.clone(),
        area: fix.area(),
    })
}

fn refresh(state: &mut State) {
    let now = Instant::now();
    state.view.age = state.last.as_ref().map(|(_, at)| now.duration_since(*at).as_secs_f64());
    let planet = state.last.as_ref().and_then(|(f, _)| f.planet_zone().map(|z| z.name.clone()));
    let read = nav::ground_speed(&state.vels, planet.as_deref()).map(|(_, v)| v);
    let flight = telemetry::flight();
    // The game's own number while it has one, the debug text's in quantum
    // travel and on foot.
    state.view.speed = match (flight, read) {
        (Some(_), Some(r)) if r > QUANTUM => Some(r),
        (Some(f), _) => Some(f.speed),
        (None, r) => r,
    };
    state.view.here = here(state);
    state.view.beacon = state.beacon.clone();
    state.view.beacon_elsewhere = None;
    state.view.beacon_warning = None;
    state.view.nav = None;
    let (Some((fix, _)), Some(here), Some(b)) = (&state.last, &state.view.here, &state.beacon) else { return };
    let mut frame = b.frame.clone();
    if here.shard != b.shard {
        // Another shard of the same system has the same coordinates (Levski
        // measured 1 km apart across two shards); another system does not.
        // Without both names a space beacon is steered to, with the warning.
        if let (Some(a), Some(c)) = (&here.system, &b.system) {
            if a != c {
                state.view.beacon_elsewhere = Some("system");
                return;
            }
        }
        state.view.beacon_warning = Some("shard");
        if frame == b.shard {
            frame = here.shard.clone();
        }
    }
    let target = [Zone { name: frame, pos: b.pos }];
    state.view.nav = nav::to_beacon(&fix.zones, &target, &state.vels, flight.and_then(|f| f.heading));
    match &mut state.view.nav {
        None => state.view.beacon_elsewhere = Some("frame"),
        // No closing speed from the debug text yet: the game's speed, when
        // the nose is near enough the beacon for it to count.
        Some(n) if n.eta.is_none() => {
            if let (Some(s), Some(t)) = (state.view.speed, n.turn) {
                if s > 1.0 && t.abs() < 20.0 {
                    n.eta = Some(n.distance / s);
                }
            }
        }
        Some(_) => {}
    }
}

fn publish(app: &AppHandle, view: View) {
    crate::overlay::emit_to_overlay(app, WINDOW, "location-view", view);
}

/// One look at the corner.
fn pass(app: &AppHandle) {
    let status;
    let mut read = None;
    if !crate::reading::state(app).on {
        status = "off";
    } else if let Some(frame) = crate::capture::latest() {
        let started = Instant::now();
        let (x, y, w, h) = glyphs::corner(frame.width, frame.height);
        let cut = frame.rect_rgb(x, y, w, h);
        drop(frame);
        match cut {
            Ok(cap) => {
                let ink = glyphs::Ink::new(&cap.rgb, cap.width as usize, cap.height as usize);
                let lines = ink.read_all(&TEMPLATES);
                let fix = parse::parse(&lines);
                status = if fix.zones.is_empty() { "no-text" } else { "ok" };
                read = Some((fix, lines, started.elapsed().as_secs_f64() * 1000.0, cap));
            }
            Err(e) => {
                log::debug!("location: {e}");
                status = "waiting";
            }
        }
    } else {
        status = "waiting";
    }

    let mut record = None;
    let view = {
        let mut state = STATE.lock_or_recover();
        state.view.status = status;
        if let Some((fix, lines, ms, cap)) = read {
            state.view.lines = lines.clone();
            record = Some((cap, fix.clone(), lines, ms));
            if !fix.zones.is_empty() {
                let now = Instant::now();
                let cleaned = state.stable.clean(fix, now);
                state.view.held = cleaned.is_none();
                if let Some(fix) = cleaned {
                    if let Some((before, at)) = &state.last {
                        let dt = now.duration_since(*at).as_secs_f64();
                        state.vels = if dt <= SPEED_GAP { nav::velocities(&before.zones, &fix.zones, dt) } else { Vec::new() };
                    }
                    if let (Some(sys), Some(name)) = (fix.system(), fix.system_name()) {
                        state.systems.insert(sys.name.clone(), name);
                    }
                    state.last = Some((fix, now));
                }
            }
        }
        refresh(&mut state);
        state.view.clone()
    };
    if let Some((cap, fix, lines, ms)) = record {
        recorder::record(app, &cap, &fix, &lines, ms, view.speed, view.held);
    }
    publish(app, view);
}

/// Load the saved beacon and start looking, once a second, while the window is open.
pub fn start(app: &AppHandle) {
    {
        let mut state = STATE.lock_or_recover();
        state.beacon = beacon_path(app).and_then(|p| crate::fs_atomic::read_json::<Beacon>(&p));
    }
    let open = |app: &AppHandle| app.get_webview_window(&format!("overlay-{WINDOW}")).is_some();
    let a = app.clone();
    telemetry::start(move || open(&a));
    let app = app.clone();
    std::thread::Builder::new()
        .name("location".into())
        .spawn(move || {
            let mut last = Instant::now();
            loop {
                std::thread::sleep(TICK);
                if !open(&app) {
                    continue;
                }
                if last.elapsed() >= PERIOD {
                    last = Instant::now();
                    pass(&app);
                } else if telemetry::flight().is_some() {
                    let view = {
                        let mut state = STATE.lock_or_recover();
                        refresh(&mut state);
                        state.view.clone()
                    };
                    publish(&app, view);
                }
            }
        })
        .ok();
}

/// The "beacon" hotkey: the window saves one where the player is, with the
/// default name, as its own Set button would.
pub fn set_beacon(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(&format!("overlay-{WINDOW}")).is_none() {
        return Err("the beacon window is not open".into());
    }
    crate::overlay::emit_to_overlay(app, WINDOW, "location-set-request", ());
    Ok(())
}

#[tauri::command]
pub fn location_view() -> View {
    let mut state = STATE.lock_or_recover();
    refresh(&mut state);
    state.view.clone()
}

/// Steer to this beacon, or to none.
#[tauri::command]
pub fn location_track(app: AppHandle, beacon: Option<Beacon>) -> Result<View, String> {
    if let Some(path) = beacon_path(&app) {
        match &beacon {
            Some(b) => {
                let bytes = serde_json::to_vec_pretty(b).map_err(|e| e.to_string())?;
                crate::fs_atomic::write(&path, &bytes).map_err(|e| e.to_string())?;
            }
            None => {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    recorder::note(&app, "beacon-tracked", serde_json::to_value(&beacon).unwrap_or_default());
    let view = {
        let mut state = STATE.lock_or_recover();
        state.beacon = beacon;
        refresh(&mut state);
        state.view.clone()
    };
    publish(&app, view.clone());
    Ok(view)
}

/// Open or close the window, from the main window's button.
#[tauri::command]
pub async fn location_window(app: AppHandle) -> Result<bool, String> {
    crate::overlay::toggle_from_anywhere(app, WINDOW.to_string()).await
}
