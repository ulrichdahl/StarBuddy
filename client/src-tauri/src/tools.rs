//! The player's own links in the main window's Tools section.
//!
//! The org's pages and the community sites are part of the client; these are
//! the ones a player adds for themselves, kept in client.json with the other
//! preferences so they survive a reinstall of the webview's storage.

use serde::{Deserialize, Serialize};

use crate::prefs::{load_client_prefs, save_client_prefs};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct ToolLink {
    pub(crate) name: String,
    pub(crate) url: String,
}

/// More than anyone keeps in a list they read at a glance.
const MOST_LINKS: usize = 40;

/// A link the browser can open: http or https, with a host, and a name.
fn checked(link: ToolLink) -> Result<ToolLink, String> {
    let name = link.name.trim().to_string();
    let url = link.url.trim().to_string();
    if name.is_empty() {
        return Err("a link needs a name".into());
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .ok_or_else(|| format!("{url} is not a web address (http:// or https://)"))?;
    if rest.split(['/', '?', '#']).next().is_none_or(str::is_empty) {
        return Err(format!("{url} has no site in it"));
    }
    Ok(ToolLink { name: name.chars().take(60).collect(), url })
}

#[tauri::command]
pub fn tool_links_get(app: tauri::AppHandle) -> Vec<ToolLink> {
    load_client_prefs(&app).tool_links
}

/// Replace the player's links; every one is checked before any is kept.
#[tauri::command]
pub fn tool_links_set(app: tauri::AppHandle, links: Vec<ToolLink>) -> Result<Vec<ToolLink>, String> {
    if links.len() > MOST_LINKS {
        return Err(format!("at most {MOST_LINKS} links"));
    }
    let links = links.into_iter().map(checked).collect::<Result<Vec<_>, _>>()?;
    let mut prefs = load_client_prefs(&app);
    prefs.tool_links = links.clone();
    save_client_prefs(&app, &prefs)?;
    Ok(links)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(name: &str, url: &str) -> ToolLink {
        ToolLink { name: name.into(), url: url.into() }
    }

    #[test]
    fn only_web_addresses_with_a_site_and_a_name() {
        assert_eq!(checked(link(" UEX ", " https://uexcorp.space/ ")), Ok(link("UEX", "https://uexcorp.space/")));
        assert!(checked(link("x", "http://localhost:8080")).is_ok());
        assert!(checked(link("", "https://a.b")).is_err());
        assert!(checked(link("x", "file:///etc/passwd")).is_err());
        assert!(checked(link("x", "javascript:alert(1)")).is_err());
        assert!(checked(link("x", "https://")).is_err());
        assert!(checked(link("x", "https:///path")).is_err());
    }
}
