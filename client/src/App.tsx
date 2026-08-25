import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
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

interface UpdateCheck {
  current: string;
  latest: string;
  url: string;
  update_available: boolean;
}

type UpdateStatus = "idle" | "checking" | "upToDate" | "failed";

function App() {
  const { t, i18n } = useTranslation();
  const [liveDir, setLiveDir] = useState<string | null>(null);
  const [customDir, setCustomDir] = useState("");
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
    ];
    return () => {
      subs.forEach((p) => p.then((un) => un()));
      if (updateStatusTimer.current) clearTimeout(updateStatusTimer.current);
    };
  }, []);

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
        <h2>{t("scan.title")}</h2>
        {liveDir ? (
          <p>
            {t("scan.detected")} <code>{liveDir}</code>
          </p>
        ) : (
          <p>{t("scan.notDetected")}</p>
        )}
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
          <p>
            {t("footer.disclaimer")}{" "}
            <a href="https://robertsspaceindustries.com/" target="_blank" rel="noopener">robertsspaceindustries.com</a>
          </p>
          <p className="hint">
            {t("footer.trademark")}{" "}
            <a href="https://github.com/ulrichdahl/StarBuddy" target="_blank" rel="noopener">{t("footer.source")}</a>.
          </p>
          <p className="hint update-row">
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
