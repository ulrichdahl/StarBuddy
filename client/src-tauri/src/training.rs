//! Send the game window to the server as a training capture.
//!
//! One hotkey, no dialog: the frame goes up unlabelled and waits in the
//! player's own queue on the training page, where the corners get marked later
//! at a desk rather than mid-flight. Nothing is uploaded unless the key is
//! pressed.

use tauri::{AppHandle, Emitter};

/// PNG, because the panels are flat-shaded UI: JPEG's ringing around thin HUD
/// glyphs is exactly the detail the model is being trained to find.
fn encode_png(cap: &crate::scan::Captured) -> Result<Vec<u8>, String> {
    use image::ImageEncoder;
    if cap.rgb.len() != cap.width as usize * cap.height as usize * 3 {
        return Err("capture did not fit its own dimensions".into());
    }
    // Straight from the capture's bytes, without a copy of them to wrap.
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(&cap.rgb, cap.width, cap.height, image::ExtendedColorType::Rgb8)
        .map_err(|e| format!("could not encode the capture: {e}"))?;
    Ok(out)
}

fn status(app: &AppHandle, phase: &str, detail: impl Into<String>) {
    let _ = app.emit("training-capture", serde_json::json!({ "phase": phase, "detail": detail.into() }));
}

/// Hotkey entry point: grab the game window and send it, reporting progress
/// through the `training-capture` event so the UI can show what happened.
///
/// For a player who is not a tester the key does nothing: the server would
/// refuse the frame, and the settings do not show the key at all.
pub fn trigger(app: &AppHandle) {
    if !crate::tester::is_tester() {
        log::debug!("training hotkey ignored: not a tester");
        return;
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        match send(app2.clone()).await {
            Ok(message) => status(&app2, "sent", message),
            Err(e) => {
                log::warn!("training capture failed: {e}");
                status(&app2, "error", e);
            }
        }
    });
}

/// Capture the game window and post it. Returns a line worth showing.
pub async fn send(app: AppHandle) -> Result<String, String> {
    // Checked before the grab so an unpaired client says so without taking a
    // screenshot it has nowhere to send.
    crate::load_settings(&app).ok_or("Not paired with a server yet.")?;
    if !crate::reading::state(&app).on {
        return Err("Screen reading is off. Switch it on in StarBuddy and choose the game's window.".into());
    }
    status(&app, "capturing", "grabbing the game window");

    let for_capture = app.clone();
    let png = tauri::async_runtime::spawn_blocking(move || {
        let cap = crate::capture::full_rgb(&for_capture)?;
        let bytes = encode_png(&cap)?;
        Ok::<_, String>((bytes, cap.width, cap.height))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (bytes, width, height) = png;

    status(&app, "uploading", format!("sending {width}×{height}"));
    upload(&app, bytes, None, None, None).await?;
    Ok(format!("Sent {width}×{height} — label it on the training page."))
}

/// Post one frame to the capture queue.
///
/// `screen` names the panel when the caller already knows it — a reader that
/// went looking for a refinery terminal does — which is the difference between
/// a queue of frames and one you can search when a single kind of panel starts
/// reading badly. `note` carries what the reader made of it, so a capture that
/// was fine but parsed badly can be told from one that was never readable.
pub async fn upload(
    app: &AppHandle,
    bytes: Vec<u8>,
    screen: Option<&str>,
    note: Option<String>,
    reader: Option<String>,
) -> Result<(), String> {
    let settings = crate::load_settings(app).ok_or("Not paired with a server yet.")?;
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("capture.png")
        .mime_str("image/png")
        .map_err(|e| e.to_string())?;
    let mut form = reqwest::multipart::Form::new().part("image", part);
    if let Some(screen) = screen {
        form = form.text("screen", screen.to_string());
    }
    if let Some(note) = note {
        form = form.text("note", note);
    }
    // What the reader made of this frame, for a capture a reader took. The
    // server keeps it beside the image and drops it if it will not parse, so a
    // dump is never worth failing an upload over.
    if let Some(reader) = reader {
        form = form.text("reader", reader);
    }

    // A screenshot upload outlasts the shared client's 30 s on a slow line.
    let resp = crate::http::client()
        .post(format!("{}/api/training/captures", settings.server_url))
        .bearer_auth(&settings.token)
        .header("Accept", "application/json")
        .multipart(form)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Could not reach server: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.json::<serde_json::Value>().await.unwrap_or_default();
        // Testers only, and this player is no longer one: hide the training
        // screens rather than show the refusal.
        if crate::tester::is_tester_only(status, &body) {
            crate::tester::set(app, false);
            return Err("Scan training is for testers only.".into());
        }
        let msg = body.get("message").and_then(|m| m.as_str()).unwrap_or_default();
        return Err(format!("Server said {status}: {msg}"));
    }
    Ok(())
}

/// Encode a capture as PNG for the queue. Public so a reader can send the very
/// crop it worked from, rather than a fresh grab of a screen that has moved on.
pub fn png_of(cap: &crate::scan::Captured) -> Result<Vec<u8>, String> {
    encode_png(cap)
}

#[tauri::command]
pub async fn training_capture(app: AppHandle) -> Result<String, String> {
    send(app).await
}

/// Whether F8 refinery reads are shared for training (off by default).
#[tauri::command]
pub fn training_sharing_get(app: AppHandle) -> bool {
    crate::load_client_prefs(&app).share_reads_for_training
}

#[tauri::command]
pub fn training_sharing_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut prefs = crate::load_client_prefs(&app);
    prefs.share_reads_for_training = enabled;
    crate::save_client_prefs(&app, &prefs)
}
