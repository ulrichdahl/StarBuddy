import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { asSeverity, localTime, onRsiStatus, type RsiStatusUpdate } from "../status";
import type { Section } from "./Shell";
import { kindLabel, type Reading } from "./types";
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

/** Servers: the RSI status the client already follows for the status overlay. */
function ServersCard() {
  const { t, i18n } = useTranslation();
  const [update, setUpdate] = useState<RsiStatusUpdate | null>(null);
  useEffect(() => onRsiStatus(setUpdate), []);
  const status = update?.status;
  const worst = status?.active.map((i) => asSeverity(i.severity))[0];
  const dot = !status ? "off" : worst === "down" ? "bad" : worst ? "warn" : "";
  return (
    <Card label={t("home.servers")}>
      <div className="sb-card-big">
        <span className={`sb-dot ${dot}`} />
        {!status ? t("home.unknown") : worst ? t(`status.severity.${worst}`) : t("shell.allSystems")}
      </div>
      <div className="sb-card-sub">
        {status?.fetched_at ? t("home.checkedAt", { time: localTime(status.fetched_at, i18n.language) }) : update?.error ?? ""}
      </div>
    </Card>
  );
}

function WatcherCard({ watcher, canStart }: { watcher: Watcher; canStart: boolean }) {
  const { t } = useTranslation();
  return (
    <Card label={t("home.watcher")}>
      <div className="sb-card-big">
        <span className={`sb-dot ${watcher.watching ? "" : "off"}`} />
        {watcher.watching ? t("home.watching") : t("home.notWatching")}
      </div>
      <div className="sb-card-sub">
        {watcher.error ?? (watcher.watching ? t("home.synced", { count: watcher.synced }) : t("home.watcherHint"))}
      </div>
      <button type="button" className="sb-card-btn" disabled={!canStart && !watcher.watching} onClick={() => void watcher.toggle()}>
        {watcher.watching ? t("watcher.stop") : t("watcher.start")}
      </button>
    </Card>
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
    <Card label={t("home.reading")}>
      <div className="sb-card-big">
        <span className={`sb-dot ${reading?.on ? "" : "off"}`} />
        {reading?.on ? t("home.readingOn") : t("home.readingOff")}
      </div>
      <div className="sb-card-sub">{error ?? reading?.error ?? (reading?.on ? reading.source ?? "" : t("home.readingHint"))}</div>
      {available && (
        <button type="button" className="sb-card-btn" disabled={busy || !reading} onClick={() => void toggle()}>
          {reading?.on ? t("home.readingStop") : t("home.readingStart")}
        </button>
      )}
    </Card>
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
    <Card label={t("home.presence")}>
      <div className="sb-card-big">
        <span className={`sb-dot ${on ? "" : "off"}`} />
        {on ? t("home.presenceOn") : t("home.presenceOff")}
      </div>
      <div className="sb-card-sub">{error ?? (on ? t("home.presenceHintOn") : t("home.presenceHintOff"))}</div>
      <button type="button" className="sb-card-btn" disabled={busy || on === null} onClick={() => void toggle()}>
        {on ? t("home.presenceStop") : t("home.presenceStart")}
      </button>
    </Card>
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
    <Card label={t("home.recent")} className="sb-card-list sb-grow">
      {watcher.events.length === 0 ? (
        <p className="sb-card-sub">{watcher.watching ? t("home.noEventsYet") : t("home.noEvents")}</p>
      ) : (
        watcher.events.slice(0, 8).map((e, i) => (
          <div key={`${e.timestamp}-${i}`} className="sb-row">
            <span className="sb-row-time mono">{e.timestamp.slice(11, 16)}</span>
            <span className="sb-row-kind">{kindLabel(t, e.kind)}</span>
            <span className="sb-row-main">{e.detail}</span>
          </div>
        ))
      )}
    </Card>
  );
}

/** The overlay windows, each switched on or off over the game from here. */
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
      {OVERLAYS.map((name) => (
        <label key={name} className="sb-check">
          <input type="checkbox" checked={open[name]} onChange={() => void toggle(name)} />
          {t(`home.overlay.${name}`)}
        </label>
      ))}
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
      <div className="sb-cards3">
        <ServersCard />
        <WatcherCard watcher={watcher} canStart={canStart} />
        <ReadingCard onSection={onSection} />
      </div>
      <div className="sb-cols">
        <div className="sb-col sb-col-wide">
          <RefineryCard onSection={onSection} />
          <EventsCard watcher={watcher} />
        </div>
        <div className="sb-col">
          <PresenceCard />
          <OverlaysCard />
        </div>
      </div>
    </div>
  );
}
