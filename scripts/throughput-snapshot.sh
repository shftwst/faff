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
  flyctl ssh console -a "$APP" -C 'sh -lc '"'"'
    ct=$(docker ps --format "{{.Names}}" 2>/dev/null | head -1)
    scan(){ for f in $(find "$1" -maxdepth 8 -name run-ledger.json -path "*runs*" 2>/dev/null); do printf "@@@%s@@@\n" "$(basename "$(dirname "$f")")"; cat "$f"; printf "\n"; done; }
    if [ -n "$ct" ]; then docker exec "$ct" sh -lc "$(declare -f scan); scan /home/faff/.faff/runs"; else scan /home/faff/state/runs; fi
  '"'"'' > "$STREAM" 2>/dev/null || true
else
  for d in $(ls -1dt .faff/runs/*beepboop* 2>/dev/null | head -20); do
    f="$d/run-ledger.json"; [ -f "$f" ] || continue
    { printf '@@@%s@@@\n' "$(basename "$d")"; cat "$f"; printf '\n'; } >> "$STREAM"
  done
fi

python3 - "$STREAM" <<'PY'
import sys, json, re, datetime
text = open(sys.argv[1]).read()
blocks = re.split(r'@@@(.+?)@@@\n', text)
pairs = list(zip(blocks[1::2], blocks[2::2]))[:10]
def iso(s):
    try: return datetime.datetime.fromisoformat((s or "").replace("Z","+00:00"))
    except Exception: return None
print(f"  {'run':40} {'ship':>4} {'pr':>3} {'park':>4} {'err':>4} {'tix/hr':>6}")
if not pairs:
    print("  (no run-ledgers found; runner mode needs the machine up, or run drains first)")
for name, body in pairs:
    try: j = json.loads(body.strip())
    except Exception: print(f"  {name[:40]:40} {'(unreadable ledger)':>24}"); continue
    oc = j.get("outcomes", {}) or {}
    ship = sum(1 for v in oc.values() if v == "shipped")
    prop = sum(1 for v in oc.values() if v == "pr-open")
    park = sum(1 for v in oc.values() if v in ("parked","superseded"))
    err  = sum(1 for v in oc.values() if v == "errored")
    o = j.get("owner") or {}
    st, end = iso(o.get("started_at","")), iso(o.get("last_heartbeat",""))
    hrs = ((end-st).total_seconds()/3600) if (st and end and end>st) else None
    rate = ("%.1f" % (ship/hrs)) if (hrs and hrs > 0) else "?"
    print(f"  {name[:40]:40} {ship:4d} {prop:3d} {park:4d} {err:4d} {rate:>6}")
PY
