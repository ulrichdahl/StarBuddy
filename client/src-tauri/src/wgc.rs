//! One window, streamed by Windows itself.
//!
//! The counterpart to the desktop portal on Linux, and the same idea:
//! Windows.Graphics.Capture streams a single window from the compositor, so
//! frames keep arriving while the window is behind something or not focused —
//! which reading a game's panel while an overlay has the mouse requires.
//!
//! It is switched on by the player like the portal is, and for the same
//! reason: a stream is a running thing, and the system shows it as one.

use crate::scan::Captured;
use std::sync::{Mutex, OnceLock};
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame;
use windows_capture::graphics_capture_api::{GraphicsCaptureApi, InternalCaptureControl};
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
use windows_capture::window::Window;

/// The running capture, if screen reading is on.
struct Running {
    control: windows_capture::capture::CaptureControl<Reader, String>,
}

fn running() -> &'static Mutex<Option<Running>> {
    static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(None))
}

/// Which switches this build of Windows answered to, once a capture has been
/// started: the cursor and the capture border, in that order.
fn switches() -> &'static Mutex<Option<(bool, bool)>> {
    static SWITCHES: OnceLock<Mutex<Option<(bool, bool)>>> = OnceLock::new();
    SWITCHES.get_or_init(|| Mutex::new(None))
}

/// Whether the window being read is wearing Windows' yellow capture border.
pub fn border_drawn() -> bool {
    matches!(*switches().lock().unwrap(), Some((_, false)))
}

/// What the switches said, for a report: (asked, answered) per switch.
pub fn switch_state() -> Option<(bool, bool)> {
    *switches().lock().unwrap()
}

/// What Windows answered when asked for borderless capture, in words.
fn borderless_answer() -> &'static Mutex<Option<String>> {
    static ANSWER: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    ANSWER.get_or_init(|| Mutex::new(None))
}

/// The same answer, for a report.
pub fn borderless() -> Option<String> {
    borderless_answer().lock().unwrap().clone()
}

/// Which Windows this is, from the kernel rather than from the compatibility
/// layer that lies to unmanifested programs: (major, minor, build).
///
/// The build number is the whole question about the capture border — the
/// switch that turns it off arrived in build 20348, and nothing before that
/// can be asked to stop drawing it.
pub fn version() -> Option<(u32, u32, u32)> {
    use windows::Wdk::System::SystemServices::RtlGetVersion;
    use windows::Win32::System::SystemInformation::OSVERSIONINFOW;

    let mut info = OSVERSIONINFOW { dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32, ..Default::default() };
    unsafe { RtlGetVersion(&mut info) }.is_ok().then_some((
        info.dwMajorVersion,
        info.dwMinorVersion,
        info.dwBuildNumber,
    ))
}

/// Receives frames and keeps the newest.
struct Reader;

impl GraphicsCaptureApiHandler for Reader {
    type Flags = ();
    type Error = String;

    fn new(_: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self)
    }

    fn on_frame_arrived(&mut self, frame: &mut Frame, _: InternalCaptureControl) -> Result<(), Self::Error> {
        let buffer = frame.buffer().map_err(|e| e.to_string())?;
        let (width, height) = (buffer.width(), buffer.height());
        // Rows come out padded to the texture's pitch; this is where they are
        // packed, into scratch we own for the length of the copy.
        let mut scratch = Vec::new();
        let pixels = buffer.as_nopadding_buffer(&mut scratch);
        // Asked for as Rgba8, so red comes first and the fourth byte is the
        // alpha the reader has no use for.
        let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
        for pixel in pixels.chunks_exact(4) {
            rgb.extend_from_slice(&[pixel[0], pixel[1], pixel[2]]);
        }
        crate::reading::set_frame(Captured {
            rgb,
            width,
            height,
            source: "window (Windows capture)".into(),
            full_height: height,
        });
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        crate::reading::set_stopped(Some("The window closed.".into()));
        Ok(())
    }
}

/// Every window worth offering, by title.
pub fn open_windows() -> Vec<String> {
    Window::enumerate()
        .map(|all| {
            all.into_iter()
                .filter(|w| w.is_valid())
                .filter_map(|w| w.title().ok())
                .filter(|title| !title.trim().is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Where Windows keeps its answer about this program, so a player who said no
/// once can find the decision and take it back.
///
/// The store is keyed by the executable's own path, which is why an app
/// installed twice — once per user, once for the machine — has an entry each,
/// and why editing "the StarBuddy one" is a coin toss unless the path is
/// spelled out.
pub fn borderless_consent_key() -> String {
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    format!(
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\graphicsCaptureWithoutBorder\\NonPackaged\\{}",
        exe.replace('\\', "#")
    )
}

/// What the machine has decided about capturing without a border, before the
/// client asks for anything.
///
/// A refusal the player made themselves is remembered per program and can be
/// taken back. A refusal made by policy cannot: Windows never asks, answers no
/// every time, and writes the answer down as though someone had chosen it —
/// which is what a hardened machine looks like from in here. The two are worth
/// telling apart, and only the registry tells them apart.
pub fn borderless_policy() -> Vec<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    const CONSENT: &str =
        r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\graphicsCaptureWithoutBorder";
    let mut found = Vec::new();

    let machine = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(privacy) = machine.open_subkey(r"SOFTWARE\Policies\Microsoft\Windows\AppPrivacy") {
        if let Ok(policy) = privacy.get_value::<u32, _>("LetAppsAccessGraphicsCaptureWithoutBorder") {
            found.push(format!(
                "policy LetAppsAccessGraphicsCaptureWithoutBorder = {policy} ({})",
                match policy {
                    0 => "the player decides",
                    1 => "always allowed",
                    2 => "always refused — this is what puts the border there",
                    _ => "unknown",
                }
            ));
        }
    }

    let user = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(store) = user.open_subkey(CONSENT) {
        if let Ok(value) = store.get_value::<String, _>("Value") {
            found.push(format!("consent for every program: {value}"));
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let path = format!(r"{CONSENT}\NonPackaged\{}", exe.to_string_lossy().replace('\\', "#"));
        match user.open_subkey(&path).and_then(|k| k.get_value::<String, _>("Value")) {
            Ok(value) => found.push(format!("consent for this client: {value}")),
            Err(_) => found.push("consent for this client: nothing written".into()),
        }
    }
    found
}

/// Ask Windows for permission to capture without its border.
///
/// The border is not a setting, it is a permission: `IsBorderRequired = false`
/// is ignored — silently, no error anywhere — until the program has asked for
/// borderless capture and been granted it. That is the whole reason a window
/// StarBuddy reads wears a yellow frame on a build whose switch reports itself
/// as present and working.
///
/// The answer is worth logging whatever it is: "not declared by app" says the
/// permission needs something this build cannot ask for, and only then is
/// there nothing left to try.
fn ask_for_borderless() -> String {
    use windows::Graphics::Capture::{GraphicsCaptureAccess, GraphicsCaptureAccessKind};
    use windows::Security::Authorization::AppCapabilityAccess::AppCapabilityAccessStatus;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    // The request is a WinRT call and needs an apartment on this thread. An
    // apartment already set is fine, and a different one is fine too — both
    // come back as an error that means "there is one".
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };

    // Waited for by hand: the trait that does the waiting is private in this
    // version of the bindings, and the permission is asked for once, at the
    // start of a capture, so a short poll costs nothing.
    let asked = GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless).and_then(|request| {
        for _ in 0..200 {
            if request.Status()? != windows_future::AsyncStatus::Started {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        request.GetResults()
    });
    match asked {
        Ok(status) => match status {
            AppCapabilityAccessStatus::Allowed => "allowed".into(),
            AppCapabilityAccessStatus::DeniedBySystem => "denied by the system".into(),
            // The one answer with a way back: the refusal is remembered per
            // program, and deleting it is what makes Windows ask again.
            AppCapabilityAccessStatus::DeniedByUser => "denied by the player".into(),
            AppCapabilityAccessStatus::NotDeclaredByApp => "not declared by the app".into(),
            AppCapabilityAccessStatus::UserPromptRequired => "the player has not been asked yet".into(),
            other => format!("unknown answer {}", other.0),
        },
        // Windows 10 has no such request to make, and says so by not having
        // the interface at all.
        Err(e) => format!("could not ask ({e})"),
    }
}

/// Start streaming the window with this title.
pub fn start(title: &str) -> Result<(), String> {
    stop();
    if !GraphicsCaptureApi::is_supported().unwrap_or(false) {
        return Err("This Windows can't stream a window. Windows 10 version 1903 or newer is needed.".into());
    }
    let window = Window::from_name(title)
        .map_err(|_| format!("The window \"{title}\" is not open — is the game running?"))?;

    // Windows 10 has the capture API but not every switch on it, and asking
    // for one it lacks fails the whole capture — not at this call but in the
    // capture's own thread, where it shows up as a stream that never sends a
    // frame. So each switch is asked for only where the build answers to it,
    // and the answers are logged: the yellow border Windows draws round a
    // captured window is switched off through one of them, and where the
    // switch is missing the border is the system's and cannot be removed.
    let cursor_switch = GraphicsCaptureApi::is_cursor_settings_supported().unwrap_or(false);
    let border_switch = GraphicsCaptureApi::is_border_settings_supported().unwrap_or(false);
    log::info!(
        "windows capture on {:?}: cursor switch {cursor_switch}, border switch {border_switch}",
        version()
    );
    *switches().lock().unwrap() = Some((cursor_switch, border_switch));
    let cursor =
        if cursor_switch { CursorCaptureSettings::WithoutCursor } else { CursorCaptureSettings::Default };
    let borderless = if border_switch { ask_for_borderless() } else { "no switch to ask about".into() };
    log::info!("borderless capture: {borderless}");
    *borderless_answer().lock().unwrap() = Some(borderless);
    let border = if border_switch { DrawBorderSettings::WithoutBorder } else { DrawBorderSettings::Default };

    let settings = Settings::new(
        window,
        cursor,
        border,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Default,
        DirtyRegionSettings::Default,
        ColorFormat::Rgba8,
        (),
    );

    let control = Reader::start_free_threaded(settings).map_err(|e| format!("Windows refused the capture: {e}"))?;
    log::info!("windows capture started on \"{title}\"");
    *running().lock().map_err(|_| "screen reading is in a bad state")? = Some(Running { control });
    Ok(())
}

/// Stop streaming. Safe to call when nothing is running.
pub fn stop() {
    let Ok(mut slot) = running().lock() else { return };
    if let Some(was) = slot.take() {
        let _ = was.control.stop();
    }
    crate::reading::set_stopped(None);
}

/// Whether a stream is set up at all, frames or not.
pub fn on() -> bool {
    running().lock().map(|r| r.is_some()).unwrap_or(false)
}
