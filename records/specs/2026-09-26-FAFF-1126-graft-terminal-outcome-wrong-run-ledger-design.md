# FAFF-1126 — Interactive graft's terminal outcome write lands in the wrong run ledger

> Spec: faffter-dark-nlspec · 2026-09-26 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1126.

Standalone/top-level interactive `/faff-graft`'s Step-10 terminal-outcome write can record the run outcome into a **foreign** run ledger instead of the run's own, silently. Two independent defects combine; this ticket fixes both the immediate cause and adds a general guard, and punts the deeper hygiene question of why stray ledgers exist.

## Root cause (verified this prep)

`recordOutcome` (`plugin/skills/faff/bin/lib/run-ledger.js:535`) resolves the target run dir as `--run-dir || process.env.FAFF_RUN_DIR || latestRunDir(root)`. Graft's Step-10 block (`faff-graft/SKILL.md:820`) invokes it as `run-ledger record-outcome --issue <ISSUE> --outcome <terminal>` — **no `--run-dir`**. It relies on `$FAFF_RUN_DIR`, which graft's Step-3 mint sets via `export FAFF_RUN_DIR="$run_dir"`.

The trap: in an agent-driven harness **each shell invocation is a fresh process**, so the Step-3 `export` does not survive to the separate Step-10 shell. `$FAFF_RUN_DIR` is unset there, resolution falls through to `latestRunDir(root)`, and that returns the newest run dir on disk — which can be a **different, foreign run** (a concurrently-minted or stray `run-…-graft-<other>`). The outcome is then written into that foreign ledger while the real run's ledger stays `owner: running, outcomes: {}`.

Observed live: `record-outcome --issue FAFF-1124` wrote `outcomes: {FAFF-1124: shipped}` into `run-…-graft-FAFF-1096` (admitted `[FAFF-1096]`), leaving `run-…-graft-FAFF-1124` untouched. Confirmed `recordOutcome` does **no** `issue ∈ admitted` validation — `applyTerminalOutcome` sets `outcomes[issue]` unconditionally, so the misattributed write succeeded.

## What to build and why

**Chosen:** Fix the graft Step-10 block to pass `--run-dir "$run_dir"` explicitly, using the run dir path Step 3 already captured. Rationale: the run dir is known at Step 10 (a shell variable in the same logical flow); relying on `$FAFF_RUN_DIR` is unsafe because the harness does not persist env across Bash calls, and `latestRunDir` is a foreign-run hazard. Every other graft step that needs the run dir already passes it explicitly (`faff heartbeat "$run_dir"`, `faff events anchor --run-dir "$run_dir"`, `faff bundle publish --run-dir "$run_dir"`); Step-10's record-outcome is the lone omission. This is the immediate, targeted cause.

**Chosen:** Add a defense-in-depth guard in `recordOutcome`: refuse (exit non-zero) when the resolved issue is **not** in the resolved ledger's `admitted[]`. Rationale: an outcome for a non-admitted issue always violates the runcheck invariant `outcomes.keys() ⊆ admitted`, so it is never legitimate; the guard catches the misattribution class **regardless of caller or environment** (it would have caught this exact bug even with the SKILL unfixed). The check runs inside the existing `mutateLedgerUnderLock` closure (which already reads `fresh`), before applying the outcome; the error names the mismatch and directs the caller to pass `--run-dir` for the correct run. It is orthogonal to how the run dir resolved, so an explicit `--run-dir` pointing at the wrong run is caught too.

**Chosen:** Cover both with a test: (a) `record-outcome --run-dir <named>` writes into that named ledger, not the newest on disk (mint two run dirs, target the older, assert the newer is untouched); (b) `record-outcome --issue X` against a ledger whose `admitted` does not contain X exits non-zero and writes nothing.

**Assumes:** Every legitimate `record-outcome` caller records an outcome only for an issue already in that run's `admitted[]` — interactive `init-interactive` admits `[issue]` at mint, and orchestrator/dispatched runs admit before build. Verified against `init-interactive` (admits `[issue]`) and the graft/beep-boop admit flow. If a legitimate pre-admission outcome write exists, the guard would need a carve-out; none is known.

**Assumes:** The resolution precedence `--run-dir > $FAFF_RUN_DIR > latestRunDir` is a correct CLI contract and stays unchanged — the defect is the SKILL not passing `--run-dir`, not the precedence itself. The guard makes the `latestRunDir` fallback safe by construction (a foreign run fails the admitted check).

**Punt:** Why stray `owner: "running"` run ledgers accumulate unreconciled (observed: `run-…-graft-FAFF-1078`, `run-…-graft-FAFF-1096`) — the residue that makes `latestRunDir` land on a foreign run in the first place. That is a separate investigation (what mints them, why they never reach `owner: done`, and whether they should be cleaned up or excluded from `latestRunDir`), of different character from this write-robustness fix. File as a follow-up ticket; this fix makes the outcome write correct regardless of the strays' existence. `(defers: a follow-up ticket)`

## Acceptance criteria

1. `faff-graft/SKILL.md` Step-10 terminal-outcome block invokes `run-ledger record-outcome` with `--run-dir "$run_dir"` (the run this graft minted), not relying on `$FAFF_RUN_DIR` or the `latestRunDir` fallback.
2. `recordOutcome` refuses with a non-zero exit and writes nothing when `--issue` is not in the resolved ledger's `admitted[]`; the message names the issue, the resolved run id, and directs the caller to pass `--run-dir`.
3. The guard runs regardless of how the run dir resolved (explicit `--run-dir`, `$FAFF_RUN_DIR`, or `latestRunDir` fallback).
4. A test asserts `record-outcome --run-dir <older>` writes the older ledger and leaves a newer run dir untouched.
5. A test asserts `record-outcome` for a non-admitted issue exits non-zero and the ledger is byte-unchanged.
6. The full existing suite stays green; `validate-adapters` passes (the SKILL edit stays within its line-cap baseline, bumped if needed).
7. The stray-ledger hygiene question is filed as a follow-up ticket (the Punt), linked from this one.

confidence: high
build-tier: mechanical

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    {"marker": "chosen", "topic": "Graft Step-10 passes --run-dir explicitly (harness does not persist FAFF_RUN_DIR across Bash calls)"},
    {"marker": "chosen", "topic": "recordOutcome refuses an outcome for an issue not in the resolved ledger's admitted[] (defense-in-depth, caller/env-agnostic)"},
    {"marker": "chosen", "topic": "Tests for named-run-dir targeting and the non-admitted refusal"},
    {"marker": "assumes", "topic": "Every legitimate caller records only for an already-admitted issue"},
    {"marker": "assumes", "topic": "The --run-dir > FAFF_RUN_DIR > latestRunDir precedence stays unchanged"},
    {"marker": "punt", "topic": "Why stray owner:running ledgers accumulate — a separate follow-up investigation"}
  ]
}
```
