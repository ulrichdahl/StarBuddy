import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { HotkeyCapture } from "../HotkeyCapture";
import { listenFailed } from "../listen";
import { KdeRuleRow } from "./KdeRuleRow";
import { ScreenReadingPanel } from "./ScreenReadingPanel";
import type { HotkeyInfo, Reading } from "./types";

/** The overlay windows, the hotkeys that drive them, and reading the screen. */
export function OverlayPanel({ paired }: { paired: boolean }) {
  const { t } = useTranslation();
  /** Whether the client is watching the game's window, and what it says about it. */
  const [reading, setReading] = useState<Reading | null>(null);
  const [hotkey, setHotkey] = useState<HotkeyInfo | null>(null);
  // action → what is typed in its field. Seeded from the client's own
  // hotkey map so every action it knows about gets a row, including ones
  // added after this page was written.
  const [captureStatus, setCaptureStatus] = useState<{ phase: string; detail: string } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanLive, setScanLive] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  /** The last hotkey that actually arrived, which says delivery works. */
  const [heardHotkey, setHeardHotkey] = useState<string | null>(null);
  /** Everything about this machine a bug report needs, when asked for. */
  const [report, setReport] = useState<string | null>(null);
  const [reportCopied, setReportCopied] = useState(false);
  const [statusOpen, setStatusOpen] = useState<boolean | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);

  useEffect(() => {
    invoke<boolean>("scan_live_running").then(setScanLive).catch(() => {});
    invoke<Reading>("screen_reading")
      .then(setReading)
      .catch((e) => setOverlayError(String(e)));
    invoke<HotkeyInfo>("overlay_hotkey")
      .then((h) => {
        setHotkey(h);
      })
      .catch((e) => setHotkeyError(String(e)));
    // The status window may have been left open last time and restored at
    // startup, before any visibility event this page could hear. Its saved
    // `open` is what the player asked for, which is what the button should
    // offer to undo — even once a long-hidden overlay has been torn down. An
    // event that lands first is newer, so it wins.
    invoke<{ open: boolean }>("overlay_prefs", { name: "status" })
      .then((prefs) => setStatusOpen((current) => current ?? prefs.open))
      .catch((e) => setOverlayError(String(e)));

    const overlayFailed = listenFailed(setOverlayError);
    const hotkeyFailed = listenFailed(setHotkeyError);
    const subs = [
      listen<[string, boolean]>("overlay-visibility", (e) => {
        if (e.payload[0] === "status") setStatusOpen(e.payload[1]);
      }).catch(overlayFailed),
      listen<boolean>("scan-live-state", (e) => setScanLive(e.payload)).catch(overlayFailed),
      // The hotkey switches reading on and off mid-game, so this page is not
      // the only thing that changes it.
      listen<Reading>("screen-reading", (e) => setReading(e.payload)).catch(overlayFailed),
      // The desktop answers about the hotkeys in its own time, and can change
      // them from its own settings afterwards.
      listen<string>("hotkey-fired", (e) => setHeardHotkey(e.payload)).catch(hotkeyFailed),
      listen("hotkeys-changed", () => {
        invoke<HotkeyInfo>("overlay_hotkey")
          .then(setHotkey)
          .catch((e) => setHotkeyError(String(e)));
      }).catch(hotkeyFailed),
      // The training hotkey has no window of its own, so this line is the
      // only sign it did anything.
      listen<{ phase: string; detail: string }>("training-capture", (e) => setCaptureStatus(e.payload)).catch(
        overlayFailed,
      ),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, []);

  const toggleStatusWindow = async () => {
    setOverlayError(null);
    try {
      setStatusOpen(await invoke<boolean>("overlay_toggle", { name: "status" }));
    } catch (e) {
      setOverlayError(String(e));
    }
  };

  const saveHotkey = async (action: string, value: string) => {
    setHotkeyError(null);
    try {
      const info = await invoke<HotkeyInfo>("overlay_set_hotkey", { action, hotkey: value });
      setHotkey(info);
    } catch (e) {
      setHotkeyError(String(e));
    }
  };

  // Hold the keys rather than type their names: a mistyped accelerator is a
  // hotkey that never fires and never says why.
  const hotkeyField = (action: string, label: string, _placeholder: string) => (
    <HotkeyCapture
      action={action}
      label={label}
      current={(hotkey?.desktop_owned ? hotkey.triggers[action] : undefined) ?? hotkey?.hotkeys[action] ?? ""}
      failed={hotkey?.failed?.[action] && t("overlay.hotkeyTaken", { detail: hotkey.failed[action] })}
      onCapture={(action, keys) => void saveHotkey(action, keys)}
    />
  );

  // The same thing the training hotkey does, for checking it works without
  // the game in front of the window.
  const sendTrainingCapture = async () => {
    setCaptureStatus({ phase: "capturing", detail: "" });
    try {
      setCaptureStatus({ phase: "sent", detail: await invoke<string>("training_capture") });
    } catch (e) {
      setCaptureStatus({ phase: "error", detail: String(e) });
    }
  };

  const toggleLiveScan = async () => {
    setScanError(null);
    try {
      await invoke("overlay_show", { name: "scan" }).catch(() => {});
      setScanLive(await invoke<boolean>("scan_live_toggle"));
    } catch (e) {
      setScanError(String(e));
    }
  };

  const scanNow = async () => {
    setScanError(null);
    try {
      await invoke("overlay_show", { name: "scan" }).catch(() => {});
      await invoke("scan_now");
    } catch (e) {
      setScanError(String(e));
    }
  };

  const systemReport = () => {
    setOverlayError(null);
    invoke<string>("system_report")
      .then((r) => {
        setReport(r);
        setReportCopied(false);
      })
      .catch((e) => setOverlayError(String(e)));
  };

  return (
    <section className="panel">
      <h2>{t("overlay.panelTitle")}</h2>
      <p className="hint">{t("overlay.panelHint")}</p>
      {/* On Windows a hotkey can register and still never fire, and no error
          is raised for either reason it happens. */}
      {/* "The hotkey does nothing" is two faults — a key that never reaches
          the client, and one that reaches it and fails at what it asks for.
          This line is the only thing on screen that tells them apart. */}
      {hotkey && (
        <p className="hint">
          {heardHotkey
            ? t("overlay.hotkeyHeard", { action: t(`overlay.hotkeyName.${heardHotkey}`) })
            : t("overlay.hotkeyNoneHeard", { count: hotkey.live.length })}
        </p>
      )}
      {hotkey?.windows && <p className="hint">{t("overlay.hotkeyWindows")}</p>}
      {/* Wayland: the compositor delivers the keys, so it is also the place
          they can be changed for good. */}
      {hotkey?.desktop_owned && <p className="hint">{t("overlay.hotkeyDesktop")}</p>}
      {/* KDE takes the shortcuts and leaves every one of them unset, so say
          where the keys are given out — and give the commands for a desktop
          that will not list them at all. */}
      {hotkey?.desktop_offered && !hotkey.desktop_owned && (
        <details className="update-notes">
          <summary>{t("overlay.hotkeyDesktopUnset")}</summary>
          <pre>
            {["status", "scan", "refinery", "capture", "reading"]
              .map((action) => `${hotkey.action_command}${action}`)
              .join("\n")}
          </pre>
        </details>
      )}
      <ScreenReadingPanel reading={reading} onReading={setReading} onError={setOverlayError} hotkeyField={hotkeyField} />
      <div className="row">
        <button onClick={toggleStatusWindow}>
          {statusOpen ? t("overlay.hideStatus") : t("overlay.showStatus")}
        </button>
        {hotkeyField("status", t("overlay.hotkeyStatus"), "F6")}
      </div>
      <div className="row">
        <button disabled={!reading?.on} onClick={toggleLiveScan}>
          {scanLive ? t("overlay.liveScanStop") : t("overlay.liveScanStart")}
        </button>
        <button disabled={!reading?.on} onClick={scanNow}>
          {t("overlay.scanNow")}
        </button>
        {hotkeyField("scan", t("overlay.hotkeyScan"), "F7")}
      </div>
      <p className="hint">{t("overlay.scanHint")}</p>
      <div className="row">
        <button onClick={() => invoke("overlay_show", { name: "refinery" }).catch((e) => setOverlayError(String(e)))}>
          {t("overlay.showRefinery")}
        </button>
        {hotkeyField("refinery", t("overlay.hotkeyRefinery"), "F8")}
      </div>
      <p className="hint">{t("overlay.refineryHint")}</p>
      <div className="row">
        <button disabled={!reading?.on} onClick={sendTrainingCapture}>
          {t("overlay.captureNow")}
        </button>
        {hotkeyField("capture", t("overlay.hotkeyCapture"), "F9")}
      </div>
      <p className="hint">{t("overlay.captureHint")}</p>
      {!reading?.on && <p className="hint">{t("overlay.readingNeeded")}</p>}
      {captureStatus && (
        <p className={captureStatus.phase === "error" ? "error" : "hint"}>
          {t(`overlay.capture.${captureStatus.phase}`, { detail: captureStatus.detail })}
        </p>
      )}
      {/* What to send when something here does not work. The answers are
          all things the client knows and nobody should have to dig a log
          file out of a hidden folder for. */}
      <div className="row">
        <button onClick={systemReport}>{t("overlay.report")}</button>
        {report && (
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(report)
                .then(() => setReportCopied(true))
                .catch(() => setReportCopied(false))
            }
          >
            {reportCopied ? t("overlay.reportCopied") : t("overlay.reportCopy")}
          </button>
        )}
      </div>
      {report && <pre className="report">{report}</pre>}
      {scanError && <p className="error">{scanError}</p>}
      {overlayError && <p className="error">{overlayError}</p>}
      {hotkeyError && <p className="error">{hotkeyError}</p>}
      {hotkey && !hotkey.global_supported && (
        <p className="hint">
          {t("overlay.waylandHint")} <code>{hotkey.toggle_command}</code>
        </p>
      )}
      {!paired && <p className="hint">{t("overlay.pairHint")}</p>}
      <KdeRuleRow />
    </section>
  );
}
