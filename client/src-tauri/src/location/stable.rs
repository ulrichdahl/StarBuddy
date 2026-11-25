//! EXPERIMENT: keeping misreads off the instruments.
//!
//! The reader is right almost always and wrong in a few ways: a letter or a
//! digit now and then, rarely the same way twice in a row. So:
//!
//! * a text keeps its accepted value until a new one has been read the same
//!   twice in a row, or three times when it is only a letter or two from the
//!   accepted one, which is more likely the same name misread;
//! * a zone name a letter or two from a name seen many times is that name;
//! * a position must land where the last accepted one and its velocity say it
//!   could. One that does not is held back; if the next continues smoothly
//!   from it, both were real (quantum travel, a hand-over), and if the next
//!   swings back, it was a misread digit. Three held back in a row and the
//!   track starts over, so the instruments never freeze for long.

use super::parse::Fix;
#[cfg(test)]
use super::parse::Zone;
use std::collections::HashMap;
use std::time::{Duration, Instant};

type V = [f64; 3];

fn sub(a: V, b: V) -> V {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn len(a: V) -> f64 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}
fn dot(a: V, b: V) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for j in 0..b.len() {
            let cur = row[j + 1];
            row[j + 1] = (prev + usize::from(ca != b[j])).min(row[j] + 1).min(cur + 1);
            prev = cur;
        }
    }
    row[b.len()]
}

/// Whether `b` is close enough to `a` to be `a` misread. Names with a long
/// number in them (system and object ids) allow one character: Nyx and
/// Stanton on one shard were …370 and …366.
fn near(a: &str, b: &str) -> bool {
    let has_id = a.chars().filter(|c| c.is_ascii_digit()).count() >= 6;
    let limit = if has_id { 1 } else { (a.chars().count() / 10).clamp(1, 3) };
    distance(a, b) <= limit
}

/// A text that changes only when the reader agrees with itself.
#[derive(Default)]
pub struct Text {
    accepted: Option<String>,
    candidate: Option<String>,
    count: u32,
}

impl Text {
    pub fn feed(&mut self, read: Option<&str>) -> Option<String> {
        let Some(read) = read else { return self.accepted.clone() };
        if self.accepted.as_deref() == Some(read) {
            self.candidate = None;
            self.count = 0;
            return self.accepted.clone();
        }
        if self.candidate.as_deref() == Some(read) {
            self.count += 1;
        } else {
            self.candidate = Some(read.to_string());
            self.count = 1;
        }
        let needed = match &self.accepted {
            None => 1,
            Some(a) if near(a, read) => 3,
            Some(_) => 2,
        };
        if self.count >= needed {
            self.accepted = self.candidate.take();
            self.count = 0;
        }
        self.accepted.clone()
    }

    pub fn get(&self) -> Option<&str> {
        self.accepted.as_deref()
    }
}

/// Zone names seen before, and how often.
#[derive(Default)]
pub struct Names {
    seen: HashMap<String, u32>,
}

impl Names {
    /// The name as read, or the well-known name it is a misreading of.
    pub fn snap(&mut self, read: &str) -> String {
        let name = if self.seen.contains_key(read) {
            read.to_string()
        } else {
            self.seen
                .iter()
                .filter(|(known, n)| **n >= 3 && near(known, read))
                .max_by_key(|(_, n)| **n)
                .map(|(known, _)| known.clone())
                .unwrap_or_else(|| read.to_string())
        };
        *self.seen.entry(name.clone()).or_default() += 1;
        name
    }
}

/// Ships stay under this without quantum travel, about 15 g.
const ACCEL: f64 = 150.0;
const SLACK: f64 = 5.0;
/// Of the current speed, how far the prediction may be off per second.
const SPEED_SLACK: f64 = 0.1;
/// With only one point there is no velocity to predict from: anything a
/// ship does outside quantum travel is allowed.
const FLIGHT_SPEED: f64 = 2000.0;
const STALE: Duration = Duration::from_secs(10);
const GIVE_UP: u32 = 3;

/// One frame's positions over time.
#[derive(Default)]
pub struct Track {
    last: Option<(V, Instant)>,
    vel: Option<V>,
    pending: Option<(V, Instant)>,
    rejected: u32,
}

impl Track {
    pub fn reset(&mut self) {
        *self = Track::default();
    }

    /// How far `pos` at `at` is from where the track expected it, against
    /// how far it may be. None when there is nothing to expect yet.
    fn misfit(&self, pos: V, at: Instant) -> Option<(f64, f64)> {
        let (last, t) = self.last?;
        let dt = at.duration_since(t).as_secs_f64().max(0.05);
        let Some(v) = self.vel else {
            return Some((len(sub(pos, last)), SLACK + FLIGHT_SPEED * dt));
        };
        let predicted = [last[0] + v[0] * dt, last[1] + v[1] * dt, last[2] + v[2] * dt];
        let tolerance = SLACK + 0.5 * ACCEL * dt * dt + SPEED_SLACK * len(v) * dt;
        Some((len(sub(pos, predicted)), tolerance))
    }

    /// Whether `pos` fits well enough to be shown, and if so take it.
    pub fn feed(&mut self, pos: V, at: Instant) -> bool {
        if self.last.is_some_and(|(_, t)| at.duration_since(t) > STALE) {
            self.reset();
        }
        let accept = match self.misfit(pos, at) {
            None => true,
            Some((off, tolerance)) if off <= tolerance => true,
            Some(_) => self.smooth_from_pending(pos, at) || self.rejected + 1 >= GIVE_UP,
        };
        if accept {
            if let Some((last, t)) = self.last {
                let dt = at.duration_since(t).as_secs_f64();
                if dt > 0.0 {
                    let d = sub(pos, last);
                    self.vel = Some([d[0] / dt, d[1] / dt, d[2] / dt]);
                }
            }
            self.last = Some((pos, at));
            self.pending = None;
            self.rejected = 0;
        } else {
            self.pending = Some((pos, at));
            self.rejected += 1;
        }
        accept
    }

    /// The reading held back last time and this one carry on in the same
    /// direction from the last accepted one: a real change of pace.
    fn smooth_from_pending(&self, pos: V, at: Instant) -> bool {
        let (Some((last, t0)), Some((mid, t1))) = (self.last, self.pending) else { return false };
        let (dt1, dt2) = (t1.duration_since(t0).as_secs_f64(), at.duration_since(t1).as_secs_f64());
        if dt1 <= 0.0 || dt2 <= 0.0 {
            return false;
        }
        let (a, b) = (sub(mid, last), sub(pos, mid));
        let (va, vb) = (len(a) / dt1, len(b) / dt2);
        if va < 1.0 || vb < 1.0 {
            return false;
        }
        let cos = dot(a, b) / (len(a) * len(b));
        let ratio = vb / va;
        cos > 0.95 && (0.05..=20.0).contains(&ratio)
    }
}

/// Everything kept between reads.
#[derive(Default)]
pub struct Stabilizer {
    names: Names,
    system: Text,
    planet: Text,
    location: Text,
    server: Text,
    system_track: Track,
    planet_track: Track,
}

impl Stabilizer {
    /// The read cleaned up, or None when it should not move the instruments.
    pub fn clean(&mut self, mut fix: Fix, at: Instant) -> Option<Fix> {
        for z in &mut fix.zones {
            z.name = self.names.snap(&z.name);
        }
        fix.location = self.location.feed(fix.location.as_deref());
        fix.server = self.server.feed(fix.server.as_deref());
        fix.planet = self.planet.feed(fix.planet.as_deref());

        // The system's frame. Root carries the same numbers: when the two
        // disagree, whichever fits the track is the one read right.
        let root = fix.zones.iter().find(|z| z.name == "Root").map(|z| z.pos);
        let sys_index = fix.zones.iter().position(|z| z.name.starts_with("SolarSystem"))?;
        let before = self.system.get().map(str::to_string);
        let sys_name = self.system.feed(Some(&fix.zones[sys_index].name));
        if sys_name.as_deref() != Some(fix.zones[sys_index].name.as_str()) {
            // A new system or shard not yet confirmed: hold.
            return None;
        }
        if before.is_some() && before != sys_name {
            self.system_track.reset();
            self.planet_track.reset();
        }
        if let Some(root) = root {
            let sys = fix.zones[sys_index].pos;
            if len(sub(root, sys)) > 1.0 {
                let fit = |p: V| self.system_track.misfit(p, at).map(|(off, _)| off).unwrap_or(f64::MAX);
                if fit(root) < fit(sys) {
                    fix.zones[sys_index].pos = root;
                }
            }
        }
        if !self.system_track.feed(fix.zones[sys_index].pos, at) {
            return None;
        }

        // The planet's frame, when there is one.
        if let Some(i) = fix.planet_zone().and_then(|p| fix.zones.iter().position(|z| z.name == p.name)) {
            if !self.planet_track.feed(fix.zones[i].pos, at) {
                return None;
            }
        } else {
            self.planet_track.reset();
        }
        Some(fix)
    }
}

/// For the tests: a zone in one line.
#[cfg(test)]
fn zone(name: &str, pos: V) -> Zone {
    Zone { name: name.into(), pos }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_text_changes_only_when_read_alike_again() {
        let mut t = Text::default();
        assert_eq!(t.feed(Some("Nyx Levski")).as_deref(), Some("Nyx Levski"));
        assert_eq!(t.feed(Some("Nyx Levpki")).as_deref(), Some("Nyx Levski"));
        assert_eq!(t.feed(Some("Nyx Levski")).as_deref(), Some("Nyx Levski"));
        // Far from it: twice in a row.
        assert_eq!(t.feed(Some("Stanton4 NewBabbage")).as_deref(), Some("Nyx Levski"));
        assert_eq!(t.feed(Some("Stanton4 NewBabbage")).as_deref(), Some("Stanton4 NewBabbage"));
        // Near it: three times.
        let mut s = Text::default();
        s.feed(Some("game-171"));
        s.feed(Some("game-176"));
        assert_eq!(s.feed(Some("game-176")).as_deref(), Some("game-171"));
        assert_eq!(s.feed(Some("game-176")).as_deref(), Some("game-176"));
    }

    #[test]
    fn a_misread_zone_name_snaps_to_the_known_one_but_ids_two_digits_apart_do_not() {
        let mut n = Names::default();
        for _ in 0..3 {
            n.snap("OOC_Stanton_4_Microtech");
            n.snap("SolarSystem_926669998366");
        }
        assert_eq!(n.snap("OOC_Stanton_4_Microtecn"), "OOC_Stanton_4_Microtech");
        assert_eq!(n.snap("SolarSystem_926669998368"), "SolarSystem_926669998366");
        assert_eq!(n.snap("SolarSystem_926669998370"), "SolarSystem_926669998370");
    }

    #[test]
    fn one_wrong_digit_is_dropped_and_steady_flight_is_not() {
        let t0 = Instant::now();
        let s = |n: u64| t0 + Duration::from_secs(n);
        let mut track = Track::default();
        for n in 0..5 {
            assert!(track.feed([100.0 * n as f64, 0.0, 0.0], s(n)));
        }
        // 500 expected; a digit misread as 9500.
        assert!(!track.feed([9500.0, 0.0, 0.0], s(5)));
        assert!(track.feed([600.0, 0.0, 0.0], s(6)));
    }

    #[test]
    fn quantum_travel_gets_through_after_one_held_reading() {
        let t0 = Instant::now();
        let s = |n: u64| t0 + Duration::from_secs(n);
        let mut track = Track::default();
        assert!(track.feed([0.0; 3], s(0)));
        assert!(track.feed([0.0; 3], s(1)));
        // Spooling up: held once, then the next carries on the same way.
        assert!(!track.feed([1.0e6, 0.0, 0.0], s(2)));
        assert!(track.feed([5.0e6, 0.0, 0.0], s(3)));
    }

    #[test]
    fn root_outvotes_a_misread_system_line() {
        let t0 = Instant::now();
        let mut st = Stabilizer::default();
        let fix = |x: f64, root: f64| Fix {
            zones: vec![zone("SolarSystem_1", [x, 0.0, 0.0]), zone("Root", [root, 0.0, 0.0])],
            ..Default::default()
        };
        for n in 0..3 {
            assert!(st.clean(fix(10.0 * n as f64, 10.0 * n as f64), t0 + Duration::from_secs(n)).is_some());
        }
        let cleaned = st.clean(fix(90030.0, 30.0), t0 + Duration::from_secs(3)).unwrap();
        assert_eq!(cleaned.zones[0].pos, [30.0, 0.0, 0.0]);
    }
}
