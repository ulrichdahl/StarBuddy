# StarBuddy Discord Bot

Discord companion for StarBuddy, the self-hostable Star Citizen org resource tracker. Talks to the Laravel backend's internal bot API and exposes a small webhook (`POST /notify` on port 3000) that the Laravel queue uses to deliver embeds to Discord channels.

## Commands

On first start the bot sets its own avatar to the StarBuddy icon if it still has Discord's default one (an avatar you set in the Developer Portal is left alone).

Replies are localized (English, Danish — one JSON file per language in `locales/`): a registered member gets the language chosen on the website, anyone else the language of their Discord client. Command descriptions carry Danish localizations too. Game data (org names, handles) is never translated.

All commands live under one root command:

- `/starbuddy ping` — latency + backend health.
- `/starbuddy whoami` — your StarBuddy registration status (ephemeral).
- `/starbuddy craftable [search]` — what your org can craft right now, best output quality first. Give a material you have (e.g. `lindinium`) to list only craftable recipes that consume it; anything else filters by recipe name (ephemeral).
- `/starbuddy need <item>` — a category or slot (`shield`, `powerplant`, `undersuit`, `quantum drive`…) lists that whole family craftable-first; a name shows who holds the blueprint and the best materials, and where (ephemeral).
- `/starbuddy stash` — placeholder for the ledger browser.
- `/starbuddy org list|create|delete|manager` — org administration (requires Manage Server).

## Setup

```sh
cp .env.example .env   # fill in the values
npm install
npm run register       # register guild slash commands (re-run when commands change)
npm run dev            # run with tsx watch
```

Production: `npm run build && npm start`, or use the provided `Dockerfile`.

## Environment variables

| Variable                 | Description                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`      | Bot token from the Discord developer portal.                                 |
| `DISCORD_APPLICATION_ID` | Application (client) id.                                                     |
| `HOME_GUILD_ID`          | Guild id slash commands are registered to.                                   |
| `BACKEND_URL`            | Base URL of the Laravel internal bot API (compose: `http://web/`; default `http://app:8000`). |
| `BOT_API_TOKEN`          | Shared bearer token for backend calls and the `/notify` webhook.             |
| `NOTIFY_PORT`            | Notification webhook port (optional, default `3000`).                        |
