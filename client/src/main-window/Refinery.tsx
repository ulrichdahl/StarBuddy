import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import type { Section } from "./Shell";
import type { Reading } from "./types";

/** The parts of a refinery read this section lists. */
interface Order {
  state: "setup" | "processing" | "completed";
  number: number | null;
  method: string | null;
  materials: { resource: string; refine: boolean; quality: number | null }[];
  duration_seconds: number | null;
  yield_total: number | null;
  unit: string;
}
interface Terminal {
  station: string | null;
  captured_at: number;
  orders: Order[];
}

const hm = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

/**
 * Refinery: the orders on the last terminal read, and the read itself. The
 * order is checked and saved in the refinery window over the game, where the
 * figures sit beside the panel they were read from; this lists what was read
 * and starts a read.
 */
export function Refinery({ onSection }: { onSection: (s: Section) => void }) {
  const { t, i18n } = useTranslation();
  const [last, setLast] = useState<Terminal | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Terminal | null>("refinery_last").then((r) => r && setLast(r)).catch(() => {});
    invoke<Reading>("screen_reading").then(setReading).catch(() => {});
    const subs = [
      listen<Terminal>("refinery-order", (e) => setLast(e.payload)).catch(() => null),
      listen<Reading>("screen-reading", (e) => setReading(e.payload)).catch(() => null),
    ];
    return () => subs.forEach((p) => void p.then((un) => un?.()));
  }, []);

  // The read is shown, checked and saved in the refinery window, so that is
  // opened first and the read lands in it.
  const read = async () => {
    setError(null);
    try {
      await invoke("overlay_show", { name: "refinery" });
      await invoke("refinery_read", { fresh: true });
    } catch (e) {
      setError(String(e));
    }
  };
  const openWindow = () => invoke("overlay_show", { name: "refinery" }).catch((e) => setError(String(e)));

  const orders = last?.orders ?? [];
  return (
    <div className="sb-page">
      <div className="sb-page-hd">
        <p className="sb-card-sub">{t("refinery.lead")}</p>
        <button type="button" className="sb-ghost" onClick={() => void openWindow()}>
          {t("refinery.openWindow")}
        </button>
        <button type="button" disabled={!reading?.on} onClick={() => void read()}>
          {t("refinery.read")} <kbd className="sb-kbd">F8</kbd>
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {reading && !reading.on && (
        <section className="sb-card sb-card-row">
          <div>
            <div className="sb-eyebrow">{t("refinery.readingOffTitle")}</div>
            <p className="sb-card-sub">{t("refinery.readingOffText")}</p>
          </div>
          <button type="button" className="sb-ghost" onClick={() => onSection("settings")}>
            {t("refinery.toSettings")}
          </button>
        </section>
      )}

      <section className="sb-card sb-card-list">
        <div className="sb-eyebrow">
          {last
            ? t("refinery.lastRead", {
                station: last.station ?? t("home.unknownStation"),
                time: new Date(last.captured_at).toLocaleString(i18n.language, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }),
              })
            : t("refinery.nothingYet")}
        </div>
        {orders.length === 0 ? (
          <p className="sb-card-sub">{t("home.noRefinery")}</p>
        ) : (
          <table className="sb-table">
            <thead>
              <tr>
                <th>{t("refinery.col.order")}</th>
                <th>{t("refinery.col.materials")}</th>
                <th>{t("refinery.col.method")}</th>
                <th className="num">{t("refinery.col.yield")}</th>
                <th className="num">{t("refinery.col.time")}</th>
                <th>{t("refinery.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={i}>
                  <td className="mono">{o.number ?? i + 1}</td>
                  <td>{o.materials.filter((m) => m.refine).map((m) => m.resource).join(", ") || t("home.noMaterials")}</td>
                  <td className="sb-muted">{o.method ?? "—"}</td>
                  <td className="num mono">{o.yield_total !== null ? `${o.yield_total} ${o.unit}` : "—"}</td>
                  <td className="num mono">
                    {o.state === "completed" ? "—" : o.duration_seconds !== null ? hm(o.duration_seconds) : "—"}
                  </td>
                  <td>
                    <span className={`sb-state sb-state-${o.state}`}>
                      <span className={`sb-dot ${o.state === "completed" ? "" : o.state === "processing" ? "cyan" : "off"}`} />
                      {o.state === "completed" ? t("home.ready") : t(`overlay.refinery.state.${o.state}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="sb-dim">{t("refinery.historySoon")}</p>
    </div>
  );
}
