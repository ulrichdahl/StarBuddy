# Hosting StarBuddy

> **Upgrading an instance from before the StarBuddy rename?** Run
> `scripts/update.sh` once: it renames the `STARBUDDY_*` keys in `.env`
> (backup kept), pins the database name/user the old defaults used, and
> replaces the old `starmaker` containers with the `starbuddy` project.
> Your data is untouched (it lives in `STARBUDDY_DATA_DIR`). One manual step:
> point your reverse proxy at **`starbuddy-web`** — the `starmaker-web`
> alias is gone.

One StarBuddy instance serves **one Discord community**. Members sign in with
Discord; only members of your configured server can join. This guide takes an
operator from empty server to a maintained, auto-updating production instance.

## What runs

| Service | Image | Purpose |
|---|---|---|
| `web` | caddy | Serves the SPA, routes `/api` to PHP — the only outward-facing container |
| `app` | built from `backend/` | Laravel API (PHP-FPM) |
| `queue` / `scheduler` / `reverb` | same image | Jobs, daily data syncs, websockets |
| `frontend` | built from `frontend/` | One-shot: builds the SPA bundle Caddy serves |
| `bot` | built from `bot/` | Discord bot (slash commands, notifications) |
| `db` / `redis` | postgres 17 / redis 7 | Data & cache |
| `backup` | postgres-backup-local | Nightly dumps, kept 14 days |

Persistent state lives in **`STARBUDDY_DATA_DIR`** on the host:
`postgres/` (the database) and `backups/` (nightly + pre-update dumps).
That one directory is your backup surface.

## Requirements

- Linux server with Docker + Compose v2
- A domain with an SSL-terminating reverse proxy in Docker (nginx,
  nginx-proxy, Nginx Proxy Manager, Traefik, Caddy — anything that can join a
  Docker network)
- A Discord server you administrate

## 1. Discord application

At <https://discord.com/developers/applications> create an application:

1. **General Information** → copy the *Application ID*.
2. **OAuth2** → copy *Client ID* and *Client Secret*; under *Redirects* add
   `https://YOUR-DOMAIN/api/auth/discord/callback` (exactly).
3. **Bot** → copy the *Token*. Leave all three privileged intents **off**.
   Turn *Public Bot* **off**.
4. Invite the bot to your server:
   `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=19456`
5. Enable Developer Mode in your Discord client, right-click your server →
   *Copy Server ID*.

## 2. Server setup

```sh
sudo mkdir -p /srv/starbuddy/data
cd /srv/starbuddy
git clone https://github.com/ulrichdahl/StarBuddy.git
cd StarBuddy
cp .env.example .env
```

Fill `.env` — the non-obvious ones:

```ini
APP_KEY=                      # echo "base64:$(openssl rand -base64 32)"
APP_URL=https://YOUR-DOMAIN
DISCORD_REDIRECT_URI=https://YOUR-DOMAIN/api/auth/discord/callback
SESSION_DOMAIN=YOUR-DOMAIN
SANCTUM_STATEFUL_DOMAINS=YOUR-DOMAIN
STARBUDDY_DATA_DIR=/srv/starbuddy/data
STARBUDDY_HOME_GUILD_ID=      # your server id from step 1.5
STARBUDDY_BOT_API_TOKEN=      # openssl rand -hex 32
DB_PASSWORD=                  # openssl rand -hex 24
```

Plus the four Discord credentials from step 1.

Optional: `STARBUDDY_REFINERY_CHANNEL_ID=<channel id>` makes the bot post a
ping to that channel whenever a member's refinery work order completes (live
events only — a first-run history import never floods it). The bot needs
*View Channel* and *Send Messages* there.

**Recommended:** `STARBUDDY_STATUS_CHANNEL_ID=<channel id>` turns on RSI
service-status alerts. The backend checks
<https://status.robertsspaceindustries.com> every minute; the moment a
maintenance or outage notice appears, the bot posts it to that channel with
the announced shutdown time, and members see the same alert (with a
countdown) on the website and in the desktop client. RSI typically gives
about 30 minutes between the notice and servers going down — that is the
window players have to stow ships and gear. `STARBUDDY_STATUS_MENTION`
(default `@here`) is what pings people on a *new* notice; updates and the
all-clear post quietly. Use a role mention such as `<@&ROLE_ID>` to ping an
opt-in role instead, or leave it empty to post without pinging. The bot needs
*Mention @everyone, @here and All Roles* in that channel for the ping to work.

## 3. Reverse proxy

The production compose publishes **no ports**; the `web` container joins an
external Docker network named `proxy` under the alias **`starbuddy-web`**.

```sh
docker network create proxy   # skip if your proxy's network exists; if it
                              # has another name, edit docker-compose.prod.yml
```

Attach your proxy container to that network and point the vhost at
`http://starbuddy-web:80`. Plain nginx example:

```nginx
server {
    listen 443 ssl http2;
    server_name YOUR-DOMAIN;
    # ssl_certificate ...; ssl_certificate_key ...;

    location / {
        proxy_pass http://starbuddy-web:80;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # websockets (/app/*)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

(Nginx Proxy Manager: new proxy host → forward to `starbuddy-web` port `80`,
enable *Websockets Support*.)

## 4. First start

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# initialize (once)
alias sm='docker compose -f docker-compose.yml -f docker-compose.prod.yml'
sm exec app php artisan migrate --seed --force
sm exec app php artisan starbuddy:sync-blueprints
sm exec app php artisan starbuddy:sync-items          # item classes/stats, ~1 min
sm exec app php artisan starbuddy:sync-resource-types
sm exec app php artisan starbuddy:sync-locations
sm exec app php artisan starbuddy:sync-quality-bands
sm exec app php artisan starbuddy:sync-rarity          # ~2 min
sm run --rm bot node dist/register-commands.js
```

**Verify:** `curl https://YOUR-DOMAIN/up` → 200, then sign in with Discord in
a browser (this proves the whole OAuth + proxy-header chain). In Discord,
`/starbuddy ping` should answer with backend health and `/starbuddy status`
with the current RSI service status (run
`sm exec app php artisan starbuddy:poll-rsi-status` once if it says nothing
has been checked yet — the scheduler does this every minute from now on).

**Set up your orgs:** a Discord *server admin* runs `/starbuddy org create name:…` and
`/starbuddy org manager user:@someone org:…`. Members request to join on the website
dashboard; managers accept there.

## 5. Maintenance

- **Backups** — everything is in `STARBUDDY_DATA_DIR`: `backups/` holds
  nightly dumps (14 days) and pre-update dumps; `postgres/` is the live
  database. Back up the whole directory off-site. Restore a dump:

  ```sh
  gunzip -c data/backups/DUMPFILE.sql.gz | sm exec -T db psql -U starbuddy starbuddy   # your DB_USERNAME / DB_DATABASE from .env
  ```

- **Logs** — `sm logs -f app` (Laravel logs to stderr), `sm logs bot`,
  `sm logs web`.
- **Game data syncs** run automatically (daily 05:00–05:50, rarity weekly).
  After a big game patch you can run the sync commands from §4 manually.
- **Health** — `https://YOUR-DOMAIN/up` is an uptime-check endpoint;
  `/starbuddy ping` in Discord checks bot ↔ backend.
- **RSI status alerts** — `sm logs scheduler` shows the every-minute poll;
  `sm exec app php artisan starbuddy:poll-rsi-status` runs one by hand. No
  Discord post despite an incident usually means the bot lacks *Send
  Messages* / *Mention everyone* in `STARBUDDY_STATUS_CHANNEL_ID`.

## 6. Updating

### Automatic (recommended)

`scripts/update.sh` pulls the repo; when there are new commits it dumps the
database, rebuilds, rolls the stack, migrates, and re-registers slash
commands. It exits silently when up to date and locks against overlapping
runs. Schedule it:

```sh
crontab -e
# nightly at 04:17, log kept alongside the data
17 4 * * * /srv/starbuddy/StarBuddy/scripts/update.sh >> /srv/starbuddy/update.log 2>&1
```

### Manual

```sh
cd /srv/starbuddy/StarBuddy && ./scripts/update.sh
```

### Rollback

```sh
git checkout vX.Y.Z
sm build && sm up -d
# restore the pre-update dump from data/backups/ if a migration changed data
```

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Discord login redirects to `http://` or loops | Proxy isn't sending `X-Forwarded-Proto` — see the nginx example |
| `redirect_uri mismatch` from Discord | The portal redirect must equal `DISCORD_REDIRECT_URI` byte for byte |
| "not_a_member" after Discord auth | The account isn't in `STARBUDDY_HOME_GUILD_ID`'s server |
| Slash commands answer twice | Two bot processes share the token (e.g. a dev instance) — stop one |
| Blank API responses (empty 200) | `backend/public` mount missing in the web container — pull latest compose |
| Desktop client white window (Linux) | Use the current AppImage; older builds had a WebKit/EGL issue |

Client downloads for your members: the
[dev build](https://github.com/ulrichdahl/StarBuddy/releases/tag/dev) and
[stable releases](https://github.com/ulrichdahl/StarBuddy/releases/latest).
