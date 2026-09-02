import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";
import { StatusOverlay } from "./overlay/StatusOverlay";
import { ScanOverlay } from "./overlay/ScanOverlay";
import { RefineryOverlay } from "./overlay/RefineryOverlay";
import { RegionSelector } from "./overlay/RegionSelector";

// Overlay windows load the same bundle; the Rust side names the window
// through an init-script global (the query string only survives in dev).
declare global {
  interface Window {
    __STARBUDDY_WINDOW__?: string;
    /** Which capture area the region selector is framing. */
    __STARBUDDY_PURPOSE__?: string;
  }
}
const overlay = window.__STARBUDDY_WINDOW__ ?? new URLSearchParams(window.location.search).get("window");

// Every overlay window is a transparent sheet over the game, but the app's own
// body paints an opaque near-black background. The class that clears it is set
// here rather than by each window, because a window that forgets it is not
// subtly wrong — it is a black rectangle over the whole screen, which is what
// the region selector was.
if (overlay) document.documentElement.classList.add("overlay-mode");

const WINDOWS: Record<string, () => React.ReactElement> = {
  status: () => <StatusOverlay />,
  scan: () => <ScanOverlay />,
  refinery: () => <RefineryOverlay />,
  region: () => <RegionSelector />,
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{(overlay && WINDOWS[overlay]?.()) ?? <App />}</React.StrictMode>,
);
