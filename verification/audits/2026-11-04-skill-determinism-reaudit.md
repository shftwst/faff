# Skill-to-determinism re-audit: the next ten collapses

> Dated review at `64ae7d99` (main, 2026-11-04). Written to be worked from: each candidate carries a proposed command and a checkbox. Status marks are the reviewer's at the pinned commit; re-check line numbers before acting on any of them.

This follows up [the 2026-10-22 review](2026-10-22-repo-review-throughput-cull-split.md) §1.4. All ten collapses in that table have landed. This pass classifies the three orchestration skills again with the same method, then ranks the next ten candidates. Under the decided rule, extraction is decided on cost and determinism and is never gated on fidelity measurement.

## Summary

1. The three skills are 440,567 bytes now, against 518,961 at the last review: down 78,394 bytes, or 15.1%. A + C (deterministic sequencing plus prose-implemented rules) still makes up about 63% of graft, 66% of beep-boop and 53% of prep, roughly 274 KB in total.
2. The ten candidates below cover about 79 KB of current prose. Collapsing them should remove about 54 KB, which is about 12% of the three files.
3. Two collapses copy patterns that already exist in the tree. `spec-judge-evidence` should dispatch its judge the way `build-judge-evidence` already does. Graft's review holds should return a descriptor the way prep's `faff spec-review hold` already does.
4. Land FAFF-1428, the rule-inventory check, first, so that each of these ten is checked by CI rather than by review judgement.

## Current sizes

Classes, as in the 2026-10-22 review:

- **A:** deterministic sequencing.
- **B:** judgement.
- **C:** prose-implemented rules.
- **D:** explanation.

Each percentage is a per-section estimate, weighted by bytes.

| File | Lines (10-22 → now) | Bytes (10-24 → now) | A | B | C | D |
|---|---|---|---|---|---|---|
| `faff-graft/SKILL.md` | 957 → 801 | 214,117 → 178,716 | 35% | 9% | 31% | 26% |
| `faff-beep-boop/SKILL.md` | 777 → 667 | 190,917 → 157,460 | 31% | 4% | 35% | 31% |
| `faff-prep/SKILL.md` | 622 → 611 | 113,927 → 104,391 | 29% | 21% | 24% | 26% |

The 10-22 review counted lines, not bytes. The byte baselines are the FAFF-1442 values from 2026-10-24.

The shares have moved because what was taken out was mostly A. Graft's A fell from 45% to 35% once `land`, `worktree ensure`, `graft admit` and `pr open` landed. What remains is weighted towards C: hold and park arms, ledger annotation rules, and return-token mapping. These are written as rules ("never write X on this path") rather than as steps, which makes them easy to miss.

## The next ten

Ranking takes two things into account:

- **Cost:** bytes re-read on every turn. Graft and beep-boop are read on every build and drain turn, and prep on every prep.
- **Determinism:** how much of the section is A + C rather than B.

"Bytes now" is the size of the cited range today. "Est. removed" assumes a one-call replacement and a short routing table, as the last ten collapses used.

| # | Command | Replaces | Bytes now | Est. removed | New or extends |
|---|---|---|---|---|---|
| 1 | `faff run-ledger record-return --issue --token` | graft return values and ledger bucket mapping (772–796); beep-boop ledger annotation arrays (406–411) | 17,634 | ~10,000 | extends `run-ledger record-outcome` |
| 2 | `faff discovered-scope plan` / `record` | beep-boop step 10, containment procedure, orchestrator-lane capture (285–332) | 13,132 | ~8,000 | new; composes `contain`, `self-intake`, `discovered-scope-priority` |
| 3 | `faff spec-judge-evidence --dispatch` | prep spec-review judge, steps 1–3 (221–238) | 8,299 | ~6,000 | extends `spec-judge-evidence` |
| 4 | `faff run wave-boundary --run-dir --wave` | beep-boop step 8.5 wave-boundary stop, `run-done` signal assembly, git-only assembly, capture (267–276) | 7,751 | ~6,000 | new; composes `run-done`, `queue-state`, `prd-checklist`, `runcheck` |
| 5 | `faff review hold --cause outage\|dialogue` | graft Step 9 `unavailable` disposition, `built-but-not-admitted` hold, hold clearing (426–438) | 6,680 | ~5,000 | new; same shape as `spec-review hold` |
| 6 | `faff reconcile --assemble --run-dir` | beep-boop step 11.5 input assembly and step 11.6 annotations (360–378) | 6,881 | ~5,000 | extends `reconcile` |
| 7 | `faff ratified-scope --round` | prep ratified-scope assembly and tracker-resolution fold (105–139) | 5,652 | ~4,000 | extends `ratified-scope` |
| 8 | `faff land` leave-for-human descriptors | graft Step 10 CI-red and no-CI-coverage branches (569–575) | 4,903 | ~3,500 | extends `land` |
| 9 | `faff adr merge-guard --issue` | graft Step 10 ADR/PRDR collision guard and ADR-accept sub-step (543–552) | 4,572 | ~3,500 | extends `adr` |
| 10 | `faff land resume-check --issue` | beep-boop step 4 endgame-only admission (213–222) | 3,633 | ~2,800 | extends `land`; composes `bundle-recover`, `landing-claim` |
| | **Total** | | **79,137** | **~53,800** | |

No candidate adds Commissaire surface. Each one is a faff command that composes existing faff verbs. Where a governed run is involved, the command calls faff's own `effects` verbs and never a new `commissaire` object or verb.

### Candidate detail

- [ ] **1. `run-ledger record-return`.** Takes a graft return token (`shipped`, `pr-ready`, `superseded-done`, `pr-open-for-human`, `needs-human`, `retry-later`, `built-but-not-admitted`, `landing-resumable`, `parked`, `errored`, and the skip tokens). It writes the matching bucket plus the annotation array. For example, `retry-later` writes `parked` and appends to `review_outage_pending`, and `landing-resumable` writes `pr-open` and appends to `landing_resumable`. It then emits the `ledger-write` event itself. Graft keeps one line per token, and beep-boop drops the per-array prose that restates the same mapping. This also closes the "admitted/outcomes stay prose-managed" gap.
  - **Risks:**
    - The skip tokens must never enter `admitted`.
    - `pr-ready` is never a bucket.
    - `outcomes[issue]` stays a bare string.
    - The annotations stay outside the `runcheck` invariant.
  - **Dependencies:** FAFF-1439, which records in-run judgements as events, writes to the same events log. Sequence the two or agree an event shape. FAFF-1428 first.
- [ ] **2. `discovered-scope plan` / `record`.**
  - **What it does:** `plan` globs the per-issue and orchestrator files and dedupes orchestrator entries. It runs `faff contain` and `faff self-intake` against an ancestry file the agent fetched fresh, applies the appetite × methodology gate, and dedupes against an open-ticket list the agent supplies. It returns one `file`, `surface` or `skip` per item, with the create payload, the priority-reason comment and the intake-record argv. `record` writes `discovered_scope_filed` and `discovered-scope-filed.md`.
  - **What stays agent-side:** the tracker creates and the mandate-issue comment, because they are MCP writes.
  - **Risks:**
    - An `outward-new-root` item is never filed at any appetite. This is the hard floor.
    - The ancestry must be fresh at filing time, and a missing or cyclic parent fails to outward.
    - Filing stays serial, in return order. This is the step-7 race argument.
    - A malformed ancestry file means no create.
  - **Dependencies:** none blocking. The L4 eager-filing caller (step 7) and the step 8.0 caller switch at the same time.
- [ ] **3. `spec-judge-evidence --dispatch`.**
  - **What it does:** prep's judge procedure is still prose: a fixed per-proposition order, re-stamping before each correction, the three-tier `max_tokens` fallback, two `review-call.mjs` calls, the 40-character reconstruction check, the imperative scrub between calls, the retry and park disposition through `judgeDispatchDisposition`, and the exactly-one-block parse. `build-judge-evidence --assemble` already runs the same two-phase dispatch in code. Port that. Applying a ruling's `correction` to the spec stays agent-side, behind a `needs-judgement:correction` token, unless the correction shape is mechanical.
  - **Risks:**
    - Re-stamp `pre_ruling_spec_sha` before applying any earlier correction.
    - Phase 1 never sees `argument_A` or `argument_B`.
    - The judge backend must sit outside the refuter set.
  - **Dependencies:**
    - FAFF-1420: the admit roll-up records the judged spec digest.
    - FAFF-1273: the judge's ratified scope.
    - FAFF-1285: the build judge's `no-verdict-block` on an exit-0 phase 2. Do not port that defect.
- [ ] **4. `run wave-boundary`.**
  - **What it does:** resolves the level, the opt-out (`--converge` / `--no-converge`, which are mutually exclusive and inert at L4) and git-only. It keeps the `no_progress_waves` counter on the ledger and assembles `RunSignals`:
    - queue emptiness from `queue-state derive`, where any fault omits both flags;
    - exactly one of `--prd-coverage` or `--no-prd`;
    - `--ledger-clean` from `runcheck`;
    - `--budget` from the checkpoint;
    - `--non-convergence` at `convergence.max_waves`.

    It then calls `run-done` in-process and writes both decision captures with one `--wave`. Beep-boop routes on the returned verdict.
  - **Risks:**
    - A fault must default to `continue`, never `run-complete`.
    - The counter resets on admission, never on filing.
    - Pass PRD-checklist content as argv, never through a shell string.
  - **Dependencies:** FAFF-1452 wires step 8's per-item `faff next` consult in the same section. Land it first, or fold it in.
- [ ] **5. `review hold`.**
  - **What it does:** reads `build-progress`, the review-progress `outage_retries` and the resume-store `hold_count`, using the exit 0/2/3/4 rules. It applies the retry or hold limit, stashes with `--fix-rounds-used` and `--rebuttal-rounds-used`, releases the build claim, and returns `{action: hold|park, token, label_ops, status: In Progress→Todo, comment}`. This is the descriptor prep's `spec-review hold` already returns. Graft applies the `label_ops` and status through MCP. A `--clear` mode covers the terminal-disposition housekeeping.
  - **Risks:**
    - A hold never writes `review-verdict.json`, because that would fail-close `merge-gate` on resume.
    - A corrupt counter means needs-human and is never read as 0.
    - Stash exit 4 is retried once.
    - The hold applies `faff-awaiting-review` or `awaiting-adjudication`, never `faff-parked`.
  - **Dependencies:**
    - FAFF-1330: a resumed build holds no claim. It shares the claim-release seam; fix it there or with it.
    - FAFF-1335.
- [ ] **6. `reconcile --assemble`.**
  - **What it does:** builds `ReconcileInput` from the run directory and the forge:
    - `merge-record.json` against `gh pr view --json state,headRefOid` (git-only: `git merge-base --is-ancestor`);
    - `supersession.json` with delivery observations;
    - the `sibling_baseline` attestation.

    Sibling live states come from a facts file the agent writes, the pattern `run summary` already uses. It also writes the step 11.6 `post_merge_verification_*` annotations. It pipes the result to the existing pure gate.
  - **Risks:**
    - Compare `headRefOid`, never `mergeCommit`; a squash merge always has a new commit sha.
    - An unreadable record passes as `recorded: null`.
    - Omit `sibling_baseline` when the file is unreadable, and never write `{captured: false}`.
  - **Dependencies:** FAFF-1227 is adjacent (`effects reconcile-merges`, a different gate). Nothing blocks.
- [ ] **7. `ratified-scope --round`.**
  - **What it does:** reads the PRD root container from the ledger and runs `--assemble` with exit-code routing. It filters the agent-supplied comment list through `decisions intent-status`, drops automation-authored intents, dedupes by topic (latest timestamp wins), runs `--fold-resolutions` and writes the stderr warnings to the round audit log. It returns `ok`, `empty` or `needs-human`.
  - **Risks:**
    - On exit 2 (unreadable source), route to needs-human and never dispatch with an empty block.
    - The marker gate (`intent-live` only) stays.
  - **Dependencies:** FAFF-1273, which gives the judge the same block.
- [ ] **8. `land` leave-for-human descriptors.**
  - **What it does:** `faff land` already owns CI triage, re-runs and the flaky budget. Graft Step 10 still restates the `main-was-red`, re-run, fault-domain and no-CI-coverage routing it replaced. Have each `leave-for-human:*` token carry its park descriptor (draft flip, label ops, comment with the named gap) and delete the restated prose.
  - **Risks:**
    - No CI coverage is never green.
    - The interactive `--allow-no-ci` and `--human-override` stay as commands printed for the human's own TTY.
    - `main-was-red` spends no fix attempt.
  - **Dependencies:** FAFF-1111 (resume-at-merge locus) touches the same exit. Nothing blocks.
- [ ] **9. `adr merge-guard`.**
  - **What it does:** the ADR and PRDR collision guard and the ADR-accept sub-step are fully mechanical: diff-filter for added ADRs, validate, renumber the incoming file, re-validate, stage by explicit path, run `stage-guard`, commit and push. One command does it and returns `clean`, `renumbered` or `needs-human`.
  - **Risks:**
    - A duplicate already on the merge target means needs-human, and nothing is renumbered.
    - Accept runs only after the holdout gate passes and after the renumber.
    - Never `git add -A`.
  - **Dependencies:** FAFF-1429. The renumber and accept commits reuse the `commit_subject` scheme, which graft prose still reuses after Step 4 stopped resolving it. Settle the scheme's home first.
- [ ] **10. `land resume-check`.**
  - **What it does:** runs beep-boop's eight-step endgame-only admission as one command: `bundle-recover`, then the `bundle_store: git-remote` gate, then an open-PR read, then `fix_cycles < 3`, then `landing-claim acquire` with the PR head sha. It returns `resume {run_dir, pr, fix_cycles, claim_sha}` or `claimed-by-peer`.
  - **Risks:**
    - Every ambiguity collapses to `claimed-by-peer`.
    - The issue is never appended to `admitted`.
    - Never reclaim against a stale head sha.
  - **Dependencies:** none.

### Considered and not ranked

Smaller A + C sections, each under 3.5 KB, that could join a neighbouring collapse:

- graft 8b build-complete push and checkpoint (3,073 bytes);
- graft custody-stamp sub-step (2,544);
- graft review-progress resume triage (2,358);
- graft post-merge verification routing (2,404);
- beep-boop prep-queue return reconcile (2,048);
- beep-boop ledger record and sibling snapshot (2,066);
- prep's confidence × marker × verdict promotion gate and self-verify (3,509).

Graft's four governed-run effect brackets (4,892 bytes in total) cut across steps. Each one should fold into whichever command performs the bracketed write as that command lands, rather than becoming a separate command.

### Excluded

**Covered by an open ticket:**

- approve-path dispositions in collate-evidence (FAFF-1409);
- beep-boop step 2 and step 8 `faff next` consult wiring (FAFF-1452);
- `setup-worktree.sh` and `worktree ensure` (FAFF-1454);
- in-run judgement events (FAFF-1439);
- the `spec commit` advisory and scheme (FAFF-1429);
- run-trigger self-direction (FAFF-1455).

**Mostly judgement (B), so out of scope for extraction:**

- graft resolve-attempt before park;
- prep's design-lens ratify path and its decision-versus-implementation scope test;
- prep's premise-superseded call;
- prep's spec-review surface classification;
- graft Step 4b contradiction detection;
- the Step 4c consistency backstop.

## Order of work

- [ ] Land FAFF-1428 (rule-inventory check) before the first of these ten.
- [ ] Each collapse lowers `SKILL_LINE_BASELINE` and `prose-baseline.json` with `faff prose-size baseline --lower`, and carries a `## Rule inventory` in its spec.
- [ ] Candidates 1, 4 and 6 all touch the run ledger or run-end. Run them in sequence, not in parallel, to avoid the rebase churn the last batch saw on `build-manifest.json` and the baselines.

## Method and limits

The method was one read-only pass over the three files at `64ae7d99`. Section byte sizes come from a heading-split count, and each candidate's "Bytes now" is the exact size of its cited line range. The A/B/C/D shares are per-section estimates weighted by bytes, so they are approximate. Estimated removals assume the same density as the last ten collapses and are not measured. Open-ticket overlap was checked against the FAFF Backlog on 2026-11-04. No file other than this one was changed, and no ticket was filed.
