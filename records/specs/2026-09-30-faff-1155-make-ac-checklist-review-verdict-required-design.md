# FAFF-1155 — Make ac-checklist + review-verdict required at the per-PR anchor (no silent drop)

> Spec: faffter-dark-nlspec · 2026-09-30 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1155.

This spec is the buildable increment for FAFF-1155, Half A only (the per-PR anchor requiredness). Half B — spec-review anchoring — is split to FAFF-1157 and is out of scope here. Audience: the build agent, and the human reviewer gating the merge floor.

## 1. WHY — Problem and Principles

**The evidence model.** The immutable per-PR anchor (`.faff/anchors/<run>/<ISSUE>/`, minted by `faff events anchor` at graft Step 9b) is the durable, committed record that a build cleared its acceptance-criteria and code-review floor. Today those two evidence files are copied *best-effort* — `if (fs.existsSync(src))` at `events.js:1492` — so a run whose `ac-checklist.json` or `review-verdict.json` failed to land mints a **silently incomplete** anchor: a permanent evidence hole committed into git, whose only downstream symptom is a late, confusing `merge_floor: fail` (`ac-checklist.json missing/incomplete`) at merge-gate time that reads as if review never ran.

**Problem statement.** The per-PR anchor can be committed missing its AC/review evidence and nobody notices at mint. This change makes the two files **required** at the per-PR anchor: their absence fails the mint loud, pre-PR, so no incomplete anchor is ever committed. It closes the gap at copy time, complementing the existing read-time merge-floor leg rather than replacing it.

**Design principles.**

- **Fail early and loud over fail late and cryptic.** Catch the missing evidence at mint (Step 9b, before the PR exists) as a clear build defect, not downstream at merge-gate as a `missing` reason that mimics a skipped review.
- **Never commit a partial anchor.** A refusal must leave nothing on disk — the anchor is either complete or absent, never an ambiguous in-between.
- **Requiredness is the per-PR anchor's alone.** The run-level `anchor-run` mint and every other reuser of the shared mint core deliberately anchor non-shipped, floor-less issues; the new requirement must not touch them.
- **Presence, not content.** This ticket guarantees the files are *present* in the anchor. Their content validity stays the arbiter of the existing readers (`readAcComplete` / `readReviewVerdict`) — unchanged.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` `anchor` handler (~1180) | JS | The per-PR mint command; the guard's home |
| `plugin/skills/faff/bin/lib/events.js` `mintIssueAnchor` (~1454) | JS | Shared byte-copy core; best-effort floor copy at ~1489 |
| `plugin/skills/faff/bin/lib/events.js` `anchor-run` handler (~1259) | JS | Run-level sibling reusing the same core (~1314) — must stay unaffected |
| `plugin/skills/faff/bin/lib/bundle.js` (~1244) | JS | Reuses `mintIssueAnchor` core directly — must stay unaffected |
| `plugin/skills/faff/bin/lib/governance-check.js` `evaluateMergeFloorLeg` (~137) | JS | The complementary read-time leg — unchanged |
| `plugin/skills/faff/bin/lib/merge-gate.js` `readAcComplete`/`readReviewVerdict` (~584/600) | JS | Content-validity arbiters — unchanged |
| `plugin/skills/faff-graft/SKILL.md` Step 9b (~561/563) | Markdown prose | Anchor-refusal → shared park protocol; extends to the new code |

**Scope statement.** One guard at the per-PR `anchor` command handler, plus a one-line extension of graft Step 9b's existing anchor-refusal park block — no new park path, no new merge-gate reader, no new contract.

## 2. OUT OF SCOPE

- **Spec-review anchoring** — the same requiredness for spec-review evidence. Why excluded: split to FAFF-1157. Extension point: the same `anchor` command handler and `optionalFloorFiles` set.
- **New review-verdict fields** — refutation/disposition/disposition_rationale coverage. Why excluded: already delivered by FAFF-1146 (`findings[]` is required, refutation captured). Extension point: `merge-gate.js` `computeReviewVerdict`.
- **Content validation at mint** — asserting the files are *valid*, not merely present. Why excluded: content is the read-time readers' job (`readAcComplete`/`readReviewVerdict`); duplicating it at mint would fork the check. Extension point: those readers.
- **Promoting `holdout.json` / `build-progress.json` / `landing-progress.json` to required.** Why excluded: these are legitimately absent at L1–L3 (holdout), before the build checkpoint, or before any fix cycle. Extension point: the same guard's required-set list.

## 3. WHAT — Behaviour change

**Vocabulary.**

| Term | Definition |
|---|---|
| Per-PR anchor | The immutable `.faff/anchors/<run>/<ISSUE>/` snapshot minted by the `faff events anchor` command at graft Step 9b, one issue |
| Run-level anchor | The git-only `faff events anchor-run` mint — one subdir per admitted issue, including non-shipped ones |
| Required floor files | `ac-checklist.json` + `review-verdict.json` — the AC and code-review evidence |
| Mint core | `mintIssueAnchor(runDir, issue, destDir)` — the shared byte-copy used by both `anchor` and `anchor-run` and by `bundle.js` |

**The required set.** Exactly two files become required at the per-PR anchor:

```
REQUIRED_PER_PR_FLOOR = [ "ac-checklist.json", "review-verdict.json" ]
```

The other three entries of the current `optionalFloorFiles` (`holdout.json`, `build-progress.json`, `landing-progress.json`) stay best-effort, copied exactly as today.

**Error contract.** A new `anchor`-command refusal:

```
code:    "floor-incomplete"          # a new anchor CLI error value, sibling to no-events / genesis-invalid
exit:    3                           # the same fail-closed exit as no-events / genesis-invalid
stderr:  "faff events anchor: floor-incomplete — <ISSUE>/<file> is required in a per-PR anchor but is absent in <run-dir>"
onDisk:  nothing                     # refusal is pre-mint; no --dest dir is created
```

`floor-incomplete` is surfaced only by the per-PR `anchor` command. The `anchor-run` command and `bundle.js` never trigger it (see HOW).

**Design decisions.**

- **Where the requiredness is enforced.** Options: (a) inside `mintIssueAnchor` unconditionally; (b) inside `mintIssueAnchor` behind an opt-in `opts.requireMergeFloor`; (c) at the per-PR `anchor` command handler, pre-mint. **Chosen:** (c) — a read-only presence check in the `anchor` command handler, immediately before the `mintIssueAnchor(...)` call at `events.js:~1236`. Rationale: `mintIssueAnchor` is the *shared* core reused by `anchor-run` (`:1314`) and by `bundle.js` (`:1244`, whose own selftest writes `ac-checklist.json` but no `review-verdict.json`); making the core itself require both — even behind a flag — adds a signature and a branch to a seam three callers share, whereas the requirement belongs to exactly one caller. The command handler already hosts a chain of read-only pre-mint preconditions (`:1198` issue-shape, `:1210–1235` ledger-fold) that leave no partial anchor; the guard is one more of the same shape. The core stays byte-for-byte unchanged, so its selftest and `bundle.js` need no edit.

- **How the per-PR anchor is distinguished from a run-level / non-shipped mint.** **Chosen:** the enclosing **command**, not a property of the mint. The `anchor` command (`events.js:~1180`) is the per-PR mint and is the *only* production caller of `faff events anchor` (graft Step 9b); `anchor-run` (`:1259`) is the run-level mint and deliberately anchors non-shipped issues. Because the guard lives in the `anchor` handler and nowhere in the shared core, the distinction is structural — `anchor-run` and `bundle.js` cannot reach the guard. The mint-time ledger outcome cannot be the signal: a per-PR anchor is minted before the terminal outcome is written (`outcomes:{}` snapshot; confirmed at `governance-check.js:287–293`), so `outcome` is `undefined` at Step 9b.

- **How the refusal reaches the human.** **Chosen:** reuse graft Step 9b's existing anchor-refusal park protocol (`SKILL.md:563`), which already treats *any* non-zero `faff events anchor` exit as "abort Step 9b before `gh pr create`, run the shared Park protocol, apply `faff-parked`, return `needs-human`". No new park path is invented. Graft's prose is extended to name `floor-incomplete` as a third recognised code, distinguished only by its cause line (a build-evidence defect — Step 8/9 failed to persist the file — not the provisioning fault that `no-events`/`genesis-invalid` describe).

- **Presence vs content.** **Chosen:** the guard is a pure `fs.existsSync` presence check on the two files under `path.join(runDir, issue)`. It never parses or validates them; a present-but-malformed file passes the mint guard and is caught downstream by the unchanged read-time leg. This keeps content validity in one home (`readAcComplete`/`readReviewVerdict`) and avoids a forked check.

## 4. HOW — Mechanics

**The guard.** In the `anchor` command handler, after the existing ledger-fold precondition and before `const result = mintIssueAnchor(...)` — but **gated behind a genesis-validity precheck** so a provisioning fault surfaces its own code, not `floor-incomplete`:

```
PROCEDURE per_pr_floor_guard(runDir=dirArg, issue=issueArg):
  # Genesis-first: mintIssueAnchor detects no-events / genesis-invalid via
  # validateAnchorGenesis (events.js:1455) — INSIDE the core, AFTER this guard.
  # So a floor-less run whose genesis is also absent/torn (the usual provisioning-fault
  # shape, where Steps 8/9 never ran either) must NOT be mislabelled floor-incomplete.
  # Re-run the same genesis check here and, when it is NOT valid, skip the floor guard —
  # fall through to mintIssueAnchor, which refuses with no-events / genesis-invalid.
  IF NOT validateAnchorGenesis(runDir).valid:
    RETURN (fall through to mintIssueAnchor, which owns the no-events / genesis-invalid refusal)
  # Genesis is valid → Steps 8/9 should have persisted both files; their absence is a real defect.
  issueDir := join(runDir, issue)                       # same base mintIssueAnchor uses (events.js:1490)
  FOR file IN ["ac-checklist.json", "review-verdict.json"]:
    IF NOT exists(join(issueDir, file)):
      write stderr: "faff events anchor: floor-incomplete — {issue}/{file} is required in a per-PR anchor but is absent in {runDir}"
      RETURN 3                                           # pre-mint: mintIssueAnchor never runs, --dest never created
  # both present → fall through to mintIssueAnchor unchanged
```

Ordering matters: the genesis precheck ensures a torn-genesis run still refuses with its own `no-events`/`genesis-invalid` code (the correct provisioning-fault remediation) rather than `floor-incomplete` (a build-evidence defect). The re-run of `validateAnchorGenesis` in the handler is a deliberate, cheap re-read — `mintIssueAnchor` re-validates internally regardless, so the core stays byte-for-byte unchanged; a build agent may instead thread the precomputed result through if it prefers, but must not alter the core's own genesis check. Both the genesis precheck and the floor guard run strictly before `mintIssueAnchor`, so any refusal — like its siblings — mutates neither the run dir nor `--dest`.

**Behaviour summary.** The per-PR anchor command now refuses, loudly and cleanly, when either AC/review evidence file is missing; the run-level and bundle mints are untouched because the guard is not in the shared core.

**Edge cases.**

- **Zero-AC build.** Graft Step 8 still writes a schema-1 `{ "all_verified": true }` `ac-checklist.json` for a zero-AC issue (seam confirmed). The file is *present*, so the presence guard passes — a zero-AC anchor mints normally. The guard checks existence, never criteria count.
- **Early park.** An early-parked issue never reaches Step 9b, so the `anchor` command is never invoked for it — the guard is not a new park trigger for parks that already short-circuit.
- **Re-run of Step 9b.** A benign re-run over an unchanged tree finds both files present (they were written at Steps 8/9) → guard passes → idempotent, as today.
- **`anchor-run` over a shipped-but-floorless issue.** Unchanged: still governed by `anchor-run`'s own post-mint `evaluateAnchorDir` self-verify (`events.js:1352`), which fails such a subdir via the merge-floor leg — never by this mint guard.

**Anti-pattern:** adding the requiredness inside `mintIssueAnchor`. Why: three callers share that core (`anchor`, `anchor-run`, `bundle.js`); the requirement is one caller's, and putting it in the core forces a flag and breaks the run-level/non-shipped contract the core exists to serve.

**Anti-pattern:** validating file *content* in the guard. Why: content is the read-time readers' job; a second check at mint forks the arbiter and drifts.

## 5. SCENARIOS — main objectives

```
Given a run dir with a valid genesis chain and both ac-checklist.json and review-verdict.json under <run-dir>/<ISSUE>/
When `faff events anchor --run-dir <run-dir> --issue <ISSUE> --dest <dest>` runs
Then it exits 0 and the committed anchor carries both files
```

```
Given a run dir with a valid genesis chain but review-verdict.json (or ac-checklist.json) absent under <run-dir>/<ISSUE>/
When `faff events anchor …` runs
Then it exits 3, names the missing file and "floor-incomplete" on stderr, and creates no --dest anchor dir
```

```
Given a run dir carrying a shipped-and-a-non-shipped issue, neither with floor files
When `faff events anchor-run --run-dir <run-dir> --dest <dest>` runs
Then the mint guard never fires (behaviour is byte-for-byte as before this change)
```

```
Given a zero-AC build whose ac-checklist.json is the schema-1 {all_verified:true} form, with review-verdict.json present
When `faff events anchor …` runs
Then it exits 0 (presence is satisfied; the guard never inspects criteria)
```

## 6. DESIGN DECISION RATIONALE

**Where to enforce requiredness?** Core-unconditional / core-behind-a-flag / command-handler-pre-mint. **Chosen:** command-handler-pre-mint. The core is shared by `anchor-run` and `bundle.js`, both of which legitimately mint floor-less anchors; only the per-PR `anchor` command must require the floor. A pre-mint read-only guard reuses the handler's existing precondition shape and guarantees no partial anchor without touching the core, its selftest, or the two other callers.

**What signal separates per-PR from run-level?** Ledger outcome / a passed flag / the command itself. **Chosen:** the command. Outcome is `undefined` at mint (pre-merge snapshot), so it cannot key the decision; a passed flag could be forgotten by a future caller (reopening the silent-drop the ticket closes); the command boundary is structural and cannot be bypassed — the guard simply does not exist on the `anchor-run` / `bundle.js` paths.

**How does the refusal surface?** New park path / reuse Step 9b's anchor-refusal protocol. **Chosen:** reuse. Graft already parks on any non-zero anchor exit; `floor-incomplete` rides that path with a distinct cause line (build-evidence defect vs provisioning fault). No new disposition, label, or park protocol.

**Presence or content?** **Chosen:** presence-only. Content stays the read-time readers' single responsibility; a mint-side content check would fork it.

**Which files?** All five floor files / the AC+review pair. **Chosen:** the pair. `holdout.json` is L4-only, `build-progress.json` predates the checkpoint, `landing-progress.json` predates the first fix cycle — each is legitimately absent, so requiring them would false-refuse valid L1–L3 mints.

**Backward compatibility.** The shared core, `anchor-run`, `bundle.js`, and legacy already-committed anchors are all unchanged. The consequence is confined to tests that invoke the `events anchor` **command** with no floor files present (to exercise unrelated properties). Rather than enumerate them by line (a list that drifts and has already proven easy to under-count), the build follows an **invariant** and lets the suite be the completeness check:

> **Test invariant.** Every per-PR `events anchor` call site that expects **exit 0** must have (a) a valid genesis chain **and** (b) both `ac-checklist.json` + `review-verdict.json` seeded under `<runDir>/<issue>/`. Every call site that expects a **refusal** must assert the **specific** code — `no-events` / `genesis-invalid` for a genesis fault, `floor-incomplete` for a valid-genesis missing-floor fault — never a bare `notEqual(code, 0)` that a code change could silently satisfy differently.

Seeding both files reflects reality: a genuine per-PR anchor always carries them, exactly as `test/run-ledger-init-*.test.mjs` already does before every anchor (so those are **not** regressions). Applying the invariant means the build **runs the anchor test suite and fixes every failing exit-0 assertion**, not a fixed list. The known affected files, as a starting map (confirm by running the suite, do not treat as exhaustive): `test/evidence-spec.test.mjs`, `test/effects-chain.test.mjs`, `test/events-chain.test.mjs` (its torn-tail case correctly stays a genesis refusal — assert that, do not seed to mask it), and `test/events-anchor-genesis-guard.test.mjs` (both its valid-genesis `tryAnchor` exit-0 cases seed the floor; its genesis-fault smoke cases tighten from `notEqual(code,0)` to the specific code).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — every decision above is closed.

**Assumptions.**

- **Assumes:** graft Step 9b's anchor-refusal block (`SKILL.md:563`) treats any non-zero `faff events anchor` exit as the park trigger (it reads stderr for the human-facing reason and does not branch on the specific code). Validation: confirmed in prose — "Treat this exactly like any other anchor CLI error". Build agent re-reads `:563` before editing to confirm the generalisation still holds.
- **Assumes:** graft Step 8 always writes `ac-checklist.json` (schema-1 for zero-AC) and Step 9 always writes `review-verdict.json` before Step 9b, so in a healthy flow the guard only ever fires on a genuine defect. Validation: confirmed at `faff-graft/SKILL.md` Steps 8/9; re-check those step numbers before relying on them.

## 8. DONE — Definition of Done

### From WHAT (error contract)
- [ ] The `anchor` command handler, on either required file absent under `<run-dir>/<ISSUE>/`, exits `3`, writes a `floor-incomplete` stderr line naming the missing file, and creates no `--dest` directory.
- [ ] With both required files present, `faff events anchor` still exits `0` and the anchor carries both files (byte-for-byte as before).
- [ ] The required set is exactly `ac-checklist.json` + `review-verdict.json`; `holdout.json` / `build-progress.json` / `landing-progress.json` remain best-effort in `mintIssueAnchor`.

### From HOW (mechanics)
- [ ] The guard is a read-only `fs.existsSync` check in the `anchor` command handler, placed after the ledger-fold precondition and before `mintIssueAnchor(...)`; `mintIssueAnchor` is unchanged.
- [ ] `mintIssueAnchor`, `anchor-run`, and `bundle.js`'s core reuse are byte-for-byte unchanged; a run-level / non-shipped / bundle mint never emits `floor-incomplete`.
- [ ] A zero-AC schema-1 `{all_verified:true}` `ac-checklist.json` (with `review-verdict.json` present) mints at exit `0`.

### From HOW (graft prose)
- [ ] Graft Step 9b's anchor-refusal block (`SKILL.md:563`) names `floor-incomplete` as a third recognised anchor-refusal code, reusing the existing shared Park protocol with a cause line marking it a build-evidence defect (not a provisioning fault). No new park path is introduced.

### Tests (net-new + regression fix)
- [ ] New coverage asserts: (a) both-present + valid genesis → exit 0; (b) valid genesis, `review-verdict.json` absent → exit 3 + `floor-incomplete` + no `--dest` dir; (c) valid genesis, `ac-checklist.json` absent → exit 3 + no `--dest` dir; (d) an `anchor-run` mint over a floor-less issue is unaffected by the guard; (e) **genesis-first ordering** — a floor-less run with an absent/torn genesis refuses with `no-events`/`genesis-invalid` (NOT `floor-incomplete`). (Home: `test/events.test.mjs`, or a dedicated `test/faff-1155-*.test.mjs` mirroring the `test/faff-1001-*` pattern.)
- [ ] The **test invariant** in section 6 holds across the whole suite: every exit-0-expecting per-PR `events anchor` call site has a valid genesis and both floor files seeded; every refusal-expecting site asserts the specific code (`no-events` / `genesis-invalid` / `floor-incomplete`), not a bare `notEqual(code, 0)`. Verified by running the full anchor test suite to green — not by matching a fixed line list.
- [ ] `mintIssueAnchor`'s in-module `--selftest` and `bundle.js`'s selftest need no change (the core is untouched) — confirm both still pass.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Build a run dir with a valid genesis events.jsonl + run-ledger.json and <run>/FAFF-X/{ac-checklist.json, review-verdict.json}.
  2. Run `faff events anchor --run-dir <run> --issue FAFF-X --dest <dest>` → expect exit 0, both files in <dest>.
  3. Delete <run>/FAFF-X/review-verdict.json, re-run to a fresh <dest2> → expect exit 3, "floor-incomplete", <dest2> not created.
```

confidence: high
build-tier: complex
spec-review: approve
