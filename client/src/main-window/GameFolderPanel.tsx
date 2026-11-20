import { useEffect, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import type { GameChannel, ScanProgress, ScanResult } from "./types";

/** Where the game is installed, which channel to follow, and the backlog scan. */
export function GameFolderPanel({
  liveDir,
  onLiveDir,
  customDir,
  onCustomDir,
  onResult,
}: {
  liveDir: string | null;
  onLiveDir: (dir: string | null) => void;
  /** A path typed in, not yet applied. */
  customDir: string;
  onCustomDir: (dir: string) => void;
  onResult: (result: ScanResult) => void;
}) {
  const { t, i18n } = useTranslation();
  // The channel folders found on this machine: LIVE and HOTFIX, plus any test
  // channel installed, which is offered but never chosen on its own.
  const [channels, setChannels] = useState<GameChannel[]>([]);
  const [liveDirError, setLiveDirError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<string | null>("detect_game_log")
      .then(onLiveDir)
      .catch((e) => setLiveDirError(String(e)));
    invoke<GameChannel[]>("game_channels").then(setChannels).catch(() => setChannels([]));
    // Once, on mount: onLiveDir only hands the answer up.
  }, []);

  // Native folder picker for when auto-detection fails (or picked the wrong one).
  const browseForInstallation = async () => {
    setLiveDirError(null);
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: t("scan.browseTitle") });
      if (typeof picked !== "string") return;
      const live = await invoke<string>("set_live_dir", { path: picked });
      onLiveDir(live);
      onCustomDir("");
    } catch (e) {
      setLiveDirError(String(e));
    }
  };

  // Switching channel is the same act as browsing to one, so it is saved the
  // same way: the choice sticks until it is changed again.
  const chooseChannel = async (path: string) => {
    setLiveDirError(null);
    try {
      onLiveDir(await invoke<string>("set_live_dir", { path }));
      onCustomDir("");
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
      onLiveDir(live);
      onCustomDir("");
    } catch (e) {
      setLiveDirError(String(e));
    }
  };

  const scan = async (dir: string) => {
    setScanning(true);
    setProgress(null);
    setError(null);
    const onProgress = new Channel<ScanProgress>();
    onProgress.onmessage = setProgress;
    try {
      onResult(await invoke<ScanResult>("scan_backlog", { liveDir: dir, onProgress }));
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
      setProgress(null);
    }
  };

  return (
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
      {/* One button per channel installed. LIVE and HOTFIX are the two
          detection chooses between, by which was played last; a test channel
          is only ever reached by asking for it here. */}
      {channels.length > 1 && (
        <div className="row" style={{ flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
          <span className="muted">{t("scan.channels")}</span>
          {channels.map((channel) => (
            <button
              key={channel.path}
              className={channel.path === liveDir ? "chip on" : "chip"}
              title={`${channel.path}${channel.played_at ? ` · ${t("scan.played", { when: new Date(channel.played_at).toLocaleString(i18n.language) })}` : ` · ${t("scan.neverPlayed")}`}`}
              onClick={() => void chooseChannel(channel.path)}
            >
              {channel.name}
              {!channel.automatic && <span className="muted"> · {t("scan.manualOnly")}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <input
          type="text"
          placeholder={t("scan.dirPlaceholder")}
          value={customDir}
          onChange={(e) => onCustomDir(e.target.value)}
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
                // A folder with no log files reports a total of nothing.
                width:
                  progress && progress.total > 0
                    ? `${Math.round((progress.current / progress.total) * 100)}%`
                    : "0%",
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
  );
}
