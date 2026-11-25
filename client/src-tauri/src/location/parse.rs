//! EXPERIMENT: what the debug text's lines say about where the player is.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// One coordinate frame the player is in, and where in it, in metres.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Zone {
    pub name: String,
    pub pos: [f64; 3],
}

/// What one look at the corner said.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Fix {
    /// Innermost frame first, `Root` last.
    pub zones: Vec<Zone>,
    pub location: Option<String>,
    /// The planet's zone name from `Planet:OOC_Stanton_4_Microtech (Load
    /// Complete)`; None for "No Current Planet" or a line not read.
    pub planet: Option<String>,
    /// The game server, e.g. `pub-euw1b-sc-alpha-4100-13190956-game-241`.
    pub server: Option<String>,
}

impl Fix {
    /// The solar system's own frame, by its zone name.
    pub fn system(&self) -> Option<&Zone> {
        self.zones.iter().find(|z| z.name.starts_with("SolarSystem"))
    }

    /// The planet's own frame: it turns with the planet, so a point on the
    /// ground keeps its coordinates in it.
    pub fn planet_zone(&self) -> Option<&Zone> {
        let squash = |s: &str| s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
        let named = self.planet.as_deref().map(squash);
        self.zones
            .iter()
            .find(|z| named.as_deref() == Some(squash(&z.name).as_str()))
            .or_else(|| self.zones.iter().find(|z| z.name.starts_with("OOC_")))
    }
}

/// Systems whose names the location line gives without a number after them.
const SYSTEMS: [&str; 4] = ["Stanton", "Pyro", "Nyx", "Castra"];
static SYSTEM_IN_ZONE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^OOC_([A-Z][a-z]+)_?\d").unwrap());
static SYSTEM_IN_PLACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b([A-Z][a-z]{2,})(\d+[a-z]?\b|SolarSystem)").unwrap());
static PLANET_PART: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^OOC_[A-Za-z]+_?\d+[a-z]?_").unwrap());

impl Fix {
    /// The star system's name, `Stanton`, from a planet zone or the location line.
    pub fn system_name(&self) -> Option<String> {
        if let Some(c) = self.zones.iter().find_map(|z| SYSTEM_IN_ZONE.captures(&z.name)) {
            return Some(c[1].to_string());
        }
        let loc = self.location.as_deref()?;
        if let Some(c) = SYSTEM_IN_PLACE.captures(loc) {
            return Some(c[1].to_string());
        }
        SYSTEMS.iter().find(|s| loc.split_whitespace().any(|w| w == **s)).map(|s| s.to_string())
    }

    /// A short name for where the player is, for a new beacon: the landing
    /// zone or station (`Area18`, `RR HUR L3`), else the planet or moon
    /// (`ArcCorp`, `Ita`), else `Stanton space`.
    pub fn area(&self) -> String {
        let system = self.system_name();
        if let Some(loc) = self.location.as_deref() {
            let loc = loc.split("(LZ").next().unwrap_or("").trim();
            let words: Vec<&str> = loc
                .split_whitespace()
                .filter(|w| {
                    // `Stanton3`, `Stanton1d`, `StantonSolarSystem`, `Nyx`: the system, not the place.
                    let named = |n: &str| Some(n) == system.as_deref() || SYSTEMS.contains(&n);
                    let numbered = SYSTEM_IN_PLACE.captures(w).is_some_and(|c| &c[0] == *w && named(&c[1]));
                    !(numbered || named(w))
                })
                .collect();
            if !words.is_empty() && !loc.eq_ignore_ascii_case("INVALID LOCATION ID") {
                return words.join(" ");
            }
        }
        if let Some(z) = self.planet_zone() {
            let part = PLANET_PART.replace(&z.name, "").replace('_', " ");
            if !part.is_empty() {
                return part;
            }
        }
        match system {
            Some(s) => format!("{s} space"),
            None => "Space".into(),
        }
    }
}

static ZONE: LazyLock<Regex> = LazyLock::new(|| {
    // On a bright background a gap can read as `_`, `.` or `+`.
    Regex::new(r"Zone:\s*(\S.*?)[\s_]+Pos:[\s._+]*(-?\d+\.\d+)(k?m)[\s._+]+(-?\d+\.\d+)(k?m)[\s._+]+(-?\d+\.\d+)(k?m)$").unwrap()
});
static LOCATION: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"location\s*:\s*(.+)$").unwrap());
static SERVER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(pub-[a-z0-9-]+?-game-\d+)").unwrap());
static PLANET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^Planet\s*:\s*([A-Za-z0-9_ ]+?)(\s{2,}|\s*[(+]|$)").unwrap());

fn metres(value: &str, unit: &str) -> Option<f64> {
    let v: f64 = value.parse().ok()?;
    Some(if unit == "km" { v * 1000.0 } else { v })
}

/// A line that does not fit its pattern exactly is dropped, not guessed at.
pub fn parse(lines: &[String]) -> Fix {
    let mut fix = Fix::default();
    for line in lines {
        if let Some(c) = ZONE.captures(line) {
            let pos = (metres(&c[2], &c[3]), metres(&c[4], &c[5]), metres(&c[6], &c[7]));
            if let (Some(x), Some(y), Some(z)) = pos {
                // The reader sees `_` as a gap.
                let name = c[1].split_whitespace().collect::<Vec<_>>().join("_").trim_matches('_').to_string();
                fix.zones.push(Zone { name, pos: [x, y, z] });
            }
        } else if let Some(c) = LOCATION.captures(line) {
            fix.location = Some(c[1].split_whitespace().collect::<Vec<_>>().join(" "));
        } else if let Some(c) = SERVER.captures(line) {
            // The words around it are small and wobble; the name itself reads.
            fix.server = Some(c[1].to_string());
        } else if let Some(c) = PLANET.captures(line) {
            fix.planet = Some(c[1].split_whitespace().collect::<Vec<_>>().join("_"));
        }
    }
    fix
}

#[cfg(test)]
mod tests {
    #[test]
    fn gaps_misread_on_a_bright_background_still_parse() {
        let lines = vec![
            "Zone: OOC_Stanton_1d_Ita_Pos: 511.8231km -37.9915km -84.87m".to_string(),
            "Zone: Root Pos:.12829972.5096km_115376.2431km+-84.87m".to_string(),
        ];
        let fix = super::parse(&lines);
        assert_eq!(fix.zones[0].name, "OOC_Stanton_1d_Ita");
        let p = fix.zones[1].pos;
        assert!((p[0] - 12829972509.6).abs() < 0.01 && (p[1] - 115376243.1).abs() < 0.01 && p[2] == -84.87);
    }

    #[test]
    fn a_place_gets_a_short_name() {
        let fix = |loc: Option<&str>, zones: &[&str]| super::Fix {
            zones: zones.iter().map(|n| super::Zone { name: n.to_string(), pos: [0.0; 3] }).collect(),
            location: loc.map(String::from),
            planet: None,
            server: None,
        };
        let f = fix(Some("Stanton3 Area18 (LZ : Stanton3 Area18)"), &["Hangar_X_1", "OOC_Stanton_3_ArcCorp", "SolarSystem_1"]);
        assert_eq!(f.area(), "Area18");
        assert_eq!(f.system_name().as_deref(), Some("Stanton"));
        assert_eq!(fix(Some("Hospital Stanton4 NewBabbage  (LZ : Stanton4 NewBabbage)"), &[]).area(), "Hospital NewBabbage");
        assert_eq!(fix(Some("RR HUR L3 (LZ : RR HUR L3)"), &[]).area(), "RR HUR L3");
        assert_eq!(fix(Some("Stanton1d"), &["OOC_Stanton_1d_Ita", "SolarSystem_1"]).area(), "Ita");
        assert_eq!(fix(Some("StantonSolarSystem"), &["SolarSystem_1"]).area(), "Stanton space");
        let nyx = fix(Some("Nyx Levski  (LZ : Nyx Levski)"), &["SolarSystem_1"]);
        assert_eq!(nyx.area(), "Levski");
        assert_eq!(nyx.system_name().as_deref(), Some("Nyx"));
        assert_eq!(fix(None, &["SolarSystem_1"]).area(), "Space");
    }

    use super::*;

    #[test]
    fn zone_lines_become_metres() {
        let fix = parse(&[
            "Zone: levski v2 middeck Pos: 49.51m 34.60m -0.05m".into(),
            "Zone: SolarSystem 926420131073 Pos: -9641670.6879km -11490734.1816km -91.2973km".into(),
            "Zone: levski all-001 Pos: 1090y6Zm 1201.07m 2803.41m".into(),
            "Current player location : Nyx Levski  (LZ : Nyx Levski)".into(),
            "No Current Planet".into(),
            "Server: pub-euw1b-sc-alpha-4100-13190956-game-241, restarts 0, pop. [shard 504, srv 34]".into(),
        ]);
        assert_eq!(fix.server.as_deref(), Some("pub-euw1b-sc-alpha-4100-13190956-game-241"));
        assert_eq!(fix.zones.len(), 2);
        assert_eq!(fix.zones[0].name, "levski_v2_middeck");
        assert_eq!(fix.zones[0].pos, [49.51, 34.60, -0.05]);
        assert_eq!(fix.system().unwrap().name, "SolarSystem_926420131073");
        assert!((fix.system().unwrap().pos[0] + 9641670687.9).abs() < 1e-3);
        assert_eq!(fix.location.as_deref(), Some("Nyx Levski (LZ : Nyx Levski)"));
        assert_eq!(fix.planet, None);
        let fix = parse(&[
            "Zone: OOC Stanton 4 Microtech Pos: 521.0038km 419.3996km 744.0608km".into(),
            "Zone: SolarSystem 926669998366 Pos: 22462509.4629km 37186262.0592km 744.0608km".into(),
            "Planet:OOC Stanton 4 Microtech (working) (Load Complete)".into(),
        ]);
        assert_eq!(fix.planet.as_deref(), Some("OOC_Stanton_4_Microtech"));
        assert_eq!(fix.planet_zone().unwrap().name, "OOC_Stanton_4_Microtech");
    }
}
