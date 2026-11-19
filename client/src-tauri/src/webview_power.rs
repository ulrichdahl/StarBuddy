//! A hidden overlay's webview put to sleep, and woken before it is shown.
//!
//! On Windows every overlay is a WebView2 page with a renderer behind it, and
//! hiding the window tells WebView2 nothing: tao hides the top-level window,
//! the controller's `IsVisible` stays true, and the page goes on painting and
//! running its timers at full rate. [`suspend`] sets `IsVisible` false and asks
//! for `TrySuspend`, which is Edge's sleeping tabs: timers and animations stop,
//! the renderer's memory goes back to the system and its memory target drops
//! to low. [`resume`] undoes all of it, and must run before anything is sent
//! to the page.
//!
//! A hidden overlay still gets broadcasts (`overlay-visibility`, `rsi-status`,
//! `scan-live-state`), and Tauri delivers every event by running script in the
//! page. Microsoft says only that "some APIs like Navigate" wake a suspended
//! webview, not whether running script is one of them. So while a window stays
//! hidden it is looked at every 30 seconds, and one found awake is suspended
//! again. The debug log says when that happens, which is also how
//! to find out whether it does.
//!
//! Elsewhere both calls do nothing.

#[cfg(windows)]
pub use imp::{resume, suspend};

/// Put a hidden overlay's webview to sleep. Call it once the window is hidden.
#[cfg(not(windows))]
pub fn suspend(_win: &tauri::WebviewWindow) {}

/// Wake it again. Call it once the window is shown, before anything is sent to
/// its page.
#[cfg(not(windows))]
pub fn resume(_win: &tauri::WebviewWindow) {}

#[cfg(windows)]
mod imp {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;

    use tauri::{AppHandle, Manager, WebviewWindow};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2Controller, ICoreWebView2_19, ICoreWebView2_3, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use webview2_com::TrySuspendCompletedHandler;
    use windows::core::{Interface, BOOL};

    /// How often a hidden webview is checked for having been woken.
    const RECHECK: Duration = Duration::from_secs(30);

    /// Where one webview's sleep stands.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum Phase {
        /// On screen, or never put to sleep.
        Awake,
        /// `TrySuspend` asked, its answer not in yet.
        Asking,
        /// Suspended, as of the last answer or check.
        Asleep,
        /// The runtime would not suspend it; the memory target is low instead.
        Declined,
    }

    /// Each hide and each show starts a new spell with its own number, so an
    /// answer or a check left over from an earlier one can tell, and stand down.
    struct Spell {
        number: u64,
        phase: Phase,
    }

    fn spells() -> &'static Mutex<HashMap<String, Spell>> {
        static SPELLS: OnceLock<Mutex<HashMap<String, Spell>>> = OnceLock::new();
        SPELLS.get_or_init(Default::default)
    }

    /// Start a new spell; returns its number and the phase the last one ended in.
    fn begin(label: &str, phase: Phase) -> (u64, Phase) {
        let mut spells = spells().lock().unwrap();
        let spell = spells.entry(label.to_string()).or_insert(Spell { number: 0, phase: Phase::Awake });
        spell.number += 1;
        (spell.number, std::mem::replace(&mut spell.phase, phase))
    }

    /// The phase of spell `number`, while it is still the current one.
    fn current(label: &str, number: u64) -> Option<Phase> {
        spells().lock().unwrap().get(label).filter(|s| s.number == number).map(|s| s.phase)
    }

    /// Move spell `number` on to `phase`. False if a later spell has begun.
    fn advance(label: &str, number: u64, phase: Phase) -> bool {
        match spells().lock().unwrap().get_mut(label) {
            Some(spell) if spell.number == number => {
                spell.phase = phase;
                true
            }
            _ => false,
        }
    }

    /// The window is gone: drop spell `number`, which stops its watch.
    fn forget(label: &str, number: u64) {
        let mut spells = spells().lock().unwrap();
        if spells.get(label).is_some_and(|s| s.number == number) {
            spells.remove(label);
        }
    }

    pub fn suspend(win: &WebviewWindow) {
        let label = win.label().to_string();
        let (number, _) = begin(&label, Phase::Asking);
        let l = label.clone();
        // On the main thread this runs before with_webview returns.
        if let Err(e) = win.with_webview(move |webview| put_to_sleep(&l, number, &webview.controller())) {
            log::debug!("webview {label}: not suspended, the webview could not be reached: {e}");
            return;
        }
        watch(win.app_handle().clone(), label, number);
    }

    pub fn resume(win: &WebviewWindow) {
        let label = win.label().to_string();
        let (_, was) = begin(&label, Phase::Awake);
        // A window just built, or shown while already shown: nothing to undo.
        if was == Phase::Awake {
            return;
        }
        let l = label.clone();
        if let Err(e) = win.with_webview(move |webview| wake(&l, was, &webview.controller())) {
            log::warn!("webview {label}: could not be woken, the webview could not be reached: {e}");
        }
    }

    /// Make the webview invisible to WebView2 and ask it to suspend. The answer
    /// comes later, on the main thread; nothing here waits for it.
    fn put_to_sleep(label: &str, number: u64, controller: &ICoreWebView2Controller) {
        // TrySuspend fails with ERROR_INVALID_STATE unless the controller is
        // invisible, and hiding the window does not make it so. Invisible on
        // its own already stops painting and throttles the page's timers.
        if let Err(e) = unsafe { controller.SetIsVisible(false) } {
            log::debug!("webview {label}: not suspended, IsVisible(false) failed: {e}");
            return;
        }
        let core = match unsafe { controller.CoreWebView2() } {
            Ok(core) => core,
            Err(e) => {
                log::debug!("webview {label}: not suspended, no CoreWebView2: {e}");
                return;
            }
        };
        let Ok(core3) = core.cast::<ICoreWebView2_3>() else {
            log::debug!("webview {label}: this WebView2 runtime cannot suspend (no ICoreWebView2_3), hidden only");
            decline(label, number, &core);
            return;
        };
        let (l, answered) = (label.to_string(), core.clone());
        let handler = TrySuspendCompletedHandler::create(Box::new(move |result, suspended| {
            match result {
                Ok(()) if suspended => {
                    if advance(&l, number, Phase::Asleep) {
                        log::debug!("webview {l}: suspended");
                    } else {
                        log::debug!("webview {l}: suspended, but shown again since, which wakes it");
                    }
                }
                // Sleeping tabs' own rules: playing audio, a live connection.
                Ok(()) => {
                    log::debug!("webview {l}: the runtime declined to suspend it");
                    decline(&l, number, &answered);
                }
                Err(e) => {
                    log::debug!("webview {l}: TrySuspend failed: {e}");
                    decline(&l, number, &answered);
                }
            }
            Ok(())
        }));
        if let Err(e) = unsafe { core3.TrySuspend(&handler) } {
            log::debug!("webview {label}: TrySuspend refused: {e}");
            decline(label, number, &core);
        }
    }

    /// Suspending is off for this spell: settle for a low memory target, which
    /// is what Microsoft offers a page that has to keep running. Never both at
    /// once: a target set on a suspended webview is ignored, and TrySuspend
    /// sets it low by itself.
    fn decline(label: &str, number: u64, core: &ICoreWebView2) {
        if advance(label, number, Phase::Declined) {
            set_memory_target(label, core, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
        }
    }

    fn set_memory_target(label: &str, core: &ICoreWebView2, level: COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL) {
        let name = if level == COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW { "low" } else { "normal" };
        match core.cast::<ICoreWebView2_19>() {
            Ok(core19) => match unsafe { core19.SetMemoryUsageTargetLevel(level) } {
                Ok(()) => log::debug!("webview {label}: memory target {name}"),
                Err(e) => log::debug!("webview {label}: memory target {name} not set: {e}"),
            },
            Err(_) => log::debug!("webview {label}: this WebView2 runtime has no memory target (no ICoreWebView2_19)"),
        }
    }

    /// Undo [`put_to_sleep`]: resume, visible again, memory target normal.
    fn wake(label: &str, was: Phase, controller: &ICoreWebView2Controller) {
        let core = unsafe { controller.CoreWebView2() }.ok();
        let mut suspended = BOOL::default();
        if let Some(core3) = core.as_ref().and_then(|c| c.cast::<ICoreWebView2_3>().ok()) {
            let _ = unsafe { core3.IsSuspended(&mut suspended) };
            // Harmless on a webview that is not suspended, and it covers a
            // TrySuspend whose answer is still on its way.
            if let Err(e) = unsafe { core3.Resume() } {
                log::debug!("webview {label}: Resume failed: {e}");
            }
        }
        // Visible wakes it too, should Resume not have.
        if let Err(e) = unsafe { controller.SetIsVisible(true) } {
            log::warn!("webview {label}: IsVisible(true) failed, the overlay may show nothing: {e}");
        }
        // Resume sets it back from low only if the webview was suspended; a
        // declined one was lowered by hand and has to be raised the same way.
        if let Some(core) = &core {
            set_memory_target(label, core, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
        }
        log::debug!("webview {label}: resumed (was {was:?}, suspended: {})", suspended.as_bool());
    }

    /// While spell `number` lasts, look every [`RECHECK`] for the webview
    /// having been woken behind our back, and put it back to sleep.
    fn watch(app: AppHandle, label: String, number: u64) {
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(RECHECK).await;
                if !matches!(current(&label, number), Some(Phase::Asking | Phase::Asleep)) {
                    break;
                }
                let (app2, label2) = (app.clone(), label.clone());
                let _ = app.run_on_main_thread(move || match app2.get_webview_window(&label2) {
                    Some(win) => {
                        let l = label2.clone();
                        let _ = win.with_webview(move |webview| recheck(&l, number, &webview.controller()));
                    }
                    None => forget(&label2, number),
                });
            }
        });
    }

    fn recheck(label: &str, number: u64, controller: &ICoreWebView2Controller) {
        let Some(phase) = current(label, number) else { return };
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };
        let Ok(core3) = core.cast::<ICoreWebView2_3>() else { return };
        let mut suspended = BOOL::default();
        if unsafe { core3.IsSuspended(&mut suspended) }.is_err() {
            return;
        }
        match (phase, suspended.as_bool()) {
            (Phase::Asleep, false) => {
                log::debug!("webview {label}: woken while hidden, suspending it again");
                advance(label, number, Phase::Asking);
                put_to_sleep(label, number, controller);
            }
            (Phase::Asking, true) => {
                if advance(label, number, Phase::Asleep) {
                    log::debug!("webview {label}: suspended, though TrySuspend never answered");
                }
            }
            (Phase::Asking, false) => {
                log::debug!("webview {label}: TrySuspend has not answered in {} s", RECHECK.as_secs());
                decline(label, number, &core);
            }
            _ => {}
        }
    }
}
