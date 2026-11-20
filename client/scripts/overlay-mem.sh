#!/usr/bin/env bash
# overlay-mem.sh - memory footprint of the running StarBuddy client (Linux).
#
# Measures the client process and every WebKitGTK child it spawned
# (WebKitWebProcess, WebKitNetworkProcess, WebKitGPUProcess, ...), reading
# RSS and PSS from /proc/<pid>/smaps_rollup. PSS splits shared pages between
# the processes that map them, so the PSS total is the honest number; the
# RSS total double-counts shared libraries. No root and no smem needed.
#
# Suggested protocol (run each, compare the totals before and after a change):
#   a) only the main window open
#   b) all overlays open
#   c) overlays opened, then hidden; wait 30 s before measuring
#
# Usage: overlay-mem.sh [--watch N]
set -euo pipefail
export LC_ALL=C  # printf needs a dot decimal separator

watch=0
if [[ ${1:-} == --watch ]]; then
    watch=${2:-}
    [[ $watch =~ ^[0-9]+$ && $watch -gt 0 ]] || { echo "usage: $0 [--watch N]" >&2; exit 2; }
elif [[ $# -gt 0 ]]; then
    echo "usage: $0 [--watch N]" >&2; exit 2
fi

find_client() {
    local pid
    # comm is cut at 15 chars, so "starbuddy-client" is "starbuddy-clien".
    pid=$(pgrep -x starbuddy-clien | head -n1 || true)
    # AppImage: anchor on argv[0] so this script's own command line never matches.
    [[ -n $pid ]] || pid=$(pgrep -f '^[^ ]*StarBuddy[^/ ]*\.AppImage' | head -n1 || true)
    [[ -n $pid ]] || pid=$(pgrep -x StarBuddy | head -n1 || true)
    echo "$pid"
}

children() {
    local p=$1 c
    for c in $(cat /proc/"$p"/task/*/children 2>/dev/null); do
        echo "$c"
        children "$c"
    done
}

# Prints "rss_kb pss_kb" for a PID, or nothing if unreadable.
mem_kb() {
    awk '/^Rss:/{r=$2} /^Pss:/{p=$2} END{if (r!="") print r, p}' /proc/"$1"/smaps_rollup 2>/dev/null || true
}

report() {
    local client pid name m rss pss tr=0 tp=0
    client=$(find_client)
    if [[ -z $client ]]; then
        echo "StarBuddy client is not running (no starbuddy-client / StarBuddy process found)." >&2
        return 1
    fi
    printf '%-8s %-24s %10s %10s\n' PID NAME RSS_MB PSS_MB
    for pid in "$client" $(children "$client"); do
        name=$(cat /proc/"$pid"/comm 2>/dev/null) || continue
        m=$(mem_kb "$pid")
        [[ -n $m ]] || { printf '%-8s %-24s %10s %10s\n' "$pid" "$name" '?' '?'; continue; }
        read -r rss pss <<<"$m"
        tr=$((tr + rss)); tp=$((tp + pss))
        printf '%-8s %-24s %10.1f %10.1f\n' "$pid" "$name" "$(awk "BEGIN{print $rss/1024}")" "$(awk "BEGIN{print $pss/1024}")"
    done
    printf '%-8s %-24s %10.1f %10.1f\n' '' TOTAL "$(awk "BEGIN{print $tr/1024}")" "$(awk "BEGIN{print $tp/1024}")"
}

if [[ $watch -eq 0 ]]; then
    report
else
    while true; do
        echo "== $(date '+%H:%M:%S')"
        report || exit 1
        sleep "$watch"
    done
fi
