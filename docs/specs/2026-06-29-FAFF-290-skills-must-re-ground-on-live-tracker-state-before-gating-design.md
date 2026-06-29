# Re-ground on live tracker state before gating (FAFF-290)

> Spec: faffter-dark-nlspec · 2026-06-29 · interactive · confidence: high. Full spec on Linear FAFF-290.

This is the build spec for FAFF-290. Audience: the build agent editing faff's skill prose, and the human reviewers gating it. The deliverable is a **prose-contract sharpening** of the faff gateway plus four chokepoint skills — no new CLI, no code, no schema.

## 1. WHY — Problem and Principles

**The load-bearing idea: a gate is only as fresh as its inputs, and faff's freshness discipline currently covers two of the three inputs a gate reads.** A faff skill that decides whether to act on an issue (automation-eligibility, the automation-routing verdict, claim-before-admit) reads tracker state and computes a gate from it. If that state is a *remembered* read from earlier in the same session rather than a *live* read taken at the gate, the gate can be silently wrong — and the human who steered the tracker between turns (the single sanctioned control surface) is overridden by a stale snapshot.

**Problem statement.** Today the "Always pull fresh" rule, FAFF-82's claim-before-admit re-read (status), and FAFF-110's Live-thread reconciliation (verdict inputs) guard *status* and *verdict inputs*, but the **eligibility-label set** (`faff-automate` / `faff-automation-hold`) is not held to the same freshness bar — the discipline is partial and prose-only. On 2026-06-29 `/faff-beep-boop FAFF-289` computed `faff eligible` from labels read earlier in the session, *before* a human added `faff-automate`, and wrongly asserted "not eligible," blocking a legitimately-eligible build until the human re-corrected. This change names a single **re-ground-before-gate** invariant — the three freshness members in one place — and points every gating chokepoint at it.

**Design principles.**

- **The CLI gates stay pure.** `faff eligible` / `faff next` take labels/flags as arguments and make no tracker call — that purity is deliberate (deterministic-tools-over-prose). The fix lives entirely in the **caller**, which must source the labels it passes from a read taken at the gate. Pushing a tracker fetch into the pure CLI is an anti-pattern and would only be cosmetic.
- **One fetch, co-located.** The label re-read rides on FAFF-82's *existing* claim-before-admit live re-read — the same site that already re-reads status — so this adds no new round-trip where that re-read already exists.
- **Name it once, refer back.** The three freshness members are defined in one named gateway sub-section; chokepoints reference it rather than each restating the rule (the gateway-is-the-one-home convention).

**Reference context.**

| System | File | Relevance |
|---|---|---|
| Gateway "Always pull fresh" | `plugin/skills/faff/SKILL.md` (§ Always pull fresh) | The general rule to sharpen to name labels |
| Gateway "Issue claim & status monotonicity (FAFF-82)" | `plugin/skills/faff/SKILL.md` (§ Issue claim…) | The claim-before-admit live re-read to extend + co-locate on |
| Gateway "Live-thread reconciliation (FAFF-110)" | `plugin/skills/faff/SKILL.md` (§ Automation-routing verdict, fixed) | The verdict-input freshness member (already exists) |
| beep-boop chokepoints | `plugin/skills/faff-beep-boop/SKILL.md` (step 4, claim-before-admit, step 8.4) | Build-queue eligibility filter + `faff next` consult + claim re-read + wave re-entry |
| tidy chokepoints | `plugin/skills/faff-tidy/SKILL.md` (§ Ready to pick up, § On hold crank-up) | Ready→Todo promotion `faff next` consult + crank-up offers |
| prep chokepoint | `plugin/skills/faff-prep/SKILL.md` (Autonomous-eligibility gate) | "compute `faff eligible` from its labels" |
| graft chokepoint | `plugin/skills/faff-graft/SKILL.md` (Step 2 tail eligibility gate, Step 5 claim) | Pre-worktree `faff eligible` shell + claim |

**Scope statement.** This sits in faff's gateway contract layer and the four autonomous-gating skills — it sharpens an existing freshness discipline, it does not introduce a new mechanism.

## 2. OUT OF SCOPE

- **A `faff` CLI affordance / wrapper that fetches-then-gates.** Why excluded: the CLI gates are pure by invariant; a fetch-and-gate wrapper could only be cosmetic and would re-import a tracker dependency into the pure layer. Extension point: if a future need for a *mechanical* freshness proof emerges, it would live as a new optional `faff`-side check, not inside `faff eligible`/`faff next`.
- **Static lint enforcement (`validate-adapters` rule) proving a caller passed a fresh read vs a snapshot.** Why excluded: caller-side fresh-sourcing is a runtime-interaction property, not statically decidable from skill prose (same documented limit as the chaining gate). Extension point: a future runtime assertion / telemetry probe, not a static lint.
- **Changing the eligibility *semantics*** (precedence, `automation_default`, the label vocabulary). Why excluded: this ticket is purely about the *freshness of the inputs* to the unchanged decision. Extension point: gateway § Automation eligibility owns the semantics.
- **`/faff-jot`, `/faff-wtf`, `/faff-map`.** Why excluded: jot is interactive-only (never autonomously gates); wtf/map are read/report skills, never gated by eligibility. Extension point: if a read skill ever begins *acting* on eligibility, it joins the chokepoint list.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Gate | A point where a skill decides whether/how to act on an issue from tracker state: eligibility, the automation-routing verdict, or claim-before-admit. |
| Re-ground | Re-read the issue's current tracker state (labels + status, and the comment thread where the verdict needs it) immediately before the gate, never reusing an earlier same-session tool-result. |
| Eligibility-label set | The two control labels the eligibility decision consumes: `faff-automate` and `faff-automation-hold`. |
| Freshness member | One of the three input classes a gate may read that must be live at the gate: **status** (FAFF-82), **verdict inputs** (FAFF-110), **eligibility labels** (this ticket). |

**The named invariant (new gateway sub-section — the WHAT this ticket delivers).** A short, fixed sub-section titled **"Re-ground before gate"**, placed in the gateway adjacent to "Always pull fresh", defining:

```
INVARIANT Re-ground-before-gate:
  Any skill that computes a gate (eligibility | automation-routing verdict | claim-before-admit)
  re-reads the issue's CURRENT tracker state immediately before the gate.
  The three freshness members it covers:
    1. status            — FAFF-82 (Issue claim & status monotonicity)
    2. verdict inputs     — FAFF-110 (Live-thread reconciliation: post-spec comments)
    3. eligibility labels — THIS ticket (the faff-automate / faff-automation-hold set)
  Rule: the labels + status a gate consumes come from a read taken AT the gate,
        never from an earlier same-session tool-result.
  Co-location: the eligibility-label + status re-read ride on FAFF-82's existing
        claim-before-admit live re-read (one fetch) wherever that re-read already runs.
  Honest limit: this is a RUNTIME discipline, prose-contract-enforced — NOT statically
        lintable (validate-adapters cannot prove a caller passed a fresh read vs a snapshot),
        consistent with the chaining gate and the existing FAFF-82 / FAFF-110 disciplines.
```

**Design decision — where the fix lives.** Options: (a) push freshness into the pure CLI gates; (b) caller-side prose contract rule; (c) both. (a) breaks the pure-CLI invariant; a CLI affordance can only be cosmetic. **Chosen:** (b) — a caller-side gateway contract rule extending FAFF-82's existing live re-read to the eligibility-label set, with the three freshness members named in one place. No CLI/code change.

**Design decision — one fetch or a new fetch per gate.** **Chosen:** co-locate the label + status re-read on FAFF-82's existing claim-before-admit fetch (one fetch) wherever that re-read already runs; a chokepoint that gates *before* any FAFF-82 site (e.g. prep's pre-spec eligibility gate, beep-boop's queue-assembly filter) takes its own fresh read at that gate. No redundant round-trip is added where the re-read already exists.

**Design decision — enforcement surface.** **Chosen:** prose contract only, with the honest not-statically-lintable limit stated in the invariant text. **Assumes:** `faff validate-adapters` does not (and is not expected to) gain a rule for this — the existing freshness disciplines (FAFF-82/110) are likewise prose-enforced, so this is consistent, not a regression.

## 4. HOW — Behavior

**Approach.** Two edit classes: (1) gateway contract text (the named invariant + the sharpened "Always pull fresh" enumeration); (2) one prose touch per chokepoint, each pointing at the new invariant and stating it re-reads current labels+status at the gate.

**(1) Gateway edits (`plugin/skills/faff/SKILL.md`).**

```
PROCEDURE gateway_edits:
  1. § "Always pull fresh": in the enumerated must-refetch state list
     ("issues, blocker links, status fields, the comments a pass classifies on, …"),
     ADD "labels (in particular the eligibility-label set faff-automate / faff-automation-hold)"
     so labels are named explicitly, not implied.
  2. ADD the "Re-ground before gate" sub-section (the INVARIANT above) adjacent to it:
     - names the three freshness members + their owning tickets
     - states the at-the-gate-not-snapshot rule
     - states the one-fetch co-location on FAFF-82's claim-before-admit re-read
     - states the honest not-statically-lintable limit
  3. § "Issue claim & status monotonicity (FAFF-82)": note that the same live
     re-read also re-reads the eligibility-label set (one fetch), referencing the new invariant.
```

**(2) Chokepoint prose edits — each names the invariant and states the at-the-gate re-read.**

```
PROCEDURE chokepoint_edits:
  beep-boop (faff-beep-boop/SKILL.md):
    - explicit-list queueing: re-read labels+status at the gate before computing eligibility/verdict
    - build-queue assembly (step 4, the eligibility filter + `faff next` consult):
        source the labels fed to `faff eligible`/`faff next` from a read taken at assembly
    - claim-before-admit (the FAFF-82 re-read site): EXTEND the existing live re-read to
        also cover the eligibility-label set (one fetch) — the canonical co-location site
    - wave re-entry (step 8.4): same re-read on re-assembly (an issue a human cranked up
        between waves becomes eligible on re-entry)
  tidy (faff-tidy/SKILL.md):
    - Ready→Todo promotion (`faff next` consult): source labels from the live backlog re-fetch
        tidy already does (§ Always pull fresh) — name it explicitly at the promote gate
    - crank-up offers (On hold): the eligibility read driving the offer is the live one
  prep (faff-prep/SKILL.md):
    - autonomous eligibility gate ("compute `faff eligible` from its labels"):
        the labels are read at the gate (prep already fetches the issue at entry — name that
        the gate's source, and re-read if a refresh path spans turns)
  graft (faff-graft/SKILL.md):
    - pre-worktree autonomous eligibility gate (Step 2 tail, shells `faff eligible` on Step-1 labels):
        Step-1 labels are captured from the same fresh get_issue; state they must be the
        at-the-gate read, not a carried snapshot
    - Step 5 claim: already FAFF-82's live status re-read — reference the invariant so the
        label freshness is explicit here too
```

**Anti-pattern:** adding a tracker fetch inside `faff eligible` / `faff next`. Why: it breaks the pure-CLI invariant (deterministic-tools-over-prose) and only moves the freshness burden, cosmetically, off the caller where it belongs.

**Anti-pattern:** restating the full invariant at each chokepoint. Why: the gateway is the one home for shared contract prose; chokepoints refer back (the dedup convention) — a copy rots.

**Anti-pattern:** adding a second fetch at a site that already runs FAFF-82's claim-before-admit re-read. Why: the label re-read co-locates on that one fetch; a duplicate round-trip is waste.

**Failure modes.**

- **The failure:** the prose edits land but a future skill author adds a *new* gating site and feeds it a snapshot — the contract can't mechanically stop them. **How you'd know:** a recurrence of the FAFF-289 symptom (a between-turn human eligibility edit ignored). **What it means:** proceed — this is the named, accepted honest limit (runtime discipline, not static lint); the named invariant makes the rule discoverable, which is the realistic mitigation. A future runtime probe is the extension point, out of scope here.
- **The failure:** co-locating on FAFF-82's re-read misses a chokepoint that gates *before* any FAFF-82 site, leaving it reading a snapshot. **How you'd know:** review of each chokepoint shows a gate with no fresh read upstream of it. **What it means:** narrow per-site — those gates (prep pre-spec, beep-boop queue-assembly) take their own at-the-gate read, which the chokepoint edits above already specify.

## 5. SCENARIOS — born-verifiable main objectives

```
Given an issue read early in a beep-boop session WITHOUT faff-automate,
  and a human adds faff-automate before the build-queue assembly gate
When build-queue assembly computes eligibility for that issue
Then the labels fed to `faff eligible` are sourced from a read taken at assembly,
  so the issue is correctly judged eligible (not from the pre-edit snapshot)
```

```
Given the gateway after this change
When a reader looks for the freshness contract
Then a single named "Re-ground before gate" sub-section enumerates the three
  freshness members (status / verdict inputs / eligibility labels) with their owning
  tickets, the at-the-gate rule, the one-fetch co-location, and the honest not-statically-lintable limit
```

```
Given each of the named chokepoints (beep-boop step 4 / claim-before-admit / step 8.4,
  tidy promote + crank-up, prep autonomous gate, graft pre-worktree gate + Step 5)
When its prose is read
Then it states it re-reads the issue's current labels+status at the gate (or co-locates on
  FAFF-82's claim-before-admit re-read) and refers to the named invariant — not a restated copy
```

Assertion: no new `faff` subcommand, CLI flag, `.faffrc` key, code file, or selftest is introduced (prose-only change). Assertion: `faff validate-adapters` still passes on every edited `SKILL.md` (line caps / no stray markers / no duplicated blocks).

## 6. DESIGN DECISION RATIONALE

**Where does the fix live — pure CLI, or caller?**
- Push into CLI: rejected — breaks the pure-by-invariant `faff eligible`/`faff next` (no tracker access); the affordance could only be cosmetic.
- Caller-side contract rule: chosen.
- **Chosen:** a gateway caller-side contract rule (extend FAFF-82's live re-read to labels), because the staleness is a caller-sourcing bug, not a CLI bug.

**One fetch or per-gate fetch?**
- New fetch per gate: redundant where FAFF-82's re-read already runs.
- **Chosen:** co-locate on FAFF-82's existing claim-before-admit re-read (one fetch) where it runs; gates upstream of any FAFF-82 site take their own at-the-gate read — no redundant round-trips.

**Cosmetic CLI wrapper to "make it feel mechanical"?**
- **Chosen:** none (YAGNI) — a non-load-bearing wrapper is ceremony; the honest limit is stated instead.

**Mechanical lint vs prose contract?**
- **Chosen:** prose contract with the honest limit stated — caller fresh-sourcing is a runtime property, not statically decidable (same as the chaining gate and FAFF-82/110). At the time of writing, `validate-adapters` has no construct that could prove it; revisit only if a runtime-assertion capability is built.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. The design punt (gateway rule vs CLI affordance vs both) was resolved by the human this session — the fix is the caller-side gateway contract rule, no CLI.

**Assumptions:**
- **Assumes:** `faff validate-adapters` does not gain a rule for this and is not expected to — validation instruction: confirm no new lint rule is requested in review; the not-statically-lintable limit is stated in the invariant text and is consistent with FAFF-82/110.
- **Assumes:** FAFF-82's claim-before-admit live re-read and FAFF-110's Live-thread reconciliation exist in the gateway as referenced — validation instruction: grep the gateway for the "Issue claim & status monotonicity" and "Live-thread reconciliation" sections before co-locating on them (both confirmed present at spec time).

## 8. DONE — Definition of Done

### From WHY
- [ ] The gateway states that a between-turn human eligibility edit must not be overridden by a remembered read — the bug's pain point is addressed by a named contract.

### From WHAT (the named invariant)
- [ ] Gateway carries a named "Re-ground before gate" sub-section enumerating the three freshness members (status → FAFF-82, verdict inputs → FAFF-110, eligibility labels → this ticket).
- [ ] The sub-section states the at-the-gate-not-snapshot rule and the one-fetch co-location on FAFF-82's claim-before-admit re-read.
- [ ] The sub-section states the honest not-statically-lintable limit, consistent with FAFF-82/110.

### From WHAT (Always pull fresh)
- [ ] § "Always pull fresh" enumerates **labels** explicitly (naming the `faff-automate` / `faff-automation-hold` eligibility-label set) among the must-refetch state.

### From HOW (chokepoint edits)
- [ ] beep-boop: explicit-list queueing, build-queue assembly (step 4), claim-before-admit (the FAFF-82 re-read EXTENDED to the label set), and wave re-entry (step 8.4) each state an at-the-gate label+status re-read and reference the invariant.
- [ ] tidy: Ready→Todo promotion and crank-up offers each source eligibility from the live re-fetch at the gate and reference the invariant.
- [ ] prep: the autonomous eligibility gate states its labels are the at-the-gate read.
- [ ] graft: the pre-worktree eligibility gate (Step 2 tail) and Step 5 claim state the label freshness explicitly and reference the invariant.

### From HOW (constraints)
- [ ] No new `faff` subcommand, CLI flag, `.faffrc` key, code file, or selftest is introduced.
- [ ] `faff validate-adapters` passes on every edited `SKILL.md`.

**Integration smoke test:**
```
1. grep the gateway for "Re-ground before gate" → the named sub-section exists with the 3 members.
2. grep the gateway "Always pull fresh" paragraph → "labels" / "faff-automate" appears.
3. grep each chokepoint SKILL.md for the invariant reference at its gate → present at every named site.
4. run `faff validate-adapters` → exit 0 on all edited SKILL.md files.
```

## Methodology critique

*Agile-delivery lens (issue-critique).*

- **Right-sized?** Yes — one cohesive concern (name the freshness invariant once, point each gating chokepoint at it). The gateway edit + chokepoint touches always ship together (a named invariant with no referencing chokepoints, or chokepoints citing a non-existent invariant, is incoherent), so this is a single 1–2 day unit, not two splittable concerns. No split.
- **Workstream fit?** Cohesive with the tracker-as-control-plane / freshness family (FAFF-82 status, FAFF-110 verdict inputs, FAFF-19 human-curation-authoritative) — it completes the third freshness member rather than opening a new line.
- **Deps surfaced?** Both load-bearing references (FAFF-82, FAFF-110) are already **shipped** in the gateway, so there is no open blocker — the existing `relatedTo` edges are the correct (non-blocking) relation. No missing `blockedBy` link.
- **Risk profile?** Low — prose-only, no code, no new CLI, no external dependency, no novel integration. No de-risking spike warranted. The one named residual (not statically lintable) is an accepted honest limit, not a delivery risk.

confidence: high
