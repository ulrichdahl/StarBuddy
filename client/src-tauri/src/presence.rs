//! Telling the website where the player is, so org mates can see it: whether
//! the game runs, the build, the shard, the place and the ship, as the log
//! watcher reads them (game_session.rs).
//!
//! A report goes when the session changes and every minute while the game
//! runs; the server counts a player gone quiet for five minutes as not
//! playing. Off until the player switches it on; while off, one report says
//! so (the server then forgets what it had) and nothing more is sent.

use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::Manager;

use crate::game_session::{GameSession, SessionState};
use crate::pairing::load_settings;
use crate::prefs::{load_client_prefs, save_client_prefs};

const TICK: Duration = Duration::from_secs(15);
const HEARTBEAT: Duration = Duration::from_secs(60);

fn report(session: &GameSession) -> Value {
    json!({
        "share": true,
        "running": session.running,
        "environment": session.environment,
        "branch": session.branch,
        "shard": session.shard,
        "location_code": session.location_code,
        "location": session.location,
        "ship": session.ship,
        "character": session.character.as_ref().map(|c| json!({ "geid": c.geid, "name": c.name, "account_id": c.account_id })),
    })
}

async fn post(app: &tauri::AppHandle, body: &Value) -> Result<(), String> {
    let settings = load_settings(app).filter(|s| !s.token.is_empty()).ok_or("not paired")?;
    let resp = crate::http::client()
        .post(format!("{}/api/presence", settings.server_url.trim_end_matches('/')))
        .bearer_auth(&settings.token)
        .header("Accept", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    crate::pairing::note(resp.status());
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {}", resp.status()))
    }
}

pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last: Option<Value> = None;
        let mut sent_at = Instant::now();
        let mut said_off = false;
        loop {
            tokio::time::sleep(TICK).await;
            if !load_client_prefs(&app).share_presence {
                if !said_off && post(&app, &json!({ "share": false, "running": false })).await.is_ok() {
                    said_off = true;
                    last = None;
                }
                continue;
            }
            said_off = false;
            let Some(session) = app.try_state::<SessionState>().map(|s| s.current()) else { continue };
            // Nothing known yet: no log read, nothing to tell.
            if session.environment.is_none() && session.location.is_none() {
                continue;
            }
            let body = report(&session);
            let changed = last.as_ref() != Some(&body);
            if changed || (session.running && sent_at.elapsed() >= HEARTBEAT) {
                match post(&app, &body).await {
                    Ok(()) => {
                        last = Some(body);
                        sent_at = Instant::now();
                    }
                    Err(e) => log::debug!("presence not sent: {e}"),
                }
            }
        }
    });
}

#[tauri::command]
pub fn presence_sharing_get(app: tauri::AppHandle) -> bool {
    load_client_prefs(&app).share_presence
}

#[tauri::command]
pub fn presence_sharing_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut prefs = load_client_prefs(&app);
    prefs.share_presence = enabled;
    save_client_prefs(&app, &prefs)
}
