use tauri::Manager;

mod analysis;
mod api;
mod capture;
mod changes;
mod diagnostics;
mod fs_atomic;
mod game_dir;
mod host;
mod http;
mod kde_rule;
mod lock;
mod main_window;
mod outbox;
mod pairing;
mod prefs;
mod reading;
#[cfg(windows)]
mod wgc;
#[cfg(target_os = "linux")]
mod portal;
mod overlay;
mod shortcuts;
mod winkeys;
mod refinery;
mod region;
mod rsi_status;
pub mod scan;
pub mod sigs;
mod tools;
mod training;
mod update;
mod watcher;
mod game_session;
mod webkit_tuning;
mod webview2_args;
mod webview_power;

// The paths other modules reach these by, from when they lived here.
pub(crate) use game_dir::LogEvent;
pub(crate) use host::host_command;
pub(crate) use pairing::{error_body, error_fields, load_settings, post_events, StoredSettings, SyncSummary};
pub(crate) use prefs::{load_client_prefs, save_client_prefs};

/// Make glibc hand large freed buffers straight back to the system.
///
/// Every OCR read allocates tensors of several megabytes and frees them again.
/// glibc starts out returning anything that large to the system on free, but
/// raises that bar each time it does, until such buffers come out of its
/// per-thread arenas instead — and an arena keeps what it is given. Measured
/// on the live scan with refinery reads beside it, the process grew by fifty
/// to a hundred megabytes a read and kept it; with the bar fixed it stays
/// where the loaded models put it, for reads a few percent slower. Fixing the
/// bar is what stops it moving. A player who sets it has the last word.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn give_freed_buffers_back() {
    /// `M_MMAP_THRESHOLD` in glibc's malloc.h.
    const M_MMAP_THRESHOLD: i32 = -3;
    extern "C" {
        fn mallopt(param: i32, value: i32) -> i32;
    }
    if std::env::var_os("MALLOC_MMAP_THRESHOLD_").is_none() {
        // Only an integer parameter; nothing is allocated or freed here.
        unsafe { mallopt(M_MMAP_THRESHOLD, 256 * 1024) };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The AppImage bundles Ubuntu-22.04-era WebKitGTK, whose DMABUF renderer
    // aborts with EGL_BAD_PARAMETER against newer Mesa/driver stacks (white
    // window). Disable it there unless the user has set the variable
    // themselves — and only there: on a current system WebKitGTK (2.54 here)
    // DMABUF is the only GPU path left, so switching it off drops every
    // webview to software rendering. The overlays' repaint workaround
    // (`will-change` on `.ov`) only holds with GPU compositing; without it a
    // hover repainted just the hovered button and the rest of the panel
    // vanished until clicked.
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPDIR").is_some() && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    // Wayland gives clients no say over window position or stacking, which
    // the overlay windows need (docking, always-on-top), and X11-style
    // global hotkeys only reach X clients. Running through XWayland — like
    // the game itself under Wine — gets all three back. Users who know
    // better can set GDK_BACKEND themselves.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    give_freed_buffers_back();
    // Before anything touches rten, whose thread pool reads this once: the
    // reader shares the machine with the game, so it gets half the cores and
    // never more than four. A player who sets it has the last word.
    if std::env::var_os("RTEN_NUM_THREADS").is_none() {
        std::env::set_var("RTEN_NUM_THREADS", analysis::ocr_threads().to_string());
    }

    // EXPERIMENT E2: one WebView2 renderer for every window (Windows only),
    // off unless STARBUDDY_WEBVIEW2_SHARED_RENDERER is 1 or site. See
    // `webview2_args`.
    let mut context = tauri::generate_context!();
    webview2_args::apply_to_config(context.config_mut());

    tauri::Builder::default()
        // Must be first: a second launch hands its args to this instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(action) = overlay::action_in(&args) {
                overlay::run_action(app, &action);
            } else if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        // Debug log: rotating file in the app log dir + stdout. Dev builds
        // log at debug, releases at info.
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("starbuddy".into()) }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .level(if option_env!("STARBUDDY_BUILD").is_some() { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("tao", log::LevelFilter::Warn)
                .level_for("rten", log::LevelFilter::Warn)
                .max_file_size(2_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| overlay::on_shortcut(app, shortcut, event.state()))
                .build(),
        )
        .manage(watcher::WatcherState::default())
        .manage(game_session::SessionState::default())
        .manage(rsi_status::RsiStatusState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            log::info!(
                "StarBuddy client v{} {} starting ({} {})",
                env!("CARGO_PKG_VERSION"),
                option_env!("STARBUDDY_BUILD").unwrap_or("release"),
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            if cfg!(windows) {
                log::info!("running as administrator: {}", winkeys::elevated());
            }
            webview2_args::log_effective();
            log::info!("OCR threads: {}", std::env::var("RTEN_NUM_THREADS").unwrap_or_default());
            host::migrate_old_config_dir(&handle);
            app.manage(overlay::OverlayState::load(&handle));
            app.manage(outbox::OutboxState::load(&handle));
            outbox::send_at_start(&handle);
            app.manage(scan::ScanState::default());
            app.manage(refinery::RefineryState::default());
            app.manage(region::SelectorState::default());
            if let Err(e) = overlay::register_hotkeys(&handle) {
                log::warn!("overlay hotkeys: {e}");
            }
            // And ask the desktop to deliver them too, where it can. It answers
            // in its own time; when it does, the X11 grabs are dropped so a key
            // cannot fire twice.
            shortcuts::start(&handle);
            // And on Windows, watch the keyboard itself: the system's hotkey
            // table accepts every shortcut there and then delivers none of
            // them while the game is in front.
            winkeys::watch(&handle);
            rsi_status::start(&handle);
            overlay::show_if_open(&handle, overlay::STATUS);
            overlay::show_if_open(&handle, scan::SCAN);
            overlay::show_if_open(&handle, refinery::REFINERY);
            let args: Vec<String> = std::env::args().collect();
            if let Some(action) = overlay::action_in(&args) {
                overlay::run_action(&handle, &action);
            }
            // Hidden overlay windows would otherwise keep the process alive
            // after the main window is closed.
            if let Some(main) = app.get_webview_window("main") {
                let exit_handle = handle.clone();
                let close_win = main.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // As the overlay, closing puts it away; the hotkey
                        // brings it back. As a window, it quits StarBuddy.
                        if !close_win.is_decorated().unwrap_or(true) {
                            api.prevent_close();
                            main_window::hide(&exit_handle);
                            return;
                        }
                        main_window::remember(&exit_handle);
                        overlay::save_now(&exit_handle);
                        exit_handle.exit(0);
                    }
                });
            }
            main_window::setup(&handle);
            watcher::start_at_launch(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            game_dir::detect_game_log,
            game_dir::game_channels,
            reading::screen_reading,
            reading::screen_reading_windows,
            reading::screen_reading_start,
            reading::screen_reading_stop,
            game_dir::set_live_dir,
            game_dir::scan_backlog,
            pairing::get_connection,
            pairing::pair_device,
            pairing::unpair,
            pairing::sync_events,
            pairing::fetch_status,
            rsi_status::rsi_status_latest,
            overlay::overlay_toggle,
            overlay::overlay_show,
            overlay::overlay_prefs,
            overlay::overlay_update,
            overlay::overlay_fit,
            overlay::overlay_start_drag,
            overlay::overlay_close,
            overlay::overlay_hotkey,
            overlay::overlay_set_hotkey,
            kde_rule::overlay_kde_rule,
            kde_rule::overlay_set_kde_rule,
            scan::scan_now,
            scan::scan_last,
            refinery::refinery_read,
            refinery::refinery_last,
            refinery::refinery_status,
            refinery::refinery_save,
            refinery::refinery_clear,
            region::region_select,
            region::region_selected,
            region::region_current,
            region::region_clear,
            region::region_frame,
            api::server_api,
            main_window::main_mode_get,
            main_window::main_mode_set,
            main_window::main_hide,
            main_window::app_quit,
            tools::tool_links_get,
            tools::tool_links_set,
            training::training_capture,
            training::training_sharing_get,
            training::training_sharing_set,
            watcher::start_watcher,
            watcher::stop_watcher,
            watcher::watcher_status,
            game_session::game_session,
            update::check_for_update,
            diagnostics::app_version,
            diagnostics::debug_mode,
            diagnostics::log_dir,
            diagnostics::system_report,
            diagnostics::open_log_dir,
            changes::app_changes,
            scan::scan_live_toggle,
            scan::scan_live_running,
            scan::scan_region_get,
            scan::scan_region_set,
            sigs::scan_lookup,
            sigs::scan_signatures_refresh
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                overlay::save_now(app);
            }
        });
}
