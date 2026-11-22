// Video preview stub: no Tauri here. Server calls go to the local dev site
// (through server.cjs); everything else gets a fixed, plausible answer.
const q = new URLSearchParams(location.search);
try {
  localStorage.setItem("starbuddy.settingsTab", q.get("t") || "general");
  localStorage.setItem("starbuddy.section", q.get("s") || "home");
  localStorage.setItem("starbuddy.locale", q.get("lang") || "en");
} catch {}
let cb = 0;
const callbacks = {};
/** What the log watcher "heard": oldest first, as the events arrive. */
const LOG = [
  ["20:12", "mission_completed", "Recover Cargo — Pyro"],
  ["20:31", "blueprint", "Custodian SMG"],
  ["20:44", "refinery_completed", "ARC-L1 Wide Forest Station"],
  ["20:58", "mission_completed", "Eliminate All — Region AB"],
  ["21:06", "blueprint", "Arrowhead Sniper Rifle Battery (16 cap)"],
  ["21:19", "refinery_completed", "Port Tressler"],
];
const h = 3600e3;
const session = { environment: "PUB", branch: "sc-alpha-4.10.0", running: true, location: "Port Tressler", location_code: "RR_ARC_LEO", ship: "Drake Cutlass Black", player: "Kestrel", shard: "pub_euw1b_demo_0042" };
/** The scan window's last "Scan now": two Quantainium rocks (3,170 each), as
 * the client would match them, so ?window=scan shows a reading, not the empty state. */
const SCAN = {
  captured_at: Date.now() - 40e3, source: "screen", width: 2560, height: 1440, elapsed_ms: 212, lines: [], numbers: [6340],
  badges: [], signature: 6340, mass: 18650,
  matches: [{
    name: "Quantainium", kind: "ship", count: 2, signature: 6340, exact: true, delta: 0,
    ore: { name: "Quantainium (Raw)", signature: 3170, rarity: "rare", resistance: 0.95 },
    rows: [
      { name: "Quantainium", dominant: true, share: [18, 34], rarity: "rare", resistance: 0.95, instability: 1000, qualities: [669, 762, 852, 901] },
      { name: "Copper", dominant: false, share: [8, 21], rarity: "common", resistance: -0.7, instability: 50, qualities: [593, 652, 742] },
      { name: "Inert Materials", dominant: false, share: [45, 70], rarity: null, resistance: null, instability: null, qualities: [] },
    ],
  }],
};
const fake = {
  scan_last: SCAN,
  scan_live_running: false,
  app_version: { version: "1.0.2", build: null },
  app_changes: [],
  debug_mode: false,
  game_session: session,
  // ?paired=no: the Server panel's sign-in; &pair=wait: waiting for approval in the browser.
  get_connection: q.get("paired") === "no"
    ? { paired: false, server_url: "", user_name: "" }
    : { paired: true, server_url: "https://starbuddy.uniteddanes.org", user_name: "Kestrel" },
  pair_browser_start: { user_code: "KQ7M-4XRT", verification_uri_complete: "https://starbuddy.uniteddanes.org/pair?code=KQ7M-4XRT", expires_in: 600 },
  rsi_status_latest: { paired: true, error: null, fetched_at: Date.now(), status: { summary: "operational", systems: [
    { name: "Platform", status: "operational" }, { name: "Persistent Universe", status: "operational" }, { name: "Arena Commander", status: "operational" } ], fetched_at: Date.now(), status_url: "", active: [], recent: [] } },
  check_for_update: { current: "1.0.2", latest: "1.0.2", update_available: false },
  update_can_install: true,
  overlay_prefs: { open: true, mode: "floating", size: q.get("size") || "full", opacity: 1, x: 0, y: 0, width: 440, height: 300 },
  overlay_hotkey: { hotkeys: { main: "Insert", status: "F6", scan: "Shift+F8", refinery: "F8", capture: "F9", reading: "F10" }, global_supported: true, toggle_command: "", failed: {}, live: [], windows: false, desktop_offered: false, desktop_owned: false, triggers: {}, action_command: "" },
  main_mode_get: { mode: q.get("mode") || "window", showing_as: "window", game_running: true },
  tool_links_get: [{ name: "Nova Vanguard Discord", url: "https://discord.gg/example" }],
  watcher_status: true,
  presence_sharing_get: true,
  training_sharing_get: false,
  // ?capture=off (desktop dialog), win (Windows, no window chosen yet) or
  // failed (the last window did not start): the scan window's setup card.
  screen_reading: {
    on: !q.get("capture"),
    available: true,
    source: q.get("capture") === "win" ? null : "Star Citizen",
    error: q.get("capture") === "failed" ? "The window you chose is no longer open." : null,
    picks_from_list: q.get("capture") === "win" || q.get("capture") === "failed",
    capture_border: false,
  },
  screen_reading_windows: ["Star Citizen", "Firefox", "Konsole"],
  region_current: q.get("framed") === "no" ? null : { x: 0.4, y: 0.26, w: 0.2, h: 0.14 },
  // ?area=found|moved: the refinery window offers the panel's area; title|bottom|materials (with framed=no): the guide.
  refinery_area_offer: !q.get("area") ? null
    : ["found", "moved"].includes(q.get("area")) ? { area: { x: 0.3, y: 0.2, w: 0.4, h: 0.6 }, missing: null, moved: q.get("area") === "moved" }
    : { area: null, missing: q.get("area"), moved: false },
  udi_status: { linked: true, auto_install: true, profile: { revision: 3, channel: "live", labels: true, config: true }, installed: { live: { game_version: "4.10.0", at: new Date(Date.now() - 2 * h).toISOString() } } },
  refinery_status: { phase: "done", detail: "" },
  refinery_last: { station: "ARC-L1 Wide Forest Station", ship: "Argo MOLE", capacity_percent: 64, captured_at: Date.now() - 40e3,
    missing: [], lines: [], specializations: [{ material: "Quantainium (Ore)", bonus_percent: 8 }, { material: "Agricium (Ore)", bonus_percent: 5 }],
    orders: [
      { state: "setup", number: null, method: "Dinyx Solventation", method_traits: "LOW SPEED // HIGH COST // HIGH YIELD", cost: 7644, duration_seconds: 5 * 3600 + 40 * 60, yield_total: 547, in_manifest: 1720, to_refine: 1312, unit: "cSCU",
        materials: [
          { resource: "Quantainium (Ore)", quality: 905, qty: 612, yield_amount: 301, to_do: null, done: null, refine: true },
          { resource: "Gold (Ore)", quality: 688, qty: 455, yield_amount: 164, to_do: null, done: null, refine: true },
          { resource: "Agricium (Ore)", quality: 742, qty: 245, yield_amount: 82, to_do: null, done: null, refine: true },
          { resource: "Inert Materials", quality: null, qty: 408, yield_amount: null, to_do: null, done: null, refine: false } ] },
      { state: "processing", number: 10, method: "Ferron Exchange", method_traits: null, cost: 8533, duration_seconds: 4 * 3600, yield_total: 641, in_manifest: null, to_refine: null, unit: "cSCU",
        materials: [{ resource: "Agricium (Ore)", quality: 812, qty: 820, yield_amount: 402, to_do: null, done: null, refine: true }, { resource: "Bexalite (Ore)", quality: 744, qty: 510, yield_amount: 239, to_do: null, done: null, refine: true }] },
      { state: "completed", number: 9, method: "Pyrometric Chromalysis", method_traits: null, cost: 2210, duration_seconds: null, yield_total: 980, in_manifest: null, to_refine: null, unit: "cSCU",
        materials: [{ resource: "Laranite (Ore)", quality: 760, qty: 2140, yield_amount: 980, to_do: null, done: null, refine: true }] } ] },
};
window.__TAURI_INTERNALS__ = {
  transformCallback: (f) => {
    const id = ++cb;
    callbacks[id] = f;
    return id;
  },
  unregisterCallback: () => {},
  convertFileSrc: (p) => p,
  invoke: async (cmd, args) => {
    if (cmd === "server_api") {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(args.query || {})) if (v !== undefined && v !== null) qs.set(k, String(v));
      const r = await fetch("/sbapi/" + args.path.replace(/^\/api\//, "") + (qs.size ? "?" + qs : ""), {
        method: args.method, body: args.body ? JSON.stringify(args.body) : undefined,
      });
      const text = await r.text();
      if (!r.ok) throw `HTTP ${r.status}: ${text.slice(0, 200)}`;
      return text ? JSON.parse(text) : null;
    }
    if (cmd in fake) return fake[cmd];
    // Home's "Recent from Game.log" shows what the watcher heard this session:
    // a few lines of it, so the card is not an empty box on screen.
    if (cmd === "plugin:event|listen" && args.event === "watcher-event") {
      const handler = callbacks[args.handler];
      setTimeout(() => LOG.forEach(([at, kind, detail], i) =>
        handler({ event: "watcher-event", id: i, payload: { timestamp: `2026-11-21T${at}:00.000Z`, kind, detail, file: "Game.log", line: "" } })), 50);
      return 1;
    }
    if (cmd.startsWith("plugin:event")) return 1;
    if (cmd.startsWith("plugin:")) return null;
    throw "preview";
  },
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
