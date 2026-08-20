# FAFF-886 — Pin the spec-review reviewer across the rounds of one spec's loop

> Spec: faffter-dark-nlspec · 2026-08-19 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-886.
> build-tier: complex
> Revised 2026-08-19 (r1) — folded QA-lens findings: multi-server round-1 + config-edited-mid-loop scenarios, tightened scenario 1, replaced untestable "byte-identical" DONE with a concrete diff + a check that the occupant actually calls `spec-review-pin`.
> Revised 2026-08-19 (r2) — folded a second QA-lens round: scoped the prose-presence lint to the chain-assembly bash block (was un-lintable as "on that path"); added the DONE item requiring prep to point the convergence/churn CLI calls at the resolved scratch dir (the real interactive-wiring gap); added the nothing-served-round-1 scenario + test; disambiguated scenario 1's terminal state + added an end-to-end convergence oracle.
> Revised 2026-08-19 (r3, operator steer) — pinned-backend-down policy changed from strict-park to **prefer-with-fallback** (pin-first chain `[pin, …rest]`; an unavailable pin round falls back to the tail and the loop resets the convergence window at the swap), so rate-limiting never hard-parks. Dropped the config-knob idea (prefer-with-fallback dominates strict and off, so a knob is pure maintenance surface). Resolves the former pinned-down Punt; adds a swap-round window-reset mechanism + the sustained-flapping failure mode.
> Note: across both review passes the architectural + infosec lenses could not produce findings on the configured backend (429/403, then empty-content on GLM-5.2), so the adversarial gate ran QA-only and never reached a clean multi-lens verdict; the pin *approach* itself drew no objection across two QA rounds.

This spec is for the build agent implementing FAFF-886, and for the human reviewers gating it. It describes how to stop the L4 adversarial spec-review loop from silently swapping the serving backend between rounds, which today makes a genuinely-converging spec read as churn and false-park.

## 1. WHY — Problem and Principles

**The load-bearing model.** The prep↔review loop grants or denies the next round from a *trend over per-round objection records* (`detectSpecReviewConvergence`, `detectSpecReviewChurn`). That trend is only meaningful if the **same reviewer** produces every round. Today nothing enforces that: the reviewer identity is an unstated assumption of the trend, not a guaranteed property of the loop. This change makes reviewer identity a guaranteed property — pin the backend that opened a spec's review loop and hold it for the loop's duration — so the trend the detectors measure is a real convergence signal, not backend noise.

**Problem statement.** The L4 adversarial `spec_review` occupant re-assembles its primary-first fallback chain and walks it from index 0 on every round, so a primary that flaps (429 / timeout on a later round) silently promotes a different model whose fresh objections read to convergence as a count-bump and to churn as a new objecting lens. The loop-cap then force-parks a spec that was actually converging. This change pins the round-1 serving backend for the rest of that spec's loop — the pinned reviewer is preferred every round, and a later flap falls back to another backend but is *detected* (a swap round → the loop resets the convergence window) instead of masquerading as churn. So the common case is a stable reviewer, and a genuine outage degrades gracefully rather than false-parking.

**Design principles.**

- **Fix the cause upstream, leave the detectors pure.** The convergence and churn comparators carry an explicit "NO schema change" commitment (`spec-review-convergence.js:16`) and are reviewer-blind by design. Pinning the reviewer neutralises the drift *before* it reaches them, so neither comparator nor the round-record schema changes. Do not teach the detectors about backends.
- **Deterministic tools over prose.** The pin lifecycle (resolve / capture) is a tested CLI, not loop prose — same input, same chain out. The occupant SKILL calls the tool; it does not hand-roll pin logic.
- **Never swap *silently*.** A pin exists to remove the loop's freedom to change reviewer *unnoticed* — the exact bug is a fall-through the trend-detectors can't see. A swap is allowed when it is *detected and handled*: a pin-unavailable round may fall back to another backend, but the loop marks that as a swap round and resets the convergence window so it is never mistaken for churn. A malformed pin (a plumbing fault, not an availability event) still resolves toward fail-loud/park, never a silent bare-chain.
- **Additive only.** The pin is out-of-band state beside the round records. Round-record JSON, the `spec-review-verdict` contract schema, and the two detectors are untouched.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/adversarial-backends.js` | Node (CLI lib) | `assembleAdversarialBackends(cfg, consumer)` — the chain the pin resolver wraps |
| `plugin/skills/faff/bin/lib/spec-review-convergence.js` | Node (CLI lib) | reviewer-blind convergence comparator — **untouched**; the beneficiary |
| `plugin/skills/faff/bin/lib/spec-review-churn.js` | Node (CLI lib) | reviewer-blind churn comparator — **untouched**; also benefits |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node (CLI lib) | `resolveRunDir` — precedent for the scratch-dir resolver |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (mjs) | serves the chain; `--run-dir`-wins-over-`$FAFF_RUN_DIR` precedent; emits the served-backend header |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | prose (occupant) | per-round reviewer; captures + honours the pin |
| `plugin/skills/faff-prep/SKILL.md` | prose (loop driver) | owns round numbering + the scratch dir; passes the pin-dir |

**Scope statement.** This sits at the spec stage of the delivery loop, inside the L4 adversarial `spec_review` occupant's per-round dispatch and the prep loop that drives it — nowhere else.

## 2. OUT OF SCOPE

- **The single-pass default occupant (`faffter-noon-spec-review`).** — Excluded because it never calls `review-call.mjs` and has no fallback chain, so no backend can drift. Extension point: none needed; the pin is inert for it (prep passes a pin-dir, the default occupant simply never captures or resolves one).
- **Making the detectors reviewer-aware (option B).** — Excluded because pinning the reviewer removes the drift the detectors would otherwise need to reason about; teaching them backends would duplicate the fix and force the schema change the "NO schema change" commitment forbids. Extension point: `spec-review-convergence.js` / `spec-review-churn.js` would gain a per-round identity input only if a future design deliberately allows mid-loop reviewer changes.
- **Recording served-backend identity inside the round record.** — Excluded because the round record mirrors the fixed `spec-review-verdict` contract (`additionalProperties:false`) and carrying identity there is a schema change. Extension point: the pin sidecar (`pinned-reviewer.json`) is the out-of-band home for reviewer identity.
- **An operator on/off (or `strict|prefer|off`) config knob for pinning.** — Excluded: prefer-with-fallback is a strictly-better default than strict (never hard-parks on a transient outage) and than off (holds the reviewer whenever reachable), so a knob would expose no useful operating point — it would be pure config-maintenance surface (faff tenet: sensible default over a knob). Extension point: if a future need for a hard strict-park at L4 emerges, it re-enters as a level-gated policy, not a free-form knob.
- **Cross-spec / cross-run pin reuse.** — Excluded: a pin is scoped to one spec's loop (one scratch dir) and never shared between specs or runs. Extension point: none — this is a hard boundary, not a deferral.
- **Round-1 within-round fallback behaviour.** — Unchanged: round 1 walks the full primary-first chain exactly as today. The pin only constrains rounds ≥ 2.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| serving backend | the chain element that actually returned findings for a lens this round (the `chain[<i>]` named in `review-call.mjs`'s header), as opposed to the configured primary |
| pin | the single backend object held for the duration of one spec's review loop, stored in `pinned-reviewer.json` |
| scratch dir | the per-spec, per-loop directory holding the round records and the pin (`<run-dir>/<ISSUE>/spec-review` autonomous; `.faff/spec-review/<ISSUE>` interactive) |
| round 1 | the first review round of a spec's loop — the round that establishes the pin |

**Type definitions.**

```
RECORD PinnedReviewer:              # pinned-reviewer.json — the out-of-band pin sidecar
  provider: String                  # from chain[winnerIndex]
  model: String
  host: String
  api_key_env: String?              # optional keys carried verbatim from the captured chain element
  seat_token_env: String?
  auth: String?
  reasoning_off: Bool?
  timeout: Int?
  # Shape is exactly one element of the `--backends-json` array review-call.mjs already consumes,
  # so a pinned chain is `[PinnedReviewer]` verbatim — no re-derivation, robust to a mid-loop config edit.
```

```
RECORD PinResolveResult:            # `faff spec-review-pin --resolve` stdout
  chain: List<Backend>              # [pin, ...rest] when pinned (pin first, fallback tail); the full assembled chain when unpinned
  pinned: Bool                      # true iff a pin file was present and used
```

**New / changed CLI surface.**

```
INTERFACE faff spec-review-pin --resolve --dir <scratch> --consumer <name> [--root DIR]
  # Single behaviour, no config knob: prefer the pinned backend, fall back to the rest of the chain if it is
  # unavailable. If <scratch>/pinned-reviewer.json is present and parses → return the pinned backend FIRST
  #   with the rest of the assembled chain behind it: { chain:[pin, ...rest-of-assembled-chain-minus-pin],
  #   pinned:true }. review-call.mjs walks it pin-first, so the pinned reviewer serves every round it is up,
  #   and a rate-limited/unavailable pin round FALLS BACK to the rest of the chain instead of hard-parking.
  # Else (no pin file — round 1) → run assembleAdversarialBackends(cfg, consumer), print { chain:<full>,
  #   pinned:false }, exit 0.
  # assembleAdversarialBackends error passthrough: unset → exit 3, malformed config → exit 2 (parity with
  #   `faff adversarial-backends`, so the occupant's existing exit-3/2 handling is unchanged on the unpinned path).
  # A present-but-malformed pinned-reviewer.json → exit 2 (fail-loud plumbing breakage; NEVER silently a bare
  #   full chain — a broken pin is a plumbing fault, not a licence to drop the pin).
  # The pin is FIRST, never sole: dropping the fallback tail (a single-element [pin]) is the rejected
  #   strict-park design — see Design decisions. de-dup the pin out of `rest` so it is not tried twice.

INTERFACE faff spec-review-pin --capture --dir <scratch> --backends-json <file> --winner-index <i>
  # Idempotent first-write: if <scratch>/pinned-reviewer.json is ABSENT, write chain[i] from the backends-json
  #   file as the pin, exit 0. If it already exists, no-op, exit 0 (round ≥ 2 never overwrites round 1's pin).
  # An out-of-range <i>, unreadable backends-json, or non-array chain → exit 2 (fail-loud).

INTERFACE faff spec-review-dir --issue <ISSUE-XX> [--run-dir <dir>]
  # Print the per-spec scratch dir, resolving the mode once:
  #   run-dir resolvable (flag, else $FAFF_RUN_DIR) → <run-dir>/<ISSUE>/spec-review
  #   otherwise (interactive, no run-dir)           → .faff/spec-review/<ISSUE>
  # --run-dir (explicit) wins over $FAFF_RUN_DIR (ambient), mirroring review-call.mjs's precedent. Does NOT
  #   create the dir (callers create on first write); pure path computation, exit 0. Both round records and
  #   the pin resolve their home through this one command so the two modes never disagree.
```

**Design decision — mechanism (pin vs reviewer-aware detectors).** Option A pins the round-1 serving backend so the same reviewer judges every round; option B leaves the reviewer free to drift and teaches the detectors to recognise a swap. A is smaller (touches the occupant + a new CLI, not the detectors), roots out the cause rather than compensating for it, needs no schema change, and keeps the two pure comparators pure; B needs served-identity in the round record (a schema change against the standing commitment) and duplicates convergence logic across two detectors.

**Chosen:** Option A — pin the round-1 serving backend for the loop's duration. Rationale: root-cause, additive, leaves the detectors and the contract schema untouched.

**Design decision — pin read/write locus.** The pin resolution could live as prose in the occupant SKILL, or as a deterministic CLI the occupant calls. Prose is smaller but untested and re-drifts; a CLI is testable and matches the "deterministic tools over prose" tenet.

**Chosen:** a new `spec-review-pin.js` CLI lib (`--resolve` / `--capture`), plus a `spec-review-dir` resolver. The occupant calls them; the loop-cap detectors are not involved. Rationale: the pin is mechanical and must be reproducible and unit-testable.

**Design decision — which backend is pinned when round 1 serves more than one.** Concurrent lens fan-out can, if the primary flaps mid-round, have different lenses served by different chain indices in round 1. Candidates: pin the modal server, pin per-lens, or pin the lowest chain index that served any lens.

**Chosen:** pin the **lowest `chain[<i>]` index** that served any lens in round 1 (the strongest reviewer that was actually reachable). Rationale: subsequent rounds should hold the reviewer at least as strong as round 1's best; a single scalar pin keeps the sidecar and the resolver simple; per-lens pinning would multiply state for a rare within-round split.

**Design decision — pinned backend unavailable on a later round.** Three options: (a) **strict** — emit a single-element `[pin]` chain, so an outage exhausts the chain → transport floor → park; (b) **prefer-with-fallback** — emit `[pin, …rest]`, so the pinned reviewer serves every round it is up and a rate-limited pin round falls back to the rest of the chain rather than parking; (c) a **config knob** offering both. Strict never hard-parks a *good* spec, but under real rate-limiting (this ticket's own prep hit a 429/403/empty-content chain four times) a strict pin turns every transient backend blip into a park — pinning gets in the way exactly when the backends are flaky. A config knob is another surface to maintain for a choice with one clearly-better default.

**Chosen:** prefer-with-fallback, **no config knob** — the pinned backend is preferred every round but the round falls back to the rest of the chain when the pin is unavailable, so rate-limiting never hard-parks. On a genuine fallback the reviewer *did* change for that round (a **swap round**), so the **loop resets the convergence window** at the swap — it compares only within one reviewer's runs, so a forced fallback is never mistaken for churn. This keeps the fix's value (the pinned reviewer serves whenever it can, so the common case is single-reviewer) while getting out of the way when the backend is down. Rationale for no knob: prefer-with-fallback strictly dominates strict for availability and dominates off for reviewer-stability; there is no operating point a knob would usefully expose, and the config would be pure maintenance overhead (faff tenet: sensible default over a knob). Detecting the swap is a read of the served header the occupant already parses; the window reset is a loop-level action, so the reviewer-blind detectors stay untouched. *(Rejected: strict single-element park — too eager under rate-limiting; a `strict|prefer|off` knob — redundant once prefer-with-fallback exists.)*

## 4. HOW — Behavior

**Architecture and approach.** The loop driver (prep) resolves one scratch dir per spec and passes it to the occupant every round. The occupant resolves its chain *through the pin* instead of straight from `adversarial-backends`: round 1 finds no pin and gets the full chain (byte-identical to today), then captures the round-1 winner as the pin; rounds ≥ 2 find the pin and get a **pin-first chain `[pin, …rest]`**, so the pinned reviewer serves every round it is reachable and a rate-limited pin round falls back to the rest of the chain instead of parking. When a round is served by the pin (the common case) the detectors see a single reviewer across rounds, exactly as intended; when a round genuinely falls back to a different backend (a **swap round**, detected from the served header), the loop **resets the convergence window** so the swap is never read as churn. The detectors read the same round records as before and stay reviewer-blind — the swap handling is entirely in the loop.

**Behavior summary — resolve the chain (occupant, every round).** Replace the direct `faff adversarial-backends --consumer spec_review` call with a pin-aware resolve; everything downstream (fan-out, per-lens outcome table, aggregation) is unchanged.

```
PROCEDURE resolve_backends(pin_dir):
  1. run: faff spec-review-pin --resolve --dir <pin_dir> --consumer spec_review
  2. exit 0 → backends_json := result.chain           # [pin, ...rest] if pinned:true, else the full chain
     exit 3 → unconfigured  → every lens unavailable/config-fault (UNCHANGED existing handling)
     exit 2 → malformed     → every lens unavailable/config-fault (UNCHANGED existing handling)
  3. fan out the enabled lenses over backends_json exactly as today
```

**Behavior summary — capture the pin (occupant, after aggregation, round 1 only in effect).** Idempotency makes this safe to run every round; it writes only when no pin exists yet.

```
PROCEDURE capture_pin(pin_dir, backends_json, lens_results):
  1. served := lens_results where exit == 0                      # lenses that actually got findings
  2. IF served is empty: RETURN                                  # nothing served → no winner to pin (round parks/needs-human anyway)
  3. FOR each served lens: parse `chain[<i>]` from the first line of its stdout header  # "## Adversarial findings — p/m (chain[<i>], host: <src>)"
  4. winner_index := min(i over served)                          # lowest chain index that served any lens
  5. run: faff spec-review-pin --capture --dir <pin_dir> --backends-json <backends_json file> --winner-index <winner_index>
     # idempotent: no-op if a pin already exists (rounds ≥ 2), writes chain[winner_index] on round 1
```

**Behavior summary — resolver internals (`spec-review-pin.js`).**

```
FUNCTION resolveChain(cfg, scratch_dir, consumer):
  pin_path := scratch_dir + "/pinned-reviewer.json"
  res := assembleAdversarialBackends(cfg, consumer)              # always assembled — the fallback tail
  IF res.error == "unset"     ⇒ EXIT 3   # passthrough, occupant handles as today
  IF res.error == "malformed" ⇒ EXIT 2   # passthrough
  IF pin_path exists:
    parse it → malformed ⇒ EXIT 2 (fail-loud, never a bare full chain)   # a broken pin is a plumbing fault
    rest := res.chain with any element equal to pin removed    # de-dup so the pin isn't tried twice
    RETURN { chain: [pin, ...rest], pinned: true }             # pin FIRST, fallback tail behind it
  RETURN { chain: res.chain, pinned: false }                   # round 1 / unpinned: full chain unchanged

FUNCTION capturePin(scratch_dir, chain, winner_index):
  pin_path := scratch_dir + "/pinned-reviewer.json"
  IF pin_path exists: RETURN                                     # idempotent first-write
  IF winner_index out of range of chain OR chain not an array ⇒ EXIT 2
  mkdir -p scratch_dir; write chain[winner_index] to pin_path    # full backend object, verbatim
```

**Behavior summary — scratch-dir resolution (`spec-review-dir`).** One resolver both round records and the pin use, so interactive and autonomous never disagree — and it fixes the pre-existing latent gap where interactive round records were scoped under an undefined `<run-id>`.

```
FUNCTION specReviewDir(issue, run_dir_flag):
  run_dir := run_dir_flag ?? env.FAFF_RUN_DIR
  IF run_dir is set: RETURN run_dir + "/" + issue + "/spec-review"
  RETURN ".faff/spec-review/" + issue                            # interactive, no run-dir; gitignored under .faff/
```

**Loop-driver (prep) changes.**

```
PROCEDURE prep_spec_review_loop(issue):
  1. scratch := faff spec-review-dir --issue <issue> [--run-dir <dir if set>]   # resolve ONCE for the loop
  2. window_start := 1                                                          # first round of the current reviewer
  3. FOR each round n:
     a. dispatch the spec_review occupant, passing scratch as the pin-dir (resolve is pin-first-with-fallback)
     b. on conformant (exit 0) verdict: write {verdict, objections} to <scratch>/round-<n>.json  # unchanged shape
     c. SWAP CHECK: if a pin exists AND round n was served by a FALLBACK (served backend ≠ pinned backend,
        read from the served header) → swap round: window_start := n  (reset the convergence window)
     d. route on the verdict as today, but the convergence-yield + churn checks compare only over rounds
        [window_start .. n] — so a forced fallback restarts the trend rather than reading as churn
  # No pinned-outage park cause: prefer-with-fallback means an unavailable pin falls back, it never hard-parks.
```

**Edge cases and error handling.**

- **Malformed `pinned-reviewer.json`** → resolve exits 2 → occupant treats as config-fault unavailable → `needs-human` → park. Never a silent full-chain (that would re-open the drift).
- **Pinned backend down a whole later round** → the pin-first chain `[pin, …rest]` falls back to the rest of the chain, so the round is served by a fallback (a swap round) rather than parking; the loop resets the convergence window at that round. Only if the *whole* chain (pin + fallbacks) is down does the transport floor fire `needs-human` — the same as any all-backends-down round, not a pin-specific park.
- **Nothing served in round 1** (whole chain down) → no pin captured; the round is already `needs-human` via the transport floor; the loop parks and no stale pin is left behind.
- **Config edited mid-loop** so the pinned backend no longer appears in config → irrelevant: the pin stores the full backend object and is emitted verbatim, not matched against current config. (If the edit removed the backend's credentials env var, that surfaces as a normal auth/unavailable exit → park.)
- **Interactive prep, no `$FAFF_RUN_DIR`** → scratch resolves to `.faff/spec-review/<ISSUE>`; round records and pin co-locate there; convergence/churn read from the same resolved dir.
- **`--consumer` unset chain (exit 3)** → resolve passes exit 3 through; unpinned path is byte-identical to today.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the pin masks a *legitimately* changed correct verdict — e.g. a fallback that would have raised a real new blocker the pinned primary misses. **How you'd know:** a spec clears the loop under a pinned weaker reviewer that a full-chain review would have rejected; downstream (build/holdout) catches a class of defect the pinned lens structurally can't see. **What it means:** acceptable and bounded — the pin only holds *within one spec's loop after round 1*; round 1 and every other spec still get the full chain, and independence across specs is unchanged. Not a reason to widen the pin.
- **The failure:** sustained pin flapping — the pinned backend alternates up/down every round, so the loop keeps resetting the convergence window at each swap and never accumulates a multi-round trend, so convergence never fires and the loop hits its cap. **How you'd know:** a spec parks at the loop cap while its round records show alternating served backends. **What it means:** acceptable and bounded — the existing loop cap (self-terminating) still parks it, and a reviewer backend that flaps every single round is a genuine "human should look" condition; the window reset never makes the loop run longer than the cap. Not a reason to add reviewer-awareness to the detectors.
- **The failure:** the interactive scratch-dir relocation silently changes where existing convergence/churn prose expects round records. **How you'd know:** convergence/churn read an empty/wrong dir interactively and never yield or never detect churn. **What it means:** the single-resolver rule is the mitigation — prep writes records and the detectors read them through the *same* `spec-review-dir` output; verify the detector CLI invocations are pointed at the resolved dir, not a hardcoded `.faff/runs/...` path.

**Anti-pattern:** treating a fallback (swap) round as if the pin still served — i.e. letting the convergence/churn comparison span the swap. Why: the reviewer genuinely changed that round, so comparing its objection-set against the pinned reviewer's prior round is the exact drift-as-churn confound this ticket fixes. A swap must reset the window (compare only within one reviewer's runs). Reordering the chain pin-first *is* the intended mechanism (that's what enables graceful fallback) — the discipline is in handling the swap, not in forbidding the fallback.

**Anti-pattern:** capturing the pin from config (re-running `assembleAdversarialBackends` and taking index 0). Why: index 0 is the configured *primary*, not the backend that actually *served* round 1 — if round 1 already fell through, config-index-0 pins the wrong reviewer. Capture from the served header's `chain[<i>]`.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a spec-review loop whose round-1 primary served all lenses
When round 2 runs and the primary would 429 but the pinned backend is still up
Then round 2 is served by the same (pinned) backend, and `detectSpecReviewConvergence` over the two single-reviewer round records returns `converging: true`, so the loop yields the cap and grants the next round rather than force-parking on spurious churn
```

```
Given a round 1 in which every lens returned a non-zero (unavailable) exit — nothing served
When capture runs
Then no `pinned-reviewer.json` is written under the scratch dir (no stale pin left behind), and the round parks via the transport floor
```

```
Given round 1 where lens `architectural` was served by chain[0] and lens `QA` fell through to chain[1]
When the pin is captured after aggregation
Then `pinned-reviewer.json` is chain[0] — the lowest chain index that served any lens — not the first lens's index, and not chain[1]
```

```
Given a captured pin whose backend was later removed from `adversarial` config mid-loop
When `faff spec-review-pin --resolve` runs on a round ≥ 2
Then it emits the stored pin verbatim as the head of the pin-first chain, never re-deriving the pin from the now-changed config (the pin is self-contained; the fallback tail is whatever the current config assembles, pin de-duped)
```

```
Given a spec-review loop with a pin captured in round 1
When the pinned backend is rate-limited in round 2 but a fallback backend is up
Then round 2 is served by the fallback (the pin-first chain falls back — no park), the loop records a swap and resets the convergence window to round 2, and the round-2 objection-set is NOT compared against round 1 as churn
```

```
Given a spec-review loop with a pin captured in round 1
When the pinned backend AND every fallback are down for round 2
Then the round resolves to needs-human via the ordinary transport floor (whole chain exhausted) — the same as any all-backends-down round, with no pin-specific park cause
```

```
Given an interactive prep session with no $FAFF_RUN_DIR set
When `faff spec-review-dir --issue FAFF-886` runs
Then it prints `.faff/spec-review/FAFF-886` and both the round records and the pin are written under that path
```

- The two reviewer-blind detectors (`spec-review-convergence.js`, `spec-review-churn.js`) and the `spec-review-verdict` contract schema MUST be unchanged by this work (no new fields, no reviewer input).

## 6. DESIGN DECISION RATIONALE

**Pin the reviewer, or teach the detectors about reviewers?**
- *Pin (A):* small, root-cause, no schema change, detectors stay pure. Con: a pinned weaker reviewer can miss what a fallback would catch (bounded — within one loop, post round 1).
- *Reviewer-aware detectors (B):* keeps full-chain availability every round. Con: needs served-identity in the round record (schema change against the standing "NO schema change" commitment), and duplicates convergence reasoning.
- **Chosen:** A. The commitment and the "fix the cause" principle both point here.

**Pin logic in prose or in a CLI?**
- *Prose in the occupant:* fewer files. Con: untested, re-drifts, violates deterministic-tools-over-prose.
- *CLI (`spec-review-pin.js`):* testable, reproducible.
- **Chosen:** CLI.

**Which backend to pin on a multi-server round 1?**
- *Modal / per-lens / lowest-index.* **Chosen:** lowest served `chain[<i>]` — strongest reachable reviewer, single scalar pin.

**Pinned-backend-down: strict-park, prefer-with-fallback, or a config knob?**
- *strict (single-element `[pin]`, park on outage):* strongest single-reviewer guarantee, but turns every transient backend blip into a park — pinning gets in the way precisely under rate-limiting (this ticket's own prep hit that four times).
- *config knob (`strict|prefer|off`):* exposes the choice, but it is one more surface to maintain for a decision with a clear best default.
- **Chosen:** prefer-with-fallback, **no knob** — pin-first chain `[pin, …rest]`; the pin serves whenever reachable, an unavailable pin round falls back and the loop resets the convergence window at the swap. Dominates strict on availability and off on reviewer-stability, so no knob is warranted. The window reset is loop-level; the detectors stay reviewer-blind.

**Where does the scratch dir live?**
- **Chosen:** one `spec-review-dir` resolver — `<run-dir>/<ISSUE>/spec-review` when a run-dir resolves, else `.faff/spec-review/<ISSUE>`. Both round records and the pin use it, which also closes the pre-existing interactive-round-record ambiguity (finding 8). At the time of writing, interactive prep sets `$FAFF_SESSION_ID` but not `$FAFF_RUN_DIR` (`faff-prep/SKILL.md:99`).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- _None open._ The pinned-backend-down policy is settled: prefer-with-fallback + window-reset, no config knob (see Design decisions). The sustained-flapping bound is a named failure mode below, not an open question — the existing loop cap already bounds it.

**Assumptions.**

- **Assumes:** `review-call.mjs`'s exit-0 stdout always begins with the `## Adversarial findings — <provider>/<model> (chain[<i>], host: <src>)` header, harness-authored and unconditional (`faffter-dark-spec-review/SKILL.md:116`). Validate: confirm the header guarantee still holds and the `chain[<i>]` index is present before relying on it for capture; if the guarantee weakens, capture must instead read a machine-readable served-identity emission from `review-call.mjs`.
- **Assumes:** prep is the sole writer of `round-<n>.json` and the sole dispatcher of the occupant, so passing one resolved scratch dir per loop is sufficient to co-locate records + pin. Validate: grep for any other writer of `spec-review/round-*.json` before implementing (explore found only prep's prose write site).
- **Assumes:** `.faff/` is gitignored so `.faff/spec-review/<ISSUE>` needs no separate ignore entry. Validate: confirm `.faff/` is in `.gitignore` (faff's `gitignore-ensure` maintains it).

## 8. DONE — Definition of Done

### From WHY
- [ ] On a spec-review loop where a later round's primary would flap, the same backend that served round 1 serves rounds ≥ 2, and the loop no longer parks on backend-induced churn/count-bump.
- [ ] The two detectors and the `spec-review-verdict` schema are unchanged (verified by diff: no edits to `spec-review-convergence.js`, `spec-review-churn.js`, `contracts/spec-review-verdict.schema.json`).

### From WHAT (CLI surface)
- [ ] `faff spec-review-pin --resolve --dir <d> --consumer <c>` prints `{chain:[pin, …rest],pinned:true}` (pin first, fallback tail, pin de-duped) when `<d>/pinned-reviewer.json` is present, else `{chain:<full>,pinned:false}`; passes through assemble exit 3 (unset) and exit 2 (malformed config); exits 2 on a malformed pin file and never prints a bare full chain in that case.
- [ ] `faff spec-review-pin --capture --dir <d> --backends-json <f> --winner-index <i>` writes `chain[i]` as the pin iff absent (idempotent), no-ops when a pin exists, exits 2 on out-of-range `i` / unreadable file / non-array chain.
- [ ] `faff spec-review-dir --issue <ISSUE> [--run-dir <dir>]` prints `<run-dir>/<ISSUE>/spec-review` when a run-dir resolves (flag wins over `$FAFF_RUN_DIR`), else `.faff/spec-review/<ISSUE>`; does not create the dir.
- [ ] `pinned-reviewer.json` is exactly one `--backends-json` array element (provider/model/host + optional keys); on resolve it is emitted as the **head** of the pin-first chain `[pin, …rest]` (the fallback tail is the rest of the assembled chain, pin de-duped out).

### From HOW (behaviour)
- [ ] The occupant resolves its chain via `faff spec-review-pin --resolve` (not `faff adversarial-backends` directly), verified mechanically two ways so the pin cannot be built-but-never-wired. The prose-presence check is **scoped to the fenced bash block that assembles `$backends_json`** (the chain-resolve step), not the whole file — a concrete grep: within that block, `faff spec-review-pin --resolve` appears and `faff adversarial-backends` does not. Mentions of `faff adversarial-backends` **elsewhere** in the SKILL (the per-lens outcome table's exit-3/2 discussion) are expected and allowed — the lint must not match them, which is why it is block-scoped, not file-scoped. Second check: an **integration observation** — after a round-1 dispatch, `pinned-reviewer.json` exists under the scratch dir (proof the occupant actually ran capture). Both are stronger than `faff validate-adapters`, which is a structural conformance lint and does not assert which subcommand the dispatch block names.
- [ ] prep points the **convergence and churn CLI invocations at the `faff spec-review-dir`-resolved scratch dir** — `faff spec-review-convergence --dir <resolved>` and `faff spec-review-churn --prev <resolved>/round-<k>.json --curr …` — never a hardcoded `.faff/runs/<run-id>/...` path. Without this the interactive case (no `$FAFF_RUN_DIR`) writes records to `.faff/spec-review/<ISSUE>` but the detectors read an empty `.faff/runs/...` dir, silently breaking the fix. (Closes the Failure-modes regression surface named in HOW.)
- [ ] `faff spec-review-pin --resolve` on an **unpinned** dir returns JSON equal to `faff adversarial-backends --consumer spec_review` for the same config (a concrete diff — replaces the untestable "byte-identical to today" framing, which had no oracle).
- [ ] The occupant captures the pin from the served header's lowest `chain[<i>]` across exit-0 lenses, via `faff spec-review-pin --capture`, after aggregation.
- [ ] Rounds ≥ 2 fan out over the **pin-first chain `[pin, …rest]`** (pin de-duped out of the tail); the pinned reviewer serves when reachable and an unavailable pin round falls back to the tail — no pin-specific park.
- [ ] prep detects a **swap round** (round served by a fallback: served backend ≠ pinned backend, read from the served header) and **resets the convergence window** — convergence-yield + churn compare only over rounds `[window_start..n]`, so a forced fallback is never counted as churn.
- [ ] prep resolves the scratch dir once per loop via `faff spec-review-dir`, writes `round-<n>.json` there, and passes it to the occupant as the pin-dir.
- [ ] A whole-chain outage (pin + all fallbacks down) surfaces `needs-human` via the ordinary transport floor — **no pin-specific park cause** is added (prefer-with-fallback never hard-parks on the pin alone).

### From HOW (edge cases)
- [ ] Malformed pin file → resolve exit 2 → park; never a silent full-chain.
- [ ] Nothing served in round 1 → no pin written; no stale pin left behind.
- [ ] Config edited mid-loop (pinned backend removed from config) → resolve still emits the stored pin verbatim; the pin is self-contained, never re-derived at resolve time.
- [ ] Interactive (no `$FAFF_RUN_DIR`) → records + pin under `.faff/spec-review/<ISSUE>`; detectors read the same resolved dir.

### From tests
- [ ] New `test/spec-review-pin.test.mjs`: resolve unpinned→full, **resolve pinned→pin-first `[pin, …rest]` with the pin de-duped out of the tail**, capture idempotent-first-write, capture out-of-range→exit 2, malformed pin→exit 2, assemble exit 3/2 passthrough, `spec-review-dir` both modes + flag-wins-over-env, and **nothing-served round 1 → no `pinned-reviewer.json` exists after capture**.
- [ ] Swap-round + window-reset test (loop-level): a round served by the pin does **not** reset the window; a round served by a fallback (served backend ≠ pin) **does** reset `window_start`, and the convergence/churn comparison is confined to `[window_start..n]` (a pre-swap round is never compared against a post-swap round).
- [ ] End-to-end oracle for the top WHY item: feed two single-reviewer round records (strictly-decreasing counts) through `detectSpecReviewConvergence` and assert `converging: true` (the loop yields), and feed a reviewer-swap pair (the pre-fix drift) and assert it would have parked — demonstrating the pin is what removes the false park.
- [ ] `test/spec-review-convergence.test.mjs` / `test/spec-review-churn.test.mjs`: unchanged behaviour asserted (guard against accidental detector edits).
- [ ] Prose-presence lint asserting the occupant SKILL's resolve step names `faff spec-review-pin --resolve` and drops the direct `faff adversarial-backends` call on that path (closes the built-but-never-wired gap); plus a test for the multi-server round-1 capture (lowest-index) and the config-edited-mid-loop resolve (pin emitted verbatim) scenarios.
- [ ] `faff validate-adapters` passes for the edited `faffter-dark-spec-review` and `faff-prep` SKILLs.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. scratch := `faff spec-review-dir --issue FAFF-TEST`      # no run-dir → .faff/spec-review/FAFF-TEST
  2. assert no pin: `faff spec-review-pin --resolve --dir $scratch --consumer spec_review` → pinned:false, full chain
  3. write a 2-element backends-json; `faff spec-review-pin --capture --dir $scratch --backends-json <f> --winner-index 0`
  4. `faff spec-review-pin --resolve --dir $scratch --consumer spec_review` → pinned:true, chain == [element 0, element 1]  # pin first, fallback tail
  5. capture again with --winner-index 1 → no-op (pin still element 0)   # idempotent first-write
```

confidence: medium

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
