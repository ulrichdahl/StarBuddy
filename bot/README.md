# StarBuddy Discord Bot

Discord companion for StarBuddy, the self-hostable Star Citizen org resource tracker. Talks to the Laravel backend's internal bot API and exposes a small webhook (`POST /notify` on port 3000) that the Laravel queue uses to deliver embeds to Discord channels.

## Commands

All commands live under one root command:

- `/starbuddy ping` — latency + backend health.
- `/starbuddy whoami` — your StarBuddy registration status (ephemeral).
- `/starbuddy stash` — placeholder, coming in P2.
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
