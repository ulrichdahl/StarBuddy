//! The names the game shows players for the frames the debug text gives,
//! the ones the star map uses: `OOC_Stanton3_L2` is ARC L2,
//! `OOC_Stanton_3_ArcCorp` is ArcCorp, `OOC_Stanton_1d_Ita` is Ita. Looked up
//! in the game's own global.ini under the frame's key (`Stanton3_L2`,
//! `Stanton3`, `Stanton1d`).

use crate::game_session::Names;
use crate::lock::LockExt;
use regex::Regex;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

/// `OOC_<system>[_]<number><moon letter>[_L<n>]`, then anything.
static FRAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^OOC_([A-Za-z]+)_?(\d+[a-z]?)(_L\d+)?(?:_|$)").unwrap());

static NAMES: LazyLock<Mutex<Option<Names>>> = LazyLock::new(Mutex::default);

/// Where global.ini is: the game folder the client follows.
pub fn set_game_dir(dir: &Path) {
    *NAMES.lock_or_recover() = Some(Names::new(dir));
}

/// The global.ini key a frame is named under.
pub fn key(frame: &str) -> Option<String> {
    let c = FRAME.captures(frame)?;
    Some(format!("{}{}{}", &c[1], &c[2], c.get(3).map_or("", |m| m.as_str())))
}

/// The frame's name in the game, when the game names it.
pub fn name(frame: &str) -> Option<String> {
    let key = key(frame)?;
    NAMES.lock_or_recover().as_mut()?.key(&key)
}

/// Whether a name is a Lagrange point's (`ARC L2`, `PYR1 L4`): a place you
/// are at, not on.
pub fn is_lagrange(name: &str) -> bool {
    name.rsplit(' ').next().is_some_and(|w| w.len() >= 2 && w.starts_with('L') && w[1..].chars().all(|c| c.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_lead_to_their_keys() {
        assert_eq!(key("OOC_Stanton3_L2").as_deref(), Some("Stanton3_L2"));
        assert_eq!(key("OOC_Stanton_3_ArcCorp").as_deref(), Some("Stanton3"));
        assert_eq!(key("OOC_Stanton_1d_Ita").as_deref(), Some("Stanton1d"));
        assert_eq!(key("OOC_Pyro5_L3").as_deref(), Some("Pyro5_L3"));
        assert_eq!(key("SolarSystem_926390131054"), None);
        assert!(is_lagrange("ARC L2") && is_lagrange("PYR1 L4"));
        assert!(!is_lagrange("ArcCorp") && !is_lagrange("Lorville"));
    }
}
