import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export const SETTINGS_TABS = ["hotkeys", "game", "reading", "account", "general", "updates", "diagnostics"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

const STORE_KEY = "starbuddy.settingsTab";

/** The tab Settings was left on; a convenience, so Overlay & hotkeys when unreadable. */
export function useSettingsTab(): [SettingsTab, (tab: SettingsTab) => void] {
  const [tab, setTab] = useState<SettingsTab>(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      return (SETTINGS_TABS as readonly string[]).includes(saved ?? "") ? (saved as SettingsTab) : "hotkeys";
    } catch {
      return "hotkeys";
    }
  });
  const choose = (next: SettingsTab) => {
    setTab(next);
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {
      // Storage refused: the choice holds for this session.
    }
  };
  return [tab, choose];
}

/**
 * Settings: a list of tabs beside the one shown. The panels themselves are
 * the window's, handed in by tab, since several of them share state the
 * window keeps (the pairing, the game folder, the scan of past logs).
 */
export function Settings({ tab, onTab, panels }: { tab: SettingsTab; onTab: (tab: SettingsTab) => void; panels: Record<SettingsTab, ReactNode> }) {
  const { t } = useTranslation();
  return (
    <div className="sb-settings">
      <nav className="sb-subnav" aria-label={t("shell.section.settings")}>
        {SETTINGS_TABS.map((s) => (
          <button
            key={s}
            type="button"
            className={`sb-subnav-item${s === tab ? " on" : ""}`}
            aria-current={s === tab ? "page" : undefined}
            onClick={() => onTab(s)}
          >
            {t(`settings.tab.${s}`)}
          </button>
        ))}
      </nav>
      <div className="sb-settings-body">{panels[tab]}</div>
    </div>
  );
}
