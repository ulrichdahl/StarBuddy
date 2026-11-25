import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

/**
 * Two lines the client can keep in the game's user.cfg for the beacon window
 * (game_cfg.rs): the telemetry switch and the position text. `null` is a
 * line the player has not been asked about yet.
 */
interface GameLines {
  telemetry: boolean | null;
  display_info: boolean | null;
}
type Key = keyof GameLines;
const KEYS: Key[] = ["display_info", "telemetry"];

function useGameLines(): [GameLines | undefined, (set: Partial<GameLines>) => Promise<boolean>, string | null] {
  const [lines, setLines] = useState<GameLines | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    invoke<GameLines>("game_lines_get")
      .then(setLines)
      .catch((e) => setError(String(e)));
  }, []);
  const set = async (next: Partial<GameLines>) => {
    setError(null);
    try {
      setLines(await invoke<GameLines>("game_lines_set", { telemetry: next.telemetry ?? null, displayInfo: next.display_info ?? null }));
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };
  return [lines, set, error];
}

/** Asked once on Home: new features the player would not find on their own. */
export function TelemetryBanner() {
  const { t } = useTranslation();
  const [lines, set, error] = useGameLines();
  // Asked only about the lines not answered when the window opened.
  const [asking, setAsking] = useState<Key[] | null>(null);
  const [ticked, setTicked] = useState<Record<Key, boolean>>({ telemetry: true, display_info: true });
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (lines && asking === null) setAsking(KEYS.filter((k) => lines[k] === null));
  }, [lines, asking]);
  if (closed || !asking || asking.length === 0) return null;

  const choose = async (yes: boolean) => {
    const next: Partial<GameLines> = {};
    for (const k of asking) next[k] = yes && ticked[k];
    if (await set(next)) setAnswer(yes && asking.some((k) => ticked[k]) ? "yes" : "no");
  };
  return (
    <div className="update-banner" role="status">
      <div style={{ flex: 1 }}>
        {answer === null ? (
          <>
            <p>{t("gameLines.ask")}</p>
            {asking.map((k) => (
              <label key={k} className="sb-check">
                <input type="checkbox" checked={ticked[k]} onChange={(e) => setTicked({ ...ticked, [k]: e.target.checked })} />
                {t(`gameLines.${k}`)}
              </label>
            ))}
          </>
        ) : (
          <p>{answer === "yes" ? t("gameLines.saidYes") : t("gameLines.saidNo")}</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
      {answer === null ? (
        <>
          <button onClick={() => void choose(true)}>{t("gameLines.yes")}</button>
          <button className="sb-ghost" onClick={() => void choose(false)}>
            {t("gameLines.no")}
          </button>
        </>
      ) : (
        <button className="dismiss" onClick={() => setClosed(true)} aria-label={t("update.dismiss")} title={t("update.dismiss")}>
          ×
        </button>
      )}
    </div>
  );
}

/** Settings › Game install: the same lines, to change the answers later. */
export function TelemetryPanel() {
  const { t } = useTranslation();
  const [lines, set, error] = useGameLines();
  return (
    <section className="panel">
      <h2>{t("gameLines.title")}</h2>
      {KEYS.map((k) => (
        <div key={k}>
          <label className="sb-check">
            <input type="checkbox" checked={lines?.[k] ?? false} disabled={!lines} onChange={(e) => void set({ [k]: e.target.checked })} />
            {t(`gameLines.${k}`)}
          </label>
          <p className="hint">{t(`gameLines.${k}Hint`)}</p>
        </div>
      ))}
      <p className="hint">{t("gameLines.restart")}</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
