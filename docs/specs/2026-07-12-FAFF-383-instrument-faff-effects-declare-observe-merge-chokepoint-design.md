# Spec — FAFF-383: Instrument `faff effects declare`/`observe` at the graft merge chokepoint

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-383.

This spec covers the producer half of the effects→sentry bridge: making faff's one mechanically-mediated side-effect chokepoint — the `faff merge-gate` merge path — declare and observe its effects into the run-scoped `declared-effects.jsonl`, so `faff effects check` computes real declared-vs-observed pairs instead of reading an always-empty ledger. Audience: the build agent and human reviewers.

## 1. WHY — Problem and Principles

**The load-bearing model:** the shipped effects ledger (`faff effects declare | observe | check`) detects an *escaped* side-effect as observed-minus-declared per `(issue, step)` — a **declare** attests the orchestrated flow's intent *before* acting, an **observe** attests what mechanically happened, and any observe with no covering declare is an escape signal the sentry kill-switch will consume. The two halves must come from *different authorities* for the signal to mean anything: intent from the orchestrating step (graft's merge step), observation from the mechanical actor (`faff merge-gate`, the sole sanctioned `gh pr merge` path, which executes the merge itself via a spawned child).

**Problem statement:** `faff effects declare`/`observe` shipped (the FAFF-106 substrate) and `faff effects check` computes escapes — but no pipeline step writes the ledger, so `any_escape` can never be true even on a real escaped effect, and the sentry bridge FAFF-352 specs (its `--forbidden-side-effect` flag; Todo at the time of writing, not yet built) would arm against a permanently-empty signal source. This change populates the ledger at the merge chokepoint with real declare/observe pairs, verifiable today via `faff effects check` alone.

**Design principles:**

- **Observation must be mechanical.** An observe is written only by code that performed or directly witnessed the effect (`merge-gate`'s execute path). Never add a prose-side "observe" that has the model report on its own action — a self-reported observation adds no integrity and is rejected in review.
- **Declares attest intent from outside the actor.** The declare is written by the orchestrating graft step *before* invoking the merge path, not by `merge-gate` itself. A chokepoint that declares-and-observes in one breath can never raise an escape — the pairing would be vacuous.
- **Instrumentation is observability, never a gate.** No ledger read or write may change `merge-gate`'s verdict, exit code, or whether the merge executes. Detection-only is the producer contract (FAFF-106); abort authority stays with sentry under FAFF-352.
- **Producer-side only.** No change to `sentry.js`, no `sentry check` invocation, no beep-boop checkpoint edit — the consumer wiring is FAFF-352's and stays untouched.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/effects.js` | Node | The shipped ledger: `EFFECT_KINDS`, `effectDescriptorViolations`, `normEffect`, `computeEscapes`, `cmdEffects`; grows a shared append helper |
| `plugin/skills/faff/bin/lib/merge-gate.js` | Node | The observe chokepoint: `cmdMergeGate` execute path (spawned `gh pr merge` ~line 369; clean-success tail; `classifyPostMerge` merged-with-warning path; already-merged no-op ~336; `--check-only` returns before the spawn) |
| `plugin/skills/faff-graft/SKILL.md` | prose | The declare site: Step 10 merge-confidence gate (~403–446), immediately before the ship handoff |
| `docs/guide/cli.md` | prose | `merge-gate` (~row 39) and `effects` (~row 85) rows updated same PR |
| `test/effects.test.mjs`, `test/merge-gate.test.mjs`, `test/merge-gate-controlflow.test.mjs` | node:test | House pattern: pure cores + `--selftest` + runCli with a stubbed `gh` |

**Scope statement:** this is the producer slice of the T3 supervision stream — it feeds the bridge FAFF-352 consumes; between them the escaped-side-effect guardrail becomes end-to-end real.

## 2. OUT OF SCOPE

- **Tracker-write / label-write instrumentation** — the ticket asks to weigh these; excluded. Why: those writes are agent-performed MCP calls with no faff-CLI mediation (`faff label` emits a pure descriptor; the agent does the write), so the only possible "observe" is model self-report, which the mechanical-observation principle rejects. Extension point: a future slice can pair the `faff label` descriptor op with a mechanical observe once a CLI-mediated tracker write path exists.
- **Local housekeeping effects** (worktree removal, local branch delete) — excluded. Why: local, revert-invisible, inside the PR/worktree envelope the ledger exists to guard the *outside* of. Extension point: `faff worktree-prune` could observe `file-write`/`other` effects if ever wanted.
- **Consumer wiring** (`sentry check --forbidden-side-effect`, checkpoint consult, `sentry-checkpoint` event, audit supervision block) — FAFF-352's, untouched here. Extension point: FAFF-352's spec on its tracker thread.
- **New `EFFECT_KINDS`** — excluded; `merge` and `branch-delete` already exist in the closed vocabulary. Extension point: the `EFFECT_KINDS` set in `effects.js` (note FAFF-362 may later lift it into a declared vocabulary table).
- **Other merge paths** — there are none by construction: `merge-fence` denies raw `gh pr merge` Bash calls and `merge-gate` is the sole sanctioned path (FAFF-350/434), which is exactly why one chokepoint suffices.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Merge chokepoint | The `(issue, step="merge")` ledger key covering one PR's merge through `faff merge-gate --execute` |
| Covering declaration | A `declare` entry with the same issue, step, kind, and an exact or `*` target match, per `computeEscapes` |
| Escape | An observe with no covering declaration — `faff effects check` emits it; nothing in this slice acts on it |

**Ledger targets (fixed formats — both sides must derive them identically):**

```
kind "merge"          target: "pr:<PR-number>"      # from --pr / the PR number graft passes down
kind "branch-delete"  target: "<head-branch-name>"  # the PR head ref name
reversible: true on both                            # revert / branch-restore exist
```

**New shared helper (exported from `effects.js`):**

```
FUNCTION appendEffectEntries(runDirAbsPath, kind_of_entry, issue, step, effects[], ts?):
  # the single ledger writer — cmdEffects (declare/observe) and merge-gate both call it
  validates every descriptor (effectDescriptorViolations) before writing any (all-or-nothing)
  seq from eventLineCount(ledgerPath); appends schema-1 records identical to today's cmdEffects
  run_id := basename(runDirAbsPath)
  RETURNS { written[] } or { violations[] }
```

**Merge-gate PR-view field addition:** the identity fetch grows `headRefName` (`gh pr view --json headRefOid,headRefName,state,url`) so the branch-delete observe target is derivable mechanically.

**Design decisions:** collected with rationale in section 6; each concludes with a canonical marker there.

## 4. HOW — Behavior

### 4.1 Declare — graft Step 10 (prose edit, `plugin/skills/faff-graft/SKILL.md`)

One addition inside the Step-10 merge block, **immediately before the ship handoff** (same paragraph that constructs `--pr`/`--issue`/`--run-dir`/`--level`), in both modes:

```
PROCEDURE declare_merge_effects(run_dir, issue, pr, merge_args):
  1. effects := [ { kind: "merge", target: "pr:" + pr, reversible: true } ]
  2. IF "--delete-branch" in merge_args:
       append { kind: "branch-delete", target: <head-branch-name>, reversible: true }
  3. Pipe effects (JSON array) to:
       faff effects declare --run "$(basename "$run_dir")" --issue <ISSUE> --step merge
  4. On non-zero exit: log loudly to the graft log and PROCEED to the ship handoff
     (observability never gates the merge; see Failure modes for the consequence)
```

The declare rides the same canonical prose block the merge-gate command is built in, so the two cannot drift apart silently. No declare is emitted on paths that never reach the ship handoff.

### 4.2 Observe — `merge-gate.js` execute path (mechanical)

**Behavior summary:** after this invocation's `gh pr merge` is confirmed to have landed, merge-gate appends the observe records for what it actually did, and warns (never refuses) if no covering declaration exists.

```
PROCEDURE observe_merge_effects(runDir, issue, pr, parsedFlags, mergeOutcome):
  # called at exactly two points, both after the spawned merge:
  #   (a) the clean-success tail (m.status === 0)
  #   (b) the classifyPostMerge outcome === "merged" path (merge landed, post-merge step failed)
  1. effects := [ { kind: "merge", target: "pr:" + pr, reversible: true } ]
  2. IF path (a) AND "--delete-branch" in parsedFlags:
       append { kind: "branch-delete", target: headRefName, reversible: true }
     # on path (b) the post-merge step's success is unconfirmed — observe the merge only
  3. read declared-effects.jsonl; for each effect with no covering declaration
     (same issue, step "merge", kind, exact-or-* target):
       stderr: "merge-gate: observed <kind> <target> with no covering declaration — declare it at graft Step 10 (faff effects declare --step merge); this will read as an escaped side-effect"
  4. appendEffectEntries(runDir, "observe", issue, "merge", effects)
  5. ANY failure in 3–4 (unreadable ledger, append error): one stderr warning, then continue —
     the verdict, exit code, and emitted JSON are already decided and never change
```

**No writes anywhere else:** `--check-only` (returns before the spawn), a `refuse` verdict, the already-`MERGED` idempotent no-op (this invocation performed nothing), and every exit-2 fail-loud path all touch the ledger not at all.

**`--merge-args "--auto"`:** enablement is not a merge — no observe at enablement; the eventual forge-side merge is out-of-band (Option A honestly: out-of-band effects are the container's job). The graft declare stays; declared-without-observed is a clean ledger state.

### 4.3 Edge cases and error handling

- **Run dir missing at declare:** `faff effects declare` already exits 3; graft logs and proceeds (the merge doesn't wait).
- **Ledger file absent at observe:** `appendEffectEntries` creates it (append semantics, as `cmdEffects` does today); the coverage read treats absent as "no declarations" → warning fires.
- **Human-override fall-through** (`--interactive --human-override` past a refused floor): reaches the same spawn and success paths → observed identically. A human terminal merge is still a faff-mediated merge; its observation is wanted.
- **Duplicate invocations:** a second merge-gate call on a merged PR hits the already-MERGED no-op → no duplicate observe.
- **`cmdEffects` refactor safety:** `declare`/`observe` CLI behaviour (exit codes 0/1/2/3, record shape, seq, stdout echo) is byte-compatible after the helper extraction — existing `test/effects.test.mjs` and the selftest pin it.

### 4.4 Failure modes

- **The failure:** graft prose omits or fails the declare while merge-gate observes — a false "escape" for a perfectly orchestrated merge; once FAFF-352 lands, at L4 the append-only ledger latches that escape into an abort at every subsequent checkpoint. **How you'd know:** the step-3 stderr warning at merge time, and `faff effects check` reporting an escape naming `(issue, merge)`. **What it means:** proceed — the warning makes the omission visible at the moment it happens (not discovered as a latched abort later), the declare lives in the same prose block as the command construction, and post-352 a sentry trip on an unprovenance'd merge is arguably the guardrail working, not a defect. If calibration shows recurring false escapes, the follow-up is making the declare mechanical too — not removing the observe.
- **The failure:** the escape signal never fires in practice because declare and observe both always ride the same orchestrated flow — detection value ≈ audit-trail only until a second, unorchestrated path exists. **How you'd know:** `effects check` across many runs shows pairs but never an escape. **What it means:** proceed — populated pairs are this ticket's stated value (the bridge's signal source), and the tripwire's real quarry is exactly the unorchestrated merge-gate call (wrong issue id, replayed command, a peer's confusion) that can't be staged on demand.

**Anti-pattern:** having merge-gate write the declare "for safety" when none exists. Why: it converts the tripwire into a self-attestation and no escape can ever fire from this chokepoint again.

**Anti-pattern:** refusing the merge on a missing declaration. Why: that makes the ledger a merge precondition — consumer-grade authority this producer slice must not take (abort authority is sentry's, at L4, via FAFF-352).

## 5. Scenarios

```
Given an initialised run dir and a declare (merge, pr:N) at --step merge for ISSUE-X
When `faff merge-gate --pr N --issue ISSUE-X --run-dir <dir> --execute` merges the PR
Then declared-effects.jsonl carries the observe (merge, pr:N)
  and `faff effects check --run <id> --json` reports any_escape: false with the pair present
```

```
Given an initialised run dir with NO declarations
When merge-gate --execute merges PR N for ISSUE-X
Then the merge still lands with verdict merge-ok and exit 0
  and one stderr warning names the uncovered observe
  and `faff effects check --run <id> --json` reports any_escape: true
      with an escape { issue: ISSUE-X, step: "merge", escaped: [ { kind: "merge", target: "pr:N" } ] }
```

```
Given a covering declare including branch-delete and --merge-args "--squash --delete-branch"
When the merge succeeds cleanly (gh exit 0)
Then observes for both merge (pr:N) and branch-delete (<head-branch>) are appended and check is clean
```

```
Given the same flags but gh exits non-zero while the PR re-reads as MERGED (post-merge step failed)
When classifyPostMerge concludes "merged"
Then only the merge observe is appended (no branch-delete observe)
```

Assertion: `--check-only`, a `refuse` exit, and the already-MERGED no-op write zero ledger entries.
Assertion: no code path lets a ledger read/write alter merge-gate's verdict, exit code, or JSON result shape (beyond the documented stderr warnings).
Assertion: `sentry.js` and `plugin/skills/faff-beep-boop/SKILL.md` are untouched by this diff.

## 6. Design Decision Rationale

**Which chokepoints in v1?** Options: merge only; merge + tracker/label writes; merge + housekeeping. Tracker/label writes have no mechanical witness (agent MCP writes; the `faff label` op is pure) so their observe would be self-report; local housekeeping is inside the envelope. The merge is the one effect that is real, external, and mechanically mediated — and merge-gate's sole-path status (FAFF-350, fence FAFF-434) means one chokepoint covers every sanctioned merge.
**Chosen:** the merge chokepoint only — declare at graft Step 10, observe in merge-gate; everything else is a named extension point.

**Where does the declare live — graft prose, the ship producer, or merge-gate itself?** Merge-gate self-declaring is vacuous (see anti-pattern). The ship producer is swappable — a declare there vanishes when the slot is swapped. Graft Step 10 is the non-delegable integrity-floor locus that survives any ship occupant and already constructs the merge-gate parameters the declare needs.
**Chosen:** graft Step 10 prose, immediately before the ship handoff, both modes.

**Uncovered observe: warn or refuse?** Refusing makes the ledger a merge gate — consumer authority this slice must not take, and it would brick merges on instrumentation gaps. Warning keeps detection-only semantics while making a missed declare visible at merge time instead of at a later latched sentry abort.
**Chosen:** one loud stderr warning per uncovered effect; verdict/exit unchanged.

**Observe implementation: shell out to `faff effects observe` or same-process append?** merge-gate spawning its own CLI re-enters argv parsing and stdin plumbing for no gain; both modules live in `bin/lib`.
**Chosen:** extract `appendEffectEntries` from `cmdEffects` into a shared exported helper; `cmdEffects` and merge-gate both call it (CLI behaviour byte-compatible).

**Target format for the merge effect?** `"main"` (the base) collides across PRs and isn't what the declare-side knows most reliably; the PR number is unambiguous, identical on both sides (`--pr`), and stable.
**Chosen:** `pr:<number>` for `merge`; the head branch name for `branch-delete` (merge-gate adds `headRefName` to its PR-view fields).

**`--auto`, already-merged, and merged-with-warning paths?** Observe must assert what *this invocation actually did*.
**Chosen:** observe only on this invocation's confirmed merge (clean tail, or `classifyPostMerge` = merged with merge-only observe); no observe at `--auto` enablement or on the already-MERGED no-op.

**New effect kinds?** `merge` and `branch-delete` already exist.
**Chosen:** no `EFFECT_KINDS` change.

## 7. Open Questions and Assumptions

**Open Questions:** none — the ticket's two decide-items (which chokepoints, which kinds) are closed above.

**Assumptions:**

- **Assumes:** an initialised run dir (`.faff/runs/<run-id>/`) exists whenever graft Step 10 runs — merge-gate already hard-requires `--run-dir` and reads floor artifacts from it in both modes. Validation before build: confirm graft Step 10's interactive path passes a real `--run-dir` (it does — the printed human-terminal command carries one); if any interactive entry lacks a run dir, the declare's exit-3 tolerance (log-and-proceed) already covers it.

## 8. DONE — Definition of Done

### From WHAT (ledger surfaces)
- [ ] `appendEffectEntries` exported from `effects.js`; `faff effects declare|observe` exit codes (0/1/2/3), record shape, seq, and stdout echo unchanged (existing tests green)
- [ ] merge-gate PR-view fetch includes `headRefName`; targets emitted exactly as `pr:<n>` / head-branch-name

### From HOW (declare)
- [ ] graft SKILL.md Step 10 carries the declare block (merge always; branch-delete iff `--delete-branch`), before the ship handoff, both modes; failure = log-and-proceed
- [ ] `faff validate-adapters` passes on the edited SKILL.md

### From HOW (observe)
- [ ] Clean-success merge appends the merge observe (+ branch-delete iff flag present); `classifyPostMerge` merged path appends merge only
- [ ] `--check-only`, `refuse`, already-MERGED, and exit-2 paths write zero ledger entries (test-asserted)
- [ ] Uncovered observe → one stderr warning per effect; verdict, exit code, and JSON output unchanged (test-asserted)
- [ ] Ledger read/append failure never changes the merge outcome (test-asserted via unwritable ledger fixture)

### From Scenarios (end-to-end producer proof)
- [ ] Integration test: declared pair → merged (stubbed `gh`) → `faff effects check --json` reports `any_escape: false` with the pair
- [ ] Integration test: no declaration → merged → `effects check` reports the escape naming `(issue, "merge", kind merge, pr:<n>)`

### From OUT OF SCOPE (containment)
- [ ] `sentry.js`, beep-boop SKILL.md, and both concurrency executor SKILL.mds untouched

### Docs and tests
- [ ] `docs/guide/cli.md`: merge-gate row notes the observe + warning; effects row notes merge-gate as the first mechanical producer
- [ ] `faff effects --selftest` extended for the shared helper; `faff merge-gate --selftest` extended for observe/warning gating; `node --test` green

**Integration smoke test:**

```
1. Init a run dir; declare (merge, pr:7) for FAFF-T --step merge
2. Stub gh (view → OPEN/headRefOid/headRefName; merge → exit 0); seed floor artifacts to pass
3. faff merge-gate --pr 7 --issue FAFF-T --run-dir <dir> --execute --merge-args "--squash"
                                    → merge-ok, exit 0, no warning
4. declared-effects.jsonl           → declare + observe pair for (FAFF-T, merge)
5. faff effects check --run <id> --json → any_escape: false
6. Repeat 2–3 in a fresh run dir with no declare → warning on stderr; effects check → any_escape: true
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? (principle 4)** — No issues. Two modules, one prose block, tests and docs: a single 1–3 day unit. The tracker/label-write cut is principled (no mechanical witness exists), not scope-dodging — the extension point is named and the mechanical-observation principle gives the future slice its acceptance bar.

**Workstream fit? (principles 1 + 5)** — No issues. FAFF-383 sits in **T3 — supervision stands alone** alongside FAFF-352; producer and consumer halves of one guardrail in one outcome-named project is exactly right.

**Deps surfaced? (principle 6)** — One finding, one all-clear:

1. **The ticket's premise overstates FAFF-352's state.** The description reads as if FAFF-352 shipped the consumer half; at prep time FAFF-352 is **Todo** — spec'd, approved, not built, and not automation-eligible (no `faff-automate`), so it will not land in an unattended run until a human cranks it up. This does not block FAFF-383 (the producer half verifies standalone via `faff effects check`, and either landing order works), but the *bridge* is only demonstrable end-to-end once 352 builds. What to do: a human who wants the guardrail live should crank up FAFF-352 in the tracker; no blocker edge is needed in either direction — suggested relation only (already `related-to`).
2. **FAFF-362 (governance vocabulary tables) checked** — it may later lift `EFFECT_KINDS` into a declared profile table; this spec adds no kinds, so no collision. Related-to worth considering; not a blocker.

**Risk profile? (principle 7)** — No spike needed. Pure-local instrumentation of shipped modules under house test patterns; the one genuine design risk (a missed prose declare becoming a latched L4 abort once 352 lands) is carried as a named failure mode with a merge-time warning as the mitigation and a stated calibration follow-up (mechanise the declare) if it recurs.

confidence: high

spec-review: approve

---

*Note: FAFF-352 and FAFF-325 (which added an integrity leg to merge-gate.js) merged to `main` before this build started. The worktree was rebased on current `main`, and the line anchors above (e.g. "~line 369") are pre-325 approximations — the build verified the actual post-325 shipped surface directly rather than trusting the stale line numbers. No behavioural collision: FAFF-325's integrity leg and this ticket's declare/observe instrumentation touch disjoint code paths within `cmdMergeGate`.*
