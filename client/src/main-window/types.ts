// Shapes the main window's panels share with the client's commands.

import type { TFunction } from "i18next";

/** A game channel folder found on this machine. */
export interface GameChannel {
  /** LIVE, HOTFIX, PTU, … */
  name: string;
  path: string;
  /** When its Game.log was last written, unix milliseconds. */
  played_at: number | null;
  /** Whether detection may choose this one on its own. */
  automatic: boolean;
}

export interface ScanProgress {
  current: number;
  total: number;
  file: string;
}

export interface LogEvent {
  /** The last four are travel, sent for the org ranking and not listed. */
  kind: "blueprint" | "refinery_completed" | "mission_completed" | "quantum_arrived" | "vehicle_released" | "location" | "jurisdiction";
  timestamp: string;
  detail: string;
  item_class: string | null;
  file: string;
}

/** The kinds the client lists; the rest are only sent. */
export const SHOWN_KINDS: ReadonlySet<LogEvent["kind"]> = new Set(["blueprint", "refinery_completed", "mission_completed"]);
export const shown = (e: LogEvent) => SHOWN_KINDS.has(e.kind);

export interface ScanResult {
  live_dir: string;
  files_scanned: number;
  localization_entries: number;
  events: LogEvent[];
}

export interface ConnectionView {
  paired: boolean;
  server_url: string;
  user_name: string;
  /** The server refused this device's token (account deleted, device removed): sign in again. */
  rejected: boolean;
}

export interface SyncSummary {
  accepted: number;
  duplicates: number;
  blueprints_added: number;
  refinery_completed: number;
  /** Absent from a server that does not count missions. */
  missions_completed?: number;
  backfilled?: number;
  /** Travel events the server counted, and points scored; absent from older servers. */
  travel?: number;
  points?: number;
}

export interface AppVersion {
  version: string;
  build: string | null;
}

export interface UpdateCheck {
  current: string;
  build: string | null;
  latest: string;
  url: string;
  update_available: boolean;
  notes: string | null;
  latest_dev: string | null;
  dev_url: string | null;
  dev_update_available: boolean;
  dev_notes: string | null;
}

export interface Changes {
  channel: "release" | "dev";
  version: string;
  build: string | null;
  since: string | null;
  summary: string[];
  commits: string[];
}

export type UpdateStatus = "idle" | "checking" | "upToDate" | "failed";

export interface HotkeyInfo {
  /** action → shortcut, e.g. { status: "F6" } */
  hotkeys: Record<string, string>;
  /** Every action, with a key or not, in the order they are listed. */
  actions: string[];
  global_supported: boolean;
  toggle_command: string;
  /** action → why that shortcut is not registered, e.g. another app owns it. */
  failed: Record<string, string>;
  /** The actions whose shortcut is registered and waiting for a key. */
  live: string[];
  /** Windows, where a hotkey can be registered and still never arrive. */
  windows: boolean;
  /** The desktop holds the shortcuts but has put no key on them yet. */
  desktop_offered: boolean;
  /** The desktop delivers the hotkeys itself, and owns what they are set to. */
  desktop_owned: boolean;
  /** Command a desktop keybinding can run instead, with the action after it. */
  action_command: string;
  /** action → the key the desktop bound, when it is the one delivering. */
  triggers: Record<string, string>;
}

/** What the client can see of the game, and whether it is looking. */
export interface Reading {
  /** Frames are arriving from the chosen window. */
  on: boolean;
  /** Whether this machine can read the screen at all. */
  available: boolean;
  /** What is being read, in words. */
  source: string | null;
  error: string | null;
  /** Windows draws its own list of windows; elsewhere the desktop asks. */
  picks_from_list: boolean;
  /** Windows is drawing its yellow capture border round the game's window. */
  capture_border: boolean;
  /** The border is there because borderless capture was refused on this machine. */
  border_refused: boolean;
}

/** KWin window rule that keeps overlays above the fullscreen game (Linux/KDE). */
export interface KdeRuleInfo {
  applicable: boolean;
  installed: boolean;
}

export const kindLabel = (t: TFunction, kind: LogEvent["kind"]) =>
  kind === "blueprint" ? t("events.kindBlueprint") : kind === "mission_completed" ? t("events.kindMission") : t("events.kindRefineryDone");
