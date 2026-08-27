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
        let m = matches(&t, 3610.0);
        assert_eq!(m[0].name, "Bexalite");
        assert!(!m[0].exact);
        assert_eq!(m[0].delta, 10);
        assert!(matches(&t, 1000.0).is_empty());
    }
}
