#!/usr/bin/env bash
# throughput-snapshot.sh - measure faff ticket throughput for before/after comparison.
#
# Prints two views:
#   1. Shipped/day  - squash-merges landing on main (each ~= one shipped ticket). The
#                     durable headline; counts everything that merged, runner or human.
#   2. Per-drain    - shipped / parked / pr-open / errored per beep-boop run from its
#                     run-ledger, plus tickets-per-hour. Isolates the RUNNER's output and
#                     normalises for how long a drain ran. The sharp metric for a
#                     controlled A/B (e.g. shared-cpu vs performance-4x).
#
# Usage:  scripts/throughput-snapshot.sh [DAYS] [LABEL] [--runner]
#   DAYS      window for the shipped/day view (default 14)
#   LABEL     free-text tag printed in the header, e.g. "shared-8x conc4"
#   --runner  read per-drain ledgers from the fly runner over ssh instead of local
#             .faff/runs. Requires the machine UP; app via FAFF_RUNNER_APP
#             (default fly-ci-l3-runner).
#
# Method note: change ONE variable at a time (concurrency, then CPU tier) and run this
# before and after each change, >=3 drains per condition. Annotate windows hit by external
# outages (e.g. a review-backend down day) - they depress throughput independent of the box.
set -uo pipefail

DAYS=14; LABEL=""; RUNNER=0
for a in "$@"; do
  case "$a" in
    --runner) RUNNER=1 ;;
    *[!0-9]*|'') [ -z "$LABEL" ] && LABEL="$a" ;;
    *) DAYS="$a" ;;
  esac
done
APP="${FAFF_RUNNER_APP:-fly-ci-l3-runner}"
cd "$(git rev-parse --show-toplevel)"
git fetch origin main --quiet 2>/dev/null || true

src_tag=""; [ "$RUNNER" -eq 1 ] && src_tag=" (runner: $APP)"
echo "# throughput snapshot ${LABEL:+[$LABEL] }$(date -u +%Y-%m-%dT%H:%M:%SZ) - window ${DAYS}d${src_tag}"
echo
echo "## shipped/day (merges on main)"
git log origin/main --since="${DAYS} days ago" --format=%cd --date=format:%Y-%m-%d \
  | sort | uniq -c | awk '{printf "  %s  %3d\n",$2,$1}'
tot=$(git log origin/main --since="${DAYS} days ago" --oneline | wc -l | tr -d ' ')
ad=$(git log origin/main --since="${DAYS} days ago" --format=%cd --date=format:%Y-%m-%d | sort -u | wc -l | tr -d ' ')
awk -v t="$tot" -v a="$ad" 'BEGIN{printf "  total=%d  active_days=%d  mean/active-day=%.1f\n",t,a,(a?t/a:0)}'
echo
echo "## per-drain (run-ledgers, most recent 10)${src_tag}"

# Collect a "@@@<run-name>@@@\n<ledger-json>\n" stream into a temp file (NOT piped into the
# python heredoc - that would make the heredoc python's stdin and drop the data).
STREAM="$(mktemp)"; trap 'rm -f "$STREAM"' EXIT
if [ "$RUNNER" -eq 1 ]; then
  # The persistent run-dirs live on the host's docker volume, not in the ephemeral cage:
  #   /var/lib/docker/volumes/<vol>/_data/runs/<run-id>/run-ledger.json
  # Read them there directly (no docker exec, works whether or not a drain is mid-flight).
  flyctl ssh console -a "$APP" -C 'sh -lc '"'"'for f in $(find /var/lib/docker/volumes -maxdepth 6 -name run-ledger.json -path "*runs*" 2>/dev/null); do printf "@@@%s@@@%s@@@\n" "$(basename "$(dirname "$f")")" "$(stat -c %Y "$f" 2>/dev/null || echo 0)"; cat "$f"; printf "\n"; done'"'"'' > "$STREAM" 2>/dev/null || true
else
  for d in $(ls -1dt .faff/runs/*beepboop* 2>/dev/null | head -20); do
    f="$d/run-ledger.json"; [ -f "$f" ] || continue
    { printf '@@@%s@@@%s@@@\n' "$(basename "$d")" "$(stat -c %Y "$f" 2>/dev/null || echo 0)"; cat "$f"; printf '\n'; } >> "$STREAM"
  done
fi

python3 - "$STREAM" <<'PY'
import sys, json, re, datetime
text = open(sys.argv[1]).read()
blocks = re.split(r'@@@(.+?)@@@(\d+)@@@\n', text)  # -> ['', name, mtime, body, name, mtime, body, ...]
trips = list(zip(blocks[1::3], blocks[2::3], blocks[3::3]))[:10]
def run_start(name):  # run-YYYYMMDD-HHMMSS-... -> epoch (UTC)
    m = re.match(r'run-(\d{8})-(\d{6})', name)
    if not m: return None
    try:
        dt = datetime.datetime.strptime(m.group(1)+m.group(2), "%Y%m%d%H%M%S")
        return dt.replace(tzinfo=datetime.timezone.utc).timestamp()
    except Exception: return None
print(f"  {'run':40} {'ship':>4} {'pr':>3} {'park':>4} {'err':>4} {'hrs':>5} {'tix/hr':>6}")
if not trips:
    print("  (no run-ledgers found; runner mode needs the machine up, or run drains first)")
for name, mtime, body in trips:
    try: j = json.loads(body.strip())
    except Exception: print(f"  {name[:40]:40} {'(unreadable ledger)':>31}"); continue
    oc = j.get("outcomes", {}) or {}
    ship = sum(1 for v in oc.values() if v == "shipped")
    prop = sum(1 for v in oc.values() if v == "pr-open")
    park = sum(1 for v in oc.values() if v in ("parked","superseded"))
    err  = sum(1 for v in oc.values() if v == "errored")
    st = run_start(name); en = int(mtime) if mtime.isdigit() else 0  # ledger mtime = last write ~= run end
    hrs = ((en - st) / 3600) if (st and en > st) else None
    rate = ("%.1f" % (ship / hrs)) if (hrs and hrs > 0) else "?"
    print(f"  {name[:40]:40} {ship:4d} {prop:3d} {park:4d} {err:4d} "
          f"{('%.1f' % hrs) if hrs else '?':>5} {rate:>6}")
PY
