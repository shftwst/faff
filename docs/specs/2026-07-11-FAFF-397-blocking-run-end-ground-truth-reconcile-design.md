# Blocking run-end ground-truth reconcile

> Spec: faffter-dark-nlspec · 2026-07-10 · autonomous · confidence: high. Full spec on Linear FAFF-397.

This spec defines a **blocking run-end integrity gate** that re-reads the live tracker and git at the end of an unattended run and asserts that every outcome the run-ledger claims actually happened in the world. Audience: the build agent implementing it, and human reviewers of the resulting PR.

## 1. WHY — Problem and Principles

**The load-bearing model.** A run-ledger outcome is a *claim* a subagent made about the world (`shipped`, `pr-open`, …). Today nothing at run-end checks those claims against ground truth (the actual git merge state and the actual tracker state). In a lights-out run there is no human eyeballing reality, so a claim that diverges from reality — a `shipped` with no merge, a terminal-state flip on an issue the run never owned — survives to run-end uncaught and the run reports a false green. This gate closes that gap: it is the point where the ledger's *claims* are confronted with *observed reality*, and any divergence is routed to a human instead of silently accepted.

**Problem statement.** `runcheck` proves the ledger is *complete* (`admitted − outcomes = ∅`) and `effects` detects side-effects that escaped a declared envelope — but both are pure, and neither re-reads the live tracker or git to confirm a claimed outcome is *true*. So a phantom merge, a wrongly-mutated sibling terminal state, or a claimed-shipped-but-unmerged PR passes run-end unchallenged. This change promotes ground-truth reconciliation to a hard, blocking run-end gate.

**Design principles.**

- **Deterministic assertion, no model judgement in the gate.** The verdict is a pure function of gathered evidence (recorded ledger outcome vs observed git/tracker fact). The LLM orchestrator *gathers* evidence via its tracker/git access; it never *decides* the verdict. This mirrors `faff merge-gate` (a pure `decideFloor` core behind a thin impure gh/git shell) and the producer-emits / consumer-parses contract shape.
- **Fail-closed, never a silent green.** Any divergence — or any inability to establish ground truth — routes to needs-human. A gate that cannot prove consistency must not pass.
- **`runcheck` stays pure.** `runcheck` is a no-I/O Stop-hook (its purity is a load-bearing invariant — FAFF-205/233/235). Reconciliation needs live tracker + git I/O, so it is a **separate** orchestrator run-end step, not a change to `runcheck`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` (`runcheck` / `auditLedger`) | Node (CommonJS) | Completeness audit + the run-ledger schema (`admitted[]`, `outcomes{}`) the reconcile reads |
| `plugin/skills/faff/bin/faff` (`merge-gate`, `decideFloor`, `classifyHeadShaChecks`) | Node | The pure-core-behind-impure-shell pattern to copy; already observes CI on the PR head sha and refuses head-sha mismatch |
| `plugin/skills/faff/bin/faff` (`effects`, `EFFECT_KINDS`) | Node | Declared-effects ledger; `tracker-write` / `label-write` / `merge` kinds are a reinforcing signal for the sibling-mutation class |
| `plugin/skills/faff-beep-boop/SKILL.md` (Step 10 ship, Step 11 runcheck, holdout step) | Skill prose | The run-end sequence this gate slots into, immediately around `runcheck` |
| `plugin/skills/faff-graft/SKILL.md` (Step 10, floor artifacts) | Skill prose | Where the per-issue merge record is written, alongside `ac-checklist.json` / `review-verdict.json` |

**Scope statement.** This is the L4 integrity gate that sits at run-end in `faff-beep-boop`, between the ship pass and (or beside) `runcheck`, closing the "verify subagent claims vs ground truth" gap for unattended runs.

## 2. OUT OF SCOPE

- **Rollback / recovery execution.** — This gate *detects and escalates* (and may *propose* a revert), it never *performs* recovery. **Why excluded:** recovery of escaped effects is FAFF-37's charter (the recovery half of FAFF-43); a detect-and-escalate gate must not also mutate state. **Extension point:** the divergence result's optional `rollback_proposal` field is what a future FAFF-37 recovery consumer reads.
- **Escaped non-tracker/non-git side-effects** (prod migration, secret rotation, email, registry publish). — **Why excluded:** those are `effects`/FAFF-106's declared-effects envelope, already shipped; this gate reconciles ledger *outcomes* against tracker+git, not the full side-effect surface. **Extension point:** `faff effects check`'s `any_escape` signal already covers them and can be composed into the same run-end disposition.
- **Durable disposition surfacing** (a persisted needs-human tracker label + comment + non-zero runner exit). — **Why excluded:** that surfacing mechanism is FAFF-396 (the headless disposition sink). This gate *emits* a structured divergence result into the existing needs-human/escalate channel; FAFF-396 later enriches how it is surfaced. **Extension point:** the `ReconcileResult` block is the input a FAFF-396 sink consumes.
- **Per-PR merge gating.** — Already owned by `faff merge-gate` at merge time (FAFF-350). **Why excluded:** this gate is the *run-end cross-ledger* re-check, not the per-merge floor. **Extension point:** the per-issue merge record `merge-gate` writes is exactly what this gate re-reads.
- **`runcheck` internals.** — Not modified. **Why excluded:** purity invariant. **Extension point:** the reconcile step runs adjacent to `runcheck` in beep-boop Step 11.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Ground truth | The live tracker state + the live git/forge state at run-end — reality, as opposed to the ledger's recorded claim. |
| Divergence | A ledger claim that ground truth contradicts; the unit this gate flags. |
| Phantom merge | A ledger `shipped` outcome whose PR is not actually merged on the recorded head sha. |
| Unowned-sibling mutation | A terminal-state change on an issue the run did **not** admit but which an admitted issue's spec referenced. |
| Merge record | The per-issue `{pr, head_sha, merged, merged_at}` artifact `merge-gate` writes at a successful merge, so run-end can re-observe git against the exact recorded head sha. |

**Type definitions.**

```
ENUM DivergenceClass:
  phantom-merge            # ledger shipped, PR not merged on recorded head sha
  claimed-shipped-unmerged # ledger shipped, no merge record / PR open (subset of phantom-merge)
  unowned-sibling-mutation # terminal-state change on a non-admitted, spec-referenced sibling

RECORD MergeRecord:                 # written by merge-gate at successful merge (additive artifact)
  pr: Int
  head_sha: String                  # the sha gh pr merge landed (--match-head-commit)
  merged: Bool
  merged_at: Timestamp

RECORD ReconcileInput:              # assembled by the orchestrator, piped to `faff reconcile` on stdin
  level: L1 | L2 | L3 | L4
  shipped[]: {                      # one per ledger outcome == "shipped"
    issue: String
    recorded: MergeRecord | null    # null == no merge record found for a shipped claim
    observed: { pr_merged: Bool, merged_head_sha: String | null }  # from live git/forge
  }
  siblings[]: {                     # spec-referenced issues NOT in admitted[]
    issue: String
    start_state_terminal: Bool      # terminal (Done/Cancelled) at run start?
    end_state_terminal: Bool        # terminal at run end?
    admitted: Bool                  # always false here (they are the non-admitted set)
  }

RECORD Divergence:
  class: DivergenceClass
  issue: String
  detail: String                    # human-readable, e.g. "shipped but PR #291 not merged on a1b2c3d"
  rollback_proposal: String | null  # optional suggested revert; never executed here

RECORD ReconcileResult:
  divergences: Divergence[]
  consistent: Bool                  # divergences.length == 0
  disposition: pass | needs-human | warn   # level-gated (see HOW)
```

**Interface — the new pure verb.**

```
faff reconcile --run-dir DIR --level L1|L2|L3|L4 [--json] [--selftest]
  # reads a ReconcileInput on stdin, emits a faff-contract:run-reconcile block (ReconcileResult)
  # exit 0  consistent            (disposition: pass)
  # exit 1  divergence(s) found   (disposition: needs-human at L4 / warn at ≤L3)
  # exit 2  malformed input / fail-loud
```

**Design decision — where the reconcile logic lives.**

- **Fold into `runcheck`** — cheapest wiring, but breaks `runcheck`'s pure no-I/O Stop-hook invariant and conflates completeness (a pure ledger property) with ground-truth (a live-world property).
- **New `faff reconcile` verb, pure core + orchestrator-gathered evidence** — one more verb, but keeps each gate single-purpose and preserves purity; matches `merge-gate`'s split exactly.

**Chosen:** a new `faff reconcile` verb whose assertion core is pure and whose evidence is gathered by the orchestrator (tracker via MCP, git via the orchestrator's shell) — `runcheck` is untouched.

**Design decision — how the recorded head sha reaches run-end.**

- **New per-issue `merge-record.json`** written by `merge-gate` at merge, re-read at run-end — matches the existing floor-artifact pattern (`ac-checklist.json`, `review-verdict.json`) and needs no ledger schema migration.
- **Extend the ledger `outcomes` value** from a string to an object — richer, but a breaking ledger-schema change that ripples through `auditLedger`, every executor, and `runcheck`.

**Chosen:** the additive per-issue `merge-record.json` under `<run-dir>/<ISSUE>/`, written by `merge-gate` on the merge-ok path (the sha it already resolves for `--match-head-commit`). `outcomes` stays a string map; `runcheck`'s invariant is unchanged.

## 4. HOW — Behavior

**Architecture and approach.** Two halves, mirroring `merge-gate`:

1. **Impure evidence-gathering (orchestrator, `faff-beep-boop` Step 11).** For each `shipped` ledger outcome, read its `merge-record.json` and observe the live forge (`gh pr view <pr> --json state,mergeCommit,…` and/or `git`) to fill `observed`. For sibling detection, diff the run-start snapshot against a run-end live re-read of each spec-referenced non-admitted issue. Assemble `ReconcileInput`, pipe to `faff reconcile`.
2. **Pure assertion (`faff reconcile`).** Compute divergences deterministically; emit `ReconcileResult`; set exit + disposition per level.

**Run-start sibling snapshot.** At run start (queue assembly), the orchestrator already reads each admitted issue's spec. Extract the spec-referenced issue IDs (`<issue id=…>` embeds and `FAFF-NN` mentions) that are **not** in `admitted[]`, and record each one's terminal-vs-non-terminal state to `<run-dir>/sibling-baseline.json`. This is the bounded, deterministic set that matches the observed failure mode ("terminal state on a **sibling issue named in a spec**") — not an unbounded whole-tracker scan.

```
PROCEDURE reconcile_core(input) -> ReconcileResult:
  divergences = []
  1. FOR each s in input.shipped:
     a. IF s.recorded == null OR s.observed.pr_merged == false:
        divergences.push({ class: claimed-shipped-unmerged, issue: s.issue,
                           detail: "shipped claim with no merge on record/forge",
                           rollback_proposal: null })
     b. ELSE IF s.observed.merged_head_sha != s.recorded.head_sha:
        divergences.push({ class: phantom-merge, issue: s.issue,
                           detail: "shipped on <recorded.head_sha> but forge merged <observed.merged_head_sha>",
                           rollback_proposal: "git revert <observed.merged_head_sha>" })
  2. FOR each sib in input.siblings:
     a. IF sib.end_state_terminal AND NOT sib.start_state_terminal AND NOT sib.admitted:
        divergences.push({ class: unowned-sibling-mutation, issue: sib.issue,
                           detail: "non-admitted spec-referenced sibling moved to a terminal state during the run",
                           rollback_proposal: null })
  3. consistent = divergences.length == 0
  4. disposition = consistent ? "pass"
                 : (input.level == "L4" ? "needs-human" : "warn")
  5. RETURN { divergences, consistent, disposition }
```

**Level gating (behavioural summary).** The gate blocks hard only under lights-out; below it, a divergence is a surfaced warning, not a run-blocker — matching the holdout/adversarial L4-gating precedent.

- **L4** — a divergence sets `disposition: needs-human`, exit 1; the run **escalates** (composes with `faff run-done` → `escalate`) and must not report a clean complete. Never a silent green.
- **≤L3** — a divergence sets `disposition: warn`, exit 1; the orchestrator surfaces it in the run summary's needs-human section but does not hard-block the run's normal completion.

**Wiring into beep-boop.** Add the reconcile step to Step 11, beside `runcheck`. `runcheck` (completeness) and `reconcile` (ground-truth) both fire; a non-`pass` reconcile under L4 routes into the same escalate/needs-human path the holdout roll-up and `run-done escalate` already use, and the run summary gains a `## Ground-truth divergences` section listing each `Divergence`.

**Edge cases and error handling.**

- **No `shipped` outcomes and no siblings** → empty input → `consistent: true`, exit 0. A fully-consistent run passes.
- **Missing / unreadable `merge-record.json` for a `shipped` claim** → treated as `recorded: null` → `claimed-shipped-unmerged` divergence (fail-closed; a shipped claim with no merge evidence is exactly the phantom-merge failure mode).
- **Forge/tracker read fails during evidence gathering** → the orchestrator cannot prove consistency → assemble the input with the unreadable item marked and let the core fail-close it to a divergence (never drop it to pass). Malformed stdin to `faff reconcile` itself → exit 2, fail-loud.
- **Sibling legitimately admitted later (chain-unlock in a later wave)** → it is in `admitted[]` by run-end, so `sib.admitted` filtering excludes it; only genuinely non-admitted terminal moves flag.
- **Idempotent re-merge / already-merged sibling PR** → observed against the recorded head sha; a matching sha is consistent, a mismatched sha is the phantom-merge signal.

**Failure modes — how the approach could be wrong.**

- **The failure:** the run-start sibling baseline misses a spec reference (extraction under-recall), so a wrongly-mutated sibling isn't in `siblings[]` and escapes. **How you'd know:** a forensic (`faff audit`) review finds a terminal-state flip on an issue absent from `sibling-baseline.json`. **What it means:** widen the reference-extraction recall (it is deliberately bounded to spec-referenced issues; broadening to all run-touched issues is the fallback if misses recur) — proceed, this is the right first cut.
- **The failure:** `merge-gate` doesn't write `merge-record.json` on some merge path, so a genuine merge looks like `claimed-shipped-unmerged` (false divergence → needless needs-human). **How you'd know:** an L4 run escalates with a `claimed-shipped-unmerged` divergence whose PR is in fact merged. **What it means:** ensure every merge-ok path writes the record; a false needs-human is fail-safe (never a false green), so this degrades safely.

**Anti-pattern:** re-observing CI/merge state *inside* `faff reconcile`. Why: the verb must stay pure — the orchestrator gathers live evidence, the verb only asserts over it (identical to `merge-gate`'s pure `decideFloor`).

## 5. SCENARIOS — born-verifiable main objectives

```
Given a run whose ledger records a `shipped` outcome for an issue
  And the PR for that issue is not merged on its recorded head sha
When `faff reconcile` runs at run-end under L4
Then it emits a `phantom-merge` (or `claimed-shipped-unmerged`) divergence, exit 1, disposition needs-human
  And the run escalates rather than reporting complete
```

```
Given a run that mutated an issue to a terminal state
  And that issue was referenced by an admitted issue's spec but was never admitted
When `faff reconcile` runs at run-end
Then it emits an `unowned-sibling-mutation` divergence for that issue
```

```
Given a run whose every `shipped` outcome matches a merge on its recorded head sha
  And no non-admitted spec-referenced sibling changed terminal state
When `faff reconcile` runs at run-end
Then it reports consistent, exit 0, disposition pass
```

```
Given a divergence found at L3 (not lights-out)
When the gate resolves its disposition
Then the disposition is `warn` (surfaced, non-blocking), not `needs-human`
```

## 6. DESIGN DECISION RATIONALE

**Where does the reconcile logic live?** Options: fold into `runcheck` (cheapest) vs a new `faff reconcile` verb. **Chosen:** new verb — preserves `runcheck`'s pure Stop-hook invariant (FAFF-205/233/235) and keeps completeness vs ground-truth as distinct single-purpose gates.

**How is the deterministic assertion kept model-free?** **Chosen:** the merge-gate split — orchestrator gathers live evidence (its lane has tracker+git access), a pure core asserts over the assembled `ReconcileInput`. Satisfies "no model judgement in the gate itself."

**How does the recorded head sha survive to run-end?** **Chosen:** an additive per-issue `merge-record.json` written by `merge-gate` on merge-ok (it already resolves that sha for `--match-head-commit`), re-read at run-end. Rejected: widening the ledger `outcomes` value to an object (a breaking schema change rippling through `auditLedger`/executors/`runcheck`).

**Blocking vs warn under different appetites/levels?** (the ticket's open question) **Chosen:** hard-block (needs-human) at L4 lights-out; warn (surfaced, non-blocking) at ≤L3 — deterministic on the level signal, matching the holdout and adversarial-review L4-gating precedent. At the time of writing, L4 is the only level that runs truly unattended, so it is the only level where a false green is unrecoverable by a watching human.

**Relationship to FAFF-43?** (the ticket's open question) **Chosen:** FAFF-397 is a **sibling slice under the FAFF-43 umbrella** — the *blocking-gate* half — alongside FAFF-106 (detection, shipped) and FAFF-289 (forensics, shipped). It is **not** blocked by FAFF-43 (an explicit umbrella, not a buildable slice) and **not** blocked by FAFF-106 (whose `effects` substrate already ships). Keep the existing `relatedTo FAFF-43` edge; add no blocking edge; it is independently buildable now. Rationale: FAFF-43's own description names its two real halves (detection, forensics) and both are Done; this gate is the third half that *consumes* the shipped substrate rather than depending on unshipped work.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none blocking. (Rollback-proposal richness is deferred to FAFF-37; disposition-surfacing durability to FAFF-396 — both are out-of-scope extension points, not punts that block this build.)

**Assumptions.**

- **Assumes:** `faff merge-gate` is the sole merge path (FAFF-350, shipped) so a per-issue merge record can be written at exactly one chokepoint. *Validate:* grep `merge-gate` in `faff-graft` / `faffter-noon-ship` — confirm no direct `gh pr merge` remains.
- **Assumes:** the existing needs-human/escalate channel (`run-done escalate` + the run-summary needs-human section) is a viable sink for the divergence result until FAFF-396 lands. *Validate:* confirm `faff-beep-boop` Step 11 already routes a non-clean run-end into escalate/needs-human (it does, via holdout roll-up + `run-done`).
- **Assumes:** an admitted issue's spec is available at run start to extract sibling references. *Validate:* beep-boop assembly already reads each spec for the routing/confidence gate — reuse that read, no extra fetch.

## 8. DONE — Definition of Done

### From WHY
- [ ] At run-end, each `shipped` ledger outcome is confronted with live git/forge state; a claim with no matching merge is flagged, not accepted.

### From WHAT (types and interfaces)
- [ ] `faff reconcile --run-dir DIR --level L … [--json] [--selftest]` exists, reads a `ReconcileInput` on stdin, emits a `faff-contract:run-reconcile` block matching `ReconcileResult`.
- [ ] Exit map: 0 consistent, 1 divergence(s), 2 malformed/fail-loud.
- [ ] `faff merge-gate` writes a per-issue `merge-record.json` (`{pr, head_sha, merged, merged_at}`) under `<run-dir>/<ISSUE>/` on the merge-ok path; the ledger `outcomes` value stays a string (no schema migration).

### From HOW (behaviour)
- [ ] A `shipped` outcome whose PR is not merged on the recorded head sha → `phantom-merge` / `claimed-shipped-unmerged` divergence, exit 1.
- [ ] A non-admitted, spec-referenced sibling that moved to a terminal state during the run → `unowned-sibling-mutation` divergence.
- [ ] A fully-consistent run → `consistent: true`, exit 0, disposition `pass`.
- [ ] Disposition is level-gated: `needs-human` (hard-block/escalate) at L4, `warn` (surfaced, non-blocking) at ≤L3.
- [ ] `runcheck` is unmodified (purity preserved); reconcile is a separate step wired into `faff-beep-boop` Step 11 beside `runcheck`.
- [ ] The run-start `sibling-baseline.json` records terminal-state of spec-referenced non-admitted issues; run-end re-reads them live.

### From HOW (edge cases)
- [ ] Missing/unreadable `merge-record.json` for a `shipped` claim fails closed to a divergence (never `pass`).
- [ ] Empty input (no shipped, no siblings) → consistent, exit 0.
- [ ] Malformed stdin → exit 2, fail-loud.

### Eval / tests
- [ ] `faff reconcile --selftest` and `node --test` cover each divergence class (phantom-merge, claimed-shipped-unmerged, unowned-sibling-mutation) plus the consistent and level-gating cases against fixtures.

**Integration smoke test:**

```
Build a run-dir fixture with a ledger {admitted:[FAFF-A], outcomes:{FAFF-A:"shipped"}},
  a merge-record.json for FAFF-A with head_sha X, and a sibling-baseline.json.
Pipe a ReconcileInput where observed.merged_head_sha == X and no sibling moved:
  assert `faff reconcile --run-dir <fixture> --level L4` exits 0, consistent:true.
Flip observed.merged_head_sha to Y:
  assert exit 1, one phantom-merge divergence, disposition needs-human.
```

confidence: high
spec-review: approve

## Methodology critique

Agile-delivery lens (`issue-critique`):

- **Right-sized?** Yes — one cohesive 1–3 day unit. It spans two touch-points (the `merge-record.json` write in `merge-gate`, the `faff reconcile` verb + beep-boop wiring) but they **always ship together** — the record is inert without its run-end reader and vice versa — so this is a merge, not a split.
- **Workstream fit?** The issue currently carries **no project**. It belongs in *Audit, forensics & side-effect detection* (FAFF-289's project) as the third sibling of the FAFF-43 umbrella (detection · forensics · **blocking-gate**). *Recommend assigning that project at pickup* — a one-click human call, not a build blocker.
- **Deps surfaced?** Clean. Consumes only shipped substrate (FAFF-106 `effects`, FAFF-350 `merge-gate`, FAFF-38 `run-done`) — no blocking edge needed. `relatedTo FAFF-43` is correct; FAFF-396 (disposition sink) and FAFF-37 (recovery) are downstream/out-of-scope, not blockers. No implicit unlinked dependency.
- **Risk profile?** Low–moderate. The one novel risk is sibling-reference extraction recall (a missed spec reference lets a wrongly-mutated sibling escape); it is named in *Failure modes* with a widen-to-all-run-touched fallback. No external-dependency or novel-integration risk that would warrant a de-risking spike.

---

*Prepped autonomously via /faff-prep (run 2026-07-10-beep-boop-max0). Spec-review: approve (architectural · infosec · QA lenses, single-pass). The FAFF-43 relationship open question is resolved in §6 — sibling blocking-gate slice under the umbrella, `relatedTo` retained, independently buildable.*
