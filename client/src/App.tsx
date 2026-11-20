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
import { useWatcher, WatcherPanel } from "./main-window/WatcherPanel";
import { Home } from "./main-window/Home";
import { Refinery } from "./main-window/Refinery";
import { Tools } from "./main-window/Tools";
import { Settings, useSettingsTab } from "./main-window/Settings";
import { ComingSoon, COMING_SOON, Shell, useSection } from "./main-window/Shell";
import type { ConnectionView, ScanResult, UpdateCheck } from "./main-window/types";
import "./theme.css";
import "./App.css";

/**
 * The main window: the frame and its sections, each section the panels that
 * belong to it. What more than one panel needs — the pairing, the game folder,
 * the scan's result and the update on offer — is kept here and handed down,
 * so it outlives a change of section.
 */
function App() {
  const { t, i18n } = useTranslation();
  const [section, setSection] = useSection();
  const [settingsTab, setSettingsTab] = useSettingsTab();
  const [version, setVersion] = useState<string | null>(null);
  const [liveDir, setLiveDir] = useState<string | null>(null);
  const [customDir, setCustomDir] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const watcher = useWatcher(liveDir, customDir);
  const canStart = Boolean(liveDir || customDir);

  useEffect(() => {
    // Errors (offline, rate-limited, odd tag) mean "no update info", never an update.
    invoke<UpdateCheck>("check_for_update").then(setUpdate).catch(() => {});
    invoke<{ version: string }>("app_version").then((v) => setVersion(v.version)).catch(() => {});
  }, []);

  const onUpdate = (info: UpdateCheck, offered: boolean) => {
    setUpdate(info);
    if (offered) setUpdateDismissed(false);
  };

  const paired = Boolean(connection?.paired);
  let body;
  if (COMING_SOON.has(section)) {
    body = <ComingSoon section={section} />;
  } else if (section === "home") {
    body = (
      <>
        <IncidentBanner />
        <UpdateBanner update={update} dismissed={updateDismissed} onDismiss={() => setUpdateDismissed(true)} />
        <Home watcher={watcher} canStart={canStart} onSection={setSection} />
      </>
    );
  } else if (section === "refinery") {
    body = <Refinery onSection={setSection} />;
  } else if (section === "tools") {
    body = <Tools connection={connection} />;
  } else {
    body = (
      <Settings
        tab={settingsTab}
        onTab={setSettingsTab}
        panels={{
          hotkeys: <OverlayPanel paired={paired} part="hotkeys" />,
          game: (
            <>
              <GameFolderPanel
                liveDir={liveDir}
                onLiveDir={setLiveDir}
                customDir={customDir}
                onCustomDir={setCustomDir}
                onResult={setResult}
              />
              <WatcherPanel watcher={watcher} canStart={canStart} />
              {result && <EventsTable result={result} paired={paired} />}
            </>
          ),
          reading: <OverlayPanel paired={paired} part="reading" />,
          account: <ServerPanel connection={connection} onConnection={setConnection} />,
          language: (
            <section className="panel">
              <h2>{t("header.language")}</h2>
              <select
                className="locale-select"
                aria-label={t("header.language")}
                value={i18n.language}
                onChange={(e) => setLocale(e.target.value as Locale)}
              >
                {SUPPORTED_LOCALES.map((code) => (
                  <option key={code} value={code}>
                    {LOCALE_NAMES[code]}
                  </option>
                ))}
              </select>
            </section>
          ),
          updates: (
            <>
              <UpdateBanner update={update} dismissed={updateDismissed} onDismiss={() => setUpdateDismissed(true)} />
              <ChangesPanel />
              <Footer update={update} onUpdate={onUpdate} />
            </>
          ),
          diagnostics: <OverlayPanel paired={paired} part="diagnostics" />,
        }}
      />
    );
  }

  return (
    <Shell section={section} onSection={setSection} version={version}>
      {body}
    </Shell>
  );
}

export default App;
