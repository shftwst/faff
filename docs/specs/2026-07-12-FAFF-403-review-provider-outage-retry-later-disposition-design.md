# Spec — FAFF-403: Review-provider outage → retry-later/awaiting-review disposition, auto-resume the tail

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-403.

This spec defines how faff-graft dispositions the `unavailable` review-verdict signal (FAFF-405) as a **resumable hold** instead of a human park, and how the next beep-boop drain auto-resumes the review tail. Audience: the build agent and human reviewers. It composes directly on FAFF-405's spec (serialised before this issue in the same run) and changes **behaviour only** — no new review signal, no contract-vocabulary change.

## 1. WHY

**Load-bearing model:** an `unavailable` verdict means *the reviewer was down*, not *the work is suspect*. Since FAFF-402 the built work is durable at review time (branch pushed + `build-progress.json` checkpoint) and since FAFF-329 the review tail is resumable (`review-progress.json` phase checkpoints). So on an outage graft can release its claim (issue → Todo, tagged `faff-awaiting-review`), hold the built work, and let the next drain re-dispatch it straight into the existing resume path — a fresh review attempt with **no rebuild**. A bounded per-issue retry counter keeps a persistent outage from looping forever: after N held attempts it escalates to the standard `needs-human` park.

**Problem:** post-FAFF-405, a mandatory-review outage parks `needs-human` — a human is woken for a transient provider failure although nothing is wrong with the work. The recovery (re-run the review when the provider is back) is fully mechanical, and all the machinery to do it already exists.

**Design principles:**

- **Fail-closed is untouched.** `unavailable` never merges: `faff merge-gate` / `decideFloor` block any non-`pass` (no code change), and the hold path opens no PR. The retry-later arm changes *where the issue waits*, never *what may merge*.
- **Never silent-forever.** Every hold leaves a tracker marker (label + comment + run-summary subsection); a persistent outage escalates to `needs-human` after `graft.review_outage_retry_limit` (default 3) held attempts.
- **A hold is not a park.** `faff-parked` feeds `faff next --parked` → `needs-human`, which would block re-queue. The hold uses a distinct control label the transition function never reads, so the issue routes `graft` naturally on the next drain.
- **Resume state is mechanical and run-agnostic.** Checkpoints are per-run-dir, but the hold must survive into the *next* run. A run-agnostic resume store that mirrors the run-dir layout lets the existing `read` verbs work verbatim.

**Reference context:**

| Surface | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/effects.js` | `cmdReviewProgress` / `cmdBuildProgress` + selftests — gains `--outage-retry` |
| `plugin/skills/faff/bin/lib/labels.js`, `label.js` | `CONTROL_LABELS` manifest + `faff label` op — gains `faff-awaiting-review` |
| `plugin/skills/faff/bin/lib/config.js` | `DEFAULTS` registry — gains `graft.review_outage_retry_limit` |
| `plugin/skills/faff/bin/lib/runcheck.js` | `TERMINAL_STATES` — unchanged; annotation rides outside the invariant |
| `plugin/skills/faff-graft/SKILL.md` | Step 3 resume check, Step 9 signal table, Autonomous Step 4, Return values |
| `plugin/skills/faff-beep-boop/SKILL.md` | ledger annotation + run-summary subsection |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md`, `faffter-dark-concurrency-parallel/SKILL.md` | return-token → bucket mapping rows |
| `plugin/skills/faff/SKILL.md` (gateway) | status-monotonicity carve-out; control-label list prose |
| `plugin/skills/faff-wtf/SKILL.md`, `faff-tidy/SKILL.md` | interim surfacing + stale-label auto-clear |

**Scope:** the closing behavioural slice of the review-tail-resilience chain (FAFF-398 → FAFF-405 → this): an outage never silently skips the gate (398), is a first-class signal (405), and is now retryable (this).

## Already shipped against this surface

Related Done work — none supersedes this delta (verified in-repo; the project itself has no Done issues):

- FAFF-402 (Done) — `build-progress` checkpoint + graft Step-3 resume-at-review; this ticket *consumes* it.
- FAFF-329 (Done) — `review-progress` phase checkpoints + Step-9 review resume; consumed likewise.
- FAFF-398/FAFF-401 (Done) — mandatory chain-outage fail-closed (exit 9) + ledger-derived mandatory-ness; unchanged here.
- No existing code or prose dispositions `unavailable` at all before FAFF-405 landed (this run) — the premise holds in full.

## 2. OUT OF SCOPE

- **The `unavailable` signal itself** — FAFF-405 (merged ahead of this build). This spec assumes it; see Assumptions.
- **Deadline exhaustion (exit 8)** — FAFF-429 extends this same retry-later disposition to `skipped_deadline`; extension point: the arm-condition list in HOW (a) — add the exit-8 signal source there, nothing else moves.
- **Durable disposition sink** — FAFF-396 (tracker-comment/exit-code surfacing for all lights-out dispositions). Interim surfacing here = run-summary subsection + `/faff-wtf` label query; extension point: the annotation + label are exactly what FAFF-396 will consume.
- **`review-call.mjs` exit logic** — untouched; exit 9 still surfaces as the slot's terminal outage outcome. Only graft's disposition of the resulting signal changes.
- **Within-run wave recovery** — beep-boop's wave re-entry excludes issues already terminal this run ("once parked in this run, always parked in this run"); a held issue is re-picked by the **next drain**, never the same run. Deliberate: recovery time ≈ provider-recovery time anyway.

## 3. WHAT

**Vocabulary:**

| Term | Definition |
|---|---|
| retry-later | graft's new pre-PR terminal disposition for `unavailable`: hold + release claim + re-queue signal |
| awaiting-review hold | the tracker state of a held issue: status Todo + label `faff-awaiting-review` |
| resume store | `.faff/resume/<ISSUE-ID>/` — run-agnostic copy of the two checkpoint files, the cross-run handoff |
| outage-retry counter | `outage_retries` (top-level int, `review-progress.json`) — held attempts so far; absent = 0 |

**New/changed surfaces:**

1. **Control label** — `CONTROL_LABELS` (labels.js) gains `faff-awaiting-review` (machine-writable, no `tracker_owned` flag, like `faff-parked`). Manifest-driven `faff label add|remove` accepts it with no further code change. Gateway's two prose recitations of the label set updated.
2. **Counter flag** — `faff review-progress write <dir> <issue> --outage-retry`: increments top-level `outage_retries` (absent → 1), preserves all other fields, requires an existing record (exit 2 if none), combinable with nothing else.
3. **Config knob** — `graft.review_outage_retry_limit`, default `"3"`, registered in `DEFAULTS` + `config defaults --selftest`. `graft.*` namespace: graft owns the disposition loop.
4. **Resume store** — `.faff/resume/<ISSUE-ID>/{build-progress.json, review-progress.json}`, mirroring the `<run-dir>/<ISSUE>/` layout. Stash/clear are two-file prose ops at graft's disposition/terminal sites — no new CLI subcommand.
5. **graft** — a fourth `unavailable` arm in the Step-9 signal table, the pre-PR terminal-states lists, and Return values: new caller-facing token `retry-later` (maps to ledger bucket `parked`). Plus the Step-3 resume-store fallback.
6. **Concurrency executors** (both) — mapping row: `retry-later` → bucket `parked` and append the issue id to the ledger's top-level `review_outage_pending` array (annotation-not-bucket, mirrors `review_adversarial_skipped`).
7. **beep-boop** — ledger example gains `"review_outage_pending": []`; run summary gains `## Awaiting review (adversarial outage): N`.
8. **Gateway** — a scoped carve-out sentence in *Issue claim & status monotonicity*: only `In Progress → Todo`, only by the claim-holder, only in the retry-later arm, always paired with the label + resume-store stash, never from In Review/Done.
9. **Interim surfacing** — until FAFF-396 exists: (a) the run-summary subsection above; (b) `/faff-wtf` gains an *Awaiting review* line driven by a live tracker query for `faff-awaiting-review`; (c) `/faff-tidy`'s stale-label auto-clear extends to `faff-awaiting-review`.

## 4. HOW

### (a) The disposition arm (graft Step 9 / Autonomous Step 4)

On a final review signal `unavailable` (today produced only by the mandatory L4 chain-outage, exit 9 — so the arm is de-facto lights-out):

```
PROCEDURE disposition_unavailable(run_dir, issue):
  1. IF NOT autonomous → needs-human park (FAFF-405's arm, unchanged: write review-verdict.json, park protocol)
  2. checkpoint := faff build-progress read run_dir issue        # presence == FAFF-402 ran (knob on, push succeeded)
  3. retries    := review-progress.json outage_retries (absent → 0)
  4. IF checkpoint absent OR retries >= faff config get graft.review_outage_retry_limit:
       → needs-human park: write review-verdict.json (persist the unavailable verdict),
         apply faff-parked + park comment citing "review-provider outage, N held attempts exhausted"
         (or "no build-complete checkpoint"), remove faff-awaiting-review if present,
         rm -rf .faff/resume/<issue>. Return needs-human.
  5. ELSE retry-later:
       a. do NOT write review-verdict.json                       # not a terminal verdict; see anti-pattern
          (review-progress.json phase2 stays in_flight — the slot set it before the call; exit 9 writes no phase2 status)
       b. faff review-progress write run_dir issue --outage-retry
       c. mkdir -p .faff/resume/<issue>;
          cp run_dir/<issue>/{build-progress.json,review-progress.json} .faff/resume/<issue>/
       d. faff label add <issue> faff-awaiting-review            # descriptor → single tracker write, ensure-first
       e. status In Progress → Todo                              # the scoped claim-release (gateway carve-out)
       f. tracker comment: hold notice — "review provider unavailable; build held (branch pushed,
          checkpoint intact); attempt <n>/<N>; auto-resumes at review on the next drain"
       g. return retry-later (no PR; executor records bucket parked + review_outage_pending annotation)
```

### (b) Re-queue and resume (next drain)

No queue-side recognition code is needed — a held issue is Todo + attached `confidence: high` spec + eligible + **not** `faff-parked`, so `faff next` returns `graft` and beep-boop's existing queue assembly admits it. Recovery hooks live entirely in graft:

```
PROCEDURE resume_at_review(run_dir, issue):                      # graft Step 3, autonomous
  1. faff build-progress read run_dir issue                      # existing FAFF-402 check
  2. ON exit 3 AND issue labels include faff-awaiting-review:
       faff build-progress read "$repo/.faff/resume" issue       # the fallback — same CLI, mirrored layout
       a. exit 3 → stale label (store lost): log, proceed as a fresh build
       b. exit 0 → validate per the existing FAFF-402 rule (git fetch; branch exists;
          cur diff-hash == checkpoint). Mismatch/branch gone → discard store (rm -rf), fresh rebuild.
       c. valid → CARRY FORWARD: cp .faff/resume/<issue>/*.json run_dir/<issue>/
          then resume exactly as FAFF-402/329 prescribe: worktree add the existing branch,
          skip Steps 4–7, re-run 7.5+8, Step 9 reads review-progress.json
          (phase1 pass + matching diff_hash → skip Phase-1; phase2 in_flight → run Phase-2 fresh)
  3. Terminal dispositions after a resumed review:
       shipped            → remove faff-awaiting-review + rm -rf .faff/resume/<issue>
       fail / needs-human → standard arms; remove faff-awaiting-review; clear store
       unavailable again  → disposition_unavailable() — counter now reads the carried file, so it increments across drains
```

**Anti-pattern:** writing `review-verdict.json` on the hold. **Anti-pattern:** dual-tagging `faff-parked` on a hold. **Anti-pattern:** a new ledger bucket or `TERMINAL_STATES` entry. **Anti-pattern:** widening the monotonicity carve-out beyond In Progress → Todo by the claim-holder.

## 5. Scenarios

```
Given a lights-out build with a build-progress checkpoint and outage_retries = 0
When the mandatory review chain exhausts and the final signal is unavailable
Then no review-verdict.json is written, outage_retries = 1, .faff/resume/<issue>/ holds both
     checkpoints, the issue is Todo + faff-awaiting-review, the ledger records parked +
     review_outage_pending: [issue], and no PR exists
```

```
Given a Todo issue tagged faff-awaiting-review with a valid resume store (branch intact, hash matches)
When the next drain dispatches graft on it
Then graft recreates the worktree from the existing branch, skips build (Steps 4–7),
     skips review Phase-1, and runs Phase-2 as a fresh attempt — no rebuild
```

```
Given outage_retries = 3 (== graft.review_outage_retry_limit) carried into the current run
When the review signal is unavailable again
Then graft parks needs-human: review-verdict.json written, faff-parked applied,
     faff-awaiting-review removed, resume store cleared
```

```
Given an unavailable signal in an interactive graft, or with no build-progress checkpoint
When the disposition runs
Then the FAFF-405 needs-human park applies unchanged
```

Assertions (non-functional): a `critical` finding still → `needs-human` (untouched); `unavailable` is never merge-eligible on any path; every hold leaves a tracker comment + label; `runcheck` passes on a ledger containing `review_outage_pending`.

## 6. Design decision rationale

- **Where does the retry bound live?** Stored counter in `review-progress.json` — the arm needs an O(1) read at disposition time in the same artifact the resume path already carries.
- **Knob namespace?** `graft.*`, registered in `DEFAULTS` — graft owns the disposition loop.
- **Cross-run handoff?** `.faff/resume/<ISSUE>/` mirroring the run-dir layout (zero new read paths; holdout dual-home precedent).
- **Label semantics?** New `faff-awaiting-review` — parked means "automation needs a human"; a hold means "automation is waiting for a machine".
- **Status release?** Release to Todo with a scoped gateway carve-out — a held In Progress issue would look claimed to every peer and to beep-boop's own next drain.
- **Escalation artifact?** On retries-exhausted, persist the `unavailable` verdict so the parked state is inspectable and the merge floor stays blocked.

## 7. Open questions and assumptions

Open questions: none — all four ticket questions are settled above.

Assumptions:

- **Assumes:** FAFF-405's `unavailable` signal exists (schema enum + `computeReviewVerdict` SIGNALS + graft's fourth needs-human arm) — validated before build (merged as commit 23307e6 / PR #319, confirmed via `grep -n '"unavailable"'` hitting `contract-defs.js` + `review-verdict.schema.json`).
- **Assumes:** FAFF-402/329 machinery is present as explored — `cmdBuildProgress`/`cmdReviewProgress` in `effects.js`, graft Step-3 *Resume-at-review check* and Step-9 *Resume from a review-progress checkpoint* prose.

## 8. DONE

### From WHY / WHAT (vocabulary + surfaces)
- [x] `faff labels` emits `faff-awaiting-review` (machine-writable, no `tracker_owned`); `faff label add <i> faff-awaiting-review` exits 0 with a descriptor; gateway's two label-list prose sites updated.
- [x] `faff review-progress write <dir> <i> --outage-retry` increments `outage_retries` (absent → 1; preserves phase fields); on a missing record exits 2. Selftest cases + `test/review-progress.test.mjs` coverage added.
- [x] `faff config get graft.review_outage_retry_limit` prints `3` with no `.faffrc` entry (DEFAULTS-registered; `config defaults --selftest` updated).

### From HOW (a) — the hold
- [x] autonomous + checkpoint + retries < N + `unavailable` → **no** `review-verdict.json`; counter incremented; both checkpoints copied to `.faff/resume/<i>/`; `faff-awaiting-review` applied; issue moved In Progress → Todo; hold comment posted; graft returns `retry-later`.
- [x] Both concurrency executors map `retry-later` → bucket `parked` + append to `review_outage_pending`.
- [x] no checkpoint, or interactive, or retries ≥ N → needs-human park unchanged.
- [x] A `critical` finding still routes `needs-human` (no retry-later arm fires on it).

### From HOW (b) — the resume
- [x] graft Step-3: run-dir miss + `faff-awaiting-review` → resume-store read; valid store → carry-forward, worktree from existing branch, Steps 4–7 skipped, Phase-1 skipped, Phase-2 fresh.
- [x] Counter carries across drains (unit-tested in `reviewProgressApplyOutageRetry`/CLI tests).
- [x] Hash-mismatch / missing branch / missing store → fresh rebuild + store cleared.
- [x] Terminal dispositions clear the hold.

### From WHAT 8–9 — prose/surfacing
- [x] Gateway monotonicity section carries the scoped carve-out.
- [x] beep-boop: ledger example + run-summary subsection; `/faff-wtf` surfaces via a live label query; `/faff-tidy` auto-clears a stale hold label.
- [x] `faff validate-adapters` + `node --test` green.

confidence: high
