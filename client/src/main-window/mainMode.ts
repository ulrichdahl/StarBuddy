import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type MainMode = "window" | "overlay";

/** What the client says about the main window's mode (main_window.rs). */
export interface MainState {
  /** What the player chose. */
  mode: MainMode;
  /** What the window is now: the choice, unless the game is not running. */
  showing_as: MainMode;
  game_running: boolean;
}

/** The main window's mode, followed as the client changes it. */
export function useMainMode(): [MainState | null, (mode: MainMode) => Promise<void>] {
  const [state, setState] = useState<MainState | null>(null);
  useEffect(() => {
    invoke<MainState>("main_mode_get").then(setState).catch(() => {});
    const sub = listen<MainState>("main-mode", (e) => setState(e.payload)).catch(() => null);
    return () => void sub.then((un) => un?.());
  }, []);
  const choose = async (mode: MainMode) => setState(await invoke<MainState>("main_mode_set", { mode }));
  return [state, choose];
}
