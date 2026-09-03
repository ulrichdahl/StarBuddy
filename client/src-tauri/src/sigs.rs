//! Scan-signature reference: what a radar signature means.
//!
//! Since Alpha 4.7 every ship-mineable mineral has a fixed base signature
//! and the scanner shows the sum over the pinged cluster (18,000 = 5 ×
//! Bexalite 3,600). Ground deposits encode only their size (3,000 hand,
//! 4,000 ROC). The table is the repo's backend/database/data/scan-signatures.json,
//! bundled at build time so lookups work offline; when paired, the server's
//! copy (which adds rarity and quality bands) is fetched and cached.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const BUNDLED: &str = include_str!("../../../backend/database/data/scan-signatures.json");
/// Rocks per cluster we still consider (larger sums are noise).
const MAX_COUNT: u32 = 12;
/// OCR tolerance for approximate matches, as a fraction of the value.
const TOLERANCE: f64 = 0.01;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Companion {
    pub name: String,
    pub share: [f64; 2],
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SigOre {
    pub name: String,
    pub signature: u32,
    #[serde(default)]
    pub instability: Option<f64>,
    #[serde(default)]
    pub resistance: Option<f64>,
    #[serde(default)]
    pub dominant: Option<[f64; 2]>,
    #[serde(default)]
    pub companions: Vec<Companion>,
    // Server-side enrichment; absent in the bundled file.
    #[serde(default)]
    pub rarity: Option<String>,
    #[serde(default)]
    pub qualities: Vec<u32>,
    #[serde(default)]
    pub resource_type_id: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SigTable {
    #[serde(default, alias = "_meta")]
    pub meta: serde_json::Value,
    #[serde(default)]
    pub ground: BTreeMap<String, u32>,
    #[serde(default)]
    pub ores: Vec<SigOre>,
}

/// One ledger row: a mineral's band in the rock (the dominant mineral,
/// then its companions), with what the table knows about that mineral.
#[derive(Serialize, Clone, Debug)]
pub struct SigRow {
    pub name: String,
    pub dominant: bool,
    pub share: Option<[f64; 2]>,
    pub rarity: Option<String>,
    pub resistance: Option<f64>,
    pub instability: Option<f64>,
    pub qualities: Vec<u32>,
}

#[derive(Serialize, Clone, Debug)]
pub struct SigMatch {
    pub name: String,
    /// "ship" for a mineral, otherwise the ground deposit kind ("fps", "roc").
    pub kind: String,
    /// Rocks/deposits in the cluster that produce this signature.
    pub count: u32,
    pub signature: u32,
    pub exact: bool,
    pub delta: i64,
    pub ore: Option<SigOre>,
    /// Composition ledger: dominant mineral first, then companions.
    pub rows: Vec<SigRow>,
}

fn rows_for(table: &SigTable, ore: &SigOre) -> Vec<SigRow> {
    let mut rows = vec![SigRow {
        name: ore.name.clone(),
        dominant: true,
        share: ore.dominant,
        rarity: ore.rarity.clone(),
        resistance: ore.resistance,
        instability: ore.instability,
        qualities: ore.qualities.clone(),
    }];
    for c in &ore.companions {
        let known = table.ores.iter().find(|o| o.name.eq_ignore_ascii_case(&c.name));
        rows.push(SigRow {
            name: c.name.clone(),
            dominant: false,
            share: Some(c.share),
            rarity: known.and_then(|o| o.rarity.clone()),
            resistance: known.and_then(|o| o.resistance),
            instability: known.and_then(|o| o.instability),
            qualities: known.map(|o| o.qualities.clone()).unwrap_or_default(),
        });
    }
    rows
}

static TABLE: Mutex<Option<SigTable>> = Mutex::new(None);

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("scan-signatures.json"))
}

pub fn bundled() -> SigTable {
    serde_json::from_str(BUNDLED).expect("bundled scan-signatures.json is valid")
}

/// The current table: in memory, else the cached server copy, else bundled.
pub fn table(app: &AppHandle) -> SigTable {
    let mut guard = TABLE.lock().unwrap();
    if let Some(t) = guard.as_ref() {
        return t.clone();
    }
    let cached = cache_path(app)
        .and_then(|p| fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<SigTable>(&b).ok())
        .filter(|t| !t.ores.is_empty());
    let t = cached.unwrap_or_else(bundled);
    *guard = Some(t.clone());
    t
}

/// Candidate readings for a signature: exact multiples (fewest rocks
/// first); only when nothing is exact, near misses within TOLERANCE — the
/// OCR occasionally slips a digit. Base signatures sit as close as 15
/// apart, so approximate matches never compete with an exact one.
pub fn matches(table: &SigTable, value: f64) -> Vec<SigMatch> {
    if value <= 0.0 {
        return Vec::new();
    }
    let mut candidates: Vec<(String, String, u32, Option<&SigOre>)> = table
        .ores
        .iter()
        .map(|o| (o.name.clone(), "ship".to_string(), o.signature, Some(o)))
        .collect();
    for (kind, base) in &table.ground {
        candidates.push((kind.clone(), kind.clone(), *base, None));
    }

    let mut out = Vec::new();
    for (name, kind, base, ore) in candidates {
        if base == 0 {
            continue;
        }
        let count = (value / base as f64).round() as i64;
        if count < 1 || count > MAX_COUNT as i64 {
            continue;
        }
        let delta = (value - (count as f64) * base as f64).round() as i64;
        if (delta.abs() as f64) > value * TOLERANCE {
            continue;
        }
        out.push(SigMatch {
            name,
            kind,
            count: count as u32,
            signature: base,
            exact: delta == 0,
            delta,
            rows: ore.map(|o| rows_for(table, o)).unwrap_or_default(),
            ore: ore.cloned(),
        });
    }
    if out.iter().any(|m| m.exact) {
        out.retain(|m| m.exact);
    }
    out.sort_by_key(|m| (m.count, m.delta.abs()));
    out
}

pub fn lookup(app: &AppHandle, value: f64) -> Vec<SigMatch> {
    matches(&table(app), value)
}

/// Fetch the server's table (needs a paired device) and cache it.
pub async fn refresh(app: AppHandle) -> Result<usize, String> {
    let settings = crate::load_settings(&app).filter(|s| !s.token.is_empty()).ok_or("not paired")?;
    let resp = reqwest::Client::new()
        .get(format!("{}/api/scan/signatures", settings.server_url.trim_end_matches('/')))
        .bearer_auth(&settings.token)
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("server said {}", resp.status()));
    }
    let t: SigTable = resp.json().await.map_err(|e| e.to_string())?;
    if t.ores.is_empty() {
        return Err("server table is empty".into());
    }
    if let Some(p) = cache_path(&app) {
        if let Some(dir) = p.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(bytes) = serde_json::to_vec_pretty(&t) {
            let _ = fs::write(&p, bytes);
        }
    }
    let n = t.ores.len();
    *TABLE.lock().unwrap() = Some(t);
    Ok(n)
}

/// Fire-and-forget refresh; failures only reach the log (the bundled
/// table keeps lookups working).
pub fn refresh_in_background(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match refresh(app).await {
            Ok(n) => log::info!("scan signatures: {n} minerals from server"),
            Err(e) => log::debug!("scan signatures: using local table ({e})"),
        }
    });
}

#[tauri::command]
pub fn scan_lookup(app: AppHandle, value: f64) -> Vec<SigMatch> {
    lookup(&app, value)
}

#[tauri::command]
pub async fn scan_signatures_refresh(app: AppHandle) -> Result<usize, String> {
    refresh(app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_rock_is_its_mineral() {
        let t = bundled();
        let m = matches(&t, 3400.0);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].name, "Lindinium");
        assert_eq!(m[0].count, 1);
        assert!(m[0].exact);
        assert_eq!(m[0].ore.as_ref().unwrap().resistance, Some(0.95));
        // Ledger: Lindinium first, then its Tungsten companion with Tungsten's own stats.
        assert_eq!(m[0].rows.len(), 2);
        assert!(m[0].rows[0].dominant);
        assert_eq!(m[0].rows[1].name, "Tungsten");
        assert_eq!(m[0].rows[1].share, Some([10.0, 20.0]));
        assert_eq!(m[0].rows[1].resistance, Some(-0.4));
    }

    #[test]
    fn cluster_sum_is_a_multiple() {
        let t = bundled();
        let m = matches(&t, 18000.0);
        let bex = m.iter().find(|m| m.name == "Bexalite").expect("Bexalite × 5");
        assert_eq!(bex.count, 5);
        assert!(m.iter().all(|m| m.exact));
    }

    #[test]
    fn ground_and_approximate() {
        let t = bundled();
        assert_eq!(matches(&t, 4000.0)[0].kind, "roc");
        // Debris pieces are 2,000 each; 4,000 is also two of them.
        assert!(matches(&t, 4000.0).iter().any(|m| m.kind == "debris" && m.count == 2));
        assert_eq!(matches(&t, 6000.0).iter().find(|m| m.kind == "debris").unwrap().count, 3);
        let m = matches(&t, 3610.0);
        assert_eq!(m[0].name, "Bexalite");
        assert!(!m[0].exact);
        assert_eq!(m[0].delta, 10);
        assert!(matches(&t, 1000.0).is_empty());
    }
}

/// The quality ladder the game gives a material, by any of its names.
///
/// A terminal prints the refined name ("GOLD") where the catalogue holds the
/// ore ("Gold (Ore)"), and a localisation mod can strip the suffix from either
/// side, so both are reduced to the bare word before they are compared — the
/// same reduction the server does when it matches a captured row.
pub fn bands_for(table: &SigTable, material: &str) -> Vec<u32> {
    let wanted = bare_name(material);
    if wanted.is_empty() {
        return Vec::new();
    }
    table
        .ores
        .iter()
        .find(|ore| bare_name(&ore.name) == wanted)
        .map(|ore| ore.qualities.clone())
        .unwrap_or_default()
}

/// A material name reduced to what it has in common across spellings: lower
/// case, letters and digits only, without the "ore" or "raw" that names the
/// form it was found in.
fn bare_name(name: &str) -> String {
    let words: Vec<String> = name
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect();
    let bare: String = words.iter().filter(|w| *w != "ore" && *w != "raw" && *w != "r").cloned().collect();
    // A material genuinely called "Ore" would reduce to nothing; keep it.
    if bare.is_empty() { words.concat() } else { bare }
}

/// The band an OCR'd quality was most likely meant to be.
///
/// Quality is the one column with a closed set of answers: every material has
/// exactly eight values it can print, straight out of the game's own tables. So
/// a reading that is not one of them is a misreading — and the terminal's font
/// says what kind. Its zeros carry a slash, which at panel scale reads as an 8
/// or a 6, so 264 comes back as 284 and 504 as 584.
///
/// The correction is therefore made on the digits, not on the distance: a
/// reading is put back only when it differs from a band in exactly one place,
/// and that one place is a pair this font actually confuses. A slipped digit
/// moves the value by twenty or eighty, so any window wide enough to catch it
/// would be wide enough to cross into the next band and invent a reading nobody
/// saw. Anything ambiguous — one digit from two different bands — is left as it
/// was read, because reporting a misreading is better than inventing a number.
pub fn snap_quality(bands: &[u32], read: f64) -> Option<f64> {
    if bands.is_empty() || read <= 0.0 || read.fract() != 0.0 {
        return None;
    }
    let read = (read as u32).to_string();
    let mut only: Option<u32> = None;
    for band in bands {
        let candidate = band.to_string();
        if candidate == read {
            return None; // already what the terminal printed
        }
        if !one_confusable_digit_apart(&read, &candidate) {
            continue;
        }
        if only.is_some() {
            return None; // two bands fit equally well; say nothing
        }
        only = Some(*band);
    }
    only.map(f64::from)
}

/// Whether two numbers of the same length differ in exactly one digit, and that
/// digit is a pair this terminal's font confuses.
fn one_confusable_digit_apart(read: &str, band: &str) -> bool {
    /// Pairs the panel font actually mixes up. Its slashed zero is the one that
    /// bites; the rest are the usual small-text neighbours.
    const CONFUSABLE: [(u8, u8); 6] = [(b'0', b'8'), (b'0', b'6'), (b'6', b'8'), (b'3', b'8'), (b'5', b'6'), (b'1', b'7')];

    if read.len() != band.len() {
        return false;
    }
    let mut differences = read.bytes().zip(band.bytes()).filter(|(a, b)| a != b);
    let Some((a, b)) = differences.next() else { return false };
    if differences.next().is_some() {
        return false;
    }
    CONFUSABLE.contains(&(a, b)) || CONFUSABLE.contains(&(b, a))
}

#[cfg(test)]
mod quality_tests {
    use super::*;

    /// Gold's ladder, as the game's quantization table gives it.
    const GOLD: [u32; 8] = [264, 553, 644, 786, 864, 916, 959, 1000];

    #[test]
    fn a_slashed_zero_is_put_back() {
        // The panel font slashes its zeros, so 264 comes back as 284 and a
        // corundum 504 as 584 — one digit out, both times.
        assert_eq!(snap_quality(&GOLD, 284.0), Some(264.0));
        let corundum = [309, 504, 665, 793, 886, 904, 971, 1000];
        assert_eq!(snap_quality(&corundum, 584.0), Some(504.0));
    }

    #[test]
    fn a_reading_that_is_already_a_band_is_left_alone() {
        assert_eq!(snap_quality(&GOLD, 264.0), None);
        assert_eq!(snap_quality(&GOLD, 1000.0), None);
    }

    #[test]
    fn a_reading_nowhere_near_the_ladder_is_reported_as_it_was_read() {
        // Two digits out, or a different length: more likely the row was
        // misaligned than that one digit slipped, and moving it would hide that.
        assert_eq!(snap_quality(&GOLD, 895.0), None);
        assert_eq!(snap_quality(&GOLD, 1808.0), None);
        // A single digit out, but not a pair this font confuses.
        assert_eq!(snap_quality(&GOLD, 274.0), None);
    }

    #[test]
    fn an_ambiguous_reading_is_left_alone() {
        // A read 8 is one confusable digit from both a 3 and a 6, so a ladder
        // carrying 386 and 686 cannot say which 886 was meant to be.
        assert_eq!(snap_quality(&[386, 686], 886.0), None);
    }

    #[test]
    fn the_ladder_is_found_by_any_of_the_material_names() {
        let table: SigTable = serde_json::from_str(
            r#"{"ores":[{"name":"Gold (Ore)","signature":3000,
                 "qualities":[264,553,644,786,864,916,959,1000]}]}"#,
        )
        .expect("fixture parses");
        // The terminal prints the refined name; the catalogue holds the ore.
        assert_eq!(bands_for(&table, "GOLD"), GOLD.to_vec());
        assert_eq!(bands_for(&table, "Gold (Raw)"), GOLD.to_vec());
        assert!(bands_for(&table, "Quantainium").is_empty());
    }
}
