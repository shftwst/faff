# FAFF-630 — accept `--execute` in `faff merge-gate`'s argv allowlist

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-630.

This spec addresses FAFF-630: `faff merge-gate --execute` is rejected by the argv parser even though the command's own usage string, `docs/guide/cli.md`, and the faff-graft Step 10 prose all advertise it. Audience: the build agent implementing the fix and human reviewers.

## 1. WHY — problem and principles

**The load-bearing model:** the FAFF-576 fail-closed argv parser accepts exactly the flags a command's `CommandSpec` declares — fail-closed means an *undeclared* flag errors loudly, not that the documented vocabulary shrinks. `faff merge-gate` documents `[--execute|--check-only]` but its `MERGE_GATE_SPEC` declaration omits `--execute`, so the docs and the declaration disagree, and the declaration wins at runtime.

**Problem statement:** the exact execute-mode command that faff-graft Step 10 and the CLI usage string hand to producers and operators exits 2 with `unknown-flag: unknown flag --execute` — and the usage line printed by that very error still advertises `[--execute|--check-only]`. Three build/prep subagents hit this during beep-boop run-20260723-144253 and each worked around it by dropping the flag (execute is the default mode, derived from the absence of `--check-only`). This change registers the flag so the advertised surface parses again.

**Design principles:**

- **Declared vocabulary = advertised vocabulary.** Every flag a command's usage string or operator-facing prose advertises must be declared in its `CommandSpec`. The fix closes the gap on the declaration side, not by un-advertising.
- **No behaviour change beyond parsing.** Execute stays the default mode derived from the absence of `--check-only`; `--execute` is an accepted, explicit way to say the default. The merge floor, CI observation, and verdict logic are untouched.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | JS | `MERGE_GATE_SPEC` (~line 21), the `cmdMergeGate` parse site (~line 731), mode derivation (~line 739), `mergeGateSelftest` |
| `plugin/skills/faff/bin/lib/argv.js` | JS | The shared FAFF-576 parser — already supports arity-0 flags; unchanged |
| `plugin/skills/faff/bin/faff` (usage, ~line 157) | prose | Already advertises `[--execute\|--check-only]` — unchanged |
| `plugin/skills/faff-graft/SKILL.md` Step 10 (~lines 447, 470) | prose | Hands out the `--execute` commands — unchanged |
| `docs/guide/cli.md` (~line 52) | docs | Documents the flag — unchanged |
| `test/merge-gate.test.mjs` | JS | Existing arg-validation coverage — the regression-test home |

**Scope statement:** a parser-declaration fix inside the one merge-gate command (PR path and `--local` branch share the parse site); nothing else in the merge floor moves.

## 2. OUT OF SCOPE

- **Striking `--execute` from the usage strings, cli.md, and graft prose** (the ticket's option b) — rejected; see the decision rationale. No extension point: registering the flag makes the docs correct as they stand.
- **A CLI-wide sweep for other advertised-but-undeclared flags** — FAFF-630 names one command; the general fix is a mechanical usage-string↔`CommandSpec` lint. Extension point: `plugin/skills/faff/bin/lib/lint-cli-doc.js` (today it lints command *presence* in cli.md only) could grow a flag-level pass under a future ticket.
- **Editing historical `docs/specs/*.md` that mention `--execute`** — frozen records of what was built; they are evidence here, not targets.

## 3. WHAT — the flag declaration and mode resolution

The one-line declaration change:

```
MERGE_GATE_SPEC.flags["--execute"] = { arity: 0 }
```

Mode resolution gains an explicit-conflict guard and otherwise keeps today's absence-based derivation:

```
PROCEDURE resolve_mode(parsed_flags):
  1. IF "--execute" present AND "--check-only" present:
     a. Write one stderr line naming the conflict
        ("--execute and --check-only are mutually exclusive")
     b. Exit 2 (fail-loud, before any gh call)
  2. IF "--check-only" present → mode := check-only
  3. ELSE → mode := execute      # --execute present or absent: identical
```

**Chosen:** register `--execute` as an accepted arity-0 flag (the ticket's option a) — see decision rationale.

**Chosen:** `--execute` + `--check-only` together is a loud exit 2, not a silent precedence — see decision rationale.

## 4. HOW — behaviour

- Add `"--execute": { arity: 0 }` to `MERGE_GATE_SPEC` in `plugin/skills/faff/bin/lib/merge-gate.js`. Both the PR path and the `--local` branch flow through the same `parseArgs(args, MERGE_GATE_SPEC)` site, so one declaration covers both.
- Add the mutual-exclusion guard in `cmdMergeGate` after the parse-errors check and before mode derivation. Match the shape of the sibling guard for unrecognised `--merge-args` tokens (one stderr line, `return 2`) rather than inventing a new error format.
- Leave the mode derivation itself absence-based (`--check-only` present → check-only, else execute): `--execute` alone must be byte-identical in behaviour to passing no mode flag.

**Edge cases:**

- `--execute` alone → parses; mode `execute`; output and exit codes identical to today's flagless invocation.
- `--check-only` alone → unchanged.
- Both flags → exit 2 with the mutual-exclusion message, before any `gh` call.
- `--local … --execute` → accepted (same `CommandSpec`).
- `--merge-args "--execute"` → still rejected by the closed `MERGE_FLAG_ALLOW` set (unchanged — `--execute` is a merge-gate flag, not a `gh pr merge` flag).

**Anti-pattern:** tolerating both mode flags with silent check-only precedence. Why: a caller who asked for `--execute` would get exit 0 `merge-ok` from a run that merged nothing — exactly the misreadable-outcome shape the FAFF-365 fix exists to prevent.

## 5. Scenarios

```
Given a run-dir carrying valid floor artifacts for an open PR
When faff merge-gate --pr <n> --issue <ID> --run-dir <DIR> --level L3 --execute --merge-args "--squash --delete-branch" is invoked
Then argv parsing succeeds (no unknown-flag error) and the gate proceeds to floor evaluation exactly as the flagless form does
```

```
Given any merge-gate invocation
When both --execute and --check-only are passed
Then the command exits 2 naming the mutual exclusion, before any gh call
```

(Two scenarios only — the change is mechanical; further scenarios would restate DONE.)

## 6. Design decision rationale

**Register the flag (a) or strike it from the docs (b)?**

- Option (a) — declare `--execute` in `MERGE_GATE_SPEC` as an accepted no-op mode selector. Pros: matches every advertising surface (bin/faff usage, merge-gate's own usageError string, cli.md, two graft Step 10 command templates — one of which humans type into real terminals for the `--allow-no-ci`/`--human-override` flows); honours the FAFF-537 spec's recorded constraint that "an accepted-but-ignored flag like `--execute` must stay tolerated"; `mergeGateSelftest` already passes `--execute` in argv arrays to `resolveMergeFlags`, so the internal expectation exists; frozen historical specs keep making sense. Cons: one more declared flag that does nothing by itself.
- Option (b) — strike `--execute` from bin/faff:157, merge-gate's usageError, cli.md, and graft SKILL.md Step 10. Pros: smaller vocabulary. Cons: edits four-plus live surfaces, breaks the `[--execute|--check-only]` symmetry operators expect, cannot fix the frozen docs/specs or human muscle memory, and contradicts FAFF-537's recorded intent.
- The FAFF-576 spec never mentions `--execute` — the drop was a silent casualty of the migration, not a decision to be preserved.

**Chosen:** (a) register `--execute` as an accepted arity-0 flag. Fail-closed parsing is preserved: the parser still rejects everything undeclared; this puts a documented flag back into the declaration it was accidentally dropped from.

**Both mode flags at once — silent precedence or loud error?**

- Silent precedence (today's derivation: `--check-only` wins) is the zero-code option but lets a caller who asked to execute read exit 0 `merge-ok` off a run that merged nothing.
- Loud exit 2 matches the usage string's `[--execute|--check-only]` exclusivity, the FAFF-576 fail-loud philosophy, and costs one guard plus tests. No existing caller passes both (graft passes `--execute` only).

**Chosen:** loud mutual exclusion, exit 2.

## 7. Open questions and assumptions

**Open questions:** none — the ticket's single open question (register vs strike) is closed above.

**Assumptions:**

- **Assumes:** the shared parser (`bin/lib/argv.js`) handles arity-0 flags without change. Validation: `MERGE_GATE_SPEC` already declares twelve arity-0 flags parsed by the same code path; confirm by reading `parseArgs` before starting (no parser edits expected).

## 8. DONE — definition of done

### From WHY
- [ ] The exact Step 10 invocation `faff merge-gate --pr <n> --issue <ID> --run-dir <DIR> --level L3 --execute --merge-args "--squash --delete-branch"` no longer exits 2 with `unknown-flag`; stderr contains no `unknown flag --execute`.

### From WHAT
- [ ] `MERGE_GATE_SPEC` declares `--execute` with `{ arity: 0 }`.
- [ ] `--execute --check-only` together exits 2 with a message naming the mutual exclusion, before any `gh` call.

### From HOW
- [ ] `--execute` alone is behaviourally identical to the flagless invocation (same mode, same output, same exit codes).
- [ ] The `--local` branch accepts `--execute` (shared parse site — covered by a test or by inspection of the single `parseArgs` call).
- [ ] `--merge-args "--execute"` is still rejected via `MERGE_FLAG_ALLOW` (unchanged behaviour, asserted by the existing selftest cases staying green).

### Tests
- [ ] `test/merge-gate.test.mjs` gains: (1) `--execute` is not rejected as unknown-flag (the parse proceeds to the next failure mode, e.g. missing artifacts — never `unknown-flag`); (2) `--execute --check-only` → exit 2 naming the conflict.
- [ ] Full test suite and `faff merge-gate --selftest` green.

**Integration smoke test:**

```
1. Run: faff merge-gate --pr 1 --issue FAFF-630 --run-dir <empty scratch dir> --level L3 --execute
2. Assert: stderr does NOT contain "unknown flag --execute"
3. Assert: the failure (if any) is a floor/artifact refusal, i.e. parsing got past argv
```

## Already shipped against this surface

Related Done work on this surface — context only; none of it supersedes the premise (the failure reproduces live as of 2026-07-23):

- FAFF-576 — the fail-closed argv parser migration that introduced the regression; its spec never mentions `--execute` (the drop was silent, not decided).
- FAFF-537 — bare merge-method flag handling; its spec recorded that "an accepted-but-ignored flag like `--execute` must stay tolerated".
- FAFF-375 / FAFF-365 / FAFF-366 / FAFF-376 — the merge-gate flag-surface and outcome-classification hardening family; establishes the fail-loud and never-misreadable-outcome conventions this spec follows.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- Right-sized (principle 4): yes — one concern, one source file plus tests, comfortably a single sub-day unit. No split or merge indicated.
- Workstream fit (principles 1 + 5): project-less Backlog bug — consistent with the default-landing rule for captured work; no rehoming warranted for a Low-priority CLI fix.
- Dependencies surfaced (principle 6): the causal link to FAFF-576 is already recorded as a relation; FAFF-576 is Done, so no blocker edge is missing.
- Risk profile (principle 7): mechanical parser-declaration change with existing test scaffolding; no de-risking spike warranted.

No issues.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```