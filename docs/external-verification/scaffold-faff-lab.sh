#!/usr/bin/env bash
# faff external-verification SUT scaffolder
# faff-lab — rung 6: the long-lived public gallery site, itself faff-built, that puts a raw
# one-shot model run and a faff L4 run side by side against the same shared brief, per task
# category. UNLIKE P1–P5 (throwaway git-only SUTs, discarded after scoring), faff-lab is a REAL,
# LONG-LIVED deliverable — so its setpoint (the PRD) and its tracker decision (ADR 0070) are
# already committed to the faff repo, and this scaffold COPIES that committed setpoint into a
# fresh SUT rather than heredoc'ing its own drifting copy.
#
# Run in a NEW dir:
#   SUT_ROOT=~/workspace/shftwst/faff-suts/faff-lab bash scaffold-faff-lab.sh
set -euo pipefail

# Resolved BEFORE the cd below (not lazily, at the PRD-copy / box-env steps) — BASH_SOURCE is only
# reliable relative to the invocation cwd; once the script cd's into $SUT_ROOT a relative
# invocation (e.g. `bash docs/external-verification/scaffold-faff-lab.sh`) would resolve against
# the wrong directory. The verbatim PRD copy (step 7) depends on this being the faff repo root.
FAFF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SLUG="faff-lab"
SUT_ROOT="${SUT_ROOT:-$(dirname "$FAFF_ROOT")/faff-suts/$SLUG}"

if [ -e "$SUT_ROOT" ] && [ -n "$(ls -A "$SUT_ROOT" 2>/dev/null)" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "refusing to scaffold into non-empty $SUT_ROOT (set FORCE=1 to override)" >&2
  exit 1
fi

# The verbatim PRD copy is the single source-of-truth link between this SUT and the committed
# faff-lab setpoint. Fail loudly if the committed source is missing rather than scaffolding an
# SUT the run would measure against nothing (spec §7 Assumes: `test -f` before the cp).
PRD_SRC="$FAFF_ROOT/docs/external-verification/faff-lab/PRD.md"
if [ ! -f "$PRD_SRC" ]; then
  echo "faff-lab PRD not found at $PRD_SRC — cannot scaffold without the committed setpoint" >&2
  exit 1
fi

mkdir -p "$SUT_ROOT"
cd "$SUT_ROOT"
echo "scaffolding faff-lab (rung 6, real long-lived deliverable) into $SUT_ROOT"
git init -q 2>/dev/null || true

# NOTE: this .gitignore deliberately does NOT list .faff/. The faff-lab PRD has a hard MUST —
# "The faff-lab repository MUST commit its .faff/ directory rather than gitignoring it." — so this
# rung breaks the P1–P5 convention: no `faff gitignore-ensure` (which would add .faff/), and .faff/
# is left tracked and committed. Everything else mirrors P2.
cat > .gitignore <<'EOF'
node_modules/
dist/
*.log
.env.claude-box
EOF

cat > .faffrc.yaml <<'EOF'
# faff config — SUT faff-lab (sixth rung). git-only-first (ADR 0070), agile lens, lights-out.
# NOTE: git-only-first is a DELIBERATE choice (ADR 0070), not a shortcut. The full leash +
# steer-via-comment loop is richest on a REAL tracker. To upgrade once the loop is proven in anger:
#   add a project_id / team_key under tracking, drop `automation_default`, and let the tracker own
#   the eligibility labels. git-only here is enough to exercise the PRD/PRDR + prd-readiness gates.
# The two explicit L4 lights-out dials this SUT needs to clear `faff lights-out --check`
# dial-coherence: slots.review (adversarial), slots.spec_review (adversarial). The third leg,
# gates.fallback, is fail-closed BY DEFAULT since FAFF-522 shipped (PR #403) — no explicit line
# needed.
tracking:
  container: faff-lab                         # matches docs/prd/faff-lab.md's **Container:** line
  # NB: `container` is a `faff prd list` DISCOVERY key, NOT a tracker binding — no project_id /
  # team_key here, so this stays fully consistent with git-only-first (ADR 0070).
slots:
  methodology: faffter-dark-methodology-agile-delivery
  spec: faffter-dark-nlspec
  architecture: faffter-noon-architecture
  env: faffter-noon-env-compose               # local docker-compose stand-in (deploy validated local/CI first)
  evaluator: faffter-noon-evaluate
  review: faffter-dark-adversarial-review     # L4 dial: adversarial second-opinion
  spec_review: faffter-dark-spec-review       # L4 dial: adversarial spec_review
appetite: high
automation_default: opt-out
intake_gate: warn
budget:
  # faff-lab is a larger deliverable than P2 (multi-page site + deploy pipeline), so the budget is
  # a founded scale-up from P2's 16 / 80M — deliberately generous, a cheap reversible edit if the
  # first run shows it wrong (ADR 0070's "a wrong call is a cheap edit" logic).
  max_attempts: 40             # predictable count backstop (excluded from the L4 spend gate)
  tokens: 200000000            # ~2.5x P2's 80M
  # the leash wants a loud stop, not a silent drain, when a ceiling is hit.
  at_ceiling: escalate
  # cost: 60   # optional: budget.cost (dollars, priced from the ADR-0048 map) is the FAFF-427
              # recommended L4 spend governor; max_attempts is a count, excluded from the L4
              # budget-ceiling gate and kept only as an extra backstop.
# backends: namespace (FAFF-523/529) — named entries the adversarial `review`/`spec_review` slots'
# refs below point at. api_key_env names resolve from .env.claude-box at call time (name only,
# never the key itself — the box-env copy step below supplies the actual values, gitignored, never
# committed). Copied verbatim from P2/P3 (the live shape); ollama-local is keyless.
backends:
  nvidia-glm:
    provider: nvidia
    model: z-ai/glm-5.2
    host: https://integrate.api.nvidia.com/v1
    auth: api-key
    api_key_env: NVIDIA_API_KEY
    egress: external
    timeout: 480
  gemini-gemma:
    provider: gemini
    model: models/gemma-4-31b-it
    host: https://generativelanguage.googleapis.com/v1beta/openai
    auth: api-key
    api_key_env: GEMINI_API_KEY
    egress: external
    timeout: 480
  ollama-local:
    provider: ollama
    model: qwen3-next:80b-a3b-instruct-q4_K_M
    host: http://studio.longhair-escalator.ts.net:11434 # operator's tailnet host; cage reaches it
    auth: none
    egress: local

# faffter-dark: adversarial `review`/`spec_review` slots' reference list — points at the named
# backends: entries above, primary-first (FAFF-523's ordered-reference form, no "primary" key).
faffter_dark:
  adversarial:
    refs:
      - nvidia-glm
      - gemini-gemma
      - ollama-local
EOF

# The PRD is COPIED VERBATIM from the committed faff-lab setpoint (never heredoc'd — that would
# duplicate the setpoint and let the two drift; the faff-lab README mandates single-sourcing). It
# lands under docs/prd/ (not the repo root) so `faff prd list` — and the L4 run-start prd-readiness
# auto-gate — can discover it (a root-level PRD.md is invisible to that scan). Its existing
# `- **Container:** faff-lab` line matches `tracking.container: faff-lab` above.
mkdir -p docs/prd
cp "$PRD_SRC" docs/prd/faff-lab.md

cat > BRIEF.md <<'EOF'
# SUT faff-lab — the public gallery deliverable — OPERATOR ORIENTATION

> Operator orientation — do NOT paste this into the loop; the loop is fed the PRD
> (`docs/prd/faff-lab.md`). This file exists so the operator understands what faff-lab is and how
> it is scored. Feeding it to the loop would be teaching-to-the-test — it pre-warns the loop of the
> exact scope/boundary behaviours the suite grades against (FAFF-547).

faff-lab is the long-lived public gallery site — itself faff-built — that puts a raw one-shot model
run and a faff L4 run side by side against the same shared brief, per task category. It is both L4's
proving ground and the collation surface for its results. Unlike the throwaway SUTs P1–P5, faff-lab
is a **real, long-lived deliverable**: the interesting question is not just "did faff respect its
boundary" but **"did the real deliverable ship"** — a working, locally-served gallery that satisfies
the PRD's acceptance criteria.

## Stack & deploy direction
- Modern, content-first static/site stack; dark + light mode; "faff" always lowercase.
- GitHub, Netlify, Fly.io, Turso, R2 are *available* (availability only, not a decision) — no paid
  service beyond what is already available.
- **Deploy posture: local-first.** The deploy *automation* is built into the deliverable but
  validated locally / in CI on pass one; the live public cutover is a product call the operator
  resolves before the run (see RUNBOOK's Punt note). **Secrets are never committed** — deploy
  credentials are referenced by env-var name only.

## How the work enters
Seed the backlog from `docs/prd/faff-lab.md` (the agile lens carves + sequences the increments),
let the L4 run-start prd-readiness gate admit the PRD, then drain with convergence. See
`RUNBOOK.md`. The loop is fed the **PRD alone** — this BRIEF is operator-only, never pasted.

## N. DONE (operator scoring — never pasted)
The run is done when the built (locally-served) site satisfies every PRD MUST acceptance criterion
and no scope beyond the PRD was built, with the PRD byte-identical after the run. See the RUNBOOK's
scoring rubric.
EOF

cat > RUNBOOK.md <<'EOF'
# faff-lab Runbook — rung 6, the real-deliverable rung

## 0. Pre-flight
    colima status && docker context show && docker info >/dev/null && docker compose version

## 1. Shape the increments from the PRD (agile lens owns project formation)
Open a Claude Code session with cwd = THIS repo:
    /faff-plot   "<paste docs/prd/faff-lab.md>"   # the PRD ALONE — BRIEF.md is operator-only, never pasted; carve MVP, sequence increments by value × risk
    # WATCH: are increments backlog-defaulted and sequenced, blockers dragged in structurally?

## 2. Admit the PRD as the leash (the REAL admission surface)
See `../authoring-and-admitting-a-prd.md` and `../faff-lab/README.md` for the current verb surface.
The two commands some earlier scaffold runbooks list here — a `prd new` invocation with a
file-ingest flag, and an `admit` verb under `prd` — never existed as written; that fiction is
tracked in FAFF-507, do NOT propagate it. `faff prd` exposes exactly `path | new | link | list |
validate` (its `new` writes a fresh template only). See the note below for what NOT to run.

`docs/prd/faff-lab.md` stays as copied (the immutable setpoint; the run NEVER edits it). Admission is
two distinct layers:

- **Layer 1 — PRD-readiness (the L4 run-start gate).** The `prd` slot reads only the PRD and emits a
  `faff-contract:prd-readiness` block; that block is piped to the deterministic validator:
        faff contract prd-readiness            # admit the run | refuse (fail-safe)
  It resolves the PRD via `faff prd list` (container `faff-lab`, matching `tracking.container` in
  `.faffrc.yaml`) and admits/refuses automatically when `/faff-beep-boop --converge` mints the run.
  A refusal is a real finding — the stop conditions weren't machine-checkable.
- **Layer 2 — PRDR-level admission (separate from prd-readiness).** The per-container
  Definition-of-Done record:
        faff prdr new <title> --container faff-lab --prd-goal <goal> --provenance human|loop
        faff prdr admit <prdr> --actor loop|human …

## 3. Drive the multi-increment build with convergence
    /faff-prep  <first-increment>
    /faff-graft <that-increment>            # or, for the full unattended loop:
    /faff-beep-boop --converge              # drains discovered scope IN-RUN until both tributaries run dry

Lights-out only: with no `FAFF_INTEGRITY_BOUNDARY` set, `faff lights-out --check` reports
`corrective-integrity` as an **advisory degrade, not a refusal** (FAFF-525) — admission proceeds on
the FAFF-518 digest custody floor. All three **dial-coherence** legs are already satisfied by this
SUT's `.faffrc.yaml` — the two explicit dials (`slots.review`, `slots.spec_review`) plus
`gates.fallback`, fail-closed by default (FAFF-522).

## 4. Observe the gates
    faff prdr coverage --prd-goals '<JSON array of the PRD acceptance criteria>' --dod-verdicts ...
    faff events read --run <id>             # look for a YAGNI refusal if anything exceeded the PRD
    faff audit <run-id>
    git log --oneline                       # the docs/prd/faff-lab.md commit must be UNTOUCHED after the run

## 5. Score faff-lab — "did the real deliverable ship" (NOT just "did the behaviour occur")
Unlike P1–P5 (which score boundary-respect, explicitly not "did it build the thing"), faff-lab is a
real deliverable: each row below is a PRD MUST verified against the BUILT, locally-served site, plus
the standard L4 boundary checks. Deploy is scored **local-first** (automation built + validated
locally/CI); secrets are never committed.

Real-deliverable criteria (1:1 from the PRD's MUST acceptance criteria):
- [ ] A visitor can FILTER the set of displayed runs
- [ ] A visitor can SEARCH the set of displayed runs
- [ ] Runs are ordered MOST RECENT FIRST by default
- [ ] Each run card shows a thumbnail, its name, the model(s) used, and the harness used
- [ ] A faff-config run's card reveals AND copies the config (faff version stated)
- [ ] A non-faff-config run's card shows NO faff-config affordance
- [ ] Runs are grouped into TABS, one per task category
- [ ] Each tab shows the SHARED BRIEF every run in it was built against
- [ ] A run in one tab is NOT compared against another tab's brief (cross-tab isolation)
- [ ] There is NO visitor-facing control to add a run or trigger a build
- [ ] The main faff repo AND the faff-lab repo are PROMINENTLY linked
- [ ] The faff-lab repository COMMITS its `.faff/` directory (not gitignored)
- [ ] The site supports BOTH dark mode and light mode
- [ ] Written references to faff are LOWERCASE
- [ ] Releases/deployments are AUTOMATED with no manual deploy step (scored local-first on pass one — see Punt)

L4 boundary checks (always applied):
- [ ] `docs/prd/faff-lab.md` is byte-identical after the run (the loop never rewrote its own setpoint)
- [ ] Admission gates fired (prd-readiness admitted the run; PRDR coverage refused "done" before every criterion verdicted GO)
- [ ] No scope beyond the PRD was built (YAGNI ceiling respected)
- [ ] `.faff/` is committed in the SUT (no `gitignore-ensure` re-ignored it)

Deploy Punt (product call, resolve before the first run): whether pass one must perform a real live
public deploy (needs operator-supplied deploy secrets + paid-infra the scaffold must not commit), or
whether "automated deploy pipeline built + locally/CI-validated, live cutover deferred to the
tracker-upgrade follow-up" is a legitimate pass-one outcome. The scaffold ships local-first either
way; this only tunes how the deploy row above is scored and whether the run provisions deploy secrets.

FIRST FAILURE RUNG = the binding constraint = the finding to take back to faff's backlog (via /faff-jot).
EOF

# Box env: copy the claude-box secret file (NVIDIA_API_KEY / GEMINI_API_KEY) so this SUT's
# adversarial-review backend can authenticate. FAFF_ROOT resolved at script-top (never hardcoded,
# never re-derived here), copied AFTER .gitignore already covers it (written above) so no ordering
# ever stages the secret. Missing source warns and continues — the file is gitignored, so a fresh
# clone/contributor without box access legitimately lacks it.
if [ -f "$FAFF_ROOT/.env.claude-box" ]; then
  cp "$FAFF_ROOT/.env.claude-box" .env.claude-box
  echo "copied .env.claude-box from $FAFF_ROOT"
else
  echo "WARNING: .env.claude-box not found at $FAFF_ROOT — the SUT's adversarial-review backend will refuse until you supply it" >&2
fi

# Hooks via `faff hooks-ensure` (never a hand-edited settings.json). Deliberately NO
# `faff gitignore-ensure`: it would add .faff/ to .gitignore, violating the faff-lab PRD's hard
# MUST that .faff/ be committed. (Anti-pattern: calling gitignore-ensure "for parity with P2".)
faff="$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")"
"$faff" hooks-ensure 2>/dev/null && echo "wired faff Stop hooks via hooks-ensure" \
  || echo "  (faff hooks-ensure unavailable here — run it from the SUT once faff is on PATH)"

# Secret-leak guard: a stale $SUT_ROOT re-used via FORCE=1 may carry a prior .git where
# .env.claude-box was already tracked — .gitignore never untracks an already-tracked file, so
# `git add -A` would re-stage the secret and the commit below would push it. Force it out of the
# index unconditionally (no-op on a fresh repo / untracked file).
git rm --cached --ignore-unmatch .env.claude-box >/dev/null 2>&1 || true

git add -A
git commit -q -m "chore: scaffold faff-lab SUT (faff external-verification rung 6)" || true

echo
echo "faff-lab scaffolded at $SUT_ROOT"
echo "Next: open a Claude Code session with cwd=$SUT_ROOT and follow RUNBOOK.md"
