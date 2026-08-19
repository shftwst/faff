# 639a — Gate discovery sees what CI sees: recognise the invariant lints, two-tier dedup, emit `partial` + coverage

> Spec: faffter-dark-nlspec · 2026-08-19 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-848.

> **Revised 2026-08-19 (autonomous narrow refresh).** Folds in the human decision comment "report the full discovery surface" (2026-08-19), which closes both open Punts and ratifies §3's existing choices. Re-rated medium → high; no design change. Changes annotated in §7.

Audience: the build agent implementing this, and the human reviewing that build. This is the **first half** of the FAFF-639 split (human split decision 2026-08-16): discovery-only, execution untouched. The second half (FAFF-849 / 639b) is what makes `faff gates run` execute the wider set.

## 1. WHY — problem and principles

**The load-bearing idea.** `faff gates discover` has two lossy stages and both are silent. Stage one classifies each CI `run:` command against a curated allow-list and **drops whatever it doesn't recognise** (`gates.js:210`). Stage two dedups the survivors **by kind, one rung per kind** (`gates.js:227-231`). Measured on this repo **today** (current code, 2026-08-17): stage one keeps **6 of 277** extracted command lines; stage two collapses those to **2 rungs** (`LINT` validate-adapters + `UNIT` node --test), and `discoverRungs` reports `discovery: confident` regardless, because `confident` means only "≥1 rung resolved" (`gates.js:234`). Everything here follows from separating *"we found gates"* from *"we found the gates."*

**Problem statement.** During the FAFF-604 build the ladder returned `pass` and the branch went red in CI on `faff regions check` — an ADR-0042 require-graph violation. `faff regions check`, `faff adr validate`, and `faff prdr validate` all run in CI (`validate.yml:93/76/79`) and are none of them recognised by the ladder today. A contributor running `faff gates discover` sees `confident` over a tenth of the workflow and reads it as "the ladder covered it."

**What this half does, and does not do.** This half makes **discovery honest** — it does **not** change what `faff gates run` executes. After this half, a contributor running `faff gates discover` sees the invariant lints as recognised rungs, sees distinct CI lints listed separately rather than collapsed, and sees a `partial` classification with a coverage ratio when discovery covers less than half the eligible workflow. `faff gates run`'s executed rung set, its `signal`, and its emitted `faff-contract:quality-gates` block are **byte-identical to today**. The FAFF-604 class of failure becomes **visible** through discovery; making `faff gates run` **fail** on it is 639b's job (execution of the wider set).

**Design principles.**

- **The ladder stays cheap; it is not a second CI.** Discovery is a static read; this half runs no new command. The recognised invariant lints are cheap (`regions check` ~0.2s; `adr validate` ~2.1s; `prdr validate` sub-second) but that cost is 639b's concern — 848 executes none of them.
- **Trusted sources only, unchanged.** Discovery reads the repo's own config and workflow files and nothing new. No `uses:` internals, no third-party fetch.
- **Never green by silence — and never green by partial sight.** `discovery: none` is the only state the fail-closed default fires on (`gates.js:283-284`). "Confident but a tenth of the workflow" is the failure that actually happened and is currently inexpressible. `partial` makes it expressible **without** turning every ordinary green build into a park — in 848 `partial` is a **report**, not a gate.
- **Preserve FAFF-533 exactly.** CI is the fallback source; a locally-declared gate of a kind must keep suppressing CI rungs of that kind, or Step 8's "one resolver, one suite run" breaks into a double-run.
- **Execution byte-identical.** The single hardest constraint. See the Chosen in §3 — the new recognition and dedup feed a **reporting** path only; `runLadder` is not touched.

**Reference context** (current code, verified 2026-08-17; anchors re-confirmed 2026-08-19).

| File | Relevance |
|---|---|
| `gates.js:44` | `GATE_COST` — `STATIC_ANALYSIS: 40`, already sorts between TYPECHECK (30) and UNIT (50). No new kind needed. |
| `gates.js:134-148` | `CI_RUNNERS` — the curated allow-list; carries faff's own gates at :140 (`validate-adapters\|lint-refs\|lint-cli-doc` → LINT). **No STATIC_ANALYSIS entries, no `regions`/`adr`/`prdr`.** |
| `gates.js:152-158` | `ciRunnerKind` — null for unmatched. Consumed by the execution path; left untouched. |
| `gates.js:164-190` | `extractRunCommands` — line scan, returns bare command strings, **no step/job context**. |
| `gates.js:196-215` | `discoverCiWorkflows` — unrecognised dropped at :210, CI penalty at :211. |
| `gates.js:219-236` | `discoverRungs` — dedup-by-kind at :227-231; `partial` reserved-but-never-emitted at :232-234. **The execution resolver — left untouched.** |
| `gates.js:270-289` | `runLadder` — executes `discoverRungs`'s rungs; `discovery: none` is the only fallback trigger. Left untouched. |
| `contract-defs.js:176` | `GATE_RUNG_KINDS` includes `STATIC_ANALYSIS`. |
| `contracts/quality-gates.schema.json:8-25` | Contract shape `{signal, rungs, conformant, violations}`; **`discovery`/`coverage` are not fields and do not become fields.** |
| `.github/workflows/validate.yml:76/79/93/96/99` | `adr validate`, `prdr validate`, `regions check`, `regions selftest --region factory`, `regions selftest --region governance` — the CI-only invariant lints. |
| `.github/workflows/validate.yml:95` | `regions selftest --region factory` is labelled **destructive** (spawns `worktree-prune --selftest`, FAFF-581). See the §7 resolution. |
| `.faffrc.yaml` | Has **no** `gates:` block today — no `gates.fallback`, no `gates.exclude`. 848 adds none (config keys are 639b). |

**Scope.** `faff gates discover`'s recognition and completeness reporting. Not execution, not the contract shape, not the fail-closed policy, not any `gates.*` config key.

## 2. OUT OF SCOPE (lives in 639b / FAFF-849)

- **Running the wider set.** `faff gates run` execution stays today's kind-deduped selection. The recognised invariant lints are **reported by `discover`, executed by neither command** in 848.
- **Exclusion rules** (`github-context`, `runs-on-mismatch`, `configured`) and the `gates.exclude` key. Without them, 848's coverage denominator is *all* candidate steps (a conservative lower bound — biases toward `partial`, the safe direction).
- **The `gates.*` config keys** (`gates.partial`, `gates.max_rungs_per_kind`, a configurable threshold). 848 uses hardcoded conservative constants.
- **Per-kind caps and the wall-clock budget.** Nothing runs, so nothing is capped or timed.
- **The `--selftest`-family aggregate question** — whether the ~60 `faff contract <name> --selftest` + per-module selftest-table checks become one aggregate execution rung. 848 *recognises* `regions selftest` for the report (see §7) but decides nothing about executing the family.
- **A full YAML parser.** The line scan is the house posture (matches `discoverMakefile`/`discoverPreCommit`).

## 3. WHAT — vocabulary, types, decisions

| Term | Meaning |
|---|---|
| Candidate step | One `run:` step in a workflow job — one step however many command lines its block scalar holds. The counting unit. |
| Recognised step | A candidate step yielding ≥1 recognised command before dedup. |
| Source tier | `local` (pre-commit / package.json / Makefile) or `ci` (workflow). |
| Coverage ratio | Recognised steps ÷ eligible candidate steps. `1.0` when eligible == 0. |
| Reporting resolver | The new 848 path feeding `faff gates discover`. Distinct from the execution resolver (`discoverRungs`, untouched). |

```
ENUM Discovery: confident | partial | none
RECORD Coverage:
  eligible_steps: Int          # all candidate run: steps (no exclusions in 848)
  recognised_steps: Int
  ratio: Float                 # recognised/eligible; 1.0 when eligible == 0
```

**Chosen: split the resolver into a reporting path and an execution path, so `runLadder` is byte-identical.** The two-tier dedup and the STATIC_ANALYSIS recognition live in a **new reporting resolver** that `faff gates discover` consumes. `discoverRungs`, `ciRunnerKind`, `CI_RUNNERS`, and `runLadder` are **not modified** on the execution path. Rationale: the ticket's central promise is "execution path unchanged / blast radius is a report." If the new recognition fed the shared `discoverRungs`, a STATIC_ANALYSIS rung (e.g. `regions check`, cost 45) would enter the kind-deduped execution set and `runLadder` would start executing it — a direct scope violation, and (for `regions selftest --region factory`) a *destructive* one. Isolating the recognition to the report is the only design consistent with both "execution unchanged" (848) and "the ladder runs what discovery found" (639b). *(decides: architecture — ratified by the human split-decider 2026-08-19; see §7.)*

**Chosen: reuse `STATIC_ANALYSIS`, mapped from the invariant-lint commands, not a new kind.** It exists in `GATE_COST`, `GATE_RUNG_KINDS`, and the schema enum, and already costs 40 (between TYPECHECK and UNIT — where invariant lints belong). A new `STATIC` kind would need a schema change and would invalidate the kind set in every stored artifact, for an ordering slot that already exists.

**Chosen: the reporting recogniser is the execution `CI_RUNNERS` ∪ the four named invariant-lint patterns.** New patterns, reporting-path only: `regions check`, `regions selftest`, `adr validate`, `prdr validate` → `STATIC_ANALYSIS`. Substring/word-boundary match, same shape as the existing table. It is additive and never seen by `ciRunnerKind`/`runLadder`. The widened allow-list is limited to these recognised invariant commands; it recognises repository/workflow content into a **report** and executes no tracker or repository content (human decision 2026-08-19).

**Chosen: two-tier dedup in the reporting path — by kind within `local`, by `(kind, command)` within `ci`.** Local declarations of a kind are usually the same check declared three ways → collapse. CI steps of a kind are usually *different* checks — `validate-adapters`, `lint-refs`, `lint-cli-doc` are three distinct lints that today collapse into one. Any local rung of a kind still suppresses **all** CI rungs of that kind (FAFF-533 preserved).

**Chosen: `partial` is a reported classification, not a gate, in 848.** Coverage ratio `< 0.5` → `partial`; else `confident`; empty → `none`. The `0.5` is a **hardcoded constant** (config is 639b). `partial` does **not** change `runLadder`'s `signal` — `runLadder` never sees it (the fallback still fires only on `none`). `confident`/`none` semantics are unchanged, exactly as the ticket requires.

**Chosen: coverage denominator = all candidate `run:` steps (no exclusions).** Exclusion rules are 639b. Counting every eligible step (including build/setup/deploy steps that will later be excluded) makes the ratio a conservative **lower bound**, which biases toward `partial` — the honest "we don't see most of the workflow" signal. 639b's exclusions refine the denominator upward.

**Chosen: count steps, not command lines.** The denominator is `run:` steps; a block scalar is one step however many lines it holds. A line-based ratio measures block-scalar verbosity (277 lines, mostly `set -euo pipefail`/`echo`), not gate coverage. This requires `extractRunCommands` to carry a `step_index` — added on the reporting path (the execution path keeps consuming bare strings, unchanged).

**Assumes / trust boundary (infosec).** `CI_RUNNERS` matches by substring anywhere in a command line, so the allow-list trusts the *content* of workflow files. The governing boundary: **a workflow file is trusted to exactly the degree the branch it arrives on is** — discovery reads only the repo's own trusted files (unchanged from FAFF-533), and the ladder runs on a branch that is itself under review. In 848 the widened allow-list changes only what is **recognised in a report**; it adds **no new executed command** (nothing reported here runs) and executes no tracker or repository content (human decision 2026-08-19). The obligation that "recognised ⇒ run verbatim, before review" transfers to **639b**, which introduces execution of the wider set and therefore must own the exclusion escape and this same trust-boundary statement at the point it becomes load-bearing. Named here so 639b inherits it explicitly rather than by implication.

## 4. HOW — behaviour

All changes are inside `gates.js` plus the `faff gates discover` render. No change to `runLadder`, `discoverRungs`, `ciRunnerKind`, `CI_RUNNERS`, `contract-defs.js`, or the schema.

1. **Reporting extraction with step context.** A reporting variant of the scan tracks the enclosing `jobs.<key>`, the most recent `- name:` at step indentation, and increments a `step_index` once per `run:` key (not per emitted line). Returns records `{command, step_index, step_name, job}`.
2. **Reporting recogniser.** `ciRunnerKind`'s table ∪ the four invariant-lint patterns → a reporting-only `reportKind(command)`. The execution `ciRunnerKind` is untouched.
3. **Reporting resolver.** Emit a reported rung per recognised command; partition local/ci; dedup by kind (local) then by `(kind, command)` (ci); drop every ci rung whose kind a local rung already covers; sort by `cost_rank`. Compute `Coverage {eligible_steps, recognised_steps, ratio}` over candidate steps. Classify `discovery`: empty → `none`; `ratio < 0.5` → `partial`; else `confident`.
4. **`faff gates discover` output.** Print the reported rung table (now showing the distinct CI lints and the STATIC_ANALYSIS invariant lints), then a coverage line (`recognised N / eligible M steps (ratio)`) and the `discovery` classification. `--json` carries `{discovery, coverage, rungs}`.
5. **`faff gates run`** — executes and reports exactly as today. It **may** additionally print the coverage line for context, but its executed rungs, `signal`, exit code, and `faff-contract:quality-gates` block are unchanged. (Recommended: print the coverage line so the operator sees the gap; it changes no machine-consumed output.)

**Anti-pattern:** feeding the new recognition into `discoverRungs`. Why: it would silently add executed rungs (including the destructive `regions selftest --region factory`) — the exact "execution unchanged" violation this half is defined to avoid.

**Anti-pattern:** counting command lines as the denominator. Why: measures verbosity, not coverage; this repo's 277 lines come from ~dozens of steps.

**Failure modes.**
- **discover and run now report different rung sets.** *How you'd know:* `discover` lists `regions check` as a rung; `gates run` does not execute it. *What it means:* **intended** for the 639a→639b window — `partial` + the coverage line exist to make that gap legible. The human decision (2026-08-19) records this temporary discover-versus-run gap explicitly until FAFF-849 lands; 639b closes it. This is the interim behaviour the human split-decider has confirmed is acceptable (see §7).
- **The 0.5 threshold reads `partial` forever on a build-heavy CI.** *How you'd know:* a repo whose workflow is mostly deploy/publish stays `partial`. *What it means:* acceptable in 848 (report-only, no gate); 639b's exclusions + configurable threshold address it.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given faff's own repo at current HEAD
When `faff gates discover` runs
Then the reported rungs include distinct LINT rungs for validate-adapters, lint-refs and
     lint-cli-doc, and STATIC_ANALYSIS rungs for `regions check`, `adr validate`,
     `prdr validate` — and discovery is `partial` with a coverage ratio well below 0.5
```
```
Given faff's own repo at current HEAD
When `faff gates run` runs
Then the executed rungs, the signal, the exit code, and the emitted
     faff-contract:quality-gates block are byte-identical to the pre-change baseline
```
```
Given a repo declaring `test` in package.json and `node --test` in a CI workflow
When `faff gates discover` runs
Then exactly one UNIT rung is reported, sourced locally (local suppresses CI of that kind)
```

- The `faff-contract:quality-gates` block MUST contain exactly `signal` and `rungs` — no `coverage`/`discovery` field.
- `GATE_RUNG_KINDS` and the schema enum MUST be byte-identical (no new kind).

## 6. Design decision rationale

- **Report layer vs shared resolver?** Sharing `discoverRungs` would change execution (a scope + safety violation). **Chosen:** an isolated reporting resolver; `runLadder` untouched.
- **New `STATIC` kind vs reuse `STATIC_ANALYSIS`?** Reuse — it exists and costs 40. A new kind is a schema + artifact-set break for an existing ordering slot.
- **Constant vs config threshold?** Config keys are 639b. **Chosen:** hardcoded `0.5`.
- **Two-tier vs by-command-everywhere?** By-command everywhere would break FAFF-533's local-suppresses-CI rule. **Chosen:** two-tier.

## 7. Open questions and assumptions

*Both Punts that held this at medium were **closed by the human decision comment "report the full discovery surface" (2026-08-19)**. Recorded below as resolved decisions.*

**Chosen (was Punt — resolved by human 2026-08-19): `regions selftest` is recognised report-only in 848.** The ticket lists `regions selftest` among the invariant-lint patterns to recognise **and** defers "the `--selftest`-family aggregate question" to 639b. Those mildly conflict: `regions selftest` *is* a `--selftest`-family member, it appears as **two** distinct CI commands (`--region factory`, `--region governance`), and the factory variant is labelled **destructive** (`validate.yml:95`, spawns `worktree-prune --selftest`). The human ratified reporting the **full discovery surface**: `faff gates discover` includes `regions selftest` in its **report-only** output; 848 does **not** execute it. The decision of whether to *execute* it (and the whole `--selftest` family) stays with 639b, which owns the exclusion machinery needed to run the family safely. This is safe in 848 because nothing reported is executed — it confirms §3's existing choice. *(decides: architecture — ratified.)*

**Chosen (was Punt — resolved by human 2026-08-19): the interim discover>run divergence is recorded explicitly until FAFF-849 lands.** The interim state where `faff gates discover` reports rungs that `faff gates run` does not execute is intended and temporary (closed by 639b). The human confirmed comfort with the discover>run divergence during the 639a→639b window and directed that the temporary gap be recorded explicitly until FAFF-849 lands — the `partial` classification and the coverage line are what make the gap legible, and a note (§1 principle "Execution byte-identical" / §4 failure-modes) states it is intended and 639b-closed. *(decides: any — ratified.)*

**Assumes:** `regions check`, `adr validate`, `prdr validate` are locally runnable with no CI-only state — verified 2026-08-17, all exit 0 on this repo. (Relevant to 639b's execution; recorded here as provenance.)

**Assumes:** the reporting resolver's added work is a static read (no command execution), so it adds no measurable wall-clock to `faff gates run`.

## 8. DONE

### From WHY
- [ ] `faff gates discover` on this repo reports distinct LINT rungs for `validate-adapters`, `lint-refs`, `lint-cli-doc`, and STATIC_ANALYSIS rungs for `regions check`, `adr validate`, `prdr validate`.
- [ ] `faff gates discover` reports `discovery: partial` with a coverage ratio and recognised/eligible step counts.
- [ ] `faff gates discover` includes `regions selftest` in its report-only output; `faff gates run` does not execute it (the recorded interim discover>run gap, closed by FAFF-849).

### From WHAT / execution-unchanged
- [ ] `faff gates run` executed rungs, `signal`, exit code, and emitted `faff-contract:quality-gates` block are byte-identical to the pre-change baseline (a captured before/after on this repo).
- [ ] `runLadder`, `discoverRungs`, `ciRunnerKind`, and `CI_RUNNERS` are unmodified on the execution path (diff shows the new recognition/dedup only on the reporting path).
- [ ] `GATE_RUNG_KINDS` and the schema enum are byte-identical — no new rung kind.
- [ ] The `faff-contract:quality-gates` block contains exactly `signal` and `rungs`.

### From HOW
- [ ] The reporting resolver dedups CI rungs by `(kind, command)` and local rungs by kind; a local rung of a kind suppresses all CI rungs of that kind.
- [ ] Coverage denominator counts `run:` steps, not command lines (a block scalar is one step).
- [ ] `discovery` takes `partial` for at least one input; `confident`/`none` semantics unchanged.
- [ ] A STATIC_ANALYSIS reported rung sorts ahead of every UNIT reported rung.

### From tests and docs
- [ ] `gates --selftest` gains cases for STATIC_ANALYSIS reporting recognition, two-tier dedup, step-granularity coverage counting, and `partial` classification — **plus** a case asserting `runLadder`'s output is unchanged by the reporting additions.
- [ ] `test/gates-ci-source.test.mjs` gains a real-repo assertion that discovery reports a STATIC_ANALYSIS `regions check` rung and `discovery: partial`, while `faff gates run` executes its today-identical rung set.
- [ ] `validate-adapters`, `regions check`, and `node --test` all pass.

confidence: high
spec-review: approve
build-tier: complex

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen","topic":"split resolver: reporting path vs untouched execution path"},{"marker":"chosen","topic":"reuse STATIC_ANALYSIS, no new kind"},{"marker":"chosen","topic":"reporting recogniser = CI_RUNNERS union four invariant-lint patterns"},{"marker":"chosen","topic":"two-tier dedup (kind for local, (kind,command) for ci)"},{"marker":"chosen","topic":"partial is a report not a gate; hardcoded 0.5 threshold"},{"marker":"chosen","topic":"coverage denominator = all candidate steps, no exclusions"},{"marker":"chosen","topic":"count steps not command lines"},{"marker":"chosen","topic":"regions selftest recognised report-only in 848, execution deferred to 639b (ratified by human 2026-08-19)"},{"marker":"chosen","topic":"interim discover>run divergence recorded explicitly until FAFF-849 lands (ratified by human 2026-08-19)"},{"marker":"assumes","topic":"trust boundary: workflow trusted to the branch's degree; widened allow-list executes no tracker/repo content; execution-trust obligation transfers to 639b"},{"marker":"assumes","topic":"regions check / adr validate / prdr validate locally runnable, verified"}]}
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? — Yes.** The parent (FAFF-639) was the split candidate; this is the clean discovery-half of that cut. It is a single 1–2 day unit with a bounded blast radius (a reporting path plus a `discover` render), and its worst case is a report that over-counts or under-counts — nothing executes differently. The one scope-boundary taste call (the `regions selftest` recogniser, §7) has now been ratified by the human split-decider, so nothing keeps it below high confidence.

**Workstream fit? — Project-less by design, correctly.** Per the split decision, both halves stay project-less in Backlog until there is a gate-confidence outcome ("`faff gates run` predicts CI") to home them in. 848 does not yet deliver that outcome (it makes the gap *visible*, not *enforced*), so leaving it unhomed is right; 639b is the half that earns the outcome.

**Deps surfaced? — The real edge is 848 → 849, already linked.** FAFF-848 blocks FAFF-849 (recorded). 849 consumes 848's coverage numbers to set its caps/threshold and owns the exclusion rules + execution of the wider set. No cross-edge to other tickets. The `--selftest`-family decision is *inside* 849, forced by 849's execution change — not a separate ticket, consistent with the parent methodology critique.

**Risk profile? — Bounded; high confidence is now honest.** 848's uncertainty was entirely in the scope-boundary cut (what to *recognise*), not in mechanism or safety — because it executes nothing. With both human-ratification punts closed by the 2026-08-19 decision, the routing verdict is no longer `needs-decision-first`; 848 is high-confidence buildable.

## Already shipped against this surface

- **FAFF-533 (Done, PR #413)** — added the CI-workflow source (the 4th detector) that 848 extends. It is the foundation, not a superseder: it established `CI_RUNNERS`, `ciRunnerKind`, `extractRunCommands`, and `discoverCiWorkflows`. 848 adds a reporting layer above it; the premise (discovery misses the invariant lints and collapses distinct CI lints) is live and reproduced on current HEAD (6 recognised of 277 lines → 2 rungs, `confident`).
- **FAFF-522 (referenced Done)** — defaulted `gates.fallback: fail-closed`; unaffected here (848 does not touch the fallback).
- No Done ticket covers the invariant-lint recognition, two-tier dedup, or `partial`/coverage — the premise holds. **Proceed.**
