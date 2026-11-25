import { invoke } from "@tauri-apps/api/core";

/**
 * New features announced on Home, each a question the player has not
 * answered yet. While any is waiting, the window opens on Home, whatever page
 * it was left on, so the player sees it. Add a check here for each new one.
 */
const WAITING: Array<() => Promise<boolean>> = [
  // The beacon window's user.cfg lines (TelemetryPanel.tsx).
  async () => {
    const lines = await invoke<{ telemetry: boolean | null; display_info: boolean | null }>("game_lines_get");
    return lines.telemetry === null || lines.display_info === null;
  },
];

/** Whether Home has something new for the player. */
export async function newsWaiting(): Promise<boolean> {
  const answers = await Promise.all(WAITING.map((check) => check().catch(() => false)));
  return answers.some(Boolean);
}
