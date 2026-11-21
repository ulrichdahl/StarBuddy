import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { asSeverity, localTime, onRsiStatus, type RsiStatusUpdate } from "../status";
import type { Section } from "./Shell";
import { kindLabel, type HotkeyInfo, type Reading } from "./types";
import type { Watcher } from "./WatcherPanel";

/** The few fields of a refinery read that Home shows. */
interface LastRead {
  station: string | null;
  captured_at: number;
  orders: {
    state: "setup" | "processing" | "completed";
    duration_seconds: number | null;
    materials: { resource: string; refine: boolean }[];
  }[];
}

/** The overlay windows the player can pin over the game, with their hotkey actions. */
const OVERLAYS = ["status", "scan", "refinery", "pools", "gathering", "orders", "points"] as const;
type Overlay = (typeof OVERLAYS)[number];

const hm = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

function Card({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`sb-card ${className}`}>
      <div className="sb-eyebrow">{label}</div>
      {children}
    </section>
  );
}

/**
 * One of the four status boxes along the top of Home: a dot, a short label,
 * the state and its switch on one line, and what it means under them.
 */
function StatusBox({
  label,
  dot,
  state,
  action,
  children,
}: {
  label: string;
  dot: string;
  state: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="sb-status">
      <div className="sb-status-line">
        <span className={`sb-dot ${dot}`} />
        <span className="sb-eyebrow">{label}</span>
        <span className="sb-status-state">{state}</span>
        {action}
      </div>
      <div className="sb-status-sub">{children}</div>
    </section>
  );
}

/** Servers: the RSI status the client already follows for the status overlay. */
function ServersCard() {
  const { t, i18n } = useTranslation();
  const [update, setUpdate] = useState<RsiStatusUpdate | null>(null);
  useEffect(() => onRsiStatus(setUpdate), []);
  const status = update?.status;
  const worst = status?.active.map((i) => asSeverity(i.severity))[0];
  const dot = !status ? "off" : worst === "down" ? "bad" : worst ? "warn" : "";
  return (
    <StatusBox
      label={t("home.short.servers")}
      dot={dot}
      state={!status ? t("home.unknown") : worst ? t(`status.severity.${worst}`) : t("home.allRunning")}
    >
      {status?.fetched_at ? t("home.checkedAt", { time: localTime(status.fetched_at, i18n.language) }) : update?.error ?? ""}
    </StatusBox>
  );
}

function WatcherCard({ watcher, canStart }: { watcher: Watcher; canStart: boolean }) {
  const { t } = useTranslation();
  return (
    <StatusBox
      label={t("home.short.watcher")}
      dot={watcher.watching ? "" : "off"}
      state={watcher.watching ? t("home.watching") : t("home.notWatching")}
      action={
        <button type="button" className="sb-status-btn" disabled={!canStart && !watcher.watching} onClick={() => void watcher.toggle()}>
          {watcher.watching ? t("home.btn.stop") : t("home.btn.start")}
        </button>
      }
    >
      {watcher.error ?? (watcher.watching ? `${t("home.watcherHint")} ${t("home.synced", { count: watcher.synced })}` : t("home.watcherHint"))}
    </StatusBox>
  );
}

/** Screen reading: whether the game's window is being read, and the switch. */
function ReadingCard({ onSection }: { onSection: (s: Section) => void }) {
  const { t } = useTranslation();
  const [reading, setReading] = useState<Reading | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    invoke<Reading>("screen_reading").then(setReading).catch(() => {});
    const sub = listen<Reading>("screen-reading", (e) => setReading(e.payload)).catch(() => null);
    return () => void sub.then((un) => un?.());
  }, []);
  // Windows asks which window to read in Settings; elsewhere the desktop asks.
  const toggle = async () => {
    if (!reading) return;
    if (!reading.on && reading.picks_from_list) {
      onSection("settings");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setReading(await invoke<Reading>(reading.on ? "screen_reading_stop" : "screen_reading_start", { window: null }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const available = reading?.available !== false;
  return (
    <StatusBox
      label={t("home.short.reading")}
      dot={reading?.on ? "" : "off"}
      state={reading?.on ? t("home.readingOn") : t("home.readingOff")}
      action={
        available && (
          <button type="button" className="sb-status-btn" disabled={busy || !reading} onClick={() => void toggle()}>
            {reading?.on ? t("home.btn.off") : t("home.btn.on")}
          </button>
        )
      }
    >
      {error ??
        reading?.error ??
        (reading?.on && reading.source ? t("home.readingSource", { source: reading.source }) : t("home.readingHint"))}
    </StatusBox>
  );
}

/**
 * Game status for the org: whether org mates see where this player is. Off
 * until the player switches it on, here or under Settings › General.
 */
function PresenceCard() {
  const { t } = useTranslation();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    invoke<boolean>("presence_sharing_get").then(setOn).catch((e) => setError(String(e)));
  }, []);
  const toggle = async () => {
    if (on === null) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("presence_sharing_set", { enabled: !on });
      setOn(!on);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <StatusBox
      label={t("home.short.presence")}
      dot={on ? "" : "off"}
      state={on ? t("home.presenceOn") : t("home.presenceOff")}
      action={
        <button type="button" className="sb-status-btn" disabled={busy || on === null} onClick={() => void toggle()}>
          {on ? t("home.btn.stop") : t("home.btn.share")}
        </button>
      }
    >
      {error ?? (on ? t("home.presenceHintOn") : t("home.presenceHintOff"))}
    </StatusBox>
  );
}

/** The latest refinery read: the station and each order on it. */
function RefineryCard({ onSection }: { onSection: (s: Section) => void }) {
  const { t, i18n } = useTranslation();
  const [last, setLast] = useState<LastRead | null>(null);
  useEffect(() => {
    invoke<LastRead | null>("refinery_last").then((r) => r && setLast(r)).catch(() => {});
    const sub = listen<LastRead>("refinery-order", (e) => setLast(e.payload)).catch(() => null);
    return () => void sub.then((un) => un?.());
  }, []);
  return (
    <Card label={t("home.refinery")} className="sb-card-list">
      <button type="button" className="sb-link sb-card-corner" onClick={() => onSection("refinery")}>
        {t("home.openRefinery")}
      </button>
      {!last || last.orders.length === 0 ? (
        <p className="sb-card-sub">{t("home.noRefinery")}</p>
      ) : (
        <>
          <div className="sb-card-sub">
            {t("home.readAt", {
              station: last.station ?? t("home.unknownStation"),
              time: new Date(last.captured_at).toLocaleString(i18n.language, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }),
            })}
          </div>
          {last.orders.map((o, i) => (
            <div key={i} className="sb-row">
              <span className="sb-row-main">
                {o.materials.filter((m) => m.refine).map((m) => m.resource).join(", ") || t("home.noMaterials")}
              </span>
              <span className="sb-row-side mono">
                {o.state === "completed"
                  ? t("home.ready")
                  : o.duration_seconds !== null
                    ? hm(o.duration_seconds)
                    : t(`overlay.refinery.state.${o.state}`)}
              </span>
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

function EventsCard({ watcher }: { watcher: Watcher }) {
  const { t } = useTranslation();
  return (
    <Card label={t("home.recent")} className="sb-card-list sb-card-fill">
      {watcher.events.length === 0 ? (
        <p className="sb-card-sub">{watcher.watching ? t("home.noEventsYet") : t("home.noEvents")}</p>
      ) : (
        // As tall as the window leaves room for, and scrolls past that.
        <div className="sb-card-scroll">
          {watcher.events.map((e, i) => (
            <div key={`${e.timestamp}-${i}`} className="sb-row">
              <span className="sb-row-time mono">{e.timestamp.slice(11, 16)}</span>
              <span className="sb-row-kind">{kindLabel(t, e.kind)}</span>
              <span className="sb-row-main">{e.detail}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** The hotkey action that opens and closes each overlay window. */
const KEY_ACTION: Record<Overlay, string> = {
  status: "status",
  scan: "overlay-scan",
  refinery: "overlay-refinery",
  pools: "overlay-pools",
  gathering: "overlay-gathering",
  orders: "overlay-orders",
  points: "overlay-points",
};

/**
 * The key that works for an action now, if any: the desktop's when it put one
 * on it, otherwise StarBuddy's own once it is registered. A key that is set
 * but refused or held elsewhere is not shown, since pressing it does nothing.
 */
function activeKey(info: HotkeyInfo | null, action: string): string | null {
  if (!info) return null;
  if (info.triggers[action]) return info.triggers[action];
  return info.live.includes(action) ? info.hotkeys[action] ?? null : null;
}

/** The overlay windows, each switched on or off over the game from here, with its key. */
function OverlaysCard() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<Overlay, boolean>>({
    status: false,
    scan: false,
    refinery: false,
    pools: false,
    gathering: false,
    orders: false,
    points: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [keys, setKeys] = useState<HotkeyInfo | null>(null);
  useEffect(() => {
    const readKeys = () => invoke<HotkeyInfo>("overlay_hotkey").then(setKeys).catch(() => {});
    readKeys();
    // The desktop answers about the keys in its own time.
    const sub = listen("hotkeys-changed", readKeys).catch(() => null);
    return () => void sub.then((un) => un?.());
  }, []);
  useEffect(() => {
    for (const name of OVERLAYS) {
      invoke<{ open: boolean }>("overlay_prefs", { name })
        .then((p) => setOpen((o) => ({ ...o, [name]: p.open })))
        .catch(() => {});
    }
    const sub = listen<[string, boolean]>("overlay-visibility", (e) => {
      const [name, visible] = e.payload;
      if ((OVERLAYS as readonly string[]).includes(name)) setOpen((o) => ({ ...o, [name]: visible }));
    }).catch(() => null);
    return () => void sub.then((un) => un?.());
  }, []);
  const toggle = async (name: Overlay) => {
    setError(null);
    try {
      const now = await invoke<boolean>("overlay_toggle", { name });
      setOpen((o) => ({ ...o, [name]: now }));
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <Card label={t("home.overlays")}>
      <div className="sb-check-grid">
      {OVERLAYS.map((name) => {
        const key = activeKey(keys, KEY_ACTION[name]);
        return (
          <label key={name} className="sb-check">
            <input type="checkbox" checked={open[name]} onChange={() => void toggle(name)} />
            {t(`home.overlay.${name}`)}
            {key && <kbd className="sb-key">{key}</kbd>}
          </label>
        );
      })}
      </div>
      {activeKey(keys, "overlays") && (
        <div className="sb-card-sub sb-keyline">
          {t("home.overlaysAll")} <kbd className="sb-key">{activeKey(keys, "overlays")}</kbd>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </Card>
  );
}

/**
 * Home: how the client is doing at a glance — servers, the log watcher and
 * screen reading — with the latest refinery read, what the log has seen,
 * whether org mates see the player's game status, and the overlay windows to
 * pin over the game.
 */
export function Home({ watcher, canStart, onSection }: { watcher: Watcher; canStart: boolean; onSection: (s: Section) => void }) {
  return (
    <div className="sb-home">
      <div className="sb-status4">
        <ServersCard />
        <WatcherCard watcher={watcher} canStart={canStart} />
        <ReadingCard onSection={onSection} />
        <PresenceCard />
      </div>
      <div className="sb-cols sb-home-body">
        <div className="sb-col sb-col-wide">
          <RefineryCard onSection={onSection} />
          <EventsCard watcher={watcher} />
        </div>
        <div className="sb-col">
          <OverlaysCard />
        </div>
      </div>
    </div>
  );
}
