//! Hotkeys on Windows, watched rather than reserved.
//!
//! `RegisterHotKey` asks Windows to reserve a combination and post it back.
//! That is what the client has always done, and on the machine this was
//! written for it registers all five and then never hears one: the log says
//! "registered 5, refused 0" and no key ever arrives while the game is in
//! front. Something between the keyboard and the hotkey table is taking them,
//! and there is nothing to be done about that from inside the hotkey table.
//!
//! A low-level keyboard hook sits further up: it sees a key as the system
//! receives it, before any hotkey is matched and before the foreground program
//! is handed it. That is the same road Discord, OBS and Steam take for their
//! own hotkeys, and it stays on the right side of the line this project draws:
//! nothing is injected into the game, no memory is read, no input is sent — the
//! key is watched on its way past and passed on untouched, so the game still
//! gets it.
//!
//! Both paths run. Whichever hears the key first does the work, and the second
//! is ignored: [`crate::overlay::run_action`] drops a repeat of the same action
//! inside a moment.

use std::sync::{OnceLock, RwLock};
use tauri::AppHandle;

/// One combination the client is listening for.
#[derive(Clone, Debug, PartialEq)]
pub struct Binding {
    pub action: String,
    /// Windows virtual-key code of the one key that is not a modifier.
    pub key: u16,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub win: bool,
}

fn bindings() -> &'static RwLock<Vec<Binding>> {
    static BINDINGS: OnceLock<RwLock<Vec<Binding>>> = OnceLock::new();
    BINDINGS.get_or_init(|| RwLock::new(Vec::new()))
}

/// What to listen for, as the client's own accelerators: `("refinery", "F8")`.
pub fn set_bindings(wanted: &[(String, String)]) {
    let parsed: Vec<Binding> = wanted.iter().filter_map(|(action, key)| binding(action, key)).collect();
    log::info!("watching {} hotkey(s) on the keyboard itself", parsed.len());
    if let Ok(mut held) = bindings().write() {
        *held = parsed;
    }
}

/// A binding from an accelerator the way the client spells one.
fn binding(action: &str, accelerator: &str) -> Option<Binding> {
    let pieces: Vec<&str> = accelerator.split('+').map(str::trim).filter(|p| !p.is_empty()).collect();
    let (key, modifiers) = pieces.split_last()?;
    let mut binding =
        Binding { action: action.to_string(), key: key_code(key)?, ctrl: false, alt: false, shift: false, win: false };
    for modifier in modifiers {
        match modifier.to_ascii_uppercase().as_str() {
            "CTRL" | "CONTROL" | "CMDORCTRL" | "COMMANDORCONTROL" => binding.ctrl = true,
            "ALT" | "OPTION" => binding.alt = true,
            "SHIFT" => binding.shift = true,
            "SUPER" | "META" | "CMD" | "COMMAND" | "WIN" => binding.win = true,
            other => {
                log::warn!("hotkey {action}: no such modifier as {other}");
                return None;
            }
        }
    }
    Some(binding)
}

/// The virtual-key code for a key named the way the client names one.
fn key_code(key: &str) -> Option<u16> {
    let upper = key.to_ascii_uppercase();
    if let Some(number) = upper.strip_prefix('F') {
        if let Ok(n) = number.parse::<u16>() {
            if (1..=24).contains(&n) {
                return Some(0x6F + n); // VK_F1 is 0x70
            }
        }
    }
    if let Some(number) = upper.strip_prefix("NUMPAD") {
        if let Ok(n) = number.parse::<u16>() {
            if n <= 9 {
                return Some(0x60 + n);
            }
        }
    }
    let bytes = upper.as_bytes();
    if bytes.len() == 1 {
        return match bytes[0] {
            b'A'..=b'Z' | b'0'..=b'9' => Some(bytes[0] as u16),
            _ => None,
        };
    }
    Some(match upper.as_str() {
        "SPACE" => 0x20,
        "ENTER" | "RETURN" => 0x0D,
        "TAB" => 0x09,
        "ESCAPE" | "ESC" => 0x1B,
        "BACKSPACE" => 0x08,
        "INSERT" => 0x2D,
        "DELETE" => 0x2E,
        "HOME" => 0x24,
        "END" => 0x23,
        "PAGEUP" => 0x21,
        "PAGEDOWN" => 0x22,
        "UP" => 0x26,
        "DOWN" => 0x28,
        "LEFT" => 0x25,
        "RIGHT" => 0x27,
        "MINUS" => 0xBD,
        "EQUAL" => 0xBB,
        "BRACKETLEFT" => 0xDB,
        "BRACKETRIGHT" => 0xDD,
        "BACKSLASH" => 0xDC,
        "SEMICOLON" => 0xBA,
        "QUOTE" => 0xDE,
        "COMMA" => 0xBC,
        "PERIOD" => 0xBE,
        "SLASH" => 0xBF,
        "BACKQUOTE" => 0xC0,
        _ => return None,
    })
}

/// The action a key press asks for, if any.
///
/// Modifiers must match exactly: F8 is not Ctrl+F8, and a client listening for
/// both must be able to tell them apart.
#[cfg_attr(not(windows), allow(dead_code))]
fn action_for(key: u16, ctrl: bool, alt: bool, shift: bool, win: bool) -> Option<String> {
    let held = bindings().read().ok()?;
    held.iter()
        .find(|b| b.key == key && b.ctrl == ctrl && b.alt == alt && b.shift == shift && b.win == win)
        .map(|b| b.action.clone())
}

#[cfg(windows)]
mod hook {
    use super::*;
    use crate::overlay::run_action;
    use std::sync::{mpsc, Mutex};
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, HHOOK, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN,
        WM_SYSKEYDOWN,
    };

    /// Where the hook puts the actions it hears. The hook itself must return
    /// in microseconds — Windows drops a hook that dawdles — so it does nothing
    /// but recognise the key and hand the name over.
    fn heard() -> &'static Mutex<Option<mpsc::Sender<String>>> {
        static HEARD: OnceLock<Mutex<Option<mpsc::Sender<String>>>> = OnceLock::new();
        HEARD.get_or_init(|| Mutex::new(None))
    }

    fn down(key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) -> bool {
        // The high bit is "held now"; the low bit is "pressed since last asked"
        // and would make a modifier look held long after it was let go.
        (unsafe { GetAsyncKeyState(key.0 as i32) } as u16 & 0x8000) != 0
    }

    unsafe extern "system" fn keyboard(code: i32, event: WPARAM, data: LPARAM) -> LRESULT {
        // Negative means "not ours to look at": pass it on untouched.
        if code >= 0 && (event.0 as u32 == WM_KEYDOWN || event.0 as u32 == WM_SYSKEYDOWN) {
            let key = unsafe { &*(data.0 as *const KBDLLHOOKSTRUCT) };
            if let Some(action) =
                action_for(key.vkCode as u16, down(VK_CONTROL), down(VK_MENU), down(VK_SHIFT), down(VK_LWIN) || down(VK_RWIN))
            {
                if let Ok(sender) = heard().lock() {
                    if let Some(sender) = sender.as_ref() {
                        let _ = sender.send(action);
                    }
                }
            }
        }
        // Always passed on: the key is the game's as much as ours, and a
        // client that swallowed it would be taking something from the player.
        unsafe { CallNextHookEx(None, code, event, data) }
    }

    /// Start watching. Safe to call once; later calls do nothing.
    pub fn watch(app: &AppHandle) {
        static STARTED: OnceLock<()> = OnceLock::new();
        if STARTED.set(()).is_err() {
            return;
        }
        let (sender, receiver) = mpsc::channel::<String>();
        *heard().lock().unwrap() = Some(sender);

        // The work, off the hook's thread.
        let app = app.clone();
        std::thread::Builder::new()
            .name("hotkey-actions".into())
            .spawn(move || {
                while let Ok(action) = receiver.recv() {
                    run_action(&app, &action);
                }
            })
            .expect("spawn hotkey action thread");

        // The hook, on a thread that does nothing else: it needs a message
        // loop of its own, and Windows calls it on that thread.
        std::thread::Builder::new()
            .name("hotkey-hook".into())
            .spawn(|| unsafe {
                let hook: HHOOK = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), None, 0) {
                    Ok(hook) => hook,
                    Err(e) => {
                        log::warn!("could not watch the keyboard: {e}");
                        return;
                    }
                };
                log::info!("watching the keyboard for hotkeys");
                let mut message = MSG::default();
                while GetMessageW(&mut message, None, 0, 0).as_bool() {}
                let _ = windows::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx(hook);
            })
            .expect("spawn hotkey hook thread");
    }
}

/// Whether this process is running as administrator.
///
/// Windows hands an ordinary program neither the keys nor the hotkeys aimed at
/// a window that is running higher than it is, so a game started as
/// administrator is one of the few things that can take every key at once —
/// and the client saying plainly which it is turns "I tried running as admin"
/// into something that can be checked.
#[cfg(windows)]
pub fn elevated() -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut size = 0u32;
        let asked = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut std::ffi::c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        );
        let _ = CloseHandle(token);
        asked.is_ok() && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
pub fn elevated() -> bool {
    false
}

#[cfg(windows)]
pub use hook::watch;

#[cfg(not(windows))]
pub fn watch(_app: &AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accelerators_become_keys_and_modifiers() {
        assert_eq!(binding("refinery", "F8"), Some(Binding {
            action: "refinery".into(),
            key: 0x77,
            ctrl: false,
            alt: false,
            shift: false,
            win: false,
        }));
        let combination = binding("status", "Ctrl+Alt+S").unwrap();
        assert_eq!(combination.key, b'S' as u16);
        assert!(combination.ctrl && combination.alt && !combination.shift && !combination.win);
        assert_eq!(binding("scan", "Super+Shift+F10").unwrap().key, 0x79);
        assert_eq!(binding("scan", "Hyper+K"), None, "a modifier Windows has no name for");
        assert_eq!(binding("scan", "Squiggle"), None);
    }

    #[test]
    fn a_key_is_only_its_own_combination() {
        set_bindings(&[("refinery".into(), "F8".into()), ("scan".into(), "Ctrl+F8".into())]);
        assert_eq!(action_for(0x77, false, false, false, false).as_deref(), Some("refinery"));
        assert_eq!(action_for(0x77, true, false, false, false).as_deref(), Some("scan"));
        assert_eq!(action_for(0x77, false, true, false, false), None, "Alt+F8 is neither");
        assert_eq!(action_for(0x78, false, false, false, false), None, "F9 is not bound");
        set_bindings(&[]);
    }
}
