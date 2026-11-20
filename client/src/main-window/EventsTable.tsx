import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { kindLabel, shown, type LogEvent, type ScanResult, type SyncSummary } from "./types";

/** What the backlog scan found, filtered, and the button that sends it. */
export function EventsTable({ result, paired }: { result: ScanResult; paired: boolean }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"all" | LogEvent["kind"]>("all");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const sync = async () => {
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

  // Travel is sent with the rest but not listed.
  const listed = result.events.filter(shown);
  const events = listed.filter((e) => filter === "all" || e.kind === filter);
  const blueprintCount = listed.filter((e) => e.kind === "blueprint").length;
  const refineryCount = listed.filter((e) => e.kind === "refinery_completed").length;
  const missionCount = listed.filter((e) => e.kind === "mission_completed").length;
  const travelCount = result.events.length - listed.length;

  return (
    <section className="panel">
      <h2>
        {[
          t("events.logFiles", { count: result.files_scanned }),
          t("events.blueprints", { count: blueprintCount }),
          t("events.refineryCompletions", { count: refineryCount }),
          t("events.missions", { count: missionCount }),
          t("events.travel", { count: travelCount }),
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
        <button
          className={filter === "mission_completed" ? "active" : ""}
          onClick={() => setFilter("mission_completed")}
        >
          {t("events.filterMissions")}
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
              <td>{kindLabel(t, e.kind)}</td>
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
          disabled={!paired || syncing || result.events.length === 0}
          onClick={sync}
        >
          {syncing
            ? t("events.syncing", { count: result.events.length })
            : t("events.syncButton", { count: result.events.length })}
        </button>
        {!paired && <p className="hint">{t("events.pairToSync")}</p>}
      </div>
      {syncResult && (
        <p className="hint">
          {t("events.syncResult", {
            accepted: t("events.syncAccepted", { count: syncResult.accepted }),
            duplicates: t("events.syncDuplicates", { count: syncResult.duplicates }),
            blueprints: t("events.syncBlueprintsAdded", { count: syncResult.blueprints_added }),
            refinery: t("events.syncRefineryRecorded", { count: syncResult.refinery_completed }),
            missions: syncResult.missions_completed ? t("events.syncMissions", { count: syncResult.missions_completed }) : "",
            travel: syncResult.travel ? t("events.syncTravel", { count: syncResult.travel }) : "",
            points: syncResult.points ? t("events.syncPoints", { count: syncResult.points }) : "",
            backfilled: syncResult.backfilled
              ? t("events.syncBackfilled", { count: syncResult.backfilled })
              : "",
          })}
        </p>
      )}
      {syncError && <p className="error">{syncError}</p>}
    </section>
  );
}
