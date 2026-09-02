import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import "./overlay.css";

interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Frame {
  image: string;
  width: number;
  height: number;
  source: string;
}

/**
 * Full-screen sheet for framing a capture area.
 *
 * It is drawn on a still of the screen taken the moment before it opened,
 * rather than being a transparent hole onto the live game. The still is the
 * frame the capture itself produces, so a rectangle drawn on it means exactly
 * what it looks like — and it cannot move while it is being framed. Dragging
 * cuts a clear hole in the dim; the rectangle is stored as fractions of the
 * frame, so the same framing holds at any resolution.
 *
 * If the grab failed, the sheet stays transparent over the live screen, which
 * is what it always was.
 */
export function RegionSelector() {
  const { t } = useTranslation();
  const purpose = window.__STARBUDDY_PURPOSE__ ?? new URLSearchParams(window.location.search).get("purpose") ?? "refinery";
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<Frame | null>("region_frame").then(setFrame).catch(() => setFrame(null));
  }, []);

  const finish = useCallback(
    (chosen: Area | null) => {
      invoke("region_selected", { purpose, area: chosen }).catch((e: unknown) => {
        // The window stays open on a refusal (too small a drag) so the player
        // can simply drag again rather than reopen the selector.
        setError(String(e));
        setArea(null);
        setStart(null);
      });
    },
    [purpose],
  );

  // Escape cancels, which keeps whatever area was framed before.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    };
    window.addEventListener("keydown", onKey);
    rootRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  const pointFromEvent = (event: React.PointerEvent) => ({
    x: event.clientX / window.innerWidth,
    y: event.clientY / window.innerHeight,
  });

  const onPointerDown = (event: React.PointerEvent) => {
    setError(null);
    const point = pointFromEvent(event);
    setStart(point);
    setArea({ x: point.x, y: point.y, w: 0, h: 0 });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!start) return;
    const point = pointFromEvent(event);
    setArea({ x: start.x, y: start.y, w: point.x - start.x, h: point.y - start.y });
  };

  const onPointerUp = () => {
    if (!start || !area) return;
    setStart(null);
    finish(area);
  };

  // Drawn as a normalised rectangle so a drag in any direction previews the
  // same box the Rust side will store.
  const box = area
    ? {
        left: `${Math.min(area.x, area.x + area.w) * 100}%`,
        top: `${Math.min(area.y, area.y + area.h) * 100}%`,
        width: `${Math.abs(area.w) * 100}%`,
        height: `${Math.abs(area.h) * 100}%`,
      }
    : null;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="region-root"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Stretched to the sheet, so a fraction of the window is the same
          fraction of the captured frame whatever either one measures. */}
      {frame && <img className="region-frame" src={frame.image} alt="" draggable={false} />}

      {/* Four panes of dim around the selection leave the chosen area clear,
          so the player sees the real panel rather than a dimmed copy of it. */}
      {box ? (
        <>
          <div className="region-dim" style={{ left: 0, top: 0, right: 0, height: box.top }} />
          <div className="region-dim" style={{ left: 0, top: box.top, width: box.left, height: box.height }} />
          <div
            className="region-dim"
            style={{ left: `calc(${box.left} + ${box.width})`, top: box.top, right: 0, height: box.height }}
          />
          <div className="region-dim" style={{ left: 0, top: `calc(${box.top} + ${box.height})`, right: 0, bottom: 0 }} />
          <div className="region-box" style={box} />
        </>
      ) : (
        <div className="region-dim" style={{ inset: 0 }} />
      )}

      <div className="region-hint">
        <strong>{t(`overlay.region.title.${purpose}`, t("overlay.region.title.refinery"))}</strong>
        <span>{error ?? t("overlay.region.hint")}</span>
        {frame && <span className="region-source">{frame.source} · {frame.width}×{frame.height}</span>}
      </div>
    </div>
  );
}
