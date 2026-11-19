import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { LOCALE_NAMES, SUPPORTED_LOCALES, setLocale, type Locale } from "./i18n";
import { ChangesPanel } from "./main-window/ChangesPanel";
import { EventsTable } from "./main-window/EventsTable";
import { Footer } from "./main-window/Footer";
import { GameFolderPanel } from "./main-window/GameFolderPanel";
import { IncidentBanner } from "./main-window/IncidentBanner";
import { OverlayPanel } from "./main-window/OverlayPanel";
import { ServerPanel } from "./main-window/ServerPanel";
import { UpdateBanner } from "./main-window/UpdateBanner";
import { WatcherPanel } from "./main-window/WatcherPanel";
import type { ConnectionView, ScanResult, UpdateCheck } from "./main-window/types";
import "./App.css";

/**
 * The main window: one panel per section, each owning what only it shows.
 * What more than one panel needs — the pairing, the game folder, the scan's
 * result and the update on offer — is kept here and handed down.
 */
function App() {
  const { t, i18n } = useTranslation();
  const [liveDir, setLiveDir] = useState<string | null>(null);
  const [customDir, setCustomDir] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  useEffect(() => {
    // Errors (offline, rate-limited, odd tag) mean "no update info", never an update.
    invoke<UpdateCheck>("check_for_update").then(setUpdate).catch(() => {});
  }, []);

  const onUpdate = (info: UpdateCheck, offered: boolean) => {
    setUpdate(info);
    if (offered) setUpdateDismissed(false);
  };

  return (
    <main className="container">
      <div className="brand">
        <img src="/logo.svg" alt="" aria-hidden width="40" height="40" />
        <div>
          <h1>StarBuddy</h1>
          <p className="tagline">{t("header.tagline")}</p>
        </div>
        <select
          className="locale-select"
          aria-label={t("header.language")}
          title={t("header.language")}
          value={i18n.language}
          onChange={(e) => setLocale(e.target.value as Locale)}
        >
          {SUPPORTED_LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_NAMES[code]}
            </option>
          ))}
        </select>
      </div>

      <IncidentBanner />

      <UpdateBanner update={update} dismissed={updateDismissed} onDismiss={() => setUpdateDismissed(true)} />

      <ServerPanel connection={connection} onConnection={setConnection} />

      <OverlayPanel paired={Boolean(connection?.paired)} />

      <GameFolderPanel
        liveDir={liveDir}
        onLiveDir={setLiveDir}
        customDir={customDir}
        onCustomDir={setCustomDir}
        onResult={setResult}
      />

      <WatcherPanel liveDir={liveDir} customDir={customDir} />

      {result && <EventsTable result={result} paired={Boolean(connection?.paired)} />}

      <ChangesPanel />

      <Footer update={update} onUpdate={onUpdate} />
    </main>
  );
}

export default App;
