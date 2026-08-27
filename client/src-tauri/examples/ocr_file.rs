//! Offline OCR harness: run the client's OCR on screenshots.
//!
//!   cargo run --release --example ocr_file -- [--scale 2] [--crop x,y,w,h] <image>...
//!
//! Models are read from (and downloaded to) the app's data dir, so the
//! harness and the client see the same files.

use ocrs::{ImageSource, OcrEngine, OcrEngineParams, TextItem};
use std::path::PathBuf;
use std::time::Instant;

const URLS: [(&str, &str); 2] = [
    ("text-detection.rten", "https://ocrs-models.s3-accelerate.amazonaws.com/text-detection.rten"),
    ("text-recognition.rten", "https://ocrs-models.s3-accelerate.amazonaws.com/text-recognition.rten"),
];

fn models_dir() -> PathBuf {
    if let Ok(p) = std::env::var("STARBUDDY_OCR_MODELS") {
        return PathBuf::from(p);
    }
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("io.github.ulrichdahl.starbuddy").join("ocr")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut scale = 1u32;
    let mut crop: Option<(u32, u32, u32, u32)> = None;
    let mut files = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--scale" => scale = args.next().ok_or("--scale N")?.parse()?,
            "--crop" => {
                let v: Vec<u32> = args.next().ok_or("--crop x,y,w,h")?.split(',').map(|s| s.parse()).collect::<Result<_, _>>()?;
                crop = Some((v[0], v[1], v[2], v[3]));
            }
            _ => files.push(a),
        }
    }

    let dir = models_dir();
    std::fs::create_dir_all(&dir)?;
    for (name, url) in URLS {
        let path = dir.join(name);
        if !path.exists() {
            eprintln!("downloading {name}…");
            let status = std::process::Command::new("curl").args(["-sL", url, "-o"]).arg(&path).status()?;
            if !status.success() {
                return Err(format!("download of {name} failed").into());
            }
        }
    }
    let engine = OcrEngine::new(OcrEngineParams {
        detection_model: Some(rten::Model::load_file(dir.join("text-detection.rten"))?),
        recognition_model: Some(rten::Model::load_file(dir.join("text-recognition.rten"))?),
        ..Default::default()
    })?;

    for file in files {
        let mut img = image::open(&file)?.into_rgb8();
        if let Some((x, y, w, h)) = crop {
            img = image::imageops::crop_imm(&img, x, y, w, h).to_image();
        }
        if scale > 1 {
            img = image::imageops::resize(&img, img.width() * scale, img.height() * scale, image::imageops::FilterType::CatmullRom);
        }
        let started = Instant::now();
        let source = ImageSource::from_bytes(img.as_raw(), img.dimensions())?;
        let input = engine.prepare_input(source)?;
        let words = engine.detect_words(&input)?;
        let lines = engine.find_text_lines(&input, &words);
        let texts = engine.recognize_text(&input, &lines)?;
        println!("== {file} ({}×{}, scale {scale}) — {} ms", img.width(), img.height(), started.elapsed().as_millis());
        let mut rows: Vec<_> = texts.into_iter().flatten().filter(|l| l.to_string().trim().len() > 1).collect();
        rows.sort_by_key(|l| (l.bounding_rect().top() / 12, l.bounding_rect().left()));
        for l in rows {
            let r = l.bounding_rect();
            println!("  {:>5},{:>5} {:>4}×{:<3} {}", r.left() / scale as i32, r.top() / scale as i32, r.width() / scale as i32, r.height() / scale as i32, l.to_string().trim());
        }
    }
    Ok(())
}
