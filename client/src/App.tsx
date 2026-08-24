import { useEffect, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
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

function App() {
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

  useEffect(() => {
    invoke<string | null>("detect_game_log").then(setLiveDir);
    invoke<ConnectionView>("get_connection").then(setConnection);
  }, []);

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

  return (
    <main className="container">
      <h1>StarMaker</h1>
      <p className="tagline">Game.log watcher — P1 scaffold</p>

      <section className="panel">
        <h2>Server</h2>
        {connection?.paired ? (
          <div className="row">
            <p style={{ flex: 1 }}>
              Paired as <strong>{connection.user_name}</strong> ·{" "}
              <code>{connection.server_url}</code>
            </p>
            <button onClick={() => invoke<ConnectionView>("unpair").then(setConnection)}>
              Unpair
            </button>
          </div>
        ) : (
          <>
            <p className="hint">
              Sign in to your community's StarMaker website, generate a pairing code on the
              dashboard, and enter it here.
            </p>
            <div className="row">
              <input
                type="text"
                placeholder="https://starmaker.example.org"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
              />
              <input
                type="text"
                placeholder="Pairing code"
                style={{ maxWidth: 160, flex: "0 1 auto" }}
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value.toUpperCase())}
              />
              <button disabled={pairing || !serverUrl || !pairCode} onClick={pair}>
                {pairing ? "Pairing…" : "Pair"}
              </button>
            </div>
            {pairError && <p className="error">{pairError}</p>}
          </>
        )}
      </section>

      <section className="panel">
        <h2>Star Citizen installation</h2>
        {liveDir ? (
          <p>
            Detected: <code>{liveDir}</code>
          </p>
        ) : (
          <p>No installation auto-detected. Enter your LIVE folder path:</p>
        )}
        <div className="row">
          <input
            type="text"
            placeholder="…/StarCitizen/LIVE"
            value={customDir}
            onChange={(e) => setCustomDir(e.target.value)}
          />
          <button
            disabled={scanning || (!customDir && !liveDir)}
            onClick={() => scan(customDir || liveDir!)}
          >
            {scanning ? "Scanning…" : "Scan log history"}
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
                ? `Scanning file ${progress.current} of ${progress.total} — ${progress.file}`
                : "Preparing scan…"}
            </p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <section className="panel">
          <h2>
            {result.files_scanned} log files · {blueprintCount} blueprints ·{" "}
            {refineryCount} refinery completions
          </h2>
          <div className="row">
            <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
              All
            </button>
            <button
              className={filter === "blueprint" ? "active" : ""}
              onClick={() => setFilter("blueprint")}
            >
              Blueprints
            </button>
            <button
              className={filter === "refinery_completed" ? "active" : ""}
              onClick={() => setFilter("refinery_completed")}
            >
              Refinery
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Event</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i}>
                  <td className="mono">{e.timestamp.replace("T", " ").slice(0, 19)}</td>
                  <td>{e.kind === "blueprint" ? "Blueprint" : "Refinery done"}</td>
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
                ? `Syncing ${result.events.length} events…`
                : `Sync ${result.events.length} events to server`}
            </button>
            {!connection?.paired && <p className="hint">Pair with a server above to sync.</p>}
          </div>
          {syncResult && (
            <p className="hint">
              Server accepted {syncResult.accepted} new events ({syncResult.duplicates} already
              known): {syncResult.blueprints_added} blueprints added, {syncResult.refinery_completed}{" "}
              refinery completions recorded
              {syncResult.backfilled ? `, ${syncResult.backfilled} blueprint identities backfilled` : ""}.
            </p>
          )}
          {syncError && <p className="error">{syncError}</p>}
        </section>
      )}
    </main>
  );
}

export default App;
