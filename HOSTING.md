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

## Local development

`./dev` wraps the compose commands this project needs:

```sh
./dev up                 # start everything
./dev migrate            # run migrations
./dev test               # the backend suite
./dev artisan <args>     # anything else
./dev help               # the rest
```

Two things it takes care of, both of which have bitten this project:

**The backend is mounted, and runs as you.** Production bakes the code into the
image and runs it as `www-data` (uid 82). The dev override mounts `backend/`
instead and sets the container's user to yours, so an edit is live and files the
container writes stay yours. Without the mount, `artisan migrate` truthfully
reports nothing pending while new migration files sit on disk — the container
simply does not have them. `./dev build` is then only needed for Dockerfile or
composer changes.

The named `app-storage` volume predates this and is owned by uid 82. If writes
to `storage/` start failing after a fresh clone, hand it over once:

```sh
docker run --rm -v starbuddy_app-storage:/s alpine chown -R "$(id -u):$(id -g)" /s
```

**Tests get an explicit testing environment.** `phpunit.xml` declares one with
`force="true"`, but compose passes the dev stack's own `DB_*` and `APP_ENV` into
the container as real environment variables and those win. Run bare,
`artisan test` talks to the live dev database — and because `APP_ENV` is still
`production`, `RefreshDatabase` cannot run `migrate:fresh` and the suite fails
against real data. `./dev test` passes the testing environment explicitly, so
use it rather than `artisan test` directly.

## What runs

| Service | Image | Purpose |
|---|---|---|
| `web` | built from `frontend/` (caddy + SPA bundle) | Serves the SPA, routes `/api` to PHP — the only outward-facing container |
| `app` | built from `backend/` | Laravel API (PHP-FPM) |
| `queue` / `scheduler` / `reverb` | same image | Jobs, daily data syncs, websockets |
| `bot` | built from `bot/` | Discord bot (slash commands, notifications) |
| `db` / `redis` | postgres 17 / redis 7 | Data & cache |
| `backup` | postgres-backup-local | Nightly dumps, kept 14 days |

Every long-running container has a Docker healthcheck (`docker compose ps`
shows `healthy`/`unhealthy`; `web`'s check is Laravel's `/up` through Caddy,
`bot`'s is a Discord-session check), so a platform such as Coolify reports
the stack's real state.

Persistent state is the database and the dump archive. On a self-hosted
server this guide keeps both as plain directories under
**`STARBUDDY_DATA_DIR`** (`postgres/`, `backups/`) via
`docker-compose.hostdata.yml` — one directory to back up. On Coolify (§4b)
they are Docker named volumes instead.

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
sudo mkdir -p /srv/starbuddy/data/postgres /srv/starbuddy/data/backups
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

Production is `docker-compose.yml` plus `docker-compose.hostdata.yml` (the
host-directory data layout; always pass the files with `-f` so the local
override is not loaded). It publishes **no ports**; the `web` container joins an external Docker network named `proxy`
under the alias **`starbuddy-web`** (the network name is `STARBUDDY_PROXY_NETWORK`
in `.env`, default `proxy`; see §4b for Coolify).

```sh
docker network create proxy   # skip if your proxy's network exists; if it
                              # has another name, edit docker-compose.yml
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
alias sm='docker compose -f docker-compose.yml -f docker-compose.hostdata.yml'
sm up -d --build

# initialize (once)
sm exec app php artisan migrate --seed --force
sm exec app php artisan starbuddy:sync-item-catalog   # game item catalog for the item picker, ~1 min
sm exec app php artisan starbuddy:sync-blueprints
sm exec app php artisan starbuddy:sync-items          # item classes/stats, ~1 min
sm exec app php artisan starbuddy:sync-resource-types
sm exec app php artisan starbuddy:sync-locations
sm exec app php artisan starbuddy:sync-quality-bands  # quality ladders, from the repo
sm exec app php artisan starbuddy:sync-rarity          # ~2 min
sm exec app php artisan starbuddy:sync-scan-signatures # radar signatures, from the repo
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

## 4b. Deploying with Coolify

Coolify runs the same `docker-compose.yml` as a **Docker Compose** resource
and takes over the proxy, TLS, environment and redeploys. There is nothing
Coolify-specific in the repo; five settings do the job.

1. **Add the resource.** Project → *New resource* → *Docker Compose* →
   *Public repository* (or GitHub App for a private fork). Repository
   `https://github.com/ulrichdahl/StarBuddy`, branch `main`, compose location
   `/docker-compose.yml`. Coolify reads the file and lists the services.
2. **Environment variables.** Paste your filled-in `.env` into the resource's
   *Environment Variables* (Coolify writes them to a `.env` next to the compose
   file, which is what `env_file: .env` and the `${…}` defaults read). Set:
   - `STARBUDDY_PROXY_NETWORK=coolify` — the web container joins Coolify's
     proxy network instead of `proxy`.
   - Leave `STARBUDDY_DATA_DIR` out (or ignore it): on Coolify the database
     and dumps live in the named volumes `pg-data` and `backups`, which
     Coolify keeps across redeploys. Do **not** add `docker-compose.hostdata.yml`
     — Coolify mis-parses bind sources that contain variables and ends up
     with an anonymous volume that is wiped on every deploy.
   - `STARBUDDY_VERSION` can stay unset: the images report the release
     version from `composer.json` / `package.json`. Set it only to override
     (e.g. `0.1.10+3` for a deploy from an untagged commit).
   - `APP_URL`, `DISCORD_REDIRECT_URI`, `SESSION_DOMAIN`,
     `SANCTUM_STATEFUL_DOMAINS` to your public https domain as usual.
3. **Domain.** On the `web` service set your domain
   (`https://starbuddy.example.org`) with port `80`; leave every other
   service without a domain. Coolify's Traefik adds TLS and passes websockets.
4. **Post-deployment command** (resource → *Advanced*): fill in **both**
   fields — *Container name* `app` **and** command
   `php artisan migrate --force && php artisan starbuddy:sync-scan-signatures`.
   With the container name left blank Coolify skips the command silently: the
   deploy goes green while migrations never run, so the first release that
   adds a column takes the site down with "column does not exist". Check with
   `docker exec $(docker ps -qf name=app-<resource uuid>) php artisan
   migrate:status` after a release that carries one.
   Run the one-time syncs from §4 through Coolify's *Terminal* on the `app`
   container after the first deploy, and `node dist/register-commands.js` on
   `bot`.
5. **Deploy.** Leave *Auto Deploy* **on**, pointed at `main`, and let the
   branch carry the meaning: `main` is what production runs, `develop` is
   where the work happens. Merging `develop` into `main` is the deploy, and
   nothing else reaches the server.

   Coolify's webhook cannot be made to listen for anything narrower. It is a
   `push` hook on `/webhooks/source/github/events/manual`, and Coolify's
   handler takes only `push` and `pull_request` events — a `release` event is
   answered with "Nothing to do", and a tag push arrives as `refs/tags/v0.1.12`,
   which the handler never matches because it only strips `refs/heads/`. So a
   branch is the only trigger there is; the flow above is how it is made to
   mean a release.

   Tag `main` after the merge (`git tag v0.1.12 && git push origin v0.1.12`)
   to build the desktop installers and publish the GitHub Release.

**If a deploy fails with "Failed to read the Docker Compose file from the
repository"** and the repository is fine (public, reachable, compose file at
the configured path), suspect the clone rather than the file. Coolify builds
that clone with `git -c http.version=HTTP/1.1`, hard-coded, and on a network
where something mangles git's HTTP/1.1 `POST /git-upload-pack` the fetch comes
back 401; git then asks for a username, gets no terminal, and dies. The
generic error hides all of it. Reproduce it by hand on the server — with the
flag it fails, without it the same clone succeeds:

```sh
git -c http.version=HTTP/1.1 clone --depth=1 --no-checkout -b main \
  https://github.com/ulrichdahl/StarBuddy /tmp/probe   # fails
git clone --depth=1 --no-checkout -b main \
  https://github.com/ulrichdahl/StarBuddy /tmp/probe2  # works
```

The fix is to clone over SSH instead, which never touches that path: create a
private key in Coolify (*Keys & Tokens*), add its public half to the repo's
*Deploy keys* (read-only), and point the resource at `git@github.com:<owner>/
<repo>.git` with that key. A resource created against the built-in *Public
GitHub* source offers no key picker, and Coolify has no UI to change the
source of an existing resource — set it on the row instead, which is enough
because `deploymentType()` prefers a private key over the source:

```sh
docker exec coolify-db psql -U coolify -d coolify -c \
  "update applications set private_key_id = <id from private_keys>,
   git_repository = 'git@github.com:<owner>/<repo>.git'
   where uuid = '<resource uuid>';"
```

Check `nc -zv github.com 22` first; where port 22 is blocked, use
`ssh.github.com:443` via `/etc/ssh/ssh_config`. As a stopgap on HTTPS,
`git config --system http.https://github.com/.version HTTP/2` outranks
Coolify's command-line flag, but it papers over a network fault rather than
avoiding it.

Notes: the first deploy builds three images (PHP backend, SPA + Caddy, bot)
and takes several minutes on a small server; later deploys reuse layers. The
deployment counts as finished when every container reports *healthy*
(`web` waits for `app` to be healthy before it starts). Nightly dumps land
in the `backups` volume (`docker volume ls | grep backups`); copy them out
with e.g. `docker run --rm -v <volume>:/backups:ro -v /srv/backups:/out
alpine cp -a /backups/. /out/` from your off-site backup job, or add
Coolify's own scheduled database backup on the `db` service as well. `update.sh` is not used on Coolify — redeploying from the UI
(or the webhook) replaces it.

## 5. Maintenance

- **Backups** — self-hosted: everything is in `STARBUDDY_DATA_DIR`:
  `backups/` holds nightly dumps (14 days) and pre-update dumps; `postgres/`
  is the live database. Back up the whole directory off-site. (Coolify: see
  §4b for the volume.) Restore a dump:

  ```sh
  gunzip -c data/backups/DUMPFILE.sql.gz | sm exec -T db psql -U starbuddy starbuddy   # your DB_USERNAME / DB_DATABASE from .env
  ```

- **Logs** — `sm logs -f app` (Laravel logs to stderr), `sm logs bot`,
  `sm logs web`.
- **Game data syncs** run automatically (daily 04:40–05:50, rarity weekly).
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
| Blank API responses (empty 200) | Stale `web` image (pre-dates Laravel's `public/` being baked in) — `sm up -d --build web` |
| Desktop client white window (Linux) | Use the current AppImage; older builds had a WebKit/EGL issue |

Client downloads for your members: the
[dev build](https://github.com/ulrichdahl/StarBuddy/releases/tag/dev) and
[stable releases](https://github.com/ulrichdahl/StarBuddy/releases/latest).
