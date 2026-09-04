//! Read a refinery order off the screen.
//!
//! The player frames the refinery panel once (a drag over the live game, see
//! [`crate::region`]), then presses the refinery hotkey whenever an order is on
//! screen. The region is captured, OCR'd, parsed into an order, and shown in the
//! refinery window for checking before it is saved.
//!
//! Only the *order placement* screen is parsed: the one where a station, a
//! method and a set of materials with input and output amounts are chosen. The
//! jobs-in-progress list is a different layout and comes later.

use crate::scan::{self, Captured, OcrLine, ScanRegion};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Window name of the refinery window.
pub const REFINERY: &str = "refinery";

/// Which of the terminal's three states a work order panel is in.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum OrderState {
    /// Choosing materials and a method; nothing has been paid for yet.
    #[default]
    Setup,
    /// Running, with a time remaining and per-material progress.
    Processing,
    /// Finished, waiting to be collected.
    Completed,
}

/// One row of a work order's material table.
///
/// Which columns are present depends on the state: setup prints QUALITY, QTY,
/// YIELD and a REFINE toggle; processing adds TO DO and DONE; completed keeps
/// only QUALITY and YIELD. A column the panel does not show stays `None` rather
/// than defaulting to zero, because "not shown" and "zero" mean different
/// things to anyone reading the saved order later.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct OrderMaterial {
    pub resource: String,
    /// 0–1000, as the game grades ore.
    pub quality: Option<f64>,
    /// Raw amount selected, in cSCU. Setup only.
    pub qty: Option<f64>,
    /// Refined amount, in cSCU.
    pub yield_amount: Option<f64>,
    /// Still to refine, and already refined. Processing only.
    pub to_do: Option<f64>,
    pub done: Option<f64>,
    /// Whether the row's REFINE toggle is on.
    ///
    /// The toggle itself is a coloured switch with no text, so OCR cannot read
    /// it — but it does not have to. The panel only computes a yield for rows
    /// it is going to refine: a row that is off prints "--", and inert material
    /// prints 0. So a yield above zero is exactly the rows with the switch on.
    pub refine: bool,
}

/// One work order panel.
///
/// The terminal shows several of these side by side once orders are running,
/// so a capture holds a list of them rather than a single order.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WorkOrder {
    pub state: OrderState,
    /// The panel's own number, from "WORK ORDER 2".
    pub number: Option<i64>,
    pub method: Option<String>,
    /// The method's trade-off line, e.g. "VERY LOW SPEED // LOW COST // HIGH YIELD".
    pub method_traits: Option<String>,
    pub materials: Vec<OrderMaterial>,
    /// Total cost in aUEC. Setup only.
    pub cost: Option<f64>,
    /// Processing time when setting up, time remaining once running.
    pub duration_seconds: Option<i64>,
    /// The order's total yield in cSCU, printed under the table.
    pub yield_total: Option<f64>,
    /// cSCU aboard, and cSCU chosen for this order. Setup only.
    pub in_manifest: Option<f64>,
    pub to_refine: Option<f64>,
    /// The unit every amount in this order is counted in.
    ///
    /// The terminal works in centi-SCU — 1 cSCU is 0.01 SCU — and says so in
    /// its table heading, "MATERIALS YIELDED (CSCU)". Recorded rather than
    /// assumed, because the same numbers read as SCU would be a hundredfold
    /// overstatement of what was refined.
    pub unit: String,
}

/// The default unit of a refinery panel: centi-SCU, where 1 cSCU is 0.01 SCU.
pub const DEFAULT_UNIT: &str = "cSCU";

/// Everything read off one capture of a refinement terminal.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RefineryTerminal {
    /// The station the terminal belongs to, e.g. "LEVSKI".
    pub station: Option<String>,
    /// The work order panels on screen, left to right.
    pub orders: Vec<WorkOrder>,
    /// The ship the material is drawn from, when the left panel is in shot.
    pub ship: Option<String>,
    /// The station's current workload, which drives its surcharge.
    pub capacity_percent: Option<f64>,
    /// The station's per-material yield bonuses.
    pub specializations: Vec<Specialization>,
    /// Every line read, so the window can show what the parser worked from.
    pub lines: Vec<OcrLine>,
    /// Unix millis of the capture.
    pub captured_at: i64,
    pub elapsed_ms: u64,
    /// What the parser could not fill in — shown as "check this" in the window.
    pub missing: Vec<String>,
    /// How many captures were merged to make this. A material list longer than
    /// the panel scrolls off the bottom, so several reads can build one order.
    pub captures: usize,
}

/// One row of the station's MATERIAL SPECIALIZATIONS table.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Specialization {
    pub material: String,
    pub bonus_percent: Option<f64>,
}

#[derive(Default)]
pub struct RefineryState {
    pub last: Mutex<Option<RefineryTerminal>>,
    busy: Mutex<bool>,
}

fn status(app: &AppHandle, phase: &str, detail: impl Into<String>) {
    let _ = app.emit("refinery-status", serde_json::json!({ "phase": phase, "detail": detail.into() }));
}

/// The region the player framed, or the whole frame when they have not.
pub fn current_region(app: &AppHandle) -> Option<ScanRegion> {
    crate::load_client_prefs(app).refinery_region
}

/// Hotkey entry point: show the window and read whatever is on screen.
pub fn trigger(app: &AppHandle) {
    if let Err(e) = crate::overlay::show(app, REFINERY) {
        log::error!("refinery window failed to open: {e}");
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = read(app2.clone()).await {
            status(&app2, "error", e);
        }
    });
}

/// Capture, OCR and parse, adding to the last read when it is the same
/// terminal — see [`merge`]. The result is stored and emitted; the window may
/// also ask for it again with [`refinery_last`].
pub async fn read(app: AppHandle) -> Result<RefineryTerminal, String> {
    read_with(app, true).await
}

/// `merge_with_last` false starts a fresh order, discarding earlier captures.
pub async fn read_with(app: AppHandle, merge_with_last: bool) -> Result<RefineryTerminal, String> {
    {
        let state = app.state::<RefineryState>();
        let mut busy = state.busy.lock().unwrap();
        if *busy {
            return Err("a read is already running".into());
        }
        *busy = true;
    }
    let mut result = read_inner(&app).await;
    if let Ok(fresh) = result {
        let previous = app.state::<RefineryState>().last.lock().unwrap().clone();
        result = Ok(match previous {
            Some(previous) if merge_with_last => merge(&previous, fresh),
            _ => RefineryTerminal { captures: 1, ..fresh },
        });
    }
    *app.state::<RefineryState>().busy.lock().unwrap() = false;

    match &result {
        Ok(order) => {
            *app.state::<RefineryState>().last.lock().unwrap() = Some(order.clone());
            let _ = app.emit("refinery-order", order.clone());
            let materials: usize = order.orders.iter().map(|o| o.materials.len()).sum();
            let captures = if order.captures > 1 { format!(", {} captures", order.captures) } else { String::new() };
            status(
                &app,
                "done",
                format!("{} order(s), {materials} materials{captures} in {} ms", order.orders.len(), order.elapsed_ms),
            );
        }
        Err(e) => status(&app, "error", e.clone()),
    }
    result
}

async fn read_inner(app: &AppHandle) -> Result<RefineryTerminal, String> {
    status(app, "downloading", "checking OCR models");
    let (det, rec) = scan::ensure_models(app).await?;
    let region = current_region(app);
    let app2 = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let started = std::time::Instant::now();
        status(&app2, "capturing", "grabbing the panel");
        let full = scan::capture()?;
        let cap = match region {
            Some(r) => scan::crop_region(full, r)?,
            None => full,
        };

        status(&app2, "ocr", "reading the panel");
        let lines = scan::with_engine(&app2, &det, &rec, |engine| read_in_bands(engine, &cap))?;

        let mut order = parse(&lines);
        snap_qualities(&app2, &mut order);
        order.lines = lines;
        order.captured_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        order.elapsed_ms = started.elapsed().as_millis() as u64;
        send_for_training(&app2, &cap, &order);
        Ok(order)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Correct quality readings against the ladders the game publishes.
///
/// Quality is the only column with a closed set of answers, so a reading that
/// is not one of a material's eight bands is a misreading rather than a number.
/// Correcting it here rather than in the window means the value the player is
/// asked to check is already the one the terminal printed.
fn snap_qualities(app: &AppHandle, terminal: &mut RefineryTerminal) {
    let table = crate::sigs::table(app);
    for order in &mut terminal.orders {
        for material in &mut order.materials {
            // The name first: the quality ladder is looked up by material, so
            // a name the reader mangled has no ladder to be snapped against.
            if let Some(snapped) = crate::sigs::snap_material(&table, &material.resource) {
                if snapped != material.resource {
                    log::debug!("material {} read, snapped to {snapped}", material.resource);
                    material.resource = snapped;
                }
            }
            let Some(read) = material.quality else { continue };
            let bands = crate::sigs::bands_for(&table, &material.resource);
            if let Some(snapped) = crate::sigs::snap_quality(&bands, read) {
                log::debug!("quality {read} read for {} snapped to {snapped}", material.resource);
                material.quality = Some(snapped);
            }
        }
    }
}

/// Send the crop the reader worked from to the training queue.
///
/// The point is the reads that go wrong: the frame plus what the parser made of
/// it says whether the capture was unreadable or the parse was at fault, which
/// is not a distinction anyone can make from the window alone. The server drops
/// a frame it has already been sent, so pressing the hotkey twice costs nothing.
fn send_for_training(app: &AppHandle, cap: &Captured, order: &RefineryTerminal) {
    let Ok(png) = crate::training::png_of(cap) else { return };
    let materials: usize = order.orders.iter().map(|o| o.materials.len()).sum();
    let missing = if order.missing.is_empty() {
        "nothing missing".to_string()
    } else {
        format!("missing {}", order.missing.join(", "))
    };
    let note = format!(
        "F8 refinery read: {} order(s), {materials} materials, {} lines, {missing}. Station {}. \
         Frame {}×{} from {}.",
        order.orders.len(),
        order.lines.len(),
        order.station.as_deref().unwrap_or("unread"),
        cap.width,
        cap.height,
        // Which capture path answered. A region is fractions of its frame, so
        // a read that came from a different frame than the area was drawn on
        // is the first thing to check when a panel reads as nothing.
        cap.source,
    );
    // The whole read, lines and boxes included. The note says a capture read
    // badly; this says how — which of the two faults it was, a frame OCR could
    // not make out or a frame it read and the parser threw away. Working that
    // out from the image alone means running the reader again and hoping it
    // does the same thing twice.
    let reader = serde_json::to_string(order).ok();

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::training::upload(&app, png, Some("refinery_order"), Some(note), reader).await {
            // Never the player's problem: the read itself succeeded.
            log::debug!("refinery capture not sent for training: {e}");
        }
    });
}

/// OCR the capture in overlapping horizontal bands, then merge.
///
/// The detector downscales a tall region to its input size, which is what makes
/// small panel text mushy; reading a few shorter bands keeps each one nearer its
/// native scale. Bands overlap so a row that straddles a cut is still whole in
/// one of them, and duplicates are dropped on merge.
fn read_in_bands(engine: &ocrs::OcrEngine, cap: &Captured) -> Result<Vec<OcrLine>, String> {
    const TARGET_BAND: u32 = 420;
    const OVERLAP: u32 = 60;

    if cap.height <= TARGET_BAND {
        return scan::run_ocr(engine, cap);
    }

    let mut merged: Vec<OcrLine> = Vec::new();
    let mut top = 0u32;
    while top < cap.height {
        let height = TARGET_BAND.min(cap.height - top);
        let band = crop_rows(cap, top, height);
        let mut lines = scan::run_ocr(engine, &band)?;
        for line in &mut lines {
            line.y += top as i32; // band coordinates back into the capture's
        }
        for line in lines {
            if !merged.iter().any(|seen| same_line(seen, &line)) {
                merged.push(line);
            }
        }
        if top + height >= cap.height {
            break;
        }
        top += TARGET_BAND - OVERLAP;
    }

    // Reading order: top to bottom, then left to right.
    merged.sort_by_key(|line| (line.y, line.x));
    Ok(merged)
}

/// The same text at nearly the same place, seen in two overlapping bands.
fn same_line(a: &OcrLine, b: &OcrLine) -> bool {
    a.text.trim() == b.text.trim() && (a.y - b.y).abs() < 12 && (a.x - b.x).abs() < 12
}

fn crop_rows(cap: &Captured, top: u32, height: u32) -> Captured {
    let stride = cap.width as usize * 3;
    let start = top as usize * stride;
    let end = ((top + height) as usize * stride).min(cap.rgb.len());
    Captured {
        rgb: cap.rgb[start..end].to_vec(),
        width: cap.width,
        height,
        source: cap.source.clone(),
        full_height: cap.full_height,
    }
}

// ── Parsing ────────────────────────────────────────────────────────────────
//
// The terminal is read structurally, because the panel moves with resolution
// and with how the player framed the capture. Three structures carry it:
//
//   * rows    — lines sharing a vertical centre, which is how a table row's
//               cells belong together even when OCR emits them out of order;
//   * panels  — each work order is its own column of the screen, anchored on
//               its state header ("SETUP", "PROCESSING", "COMPLETED");
//   * columns — the table's headers say what each number in a row means.
//
// Reading by column is what makes a missing cell harmless: a row printing "--"
// for its yield simply has no number in that column, rather than shifting every
// later value one place left.

/// Characters OCR confuses in this panel's font, folded together.
///
/// It reads QUALITY as "OUALITY" and QTY as "OTY", and the L in MATERIAL as an
/// I. Both sides of any comparison must go through this — comparing a folded
/// string against a raw one silently never matches.
fn canonical(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            'Q' | '0' => 'O',
            '1' | 'L' => 'I',
            '5' => 'S',
            '8' => 'B',
            '2' => 'Z',
            other => other,
        })
        .collect()
}

/// Does this text read as the given label, allowing for confusable characters?
///
/// Folding the confusable letters is not always enough: the panel's TOTAL COST
/// comes back as "IOTAL COST", where the wrong letter is a T read as an I —
/// not a pair the folding covers, and enough to lose the line that ends the
/// material table and holds the order's price. So a label the panel certainly
/// printed is also accepted on a near miss: the label is slid along the text
/// and a window that is wrong in about one letter in six is taken as a match.
/// Only for labels long enough for that to mean something; in a three-letter
/// word one wrong letter is not evidence of anything.
fn reads_as_text(text: &str, label: &str) -> bool {
    let (text, label) = (canonical(text), canonical(label));
    if label.is_empty() {
        return false;
    }
    if text.contains(&label) {
        return true;
    }
    // A heading the panel clipped, or that OCR stopped short of: "REFINEM" for
    // REFINEMENT. Only from the front, and only when enough of it is there to
    // be that word and no other.
    if label.len() >= 6 && text.len() >= 6 && label.starts_with(&text) {
        return true;
    }
    if label.len() < 6 || text.len() < label.len() {
        return false;
    }
    let (text, label) = (text.as_bytes(), label.as_bytes());
    let allowed = label.len() / 6;
    (0..=text.len() - label.len())
        .any(|start| label.iter().zip(&text[start..start + label.len()]).filter(|(a, b)| a != b).count() <= allowed)
}

/// A section heading without the number the panel gives the section.
///
/// The panel numbers its sections — "01 // RAW MATERIALS", "02 // PROCESSING
/// SELECTION" — and OCR drops the leading zero, so "01 // IN MANIFEST" arrives
/// as "1/ IN MANIFEST". Read as a value that says the ship is carrying one
/// cSCU, which is both wrong and plausible enough to save.
fn without_section_number(text: &str) -> &str {
    let trimmed = text.trim_start();
    let after_digits = trimmed.trim_start_matches(|c: char| c.is_ascii_digit());
    if after_digits.len() == trimmed.len() {
        return text;
    }
    let after_slash = after_digits.trim_start();
    match after_slash.strip_prefix('/') {
        Some(rest) => rest.trim_start_matches('/'),
        None => text,
    }
}

fn reads_as(line: &OcrLine, label: &str) -> bool {
    reads_as_text(&line.text, label)
}

fn centre_y(line: &OcrLine) -> i32 {
    line.y + line.h / 2
}

fn centre_x(line: &OcrLine) -> i32 {
    line.x + line.w / 2
}

/// Lines grouped into visual rows, each row sorted left to right.
///
/// The tolerance comes from the text's own height, so the same code works on a
/// 1080p capture and a 4K one without a magic pixel count.
fn rows<'a>(lines: &[&'a OcrLine]) -> Vec<Vec<&'a OcrLine>> {
    if lines.is_empty() {
        return Vec::new();
    }
    let mut heights: Vec<i32> = lines.iter().map(|l| l.h.max(1)).collect();
    heights.sort_unstable();
    let median = heights[heights.len() / 2];
    let tolerance = ((median as f32 * 1.5) as i32).max(6);

    let mut sorted: Vec<&OcrLine> = lines.to_vec();
    sorted.sort_by_key(|l| (centre_y(l), l.x));

    let mut rows: Vec<Vec<&OcrLine>> = Vec::new();
    for line in sorted {
        match rows.last_mut() {
            Some(row) if (centre_y(line) - centre_y(row[0])).abs() <= tolerance => row.push(line),
            _ => rows.push(vec![line]),
        }
    }
    for row in &mut rows {
        row.sort_by_key(|l| l.x);
    }
    rows
}

fn find<'a>(lines: &[&'a OcrLine], label: &str) -> Option<&'a OcrLine> {
    lines.iter().find(|l| reads_as(l, label)).copied()
}

/// Places a label's value might be, best guess first.
///
/// The panel uses both layouts: "TOTAL COST  281.00" sits on one row, while
/// "// IN MANIFEST" prints its 3154 underneath. Candidates are returned rather
/// than one answer because the nearest cell to the right is often the *next
/// label* — "// IN MANIFEST" is followed by "// TO REFINE" — so the caller
/// keeps the first candidate that parses as the kind of value it wants.
fn value_candidates<'a>(rows: &'a [Vec<&'a OcrLine>], label: &OcrLine) -> Vec<&'a OcrLine> {
    // A value belongs to its label, so it cannot be halfway across the screen.
    let reach = label.h.max(5) * 40;
    let mut out: Vec<&OcrLine> = Vec::new();

    if let Some(row) = rows.iter().find(|row| row.iter().any(|l| std::ptr::eq(*l, label))) {
        let mut right: Vec<&OcrLine> = row
            .iter()
            .filter(|l| l.x > label.x + label.w / 2 && l.x - label.x <= reach)
            .copied()
            .collect();
        right.sort_by_key(|l| l.x);
        out.extend(right);
    }

    // Below: nearest row first, and within a row the cell most nearly under the
    // label. "// IN MANIFEST" and "// TO REFINE" head two columns whose values
    // share one row, so the column decides which value belongs to which label.
    let label_centre = centre_x(label);
    let band = label.w.max(40) * 3;
    let mut below_rows: Vec<&Vec<&OcrLine>> = rows
        .iter()
        .filter(|row| {
            let y = centre_y(row[0]);
            y > centre_y(label) && y - centre_y(label) < label.h.max(6) * 6
        })
        .collect();
    below_rows.sort_by_key(|row| centre_y(row[0]));

    for row in below_rows {
        let mut cells: Vec<&OcrLine> = row.iter().filter(|l| (l.x - label.x).abs() < band).copied().collect();
        cells.sort_by_key(|l| (centre_x(l) - label_centre).abs());
        out.extend(cells);
    }
    out
}

/// The first candidate that yields a number.
fn scalar_for(rows: &[Vec<&OcrLine>], label: &OcrLine) -> Option<f64> {
    if let Some(inline) = numbers_in(without_section_number(&label.text)).into_iter().next() {
        return Some(inline);
    }
    // The same stripping on the candidates: the cell to the right of
    // "// IN MANIFEST" is "// TO REFINE", whose section number would otherwise
    // answer for the manifest.
    value_candidates(rows, label)
        .into_iter()
        .find_map(|candidate| numbers_in(without_section_number(&candidate.text)).into_iter().next())
}

// ── The material table ─────────────────────────────────────────────────────

#[derive(PartialEq, Clone, Copy, Debug)]
enum Column {
    Quality,
    Qty,
    Yield,
    ToDo,
    Done,
}

/// The column headings, in the order the panel prints them.
const COLUMN_LABELS: [(&str, Column); 5] = [
    ("QUALITY", Column::Quality),
    ("QTY", Column::Qty),
    ("YIELD", Column::Yield),
    ("TO DO", Column::ToDo),
    ("DONE", Column::Done),
];

/// A table's shape: which columns it has, and where they sit when that is known.
struct Table {
    /// The bottom of the lowest cell in the header row. OCR often reads a
    /// header both as one run-together line and as its separate headings, and
    /// those headings sit a pixel or two below that line's centre: measured
    /// from the centre they look like the first thing *under* the table.
    header_bottom: i32,
    /// Left to right.
    kinds: Vec<Column>,
    /// One x centre per kind, when the header came as separate cells. OCR
    /// sometimes runs a whole header into one line ("OUALITY YIFLN TODO DONE"),
    /// and then only the order is known.
    centres: Option<Vec<i32>>,
    tolerance: i32,
}

/// Every number in a cell, with the x it would have had if it had been read as
/// a cell of its own.
///
/// A row the reader ran together — "ALUMINUM ORE 318 387" as one line — still
/// says where its numbers are, in the only way it can: by how far along the
/// text they sit. Spreading the cell's width evenly over its characters puts
/// each number near enough to its column to be placed there, which is what
/// tells a missing quality from a missing yield.
fn numbers_with_x(line: &OcrLine) -> Vec<(f64, i32)> {
    let chars: Vec<char> = line.text.chars().collect();
    if chars.is_empty() {
        return Vec::new();
    }
    let step = line.w as f64 / chars.len() as f64;
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    // "S04" is a misread 504, not a 4 — a figure the panel printed stands on
    // its own, so only whole numeric words are read as one.
    let standalone: Vec<bool> = {
        let mut flags = vec![false; chars.len()];
        let mut at = 0usize;
        for word in line.text.split_whitespace() {
            let length = word.chars().count();
            while at < chars.len() && chars[at].is_whitespace() {
                at += 1;
            }
            let numeric = word.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ',');
            for offset in 0..length {
                if at + offset < chars.len() {
                    flags[at + offset] = numeric;
                }
            }
            at += length;
        }
        flags
    };
    for index in 0..=chars.len() {
        let numeric = index < chars.len()
            && standalone[index]
            && (chars[index].is_ascii_digit() || ((chars[index] == '.' || chars[index] == ',') && start.is_some()));
        match (numeric, start) {
            (true, None) => start = Some(index),
            (false, Some(from)) => {
                let text: String = chars[from..index].iter().collect();
                if let Some(value) = parse_number(&text) {
                    let middle = (from + index) as f64 / 2.0;
                    out.push((value, line.x + (middle * step).round() as i32));
                }
                start = None;
            }
            _ => {}
        }
    }
    out
}

/// A cell's text with its numbers taken out, for a name that was read with its
/// row's figures attached.
fn strip_numbers(text: &str) -> String {
    text.split_whitespace()
        .filter(|word| !word.chars().any(|c| c.is_ascii_digit()))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The lowest edge of anything in a row.
fn row_bottom(row: &[&OcrLine]) -> i32 {
    row.iter().map(|l| l.y + l.h).max().unwrap_or(0)
}

/// Find the table header and work out its columns.
fn table(rows: &[Vec<&OcrLine>]) -> Option<Table> {
    for row in rows {
        // The leftmost cell heads the material names; everything the column
        // scan looks at comes after it.
        let value_cells: Vec<&&OcrLine> = row.iter().filter(|c| !is_name_heading(&c.text)).collect();
        let mut positioned: Vec<(Column, i32)> = Vec::new();
        for cell in &value_cells {
            for word in cell.text.split_whitespace() {
                if let Some(kind) = column_for(word) {
                    if !positioned.iter().any(|(k, _)| *k == kind) {
                        positioned.push((kind, centre_x(cell)));
                    }
                }
            }
        }
        // A header run together into one cell — "MATERIALS SELECTED QUALITY OTY
        // YIELD REFINE" — is also the cell naming the material column, so
        // dropping it as a name heading loses the whole table. Fall back to it
        // when the separate cells did not carry the columns themselves.
        if positioned.len() < 2 {
            if let Some(whole) = row.iter().find(|c| is_name_heading(&c.text) && kinds_in_order(&c.text).len() >= 2) {
                return Some(Table {
                    header_bottom: row_bottom(row),
                    kinds: kinds_in_order(&whole.text),
                    centres: None,
                    tolerance: 0,
                });
            }
        }
        if positioned.len() >= 2 {
            positioned.sort_by_key(|(_, x)| *x);
            // A run-together header lands here as one cell matching several
            // labels; it has one x, so the centres are not usable.
            let distinct = positioned.iter().map(|(_, x)| *x).collect::<std::collections::BTreeSet<_>>();
            if distinct.len() == positioned.len() {
                let centres: Vec<i32> = positioned.iter().map(|(_, x)| *x).collect();
                let gap = centres.windows(2).map(|w| w[1] - w[0]).min().unwrap_or(30).max(8);
                return Some(Table {
                    header_bottom: row_bottom(row),
                    kinds: positioned.into_iter().map(|(k, _)| k).collect(),
                    centres: Some(centres),
                    tolerance: gap / 2,
                });
            }
            // One cell, several headings: order comes from the text itself.
            let text = value_cells.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join(" ");
            return Some(Table {
                header_bottom: row_bottom(row),
                kinds: kinds_in_order(&text),
                centres: None,
                tolerance: 0,
            });
        }
    }
    None
}

/// Column kinds in the order they appear in a run-together header line.
fn kinds_in_order(text: &str) -> Vec<Column> {
    let mut kinds = Vec::new();
    for word in text.split_whitespace() {
        if let Some(kind) = column_for(word) {
            if !kinds.contains(&kind) {
                kinds.push(kind);
            }
        }
    }
    kinds
}

/// Which column a heading names, allowing for a misread letter or two.
///
/// Exact folding is not enough here: this panel's OCR reads YIELD as "YIFLN",
/// which shares no run with the real word. The set of headings is tiny and
/// fixed, so the nearest one is a safe answer where a free-text guess would not
/// be — a material name scores near zero against every heading.
fn column_for(word: &str) -> Option<Column> {
    let canon = canonical(word);
    // Every heading is at least three letters, and a shorter word cannot be a
    // misread one. Without this the "TO" of a "// TO REFINE" section title
    // reads as TO DO, and the section heading is mistaken for the table's.
    if canon.len() < 3 {
        return None;
    }
    // "TO DO" arrives as one word or two; compare without the space.
    COLUMN_LABELS
        .into_iter()
        .map(|(label, kind)| (kind, similarity(&canon, &canonical(label))))
        .filter(|(_, score)| *score >= 0.6)
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(kind, _)| kind)
}

/// How alike two headings are, position by position.
///
/// Only meaningful for strings of nearly the same length, which is what a
/// misread heading is; anything else scores zero rather than a weak match.
fn similarity(a: &str, b: &str) -> f64 {
    if a == b {
        return 1.0;
    }
    // One word inside another only means the same heading when the shared run
    // is most of both. "TO" sits inside "TODO" and "I" inside "YIEID", and
    // taking either as a match is how a section title becomes a table header.
    if (a.contains(b) || b.contains(a)) && a.len().min(b.len()) * 4 >= a.len().max(b.len()) * 3 {
        return 1.0;
    }
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len().abs_diff(b.len()) > 1 {
        return 0.0;
    }
    let shared = (0..a.len().min(b.len())).filter(|i| a[*i] == b[*i]).count();
    shared as f64 / a.len().max(b.len()) as f64
}

impl Table {
    /// Which column a cell falls in, when the centres are known.
    fn column_of(&self, line: &OcrLine) -> Option<Column> {
        let centres = self.centres.as_ref()?;
        let x = centre_x(line);
        self.kinds
            .iter()
            .zip(centres)
            .map(|(kind, centre)| (*kind, (x - centre).abs()))
            .filter(|(_, distance)| *distance <= self.tolerance)
            .min_by_key(|(_, distance)| *distance)
            .map(|(kind, _)| kind)
    }

    /// The column an x sits in, for a number read out of a run-together cell
    /// rather than a cell of its own. The tolerance that guards `column_of` is
    /// deliberately not applied: the x is an estimate from a character offset,
    /// so it lands near the column rather than on it.
    fn column_near(&self, x: i32) -> Option<Column> {
        let centres = self.centres.as_ref()?;
        self.kinds
            .iter()
            .zip(centres)
            .map(|(kind, centre)| (*kind, (x - centre).abs()))
            .min_by_key(|(_, distance)| *distance)
            .map(|(kind, _)| kind)
    }

    fn holds(&self, material: &OrderMaterial, column: Column) -> bool {
        match column {
            Column::Quality => material.quality.is_some(),
            Column::Qty => material.qty.is_some(),
            Column::Yield => material.yield_amount.is_some(),
            Column::ToDo => material.to_do.is_some(),
            Column::Done => material.done.is_some(),
        }
    }

    fn set(&self, material: &mut OrderMaterial, column: Column, value: f64) {
        match column {
            Column::Quality => material.quality = Some(value),
            Column::Qty => material.qty = Some(value),
            Column::Yield => material.yield_amount = Some(value),
            Column::ToDo => material.to_do = Some(value),
            Column::Done => material.done = Some(value),
        }
    }
}

/// Material rows: everything between the table header and whatever ends it.
fn materials_in(rows: &[Vec<&OcrLine>], table: &Table, stop_y: Option<i32>) -> Vec<OrderMaterial> {
    // Without a yield column there is nothing to infer the toggle from, so the
    // rows are taken as they arrive — on, which is how the panel starts.
    let has_yield = table.kinds.contains(&Column::Yield);
    let mut materials = Vec::new();

    for row in rows {
        let row_y = centre_y(row[0]);
        if row_y <= table.header_bottom {
            continue;
        }
        if stop_y.is_some_and(|stop| row_y >= stop) {
            break;
        }
        let Some(name_cell) = row.first() else { continue };
        let resource = clean_resource(&name_cell.text);
        // A material has a name. A row whose first cell is only digits is
        // something else that landed inside the table's span — a price, a
        // total — and naming it after its own number would save a material
        // nobody mined.
        if resource.is_empty() || is_label(&resource) || resource.chars().filter(|c| c.is_alphabetic()).count() < 2 {
            continue;
        }

        let values: Vec<&&OcrLine> = row.iter().skip(1).collect();
        let mut material = OrderMaterial { resource, refine: true, ..Default::default() };
        let mut had_value = false;
        let mut filled_from_text = false;

        // A row that arrived as one cell ("504 99 72 28") carries its values in
        // column order; separate cells are placed by where they sit, which is
        // what lets a row with a missing leading column still land correctly.
        let run_together = values.len() == 1 && numbers_in(&values[0].text).len() > 1;
        if run_together || table.centres.is_none() {
            let numbers: Vec<f64> = values.iter().flat_map(|cell| numbers_in(&cell.text)).collect();
            for (kind, value) in table.kinds.iter().zip(numbers) {
                table.set(&mut material, *kind, value);
                had_value = true;
            }
        } else {
            for cell in values {
                let Some(column) = table.column_of(cell) else { continue };
                let Some(value) = numbers_in(&cell.text).into_iter().next() else { continue };
                table.set(&mut material, column, value);
                had_value = true;
            }
        }

        // The whole row as one line, name and numbers together — the reader
        // does this to a row whose figures are set tight. Its numbers are the
        // only ones there are, so they are placed by where they sit inside the
        // text; a row read this way used to be dropped for having no values at
        // all, which is how a material vanished from a panel that showed it.
        // Whatever the cells could not supply, taken out of the text they were
        // read into. A column that already has a value keeps it: a number read
        // in a cell of its own is placed by where it actually sits, which beats
        // an estimate from a character offset.
        for cell in row.iter() {
            // Only where the header gave real column positions. A header the
            // reader ran together says which columns exist but not where, and
            // a row read this badly is usually one whose figures are wrong
            // anyway ("5 CORUNDUM ORE S04 131") — placing those in order
            // invents values rather than reading them.
            if table.centres.is_some() {
                for (value, x) in numbers_with_x(cell) {
                    if let Some(column) = table.column_near(x) {
                        if table.holds(&material, column) {
                            continue;
                        }
                        table.set(&mut material, column, value);
                        had_value = true;
                        filled_from_text = true;
                    }
                }
            }
            // The figures were part of the name as read, and are now columns of
            // their own, so the name gives them up rather than keeping them.
            if filled_from_text && std::ptr::eq(*cell, *name_cell) {
                material.resource = clean_resource(&strip_numbers(&cell.text));
            }
        }

        if !had_value {
            continue; // a heading or a stray label, not a material row
        }
        if has_yield {
            material.refine = material.yield_amount.is_some_and(|amount| amount > 0.0);
        }
        materials.push(material);
    }
    materials
}

/// Panel furniture rather than a material name.
///
/// Matched exactly for single words and by phrase for headings, because a real
/// material can contain a heading's word: "Inert Materials" is a row of the
/// table, not the table's "MATERIAL" heading.
fn is_label(text: &str) -> bool {
    const EXACT: [&str; 8] = ["MATERIAL", "MATERIALS", "YIELD", "QUALITY", "QTY", "DONE", "REFINE", "TOTAL"];
    const PHRASES: [&str; 16] = [
        "MATERIALS SELECTED",
        "MATERIALS YIELDED",
        "TOTAL COST",
        "PROCESSING TIME",
        "TIME REMAINING",
        "SELECT STORAGE",
        "WORK ORDER",
        "RAW MATERIALS",
        "PROCESSING SELECTION",
        "STOP",
        "COLLECT",
        // The panels' own titles. Named here so none of them can be mistaken
        // for the station, whose name is printed in the same corner.
        "STATION PROFILE",
        "MATERIAL SELECTION",
        "MATERIAL SPECIALIZATIONS",
        "REFINERY CAPACITY",
        "USER DETAILS",
    ];
    let canon = canonical(text);
    if EXACT.iter().any(|label| canon == canonical(label))
        || PHRASES.iter().any(|phrase| canon.contains(&canonical(phrase)))
    {
        return true;
    }
    // A letter the reader lost or mistook. "TOTAL COST" comes back as "'otal
    // Cost", which matched nothing and so became a material — a row named
    // after the panel's own total, carrying the cost as its yield. The set of
    // labels is fixed and short, so a near miss on a whole line is a misread
    // label rather than a material that happens to look like one.
    PHRASES
        .iter()
        .chain(EXACT.iter())
        .map(|label| canonical(label))
        .any(|label| label.len() >= 5 && near(&canon, &label))
}

/// Two readings of the same short, known word: at most one letter wrong in
/// five, and never a difference in length that a letter or two cannot explain.
fn near(a: &str, b: &str) -> bool {
    if a.len().abs_diff(b.len()) > 2 {
        return false;
    }
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut previous = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            let next = (row[j + 1] + 1).min(row[j] + 1).min(previous + cost);
            previous = row[j + 1];
            row[j + 1] = next;
        }
    }
    row[b.len()] <= (b.len() / 5).max(1)
}

/// The heading over the material *names*, which is not a value column.
///
/// It has to be recognised so it can be left out of the column scan: on the
/// processing screen it reads "MATERIALS YIELDED (CSCU)", and the YIELD inside
/// it would otherwise be taken for the yield column.
fn is_name_heading(text: &str) -> bool {
    let canon = canonical(text);
    ["MATERIALS SELECTED", "MATERIALS YIELDED"].iter().any(|p| canon.contains(&canonical(p)))
        || canon == canonical("MATERIAL")
}

/// Tidy a material name OCR has roughed up.
///
/// The ore icon in front of each row reads as a stray letter or symbol, and the
/// parentheses of "IRON (ORE)" come back as an I glued to the word.
fn clean_resource(raw: &str) -> String {
    let mut words: Vec<String> = raw
        .split_whitespace()
        .map(|w| w.to_string())
        .filter(|w| w.chars().any(|c| c.is_ascii_alphanumeric()))
        .collect();
    if words.first().is_some_and(|w| w.chars().count() == 1) {
        words.remove(0); // the ore icon, not part of the name
    }
    let joined = words.join(" ");
    let restored = joined
        .replace("IORE)", "(Ore)")
        .replace("IORE", "(Ore)")
        .replace("(ORE)", "(Ore)")
        .replace("[ORE]", "(Ore)");
    title_case(&restored).replace("(ore)", "(Ore)")
}

fn title_case(text: &str) -> String {
    text.split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

// ── Numbers and durations ──────────────────────────────────────────────────

/// Every number in a line, tolerating the game's thousands separators.
///
/// The panel writes "5,253,683" and "281.00", and OCR turns some separators
/// into stray dots, so a group of exactly three digits after a separator is
/// read as thousands and anything else as a decimal point.
pub fn numbers_in(text: &str) -> Vec<f64> {
    let mut out = Vec::new();
    let mut current = String::new();
    for ch in text.chars().chain(std::iter::once(' ')) {
        if ch.is_ascii_digit() || ((ch == '.' || ch == ',') && !current.is_empty()) {
            current.push(ch);
        } else {
            if let Some(value) = parse_number(&current) {
                out.push(value);
            }
            current.clear();
        }
    }
    out
}

fn parse_number(raw: &str) -> Option<f64> {
    let trimmed = raw.trim_matches(|c| c == '.' || c == ',');
    if trimmed.is_empty() {
        return None;
    }
    let chars: Vec<char> = trimmed.chars().collect();
    let mut cleaned = String::new();
    for (i, ch) in chars.iter().enumerate() {
        if *ch == '.' || *ch == ',' {
            let group: String = chars[i + 1..].iter().take_while(|c| c.is_ascii_digit()).collect();
            let ends_group = chars.get(i + 1 + group.len()).is_none_or(|c| !c.is_ascii_digit());
            if group.len() == 3 && ends_group && !cleaned.is_empty() {
                continue; // thousands separator
            }
            cleaned.push('.');
        } else {
            cleaned.push(*ch);
        }
    }
    cleaned.parse().ok()
}

/// "22m 28s", "2d 4h 13m", "16m 7s" → seconds.
fn duration_seconds(text: &str) -> Option<i64> {
    let lower = text.to_lowercase();
    let mut total = 0i64;
    let mut found = false;
    let mut number = String::new();
    for ch in lower.chars() {
        if ch.is_ascii_digit() {
            number.push(ch);
            continue;
        }
        if !number.is_empty() {
            if let Ok(value) = number.parse::<i64>() {
                let seconds = match ch {
                    'd' => Some(value * 86_400),
                    'h' => Some(value * 3_600),
                    'm' => Some(value * 60),
                    's' => Some(value),
                    _ => None,
                };
                if let Some(seconds) = seconds {
                    total += seconds;
                    found = true;
                }
            }
            number.clear();
        }
    }
    found.then_some(total)
}

// ── Method ─────────────────────────────────────────────────────────────────

/// The refining methods the game offers. Used only to tidy a misread name —
/// the method is found by where it sits, not by matching this list, so a
/// method added to the game still parses.
/// The nine the terminal offers, spelled as the terminal spells them.
///
/// The spelling matters as much as the list: a method is stored as text and
/// the website offers these same nine to pick from, so "Xcr Reaction" — which
/// is what title-casing a read makes of it — is a method no order can be
/// matched against.
const METHODS: [&str; 9] = [
    "Cormack Method",
    "Dinyx Solventation",
    "Electrostarolysis",
    "Ferron Exchange",
    "Gaskin Process",
    "Kazen Winnowing",
    "Pyrometric Chromalysis",
    "Thermonatic Deposition",
    "XCR Reaction",
];

/// The closest known method name, or the text as read when none is close.
fn tidy_method(text: &str) -> String {
    let read = canonical(text);
    let best = METHODS
        .iter()
        .map(|m| (m, shared_runs(&read, &canonical(m))))
        .filter(|(_, score)| *score >= 0.5)
        .max_by(|a, b| a.1.total_cmp(&b.1));
    match best {
        Some((method, _)) => method.to_string(),
        None => title_case(text),
    }
}

/// How much of the needle the haystack contains, compared in short runs so a
/// name mangled in one place still scores highly.
fn shared_runs(haystack: &str, needle: &str) -> f64 {
    if needle.is_empty() {
        return 0.0;
    }
    if haystack.contains(needle) {
        return 1.0;
    }
    let chunk = 5.min(needle.len());
    let windows: Vec<&str> = needle.as_bytes().windows(chunk).filter_map(|w| std::str::from_utf8(w).ok()).collect();
    if windows.is_empty() {
        return 0.0;
    }
    windows.iter().filter(|w| haystack.contains(**w)).count() as f64 / windows.len() as f64
}

/// "VERY LOW SPEED // LOW COST // HIGH YIELD" — the method's trade-offs.
fn is_traits_line(text: &str) -> bool {
    ["SPEED", "COST", "YIELD"].iter().filter(|word| reads_as_text(text, word)).count() >= 2
}

// ── Panels ─────────────────────────────────────────────────────────────────

/// A work order panel's state header, and where its column of the screen starts.
struct Anchor<'a> {
    state: OrderState,
    line: &'a OcrLine,
}

/// The state headers on screen, left to right.
///
/// Each work order panel is titled with its state and its number on one row
/// ("COMPLETED    WORK ORDER 2"). The section headings inside a panel — "02 //
/// PROCESSING" — carry no order number, which is what tells them apart.
fn anchors<'a>(lines: &'a [OcrLine]) -> Vec<Anchor<'a>> {
    let mut found: Vec<Anchor> = Vec::new();
    for cell in lines {
        let state = if reads_as(cell, "SETUP") {
            OrderState::Setup
        } else if reads_as(cell, "COMPLETED") {
            OrderState::Completed
        } else if reads_as(cell, "PROCESSING") {
            OrderState::Processing
        } else {
            continue;
        };
        // The title and the state must be two cells: a single cell reading
        // "SETUP WORK ORDER" is the station panel's button, not a panel.
        //
        // Matched on the baseline rather than on a shared row, because rows are
        // grouped across the whole capture and the station panel's own lines
        // interleave with these — one of them landing between the state and its
        // title is enough to split them, and then the panel is never found.
        let titled = lines.iter().any(|l| {
            !std::ptr::eq(l, cell)
                && reads_as(l, "WORK ORDER")
                && (centre_y(l) - centre_y(cell)).abs() <= cell.h.max(l.h)
                && l.x > cell.x
                && l.x - cell.x <= cell.h.max(6) * 40
        });
        if titled {
            found.push(Anchor { state, line: cell });
        }
    }
    found.sort_by_key(|a| a.line.x);
    found
}

/// Split the capture into one group of lines per work order panel.
///
/// Panels are columns of the screen, so a line belongs to the rightmost anchor
/// at or left of it. Anything left of the first anchor is the station panel.
fn panels<'a>(lines: &'a [OcrLine], anchors: &[Anchor<'a>]) -> Vec<Vec<&'a OcrLine>> {
    anchors
        .iter()
        .enumerate()
        .map(|(index, anchor)| {
            // A panel's own headings start a little left of its title.
            let slack = anchor.line.h.max(6) * 4;
            let left = anchor.line.x - slack;
            let right = anchors.get(index + 1).map(|next| next.line.x - slack).unwrap_or(i32::MAX);
            lines.iter().filter(|l| l.x >= left && l.x < right).collect()
        })
        .collect()
}

/// The unit a table counts in, from a heading like "MATERIALS YIELDED (CSCU)".
fn unit_in(lines: &[&OcrLine]) -> String {
    for line in lines {
        if !is_name_heading(&line.text) {
            continue;
        }
        let canon = canonical(&line.text);
        // Checked longest first: "CSCU" and "MSCU" both end in "SCU".
        for unit in ["CSCU", "MSCU", "SCU"] {
            if canon.contains(unit) {
                return match unit {
                    "CSCU" => "cSCU".to_string(),
                    "MSCU" => "mSCU".to_string(),
                    _ => "SCU".to_string(),
                };
            }
        }
    }
    DEFAULT_UNIT.to_string()
}

/// Read one work order panel.
fn parse_order(lines: &[&OcrLine], state: OrderState, anchor: &OcrLine) -> WorkOrder {
    let rows = rows(lines);
    let mut order = WorkOrder { state, unit: unit_in(lines), ..Default::default() };

    // The panel's number sits on the state header's own row, to its right.
    if let Some(row) = rows.iter().find(|row| row.iter().any(|l| std::ptr::eq(*l, anchor))) {
        order.number = row
            .iter()
            .filter(|l| l.x > anchor.x)
            .find_map(|l| numbers_in(&l.text).into_iter().next())
            .map(|n| n as i64);
    }

    // Method: the first line under the "PROCESSING SELECTION" heading, with the
    // trade-off line following it. Only a setup panel has one.
    if let Some(section) = find(lines, "PROCESSING SELECTION") {
        let mut below: Vec<&OcrLine> = lines
            .iter()
            .filter(|l| centre_y(l) > centre_y(section))
            .filter(|l| l.text.chars().filter(|c| c.is_alphabetic()).count() >= 6)
            .copied()
            .collect();
        below.sort_by_key(|l| centre_y(l));
        for candidate in below {
            if is_traits_line(&candidate.text) {
                order.method_traits.get_or_insert_with(|| candidate.text.trim().to_string());
                continue;
            }
            if order.method.is_none() {
                order.method = Some(tidy_method(&candidate.text));
            }
            if order.method.is_some() && order.method_traits.is_some() {
                break;
            }
        }
    }

    let scalar = |label: &str| find(lines, label).and_then(|l| scalar_for(&rows, l));
    order.cost = scalar("TOTAL COST");
    order.in_manifest = scalar("IN MANIFEST");
    order.to_refine = scalar("TO REFINE");

    // Time: "PROCESSING TIME" while setting up, "TIME REMAINING" once running.
    for label in ["PROCESSING TIME", "TIME REMAINING"] {
        if order.duration_seconds.is_some() {
            break;
        }
        if let Some(line) = find(lines, label) {
            order.duration_seconds = duration_seconds(&line.text).or_else(|| {
                let candidates = value_candidates(&rows, line);
                // A clock is one value written in parts, and the reader splits
                // it as often as not: "0m 26s" comes back as "0m" and "26s",
                // two cells on the same row. Taking the first that parses gets
                // the minutes and throws the seconds away — and where the
                // minutes are zero, that is a job with no time left on it. So
                // the row is read as one string first.
                let joined: String =
                    candidates.iter().map(|c| c.text.as_str()).collect::<Vec<_>>().join(" ");
                duration_seconds(&joined)
                    .filter(|seconds| *seconds > 0)
                    .or_else(|| candidates.into_iter().find_map(|c| duration_seconds(&c.text)))
            });
        }
    }

    let table = table(&rows);
    if let Some(table) = &table {
        // The table ends at the cost line, or at the total yield under it.
        let stop = ["TOTAL COST", "RESULTS"]
            .iter()
            .filter_map(|label| find(lines, label))
            .map(centre_y)
            .chain(total_yield_label(lines, table).map(centre_y))
            .min();
        order.materials = materials_in(&rows, table, stop);
    }

    // The order's total yield prints under the table as its own labelled line,
    // which is a different YIELD from the table's column heading.
    if let Some(table) = &table {
        if let Some(label) = total_yield_label(lines, table) {
            order.yield_total = scalar_for(&rows, label);
        }
    }

    order
}

/// The "YIELD" that labels the order total, rather than the table's column.
///
/// Both read the same; the total is the one standing alone on a row below the
/// table, with its value beside it.
fn total_yield_label<'a>(lines: &[&'a OcrLine], table: &Table) -> Option<&'a OcrLine> {
    lines
        .iter()
        .filter(|l| centre_y(l) > table.header_bottom)
        .filter(|l| canonical(&l.text) == canonical("YIELD"))
        .min_by_key(|l| centre_y(l))
        .copied()
}

/// Turn OCR lines from a refinement terminal into everything on screen.
pub fn parse(lines: &[OcrLine]) -> RefineryTerminal {
    let all: Vec<&OcrLine> = lines.iter().collect();
    let all_rows = rows(&all);
    let mut terminal = RefineryTerminal::default();

    // Station: the terminal titles itself "REFINEMENT CENTER", with the place
    // to its left on the same row.
    // The station's name sits top left, opposite the REFINEMENT CENTER title.
    if let Some(title) = find(&all, "REFINEMENT") {
        if let Some(row) = all_rows.iter().find(|row| row.iter().any(|l| std::ptr::eq(*l, title))) {
            if let Some(left) = row.iter().find(|l| centre_x(l) < centre_x(title) && !is_label(&l.text)) {
                terminal.station = Some(clean_station(&left.text));
            }
        }
    }
    // The title is set in much larger type than the name beside it, so the two
    // often do not share a row once OCR has had its way with their heights.
    // Falling back on position alone: the name is the first thing printed, in
    // the left of the panel, and it is not one of the headings.
    //
    // Only ever when the title itself was read, so this cannot name a station
    // on a capture that is not a refinery terminal at all: the fallback is for
    // a title whose row broke, not for guessing.
    if terminal.station.is_none() && find(&all, "REFINEMENT").is_some() {
        let left_edge = all.iter().map(|l| l.x).min().unwrap_or(0);
        let top_edge = all.iter().map(|l| centre_y(l)).min().unwrap_or(0);
        let width = all.iter().map(|l| l.x + l.w).max().unwrap_or(0) - left_edge;
        let height = all.iter().map(|l| centre_y(l)).max().unwrap_or(0) - top_edge;
        terminal.station = all
            .iter()
            .filter(|l| l.x - left_edge < width / 3)
            .filter(|l| centre_y(l) - top_edge <= height / 4)
            // A station is named in a word or two, and never in a heading.
            .filter(|l| l.text.split_whitespace().count() <= 3 && !is_label(&l.text))
            .filter(|l| l.text.chars().filter(|c| c.is_alphabetic()).count() >= 3)
            .min_by_key(|l| centre_y(l))
            .map(|l| clean_station(&l.text));
    }

    let anchors = anchors(lines);
    for (panel, anchor) in panels(lines, &anchors).into_iter().zip(&anchors) {
        terminal.orders.push(parse_order(&panel, anchor.state, anchor.line));
    }

    // The station panel is whatever sits left of the first work order.
    let station_panel: Vec<&OcrLine> = match anchors.first() {
        Some(first) => all.iter().filter(|l| l.x < first.line.x - first.line.h.max(6) * 4).copied().collect(),
        None => all.clone(),
    };
    let station_rows = rows(&station_panel);
    terminal.capacity_percent =
        find(&station_panel, "CURRENT CAPACITY").and_then(|l| scalar_for(&station_rows, l));
    terminal.ship = station_panel
        .iter()
        .find(|l| l.text.contains('"') && l.text.chars().any(|c| c.is_ascii_digit()))
        .map(|l| l.text.trim().to_string());
    terminal.specializations = specializations_in(&station_rows);

    for (field, missing) in [
        ("station", terminal.station.is_none()),
        ("orders", terminal.orders.is_empty()),
        ("materials", terminal.orders.iter().all(|o| o.materials.is_empty())),
    ] {
        if missing {
            terminal.missing.push(field.to_string());
        }
    }
    terminal
}

/// The station name, without the decoration around it.
fn clean_station(raw: &str) -> String {
    raw.trim().trim_matches(|c: char| !c.is_alphanumeric()).to_string()
}

/// The station's per-material yield bonuses, from the left panel's
/// MATERIAL SPECIALIZATIONS table. Absent when only a work order is framed.
fn specializations_in(rows: &[Vec<&OcrLine>]) -> Vec<Specialization> {
    let Some(header_y) =
        rows.iter().flatten().find(|l| reads_as(l, "MATERIAL SPECIALIZATIONS")).map(|l| centre_y(l))
    else {
        return Vec::new();
    };
    let end_y = rows
        .iter()
        .flatten()
        .filter(|l| centre_y(l) > header_y && reads_as(l, "REFINERY CAPACITY"))
        .map(|l| centre_y(l))
        .min()
        .unwrap_or(i32::MAX);

    let mut out = Vec::new();
    for row in rows {
        let y = centre_y(row[0]);
        if y <= header_y || y >= end_y {
            continue;
        }
        let Some(name) = row.first() else { continue };
        let material = clean_resource(&name.text);
        if material.is_empty() || is_label(&material) {
            continue; // the column headings
        }
        // The bonus is the rightmost percentage. OCR often loses the digits, so
        // a row without one is still kept — knowing the station specialises in
        // a material is useful on its own.
        let bonus = row
            .iter()
            .skip(1)
            .filter(|l| l.text.contains('%'))
            .filter_map(|l| numbers_in(&l.text).into_iter().next())
            .next_back();
        out.push(Specialization { material, bonus_percent: bonus });
    }
    out
}

// ── Merging captures ───────────────────────────────────────────────────────

/// Two rows are the same row when they name the same material at the same
/// quality.
///
/// Quality is part of the identity because one order routinely holds the same
/// ore twice at different grades — the Levski setup screen has two aluminium
/// rows, at 310 and 703.
fn same_material(a: &OrderMaterial, b: &OrderMaterial) -> bool {
    if canonical(&a.resource) != canonical(&b.resource) {
        return false;
    }
    match (a.quality, b.quality) {
        (Some(x), Some(y)) => (x - y).abs() < 0.5,
        // Without a quality to tell them apart, fall back to the amount.
        _ => a.qty == b.qty && a.yield_amount == b.yield_amount,
    }
}

/// How many of a row's columns were actually read.
fn filled(material: &OrderMaterial) -> usize {
    [material.quality, material.qty, material.yield_amount, material.to_do, material.done]
        .iter()
        .filter(|value| value.is_some())
        .count()
}

/// Add a fresh capture's rows to what is already on screen.
///
/// A long material list scrolls, so one press of the hotkey sees only part of
/// it. Reading again after scrolling adds the rows that were hidden, keeping
/// the fuller version of any row seen twice.
pub fn merge(previous: &RefineryTerminal, fresh: RefineryTerminal) -> RefineryTerminal {
    let comparable = previous.orders.len() == fresh.orders.len()
        && !fresh.orders.is_empty()
        && previous.orders.iter().zip(&fresh.orders).all(|(a, b)| a.state == b.state)
        && match (&previous.station, &fresh.station) {
            (Some(a), Some(b)) => canonical(a) == canonical(b),
            _ => true,
        };
    if !comparable {
        return fresh; // a different terminal, or a different set of orders
    }

    let mut merged = fresh;
    merged.captures = previous.captures.max(1) + 1;

    for (index, order) in merged.orders.iter_mut().enumerate() {
        let before = &previous.orders[index];
        // Rows already seen keep their place; rows only in the new capture are
        // appended, which is the order they scrolled into view.
        let mut rows: Vec<OrderMaterial> = before.materials.clone();
        for row in std::mem::take(&mut order.materials) {
            match rows.iter_mut().find(|seen| same_material(seen, &row)) {
                Some(seen) => {
                    if filled(&row) > filled(seen) {
                        *seen = row;
                    }
                }
                None => rows.push(row),
            }
        }
        order.materials = rows;

        // A scrolled capture may have the totals off screen; keep what was read.
        order.cost = order.cost.or(before.cost);
        order.duration_seconds = order.duration_seconds.or(before.duration_seconds);
        order.yield_total = order.yield_total.or(before.yield_total);
        order.in_manifest = order.in_manifest.or(before.in_manifest);
        order.to_refine = order.to_refine.or(before.to_refine);
        order.method = order.method.clone().or_else(|| before.method.clone());
        order.method_traits = order.method_traits.clone().or_else(|| before.method_traits.clone());
        order.number = order.number.or(before.number);
        if order.unit == DEFAULT_UNIT && before.unit != DEFAULT_UNIT {
            order.unit = before.unit.clone();
        }
    }

    merged.station = merged.station.or_else(|| previous.station.clone());
    merged.ship = merged.ship.or_else(|| previous.ship.clone());
    merged.capacity_percent = merged.capacity_percent.or(previous.capacity_percent);

    // The specialisations list scrolls as well, so it is built up across
    // captures the same way: a material seen before keeps its place, and a
    // later reading of it wins only if it finally carries a bonus.
    let mut specializations = previous.specializations.clone();
    for fresh in std::mem::take(&mut merged.specializations) {
        match specializations.iter_mut().find(|seen| canonical(&seen.material) == canonical(&fresh.material)) {
            Some(seen) => {
                if seen.bonus_percent.is_none() {
                    seen.bonus_percent = fresh.bonus_percent;
                }
            }
            None => specializations.push(fresh),
        }
    }
    merged.specializations = specializations;
    merged
}

// ── Commands ───────────────────────────────────────────────────────────────

/// `fresh` true throws away earlier captures instead of adding to them.
#[tauri::command]
pub async fn refinery_read(app: AppHandle, fresh: Option<bool>) -> Result<RefineryTerminal, String> {
    read_with(app, !fresh.unwrap_or(false)).await
}

/// Forget what has been read, so the next capture starts a new order.
#[tauri::command]
pub fn refinery_clear(app: AppHandle) {
    *app.state::<RefineryState>().last.lock().unwrap() = None;
}

#[tauri::command]
pub fn refinery_last(app: AppHandle) -> Option<RefineryTerminal> {
    app.state::<RefineryState>().last.lock().unwrap().clone()
}

/// Send one checked work order to the server.
///
/// The station and the capture time come from the terminal, the rest from the
/// panel the player chose — a capture can hold several orders and they are not
/// all worth saving.
#[tauri::command]
pub async fn refinery_save(
    app: AppHandle,
    terminal: RefineryTerminal,
    order: WorkOrder,
) -> Result<serde_json::Value, String> {
    let settings = crate::load_settings(&app).ok_or("Not paired with a server yet.")?;
    let station = terminal.station.clone().ok_or("An order needs a station before it can be saved.")?;

    let captured_at = if terminal.captured_at > 0 { terminal.captured_at } else { chrono_now_millis() };
    // A running order's remaining time counts from now; a setup panel's is how
    // long it would take if confirmed.
    let eta = order.duration_seconds.map(|s| millis_to_iso8601((captured_at + s * 1_000) as f64));

    // Amounts go out as read, with the unit beside them: converting here would
    // hide what the panel actually said behind a number nobody can check.
    let materials: Vec<serde_json::Value> = order
        .materials
        .iter()
        .map(|material| {
            let mut value = serde_json::to_value(material).unwrap_or(serde_json::Value::Null);
            if let Some(object) = value.as_object_mut() {
                object.insert("unit".into(), serde_json::json!(order.unit));
            }
            value
        })
        .collect();

    // The whole reading travels with the order: the terminal shows more than
    // the columns StarBuddy stores, and a saved order is worth being able to
    // check against what was actually on screen.
    let capture = serde_json::json!({
        "captures": terminal.captures,
        "ship": terminal.ship,
        "capacity_percent": terminal.capacity_percent,
        "method_traits": order.method_traits,
        "in_manifest": order.in_manifest,
        "to_refine": order.to_refine,
        "elapsed_ms": terminal.elapsed_ms,
        "lines": terminal.lines.iter().map(|l| &l.text).collect::<Vec<_>>(),
    });

    let body = serde_json::json!({
        "station": station,
        "method": order.method,
        "work_order_number": order.number,
        "state": order.state,
        "materials": materials,
        "unit": order.unit,
        "duration_seconds": order.duration_seconds,
        "cost": order.cost,
        "yield_total": order.yield_total,
        "capture": capture,
        "placed_at": millis_to_iso8601(captured_at as f64),
        "eta": eta,
        "source": "ocr",
    });

    let resp = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .post(format!("{}/api/refinery-orders", settings.server_url))
        .bearer_auth(&settings.token)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Could not reach server: {e}"))?;

    if !resp.status().is_success() {
        return Err(crate::error_body(resp).await);
    }
    resp.json().await.map_err(|e| e.to_string())
}

fn chrono_now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Unix millis → an ISO-8601 UTC string Laravel's date validator accepts.
/// Written by hand rather than pulling in a date crate for one format.
fn millis_to_iso8601(millis: f64) -> String {
    let secs = (millis / 1000.0).floor() as i64;
    let days = secs.div_euclid(86_400);
    let time = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3600,
        (time % 3600) / 60,
        time % 60
    )
}

/// Howard Hinnant's days-from-civil, inverted. Public-domain algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(text: &str, x: i32, y: i32, w: i32, h: i32) -> OcrLine {
        OcrLine { text: text.into(), x, y, w, h }
    }

    #[test]
    fn a_method_keeps_the_spelling_the_terminal_uses() {
        // Read from the panel in capitals and title-cased into something the
        // website's own list of methods does not contain.
        assert_eq!(tidy_method("XCR REACTION"), "XCR Reaction");
        assert_eq!(tidy_method("Xcr Reaction"), "XCR Reaction");
        // Misread, and still the method it is.
        assert_eq!(tidy_method("GASKIN PROCFSS"), "Gaskin Process");
        assert_eq!(tidy_method("PYROMETRIC CHROMALYSIS"), "Pyrometric Chromalysis");
        // Nothing like a method is left as it was read rather than forced.
        assert_eq!(tidy_method("SELECT A METHOD"), "Select A Method");
    }

    #[test]
    fn a_clock_split_across_cells_is_read_whole() {
        // Verbatim from a capture: the panel's "0m 26s" came back as two
        // lines, and reading the first of them left the job with no time on
        // it at all.
        let mut lines = tight_table();
        lines.extend([
            line("PROCESSING TIME", 27, 869, 157, 17),
            line("0m", 300, 872, 30, 20),
            line("26s", 360, 872, 44, 20),
        ]);
        let terminal = parse(&lines);
        let order = terminal.orders.first().expect("an order");
        assert_eq!(order.duration_seconds, Some(26));
    }

    #[test]
    fn a_misread_label_is_still_a_label() {
        // Straight off the window: the panel's total became a fifth material,
        // named "'otal Cost" and carrying 123 aUEC as its yield.
        assert!(is_label("'otal Cost"));
        assert!(is_label("TOTAL COST"));
        assert!(is_label("PROCESSlNG TIME"));
        // And nothing a mine produces goes with them.
        assert!(!is_label("Corundum Ore"));
        assert!(!is_label("Inert Materials"));
        assert!(!is_label("Torite Ore"));
        assert!(!is_label("Quantainium"));
    }

    /// A materials table read the way the terminal's own OCR reads a tight one:
    /// the header both as a run-together line and as its separate headings, and
    /// rows that came back whole rather than as cells.
    ///
    /// Verbatim from a 5120×1440 capture of the Levski setup panel, which the
    /// reader answered with no materials at all and no quality for any of them.
    fn tight_table() -> Vec<OcrLine> {
        vec![
            line("WORK ORDER", 44, 18, 95, 12),
            line("SETUP", 44, 46, 68, 16),
            line("WORK ORDER", 279, 47, 96, 16),
            line("MATERIALS SELECTED QUALITY OTY YIELD REFINE", 26, 361, 436, 15),
            line("QUALITY", 232, 362, 46, 15),
            line("OTY", 308, 362, 21, 14),
            line("MATERIALS SELECTED", 27, 364, 117, 14),
            line("YIELD", 366, 365, 29, 10),
            line("REFINE", 425, 365, 37, 11),
            line("Y CORUNDUM ORE", 36, 397, 177, 19),
            line("CORUNDUM ORE 584 131 63", 70, 398, 318, 16),
            line("63", 373, 400, 15, 13),
            line("504", 245, 403, 21, 10),
            line("131", 309, 403, 19, 9),
            line("ALUMINUM ORE 318 387", 69, 507, 260, 16),
            line("Y ALUMINUM ORE 783 226 110", 35, 558, 357, 22),
            line("TOTAL COST", 27, 711, 103, 15),
        ]
    }

    #[test]
    fn a_column_heading_is_not_the_total_under_the_table() {
        // The separate headings sit a couple of pixels below the run-together
        // line's centre. Measured from that centre, "YIELD" looked like the
        // order's total yield printed under the table, and everything below it
        // — every material — was taken to be past the table's end.
        let terminal = parse(&tight_table());
        let order = terminal.orders.first().expect("an order");
        assert_eq!(order.materials.len(), 3, "the rows are inside the table, not under it");
        assert_eq!(order.yield_total, None, "a column heading is not a total");
    }

    #[test]
    fn a_row_read_as_one_line_still_lands_in_its_columns() {
        let terminal = parse(&tight_table());
        let order = terminal.orders.first().expect("an order");
        let aluminium: Vec<&OrderMaterial> =
            order.materials.iter().filter(|m| m.resource == "Aluminum Ore").collect();
        assert_eq!(aluminium.len(), 2, "both rows arrived whole, and neither was dropped");
        // 318 387 with nothing under YIELD: placed by where they sit in the
        // text, so the gap is the yield rather than the quality.
        assert_eq!(aluminium[0].quality, Some(318.0));
        assert_eq!(aluminium[0].qty, Some(387.0));
        assert_eq!(aluminium[0].yield_amount, None);
        assert_eq!(aluminium[1].quality, Some(783.0));
        assert_eq!(aluminium[1].qty, Some(226.0));
        assert_eq!(aluminium[1].yield_amount, Some(110.0));
    }

    #[test]
    fn a_cell_of_its_own_beats_the_same_number_read_into_the_name() {
        let terminal = parse(&tight_table());
        let order = terminal.orders.first().expect("an order");
        let corundum = order.materials.first().expect("the first row");
        assert_eq!(corundum.resource, "Corundum Ore");
        // The row line says 584, the cell says 504, and the cell is the one
        // that was read where the number actually sits.
        assert_eq!(corundum.quality, Some(504.0));
        assert_eq!(corundum.qty, Some(131.0));
        assert_eq!(corundum.yield_amount, Some(63.0));
    }

    #[test]
    fn a_number_welded_to_letters_is_not_a_figure() {
        // "S04" is a misread 504, and reading a 4 out of it would put a number
        // the panel never printed into the table.
        let cell = line("5 CORUNDUM ORE S04 131", 438, 483, 231, 20);
        let values: Vec<f64> = numbers_with_x(&cell).into_iter().map(|(v, _)| v).collect();
        assert_eq!(values, vec![5.0, 131.0]);
    }

    /// The Levski terminal setting up a work order, exactly as the client's own
    /// OCR read it from a real 2560×1440 capture.
    ///
    /// Kept verbatim, misreads and all: QUALITY comes back as "OUALITY", the ore
    /// icon in front of "CORUNDUM ORE" as a stray "Y", "IRON (ORE)" as "IRON
    /// IORE", and several digits are simply wrong. Tidying the fixture up would
    /// defeat its purpose.
    fn levski_setup() -> Vec<OcrLine> {
        vec![
            line("LEVSK", 322, 208, 50, 11),
            line("REFINEMENT CENTER", 649, 209, 210, 16),
            line("CURRENT BALANCE: 5,253.683 AUEC", 1065, 212, 160, 9),
            line("JSER DK-RAVEN", 1152, 226, 73, 7),
            line("WORK ORDER", 715, 277, 47, 5),
            line("SETUP", 715, 290, 33, 7),
            line("WORK ORDER O", 832, 292, 65, 7),
            line("01// RAW MATERIALS", 711, 312, 94, 8),
            line("// IN MANIFEST", 719, 331, 40, 5),
            line("// TO REFINE", 829, 332, 33, 5),
            line("3154", 754, 346, 21, 6),
            line("839", 866, 347, 16, 6),
            line("02// PROCESSING SELECTION. YIELD AND COSTS", 710, 369, 205, 8),
            line("PYROMETRIC CHROMALYSIS", 721, 396, 117, 7),
            line("VERY LOW SPEED / LOW COST // HIGH YIELD", 761, 426, 117, 5),
            line("MATERIALS SELECTED", 708, 448, 58, 5),
            line("OUALITY", 810, 447, 21, 4),
            line("OTY", 847, 447, 9, 4),
            line("YIELD", 876, 448, 13, 3),
            line("REFINE", 904, 447, 17, 4),
            line("IRON IORE", 729, 465, 44, 7),
            line("325", 816, 466, 9, 4),
            line("1085", 846, 465, 12, 5),
            line("Y CORUNDUM ORE", 712, 491, 88, 9),
            line("504", 817, 492, 9, 5),
            line("204", 847, 492, 10, 5),
            line("99", 879, 492, 6, 5),
            line("INERT MATERIALS", 729, 518, 73, 7),
            line("241", 847, 518, 9, 5),
            line("ALUMINUM ORE", 730, 545, 66, 7),
            line("1229", 846, 545, 12, 5),
            line("318", 816, 546, 9, 4),
            line("DD", 902, 569, 20, 10),
            line("ALUMINUM ORE", 730, 572, 67, 7),
            line("635", 848, 572, 9, 4),
            line("308", 879, 571, 9, 4),
            line("783", 817, 573, 9, 3),
            line("281.00 QVEC", 853, 615, 76, 13),
            line("TOTAL COST", 709, 618, 50, 6),
            line("O3// PROCESSING", 711, 638, 80, 8),
            line("PROCESSING TIME", 709, 653, 76, 7),
            line("22m 28s", 847, 651, 83, 15),
            line("CONFIRM", 859, 684, 38, 7),
            line("CANCEL", 716, 687, 34, 8),
        ]
    }

    /// The station panel on the left of the same terminal.
    fn levski_station_panel() -> Vec<OcrLine> {
        vec![
            line("TATION PROFILE", 336, 274, 60, 6),
            line("/ MATERIAL SPECIALIZATIONS", 328, 289, 130, 7),
            line("MATERIAL", 340, 305, 26, 5),
            line("YIELD", 469, 307, 14, 4),
            line("Iron (Ore)", 352, 322, 26, 4),
            line("B%", 478, 322, 8, 3),
            line("Construction Rubble", 352, 336, 54, 6),
            line("9%", 478, 337, 8, 2),
            line("Bexalite Ore", 352, 352, 32, 4),
            line("Torite Ore", 353, 368, 26, 4),
            line("Corundum Ore", 353, 382, 38, 5),
            line("A%", 478, 381, 8, 3),
            line("Ouantainium Ore", 353, 398, 43, 5),
            line("/ REFINERY CAPACITY", 329, 420, 93, 6),
            line("Refineru currentlu nas an extremp", 333, 440, 101, 5),
            line("workload. A large surcharge will be", 333, 448, 103, 6),
            line("added", 333, 456, 19, 5),
            line("CURRENT CAPACITY", 382, 488, 53, 4),
            line("164814%", 357, 497, 71, 11),
            line("USERDETAILS", 333, 544, 50, 6),
            line("// MATERIAL SELECTION", 324, 555, 106, 7),
            line("2. ARGO \"MOLE\"", 336, 577, 68, 8),
            line("3154 CSCU REFINABLE", 351, 637, 60, 5),
            line("241 CSCU INERT", 357, 648, 43, 6),
            line("9600 CSCU FREE SPACE", 367, 658, 63, 6),
            line("SETUP WORK ORDER", 366, 708, 89, 9),
        ]
    }

    /// The same terminal with the order running.
    ///
    /// Read at a different scale, where OCR ran each table row together into a
    /// single line — "504 99 72 28" — and the whole header into another. The
    /// parser has to cope with both that and the separate cells above.
    fn levski_processing() -> Vec<OcrLine> {
        vec![
            line("LEVSK", 322, 208, 50, 11),
            line("REFINEMENT CENTER", 649, 209, 210, 16),
            line("WORK ORDER", 684, 274, 46, 5),
            line("PROCESSING", 684, 287, 67, 7),
            line("WORK ORDER", 800, 288, 47, 5),
            line("1", 872, 288, 5, 5),
            line("D1// DETAILS", 679, 307, 57, 6),
            line("MATERIALS YIELDED (CSCU)", 675, 323, 71, 4),
            line("OUALITY YIFLN TODO DONE", 787, 324, 104, 4),
            line("? CORUNDUM", 679, 340, 70, 7),
            line("504 99 72 28", 793, 342, 94, 5),
            line("& ALUMINUM", 678, 367, 67, 8),
            line("783 308 22287", 793, 369, 93, 4),
            line("YIELD", 676, 539, 22, 6),
            line("115.31c5CU", 817, 538, 57, 12),
            line("D2// PROCESSING", 674, 570, 79, 7),
            line("TIME REMAINING", 676, 591, 70, 5),
            line("16m 7s", 825, 591, 67, 14),
            line("SELECT STORAGE OPTION", 683, 652, 108, 6),
            line("STOP 5 COLLECT", 749, 687, 68, 5),
        ]
    }

    /// Two finished orders side by side, the state that proves a capture holds
    /// a list of panels rather than one order.
    fn levski_completed_pair() -> Vec<OcrLine> {
        let mut lines = vec![
            line("LEVSKI", 330, 210, 55, 12),
            line("REFINEMENT CENTER", 660, 210, 210, 16),
        ];
        // Panel 1, and panel 2 the same shape 230px to its right.
        for (offset, number, materials) in [
            (0, "1", vec![("IRON", "325 970"), ("CORUNDUM", "504 132"), ("ALUMINUM", "310 1041")]),
            (230, "2", vec![("CORUNDUM", "504 142"), ("ALUMINUM", "310 1220")]),
        ] {
            lines.push(line("WORK ORDER", 530 + offset, 228, 46, 5));
            lines.push(line("COMPLETED", 532 + offset, 248, 62, 8));
            lines.push(line("WORK ORDER", 640 + offset, 249, 47, 5));
            lines.push(line(number, 720 + offset, 249, 5, 5));
            lines.push(line("O1// DETAILS", 528 + offset, 278, 57, 6));
            lines.push(line("MATERIALS YIELDED (CSCU)", 525 + offset, 302, 78, 5));
            lines.push(line("QUALITY", 610 + offset, 302, 26, 5));
            lines.push(line("YIELD", 672 + offset, 302, 20, 5));
            for (row, (name, values)) in materials.iter().enumerate() {
                let y = 326 + row as i32 * 29;
                lines.push(line(name, 560 + offset, y, 40, 8));
                lines.push(line(values, 612 + offset, y, 78, 6));
            }
            lines.push(line("YIELD", 524 + offset, 630, 22, 7));
            lines.push(line("3314", 760 + offset, 628, 40, 14));
            lines.push(line("O2// RESULTS", 528 + offset, 678, 58, 6));
            lines.push(line("WORK ORDER COMPLETE", 574 + offset, 710, 120, 9));
            lines.push(line("COLLECT", 655 + offset, 855, 40, 8));
        }
        lines
    }

    #[test]
    fn numbers_tolerate_separators() {
        assert_eq!(numbers_in("281.00 QVEC"), vec![281.00]);
        assert_eq!(numbers_in("CURRENT BALANCE: 5,253.683 AUEC"), vec![5_253_683.0]);
        assert_eq!(numbers_in("164814%"), vec![164814.0]);
        assert_eq!(numbers_in("no numbers here"), Vec::<f64>::new());
    }

    #[test]
    fn durations_carry_seconds() {
        assert_eq!(duration_seconds("22m 28s"), Some(22 * 60 + 28));
        assert_eq!(duration_seconds("16m 7s"), Some(16 * 60 + 7));
        assert_eq!(duration_seconds("2d 4h 13m"), Some(2 * 86_400 + 4 * 3_600 + 13 * 60));
        assert_eq!(duration_seconds("nothing"), None);
    }

    /// Both sides of a comparison must be folded, or a label with an L in it
    /// never matches itself.
    #[test]
    fn confusable_characters_still_read_as_their_label() {
        assert!(reads_as_text("OUALITY", "QUALITY"));
        assert!(reads_as_text("OTY", "QTY"));
        assert!(reads_as_text("MATERIAL", "MATERIAL"));
        assert!(reads_as_text("YIFLD", "YIELD") || !reads_as_text("YIFLD", "QUALITY"));
        assert!(!reads_as_text("YIELD", "QUALITY"));
    }

    #[test]
    fn method_names_survive_a_misread() {
        assert_eq!(tidy_method("PYROMETRIC CHROMALYSIS"), "Pyrometric Chromalysis");
        assert_eq!(tidy_method("PYROMETRIC CHROMALYSlS"), "Pyrometric Chromalysis");
        assert_eq!(tidy_method("CORMACK METH0D"), "Cormack Method");
        // A method we have never heard of is kept as read, not forced onto the
        // nearest name we happen to know.
        assert_eq!(tidy_method("Quantum Sublimation"), "Quantum Sublimation");
    }

    #[test]
    fn reads_the_levski_setup_order() {
        let terminal = parse(&levski_setup());
        assert_eq!(terminal.station.as_deref(), Some("LEVSK"));
        assert_eq!(terminal.orders.len(), 1);

        let order = &terminal.orders[0];
        assert_eq!(order.state, OrderState::Setup);
        assert_eq!(order.method.as_deref(), Some("Pyrometric Chromalysis"));
        assert_eq!(order.method_traits.as_deref(), Some("VERY LOW SPEED / LOW COST // HIGH YIELD"));
        assert_eq!(order.cost, Some(281.00));
        assert_eq!(order.duration_seconds, Some(22 * 60 + 28));
        assert_eq!(order.in_manifest, Some(3154.0));
        assert_eq!(order.to_refine, Some(839.0));
        assert!(terminal.missing.is_empty(), "nothing should be missing: {:?}", terminal.missing);
    }

    #[test]
    fn every_setup_row_lands_in_the_right_column() {
        let order = &parse(&levski_setup()).orders[0];
        assert_eq!(order.materials.len(), 5, "five rows: {:?}", order.materials);

        assert_eq!(order.materials[0].resource, "Iron (Ore)");
        assert_eq!(order.materials[1].resource, "Corundum Ore");
        assert_eq!(order.materials[2].resource, "Inert Materials");

        // Inert has only a QTY; placing by column is what keeps it out of the
        // quality slot, which order-based reading would get wrong.
        assert_eq!(order.materials[2].quality, None);
        assert_eq!(order.materials[2].qty, Some(241.0));

        // OCR emitted this row's cells qty-first; the column decides, not order.
        let aluminium = &order.materials[3];
        assert_eq!(aluminium.quality, Some(318.0));
        assert_eq!(aluminium.qty, Some(1229.0));
        assert_eq!(aluminium.yield_amount, None, "a row printing -- has no yield, not zero");

        assert_eq!(order.materials[4].quality, Some(783.0));
        assert_eq!(order.materials[4].yield_amount, Some(308.0));

        // Checked against the toggles in the real capture: the switch is on for
        // the two rows with a yield, and off for the two printing "--" and for
        // the inert row printing 0.
        let refined: Vec<bool> = order.materials.iter().map(|m| m.refine).collect();
        assert_eq!(refined, vec![false, true, false, false, true]);
    }

    #[test]
    fn buttons_and_headings_are_not_materials() {
        let order = &parse(&levski_setup()).orders[0];
        let names: Vec<&str> = order.materials.iter().map(|m| m.resource.as_str()).collect();
        for stray in ["Cancel", "Confirm", "Total Cost", "Materials Selected"] {
            assert!(!names.contains(&stray), "{stray} should not be a material: {names:?}");
        }
    }

    #[test]
    fn reads_a_running_order_whose_rows_came_as_one_line_each() {
        let terminal = parse(&levski_processing());
        assert_eq!(terminal.orders.len(), 1);

        let order = &terminal.orders[0];
        assert_eq!(order.state, OrderState::Processing);
        assert_eq!(order.number, Some(1));
        assert_eq!(order.duration_seconds, Some(16 * 60 + 7));
        assert_eq!(order.yield_total, Some(115.31));
        assert_eq!(order.materials.len(), 2, "{:?}", order.materials);

        // Header and rows both arrived run together, so the columns are known
        // only by their order: QUALITY, YIELD, TO DO, DONE.
        let corundum = &order.materials[0];
        assert_eq!(corundum.resource, "Corundum");
        assert_eq!(corundum.quality, Some(504.0));
        assert_eq!(corundum.yield_amount, Some(99.0));
        assert_eq!(corundum.to_do, Some(72.0));
        assert_eq!(corundum.done, Some(28.0));
        assert_eq!(order.materials[1].resource, "Aluminum");
    }

    #[test]
    fn two_finished_orders_are_read_as_two() {
        let terminal = parse(&levski_completed_pair());
        assert_eq!(terminal.orders.len(), 2, "one panel per work order");

        assert_eq!(terminal.orders[0].state, OrderState::Completed);
        assert_eq!(terminal.orders[0].number, Some(1));
        assert_eq!(terminal.orders[0].materials.len(), 3);
        assert_eq!(terminal.orders[1].number, Some(2));
        assert_eq!(terminal.orders[1].materials.len(), 2);

        // A material stays with its own panel rather than bleeding across.
        let first: Vec<&str> = terminal.orders[0].materials.iter().map(|m| m.resource.as_str()).collect();
        assert_eq!(first, vec!["Iron", "Corundum", "Aluminum"]);
        assert_eq!(terminal.orders[0].materials[0].quality, Some(325.0));
        assert_eq!(terminal.orders[0].materials[0].yield_amount, Some(970.0));
    }

    #[test]
    fn the_station_panel_adds_its_specialisations_and_ship() {
        let mut lines = levski_setup();
        lines.extend(levski_station_panel());
        let terminal = parse(&lines);

        assert_eq!(terminal.station.as_deref(), Some("LEVSK"));
        assert_eq!(terminal.ship.as_deref(), Some("2. ARGO \"MOLE\""));
        assert_eq!(terminal.capacity_percent, Some(164814.0));

        let names: Vec<&str> = terminal.specializations.iter().map(|s| s.material.as_str()).collect();
        assert!(names.contains(&"Iron (Ore)"), "specialisations: {names:?}");
        assert!(names.contains(&"Corundum Ore"), "specialisations: {names:?}");
        assert!(!names.contains(&"Material"), "the column heading is not a material: {names:?}");

        // The work order is still read whole with the station panel in shot.
        assert_eq!(terminal.orders.len(), 1);
        assert_eq!(terminal.orders[0].materials.len(), 5);
    }

    /// A long material list scrolls, so one press of the hotkey sees only part
    /// of it. Reading again after scrolling has to add the hidden rows without
    /// duplicating the ones that were already visible.
    #[test]
    fn scrolling_and_reading_again_builds_one_order() {
        let first = parse(&levski_setup());
        assert_eq!(first.orders[0].materials.len(), 5);

        // The player scrolls: the first two rows have gone off the top, and two
        // rows that were below the fold are now visible.
        let mut scrolled: Vec<OcrLine> = levski_setup()
            .into_iter()
            .filter(|l| !(l.y > 460 && l.y < 500)) // the iron and corundum rows
            .collect();
        // Scrolling moves later rows up into the space the first two left.
        scrolled.push(line("TITANIUM ORE", 730, 465, 66, 7));
        scrolled.push(line("412", 816, 466, 9, 4));
        scrolled.push(line("880", 846, 465, 12, 5));
        scrolled.push(line("QUANTAINIUM ORE", 730, 491, 78, 7));
        scrolled.push(line("905", 817, 492, 9, 4));
        scrolled.push(line("120", 847, 491, 12, 5));

        let merged = merge(&first, parse(&scrolled));
        assert_eq!(merged.captures, 2);

        let names: Vec<&str> = merged.orders[0].materials.iter().map(|m| m.resource.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "Iron (Ore)",
                "Corundum Ore",
                "Inert Materials",
                "Aluminum Ore",
                "Aluminum Ore",
                "Titanium Ore",
                "Quantainium Ore",
            ],
            "rows seen twice are kept once, new rows are appended",
        );

        // Two aluminium rows at different qualities stay two rows.
        let aluminium: Vec<Option<f64>> = merged.orders[0]
            .materials
            .iter()
            .filter(|m| m.resource == "Aluminum Ore")
            .map(|m| m.quality)
            .collect();
        assert_eq!(aluminium, vec![Some(318.0), Some(783.0)]);

        // Totals that scrolled out of shot are kept from the earlier capture.
        assert_eq!(merged.orders[0].cost, Some(281.00));
        assert_eq!(merged.orders[0].method.as_deref(), Some("Pyrometric Chromalysis"));
    }

    /// The station's specialisation list scrolls like the material list, so it
    /// is built up across captures too.
    #[test]
    fn specialisations_are_gathered_across_captures() {
        let mut first_lines = levski_setup();
        first_lines.extend(levski_station_panel());
        let first = parse(&first_lines);
        let seen_first: Vec<&str> = first.specializations.iter().map(|s| s.material.as_str()).collect();
        assert!(seen_first.contains(&"Iron (Ore)"));

        // Scrolled: the first two specialisations have gone, two more arrived,
        // and iron's bonus is legible this time.
        let mut scrolled = levski_setup();
        scrolled.extend(levski_station_panel().into_iter().filter(|l| !(l.y > 330 && l.y < 360)));
        scrolled.push(line("Aluminum Ore", 353, 414, 38, 5));
        scrolled.push(line("6%", 478, 413, 8, 3));

        let merged = merge(&first, parse(&scrolled));
        let names: Vec<&str> = merged.specializations.iter().map(|s| s.material.as_str()).collect();
        assert!(names.contains(&"Iron (Ore)"), "kept from the first capture: {names:?}");
        assert!(names.contains(&"Aluminum Ore"), "added by the second: {names:?}");
        assert_eq!(names.iter().filter(|n| **n == "Iron (Ore)").count(), 1, "seen twice, kept once");
    }

    /// The panel counts in centi-SCU and says so in its heading. Reading the
    /// numbers as SCU would overstate every haul a hundredfold.
    #[test]
    fn amounts_carry_the_unit_the_panel_counts_in() {
        let processing = parse(&levski_processing());
        assert_eq!(processing.orders[0].unit, "cSCU", "the heading says MATERIALS YIELDED (CSCU)");

        // A setup panel's heading omits it; centi-SCU is the terminal's unit.
        let setup = parse(&levski_setup());
        assert_eq!(setup.orders[0].unit, "cSCU");

        // 115.31 cSCU is 1.1531 SCU; the amount is stored as the panel wrote
        // it, with the unit beside it, and converted only where it is used.
        let total = processing.orders[0].yield_total.unwrap();
        assert!((total * 0.01 - 1.1531).abs() < 1e-9, "{total} cSCU in SCU");
    }

    #[test]
    fn a_different_terminal_replaces_rather_than_merges() {
        let setup = parse(&levski_setup());
        // Two completed orders is a different set of panels; merging their rows
        // into the setup order would invent an order that never existed.
        let merged = merge(&setup, parse(&levski_completed_pair()));
        assert_eq!(merged.orders.len(), 2);
        assert_eq!(merged.captures, 0, "a replacement is not a second capture");
        assert_eq!(merged.orders[0].state, OrderState::Completed);
    }

    #[test]
    fn missing_fields_are_reported_rather_than_guessed() {
        let terminal = parse(&[line("some unrelated text on the panel", 0, 0, 100, 8)]);
        assert!(terminal.missing.contains(&"station".to_string()));
        assert!(terminal.missing.contains(&"orders".to_string()));
    }

    #[test]
    fn iso_timestamps_convert() {
        assert_eq!(millis_to_iso8601(1_788_307_200_000.0), "2026-09-02T00:00:00Z");
        assert_eq!(millis_to_iso8601(1_788_350_096_000.0), "2026-09-02T11:54:56Z");
    }
}

#[cfg(test)]
mod corpus {
    use super::*;
    use crate::scan::Captured;

    /// Read a labelled dataset of real terminal captures and print what the
    /// parser made of each. Needs the OCR models and a dataset, so it is
    /// opt-in:
    ///
    ///   REFINERY_CORPUS=<dir> cargo test --release --lib refinery::corpus -- --ignored --nocapture
    ///
    /// The directory is a StarBuddy scan-dataset export: labels.jsonl beside
    /// an images/ folder.
    #[test]
    #[ignore]
    fn corpus_reads() {
        let Ok(root) = std::env::var("REFINERY_CORPUS") else { return };
        let root = std::path::Path::new(&root);
        let models = dirs::data_dir().unwrap().join("io.github.ulrichdahl.starbuddy").join("ocr");
        let engine = crate::scan::engine_from_dir(&models).expect("OCR models present");

        for line in std::fs::read_to_string(root.join("labels.jsonl")).unwrap().lines() {
            let label: serde_json::Value = serde_json::from_str(line).unwrap();
            let name = label["image"].as_str().unwrap();
            let img = image::open(root.join("images").join(name)).unwrap().into_rgb8();
            let (w, h) = (img.width() as f64, img.height() as f64);

            // The quad's bounding box is what a player framing the panel would
            // have drawn, which is what the reader is given at runtime.
            let quad = label["quad"].as_array().unwrap();
            let xs: Vec<f64> = quad.iter().map(|p| p[0].as_f64().unwrap()).collect();
            let ys: Vec<f64> = quad.iter().map(|p| p[1].as_f64().unwrap()).collect();
            let (x0, x1) = (xs.iter().cloned().fold(f64::MAX, f64::min), xs.iter().cloned().fold(0.0, f64::max));
            let (y0, y1) = (ys.iter().cloned().fold(f64::MAX, f64::min), ys.iter().cloned().fold(0.0, f64::max));
            let crop = image::imageops::crop_imm(
                &img,
                (x0 * w) as u32,
                (y0 * h) as u32,
                ((x1 - x0) * w) as u32,
                ((y1 - y0) * h) as u32,
            )
            .to_image();

            let cap = Captured {
                rgb: crop.as_raw().clone(),
                width: crop.width(),
                height: crop.height(),
                source: name.into(),
                full_height: crop.height(),
            };
            let lines = read_in_bands(&engine, &cap).unwrap();
            let order = parse(&lines);
            println!("\n=== {name}  {}×{} ===", cap.width, cap.height);
            println!("station {:?}  ship {:?}  capacity {:?}", order.station, order.ship, order.capacity_percent);
            println!("missing {:?}  lines {}", order.missing, lines.len());
            for (i, o) in order.orders.iter().enumerate() {
                println!(
                    "  order {i}: {:?} #{:?} method {:?} cost {:?} dur {:?} yield {:?} in_manifest {:?} to_refine {:?}",
                    o.state, o.number, o.method, o.cost, o.duration_seconds, o.yield_total, o.in_manifest, o.to_refine
                );
                for m in &o.materials {
                    println!("      {:<22} q {:>7?} qty {:>9?} yield {:>9?} refine {}", m.resource, m.quality, m.qty, m.yield_amount, m.refine);
                }
            }
            for s in &order.specializations {
                println!("  spec {:<22} {:?}", s.material, s.bonus_percent);
            }
            if std::env::var("REFINERY_CORPUS_LINES").is_ok() {
                for l in &lines {
                    println!("    [{:>4},{:>4} {:>4}x{:>3}] {}", l.x, l.y, l.w, l.h, l.text);
                }
            }
        }
    }
}
