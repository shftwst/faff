# Spec — FAFF-251: Machine-authored PRDR DoD — L3 proposes / L4 self-defines

> Spec: faffter-dark-nlspec · 2026-06-27 · interactive (chain walk, 3 design decisions resolved with the human) · confidence: high. Full spec on Linear FAFF-251.

The **authoring intelligence** of the PRDR layer. FAFF-245 shipped the PRDR record but is deliberately *authoring-agnostic* (no human hand-writes DoDs); 251 is the machine path that **fills** a PRDR's content (its `## Definition of done` + the decision), **level-scaled** to the autonomy ladder. It produces the loop-authored PRDRs that FAFF-255 gates, FAFF-256 reviews (upper), and FAFF-257 rolls up (lower).

*(FAFF-245 shipped as the `faff prdr` record, not the old "DoD manifest" — this spec uses the PRDR-record framing throughout.)*

## 1. WHY
For lights-out, the machine must derive a project's delegated ends (its PRDR + DoD) itself, but safely. The decomposition of the human PRD into project PRDRs **is the methodology's call** (agile MVP cut / Shape-Up bets), so authoring lives in the methodology slot; admission stays FAFF-255's. The level only changes *who admits* the authored artifact.

**Principles:**
- **Decomposition is the methodology's call** → authoring is a `methodology` named output.
- **Level-agnostic authoring; 255 owns admission** — the authored PRDR is the same at L3 and L4; only the admitter differs.
- **Bounded by the leash** — every authored PRDR enters through 255's two gates + FAFF-222 containment + the appetite floor.

## 2. OUT OF SCOPE
- The PRDR record + `prdr new/supersede/validate` → **FAFF-245** (shipped). 251 *calls* it.
- The admission gates (authority / upper-YAGNI / lower-coverage) → **FAFF-255** (gate) + 256/257 (computations). 251 *produces*; 255 *admits*.
- The MVP-vs-finished target **selection** mechanism → **FAFF-40**. 251 *consumes* whatever target is set (defaulting to the methodology default).

## 3. WHAT — a new `methodology` named output

**Vocabulary:** PRDR authoring · project DoD · level-scaling (L3 propose / L4 self-define) · target (FAFF-40) · authored PRDR.

```
NAMED-OUTPUT prdr-author:                       # parallels crank-up-set
  inputs:  { project_outcome, child_specs, target }   # target: FAFF-40 order — explicit > inherited > methodology-default
  output:  AuthoredPrdr {
             decision, definition_of_done, container, prd_goal,
             provenance: "loop", status: "Proposed" }   # a FAFF-245 record, loop-authored, Proposed
```

**Chosen — home:** a new `methodology` named output (`prdr-author`), paralleling `crank-up-set`. Call-sites: `/faff-plot` (at project creation) + `/faff-jot` + on-demand (L3); the L4 runner (lights-out). One engine, many callers. *(Decision 1.)*

**Chosen — level-scaling:** the **same authored artifact**; the level only changes *who admits it*. *(Decision 2.)*

| Level | Author | Admit |
|---|---|---|
| **L3** | methodology proposes | human ratifies — writes `Proposed`, human flips `Accepted` on the tracker (255's gesture) |
| **L4** | methodology self-authors | run self-admits within 255's two gates + FAFF-222 containment + appetite (no human) |

**Chosen — inputs + bounds:** author from the project **outcome + child specs + the FAFF-40 target** (resolution: explicit > inherited > methodology-default); bounded by 255 + FAFF-222 + appetite. The target is a *consumed input* (defaults to methodology-default when unset) — **not a blocker**, so 251 ships before FAFF-40's selection UI. *(Decision 3.)*

## 4. HOW
```
PROCEDURE author_prdr(project, level):
  1. target := resolve(explicit > inherited > methodology-default)        # FAFF-40
  2. methodology derives from {outcome, child_specs, target}:
       - a Definition of done scaled to the target (thin MVP … finished)
       - the decision + scope (the delegated end this PRDR commits to)
       - the cited PRD goal it serves
  3. emit AuthoredPrdr (provenance: loop, status: Proposed); write via `faff prdr new`
  4. ROUTE TO ADMISSION (FAFF-255 — never 251's own logic):
       L3 → surface the Proposed PRDR; a human flips Status: Accepted (ratification)
       L4 → `faff prdr admit` with the FAFF-256 (upper) + FAFF-257 (lower) verdicts;
            on admit → self-Accept within gates + FAFF-222 + appetite;
            on propose-only / reject → escalate (needs-human) / park
```

**Fail-safe:** if the methodology can't derive a confident DoD → propose a **thin DoD flagged needs-human**; **never auto-self-define a vacuous DoD at L4** — escalate. The born-verifiable *form* of the authored DoD is checked by FAFF-254's `prd validate --strict` downstream (251 authors; 254 form-validates; 255 admits).

**Anti-patterns:** putting admission logic in 251 (that's 255); a human hand-authoring the DoD (defeats the purpose); self-defining at L4 outside the gates/containment.

## 5. Scenarios
- **L3, `/faff-plot` at creation:** methodology proposes a PRDR DoD from outcome+children+target → surfaced `Proposed` → human `Accepted` → live.
- **L4, lights-out:** run self-authors → `faff prdr admit` (255) with 256/257 verdicts → admitted within gates+222+appetite → live, no human.
- **target = thin-MVP vs finished** → the authored DoD's ambition scales accordingly.
- **methodology low-confidence** → proposes a flagged thin DoD + escalates (never a vacuous L4 self-define).
- Assertion: 251 writes only via `faff prdr new` (provenance loop, Proposed); it performs **no admission** — admission is 255's.

## 6. Manual changes are authoritative (tracker as control plane)
Core requirement for the authoring pass: it treats any **manual human change** to a project DoD as **authoritative** — resolution order **human-set > methodology-default** (mirroring FAFF-40's target resolution).

- Before (re)proposing, it **re-reads** the current DoD + any human edits — the steer-loop re-read, exactly like prep's post-spec comment scan (gateway → *Human curation is authoritative*).
- It **never clobbers** a human-modified DoD; machine authoring fills/defaults only what the human hasn't set.
- Per the **tracker-as-control-plane** tenet, the human's edit surface is the tracker (with the committed manifest as the machine-readable materialization — see FAFF-245).
- Applies at both levels: L3 proposes for approval (human may edit before approving → that edit wins); L4 self-defines but still defers to any pre-existing human-set DoD.

## 7. Open Questions / Assumptions
- **Open Questions: none** — home (methodology output), level-scaling (route through 255), inputs+bounds (outcome+children+target; bounded by 255+222+appetite) all resolved.
- **Assumes:** FAFF-245 record + `faff prdr new` (✓ shipped); FAFF-255 admission gate (specced, build-ready — 251 routes through it, so build 255 first or stub `prdr admit`); FAFF-222 containment (✓ shipped); FAFF-40 target readable, defaulting to methodology-default when unset (✓ degradable).

## 8. DONE
- [ ] a `methodology` named output `prdr-author` deriving an `AuthoredPrdr` from outcome + child specs + target.
- [ ] target resolution order explicit > inherited > methodology-default.
- [ ] L3 call-sites (`/faff-plot` at creation + `/faff-jot` + on-demand) surface the `Proposed` PRDR for human approval (ratify via tracker `Accepted`).
- [ ] L4 path: self-author → route through `faff prdr admit` (255) → self-admit within gates + FAFF-222 + appetite; propose-only/reject → escalate.
- [ ] authored DoD ambition scales to the target (MVP … finished).
- [ ] fail-safe: low-confidence → thin flagged DoD + escalate; never a vacuous L4 self-define.
- [ ] 251 writes the record via `faff prdr new` (loop/Proposed) and performs no admission of its own.

confidence: high

---
*Interactive chain-walk spec (3 design decisions resolved with the human, 2026-06-27). Verdict: **fire-and-forget**. Serialise behind FAFF-255 (routes through its `prdr admit` gate). ADR-promotion intent: the level-scaled authoring model (L3-propose/L4-self-define, both routed through the single 255 admission) is architecturally significant — materialise on build.*
