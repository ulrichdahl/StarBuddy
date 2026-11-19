use serde::{Deserialize, Serialize};

use crate::http;

// ── Update check ───────────────────────────────────────────────────────────
// Asks GitHub for the latest release and compares its tag with the version
// compiled into this binary. Any failure is an Err — the UI treats that as
// "no update information", never as an available update.

const RELEASES_API_URL: &str = "https://api.github.com/repos/ulrichdahl/StarBuddy/releases/latest";
const RELEASES_PAGE_URL: &str = "https://github.com/ulrichdahl/StarBuddy/releases/latest";
const DEV_RELEASE_API_URL: &str = "https://api.github.com/repos/ulrichdahl/StarBuddy/releases/tags/dev";
const DEV_RELEASE_PAGE_URL: &str = "https://github.com/ulrichdahl/StarBuddy/releases/tag/dev";

#[derive(Serialize, Clone)]
pub struct UpdateCheck {
    pub current: String,
    /// Own build stamp ("dev-20260827-1025") on dev builds.
    pub build: Option<String>,
    /// Latest live release.
    pub latest: String,
    pub url: String,
    pub update_available: bool,
    /// Release notes of the latest live release (trimmed).
    pub notes: Option<String>,
    /// Dev builds only: the rolling dev release's build stamp and notes.
    pub latest_dev: Option<String>,
    pub dev_url: Option<String>,
    pub dev_update_available: bool,
    pub dev_notes: Option<String>,
}

/// "dev-YYYYMMDD-HHMM" out of the dev release body ("Build `dev-…` …").
fn dev_stamp_in(text: &str) -> Option<String> {
    let idx = text.find("dev-")?;
    let stamp: String = text[idx..].chars().take(17).collect();
    let ok = stamp.len() == 17
        && stamp[4..12].chars().all(|c| c.is_ascii_digit())
        && &stamp[12..13] == "-"
        && stamp[13..].chars().all(|c| c.is_ascii_digit());
    ok.then_some(stamp)
}

fn trim_notes(body: Option<String>) -> Option<String> {
    let body = body?.trim().to_string();
    if body.is_empty() {
        return None;
    }
    Some(if body.chars().count() > 2000 {
        let cut: String = body.chars().take(2000).collect();
        format!("{cut}…")
    } else {
        body
    })
}

/// Parse "v1.2.3", "1.2.3-beta.1" or "v1.2" into a (major, minor, patch)
/// triple. A leading `v` is stripped, anything after `-` (prerelease) or `+`
/// (build metadata) is ignored, and missing minor/patch default to 0.
fn parse_semver(s: &str) -> Option<(u64, u64, u64)> {
    let core = s.trim().trim_start_matches(['v', 'V']);
    let core = core.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.trim().parse().ok()?;
    let minor = parts.next().unwrap_or("0").trim().parse().ok()?;
    let patch = parts.next().unwrap_or("0").trim().parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    html_url: Option<String>,
    body: Option<String>,
}

async fn fetch_release(url: &str) -> Result<GhRelease, String> {
    // GitHub refuses requests without a User-Agent; the shared client sends one.
    let resp = http::client()
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Could not reach GitHub: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("GitHub said {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// Live releases: compare versions. Dev builds additionally compare their
/// build stamp with the rolling dev release, so testers hear about newer
/// dev builds too. Notes come along for the banner.
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateCheck, String> {
    let current = env!("CARGO_PKG_VERSION");
    let build = option_env!("STARBUDDY_BUILD").map(str::to_string);
    let current_v = parse_semver(current).ok_or_else(|| format!("Unparseable own version: {current}"))?;

    let release = fetch_release(RELEASES_API_URL).await?;
    let latest_v = parse_semver(&release.tag_name)
        .ok_or_else(|| format!("Unparseable release tag: {}", release.tag_name))?;

    let (mut latest_dev, mut dev_url, mut dev_update_available, mut dev_notes) = (None, None, false, None);
    if let Some(own) = &build {
        // A failing dev lookup must not hide a live update: log and move on.
        match fetch_release(DEV_RELEASE_API_URL).await {
            Ok(dev) => {
                let stamp = dev.body.as_deref().and_then(dev_stamp_in);
                dev_update_available = stamp.as_deref().is_some_and(|s| s > own.as_str());
                latest_dev = stamp;
                dev_url = Some(dev.html_url.filter(|u| !u.trim().is_empty()).unwrap_or_else(|| DEV_RELEASE_PAGE_URL.to_string()));
                dev_notes = trim_notes(dev.body);
            }
            Err(e) => log::warn!("dev release lookup failed: {e}"),
        }
    }

    Ok(UpdateCheck {
        current: current.to_string(),
        build,
        latest: release.tag_name.trim().trim_start_matches(['v', 'V']).to_string(),
        url: release.html_url.filter(|u| !u.trim().is_empty()).unwrap_or_else(|| RELEASES_PAGE_URL.to_string()),
        update_available: latest_v > current_v,
        notes: trim_notes(release.body),
        latest_dev,
        dev_url,
        dev_update_available,
        dev_notes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_stamps() {
        assert_eq!(dev_stamp_in("Build `dev-20260827-1025` (UTC) of `main`"), Some("dev-20260827-1025".into()));
        assert_eq!(dev_stamp_in("nothing here"), None);
        assert_eq!(dev_stamp_in("dev-2026-broken"), None);
        assert!("dev-20260827-1025" > "dev-20260827-0950");
    }

    #[test]
    fn semver_parsing_and_ordering() {
        assert_eq!(parse_semver("v0.1.4"), Some((0, 1, 4)));
        assert_eq!(parse_semver("0.1.4"), Some((0, 1, 4)));
        assert_eq!(parse_semver("v1.2"), Some((1, 2, 0)));
        assert_eq!(parse_semver("v0.2.0-beta.1"), Some((0, 2, 0)));
        assert_eq!(parse_semver("v0.2.0+build.7"), Some((0, 2, 0)));
        assert_eq!(parse_semver("nightly"), None);
        assert_eq!(parse_semver("v1.2.3.4"), None);
        assert_eq!(parse_semver(""), None);

        let current = parse_semver("0.1.4").unwrap();
        assert!(parse_semver("v0.1.4").unwrap() == current); // equal → no update
        assert!(parse_semver("v0.1.3").unwrap() < current); // older → no update
        assert!(parse_semver("v0.1.5").unwrap() > current); // newer patch
        assert!(parse_semver("v0.2.0").unwrap() > current); // newer minor
        assert!(parse_semver("v1.0.0").unwrap() > current); // newer major
        assert!(parse_semver("v0.1.4-rc.1").unwrap() == current); // prerelease of same → no update
        assert!(parse_semver("v0.1.5-rc.1").unwrap() > current); // prerelease of newer → update
    }
}
