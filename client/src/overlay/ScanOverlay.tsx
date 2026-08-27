import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { OverlayWindow } from "./OverlayWindow";

interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Badge {
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
  text: string;
}

interface ScanResult {
  captured_at: number;
  source: string;
  width: number;
  height: number;
  elapsed_ms: number;
  lines: OcrLine[];
  numbers: number[];
  badges?: Badge[];
  signature: number | null;
  mass: number | null;
}

interface LiveReading {
  at: number;
  signature: number | null;
  badges: Badge[];
  region_px: [number, number, number, number];
  elapsed_ms: number;
}

interface ScanStatus {
  phase: "idle" | "downloading" | "capturing" | "ocr" | "done" | "error";
  detail: string;
  progress: number | null;
}

/**
 * Scan v0: capture → local OCR → readout. Shows the signature/mass when a
 * label was recognised, otherwise the raw lines so the parser can be
 * grown against what the game really renders.
 */
export function ScanOverlay() {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [status, setStatus] = useState<ScanStatus>({ phase: "idle", detail: "", progress: null });
  const [showAll, setShowAll] = useState(false);
  const [live, setLive] = useState(false);
  const [reading, setReading] = useState<LiveReading | null>(null);

  useEffect(() => {
    invoke<ScanResult | null>("scan_last").then((r) => r && setResult(r)).catch(() => {});
    invoke<boolean>("scan_live_running").then(setLive).catch(() => {});
    const subs = [
      listen<ScanStatus>("scan-status", (e) => setStatus(e.payload)),
      listen<ScanResult>("scan-result", (e) => setResult(e.payload)),
      listen<boolean>("scan-live-state", (e) => setLive(e.payload)),
      listen<LiveReading>("scan-live", (e) => {
        // Keep the last reading that had a signature; a frame without one
        // (badge moved out, HUD hidden) must not blank the window.
        if (e.payload.signature !== null) setReading(e.payload);
      }),
    ];
    return () => {
      subs.forEach((p) => p.then((un) => un()));
    };
  }, []);

  const busy = status.phase === "downloading" || status.phase === "capturing" || status.phase === "ocr";
  const scanNow = () => {
    if (busy) return;
    void invoke("scan_now").catch(() => {});
  };
  const toggleLive = () => void invoke<boolean>("scan_live_toggle").then(setLive).catch(() => {});

  const phaseText =
    status.phase === "idle"
      ? result
        ? null
        : t("overlay.scan.idle")
      : status.phase === "done"
        ? null
        : t(`overlay.scan.phase.${status.phase}`, { detail: status.detail });

  const capturedAt = result
    ? new Date(result.captured_at).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const liveSig = live && reading ? reading.signature : null;
  const found = liveSig !== null || (result && (result.signature !== null || result.mass !== null));
  const title =
    liveSig !== null
      ? t("overlay.scan.signature", { value: liveSig.toLocaleString(i18n.language) })
      : found && result
        ? result.signature !== null
          ? t("overlay.scan.signature", { value: result.signature.toLocaleString(i18n.language) })
          : t("overlay.scan.massOnly")
        : result
          ? t("overlay.scan.noLabels")
          : t("overlay.scan.title");
  const liveButton = (
    <button type="button" className={`ov-btn${live ? " on" : ""}`} onClick={toggleLive}>
      {live ? t("overlay.scan.liveOn") : t("overlay.scan.liveOff")}
    </button>
  );
  const shown = showAll ? result?.lines ?? [] : (result?.lines ?? []).slice(0, 8);

  return (
    <OverlayWindow
      name="scan"
      displayName={t("overlay.scan.windowName")}
      accent={status.phase === "error" ? "ov-accent-down" : found ? "ov-accent-ok" : "ov-accent-none"}
      eyebrow={live ? `${t("overlay.scan.eyebrow")} · ${t("overlay.scan.live")}` : t("overlay.scan.eyebrow")}
      title={title}
      firstBox={
        <div className={`ov-box${found ? " acc" : ""}`}>
          {liveSig !== null ? (
            <>
              <span className="lbl">{t("overlay.scan.sigLabel")}</span>
              <span className="mono big">{liveSig.toLocaleString(i18n.language)}</span>
              <span className="mono ov-dim">
                {reading && new Date(reading.at).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span className="push">{liveButton}</span>
            </>
          ) : phaseText ? (
            <>
              <span>{phaseText}</span>
              {status.progress !== null && <span className="mono push">{Math.round(status.progress * 100)}%</span>}
            </>
          ) : found ? (
            <>
              {result!.signature !== null && (
                <>
                  <span className="lbl">{t("overlay.scan.sigLabel")}</span>
                  <span className="mono big">{result!.signature.toLocaleString(i18n.language)}</span>
                </>
              )}
              {result!.mass !== null && (
                <>
                  <span className="lbl">{t("overlay.scan.massLabel")}</span>
                  <span className="mono">{result!.mass.toLocaleString(i18n.language)}</span>
                </>
              )}
              <span className="push">{liveButton}</span>
            </>
          ) : (
            <>
              <span>{live ? t("overlay.scan.liveWaiting") : result ? t("overlay.scan.linesRead", { count: result.lines.length }) : t("overlay.scan.idle")}</span>
              <span className="push">{liveButton}</span>
            </>
          )}
        </div>
      }
      strip={
        <>
          {liveSig !== null && <span className="mono ov-count ov-strip-item">{liveSig.toLocaleString(i18n.language)}</span>}
          <span className="ov-muted ov-strip-item">{phaseText ?? (live ? (liveSig === null ? t("overlay.scan.liveWaiting") : "") : result ? t("overlay.scan.linesRead", { count: result.lines.length }) : "")}</span>
          <span className="ov-strip-item">{liveButton}</span>
        </>
      }
    >
      {result && (
        <>
          {result.badges && result.badges.length > 1 && (
            <div className="ov-chips">
              {result.badges.map((b, i) => (
                <span key={i} className="ov-chip mono" title={`${b.x},${b.y}`}>
                  {b.value.toLocaleString(i18n.language)}
                </span>
              ))}
            </div>
          )}
          <div className="ov-lines">
            {shown.map((l, i) => (
              <div key={i}>
                <span className="mono ov-dim">
                  {l.x},{l.y}
                </span>
                <span>{l.text}</span>
              </div>
            ))}
            {result.lines.length === 0 && <div className="ov-dim">{t("overlay.scan.nothingRead")}</div>}
          </div>
          {result.lines.length > 8 && (
            <button type="button" className="ov-btn" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>
              {showAll ? t("overlay.scan.showFewer") : t("overlay.scan.showAll", { count: result.lines.length })}
            </button>
          )}
          <div className="ov-foot">
            <span className="mono">
              {result.source} · {result.width}×{result.height} · {result.elapsed_ms} ms
            </span>
            <button type="button" className="ov-btn" onClick={scanNow} disabled={busy} style={{ marginLeft: 8 }}>
              {t("overlay.scan.scanNow")}
            </button>
            {capturedAt && <span className="push mono">{capturedAt}</span>}
          </div>
          <p className="ov-p ov-dim" style={{ fontSize: 11 }}>
            {t("overlay.scan.privacy")}
          </p>
        </>
      )}
    </OverlayWindow>
  );
}
