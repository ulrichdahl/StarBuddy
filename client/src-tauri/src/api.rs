//! The paired website's API, for the main window's sections that are the
//! website's pages in small: refinery orders, items, blueprints, craft.
//!
//! The page cannot call the server itself: the content security policy keeps
//! it to the app, and the device token lives here, not in the page. So the
//! page names a path under /api/ and this sends it with the token. Nothing
//! outside /api/ on the paired server can be reached through it.

use serde_json::Value;

use crate::{error_body, load_settings};

/// A path the page may ask for: under /api/, no way out of it.
fn checked_path(path: &str) -> Result<&str, String> {
    let ok = path.starts_with("/api/")
        && !path.contains("..")
        && !path.contains("//")
        && !path.contains('\\')
        && !path.contains('#')
        && path.chars().all(|c| !c.is_control() && !c.is_whitespace());
    if ok {
        Ok(path)
    } else {
        Err(format!("not an API path: {path}"))
    }
}

/// Call the paired server's API: `GET /api/refinery-orders?open=1` and the like.
///
/// `query` is sent as query parameters and `body` as JSON. A 204 or an empty
/// answer comes back as null.
#[tauri::command]
pub async fn server_api(
    app: tauri::AppHandle,
    method: String,
    path: String,
    query: Option<Vec<(String, String)>>,
    body: Option<Value>,
) -> Result<Value, String> {
    let settings = load_settings(&app).filter(|s| !s.token.is_empty()).ok_or("Not paired with a server yet.")?;
    let path = checked_path(&path)?;
    let method = match method.to_ascii_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        other => return Err(format!("method {other} is not used")),
    };
    let mut url = reqwest::Url::parse(&format!("{}{}", settings.server_url.trim_end_matches('/'), path))
        .map_err(|e| format!("not an API path: {e}"))?;
    if let Some(query) = query.filter(|q| !q.is_empty()) {
        url.query_pairs_mut().extend_pairs(query);
    }
    let mut request = crate::http::client()
        .request(method, url)
        .bearer_auth(&settings.token)
        .header("Accept", "application/json");
    if let Some(body) = body {
        request = request.json(&body);
    }
    let resp = request.send().await.map_err(|e| format!("Could not reach server: {e}"))?;
    if !resp.status().is_success() {
        return Err(error_body(resp).await);
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::checked_path;

    #[test]
    fn only_paths_under_api() {
        assert!(checked_path("/api/refinery-orders").is_ok());
        assert!(checked_path("/api/refinery-orders/12/collect").is_ok());
        assert!(checked_path("/api/tracked-pools/Foxwell%20Enforcement%3AAmbush").is_ok());
        assert!(checked_path("/admin").is_err());
        assert!(checked_path("api/me").is_err());
        assert!(checked_path("/api/../admin").is_err());
        assert!(checked_path("/api//evil.example/x").is_err());
        assert!(checked_path("/api/me#x").is_err());
        assert!(checked_path("/api/me x").is_err());
    }
}
