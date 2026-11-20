import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Paginated } from "./api";
import { Pager, useSearch, useServerList } from "./pageParts";

/** GET /api/item-stacks?mine=1: the player's own item stacks. */
interface ItemStack {
  id: number;
  item_class: string;
  item_name: string | null;
  quality: number | null;
  quantity: number;
  location: { name: string; system?: string | null };
  visibility: "private" | "org";
}
/** GET /api/org/items: org-visible stacks, one row per item. */
interface OrgItemRow {
  key: string;
  name: string;
  total: number;
  holder_count: number;
}

/**
 * My stash: the website's Items page, cut down — what the player holds and
 * where, or what the org has shared, searchable.
 */
export function Items({ paired }: { paired: boolean }) {
  const { t } = useTranslation();
  const [typed, search, setTyped] = useSearch();
  const [org, setOrg] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [search, org]);

  const mine = useServerList<Paginated<ItemStack>>(paired && !org, "/api/item-stacks", {
    mine: 1,
    search: search || undefined,
    sort: "item",
    dir: "asc",
    per_page: 50,
    page,
  });
  const shared = useServerList<Paginated<OrgItemRow>>(paired && org, "/api/org/items", {
    search: search || undefined,
    sort: "name",
    dir: "asc",
    per_page: 50,
    page,
  });
  const list = org ? shared : mine;

  if (!paired) return <p className="sb-card-sub">{t("pages.pairFirst")}</p>;

  return (
    <div className="sb-page">
      <div className="sb-page-hd">
        <input className="sb-search" type="search" placeholder={t("pages.search")} aria-label={t("pages.search")} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <div className="sb-seg" role="group">
          <button type="button" className={org ? "" : "on"} onClick={() => setOrg(false)}>
            {t("items.mine")}
          </button>
          <button type="button" className={org ? "on" : ""} onClick={() => setOrg(true)}>
            {t("items.org")}
          </button>
        </div>
      </div>
      {list.error && <p className="error">{list.error}</p>}
      <section className="sb-card sb-card-list">
        {list.data === null ? (
          <p className="sb-card-sub">{t("refinery.loading")}</p>
        ) : list.data.data.length === 0 ? (
          <p className="sb-card-sub">{t("items.none")}</p>
        ) : org ? (
          <table className="sb-table">
            <thead>
              <tr>
                <th>{t("items.col.item")}</th>
                <th className="num">{t("items.col.quantity")}</th>
                <th className="num">{t("items.col.holders")}</th>
              </tr>
            </thead>
            <tbody>
              {shared.data?.data.map((row) => (
                <tr key={row.key}>
                  <td>{row.name}</td>
                  <td className="num mono">{row.total}</td>
                  <td className="num mono">{row.holder_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="sb-table">
            <thead>
              <tr>
                <th>{t("items.col.item")}</th>
                <th className="num">{t("items.col.quantity")}</th>
                <th className="num">{t("items.col.quality")}</th>
                <th>{t("items.col.location")}</th>
                <th>{t("items.col.shared")}</th>
              </tr>
            </thead>
            <tbody>
              {mine.data?.data.map((s) => (
                <tr key={s.id}>
                  <td title={s.item_class}>{s.item_name ?? s.item_class}</td>
                  <td className="num mono">{s.quantity}</td>
                  <td className="num mono">{s.quality ?? "—"}</td>
                  <td>
                    {s.location.name}
                    {s.location.system && <span className="sb-dim"> · {s.location.system}</span>}
                  </td>
                  <td className="sb-muted">{s.visibility === "org" ? t("items.withOrg") : t("items.private")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.data && <Pager page={list.data.current_page} last={list.data.last_page} total={list.data.total} onPage={setPage} />}
      </section>
    </div>
  );
}
