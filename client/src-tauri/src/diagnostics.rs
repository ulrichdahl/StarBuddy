use serde::Serialize;
use std::fs;
use tauri::Manager;

use crate::{analysis, capture, outbox, overlay, reading};
#[cfg(windows)]
use crate::{wgc, winkeys};

/// Where the debug log lives (Linux ~/.local/share/<id>/logs, Windows
/// %LOCALAPPDATA%\\<id>\\logs); shown in the client so testers can find it.
/// Everything a bug report needs about this machine, in one block.
///
/// Asking a player to find a log file and quote the right five lines of it is
/// asking too much, and the answers that matter — which Windows this is, which
/// capture switches it answered to, whether a hotkey has ever arrived — are
/// all things the client already knows.
#[tauri::command]
pub fn system_report(app: tauri::AppHandle) -> String {
    let mut lines = vec![
        format!(
            "StarBuddy {} {} on {} {}",
            env!("CARGO_PKG_VERSION"),
            option_env!("STARBUDDY_BUILD").unwrap_or("release"),
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    ];

    #[cfg(windows)]
    {
        lines.push(match wgc::version() {
            Some((major, minor, build)) => format!("Windows {major}.{minor} build {build}"),
            None => "Windows version unknown".into(),
        });
        lines.push(match wgc::switch_state() {
            Some((cursor, border)) => format!(
                "capture switches: cursor {}, border {} ({})",
                if cursor { "yes" } else { "no" },
                if border { "yes" } else { "no" },
                if border { "asked for no border" } else { "no switch for the border on this build" }
            ),
            None => "capture switches: not asked yet, screen reading has not run".into(),
        });
        if let Some(answer) = wgc::borderless() {
            lines.push(format!("borderless capture: {answer}"));
            if answer.starts_with("denied") {
                lines.push("  turn it on under Settings > Privacy & security > Screenshot borders".into());
                lines.push(format!("  (the answer itself is kept at {})", wgc::borderless_consent_key()));
            }
        }
        lines.push(format!("running from: {}", std::env::current_exe().unwrap_or_default().display()));
        lines.push(format!("running as administrator: {}", winkeys::elevated()));
    }
    #[cfg(target_os = "linux")]
    {
        lines.push(format!(
            "session: {}, desktop {}",
            std::env::var("XDG_SESSION_TYPE").unwrap_or_else(|_| "unknown".into()),
            std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_else(|_| "unknown".into())
        ));
    }

    let reading = reading::state(&app);
    lines.push(format!(
        "screen reading: {}, source {:?}{}",
        if reading.on { "on" } else { "off" },
        reading.source,
        reading.error.map(|e| format!(", error {e}")).unwrap_or_default()
    ));
    if let Some(frame) = capture::latest() {
        lines.push(format!("last frame: {}×{} from {}, number {}", frame.width, frame.height, frame.source, frame.seq));
    }
    lines.extend(analysis::report());

    let waiting = app.try_state::<outbox::OutboxState>().map(|s| s.pending()).unwrap_or(0);
    let hotkeys = overlay::overlay_hotkey(app);
    lines.push(format!(
        "hotkeys: {} registered, {} refused{}",
        hotkeys.live.len(),
        hotkeys.failed.len(),
        if hotkeys.desktop_owned { ", delivered by the desktop" } else { "" }
    ));
    for (action, why) in &hotkeys.failed {
        lines.push(format!("  {action} refused: {why}"));
    }
    lines.push(match overlay::heard() {
        Some((action, ago)) => format!("last key heard: {action}, {}s ago", ago.as_secs()),
        None => "last key heard: none this session".into(),
    });
    lines.push(format!("events waiting for the server: {waiting}"));
    lines.join("\n")
}

#[tauri::command]
pub fn log_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path().app_log_dir().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_log_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct AppVersion {
    pub version: String,
    /// CI build stamp ("dev-20260827-0315") for rolling builds; None for releases.
    pub build: Option<String>,
}

#[tauri::command]
pub fn app_version() -> AppVersion {
    AppVersion {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build: option_env!("STARBUDDY_BUILD").map(str::to_string),
    }
}
