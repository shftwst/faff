# Retain raw adversarial-review response bodies (per lens / backend / round)

> Spec: faffter-dark-nlspec · 2026-08-28 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-928.

## Why

The live adversarial-review chain (`plugin/skills/faffter-dark-adversarial-review/review-call.mjs`, fanned out per lens by `fan-out.mjs`) **discards a backend's raw response body the instant it classifies it**. Inside `runReviewChain()`:

- The *winning* backend's raw body is read into `originalContent` (review-call.mjs:1208), fed to `validateFindingsShape` / `normaliseCleanRefutation`, has a `sha256` logged to stderr (:1221-1222), and is then dropped — the chain returns only the normalised content (:1225).
- Every *advanced-past* backend's body is never captured at all: on a non-findings/failed classification the loop only does `failureClasses.push(exit)` plus a one-line `[chain] … → advancing` stderr note (:1211-1218, :1227-1231). The bytes the model actually returned are gone.

So a misclassification cannot be inspected after the fact, and there is no corpus of raw responses to calibrate the clean-vs-malformed classifier or to compare backends. This was surfaced diagnosing **FAFF-927** (a clean/no-findings response misclassified `malformed`): the reason (missing `### <severity>:` marker) was recoverable from the chain log, but the raw deepseek body itself was already discarded.

## What

Persist the **raw response body for every lens × backend × round** the chain touches — the served backend *and* every backend advanced past — to a bounded, hard-floor machine artifact under the spec-review scratch dir, **regardless of classification** (findings-bearing, clean, malformed, empty, refusal, or a no-body transport/auth failure).

Non-goals: this ticket does **not** change any classification behaviour (that is FAFF-927), does **not** add outcome logic to `fan-out.mjs` (its anti-pattern note L195-199 forbids it), and adds no runtime dependency (review-call.mjs stays node-stdlib-only).

## How

**Chosen: capture inside `runReviewChain` in `review-call.mjs`, the only site that sees every backend's raw body.** `fan-out.mjs` is pure transport and the `spec_review` occupant only ever receives the winner's normalised stdout, so neither can retain the advanced-past bodies. Capturing in `runReviewChain` — where each backend's `result.content` (or its no-content failure note) is already in hand — is the one place all bodies are reachable.

**Chosen: capture the raw body *before / independently of* the classification branch.** For each backend iteration, record `result.content` (the raw bytes, matching the FAFF-806 rule that classification already keys off the raw `originalContent`) as soon as `runReview` returns, ahead of the `validateFindingsShape` / `normaliseCleanRefutation` decision. Rationale: retention must not depend on which class a body lands in, and must **compose with FAFF-927** (which adds a new clean/no-findings class to the same block) in either merge order — a design that hooked *into* a specific class branch would break when FAFF-927 re-partitions those branches.

**Chosen: `review-call.mjs` learns where/how to name artifacts via new CLI flags `--raw-dir <dir>`, `--lens <name>`, `--round <n>`; the `spec_review` occupant supplies them.** review-call.mjs today knows neither the lens, the round, nor the scratch dir. The occupant (`faffter-dark-spec-review`) already resolves the scratch dir via `faff spec-review-dir --issue <ISSUE> [--run-dir …]` and knows the lens + round when it assembles each `LensRequest.argv`, so it passes `--raw-dir <scratch>/raw --lens <lens> --round <n>` per invocation. Rationale vs. the alternative (surfacing every raw body back up through the child's stdout for the occupant to write): stdout currently carries only the winner's findings — the exact contract `fan-out.mjs` consumes — and multi-KB fallback bodies would pollute it; a dedicated write path keeps that contract clean and keeps the bytes off the aggregation seam. When the flags are **absent** (the legacy single-backend / code-review callers, and every existing test), capture is a no-op — byte-for-byte today's behaviour.

**Chosen: injectable write path (`writeFn`, defaulting to real `fs`), mirroring `getFn`/`streamFn`/`checkFn`.** CI writes nothing to disk unless a test opts in, matching the existing zero-real-IO test posture; the write function is unit-testable directly.

**Chosen: one artifact per lens × backend × round, named for provenance and greppability.** Under `<raw-dir>/`: `round-<n>.<lens>.<chainIndex>-<provider>-<model>.<classification>.txt`, where `<classification>` is the per-backend outcome token already computed in the loop (`findings` | `clean` | `malformed` | `empty` | `refusal` | `unreachable` | `auth` | `not-served` | `transport-failed` | `deadline` …). The provider/model/chainIndex are exactly the fields FAFF-361's attribution header already carries. A short metadata preamble (lens, round, provider, model, chain index, host-source, classification, exit code, truncated flag, byte length, sha256) precedes the raw body so a file is self-describing for calibration.

**Chosen: bounded — per-body byte cap with an explicit truncation marker.** A named constant (e.g. `RAW_BODY_MAX_BYTES`, default 256 KB) caps each written body; anything larger is truncated and a `…[truncated N bytes]` marker appended. This satisfies AC3 (large bodies are not written unbounded) while keeping the whole body in the common case (the 2000-token default `num_predict` is far under the cap).

**Chosen: hard-floor machine artifact.** The raw-body files are written regardless of the `logging: essential` knob (the gateway hard-floor rule for machine-consumed `.faff/` artifacts — the same floor `round-<n>.json` sits on). They are *not* narrative logs.

**Chosen: record no-body failures as a metadata-only stub.** A backend that returned no content (unreachable / auth / transport-failed / model-not-served before any bytes) still gets a stub file carrying the metadata preamble with an empty body, so the per-backend record of a round is complete and an absence is explicit rather than indistinguishable from "not yet written".

**Assumes: the AC's "alongside `fanout.round<n>.json`" is a loose reference — no such file exists.** The real round record is `round-<n>.json` (shape `{verdict, objections}`, written by the prep occupant). The raw bodies therefore live in a sibling `raw/` subdir of the same scratch dir rather than literally beside a non-existent file; the round record itself is unchanged.

**Punt: corpus retention / rotation policy across many runs.** v1 bounds each *body* (per-file cap) but does not prune the *count* of files accumulating under a long-lived interactive `.faff/spec-review/<ISSUE>/raw/`. Left to a human calibration-lifecycle decision; low-risk because files are small and bounded, run-dir copies are ephemeral, and the interactive per-issue dir is already hand-managed. Not a build blocker.

## Done — acceptance criteria

1. Given a multi-backend chain where the first backend is classified non-findings (e.g. `malformed`) and a later backend wins, **both** backends' raw bodies are written to distinct `round-<n>.<lens>.<index>-<provider>-<model>.<classification>.txt` artifacts under `--raw-dir`. Verified by a `runReviewChain` test with a stubbed `streamFn` returning a canned malformed body then a canned findings body, asserting two files with the expected classifications and byte content (`test/adversarial-call.test.mjs`).
2. A **clean / no-findings** body and a **malformed** body are each captured (not only findings-bearing ones); the classification token in the filename matches the per-backend outcome. Verified by stubbed-body cases covering clean, malformed, empty, and refusal.
3. A body larger than `RAW_BODY_MAX_BYTES` is written truncated with the truncation marker, and no artifact exceeds the cap + marker length. Verified by a stubbed oversized-body test.
4. With **no** `--raw-dir` flag, `runReviewChain` writes nothing and behaves byte-for-byte as today (the legacy single-backend and code-review paths, and all existing tests, are unaffected). Verified by the existing suite passing unchanged plus an explicit "flag absent → zero writes" assertion (injected `writeFn` never called).
5. A no-content backend failure (e.g. `unreachable`) produces a metadata-only stub artifact (empty body, classification token in the name).
6. The `spec_review` occupant (`faffter-dark-spec-review`) resolves `<scratch>/raw` via `faff spec-review-dir` and passes `--raw-dir/--lens/--round` per lens invocation, so a real spec-review round leaves raw artifacts beside `round-<n>.json`. Verified by an occupant-level test asserting the assembled `LensRequest.argv` carries the three flags, over a `mkdtempSync` scratch dir (mirroring the `spec-review-*.test.mjs` fixtures).
7. The write path uses an injectable `writeFn` so CI performs no real disk IO by default; review-call.mjs remains node-stdlib-only.
8. Existing `review-call.mjs` / `fan-out.mjs` unit + integration suites remain green.

## Reference context

- Core seam: `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` — `runReviewChain()` (:1090-1234), raw body at `originalContent` (:1208), drop points (:1214/1225/1227), `main()` flag parsing (`parseArgs` :897-928) and chain assembly (:1263-1297); `attributionHeader` (:254-259) for provenance fields.
- Fan-out: `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` — stays pure transport (anti-pattern note L195-199); no disk writes here.
- Occupant: `plugin/skills/faffter-dark-spec-review/` (SKILL.md, aggregate.mjs) — assembles `LensRequest.argv`, resolves the scratch dir, aggregates the verdict.
- Scratch resolver: `faff spec-review-dir --issue <ISSUE> [--run-dir <dir>]`.
- Tests: `test/adversarial-call.test.mjs`, `test/fan-out.test.mjs`, `test/spec-review-*.test.mjs`.
- Prior art: FAFF-320 (raw eval-judgement capture for calibration/crash-salvage — the same durable-raw pattern on the eval side), FAFF-806 (classification runs on raw `originalContent` bytes), FAFF-361 (attribution header provider/model/chain-index).
- Merge overlap: **FAFF-927** edits the same `runReviewChain` classification block — capture-before-classify keeps the two independent.

confidence: high
build-tier: mechanical
