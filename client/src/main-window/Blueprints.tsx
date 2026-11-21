import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { serverApi } from "./api";
import { gradeLabel, Pager, useSearch, useServerList } from "./pageParts";
import { changed, PinIcon, PinToggle, usePins } from "./pins";

/** GET /api/blueprints/catalog: one row per recipe, with who holds it. */
interface CatalogRow {
  id: number;
  name: string;
  category_label: string;
  type_display: string | null;
  grade: string | null;
  is_default: boolean;
  owned_by_me: boolean;
  owner_count: number;
  owners: string[];
  pools: { pool_key: string; pool_label: string; awardable: boolean; in_pool: number; owned_in_pool: number }[];
}
interface Catalog {
  data: CatalogRow[];
  total: number;
  current_page: number;
  last_page: number;
  categories: { key: string; label: string }[];
}

type Show = "all" | "mine" | "missing";

/**
 * Blueprints: the website's catalog cut down to the game-side jobs — find a
 * recipe, mark it held, pin it as a craft target, and start tracking the
 * reward pool that drops it.
 */
export function Blueprints({ paired }: { paired: boolean }) {
  const { t } = useTranslation();
  const [typed, search, setTyped] = useSearch();
  const [show, setShow] = useState<Show>("all");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setPage(1), [search, show, category]);

  const { data, error, setError, reload } = useServerList<Catalog>(paired, "/api/blueprints/catalog", {
    search: search || undefined,
    category: category || undefined,
    owned: show === "mine" ? 1 : undefined,
    unowned_by_me: show === "missing" ? 1 : undefined,
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
      t(row.owned_by_me ? "blueprints.unmarked" : "blueprints.marked", { name: row.name }));
  const pin = (row: CatalogRow) =>
    pins.targets.has(row.id)
      ? act(() => pins.unpinTarget(row.id), t("blueprints.unpinned", { name: row.name }))
      : act(() => pins.pinTarget(row.id), t("blueprints.pinned", { name: row.name }));
  const track = (pool: CatalogRow["pools"][number]) =>
    pins.pools.has(pool.pool_key)
      ? act(() => pins.untrack(pool.pool_key), t("blueprints.untracked", { pool: pool.pool_label }))
      : act(() => pins.track(pool.pool_key), t("blueprints.tracked", { pool: pool.pool_label }));

  if (!paired) return <p className="sb-card-sub">{t("pages.pairFirst")}</p>;

  return (
    <div className="sb-page">
      <div className="sb-page-hd">
        <input className="sb-search" type="search" placeholder={t("pages.search")} aria-label={t("pages.search")} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <select aria-label={t("blueprints.category")} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t("blueprints.allCategories")}</option>
          {data?.categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <div className="sb-seg" role="group">
          {(["all", "mine", "missing"] as const).map((s) => (
            <button key={s} type="button" className={show === s ? "on" : ""} onClick={() => setShow(s)}>
              {t(`blueprints.show.${s}`)}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="hint">{notice}</p>}
      <section className="sb-card sb-card-list">
        {data === null ? (
          <p className="sb-card-sub">{t("refinery.loading")}</p>
        ) : data.data.length === 0 ? (
          <p className="sb-card-sub">{t("blueprints.none")}</p>
        ) : (
          <table className="sb-table">
            <thead>
              <tr>
                <th>{t("blueprints.col.name")}</th>
                <th>{t("blueprints.col.type")}</th>
                <th>{t("blueprints.col.grade")}</th>
                <th>{t("blueprints.col.held")}</th>
                <th>{t("blueprints.col.pool")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.data.map((row) => {
                const pool = row.pools.find((p) => p.awardable) ?? row.pools[0];
                return (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td className="sb-muted">{row.type_display ?? row.category_label}</td>
                    <td className="mono">{gradeLabel(row.grade)}</td>
                    <td>
                      {row.is_default ? (
                        <span className="sb-muted">{t("blueprints.default")}</span>
                      ) : (
                        <label className="sb-check" title={row.owners.join(", ")}>
                          <input type="checkbox" checked={row.owned_by_me} onChange={() => void toggleOwned(row)} />
                          {row.owner_count > 0 && <span className="sb-muted">{t("blueprints.orgHolds", { count: row.owner_count })}</span>}
                        </label>
                      )}
                    </td>
                    <td>
                      {pool && (
                        <button
                          type="button"
                          className="sb-link"
                          title={pins.pools.has(pool.pool_key) ? t("blueprints.untrack") : t("blueprints.track")}
                          aria-pressed={pins.pools.has(pool.pool_key)}
                          onClick={() => void track(pool)}
                        >
                          {pins.pools.has(pool.pool_key) && <PinIcon filled />} {pool.pool_label}{" "}
                          <span className="mono sb-dim">{pool.owned_in_pool}/{pool.in_pool}</span>
                        </button>
                      )}
                    </td>
                    <td className="num">
                      <PinToggle pinned={pins.targets.has(row.id)} name={row.name} onToggle={() => void pin(row)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {data && <Pager page={data.current_page} last={data.last_page} total={data.total} onPage={setPage} />}
      </section>
    </div>
  );
}
