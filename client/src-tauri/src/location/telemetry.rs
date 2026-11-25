//! EXPERIMENT: the ship's compass heading from the game's own telemetry
//! stream, `sc.game.telemetry.v1.GameTelemetryService/TelemetryStream`.
//!
//! Star Citizen 4.10 serves it on 127.0.0.1:2942 once the player turns on
//! `grpc.client.server.enabled` (user.cfg) or `GRPC_CLIENT_SERVER_ENABLED`
//! (environment). It never says where the player is, only how the ship flies;
//! the one thing the beacon takes from it is the heading, which the game sends
//! only inside a planet's atmosphere: 0..360, the HUD compass's number
//! (260.1 parked at 260 on the HUD, 0.21 flying north).
//!
//! Spoken directly over HTTP/2 with a dozen lines of protobuf reading, rather
//! than a gRPC stack: one stream, one field.

use crate::lock::LockExt;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const ADDR: &str = "127.0.0.1:2942";
const PATH: &str = "/sc.game.telemetry.v1.GameTelemetryService/TelemetryStream";
/// A reading older than this is not the ship's any more.
const FRESH: Duration = Duration::from_secs(2);
const RETRY: Duration = Duration::from_secs(5);

/// How the ship flies, from one frame.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Flight {
    /// Metres a second.
    pub speed: f64,
    /// Compass degrees, only in an atmosphere.
    pub heading: Option<f64>,
}

static LATEST: LazyLock<Mutex<Option<(Flight, Instant)>>> = LazyLock::new(Mutex::default);

/// The ship's flight, when the game sent it in the last moments. None on
/// foot, with the telemetry off, or the game not running.
pub fn flight() -> Option<Flight> {
    LATEST.lock_or_recover().filter(|(_, at)| at.elapsed() < FRESH).map(|(f, _)| f)
}

/// Listen while `open()` says the beacon window is open, reconnecting while
/// the game is not serving.
pub fn start(open: impl Fn() -> bool + Send + 'static) {
    std::thread::Builder::new()
        .name("telemetry".into())
        .spawn(move || {
            let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() else { return };
            let mut said = false;
            loop {
                if open() {
                    match rt.block_on(listen(&open)) {
                        Ok(()) => {}
                        Err(e) if !said => {
                            log::info!("telemetry: {e} (the game's telemetry is off, or the game is not running)");
                            said = true;
                        }
                        Err(_) => {}
                    }
                    *LATEST.lock_or_recover() = None;
                }
                std::thread::sleep(RETRY);
            }
        })
        .ok();
}

async fn listen(open: &impl Fn() -> bool) -> Result<(), String> {
    let tcp = tokio::net::TcpStream::connect(ADDR).await.map_err(|e| format!("{ADDR}: {e}"))?;
    let (client, conn) = h2::client::handshake(tcp).await.map_err(|e| e.to_string())?;
    tokio::spawn(conn);
    let mut client = client.ready().await.map_err(|e| e.to_string())?;
    let req = http::Request::builder()
        .method("POST")
        .uri(format!("http://{ADDR}{PATH}"))
        .header("content-type", "application/grpc")
        .header("te", "trailers")
        .body(())
        .map_err(|e| e.to_string())?;
    let (resp, mut send) = client.send_request(req, false).map_err(|e| e.to_string())?;
    // An empty TelemetryStreamRequest: not compressed, 0 bytes long.
    send.send_data(bytes::Bytes::from_static(&[0, 0, 0, 0, 0]), true).map_err(|e| e.to_string())?;
    let resp = resp.await.map_err(|e| e.to_string())?;
    if resp.status() != 200 {
        return Err(format!("the game answered {}", resp.status()));
    }
    log::info!("telemetry: connected to {ADDR}");
    let mut body = resp.into_body();
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = body.data().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        let _ = body.flow_control().release_capacity(chunk.len());
        buf.extend_from_slice(&chunk);
        // gRPC messages: a compressed flag, a 4-byte big-endian length, the bytes.
        while buf.len() >= 5 {
            let n = u32::from_be_bytes([buf[1], buf[2], buf[3], buf[4]]) as usize;
            if buf.len() < 5 + n {
                break;
            }
            // Frames without a vehicle (on foot) leave the last one to go stale.
            if let Some(f) = frame_flight(&buf[5..5 + n]) {
                *LATEST.lock_or_recover() = Some((f, Instant::now()));
            }
            buf.drain(..5 + n);
        }
        if !open() {
            return Ok(());
        }
    }
    Ok(())
}

/// The flight in one TelemetryStreamResponse: vehicle (3) › state (2) ›
/// flight (8) › instruments (3), with speed (1), atmospheric_density (9) and
/// heading (10). Proto3 leaves a 0 out: a missing speed is standing still,
/// a missing heading due north when the ship is in an atmosphere (density
/// above 0) and no heading at all otherwise.
pub fn frame_flight(msg: &[u8]) -> Option<Flight> {
    let flight = [3, 2, 8].iter().try_fold(msg, |m, &n| bytes_field(m, n))?;
    let ins = bytes_field(flight, 3).unwrap_or(&[]);
    let speed = f32_field(ins, 1).filter(|v| v.is_finite()).unwrap_or(0.0) as f64;
    let density = f32_field(ins, 9).unwrap_or(0.0);
    let heading = match f32_field(ins, 10) {
        Some(h) if h.is_finite() => Some(h as f64),
        None if density > 0.0 => Some(0.0),
        _ => None,
    };
    Some(Flight { speed, heading })
}

fn varint(b: &[u8], i: &mut usize) -> Option<u64> {
    let mut r = 0u64;
    for s in (0..64).step_by(7) {
        let x = *b.get(*i)?;
        *i += 1;
        r |= ((x & 0x7f) as u64) << s;
        if x < 0x80 {
            return Some(r);
        }
    }
    None
}

/// Every field of a message: (number, wire type, the bytes after the key).
fn fields(b: &[u8]) -> impl Iterator<Item = (u32, u8, &[u8])> {
    let mut i = 0;
    std::iter::from_fn(move || {
        if i >= b.len() {
            return None;
        }
        let key = varint(b, &mut i)?;
        let (n, w) = ((key >> 3) as u32, (key & 7) as u8);
        let start = i;
        match w {
            0 => {
                varint(b, &mut i)?;
            }
            1 => i += 8,
            2 => {
                let l = varint(b, &mut i)? as usize;
                let s = i;
                i = s.checked_add(l)?;
                return (i <= b.len()).then(|| (n, w, &b[s..i]));
            }
            5 => i += 4,
            _ => return None,
        }
        (i <= b.len()).then(|| (n, w, &b[start..i]))
    })
}

fn bytes_field(b: &[u8], n: u32) -> Option<&[u8]> {
    fields(b).filter(|(f, w, _)| *f == n && *w == 2).last().map(|(_, _, v)| v)
}

fn f32_field(b: &[u8], n: u32) -> Option<f32> {
    fields(b).filter(|(f, w, _)| *f == n && *w == 5).last().map(|(_, _, v)| f32::from_le_bytes([v[0], v[1], v[2], v[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn len(n: u32, inner: &[u8]) -> Vec<u8> {
        let mut v = vec![((n << 3) | 2) as u8, inner.len() as u8];
        v.extend_from_slice(inner);
        v
    }
    fn f32(n: u32, x: f32) -> Vec<u8> {
        let mut v = vec![((n << 3) | 5) as u8];
        v.extend_from_slice(&x.to_le_bytes());
        v
    }
    fn frame(instruments: &[u8]) -> Vec<u8> {
        len(3, &len(2, &len(8, &len(3, instruments))))
    }

    #[test]
    fn speed_and_heading_are_read_from_the_instruments() {
        let ins = [f32(1, 145.0), f32(9, 0.33), f32(10, 266.4)].concat();
        let f = frame_flight(&frame(&ins)).unwrap();
        assert!((f.speed - 145.0).abs() < 1e-3);
        assert!((f.heading.unwrap() - 266.4).abs() < 1e-3);
    }

    #[test]
    fn left_out_numbers_are_zero_and_no_heading_in_space() {
        assert_eq!(frame_flight(&frame(&f32(9, 1.2))), Some(Flight { speed: 0.0, heading: Some(0.0) }));
        assert_eq!(frame_flight(&frame(&f32(1, 145.0))).unwrap().heading, None);
        // On foot: no vehicle at all.
        assert_eq!(frame_flight(&len(6, &[])), None);
    }
}
