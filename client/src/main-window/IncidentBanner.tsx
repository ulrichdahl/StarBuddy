import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useTranslation } from "react-i18next";
import { BodyText, asSeverity, countdown, localTime, onRsiStatus, type RsiStatus, type StatusIncident } from "../status";
import { usePageVisible } from "../visibility";

// ── RSI service status (server mirrors status.robertsspaceindustries.com) ──

const STATUS_SEEN_KEY = "starbuddy.status.seen";

const versionKey = (i: StatusIncident) => `${i.slug}@${i.version ?? ""}`;

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(STATUS_SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  try {
    localStorage.setItem(STATUS_SEEN_KEY, JSON.stringify([...seen].slice(-50)));
  } catch {
    // storage unavailable — we may notify again after a restart, which is fine
  }
}

const toggleSet = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/**
 * RSI maintenance/outage banners, one per active incident. The countdown
 * ticks here, so only the banners re-render every second during an incident,
 * not the whole window.
 */
export function IncidentBanner() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<RsiStatus | null>(null);
  const [statusCollapsed, setStatusCollapsed] = useState<Set<string>>(() => new Set());
  const [statusDetails, setStatusDetails] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const seenRef = useRef<Set<string>>(readSeen());

  // RSI maintenance/outage notices, fetched by the client for every window.
  // A version we have never seen fires a native notification — that is the
  // "stow your gear" alarm while the game has the screen.
  useEffect(
    () =>
      onRsiStatus(async ({ paired, status: data }) => {
        if (!paired) {
          setStatus(null);
          return;
        }
        // No good answer yet (still loading, or offline): keep what is shown.
        if (!data) return;
        setStatus(data);
        // Marked seen before the first await, so an update arriving meanwhile
        // cannot notify about the same incident twice.
        const fresh = data.active.filter((i) => !seenRef.current.has(versionKey(i)));
        if (fresh.length === 0) return;
        fresh.forEach((i) => seenRef.current.add(versionKey(i)));
        writeSeen(seenRef.current);
        // Re-open anything the member had collapsed: this is new information.
        setStatusCollapsed((prev) => {
          const next = new Set(prev);
          fresh.forEach((i) => next.delete(i.slug));
          return next;
        });
        try {
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === "granted";
          if (!granted) return;
          for (const incident of fresh) {
            const severity = t(`status.severity.${asSeverity(incident.severity)}`);
            const shutdown = incident.shutdown_at
              ? t("status.shutdownAt", { time: localTime(incident.shutdown_at, i18n.language) })
              : "";
            sendNotification({
              title: t("status.notificationTitle", { severity }),
              body: [incident.title, shutdown, t("status.stow")].filter(Boolean).join("\n"),
            });
          }
        } catch {
          // No notifications on this desktop: the banner still shows.
        }
      }),
    [t, i18n.language],
  );

  const activeIncidents = status?.active ?? [];
  const ticking = activeIncidents.some(
    (i) => i.shutdown_at && new Date(i.shutdown_at).getTime() > Date.now(),
  );
  const visible = usePageVisible();
  // Minimised or hidden to the tray, nobody reads the countdown; one tick on
  // coming back puts it right at once.
  useEffect(() => {
    if (!ticking || !visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking, visible]);

  return (
    <>
      {activeIncidents.map((incident) => {
        const severity = asSeverity(incident.severity);
        const shutdownMs = incident.shutdown_at ? new Date(incident.shutdown_at).getTime() - now : null;
        const shutdownTime = incident.shutdown_at ? localTime(incident.shutdown_at, i18n.language) : null;
        const urgent = shutdownMs !== null && shutdownMs > 0;
        const timing =
          shutdownMs === null
            ? null
            : urgent
              ? t("status.shutdownIn", { time: countdown(shutdownMs) })
              : t("status.shutdownPassed", { time: shutdownTime });
        const collapsed = statusCollapsed.has(incident.slug);
        const details = statusDetails.has(incident.slug);

        if (collapsed) {
          return (
            <button
              key={incident.slug}
              className={`status-banner status-${severity} collapsed`}
              onClick={() => setStatusCollapsed((prev) => toggleSet(prev, incident.slug))}
              aria-label={t("status.expand")}
            >
              <span className="status-label">{t(`status.severity.${severity}`)}</span>
              <span className="status-title">{incident.title}</span>
              {timing && <span className="status-countdown mono">{timing}</span>}
            </button>
          );
        }

        return (
          <div key={incident.slug} className={`status-banner status-${severity}${urgent ? " urgent" : ""}`} role="alert">
            <div className="status-head">
              <span className="status-label">{t(`status.severity.${severity}`)}</span>
              {incident.affected.map((a) => (
                <span key={a} className="status-chip">
                  {a}
                </span>
              ))}
              <button
                className="dismiss"
                onClick={() => setStatusCollapsed((prev) => toggleSet(prev, incident.slug))}
                aria-label={t("status.collapse")}
                title={t("status.collapse")}
              >
                ×
              </button>
            </div>
            <h2 className="status-title">{incident.title}</h2>
            {timing && (
              // The banner is an alert, announced once when it appears; the
              // countdown under it changes every second and must not be.
              <p className={`status-countdown mono${urgent ? " big" : ""}`} aria-live="off">
                {timing}
                {urgent && shutdownTime && <span className="hint"> ({shutdownTime})</span>}
              </p>
            )}
            {urgent && <p className="status-stow">{t("status.stow")}</p>}
            {details && <BodyText text={incident.body_text} className="status-body" />}
            <div className="row status-actions">
              <button onClick={() => setStatusDetails((prev) => toggleSet(prev, incident.slug))}>
                {details ? t("status.hideDetails") : t("status.showDetails")}
              </button>
              {incident.permalink && (
                <button onClick={() => openUrl(incident.permalink!).catch(() => {})}>
                  {t("status.openStatus")}
                </button>
              )}
              {incident.updated_at && (
                <span className="hint status-updated">
                  {t("status.updated", { time: localTime(incident.updated_at, i18n.language) })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
