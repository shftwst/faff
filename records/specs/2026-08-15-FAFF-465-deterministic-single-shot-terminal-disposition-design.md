# Spec — FAFF-465: Deterministic single-shot terminal disposition on full adversarial-chain exhaustion

> Spec: faffter-dark-nlspec · 2026-08-12 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-465.

**Artifact.** A buildable spec for the build agent (`/faff-graft`) and human reviewers. It scopes the code deliverable to **Part 2** of FAFF-465 — making a full review-chain outage resolve to *one* deterministic terminal outcome, computed by the CLI, never re-litigated by agent judgement at graft time — plus the load-bearing fence-coverage fix for the review invocation. **Part 1** (guaranteeing a reachable backend in CI) is recorded here as a best-effort infra/ops follow-up, not code built by this ticket, per the operator decisions of 2026-08-12.

## 1. WHY — Problem and Principles

**The load-bearing model.** When the adversarial review chain fully exhausts (no backend produced findings), `review-call.mjs` collapses the run to *one* exit code via two pure functions — `chainTerminalExit(failureClasses)` (`review-call.mjs:855`) picks the first *needs-human* class present, else `UNREACHABLE(5)`; `mandatoryRemap` (`:869`) fails an L4 no-opinion outage closed. That collapse is deterministic **given a fixed set of failure classes** — but the *set itself* is not stable run-to-run. A real-but-flaky backend emits malformed output one run (`MALFORMED(10)`) and times out the next (`UNREACHABLE(5)`), and because `MALFORMED` currently sits inside the needs-human set (`CHAIN_NEEDS_HUMAN`, `:854`), the **same infra outage** resolves `needs-human` one run and `chain-outage-skipped` the next. The fix removes that non-determinism *without masking a misconfiguration*: it splits today's single `MALFORMED` outcome by a property of the **response itself** — an **empty/refusal response** (an operator-fixable structural inability, stays `needs-human`) versus **substantive content that garbled the findings shape** (a reachable-but-degraded symptom, moves to the availability/outage path).

**Problem statement.** Today a full-chain outage's terminal disposition is non-deterministic because the incidental mix of failure classes varies run-to-run, and in the repro run (`run-20260712-043209-beepboop-full`) this drove a build agent to **hand-override** `review-call.mjs`'s own exit-10 `needs-human` into `chain-outage-skipped` — "a considered override of the CLI's default." This change removes the class-mix non-determinism at its source and closes the hand-override path, so a genuine *availability/degradation* exhaustion always yields `chain-outage-skipped` (advisory L1–L3) / fail-closed `unavailable` park (L4), while a genuine *structural* fault (empty/refusal/config) always yields `needs-human` — every run.

**Design principles.**

- **Determinism is a property of the disposition, keyed on a stable response property — not on the incidental class mix, and not on network timing.** `chainTerminalExit` is already a pure function of its input; the bug is that the same outage yields different inputs. The discriminator this change introduces (empty/refusal vs substantive-garble) is a pure function of the *returned content*, so it is stable across re-runs of the same fixed review input — not a re-roll of which failure class happened to fire.
- **Reachability-AND-a-substantive-response is the degraded signal; an empty/refusal response is operator-fixable.** A backend that was reachable, *responded*, and returned **substantive content that failed the findings shape** is a reachable-but-degraded backend — a quality symptom the operator cannot "fix" the way they fix a typo'd model name. But a backend that returns an **empty/zero-length body** or a **refusal** is asserting a structural inability that reproduces every run — a wrong/incapable/refusing model is an operator-fixable *choice*, not a transient outage.
- **The CLI decides; the agent never adjusts.** The terminal disposition is computed by `review-call.mjs` and consumed verbatim by the graft slot — no sanctioned graft-time discretion to re-classify an exit (the repro's hand-override is the defect being designed out).
- **No silent weakening — and this change makes it TIGHTER, not looser.** The FAFF-194 invariant is that a malformed/no-findings response must never silently pass as exit 0. Round-1's wholesale reclassification would have routed an *always-empty/always-refusing* endpoint to `chain-outage-skipped`, masking an operator-fixable misconfig as an outage. This split keeps the empty/refusal case dominating to `needs-human`, so the misconfig is *no longer masked* — a strictly tighter guarantee than the status quo. The FAFF-213/228 assembly-level invariant (an *absent/unconfigured* provider block ⇒ `needs-human`, `adversarial-backends.js:79-127`) is untouched.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node/ESM | Owns `EXIT`, `CHAIN_NEEDS_HUMAN`, `chainTerminalExit`, `mandatoryRemap`, and `validateFindingsShape` — the terminal-disposition core and the shape validator that gets the new discriminator |
| `plugin/skills/faff/bin/lib/background-fence.js` | Node/CJS | The PreToolUse gate-family fence (Layer 3); its `GATE_FAMILY_PATTERNS` does not yet match the review invocation |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | prose | The exit-code→outcome table + malformed/no-silent-weakening prose that must stay consistent with the code |
| `plugin/skills/faff-graft/SKILL.md` | prose | Step-9 review disposition + the foreground-posture region (`:296`) |
| `plugin/skills/faff/bin/lib/effects.js` | Node/CJS | The FAFF-329 `review-progress` checkpoint the exhaustion disposition rides (no new code) |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | Node/CJS | Layer-2 anchor-phrase lint (`:713-728`) — already covers the review invocation prose |
| `test/adversarial-call.test.mjs` | Node/test | Existing `chainTerminalExit`/`mandatoryRemap`/`MALFORMED` cases that must be updated + extended |

**Scope statement.** The terminal boundary of `review-call.mjs`'s fallback chain and its two graft consumers (the adversarial-review slot's exit-disposition table and graft Step 9) — where a failed chain becomes a single verdict.

## 2. OUT OF SCOPE

- **Part 1 — guaranteeing a reachable review backend in CI.** Not code in this ticket. Decision: give the fly/CI runner tailnet access so the operator's existing local model can be *config-added* as a CI fallback. **Why excluded:** pure infra/ops, not a review-chain code change, and it does **not** guarantee availability (the tailnet member can still be down). **Extension point:** a separate discovered-scope infra ticket — *"add tailnet access to the fly runner + configure the local model as a CI fallback backend."*
- **Embedding a small model in the fly runner image.** The only *true* always-available guarantee. **Rejected:** it makes the reference runner harder to pick apart (legibility over guarantee).
- **Code-injecting an unconditional local-terminal backend into `adversarial-backends.js`.** **Rejected:** contradicts the FAFF-213 invariant (absent provider ⇒ `needs-human`, never a silent default) and changes behaviour for every deployment. Assembly stays mechanical/config-only.
- **The review-iteration cap (FAFF-341) and the outage-retry limit (FAFF-403).** Different loops, already shipped — compose with, don't touch.
- **A finer split of *substantive-garble* into structural-vs-transient sub-classes.** This change already splits empty/refusal out to `needs-human`; the *only* residual masking case is a backend that returns **substantive prose that is never findings-shaped every run** (a non-instruct/rambling model), indistinguishable at the single-response layer from transient garble. **Why excluded:** a run-to-run discriminator for that narrower case would key on the chain-level "all reachable backends garbled" predicate — stable within a run, not across — reintroducing the non-determinism. **Extension point:** a new `EXIT.MALFORMED_STRUCTURAL` class + per-backend structural probe (a canned health-prompt the model must findings-shape at assembly), if the always-rambling case ever bites.
- **A process-group-kill safety net around the review invocation.** Deferred. **Extension point:** a bounded, killable single-shot spawner wrapper, its own hardening ticket.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Full-chain exhaustion | Every backend in the assembled chain failed to produce findings; `runReviewChain` returns a terminal exit via `chainTerminalExit` (`review-call.mjs:1084`) |
| Structural inability (operator-fixable) | A network-independent fault reproducing every run for the same input: config faults `USAGE(2)`/`NOT_SERVED(4)`/`DEFAULT_HOST_UNREACHABLE(6)`/`AUTH(7)`, and — after this change — an **empty/zero-length response or a refusal** (`NO_FINDINGS_CONTENT(11)`). All dominate to `needs-human`. |
| Availability/degradation symptom | A fault only arising from a reachable-but-unhealthy backend: `UNREACHABLE(5)`, `DEADLINE(8)`, transport drops routed to 5/6, and — after this change — a **substantive-but-garbled** response (`MALFORMED(10)`). All resolve to outage-skip (L1–L3) / fail-closed (L4). |
| Substantive-garble | A backend returned non-empty content that is *not* a recognised refusal and does *not* carry a `### <severity>:` finding section — genuine garble from a reachable model (`validateFindingsShape` → `kind: "garbled"`) |
| Empty/refusal | A backend returned a zero-length/whitespace-only body, or non-empty content matching the refusal signature (`validateFindingsShape` → `kind: "empty" | "refusal"`) |

**The exit vocabulary — one new code (`review-call.mjs:30`).**

```
ENUM EXIT:
  OK=0  OTHER=1  USAGE=2  NOT_SERVED=4  UNREACHABLE=5
  DEFAULT_HOST_UNREACHABLE=6  AUTH=7  DEADLINE=8  MANDATORY_OUTAGE=9  MALFORMED=10
  NO_FINDINGS_CONTENT=11   # NEW — empty/zero-length body or a refusal (operator-fixable structural inability)
```

- `11` is the next free integer (3 is reserved for `adversarial-backends.js` assembly, 0–10 are in use).
- `MALFORMED(10)` is **retained** — it now denotes *substantive-garble only*. It stays a per-backend advance class (a garbled primary still advances to a healthy fallback), but is **removed from the terminal dominance set**.

**The findings-shape discriminator — the one behavioural change to `validateFindingsShape` (`review-call.mjs:182`).** Today `validateFindingsShape(content)` returns `{ ok, reason }` and lumps three sub-conditions under one caller reaction (`EXIT.MALFORMED` at `:1065`): (a) empty/whitespace-only (`:184`), (b/c) non-empty content with no `### <severity>:` section (`:186-188` — the comment at `:180-181` names "a refusal, rambling, or a headerless essay"). The code does **not** distinguish empty from refusal from garble today — the discriminator must be **added**.

```
RECORD ShapeResult:
  ok: boolean
  reason: string?      # present when !ok
  kind: "empty" | "refusal" | "garbled"    # present when !ok — NEW

PROCEDURE validateFindingsShape(content):
  trimmed ← trim(content)
  IF trimmed is empty:  RETURN { ok:false, reason:"empty content", kind:"empty" }
  sections ← splitFindings(content)
  IF no section has a severity:
     IF isProviderRefusal(trimmed):  RETURN { ok:false, reason:"provider refusal", kind:"refusal" }   # NEW closed-grammar predicate
     RETURN { ok:false, reason:"no recognised finding section (### <severity>: ...)", kind:"garbled" }
  RETURN { ok:true }

# NEW isProviderRefusal — a conservative, closed, anchored, case-insensitive, length-guarded refusal
# signature (pure; mirrors the CLEAN_REFUTATIONS closed-grammar style at :196-202). e.g. an anchored set:
# /^(i\s+(cannot|can'?t|won'?t|am\s+unable))/, /as an ai\b/, /content policy/ + a bounded length guard so a
# long essay merely containing "I cannot" is NOT a refusal. Token set is an implementation call; the
# CONTRACT is: empty + closed-refusal ⇒ needs-human, everything-else-non-findings ⇒ availability.
```

**The caller reaction — map the kind to the two exit classes (`review-call.mjs:1063-1069`).**

```
shape ← validateFindingsShape(normalisation.content)
IF NOT shape.ok:
   cls ← (shape.kind == "empty" OR shape.kind == "refusal") ? EXIT.NO_FINDINGS_CONTENT   # 11 — stays needs-human
                                                             : EXIT.MALFORMED             # 10 — availability/degraded
   failureClasses.push(cls); log(`[chain] <tag> <kind> (${shape.reason}) → advancing (exit ${cls})`); continue
```

**The needs-human dominance set — the terminal membership change.**

```
# BEFORE (review-call.mjs:854):
CHAIN_NEEDS_HUMAN = { USAGE, NOT_SERVED, DEFAULT_HOST_UNREACHABLE, AUTH, MALFORMED }
# AFTER — MALFORMED (now substantive-garble only) leaves; NO_FINDINGS_CONTENT (empty/refusal) joins:
CHAIN_NEEDS_HUMAN = { USAGE, NOT_SERVED, DEFAULT_HOST_UNREACHABLE, AUTH, NO_FINDINGS_CONTENT }
```

- `chainTerminalExit` **unchanged in body**: returns the first `CHAIN_NEEDS_HUMAN` member in chain order, else `UNREACHABLE(5)`. Empty/refusal-only (`{11}`) → `11` → needs-human; garble/timeout/unreachable-only (any permutation of `{10,8,5}`) → `UNREACHABLE(5)` → outage-skip.
- `mandatoryRemap` **unchanged** (`:869`): remaps `5`/`8` → `9` when mandatory, passes every other class through. `NO_FINDINGS_CONTENT(11)` — like config faults `2/4/6/7` — passes through and stays `needs-human` even at L4 (a structural inability is human-actionable, not a fail-closed outage). A garble-only L4 exhaustion surfaces as `UNREACHABLE(5)` and fails closed → `9` → `unavailable`/park automatically.

**Transport faults are already in the availability family — confirmed, untouched.** A zero-byte connection drop / mid-stream truncation that exhausts the FAFF-227 transport retry surfaces `status:"transport-failed"` (`:655/709/751`) → `mapResultExit` (`:842`) → `unreachableExit` → `5/6` — never `MALFORMED`. The only content-level empty reaching `validateFindingsShape` is an **`ok`-status response with an empty body** (a *completed* empty response — the accumulators comment "leave content empty — caller treats empty as needs-human", `:433/:496`), a structural property stable across runs — correctly `NO_FINDINGS_CONTENT`.

**Fence pattern surface (`background-fence.js:39-63`) — add the review-invocation shapes** (`review-call.mjs` token + faff-anchored `adversarial-backends`), riding the existing Bash-conjunction + Monitor arms. The variable-spliced `node "$REVIEW_CALL"` form stays a recorded `LIMITATION` allow-case (Layers 1+2 remain the belt).

**Checkpoint interface (composition only — no new code).** The exit-5 outage disposition already writes `review-progress.json` once (`--phase2 skipped_unreachable`, `SKILL.md:245`); a re-dispatched graft reads it without re-invoking the chain (`effects.js:109`). A *substantive-garble*-only exhaustion now flows into that same write; an empty/refusal exhaustion resolves to `needs-human` and does **not** write a skip checkpoint (it takes the existing needs-human path, like config faults).

## 4. HOW — Behaviour

**Approach — a discriminator + one-in/one-out set edit + consistency surface:** (1) `validateFindingsShape` returns a `kind` via a new closed-grammar `isProviderRefusal`; the shape-fail call site maps `empty`/`refusal` → `NO_FINDINGS_CONTENT(11)`, `garbled` → `MALFORMED(10)`; add `EXIT.NO_FINDINGS_CONTENT=11`; swap the terminal set (`MALFORMED` out, `NO_FINDINGS_CONTENT` in). `chainTerminalExit`/`mandatoryRemap`/advance-log unchanged. (2) update the SKILL exit-table + malformed prose; (3) add the two `background-fence.js` patterns + selftest; (4) `faff-graft/SKILL.md` states the Step-9 disposition is CLI-computed, never hand-adjusted; (5) update `test/adversarial-call.test.mjs`.

```
PROCEDURE terminal_disposition(failureClasses, mandatory):
  1. exit ← chainTerminalExit(failureClasses)   # first {USAGE,NOT_SERVED,DEFAULT_HOST_UNREACHABLE,AUTH,NO_FINDINGS_CONTENT}, else UNREACHABLE(5)
  2. exit ← mandatoryRemap(exit, mandatory)      # if mandatory AND exit ∈ {5,8}: exit ← MANDATORY_OUTAGE(9)
  3. DISPATCH:
     2/4/6/7 → needs-human   (config misconfig — dominates)
     11      → needs-human   (empty/refusal — operator-fixable structural inability; dominates at every level)
     5       → L1–L3: pass + chain-outage-skipped (loud skip header)
     8       → pass + skipped-deadline
     9       → unavailable / park  (L4 fail-closed)
   # MALFORMED(10) — substantive-garble — is a per-backend advance class only; a garble-only chain collapses to UNREACHABLE(5).
```

**Determinism worked through.** Flaky *real* model (class-mix varies, disposition doesn't): `[UNREACHABLE, MALFORMED(garble)]`, `[UNREACHABLE, UNREACHABLE]`, `[DEADLINE, MALFORMED(garble)]` all → `5` → chain-outage-skipped. Always-empty/refusing endpoint (stable structural inability): `[NO_FINDINGS_CONTENT(empty)]`, `[NO_FINDINGS_CONTENT(refusal)]` → `11` → needs-human (never masked). Config misconfig dominates: `[NOT_SERVED, UNREACHABLE]` → `4`; `[MALFORMED(garble), NO_FINDINGS_CONTENT]` → `11` (structural dominates degraded).

**Edge cases.** Single-backend empty/refusal → `NO_FINDINGS_CONTENT(11)` → needs-human at every level (the case round-1 would have masked). Single-backend substantive-garble → `UNREACHABLE(5)` → L1–L3 loud skip / L4 park (FAFF-194 preserved in substance — a visible skip/park, not exit 0). `ok`-empty body vs mid-stream drop disambiguated by source (empty `ok` → 11; exhausted transport → 5/6, never collide). Assembly config faults (exit 3/2) still author `needs-human` pre-`review-call.mjs` (FAFF-213 unmoved). Foreground review invocation never fence-denied.

**Failure modes.** (a) Refusal signature *too narrow* → a refusing model falls to `garbled` → outage-skip; **known-by:** a backend outage-skips run-after-run with obvious refusal prose in its `[chain] <tag> garbled` log; **means:** widen the closed set in a follow-up; L4 fail-closed still prevents a silent merge; strictly smaller residual than the status quo. (b) Refusal signature *too broad* → flaky garble trips a refusal token → flicker; **means:** the length-guarded anchored predicate makes this very unlikely; tighten if it bites. (c) An always-rambling non-instruct model → outage-skip (the one residual, operator-endorsed, `MALFORMED_STRUCTURAL` escape hatch). (d) Fence misses a variable-spliced invocation → Layers 1+2 still prohibit it; deferred PG-kill net would make it impossible.

**Anti-patterns:** re-deciding the disposition in graft prose/agent judgement (reopens the hand-override); keying the split on the chain-level "all garbled" predicate instead of the per-response `kind` (stable within a run, not across); making `isProviderRefusal` fuzzy/open-ended (reintroduces flicker — must be a pure closed length-guarded grammar); adding a new `--phase2` status for the garble-outage case (duplicates FAFF-329).

## 5. Scenarios — born-verifiable

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fully-exhausted advisory (L1–L3) chain whose failure classes are any permutation of {UNREACHABLE, DEADLINE, MALFORMED(substantive-garble)}
When chainTerminalExit computes the terminal exit
Then it returns UNREACHABLE(5) for every permutation, and the graft disposition is chain-outage-skipped
```

```
Given a fully-exhausted chain in which at least one backend returned an empty body or a refusal (NO_FINDINGS_CONTENT), possibly mixed with any availability/degradation classes
When chainTerminalExit computes the terminal exit
Then it returns NO_FINDINGS_CONTENT(11) (structural inability dominates) and the disposition is needs-human, on every run
```

```
Given two backends that both fail the findings shape — one empty/refusal, the other substantive non-findings prose
When validateFindingsShape classifies each and the caller maps the kind to an exit class
Then the empty/refusal backend yields NO_FINDINGS_CONTENT(11) and the substantive-garble backend yields MALFORMED(10)
```

```
Given a Bash tool call invoking `node <path>/review-call.mjs …` (or `faff adversarial-backends`) with run_in_background: true, or the same under Monitor
When the background-fence PreToolUse hook evaluates it
Then the hook denies it (exit 2) with the foreground remedy message
```

- A **foreground** review invocation MUST be allowed by the fence.

## 6. Design Decision Rationale

**Part 1 (guarantee a reachable backend in CI):** options — (a) tailscale-on-fly + config-add (best-effort, no guarantee); (b) embed a model in the runner image (true guarantee, harms legibility); (c) code-inject a default backend (contradicts FAFF-213). **Chosen:** (a), an infra/ops follow-up, *not code here*; (b)/(c) rejected. Operator prioritises runner legibility; Part 2 is the actual guarantee.

**The structural/availability boundary — how should a malformed exhaustion resolve?** options — (i) keep `MALFORMED` wholesale in the set (status quo, non-deterministic); (ii) remove it wholesale (round-1 — deterministic but *masks* an always-empty/refusing misconfig, weakening FAFF-194); (iii) **split** by a per-response property. **Chosen:** (iii). Rationale: achieves determinism *and* tightens no-silent-weakening. The discriminator is a pure function of returned content, stable across re-runs of a fixed input. Grounding: `validateFindingsShape` already internally distinguishes empty (`:184`) from no-section (`:186`), and the accumulators already comment empty ⇒ needs-human (`:433/:496`) — round-1 contradicted the code's own intent; the split restores it. Transport drops already route to availability (`:842`), so the split touches only the content layer. **The human has endorsed this direction, discharging the round-1 FAFF-194 confirmation gate** — the empty/refusal case is *strengthened*, not weakened. The one residual (always-rambling non-instruct model) is operator-endorsed with a named escape hatch.

**Where to place the discriminator:** **Chosen** extend `validateFindingsShape` with a `kind` + pure `isProviderRefusal`, mapped at `:1063-1069` — empty and refusal both arrive as `status:"ok"` content, so the shape validator is the only place both are visible; a pure content predicate is unit-testable against a fixed table with zero real calls (FAFF-183 posture).

**Closing the hand-override path:** **Chosen** the CLI disposition is consumed verbatim; graft prose states it's never hand-adjusted. The reclassification now *computes* `chain-outage-skipped` for the exact garble case the repro agent hand-overrode into — nothing left to override.

**Fence coverage:** verified Layer 3 doesn't cover the review invocation. **Chosen** extend `GATE_FAMILY_PATTERNS` + selftest, mirroring the `faff gates run` anchoring.

**Process-group-kill net:** **Chosen** defer to a follow-up (the fence prevents the backgrounding; foreground posture prohibits it at two further layers). Recorded residual.

## 7. Open Questions and Assumptions

**Open Questions.** None blocking — every decision is a `**Chosen:**`. The round-1 human-confirmation flag (a *wholesale* weakening of FAFF-194) is discharged by the split: empty/refusal is *strengthened* to `needs-human`, and the operator has endorsed routing only genuinely-degraded substantive-garble to availability. No unresolved `**Punt:**`.

**Assumptions.**
- **Assumes:** `mandatoryRemap` remaps `5`/`8` → `9` when mandatory, passing other classes (incl. `NO_FINDINGS_CONTENT(11)`) through. *Validation:* verified `review-call.mjs:869-873`; L4 behaviour depends on it, no edit.
- **Assumes:** an exhausted transport fault surfaces `status:"transport-failed"` and never reaches `validateFindingsShape` as `ok` content. *Validation:* verified `:655/709/751` + `:842`; confirm no path returns `ok`+empty on a dropped stream.
- **Assumes:** the exit-5 outage path writes `--phase2 skipped_unreachable` once and a re-dispatched graft reads it. *Validation:* verified `SKILL.md:245`, `effects.js:109`.
- **Assumes:** `validate-adapters` lints the graft SKILL foreground-posture anchor phrases. *Validation:* verified `validate-adapters.js:713-728`.

## 8. DONE — Definition of Done

- [ ] For every permutation of `{UNREACHABLE(5), DEADLINE(8), MALFORMED(10, substantive-garble)}`, `chainTerminalExit` returns `UNREACHABLE(5)` (table-driven permutation test).
- [ ] Any chain containing `NO_FINDINGS_CONTENT(11)` (empty/refusal), mixed with any availability classes, resolves to `needs-human` — the empty/refusal case is never masked as an outage-skip.
- [ ] For a chain containing any of `{USAGE(2), NOT_SERVED(4), DEFAULT_HOST_UNREACHABLE(6), AUTH(7)}`, `chainTerminalExit` returns the first such class in chain order (config-misconfig dominance preserved).
- [ ] The graft Step-9 disposition is taken verbatim from `review-call.mjs`'s exit; `faff-graft/SKILL.md` states it is CLI-computed and never hand-adjusted.
- [ ] `EXIT.NO_FINDINGS_CONTENT = 11` exists; `validateFindingsShape` returns `kind ∈ {empty, refusal, garbled}` on `!ok` via a pure, closed, length-guarded `isProviderRefusal`; the shape-fail call site maps `empty`/`refusal` → `11` and `garbled` → `10`.
- [ ] `CHAIN_NEEDS_HUMAN` no longer contains `EXIT.MALFORMED` and now contains `EXIT.NO_FINDINGS_CONTENT`; `chainTerminalExit`/`mandatoryRemap` bodies unchanged; a garbled/empty primary still advances to a healthy fallback + logs the kind.
- [ ] A substantive-garble-only chain at L1–L3 → `pass` + `chain-outage-skipped` (loud header, never exit 0); an empty/refusal-only chain → `needs-human` at every level (no skip checkpoint); a garble/unreachable/deadline-only L4 chain → `MANDATORY_OUTAGE(9)` → `unavailable`/park.
- [ ] The garble-outage disposition writes `review-progress.json` exactly once; a re-dispatch reads it without re-invoking the chain. A completed-but-empty `ok` body maps to `11`, an exhausted transport drop to `5/6` (transport path untouched, verified `:842`).
- [ ] `background-fence` denies a backgrounded / Monitor-run `node …/review-call.mjs …` and `faff adversarial-backends`; a foreground invocation is allowed; the variable-spliced form is a recorded `LIMITATION`; PG-kill net is a documented deferred residual.
- [ ] The `faffter-dark-adversarial-review/SKILL.md` exit-table adds the `11` row (→ needs-human) and moves the `10` row (→ outage-skip); the malformed prose states the boundary.
- [ ] Pre-existing `MALFORMED`-dominance test cases updated; a table test asserts the kind split (empty → 11, each refusal string → 11, substantive non-findings → 10, valid body → ok); a permutation test asserts empty/refusal chains → needs-human while garble/timeout/unreachable-only → outage-skip. `node --test test/adversarial-call.test.mjs`, `faff background-fence --selftest`, `faff validate-adapters` all pass.

confidence: high
build-tier: complex
spec-review: approve
