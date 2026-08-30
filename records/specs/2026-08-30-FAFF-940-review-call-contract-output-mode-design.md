# FAFF-940 — review-call.mjs contract-output mode so the spec-review judge can dispatch

> Spec: faffter-dark-nlspec · 2026-08-30 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-940.

## Why

The FAFF-922 spec-review judge (the would-be-park interceptor) cannot be dispatched through `review-call.mjs` as its own faff-prep wiring specifies, so it never produces a ruling. The deterministic pieces (the `spec-judge-evidence` assembler, the `spec-judge-verdict` contract and schema) ship and are tested; the LLM dispatch half is dead.

Root cause, confirmed empirically against origin/main: `review-call.mjs` runs `validateFindingsShape` unconditionally on every OK backend result (the chain loop, around line 1209). A `faff-contract:spec-judge-verdict` block is JSON, not findings-shaped (no `### <severity>:` section), and `normaliseCleanRefutation` only accepts the fixed one-to-two-line clean-refutation sentences. So a pure verdict block gives `validateFindingsShape.ok=false, kind=garbled` and the chain drops or advances past it. Even with every backend healthy, a well-formed judge verdict cannot come back through the transport. This blocks FAFF-930 (which revises the judge) and defeats the FAFF-922 "human is the last resort" goal.

A second, independent problem starves the judge on wall-clock: the last run dispatched the judge at a hand-picked timeout 300 / deadline 420 (a 210s slice), while the config resolves to 900 / 1800. Each judge backend must get its full configured attempt, and the refuter and judge chains need enough deadline and tight enough first-byte windows that a hung backend fails fast and the fallback chain still has room.

## What

Three coherent parts, all serving "make the spec-review judge actually dispatch, and give the reviews and the judge timeouts that run with fallback room to spare":

- **A — the transport fix.** Add an opt-in output mode to `review-call.mjs` that skips the findings-shape gate and returns the raw backend block for a consumer that validates it itself. The default (refuter) path is unchanged.
- **B — the dispatch wiring.** Point faff-prep's judge dispatch at the new mode and at the resolved config clock, not a hand-picked value.
- **C — the `.faffrc.yaml` tuning.** Widen the deadline so three refuter backends each get a full attempt, and tighten each backend's first-byte window so a dead host fails fast.
- **D — a test** that a stubbed judge verdict block round-trips the chain in contract mode intact, and that the default path still rejects a non-findings block.

Surface touched (all on origin/main, verified in the FAFF-940 worktree):

- `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` — `parseArgs`, `runReviewChain`, `main`.
- `plugin/skills/faff-prep/SKILL.md` — the "Spec-review judge" dispatch step (step 2).
- `.faffrc.yaml` — `adversarial.deadline` and five backends' `first_byte_timeout`.
- `test/adversarial-call.test.mjs` — the new FAFF-940 cases.

Not touched: the `spec-judge-verdict` contract and schema (already shipped and correct); the refuter path's shape gate (`validateFindingsShape`, `normaliseCleanRefutation`) stays byte-identical.

## How

### Part A — a contract-output mode on review-call.mjs

**Chosen:** add a `--expect contract` flag (with a bare `--no-findings-shape` alias) that sets `a.expectContract`, threaded into `runReviewChain` as `shared.expectContract` and consulted at the OK-result branch. This is the ticket's preferred option over shipping a bundled judge prompt that wraps the verdict in a `### <severity>:` envelope: the flag keeps the judge output decoupled from the refuter shape and does not depend on a model reliably emitting a wrapper.

**Chosen:** in contract mode the chain skips the findings-shape and clean-refutation gate and returns the raw backend content verbatim on an OK result. A non-empty result is accepted; an empty or whitespace-only result still pushes `NO_FINDINGS_CONTENT` and advances, so a dead backend never short-circuits the chain. Every other fallback-chain semantic (advance on transport, deadline, auth, config fault; per-backend slice; terminal exit mapping) is unchanged, because the branch sits inside the existing `exit === EXIT.OK` block and touches only the shape-gate lines.

**Chosen:** the default (refuter) path is byte-for-byte unchanged. `shared.expectContract` is falsy unless the flag is passed, so `validateFindingsShape` plus `normaliseCleanRefutation` still gate refuter output exactly as before. The contract branch is placed before those two calls and returns or continues, so on the default path the code below it runs identically.

**Chosen:** `main` emits the contract block verbatim. The refutation pass (`refuteFindings`) and the `ensureHeader` provenance-header prepend both assume findings-shaped content, so in contract mode `main` writes the winning block trimmed to stdout and returns `EXIT.OK` before reaching them. The consumer (faff-prep) validates the block with `faff contract spec-judge-verdict`; the transport does not.

### Part B — wire faff-prep's judge dispatch to the new mode and the resolved clock

**Chosen:** the "Spec-review judge" dispatch step passes `--expect contract` so the transport returns the ruling verbatim, and passes the resolved judge clock rather than a hand-picked value: `timeout = adversarial.spec_judge.timeout || adversarial.timeout` and `deadline = adversarial.spec_judge.deadline || adversarial.deadline`. This gives each judge backend in the chain its full configured attempt within the deadline. The change is prose in a SKILL.md that `faff validate-adapters` lints, so it stays lean and skimmable and adds no new lint failure.

### Part C — .faffrc.yaml timeout and first-byte tuning

**Chosen:** apply exactly these edits, chosen from measured behaviour (qwen measured TTFT ~50ms idle, ~74s worst case under 4-lens concurrent load; hosted backends first-byte in seconds):

- `adversarial.deadline`: 1800 to 2700 (three refuter backends times 900s timeout, so each gets a full attempt; keeps the code_review and judge fallbacks room).
- `spark-qwen-3-8.first_byte_timeout`: 600 to 180 (2.4x over the 74s worst case; a hung or dead qwen now fails in three minutes not ten, leaving the rest of the budget for fallbacks).
- add `openrouter-deepseek-v4-flash.first_byte_timeout: 120`.
- add `gemini-gemma-free.first_byte_timeout: 120`.
- add `openrouter-glm-5-2.first_byte_timeout: 180` (judge, reasoning-on, may be slower to first token).
- add `openrouter-glm-5-3-flash.first_byte_timeout: 180`.
- keep `adversarial.timeout: 900` unchanged.

**Chosen:** the adjacent comments are updated to match the new values so no stale number is left behind. No other key is touched.

### Part D — test

**Chosen:** add cases to `test/adversarial-call.test.mjs` using the existing injectable `runReviewFn` and `scriptedRunReview` helper, with a realistic well-formed `faff-contract:spec-judge-verdict` block (JSON, non-findings-shaped) as the stubbed backend return. The cases assert:

1. In contract mode (`expectContract: true`) the verdict block is returned intact (`res.content` byte-equal, `res.exit === OK`), guarded by an assertion that the same block is `garbled` under `validateFindingsShape` (proving the mode is what saves it).
2. In contract mode an empty OK result still advances to a healthy fallback (the dead-backend semantic).
3. On the default path the same block is rejected (not accepted as OK, no content returned; the chain exhausts to the pre-existing terminal exit) with the per-backend `malformed` drop logged, proving no regression to the refuter gate.
4. `main` in contract mode writes the block verbatim to stdout with no `## Adversarial findings` header prepended.

### Non-goals

**Punt:** whether the judge's ruling is correct or well-calibrated is out of scope. This ticket only makes the transport return the block and the dispatch give it a full attempt; FAFF-930 owns the judge's reasoning and re-preps once this is Done.

**Assumes:** `faff contract spec-judge-verdict` (the consumer-side validator) is already shipped and correct. Confirmed in the worktree: the contract and its schema exist and are tested, so contract mode only has to deliver the raw block for that validator to grade.

## Done (acceptance criteria)

1. `review-call.mjs parseArgs` accepts `--expect contract` (and the `--no-findings-shape` alias), setting `a.expectContract`; the usage string lists `--expect contract`. Verified: a new parseArgs assertion and the contract-mode `main` test exercising the flag.

2. `runReviewChain` in contract mode (`shared.expectContract`) returns a non-findings block verbatim on an OK result and does not run `validateFindingsShape` or `normaliseCleanRefutation` on it; an empty or whitespace-only OK result still advances. Verified: the two contract-mode chain tests (intact round-trip, empty-advances-to-fallback) in `test/adversarial-call.test.mjs`.

3. The default (refuter) path is unchanged: the same non-findings block is still dropped by the shape gate and the chain terminates at the pre-existing exit, with the `malformed` per-backend drop logged. Verified: the default-path regression test, plus the pre-existing shape-gate tests staying green.

4. `main` in contract mode writes the winning block verbatim to stdout (trimmed) and returns `EXIT.OK` without the findings header or the refutation pass. Verified: the `main` contract-mode test asserting stdout equals the block and carries no `Adversarial findings` header.

5. faff-prep's judge dispatch step passes `--expect contract` and the resolved `adversarial.spec_judge.timeout || adversarial.timeout` / `adversarial.spec_judge.deadline || adversarial.deadline` clock, not a hand-picked value. Verified: the SKILL.md step reads as specified and `faff validate-adapters` stays green.

6. `.faffrc.yaml` carries `adversarial.deadline: 2700`, `adversarial.timeout: 900` (unchanged), `spark-qwen-3-8.first_byte_timeout: 180`, and the added `first_byte_timeout` on `openrouter-deepseek-v4-flash` (120), `gemini-gemma-free` (120), `openrouter-glm-5-2` (180), `openrouter-glm-5-3-flash` (180), with adjacent comments matching. Verified: `faff config get` resolves each value and no other key changed.

7. The full engineering gate ladder is green: `faff validate-adapters`, `faff lint-refs`, `faff lint-cli-doc`, and the unit suite (`node --import ./test/hermetic-env.mjs --test`).

confidence: high
