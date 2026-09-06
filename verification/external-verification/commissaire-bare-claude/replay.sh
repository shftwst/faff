#!/bin/sh
# FAFF-360 — secret-free replay of a bare Commissaire consumer capture.
#
# Runs the three public-material replays over a TEMP COPY of this capture (never in place): the
# Commissaire decision replay, the flight-recorder reconciliation check, and the sealed-bundle
# verify. Both binaries are resolved COMMISSAIRE_ROOT-relative, never via PATH, matching the
# no-PATH design of the harness. The temp copy is why a capture placed inside a SuperDomestique
# checkout still verifies CLEAN (see FAFF-1016): faff bundle verify resolves its store through the
# enclosing .faffrc.yaml, so a temp directory outside any checkout is unaffected.

set -u

# 1. require COMMISSAIRE_ROOT.
if [ -z "${COMMISSAIRE_ROOT:-}" ]; then
  echo "replay.sh: COMMISSAIRE_ROOT is required" >&2
  exit 2
fi

# 2. resolve both binaries COMMISSAIRE_ROOT-relative (never PATH).
CMSR="$COMMISSAIRE_ROOT/plugin/skills/faff/bin/commissaire"
FAFF="$COMMISSAIRE_ROOT/plugin/skills/faff/bin/faff"

# 3. fresh temp directory outside any git checkout; copy this capture into it.
SELF_DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d "${TMPDIR:-/tmp}/cbc-replay.XXXXXX")
cp -R "$SELF_DIR/." "$TMP/"

# 4. read run_id + run_segment_id from the copied demo-result.json (node is a harness dependency).
RUN_ID=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));process.stdout.write(String(d.run_id))' "$TMP/demo-result.json")
SEG=$(node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));process.stdout.write(String(d.bundle_identity.run_segment_id))' "$TMP/demo-result.json")
ANCHOR="$TMP/.faff/anchors/$RUN_ID/DEMO-1"

RC=0

# 5. Commissaire decision replay (public material only).
AV=$("$CMSR" audit verify --run-dir "$ANCHOR" --json 2>/dev/null)
AV_RESULT=$(printf '%s' "$AV" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).result))}catch(e){process.stdout.write("ERR")}})')
[ "$AV_RESULT" = "pass" ] || RC=1

# 6. flight-recorder reconciliation.
EC=$("$FAFF" effects check --run-dir "$ANCHOR" --issue DEMO-1 --json 2>/dev/null)
EC_ESC=$(printf '%s' "$EC" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).any_escape))}catch(e){process.stdout.write("ERR")}})')
[ "$EC_ESC" = "false" ] || RC=1

# 7. sealed-bundle verify over the temp copy.
BV=$("$FAFF" bundle verify --root "$TMP" --run-id "$RUN_ID" --run-segment-id "$SEG" --boundary-kind run-close --boundary-key run-close --json 2>/dev/null)
BV_VERDICT=$(printf '%s' "$BV" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).verdict))}catch(e){process.stdout.write("ERR")}})')
[ "$BV_VERDICT" = "CLEAN" ] || RC=1

# 8. report the three verdicts; exit 0 only when all three held.
echo "audit verify: $AV_RESULT"
echo "effects check: any_escape=$EC_ESC"
echo "bundle verify: $BV_VERDICT"

rm -rf "$TMP"
exit $RC
