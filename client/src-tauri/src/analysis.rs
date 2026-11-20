//! Screen analysis: one place that decides what is read off the game's window,
//! how often, and on how many cores.
//!
//! Every reader used to run its own way. The live scan had a thread of its own
//! that grabbed a frame, cut its area out and read it, round and round; the
//! refinery read grabbed its own frame when the key was pressed; and the two
//! could not run together, because each drove every core it could get on the
//! machine that was also running the game.
//!
//! Now a reader is an [`Analyzer`] — a named piece of Rust with a typed result
//! — and asks for an area of the window, either continuously at a rate
//! ([`subscribe`]) or once ([`run_once`]). One scheduler cuts the areas out of
//! the newest frame, skips what has not changed since it was last read, and
//! hands the rest to a small pool of workers that share one set of OCR
//! engines. The pool is what arbitrates: a refinery read and the live scan
//! take turns on a fixed number of threads instead of fighting over all of
//! them.

use crate::capture::Frame;
use crate::scan::{Captured, OcrLine, ScanRegion};
use ocrs::OcrEngine;
use serde::Serialize;
use std::collections::VecDeque;
use crate::lock::LockExt;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// How many threads the OCR models run on: half the logical cores, no more
/// than four and at least one. The game is on the same machine and has the
/// better claim to it; past four the models gain little anyway.
pub fn ocr_threads() -> usize {
    let logical = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    (logical / 2).clamp(1, 4)
}

/// How many reads can be under way at once. The models parallelise inside a
/// read, so a second worker is not for speed: it is so a one-off read does not
/// wait behind a continuous one, or the other way round.
const WORKERS: usize = 2;

/// Every analyzer there is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AnalyzerKind {
    /// The signature badge beside a pinged contact, read live.
    ScanBadge,
    /// The whole signature area, read once for "Scan now".
    ScanReadout,
    /// A refinery terminal's work order panels.
    RefineryPanel,
}

impl AnalyzerKind {
    /// What the analyzer is called in a log line or a report.
    pub fn label(self) -> &'static str {
        match self {
            AnalyzerKind::ScanBadge => "live scan",
            AnalyzerKind::ScanReadout => "scan",
            AnalyzerKind::RefineryPanel => "refinery read",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Read the area again whenever it changes, at most `rate_hz` times a second.
    Continuous,
    /// Read it once and answer the one who asked.
    Once,
}

/// One standing request for an area of the window.
#[derive(Clone, Debug)]
pub struct Subscription {
    pub id: u64,
    /// The overlay window that hears the results.
    pub owner: String,
    pub analyzer: AnalyzerKind,
    pub region: ScanRegion,
    pub rate_hz: f32,
    pub mode: Mode,
}

/// What [`subscribe`] hands back, and [`unsubscribe`] takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Handle(u64);

// ── Stages ─────────────────────────────────────────────────────────────────

/// Which reader a picture goes to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Charset {
    /// Letters and digits: a label, a name, a unit.
    Text,
    /// Digits and separators only, for anything that is a number or nothing.
    Digits,
}

/// How a picture is turned into text.
// No analyzer reads a lone HUD value yet; this is the way in for the first.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OcrMode {
    /// Find the words first, then read each line that was found: for an area
    /// whose text could be anywhere in it.
    Detect,
    /// The picture is already one line of text: skip the detector and read it
    /// whole. A HUD value whose place is known costs the recognizer alone,
    /// which is a fraction of finding the text first.
    SingleLine,
}

/// The OCR stage, as an analyzer sees it.
pub struct Ocr<'a> {
    text: &'a OcrEngine,
    digits: &'a OcrEngine,
}

impl<'a> Ocr<'a> {
    pub fn engine(&self, charset: Charset) -> &'a OcrEngine {
        match charset {
            Charset::Text => self.text,
            Charset::Digits => self.digits,
        }
    }

    /// Both readers, the way the signature code takes them.
    pub fn reader(&self) -> crate::scan::Reader<'a> {
        crate::scan::Reader { text: self.engine(Charset::Text), digits: self.engine(Charset::Digits) }
    }

    /// Every line in a picture, with where it is.
    pub fn lines(&self, cap: &Captured, charset: Charset) -> Result<Vec<OcrLine>, String> {
        crate::scan::run_ocr(self.engine(charset), cap)
    }

    /// The text in a picture, lines joined by spaces.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn text(&self, img: &image::RgbImage, charset: Charset, mode: OcrMode) -> Result<String, String> {
        let engine = self.engine(charset);
        match mode {
            OcrMode::Detect => crate::scan::ocr_text(engine, img),
            OcrMode::SingleLine => single_line(engine, img),
        }
    }
}

/// Read a picture as one line, without asking the detector where the text is.
#[cfg_attr(not(test), allow(dead_code))]
fn single_line(engine: &OcrEngine, img: &image::RgbImage) -> Result<String, String> {
    use rten_imageproc::{Rect, RotatedRect};
    let (width, height) = img.dimensions();
    let source = ocrs::ImageSource::from_bytes(img.as_raw(), (width, height)).map_err(|e| e.to_string())?;
    let input = engine.prepare_input(source).map_err(|e| e.to_string())?;
    let whole = RotatedRect::from_rect(Rect::from_tlbr(0.0, 0.0, height as f32, width as f32));
    let lines = engine.recognize_text(&input, &[vec![whole]]).map_err(|e| e.to_string())?;
    Ok(lines.into_iter().flatten().map(|l| l.to_string()).collect::<Vec<_>>().join(" ").trim().to_string())
}

/// What the pixel stage cut out of one frame, for the stages after it.
pub struct Cut {
    /// The subscribed area in RGB. The change check compares this.
    pub crop: Captured,
    /// Anything else an analyzer wanted from the same frame.
    pub extra: Option<Captured>,
    /// When the frame was cut, so a result can say how long the player waited.
    pub taken: Instant,
}

impl Cut {
    pub fn new(crop: Captured) -> Self {
        Self { crop, extra: None, taken: Instant::now() }
    }
}

/// What a read has to work with.
pub struct Ctx<'a> {
    pub app: &'a AppHandle,
    pub ocr: Ocr<'a>,
}

/// One reader of the screen: a pixel stage, then OCR and a parse, then a
/// result or nothing.
pub trait Analyzer: Send + Sync + 'static {
    type Output: Serialize + Clone + Send + 'static;

    fn kind(&self) -> AnalyzerKind;

    /// The event the owner window hears a continuous subscription's results on.
    fn event(&self) -> &'static str;

    /// The pixel stage, with the frame in hand. The frame is shared with the
    /// stream, so everything later stages need is copied out here; the
    /// default is the subscribed area and nothing else.
    fn cut(&self, frame: &Frame, region: ScanRegion) -> Result<Cut, String> {
        Ok(Cut::new(frame.crop_rgb(region)?))
    }

    /// OCR and parse. `None` is a read that found nothing worth saying.
    fn read(&self, cut: Cut, cx: &Ctx) -> Result<Option<Self::Output>, String>;

    /// Whether `now` says something `before` did not. Only then is the owner
    /// told; the same reading twice is not news.
    fn differs(&self, _before: &Self::Output, _now: &Self::Output) -> bool {
        true
    }

    /// A continuous subscription could not read. Said once per fault, not on
    /// every pass it lasts.
    fn failed(&self, _app: &AppHandle, error: &str) {
        log::warn!("{}: {error}", self.kind().label());
    }

    /// The fault [`Analyzer::failed`] reported has cleared.
    fn recovered(&self, _app: &AppHandle) {}

    /// The service ended a continuous subscription on its own: the stream it
    /// reads from has stopped.
    fn ended(&self, _app: &AppHandle, _handle: Handle, _why: &str) {}
}

// ── Scheduling ─────────────────────────────────────────────────────────────

/// How far apart two crops have to be, on average per sampled byte, to count
/// as a change worth reading.
const CHANGE_THRESHOLD: f32 = 4.0;

/// An unchanged area is read again after this long anyway. The change check
/// samples, and a single digit turning over in a large area can slip under it.
const FORCE_AFTER: Duration = Duration::from_secs(3);

/// After a failure, the next attempt waits at least this long, so a fault that
/// lasts is not retried as fast as reads are made.
const RETRY_AFTER: Duration = Duration::from_secs(2);

/// A stream that has sent nothing at all for this long is reported as one.
const NO_FRAME_GRACE: Duration = Duration::from_secs(2);

/// Mean absolute difference of two equally sized crops, sampled.
fn frame_diff(a: &[u8], b: &[u8]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 255.0;
    }
    let mut sum = 0u64;
    let mut n = 0u64;
    for i in (0..a.len()).step_by(24) {
        sum += (a[i] as i16 - b[i] as i16).unsigned_abs() as u64;
        n += 1;
    }
    sum as f32 / n.max(1) as f32
}

/// Before anything is cut: whether this pass has anything to do.
#[derive(Debug, PartialEq, Eq)]
enum Gate {
    /// Its time has not come.
    NotDue,
    /// A read of it is under way; the next waits for it to finish.
    Running,
    /// The stream has sent nothing new since the last look.
    SameFrame,
    /// Cut the area and offer it.
    Go,
}

/// With the crop in hand: what becomes of it.
#[derive(Debug, PartialEq, Eq)]
enum Offer {
    /// The same picture as the one last read.
    Unchanged,
    /// A new job.
    Queue,
    /// A newer picture for a job still waiting for a worker, which is dropped.
    Replace,
}

/// One continuous subscription's place in the schedule, kept apart from the
/// stream and the workers so it can be tested without either.
struct Slot {
    period: Duration,
    next_due: Instant,
    last_seq: Option<u64>,
    /// The crop last queued, which the next one is compared with.
    prev: Vec<u8>,
    last_queued: Option<Instant>,
    /// Queued and waiting for a worker.
    pending: bool,
    /// Being read.
    running: bool,
}

impl Slot {
    fn new(rate_hz: f32, now: Instant) -> Self {
        Self {
            period: Duration::from_secs_f32(1.0 / rate_hz.clamp(0.05, 20.0)),
            next_due: now,
            last_seq: None,
            prev: Vec::new(),
            last_queued: None,
            pending: false,
            running: false,
        }
    }

    fn check(&self, now: Instant, seq: u64) -> Gate {
        if self.running {
            Gate::Running
        } else if now < self.next_due {
            Gate::NotDue
        } else if self.last_seq == Some(seq) {
            Gate::SameFrame
        } else {
            Gate::Go
        }
    }

    fn offer(&mut self, now: Instant, seq: u64, crop: &[u8]) -> Offer {
        self.last_seq = Some(seq);
        self.next_due = now + self.period;
        let changed = self.prev.is_empty() || frame_diff(&self.prev, crop) > CHANGE_THRESHOLD;
        let stale = self.last_queued.is_none_or(|at| now.duration_since(at) >= FORCE_AFTER);
        if !changed && !stale {
            return Offer::Unchanged;
        }
        self.prev.clear();
        self.prev.extend_from_slice(crop);
        self.last_queued = Some(now);
        if std::mem::replace(&mut self.pending, true) {
            Offer::Replace
        } else {
            Offer::Queue
        }
    }

    fn started(&mut self) {
        self.pending = false;
        self.running = true;
    }

    /// The period counts from the end of a read rather than its start, so a
    /// slow read is followed by a pause and not straight away by the next.
    fn finished(&mut self, now: Instant, ok: bool) {
        self.running = false;
        self.next_due = now + if ok { self.period } else { self.period.max(RETRY_AFTER) };
    }

    /// The area changed, so whatever was last read of it says nothing now.
    fn forget(&mut self) {
        self.prev.clear();
        self.last_seq = None;
    }
}

/// Counts kept per subscription, and per analyzer for one-off reads.
#[derive(Clone, Default, Debug)]
struct Stats {
    runs: u64,
    hits: u64,
    unchanged: u64,
    dropped: u64,
    failed: u64,
    spent: Duration,
}

impl Stats {
    fn add_read(&mut self, spent: Duration, outcome: &Result<bool, String>) {
        self.runs += 1;
        self.spent += spent;
        match outcome {
            Ok(true) => self.hits += 1,
            Ok(false) => {}
            Err(_) => self.failed += 1,
        }
    }

    fn average_ms(&self) -> u64 {
        self.spent.as_millis() as u64 / self.runs.max(1)
    }
}

// ── The service ────────────────────────────────────────────────────────────

/// A continuous subscription with its analyzer's type taken away, so
/// subscriptions of different analyzers can share one list.
trait Runner: Send + Sync {
    fn cut(&self, frame: &Frame, region: ScanRegion) -> Result<Cut, String>;
    /// Read, and tell the owner when there is news. True when the read found
    /// something.
    fn run(&self, cut: Cut, cx: &Ctx) -> Result<bool, String>;
    fn failed(&self, app: &AppHandle, error: &str);
    fn recovered(&self, app: &AppHandle);
    fn ended(&self, app: &AppHandle, handle: Handle, why: &str);
}

struct Continuous<A: Analyzer> {
    analyzer: A,
    owner: String,
    /// The last result sent, which the next is compared with.
    last: Mutex<Option<A::Output>>,
}

impl<A: Analyzer> Runner for Continuous<A> {
    fn cut(&self, frame: &Frame, region: ScanRegion) -> Result<Cut, String> {
        self.analyzer.cut(frame, region)
    }

    fn run(&self, cut: Cut, cx: &Ctx) -> Result<bool, String> {
        let Some(output) = self.analyzer.read(cut, cx)? else { return Ok(false) };
        let mut last = self.last.lock().map_err(|_| "a subscription is in a bad state")?;
        if last.as_ref().is_none_or(|before| self.analyzer.differs(before, &output)) {
            crate::overlay::emit_to_overlay(cx.app, &self.owner, self.analyzer.event(), output.clone());
            *last = Some(output);
        }
        Ok(true)
    }

    fn failed(&self, app: &AppHandle, error: &str) {
        self.analyzer.failed(app, error);
    }

    fn recovered(&self, app: &AppHandle) {
        self.analyzer.recovered(app);
    }

    fn ended(&self, app: &AppHandle, handle: Handle, why: &str) {
        self.analyzer.ended(app, handle, why);
    }
}

struct Sub {
    info: Subscription,
    runner: Arc<dyn Runner>,
    slot: Slot,
    since: Instant,
    /// Since the service started it.
    total: Stats,
    /// Since the last summary line.
    window: Stats,
    last_summary: Instant,
    /// The fault last reported, so the same one is not reported again.
    error: Option<String>,
}

type OnceWork = Box<dyn FnOnce(Result<&Ctx, String>) -> Result<bool, String> + Send>;

enum Work {
    Continuous { id: u64, runner: Arc<dyn Runner>, cut: Cut },
    Once { kind: AnalyzerKind, work: OnceWork },
}

#[derive(Default)]
struct State {
    next_id: u64,
    subs: Vec<Sub>,
    /// Waiting for a worker, oldest first. At most one per subscription.
    queue: VecDeque<Work>,
    once: Vec<(AnalyzerKind, Stats)>,
}

impl State {
    fn sub(&mut self, id: u64) -> Option<&mut Sub> {
        self.subs.iter_mut().find(|s| s.info.id == id)
    }
}

struct Engines {
    text: OcrEngine,
    digits: OcrEngine,
}

struct Service {
    app: AppHandle,
    state: Mutex<State>,
    /// Wakes the scheduler: a subscription came or went, or a read finished.
    schedule: Condvar,
    /// Wakes a worker: there is a job.
    work: Condvar,
    /// Loaded by the first read that needs them and kept, since the weights
    /// take longer to parse than most reads take to run.
    engines: Mutex<Option<Arc<Engines>>>,
}

static SERVICE: OnceLock<Arc<Service>> = OnceLock::new();

fn service(app: &AppHandle) -> &'static Arc<Service> {
    SERVICE.get_or_init(|| {
        let service = Arc::new(Service {
            app: app.clone(),
            state: Mutex::new(State::default()),
            schedule: Condvar::new(),
            work: Condvar::new(),
            engines: Mutex::new(None),
        });
        // Started on first use and parked whenever there is nothing to do.
        let scheduler = service.clone();
        std::thread::Builder::new()
            .name("analysis-schedule".into())
            .spawn(move || scheduler.schedule_loop())
            .expect("spawn the analysis scheduler");
        for n in 0..WORKERS {
            let worker = service.clone();
            std::thread::Builder::new()
                .name(format!("analysis-{n}"))
                .spawn(move || worker.work_loop())
                .expect("spawn an analysis worker");
        }
        service
    })
}

impl Service {
    fn engines(&self) -> Result<Arc<Engines>, String> {
        let mut engines = self.engines.lock().map_err(|_| "the OCR engines are in a bad state")?;
        if let Some(loaded) = engines.as_ref() {
            return Ok(loaded.clone());
        }
        let dir = crate::scan::models_dir(&self.app)?;
        let load = || -> Result<Engines, String> {
            Ok(Engines {
                text: crate::scan::engine_from_dir(&dir)?,
                digits: crate::scan::digit_engine_from_dir(&dir)?,
            })
        };
        let loaded = Arc::new(
            load().map_err(|e| format!("OCR models not ready ({e}) — press Scan now once to download them"))?,
        );
        log::info!("OCR engines loaded");
        *engines = Some(loaded.clone());
        Ok(loaded)
    }

    fn work_loop(&self) {
        loop {
            let work = {
                let mut state = self.state.lock_or_recover();
                loop {
                    if let Some(work) = state.queue.pop_front() {
                        if let Work::Continuous { id, .. } = &work {
                            if let Some(sub) = state.sub(*id) {
                                sub.slot.started();
                            }
                        }
                        break work;
                    }
                    state = self.work.wait(state).unwrap();
                }
            };
            let started = Instant::now();
            let engines = self.engines();
            match work {
                Work::Continuous { id, runner, cut } => {
                    let outcome = engines.and_then(|engines| {
                        let cx = Ctx { app: &self.app, ocr: Ocr { text: &engines.text, digits: &engines.digits } };
                        survive(|| runner.run(cut, &cx))
                    });
                    let spent = started.elapsed();
                    self.finished(id, &runner, spent, outcome);
                }
                Work::Once { kind, work } => {
                    let outcome = match &engines {
                        Ok(engines) => {
                            let cx = Ctx { app: &self.app, ocr: Ocr { text: &engines.text, digits: &engines.digits } };
                            survive(|| work(Ok(&cx)))
                        }
                        Err(e) => work(Err(e.clone())),
                    };
                    let spent = started.elapsed();
                    let mut state = self.state.lock_or_recover();
                    match state.once.iter_mut().find(|(k, _)| *k == kind) {
                        Some((_, stats)) => stats.add_read(spent, &outcome),
                        None => {
                            let mut stats = Stats::default();
                            stats.add_read(spent, &outcome);
                            state.once.push((kind, stats));
                        }
                    }
                }
            }
            self.schedule.notify_one();
        }
    }

    /// A continuous read is done: count it, and say so if it failed or stopped
    /// failing.
    fn finished(&self, id: u64, runner: &Arc<dyn Runner>, spent: Duration, outcome: Result<bool, String>) {
        let news = {
            let mut state = self.state.lock_or_recover();
            let Some(sub) = state.sub(id) else { return };
            sub.slot.finished(Instant::now(), outcome.is_ok());
            sub.total.add_read(spent, &outcome);
            sub.window.add_read(spent, &outcome);
            note(sub, outcome.err())
        };
        // Outside the lock: a hook is the owner's code and may call back in.
        tell(&self.app, runner, news);
    }

    fn schedule_loop(&self) {
        let mut state = self.state.lock_or_recover();
        loop {
            if state.subs.is_empty() {
                state = self.schedule.wait(state).unwrap();
                continue;
            }
            drop(state);
            let wait = self.pass();
            state = self.state.lock_or_recover();
            state = self.schedule.wait_timeout(state, wait).unwrap().0;
        }
    }

    /// One look at every continuous subscription. Returns how long to sleep.
    fn pass(&self) -> Duration {
        let now = Instant::now();
        if !crate::reading::state(&self.app).on {
            self.end_all("screen reading went off");
            return Duration::from_millis(250);
        }
        let frame = crate::capture::latest();
        let seq = frame.as_ref().map(|f| f.seq);

        // Decided under the lock, cut outside it: a crop is quick, but the
        // workers should never wait on one to report a finished read.
        let due: Vec<(u64, Arc<dyn Runner>, ScanRegion)> = {
            let state = self.state.lock_or_recover();
            state
                .subs
                .iter()
                .filter(|sub| match seq {
                    Some(seq) => sub.slot.check(now, seq) == Gate::Go,
                    None => !sub.slot.running && now >= sub.slot.next_due,
                })
                .map(|sub| (sub.info.id, sub.runner.clone(), sub.info.region))
                .collect()
        };

        let mut said = Vec::new();
        for (id, runner, region) in due {
            let Some(frame) = frame.as_ref() else {
                let mut state = self.state.lock_or_recover();
                let Some(sub) = state.sub(id) else { continue };
                sub.slot.next_due = now + RETRY_AFTER;
                if now.duration_since(sub.since) >= NO_FRAME_GRACE {
                    let why = crate::reading::trouble().unwrap_or_else(|| {
                        "The window is not sending anything — is the game still running, and is screen reading on?".into()
                    });
                    sub.window.failed += 1;
                    sub.total.failed += 1;
                    said.push((runner.clone(), note(sub, Some(why))));
                }
                continue;
            };
            let cut = runner.cut(frame, region);
            let mut state = self.state.lock_or_recover();
            let Some(sub) = state.sub(id) else { continue };
            let cut = match cut {
                Ok(cut) => cut,
                Err(e) => {
                    sub.slot.next_due = now + RETRY_AFTER;
                    sub.window.failed += 1;
                    sub.total.failed += 1;
                    said.push((runner, note(sub, Some(e))));
                    continue;
                }
            };
            // A worker may have taken the waiting job while this was cut; a
            // second one now would run straight after it.
            if sub.slot.running {
                continue;
            }
            let offer = sub.slot.offer(now, frame.seq, &cut.crop.rgb);
            match offer {
                Offer::Unchanged => {
                    sub.window.unchanged += 1;
                    sub.total.unchanged += 1;
                    continue;
                }
                Offer::Replace => {
                    sub.window.dropped += 1;
                    sub.total.dropped += 1;
                    let work = Work::Continuous { id, runner: runner.clone(), cut };
                    match state.queue.iter_mut().find(|w| matches!(w, Work::Continuous { id: queued, .. } if *queued == id)) {
                        Some(waiting) => *waiting = work,
                        None => state.queue.push_back(work),
                    }
                }
                Offer::Queue => state.queue.push_back(Work::Continuous { id, runner: runner.clone(), cut }),
            }
            drop(state);
            self.work.notify_one();
        }
        // Holding the frame any longer would cost the stream a second buffer.
        drop(frame);
        for (runner, news) in said {
            tell(&self.app, &runner, news);
        }
        self.summarise(now);

        let state = self.state.lock_or_recover();
        let next = state.subs.iter().filter(|s| !s.slot.running).map(|s| s.slot.next_due).min();
        next.map(|at| at.saturating_duration_since(Instant::now())).unwrap_or(Duration::from_millis(250)).clamp(
            // Never faster than the stream sends: a new frame is what a pass
            // is waiting for.
            Duration::from_millis(50),
            Duration::from_millis(250),
        )
    }

    /// A subscription's own account of itself every minute, at Info so it is
    /// there in a release build. A reader that quietly stops finding anything
    /// looks exactly like one working on a screen with nothing to find, and
    /// after an hour nobody can say which it was.
    fn summarise(&self, now: Instant) {
        let mut state = self.state.lock_or_recover();
        for sub in state.subs.iter_mut().filter(|s| now.duration_since(s.last_summary) >= Duration::from_secs(60)) {
            let w = &sub.window;
            log::info!(
                "{}: {} reads, {} with a result, {} unchanged, {} dropped, {} failed, {} ms each on average, newest frame {} ms old",
                sub.info.analyzer.label(),
                w.runs,
                w.hits,
                w.unchanged,
                w.dropped,
                w.failed,
                w.average_ms(),
                crate::reading::frame_age().map(|a| a.as_millis() as u64).unwrap_or(0),
            );
            sub.window = Stats::default();
            sub.last_summary = now;
        }
    }

    /// The stream is gone: every continuous subscription ends with it.
    fn end_all(&self, why: &str) {
        let ended: Vec<(Handle, Arc<dyn Runner>)> = {
            let mut state = self.state.lock_or_recover();
            state.queue.retain(|w| matches!(w, Work::Once { .. }));
            state.subs.drain(..).map(|sub| (Handle(sub.info.id), sub.runner)).collect()
        };
        for (handle, runner) in ended {
            runner.ended(&self.app, handle, why);
        }
    }
}

/// Run a read, and turn a panic in it into an error.
///
/// A parser that trips over a misread panel must not take a worker with it:
/// there are only two, and with both gone every read waits for ever.
fn survive(read: impl FnOnce() -> Result<bool, String>) -> Result<bool, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(read)).unwrap_or_else(|panic| {
        let why = panic
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| panic.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "no message".into());
        log::error!("a read panicked: {why}");
        Err(format!("the reader crashed ({why})"))
    })
}

/// What a hook should hear after a pass or a read.
enum News {
    Nothing,
    Failed(String),
    Recovered,
}

/// Record a pass or read's fault, or its absence, and say what changed.
fn note(sub: &mut Sub, error: Option<String>) -> News {
    match error {
        // The same fault again is not news; it has been said.
        Some(e) if sub.error.as_deref() == Some(e.as_str()) => News::Nothing,
        Some(e) => {
            sub.error = Some(e.clone());
            News::Failed(e)
        }
        None if sub.error.take().is_some() => News::Recovered,
        None => News::Nothing,
    }
}

fn tell(app: &AppHandle, runner: &Arc<dyn Runner>, news: News) {
    match news {
        News::Nothing => {}
        News::Failed(e) => runner.failed(app, &e),
        News::Recovered => runner.recovered(app),
    }
}

// ── The way in ─────────────────────────────────────────────────────────────

/// Read an area continuously: whenever it changes, at most `rate_hz` times a
/// second, with each result that differs from the last sent to `owner`.
pub fn subscribe<A: Analyzer>(app: &AppHandle, owner: &str, analyzer: A, region: ScanRegion, rate_hz: f32) -> Handle {
    let service = service(app);
    let now = Instant::now();
    let mut state = service.state.lock_or_recover();
    state.next_id += 1;
    let id = state.next_id;
    let info = Subscription {
        id,
        owner: owner.to_string(),
        analyzer: analyzer.kind(),
        region,
        rate_hz,
        mode: Mode::Continuous,
    };
    log::info!("{} for {owner}: subscribed at {rate_hz} a second", info.analyzer.label());
    let runner: Arc<dyn Runner> = Arc::new(Continuous { analyzer, owner: owner.to_string(), last: Mutex::new(None) });
    state.subs.push(Sub {
        info,
        runner,
        slot: Slot::new(rate_hz, now),
        since: now,
        total: Stats::default(),
        window: Stats::default(),
        last_summary: now,
        error: None,
    });
    drop(state);
    service.schedule.notify_one();
    Handle(id)
}

/// Stop a continuous subscription. A read of it already under way finishes,
/// and its result is sent.
pub fn unsubscribe(app: &AppHandle, handle: Handle) {
    let service = service(app);
    let mut state = service.state.lock_or_recover();
    if let Some(at) = state.subs.iter().position(|s| s.info.id == handle.0) {
        let sub = state.subs.remove(at);
        log::info!(
            "{} for {}: unsubscribed after {} reads, {} with a result",
            sub.info.analyzer.label(),
            sub.info.owner,
            sub.total.runs,
            sub.total.hits
        );
    }
    state.queue.retain(|w| !matches!(w, Work::Continuous { id, .. } if *id == handle.0));
}

/// Point a continuous subscription at a different area.
pub fn retarget(app: &AppHandle, handle: Handle, region: ScanRegion) {
    let service = service(app);
    let mut state = service.state.lock_or_recover();
    if let Some(sub) = state.sub(handle.0) {
        sub.info.region = region;
        sub.slot.forget();
    }
}

/// Read an area once, from the newest frame, and hand back what was read.
///
/// Waits a moment for a first frame when the stream has only just started.
pub async fn run_once<A: Analyzer>(app: &AppHandle, analyzer: A, region: ScanRegion) -> Result<Option<A::Output>, String> {
    let service = service(app).clone();
    let kind = analyzer.kind();
    let cut_app = app.clone();
    let analyzer = Arc::new(analyzer);
    let cutter = analyzer.clone();
    // Cut on a blocking thread: the wait for a first frame is a sleep.
    let cut = tauri::async_runtime::spawn_blocking(move || {
        let frame = crate::capture::wait(&cut_app)?;
        cutter.cut(&frame, region)
    })
    .await
    .map_err(|e| e.to_string())??;

    let (tx, rx) = tokio::sync::oneshot::channel();
    let work: OnceWork = Box::new(move |cx| {
        let result = cx.and_then(|cx| analyzer.read(cut, cx));
        let found = result.as_ref().map(|output| output.is_some()).map_err(String::clone);
        let _ = tx.send(result);
        found
    });
    {
        let mut state = service.state.lock_or_recover();
        state.queue.push_back(Work::Once { kind, work });
    }
    service.work.notify_one();
    rx.await.map_err(|_| format!("the {} was dropped before it finished", kind.label()))?
}

/// Lines for the system report: what is being read, and how it is going.
pub fn report() -> Vec<String> {
    let threads = std::env::var("RTEN_NUM_THREADS").unwrap_or_else(|_| "default".into());
    // Asking is not a reason to start anything.
    let Some(service) = SERVICE.get() else {
        return vec![format!("analysis: {threads} OCR threads, nothing read yet this session")];
    };
    let loaded = service.engines.lock().map(|e| e.is_some()).unwrap_or(false);
    let mut lines = vec![format!(
        "analysis: {threads} OCR threads, {WORKERS} workers, engines {}",
        if loaded { "loaded" } else { "not loaded yet" }
    )];
    let state = service.state.lock_or_recover();
    for sub in &state.subs {
        let s = &sub.total;
        lines.push(format!(
            "  {} for {} ({:?}, {} a second): {} reads, {} with a result, {} unchanged, {} dropped, {} failed, {} ms each on average{}",
            sub.info.analyzer.label(),
            sub.info.owner,
            sub.info.mode,
            sub.info.rate_hz,
            s.runs,
            s.hits,
            s.unchanged,
            s.dropped,
            s.failed,
            s.average_ms(),
            sub.error.as_ref().map(|e| format!(", failing: {e}")).unwrap_or_default(),
        ));
    }
    for (kind, s) in &state.once {
        lines.push(format!(
            "  {} ({:?}): {} reads, {} with a result, {} failed, {} ms each on average",
            kind.label(),
            Mode::Once,
            s.runs,
            s.hits,
            s.failed,
            s.average_ms(),
        ));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, ms: u64) -> Instant {
        start + Duration::from_millis(ms)
    }

    #[test]
    fn a_slot_waits_for_its_time_and_a_new_frame() {
        let t0 = Instant::now();
        let mut slot = Slot::new(2.0, t0);
        assert_eq!(slot.check(t0, 1), Gate::Go, "due at once");
        assert_eq!(slot.offer(t0, 1, &[10; 96]), Offer::Queue);
        // Not again until half a second has passed.
        assert_eq!(slot.check(at(t0, 100), 2), Gate::NotDue);
        slot.started();
        assert_eq!(slot.check(at(t0, 600), 2), Gate::Running, "never beside its own read");
        slot.finished(at(t0, 700), true);
        // The period counts from the end of the read.
        assert_eq!(slot.check(at(t0, 1100), 2), Gate::NotDue);
        assert_eq!(slot.check(at(t0, 1200), 1), Gate::SameFrame, "nothing new to look at");
        assert_eq!(slot.check(at(t0, 1200), 2), Gate::Go);
    }

    #[test]
    fn an_unchanged_area_is_skipped_until_it_is_worth_another_look() {
        let t0 = Instant::now();
        let mut slot = Slot::new(2.0, t0);
        let still = vec![40u8; 960];
        assert_eq!(slot.offer(t0, 1, &still), Offer::Queue);
        slot.started();
        slot.finished(at(t0, 100), true);

        // The same picture, and one that differs by less than the threshold.
        assert_eq!(slot.offer(at(t0, 600), 2, &still), Offer::Unchanged);
        let mut nearly = still.clone();
        nearly.iter_mut().step_by(24).take(5).for_each(|b| *b += 20);
        assert_eq!(slot.offer(at(t0, 1100), 3, &nearly), Offer::Unchanged);

        // A real change is read at once.
        let changed = vec![200u8; 960];
        assert_eq!(slot.offer(at(t0, 1600), 4, &changed), Offer::Queue);
        slot.started();
        slot.finished(at(t0, 1700), true);

        // And an area that stays the same is read again after a while anyway.
        assert_eq!(slot.offer(at(t0, 2200), 5, &changed), Offer::Unchanged);
        assert_eq!(slot.offer(at(t0, 1600 + FORCE_AFTER.as_millis() as u64), 6, &changed), Offer::Queue);

        // A new area has nothing to be compared with.
        slot.started();
        slot.finished(at(t0, 5000), true);
        slot.forget();
        assert_eq!(slot.check(at(t0, 5500), 6), Gate::Go, "the same frame, but a different area of it");
        assert_eq!(slot.offer(at(t0, 5500), 6, &changed), Offer::Queue);
    }

    #[test]
    fn one_job_waits_per_subscription_and_a_newer_picture_replaces_it() {
        let t0 = Instant::now();
        let mut slot = Slot::new(4.0, t0);
        assert_eq!(slot.offer(t0, 1, &[1; 96]), Offer::Queue);
        // The workers are busy elsewhere, so the job is still waiting when the
        // next picture is due: it takes the old one's place.
        assert_eq!(slot.check(at(t0, 300), 2), Gate::Go);
        assert_eq!(slot.offer(at(t0, 300), 2, &[90; 96]), Offer::Replace);
        assert_eq!(slot.offer(at(t0, 600), 3, &[180; 96]), Offer::Replace);
        // Once a worker has it, nothing is cut until it is done.
        slot.started();
        assert_eq!(slot.check(at(t0, 900), 4), Gate::Running);
        slot.finished(at(t0, 1000), false);
        // A failed read waits longer before the next try.
        assert_eq!(slot.check(at(t0, 1250), 4), Gate::NotDue);
        assert_eq!(slot.check(at(t0, 1000 + RETRY_AFTER.as_millis() as u64), 4), Gate::Go);
        assert_eq!(slot.offer(at(t0, 3000), 4, &[0; 96]), Offer::Queue, "a fresh job, not a replacement");
    }

    #[test]
    fn a_fault_is_reported_once_and_its_end_once() {
        let t0 = Instant::now();
        let mut sub = Sub {
            info: Subscription {
                id: 1,
                owner: "scan".into(),
                analyzer: AnalyzerKind::ScanBadge,
                region: ScanRegion::default(),
                rate_hz: 2.0,
                mode: Mode::Continuous,
            },
            runner: Arc::new(Continuous { analyzer: Nothing, owner: "scan".into(), last: Mutex::new(None) }),
            slot: Slot::new(2.0, t0),
            since: t0,
            total: Stats::default(),
            window: Stats::default(),
            last_summary: t0,
            error: None,
        };
        assert!(matches!(note(&mut sub, None), News::Nothing));
        assert!(matches!(note(&mut sub, Some("gone".into())), News::Failed(e) if e == "gone"));
        assert!(matches!(note(&mut sub, Some("gone".into())), News::Nothing));
        assert!(matches!(note(&mut sub, Some("worse".into())), News::Failed(_)));
        assert!(matches!(note(&mut sub, None), News::Recovered));
        assert!(matches!(note(&mut sub, None), News::Nothing));
    }

    /// An analyzer that reads nothing, for tests that need one to exist.
    struct Nothing;

    impl Analyzer for Nothing {
        type Output = ();
        fn kind(&self) -> AnalyzerKind {
            AnalyzerKind::ScanBadge
        }
        fn event(&self) -> &'static str {
            "nothing"
        }
        fn read(&self, _: Cut, _: &Ctx) -> Result<Option<()>, String> {
            Ok(None)
        }
    }

    /// Digits drawn by hand, five by seven, to make a picture of a number
    /// without a font.
    fn draw_number(text: &str, scale: u32) -> image::RgbImage {
        const GLYPHS: [(char, [&str; 7]); 4] = [
            ('1', ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."]),
            ('2', [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"]),
            ('4', ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."]),
            ('7', ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."]),
        ];
        let margin = 4 * scale;
        let advance = 6 * scale;
        let width = margin * 2 + advance * text.len() as u32;
        let height = margin * 2 + 7 * scale;
        let mut img = image::RgbImage::from_pixel(width, height, image::Rgb([0, 0, 0]));
        for (i, ch) in text.chars().enumerate() {
            let rows = GLYPHS.iter().find(|(c, _)| *c == ch).expect("a digit that is drawn").1;
            for (y, row) in rows.iter().enumerate() {
                for (x, cell) in row.bytes().enumerate() {
                    if cell != b'#' {
                        continue;
                    }
                    for dy in 0..scale {
                        for dx in 0..scale {
                            let px = margin + i as u32 * advance + x as u32 * scale + dx;
                            let py = margin + y as u32 * scale + dy;
                            img.put_pixel(px, py, image::Rgb([230, 160, 40]));
                        }
                    }
                }
            }
        }
        img
    }

    /// The single-line path reads a picture that is one line, without the
    /// detector. Needs the OCR models, and says so rather than failing where
    /// they have never been downloaded.
    #[test]
    fn a_single_line_is_read_without_the_detector() {
        let models = dirs::data_dir().unwrap().join("io.github.ulrichdahl.starbuddy").join("ocr");
        let Ok(digits) = crate::scan::digit_engine_from_dir(&models) else {
            eprintln!("no OCR models in {}, skipping", models.display());
            return;
        };
        let ocr = Ocr { text: &digits, digits: &digits };
        let picture = draw_number("1247", 4);
        let read = ocr.text(&picture, Charset::Digits, OcrMode::SingleLine).unwrap();
        assert_eq!(read, "1247");
    }
}
