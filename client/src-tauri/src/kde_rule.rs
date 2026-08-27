//! KDE: keep overlay windows above the fullscreen game.
//!
//! KWin stacks a *focused fullscreen* window above "keep above" windows, so
//! always-on-top alone loses the moment the player clicks into the game.
//! The layer is not settable through the window protocol — only through a
//! KWin window rule, which is a stanza in ~/.config/kwinrulesrc plus a
//! reconfigure over D-Bus. The rule matches only our own windows (title
//! prefix "StarBuddy — "), is idempotent (fixed id) and reversible.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

const RULE_ID: &str = "7e4d1c2a-9b3f-4e6a-8c5d-0057a2bbdd01";
const RULE_TITLE: &str = "StarBuddy \u{2014} ";

#[derive(Serialize, Clone)]
pub struct KdeRuleInfo {
    /// Linux with a KDE Plasma session.
    pub applicable: bool,
    pub installed: bool,
}

pub fn on_kde() -> bool {
    cfg!(target_os = "linux")
        && std::env::var("XDG_CURRENT_DESKTOP")
            .map(|d| d.to_uppercase().contains("KDE"))
            .unwrap_or(false)
}

fn rules_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("kwinrulesrc"))
}

pub fn installed() -> bool {
    rules_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.contains(&format!("[{RULE_ID}]")))
        .unwrap_or(false)
}

pub fn info() -> KdeRuleInfo {
    KdeRuleInfo { applicable: on_kde(), installed: installed() }
}

/// Rewrite kwinrulesrc with our rule present (`install`) or absent.
/// [General] keeps `count` and the ordered `rules` list; every other
/// section is left as it was.
pub fn set_installed(install: bool) -> Result<(), String> {
    let path = rules_path().ok_or("no config dir")?;
    let text = fs::read_to_string(&path).unwrap_or_default();

    let mut sections: Vec<(String, Vec<String>)> = vec![(String::new(), Vec::new())];
    for line in text.lines() {
        if line.starts_with('[') && line.ends_with(']') {
            sections.push((line[1..line.len() - 1].to_string(), Vec::new()));
        } else {
            sections.last_mut().unwrap().1.push(line.to_string());
        }
    }
    sections.retain(|(name, _)| name != RULE_ID);

    let general_idx = match sections.iter().position(|(n, _)| n == "General") {
        Some(i) => i,
        None => {
            sections.push(("General".into(), Vec::new()));
            sections.len() - 1
        }
    };
    let mut rules: Vec<String> = sections[general_idx]
        .1
        .iter()
        .find_map(|l| l.strip_prefix("rules="))
        .map(|v| v.split(',').filter(|s| !s.is_empty()).map(String::from).collect())
        .unwrap_or_default();
    rules.retain(|r| r != RULE_ID);
    if install {
        rules.push(RULE_ID.to_string());
        sections.push((
            RULE_ID.to_string(),
            vec![
                "Description=StarBuddy overlay above the game (added by StarBuddy)".into(),
                "above=true".into(),
                "aboverule=2".into(),
                "layer=overlay".into(),
                "layerrule=2".into(),
                format!("title={RULE_TITLE}"),
                "titlematch=2".into(),
            ],
        ));
    }
    let general = &mut sections[general_idx].1;
    general.retain(|l| !l.starts_with("count=") && !l.starts_with("rules=") && !l.trim().is_empty());
    general.insert(0, format!("rules={}", rules.join(",")));
    general.insert(0, format!("count={}", rules.len()));

    let mut out = String::new();
    for (name, lines) in &sections {
        let body: Vec<&String> = lines.iter().filter(|l| !l.trim().is_empty()).collect();
        if name.is_empty() && body.is_empty() {
            continue;
        }
        if !name.is_empty() {
            out.push_str(&format!("[{name}]\n"));
        }
        for l in body {
            out.push_str(l);
            out.push('\n');
        }
        out.push('\n');
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, out.trim_end().to_string() + "\n").map_err(|e| e.to_string())?;

    reconfigure_kwin()
}

/// Ask KWin to re-read its rules, with whichever D-Bus tool exists.
fn reconfigure_kwin() -> Result<(), String> {
    let attempts: [(&str, &[&str]); 3] = [
        (
            "dbus-send",
            &["--session", "--type=method_call", "--dest=org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure"],
        ),
        ("qdbus6", &["org.kde.KWin", "/KWin", "reconfigure"]),
        ("qdbus", &["org.kde.KWin", "/KWin", "reconfigure"]),
    ];
    for (cmd, args) in attempts {
        let ok = std::process::Command::new(cmd)
            .args(args)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Ok(());
        }
    }
    Err("Rule written, but KWin could not be told to reload it — log out and in, or run: qdbus6 org.kde.KWin /KWin reconfigure".into())
}

/// Called when an overlay window is first shown: on KDE, make sure the
/// rule exists so the window actually stays above the game.
pub fn ensure(app: &AppHandle) {
    if !on_kde() || installed() {
        return;
    }
    match set_installed(true) {
        Ok(()) => {
            let _ = app.emit("overlay-kde-rule", true);
        }
        Err(e) => log::warn!("KWin rule not installed: {e}"),
    }
}

#[tauri::command]
pub fn overlay_kde_rule() -> KdeRuleInfo {
    info()
}

#[tauri::command]
pub fn overlay_set_kde_rule(install: bool) -> Result<KdeRuleInfo, String> {
    set_installed(install)?;
    Ok(info())
}
