//! EXPERIMENT: a record of what the location reader saw, for working out
//! what happens on a jump between systems or a hand-over between game servers.
//!
//! Into `<app data>/location-log/`:
//! * `YYYY-MM-DD.jsonl`: one line per read whose text changed — the raw
//!   lines, what was made of them, the speed, and how long the read took.
//! * `<unix ms>-<why>.png`: the corner itself, when the system zone, the
//!   server, the location or the set of zones changed, when nothing could be
//!   read from text that was there, and once a minute anyway. These are what
//!   new glyph shapes are trained from.

use super::parse::Fix;
use crate::lock::LockExt;
use crate::scan::Captured;
use serde_json::json;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const PICTURE_EVERY: Duration = Duration::from_secs(60);

#[derive(Default)]
struct Recorder {
    lines: Vec<String>,
    key: Option<String>,
    picture_at: Option<Instant>,
}

static RECORDER: LazyLock<Mutex<Recorder>> = LazyLock::new(Mutex::default);

pub fn dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("location-log");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn unix_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn append(app: &AppHandle, value: serde_json::Value) {
    let Some(dir) = dir(app) else { return };
    let day = chrono_day();
    let path = dir.join(format!("{day}.jsonl"));
    let result = std::fs::OpenOptions::new().create(true).append(true).open(&path).and_then(|mut f| writeln!(f, "{value}"));
    if let Err(e) = result {
        log::debug!("location log: {e}");
    }
}

/// Today in UTC as YYYY-MM-DD, without a date library.
fn chrono_day() -> String {
    let days = (unix_ms() / 86_400_000) as i64;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

fn save_picture(app: &AppHandle, cap: &Captured, why: &str) {
    let Some(dir) = dir(app) else { return };
    let path = dir.join(format!("{}-{why}.png", unix_ms()));
    match image::RgbImage::from_raw(cap.width, cap.height, cap.rgb.clone()) {
        Some(img) => {
            if let Err(e) = img.save(&path) {
                log::debug!("location picture: {e}");
            }
        }
        None => log::debug!("location picture: bad buffer"),
    }
}

/// One read.
pub fn record(app: &AppHandle, cap: &Captured, fix: &Fix, lines: &[String], ms: f64, speed: Option<f64>, held: bool) {
    let mut rec = RECORDER.lock_or_recover();
    if rec.lines.as_slice() != lines {
        rec.lines = lines.to_vec();
        append(
            app,
            json!({ "t": unix_ms() as u64, "ms": (ms * 10.0).round() / 10.0, "speed": speed, "held": held, "fix": fix, "lines": lines }),
        );
    }

    let key = (!fix.zones.is_empty()).then(|| {
        let zones: Vec<&str> = fix.zones.iter().map(|z| z.name.as_str()).collect();
        format!("{}|{}|{}", zones.join(","), fix.server.as_deref().unwrap_or(""), fix.location.as_deref().unwrap_or(""))
    });
    let due = rec.picture_at.is_none_or(|at| at.elapsed() >= PICTURE_EVERY);
    let why = match &key {
        Some(k) if rec.key.as_ref() != Some(k) => Some("change"),
        None if !lines.is_empty() && due => Some("unread"),
        _ if due => Some("minute"),
        _ => None,
    };
    if key.is_some() {
        rec.key = key;
    }
    if let Some(why) = why {
        rec.picture_at = Some(Instant::now());
        drop(rec);
        save_picture(app, cap, why);
    }
}

/// Something the player did, such as setting a beacon.
pub fn note(app: &AppHandle, event: &str, detail: serde_json::Value) {
    append(app, json!({ "t": unix_ms() as u64, "event": event, "detail": detail }));
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_day_is_named_the_usual_way() {
        let d = super::chrono_day();
        assert_eq!(d.len(), 10);
        assert!(d.starts_with("20"));
    }
}
