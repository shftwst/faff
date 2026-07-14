# Spec — FAFF-445: review-call.mjs oversized-diff preflight — size-check the review payload before dispatch

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-445.

This is the buildable spec for Linear issue **FAFF-445**, addressed to the build agent and human reviewers. It adds a **preflight size guard** to the adversarial-review fallback chain (`plugin/skills/faffter-dark-adversarial-review/review-call.mjs`) so an oversized assembled payload (system + context + diff) is flagged **before** any backend is dispatched, instead of being discovered only when a provider throws a 413 mid-chain.

## 1. WHY — Problem and Principles

**The load-bearing model.** FAFF-414 made the chain **resilient to** a thrown 413/400 — it catches the throw at the chain boundary, maps it to a recorded fault class, and advances. But that is a *reaction*: the network round trip to the (likely slowest, priciest) primary backend already happened, the payload was already serialized and sent, and the fault is only discovered after the fact. FAFF-414's own OUT OF SCOPE section named the complementary *precondition* check — "proactively checking diff size before the call to avoid a 413" — as "a future ticket," with the extension point explicitly `assembleUserMessage` / the payload builders in this same file. This ticket is that future ticket: a **preflight** that inspects the assembled payload's size before the chain starts, so a payload big enough to guarantee a 413 (or a low-quality truncated review even when accepted) is flagged deterministically, at zero network cost, rather than discovered mid-chain.

**Problem statement.** Today `main()` builds `user` via `assembleUserMessage({ contextFiles, diff })` and hands it straight to `runReviewChain` with no size check at all — a diff large enough to blow a provider's request-body limit is only ever discovered via the (now-handled, but still wasteful) FAFF-414 throw path, after at least one real HTTP round trip. This change adds one size check, computed once from the exact strings about to be sent, before the chain is entered.

**Design principles:**

**Flag, never silently trim.** An oversized diff/context blob is exactly the material the reviewer needs to do its job; silently truncating it would produce a review that looks normal but examined less than the whole change — a worse failure than a visible block, because it is not visible. So the chosen action on oversize is to **flag and refuse to dispatch** (a needs-human-class terminal), never a silent trim/split. (See Decision 2.)

**Compose with FAFF-414, don't duplicate it.** This is a *precondition* guard, not a new reaction path — it never touches `runReviewChain`, `mapResultExit`, `chainTerminalExit`, `mandatoryRemap`, or any run function. A payload that passes this preflight but still 413s against some backend's own tighter internal limit is exactly the case FAFF-414 already handles; this ticket only removes the common case where the *assembled* payload is large enough that failure was never in doubt.

**One check point, not per-backend.** The assembled `system`/`user` strings are identical across every element of the fallback chain (every backend is shown the same diff and context) — so the check belongs once, before the chain loop starts, not duplicated per backend.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | The file changed. `main()` (982), `assembleUserMessage` (110), `parseArgs` (728), `EXIT` (29), `mapResultExit`/`chainTerminalExit` (786/809, unchanged, reused). |
| `test/adversarial-call.test.mjs` | node --test | Injectable-transport tests; `writeMainFixtures()` helper (603-608) for `main()`-level tests. |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | prose | Exit→verdict table (rows 179-191); exit-`2` row already broadened once for FAFF-414 — this ticket broadens it again. |
| `docs/specs/2026-07-12-FAFF-414-review-callmjs-advance-the-fallback-chain-on-a-non-transient-design.md` | markdown | FAFF-414's spec — §2 OUT OF SCOPE names this exact preflight as deferred; §6 established the "reuse an existing needs-human exit class over minting a new one" precedent this spec follows. |

**Scope.** One new pure size-check helper, one call site in `main()` before `runReviewChain` is invoked, one new optional CLI flag for the threshold override, and the accompanying SKILL.md exit-table broadening. No changes to the fallback-chain machinery, the run functions, or any exit-mapping function.

## 2. OUT OF SCOPE

- **Trimming or splitting an oversized diff/context blob to fit under the threshold** — What's excluded: automatically truncating the diff, dropping context files, or splitting the review into multiple calls to stay under the size limit. Why excluded: silent trimming removes exactly the material the reviewer needs to do its job, producing a review that looks normal but examined less than the real change — worse than a visible block (see Decision 2, Design principle "Flag, never silently trim"). Extension point: a future ticket could add a `--split` mode that reviews the diff in chunks and aggregates findings, if oversized diffs prove common enough to warrant it.
- **A configurable threshold sourced from `.faffrc`** — What's excluded: reading `faffter_dark.adversarial.max_payload_bytes` (or similar) via `faff config get` at the SKILL.md dispatch site. Why excluded: a hardcoded conservative default plus a CLI override flag (mirroring `--num-predict`/`--timeout`) is sufficient for a preflight guard of this size; adding a new config-resolution step to the SKILL.md dispatch prose is disproportionate to a bounded reliability chore. Extension point: `DEFAULT_MAX_PAYLOAD_BYTES` (this file) + the SKILL.md "Backend call" config-resolution paragraph, if operators need per-repo tuning.
- **Per-provider size limits** — What's excluded: looking up each configured provider's actual documented request-size cap and checking against the tightest one in the chain. Why excluded: providers don't uniformly publish this, and the whole point of a preflight is a fast, dependency-free check — one conservative threshold below the common range covers the practical case. Extension point: the `chain` array already carries `provider`/`host` per element in `main()`, if a future ticket wants per-backend thresholds.
- **Retrying at a reduced size after a preflight block** — excluded by definition: the preflight's whole purpose is to avoid a wasted dispatch, so falling through to a dispatch anyway (at any size) defeats it. Extension point: none — this is definitional, not deferred.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Assembled payload | The exact `system` string (the review lens) and `user` string (`assembleUserMessage`'s output: fenced context files + the diff) that `main()` is about to hand to `runReviewChain` — the same two strings every chain element's orchestration function places in its wire request. |
| Oversized-diff preflight | The size check this ticket adds: computed once from the assembled payload, before the fallback chain is entered. |
| Preflight-block class | The needs-human fault class an oversized payload is recorded as. **Chosen: reuse `EXIT.USAGE` (2)** (see Decision 2) — no dispatch is attempted; `main()` returns directly. |

**New pure helper** (exported, unit-testable, mirrors `validateFindingsShape` / `isAuthError` in style):

```
CONSTANT DEFAULT_MAX_PAYLOAD_BYTES = 5_000_000   # 5MB — see Decision 1 for the rationale

FUNCTION checkPayloadSize({ system, user, maxBytes = DEFAULT_MAX_PAYLOAD_BYTES }) -> { oversized, bytes, maxBytes }:
  # bytes = the UTF-8 byte length of system + user COMBINED — the two exact strings
  # about to be sent as the chat payload's system/user message content.
  bytes = byteLength(system) + byteLength(user)
  RETURN { oversized: bytes > maxBytes, bytes, maxBytes }
```

**New CLI flag** (`parseArgs`, 728): `--max-payload-bytes N` — optional override of `DEFAULT_MAX_PAYLOAD_BYTES`, parsed as a `Number` exactly like `--num-predict`. Absent → the default applies, byte-for-byte today's behaviour for every payload under 5MB.

**No changes** to `EXIT` (29), `runReviewChain` (878), `mapResultExit` (786), `chainTerminalExit` (809), `mandatoryRemap` (823), `assembleUserMessage` (110), or any run function.

## 4. HOW — Behavior

**Architecture.** In `main()`, immediately after `user` is assembled (`assembleUserMessage({ contextFiles, diff })`) and before the chain is built into an actual dispatch — i.e. before `runReviewChain(chain, …)` is called — call `checkPayloadSize({ system, user, maxBytes: a.maxPayloadBytes })`. When `oversized`, write a loud, greppable stderr line naming the measured size and the threshold, and return `EXIT.USAGE` (2) directly — **no chain element is attempted, no network call is made**. When not oversized, proceed exactly as today (byte-for-byte unchanged control flow into `runReviewChain`).

```
# Inside main(), after: const user = assembleUserMessage({ contextFiles, diff });
# and before: const res = await runReviewChain(chain, { system, user, ... });

sizeCheck = checkPayloadSize({ system, user, maxBytes: a.maxPayloadBytes })
IF sizeCheck.oversized:
  log(`oversized-diff preflight: assembled payload ${sizeCheck.bytes} bytes exceeds
       the ${sizeCheck.maxBytes} byte threshold — flagged before dispatch, no backend
       called (exit ${EXIT.USAGE})`)
  RETURN EXIT.USAGE
# else: fall through to the existing runReviewChain call, unchanged.
```

**Why `EXIT.USAGE` (2), not a new code.** Mirrors FAFF-414's Decision 2 exactly: `EXIT.USAGE` is already documented in both consumer SKILL.md exit tables (`faffter-dark-adversarial-review` and `faffter-dark-spec-review`) as a needs-human/config-fault class, and both already route it identically to how a new code would be routed. A new numeric class would force a new row into both tables for zero behavioural gain. The specific cause (preflight-blocked vs. a caught throw vs. an unknown provider) is preserved for a human reader via the distinct stderr log line, not via the exit integer — exactly the precedent FAFF-414 set for `"request-failed"`.

**Anti-pattern:** computing the size check *inside* `runReviewChain` or per chain element. Why: the payload is identical across every backend in the chain (same diff, same context), so checking it once before the loop is both correct and strictly cheaper; checking per-element would run the same comparison N times for no additional information and risks a partial dispatch (some backends already called) before the Nth check fires.

**Anti-pattern:** gating the check on `a.backendsJson` vs. the legacy single-backend flags. Why: both paths converge on the same `system`/`user` construction earlier in `main()` — the check must run once, after that convergence point, regardless of which flag form built the chain.

**Edge cases:**
- **A payload exactly at the threshold** (`bytes === maxBytes`): not oversized — the comparison is strict `>`, so a payload sitting exactly on the boundary dispatches normally (fail-open at the boundary, consistent with "conservative but not paranoid").
- **`--max-payload-bytes 0` or a negative override**: every non-empty payload is oversized; this is a deliberate escape hatch for tests (see AC5) — a caller who explicitly passes `0` gets what they asked for, not a validated/clamped value (a preflight guard, not input-hardening prose).
- **An empty diff / empty context** (a degenerate, pathological caller): `bytes` is small, never oversized — no special-case needed.
- **`--lights-out` / L4 mandatory review + an oversized payload**: the preflight block returns `EXIT.USAGE` (2) *before* `a.mandatory` / `ledgerMandatory` is even consulted — `mandatoryRemap` is never reached (it only remaps exits 5/8, and this path never enters `runReviewChain` to produce one). A config-fault-class exit (2) is correct here exactly as it is for FAFF-414's request-failed class: a human must fix the input (split the change, or raise the threshold), not treat it as a no-opinion outage.

**Failure modes:**
- **The failure:** the check is placed *after* `runReviewChain` is invoked (e.g. wrapping the result instead of gating entry), so a dispatch still happens before the block is reported. **How you'd know:** an injected `runReviewFn` in a test would be observed to have been called even though the payload was oversized. **What it means:** the check must gate *entry* to `runReviewChain` — move it before the call, not around it.
- **The failure:** the size computed omits `system` (checks only `user`/the diff). **How you'd know:** a test with a huge `--system` file and a tiny diff would fail to trigger the block even though the real wire payload (which includes the system message) is oversized. **What it means:** `checkPayloadSize` must sum both strings — they are both placed in the actual chat payload sent to every provider family (`buildChatPayload`/`buildOpenAiPayload`/`buildAnthropicPayload` all take `{ system, user, ... }`).

## 5. SCENARIOS — born-verifiable main objectives

```
Given an assembled payload (system + user) under the size threshold
When main() runs
Then no oversized-preflight block fires, runReviewChain is invoked exactly as before,
  and the outcome is unaffected by this change (byte-for-byte parity with pre-FAFF-445 behaviour)
```

```
Given an assembled payload (system + user) over the size threshold
When main() runs
Then main() returns EXIT.USAGE (2) BEFORE runReviewChain / any injected runReviewFn is invoked —
  zero backend calls attempted — and a loud stderr line names the measured size and the threshold
```

```
Given a chain built via --backends-json (multiple configured backends)
When the assembled payload is over the threshold
Then the block still fires once, before any chain element is attempted — the check is chain-length-agnostic
```

```
Given an oversized payload and an L4 lights-out run (--lights-out or a run-dir with level "L4")
When main() runs
Then the block returns EXIT.USAGE (2), not EXIT.MANDATORY_OUTAGE (9) — mandatoryRemap is never reached
  because the preflight returns before runReviewChain produces an exit to remap
```

Non-functional assertion: **every existing `main()` test in `test/adversarial-call.test.mjs` remains green unchanged** for payloads built from `writeMainFixtures()`'s small fixture strings (well under the 5MB default) — this change is purely additive for any payload under threshold.

## 6. Design Decision Rationale

**Where should the threshold come from — a hardcoded constant, a CLI flag, or a new `.faffrc` config key?**
- *A new `.faffrc` key (`faffter_dark.adversarial.max_payload_bytes`):* would need a `faff config get` resolution step added to the SKILL.md "Backend call" prose (mirroring how `timeout`/`deadline` are resolved) — disproportionate ceremony for a guard whose whole purpose is "catch the common case cheaply." Also splits the threshold's source of truth across a config file and this module.
- *A hardcoded constant only, no override:* simplest, but makes the oversized path untestable without generating a real multi-megabyte fixture string in every test — expensive and slow for CI.
- **Chosen: a named constant `DEFAULT_MAX_PAYLOAD_BYTES` (5,000,000 bytes / 5MB) plus an optional `--max-payload-bytes` CLI flag**, mirroring the existing `--num-predict`/`--timeout` pattern exactly (a numeric flag with a sane default, parsed the same way). The default alone covers every real repo diff without any caller needing to know the flag exists; the flag exists purely so tests can exercise the oversized path with a tiny fixture and a tiny override (`--max-payload-bytes 10`) instead of a multi-megabyte string. No new `.faffrc` key, no new config-resolution step in the SKILL.md dispatch prose — proportionate to a bounded preflight guard.
- **The 5MB value itself:** a conservative number well below the request-body limits commonly enforced by LLM API gateways (frequently in the 10MB+ range), chosen so that a payload this large already all but guarantees either an outright 413 or such a degraded/truncated review that flagging it is strictly better than attempting it. Not derived from any one provider's documented limit (see OUT OF SCOPE — per-provider limits) — a single conservative threshold is the proportionate preflight for this ticket's scope.

**What should happen to an oversized payload — trim it, split it into multiple calls, route it elsewhere, or flag and refuse?**
- *Silently trim the diff/context to fit:* rejected. The material trimmed is exactly what the reviewer needs to do its job; a review that silently examined less than the real change is a worse failure mode than a visible block, because nothing about its output signals the gap.
- *Split into multiple chained calls, aggregate findings:* a genuine alternative, but a materially larger design (multi-call aggregation, partial-failure handling across the split, a new aggregation contract) — out of proportion to "a preflight guard, not a redesign" (ticket framing). Deferred (see OUT OF SCOPE).
- *Route to a different backend/model with a larger context window:* would need a config-schema addition (per-backend context-window sizes) and a selection policy — same disproportionate-blast-radius objection as the split option.
- **Chosen: flag and refuse to dispatch — reuse `EXIT.USAGE` (2), the same needs-human-class terminal FAFF-414 established for a caught non-transient throw.** No new exit code (see the "Which fault class" sub-decision below); the specific cause is distinguished in the log line, not the exit integer. This is "the simplest safe option" the ticket's own prep guidance names: park/flag up front rather than silently altering content the reviewer needs.

**Which fault class does an oversized-preflight block map to — reuse `EXIT.USAGE` (2), or mint a new code?**
- *A new code (e.g. the still-unused `3`):* semantically the crispest option, but — exactly as FAFF-414's Decision 2 found for its own new-throw-status case — `review-call.mjs`'s exit integers are consumed by **two** SKILL.md exit tables, each asserting "every exit covered." A new code forces a new row into **both**, for a class that would route identically to how `2` already routes (needs-human / config-fault) in both consumers.
- **Chosen: reuse `EXIT.USAGE` (2).** Consistent with the established precedent (FAFF-414) of extending `USAGE`'s documented meaning rather than minting a new numeric class for a fault that needs the *same* downstream handling. The adversarial-review SKILL.md's exit-`2` row (already broadened once by FAFF-414) gets one more clause naming the oversized-preflight case; the spec-review SKILL.md's `2 → config-fault` row already reads correctly and needs no edit (mirrors FAFF-414's finding for the same row).

## 7. Open Questions and Assumptions

**Open Questions:** none. Both design decisions above are closed.

**Assumptions:**
- **Assumes:** `Buffer` is available in the ESM module without an explicit import (Node's global). *Validation:* every other size-flavoured operation in this file already relies on Node globals (`readFileSync`, `URL`) without namespacing; `Buffer` is a Node global exactly like those, used elsewhere in the codebase (e.g. `realStream`'s `Buffer.byteLength(body)` at line 551 of this same file) — no new import needed.
- **Assumes:** no repository consumer other than the two identified SKILL.md exit tables switches on `review-call.mjs`'s specific exit *integers* (the same assumption FAFF-414 validated and recorded). *Validation:* unchanged from FAFF-414's grep — `grep -rn "EXIT\.\|exit 1\|exit 2\|review-call" plugin/ docs/ | grep -i review` surfaces only the two SKILL.md tables and `aggregate.mjs` (which consumes per-lens outcomes, not raw exit codes). Re-confirm before merge.

## 8. DONE — Definition of Done

### From WHY
- [ ] An assembled payload (system + user) over the size threshold is flagged and refused **before** any chain element is dispatched — zero network calls attempted for an oversized payload.
- [ ] A payload under the threshold is unaffected — `main()`'s behaviour for any payload under 5MB (the default) is byte-for-byte unchanged from pre-FAFF-445.

### From WHAT (types and interfaces)
- [ ] `checkPayloadSize({ system, user, maxBytes })` exists, is exported, returns `{ oversized, bytes, maxBytes }`, and has direct unit tests (under threshold → `oversized:false`; over → `true`; exactly at threshold → `false`, strict `>`).
- [ ] `DEFAULT_MAX_PAYLOAD_BYTES` is exported as a named constant (5,000,000).
- [ ] `--max-payload-bytes` is a recognised `parseArgs` flag, parsed as a `Number`, defaulting to `DEFAULT_MAX_PAYLOAD_BYTES` when absent.
- [ ] `EXIT`, `runReviewChain`, `mapResultExit`, `chainTerminalExit`, `mandatoryRemap`, `assembleUserMessage`, and all three run functions are byte-for-byte unchanged.

### From HOW (behaviour)
- [ ] The size check runs in `main()` once, after `user` is assembled and before `runReviewChain` is invoked — gating entry, not wrapping the result.
- [ ] An oversized payload returns `EXIT.USAGE` (2) with a loud stderr line naming the measured size and the threshold; an injected `runReviewFn` is never called for this path (proves zero-dispatch).
- [ ] The check fires identically whether the chain was built via `--backends-json` or the legacy single-backend flags (both converge on the same `system`/`user` before the check).
- [ ] Under `--lights-out` / an L4 run-dir, an oversized payload still returns `EXIT.USAGE` (2), never `EXIT.MANDATORY_OUTAGE` (9) — the preflight block returns before `mandatoryRemap` is reached.

### From tests (AC5 — no live calls, no multi-megabyte fixtures required)
- [ ] A direct unit test of `checkPayloadSize` (under / at / over threshold).
- [ ] A `main()`-level test: a small system/diff fixture plus `--max-payload-bytes` set to a tiny override (e.g. `10`) asserts `EXIT.USAGE` and that the injected `runReviewFn` was never invoked.
- [ ] A `main()`-level test: the same small fixtures with the *default* threshold (no override) assert the pre-existing pass-through behaviour is unaffected (an injected `runReviewFn` returning `{status:"ok", content:"### observation: x"}` still yields `EXIT.OK`).
- [ ] A `--backends-json` chain variant of the oversized test, confirming the block fires before any chain element runs.

### From docs
- [ ] `faffter-dark-adversarial-review/SKILL.md` exit-`2` row broadened to also name the oversized-preflight block (mirrors the FAFF-414 broadening of the same row), keeping the "every exit the helper returns is covered by this table" statement accurate.

**Integration smoke test:**
```
1. Write a system-lens file and a diff file whose combined byte length is tiny (a few dozen bytes).
2. Invoke main() with --max-payload-bytes 1 (an override smaller than any non-empty payload).
3. Assert exit === EXIT.USAGE (2) and that the injected runReviewFn mock was never called.
4. Invoke main() again with no --max-payload-bytes override (default applies) and an injected
   runReviewFn returning findings -> assert exit === EXIT.OK, confirming normal payloads are unaffected.
```

## Already shipped against this surface

Related Done work on `review-call.mjs` / the adversarial-review chain — none supersedes this ticket's premise (no size preflight exists at HEAD); listed as reader context so the implementer builds *around*, not *over*, it:

- **FAFF-414** (Done 2026-07-12) — catches a non-transient throw (HTTP 400/413) *after* it escapes a run function, at the chain boundary, and advances the chain to a healthy fallback rather than aborting to `EXIT.OTHER`. FAFF-445 is the complementary *before* half FAFF-414's own spec named as a future ticket: a preflight that avoids the throw in the common case (payload large enough that failure was never in doubt) rather than reacting to it. Neither supersedes the other — a payload that passes this preflight but still 413s against some backend's own tighter internal limit is exactly the case FAFF-414 continues to handle.
- **FAFF-232** (Done) — the ordered fallback-chain machinery (`runReviewChain`, `mapResultExit`, `chainTerminalExit`) this ticket's preflight sits entirely upstream of, unchanged.
- **FAFF-398** (Done) — `mandatoryRemap`'s L4 fail-closed remap of a no-opinion chain exhaustion. Not reached by this ticket's block (see Edge cases) — the preflight returns before `runReviewChain` produces an exit to remap.
- **FAFF-401** (Done) — the ledger-derived mandatory-ness resolution (`ledgerMandatory`). Also not reached by the preflight block, for the same reason as FAFF-398 above.

## Methodology critique

*Agile-delivery lens — issue-critique.*

- **Right-sized?** No issues. A single, cohesive chore: one pure size-check helper, one call site gating entry to the existing chain, one CLI flag, one SKILL.md row broadening. Not splittable without fragmenting a single behaviour (the guard is only meaningful as a single before-dispatch gate); not a merge candidate with any open sibling.
- **Workstream fit?** No issues. Sits in the same adversarial-review-resilience thread as FAFF-232 → FAFF-398 → FAFF-414 → this ticket — the complementary before-half of FAFF-414's after-half, exactly as FAFF-414's own spec forecast. Outcome-named and coherent.
- **Deps surfaced?** No issues. `blockedBy` FAFF-414, which is Done — the blocker is closed and the premise (no preflight exists at HEAD) still holds; nothing gates the build.
- **Risk profile?** Low. A pure, additive, before-the-fact size check over an existing well-tested module; no new network surface, no external dependency, fully exercised by injected-transport unit tests (zero live calls, no multi-megabyte fixtures needed thanks to the `--max-payload-bytes` override). No de-risking spike warranted.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "assumes" }, { "marker": "assumes" }
  ] }
```
