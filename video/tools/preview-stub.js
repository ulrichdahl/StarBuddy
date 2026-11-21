// Video preview stub: no Tauri here. Server calls go to the local dev site
// (through server.cjs); everything else gets a fixed, plausible answer.
const q = new URLSearchParams(location.search);
try {
  localStorage.setItem("starbuddy.settingsTab", q.get("t") || "general");
  localStorage.setItem("starbuddy.section", q.get("s") || "home");
  localStorage.setItem("starbuddy.locale", "en");
} catch {}
let cb = 0;
const h = 3600e3;
const session = { environment: "PUB", branch: "sc-alpha-4.10.0", running: true, location: "Port Tressler", location_code: "RR_ARC_LEO", ship: "Drake Cutlass Black", player: "Kestrel", shard: "pub_euw1b_demo_0042" };
const fake = {
  app_version: { version: "1.0.0", build: null },
  app_changes: [],
  debug_mode: false,
  game_session: session,
  get_connection: { paired: true, server_url: "https://starbuddy.uniteddanes.org", user_name: "Kestrel" },
  rsi_status_latest: { paired: true, error: null, fetched_at: Date.now(), status: { summary: "operational", systems: [
    { name: "Platform", status: "operational" }, { name: "Persistent Universe", status: "operational" }, { name: "Arena Commander", status: "operational" } ], fetched_at: Date.now(), status_url: "", active: [], recent: [] } },
  check_for_update: { current: "1.0.0", latest: "1.0.0", update_available: false },
  update_can_install: true,
  overlay_prefs: { open: true, mode: "floating", size: "full", opacity: 1, x: 0, y: 0, width: 440, height: 300 },
  overlay_hotkey: { hotkeys: { main: "Insert", status: "F6", scan: "Shift+F8", refinery: "F8", capture: "F9", reading: "F10" }, global_supported: true, toggle_command: "", failed: {}, live: [], windows: false, desktop_offered: false, desktop_owned: false, triggers: {}, action_command: "" },
  main_mode_get: { mode: q.get("mode") || "window", showing_as: "window", game_running: true },
  tool_links_get: [{ name: "Nova Vanguard Discord", url: "https://discord.gg/example" }],
  watcher_status: true,
  presence_sharing_get: true,
  training_sharing_get: false,
  screen_reading: { on: true, available: true, source: "Star Citizen", error: null, picks_from_list: false, capture_border: false },
  udi_status: { linked: true, auto_install: true, profile: { revision: 3, channel: "live", labels: true, config: true }, installed: { live: { game_version: "4.10.0", at: new Date(Date.now() - 2 * h).toISOString() } } },
  refinery_status: { phase: "done", detail: "" },
  refinery_last: { station: "ARC-L1 Wide Forest Station", ship: "Argo MOLE", capacity_percent: 64, captured_at: Date.now() - 40e3,
    missing: [], lines: [], specializations: [{ material: "Quantainium Ore", bonus_percent: 8 }, { material: "Agricium Ore", bonus_percent: 5 }],
    orders: [
      { state: "setup", number: null, method: "Dinyx Solventation", method_traits: "LOW SPEED // HIGH COST // HIGH YIELD", cost: 7644, duration_seconds: 5 * 3600 + 40 * 60, yield_total: 547, in_manifest: 1720, to_refine: 1312, unit: "cSCU",
        materials: [
          { resource: "Quantainium Ore", quality: 905, qty: 612, yield_amount: 301, to_do: null, done: null, refine: true },
          { resource: "Gold Ore", quality: 688, qty: 455, yield_amount: 164, to_do: null, done: null, refine: true },
          { resource: "Agricium Ore", quality: 742, qty: 245, yield_amount: 82, to_do: null, done: null, refine: true },
          { resource: "Inert Materials", quality: null, qty: 408, yield_amount: null, to_do: null, done: null, refine: false } ] },
      { state: "processing", number: 10, method: "Ferron Exchange", method_traits: null, cost: 8533, duration_seconds: 4 * 3600, yield_total: 641, in_manifest: null, to_refine: null, unit: "cSCU",
        materials: [{ resource: "Agricium Ore", quality: 812, qty: 820, yield_amount: 402, to_do: null, done: null, refine: true }, { resource: "Bexalite Ore", quality: 744, qty: 510, yield_amount: 239, to_do: null, done: null, refine: true }] },
      { state: "completed", number: 9, method: "Pyrometric Chromalysis", method_traits: null, cost: 2210, duration_seconds: null, yield_total: 980, in_manifest: null, to_refine: null, unit: "cSCU",
        materials: [{ resource: "Laranite Ore", quality: 760, qty: 2140, yield_amount: 980, to_do: null, done: null, refine: true }] } ] },
};
window.__TAURI_INTERNALS__ = {
  transformCallback: () => ++cb,
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
    if (cmd.startsWith("plugin:event")) return 1;
    if (cmd.startsWith("plugin:")) return null;
    throw "preview";
  },
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
