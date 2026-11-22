import { useTranslation } from "react-i18next";
import { OverlayWindow } from "./OverlayWindow";
import { useGathering, useOrders, usePoints, usePools, type TrackerView } from "./trackers";

/**
 * The website dashboard's trackers, each a window over the game. What they
 * show comes from ./trackers, which the Home card uses too. Each asks the
 * website for its own data when it is shown and every few minutes while it
 * stays up; a hidden window asks nothing.
 */

/** A tracker window: the shared frame, and what it says before its data is in. */
function Tracker({ name, view, countBox = true }: { name: string; view: TrackerView; countBox?: boolean }) {
  const { t } = useTranslation();
  const waiting = !view.loaded ? (view.error ? t("overlay.tracker.unreachable") : t("overlay.status.loading")) : null;
  const firstBox = waiting ? (
    <div className="ov-box">
      <span>{waiting}</span>
    </div>
  ) : countBox ? (
    <div className="ov-box acc">
      <span className="mono big">{view.count ?? 0}</span>
      <span>{view.summary}</span>
    </div>
  ) : null;
  return (
    <OverlayWindow
      name={name}
      displayName={view.title}
      accent="ov-accent-none"
      eyebrow={t("overlay.tracker.eyebrow")}
      title={view.title}
      firstBox={firstBox}
      strip={<span className="ov-muted ov-strip-item">{waiting ?? view.summary}</span>}
      compact={!waiting && view.compact}
    >
      {!waiting && view.body}
    </OverlayWindow>
  );
}

export function PoolsOverlay() {
  return <Tracker name="pools" view={usePools()} />;
}

export function GatheringOverlay() {
  return <Tracker name="gathering" view={useGathering()} />;
}

/** The rows say what is ready and when, so no count box above them. */
export function OrdersOverlay() {
  return <Tracker name="orders" view={useOrders()} countBox={false} />;
}

export function PointsOverlay() {
  return <Tracker name="points" view={usePoints()} />;
}
