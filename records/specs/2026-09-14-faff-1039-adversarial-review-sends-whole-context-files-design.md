# Per-backend context-window preflight for adversarial review

> Spec: faffter-dark-nlspec · 2026-09-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1039.

This is the build spec for FAFF-1039. Audience: the build agent implementing the fix, and the human reviewers of the resulting PR. It specifies how `faffter-dark-adversarial-review` stops silently downgrading to a weaker fallback backend when a review payload overflows the strongest backend's context window.

## 1. WHY — Problem and Principles

**The load-bearing idea.** A review's fallback chain is tried strongest-first, but the decision to advance past a backend is made *reactively* — only when that backend throws (an HTTP 400 for an over-window payload). Because the payload is assembled once, whole-file, and sized against nothing but a coarse 5MB byte ceiling, the strongest backend is dispatched into a guaranteed 400 whenever the diff touches a large module, and the review is silently served by a weaker backend. The fix makes the advance-decision *proactive and window-aware*: size the shared context to the primary backend's declared context window before dispatch, and whenever a backend is skipped — for any reason — say so loudly.

**Problem statement.** Today the assembled review payload (system + whole-file context + diff) is checked only against a fixed 5MB byte threshold, so a payload that fits 5MB but exceeds a backend's token window (measured: 139,633 tokens against a 131,072-token window on the FAFF-1027 build — a 6.5% overage) dispatches, 400s, and falls through to a weaker fallback, visible only in one stderr line on an otherwise-green `pass`. This change sizes the shared context to the primary backend's window and surfaces any primary skip on stdout.

**Design principles.**

- **The whole-file context rule stays intact where it can.** Whole-file context exists for a reason the skill documents: a diff-only view produced confident false criticals, and a more capable model was more wrong for it. Any reduction must preserve enough structure to answer existence/structure claims. This spec reuses the existing FAFF-915 diff-relevance trim (which already preserves structure) rather than inventing a new reducer, and only tightens its target — it never drops to a diff-only view.
- **Deterministic degradation over reactive failure.** A backend skip must be a deliberate, logged decision made before dispatch, not an inference from a provider 400. The token estimate that drives it may be imprecise; the stdout surfacing (below) is the backstop that keeps an imprecise estimate honest.
- **Opt-in and back-compatible.** A backend with no declared context window behaves exactly as today. No existing review changes bytes unless a window is configured for its backend.
- **The trim target is per-lens-invariant.** In the FAFF-903 wire shape the *shared prefix* is the assembled `context + diff` block (byte-identical across the four spec-review lenses) and the per-lens `--system` refute brief is a separate trailing turn. The window-targeted trim operates only on the shared prefix and its byte-target reserves a **fixed** brief allowance (a constant, not the actual per-lens brief length). So the trimmed prefix is a pure function of `(context, diff, target-window)` and stays byte-identical across lenses — the FAFF-903 shared-prefix cache survives. The per-backend fit *guard* (which only decides skips, never prefix bytes) may include the actual brief length in its estimate; a per-lens skip decision never alters the shared prefix.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | Assembles the payload, runs the fallback chain (`runReviewChain`), holds `trimContextFiles` (FAFF-915), `checkPayloadSize` (FAFF-445), the `TRUNCATION_SIGNAL` sentinel, the served-backend header (`attributionHeader`, :580), and the `--backends-json` mapper that reads each chain element's fields (`b.api_key_env`, `b.timeout`, … — and the new `b.context_window`). Primary edit site. |
| `plugin/skills/faff/bin/lib/adversarial-backends.js` | Node CJS | Assembles the emitted fallback chain via `pickBackendKeys`, which copies **only** the fields on the `BACKEND_KEYS` allow-list (~L35) from a `.faffrc` `backends.<name>` entry and **strips any key not on it**. `context_window` MUST be added to this allow-list or it is silently dropped from the chain. |
| `plugin/skills/faff/bin/lib/backends.js` | Node CJS | The shared backend namespace. **Two obligations here, not one.** `BACKEND_RECORD_KEYS` (:28) declares the field set, and `normalizeBackend` (:163) copies every field **explicitly** (`b.timeout = present(raw.timeout) ? … : undefined`). A field added to the declaration but never assigned in `normalizeBackend` is silently dropped on the refs path: the comment at :176 records exactly that bug (FAFF-914 declared `reasoning_extra` without copying it; FAFF-918 fixed it). `resolveBackendRefs` (:274) resolves names only and copies no fields, so it is **not** an edit site. There is no `BACKEND_KEYS` and no `resolveBackend` in this file. |
| `plugin/skills/faff/bin/lib/config.js` | Node CJS | `mergeBackendsNamespace` folds `engines:`/`backends:` at load; a malformed `context_window` is normalised to absent here / at read. |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Markdown | Documents the Backend call, the `--context` rule, and the exit-code table. Prose must reflect the new preflight + surfacing. |
| `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` | Node ESM | Spec-review's four-lens fan-out; already recognises `TRUNCATION_SIGNAL` line-anchored on child stderr. Gains the same recognition for the primary-skip sentinel. |

**Scope statement.** This sits at the review transport layer — between payload assembly and backend dispatch inside a single review call — and touches no verdict semantics, no gate, and no consumer routing beyond making a primary-skip visible.

## 2. OUT OF SCOPE

- **Multi-call decomposition + cross-call aggregation (issue fix-direction 3).** — Splitting a large diff into chunks reviewed independently and merging findings. Why excluded: a materially larger effort (chunk boundary policy, finding de-duplication, per-chunk budget accounting) the issue itself frames as the heavy remedy. It remains the extension for diffs that overrun the primary window **beyond what the FAFF-915 trim can reduce** (a multiple-times-over payload, not the measured 6.5% overage class). Extension point: a new `decomposeAndReview` orchestration wrapping `runReviewChain` in `review-call.mjs`, filed as a follow-up.
- **A general hunk-only context mode replacing whole-file context.** — Why excluded: it re-opens the diff-only-view false-critical regression the whole-file rule prevents. Extension point: `trimContextFiles` options in `review-call.mjs` already parametrise the trim aggressiveness; a future mode lives there.
- **A real tokenizer for exact token counts.** — Why excluded: no local tokenizer exists in-repo and per-provider tokenizers diverge; a conservative byte-ratio estimate plus the surfacing backstop is sufficient for a preflight whose only job is "err toward trimming/skipping earlier." Extension point: `estimateTokens` in `review-call.mjs` is a single pure function a future tokenizer swaps behind.
- **Auto-populating `context_window` for existing configured backends.** — Why excluded: window values are operator knowledge about their own deployments; faff never writes model/eligibility config on the operator's behalf. Extension point: documented in SKILL.md and the `.faffrc` schema; the operator sets it.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Primary backend | The first element of the resolved fallback chain — the strongest configured reviewer, tried first. |
| Usable window | `context_window * DEFAULT_WINDOW_SAFETY` — the token budget the payload is sized/guarded against, leaving headroom for the response and estimate error. |
| Shared prefix | The assembled `context + diff` block (`assembleUserMessage` output), byte-identical across the four spec-review lenses (the FAFF-903 cacheable prefix). |
| Window-targeting | Tightening the FAFF-915 diff-relevance trim of the shared prefix so its estimated tokens plus a fixed brief reserve fit a target usable window. |
| Primary skip | A chain advance past the configured primary backend for any reason (over-window guard, 400, auth, empty, deadline). |

**Config surface (new, optional).** Each `backends.<name>` entry in `.faffrc.yaml` gains one optional field:

```
backends.<name>.context_window: <positive integer, tokens>   # optional; absent ⇒ window-unbounded (today)
```

Read via the existing config resolver; a non-positive or non-numeric value is treated as absent (window-unbounded), never an error — a malformed knob must not break review dispatch.

**Backend record (extended).** The emitted chain record gains one field, `context_window`. It must survive **three** distinct field gates, each of which drops an unlisted/uncopied field silently. Missing any one of them makes the whole guard a no-op, so this is the single most important build detail:

- **`adversarial-backends.js` (:35)** — add `"context_window"` to the `BACKEND_KEYS` allow-list. `pickBackendKeys` (:43) copies only listed keys and strips the rest.
- **`backends.js` (:28)** — add `"context_window"` to `BACKEND_RECORD_KEYS` (note the name: there is no `BACKEND_KEYS` in this file), **and** add the matching explicit assignment in `normalizeBackend` (:163), alongside `b.timeout` / `b.first_byte_timeout`. The declaration alone does not copy the value: `normalizeBackend` assigns field by field, so a declared-but-unassigned field is dropped on the refs path. The in-repo precedent is recorded at `backends.js`:176 (FAFF-914 declared `reasoning_extra` without copying it; a refs-resolved backend silently lost it until FAFF-918).
- Read it in the `review-call.mjs` `--backends-json` mapper as `b.context_window` (mirroring how the mapper already reads `b.api_key_env` / `b.timeout`), exposing it on the in-memory chain element as `contextWindow`.

```
RECORD Backend (chain element, in review-call.mjs):
  ...existing fields (provider, model, host, apiKeyEnv, timeoutMs, ...)
  contextWindow: int | null      # from b.context_window; null when absent/non-positive/non-numeric
```

**Preflight constants (named, in `review-call.mjs`).** New tunables with conservative defaults, named so a later review-bench pass re-tunes them in one place:

```
DEFAULT_BYTES_PER_TOKEN     = 3.0    # conservative divisor: OVER-estimates tokens so the guard trips early, not late.
                                     #   Code averages ~3.5–4 utf8 bytes/token; 3.0 biases the estimate high. Calibrate
                                     #   against a retained FAFF-928 raw body if a byte count for a known token count is to hand.
DEFAULT_WINDOW_SAFETY       = 0.9    # usable fraction of a declared window (response + estimate-error headroom)
DEFAULT_BRIEF_RESERVE_TOKENS = 2000  # fixed token budget reserved for the per-lens --system brief when computing the
                                     #   trim target, so the target never depends on the actual brief length (per-lens
                                     #   invariance). MEASURED 2026-09-14 @ 3.0 B/tok against origin/main 39a3f0bd:
                                     #     refute-infosec.md        4817 B  ~1605 tok   <- binding constraint
                                     #     refute-architectural.md  4630 B  ~1543 tok
                                     #     refute-qa.md             4452 B  ~1484 tok
                                     #     refute-methodology.md    3132 B  ~1044 tok
                                     #     code-review "## Review lens" section
                                     #                              2020 B   ~673 tok
                                     #   2000 clears the 1605 binding constraint with ~25% headroom. (The 1500 the
                                     #   parked draft carried did NOT clear it — infosec and architectural both
                                     #   exceeded it, so the trim target would have under-reserved on two of four lenses.)
```

**Sentinel (new, in `review-call.mjs`).** A machine-only, line-anchored constant mirroring the existing `TRUNCATION_SIGNAL`:

```
PRIMARY_SKIP_SIGNAL = "<<<FAFF-1039 primary-skip>>>"   # emitted on its own stderr line when the primary is skipped;
                                                        # fan-out.mjs recognises it by line-anchored equality
```

**Pure functions (new, in `review-call.mjs`).**

```
estimateTokens(text: string, bytesPerToken: float) -> int
  # ceil( utf8Bytes(text) / bytesPerToken )   # never returns fewer than utf8Bytes/bytesPerToken (conservative)

fitsWindow(estimatedTokens: int, contextWindow: int|null, safety: float) -> bool
  # contextWindow == null  -> true (unbounded)
  # else estimatedTokens <= floor(contextWindow * safety)

trimTargetBytes(contextWindow: int, diff: string) -> int
  # floor(contextWindow * DEFAULT_WINDOW_SAFETY * DEFAULT_BYTES_PER_TOKEN)
  #   - utf8Bytes(diff)
  #   - (DEFAULT_BRIEF_RESERVE_TOKENS * DEFAULT_BYTES_PER_TOKEN)
  # floored at a small positive minimum (never <= 0). Independent of the per-lens --system brief.
```

**Design decision — where the window-targeting trim runs.**
Options: (a) re-trim per backend inside the chain loop; (b) trim the shared prefix once, targeting the primary backend's window. Option (a) recomputes per backend and multiplies trim cost. Option (b) sizes the shared prefix to the strongest reviewer — the availability that matters — and, because the trim target reserves a *fixed* brief allowance (not the per-lens brief), keeps the trimmed shared prefix byte-identical across lenses.
**Chosen:** trim the shared prefix **once**, targeting the primary backend's usable window via `trimTargetBytes` (option b). Per-backend windows are then honoured by a *guard* that skips (loudly) any backend whose usable window the assembled payload still exceeds — the guard never re-trims and never changes the shared prefix.

**Design decision — over- vs under-estimating tokens.**
A tokenizer-free estimate can err either way. Under-estimating re-introduces the silent 400; over-estimating trims/skips slightly more aggressively than strictly necessary.
**Chosen:** bias conservative (over-estimate) via `DEFAULT_BYTES_PER_TOKEN = 3.0` and `DEFAULT_WINDOW_SAFETY = 0.9` — over-trimming yields a marginally smaller context that is surfaced and re-tunable; under-trimming is the exact silent-downgrade bug being fixed.

## 4. HOW — Behavior

**Architecture and approach.** Two composable changes, both inside one review call:

1. **Window-targeted trim of the shared prefix (once, pre-chain).** After reading context + diff, resolve the primary backend's `contextWindow`. If it is set and the whole-file shared prefix's estimated tokens (plus the fixed brief reserve) exceed the usable window, re-run the existing `trimContextFiles` with `thresholdBytes = trimTargetBytes(primaryWindow, diff)`. The result is the single assembled shared prefix for the whole chain.
2. **Per-backend window guard + loud surfacing (in `runReviewChain`).** Before dispatching each chain element, if that element declares a `contextWindow` the estimated payload (shared prefix + this lens's brief) does not fit, advance deliberately with a `[chain] … over-window (est N tok > M usable window) → advancing` note **instead of** dispatching into a 400. Whenever the backend that ultimately serves is not the primary — whether the primary was guard-skipped or fault-advanced — emit `PRIMARY_SKIP_SIGNAL` on stderr and a human notice on stdout, so an operator reading the review is told the primary was skipped and why.

**Behaviour summary.** Size the shared prefix to the strongest reviewer, then let each weaker reviewer be skipped deliberately-and-loudly if it still cannot fit — turning a silent, 400-discovered downgrade into a deterministic, surfaced one, and keeping the strongest reviewer available for any diff the trim can reduce to fit.

**Pseudocode — window-targeted trim (pre-chain, `main`).**

```
PROCEDURE assemble_shared_prefix(diff, contextFilesRaw, chain):
  1. primaryWindow := chain[0].contextWindow            # may be null
  2. { contextFiles } := trimContextFiles(contextFilesRaw, diff,
                                           thresholdBytes = DEFAULT_CONTEXT_TRIM_BYTES)   # FAFF-915, unchanged
  3. prefix := assembleUserMessage(contextFiles, diff)   # the shared context+diff block
  4. IF primaryWindow is null: RETURN prefix            # unbounded primary → today's behaviour
  5. estWithReserve := estimateTokens(prefix, BPT) + DEFAULT_BRIEF_RESERVE_TOKENS
  6. IF estWithReserve <= floor(primaryWindow * SAFETY): RETURN prefix
  7. # over the primary's usable window even after the default trim — tighten toward the window
     { contextFiles } := trimContextFiles(contextFilesRaw, diff,
                                          thresholdBytes = trimTargetBytes(primaryWindow, diff))
     prefix := assembleUserMessage(contextFiles, diff)
     stderr: "FAFF-1039 window-targeted trim: est <estimateTokens(prefix,BPT)> tok + <RESERVE> reserve vs usable <floor(primaryWindow*SAFETY)>"
  8. RETURN prefix       # even if still over: the per-backend guard/surfacing below handles the residual
```

> **Build note (2026-09-14, recorded at review round 4): the trim MECHANISM above was substituted, and this paragraph is the record of it.**
> Step 7's `trimContextFiles(..., thresholdBytes = trimTargetBytes(primaryWindow, diff))` does not reduce anything. `thresholdBytes` is an ON/OFF GATE in `trimContextFiles` (below it the trim is an identity no-op); it is never consulted again, and the aggressiveness lives in `window` / `headLines`. Any payload large enough to overflow a real context window is far above the 48KB default gate, so the default trim has already fired and re-running it at a different threshold returns byte-identical output.
> Field evidence from this ticket's own round-4 adversarial review call: the existing trim reduced a real 281,612-byte payload by **zero bytes**, and the primary was then dropped by an HTTP 400 at 1.5% over its 131,072-token window — the exact shape this ticket exists to fix.
> The build therefore keeps `trimTargetBytes` with its signature and purity intact and adds `tightenToTarget`, a descending ladder over the trim `window` that takes the MINIMUM across rungs (the ladder is not monotonic in bytes: a tighter window can stop a file being head-reduced and enlarge it). Every rung keeps all diff-touched lines, so it never degrades to the diff-only view. `trimTargetBytes` is a budget for everything in the prefix except the diff, and `tightenToTarget` compares against `prefixBytes - diffBytes`; comparing against the full prefix charges the diff twice.
> Every DONE item below is satisfied as written. Only the mechanism moved.

The existing 5MB `checkPayloadSize` preflight runs unchanged after assembly. `trimTargetBytes` depends only on `(primaryWindow, diff)` — never on any lens brief — so the returned prefix is byte-identical across the four lenses of one review.

**Pseudocode — per-backend guard + surfacing (`runReviewChain`).**

```
PROCEDURE dispatch_chain(chain, prefix, lensBrief):
  FOR i, b IN chain:
    est := estimateTokens(prefix, BPT) + estimateTokens(lensBrief, BPT)   # includes this lens's brief
    IF b.contextWindow is set AND NOT fitsWindow(est, b.contextWindow, SAFETY):
      reason := "over-window (est " + est + " tok > " + floor(b.contextWindow*SAFETY) + " usable window)"
      log "[chain] <tag> " + reason + " → advancing (exit 2)"
      capture raw-body stub (chainIndex=i, token="over-window", exit=USAGE)   # FAFF-928 record stays complete
      IF i == 0: firstSkipReason := reason
      CONTINUE                          # deliberate skip, no network call
    result := dispatch(b, prefix, lensBrief)
    IF result is a served verdict:
      IF i > 0:
        reason := firstSkipReason (if the primary was guard-skipped)
                  OR the classified advance reason of the primary's fault-advance (400/auth/empty/deadline)
        result.primarySkipped := { primary: chain[0].tag, servedIndex: i, reason: reason }
      RETURN result
    ELSE:   # fault advance (400/auth/empty/deadline) — behaviour unchanged; record its classified reason
      IF i == 0: firstSkipReason := <the existing "[chain] <tag> <classified-reason>" string for this advance>
  RETURN { exhausted: true, primarySkipped?: (chain[0] was skipped ? { primary, reason: firstSkipReason } : none) }
```

**Surfacing (issue fix-direction 4 — always on).** Whenever the primary is skipped:

- **Served-by-fallback path** (`result.primarySkipped` set) → the review stdout carries a human notice immediately after `findingsHeader`: `NOTE: primary reviewer <primary> was skipped; served by chain[<i>] — <reason>.`, and `PRIMARY_SKIP_SIGNAL` is written on its own stderr line.
- **Exhausted-chain path** (no backend served; existing exit-2 / needs-human terminal) → there is no served stdout, so the primary-skip is surfaced on stderr (`PRIMARY_SKIP_SIGNAL` line + the human reason) and included in the terminal's needs-human diagnostic. The exit code and terminal disposition are unchanged.
- **`fan-out.mjs`** recognises `PRIMARY_SKIP_SIGNAL` by line-anchored equality on the child's stderr (exactly as it already recognises `TRUNCATION_SIGNAL`) and sets `primarySkipped: true` on that `LensResult`, so a spec-review or code-review consumer reports "served by a fallback" in its summary. Using a dedicated sentinel — not the human prose — means untrusted diff/context echoed into findings cannot forge the signal.

**Edge cases and error handling.**

- **No window configured on any backend** → both changes are inert; assembled bytes and served-backend selection are byte-for-byte today (the opt-in guarantee).
- **Primary has no window but a fallback does** → step 4 returns the untrimmed prefix; the per-backend guard still applies to the fallback that declares a window.
- **Even the tightened trim can't fit the primary's window** → the prefix is still assembled and dispatched; the primary is then guard-skipped or 400s, and the primary-skip is surfaced. The review is never blocked by an inability to fit — the existing chain-exhaustion / needs-human terminal (exit 2) governs the fully-over-window case, with the skip now surfaced.
- **Malformed `context_window`** (non-positive, non-numeric) → `contextWindow` is `null`; identical behaviour to an absent window (no error, no dispatch block).

**Failure modes.**

- **The failure:** the byte-per-token estimate is systematically wrong for a corpus, so the guard skips a backend that would have fit (over-trim) or dispatches one that 400s (under-trim). **How you'd know:** an over-trim shows the `window-targeted trim` stderr note plus a smaller served context; an under-trim shows the old HTTP-400 `request-failed` chain note **now followed by** the surfaced primary-skip. **What it means:** proceed — both directions are visible, and `DEFAULT_BYTES_PER_TOKEN` is a one-line re-tune. The estimate need only be approximately right because the surfacing backstops it.
- **The failure:** a future change moves the trim into the per-backend loop or makes `trimTargetBytes` depend on the lens brief, silently breaking the FAFF-903 shared-prefix identity. **How you'd know:** the four spec-review lenses of one over-window review stop sharing a byte-identical prefix — the golden-prefix test (DONE, below) fails, and cache-miss rate jumps on serialising local backends. **What it means:** that test failing is the signal the per-lens-invariance principle was violated; keep the trim once, pre-chain, brief-independent.

**Anti-pattern:** trimming to a diff-only view to force a fit. Why: it re-introduces the confident-false-critical regression the whole-file rule exists to prevent; the trim must retain windowed structure or the backend is skipped instead.
**Anti-pattern:** deriving the trim target from the actual per-lens `--system` brief. Why: it makes the shared prefix differ per lens and kills the FAFF-903 cache; reserve the fixed `DEFAULT_BRIEF_RESERVE_TOKENS` instead.
**Anti-pattern:** recognising the primary-skip via the human notice prose. Why: untrusted diff/context echoed into findings could forge it; anchor on `PRIMARY_SKIP_SIGNAL`.
**Anti-pattern:** wiring `context_window` at only some of its three field gates. Why: each gate drops an unlisted or uncopied field **silently**, so the mapper never sees the value and the guard no-ops with no error anywhere. Wire `adversarial-backends.js`'s `BACKEND_KEYS` (:35), `backends.js`'s `BACKEND_RECORD_KEYS` (:28) **and** the explicit `normalizeBackend` assignment (:163) first, then the mapper. The declaration-without-assignment half is the one with in-repo precedent (`backends.js`:176).

## 5. Scenarios

```
Given a primary backend declaring context_window: W and a fixture whose whole-file shared prefix,
  after the default FAFF-915 trim, still estimates above floor(W*0.9) − reserve,
  but whose diff-relevance trim floor is BELOW floor(W*0.9) − reserve (reduction is achievable by construction)
When the review runs
Then the window-targeted trim fires (the "FAFF-1039 window-targeted trim" stderr note is emitted)
  and the resulting estimated payload fits floor(W*0.9)
  and the primary backend serves the review (no over-window advance, no HTTP 400)
```

```
Given a fixture whose shared prefix cannot be reduced below floor(W*0.9) − reserve even at the trim floor
When the review runs
Then the primary is advanced past with a "[chain] … over-window … → advancing" note before any network call
  and PRIMARY_SKIP_SIGNAL is emitted on its own stderr line
  and the served result carries the stdout "primary reviewer … was skipped" notice (or, if the chain exhausts,
      the primary-skip is surfaced on stderr and in the needs-human terminal)
```

```
Given a primary with NO context_window and a fallback declaring context_window smaller than the payload
When the review runs
Then the pre-chain trim does not fire (primary unbounded)
  and the fallback is guard-skipped with the over-window note before dispatch
  and a later backend serves (verifying the guard applies to non-primary chain elements — DONE 6)
```

```
Given a set of backends none of which declare context_window
When the review runs
Then the assembled shared prefix bytes and the served backend are byte-for-byte identical to the committed
  no-window golden payload (the FAFF-903/FAFF-915 golden fixtures)
```

- The trimmed shared prefix MUST be byte-identical across the four lenses of one over-window review (per-lens invariance).
- A malformed `context_window` (non-positive/non-numeric) MUST produce behaviour byte-identical to an absent one.
- `estimateTokens(text)` MUST NOT return fewer than `utf8Bytes(text) / DEFAULT_BYTES_PER_TOKEN`.

## 6. Design Decision Rationale

**Which of the issue's four fix directions to implement?**
- Options: (1) per-backend window preflight; (2) hunk-scoped context; (3) decompose + aggregate; (4) surface the downgrade. The issue marks (4) worth doing regardless and leaves 1–3 undecided.
- **Chosen:** implement (1) + (4), reusing the already-shipped FAFF-915 trim as the (2)-flavoured reducer, and defer (3) to diffs that overrun beyond the trim floor. Rationale: (1)+(4) restore the primary for any diff the trim can reduce to fit (the measured 6.5%-overage class) and make every residual skip loud; (3) is the heavy remedy the issue itself defers, needed only for payloads that overrun by multiples.

**Trim once (size-to-primary) vs re-trim per backend?**
- Options: per-backend re-trim (honours every window exactly) vs one trim targeting the primary.
- **Chosen:** one trim of the shared prefix targeting the primary's usable window, with a *fixed* brief reserve so the trimmed prefix is per-lens-invariant; weaker backends honoured by a skip-guard. Rationale: preserves the FAFF-903 shared-prefix cache across the four lenses, sizes to the strongest reviewer, and avoids multiplying trim cost. At the time of writing the primary is also the largest-window backend in the shipped chains, so a fallback rarely needs a smaller payload than the primary.

**Token estimation without a tokenizer?**
- Options: exact per-provider tokenizer (none in-repo, divergent) vs conservative byte-ratio estimate.
- **Chosen:** conservative byte-ratio estimate (`DEFAULT_BYTES_PER_TOKEN = 3.0`, `DEFAULT_WINDOW_SAFETY = 0.9`), swappable behind `estimateTokens`. Rationale: a preflight only needs to err toward earlier trimming/skipping; the surfacing backstops estimate error; the divisor is a one-line re-tune, calibratable against a retained FAFF-928 raw body.

**Config field vs hardcoded per-model window table?**
- Options: a hardcoded model→window map vs an operator-declared per-backend `context_window`.
- **Chosen:** operator-declared `context_window`, absent ⇒ unbounded (today). Rationale: windows are deployment knowledge (a self-hosted model's served window differs from the base model's), a hardcoded table drifts, and opt-in keeps every un-annotated backend byte-for-byte unchanged.

**How is the primary-skip signalled to the fan-out consumer?**
- Options: reuse the human notice prose vs a dedicated machine sentinel.
- **Chosen:** a dedicated `PRIMARY_SKIP_SIGNAL` on its own stderr line, recognised by line-anchored equality, exactly like `TRUNCATION_SIGNAL`. Rationale: untrusted diff/context echoed into findings could forge a prose line; a fixed sentinel cannot be forged by review content. (Note the round-2 infosec refinement: also ensure no other stderr path echoes untrusted payload content verbatim, so the sentinel line stays unforgeable in practice.)

## 7. Open Questions and Assumptions

**Open Questions.** None — all decisions above are closed.

**Assumptions.**

- **Assumes:** `trimContextFiles` and `checkPayloadSize` exist and are pure functions of `(context, diff[, thresholdBytes])` in `review-call.mjs`, and `trimContextFiles` accepts a caller-supplied `thresholdBytes`. Validation: confirmed on origin/main 2026-09-14 (`trimContextFiles` at review-call.mjs:354 takes `thresholdBytes`, default `DEFAULT_CONTEXT_TRIM_BYTES`; `checkPayloadSize` at :121, wired at the `main` assembly seam ~:1870); the build agent re-reads these before editing.
- **Assumes:** the shared context+diff block is placed in the cacheable prefix (system) slot and the per-lens brief in the trailing user turn (FAFF-903), so trimming the shared prefix independently of the brief preserves cross-lens byte-identity. Validation: confirmed at the FAFF-903 wire-reorder seam in `review-call.mjs`.
- **Assumes:** `TRUNCATION_SIGNAL` is emitted on its own stderr line and recognised line-anchored by `fan-out.mjs`, so the same mechanism serves `PRIMARY_SKIP_SIGNAL`. Validation: confirmed — `review-call.mjs` emits `TRUNCATION_SIGNAL`; `fan-out.mjs` matches it by line-anchored equality (fan-out.mjs:43).
- **Assumes:** (RE-CORRECTED 2026-09-14 — the previous correction was also wrong, in the same place) the `.faffrc` `backends.<name>` → emitted-chain-record mapping passes three field gates: `BACKEND_KEYS` in `adversarial-backends.js` (:35, `pickBackendKeys` at :43 strips unlisted keys), `BACKEND_RECORD_KEYS` in `backends.js` (:28), and the **explicit per-field assignment** in `normalizeBackend` (`backends.js`:163), which is what actually copies a value on the refs path. `context_window` must be wired at all three, then read in the `review-call.mjs` `--backends-json` mapper as `b.context_window`. And `runReviewChain` (`review-call.mjs`:1587) iterates chain elements in order with the primary at index 0, emitting `[chain] … → advancing` notes and capturing per-round raw bodies. Validation: re-confirmed against `origin/main` at `39a3f0bd` on 2026-09-14 by direct read. **Two symbols the prior draft asserted do not exist:** there is no `BACKEND_KEYS` in `backends.js` (it is `BACKEND_RECORD_KEYS`), and there is no `resolveBackend` anywhere (it is `resolveBackendRefs`, `backends.js`:274, which resolves names only and copies no fields, so it is not an edit site). The earlier draft's `config.js` ~L401 `resolveBackend` was likewise absent. Treat every symbol/line citation in this spec as re-checkable, not as established.
- **Assumes:** (DISCHARGED 2026-09-14 — was an open build-time check) `DEFAULT_BRIEF_RESERVE_TOKENS` must be ≥ the largest `--system` brief's token estimate. Measured against `origin/main` 39a3f0bd at 3.0 B/tok: largest is `refute-infosec.md` at ~1605 tok (then architectural ~1543, qa ~1484, methodology ~1044, code-review lens section ~673). The draft's 1500 **failed** this check on two of four lenses; the constant is raised to **2000** and the measurement table is inlined at the constant. Re-measure only if a refute brief grows materially.

## 8. DONE — Definition of Done

### From WHY
- [ ] For a fixture whose shared prefix is reducible below the primary's usable window by the FAFF-915 trim, the primary backend serves the review after the window-targeted trim fires (no over-window advance, no HTTP 400) — the FAFF-1027-class overage is served by the primary.

### From WHAT (config + types)
- [ ] `backends.<name>.context_window` is read from `.faffrc`; a positive integer sets the chain element's `contextWindow`, and absent/non-positive/non-numeric yields `null`.
- [ ] `context_window` is wired at all **three** field gates — `BACKEND_KEYS` in `adversarial-backends.js` (:35), `BACKEND_RECORD_KEYS` in `backends.js` (:28), and an explicit `b.context_window = …` assignment in `normalizeBackend` (`backends.js`:163) — and read in the `review-call.mjs` `--backends-json` mapper as `b.context_window`; chain elements carry `contextWindow` into `runReviewChain`. Decided by a test that resolves a backend **through the refs path** (a `backends.<name>` reference, not an inline array) and asserts `contextWindow` survives onto the chain element: that is the path the declaration-without-assignment bug breaks.
- [ ] `estimateTokens`, `fitsWindow`, and `trimTargetBytes` exist as pure functions with the specified signatures; `estimateTokens` never returns fewer than `utf8Bytes/DEFAULT_BYTES_PER_TOKEN`; `trimTargetBytes` depends only on `(contextWindow, diff)`, never on any lens brief.
- [ ] `PRIMARY_SKIP_SIGNAL` and `DEFAULT_BRIEF_RESERVE_TOKENS` exist as named constants, the reserve being **2000** per the measurement inlined at the constant (≥ the ~1605-tok binding constraint, `refute-infosec.md`).

### From HOW (behaviour)
- [ ] The context trim is applied once, pre-chain, using `trimTargetBytes(primaryWindow, diff)`, only when the primary window is set and the whole-file prefix (plus reserve) exceeds it.
- [ ] Each chain element declaring a `context_window` the estimated payload does not fit is advanced past with a `[chain] … over-window (est N tok > M usable window) → advancing` note before any network call.
- [ ] Whenever a non-primary backend serves, a stdout notice names the skipped primary, the served chain index, and the reason; the reason is the over-window string for a guard-skip and the existing classified advance reason (400/auth/empty/deadline) for a fault-advance.
- [ ] `PRIMARY_SKIP_SIGNAL` is emitted line-anchored on stderr on every primary skip, and `fan-out.mjs` sets `primarySkipped: true` on the affected `LensResult` by line-anchored recognition.

### From HOW (edge cases)
- [ ] With no backend declaring a `context_window`, the assembled shared prefix bytes and served-backend selection are byte-identical to the committed no-window golden fixture.
- [ ] The trimmed shared prefix is byte-identical across the four spec-review lenses of one over-window review (per-lens invariance test).
- [ ] A malformed `context_window` behaves byte-identically to an absent one (no error, no dispatch block).
- [ ] A payload that cannot fit any window runs the chain to its existing exhaustion/needs-human terminal (exit 2 unchanged), with the primary-skip surfaced on stderr and in the terminal diagnostic.

### From SKILL.md
- [ ] `plugin/skills/faffter-dark-adversarial-review/SKILL.md` Backend call section documents the optional `context_window`, the window-targeted trim, the deterministic over-window advance, the fixed brief reserve, and the `PRIMARY_SKIP_SIGNAL` surfacing; the exit-2 description notes the deliberate over-window skip.

**Integration smoke test.** Three fixtures, each asserting one branch (no OR escape):

```
PROCEDURE smoke():
  # Fixture A — trim-restores-primary
  1. Two-backend chain: primary context_window = W_small chosen so the whole-file context overflows
     floor(W_small*0.9) but the FAFF-915 trim floor for this fixture is below it; fallback larger/absent.
  2. Run review-call.mjs; assert the "FAFF-1039 window-targeted trim" stderr note fired AND the served
     header names the PRIMARY (chain[0]) AND no PRIMARY_SKIP_SIGNAL was emitted.
  # Fixture B — over-even-trimmed
  3. Primary context_window = W_tiny below the trim floor for the fixture; fallback larger/absent.
  4. Run review-call.mjs; assert the "over-window → advancing" note fired before dispatch AND
     PRIMARY_SKIP_SIGNAL is on its own stderr line AND the stdout primary-skip notice is present.
  # Fixture C — back-compat
  5. Remove context_window from both backends; assert the assembled shared prefix equals the committed
     no-window golden payload byte-for-byte AND the served backend is unchanged.
```

confidence: high
build-tier: complex
spec-review: approve (human-adjudicated at interactive unpark, 2026-09-13 — see the `## Decisions-register intent` ruling: the QA lens's demand for a 1:1 scenario per DONE item is taste-level, not a defect, so the grouped fixtures A/B/C + 4 scenarios + 3 MUST invariants stand; the size-to-primary trim approach is confirmed to build; the round-1→2 infosec/minor stands on its own and is handled by the spec's unforgeable-sentinel build-time check).

---

> **Prep note (interactive re-prep, 2026-09-14):** UNPARKED and promoted to Todo. The prior autonomous park (run-20260913-134745-fly-l3) was a spec-review non-convergence — the QA lens escalated round-1→round-2 demanding a 1:1 born-verifiable scenario per DONE item. The operator adjudicated that in the `## Decisions-register intent` comment (2026-09-13): decidable-but-grouped coverage satisfies the born-verifiable bar, so those objections are taste-level and the spec's existing coverage stands; the size-to-primary approach is confirmed. Round 1's two architectural majors were already fixed in this spec (fixed brief reserve + `trimTargetBytes`, `PRIMARY_SKIP_SIGNAL` sentinel). One freshness correction applied on re-prep: the config-threading half wrongly named `resolveBackend` in `config.js` (~L401) as the edit site — corrected throughout (Reference context, Backend record, Assumes, DONE) to the real seam, the `BACKEND_KEYS` allow-list in `backends.js`/`adversarial-backends.js` (`pickBackendKeys` strips unlisted keys) + the `review-call.mjs --backends-json` mapper. Design unchanged; ready to build.

> **Prep note (interactive re-prep, 2026-09-14, second pass — supersedes the note above on one point):** Re-validated against `origin/main` at `39a3f0bd` by direct read. The thread is absorbed and the design is unchanged, but the note above claims the config-threading half was "corrected throughout ... to the real seam, the `BACKEND_KEYS` allow-list in `backends.js`/`adversarial-backends.js`". **That correction was itself wrong**, and in the same place as the one before it: `backends.js` has no `BACKEND_KEYS` (it is `BACKEND_RECORD_KEYS`, :28) and no `resolveBackend` (it is `resolveBackendRefs`, :274, which copies no fields and is not an edit site). More importantly, both drafts missed the gate that actually copies the value, `normalizeBackend`'s explicit per-field assignment (`backends.js`:163) — the precise trap `backends.js`:176 records having already caught FAFF-914 once. The threading half is now stated as three field gates with a refs-path test that decides it. Separately, the open build-time check on `DEFAULT_BRIEF_RESERVE_TOKENS` is **discharged by measurement**: the drafted 1500 failed on two of four lenses (`refute-infosec.md` ~1605 tok, `refute-architectural.md` ~1543), so the constant is 2000 with the measurement table inlined. Also `findingsHeader` corrected to `attributionHeader` (:580). The FAFF-903 per-lens-invariance assumption re-verified at the `sharedBlock`/`lensBrief` swap (`review-call.mjs`:1897). Approach, decisions, scenarios and every other DONE item unchanged; the human-adjudicated `spec-review: approve` stands, since nothing here touches the approach it ruled on. **Standing caution for the build agent:** this spec's symbol and line citations have now been wrong twice in the same region. Re-read each seam before editing rather than trusting the citation.
