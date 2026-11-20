import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  CloseIcon,
  FullIcon,
  MinimalIcon,
  OpacityIcon,
  PLACEMENT_ICONS,
  PickerIcon,
  type PlacementMode,
} from "./icons";
import "./overlay.css";

export type SizeState = "full" | "minimal";

export interface WindowPrefs {
  mode: PlacementMode;
  size: SizeState;
  opacity: number;
  x: number;
  y: number;
  width: number;
  height: number;
  open: boolean;
}

interface Props {
  /** Window id — the Rust side keys prefs on it ("status"). */
  name: string;
  /** Localised window name for the opacity popover. */
  displayName: string;
  /** Accent class: ov-accent-ok | -maintenance | -disrupted | -down | -notice | -none */
  accent: string;
  urgent?: boolean;
  eyebrow: ReactNode;
  title: ReactNode;
  /** The one box that survives Minimal. */
  firstBox: ReactNode;
  /** Everything else, shown in Full. */
  children?: ReactNode;
  /**
   * What Full's content becomes when the window is minimised. Without it,
   * minimising leaves only the first box — which for a panel whose whole
   * purpose is the order underneath means leaving nothing.
   */
  compact?: ReactNode;
  /** Compact single-row content for the top/bottom strip. */
  strip: ReactNode;
  /** A panel holding a table of numbers, which needs more than the usual width. */
  wide?: boolean;
}

const isStrip = (m: PlacementMode) => m === "dock-top" || m === "dock-bottom";

/**
 * Chrome shared by every overlay window: glass panel, title bar that
 * drags the native window, the size · placement · opacity · close
 * cluster, and content-fitting (the native window wraps the panel).
 */
export function OverlayWindow({ name, displayName, accent, urgent, eyebrow, title, firstBox, children, compact, strip, wide }: Props) {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<WindowPrefs | null>(null);
  const [pop, setPop] = useState<"none" | "place" | "opacity">("none");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<WindowPrefs>("overlay_prefs", { name }).then(setPrefs).catch(() => setPrefs(null));
  }, [name]);

  // STARBUDDY_DEBUG_BOUNDS=1 draws the window's real edge, which is otherwise
  // only findable by moving something underneath it and noticing it cannot be
  // clicked.
  useEffect(() => {
    if (window.__STARBUDDY_DEBUG_BOUNDS__) document.documentElement.classList.add("debug-bounds");
  }, []);

  // Wrap the native window around the panel whenever its size changes.
  // Keyed on what can change the panel's size, not on prefs as a whole:
  // each opacity step would otherwise tear down the observer and re-send
  // the fit for a panel that has not moved.
  const loaded = prefs !== null;
  const mode = prefs?.mode;
  const size = prefs?.size;
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !loaded) return;
    // The panel's own box, and nothing else. The scroll extent was used here
    // for a while, to let a window grow around content wider than itself —
    // but it counts anything hanging outside the panel, so the native window
    // ended up taller than what is drawn, and a window is solid to the mouse
    // whether or not it has painted anything there. That surplus swallowed
    // clicks meant for the game below. Panels carry their own width now, so
    // the box is the right measure at both edges.
    let last = "";
    const fit = () => {
      const r = el.getBoundingClientRect();
      const width = Math.ceil(r.width);
      const height = Math.ceil(r.height);
      const now = `${width}x${height}`;
      if (now === last) return;
      last = now;
      void invoke("overlay_fit", { width, height }).catch(() => {});
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded, mode, size]);

  // Opacity not yet written to disk; null when nothing is waiting.
  const pendingOpacity = useRef<number | null>(null);
  const opacityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mode and size change the layout, so they go to Rust at once. A reply
  // that lands while an opacity is still waiting keeps the local opacity,
  // or a drag would flick back to the value on disk.
  const update = useCallback(
    (patch: Partial<Pick<WindowPrefs, "mode" | "size">>) => {
      setPrefs((p) => (p ? { ...p, ...patch } : p));
      void invoke<WindowPrefs>("overlay_update", { name, patch })
        .then((r) => setPrefs((p) => (p && pendingOpacity.current !== null ? { ...r, opacity: p.opacity } : r)))
        .catch(() => {});
    },
    [name],
  );

  const flushOpacity = useCallback(() => {
    if (opacityTimer.current) clearTimeout(opacityTimer.current);
    opacityTimer.current = null;
    const opacity = pendingOpacity.current;
    if (opacity === null) return;
    pendingOpacity.current = null;
    // The reply only echoes what is already on screen; taking it could
    // undo a step made since this one was sent.
    void invoke("overlay_update", { name, patch: { opacity } }).catch(() => {});
  }, [name]);

  // Opacity is purely visual: it applies here at once, and Rust (which
  // re-applies the layout and writes prefs to disk) hears only where a
  // slider drag or wheel spin came to rest.
  const setOpacity = useCallback(
    (next: (current: number) => number) => {
      setPrefs((p) => {
        if (!p) return p;
        const opacity = next(p.opacity);
        pendingOpacity.current = opacity;
        return { ...p, opacity };
      });
      if (opacityTimer.current) clearTimeout(opacityTimer.current);
      opacityTimer.current = setTimeout(flushOpacity, 300);
    },
    [flushOpacity],
  );

  // A window torn down mid-drag still keeps its last opacity.
  useEffect(() => flushOpacity, [flushOpacity]);

  const startDrag = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
    void invoke("overlay_start_drag").catch(() => {});
  };

  useEffect(() => {
    if (pop === "none") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPop("none");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pop]);

  if (!prefs) return null;

  const strip_ = isStrip(prefs.mode);
  const minimal = prefs.size === "minimal";
  const PlaceIcon = PLACEMENT_ICONS[prefs.mode] ?? PickerIcon;
  const modeLabel = t(`overlay.mode.${prefs.mode}`);
  const classes = [
    "ov",
    accent,
    strip_ ? "ov-strip" : "",
    prefs.mode === "dock-bottom" ? "ov-bottom" : "",
    prefs.mode === "dock-left" ? "ov-dock-left" : "",
    prefs.mode === "dock-right" ? "ov-dock-right" : "",
    urgent ? "ov-urgent" : "",
    wide && !strip_ ? "ov-wide" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const cluster = (
    <span className="ov-grp" role="toolbar" aria-label={t("overlay.controls")}>
      <button
        type="button"
        className="ov-ib"
        disabled={strip_}
        title={strip_ ? t("overlay.sizeStrip") : minimal ? t("overlay.expand") : t("overlay.collapse")}
        aria-label={minimal ? t("overlay.expand") : t("overlay.collapse")}
        onClick={() => update({ size: minimal ? "full" : "minimal" })}
      >
        {minimal ? <FullIcon /> : <MinimalIcon />}
      </button>
      <button
        type="button"
        className="ov-ib on"
        title={t("overlay.placement", { mode: modeLabel })}
        aria-label={t("overlay.placement", { mode: modeLabel })}
        aria-expanded={pop === "place"}
        onClick={() => setPop(pop === "place" ? "none" : "place")}
      >
        <PlaceIcon />
      </button>
      <button
        type="button"
        className={`ov-ib${pop === "opacity" ? " on" : ""}`}
        title={t("overlay.opacity")}
        aria-label={t("overlay.opacity")}
        aria-expanded={pop === "opacity"}
        onClick={() => setPop(pop === "opacity" ? "none" : "opacity")}
        // No preventDefault: React wheel listeners are passive, and the body
        // is overflow:hidden, so there is no scroll to stop.
        onWheel={(e) => {
          const step = e.deltaY < 0 ? 0.05 : -0.05;
          setOpacity((o) => Math.min(1, Math.max(0.25, o + step)));
        }}
      >
        <OpacityIcon />
      </button>
      <button
        type="button"
        className="ov-ib"
        title={t("overlay.close")}
        aria-label={t("overlay.close")}
        onClick={() => {
          flushOpacity();
          void invoke("overlay_close").catch(() => {});
        }}
      >
        <CloseIcon />
      </button>
    </span>
  );

  const placeBtn = (mode: PlacementMode) => {
    const Icon = PLACEMENT_ICONS[mode];
    return (
      <button
        type="button"
        className={`ov-ib${prefs.mode === mode ? " on" : ""}`}
        title={t(`overlay.mode.${mode}`)}
        aria-label={t(`overlay.mode.${mode}`)}
        onClick={() => {
          update({ mode });
          setPop("none");
        }}
      >
        <Icon />
      </button>
    );
  };

  return (
    <div ref={rootRef} className={classes} style={{ opacity: prefs.opacity }} onMouseLeave={() => setPop("none")}>
      <div className="ov-tb" onMouseDown={startDrag} onDoubleClick={() => !strip_ && update({ size: minimal ? "full" : "minimal" })}>
        <span className="ov-grip" aria-hidden />
        {strip_ ? (
          <>
            <span className="ov-eyebrow ov-strip-item">{eyebrow}</span>
            <span className="ov-title ov-strip-item">{title}</span>
            {strip}
            <span className="ov-sp" />
          </>
        ) : (
          <div className="ov-tb-text">
            <div className="ov-eyebrow">{eyebrow}</div>
            <div className="ov-title">{title}</div>
          </div>
        )}
        {cluster}
      </div>

      {pop !== "none" && (
        <div className="ov-pops">
          {pop === "place" && (
            <div className="ov-pop ov-pick" role="menu" aria-label={t("overlay.placementTitle")}>
              <span className="e" />
              {placeBtn("dock-top")}
              <span className="e" />
              {placeBtn("dock-left")}
              {placeBtn("floating")}
              {placeBtn("dock-right")}
              <span className="e" />
              {placeBtn("dock-bottom")}
              <span className="e" />
              <span className="ov-pop-lbl">{t("overlay.placementTitle")}</span>
            </div>
          )}
          {pop === "opacity" && (
            <div className="ov-pop ov-opop">
              <div className="ov-opop-h">
                <span className="ov-eyebrow" style={{ color: "var(--muted)" }}>
                  {t("overlay.opacity")}
                </span>
                <span className="mono">{Math.round(prefs.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={25}
                max={100}
                step={5}
                value={Math.round(prefs.opacity * 100)}
                aria-label={t("overlay.opacity")}
                onChange={(e) => {
                  const opacity = Number(e.target.value) / 100;
                  setOpacity(() => opacity);
                }}
              />
              <div className="ov-opop-f">
                <span>25%</span>
                <span>{displayName}</span>
                <span>100%</span>
              </div>
            </div>
          )}
        </div>
      )}

      {!strip_ && (
        <div className="ov-body">
          {firstBox}
          {minimal ? compact : children}
        </div>
      )}
    </div>
  );
}
