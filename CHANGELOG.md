# Changelog

Summarised changes between live releases. Dev builds show the commit list
since the last live release inside the client instead. The live release
workflow uses the matching section below as the GitHub release notes, and
the client shows it under "What's new".

## Unreleased

- In-game scan window: F7 toggles a live reader that watches the signature area of the game frame and reads the amber signature badge with on-device OCR; "Scan now" reads one full frame. Models (≈15 MB) download once; nothing leaves your machine.
- Overlay windows docked top or bottom can be dragged left and right.
- Default hotkeys: F6 status window, F7 scan — both editable.
- "Find your installation…" folder picker when the LIVE folder is not detected; typed paths are remembered.
- Debug log (`starbuddy.log`, "Open log folder" in the footer) on every build; dev builds log at debug level.
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
