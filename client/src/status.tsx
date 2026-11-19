// ── RSI service status (server mirrors status.robertsspaceindustries.com) ──
// Shared by the main window and the status overlay, which both show it.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface StatusIncident {
  slug: string;
  title: string;
  severity: string;
  resolved: boolean;
  informational: boolean;
  affected: string[];
  body_text: string;
  shutdown_at: string | null;
  permalink: string | null;
  updated_at: string | null;
  version: string | null;
}

export interface RsiStatus {
  summary: string;
  systems: { name: string; status: string }[];
  fetched_at: string | null;
  status_url: string;
  active: StatusIncident[];
  recent: StatusIncident[];
}

/** What the client's status loop tells every window ("rsi-status"). */
export interface RsiStatusUpdate {
  paired: boolean;
  /** The last good answer; a failed fetch keeps it rather than blanking it. */
  status: RsiStatus | null;
  /** Why the latest fetch failed, if it did. */
  error: string | null;
  /** When `status` was fetched, unix milliseconds. */
  fetched_at: number | null;
}

/**
 * Follow the client's RSI status: the cached answer at once, then every
 * update. The client fetches for all windows, so none of them polls, and a
 * hidden overlay costs nothing. Returns the unsubscribe for an effect cleanup.
 */
export function onRsiStatus(handler: (update: RsiStatusUpdate) => void): () => void {
  let cancelled = false;
  // An event that lands before the cached answer is newer than it: keep the event.
  let heard = false;
  const unlisten = listen<RsiStatusUpdate>("rsi-status", (e) => {
    heard = true;
    if (!cancelled) handler(e.payload);
  }).catch((): (() => void) => {
    // No live updates to follow (the event permission is missing): the cached
    // answer below still arrives, and there is no section here to report to.
    return () => {};
  });
  invoke<RsiStatusUpdate>("rsi_status_latest")
    .then((update) => {
      if (!cancelled && !heard) handler(update);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    void unlisten.then((un) => un());
  };
}

export type Severity = "down" | "disrupted" | "maintenance" | "notice";
export const asSeverity = (s: string): Severity =>
  s === "down" || s === "disrupted" || s === "maintenance" ? s : "notice";

/** Local clock time with a short zone label ("16:45 CEST"). */
export function localTime(iso: string, language: string) {
  return new Date(iso).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
}

export function countdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** **bold** markers → <strong>, blank lines → paragraphs, at most `limit` of them. */
export function BodyText({ text, className, limit }: { text: string; className: string; limit?: number }) {
  return (
    <>
      {text
        .split(/\n{2,}/)
        .filter((p) => p.trim() !== "")
        .slice(0, limit)
        .map((p, i) => (
          <p key={i} className={className}>
            {p.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <strong key={j}>{part.slice(2, -2)}</strong>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
          </p>
        ))}
    </>
  );
}
