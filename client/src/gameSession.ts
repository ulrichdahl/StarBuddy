import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** What Game.log says about the session (game_session.rs). */
export interface GameSession {
  /** PUB on LIVE; PTU, EPTU, TECH-PREVIEW as they are. */
  environment: string | null;
  branch: string | null;
  running: boolean;
  location: string | null;
  location_code: string | null;
  ship: string | null;
  player: string | null;
}

/** The log calls LIVE "PUB"; players call it LIVE. */
export const environmentName = (env: string) => (env === "PUB" ? "LIVE" : env);

/**
 * The game session as the log watcher reads it: the client's answer at
 * mount, then each change as the log says it.
 */
export function useGameSession(): GameSession | null {
  const [session, setSession] = useState<GameSession | null>(null);
  useEffect(() => {
    let live = true;
    invoke<GameSession>("game_session")
      .then((s) => live && setSession((cur) => cur ?? s))
      .catch(() => {});
    const sub = listen<GameSession>("game-session", (e) => setSession(e.payload)).catch(() => null);
    return () => {
      live = false;
      void sub.then((un) => un?.());
    };
  }, []);
  return session;
}

/** Where the player is and in what, as one line; null when the log has not said. */
export const whereabouts = (s: GameSession | null) => [s?.location, s?.ship].filter(Boolean).join(" · ") || null;
