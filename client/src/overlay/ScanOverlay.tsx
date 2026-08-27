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
  shape?: number;
}

interface SigOre {
  name: string;
  signature: number;
  instability: number | null;
  resistance: number | null;
  dominant: [number, number] | null;
  companions: { name: string; share: [number, number] }[];
  rarity: string | null;
  qualities: number[];
}

/** One reading of a signature: a mineral (kind "ship") or a ground deposit size. */
interface SigMatch {
  name: string;
  kind: "ship" | "fps" | "roc" | string;
  count: number;
  signature: number;
  exact: boolean;
  delta: number;
  ore: SigOre | null;
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
  matches?: SigMatch[];
}

interface LiveReading {
  at: number;
  signature: number | null;
  matches: SigMatch[];
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
 * Scan v2: capture → local OCR → signature → reference lookup. The
 * signature identifies the dominant mineral (or a cluster of them) since
 * Alpha 4.7; the window names it and shows what the rock holds.
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
        if (e.payload.signature !== null) {
          setReading(e.payload);
          // A reading after a capture error clears the error state — the
          // accent must follow the reading, not a stale failure.
          setStatus((s) => (s.phase === "error" ? { phase: "idle", detail: "", progress: null } : s));
        }
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

  const fmt = (n: number) => n.toLocaleString(i18n.language);
  const range = (r: [number, number]) => `${fmt(r[0])}–${fmt(r[1])}%`;
  const matchName = (m: SigMatch) => {
    if (m.kind === "ship") return m.count > 1 ? t("overlay.scan.match.cluster", { name: m.name, count: m.count }) : m.name;
    const key = m.kind === "fps" ? "fps" : "roc";
    return m.count > 1 ? t(`overlay.scan.match.${key}Cluster`, { count: m.count }) : t(`overlay.scan.match.${key}`);
  };
  const resistance = (r: number) => `${t(r >= 0.5 ? "overlay.scan.match.hard" : "overlay.scan.match.easy")} · ${r.toFixed(2)}`;

  // The reading on display: the live loop while it runs, else the last "Scan now".
  const useLive = live && reading !== null;
  const sig = useLive ? reading!.signature : result?.signature ?? null;
  const matches: SigMatch[] = useLive ? reading!.matches : result?.matches ?? [];
  const best = matches[0] ?? null;
  const others = matches.slice(1);
  const at = useLive ? reading!.at : result?.captured_at;
  const atText = at ? new Date(at).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;

  const found = sig !== null || (result !== null && result.mass !== null);
  const title =
    best !== null
      ? matchName(best)
      : sig !== null
        ? t("overlay.scan.signature", { value: fmt(sig) })
        : found && result
          ? t("overlay.scan.massOnly")
          : result
            ? t("overlay.scan.noLabels")
            : t("overlay.scan.title");
  const liveButton = (
    <button type="button" className={`ov-btn${live ? " on" : ""}`} onClick={toggleLive}>
      {live ? t("overlay.scan.liveOn") : t("overlay.scan.liveOff")}
    </button>
  );
  const shown = showAll ? result?.lines ?? [] : (result?.lines ?? []).slice(0, 8);
  const qualityBand = best?.ore && best.ore.qualities.length > 0 ? `${fmt(Math.min(...best.ore.qualities))}–${fmt(Math.max(...best.ore.qualities))}` : null;

  return (
    <OverlayWindow
      name="scan"
      displayName={t("overlay.scan.windowName")}
      accent={status.phase === "error" ? "ov-accent-down" : found ? "ov-accent-ok" : "ov-accent-none"}
      eyebrow={live ? `${t("overlay.scan.eyebrow")} · ${t("overlay.scan.live")}` : t("overlay.scan.eyebrow")}
      title={title}
      firstBox={
        <div className={`ov-box${found ? " acc" : ""}`}>
          {sig !== null ? (
            <>
              <span className="lbl">{t("overlay.scan.sigLabel")}</span>
              <span className="mono big">{fmt(sig)}</span>
              {best === null ? (
                <span className="ov-dim">{t("overlay.scan.match.unknown")}</span>
              ) : (
                <>
                  {!best.exact && (
                    <span className="ov-dim">
                      ≈ {t("overlay.scan.match.approx")} ({best.delta > 0 ? "+" : ""}
                      {fmt(best.delta)})
                    </span>
                  )}
                  {best.ore?.rarity && (
                    <span className={`ov-chip ov-rarity ov-rarity-${best.ore.rarity}`}>{t(`overlay.scan.rarity.${best.ore.rarity}`, best.ore.rarity)}</span>
                  )}
                  {best.ore?.resistance !== null && best.ore?.resistance !== undefined && (
                    <span className="mono ov-dim">{resistance(best.ore.resistance)}</span>
                  )}
                </>
              )}
              {atText && <span className="mono ov-dim">{atText}</span>}
              <span className="push">{liveButton}</span>
            </>
          ) : phaseText ? (
            <>
              <span>{phaseText}</span>
              {status.progress !== null && <span className="mono push">{Math.round(status.progress * 100)}%</span>}
            </>
          ) : found ? (
            <>
              <span className="lbl">{t("overlay.scan.massLabel")}</span>
              <span className="mono">{fmt(result!.mass!)}</span>
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
          {sig !== null && <span className="mono ov-count ov-strip-item">{fmt(sig)}</span>}
          {best !== null && <span className="ov-strip-item">{matchName(best)}</span>}
          <span className="ov-muted ov-strip-item">{phaseText ?? (live ? (sig === null ? t("overlay.scan.liveWaiting") : "") : result && sig === null ? t("overlay.scan.linesRead", { count: result.lines.length }) : "")}</span>
          <span className="ov-strip-item">{liveButton}</span>
        </>
      }
    >
      {best !== null && (
        <div className="ov-facts">
          {best.ore?.dominant && (
            <div>
              <span className="lbl">{t("overlay.scan.match.share")}</span>
              <span className="mono">{range(best.ore.dominant)}</span>
            </div>
          )}
          {best.ore && best.ore.companions.length > 0 && (
            <div>
              <span className="lbl">{t("overlay.scan.match.companions")}</span>
              <span>{best.ore.companions.map((c) => `${c.name} ${range(c.share)}`).join(" · ")}</span>
            </div>
          )}
          {best.ore?.resistance !== null && best.ore?.resistance !== undefined && (
            <div>
              <span className="lbl">{t("overlay.scan.match.resistance")}</span>
              <span className="mono">{resistance(best.ore.resistance)}</span>
            </div>
          )}
          {best.ore?.instability !== null && best.ore?.instability !== undefined && (
            <div>
              <span className="lbl">{t("overlay.scan.match.instability")}</span>
              <span className="mono">{fmt(best.ore.instability)}</span>
            </div>
          )}
          {qualityBand && (
            <div>
              <span className="lbl">{t("overlay.scan.match.quality")}</span>
              <span className="mono">{qualityBand}</span>
            </div>
          )}
          {best.kind !== "ship" && <div className="ov-dim">{t("overlay.scan.match.groundHint")}</div>}
          {best.kind !== "ship" && best.signature === 3000 && best.count === 1 && <div className="ov-dim">{t("overlay.scan.match.wreckHint")}</div>}
          {others.length > 0 && (
            <div>
              <span className="lbl">{t("overlay.scan.match.alternatives")}</span>
              <span className="ov-chips">
                {others.map((m, i) => (
                  <span key={i} className="ov-chip" title={fmt(m.signature * m.count)}>
                    {matchName(m)}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
      {result && !useLive && (
        <>
          {result.badges && result.badges.length > 1 && (
            <div className="ov-chips">
              {result.badges.map((b, i) => (
                <span key={i} className="ov-chip mono" title={`${b.x},${b.y}${b.shape !== undefined ? ` · pin ${b.shape.toFixed(2)}` : ""}`}>
                  {fmt(b.value)}
                </span>
              ))}
            </div>
          )}
          {best === null && (
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
          )}
          {best === null && result.lines.length > 8 && (
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
          </div>
        </>
      )}
      {(result || live) && (
        <p className="ov-p ov-dim" style={{ fontSize: 11 }}>
          {t("overlay.scan.privacy")}
        </p>
      )}
    </OverlayWindow>
  );
}
