# FAFF-572 — Harden the L3/L4 autonomous contract against interactive second-guessing

> Spec: faffter-dark-nlspec · 2026-07-20 · interactive · confidence: high. Full spec on Linear FAFF-572.

**Artifact:** buildable nlspec spec for FAFF-572 (Bug — autonomous-mode contract enforcement gap). **Audience:** the build agent that will edit the gateway prose, and the human reviewers who gate the PR. **Delivery shape:** a prose-hardening change to two `SKILL.md` files plus one lint-threshold constant, no runtime behaviour change.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff's autonomous contract lives entirely in *prose the model is asked to obey* — there is no runtime that forces it. The gateway `Autonomous Mode Contract` already forbids a long, explicit list of bad **park** reasons, forcefully, and that list holds. But the symmetric failure — the agent **prompting the human** mid-run — is guarded only by one soft bullet (`- **Never prompt.**`, line 641). During run `run-20260720-070439-beepboop-full` (2026-07-20) that soft bullet lost: the driving agent inserted two `AskUserQuestion` gates (a build-scope confirm, a pre-merge go/no-go) into a live L3 `/faff-beep-boop` run, stalling an unattended run interactively and ballooning wall-clock to ~7h (tripping Sentry's 4h `wall-clock-runaway` ceiling). Both stalled decisions were already fully determined by contract + config; the run resolved identically the moment the agent stopped asking. This change makes second-guessing an autonomous-initiated run **unmissably out of bounds** — same treatment the forbidden-park-reasons list already gives the mirror failure.

**Problem statement.** Today the never-prompt rule is a single soft bullet that leans on model compliance and lost, and there is no named list of the rationalisations that lead an agent to over-caution. This change installs a hard, harshly-worded invariant plus an enumerated banned-rationalisations list at the top of the gateway `Autonomous Mode Contract`, framing a mid-run interactive gate as a contract **violation, not caution**.

**Design principles:**

- **The invariant has exactly one canonical home.** The repo's skill-authoring dedup standard (`docs/skill-authoring.md`, CLAUDE.md) requires shared prose to live once — at the gateway (`faff/SKILL.md`) — and be referenced, never copied. `faff-beep-boop/SKILL.md` must point at the invariant, not restate it. An implementation that duplicates the list into beep-boop is rejected even if it reads well.
- **Mirror the established forceful register.** The new invariant and banned list must match the tone and shape of the existing `**Forbidden park reasons (explicit list):**` bullet (line 649) and the "Deferred == parked, relabelled" bullet (line 650) — those are the proven stylistic models for a rule that binds. A polite restatement of "Never prompt" is not the deliverable.
- **The sole carve-out survives, named.** The pre-mint install-health `faff sync` soft-offer (lines 84-96) is the one sanctioned interactive touchpoint because it mutates `~/.claude` (a side-effect outside the PR flow) and fires pre-mint (before any run ledger exists). The invariant must name it explicitly so no future reader reads the hard rule as contradicting it.
- **Prose is the only lever in this MVP.** No CLI/runtime behaviour changes here. The one non-prose edit permitted is the lint-threshold constant that keeps `faff validate-adapters` green (see HOW); that is a lint accommodation, not runtime behaviour, and is scoped tightly.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` → `### Autonomous Mode Contract` (≈ lines 635-742) | Markdown prose | The canonical home; the invariant + banned list land right after the mode-signal paragraph (line 637), absorbing the soft `Never prompt` bullet (line 641). |
| `plugin/skills/faff/SKILL.md` line 649 (`**Forbidden park reasons (explicit list):**`) | Markdown prose | The forceful stylistic model the new banned-rationalisations list mirrors. |
| `plugin/skills/faff/SKILL.md` → `## First run` (73-82) / `## Install health` (84-96) | Markdown prose | The sole carve-out (`faff sync` soft-offer), interactive-only, pre-mint; line 94 already says autonomous "never prompt, never run `faff sync`, never mutate `~/.claude`". |
| `plugin/skills/faff-beep-boop/SKILL.md` (line 43; lines 685-690) | Markdown prose | The echo point — already references the gateway contract by pointer; a one-line pointer to the new invariant joins it here, not a copy. |
| `plugin/skills/faff/bin/lib/validate-adapters.js` (`SKILL_LINE_CAP_OVERRIDE`, line 39) | JavaScript | The lint gate. Gateway is at **1109 / cap 1110**, beep-boop at **698 / cap 699** — both effectively full; the caps must rise to admit the added lines. |
| `plugin/skills/faff/bin/lib/merge-fence.js`, `background-fence.js`, `hooks-ensure.js`, `runcheck.js` (`runIsOwned`) | JavaScript | The mechanical-backstop precedent for the **deferred follow-up** (a PreToolUse prompt-fence) — out of scope here; cited so the follow-up is grounded. |

**Scope statement.** This is a prose-hardening change inside the gateway's autonomous-mode contract — the shared home every faff sub-skill loads on entry — plus a one-pointer echo in beep-boop and a lint-cap bump; it is the MVP half of a deliberately split concern whose other half (a mechanical prompt-fence) is a recommended follow-up.

## 2. OUT OF SCOPE

- **Mechanical prompt-fence (PreToolUse backstop).** — A hook that DENIES an `AskUserQuestion` when this session owns a live, `running` L3/L4 run ledger, mirroring `merge-fence.js`/`background-fence.js`. **Why excluded:** it is a second, independent concern (agile right-sizing: two independent concerns → split), and it additionally carries de-risking-spike character — a novel harness integration plus a global-blast-radius safety property — that the prose MVP does not need to gate on. The prose delivers the MVP value whether or not the fence proves feasible. **Extension point:** a new `prompt-fence` in `plugin/skills/faff/bin/lib/`, registered via `plugin/skills/faff/bin/lib/hooks-ensure.js` (`FAFF_PRE_TOOL_USE_HOOKS` + a new matcher group), reusing `runcheck.js` `runIsOwned(ledger, runDir, env)` + the ledger `level` field to answer "does this session own an open L3/L4 ledger?". Feasibility is punted below.

- **Changing what the autonomous defaults resolve to.** — The invariant restates that ambiguity resolves to **park or route-out**; it does not alter the existing resolve-attempt / automation-routing verdict machinery. **Why excluded:** the RCA is about *the agent asking anyway*, not about wrong defaults; the defaults were already correct. **Extension point:** the gateway `Resolve-attempt before park` table (≈ lines 744-753) if default resolution ever needs tuning.

- **Sentry wall-clock ceiling tuning.** — The 4h `wall-clock-runaway` advisory ceiling that tripped is not re-tuned here. **Why excluded:** the runaway was a *symptom* of the prompting stall; fix the cause, not the alarm. **Extension point:** the `sentry.*` thresholds (`faff-beep-boop/SKILL.md` line 99 region).

- **The install-health `faff sync` carve-out's behaviour.** — Preserved and named, not modified. **Why excluded:** it is the sanctioned exception, already correct (lines 84-96). **Extension point:** none needed — it is referenced, not touched.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Autonomous-initiated run | A run signalled autonomous at invocation. L3 = a `/faff-beep-boop` run; L4 = a lights-out-minted ledger carrying `level: "L4"`. The mode signal is already unambiguous; this spec adds no new signal. |
| Interactive gate | Any mid-run prompt to the human for a decision (e.g. `AskUserQuestion`) — a build/scope confirm, a merge go/no-go, an admission call. |
| Banned rationalisation | A named excuse an agent uses to justify a mid-run interactive gate; enumerated so it is recognisable and refusable on sight, mirroring the forbidden-park-reasons list. |
| Sole carve-out | The pre-mint install-health `faff sync` soft-offer — the one interactive touchpoint the invariant explicitly preserves. |

This spec introduces **no code types, schemas, or API surfaces** — it is a prose change plus one integer-constant edit. The "interfaces" that matter are the prose contract's shape and the lint gate.

**The prose contract additions (shape, not verbatim wording).** In `plugin/skills/faff/SKILL.md`, inside `### Autonomous Mode Contract`, immediately after the mode-signal paragraph (line 637) and absorbing the soft `- **Never prompt.**` bullet (line 641):

1. **Invariant block** — a single, unmistakable, forcefully-worded rule stating: once a run is L3/L4-initiated, the agent NEVER prompts the human for a build / scope / merge / admission decision; a mid-run interactive gate is a **contract VIOLATION, not caution**; genuine ambiguity resolves to **park or route-out — full stop**. It names the sole carve-out (the pre-mint `faff sync` soft-offer) as the one exception, noting it is pre-mint / pre-ledger.
2. **Banned-rationalisations enumerated list** — mirroring the `**Forbidden park reasons (explicit list):**` style (line 649), each named as a non-reason, covering at minimum: "self-hosting repo", "high stakes / auto-merges to main", "the user is present / watching", "let me just confirm the plan/scope", and similar over-caution triggers.

**The lint-cap edit.** In `plugin/skills/faff/bin/lib/validate-adapters.js`:

```
CONSTANT SKILL_LINE_CAP_OVERRIDE       # existing object, line 39
  faff:            1110  -> raise to accommodate the added invariant + banned list
  "faff-beep-boop":  699 -> raise by 1 to accommodate the added pointer line
  CONSTRAINT new value >= actual post-edit line count of each file
  CONSTRAINT this is the ONLY non-prose edit; it changes a lint threshold, not runtime behaviour
```

**Design decision — how to fit the new prose under the line cap.** The gateway is at 1109/1110 and beep-boop at 698/699 — no headroom. Options: (a) reclaim lines by leaning surrounding prose to net-zero; (b) raise the `SKILL_LINE_CAP_OVERRIDE` values. Option (a) is fragile (must reclaim exactly as many lines as added, and the invariant should be skimmable bullets, not crammed dense lines — skimmability is itself a lint rule) and risks collateral edits to unrelated prose. Option (b) is a one-line edit to a constant object, deterministic, and honest about the gateway's role as the shared-prose hub (the override comment already says "the gateway is the shared-prose hub … it grows"). **Chosen:** raise the two `SKILL_LINE_CAP_OVERRIDE` values to fit the post-edit line counts (option b), while still absorbing the now-redundant soft `Never prompt` bullet so the net addition stays minimal. Rationale: minimal, deterministic, aligned with the existing override's documented intent; not a runtime/behavioural change.

## 4. HOW — Behavior

**Approach.** Three coordinated prose/lint edits, one PR:

1. **Gateway invariant + banned list** (`faff/SKILL.md`, in `### Autonomous Mode Contract`, after line 637). Insert the invariant block as the first and loudest rule of the contract, then the banned-rationalisations enumerated list mirroring line 649's style. Delete/absorb the soft `- **Never prompt.**` bullet (line 641) — its content is subsumed by the harder invariant, so leaving both is redundant and wastes a line.
2. **beep-boop echo by reference** (`faff-beep-boop/SKILL.md`). Add a one-line pointer near the existing autonomous references (line 43 `No yes/no gates.`, and/or the lines 685-690 pointer cluster) that says the never-prompt-for-decisions invariant lives in the gateway `Autonomous Mode Contract` — **no restated list, no duplicated block**.
3. **Lint-cap bump** (`validate-adapters.js`, `SKILL_LINE_CAP_OVERRIDE`). Raise `faff` and `faff-beep-boop` caps to the post-edit line counts.

**Procedure — placement and absorption:**

```
PROCEDURE harden_autonomous_contract:
  1. In faff/SKILL.md, locate `### Autonomous Mode Contract` and the mode-signal paragraph (line ~637).
  2. Immediately after it, insert the INVARIANT block:
     a. State: L3/L4-initiated => NEVER prompt human for build/scope/merge/admission decisions.
     b. Frame a mid-run interactive gate as a contract VIOLATION, not caution.
     c. State: genuine ambiguity => park or route-out — full stop.
     d. Name the SOLE carve-out: pre-mint `faff sync` soft-offer (pre-ledger; naturally exempt).
  3. Insert the BANNED-RATIONALISATIONS list mirroring the line-649 style; name >= the four:
     "self-hosting repo", "high stakes / auto-merges to main",
     "user is present/watching", "let me just confirm the plan/scope".
  4. DELETE the soft `- **Never prompt.**` bullet (line ~641); its content is now in the invariant.
  5. In faff-beep-boop/SKILL.md, add ONE pointer line to the gateway invariant. Do NOT restate the list.
  6. In validate-adapters.js, raise SKILL_LINE_CAP_OVERRIDE.faff and .["faff-beep-boop"]
     to >= each file's new line count.
  7. Run `faff validate-adapters` — must pass (line cap, paragraph <=200 words/line, no dup block).
```

**Edge cases.**

- **Paragraph word cap.** `validate-adapters` fails any single prose line over 200 words (`PARA_WORD_CAP`). The existing forbidden-park-reasons line (649) is 148 words on one line; the new banned list, if written as one dense enumerated line in the same style, must stay under 200 words — otherwise split across bullets. Prefer skimmable bullets over a wall-of-text line.
- **Duplicated-block detector.** `validate-adapters` cross-file dedup (`DUP_SIG_MINLEN` 25, block window) will FAIL if the beep-boop echo copies a significant run of the gateway's invariant lines. The echo must be a genuinely different pointer sentence, not a paste.
- **Carve-out non-collision.** The `faff sync` offer fires pre-mint (before any run ledger exists), so it is already outside the invariant's "once a run is L3/L4-initiated" precondition; naming it is belt-and-braces for the reader, not a logic branch.

**Failure modes.**

- **The failure:** prose alone may not bind the model any better than the soft bullet did — the RCA is literally "the current bullets lean on model compliance and lost." A harsher, better-placed invariant raises compliance but cannot *guarantee* it; a sufficiently over-cautious agent could still prompt. **How you'd know:** a future `/faff-beep-boop` run log still shows a mid-run `AskUserQuestion` for a contract-determined decision, or Sentry trips `wall-clock-runaway` again on an interactive stall. **What it means:** the prose MVP narrows but does not close the gap — proceed with the MVP (it is the cheap, correct first move and the dedup-correct home for the rule), and escalate the deferred mechanical prompt-fence follow-up from "recommended" to "needed". This is the explicit reason the fence is split out rather than dropped.

- **The failure:** the beep-boop echo drifts back into a restatement over time (a well-meaning editor "helpfully" inlines the list), reintroducing the dedup violation the standard forbids. **How you'd know:** `faff validate-adapters` duplicated-block check fails, or a grep shows the banned list appearing in `faff-beep-boop/SKILL.md`. **What it means:** the lint gate catches it — no silent drift; fix by re-collapsing to a pointer.

**Anti-pattern:** copying the invariant or banned list into `faff-beep-boop/SKILL.md`. Why: violates the repo dedup standard (one home = the gateway) and fails `faff validate-adapters`' duplicated-block detector. Reference it.

**Anti-pattern:** softening the invariant to hedge the sole carve-out ("never prompt, unless it seems important"). Why: hedging is exactly the over-caution the RCA identifies; the carve-out is a single named, pre-mint exception, not a general escape hatch.

**Anti-pattern (for the deferred fence, recorded so the follow-up doesn't repeat the run's mistake):** registering a global PreToolUse `AskUserQuestion` deny that fires in every session. Why: it would break all legitimate interactive `AskUserQuestion` use; it must deny only when `runIsOwned(...)` is true for a `running` L3/L4 ledger (`runIsOwned` returning false for interactive sessions is the make-or-break safety property).

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the gateway faff/SKILL.md Autonomous Mode Contract
When a reader reaches the top of the contract (right after the mode-signal paragraph)
Then there is a single unmistakable invariant stating L3/L4-initiated runs NEVER prompt the
     human for a build/scope/merge/admission decision, framing a mid-run gate as a contract
     VIOLATION not caution, with ambiguity -> park or route-out
```

```
Given the hardened Autonomous Mode Contract
When a reader looks for the excuses that lead to over-caution
Then an enumerated banned-rationalisations list, styled like the forbidden-park-reasons list,
     names at least "self-hosting repo", "high stakes / auto-merges to main",
     "the user is present/watching", and "let me just confirm the plan/scope"
```

```
Given the invariant text
When a reader checks whether the hard rule contradicts the install-health flow
Then the invariant explicitly names the pre-mint `faff sync` soft-offer as the sole exception
```

- The prose change MUST pass `faff validate-adapters` (line cap, ≤200-word prose lines, no duplicated cross-file block).

## 6. DESIGN DECISION RATIONALE

**Where does the invariant canonically live?**
Options: (a) gateway `Autonomous Mode Contract` only, beep-boop references it; (b) both files state it. (b) violates the repo dedup standard and the lint's duplicated-block detector.
**Chosen:** gateway is the sole home; beep-boop references by pointer — matches `docs/skill-authoring.md` ("shared prose has one home; reference it, never copy") and how beep-boop already points at the contract (lines 685-690).

**Prose-only MVP vs shipping the mechanical fence now?**
Options: (a) prose only, split the fence to a follow-up; (b) prose + fence in one ticket. The fence is an independent concern with de-risking-spike character (novel harness integration + global blast radius) whose feasibility rests on an unverifiable external fact (is `AskUserQuestion` a hookable PreToolUse tool name?). The prose delivers MVP value regardless.
**Chosen:** prose-only MVP; mechanical fence split to a recommended follow-up (agile right-sizing: two independent concerns → split; the risky one gets its own de-risking spike).

**How to echo the invariant into beep-boop?**
Options: (a) one-line pointer; (b) restate the rule/list. (b) duplicates and fails lint.
**Chosen:** one-line pointer to the gateway contract — no duplicated block.

**How to keep `faff validate-adapters` green given zero line headroom?**
Options: (a) reclaim lines by leaning surrounding prose to net-zero; (b) raise `SKILL_LINE_CAP_OVERRIDE`. (a) is fragile and risks unrelated collateral edits; the invariant should be skimmable bullets, not crammed dense lines.
**Chosen:** raise `SKILL_LINE_CAP_OVERRIDE.faff` and `.["faff-beep-boop"]` to the post-edit line counts, and still absorb the redundant soft `Never prompt` bullet to keep the addition minimal. It is a lint-threshold constant, not runtime behaviour, and the override's own comment documents the gateway as the growing shared-prose hub. At the time of writing the gateway is 1109/1110 and beep-boop 698/699.

**Is the mechanical prompt-fence feasible at all?**
The machinery exists (`runcheck.js` `runIsOwned` + ledger `level`), so a stateful, ledger-keyed deny is feasible in principle. Two genuine risks remain: global blast radius (must deny ONLY when this session owns a live L3/L4 ledger) and a harness unknown (whether `AskUserQuestion` is a hookable PreToolUse matcher/tool-name — an external fact not verifiable from this repo; `merge-fence` matches `Bash`, `background-fence` adds `Monitor`).
**Punt:** mechanical prompt-fence feasibility — needs a de-risking spike in the follow-up ticket before design commits. `(decides: architecture)`

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- **Punt:** Mechanical prompt-fence feasibility — is `AskUserQuestion` exposed as a hookable PreToolUse matcher/tool-name in the Claude Code harness, and can a ledger-keyed deny be proven dormant in every non-owning / interactive session (`runIsOwned` → false)? Unverifiable from this repo; the first step of the follow-up ticket is a de-risking spike answering both. If `AskUserQuestion` is not hookable, the mechanical approach is infeasible and prose remains the only lever. Out of scope for FAFF-572; does not gate this MVP. `(decides: architecture)`

**Assumptions.**

- **Assumes:** `plugin/skills/faff/bin/lib/validate-adapters.js` enforces the SKILL.md lint gate via `SKILL_LINE_CAP_OVERRIDE` (per-file line caps), `PARA_WORD_CAP` (≤200-word prose lines), and a cross-file duplicated-block detector. **Validation:** verified present at lines 38-55 of `validate-adapters.js`; the build agent re-confirms current cap values before bumping (`grep SKILL_LINE_CAP_OVERRIDE`).
- **Assumes:** the gateway `Autonomous Mode Contract` and its `**Forbidden park reasons (explicit list):**` bullet, and the `faff sync` install-health carve-out, are present in `faff/SKILL.md` as described. **Validation:** verified — contract ≈ lines 635-742 (forbidden-park bullet at 649), carve-out at lines 84-96 (line 94 already states the autonomous "never run `faff sync`, never mutate `~/.claude`" rule). The build agent confirms line numbers have not drifted before editing.

## 8. DONE — Definition of Done

### From WHY
- [ ] A live `/faff-beep-boop` (L3) or lights-out (L4) run's contract now contains an unmissable rule that would have refused the two `AskUserQuestion` gates from run-20260720-070439 (invariant present and loud).

### From WHAT / HOW (gateway invariant)
- [ ] `faff/SKILL.md` `### Autonomous Mode Contract` contains a single invariant block, placed right after the mode-signal paragraph (line ~637), stating L3/L4-initiated runs NEVER prompt for build/scope/merge/admission decisions, framing a mid-run interactive gate as a contract VIOLATION (not caution), with ambiguity → park or route-out.
- [ ] The soft `- **Never prompt.**` bullet (former line 641) is absorbed/removed (no redundant duplicate rule left behind).

### From WHAT / HOW (banned-rationalisations list)
- [ ] An enumerated banned-rationalisations list is present, styled after the line-649 forbidden-park-reasons bullet, naming at least: "self-hosting repo", "high stakes / auto-merges to main", "the user is present/watching", "let me just confirm the plan/scope".

### From WHY (sole carve-out)
- [ ] The invariant explicitly names the pre-mint `faff sync` install-health soft-offer as the sole exception (and notes it is pre-mint / pre-ledger).

### From HOW (beep-boop echo by reference)
- [ ] `faff-beep-boop/SKILL.md` references the gateway invariant by pointer; grep confirms it does NOT restate the banned-rationalisations list as its own block.

### From WHAT (lint accommodation)
- [ ] `SKILL_LINE_CAP_OVERRIDE.faff` and `.["faff-beep-boop"]` in `validate-adapters.js` are raised to ≥ each file's post-edit line count; no other non-prose edit is made.
- [ ] `faff validate-adapters` passes (line cap, ≤200-word prose lines, no duplicated cross-file block).

### From OUT OF SCOPE
- [ ] No runtime/CLI behaviour change is in the diff (only the two `SKILL.md` files and the one lint-constant object).
- [ ] The mechanical prompt-fence is NOT implemented here; a follow-up ticket is recommended, carrying the fence-feasibility Punt as its first (de-risking-spike) step.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Run `faff validate-adapters`            -> exits 0 (all SKILL.md lint checks pass)
  2. grep the banned rationalisations in faff/SKILL.md      -> all four present, in the contract
  3. grep "faff sync" within the invariant region of faff/SKILL.md -> carve-out named
  4. grep the banned list text in faff-beep-boop/SKILL.md   -> ABSENT (pointer only)
  5. git diff --name-only  -> exactly: faff/SKILL.md, faff-beep-boop/SKILL.md, validate-adapters.js
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" } ] }
```
