//! RSI service status, fetched once for every window.
//!
//! The main window and the status overlay each used to poll the server on
//! their own timer, and the overlay kept polling while it was hidden. One task
//! here asks the paired server for /api/status every minute, keeps the latest
//! answer, and hands it to every window as an `rsi-status` event. A window
//! that opens later asks for the cached answer instead of waiting a minute.

use crate::StoredSettings;
use serde::Serialize;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

const INTERVAL: Duration = Duration::from_secs(60);
const EVENT: &str = "rsi-status";

/// What every window is told: the `rsi-status` event and `rsi_status_latest`.
#[derive(Serialize, Clone, Default)]
pub struct StatusPayload {
    pub paired: bool,
    /// The server's answer, passed through untyped: the UI owns the shape, and
    /// the server may add fields without a client release. A failed fetch
    /// keeps the last good answer, so a blip does not blank the windows.
    pub status: Option<serde_json::Value>,
    /// Why the latest fetch failed, if it did.
    pub error: Option<String>,
    /// When `status` was fetched, unix milliseconds.
    pub fetched_at: Option<u64>,
    /// The pairing the answer belongs to. A re-pair to another server must not
    /// inherit the old server's status through a failed first fetch.
    #[serde(skip)]
    token: String,
}

#[derive(Default)]
pub struct RsiStatusState {
    latest: Mutex<Option<StatusPayload>>,
    wake: Notify,
}

impl RsiStatusState {
    fn latest(&self) -> MutexGuard<'_, Option<StatusPayload>> {
        self.latest.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn paired_settings(app: &AppHandle) -> Option<StoredSettings> {
    crate::load_settings(app).filter(|s| !s.token.is_empty())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Store a payload and tell every window. The emit happens under the lock so
/// two fetches finishing together cannot reach the windows in the other order
/// from the one the cache ends up in.
fn publish(app: &AppHandle, latest: &mut Option<StatusPayload>, payload: StatusPayload) {
    let _ = app.emit(EVENT, &payload);
    *latest = Some(payload);
}

fn publish_unpaired(app: &AppHandle) {
    let state = app.state::<RsiStatusState>();
    let mut latest = state.latest();
    // Only when it changes: an unpaired client would otherwise say so every minute.
    if latest.as_ref().is_none_or(|p| p.paired) {
        publish(app, &mut latest, StatusPayload::default());
    }
}

async fn fetch(settings: &StoredSettings) -> Result<serde_json::Value, String> {
    let resp = crate::http::client()
        .get(format!("{}/api/status", settings.server_url))
        .bearer_auth(&settings.token)
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Could not reach server: {e}"))?;
    if !resp.status().is_success() {
        return Err(crate::error_body(resp).await);
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// Fetch the status for this pairing, store it and tell every window.
pub async fn fetch_and_publish(app: &AppHandle, settings: &StoredSettings) -> Result<serde_json::Value, String> {
    let result = fetch(settings).await;
    // An unpair or re-pair while the request was out has already told the
    // windows where they stand; this answer belongs to a pairing that is gone.
    if paired_settings(app).is_some_and(|s| s.token == settings.token) {
        let state = app.state::<RsiStatusState>();
        let mut latest = state.latest();
        let previous = latest.take().filter(|p| p.paired && p.token == settings.token);
        let payload = match &result {
            Ok(status) => StatusPayload {
                paired: true,
                status: Some(status.clone()),
                error: None,
                fetched_at: Some(now_ms()),
                token: settings.token.clone(),
            },
            Err(error) => {
                let previous = previous.unwrap_or_default();
                StatusPayload {
                    paired: true,
                    status: previous.status,
                    error: Some(error.clone()),
                    fetched_at: previous.fetched_at,
                    token: settings.token.clone(),
                }
            }
        };
        publish(app, &mut latest, payload);
    }
    result
}

/// Start the minute loop. It runs for the life of the app and only touches
/// the network while the client is paired.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<RsiStatusState>();
        loop {
            match paired_settings(&app) {
                Some(settings) => {
                    if let Err(e) = fetch_and_publish(&app, &settings).await {
                        log::debug!("rsi status: {e}");
                    }
                }
                None => publish_unpaired(&app),
            }
            let _ = tokio::time::timeout(INTERVAL, state.wake.notified()).await;
        }
    });
}

/// Wake the loop now rather than at the next minute, after pairing changed.
/// An unpair is told to the windows at once, without waiting for the loop.
pub fn refresh_now(app: &AppHandle) {
    if paired_settings(app).is_none() {
        publish_unpaired(app);
    }
    app.state::<RsiStatusState>().wake.notify_one();
}

/// The latest payload, for a window that has just opened.
#[tauri::command]
pub fn rsi_status_latest(app: AppHandle) -> StatusPayload {
    let cached = app.state::<RsiStatusState>().latest().clone();
    // Before the loop's first answer, all that is known is whether to expect one.
    cached.unwrap_or_else(|| StatusPayload {
        paired: paired_settings(&app).is_some(),
        ..StatusPayload::default()
    })
}
