//! "What's new": per-version notes for live releases (CHANGELOG.md section
//! for the running version) and, for dev builds, the commit list since the
//! last live release that CI writes into changes.txt before building.

use serde::Serialize;

const CHANGELOG: &str = include_str!("../../../CHANGELOG.md");
const DEV_COMMITS: &str = include_str!("../changes.txt");

#[derive(Serialize, Clone, Debug)]
pub struct Changes {
    /// "release" | "dev"
    pub channel: String,
    pub version: String,
    pub build: Option<String>,
    /// Dev builds: the live tag the commit list counts from.
    pub since: Option<String>,
    /// Bullet points from CHANGELOG.md (this version, or "Unreleased" on dev).
    pub summary: Vec<String>,
    /// Dev builds: commit subjects since the last live release.
    pub commits: Vec<String>,
}

/// Bullet lines of the `## <heading>` section whose first token matches.
pub fn changelog_section(changelog: &str, heading_token: &str) -> Vec<String> {
    let mut in_section = false;
    let mut out = Vec::new();
    for line in changelog.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            in_section = rest.split_whitespace().next() == Some(heading_token);
            continue;
        }
        if in_section {
            if let Some(item) = line.trim_start().strip_prefix("- ") {
                out.push(item.trim().to_string());
            }
        }
    }
    out
}

/// changes.txt: an optional `# since <tag>` header, then one subject per line.
pub fn dev_commits(text: &str) -> (Option<String>, Vec<String>) {
    let mut since = None;
    let mut commits = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("# since ") {
            since = Some(rest.trim().to_string());
        } else if !line.starts_with('#') {
            commits.push(line.to_string());
        }
    }
    (since, commits)
}

#[tauri::command]
pub fn app_changes() -> Changes {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let build = option_env!("STARBUDDY_BUILD").map(str::to_string);
    if build.is_some() {
        let (since, commits) = dev_commits(DEV_COMMITS);
        Changes {
            channel: "dev".into(),
            version,
            build,
            since,
            summary: changelog_section(CHANGELOG, "Unreleased"),
            commits,
        }
    } else {
        Changes {
            channel: "release".into(),
            summary: changelog_section(CHANGELOG, &version),
            version,
            build: None,
            since: None,
            commits: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sections_and_commit_lists() {
        let log = "# Changelog\n\n## Unreleased\n\n- soon\n\n## 0.1.7 — 2026-08-27\n\n- status overlay\n- rename\n\n## 0.1.6 — 2026-08-26\n\n- alarm\n";
        assert_eq!(changelog_section(log, "0.1.7"), vec!["status overlay", "rename"]);
        assert_eq!(changelog_section(log, "Unreleased"), vec!["soon"]);
        assert!(changelog_section(log, "9.9.9").is_empty());
        let (since, commits) = dev_commits("# since v0.1.7\nScan v1\n\nOverlay: strips\n# comment\n");
        assert_eq!(since.as_deref(), Some("v0.1.7"));
        assert_eq!(commits, vec!["Scan v1", "Overlay: strips"]);
        // The real changelog has a section for the version being built, or Unreleased.
        assert!(!changelog_section(CHANGELOG, "0.1.7").is_empty());
    }
}
