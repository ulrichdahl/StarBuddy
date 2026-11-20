use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use crate::game_dir::LogEvent;
use crate::{fs_atomic, http, rsi_status};

// ── Server connection ──────────────────────────────────────────────────────
// The device token lives only in the client's config file; the UI never
// sees it — it only sees whether the client is paired and as whom.

#[derive(Serialize, Deserialize, Clone, Default)]
pub(crate) struct StoredSettings {
    pub(crate) server_url: String,
    pub(crate) token: String,
    pub(crate) user_name: String,
}

#[derive(Serialize, Clone)]
pub struct ConnectionView {
    pub paired: bool,
    pub server_url: String,
    pub user_name: String,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub(crate) fn load_settings(app: &tauri::AppHandle) -> Option<StoredSettings> {
    fs_atomic::read_json(&settings_path(app).ok()?)
}

fn view(settings: Option<&StoredSettings>) -> ConnectionView {
    match settings {
        Some(s) if !s.token.is_empty() => ConnectionView {
            paired: true,
            server_url: s.server_url.clone(),
            user_name: s.user_name.clone(),
        },
        _ => ConnectionView {
            paired: false,
            server_url: String::new(),
            user_name: String::new(),
        },
    }
}

#[tauri::command]
pub fn get_connection(app: tauri::AppHandle) -> ConnectionView {
    view(load_settings(&app).as_ref())
}

#[tauri::command]
pub fn unpair(app: tauri::AppHandle) -> Result<ConnectionView, String> {
    let path = settings_path(&app)?;
    let _ = fs::remove_file(path);
    rsi_status::refresh_now(&app);
    Ok(view(None))
}

/// The server's own account of what it refused, field by field.
///
/// Laravel names a rejected field by its path in the body — "materials.0.quality"
/// — which is exactly enough to point at the row and the cell in the window
/// rather than showing a sentence about a row nobody can find.
pub(crate) async fn error_fields(resp: reqwest::Response) -> (String, std::collections::BTreeMap<String, String>) {
    let status = resp.status();
    let body = resp.json::<serde_json::Value>().await.ok();
    let message = body
        .as_ref()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_default();
    let fields = body
        .as_ref()
        .and_then(|v| v.get("errors").and_then(|e| e.as_object()))
        .map(|errors| {
            errors
                .iter()
                .filter_map(|(field, messages)| {
                    let first = match messages {
                        serde_json::Value::Array(list) => list.first().and_then(|m| m.as_str()),
                        other => other.as_str(),
                    }?;
                    Some((field.clone(), first.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    (format!("Server said {status}: {message}"), fields)
}

pub(crate) async fn error_body(resp: reqwest::Response) -> String {
    let status = resp.status();
    let msg = resp
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or_default();
    format!("Server said {status}: {msg}")
}

#[tauri::command]
pub async fn pair_device(
    app: tauri::AppHandle,
    server_url: String,
    code: String,
) -> Result<ConnectionView, String> {
    let base = server_url.trim().trim_end_matches('/').to_string();
    let device_name = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "desktop".into());

    let resp = http::client()
        .post(format!("{base}/api/devices/pair"))
        .json(&serde_json::json!({ "code": code.trim(), "device_name": device_name }))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Could not reach server: {e}"))?;

    if !resp.status().is_success() {
        return Err(error_body(resp).await);
    }

    #[derive(Deserialize)]
    struct PairResponse {
        token: String,
        user: PairUser,
    }
    #[derive(Deserialize)]
    struct PairUser {
        name: String,
    }

    let pair: PairResponse = resp.json().await.map_err(|e| e.to_string())?;
    let settings = StoredSettings {
        server_url: base,
        token: pair.token,
        user_name: pair.user.name,
    };
    fs_atomic::write(
        &settings_path(&app)?,
        &serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    rsi_status::refresh_now(&app);

    Ok(view(Some(&settings)))
}

/// A post the server did not take: what to tell the player, and the HTTP
/// status it answered with (`None` when no answer arrived), which decides
/// whether the watcher's outbox tries again.
pub(crate) struct PostError {
    pub message: String,
    pub status: Option<u16>,
}

/// Completed missions go in a request of their own, after the rest.
///
/// A server from before missions were counted checks every event's kind and
/// refuses the whole request over one it does not know — and a refused request
/// is dropped by the outbox, so a mission riding with a blueprint would have
/// lost the blueprint too. Sent apart, an older server refuses only the
/// missions, which it has no use for, and everything else lands as before.
pub(crate) async fn post_events(settings: &StoredSettings, events: &[LogEvent]) -> Result<SyncSummary, PostError> {
    let (missions, rest): (Vec<LogEvent>, Vec<LogEvent>) =
        events.iter().cloned().partition(|e| e.kind == crate::game_dir::MISSION_COMPLETED);
    let mut summary = if rest.is_empty() { SyncSummary::default() } else { post_batch(settings, &rest).await? };
    if !missions.is_empty() {
        match post_batch(settings, &missions).await {
            Ok(more) => summary.add(&more),
            Err(e) if crate::outbox::disposition(e.status) == crate::outbox::Disposition::Drop => {
                log::info!("the server does not take completed missions ({}); {} not sent", e.message, missions.len());
            }
            Err(e) => return Err(e),
        }
    }
    Ok(summary)
}

async fn post_batch(settings: &StoredSettings, events: &[LogEvent]) -> Result<SyncSummary, PostError> {
    let payload: Vec<_> = events
        .iter()
        .map(|e| {
            serde_json::json!({
                "kind": e.kind,
                "timestamp": e.timestamp,
                "detail": e.detail,
                "item_class": e.item_class,
            })
        })
        .collect();

    let resp = http::client()
        .post(format!("{}/api/ingest/events", settings.server_url))
        .bearer_auth(&settings.token)
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "events": payload }))
        // A backlog sync sends every event the scan found in one request, and
        // the server works through them before it answers.
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| PostError { message: format!("Could not reach server: {e}"), status: None })?;

    let status = resp.status().as_u16();
    if !resp.status().is_success() {
        return Err(PostError { message: error_body(resp).await, status: Some(status) });
    }

    resp.json().await.map_err(|e| PostError { message: e.to_string(), status: Some(status) })
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SyncSummary {
    pub accepted: usize,
    pub duplicates: usize,
    pub blueprints_added: usize,
    pub refinery_completed: usize,
    /// Absent from a server that does not count missions.
    pub missions_completed: usize,
}

impl SyncSummary {
    fn add(&mut self, other: &SyncSummary) {
        self.accepted += other.accepted;
        self.duplicates += other.duplicates;
        self.blueprints_added += other.blueprints_added;
        self.refinery_completed += other.refinery_completed;
        self.missions_completed += other.missions_completed;
    }
}

#[tauri::command]
pub async fn sync_events(app: tauri::AppHandle, events: Vec<LogEvent>) -> Result<SyncSummary, String> {
    let settings = load_settings(&app).ok_or("Not paired with a server yet.")?;
    post_events(&settings, &events).await.map_err(|e| e.message)
}

/// RSI service status as mirrored by the paired server (GET /api/status),
/// on demand. The background loop in rsi_status fetches it anyway; this is a
/// manual refresh, and its answer reaches every window like the loop's does.
#[tauri::command]
pub async fn fetch_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let settings = load_settings(&app)
        .filter(|s| !s.token.is_empty())
        .ok_or("Not paired with a server yet.")?;
    rsi_status::fetch_and_publish(&app, &settings).await
}
