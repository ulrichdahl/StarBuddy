# Changelog

Summarised changes between live releases. Dev builds show the commit list
since the last live release inside the client instead. The live release
workflow uses the matching section below as the GitHub release notes, and
the client shows it under "What's new".

## Unreleased

- Hosting: `docker-compose.yml` alone is production (proxy network built in); `docker-compose.prod.yml` is gone, local development keeps its override. `update.sh` and the docs follow.

## 0.1.10 — 2026-08-28

**Blueprints handling.**

- Website: an About page — what StarBuddy is, where every piece of data comes from and how each service is used, how your own data is shared, the testers, and credits.
- Website blueprints page rebuilt around the in-game fabricator: a **Checklist** of every blueprint in the kiosk's category order (Ammo · Armor · Other · Vehicles · Weapons) with a live "Mine" tick, keyboard ticking, "Mark all shown as mine", and a **Matrix** with Type / Grade / Owners columns, your column clickable and a quick-add field (type, pick, Enter). Craft-list filters (search, category, grade, unowned switches), sortable columns, and a full pager (rows per page, direct page, numbered pages) on both. Grades show as A–D. One blueprint per player — no copies, no duplicate rows.
- Owners chips (craft list and blueprints) list the owning members in their tooltip.
- Blueprint info dialog (click a name on the blueprints page): lore, known stats with the span crafting quality can move them across, who holds it, mark/unmark as mine. Missions that award the blueprint will follow.
- Every list has the same footer — rows per page, direct page, numbered pages — and sortable columns (items and refinery orders gained server-side sorting).
## 0.1.9 — 2026-08-27

- Scan window redesigned as the Ledger: the mineral (or Debris / deposit) is the title with the cluster count in grey after it, a row with rarity, raw signature and resistance sits above a ledger with one row per composition band (mineral · share · resistance · quality), and the signature moves out of the headline. Debris pieces (2,000 each) are recognised.
- Scan window: a capture hiccup no longer leaves the window's red accent on after readings resume; the rarity shown is the raw-ore variant's, so it is never missing.

## 0.1.8 — 2026-08-27

- Scan v2: the signature is looked up in a reference table — the window names the mineral ("Lindinium", "Bexalite × 5" for a cluster), its share of the rock, companion minerals, resistance, instability, rarity and quality band; ground deposits are told apart from ship rocks. The table ships with the client and is refreshed from the server (`/api/scan/signatures`, `/api/scan/signature/{value}`); servers get `starbuddy:sync-scan-signatures` (run by update.sh).
- Rarity in the scan window is coloured like on the website (common … legendary).
- The badge detector finds the pin icon by shape in any HUD colour (the badge follows the ship's HUD theme — amber on a MOLE, cyan on an F7C-M), so other HUD marks are never read as a signature and the scan no longer reads its own window's title back as one.
- Live scan reads about once a second on the screenshot-tool route (was every 2–4 s).
- In-game scan window: F7 toggles a live reader that watches the signature area of the game frame and reads the amber signature badge with on-device OCR; "Scan now" reads one full frame. Models (≈15 MB) download once; nothing leaves your machine.
- Overlay windows docked top or bottom can be dragged left and right.
- Default hotkeys: F6 status window, F7 scan — both editable.
- "Find your installation…" folder picker when the LIVE folder is not detected; typed paths are remembered.
- Debug log (`starbuddy.log`, "Open log folder" in the footer) on every build; dev builds log at debug level.
- Linux: scan capture works with Wine's Wayland driver too — the desktop's screenshot tool grabs the active game window, so the signature area is measured on the game frame, not the whole desktop — and external tools run correctly from the AppImage.
- Dev builds are named by build stamp, check for newer dev builds, and list their changes since the last live release.
- Website: admin clear has a member picker and a patch-reset mode that lets you choose which material categories (and whether items) the wipe took.

## 0.1.7 — 2026-08-27

- In-game RSI status overlay: a frameless always-on-top window (hotkey) showing "All systems operational" or the maintenance/outage notice with a live shutdown countdown. Floating or docked placement, Full/Minimal size, per-window opacity, remembered position; KDE users get the window rule that keeps it above the game installed automatically.
- Client renamed to `starbuddy-client`; the installer removes the old StarMaker-era install and carries settings over.
- Credits (United Danes, DK-Raven, Claude.ai) in the footers; version and build shown in every client.
- Website: RSI maintenance alarm banner with local-time countdown and browser notifications; admin "game wipe" fix.

## 0.1.6 — 2026-08-26

- Maintenance alarm: the client shows the RSI service status and raises a native notification the moment a maintenance or outage notice appears.
- Times shown in your local timezone.

## 0.1.5 — 2026-08-26

- Craft list: sortable columns, "Have materials" bar split into private / org-suppliable / missing, size for vehicle components and weapons, new rarity colours.
- Update check with a clickable download banner.

## 0.1.4 — 2026-08-25

- Localisation (English, Danish) across web, bot and client.
- Bot commands under `/starbuddy`; refinery-completion pings.

## 0.1.1 – 0.1.3 — 2026-08-25

- Renamed to StarBuddy; fan-kit compliance (Made by the Community badge, notice); new logo and icons.
- Craft planner: pick stacks, quantity, blueprint uses; undo craft; product stats.
