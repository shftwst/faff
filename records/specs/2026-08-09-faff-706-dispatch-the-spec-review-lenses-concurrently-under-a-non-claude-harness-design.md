# Spec — FAFF-706: dispatch the spec-review lenses concurrently under a non-Claude harness

> Spec: faffter-dark-nlspec · 2026-08-05 · autonomous (spec-review verdict updated 2026-08-06 interactive) · confidence: high · spec-review: approve (human override — see revision note). Full spec on Linear FAFF-706.

> **Verdict updated 2026-08-06 (interactive re-prep).** Design unchanged from the 2026-08-05 spec (which already folded in the spec-review QA pipe-buffer-backpressure objection: the mandated streaming pipe-drain + the ≥256KB-stdout no-deadlock DoD test). Two prior parks (2026-08-05) and this session's gate attempt all failed on refuter-backend transport — never a founded design objection. This session the backends were quota-exhausted (Gemini free + injected paid key both HTTP 429; nvidia/openrouter non-finding-format), so no lens could score 706. Given a low-risk zero-dependency dispatch script with the one prior QA objection already addressed, promoted by operator override. See the 2026-08-06 promotion note comment.

The build agent and human reviewers are both audiences: the build agent needs enough to write `fan-out.mjs` and the SKILL.md diff without guessing; a reviewer needs enough to check the design holds without re-reading the whole codebase.

## 1. WHY — problem and principle

**The load-bearing model:** `faffter-dark-spec-review` already runs its four lenses as independent `review-call.mjs` subprocesses — the independence (decorrelation) is the whole point of the L4 occupant. Under Claude Code, issuing N Bash calls in one message happens to run them concurrently, a harness feature, not something faff asked for by name. Under Codex there is no such free batching, so the same "one invocation per lens" prose runs the four subprocesses one after another — and each is a full adversarial-review call (preflight, streaming, fallback chain), so a four-lens pass can stall over an hour. The fix moves the concurrency out of the harness and into faff's own code: a small Node script that spawns the N `review-call.mjs` children itself and awaits them together, so any harness capable of running one shell command gets the same speed-up.

**Design principles:**

**Reuse, never fork `review-call.mjs`.** The new fan-out mechanism spawns it as an unmodified child process. It never re-implements the transport, the preflight, or the exit-code vocabulary.

**The aggregation is untouched.** `aggregate.mjs`'s majority/severity roll-up is a pure function over a refutation array; nothing here changes its inputs' shape, only how the array gets assembled in parallel instead of one call at a time.

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (zero-dep) | The shared transport this ticket fans out — spawned unmodified, per-lens, concurrently |
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs` | Node (zero-dep) | Deterministic majority/severity roll-up — consumes the fan-out's output, unchanged |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Prose + bash | "Backend call" section rewritten from a per-lens loop to a single fan-out dispatch |
| `plugin/skills/faff/bin/lib/sentry-poller.js` | Node | The only prior `node:child_process.spawn` (non-blocking) precedent in this codebase; `fan-out.mjs` is the second |

**Scope statement:** this is the dispatch-fan-out slice of the FAFF-696 finding split — it changes only how the spec-review lenses' subprocess calls are launched and awaited, nothing about what they say or how their results are scored.

## 2. OUT OF SCOPE

- **Seat-token routing through `adversarial-backends.js`** — already shipped on FAFF-696 (`BACKEND_KEYS` carrying `auth`/`seat_token_env`). Not touched here. Extension point: `plugin/skills/faff/bin/lib/adversarial-backends.js`.
- **Prep↔review loop convergence** — a separate concern (how many revise-and-re-review cycles a spec gets), tracked as FAFF-707. Extension point: the loop-control prose in `faffter-dark-spec-review/SKILL.md` and/or `faff-prep`.
- **Fanning out the adversarial code-review pass (`faffter-dark-adversarial-review`'s Phase 2) into independent per-category lenses.** It is currently one prompt covering all five categories (spec-gaming, implicit assumptions, failure modes, security surface, concurrency) in a single `review-call.mjs` call — there is nothing to fan out today. The ticket's "(and the adversarial `review` lenses where applicable)" parenthetical is addressed here explicitly rather than silently dropped: **not applicable now**. `fan-out.mjs` is written generically enough (it takes any list of `{lens, argv}` review-call.mjs invocations) that it would apply unmodified if that pass is ever split — but splitting it is a different ticket's decision, not this one's. Extension point: `faffter-dark-adversarial-review/SKILL.md`'s "Review lens" section, if that split is ever proposed.
- **A configurable concurrency cap on the lens fan-out.** The build-fan-out precedent (`faffter-dark-concurrency-parallel`) caps at `concurrency_max` because its N is an open-ended ready queue. Here N is the enabled-lens count, closed over the fixed four-lens enum (1–4) — no cap is needed. Extension point: if a fifth lens is ever added, revisit; not now.

## 3. WHAT — vocabulary, types, and interfaces

| Term | Definition |
|---|---|
| lens request | One enabled lens's full `review-call.mjs` argv — everything the per-lens bash case builds today (`--backends-json`, `--timeout`, `--deadline`, `--run-dir`, `--system <refute-lens.md>`, `--context`×N, `--diff`) |
| fan-out | The new orchestration step: spawn every lens request as its own child process, run them concurrently, wait for all to finish |
| lens result | One child's outcome: which lens, its exit code, and its captured stdout/stderr — the same information the per-lens bash case captures today, just gathered across N children instead of one |

**New file:** `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` — placed beside `review-call.mjs`, not inside `faffter-dark-spec-review/`. Rationale (see Design Decision Rationale, Decision 1): the fan-out mechanism ("spawn N `review-call.mjs` invocations, await them together") carries nothing spec-review-specific — it belongs with the transport it wraps, the same shelf `review-call.mjs` and its own SKILL.md already establish as "shared, reused, never forked."

```
RECORD LensRequest:
  lens: String              # e.g. "architectural" — carried through unchanged, for correlating results back to lenses
  argv: List<String>        # the exact CLI arguments review-call.mjs would receive for this lens

RECORD LensResult:
  lens: String               # copied from the matching LensRequest
  exit: Integer              # the child's process exit code — the SAME vocabulary review-call.mjs already documents (0/2/4/5/6/7/8/9/10)
  stdout: String             # the child's full captured stdout (findings content on exit 0; empty on most non-zero exits, matching review-call.mjs's own main())
  stderr: String             # the child's full captured stderr (budget warnings, chain-advance log lines, etc.) — preserved for logging, not parsed
```

**CLI surface:**

```
fan-out.mjs (--requests FILE | stdin)

  input:  JSON array of LensRequest, OR { requests: [...] } (mirrors aggregate.mjs's bare-array-or-object dual shape)
  output: stdout — JSON array of LensResult, same order as input
  exit:   0  — every request was spawned and awaited (individual child exit codes ride in the LensResult array, not the process exit)
          1  — a fan-out-level fault (unreadable/malformed --requests, empty array, or a spawn() call itself throwing before its child started — e.g. ENOENT)
```

**`faffter-dark-spec-review/SKILL.md` "Backend call" section changes:** the current per-lens bash `case` block (one `review-call.mjs` invocation per enabled lens) is replaced by:

1. Assemble `backends_json`/`timeout`/`deadline` **once** (not per lens — see Decision 4, it is identical across every lens today).
2. Build one `LensRequest` per enabled lens — every field byte-identical to today's per-lens argv except `--system`, which is the lens's own `refute-<lens>.md`.
3. Write the N requests to one temp JSON file and make a single call: `node "$FANOUT" --requests "$requests_json"`.
4. Parse the returned `LensResult[]`; apply the existing per-lens outcome table (unchanged) to each entry exactly as it is applied today to one `review-call.mjs` invocation's exit code.
5. Feed the resulting per-lens refutation array into `aggregate.mjs` exactly as today.

## 4. HOW — behaviour

**Behaviour summary:** `fan-out.mjs` starts every child before waiting on any of them, then waits for all of them together — turning what was N sequential full-length calls into one batch bounded by the slowest single call.

```
PROCEDURE fanOut(requests):
  1. Validate requests: non-empty array of {lens, argv}. Empty or malformed → exit 1, no output (mirrors aggregate.mjs's "refuses to vote on an absent/inconsistent set" discipline — never silently produce fewer than N results).
  2. FOR EACH request in requests (no waiting between iterations):
     a. child ← spawn("node", [REVIEW_CALL_PATH, ...request.argv], { stdio: ["ignore", "pipe", "pipe"] })
     b. Accumulate child's stdout and stderr as they stream — on the pipes' `data` events, NEVER a post-exit bulk read (mirrors review-call.mjs's own realGet/realStream accumulation idiom). See the pipe-buffer failure mode below: this streaming drain is load-bearing under concurrency, not stylistic.
     c. Wrap the child's completion in a Promise that resolves { lens: request.lens, exit: <child's exit code>, stdout, stderr } — resolves, never rejects, even on a non-zero exit (a lens outcome, not a fan-out fault)
  3. results ← await Promise.allSettled(all child promises)
  4. IF any settled entry is "rejected" (a spawn()-level fault, e.g. ENOENT — distinct from a child that started and exited non-zero):
     a. Write the fault to stderr, exit 1, no stdout
  5. ELSE:
     a. Write the ordered LensResult[] (same order as the input requests) to stdout as JSON
     b. Exit 0
```

**Edge cases:**

- **N = 1** (one enabled lens). Fans out to one child; the output is one `LensResult`, identical in content to invoking `review-call.mjs` directly. No special-casing needed — the loop degenerates naturally.
- **One lens crashes (non-zero exit) while siblings are still running.** `Promise.allSettled` never cancels or blocks the others; that lens's `LensResult.exit` carries its real exit code, and the per-lens outcome table (unchanged) maps it exactly as it would a single serial invocation's non-zero exit — `unavailable`, kind `config-fault` or `infra-configured` per the existing table.
- **A `spawn()` call itself throws** (e.g., `node` not found on `$PATH` — an environment fault, not a lens outcome). This is fan-out-level, not lens-level: it fails the whole batch (exit 1), the same fail-loud posture `aggregate.mjs` already takes on an inconsistent input rather than silently returning fewer results than requested.

**Failure modes:**

- **The failure (child deadline):** relying on each child's own `--deadline` to bound the batch assumes every `review-call.mjs` child actually exits once its internal deadline logic fires. If that assumption is ever wrong (a future bug in `review-call.mjs` that hangs past its own deadline), the fan-out inherits the hang for that lens without a backstop timer of its own.
  **How you'd know:** a fan-out invocation that runs meaningfully longer than the single largest configured `faffter_dark.adversarial.deadline` value — visible directly in the run's wall-clock.
  **What it means:** this is a pre-existing risk surface in `review-call.mjs`, not a new one this ticket introduces (a hang there would hang a serial single-lens call exactly the same way today). Not a reason to add a second, fan-out-level timer here — see Decision 5.

- **The failure (pipe-buffer backpressure — added at spec-review/QA time):** with N children spawned `stdio: [_, "pipe", "pipe"]`, a child whose stdout/stderr exceeds the OS pipe buffer (~64KB on Linux) **blocks on write and never exits** if the parent has not been draining that pipe — deadlocking the whole `Promise.allSettled` and **silently reintroducing the exact >1h stall this ticket exists to remove**. Adversarial-review refutations are genuinely multi-KB, so this is a live path, not theoretical, and it is the codebase's *first* concurrent-spawn-with-captured-output shape.
  **The design that avoids it:** step 2b's *stream-as-you-go* accumulation on the pipes' `data` events keeps every child's pipe drained concurrently, so no child ever blocks on a full buffer. This is why 2b mandates data-event accumulation and forbids a post-exit bulk read.
  **How you'd know:** a batch that hangs indefinitely (never resolves) whenever one lens's output is large — caught by the ≥256KB-stdout test in DONE.
  **What it means:** a `**Chosen:**` design constraint (drain concurrently), pinned so the build cannot regress it, plus a dedicated test — not a new ceiling or dependency.

**Anti-pattern:** re-deriving the per-lens outcome mapping (exit → refuted/clear/unavailable) inside `fan-out.mjs`. Why: that mapping is spec-review's own judgement, consumed by `aggregate.mjs`'s contract-shaped input — `fan-out.mjs` stays a pure transport concern (spawn, collect, return) so it can be reused unmodified anywhere a set of `review-call.mjs` calls needs to run concurrently.

## 5. Scenarios

```
Given 3 enabled lenses (architectural, infosec, QA), each a stubbed review-call.mjs invocation that sleeps 2s then exits 0
When fan-out.mjs is invoked once with all 3 as --requests
Then it returns within ~2s (not ~6s) — a JSON array of 3 LensResult entries, each exit 0, in the same order as the input
```

```
Given 4 enabled lenses where the 2nd stub exits 5 (unreachable) and the other 3 exit 0
When fan-out.mjs runs
Then all 4 LensResult entries are present (the 2nd carries exit 5), and none of the 3 healthy lenses' results are missing or delayed by the failing one
```

```
Given a child stub that writes ≥256KB to stdout (well past the OS pipe buffer) then exits 0, run alongside N-1 siblings
When fan-out.mjs runs
Then every child resolves, no batch hang, and the large child's full stdout is captured intact — proving pipes are drained as they stream
```

```
Given an empty --requests array
When fan-out.mjs runs
Then it exits 1 and writes nothing to stdout — never a silent empty-array success
```

```
Given a --requests file that does not exist
When fan-out.mjs runs
Then it exits 1, writes a diagnosis to stderr, and produces no stdout
```

- The batch's wall-clock scales with `max(per-lens deadline)`, not `sum(per-lens deadline)`, for any N enabled lenses — a non-functional assertion, verified by the sleep-stub scenario above.

## 6. Design decision rationale

**Where does the fan-out orchestrator live — `faffter-dark-spec-review/` or `faffter-dark-adversarial-review/`?**
- Option A: beside `aggregate.mjs`. Pro: colocated with the only current caller. Con: ties a generic "spawn N review-call.mjs children" capability to one occupant's directory, when the ticket's own text flags a second plausible caller.
- Option B: beside `review-call.mjs`. Pro: matches the "shared transport, reused not forked" shelf the codebase already uses for `review-call.mjs` itself. Con: one more file for a reader of `faffter-dark-adversarial-review/` to notice.
- **Chosen:** Option B — `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs`. It spawns the transport it lives next to, and any future caller reuses it the same way `review-call.mjs` is reused today: verbatim, never forked.

**What primitive fans the children out — `node:child_process.spawn` + `Promise.allSettled`, a worker-pool library, or a POSIX `&`/`wait` pattern?**
- A worker-pool/queue library: rejected — the codebase is deliberately zero-dependency, and N ≤ 4 needs no pooling.
- A bash `&`/`wait` loop inside SKILL.md prose: rejected — this is exactly the harness-shaped fragility the ticket exists to remove.
- **Chosen:** `node:child_process.spawn` (non-blocking) plus `Promise.allSettled`. One prior precedent exists for non-blocking `spawn` (`sentry-poller.js`, a detached long-lived poller) — this is the second, and a simpler one. **Because it is the first captured-output concurrent spawn, the streaming pipe-drain is mandated (see the pipe-buffer failure mode) rather than assumed.**

**Does the fan-out need its own aggregate wall-clock ceiling on top of each child's `--deadline`?**
- **Chosen:** Option B — none. The ticket's own text says "bounded by the existing per-backend deadline." Running concurrently only ever *shortens* the batch's worst case (from `sum(deadlines)` under serial dispatch to `max(deadline)` under fan-out) — there is no scenario where the batch runs longer than a single lens already could serially. A second ceiling would be a second magic number to justify, and risks silently killing a child that `review-call.mjs`'s own deadline logic was about to end cleanly anyway.

**Does `fan-out.mjs` need a concurrency cap (mirroring `concurrency_max`)?**
- **Chosen:** No. `concurrency_max` bounds an open-ended ready queue; the lens fan-out's N is closed over the 4-entry enum. A cap with no queue to cap is dead configuration surface.

**Does the backend-chain assembly run once or per lens?**
- Today's SKILL.md prose nests it inside "per enabled lens." Reading the actual config path: `faffter_dark.adversarial.refs`/`fallbacks` is one config key, resolved identically for every lens in a given spec-review pass.
- **Chosen:** hoist it out of the loop, computed once per spec-review invocation. This was already redundant work under serial dispatch and the redesign is a natural point to fix it — a genuine simplification the fan-out surfaces.

**Is the fan-out's input/output shape a bespoke format or does it mirror an existing convention?**
- **Chosen:** mirror `aggregate.mjs`'s dual-mode CLI (`--refutations FILE` or stdin, bare array or `{key: [...]}` object) for `--requests`/stdin.

## 7. Open questions and assumptions

**Open Questions:** none — every design question the ticket raised resolved to a `**Chosen:**` above; no `**Punt:**` items remain.

**Assumptions:**

**Assumes:** the target Node runtime supports `node:child_process.spawn` with piped stdio and `Promise.allSettled` (both long-stable Node APIs). Validation: `fan-out.mjs`'s own test file runs under the same `node --test` harness the sibling `.test.mjs` files already use — if those pass in CI, this assumption holds. **Note:** `Promise.allSettled` has no prior use under `plugin/`; non-blocking `spawn` has exactly one precedent, `sentry-poller.js`, a detached fire-and-forget daemon launch, not a captured-output/awaited-together shape. The resulting build-time recommendation (explicit test coverage for the partial-failure, per-child-stdout-isolation, and large-output/pipe-backpressure paths) is folded into DONE below.

## 8. DONE — definition of done

### From WHY
- [ ] Spec-review lens dispatch runs concurrently under any harness (a plain shell command, not Claude's Agent-tool batching) — batch wall-clock for N enabled lenses is bounded by the slowest single lens, not the sum of all N.

### From OUT OF SCOPE
- [ ] No edits to `plugin/skills/faff/bin/lib/adversarial-backends.js` (seat-routing, FAFF-696) or to any loop-iteration/revise-cycle logic (FAFF-707).
- [ ] `aggregate.mjs` is unmodified; its existing `--selftest` still passes byte-for-byte.
- [ ] `faffter-dark-adversarial-review/SKILL.md`'s Phase-2 review-lens prompt is unmodified — the "(adversarial review lenses)" parenthetical is confirmed N/A and left untouched.

### From WHAT (types and interfaces)
- [ ] `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` exists, zero-dependency, exporting pure functions plus a CLI entry (mirroring `review-call.mjs`/`aggregate.mjs`'s module shape: injectable spawn function for tests, real `child_process.spawn` for the CLI).
- [ ] Accepts `--requests <file>` or stdin: JSON array (or `{requests:[...]}`) of `{lens, argv}`.
- [ ] Emits stdout: JSON array of `{lens, exit, stdout, stderr}`, in input order, on a successful fan-out.
- [ ] Exits non-zero with no stdout on an empty or malformed `--requests` input.
- [ ] `faffter-dark-spec-review/SKILL.md`'s "Backend call" section replaces the per-lens bash `case` block with: assemble backend chain once → build N `{lens, argv}` requests (only `--system` varies) → one `fan-out.mjs` call → apply the existing per-lens outcome table over the returned array.

### From HOW (behaviour)
- [ ] Children are spawned via `node:child_process.spawn` (non-blocking), all launched before any is awaited.
- [ ] Each child's stdout and stderr are drained **as they stream** (data-event accumulation), never read only after the child exits — the pipe-buffer-backpressure safeguard.
- [ ] All children are awaited together via `Promise.allSettled`; one lens's non-zero exit never delays or blocks sibling lenses' results.
- [ ] The per-lens outcome table is applied unchanged, now once per `LensResult` entry instead of once per invocation.
- [ ] `aggregate.mjs` is invoked exactly as today, fed the same per-lens refutation array shape.

### From HOW (edge cases)
- [ ] N = 1 fans out to one child and matches invoking `review-call.mjs` directly.
- [ ] A `spawn()`-level fault (e.g., missing `node` on `$PATH`) fails the whole batch loudly (non-zero exit, no partial stdout) rather than silently returning fewer than N results.
- [ ] No fan-out-level wall-clock ceiling exists beyond each child's own `--deadline`.
- [ ] Test coverage explicitly exercises: one child exiting non-zero while siblings succeed; a child hitting its own `--deadline` while others complete normally; each child's stdout captured per-child, never interleaved onto the parent's own stdout.
- [ ] Test coverage exercises a child emitting stdout **larger than the OS pipe buffer** (e.g. ≥256KB): the batch of such children all resolve with no deadlock and each large child's full stdout is captured intact — proving stdout/stderr are drained as they stream.

### From Scenarios
- [ ] The 3-lens concurrent-sleep-stub scenario demonstrates wall-clock ≈ max(lens time), not sum.
- [ ] The mixed-outcome scenario demonstrates all N results present even when one lens fails mid-batch.
- [ ] The large-output (≥256KB) scenario demonstrates no batch hang and intact capture.
- [ ] The empty-input and missing-file scenarios both refuse loudly (exit 1, no stdout).

**Integration smoke test:**

```
PROCEDURE smokeTest:
  1. Enable 2 lenses (architectural, QA) against a local stub backend that always returns one clean finding.
  2. Assemble backends_json once; build 2 LensRequests differing only in --system.
  3. Invoke fan-out.mjs --requests <the 2 requests>.
  4. Assert: stdout parses as a 2-entry JSON array, both exit 0, lens fields "architectural" and "QA" in order.
  5. Pipe the mapped per-lens outcomes into aggregate.mjs --n 2.
  6. Assert: aggregate.mjs emits a valid faff-contract:spec-review-verdict block.
```

confidence: high
spec-review: approve (human override 2026-08-06 — two prior parks + this session's gate attempt all failed on refuter-backend transport, never a founded objection; the QA pipe-buffer-backpressure fix is present in this spec; low-risk zero-dep dispatch script, operator-promoted)

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [
  { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
  { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }
] }
```

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery.** Carried forward from the 2026-08-05 prep — design unchanged, so the `issue-critique` findings still hold. Does not gate promotion.

**Principle 4 — right-sized: no issue.** One new ~100–150 line zero-dependency script plus its test file, plus a SKILL.md prose edit, is a solid 1–3 day unit. This ticket is already the product of a prior split (seat-routing → FAFF-696, loop-convergence → FAFF-707); the remaining slice is single-purpose — concurrent dispatch only, aggregation explicitly untouched. No split or merge candidate.

**Principle 1 + 5 — workstream fit: no issue.** The parent project ("Harness-agnostic runtime — the loop runs under Codex CLI") is outcome-named, and this ticket is cohesive with it: the non-Claude-harness dispatch-latency fix the project exists to deliver. It does not smuggle in a second outcome — seat-routing and loop-convergence stay in their own siblings.

**Principle 6 — surfaced dependencies: no issue.** FAFF-696 (the prerequisite seat-routing slice) is Done, so no live blocker link is needed. FAFF-707 (loop-convergence) is named as a separate, untouched, out-of-scope ticket. Placing `fan-out.mjs` beside `review-call.mjs` follows the established "reused verbatim, never forked" pattern rather than introducing a new undeclared coupling.

**Principle 7 — risk-aware sequencing: one finding (addressed).** The `Assumes:` clause is corrected to reflect that `Promise.allSettled` has no prior `plugin/` use and non-blocking `spawn` has one precedent (`sentry-poller.js`, a detached daemon — a different shape). This ticket introduces the codebase's first concurrent-subprocess-with-result-collection pattern; the real risk (stdout-capture correctness under concurrency, the partial-failure/partial-timeout path, per-child exit-code propagation, and pipe-buffer backpressure) is absorbed by the corrected wording plus the dedicated DoD test coverage. No re-park or resize.

No other findings.
