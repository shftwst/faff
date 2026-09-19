# FAFF-1058 — Controllable adversarial-review trimming: prose never trims, code_review trim is toggleable

> Spec: faffter-dark-nlspec · 2026-09-19 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1058.

_Rev 2 (2026-09-19): applied round-1 spec-review fixes — dropped the global `adversarial.trim` fallback, added a captured baseline-payload oracle, an over-window scenario, the D3 test-file follow-through, the prose no-reduction invariant, and a non-boolean fail-safe scenario._

_Rev 3 (2026-09-19): applied round-2 spec-review fixes — resolved the D3-vs-D1 contradiction (the `prose` branch of `trimContextFiles` STAYS as the `prose-passthrough` identity; D3 removes only the head-fit/ceiling machinery); pinned "assembled payload" to the `{ system, user }` wire strings; split the over-window scenario into fallback-serves vs all-over-window (exit 2 = needs-human, the concrete meaning of "fails closed"); documented that `--no-trim` does not bypass the FAFF-445 5 MB preflight; and scoped the `--no-trim` flag reachability. Round 2 returned reject-approach (churn:true, not converging); promoted by operator override of the spec-review gate, not an `approve`._

This spec addresses Linear issue FAFF-1058 (make adversarial-review trimming controllable: the `prose` diff kind never trims, and code-review trimming becomes a per-consumer operator toggle). It is written for the build agent that will implement the change and for the human reviewers gating it. It targets the codebase after FAFF-1051 (the `--diff-kind unified|prose` mechanism, merged to main as commit `12ed94f8`), which is assumed present in the working branch.

## 1. WHY — problem and principles

The mechanism this spec turns on: adversarial review trims context in two independent passes, and both must agree to leave a payload alone before it can be called untrimmed.

```
review-call.mjs main() trims context in TWO passes:

  pass 1  trimContextFiles(...)      byte-gated / prose-ceiling reduction   (FAFF-915 + FAFF-1051)
  pass 2  tightenToTarget(...)       window-targeted reduction              (FAFF-1039)

  A payload is "not trimmed" only when BOTH passes are no-ops.
  Turning off one while the other still fires still elides the payload.
```

Problem statement. FAFF-1051 routed spec-review and spec-judge through `--diff-kind prose` so pass 1 stops treating a spec as a diff, but the prose kind still head-retains once the whole prompt passes a 576 KB ceiling (`DEFAULT_PROSE_CEILING_BYTES = 589824`), and pass 2 still head-reduces a `prose` payload to fit the primary backend's window. Code review (`unified`) always trims with no operator opt-out. This spec makes `prose` a genuine pass-through in both passes at any size, and adds a per-consumer toggle `adversarial.code_review.trim` that switches both passes off for the code-review call.

Design principles.

**A spec is not choppable.** A unified diff carries anchors that let the trim keep diff-touched lines and elide the rest. A spec plus the files it names has no such anchors, so any reduction is head truncation. The prose path must therefore never reduce, not reduce less often. A partial spec review is worse than an honest over-window skip.

**Off means both passes off.** The operator-facing switch is meaningless unless it reaches pass 2 as well. `--context-trim-bytes 0` today disables only pass 1; pass 2 overrides it by design (review-call.mjs arg comment near line 1593). Any disable path this spec adds must be honoured by both passes or it is a false promise.

**The honest outcome is a skip, not a silent trim.** With trimming off, a payload can exceed the primary backend's window. The existing per-backend guard (FAFF-1039, review-call.mjs lines 1964-1977) then skips that backend to a wider-window fallback, or fails closed when none exists. That visible skip is the intended result, chosen over a silently truncated spec or diff.

Reference context.

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | Holds both trim passes, arg parsing, and main() flow; all behaviour changes land here |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | skill prose | Phase 2 code-review dispatch; reads the new config toggle and translates it to a flag |
| `plugin/skills/faff/bin/lib/adversarial-backends.js` | Node | Per-consumer sub-block resolution (`spec_review`/`code_review`/…); `BACKEND_KEYS` allowlist |
| `plugin/skills/faffter-dark-spec-review/build-lens-requests.mjs` | Node ESM | Spec-review lenses; already pass `--diff-kind prose`; benefit with no edit |
| `plugin/skills/faff-prep/SKILL.md` (spec-judge Call 1 / Call 2) | skill prose | Already pass `--diff-kind prose`; benefit with no edit |
| `test/faff-1051-diff-kind.test.mjs`, `test/fixtures/trim-baseline/` | Node test | Test pattern and goldens to extend |

Scope statement. This change sits at the context-assembly stage of the adversarial-review call path, between reading the `--context` files and dispatching the backend chain.

## 2. OUT OF SCOPE

- **A global `adversarial.trim` toggle** — excluded. The ticket settled a per-consumer toggle scoped to code review; a global switch would also silence spec-review, which is exactly the pass-through this spec makes unconditional. The dispatch (Decision D2) reads **only** the per-consumer `adversarial.code_review.trim` and **never** a global `adversarial.trim` key, so setting a global key has no effect: the exclusion holds by construction, not by convention. Extension point: `assembleAdversarialBackends`/the SKILL.md dispatch already resolve per-consumer scalars, so a second consumer's toggle is a one-line read there.
- **Making `prose` trimming re-enableable** — excluded. Pass-through is unconditional by design; there is no operator need to re-enable spec truncation. Extension point: none intended; a future need would reintroduce a bounded prose budget in `trimContextFiles`.
- **Changing the per-backend window guard or fallback ordering** — excluded. The FAFF-1039 guard (review-call.mjs lines 1964-1977) already produces the honest skip-or-fail-closed outcome untouched. Extension point: `runReviewChain`.
- **A toggle for spec-judge or prdr_review trimming** — excluded. Spec-judge is `prose` (never trims after this change); prdr_review is out of this ticket. Extension point: the same per-consumer scalar read added for `code_review`.

## 3. WHAT — vocabulary, types, interfaces

Vocabulary.

| Term | Definition |
|---|---|
| pass 1 | `trimContextFiles(...)` — the byte-gated (unified) or ceiling-gated (prose) context reduction |
| pass 2 | `tightenToTarget(...)` invoked in the FAFF-1039 block of main() — the window-targeted reduction |
| pass-through | both passes return their input context unchanged (zero elision) |
| consumer | a named per-consumer config sub-block under `adversarial.<name>` (`code_review`, `spec_review`, …) |

Config surface.

```
adversarial.code_review.trim : Boolean          # per-consumer scalar; default true when unset
  true  | unset  -> today's code-review trimming (FAFF-915 pass 1 + FAFF-1039 pass 2), byte-for-byte
  false          -> code-review dispatch passes --no-trim; both passes become no-ops
```

Placement decision.

**Config-key placement.** Options: (a) add `trim` to `BACKEND_KEYS` in `adversarial-backends.js`; (b) treat `trim` as a per-consumer scalar sibling of `timeout`/`max_tokens`, read at the dispatch site. `BACKEND_KEYS` is the allowlist for fields inside a single backend `refs:` object (per-backend), whereas `trim` governs the whole code-review call regardless of which backend serves it. Reading it as a consumer scalar matches the existing `adversarial.<consumer>.timeout`/`.max_tokens` pattern (SKILL.md lines 197-206) and needs no allowlist change (`adversarial-config-lint.test.mjs` guards only backend resolution, not scalar keys).

**Chosen:** `trim` is a per-consumer scalar read at the dispatch site, not a `BACKEND_KEYS` field. It is written via `faff config set adversarial.code_review.trim false` and read via `faff config get`, exactly as `timeout` is.

CLI surface (review-call.mjs).

```
--no-trim        # NEW: boolean switch; disables BOTH passes. Absent => today's behaviour.
--diff-kind      # EXISTING (FAFF-1051): unified | prose. prose is now unconditional pass-through.
--context-trim-bytes N   # EXISTING (FAFF-915): pass-1 byte gate; 0 disables pass 1 only (unchanged)
```

## 4. HOW — behaviour

Architecture. Two edits in `review-call.mjs` (the two passes) plus one read in the code-review dispatch (SKILL.md). The `prose` fix is caller-independent, so `build-lens-requests.mjs` and faff-prep's spec-judge calls inherit it with no edit. The toggle only affects `unified` callers, which today is the code-review dispatch.

### Decision D1 — prose no-trim mechanism

Options considered.

| Option | Handles pass 1? | Handles pass 2? | Verdict |
|---|---|---|---|
| Drop the 576 KB ceiling entirely | yes | no (pass 2 targets the window, not the ceiling) | insufficient alone |
| Unbounded ceiling sentinel (`Infinity`) | yes | no (same reason) | insufficient alone |
| Distinct never-trim path: prose short-circuits pass 1 to identity, and main() skips pass 2 for prose | yes | yes | complete |

Dropping or unbounding the ceiling only silences pass 1. Pass 2 (`tightenToTarget`) reduces a `prose` payload to `trimTargetBytes(primaryWindow, diff)` by descending `TRIM_HEAD_LADDER`, independent of the ceiling, so a large spec over the primary window would still be head-reduced. Only gating both passes on the kind guarantees zero elision.

**Chosen:** a distinct never-trim path for `prose`. In `trimContextFiles`, the `prose` branch returns the input context unchanged (a genuine identity no-op, reason `prose-passthrough`). In main(), the FAFF-1039 window block is skipped when `diffKind === "prose"`.

```
PROCEDURE trimContextFiles(..., diffKind):
  1. IF thresholdBytes <= 0: RETURN identity, reason "disabled"        # unchanged
  2. IF diffKind == "prose": RETURN identity, reason "prose-passthrough"   # NEW: no ceiling, no head-fit
  3. ELSE (unified): today's byte gate + anchored reduction           # unchanged
```

```
PROCEDURE main() FAFF-1039 window block:
  primaryWindow = chain[0].contextWindow
  IF primaryWindow AND NOT noTrim AND diffKind != "prose":            # NEW guards: noTrim, prose
     ... estimate; if over usable window: tightenToTarget(...); adopt-if-smaller ...
  # prose or noTrim => block skipped entirely; the per-backend guard still handles any over-window payload
```

### Decision D2 — code-review disable wiring

Options considered.

- Overload `--context-trim-bytes 0` so it also skips pass 2. Rejected: the arg comment near review-call.mjs line 1593 documents, deliberately, that a declared window overrides `--context-trim-bytes 0` (pass 2 always trims because an over-window payload is worse than a trimmed one). Repurposing `0` to mean "disable everything" breaks that established contract and conflates the pass-1 byte-gate knob with a global disable.
- A dedicated `--no-trim` switch that disables both passes. One clear meaning, maps 1:1 to `adversarial.code_review.trim: false`, leaves `--context-trim-bytes 0` semantics intact.

**Chosen:** a dedicated `--no-trim` switch. When present it drives pass 1 to its `disabled` short-circuit (equivalent to `thresholdBytes: 0`) and adds the `noTrim` guard that skips the FAFF-1039 pass-2 block (see D1 pseudocode). `--context-trim-bytes 0` keeps its current narrower meaning.

Dispatch wiring (SKILL.md Phase 2, following the `timeout`/`max_tokens` two-read pattern already there):

```
consumer=code_review
# per-consumer trim toggle: default true; only false switches trimming off.
# NO global adversarial.trim key is ever read — reading only the per-consumer scalar
# is what makes section 2's exclusion of a global toggle true by construction.
trim=$("$faff" config get "adversarial.$consumer.trim")   # per-consumer scalar only
[ -z "$trim" ] && trim=true                                # unset => true (no global fallback)
no_trim_flag=""
[ "$trim" = "false" ] && no_trim_flag="--no-trim"

node "$REVIEW_CALL" --backends-json "$backends_json" ... $no_trim_flag \
  --system <lens> --context <files> --diff <diff-file>
```

The fallback is a bare `trim=true`, not a read of a global `adversarial.trim` key (a round-1 spec-review objection: a global fallback would let `adversarial.trim: false`, which section 2 tells the operator is inert, silently disable code-review trimming with no per-consumer key set). The only key the dispatch reads is `adversarial.code_review.trim`.

`--no-trim` is a transport-level flag on `review-call.mjs`; the "reads only the scalar" invariant is scoped to the SKILL.md dispatch that this spec governs, not a claim that the flag is unreachable elsewhere (a round-2 spec-review objection). A direct `review-call.mjs --no-trim` invocation is a test/advanced use, not the governed code-review path; no faff dispatch passes `--no-trim` except the code-review one gated on the scalar above. The spec-judge and spec-review dispatches never pass `--no-trim` (they rely on `--diff-kind prose`, which is unconditional pass-through in its own right), so the flag's blast radius on the governed paths is exactly the code-review toggle.

### Decision D3 — retire the now-unreachable prose-trim machinery

**The `prose` branch of `trimContextFiles` stays — it becomes the one-line identity.** D1 keeps a `prose` branch in `trimContextFiles` that returns the input unchanged with `reason: "prose-passthrough"` (that branch is required, not removed). What D3 removes is the *head-fit/ceiling logic that branch used to run*, now that it is a no-op, plus the standalone helpers only that logic called. Concretely, once `prose` is an identity in pass 1 and pass 2 is skipped for `prose`, these become unreachable and are removed: the head-fit/ceiling body formerly inside the `prose` branch, `headFit`, `headReduceBundle`, `TRIM_HEAD_LADDER`, `DEFAULT_PROSE_HEAD_FLOOR`, `DEFAULT_PROSE_CEILING_BYTES`, `PROSE_BRIEF_RESERVE_BYTES`, the `--context-prose-ceiling-bytes` flag, the head-only branch of `tightenToTarget`, and the `no-relevance-model`/`head-fit*` stderr notes in main(). The `tightenToTarget` head-only branch is safe to remove because main() never calls `tightenToTarget` for a `prose` diff at all (D1 skips the whole FAFF-1039 block when `diffKind === "prose"`, unconditionally — the `diffKind != "prose"` clause of the guard excludes prose on its own, before `noTrim` is even considered), so no caller reaches the head-only mode.

**Chosen:** remove the unreachable prose head-fit/ceiling machinery listed above, keeping the `prose` branch of `trimContextFiles` as the one-line `prose-passthrough` identity. Leaving dead tuning knobs and ladders in place is the exact code smell the repo standard bans (AGENTS.md, code smells). The unified pass-1 path, `TRIM_WINDOW_LADDER`, and the anchored branch of `tightenToTarget` are untouched, so the FAFF-1051 unified goldens stay byte-for-byte valid.

**Test-file follow-through (a round-1 spec-review objection).** `test/faff-1051-diff-kind.test.mjs` imports and directly tests the symbols D3 removes (`headReduceBundle`, `headFit`, `TRIM_HEAD_LADDER`, and the prose constants), so removing them without touching the test file fails it at import. The same change MUST drop those imports and the prose-path test blocks from that file, keeping the unified-golden blocks intact. This is a required part of D3, not a separate task.

**Removal is an invariant, not just a symbol list.** The DONE criterion for D3 is not only "these named symbols are gone" but the stronger property that **no code path in `review-call.mjs` reduces a `prose` payload at any size** (a round-1 spec-review objection: a closed symbol list cannot prove an unnamed prose-reduction branch did not survive). The prose-passthrough byte-identity test below is what verifies the invariant; the symbol grep is a secondary check.

**Anti-pattern:** keeping the `prose` branch's ceiling arithmetic "just in case". Why: it is unreachable after D1, and a dormant second reduction path invites a future edit to silently re-truncate specs, reopening this ticket.

### Edge cases and error handling

| Condition | Behaviour |
|---|---|
| `prose` payload over any size (under 5 MB) | pass-through; per-backend guard skips over-window backends; all over-window → chain exits 2 (needs-human), no served payload, no primary-skip signal |
| `--no-trim` on a `unified` diff over the window (under 5 MB) | pass-through; same per-backend guard; all over-window → exit 2 (needs-human) |
| untrimmed payload over 5 MB (either kind) | the FAFF-445 preflight (`checkPayloadSize`, `DEFAULT_MAX_PAYLOAD_BYTES` = 5 MB) still refuses pre-dispatch with exit 2 (needs-human); `--no-trim` does NOT bypass it (see Failure modes) |
| `adversarial.code_review.trim` unset | default true; `--no-trim` absent; today's trimming, byte-for-byte |
| `adversarial.code_review.trim` set to a non-boolean string | treated as not-`false`, so trimming stays on (fail-safe to today's behaviour) |
| `--no-trim` and `--context-trim-bytes 0` both present | both disable pass 1; `--no-trim` additionally skips pass 2; no conflict |
| primary backend declares no `context_window` | pass 2 already inert (unchanged); `--no-trim` still forces pass 1 off |

### Failure modes

**The failure — an operator sets `trim: false` expecting smaller calls, and every review now fails closed.** If no configured backend has a window wide enough for the untrimmed payload, the per-backend guard skips the whole chain and code review returns the mandatory-outage / needs-human class.
- **How you'd know:** review-call exits on the over-window skip path (exit 2 / chain-outage), with the `over-window (est … tok > … usable window)` stderr line for every backend.
- **What it means:** intended honest outcome, not a regression. Documented so the operator reads the skip as "widen a backend window or turn trimming back on", not as a bug.

**The failure — `--no-trim` does not bypass the FAFF-445 5 MB preflight, so a very large untrimmed payload is refused, not skipped.** `main()` runs the FAFF-445 oversized-diff preflight (`checkPayloadSize`, `DEFAULT_MAX_PAYLOAD_BYTES` = 5 MB) after the trim passes and independently of `--no-trim`/`thresholdBytes`. So a payload over 5 MB with trimming off is refused pre-dispatch with exit 2 (needs-human), not the per-backend over-window skip.
- **How you'd know:** review-call exits 2 with the FAFF-445 `oversized-diff preflight: assembled payload … exceeds the … byte threshold` stderr line, before any backend is called.
- **What it means:** a deliberate, documented interaction, not a bug. `--no-trim` turns off the two *trim* passes; it does not turn off the hard 5 MB request-body ceiling (which exists to avoid a guaranteed provider 413). An operator whose untrimmed payload exceeds 5 MB must either keep trimming on for that consumer or raise `--max-payload-bytes`. This change does not touch the FAFF-445 gate.

**The failure — D3's removal changes a unified golden.** If any removed symbol was reachable from the `unified` path, the FAFF-1051 unified goldens would shift.
- **How you'd know:** `test/faff-1051-diff-kind.test.mjs` unified-golden assertions fail.
- **What it means:** abandon the removal of that symbol; it was not prose-only. (Verified pre-implementation: `headFit`/`headReduceBundle`/`TRIM_HEAD_LADDER` are reached only via prose paths.)

### FAFF-903 shared-prefix cache

**Chosen (confirmed neutral):** trimming off does not disturb the FAFF-903 shared-prefix cache. Code review is a single call with no sibling to share a prefix with (SKILL.md line 234). For spec-review's four `prose` lenses, pass-through makes the prefix a pure function of `(context, diff)` with no per-call trim variance, so it stays byte-identical across lenses, which is what the cache keys on.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec-review casefile whose spec plus named files exceed 576 KB
When review-call.mjs runs with --diff-kind prose
Then every context file is supplied to the lens intact, with no elision at any size
```

```
Given adversarial.code_review.trim = false and a diff large enough to trigger both passes today
When the code-review dispatch invokes review-call.mjs
Then --no-trim is passed, neither the FAFF-915 anchored pass nor the FAFF-1039 window pass fires, and no context bytes are elided
```

```
Given a default unified code-review payload (adversarial.code_review.trim unset or true) and the captured pre-change baseline golden test/fixtures/trim-baseline/default-code-review-payload.json
When main() assembles the payload through both trim passes, the FAFF-903 prefix swap, and the header prepend
Then the assembled payload equals the captured baseline byte-for-byte (the concrete oracle for "identical to today", including automatic window-fitting)
```

```
Given the fixture chain over-window-with-fallback (primary context_window too small for the untrimmed fixture payload, fallback window large enough) with adversarial.code_review.trim = false and a fixture whose token estimate is pinned so N and M are known
When the code-review dispatch invokes review-call.mjs with --no-trim
Then the primary is skipped with the stderr line matching "[chain] <provider>/<model> over-window (est <N> tok > <M> usable window) → advancing (exit 2)" (N, M fixed by the fixture) and the [faff:primary-skipped] signal is emitted, the fallback serves the untrimmed payload, and no context bytes are elided
```

```
Given the fixture chain over-window-all (every backend's context_window too small for the untrimmed fixture payload) with adversarial.code_review.trim = false
When the code-review dispatch invokes review-call.mjs with --no-trim
Then no backend serves, so there is no served payload and NO [faff:primary-skipped] signal; each backend emits its over-window line ("→ advancing" for all but the last, "exhausted:" for the last); and the chain terminates at exit 2, which the SKILL.md exit table maps to needs-human (this is what "fails closed" means here — a needs-human terminal, not a new terminal state)
```

```
Given adversarial.code_review.trim set to a non-boolean string (for example "yes", "0", or "FALSE")
When the code-review dispatch resolves the toggle
Then the value is not equal to the literal "false", so --no-trim is NOT passed and trimming stays on (fail-safe to today's behaviour)
```

- The `unified` trim path (pass 1 anchored reduction, `TRIM_WINDOW_LADDER`, `tightenToTarget` anchored branch) MUST remain byte-for-byte identical to the FAFF-1051 goldens when `--no-trim` is absent.
- **"Assembled payload" is pinned to one extraction point:** the exact two wire strings `main()` hands the builders for the default code-review dispatch — the `system` argument (`sharedBlock`: the `assembleUserMessage(contextFiles, diff)` output after the FAFF-903 prefix swap and the header prepend) and the `user` argument (`lensBrief`: the `--system` review lens). The baseline golden `test/fixtures/trim-baseline/default-code-review-payload.json` captures exactly `{ system, user }` from the pre-change `main()` for a fixed fixture input; the byte-for-byte assertion compares the post-change `{ system, user }` against it. Not the post-trim context files alone, not the full JSON wire body, not stdout. It is regenerated only deliberately via `test/fixtures/trim-baseline/regenerate.mjs`, never silently.

## 6. Design decision rationale

**How should `prose` guarantee zero elision?** Options and verdict in Decision D1 above. **Chosen:** distinct never-trim path (identity pass 1 + skip pass 2 for prose), because dropping or unbounding the ceiling silences only pass 1 while pass 2 trims independently of the ceiling.

**How should code review disable trimming?** Options in Decision D2. **Chosen:** a dedicated `--no-trim` switch, because overloading `--context-trim-bytes 0` breaks the documented "declared window overrides 0" contract and conflates two distinct knobs.

**Remove the dead prose-trim machinery, or leave it inert?** **Chosen:** remove it (Decision D3), because unreachable reduction code violates the repo code-smell rule and invites accidental re-truncation of specs. Rejected: leaving it dormant.

**Where does the `trim` key live?** **Chosen:** a per-consumer scalar read at the dispatch site (WHAT, config-key placement), not a `BACKEND_KEYS` field, because it governs the whole call and matches the existing `timeout`/`max_tokens` consumer-scalar pattern.

**Is the FAFF-903 cache affected?** **Chosen:** confirmed neutral (see FAFF-903 section). Code review is a single call; spec-review's prose prefix is a pure function of `(context, diff)` and stays byte-identical across lenses.

## 7. Open questions and assumptions

Open questions. None. The two open questions the ticket raised (prose mechanism, toggle wiring) are settled in Decisions D1 and D2; the FAFF-903 confirmation is settled as neutral.

Assumptions.

**Assumes:** FAFF-1051 (the `--diff-kind unified|prose` mechanism, merged to main as commit `12ed94f8`) is present in the working branch. Validation before starting: `git grep -q "diffKind" plugin/skills/faffter-dark-adversarial-review/review-call.mjs` returns success, and `git grep -q -- "--diff-kind" plugin/skills/faffter-dark-spec-review/build-lens-requests.mjs` returns success. If either fails, FAFF-1051 has not landed and this ticket is blocked.

## 8. DONE — definition of done

### From WHY
- [ ] A `prose` spec-review or spec-judge round over 576 KB supplies its full context with no elision (the pain point is gone at any size).
- [ ] With trimming off and a payload over the primary window, the per-backend guard skips the primary to a wider-window fallback (fixture `over-window-with-fallback`), emitting the line `[chain] <provider>/<model> over-window (est N tok > M usable window) → advancing (exit 2)` and the `[faff:primary-skipped]` signal; when every backend is over-window (fixture `over-window-all`) nothing serves, no primary-skip signal is emitted, and the chain terminates at exit 2 (needs-human) — that is what "fails closed" means here, not a new terminal state. Covered by the two over-window scenarios + tests (honest outcome, not a silent trim).

### From WHAT (config and CLI)
- [ ] `adversarial.code_review.trim` reads and writes through `faff config get`/`set` as a per-consumer scalar; it is not added to `BACKEND_KEYS`.
- [ ] `adversarial.code_review.trim` unset defaults to `true`.
- [ ] The dispatch reads only `adversarial.code_review.trim`; no global `adversarial.trim` key is read, so setting one has no effect.
- [ ] `review-call.mjs` accepts `--no-trim`; absent, behaviour is unchanged.

### From HOW (behaviour)
- [ ] `trimContextFiles` with `diffKind === "prose"` returns the input context unchanged at any size (identity, reason `prose-passthrough`); no ceiling, no head-fit.
- [ ] main() skips the FAFF-1039 window block when `diffKind === "prose"`.
- [ ] main() skips the FAFF-1039 window block when `--no-trim` is set, and drives pass 1 to its disabled short-circuit.
- [ ] The code-review dispatch (SKILL.md) reads `adversarial.code_review.trim`, defaults it to true, and passes `--no-trim` only when it is `false`.
- [ ] `adversarial.code_review.trim` unset or true produces a code-review call whose `{ system, user }` wire strings (the pinned extraction point in Scenarios) equal the captured baseline golden `test/fixtures/trim-baseline/default-code-review-payload.json` byte-for-byte (the concrete oracle for "identical to today"; FAFF-915 win and automatic window-fitting preserved).

### From HOW (dead-code retirement)
- [ ] Invariant: no code path in `review-call.mjs` reduces a `prose` payload at any size (verified by the prose byte-identity test below, not merely by a symbol grep).
- [ ] Mechanism: the head-fit/ceiling body formerly inside the `prose` branch (the `prose` branch itself STAYS as the one-line `prose-passthrough` identity), `headFit`, `headReduceBundle`, `TRIM_HEAD_LADDER`, `DEFAULT_PROSE_HEAD_FLOOR`, `DEFAULT_PROSE_CEILING_BYTES`, `PROSE_BRIEF_RESERVE_BYTES`, `--context-prose-ceiling-bytes`, the `tightenToTarget` head-only branch, and the prose stderr notes are removed.
- [ ] `test/faff-1051-diff-kind.test.mjs` is updated in the same change: the imports and prose-path test blocks for the removed symbols are dropped; the unified-golden blocks still pass unchanged.

### From HOW (edge cases and cache)
- [ ] A non-boolean `adversarial.code_review.trim` value (e.g. `yes`, `0`, `FALSE`) is not equal to the literal `false`, so `--no-trim` is not passed and trimming stays on (fail-safe), covered by the non-boolean scenario + test.
- [ ] The FAFF-903 shared-prefix cache is unaffected: spec-review's four prose lenses receive a byte-identical prefix.

### Tests
- [ ] `--no-trim` disable path: with `--no-trim`, neither pass 1 (FAFF-915 anchored) nor pass 2 (FAFF-1039 window) elides any bytes, following the `test/faff-1051-diff-kind.test.mjs` pattern and `test/fixtures/trim-baseline/` fixtures.
- [ ] Prose byte-identity invariant: a `prose` payload over 576 KB is byte-identical through both passes (pass 1 identity `prose-passthrough`, FAFF-1039 block skipped). This test is what proves no prose-reduction path survives (the D3 invariant), not merely that named symbols are gone.
- [ ] Default-payload baseline: capture the `{ system, user }` wire strings (the pinned extraction point) from the pre-change `main()` for a fixed fixture into `test/fixtures/trim-baseline/default-code-review-payload.json`, and assert the post-change default unified code-review path (`adversarial.code_review.trim` unset/true) produces byte-identical `{ system, user }`. Regenerate only via `test/fixtures/trim-baseline/regenerate.mjs`, never silently.
- [ ] Over-window skip (fallback serves): the named fixture `over-window-with-fallback` (pinned token estimate → known N/M) with `--no-trim` skips the primary with the line `[chain] <provider>/<model> over-window (est N tok > M usable window) → advancing (exit 2)` and the `[faff:primary-skipped]` signal, and the fallback serves the untrimmed payload.
- [ ] Over-window fail-closed: the named fixture `over-window-all` with `--no-trim` serves nothing, emits no `[faff:primary-skipped]` signal, emits each backend's over-window line (`→ advancing` then `exhausted:`), and terminates at exit 2 (needs-human).
- [ ] Non-boolean fail-safe: `adversarial.code_review.trim` set to a non-boolean string does not pass `--no-trim` (trimming stays on).
- [ ] Test-file follow-through: after removing the D3 symbols and their imports/test blocks from `test/faff-1051-diff-kind.test.mjs`, the file imports cleanly and its unified-golden blocks still pass.

Eval coverage. This change introduces no LLM-judgement seam (pure trim logic plus a config toggle), so no grader registration is required.

Integration smoke test.

```
PROCEDURE smoke():
  1. Build a >576 KB context bundle + a prose --diff.
  2. Run review-call.mjs --diff-kind prose --backends-json <primary declares context_window>
     with a stubbed backend runner.
  3. ASSERT the context handed to the runner equals the input bundle byte-for-byte (no elision).
  4. Set adversarial.code_review.trim=false; run the unified code-review dispatch on a large diff.
  5. ASSERT --no-trim is on the argv AND the context handed to the runner equals the input (no elision).
```

confidence: high
build-tier: complex
