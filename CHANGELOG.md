# Changelog

Summarised changes between live releases. Dev builds show the commit list
since the last live release inside the client instead. The live release
workflow uses the matching section below as the GitHub release notes, and
the client shows it under "What's new".

## 0.1.11 — 2026-09-01

**Bulk entry.**

- **Add multiple** now covers items too: the entry grid is one shared component, configured per page. Items get a free-solo catalog picker (an unknown name is kept as the class), whole-piece amounts, and a **quality** — typed rather than picked from bands, since bought and crafted gear carries a grade the catalog cannot know. Item stacks gain a nullable `quality` column, shown as a sortable list column and editable in the stack dialog; the single Add item form gains the field too, sticky between entries. Fresh item lines start on 500, the in-game spawn grade.
- The entry grid closes on a successful save and reports it in a snackbar; only lines the server refused keep it open, with their reason.
- Crafted items no longer carry their grade in their name. A craft used to write "Arclight Pistol (Q905)" because there was nowhere else to put it; it now fills the new `quality` column and the name stays what the blueprint calls it. Existing `(Qnnn)` suffixes are moved into the column by the migration, which puts them back if it is rolled back.
- Materials gains **Add multiple**: a spreadsheet-style entry grid, one line per stack, with the location set once for the whole batch and visibility per line (the blueprint list's marks — you alone, or the org — Space toggles, and a new line inherits the one above). Arrows move between cells, typing edits the focused one, Material is an autocomplete over the resource catalog and Quality a select of that material's known bands. Enter saves the line and moves to the next, Ctrl+Enter repeats a line with the amount cleared (the fast path for a haul of one material), Tab walks the cells, and the grid always ends on one empty line. Inside Amount, Ctrl+↑↓ still steps 0.01 and Shift+↑↓ 0.1 — the plain arrows now belong to the grid. Lines the server refuses stay put with the reason. The design study is `designs/material-entry-grid.html`.
- Materials, items and craft now label the column **Amount** rather than Quantity — "quantity" and "quality" are hard to tell apart at a glance, especially for dyslexic readers. Danish was already unambiguous (Mængde / Kvalitet).
- Fix: the item entry dropdown repeated its category headers — options arrived name-sorted while the list was grouped by category. Categories are now alphabetical (unknown last), best matches first within each.
- Fix: the dashboard's organization card and members dialog showed raw keys (`org.title`, `org.leave`, …) — the Org-view strings had replaced the old `org` block in both languages instead of joining it. All 22 strings are back.
- Fix: the materials list offered the edit pencil (and double-click) on org mates' org-visible stacks too; the server refused with 403 and the dialog only said "could not save". Only your own stacks are editable now — other rows show who owns them, as on the items page.
- Materials and items edit dialogs: a failed save or delete now shows the server's answer (status and message) after the generic text, so the cause is visible without opening the browser's network tab.
- Materials entry: after saving a stack the material stays selected (focus returns to it with the text pre-selected) and only quality + quantity clear — a run of the same material is Enter → quality → quantity → Enter; a different one is just typed over.
- Hosting fix: the database and dump storage are Docker named volumes (`pg-data`, `backups`); self-hosted installs keep host directories via the new `docker-compose.hostdata.yml`, which `update.sh` adds automatically when `${STARBUDDY_DATA_DIR}/postgres` exists. Coolify split the old `${STARBUDDY_DATA_DIR:-./data}/postgres:…` mount on the colon inside the variable default, leaving Postgres on an anonymous volume that was wiped on every deploy.
- Items and Materials pages get an **Org** view: everything members have made org-visible, one row per item (or material + quality) with the org total, how many stacks it sits in, and — blueprint-matrix style — a column per member showing how much they hold (hover: in how many stacks). Same search/system/location (and quality) filters as the stack list; sortable by name, quality, total, stacks, holders. New `/api/org/items` and `/api/org/materials`.
- Dev: `docker compose up` now runs the frontend through a Vite dev server with hot module reload — Caddy on `localhost:8080` proxies everything but the API to it, so cookies and Discord login work as in production. Production builds are untouched.
- Items page rebuilt around a real item catalog: `starbuddy:sync-item-catalog` mirrors every item the Star Citizen Wiki lists (~12k) nightly, and the entry form autocompletes on it — name or class, grouped by the wiki's type, pick → quantity → Enter with the same sticky location/visibility and Ctrl/Shift arrow steps as materials. Unknown names still save verbatim as the class. The list gains search, location and visibility filters, an edit dialog (quantity, location, visibility, delete; 0 removes) on your own stacks, and double-click to edit.
- Materials and items lists get a **System** column (sortable) and a system filter — several stations share a name across systems. One location picker everywhere (materials entry, materials/items filters and edit dialogs): grouped by system, landing zones first, every option a single ellipsised line with the full name on hover, and the picked value reads “System – Name”.
- Fix: sorting materials or items by location returned a server error (ambiguous `user_id` once `locations` was joined).
- Hosting: images report the release version (`composer.json` / bot `package.json`) when no `STARBUDDY_VERSION` build arg is given — Coolify deploys no longer show `dev`. `update.sh` still bakes in the exact git-describe string.
- Hosting: every long-running container has a Docker healthcheck (`web` = Laravel `/up` through Caddy, `bot` = new `GET /health` that reports the Discord session, `app` = FPM port, `queue`/`scheduler` = process, `reverb` = its `/up`, `redis` = ping), so Coolify and `docker compose ps` show real health. The SPA bundle is now baked into the `web` (Caddy) image — the one-shot `frontend` container and its volume are gone, so no container shows as *exited* after a deploy. The Caddyfile and Laravel's `public/` are baked into that image too instead of bind-mounted — Coolify relocates bind mounts and had turned the Caddyfile into an empty directory. Custom Caddyfile edits now need `up -d --build web`.
- Hosting: the reverse-proxy network name is `STARBUDDY_PROXY_NETWORK` (default `proxy`, `coolify` on Coolify) and HOSTING.md gains a Coolify deployment section.
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
