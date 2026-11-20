import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { asSeverity, onRsiStatus, type RsiStatusUpdate } from "../status";
import "./shell.css";

/** Every section of the main window, in the order the rail lists them. */
export const SECTIONS = ["home", "craft", "blueprints", "gathering", "refinery", "stash", "org", "tools", "settings"] as const;
export type Section = (typeof SECTIONS)[number];

/** Sections that exist in the rail before the website can feed them. */
export const COMING_SOON: ReadonlySet<Section> = new Set(["craft", "blueprints", "gathering", "stash", "org"]);

/** After these the rail draws a rule: what follows is about StarBuddy itself. */
const RULE_AFTER: Section = "org";

const STORE_KEY = "starbuddy.section";

/**
 * The section the player left the window on. Kept in the browser's storage,
 * which is a convenience: when it is unreadable the window opens on Home.
 */
export function useSection(): [Section, (s: Section) => void] {
  const [section, setSection] = useState<Section>(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      return (SECTIONS as readonly string[]).includes(saved ?? "") ? (saved as Section) : "home";
    } catch {
      return "home";
    }
  });
  const choose = (s: Section) => {
    setSection(s);
    try {
      localStorage.setItem(STORE_KEY, s);
    } catch {
      // Storage refused: the choice holds for this session.
    }
  };
  return [section, choose];
}

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const ICONS: Record<Section, ReactNode> = {
  home: icon(<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />),
  craft: icon(
    <>
      <path d="M14.5 3.5l6 6-3 3-6-6z" />
      <path d="M11.5 6.5L3 15l3 3 8.5-8.5" />
    </>,
  ),
  blueprints: icon(
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>,
  ),
  gathering: icon(
    <>
      <path d="M3 9.5c5-5 13-5 18 0" />
      <path d="M12 6L6.5 21" />
    </>,
  ),
  refinery: icon(
    <>
      <path d="M9 3h6" />
      <path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </>,
  ),
  stash: icon(
    <>
      <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
      <path d="M3 7l9 4 9-4M12 11v10" />
    </>,
  ),
  org: icon(
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2" />
    </>,
  ),
  tools: icon(
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>,
  ),
  settings: icon(
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>,
  ),
};

/** The RSI status as one chip: green when all is well, else the worst incident's colour. */
function ServerChip() {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<RsiStatusUpdate | null>(null);
  useEffect(() => onRsiStatus(setUpdate), []);
  const status = update?.status;
  if (!status) return null;
  const worst = status.active.map((i) => asSeverity(i.severity))[0];
  const dot = worst === "down" ? "bad" : worst ? "warn" : "";
  return (
    <span className="sb-chip" title={status.summary}>
      <span className={`sb-dot ${dot}`} />
      {worst ? t(`status.severity.${worst}`) : t("shell.allSystems")}
    </span>
  );
}

/**
 * The main window's frame: a title bar, the rail of sections, the section
 * itself and a footer of keys. The look is the overlays' own (theme.css), so
 * the window and the panels pinned over the game read as one thing.
 */
export function Shell({
  section,
  onSection,
  version,
  children,
}: {
  section: Section;
  onSection: (s: Section) => void;
  version: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="sb">
      <header className="sb-hd">
        <span className="sb-grip" aria-hidden="true" />
        <span className="sb-brand">StarBuddy</span>
        <span className="sb-sect">{t(`shell.section.${section}`)}</span>
        <span className="sb-sp" />
        <ServerChip />
      </header>
      <div className="sb-mid">
        <nav className="sb-rail" aria-label={t("shell.sections")}>
          {SECTIONS.map((s) => (
            <div key={s} className="sb-rail-item">
              <button
                type="button"
                className={`sb-nav${s === section ? " on" : ""}`}
                aria-current={s === section ? "page" : undefined}
                onClick={() => onSection(s)}
              >
                <span className="sb-nav-ic">{ICONS[s]}</span>
                <span>{t(`shell.section.${s}`)}</span>
                {COMING_SOON.has(s) && <span className="sb-soon">{t("shell.soon")}</span>}
              </button>
              {s === RULE_AFTER && <div className="sb-rule" />}
            </div>
          ))}
          <div className="sb-rail-foot">
            <span className="sb-dim mono">{version ? `v${version}` : ""}</span>
          </div>
        </nav>
        <main className="sb-main">{children}</main>
      </div>
    </div>
  );
}

/** A section the website has to feed before it can show anything. */
export function ComingSoon({ section }: { section: Section }) {
  const { t } = useTranslation();
  return (
    <div className="sb-soon-card">
      <div className="sb-eyebrow">{t("shell.soon")}</div>
      <h2>{t(`shell.section.${section}`)}</h2>
      <p>{t(`shell.soonText.${section}`)}</p>
    </div>
  );
}
