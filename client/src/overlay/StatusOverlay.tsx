import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { OverlayWindow } from "./OverlayWindow";
import { BodyText, asSeverity, countdown, localTime, onRsiStatus, type RsiStatus } from "../status";
import { usePageVisible } from "../visibility";
import { useGameSession, whereabouts } from "../gameSession";

/** cstate system status → dot class. */
const dotClass = (status: string) =>
  status === "operational" || status === "ok" ? "" : status === "down" || status === "disrupted" ? "bad" : "warn";

/**
 * The RSI status window. Green "all systems operational" when nothing is
 * up, severity-coloured with a shutdown countdown during maintenance or
 * an outage. The client fetches the status for every window, so a hidden
 * overlay does no work of its own.
 */
export function StatusOverlay() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<RsiStatus | null>(null);
  const [paired, setPaired] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // All clear, the box says where the player is rather than that nothing is wrong.
  const place = whereabouts(useGameSession());

  useEffect(
    () =>
      onRsiStatus((update) => {
        setPaired(update.paired);
        if (!update.paired) return;
        // A failed fetch keeps the last good answer: show it, and only say
        // "unreachable" when there is nothing to show.
        if (update.status) setStatus(update.status);
        setError(update.error !== null);
      }),
    [],
  );

  const incident = status?.active[0] ?? null;
  const shutdownMs = incident?.shutdown_at ? new Date(incident.shutdown_at).getTime() - now : null;
  const urgent = shutdownMs !== null && shutdownMs > 0;
  const visible = usePageVisible();
  // No countdown ticks while the overlay is hidden; one tick on showing it
  // again puts the clock right at once.
  useEffect(() => {
    if (!urgent || !visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [urgent, visible]);

  const open = (url: string) => void openUrl(url).catch(() => {});
  const statusUrl = status?.status_url ?? "https://status.robertsspaceindustries.com";
  const checked = status?.fetched_at ? t("overlay.status.checked", { time: localTime(status.fetched_at, i18n.language) }) : null;

  // ── not paired / not yet loaded ──
  if (paired === false || (!status && (error || paired === null))) {
    const msg = paired === false ? t("overlay.status.notPaired") : error ? t("overlay.status.unreachable") : t("overlay.status.loading");
    return (
      <OverlayWindow
        name="status"
        displayName={t("overlay.status.windowName")}
        accent="ov-accent-none"
        eyebrow={t("overlay.status.eyebrow")}
        title={t("overlay.status.title")}
        firstBox={<div className="ov-box"><span>{msg}</span></div>}
        strip={<span className="ov-muted ov-strip-item">{msg}</span>}
      />
    );
  }
  if (!status) return null;

  // ── all clear ──
  if (!incident) {
    const allOk = status.systems.every((s) => dotClass(s.status) === "");
    return (
      <OverlayWindow
        name="status"
        displayName={t("overlay.status.windowName")}
        accent={allOk ? "ov-accent-ok" : "ov-accent-notice"}
        eyebrow={t("overlay.status.eyebrow")}
        title={allOk ? t("overlay.status.allOk") : t("overlay.status.someIssues")}
        firstBox={
          <div className="ov-box acc">
            <span className="mono big">{allOk ? t("overlay.status.okBadge") : "!"}</span>
            <span>{allOk ? (place ?? t("overlay.status.allOkBody")) : t("overlay.status.someIssuesBody")}</span>
          </div>
        }
        strip={
          <>
            <span className="ov-muted ov-strip-item">{allOk ? (place ?? t("overlay.status.allOkBody")) : t("overlay.status.someIssuesBody")}</span>
            {checked && <span className="ov-muted ov-strip-item mono">{checked}</span>}
          </>
        }
      >
        <div className="ov-sys">
          {status.systems.map((s) => (
            <div key={s.name}>
              <span className={`dot ${dotClass(s.status)}`} />
              <span>{s.name}</span>
              <span className="st">{t(`overlay.status.system.${s.status}`, { defaultValue: s.status })}</span>
            </div>
          ))}
        </div>
        <div className="ov-foot">
          <button type="button" className="lnk" onClick={() => open(statusUrl)}>
            status.robertsspaceindustries.com
          </button>
          {checked && <span className="push mono">{checked}</span>}
        </div>
      </OverlayWindow>
    );
  }

  // ── incident ──
  const severity = asSeverity(incident.severity);
  const shutdownTime = incident.shutdown_at ? localTime(incident.shutdown_at, i18n.language) : null;
  const timing =
    shutdownMs === null
      ? null
      : urgent
        ? t("status.shutdownIn", { time: countdown(shutdownMs) })
        : t("status.shutdownPassed", { time: shutdownTime });

  return (
    <OverlayWindow
      name="status"
      displayName={t("overlay.status.windowName")}
      accent={`ov-accent-${severity}`}
      urgent={urgent}
      eyebrow={`${t("overlay.status.eyebrow")} · ${t(`status.severity.${severity}`)}`}
      title={incident.title}
      firstBox={
        <div className="ov-box acc">
          {urgent ? (
            <>
              <span className="lbl">{t("overlay.status.offlineIn")}</span>
              <span className="mono big">{countdown(shutdownMs!)}</span>
              <span className="ov-stow push">{t("status.stow")}</span>
            </>
          ) : (
            <>
              <span className="lbl">{t(`status.severity.${severity}`)}</span>
              <span>{timing ?? incident.affected.join(" · ")}</span>
            </>
          )}
        </div>
      }
      strip={
        <>
          {incident.affected.length > 0 && <span className="ov-muted ov-strip-item">{incident.affected.join(" · ")}</span>}
          {urgent && (
            <>
              <span className="ov-eyebrow ov-strip-item">{t("overlay.status.offlineIn")}</span>
              <span className="mono ov-count ov-strip-item">{countdown(shutdownMs!)}</span>
              <span className="ov-stow ov-strip-item">{t("status.stow")}</span>
            </>
          )}
          {!urgent && timing && <span className="ov-muted ov-strip-item">{timing}</span>}
        </>
      }
    >
      {incident.affected.length > 0 && (
        <div className="ov-chips">
          {incident.affected.map((a) => (
            <span key={a} className="ov-chip">
              {a}
            </span>
          ))}
        </div>
      )}
      {urgent && shutdownTime && <p className="ov-p">{t("status.shutdownAt", { time: shutdownTime })}</p>}
      <BodyText text={incident.body_text} className="ov-p" limit={6} />
      <div className="ov-foot">
        <button type="button" className="lnk" onClick={() => open(incident.permalink ?? statusUrl)}>
          status.robertsspaceindustries.com
        </button>
        {incident.updated_at && (
          <span className="push mono">{t("status.updated", { time: localTime(incident.updated_at, i18n.language) })}</span>
        )}
      </div>
    </OverlayWindow>
  );
}
