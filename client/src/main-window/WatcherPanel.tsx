import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { listenFailed } from "../listen";
import { kindLabel, shown, type LogEvent, type SyncSummary } from "./types";

/** What following Game.log has seen and sent, and the switch for it. */
export interface Watcher {
  watching: boolean;
  error: string | null;
  /** Newest first, at most 25. */
  events: LogEvent[];
  /** Events the server accepted since the window opened. */
  synced: number;
  toggle: () => Promise<void>;
}

/**
 * Following Game.log as it is written. Held by the window rather than by a
 * panel, so events that arrive while another section is open are still there
 * when Home is shown again.
 */
export function useWatcher(liveDir: string | null, customDir: string): Watcher {
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [synced, setSynced] = useState(0);
  const syncedRef = useRef(0);

  useEffect(() => {
    invoke<boolean>("watcher_status")
      .then(setWatching)
      .catch((e) => setError(String(e)));

    const failed = listenFailed(setError);
    const subs = [
      listen<LogEvent>("watcher-event", (e) => shown(e.payload) && setEvents((prev) => [e.payload, ...prev].slice(0, 25))).catch(failed),
      listen<SyncSummary>("watcher-sync", (e) => {
        syncedRef.current += e.payload.accepted;
        setSynced(syncedRef.current);
      }).catch(failed),
      listen<string>("watcher-sync-error", (e) => setError(e.payload)).catch(failed),
      listen<{ running: boolean }>("watcher-status", (e) => setWatching(e.payload.running)).catch(failed),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, []);

  const toggle = async () => {
    setError(null);
    try {
      if (watching) {
        await invoke("stop_watcher");
      } else {
        await invoke("start_watcher", { liveDir: customDir || liveDir });
        setWatching(true);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  return { watching, error, events, synced, toggle };
}

/** The watcher's switch and the events it has seen. */
export function WatcherPanel({ watcher, canStart }: { watcher: Watcher; canStart: boolean }) {
  const { t } = useTranslation();
  const { watching, error: watcherError, events: liveEvents, synced: liveSynced, toggle: toggleWatcher } = watcher;

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
        <button disabled={!canStart && !watching} onClick={toggleWatcher}>
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
