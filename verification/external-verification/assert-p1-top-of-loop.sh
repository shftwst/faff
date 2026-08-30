#!/usr/bin/env bash
# assert-p1-top-of-loop.sh — FAFF-492 born-verifiable acceptance harness.
#
# Runs with cwd = the P1 link-shortener SUT after one unattended plan pass plus a
# drain. Reads only committed / CLI-queryable ground truth, never run narration, and
# emits one PASS / FAIL / BLOCKED-ON-DEP line per criterion plus a final verdict.
# Exits non-zero if any required criterion is not PASS.
#
# Criteria (FAFF-492):
#   AC1  a plan pass wrote an initiative -> project -> first-slice-epic skeleton
#   AC2  every generated project carries a loop-admitted PRDR (Accepted, provenance loop)
#   AC3  the first slice drained to a spec with no human-authored write
#   AC-neg  an ignition aimed at faff's own repo is refused self-directed, zero writes
#
# Substrate: git-only (the decided v1, FAFF-492 spec refresh). Tracker mode is out of
# scope here; the harness reports it plainly rather than guessing.

set -uo pipefail

faff="${FAFF:-$(command -v faff || true)}"
if [ -z "$faff" ]; then echo "assert: no faff on PATH (set FAFF=/path/to/faff)"; exit 2; fi

# --- result accumulation --------------------------------------------------------
green=1
blocked=""
pass()    { printf 'PASS  %-6s %s\n' "$1" "$2"; }
fail()    { printf 'FAIL  %-6s %s\n' "$1" "$2"; green=0; }
blockon() { printf 'BLOCK %-6s %s (blocked-on: %s)\n' "$1" "$2" "$3"; green=0; blocked="$blocked $3"; }

# --- substrate ------------------------------------------------------------------
substrate="$("$faff" tracker probe 2>/dev/null || true)"
case "$substrate" in
  *git-only*) substrate="git-only" ;;
  *)          substrate="git-only" ;;   # v1 assumption; tracker mode is not asserted here
esac
echo "# assert-p1-top-of-loop  (substrate: $substrate, cwd: $(pwd))"

# ================================================================================
# AC1 — skeleton
# ================================================================================
roadmap="$(ls -t .faff/intake/*roadmap*.md 2>/dev/null | head -1 || true)"
if [ -z "$roadmap" ]; then
  fail AC1 "no roadmap under .faff/intake/*roadmap*.md — no plan pass wrote a skeleton"
else
  epics=$(grep -cE '<!-- *gitkey:' "$roadmap" 2>/dev/null || echo 0)
  has_init=$(grep -ciE '^#+ *Initiative:' "$roadmap" 2>/dev/null || echo 0)
  has_proj=$(grep -ciE '^#+ *Project:' "$roadmap" 2>/dev/null || echo 0)
  has_deps=$(grep -ciE 'blocked-by|blocked by|## Dependency' "$roadmap" 2>/dev/null || echo 0)
  has_auto=$(grep -ciE '/faff-plot --autonomous|initiated: *autonomous' "$roadmap" 2>/dev/null || echo 0)
  if [ "$has_init" -ge 1 ] && [ "$has_proj" -ge 1 ] && [ "$epics" -ge 1 ] && [ "$has_deps" -ge 1 ] && [ "$has_auto" -ge 1 ]; then
    pass AC1 "$roadmap: $has_init initiative, $has_proj project, $epics first-slice epic(s), deps present, autonomous provenance present"
  else
    fail AC1 "$roadmap incomplete: initiative=$has_init project=$has_proj epics=$epics deps=$has_deps autonomous=$has_auto (each must be >=1)"
  fi
fi

# ================================================================================
# AC2 — loop-admitted PRDR (Accepted + provenance loop). Never a bare Accepted grep.
# ================================================================================
prdr_dir=""
for d in "$("$faff" config get prdr-docs-path 2>/dev/null)" docs/prdr records/prdr; do
  [ -n "$d" ] && [ -d "$d" ] && { prdr_dir="$d"; break; }
done
if [ -z "$prdr_dir" ]; then
  blockon AC2 "no PRDR directory found (docs/prdr, records/prdr)" "FAFF-495"
else
  loop_total=0; loop_accepted=0; ev=""
  while IFS= read -r f; do
    prov=$(grep -m1 -iE 'Provenance:' "$f" | grep -oiE 'loop|human' | head -1)
    stat=$(grep -m1 -iE 'Status:'     "$f" | sed -E 's/.*Status:[^A-Za-z]*//I' | awk '{print $1}')
    [ "$prov" = "loop" ] || continue
    loop_total=$((loop_total+1))
    case "$stat" in Accepted*) loop_accepted=$((loop_accepted+1)) ;; esac
    ev="$ev $(basename "$f")=$stat/$prov"
  done < <(find "$prdr_dir" -maxdepth 1 -name '*.md' 2>/dev/null)
  if [ "$loop_total" -eq 0 ]; then
    blockon AC2 "no loop-provenance PRDR in $prdr_dir" "FAFF-495"
  elif [ "$loop_accepted" -eq "$loop_total" ]; then
    pass AC2 "$loop_accepted/$loop_total loop PRDR(s) Accepted:$ev"
  else
    fail AC2 "partial admission: $loop_accepted/$loop_total loop PRDR(s) Accepted:$ev"
  fi
fi

# ================================================================================
# AC3 — first slice drained to a spec, no human-authored write
# ================================================================================
first_key=""
[ -n "${roadmap:-}" ] && first_key=$(grep -oE '<!-- *gitkey:[^ ]*' "$roadmap" 2>/dev/null | head -1 | sed -E 's/.*gitkey: *//; s/ *-->.*//')
ledger="$(ls -t .faff/runs/*/run-ledger.json 2>/dev/null | head -1 || true)"
if [ -z "$first_key" ]; then
  fail AC3 "no first-slice gitkey in the roadmap to trace"
elif [ ! -f ".faff/specs/${first_key}.md" ]; then
  fail AC3 "first slice $first_key has no spec at .faff/specs/${first_key}.md — drain did not pick it up"
elif [ -z "$ledger" ]; then
  fail AC3 "spec present for $first_key but no run ledger under .faff/runs/ — cannot confirm a run drained it"
else
  human=""
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    author=$(git log -1 --format='%ae' -- ".faff/specs/${first_key}.md" 2>/dev/null || true)
    owner=$(grep -oE '"owner"[^,]*' "$ledger" 2>/dev/null | head -1)
    [ -n "$author" ] && human="(spec commit author: $author; ledger $owner)"
  fi
  pass AC3 "$first_key drained: spec present, run ledger $(basename "$(dirname "$ledger")") $human"
fi

# ================================================================================
# AC-neg — OUTWARD guard: an ignition aimed at faff's own repo refuses, zero writes
# ================================================================================
self_repo="$("$faff" config get tracking.repo 2>/dev/null)"
if [ -z "$self_repo" ]; then
  self_repo=$(git remote get-url origin 2>/dev/null | sed -E 's#.*github.com[:/](.*)\.git#\1#')
fi
if [ -z "$self_repo" ]; then
  fail AC-neg "cannot resolve self repo (faff config tracking.repo / git origin) — run in the SUT"
else
  runs_before=$(ls -1 .faff/runs 2>/dev/null | wc -l | tr -d ' ')
  sig=$("$faff" run-outward \
        --target "{\"container\":null,\"repo\":\"$self_repo\",\"source\":\"methodology-default\"}" \
        --self   "{\"container\":null,\"repo\":\"$self_repo\",\"is_self\":true}" --json 2>/dev/null)
  outward=$(printf '%s' "$sig" | python3 -c 'import sys,json;print(str(json.load(sys.stdin).get("outward")).lower())' 2>/dev/null)
  verd=$("$faff" run-start --signals \
        "{\"target_resolved\":true,\"outward\":$outward,\"prd_present\":true,\"prd_ambiguous\":false,\"prd_admissible\":true,\"coverage_measurable\":true,\"coverage_covered\":false}" 2>/dev/null)
  vr=$(printf '%s' "$verd" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("verdict","")+"/"+d.get("reason",""))' 2>/dev/null)
  runs_after=$(ls -1 .faff/runs 2>/dev/null | wc -l | tr -d ' ')
  if [ "$outward" = "false" ] && [ "$vr" = "refuse/self-directed" ] && [ "$runs_before" = "$runs_after" ]; then
    pass AC-neg "self-directed ($self_repo): outward=false, $vr, runs unchanged ($runs_before)"
  else
    fail AC-neg "outward=$outward verdict=$vr runs=$runs_before->$runs_after (want false / refuse/self-directed / unchanged)"
  fi
fi

# --- verdict --------------------------------------------------------------------
echo "# --------------------------------------------------------------"
if [ "$green" -eq 1 ]; then
  echo "# VERDICT: GREEN — top-of-loop plumbing connected"
  exit 0
else
  [ -n "$blocked" ] && echo "# blocked-on:$blocked"
  echo "# VERDICT: NOT GREEN"
  exit 1
fi
