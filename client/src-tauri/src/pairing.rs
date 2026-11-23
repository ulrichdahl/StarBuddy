use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use crate::game_dir::{Character, LogEvent};
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
    /// The server answered 401 to this device's token: the account was
    /// deleted or the device removed on the website. The client counts as
    /// unpaired until it signs in again.
    pub rejected: bool,
}

/// Set when the server refuses the device token, cleared by any answer it
/// accepts and by pairing again. Held in memory: after a restart the first
/// call to the server finds out again.
static REJECTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Lets [`note`] tell the window when the server stops (or starts again)
/// accepting this device.
pub(crate) fn init(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
}

/// Every call to the paired server reports its answer here. A 401 means the
/// token is gone on the server (account deleted, device removed); the window
/// is told once, so it can ask the player to sign in again.
pub(crate) fn note(status: reqwest::StatusCode) {
    use std::sync::atomic::Ordering;
    let rejected = status == reqwest::StatusCode::UNAUTHORIZED;
    if !rejected && !status.is_success() {
        return;
    }
    if REJECTED.swap(rejected, Ordering::SeqCst) == rejected {
        return;
    }
    if rejected {
        log::warn!("the server no longer accepts this device's token; sign in again");
    } else {
        log::info!("the server accepts this device again");
    }
    if let Some(app) = APP.get() {
        use tauri::Emitter;
        let _ = app.emit("connection-changed", view(load_settings(app).as_ref()));
    }
}

/// A new pairing: whatever the old token was, this one has not been refused.
fn accepted() {
    REJECTED.store(false, std::sync::atomic::Ordering::SeqCst);
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
        Some(s) if !s.token.is_empty() => {
            let rejected = REJECTED.load(std::sync::atomic::Ordering::SeqCst);
            ConnectionView { paired: !rejected, server_url: s.server_url.clone(), user_name: s.user_name.clone(), rejected }
        }
        _ => ConnectionView { paired: false, server_url: String::new(), user_name: String::new(), rejected: false },
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
    accepted();
    rsi_status::refresh_now(&app);
    crate::tester::set(&app, false);
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
    let device_name = device_name();

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
    paired_with(&app, base, pair.token, pair.user.name)
}

/// Keep the token the server handed out, and tell the rest of the client.
fn paired_with(app: &tauri::AppHandle, server_url: String, token: String, user_name: String) -> Result<ConnectionView, String> {
    let settings = StoredSettings { server_url, token, user_name };
    fs_atomic::write(
        &settings_path(app)?,
        &serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    accepted();
    rsi_status::refresh_now(app);
    crate::tester::refresh_soon(app);
    Ok(view(Some(&settings)))
}

fn device_name() -> String {
    hostname::get().map(|h| h.to_string_lossy().into_owned()).unwrap_or_else(|_| "desktop".into())
}

// ── Sign in with the browser (RFC 8628 device flow) ────────────────────────
//
// The client asks the server for a pair of codes, opens the website's /pair
// page with the short one, and polls with the long one until the player
// approves or denies it there. The long one (device_code) is the secret: it
// lives in this task's memory only, travels in a POST body only, and is
// never logged or put in a URL. The short one is shown to the player so they
// can check the page asks about this machine.

/// Which sign-in is the current one. Starting again or cancelling moves it
/// on, and a poll loop that finds itself outdated stops without a word.
#[derive(Default)]
pub struct BrowserFlow(std::sync::atomic::AtomicU64);

/// What the window shows while signing in.
#[derive(Serialize, Clone)]
pub struct BrowserStart {
    pub user_code: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
}

/// How the sign-in ended, sent as `pair-browser`.
#[derive(Serialize, Clone)]
pub struct BrowserOutcome {
    /// "done", "denied", "expired" or "error".
    pub state: &'static str,
    pub message: Option<String>,
    pub connection: Option<ConnectionView>,
}

#[tauri::command]
pub async fn pair_browser_start(app: tauri::AppHandle, server_url: String) -> Result<BrowserStart, String> {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    use tauri_plugin_opener::OpenerExt;

    let base = server_url.trim().trim_end_matches('/').to_string();
    if !base.starts_with("https://") && !base.starts_with("http://") {
        return Err("The server address starts with https://".into());
    }
    let resp = http::client()
        .post(format!("{base}/api/devices/authorize"))
        .json(&serde_json::json!({ "device_name": device_name() }))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Could not reach server: {e}"))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("This server does not offer browser sign-in yet. Use a pairing code instead.".into());
    }
    if !resp.status().is_success() {
        return Err(error_body(resp).await);
    }

    #[derive(Deserialize)]
    struct Authorize {
        device_code: String,
        user_code: String,
        verification_uri_complete: String,
        expires_in: u64,
        interval: u64,
    }
    let auth: Authorize = resp.json().await.map_err(|e| e.to_string())?;
    // The page the player approves on is built here, on the address the
    // player gave, rather than taken from the answer: a server names itself
    // by its own configured address, which behind a proxy or on a dev box is
    // not the one this machine reaches it by, and the browser must never be
    // sent to another site. The short code is letters, digits and a dash.
    if auth.user_code.is_empty() || !auth.user_code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("The server sent a sign-in code that could not be read.".into());
    }
    let page = format!("{base}/pair?code={}", auth.user_code);
    if !auth.verification_uri_complete.ends_with(&format!("/pair?code={}", auth.user_code)) {
        log::info!("browser sign-in: the server names its page differently; using {base}/pair");
    }

    let flow = app.state::<BrowserFlow>().0.fetch_add(1, Ordering::SeqCst) + 1;
    if let Err(e) = app.opener().open_url(&page, None::<&str>) {
        // The window shows the address too, so the player can open it by hand.
        log::warn!("browser sign-in: the browser did not open: {e}");
    }
    log::info!("browser sign-in started");

    let start = BrowserStart {
        user_code: auth.user_code,
        verification_uri_complete: page,
        expires_in: auth.expires_in,
    };
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = poll(&app2, flow, &base, auth.device_code, auth.interval, auth.expires_in).await;
        if let Some(outcome) = outcome {
            log::info!("browser sign-in: {}", outcome.state);
            let _ = app2.emit("pair-browser", &outcome);
        }
    });
    Ok(start)
}

#[tauri::command]
pub fn pair_browser_cancel(app: tauri::AppHandle) {
    app.state::<BrowserFlow>().0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
}

/// Ask until the player answers, the codes expire, or this sign-in is
/// replaced. `None` means it was replaced or cancelled: nothing to say.
async fn poll(app: &tauri::AppHandle, flow: u64, base: &str, device_code: String, interval: u64, expires_in: u64) -> Option<BrowserOutcome> {
    use std::sync::atomic::Ordering;
    let current = || app.state::<BrowserFlow>().0.load(Ordering::SeqCst) == flow;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(expires_in.max(30));
    let mut wait = interval.clamp(1, 30);
    let end = |state, message: Option<String>| Some(BrowserOutcome { state, message, connection: None });

    #[derive(Deserialize)]
    struct Token {
        token: String,
        user: TokenUser,
    }
    #[derive(Deserialize)]
    struct TokenUser {
        name: String,
    }
    #[derive(Deserialize)]
    struct Refusal {
        error: String,
    }

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
        if !current() {
            return None;
        }
        if std::time::Instant::now() > deadline {
            return end("expired", None);
        }
        let resp = match http::client()
            .post(format!("{base}/api/devices/token"))
            .json(&serde_json::json!({ "device_code": device_code }))
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(resp) => resp,
            // A dropped connection is not an answer: ask again next round.
            Err(e) => {
                log::debug!("browser sign-in: no answer this round ({})", e.without_url());
                continue;
            }
        };
        let status = resp.status();
        if status.is_success() {
            let Ok(token) = resp.json::<Token>().await else {
                return end("error", Some("The server's answer could not be read.".into()));
            };
            if !current() {
                return None;
            }
            return Some(match paired_with(app, base.to_string(), token.token, token.user.name) {
                Ok(connection) => BrowserOutcome { state: "done", message: None, connection: Some(connection) },
                Err(e) => BrowserOutcome { state: "error", message: Some(e), connection: None },
            });
        }
        match resp.json::<Refusal>().await.map(|r| r.error).unwrap_or_default().as_str() {
            "authorization_pending" => {}
            "slow_down" => wait += 2,
            "access_denied" => return end("denied", None),
            "expired_token" => return end("expired", None),
            // Throttled: wait longer and keep going.
            _ if status == reqwest::StatusCode::TOO_MANY_REQUESTS => wait += 2,
            _ if status.is_server_error() => {}
            other => return end("error", Some(format!("Server said {status}: {other}"))),
        }
    }
}

/// A post the server did not take: what to tell the player, and the HTTP
/// status it answered with (`None` when no answer arrived), which decides
/// whether the watcher's outbox tries again.
pub(crate) struct PostError {
    pub message: String,
    pub status: Option<u16>,
}

/// Completed missions go in a request of their own, after the rest, and
/// travel in one after that.
///
/// A server from before missions were counted checks every event's kind and
/// refuses the whole request over one it does not know — and a refused request
/// is dropped by the outbox, so a mission riding with a blueprint would have
/// lost the blueprint too. Sent apart, an older server refuses only the
/// missions, which it has no use for, and everything else lands as before.
/// Travel kinds are newer still, and go the same way.
///
/// Each request also names the character logged in when its events happened,
/// so a backlog spanning two characters goes as one request per character.
pub(crate) async fn post_events(settings: &StoredSettings, events: &[LogEvent]) -> Result<SyncSummary, PostError> {
    use crate::game_dir::{MISSION_COMPLETED, TRAVEL_KINDS};
    let class = |e: &LogEvent| {
        if e.kind == MISSION_COMPLETED {
            1
        } else if TRAVEL_KINDS.contains(&e.kind.as_str()) {
            2
        } else {
            0
        }
    };
    let mut summary = SyncSummary::default();
    for wanted in 0..3 {
        let of_class: Vec<&LogEvent> = events.iter().filter(|e| class(e) == wanted).collect();
        let mut characters: Vec<Option<&Character>> = Vec::new();
        for e in &of_class {
            if !characters.contains(&e.character.as_ref()) {
                characters.push(e.character.as_ref());
            }
        }
        for character in characters {
            let batch: Vec<&LogEvent> = of_class.iter().copied().filter(|e| e.character.as_ref() == character).collect();
            match post_batch(settings, &batch, character).await {
                Ok(more) => summary.add(&more),
                Err(e) if wanted > 0 && crate::outbox::disposition(e.status) == crate::outbox::Disposition::Drop => {
                    let what = if wanted == 1 { "completed missions" } else { "travel" };
                    log::info!("the server does not take {what} ({}); {} not sent", e.message, batch.len());
                }
                Err(e) => return Err(e),
            }
        }
    }
    Ok(summary)
}

async fn post_batch(settings: &StoredSettings, events: &[&LogEvent], character: Option<&Character>) -> Result<SyncSummary, PostError> {
    let payload: Vec<_> = events
        .iter()
        .map(|e| {
            let mut event = serde_json::json!({
                "kind": e.kind,
                "timestamp": e.timestamp,
                "detail": e.detail,
                "item_class": e.item_class,
            });
            // Only what there is: an older server checks every field it is sent.
            for (key, value) in [
                ("raw", &e.raw),
                ("mission_id", &e.mission_id),
                ("ship_id", &e.ship_id),
                ("raw_selected", &e.raw_selected),
            ] {
                if let Some(value) = value {
                    event[key] = serde_json::json!(value);
                }
            }
            event
        })
        .collect();
    let mut body = serde_json::json!({ "events": payload });
    if let Some(c) = character {
        body["character"] = serde_json::json!({ "geid": c.geid, "name": c.name, "account_id": c.account_id });
    }

    let resp = http::client()
        .post(format!("{}/api/ingest/events", settings.server_url))
        .bearer_auth(&settings.token)
        .header("Accept", "application/json")
        .json(&body)
        // A backlog sync sends every event the scan found in one request, and
        // the server works through them before it answers.
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| PostError { message: format!("Could not reach server: {e}"), status: None })?;
    note(resp.status());

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
    /// Travel events counted, and the points scored; absent from older servers.
    pub travel: usize,
    pub points: u64,
    /// Blueprints whose item class the server filled in after the fact.
    pub backfilled: usize,
}

impl SyncSummary {
    fn add(&mut self, other: &SyncSummary) {
        self.accepted += other.accepted;
        self.duplicates += other.duplicates;
        self.blueprints_added += other.blueprints_added;
        self.refinery_completed += other.refinery_completed;
        self.missions_completed += other.missions_completed;
        self.travel += other.travel;
        self.points += other.points;
        self.backfilled += other.backfilled;
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
