//! EXPERIMENT: reads the `r_DisplayInfo` debug text in the game's top-right
//! corner by matching glyph shapes rather than with the OCR models.
//!
//! The debug text is a fixed monospace pixel font, right-aligned at the same
//! x on every line, pure white with a dark shadow. Neural OCR drops its minus
//! signs and mixes up `.` and `,`; a cell-by-cell comparison against stored
//! shapes reads it exactly, and in a few milliseconds.
//!
//! Two sizes are on screen: about 7.5 px a character (the `Zone:` lines) and
//! about 6.6 px (the `Current player location` line). The font does not scale
//! with the screen: 1080p and 1440p measure the same, pixel for pixel.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Columns sampled across one character cell.
pub const SUB: usize = 8;
/// Rows sampled down one line, from two above the cap line to the descenders.
pub const ROWS: usize = 13;
const CELL: usize = SUB * ROWS;

/// The two fonts, by their pitch in pixels.
pub const FONTS: [(&str, f32); 2] = [("A", 7.5), ("B", 6.61)];

/// How much of the top-right corner the debug text can occupy.
pub const CORNER_W: f32 = 700.0;
pub const CORNER_H: f32 = 270.0;

/// Stored glyph shapes: font → character → cell.
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Templates(pub BTreeMap<String, BTreeMap<String, Vec<f32>>>);

impl Templates {
    pub fn builtin() -> Templates {
        serde_json::from_str(include_str!("glyphs.json")).unwrap_or_default()
    }
}

/// How white-text-like each pixel of the corner is, 0..1.
pub struct Ink {
    w: usize,
    h: usize,
    v: Vec<f32>,
    /// Pixels per font pixel: 1 at every resolution measured so far.
    pub scale: f32,
}

impl Ink {
    /// `rgb` is the corner, packed RGB.
    pub fn new(rgb: &[u8], w: usize, h: usize) -> Ink {
        let px = |x: usize, y: usize| {
            let i = (y * w + x) * 3;
            (rgb[i], rgb[i + 1], rgb[i + 2])
        };
        let mut v = vec![0.0f32; w * h];
        for y in 0..h {
            for x in 0..w {
                let (r, g, b) = px(x, y);
                let mn = r.min(g).min(b) as i32;
                let mx = r.max(g).max(b) as i32;
                // Neutral and bright: the overlay is pure white, signs and
                // lights behind it are cream or orange.
                if mx - mn >= 30 || mn <= 110 {
                    continue;
                }
                // And with its own dark shadow, which falls one pixel down
                // and right: a bright background pixel beside a letter has
                // the letter there, not shadow.
                let mut dark = 255i32;
                for (dx, dy) in [(1i32, 1i32), (1, 0), (0, 1)] {
                    let xx = (x as i32 + dx).clamp(0, w as i32 - 1) as usize;
                    let yy = (y as i32 + dy).clamp(0, h as i32 - 1) as usize;
                    let (r, g, b) = px(xx, yy);
                    dark = dark.min(r.max(g).max(b) as i32);
                }
                let bright = ((mn - 110) as f32 / 120.0).min(1.0);
                let contrast = ((mn - dark - 40) as f32 / 100.0).clamp(0.0, 1.0);
                v[y * w + x] = bright * contrast;
            }
        }
        Ink { w, h, v, scale: 1.0 }
    }

    fn at(&self, x: f32, y: f32) -> f32 {
        let (xi, yi) = (x.floor(), y.floor());
        if xi < 0.0 || yi < 0.0 || xi as usize + 1 >= self.w || yi as usize >= self.h {
            return 0.0;
        }
        let (tx, ty) = (x - xi, y - yi);
        let (xi, yi) = (xi as usize, yi as usize);
        let row = |y: usize| {
            let y = y.min(self.h - 1);
            self.v[y * self.w + xi] * (1.0 - tx) + self.v[y * self.w + xi + 1] * tx
        };
        row(yi) * (1.0 - ty) + row(yi + 1) * ty
    }

    /// The top of each text line, found from rows dense with ink.
    pub fn line_tops(&self) -> Vec<f32> {
        let s = self.scale;
        let dense = (15.0 * s) as usize;
        let counts: Vec<usize> = (0..self.h).map(|y| self.v[y * self.w..(y + 1) * self.w].iter().filter(|v| **v > 0.5).count()).collect();
        let mut tops = Vec::new();
        let mut y = 0;
        while y < self.h {
            if counts[y] > dense {
                let start = y;
                while y < self.h && counts[y] > dense {
                    y += 1;
                }
                if (y - start) as f32 >= 6.0 * s {
                    // Anchored on the baseline: the run ends there.
                    tops.push(y as f32 - 8.0 * s);
                }
            }
            y += 1;
        }
        tops
    }

    fn cell(&self, top: f32, left: f32, pitch: f32) -> [f32; CELL] {
        let mut c = [0.0; CELL];
        for j in 0..ROWS {
            let y = top + (j as f32 - 2.0) * self.scale;
            for i in 0..SUB {
                c[j * SUB + i] = self.at(left + (i as f32 + 0.5) * pitch / SUB as f32 - 0.5, y);
            }
        }
        c
    }

    /// Ink on the boundaries between cells, for a right edge and pitch. The
    /// grid that puts the least ink on its boundaries is the line's grid.
    fn boundary_ink(&self, top: f32, right: f32, pitch: f32) -> f32 {
        let mut s = 0.0;
        for k in 1..60 {
            let x = right - k as f32 * pitch;
            for j in 0..9 {
                s += self.at(x, top + j as f32 * self.scale);
            }
        }
        s
    }

    /// The font and grid of the line at `top`: (font, pitch, right edge).
    /// Each font's pitch is searched a little either side of its nominal value.
    pub fn fit(&self, top: f32) -> (&'static str, f32, f32) {
        let s = self.scale;
        let r0 = self.w as f32 - 6.0 * s;
        let mut best: Option<(f32, &'static str, f32, f32)> = None;
        let try_grid = |best: &mut Option<(f32, &'static str, f32, f32)>, font: &'static str, p: f32, r: f32| {
            let score = self.boundary_ink(top, r, p);
            if best.is_none_or(|b| score < b.0) {
                *best = Some((score, font, p, r));
            }
        };
        // Coarse: pitch in 0.02 steps, edge in 0.2.
        for (font, nominal) in FONTS {
            for dp in (-16..=16).step_by(2) {
                let p = (nominal + dp as f32 * 0.01) * s;
                for dr in -20..=20 {
                    try_grid(&mut best, font, p, r0 + dr as f32 * 0.2 * s);
                }
            }
        }
        // Fine, around the coarse best.
        if let Some((_, font, p0, rc)) = best {
            for dp in -2..=2 {
                for dr in -4..=4 {
                    try_grid(&mut best, font, p0 + dp as f32 * 0.01 * s, rc + dr as f32 * 0.05 * s);
                }
            }
        }
        let (_, font, p, r) = best.unwrap_or((0.0, "A", 7.5 * s, r0));
        (font, p, r)
    }

    /// Every non-blank cell of a line, right to left, with its index from the right.
    fn cells(&self, top: f32, pitch: f32, right: f32) -> Vec<(usize, Option<[f32; CELL]>)> {
        let mut out = Vec::new();
        let mut blanks = 0;
        for k in 0..120 {
            let left = right - (k + 1) as f32 * pitch;
            if left < 1.0 {
                break;
            }
            let c = self.cell(top, left, pitch);
            if c.iter().sum::<f32>() < 0.8 {
                out.push((k, None));
                blanks += 1;
                if blanks >= 3 {
                    break;
                }
            } else {
                blanks = 0;
                out.push((k, Some(c)));
            }
        }
        out
    }

    /// Read the line at `top`.
    ///
    /// Where the line says what its characters can be, they are read again
    /// against only those: after `Pos:` on a `Zone:` line only a number, a
    /// unit or a gap can stand, so a bright background cannot make `5` an `S`.
    pub fn read_line(&self, top: f32, templates: &Templates) -> String {
        let (font, pitch, right) = self.fit(top);
        let Some(set) = templates.0.get(font) else { return String::new() };
        let cells: Vec<Option<[f32; CELL]>> = self.cells(top, pitch, right).into_iter().rev().map(|(_, c)| c).collect();
        let best = |c: &[f32; CELL], allowed: &dyn Fn(char) -> bool| {
            set.iter()
                .filter_map(|(ch, t)| ch.chars().next().filter(|c| allowed(*c)).map(|ch| (ch, t)))
                .map(|(ch, t)| (ch, t.iter().zip(c.iter()).map(|(a, b)| (a - b) * (a - b)).sum::<f32>()))
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .map(|(ch, _)| ch)
                .unwrap_or('?')
        };
        let read = |allowed: &dyn Fn(char) -> bool, from: usize, chars: &mut Vec<char>| {
            for (i, cell) in cells.iter().enumerate().skip(from) {
                chars[i] = match cell {
                    None => ' ',
                    Some(c) => best(c, allowed),
                };
            }
        };
        let mut chars = vec![' '; cells.len()];
        read(&|_| true, 0, &mut chars);
        let text: String = chars.iter().collect();
        let lead = text.len() - text.trim_start().len();
        let zone_line = text.trim_start().get(..5).is_some_and(|z| z.chars().zip("Zone:".chars()).filter(|(a, b)| a == b).count() >= 4);
        if zone_line {
            if let Some(at) = text[lead..].rfind("Pos:").or_else(|| text[lead..].rfind("Pos")) {
                let numeric = |c: char| c.is_ascii_digit() || matches!(c, '.' | '-' | 'k' | 'm');
                read(&numeric, lead + at + 4, &mut chars);
            }
        }
        chars.into_iter().collect::<String>().trim().to_string()
    }

    /// Read every line in the corner, top to bottom.
    pub fn read_all(&self, templates: &Templates) -> Vec<String> {
        self.line_tops().into_iter().map(|top| self.read_line(top, templates)).collect()
    }

    /// Training: add the cells of the line at `top`, whose text is `truth`, to `acc`.
    pub fn learn(&self, top: f32, truth: &str, acc: &mut BTreeMap<String, BTreeMap<String, Vec<Vec<f32>>>>) {
        let (font, pitch, right) = self.fit(top);
        for (k, ch) in truth.chars().rev().enumerate() {
            // `¤` marks a character the labeller is not sure of.
            if ch == ' ' || ch == '¤' {
                continue;
            }
            let c = self.cell(top, right - (k + 1) as f32 * pitch, pitch);
            acc.entry(font.to_string()).or_default().entry(ch.to_string()).or_default().push(c.to_vec());
        }
    }
}

/// Average what [`Ink::learn`] gathered into templates.
pub fn average(acc: BTreeMap<String, BTreeMap<String, Vec<Vec<f32>>>>) -> Templates {
    Templates(
        acc.into_iter()
            .map(|(font, chars)| {
                let chars = chars
                    .into_iter()
                    .map(|(ch, cells)| {
                        let n = cells.len() as f32;
                        let mut avg = vec![0.0; CELL];
                        for c in &cells {
                            for (a, v) in avg.iter_mut().zip(c) {
                                *a += v / n;
                            }
                        }
                        // Three decimals is plenty and keeps the file small.
                        (ch, avg.into_iter().map(|v| (v * 1000.0).round() / 1000.0).collect())
                    })
                    .collect();
                (font, chars)
            })
            .collect(),
    )
}

/// The corner of a frame the debug text lives in: (x, y, w, h) in frame pixels.
pub fn corner(frame_w: u32, frame_h: u32) -> (u32, u32, u32, u32) {
    let w = (CORNER_W as u32).min(frame_w);
    let h = (CORNER_H as u32).min(frame_h);
    (frame_w - w, 0, w, h)
}
