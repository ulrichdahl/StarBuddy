//! Global hotkeys the compositor delivers, on desktops that will.
//!
//! An X11-style hotkey is a grab on the X server, and under Wayland the X
//! server is only handed a key while an X11 window has focus. Star Citizen
//! under a Wayland-native Wine is not one — so the keys arrive while StarBuddy
//! itself is in front and stop the moment the game is, which is the only time
//! they are any use.
//!
//! The portal's GlobalShortcuts is the way round it, and the same road the
//! screen capture already takes: the shortcuts are registered with the desktop,
//! the compositor delivers them whoever has focus, and they appear in the
//! desktop's own shortcut settings, where the player can change them. What the
//! client stores is a preference — the desktop has the last word, and says
//! afterwards what it actually bound.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

/// What the desktop bound, per action ("F8", "Meta+Shift+R"), once it has said.
fn bound() -> &'static Mutex<HashMap<String, String>> {
    static BOUND: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    BOUND.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Whether the desktop is delivering the hotkeys rather than the X server.
///
/// Taking the shortcuts is not the same as putting a key on them: KDE accepts
/// the list, ignores the keys asked for, and leaves every one unset until the
/// player assigns it in the desktop's own settings. Until a key exists there,
/// the X11 grabs are still the only thing that fires — so this is true only
/// once the desktop names a trigger.
pub fn in_charge() -> bool {
    bound().lock().map(|b| b.values().any(|t| !t.is_empty())).unwrap_or(false)
}

/// Whether the shortcuts are registered with the desktop at all, key or no key.
/// They can only be given one in its settings while this is true.
pub fn registered() -> bool {
    bound().lock().map(|b| !b.is_empty()).unwrap_or(false)
}

/// Action → the trigger the desktop settled on.
pub fn triggers() -> HashMap<String, String> {
    bound().lock().map(|b| b.clone()).unwrap_or_default()
}

/// A Tauri accelerator as the shortcuts specification writes it.
///
/// "Ctrl+Alt+S" is "CTRL+ALT+s" there: modifiers in capitals under their own
/// names, and the key itself as its X keysym, which for a letter is the small
/// one. Only a preference either way — the desktop is free to bind something
/// else, and says so when it does.
pub fn as_trigger(accelerator: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    let pieces: Vec<&str> = accelerator.split('+').map(str::trim).filter(|p| !p.is_empty()).collect();
    let Some((key, modifiers)) = pieces.split_last() else { return String::new() };
    for modifier in modifiers {
        parts.push(match modifier.to_ascii_uppercase().as_str() {
            "CTRL" | "CONTROL" | "CMDORCTRL" | "COMMANDORCONTROL" => "CTRL",
            "ALT" | "OPTION" => "ALT",
            "SHIFT" => "SHIFT",
            "SUPER" | "META" | "CMD" | "COMMAND" | "WIN" => "LOGO",
            other => {
                log::debug!("shortcut modifier {other} has no portal name");
                continue;
            }
        }
        .to_string());
    }
    parts.push(if key.chars().count() == 1 { key.to_lowercase() } else { key.to_string() });
    parts.join("+")
}

#[cfg(target_os = "linux")]
mod portal {
    use super::*;
    use ashpd::desktop::global_shortcuts::{BindShortcutsOptions, GlobalShortcuts, NewShortcut};
    use ashpd::desktop::{CreateSessionOptions, Session};
    use futures_util::StreamExt;
    use tauri::async_runtime::{channel, Receiver, Sender};

    fn rebind_channel() -> &'static Mutex<Option<Sender<()>>> {
        static REBIND: OnceLock<Mutex<Option<Sender<()>>>> = OnceLock::new();
        REBIND.get_or_init(|| Mutex::new(None))
    }

    /// Ask the desktop to take the hotkeys over, and keep listening.
    ///
    /// Nothing is torn down on failure: a desktop without the interface (or one
    /// that refuses) simply leaves the X11 grab as it was, which is right on an
    /// X11 session and no worse than before anywhere else.
    pub fn start(app: &AppHandle) {
        let (sender, receiver) = channel(1);
        *rebind_channel().lock().unwrap() = Some(sender);
        let app = app.clone();
        tauri::async_runtime::spawn(async move { run(app, receiver).await });
    }

    /// The hotkeys changed: bind them again.
    ///
    /// A session's shortcuts are fixed once bound, so this ends the session and
    /// opens another.
    pub fn rebind() {
        if let Some(sender) = rebind_channel().lock().unwrap().as_ref() {
            let _ = sender.try_send(());
        }
    }

    async fn run(app: AppHandle, mut again: Receiver<()>) {
        loop {
            let session = match bind(&app).await {
                Ok(session) => session,
                Err(e) => {
                    // Once, at startup: on a desktop without the interface this
                    // is the normal state of affairs, not a fault to repeat.
                    log::info!("desktop hotkeys unavailable, using the X11 grab: {e}");
                    bound().lock().unwrap().clear();
                    return;
                }
            };
            // Wait to be told the hotkeys changed. A session's shortcuts are
            // fixed once bound, so the way to change one is to end the session
            // and open another — which is also why the old one is closed here
            // rather than left to the garbage of a dropped task: two live
            // sessions would each deliver the same key.
            let more = again.recv().await.is_some();
            if let Err(e) = session.close().await {
                log::debug!("closing the shortcuts session: {e}");
            }
            if !more {
                return;
            }
        }
    }

    /// One session: register every action, and deliver keys for as long as it
    /// is open.
    async fn bind(app: &AppHandle) -> Result<Session<GlobalShortcuts>, String> {
        let proxy = GlobalShortcuts::new().await.map_err(|e| e.to_string())?;
        let session =
            proxy.create_session(CreateSessionOptions::default()).await.map_err(|e| e.to_string())?;

        let wanted = crate::overlay::wanted_hotkeys(app);
        let shortcuts: Vec<NewShortcut> = wanted
            .iter()
            .map(|(action, key)| {
                NewShortcut::new(action.clone(), crate::overlay::describe_action(action))
                    .preferred_trigger(Some(as_trigger(key).as_str()))
            })
            .collect();

        let bound_now = proxy
            .bind_shortcuts(&session, &shortcuts, None, BindShortcutsOptions::default())
            .await
            .map_err(|e| e.to_string())?
            .response()
            .map_err(|e| e.to_string())?;

        let mut names = HashMap::new();
        for shortcut in bound_now.shortcuts() {
            names.insert(shortcut.id().to_string(), shortcut.trigger_description().to_string());
        }
        if names.is_empty() {
            return Err("the desktop took none of them".into());
        }
        settled(app, names);

        let mut activated = proxy.receive_activated().await.map_err(|e| e.to_string())?;
        let listening = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = activated.next().await {
                crate::overlay::run_action(&listening, event.shortcut_id());
            }
        });

        // The player can set the keys in the desktop's own settings whenever,
        // and this is how the client hears of it — both to say what the key is
        // and to know it can stop grabbing at the X server.
        let mut changed = proxy.receive_shortcuts_changed().await.map_err(|e| e.to_string())?;
        let watching = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = changed.next().await {
                let names = event
                    .shortcuts()
                    .iter()
                    .map(|s| (s.id().to_string(), s.trigger_description().to_string()))
                    .collect();
                settled(&watching, names);
            }
        });
        Ok(session)
    }

    /// Take in what the desktop says the shortcuts are now.
    fn settled(app: &AppHandle, names: HashMap<String, String>) {
        let keyed = names.values().filter(|t| !t.is_empty()).count();
        log::info!("desktop holds {} hotkeys, {keyed} with a key: {names:?}", names.len());
        *bound().lock().unwrap() = names;
        if keyed > 0 {
            // The desktop delivers them now, so the X server need not: with
            // both in place a key fires twice whenever StarBuddy has focus.
            crate::overlay::drop_x11_hotkeys(app);
        } else if let Err(e) = crate::overlay::register_hotkeys(app) {
            // Nothing bound over there yet, so the grabs are all there is.
            log::debug!("X11 hotkeys stay in place: {e}");
        }
        let _ = tauri::Emitter::emit(app, "hotkeys-changed", ());
    }
}

#[cfg(target_os = "linux")]
pub use portal::{rebind, start};

#[cfg(not(target_os = "linux"))]
pub fn start(_app: &AppHandle) {}

#[cfg(not(target_os = "linux"))]
pub fn rebind() {}

#[cfg(test)]
mod tests {
    use super::as_trigger;

    #[test]
    fn accelerators_are_written_the_way_the_portal_reads_them() {
        assert_eq!(as_trigger("F8"), "F8");
        assert_eq!(as_trigger("Ctrl+Alt+S"), "CTRL+ALT+s");
        assert_eq!(as_trigger("Super+Shift+F10"), "LOGO+SHIFT+F10");
        assert_eq!(as_trigger("CmdOrCtrl+K"), "CTRL+k");
        assert_eq!(as_trigger(""), "");
    }
}
