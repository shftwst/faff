# FAFF-269 — Design-settle spike: infosec spec-review lens repo-specific threat context (a learned per-repo threat prior)

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high. Full spec on Linear FAFF-269.

This is the spec for the spike, not the design it produces. Audience: the agent running the spike, and human reviewers checking it stayed inside its box.

This spec scopes a **timeboxed investigation** of one question the FAFF-9 spec-stage-review decomposition explicitly parked: the infosec lens today runs a *generic* threat checklist (authn/authz, secrets, input surface, blast radius, failure-as-bypass) with **no learned per-repo threat prior** — how would it acquire repo-specific threat context *without a human*, and is that worth building over the generic checklist at all? A null result — "generic is sufficient, close the sub-question" — is an explicitly valid outcome. The deliverable is a refutation log + an ADR (or a null-result ADR), following the house spike shape (ADR-0029/0039/0040; FAFF-313 the nearest precedent).

## 1. WHY — Problem and Principles

**The load-bearing model:** the infosec lens's `--system` prompt file **already names its own extension point** — FAFF-267's committed spec (docs/specs/2026-06-27-FAFF-267-…-design.md:34) reserves "the infosec lens's `--system` prompt file + an optional grounding input, swappable later without touching the aggregation" for exactly a learned per-repo prior, deferred to design-register E and "a future ticket". This spike *is* that ticket, and its whole job is to decide **whether to occupy that named seat, and if so with what** — not to build the occupant. The prior, if it exists, is repo-specific threat context an autonomous infosec refuter reads *in addition to* the five generic items — so the spike must show that context produces a measurable catch it would otherwise miss, or conclude it does not.

**Problem:** the generic checklist is repo-agnostic by construction. A real faff-specific threat ("the run-ledger is forgeable because lanes share uid+fs" — ADR-0039; "grounding claims are untrusted under the no-execute floor" — ADR-0040) is only caught if the reviewer *already knows faff's threat model*, which today it does not carry. Three unknowns block any build: **what produces the prior** (mined repo surfaces? a maintained config? intake-time Q&A?), **where it is stored and how the lens consumes it**, and **whether the lift over generic is worth the cost**. Each is a design question, not a coding task — so this is a design-settle spike whose output is an ADR that makes any follow-on build mechanical, or that closes the sub-question negatively.

**A ticket-premise correction the spike must carry (a prep finding, stated up front, not settled here).** The ticket's stated open question — "does a threat prior leak code context into the code-blind lane?" — is **misspecified against the as-built code**, and the spike must re-cast it rather than answer it as posed:

- The **evaluator** (faffter-noon-evaluate) is code-blind by construction — the `holdout-verdict` contract asserts `code_blind:true` and it never reads the diff/codebase. But the **spec reviewer is not that lane** — it *already* reads the files the spec names plus docs/adr/ (verified: prep passes "repo architecture context" = gateway + named files + ADRs). So "a threat prior leaks code into a code-blind lane" **does not apply to the reviewer**: the reviewer is not code-blind, and the prior would be one more `--context`/`--system` input alongside inputs it already takes.
- The **real** infosec concern with a stored prior is **data-sensitivity / integrity**, the same shape as the run-ledger forge risk FAFF-325 addresses: a prior artifact on disk in `.faff/` is readable and **forgeable** by the build lane (ADR-0039's shared-uid+fs finding). If the prior encodes intel like "the API key is validated *here*, not *there*", a compromised or adversarial build lane could read it to target an attack, or forge it to *suppress* a true infosec objection. This is the concern the spike investigates; the code-blindness framing is retired.

**Design principles:**

**Decisions or a clean null, not a design note.** Each spike question closes with a decision + rationale in the ADR (or a recorded null result); residuals become explicit boundaries with costed follow-ups. The three candidate mechanisms below are *inputs to refute*, never a foregone pick — pre-selecting one would make the refutation theatre.

**The value case is the load-bearing one, and it can come back negative.** The spike does not merely design a mechanism — it must show the mechanism *earns its keep* against the generic checklist on real ground truth, using the existing eval harness. "No measurable lift → don't build, close design-register-E's infosec sub-question" is a first-class, shippable outcome (a null-result ADR), not a spike failure.

**Every learned-prior candidate inherits design-register E's non-negotiable guardrail.** Any learned adjustment must be **Logged** (what the prior asserts + the observation that drove it), **Explainable** (a rationale a human can read, not an opaque weight), and **Reversible/overridable** (a human can see, pin, or revert it) — self-learning.md:37–41. A per-repo prior is project-private, which is *legitimate*; but any cross-project promotion is barred by the **meta-only firewall** (never carry code/secrets/business-specifics between repos — only calibration shapes/failure taxonomies transfer). The spike must not propose a mechanism that violates either.

**The deterministic-miner model may not fit — that tension is a primary refutation, not a footnote.** The existing infra-profile acquirer (`faff profile mine`) is deterministic, read-only, no-LLM/network/subprocess (scans CI/Dockerfile/compose/terraform/manifests). A threat prior needing *semantic* understanding (trust boundaries, secret-handling patterns, prior-fix intent) does **not** fit that model — it would need either an LLM-based acquirer in a *distinct* slot or a schema-v2 profile section. Whether the prior is an *extension of repo-mining* or a *distinct artifact* is the spike's Q about production, and this constraint is why it is genuinely open.

**Reference context:**

| System | Where | Relevance |
|---|---|---|
| Infosec lens today (L4 refuter) | `plugin/skills/faffter-dark-spec-review/refute-infosec.md` (5 generic items, headed "this v1 has no learned per-repo threat prior") | The prompt file the spike decides whether/how to augment — the named extension point |
| Infosec lens today (L1–L3) | `faffter-noon-spec-review/SKILL.md` (infosec row = generic checklist; an infosec BLOCKER rolls up to `needs-human` — "threat calls need a human at L1–L3") | The lower-level pass the same prior would (or would not) also feed |
| The named extension point | `docs/specs/2026-06-27-FAFF-267-…-design.md` :34, :85, :210 (`--system` prompt file + optional grounding input, swappable without touching aggregation) | The committed seam this spike occupies or leaves empty |
| Review transport | `eval/…` / `review-call.mjs` (`--system` + `--context` + `--diff`), used verbatim by the L4 refuter | How a prior would reach the lens (extra `--context` file / augmented `--system`) with no aggregation change |
| Infra-profile acquirer (candidate reuse) | `faff profile mine\|show\|validate` (`bin/faff` ~:5686, `mineRepo` ~:7746); ADR-0013 storage split | The deterministic miner + the `.faff/` machine-acquired ⊕ `.faffrc.yaml` human-override pattern a prior might reuse — or fail to fit |
| Storage + forge constraint | ADR-0013 (gitignored `.faff/` regenerable, human override wins field-by-field); ADR-0039 (:25, :40 shared-uid+fs, on-disk artifacts forgeable pre-FAFF-325) | Where a prior lands and why its integrity is the real infosec question |
| Grounding slot (candidate B's trust model) | ADR-0040 (grounding is evidence-only, advisory, no-op-by-absence, claims are untrusted data under the no-execute floor) | The trust contract mechanism (B) would reuse if the prior is LLM-synthesized |
| Design register | `design/future-directions.md` E → FAFF-13; `design/spec-stage.md` §A open Q (:31); `design/self-learning.md` (:18–19 "learned repo-specific checklist"/"learned prior the spec reviewer consults"; :37–41 Logged/Explainable/Reversible; :27 meta-only firewall) | The parked branch this spike resolves, and its guardrails |
| Eval harness (measures lift) | `eval/grader.mjs` KINDs `refutation-spec` (closed_set = objecting lens names, e.g. `["infosec"]`) + `spec-verdict` (spec-verdict-003 = the one existing SSRF→needs-human infosec case); `eval/cases/refutation-spec-00{1..6}`; `eval/seam-registry.json` | The instrument for the primed-vs-generic catch-rate experiment; FAFF-283 owns the unmeasured refuter catch-rate dimension a primed-vs-generic run fits |
| Ground truth for the experiment | FAFF-316 trust-gate audit findings (→ FAFF-376/378/379) + FAFF-323 coherence audit (`docs/audits/2026-07-04-faff-323-…`); faff-as-subject security ADRs 0009/0010/0034/0039/0040 | Real repo-specific security issues to turn into primed-vs-generic spec fixtures; the ADRs a faff threat-miner would mine |

**Scope statement:** this spike is the design gate on design-register-E's infosec sub-question, sitting inside the "Trustworthy lights-out — harden & broaden (post-v1)" project alongside FAFF-266/267 (the shipped L1–L3 and L4 reviewers whose infosec lens it would extend); it writes docs and tracker artifacts only.

## 2. OUT OF SCOPE

- **Building any threat-prior acquirer** (a miner, an LLM synthesizer, a config schema) — the spike decides *whether and what*, not *how implemented*. Extension point: `faff profile`-style acquirer slot, or a new distinct slot, per the spike's own producer decision.
- **Writing the augmented `--system` prompt or the `--context` grounding file** — even if the spike recommends GO, the prompt/artifact is the follow-up build ticket's work. Extension point: `refute-infosec.md` + the FAFF-267-named optional grounding input.
- **Changing lens aggregation, lens selection, or the verdict contract** — FAFF-267 aggregation is untouched by design (the extension is `--system`/`--context` only); lens *selection* by change-surface is FAFF-268. Extension point: `enabled_lenses` resolved upstream.
- **The L1–L3 `needs-human`-on-infosec-blocker rollup** — a design constraint the spike respects (threat calls stay human-gated at L1–L3), not a thing it changes.
- **Cross-project threat learning / a `~/.faff/` shared store** — that is design-register E's cross-project half behind the meta-only firewall (FAFF-13). This spike is strictly per-repo; it may only *name* the firewall as a boundary a future cross-project extension must honour.
- **FAFF-325 (fs-integrity mechanism)** — the spike positions a stored prior's forge exposure on that mechanism's need; it does not design the integrity implementation.
- **Building or recording eval baselines** — the spike may *add* repo-specific-threat cases and *run* generic-vs-primed comparisons to measure lift, but accepting/committing a frontier baseline is a separate human-supervised step (never required to close the spike).

## 3. WHAT — The spike's agenda (open by design) and its vocabulary

**Vocabulary:**

| Term | Definition |
|---|---|
| generic checklist | The five repo-agnostic items in `refute-infosec.md` today (authn/authz · secrets · input surface · blast radius · failure-as-bypass) |
| threat prior | A repo-specific artifact the infosec lens would consume *in addition to* the generic checklist — encoding this repo's trust boundaries, secret-handling patterns, prior security fixes/ADRs |
| primed vs generic | The experiment's two arms: the infosec lens run with the prior in `--context`/`--system` (primed) vs the shipped generic-only lens |
| catch-rate lift | The delta in true infosec objections raised on the ground-truth fixture set, primed minus generic — the value measure |
| producer | Whatever *emits* the prior — candidate forms: a deterministic repo-miner, an LLM synthesizer, a maintained config, intake-time Q&A |
| the forge/integrity concern | The re-cast infosec risk: a `.faff/` prior is readable + forgeable by the build lane (ADR-0039), so it could be read to target an attack or forged to suppress a true objection |
| null result | The valid outcome "no measurable lift → don't build; close design-register-E's infosec sub-question" |

**The three questions the spike will ANSWER (its agenda — open by design, NOT spec decisions, NOT markers).** These are the ticket's three "decisions the spike must make". They stay open here on purpose; settling them *is* the spike's work product:

- **SQ1 — What produces the prior?** Mined from repo surfaces (auth modules, secret handling, external integrations, prior security fixes/ADRs), a maintained config, or intake-time Q&A — and is it an **extension of the infra-profile acquirer** (repo-mining) or a **distinct artifact**? The deterministic-miner-doesn't-fit-semantic-content constraint (WHY) makes this genuinely undecided.
- **SQ2 — Where is it stored and how does the infosec lens consume it?** Candidate: `.faff/` machine-acquired ⊕ `.faffrc.yaml` human-override (the ADR-0013 pattern), consumed as an extra `--context` file or an augmented `--system` per the FAFF-267 seam — but subject to the re-cast **forge/integrity** concern (a `.faff/` prior is build-lane-forgeable) and the freshness/staleness problem specs themselves have (no auto-invalidation in the profile miner today).
- **SQ3 — Is the value worth building over the generic checklist?** Decided by measured **catch-rate lift** on the ground-truth set (below), not by intuition. A null answer closes the sub-question.

**Sub-agenda the spike also resolves (open):** the freshness/staleness story as the repo evolves; the interaction with the re-cast forge/integrity constraint (not the retired code-blindness one); and the precise relationship to the infra-profile acquirer (extension vs distinct slot vs schema-v2 section).

**Three candidate mechanisms the spike weighs via refutation (inputs, not a pre-pick).** The spike must attempt to break each, not choose one up front:

- **(A) Deterministic-ish mined artifact** passed as extra `--context` to the infosec refuter — measure catch-rate on the historical audit findings as ground truth. Refutation pressure: does semantic threat content fit a deterministic miner at all?
- **(B) LLM-synthesized prior via the existing grounding slot** (ADR-0040) as an **advisory** consumer — reuses a proven trust model, but advisory-only with named injection residuals (grounding claims are untrusted data). Refutation pressure: does an LLM-authored prior stay inside the evidence-only, no-op-by-absence contract?
- **(C) NULL result** — the five generic items suffice, no measurable lift → build nothing, close the sub-question. Refutation pressure: does the ground-truth set actually contain catches generic misses, or is the experiment under-powered?

**Invariants the spike must not contradict** (the constraint set every candidate is refuted against): ADR-0010 (no faff sandbox; assert-not-launch), ADR-0039 (shared-fs on-disk artifacts forgeable pre-FAFF-325), ADR-0040 (grounding claims untrusted under the no-execute floor), ADR-0013 (the `.faff/` machine-acquired + `.faffrc.yaml` human-override storage pattern), and design-register E's **Logged/Explainable/Reversible** + **cross-project meta-only firewall**.

## 4. HOW — Spike method and deliverables

**Method — refutation-log spike** (the ADR-0029/0039/0040 shape, FAFF-313 the nearest sibling): for each question, state the evidence-anchored hypothesis, adversarially attempt to break it against the invariant set and threat cases, record each attempt + outcome, and close as survived / amended / narrowed / strengthened with rationale + residuals. The value question (SQ3) additionally runs the **primed-vs-generic experiment** on the eval harness so the GO/NO-GO is measured, not asserted.

```
PROCEDURE run_spike:
  1. Re-verify ground truth (the Assumptions list) against the tree + tracker:
     - refute-infosec.md still the 5 generic items; FAFF-267's :34 extension line intact
     - eval refutation-spec KINDs/closed_set + spec-verdict-003 still as read
     - the FAFF-316/323 audit findings still exist and are still repo-specific-threat-shaped
     - `faff profile mine` still deterministic/read-only/no-LLM; ADR-0013/0039/0040 live
       (`faff adr live-decisions`)
  2. Build the GROUND-TRUTH FIXTURE SET (the experiment's spine):
     - turn N (>=3) FAFF-316/323 audit findings into repo-specific-threat spec fixtures
       (a spec whose approach carries the real faff-specific threat), each with an oracle
       (`closed_set` = ["infosec"] where the primed lens SHOULD object)
     - include >=1 clean near-miss (security-adjacent but sound) so a primed lens can be
       shown NOT to cry wolf — mirror refutation-spec-006
  3. FOR each question SQ1..SQ3:
     a. State the hypothesis (evidence-anchored, from WHAT — not foregone)
     b. Attempt >=2 distinct refutations: invariant-contradiction (ADR-0010/0039/0040/0013,
        design-E guardrail) / threat-case (the forge/integrity concern) /
        owner-boundary (miner-vs-distinct-slot; per-repo-vs-cross-project firewall) /
        YAGNI (does generic already catch it?)
     c. Record each attempt + outcome in the refutation log
     d. Close: survived / amended / narrowed / strengthened + rationale + residuals
  4. RUN the primed-vs-generic experiment for SQ3:
     - arm 1 (generic): the shipped refute-infosec.md over the fixture set
     - arm 2 (primed): refute-infosec.md + a prototype prior in --context/--system
       (prototype ONLY as an experiment input — NOT a shipped artifact; deleted after)
     - score both via the existing refutation-spec grader; record the catch-rate delta
       + the near-miss false-positive count
  5. Author the ADR (Context/Decision/Consequences) — GO-narrow (which mechanism, at
     what trigger) OR a NULL-RESULT ADR (generic sufficient; sub-question closed) — number
     via `faff adr next-number`; re-check before merge (concurrent-graft collision precedent)
  6. Post tracker artifacts: a scope/first-slice framing on the build follow-up if GO-narrow
     (or a null-result note); a catch-rate note on FAFF-283's dimension; a pointer on the
     design-register E thread (FAFF-13) recording the sub-question's disposition
  7. Land ADR + refutation log via PR on this ticket's branch
```

**Deliverable placement:**

- **ADR + refutation log** → committed on this ticket's branch, shipped by PR: `docs/adr/00NN-…md` + `docs/spikes/2026-07-05-FAFF-269-infosec-threat-prior-refutation-log.md`.
- **Fixture set** → the repo-specific-threat cases added under `eval/cases/` (as `refutation-spec-…` cases) so the experiment is reproducible and the catch-rate dimension has durable fixtures; accepting any *baseline* value is out of scope (human-supervised).
- **Tracker pointers** → a catch-rate note on FAFF-283 (its unmeasured dimension); a disposition note on the design-register E thread (FAFF-13); if GO-narrow, a first-slice framing comment on the build follow-up naming the chosen mechanism, its storage/consumption seam, and its trigger — a scope note, not a spec (it gets its own prep when its turn comes).

**Timebox:** one fable-week working day. Overrun valve (narrow-boundary principle): land the settled questions, narrow the rest, file costed follow-ups — do not force a binary the evidence does not support.

**Failure modes — how the spike could be wrong, and how you'd notice:**

- **The experiment is under-powered.** The failure: the fixture set has too few, or too-obvious, repo-specific threats, so *generic already catches them* and "no lift" is an artefact of weak ground truth, not a true null. How you'd know: arm-1 (generic) catch-rate is already near-ceiling on the fixtures. What it means: **narrow, don't declare** — widen/deepen the fixture set (or record "value undecidable at this fixture strength; a real null needs a stronger corpus") rather than banking a false negative.
- **A genuine null result** (a valid outcome, not a gap to hide). The failure to *name*: primed shows no catch-rate lift over generic on a decent corpus. How you'd know: arm-2 minus arm-1 ≈ 0 with no near-miss regressions. What it means: **null-result ADR** — build nothing, close design-register-E's infosec sub-question, record the corpus + numbers so a future re-open has a baseline.
- **The prior can't stay inside its trust contract.** The failure: candidate B's LLM-synthesized prior smuggles authority — a refuter treats a *claim* in the prior as fact rather than advisory evidence, contradicting ADR-0040. How you'd know: a refutation case where a forged/wrong prior line flips a verdict. What it means: the mechanism is constrained to evidence-only/advisory or dropped; the residual (integrity) is pinned to FAFF-325.
- **The forge/integrity concern has no cheap answer.** The failure: a `.faff/` prior is build-lane-forgeable and nothing below FAFF-325 contains it, so a prior that *suppresses* a true objection is reachable. How you'd know: a threat case with no mitigation at the current rung. What it means: the prior's build is gated behind FAFF-325 (recorded as a dependency), or the human-override half (ADR-0013's `.faffrc.yaml`, version-controlled) carries the load-bearing content — an amended-survives outcome, not a spike failure.
- **Premise drift.** FAFF-266/267/283 (or the FAFF-316/323 audit findings) move — re-sliced, cancelled, closed — between spec and spike. How you'd know: step-1 ground-truth re-verify. What it means: re-scope or park; never design against a stale target.

**Anti-pattern:** settling SQ1–SQ3 in this spec. Why: the spike *is* the settlement — the hypotheses and the three candidate mechanisms are inputs, the ADR is the output.

**Anti-pattern:** writing any shippable miner, `--system` prompt, config schema, or grounding artifact during the spike. Why: the deliverable is decisions (docs + tracker + reproducible fixtures). The prototype prior in step 4 is an *experiment input only* — it is deleted after the measurement and never lands; even the assertion/consumption code belongs to the follow-up build ticket the ADR costs out.

**Anti-pattern:** answering the ticket's code-blindness open question as posed. Why: it is misspecified against as-built (the reviewer is not code-blind); the spike re-casts it to the data-sensitivity/integrity concern and records the correction in the log.

## 5. Scenarios

```
Given the accepted ADR
When a future build agent (or a reader closing design-register E's infosec sub-question) reads it
Then the disposition is unambiguous — either GO-narrow (which producer, where stored, how the lens
     consumes it, at what trigger) or a recorded NULL with the corpus + catch-rate numbers that justify it
```

```
Given the primed-vs-generic experiment
When both arms are scored on the repo-specific-threat fixture set via the existing refutation-spec grader
Then the ADR cites the measured catch-rate delta AND the near-miss false-positive count — the value
     claim is a number, not an assertion
```

```
Given any candidate mechanism the ADR advances or rejects
When it is checked against the invariant set
Then it is shown to preserve ADR-0010 (no faff sandbox), ADR-0040 (advisory/evidence-only), ADR-0013
     (machine-acquired ⊕ human-override storage), the forge/integrity residual (ADR-0039 → FAFF-325),
     and design-E's Logged/Explainable/Reversible + per-repo-only firewall — or is rejected for breaching one
```

Non-functional assertions:

- Every SQ1–SQ3 decision (or the single null) in the ADR cites >=2 recorded refutation attempts in the log.
- SQ3's decision cites a measured catch-rate delta from a runnable experiment, not intuition; a null result is stated as such with its numbers.
- The spike ships docs + reproducible eval fixtures + tracker artifacts only — no shippable miner, prompt, schema, or grounding file; no accepted eval baseline.
- The ADR records the ticket's code-blindness-question correction (reviewer is not code-blind; the real concern is the forge/integrity one).

## 6. DESIGN DECISION RATIONALE

These are the **spike-shape** decisions this spec closes — *how the spike is run*. The three agenda questions (SQ1–SQ3) and the three candidate mechanisms are the spike's work product, deliberately open, and carry no marker here.

**Timebox posture?** Same tension as every fable-week spike: open-ended design burns the scarce window; too tight forces the binary the refutation precedent warns against. **Chosen:** one fable-week working day, narrow-boundary principle as the overrun valve.

**Spike method?** House precedent (ADR-0029/0039/0040; FAFF-313) is hypothesis → adversarial refutation → decision-or-narrowing, log committed. **Chosen:** refutation-log spike, >=2 distinct attempts per question, log committed with the ADR.

**How is the value question decided — intuition or measurement?** SQ3 is the load-bearing question and the one most prone to hand-waving; the eval harness already has the exact KIND (`refutation-spec`, closed_set = objecting lens). **Chosen:** a measured primed-vs-generic catch-rate experiment on a repo-specific-threat fixture set decides GO/NO-GO; the delta (and near-miss false-positive count) is cited in the ADR. Rationale: turns "is it worth it?" into a number and makes the null result defensible.

**What is the GO/NO-GO criterion?** **Chosen:** GO-narrow requires a *positive, non-artefactual* catch-rate lift (primed catches true repo-specific threats generic misses) with no near-miss false-positive regression; absent that, the outcome is a **null-result ADR** closing design-register-E's infosec sub-question. Rationale: a symmetric criterion where "don't build" is a first-class result, not a fallback.

**What is the ground-truth set?** **Chosen:** the FAFF-316 trust-gate audit findings (→ FAFF-376/378/379) + the FAFF-323 coherence audit turned into repo-specific-threat spec fixtures, with faff's own security ADRs (0009/0010/0034/0039/0040) as the content a threat-miner would mine; >=1 clean near-miss included. Rationale: real, already-triaged faff-specific security issues are exactly the "would generic have caught this?" corpus, and faff-as-subject keeps the experiment self-contained.

**Where do deliverables land?** **Chosen:** ADR + refutation log via PR on this branch; reproducible fixtures under `eval/cases/`; tracker pointers on FAFF-283 (catch-rate dimension), the design-register E thread (FAFF-13, disposition), and — only if GO-narrow — a first-slice framing on the build follow-up. No new spec is attached to any of them (each gets its own prep when its turn comes). Rationale: the ADR is the durable decision; fixtures make the value claim reproducible; pointers land where the next reader will look.

**Do the candidate mechanisms (A/B/C) bind the spike?** Pre-picking would make refutation theatre; ignoring verified ground truth would waste it. **Chosen:** A/B/C are evidence-anchored candidates the spike must attempt to break — the ADR may advance, combine, narrow, or reject any of them (including landing on C, the null) with recorded rationale; an overturned candidate is a successful spike outcome.

**How is the ticket's misspecified code-blindness question handled?** **Chosen:** re-cast it — the spec reviewer is not code-blind (it already reads named files + ADRs), so the real infosec concern is data-sensitivity/integrity (a `.faff/` prior is build-lane-forgeable, ADR-0039), the same shape as FAFF-325; the spike records this correction in the log rather than answering the question as posed. Rationale: answering a misspecified question wastes the window and banks a wrong premise.

**Scope boundary — design-settle only?** **Chosen:** the spike produces decisions (docs + tracker) + reproducible fixtures, and a *throwaway* prototype prior used solely as an experiment input; it ships no miner, prompt, schema, or grounding artifact, and accepts no eval baseline. Rationale: ADR-0010/the house spike shape make the build the follow-up ticket's mechanical work, gated on this ADR.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none escalated to a human to *start*. SQ1–SQ3 (and the sub-agenda: staleness, the forge/integrity interaction, the miner-vs-distinct-slot relationship) are the spike's scoped deliverable — closing them *is* the work — so this spec carries no `Punt:` markers.

**Assumptions:**

- **Assumes:** `refute-infosec.md` is still the five generic items headed "no learned per-repo threat prior", and FAFF-267's committed spec still names the `--system` + optional-grounding extension point (:34). Validation: read both at spike start; on divergence, code/spec wins and the divergence is noted in the log.
- **Assumes:** the eval harness still exposes `refutation-spec` (closed_set = objecting lens names) + `spec-verdict` (spec-verdict-003 the SSRF infosec case), gradable by the existing `grader.mjs`, with `seam-registry.json` mapping `refutation-spec → faffter-dark-spec-review`. Validation: grep `grader.mjs` KINDS/CLOSED_SET_KINDS + the case files before building fixtures.
- **Assumes:** the FAFF-316 trust-gate audit findings (FAFF-376/378/379) and the FAFF-323 coherence audit (`docs/audits/2026-07-04-faff-323-…`) still exist and are still repo-specific-threat-shaped enough to fixture. Validation: fetch each from the tracker + read the audit doc at spike start; if thinned, widen the corpus or record the under-powered-experiment failure mode.
- **Assumes:** `faff profile mine` is still the deterministic, read-only, no-LLM/network/subprocess miner with the ADR-0013 storage split, consumed today only by faffter-noon-architecture (not the spec-review lenses). Validation: grep `mineRepo`/`cmdProfile` (~`bin/faff:7746/7881`) + ADR-0013 before writing SQ1/SQ2.
- **Assumes:** ADR-0010/0013/0039/0040 and design-register E's guardrails are live and unsuperseded. Validation: `faff adr live-decisions` at spike start.
- **Assumes:** the next ADR number is free at authoring time. Validation: `faff adr next-number` at authoring, re-checked immediately before merge (concurrent-graft collision precedent).

## 8. DONE — Definition of Done

### From WHY
- [ ] An ADR (Context/Decision/Consequences) is accepted on this ticket's branch that either (a) GO-narrows — names the chosen producer (SQ1), storage + lens-consumption seam (SQ2), and the trigger/first-slice framing — or (b) records a NULL result closing design-register-E's infosec sub-question, with the corpus + numbers justifying it.
- [ ] The ADR records the ticket's code-blindness-question correction: the spec reviewer is not code-blind; the real infosec concern is the data-sensitivity/integrity (forge) one, positioned against ADR-0039/FAFF-325.

### From WHAT (the spike's agenda)
- [ ] SQ1 closed: the ADR states what produces the prior and whether it extends the infra-profile acquirer or is a distinct artifact/schema-v2 section — grounded in the deterministic-miner-vs-semantic-content tension.
- [ ] SQ2 closed: the ADR states where the prior is stored (against the ADR-0013 pattern), how the infosec lens consumes it (via the FAFF-267 `--context`/`--system` seam), and how the forge/integrity + staleness residuals are handled.
- [ ] SQ3 closed: the ADR states the GO/NO-GO with a cited measured catch-rate delta + near-miss false-positive count; a null result is recorded as such.
- [ ] The candidate mechanisms A/B/C are each refuted in the log (advanced/combined/narrowed/rejected), none pre-picked; design-E's Logged/Explainable/Reversible + per-repo-only firewall are shown honoured (or the mechanism rejected for breaching one).

### From HOW (deliverables and method)
- [ ] The refutation log is committed alongside the ADR, >=2 recorded refutation attempts per question, each with an outcome.
- [ ] The repo-specific-threat fixture set (>=3 threat cases + >=1 clean near-miss) is added under `eval/cases/` as reproducible `refutation-spec` cases; the primed-vs-generic experiment is runnable against them.
- [ ] A catch-rate note is posted on FAFF-283; a disposition note on the design-register E thread (FAFF-13); if GO-narrow, a first-slice framing comment on the build follow-up.
- [ ] The spike's PR contains docs + eval fixtures + tracker artifacts only — no shippable miner/prompt/schema/grounding file, no accepted eval baseline (the step-4 prototype prior is deleted, not committed).
- [ ] `faff adr validate` passes after the ADR lands.
- [ ] Timebox respected, or the overrun narrowing (what settled, what was narrowed, follow-ups filed) is recorded in the ADR.

**Eval coverage:** the spike *adds* eval fixtures (repo-specific-threat `refutation-spec` cases) and registers no new KIND — it reuses the existing `refutation-spec` KIND + `faffter-dark-spec-review` seam-registry row. Accepting/recording any baseline value is the separate human-supervised step and is not required by this DONE. (If the spike's GO recommendation later introduces a *new* runtime judgement seam, that seam's KIND + case + registry row are its follow-up build ticket's DONE, not this spike's.)

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Open the merged ADR → SQ1/SQ2/SQ3 each have a Decision subsection (or one NULL
     decision), and the code-blindness correction is recorded
  2. Run `faff adr validate` → exit 0
  3. Open the refutation log → >=2 attempts per question; A/B/C each refuted
  4. `ls eval/cases/refutation-spec-*.json` → the new repo-specific-threat fixtures + near-miss present
  5. Open FAFF-283 and the design-register E thread → each has the spike's pointer comment
  6. `git diff main` on the spike PR → only docs/ + eval/cases/ changed (no shippable acquirer code)
```

confidence: high

## Methodology critique

**Methodology:** faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4)** — Mostly sound, one load-bearing tension worth naming. The spike shape is correct: a timeboxed design-settle investigation whose deliverable is an ADR + refutation log, deferring any build to a follow-up (GO-narrow) or closing the sub-question negatively (null) — that is exactly the right-sized cut for an open design question, and it correctly refuses to build the occupant of the FAFF-267 seat. The genuine risk to the one-day box is that the primed-vs-generic experiment is a **mini-build inside the spike**: turning >=3 FAFF-316/323 audit findings into `refutation-spec` spec fixtures *with oracles*, adding a >=1 clean near-miss, wiring a throwaway prototype prior into `--context`/`--system`, and scoring two arms through the grader — that fixture construction is the heaviest single sub-deliverable and could plausibly consume most of the day on its own, before the refutation log for three questions (>=2 attempts each) and the ADR are even started. The spec is honest about this: it carries the overrun valve (land the settled questions, narrow the rest, file costed follow-ups) and names the under-powered-corpus failure mode, which is the right release valve rather than forcing a binary. What to do: keep the fixture floor at the stated minimum (3 + 1) and treat the experiment as the day's spine — if the fixtures alone eat the box, that is a *narrow* outcome ("value undecidable at this fixture strength"), not a reason to expand the timebox. Do not let fixture polish crowd out the refutation log, which is the durable artifact.

**Workstream fit? (principles 1, 5)** — No issues. The ticket already sits in "Trustworthy lights-out — harden & broaden (post-v1)" alongside the shipped L1–L3/L4 reviewers (FAFF-266/267) whose infosec lens it would extend — an outcome-led home, and the spike is cohesive with that stream's one outcome (a trustworthy autonomous reviewer). A one-day research spike is *not* a distraction from higher-value hardening here: it is cheap, it de-risks a named extension seat that FAFF-267 deliberately left open, and — critically — its null branch is itself delivery value (it closes design-register-E's infosec sub-question rather than leaving it as standing ambiguity that re-surfaces every time someone touches the infosec lens). Sequencing relative to the harden work is fine: the spike doesn't depend on the forge-integrity mechanism (FAFF-325) shipping first — it only *positions* the prior's eventual build behind it.

**Deps surfaced? (principle 6)** — Well-surfaced, two things to tighten. The load-bearing inputs are all named in prose (FAFF-267 the extension seat, FAFF-283 the unmeasured catch-rate dimension the experiment feeds, FAFF-13 the design-register-E home, FAFF-316/323 the ground truth, FAFF-325 the forge residual). Correctly, none of these is drawn as a `blockedBy` edge: FAFF-316/323 are already-shipped audit artifacts (read-only inputs, not pending work — a blocker link on Done work would be wrong), and the spec handles their drift risk through the step-1 re-verify + the premise-drift failure mode rather than a false edge. That is the right call. Two residuals:
- **Eval-fixture collision.** Adding files under `eval/cases/` as `refutation-spec-00N` risks a numbering/append collision with any concurrently in-flight eval work (the known append-conflict hazard on `eval/cases`). The spike *does* dodge the worse stack-conflict trap by reusing the existing `refutation-spec` KIND and `seam-registry.json` row (no new KIND, no `grader.mjs` KINDS edit, no registry append). What to do: pull fresh and check the highest existing `refutation-spec-*` index immediately before authoring the fixtures, and name from there — don't author against a stale tree.
- **Follow-up build ticket — file on GO, don't pre-file.** The spec references "a first-slice framing comment on the build follow-up," which reads as if a follow-up ticket already exists. Under the agile lens the follow-up's *existence* must be conditional on the ADR verdict: pre-filing a build ticket before the spike decides GO presupposes the outcome the spike exists to decide (the same trap principle-7 warns about). What to do: on GO-narrow, *file* the follow-up at that point (default landing — project-less Backlog, or into this same outcome project) and frame it; on null, file nothing. Make the spec's phrasing conditional so it can't be read as a standing pre-commitment to build.

**Risk profile? (principle 7)** — No issues; this is the spec's strongest axis. A spike is the de-risk instrument, and this one is honestly framed: the GO/NO-GO criterion is **symmetric** (GO-narrow needs a *positive, non-artefactual* lift with no near-miss regression; absent that, a null-result ADR is a first-class shippable outcome), which is the direct antidote to the "spike that was always going to say GO" trap — candidate C (null) is a peer of A/B, not a fallback. The experiment is methodologically sound: it decides the load-bearing value question (SQ3) by measurement not intuition, front-loads that hardest question, names the under-powered-corpus failure mode with the correct response (narrow, don't declare a false negative when arm-1 is already near-ceiling), and includes the clean near-miss to prove the primed lens isn't just crying wolf. Harness-touch risk is contained: the prototype prior is throwaway and deleted, no eval baseline is accepted (the human-supervised step is explicitly out of scope), and the PR is docs + fixtures + tracker pointers only. The prep finding re-casting the ticket's misspecified code-blindness question into the real data-sensitivity/integrity (forge) concern is a genuine risk correction — it stops the spike banking a wrong premise, and correctly pins the residual to FAFF-325 rather than pretending to solve it.

confidence: high

spec-review: approve
