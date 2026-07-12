# Spec — FAFF-414: advance the fallback chain on a non-transient throw (HTTP 400/413), not abort to EXIT.OTHER

> Spec: faffter-dark-nlspec · 2026-07-10 · autonomous · confidence: high. Full spec on Linear FAFF-414.

This is the buildable spec for Linear issue **FAFF-414**, addressed to the build agent and human reviewers. It hardens the adversarial-review fallback chain (`plugin/skills/faffter-dark-adversarial-review/review-call.mjs`) so a backend that *throws* a non-transient request fault (HTTP 400/413) is recorded and the chain advances — reaching the same needs-human terminal FAFF-232 already established for status-returning faults — instead of escaping to `EXIT.OTHER` (1) and killing the whole chain.

## 1. WHY — Problem and Principles

**The load-bearing model.** FAFF-232 made the Phase-2 chain resilient by making every backend fault come back as a *status string* (`unreachable` / `auth-failed` / `model-not-served` / `transport-failed`), which `mapResultExit` turns into a numeric fault class, `runReviewChain` records on `failureClasses`, and the loop advances on. Resilience is therefore **exactly co-extensive with "the fault came back as a status."** A fault that comes back as a *thrown exception* is outside that machinery — it unwinds straight past the loop. So the fix is not new policy; it is **closing the one path (a throw) that bypasses the status-based machinery already in place**: catch the throw at the chain boundary, convert it to a status, and let the untouched FAFF-232 machinery do the rest.

**Problem statement.** Today `runReviewChain` builds `callReview = () => runReviewFn({…})` and awaits it (directly, or raced against the deadline timer) with **no try/catch**, and `main` doesn't wrap `runReviewChain` either — so a non-transient, non-auth, non-404 error (a 413 on an oversized diff; a 400 the payload guards don't cover) thrown by any of the three transport families' orchestration functions escapes to the top-level IIFE catch and exits `1` (`OTHER`), aborting the chain before any healthy fallback is tried. This change catches that throw, maps it to a recorded fault class, and advances the chain — a terminal exit is reached only when every backend has failed.

**Design principles:**

**No silent weakening (inherited invariant).** A non-transient throw is a request/config fault, not an availability blip — so its fault class must be **needs-human-dominant** (a member of `CHAIN_NEEDS_HUMAN`), so a lone or fully-failed throw-only chain surfaces needs-human and never degrades to a silent `pass+skip` (5) or pass (0). The direction is fail-safe: this change only ever routes a throw *toward* needs-human, never away from it.

**Minimal blast radius across two consumers.** `review-call.mjs`'s exit integers are consumed by **two** SKILL.md exit tables (`faffter-dark-adversarial-review` and `faffter-dark-spec-review`), each asserting "every exit the helper returns is covered." The mapping choice must not force a new row into both tables for zero behavioural gain — reuse an exit class both consumers already route to needs-human.

**Don't perturb the transient-retry seam.** By the time a throw *escapes* a run function, it has already passed through `streamWithTransportRetry` (FAFF-227) and is terminal by construction (`isTransientTransport` is false for it). The new catch must sit *outside* that seam so it never intercepts a fault that should have been retried.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | The file changed. `runReviewChain` (586), `mapResultExit` (537), `isAuthError` (246), the run fns (369/423/470). |
| `test/adversarial-call.test.mjs` | node --test | Injectable-transport tests; `scriptedRunReview(byHost)` helper; the existing run-fn-level throw test at 568-579. |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | prose | Exit→verdict table (rows 170-181); row `2` already → needs-human; line 179 asserts only `1` is unmapped. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | prose | **Second consumer.** Per-lens table (line 76) already maps `6/2/4/7 → config-fault (needs-human)`. |

**Scope.** One catch point at the chain boundary plus a two-line mapping addition; the FAFF-232 recording/advancing/terminal-precedence machinery and all three run functions are unchanged.

## 2. OUT OF SCOPE

- **An oversized-diff preflight / size guard** — What's excluded: proactively checking diff size before the call to avoid a 413. Why excluded: FAFF-414 hardens the *reaction* to a thrown fault, not prevention; a preflight is a separate design with its own tradeoffs. Extension point: `buildAnthropicPayload` / `assembleUserMessage` in `review-call.mjs`, a future ticket.
- **Changing the run functions' own catch logic** — What's excluded: making `runReviewOpenAi` / `runReviewAnthropic` / `runReviewOllama` convert 400/413 to a status internally. Why excluded: one uniform catch at the chain covers all three families (incl. ollama, which has no catch at all) with less surface, and keeps the existing run-fn-level throw test (568-579) green. Extension point: the run functions' catch blocks (423-453, 470-497), if a family ever needs bespoke throw classification.
- **A new distinct exit code for request faults** — What's excluded: minting `EXIT.REQUEST_FAULT` (3). Why excluded: see Design Decision 2 — two consumer exit-tables would each need a new row for zero behavioural gain. Extension point: `EXIT` (24) + both SKILL.md tables, if request faults ever need handling that *diverges* from `USAGE`.
- **Retrying a non-transient throw** — excluded by definition; a 400/413 is terminal (the request itself is wrong), so retrying would loop on a guaranteed failure. Extension point: `isTransientTransport` (260) — deliberately false for non-429 4xx.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Non-transient throw | An exception escaping a run function that `isTransientTransport` classifies false — i.e. already past FAFF-227 retry, terminal. In practice a non-auth, non-404 4xx (400/413) from any family, or ollama's fully-unguarded propagation. |
| Chain boundary | The point in `runReviewChain` where `callReview()` is invoked (both the direct-await site and the deadline `Promise.race` site). |
| Request-fault class | The needs-human fault class a non-transient throw is recorded as. **Chosen: reuse `EXIT.USAGE` (2)** (see Decision 2). |

**New pure helper** (exported, unit-testable, mirrors `isAuthError` / `isTransientTransport`):

```
FUNCTION mapThrowStatus(err) -> status-string:
  # Classify a throw that escaped a run function into a runReview()-shaped status.
  # Fail-safe: auth is preserved universally (incl. ollama's unguarded path); everything
  # else is a terminal request fault. No 404 branch — anthropic converts its own 404 to
  # model-not-served BEFORE throwing, so a 404 never reaches here from anthropic; a stray
  # 404 from another family is a genuine request fault → the same needs-human class.
  IF isAuthError(err): RETURN "auth-failed"
  RETURN "request-failed"
```

**`mapResultExit` gains one case** (537):

```
case "request-failed": return EXIT.USAGE   # needs-human-dominant; both consumer tables already route 2
```

`"auth-failed" → EXIT.AUTH` already exists (542); the `default → EXIT.OTHER` (545) stays, but becomes unreachable from the chain's synthesised results (they always carry a known status) — preserving `OTHER` for genuine programmer error exactly as documented.

**No changes** to `EXIT` (24), `CHAIN_NEEDS_HUMAN` (556), `chainTerminalExit` (557), `mandatoryRemap` (571), or any run function.

## 4. HOW — Behavior

**Architecture.** Wrap `callReview()` at the chain boundary in a small adapter that never rejects: on a throw it returns a synthesised `runReview`-shaped result `{ status: mapThrowStatus(e), note: e.message }`. That synthesised result then flows through the **existing, unchanged** path — `mapResultExit` (657) → the failure log (663-664, which already reads `result.status` / `result.note`) → `failureClasses.push` → `chainTerminalExit` → `mandatoryRemap`. The catch converts a control-flow escape into an ordinary recorded fault; everything downstream handles it by construction.

**Behavior summary.** A throwing backend now looks, to the rest of the chain, exactly like a backend that returned `{ status: "request-failed" }`: recorded, logged, advanced past.

```
# Inside runReviewChain, replacing the two bare callReview() invocations.
PROCEDURE safeCall():
  1. TRY: RETURN await callReview()
  2. CATCH e: RETURN { status: mapThrowStatus(e), note: String(e.message) }

# Site A — direct-await branch (no deadline):
result = await safeCall()

# Site B — deadline branch: race the SAME non-rejecting safeCall against the timer.
result = await Promise.race([ safeCall(), deadlineP ])
# safeCall never rejects, so an abandoned in-flight backend that later throws resolves
# to a discarded synthetic result — it can no longer surface as an unhandled rejection
# (a latent risk on today's raced callReview()). SENTINEL handling is unchanged.
```

**Anti-pattern:** wrapping only the direct-await site and leaving the `Promise.race` site (deadline branch) calling the bare `callReview()`. Why: a throw on the deadline path would still escape to `EXIT.OTHER`, so the fix would silently not apply whenever a total `--deadline` is configured. Both call sites must route through the same non-rejecting adapter.

**Anti-pattern:** catching inside `streamWithTransportRetry` or the run functions. Why: that seam owns transient-vs-terminal classification; a catch there risks swallowing a fault that should retry. The catch belongs strictly *outside* the run function, at the chain boundary.

**Edge cases:**
- **Auth throw on ollama's unguarded path** (near-unreachable — ollama is keyless): `mapThrowStatus` returns `"auth-failed"` → `EXIT.AUTH`, preserving auth classification universally. AC "keep auth unchanged" holds by construction.
- **anthropic 404 / auth**: already converted to status *before* throwing (470-497), so they never reach `safeCall`; classification unchanged. AC "keep anthropic 404 unchanged" holds because the run fns are untouched.
- **Throw + later `unreachable`**: `failureClasses = [USAGE, UNREACHABLE]` (or the reverse order) → `chainTerminalExit` returns `USAGE` (2) either way — the request fault dominates availability (no-silent-weakening).
- **Healthy fallback after a throwing primary**: the fallback returns `ok` and the chain returns its findings (exit 0) before any terminal is computed.
- **`--lights-out` (L4) + lone throw**: terminal `USAGE` (2); `mandatoryRemap(2, mandatory)` passes config-fault classes through unchanged (only 5/8 remap to 9), so it stays needs-human — correct: a request fault is a config fault a human must fix, not a no-opinion outage that fails closed.

**Failure modes:**
- **The failure:** the catch is too broad and swallows a transient fault that FAFF-227 should have retried, masking a recoverable blip as a terminal request fault. **How you'd know:** the FAFF-227/228 retry regression tests (`runReview ollama/openai: transient … retries once then succeeds`) would flip to failing, or a 5xx/429 would surface as `request-failed`. **What it means:** the catch is mis-placed inside the run fn / retry seam — it must sit at the chain boundary, outside `streamWithTransportRetry`, so it only ever sees already-terminal throws. Proceed only with the catch at the boundary.
- **The failure:** only one of the two call sites is wrapped, so the fix is a no-op under `--deadline`. **How you'd know:** a chain-level throw test with a configured deadline still exits `OTHER`. **What it means:** wrap both sites (Site A and Site B above).

## 5. SCENARIOS — born-verifiable main objectives

```
Given a two-backend chain whose primary's orchestration throws HTTP 413 (oversized diff)
  and whose fallback is healthy
When runReviewChain runs
Then the chain records the primary's fault, advances, and returns the fallback's findings at exit 0
```

```
Given a chain (of any length >= 1) whose only faults are non-transient throws
When the chain is exhausted
Then chainTerminalExit returns EXIT.USAGE (2) — a needs-human-class terminal, never pass+skip (5) or OK
```

```
Given a single-backend chain whose sole backend throws HTTP 400
When main() resolves
Then it returns EXIT.USAGE (2) — a defined needs-human terminal — not EXIT.OTHER (1)
  (the single-backend path still terminates at needs-human; see Decision 3)
```

```
Given a chain recording both a non-transient throw (-> USAGE) and an unreachable (-> 5), in either order
When the chain is exhausted
Then the terminal exit is USAGE (2): the request fault dominates the availability class
```

Non-functional assertion: **the existing run-fn-level throw test (`test/adversarial-call.test.mjs` 568-579) — `runReviewOpenAi` rejects on HTTP 400 — remains green unchanged**, because the run functions are untouched and the new catch lives only in the chain wrapper.

## 6. Design Decision Rationale

**Where to catch the non-transient throw — inside each run function, or at the chain boundary?**
- *Inside each run fn:* maps to a bespoke status per family, but requires touching three functions (and adding a catch to `runReviewOllama`, which has none), duplicating classification, and it would break the run-fn-level throw test (568-579) that asserts the openai run fn still rejects on a 400.
- *At the chain boundary (`safeCall` around both `callReview()` sites):* one catch covers all three families uniformly (including ollama's unguarded path), reuses `mapResultExit` and the existing failure-logging line, leaves all run fns and their tests untouched, and removes a latent unhandled-rejection on the raced-deadline path.
- **Chosen: catch at the chain boundary.** Fewer touch points, uniform coverage, no test churn, strictly-additive.

**Which fault class does a non-transient throw map to — reuse `EXIT.USAGE` (2), or mint a new `EXIT.REQUEST_FAULT` (3)?**
- *New code (3):* semantically crisp and fills the documented "no exit 3" gap — but `review-call.mjs`'s exit integers are consumed by **two** SKILL.md exit tables (`faffter-dark-adversarial-review` rows 170-181 *and* `faffter-dark-spec-review` line 76), each asserting "every exit covered." A new code forces a new row into **both** tables, for **zero behavioural gain** — both consumers would route 3 to needs-human identically to how they already route 2. This diverges from the precedent that justified codes 6/8/9, each of which needed *divergent downstream handling* (5-vs-6, 8 pass+skip, 9 fail-closed); a request fault needs the *same* handling as `USAGE`.
- *Reuse `EXIT.USAGE` (2):* both consumer tables already route 2 -> needs-human/config-fault, so **no new table row in either consumer**; `USAGE ∈ CHAIN_NEEDS_HUMAN` so it is already needs-human-dominant and routes through `chainTerminalExit` / `mandatoryRemap` correctly. Observability of the *specific* trigger (413 vs unknown-provider) is preserved by the distinct `status: "request-failed"` and the error `note` carried into the existing per-backend failure log line, without a new numeric class.
- **Chosen: reuse `EXIT.USAGE` (2).** Behaviourally identical to a new code everywhere, at a fraction of the blast radius (proportionate-minimal tenet). The one accuracy edit: broaden the adversarial-review SKILL.md exit-`2` row description to name "a non-transient request fault (HTTP 400/413) from a backend's orchestration" so the "every exit covered" statement stays precise; the spec-review `2 -> config-fault` row already reads correctly and needs no edit.

**AC4 — "the single-backend path's terminal exit is unchanged for a lone throwing backend." Literal exit 1, or semantic needs-human?**
- Today a lone throw exits `1` (`OTHER`). Crucially, **exit 1 is *not a mapped verdict* in either consumer's exit table** — `OTHER` is documented (SKILL.md line 179) as "reserved for genuine programmer error," explicitly *not* a covered transport/infra outcome. So for a 413 today, exit 1 is a fall-through, not a defined terminal. The entire point of FAFF-414 is that a 413 is *not* programmer error.
- **Chosen: interpretation (a) — "unchanged" means the single-backend path still terminates at a needs-human class, never degrading to pass+skip (5) or OK (0); the numeric label moves 1 -> 2.** Preserving literal exit 1 (interpretation b) is rejected: it would perpetuate the exact mislabelling the ticket exists to fix *and* contradict AC3 (a fully-failed chain — of which a 1-element throwing chain is the degenerate case — must surface a needs-human-class terminal, which `OTHER`/1 is not). The move 1 -> 2 is strictly an improvement: it takes a previously *unmapped* fall-through and gives it a *defined, table-covered* needs-human terminal. The AC author's guard is against a *regression toward pass-like* on the single-backend path, which this preserves.

## 7. Open Questions and Assumptions

**Open Questions:** none. All three design decisions are closed above.

**Assumptions:**
- **Assumes:** no repository consumer other than the two identified SKILL.md exit tables switches on `review-call.mjs`'s specific exit *integers*. *Validation:* `grep -rn "EXIT\.\|exit 1\|exit 2\|review-call" plugin/ docs/ | grep -i review` — confirmed during exploration to surface only the two SKILL.md tables (both already route `2` -> needs-human) and `aggregate.mjs`, which consumes per-lens *outcomes*, not raw exit codes. Re-confirm before merge.

## 8. DONE — Definition of Done

### From WHY
- [x] A non-transient throw (HTTP 400/413) from any family's orchestration is caught at the chain boundary, recorded on `failureClasses`, and the chain advances — no throw escapes `runReviewChain` / `main` to `EXIT.OTHER` (1).

### From WHAT (types and interfaces)
- [x] `mapThrowStatus(err)` exists, is exported, returns `"auth-failed"` when `isAuthError(err)` else `"request-failed"`, and has a direct unit test.
- [x] `mapResultExit` maps `"request-failed" -> EXIT.USAGE` (unit test), with `"auth-failed" -> EXIT.AUTH` unchanged.
- [x] `EXIT`, `CHAIN_NEEDS_HUMAN`, `chainTerminalExit`, `mandatoryRemap`, and all three run functions are byte-for-byte unchanged.

### From HOW (behaviour)
- [x] Both `callReview()` invocation sites in `runReviewChain` (direct-await and the deadline `Promise.race`) route through a non-rejecting `safeCall`.
- [x] A throwing primary with a healthy fallback returns the fallback's findings at exit 0 (AC2).
- [x] A fully-failed throw-only chain (incl. the 1-element case) surfaces `EXIT.USAGE` (2), a needs-human-class terminal, not pass+skip (AC3, AC4).
- [x] A throw recorded alongside an `unreachable` yields terminal `USAGE` (2) regardless of order — request fault dominates availability.
- [x] Under `--lights-out`, a lone throw stays `USAGE` (2) (config-fault passes `mandatoryRemap` through, not remapped to 9).

### From HOW (edge cases / auth-preservation)
- [x] Auth (401/403) and anthropic's 404->not-served classifications are unchanged (verified: run fns untouched; a stray auth throw still maps to `auth-failed` via `mapThrowStatus`).
- [x] The existing run-fn-level throw test (`test/adversarial-call.test.mjs` 568-579) remains green unchanged.
- [x] FAFF-227/228 transient-retry regression tests remain green (the catch does not intercept transient faults).

### From tests (AC5 — injected transport, zero live calls)
- [x] For **each** family (ollama / openai / anthropic): a `runReviewChain` test using the **real** `runReview` with an injected `streamFn` that throws HTTP 400/413 for the primary host and returns findings for the fallback host, asserting advance -> exit 0 (proves each real run fn's throw reaches and is caught by the boundary).
- [x] A terminal-exit precedence test (throw-only chain -> `USAGE`; throw + unreachable -> `USAGE`).

### From docs
- [x] `faffter-dark-adversarial-review/SKILL.md` exit-`2` row description broadened to include a non-transient request fault (HTTP 400/413), keeping the "every exit the helper returns is covered by this table" statement (line 179) accurate; the `OTHER`/1 sentence still holds (no transport/request condition exits 1).

**Integration smoke test:**
```
1. Build a 2-element chain via --backends-json: [ throwing-primary(413), healthy-fallback ].
2. Inject streamFn: throw "HTTP 413" for the primary host; return SSE findings for the fallback host.
3. Run main() -> assert exit 0 and the fallback's findings on stdout.
4. Swap the fallback to also throw -> assert exit 2 (EXIT.USAGE), never 1 (OTHER).
```

## Already shipped against this surface

Related Done work on `review-call.mjs` / the adversarial-review chain — none supersedes this ticket's premise (the non-transient-*throw* escape path is uncovered at HEAD); listed as reader context so the implementer builds *around*, not *over*, it:

- **FAFF-232** (Done 2026-06-26) — established the fallback chain for *status-returning* faults (`unreachable` / `auth-failed` / `model-not-served` / `transport-failed`). FAFF-414 explicitly **refines** it: it closes the one remaining fault path (a thrown exception) that bypasses that same machinery. The FAFF-232 recording/advancing/precedence code is reused unchanged.
- **FAFF-398** (Done 2026-07-07) — `mandatoryRemap`: a *mandatory* (lights-out) chain whose `failureClasses` are exhausted -> needs-human (9), never pass+skip. Composes downstream of this change; a `USAGE` (2) request fault passes `mandatoryRemap` through unchanged (only 5/8 remap to 9). Not superseding — it acts only once a throw is *already* recorded on `failureClasses`, which is exactly the gap FAFF-414 fills.
- **FAFF-227 / FAFF-228** (Done) — transient-transport retry (5xx / dropped connection) and the 429->documented-exit mapping. Orthogonal: they own the *transient* seam a non-transient throw has, by construction, already passed through. The new catch sits strictly outside that seam.
- **FAFF-209 / FAFF-210** (Done) — the openai-compatible and native anthropic/gemini transports. FAFF-210 is the peer whose adversarial review *surfaced* this finding (413, no anthropic preflight). No overlap in changed code.

## Methodology critique

*Agile-delivery lens — issue-critique.*

- **Right-sized?** No issues. A single, cohesive 1-day hardening unit: one catch point at the chain boundary plus a two-line `mapResultExit` addition and its tests. One concern (advance-on-non-transient-throw), not splittable without fragmenting a single behaviour; not a merge candidate with any open sibling.
- **Workstream fit?** No issues. Sits squarely in the adversarial-review-resilience thread (FAFF-232 -> FAFF-398 -> this), the L4 second-opinion-gate integrity workstream. Outcome-named and coherent.
- **Deps surfaced?** No issues. Related-to FAFF-232 and FAFF-210 (both Done) — no open blocker, no implicit dependency without a link. Nothing gates the build.
- **Risk profile?** Low. Pure internal control-flow refactor over an existing, well-tested module; no external dependency, no novel integration, fully exercised by injected-transport unit tests (zero live calls). No de-risking spike warranted.

confidence: high
spec-review: approve
