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
 * It is drawn on a still of the game taken the moment before it opened, rather
 * than being a transparent hole onto the live game. The still is the frame the
 * capture itself produces, so a rectangle drawn on it means exactly what it
 * looks like — and it cannot move while it is being framed. Dragging cuts a
 * clear hole in the dim; the rectangle is stored as fractions of the frame, so
 * the same framing holds at any resolution.
 *
 * The still is shown at its own size and shape, centred on the sheet, because
 * the game's window is not the shape of the screen the sheet covers: stretched
 * to fill, a panel on a window half the desktop's width was drawn twice as
 * wide as it really is, which is a poor thing to aim at. Only a frame bigger
 * than the screen is scaled, and then evenly.
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

  // The area that is stored right now, drawn on the same still. Whether the
  // one in use is the right rectangle is the question the selector is usually
  // opened to answer, and until it was shown the only way to tell was to read
  // a panel and see what came back.
  const [saved, setSaved] = useState<Area | null>(null);
  useEffect(() => {
    invoke<Area | null>("region_current", { purpose }).then(setSaved).catch(() => setSaved(null));
  }, [purpose]);

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

  // Where the still is painted: its own size, centred, shrunk only if it does
  // not fit. Everything else on the sheet is measured against this rather than
  // against the window.
  const [fit, setFit] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!frame) return setFit(null);
    const place = () => {
      const scale = Math.min(1, window.innerWidth / frame.width, window.innerHeight / frame.height);
      const width = frame.width * scale;
      const height = frame.height * scale;
      setFit({ left: (window.innerWidth - width) / 2, top: (window.innerHeight - height) / 2, width, height });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [frame]);

  // Fractions of the frame, not of the sheet — and a drag that wanders off the
  // picture is held at its edge rather than naming an area the frame has not
  // got.
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const pointFromEvent = (event: React.PointerEvent) =>
    fit
      ? { x: clamp((event.clientX - fit.left) / fit.width), y: clamp((event.clientY - fit.top) / fit.height) }
      : { x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight };

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
  // same box the Rust side will store. In sheet pixels, since the frame's
  // fractions are of the picture and the picture is not the whole sheet.
  const place = (x: number, w: number, along: "x" | "y") => {
    const origin = fit ? (along === "x" ? fit.left : fit.top) : 0;
    const span = fit ? (along === "x" ? fit.width : fit.height) : along === "x" ? window.innerWidth : window.innerHeight;
    return { start: origin + Math.min(x, x + w) * span, length: Math.abs(w) * span };
  };
  const rect = (of: Area) => {
    const across = place(of.x, of.w, "x");
    const down = place(of.y, of.h, "y");
    return {
      left: `${across.start}px`,
      top: `${down.start}px`,
      width: `${across.length}px`,
      height: `${down.length}px`,
    };
  };
  const box = area
    ? (() => {
        const across = place(area.x, area.w, "x");
        const down = place(area.y, area.h, "y");
        return {
          left: `${across.start}px`,
          top: `${down.start}px`,
          width: `${across.length}px`,
          height: `${down.length}px`,
        };
      })()
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
      {/* At its own size and shape. The sheet around it stays dark, which is
          also what says which part of the screen the capture actually covers. */}
      {frame && (
        <img
          className="region-frame"
          src={frame.image}
          alt=""
          draggable={false}
          style={fit ? { left: fit.left, top: fit.top, width: fit.width, height: fit.height } : undefined}
        />
      )}

      {/* The area in use, before anything is dragged over it. */}
      {saved && !area && <div className="region-saved" style={rect(saved)} />}

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
        {/* What has to be inside the box, which is not always the panel the
            player is looking at — the refinery's station name lives in the
            title bar above its order. */}
        <span>{t(`overlay.region.need.${purpose}`, "")}</span>
        <span>{error ?? t("overlay.region.hint")}</span>
        {saved && !area && <span className="region-legend">{t("overlay.region.saved")}</span>}
        {frame && <span className="region-source">{frame.source} · {frame.width}×{frame.height}</span>}
      </div>
    </div>
  );
}
