import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { serverApi } from "./api";
import { amount, gradeLabel, Pager, useSearch, useServerList } from "./pageParts";
import { changed, PinToggle, usePins } from "./pins";

/** GET /api/craftability: what the player (and the org's shared stock) can craft. */
interface CraftResult {
  id: number;
  name: string;
  type_display: string | null;
  grade: string | null;
  owned_by_me: boolean;
  craftable: boolean;
  /** 0–1: how much of the recipe the materials at hand cover. */
  coverage: number;
  missing: { name: string; missing: number; unit: "mscu" | "pieces" }[];
  est_output_quality: number | null;
}
interface Craftability {
  results: CraftResult[];
}
interface Crafted {
  crafted: string;
  quantity: number;
  quality: number | null;
  craft_id: number;
}

const PER_PAGE = 50;

/**
 * Craft: the website's craft list, cut down — which recipes the materials
 * at hand cover, what the rest still lacks, and crafting one (with undo).
 * The website works the list out on each ask, which takes a moment, so it
 * is asked once per filter and kept.
 */
export function Craft({ paired }: { paired: boolean }) {
  const { t } = useTranslation();
  const [typed, search, setTyped] = useSearch();
  const [craftableOnly, setCraftableOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [last, setLast] = useState<Crafted | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => setPage(1), [search, craftableOnly]);

  const { data, error, setError, reload } = useServerList<Craftability>(paired, "/api/craftability", {
    search: search || undefined,
    craftable: craftableOnly ? 1 : undefined,
  });
  const results = data?.results ?? [];
  const lastPage = Math.max(1, Math.ceil(results.length / PER_PAGE));
  const shown = useMemo(() => results.slice((page - 1) * PER_PAGE, page * PER_PAGE), [results, page]);

  const pins = usePins(paired);
  const togglePin = async (row: CraftResult) => {
    setError(null);
    try {
      await (pins.targets.has(row.id) ? pins.unpinTarget(row.id) : pins.pinTarget(row.id));
      pins.reload();
    } catch (e) {
      setError(String(e));
    }
  };
  const craft = async (row: CraftResult) => {
    setBusy(row.id);
    setError(null);
    try {
      setLast(await serverApi<Crafted>("POST", `/api/craftability/${row.id}/craft`, { body: { quantity: 1 } }));
      changed("/api/craft-targets");
      reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };
  const undo = async () => {
    if (!last) return;
    try {
      await serverApi("POST", `/api/crafts/${last.craft_id}/undo`);
      changed("/api/craft-targets");
      setLast(null);
      reload();
    } catch (e) {
      setError(String(e));
    }
  };

  if (!paired) return <p className="sb-card-sub">{t("pages.pairFirst")}</p>;

  return (
    <div className="sb-page">
      <div className="sb-page-hd">
        <input className="sb-search" type="search" placeholder={t("pages.search")} aria-label={t("pages.search")} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <div className="sb-seg" role="group">
          <button type="button" className={craftableOnly ? "on" : ""} onClick={() => setCraftableOnly(true)}>
            {t("craft.craftable")}
          </button>
          <button type="button" className={craftableOnly ? "" : "on"} onClick={() => setCraftableOnly(false)}>
            {t("craft.allMine")}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {last && (
        <p className="hint">
          {t("craft.done", { name: last.crafted, quality: last.quality ?? "—" })}{" "}
          <button type="button" className="sb-link" onClick={() => void undo()}>
            {t("craft.undo")}
          </button>
        </p>
      )}
      <section className="sb-card sb-card-list">
        {data === null ? (
          <p className="sb-card-sub">{t("craft.working")}</p>
        ) : results.length === 0 ? (
          <p className="sb-card-sub">{craftableOnly ? t("craft.noneCraftable") : t("craft.none")}</p>
        ) : (
          <table className="sb-table">
            <thead>
              <tr>
                <th>{t("blueprints.col.name")}</th>
                <th>{t("blueprints.col.type")}</th>
                <th>{t("blueprints.col.grade")}</th>
                <th className="num">{t("craft.col.coverage")}</th>
                <th className="num">{t("craft.col.quality")}</th>
                <th>{t("craft.col.missing")}</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="sb-muted">{row.type_display ?? "—"}</td>
                  <td className="mono">{gradeLabel(row.grade)}</td>
                  <td className="num mono">{Math.round(row.coverage * 100)}%</td>
                  <td className="num mono">{row.est_output_quality ?? "—"}</td>
                  <td className="sb-muted">
                    {row.missing
                      .slice(0, 3)
                      .map((m) => `${m.name} ${amount(m.missing, m.unit)}`)
                      .join(", ")}
                    {row.missing.length > 3 ? " …" : ""}
                  </td>
                  <td className="num">
                    <PinToggle pinned={pins.targets.has(row.id)} name={row.name} onToggle={() => void togglePin(row)} />
                  </td>
                  <td className="num">
                    {row.craftable && (
                      <button type="button" disabled={busy !== null} onClick={() => void craft(row)}>
                        {t("craft.craft")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && <Pager page={page} last={lastPage} total={results.length} onPage={setPage} />}
      </section>
    </div>
  );
}
