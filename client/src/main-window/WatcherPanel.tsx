import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { listenFailed } from "../listen";
import { kindLabel, type LogEvent, type SyncSummary } from "./types";

/** Following Game.log as it is written, and what that has sent so far. */
export function WatcherPanel({ liveDir, customDir }: { liveDir: string | null; customDir: string }) {
  const { t } = useTranslation();
  const [watching, setWatching] = useState(false);
  const [watcherError, setWatcherError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<LogEvent[]>([]);
  const [liveSynced, setLiveSynced] = useState(0);
  const liveSyncedRef = useRef(0);

  useEffect(() => {
    invoke<boolean>("watcher_status")
      .then(setWatching)
      .catch((e) => setWatcherError(String(e)));

    const failed = listenFailed(setWatcherError);
    const subs = [
      listen<LogEvent>("watcher-event", (e) =>
        setLiveEvents((prev) => [e.payload, ...prev].slice(0, 25)),
      ).catch(failed),
      listen<SyncSummary>("watcher-sync", (e) => {
        liveSyncedRef.current += e.payload.accepted;
        setLiveSynced(liveSyncedRef.current);
      }).catch(failed),
      listen<string>("watcher-sync-error", (e) => setWatcherError(e.payload)).catch(failed),
      listen<{ running: boolean }>("watcher-status", (e) => setWatching(e.payload.running)).catch(failed),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, []);

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

  return (
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
                <td>{kindLabel(t, e.kind)}</td>
                <td>{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
