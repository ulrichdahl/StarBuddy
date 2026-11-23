import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { LOCALE_NAMES, SUPPORTED_LOCALES, setLocale, type Locale } from "./i18n";
import { ChangesPanel } from "./main-window/ChangesPanel";
import { EventsTable } from "./main-window/EventsTable";
import { CreditsPanel } from "./main-window/CreditsPanel";
import { Footer } from "./main-window/Footer";
import { GameFolderPanel } from "./main-window/GameFolderPanel";
import { IncidentBanner } from "./main-window/IncidentBanner";
import { OpenAsPanel, OverlayPanel, PresencePanel, useDebugMode, useHeardHotkey } from "./main-window/OverlayPanel";
import { ServerPanel } from "./main-window/ServerPanel";
import { Setup, setupDone } from "./main-window/Setup";
import { UpdateBanner } from "./main-window/UpdateBanner";
import { useWatcher, WatcherPanel } from "./main-window/WatcherPanel";
import { Home } from "./main-window/Home";
import { Refinery } from "./main-window/Refinery";
import { Gathering } from "./main-window/Gathering";
import { Blueprints } from "./main-window/Blueprints";
import { Craft } from "./main-window/Craft";
import { Items } from "./main-window/Items";
import { Org } from "./main-window/Org";
import { Tools } from "./main-window/Tools";
import { Settings, useSettingsTab } from "./main-window/Settings";
import { useMainMode } from "./main-window/mainMode";
import type { HotkeyInfo } from "./main-window/types";
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
  const [mainState, setMainMode] = useMainMode();
  const [mainKey, setMainKey] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [liveDir, setLiveDir] = useState<string | null>(null);
  const [customDir, setCustomDir] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  // First-run setup: on the first start of a client that is not paired, and
  // again whenever Settings asks for it.
  const [setupOpen, setSetupOpen] = useState(false);
  const watcher = useWatcher(liveDir, customDir);
  const heard = useHeardHotkey();
  const debug = useDebugMode();
  const canStart = Boolean(liveDir || customDir);

  useEffect(() => {
    // Errors (offline, rate-limited, odd tag) mean "no update info", never an update.
    invoke<UpdateCheck>("check_for_update").then(setUpdate).catch(() => {});
    invoke<{ version: string }>("app_version").then((v) => setVersion(v.version)).catch(() => {});
    // The pairing, for every section that talks to the website, not only for
    // the Settings panel that changes it.
    invoke<ConnectionView>("get_connection")
      .then((c) => {
        setConnection(c);
        if (!c.paired && !setupDone()) setSetupOpen(true);
      })
      .catch(() => {});
    // The server can stop accepting this device at any time (account deleted,
    // device removed on the website); every page then sees it as unpaired.
    const conn = listen<ConnectionView>("connection-changed", (e) => setConnection(e.payload)).catch(() => null);
    const readKey = () => invoke<HotkeyInfo>("overlay_hotkey").then((h) => setMainKey(h.hotkeys.main ?? null)).catch(() => {});
    void readKey();
    // The footer names the key, so it follows a change made in Settings.
    const sub = listen("hotkeys-changed", () => void readKey()).catch(() => null);
    return () => {
      void sub.then((un) => un?.());
      void conn.then((un) => un?.());
    };
  }, []);

  const onUpdate = (info: UpdateCheck, offered: boolean) => {
    setUpdate(info);
    if (offered) setUpdateDismissed(false);
  };

  const paired = Boolean(connection?.paired);
  // Choosing a section in the frame leaves the setup.
  const goSection = (s: typeof section) => {
    setSetupOpen(false);
    setSection(s);
  };

  let body;
  if (setupOpen) {
    body = (
      <Setup
        connection={connection}
        onConnection={setConnection}
        liveDir={liveDir}
        onLiveDir={setLiveDir}
        heard={heard}
        onClose={() => {
          setSetupOpen(false);
          setSection("home");
        }}
      />
    );
  } else if (section === "gathering") {
    body = <Gathering paired={paired} onSection={setSection} />;
  } else if (section === "blueprints") {
    body = <Blueprints paired={paired} />;
  } else if (section === "craft") {
    body = <Craft paired={paired} />;
  } else if (section === "stash") {
    body = <Items paired={paired} />;
  } else if (section === "org") {
    body = <Org paired={paired} />;
  } else if (COMING_SOON.has(section)) {
    body = <ComingSoon section={section} />;
  } else if (section === "home") {
    body = (
      <>
        <IncidentBanner />
        <UpdateBanner update={update} dismissed={updateDismissed} onDismiss={() => setUpdateDismissed(true)} />
        <Home watcher={watcher} canStart={canStart} onSection={setSection} />
        <Footer part="credits" update={update} onUpdate={onUpdate} />
      </>
    );
  } else if (section === "refinery") {
    body = <Refinery paired={paired} />;
  } else if (section === "tools") {
    body = <Tools connection={connection} />;
  } else {
    body = (
      <Settings
        tab={settingsTab}
        onTab={setSettingsTab}
        panels={{
          hotkeys: <OverlayPanel paired={paired} part="hotkeys" debug={debug} />,
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
          general: (
            <>
              <OpenAsPanel mainState={mainState} onMainMode={setMainMode} />
              <ServerPanel connection={connection} onConnection={setConnection} />
              <section className="panel">
                <h2>{t("setup.panelTitle")}</h2>
                <div className="row">
                  <p className="hint" style={{ flex: 1, margin: 0 }}>
                    {t("setup.panelHint")}
                  </p>
                  <button onClick={() => setSetupOpen(true)}>{t("setup.reopen")}</button>
                </div>
              </section>
              <PresencePanel />
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
            </>
          ),
          updates: (
            <>
              <UpdateBanner update={update} dismissed={updateDismissed} onDismiss={() => setUpdateDismissed(true)} />
              <ChangesPanel />
              <Footer part="updates" update={update} onUpdate={onUpdate} />
            </>
          ),
          diagnostics: <OverlayPanel paired={paired} part="diagnostics" debug={debug} heard={heard} />,
          credits: <CreditsPanel />,
        }}
      />
    );
  }

  return (
    <Shell section={section} onSection={goSection} version={version} showingAs={mainState?.showing_as ?? "window"} mainKey={mainKey}>
      {connection?.rejected && !setupOpen && !(section === "settings" && settingsTab === "general") && (
        <div className="update-banner" role="alert">
          <p style={{ flex: 1, margin: 0 }}>{t("server.rejected")}</p>
          <button
            className="active"
            onClick={() => {
              setSettingsTab("general");
              goSection("settings");
            }}
          >
            {t("server.signInAgain")}
          </button>
        </div>
      )}
      {body}
    </Shell>
  );
}

export default App;
