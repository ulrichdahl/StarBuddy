# StarBuddy

A self-hostable companion platform for Star Citizen communities: track your org's **resources** (with quality), **blueprints**, and **refining orders** — then ask it what your org can craft right now, what it's closest to being able to craft, and who holds the blueprint and best materials for the item you need.

**Status: specification / pre-alpha.** Read the full project specification at **[ulrichdahl.github.io/StarBuddy/spec.html](https://ulrichdahl.github.io/StarBuddy/spec.html)** (source: [`spec.html`](spec.html)).

## What it does

- **Log watcher** — tails each player's `Game.log` (Windows and Linux/Wine) and automatically captures blueprint acquisitions, refinery work-order completions, and shop transactions. On first run it imports the entire `logbackups/` history, so your blueprint library and event timeline are reconstructed from every past session still on disk — no starting from zero. Verified against real Alpha 4.6–4.9 logs.
- **Org ledger** — per-member, per-location stashes of resources with exact per-crate quality numbers, quantities in 0.001 SCU crate increments (or pieces for gems). Fast keyboard-first manual entry; screenshot OCR planned.
- **Craftability engine** — joins the ledger with per-patch recipe data (Star Citizen Wiki API) to list everything the org can craft now and rank the nearest misses; filterable by blueprint tags.
- **Discord-native** — login via Discord OAuth gated to your community's server, org/role mapping from guild roles, bot slash commands and channel notifications.
- **Maintenance alarm** — polls the [RSI status page](https://status.robertsspaceindustries.com) every minute and, the moment a maintenance or outage notice appears, pings a Discord channel and raises a countdown banner on the website and in the desktop client (with a native notification) — so players use the ~30 minutes before servers drop to stow ships and gear. `/starbuddy status` shows the current picture on demand.
- **Overlay** — hotkey-toggled in-game overlay on Windows and Linux (layer-shell on KDE/Hyprland/Sway, X11 backend, web-on-second-screen fallback).

## Languages

The web app, desktop client and Discord bot are localized — English (default) and Danish. The browser's language is used on first login and the member can change it any time (remembered on the profile); the bot follows that choice, or the Discord client's language for unregistered users. Each language is one JSON file (`frontend/src/locales/`, `client/src/locales/`, `bot/locales/`) — copy `en.json` to add a language. Game data (item, material, blueprint and location names) is never translated.

## Hosting model

One deployment serves **one community**: the instance is bound to a single Discord server and only its members can join; multiple orgs can live inside one instance. Other communities run their own instance (Docker Compose) with their own Discord application and bot.

## Stack

Laravel + PostgreSQL backend (`backend/`) · React (MUI) SPA (`frontend/`) · Node discord.js bot (`bot/`) · Tauri v2 desktop client (`client/`, Rust log scanner) · Docker Compose deployment · Caddy in front.

## Desktop client downloads

The desktop client (Game.log watcher) is built automatically for Windows and Linux:

- **[Development build](https://github.com/ulrichdahl/StarBuddy/releases/tag/dev)** — rolling, replaced on every change to `main`. Windows installer (`.exe`/`.msi`), Linux AppImage/`.deb`/`.rpm`.
- **[Stable releases](https://github.com/ulrichdahl/StarBuddy/releases/latest)** — published when a `v*` tag is pushed.

## Running your own instance

**Full operator guide: [HOSTING.md](HOSTING.md)** — production setup behind an
SSL proxy, backups, cron auto-updates, troubleshooting. The quickstart below
covers local/evaluation use.

Prerequisites: Docker with Compose, and a [Discord application](https://discord.com/developers/applications) for your community (OAuth2 redirect `<your-url>/api/auth/discord/callback`, plus a bot invited to your server).

```sh
git clone https://github.com/ulrichdahl/StarBuddy.git && cd StarBuddy
cp .env.example .env        # fill in Discord credentials, guild id, DB password,
                            # and APP_KEY (echo "base64:$(openssl rand -base64 32)")
docker compose up -d --build   # local: Caddy on http://localhost:8080 with the Vite dev server (hot reload) behind it
docker compose exec app php artisan migrate --seed --force
docker compose run --rm bot node dist/register-commands.js   # register slash commands
```

If the default port 8080 is taken, change `HTTP_PORT` — and keep `APP_URL`,
`DISCORD_REDIRECT_URI`, `SANCTUM_STATEFUL_DOMAINS`, and the redirect URL in the
Discord developer portal in sync with it.

### Production (behind your own SSL proxy)

`docker-compose.yml` alone is production: it publishes **no ports** and attaches
the web container to your reverse proxy's external Docker network:

```sh
docker network create proxy        # once, or reuse your proxy's network
docker compose -f docker-compose.yml up -d
```

Point your nginx/SSL proxy at `http://starbuddy-web:80` on that network, and
set `APP_URL`, `DISCORD_REDIRECT_URI`, `SESSION_DOMAIN`, and
`SANCTUM_STATEFUL_DOMAINS` in `.env` to your public https domain.

Persistent data is the database and the nightly dumps (kept 14 days) — Docker
named volumes by default; add `-f docker-compose.hostdata.yml` to keep them as
plain directories under `STARBUDDY_DATA_DIR` (see HOSTING.md).
Point it at an absolute path on servers and include it in your backups.

Open `http://localhost:8080` (or your `APP_URL`) and sign in with Discord. Only members of the configured `STARBUDDY_HOME_GUILD_ID` can join. Nightly database dumps land in `./backups/`.

## Fair play

StarBuddy never injects into the game, reads game memory, automates inputs, or scrapes RSI. It only reads the `Game.log` text file and (opt-in) screenshots you explicitly capture.

## License

[AGPL-3.0-or-later](LICENSE). You are free to run, study, modify, and share this software — but if you host a modified version, you must make your modified source available to its users.

## Credits

StarBuddy is a [United Danes](https://uniteddanes.org) community project, built by
[DK-Raven](https://robertsspaceindustries.com/citizens/DK-Raven) with [Claude.ai](https://claude.ai).

## Fan project notice

This is an unofficial Star Citizen fan project, not affiliated with the Cloud Imperium group of companies. All content not authored by its host or users is property of its respective owners. Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC. The "Made by the Community" logo is used under the [Star Citizen Fan Kit](https://robertsspaceindustries.com/fankit) terms — it may only be resized, never altered. Official site: <https://robertsspaceindustries.com/>.
