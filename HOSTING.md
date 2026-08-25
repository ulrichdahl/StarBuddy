# Hosting StarMaker

One StarMaker instance serves **one Discord community**. Members sign in with
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

Persistent state lives in **`STARMAKER_DATA_DIR`** on the host:
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
sudo mkdir -p /srv/starmaker/data
cd /srv/starmaker
git clone https://github.com/ulrichdahl/StarMaker.git
cd StarMaker
cp .env.example .env
```

Fill `.env` — the non-obvious ones:

```ini
APP_KEY=                      # echo "base64:$(openssl rand -base64 32)"
APP_URL=https://YOUR-DOMAIN
DISCORD_REDIRECT_URI=https://YOUR-DOMAIN/api/auth/discord/callback
SESSION_DOMAIN=YOUR-DOMAIN
SANCTUM_STATEFUL_DOMAINS=YOUR-DOMAIN
STARMAKER_DATA_DIR=/srv/starmaker/data
STARMAKER_HOME_GUILD_ID=      # your server id from step 1.5
STARMAKER_BOT_API_TOKEN=      # openssl rand -hex 32
DB_PASSWORD=                  # openssl rand -hex 24
```

Plus the four Discord credentials from step 1.

## 3. Reverse proxy

The production compose publishes **no ports**; the `web` container joins an
external Docker network named `proxy` under the alias **`starmaker-web`**.

```sh
docker network create proxy   # skip if your proxy's network exists; if it
                              # has another name, edit docker-compose.prod.yml
```

Attach your proxy container to that network and point the vhost at
`http://starmaker-web:80`. Plain nginx example:

```nginx
server {
    listen 443 ssl http2;
    server_name YOUR-DOMAIN;
    # ssl_certificate ...; ssl_certificate_key ...;

    location / {
        proxy_pass http://starmaker-web:80;
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

(Nginx Proxy Manager: new proxy host → forward to `starmaker-web` port `80`,
enable *Websockets Support*.)

## 4. First start

```sh
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# initialize (once)
alias sm='docker compose -f docker-compose.yml -f docker-compose.prod.yml'
sm exec app php artisan migrate --seed --force
sm exec app php artisan starmaker:sync-blueprints
sm exec app php artisan starmaker:sync-resource-types
sm exec app php artisan starmaker:sync-locations
sm exec app php artisan starmaker:sync-quality-bands
sm exec app php artisan starmaker:sync-rarity          # ~2 min
sm run --rm bot node dist/register-commands.js
```

**Verify:** `curl https://YOUR-DOMAIN/up` → 200, then sign in with Discord in
a browser (this proves the whole OAuth + proxy-header chain). In Discord,
`/ping` should answer with backend health.

**Set up your orgs:** a Discord *server admin* runs `/org create name:…` and
`/org manager user:@someone org:…`. Members request to join on the website
dashboard; managers accept there.

## 5. Maintenance

- **Backups** — everything is in `STARMAKER_DATA_DIR`: `backups/` holds
  nightly dumps (14 days) and pre-update dumps; `postgres/` is the live
  database. Back up the whole directory off-site. Restore a dump:

  ```sh
  gunzip -c data/backups/DUMPFILE.sql.gz | sm exec -T db psql -U starmaker starmaker
  ```

- **Logs** — `sm logs -f app` (Laravel logs to stderr), `sm logs bot`,
  `sm logs web`.
- **Game data syncs** run automatically (daily 05:00–05:50, rarity weekly).
  After a big game patch you can run the sync commands from §4 manually.
- **Health** — `https://YOUR-DOMAIN/up` is an uptime-check endpoint;
  `/ping` in Discord checks bot ↔ backend.

## 6. Updating

### Automatic (recommended)

`scripts/update.sh` pulls the repo; when there are new commits it dumps the
database, rebuilds, rolls the stack, migrates, and re-registers slash
commands. It exits silently when up to date and locks against overlapping
runs. Schedule it:

```sh
crontab -e
# nightly at 04:17, log kept alongside the data
17 4 * * * /srv/starmaker/StarMaker/scripts/update.sh >> /srv/starmaker/update.log 2>&1
```

### Manual

```sh
cd /srv/starmaker/StarMaker && ./scripts/update.sh
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
| "not_a_member" after Discord auth | The account isn't in `STARMAKER_HOME_GUILD_ID`'s server |
| Slash commands answer twice | Two bot processes share the token (e.g. a dev instance) — stop one |
| Blank API responses (empty 200) | `backend/public` mount missing in the web container — pull latest compose |
| Desktop client white window (Linux) | Use the current AppImage; older builds had a WebKit/EGL issue |

Client downloads for your members: the
[dev build](https://github.com/ulrichdahl/StarMaker/releases/tag/dev) and
[stable releases](https://github.com/ulrichdahl/StarMaker/releases/latest).
