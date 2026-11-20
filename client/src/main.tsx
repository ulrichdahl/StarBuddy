import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import "./base.css";

// Overlay windows load the same entry; the Rust side names the window
// through an init-script global (the query string only survives in dev).
// Each window is its own chunk, so an overlay never parses the main window's
// code or App.css, and the main window never parses the overlays'.
declare global {
  interface Window {
    __STARBUDDY_WINDOW__?: string;
    /** Which capture area the region selector is framing. */
    __STARBUDDY_PURPOSE__?: string;
    /** STARBUDDY_DEBUG_BOUNDS=1: outline the window, painted or not. */
    __STARBUDDY_DEBUG_BOUNDS__?: boolean;
  }
}
const overlay = window.__STARBUDDY_WINDOW__ ?? new URLSearchParams(window.location.search).get("window");

// Every overlay window is a transparent sheet over the game, but the app's own
// body paints an opaque near-black background. The class that clears it is set
// here rather than by each window, because a window that forgets it is not
// subtly wrong — it is a black rectangle over the whole screen, which is what
// the region selector was.
if (overlay) document.documentElement.classList.add("overlay-mode");

const App = lazy(() => import("./App"));
const WINDOWS: Record<string, React.LazyExoticComponent<React.ComponentType>> = {
  status: lazy(() => import("./overlay/StatusOverlay").then((m) => ({ default: m.StatusOverlay }))),
  scan: lazy(() => import("./overlay/ScanOverlay").then((m) => ({ default: m.ScanOverlay }))),
  refinery: lazy(() => import("./overlay/RefineryOverlay").then((m) => ({ default: m.RefineryOverlay }))),
  pools: lazy(() => import("./overlay/TrackerOverlays").then((m) => ({ default: m.PoolsOverlay }))),
  gathering: lazy(() => import("./overlay/TrackerOverlays").then((m) => ({ default: m.GatheringOverlay }))),
  orders: lazy(() => import("./overlay/TrackerOverlays").then((m) => ({ default: m.OrdersOverlay }))),
  points: lazy(() => import("./overlay/TrackerOverlays").then((m) => ({ default: m.PointsOverlay }))),
  region: lazy(() => import("./overlay/RegionSelector").then((m) => ({ default: m.RegionSelector }))),
};
const Root = (overlay && WINDOWS[overlay]) || App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </React.StrictMode>,
);
