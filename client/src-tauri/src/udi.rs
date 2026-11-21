//! United Danes' StarLabels (global.ini) and StarConfig (user.cfg), installed
//! into the game folder. The player sets them up on uniteddanes.org in their
//! own browser; StarBuddy links to that setup with a secret token and fetches
//! the finished files. Contract: UnitedDanes/website/docs/starbuddy-api.md.
//!
//! The token is a bearer secret for the player's UDI settings: it is never
//! logged and never put in a query string.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

use crate::prefs::{load_client_prefs, save_client_prefs};

fn base_url() -> String {
    // STARBUDDY_UDI_URL=http://localhost:8095 for UDI's dev server.
    std::env::var("STARBUDDY_UDI_URL").unwrap_or_else(|_| "https://uniteddanes.org".into()).trim_end_matches('/').to_string()
}

/// What StarBuddy keeps about the link, in client.json.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub(crate) struct UdiPrefs {
    /// Minted here when the StarBuddy website does not keep one for the account.
    pub(crate) token: Option<String>,
    /// Install a new Send without asking.
    pub(crate) auto_install: bool,
    /// The revision last installed.
    pub(crate) revision: Option<i64>,
    /// Per channel folder: what was installed there.
    pub(crate) installed: HashMap<String, Installed>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub(crate) struct Installed {
    pub(crate) ini_etag: Option<String>,
    pub(crate) cfg_etag: Option<String>,
    /// sha-free fingerprint of the user.cfg StarBuddy wrote: its length and
    /// content, so a file the player changed since is backed up again.
    pub(crate) cfg_written: Option<String>,
    pub(crate) game_version: Option<String>,
    pub(crate) at: Option<String>,
}

/// GET /api/starbuddy/profile.
#[derive(Serialize, Deserialize, Clone)]
pub struct Profile {
    pub revision: i64,
    pub updated_at: Option<String>,
    pub channel: Option<String>,
    pub labels: bool,
    pub config: bool,
}

/// The token for the account, cached once known.
#[derive(Default)]
pub struct UdiState(Mutex<Option<String>>);

fn valid_token(t: &str) -> bool {
    t.len() == 43 && t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn mint() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("no randomness: {e}"))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

/// The StarBuddy website keeps the token for the account, so the link
/// follows the player to another PC. A token minted here before is handed
/// over (PUT); an account that already has a different one wins (409).
/// Err when not paired or the website cannot be asked.
async fn server_token(app: &tauri::AppHandle, local: Option<&str>) -> Result<String, String> {
    let settings = crate::pairing::load_settings(app).filter(|s| !s.token.is_empty()).ok_or("not paired")?;
    let url = format!("{}/api/me/udi-link", settings.server_url.trim_end_matches('/'));
    let client = crate::http::client();
    let ask = |req: reqwest::RequestBuilder| req.bearer_auth(&settings.token).header("Accept", "application/json").send();
    let mut resp = match local {
        Some(t) => ask(client.put(&url).json(&serde_json::json!({ "token": t }))).await.map_err(|e| e.to_string())?,
        None => ask(client.get(&url)).await.map_err(|e| e.to_string())?,
    };
    if resp.status().as_u16() == 409 {
        resp = ask(client.get(&url)).await.map_err(|e| e.to_string())?;
    }
    if !resp.status().is_success() {
        return Err(format!("the StarBuddy website answered {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    v.get("token").and_then(|t| t.as_str()).filter(|t| valid_token(t)).map(str::to_string).ok_or_else(|| "no token in the answer".into())
}

/// The link token: the account's when paired, else this machine's, minted
/// when `create`.
async fn token(app: &tauri::AppHandle, create: bool) -> Result<Option<String>, String> {
    if let Some(t) = app.state::<UdiState>().0.lock().map_err(|e| e.to_string())?.clone() {
        return Ok(Some(t));
    }
    let local = load_client_prefs(app).udi.token.filter(|t| valid_token(t));
    let found = match server_token(app, local.as_deref()).await {
        Ok(t) => {
            // The account holds it now; the local copy only stands in when unpaired.
            if local.as_deref() != Some(t.as_str()) {
                let mut prefs = load_client_prefs(app);
                prefs.udi.token = Some(t.clone());
                save_client_prefs(app, &prefs)?;
            }
            Some(t)
        }
        Err(_) => match local {
            Some(t) => Some(t),
            None if create => {
                let t = mint()?;
                let mut prefs = load_client_prefs(app);
                prefs.udi.token = Some(t.clone());
                save_client_prefs(app, &prefs)?;
                Some(t)
            }
            None => None,
        },
    };
    *app.state::<UdiState>().0.lock().map_err(|e| e.to_string())? = found.clone();
    Ok(found)
}

/// LIVE → live; every other environment (PTU, EPTU, HOTFIX, TECH-PREVIEW)
/// → ptu. Only LIVE runs the build the live language file is made for.
fn channel_of(live_dir: &Path) -> &'static str {
    if environment_of(live_dir) == "LIVE" {
        "live"
    } else {
        "ptu"
    }
}

/// The game environment a channel folder is: "LIVE", "PTU", "HOTFIX"...
fn environment_of(live_dir: &Path) -> String {
    live_dir.file_name().map(|n| n.to_string_lossy().to_ascii_uppercase()).unwrap_or_default()
}

/// Every entry in `dir` named `name` in any casing. The game runs on Windows,
/// where USER.cfg and user.cfg are one file; on Linux they are two, and
/// writing a second one beside the player's leaves the game reading either.
fn named_ci(dir: &Path, name: &str) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| entries.flatten().filter(|e| e.file_name().to_string_lossy().eq_ignore_ascii_case(name)).map(|e| e.path()).collect())
        .unwrap_or_default();
    found.sort();
    found
}

/// `dir/name` as it already exists in any casing, else as given.
fn child_ci(dir: &Path, name: &str) -> PathBuf {
    named_ci(dir, name).into_iter().next().unwrap_or_else(|| dir.join(name))
}

/// `<channel>/data/Localization/english/global.ini`, in the casing the folders already have.
fn ini_path(live_dir: &Path) -> PathBuf {
    let data = child_ci(live_dir, "data");
    let loc = child_ci(&data, "Localization");
    child_ci(&child_ci(&loc, "english"), "global.ini")
}

fn fingerprint(bytes: &[u8]) -> String {
    // Not for security: says whether user.cfg is still the one StarBuddy wrote.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{}:{h:016x}", bytes.len())
}

async fn get(token: &str, path: &str, etag: Option<&str>) -> Result<reqwest::Response, String> {
    let mut req = crate::http::client().get(format!("{}{path}", base_url())).bearer_auth(token);
    if let Some(etag) = etag {
        req = req.header("If-None-Match", etag);
    }
    req.send().await.map_err(|e| format!("uniteddanes.org could not be reached: {e}"))
}

fn header(resp: &reqwest::Response, name: &str) -> Option<String> {
    resp.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string)
}

#[derive(Serialize, Clone)]
pub struct UdiStatus {
    pub linked: bool,
    pub auto_install: bool,
    pub revision: Option<i64>,
    pub game_version: Option<String>,
    pub installed_at: Option<String>,
    /// The channel folder the status is about.
    pub channel: Option<String>,
}

#[tauri::command]
pub async fn udi_status(app: tauri::AppHandle) -> Result<UdiStatus, String> {
    // Linked once the player has sent a setup from the browser under the token.
    let linked = matches!(udi_profile(app.clone()).await, Ok(Some(_)));
    let prefs = load_client_prefs(&app);
    let dir = crate::game_dir::detect_game_log(app.clone());
    let here = dir.as_ref().and_then(|d| prefs.udi.installed.get(d)).cloned().unwrap_or_default();
    Ok(UdiStatus {
        linked,
        auto_install: prefs.udi.auto_install,
        revision: prefs.udi.revision,
        game_version: here.game_version,
        installed_at: here.at,
        channel: dir.map(|d| channel_of(Path::new(&d)).to_string()),
    })
}

/// Open the setup page in the player's browser, with the token in the fragment.
#[tauri::command]
pub async fn udi_link(app: tauri::AppHandle, lang: String, tool: Option<String>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let token = token(&app, true).await?.ok_or("no link token")?;
    let tool = if tool.as_deref() == Some("config") { "star-config" } else { "star-labels" };
    let page = match lang.as_str() {
        "da" => format!("/vaerktoej/{tool}"),
        "de" => format!("/de/werkzeuge/{tool}"),
        _ => format!("/en/tools/{tool}"),
    };
    log::info!("opening the UnitedDanes setup page ({page})");
    app.opener().open_url(format!("{}{page}#starbuddy={token}", base_url()), None::<&str>).map_err(|e| e.to_string())
}

/// The setup as last sent from the browser; None until the player has pressed Send.
#[tauri::command]
pub async fn udi_profile(app: tauri::AppHandle) -> Result<Option<Profile>, String> {
    let Some(token) = token(&app, false).await? else { return Ok(None) };
    let resp = get(&token, "/api/starbuddy/profile", None).await?;
    match resp.status().as_u16() {
        200 => resp.json().await.map(Some).map_err(|e| e.to_string()),
        404 => Ok(None),
        s => Err(format!("uniteddanes.org answered {s}")),
    }
}

#[derive(Serialize, Clone, Default)]
pub struct InstallResult {
    pub ini: bool,
    pub cfg: bool,
    pub backed_up: bool,
    pub game_version: Option<String>,
    /// 503 on global.ini: UDI could not build it now; the installed one stays.
    pub ini_later: bool,
}

/// Fetch and write the files for one channel folder. `force` ignores the
/// stored ETags (a fresh install); otherwise unchanged files are skipped.
async fn install_into(app: &tauri::AppHandle, live_dir: &str, force: bool) -> Result<InstallResult, String> {
    let token = token(app, false).await?.ok_or("Not linked to uniteddanes.org yet.")?;
    let dir = PathBuf::from(live_dir);
    if !dir.is_dir() {
        return Err(format!("{live_dir} is not a game folder"));
    }
    let profile = udi_profile(app.clone()).await?.ok_or("Nothing has been sent from uniteddanes.org yet.")?;
    let mut prefs = load_client_prefs(app);
    let mut here = prefs.udi.installed.get(live_dir).cloned().unwrap_or_default();
    let result = fetch_and_write(&token, &dir, &profile, &mut here, force).await?;
    here.at = Some(chrono_now());
    prefs.udi.revision = Some(profile.revision);
    prefs.udi.installed.insert(live_dir.to_string(), here);
    save_client_prefs(app, &prefs)?;
    Ok(result)
}

/// The files of one Send, fetched and written into `dir`; `here` is what
/// was installed there before and is brought up to date.
async fn fetch_and_write(token: &str, dir: &Path, profile: &Profile, here: &mut Installed, force: bool) -> Result<InstallResult, String> {
    let token = token.to_string();
    let dir = dir.to_path_buf();
    let mut result = InstallResult::default();

    if profile.labels {
        let etag = if force { None } else { here.ini_etag.clone() };
        let path = format!("/api/starbuddy/global.ini?channel={}", channel_of(&dir));
        let resp = get(&token, &path, etag.as_deref()).await?;
        match resp.status().as_u16() {
            200 => {
                let new_etag = header(&resp, "ETag");
                let version = header(&resp, "X-Game-Version");
                let body = resp.bytes().await.map_err(|e| e.to_string())?;
                let target = ini_path(&dir);
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
                }
                crate::fs_atomic::write(&target, &body).map_err(|e| format!("{}: {e}", target.display()))?;
                log::info!("installed StarLabels global.ini ({} bytes) to {}", body.len(), target.display());
                here.ini_etag = new_etag;
                here.game_version = version.clone();
                result.ini = true;
                result.game_version = version;
            }
            304 => {}
            503 => result.ini_later = true,
            s => return Err(format!("uniteddanes.org answered {s} for global.ini")),
        }
    }

    if profile.labels || profile.config {
        let etag = if force { None } else { here.cfg_etag.clone() };
        let resp = get(&token, "/api/starbuddy/user.cfg", etag.as_deref()).await?;
        match resp.status().as_u16() {
            200 => {
                let new_etag = header(&resp, "ETag");
                let body = resp.bytes().await.map_err(|e| e.to_string())?;
                // The user.cfg the game reads, in whatever casing it has: the
                // player's own if there is one, else one StarBuddy wrote.
                let is_ours = |path: &Path| {
                    std::fs::read(path).is_ok_and(|b| here.cfg_written.as_deref() == Some(fingerprint(&b).as_str()))
                };
                let variants = named_ci(&dir, "user.cfg");
                let target = variants
                    .iter()
                    .find(|p| !is_ours(p))
                    .or(variants.first())
                    .cloned()
                    .unwrap_or_else(|| dir.join("user.cfg"));
                // A user.cfg StarBuddy did not write is the player's own: kept
                // once, before StarBuddy first replaces it.
                if let Ok(existing) = std::fs::read(&target) {
                    let backup = dir.join("user.cfg.before-starbuddy");
                    if !is_ours(&target) && named_ci(&dir, "user.cfg.before-starbuddy").is_empty() {
                        std::fs::write(&backup, &existing).map_err(|e| format!("{}: {e}", backup.display()))?;
                        result.backed_up = true;
                    }
                }
                // Other casings StarBuddy wrote before go: one user.cfg, the one above.
                let leftovers: Vec<PathBuf> = variants.iter().filter(|p| **p != target && is_ours(p)).cloned().collect();
                crate::fs_atomic::write(&target, &body).map_err(|e| format!("{}: {e}", target.display()))?;
                for extra in leftovers {
                    match std::fs::remove_file(&extra) {
                        Ok(()) => log::info!("removed {}, a second user.cfg StarBuddy had written", extra.display()),
                        Err(e) => log::warn!("could not remove {}: {e}", extra.display()),
                    }
                }
                log::info!("installed StarConfig user.cfg to {}", target.display());
                here.cfg_etag = new_etag;
                here.cfg_written = Some(fingerprint(&body));
                result.cfg = true;
            }
            304 => {}
            s => return Err(format!("uniteddanes.org answered {s} for user.cfg")),
        }
    }

    Ok(result)
}

fn chrono_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    secs.to_string()
}

/// Install the latest Send into the game folder StarBuddy follows.
#[tauri::command]
pub async fn udi_install(app: tauri::AppHandle) -> Result<InstallResult, String> {
    let dir = crate::game_dir::detect_game_log(app.clone()).ok_or("No game folder found. Choose it under Settings › Game install.")?;
    install_into(&app, &dir, true).await
}

#[tauri::command]
pub fn udi_auto_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut prefs = load_client_prefs(&app);
    prefs.udi.auto_install = enabled;
    save_client_prefs(&app, &prefs)
}

/// Forget the link: UDI deletes the settings, StarBuddy the token. Installed files stay.
#[tauri::command]
pub async fn udi_unlink(app: tauri::AppHandle) -> Result<(), String> {
    // Paired, the website deletes at UDI too; telling UDI directly as well is harmless
    // and covers a machine that is not paired.
    if let Some(token) = token(&app, false).await? {
        let resp = crate::http::client()
            .delete(format!("{}/api/starbuddy/profile", base_url()))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Unlinking failed, uniteddanes.org could not be reached: {e}"))?;
        if !resp.status().is_success() && resp.status().as_u16() != 404 {
            return Err(format!("Unlinking failed (uniteddanes.org answered {}); still linked, try again later.", resp.status()));
        }
    }
    // The website forgets the account's token only once UDI has; a 502 means
    // UDI could not be reached from there, and the link stays until a retry.
    if let Some(settings) = crate::pairing::load_settings(&app).filter(|s| !s.token.is_empty()) {
        let resp = crate::http::client()
            .delete(format!("{}/api/me/udi-link", settings.server_url.trim_end_matches('/')))
            .bearer_auth(&settings.token)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Unlinking failed, the StarBuddy website could not be reached: {e}"))?;
        let status = resp.status().as_u16();
        if !resp.status().is_success() && status != 404 {
            return Err(format!("Unlinking failed (the StarBuddy website answered {status}); still linked, try again later."));
        }
    }
    let mut prefs = load_client_prefs(&app);
    prefs.udi = UdiPrefs::default();
    save_client_prefs(&app, &prefs)?;
    *app.state::<UdiState>().0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// How long the game's files must have been left alone before a patch counts
/// as finished. The launcher writes build_manifest.id before it is done with
/// Data.p4k (about a minute before, on a 4.10 patch), and the files are not
/// safe to touch, nor the game to start, until it is.
const PATCH_SETTLED: Duration = Duration::from_secs(30);

/// Seconds since a file was last written, or None when it cannot be told.
fn age(path: &Path) -> Option<Duration> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok())
}

/// Wake the loop whenever the launcher writes build_manifest.id in `dir`.
///
/// The folder is watched rather than the file, because the launcher may
/// replace the file rather than write into it. Kept alive by the caller; a
/// folder that cannot be watched leaves the loop's own timer to notice.
fn watch_manifest(dir: &Path, wake: std::sync::Arc<tokio::sync::Notify>) -> Option<notify::RecommendedWatcher> {
    use notify::Watcher;
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if event.paths.iter().any(|p| p.file_name().is_some_and(|n| n == "build_manifest.id")) {
                wake.notify_one();
            }
        }
    })
    .map_err(|e| log::info!("build_manifest.id not watched: {e}"))
    .ok()?;
    watcher
        .watch(dir, notify::RecursiveMode::NonRecursive)
        .map_err(|e| log::info!("build_manifest.id not watched in {}: {e}", dir.display()))
        .ok()?;
    Some(watcher)
}

/// Keep installed files current: at start, when the game's build changes,
/// and every few hours, never while the game runs. A new build is seen in the
/// launcher's build_manifest.id the moment patching writes it (a file watch,
/// with a timer behind it); once patching has settled the files are brought
/// up to date and the status window says the game is safe to start. Game.log's
/// branch is the fallback for a folder without a manifest.
pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let wake = std::sync::Arc::new(tokio::sync::Notify::new());
        let mut watched: Option<(String, notify::RecommendedWatcher)> = None;
        let mut last_check: Option<Instant> = None;
        let mut last_profile: Option<Instant> = None;
        let mut last_build: Option<String> = None;
        // A new build is in, but the launcher may still be writing it.
        let mut patching = false;
        loop {
            // Woken at once by the watch; the timer is for a folder that
            // cannot be watched, and for waiting out a patch.
            let wait = if patching { Duration::from_secs(5) } else { Duration::from_secs(60) };
            let _ = tokio::time::timeout(wait, wake.notified()).await;

            let prefs = load_client_prefs(&app);
            let Some(dir) = crate::game_dir::detect_game_log(app.clone()) else { continue };
            if !prefs.udi.installed.contains_key(&dir) {
                continue;
            }
            if watched.as_ref().map(|(d, _)| d) != Some(&dir) {
                watched = watch_manifest(Path::new(&dir), wake.clone()).map(|w| (dir.clone(), w));
            }
            let session = app.try_state::<crate::game_session::SessionState>().map(|s| s.current()).unwrap_or_default();
            if session.running || crate::main_window::game_running() {
                // Started before StarBuddy said it was ready: too late to tell,
                // and the build is the one running now.
                if std::mem::take(&mut patching) {
                    last_build = crate::game_dir::installed_build(Path::new(&dir));
                }
                continue;
            }
            let manifest = crate::game_dir::installed_build(Path::new(&dir));
            let from_manifest = manifest.is_some();
            let build = manifest.or(session.branch.clone());
            let new_build = build.is_some() && build != last_build;
            // A build that changed while StarBuddy ran, not the one found at
            // start: that is a patch, and the player is told when it is ready.
            if new_build && last_build.is_some() && from_manifest {
                patching = true;
            }
            if patching {
                let still_writing = ["Data.p4k", "build_manifest.id"]
                    .iter()
                    .any(|f| age(&Path::new(&dir).join(f)).is_some_and(|a| a < PATCH_SETTLED));
                if still_writing {
                    continue;
                }
            }
            let due = last_check.is_none_or(|t| t.elapsed() >= Duration::from_secs(3 * 3600));
            let profile_due = last_profile.is_none_or(|t| t.elapsed() >= Duration::from_secs(600));
            if !(new_build || due || (prefs.udi.auto_install && profile_due)) {
                continue;
            }
            if !matches!(token(&app, false).await, Ok(Some(_))) {
                if patching {
                    patching = false;
                    last_build = build.clone();
                    tell_patched(&app, &dir, Err("not linked to UnitedDanes".into()));
                }
                continue;
            }
            let mut new_send = false;
            if prefs.udi.auto_install && profile_due {
                last_profile = Some(Instant::now());
                if let Ok(Some(p)) = udi_profile(app.clone()).await {
                    new_send = prefs.udi.revision != Some(p.revision);
                }
            }
            if !(new_build || due || new_send) {
                continue;
            }
            if new_build {
                log::info!("game build {} found; checking the UnitedDanes files", build.as_deref().unwrap_or("?"));
            }
            last_build = build.clone();
            last_check = Some(Instant::now());
            let result = install_into(&app, &dir, false).await;
            match &result {
                Ok(r) if r.ini || r.cfg => log::info!("UnitedDanes files brought up to date (global.ini {}, user.cfg {})", r.ini, r.cfg),
                Ok(_) => {}
                Err(e) => log::info!("UnitedDanes files not checked: {e}"),
            }
            if std::mem::take(&mut patching) {
                tell_patched(&app, &dir, result.map(|_| ()));
            }
        }
    });
}

/// Say in the status window, and as a system notification, that a new build
/// is patched in and whether the language file is ready for it.
///
/// Named by environment (LIVE, PTU...), not version: the manifest's version is
/// the launcher's, not what the game reports, and would only mislead.
fn tell_patched(app: &tauri::AppHandle, dir: &str, result: Result<(), String>) {
    let environment = environment_of(Path::new(dir));
    let da = crate::notice::danish();
    match result {
        Ok(()) => {
            let (title, body) = if da {
                (format!("Star Citizen {environment} er klar"), "Sprogfilen er opdateret. Du kan starte spillet nu.".to_string())
            } else {
                (format!("Star Citizen {environment} is ready"), "The language file is up to date. You can start the game now.".to_string())
            };
            crate::notice::show(app, "ok", "patched", environment, None, &title, &body);
        }
        Err(e) => {
            let (title, body) = if da {
                (format!("Star Citizen {environment} er patchet"), format!("Sprogfilen blev ikke opdateret: {e}"))
            } else {
                (format!("Star Citizen {environment} is patched"), format!("The language file was not updated: {e}"))
            };
            crate::notice::show(app, "warn", "patchedNoIni", environment, Some(e), &title, &body);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_43_base64url_characters() {
        let t = mint().unwrap();
        assert!(valid_token(&t), "{}", t.len());
        assert_ne!(t, mint().unwrap());
        assert!(!valid_token("short"));
        assert!(!valid_token(&format!("{}=", &t[..42])));
    }

    #[test]
    fn channels_map_to_live_and_ptu() {
        assert_eq!(channel_of(Path::new("/x/StarCitizen/LIVE")), "live");
        assert_eq!(channel_of(Path::new("/x/StarCitizen/live")), "live");
        assert_eq!(channel_of(Path::new("/x/StarCitizen/HOTFIX")), "ptu");
        assert_eq!(channel_of(Path::new("/x/StarCitizen/EPTU")), "ptu");
        assert_eq!(channel_of(Path::new("/x/StarCitizen/PTU")), "ptu");
        assert_eq!(channel_of(Path::new("/x/StarCitizen/TECH-PREVIEW")), "ptu");
    }

    #[test]
    fn global_ini_keeps_the_casing_of_an_existing_data_folder() {
        let dir = std::env::temp_dir().join(format!("sb-udi-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("Data/Localization")).unwrap();
        assert_eq!(ini_path(&dir), dir.join("Data/Localization/english/global.ini"));
        let _ = std::fs::remove_dir_all(&dir);
        let bare = std::env::temp_dir().join(format!("sb-udi-bare-{}", std::process::id()));
        assert_eq!(ini_path(&bare), bare.join("data/Localization/english/global.ini"));
    }

    /// Against UDI's dev server: STARBUDDY_UDI_URL=http://localhost:8095
    /// STARBUDDY_UDI_TEST_TOKEN=<a token with a profile> cargo test udi_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn udi_live() {
        let token = std::env::var("STARBUDDY_UDI_TEST_TOKEN").expect("STARBUDDY_UDI_TEST_TOKEN");
        // STARBUDDY_UDI_TEST_DIR keeps the installed files for a look afterwards.
        let keep = std::env::var("STARBUDDY_UDI_TEST_DIR").ok();
        let dir = keep.clone().map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join(format!("sb-udi-live-{}", std::process::id()))).join("LIVE");
        std::fs::create_dir_all(dir.join("Data/Localization")).unwrap();
        // The player's own, in the casing Windows users often have.
        std::fs::write(dir.join("USER.cfg"), "r_my_own = 1\r\n").unwrap();
        tauri::async_runtime::block_on(async {
            let resp = get(&token, "/api/starbuddy/profile", None).await.unwrap();
            assert_eq!(resp.status().as_u16(), 200, "no profile for the token");
            let profile: Profile = resp.json().await.unwrap();
            let mut here = Installed::default();
            let r = fetch_and_write(&token, &dir, &profile, &mut here, true).await.unwrap();
            println!("first: ini {} cfg {} backed_up {} version {:?}", r.ini, r.cfg, r.backed_up, r.game_version);
            assert!(r.ini && r.cfg && r.backed_up);
            assert!(dir.join("Data/Localization/english/global.ini").is_file());
            assert_eq!(std::fs::read_to_string(dir.join("user.cfg.before-starbuddy")).unwrap(), "r_my_own = 1\r\n");
            // Written into the player's USER.cfg, not beside it.
            assert_eq!(named_ci(&dir, "user.cfg"), vec![dir.join("USER.cfg")]);
            let cfg = std::fs::read_to_string(dir.join("USER.cfg")).unwrap();
            println!("user.cfg: {cfg:?}");
            // Nothing changed at UDI: both answer 304 and nothing is written.
            let again = fetch_and_write(&token, &dir, &profile, &mut here, false).await.unwrap();
            println!("again: ini {} cfg {}", again.ini, again.cfg);
            assert!(!again.ini && !again.cfg && !again.backed_up);
        });
        if keep.is_none() {
            let _ = std::fs::remove_dir_all(dir.parent().unwrap());
        }
    }

    #[test]
    fn existing_files_are_found_in_any_casing() {
        let dir = std::env::temp_dir().join(format!("sb-udi-ci-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("DATA/localization/English")).unwrap();
        std::fs::write(dir.join("USER.cfg"), "mine").unwrap();
        assert_eq!(child_ci(&dir, "user.cfg"), dir.join("USER.cfg"));
        assert_eq!(ini_path(&dir), dir.join("DATA/localization/English/global.ini"));
        assert_eq!(child_ci(&dir, "missing.txt"), dir.join("missing.txt"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
