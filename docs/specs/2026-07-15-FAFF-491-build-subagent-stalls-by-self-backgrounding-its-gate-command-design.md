# FAFF-491 — Forbid + guard build-subagent self-backgrounding of gate commands

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-491.

This spec addresses FAFF-491 (bug/hardening): a build/graft subagent runs its gate command (`node --test` via the Step 7.5 ladder) with `run_in_background: true`, ends its turn with the job in flight, and the session idles mid-build — no terminal token, branch unpushed, no PR. Two live occurrences on 2026-07-14 (FAFF-466, FAFF-446 builds). Audience: the build agent implementing the fix, and human reviewers weighing the mechanical half.

## 1. WHY — Problem and Principles

**The load-bearing model:** a turn that ends with a background Bash job in flight does not resume when the job finishes — the subagent simply stops, and nothing upstream restarts it until heartbeat staleness (900s, `runcheck.js`) flags the run and a human/ground-truth recovery intervenes. Prevention therefore has to live at the *subagent's own tool-call boundary* — the moment the backgrounded gate command is issued — because that is the last point where the stall is still avoidable. Everything downstream (heartbeat, Sentry, FAFF-402 resume) is detection and recovery, which already works.

**Problem statement.** The graft build phase (Steps 7–8) carries no prohibition on backgrounding its own gate/test commands — the only "no background" prose is Step 11's CI-wait, post-PR (`plugin/skills/faff-graft/SKILL.md:476-491`). Twice in one day a build subagent self-backgrounded its gate run and idled mid-build. This change forbids the pattern in prose at the point of failure, lints the prose into permanence, and adds a mechanical PreToolUse fence if (and only if) the hook event actually exposes the backgrounding flag.

**Design principles:**

- **Deterministic tools over prose** — prose alone is the thing that already failed twice; every layer that *can* be mechanical (the lint, the fence) must be. But the mechanical fence is gated on a feasibility probe, never assumed.
- **Never block what isn't the failure mode** — the fence must not deny legitimate background use (a dev server for live AC exercise, a Monitor loop, interactive human sessions doing unrelated work). Narrow beats broad; the merge-fence "outermost guard-rail against the naive/literal form, never the security boundary" stance (`merge-fence.js:25-32`) applies verbatim.
- **Fail-safe hooks** — a PreToolUse hook that errors or can't parse its event must exit 0 (never block a session on the guard's own tooling), exactly per merge-fence (`merge-fence.js:73-76`).

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-fence.js` | JavaScript | The PreToolUse Bash-deny precedent this fence clones (pure matcher + `--hook` stdin shell + `--selftest`) |
| `plugin/skills/faff/bin/lib/hooks-ensure.js` | JavaScript | Hook registrar; `FAFF_PRE_TOOL_USE_HOOKS` (L23) is where the new fence registers |
| `plugin/skills/faff-graft/SKILL.md` | Markdown | Steps 7–8b (L246–332) get the prose rule; Step 11 (L476–491) is the existing post-PR analogue |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript | FAFF-439 turn-safe-posture lint (L203–209) — the pattern the graft-surface lint extends |
| `plugin/skills/faff/bin/lib/heartbeat.js`, `runcheck.js` | JavaScript | Existing detection layer (900s staleness) — unchanged, relied on |

**Scope statement.** This sits in graft's build phase (Steps 7–8b) and the shared hook/lint plumbing; it is the prevention counterpart to the FAFF-402/403 resume checkpoints and stays upstream of the FAFF-329 review checkpoint.

## 2. OUT OF SCOPE

- **Earlier gate-start checkpoint (candidate c)** — Why excluded: a checkpoint doesn't prevent the stall, it only re-grades recovery, and FAFF-402's no-checkpoint→rebuild arm is already safe; adding a pre-gate ledger write buys little. Extension point: `faff build-progress` (`bin/lib/effects.js`) + graft Step 7.5 entry, if recurrence data later shows rebuild cost matters.
- **Orchestrator watchdog / live-subagent supervision** — Why excluded: FAFF-329 explicitly punted TaskStop-based supervision to Sentry (FAFF-49); the orchestrator cannot see a subagent's own Bash jobs anyway. Extension point: `bin/lib/sentry.js` + the FAFF-49 dispatch boundary.
- **Shell-aware command parsing in the fence** — Why excluded: same deliberate limitation as merge-fence; a regex fence is the outermost guard-rail, not the boundary. Extension point: `matchesBackgroundedGate` in the new `background-fence.js`.
- **Agent-tool dispatch posture** — Why excluded: orchestrator→subagent backgrounding is already governed (gateway `SKILL.md` foreground rule, beep-boop turn-survival invariant, FAFF-439 executor lint). This ticket is the subagent's *own Bash calls* — the uncovered surface.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Self-backgrounding | A subagent issuing its own Bash tool call with `run_in_background: true`, then ending its turn while the job runs |
| Gate-family command | A command whose literal token shape is a test/gate run: `faff gates run`, `node --test`, `npm test` / `npm run test*`, `npx vitest\|jest\|mocha\|ava\|tap`, `make test`, `pytest`, `cargo test`, `go test` |
| The fence | New `faff background-fence` PreToolUse hook — denies a backgrounded gate-family Bash call |

**The three layers (the deliverable):**

**Layer 1 — prose rule in graft.** A bolded build-phase posture rule anchored in Step 7.5 (beside the gate-ladder shell block, `faff-graft/SKILL.md:266-273`), governing Steps 7–8b: every build/gate/test command runs as a **foreground** Bash call — never `run_in_background: true` — and the subagent must **never end a turn with a background job in flight** (mirroring Step 11's "there is no background" language, stated here for the build phase). A run that would exceed the Bash tool's max timeout is chunked or polled foreground across successive calls, never backgrounded; the FAFF-234 heartbeat ticks already bracket the wait, and the 900s staleness window comfortably exceeds any single blocking call.

**Layer 2 — lint.** Extend `faff validate-adapters` with a graft-surface check (FAFF-439 pattern, `validate-adapters.js:203-209`): FAIL unless `faff-graft/SKILL.md` contains, case-insensitive, both substrings `run_in_background: true` and `never end a turn`. Substring-only — asserts the instruction is *present*, not runtime-obeyed (same honesty caveat as FAFF-439). This ships in the existing `faff-*` user-command pass of `cmdValidateAdapters` (L420-430) as a graft-targeted check, gated in CI as today.

**Layer 3 — mechanical fence (probe-gated).** A new `background-fence` subcommand cloned from merge-fence's shape:

```
FUNCTION matchesBackgroundedGate(tool_name, command, run_in_background) -> bool
  1. IF tool_name != "Bash" -> false
  2. IF run_in_background is not the boolean true (strict) -> false   # absent/false/string -> allow
  3. IF command is not a non-empty string -> false
  4. RETURN command matches the gate-family token regex
       (gh-style token sequences; path/env prefixes allowed, per merge-fence's matcher stance)
```

- `--hook`: read PreToolUse JSON on stdin; malformed/empty/closed stdin → exit 0 (never block); match → exit 2 + single-line stderr naming the remedy ("run gates foreground with a generous timeout; never background a gate command" + the human-operator escape hatch, merge-fence FAFF-375 style).
- `--selftest`: a case table pinning deny cases (each gate-family shape, backgrounded), allow cases (foreground gate run; backgrounded non-gate command e.g. `npm run dev`; non-Bash tool; absent/false/non-boolean `run_in_background`; malformed event shapes), and LIMITATION allow-cases (quoted/spliced/substituted spellings — recorded, not defects).
- Wiring: `FAFF_PRE_TOOL_USE_HOOKS = ["merge-fence", "background-fence"]` (`hooks-ensure.js:23` — registrar, probes, and normalization extend by construction since they iterate the list), plus the `regions.js` registry row and main() dispatch, mirroring merge-fence's entries.

**Design decisions (markers):**

- Fix shape — prose alone (failed twice) vs mechanical alone (feasibility unproven) vs layered. **Chosen:** layered — prose rule + lint now, fence probe-gated.
- Guard locus — subagent self-policing at the tool-call boundary vs orchestrator watchdog. **Chosen:** the tool-call boundary; the orchestrator can't see subagent Bash jobs, and detection/recovery (heartbeat + Sentry) already exists and worked in both live occurrences.
- Prose anchor — new standalone section vs anchored at Step 7.5. **Chosen:** anchored at Step 7.5 with explicit Steps 7–8b applicability — the rule lives where both live failures happened, and skimmability outranks a new top-level section.
- Fence scope — blanket deny of all backgrounded Bash vs gate-family-only. **Chosen:** gate-family-only — blanket would deny legitimate background use (dev servers for live AC exercise, interactive sessions repo-wide, since hooks-ensure registers into `.claude/settings.json` for every session); narrow matches the observed failure and the merge-fence outermost-guard-rail stance.
- Fence purity + interactive behaviour — detect "active faff run" via filesystem vs stay stdin-pure and deny in interactive sessions too. **Chosen:** stdin-pure, denies everywhere, with the human-operator escape-hatch line in the message — identical trade to merge-fence, and a backgrounded gate command is an anti-pattern interactively too.
- Lint shape — new adaptor-registry kind vs a targeted check in the existing `faff-*` pass. **Chosen:** targeted check in the existing pass — graft is a user command, not a registry adaptor; FAFF-439's registry hook doesn't reach it.
- Gate-start checkpoint (candidate c) — adopt vs reject. **Chosen:** reject (see OUT OF SCOPE) — prevention, not recovery-granularity, is the gap.

## 4. HOW — Behavior

**Build order (probe first):**

```
PROCEDURE implement_FAFF_491:
  1. PROBE (validates the Assumes, below):
     a. Register a throwaway PreToolUse Bash hook that tees its stdin to a temp file
     b. Issue a Bash tool call with run_in_background: true
     c. Inspect the captured event JSON: does tool_input carry run_in_background?
  2. IF field present:
     a. Build background-fence.js (matcher + --hook shell + --selftest) cloned from merge-fence.js
     b. Add "background-fence" to FAFF_PRE_TOOL_USE_HOOKS; add regions.js row + main() dispatch
     c. Extend hooks-ensure selftest cases for the two-member PreToolUse set
  3. IF field absent:
     a. DESCOPE the fence half; record the probe result in the PR body
     b. File a follow-up ticket for a harness-level guard (the extension point)
  4. EITHER WAY:
     a. Add the Step 7.5 prose rule to faff-graft/SKILL.md
     b. Add the graft-surface lint check to validate-adapters.js (+ its selftest/fixture)
```

**Edge cases (fence):**

- Empty/closed/malformed stdin → exit 0 — never block (merge-fence precedent).
- `run_in_background` absent, `false`, `"true"` (string), or any non-boolean → allow. Strict boolean check: the harness serializes a JSON boolean; anything else is not the failure mode and fail-safe is allow.
- Foreground gate command (`run_in_background` unset) → allow — the fence keys on the *conjunction*, never on the command alone.
- `--root DIR` accepted-and-ignored (probeServes always passes it — `hooks-ensure.js:69-71` comment; a usage error here would misclassify the bin as unserved).

**Error categories:** the fence has exactly two outcomes — exit 0 (allow, including all its own failure modes) and exit 2 + deny message (match). Nothing is retryable; the caller (the harness) sees a denied tool call with the remedy on stderr.

**Failure modes — how the approach falls over, and how you'd notice:**

- **The Assumes fails** (hook event omits `run_in_background`). How you'd know: the step-1 probe's captured JSON lacks the field. What it means: narrow — ship prose + lint, descope the fence, file the follow-up. A null probe result is a valid outcome, not a gap.
- **The narrow matcher misses a spelling** (a repo-declared gate command outside the token family, or a quoted/spliced form). How you'd know: a recurrence — heartbeat-stale run with a background job in the transcript. What it means: proceed + widen the family list (a one-line regex change); never escalate to blanket deny without re-weighing the legitimate-background cost.
- **Prose rule ignored under drift** (the lint only proves presence). How you'd know: recurrence despite the prose being present. What it means: the fence half is the real floor; if it was descoped, re-prioritise the follow-up ticket.

**Anti-pattern:** blanket-denying every `run_in_background: true` Bash call. Why: the hook fires in every session in the repo, including interactive humans and live-exercise dev servers — collateral far beyond the failure mode.

**Anti-pattern:** having graft's prose tell the subagent to "check on the background job later". Why: turns don't resume on their own — the exact Step 11 lesson, now applied to the build phase.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the faff PreToolUse hooks are registered (hooks-ensure has run)
When a Bash tool call carries run_in_background: true and command "node --test"
Then the background-fence denies it (exit 2) and stderr names the foreground remedy
```

```
Given a faff-graft/SKILL.md with the foreground-posture rule removed
When `faff validate-adapters` runs
Then it reports FAIL for faff-graft, naming the missing build-phase posture declaration
```

- The fence's `--selftest` MUST pass with deny, allow, and LIMITATION cases all pinned (fence half only, if built).
- `faff hooks-ensure` on an empty settings file MUST register both PreToolUse fences under one Bash-matcher group, idempotently (fence half only, if built).

## 6. DESIGN DECISION RATIONALE

Collected from §3; rationale summarised:

- **Layered fix** — prose is the cheapest anchor and already has a Step 11 sibling; the lint makes the prose deletion-proof; the fence is the only layer that mechanically stops the tool call, but its feasibility is externally owned — so probe-gate it rather than pick one layer. **Chosen:** layered.
- **Tool-call-boundary guard, not watchdog** — both live occurrences were detected fine (staleness) and recovered fine (SendMessage resume); the missing piece was prevention, which only exists where the call is made. **Chosen:** subagent boundary; Sentry keeps detection.
- **Narrow fence** — merge-fence sets the house precedent: regex over the naive literal form, LIMITATION cases pinned honestly, never a false sense of full coverage. At the time of writing the only observed spellings are `node --test` and the ladder's `"$faff" gates run`. **Chosen:** gate-family-only.
- **Stdin-pure, denies interactively** — a filesystem "is a run active" probe would break the pure-decision shape and add its own failure modes; the escape-hatch message covers the human. **Chosen:** pure + escape hatch.
- **Lint in the `faff-*` pass** — graft isn't in the adaptor REGISTRY; forcing it in would invent a kind for one check. **Chosen:** targeted check.
- **No gate-start checkpoint** — recovery-granularity, not prevention; rejected so the build agent doesn't re-propose it. **Chosen:** reject.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** the PreToolUse hook event's `tool_input` carries the `run_in_background` field for Bash calls. The repo cannot establish this — `merge-fence.js:58` reads only `tool_input.command`, and no fixture/doc in the repo pins any other `tool_input` field. **Validation instruction (build step 1):** register a throwaway PreToolUse hook that captures stdin, issue one backgrounded Bash call, inspect the JSON. Present → build the fence; absent → descope the fence half (prose + lint still ship) and file the follow-up ticket.

## 8. DONE — Definition of Done

### From WHY
- [ ] A build subagent following graft prose has an explicit, build-phase-anchored prohibition on self-backgrounding — the Step 7.5 rule exists and governs Steps 7–8b

### From WHAT (Layer 1 — prose)
- [ ] `faff-graft/SKILL.md` Step 7.5 contains the foreground-posture rule, including the literal substrings `run_in_background: true` and `never end a turn` (the lint's anchors) and the chunk/poll-foreground guidance for over-timeout gate runs

### From WHAT (Layer 2 — lint)
- [ ] `faff validate-adapters` FAILs when `faff-graft/SKILL.md` lacks either anchor substring (case-insensitive), with a check label naming the build-phase posture
- [ ] The check passes on the current (post-Layer-1) tree; CI gating unchanged

### From WHAT/HOW (Layer 3 — fence, conditional on the Assumes validating)
- [ ] Probe result (field present/absent) recorded in the PR body
- [ ] If present: `faff background-fence --selftest` passes — deny cases (all gate-family shapes backgrounded), allow cases (foreground gate, backgrounded non-gate, non-Bash tool, absent/false/non-boolean flag, malformed events), LIMITATION cases pinned
- [ ] If present: `--hook` exits 0 on empty/malformed stdin, exit 2 + remedy message on match
- [ ] If present: `FAFF_PRE_TOOL_USE_HOOKS` includes `background-fence`; `hooks-ensure --selftest` covers the two-member set; `regions.js` row + main() dispatch added
- [ ] If absent: fence descoped, follow-up ticket filed and linked

### From HOW (edge cases)
- [ ] Strict-boolean check: `"true"` (string) and absent both allow
- [ ] `--root` accepted-and-ignored (probeServes compatibility)

**Integration smoke test:**

```
1. In a scratch repo root, run `faff hooks-ensure --json`
2. Assert settings.json's PreToolUse Bash group carries both fences
3. echo '{"tool_name":"Bash","tool_input":{"command":"node --test","run_in_background":true}}' | faff background-fence --hook
   → exit 2, stderr contains "foreground"
4. Same event with "run_in_background" removed → exit 0
5. Run `faff validate-adapters` → faff-graft passes its posture check
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
