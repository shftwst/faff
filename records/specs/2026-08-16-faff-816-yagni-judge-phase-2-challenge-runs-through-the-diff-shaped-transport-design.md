# Spec — FAFF-816: Wire yagni-judge Phase-2 to a fit adversarial transport

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-816.

> Revised 2026-08-16 (spec-review round-1 `reject-approach`, architectural+QA design lenses): corrected the grader-wiring claim (`adr-drift` is in `CLOSED_SET_KINDS` **and** carries its own `predictedSet` arm — CLOSED_SET_KINDS membership alone does not grade), switched the eval oracle to the binary `survived|overturned` shape, added a deterministic grader-green oracle for the new case, and named the runtime-transport-proof boundary honestly.

This is a buildable nlspec for **FAFF-816** (bug), for the build agent that will implement it and the human reviewers who gate it. It fixes a **skill-prompt / wiring bug** in faff's own skills: the upper-gate YAGNI Phase-2 challenge has no proposal-shaped transport, so a live L4 run borrowed the diff-shaped `review-call.mjs` and improvised an overturn. The artifacts under change are `SKILL.md` prompts plus the eval seam-registry/grader/case files — not application code.

## 1. WHY — Problem and Principles

**Load-bearing model.** faff's upper-gate (YAGNI) admission is a *two-phase arbitration*: Phase 1 is the `methodology` slot's `yagni-judge` proposing `{serves_goal, within_scope, verdict, reason}`; Phase 2 is the `review` slot challenging that proposal *with a different model*, returning a closed-vocab `survived|overturned` + `ground ∈ {over-scope, unserved, other}` that `faff prdr yagni` then arbitrates deterministically. Phase 2 is a **yes/no judgement about a proposal**, not a code-review of a diff. The adversarial engine already runs exactly this shape for a sibling question — the `adr-drift` seam (faff-graft Step 3b) — by invoking the `review` slot **as a subagent with a proposal-shaped input**, never through `review-call.mjs --diff`. YAGNI Phase-2 must mirror that seam; today it has no such transport.

**Problem statement.** Status quo: the adversarial-review skill declares only two judgement seams (`refutation-code`, `adr-drift`) and ships one concrete transport, `review-call.mjs`, which is hard-wired to the diff shape (`assembleUserMessage` emits `DIFF UNDER REVIEW:\n\n${diff}`; `main()` requires `--system … --diff …`; output is validated for `### <severity>:` findings). Pain: with no proposal-shaped transport for YAGNI Phase-2, a live run (`run-20260815-213815-lights-out`) reached for `review-call.mjs`'s diff path and improvised a `### severity` output into a P0 overturn — a shape-mismatch artifact, not a founded YAGNI verdict. This change gives YAGNI Phase-2 a fit, documented, agent-invoked transport (a third `prdr-yagni` seam) mirroring `adr-drift`, so the challenge is a founded yes/no judgement traceable to the proper transport.

**Design principles.**

**Mirror the `adr-drift` precedent exactly, do not invent a new mechanism.** `adr-drift` is the settled pattern for "a non-diff judgement question on the same adversarial engine": a seam declared in frontmatter, a prose transport section documenting `{input} → closed-vocab outcome`, agent-invoked as a different-model subagent, feeding a deterministic CLI directly (`faff adr admit --challenge`), missing-skeptic-is-reject. Any YAGNI-Phase-2 divergence from that shape is a smell.

**Fail closed on a missing skeptic.** An unreachable/unanswered challenge (after the normal fallback chain) is **not** a survival: the caller omits `--challenge`, and the loop parks the PRDR `phase2-inconclusive`. This must not regress to a pass.

**Transport wiring only — do not touch the arbitration set-test.** The under-citation (`V ⊆ D`) vs over-scope (`V ⊄ D`) distinction is the CLI's deterministic set-test (FAFF-815 territory) and stays CLI-side. This spec changes *how the challenge is transported*, never *how the verdict is arbitrated*.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Skill prompt | The `review` slot occupant; declares seams, documents transports. **Primary change site.** |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node helper | The diff-shaped transport that was wrongly borrowed. **Stays diff-shaped; unchanged.** |
| `plugin/skills/faff-plot/SKILL.md` (Step 5c) | Skill prompt | The Phase-2 caller; delegates to the `review` slot. Gets an explicit transport cross-ref. |
| `plugin/skills/faff-graft/SKILL.md` (Step 3b) | Skill prompt | The `adr-drift` caller — the precedent this fix copies. **Read-only reference.** |
| `plugin/skills/faff/SKILL.md` (Upper-gate two-phase arbitration, ~L1114) | Gateway | Canonical arbitration contract. Already names the `review` slot; **unchanged.** |
| `eval/seam-registry.json` | Registry | Seam→KIND SSOT; `validate-adapters` reconciles frontmatter against it. New `prdr-yagni` row. |
| `eval/grader.mjs` | Grader | `KINDS` must equal registry keys; `CLOSED_SET_KINDS` drives closed-vocab grading. New entry. |
| `eval/cases/` | Eval cases | `adr-drift-001.json` is the shape template for the new `prdr-yagni-001.json`. |

**Scope statement.** This sits at the transport seam between the upper-gate YAGNI arbitration (gateway + faff-plot Step 5c, the callers) and the adversarial engine (the `review` slot), giving Phase-2 the same first-class seam `adr-drift` already has.

## 2. OUT OF SCOPE

- **The YAGNI arbitration set-test** — *Why excluded:* the under-citation/over-scope distinction (`V ⊆ D` vs `V ⊄ D`) is FAFF-815 territory and is already correct and deterministic in `faff prdr yagni`. *Extension point:* `faff contract prdr-yagni` / the arbitration CLI.
- **Changing `review-call.mjs`** — *Why excluded:* the diff-shaped helper is correct for the `refutation-code` seam; the fix is that the YAGNI path *stops using it*, not that it grows a `--proposal` mode. *Extension point:* if a future seam ever needs a shared programmatic non-diff transport helper, `review-call.mjs` could grow a mode — explicitly not now.
- **The gateway's Upper-gate arbitration prose** — *Why excluded:* it already names "the `review` (adversarial-review) slot challenges it with a *different* model" (transport-agnostic, correct); no admission-path change is warranted. *Extension point:* `faff/SKILL.md` → Upper-gate (YAGNI) two-phase arbitration.
- **Recording/accepting the eval baseline value** — *Why excluded:* moving the new KIND from `covered` to `calibrated` requires a committed frontier accuracy, which is a human-supervised operator sweep, never required by the lint or this DoD. *Extension point:* `eval/baselines/frontier.json` + the operator calibration sweep.
- **Grading the overturn `ground` classification** — *Why excluded:* the v1 eval grades the challenge binary `survived|overturned` (mirroring `adr-drift`); scoring whether the skeptic picked the *correct* `ground` (`over-scope`/`unserved`/`other`) would need its own `predictedSet` extraction arm/kind and its own cases. *Extension point:* a later `prdr-yagni-ground` kind, or a ground-token arm.
- **A live end-to-end runtime-transport proof** — *Why excluded:* confirming a real plan run's Phase-2 challenge is served by the new transport (not `review-call.mjs`) is a human-supervised holdout-shaped criterion; the autonomous DoD proves the wiring, not the live swap. *Extension point:* an L4 plan-run holdout on the YAGNI Phase-2 path.
- **Phase-1 `yagni-judge`, and the `faff prdr admit`/`accept` gates** — *Why excluded:* unchanged; only the Phase-2 transport is at fault.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Judgement seam | An LLM-judgement point a skill owns, declared in the `judgement_seam:` frontmatter key as a grader `KIND`; `none` if asserted-deterministic. Reconciled against `eval/seam-registry.json` by `faff validate-adapters`. |
| `prdr-yagni` (new) | The grader `KIND` / seam name for the upper-gate Phase-2 YAGNI challenge. Chosen to match `faff-contract:prdr-yagni` and `faff prdr yagni`. |
| Proposal-shaped input | The challenge input `{AuthoredPrdr, PRD goals, Phase-1 proposal}` — a yes/no warrant question, contrasted with a diff. |
| Challenge outcome | The closed-vocab result the challenge returns: `survived | overturned`, plus `ground ∈ {over-scope, unserved, other}` on an overturn. Canonical semantics: gateway → Upper-gate arbitration + `faff contract prdr-yagni --describe`. |
| Agent-invoked transport | Invoking the `review` slot as a different-model subagent with a prose proposal question (the `adr-drift` mechanism), never `review-call.mjs --diff`. |

**Seam declaration (frontmatter).** The adversarial-review skill's `judgement_seam:` key changes from two entries to three:

```
ENUM judgement_seam (of faffter-dark-adversarial-review):
  refutation-code    # existing — the diff-shaped code-review seam (review-call.mjs)
  adr-drift          # existing — the non-diff ADR-supersession challenge (agent-invoked)
  prdr-yagni         # NEW      — the non-diff upper-gate YAGNI Phase-2 challenge (agent-invoked)
```

**Challenge transport I/O (the new seam).**

```
RECORD PrdrYagniChallenge:
  # INPUT — proposal-shaped, NOT a diff
  authored_prdr: AuthoredPrdr        # the loop-authored PRDR under challenge (decision + DoD)
  prd_goals:     List<Goal>          # D — the PRD's declared goals
  phase1_proposal: { serves_goal: Bool, within_scope: Bool,
                     verdict: admit|reject, reason: String }   # the yagni-judge proposal being challenged

  # OUTPUT — closed vocab, NOT a `### <severity>:` findings block
  challenge: survived | overturned
  ground:    over-scope | unserved | other      # REQUIRED iff challenge == overturned; absent on survived

  CONSTRAINT unreachable_after_fallback ⇒ outcome ABSENT (caller omits --challenge; missing skeptic = reject)
```

**Registry row (`eval/seam-registry.json`).** Add one key to `kinds`, surfaced to the same skill as `refutation-code`/`adr-drift`:

```
"prdr-yagni": { "surface": "faffter-dark-adversarial-review", "status": "covered" }
```

`status: "covered"` requires ≥1 case in `eval/cases/`; `designed` (0 cases) is the rejected alternative (see Rationale).

**Grader registration (`eval/grader.mjs`) — corrected wiring.** Verified in the checkout: `adr-drift` is in `CLOSED_SET_KINDS` (grader.mjs:238) **but still carries its own bespoke `predictedSet` arm** (grader.mjs:689 — `env.challenge_outcome === "overturned" ? ["overturned"] : []`); `CLOSED_SET_KINDS` membership alone does **not** grade a kind — a kind with no arm falls to the `default:` arm (grader.mjs:692, `env.classifications[c.kind]`) and mis-grades. So `prdr-yagni` requires **three** grader touches, all mirroring `adr-drift`:

1. **`KINDS`** (grader.mjs:237) — append `"prdr-yagni"` (the grader asserts `KINDS === registry keys` on load, so this must land in lockstep with the registry row).
2. **`CLOSED_SET_KINDS`** (grader.mjs:238) — append `"prdr-yagni"` (closed-vocab set-equality grading).
3. **`predictedSet` arm** — `prdr-yagni` **joins `adr-drift`'s existing binary arm** by adding a `case "prdr-yagni":` label immediately above `case "adr-drift":` (grader.mjs:689), so both fall through to `return env.challenge_outcome === "overturned" ? ["overturned"] : [];`. This is the *literal* "reuse `adr-drift`'s grade math, zero **new** grade math" — the same one-arm-shared-by-many pattern `routing`/`verdict-build`/`spec-verdict` already use — **not** the (false) claim that membership alone suffices.
4. **Fixture-required-fields entry** — add `"prdr-yagni": ["authored_prdr", "prd_goals", "phase1_proposal"]` to the `FIXTURE_SHAPE` map (grader.mjs ~:343, beside the `adr-drift` entry), so `validateCase` asserts the fixture carries the three proposal-shaped inputs.

A grader doc-comment entry documents `prdr-yagni` alongside the `adr-drift` note.

**Eval-graded shape is BINARY (mirrors `adr-drift`), not ground-keyed.** The seam's *output* carries a `ground ∈ {over-scope, unserved, other}` that the caller feeds to `faff prdr yagni --challenge-ground` — but the **eval grades the challenge binary** `survived | overturned` (via `env.challenge_outcome`), exactly as `adr-drift` grades its challenge binary without grading the outcome's sub-classification. Grading the `ground` token is a deliberate **out-of-scope follow-up** (would need its own extraction arm/kind; see §2 and §6) — the v1 eval case does **not** put ground tokens in `closed_set`.

**Eval cases — TWO, mirroring `adr-drift`'s convention (FAFF-199 ships one-survive + one-overturn).** Modeled on `adr-drift-001.json`'s verified shape (binary oracle):

```
RECORD EvalCase(prdr-yagni) ×2:
  eval/cases/prdr-yagni-001.json  — oracle.closed_set = []            # should SURVIVE (warranted PRDR)
  eval/cases/prdr-yagni-002.json  — oracle.closed_set = ["overturned"] # should OVERTURN (genuine gold-plating)
  each:
    kind:    "prdr-yagni"
    fixture: { authored_prdr: {...}, prd_goals: [...], phase1_proposal: {...} }   # the 3 FIXTURE_SHAPE fields
    question: "Given the loop-authored PRDR, its PRD goals, and the Phase-1 YAGNI proposal, does the PRDR
               over-scope the goals (or leave a cited goal unserved), warranting an overturn?"
    _comment: "why the oracle outcome is correct (the human-baseline reason, as adr-drift-001 carries)"
```

**The corpus-count test must move in lockstep.** `test/eval-grader.test.mjs:775` hard-asserts `cases.length === 79`; adding the two cases makes it **81**, so that assertion **and** its running `// FAFF-…: +N …` comment tally must be updated (a `// FAFF-816: +2 prdr-yagni (one survive, one overturn)` line, exactly as the FAFF-199 `+2 adr-drift` line reads). `adr-drift` is deliberately absent from that test's `kinds.has(k)` presence list and its `≥2`-per-kind enforcement list (lines 776-783) — `prdr-yagni` mirrors that (no enumerated-list entry needed); only the count + comment change. Omitting this update leaves the DoD's `validate-adapters` gate green while `test/eval-grader.test.mjs` goes red — the surviving round-2 QA objection.

## 4. HOW — Behavior

**Approach.** Three coordinated edits — the engine documents the seam + transport, the registry/grader/case make the seam lint-conformant, and the caller names the transport — with `review-call.mjs` and the gateway untouched.

**(A) adversarial-review `SKILL.md` — declare the seam and document the transport.**

1. Frontmatter: `judgement_seam: refutation-code, adr-drift, prdr-yagni`.
2. Add a new section **"PRDR YAGNI Phase-2 challenge"** (a sibling of the existing "ADR drift challenge" section), documenting the seam by direct analogy:

```
BEHAVIOUR PRDR YAGNI Phase-2 challenge (the prdr-yagni seam):
  SUMMARY: the same adversarial engine, called for the upper-gate Phase-2 — a distinct,
           narrower question than the diff code-review, sharing only the "different model,
           independent second opinion" mechanism (as adr-drift does).
  1. Input  = { AuthoredPrdr, PRD goals, Phase-1 yagni-judge proposal }  # proposal-shaped, NOT a diff
  2. Judge  whether the PRDR is warranted — serves a real PRD goal without exceeding it
  3. Return the closed challenge vocabulary: survived | overturned, with ground
     (over-scope | unserved | other) on an overturn
     (canonical semantics: gateway → Upper-gate arbitration + `faff contract prdr-yagni --describe`)
  4. Transport = invoke the `review` slot as a subagent (a different model, the Phase-2 pattern),
     NOT via `review-call.mjs --diff`. It feeds `faff prdr yagni --challenge <outcome>
     --challenge-ground <ground>` directly, never the `faff-contract:review-verdict` block.
  5. Unreachable/unanswered after the normal fallback chain → the absent outcome
     (caller omits --challenge — a missing skeptic is a reject, never a pass); no separate
     outage-annotation shape (same as adr-drift).
```

3. Reconcile the existing line (~294). Current text:
   > "No new judgement-seam — the under-citation/over-scope distinction is the CLI's deterministic set-test, not a refutation seam."

   Replace with wording that scopes the "no seam" claim to the **set-test only**, while acknowledging the **challenge itself is now a first-class seam**:
   > "The under-citation/over-scope *distinction* remains the CLI's deterministic set-test (FAFF-815), not part of any refutation seam. The Phase-2 *challenge itself*, however, is a first-class judgement seam — `prdr-yagni`, declared in the frontmatter above and transported per **PRDR YAGNI Phase-2 challenge** — not the diff-shaped `refutation-code` seam."

**Anti-pattern:** routing the YAGNI Phase-2 challenge through `review-call.mjs --diff`. Why: it is hard-wired to `DIFF UNDER REVIEW:` input and `### <severity>:` output — a shape mismatch that yields an improvised, untrustworthy overturn (the exact FAFF-816 bug).

**(B) Eval seam plumbing — make the seam lint-conformant.**

```
PROCEDURE register_seam():
  1. eval/seam-registry.json: kinds["prdr-yagni"] = { surface: "faffter-dark-adversarial-review", status: "covered" }
  2. eval/grader.mjs (all four touches, mirroring adr-drift):
       a. append "prdr-yagni" to KINDS               (KINDS === registry keys, checked on load)
       b. append "prdr-yagni" to CLOSED_SET_KINDS
       c. add `case "prdr-yagni":` above `case "adr-drift":` in predictedSet (share the binary arm)
       d. add FIXTURE_SHAPE["prdr-yagni"] = ["authored_prdr","prd_goals","phase1_proposal"]
       e. add a doc-comment entry beside the adr-drift note
  3. eval/cases/prdr-yagni-00{1,2}.json: author TWO cases (survive + overturn), binary oracle
  3b. test/eval-grader.test.mjs: bump `assert.equal(cases.length, 79)` → 81 and add the
      `// FAFF-816: +2 prdr-yagni (one survive, one overturn)` tally comment (mirror the FAFF-199 line)
  4. faff validate-adapters MUST exit 0  (frontmatter[3 seams] reconciles against registry rows;
     the covered KIND has its cases; KINDS === registry keys)
  4b. node --test test/eval-grader.test.mjs MUST pass (corpus-count + validateCase over the new cases)
  5. GRADER-GREEN (deterministic, no live backend): the predictedSet arm for prdr-yagni is exercised
     by a fixed-env assertion mirroring adr-drift's grader test — env{challenge_outcome:"overturned"}
     ⇒ ["overturned"]; env{challenge_outcome:"survived"|absent} ⇒ [] — and validateCase passes over
     both new cases (oracle+fixture shape). This is the seam's runtime-observable exercise; live-backend
     ACCURACY calibration (covered → calibrated via `node eval/run-evals.mjs --only prdr-yagni-001`
     against a real backend) is the deferred human-supervised step (§2), never required here.
```

**(C) faff-plot `SKILL.md` Step 5c — name the transport at the caller.** The Phase-2 bullet currently says "the adversarial `review` slot challenges it with a *different* model → survived | overturned." Make it explicit like faff-graft Step 3b does, adding a cross-reference clause (no admission-path change; the gate CLIs stay byte-unchanged):

```
Phase 2 — invoke the `review` slot as a subagent (a different model, the Phase-2 pattern —
  see adversarial-review → PRDR YAGNI Phase-2 challenge; NOT review-call.mjs --diff) with
  { AuthoredPrdr, PRD goals, Phase-1 proposal } → survived | overturned + ground; feed to
  `faff prdr yagni --challenge … --challenge-ground …`. Inconclusive (skeptic unreachable
  after fallback) → omit --challenge → park `phase2-inconclusive`.
```

**Failure modes.**

- **The failure:** the new prose transport is documented but a runtime caller still defaults to `review-call.mjs` because the caller prose stays vague. **How you'd know:** a Phase-2 challenge on a run still emits a `### <severity>:` block / invokes `review-call.mjs --diff`; grep of the YAGNI path finds a diff-shaped call. **What it means:** the faff-plot Step 5c cross-ref (edit C) is the mitigation — proceed only with C landed; its absence is why edit C is necessary, not optional.
- **The failure:** `validate-adapters` fails because `grader.mjs` `KINDS` wasn't updated in lockstep with the registry (the grader asserts `KINDS === registry keys`). **How you'd know:** `faff validate-adapters` exits non-zero naming a KIND-axis mismatch. **What it means:** narrow — the registry, grader `KINDS`, and frontmatter must land in one change; proceed once all three agree.

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a loop-authored PRDR, its PRD goals, and the Phase-1 yagni-judge proposal
When the upper-gate Phase-2 challenge runs
Then it is dispatched to the `review` slot as a different-model subagent with the proposal-shaped
     input, and returns a closed-vocab { survived|overturned, ground∈{over-scope,unserved,other} }
     judgement — not a `### <severity>:` diff-findings block — and review-call.mjs --diff is not
     invoked on the YAGNI Phase-2 path
```

```
Given the Phase-2 challenge returns `overturned` with ground `over-scope`
When the caller records the outcome
Then it is fed to `faff prdr yagni --challenge overturned --challenge-ground over-scope`, and the
     overturn is traceable to the documented adversarial transport (the review-slot subagent),
     never an improvised diff review
```

- The adversarial-review skill declares exactly three judgement seams (`refutation-code, adr-drift, prdr-yagni`), and `faff validate-adapters` exits 0 (assertion — frontmatter↔registry reconcile, covered KIND has ≥1 case, `KINDS === registry keys`).
- No `review-call.mjs` invocation or `--diff` reference remains on the documented YAGNI Phase-2 transport path (assertion).
- **Grader-green (deterministic oracle):** the `prdr-yagni` `predictedSet` arm returns `["overturned"]` for `env.challenge_outcome === "overturned"` and `[]` otherwise, `validateCase` passes over both new cases, and `node --test test/eval-grader.test.mjs` passes (corpus count 81) — a fixed-env, no-backend, runnable check (mirrors `adr-drift`'s grader test).

**Verification boundary (named honestly — not auto-verified).** Every born-verifiable check above is a prose grep + `validate-adapters` + a fixed-env grader assertion. None of them proves that a *runtime* Phase-2 caller, on a real plan run, actually stops reaching for `review-call.mjs --diff` — that behavioural swap rides on prose clarity plus edit C's caller cross-ref, and its true confirmation is a **human-supervised, holdout-shaped** end-to-end criterion (a live L4 plan run whose Phase-2 challenge is served by the `prdr-yagni` transport), explicitly **out of scope** here (§2). Reviewers must not read "`validate-adapters` green" as "runtime transport proven."

## 6. Design Decision Rationale

**How should YAGNI Phase-2 be transported?**
- *Extend `review-call.mjs` with a `--proposal`/`--mode` non-diff path* — con: grows the diff-shaped helper a second responsibility; diverges from the `adr-drift` precedent (which is agent-invoked, not helper-invoked); more code surface to test.
- *Agent-invoked subagent (the `adr-drift` mechanism)* — pro: identical to the settled sibling seam; no new code path in `review-call.mjs`; the challenge is a prose proposal question a different-model subagent answers.
- **Chosen:** Agent-invoked subagent transport, mirroring `adr-drift`. `review-call.mjs` stays diff-shaped and out of the YAGNI path.

**Declare a new judgement seam, or keep "no new seam"?**
- *Keep no seam* — contradicted by the facts: the challenge is a genuine LLM-judgement point, and leaving it seamless is precisely what left it with no fit transport.
- **Chosen:** Declare a third seam `prdr-yagni`. The old line-294 "no new judgement-seam" is reconciled to scope that claim to the arbitration *set-test* (which legitimately stays CLI-side), while the *challenge* becomes first-class.

**Seam name.**
- **Chosen:** `prdr-yagni` — matches `faff-contract:prdr-yagni` and `faff prdr yagni`; the build agent should not re-litigate. (`yagni-challenge`/`prdr-yagni-challenge` rejected as gratuitously divergent from the existing contract name.)

**Registry status for the new KIND.**
- *`designed` (0 cases)* — passes the lint but leaves the seam un-exercised; weaker than the authoring standard's "register a grader KIND + ≥1 eval case."
- **Chosen:** `covered` with 2 cases (`prdr-yagni-001/002.json`). Baseline calibration (`covered → calibrated`) is the deferred human operator step, never required by this DoD.

**Grader wiring — how does `prdr-yagni` grade?**
- *Membership in `CLOSED_SET_KINDS` alone* — **rejected (was a factual error in round-1 draft):** verified that `adr-drift` is in `CLOSED_SET_KINDS` *and* carries its own `predictedSet` arm (grader.mjs:689); a kind with no arm falls to `default:` and mis-grades while `validate-adapters` still passes (it only checks the KIND axis + case-presence, not grade correctness).
- *A brand-new bespoke arm* — con: gratuitous divergence from `adr-drift`, which grades the same binary `survived|overturned` shape.
- **Chosen:** `prdr-yagni` **joins `adr-drift`'s existing binary arm** (a shared `case` label, the `routing`/`verdict-build`/`spec-verdict` pattern) + is added to `KINDS`, `CLOSED_SET_KINDS`, and `FIXTURE_SHAPE`. This is the true "zero *new* grade math" — reuse of the arm, not membership-magic — and it is exercised by a fixed-env grader assertion (deterministic, no live backend).

**Caller wiring — edit faff-plot Step 5c and/or the gateway?**
- *Edit the gateway* — unnecessary: it already names "the `review` (adversarial-review) slot challenges it with a different model," transport-agnostic and correct.
- **Chosen:** Add a minimal transport cross-ref to faff-plot Step 5c only (mirroring faff-graft Step 3b's explicit invocation), leave the gateway and the gate CLIs byte-unchanged. Naming the transport at the caller is what stops a future run from re-improvising `review-call.mjs`.

*Temporal anchor (2026-08): the adversarial engine's only concrete programmatic transport, `review-call.mjs`, is diff-only; if a shared non-diff helper is later introduced, the agent-invoked decision here can be revisited.*

## 7. Open Questions and Assumptions

**Open Questions:** none. (No `**Punt:**` items — every decision is closed above.)

**Assumptions:** none load-bearing. All referenced facts were verified against the checkout: the diff-shaped `review-call.mjs` (`assembleUserMessage`/`main` usage), the two-seam frontmatter, gateway line ~1114, faff-plot Step 5c, faff-graft Step 3b, `eval/seam-registry.json` schema, `eval/grader.mjs` `KINDS`/`CLOSED_SET_KINDS`, `adr-drift-001.json` case shape, and `faff contract prdr-yagni --describe`.

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] The YAGNI Phase-2 challenge is documented as agent-invoked (different-model subagent) with a proposal-shaped input — no diff-shaped `review-call.mjs --diff` on the YAGNI path (grep of the YAGNI Phase-2 transport prose finds no `review-call.mjs`/`--diff`).
- [ ] Missing/unreachable skeptic → caller omits `--challenge` → `phase2-inconclusive` park is stated in both the engine section and faff-plot Step 5c.

### From WHAT (seam + I/O)
- [ ] `plugin/skills/faffter-dark-adversarial-review/SKILL.md` frontmatter reads `judgement_seam: refutation-code, adr-drift, prdr-yagni`.
- [ ] The engine's new **"PRDR YAGNI Phase-2 challenge"** section documents input `{AuthoredPrdr, PRD goals, Phase-1 proposal}` and output `survived|overturned` + `ground ∈ {over-scope, unserved, other}`, feeding `faff prdr yagni --challenge … --challenge-ground …` directly (never `faff-contract:review-verdict`).
- [ ] Line ~294 "No new judgement-seam" is reconciled: the *set-test* stays CLI-side; the *challenge* is the first-class `prdr-yagni` seam — internally consistent with the new frontmatter and section.

### From HOW (eval plumbing)
- [ ] `eval/seam-registry.json` `kinds` has `"prdr-yagni": { "surface": "faffter-dark-adversarial-review", "status": "covered" }`.
- [ ] `eval/grader.mjs`: `"prdr-yagni"` is in `KINDS` **and** `CLOSED_SET_KINDS`; `predictedSet` has a `case "prdr-yagni":` sharing `adr-drift`'s binary arm; `FIXTURE_SHAPE["prdr-yagni"] = ["authored_prdr","prd_goals","phase1_proposal"]`; a doc-comment entry documents it; `KINDS === registry keys` holds.
- [ ] `eval/cases/prdr-yagni-001.json` (survive, `closed_set: []`) **and** `eval/cases/prdr-yagni-002.json` (overturn, `closed_set: ["overturned"]`) exist, each with the three fixture fields and a **binary** oracle (never a ground token).
- [ ] `test/eval-grader.test.mjs` corpus-count assertion updated `79 → 81` with the `+2 prdr-yagni` tally comment; `node --test test/eval-grader.test.mjs` passes.
- [ ] **Grader-green (deterministic):** a fixed-env assertion shows the `prdr-yagni` arm returns `["overturned"]` / `[]` on `challenge_outcome` `overturned` / `survived`, and `validateCase` passes over both new cases — no live backend required (mirrors the `adr-drift` grader test).

### From HOW (caller wiring)
- [ ] faff-plot Step 5c Phase-2 bullet names the transport (invoke `review` slot as a subagent, Phase-2 pattern, cross-ref to the engine section, "NOT review-call.mjs --diff"); gateway and gate CLIs unchanged.

### Eval-coverage (LLM-judgement seam introduced)
- [ ] This ticket registers the new grader `KIND` (`prdr-yagni`) + 2 eval cases + the seam-registry row + the shared `predictedSet` arm + `FIXTURE_SHAPE` entry, and exercises the arm with a fixed-env grader assertion (all autonomous-doable). Live-backend accuracy calibration (`covered → calibrated`) and the live end-to-end runtime-transport proof are separate human-supervised steps and are **not** required here.
- [ ] The spec/PR **names the verification boundary** (§5): `validate-adapters` + grep + grader-green prove the *wiring*, not the live runtime transport swap.

### Gate
- [ ] `faff validate-adapters` exits 0 after all edits.

**Integration smoke test:**
```
PROCEDURE smoke():
  1. Apply edits A, B, C.
  2. RUN `faff validate-adapters`            → EXPECT exit 0 (3-seam frontmatter reconciles;
                                                covered KIND has its cases; KINDS===registry keys).
  2b. RUN `node --test test/eval-grader.test.mjs` → EXPECT pass (corpus count now 81; validateCase
                                                over both new cases).
  3. RUN the fixed-env grader assertion       → EXPECT predictedSet(prdr-yagni){challenge_outcome:
                                                "overturned"} == ["overturned"]; {"survived"} == [];
                                                validateCase(prdr-yagni-00{1,2}) passes. (No live backend.)
  4. grep the YAGNI Phase-2 transport prose   → EXPECT zero `review-call.mjs` / `--diff` matches
     (adversarial-review new section + faff-plot Step 5c).
  5. grep frontmatter + registry              → EXPECT `prdr-yagni` present in both, surfaced to
                                                faffter-dark-adversarial-review.
```

confidence: high
spec-review: approve
