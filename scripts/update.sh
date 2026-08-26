#!/usr/bin/env bash
# StarBuddy auto-updater — safe to run from cron.
#
# Pulls the configured branch from GitHub; if nothing changed, exits
# quietly. Otherwise: dumps the database, pulls, rebuilds images, rolls the
# stack, runs migrations, re-registers bot slash commands, prunes old
# images. All output is timestamped for cron logs.
#
#   crontab -e:
#   17 4 * * *  /srv/starbuddy/StarBuddy/scripts/update.sh >> /srv/starbuddy/update.log 2>&1
#
# Environment overrides:
#   STARBUDDY_COMPOSE   compose command (default: production file pair)
#   STARBUDDY_BRANCH    branch to track (default: main)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

COMPOSE=${STARBUDDY_COMPOSE:-"docker compose -f docker-compose.yml -f docker-compose.prod.yml"}
BRANCH=${STARBUDDY_BRANCH:-main}
# Compose project name before the StarBuddy rename; its containers are
# taken down once and replaced by the "starbuddy" project (data lives in
# bind mounts, so nothing is lost).
OLD_PROJECT=starmaker
old_stack_running() { docker ps -q --filter "label=com.docker.compose.project=$OLD_PROJECT" | grep -q .; }

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# Never run two updates at once (cron overlap, manual + cron, …).
exec 9>"$REPO_DIR/.update.lock"
if ! flock -n 9; then
    log "another update is already running — skipping"
    exit 0
fi

git fetch --quiet origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
    exit 0 # up to date — stay silent for cron
fi

log "updating ${LOCAL:0:9} -> ${REMOTE:0:9}"

# Pre-update database dump, kept next to the nightly backups.
DATA_DIR=$(grep -E '^STAR(BUDDY|MAKER)_DATA_DIR=' .env | head -1 | cut -d= -f2- || true)
DATA_DIR=${DATA_DIR:-./data}
mkdir -p "$DATA_DIR/backups"
DUMP="$DATA_DIR/backups/pre-update-$(date +%Y%m%d-%H%M%S).sql.gz"
DB_USER=$(grep -E '^DB_USERNAME=' .env | cut -d= -f2- || true)
DB_NAME=$(grep -E '^DB_DATABASE=' .env | cut -d= -f2- || true)
DUMP_COMPOSE=$COMPOSE
if old_stack_running; then DUMP_COMPOSE="docker compose -p $OLD_PROJECT -f docker-compose.yml -f docker-compose.prod.yml"; fi
if $DUMP_COMPOSE ps --status running db --quiet 2>/dev/null | grep -q .; then
    $DUMP_COMPOSE exec -T db pg_dump -U "${DB_USER:-starmaker}" "${DB_NAME:-starmaker}" | gzip > "$DUMP"
    log "database dumped to $DUMP"
else
    log "warning: db container not running — skipping pre-update dump"
fi

git pull --ff-only --quiet origin "$BRANCH"

# One-time migration from the pre-rename layout: STARMAKER_* keys become
# STARBUDDY_*, and the database name/user the old compose defaulted to are
# pinned explicitly (the defaults changed to "starbuddy").
if grep -qE '^STARMAKER_' .env; then
    cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)"
    grep -qE '^DB_DATABASE=' .env || echo 'DB_DATABASE=starmaker' >> .env
    grep -qE '^DB_USERNAME=' .env || echo 'DB_USERNAME=starmaker' >> .env
    sed -i -E 's/^STARMAKER_/STARBUDDY_/' .env
    log ".env migrated: STARMAKER_* keys renamed to STARBUDDY_* (backup kept)"
fi

log "building images"
$COMPOSE build --pull --quiet

if old_stack_running; then
    log "stopping the pre-rename stack (compose project $OLD_PROJECT)"
    docker compose -p "$OLD_PROJECT" -f docker-compose.yml -f docker-compose.prod.yml down --remove-orphans \
        || docker ps -aq --filter "label=com.docker.compose.project=$OLD_PROJECT" | xargs -r docker rm -f
fi

log "rolling the stack"
$COMPOSE up -d --remove-orphans

# Bind-mounted configs (the Caddyfile) can change without any diff in the
# container definition, which `up -d` won't restart — bounce web so Caddy
# re-reads its config. Cheap: ~1s, static assets only.
$COMPOSE restart web >/dev/null 2>&1 || true

log "running migrations"
$COMPOSE exec -T app php artisan migrate --force

# Slash-command registration is an idempotent PUT; keep it current.
$COMPOSE run --rm bot node dist/register-commands.js >/dev/null 2>&1 \
    && log "bot slash commands re-registered" \
    || log "warning: slash-command registration failed (bot token/network?)"

docker image prune -f --filter "until=168h" >/dev/null
log "update to ${REMOTE:0:9} complete"
