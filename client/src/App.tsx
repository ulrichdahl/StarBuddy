import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useTranslation } from "react-i18next";
import { LOCALE_NAMES, SUPPORTED_LOCALES, setLocale, type Locale } from "./i18n";
import "./App.css";

interface ScanProgress {
  current: number;
  total: number;
  file: string;
}

interface LogEvent {
  kind: "blueprint" | "refinery_completed";
  timestamp: string;
  detail: string;
  item_class: string | null;
  file: string;
}

interface ScanResult {
  live_dir: string;
  files_scanned: number;
  localization_entries: number;
  events: LogEvent[];
}

interface ConnectionView {
  paired: boolean;
  server_url: string;
  user_name: string;
}

interface SyncSummary {
  accepted: number;
  duplicates: number;
  blueprints_added: number;
  refinery_completed: number;
  backfilled?: number;
}

interface AppVersion {
  version: string;
  build: string | null;
}

interface UpdateCheck {
  current: string;
  latest: string;
  url: string;
  update_available: boolean;
}

type UpdateStatus = "idle" | "checking" | "upToDate" | "failed";

interface HotkeyInfo {
  /** action → shortcut, e.g. { status: "F6" } */
  hotkeys: Record<string, string>;
  global_supported: boolean;
  toggle_command: string;
}

/** KWin window rule that keeps overlays above the fullscreen game (Linux/KDE). */
interface KdeRuleInfo {
  applicable: boolean;
  installed: boolean;
}

// ── RSI service status (server mirrors status.robertsspaceindustries.com) ──

interface StatusIncident {
  slug: string;
  title: string;
  severity: string;
  resolved: boolean;
  informational: boolean;
  affected: string[];
  body_text: string;
  shutdown_at: string | null;
  permalink: string | null;
  updated_at: string | null;
  version: string | null;
}

interface RsiStatus {
  summary: string;
  status_url: string;
  active: StatusIncident[];
  recent: StatusIncident[];
}

const STATUS_POLL_MS = 60_000;
const STATUS_SEEN_KEY = "starbuddy.status.seen";

type Severity = "down" | "disrupted" | "maintenance" | "notice";
const asSeverity = (s: string): Severity =>
  s === "down" || s === "disrupted" || s === "maintenance" ? s : "notice";
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

/** Local clock time with a short zone label ("16:45 CEST"). */
function localTime(iso: string, language: string) {
  return new Date(iso).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

function countdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** **bold** markers → <strong>, blank lines → paragraphs. */
function BodyText({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim() !== "")
        .map((p, i) => (
          <p key={i} className="status-body">
            {p.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <strong key={j}>{part.slice(2, -2)}</strong>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
          </p>
        ))}
    </>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const [liveDir, setLiveDir] = useState<string | null>(null);
  const [customDir, setCustomDir] = useState("");
  const [liveDirError, setLiveDirError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "blueprint" | "refinery_completed">("all");
  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [pairCode, setPairCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [watching, setWatching] = useState(false);
  const [watcherError, setWatcherError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<LogEvent[]>([]);
  const [liveSynced, setLiveSynced] = useState(0);
  const liveSyncedRef = useRef(0);

  const [status, setStatus] = useState<RsiStatus | null>(null);
  const [statusCollapsed, setStatusCollapsed] = useState<Set<string>>(() => new Set());
  const [statusDetails, setStatusDetails] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());
  const seenRef = useRef<Set<string>>(readSeen());

  const [hotkey, setHotkey] = useState<HotkeyInfo | null>(null);
  const [hotkeyDraft, setHotkeyDraft] = useState("");
  const [scanHotkeyDraft, setScanHotkeyDraft] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState<boolean | null>(null);
  const [kdeRule, setKdeRule] = useState<KdeRuleInfo | null>(null);
  const [kdeRuleError, setKdeRuleError] = useState<string | null>(null);

  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const updateStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    invoke<string | null>("detect_game_log").then(setLiveDir);
    invoke<ConnectionView>("get_connection").then(setConnection);
    invoke<boolean>("watcher_status").then(setWatching);
    // Errors (offline, rate-limited, odd tag) mean "no update info", never an update.
    invoke<UpdateCheck>("check_for_update").then(setUpdate).catch(() => {});
    invoke<AppVersion>("app_version").then(setAppVersion).catch(() => {});
    invoke<KdeRuleInfo>("overlay_kde_rule").then(setKdeRule).catch(() => {});
    invoke<HotkeyInfo>("overlay_hotkey")
      .then((h) => {
        setHotkey(h);
        setHotkeyDraft(h.hotkeys["status"] ?? "");
        setScanHotkeyDraft(h.hotkeys["scan"] ?? "");
      })
      .catch(() => {});

    const subs = [
      listen<LogEvent>("watcher-event", (e) =>
        setLiveEvents((prev) => [e.payload, ...prev].slice(0, 25)),
      ),
      listen<SyncSummary>("watcher-sync", (e) => {
        liveSyncedRef.current += e.payload.accepted;
        setLiveSynced(liveSyncedRef.current);
      }),
      listen<string>("watcher-sync-error", (e) => setWatcherError(e.payload)),
      listen<{ running: boolean }>("watcher-status", (e) => setWatching(e.payload.running)),
      listen<[string, boolean]>("overlay-visibility", (e) => {
        if (e.payload[0] === "status") setStatusOpen(e.payload[1]);
      }),
      listen<boolean>("overlay-kde-rule", (e) =>
        setKdeRule((prev) => ({ applicable: prev?.applicable ?? true, installed: e.payload })),
      ),
    ];
    return () => {
      subs.forEach((p) => p.then((un) => un()));
      if (updateStatusTimer.current) clearTimeout(updateStatusTimer.current);
    };
  }, []);

  // Poll the paired server for RSI maintenance/outage notices. A version
  // we have never seen fires a native notification — that is the "stow
  // your gear" alarm while the game has the screen.
  useEffect(() => {
    if (!connection?.paired) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await invoke<RsiStatus>("fetch_status");
        if (cancelled) return;
        setStatus(data);
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
        // Offline or server down: keep showing the last known state.
      }
    };
    void poll();
    const id = setInterval(() => void poll(), STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [connection?.paired, t, i18n.language]);

  const activeIncidents = status?.active ?? [];
  const ticking = activeIncidents.some(
    (i) => i.shutdown_at && new Date(i.shutdown_at).getTime() > Date.now(),
  );
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  const toggleSet = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const [overlayError, setOverlayError] = useState<string | null>(null);
  const toggleStatusWindow = async () => {
    setOverlayError(null);
    try {
      setStatusOpen(await invoke<boolean>("overlay_toggle", { name: "status" }));
    } catch (e) {
      setOverlayError(String(e));
    }
  };

  const setKdeRuleInstalled = async (install: boolean) => {
    setKdeRuleError(null);
    try {
      setKdeRule(await invoke<KdeRuleInfo>("overlay_set_kde_rule", { install }));
    } catch (e) {
      setKdeRuleError(String(e));
    }
  };

  const saveHotkey = async (action: "status" | "scan", value: string) => {
    setHotkeyError(null);
    try {
      const info = await invoke<HotkeyInfo>("overlay_set_hotkey", { action, hotkey: value });
      setHotkey(info);
      setHotkeyDraft(info.hotkeys["status"] ?? "");
      setScanHotkeyDraft(info.hotkeys["scan"] ?? "");
    } catch (e) {
      setHotkeyError(String(e));
    }
  };

  const scanNow = async () => {
    setScanError(null);
    try {
      await invoke("overlay_show", { name: "scan" }).catch(() => {});
      await invoke("scan_now");
    } catch (e) {
      setScanError(String(e));
    }
  };

  const checkForUpdate = async () => {
    if (updateStatusTimer.current) clearTimeout(updateStatusTimer.current);
    setUpdateStatus("checking");
    try {
      const info = await invoke<UpdateCheck>("check_for_update");
      setUpdate(info);
      if (info.update_available) {
        setUpdateDismissed(false);
        setUpdateStatus("idle");
        return;
      }
      setUpdateStatus("upToDate");
    } catch {
      setUpdateStatus("failed");
    }
    updateStatusTimer.current = setTimeout(() => setUpdateStatus("idle"), 5000);
  };

  const openReleasePage = () => {
    const url = update?.url || "https://github.com/ulrichdahl/StarBuddy/releases/latest";
    openUrl(url).catch(() => {});
  };

  const toggleWatcher = async () => {
    setWatcherError(null);
    try {
      if (watching) {
        await invoke("stop_watcher");
      } else {
        await invoke("start_watcher", { liveDir: customDir || liveDir });
        setWatching(true);
      }
    } catch (e) {
      setWatcherError(String(e));
    }
  };

  // Native folder picker for when auto-detection fails (or picked the wrong one).
  const browseForInstallation = async () => {
    setLiveDirError(null);
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: t("scan.browseTitle") });
      if (typeof picked !== "string") return;
      const live = await invoke<string>("set_live_dir", { path: picked });
      setLiveDir(live);
      setCustomDir("");
    } catch (e) {
      setLiveDirError(String(e));
    }
  };

  const pair = async () => {
    setPairing(true);
    setPairError(null);
    try {
      setConnection(await invoke<ConnectionView>("pair_device", { serverUrl, code: pairCode }));
      setPairCode("");
    } catch (e) {
      setPairError(String(e));
    } finally {
      setPairing(false);
    }
  };

  const sync = async () => {
    if (!result) return;
    setSyncing(true);
    setSyncError(null);
    setSyncResult(null);
    try {
      setSyncResult(await invoke<SyncSummary>("sync_events", { events: result.events }));
    } catch (e) {
      setSyncError(String(e));
    } finally {
      setSyncing(false);
    }
  };

  const scan = async (dir: string) => {
    setScanning(true);
    setProgress(null);
    setError(null);
    const onProgress = new Channel<ScanProgress>();
    onProgress.onmessage = setProgress;
    try {
      setResult(await invoke<ScanResult>("scan_backlog", { liveDir: dir, onProgress }));
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
      setProgress(null);
    }
  };

  const events = result?.events.filter((e) => filter === "all" || e.kind === filter) ?? [];
  const blueprintCount = result?.events.filter((e) => e.kind === "blueprint").length ?? 0;
  const refineryCount = (result?.events.length ?? 0) - blueprintCount;

  const kindLabel = (kind: LogEvent["kind"]) =>
    kind === "blueprint" ? t("events.kindBlueprint") : t("events.kindRefineryDone");

  return (
    <main className="container">
      <div className="brand">
        <img src="/logo.svg" alt="" aria-hidden width="40" height="40" />
        <div>
          <h1>StarBuddy</h1>
          <p className="tagline">{t("header.tagline")}</p>
        </div>
        <select
          className="locale-select"
          aria-label={t("header.language")}
          title={t("header.language")}
          value={i18n.language}
          onChange={(e) => setLocale(e.target.value as Locale)}
        >
          {SUPPORTED_LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_NAMES[code]}
            </option>
          ))}
        </select>
      </div>

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
              <p className={`status-countdown mono${urgent ? " big" : ""}`}>
                {timing}
                {urgent && shutdownTime && <span className="hint"> ({shutdownTime})</span>}
              </p>
            )}
            {urgent && <p className="status-stow">{t("status.stow")}</p>}
            {details && <BodyText text={incident.body_text} />}
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

      {update?.update_available && !updateDismissed && (
        <div className="update-banner" role="status">
          <p>{t("update.available", { latest: update.latest, current: update.current })}</p>
          <button onClick={openReleasePage}>{t("update.download")}</button>
          <button
            className="dismiss"
            onClick={() => setUpdateDismissed(true)}
            aria-label={t("update.dismiss")}
            title={t("update.dismiss")}
          >
            ×
          </button>
        </div>
      )}

      <section className="panel">
        <h2>{t("server.title")}</h2>
        {connection?.paired ? (
          <div className="row">
            <p style={{ flex: 1 }}>
              {t("server.pairedAs")} <strong>{connection.user_name}</strong> ·{" "}
              <code>{connection.server_url}</code>
            </p>
            <button onClick={() => invoke<ConnectionView>("unpair").then(setConnection)}>
              {t("server.unpair")}
            </button>
          </div>
        ) : (
          <>
            <p className="hint">{t("server.hint")}</p>
            <div className="row">
              <input
                type="text"
                placeholder="https://starbuddy.example.org"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
              />
              <input
                type="text"
                placeholder={t("server.pairingCodePlaceholder")}
                style={{ maxWidth: 160, flex: "0 1 auto" }}
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value.toUpperCase())}
              />
              <button disabled={pairing || !serverUrl || !pairCode} onClick={pair}>
                {pairing ? t("server.pairing") : t("server.pair")}
              </button>
            </div>
            {pairError && <p className="error">{pairError}</p>}
          </>
        )}
      </section>

      <section className="panel">
        <h2>{t("overlay.panelTitle")}</h2>
        <p className="hint">{t("overlay.panelHint")}</p>
        <div className="row">
          <button onClick={toggleStatusWindow}>
            {statusOpen ? t("overlay.hideStatus") : t("overlay.showStatus")}
          </button>
          <input
            type="text"
            aria-label={t("overlay.hotkeyStatus")}
            placeholder="F6"
            style={{ maxWidth: 160, flex: "0 1 auto" }}
            value={hotkeyDraft}
            onChange={(e) => setHotkeyDraft(e.target.value)}
          />
          <button
            disabled={!hotkey || hotkeyDraft.trim() === (hotkey.hotkeys["status"] ?? "")}
            onClick={() => saveHotkey("status", hotkeyDraft)}
          >
            {t("overlay.saveHotkey")}
          </button>
        </div>
        <div className="row">
          <button onClick={scanNow}>{t("overlay.scanNow")}</button>
          <input
            type="text"
            aria-label={t("overlay.hotkeyScan")}
            placeholder="F7"
            style={{ maxWidth: 160, flex: "0 1 auto" }}
            value={scanHotkeyDraft}
            onChange={(e) => setScanHotkeyDraft(e.target.value)}
          />
          <button
            disabled={!hotkey || scanHotkeyDraft.trim() === (hotkey.hotkeys["scan"] ?? "")}
            onClick={() => saveHotkey("scan", scanHotkeyDraft)}
          >
            {t("overlay.saveHotkey")}
          </button>
        </div>
        <p className="hint">{t("overlay.scanHint")}</p>
        {scanError && <p className="error">{scanError}</p>}
        {overlayError && <p className="error">{overlayError}</p>}
        {hotkeyError && <p className="error">{hotkeyError}</p>}
        {hotkey && !hotkey.global_supported && (
          <p className="hint">
            {t("overlay.waylandHint")} <code>{hotkey.toggle_command}</code>
          </p>
        )}
        {!connection?.paired && <p className="hint">{t("overlay.pairHint")}</p>}
        {kdeRule?.applicable && (
          <div className="row">
            <p className="hint" style={{ flex: 1, margin: 0 }}>
              {kdeRule.installed ? t("overlay.kdeRuleInstalled") : t("overlay.kdeRuleMissing")}
            </p>
            <button onClick={() => setKdeRuleInstalled(!kdeRule.installed)}>
              {kdeRule.installed ? t("overlay.kdeRuleRemove") : t("overlay.kdeRuleInstall")}
            </button>
          </div>
        )}
        {kdeRuleError && <p className="error">{kdeRuleError}</p>}
      </section>

      <section className="panel">
        <h2>{t("scan.title")}</h2>
        {liveDir ? (
          <div className="row">
            <p style={{ flex: 1, margin: 0 }}>
              {t("scan.detected")} <code>{liveDir}</code>
            </p>
            <button onClick={browseForInstallation}>{t("scan.browseChange")}</button>
          </div>
        ) : (
          <div className="row">
            <p style={{ flex: 1, margin: 0 }}>{t("scan.notDetected")}</p>
            <button onClick={browseForInstallation}>{t("scan.browse")}</button>
          </div>
        )}
        {liveDirError && <p className="error">{liveDirError}</p>}
        <div className="row">
          <input
            type="text"
            placeholder={t("scan.dirPlaceholder")}
            value={customDir}
            onChange={(e) => setCustomDir(e.target.value)}
          />
          <button
            disabled={scanning || (!customDir && !liveDir)}
            onClick={() => scan(customDir || liveDir!)}
          >
            {scanning ? t("scan.scanning") : t("scan.scanButton")}
          </button>
        </div>
        {scanning && (
          <div className="progress">
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: progress ? `${Math.round((progress.current / progress.total) * 100)}%` : "0%",
                }}
              />
            </div>
            <p className="hint mono">
              {progress
                ? t("scan.progress", {
                    current: progress.current,
                    total: progress.total,
                    file: progress.file,
                  })
                : t("scan.preparing")}
            </p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="panel">
        <h2>{t("watcher.title")}</h2>
        <div className="row">
          <p style={{ flex: 1, margin: 0 }} className={watching ? "" : "hint"}>
            {watching
              ? t("watcher.watching", {
                  synced: liveSynced ? t("watcher.syncedThisSession", { count: liveSynced }) : "",
                })
              : t("watcher.notWatching")}
          </p>
          <button disabled={!liveDir && !customDir} onClick={toggleWatcher}>
            {watching ? t("watcher.stop") : t("watcher.start")}
          </button>
        </div>
        {watcherError && <p className="error">{watcherError}</p>}
        {liveEvents.length > 0 && (
          <table>
            <tbody>
              {liveEvents.map((e, i) => (
                <tr key={`${e.timestamp}-${i}`}>
                  <td className="mono">{e.timestamp.replace("T", " ").slice(11, 19)}</td>
                  <td>{kindLabel(e.kind)}</td>
                  <td>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {result && (
        <section className="panel">
          <h2>
            {[
              t("events.logFiles", { count: result.files_scanned }),
              t("events.blueprints", { count: blueprintCount }),
              t("events.refineryCompletions", { count: refineryCount }),
            ].join(t("common.separator"))}
          </h2>
          <div className="row">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
              {t("events.filterAll")}
            </button>
            <button
              className={filter === "blueprint" ? "active" : ""}
              onClick={() => setFilter("blueprint")}
            >
              {t("events.filterBlueprints")}
            </button>
            <button
              className={filter === "refinery_completed" ? "active" : ""}
              onClick={() => setFilter("refinery_completed")}
            >
              {t("events.filterRefinery")}
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>{t("events.colTime")}</th>
                <th>{t("events.colEvent")}</th>
                <th>{t("events.colDetail")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="mono">{e.timestamp.replace("T", " ").slice(0, 19)}</td>
                  <td>{kindLabel(e.kind)}</td>
                  <td>
                    {e.detail}
                    {e.item_class && <span className="hint mono"> · {e.item_class}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button
              disabled={!connection?.paired || syncing || result.events.length === 0}
              onClick={sync}
            >
              {syncing
                ? t("events.syncing", { count: result.events.length })
                : t("events.syncButton", { count: result.events.length })}
            </button>
            {!connection?.paired && <p className="hint">{t("events.pairToSync")}</p>}
          </div>
          {syncResult && (
            <p className="hint">
              {t("events.syncResult", {
                accepted: t("events.syncAccepted", { count: syncResult.accepted }),
                duplicates: t("events.syncDuplicates", { count: syncResult.duplicates }),
                blueprints: t("events.syncBlueprintsAdded", { count: syncResult.blueprints_added }),
                refinery: t("events.syncRefineryRecorded", { count: syncResult.refinery_completed }),
                backfilled: syncResult.backfilled
                  ? t("events.syncBackfilled", { count: syncResult.backfilled })
                  : "",
              })}
            </p>
          )}
          {syncError && <p className="error">{syncError}</p>}
        </section>
      )}

      <footer className="fansite">
        <a href="https://robertsspaceindustries.com/" target="_blank" rel="noopener" aria-label="Star Citizen — Made by the Community">
          <img src="/made-by-the-community.svg" alt="Star Citizen — Made by the Community" width="64" height="64" />
        </a>
        <div>
          <p className="credit">
            {t("footer.creditPrefix")}{" "}
            <button className="link-button" onClick={() => openUrl("https://uniteddanes.org").catch(() => {})}>United Danes</button>
            {t("footer.creditMiddle")}{" "}
            <button className="link-button" onClick={() => openUrl("https://robertsspaceindustries.com/citizens/DK-Raven").catch(() => {})}>DK-Raven</button>
            {" "}{t("footer.creditWith")}{" "}
            <button className="link-button" onClick={() => openUrl("https://claude.ai").catch(() => {})}>Claude.ai</button>.
          </p>
          <p>
            {t("footer.disclaimer")}{" "}
            <a href="https://robertsspaceindustries.com/" target="_blank" rel="noopener">robertsspaceindustries.com</a>
          </p>
          <p className="hint">
            {t("footer.trademark")}{" "}
            <a href="https://github.com/ulrichdahl/StarBuddy" target="_blank" rel="noopener">{t("footer.source")}</a>.
          </p>
          <p className="hint update-row">
            {appVersion && (
              <span className="mono">
                {appVersion.build
                  ? t("update.versionBuild", { version: appVersion.version, build: appVersion.build })
                  : t("update.version", { version: appVersion.version })}
              </span>
            )}
            <button
              className="link-button"
              onClick={checkForUpdate}
              disabled={updateStatus === "checking"}
            >
              {updateStatus === "checking" ? t("update.checking") : t("update.check")}
            </button>
            {updateStatus === "upToDate" && update && (
              <span role="status">{t("update.upToDate", { current: update.current })}</span>
            )}
            {updateStatus === "failed" && <span role="status">{t("update.failed")}</span>}
          </p>
        </div>
      </footer>
    </main>
  );
}

export default App;
