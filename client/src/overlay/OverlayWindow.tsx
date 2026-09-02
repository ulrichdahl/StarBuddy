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
  /** Compact single-row content for the top/bottom strip. */
  strip: ReactNode;
}

const isStrip = (m: PlacementMode) => m === "dock-top" || m === "dock-bottom";

/**
 * Chrome shared by every overlay window: glass panel, title bar that
 * drags the native window, the size · placement · opacity · close
 * cluster, and content-fitting (the native window wraps the panel).
 */
export function OverlayWindow({ name, displayName, accent, urgent, eyebrow, title, firstBox, children, strip }: Props) {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<WindowPrefs | null>(null);
  const [pop, setPop] = useState<"none" | "place" | "opacity">("none");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<WindowPrefs>("overlay_prefs", { name }).then(setPrefs).catch(() => setPrefs(null));
  }, [name]);

  // Wrap the native window around the panel whenever its size changes.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || !prefs) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      void invoke("overlay_fit", { width: Math.ceil(r.width), height: Math.ceil(r.height) }).catch(() => {});
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [prefs]);

  const update = useCallback(
    (patch: Partial<Pick<WindowPrefs, "mode" | "size" | "opacity">>) => {
      setPrefs((p) => (p ? { ...p, ...patch } : p));
      void invoke<WindowPrefs>("overlay_update", { name, patch }).then(setPrefs).catch(() => {});
    },
    [name],
  );

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
        onWheel={(e) => {
          e.preventDefault();
          update({ opacity: Math.min(1, Math.max(0.25, prefs.opacity + (e.deltaY < 0 ? 0.05 : -0.05))) });
        }}
      >
        <OpacityIcon />
      </button>
      <button
        type="button"
        className="ov-ib"
        title={t("overlay.close")}
        aria-label={t("overlay.close")}
        onClick={() => void invoke("overlay_close").catch(() => {})}
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
                onChange={(e) => update({ opacity: Number(e.target.value) / 100 })}
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
          {!minimal && children}
        </div>
      )}
    </div>
  );
}
