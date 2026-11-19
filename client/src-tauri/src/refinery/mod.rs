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
use crate::lock::LockExt;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

mod parse;
use parse::{merge, parse, station_in};

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
    /// Where the read has got to, kept as well as emitted: the hotkey opens
    /// the window and starts the read together, so the first phases are sent
    /// before there is anything listening. The window asks for this on the way
    /// up rather than showing "press the key" over a read already running.
    phase: Mutex<Phase>,
}

#[derive(Serialize, Clone, Default)]
pub struct Phase {
    pub phase: String,
    pub detail: String,
}

fn status(app: &AppHandle, phase: &str, detail: impl Into<String>) {
    let now = Phase { phase: phase.to_string(), detail: detail.into() };
    if let Some(state) = app.try_state::<RefineryState>() {
        *state.phase.lock_or_recover() = now.clone();
    }
    crate::overlay::emit_to_overlay(app, REFINERY, "refinery-status", now);
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
    // Pressing the key again while a read is running is someone asking whether
    // it is working, not asking for another read. Say where it has got to.
    if *app.state::<RefineryState>().busy.lock_or_recover() {
        let now = app.state::<RefineryState>().phase.lock_or_recover().clone();
        crate::overlay::emit_to_overlay(app, REFINERY, "refinery-status", now);
        return;
    }
    // Said before the read is even spawned, so the window that is opening at
    // this moment has something to show the instant it can show anything.
    status(app, "capturing", "");
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
    // The live scan may be running beside this. It used to have to be stopped
    // first, when both readers drove every core they could get; now they take
    // turns in the analysis pool, on a fixed share of the machine.
    if !crate::reading::state(&app).on {
        return Err("Screen reading is off. Switch it on in StarBuddy and choose the game's window.".into());
    }
    {
        let state = app.state::<RefineryState>();
        let mut busy = state.busy.lock_or_recover();
        if *busy {
            return Err("a read is already running".into());
        }
        *busy = true;
    }
    let mut result = read_inner(&app).await;
    if let Ok(fresh) = result {
        let previous = app.state::<RefineryState>().last.lock_or_recover().clone();
        result = Ok(match previous {
            Some(previous) if merge_with_last => merge(&previous, fresh),
            _ => RefineryTerminal { captures: 1, ..fresh },
        });
    }
    *app.state::<RefineryState>().busy.lock_or_recover() = false;

    match &result {
        Ok(order) => {
            *app.state::<RefineryState>().last.lock_or_recover() = Some(order.clone());
            crate::overlay::emit_to_overlay(&app, REFINERY, "refinery-order", order.clone());
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
    scan::ensure_models(app).await?;
    let region = current_region(app);
    status(app, "capturing", "grabbing the panel");
    crate::analysis::run_once(app, Panel, region.unwrap_or(ScanRegion::WHOLE))
        .await?
        .ok_or_else(|| "nothing was read".to_string())
}

/// The refinery terminal's analyzer: the framed panel read in bands, parsed
/// into work orders.
struct Panel;

impl crate::analysis::Analyzer for Panel {
    type Output = RefineryTerminal;

    fn kind(&self) -> crate::analysis::AnalyzerKind {
        crate::analysis::AnalyzerKind::RefineryPanel
    }

    fn event(&self) -> &'static str {
        "refinery-order"
    }

    fn cut(&self, frame: &crate::capture::Frame, region: ScanRegion) -> Result<crate::analysis::Cut, String> {
        let mut cut = crate::analysis::Cut::new(frame.crop_rgb(region)?);
        // The station's name is printed across the top of the terminal, and a
        // framed area is usually one panel of it — so the name is off the crop
        // and the order lands with nowhere to file it. The top of the window
        // is a strip: cheap to read, and the only place the name can be. Cut
        // now, from the same frame, and read only if the panel lacks it.
        if region != ScanRegion::WHOLE {
            cut.extra = Some(frame.rows_rgb(0, frame.height / 6)?);
        }
        Ok(cut)
    }

    fn read(&self, cut: crate::analysis::Cut, cx: &crate::analysis::Ctx) -> Result<Option<RefineryTerminal>, String> {
        let app = cx.app;
        let cap = &cut.crop;
        let text = cx.ocr.engine(crate::analysis::Charset::Text);
        status(app, "ocr", "reading the panel");
        let lines = read_bands_with(text, cap, &|band, of| status(app, "ocr", format!("{band}/{of}")))?;

        let mut order = parse(&lines);
        if order.station.is_none() {
            if let Some(strip) = cut.extra.as_ref() {
                match cx.ocr.lines(strip, crate::analysis::Charset::Text) {
                    Ok(lines) => order.station = station_in(&lines.iter().collect::<Vec<_>>()),
                    Err(e) => log::debug!("station strip unread: {e}"),
                }
                if order.station.is_some() {
                    order.missing.retain(|field| field != "station");
                }
            }
        }
        snap_qualities(app, &mut order);
        order.lines = lines;
        order.captured_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        order.elapsed_ms = cut.taken.elapsed().as_millis() as u64;
        log::info!(
            "refinery read: {}×{} in {} ms, {} lines, {} order(s)",
            cap.width,
            cap.height,
            order.elapsed_ms,
            order.lines.len(),
            order.orders.len(),
        );
        send_for_training(app, cut.crop, &order);
        Ok(Some(order))
    }
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

/// Send the crop the reader worked from to the training queue, when the
/// player has opted in.
///
/// The point is the reads that go wrong: the frame plus what the parser made of
/// it says whether the capture was unreadable or the parse was at fault, which
/// is not a distinction anyone can make from the window alone. The server drops
/// a frame it has already been sent, so pressing the hotkey twice costs nothing.
///
/// Off unless the player switched it on: every F8 read would otherwise send a
/// picture of their screen without asking. The PNG encode and the upload run on
/// their own task, so the read is handed back without waiting for either.
fn send_for_training(app: &AppHandle, cap: Captured, order: &RefineryTerminal) {
    if !crate::load_client_prefs(app).share_reads_for_training {
        return;
    }
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
    let order = order.clone();

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let encoded = tauri::async_runtime::spawn_blocking(move || {
            let png = crate::training::png_of(&cap)?;
            Ok::<_, String>((png, serde_json::to_string(&order).ok()))
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
        let sent = match encoded {
            Ok((png, reader)) => crate::training::upload(&app, png, Some("refinery_order"), Some(note), reader).await,
            Err(e) => Err(e),
        };
        if let Err(e) = sent {
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
///
/// `progress` is told which band is being read: a tall panel is otherwise
/// seconds of nothing, and on a slow machine rather more than that.
fn read_bands_with(
    engine: &ocrs::OcrEngine,
    cap: &Captured,
    progress: &dyn Fn(usize, usize),
) -> Result<Vec<OcrLine>, String> {
    const TARGET_BAND: u32 = 420;
    const OVERLAP: u32 = 60;

    if cap.height <= TARGET_BAND {
        return scan::run_ocr(engine, cap);
    }

    let step = TARGET_BAND - OVERLAP;
    let bands = (cap.height.div_ceil(step)).max(1) as usize;
    let mut band_number = 0usize;
    let mut merged: Vec<OcrLine> = Vec::new();
    let mut top = 0u32;
    while top < cap.height {
        band_number += 1;
        progress(band_number, bands);
        let height = TARGET_BAND.min(cap.height - top);
        let band = crop_rows(cap, top, height);
        let started = std::time::Instant::now();
        let mut lines = scan::run_ocr(engine, &band)?;
        log::debug!(
            "refinery band {}×{} at y {top}: {} lines in {} ms",
            band.width,
            band.height,
            lines.len(),
            started.elapsed().as_millis(),
        );
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
        origin: (cap.origin.0, cap.origin.1 + top),
    }
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
    *app.state::<RefineryState>().last.lock_or_recover() = None;
}

/// Where a read has got to, for a window that has only just opened.
#[tauri::command]
pub fn refinery_status(app: AppHandle) -> Phase {
    app.state::<RefineryState>().phase.lock_or_recover().clone()
}

#[tauri::command]
pub fn refinery_last(app: AppHandle) -> Option<RefineryTerminal> {
    app.state::<RefineryState>().last.lock_or_recover().clone()
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
) -> Result<serde_json::Value, SaveRejected> {
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

    let resp = crate::http::client()
        .post(format!("{}/api/refinery-orders", settings.server_url))
        .bearer_auth(&settings.token)
        .header("Accept", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Could not reach server: {e}"))?;

    if !resp.status().is_success() {
        let (message, fields) = crate::error_fields(resp).await;
        return Err(SaveRejected { message, fields });
    }
    resp.json().await.map_err(|e| SaveRejected::from(e.to_string()))
}

/// Why an order could not be saved, and which of its fields were the reason.
///
/// A rejection used to arrive as one sentence about a row the player then had
/// to find. The server names what it refused — "materials.2.quality" — so the
/// window can mark the row and the cell instead.
#[derive(Serialize)]
pub struct SaveRejected {
    pub message: String,
    pub fields: std::collections::BTreeMap<String, String>,
}

impl From<String> for SaveRejected {
    fn from(message: String) -> Self {
        Self { message, fields: Default::default() }
    }
}

impl From<&str> for SaveRejected {
    fn from(message: &str) -> Self {
        Self::from(message.to_string())
    }
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
                origin: (0, 0),
            };
            let lines = read_bands_with(&engine, &cap, &|_, _| {}).unwrap();
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
