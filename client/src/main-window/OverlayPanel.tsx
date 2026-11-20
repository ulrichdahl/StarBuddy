import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { HotkeyCapture } from "../HotkeyCapture";
import { listenFailed } from "../listen";
import { KdeRuleRow } from "./KdeRuleRow";
import { ScreenReadingPanel, ShareTrainingRow } from "./ScreenReadingPanel";
import type { HotkeyInfo, Reading } from "./types";
import type { MainMode, MainState } from "./mainMode";

/** Which of the panel's three parts a Settings tab shows. */
export type OverlayPart = "hotkeys" | "reading" | "diagnostics";

/** The last hotkey that reached StarBuddy, and when. */
export interface HeardHotkey {
  action: string;
  at: number;
}

/**
 * The last hotkey heard this session. Kept by the window, not by a tab, so a
 * key pressed in the game is still there when Diagnostics is opened after.
 */
export function useHeardHotkey(): HeardHotkey | null {
  const [heard, setHeard] = useState<HeardHotkey | null>(null);
  useEffect(() => {
    const sub = listen<string>("hotkey-fired", (e) => setHeard({ action: e.payload, at: Date.now() })).catch(() => null);
    return () => void sub.then((un) => un?.());
  }, []);
  return heard;
}

/** Whether the client was started with STARBUDDY_DEBUG=1. */
export function useDebugMode(): boolean {
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    invoke<boolean>("debug_mode").then(setDebug).catch(() => {});
  }, []);
  return debug;
}

const ISSUES = "https://github.com/ulrichdahl/StarBuddy/issues";

/** A framed capture area: whether there is one, and the buttons to frame or forget it. */
function AreaRow({ purpose, enabled, onError }: { purpose: "refinery" | "scan"; enabled: boolean; onError: (e: string | null) => void }) {
  const { t } = useTranslation();
  const [framed, setFramed] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () =>
      invoke<unknown>("region_current", { purpose })
        .then((a) => setFramed(a !== null))
        .catch((e) => onError(String(e)));
    void read();
    const sub = listen<string>("region-changed", (e) => e.payload === purpose && void read()).catch(() => null);
    return () => void sub.then((un) => un?.());
    // onError only hands the message up.
  }, [purpose]);
  const frame = () => {
    onError(null);
    void invoke("region_select", { purpose }).catch((e) => onError(String(e)));
  };
  const clear = () => {
    onError(null);
    void invoke("region_clear", { purpose }).catch((e) => onError(String(e)));
  };
  return (
    <div className="sb-set">
      <div className="sb-set-what">
        <span className="sb-hk-name">{t(`settings.area.${purpose}`)}</span>
        <span className="sb-hk-sub">{framed ? t("settings.areaFramed") : t("settings.areaWhole")}</span>
      </div>
      <div className="sb-set-ctl">
        <button disabled={!enabled} onClick={frame}>
          {framed ? t("settings.areaReframe") : t("settings.areaFrame")}
        </button>
        {framed && (
          <button className="sb-ghost" onClick={clear}>
            {t("settings.areaClear")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Whether org mates see this player's game status (presence.rs); on unless switched off. */
export function PresencePanel() {
  const { t } = useTranslation();
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    invoke<boolean>("presence_sharing_get").then(setOn).catch((e) => setError(String(e)));
  }, []);
  const toggle = async (enabled: boolean) => {
    setError(null);
    try {
      await invoke("presence_sharing_set", { enabled });
      setOn(enabled);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section className="panel">
      <h2>{t("settings.presence")}</h2>
      <label className="sb-check">
        <input type="checkbox" checked={on ?? false} disabled={on === null} onChange={(e) => void toggle(e.target.checked)} />
        {t("settings.presenceShare")}
      </label>
      <p className="hint">{t("settings.presenceHint")}</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** How the main window opens over the game: with language, under General. */
export function OpenAsPanel({ mainState, onMainMode }: { mainState: MainState | null; onMainMode: (mode: MainMode) => Promise<void> }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  if (!mainState) return null;
  return (
    <section className="panel">
      <h2>{t("settings.openAs")}</h2>
      <div className="sb-choices" role="radiogroup" aria-label={t("settings.openAs")}>
        {(["overlay", "window"] as const).map((m) => (
          <label key={m} className={`sb-choice${mainState.mode === m ? " on" : ""}`}>
            <input
              type="radio"
              name="main-mode"
              checked={mainState.mode === m}
              onChange={() => void onMainMode(m).catch((e) => setError(String(e)))}
            />
            <span className="sb-choice-name">{t(`settings.mode.${m}`)}</span>
            <span className="sb-choice-text">{t(`settings.modeText.${m}`)}</span>
          </label>
        ))}
      </div>
      <p className="hint">{t("settings.modeNoGame")}</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/**
 * The hotkeys, reading the screen, and the report for when one of them does
 * not work. One component because they share what the client says about the
 * hotkeys and the screen; Settings shows each part under its own tab.
 */
export function OverlayPanel({
  paired,
  part,
  debug = false,
  heard = null,
}: {
  paired: boolean;
  part: OverlayPart;
  /** STARBUDDY_DEBUG=1: show what is there to find faults with. */
  debug?: boolean;
  /** The last hotkey that arrived; Diagnostics only. */
  heard?: HeardHotkey | null;
}) {
  const { t, i18n } = useTranslation();
  /** Whether the client is watching the game's window, and what it says about it. */
  const [reading, setReading] = useState<Reading | null>(null);
  const [hotkey, setHotkey] = useState<HotkeyInfo | null>(null);
  const [captureStatus, setCaptureStatus] = useState<{ phase: string; detail: string } | null>(null);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  /** Everything about this machine a bug report needs, when asked for. */
  const [report, setReport] = useState<string | null>(null);
  const [reportCopied, setReportCopied] = useState(false);
  const [overlayError, setOverlayError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Reading>("screen_reading")
      .then(setReading)
      .catch((e) => setOverlayError(String(e)));
    invoke<HotkeyInfo>("overlay_hotkey")
      .then(setHotkey)
      .catch((e) => setHotkeyError(String(e)));

    const overlayFailed = listenFailed(setOverlayError);
    const hotkeyFailed = listenFailed(setHotkeyError);
    const subs = [
      // The hotkey switches reading on and off mid-game, so this page is not
      // the only thing that changes it.
      listen<Reading>("screen-reading", (e) => setReading(e.payload)).catch(overlayFailed),
      // The desktop answers about the hotkeys in its own time, and can change
      // them from its own settings afterwards.
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
  const hotkeyField = (action: string, label: string) => (
    <HotkeyCapture
      action={action}
      label={label}
      current={(hotkey?.desktop_owned ? hotkey.triggers[action] : undefined) ?? hotkey?.hotkeys[action] ?? ""}
      failed={hotkey?.failed?.[action] && t("overlay.hotkeyTaken", { detail: hotkey.failed[action] })}
      onCapture={(action, keys) => void saveHotkey(action, keys)}
      bare
    />
  );

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
      {overlayError && <p className="error">{overlayError}</p>}
      {hotkeyError && <p className="error">{hotkeyError}</p>}
    </>
  );

  const actions = hotkey ? Object.keys(hotkey.hotkeys) : [];
  const commands = actions.map((action) => `${hotkey?.action_command ?? ""}${action}`).join("\n");

  if (part === "reading") {
    return (
      <section className="panel">
        <h2>{t("settings.tab.reading")}</h2>
        <ScreenReadingPanel reading={reading} onReading={setReading} onError={setOverlayError} />
        <AreaRow purpose="refinery" enabled={Boolean(reading?.on)} onError={setOverlayError} />
        {!reading?.on && <p className="hint">{t("settings.areaNeedsReading")}</p>}
        <ShareTrainingRow onError={setOverlayError} />
        {errors}
      </section>
    );
  }

  if (part === "diagnostics") {
    return (
      <>
        <section className="panel">
          <h2>{t("settings.lastHotkey")}</h2>
          <p className={heard ? "" : "hint"}>
            {heard
              ? t("settings.heard", {
                  action: t(`overlay.hotkeyName.${heard.action}`, { defaultValue: heard.action }),
                  time: new Date(heard.at).toLocaleTimeString(i18n.language),
                })
              : t("settings.heardNone")}
          </p>
          {debug && hotkey && (
            <>
              <p className="hint">
                {t("settings.hkCount", { count: actions.length - Object.keys(hotkey.failed ?? {}).length })}
              </p>
              {hotkey.desktop_owned && <p className="hint">{t("overlay.hotkeyDesktop")}</p>}
              {hotkey.action_command && <pre className="report">{commands}</pre>}
            </>
          )}
        </section>
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
          <div className="sb-links">
            <button type="button" className="sb-link" onClick={() => void openUrl(`${ISSUES}/new`).catch(() => {})}>
              {t("settings.reportIssue")}
            </button>
            <button type="button" className="sb-link" onClick={() => void openUrl(ISSUES).catch(() => {})}>
              {t("settings.knownIssues")}
            </button>
          </div>
          <KdeRuleRow />
          {errors}
        </section>
      </>
    );
  }

  // One row per action: what it does and its key.
  const row = (action: string) => (
    <div className="sb-hk" key={action}>
      <div className="sb-hk-what">
        <span className="sb-hk-name">{t(`settings.hk.${action}`)}</span>
        <span className="sb-hk-sub">{t(`settings.hkSub.${action}`)}</span>
      </div>
      <div className="sb-hk-ctl">{hotkeyField(action, t(`settings.hk.${action}`))}</div>
    </div>
  );

  // What stops a hotkey from working, and only that: the player has to act.
  const failed = Object.keys(hotkey?.failed ?? {});
  const unset = Boolean(hotkey?.desktop_offered && !hotkey.desktop_owned);
  const noGlobal = Boolean(hotkey && !hotkey.global_supported);
  const problem = failed.length > 0 || unset || noGlobal;

  return (
    <>
      {problem && (
        <div className="sb-warn" role="alert">
          {failed.length > 0 && (
            <p>{t("settings.hkFailed", { names: failed.map((a) => t(`settings.hk.${a}`)).join(", ") })}</p>
          )}
          {unset && (
            <>
              <p>{t("overlay.hotkeyDesktopUnset")}</p>
              <details>
                <summary>{t("settings.hkCommands")}</summary>
                <pre>{commands}</pre>
              </details>
            </>
          )}
          {noGlobal && (
            <p>
              {t("overlay.waylandHint")} <code>{hotkey?.toggle_command}</code>
            </p>
          )}
        </div>
      )}
      <section className="panel">
        <h2>{t("settings.groupWindows")}</h2>
        {row("main")}
        {row("status")}
      </section>
      <section className="panel">
        <h2>{t("settings.groupCapture")}</h2>
        {row("reading")}
        {row("scan")}
        {row("refinery")}
        {row("capture")}
        {reading && !reading.on && <p className="hint">{t("settings.captureNeedsReading")}</p>}
        {captureStatus && (
          <p className={captureStatus.phase === "error" ? "error" : "hint"}>
            {t(`overlay.capture.${captureStatus.phase}`, { detail: captureStatus.detail })}
          </p>
        )}
      </section>
      {!paired && <p className="hint">{t("overlay.pairHint")}</p>}
      {errors}
    </>
  );
}
