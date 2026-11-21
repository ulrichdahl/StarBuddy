//! Whether this player may send training captures.
//!
//! Scan training is for testers only: the server answers every
//! `/api/training/*` call with 403 `tester_only` for anyone else, and says
//! which one the player is in `is_tester` on `GET /api/me`. The flag comes from
//! the player's Discord roles, which the server reads at web sign-in, so it
//! changes rarely and asking at start, after pairing and once an hour is
//! plenty. Until the server has answered it reads as false: the training
//! screens stay hidden rather than flash up and vanish.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

static IS_TESTER: AtomicBool = AtomicBool::new(false);

/// The last answer the server gave, false until it has given one.
pub fn is_tester() -> bool {
    IS_TESTER.load(Ordering::Relaxed)
}

/// Record a new value and tell the windows when it changed.
pub fn set(app: &AppHandle, value: bool) {
    if IS_TESTER.swap(value, Ordering::Relaxed) != value {
        log::info!("scan training {}", if value { "available (tester)" } else { "hidden (not a tester)" });
        let _ = app.emit("tester-changed", value);
    }
}

/// Whether a failed training call was the server saying "testers only".
pub fn is_tester_only(status: reqwest::StatusCode, body: &serde_json::Value) -> bool {
    status == reqwest::StatusCode::FORBIDDEN && body.get("code").and_then(|c| c.as_str()) == Some("tester_only")
}

/// Ask the server once. An unpaired client is not a tester; a server that
/// cannot be reached leaves the last answer as it was.
pub async fn refresh(app: &AppHandle) {
    let Some(settings) = crate::load_settings(app) else {
        set(app, false);
        return;
    };
    let resp = crate::http::client()
        .get(format!("{}/api/me", settings.server_url.trim_end_matches('/')))
        .bearer_auth(&settings.token)
        .header("Accept", "application/json")
        .send()
        .await;
    match resp {
        Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await {
            Ok(me) => set(app, me.get("is_tester").and_then(|v| v.as_bool()).unwrap_or(false)),
            Err(e) => log::debug!("tester check: unreadable /api/me: {e}"),
        },
        // A revoked token: whoever this is, they cannot upload.
        Ok(resp) if resp.status() == reqwest::StatusCode::UNAUTHORIZED => set(app, false),
        Ok(resp) => log::debug!("tester check: /api/me said {}", resp.status()),
        Err(e) => log::debug!("tester check: {e}"),
    }
}

/// Ask now without waiting for the answer.
pub fn refresh_soon(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { refresh(&app).await });
}

/// Ask at start and then once an hour, for a role granted or taken away while
/// the client runs (it shows once the player signs in on the website again).
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            refresh(&app).await;
            tokio::time::sleep(Duration::from_secs(3600)).await;
        }
    });
}

/// For the settings page: the current answer, and a fresh ask behind it so a
/// page opened after signing in on the website again picks up the change.
#[tauri::command]
pub fn tester_status(app: AppHandle) -> bool {
    refresh_soon(&app);
    is_tester()
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::StatusCode;

    #[test]
    fn only_a_403_tester_only_hides_training() {
        let code = |c: &str| serde_json::json!({ "code": c, "message": "x" });
        assert!(is_tester_only(StatusCode::FORBIDDEN, &code("tester_only")));
        assert!(!is_tester_only(StatusCode::FORBIDDEN, &code("other")));
        assert!(!is_tester_only(StatusCode::FORBIDDEN, &serde_json::Value::Null));
        assert!(!is_tester_only(StatusCode::UNPROCESSABLE_ENTITY, &code("tester_only")));
    }
}
