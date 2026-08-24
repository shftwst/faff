# Spec — FAFF-903: reorder the spec/code-review fan-out prompt to a shared cacheable prefix

> Spec: faffter-dark-nlspec · 2026-08-24 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-903.
> Revised 2026-08-24 (consolidation) — folded the round-1 spec-review AC re-anchoring and the accepted-tradeoff addendum into the spec body, and repointed the benchmark from the sibling worktree to the now-merged in-repo `eval/review-bench/` (FAFF-904). Design is unchanged; the reorder shape and the accepted infosec tradeoff both stand.

This is a build-ready nlspec for FAFF-903, "Reorder the spec/code-review fan-out prompt to a shared-context cacheable prefix". The audience is the build agent that will make the change, plus the human reviewers who gate it. The change is a payload-assembly reorder inside the shared adversarial-review transport (`plugin/skills/faffter-dark-adversarial-review/review-call.mjs`), the tests that pin its wire shape, and the two SKILL.md prose contracts that describe the call. It ships as one unit.

## 1. WHY — problem and principles

**The load-bearing model.** A prefix-caching LLM backend caches the key/value tensors for a request prefix keyed on its leading bytes. A second request that starts with the identical byte sequence skips re-computing the prefill for that shared span and reports the reused span as `cached_tokens`. The four spec-review lenses send four requests whose context+spec block (roughly 15K tokens) is byte-identical, but today that shared block sits *after* the per-lens brief, so no two requests share a leading byte span and the cache never triggers. Putting the shared block first makes lens 1 populate the cache and lenses 2 to 4 hit it.

**Problem statement.** Today the per-lens refuter brief is the token prefix (the `system` message) and the shared context+spec/diff trails it (the `user` message), so four lenses whose context+spec block is roughly 95% byte-identical share no cacheable prefix; on a single-GPU local backend they serialise and pay the full prefill four times. This change swaps the two, so the shared context+spec/diff becomes the common prefix and the differing lens brief trails it. Measured on OMLX qwen (Qwen3.8-27B-4bit), a 4-lens cold concurrent fan-out drops from 1209s with `cached_tokens=0` on every lens to 607s with `cached_tokens=14336` on lenses 2 to 4, about 2.0x faster with identical review content.

**Design principles.**

**The reorder must not change what the model sees, only the order it sees it in.** Every byte in the payload today is still in the payload after the change; only the assignment of the shared block versus the brief to the prefix-versus-trailing position flips. The benchmark already confirmed identical review content across the two shapes. Any implementation that drops, trims, or rewrites content to achieve the reorder is wrong.

**The reorder lands at the caller seam, not inside the three payload builders.** `buildChatPayload`, `buildOpenAiPayload`, and `buildAnthropicPayload` each take `{system, user}` and place them in their family's wire slots. If the caller assigns the shared block to `system` and the brief to `user`, all three builders put the shared block in the prefix position for free (messages[0] for ollama/OpenAI, top-level `system` for Anthropic), with no builder edit and no change to the streaming path. Reordering inside each builder instead would fork the same decision three ways and risk the three drifting.

**The two review paths share one transport, so both move together.** `review-call.mjs` is the single transport for spec-review (four lenses fanned out concurrently by `fan-out.mjs` via `Promise.allSettled`, one child per lens) and for code-review (one lens, at graft time). A reorder in the shared assembly reorders both. The benefit is real only for spec-review's four lenses (code-review is a single call with nothing to share a prefix with), but the shape change applies to both and both must stay correct.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | The shared transport. `main()` (from line 1262; the assembly seam is at lines 1328 to 1363) reads `--system`, assembles `user` from `--context` + `--diff` via `assembleUserMessage`, size-checks, and dispatches. This is where the reorder lands. |
| `assembleUserMessage` (from line 125) | Node ESM | XML-fences each context file as `<file path="...">...</file>`, then appends `DIFF UNDER REVIEW:\n\n${diff}`. Produces the shared block, byte-identical across lenses. |
| `buildChatPayload` (from line 85) | Node ESM | ollama native. `messages:[{role:system,content:system},{role:user,content:user}]`, plus `think:false`, `options`. |
| `buildOpenAiPayload` (from line 464) | Node ESM | OpenAI-compatible. Same `messages` order; reasoning flags. Covers OMLX/vLLM. |
| `buildAnthropicPayload` (from line 533) | Node ESM | Anthropic native. `system` is a top-level field; `messages:[{role:user,content:user}]` only. Structurally asymmetric to the other two. |
| `checkPayloadSize` (from line 144) | Node ESM | Sums `system+user` bytes. Content-agnostic, so a role swap does not change its result. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Markdown prose | The lens fan-out lives here, not in `review-call.mjs`. Its "Backend call" section names `--system …refute-<lens>.md`. Prose-contract tested. |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Markdown prose | The code-review "LLM provider integration" section names `--system <review-lens-file>`. Prose-contract tested. |
| `test/adversarial-call.test.mjs` | Node test | Role-order assertions on all three builders (`messages.map(m=>m.role)` at lines 30 and 167; the Anthropic `[{role:"user"}]` assertion at line 343); the SKILL.md prose-contract tests. |
| `eval/review-bench/` (in-repo, adopted under FAFF-904, merged) | Node scripts + fixtures | Encodes the target shape: `requests/` (current) versus `requests-shared-prefix/` (reordered). `run-bench.mjs` reads `cached_tokens` and `prompt_eval_count`. |

**Scope statement.** This change is a byte-order rearrangement of the wire payload inside the adversarial-review transport that both the L4 spec-review and the graft-time code-review paths flow through.

## 2. OUT OF SCOPE

- **Anthropic `cache_control` breakpoints.** What's excluded: adding explicit `cache_control` markers to the Anthropic payload to trigger hosted prompt caching. Why excluded: hosted Anthropic caching is not triggered by prefix order alone; it needs explicit breakpoints and has its own minimum-token thresholds and pricing, a separate design with its own validation. The reorder still puts the shared block in Anthropic's top-level `system` prefix position, so this change is a precondition for that future work, not a substitute. Extension point: `buildAnthropicPayload` in `review-call.mjs`, where `system` would take a content-block array carrying a `cache_control` breakpoint.

- **A production `cached_tokens` telemetry field.** What's excluded: teaching the production streaming accumulators (`accumulateNdjson`, `accumulateSse`, `accumulateAnthropic`) to parse and surface `cached_tokens`. Why excluded: those accumulators are downstream of the builders and are constrained to stay unchanged; the cache-hit signal for this ticket's acceptance is read by the benchmark harness, which already parses it. Extension point: the three accumulators in `review-call.mjs`, each of which would read the provider's usage block.

- **A prefix-warming pre-request.** What's excluded: firing one throwaway request before the fan-out to force-populate the prefix cache regardless of the backend's concurrency model. Why excluded: it is a latency optimisation on top of the reorder, not needed for the measured 2x win (lenses 2 to 4 already hit the cache once lens 1 lands), and it adds a request, a failure mode, and a config surface. Extension point: `fan-out.mjs`, which would issue the warming request before spawning the lens children.

- **Changing which files are in `--context`.** What's excluded: any change to the context-file set. Why excluded: FAFF-882 already removed the 262KB gateway from `--context` (merged); this reorder is complementary and touches only ordering. Extension point: the `--context` assembly in the two SKILL.md "Backend call" sections.

- **Restructuring the code-review path's single call for caching.** What's excluded: any code-review-specific caching. Why excluded: code-review is one lens per graft, so it has no sibling request to share a prefix with; it inherits the reordered shape only because it shares the transport. Extension point: none needed; the shared transport covers it.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Shared block | The assembled context files (XML-fenced) followed by `DIFF UNDER REVIEW:\n\n${diff}`. The output of `assembleUserMessage`. Byte-identical across the four spec-review lenses of one pass. |
| Lens brief | The per-lens refuter prompt, one of `refute-<lens>.md` for spec-review or the single review-lens file for code-review. The differing part of the payload. Read from the `--system` CLI flag. |
| Prefix position | The wire slot a prefix-caching backend keys its cache on: `messages[0]` for ollama and OpenAI-compatible, the top-level `system` field for Anthropic. |
| Cacheable prefix | A leading byte span shared across requests such that a backend can reuse its prefill. Achieved here by placing the shared block in the prefix position. |

**The reorder, stated as a data mapping.** The change is a swap of which string is assigned to the builder's `system` argument versus its `user` argument, performed once in `main()` before dispatch. Nothing about the CLI flags changes: `--system` still carries the lens brief file, `--context` and `--diff` still carry the shared material. Only the internal assignment to the two builder arguments flips.

```
# CLI inputs (unchanged):
#   --system FILE  -> the lens brief
#   --context/--diff -> the shared material

BEFORE (today):
  briefText  = read(--system)
  sharedText = assembleUserMessage(context, diff)
  builder({ system: briefText,  user: sharedText })   # brief is the prefix

AFTER (this change):
  briefText  = read(--system)
  sharedText = assembleUserMessage(context, diff)
  builder({ system: sharedText, user: briefText })    # shared block is the prefix
```

**Builder call shapes after the reorder (no builder edit; the caller supplies swapped arguments).**

```
# ollama (buildChatPayload) and OpenAI-compatible (buildOpenAiPayload):
messages: [
  { role: "system", content: <shared block> },   # cacheable prefix
  { role: "user",   content: <lens brief> },      # trails
]

# Anthropic (buildAnthropicPayload):
system: <shared block>                            # top-level, cacheable prefix
messages: [ { role: "user", content: <lens brief> } ]   # trails
```

**Design decisions.**

**Where the reorder lands.** Options: (a) swap the two arguments once at the caller seam in `main()`; (b) swap inside each of the three builders. Option (a) is one edit, keeps the three builders and the streaming path untouched, and keeps the three transports consistent by construction. Option (b) forks the same decision three ways and risks drift. **Chosen:** swap at the caller seam in `main()`, assigning the shared block to the builders' `system` argument and the lens brief to their `user` argument.

**Unconditional versus flag-gated.** The two shapes produce identical review content (benchmark-confirmed), so the reorder is a pure win on prefix-caching backends and neutral elsewhere. A flag would add a config surface, a second code path to test, and a way to accidentally ship the slow shape. **Chosen:** unconditional reorder, no flag.

**Backend scope for the automatic win.** Prefix-caching local backends (ollama native, and OpenAI-compatible prefix-caching servers such as OMLX and vLLM) get the prefill saving automatically from byte order. Hosted Anthropic caching needs explicit `cache_control` breakpoints, which prefix order alone does not set. **Chosen:** the automatic win is scoped to prefix-caching ollama/OpenAI-compatible backends; Anthropic still gets the shared block in its top-level `system` prefix position (so the shape is uniform and a future `cache_control` change is unblocked), but hosted Anthropic caching is out of scope for this ticket (see OUT OF SCOPE).

**The prefix-warming step.** A pre-fan-out warming request would guarantee a hit even on a backend that starts all N lenses truly simultaneously before any prefix is cached. The measured 2x already holds without it. **Chosen:** defer prefix-warming; it is out of scope for this ticket.

**The cache-hit verification signal.** The production accumulators do not parse `cached_tokens` and are constrained to stay unchanged. The benchmark harness (`run-bench.mjs`) already reads `cached_tokens` (via `stream_options.include_usage` on the OpenAI path and `prompt_eval_count` on ollama). **Chosen:** the acceptance-criterion cache-hit signal (lenses 2 to 4 report `cached_tokens > 0` where lens 1 is cold) is verified by re-running the benchmark against `requests-shared-prefix/`, not by a new production telemetry field.

**Trust-boundary inversion (accepted tradeoff).** The chosen shape places the untrusted review content (the diff / spec under review, from `assembleUserMessage`) into the higher-privilege `system` role, and demotes the trusted, checked-in `refute-<lens>.md` brief to the `user` turn. That inverts the prompt-injection trust boundary. **Chosen:** accept the inversion, because this reviewer runs in a self-hosted pipeline over faff's own diffs and specs, where the attacker-controllable-input threat is low. If the threat model changes (for example reviewing third-party diffs), revisit with the roles-preserved alternative: keep the brief in `system` and order the messages array `[user, system]` so the shared user block leads. That preserves the trust boundary but depends on the backend template rendering array order, so a template that hoists `system` defeats it; not worth the fragility here. The chosen shape is hoist-proof: putting the shared block in `system` leads the rendered prefix whether or not a backend hoists the system message.

## 4. HOW — behaviour

**Architecture and approach.** `main()` already computes both strings it needs: `system` (read from `--system`, the lens brief) and `user` (assembled from `--context` + `--diff` by `assembleUserMessage`, the shared block). The size check `checkPayloadSize({system, user})` sums both and is order-agnostic, so it runs before or after the swap identically. The reorder is a single reassignment of those two local values into the two builder arguments at the dispatch call, done once, so all three families inherit it. The three orchestration functions (`runReviewOllama`, `runReviewOpenAi`, `runReviewAnthropic`) and the streaming accumulators are untouched.

**Behaviour summary.** After this change, `main()` hands the shared block to the transport as the builder's `system` argument and the lens brief as the builder's `user` argument, so every family emits the shared block in its prefix position and the lens brief trailing it.

```
PROCEDURE main(argv):
  1. Parse argv (unchanged): brief_path = --system; context/diff flags as today.
  2. briefText  = read(brief_path)                      # the lens brief, unchanged read
  3. sharedText = assembleUserMessage(context, diff)    # the shared block, unchanged assembly
  4. size = checkPayloadSize({ system: sharedText, user: briefText })   # sum is order-agnostic
     IF size.oversized: return EXIT.USAGE                # unchanged behaviour
  5. Dispatch each backend in the chain with:
        system = sharedText     # shared block -> prefix position (was briefText)
        user   = briefText      # lens brief   -> trails         (was sharedText)
  6. Everything downstream (orchestration, streaming accumulate, refuteFindings,
     header normalisation, exit mapping) is unchanged.
```

**Edge cases and error handling.**

- Empty-input guard. `main()` today rejects an empty `--system` or empty `--diff` with `EXIT.USAGE`. The guard checks the same two source strings (`system.trim()`, `diff.trim()`) and is unaffected by which builder argument each ends up in. Keep it exactly as is.
- Oversized-diff preflight. `checkPayloadSize` sums the two strings; swapping which is `system` and which is `user` leaves the sum unchanged, so the preflight fires on the same payloads as before.
- `refuteFindings` and `claimTargets`. These operate on the model's returned findings text and the `--context` path list, not on the request payload order, so they are unaffected.
- Finding-splitter under the new leading turn. After the reorder the model's leading turn is the spec/diff, a document full of `##`/`###` headings. A model that echoes its leading turn into its output preamble is more likely to emit a `###`-like line before its first real finding, which is exactly the case `splitFindings` / `ensureHeader` (FAFF-361/194) already guard. This is not a design change; it is a build watch-out that needs a regression test (see DoD).

**Failure modes.**

- **The failure:** the measured 2x is a benchmark artifact and the real fan-out does not hit the cache, because the four lenses start close enough together that all four miss the not-yet-populated prefix. How you'd know: a real 4-lens fan-out shows `cached_tokens=0` on lenses 2 to 4 despite the reordered shape. What it means: the reorder is still correct (identical content, no regression) but the latency win needs the deferred prefix-warming step; narrow the claim to "shape is cache-ready" and open warming as follow-up. This does not block the shape change.
- **The failure:** a backend keys its cache on the full request body rather than a leading span, so the differing trailing brief defeats the shared-prefix hit. How you'd know: `cached_tokens=0` on lenses 2 to 4 on that specific backend while OMLX shows the hit. What it means: the win is backend-specific (already scoped to prefix-caching servers); name the backend as not-in-scope, no code change.
- **The failure:** a reviewer model interprets the shared block differently when it arrives as the leading turn rather than the trailing turn, changing review content. How you'd know: the benchmark's review-content comparison across `requests/` and `requests-shared-prefix/` diverges. What it means: the identical-content premise is broken; abandon the unconditional reorder and reconsider gating. The benchmark already ran this comparison and found identical content, so this is a regression guard, not an open risk.

**Anti-pattern:** editing `buildChatPayload`/`buildOpenAiPayload`/`buildAnthropicPayload` to reorder their internal `messages` array. Why: it forks one decision across three builders that can drift, and it needlessly touches the wire-shape functions the role-order tests pin; the caller seam does it once.

**Anti-pattern:** renaming or repurposing the `--system` CLI flag to carry the shared block. Why: the flag names stay stable (the lens brief is still `--system …refute-<lens>.md`); only the internal argument assignment flips, so the SKILL.md prose contracts and their tests stay green without churn.

**Anti-pattern:** adding `cached_tokens` parsing to the production accumulators to "prove" the hit. Why: the accumulators are constrained to stay unchanged, and the benchmark already reads the signal; production telemetry is a separate, deferred piece of work.

## 5. Scenarios

```
Given the same four lenses' assembled payloads under the reordered shape
When the system field of each lens payload is hashed
Then all four system fields are byte-identical and the four user fields differ
```

```
Given an Anthropic-native review call under the reordered shape
When the payload is built
Then the shared block is the top-level system field and messages is exactly [{ role: "user", content: <lens brief> }]
```

```
Given a spec/diff whose leading turn begins with a `###` heading, echoed into the model's output preamble
When splitFindings / ensureHeader process the returned text under the reordered shape
Then the finding-splitter invariant holds (the preamble echo is not mistaken for a finding)
```

- Both review paths go through the reordered assembly: the spec-review 4-lens fan-out and the graft-time 1-lens code-review, since they share `review-call.mjs`.
- Manual, out-of-repo (not a CI gate): re-running `eval/review-bench/` against a prefix-caching backend shows lens 1 `cached_tokens = 0` (cold) and lenses 2 to 4 `cached_tokens > 0`, with materially lower wall-clock in line with the recorded ~2x on OMLX qwen.

## 6. Design decision rationale

**Where does the reorder land: caller seam or per-builder?**
- Caller seam in `main()`: one edit, three builders and the streaming path untouched, three transports consistent by construction. Con: a reader must know the swap happens at assignment time, not in the builder.
- Per-builder: local to each wire shape. Con: forks one decision three ways, drift risk, and touches the exact functions the role-order tests pin.
- **Chosen:** caller seam. One edit, minimum blast radius, consistency guaranteed.

**Gated behind a flag, or unconditional?**
- Flag: lets an operator pick the old shape. Con: identical content means there is no reason to want the slow shape; a flag adds a config surface, a second tested path, and a way to ship the slow shape by accident.
- Unconditional: one shape, one path.
- **Chosen:** unconditional. The benchmark confirmed identical content, so there is nothing to gate.

**Which backends get the automatic win, and is Anthropic caching in scope?**
- Prefix-caching ollama and OpenAI-compatible servers (OMLX, vLLM) cache on leading bytes, so byte order alone earns the prefill saving.
- Hosted Anthropic caching needs explicit `cache_control` breakpoints and has its own thresholds and pricing; prefix order alone does not trigger it.
- **Chosen:** the automatic win is scoped to prefix-caching ollama/OpenAI-compatible backends. Anthropic still gets the shared block in its top-level `system` prefix position for shape uniformity and to unblock a future `cache_control` change, but hosted Anthropic caching is out of scope here.

**Prefix-warming: in scope or deferred?**
- Warming guarantees a hit even when all N lenses start simultaneously. Con: adds a request, a failure mode, and config, for a win the measured 2x already shows without it.
- **Chosen:** deferred. At the time of writing, the OMLX measurement shows lenses 2 to 4 hitting the cache without warming.

**How is the cache hit verified for acceptance?**
- Production accumulators do not read `cached_tokens` and are constrained to stay unchanged.
- The benchmark harness (`run-bench.mjs`) already reads `cached_tokens` (OpenAI path) and `prompt_eval_count` (ollama).
- **Chosen:** verify via the in-repo `eval/review-bench/` benchmark against `requests-shared-prefix/`, not a new production field. This is a manual, out-of-repo check (it needs a live prefix-caching backend), recorded as evidence on the ticket, not a CI gate.

**Trust boundary: invert or preserve?** Covered in section 3 under "Trust-boundary inversion (accepted tradeoff)". **Chosen:** accept the inversion for the self-hosted, own-diffs threat model; the roles-preserved alternative is the documented revisit path if the threat model changes.

## 7. Open questions and assumptions

**Open questions.** None. Every decision above is closed.

**Assumptions.**

- **Assumes:** the swap of the builders' `system` and `user` arguments is the only edit needed for all three families to place the shared block in their prefix position, because each builder already maps its `system` argument to its family's prefix slot (messages[0] for ollama/OpenAI, top-level `system` for Anthropic) and its `user` argument to the trailing turn. Validate before starting: re-read `buildChatPayload`, `buildOpenAiPayload`, and `buildAnthropicPayload` and confirm each places its `system` argument in the prefix slot and its `user` argument in the trailing user turn.
- **Assumes:** the in-repo benchmark at `eval/review-bench/` (adopted under FAFF-904, merged) holds `requests-shared-prefix/` with byte-identical `system` fields... note: in the reordered shape the lens brief moved to `user`, so the shared block is what must be byte-identical across the four payloads — confirm by hashing the position each transport treats as the prefix. `run-bench.mjs` still reads `cached_tokens`/`prompt_eval_count`. Validate before starting: hash the prefix-position content across the four `requests-shared-prefix/*.json` (expect one shared hash) and the trailing brief (expect four distinct hashes), and grep `run-bench.mjs` for `cached_tokens`.
- **Assumes:** the role-order assertion tests in `test/adversarial-call.test.mjs` (`messages.map` at lines 30 and 167, the Anthropic assertion at line 343) are the tests that pin the builder message order, so updating them plus the SKILL.md prose-contract tests is the full test surface. Validate before starting: grep the test file for `messages.map`, `role:`, and `messages` assertions on all three builders.

## 8. DONE — definition of done

The DoD splits into an **in-repo deterministic gate** (the CI-checkable properties) and an **out-of-repo manual verification** (the perf number, which needs a live prefix-caching backend and the `eval/review-bench/` harness). No acceptance criterion asserts LLM-output equality between the two shapes: that property is non-deterministic and has no oracle, and is replaced by prompt-string byte-identity.

### In-repo deterministic gate (the CI-checkable ACs)

**From the reorder mapping**
- [ ] `main()` assigns the shared block (`assembleUserMessage` output) to the builders' `system` argument and the lens brief (`--system` file) to their `user` argument.
- [ ] The CLI flags are unchanged: `--system` still names the lens brief file, `--context`/`--diff` still carry the shared material.

**From behaviour, all three transports (role-order assertions over the reordered `main()`)**
- [ ] ollama (`buildChatPayload`): `messages[0].role === "system"` carries the shared block and `messages[1].role === "user"` carries the lens brief.
- [ ] OpenAI-compatible (`buildOpenAiPayload`): the same `messages` order with the shared block first.
- [ ] Anthropic (`buildAnthropicPayload`): the shared block is the top-level `system` field and `messages === [{ role: "user", content: <lens brief> }]`.
- [ ] A deterministic test asserts that across the four spec-review lenses of one pass, the prefix-position content (the shared block) is **byte-identical** and only the trailing lens brief differs (the concrete, testable form of "identical content"). No backend involved.
- [ ] The three builder signatures, the three orchestration functions, and the three streaming accumulators (`accumulateNdjson`, `accumulateSse`, `accumulateAnthropic`) are unchanged.
- [ ] `checkPayloadSize` still fires on the same payloads (the sum is unchanged by the swap).

**From both paths**
- [ ] The spec-review 4-lens path and the graft-time 1-lens code-review path both flow through the reordered assembly (verified by the shared `review-call.mjs` seam, not two edits).

**From decisions**
- [ ] The reorder is unconditional (no new flag).
- [ ] No `cache_control` breakpoint is added to the Anthropic payload (out of scope).
- [ ] No `cached_tokens` parsing is added to the production accumulators (out of scope).

**From tests and contracts**
- [ ] The role-order assertion tests in `test/adversarial-call.test.mjs` are updated to expect the shared block in the prefix position and the lens brief trailing, for all three builders, and pass.
- [ ] Build watch-out test: a `###`-leading echo in the model's output preamble is handled by `splitFindings`/`ensureHeader` under the new shape (a regression test asserting the finding-splitter invariant holds when the leading turn is the heading-rich spec/diff).
- [ ] The SKILL.md prose-contract tests pass; they continue to assert `--system …refute-<lens>.md` (spec-review) and `--system <review-lens-file>` (code-review) because the CLI flag names are unchanged.
- [ ] The two SKILL.md "Backend call" prose sections state that the shared context/diff occupies the cacheable prefix position and the lens brief trails it, so the prose matches the reordered wire shape.
- [ ] The full `test/adversarial-call.test.mjs` suite is green.

### Out-of-repo manual verification (NOT a CI gate; needs a live prefix-caching backend)

- [ ] Manual: re-running `eval/review-bench/` against a prefix-caching backend shows lens 1 `cached_tokens = 0` (cold) and lenses 2 to 4 `cached_tokens > 0`, with materially lower wall-clock in line with the recorded ~2x on OMLX qwen. Recorded as evidence on the ticket, not gated in CI.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Build each family's payload via the reordered main() path with a known shared block S and brief B.
  2. ASSERT ollama:    payload.messages[0] == {role:"system", content:S}
                       payload.messages[1] == {role:"user",   content:B}
  3. ASSERT openai:    same messages order as ollama
  4. ASSERT anthropic: payload.system == S AND payload.messages == [{role:"user", content:B}]
  5. ASSERT checkPayloadSize sum is unchanged versus the pre-swap assignment.
```

---

confidence: high
build-tier: complex
spec-review: approve — operator-accepted. Round-1 spec-review returned reject-approach on the QA lens (the DoD's perf/content criteria were not verifiable in-repo); resolved by re-anchoring the ACs into the in-repo deterministic gate + out-of-repo manual verification above. The design is unchanged and was human-accepted (a small, well-understood reorder); the infosec trust-boundary inversion was weighed and accepted for the self-hosted threat model. The backend gate was not re-run for this consolidation.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
