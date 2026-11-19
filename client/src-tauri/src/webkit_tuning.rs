//! Switching off the browser features an overlay never uses.
//!
//! Every overlay is a small React panel drawn over the game, and on Linux each
//! one is a full WebKitGTK view that by default comes ready for WebGL, audio,
//! video, a back/forward cache and the rest. None of that is asked for, so
//! none of it needs to be ready.
//!
//! Left on, on purpose:
//! - JavaScript, which the whole panel is.
//! - HTML5 local storage: `i18n.ts` keeps the locale there and `App.tsx` the
//!   status notices already seen.
//! - The hardware-acceleration policy, unless `STARBUDDY_WEBKIT_SOFTWARE=1`
//!   asks for the software-rendering experiment (see below).
//!
//! Not touched because the bound setters are deprecated no-ops in the WebKit
//! this links against: Java (gone since 2.38) and plugins (gone since 2.32).
//!
//! Also here, because it is the same per-view hook: making sure a destroyed
//! window's web process ends with it. See `linux::release_on_destroy`.

/// Turn off what an overlay webview does not use, and let its web process end
/// when the window is destroyed. Does nothing off Linux.
pub fn tune_overlay(win: &tauri::WebviewWindow) {
    #[cfg(target_os = "linux")]
    {
        let label = win.label().to_string();
        let result = win.with_webview(move |w| {
            let view = w.inner();
            linux::tune(&view, &label);
            linux::release_on_destroy(&view, &label);
        });
        if let Err(e) = result {
            log::warn!("webkit tuning for {}: {e}", win.label());
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = win;
}

#[cfg(target_os = "linux")]
mod linux {
    use webkit2gtk::glib::{gobject_ffi, prelude::*, subclass::SignalId, translate::IntoGlib};
    use webkit2gtk::{
        CacheModel, HardwareAccelerationPolicy, SettingsExt, UserContentManager, WebContextExt, WebViewExt,
    };

    /// EXPERIMENT: software rendering for overlays. Tests whether a small,
    /// mostly static panel costs less memory drawn on the CPU (no GPU/GL
    /// context per web process), and whether transparency survives it.
    /// Switch: run the client with `STARBUDDY_WEBKIT_SOFTWARE=1`; anything
    /// else (or unset) keeps WebKit's default policy. See `client/EXPERIMENTS.md`.
    /// Remove this function and its call to end the experiment.
    fn software_rendering_requested() -> bool {
        std::env::var("STARBUDDY_WEBKIT_SOFTWARE").is_ok_and(|v| v == "1")
    }

    pub fn tune(view: &webkit2gtk::WebView, label: &str) {
        // Settings belong to the one view: WebKit gives every view its own
        // unless one is passed in, and wry passes none.
        if let Some(s) = WebViewExt::settings(view) {
            s.set_enable_webgl(false);
            s.set_enable_webaudio(false);
            s.set_enable_media(false);
            s.set_enable_media_stream(false);
            s.set_enable_mediasource(false);
            s.set_enable_encrypted_media(false);
            s.set_enable_webrtc(false);
            s.set_enable_page_cache(false);
            s.set_enable_offline_web_application_cache(false);
            // IndexedDB and Web SQL; nothing in the frontend opens either.
            s.set_enable_html5_database(false);
            s.set_enable_spatial_navigation(false);
            s.set_enable_smooth_scrolling(false);
            if !cfg!(debug_assertions) {
                s.set_enable_developer_extras(false);
            }
            // EXPERIMENT: see `software_rendering_requested`. Applied right
            // after the window is built, before or while the first page
            // loads; nothing reloads the page to make it take effect.
            if software_rendering_requested() {
                s.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Never);
            }
            log::info!(
                "webkit tuning for {label}: hardware-acceleration-policy {:?}",
                s.hardware_acceleration_policy()
            );
            log::debug!(
                "webkit tuning for {label}: off webgl, webaudio, media, media-stream, mediasource, \
                 encrypted-media, webrtc, page-cache, offline-app-cache, html5-database, \
                 spatial-navigation, smooth-scrolling{}",
                if cfg!(debug_assertions) { "" } else { ", developer-extras" }
            );
        }

        // The web context is not the overlay's own. Tauri keys contexts by
        // data directory, and no window here sets one, so every window —
        // the main one included — shares a single context. DocumentViewer is
        // still right for all of them: it only shrinks WebKit's in-memory
        // cache, and every page in this app is a local asset served by the
        // app's own protocol, never refetched from a network. Setting it again
        // for each overlay is idempotent.
        if let Some(ctx) = WebViewExt::context(view) {
            ctx.set_cache_model(CacheModel::DocumentViewer);
            log::debug!("webkit tuning for {label}: shared web context cache model DocumentViewer");
        }
    }

    /// Break wry's reference cycle when the view is destroyed, so the view is
    /// freed and WebKit can end its web process.
    ///
    /// wry 0.57 (`attach_ipc_handler` in its `src/webkitgtk/mod.rs`) connects
    /// the IPC handler to the view's own WebKitUserContentManager and moves a
    /// strong reference to the view into it. The view holds its content
    /// manager until it is freed, so each keeps the other alive. Destroying the
    /// window disposes the view and closes its page, but the view is never
    /// freed, and while it lives it still refers to the page's main frame.
    /// WebKit does not end a web process that a frame still refers to, so
    /// every overlay closed after its idle timeout left its WebKitWebProcess
    /// running (measured: about 80 MB PSS each, still there minutes later, and
    /// a new one for every show).
    ///
    /// Dropping the handler when the view is destroyed lets go of the view.
    /// The page is closed by then and sends no more messages. The content
    /// manager is wry's, made for this view alone, so no other view's handler
    /// is touched. Taken weakly so this hook keeps nothing alive itself.
    pub fn release_on_destroy(view: &webkit2gtk::WebView, label: &str) {
        let Some(manager) = view.user_content_manager() else {
            log::warn!("webview {label}: no user content manager, its web process may outlive the window");
            return;
        };
        let manager = manager.downgrade();
        let label = label.to_string();
        view.connect_local("destroy", false, move |_| {
            if let Some(manager) = manager.upgrade() {
                let dropped = drop_script_message_handlers(&manager);
                log::debug!("webview {label}: destroyed, {dropped} IPC handler(s) let go of it");
            }
            None
        });
    }

    /// Disconnect every `script-message-received` handler; returns how many.
    fn drop_script_message_handlers(manager: &UserContentManager) -> u32 {
        let Some(signal) = SignalId::lookup("script-message-received", manager.type_()) else {
            return 0;
        };
        // SAFETY: `manager` is a live GObject for the whole call, and matching
        // by signal id alone needs no closure, function or data pointer.
        unsafe {
            gobject_ffi::g_signal_handlers_disconnect_matched(
                manager.as_ptr() as *mut gobject_ffi::GObject,
                gobject_ffi::G_SIGNAL_MATCH_ID,
                signal.into_glib(),
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        }
    }
}
