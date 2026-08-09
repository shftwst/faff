# nlspec — FAFF-218: Eligibility-label provenance by write-abstention

> Spec: faffter-dark-nlspec · 2026-06-22 · interactive · confidence: high. Full spec on Linear FAFF-218.

**Artifact:** design spec for FAFF-218. **Audience:** the build agent implementing it, and human reviewers gating the eligibility-provenance model. **Status of the framing:** this spec **supersedes** the issue description's "read-side actor attribution" framing. A design decision taken with the human this session pivoted the approach from *reading who set the label* to *guaranteeing only a human could have set it, by construction*. The WHY explains why the original framing's feasibility crux forced the pivot.

---

## 1. WHY — Problem and Principles

**The load-bearing model.** faff's autonomous pipeline trusts two tracker labels — `faff-automate` (this ticket may be auto-built) and `faff-automation-hold` (never auto-build this) — as the human's eligibility throttle. The whole value of that throttle depends on one fact: **a human, not an agent, set the label.** Today nothing enforces that — the same faff CLI an agent drives can add `faff-automate`. This spec makes the fact true **by construction**: faff's label-mutation CLI is made to *refuse* to write either eligibility label in any direction, so no sanctioned faff path can produce one. Therefore `faff-automate` present ⟹ a human toggled it directly in the tracker. The runtime read-gate that already trusts the label (FAFF-125) becomes trustworthy with **no** actor read, **no** self-marker, **no** bot identity, **no** new network or transport.

**Problem statement.** Today the eligibility throttle is guarded only by prose — the gateway asserts "no autonomous path ever adds `faff-automate` or removes `faff-automation-hold`" (`plugin/skills/faff/SKILL.md`:328), but the `faff label add/remove` CLI will happily write either label for any caller, agent or human. This is a provenance hole: an agent can crank itself up. This change closes the *sanctioned* path mechanically — the CLI refuses, and the chat crank flows become advisory (they name the label to toggle, they never execute the write).

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **Pure no-tracker-IO CLI invariant is preserved.** The refusal is a local predicate over the manifest + the requested label — it makes **zero** tracker/MCP calls, exactly like `eligible`/`next`/`label` today. An implementation that fetches anything from the tracker to decide the refusal violates this.
- **The human's gesture stays a native one-click tracker toggle (FAFF-19).** The scrum-master's territory is the board. This change adds **zero** new human ceremony and **no** CLI for the human — the refusal and the advisory flows are entirely machine-side. An implementation that introduces a human-run command to set eligibility is wrong.
- **Guardrail, not cryptographic control (the FAFF-212 stance).** The mechanical guarantee is "no *sanctioned* faff path writes the label." A raw tracker-MCP call bypassing the faff CLI remains possible — and that residual is stated plainly, not hidden. The win is that any eligibility-label write is now conspicuous and off-script.
- **Scope is exactly the two eligibility-throttle labels.** The machine-breadcrumb labels (`faff-parked`, `faff-jot-intake`, `faff-chain-gap-fill`) are faff's *own* and must remain CLI-writable. An implementation that refuses those breaks parking and intake tagging.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` `labelOp` ~:1983, `cmdLabel` ~:2053 | JS (Node CLI) | The mutation op; the refusal lives here |
| `plugin/skills/faff/bin/faff` `CONTROL_LABELS` ~:1951 | JS | Label manifest — single source of truth; gains the ownership flag |
| `plugin/skills/faff/bin/faff` `automationEligible` ~:2090, `cmdEligible` ~:2123 | JS | Pure precedence read — UNCHANGED, now trustworthy |
| `plugin/skills/faff-graft/SKILL.md` ~:100–114 | prose | FAFF-125 autonomous pre-worktree `faff eligible` read — the gate this makes trustworthy |
| `plugin/skills/faff/SKILL.md` ~:723–727 | prose | Control-label provisioning gateway section — advisory carve-out for the two labels |
| `plugin/skills/faff/SKILL.md` ~:324–328 | prose | Release/crank-up gateway prose — executory→advisory |
| `plugin/skills/faff-jot/SKILL.md` ~:97–106 | prose | Existing-ticket interactor (crank up/down/hold/unhold) → advisory |
| `plugin/skills/faff-tidy/SKILL.md` ~:98–112 | prose | §4a crank-up offer (single + batch) → advisory |
| `plugin/skills/faff-prep/SKILL.md` ~:189 | prose | Step-3 crank-up gate → advisory |

**Scope statement.** This sits in the provenance family (sibling of FAFF-212 intake, FAFF-217 scope-containment) and completes the provenance half FAFF-125 left open — the read-gate exists, this makes what it reads believable.

---

## 2. OUT OF SCOPE

- **Read-side actor attribution** — *Why excluded:* it was the original framing and is the thing this spec drops. No faff bot identity / actor concept exists today, and the Linear MCP exposes no per-label-change actor (only current `labels` and `stateHistory` without an actor). By-construction provenance sidesteps the primitive entirely. *Extension point:* none needed for FAFF-218; FAFF-216/217 still require the actor primitive and retain that dependency — this ticket's completion **drops** 218's dependency on it.
- **Filesystem self-marker / self-attribution** — *Why excluded:* a "faff wrote this" fs-marker is defeated by the chat crank flows, which legitimately run agent-side with human confirmation (see Design Decision Rationale). Self-attribution can't distinguish agent-on-human-confirm from agent-on-its-own. *Extension point:* none — superseded by write-abstention.
- **Autonomous safety-hold carve-out** — *Why excluded:* a future sentry/safety mechanism might want faff to autonomously **add** `faff-automation-hold` as an emergency brake. v1 is **total** prohibition for clean provenance. *Extension point:* a future ticket would re-introduce a narrow machine-write path for `faff-automation-hold`-add only, designed deliberately (a `--via safety-brake` analogue to `intake-record`), and must reckon with the provenance it reintroduces. Marked `**Punt:**` below.
- **Migration of pre-existing labels** — *Why excluded:* `faff-automate` labels applied by agents in past runs (including this session's tickets) are grandfathered. The guarantee is **forward-looking**: from this change onward, no sanctioned path writes the label. *Extension point:* no sweep is performed; pre-existing labels stay as-is. Noted in Assumptions.
- **Raw-MCP bypass prevention** — *Why excluded:* the faff CLI cannot prevent an agent from issuing a raw tracker-MCP `update labels` call directly. This is the acknowledged residual boundary (loud, not impossible). *Extension point:* none mechanical; the boundary is closed by review-visibility and the off-script conspicuousness of such a call, exactly as FAFF-212 frames its own bypass.
- **Machine-breadcrumb labels** (`faff-parked`, `faff-jot-intake`, `faff-chain-gap-fill`) — *Why excluded:* these are faff's own breadcrumbs; faff must keep writing them via the CLI. *Extension point:* they remain `tracker_owned:false` (default) in the manifest and are untouched.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| **Eligibility-throttle labels** | The two labels `faff-automate` and `faff-automation-hold` — the human's automation throttle. The subject of this spec. |
| **Machine-breadcrumb labels** | faff's own labels (`faff-parked`, `faff-jot-intake`, `faff-chain-gap-fill`) — faff writes these; out of scope. |
| **Tracker-owned label** | A control label faff's CLI **refuses** to mutate; only a human toggling it in the tracker UI can produce it. |
| **By-construction provenance** | Trust derived not from reading *who* set a label, but from the fact that *no sanctioned faff path could have* — so its presence implies a human. |
| **Advisory crank flow** | A chat flow that surfaces the recommendation and names the exact label to toggle in the tracker, but never executes the write. |

**Type definition — the manifest entry gains an ownership flag:**

```
RECORD ControlLabelEntry:
  name: String              # immutable; the tracker label name
  color: String             # hex
  description: String       # human-readable manifest description
  tracker_owned: Boolean    # NEW. default false (omitted ⇒ false).
                            #   true  ⇒ faff CLI refuses to add OR remove it (human-only, tracker UI)
                            #   false ⇒ faff CLI writes it as today (machine-breadcrumb)

  CONSTRAINT  tracker_owned == true  for exactly { "faff-automate", "faff-automation-hold" }
  CONSTRAINT  tracker_owned == false (or absent) for all machine-breadcrumb labels
```

**Decision — data-driven flag vs hardcoded name check.** Options: (a) hardcode `if label in {faff-automate, faff-automation-hold}` inside `labelOp`; (b) add `tracker_owned:true` to the two manifest entries and have `labelOp` read the flag. (b) keeps the manifest the single source of truth (matches the existing "no second copy" comment at `bin/faff`:~1978), makes the scope self-documenting at the manifest, and gives the future safety-hold carve-out a clean seam. **Chosen:** (b) — manifest flag `tracker_owned`, refusal predicate reads it.

**Interface — the refusal contract on `faff label add|remove`:**

```
INTERFACE  faff label <add|remove> <issue> <tracker-owned-label> [--present-label ...]
  PRECONDITION  resolved manifest entry has tracker_owned == true
  BEHAVIOUR
    - prints a clear human-readable message on STDERR telling the human to toggle
      the label directly in the tracker UI (and which label / which direction)
    - exits NON-ZERO (distinct from the existing rejection code; see HOW)
    - emits NO faff-contract:label-op descriptor (no write is sanctioned)
  INVARIANT  zero tracker/MCP access (pure, local manifest lookup)
```

This mirrors the existing CLI conventions: a non-zero exit with guidance, in the family of `intake-record`/`eligible`/`intakecheck` refusals.

**Interface — the advisory crank-flow contract** (replaces the four executory chat actions):

```
INTERFACE  advisory_crank(action ∈ {crank-up, crank-down, hold, unhold}, issue)
  - resolve current eligibility (faff eligible) to pick the right recommendation
  - PRINT: the recommendation + the EXACT label and direction to toggle in the tracker
           e.g. "FAFF-XX isn't automation-eligible. To crank it up, add the
                 `faff-automate` label to FAFF-XX in the tracker (one-click on the board)."
  - NEVER call `faff label add|remove` for an eligibility label
  - NEVER issue a raw tracker write for an eligibility label
  - log the advice given (the human's actual toggle happens out-of-band in the tracker)
```

---

## 4. HOW — Behavior

**Architecture and approach.** Two coordinated changes:

1. **CLI (deterministic, the guarantee):** `CONTROL_LABELS` gains `tracker_owned:true` on the two eligibility entries. `labelOp` (and `cmdLabel`'s exit handling) gain a refusal branch: when the resolved entry is `tracker_owned`, refuse with a non-zero exit and a tracker-UI message, emitting no descriptor. This is the one load-bearing change — it makes the guarantee true regardless of what the prose says.
2. **Prose (advisory, the UX):** the four chat crank flows (jot interactor, tidy §4a single + batch, prep Step-3 gate) stop calling `faff label add|remove` for the two labels and instead **point** the human at the tracker toggle. The gateway's Release/crank-up section (`SKILL.md`:324–328) and Control-label provisioning section (`SKILL.md`:723–727) are updated so the executory path becomes advisory for these two labels only.

**Behavior summary — the refusal.** When any caller asks the CLI to add or remove a `tracker_owned` label, the CLI does not perform the deterministic which-label/ensure-first computation and emits no write descriptor; it refuses loudly and points the human at the board.

```
PROCEDURE labelOp(action, issue, label, present):
  1. entry := CONTROL_LABELS.find(name == label)
  2. IF entry is null:
       a. RETURN { rejected: true, label }          # existing not-a-control-label path
  3. IF entry.tracker_owned == true:                # NEW
       a. RETURN { refused: true, label, action, issue }
  4. ... existing add/remove descriptor computation (machine-breadcrumb labels only) ...
```

```
PROCEDURE cmdLabel(args):
  1. ... existing action/issue/label/present parsing ...
  2. result := labelOp(...)
  3. IF result.rejected:                            # existing
       a. STDERR "'<label>' is not a faff control label (see `faff labels --names`)"
       b. EXIT 1
  4. IF result.refused:                             # NEW
       a. STDERR:
          "faff label: '<label>' is a tracker-owned eligibility label — faff will not
           <add|remove> it. Toggle it directly on <issue> in the tracker (one click on the
           board). This keeps automation eligibility a human-only decision (FAFF-218)."
       b. EXIT <REFUSED_CODE>                       # see edge cases for the code choice
  5. ... existing descriptor emit + EXIT 0 ...
```

**Edge cases and error handling:**

- **All four directions refused.** `add faff-automate` (crank up), `remove faff-automate` (crank down), `add faff-automation-hold` (hold), `remove faff-automation-hold` (unhold) — every one hits step 3 and refuses. There is no direction the CLI will write.
- **Exit-code precedence.** Existing codes: `2` = usage error, `1` = not-a-control-label rejection, `0` = success. The refusal must be **non-zero and distinct from `0`**, and should be distinguishable from the usage/`not-a-control-label` cases so a caller (and the selftest) can assert it. **Chosen:** distinct refusal exit code `3`, message names the label + direction + the tracker-toggle remedy.
- **Machine-breadcrumb labels unaffected.** `add faff-parked`, `remove faff-parked`, `add faff-jot-intake`, `add faff-chain-gap-fill` — `tracker_owned` is false ⇒ step 3 falls through ⇒ existing descriptor path ⇒ exit `0`. Parking and intake tagging keep working unchanged.
- **`--present-label` idempotency for tracker-owned labels is moot** — refusal happens before any idempotency computation; the flags are ignored on the refused path.
- **jot's existing "no-op + inform" edge cases** (crank up of an already-eligible ticket, etc.) are **superseded** for the two labels: the flow never reaches a CLI write at all, so there is no no-op to compute — the advisory message is always "toggle in the tracker," regardless of current state (it may *mention* current state to orient the human).

**Failure modes — how the approach falls over, and how you'd notice:**

- **The failure:** the guarantee is only as strong as "every sanctioned write goes through `faff label`." If some other faff code path (or a skill prose instruction) issues a raw tracker `update labels` for an eligibility label, the guarantee silently leaks — `faff-automate` could appear without a human. *How you'd know:* a grep of the skill corpus + CLI for tracker label-writes that name `faff-automate`/`faff-automation-hold` outside `faff label`; the build must verify none exist after the prose edits. *What it means:* proceed only if the grep is clean; any hit is a hole to route through the refusal or remove.
- **The failure:** raw-MCP bypass — an agent calls the tracker MCP directly, never touching `faff label`. The CLI cannot stop this. *How you'd know:* you don't, mechanically — this is the acknowledged residual; it's caught only by the write being conspicuous and off-script in review. *What it means:* proceed — this is the stated boundary (guardrail, not cryptographic control), identical to FAFF-212's stance. Do **not** add tracker IO to try to close it; that would violate the pure-CLI invariant for a boundary that's accepted.
- **The failure:** advisory drift — a future edit re-introduces an executory `faff label add <issue> faff-automate` into a chat flow, and because the CLI now refuses, that flow breaks loudly (exit 3) instead of silently cranking up. *How you'd know:* the flow errors at the refusal. *What it means:* this is actually the **desired** failure direction — loud refusal beats silent self-crank-up. The prose edits should still remove the executory calls so the happy path doesn't hit a refusal.

**Anti-patterns:**

- **Anti-pattern:** hardcoding the two label names inside `labelOp`. Why: duplicates the manifest's single-source-of-truth role and hides the scope; use the `tracker_owned` flag.
- **Anti-pattern:** making the CLI fetch current labels / actor to decide the refusal. Why: breaks the pure no-tracker-IO invariant; the refusal is a local manifest lookup only.
- **Anti-pattern:** refusing machine-breadcrumb labels too. Why: breaks parking and intake; scope is exactly the two eligibility labels.
- **Anti-pattern:** adding a human-run CLI to set eligibility "since the CLI now refuses." Why: violates FAFF-19 — the human's gesture stays a native tracker toggle, no new ceremony.

---

## 5. Scenarios — born-verifiable main objectives

```
Given the faff CLI and a ticket FAFF-XX
When `faff label add FAFF-XX faff-automate` is run (crank up)
Then the CLI exits non-zero, prints a message naming faff-automate and the
     tracker-toggle remedy, and emits no faff-contract:label-op descriptor
```

```
Given the faff CLI and a ticket FAFF-XX carrying faff-automation-hold
When `faff label remove FAFF-XX faff-automation-hold` is run (unhold)
Then the CLI refuses identically — no direction of either eligibility label is writable
```

```
Given the machine-breadcrumb label faff-parked
When `faff label add FAFF-XX faff-parked` is run
Then the CLI behaves exactly as today — emits the label-op descriptor and exits 0
     (the refusal is scoped to the two eligibility labels only)
```

```
Given an interactive chat crank flow (jot interactor / tidy §4a / prep Step-3)
When the human confirms "crank up"
Then the flow surfaces the recommendation and names the exact label + tracker toggle,
     and never executes a faff label write nor a raw tracker write for the eligibility label
```

```
Given a human has toggled faff-automate on FAFF-XX directly in the tracker UI
When the autonomous FAFF-125 pre-worktree gate runs `faff eligible` over its labels
Then it reads true and proceeds — and that true is now trustworthy because no
     sanctioned faff path could have produced the label (by-construction provenance)
```

```
Given a faff agent that bypasses the faff CLI with a raw tracker-MCP update
When it adds faff-automate directly
Then the guarantee does NOT hold for that write — this residual bypass is acknowledged,
     loud-not-impossible, and out of scope to prevent (assertion, not a GWT to automate)
```

**Non-functional assertions:**

- The refusal path makes **zero** tracker/MCP calls (pure-CLI invariant preserved).
- The change adds **zero** new human-facing CLI commands and **zero** new human ceremony (FAFF-19).

---

## 6. Design Decision Rationale

**Should eligibility-label provenance be established by reading *who* set the label, or by guaranteeing only a human *could* have?**
- *Read-side actor attribution (original framing):* read the tracker's per-label-change actor and trust the label only if a human set it. *Cons:* no faff bot identity exists; the Linear MCP exposes no per-label-change actor (only current `labels` + `stateHistory` without an actor) — it is **infeasible** on the current tracker surface, and it forces a new actor primitive + tracker reads into the otherwise-pure read path. This infeasibility is the crux that forced the pivot.
- *Filesystem self-marker (self-attribution):* faff writes a "faff set this" marker when it cranks up; trust the label only if no such marker. *Cons:* the chat crank flows legitimately run agent-side **with** human confirmation — a self-marker can't distinguish "agent wrote on the human's explicit confirm" from "agent wrote on its own." The chat-crank-up entanglement kills self-attribution: the agent is the writer in both the sanctioned and unsanctioned cases.
- *Write-abstention (by-construction):* faff's CLI refuses to write the labels at all; chat flows go advisory. *Pros:* no actor read, no self-marker, no bot identity, no new network/transport; preserves the pure no-tracker-IO CLI invariant; tracker-portable and git-only-safe; upgrades the gateway's existing prose guard to CLI-enforcement; drops 218's dependency on the actor primitive. *Cons:* raw-MCP bypass remains possible (accepted residual).

**Chosen:** write-abstention. It is the only option feasible on the current tracker surface, it is strictly simpler (removes a dependency rather than adding a primitive), and it makes the FAFF-125 read-gate trustworthy with no new reads. It beats read-side attribution (infeasible — no actor exposed) and beats self-attribution (defeated by the agent-writes-on-human-confirm chat flows).

**Where does the refusal predicate live — hardcoded names or a manifest flag?** *Chosen:* a `tracker_owned:true` manifest flag (see WHAT) — keeps the manifest the single source of truth and gives the future safety-hold carve-out a clean seam.

**Is total prohibition right, or should faff retain an emergency `faff-automation-hold`-add?** v1 chooses **total** prohibition for clean provenance; the safety-brake carve-out is punted (see Open Questions) because any machine-write path reintroduces the provenance question it must answer deliberately.

*Temporal anchor:* at the time of writing, the Linear MCP exposes no per-label-change actor; if a future tracker/MCP surfaces one, read-side attribution becomes feasible but is still not needed for 218 (write-abstention already gives the guarantee more cheaply).

---

## 7. Open Questions and Assumptions

**Open Questions:**

- **Punt:** Autonomous safety-hold carve-out — should a future sentry be allowed to autonomously **add** `faff-automation-hold` as an emergency brake? v1 is total prohibition; a carve-out reintroduces a machine-write path and must be designed deliberately (e.g. a `--via safety-brake` analogue to `intake-record`, with its own provenance accounting). Out of scope for FAFF-218 — needs human.
- **Punt:** Refusal exit code — distinct code `3` (chosen) vs reusing `1`. Non-blocking: either satisfies "non-zero + clear message." Flagged so the reviewer can confirm `3` doesn't collide with any caller's exit-code expectations. Needs human only if a downstream caller keys on label exit codes.

**Assumptions:**

- **Assumes:** the gateway prose at `SKILL.md`:324–328 and the Control-label provisioning section at :723–727 are the *only* gateway homes for the executory crank language. *Validation:* grep `plugin/skills/faff/SKILL.md` for the executory crank language and confirm no other home; route any extra hit through the advisory carve-out.
- **Assumes:** the four chat crank flows are the complete set of executory eligibility-label writers (jot interactor, tidy §4a single + batch, prep Step-3). *Validation:* grep `plugin/skills/` for `faff label add/remove` naming an eligibility label and confirm every executory hit is one of these four; convert each to advisory. A clean grep after the edits is the failure-mode check from HOW.
- **Assumes:** pre-existing `faff-automate` labels applied by past agent runs are acceptable to grandfather (the guarantee is forward-looking). *Validation:* none required — no migration sweep is in scope; confirm with the reviewer that no retroactive strip is wanted.
- **Assumes:** `labelOp`'s selftest harness (`LABEL_SELFTEST_CASES`) is the right place to assert the refusal. *Validation:* read the existing cases; add refusal cases for all four directions + a machine-breadcrumb pass-through case.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] An eligibility label present on a ticket implies a human set it directly in the tracker — no sanctioned faff path can produce it (verified by the clean grep + the CLI refusal).
- [ ] The FAFF-125 `faff eligible` read path is unchanged (`automationEligible`/`cmdEligible` untouched) and now trustworthy.

### From WHAT (types and interfaces)
- [ ] `CONTROL_LABELS` entries for `faff-automate` and `faff-automation-hold` carry `tracker_owned: true`; all machine-breadcrumb entries do not (absent/false).
- [ ] `labelOp` reads `entry.tracker_owned` (not a hardcoded name set) to decide refusal.
- [ ] The advisory crank-flow contract is reflected in the four prose flows: each names the exact label + tracker toggle and executes no write.

### From HOW (behaviour)
- [ ] `faff label add <issue> faff-automate` exits non-zero (code `3`), prints a message naming the label + tracker-toggle remedy, emits no `faff-contract:label-op` descriptor.
- [ ] `faff label remove <issue> faff-automate` (crank down) refuses identically.
- [ ] `faff label add <issue> faff-automation-hold` (hold) refuses identically.
- [ ] `faff label remove <issue> faff-automation-hold` (unhold) refuses identically.
- [ ] `faff label add|remove <issue> faff-parked` (and `faff-jot-intake`, `faff-chain-gap-fill`) behave exactly as today — descriptor emitted, exit `0`.
- [ ] Gateway prose at `SKILL.md`:324–328 and :723–727 describes the two labels as tracker-owned/advisory (executory path removed for them); the existing "no autonomous path ever adds…" prose is now CLI-enforced.
- [ ] jot interactor (crank up/down/hold/unhold), tidy §4a (single + batch crank-up), and prep Step-3 crank-up gate are advisory — none calls `faff label` for an eligibility label.

### From HOW (edge cases)
- [ ] Refusal exit code is distinct from usage (`2`) and not-a-control-label (`1`).
- [ ] jot's prior "no-op + inform" edge cases no longer apply to the two labels (the flow never reaches a CLI write).
- [ ] A corpus grep confirms no executory eligibility-label write remains anywhere in `plugin/skills/` outside the refusing CLI.

### From the residual boundary
- [ ] The spec/prose states plainly that a raw-MCP bypass remains possible (loud-not-impossible), and no tracker IO is added to the CLI to chase it.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. assert: `faff label add FAFF-TEST faff-automate`  → exit 3, message names tracker toggle, no descriptor on STDOUT
  2. assert: `faff label add FAFF-TEST faff-parked`     → exit 0, faff-contract:label-op descriptor emitted
  3. assert: `faff label --selftest`                    → PASS (includes the 4 refusal cases + the breadcrumb pass-through)
  # if these pass, the refusal predicate is wired to the manifest flag and scoped correctly
```

---

confidence: high
