import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { OverlayWindow } from "./OverlayWindow";
import "./beacon.css";

// EXPERIMENT: steer to a beacon, like a car's satnav, from the position the
// game prints with r_DisplayInfo. English only until it is decided whether it stays.

/** A beacon as the Rust side tracks it. */
interface Beacon {
  /** The website's id; none for one that was never saved there. */
  id: number | string | null;
  name: string;
  /** The exact SolarSystem zone name: system and shard. */
  shard: string;
  system: string | null;
  /** The frame its position is in: a planet's (`OOC_…`) or the system's. */
  frame: string;
  pos: [number, number, number];
  location: string | null;
  server: string | null;
  /** Who set it, for org members' beacons. */
  owner: string | null;
  mine: boolean;
}
/** A beacon as the website lists it. */
interface ServerBeacon {
  id: number | string;
  name: string;
  shard: string;
  frame: string;
  pos: [number, number, number];
  system: string | null;
  location: string | null;
  server: string | null;
  shared: boolean;
  mine: boolean;
  owner: { id: number; name: string } | null;
}
interface Nav {
  distance: number;
  azimuth: number;
  elevation: number;
  closing: number | null;
  eta: number | null;
  turn: number | null;
  climb: number | null;
}
interface Here {
  shard: string;
  system: string | null;
  frame: string;
  pos: [number, number, number];
  location: string | null;
  server: string | null;
  /** A name for the place, for a new beacon's default name. */
  area: string;
}
interface View {
  status: "off" | "waiting" | "no-text" | "ok" | "";
  age: number | null;
  speed: number | null;
  here: Here | null;
  beacon: Beacon | null;
  nav: Nav | null;
  /** Why there is no way to it: `system` (another system) or `frame` (on a planet you are not near). */
  beacon_elsewhere: "system" | "frame" | null;
  /** Tracked, but with a doubt: `shard` (set on another shard). */
  beacon_warning: "shard" | null;
  held: boolean;
  lines: string[];
}

const STATUS: Record<string, string> = {
  off: "Screen reading is off. Switch it on in StarBuddy.",
  waiting: "Waiting for the game's picture…",
  "no-text": "No position on screen. Type r_DisplayInfo 1 in the game console, or let StarBuddy add it under Settings › Game install.",
};

function distance(m: number): [string, string] {
  if (m < 1000) return [m.toFixed(0), "m"];
  if (m < 100_000) return [(m / 1000).toFixed(1), "km"];
  if (m < 1e8) return [Math.round(m / 1000).toLocaleString("en"), "km"];
  return [(m / 1e9).toFixed(2), "Gm"];
}

function speed(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} m/s`;
  return `${(ms / 1000).toFixed(1)} km/s`;
}

function duration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

/** The one instruction, in words: which way to turn, or to go straight on. */
function instruction(nav: Nav): string {
  if (nav.turn === null) return "Start moving to get a heading";
  const turn = nav.turn;
  const climb = nav.climb ?? 0;
  const parts: string[] = [];
  if (Math.abs(turn) >= 150) parts.push("Turn around");
  else if (Math.abs(turn) >= 5) parts.push(`Turn ${turn > 0 ? "right" : "left"} ${Math.round(Math.abs(turn))}°`);
  if (Math.abs(climb) >= 5 && Math.abs(turn) < 150) parts.push(`${climb > 0 ? "up" : "down"} ${Math.round(Math.abs(climb))}°`);
  if (parts.length === 0) return "Straight ahead";
  const text = parts.join(", ");
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * The arrow points where the beacon is, seen from behind the ship with the
 * way you are going at the top. The bar beside it shows above or below.
 */
function Arrow({ nav }: { nav: Nav }) {
  const moving = nav.turn !== null;
  const angle = moving ? (nav.turn ?? 0) : nav.azimuth;
  const vertical = moving ? (nav.climb ?? 0) : nav.elevation;
  const y = 70 - (Math.max(-90, Math.min(90, vertical)) / 90) * 58;
  const ahead = moving && Math.abs(angle) < 5;
  return (
    <svg className="bc-arrow" viewBox="0 0 170 140" role="img" aria-label="Direction to the beacon">
      <circle cx="70" cy="70" r="62" className="bc-ring" />
      <g transform={`rotate(${angle} 70 70)`} className={ahead ? "bc-on" : undefined}>
        <polygon points="70,14 98,92 70,76 42,92" className="bc-head" />
      </g>
      <line x1="152" y1="12" x2="152" y2="128" className="bc-ring" />
      <line x1="144" y1="70" x2="160" y2="70" className="bc-tick" />
      <polygon points={`138,${y - 7} 138,${y + 7} 151,${y}`} className="bc-head" />
    </svg>
  );
}

const fromServer = (b: ServerBeacon): Beacon => ({
  id: b.id,
  name: b.name,
  shard: b.shard,
  system: b.system,
  frame: b.frame,
  pos: b.pos,
  location: b.location,
  server: b.server,
  owner: b.mine ? null : (b.owner?.name ?? null),
  mine: b.mine,
});

/** `Area18` → `Area18 #3` when #1 and #2 are taken. */
function nextName(area: string, taken: string[]): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const name = `${area} #${n}`;
    if (!used.has(name)) return name;
  }
}

const planetOf = (frame: string) => (frame.startsWith("OOC_") ? frame.replace(/^OOC_[A-Za-z]+_?\d*[a-z]?_?/, "") || frame : null);

/**
 * The player's own beacons: rename, share with the org or stop sharing, and
 * delete. Org mates' beacons are theirs to change; import and export are on
 * the website.
 */
function Manage({
  mine,
  trackedId,
  onChanged,
  onTracked,
}: {
  mine: ServerBeacon[];
  trackedId: string | null;
  onChanged: () => void;
  onTracked: (b: ServerBeacon | null) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = async (b: ServerBeacon, body: { name?: string; shared?: boolean }) => {
    setError(null);
    setBusy(String(b.id));
    try {
      const r = await invoke<{ data: ServerBeacon }>("server_api", { method: "PATCH", path: `/api/beacons/${b.id}`, body });
      if (String(b.id) === trackedId) onTracked(r.data);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
    setBusy(null);
  };
  const remove = async (b: ServerBeacon) => {
    setError(null);
    setBusy(String(b.id));
    try {
      await invoke("server_api", { method: "DELETE", path: `/api/beacons/${b.id}` });
      if (String(b.id) === trackedId) onTracked(null);
      onChanged();
    } catch (e) {
      setError(String(e));
    }
    setConfirm(null);
    setBusy(null);
  };

  if (mine.length === 0) return <p className="ov-p ov-dim">You have no beacons saved on the website yet.</p>;
  return (
    <div className="bc-manage">
      <p className="ov-p ov-dim">Click a name to rename it.</p>
      {mine.map((b) => {
        const id = String(b.id);
        const edit = editing?.id === id ? editing : null;
        return (
          <div key={id} className="bc-row">
            {edit ? (
              <form
                className="bc-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = edit.name.trim();
                  setEditing(null);
                  if (name && name !== b.name) void patch(b, { name });
                }}
              >
                <input
                  autoFocus
                  value={edit.name}
                  maxLength={80}
                  aria-label="New name"
                  onChange={(e) => setEditing({ id, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                />
                <button type="submit" className="ov-primary">
                  Save
                </button>
              </form>
            ) : (
              <button type="button" className="bc-name" title="Rename" onClick={() => setEditing({ id, name: b.name })}>
                {b.name}
              </button>
            )}
            <label className="bc-check" title="Org mates can steer to it">
              <input type="checkbox" checked={b.shared} disabled={busy === id} onChange={(e) => void patch(b, { shared: e.target.checked })} />
              Shared
            </label>
            {confirm === id ? (
              <button type="button" className="bc-del" disabled={busy === id} onClick={() => void remove(b)}>
                Delete?
              </button>
            ) : (
              <button type="button" className="bc-x" aria-label={`Delete ${b.name}`} title="Delete" onClick={() => setConfirm(id)}>
                ×
              </button>
            )}
          </div>
        );
      })}
      {error && <p className="ov-p ov-err">{error}</p>}
    </div>
  );
}

export function BeaconOverlay() {
  const [view, setView] = useState<View | null>(null);
  const [list, setList] = useState<ServerBeacon[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; shared: boolean } | null>(null);
  const [details, setDetails] = useState(false);
  const [managing, setManaging] = useState(false);
  const reportedShard = useRef<string | null>(null);

  const load = useCallback(() => {
    invoke<{ data: ServerBeacon[] }>("server_api", { method: "GET", path: "/api/beacons" })
      .then((r) => {
        setList(r.data);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, []);

  useEffect(() => {
    invoke<View>("location_view").then(setView).catch(() => {});
    load();
    const subs = [
      listen<View>("location-view", (e) => setView(e.payload)),
      // The "set beacon" hotkey: save at once, with the default name.
      listen("location-set-request", () => setRequest((n) => n + 1)),
    ];
    const every = window.setInterval(load, 60_000);
    return () => {
      window.clearInterval(every);
      subs.forEach((s) => void s.then((un) => un()).catch(() => {}));
    };
  }, [load]);

  // Tell the website which shard we are on, so an import there can warn.
  const shard = view?.here?.shard ?? null;
  useEffect(() => {
    if (!shard || shard === reportedShard.current) return;
    reportedShard.current = shard;
    invoke("server_api", { method: "PUT", path: "/api/me/shard", body: { shard } }).catch(() => {});
  }, [shard]);

  const here = view?.here ?? null;
  const stale = view?.age != null && view.age > 3;
  const beacon = view?.beacon ?? null;
  const nav = view?.nav ?? null;
  const mine = (list ?? []).filter((b) => b.mine);
  const org = (list ?? []).filter((b) => !b.mine);

  const track = (b: Beacon | null) => {
    setError(null);
    invoke<View>("location_track", { beacon: b })
      .then(setView)
      .catch((e) => setError(String(e)));
  };

  const save = useCallback(
    async (name: string, shared: boolean) => {
      setError(null);
      if (!here) return;
      const body = {
        name: name.trim() || here.area,
        shard: here.shard,
        frame: here.frame,
        pos: here.pos,
        system: here.system,
        location: here.location,
        server: here.server,
        shared,
      };
      let saved: Beacon;
      try {
        const r = await invoke<{ data: ServerBeacon }>("server_api", { method: "POST", path: "/api/beacons", body });
        saved = fromServer(r.data);
        load();
      } catch {
        // Not paired or offline: track it here only.
        saved = { ...body, id: null, owner: null, mine: true };
        setError("Not saved on the website (offline or not signed in): tracked here only.");
      }
      setDraft(null);
      invoke<View>("location_track", { beacon: saved }).then(setView).catch((e) => setError(String(e)));
    },
    [here, load],
  );

  // The hotkey asks for a beacon with the default name.
  const [request, setRequest] = useState(0);
  useEffect(() => {
    if (request > 0 && here && !stale) void save(nextName(here.area, mine.map((b) => b.name)), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const startDraft = () => {
    if (!here) return;
    setDraft({ name: nextName(here.area, mine.map((b) => b.name)), shared: false });
  };

  const choose = (value: string) => {
    if (value === "") return track(null);
    const b = list?.find((x) => String(x.id) === value);
    if (b) track(fromServer(b));
  };

  const message = view && view.status !== "ok" ? STATUS[view.status] : null;
  const [dist, unit] = nav ? distance(nav.distance) : ["—", ""];
  const selected = beacon?.id != null ? String(beacon.id) : beacon ? "local" : "";

  let warning: string | null = null;
  if (beacon && view?.beacon_elsewhere === "system") warning = `${beacon.name} is in ${beacon.system ?? "another system"}.`;
  else if (beacon && view?.beacon_elsewhere === "frame")
    warning = `${beacon.name} is on ${planetOf(beacon.frame) ?? "a planet"}. Fly there to get directions.`;
  const shardNote =
    beacon && view?.beacon_warning === "shard"
      ? "Set on another shard: the spot is the same, but what was left there may not be."
      : null;

  return (
    <OverlayWindow
      name="beacon"
      displayName="Beacon"
      accent={nav ? (shardNote ? "ov-accent-notice" : "ov-accent-ok") : "ov-accent-none"}
      eyebrow="Beacon · experimental"
      title={beacon?.name ?? "No beacon"}
      firstBox={
        nav ? (
          <div className="bc-gps">
            <Arrow nav={nav} />
            <div className="bc-readout">
              <div className="bc-dist">
                <span>{dist}</span>
                <small>{unit}</small>
              </div>
              <div className="bc-instr">{instruction(nav)}</div>
              <div className="bc-eta ov-dim">
                {nav.eta != null ? `Arrive in ${duration(nav.eta)}` : nav.closing != null && nav.closing < 0 ? "Moving away" : "\u00a0"}
              </div>
            </div>
          </div>
        ) : (
          <div className="ov-box">
            <span>{message ?? warning ?? (beacon ? "Waiting for a position…" : "Pick a beacon or set one here.")}</span>
          </div>
        )
      }
      strip={
        <>
          <span className="ov-strip-item">{beacon?.name ?? "No beacon"}</span>
          {nav && <span className="ov-strip-item mono">{`${dist} ${unit}`}</span>}
          {nav?.eta != null && <span className="ov-strip-item mono">{duration(nav.eta)}</span>}
        </>
      }
    >
      {shardNote && <p className="ov-p ov-warn">{shardNote}</p>}
      {stale && view?.status === "ok" && <p className="ov-p ov-dim">Position lost {Math.round(view.age ?? 0)} s ago.</p>}

      <div className="bc-status ov-dim">
        <span>{here ? here.area : "—"}</span>
        <span className="mono">{view?.speed != null ? speed(view.speed) : ""}</span>
      </div>

      {draft ? (
        <form
          className="bc-draft"
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft.name, draft.shared);
          }}
        >
          <input
            autoFocus
            value={draft.name}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            aria-label="Beacon name"
          />
          <label className="bc-check">
            <input type="checkbox" checked={draft.shared} onChange={(e) => setDraft({ ...draft, shared: e.target.checked })} />
            Share with my org
          </label>
          <div className="ov-actions">
            <button type="submit" className="ov-primary" disabled={!here || stale}>
              Save beacon
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="ov-actions bc-pick">
          <select value={selected} onChange={(e) => choose(e.target.value)} aria-label="Beacon to steer to">
            <option value="">No beacon</option>
            {selected === "local" && beacon && <option value="local">{beacon.name}</option>}
            {mine.length > 0 && (
              <optgroup label="Mine">
                {mine.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            )}
            {org.length > 0 && (
              <optgroup label="Org">
                {org.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.name} · {b.owner?.name ?? "?"}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button type="button" className="ov-primary" disabled={!here || stale} onClick={startDraft}>
            Set beacon here
          </button>
        </div>
      )}
      {offline && <p className="ov-p ov-dim">Not connected to the website: only beacons set here can be used.</p>}
      {error && <p className="ov-p ov-err">{error}</p>}

      {managing && list && (
        <Manage
          mine={mine}
          trackedId={beacon?.id != null ? String(beacon.id) : null}
          onChanged={load}
          onTracked={(b) => track(b ? fromServer(b) : null)}
        />
      )}

      <div className="bc-links">
        {list && (
          <button type="button" className="bc-more ov-dim" onClick={() => setManaging((m) => !m)}>
            {managing ? "Done" : "My beacons"}
          </button>
        )}
        <button type="button" className="bc-more ov-dim" onClick={() => setDetails((d) => !d)}>
          {details ? "Hide details" : "Details"}
        </button>
      </div>
      {details && view && (
        <pre className="bc-raw">
          {here && `${here.shard} · ${here.frame}\n${here.pos.map((v) => v.toFixed(0)).join(" ")} m\n${here.server ?? ""}\n`}
          {beacon && `beacon ${beacon.shard} · ${beacon.frame}${beacon.owner ? ` · by ${beacon.owner}` : ""}\n`}
          {view.held && "holding: last readings did not add up\n"}
          {view.lines.join("\n")}
        </pre>
      )}
    </OverlayWindow>
  );
}
