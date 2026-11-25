//! The newest frame of the game's window, kept exactly as the stream sent it.
//!
//! A stream delivers a picture ten times a second, and almost none of them are
//! ever read. Converting every one to RGB and keeping it in a fresh buffer
//! costs a pass over every pixel and a multi-megabyte allocation per frame, and
//! the allocator does not hand that memory back: the process grew in sixty
//! megabyte steps for as long as the live scan ran. So the stream's bytes are
//! copied as they are into a buffer that is reused, and only the part a reader
//! asks for is ever converted.

use crate::scan::{Captured, ScanRegion};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Where red, green and blue sit in a four-byte pixel. The fourth byte is
/// padding or alpha, and the reader has no use for either.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layout {
    Rgbx,
    Bgrx,
    Xrgb,
    Xbgr,
}

impl Layout {
    /// Byte offsets of red, green and blue inside one pixel.
    const fn offsets(self) -> (usize, usize, usize) {
        match self {
            Layout::Rgbx => (0, 1, 2),
            Layout::Bgrx => (2, 1, 0),
            Layout::Xrgb => (1, 2, 3),
            Layout::Xbgr => (3, 2, 1),
        }
    }
}

/// One frame of the window, raw.
pub struct Frame {
    bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// Bytes from the start of one row to the start of the next. Streams pad
    /// their rows, and the padding is copied along rather than packed out.
    stride: usize,
    layout: Layout,
    /// Counts up with every frame the stream delivers, so a reader can tell a
    /// new picture from one it has already looked at without comparing pixels.
    pub seq: u64,
    pub source: &'static str,
    /// Where the buffer goes when the frame ends: the spare of the feed it came
    /// from. A frame made outside a feed has nowhere to return it.
    spare: Option<Spare>,
}

impl Frame {
    /// The part of the frame a region names, in RGB.
    pub fn crop_rgb(&self, region: ScanRegion) -> Result<Captured, String> {
        let (x, y, w, h) = crate::scan::region_px(region, self.width, self.height);
        self.rect_rgb(x as u32, y as u32, w as u32, h as u32)
    }

    /// The whole frame in RGB, for the few readers that need all of it.
    pub fn full_rgb(&self) -> Result<Captured, String> {
        self.rect_rgb(0, 0, self.width, self.height)
    }

    /// A band of whole rows in RGB.
    pub fn rows_rgb(&self, top: u32, height: u32) -> Result<Captured, String> {
        self.rect_rgb(0, top, self.width, height)
    }

    pub(crate) fn rect_rgb(&self, x: u32, y: u32, w: u32, h: u32) -> Result<Captured, String> {
        if w == 0 || h == 0 || x + w > self.width || y + h > self.height {
            return Err(format!("{w}×{h} at {x},{y} is outside the {}×{} frame", self.width, self.height));
        }
        let (r, g, b) = self.layout.offsets();
        let mut rgb = Vec::with_capacity(w as usize * h as usize * 3);
        for row in y as usize..(y + h) as usize {
            let start = row * self.stride + x as usize * 4;
            for pixel in self.bytes[start..start + w as usize * 4].as_chunks::<4>().0 {
                rgb.extend_from_slice(&[pixel[r], pixel[g], pixel[b]]);
            }
        }
        Ok(Captured { rgb, width: w, height: h, source: self.source.into(), full_height: self.height, origin: (x, y) })
    }

    /// A frame made from a picture that is already RGB, as a test or a harness
    /// has it, laid out the way a stream would send it.
    #[cfg(test)]
    pub(crate) fn from_rgb(rgb: &[u8], width: u32, height: u32) -> Frame {
        let bytes = rgb.as_chunks::<3>().0.iter().flat_map(|&[r, g, b]| [r, g, b, 255]).collect();
        Frame { bytes, width, height, stride: width as usize * 4, layout: Layout::Rgbx, seq: 0, source: "test", spare: None }
    }
}

impl Drop for Frame {
    /// A frame a reader was still holding when the next one arrived ends here,
    /// and its buffer becomes the one the next frame is copied into.
    fn drop(&mut self) {
        let bytes = std::mem::take(&mut self.bytes);
        if let Some(spare) = self.spare.as_ref().filter(|_| bytes.capacity() > 0) {
            if let Ok(mut spare) = spare.lock() {
                spare.get_or_insert(bytes);
            }
        }
    }
}

/// One buffer kept back for when a reader holds the newest frame while the
/// next arrives. Locked only ever after the feed's store or on its own, never
/// the other way round.
type Spare = Arc<Mutex<Option<Vec<u8>>>>;

/// What the stream is doing, and the newest frame it sent.
struct Store {
    frame: Option<Arc<Frame>>,
    /// When the newest frame arrived. A stream that quietly stops sending looks
    /// exactly like a game with nothing on screen — the same frame answers
    /// every time — and the age is the only thing that tells them apart.
    at: Option<Instant>,
    seq: u64,
    live: bool,
    error: Option<String>,
}

/// A stream's frames and what it is doing. The client has one; a test makes
/// its own, so nothing it checks is shared with another test.
struct Feed {
    store: Mutex<Store>,
    spare: Spare,
}

static FEED: LazyLock<Feed> = LazyLock::new(Feed::new);

/// The fewest milliseconds between two frames worth keeping. Both streams are
/// asked for ten a second; this holds where a compositor sends more anyway.
const MIN_INTERVAL: Duration = Duration::from_millis(90);

impl Feed {
    fn new() -> Self {
        Self {
            store: Mutex::new(Store { frame: None, at: None, seq: 0, live: false, error: None }),
            spare: Arc::new(Mutex::new(None)),
        }
    }

    fn wants_frame(&self) -> bool {
        self.store.lock().map(|s| s.at.is_none_or(|at| at.elapsed() >= MIN_INTERVAL)).unwrap_or(false)
    }

    fn push(&self, pixels: &[u8], width: u32, height: u32, stride: usize, layout: Layout, source: &'static str) {
        let stride = if stride == 0 { width as usize * 4 } else { stride };
        // The last row need not carry its padding.
        let len = stride * height.saturating_sub(1) as usize + width as usize * 4;
        if width == 0 || height == 0 || stride < width as usize * 4 || pixels.len() < len {
            return;
        }
        let pixels = &pixels[..len];
        let Ok(mut store) = self.store.lock() else { return };
        store.seq += 1;
        let seq = store.seq;
        store.at = Some(Instant::now());
        store.live = true;
        store.error = None;
        // Straight over the old frame when nobody is reading it, which is
        // nearly always: a reader holds a frame only for as long as a crop takes.
        if let Some(frame) = store.frame.as_mut().and_then(Arc::get_mut) {
            frame.bytes.clear();
            frame.bytes.extend_from_slice(pixels);
            (frame.width, frame.height, frame.stride, frame.layout, frame.seq, frame.source) =
                (width, height, stride, layout, seq, source);
            return;
        }
        let mut bytes = self.spare.lock().ok().and_then(|mut s| s.take()).unwrap_or_default();
        bytes.clear();
        bytes.extend_from_slice(pixels);
        let spare = Some(self.spare.clone());
        let old = store.frame.replace(Arc::new(Frame { bytes, width, height, stride, layout, seq, source, spare }));
        drop(store);
        drop(old);
    }

    fn stopped(&self, error: Option<String>) {
        let old = match self.store.lock() {
            Ok(mut store) => {
                store.at = None;
                store.live = false;
                store.error = error;
                store.frame.take()
            }
            Err(_) => None,
        };
        drop(old);
        // Nothing is coming to need it.
        if let Ok(mut spare) = self.spare.lock() {
            spare.take();
        }
    }

    fn latest(&self) -> Option<Arc<Frame>> {
        self.store.lock().ok().and_then(|s| s.frame.clone())
    }
}

/// Whether a frame arriving now would be kept. Asked before any work is done
/// on one, so a stream that sends more than it was asked for costs nothing.
pub fn wants_frame() -> bool {
    FEED.wants_frame()
}

/// A frame has arrived: copy it, as it is, over the one before.
///
/// `stride` is the distance between rows in bytes, 0 for packed rows.
pub fn push(pixels: &[u8], width: u32, height: u32, stride: usize, layout: Layout, source: &'static str) {
    FEED.push(pixels, width, height, stride, layout, source);
}

/// The stream stopped, or could not start.
pub fn stopped(error: Option<String>) {
    FEED.stopped(error);
}

/// The newest frame, shared with the stream. Hold it only as long as a crop
/// takes: a frame held when the next arrives costs the stream a second buffer.
pub fn latest() -> Option<Arc<Frame>> {
    FEED.latest()
}

/// Whether frames are arriving.
pub fn live() -> bool {
    FEED.store.lock().map(|s| s.live).unwrap_or(false)
}

/// How long ago the newest frame arrived.
pub fn age() -> Option<Duration> {
    FEED.store.lock().ok()?.at.map(|at| at.elapsed())
}

/// Why the stream is not running, when it is not.
pub fn error() -> Option<String> {
    FEED.store.lock().ok().and_then(|s| s.error.clone())
}

/// The game's frame, waiting a moment for the first one after a start.
///
/// A compositor sends a frame when the window next paints, and a game paints
/// constantly — so this only ever waits at the very beginning.
pub fn wait(app: &tauri::AppHandle) -> Result<Arc<Frame>, String> {
    if !crate::reading::state(app).on {
        return Err("Screen reading is off. Switch it on in StarBuddy and choose the game's window.".into());
    }
    for _ in 0..40 {
        if let Some(frame) = latest() {
            return Ok(frame);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    latest().ok_or_else(|| {
        error().unwrap_or_else(|| {
            "The window is not sending anything — is the game still running, and is screen reading on?".into()
        })
    })
}

/// The whole game window in RGB, from the stream the player switched on.
pub fn full_rgb(app: &tauri::AppHandle) -> Result<Captured, String> {
    wait(app)?.full_rgb()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lock::LockExt;

    /// A 3×2 frame whose pixels are numbered, laid out as `layout` with
    /// `pad` bytes after each row, and the RGB it should convert to.
    fn numbered(layout: Layout, pad: usize) -> (Frame, Vec<[u8; 3]>) {
        let (width, height) = (3u32, 2u32);
        let stride = width as usize * 4 + pad;
        let mut bytes = vec![0xEE; stride * height as usize];
        let mut want = Vec::new();
        for y in 0..height as usize {
            for x in 0..width as usize {
                let n = (y * width as usize + x) as u8;
                let rgb = [10 + n, 100 + n, 200 + n];
                let (r, g, b) = layout.offsets();
                let at = y * stride + x * 4;
                bytes[at + r] = rgb[0];
                bytes[at + g] = rgb[1];
                bytes[at + b] = rgb[2];
                // The fourth byte is whichever one is left, and it is never read.
                let spare = (0..4).find(|i| ![r, g, b].contains(i)).unwrap();
                bytes[at + spare] = 0x77;
                want.push(rgb);
            }
        }
        (Frame { bytes, width, height, stride, layout, seq: 1, source: "test", spare: None }, want)
    }

    #[test]
    fn every_layout_converts_to_red_green_blue() {
        for layout in [Layout::Rgbx, Layout::Bgrx, Layout::Xrgb, Layout::Xbgr] {
            for pad in [0, 4, 12] {
                let (frame, want) = numbered(layout, pad);
                let full = frame.full_rgb().unwrap();
                let got: Vec<[u8; 3]> = full.rgb.as_chunks::<3>().0.to_vec();
                assert_eq!(got, want, "{layout:?} with {pad} bytes of padding");
                assert_eq!((full.width, full.height, full.origin, full.full_height), (3, 2, (0, 0), 2));
            }
        }
    }

    #[test]
    fn a_crop_converts_only_its_own_pixels_and_knows_where_it_was() {
        for layout in [Layout::Bgrx, Layout::Xrgb] {
            let (frame, want) = numbered(layout, 8);
            // The right two pixels of the bottom row.
            let crop = frame.rect_rgb(1, 1, 2, 1).unwrap();
            assert_eq!(crop.rgb, [want[4], want[5]].concat(), "{layout:?}");
            assert_eq!((crop.width, crop.height, crop.origin, crop.full_height), (2, 1, (1, 1), 2));
            let band = frame.rows_rgb(1, 1).unwrap();
            assert_eq!(band.rgb, [want[3], want[4], want[5]].concat());
        }
        let (frame, _) = numbered(Layout::Rgbx, 0);
        assert!(frame.rect_rgb(2, 0, 2, 1).is_err(), "past the right edge");
        assert!(frame.rect_rgb(0, 0, 0, 1).is_err(), "nothing at all");
    }

    /// On a feed of its own, so no other test's frames can land in its spare.
    #[test]
    fn frames_are_copied_into_buffers_that_are_reused() {
        let feed = Feed::new();
        let (frame, want) = numbered(Layout::Bgrx, 4);
        let stride = frame.stride;
        feed.push(&frame.bytes, 3, 2, stride, Layout::Bgrx, "test");
        let first = feed.latest().unwrap();
        let seq = first.seq;
        assert_eq!(first.full_rgb().unwrap().rgb, want.concat());
        let buffer = first.bytes.as_ptr();

        // Held by a reader while the next frame arrives: the reader keeps the
        // picture it had, and the new one goes into a buffer of its own.
        feed.push(&frame.bytes, 3, 2, stride, Layout::Bgrx, "test");
        let second = feed.latest().unwrap();
        assert_eq!(second.seq, seq + 1);
        assert_ne!(second.bytes.as_ptr(), buffer);
        assert_eq!(first.full_rgb().unwrap().rgb, want.concat(), "the held frame is untouched");

        // Let go of both: the next frame is written over the newest in place.
        let newest = second.bytes.as_ptr();
        drop((first, second));
        feed.push(&frame.bytes, 3, 2, stride, Layout::Bgrx, "test");
        let third = feed.latest().unwrap();
        assert_eq!(third.seq, seq + 2);
        assert_eq!(third.bytes.as_ptr(), newest);
        // The buffer the reader let go of waits as the spare.
        assert!(feed.spare.lock_or_recover().as_ref().is_some_and(|b| b.as_ptr() == buffer));

        // Too few bytes for what the frame claims to be is not a frame.
        feed.push(&frame.bytes[..10], 3, 2, stride, Layout::Bgrx, "test");
        assert_eq!(feed.latest().unwrap().seq, seq + 2);
        drop(third);
        feed.stopped(None);
        assert!(feed.latest().is_none() && !feed.store.lock_or_recover().live);
        assert!(feed.spare.lock_or_recover().is_none(), "a stopped feed keeps no buffer");
    }

    #[test]
    fn a_region_crops_the_same_pixels_the_reader_always_got() {
        // The way a region was cut before frames were kept raw: convert the
        // whole frame, then crop the RGB.
        let (width, height) = (64u32, 40u32);
        let rgb: Vec<u8> = (0..width * height * 3).map(|i| (i * 7 % 251) as u8).collect();
        let region = ScanRegion { x: 0.25, y: 0.1, w: 0.5, h: 0.6 };
        let (x, y, w, h) = crate::scan::region_px(region, width, height);
        let img = image::RgbImage::from_raw(width, height, rgb.clone()).unwrap();
        let old = image::imageops::crop_imm(&img, x as u32, y as u32, w as u32, h as u32).to_image();

        let crop = Frame::from_rgb(&rgb, width, height).crop_rgb(region).unwrap();
        assert_eq!(crop.rgb, old.into_raw());
        assert_eq!((crop.width, crop.height), (w as u32, h as u32));
        assert_eq!(crop.origin, (x as u32, y as u32));
    }
}
