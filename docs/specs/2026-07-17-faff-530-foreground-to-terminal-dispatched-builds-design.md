# nlspec — FAFF-530: Foreground-to-terminal discipline for dispatched build subagents

> Spec: faffter-dark-nlspec · 2026-07-17 · autonomous · confidence: high. Full spec on Linear FAFF-530.

This document is the buildable spec for FAFF-530 (bug/reliability, Medium): dispatched build subagents running `faff-graft` autonomously background long steps (gate/test runs via Monitor, the Step-9 review) and end their turn with a progress report instead of the terminal token, stalling the beep-boop drain until the orchestrator SendMessage-resumes them. Audience: the build agent implementing this, and human reviewers. This is a **narrowed-delta spec** — three prior tickets already shipped against this surface (see *Already shipped* below); only the remaining delta is specified.

## 1. WHY — Problem and Principles

**The load-bearing model:** a dispatched build subagent's turn is its lifeline — when it ends its turn, nothing inside it resumes; only the orchestrator's terminal-token await (or a costly SendMessage nudge) stands between "backgrounded a step and stopped" and a stalled drain. The existing defences bind the wrong layers: the `background-fence` hook sees only Bash tool calls, and the "never end a turn" invariant lives in the orchestrator's prose, not the build subagent's. The delta closes the build subagent's *own* turn contract at three layers: graft prose, dispatch-prompt injection, and a widened mechanical fence.

**Problem statement.** During beep-boop build waves, ~half of dispatched builds background a long step (a test run via the Monitor tool, or the Step-9 review) and end their turn with a progress report instead of `TerminalToken{ issue, outcome, pr }`; the orchestrator must detect and resume each one, and the accumulated stall time trips the Sentry wall clock (6h against a 4h budget). This change makes "end of turn ⇒ terminal token or a sanctioned hold" a stated, lint-pinned, and (where mechanically visible) hook-enforced contract of the dispatched build itself.

**Design principles:**

- **The fix targets the build subagent's internal behaviour, never the orchestrator's dispatch posture.** `faffter-dark-concurrency-parallel` deliberately backgrounds its build dispatches behind an await-all gate — that posture is correct and must not be constrained by any new fence or prose.
- **Layered, honestly-scoped enforcement.** Prose states the rule; lint pins the prose against drift; the hook denies only what a PreToolUse event can actually see (tool name + `tool_input`). No layer claims coverage it doesn't have — the fence stays a token-shape matcher, never a shell parser.
- **The 600-line cap on `faff-graft/SKILL.md` is honoured by in-place paragraph extension, not new lines.** The file is at 599/600; every graft-prose addition lands inside an existing source line (markdown paragraphs are single source lines here).

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` (line 274, lines 574–591) | prose | Foreground-posture paragraph to extend; Return-values section to extend |
| `plugin/skills/faff/bin/lib/background-fence.js` | JS | The Bash-only PreToolUse fence to widen |
| `plugin/skills/faff/bin/lib/hooks-ensure.js` | JS | Registers the PreToolUse groups (currently one `matcher: "Bash"` group) |
| `plugin/skills/faff/bin/lib/validate-adapters.js` (lines 441–455) | JS | The FAFF-491 anchor-phrase lint to extend |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` (step 2, ~line 30) | prose | BuildDispatch prompt assembly — clause injection point |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` (~lines 35, 41) | prose | Same, parallel executor |

**Scope statement.** This sits at the graft/orchestrator seam of the autonomous build pipeline: it changes what a dispatched graft promises about its own turn, and how that promise is injected and enforced.

## Already shipped against this surface

- **FAFF-491 (Done)** — the `background-fence` PreToolUse hook (Bash-only, gate/test-command regex) plus the graft SKILL.md line-274 "Foreground posture (governs Steps 7–8b)" paragraph and its two-anchor lint (`run_in_background: true` + `never end a turn`).
- **FAFF-439 (Done)** — the orchestrator dispatch posture: the sequential executor pins `run_in_background: false`; the mechanism-slot lint requires every executor to declare a turn-safe posture.
- **FAFF-329 (Done)** — resume-at-review checkpoint recovery: a re-dispatched graft resumes the review at the right phase. Mitigation (cheap recovery), not prevention — this spec is the prevention half.

## 2. OUT OF SCOPE

- **Changing the parallel executor's background dispatch + await-all gate** — correct by design; extension point: none needed.
- **A native "await agents" primitive or harness change** — faff can't change the Claude Code harness; the fence works within PreToolUse semantics. Extension point: `hooks-ensure.js` if the harness later exposes richer events.
- **Fencing Agent-tool dispatches** — the hook layer cannot distinguish a build subagent's Agent call from the orchestrator's deliberate backgrounded build dispatch (same settings.json, same event shape); a deny would break `faffter-dark-concurrency-parallel`. Covered by prose + dispatch clause only. Extension point: `background-fence.js` `matchesBackgroundedGate`, if a future harness stamps agent depth/role into the event.
- **Orchestrator-side stall detection/auto-resume** (SendMessage nudging as a supervised recovery loop) — Sentry/fleet-supervision territory. Extension point: the executors' poll-loop checkpoint.
- **Prep-producer turn discipline** — the beep-boop turn-survival invariant already notes prep isolation as a deferred sibling; unchanged here.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Foreground-to-terminal discipline | The dispatched build's turn contract: within a turn, long steps run/block in the foreground; a turn ends only bearing the terminal token(s) or a sanctioned hold |
| Sanctioned hold | The `retry-later` disposition (checkpointed, claim released) — the only non-terminal-token turn end permitted |
| Gate family | The command shapes `GATE_FAMILY_PATTERNS` matches (unchanged set) |

**Fence decision (widened):**

```
FUNCTION matchesBackgroundedGate(tool_name, command, run_in_background):
  IF tool_name == "Bash":
     RETURN run_in_background === true (strict boolean) AND matchesGateFamily(command)
  IF tool_name == "Monitor":
     RETURN command is non-empty string AND matchesGateFamily(command)
     # no run_in_background conjunct: Monitor is background-by-construction
  RETURN false
```

`GATE_FAMILY_PATTERNS`, the strict-boolean Bash conjunction, all fail-safe-to-allow paths, and the LIMITATION stance (token-sequence regex, not a shell parser) are unchanged.

**Hook registration:** `hooks-ensure.js` adds a **second** PreToolUse group `{ matcher: "Monitor", hooks: [background-fence --hook] }` alongside the existing `matcher: "Bash"` group (which keeps both fences). The existing Bash group is untouched — no migration of installed settings; `merge-fence` never receives Monitor events. The idempotent add/normalize logic and `FAFF_ALL_HOOKS` serving probe extend to the new group.

**Deny message:** the Monitor arm needs its own remedy wording (for Monitor the remedy is "run the gate/test as a foreground Bash call; Monitor is for event streams, never a gate run"). One message constant per tool arm, or one message covering both — implementer's choice; it must name the foreground-Bash remedy either way.

**Lint (validate-adapters):** the existing `faff-graft` check gains a **third** required anchor phrase, `foreground-to-terminal` (case-insensitive), same substring-presence honesty caveat. The mechanism-slot check gains one assertion: executor prose must include the same distinctive phrase, `foreground-to-terminal` (case-insensitive), as its dispatch-clause anchor.

## 4. HOW — Behavior

**Graft prose (the contract's home).** Two in-place line extensions in `plugin/skills/faff-graft/SKILL.md`, zero net new lines:

- **Line 274** (`**Foreground posture …**` paragraph): widen governance from "Steps 7–8b" to "Steps 7–9b", and append the discipline: the posture applies to *every* long step including the Step-9 review invocation, and under autonomous dispatch the turn-end rule is **foreground-to-terminal** — a dispatched graft never ends its turn on a progress report; it ends a turn only bearing the terminal token(s) (`TerminalToken{ issue, outcome, pr }`, one per chain member) or the retry-later hold. Long waits block in-turn (heartbeat ticks bracket them); Monitor is never used to run a gate/test.
- **Return-values line (~574)**: one appended sentence — the terminal token is the *only* sanctioned turn end for a dispatched build; "progress so far" is not a return value.

The line-274 paragraph is a single markdown source line starting `**`, which `validate-adapters`' `isProseLine` excludes from the 200-word paragraph cap (verified against the current file: 199 words, lint PASS today) — so the extension cannot trip the paragraph lint. Keep it terse anyway per the authoring standard. New prose states the rule forward, no new ticket citations beyond the existing paragraph's anchors.

**Dispatch clause (defence in depth).** Both executors stamp one sentence into every `BuildDispatch` prompt (extend the existing dispatch paragraphs in place — sequential step 2, parallel worktree-isolation section): *"Foreground-to-terminal: run every gate/test/review step in the foreground; never end your turn without returning the TerminalToken per issue (or the sanctioned retry-later hold)."* Keep the wording to one sentence and not byte-identical prose blocks across the two files beyond that sentence — the 6-line dedup lint tolerates single shared lines, never copied blocks.

**Fence widening.** Implement the Monitor arm in `matchesBackgroundedGate` per the WHAT pseudocode; extend `backgroundFenceDecision` (no change needed — it already forwards `tool_name`/`tool_input.command`; `run_in_background` is simply absent on Monitor events and unused by that arm). Extend `BACKGROUND_FENCE_SELFTEST_CASES`:

- deny: `["Monitor node --test → deny", "Monitor", "node --test", undefined, true]`, plus at least `pytest` and the quoted-ladder `"$faff" gates run` shapes under Monitor
- allow: a Monitor poll-loop command (the parallel executor's await-all shape), a Monitor `tail -f` log watch, and `["Read", "node --test", …] → allow` unchanged
- event-shape cases: a well-formed Monitor deny event; a Monitor event with `ws` and no `command` → allow (fail-safe)

**Hooks-ensure.** Add the Monitor matcher group per WHAT; extend `hooks-ensure`'s own selftest/plan fixtures to pin the two-group structure and idempotent re-runs.

**Edge cases:**

- Monitor event with absent/empty/non-string `command` (including `ws`-mode) → allow (fail-safe, mirrors existing shape handling).
- Existing installs whose settings.json already has the Bash group → the Monitor group is added idempotently; re-run adds nothing twice.
- The parallel executor's own Monitor usage (poll loops on on-disk state) never matches the gate family → never denied. If a repo's poll command ever embeds a gate-family token (e.g. polling by re-running `npm test`), the deny is correct — the posture says poll on-disk state, not re-run gates.

**Failure modes:**

- **The failure:** the discipline is prose + prompt-injection for the review/Agent path, and models under long contexts drop instructions — stalls may recur at a lower rate. **How you'd know:** beep-boop run ledgers still showing orchestrator SendMessage-resumes / heartbeat-staleness recoveries per run. **What it means:** proceed but narrow — the next escalation is orchestrator-side auto-resume (out of scope here, named above), not more prose.
- **The failure:** the Monitor matcher group breaks a legitimate Monitor use we didn't foresee. **How you'd know:** a fence deny on a non-gate Monitor command in a run log. **What it means:** the gate-family regex over-matched — fix the pattern, not the arm; the selftest's allow cases are the regression net.

**Anti-pattern:** adding `faff-graft` to `SKILL_LINE_CAP_OVERRIDE` to make room. Why: the override list exists for structural hubs (gateway, beep-boop); widening it for a contract tweak erodes the cap for every future edit.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the background-fence hook is registered with the Monitor matcher group
When a build subagent issues Monitor with command "node --test --watch tests/"
Then the PreToolUse hook denies (exit 2) with a message naming the foreground-Bash remedy
```

```
Given the parallel executor's await-all poll loop
When it issues Monitor with an until-loop command polling .faff/runs/<run-id> on-disk state
Then the fence allows (exit 0) — the orchestrator's deliberate posture is untouched
```

```
Given a faff-graft/SKILL.md missing the phrase "foreground-to-terminal"
When `faff validate-adapters` runs
Then it FAILs faff-graft naming the missing third anchor
```

- Assertion: `plugin/skills/faff-graft/SKILL.md` stays ≤ 600 lines and `faff validate-adapters` passes after the prose edits.
- Assertion: a backgrounded Bash `node --test` is still denied and a foreground Bash `node --test` still allowed — the existing selftest table passes unmodified except for additions.

## 6. DESIGN DECISION RATIONALE

**Where does the foreground-to-terminal discipline land?** Options: (a) extend the existing line-274 foreground-posture paragraph + the Return-values line, in place; (b) a new graft section (costs lines the file doesn't have); (c) executor-prompt-only (leaves graft's own contract silent — the same gap that let the Bash-only fix miss this). **Chosen:** (a) — the line-274 paragraph is the established home of exactly this posture, an in-place extension adds zero lines against the 599/600 cap (verified: markdown paragraphs are single source lines, and `**`-led lines are exempt from the paragraph-word lint), and the Return-values line already defines the token the discipline protects.

**Do the executors' BuildDispatch prompts also carry the clause?** Options: rely on graft prose alone (instruction-following decays over a 600-line skill plus a long build) vs inject a one-sentence clause at dispatch time. **Chosen:** inject in both executors — defence in depth is the established pattern here (prose + lint + hook), the cost is one sentence per file with no line-cap pressure (47- and 86-line files), and the dispatch prompt is the highest-salience surface a subagent sees.

**Does background-fence widen, and how far?** Options: (a) stay Bash-only, prose for everything else; (b) widen to Monitor gate-family; (c) also deny backgrounded Agent-tool calls. **Chosen:** (b) — Monitor-with-a-gate-command is mechanically distinguishable (Monitor's `tool_input` carries `command`; Claude Code PreToolUse matchers key on tool name, so a second `matcher: "Monitor"` group routes events without touching the Bash group or merge-fence) and is never legitimate under the posture, while (c) is rejected because the hook cannot tell a build subagent's Agent call from the orchestrator's deliberate backgrounded dispatch — a deny would break `faffter-dark-concurrency-parallel`. The Step-9 review path (Skill tool, inline) has no background flag to fence; it is covered by the prose/clause layers.

**How is the change held testable?** Options: prose-only trust vs lint + selftest pins. **Chosen:** three pins — the `foreground-to-terminal` anchor pinned in both lints (the graft check's third required phrase and the mechanism-slot dispatch-clause assertion — one shared distinctive phrase, two lint sites), and Monitor deny/allow cases in `background-fence --selftest` plus two-group cases in hooks-ensure's fixtures — each substring/table check is cheap, CI-gated, and matches the existing honesty caveat (asserts presence, not runtime obedience).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** the Claude Code harness emits PreToolUse events for the Monitor tool with the command under `tool_input.command`, and settings.json matchers accept `"Monitor"` as a tool-name matcher. Validation: the Monitor tool schema carries a top-level `command` parameter, and Claude Code hook matchers are documented tool-name matchers; first build step: capture one real Monitor PreToolUse event as a checked fixture before widening the fence. If the shape differs, the arm fail-safes to allow and the prose/clause layers still stand — the fence widening degrades gracefully, it never blocks wrongly.

## 8. DONE — Definition of Done

### From WHY / prose contract
- [ ] `faff-graft/SKILL.md` line-274 paragraph governs Steps 7–9b and states the foreground-to-terminal turn rule (terminal token or retry-later hold — never a progress report); Return-values section states the token is the only sanctioned turn end. File ≤ 600 lines.
- [ ] Both executor SKILL.md files stamp the one-sentence foreground-to-terminal clause into the BuildDispatch prompt; the parallel executor's background dispatch + await-all gate prose is byte-unchanged apart from that clause.

### From WHAT (fence + registration)
- [ ] `matchesBackgroundedGate` denies `("Monitor", <gate-family command>)` regardless of `run_in_background`; all existing Bash behaviour unchanged (existing selftest cases pass unmodified).
- [ ] `hooks-ensure` registers a second PreToolUse group `{ matcher: "Monitor", hooks: [background-fence] }`; idempotent on re-run; existing Bash group (both fences) untouched; merge-fence receives no Monitor events.
- [ ] The deny message for the Monitor arm names the foreground-Bash remedy.

### From HOW (lint + tests)
- [ ] `validate-adapters` FAILs `faff-graft` when any of the three anchors (`run_in_background: true`, `never end a turn`, `foreground-to-terminal`) is missing, and FAILs a mechanism-slot executor missing `foreground-to-terminal`.
- [ ] `faff background-fence --selftest` covers: Monitor deny cases (≥3 gate-family shapes incl. the quoted-ladder form), Monitor allow cases (poll loop, log tail, absent/ws command), and a Monitor event-shape case — all passing.
- [ ] `hooks-ensure`'s selftest/plan fixtures pin the two-group PreToolUse structure.
- [ ] `faff validate-adapters` passes repo-wide after all prose edits (line cap, paragraph cap, dedup, stray markers).
- [ ] Live-path check: with the hooked settings root active, one real Monitor tool call carrying a gate-family command is observed to reach the fence and be denied (distinguishes 'fence works' from 'fence never fires' if the harness event shape differs).

**Integration smoke test:**

```
1. Run `faff hooks-ensure` in a scratch settings root → settings.json has Bash group (2 fences) + Monitor group (background-fence).
2. Pipe a PreToolUse event {tool_name:"Monitor", tool_input:{command:"node --test"}} to `faff background-fence --hook` → exit 2, remedy message.
3. Pipe {tool_name:"Monitor", tool_input:{command:"until test -f done; do :; done"}} → exit 0.
4. Run `faff validate-adapters` → PASS, with faff-graft carrying all three anchors.
```

confidence: high

spec-review: approve
