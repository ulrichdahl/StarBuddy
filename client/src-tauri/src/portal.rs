//! One window, captured through the desktop portal.
//!
//! On Wayland a program cannot screenshot a window it does not own. KWin's own
//! screenshot service refuses anything that is not on its allowlist, and the
//! screenshot tools can only be aimed at whatever is in front — so a read
//! depended on the game being the focused window, which it stops being the
//! moment the player clicks an overlay to look at what was read.
//!
//! The portal is the way round it, and the way every screen-sharing program
//! does this: the desktop shows its own window picker, the player points at
//! the game once, and the compositor streams that window over PipeWire for as
//! long as the session lasts — focused or not, covered or not. The portal
//! hands back a token that restores the same choice next time without asking
//! again.
//!
//! What is kept here is only ever the newest frame. A reader takes a copy when
//! it wants one; nothing is queued, because a capture is a question about now.

use crate::scan::Captured;
use std::sync::{Mutex, OnceLock};

/// Ask the portal for a window, and keep its stream running.
///
/// `restore` is the token from a previous choice: with one the desktop
/// reattaches to the same window without showing its picker, and without one
/// the player is asked to point at the game. The token that comes back is
/// worth storing — it is what makes the asking a one-off.
pub async fn choose_window(restore: Option<String>) -> Result<Chosen, String> {
    use ashpd::desktop::screencast::{
        CursorMode, OpenPipeWireRemoteOptions, Screencast, SelectSourcesOptions, SourceType, StartCastOptions,
    };
    use ashpd::desktop::{CreateSessionOptions, PersistMode};

    let proxy = Screencast::new().await.map_err(|e| format!("no desktop portal: {e}"))?;
    let session = proxy
        .create_session(CreateSessionOptions::default())
        .await
        .map_err(|e| format!("portal session: {e}"))?;

    let sources = SelectSourcesOptions::default()
        .set_sources(ashpd::enumflags2::BitFlags::<SourceType>::from(SourceType::Window))
        .set_cursor_mode(CursorMode::Hidden)
        // One window, not a set of them: the reader has one panel to find.
        .set_multiple(false)
        // Remembered until the player revokes it, so the desktop asks which
        // window once rather than every time the client starts.
        .set_persist_mode(PersistMode::ExplicitlyRevoked)
        .set_restore_token(restore.as_deref());

    proxy
        .select_sources(&session, sources)
        .await
        .map_err(|e| format!("portal refused the request: {e}"))?
        .response()
        .map_err(|e| format!("no window was chosen: {e}"))?;

    let streams = proxy
        .start(&session, None, StartCastOptions::default())
        .await
        .map_err(|e| format!("portal start: {e}"))?
        .response()
        .map_err(|e| format!("no window was chosen: {e}"))?;

    let stream = streams.streams().first().ok_or("the portal returned no stream")?;
    let node = stream.pipe_wire_node_id();
    let fd = proxy
        .open_pipe_wire_remote(&session, OpenPipeWireRemoteOptions::default())
        .await
        .map_err(|e| format!("portal would not open the stream: {e}"))?;

    Ok(Chosen { node, fd, token: streams.restore_token().map(String::from), session })
}

/// A window the player pointed at, and the stream carrying it.
pub struct Chosen {
    pub node: u32,
    pub fd: std::os::fd::OwnedFd,
    /// Give this back next time to skip the picker.
    pub token: Option<String>,
    /// Held for as long as the stream is wanted: dropping it ends the stream.
    pub session: ashpd::desktop::Session<ashpd::desktop::screencast::Screencast>,
}

/// Run the stream until told to stop, keeping the newest frame.
///
/// PipeWire wants a loop of its own and will not share a thread, so the loop
/// gets one and speaks to the rest of the client only through the frame store.
/// The one message it takes is "stop".
fn run_stream(node: u32, fd: std::os::fd::OwnedFd, stop: pipewire::channel::Receiver<()>) -> Result<(), String> {
    use pipewire::spa::param::format::{FormatProperties, MediaSubtype, MediaType};
    use pipewire::spa::param::video::VideoFormat;
    use pipewire::spa::pod::Pod;
    use pipewire::spa::utils::Direction;
    use pipewire::{properties::properties, stream::StreamFlags};

    pipewire::init();
    let main_loop = pipewire::main_loop::MainLoopRc::new(None).map_err(|e| e.to_string())?;
    let context = pipewire::context::ContextRc::new(&main_loop, None).map_err(|e| e.to_string())?;
    let core = context.connect_fd_rc(fd, None).map_err(|e| format!("PipeWire refused the stream: {e}"))?;

    let stream = pipewire::stream::StreamRc::new(
        core,
        "starbuddy-window",
        properties! {
            *pipewire::keys::MEDIA_TYPE => "Video",
            *pipewire::keys::MEDIA_CATEGORY => "Capture",
            *pipewire::keys::MEDIA_ROLE => "Screen",
        },
    )
    .map_err(|e| e.to_string())?;

    // What the compositor settled on. Filled in when the format is agreed and
    // read by every frame after that.
    let agreed: std::rc::Rc<std::cell::Cell<(u32, u32, VideoFormat)>> =
        std::rc::Rc::new(std::cell::Cell::new((0, 0, VideoFormat::Unknown)));
    let for_format = agreed.clone();

    let _listener = stream
        .add_local_listener_with_user_data(())
        .param_changed(move |_, _, id, param| {
            let Some(param) = param else { return };
            if id != pipewire::spa::param::ParamType::Format.as_raw() {
                return;
            }
            let mut info = pipewire::spa::param::video::VideoInfoRaw::default();
            let Ok((media_type, media_subtype)) = pipewire::spa::param::format_utils::parse_format(param) else {
                return;
            };
            if media_type != MediaType::Video || media_subtype != MediaSubtype::Raw {
                return;
            }
            if info.parse(param).is_err() {
                return;
            }
            let size = info.size();
            for_format.set((size.width, size.height, info.format()));
            log::info!("screen reading: stream is {}×{} {:?}", size.width, size.height, info.format());
        })
        .process(move |stream, ()| {
            let Some(mut buffer) = stream.dequeue_buffer() else { return };
            let (width, height, format) = agreed.get();
            if width == 0 || height == 0 {
                return;
            }
            let datas = buffer.datas_mut();
            let Some(data) = datas.first_mut() else { return };
            let stride = data.chunk().stride().max(0) as usize;
            let Some(pixels) = data.data() else { return };
            if let Some(cap) = to_capture(pixels, stride, width, height, format) {
                crate::reading::set_frame(cap);
            }
        })
        .register()
        .map_err(|e| e.to_string())?;

    // The formats worth being offered, in the order they are preferred. All of
    // them are eight bits a channel with the channels in some order, which is
    // all the reader needs — it converts to RGB either way.
    let format = pipewire::spa::pod::object!(
        pipewire::spa::utils::SpaTypes::ObjectParamFormat,
        pipewire::spa::param::ParamType::EnumFormat,
        pipewire::spa::pod::property!(FormatProperties::MediaType, Id, MediaType::Video),
        pipewire::spa::pod::property!(FormatProperties::MediaSubtype, Id, MediaSubtype::Raw),
        pipewire::spa::pod::property!(
            FormatProperties::VideoFormat,
            Choice,
            Enum,
            Id,
            VideoFormat::BGRx,
            VideoFormat::BGRx,
            VideoFormat::RGBx,
            VideoFormat::BGRA,
            VideoFormat::RGBA,
            VideoFormat::xBGR,
            VideoFormat::xRGB,
        ),
        pipewire::spa::pod::property!(
            FormatProperties::VideoSize,
            Choice,
            Range,
            Rectangle,
            pipewire::spa::utils::Rectangle { width: 1920, height: 1080 },
            pipewire::spa::utils::Rectangle { width: 1, height: 1 },
            pipewire::spa::utils::Rectangle { width: 8192, height: 8192 }
        ),
        pipewire::spa::pod::property!(
            FormatProperties::VideoFramerate,
            Choice,
            Range,
            Fraction,
            pipewire::spa::utils::Fraction { num: 10, denom: 1 },
            pipewire::spa::utils::Fraction { num: 0, denom: 1 },
            pipewire::spa::utils::Fraction { num: 30, denom: 1 }
        ),
    );

    let values: Vec<u8> = pipewire::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &pipewire::spa::pod::Value::Object(format),
    )
    .map_err(|e| e.to_string())?
    .0
    .into_inner();
    let mut params = [Pod::from_bytes(&values).ok_or("could not describe the formats")?];

    stream
        .connect(
            Direction::Input,
            Some(node),
            StreamFlags::AUTOCONNECT | StreamFlags::MAP_BUFFERS,
            &mut params,
        )
        .map_err(|e| format!("could not attach to the window's stream: {e}"))?;

    // Stopping is a message rather than a flag, because the loop is asleep
    // until PipeWire or this wakes it.
    let quit = main_loop.clone();
    let _stop = stop.attach(main_loop.loop_(), move |()| quit.quit());
    main_loop.run();

    crate::reading::set_stopped(None);
    Ok(())
}

/// One frame's pixels as the reader wants them: three bytes a pixel, red first.
fn to_capture(
    pixels: &[u8],
    stride: usize,
    width: u32,
    height: u32,
    format: pipewire::spa::param::video::VideoFormat,
) -> Option<Captured> {
    use pipewire::spa::param::video::VideoFormat as F;
    // Where red, green and blue sit in each four-byte pixel.
    let (r, g, b) = match format {
        F::BGRx | F::BGRA => (2, 1, 0),
        F::RGBx | F::RGBA => (0, 1, 2),
        F::xBGR | F::ABGR => (3, 2, 1),
        F::xRGB | F::ARGB => (1, 2, 3),
        _ => return None,
    };
    let stride = if stride == 0 { width as usize * 4 } else { stride };
    if pixels.len() < stride * height as usize {
        return None;
    }
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for row in 0..height as usize {
        let line = &pixels[row * stride..row * stride + width as usize * 4];
        for pixel in line.chunks_exact(4) {
            rgb.extend_from_slice(&[pixel[r], pixel[g], pixel[b]]);
        }
    }
    Some(Captured { rgb, width, height, source: "window (portal)".into(), full_height: height, origin: (0, 0) })
}

/// The running stream, if screen reading is on.
///
/// Reading the screen is a thing the player switches on, not something the
/// client does because it can: the desktop asks before it starts, the
/// compositor keeps sending frames while it runs, and both are worth being in
/// charge of. Everything that reads the screen is unavailable until it is on.
struct Running {
    /// Ends the PipeWire loop when dropped.
    stop: pipewire::channel::Sender<()>,
    /// Ends the portal session when dropped, which is what tells the desktop
    /// to stop sending.
    _session: ashpd::desktop::Session<ashpd::desktop::screencast::Screencast>,
    thread: Option<std::thread::JoinHandle<()>>,
}

fn running() -> &'static Mutex<Option<Running>> {
    static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(None))
}

/// Start reading the screen: ask the portal for the window, then stream it.
///
/// The token from last time is offered, so a player who has already pointed at
/// the game is not asked again. Returns the token to remember.
pub async fn start(restore: Option<String>) -> Result<Option<String>, String> {
    stop();
    let chosen = choose_window(restore).await?;
    let (sender, receiver) = pipewire::channel::channel();
    let node = chosen.node;
    let fd = chosen.fd;

    let thread = std::thread::Builder::new()
        .name("screen-reading".into())
        .spawn(move || {
            if let Err(e) = run_stream(node, fd, receiver) {
                log::warn!("screen reading stopped: {e}");
                crate::reading::set_stopped(Some(e));
            }
        })
        .map_err(|e| e.to_string())?;

    *running().lock().map_err(|_| "screen reading is in a bad state")? =
        Some(Running { stop: sender, _session: chosen.session, thread: Some(thread) });
    Ok(chosen.token)
}

/// Stop reading the screen. Safe to call when it is not running.
pub fn stop() {
    let Ok(mut slot) = running().lock() else { return };
    let Some(mut was) = slot.take() else { return };
    let _ = was.stop.send(());
    if let Some(thread) = was.thread.take() {
        // The loop wakes on the message and returns; waiting for it is what
        // makes a restart start cleanly rather than beside the old one.
        let _ = thread.join();
    }
    crate::reading::set_stopped(None);
}

/// Whether a stream is set up at all, frames or not.
pub fn on() -> bool {
    running().lock().map(|r| r.is_some()).unwrap_or(false)
}
