# FAFF-623 — Emitter-side governance artifacts: extend the FAFF-568 anchor to the merge-floor leg

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-623.

This spec re-scopes FAFF-623 after FAFF-568 (merged, PR #471) shipped the chain-anchor mechanism the original framing assumed didn't exist. It is the residual emitter-side slice that makes `governance-check`'s `merge_floor` leg gate on real, PR-carried evidence instead of running as a permanent no-op on anchor dirs. Flipping `on-missing: pass → fail` (the original ticket's step 3) is **out of scope** here — see §2 for why, and the FAFF-562 follow-up this leaves behind.

## 1. WHY — Problem and Principles

**The re-scoping premise, verified against the live repo.** FAFF-596 and the original FAFF-623 framing assumed no PR-branch evidence-commit convention existed and proposed inventing one (`.governance/runs/<run-id>/` or a bare `!.faff/runs/**` carve-out). That premise is false as of FAFF-568 (PR #471, merged 2026-07-23): `.gitignore` already carries `.faff/*` + `!.faff/anchors/`, `faff events anchor --run-dir <dir> --issue <ID> --dest .faff/anchors/<run>/<ID>/` already byte-copies `events.jsonl` + `run-ledger.json` and CLI-computes a `chain-head.json` witness, faff-graft Step 9b already calls it for every autonomous build with a run dir, and `governance-check`'s Action already discovers anchor dirs from the PR diff and flags `anchor-missing-for-run-dir` when a run dir ships without one. Re-inventing a parallel `.governance/runs/` convention would duplicate all of this for no reason.

**What's actually still missing.** `evaluateAnchorDir` (`governance-check.js`) is deliberately hardcoded integrity-only: `completeness`, `budget`, and `merge_floor` are all marked `n/a` regardless of what the anchor carries, because the anchor today physically carries only `events.jsonl` + `run-ledger.json` — nothing the `merge_floor` leg needs (`ac-checklist.json`, `review-verdict.json`, and at L4 `holdout.json`, all read from `<run-dir>/<issue>/…` by the exact functions `merge-gate` itself uses — `readAcComplete`/`readReviewVerdict`/`readHoldout`). So today a PR can carry a clean, witness-verified anchor and still `pass` governance-check even if its review never actually passed or its AC checklist is incomplete — the check verifies the chain wasn't tampered with, but asserts nothing about whether the work actually cleared its own floor. That gap — not the emitter/carve-out plumbing, which already exists — is FAFF-623's real residual scope.

**Design principles:**

- **Reuse the anchor, don't parallel it.** The anchor step is already the one committed, per-PR, CLI-witnessed evidence surface. This change widens *what* it carries and *what governance-check does with it*; it introduces no second commit mechanism, no second carve-out, no second discovery path.
- **Only widen legs that are safely PR-scoped.** `merge_floor` reads floor artifacts scoped to a single issue (`ac-checklist.json`, `review-verdict.json`, `holdout.json` under one `<issue>/` dir) — nothing about it depends on the rest of a shared run. `completeness` and `budget`, by contrast, sweep the *whole* `run-ledger.json`'s `admitted` array / the run's full `budget-checkpoint` history — exactly the run-scoped-vs-PR-scoped mismatch FAFF-568 already identified as the reason a live `run-ledger.json` can't be swept per-PR (a beep-boop run with several issues still in flight would false-fail every one of them). Those two legs stay `n/a` on anchors; only `merge_floor` (and the existing `integrity`) become real gates. `liveness` is a live-process-staleness check and has no PR-scoped meaning at all; it also stays `n/a`.
- **Same finalisation point, no new race.** The additional files are copied at the exact point the anchor already fires — after Step 9's review verdict is persisted and the PR is open — so `ac-checklist.json`/`review-verdict.json` are already terminal, never a live-in-progress snapshot.
- **Fail closed on old anchors, not fail loud.** An anchor written before this change (or by a caller that never had merge-floor evidence to give it) simply won't have `ac-checklist.json`/`review-verdict.json` beside it — `readAcComplete`/`readReviewVerdict` already return `false`/`"missing"` on an absent file, which `evaluateMergeFloorLeg` already turns into a normal `reasons` entry. No new "old anchor" special case is needed; the existing fail-closed behaviour of the functions being reused is exactly correct here, and because `on-missing` stays `pass` (see §2), this never blocks a PR that predates the change.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/events.js` (`cmdEvents`, `anchor` subcommand) | Where the anchor snapshot is written; gains the additional per-issue-file copy this spec adds |
| `plugin/skills/faff/bin/lib/governance-check.js` (`evaluateAnchorDir`, `evaluateMergeFloorLeg`) | `evaluateAnchorDir` is where `merge_floor` moves from hardcoded `n/a` to a real leg; `evaluateMergeFloorLeg` is reused unchanged, called as `(dir, ".", level)` — corrected during implementation from this spec's first-draft `(path.dirname(anchorDir), issue, level)`, which only resolves correctly when the anchor dir's own basename happens to equal the issue id (true for graft's own `.faff/anchors/<run>/<issue>/` convention, but not a real invariant of the function or of `--anchor-dir` callers generally — the existing test fixtures violate it). `"."` is a deliberate `path.join` no-op (`path.join(dir, ".", "x")` normalises to `path.join(dir, "x")`), so the floor files are read straight out of `dir` itself regardless of its basename |
| `plugin/skills/faff/bin/lib/merge-gate.js` (`readAcComplete`, `readReviewVerdict`, `readHoldout`) | Reused verbatim — the same functions `merge-gate` itself calls at merge time; no forked rule |
| `plugin/skills/faff-graft/SKILL.md` §9b ("Anchor the chain head first") | Where the anchor is invoked; widens from copying 2 files to copying up to 5, and drops the "autonomous run dirs only" scoping (see §3) |
| `.github/actions/governance-check/action.yml` | No input/discovery changes needed — it already passes every discovered anchor dir through `--anchor-dir`; the leg widening is entirely inside `evaluateAnchorDir` |
| `.github/workflows/governance.yml` | Explicitly **not** touched by this ticket — see §2 |

## 2. OUT OF SCOPE

- **Flipping `on-missing: pass → fail` (originally step 3 of this ticket, and FAFF-562's own scope).** **Chosen: leave this to FAFF-562, not folded into this PR.** `governance.yml`'s own header names the reason `on-missing` is `pass` today: *"faff's own repo is mixed (human PRs alongside agent-built ones)"*. That reason is untouched by this change — this ticket makes **graft-built** PRs carry richer evidence; it does nothing for a PR a human opens by hand with no `faff-graft` run behind it at all, which will never carry an anchor regardless of how complete the anchor format becomes. Flipping `on-missing` to `fail` today would permanently block every hand-authored PR, not just a transitional window before evidence "reliably lands" — there's no sequencing fix inside this PR that resolves that, because the two are different classes of PR, not different points in time. Per the operating brief's own caution: ship the emitter half, leave the flip as a documented follow-up on FAFF-562, which needs its own decision about a human-PR carve-out (e.g. path-based exemption, or accepting `on-missing: fail` only once/if this repo's workflow becomes agent-only). Extension point: FAFF-562 reads this ticket's `merge_floor`-widened anchor as the evidence shape a future flip would gate on.
- **PR-scoping `completeness` / `budget` / `liveness` for anchors.** These stay `n/a` on anchor dirs, exactly as today — see the design principle above (run-scoped ledger sweep vs. PR-scoped anchor is a real mismatch, not a missing-copy problem). Extension point: a future ticket could design a run-manifest-scoped variant of these legs (e.g. per-issue budget/completeness slices written at anchor time), but that's new leg semantics, not this ticket's file-copy widening.
- **Extending the emitter to non-graft (hand-authored) PRs.** Out of reach for an automated step by construction — there's no build pipeline to hook for a PR faff never touched. This is exactly the residual gap §2's first bullet leaves for FAFF-562 to resolve on the policy side, not the emitter side.
- **Chaining `declared-effects.jsonl` (FAFF-621) or any new chain/hash mechanism.** This ticket copies existing terminal files; it invents no new evidence format.

## 3. WHAT — Vocabulary and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| anchor (existing, FAFF-568) | The immutable, committed per-PR snapshot at `.faff/anchors/<run-id>/<issue-id>/`, today holding `events.jsonl` + `run-ledger.json` + `chain-head.json` |
| merge-floor evidence (new to the anchor) | `ac-checklist.json` + `review-verdict.json` (always) + `holdout.json` + `build-progress.json` (L4 builds only) — the files `merge-gate` re-reads at merge time, now byte-copied into the anchor alongside the existing two files. `build-progress.json` is required alongside `holdout.json`, not optional to it: `readHoldout` compares the holdout verdict's timestamp against `build-progress.json`'s `updated_at`/`build.pushed_at` to reject a stale holdout — without it, `readHoldout` sees no checkpoint, treats the holdout as unprovably fresh, and returns `"blocked"` even for a genuinely valid L4 holdout. |
| anchor merge-floor leg | The `merge_floor` entry in `evaluateAnchorDir`'s result, computed by calling the existing `evaluateMergeFloorLeg(dir, ".", level)` against the anchor's own copied files (see the reference-context row above for why `"."`, not a `path.dirname` reconstruction) — a real gating leg instead of the current hardcoded `n/a` |

**Interfaces changed:**

- `faff events anchor --run-dir <dir> --issue <ID> --dest <dest>` (`events.js`) — **Chosen:** after the existing `events.jsonl`/`run-ledger.json` copy, also copy `<dir>/<ID>/ac-checklist.json`, `<dir>/<ID>/review-verdict.json`, `<dir>/<ID>/holdout.json`, and `<dir>/<ID>/build-progress.json` into `<dest>` **when each source file exists** (each copy is independently best-effort-present, never required). No new flags; no change to `chain-head.json`'s shape.
- `evaluateAnchorDir(dir, legacyPolicy, level)` (`governance-check.js`) — **Chosen:** gains a `level` parameter (default `"L3"`), and its `merge_floor` field becomes `evaluateMergeFloorLeg(dir, ".", level)` instead of the hardcoded n/a stub (the `issue` field on the returned result is still the real issue id, read from `chain-head.json` and spliced onto the leg's own `.issue` for display — only the file-lookup path uses `"."`). `pass` becomes `integrity.pass && merge_floor.pass` (was `integrity.pass` alone). `completeness`/`budget`/`liveness` keep their existing `n/a`, hardcoded-pass stubs, unchanged.
- Adversarial review flagged that `--issue` reaches a filesystem read (`path.join(dirArg, issueArg, file)`) in the `faff events anchor` subcommand without the same shape validation `merge-gate.js`'s `--issue` already applies. **Chosen (fixed during review):** `events.js`'s `anchor` subcommand now rejects a malformed `--issue` (anything outside `^[A-Za-z0-9][A-Za-z0-9._-]*$` or containing `..`) with the same regex `merge-gate.js` uses — defence-in-depth on a CLI trust boundary, not a forked rule.
- `cmdGovernanceCheck`'s call site for anchor dirs — **Chosen:** thread the already-parsed `--level` flag through to `evaluateAnchorDir`.
- `faff-graft/SKILL.md` §9b — **Chosen:** drop "autonomous run dirs only" (runs in both interactive and autonomous), and name the full copied-file set.

## 4. HOW — Behaviour

**`faff events anchor` (extended):**

1. Existing behaviour unchanged: read `<run-dir>/events.jsonl`, copy it + `run-ledger.json` into `--dest`, compute + write `chain-head.json`.
2. New: for each of `ac-checklist.json`, `review-verdict.json`, `holdout.json`, `build-progress.json`, check `<run-dir>/<issue>/<file>`. If it exists, copy it into `--dest/<file>`. If it doesn't exist, skip silently.
3. The console summary line names which optional files were copied.

**`evaluateAnchorDir` (extended):**

1. Compute `integrity` exactly as today.
2. Resolve `issue` from `chain-head.json`'s `issue` field, falling back to `path.basename(dir)`.
3. Compute `merge_floor := evaluateMergeFloorLeg(dir, ".", level)`, then splice the real `issue` (from step 2) onto the returned leg's `.issue` field for display.
4. `completeness`, `budget`, `liveness` unchanged (`n/a`).
5. `pass := integrity.pass && merge_floor.pass`.

**faff-graft Step 9b (extended):**

1. After Step 9 returns `pass` and the PR is open, run `faff events anchor` in **both** interactive and autonomous mode.
2. `git add .faff/anchors/... && git commit && git push` — unchanged mechanics, now covering up to seven files.
3. The existing "no run dir ⇒ skip" and "run dir without anchor ⇒ `anchor-missing-for-run-dir`" behaviour is unchanged.

## 5. SCENARIOS

**Given** a graft build at L3 completes Step 9 with `review-verdict.json: pass` and a fully-checked `ac-checklist.json`, **when** Step 9b anchors the run and the PR opens, **then** `governance-check`'s anchor sweep now reports `merge_floor: pass` (previously always `n/a`).

**Given** a graft build whose review verdict is `needs-human`, **when** a human later opens the PR by hand without re-running graft, **then** the anchor (if any survives) may lack a fresh `review-verdict.json` and `merge_floor` correctly reports `pass:false` — this does not gate the merge today because `on-missing` is unchanged (§2).

**Given** an anchor written before this ticket ships, **when** `governance-check` evaluates it, **then** `merge_floor` reports `pass:false` — and since `on-missing` stays `pass`, no existing PR is newly blocked.

**Given** an L4 build with a `meets-spec` holdout verdict, **when** it anchors, **then** the anchor also carries `build-progress.json` alongside `holdout.json` — without it, `readHoldout`'s freshness check would return `"blocked"`, false-failing a genuinely valid L4 holdout.

**Given** an interactive (human-run) `/faff-graft` build reaches Step 9b, **when** it anchors, **then** the same evidence a human reviewer already watched land locally is now also visible to `governance-check`.

## 6. DESIGN DECISION RATIONALE

**Chosen: widen the existing anchor rather than invent `.governance/runs/`.** A parallel convention would mean two carve-outs, two discovery paths, two witness formats — pure duplication with no capability gain.

**Chosen: `merge_floor` only, not `completeness`/`budget`.** These are structurally run-scoped in a way `merge_floor` is not — forcing symmetry would reintroduce FAFF-568's already-flagged false-fail risk.

**Chosen: drop the interactive-mode restriction on anchoring.** No cost, real benefit — interactive-built PRs get the same `merge_floor` signal.

**Chosen (re-affirmed): leave `on-missing` alone.** See §2 — `governance.yml`'s own stated rationale (mixed human/agent PRs) is unaffected by anything in this ticket.

**Punt: does FAFF-562 need a path-based `on-missing` exemption, or should it wait for an agent-only workflow?** Left to FAFF-562.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes:** `chain-head.json`'s `issue` field is always populated by the existing `events anchor` command.

**Assumes:** `readAcComplete`/`readReviewVerdict`/`readHoldout` require no changes given the anchor's directory layout.

**Punt:** whether `faff events anchor`'s optional-file copy should warn when `--issue` names a subdir that doesn't exist at all — left to implementation judgement.

## 8. DONE — Definition of Done

- `faff events anchor` copies `ac-checklist.json`/`review-verdict.json`/`holdout.json`/`build-progress.json` into the anchor dest when present.
- `evaluateAnchorDir` computes a real `merge_floor` leg via `evaluateMergeFloorLeg`, threaded a `level` parameter.
- Anchor aggregate `pass` requires `integrity.pass && merge_floor.pass`.
- `faff-graft/SKILL.md` §9b anchors in both interactive and autonomous mode.
- Test coverage per §5's scenarios, including the L4 holdout-freshness case.
- `.github/workflows/governance.yml`'s `on-missing` is unchanged.
- A follow-up note is left on FAFF-562.

**Operational heads-up (adversarial review):** governance-check is not yet a required status check (that flip is FAFF-562's own unshipped scope), so this change cannot newly *block* any merge. But any already-open PR carrying a pre-this-ticket anchor (events.jsonl + run-ledger.json only, no floor files) will start showing governance-check as **failing** rather than passing on its next push, once this merges — a visible status-check regression, not a merge block. Worth a one-line mention in the PR description so it doesn't read as a surprise.

confidence: high
