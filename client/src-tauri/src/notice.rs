//! A message the status window shows for a while instead of the server
//! status: today, that a new game build is patched in and the language file
//! is ready, so the game can be started.
//!
//! The window is opened for it if it was closed, and put back the way it was
//! once the message has had its time or the player dismissed it. A system
//! notification goes with it, for a player whose eyes are on the launcher.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

/// How long the message stays before the window goes back to normal.
const SHOW_FOR: Duration = Duration::from_secs(90);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Notice {
    /// "ok" when the game is safe to start, "warn" when something did not work.
    pub kind: &'static str,
    /// Which message, for the window to word in the player's language.
    pub code: &'static str,
    /// The game version, e.g. "4.10.201.48085".
    pub version: String,
    /// Why it went wrong, for a "warn".
    pub detail: Option<String>,
    /// Counts up per notice, so dismissing an old one cannot end a new one.
    pub id: u64,
}

struct Current {
    notice: Option<Notice>,
    /// The status window was closed and was opened for this notice.
    opened_it: bool,
    next_id: u64,
}

static CURRENT: Mutex<Current> = Mutex::new(Current { notice: None, opened_it: false, next_id: 1 });

/// Show a notice: in the status window, opened for it if need be, and as a
/// system notification.
pub fn show(app: &AppHandle, kind: &'static str, code: &'static str, version: String, detail: Option<String>, os_title: &str, os_body: &str) {
    let id = {
        let mut c = CURRENT.lock().unwrap_or_else(|e| e.into_inner());
        let id = c.next_id;
        c.next_id += 1;
        c.notice = Some(Notice { kind, code, version, detail, id });
        id
    };
    let _ = app.emit("status-notice", current());
    if let Err(e) = app.notification().builder().title(os_title).body(os_body).show() {
        log::debug!("system notification not shown: {e}");
    }

    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if !crate::overlay::is_showing(&app2, crate::overlay::STATUS) {
            match crate::overlay::toggle(&app2, crate::overlay::STATUS) {
                Ok(_) => CURRENT.lock().unwrap_or_else(|e| e.into_inner()).opened_it = true,
                Err(e) => log::warn!("status window not opened for the notice: {e}"),
            }
        }
    });

    let app3 = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SHOW_FOR).await;
        end(&app3, id);
    });
}

/// The notice showing now, if any.
pub fn current() -> Option<Notice> {
    CURRENT.lock().unwrap_or_else(|e| e.into_inner()).notice.clone()
}

/// End notice `id` if it is still the one showing: back to the server
/// status, and the window closed again if it was opened for the notice.
fn end(app: &AppHandle, id: u64) {
    let close = {
        let mut c = CURRENT.lock().unwrap_or_else(|e| e.into_inner());
        if c.notice.as_ref().map(|n| n.id) != Some(id) {
            return;
        }
        c.notice = None;
        std::mem::take(&mut c.opened_it)
    };
    let _ = app.emit("status-notice", None::<Notice>);
    if close {
        let app2 = app.clone();
        let _ = app.run_on_main_thread(move || {
            if crate::overlay::is_showing(&app2, crate::overlay::STATUS) {
                if let Err(e) = crate::overlay::toggle(&app2, crate::overlay::STATUS) {
                    log::warn!("status window not closed after the notice: {e}");
                }
            }
        });
    }
}

#[tauri::command]
pub fn status_notice() -> Option<Notice> {
    current()
}

/// The player has read it.
#[tauri::command]
pub fn status_notice_dismiss(app: AppHandle, id: u64) {
    end(&app, id);
}

static LOCALE: Mutex<String> = Mutex::new(String::new());

/// The language the windows show, for wording system notifications.
#[tauri::command]
pub fn ui_locale(locale: String) {
    *LOCALE.lock().unwrap_or_else(|e| e.into_inner()) = locale;
}

/// Danish when the windows are Danish, English otherwise.
pub fn danish() -> bool {
    LOCALE.lock().unwrap_or_else(|e| e.into_inner()).as_str() == "da"
}
