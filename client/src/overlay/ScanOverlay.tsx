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

/** One ledger row: a mineral's band in the rock. */
interface SigRow {
  name: string;
  dominant: boolean;
  share: [number, number] | null;
  rarity: string | null;
  resistance: number | null;
  instability: number | null;
  qualities: number[];
}

interface SigOre {
  name: string;
  signature: number;
  rarity: string | null;
  resistance: number | null;
}

/** One reading of a signature: a mineral (kind "ship") or a size-only kind (debris, fps, roc). */
interface SigMatch {
  name: string;
  kind: "ship" | "debris" | "fps" | "roc" | string;
  count: number;
  signature: number;
  exact: boolean;
  delta: number;
  ore: SigOre | null;
  rows: SigRow[];
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
 * Scan v2, design A "Ledger": the mineral (or debris/deposit kind) is the
 * title with the cluster count in grey after it; a rarity row sits above
 * the ledger, which has one row per composition band. The signature
 * itself only appears in the footer.
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
  const kindName = (m: SigMatch) => (m.kind === "ship" ? m.name : t(`overlay.scan.match.${m.kind === "fps" || m.kind === "roc" || m.kind === "debris" ? m.kind : "fps"}`));
  const hard = (r: number) => r >= 0.5;
  const resist = (r: number) => (
    <span className={`ov-res ${hard(r) ? "hard" : "easy"}`}>
      {t(hard(r) ? "overlay.scan.match.hard" : "overlay.scan.match.easy")} · {r.toFixed(2)}
    </span>
  );
  const qband = (qs: number[]) => (qs.length > 0 ? `Q ${fmt(Math.min(...qs))}–${fmt(Math.max(...qs))}` : "—");

  // The reading on display: the live loop while it runs, else the last "Scan now".
  const useLive = live && reading !== null;
  const sig = useLive ? reading!.signature : result?.signature ?? null;
  const matches: SigMatch[] = useLive ? reading!.matches : result?.matches ?? [];
  const best = matches[0] ?? null;
  const others = matches.slice(1);
  const at = useLive ? reading!.at : result?.captured_at;
  const atText = at ? new Date(at).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
  const dominant = best?.rows.find((r) => r.dominant) ?? null;

  const found = sig !== null || (result !== null && result.mass !== null);
  // Title: the mineral / kind, then the count in grey at the same size.
  const title =
    best !== null ? (
      <span className="ov-mineral">
        {kindName(best)}
        {best.count > 1 && <span className="ov-cnt">× {best.count}</span>}
      </span>
    ) : sig !== null ? (
      t("overlay.scan.match.unknown")
    ) : found && result ? (
      t("overlay.scan.massOnly")
    ) : result ? (
      t("overlay.scan.noLabels")
    ) : (
      t("overlay.scan.title")
    );
  const liveButton = (
    <button type="button" className={`ov-btn${live ? " on" : ""}`} onClick={toggleLive}>
      {live ? t("overlay.scan.liveOn") : t("overlay.scan.liveOff")}
    </button>
  );
  const shown = showAll ? result?.lines ?? [] : (result?.lines ?? []).slice(0, 8);

  // The row above the ledger: rarity chip, raw signature, resistance.
  const rarityRow =
    best !== null ? (
      <>
        {dominant?.rarity && <span className={`ov-chip ov-rarity ov-rarity-${dominant.rarity}`}>{t(`overlay.scan.rarity.${dominant.rarity}`, dominant.rarity)}</span>}
        {sig !== null && <span className="mono ov-sig">{fmt(sig)}</span>}
        {!best.exact && (
          <span className="ov-dim">
            ≈ {t("overlay.scan.match.approx")} ({best.delta > 0 ? "+" : ""}
            {fmt(best.delta)})
          </span>
        )}
        {dominant?.resistance !== null && dominant?.resistance !== undefined && (
          <>
            <span className="push lbl">{t("overlay.scan.match.resistance")}</span>
            {resist(dominant.resistance)}
          </>
        )}
        {best.kind !== "ship" && <span className="ov-dim">{t("overlay.scan.match.groundHint")}</span>}
      </>
    ) : null;

  return (
    <OverlayWindow
      name="scan"
      displayName={t("overlay.scan.windowName")}
      accent={status.phase === "error" ? "ov-accent-down" : found ? "ov-accent-ok" : "ov-accent-none"}
      eyebrow={live ? `${t("overlay.scan.eyebrow")} · ${t("overlay.scan.live")}` : t("overlay.scan.eyebrow")}
      title={title}
      firstBox={
        <div className={`ov-box${found ? " acc" : ""}`}>
          {rarityRow !== null ? (
            <div className="ov-rar" style={{ flex: 1 }}>
              {rarityRow}
            </div>
          ) : sig !== null ? (
            <>
              <span className="lbl">{t("overlay.scan.sigLabel")}</span>
              <span className="mono big">{fmt(sig)}</span>
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
          {best !== null && (
            <span className="ov-strip-item ov-mineral">
              {kindName(best)}
              {best.count > 1 && <span className="ov-cnt">× {best.count}</span>}
            </span>
          )}
          {dominant?.rarity && <span className={`ov-strip-item ov-chip ov-rarity ov-rarity-${dominant.rarity}`}>{t(`overlay.scan.rarity.${dominant.rarity}`, dominant.rarity)}</span>}
          {best === null && sig !== null && <span className="mono ov-count ov-strip-item">{fmt(sig)}</span>}
          <span className="ov-muted ov-strip-item">{phaseText ?? (live ? (sig === null ? t("overlay.scan.liveWaiting") : "") : result && sig === null ? t("overlay.scan.linesRead", { count: result.lines.length }) : "")}</span>
          <span className="ov-strip-item">{liveButton}</span>
        </>
      }
    >
      {best !== null && best.rows.length > 0 && (
        <table className="ov-cand">
          <thead>
            <tr>
              <th>{t("overlay.scan.match.colMineral")}</th>
              <th>{t("overlay.scan.match.colShare")}</th>
              <th>{t("overlay.scan.match.colResist")}</th>
              <th>{t("overlay.scan.match.colQuality")}</th>
            </tr>
          </thead>
          <tbody>
            {best.rows.map((r, i) => {
              // The same mineral again = another composition band of it.
              const band = best.rows.slice(0, i).filter((p) => p.name === r.name).length;
              return (
                <tr key={i} className={r.dominant ? "best" : ""}>
                  <td className="min">
                    <span className={`rdot ${r.rarity ? `ov-rarity-${r.rarity}` : ""}`} />
                    {r.name}
                    {band > 0 && <span className="band">{t("overlay.scan.match.band", { n: band + 1 })}</span>}
                  </td>
                  <td className="mono">{r.share ? range(r.share) : "—"}</td>
                  <td>{r.resistance !== null ? resist(r.resistance) : "—"}</td>
                  <td className="mono ov-q">{qband(r.qualities)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {others.length > 0 && (
        <div className="ov-chips">
          <span className="lbl" style={{ alignSelf: "center" }}>
            {t("overlay.scan.match.alternatives")}
          </span>
          {others.map((m, i) => (
            <span key={i} className="ov-chip" title={fmt(m.signature * m.count)}>
              {kindName(m)}
              {m.count > 1 ? ` × ${m.count}` : ""}
            </span>
          ))}
        </div>
      )}
      {result && !useLive && best === null && (
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
        </>
      )}
      {(result || live) && (
        <div className="ov-foot">
          <span className="mono">
            {sig !== null && `${fmt(sig)} · `}
            {useLive ? `${reading!.elapsed_ms} ms` : result ? `${result.source} · ${result.width}×${result.height} · ${result.elapsed_ms} ms` : ""}
          </span>
          {atText && <span className="mono">{atText}</span>}
          <span className="push">{liveButton}</span>
          <button type="button" className="ov-btn" onClick={scanNow} disabled={busy}>
            {t("overlay.scan.scanNow")}
          </button>
        </div>
      )}
      {(result || live) && (
        <p className="ov-p ov-dim" style={{ fontSize: 11 }}>
          {t("overlay.scan.privacy")}
        </p>
      )}
    </OverlayWindow>
  );
}
