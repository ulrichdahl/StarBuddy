import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { listenFailed } from "../listen";
import type { KdeRuleInfo } from "./types";

/** The KWin rule that keeps overlays above the fullscreen game (Linux/KDE only). */
export function KdeRuleRow() {
  const { t } = useTranslation();
  const [kdeRule, setKdeRule] = useState<KdeRuleInfo | null>(null);
  const [kdeRuleError, setKdeRuleError] = useState<string | null>(null);

  useEffect(() => {
    // Not knowing means not offering it, which is what a desktop without KWin gets.
    invoke<KdeRuleInfo>("overlay_kde_rule").then(setKdeRule).catch(() => {});
    const sub = listen<boolean>("overlay-kde-rule", (e) =>
      setKdeRule((prev) => ({ applicable: prev?.applicable ?? true, installed: e.payload })),
    ).catch(listenFailed(setKdeRuleError));
    return () => void sub.then((un) => un());
  }, []);

  const setKdeRuleInstalled = async (install: boolean) => {
    setKdeRuleError(null);
    try {
      setKdeRule(await invoke<KdeRuleInfo>("overlay_set_kde_rule", { install }));
    } catch (e) {
      setKdeRuleError(String(e));
    }
  };

  return (
    <>
      {kdeRule?.applicable && (
        <div className="row">
          <p className="hint" style={{ flex: 1, margin: 0 }}>
            {kdeRule.installed ? t("overlay.kdeRuleInstalled") : t("overlay.kdeRuleMissing")}
          </p>
          <button onClick={() => setKdeRuleInstalled(!kdeRule.installed)}>
            {kdeRule.installed ? t("overlay.kdeRuleRemove") : t("overlay.kdeRuleInstall")}
          </button>
        </div>
      )}
      {kdeRuleError && <p className="error">{kdeRuleError}</p>}
    </>
  );
}
