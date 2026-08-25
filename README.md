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

Laravel + PostgreSQL backend (`backend/`) · React (MUI) SPA (`frontend/`) · Node discord.js bot (`bot/`) · Tauri v2 desktop client (`client/`, Rust log scanner) · Docker Compose deployment · Caddy in front.

## Desktop client downloads

The desktop client (Game.log watcher) is built automatically for Windows and Linux:

- **[Development build](https://github.com/ulrichdahl/StarMaker/releases/tag/dev)** — rolling, replaced on every change to `main`. Windows installer (`.exe`/`.msi`), Linux AppImage/`.deb`/`.rpm`.
- **[Stable releases](https://github.com/ulrichdahl/StarMaker/releases/latest)** — published when a `v*` tag is pushed.

## Running your own instance

Prerequisites: Docker with Compose, and a [Discord application](https://discord.com/developers/applications) for your community (OAuth2 redirect `<your-url>/api/auth/discord/callback`, plus a bot invited to your server).

```sh
git clone https://github.com/ulrichdahl/StarMaker.git && cd StarMaker
cp .env.example .env        # fill in Discord credentials, guild id, DB password,
                            # and APP_KEY (echo "base64:$(openssl rand -base64 32)")
docker compose up -d --build
docker compose exec app php artisan migrate --seed --force
docker compose run --rm bot node dist/register-commands.js   # register slash commands
```

If the default port 8080 is taken, change `HTTP_PORT` — and keep `APP_URL`,
`DISCORD_REDIRECT_URI`, `SANCTUM_STATEFUL_DOMAINS`, and the redirect URL in the
Discord developer portal in sync with it.

### Production (behind your own SSL proxy)

The base compose file publishes **no ports**. In production, attach the web
container to your reverse proxy's external Docker network instead:

```sh
docker network create proxy        # once, or reuse your proxy's network
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Point your nginx/SSL proxy at `http://starmaker-web:80` on that network, and
set `APP_URL`, `DISCORD_REDIRECT_URI`, `SESSION_DOMAIN`, and
`SANCTUM_STATEFUL_DOMAINS` in `.env` to your public https domain.

Persistent data lives under `STARMAKER_DATA_DIR` (default `./data`):
`postgres/` is the database, `backups/` receives nightly dumps kept 14 days.
Point it at an absolute path on servers and include it in your backups.

Open `http://localhost:8080` (or your `APP_URL`) and sign in with Discord. Only members of the configured `STARMAKER_HOME_GUILD_ID` can join. Nightly database dumps land in `./backups/`.

## Fair play

StarMaker never injects into the game, reads game memory, automates inputs, or scrapes RSI. It only reads the `Game.log` text file and (opt-in) screenshots you explicitly capture.

## License

[AGPL-3.0-or-later](LICENSE). You are free to run, study, modify, and share this software — but if you host a modified version, you must make your modified source available to its users.

Not affiliated with Cloud Imperium Games. Star Citizen® is a registered trademark of Cloud Imperium Rights LLC.
