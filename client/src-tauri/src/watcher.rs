use serde::Serialize;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

use crate::game_dir::{load_localization, LogEvent, LogParser};
use crate::game_session::{self, SessionState};
use crate::prefs::{load_client_prefs, save_client_prefs};
use crate::lock::LockExt;
use crate::outbox;
use crate::pairing::{load_settings, post_events};

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
pub fn watcher_status(state: tauri::State<WatcherState>) -> bool {
    state.0.lock_or_recover().as_ref().is_some_and(|f| !f.load(Ordering::Relaxed))
}

#[tauri::command]
pub fn stop_watcher(app: tauri::AppHandle, state: tauri::State<WatcherState>) {
    if let Some(flag) = state.0.lock_or_recover().take() {
        flag.store(true, Ordering::Relaxed);
    }
    // Switched off by the player: it stays off at the next start too.
    set_off(&app, true);
}

#[tauri::command]
pub fn start_watcher(app: tauri::AppHandle, live_dir: String) -> Result<(), String> {
    start(&app, &live_dir)?;
    set_off(&app, false);
    Ok(())
}

fn set_off(app: &tauri::AppHandle, off: bool) {
    let mut prefs = load_client_prefs(app);
    if prefs.log_watch_off != off {
        prefs.log_watch_off = off;
        if let Err(e) = save_client_prefs(app, &prefs) {
            log::warn!("could not keep the log watcher's switch: {e}");
        }
    }
}

/// Whether the watcher is following a log now.
pub(crate) fn running(app: &tauri::AppHandle) -> bool {
    app.try_state::<WatcherState>()
        .is_some_and(|s| s.0.lock_or_recover().as_ref().is_some_and(|f| !f.load(Ordering::Relaxed)))
}

/// Follow Game.log from the start, unless the player switched that off: a
/// found game folder is watched without being asked.
pub fn start_at_launch(app: &tauri::AppHandle) {
    if load_client_prefs(app).log_watch_off {
        log::info!("log watcher left off, as the player switched it");
        return;
    }
    let Some(dir) = crate::game_dir::detect_game_log(app.clone()) else { return };
    match start(app, &dir) {
        Ok(()) => log::info!("watching {dir}/Game.log"),
        Err(e) => log::info!("log watcher not started: {e}"),
    }
}

/// Follow `live_dir`'s Game.log, in place of whatever was followed before.
pub(crate) fn start(app: &tauri::AppHandle, live_dir: &str) -> Result<(), String> {
    let app = app.clone();
    let log_path = PathBuf::from(live_dir).join("Game.log");
    if !log_path.is_file() {
        return Err(format!("No Game.log in {live_dir} — is the game installed there?"));
    }

    let stop = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<WatcherState>();
        let mut guard = state.0.lock_or_recover();
        if let Some(flag) = guard.replace(stop.clone()) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    // What the log has said so far: the build, where the player was. Read
    // once, whole; from here on only what is added.
    let live = PathBuf::from(live_dir);
    let localization = load_localization(Path::new(live_dir));
    let bytes = fs::read(&log_path).unwrap_or_default();
    let start_offset = bytes.len() as u64;
    let text = String::from_utf8_lossy(&bytes);
    if let Some(sessions) = app.try_state::<SessionState>() {
        game_session::emit(&app, &sessions.reset(&live, &text));
    }
    // What came before is the backlog scan's to send; read here only so the
    // parser knows who is logged in and where their ship was routed.
    let mut parser = LogParser::default();
    for line in text.lines() {
        parser.feed(line, &localization, "Game.log");
    }
    drop(text);
    drop(bytes);

    tauri::async_runtime::spawn(async move {
        let mut offset = start_offset;
        let mut carry = String::new();
        // Events the server did not take wait in the outbox; these say when
        // to try it again.
        let mut retry_at: Option<std::time::Instant> = None;
        let mut retry_delay: Option<std::time::Duration> = None;

        let _ = app.emit("watcher-status", WatcherStatus {
            running: true,
            log_path: log_path.to_string_lossy().into_owned(),
        });

        while !stop.load(Ordering::Relaxed) {
            tokio_sleep().await;

            let waiting = app.try_state::<outbox::OutboxState>().is_some_and(|s| s.pending() > 0);
            if waiting && retry_at.is_none_or(|at| std::time::Instant::now() >= at) {
                if let Some(settings) = outbox::paired(&app) {
                    match outbox::send(&app, &settings).await {
                        outbox::Sent::Failed => {
                            let delay = outbox::next_delay(retry_delay);
                            retry_delay = Some(delay);
                            retry_at = Some(std::time::Instant::now() + delay);
                        }
                        outbox::Sent::Done => {
                            retry_delay = None;
                            retry_at = None;
                        }
                        outbox::Sent::Nothing => {}
                    }
                }
            }

            let Ok(meta) = fs::metadata(&log_path) else { continue };
            let size = meta.len();
            if size < offset {
                // Log rotated: the game restarted; read the new file fully.
                offset = 0;
                carry.clear();
                if let Some(sessions) = app.try_state::<SessionState>() {
                    game_session::emit(&app, &sessions.reset(&live, ""));
                }
                parser = LogParser::default();
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

            if let Some(sessions) = app.try_state::<SessionState>() {
                if let Some(changed) = sessions.feed(complete.lines()) {
                    game_session::emit(&app, &changed);
                }
            }

            let events: Vec<LogEvent> = complete
                .lines()
                .filter_map(|l| parser.feed(l, &localization, "Game.log"))
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
                        outbox::emit_synced(&app, &summary);
                        // The server is back: what waits goes on the next pass.
                        retry_delay = None;
                        retry_at = None;
                    }
                    Err(e) => {
                        let _ = app.emit("watcher-sync-error", &e.message);
                        match outbox::disposition(e.status) {
                            outbox::Disposition::Retry => {
                                if let Some(state) = app.try_state::<outbox::OutboxState>() {
                                    state.keep(&events);
                                }
                                if retry_at.is_none() {
                                    let delay = outbox::next_delay(None);
                                    retry_delay = Some(delay);
                                    retry_at = Some(std::time::Instant::now() + delay);
                                }
                            }
                            outbox::Disposition::Drop => {
                                log::warn!("the server refused {} new event(s), dropping them: {}", events.len(), e.message);
                            }
                        }
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
