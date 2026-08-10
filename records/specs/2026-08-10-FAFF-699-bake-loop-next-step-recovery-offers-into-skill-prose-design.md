# FAFF-699 — Bake the loop's next-step + recovery offers into skill prose (harness-agnostic forward-lean)

> Spec: faffter-dark-nlspec · 2026-08-05 · autonomous · confidence: high. Full spec on Linear FAFF-699.

This artifact is a buildable spec for **FAFF-699 — "Under codex the loop doesn't offer the next step — the operator drives every handoff."** It addresses a **prose-hardening** change across the faff gateway and sub-skill `SKILL.md` files (plus one `docs/architecture/harness-coupling.md` inventory row). Its audience is the build agent who will edit those prompt files, and the human reviewers gating the change. There is **no application runtime code** in scope — every DONE item asserts the presence and shape of prose (plus one behavioural acceptance check under Codex).

## Already shipped against this surface

Related Done work in the same project ("Harness-agnostic runtime — the loop runs under Codex CLI"), none of which supersedes this ticket's premise (reader context only):

- **FAFF-695** — *Under codex, faff-prep/graft read the tracker connector as absent* — a **different** Codex seam (deferred-tool tracker discovery), already fixed by the gateway "Tracker availability resolution" rule. Does not deliver next-step / recovery-offer prose.
- **FAFF-482 / FAFF-477** — the seam-mapping / coupling-audit spikes that produced `docs/architecture/harness-coupling.md` (the FAFF-483 inventory this spec adds a row to). Context this builds on; deliver no offer prose.
- **FAFF-694** — the Codex / GPT-5.6-sol run record that surfaced this bug. The evidence, not the fix.
- **FAFF-483** (Related, not Done) — the harness-abstraction interface this seam must eventually trace to; kept Related, not a blocker (the fix is prose-side and needs no runtime interface).

Premise holds → proceed.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff's interactive phase-handoff leaned on an *unstated harness default*: Claude Code's loop is **forward-leaning** — at a turn boundary it either continues to the next step on its own, or volunteers a "want me to proceed?" nudge. faff never wrote that forward-lean into prose; it inherited it. Codex CLI's loop is not forward-leaning: at a turn boundary it ends the turn and **waits silently**. So the same skill prose that "just flows" under Claude Code parks at every turn boundary under Codex, and the operator has to type the next command each time. The fix is to **bake the forward-lean into the prose** so it no longer depends on the harness's default posture — while keeping the autonomous no-prompt invariant inviolate.

**Problem statement.** Today the cross-phase "want me to proceed?" continuation offers and the stall/park recovery offers exist only as harness behaviour, not as skill prose (`grep -rin "forward-lean" plugin/` returns nothing). Under Codex the operator had to drive every transition (`continue` / `open pr` / `merge when green`), and a spec-review stall that parked the run offered **no** recovery route until asked. This change makes those offers and continuations explicit, interactive-mode prose so the loop is forward-leaning on any harness.

**Design principles.**

**Interactive-only, autonomous untouched.** The no-prompt invariant (`faff/SKILL.md:658`) makes any mid-run interactive gate on an L3/L4 run a *contract violation*, not caution. So every mechanism this spec adds is gated to interactive (L1/L2) mode. Autonomous runs are orchestrated by beep-boop, run *foreground-to-terminal*, and must emit **no** offer and **no** prompt — an implementation that adds a prompt to an autonomous path is wrong regardless of how helpful it reads.

**Two distinct failure shapes, two distinct mechanisms.** The stall is not one bug. (A) Steps that should *not* stop for a human (review-pass → open PR → wait-for-CI → merge-gate) need an explicit **continuation instruction** — the loop proceeds in the same turn. (B) Genuine stopping points (a decision gate, a park/stall, a clean control handoff) need an explicit **terminal offer** naming the exact next command. Conflating them produces either prompt-noise on non-decisions or silent stalls at real stops.

**Single home, then applied at sites.** faff single-sources shared prose in the gateway and references it from sub-skills (the `validate-adapters` dedup lint enforces this). This change adds **one** gateway subsection as the canonical rule and edits only the two genuinely-missing sites; the gates that already survived are recognised as already-conformant, not rewritten.

**Don't re-answer what `faff next` already answers.** `faff next` (`faff/SKILL.md:436-457`) decides *what is legal next* and explicitly "reports, never executes or gates." This ticket decides *whether and how the skill offers that next step to an interactive operator*. Orthogonal. When an offer names a chain step, it still sources the "what" from `faff next` exactly as the Chaining pattern already requires — the two compose.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` | Skill prose (gateway) | Home of the new rule; Park protocol (810-818), Unpark protocol (820-830), Chaining pattern (932-944), no-prompt invariant (658), `faff next` (436-457) |
| `plugin/skills/faff-graft/SKILL.md` | Skill prose | The push→PR gap (Steps 8b/9b); the CI-wait handoff precedent (~487-495); surviving gates (Step 6, Step 11 merge, Step 12) |
| `plugin/skills/faff-prep/SKILL.md` | Skill prose | Surviving build gate (Step 3) and Scenario-B three-way |
| `plugin/skills/faff-wtf/SKILL.md` | Skill prose | Parked-work read-out (55-70) — the only place the unpark route surfaces today, and only when separately invoked |
| `docs/architecture/harness-coupling.md` | Inventory doc | FAFF-483 seam table; the "Skill-to-skill chaining handoff" row (disposition `drop`) is the shape-precedent for the new row |
| `plugin/skills/faff/bin/lib/validate-adapters.js` (~604-614) | CLI lint (**out of scope to change**) | The FAFF-491/530 foreground-posture anchor-phrase lint — the precedent for a future mechanical floor on this prose |

**Scope statement.** This sits inside faff's harness-agnostic-runtime workstream (parent FAFF-694, project "the loop runs under Codex CLI"), a sibling to FAFF-483 (the harness-abstraction *interface*): one more coupling seam — the interactive turn-continuation / next-step-offer posture — moved from harness default into prose.

## 2. OUT OF SCOPE

- **Changing `faff next`** — Excluded: it already answers "what's legal next" and is orthogonal to whether the skill *offers* it. Extension point: none needed; the new rule references `faff next`.
- **Adding or altering blocking decision gates that already survived** (prep Step 3 build gate; graft Step 2 prep-gate, Step 6 build/review/reprep, Step 11 "Merge now? (y/n)", Step 12 next-ticket) — Excluded: literal prose offers that already survived under Codex. Extension point: each gets a one-line back-reference to the new gateway rule, no behavioural edit.
- **A new blocking "open PR? (y/n)" gate at graft Step 9b** — Excluded: Step 9b is deliberately "identical interactive + autonomous" auto-open-on-pass; a blocking interactive gate breaks parity and adds prompt-noise on a non-decision. Handled instead by the continuation instruction (§HOW). See RATIONALE.
- **Any change to autonomous sequencing or the orchestrator** — Excluded: beep-boop owns autonomous sequencing; the no-prompt invariant forbids offers there.
- **Wiring a `validate-adapters` anchor-phrase lint for the new prose** — Excluded to keep this a pure-prose change. Extension point: `plugin/skills/faff/bin/lib/validate-adapters.js` (add a next-step-offer presence check modelled on the FAFF-491/530 check ~604-614) — the follow-up mechanical floor for prose drift.
- **The other harness-coupling seams** — Excluded: each has its own row/ticket. The new row joins the existing table.
- **Runtime enforcement that a turn actually ended with an offer** — Excluded: like the Chaining pattern's own honest limit (`faff/SKILL.md:944`), whether the terminal line was emitted before the turn ended is a runtime interaction, not statically lintable. The behavioural AC under Codex (§DONE) is the acceptance floor; prose-presence is the interim static floor.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| **Forward-lean** | A harness loop's default of continuing past a turn boundary (or volunteering a "want me to proceed?" nudge) rather than ending the turn and waiting. Claude Code has it; Codex does not. |
| **Phase boundary** | A transition between faff loop phases: prep→graft, build→review, review-pass→open-PR, PR→merge, graft→next-ticket. |
| **Continuation instruction** | Interactive-mode prose telling the agent to proceed to the next step **in the same turn** without waiting for the operator — the forward-lean written as an instruction the agent obeys. |
| **Next-step offer** | The terminal line of a turn that *does* stop: an explicit statement of the next step **naming the exact command** the operator can give. |
| **Recovery offer** | The next-step offer emitted at a park/stall: names the exact skill re-invocation that unparks, per the Unpark protocol. |
| **Genuine stopping point** | A boundary where control legitimately returns to the operator: a decision gate, a park/stall, or a clean handoff (e.g. a long CI wait). Distinct from a step that should continue in-turn. |

**The interactive next-step-offer posture (the contract this adds).**

```
INVARIANT interactive_forward_lean (L1/L2 only):
  At every phase boundary AND every park/stall, exactly one holds:
    CONTINUE:  no operator decision is required →
               proceed to the next step in the SAME turn (continuation instruction).
    OFFER:     the turn ends here (decision gate, park/stall, or clean handoff) →
               the LAST line names the next step AND its exact command
               (a next-step offer; at a park, a recovery offer).
  NEVER: end the turn silently with no continuation and no offer.

INVARIANT autonomous_no_offer (L3/L4):
  Emit no offer and no prompt. The orchestrator sequences; the sub-skill
  runs foreground-to-terminal and returns its disposition. (no-prompt invariant, faff/SKILL.md:658)
```

**Where the offer's "what" comes from.** Unchanged: `faff next` for chain steps, and the Unpark protocol's park-cause→skill mapping for recovery offers. No new decision source.

## 4. HOW — Behavior

**Architecture.** One new gateway subsection is the canonical rule; two site edits instantiate the two genuinely-missing cases; the surviving gates get a one-line back-reference; one inventory row records the seam.

### 4.1 New gateway subsection — "Interactive next-step offer (the forward-lean, in prose)"

Add to `plugin/skills/faff/SKILL.md`, adjacent to the **Chaining pattern** (its sibling: Chaining gates *decisions*; this governs *continuation and offers at boundaries and stops*). It states:

1. **The interactive guarantee** — the `interactive_forward_lean` invariant: at every phase boundary and every park/stall the skill either continues in-turn (no operator decision needed) or ends the turn with a terminal next-step/recovery offer naming the exact command; it never ends silently.
2. **The autonomous carve-out** — the `autonomous_no_offer` invariant, cross-referencing the no-prompt invariant (`:658`) and the interactive-only chaining rule (`:942`). The autonomous equivalent of an offer is *nothing new* — the orchestrator sequences, the run is foreground-to-terminal, a logged next-step line is permitted, a prompt is not.
3. **The "what" source** — chain step from `faff next`; recovery offer from the Unpark protocol's park-cause→skill mapping.
4. **The honest limit** — mirroring `:944`: this binds behaviour; whether the terminal offer was actually emitted before the turn ended is a runtime interaction, not statically lintable. grep prose-presence verifies the text exists; it does **not** verify the offer fires at a Codex turn boundary — the pre-fix Chaining prose was already present and grep-checkable yet silently failed under Codex. The behavioural AC under Codex (§DONE) is the acceptance floor; the future `validate-adapters` anchor-phrase lint (extension point) is the durable mechanical floor for prose drift, not a substitute for the behavioural check.

### 4.2 Park protocol — interactive recovery-offer addendum (the stall-recovery fix)

The shared **Park protocol** (`faff/SKILL.md:810-818`) step 5 is today literally "Return control to the caller." Every skill's park site references this one protocol, so a single edit covers all park paths. Add an interactive addendum to step 5:

```
PROCEDURE park_step5_return_control(mode, park_cause, issue):
  1. (unchanged) log; ensure faff-parked label; write the park comment.
  2. IF mode == interactive:
       a. Emit a terminal RECOVERY OFFER as the last line, naming the EXACT re-invoke
          command from the Unpark protocol's park-cause → skill mapping:
            spec-level park   → "Resolve in a comment, then re-run `/faff-prep <issue>` to unpark."
            build-level park  → "Once resolved, re-run `/faff-graft <issue>` to resume from the draft PR."
            structural park   → "File the missing ticket / break the cycle; the next `/faff-tidy` re-routes it."
          AND name the later route: "or see it again anytime via `/faff-wtf` → Parked work."
  3. IF mode == autonomous:
       a. Return control to the caller (beep-boop). Emit NO offer. (no-prompt invariant)
```

This folds the Unpark route *inline at park time* — today it surfaces only in a separately-invoked `/faff-wtf` (`faff-wtf/SKILL.md:55-70`), exactly the "no recovery route offered until asked" behaviour the ticket names. The `/faff-wtf` read-out is unchanged (the later, durable surface).

### 4.3 faff-graft — the push→PR continuation (the "open pr" fix)

graft Step 8b pushes automatically (both modes) and Step 9b opens the PR automatically on review pass ("identical interactive + autonomous"), so review-pass→open-PR has **no** operator decision — yet under Codex the operator had to type "open pr" because the turn ended at the review boundary. A *continuation* case, not a decision gate:

```
PROCEDURE graft_review_pass_to_merge(mode):  # interactive
  Step 9 returns `pass`:
    CONTINUATION INSTRUCTION: proceed to Step 9b (open the PR) in the SAME turn —
      do not end the turn awaiting an "open pr" instruction. 9b stays auto-open-on-pass
      (unchanged; identical to autonomous). Then continue to CI wait.
  Wait-for-CI (Step 11, "How to actually wait for CI", ~487-495):
    The one legitimate turn-end. Its existing explicit handoff ("re-invoke `/faff-graft`
      or say 'check CI'") IS the next-step offer — reference the new gateway rule so it
      is recognised as the canonical terminal offer, not ad-hoc.
  Merge gate (Step 11): the surviving "Merge now? (y/n)" gate is unchanged (a real decision).
  FALLBACK: if the turn nonetheless ends at the review-pass boundary, the terminal line
    MUST be a next-step offer ("Review passed — opening the PR next; reply to proceed").
```

No new blocking gate (9b parity preserved). Autonomous graft already runs foreground-to-terminal and is untouched.

### 4.4 Surviving gates — one-line back-reference only

prep Step 3 build gate, prep Scenario-B three-way, graft Step 2 prep-gate, Step 6 build/review/reprep, Step 11 merge gate, Step 12 next-ticket: each is already an explicit prose offer that survived under Codex. Add a single cross-reference to the new gateway subsection so the posture has one named home; make **no** behavioural edit.

### 4.5 harness-coupling.md — new inventory row

Add a row: **Turn-continuation / next-step-offer posture** — Today (Claude Code): the harness's forward-leaning loop continues past boundaries and volunteers "want me to proceed?" / recovery nudges; faff prose never encoded it. Disposition: **drop** (the mechanic is unavailable under a non-forward-leaning harness, so its job moves into prose — the new gateway subsection + the Park-protocol recovery addendum; same shape as the existing "Skill-to-skill chaining handoff" `drop` row). Follow-on: FAFF-483 (interface trace); a `validate-adapters` anchor-phrase lint (mechanical floor).

**Anti-pattern:** editing the table's summary/count sentences to *contradict* their fixed historical scope ("the five runtime seams FAFF-482 set out to map"). Why: those counts reference a frozen historical inventory, not the live row total; adding a seam FAFF-482 didn't map leaves them true. Confirm they stay coherent; do not renumber history.

**Failure modes.**

- **The failure:** the continuation instruction is treated as license to *never* stop, and an implementer strips a real decision gate (e.g. the Step 11 merge gate) as "just a boundary." **How you'd know:** an interactive graft merges without a "Merge now?" confirm; the merge-gate prose no longer contains the y/n. **What it means:** narrow — the CONTINUE arm applies only where *no operator decision is required*; decision gates are the OFFER arm.
- **The failure:** an offer gets added to an autonomous path (the "it's helpful" rationalisation the no-prompt invariant's banned-rationalisations list, `faff/SKILL.md:660`, exists to stop). **How you'd know:** `grep` shows the recovery/offer prose without an interactive guard, or a beep-boop run emits a prompt. **What it means:** abandon that edit — the invariant is a hard floor.
- **The failure:** the prose is added but, being prose, silently drifts back out on a later refactor (the exact history that produced the foreground-posture lint), or the prose is present but the offer still doesn't fire under Codex. **How you'd know:** the grep DONE items stay green while a Codex re-run of the FAFF-694 scenario still ends turns silently. **What it means:** proceed, but the behavioural AC under Codex is the acceptance floor and the named `validate-adapters` follow-up is the durable drift floor — grep-presence alone is necessary, not sufficient.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an interactive (L1/L2) faff run that parks an issue (any skill, any park cause)
When the Park protocol step 5 returns control
Then the terminal output names the exact re-invoke command for that park cause
     (e.g. "re-run `/faff-graft <issue>`") and the `/faff-wtf` later-route,
     rather than returning control silently
```

```
Given an interactive graft where Step 9 review returns `pass`
When the run reaches the review-pass→open-PR boundary
Then the prose continues to Step 9b in the same turn (no "open pr" instruction required),
     OR — if the turn ends — the terminal line is an explicit next-step offer naming the command;
     Step 9b remains auto-open-on-pass, identical to autonomous
```

## 6. DESIGN DECISION RATIONALE

**Should the fix be a gateway rule (a), specific site fixes (b), or a harness-coupling row (c)?** (a)-only leaves the two real gaps still silent; (b)-only leaves the posture implicit and un-homed (re-opens on the next refactor); (c)-only documents but fixes nothing. **Chosen:** all three compose — one gateway subsection as the single home, two site edits for the genuinely-missing cases, and one inventory row. Matches faff's single-source-then-reference discipline.

**push→PR: a new blocking "open PR? (y/n)" gate, or a continuation instruction?** A blocking gate breaks Step 9b's "identical interactive + autonomous" parity and adds a prompt on a non-decision. **Chosen:** a continuation instruction (proceed to 9b in-turn) with a terminal-offer fallback. Rejected: the blocking y/n gate.

**Where does the recovery offer live?** Per-site park prose would copy-drift across prep/graft/beep-boop/tidy. **Chosen:** one addendum to the shared Park protocol step 5. Rejected: per-site prose.

**harness-coupling disposition?** `portable` is false (it broke); `adapter` implies a swappable backend/mapping table (none exists). **Chosen:** `drop` — the mechanic goes away off Claude Code and its job moves into prose; identical shape to the existing chaining-handoff `drop` row.

**Enforcement: a `validate-adapters` lint, or prose-only?** A lint is the real drift floor but is application runtime code, out of scope here. **Chosen:** prose-only in scope; the lint is a named follow-up. The behavioural AC under Codex is the acceptance floor and grep-checkable items the interim static floor.

**`faff next` — change it?** **Chosen:** no. It answers *what's legal next* (reports-never-gates); this ticket adds *whether/how the skill offers it interactively*. Orthogonal.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the issue's own open question ("should these offers be baked into prose?") is answered YES by this spec; no `**Punt:**` remains.

**Assumptions:**

- **Assumes:** the gateway, faff-graft, faff-prep, faff-wtf `SKILL.md` files and `docs/architecture/harness-coupling.md` are at the byte-identical paths and line ranges cited. *Validation:* before editing, `grep -n` each anchor (`"Return control to the caller"`, `"identical interactive + autonomous"`, `"Skill-to-skill chaining handoff"`) and confirm one match at the cited location.
- **Assumes:** no existing prose already encodes a forward-lean/turn-continuation posture that would collide. *Validation:* `grep -rin "forward-lean\|next-step offer\|turn-continuation" plugin/skills/` returns nothing new (confirmed empty at spec time).

## 8. DONE — Definition of Done

### From SCENARIOS (behavioural acceptance — the real floor)
- [ ] Behavioural check under a non-forward-leaning harness: re-run the FAFF-694 phase-boundary/stall scenario under Codex CLI and confirm that at each phase boundary (prep→graft, push→PR, PR→merge) and at a park/stall the loop either continues in-turn or ends the turn with the explicit next-step/recovery offer naming the exact command — **not** a silent turn-end. This is the acceptance floor; the grep prose-presence items below are necessary but not sufficient, because the pre-fix Chaining-pattern prose was already grep-green yet the offer failed to fire under Codex, so presence alone cannot distinguish this fix from a no-op-under-Codex.

### From WHY
- [ ] The interactive forward-lean is encoded in prose, not inherited: a new gateway subsection exists naming the posture (`grep -rin "forward-lean\|interactive next-step offer" plugin/skills/faff/SKILL.md` matches).

### From WHAT / HOW (the gateway rule)
- [ ] The new gateway subsection states the interactive guarantee (continue-in-turn OR terminal next-step/recovery offer at every phase boundary and every park; never end silently).
- [ ] It states the autonomous carve-out and cross-references the no-prompt invariant (`faff/SKILL.md:658`) and the interactive-only chaining rule — no offer/prompt in L3/L4.
- [ ] It sources the offer's "what" from `faff next` (chain steps) and the Unpark protocol (recovery), adding no new decision source.
- [ ] It carries the honest-limit caveat (behaviour-binding, not statically lintable; grep-presence necessary not sufficient; behavioural AC is the acceptance floor) mirroring `faff/SKILL.md:944`.

### From HOW (park recovery — the stall fix)
- [ ] Park protocol step 5 carries an interactive addendum: a terminal recovery offer naming the exact re-invoke command per park cause (spec→`/faff-prep`, build→`/faff-graft`, structural→`/faff-tidy`) plus the `/faff-wtf` later-route.
- [ ] The addendum is explicitly interactive-guarded; the autonomous path emits no offer (`grep` shows no ungated offer prose in the park path).
- [ ] `faff-wtf` Parked-work read-out (55-70) is unchanged.

### From HOW (push→PR — the "open pr" fix)
- [ ] faff-graft's review-pass→9b flow carries an interactive continuation instruction (proceed to 9b in the same turn) plus a terminal-offer fallback; Step 9b remains auto-open-on-pass, identical to autonomous (no new blocking gate — `grep` shows no "open PR? (y/n)" added).
- [ ] The Step 11 CI-wait handoff references the new gateway rule as the canonical terminal offer; the surviving "Merge now? (y/n)" gate is unchanged.

### From HOW (surviving gates + inventory)
- [ ] The already-surviving gates (prep Step 3, graft Step 2/6/11/12) each carry a one-line back-reference to the new gateway subsection and no behavioural edit.
- [ ] `docs/architecture/harness-coupling.md` has a new row for the turn-continuation / next-step-offer seam, disposition `drop`, tracing to the new gateway subsection and naming the FAFF-483 / lint follow-ons; the table's fixed historical count sentences remain coherent.

### From OUT OF SCOPE (negative assertions)
- [ ] No autonomous/orchestrator sequencing prose is changed; no prompt is added to any autonomous path.
- [ ] No `validate-adapters` (or other CLI) code is changed in this ticket; the lint is recorded as a follow-up extension point only.

**Integration smoke test (prose walk-through):**
```
1. grep -rin "forward-lean\|interactive next-step offer" plugin/skills/faff/SKILL.md   → ≥1 match
2. Read Park protocol step 5 → interactive addendum names a re-invoke command + /faff-wtf; autonomous emits none.
3. Read faff-graft review-pass→9b → continuation instruction present; no "open PR? (y/n)"; 9b still auto-open-on-pass.
4. grep -n "Turn-continuation" docs/architecture/harness-coupling.md                     → new drop-row present.
5. node plugin/skills/faff/bin/faff validate-adapters                                    → still passes.
6. Behavioural: re-run the FAFF-694 phase-boundary/stall scenario under Codex CLI        → offer fires, no silent turn-end.
```

confidence: high

spec-review: approve
