# Spec: Harden `faff merge-gate` self-observation — pin the observed head sha through to merge, fail closed on partial gh API (FAFF-376)

> Spec: faffter-dark-nlspec · 2026-07-05 · autonomous · rev 2 (post spec-review reject-approach) · confidence: high. Full spec on Linear FAFF-376.

*Revised on 2026-07-05 — spec review returned reject-approach (architectural): the drift half was premised on `gh pr merge` lacking an expected-head-oid flag, but gh 2.95.0 ships `--match-head-commit SHA`. Rev 2 re-derives the drift half around that forge-enforced pin; the partial-API half is carried unchanged. Rev 2 re-reviewed: approve, zero objections.*

This document is the build spec for FAFF-376. Audience: the build agent implementing the change in `plugin/skills/faff/bin/faff`, and human reviewers. It hardens two seams in the merge-gate interlock shipped by FAFF-350, identified by the FAFF-316 frontier audit. Rev 2 replaces the drift-half design after spec review: the head pin is now the forge-enforced `gh pr merge --match-head-commit` flag, not a client-side re-fetch-and-compare.

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff merge-gate` is the sole sanctioned merge path, and its whole value is that it observes CI *itself* on the PR head sha — it never trusts a caller's verdict. That guarantee currently leaks at two seams: (a) the sha it observed is not the sha it merges — the merge runs `gh pr merge <number>` with no sha pin, so a push landing in the observe-to-merge window merges a never-observed commit; and (b) when the primary CI signal (the check-runs API) is unreadable, classification silently proceeds on the weaker legacy commit-status signal alone, green-lighting on a source the gate was only ever meant to treat as a supplement. Both fixes restore the same invariant: **the gate acts only on what it actually observed, and refuses when it cannot observe.** The drift fix is one appended flag: `gh pr merge --match-head-commit <observed-sha>` makes the forge itself refuse any merge whose live head no longer equals the sha CI was classified against — atomic, server-side, no window at all.

**Problem statement.** Today a branch push between `observeCi` and the merge spawn merges an unobserved commit, and a check-runs API failure with a green legacy status returns `ci-green` instead of failing closed. Both weaken the "self-observation, fail-closed" contract the rest of the lights-out pipeline relies on. This change pins the observed head sha onto the merge invocation itself and makes loss of the primary CI signal an `indeterminate` (refuse), with both behaviours covered by the network-free `--selftest`.

**Design principles.**

**Decisions live in pure functions.** Every new judgement (merge-failure classification, partial-API classification) is a pure function driven by the selftest with no network, matching the existing merge-gate architecture (pure `decideFloor` / `classifyHeadShaChecks` cores in a thin impure `gh` shell). An implementation that buries either decision inline in the impure shell is invalid.

**One merge executor.** `gh pr merge` remains the single merge invocation; this change composes a flag onto it, never a second merge path.

**Fail closed, uniformly.** Any state where the gate cannot see or pin the primary signal — API loss, forge-rejected pin, unrecognisable rejection — refuses (exit 1). No new state may fail open, and no merge-failure classification may ever resolve to success.

**The gate owns the pin.** `--match-head-commit` is gate-composed from the observed sha, never caller-supplied. A caller who could set it could pin to a sha the gate never observed, defeating the point.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` — `classifyHeadShaChecks` (:13710), `observeCi` (:13769), `cmdMergeGate` (:13817), `mergeGateSelftest` (:13923) | JavaScript (single-file CLI) | The merge-gate subsystem this hardens |
| `plugin/skills/faff/bin/faff` — `MERGE_FLAG_ALLOW` / `parseMergeArgs` (:13697) | JavaScript | The closed `--merge-args` vocabulary; unchanged, must keep rejecting the pin flag |
| `plugin/skills/faff/bin/faff` — `decideFloor` (:6717) | JavaScript | Pure floor decision; unchanged, consumes `ci_state` |
| `test/merge-gate.test.mjs` | node:test | Deterministic-seam tests; asserts `--selftest` exits 0 |
| `docs/guide/cli.md` merge-gate row (line 38) | Markdown | User-facing contract; must be updated in the same PR |

**Scope statement.** This change is confined to the merge-gate subsystem inside `bin/faff` (two new pure functions, rewiring of `observeCi` and the merge-invocation step of `cmdMergeGate`, selftest rows) plus its guide row — no contract schema, exit-code vocabulary, or caller (graft / ship producer) changes.

## 2. OUT OF SCOPE

- **Flag-surface fencing (`--admin`, `--human-override` hardening)** — sibling ticket FAFF-375. This spec does not touch the merge-flag allow-list or the override gesture (the pin flag is appended by the gate, not admitted to the allow-list).
- **PR-state re-check after a non-zero `gh pr merge`** — sibling ticket FAFF-365 (In Progress), which edits the same merge-invocation region and owns post-merge partial-success re-checking. This spec's `classifyMergeFailure` only *names* the failure; it never re-queries PR state. Coordinate the textual conflict at rebase time; do not duplicate FAFF-365's re-check.
- **Branch-protection enforcement** — `branch-protection-check` stays assert-don't-enforce; forge-side required checks remain a separate backstop, not part of this change.
- **The stale-green probe** (`gh pr checks` fallback on a zero-check head sha) — semantics unchanged; the new partial-API rule sits *before* it.

(Rev 2 note: v1 listed a "REST merge with the `sha` guard" escalation as an out-of-scope extension point. That entry is deleted as moot — `--match-head-commit` *is* the server-side `sha`/`expectedHeadOid` guard, expressed on the existing executor, so there is nothing left to escalate to.)

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Observed head sha | The `headRefOid` fetched once at gate entry (:13850); the sha CI classification was computed against |
| Head pin | The `--match-head-commit <observed-sha>` flag the gate appends to the merge invocation; the forge refuses the merge unless the live head equals it |
| Head drift | The PR's live head no longer equals the observed head sha at merge time — surfaces as a forge-side pin rejection |
| Primary signal | The check-runs API result for the observed head sha |
| Legacy supplement | The commit-status API result; trusted only alongside a readable primary signal |

**New pure interfaces.** Both are pure (no I/O), live beside the existing pure cores, and are driven by `mergeGateSelftest`:

```
FUNCTION classifyCiObservation(checkRunsOk: Bool, runs: List<CheckRun>,
                               statusOk: Bool, statusState: String?, statusCount: Int)
  -> RECORD { ci_state: CiState, api_degraded_reason: String? }
  # api_degraded_reason non-null ⟺ ci_state was forced to "indeterminate" by API loss

FUNCTION classifyMergeFailure(stderr: String, observedSha: String)
  -> RECORD { kind: ENUM { head-drift, pin-unsupported, generic }, blocker: String }
  # Called ONLY on a non-zero merge exit; every kind is a refusal — there is no success branch.
```

`CiState` is the existing enum (`ci-green | ci-red | no-ci-coverage | indeterminate`) — no new values, so `decideFloor`, the `integrity-floor` contract, and the result JSON shape (`{verdict, blockers, merged, ci_state, head_sha, ci_detail}`) are all byte-compatible. Exit codes stay 0 merge-ok · 1 refuse · 2 fail-loud.

**Design decision — how to close the observe-to-merge window.** Append `gh pr merge --match-head-commit <observed-sha>` (the server-side `expectedHeadOid` guard, verified present in the installed gh 2.95.0), versus re-fetch the head and compare client-side (v1's pick, premised on the flag not existing — a false premise), versus GitHub's REST merge endpoint. **Chosen:** the `--match-head-commit` head pin — atomic and forge-enforced (no residual window), zero extra network calls, and it composes onto the sole existing executor with its full flag surface intact (full weighing in Design Decision Rationale).

**Design decision — where the partial-API rule lives.** A new pure wrapper (`classifyCiObservation`) composing the existing `classifyHeadShaChecks`, versus changing `classifyHeadShaChecks`'s signature, versus an inline check in the impure `observeCi`. **Chosen:** new pure wrapper — `classifyHeadShaChecks` keeps its established signature, semantics (all-skipped → no-coverage; legacy read only when count > 0), and selftest table untouched; the API-availability judgement gets its own pure, selftest-able home.

**Design decision — degraded-signal severity.** When the check-runs API is unreadable, the result is `indeterminate` regardless of what the legacy status says — even a legacy `failure` does not upgrade to `ci-red`, and a legacy `success` never yields `ci-green`. **Chosen:** uniform `indeterminate` on primary-signal loss — both outcomes refuse, one rule is simpler and honest (the gate cannot see the primary signal, so it reports exactly that).

**Design decision — pin ownership vs the `--merge-args` surface.** Callers must never supply `--match-head-commit`; the gate composes it from the sha it observed. Today `parseMergeArgs` already rejects it (it is not in `MERGE_FLAG_ALLOW`, so a caller passing it in `--merge-args` gets exit 2 as an unrecognised token). **Chosen:** keep it rejected — do not add it to `MERGE_FLAG_ALLOW`; the pin rides every executed merge unconditionally, appended after `parsedMerge.flags` at the spawn site. Because the flag rides the merge invocation itself, every merging path passes through it — including the human-override fall-through (the recorded override replaces the floor refusal, but drift is a new post-override fact the pin still catches). `--check-only` and the already-`MERGED` idempotent no-op never reach the merge spawn and are untouched.

**Design decision — older gh without the flag.** An older gh would reject `--match-head-commit` as an unknown flag. Options: probe `gh pr merge --help` at gate time (one extra spawn per merge, a new pre-merge failure mode); enforce a version floor at gate entry (version-string parsing, same cost); do nothing special (the unknown-flag error is a non-zero merge exit → existing refuse path, inherently fail-closed) plus have `classifyMergeFailure` name it. **Chosen:** no pre-flight probe — an unpinned merge is never attempted, an old gh fails loud into the refuse path by construction, and `classifyMergeFailure` recognises the unknown-flag stderr as `pin-unsupported` with a blocker that says the installed gh lacks `--match-head-commit` and must be upgraded. Zero cost on the happy path.

**External dependency.** **Assumes:** a forge-side pin rejection surfaces on `gh pr merge` stderr with recognisable wording (the GraphQL `mergePullRequest` error for a mismatched `expectedHeadOid` — expected along the lines of "head branch was modified" / "expected head"). Validation before build: the integration smoke test's step 3 provokes a real mismatch and captures the exact stderr; the build agent pins `classifyMergeFailure`'s drift pattern to the observed wording. Unrecognisable stderr degrades to `generic` (still a refusal), so a wording change can never fail open — it only costs blocker specificity.

**`--auto` interaction — verified, not assumed.** In gh v2.95.0's source (`pkg/cmd/pr/merge/http.go`), `expectedHeadOid` is set on the shared `MergePullRequestInput`, and `EnablePullRequestAutoMergeInput` embeds that same input — so with `--auto`, the pin is forwarded into the `enablePullRequestAutoMerge` mutation and the forge refuses to *enable* auto-merge against a drifted head. What the forge does after a successful enable (a later push, the eventual queue-side merge) is forge-owned delegation, unchanged by this spec — document it in the guide row, do not special-case it.

## 4. HOW — Behavior

### Partial-API classification (`observeCi` rewiring)

One sentence: `observeCi` delegates the "can I even trust this reading?" judgement to the pure wrapper, and only proceeds to head-state handling when the primary signal was readable.

```
PROCEDURE classifyCiObservation(checkRunsOk, runs, statusOk, statusState, statusCount):
  1. IF NOT checkRunsOk:
     a. reason = statusOk
          ? "check-runs API unavailable — legacy status alone is not trusted"
          : "gh api unreachable for head-sha checks"
     b. RETURN { ci_state: "indeterminate", api_degraded_reason: reason }
  2. effectiveState = statusOk ? statusState : null
     effectiveCount = statusOk ? statusCount : 0
  3. RETURN { ci_state: classifyHeadShaChecks(runs, effectiveState, effectiveCount),
              api_degraded_reason: null }
```

```
PROCEDURE observeCi(repo, pr, headSha):                    # impure shell
  1. cr  = ghJson(check-runs API for headSha)              # unchanged call
  2. stt = ghJson(legacy status API for headSha)           # unchanged call
  3. cls = classifyCiObservation(cr.ok, cr.ok ? cr.data : [],
                                 stt.ok, stt state, stt count)
  4. IF cls.api_degraded_reason:
       RETURN { ci_state: "indeterminate", head_sha_matches: true, detail: cls.api_degraded_reason }
  5. headState = cls.ci_state
  6. (unchanged) non-"no-ci-coverage" → return headState;
     "no-ci-coverage" → stale-green probe via `gh pr checks` as today
```

The old `!cr.ok && !stt.ok` early return is subsumed by step 1 (its `detail` string is preserved for the both-down case). Note the asymmetry is deliberate: legacy-API loss with a readable primary proceeds on check-runs alone — the supplement is optional, the primary is not.

**Anti-pattern:** widening `classifyHeadShaChecks` to take an availability flag. Why: its selftest table and its FAFF-366/FAFF-369 semantics are settled; availability is a different question (can I trust the reading?) from classification (what does the reading say?), and conflating them re-opens a hardened function.

### Head pin (`cmdMergeGate` rewiring)

One sentence: the merge spawn carries `--match-head-commit <observed-sha>` so the forge itself refuses any merge whose live head is not the sha CI was classified against, and a non-zero merge exit is classified into a named blocker by a pure function.

The pinned sha is the *same variable* as the gate-entry observation (`headSha`, :13850) — observation and pin cannot diverge because there is only one value, and the forge enforces it at commit time. No pre-merge re-fetch, no client-side comparison, no extra network call.

```
  1. m = spawnSync("gh", ["pr", "merge", String(pr), ...parsedMerge.flags,
                          "--match-head-commit", headSha])   # sole executor, pin appended by the gate
  2. IF m.status != 0:
     a. cls = classifyMergeFailure((m.stderr || "").trim(), headSha)
     b. result.verdict  = "refuse"
     c. result.blockers = [...blockers, cls.blocker]
     d. emit(result, 1)                                       # merged stays false
  3. (unchanged) merged = true, verdict = merge-ok, exit 0
```

```
PROCEDURE classifyMergeFailure(stderr, observedSha):          # PURE — called only on non-zero exit
  1. IF stderr matches the pin-mismatch wording (pattern fixed empirically at build time;
        candidates: /head branch was modified/i, /expected head/i):
       RETURN { kind: "head-drift",
                blocker: "head sha changed between CI observation and merge:
                          observed <observedSha>; the forge refused the head pin" }
  2. IF stderr matches /unknown flag.*match-head-commit/i:
       RETURN { kind: "pin-unsupported",
                blocker: "installed gh does not support --match-head-commit —
                          upgrade gh; the gate never merges unpinned" }
  3. RETURN { kind: "generic",
              blocker: "gh pr merge rejected: <stderr, or 'non-zero exit' if empty>" }
```

Step 3 preserves today's generic blocker text (:13883) byte-for-byte for the non-drift case. There is no success branch: classification only ever names *which* refusal this is.

**Edge cases.**

- **Peer merged the PR inside the window** — `gh pr merge` exits non-zero on an already-merged PR; whatever its stderr says, classification yields a refusal (`head-drift` or `generic`), never a false success. Post-merge state re-checking is FAFF-365's scope — do not duplicate it here; the gate-entry already-`MERGED` idempotent no-op (:13852) is untouched.
- **`--merge-args` includes `--auto`** — the pin is forwarded into the `enablePullRequestAutoMerge` mutation (verified, §3), so auto-merge cannot be *enabled* against a drifted head. The eventual forge-side merge after enable is a deliberate delegation to forge-side observation, unchanged by this spec — document it in the guide row, do not special-case it.
- **Caller passes `--match-head-commit` in `--merge-args`** — unrecognised token, exit 2 (existing `parseMergeArgs` behaviour, preserved). The gate owns the pin.
- **Empty stderr on non-zero exit** — `generic`, blocker reads `gh pr merge rejected: non-zero exit` (today's fallback, preserved).
- **Error categories** — every classified refusal is terminal for this invocation (exit 1). `head-drift` and `generic` are safely retryable: re-running the gate re-observes CI on the new head from scratch. `pin-unsupported` is not retryable until gh is upgraded — the blocker says so.

**Failure modes.**

- **Pin-mismatch wording drifts or is unrecognisable** — gh or the forge changes the error text, so a real drift classifies as `generic`. How you'd know: a merge refusal whose generic blocker's embedded stderr mentions head/branch modification. What it means: degraded specificity, never degraded safety — the refusal still happens, exit 1, nothing merges; refresh the pattern when observed.
- **Older gh in some environment** — every executed merge refuses with the `pin-unsupported` blocker. How you'd know: the blocker names the missing flag explicitly. What it means: correct fail-closed behaviour — an unpinned merge is never attempted; upgrade gh.
- **Legacy-only repos with a broken check-runs API** — a repo whose CI reports only via commit statuses *and* whose check-runs endpoint errors (e.g. token scope) now always refuses. How you'd know: persistent `check-runs API unavailable` in `ci_detail` while the forge UI shows green statuses. What it means: correct fail-closed behaviour; the human-override path exists for a deliberate exception, and fixing the token scope is the real remedy.

**Anti-pattern:** adding a second merge executor (REST call, `git push` of a merge commit) alongside `gh pr merge`. Why: the interlock's audit story depends on exactly one sanctioned merge invocation; the pin composes onto it, nothing sits beside it.

**Anti-pattern:** re-fetching the head and comparing before the merge as a belt-and-braces addition. Why: the forge-side pin already dominates it (atomic, no window); the extra call re-introduces the pre-merge network failure mode this revision deleted, for zero added safety.

### Selftest additions

Extend `mergeGateSelftest` (same `check(label, cond)` convention, pure only, no network, no gh mocking):

```
classifyCiObservation rows:
  1. both APIs down                          → indeterminate, reason present
  2. check-runs down + legacy success (n>0)  → indeterminate  (the hardening this ticket ships)
  3. check-runs down + legacy failure (n>0)  → indeterminate  (uniform severity)
  4. check-runs ok(empty) + legacy API down  → no-ci-coverage (classification proceeds)
  5. check-runs ok(success) + legacy API down → ci-green      (supplement optional, primary present)
  6. check-runs ok(success) + legacy success → ci-green       (delegation intact)

classifyMergeFailure rows:
  7. pin-mismatch wording                    → head-drift, blocker names the observed sha
  8. "unknown flag: --match-head-commit"     → pin-unsupported, blocker says upgrade gh
  9. unrelated stderr ("merge conflict")     → generic, blocker embeds the stderr verbatim
 10. empty stderr                            → generic, blocker reads "non-zero exit"
```

`test/merge-gate.test.mjs` already asserts `merge-gate --selftest` exits 0, which now covers the new rows; no impure-path test additions (parity with the existing convention — the impure shell is the integration smoke test's job).

## 5. Scenarios

```
Given a PR whose observed head sha passed the full floor (CI green, AC complete, review pass)
When a new commit is pushed to the PR branch after observation but before the merge executes
Then the forge rejects the pinned merge, merge-gate refuses (exit 1, merged:false)
     with a blocker naming the observed sha and the head pin,
     and no merge of the unobserved commit occurs
```

```
Given the check-runs API call fails while the legacy status API returns success with count > 0
When merge-gate observes CI for the head sha
Then ci_state is "indeterminate" (never "ci-green"), the verdict is refuse,
     and ci_detail says the check-runs API was unavailable
```

```
Given the check-runs API returns a genuine success for the head sha and the legacy status API call fails
When merge-gate observes CI
Then ci_state is "ci-green" — loss of the supplement alone does not block a readable primary signal
```

```
Given an environment whose gh predates --match-head-commit
When merge-gate executes a merge
Then no unpinned merge is attempted and the gate refuses with the pin-unsupported blocker
```

Assertions (non-functional): `faff merge-gate --selftest` covers both new pure functions and completes with no network access; every executed merge invocation carries the pin (no unpinned `gh pr merge` path remains); the result JSON shape, `CiState` enum, and exit-code vocabulary are unchanged.

## 6. Design Decision Rationale

**How should the observe-to-merge window be closed?**
Options: (a) `gh pr merge --match-head-commit <observed-sha>` — the server-side sha guard (REST `sha` / GraphQL `expectedHeadOid`) expressed as a flag on the existing sole executor: atomic (the forge enforces the pin at commit time, no residual window), zero extra network calls, full flag surface preserved (`--squash`/`--delete-branch`/`--admin` unchanged, `--auto` forwards the pin into the enable mutation — verified in gh source), and a mismatch surfaces as a non-zero exit feeding the existing refuse path; (b) re-fetch the live head immediately before the merge spawn and compare client-side — v1's choice, premised on the flag not existing; that premise was false (verified against the installed gh 2.95.0), and re-fetch loses on every axis: a sub-second residual race survives, one extra `gh` call per merge, a new pre-merge network failure mode, and an audit story for the residual window; (c) GitHub's REST merge endpoint with the `sha` body parameter — atomic but a second executor: reimplements merge-method mapping, breaks `--delete-branch`/`--auto`/`--admin` semantics, new HTTP-error classification. Temporal anchor: verified on gh 2.95.0 (2026-06-17), the installed version; older gh handling is decided below.
**Chosen:** the `--match-head-commit` head pin — it is option (b)'s one-executor simplicity with option (c)'s atomicity, at negative marginal cost.

**Where does the partial-API judgement live?**
Options: change `classifyHeadShaChecks`'s signature (re-opens a settled, selftest-hardened function and conflates availability with classification); decide inline in `observeCi` (impure, unreachable by the network-free selftest — the acceptance criterion); a new pure wrapper composing the existing classifier.
**Chosen:** the pure wrapper `classifyCiObservation` — availability judged first, classification delegated unchanged.

**How severe is primary-signal loss?**
Options: map legacy readings through anyway (legacy failure → ci-red, legacy success → indeterminate) — more granular but two rules and a false precision; uniform indeterminate.
**Chosen:** uniform `indeterminate` — both variants refuse, and "cannot see the primary signal" is the truthful report either way.

**Who owns the pin flag, and does it guard the override path?**
Options: admit `--match-head-commit` to `MERGE_FLAG_ALLOW` so callers can pass it (a caller could then pin an unobserved sha — defeats self-observation); gate-composed, appended unconditionally at the spawn site (callers keep getting exit 2 if they try to pass it — today's behaviour, preserved).
**Chosen:** gate-composed and caller-rejected. Because the pin rides the merge invocation itself, the human-override fall-through is inherently covered (drift is a new post-override fact, never an overridden blocker), and `--check-only` / already-`MERGED` never reach the spawn.

**How to handle a gh that lacks the flag?**
Options: probe `gh pr merge --help` at gate time (an extra spawn per merge and a new pre-merge failure mode, to detect a condition that already fails loud); parse and enforce a version floor (same cost, plus version-string brittleness); attempt the pinned merge and let the unknown-flag error land in the refuse path, named by the classifier.
**Chosen:** no pre-flight probe — fail-closed by construction (an unpinned merge is never attempted), and `classifyMergeFailure` turns the unknown-flag stderr into an explicit `pin-unsupported` blocker so the operator knows the remedy is a gh upgrade, not a retry.

## 7. Open Questions and Assumptions

**Open questions:** none — all decisions above are closed.

**Assumptions:**

- **Assumes:** a forge-side pin rejection surfaces on `gh pr merge` stderr with recognisable wording. Validation before build: the integration smoke test provokes a real mismatch (step 3) and the build agent fixes `classifyMergeFailure`'s drift pattern to the empirically observed text. The degrade path (`generic`, still refuse) means a wrong guess costs blocker specificity, never safety.

## 8. DONE — Definition of Done

### From WHY (the invariant)
- [ ] No unpinned merge path exists: every executed `gh pr merge` invocation (normal path and human-override fall-through) carries `--match-head-commit` with the gate-entry observed sha — the same variable CI classification used.

### From WHAT (interfaces)
- [ ] `classifyCiObservation` and `classifyMergeFailure` exist as pure functions (no I/O) with the specified shapes; `classifyMergeFailure` has no success outcome.
- [ ] `CiState` enum, result JSON shape, exit-code vocabulary, and the `integrity-floor` contract are byte-unchanged.
- [ ] `MERGE_FLAG_ALLOW` is unchanged — `--match-head-commit` in `--merge-args` still exits 2 as an unrecognised token.

### From HOW (partial-API behaviour)
- [ ] Check-runs API failure + legacy success (count > 0) → `ci_state: "indeterminate"`, verdict refuse, `ci_detail` names the unavailable check-runs API.
- [ ] Check-runs API failure + legacy failure → `indeterminate` (uniform, never upgraded to ci-red).
- [ ] Both APIs down → `indeterminate` with the existing both-down detail string (behaviour preserved).
- [ ] Check-runs readable + legacy API down → classification proceeds on check-runs alone (success → ci-green; empty → no-ci-coverage feeding the unchanged stale-green probe).

### From HOW (head-pin behaviour)
- [ ] A head that drifted after observation → the forge rejects the pinned merge; the gate refuses (exit 1, `merged:false`) with the `head-drift` blocker naming the observed sha; no merge of the unobserved commit occurs.
- [ ] gh lacking the flag → `pin-unsupported` blocker naming the gh upgrade remedy; no unpinned merge attempted.
- [ ] Any other non-zero merge exit → `generic` blocker preserving today's `gh pr merge rejected: <stderr>` text; empty stderr → `non-zero exit`.
- [ ] Matching head → merge proceeds through the single pinned `gh pr merge` spawn; `--auto` forwards the pin into the auto-merge enable.
- [ ] `--check-only` and the already-MERGED idempotent no-op perform no merge invocation and are untouched.
- [ ] The empirical pin-mismatch stderr wording is captured in the smoke test and reflected in the classifier's drift pattern (validates the Assumes).

### From HOW (selftest + tests)
- [ ] `mergeGateSelftest` gains the ten listed rows (six `classifyCiObservation`, four `classifyMergeFailure`); `faff merge-gate --selftest` passes with no network.
- [ ] `node --test test/merge-gate.test.mjs` passes unchanged (the selftest exit-0 assertion now covers the new rows).

### From reference context (docs)
- [ ] The `docs/guide/cli.md` merge-gate row is updated in the same PR: the merge is pinned to the observed head sha (drift → forge-rejected → refuse) and check-runs-API loss → indeterminate, in self-contained prose (no ticket references in guide prose); the `--auto` caveat states the pin guards auto-merge *enablement* and the eventual merge is delegated to the forge.

### Integration smoke test (happy + drift path, network-dependent, spec-level not CI)
```
1. Open a sandbox PR; wait for CI green on head sha S1
2. faff merge-gate --check-only …                    → merge-ok
3. gh pr merge <n> --squash --match-head-commit <S0-a-superseded-sha>
                                                     → non-zero; CAPTURE the exact stderr
                                                       (fixes classifyMergeFailure's drift pattern;
                                                        validates the Assumes)
4. faff merge-gate --execute …                       → merge-ok, merged (pin matched S1)
```

confidence: high
spec-review: approve
