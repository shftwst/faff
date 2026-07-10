# merge-gate — report a merged PR as merged on a non-zero post-merge `gh pr merge` exit

> Spec: faffter-dark-nlspec · 2026-07-05 · autonomous · confidence: high

confidence: high
spec-review: approve

## 1. WHY — Problem and Principles

**Load-bearing model.** `gh pr merge` does two things in one invocation: it merges the PR, then optionally runs *post-merge* steps (`--delete-branch`, `--auto` bookkeeping). Its exit status is a single bit that conflates both. A non-zero exit does **not** mean "the merge failed" — it can equally mean "the merge landed and a *follow-up* step failed." The authoritative truth of whether the branch is on `main` is the PR's `state`, not the CLI exit code.

**Problem statement.** Today `cmdMergeGate` treats any non-zero `gh pr merge` exit as a hard refusal (`verdict: refuse`, `merged: false`, exit 1) without re-reading PR state. When the merge already succeeded but `--delete-branch` (or a follow-up network call) failed, the gate reports a refusal while the PR is on `main`; the default ship producer then emits a `failed` delivery-outcome — a silent partial success the contract cannot detect. This change re-reads PR state on a non-zero exit and reports `merge-ok (merged)` with a warning when the PR is in fact merged.

**Design principles.**

- **PR `state` is authoritative over CLI exit code.** The merged/not-merged decision is made from a re-read `gh pr view --json state`, never from the `gh pr merge` exit status alone. The exit status only *triggers* the re-check.
- **A post-merge-step failure is a warning, not a blocker.** `blockers` entries read as *reasons the gate refused to merge*; a merged PR did not refuse, so the failed follow-up step rides as a non-fatal `warnings`/`note`, never as a `blocker`.
- **Deterministic tools over prose.** The merged-vs-refuse decision on a non-zero exit is a pure function of `(merge exit status, re-read state)` — extracted into a pure, `--selftest`-covered classifier mirroring `decideFloor` / `parseMergeArgs`, not left as untested imperative shell.
- **No double-merge risk.** The re-read is read-only; it never re-issues a merge. The existing top-of-function idempotent `state === MERGED` short-circuit (which already makes a *re-run* safe) is untouched.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` → `cmdMergeGate` | Node CLI | The merge-gate shell; the non-zero-exit branch is the change site |
| `plugin/skills/faff/bin/faff` → `decideFloor`, `parseMergeArgs` | Node | Pure cores + `mergeGateSelftest` — the pattern the new classifier follows |
| `plugin/skills/faff/bin/faff` → `emit(res, status)` helper | Node | Prints `verdict (merged) — CI …` and iterates `blockers`; extended to print warnings |
| `test/merge-gate.test.mjs` | Node test | Pure-selftest lane; gains the classifier's verdict/exit table |
| `ghJson([...])` helper | Node | Existing wrapper used for the top-of-function state read; reused for the re-read |

**Note on FAFF-376 overlap (build-time addendum).** Since this spec was authored, FAFF-376 landed and added `classifyMergeFailure` (head-drift / pin-unsupported / generic) as the existing refuse-path blocker generator, plus a head-sha pin (`--match-head-commit`) on the merge spawn. This build layers the FAFF-365 re-check **on top of** that unchanged machinery: `classifyPostMerge` decides merged-vs-refuse from the re-read state; on a genuine refuse it still is, unchanged, `classifyMergeFailure` that supplies the blocker's specific wording — so the FAFF-376 refuse-path behaviour and its tests are untouched, and the new merged-despite-nonzero-exit branch is additive.

**Scope statement.** A localised hardening of the merge-gate's outcome reporting on the impure merge-execution path — it does not alter the pure floor decision (`decideFloor`) that gates *whether* a merge is attempted.

## 2. OUT OF SCOPE

- **Retrying or completing the failed post-merge step** (e.g. deleting the branch ourselves). — Why excluded: the merge is done; branch cleanup is cosmetic and out of the gate's contract. — Extension point: a future ship-producer post-merge hook in `slots.ship`.
- **Changing `decideFloor` or the pre-merge floor decision.** — Why excluded: the bug is purely in reporting the *result* of an executed merge, not in deciding whether to merge. — Extension point: `decideFloor` in the same file.
- **The `--check-only` / `--human-override` / already-merged paths.** — Why excluded: none reach the `gh pr merge` execution branch being changed. — Extension point: their existing branches in `cmdMergeGate`.
- **Distinguishing *which* post-merge step failed** (delete-branch vs auto vs network). — Why excluded: the warning surfaces the raw `gh` stderr; parsing it adds no decision value. — Extension point: the warning string if a future consumer needs structured causes.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Post-merge partial success | `gh pr merge` exits non-zero, but the PR is nonetheless `MERGED` — the merge landed and a follow-up step failed |
| Post-merge classifier | New pure function deciding `merge-ok` vs `refuse` from `(merge exit, re-read state)` |

**New pure function** (added near `classifyMergeFailure` / `decideFloor` / `parseMergeArgs`):

```
FUNCTION classifyPostMerge(input):
  # input:
  #   merge_ok: Boolean        # gh pr merge exited zero
  #   post_state: String|null  # re-read PR state ("MERGED" | "OPEN" | "CLOSED" | null-if-unreadable)
  #   merge_stderr: String     # trimmed stderr from gh pr merge (for the message)
  # returns:
  RECORD PostMergeDecision:
    merged: Boolean            # true iff the PR is on main
    outcome: "merged" | "refuse"
    warning: String|null       # non-fatal note when merged-despite-nonzero-exit; else null
    blocker: String|null       # refusal reason when not merged; else null
```

Decision table (the whole contract of the function):

| `merge_ok` | `post_state` | `outcome` | `merged` | warning | blocker |
|---|---|---|---|---|---|
| `true` | (not consulted) | `merged` | `true` | none | none |
| `false` | `MERGED` | `merged` | `true` | `"gh pr merge exited non-zero after the merge landed (post-merge step failed): <stderr>"` | none |
| `false` | `OPEN`/`CLOSED`/anything ≠ `MERGED` | `refuse` | `false` | none | `"gh pr merge rejected: <stderr>"` |
| `false` | `null` (state unreadable) | `refuse` | `false` | none | `"gh pr merge rejected: <stderr> (post-merge state re-read failed)"` |

**Chosen:** on `merge_ok=false` with an **unreadable** re-read (`post_state=null`), fail closed to `refuse`. Rationale: we cannot prove the PR is merged, and the pre-existing behaviour was already `refuse`; a re-run's idempotent top-of-function check will correctly report `merge-ok` once state is readable, so we lose nothing by refusing now rather than guessing merged.

**Production wiring (build-time addendum).** `classifyPostMerge` decides *branching* (merged vs refuse). On the `merged` branch it also supplies the warning text. On the `refuse` branch, production code keeps using the already-shipped `classifyMergeFailure(stderr, headSha)` for the blocker's specific wording (head-drift / pin-unsupported / generic) — `classifyPostMerge`'s own `blocker` field is exercised standalone in `--selftest` (satisfying its decision-table contract as a pure function) but is not what production prints on refuse, so FAFF-376's existing refuse-path tests and messages are unchanged.

## 4. HOW — Behavior

**Approach.** Split the current single-branch post-merge handling into: (1) run `gh pr merge`; (2) if it exited zero, keep today's success path unchanged; (3) if non-zero, re-read state via the existing `ghJson(["pr","view", String(pr), "--json","state"])` wrapper, feed `(merge_ok=false, post_state, merge_stderr)` into `classifyPostMerge`, and map its result onto `result`.

```
PROCEDURE execute_merge(pr, parsedMerge, result, blockers):
  1. m := spawnSync("gh", ["pr","merge", pr, ...parsedMerge.flags, "--match-head-commit", headSha], timeout 120s)
  2. IF m.status == 0:
     a. result.merged = true; result.verdict = "merge-ok"
     b. RETURN emit(result, 0)                      # unchanged success path
  3. # non-zero exit — re-read authoritative state
     sv := ghJson(["pr","view", pr, "--json","state"])
     post_state := (sv.ok AND sv.data) ? sv.data.state : null
     pm := classifyPostMerge({ merge_ok:false, post_state, merge_stderr: (m.stderr||"non-zero exit").trim() })
  4. IF pm.outcome == "merged":
     a. result.merged = true; result.verdict = "merge-ok"
     b. result.warnings = [...(result.warnings||[]), pm.warning]
     c. RETURN emit(result, 0)                      # partial success: PR is on main
  5. ELSE:
     a. cls := classifyMergeFailure(mergeStderr, headSha)   # unchanged FAFF-376 wording
     b. result.verdict = "refuse"
     c. result.blockers = [...blockers, cls.blocker]
     d. RETURN emit(result, 1)                      # genuine refusal, as today
```

**emit() extension.** After printing blockers, `emit` also prints any `res.warnings` as non-fatal lines (`  ⚠ <warning>`), and includes `warnings` in the `--json` object (already automatic since it serialises `res`). The `verdict (merged)` header already renders correctly for the merged-with-warning case because `res.merged` is true.

**Edge cases.**

- **Merge zero-exit:** untouched — no re-read, no warning.
- **Non-zero exit, re-read shows MERGED:** exit 0, `merged: true`, one warning line, no blockers.
- **Non-zero exit, re-read shows OPEN/CLOSED:** exit 1, `merged: false`, blocker = `classifyMergeFailure`'s wording (behaviour-identical to today).
- **Non-zero exit, re-read itself fails** (`gh` unreachable): exit 1, `refuse`, blocker unchanged (`classifyMergeFailure`'s wording) — fail-closed.

**Failure modes.**

- **The failure:** a `gh pr view --json state` re-read could return stale state right after a merge, reporting `OPEN` when the PR is actually merged. — **How you'd know:** the gate reports `refuse` but the PR is on `main`; the next re-run's top-of-function idempotent check returns `merge-ok (merged)`. — **What it means:** proceed — the fail-closed direction plus idempotent re-run recovery means a stale read costs at most one spurious refuse that self-heals, never a false `merged`.
- **Anti-pattern:** treating `merge_ok=false` as `merged` when the re-read is unreadable. Why: it would fabricate a success the gate cannot prove, defeating fail-closed.

## 5. SCENARIOS — born-verifiable main objectives

```
Given `gh pr merge` exits non-zero but the PR state re-reads as MERGED
When cmdMergeGate handles the merge result
Then it reports verdict "merge-ok", merged true, exit 0, with a non-blocking warning naming the failed post-merge step
```

```
Given `gh pr merge` exits non-zero and the PR state re-reads as OPEN (or the re-read fails)
When cmdMergeGate handles the merge result
Then it reports verdict "refuse", merged false, exit 1, with the gh error as a blocker (behaviour preserved)
```

These map onto `classifyPostMerge`'s pure decision table, exercised in the `--selftest` lane (no network), mirroring how `decideFloor` is selftested.

## 6. DESIGN DECISION RATIONALE

**Where does the merged-vs-refuse decision on a non-zero exit live?**
- *Inline in the shell* — pro: fewer moving parts; con: untestable without network, violates deterministic-tools-over-prose.
- *Pure classifier + selftest* — pro: born-verifiable, matches the file's established `decideFloor`/`parseMergeArgs` pattern; con: one small function added.
- **Chosen:** pure classifier `classifyPostMerge` wired into `mergeGateSelftest` and asserted in `test/merge-gate.test.mjs`. — Rationale: the impure gh path stays a thin shell; the *decision* is deterministic and tested.

**How does the failed post-merge step surface?**
- *As a blocker* — con: blockers read as refusal reasons; a merged PR did not refuse.
- *As a warning/note* — pro: honest — merged, but with a caveat.
- **Chosen:** a `warnings` array on the result + a `⚠` line in `emit`, never a blocker. — Rationale: preserves the semantic that `blockers` are why-we-refused.

**What on an unreadable re-read?**
- **Chosen:** fail closed to `refuse` (see §3). — Rationale: never fabricate an unprovable merged; the idempotent re-run recovers it.

**How does this interact with the already-shipped FAFF-376 `classifyMergeFailure`?**
- **Chosen:** `classifyPostMerge` owns the merged-vs-refuse branch; `classifyMergeFailure` keeps owning the refuse-path blocker's specific wording, unchanged. — Rationale: additive change, zero regression risk to FAFF-376's shipped behaviour/tests.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** `gh pr view --json state` returns a `state` field whose merged value is the literal `"MERGED"` (same enum the top-of-function idempotent check already relies on). — Validate: the existing code already branches on `hv.data.state === "MERGED"`; reuse the same comparison.
- **Assumes:** the `ghJson` helper and `emit` closure are in scope at the change site. — Validate: both are already used within `cmdMergeGate`.

## 8. DONE — Definition of Done

### From WHY
- [x] A non-zero `gh pr merge` exit no longer forces `refuse` when the PR is actually merged; it reports `merge-ok (merged)` with a warning.
- [x] Genuine merge failures (PR not merged) still report `refuse` / exit 1 exactly as before.

### From WHAT (types and interfaces)
- [x] A pure `classifyPostMerge(input)` function exists near `classifyMergeFailure` / `decideFloor`, returning `{ merged, outcome, warning, blocker }` per the decision table.
- [x] `merge_ok=false` + `post_state="MERGED"` → `{ outcome:"merged", merged:true, warning≠null, blocker:null }`.
- [x] `merge_ok=false` + `post_state≠"MERGED"` (incl. `null`) → `{ outcome:"refuse", merged:false, blocker≠null, warning:null }`.

### From HOW (behaviour)
- [x] On non-zero merge exit, `cmdMergeGate` re-reads state via `gh pr view --json state` and routes through `classifyPostMerge`.
- [x] On the merged-partial-success path: exit 0, `result.merged=true`, `result.verdict="merge-ok"`, warning present, no blockers added.
- [x] On the refuse path: exit 1, `result.verdict="refuse"`, the `gh` stderr present as a blocker (unchanged from today, via `classifyMergeFailure`).
- [x] `emit` prints `warnings` as non-fatal lines and includes them in `--json` output.
- [x] The top-of-function idempotent `state === "MERGED"` short-circuit and `decideFloor` are unchanged.

### From HOW (edge cases)
- [x] A failed state re-read (`gh` unreachable) fails closed to `refuse`.

### Test coverage
- [x] `mergeGateSelftest` drives `classifyPostMerge` across all four decision-table rows; `merge-gate --selftest` still exits 0.
- [x] `test/merge-gate.test.mjs` asserts the `classifyPostMerge` rows (via the selftest passing).
- [x] The merge-gate `--help`/usage string mentions the post-merge partial-success re-check.

**Integration smoke test** (pseudocode — not automated here; the impure gh path stays selftest-pure per the file's convention):

```
run merge-gate --selftest
→ exits 0, and the printed table includes the classifyPostMerge rows (merged-despite-nonzero + refuse)
```

---
*Prepped autonomously (beep-boop run 2026-07-05-beep-boop-list-030000). Spec-review: approve (architectural/infosec/QA, single-pass). Full spec on the tracker; ships to `docs/specs/` with the build PR.*

---

## Dedup fold + live sighting (folded into this build, tracker comments on FAFF-365)

**Dedupe fold (tidy 2026-07-10):** FAFF-374 and FAFF-404 report the same defect this ticket's spec fixes — marked `duplicateOf` this issue. Their unique content, folded for the builder:

- **Exact repro (FAFF-374):** `faff merge-gate --pr <n> --issue <id> --run-dir <dir> --level L2 --execute --merge-args "--squash --delete-branch"` with the **head branch checked out in a worktree** → remote squash-merge lands, local branch-delete refuses (`branch is checked out`), `gh` exits non-zero → `refuse` after success. Second face: same failure when **`main` is checked out in another worktree** (`'main' is already checked out at …`) — both are "local delete refused because a branch is checked out somewhere". Under `faffter-dark-concurrency-parallel` this worktree-checked-out condition is the **norm**, so the false-refuse mis-buckets outcomes.
- **Born-verifiable ACs (FAFF-404):** non-zero `gh pr merge` + PR observed `MERGED` → `merge-ok` (idempotent success, warning about the failed post-merge step); non-zero + unmerged → still `refuse`; stubbed selftest/`node --test` case for both. Covered by this build's `classifyPostMerge` selftest rows and `test/merge-gate.test.mjs`.
- **Fail-safe direction guarantee:** a cleanup failure must never invert a successful merge — honoured: `classifyPostMerge` only ever reports `merged` when `post_state === "MERGED"`; every other case (including unreadable) fails closed to `refuse`.

**Live sighting (2026-07-05, PR #275).** Observed exactly this in production: `faff merge-gate --execute` classified CI `ci-green`, ran `gh pr merge --squash --delete-branch`; the remote merge succeeded (PR #275 → MERGED), but `gh` exited non-zero on its post-merge local `--delete-branch` step (`fatal: 'main' is already checked out at …`) — merge-gate reported `refuse` for a PR that was already on `main`. Confirms the core fix (re-query `gh pr view --json state`; `MERGED` → `merge-ok (merged)` with a warning) and that the trigger is a **local** git-state error independent of whether the remote merge landed — the outcome must be read from live PR state, never from `gh pr merge`'s exit code alone. This build addresses the root cause (the outcome-reporting classifier); the "stop passing local `--delete-branch`, let `faff worktree-prune` own cleanup" secondary option from both duplicate tickets is left as a possible future simplification, out of scope here (§2).
