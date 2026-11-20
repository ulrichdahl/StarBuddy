import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { serverApi } from "./api";

/** Pages of a list: where we are and the buttons either side. */
export function Pager({ page, last, total, onPage }: { page: number; last: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  if (last <= 1) return <p className="sb-dim">{t("pages.total", { count: total })}</p>;
  return (
    <div className="sb-pager">
      <button type="button" className="sb-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹
      </button>
      <span className="mono">{t("pages.page", { page, last })}</span>
      <button type="button" className="sb-ghost" disabled={page >= last} onClick={() => onPage(page + 1)}>
        ›
      </button>
      <span className="sb-dim">{t("pages.total", { count: total })}</span>
    </div>
  );
}

/** A search box that waits for the player to stop typing. */
export function useSearch(delay = 300): [string, string, (v: string) => void] {
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearch(typed.trim()), delay);
    return () => clearTimeout(id);
  }, [typed, delay]);
  return [typed, search, setTyped];
}

/**
 * One website endpoint for a page: fetched when the query changes, again on
 * reload(). Stale answers (an older query arriving late) are dropped.
 */
export function useServerList<T>(paired: boolean, path: string, query: Record<string, string | number | undefined>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(query);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!paired) return;
    let live = true;
    serverApi<T>("GET", path, { query: JSON.parse(key) })
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [paired, path, key, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, setError, reload };
}

/** mSCU as SCU with up to three decimals; pieces as a count. */
export const amount = (value: number, unit: "mscu" | "pieces") =>
  unit === "mscu" ? `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} SCU` : `${value} pcs`;

/** Blueprint grades are numbers in the data and letters in the game. */
export const gradeLabel = (grade: string | null) => (grade === null ? "—" : ({ "1": "A", "2": "B", "3": "C", "4": "D" } as Record<string, string>)[grade] ?? grade);
