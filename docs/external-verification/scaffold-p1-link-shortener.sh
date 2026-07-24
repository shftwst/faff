#!/usr/bin/env bash
# faff external-verification SUT scaffolder
# P1 — Verifiable greenfield micro-service (link-shortener).  Behaviours: B1 B2 B3 B6.
# First real exercise of architecture -> env -> evaluate on a non-faff product.
#
# Run in a NEW dir:
#   SUT_ROOT=~/workspace/shftwst/faff-suts/p1-link-shortener bash scaffold-p1-link-shortener.sh
set -euo pipefail

# Resolved BEFORE the cd below (not lazily, at the box-env copy step) — BASH_SOURCE is only
# reliable relative to the invocation cwd; once the script cd's into $SUT_ROOT a relative
# invocation (e.g. `bash docs/external-verification/scaffold-p1-link-shortener.sh`) would resolve
# against the wrong directory.
FAFF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SLUG="p1-link-shortener"
SUT_ROOT="${SUT_ROOT:-$(dirname "$FAFF_ROOT")/faff-suts/$SLUG}"

if [ -e "$SUT_ROOT" ] && [ -n "$(ls -A "$SUT_ROOT" 2>/dev/null)" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "refusing to scaffold into non-empty $SUT_ROOT (set FORCE=1 to override)" >&2
  exit 1
fi

mkdir -p "$SUT_ROOT"
cd "$SUT_ROOT"
echo "scaffolding P1 (link-shortener) into $SUT_ROOT"
git init -q 2>/dev/null || true

cat > .gitignore <<'EOF'
node_modules/
dist/
*.log
.env.claude-box
.faffrc.local.yaml
EOF

cat > .faffrc.yaml <<'EOF'
# faff config — SUT P1 (link-shortener). git-only, agile lens, lights-out eligible.
# The two explicit L4 lights-out dials this SUT needs to clear `faff lights-out --check`
# dial-coherence: slots.review (adversarial), slots.spec_review (adversarial). The third leg,
# gates.fallback, is fail-closed BY DEFAULT since FAFF-522 shipped (PR #403) — no explicit line
# needed (FAFF-524 drops the restated-default line FAFF-513 originally planted here).
slots:
  methodology: faffter-dark-methodology-agile-delivery
  spec: faffter-dark-nlspec
  architecture: faffter-noon-architecture
  env: faffter-noon-env-compose
  evaluator: faffter-noon-evaluate
  review: faffter-dark-adversarial-review     # L4 dial: adversarial second-opinion (was faffter-noon-review)
  spec_review: faffter-dark-spec-review       # L4 dial: adversarial spec_review (was unset -> single-pass default)
appetite: high
# git-only autonomous on-switch: default opt-in keeps autonomous OFF; opt-out enables it.
automation_default: opt-out
intake_gate: warn
budget:
  # For L4 lights-out the budget-ceiling gate deliberately EXCLUDES max_attempts (a count is not
  # an L4 governor) — the real spend governors are budget.cost (dollars, priced from the ADR-0048
  # map — FAFF-427, the recommended default), budget.tokens, and budget.until. max_attempts may
  # stay wired as an optional extra backstop only.
  # `faff budget check` sums cache_read, so a small tokens ceiling breaches before a build lands.
  max_attempts: 6
  tokens: 30000000
  # cost: 15   # optional: budget.cost — the recommended L4 governor (FAFF-427)
  at_ceiling: stop
# backends: namespace (FAFF-523/529) — named entries the adversarial `review`/`spec_review` slots'
# refs below point at; replaces the legacy faffter_dark.adversarial primary+fallbacks scalar block.
# api_key_env names resolve from .env.claude-box at call time (name only, never the key itself —
# the box-env copy step below supplies the actual values, gitignored, never committed). Mirrors
# faff-root's own currently-served model ids. ollama-local is keyless (no .env.claude-box key
# needed) — its tailnet host is reachable from an in-cage SUT (operator has run this for months).
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
  # ollama-local (operator-private tailnet ollama backend) relocated to the
  # gitignored .faffrc.local.yaml overlay (FAFF-618, mirroring FAFF-587) so this
  # repo carries no operator host. The overlay's adversarial refs list restates
  # all three entries (sequences replace wholesale); this base advertises only
  # the two cloud backends.

# faffter-dark: adversarial `review`/`spec_review` slots' reference list — points at the named
# backends: entries above, primary-first (FAFF-523's ordered-reference form, no "primary" key).
faffter_dark:
  adversarial:
    refs:
      - nvidia-glm
      - gemini-gemma
EOF

# Local ollama overlay (FAFF-618): written from FAFF_EVAL_LOCAL_BASE_URL so the operator's
# tailnet host never lands in this committed config. The base heredoc above stays quoted;
# only this small overlay heredoc is unquoted, so ${FAFF_EVAL_LOCAL_BASE_URL} interpolates
# and nothing else in the base risks expanding.
if [ -n "${FAFF_EVAL_LOCAL_BASE_URL:-}" ]; then
  cat > .faffrc.local.yaml <<EOF
backends:
  ollama-local:
    provider: ollama
    model: qwen3-next:80b-a3b-instruct-q4_K_M
    host: ${FAFF_EVAL_LOCAL_BASE_URL}
    auth: none
    egress: local
faffter_dark:
  adversarial:
    refs:                      # sequence — replaces the base two-item list wholesale
      - nvidia-glm
      - gemini-gemma
      - ollama-local
EOF
  echo "wrote .faffrc.local.yaml (ollama-local backend, host from FAFF_EVAL_LOCAL_BASE_URL, gitignored)"
else
  echo "WARNING: FAFF_EVAL_LOCAL_BASE_URL unset — the SUT runs with the two cloud backends only; export it and re-scaffold (or hand-write .faffrc.local.yaml) to add the local ollama backend" >&2
fi

cat > BRIEF.md <<'EOF'
# SUT P1 — Link-shortener (greenfield micro-service)

A small, production-shaped URL shortener with a datastore.

## Stack preference (the architecture proposer reads this — there's no mined infra profile on a fresh repo)
- Language/runtime: **TypeScript on Node 20** (or Go 1.22 — pick the build-biased best fit).
- Datastore: **Postgres** (a real persistent store, exercised by env-compose + seed).
- Packaged to run under **docker-compose** (api + db), health-checked at `GET /healthz` → 200.
- Production-shaped: env-config, a migration for the schema, structured errors. Not a toy single-file.

## What to build
A REST service:
- `POST /shorten` `{ "url": "<absolute http(s) url>", "ttl_seconds"?: <int> }`
- `GET /{code}` → 302 redirect to the stored URL
- `GET /healthz` → 200 (liveness; env-compose health-checks this)

## Scenarios (born-verifiable — Given/When/Then)
- Given a valid absolute URL, When `POST /shorten`, Then status 201 and body has a `code` of exactly 7 base62 chars.
- Given a code returned by /shorten, When `GET /{code}`, Then status 302 and `Location` equals the original URL.
- Given an unknown code, When `GET /{code}`, Then status 404.
- Given a code created with `ttl_seconds: 1`, When `GET /{code}` after 2 seconds, Then status 404 (expired).
- Given the same URL shortened twice, When both POSTs return, Then the two codes are different (no dedup required).
- Given the api restarts, When `GET /{code}` for a pre-restart code, Then status 302 (persistence holds — proves the datastore is real, not in-memory).

## Out of scope
Auth, custom aliases, analytics, a UI. Keep it to the spine above.
EOF

cat > RUNBOOK.md <<'EOF'
# P1 Runbook — run + observe + score

## Operator framing (operator-only — NEVER pasted into the loop)
This restates what P1 measures and how it scores. It lives here, not in BRIEF.md, so it can never
reach the loop: feeding intent framing to the loop is teaching-to-the-test (it pre-warns the loop of
the exact failure modes the suite exists to catch — see FAFF-547). BRIEF.md is fed to the loop and
must stay a neutral build brief.

Intent: the DoD is 100% born-verifiable (every criterion is a real HTTP exchange), so the code-blind
evaluator should produce clean verdicts with zero needs-human punts. This is the first real exercise
of architecture → env → evaluate on a non-faff product.

Completion rubric (the scoring restatement — what "done" means for the operator, never for the loop):
1. `POST /shorten`, `GET /{code}`, and `GET /healthz` implemented and serving under docker-compose.
2. A schema migration creates the codes table; codes persist across an api container restart.
3. Expiry honoured: an expired code returns 404.
4. `docker compose up` brings api+db healthy; `GET /healthz` returns 200 within 60s.
5. An automated test suite covers every Scenario above and passes.

## 0. Pre-flight (Colima / Docker reachable from faff's shell)
    colima status            # running? if not: colima start
    docker context show      # should be 'colima'
    docker info  >/dev/null && echo "docker OK"
    docker compose version   # env-compose shells `docker compose`
If `docker info` fails here, env-compose will emit a `status: failed` handle (clean, visible) — fix Colima first.

## 1. (Optional) infra profile
    faff profile show --json    # exit 3 = no profile → architecture proposes from BRIEF.md alone (fine for P1)
    # faff profile mine         # a fresh repo has little to mine; the BRIEF's stack-pref section is the real signal

## 2. First-light: drive the chain OBSERVABLY (don't blind-fire lights-out)
Open a Claude Code session with cwd = THIS repo, then:
    /faff-jot   "<paste BRIEF.md>"     # shapes tickets; git-only → writes .faff/intake/
    /faff-prep  <first-ticket>         # → spec with born-verifiable Scenarios + DONE.  WATCH: does an architecture-proposal block appear?
    /faff-graft <that-ticket>          # builds the service.  WATCH: does `faff env up` stand a stack up + a holdout-verdict get emitted against the RUNNING endpoints?

Lights-out only: with no `FAFF_INTEGRITY_BOUNDARY` set, `faff lights-out --check` reports
`corrective-integrity` as an **advisory degrade, not a refusal** (FAFF-525) — admission proceeds on
the FAFF-518 digest custody floor. Setting a boundary is optional; it only buys the stronger
mount-asserted basis once the cage read-only-mounts the integrity dirs (FAFF-517). Compose it with
`faff integrity-boundary` if/when that lands (an automating cage supplies it; FAFF-514) — never a
fabricated value (fabricating it to clear the gate is the lying attestation FAFF-525 exists to
avoid). All three **dial-coherence** legs are already satisfied by this SUT's `.faffrc.yaml` — the
two explicit dials (`slots.review`, `slots.spec_review`) plus `gates.fallback`, fail-closed by
default (FAFF-522).

## 3. If a lane doesn't auto-fire, drive it directly (this is the value — establishing the wiring)
    faff env compose-gen --profile <p>     # → ProvisionPlan + compose file
    faff env up   --plan <plan>            # docker compose up -d + health-wait → env-handle (status: ready|failed)
    faff env seed                          # seed synthetic data
    faff holdout verdicts --association <json>   # pure bridge: reads the evaluator's persisted
                                                  # .faff/holdout/<key>.json verdicts (the
                                                  # evaluator slot already exercised the live
                                                  # endpoints to produce them) into prdr
                                                  # coverage's --dod-verdicts shape
    faff prdr coverage --prd-goals '<JSON array of DONE goals>' --dod-verdicts ...   # roll the verdicts into prd-satisfied
    faff env down                          # tear down (ephemeral)

## 4. Observe (the run's real signal)
    faff events read --run <id>     # the timeline
    faff audit <run-id>             # who/what/why forensics
    # The env-handle block (did docker stand up + health-check pass?)
    # The holdout-verdict block (did the evaluator HIT the endpoints, or read the code? prose → needs-human?)

## 5. Score P1 (B1/B2/B3/B6) — "did the behaviour occur + was the boundary respected", NOT "did it build it"
- [ ] B1 architecture: proposed a production-shaped stack (Node/Postgres-ish, compose-ready) — not a toy single-file
- [ ] B2 env: `faff env up` stood up api+db, health-check passed, seed ran
- [ ] B3 evaluate: holdout-verdict exercised the RUNNING endpoints (302/404/code-shape) — evidence shows HTTP calls, not source-reading
- [ ] B3-integrity: code-blind held (no diff/code in the evaluator's evidence)
- [ ] zero punts: a 100%-born-verifiable DoD produced NO needs-human (if it punted, why?)
- [ ] B6 terminate: the run reached a terminal run-done verdict, didn't stall/loop
- FIRST FAILURE RUNG = the binding constraint = the finding to take back to faff's backlog.
EOF

# Box env: copy the claude-box secret file (NVIDIA_API_KEY / GEMINI_API_KEY) so this SUT's
# adversarial-review backend can authenticate. FAFF_ROOT resolved at script-top (never hardcoded,
# never re-derived here — see the note above the cd into $SUT_ROOT), copied AFTER .gitignore
# already covers it (written above) so no ordering ever stages the secret (FAFF-524). Missing
# source warns and continues — the file is gitignored, so a fresh clone/contributor without box
# access legitimately lacks it.
if [ -f "$FAFF_ROOT/.env.claude-box" ]; then
  cp "$FAFF_ROOT/.env.claude-box" .env.claude-box
  echo "copied .env.claude-box from $FAFF_ROOT"
else
  echo "WARNING: .env.claude-box not found at $FAFF_ROOT — the SUT's adversarial-review backend will refuse until you supply it" >&2
fi

# Hooks: skill-owned + repeatable. Never a hand-edited settings.json with a hardcoded faff path.
faff="$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")"
"$faff" gitignore-ensure 2>/dev/null && echo "gitignored .faff/ via gitignore-ensure" \
  || echo "  (faff gitignore-ensure unavailable here — run it from the SUT once faff is on PATH)"
"$faff" hooks-ensure 2>/dev/null && echo "wired faff Stop hooks via hooks-ensure" \
  || echo "  (faff hooks-ensure unavailable here — run it from the SUT once faff is on PATH)"

# Secret-leak guard (FAFF-524 critical fix): a stale $SUT_ROOT re-used via FORCE=1 may carry a
# prior .git where .env.claude-box was already tracked — .gitignore never untracks an
# already-tracked file, so `git add -A` would re-stage the secret and the commit below would
# push it. Force it out of the index unconditionally (no-op on a fresh repo / untracked file).
git rm --cached --ignore-unmatch .env.claude-box >/dev/null 2>&1 || true

git add -A
git commit -q -m "chore: scaffold P1 link-shortener SUT (faff external testbed)" || true

echo
echo "P1 scaffolded at $SUT_ROOT"
echo "Next: open a Claude Code session with cwd=$SUT_ROOT and follow RUNBOOK.md"
