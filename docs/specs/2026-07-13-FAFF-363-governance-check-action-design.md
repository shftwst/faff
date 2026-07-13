# governance-check as a GitHub Action / required status check — design spec

> Spec: faffter-dark-nlspec · 2026-07-05 · autonomous · confidence: high. Full spec on Linear FAFF-363.

This spec addresses FAFF-363. Audience: the build agent implementing the composite Action + its CLI composition verb, and human reviewers checking the enforcement-binding design.

## 1. WHY — Problem and Principles

**The load-bearing model:** enforcement lives at chokepoints an agent cannot route around, and the two chokepoints every AI backend passes through are git and CI — not any particular harness. Today every faff governance check (runcheck, budget, merge-gate) runs *inside* the emitting harness: an agent that never invokes them is simply ungoverned. A `governance-check` GitHub Action validating the run artifacts a PR carries, wired as a **required status check under branch protection**, moves the verification to a chokepoint the emitter does not control: the backend emits the artifact format, and git refuses unearned merges.

**Problem statement.** faff's governance layer (ledger completeness, liveness, budget, merge floor) is enforced only by Stop hooks and skill prose inside the Claude Code harness. Any other backend — or a non-compliant run in the same harness — bypasses it entirely. This change binds the same checks into CI so they hold for any emitter with zero library integration.

**Design principles:**

- **Compose the verbs, add no invariants.** The Action and its composition verb run the already-shipped checks (`runcheck`, the ledger budget envelope, the persisted merge-floor artifacts, `audit`) — any new *check* logic would fork the governance semantics and belongs upstream in those verbs, not here.
- **Fail-closed on malformed, explicit on absent.** A carried artifact that is malformed or incomplete always fails the check. A PR carrying *no* artifacts is a declared policy choice (`on-missing` input), never a silent pass-as-verified.
- **Verify only what travels.** CI sees a committed snapshot, not the live run. Anything requiring the emitting machine's local state (token transcripts, live heartbeat) is reported from ledger-recorded values, never recomputed — recomputing would produce authoritative-looking garbage.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` | Node (single file, ~860KB, dependency-free) | The binary the Action vendors/downloads; hosts all verbs |
| `faff runcheck` / `faff audit` / `faff budget check` | CLI verbs | The shipped completeness / reconstruction / budget checks the verb composes |
| `faff merge-gate` (FAFF-350) | CLI verb | Persists + re-validates the floor artifacts (`<run-dir>/<ISSUE>/ac-checklist.json`, `review-verdict.json`) this Action re-verifies |
| `faff contract review-verdict`, `faff contract integrity-floor` | Contract scripts | Deterministic re-validation of the persisted floor artifacts |
| `.github/workflows/validate.yml` | GitHub Actions | House CI conventions: node20, `$GITHUB_STEP_SUMMARY`, per-verb `--selftest` steps |
| `.faff/runs/<run-id>/` | JSON artifacts | The artifact set: `run-ledger.json`, `events.jsonl`, per-issue floor artifacts |
| `docs/guide/cli.md` | docs | CI-gated (`lint-cli-doc`): must cover every subcommand, including the new one |

**Scope statement:** this is extraction rung 5 (harness-independence on the enforcement side) — the first governance surface that runs entirely outside the emitting harness.

## 2. OUT OF SCOPE

- **Marketplace publishing / naming / repo split** — extraction-gated per the ticket. Extension point: a root-level `action.yml` re-exporting `.github/actions/governance-check` when the layer extracts.
- **Emitter-side artifact committing** — teaching faff-graft/ship/beep-boop to commit run dirs onto PR branches is its own slice (it touches the build pipeline, not the enforcement binding). Extension point: a graft Step-10 tail step copying `$FAFF_RUN_DIR` into the feature branch. Until it lands, faff's own dogfood runs `on-missing: pass` and the fail path is proven by fixture.
- **Governance profiles (FAFF-362)** — v1 validates faff's delivery dialect (the vocabularies baked into today's verbs). Extension point: the composition verb grows a `--profile` flag when FAFF-362 lands.
- **Live-run liveness enforcement** — a committed snapshot cannot prove the emitting run is still heartbeat-live at CI time; liveness is reported, not gated (see HOW). Extension point: a `liveness: gate` input once an artifact-freshness convention exists.
- **Branch-protection mutation** — the Action never writes repo settings. Marking the check required is the human's one-click, documented in the recipe (mirrors `branch-protection-check`'s assert-don't-enforce posture).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| carried run dir | A `<artifacts-path>/<run-id>/` directory present in the PR's changed files |
| floor artifacts | `<run-dir>/<ISSUE>/ac-checklist.json` + `review-verdict.json` (+ `.faff/holdout/<ISSUE>.json` at L4), as persisted and consumed by `faff merge-gate` |
| on-missing policy | What the check concludes when a PR carries no run dirs: `pass` (adoption mode) or `fail` (locked-down mode) |

**The composition verb** (new, governance region, `--selftest`-covered):

```
faff governance-check --run-dir DIR [--run-dir DIR ...] [--issue ID] [--level L1|L2|L3|L4] [--json] [--summary-md FILE]

RECORD GovernanceCheckVerdict:
  runs: [ { run_id, legs: { completeness, budget, merge_floor, coherence, liveness }, pass } ]
  pass: bool                    # AND over gating legs of every run
  reasons: [string]             # one per failing leg, naming run-id + leg + cause

Leg semantics (gating unless noted):
  completeness — runcheck's audit: admitted − outcomes = ∅, no invalid outcomes
  budget       — ledger envelope + the LAST budget-checkpoint event in events.jsonl:
                 breached != {} with at_ceiling escalate ⇒ fail; never recomputes tokens
  merge_floor  — for the target issue(s): review-verdict.json re-validated
                 (computeReviewVerdict, verdict must be pass) + ac-checklist.json present
                 and complete; missing/unreadable/mismatched ⇒ fail
  coherence    — audit's events↔ledger mismatch report: REPORTED in the summary,
                 never gating (mirrors faff audit semantics)
  liveness     — owner block well-formed (gating); status/heartbeat-age REPORTED only
                 (snapshot semantics — see Failure modes)

exit 0 pass · 1 fail · 2 usage/malformed input (fail-loud)
```

**The composite Action** (`.github/actions/governance-check/action.yml`):

```
inputs:
  faff-binary:     path to an in-checkout binary; default plugin/skills/faff/bin/faff when present
  faff-version:    release ref to fetch when no binary in checkout (raw.githubusercontent.com, pinned)
  artifacts-path:  where carried run dirs live; default .faff/runs
  on-missing:      pass | fail; default pass
  issue:           optional explicit issue id; default derived from branch name
                   (case-insensitive [A-Za-z]+-[0-9]+, upcased — branch names are lowercase, e.g. faff-363-…)
  level:           L1|L2|L3|L4; default L3
steps (composite):
  1. resolve binary (checkout path, else fetch by pinned ref; chmod +x)
  2. discover carried run dirs: changed files of the PR under artifacts-path (git diff --name-only base...head)
  3. none found ⇒ apply on-missing (write a "no governance artifacts carried" summary line either way)
  4. run: faff governance-check --run-dir ... --summary-md "$GITHUB_STEP_SUMMARY"
  5. exit with the verb's exit code (the status check verdict)
```

**Design decisions** (rationale in section 6):

- **Chosen:** composite Action at `.github/actions/governance-check/action.yml`, dogfooded via `uses: ./.github/actions/governance-check`; external consumers use the subpath form `shftwst/faff/.github/actions/governance-check@<ref>`.
- **Chosen:** binary acquisition = in-checkout path when present, else raw-fetch of `plugin/skills/faff/bin/faff` at a pinned ref. The recipe directs external consumers to pin a **commit sha**, not a tag (tags are mutable refs — a moved tag silently swaps the enforcement binary); `faff-version` accepts either, the doc states the trust difference. No npm install, no marketplace asset.
- **Chosen:** artifact-passing convention v1 = **committed on the PR branch** under `artifacts-path`. Workflow-artifact upload and cross-workflow fetch are documented as the convention for CI-resident emitters in the recipe, not implemented here.
- **Chosen:** run-dir discovery = changed paths in the PR diff, never "newest dir in the checkout" (a stale merged run must not satisfy a new PR).
- **Chosen:** `on-missing` defaults `pass` — human PRs on a mixed repo must not be blocked; the residual fail-open is named in Failure modes and closed by flipping to `fail` on agent-only branches.
- **Chosen:** gating legs = completeness + budget + merge-floor (+ well-formed owner block); coherence and liveness detail are report-only.
- **Chosen:** the Action never invokes `faff merge-gate` — merge-gate observes CI, and this check *is* CI (circular); branch protection itself owns "sibling checks green". The Action re-validates the same persisted floor artifacts merge-gate reads.
- **Chosen:** a new `governance-check` composition verb in the CLI rather than bash-in-action-steps — selftest-able and deterministic per the house tenet; it composes existing cores (runcheck audit, audit reconstruction, contract validation) and adds no new invariant.
- **Chosen:** dogfood = a new sibling workflow `.github/workflows/governance.yml` (pull_request) running the local Action; marking it required in branch protection stays a documented human toggle.
- **Chosen:** issue derivation for the merge-floor leg = explicit `issue` input, else branch-name match, else validate every admitted issue with a terminal outcome in each carried run dir.
- **Chosen:** no `.gitignore` change in this ticket — faff's own `.faff/` stays ignored; fixtures prove the fail path until the emitter-side slice lands.

## 4. HOW — Behavior

The verb walks each run dir independently and aggregates:

```
PROCEDURE governance_check(run_dirs, issue?, level):
  FOR each dir:
    1. Read run-ledger.json; malformed ⇒ exit 2 (fail-loud, not a leg failure)
    2. completeness := runcheck audit (admitted − outcomes, invalid outcomes)
    3. budget := envelope ceilings vs last budget-checkpoint event (events.jsonl);
       missing events file ⇒ leg reported "no checkpoints", gates only if ledger
       envelope itself records breached-at-escalate
    4. issues := [issue] if given, else branch-derived, else admitted-with-terminal-outcome
       FOR each issue: merge_floor := re-validate its floor artifacts
    5. coherence / liveness := reconstruct + report (audit join; owner block shape gates)
  Emit GovernanceCheckVerdict JSON (+ markdown summary when --summary-md)
```

**Job summary** (the flight-recorder readout, one table per run): unit | outcome | floor verdict, plus a budget line (spent/ceiling per recorded dimension, source: ledger) and a coherence line. Rendered by the verb (`--summary-md`), so local runs and CI produce byte-identical readouts.

**Edge cases:**

- Run dir in diff but deleted by the PR ⇒ skip (not carried anymore), note in summary.
- Multiple run dirs carried ⇒ all must pass (AND).
- `events.jsonl` absent but ledger present ⇒ completeness still computable; coherence reports "no event substrate" (degrade-don't-crash, mirroring `faff audit`).
- Floor artifacts for a *sibling* issue absent ⇒ only gating when that issue is in the target set (step 4).
- Binary fetch failure in the Action ⇒ step failure = check failure (fail-closed), with a distinct "setup fault" error line (the FAFF-371 loud-setup-failure convention).

**Failure modes:**

- **Snapshot divergence** — the committed ledger was clean at commit time; the local run continued after. How you'd know: summary prints the ledger's last event seq + timestamp; a merge-gate run locally still re-reads live artifacts. What it means: the check verifies *what the PR carries*, stated plainly in the recipe — not a defect, a boundary.
- **Fail-open via `on-missing: pass`** — an agent PR that simply omits artifacts passes as "no artifacts". How you'd know: the summary line says "no governance artifacts carried" on every such PR (visible, greppable). What it means: adoption-mode default; the recipe's locked-down section shows `on-missing: fail` per protected branch. This is the design doc's "binding-less adoption" trap — the docs must never let "emits the format" read as "is governed".
- **Conformance, not authenticity** — the artifacts are authored by the emitter, so a malicious emitter can commit a *forged* clean ledger and fabricated pass verdicts; this check verifies format-conformance and floor conditions, not artifact provenance. How you'd know: you can't, from inside this check — authenticity is the trust-model layer (signed artifacts / attestation), explicitly outside governance-extraction v1 per the design doc's honest boundary. What it means: the recipe and the check's own docs must state "validates conformance, never authenticity" so the required check is not oversold; the enforcement value v1 delivers is completeness/floor discipline for *cooperating-but-fallible* emitters, plus a visible audit surface for hostile ones.
- **Anti-pattern:** re-deriving CI-green inside the check (merge-gate's job, circular here). Why: branch protection already composes sibling checks; duplicating the observation makes two sources of truth.

## Scenarios

```
Given a PR whose diff carries a run dir with a complete ledger and valid floor
  artifacts for the PR's issue
When governance-check runs
Then the check concludes success and the job summary lists the run's units,
  outcomes, floor verdicts, and budget state

Given a PR carrying a ledger with an admitted issue that has no outcome
When governance-check runs
Then the check fails naming the run-id, the issue, and "completeness"

Given a PR carrying a tampered review-verdict.json (verdict != pass, or unreadable)
When governance-check runs
Then the check fails on the merge_floor leg for that issue

Given a PR with no artifacts under artifacts-path and on-missing: pass
When governance-check runs
Then the check passes and the summary states "no governance artifacts carried"

Given the same PR and on-missing: fail
Then the check fails
```

Assertion: the verb makes no network call and reads nothing outside the given run dirs + repo files (pure evaluator, same posture as `sentry check`).

## 6. DESIGN DECISION RATIONALE

- **Where does the check logic live — Action steps vs CLI verb?** Bash-in-steps is unreviewable and untestable; a CLI verb gets `--selftest`, the validate.yml gate, and local/CI parity. **Chosen:** CLI composition verb + thin Action. At the time of writing the governance region carve (FAFF-359) gives it a natural home with a direction lint.
- **Which legs gate?** Completeness/budget/floor are snapshot-verifiable; liveness is not (no live heartbeat in CI), coherence is defined report-only by `faff audit`. Gating what can't be honestly verified from a snapshot would manufacture false authority. **Chosen:** gate the snapshot-verifiable three; report the rest.
- **Why not run merge-gate itself?** It observes CI status on the PR head — from inside a CI check that observation is circular (this check is one of the checks it would observe, sibling checks may be pending). Branch protection is the composition point: governance-check ∧ sibling CI ∧ review = the full floor. **Chosen:** re-validate merge-gate's persisted artifacts only.
- **Committed artifacts vs workflow-artifact upload?** The primary emitter class (an agent on a dev machine) has no workflow run to upload from; the only channel that rides the PR is repo content. Upload conventions only exist for CI-resident emitters. **Chosen:** committed-on-branch as the v1 convention; upload documented as the external-agent recipe variant.
- **Why default `on-missing: pass`?** A required check that fails every human PR kills adoption on mixed repos (and faff's own repo is mixed). The fail-open residual is visible in every summary and closed per-branch. **Chosen:** `pass` default, `fail` documented for locked-down branches.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

Open questions: none blocking — all decisions above are closed.

Assumptions:

- **Assumes:** `raw.githubusercontent.com/shftwst/faff/<ref>/plugin/skills/faff/bin/faff` serves the binary for pinned refs (releases exist, latest v0.8.0). Validate: `curl -fsSL` the v0.8.0 URL before relying on the fetch path.
- **Assumes:** GitHub-hosted runners provide node ≥ 20 for the composite steps (validate.yml already relies on setup-node@v4 node20; the Action pins the same).
- **Assumes:** the FAFF-350 floor-artifact shapes (`ac-checklist.json`, `review-verdict.json`) are stable and their re-validation cores (`computeReviewVerdict`, `contract review-verdict`) are callable against files. Validate: read the merge-gate implementation's artifact re-read path before wiring.

## 8. DONE — Definition of Done

### From WHY
- [ ] A deliberately-incomplete ledger carried on a PR fails the status check (fixture-proven; recorded demo per ticket AC)

### From WHAT (interfaces)
- [ ] `faff governance-check` exists in the governance region with `--run-dir`/`--issue`/`--level`/`--json`/`--summary-md`, exits 0/1/2 per spec, `--selftest` covers the leg table (pass, completeness-fail, budget-breach, floor-fail, malformed-ledger exit 2, on multiple run dirs AND)
- [ ] `.github/actions/governance-check/action.yml` is a composite action with the six inputs and resolves the binary checkout-first, fetch-by-pinned-ref fallback
- [ ] `docs/guide/cli.md` documents the new verb (lint-cli-doc gate passes)
- [ ] validate.yml gains the `governance-check --selftest` step (house convention)

### From HOW (behaviour)
- [ ] Complete ledger + valid floor artifacts ⇒ exit 0 and a job-summary table of units/outcomes/floor/budget
- [ ] admitted − outcomes ≠ ∅ ⇒ exit 1 naming run-id + issue + leg
- [ ] Tampered/unreadable review-verdict.json for a target issue ⇒ exit 1 on merge_floor
- [ ] Ledger-recorded budget breach at escalate ⇒ exit 1; tokens never recomputed in CI
- [ ] No carried artifacts ⇒ on-missing policy applied, summary line written either way
- [ ] Coherence + liveness rendered report-only; malformed owner block gates

### From dogfood + recipe
- [ ] `.github/workflows/governance.yml` runs the local Action on faff's own PRs (`on-missing: pass`)
- [ ] Recipe doc: branch-protection wiring (required-check name, gh api one-liner), the artifact-passing convention per backend class (in-repo agent commit vs CI-resident upload), the locked-down `on-missing: fail` variant, sha-pinning guidance for the binary fetch — with both warnings stated: "emitting the format ≠ being governed until the check is required" and "the check validates conformance, never artifact authenticity"

**Integration smoke test:** node --test case that builds a fixture run dir (ledger + events + floor artifacts), runs `faff governance-check --run-dir <fixture> --json`, asserts pass; then corrupts the ledger (drop one outcome) and asserts exit 1 with a completeness reason.

## Already shipped against this surface

Done tickets overlapping this spec's surface (queried 2026-07-05):

- FAFF-350 (Done 2026-07-04) — `faff merge-gate` + `faff branch-protection-check` shipped. The ticket's "degrades to completeness+liveness-only before merge-gate lands" contingency is resolved: the floor artifacts exist and this spec composes with them from day one (no degraded mode built).
- FAFF-366 / FAFF-369 (Done 2026-07-05) — merge-gate CI-classification hardening (all-skipped ⇒ no-ci-coverage; Actions-only repos). Context for why this Action must not re-derive CI-green itself.
- FAFF-359 (Done 2026-07-04) — the governance region carve + direction lint: the new verb's home and boundary rules.
- FAFF-289 (`faff audit`), FAFF-36 (`budget check`), FAFF-49 (`sentry`), FAFF-312 (budget-as-backstop) — the shipped verbs/semantics the composition verb reuses.

None supersede the premise: no Action, workflow binding, or composition verb exists anywhere in the repo (verified: no `action.yml`, workflows = validate.yml + release-please.yml only). Premise holds; proceed.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** — Borderline-large but cohesive: one verb + one composite action + one dogfood workflow + fixtures + recipe doc is a single 1–3 day unit *because* the two natural split-outs are already excluded (emitter-side artifact committing → its own slice; profile-awareness → FAFF-362). Do not re-absorb either during build. No split recommended.
- **Workstream fit? (principles 1 + 5)** — The issue is project-less (agile default for new work). It is rung 5 of the extraction ladder alongside FAFF-360 (rung 2, Backlog) and FAFF-362 (rung 3, Todo); if an outcome-led extraction stream forms, all three belong to it. No action needed now.
- **Deps surfaced? (principle 6)** — Clean: the hard dependency (FAFF-350 merge-gate) is Done, so no blocker edge is owed. FAFF-362 is correctly `relatedTo`, not blocking — the spec treats profiles as an extension point. FAFF-360 is independent (different rung, no shared artifact).
- **Risk profile? (principle 7)** — Novel-integration risk (GitHub Actions runtime, raw-URL binary fetch) is real but contained: both are marked `Assumes:` with validation instructions, and the fixture-based fail-path test de-risks the core claim without needing a live protected branch. No separate de-risking spike warranted.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
