# StarMaker

A self-hostable companion platform for Star Citizen communities: track your org's **resources** (with quality), **blueprints**, and **refining orders** — then ask it what your org can craft right now, what it's closest to being able to craft, and who holds the blueprint and best materials for the item you need.

**Status: specification / pre-alpha.** Read the full project specification at **[ulrichdahl.github.io/StarMaker/spec.html](https://ulrichdahl.github.io/StarMaker/spec.html)** (source: [`spec.html`](spec.html)).

## What it does

- **Log watcher** — tails each player's `Game.log` (Windows and Linux/Wine) and automatically captures blueprint acquisitions, refinery work-order completions, and shop transactions. On first run it imports the entire `logbackups/` history, so your blueprint library and event timeline are reconstructed from every past session still on disk — no starting from zero. Verified against real Alpha 4.6–4.9 logs.
- **Org ledger** — per-member, per-location stashes of resources with exact per-crate quality numbers, quantities in 0.001 SCU crate increments (or pieces for gems). Fast keyboard-first manual entry; screenshot OCR planned.
- **Craftability engine** — joins the ledger with per-patch recipe data (Star Citizen Wiki API) to list everything the org can craft now and rank the nearest misses; filterable by blueprint tags.
- **Discord-native** — login via Discord OAuth gated to your community's server, org/role mapping from guild roles, bot slash commands and channel notifications.
- **Overlay** — hotkey-toggled in-game overlay on Windows and Linux (layer-shell on KDE/Hyprland/Sway, X11 backend, web-on-second-screen fallback).

## Hosting model

One deployment serves **one community**: the instance is bound to a single Discord server and only its members can join; multiple orgs can live inside one instance. Other communities run their own instance (Docker Compose) with their own Discord application and bot.

## Stack

Laravel + PostgreSQL backend · React (MUI) web frontend · Tauri v2 desktop client (Rust log tailer) · DiscordPHP bot · Docker Compose deployment.

## Fair play

StarMaker never injects into the game, reads game memory, automates inputs, or scrapes RSI. It only reads the `Game.log` text file and (opt-in) screenshots you explicitly capture.

## License

[AGPL-3.0-or-later](LICENSE). You are free to run, study, modify, and share this software — but if you host a modified version, you must make your modified source available to its users.

Not affiliated with Cloud Imperium Games. Star Citizen® is a registered trademark of Cloud Imperium Rights LLC.
