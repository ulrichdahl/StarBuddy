use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use crate::lock::RwLockExt;
use crate::{fs_atomic, scan};

/// Client preferences that are not about the server pairing.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub(crate) struct ClientPrefs {
    /// LIVE folder the player picked when auto-detection failed.
    pub(crate) live_dir: Option<String>,
    /// Where on screen the scan signature badge is looked for (relative).
    pub(crate) scan_region: Option<scan::ScanRegion>,
    /// Where the refinery order panel sits, framed by the player (relative).
    pub(crate) refinery_region: Option<scan::ScanRegion>,
    /// What the client reads the screen from, once the player has chosen it:
    /// on Wayland the portal's token for the window, on Windows the window's
    /// own name. Absent means screen reading has never been switched on.
    pub(crate) screen_source: Option<String>,
    /// Whether each F8 refinery read is sent to the paired server to improve
    /// the reader. Off unless the player switches it on; the F9 training
    /// capture is its own explicit action and does not look at this.
    pub(crate) share_reads_for_training: bool,
    /// Links the player added to Tools, in the order they added them.
    pub(crate) tool_links: Vec<crate::tools::ToolLink>,
    /// How the main window opens over the game, when the game is running.
    pub(crate) main_mode: crate::main_window::MainMode,
    /// Where the main window was left as an overlay.
    pub(crate) main_overlay_at: Option<crate::main_window::Placement>,
    /// Where the main window was left as a window, kept across restarts.
    pub(crate) main_window_at: Option<crate::main_window::Placement>,
}

fn client_prefs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("client.json"))
}

/// The client's preferences, read from disk once and kept.
///
/// Things that run all the time ask for them all the time — the live scan
/// asked for its area on every pass — and each ask used to be a file read and
/// a parse. The file is the copy that outlives the process; this is the one
/// everything reads.
pub(crate) struct PrefsCache(std::sync::RwLock<ClientPrefs>);

fn prefs_cache(app: &tauri::AppHandle) -> tauri::State<'_, PrefsCache> {
    if let Some(cache) = app.try_state::<PrefsCache>() {
        return cache;
    }
    let loaded = client_prefs_path(app).ok().and_then(|p| fs_atomic::read_json(&p)).unwrap_or_default();
    // Two first callers at once both load the same file, and the second
    // `manage` is refused, which is harmless.
    app.manage(PrefsCache(std::sync::RwLock::new(loaded)));
    app.state::<PrefsCache>()
}

pub(crate) fn save_client_prefs(app: &tauri::AppHandle, prefs: &ClientPrefs) -> Result<(), String> {
    let cache = prefs_cache(app);
    // Held across the write, so two saves land in the order they were made.
    let mut kept = cache.0.write_or_recover();
    *kept = prefs.clone();
    let bytes = serde_json::to_vec_pretty(prefs).map_err(|e| e.to_string())?;
    fs_atomic::write(&client_prefs_path(app)?, &bytes).map_err(|e| e.to_string())
}

pub(crate) fn load_client_prefs(app: &tauri::AppHandle) -> ClientPrefs {
    prefs_cache(app).0.read_or_recover().clone()
}
