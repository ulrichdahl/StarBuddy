import { useCallback, useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { serverApi, type Paginated } from "../main-window/api";
import { usePageVisible } from "../visibility";
import "./trackers.css";

/**
 * The website dashboard's trackers: the reward pools being farmed, the
 * gathering list, the open refinery orders and the points scored for the
 * org. Each is a hook that fetches its own data and returns what to draw,
 * so the tracker windows over the game (TrackerOverlays) and the tracker
 * card on Home show exactly the same thing. Kept apart from the overlay
 * frame, so the main window does not load the overlays' code to use them.
 */

export type TrackerKind = "orders" | "pools" | "gathering" | "points";
export const TRACKER_KINDS: readonly TrackerKind[] = ["orders", "pools", "gathering", "points"];

/** What one tracker shows, for whichever frame draws it. */
export interface TrackerView {
  title: string;
  loaded: boolean;
  error: string | null;
  /** One line saying how things stand; null where the rows say it themselves. */
  summary: string | null;
  /** The count beside the summary in a window's first box. */
  count: number | null;
  body: ReactNode;
  /** The body in a window's small size; none means the same as `body`. */
  compact?: ReactNode;
}

const REFRESH_MS = 120_000;

/** One website endpoint, fetched while the window is visible. */
function useServerData<T>(path: string, query?: Record<string, string | number>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = usePageVisible();
  const key = JSON.stringify(query ?? {});
  const load = useCallback(() => {
    serverApi<T>("GET", path, { query: JSON.parse(key) })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [path, key]);
  useEffect(() => {
    if (!visible) return;
    load();
    const id = setInterval(load, REFRESH_MS);
    // The main window says when it changed what this shows (a pool tracked or
    // let go, a blueprint pinned), so the change shows here at once rather
    // than on the next refresh.
    const sub = listen<string>("server-data-changed", (e) => {
      if (e.payload === path) load();
    }).catch(() => null);
    return () => {
      clearInterval(id);
      void sub.then((un) => un?.());
    };
  }, [visible, load, path]);
  return { data, error };
}

const Bar = ({ pct }: { pct: number }) => (
  <span className="ov-bar" aria-hidden="true">
    <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
  </span>
);

const hm = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// ── Tracked reward pools ────────────────────────────────────────────────────

interface TrackedPool {
  pool_key: string;
  pool_label: string;
  factions: string[];
  in_pool: number;
  owned_in_pool: number;
  missing: { blueprint_id: number | null; name: string | null; key: string }[];
  sources: (
    | { kind: "contract"; contractor: string | null; chance: number; missions: { title: string | null; unreleased: boolean }[] }
    | { kind: "event"; event: string; min_points: number }
  )[];
}

export function usePools(): TrackerView {
  const { t } = useTranslation();
  const { data, error } = useServerData<TrackedPool[]>("/api/tracked-pools");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const left = (p: TrackedPool) => p.in_pool - p.owned_in_pool;
  // Fewest missing first, finished last: the next pool to finish is on top.
  const pools = [...(data ?? [])].sort((a, b) => Number(left(a) === 0) - Number(left(b) === 0) || left(a) - left(b));
  const next = pools.find((p) => left(p) > 0) ?? null;
  const summary = next
    ? t("overlay.tracker.pools.next", { pool: next.pool_label, left: left(next) })
    : pools.length
      ? t("overlay.tracker.pools.allDone")
      : t("overlay.tracker.pools.none");

  const body = (
    <div className="ov-trk">
      {pools.map((p) => {
        const open = openKey === p.pool_key;
        const missions = p.sources.flatMap((s) => (s.kind === "contract" ? s.missions : []));
        const events = p.sources.flatMap((s) => (s.kind === "event" ? [s] : []));
        return (
          <div key={p.pool_key} className={`ov-trk-row${left(p) === 0 ? " done" : ""}`}>
            <button type="button" className="ov-trk-head" aria-expanded={open} onClick={() => setOpenKey(open ? null : p.pool_key)}>
              <span className="ov-trk-name">{p.pool_label}</span>
              <Bar pct={p.in_pool ? (p.owned_in_pool / p.in_pool) * 100 : 0} />
              <span className="mono">
                {p.owned_in_pool}/{p.in_pool}
              </span>
            </button>
            {open && (
              <div className="ov-trk-more">
                {p.factions.length > 0 && <div className="ov-dim">{p.factions.join(" · ")}</div>}
                {missions.map((m, i) => (
                  <div key={`m${i}`} className={m.unreleased ? "ov-struck" : undefined}>
                    {m.title ?? t("overlay.tracker.pools.unnamed")}
                  </div>
                ))}
                {events.map((e, i) => (
                  <div key={`e${i}`}>{t("overlay.tracker.pools.event", { event: e.event, points: e.min_points })}</div>
                ))}
                {p.missing.length > 0 && (
                  <div className="ov-chips">
                    {p.missing.map((b) => (
                      <span key={b.key} className="ov-chip">
                        {b.name ?? b.key}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
  return { title: t("overlay.tracker.pools.title"), loaded: data !== null, error, summary, count: pools.length, body };
}

// ── Gathering ───────────────────────────────────────────────────────────────

interface Gathering {
  targets: { blueprint_id: number; name: string; quantity: number; ready: boolean }[];
  gathering: { name: string; unit: "mscu" | "pieces"; need: number; min_quality: number | null; have_mine: number; missing: number }[];
  summary: { materials: number; still_to_gather: number };
}

export function useGathering(): TrackerView {
  const { t } = useTranslation();
  const { data, error } = useServerData<Gathering>("/api/craft-targets");
  const lines = (data?.gathering ?? []).filter((g) => g.missing > 0);
  const amount = (value: number, unit: "mscu" | "pieces") =>
    unit === "mscu" ? `${(value / 1000).toFixed(2)} SCU` : t("overlay.tracker.gathering.pieces", { count: value });
  const summary = data
    ? data.targets.length === 0
      ? t("overlay.tracker.gathering.none")
      : t("overlay.tracker.gathering.still", { still: data.summary.still_to_gather, of: data.summary.materials })
    : "";

  const body = (
    <>
      {data && data.targets.length > 0 && (
        <div className="ov-chips">
          {data.targets.map((target) => (
            <span key={target.blueprint_id} className={`ov-chip${target.ready ? " ov-ready" : ""}`}>
              {target.name} ×{target.quantity}
            </span>
          ))}
        </div>
      )}
      <div className="ov-trk">
        {lines.map((g) => (
          <div key={g.name} className="ov-trk-line">
            <span className="ov-trk-name">
              {g.name}
              {g.min_quality !== null && <span className="ov-dim"> ≥{g.min_quality}</span>}
            </span>
            <Bar pct={g.need ? (g.have_mine / g.need) * 100 : 0} />
            <span className="mono">{amount(g.missing, g.unit)}</span>
          </div>
        ))}
      </div>
    </>
  );
  return { title: t("overlay.tracker.gathering.title"), loaded: data !== null, error, summary, count: data?.summary.still_to_gather ?? 0, body };
}

// ── Refinery orders ─────────────────────────────────────────────────────────

interface Order {
  id: number;
  station: string;
  location: { name: string } | null;
  state: string;
  materials: { resource: string; refine: boolean }[];
  unit: string | null;
  yield_total: number | null;
  placed_at: string | null;
  eta: string | null;
}

/** "Quantainium (Ore)" → "Quantainium": the row says which ores, not their form. */
const oreName = (resource: string) => resource.replace(/\s*\((ore|raw)\)\s*$/i, "");

/**
 * One box per open order, filled from the left as it refines; a ready one is
 * framed green. The first line is the station and the time left, the second
 * the ores and the yield; the small size keeps only the first.
 */
export function useOrders(): TrackerView {
  const { t, i18n } = useTranslation();
  const { data, error } = useServerData<Paginated<Order>>("/api/refinery-orders", { open: 1, per_page: 10, sort: "eta", dir: "asc" });
  const [now, setNow] = useState(() => Date.now());
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [visible]);

  const at = (iso: string | null) => (iso ? new Date(iso).getTime() : null);
  const leftOf = (o: Order) => {
    const eta = at(o.eta);
    return eta === null ? null : Math.round((eta - now) / 1000);
  };
  const isReady = (o: Order) => o.state === "completed" || (leftOf(o) ?? 1) <= 0;
  // Ready to collect first, then by when each is done.
  const orders = [...(data?.data ?? [])].sort((a, b) => Number(isReady(b)) - Number(isReady(a)) || (at(a.eta) ?? Infinity) - (at(b.eta) ?? Infinity));
  const pctOf = (o: Order) => {
    const from = at(o.placed_at);
    const to = at(o.eta);
    if (isReady(o)) return 100;
    if (from === null || to === null || to <= from) return 0;
    return Math.max(0, Math.min(100, ((now - from) / (to - from)) * 100));
  };

  const rows = (small: boolean) =>
    orders.length === 0 ? (
      <p className="trk-none">{t("overlay.tracker.orders.none")}</p>
    ) : (
      <div className="trk-orders">
        {orders.map((o) => {
          const ready = isReady(o);
          const left = leftOf(o);
          const ores = o.materials.filter((m) => m.refine).map((m) => oreName(m.resource));
          const total = o.yield_total !== null ? `${Math.round(o.yield_total).toLocaleString(i18n.language)} ${o.unit ?? "cSCU"}` : null;
          return (
            <div key={o.id} className={`trk-order${ready ? " ready" : ""}`} style={{ ["--p" as string]: `${pctOf(o)}%` }}>
              <span className="trk-order-at">{o.location?.name ?? o.station}</span>
              <span className={ready ? "trk-order-ready" : "mono"}>{ready ? t("overlay.tracker.orders.readyOne") : left !== null ? hm(left) : "—"}</span>
              {!small && (
                <>
                  <span className="trk-order-ores" title={ores.join(", ")}>
                    {ores.join(", ")}
                  </span>
                  <span className="mono">{total}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    );

  const ready = orders.filter(isReady).length;
  const nextUp = orders.find((o) => !isReady(o) && leftOf(o) !== null);
  const summary = !orders.length
    ? t("overlay.tracker.orders.none")
    : ready
      ? t("overlay.tracker.orders.ready", { count: ready })
      : nextUp
        ? t("overlay.tracker.orders.next", { time: hm(leftOf(nextUp)!) })
        : t("overlay.tracker.orders.open", { count: orders.length });
  return { title: t("overlay.tracker.orders.title"), loaded: data !== null, error, summary, count: data?.total ?? 0, body: rows(false), compact: rows(true) };
}

// ── Points ──────────────────────────────────────────────────────────────────

type Metric = "mission" | "refinery" | "travel";
interface Competition {
  orgs: { name: string; points: number; score: number; rank: Record<Metric | "overall", number>; mine: boolean }[];
  contribution: Record<Metric, { mine: number; org: number }> | null;
}

export function usePoints(): TrackerView {
  const { t } = useTranslation();
  const { data, error } = useServerData<Competition>("/api/dashboard/competition", { period: "month" });
  const org = data?.orgs.find((o) => o.mine) ?? null;
  const c = data?.contribution ?? null;
  const mine = c ? c.mission.mine + c.refinery.mine + c.travel.mine : 0;
  const summary = org
    ? t("overlay.tracker.points.rank", { org: org.name, rank: org.rank.overall, count: data?.orgs.length ?? 0 })
    : t("overlay.tracker.points.noOrg");

  const body = c && (
    <div className="ov-trk">
      {(["mission", "refinery", "travel"] as const).map((k) => (
        <div key={k} className="ov-trk-line">
          <span className="ov-trk-name">{t(`overlay.tracker.points.${k}`)}</span>
          <Bar pct={c[k].org ? (c[k].mine / c[k].org) * 100 : 0} />
          <span className="mono">
            {c[k].mine}
            <span className="ov-dim"> / {c[k].org}</span>
          </span>
        </div>
      ))}
    </div>
  );
  return { title: t("overlay.tracker.points.title"), loaded: data !== null, error, summary, count: mine, body };
}

/** The hook for each kind; each kind is its own component, so hooks never switch. */
export const TRACKER_HOOKS: Record<TrackerKind, () => TrackerView> = {
  orders: useOrders,
  pools: usePools,
  gathering: useGathering,
  points: usePoints,
};
