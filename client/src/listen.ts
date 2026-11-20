import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * A catch for `listen()`: say why the subscription failed where the section
 * shows its errors, and hand back an unlisten that does nothing, so the
 * effect's cleanup still runs and no rejection goes unhandled.
 */
export const listenFailed =
  (report: (message: string) => void) =>
  (e: unknown): UnlistenFn => {
    report(String(e));
    return () => {};
  };
