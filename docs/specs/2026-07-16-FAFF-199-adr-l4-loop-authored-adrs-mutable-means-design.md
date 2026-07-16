# FAFF-199 — ADR L4: loop-authored ADR supersession under two-tier provenance authority + a thrash-guard

> Spec: faffter-dark-nlspec · 2026-07-16 · autonomous · confidence: high. Full spec on Linear FAFF-199.

This spec turns FAFF-199 ("ADR L4 — loop-authored ADRs as mutable means") into a buildable port of the shipped PRDR two-gate admission pattern (ADR 0022, `faff prdr admit`) onto the ADR axis. Audience: the build agent and human reviewers. The ticket text (2026-06-21) called this "genuinely far-future" because it "needs the PRD layer" and "the adversarial-review gate" — both have since shipped, so the premise has moved: this is now a pattern port, not a greenfield authority design.

## Refresh log (2026-07-16, autonomous)

Refreshed from the 2026-07-14 `confidence: medium` spec. The three open Punts it carried were **resolved by a human comment (2026-07-14, via `/faff-jot`)** and the ticket was **unparked (2026-07-16)**. Each resolution is folded in below and the spec re-rated:

- **Gateway hard-floor carve-out (was product Punt) → RATIFIED.** A loop-provenance ADR may be auto-superseded when `faff adr admit` returns `admit`. Folded into §4 *Gateway hard-floor amendment* and §6.
- **Ratification gesture (was architecture Punt) → CHOSEN option (a).** `/faff-wtf` surfaces the recorded proposal (new ADR + argument); on human confirm it runs the existing `faff adr supersede` interactively — no new write mechanics, no PR-marker machinery. Folded into §4 *Ratification gesture* and §6.
- **Split (was scope Punt) → SHIP AS ONE SLICE.** With both decisions settled, nothing in the erstwhile slice B is undecidable, so the split rationale no longer applies. Build A+B as specced in one unit. The methodology critique's split recommendation is explicitly overridden by this human call (see the annotated *Methodology critique* below).

Premise re-checked against the codebase at refresh: `faff adr admit` / `computeAdrAdmission` / the `adr-admission` contract / ADR `Provenance` / `adr.thrash_*` config **do not exist**; the PRDR precedent (`computePrdrAdmissionVerdict`, `prdr.thrash_max/window`), the shared authority-blind `recordSupersede` ("NO actor/authority concept"), and the graft "never auto-supersede at any appetite" floor **do** — so the delta is real and buildable. FAFF-16's ADR *record*-half and the shipped PRDR admission are related-but-not-superseding (the human scope-clarification comment 2026-07-16 makes the same distinction: this is the *evolving*-ADR half, not the record half).

## 1. WHY — Problem and Principles

**The load-bearing model: authority by provenance, enforced by a deterministic pure gate that wraps — never replaces — the mechanical supersede linker.** faff already runs this exact model for PRDRs: records carry `Provenance: human|loop`; `faff prdr admit` (a pure function, `computePrdrAdmissionVerdict` in `contract-defs.js`) computes `admit | propose-only | reject` from authority + by-level + a thrash ratchet; the loop may supersede loop-provenance records, may only *propose* over human-provenance ones (a human ratifies), and every move is bounded by a count ratchet plus an adversarial value gate. This spec gives ADRs the same tier structure so loop-authored ADRs become *mutable means* while human-authored ADRs stay guardrails.

**Problem statement.** Today `faff adr supersede` is a pure mechanical linker with explicitly "NO actor/authority concept" (`plugin/skills/faff/bin/lib/adr.js`), ADRs carry no provenance field, and faff-graft's autonomous route hard-refuses every supersession ("never auto-supersede at any appetite" — Step 3b, `plugin/skills/faff-graft/SKILL.md`). So at L4 the loop can *author* ADRs (Step 4b ships) but can never retire a stale machine-made decision — contradicting ADRs pile up as recorded conflicts for `/faff-wtf`, and the ADR log decays as a source of current truth. This change adds ADR provenance, an `faff adr admit` two-gate wrapper, and the graft-side wiring that lets the loop supersede *its own* decisions under the same leash PRDRs already wear.

**Design principles** (violating any of these rejects an otherwise-working implementation):

- **Mirror, don't invent.** ADR 0022's pattern is the design; deviations need a written reason. The supersede writer is already shared verbatim between ADR and PRDR (`recordSupersede`, prefix-parameterised) — the admission layer follows the same reuse discipline.
- **The linker stays authority-blind.** `faff adr supersede` / `recordSupersede` gain no actor concept; enforcement lives one rung up in `faff adr admit`, exactly as `prdr supersede` vs `prdr admit`.
- **Fail-safe toward the harder-to-supersede tier.** Absent or ambiguous provenance reads as `human`; a missing adversarial challenge is a reject, never a pass (mirrors the PRDR yagni missing-skeptic rule).
- **Deterministic gate, agent-mapped inputs.** The CLI arbitrates closed-vocabulary flags, pure, no tracker/network calls (parity with `faff next` / `faff prdr admit`). LLM judgement enters only through the existing seams (contradiction detection, review-slot challenge).
- **Legacy-lenient.** The ~66 existing ADRs (`docs/adr/`, none carrying Provenance) must keep passing `faff adr validate` untouched.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/adr.js` | JS | ADR mechanics: template, validate, `recordSupersede`, `adrField`, live-decisions (FAFF-198) |
| `plugin/skills/faff/bin/lib/prdr.js` | JS | The pattern source: `Provenance` field, `--provenance` flag, lenient validate, `prdr admit` command |
| `plugin/skills/faff/bin/lib/contract-defs.js` (~L681–802) | JS | `computePrdrAdmission` / `computePrdrAdmissionVerdict` / `prdrGatesPass` — the shapes to mirror |
| `plugin/skills/faff/bin/lib/config.js` | JS | `prdr.thrash_max: 3` / `prdr.thrash_window: 21` precedent; `adr.mode` key |
| `plugin/skills/faff-graft/SKILL.md` Steps 4b/3b | prose | The FAFF-198 L3 flow this extends; the autonomous "never auto-supersede" route is the L4 extension point |
| `docs/adr/0022-…` | prose | The two-gate admission decision being ported |

**Scope statement.** This is the ADR-axis sibling of FAFF-255 (PRDR admission), sitting between the shipped FAFF-198 (L3 offer-supersession) and the L4 lights-out runner; it completes the mutable-means tier of the PRD ▸ ADRs ▸ specs ▸ code audit spine. Built as **one slice** (human-ratified ship-as-one, 2026-07-14): the deterministic CLI/contract core (former slice A) and the graft caller-wiring + gateway amendment (former slice B) ship together, because both human calls slice B waited on are now settled.

## 2. OUT OF SCOPE

- **PRD-style value gates (upper/YAGNI, lower/coverage) for ADRs** — those gates are PRD-goal-specific; the ADR analogue of "value" is the adversarial drift challenge (in scope). Extension point: `computeAdrAdmissionVerdict`'s input record, which can grow folded gates later.
- **A tidy-side ADR grooming pass** (proactively hunting stale ADRs outside graft) — supersession candidates arise only where a new contradicting ADR is minted (graft Step 3b). Extension point: faff-tidy diagnostics.
- **Back-filling `Provenance:` lines into the 66 existing ADR files** — read-time defaulting makes it unnecessary; a bulk edit churns history for no behaviour change. Extension point: `adrValidate` could later warn on absence if a human wants explicit stamps.
- **Cryptographic enforcement of ratification** — same residual as ADR 0022: a raw write can forge state; the model is guardrail-not-control, bypass is loud.
- **The dead `design/adrs.md` pointer** (referenced by the FAFF-198 spec and this ticket; the file does not exist in the repo) — noted for the human; fixing stale spec pointers is not this slice.
- **PRDR-side per-move drift-review wiring** — ADR 0022 delegates PRDR drift review to "the consumer's per-move wiring", and no SKILL.md wires it today either; this spec wires the ADR challenge only. Extension point: the same challenge step, lifted to the PRDR admit call-site, in a follow-up.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| provenance | Which authority tier authored the record: `human` (guardrail — loop proposes only) or `loop` (mutable means — loop may supersede under the gates) |
| propose-only | The supersession is authored and recorded but the supersede write is withheld until a human ratifies |
| drift challenge | The per-move adversarial review (review slot, different model) of the supersession argument — the ADR-axis value gate |
| lineage | An ADR plus the chain of records it superseded; the ratchet counts supersessions accrued per lineage within a window |
| self-move | A supersession targeting the ADR governing the actor's own current increment (minted in this run, or the decision this issue's spec builds on) |

**ADR Provenance field.** New optional header field, same grammar the shared `adrField` reader already parses:

```
- **Provenance:** human | loop
```

**Chosen:** mirror the PRDR field exactly — `faff adr new` gains `--provenance human|loop` (invalid value → usage error, exit 2), the template emits the line, default `human` (fail-safe: the harder-to-supersede tier, verbatim the `prdr new` precedent at `prdr.js` ~L165).

**Legacy posture.** `adrValidate` must NOT require the field (unlike `prdrValidate`, which does — PRDRs were born with it). At read time (`listAdrs`, admission input assembly), absent Provenance ⇒ `human`.
**Chosen:** no back-fill, absence-means-human at read time, validate stays silent on absence but rejects a *present* out-of-enum value (e.g. `Provenance: robot` → validate problem).

**Forward assignment.** Who stamps what, at graft Step 4b scaffold time:
**Chosen:** autonomous graft passes `--provenance loop`; interactive graft omits the flag (default `human` — a human sees and can edit the body before commit, and PR-reviews it). The run mode at materialisation is the tier boundary.

**The verdict record** (new contract `adr-admission`, registered in `CONTRACTS` + schema like `prdr-admission`):

```
RECORD AdrAdmissionVerdict:
  disposition: ENUM {admit, propose-only, reject}
  authority:
    actor: ENUM {loop, human}
    supersedes_provenance: ENUM {human, loop, none}   # none = new ADR, no supersession
    by_level: ENUM {ok, violation}                    # self-move ⇒ violation for a loop actor
  challenge:                                          # the ADR-axis value gate
    ran: Bool
    outcome: ENUM {survived, overturned, absent}      # absent ⇔ ran=false
  ratchet:
    lineage_supersessions: Int                        # agent-supplied in-window count
    breached: Bool                                    # lineage_supersessions >= adr.thrash_max
  reasons: List<String>
  conformant: Bool
  violations: List<String>

  CONSTRAINT admit ⟺ challenge.outcome == survived
                    ∧ by_level == ok
                    ∧ ¬ratchet.breached
                    ∧ ¬(actor == loop ∧ supersedes_provenance == human)
  CONSTRAINT propose-only valid ⟺ all other gates pass AND the sole bar is loop-supersedes-human
```

**Chosen:** the gate shape mirrors `computePrdrAdmissionVerdict` with the PRD-specific upper/lower gates replaced by one folded `challenge` gate; `challenge.outcome: absent` (review slot unreachable/unanswered after fallback) is a reject reason, never coerced to survived — the ticket's "loop may supersede on recorded adversarially-reviewed argument" made the challenge the load-bearing value gate.

**CLI surface:**

```
faff adr admit --actor loop|human --supersedes-provenance human|loop|none
              [--self] [--challenge survived|overturned]
              [--lineage-supersessions N]
```

Producer emits one `faff-contract:adr-admission` block; `faff contract adr-admission` is the consumer-side shape validator (fail-loud on out-of-enum, no safe coerce target — faff's own producer emits it, mirroring `computePrdrAdmission`'s posture).

## 4. HOW — Behavior

**Architecture.** Three layers, top-down: (1) graft Step 3b's autonomous route becomes the L4 caller — it assembles the admission inputs and routes on the disposition; (2) `faff adr admit` / `faff contract adr-admission` arbitrate deterministically; (3) `faff adr supersede` performs the write, unchanged and authority-blind.

**Implementation locus.** **Chosen:** `computeAdrAdmission` / `computeAdrAdmissionVerdict` / `contractAdrAdmission` as sibling functions in `contract-defs.js` beside the PRDR trio, sharing enum constants where identical but NOT force-parameterising the gate cores: the folded-gate sets differ (challenge vs upper/lower), and a shared core with divergent branches would be harder to read than two small mirrored pures. The `cmdAdr` command handler gains the `admit` action + `--selftest` cases, mirroring `prdr.js`'s `admit` action verbatim in structure.

**Self / by-level.** **Chosen:** mirror PRDR exactly — the CLI folds an agent-supplied `--self` flag (`by_level = actor=="human" ? ok : (self ? violation : ok)`); the agent maps "self" as: the target ADR was minted during this same run, or records the decision this issue's spec is building under. The CLI never tries to compute this (parity with PRDR, where `input.self` is agent-supplied).

**Thrash ratchet.** **Chosen:** new config keys `adr.thrash_max: "3"` / `adr.thrash_window: "21"` in `config.js` DEFAULTS (verbatim the conservative PRDR defaults); the agent supplies the in-window lineage count (walking the `Supersedes:` chain via the shipped ref-parsers + `Date:` fields), the CLI only compares to `thrash_max` — the same responsibility split ADR 0022 records as a residual.

**The L4 caller.** **Chosen:** graft Step 3b's autonomous route is the sole v1 call-site — it is where contradiction detection already runs, the new ADR + `why` argument already exist in hand, and the current behaviour (record the conflict for `/faff-wtf`, proceed) is exactly the propose-only/reject fallback. Routing becomes:

```
PROCEDURE autonomous_route_contradiction(new_adr, old_adr, why):
  1. provenance := read Provenance of old_adr; absent -> "human"
  2. Run the drift challenge: invoke the review slot (adversarial occupant, different
     model — the FAFF-256 Phase-2 pattern) with {old Decision body, new Decision body,
     why} -> survived | overturned. Slot unreachable/unanswered after its fallback
     chain -> treat as ABSENT (omit --challenge).
  3. lineage := count of in-window supersessions on old_adr's lineage (Supersedes-chain
     walk + Date fields, window = adr.thrash_window days)
  4. verdict := faff adr admit --actor loop --supersedes-provenance <provenance>
                [--self if self-move] [--challenge <outcome> if ran]
                --lineage-supersessions <lineage>
     -> pipe block to faff contract adr-admission (fail-loud on malformed)
  5. IF disposition == admit:
       a. Run faff adr supersede <old> --by <new>  (the write, part of the Step-4b commit)
       b. Log the move + challenge outcome in the run record (audited event)
  6. IF disposition == propose-only OR reject:
       a. Keep TODAY's behaviour: record {new-id, adr, why, disposition, reasons}
          for /faff-wtf; no write; proceed with the build.
  7. ANY step error (admit malformed, supersede races an interim supersession and
     errors loudly) -> log, fall back to record-and-file, never block the build.
```

Interactive routes (`offer` / `surface`) are unchanged — L3 human judgement already outranks the gate.

**Behaviour summary:** the gate converts today's blanket autonomous refusal into "refuse by default, permit the narrow loop-over-loop case when an independent skeptic and the ratchet both agree" — subtractive-authority relaxation, fail-closed on every doubt.

**Gateway hard-floor amendment.** Graft's autonomous route currently cites the gateway "Appetite for destruction" **hard floor**: "never auto-supersede at any appetite". This spec carves out: *a loop-provenance ADR may be auto-superseded when `faff adr admit` returns `admit`* — the floor sentence itself is amended in the gateway (`plugin/skills/faff/SKILL.md`) and in graft Step 3b.
**Chosen (RATIFIED by human, 2026-07-14 — product):** amend the "never auto-supersede at any appetite" hard floor so a **loop-provenance** ADR may be auto-superseded when `faff adr admit` returns `admit` (challenge survived ∧ ratchet unbreached ∧ not loop-over-human ∧ not self-move). Human/legacy-provenance ADRs remain guardrails — propose-only. Amend the floor sentence verbatim in the gateway and graft Step 3b; every other supersession stays refused-autonomous.

**Ratification gesture for propose-only.** PRDRs ratify via a native-tracker status flip (write-abstention: faff never self-writes `Accepted`). ADRs live in git, not the tracker, so the equivalent gesture needed a decision.
**Chosen (human, 2026-07-14 — architecture):** option (a) — `/faff-wtf` surfaces the recorded propose-only proposal (the new ADR + its argument); on human confirm it runs the existing `faff adr supersede` interactively. **No new write mechanics, no PR-marker machinery** — the admitted path already gets PR review for free (the supersede write rides the Step-4b commit), and the propose-only path reuses the shipped interactive `faff adr supersede`. Until a human confirms, propose-only behaves exactly like today's record-and-file (safe: nothing regresses).

**Assumes:** an adversarial-capable `review`-slot occupant (e.g. `faffter-dark-adversarial-review`) is configured/resolvable at L4 runtime for the drift challenge — validation: the builder checks `faff config get slots.review` resolution the way the FAFF-256 Phase-2 call-site does; when unresolvable the challenge is `absent` and the gate conservatively rejects, so the assumption failing degrades to today's behaviour, never to an ungated write.

**Edge cases:**

- Old ADR superseded between candidate-list and admit → `faff adr supersede` already errors loudly ("already superseded by") → log, record-and-file, continue (shipped behaviour, now one step later).
- `--challenge` passed with an out-of-enum value → usage error exit 2 (mirror `--supersedes-provenance` handling in `prdr.js` ~L186).
- `supersedes_provenance: none` with an `admit` ask → not a supersession; the caller never invokes admit for it.
- Non-integer `--lineage-supersessions` → normalise to 0 **with a recorded violation** (mirror `computePrdrAdmission`'s lineage handling) — mirror PRDR exactly and rely on the agent-supplied count residual already accepted by ADR 0022.
- Legacy ADR (no Provenance) as supersession target → reads `human` → propose-only at best. All 66 existing ADRs are guardrails by construction.

**Failure modes:**

- **Tier misassignment** — an autonomous run's ADR stamped `human` (flag dropped) over-protects (harmless); stamped `loop` when a human materially co-authored it under-protects. Signal: run records show admits superseding ADRs whose PR history shows human edits. Meaning: narrow — tighten the forward-assignment rule, don't abandon the tier model.
- **Challenge rubber-stamping** — the adversarial occupant may rarely return `overturned`, making the value gate decorative. Signal: the eval case distribution + run records showing near-100% `survived`. Meaning: proceed but flag; the ratchet is the independent volume backstop.
- **Ratchet undercount** — the agent-walked in-window lineage count could systematically undercount (date parsing, chain gaps). Signal: `faff adr validate`-clean lineages whose supersession count in git history exceeds the counts recorded in run records. Meaning: same residual ADR 0022 accepted for PRDRs; proceed.

**Anti-pattern:** adding actor/authority checks inside `recordSupersede` or `faff adr supersede`. Why: the linker's authority-blindness is a recorded invariant; enforcement lives only in `admit` and its caller.

**Anti-pattern:** making `faff adr validate` require Provenance. Why: reddens 66 legacy files and every downstream CI/merge-guard call-site; the read-time default achieves the same tiering with zero churn.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a loop-provenance ADR 00A and a new contradicting ADR 00B authored in an autonomous graft
  And the drift challenge returns survived
  And 00A's lineage has fewer than adr.thrash_max in-window supersessions
When the autonomous route runs faff adr admit and routes the verdict
Then the disposition is admit, faff adr supersede 00A --by 00B runs,
  And faff adr validate passes with 00A "Superseded by ADR-00B" / 00B "Supersedes: ADR-00A"
```

```
Given the review slot is unreachable after its fallback chain (challenge absent)
When faff adr admit is called for a loop-over-loop supersession
Then the disposition is reject with a missing-skeptic reason, and no write occurs
```

```
Given a loop-provenance lineage that has accrued adr.thrash_max in-window supersessions
When faff adr admit is called with that lineage count
Then ratchet.breached is true and the disposition is reject (escalate), regardless of the challenge
```

- `faff adr validate` over the untouched existing `docs/adr/` tree MUST report zero problems after this change.
- An `admit` disposition handed to `faff contract adr-admission` that does not satisfy the constraint MUST be non-conformant (violation recorded), and a malformed block MUST fail loud, never coerce toward `admit`.

## 6. DESIGN DECISION RATIONALE

- **Provenance field form?** Mirror PRDR (`--provenance`, default human) vs a new scheme. PRDR's is shipped, parsed by shared `adrField`, and its fail-safe default direction is documented in-code. **Chosen:** mirror PRDR exactly — one grammar, one reader, one precedent.
- **Legacy back-fill?** Bulk-edit 66 files vs read-time default. **Chosen:** no back-fill, absence ⇒ human — over-protective in the safe direction.
- **Forward assignment?** Stamp by run mode vs always-human vs always-loop. **Chosen:** autonomous ⇒ `loop`, interactive ⇒ default `human`.
- **Gate shape?** Port upper/lower gates vs replace with the challenge gate. **Chosen:** challenge-as-value-gate, absent ⇒ reject.
- **Reuse vs fork of the admission core?** **Chosen:** sibling functions, shared enums/helpers only where verbatim.
- **Self detection?** CLI-computed vs agent-supplied. **Chosen:** agent-supplied `--self`, mirroring PRDR.
- **Ratchet defaults?** **Chosen:** `adr.thrash_max: 3` / `adr.thrash_window: 21`.
- **Caller locus?** Graft Step 3b autonomous route vs a new tidy/runner pass. **Chosen:** graft 3b, sole v1 call-site.
- **Gateway hard-floor carve-out?** **Chosen (human-ratified, 2026-07-14 — product):** carve out the "never auto-supersede at any appetite" floor for admit-gated loop-provenance ADRs; human/legacy tiers stay propose-only.
- **Ratification gesture for propose-only?** **Chosen (human, 2026-07-14 — architecture):** `/faff-wtf`-surfaced confirm running the existing interactive `faff adr supersede`; no new write mechanics.
- **Ship as one slice or split?** **Chosen (human, 2026-07-14 — scope):** ship as one slice — with both calls above settled, nothing is undecidable, so the split rationale lapses.

At the time of writing, no SKILL.md wires the per-move PRDR drift review either — this spec's challenge wiring is the first per-move drift-review call-site, so its shape should be written to be liftable to the PRDR admit call-site later.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the three Punts the 2026-07-14 spec carried (gateway hard-floor carve-out; ratification gesture; ship-vs-split) were all resolved by the human comment of 2026-07-14 and are folded into §4/§6 above.

**Assumptions:**

- **Assumes:** an adversarial-capable `review`-slot occupant exists and is configured at L4 runtime. Validation: resolve `faff config get slots.review` at the challenge call-site; unresolvable ⇒ challenge absent ⇒ conservative reject (degrades safely).

## 8. DONE — Definition of Done

### From WHAT (provenance field)
- [ ] `faff adr new --provenance loop` emits `- **Provenance:** loop`; omitted flag emits `human`; invalid value exits 2 with a usage line
- [ ] `faff adr validate` on the existing `docs/adr/` tree (no Provenance anywhere) reports zero problems; a file with `Provenance: robot` is flagged
- [ ] `listAdrs` (or the admission input assembly) exposes provenance with absent ⇒ `human`

### From WHAT (verdict + contract)
- [ ] `computeAdrAdmissionVerdict` returns `admit` only when challenge==survived ∧ by_level==ok ∧ ¬breached ∧ ¬(loop over human); loop-over-human as the sole bar returns `propose-only`; any hard violation returns `reject` with per-gate reasons
- [ ] `faff contract adr-admission` fail-louds on out-of-enum disposition/actor/provenance/challenge and flags a constraint-violating `admit` as non-conformant
- [ ] `faff adr --selftest` covers the admit matrix and passes

### From HOW (config + CLI)
- [ ] `adr.thrash_max` / `adr.thrash_window` present in config DEFAULTS as `"3"` / `"21"` and readable via `faff config get`
- [ ] `faff adr admit` emits exactly one `faff-contract:adr-admission` block; `faff adr` usage line lists `admit`
- [ ] `faff adr supersede` / `recordSupersede` diff is empty (linker untouched)

### From HOW (caller wiring — one slice)
- [ ] Graft Step 3b autonomous route: on `admit`, runs `faff adr supersede` inside the Step-4b commit and logs the audited move; on `propose-only`/`reject`, preserves today's record-for-wtf behaviour with disposition + reasons attached
- [ ] Challenge unreachable ⇒ no supersede write (observable: run record shows reject/missing-skeptic)
- [ ] Gateway + graft hard-floor prose amended per the ratified product decision (carve-out for admit-gated loop-provenance ADRs)
- [ ] Propose-only ratification: `/faff-wtf` surfaces the recorded proposal and, on human confirm, runs interactive `faff adr supersede` (no new write mechanics)

### Eval coverage
- [ ] The drift-challenge seam registers its grader KIND + ≥1 eval case (an argument the skeptic should overturn, one it should survive) + the seam-registry row in this ticket; baseline acceptance stays a separate human step

**Integration smoke test:**

```
1. In a temp repo: faff adr new x2 (one --provenance loop as OLD, one as NEW)
2. faff adr admit --actor loop --supersedes-provenance loop --challenge survived --lineage-supersessions 0
3. Pipe the block to faff contract adr-admission -> disposition admit, conformant
4. faff adr supersede OLD --by NEW; faff adr validate -> clean, symmetric back-refs
5. Repeat step 2 with --supersedes-provenance human -> propose-only; with no --challenge -> reject
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized (principle 4) — original recommendation: split; human decision (2026-07-14): SHIP AS ONE.** The 2026-07-14 spec covered two structurally separable concerns — the deterministic CLI/contract core (former slice A, zero punts) and the graft caller-wiring + gateway amendment (former slice B, which carried all three punts). The lens recommended a split on the grounds that B was undecidable until the human calls resolved. **Those calls have since been resolved** (gateway hard-floor carve-out; ratification gesture — both settled 2026-07-14), so B's undecidability — the entire basis for the split — no longer holds. The human ratified ship-as-one on exactly that reasoning. This lens's split recommendation is therefore **overridden by a live human scope decision** and recorded here for provenance only.

**Deps (principle 6)** — the two decision-gates the split would have blocker-linked (hard-floor carve-out: product; ratification gesture: architecture) are now closed decisions folded into §4/§6, not open deps. No decision tickets remain to file.

**Risk (principle 7)** — the drift-challenge seam remains the novel integration. In the single-slice build it lands after the deterministic core within the same unit; sequence the deterministic CLI/contract first, then the caller wiring + challenge seam, so the risky integration sits on a de-risked base.
