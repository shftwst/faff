# nlspec: FAFF-225 — L4 lights-out entry point / runner (runner v1)

> Spec: faffter-dark-nlspec · 2026-06-29 · interactive · confidence: high. Full spec on Linear FAFF-225.

This is the formal nlspec for **FAFF-225**, the integration spine of L4 v1: the faff-side launcher that runs `/faff-beep-boop` unattended with the L4 guardrails composed and enforced. The audience is the build agent that will implement the runner, and the human reviewer.

> **Narrowed 2026-06-29 (scoped re-prep — runner-v1 slice).** FAFF-225 was **re-sliced by /faff-plot** to the thin runner-v1 scope; two concerns the prior full-epic spec bundled are now **separate follow-on tickets, out of scope here**: the **adversarial advisory→merge-gating promotion** (`critical`→`needs-human` on the lights-out path) is **FAFF-297**, and the **rich dial-coherence preflight** (reject reckless level+appetite+slots+gates combos, ties FAFF-18) is **FAFF-298** — both blocked by this slice. Runner-v1 consumes the review verdict / merge gate **as-is** (graft Step 10 unchanged) and does **basic** preflight only. The previously-central safety **Punt** (degrade-gracefully vs require the live kill-switch) was already **resolved by reality → `Chosen`**: both keystones — **FAFF-49** (Sentry live kill-switch, PR #214) and **FAFF-34** (code-blind holdout evaluator, PR #209, rolled into the coverage gate by FAFF-277/FAFF-257) — have **shipped**, so the runner wires them as **live guardrails**. The last open Punt — the **command surface** — is now **`Chosen`** (a distinct `faff` subcommand, ADR-0014). **Zero open Punts → confidence: high.**

## 1. WHY — Problem and Principles

**The load-bearing model.** The runner is *composition, not mechanism*. Every L4 guardrail is built as its own ticket exposing a deterministic CLI contract; the runner's whole job is to (a) mint an L4 run with strict defaults, (b) call each guardrail's contract at the right boundary, (c) refuse to start if a basic precondition is unsafe, and (d) print a banner naming exactly which guardrails are live this run. It introduces almost no new behaviour of its own — its value is that "leave the building" becomes one enforced action instead of a hand-assembly of flags a human can get wrong.

**Problem statement.** The gateway levels table names L4's entry point `lights-out (frontier)` but there is no command or mode for it, so an unattended run today is a manual assembly of `/faff-beep-boop` flags with no enforced floor. A single missing precondition (no budget ceiling, bare host, review slot unreachable) silently degrades the run. The runner makes the L4 discipline a single composed, self-checking entry point that refuses to start unless the guardrails it names are actually live.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **Fail-closed at the boundary, never fail-open mid-run.** Every preflight check defaults to *refuse to go lights-out* on ambiguity, absence, or error. A guardrail that is configured-but-unreachable is treated as absent. Mirrors `faff admissible`'s fail-safe-inadmissible and ADR-0020.
- **The banner is the contract with the human.** The run banner is the auditable statement of which guardrails are live. A human reading the morning surface must be able to tell a fully-armed L4 run from a degraded one without re-deriving config.
- **The runner composes contracts; it does not re-implement them.** The runner calls `faff admissible`, `faff budget check`, `faff run-done`, `faff events`, `faff container-check`, `faff sentry check`, `faff holdout verdicts`/`faff prdr coverage`, the spec-review verdict, and the review slot. It owns no copy of their logic (resolve slots/contracts at dispatch — never hardcode).
- **faff owns the discipline, not the cage.** `--dangerously-skip-permissions` and host isolation are the container's job (ADR-0010), never faff's. The runner *detects and refuses*; it never weakens the host.

**Reference context.**

| System | Surface | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | CLI | Hosts `admissible`, `budget check`, `contain`, `events`, `run-done`, `container-check`, **`sentry`**, **`holdout`**, `prdr coverage`; the runner's command surface lands here as a new subcommand (ADR-0014: the subcommand registry is the SSOT). |
| `plugin/skills/faff-beep-boop/SKILL.md` | orchestration | The unattended pipeline the runner launches; the runner wraps it. |
| `plugin/skills/faff-graft/SKILL.md` | build | Step 9 review / Step 10 merge gate; **unchanged** — the runner consumes the gate's verdict + the holdout verdict as-is (the `critical`→`needs-human` escalation is **FAFF-297**, out of scope). |
| **FAFF-49 (Done, PR #214)** | **live guardrail** | **Sentry — `faff sentry check\|abort`. The live kill-switch. SHIPPED.** |
| **FAFF-34 (Done, PR #209)** | **live guardrail** | **Code-blind holdout verdict — `faff holdout verdicts`, rolled into `faff prdr coverage --dod-verdicts` (FAFF-277, Done). SHIPPED.** |
| ADR-0010 | decision | Blast-radius: run inside claude-box, external to faff → container preflight. |
| ADR-0014 | decision | The subcommand registry is the SSOT for the CLI command set → the lights-out command surface registers here. |
| ADR-0029 | decision | Machine-DoD verification is GO-narrow: FAFF-34 trusted unattended for born-verifiable scenario/assertion DoD classes, `needs-human` on prose. |

**Scope statement.** This is the top integration node of the project "Down the pub — trustworthy lights-out v1 (L4)"; it sits above the guardrail blockers (now all Done) and below the operator who types one command to leave the building. Two refinements — adversarial merge-gating (FAFF-297) and rich dial-coherence (FAFF-298) — are split out as follow-ons blocked by this slice.

## 2. OUT OF SCOPE

- **The guardrail mechanisms themselves** — admissibility, terminating condition, budget, observability schema, spec-stage review, the kill-switch, the holdout evaluator. *Why excluded:* each is its own ticket; the runner only consumes their contracts. *Extension point:* the blocker tickets (FAFF-224/38/36/35/9/49/34).
- **Adversarial advisory→merge-gating promotion** (`critical`→`needs-human` on the lights-out path) — runner-v1 consumes the review verdict / merge gate **as-is**; it adds **no** escalation. *Why excluded:* a self-contained change over the shipped review slot with its own contract + test surface. *Extension point:* **FAFF-297** (blocked by this slice).
- **Rich dial-coherence preflight** (reject reckless level+appetite+slots+gates combinations; ties FAFF-18) — runner-v1 does **basic** preflight only (container, budget ceiling, slot reachability). *Why excluded:* independently testable, beyond v1's basic gate. *Extension point:* **FAFF-298** (blocked by this slice).
- **Lights-out CI / ephemeral environments / deploy** — post-v1. *Extension point:* FAFF-12.
- **PRD/PRDR frozen-contract + halt-don't-amend** — post-v1. *Extension point:* FAFF-199.
- **Self-learning / calibration loop** — post-v1. *Extension point:* FAFF-13.
- **Real side-effect rollback/recovery** — post-v1; the v1 floor *prevents* out-of-envelope effects rather than rolling them back. *Extension point:* FAFF-37.
- **Within-run convergence (drain discovered scope same-run)** — post-v1. *Extension point:* FAFF-87.
- **Authoring the FAFF-18 level-recipe schema** — the runner is a subcommand, not a recipe. *Extension point:* FAFF-18.
- **Changing faff-graft's Step 10 merge gate** — the gate is byte-for-byte unchanged; the runner consumes its verdict + the holdout verdict. *Extension point:* FAFF-297 (the signal-upgrade follow-on).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Lights-out run | An unattended `/faff-beep-boop` run launched through this runner with the L4 guardrails composed + enforced. |
| Run banner | The human-facing line(s) the runner emits at launch and persists in the L4 run-ledger, naming each guardrail and its live/degraded/absent state. |
| L4 run-ledger | The strict-defaults run record the runner mints (extends today's `.faff/runs` ledger), carrying the armed-guardrail set. |
| Guardrail contract | The deterministic CLI interface a blocker exposes to the runner (e.g. `faff admissible … → AdmissibilityVerdict`). |
| Basic preflight | The launch-time refuse-to-start gate over v1's preconditions: container confirmed, budget ceiling set, spec_review + review slots configured + reachable, keystone guardrails reachable. (Rich coherence — appetite/level/slots/gates combinations — is FAFF-298.) |

**Guardrail contracts the runner consumes (the full L4 set — all SHIPPED + verified live in `plugin/skills/faff/bin/faff` on 2026-06-29):**

```
INTERFACE GuardrailContracts:
  admissibility:   faff admissible --spec <path|-> [--lights-out] [--json]
                   → AdmissibilityVerdict { admissible, reasons, checks, warnings }
                   exit 0 admissible · 1 inadmissible · 2 usage
                   # fail-safe inadmissible on ambiguous/absent DoD

  terminating:     faff run-done [...] --policy <JSON>
                   → RunDoneVerdict { run-complete | continue | escalate }
                   # PURE; FIXED floor: budget-escalate→escalate · unclean ledger→continue · prd_satisfied==false→escalate

  budget:          faff budget check [--run-dir DIR] [--until HH:MM] [--max N] [--json]
                   → BudgetState { spent, breached, outcome }, at_ceiling ∈ {stop|narrow|escalate}

  observability:   faff events <append|validate|read> --run <id>
                   → events.jsonl timeline (in-flight + morning surface substrate)

  spec_review:     faff contract spec-review-verdict  +  faff spec-review-lenses  +  the spec_review slot
                   → { approve | revise | reject-approach | needs-human }  (gates spec admission before code)

  container:       faff container-check
                   exit 0 contained · 1 not_confirmed   # currently WARNS at autonomous entry; runner promotes to BLOCK

  containment:     faff contain <mandate> (--parent <id> | --root) --ancestry <json>
                   exit 0 contained · 3 outward (fail-closed) · 2 usage   # scope-containment, FAFF-219

  kill_switch (FAFF-49, SHIPPED):  faff sentry check [--json]
                   → DerailmentVerdict { run_dir, verdicts[], intervention ∈ {continue|pause|abort}, tripped, thresholds }
                   faff sentry abort  → commits WIP to branch, marks ledger aborted-resumable
                   exit 0
                   # signals: budget-breach · heartbeat-stale · run-elapsed-ceiling · build-thrash ·
                   #          repeated-identical-failure · scope-drift(advisory) · forbidden-side-effect.
                   # Intervention ladder continue<pause<abort; reads FAFF_RUN_DIR ledger+heartbeat without mutating;
                   # stop enforced at orchestrator dispatch boundary (un-subvertable on the terminal-token isolation model).

  holdout (FAFF-34, SHIPPED):  faff holdout verdicts --association <json> [--dir .faff/holdout]
                   → per-criterion code-blind DoD verdicts { met | unmet | needs-human }
                   wired into:  faff prdr coverage --dod-verdicts  → prd-satisfied roll-up (FAFF-277, Done)
                   # code-blind by construction; prose criteria forced to needs-human (ADR-0029 GO-narrow).
```

> **Keystones resolved (was the central Punt).** The 2026-06-28 spec carried FAFF-49 and FAFF-34 as **forward-interfaces** the runner was wired to but whose producers were unbuilt — and a load-bearing safety Punt over whether a v1 missing them could legitimately call itself "lights-out". **Both are now Done and reachable**, so this is **`**Chosen:**` require + wire the now-live keystones; a lights-out run is fully-armed — all 8 guardrails live — never a reduced/degraded mode.** The forward-interface presence-probe collapses to a normal reachability probe (`faff sentry --selftest` / `faff holdout verdicts` available): present ⇒ `armed: live`; the *degrade-gracefully* branch (reduced "supervised L3.5" mode) is **removed from v1** — there is no keystone-absent path to ship, because no keystone is absent.

**The L4 run-ledger (runner-minted, strict defaults):**

```
RECORD L4RunLedger EXTENDS .faff/runs ledger:
  run_id:          string                 # mints FAFF_RUN_DIR for Sentry + events
  level:           "L4"                   # immutable for the run
  armed:           Map<Guardrail, State>  # State ∈ { live | degraded | absent }
  banner:          string                 # rendered from `armed`; persisted, not just printed
  budget_ceiling:  BudgetEnvelope         # passed to `faff budget check`
  dial_profile:    { appetite, slots, gates }   # recorded for the banner (v1 does not adjudicate reckless combos — FAFF-298)
  container:       "contained" | "refused"       # from container-check preflight

  CONSTRAINT level == "L4"
  CONSTRAINT every Guardrail in `armed` resolves to a live CLI contract (all 8 shipped)
  CONSTRAINT banner is derivable 1:1 from `armed` (no guardrail silently omitted)
  CONSTRAINT a fully-armed L4 run shows all 8 guardrails `live`; any `degraded`/`absent` is a reachability fault, not a designed reduced mode
```

**Design decision (command surface).** `**Chosen:** a distinct `faff` subcommand (recommended `faff lights-out`) that mints the L4 run-ledger with strict defaults and renders/persists the banner; registered in the subcommand registry per ADR-0014 (the SSOT).` **Rejected:** a `/faff-beep-boop --lights-out` flag (re-introduces the manual-flag-assembly problem the runner exists to remove) and a FAFF-18 level-recipe preset (couples v1 to an unbuilt recipe schema). The exact verb is a minor naming detail the build may finalise; the *shape* — subcommand, not flag, not recipe — is fixed. See §6.

**Design decision (adversarial-gating placement).** Out of scope for runner-v1 — the `critical`→`needs-human` escalation on the lights-out path is **FAFF-297**. Runner-v1 consumes the review slot's hard signal and graft's Step 10 merge gate **unchanged**; it sets no escalation signal. See §6.

## 4. HOW — Behavior

**Architecture.** The runner is a thin launch-and-compose layer with two phases: a **basic preflight gate** (everything that can refuse to start) and a **wrapped run** (delegating to `/faff-beep-boop`, consulting guardrail contracts at boundaries, emitting the banner + events).

**Basic preflight gate — refuse-to-start, fail-closed.**

```
PROCEDURE preflight(config, env):
  1. Container preflight (ADR-0010):
     a. Run `faff container-check`.
     b. IF exit 1 (not_confirmed): REFUSE lights-out, point at ADR-0010.
        # promotes today's WARN to a hard BLOCK on the lights-out path only; L1–L3 unchanged.
  2. Basic precondition checks (NOT rich dial-coherence — that is FAFF-298):
     a. Assert the `review` slot resolves AND is reachable (a probe call; unreachable == absent — fail-closed).
     b. Assert the `spec_review` slot is configured + reachable (the FAFF-9 verdict path live).
     c. Assert a budget ceiling is set (no unbounded lights-out run).
     d. ANY failure: REFUSE.
     # v1 does NOT adjudicate appetite/level/slots/gates "reckless" combinations — FAFF-298.
  3. Keystone-guardrail resolution (now live contracts, not forward-interfaces):
     a. Probe `faff sentry` (kill-switch) and `faff holdout`/`faff prdr coverage` (code-blind merge) reachability.
     b. Mark each in `armed`: present+reachable ⇒ live (the expected steady state).
     c. A keystone probe that FAILS is a reachability fault ⇒ mark degraded/absent and REFUSE
        (fail-closed) — there is no designed keystone-absent reduced mode in v1.
  4. Mint L4RunLedger, render + persist banner (all 8 guardrails `live`), emit run-start event.
```

**Wrapped run — compose contracts at boundaries.**

```
PROCEDURE run(ledger):
  ON queue assembly (per candidate issue):
    - call `faff admissible --spec <spec> --lights-out`; inadmissible ⇒ issue never enters the run.
  ON each wave boundary:
    - call `faff budget check`; outcome stop|narrow|escalate feeds the loop.
    - call `faff run-done --policy <JSON>`; run-complete|continue|escalate decides continuation.
    - emit run-state events via `faff events append`.
  ON spec admission (per issue, before code):
    - consult spec_review verdict; reject-approach|needs-human ⇒ park, never code.
  ON graft Step 9 (review) and Step 10 (merge gate — UNCHANGED):
    - the gate acts on the review slot's hard signal (NO runner escalation — FAFF-297)
      AND the live holdout verdict
      (`faff holdout verdicts` → `faff prdr coverage --dod-verdicts` → prd-satisfied).
  THROUGHOUT:
    - Sentry (FAFF-49, LIVE) watches FAFF_RUN_DIR ledger+heartbeat via `faff sentry check`;
      a tripped abort intervention invokes `faff sentry abort` with override-proof kill authority.
```

**Floor assertions (must hold in-container).** The runner asserts, and the banner records, that the L3 floor is intact: FAFF-68 no-execute, worktree isolation (`FAFF_WORKTREE_ROOT`, env-overridable), and the Autonomous Mode Contract (no side-effects outside the PR/revert envelope). Asserted, not re-implemented; a failed assertion refuses the run.

**Edge cases and error handling.**

- **Review slot unreachable** — treated as **absent**, not pass+skip. On the lights-out path a configured-but-down review slot must **refuse** (fail-closed). Basic preflight (step 2a) catches this at launch; mid-run unreachability surfaces `needs-human` via the review verdict path. *(Promoting an adversarial `critical` to a hard merge-block is FAFF-297, not v1.)*
- **Budget ceiling absent** — preflight refuses (no unbounded lights-out run).
- **Holdout (FAFF-34, LIVE) verdict missing/unverified for a built issue** — *fail-safe*: a DoD with no `met` verdict rolls up `prd_satisfied==false` (FAFF-257/277) ⇒ `faff run-done` escalates ⇒ run parks at the done-gate for a human. Nothing un-verified merges silently.
- **Sentry (FAFF-49, LIVE) trips mid-run** — `faff sentry check` returns `intervention: abort` ⇒ `faff sentry abort` commits WIP to branch and marks the ledger `aborted-resumable`; the run halts mid-flight, not in the morning. (A `pause`/advisory `warn` intervention does not abort.)
- **Container not confirmed** — refuse, point at ADR-0010; never self-grant `--dangerously-skip-permissions`.

**Failure modes — how this approach falls over, and how you'd notice.**

- **The failure:** the runner drifts into re-implementing guardrail logic (e.g. its own budget arithmetic or its own derailment thresholds) instead of calling the contract. **How you'd know:** a guardrail policy change lands but the runner's behaviour doesn't track it; duplicated logic in the runner diff. **What it means:** *abandon* that path — resolve every guardrail through its CLI contract at dispatch.
- **The failure:** the banner reports `live` for a guardrail that is configured but unreachable (false-arming). **How you'd know:** a guardrail's probe was skipped or treated reachability as presence. **What it means:** *narrow* — `armed` state must come from a reachability probe, not config presence alone.
- **The failure:** the runner-v1 slice quietly re-absorbs a follow-on concern (the adversarial gating promotion, or rich dial-coherence) instead of leaving it to FAFF-297/FAFF-298. **How you'd know:** the diff adds a `critical`→`needs-human` escalation or a reckless-combination rejector. **What it means:** *narrow* — keep v1 to compose+banner+basic-preflight; ship the refinements as their own reviewable tickets.

**Anti-patterns.**

- **Anti-pattern:** the runner self-grants `--dangerously-skip-permissions` or weakens the host when `container-check` fails. **Why:** the cage is the container's job (ADR-0010); faff detects and refuses.
- **Anti-pattern:** treating a configured-but-down review slot as `pass+skip` on the lights-out path. **Why:** that silently no-ops the L4 second-opinion gate; basic preflight treats unreachable == absent and refuses.
- **Anti-pattern:** hardcoding a slot occupant (e.g. the default review skill, or re-deriving Sentry thresholds) instead of `faff config get slots.<name>` / calling the contract. **Why:** config is pulled-not-pushed; a live `.faffrc` change must be honoured.
- **Anti-pattern:** re-introducing a degrade-gracefully "reduced lights-out" mode for absent keystones. **Why:** both keystones are now live; a keystone probe failure is a fault to refuse on, not a designed reduced mode.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a lights-out run on a host where `faff container-check` exits 1 (not_confirmed)
When the runner runs preflight
Then it refuses to start, emits no work, and the refusal names ADR-0010
```

```
Given a lights-out run whose candidate queue contains a spec with no machine-verifiable DoD
When the runner assembles the queue
Then `faff admissible --spec <s> --lights-out` returns inadmissible and that issue never enters the run
```

```
Given a lights-out run whose `review` slot is unreachable at launch
When the runner runs basic preflight
Then it refuses to start (configured-but-unreachable == absent), rather than starting with the second-opinion gate silently skipped
```

```
Given a lights-out run with no budget ceiling set
When the runner runs basic preflight
Then it refuses to start (no unbounded lights-out run)
```

```
Given a lights-out run and a built issue whose code-blind holdout verdict does not mark a DoD criterion met
When the issue reaches the done-gate
Then `faff prdr coverage --dod-verdicts` rolls up prd_satisfied=false, `faff run-done` returns escalate, and nothing un-verified merges
```

```
Given an in-flight lights-out run where `faff sentry check` returns intervention: abort
When the runner consults Sentry at a wave boundary
Then it invokes `faff sentry abort`, the run halts mid-flight with the ledger marked aborted-resumable, and the derail is caught before morning
```

```
Given any lights-out run
When the runner mints the L4 run-ledger
Then the persisted banner names all 8 guardrails as live (derivable 1:1 from `armed`), so a human can confirm a fully-armed L4 run
```

*Non-functional assertions:* the runner adds no guardrail logic of its own (every guardrail decision traces to a CLI-contract call); `armed` state derives from a reachability probe, never config presence alone; the L1–L3 paths are unchanged (`--lights-out`/L4 surface is additive); the runner adds no `critical`→`needs-human` escalation (FAFF-297) and no reckless-combination rejector (FAFF-298).

## 6. DESIGN DECISION RATIONALE

**Keystone disposition — require the now-live keystones (was the central Punt).**
**Chosen:** the runner **requires + wires FAFF-49 (Sentry) and FAFF-34 (holdout) as live guardrails**; a lights-out run is fully-armed (all 8 guardrails live) or it refuses. *Rationale:* the 2026-06-28 spec posed this as a safety Punt only because both keystones were unbuilt. **That premise is gone:** FAFF-49 shipped (PR #214, `faff sentry check|abort`) and FAFF-34 shipped (PR #209, `faff holdout verdicts`, rolled into the coverage gate by FAFF-277). The kill-switch exists and is reachable, so the infosec blocker is satisfied and the degrade-gracefully / "supervised L3.5 reduced mode" branch is **removed from v1**. *Rejected:* keeping the forward-interface/degrade-gracefully framing — it would model an absence that reality has closed.

**Command surface — a distinct subcommand.**
**Chosen:** a distinct `faff` subcommand (recommended `faff lights-out`) that mints the L4 run-ledger with strict defaults and renders/persists the banner, registered in the subcommand registry per **ADR-0014**. *Rationale:* a subcommand gives a clean strict-defaults entry and a natural home for the banner; it is the SSOT-registered surface ADR-0014 mandates. *Rejected:* a `/faff-beep-boop --lights-out` **flag** — it re-introduces the manual-flag-assembly problem the runner exists to remove (one forgotten flag silently degrades the run); a **FAFF-18 recipe preset** — it couples v1 to FAFF-18's unbuilt recipe schema. The choice changes only the entry shape, not the preflight/compose behaviour. The exact verb is a minor naming detail the build may finalise; subcommand-not-flag-not-recipe is fixed. *(This was the sole remaining open Punt — now closed → confidence high.)*

**Adversarial-gating placement — deferred to FAFF-297.**
Runner-v1 does **not** add the `critical`→`needs-human` escalation. *Rationale:* it is a self-contained change over the shipped review slot with its own contract + test surface; folding it into the runner-v1 slice is exactly the multi-concern bundling the /faff-plot re-slice removed. Runner-v1 consumes graft's Step 10 gate and the review hard signal **unchanged**. *Extension point:* FAFF-297 (blocked by this slice).

**Container preflight: assume, or detect-and-refuse?**
**Chosen:** detect-and-refuse via `faff container-check`, promoting its current autonomous-entry WARN to a hard BLOCK on the lights-out path only. *Rationale:* ADR-0010 settles the blast radius as the container's responsibility; L1–L3 keep today's warn-don't-block behaviour.

**Preflight scope: basic, not rich coherence.**
**Chosen:** basic preflight only — container confirmed, budget ceiling set, review + spec_review slots configured + reachable, keystones reachable; each fail-closed. *Rationale:* a missing precondition must stop the run before work is admitted, and these checks are cheap reachability/presence probes. *Rejected for v1:* adjudicating reckless level+appetite+slots+gates **combinations** — that richer coherence model (ties FAFF-18) is **FAFF-298**, independently testable and beyond v1.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions** (`**Punt:**` — must be closed by a human before build): **none.** The previously-central safety Punt (degrade-gracefully vs require the kill-switch) is resolved by reality (§6), and the command-surface Punt is now **`Chosen:`** a distinct subcommand (§6). **Zero open Punts.**

**Assumes** (`**Assumes:**` — validate before build):

- **`**Assumes:** the 8 guardrail CLI contracts exist and are stable as named`** — `faff admissible`, `faff budget check`, `faff run-done`, `faff events`, `faff container-check`/`faff contain`, `faff contract spec-review-verdict` + `faff spec-review-lenses` + the `spec_review` slot, **`faff sentry check|abort`**, **`faff holdout verdicts` + `faff prdr coverage --dod-verdicts`**. *Validate:* `faff <cmd> --help`/`--selftest` for each at build start; **all verified live 2026-06-29**.
- **`**Assumes:** FAFF-49 (Sentry) exposes `faff sentry check` → DerailmentVerdict{intervention} + `faff sentry abort`, reading FAFF_RUN_DIR ledger+heartbeat with override-proof kill authority`** — **SHIPPED (PR #214, Done)**, `--selftest` green (24 cases incl. AC5 hostile-field rejection). *Validate:* the runner codes to this shape behind a reachability probe.
- **`**Assumes:** FAFF-34 (holdout) exposes `faff holdout verdicts` (code-blind, prose→needs-human) rolled into `faff prdr coverage --dod-verdicts` so an unverified DoD drives prd_satisfied=false`** — **SHIPPED (PR #209 + FAFF-277 PR #213, both Done)**. *Validate:* confirm the absent-verdict ⇒ prd_satisfied=false wiring holds before relying on the done-gate fail-safe.
- **`**Assumes:** lights-out runs execute in-container per ADR-0010`** (claude-box provides host isolation + `--dangerously-skip-permissions`). *Validate:* `faff container-check` exit 0 at preflight; refuse otherwise.

## 8. DONE — Definition of Done

### From WHY
- [ ] A single entry point launches `/faff-beep-boop` unattended with the L4 guardrails composed; no hand-assembly of flags is required.
- [ ] The L1–L3 paths are unchanged (the L4/lights-out surface is additive).

### From WHAT (types and interfaces)
- [ ] The runner consumes each of the 8 shipped guardrail contracts via its CLI, re-implementing none of them.
- [ ] The L4 run-ledger carries `armed: Map<Guardrail, State>` and `banner` is derivable 1:1 from `armed`.
- [ ] FAFF-49 (`faff sentry`) and FAFF-34 (`faff holdout`/`prdr coverage`) are wired as **live guardrails** resolved by a reachability probe, marked `live` in `armed`; a probe failure refuses the run (no reduced mode).

### From HOW (basic preflight)
- [ ] `faff container-check` exit 1 refuses lights-out and names ADR-0010 (WARN→BLOCK on the lights-out path only).
- [ ] Basic preflight refuses unless: the `review` slot is reachable, the `spec_review` slot is configured + reachable, and a budget ceiling is set.
- [ ] A configured-but-unreachable review slot is treated as absent (fail-closed), never `pass+skip`.
- [ ] A keystone (Sentry / holdout) probe failure refuses the run (fail-closed) — there is no keystone-absent reduced mode.
- [ ] The runner does **not** adjudicate reckless level+appetite+slots+gates combinations (that is FAFF-298).

### From HOW (compose loop)
- [ ] `faff admissible --spec <s> --lights-out` is called at queue assembly; inadmissible issues never enter the run.
- [ ] `faff budget check` and `faff run-done` are consulted at each wave boundary; their outcomes drive continuation.
- [ ] `faff sentry check` is consulted in-flight; an `abort` intervention invokes `faff sentry abort` and halts the run mid-flight (ledger `aborted-resumable`).
- [ ] The holdout verdict is consulted at the done-gate via `faff prdr coverage --dod-verdicts`; an unverified DoD drives prd_satisfied=false and the run escalates.
- [ ] Run-state/events are emitted via `faff events append`.
- [ ] Spec admission consults the spec_review verdict; `reject-approach`/`needs-human` parks before any code.
- [ ] Graft Step 9 review / Step 10 merge gate are consumed **unchanged** — the runner adds no `critical`→`needs-human` escalation (that is FAFF-297).

### From HOW (floor)
- [ ] The runner asserts and the banner records FAFF-68 no-execute, worktree isolation (`FAFF_WORKTREE_ROOT`), and the Autonomous Mode Contract; a failed assertion refuses the run.

### From command surface
- [ ] A distinct `faff` subcommand (recommended `faff lights-out`) is implemented and registered in the subcommand registry per ADR-0014.

### Docs
- [ ] A "how to run lights-out against claude-box (ADR-0010)" doc ships in the same PR (docs never go stale).

**Integration smoke test:**

```
PROCEDURE smoke_lights_out():
  1. In-container, with all basic preconditions met and a queue of one admissible born-verifiable spec:
  2. Invoke the lights-out subcommand.
  3. ASSERT: banner persisted naming all 8 guardrails live; run-start event emitted.
  4. ASSERT: the issue is admitted, built, reviewed; the run reaches a terminal run-done verdict.
  5. ASSERT: `faff sentry check` is consulted in-flight; an injected abort fixture halts the run resumably.
  6. ASSERT: on a host where container-check exits 1, the same invocation refuses with an ADR-0010 message and emits no work.
  # "if this connects, the plumbing is wired" — not exhaustive.
```

## Methodology critique

`issue-critique` through the agile-delivery lens (banner: `Methodology: faffter-dark-methodology-agile-delivery`) — **refreshed 2026-06-29 (post re-slice)**:

- **Right-sized? (principle 4) — YES (the split landed).** The prior full-epic finding (≥4 independent concerns) drove the /faff-plot **re-slice**: the adversarial advisory→gating promotion is now **FAFF-297** and the rich dial-coherence preflight is **FAFF-298**, both carved out as follow-ons blocked by this slice. What remains is one cohesive concern — *command surface + L4 run-ledger + banner + compose-the-8-shipped-contracts + basic preflight + floor assertions + docs* — a single integration unit that ships together. *No action:* the split that the lens asked for is done.
- **Workstream fit? (principles 1, 5) — GOOD.** Sits in the outcome-named project "Down the pub — trustworthy lights-out v1 (L4)" as its cohesive spine; the out-of-scope list correctly pushes CI/deploy/self-learning/rollback and the two refinements (FAFF-297/298) to their own tickets.
- **Deps surfaced? (principle 6) — GOOD, ACTIONABLE.** Both keystone blockers landed: **FAFF-49 Done** (PR #214) and **FAFF-34 Done** (PR #209), plus FAFF-277/FAFF-257 wiring Done. The two follow-ons are linked `blocks` edges (FAFF-297, FAFF-298). FAFF-225's blocking chain is clear; nothing remains gated on cross-stream work.
- **Risk profile? (principle 7) — LOW.** The novel, surprise-prone keystone work (live supervision + code-blind merge) is built and shipped (FAFF-49 `--selftest` green; FAFF-34 GO-narrow per ADR-0029). Residual is integration-composition risk, now contained to the thin compose+banner+basic-preflight slice; the gating promotion (FAFF-297) is a separately-reviewable follow-on rather than part of one sprawling change.

confidence: high

spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
