import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { serverApi } from "./api";
import { gradeLabel, Pager, useSearch, useServerList } from "./pageParts";
import { changed, EyeIcon, PinToggle, TrackToggle, usePins } from "./pins";

/** GET /api/blueprints/catalog: one row per recipe, with who holds it. */
interface CatalogRow {
  id: number;
  name: string;
  category_label: string;
  type_display: string | null;
  size: number | null;
  grade: string | null;
  is_default: boolean;
  owned_by_me: boolean;
  /** The other members who hold it. */
  owners: string[];
  /** Smallest first: the best chance of the recipe. */
  pools: Pool[];
}
interface Pool {
  pool_key: string;
  pool_label: string;
  /** Who hands it out; older servers leave it out. */
  factions?: string[];
  awardable: boolean;
  in_pool: number;
  owned_in_pool: number;
  owned_percent: number;
}
interface Catalog {
  data: CatalogRow[];
  total: number;
  current_page: number;
  last_page: number;
  categories: { key: string; label: string; subs: { key: string; label: string }[] }[];
}

/** The website's three switches; "owned" turns the other two off, and they it. */
interface Toggles {
  owned: boolean;
  unownedByMe: boolean;
  unowned: boolean;
}

const STORE_KEY = "starbuddy.blueprintFilters";

function loadToggles(): Toggles {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (saved && typeof saved === "object") return { owned: !!saved.owned, unownedByMe: !!saved.unownedByMe, unowned: !!saved.unowned };
  } catch {
    // Unreadable: start with everything shown.
  }
  return { owned: false, unownedByMe: false, unowned: false };
}

/** "Magazine · S2": the type without the group the heading already names. */
const typeText = (row: CatalogRow) => {
  const full = row.type_display ?? row.category_label;
  const short = full.includes(" · ") ? full.split(" · ").slice(1).join(" · ") : full;
  return row.size !== null ? `${short} · S${row.size}` : short;
};

/**
 * Blueprints: the website's checklist, made to sit beside the fabricator in
 * game. The same order (the fabricator's), groups, columns and filters, one
 * line per recipe so names stay readable in a narrow overlay, and the keys
 * the website has: ↑ ↓ move the highlighted row, Space ticks it. At the far
 * right of each row, the eye tracks its reward pool and the pin makes it a
 * craft target, as on the website.
 */
export function Blueprints({ paired }: { paired: boolean }) {
  const { t } = useTranslation();
  const [typed, search, setTyped] = useSearch();
  const [category, setCategory] = useState("");
  const [grade, setGrade] = useState("");
  const [toggles, setToggles] = useState<Toggles>(loadToggles);
  const [page, setPage] = useState(1);
  const [focus, setFocus] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setPage(1), [search, category, grade, toggles]);
  useEffect(() => setFocus(0), [search, category, grade, toggles, page]);

  const setToggle = (key: keyof Toggles, on: boolean) => {
    const next: Toggles =
      key === "owned"
        ? { owned: on, unownedByMe: on ? false : toggles.unownedByMe, unowned: on ? false : toggles.unowned }
        : { ...toggles, [key]: on, owned: on ? false : toggles.owned };
    setToggles(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // Storage refused: the choice holds for this session.
    }
  };

  const { data, error, setError, reload } = useServerList<Catalog>(paired, "/api/blueprints/catalog", {
    search: search || undefined,
    category: category || undefined,
    grade: grade || undefined,
    owned: toggles.owned ? 1 : undefined,
    unowned_by_me: toggles.unownedByMe ? 1 : undefined,
    unowned: toggles.unowned ? 1 : undefined,
    per_page: 50,
    page,
  });

  const pins = usePins(paired);
  const act = async (run: () => Promise<unknown>, done: string) => {
    setNotice(null);
    try {
      await run();
      setNotice(done);
      reload();
      pins.reload();
    } catch (e) {
      setError(String(e));
    }
  };
  const toggleOwned = (row: CatalogRow) =>
    act(
      () => serverApi("POST", "/api/blueprints-owned/toggle", { body: { blueprint_id: row.id } }).then(() => changed("/api/tracked-pools")),
      t(row.owned_by_me ? "blueprints.unmarked" : "blueprints.marked", { name: row.name }),
    );
  const rows = data?.data ?? [];
  const unownedShown = rows.filter((r) => !r.owned_by_me);
  const markAll = () =>
    act(
      () =>
        serverApi("POST", "/api/blueprints-owned/bulk", { body: { blueprint_ids: unownedShown.map((r) => r.id) } }).then(() =>
          changed("/api/tracked-pools"),
        ),
      t("blueprints.markedAll", { count: unownedShown.length }),
    );
  const pin = (row: CatalogRow) =>
    pins.targets.has(row.id)
      ? act(() => pins.unpinTarget(row.id), t("blueprints.unpinned", { name: row.name }))
      : act(() => pins.pinTarget(row.id), t("blueprints.pinned", { name: row.name }));
  const track = (pool: Pool) =>
    pins.pools.has(pool.pool_key)
      ? act(() => pins.untrack(pool.pool_key), t("blueprints.untracked", { pool: pool.pool_label }))
      : act(() => pins.track(pool.pool_key), t("blueprints.tracked", { pool: pool.pool_label }));

  // ↑ ↓ move the highlight, Space ticks it: only while the list has focus,
  // so nothing reaches the game or the search box.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || rows.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, focus + (e.key === "ArrowDown" ? 1 : -1)));
      setFocus(next);
      listRef.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === " ") {
      e.preventDefault();
      void toggleOwned(rows[focus]);
    }
  };

  if (!paired) return <p className="sb-card-sub">{t("pages.pairFirst")}</p>;

  return (
    <div className="sb-page">
      <div className="sb-page-hd sb-bp-filters">
        <input className="sb-search" type="search" placeholder={t("blueprints.searchPlaceholder")} aria-label={t("pages.search")} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <select aria-label={t("blueprints.col.type")} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t("blueprints.allTypes")}</option>
          {data?.categories.map((c) => (
            <Fragment key={c.key}>
              <option value={c.key}>{c.label}</option>
              {c.subs.length > 1 &&
                c.subs.map((s) => (
                  <option key={s.key} value={s.key}>
                    {"   "}
                    {s.label}
                  </option>
                ))}
            </Fragment>
          ))}
        </select>
        <select aria-label={t("blueprints.col.grade")} value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">{t("blueprints.allGrades")}</option>
          {["1", "2", "3", "4"].map((g) => (
            <option key={g} value={g}>
              {t("blueprints.gradeOption", { grade: gradeLabel(g) })}
            </option>
          ))}
        </select>
        <div className="sb-seg" role="group" aria-label={t("blueprints.showLabel")}>
          {(["owned", "unownedByMe", "unowned"] as const).map((k) => (
            <button key={k} type="button" className={toggles[k] ? "on" : ""} aria-pressed={toggles[k]} onClick={() => setToggle(k, !toggles[k])}>
              {t(`blueprints.toggle.${k}`)}
            </button>
          ))}
        </div>
        <button type="button" className="sb-bp-markall" disabled={unownedShown.length === 0} onClick={() => void markAll()}>
          {t("blueprints.markAllShown", { count: unownedShown.length })}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="hint">{notice}</p>}
      <section className="sb-card sb-card-list">
        {data === null ? (
          <p className="sb-card-sub">{t("refinery.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="sb-card-sub">{t("blueprints.none")}</p>
        ) : (
          <div className="sb-bp" ref={listRef} tabIndex={0} role="grid" aria-label={t("blueprints.listLabel")} onKeyDown={onKey}>
            <div className="sb-bp-row sb-bp-head" role="row">
              <span role="columnheader">{t("blueprints.col.owned")}</span>
              <span role="columnheader">{t("blueprints.col.name")}</span>
              <span role="columnheader">{t("blueprints.col.typeGrade")}</span>
              <span role="columnheader">{t("blueprints.col.pool")}</span>
              <span role="columnheader">{t("blueprints.col.poolDone")}</span>
              <span role="columnheader" className="c">
                {t("blueprints.col.owners")}
              </span>
              <span role="columnheader" />
            </div>
            {rows.map((row, i) => {
              const pool = row.pools[0];
              const group = i === 0 || rows[i - 1].category_label !== row.category_label;
              return (
                <Fragment key={row.id}>
                  {group && <div className="sb-bp-group">{row.category_label}</div>}
                  <div className={`sb-bp-row${i === focus ? " focus" : ""}${row.owned_by_me ? " mine" : ""}`} role="row" data-row={i} onClick={() => setFocus(i)}>
                    <span>
                      <input type="checkbox" checked={row.owned_by_me} aria-label={t("blueprints.tickLabel", { name: row.name })} onChange={() => void toggleOwned(row)} />
                    </span>
                    <span className="sb-bp-name" title={row.name}>
                      {row.name}
                    </span>
                    <span className="sb-bp-type">
                      {typeText(row)}
                      <span className="sb-bp-grade"> · {gradeLabel(row.grade)}</span>
                    </span>
                    <span className="sb-bp-pool" title={row.pools.map((p) => p.pool_label).join("\n")}>
                      {pool ? (
                        <>
                          <span className={pool.awardable ? undefined : "sb-dim"}>{pool.pool_label}</span>
                          {row.pools.length > 1 && <span className="sb-bp-more"> {t("blueprints.poolMore", { count: row.pools.length - 1 })}</span>}
                        </>
                      ) : (
                        <span className="sb-dim">—</span>
                      )}
                    </span>
                    <span className="sb-bp-done mono">
                      {pool && (
                        <>
                          <span className="sb-bp-bar" aria-hidden="true">
                            <span style={{ width: `${pool.owned_percent}%` }} />
                          </span>
                          {pool.owned_in_pool}/{pool.in_pool}
                        </>
                      )}
                    </span>
                    <span className="sb-bp-owners">
                      {row.is_default && <span title={t("blueprints.default")}>{GLOBE}</span>}
                      {row.owned_by_me && !row.is_default && (
                        <span className="me" title={t("blueprints.youHave")}>
                          {ME}
                        </span>
                      )}
                      {row.owners.length > 0 && (
                        <span className="sb-bp-count" title={row.owners.join("\n")}>
                          {GROUP}
                          {row.owners.length}
                        </span>
                      )}
                    </span>
                    <span className="sb-bp-act">
                      {row.pools.length === 1 && pool && (
                        <TrackToggle tracked={pins.pools.has(pool.pool_key)} pool={pool.pool_label} onToggle={() => void track(pool)} />
                      )}
                      {row.pools.length > 1 && <PoolPicker pools={row.pools} tracked={pins.pools} onToggle={(p) => void track(p)} />}
                      <PinToggle pinned={pins.targets.has(row.id)} name={row.name} onToggle={() => void pin(row)} />
                    </span>
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}
        {data && <Pager page={data.current_page} last={data.last_page} total={data.total} onPage={setPage} />}
      </section>
    </div>
  );
}

/** "Faction · Pool": who hands it out, then the pool's own name. */
const poolName = (p: Pool) => (p.factions && p.factions.length > 0 ? `${p.factions.join(", ")} · ${p.pool_label}` : p.pool_label);

/**
 * The eye for a recipe in several reward pools: it opens the list of them,
 * each with how far through it you are, and each tracked or not on its own.
 * Lit when any of them is tracked.
 */
function PoolPicker({ pools, tracked, onToggle }: { pools: Pool[]; tracked: Set<string>; onToggle: (p: Pool) => void }) {
  const { t } = useTranslation();
  // Fixed to the window, beside the eye, and drawn in the window's root: the
  // card it sits in has cut corners, which clip what hangs out of it. It opens
  // upward when the eye is low in the window.
  const [open, setOpen] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (open) return setOpen(null);
    const r = e.currentTarget.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    setOpen(r.bottom > window.innerHeight * 0.6 ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  };
  const any = pools.some((p) => tracked.has(p.pool_key));
  useEffect(() => {
    if (!open) return;
    const close = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const label = t("blueprints.pickPool", { count: pools.length });
  return (
    <span className="sb-bp-picker">
      <button type="button" className={`sb-pin${any ? " on" : ""}`} aria-haspopup="menu" aria-expanded={open !== null} aria-label={label} title={label} onClick={toggle}>
        <EyeIcon filled={any} />
        <span className="sb-bp-n">{pools.length}</span>
      </button>
      {open &&
        createPortal(
          <>
            <span className="sb-trk-scrim" onClick={() => setOpen(null)} />
            <span className="sb-bp-menu" role="menu" style={open}>
              {pools.map((p) => {
                const on = tracked.has(p.pool_key);
                return (
                  <button key={p.pool_key} type="button" role="menuitemcheckbox" aria-checked={on} className={on ? "on" : undefined} onClick={() => onToggle(p)}>
                    <EyeIcon filled={on} />
                    <span className={`sb-bp-menu-name${p.awardable ? "" : " sb-dim"}`}>{poolName(p)}</span>
                    <span className="mono sb-dim">
                      {p.owned_in_pool}/{p.in_pool}
                    </span>
                  </button>
                );
              })}
            </span>
          </>,
          document.querySelector(".sb") ?? document.body,
        )}
    </span>
  );
}

const svg = (d: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
/** You hold it: a person with a tick, as the website's. */
const ME = svg(
  <>
    <circle cx="10" cy="8" r="3.5" />
    <path d="M3.5 20c.6-3.5 3.2-5.5 6.5-5.5" />
    <path d="M14.5 17l2.5 2.5 4.5-5" />
  </>,
);
/** Others in the org hold it. */
const GROUP = svg(
  <>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 19c.7-3 3-4.5 6-4.5s5.3 1.5 6 4.5" />
    <path d="M16 5a3 3 0 0 1 0 6M18 14.5c1.6.6 2.6 2 3 4.5" />
  </>,
);
/** Everyone starts with it. */
const GLOBE = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
  </>,
);
