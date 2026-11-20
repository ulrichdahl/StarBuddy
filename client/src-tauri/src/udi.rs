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

/// LIVE, HOTFIX → live; PTU, EPTU, TECH-PREVIEW → ptu.
fn channel_of(live_dir: &Path) -> &'static str {
    let name = live_dir.file_name().map(|n| n.to_string_lossy().to_ascii_uppercase()).unwrap_or_default();
    if ["PTU", "EPTU", "TECH-PREVIEW"].contains(&name.as_str()) {
        "ptu"
    } else {
        "live"
    }
}

/// `<channel>/data/Localization/english/global.ini`, in the casing the folder already has.
fn ini_path(live_dir: &Path) -> PathBuf {
    let data = ["Data", "data"].iter().map(|d| live_dir.join(d)).find(|p| p.is_dir()).unwrap_or_else(|| live_dir.join("data"));
    let loc = ["Localization", "localization"].iter().map(|d| data.join(d)).find(|p| p.is_dir()).unwrap_or_else(|| data.join("Localization"));
    loc.join("english").join("global.ini")
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
                let target = dir.join("user.cfg");
                // A user.cfg StarBuddy did not write is the player's own: kept
                // once, before StarBuddy first replaces it.
                if let Ok(existing) = std::fs::read(&target) {
                    let ours = here.cfg_written.as_deref() == Some(fingerprint(&existing).as_str());
                    let backup = dir.join("user.cfg.before-starbuddy");
                    if !ours && !backup.exists() {
                        std::fs::write(&backup, &existing).map_err(|e| format!("{}: {e}", backup.display()))?;
                        result.backed_up = true;
                    }
                }
                crate::fs_atomic::write(&target, &body).map_err(|e| format!("{}: {e}", target.display()))?;
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

/// Keep installed files current: at start, when the game's build changes,
/// and every few hours, never while the game runs. A new Send is installed
/// too when the player chose automatic install. Only for folders StarBuddy
/// has installed into before.
pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_check: Option<Instant> = None;
        let mut last_branch: Option<String> = None;
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let prefs = load_client_prefs(&app);
            let Some(dir) = crate::game_dir::detect_game_log(app.clone()) else { continue };
            if !prefs.udi.installed.contains_key(&dir) || !matches!(token(&app, false).await, Ok(Some(_))) {
                continue;
            }
            let session = app.try_state::<crate::game_session::SessionState>().map(|s| s.current()).unwrap_or_default();
            if session.running || crate::main_window::game_running() {
                continue;
            }
            let new_build = session.branch.is_some() && session.branch != last_branch;
            let due = last_check.is_none_or(|t| t.elapsed() >= Duration::from_secs(3 * 3600));
            let mut new_send = false;
            if prefs.udi.auto_install && last_check.is_none_or(|t| t.elapsed() >= Duration::from_secs(600)) {
                if let Ok(Some(p)) = udi_profile(app.clone()).await {
                    new_send = prefs.udi.revision != Some(p.revision);
                }
            }
            if !(new_build || due || new_send) {
                continue;
            }
            last_branch = session.branch.clone();
            last_check = Some(Instant::now());
            match install_into(&app, &dir, false).await {
                Ok(r) if r.ini || r.cfg => log::info!("UnitedDanes files brought up to date (global.ini {}, user.cfg {})", r.ini, r.cfg),
                Ok(_) => {}
                Err(e) => log::info!("UnitedDanes files not checked: {e}"),
            }
        }
    });
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
        assert_eq!(channel_of(Path::new("/x/StarCitizen/HOTFIX")), "live");
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
        std::fs::write(dir.join("user.cfg"), "r_my_own = 1\r\n").unwrap();
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
            let cfg = std::fs::read_to_string(dir.join("user.cfg")).unwrap();
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
}
