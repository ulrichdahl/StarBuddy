import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { emit } from "@tauri-apps/api/event";
import { serverApi } from "./api";

/**
 * Tell every window that what `path` returns has changed, so a tracker
 * window showing it fetches it again now (TrackerOverlays).
 */
export const changed = (path: string) => void emit("server-data-changed", path).catch(() => {});

/** A push pin, 24-px grid like the overlay glyphs: filled when pinned. */
export function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M9 3h6l-1 6 4 4v2h-5v6l-1 1-1-1v-6H6v-2l4-4z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
      />
    </svg>
  );
}

/**
 * What the player has pinned: blueprints as craft targets (GET
 * /api/craft-targets) and reward pools they track (GET /api/tracked-pools).
 * The lists only say what a row is; this says whether it is pinned, so a
 * pinned row can show it and be unpinned where it is.
 */
export function usePins(paired: boolean) {
  const [targets, setTargets] = useState<Set<number>>(new Set());
  const [pools, setPools] = useState<Set<string>>(new Set());
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!paired) return;
    let live = true;
    serverApi<{ targets: { blueprint_id: number }[] }>("GET", "/api/craft-targets")
      .then((d) => live && setTargets(new Set(d.targets.map((x) => x.blueprint_id))))
      .catch(() => {});
    serverApi<{ pool_key: string }[]>("GET", "/api/tracked-pools")
      .then((d) => live && setPools(new Set(d.map((x) => x.pool_key))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [paired, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const then = (path: string) => (r: unknown) => {
    changed(path);
    return r;
  };
  const pinTarget = (id: number) =>
    serverApi("POST", "/api/craft-targets", { body: { blueprint_id: id, quantity: 1 } }).then(then("/api/craft-targets"));
  const unpinTarget = (id: number) => serverApi("DELETE", `/api/craft-targets/${id}`).then(then("/api/craft-targets"));
  const track = (key: string) => serverApi("POST", "/api/tracked-pools", { body: { pool_key: key } }).then(then("/api/tracked-pools"));
  const untrack = (key: string) =>
    serverApi("DELETE", `/api/tracked-pools/${encodeURIComponent(key)}`).then(then("/api/tracked-pools"));
  return { targets, pools, reload, pinTarget, unpinTarget, track, untrack };
}

/**
 * Pin or unpin a blueprint as a craft target. Pinned, it is the filled pin,
 * and a click unpins it; not pinned, the outline pin, and a click pins it.
 */
export function PinToggle({ pinned, name, onToggle }: { pinned: boolean; name: string; onToggle: () => void }) {
  const { t } = useTranslation();
  const label = pinned ? t("blueprints.unpinLabel", { name }) : t("blueprints.pinLabel", { name });
  return (
    <button type="button" className={`sb-pin${pinned ? " on" : ""}`} aria-pressed={pinned} aria-label={label} title={label} onClick={onToggle}>
      <PinIcon filled={pinned} />
    </button>
  );
}
