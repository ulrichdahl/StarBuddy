import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";
import { StatusOverlay } from "./overlay/StatusOverlay";

// Overlay windows load the same bundle with ?window=<name>; everything
// else is the main window.
const overlay = new URLSearchParams(window.location.search).get("window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{overlay === "status" ? <StatusOverlay /> : <App />}</React.StrictMode>,
);
