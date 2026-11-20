import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { serverApi, type Paginated } from "./api";

/** The fields of a website refinery order (GET /api/refinery-orders) this list shows. */
interface Order {
  id: number;
  station: string;
  location: { id: number; name: string } | null;
  materials: { resource: string; refine: boolean; yield_amount: number | null }[];
  eta: string | null;
  collected_at: string | null;
  collected_location: { id: number; name: string } | null;
  open: boolean;
}
interface Place {
  id: number;
  name: string;
}

const left = (eta: string | null, now: number) => (eta ? Math.round((new Date(eta).getTime() - now) / 1000) : null);
const hm = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

/**
 * Refinery: the website's order list, cut down to what a player checks in
 * game — what is refining where, how long it has left, and collecting it when
 * it is done. Orders are read at the kiosk with the hotkey; this is the list.
 */
export function Refinery({ paired }: { paired: boolean }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState<{ id: number; place: number | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    if (!paired) return;
    serverApi<Paginated<Order>>("GET", "/api/refinery-orders", {
      query: { open: showAll ? undefined : 1, sort: "eta", dir: "asc", per_page: 50 },
    })
      .then((page) => {
        setOrders(page.data);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [paired, showAll]);

  useEffect(load, [load]);
  // The countdowns move; the list itself is fetched again every few minutes.
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const refetch = window.setInterval(load, 300_000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(refetch);
    };
  }, [load]);

  const startCollect = (o: Order) => {
    setCollecting({ id: o.id, place: o.location?.id ?? null });
    if (places.length === 0) serverApi<Place[]>("GET", "/api/locations").then(setPlaces).catch((e) => setError(String(e)));
  };
  const collect = async () => {
    if (!collecting?.place) return;
    try {
      await serverApi("POST", `/api/refinery-orders/${collecting.id}/collect`, { body: { location_id: collecting.place } });
      setCollecting(null);
      load();
    } catch (e) {
      setError(String(e));
    }
  };

  if (!paired) {
    return <p className="sb-card-sub">{t("refinery.pairFirst")}</p>;
  }
  const refined = (o: Order) =>
    o.materials
      .filter((m) => m.refine && (m.yield_amount ?? 0) > 0)
      .map((m) => m.resource)
      .join(", ") || "—";

  return (
    <div className="sb-page">
      <div className="sb-page-hd">
        <p className="sb-card-sub">{t("refinery.lead")}</p>
        <div className="sb-seg" role="group">
          <button type="button" className={showAll ? "" : "on"} onClick={() => setShowAll(false)}>
            {t("refinery.open")}
          </button>
          <button type="button" className={showAll ? "on" : ""} onClick={() => setShowAll(true)}>
            {t("refinery.all")}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <section className="sb-card sb-card-list">
        {orders === null ? (
          <p className="sb-card-sub">{t("refinery.loading")}</p>
        ) : orders.length === 0 ? (
          <p className="sb-card-sub">{showAll ? t("refinery.none") : t("refinery.noneOpen")}</p>
        ) : (
          <table className="sb-table">
            <thead>
              <tr>
                <th>{t("refinery.col.station")}</th>
                <th>{t("refinery.col.materials")}</th>
                <th>{t("refinery.col.status")}</th>
                <th className="num">{t("refinery.col.time")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const s = left(o.eta, now);
                const ready = o.open && s !== null && s <= 0;
                return (
                  <tr key={o.id}>
                    <td>{o.location?.name ?? o.station}</td>
                    <td>{refined(o)}</td>
                    <td>
                      <span className="sb-state">
                        <span className={`sb-dot ${!o.open ? "off" : ready ? "" : "cyan"}`} />
                        {!o.open
                          ? t("refinery.collectedAt", { place: o.collected_location?.name ?? "—" })
                          : ready
                            ? t("home.ready")
                            : t("refinery.refining")}
                      </span>
                    </td>
                    <td className="num mono">{o.open && s !== null && s > 0 ? hm(s) : "—"}</td>
                    <td className="num">
                      {o.open &&
                        (collecting?.id === o.id ? (
                          <span className="sb-collect">
                            <select
                              aria-label={t("refinery.collectTo")}
                              value={collecting.place ?? ""}
                              onChange={(e) => setCollecting({ id: o.id, place: Number(e.target.value) || null })}
                            >
                              <option value="">{t("refinery.collectTo")}</option>
                              {places.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                            <button type="button" disabled={!collecting.place} onClick={() => void collect()}>
                              {t("refinery.collect")}
                            </button>
                            <button type="button" className="sb-ghost" onClick={() => setCollecting(null)}>
                              ×
                            </button>
                          </span>
                        ) : (
                          <button type="button" className={ready ? "" : "sb-ghost"} onClick={() => startCollect(o)}>
                            {t("refinery.collect")}
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
