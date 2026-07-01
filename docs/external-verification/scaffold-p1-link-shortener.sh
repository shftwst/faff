#!/usr/bin/env bash
# faff external-verification SUT scaffolder
# P1 — Verifiable greenfield micro-service (link-shortener).  Behaviours: B1 B2 B3 B6.
# First real exercise of architecture -> env -> evaluate on a non-faff product.
#
# Run in a NEW dir:
#   SUT_ROOT=~/workspace/shftwst/faff-suts/p1-link-shortener bash scaffold-p1-link-shortener.sh
set -euo pipefail

SLUG="p1-link-shortener"
SUT_ROOT="${SUT_ROOT:-$HOME/workspace/faff-suts/$SLUG}"

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
EOF

cat > .faffrc.yaml <<'EOF'
# faff config — SUT P1 (link-shortener). git-only, agile lens, lights-out eligible.
slots:
  methodology: faffter-dark-methodology-agile-delivery
  spec: faffter-dark-nlspec
  architecture: faffter-noon-architecture
  env: faffter-noon-env-compose
  evaluator: faffter-noon-evaluate
  review: faffter-noon-review
appetite: high
# git-only autonomous on-switch: default opt-in keeps autonomous OFF; opt-out enables it.
automation_default: opt-out
intake_gate: warn
budget:
  # max_attempts is the predictable cap. tokens is a runaway backstop only:
  # `faff budget check` sums cache_read, so a small ceiling breaches before a build lands.
  max_attempts: 6
  tokens: 30000000
  at_ceiling: stop
EOF

cat > BRIEF.md <<'EOF'
# SUT P1 — Link-shortener (greenfield micro-service)

A small, production-shaped URL shortener with a datastore. The DoD is **100% born-verifiable**
(every criterion is a real HTTP exchange), so the code-blind evaluator should produce clean
verdicts with **zero** `needs-human` punts. This is the first real exercise of
architecture → env → evaluate on a non-faff product.

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

## N. DONE
1. `POST /shorten`, `GET /{code}`, and `GET /healthz` implemented and serving under docker-compose.
2. A schema migration creates the codes table; codes persist across an api container restart.
3. Expiry honoured: an expired code returns 404.
4. `docker compose up` brings api+db healthy; `GET /healthz` returns 200 within 60s.
5. An automated test suite covers every Scenario above and passes.

## Out of scope
Auth, custom aliases, analytics, a UI. Keep it to the spine above.
EOF

cat > RUNBOOK.md <<'EOF'
# P1 Runbook — run + observe + score

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

## 3. If a lane doesn't auto-fire, drive it directly (this is the value — establishing the wiring)
    faff env compose-gen --profile <p>     # → ProvisionPlan + compose file
    faff env up   --plan <plan>            # docker compose up -d + health-wait → env-handle (status: ready|failed)
    faff env seed                          # seed synthetic data
    faff holdout verdicts --association <json>   # code-blind verdict of the spec DoD against the RUNNING env
    faff prdr coverage --dod-verdicts ...        # roll the verdicts into prd-satisfied
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

# Hooks: skill-owned + repeatable. Never a hand-edited settings.json with a hardcoded faff path.
faff="$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")"
"$faff" hooks-ensure 2>/dev/null && echo "wired faff Stop hooks via hooks-ensure" \
  || echo "  (faff hooks-ensure unavailable here — run it from the SUT once faff is on PATH)"

git add -A
git commit -q -m "chore: scaffold P1 link-shortener SUT (faff external testbed)" || true

echo
echo "P1 scaffolded at $SUT_ROOT"
echo "Next: open a Claude Code session with cwd=$SUT_ROOT and follow RUNBOOK.md"
