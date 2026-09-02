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
  build: string | null;
  latest: string;
  url: string;
  update_available: boolean;
  notes: string | null;
  latest_dev: string | null;
  dev_url: string | null;
  dev_update_available: boolean;
  dev_notes: string | null;
}

interface Changes {
  channel: "release" | "dev";
  version: string;
  build: string | null;
  since: string | null;
  summary: string[];
  commits: string[];
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
  // action → what is typed in its field. Seeded from the client's own
  // hotkey map so every action it knows about gets a row, including ones
  // added after this page was written.
  const [hotkeyDrafts, setHotkeyDrafts] = useState<Record<string, string>>({});
  const [captureStatus, setCaptureStatus] = useState<{ phase: string; detail: string } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanLive, setScanLive] = useState(false);
  const [logDir, setLogDir] = useState<string | null>(null);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState<boolean | null>(null);
  const [kdeRule, setKdeRule] = useState<KdeRuleInfo | null>(null);
  const [kdeRuleError, setKdeRuleError] = useState<string | null>(null);

  const [appVersion, setAppVersion] = useState<AppVersion | null>(null);
  const [changes, setChanges] = useState<Changes | null>(null);
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
    invoke<Changes>("app_changes").then(setChanges).catch(() => {});
    invoke<string>("log_dir").then(setLogDir).catch(() => {});
    invoke<boolean>("scan_live_running").then(setScanLive).catch(() => {});
    invoke<KdeRuleInfo>("overlay_kde_rule").then(setKdeRule).catch(() => {});
    invoke<HotkeyInfo>("overlay_hotkey")
      .then((h) => {
        setHotkey(h);
        setHotkeyDrafts(h.hotkeys);
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
      listen<boolean>("scan-live-state", (e) => setScanLive(e.payload)),
      // The training hotkey has no window of its own, so this line is the
      // only sign it did anything.
      listen<{ phase: string; detail: string }>("training-capture", (e) => setCaptureStatus(e.payload)),
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

  const saveHotkey = async (action: string, value: string) => {
    setHotkeyError(null);
    try {
      const info = await invoke<HotkeyInfo>("overlay_set_hotkey", { action, hotkey: value });
      setHotkey(info);
      setHotkeyDrafts(info.hotkeys);
    } catch (e) {
      setHotkeyError(String(e));
    }
  };

  /** The shortcut field and its save button, for one action. */
  const hotkeyField = (action: string, label: string, placeholder: string) => {
    const draft = hotkeyDrafts[action] ?? "";
    return (
      <>
        <input
          type="text"
          aria-label={label}
          placeholder={placeholder}
          style={{ maxWidth: 160, flex: "0 1 auto" }}
          value={draft}
          onChange={(e) => setHotkeyDrafts((prev) => ({ ...prev, [action]: e.target.value }))}
        />
        <button
          disabled={!hotkey || draft.trim() === (hotkey.hotkeys[action] ?? "")}
          onClick={() => saveHotkey(action, draft)}
        >
          {t("overlay.saveHotkey")}
        </button>
      </>
    );
  };

  // The same thing the training hotkey does, for checking it works without
  // the game in front of the window.
  const sendTrainingCapture = async () => {
    setCaptureStatus({ phase: "capturing", detail: "" });
    try {
      setCaptureStatus({ phase: "sent", detail: await invoke<string>("training_capture") });
    } catch (e) {
      setCaptureStatus({ phase: "error", detail: String(e) });
    }
  };

  const toggleLiveScan = async () => {
    setScanError(null);
    try {
      await invoke("overlay_show", { name: "scan" }).catch(() => {});
      setScanLive(await invoke<boolean>("scan_live_toggle"));
    } catch (e) {
      setScanError(String(e));
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
      if (info.update_available || info.dev_update_available) {
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

  // A live update always wins over a dev one.
  const offeredUpdate = update?.update_available ? "release" : update?.dev_update_available ? "dev" : null;
  const openReleasePage = () => {
    const url =
      (offeredUpdate === "dev" ? update?.dev_url : update?.url) || "https://github.com/ulrichdahl/StarBuddy/releases/latest";
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

  // A typed path is remembered the same way as a picked one (validated, saved).
  const applyTypedDir = async () => {
    const typed = customDir.trim();
    if (!typed || typed === liveDir) return;
    setLiveDirError(null);
    try {
      const live = await invoke<string>("set_live_dir", { path: typed });
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

      {update && offeredUpdate && !updateDismissed && (
        <div className="update-banner" role="status">
          <div style={{ flex: 1 }}>
            <p>
              {offeredUpdate === "dev"
                ? t("update.devAvailable", { latest: update.latest_dev, current: update.build })
                : t("update.available", { latest: update.latest, current: update.current })}
            </p>
            {(offeredUpdate === "dev" ? update.dev_notes : update.notes) && (
              <details className="update-notes">
                <summary>{t("update.notes")}</summary>
                <pre>{offeredUpdate === "dev" ? update.dev_notes : update.notes}</pre>
              </details>
            )}
          </div>
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
          {hotkeyField("status", t("overlay.hotkeyStatus"), "F6")}
        </div>
        <div className="row">
          <button onClick={toggleLiveScan}>{scanLive ? t("overlay.liveScanStop") : t("overlay.liveScanStart")}</button>
          <button onClick={scanNow}>{t("overlay.scanNow")}</button>
          {hotkeyField("scan", t("overlay.hotkeyScan"), "F7")}
        </div>
        <p className="hint">{t("overlay.scanHint")}</p>
        <div className="row">
          <button onClick={() => invoke("overlay_show", { name: "refinery" }).catch((e) => setOverlayError(String(e)))}>
            {t("overlay.showRefinery")}
          </button>
          {hotkeyField("refinery", t("overlay.hotkeyRefinery"), "F8")}
        </div>
        <p className="hint">{t("overlay.refineryHint")}</p>
        <div className="row">
          <button onClick={sendTrainingCapture}>{t("overlay.captureNow")}</button>
          {hotkeyField("capture", t("overlay.hotkeyCapture"), "F9")}
        </div>
        <p className="hint">{t("overlay.captureHint")}</p>
        {captureStatus && (
          <p className={captureStatus.phase === "error" ? "error" : "hint"}>
            {t(`overlay.capture.${captureStatus.phase}`, { detail: captureStatus.detail })}
          </p>
        )}
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
            onBlur={() => void applyTypedDir()}
            onKeyDown={(e) => e.key === "Enter" && void applyTypedDir()}
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

      {changes && (changes.summary.length > 0 || changes.commits.length > 0) && (
        <details className="panel changes">
          <summary>
            {changes.channel === "dev"
              ? t("changes.sinceLive", { count: changes.commits.length, version: (changes.since ?? "").replace(/^v/, "") })
              : t("changes.inVersion", { version: changes.version })}
          </summary>
          {changes.summary.length > 0 && (
            <>
              {changes.channel === "dev" && <p className="hint">{t("changes.summaryHint")}</p>}
              <ul>
                {changes.summary.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
          {changes.commits.length > 0 && (
            <>
              <p className="hint">{t("changes.commitsHint")}</p>
              <ul className="mono commits">
                {changes.commits.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </details>
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
            <button className="link-button" onClick={() => invoke("open_log_dir").catch(() => {})} title={logDir ?? undefined}>
              {t("update.openLog")}
            </button>
          </p>
        </div>
      </footer>
    </main>
  );
}

export default App;
