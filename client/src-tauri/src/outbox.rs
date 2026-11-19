//! Game.log events the server has not taken yet.
//!
//! The watcher posts each batch of new events once. When that post fails —
//! the server is down, the network is out, the machine was asleep — the events
//! used to be reported and then lost; the backlog scan could only find them
//! again if the player thought to run it. Now they wait in `outbox.json` in the
//! config folder and are sent again, by the watcher with a growing pause
//! between tries and once when the client starts, until the server takes them.
//!
//! A refusal the server would repeat — it read the events and said no — is not
//! tried again: those events are dropped with a warning in the log.

use crate::lock::LockExt;
use crate::{fs_atomic, load_settings, post_events, LogEvent, StoredSettings, SyncSummary};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Most events kept; past it the oldest go. A player offline for a long
/// session gets a few dozen; this is room for a lot of very long ones.
pub(crate) const CAP: usize = 5000;
/// The pause after the first failed try, doubled after every further one…
pub(crate) const FIRST_RETRY: Duration = Duration::from_secs(30);
/// …up to this.
pub(crate) const LAST_RETRY: Duration = Duration::from_secs(10 * 60);
/// Events per request when the outbox is sent, so one the server refuses costs
/// at most this many and a long outage is not one enormous request.
const CHUNK: usize = 500;

/// What `outbox.json` holds: `{"events": [LogEvent, …]}`, oldest first.
#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
pub(crate) struct Outbox {
    pub events: Vec<LogEvent>,
}

/// The identity the server deduplicates on too.
fn key(event: &LogEvent) -> (&str, &str, &str) {
    (&event.timestamp, &event.detail, &event.kind)
}

impl Outbox {
    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// Add events not already waiting, keeping at most [`CAP`] by dropping the
    /// oldest. Returns how many were dropped for room.
    pub fn add(&mut self, events: &[LogEvent]) -> usize {
        let mut seen: HashSet<(String, String, String)> = self
            .events
            .iter()
            .map(|e| (e.timestamp.clone(), e.detail.clone(), e.kind.clone()))
            .collect();
        for event in events {
            if seen.insert((event.timestamp.clone(), event.detail.clone(), event.kind.clone())) {
                self.events.push(event.clone());
            }
        }
        let over = self.events.len().saturating_sub(CAP);
        self.events.drain(..over);
        over
    }

    /// Take out the events that were sent (or given up on).
    pub fn remove(&mut self, done: &[LogEvent]) {
        let done: HashSet<_> = done.iter().map(key).collect();
        self.events.retain(|e| !done.contains(&key(e)));
    }
}

/// What a failed post means for the events in it.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Disposition {
    /// Try again later: the server never read them, or could not cope.
    Retry,
    /// The server read them and said no; it would say no again.
    Drop,
}

/// `status` is the HTTP status the server answered with, `None` when no answer
/// arrived at all.
pub(crate) fn disposition(status: Option<u16>) -> Disposition {
    match status {
        // Not paired any more (a re-pair makes them good again), a timeout,
        // or "too many requests": all of these change with time.
        Some(401 | 403 | 408 | 429) => Disposition::Retry,
        // Validation and every other refusal of the request itself.
        Some(400..=499) => Disposition::Drop,
        // Server errors, an answer that was not understood, no answer at all.
        _ => Disposition::Retry,
    }
}

/// The pause before the next try, given the one before it.
pub(crate) fn next_delay(previous: Option<Duration>) -> Duration {
    previous.map_or(FIRST_RETRY, |d| (d * 2).min(LAST_RETRY))
}

pub(crate) struct OutboxState {
    outbox: Mutex<Outbox>,
    path: Option<PathBuf>,
    /// One send at a time: the start-up send and the watcher's may overlap.
    sending: AtomicBool,
}

impl OutboxState {
    pub fn load(app: &AppHandle) -> Self {
        let path = app.path().app_config_dir().ok().map(|d| d.join("outbox.json"));
        let outbox: Outbox = path.as_deref().and_then(fs_atomic::read_json).unwrap_or_default();
        if !outbox.is_empty() {
            log::info!("{} event(s) wait to be sent to the server", outbox.len());
        }
        Self { outbox: Mutex::new(outbox), path, sending: AtomicBool::new(false) }
    }

    pub fn pending(&self) -> usize {
        self.outbox.lock_or_recover().len()
    }

    /// Written while the lock is held, so two changes reach the disk in the
    /// order they were made.
    fn save(&self, outbox: &Outbox) {
        let Some(path) = &self.path else { return };
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let written = serde_json::to_vec(outbox)
            .map_err(std::io::Error::other)
            .and_then(|bytes| fs_atomic::write(path, &bytes));
        if let Err(e) = written {
            log::warn!("{} could not be written: {e}", path.display());
        }
    }

    /// Keep events that could not be sent.
    pub fn keep(&self, events: &[LogEvent]) {
        let mut outbox = self.outbox.lock_or_recover();
        let dropped = outbox.add(events);
        if dropped > 0 {
            log::warn!("outbox full: the {dropped} oldest unsent event(s) were dropped");
        }
        self.save(&outbox);
    }

    fn forget(&self, events: &[LogEvent]) {
        let mut outbox = self.outbox.lock_or_recover();
        outbox.remove(events);
        self.save(&outbox);
    }

    fn snapshot(&self) -> Vec<LogEvent> {
        self.outbox.lock_or_recover().events.clone()
    }
}

/// `watcher-sync`'s payload: the server's summary, and how many events still
/// wait in the outbox.
#[derive(Serialize, Clone)]
struct WatcherSync<'a> {
    #[serde(flatten)]
    summary: &'a SyncSummary,
    pending: usize,
}

pub(crate) fn emit_synced(app: &AppHandle, summary: &SyncSummary) {
    let pending = app.try_state::<OutboxState>().map(|s| s.pending()).unwrap_or(0);
    let _ = app.emit("watcher-sync", WatcherSync { summary, pending });
}

/// How a send of the outbox went.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Sent {
    /// Nothing to send, or another send is under way.
    Nothing,
    /// Everything was taken or given up on.
    Done,
    /// The server could not be reached or failed; the rest waits.
    Failed,
}

/// Send what waits, oldest first, in chunks; stop at the first failure that is
/// worth trying again.
pub(crate) async fn send(app: &AppHandle, settings: &StoredSettings) -> Sent {
    let Some(state) = app.try_state::<OutboxState>() else { return Sent::Nothing };
    if state.sending.swap(true, Ordering::AcqRel) {
        return Sent::Nothing;
    }
    let events = state.snapshot();
    let mut outcome = if events.is_empty() { Sent::Nothing } else { Sent::Done };
    for chunk in events.chunks(CHUNK) {
        match post_events(settings, chunk).await {
            Ok(summary) => {
                state.forget(chunk);
                emit_synced(app, &summary);
            }
            Err(e) => {
                let _ = app.emit("watcher-sync-error", &e.message);
                if disposition(e.status) == Disposition::Retry {
                    log::info!("{} event(s) still wait for the server: {}", state.pending(), e.message);
                    outcome = Sent::Failed;
                    break;
                }
                log::warn!("the server refused {} waiting event(s), dropping them: {}", chunk.len(), e.message);
                state.forget(chunk);
            }
        }
    }
    state.sending.store(false, Ordering::Release);
    outcome
}

/// The settings to send with, when the client is paired.
pub(crate) fn paired(app: &AppHandle) -> Option<StoredSettings> {
    load_settings(app).filter(|s| !s.token.is_empty())
}

/// One try at start-up, for events left from the last session.
pub(crate) fn send_at_start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let waiting = app.try_state::<OutboxState>().is_some_and(|s| s.pending() > 0);
        if let Some(settings) = paired(&app).filter(|_| waiting) {
            send(&app, &settings).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(timestamp: &str, detail: &str, kind: &str) -> LogEvent {
        LogEvent {
            kind: kind.into(),
            timestamp: timestamp.into(),
            detail: detail.into(),
            item_class: None,
            file: "Game.log".into(),
        }
    }

    #[test]
    fn the_same_event_waits_only_once() {
        let mut outbox = Outbox::default();
        let a = event("2026-11-19T10:00:00Z", "Arclight Pistol", "blueprint");
        let b = event("2026-11-19T10:00:00Z", "Arclight Pistol", "refinery_completed");
        let c = event("2026-11-19T10:00:01Z", "Arclight Pistol", "blueprint");
        // The log writes each notification twice (queued and displayed).
        assert_eq!(outbox.add(&[a.clone(), a.clone(), b.clone()]), 0);
        assert_eq!(outbox.add(&[a.clone(), c.clone()]), 0);
        // The file a line came from is not part of its identity.
        let mut a_elsewhere = a.clone();
        a_elsewhere.file = "Game Build(1).log".into();
        outbox.add(&[a_elsewhere]);
        assert_eq!(outbox.events, vec![a.clone(), b.clone(), c.clone()]);

        outbox.remove(&[a.clone(), c]);
        assert_eq!(outbox.events, vec![b]);
    }

    #[test]
    fn a_full_outbox_lets_the_oldest_go() {
        let mut outbox = Outbox::default();
        let first: Vec<_> = (0..CAP).map(|i| event(&format!("t{i:05}"), "x", "blueprint")).collect();
        assert_eq!(outbox.add(&first), 0);
        let more: Vec<_> = (CAP..CAP + 3).map(|i| event(&format!("t{i:05}"), "x", "blueprint")).collect();
        assert_eq!(outbox.add(&more), 3);
        assert_eq!(outbox.len(), CAP);
        assert_eq!(outbox.events.first().unwrap().timestamp, "t00003");
        assert_eq!(outbox.events.last().unwrap().timestamp, format!("t{:05}", CAP + 2));
    }

    #[test]
    fn only_a_refusal_the_server_would_repeat_is_given_up() {
        assert_eq!(disposition(None), Disposition::Retry, "no answer at all");
        assert_eq!(disposition(Some(500)), Disposition::Retry);
        assert_eq!(disposition(Some(503)), Disposition::Retry);
        assert_eq!(disposition(Some(200)), Disposition::Retry, "an answer that could not be read");
        assert_eq!(disposition(Some(401)), Disposition::Retry, "a re-pair makes them good");
        assert_eq!(disposition(Some(408)), Disposition::Retry);
        assert_eq!(disposition(Some(429)), Disposition::Retry);
        assert_eq!(disposition(Some(422)), Disposition::Drop);
        assert_eq!(disposition(Some(400)), Disposition::Drop);
        assert_eq!(disposition(Some(413)), Disposition::Drop);
    }

    #[test]
    fn the_pause_doubles_up_to_ten_minutes() {
        let mut delay = None;
        let mut seen = Vec::new();
        for _ in 0..7 {
            let d = next_delay(delay);
            seen.push(d.as_secs());
            delay = Some(d);
        }
        assert_eq!(seen, vec![30, 60, 120, 240, 480, 600, 600]);
    }

    #[test]
    fn the_file_format_round_trips() {
        let mut outbox = Outbox::default();
        outbox.add(&[event("t", "Station", "refinery_completed")]);
        let json = serde_json::to_string(&outbox).unwrap();
        assert!(json.starts_with("{\"events\":[{\"kind\":\"refinery_completed\""));
        assert_eq!(serde_json::from_str::<Outbox>(&json).unwrap(), outbox);
    }
}
