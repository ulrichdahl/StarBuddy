import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { serverApi } from "./api";
import type { Section } from "./Shell";

/** GET /api/craft-targets: the pinned craft targets and what they still need. */
interface Target {
  blueprint_id: number;
  name: string;
  quantity: number;
  materials_missing: number;
  materials_missing_with_org: number;
  ready: boolean;
}
interface Need {
  name: string;
  unit: "mscu" | "pieces";
  need: number;
  min_quality: number | null;
  for_targets: { blueprint_id: number; name: string; quantity: number }[];
  have_mine: number;
  have_org: number;
  have_mine_below: number;
  missing: number;
  missing_with_org: number;
}
interface Gathering {
  targets: Target[];
  gathering: Need[];
  summary: { materials: number; still_to_gather: number; still_to_gather_with_org: number };
  discord: { can_post: boolean };
}

/** mSCU as SCU with two decimals; pieces as a count. */
const amount = (value: number, unit: Need["unit"]) => (unit === "mscu" ? `${(value / 1000).toFixed(2)} SCU` : `${value} pcs`);

/**
 * Gathering: what the pinned craft targets need, against what the player
 * holds at the quality the recipes ask for — the website's /gathering page,
 * in the window over the game.
 */
export function Gathering({ paired, onSection }: { paired: boolean; onSection: (s: Section) => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Gathering | null>(null);
  const [withOrg, setWithOrg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!paired) return;
    serverApi<Gathering>("GET", "/api/craft-targets")
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [paired]);
  useEffect(load, [load]);

  const setQuantity = async (target: Target, quantity: number) => {
    try {
      await serverApi("POST", "/api/craft-targets", { body: { blueprint_id: target.blueprint_id, quantity } });
      load();
    } catch (e) {
      setError(String(e));
    }
  };
  const unpin = async (target: Target) => {
    try {
      await serverApi("DELETE", `/api/craft-targets/${target.blueprint_id}`);
      load();
    } catch (e) {
      setError(String(e));
    }
  };
  const share = async () => {
    setPosted(null);
    try {
      const r = await serverApi<{ posted: number }>("POST", "/api/craft-targets/share", { body: { scope: withOrg ? "org" : "mine" } });
      setPosted(t("gathering.posted", { count: r.posted }));
    } catch (e) {
      setError(String(e));
    }
  };

  if (!paired) return <p className="sb-card-sub">{t("gathering.pairFirst")}</p>;

  const rows = data?.gathering ?? [];
  const still = data ? (withOrg ? data.summary.still_to_gather_with_org : data.summary.still_to_gather) : 0;
  return (
    <div className="sb-page">
      <div className="sb-page-hd">
        <p className="sb-card-sub">{t("gathering.lead")}</p>
        {data?.discord.can_post && (
          <button type="button" className="sb-ghost" disabled={still === 0} onClick={() => void share()}>
            {t("gathering.post")}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {posted && <p className="hint">{posted}</p>}

      <div className="sb-targets">
        {data?.targets.map((target) => {
          const missing = withOrg ? target.materials_missing_with_org : target.materials_missing;
          return (
            <div key={target.blueprint_id} className={`sb-target${missing === 0 ? " done" : ""}`}>
              <div className="sb-target-name">{target.name}</div>
              <div className="sb-target-row">
                <span className="sb-qty">
                  <button type="button" aria-label={t("gathering.less")} disabled={target.quantity <= 1} onClick={() => void setQuantity(target, target.quantity - 1)}>
                    −
                  </button>
                  <span className="mono">×{target.quantity}</span>
                  <button type="button" aria-label={t("gathering.more")} disabled={target.quantity >= 999} onClick={() => void setQuantity(target, target.quantity + 1)}>
                    +
                  </button>
                </span>
                <span className="sb-target-state">{missing === 0 ? t("gathering.ready") : t("gathering.needs", { count: missing })}</span>
                <button type="button" className="sb-target-x" aria-label={t("gathering.unpin", { name: target.name })} onClick={() => void unpin(target)}>
                  ×
                </button>
              </div>
            </div>
          );
        })}
        <button type="button" className="sb-target sb-target-add" onClick={() => onSection("blueprints")}>
          {t("gathering.pin")}
        </button>
      </div>

      <section className="sb-card sb-card-list">
        <div className="sb-card-head">
          <div className="sb-eyebrow">{t("gathering.list")}</div>
          {data && <span className="sb-card-sub">{t("gathering.still", { still, of: data.summary.materials })}</span>}
          <div className="sb-seg" role="group">
            <button type="button" className={withOrg ? "" : "on"} onClick={() => setWithOrg(false)}>
              {t("gathering.mine")}
            </button>
            <button type="button" className={withOrg ? "on" : ""} onClick={() => setWithOrg(true)}>
              {t("gathering.withOrg")}
            </button>
          </div>
        </div>
        {data === null ? (
          <p className="sb-card-sub">{t("refinery.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="sb-card-sub">{t("gathering.empty")}</p>
        ) : (
          <table className="sb-table">
            <thead>
              <tr>
                <th>{t("gathering.col.material")}</th>
                <th className="num">{t("gathering.col.need")}</th>
                <th className="num">{t("gathering.col.quality")}</th>
                <th className="num">{t("gathering.col.mine")}</th>
                <th className="num">{t("gathering.col.org")}</th>
                <th className="num">{t("gathering.col.still")}</th>
                <th>{t("gathering.col.for")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const left = withOrg ? n.missing_with_org : n.missing;
                return (
                  <tr key={n.name} className={left === 0 ? "sb-row-done" : ""}>
                    <td>{n.name}</td>
                    <td className="num mono">{amount(n.need, n.unit)}</td>
                    <td className="num mono">{n.min_quality !== null ? `≥ ${n.min_quality}` : "—"}</td>
                    <td className="num mono" title={n.have_mine_below > 0 ? t("gathering.below", { amount: amount(n.have_mine_below, n.unit) }) : undefined}>
                      {amount(n.have_mine, n.unit)}
                      {n.have_mine_below > 0 && <span className="sb-below">*</span>}
                    </td>
                    <td className="num mono">{amount(n.have_org, n.unit)}</td>
                    <td className="num mono sb-still">{left === 0 ? t("gathering.done") : amount(left, n.unit)}</td>
                    <td className="sb-muted">{n.for_targets.map((f) => (f.quantity > 1 ? `${f.name} ×${f.quantity}` : f.name)).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="sb-dim">{t("gathering.qualityNote")}</p>
      </section>
    </div>
  );
}
