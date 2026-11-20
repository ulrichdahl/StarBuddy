import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { Reading } from "./types";

/**
 * Reading the game's window, and whether refinery reads go to training. Part
 * of the overlay panel's section rather than a section of its own: everything
 * else in it reads the game's window, and nothing reads it until this is on.
 */
export function ScreenReadingPanel({
  reading,
  onReading,
  onError,
}: {
  reading: Reading | null;
  onReading: (reading: Reading) => void;
  /** Where the overlay panel shows its errors; null clears it. */
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  /** Windows only: the open windows to choose the game from. */
  const [gameWindows, setGameWindows] = useState<string[]>([]);
  const [gameWindow, setGameWindow] = useState("");
  const [readingBusy, setReadingBusy] = useState(false);
  /** Whether F8 refinery reads go to the server for training; off by default. */
  const [shareTraining, setShareTraining] = useState(false);

  useEffect(() => {
    invoke<boolean>("training_sharing_get")
      .then(setShareTraining)
      .catch((e) => onError(String(e)));
    // Once, on mount: onError only hands the message up.
  }, []);

  // Reading the screen: off until switched on, and off again when asked. On
  // Windows the window is picked from the list below; on Wayland the desktop
  // asks, which is why nothing is picked here.
  const listGameWindows = () =>
    invoke<string[]>("screen_reading_windows")
      .then(setGameWindows)
      .catch(() => setGameWindows([]));

  // Windows: the list of open windows, and the one chosen last time.
  useEffect(() => {
    if (!reading?.picks_from_list) return;
    setGameWindow((chosen) => chosen || reading.source || "");
    if (!reading.on) void listGameWindows();
  }, [reading?.picks_from_list, reading?.on, reading?.source]);

  const toggleReading = async () => {
    onError(null);
    setReadingBusy(true);
    try {
      onReading(
        reading?.on
          ? await invoke<Reading>("screen_reading_stop")
          : await invoke<Reading>("screen_reading_start", { window: gameWindow || null }),
      );
    } catch (e) {
      onError(String(e));
    } finally {
      setReadingBusy(false);
    }
  };

  const toggleShareTraining = async (enabled: boolean) => {
    onError(null);
    try {
      await invoke("training_sharing_set", { enabled });
      setShareTraining(enabled);
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <>
      {/* Everything below this reads the game's window, and nothing reads it
          until this is on: the frames come from a stream the desktop itself
          shows as running. */}
      <div className="row">
        {reading?.picks_from_list && !reading.on && (
          <select
            className="locale-select"
            style={{ marginLeft: 0, flex: "1 1 240px" }}
            value={gameWindow}
            onChange={(e) => setGameWindow(e.target.value)}
            onMouseDown={() => void listGameWindows()}
          >
            <option value="">{t("overlay.readingPick")}</option>
            {gameWindows.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        )}
        <button
          className={reading?.on ? "active" : undefined}
          disabled={readingBusy || (reading?.picks_from_list && !reading.on && !gameWindow)}
          onClick={() => void toggleReading()}
        >
          {reading?.on ? t("overlay.readingStop") : t("overlay.readingStart")}
        </button>
      </div>
      {reading?.on && (
        <p className="hint">{t("overlay.readingOn", { source: reading.source ?? t("overlay.readingSourceUnknown") })}</p>
      )}
      {reading?.error && <p className="error">{reading.error}</p>}
      {/* Windows 10 draws a yellow border round whatever is being captured
          and offers no way to turn it off; Windows 11 does, and it is. */}
      {reading?.on && reading.capture_border && <p className="hint">{t("overlay.readingBorder")}</p>}
      {reading?.on && reading.border_refused && <p className="hint">{t("overlay.readingBorderRefused")}</p>}
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={shareTraining}
            onChange={(e) => void toggleShareTraining(e.target.checked)}
          />{" "}
          {t("reading.shareTraining")}
        </label>
      </div>
    </>
  );
}
