//! EXPERIMENT: train and check the r_DisplayInfo glyph reader on screenshots.
//!
//!   cargo run --release --example location_glyphs -- train truth.json src/location/glyphs.json
//!   cargo run --release --example location_glyphs -- read <image>...
//!
//! truth.json: `[{"image": "...png", "lines": {"0": "Zone: ...", ...}}]`, lines
//! numbered top to bottom as the reader finds them (`read` prints them).

use starbuddy_client_lib::location::{glyphs, parse, stable};
use std::collections::BTreeMap;
use std::time::Instant;

fn corner(path: &str) -> Result<glyphs::Ink, Box<dyn std::error::Error>> {
    let img = image::open(path)?.to_rgb8();
    let (x, y, w, h) = glyphs::corner(img.width(), img.height());
    let cut = image::imageops::crop_imm(&img, x, y, w, h).to_image();
    Ok(glyphs::Ink::new(cut.as_raw(), w as usize, h as usize))
}

/// The built-in templates, or those in the file `GLYPHS` names.
fn templates() -> glyphs::Templates {
    std::env::var("GLYPHS")
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(glyphs::Templates::builtin)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("train") => {
            let truth: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(&args[1])?)?;
            let mut acc = BTreeMap::new();
            for item in truth {
                let ink = corner(item["image"].as_str().ok_or("image")?)?;
                let tops = ink.line_tops();
                // Lines by index (hand-made truth) or by their top y (from `dump`).
                if let Some(lines) = item["lines"].as_object() {
                    for (i, text) in lines {
                        let top = tops[i.parse::<usize>()?];
                        ink.learn(top, text.as_str().ok_or("text")?, &mut acc);
                    }
                }
                if let Some(lines) = item["at"].as_object() {
                    for (y, text) in lines {
                        ink.learn(y.parse::<f32>()?, text.as_str().ok_or("text")?, &mut acc);
                    }
                }
            }
            let t = glyphs::average(acc);
            for (font, chars) in &t.0 {
                eprintln!("font {font}: {}", chars.keys().cloned().collect::<String>());
            }
            std::fs::write(&args[2], serde_json::to_string(&t)?)?;
        }
        Some("read") => {
            let t = templates();
            for path in &args[1..] {
                let started = Instant::now();
                let ink = corner(path)?;
                let lines = ink.read_all(&t);
                let ms = started.elapsed().as_secs_f64() * 1000.0;
                println!("== {path} ({ms:.1} ms)");
                for (i, l) in lines.iter().enumerate() {
                    println!("{i:3} {l}");
                }
                let fix = parse::parse(&lines);
                println!(
                    "  -> {} zones, system {:?}, planet frame {:?}, location {:?}, server {:?}",
                    fix.zones.len(),
                    fix.system().map(|z| &z.name),
                    fix.planet_zone().map(|z| &z.name),
                    fix.location,
                    fix.server
                );
            }
        }
        Some("eval") => {
            // Character errors: each truth line against the read line nearest to it.
            let t = templates();
            let truth: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(&args[1])?)?;
            let (mut errors, mut chars, mut wrong_lines, mut all_lines) = (0usize, 0usize, 0usize, 0usize);
            for item in truth {
                let ink = corner(item["image"].as_str().ok_or("image")?)?;
                let lines = ink.read_all(&t);
                let texts = item["lines"].as_object().into_iter().chain(item["at"].as_object()).flat_map(|m| m.values());
                for text in texts {
                    // Unknown characters (¤) at the start were junk the labeller saw.
                    let text = text.as_str().ok_or("text")?.trim_start_matches('¤');
                    let n = text.chars().count();
                    let d = lines
                        .iter()
                        .map(|l| {
                            // Right-aligned: compare the line's last n characters.
                            let lc: Vec<char> = l.chars().collect();
                            let tail: String = if lc.len() >= n { lc[lc.len() - n..].iter().collect() } else { l.clone() };
                            let masked: String = if tail.chars().count() == n {
                                tail.chars().zip(text.chars()).map(|(a, b)| if b == '¤' { '¤' } else { a }).collect()
                            } else {
                                tail
                            };
                            let head = lc.len().saturating_sub(n);
                            // A space read for `_` changes nothing once parsed; junk in front counts once.
                            stable::distance(&masked.replace('_', " "), &text.replace('_', " ")) + (head > 0 && n < 30 && lc.len() > n + 2) as usize
                        })
                        .min()
                        .unwrap_or(n);
                    if d > 0 && args.get(2).is_some() {
                        println!("{d:3} {text}");
                    }
                    errors += d;
                    chars += text.chars().filter(|c| *c != '¤').count();
                    wrong_lines += (d > 0) as usize;
                    all_lines += 1;
                }
            }
            println!("{errors} errors in {chars} characters, {wrong_lines} of {all_lines} lines wrong");
        }
        Some("dump") => {
            // Every image's lines, for labelling: [{"image", "lines": [...]}].
            let t = templates();
            let mut out = Vec::new();
            for path in &args[2..] {
                let ink = corner(path)?;
                let tops = ink.line_tops();
                let lines: Vec<String> = tops.iter().map(|top| ink.read_line(*top, &t)).collect();
                out.push(serde_json::json!({ "image": path, "tops": tops, "lines": lines }));
            }
            std::fs::write(&args[1], serde_json::to_string(&out)?)?;
        }
        _ => eprintln!("train <truth.json> <out.json> | read <image>... | eval <truth.json> [-v] | dump <out.json> <image>..."),
    }
    Ok(())
}
