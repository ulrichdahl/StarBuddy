import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface LogEvent {
  kind: "blueprint" | "refinery_completed";
  timestamp: string;
  detail: string;
  file: string;
}

interface ScanResult {
  live_dir: string;
  files_scanned: number;
  events: LogEvent[];
}

function App() {
  const [liveDir, setLiveDir] = useState<string | null>(null);
  const [customDir, setCustomDir] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "blueprint" | "refinery_completed">("all");

  useEffect(() => {
    invoke<string | null>("detect_game_log").then(setLiveDir);
  }, []);

  const scan = async (dir: string) => {
    setScanning(true);
    setError(null);
    try {
      setResult(await invoke<ScanResult>("scan_backlog", { liveDir: dir }));
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
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
                  <td>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            Server sync arrives with the backend connection settings — this scaffold proves the
            local log pipeline.
          </p>
        </section>
      )}
    </main>
  );
}

export default App;
