//! Two lines StarBuddy can keep in the game's user.cfg for the beacon window,
//! each the player's choice:
//!
//! - telemetry: `grpc.client.server.enabled = 1` makes Star Citizen serve
//!   its telemetry stream on 127.0.0.1:2942, which gives the ship's compass
//!   heading and the game's own speed (location/telemetry.rs);
//! - position text: `r_DisplayInfo = 1` puts the debug text with the `Zone`
//!   and `Pos` lines in the corner, which is where the position comes from.
//!
//! The game reads user.cfg only as it starts. Each is asked once: `None` in
//! the preferences is a player not asked yet, and the main window asks.
//! StarConfig (udi.rs) writes the whole user.cfg on each update, so it
//! merges the lines into what it writes too.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::prefs::{load_client_prefs, save_client_prefs};

/// The player's answers; None for not asked yet.
#[derive(Serialize, Deserialize, Clone, Copy, Default, Debug, PartialEq)]
pub struct GameLines {
    pub telemetry: Option<bool>,
    pub display_info: Option<bool>,
}

const TELEMETRY_KEY: &str = "grpc.client.server.enabled";
const TELEMETRY: &[u8] = b"grpc.client.server.enabled = 1\r\n";
const DISPLAY_KEY: &str = "r_DisplayInfo";
const DISPLAY: &[u8] = b"r_DisplayInfo = 1\r\n";

fn lines(body: &[u8]) -> impl Iterator<Item = &[u8]> {
    body.split_inclusive(|b| *b == b'\n')
}

/// The key and value of one `key = value` line.
fn key_value(line: &[u8]) -> (String, String) {
    let text = String::from_utf8_lossy(line);
    let mut parts = text.splitn(2, '=');
    let key = parts.next().unwrap_or("").trim().to_string();
    let value = parts.next().unwrap_or("").trim().to_string();
    (key, value)
}

fn append(out: &mut Vec<u8>, line: &[u8]) {
    if !out.is_empty() && !out.ends_with(b"\n") {
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(line);
}

/// `body` with the telemetry line, or without it. Any line already setting
/// the key goes, whatever its value; the rest is kept byte for byte.
pub(crate) fn merge_telemetry(body: &[u8], on: bool) -> Vec<u8> {
    let mut out: Vec<u8> = lines(body).filter(|l| !key_value(l).0.eq_ignore_ascii_case(TELEMETRY_KEY)).flatten().copied().collect();
    if on {
        append(&mut out, TELEMETRY);
    }
    out
}

/// `body` showing the position text. A level the player chose already
/// (2, 3, 4 also show the position) is kept; 0 or none becomes 1. Off takes
/// out only the line StarBuddy adds, never a level of the player's own.
pub(crate) fn merge_display(body: &[u8], on: bool) -> Vec<u8> {
    let shows = |v: &str| v.parse::<i32>().is_ok_and(|n| n >= 1);
    let ours = |l: &[u8]| {
        let (k, v) = key_value(l);
        k.eq_ignore_ascii_case(DISPLAY_KEY) && v == "1"
    };
    if !on {
        return lines(body).filter(|l| !ours(l)).flatten().copied().collect();
    }
    let mut kept = false;
    let mut out: Vec<u8> = Vec::with_capacity(body.len() + DISPLAY.len());
    for l in lines(body) {
        let (k, v) = key_value(l);
        if k.eq_ignore_ascii_case(DISPLAY_KEY) {
            // Only the last setting counts in the game; keep one that shows.
            if shows(&v) && !kept {
                kept = true;
                out.extend_from_slice(l);
            }
            continue;
        }
        out.extend_from_slice(l);
    }
    if !kept {
        append(&mut out, DISPLAY);
    }
    out
}

/// `body` with both lines as the player chose them; an unanswered one is
/// left as it is.
pub(crate) fn merge(body: &[u8], choice: GameLines) -> Vec<u8> {
    let mut out = body.to_vec();
    if let Some(on) = choice.telemetry {
        out = merge_telemetry(&out, on);
    }
    if let Some(on) = choice.display_info {
        out = merge_display(&out, on);
    }
    out
}

fn choice(app: &tauri::AppHandle) -> GameLines {
    let p = load_client_prefs(app);
    GameLines { telemetry: p.game_telemetry, display_info: p.game_display_info }
}

/// Bring one game folder's user.cfg in line with the choices. A folder
/// without one gets one only when a line is to be added.
fn apply_to(app: &tauri::AppHandle, dir: &Path, choice: GameLines) -> Result<bool, String> {
    let target = crate::udi::user_cfg_path(app, dir);
    let before = std::fs::read(&target).ok();
    let adds = choice.telemetry == Some(true) || choice.display_info == Some(true);
    if before.is_none() && !adds {
        return Ok(false);
    }
    let before = before.unwrap_or_default();
    let after = merge(&before, choice);
    if after == before {
        return Ok(false);
    }
    crate::fs_atomic::write(&target, &after).map_err(|e| format!("{}: {e}", target.display()))?;
    // Still StarConfig's file, with the lines changed: so it stays recognised.
    crate::udi::rewrote_cfg(app, dir, &before, &after);
    log::info!("game lines {choice:?} written to {}", target.display());
    Ok(true)
}

/// Every game folder on this machine, made to match the choices.
pub(crate) fn apply(app: &tauri::AppHandle) {
    let choice = choice(app);
    if choice == GameLines::default() {
        return;
    }
    let mut dirs: Vec<String> = crate::game_dir::game_channels().into_iter().map(|c| c.path).collect();
    if let Some(d) = crate::game_dir::detect_game_log(app.clone()) {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    for d in dirs {
        if let Err(e) = apply_to(app, Path::new(&d), choice) {
            log::warn!("game lines not set: {e}");
        }
    }
}

#[tauri::command]
pub fn game_lines_get(app: tauri::AppHandle) -> GameLines {
    choice(&app)
}

/// Set whichever answers are given; the others stay.
#[tauri::command]
pub fn game_lines_set(app: tauri::AppHandle, telemetry: Option<bool>, display_info: Option<bool>) -> Result<GameLines, String> {
    let mut prefs = load_client_prefs(&app);
    if telemetry.is_some() {
        prefs.game_telemetry = telemetry;
    }
    if display_info.is_some() {
        prefs.game_display_info = display_info;
    }
    save_client_prefs(&app, &prefs)?;
    apply(&app);
    Ok(choice(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_telemetry_line_is_added_once_and_taken_out_again() {
        let cfg = b"g_language = english\r\nsys_MaxFPS = 60\r\n";
        let on = merge_telemetry(cfg, true);
        assert_eq!(on, b"g_language = english\r\nsys_MaxFPS = 60\r\ngrpc.client.server.enabled = 1\r\n");
        assert_eq!(merge_telemetry(&on, true), on);
        assert_eq!(merge_telemetry(&on, false), cfg);
        assert_eq!(merge_telemetry(b"GRPC.client.server.enabled=0\r\nx = 1", true), b"x = 1\r\ngrpc.client.server.enabled = 1\r\n");
    }

    #[test]
    fn the_position_text_keeps_a_players_higher_level() {
        assert_eq!(merge_display(b"r_DisplayInfo = 0\r\n", true), b"r_DisplayInfo = 1\r\n");
        assert_eq!(merge_display(b"r_DisplayInfo = 3\r\n", true), b"r_DisplayInfo = 3\r\n");
        assert_eq!(merge_display(b"a = 1\r\n", true), b"a = 1\r\nr_DisplayInfo = 1\r\n");
        // Off takes out only StarBuddy's own line.
        assert_eq!(merge_display(b"a = 1\r\nr_DisplayInfo = 1\r\n", false), b"a = 1\r\n");
        assert_eq!(merge_display(b"r_DisplayInfo = 3\r\n", false), b"r_DisplayInfo = 3\r\n");
    }

    #[test]
    fn an_unanswered_line_is_left_alone() {
        let cfg = b"r_DisplayInfo = 0\r\n";
        assert_eq!(merge(cfg, GameLines { telemetry: Some(true), display_info: None }), b"r_DisplayInfo = 0\r\ngrpc.client.server.enabled = 1\r\n");
    }
}
