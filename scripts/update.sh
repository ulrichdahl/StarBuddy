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
#
# Flags:
#   --force             rebuild and roll the stack even when already on the
#                       latest commit (e.g. after a manual `git pull`, which
#                       leaves the images built from the old checkout)

set -euo pipefail

FORCE=0
for arg in "$@"; do
    case "$arg" in
        --force) FORCE=1 ;;
        *) echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# Host data directory (database + dumps). Installs that keep it as plain
# directories get docker-compose.hostdata.yml added automatically, with the
# path made absolute (Docker's bind driver requires that).
DATA_DIR=$(grep -E '^STAR(BUDDY|MAKER)_DATA_DIR=' .env | head -1 | cut -d= -f2- || true)
DATA_DIR=${DATA_DIR:-./data}
COMPOSE_FILES="-f docker-compose.yml"
if [ -d "$DATA_DIR/postgres" ]; then
    export STARBUDDY_DATA_DIR
    STARBUDDY_DATA_DIR=$(cd "$DATA_DIR" && pwd)
    DATA_DIR=$STARBUDDY_DATA_DIR
    mkdir -p "$DATA_DIR/backups"
    COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.hostdata.yml"
fi
COMPOSE=${STARBUDDY_COMPOSE:-"docker compose $COMPOSE_FILES"}
BRANCH=${STARBUDDY_BRANCH:-main}
# Compose project name before the StarBuddy rename; its containers are
# taken down once and replaced by the "starbuddy" project (data lives in
# host directories, so nothing is lost).
OLD_PROJECT=starmaker
old_stack_running() { docker ps -q --filter "label=com.docker.compose.project=$OLD_PROJECT" | grep -q .; }

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# Never run two updates at once (cron overlap, manual + cron, …).
exec 9>"$REPO_DIR/.update.lock"
if ! flock -n 9; then
    log "another update is already running — skipping"
    exit 0
fi

# Tags too: the version string comes from `git describe`.
git fetch --quiet --tags origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ] && [ "$FORCE" = 0 ]; then
    exit 0 # up to date — stay silent for cron
fi

if [ "$LOCAL" = "$REMOTE" ]; then
    log "forced rebuild at ${LOCAL:0:9}"
else
    log "updating ${LOCAL:0:9} -> ${REMOTE:0:9}"
fi

# Pre-update database dump, kept next to the nightly backups.
mkdir -p "$DATA_DIR/backups"
DUMP="$DATA_DIR/backups/pre-update-$(date +%Y%m%d-%H%M%S).sql.gz"
DB_USER=$(grep -E '^DB_USERNAME=' .env | cut -d= -f2- || true)
DB_NAME=$(grep -E '^DB_DATABASE=' .env | cut -d= -f2- || true)
DUMP_COMPOSE=$COMPOSE
if old_stack_running; then DUMP_COMPOSE="docker compose -p $OLD_PROJECT -f docker-compose.yml"; fi
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

# Shown in every surface's footer: "0.1.6+8 (0da88ca)" style from git describe.
export STARBUDDY_VERSION
STARBUDDY_VERSION=$(git describe --tags --always 2>/dev/null | sed -E 's/^v//; s/-([0-9]+)-g([0-9a-f]+)$/+\1 (\2)/')
log "building images (version $STARBUDDY_VERSION)"
$COMPOSE build --pull --quiet

if old_stack_running; then
    log "stopping the pre-rename stack (compose project $OLD_PROJECT)"
    docker compose -p "$OLD_PROJECT" -f docker-compose.yml down --remove-orphans \
        || docker ps -aq --filter "label=com.docker.compose.project=$OLD_PROJECT" | xargs -r docker rm -f
fi

log "rolling the stack"
$COMPOSE up -d --remove-orphans

log "running migrations"
$COMPOSE exec -T app php artisan migrate --force
# Reference data shipped in the repo (scan signatures) — cheap, idempotent.
$COMPOSE exec -T app php artisan starbuddy:sync-scan-signatures >/dev/null 2>&1 || log "warning: sync-scan-signatures failed"

# Slash-command registration is an idempotent PUT; keep it current.
$COMPOSE run --rm bot node dist/register-commands.js >/dev/null 2>&1 \
    && log "bot slash commands re-registered" \
    || log "warning: slash-command registration failed (bot token/network?)"

docker image prune -f --filter "until=168h" >/dev/null
log "update to ${REMOTE:0:9} complete"
