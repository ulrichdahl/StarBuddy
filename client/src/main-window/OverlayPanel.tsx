import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { HotkeyCapture } from "../HotkeyCapture";
import { listenFailed } from "../listen";
import { KdeRuleRow } from "./KdeRuleRow";
import { ScreenReadingPanel } from "./ScreenReadingPanel";
import type { HotkeyInfo, Reading } from "./types";
import type { MainMode, MainState } from "./mainMode";

/** Which of the panel's three parts a Settings tab shows. */
export type OverlayPart = "hotkeys" | "reading" | "diagnostics";

/**
 * The overlay windows, the hotkeys that drive them, reading the screen, and
 * the report for when one of them does not work. One component because they
 * share what the client says about the hotkeys and the screen; Settings shows
 * each part under its own tab.
 */
export function OverlayPanel({
  paired,
  part,
  mainState,
  onMainMode,
}: {
  paired: boolean;
  part: OverlayPart;
  /** How the main window opens over the game; Overlay & hotkeys only. */
  mainState?: MainState | null;
  onMainMode?: (mode: MainMode) => Promise<void>;
}) {
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
      bare
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

  const errors = (
    <>
      {scanError && <p className="error">{scanError}</p>}
      {overlayError && <p className="error">{overlayError}</p>}
      {hotkeyError && <p className="error">{hotkeyError}</p>}
    </>
  );

  if (part === "reading") {
    return (
      <section className="panel">
        <h2>{t("settings.tab.reading")}</h2>
        <ScreenReadingPanel reading={reading} onReading={setReading} onError={setOverlayError} />
        {errors}
      </section>
    );
  }

  if (part === "diagnostics") {
    return (
      <section className="panel">
        <h2>{t("settings.tab.diagnostics")}</h2>
        <p className="hint">{t("settings.reportHint")}</p>
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
          <button onClick={() => invoke("open_log_dir").catch((e) => setOverlayError(String(e)))}>{t("update.openLog")}</button>
        </div>
        {report && <pre className="report">{report}</pre>}
        <KdeRuleRow />
        {errors}
      </section>
    );
  }

  // One row per action: what it does, its key, and where it has one, the
  // thing it does, to try without the game in front.
  const row = (action: string, extra?: ReactNode) => (
    <div className="sb-hk" key={action}>
      <div className="sb-hk-what">
        <span className="sb-hk-name">{t(`settings.hk.${action}`)}</span>
        <span className="sb-hk-sub">{t(`settings.hkSub.${action}`)}</span>
      </div>
      <div className="sb-hk-ctl">
        {extra && <div className="sb-hk-extra">{extra}</div>}
        {hotkeyField(action, t(`settings.hk.${action}`), "")}
      </div>
    </div>
  );

  return (
    <>
      <section className="panel">
        <h2>{t("settings.groupWindows")}</h2>
        {row("main")}
        {row(
          "status",
          <button onClick={toggleStatusWindow}>{statusOpen ? t("settings.hide") : t("settings.show")}</button>,
        )}
      </section>
      <section className="panel">
        <h2>{t("settings.groupCapture")}</h2>
        {row("reading")}
        {row(
          "scan",
          <>
            <button disabled={!reading?.on} onClick={toggleLiveScan}>
              {scanLive ? t("settings.stop") : t("settings.start")}
            </button>
            <button disabled={!reading?.on} onClick={scanNow}>
              {t("settings.once")}
            </button>
          </>,
        )}
        {row("refinery")}
        {row(
          "capture",
          <button disabled={!reading?.on} onClick={sendTrainingCapture}>
            {t("settings.sendNow")}
          </button>,
        )}
        {!reading?.on && <p className="hint">{t("settings.captureNeedsReading")}</p>}
        {captureStatus && (
          <p className={captureStatus.phase === "error" ? "error" : "hint"}>
            {t(`overlay.capture.${captureStatus.phase}`, { detail: captureStatus.detail })}
          </p>
        )}
      </section>
      <section className="panel sb-notes">
        {hotkey && (
          <p className="hint">
            {t("settings.hkCount", { count: Object.keys(hotkey.hotkeys).length - Object.keys(hotkey.failed ?? {}).length })}
            {heardHotkey ? ` · ${t("overlay.hotkeyHeard", { action: t(`overlay.hotkeyName.${heardHotkey}`) })}` : ""}
          </p>
        )}
        {/* Wayland: the compositor delivers the keys, and is where they change. */}
        {hotkey?.desktop_owned && <p className="hint">{t("overlay.hotkeyDesktop")}</p>}
        {hotkey?.desktop_offered && !hotkey.desktop_owned && (
          <details className="update-notes">
            <summary>{t("overlay.hotkeyDesktopUnset")}</summary>
            <pre>
              {["main", "status", "scan", "refinery", "capture", "reading"]
                .map((action) => `${hotkey.action_command}${action}`)
                .join("\n")}
            </pre>
          </details>
        )}
        {hotkey && !hotkey.global_supported && (
          <p className="hint">
            {t("overlay.waylandHint")} <code>{hotkey.toggle_command}</code>
          </p>
        )}
        {!paired && <p className="hint">{t("overlay.pairHint")}</p>}
        {errors}
      </section>
      {mainState && onMainMode && (
        <section className="panel">
          <h2>{t("settings.openAs")}</h2>
          <div className="sb-choices" role="radiogroup" aria-label={t("settings.openAs")}>
            {(["overlay", "window"] as const).map((m) => (
              <label key={m} className={`sb-choice${mainState.mode === m ? " on" : ""}`}>
                <input
                  type="radio"
                  name="main-mode"
                  checked={mainState.mode === m}
                  onChange={() => void onMainMode(m).catch((e) => setOverlayError(String(e)))}
                />
                <span className="sb-choice-name">{t(`settings.mode.${m}`)}</span>
                <span className="sb-choice-text">{t(`settings.modeText.${m}`)}</span>
              </label>
            ))}
          </div>
          <p className="hint">{t("settings.modeNoGame")}</p>
        </section>
      )}
    </>
  );
}
