# FAFF-534 — Within-run convergence: default posture for autonomous runs

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous-refresh · confidence: high. Full spec on Linear FAFF-534.

> **Refreshed 2026-07-23** (autonomous-refresh, run-20260723-144253-beepboop-full) — the one open Punt (**Decision D** — does the L4 code guardrail ship in this ticket or a follow-up?) was closed by a human Decision comment (2026-07-23, via /faff-tidy): **follow-up.** The lights-out convergence-forcing guardrail ships as **FAFF-624** (filed, `blockedBy` FAFF-534); this ticket delivers the prose/config flip only. Decision D's `**Punt:**` is now `**Chosen:**`; §7 open questions has none; confidence re-rates **medium → high**. The dependency edges the methodology critique asked for are recorded (534 blocks 535; 496/498 → 534 blockedBy). No design decision, interface, or approach changed — the fold only settles *where the code guarantee lands*, which the spec already recommended as a follow-up.
>
> **Edit-site re-verification on current `main`.** `.faffrc.example.yaml` convergence block (L192–201, "Off by default (L4 discipline)" at L192, `enabled: false` L200, `max_waves: 6` L201) — present. `.faffrc.example.yaml` `automation_default: opt-in` (L174, the pre-flip gate) — present. beep-boop `SKILL.md` L45 (`--converge` announce) / L112 (within-run-convergence def) / L225–230 (wave-boundary branch) — present. `lights-out.js` forces `appetite: full` + refuses count-cap-only budget — present (the FAFF-624 template and the §7 assumption both hold).
>
> **Correction — the `design/planning-loop.md` de-stale target does not exist.** `design/planning-loop.md` is **absent on `main`** (`git log --all` confirms it never was committed) — it is a conceptually-cited-but-never-written design doc. The "Future/deferred within-run convergence / hard iteration cap to guarantee termination" framing it was named to de-stale lives in **no committed file**: a grep for `hard iteration cap` / `guarantee termination` / `Future: within-run` finds only the *already-corrected* framing in `docs/specs/2026-06-28-faff-87-within-run-convergence-loop-design.md` (which already demotes the iteration cap to "a runaway backstop only"). The doc-de-stale item is therefore reframed to a verified **satisfied-by-absence** check (grep confirms nothing stale to strike) and dropped from the active edit set. This is a scope *reduction*, not an approach change — the flip's real edit set (config + beep-boop prose) is unchanged.

An nlspec design-decision spec for **FAFF-534 — "Should within-run convergence (`--converge`) default ON, and does it even need to be a config knob for autonomous runs?"** The artifact this spec settles is *the decision plus its precise edit set*, not a greenfield feature. Audience: the build agent who will apply the prose/config edits, and the human reviewer weighing the settled scope.

## 1. WHY — Problem and Principles

**The load-bearing model.** Within-run convergence is a *loop*, and it is separable from its *terminator*. The terminator (`faff run-done`) decides when a run is allowed to stop; the loop (beep-boop step-8.0 discovered-scope fold + the `convergence.max_waves` non-convergence backstop) decides whether discovered scope is drained *this* run or filed for the next. At L4 today the **terminator already runs unconditionally** (it is one of the 8 lights-out guardrails), but the **loop is still gated on `--converge`/`convergence.enabled: true`**. This spec is about the loop's default and whether the gate should exist at all for autonomous runs — not about the terminator, which already ships forced-on.

**Problem statement.** `convergence.enabled` ships `false` because a safe within-run loop needed a guaranteed terminator, which did not exist when FAFF-87 shipped; that terminator (run-start predicate FAFF-496, run-done dryness composition FAFF-38, `max_waves` backstop, mandatory L4 budget ceiling) has since shipped, so the original reason for the OFF default is spent. This spec settles the new default and, more sharply, whether the loop should be *optional at all* for autonomous (L3-beep-boop / L4-lights-out) runs. The answer determines what a stranger's fresh `.faffrc.example.yaml` install gets and what an L4 run is permitted to do.

**Design principle — the checkpoint only has value when there is a human to hand residue to.** "File discovered scope, defer to the next run" is a *handoff*. It presupposes a human who will triage the residue each morning. At L4 (lights-out, no human each morning) there is no recipient, so file-and-defer is not a checkpoint — it is just latency: work that could close tonight instead waits for a run nobody schedules. Any implementation that preserves an operator-facing "don't converge" dial *at L4* would be preserving a checkpoint with no checkpointer, and must be rejected.

**Design principle — eligibility, not a converge knob, is what actually bounds an opt-in run.** Under `automation_default: opt-in`, mid-run discovered scope cannot carry `faff-automate` (FAFF-218), so it surfaces On-hold and cannot re-enter the build queue without a human crank-up. Convergence's drain effect is therefore *already muted* on conservative/naive installs regardless of the flag. This is the crux that de-risks flipping the shipped default: the fresh install one worries about is exactly the install where eligibility, not the converge default, governs blast radius. **Because this mute is load-bearing, the default-flip is gated on the shipped example continuing to ship `automation_default: opt-in` — a hard pre-flip condition (Decision B / DONE), not a soft assumption.**

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `.faffrc.example.yaml` L192–201 | Config schema prose | Canonical shipped default; the ONLY source of truth for `enabled`'s default (no code registry) |
| `.faffrc.example.yaml` L174 (`automation_default: opt-in`) | Config schema prose | The eligibility mute Decision B rests on; verified `opt-in` today — the pre-flip gate asserts it stays so |
| `plugin/skills/faff-beep-boop/SKILL.md` L45, L112, L225–230 | Skill prose | Defines `--converge`, the "off by default" framing, and the L4-vs-`--converge` wave-boundary branch — the loop's real logic lives here, not in code |
| `plugin/skills/faff/bin/lib/lights-out.js` (force `appetite: full`; refuse count-cap-only budget) | Code | The L4 dial-forcing + budget-preflight patterns; the runaway envelope is code-enforced, and the `appetite: full` forcing is the template FAFF-624's convergence-forcing rule follows |
| `docs/specs/2026-06-28-faff-87-within-run-convergence-loop-design.md` | Committed design spec | The within-run loop's live design record — already frames the iteration cap as "a runaway backstop only" (nothing stale to de-stale) |
| `.faffrc.yaml` (this repo's live config) | This repo's live config | Dogfoods `enabled: true` but flagged temporary ("FABLE-WEEK" revert posture) — the mature-operator posture, NOT the stranger default the ticket asks about |
| FAFF-624 | Follow-up ticket | The code guardrail that hard-forces convergence at L4 (Decision D); `blockedBy` this ticket; ships after the posture flip |

**Note on `design/planning-loop.md`.** The originally-mapped edit site `design/planning-loop.md` does **not** exist on `main` and never did (see the Refresh correction above). It is removed from the live edit set; the doc-de-stale DONE item becomes a verified satisfied-by-absence check.

**Scope statement.** This sits at the beep-boop / lights-out default-posture layer: it changes what autonomous runs do with discovered scope by construction, and is the *mechanism* layer beneath FAFF-535's ordering.

## 2. OUT OF SCOPE

- **FAFF-535 (PRD-greedy sibling-drain ordering).** Excluded — convergence is the *mechanism* that drains sibling work in-run; 535 is the *ordering* the loop drains in. **Extension point:** FAFF-535 builds on the step-8.0 fold this spec makes non-optional at L4; cross-referenced, never merged. (534 now blocks 535 so the ordering ticket can't go ready against an un-flipped default.)
- **The L4 hard-enforcement code guardrail (FAFF-624).** Excluded by the Decision D resolution — the `lights-out.js` convergence-forcing rule (force at preflight the way `appetite: full` is forced, or a new guardrail-set entry) ships as **FAFF-624** (`blockedBy` this ticket). This ticket delivers the prose/config posture only; FAFF-624 delivers the machine guarantee behind "non-optional at L4." **Extension point:** `lights-out.js` dial-forcing + the guardrail set.
- **The FAFF-218 opt-in eligibility model.** Excluded — whether mid-run discovered scope *should* be able to carry `faff-automate` is a separate policy question; this spec only *relies on* today's muting behaviour, it does not change it. **Extension point:** `faff eligible` / `faff-automate` labelling in the eligibility subsystem.
- **`convergence.max_waves` value / semantics.** Excluded — the backstop count (default 6) and its `non-convergence` escalate rung are unchanged; only the `enabled` default and the loop's L4 gate move. **Extension point:** the `max_waves` restatements in beep-boop SKILL.md stay as-is.
- **This repo's own `.faffrc.yaml`.** Excluded — it already sets `enabled: true` under a temporary FABLE-WEEK posture; the ticket asks about the *shipped example* default, not the dogfood file. **Extension point:** the FABLE-WEEK revert block is owned by the budget-posture cleanup, not here.

## 3. WHAT — the settled decision and its change surface

**Vocabulary.**

| Term | Definition |
|---|---|
| The loop | beep-boop step-8.0 discovered-scope fold + `max_waves` non-convergence backstop (drains discovered scope *this* run) |
| The terminator | `faff run-done` — decides run-complete / continue / escalate; already forced-on at L4 as a guardrail |
| File-and-defer | The default non-loop path (step 10): file discovered scope for the *next* run |
| The knob | `convergence.enabled` config field + the `--converge` CLI-shaped flag (both beep-boop-prose-only; no JS reads them) |

**The chosen posture (option c — see §6 Decision A).** Convergence becomes:

- **L4 (lights-out): non-optional.** The loop runs regardless of the flag/knob. The knob cannot disable it; a config `enabled: false` under an L4 mint is inert (the loop still runs). This is the *same intent* as L4 forcing `appetite: full`, but note the enforcement asymmetry (below): `appetite: full` is forced by prose **and** a `lights-out.js` guardrail, whereas convergence-L4-non-optional is delivered by **beep-boop prose alone** until the **FAFF-624** code guardrail ships (Decision D → follow-up). The runaway envelope is code-enforced regardless (terminator + budget), so the prose-only gap is a *conformance* gap, not a *safety* gap.
- **L3 `/faff-beep-boop`: default-on.** The loop runs unless the operator explicitly opts a *single* run out.
- **The knob survives only for the narrow L3 opt-out** — "I deliberately want a per-layer human checkpoint on this L3 run."

**Config surface (the settled edit set).**

```
FILE .faffrc.example.yaml  (L192–201) — canonical shipped default
  - L192 comment: "Off by default (L4 discipline)"  ->  reframed:
      convergence runs by default (drains discovered scope in-run); at L4 it is
      non-optional (knob/flag cannot disable it); the knob only opts an L3 run OUT
      of the per-layer human checkpoint.
  - L200:  enabled: false   # ...   ->   enabled: true    # true (default) | false (L3 opt-out only; inert at L4)
  - L201:  max_waves: 6      # UNCHANGED (runaway backstop only)
  - PRE-FLIP GATE: confirm L174 still reads `automation_default: opt-in` before applying
    the flip (Decision B / DONE) — if the example ships `opt-out`, block the flip and escalate.
```

**Flag / opt-out-door surface.** Today only an opt-IN `--converge` exists (beep-boop SKILL.md L45 announce, L112 authoritative def). With the default ON, an explicit OFF door is required for the L3 opt-out. **Chosen (see §6 Decision C):** *both* doors — config `enabled: false` (already works as config once the default flips) **and** a new symmetric `--no-converge` flag (new beep-boop prose), for parity with the existing `--converge`. Precedence, stated forward: **flag overrides config; at L4 both are inert (loop forced on).**

```
BEEP-BOOP SKILL.md prose edits:
  - L45  (announce line): add --no-converge alongside --converge
  - L112 ("L4 discipline, off by default"): reframe to "on by default; --no-converge
          (or convergence.enabled: false) opts an L3 run out; both inert at L4"
  - L225-230 (wave-boundary branch): the loop's L4 gate moves — see HOW §4
```

**Doc surface (satisfied by absence).** The originally-mapped `design/planning-loop.md` de-stale target does **not** exist on `main` (verified — see the Refresh correction). There is no committed file that describes the within-run loop as "Future/deferred" with the spent "hard iteration cap to guarantee termination" rationale (grep-confirmed; the one live design record, `docs/specs/2026-06-28-faff-87-…`, already frames the cap as a runaway backstop). So the doc-de-stale reduces to a **verified satisfied-by-absence check** — no active file edit. If a `design/planning-loop.md` is ever committed carrying the stale framing, de-staling it moves back into scope; today there is nothing to strike.

**Code surface (resolved — Decision D → follow-up FAFF-624).** `lights-out.js` does NOT read `convergence.enabled` and convergence is NOT among its enforced guardrails. Making L4 non-optional *in behaviour* is achieved by the beep-boop prose edit alone (an L4 agent following the skill folds discovered scope regardless of the flag). A *hard* code guarantee — a preflight rule that forces convergence at L4 the way `lights-out.js` forces `appetite: full` — is defence-in-depth against a non-conforming occupant, and **ships as FAFF-624** (`blockedBy` this ticket, sequenced immediately behind the flip to keep the unenforced window short). Because the runaway envelope is already code-enforced, the deferral defers only the *"does the loop run at all"* guarantee, never a safety bound.

## 4. HOW — Behavior

**The one behavioural change: the loop's L4 gate moves.** Everything else is prose/config reframing. Today (beep-boop SKILL.md L227–228) the run-done consult runs at L4 regardless, but the *loop* (8.0 fold + backstop) still requires `--converge`. After this change the loop runs at L4 unconditionally.

```
PROCEDURE wave_boundary_stop(run):        # beep-boop step 8, revised
  1. IF run.level == L4 (lights-out-minted):
     a. Consult `faff run-done` at run-end          # UNCHANGED — already forced-on
     b. Run the step-8.0 discovered-scope fold        # CHANGED: was --converge-gated
     c. Apply the non-convergence backstop (max_waves)# CHANGED: was --converge-gated
     d. --no-converge / enabled:false -> IGNORED (inert at L4)
  2. IF run.level == L3 AND NOT opted_out:            # default-on
     a. Consult `faff run-done`
     b. Run the 8.0 fold + non-convergence backstop
  3. IF run.level == L3 AND opted_out(--no-converge OR enabled:false):
     a. Plain wave loop: terminate by queue-emptiness, no run-done loop consult
        (the long-standing pre-convergence L3 default — preserved for this one case)

  where opted_out = (--no-converge present) OR (config enabled:false AND no --converge flag)
        # flag overrides config; --converge and --no-converge are mutually exclusive (refuse both)
```

**Behaviour summary.** After this change, an L4 run drains discovered scope in-run by construction ("describe an app -> wake up to it built"); a default L3 beep-boop run does the same unless the operator asks for a checkpoint; and the only way to get the old file-and-defer behaviour is an explicit L3 opt-out.

**Edge cases.**
- **Both `--converge` and `--no-converge` passed:** terminal usage error — refuse the run at announce, do not silently pick one. (Prose-enforced — see the QA note in DONE.)
- **`enabled: false` in config + `--converge` on the CLI (L3):** flag wins -> loop runs (existing override precedence, now symmetric).
- **`enabled: false` in config at L4:** inert -> loop runs (L4 forces it).
- **`automation_default: opt-in` install, default now ON:** loop runs but discovered scope is On-hold (not `faff-automate`-eligible) -> effectively muted; the run still terminates by dryness/queue-empty. This is the intended low-blast-radius path for naive installs.

**Failure modes.**

- **The failure:** the muting-by-eligibility argument is the whole basis for calling the default-flip low-risk on fresh installs. If a fresh install actually ships `automation_default: opt-out` (or the operator cranks broadly), the mute doesn't hold and the flip *does* widen the autonomous-merge blast radius — count-unbounded within a run (`max_waves` is a no-progress backstop, not a total-work cap), though still `$`-bounded by the code-enforced ceiling and eligibility-gated. **How you'd know:** a fresh-install run with no explicit crank-up merges discovered-scope work the operator didn't individually sanction. **What it means:** this is why the `automation_default: opt-in` check is a **hard pre-flip gate** (DONE), not a soft assumption — the flip is blocked and escalated if the example ships `opt-out`.
- **The failure:** "the terminator guarantees halting, so the loop is safe unconditionally at L4" assumes run-done + `max_waves` + a mandatory L4 budget ceiling all actually bind. If an L4 run could mint without a spend/time ceiling, `max_waves` alone (a count) is a weak governor. **How you'd know:** an L4 run escalates on `non-convergence` (the count backstop) rather than terminating on genuine dryness or budget — i.e. the count is doing the stopping. **What it means:** proceed — this is already code-enforced (`lights-out.js` refuses a count-cap-only budget at preflight; a spend/time ceiling is mandatory), but the observable is worth watching as the tell that the safety floor regressed.
- **The failure:** shipping only the prose "L4 non-optional" without the code guardrail (FAFF-624, sequenced behind this ticket) means a *non-conforming* occupant that ignores the skill prose could still skip the loop at L4. **How you'd know:** an L4 run's ledger shows file-and-defer discovered scope with no 8.0 fold. **What it means:** proceed with the follow-up named and linked — the prose binds a conforming agent; FAFF-624 is the belt to the prose's braces. Crucially the *safety* envelope (terminator + budget) is code-enforced regardless, so this gap is a conformance gap (loop might not run), never a runaway-safety gap — a known, logged, tracked limitation, not a silent one.

**Anti-pattern:** adding a code path in `lights-out.js` that *reads* `convergence.enabled` to decide L4 behaviour. Why: at L4 the value is inert by design — reading it invites the bug where a stray `enabled: false` disables the L4 loop. The guardrail (FAFF-624) forces, it does not consult.

**Anti-pattern:** deleting the knob entirely (option d). Why: it destroys the one legitimate case — an L3 operator who genuinely wants a per-layer checkpoint — and there is no cost to keeping an inert-at-L4 knob.

## 5. Scenarios — born-verifiable main objectives

```
Given a stranger's fresh install using .faffrc.example.yaml as shipped
When they read the convergence block
Then enabled reads `true`, the comment frames it as on-by-default / L4-non-optional /
     L3-opt-out-only, and no line still says "Off by default (L4 discipline)"
```

```
Given the pre-flip gate on the shipped example
When the flip is applied
Then .faffrc.example.yaml still reads `automation_default: opt-in` (grep-checked); if it
     reads `opt-out`, the flip is blocked and escalated rather than applied
```

```
Given a lights-out-minted (L4) run with convergence.enabled:false in config and no --converge
When a build wave discovers in-scope work
Then the step-8.0 fold and non-convergence backstop run anyway (the loop is forced on),
     and the run terminates by run-done dryness/budget, not by file-and-defer
```

```
Given an L4 run launched with an explicit --no-converge flag
When the wave boundary is reached
Then --no-converge is ignored (inert at L4) and the discovered-scope fold still runs
```

```
Given a plain L3 /faff-beep-boop run launched with --no-converge
When a wave's build queue empties
Then the run exits by queue-emptiness with no run-done loop consult and discovered
     scope is filed for the next run (the preserved pre-convergence L3 behaviour)
```

```
Given a run launched with both --converge and --no-converge
When the run is announced
Then it is refused as a usage error rather than silently resolving to one
     (prose/agent-conformance, not a JS-unit-testable CLI contract — see DONE)
```

- The within-run-convergence framing MUST NOT survive anywhere as "Future"/"deferred" citing the "hard iteration cap needed to guarantee termination" as a *live* rationale. This is satisfied **by absence** on current `main` (no committed file carries that stale framing — grep-verified); the check is that no such file is (re)introduced by this change.

## 6. DESIGN DECISION RATIONALE

**Decision A — What posture should within-run convergence take now the terminators have shipped?**

| Option | Pro | Con |
|---|---|---|
| (a) Status quo: knob, default OFF | Zero change; maximally conservative | The OFF rationale (no terminator) is spent; L4 pays latency for a checkpoint no human reads |
| (b) Default-ON only when a budget ceiling is set | Ties the flip to an explicit safety signal | At L4 a spend/time ceiling is *already mandatory*, so this is a no-op at L4 and a confusing conditional at L3; the ceiling governs runaway, not whether draining scope is *desirable* |
| (c) **Always-on L4; default-on L3 beep-boop; knob only for explicit L3 opt-out** | Matches "no human to hand residue to" at L4; keeps the one legitimate L3 checkpoint; same intent as the existing `appetite: full` level-forcing | Requires the L4 gate-move edit + a new `--no-converge` door; flips a shipped default |
| (d) Remove the knob entirely for autonomous runs | Simplest mental model | Destroys the legitimate L3-with-a-human checkpoint for no benefit; an inert-at-L4 knob costs nothing to keep |

**Chosen:** (c) — always-on at L4, default-on at L3 beep-boop, knob retained only for an explicit L3 opt-out. Rationale: the deferral's safety objection is discharged (run-done + `max_waves` + mandatory L4 budget = guaranteed halting); the per-layer checkpoint has value *only* at L3-with-a-human, so it must not survive as an L4 dial; (b) is a no-op at L4 and confusing at L3; (d) throws away the one real L3 use for no gain. (c) is the operator's explicit lean and the mapped change surface supports it. `(decides: product)`

**Decision B — Is flipping the shipped example default from `false` to `true` safe for fresh/naive installs?**

- Concern: flipping a shipped default changes the autonomous-merge blast radius for every stranger's first run.
- Countervailing fact: under `automation_default: opt-in` (the conservative posture a naive install should ship, and the value the example ships today — `.faffrc.example.yaml:174`), mid-run discovered scope can't carry `faff-automate` (FAFF-218), so it surfaces On-hold and can't re-enter the build queue — convergence's drain is muted regardless. The install one worries about is exactly the install where eligibility, not this default, bounds the run.

**Chosen:** flip the example default to `enabled: true`, **gated on a hard pre-flip check that the shipped example still reads `automation_default: opt-in`** (block + escalate if not). The eligibility mute means the flip is inert precisely where naivety lives; it only bites once an operator has moved to `opt-out` or cranked broadly, by which point they are not naive. Promoting the opt-in check from a soft assumption to a blocking gate closes the blast-radius concern rather than resting the safety of a default-toward-more-autonomy flip on an unenforced precondition. `(decides: product)`

**Decision C — With the default ON, what is the explicit OFF door for the L3 opt-out?**

- Options: config-only (`enabled: false`); new `--no-converge` flag only; both.
- Config-only works today once the default flips, but leaves the CLI asymmetric (an opt-in `--converge` with no opt-out sibling). A `--no-converge`-only door can't express a persistent per-repo checkpoint posture.

**Chosen:** both — config `enabled: false` for a persistent L3 posture, plus a new symmetric `--no-converge` flag for a one-run opt-out, with `--converge`/`--no-converge` mutually exclusive and the flag overriding config. Both inert at L4. Symmetry with the existing flag is the least-surprise door. Note the flag + its mutual-exclusion refusal are **skill prose** (no JS parses `--converge`), so their conformance is agent-upheld, not unit-testable (reflected in DONE). `(decides: any)`

**Decision D — Does the L4 hard-enforcement code (a `lights-out.js` convergence-forcing guardrail) ship in THIS ticket, or a follow-up?**

- The behaviour "L4 non-optional" is delivered by the beep-boop prose edit alone for any conforming agent. A code guardrail — forcing convergence at preflight the way `lights-out.js` forces `appetite: full`, or adding an entry to the lights-out guardrail set — is defence-in-depth against a non-conforming occupant, and is real code with test surface (the `appetite: full` forcing + dial-coherence pass is the template). Note the asymmetry: the `appetite: full` precedent is enforced by *both* prose and code, so until the guardrail ships, convergence-L4 is a *weaker* guarantee than its template — a conformance guarantee, not a code one (the safety envelope is code-enforced independently).
- Bundling it makes the L4 guarantee hard now but widens this ticket from a prose/config change into a code+test change; splitting it ships the default-posture decision cleanly and tracks the hardening separately.

**Chosen:** ship the prose/config posture (Decisions A–C) in this ticket; the `lights-out.js` L4 convergence-forcing guardrail ships as the named follow-up **FAFF-624** (`blockedBy` this ticket), sequenced immediately behind the flip to keep the unenforced window short. This is a genuine scope decision (prose-behaviour-now vs code-guarantee-now), resolved by the human Decision (2026-07-23, via /faff-tidy) toward a follow-up so the default-posture decision isn't held hostage to code+test work; either resolution is coherent and this one ships the decision cleanly. `(decides: architecture)`

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The one former Punt (Decision D — guardrail here vs follow-up) is resolved: **Chosen: follow-up FAFF-624** (human Decision, 2026-07-23, via /faff-tidy; folded by autonomous-refresh 2026-07-23). FAFF-624 is filed, `blockedBy` this ticket.

**Assumptions.**
- **Assumes:** at L4 a spend/time budget ceiling remains a mandatory launch precondition (count-cap-only refused at preflight). The unconditional-L4-loop safety rests on it. **Validate:** confirm the L4 budget guardrail still refuses a `max_attempts`-only envelope (`lights-out.js`) before relying on `max_waves` as merely a *reported* backstop. (Verified present at this refresh.)

## 8. DONE — Definition of Done

Items are tagged **[mech]** (mechanically verifiable — grep/string/config assertion) or **[conf]** (prose / agent-conformance — binds a conforming agent, not JS-unit-testable).

### From WHY
- [ ] **[mech]** The spec's OFF-default rationale is retired: no shipped prose still cites "needs a terminator" or "hard iteration cap to guarantee termination" as a live reason for OFF.

### From WHAT (config + flag surface)
- [ ] **[mech]** PRE-FLIP GATE: `.faffrc.example.yaml:174` still reads `automation_default: opt-in` (grep). If it reads `opt-out`, the flip is **blocked and escalated**, not applied.
- [ ] **[mech]** `.faffrc.example.yaml` L200 reads `enabled: true` (default), with the L192/L200 comments reframed to on-by-default / L4-non-optional / L3-opt-out-only; the string "Off by default (L4 discipline)" is gone.
- [ ] **[mech]** `.faffrc.example.yaml` L201 `max_waves` is unchanged.
- [ ] **[mech]** beep-boop SKILL.md L45 announces `--no-converge` alongside `--converge`.
- [ ] **[mech]** beep-boop SKILL.md L112 reframes "off by default / L4 discipline" to "on by default; `--no-converge` or `enabled:false` opts an L3 run out; both inert at L4."
- [ ] **[conf]** A `--no-converge` flag is defined in beep-boop prose; `--converge` + `--no-converge` together is a refused usage error; flag overrides config. (Prose contract — no JS parses the flag, so this binds a conforming agent, it is not a unit test.)

### From HOW (behaviour)
- [ ] **[conf]** beep-boop SKILL.md L225–230 wave-boundary branch: the step-8.0 fold + non-convergence backstop run at L4 regardless of the flag/knob (the loop's L4 gate is removed).
- [ ] **[conf]** At L4, `enabled:false` / `--no-converge` are inert (loop still runs).
- [ ] **[conf]** A default L3 beep-boop run runs the loop unless explicitly opted out.
- [ ] **[conf]** An opted-out L3 run exits by queue-emptiness with no run-done loop consult (pre-convergence behaviour preserved).

### From HOW (docs — satisfied by absence)
- [ ] **[mech]** No committed file describes within-run convergence as "Future"/"deferred" citing the "hard iteration cap to guarantee termination" as a live rationale (grep for `hard iteration cap` / `guarantee termination` / `Future: within-run` returns only the already-corrected framing in `docs/specs/2026-06-28-faff-87-…`). `design/planning-loop.md` does not exist and is not created by this change. (The originally-mapped de-stale edit is void — nothing stale to strike.)

### From DESIGN DECISION RATIONALE
- [ ] **[mech]** The Decision D scope call is resolved by a human toward a follow-up, and the follow-up exists and is linked: **FAFF-624** is filed and `blockedBy` FAFF-534. This ticket ships prose/config only.
- [ ] **[mech]** The L4 mandatory spend/time ceiling assumption is re-checked (`lights-out.js` refuses count-cap-only) before relying on `max_waves` as a mere backstop.

**Integration smoke test.**
```
1. [mech] Read .faffrc.example.yaml convergence block -> enabled: true, reframed comments, no "Off by default".
2. [mech] grep .faffrc.example.yaml automation_default -> opt-in (the pre-flip gate).
3. [conf] Dry-read beep-boop SKILL.md L225-230 -> L4 branch folds discovered scope with no --converge dependency.
4. [mech] grep repo for "hard iteration cap"/"Future: within-run"/"guarantee termination" -> only the already-corrected
   faff-87 design spec; no stale "Future/deferred" framing (satisfied by absence).
5. [mech] FAFF-624 exists and is blockedBy FAFF-534.
   If all hold -> the decision and its edit set are connected.
```

## Methodology critique

_Lens: faffter-dark-methodology-agile-delivery (agile-delivery). Non-blocking — surfaces for human review; does not gate promotion._

**Right-sized? (Principle 4) — resolved.** With Decision D settled to a follow-up (FAFF-624), this ticket is a single always-ship-together prose/config unit: the `.faffrc.example.yaml` flip + the beep-boop `SKILL.md` prose (`--no-converge` door + wave-boundary reframe). The code guardrail is correctly out (FAFF-624). The originally-listed `design/planning-loop.md` de-stale turned out to be void (the file doesn't exist), which shrinks the unit further — still one cohesive change. No split indicated.

**Workstream fit? (Principles 1+5) — cohesive.** The change surface converges on one outcome (convergence as the autonomous default) with no riders. The earlier soft naming note ("Lights-out operations" reads closer to a capability area than a shippable outcome) stands as a mild lean only, not a blocker for this ticket.

**Deps surfaced? (Principle 6) — now done.** The edges the prior critique asked for are recorded: (a) the `lights-out.js` guardrail is filed as a real ticket (FAFF-624) and linked `blockedBy` this ticket; (b) `534 blocks 535` so 535 isn't pulled ready against an un-flipped default; (c) the 496/498 → 534 blockedBy links record the "terminators have shipped" premise as auditable (both Done).

**Risk profile? (Principle 7) — mitigations in place.** This flips a shipped default that widens autonomous-merge blast radius, with the L4 "non-optional" guarantee shipping as prose while its code enforcement is the FAFF-624 follow-up (a documented, tracked, sequenced-immediately-behind window). Mitigations: (1) the pre-flip `automation_default: opt-in` gate (hard, Decision B) is the primary bound — keep it blocking; (2) FAFF-624 is sequenced immediately behind this ticket to keep the enforcement window short; (3) the assumption checks (L4 budget ceiling mandatory) are a small de-risking checkpoint preceding the flip.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
