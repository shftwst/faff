# FAFF-313 — Design-settle spike: multi-cage L4 (per-lane container isolation + the outer orchestration layer)

> Spec: faffter-dark-nlspec · 2026-07-03 · interactive · confidence: high. Full spec on Linear FAFF-313.

This is the spec for a **design-settle spike**, not a code build. It scopes the work of deciding whether L4 needs per-lane container isolation or whether the evaluator-only hard sandbox is the sufficient stopping point — and, if per-lane cages are worth having, what outer orchestration layer launches them without breaking faff's assert-not-launch invariant. Audience: the agent running the spike, and human reviewers checking the spike stayed inside its box.

## 1. WHY — Problem and Principles

**The load-bearing model:** faff's isolation story has two distinct altitudes that must not be conflated — ADR-0010 bounds blast radius **to** the container ("the cage is the container's job; faff asserts, never launches, never self-grants"), and explicitly scopes isolation **within** the container out to FAFF-32/73. Today every lane shares one cage's permission envelope, so all within-cage isolation is *convention* (context isolation, code-blind-by-not-handing-it-the-code) — and per-lane *physical* walls would require something that does not exist: an **outer orchestration layer** that launches multiple cages, which by ADR-0010 faff itself can never be. The spike decides how far up the isolation ladder L4 must climb, and who owns the rungs faff cannot.

**Problem:** the lane diagram implies walls the runtime doesn't have — a stray repo path lets the evaluator read source (the trust anchor's blindness is attested, not enforced), and ADR-0039 proved the build lane shares uid+fs with the orchestrator's artifacts (the forge finding). Whether the remedy is per-lane cages, the evaluator-only sandbox (FAFF-276), or the narrower fs-integrity mechanism (FAFF-325) is undecided, and each lands on a different owner. This spike settles the scope call, the outer-layer shape, the docker precondition, and the vocabulary the decision is expressed in — as an ADR that makes the follow-on builds mechanical.

**Design principles:**

**Decisions, not a design note.** Each question closes with a decision + rationale in the ADR; residuals become explicit boundaries with costed follow-ups (the ADR-0029/0039/0040 spike shape). The ticket's own ADR-promotion-intent line — *"L4 v1 = one cage + context-isolated lanes; hard per-lane cages require an outer orchestrator that faff asserts-but-never-launches"* — is a hypothesis the spike must confirm, amend, or refute, not a foregone conclusion.

**ADR-0010's invariants are not re-litigable.** "faff implements no sandbox of its own" (ADR-0010:22), "the container is the substitutable mechanism, not a specific product" (:26–27), "blast radius **to** the container, not **within** it — within-container lane isolation is FAFF-32's" (:47), and the revisit trigger (:48a — finer-than-container lane isolation escalates via FAFF-32). The spike *extends* this boundary (that is the ticket's stated intent), it never weakens assert-not-launch or self-grants.

**Express the decision in FAFF-69's vocabulary without building the DSL** (the ADR-0040 pattern, per the reference-context comment on this ticket): per-lane cages are candidate values of a role's declared `isolation` field (FAFF-73's ceiling half), constrained by role `accesses` envelopes — the spike writes decisions in those terms; the loader/DSL that enforces them stays deferred per ADR-0038.

**Reference context:**

| System | Where | Relevance |
|---|---|---|
| Container assertion layer | `plugin/skills/faff/bin/faff` `containerCheck` ~:3919–3932, `cmdContainerCheck` ~:3944, `autonomous.require_container` warn/block knob | The assert-don't-implement mechanism any per-lane assertion would extend |
| L4 runner + guardrails | `LIGHTS_OUT_GUARDRAILS` ~:11400–11409, `lightsOutPreflight` ~:11515+, container refusal ~:11525 | Where a per-lane containment assertion would preflight |
| The as-built picture | `docs/architecture/l4-container-permission-model.svg` + `docs/architecture/l3-l4-architecture.md` (:18–34, :43–45) | Already draws one claude-box, context-isolated lanes, the FAFF-276 gap, and the outer HOST (laptop · CI runner · factory compute) with a human at the launch point |
| Blast-radius invariants | ADR-0010 (:22, :26–27, :46–48), ADR-0034 (:32 isolation revisit trigger), ADR-0037 (L4 forces appetite full), ADR-0039 (:25, :40 shared-fs forge + FAFF-325 integrity precondition) | The constraint set every candidate design is refuted against |
| Evaluator code-blindness as-built | `faffter-noon-evaluate/SKILL.md` (:10, :16, :29, :37), `holdout-verdict` contract `code_blind` check `bin/faff` ~:5587–5589, ~:5654–5656 | The attested-not-enforced wall FAFF-276 hardens |
| env slot docker dependency | `faffter-noon-env-compose/SKILL.md` :32 (`docker compose up -d` + health), FAFF-274 docker-gating (`FAFF_REQUIRE_DOCKER`, `docker info` probe) | The docker-inside-the-cage precondition Q3 pins |
| Secrets / lane state today | ADR-0010:46 (explicitly-forwarded env across the boundary), `design/faff-external-verification-brief.md` :37, :83, :106–108 (secret-store gap; dind/socket named) | What a per-lane cage would newly enforce (FAFF-32/104, unbuilt) |
| Vocabulary home | FAFF-69 body (role `accesses` / `isolation`), FAFF-73 (isolation as declared loader-enforced field, blocked by FAFF-72) | Where the decision's terms live; not built here |

**Scope statement:** this spike is the design gate between the shipped one-cage L4 v1 (ADR-0010/0036) and the hardening chain (FAFF-325 → FAFF-276 → any multi-cage build), inside the fable-week umbrella (FAFF-314); it writes docs and tracker artifacts only.

## 2. OUT OF SCOPE

- **Building the evaluator hard sandbox** — that is FAFF-276 (already filed, `faff-automation-hold`, framed by this spike as the first slice). Extension point: the evaluator invocation path in the beep-boop holdout phase + `faffter-noon-evaluate`.
- **Building the fs-integrity mechanism** — that is FAFF-325 (read-only ledger mount / orchestrator-verified signatures, from ADR-0039). The spike positions it on the ladder; it does not design its implementation.
- **The lane→secret visibility matrix + injector** — FAFF-32/FAFF-104. The spike names what a per-lane cage makes physically enforceable; the matrix itself stays theirs.
- **The FAFF-69/73 DSL** (roles, loader-enforced `isolation` field) — deferred per ADR-0038; FAFF-73 is additionally blocked by FAFF-72 (loader). The spike borrows the vocabulary only.
- **Building any outer orchestrator** (CI-launched cages, factory-compute runner, compose-of-cages) — by ADR-0010 that layer is *not faff*; the spike decides its required shape and the assertion seam faff exposes to it, nothing more.
- **claude-box changes** — claude-box is an external precondition (a separate project, recommended-not-required); any cage-image work lands there, not in this repo.

## 3. WHAT — Vocabulary and the Four Questions

**Vocabulary:**

| Term | Definition |
|---|---|
| cage | An OS-level container providing the ADR-0010 blast-radius boundary; today exactly one, human-launched |
| lane | An agent trust/visibility context (orchestrator / implementor / evaluator) — today context-isolated within the one cage |
| per-lane cage | A lane running in its own container, making its isolation a physical wall instead of a convention |
| outer orchestration layer | Whatever launches cage(s) — today a human (`docker run claude-box`); candidates: human, CI runner, factory-compute host. Never faff |
| assert-not-launch | ADR-0010's invariant: faff detects and refuses on missing containment (`container-check`), but never spawns a cage or self-grants permissions |
| isolation ladder | The ordered hardening rungs: context isolation (shipped) → fs-integrity mounts/signatures (FAFF-325) → evaluator-only hard cage (FAFF-276) → full multi-cage |
| lane-boundary intent | The declarative artifact by which faff would tell an outer layer what boundaries the lanes need — faff emits intent, the outer layer provisions, faff asserts the result |

The spike answers four questions. For each, the spec records the **evidence-anchored starting hypothesis** from prep's explore — an input the spike must confirm or refute, **not** a pre-made decision (see Design Decision Rationale, spike-shape decision 4).

**Q1 — Scope call: per-lane cages for every lane, or evaluator-only as the stopping point?** Starting hypothesis: **the ladder, not a binary** — v1 stays one cage + context isolation (the ticket's promotion-intent line); the next rungs in value order are FAFF-325 (fs-integrity — closes the ADR-0039 forge finding *and* the ADR-0034 ledger-content residual without any new cage) and FAFF-276 (evaluator hard sandbox — the trust anchor, the one lane whose *reads* must be walled, and per its own ticket a must-close before holdout verdicts gate merges); **full per-lane cages are not scheduled** — they become worthwhile only when a named trigger fires (e.g. FAFF-32's secret matrix needs physical enforcement, or the ADR-0034 revisit trigger fires). Each rung must name its trigger.

**Q2 — The outer orchestration layer: what launches per-lane cages, and how does faff hand intent to it?** Starting hypothesis: the outer layer is the existing **HOST** altitude (human today; CI runner or factory-compute later — the SVG already names all three), and the seam is **intent-out / assert-in**: faff emits a declarative lane-boundary intent artifact (the env-handle/profile contract shape — machine-readable, versioned), the outer layer provisions cages from it by whatever mechanism it owns, and each faff lane asserts its own containment at entry (a per-lane `container-check`-shaped preflight) and **refuses** if the boundary it was promised is absent. faff never gains a launch path; the human/CI/factory owns provisioning exactly as the human owns `docker run claude-box` today.

**Q3 — The docker-inside-the-cage precondition.** Starting hypothesis: name it explicitly as an **L4 launch precondition** (the env slot's `docker compose up` needs an engine reachable inside the cage), with the **mounted socket rejected for the build lane's envelope** — a host docker socket is root-equivalent host control, so a lane holding it has effectively escaped the cage (it can mount the host fs into a new container); docker-in-docker (or a rootless/isolated engine) bounds SUT containers inside the cage at some complexity cost. The precondition is documented + asserted (assert-don't-implement: a probe in the lights-out preflight naming *which* engine posture is present), never provisioned by faff. Whether socket-vs-dind is a hard rule or a documented-risk recommendation is the spike's call.

**Q4 — Vocabulary + what each rung makes enforceable.** Starting hypothesis: each ladder rung is a candidate value of a role's declared `isolation` field (FAFF-73's ceiling), e.g. the evaluator's `isolation` gaining an own-cage level whose `accesses` envelope physically excludes `repo`; FAFF-32's lane→secret matrix becomes *enforceable* (not just specifiable) only at the per-lane-cage rung, because only there does each lane get its own env; the decision text writes these as declared-field semantics so FAFF-73's eventual build has settled meaning — while building none of it (ADR-0038).

## 4. HOW — Spike Method and Deliverables

**Method — refutation-log spike** (the ADR-0029/0039/0040 shape): per question, state the hypothesis, then adversarially attempt to break it against the invariant set (ADR-0010/0034/0037/0039, the as-built runner, the trusted-spec carve-out) and threat cases, recording each attempt + outcome; a hypothesis that survives becomes the decision, one that breaks is replaced or narrowed.

```
PROCEDURE run_spike:
  1. Re-verify ground truth (the Assumes list below) against the tree + tracker
  2. FOR each question Q1..Q4:
     a. State the hypothesis (from WHAT)
     b. Attempt ≥2 distinct refutations (invariant-contradiction, threat case,
        owner-boundary violation, YAGNI/over-engineering)
     c. Record each attempt + outcome in the refutation log
     d. Close: Decision (survived / amended / narrowed) + rationale + residuals
  3. Author the ADR (Context / Decision / Consequences), number via
     `faff adr next-number` at authoring time; re-check before merge
  4. Post the tracker artifacts: a first-slice framing + any scope delta on
     FAFF-276; a ladder-position note on FAFF-325's home (ADR-0039 thread) if
     the decision moves it; pointers on FAFF-73 / FAFF-32 naming what the
     decision reserves for them
  5. Land ADR + refutation log via PR on this ticket's branch
```

**Deliverable placement:**

- **ADR + refutation log** → committed on this ticket's branch, shipped by PR (`docs/adr/00NN-…` + `docs/spikes/2026-MM-DD-FAFF-313-…-refutation-log.md`).
- **FAFF-276 comment** → the first-slice framing this ticket promised (how the evaluator cage sits on the decided ladder, what its trigger/priority is) — a scope note, not a spec; FAFF-276 keeps its `faff-automation-hold` and gets its own prep when its turn comes.
- **FAFF-73 / FAFF-32 pointers** → one comment each naming what the ADR reserves for them (declared-field semantics; the physically-enforceable secret matrix), so the seams are documented where their builders will look.

**Timebox:** one fable-week working day. On overrun: land the settled questions, narrow the rest per the narrow-boundary principle, file costed follow-ups.

**Failure modes — how the spike could be wrong, and how you'd notice:**

- **The outer-layer question resists settlement** (who owns the multi-cage orchestrator — human script, CI, a claude-box sibling project — may be genuinely undecidable before a consumer exists). How you'd know: Q2 refutations keep landing on "depends on the deployment host". What it means: **narrow, don't force** — settle the *seam* (the intent-out / assert-in contract shape and the per-lane assertion) and record "outer-layer owner unresolved; first consumer decides" as an explicit boundary with its unblocking precondition. The seam is the durable part; the owner can wait.
- **Evaluator-only proves insufficient.** The failure: a Q1 refutation shows an implementor-lane threat that neither FAFF-325 nor context isolation contains (i.e. only a build-lane cage would). How you'd know: a recorded threat case with no mitigation at the lower rungs. What it means: the ladder re-orders (a build-lane rung gains a nearer trigger) — an amended-survives outcome, recorded with the threat as rationale, not a spike failure.
- **Socket-vs-dind is a wash.** The failure: both engine postures carry disqualifying costs (socket = escape; dind = privileged inner daemon, its own regression). How you'd know: the Q3 threat table has no clean column. What it means: the precondition documents both with named risks and a recommendation, and the hard-rule question becomes a costed follow-up for claude-box (the external project that owns the cage image) — assert-don't-implement holds either way.
- **Premise drift.** FAFF-276/FAFF-325/FAFF-73 move (built, re-sliced, cancelled) between spec and spike; ADR-0039's follow-ups renumber. How you'd know: step 1's ground-truth re-verify. What it means: re-scope or park; never design against a stale target.

**Anti-pattern:** settling Q1–Q4 in this spec. Why: the spike *is* the settlement — hypotheses are inputs, the ADR is the output.

**Anti-pattern:** writing any launch tooling, Dockerfile, mount config, or preflight code during the spike. Why: the deliverable is decisions (docs + tracker); ADR-0010 makes the cage external, and even the *assertion* extensions belong to the follow-up build tickets the ADR costs out.

## Scenarios

```
Given the accepted ADR
When FAFF-276's eventual build agent reads its first-slice framing comment + the ADR
Then the evaluator cage's position on the isolation ladder, its trigger, and its
     required assertion seam are stated — no re-derivation needed
```

```
Given the decided outer-layer seam
When any candidate outer orchestrator (human script, CI, factory-compute) is walked
     through it on paper
Then faff's side never contains a launch/provision/self-grant step — only
     intent-out artifacts and per-lane assert-and-refuse
```

```
Given the decided docker precondition
When the build lane's declared accesses envelope is checked against it
Then a host docker socket is not inside the build lane's envelope (or the ADR
     records the explicit, argued exception)
```

Non-functional assertions:

- Every Q1–Q4 decision in the ADR cites ≥2 recorded refutation attempts in the log.
- The ADR names, for each isolation-ladder rung, its owner (faff-asserts vs outer-layer-provides vs external-project) and its trigger.
- The spike ships no production code, no schema file, no launch tooling — docs + tracker artifacts only.
- ADR-0010's wording is extended, never contradicted: the ADR must quote and preserve assert-not-launch, container-substitutability, and the blast-radius-to-not-within scoping.

## 6. DESIGN DECISION RATIONALE

These are the **spike-shape** decisions this spec closes. The four design questions themselves are the spike's work product, not decisions of this spec.

**One ADR or several?** The four questions interlock (the scope call determines what the outer layer must launch; the docker precondition constrains lane envelopes; the vocabulary expresses all three). **Chosen:** a single ADR covering Q1–Q4, one section per question — the ADR-0039/0040 multi-part shape — with the ticket's promotion-intent line as its candidate headline, confirmed or amended by the spike.

**Spike method?** House precedent (ADR-0029/0039/0040) is hypothesis → adversarial refutation → decision-or-narrowing, with the log committed. **Chosen:** refutation-log spike, ≥2 distinct attempts per question, log committed with the ADR.

**Where deliverables land?** The ADR belongs in the repo's append-only log; the first-slice framing belongs on FAFF-276 where its builder will look; seam reservations belong on FAFF-73/FAFF-32. **Chosen:** split — ADR + refutation log via PR on this branch; scope/framing comments on FAFF-276, FAFF-73, FAFF-32; no new spec is attached to any of them (each gets its own prep when its turn comes).

**Do the explore hypotheses bind the spike?** Pre-deciding would make refutation theatre; ignoring verified ground truth would waste it. **Chosen:** the WHAT hypotheses are evidence-anchored starting points the spike must confirm or refute — the ADR may overturn any of them with recorded rationale, and an overturned hypothesis is a successful spike outcome.

**Timebox posture?** Same tension as every fable-week spike: open-ended design burns the scarce window; too tight forces the binary calls the precedent warns against. **Chosen:** one fable-week working day, narrow-boundary principle as the overrun valve.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none escalated. Q1–Q4 are the spike's scoped deliverable — closing them *is* the work — so this spec carries no `Punt:` markers; a human decision is not needed to start.

**Assumptions:**

- **Assumes:** the invariant set is as extracted — ADR-0010 (:22, :26–27, :46–48), ADR-0034 (:32), ADR-0037 (:17, :25–27), ADR-0039 (:25, :40) all live and unsuperseded. Validation: read all four at spike start; `faff adr live-decisions` for the supersession check.
- **Assumes:** FAFF-276 (Backlog, `faff-automation-hold`), FAFF-325 (filed, blocks FAFF-326), FAFF-73 (Backlog, blocked by FAFF-72), FAFF-32/104 (unbuilt) are in those states. Validation: fetch each from the tracker at spike start (verified 2026-07-03 by prep; peer drift is real).
- **Assumes:** `containerCheck` reads the signal set at ~`bin/faff:3919–3932` and the lights-out preflight consumes it at ~:11408/:11525 with `autonomous.require_container` defaulting `warn` (block on lights-out). Validation: grep before authoring the assertion-seam section.
- **Assumes:** the architecture picture (`l4-container-permission-model.svg` + `l3-l4-architecture.md`) is current as-built truth (one cage, context-isolated lanes, HOST = laptop/CI/factory, docker-in-cage precondition drawn). Validation: read both at spike start; on divergence from code, code wins and the doc divergence is noted in the log.
- **Assumes:** the next ADR number is free at authoring time (expected 0041). Validation: `faff adr next-number` at authoring, re-checked immediately before merge (the concurrent-graft collision precedent).

## 8. DONE — Definition of Done

### From WHY
- [ ] An ADR (Context / Decision / Consequences) is accepted on this ticket's branch covering **all four** questions, each closed with a decision + rationale, residuals named as explicit boundaries + costed follow-up tickets cited, and the ticket's promotion-intent line confirmed or amended with rationale.

### From WHAT (the four questions)
- [ ] Q1: the ADR states the isolation ladder — each rung's content, owner, and trigger — and the v1 stopping point, with FAFF-325 and FAFF-276 positioned on it.
- [ ] Q2: the ADR states the outer-orchestration seam (intent-out / assert-in or its amended replacement), what faff emits, what the outer layer owns, and the per-lane assertion + refusal behaviour — preserving assert-not-launch end-to-end.
- [ ] Q3: the ADR names the docker-inside-the-cage L4 launch precondition, the socket-vs-dind posture (rule or recommendation, with the threat table), and where it is asserted.
- [ ] Q4: the ADR expresses the rungs as declared `isolation`-field semantics (FAFF-69/73 vocabulary) and names what becomes physically enforceable at each rung (incl. FAFF-32's matrix), building none of it.

### From HOW (deliverables and method)
- [ ] The refutation log is committed alongside the ADR, with ≥2 recorded refutation attempts per question, each with an outcome.
- [ ] A first-slice framing comment is posted on FAFF-276 (ladder position, trigger, required assertion seam).
- [ ] Pointer comments are posted on FAFF-73 and FAFF-32 naming what the ADR reserves for them.
- [ ] The spike's PR contains docs/tracker artifacts only — no production code, no launch tooling, no schema file.
- [ ] `faff adr validate` passes after the ADR lands, and the ADR quotes + preserves ADR-0010's invariant wording.
- [ ] Timebox respected, or the overrun narrowing (what settled, what was narrowed, follow-ups filed) is recorded in the ADR.

**Eval coverage:** not applicable — the spike introduces no LLM-judgement runtime seam (a design pass producing docs and tracker artifacts; any assertion seams it designs are built and registered by their follow-up tickets).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Open the merged ADR → each of the four questions has a Decision subsection,
     and the isolation ladder table names owner + trigger per rung
  2. Run `faff adr validate` → exit 0
  3. Open FAFF-276 → a first-slice framing comment exists citing the ADR
  4. Open FAFF-73 and FAFF-32 → each has a pointer comment citing the ADR
  5. `git diff main` on the spike PR → only docs/ changed
```

confidence: high
spec-review: approve

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** — No issues. A one-day timeboxed spike within the 1–3-day unit; the four questions interlock into one decision (the scope call shapes what the outer layer launches; the docker precondition constrains lane envelopes; the vocabulary expresses all of it), so they do not split — and the narrow-boundary valve handles overrun without inflating the ticket.
- **Workstream fit? (principles 1 + 5)** — Observation, no action forced. FAFF-313 sits project-less in Backlog while its first slice (FAFF-276) already lives in the outcome-named "Trustworthy lights-out — harden & broaden (post-v1)" project. This spike's output is that stream's design gate — when sequenced, it belongs in that container, not the time-themed FAFF-314 umbrella. Nothing to do at prep time.
- **Deps surfaced? (principle 6)** — Resolved during prep. FAFF-313 carried no blocker edges, but its deliverable frames FAFF-276 as the first slice of the decided ladder — building FAFF-276 before this design settles risks building the wrong rung. The **FAFF-313 blocks FAFF-276** edge is now drawn (2026-07-03); FAFF-276's `faff-automation-hold` additionally protects it as a human posture.
- **Risk profile? (principle 7)** — No issues; this ticket *is* the de-risking move. It pulls the novel-integration risk (multi-container orchestration, socket-vs-dind security regression) ahead of any cage build, and the spec names its riskiest question's failure mode (outer-layer owner undecidable) with a narrowing outcome rather than a binary call.

---

*Spec-review: **approve** (faffter-noon-spec-review, single-pass; lenses fired: architectural, infosec, QA — methodology skipped by the change-surface cost-gate; zero objections). Verdict validated via `faff contract spec-review-verdict` (exit 0), 2026-07-03.*
