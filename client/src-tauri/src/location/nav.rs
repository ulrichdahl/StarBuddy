//! EXPERIMENT: speed, and the way to a beacon, from positions.
//!
//! The debug text says where the player is but not which way they face. In a
//! planet's atmosphere the game's telemetry gives the ship's compass heading,
//! and the turn is from the nose; elsewhere it is taken from the way they are
//! moving: "the beacon is 30° to the right of where you are going, and 5°
//! above". Standing still in space, only the bearing in the frame's own axes
//! is known.

use super::parse::Zone;
use serde::Serialize;

type V = [f64; 3];

fn sub(a: V, b: V) -> V {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: V, b: V) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V, b: V) -> V {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn scale(a: V, s: f64) -> V {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn len(a: V) -> f64 {
    dot(a, a).sqrt()
}
fn unit(a: V) -> Option<V> {
    let l = len(a);
    (l > 1e-9).then(|| scale(a, 1.0 / l))
}
/// The part of `a` across `up`.
fn flat(a: V, up: V) -> V {
    sub(a, scale(up, dot(a, up)))
}

/// A frame bigger than this around its origin is a planet's or a moon's,
/// where "up" is away from the centre.
const PLANET_FRAME: f64 = 50_000.0;

/// Up, east and north at `pos` in a frame. In a planet's frame up points away
/// from the centre and north towards +z; in any other, the frame's own axes.
fn axes(pos: V) -> (V, V, V) {
    if len(pos) > PLANET_FRAME {
        let up = unit(pos).unwrap_or([0.0, 0.0, 1.0]);
        if let Some(east) = unit(cross([0.0, 0.0, 1.0], up)) {
            return (up, east, cross(up, east));
        }
    }
    ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0])
}

/// The innermost frame both lists of zones share, by exact name. The
/// SolarSystem zone's number differs from shard to shard (the same spot at
/// Levski was `SolarSystem_926420131073` on one, `SolarSystem_926390131059` on
/// the next), so an exact match also means the same shard.
pub fn common<'a>(a: &'a [Zone], b: &'a [Zone]) -> Option<(&'a Zone, &'a Zone)> {
    a.iter().find_map(|za| b.iter().find(|zb| zb.name == za.name).map(|zb| (za, zb)))
}

fn is_system(z: &Zone) -> bool {
    z.name.starts_with("SolarSystem")
}

/// How the player moved between two fixes `dt` seconds apart, in every
/// frame both name: (frame, velocity in m/s).
pub fn velocities(before: &[Zone], now: &[Zone], dt: f64) -> Vec<(String, V)> {
    if dt <= 0.0 {
        return Vec::new();
    }
    now.iter()
        .filter_map(|n| before.iter().find(|b| b.name == n.name).map(|b| (n.name.clone(), scale(sub(n.pos, b.pos), 1.0 / dt))))
        .collect()
}

/// The speed worth showing: over the planet's ground when on or near one
/// (the system's frame would add the planet's own turning and orbit), in the
/// system otherwise, never in a ship's own frame, which moves with you.
pub fn ground_speed(vels: &[(String, V)], planet: Option<&str>) -> Option<(String, f64)> {
    let pick = |want: &dyn Fn(&str) -> bool| vels.iter().find(|(f, _)| want(f)).map(|(f, v)| (f.clone(), len(*v)));
    planet.and_then(|p| pick(&|f| f == p)).or_else(|| pick(&|f| f.starts_with("SolarSystem")))
}

#[derive(Serialize, Clone, Debug)]
pub struct Nav {
    /// The frame the beacon is measured in.
    pub frame: String,
    pub distance: f64,
    /// Bearing in the frame's own axes, 0..360, and height above the horizon.
    pub azimuth: f64,
    pub elevation: f64,
    /// Metres a second the distance shrinks.
    pub closing: Option<f64>,
    pub eta: Option<f64>,
    /// Moving: how far right (+) or left (−) of the way you are going the
    /// beacon is, and how far above (+) or below (−).
    pub turn: Option<f64>,
    pub climb: Option<f64>,
    /// Moving: the whole angle between where you go and where it is.
    pub off: Option<f64>,
    /// `turn` is from the ship's compass heading rather than its travel.
    pub compass: bool,
}

/// -180..180.
fn wrap(deg: f64) -> f64 {
    (deg + 540.0).rem_euclid(360.0) - 180.0
}

/// The way from `now` to `beacon`, with the player's velocity in each frame
/// and, in an atmosphere, the ship's compass heading.
pub fn to_beacon(now: &[Zone], beacon: &[Zone], vels: &[(String, V)], heading: Option<f64>) -> Option<Nav> {
    let (here, there) = common(now, beacon)?;
    let d = sub(there.pos, here.pos);
    let distance = len(d);
    // The system's frame has no ground: its own axes, +z up.
    let (up, east, north) = if is_system(here) { axes([0.0; 3]) } else { axes(here.pos) };
    let dh = flat(d, up);
    let azimuth = (dot(dh, east).atan2(dot(dh, north)).to_degrees() + 360.0) % 360.0;
    let elevation = dot(d, up).atan2(len(dh)).to_degrees();
    let v = vels.iter().find(|(f, _)| *f == here.name).map(|(_, v)| *v);
    let mut nav = Nav {
        frame: here.name.clone(),
        distance,
        azimuth,
        elevation,
        closing: None,
        eta: None,
        turn: None,
        climb: None,
        off: None,
        compass: false,
    };
    if let Some(v) = v {
        let toward = unit(d);
        let closing = toward.map(|t| dot(v, t)).unwrap_or(0.0);
        nav.closing = Some(closing);
        if closing > 0.1 {
            nav.eta = Some(distance / closing);
        }
        if len(v) > 0.5 {
            if let Some(t) = toward {
                nav.off = Some(dot(unit(v).unwrap(), t).clamp(-1.0, 1.0).acos().to_degrees());
            }
            let vh = flat(v, up);
            if len(vh) > 0.2 && len(dh) > 1e-6 {
                // Seen from above, counter-clockwise is left.
                let left = dot(cross(vh, dh), up).atan2(dot(vh, dh)).to_degrees();
                nav.turn = Some(-left);
            }
            let ve = dot(v, up).atan2(len(vh)).to_degrees();
            nav.climb = Some(elevation - ve);
        }
    }
    // The compass counts from the planet's north, as `axes` does, so the
    // turn is the bearing less the heading. It wins over travel: the nose is
    // where the player looks, and it is known hovering.
    let on_planet = !is_system(here) && len(here.pos) > PLANET_FRAME;
    if let (Some(h), true) = (heading, on_planet) {
        nav.turn = Some(wrap(azimuth - h));
        nav.compass = true;
        if nav.climb.is_none() {
            nav.climb = Some(elevation);
        }
    }
    Some(nav)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn z(name: &str, pos: V) -> Zone {
        Zone { name: name.into(), pos }
    }

    #[test]
    fn another_shards_system_shares_no_frame() {
        let here = vec![z("deck", [1.0, 0.0, 0.0]), z("SolarSystem_1", [10.0, 0.0, 0.0])];
        assert_eq!(common(&here, &[z("SolarSystem_1", [20.0, 0.0, 0.0])]).unwrap().0.name, "SolarSystem_1");
        assert!(common(&here, &[z("SolarSystem_2", [20.0, 0.0, 0.0])]).is_none());
    }

    #[test]
    fn speed_is_over_the_ground_or_in_the_system_never_in_the_ship() {
        let before = vec![z("ship", [1.0, 0.0, 0.0]), z("OOC_P", [0.0, 0.0, 0.0]), z("SolarSystem_1", [0.0, 0.0, 0.0])];
        let now = vec![z("ship", [1.0, 0.0, 0.0]), z("OOC_P", [3.0, 4.0, 0.0]), z("SolarSystem_1", [900.0, 0.0, 0.0])];
        let vels = velocities(&before, &now, 1.0);
        assert_eq!(ground_speed(&vels, Some("OOC_P")).unwrap(), ("OOC_P".to_string(), 5.0));
        assert_eq!(ground_speed(&vels, None).unwrap(), ("SolarSystem_1".to_string(), 900.0));
    }

    #[test]
    fn a_beacon_to_the_right_of_travel_turns_right() {
        // Space frame: up is +z, travelling +y (north), beacon to the east (+x).
        let now = vec![z("SolarSystem_1", [0.0, 0.0, 0.0])];
        let beacon = vec![z("SolarSystem_1", [100.0, 100.0, 0.0])];
        let vels = vec![("SolarSystem_1".to_string(), [0.0, 10.0, 0.0])];
        let nav = to_beacon(&now, &beacon, &vels, None).unwrap();
        assert!((nav.turn.unwrap() - 45.0).abs() < 1e-6, "{nav:?}");
        assert!((nav.azimuth - 45.0).abs() < 1e-6);
        assert!(nav.climb.unwrap().abs() < 1e-6);
        assert!((nav.distance - 141.42135).abs() < 1e-3);
    }

    #[test]
    fn on_a_planet_up_is_away_from_the_centre() {
        let r = 300_000.0;
        let now = vec![z("planet", [r, 0.0, 0.0])];
        let beacon = vec![z("planet", [r + 100.0, 0.0, 0.0])];
        let nav = to_beacon(&now, &beacon, &[], None).unwrap();
        assert!((nav.elevation - 90.0).abs() < 1e-6);
    }

    #[test]
    fn in_the_air_the_compass_heading_gives_the_turn_standing_still() {
        // On the equator at +x: north is +z, east is +y. Beacon to the east.
        let r = 300_000.0;
        let now = vec![z("planet", [r, 0.0, 0.0])];
        let beacon = vec![z("planet", [r, 1000.0, 0.0])];
        let nav = to_beacon(&now, &beacon, &[], Some(0.0)).unwrap();
        assert!((nav.azimuth - 90.0).abs() < 1e-3, "{nav:?}");
        assert!((nav.turn.unwrap() - 90.0).abs() < 1e-3);
        assert!(nav.compass);
        // Facing 300°: the beacon at 90° is 150° to the right.
        let nav = to_beacon(&now, &beacon, &[], Some(300.0)).unwrap();
        assert!((nav.turn.unwrap() - 150.0).abs() < 1e-3);
        // In the system's frame a heading means nothing.
        let sys = vec![z("SolarSystem_1", [r, 0.0, 0.0])];
        let nav = to_beacon(&sys, &[z("SolarSystem_1", [r, 1000.0, 0.0])], &[], Some(0.0)).unwrap();
        assert!(nav.turn.is_none() && !nav.compass);
    }
}
