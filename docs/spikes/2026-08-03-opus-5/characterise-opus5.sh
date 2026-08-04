#!/usr/bin/env bash
# Characterise opus-5 vs opus-4.8 on the faff skill-judgement eval (evals-baseline workstream).
# Phase 1: measure. A full default-effort opus-5 sweep — reproduces the out-of-box behaviour you saw
# (you didn't crank effort, you just used it). Writes its OWN baseline file, so the committed opus-4.8
# baseline (eval/baselines/frontier.json) is never touched.
#
# Reads out per-kind accuracy / stability / format vs 4.8, so a low STABILITY kind = the flip-flopping,
# low ACCURACY = hallucination, low FORMAT = ignored the skill's output contract, and the `confidence`
# kind = "nonchalant about ignorance".
#
# Self-sequencing: waits for any in-flight sweep (e.g. FAFF-711) to finish first — one claude -p lane at
# a time (the ~/.claude.json race). Launch it now and leave it:
#   nohup bash docs/spikes/2026-08-03-opus-5/characterise-opus5.sh > .faff/report-opus5.log 2>&1 &
set -uo pipefail
cd /Users/shftwst/workspace/shftwst/faff
mkdir -p eval/report

echo "$(date '+%F %T') waiting for the eval lane to free (FAFF-711 or any run-evals to finish)..."
# ignore THIS script's own future node child by matching only already-running ones before we spawn
while pgrep -f "run-evals.mjs" >/dev/null 2>&1; do sleep 60; done
echo "$(date '+%F %T') lane free — starting opus-5 characterisation."

M="claude-opus-5"
OUT="eval/baselines/frontier-opus5.json"
LOG="eval/report/characterise-opus5.log"

echo "=== $(date '+%F %T') full frontier sweep on ${M} (default effort) -> ${OUT} ==="
if node eval/run-evals.mjs --driver frontier --model "${M}" --update-baseline "${OUT}" 2>&1 | tee "${LOG}"; then
  echo "=== $(date '+%F %T') ${M} sweep DONE ==="
else
  echo "=== $(date '+%F %T') ${M} sweep FAILED (see ${LOG}) — aborting readout ==="
  exit 1
fi

echo ""
echo "================= opus-5 vs opus-4.8 — per-kind readout ================="
python3 - "$OUT" eval/baselines/frontier.json <<'PY'
import json, sys
o5 = json.load(open(sys.argv[1]))["per_kind"]
o48 = json.load(open(sys.argv[2]))["per_kind"]
kinds = sorted(set(o5) & set(o48))
def d(a, b): return f"{a-b:+.2f}"
rows = []
for k in kinds:
    a5, s5, f5 = o5[k]["accuracy"], o5[k]["stability"], o5[k]["format_adherence"]
    a4, s4, f4 = o48[k]["accuracy"], o48[k]["stability"], o48[k]["format_adherence"]
    worst = min(a5 - a4, s5 - s4, f5 - f4)   # most-negative delta = where opus-5 regresses hardest
    rows.append((worst, k, a5, a4, s5, s4, f5, f4))
rows.sort()   # worst regressions first
print(f"{'kind':22} {'acc o5/o48':>13} {'stab o5/o48':>14} {'fmt o5/o48':>13}   flags")
for worst, k, a5, a4, s5, s4, f5, f4 in rows:
    flags = []
    if a5 < a4 - 0.05: flags.append("ACC↓ (hallucination)")
    if s5 < s4 - 0.05: flags.append("STAB↓ (flip-flop)")
    if f5 < 1.0 and f5 < f4: flags.append("FMT↓ (ignored contract)")
    print(f"{k:22} {a5:.2f}/{a4:.2f}({d(a5,a4)}) {s5:.2f}/{s4:.2f}({d(s5,s4)}) {f5:.2f}/{f4:.2f}({d(f5,f4)})   {', '.join(flags)}")
# headline
worst_stab = sorted(kinds, key=lambda k: o5[k]["stability"] - o48[k]["stability"])[:5]
worst_acc  = sorted(kinds, key=lambda k: o5[k]["accuracy"]  - o48[k]["accuracy"])[:5]
print()
print("biggest STABILITY drops (the flip-flop signature):", ", ".join(worst_stab))
print("biggest ACCURACY drops (hallucination/wrong-judgement):", ", ".join(worst_acc))
print()
print("If the drops cluster on a few kinds -> Phase 2: re-sweep those with --effort high (driver tweak) + a reinforced prompt to see if tamable.")
print("If they're broad and deep -> opus-5 isn't ready for faff; 4.8 stays.")
PY
echo "========================================================================"
