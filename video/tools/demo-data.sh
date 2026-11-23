#!/usr/bin/env bash
# Fake orgs, pilots, stock, scores and presence in the LOCAL dev stack
# (starbuddy-app-1 / starbuddy-db-1), for filming. Never run against production.
#   video/tools/demo-data.sh seed     adds it; writes video/work/seed.json (session cookie + device token: secret)
#   video/tools/demo-data.sh unseed   removes everything it added
# Everything it adds is tagged: users have discord_id 'demo-*'. Seeding twice
# without unseeding in between adds a second set.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$here/../work
mkdir -p "$work"
case ${1:-} in
  seed)
    docker exec starbuddy-db-1 sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$work/dev-before-demo.dump"
    docker cp "$here/seed.php" starbuddy-app-1:/tmp/seed.php
    docker exec starbuddy-app-1 php /tmp/seed.php > "$work/seed.json"
    echo "seeded; backup of the dev DB before it: $work/dev-before-demo.dump"
    ;;
  unseed)
    docker exec -i starbuddy-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q' < "$here/unseed.sql"
    rm -f "$work/seed.json"
    echo "demo data removed"
    ;;
  *) echo "usage: $0 seed|unseed" >&2; exit 2 ;;
esac
