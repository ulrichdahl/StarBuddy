import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { OverlayWindow } from "./OverlayWindow";

interface StatusIncident {
  slug: string;
  title: string;
  severity: string;
  affected: string[];
  body_text: string;
  shutdown_at: string | null;
  permalink: string | null;
  updated_at: string | null;
}

interface RsiStatus {
  summary: string;
  systems: { name: string; status: string }[];
  fetched_at: string | null;
  status_url: string;
  active: StatusIncident[];
}

interface ConnectionView {
  paired: boolean;
}

const POLL_MS = 30_000;
type Severity = "down" | "disrupted" | "maintenance" | "notice";
const asSeverity = (s: string): Severity =>
  s === "down" || s === "disrupted" || s === "maintenance" ? s : "notice";

const clock = (iso: string, lang: string) =>
  new Date(iso).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

function countdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** cstate system status → dot class. */
const dotClass = (status: string) =>
  status === "operational" || status === "ok" ? "" : status === "down" || status === "disrupted" ? "bad" : "warn";

function Body({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim() !== "")
        .slice(0, 6)
        .map((p, i) => (
          <p key={i} className="ov-p">
            {p.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>,
            )}
          </p>
        ))}
    </>
  );
}

/**
 * The RSI status window. Green "all systems operational" when nothing is
 * up, severity-coloured with a shutdown countdown during maintenance or
 * an outage; polls the paired server every 30 s.
 */
export function StatusOverlay() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<RsiStatus | null>(null);
  const [paired, setPaired] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const conn = await invoke<ConnectionView>("get_connection");
        if (cancelled) return;
        setPaired(conn.paired);
        if (!conn.paired) return;
        const data = await invoke<RsiStatus>("fetch_status");
        if (cancelled) return;
        setStatus(data);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const incident = status?.active[0] ?? null;
  const shutdownMs = incident?.shutdown_at ? new Date(incident.shutdown_at).getTime() - now : null;
  const urgent = shutdownMs !== null && shutdownMs > 0;
  useEffect(() => {
    if (!urgent) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [urgent]);

  const open = (url: string) => void openUrl(url).catch(() => {});
  const statusUrl = status?.status_url ?? "https://status.robertsspaceindustries.com";
  const checked = status?.fetched_at ? t("overlay.status.checked", { time: clock(status.fetched_at, i18n.language) }) : null;

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
            <span className="mono big">{allOk ? "OK" : "!"}</span>
            <span>{allOk ? t("overlay.status.allOkBody") : t("overlay.status.someIssuesBody")}</span>
          </div>
        }
        strip={
          <>
            <span className="ov-muted ov-strip-item">{allOk ? t("overlay.status.allOkBody") : t("overlay.status.someIssuesBody")}</span>
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
  const shutdownTime = incident.shutdown_at ? clock(incident.shutdown_at, i18n.language) : null;
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
      <Body text={incident.body_text} />
      <div className="ov-foot">
        <button type="button" className="lnk" onClick={() => open(incident.permalink ?? statusUrl)}>
          status.robertsspaceindustries.com
        </button>
        {incident.updated_at && (
          <span className="push mono">{t("status.updated", { time: clock(incident.updated_at, i18n.language) })}</span>
        )}
      </div>
    </OverlayWindow>
  );
}
