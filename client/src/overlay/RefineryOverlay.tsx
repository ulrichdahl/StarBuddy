import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { OverlayWindow } from "./OverlayWindow";

type OrderState = "setup" | "processing" | "completed";

interface OrderMaterial {
  resource: string;
  quality: number | null;
  qty: number | null;
  yield_amount: number | null;
  to_do: number | null;
  done: number | null;
  refine: boolean;
}

interface WorkOrder {
  state: OrderState;
  number: number | null;
  method: string | null;
  method_traits: string | null;
  materials: OrderMaterial[];
  cost: number | null;
  duration_seconds: number | null;
  yield_total: number | null;
  in_manifest: number | null;
  to_refine: number | null;
  /** The unit every amount here is counted in — the terminal works in cSCU. */
  unit: string;
}

interface RefineryTerminal {
  station: string | null;
  orders: WorkOrder[];
  ship: string | null;
  capacity_percent: number | null;
  specializations: { material: string; bonus_percent: number | null }[];
  captured_at: number;
  elapsed_ms: number;
  missing: string[];
  captures: number;
  lines: { text: string; x: number; y: number; w: number; h: number }[];
}

interface RefineryStatus {
  phase: "idle" | "downloading" | "capturing" | "ocr" | "done" | "error";
  detail: string;
}

/**
 * Which columns a state's table actually uses, in the order the terminal and
 * the website's own order sheet print them: quality, what went in, what comes
 * back. A column the panel does not show is left out rather than shown empty.
 */
const COLUMNS: Record<OrderState, (keyof OrderMaterial)[]> = {
  setup: ["quality", "qty", "yield_amount"],
  processing: ["quality", "yield_amount", "to_do", "done"],
  completed: ["quality", "yield_amount"],
};

/** Quality tier, for the same colour the website gives the number. */
function qualityTier(quality: number | null): string | null {
  if (quality === null) return null;
  if (quality >= 900) return "legendary";
  if (quality >= 800) return "epic";
  if (quality >= 700) return "rare";
  if (quality >= 600) return "uncommon";
  if (quality >= 500) return "common";
  return "poor";
}

/**
 * The refinery window: read the terminal, check what was read, save an order.
 *
 * OCR gets the shape of a panel right far more often than every digit, so
 * everything is editable and anything the parser could not find is called out
 * rather than left blank and hoped over. A terminal can show several work
 * orders at once, so each is saved on its own. Nothing reaches the server until
 * Save is pressed.
 */
export function RefineryOverlay() {
  const { t, i18n } = useTranslation();
  const [terminal, setTerminal] = useState<RefineryTerminal | null>(null);
  const [status, setStatus] = useState<RefineryStatus>({ phase: "idle", detail: "" });
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savedIndexes, setSavedIndexes] = useState<number[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showLines, setShowLines] = useState(false);

  useEffect(() => {
    invoke<RefineryTerminal | null>("refinery_last").then((r) => r && setTerminal(r)).catch(() => {});
    const subs = [
      listen<RefineryStatus>("refinery-status", (e) => setStatus(e.payload)),
      listen<RefineryTerminal>("refinery-order", (e) => {
        setTerminal(e.payload);
        // A fresh read describes a different screen; earlier saves no longer
        // describe what is shown.
        setSavedIndexes([]);
        setSaveError(null);
      }),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, []);

  const busy = status.phase === "downloading" || status.phase === "capturing" || status.phase === "ocr";

  const read = (fresh: boolean) => {
    if (busy) return;
    void invoke("refinery_read", { fresh }).catch(() => {});
  };

  const startOver = () => {
    void invoke("refinery_clear").catch(() => {});
    setTerminal(null);
    setSavedIndexes([]);
    setSaveError(null);
  };

  // The selector refuses when it cannot get a picture of the game to draw on,
  // and that refusal says what to do about it — so it goes where the read's
  // own errors go rather than being swallowed.
  const pickArea = () =>
    void invoke("region_select", { purpose: "refinery" }).catch((e: unknown) =>
      setStatus({ phase: "error", detail: String(e) }),
    );

  const save = (index: number) => {
    if (!terminal || savingIndex !== null) return;
    setSavingIndex(index);
    setSaveError(null);
    invoke("refinery_save", { terminal, order: terminal.orders[index] })
      .then(() => setSavedIndexes((seen) => [...seen, index]))
      .catch((e: unknown) => setSaveError(String(e)))
      .finally(() => setSavingIndex(null));
  };

  const patchTerminal = (change: Partial<RefineryTerminal>) => {
    setTerminal((current) => (current ? { ...current, ...change } : current));
    setSavedIndexes([]);
  };

  const patchOrder = (index: number, change: Partial<WorkOrder>) => {
    setTerminal((current) => {
      if (!current) return current;
      const orders = current.orders.map((o, i) => (i === index ? { ...o, ...change } : o));
      return { ...current, orders };
    });
    setSavedIndexes((seen) => seen.filter((i) => i !== index));
  };

  const patchMaterial = (orderIndex: number, rowIndex: number, change: Partial<OrderMaterial>) => {
    setTerminal((current) => {
      if (!current) return current;
      const orders = current.orders.map((order, i) =>
        i === orderIndex
          ? { ...order, materials: order.materials.map((m, j) => (j === rowIndex ? { ...m, ...change } : m)) }
          : order,
      );
      return { ...current, orders };
    });
    setSavedIndexes((seen) => seen.filter((i) => i !== orderIndex));
  };

  const numberOrNull = (raw: string) => {
    const value = Number(raw.replace(",", "."));
    return raw.trim() === "" || Number.isNaN(value) ? null : value;
  };

  const fmt = (n: number | null) => (n === null ? "" : n.toLocaleString(i18n.language));

  /** "1d 7m 45s" back into seconds; a bare number is minutes. */
  const parseDuration = (text: string): number | null => {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === "") return null;
    if (/^\d+([.,]\d+)?$/.test(trimmed)) return Math.round(Number(trimmed.replace(",", ".")) * 60);
    const units: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
    let total = 0;
    let matched = false;
    for (const [, value, unit] of trimmed.matchAll(/(\d+(?:[.,]\d+)?)\s*([dhms])/g)) {
      total += Number(value.replace(",", ".")) * units[unit];
      matched = true;
    }
    return matched ? Math.round(total) : null;
  };

  const duration = (seconds: number | null) => {
    if (seconds === null) return t("overlay.refinery.unknown");
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join(" ") || "0s";
  };

  const phaseText =
    status.phase === "idle" || status.phase === "done"
      ? null
      : t(`overlay.refinery.phase.${status.phase}`, { detail: status.detail });

  // The station belongs to the terminal rather than to any one order, but it
  // is read and corrected alongside the method, so it is shown with it: two
  // fields, one box, labels in a column.
  const stationField = terminal ? (
    <label className="ov-field ov-grow">
      <span>{t("overlay.refinery.field.station")}</span>
      <input
        value={terminal.station ?? ""}
        placeholder={t("overlay.refinery.stationPlaceholder")}
        onChange={(e) => patchTerminal({ station: e.target.value || null })}
      />
    </label>
  ) : null;

  const firstBox = (
    <div className="ov-box">
      {phaseText && <div className="ov-phase">{phaseText}</div>}
      {status.phase === "error" && <div className="ov-error">{status.detail}</div>}
      {!terminal && !phaseText && <div className="ov-empty">{t("overlay.refinery.empty")}</div>}

      {terminal && (
        <>
          {terminal.missing.length > 0 && (
            <div className="ov-warn">
              {t("overlay.refinery.check", {
                fields: terminal.missing.map((f) => t(`overlay.refinery.field.${f}`, f)).join(", "),
              })}
            </div>
          )}
          {/* With no order read there is no box to put it in, so it stays
              here — the station is worth correcting even when the rest of the
              panel was missed. */}
          {terminal.orders.length === 0 && stationField}
        </>
      )}
    </div>
  );

  return (
    <OverlayWindow
      name="refinery"
      wide
      displayName={t("overlay.refinery.title")}
      accent={status.phase === "error" ? "ov-accent-down" : terminal?.missing.length ? "ov-accent-notice" : "ov-accent-ok"}
      eyebrow={t("overlay.refinery.eyebrow")}
      title={t("overlay.refinery.title")}
      firstBox={firstBox}
      strip={
        <span>
          {terminal?.station ?? t("overlay.refinery.title")}
          {terminal?.orders.length ? ` · ${terminal.orders.length}` : ""}
        </span>
      }
    >
      {terminal?.orders.map((order, index) => {
        const columns = COLUMNS[order.state];
        const totals = columns.map((column) =>
          order.materials.reduce((sum, m) => sum + ((m[column] as number | null) ?? 0), 0),
        );
        return (
        <div className="ov-box" key={index}>
          <div className="ov-box-title">
            {t(`overlay.refinery.state.${order.state}`)}
            {order.number !== null && ` · #${order.number}`}
          </div>

          <div className="ov-fields">
            {index === 0 && stationField}
            {order.state === "setup" && (
              <label className="ov-field ov-grow">
                <span>{t("overlay.refinery.field.method")}</span>
                <input
                  value={order.method ?? ""}
                  onChange={(e) => patchOrder(index, { method: e.target.value || null })}
                />
              </label>
            )}
          </div>

          {order.materials.length > 0 && (
            <table className="ov-table ov-refinery-table">
              <thead>
                <tr>
                  <th>{t("overlay.refinery.material")}</th>
                  {columns.map((column) => (
                    <th key={column}>
                      {t(`overlay.refinery.column.${column}`)}
                      {column !== "quality" && ` (${order.unit})`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.materials.map((material, rowIndex) => (
                  <tr key={rowIndex} className={material.refine ? undefined : "ov-off"}>
                    <td>
                      <input
                        value={material.resource}
                        title={material.refine ? undefined : t("overlay.refinery.notRefined")}
                        onChange={(e) => patchMaterial(index, rowIndex, { resource: e.target.value })}
                      />
                    </td>
                    {columns.map((column) => (
                      <td key={column}>
                        <input
                          inputMode="decimal"
                          className={
                            column === "quality"
                              ? `ov-num ov-quality ov-rarity-${qualityTier(material.quality) ?? "poor"}`
                              : "ov-num"
                          }
                          value={fmt(material[column] as number | null)}
                          onChange={(e) =>
                            patchMaterial(index, rowIndex, { [column]: numberOrNull(e.target.value) })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {/* The sums the panel prints under its own table, so a row read
                  wrong shows up as a total that does not match the screen. */}
              <tfoot>
                <tr>
                  <th>{t("overlay.refinery.total")}</th>
                  {columns.map((column, i) => (
                    <td key={column} className="ov-num">
                      {column === "quality" ? "" : fmt(totals[i])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          )}

          {/* Cost and the clock, in the order the website's own sheet asks for
              them, and editable for the same reason every other number is. */}
          <div className="ov-pair">
            <label className="ov-field">
              <span>{order.state === "setup" ? t("overlay.refinery.duration") : t("overlay.refinery.remaining")}</span>
              <input
                className="ov-num"
                value={duration(order.duration_seconds)}
                onChange={(e) => patchOrder(index, { duration_seconds: parseDuration(e.target.value) })}
              />
            </label>
            <label className="ov-field">
              <span>{t("overlay.refinery.cost")}</span>
              <input
                className="ov-num"
                inputMode="decimal"
                value={fmt(order.cost)}
                onChange={(e) => patchOrder(index, { cost: numberOrNull(e.target.value) })}
              />
            </label>
          </div>

          {order.yield_total !== null && (
            <div className="ov-row ov-dim">
              <span>{t("overlay.refinery.yieldTotal")}</span>
              <span className="ov-num">
                {fmt(order.yield_total)} {order.unit}
              </span>
            </div>
          )}

          <div className="ov-actions ov-actions-commit">
            <button
              className="ov-primary"
              onClick={() => save(index)}
              disabled={!terminal.station || savingIndex !== null}
            >
              {savingIndex === index
                ? t("overlay.refinery.saving")
                : savedIndexes.includes(index)
                  ? t("overlay.refinery.savedShort")
                  : t("overlay.refinery.save")}
            </button>
          </div>
        </div>
        );
      })}

      {terminal && (
        <div className="ov-box">
          <div className="ov-row ov-dim">
            <span>
              {t("overlay.refinery.orderCount", { count: terminal.orders.length })}
              {terminal.captures > 1 && ` · ${t("overlay.refinery.captures", { count: terminal.captures })}`}
              {" · "}
              {t("overlay.refinery.readIn", { ms: terminal.elapsed_ms })}
            </span>
            <button className="ov-link" onClick={() => setShowLines((v) => !v)}>
              {t(showLines ? "overlay.refinery.hideLines" : "overlay.refinery.showLines", {
                count: terminal.lines.length,
              })}
            </button>
          </div>
          {showLines && (
            <div className="ov-lines">
              {terminal.lines.map((line, i) => (
                <div key={i}>{line.text}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="ov-box ov-actions">
        <button onClick={() => read(false)} disabled={busy}>
          {busy ? t("overlay.refinery.reading") : t("overlay.refinery.readMore")}
        </button>
        <button onClick={() => read(true)} disabled={busy}>
          {t("overlay.refinery.read")}
        </button>
        <button onClick={pickArea}>{t("overlay.refinery.pickArea")}</button>
        {terminal && <button onClick={startOver}>{t("overlay.refinery.startOver")}</button>}
      </div>

      {saveError && <div className="ov-box ov-error">{saveError}</div>}
    </OverlayWindow>
  );
}
