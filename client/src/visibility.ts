import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

// Same lookup as main.tsx: the init-script global, or the query string in dev.
const windowName = () => window.__STARBUDDY_WINDOW__ ?? new URLSearchParams(window.location.search).get("window");

/**
 * Whether anyone can see this page. Overlays are hidden by Rust, not
 * destroyed, and a hidden webview does not reliably report
 * `document.hidden` — so inside an overlay the `overlay-visibility` event
 * for this window's own name counts as well. Until one arrives, the window
 * is taken to be visible.
 */
export function usePageVisible(): boolean {
  const [docVisible, setDocVisible] = useState(() => !document.hidden);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const onChange = () => setDocVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  useEffect(() => {
    const name = windowName();
    if (!name) return;
    const un = listen<[string, boolean]>("overlay-visibility", (e) => {
      if (e.payload[0] === name) setShown(e.payload[1]);
    }).catch((): (() => void) => {
      // Not hearing it leaves `document.hidden` as the only signal, which is
      // what this falls back to anyway.
      return () => {};
    });
    return () => void un.then((f) => f());
  }, []);

  return docVisible && shown;
}
