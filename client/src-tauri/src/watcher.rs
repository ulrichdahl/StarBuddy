use serde::Serialize;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

use crate::game_dir::{load_localization, parse_line, LogEvent};
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
pub fn stop_watcher(state: tauri::State<WatcherState>) {
    if let Some(flag) = state.0.lock_or_recover().take() {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn start_watcher(
    app: tauri::AppHandle,
    state: tauri::State<WatcherState>,
    live_dir: String,
) -> Result<(), String> {
    let log_path = PathBuf::from(&live_dir).join("Game.log");
    if !log_path.is_file() {
        return Err(format!("No Game.log in {live_dir} — is the game installed there?"));
    }

    let mut guard = state.0.lock_or_recover();
    if let Some(flag) = guard.take() {
        flag.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    *guard = Some(stop.clone());
    drop(guard);

    let localization = load_localization(Path::new(&live_dir));

    tauri::async_runtime::spawn(async move {
        let mut offset = fs::metadata(&log_path).map(|m| m.len()).unwrap_or(0);
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

            let events: Vec<LogEvent> = complete
                .lines()
                .filter_map(|l| parse_line(l, &localization, "Game.log"))
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
