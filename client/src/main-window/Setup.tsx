import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { ServerPanel } from "./ServerPanel";
import { ScreenReadingPanel } from "./ScreenReadingPanel";
import type { HeardHotkey } from "./OverlayPanel";
import type { ConnectionView, HotkeyInfo, Reading } from "./types";

const DONE_KEY = "starbuddy.setupDone";

/** Whether the first-run setup has been finished or skipped on this machine. */
export function setupDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return true;
  }
}

function markSetupDone() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // Storage refused: the setup may show again next start, which is harmless.
  }
}

const STEPS = ["server", "log", "window", "hotkey"] as const;
type Step = (typeof STEPS)[number] | "end";

/**
 * First-run setup: one card per step, dots above for where the player is.
 *
 * Every step can be skipped, and nothing here is needed to use StarBuddy: an
 * org, the website and the overlays are each optional. It shows on the first
 * start of an unpaired client and can be opened again from Settings › General.
 * Each card reuses the panel Settings has for the same job, so the two never
 * disagree about how a thing is set up.
 */
export function Setup({
  connection,
  onConnection,
  liveDir,
  onLiveDir,
  heard,
  onClose,
}: {
  connection: ConnectionView | null;
  onConnection: (connection: ConnectionView) => void;
  liveDir: string | null;
  onLiveDir: (dir: string | null) => void;
  heard: HeardHotkey | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [at, setAt] = useState(0);
  const step: Step = at < STEPS.length ? STEPS[at] : "end";
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState<HotkeyInfo | null>(null);
  // A key heard before the hotkey card opened does not count as trying one.
  const hotkeyFrom = useRef(0);

  useEffect(() => {
    invoke<Reading>("screen_reading").then(setReading).catch(() => {});
    invoke<HotkeyInfo>("overlay_hotkey").then(setHotkey).catch(() => {});
    // The folder is otherwise looked up by the Settings panel; the setup may come first.
    if (!liveDir) invoke<string | null>("detect_game_log").then(onLiveDir).catch(() => {});
    const sub = listen<Reading>("screen-reading", (e) => setReading(e.payload)).catch(() => null);
    return () => void sub.then((un) => un?.());
    // Once, on mount: the setters only hand answers up.
  }, []);

  useEffect(() => {
    setError(null);
    if (step === "hotkey") hotkeyFrom.current = Date.now();
  }, [step]);

  const done: Record<(typeof STEPS)[number], boolean> = {
    server: Boolean(connection?.paired),
    log: Boolean(liveDir),
    window: Boolean(reading?.on),
    hotkey: Boolean(heard && heard.at >= hotkeyFrom.current && hotkeyFrom.current > 0),
  };

  const finish = () => {
    markSetupDone();
    onClose();
  };

  const browse = async () => {
    setError(null);
    try {
      const picked = await openDialog({ directory: true, multiple: false, title: t("scan.browseTitle") });
      if (typeof picked !== "string") return;
      onLiveDir(await invoke<string>("set_live_dir", { path: picked }));
    } catch (e) {
      setError(String(e));
    }
  };

  const statusKey = hotkey?.hotkeys.status;
  const keyBlocked = Boolean(hotkey && (!hotkey.global_supported || (hotkey.desktop_offered && !hotkey.desktop_owned) || hotkey.failed.status));

  let card;
  if (step === "server") {
    card = (
      <>
        <p>{t("setup.server.lead")}</p>
        <ServerPanel connection={connection} onConnection={onConnection} bare />
      </>
    );
  } else if (step === "log") {
    card = (
      <>
        <p>{t("setup.log.lead")}</p>
        {liveDir ? (
          <p className="sb-setup-ok">
            {t("scan.detected")} <code>{liveDir}</code>
          </p>
        ) : (
          <p className="hint">{t("setup.log.notFound")}</p>
        )}
        <div className="row">
          <button onClick={() => void browse()}>{liveDir ? t("scan.browseChange") : t("scan.browse")}</button>
        </div>
      </>
    );
  } else if (step === "window") {
    card = (
      <>
        <p>{t("setup.window.lead")}</p>
        <p className="hint">{reading?.picks_from_list ? t("setup.window.windows") : t("setup.window.portal")}</p>
        <ScreenReadingPanel reading={reading} onReading={setReading} onError={setError} />
      </>
    );
  } else if (step === "hotkey") {
    card = (
      <>
        <p>{t("setup.hotkey.lead")}</p>
        {keyBlocked ? (
          <p className="hint">{t("setup.hotkey.blocked")}</p>
        ) : statusKey ? (
          <p className="sb-setup-key">
            {t("setup.hotkey.press")} <kbd>{statusKey}</kbd>
          </p>
        ) : (
          <p className="hint">{t("setup.hotkey.noKey")}</p>
        )}
        {done.hotkey && <p className="sb-setup-ok">{t("setup.hotkey.heard")}</p>}
      </>
    );
  } else {
    card = (
      <>
        <ul className="sb-setup-summary">
          {STEPS.map((s) => (
            <li key={s} className={done[s] ? "ok" : ""}>
              <span className="sb-setup-mark">{done[s] ? "✓" : "–"}</span>
              {t(`setup.${s}.title`)}
              {!done[s] && <span className="hint"> · {t("setup.end.later")}</span>}
            </li>
          ))}
        </ul>
        <p className="hint">{t("setup.end.solo")}</p>
      </>
    );
  }

  const title = step === "end" ? t("setup.end.title") : t(`setup.${step}.title`);

  return (
    <div className="sb-setup">
      <div className="sb-setup-dots" aria-label={t("setup.progress", { at: Math.min(at + 1, STEPS.length), of: STEPS.length })}>
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            className={`sb-setup-dot${i === at ? " now" : ""}${done[s] ? " ok" : ""}`}
            title={t(`setup.${s}.title`)}
            onClick={() => setAt(i)}
          />
        ))}
      </div>
      <section className="sb-card sb-setup-card">
        <h2>{title}</h2>
        {card}
        {error && <p className="error">{error}</p>}
        <div className="sb-setup-nav">
          {at > 0 && (
            <button className="sb-btn-quiet" onClick={() => setAt(at - 1)}>
              {t("setup.back")}
            </button>
          )}
          <span style={{ flex: 1 }} />
          {step === "end" ? (
            <button className="active" onClick={finish}>
              {t("setup.end.go")}
            </button>
          ) : (
            <button className={done[step] ? "active" : "sb-btn-quiet"} onClick={() => setAt(at + 1)}>
              {done[step] ? t("setup.next") : t("setup.skip")}
            </button>
          )}
        </div>
      </section>
      {step !== "end" && (
        <button className="sb-link-btn" onClick={finish}>
          {t("setup.skipAll")}
        </button>
      )}
    </div>
  );
}
