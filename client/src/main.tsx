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

const WINDOWS: Record<string, () => React.ReactElement> = {
  status: () => <StatusOverlay />,
  scan: () => <ScanOverlay />,
  refinery: () => <RefineryOverlay />,
  region: () => <RegionSelector />,
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{(overlay && WINDOWS[overlay]?.()) ?? <App />}</React.StrictMode>,
);
