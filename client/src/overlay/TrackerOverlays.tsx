import { useCallback, useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { OverlayWindow } from "./OverlayWindow";
import { serverApi, type Paginated } from "../main-window/api";
import { usePageVisible } from "../visibility";

/**
 * The website dashboard's trackers, each a window over the game: the reward
 * pools being farmed, the gathering list, the open refinery orders and the
 * points scored for the org. Each asks the website for its own data when it
 * is shown and every few minutes while it stays up; a hidden window asks
 * nothing.
 */

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

/** A tracker window: the shared frame, and what it says before its data is in. */
function Tracker({
  name,
  title,
  error,
  loaded,
  firstBox,
  strip,
  children,
}: {
  name: string;
  title: string;
  error: string | null;
  loaded: boolean;
  firstBox: ReactNode;
  strip: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const waiting = !loaded ? (error ? t("overlay.tracker.unreachable") : t("overlay.status.loading")) : null;
  return (
    <OverlayWindow
      name={name}
      displayName={title}
      accent="ov-accent-none"
      eyebrow={t("overlay.tracker.eyebrow")}
      title={title}
      firstBox={waiting ? <div className="ov-box"><span>{waiting}</span></div> : firstBox}
      strip={waiting ? <span className="ov-muted ov-strip-item">{waiting}</span> : strip}
    >
      {!waiting && children}
    </OverlayWindow>
  );
}

const Bar = ({ pct }: { pct: number }) => (
  <span className="ov-bar" aria-hidden="true">
    <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
  </span>
);

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

export function PoolsOverlay() {
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

  return (
    <Tracker
      name="pools"
      title={t("overlay.tracker.pools.title")}
      error={error}
      loaded={data !== null}
      firstBox={
        <div className="ov-box acc">
          <span className="mono big">{pools.length}</span>
          <span>{summary}</span>
        </div>
      }
      strip={<span className="ov-muted ov-strip-item">{summary}</span>}
    >
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
    </Tracker>
  );
}

// ── Gathering ───────────────────────────────────────────────────────────────

interface Gathering {
  targets: { blueprint_id: number; name: string; quantity: number; ready: boolean }[];
  gathering: { name: string; unit: "mscu" | "pieces"; need: number; min_quality: number | null; have_mine: number; missing: number }[];
  summary: { materials: number; still_to_gather: number };
}

const amount = (value: number, unit: "mscu" | "pieces") => (unit === "mscu" ? `${(value / 1000).toFixed(2)} SCU` : `${value} pcs`);

export function GatheringOverlay() {
  const { t } = useTranslation();
  const { data, error } = useServerData<Gathering>("/api/craft-targets");
  const lines = (data?.gathering ?? []).filter((g) => g.missing > 0);
  const summary = data
    ? data.targets.length === 0
      ? t("overlay.tracker.gathering.none")
      : t("overlay.tracker.gathering.still", { still: data.summary.still_to_gather, of: data.summary.materials })
    : "";

  return (
    <Tracker
      name="gathering"
      title={t("overlay.tracker.gathering.title")}
      error={error}
      loaded={data !== null}
      firstBox={
        <div className="ov-box acc">
          <span className="mono big">{data?.summary.still_to_gather ?? 0}</span>
          <span>{summary}</span>
        </div>
      }
      strip={<span className="ov-muted ov-strip-item">{summary}</span>}
    >
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
    </Tracker>
  );
}

// ── Refinery orders ─────────────────────────────────────────────────────────

interface Order {
  id: number;
  station: string;
  location: { name: string } | null;
  materials: { resource: string; refine: boolean }[];
  eta: string | null;
}

const hm = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export function OrdersOverlay() {
  const { t } = useTranslation();
  const { data, error } = useServerData<Paginated<Order>>("/api/refinery-orders", { open: 1, per_page: 10, sort: "eta", dir: "asc" });
  const [now, setNow] = useState(() => Date.now());
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [visible]);

  const orders = data?.data ?? [];
  const leftOf = (o: Order) => (o.eta ? Math.round((new Date(o.eta).getTime() - now) / 1000) : null);
  const ready = orders.filter((o) => (leftOf(o) ?? 1) <= 0).length;
  const nextUp = orders.find((o) => (leftOf(o) ?? 0) > 0);
  const summary = !orders.length
    ? t("overlay.tracker.orders.none")
    : ready
      ? t("overlay.tracker.orders.ready", { count: ready })
      : nextUp
        ? t("overlay.tracker.orders.next", { time: hm(leftOf(nextUp)!) })
        : t("overlay.tracker.orders.open", { count: orders.length });

  return (
    <Tracker
      name="orders"
      title={t("overlay.tracker.orders.title")}
      error={error}
      loaded={data !== null}
      firstBox={
        <div className="ov-box acc">
          <span className="mono big">{data?.total ?? 0}</span>
          <span>{summary}</span>
        </div>
      }
      strip={<span className="ov-muted ov-strip-item">{summary}</span>}
    >
      <div className="ov-trk">
        {orders.map((o) => {
          const s = leftOf(o);
          const done = s !== null && s <= 0;
          const refined = o.materials.filter((m) => m.refine).map((m) => m.resource);
          return (
            <div key={o.id} className={`ov-trk-line${done ? " ready" : ""}`}>
              <span className="ov-trk-name" title={refined.join(", ")}>
                {o.location?.name ?? o.station}
                {refined.length > 0 && <span className="ov-dim"> · {refined.slice(0, 3).join(", ")}{refined.length > 3 ? "…" : ""}</span>}
              </span>
              <span className="mono">{done ? t("overlay.tracker.orders.readyOne") : s !== null ? hm(s) : "—"}</span>
            </div>
          );
        })}
      </div>
    </Tracker>
  );
}

// ── Points ──────────────────────────────────────────────────────────────────

type Metric = "mission" | "refinery" | "travel";
interface Competition {
  orgs: { name: string; points: number; score: number; rank: Record<Metric | "overall", number>; mine: boolean }[];
  contribution: Record<Metric, { mine: number; org: number }> | null;
}

export function PointsOverlay() {
  const { t } = useTranslation();
  const { data, error } = useServerData<Competition>("/api/dashboard/competition", { period: "month" });
  const org = data?.orgs.find((o) => o.mine) ?? null;
  const c = data?.contribution ?? null;
  const mine = c ? c.mission.mine + c.refinery.mine + c.travel.mine : 0;
  const summary = org
    ? t("overlay.tracker.points.rank", { org: org.name, rank: org.rank.overall, count: data?.orgs.length ?? 0 })
    : t("overlay.tracker.points.noOrg");

  return (
    <Tracker
      name="points"
      title={t("overlay.tracker.points.title")}
      error={error}
      loaded={data !== null}
      firstBox={
        <div className="ov-box acc">
          <span className="mono big">{mine}</span>
          <span>{summary}</span>
        </div>
      }
      strip={
        <span className="ov-muted ov-strip-item">
          {mine} · {summary}
        </span>
      }
    >
      {c && (
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
      )}
    </Tracker>
  );
}
