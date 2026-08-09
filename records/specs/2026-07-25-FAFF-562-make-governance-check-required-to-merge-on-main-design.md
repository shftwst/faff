# FAFF-562 — Make governance-check required to merge on main

> Spec: faffter-dark-nlspec · 2026-07-25 · autonomous · confidence: high. Full spec on Linear FAFF-562.

This is a whole-cloth redraft, not a refresh. The 2026-07-22 spec parked on a four-step sequence (emitter commits run dirs → `!.faff/runs/**` carve-out → flip `on-missing` → mark required) whose first two steps were un-shipped and un-ticketed, plus a reopened Punt about *when* to mark the check required. **That sequence is now obsolete.** FAFF-568 (PR #471) and FAFF-623 (PR #491) shipped the emitter side by a different route — the committed per-PR **anchor** under `.faff/anchors/**`, not a run-dir commit — and `.gitignore` already carves out `!.faff/anchors/` (line 21). So the predecessors this ticket was blocked on are done, the reopened Punt is answerable, and the real remaining question is the one the FAFF-623 follow-up sharpened: **how does a required check gate faff's mixed PR population — human-authored PRs alongside agent-built ones — without making `main` un-mergeable for every hand-authored PR?** This spec makes that gating-model call, ships the PR-shippable half, and leaves the one binding action (a repo-admin ruleset toggle) as an honestly-scoped human runbook.

## 1. WHY — Problem and Principles

**The load-bearing model.** A required status check is what turns "the check runs" into "the check can block a merge." FAFF-363 wired `governance-check` to run on every PR, but the repo's "Main" ruleset requires only `validate` (confirmed today: `faff branch-protection-check --branch main` → `required_checks: ["validate"]`), so a PR whose `governance-check` job is red still merges. The floor exists; it is not wired to the door.

**Problem statement.** `governance-check` is advisory. Making it *required* on a mixed repo raises the question the FAFF-623 follow-up put on this ticket: an agent-built (`/faff-graft` or `/faff-beep-boop`) PR commits an anchor carrying merge-floor evidence and can satisfy a required check; a **hand-authored human PR never runs graft, so never carries an anchor at all**. A blanket required check with `on-missing: fail` would permanently block every human PR — not a transitional window, but two structurally different classes of PR. The gating model must make the floor binding for agent PRs while keeping the door open for humans, and it must be safe (a failing floor can't slip through) and born-verifiable.

**The gating discriminator faff already has.** The signal that separates the two PR classes is the **artifact footprint**, not author identity:

- An agent PR commits an anchor under `.faff/anchors/<run>/<issue>/` (graft Step 9b, FAFF-568/623). The anchor carries `events.jsonl` + `run-ledger.json` + `chain-head.json` witness, plus (FAFF-623) the merge-floor files `ac-checklist.json` / `review-verdict.json` / `holdout.json` / `build-progress.json`.
- A hand-authored human PR commits nothing under `.faff/` — `.gitignore` ignores `.faff/*` and carves out only `!.faff/anchors/`, so a human who never ran graft has no anchor to commit.

So **presence-of-anchor is the agent-authorship signal**, and it is exactly the input `governance-check` already discovers from the PR diff. This is what makes the gating model buildable without inventing an author-identity mechanism the repo doesn't have (see §6 for why identity-based detection was rejected).

**Design principles.**

- **Assert, don't enforce — this ticket is the owner acting on the assertion.** The Action and `faff branch-protection-check` never mutate branch protection (ADR-0010). FAFF-562 is the human repo-admin performing faff's own one-time ruleset change. The principle governs the *tooling*, not the owner's settings action.
- **Discriminate by footprint, not identity.** The posture keys off what an agent build leaves in the diff (an anchor), never off who opened the PR — because agent PRs are opened under the human's own `gh` auth (no bot account, no distinguishing commit trailer; see §6).
- **Fail-closed on evidence that is present; adoption-open on evidence that is absent.** A present anchor is gated (integrity + merge-floor); an absent footprint is treated as presumptively-human and passes. This is the only split that is simultaneously safe for agent PRs and non-blocking for humans on a mixed repo.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `.github/workflows/governance.yml` | YAML (Actions) | The workflow (FAFF-363). Currently `on-missing: pass`. Its header comment is the posture write-down surface (Piece B). |
| `.github/actions/governance-check/action.yml` | YAML (composite Action) | Implements the gating wiring. The "Run governance-check" step fires whenever run dirs **or** anchor dirs are discovered and exits with the verb's code — **independent of `on-missing`**, which governs only the zero-footprint branch. This is the wiring that makes Option B already-true (§4). |
| `plugin/skills/faff/bin/lib/governance-check.js` (`evaluateAnchorDir`) | JS | `pass = integrity.pass && merge_floor.pass` on a present anchor (FAFF-568/623). The fail-closed evaluation the required check will bind. |
| `.gitignore` line 20–21 | gitignore | `.faff/*` + `!.faff/anchors/` — the carve-out that makes agent anchors committable and is the reason human PRs carry no footprint. Supersedes the old spec's `!.faff/runs/**` predecessor. |
| The "Main" GitHub ruleset | GitHub settings (not in-repo) | The live enforcement surface. Currently requires only `validate`. No ruleset-as-code in the repo — the flip is a settings mutation (Piece A). |
| `faff branch-protection-check --branch main` | JS CLI | The verification tool. Already reads the **rulesets** surface (`basis: gh api repos/shftwst/faff/rules/branches/main`), so it correctly reports the ruleset's required list before/after the flip. |
| `docs/guide/governance-check.md` §2 | Markdown | The mark-required recipe. Line 72 targets the **legacy** classic-branch-protection endpoint, not the rulesets API this repo uses — load-bearing docs-drift the runbook must correct (broader sweep owned by FAFF-570). |

## 2. OUT OF SCOPE

- **`on-missing: fail` (locked-down mode).** Deliberately not chosen for this repo — see §6. It becomes correct only if/when faff's `main` becomes agent-only (no hand-authored PRs), which is not today's reality. Extension point: the same `on-missing` knob flips with no code change when that day comes; this spec names it as the future lockdown lever.
- **Author-identity detection (Option A).** Rejected as un-buildable on this repo — no bot account, commit trailer, or ruleset author-condition exists to key off (§6). Not deferred-for-later; structurally absent.
- **Label/path-conditioned required checks (Option C).** GitHub rulesets apply `required_status_checks` to *every* PR targeting the branch; a required check cannot be conditioned on PR author or label. Not forge-supported (§6).
- **The emitter side.** Shipped by FAFF-568/623 (anchor commit + merge-floor evidence + `!.faff/anchors/` carve-out). Nothing left for this ticket to do there.
- **Broad docs-drift repair** of `docs/guide/governance-check.md` — owned by FAFF-570. This ticket corrects only the one §2 recipe line its own runbook depends on, and cross-references FAFF-570 for the rest.
- **Project assignment** — whether this lives in the tamper-evidence project or the attestations workstream. Left project-less on purpose; a later tidy/plot pass decides.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Required status check | A check named in a ruleset's `required_status_checks` rule; a PR cannot merge while it is failing/pending. |
| "Main" ruleset | The repo's active GitHub ruleset targeting `main` (rulesets API, not classic branch protection). Currently requires only `validate`. |
| Artifact footprint | What a PR commits under `.faff/anchors/**`. An agent (graft) PR has one; a hand-authored human PR does not. The gating discriminator. |
| `on-missing` posture | What `governance-check` concludes when a PR's diff carries **no** governance artifacts at all: `pass` (adoption — presumptively-human, chosen) or `fail` (locked-down). Governs *only* the zero-footprint branch. |
| Footprint-present gating | A PR that carries an anchor is evaluated (integrity + merge-floor) and fails closed on a broken/incomplete floor — **regardless of `on-missing`**. Already true in the shipped Action (§4). |

**The two deliverables.**

```
DELIVERABLE ruleset-flip (BINDING — human repo-admin only; NOT PR-shippable):
  add "governance-check" to the "Main" ruleset's required_status_checks
  (required: ["validate"] -> ["validate", "governance-check"])
  # A repo-settings mutation that persists regardless of any PR and is not git-revert-reversible.
  # Executed via the GitHub console or `gh api` with admin creds. The loop never performs it (§6).

DELIVERABLE posture-writedown (PR-shippable):
  record on-missing: pass as the deliberate footprint-discriminating posture — not a hole —
  now that footprint-present gating (integrity + merge-floor) is real post-FAFF-623,
  plus a guard test locking the safety property, plus the corrected rulesets runbook.
```

**Design decisions** (full rationale in §6):

- **Chosen:** the gating model is **Option B — footprint-discriminating adoption**. Keep `on-missing: pass`; mark the check required. A present anchor is gated fail-closed (already wired); an absent footprint (presumptively-human) passes. This is the only option that is safe, born-verifiable, and non-blocking for human PRs today.
- **Chosen:** the ruleset flip (Piece A) is executed by a human repo-admin and this ticket *wraps* it (runbook + verification), not the autonomous loop. Even though scriptable via `gh api`, it mutates repo settings outside the PR-merge flow (gateway Autonomous Mode Contract, hard-floor category c).
- **Punt (product, not build-blocking):** which project this eventually lives in — deferred to a later tidy/plot pass; does not affect execution.

## 4. HOW — Behavior

**Why Option B is already true in code (the safety property this spec binds).** The composite Action routes by discovered footprint, not by `on-missing`:

- Discover carried run dirs and anchor dirs from the PR's `base...head` diff.
- If **either** is found → the "Run governance-check" step runs the verb (`--run-dir` / `--anchor-dir …`) and exits with the verb's code. A present anchor whose `evaluateAnchorDir` returns `pass:false` (failing `integrity` or `merge_floor`) → non-zero exit → **check fails**. `on-missing` is never consulted on this branch.
- Only if **neither** is found → the `on-missing` branch runs: `pass` writes a `no governance artifacts carried` summary and passes; `fail` blocks.

So a required `governance-check` with `on-missing: pass` already **fails closed on any present-but-invalid anchor** and **passes any zero-footprint (presumptively-human) PR**. Marking it required binds exactly that behavior. No change to `governance.yml`'s `on-missing` value and no change to the Action logic is required — the gating model is a wiring property FAFF-568/623 already shipped; this ticket makes it *binding* and *documented*.

**Piece A — the ruleset flip (human repo-admin runbook).** The "Main" ruleset gains `governance-check` in its required-checks list. Because the repo uses **rulesets** (not classic branch protection), the flip must target the rulesets API — the legacy endpoint in the current guide (§2 line 72) mutates a different, unused surface and would not bind.

```
PROCEDURE flip-ruleset (run by a human repo-admin):
  1. Discover the ruleset id:
     gh api repos/shftwst/faff/rulesets --jq '.[] | select(.name=="Main") | .id'
  2. Read the current required_status_checks rule:
     gh api repos/shftwst/faff/rulesets/<id> --jq '.rules[] | select(.type=="required_status_checks")'
  3. PATCH the ruleset so required_status_checks contains BOTH "validate" and "governance-check"
     (send the full rules array back with governance-check added — the API replaces the rule wholesale).
     Console path (equivalent): Settings -> Rules -> Rulesets -> "Main" -> Require status checks -> add governance-check.
  4. Confirm: faff branch-protection-check --branch main
     -> required_checks must now list both "validate" and "governance-check".
```

**Anti-pattern:** using `repos/<owner>/<repo>/branches/main/protection/required_status_checks` (the legacy endpoint from the current guide). This repo is protected by a **ruleset**; the legacy endpoint would not bind the merge. This mismatch is the FAFF-570 docs-drift.

**Piece B — the posture write-down + guard test (PR-shippable).**

1. **Posture note.** Rewrite `governance.yml`'s header comment and add a short paragraph to `docs/guide/governance-check.md` §3 stating: `on-missing: pass` is the deliberate **footprint-discriminating** posture for faff's mixed repo — an absent footprint is presumptively-human and passes; a present anchor is gated fail-closed by the `integrity` + `merge_floor` legs (real since FAFF-623). Name the accepted residual (a determined actor could strip the anchor to masquerade as a human PR — §6) and name `on-missing: fail` as the future lockdown lever for an agent-only branch. `governance.yml`'s `on-missing: pass` value is unchanged — this is a documentation change, not a behavioral one.
2. **Correct the runbook recipe.** Replace the legacy `gh api` recipe in `docs/guide/governance-check.md` §2 with the rulesets procedure above, and cross-reference FAFF-570 for the broader sweep.
3. **Guard test** locking the safety property the whole posture rests on: a present-but-invalid anchor exits non-zero from `faff governance-check` **irrespective of any `on-missing` value** (the verb has no `on-missing` input — that lives in the Action — so the test asserts the verb-level fail-closed the Action's wiring depends on: a broken `integrity` or incomplete `merge_floor` anchor → exit 1). This composes with the existing FAFF-568 anchor fail-closed tests (`test/faff-363-governance-check.test.mjs`); the net-new assertion is that the fail is *unconditional*, so a future refactor can't quietly route anchor evaluation behind the adoption-mode branch.

**Failure modes.**

- **The failure:** the flip targets the legacy branch-protection endpoint (per the stale guide) instead of the ruleset. **How you'd know:** `faff branch-protection-check --branch main` still omits `governance-check` after the change. **What it means:** re-do via the rulesets API (Piece A step 3).
- **The failure:** the check name in the ruleset doesn't match the job's reported context (`governance-check`). **How you'd know:** PRs sit forever "Expected — waiting for status" and never merge even when the job is green. **What it means:** the required-check context string must equal the job name exactly; correct it in the ruleset.
- **The residual (accepted, documented):** a determined actor strips the anchor to present as a zero-footprint human PR and bypasses the floor. **How you'd know:** unobservable by construction — the discriminator and the evidence are the same artifact. **What it means:** the inherent limit of adoption mode on a mixed repo; closed only by `on-missing: fail` on an agent-only branch (§6), out of scope here.

## 5. Scenarios

```
Given the "Main" ruleset requires governance-check and on-missing: pass
When an agent-built PR carries an anchor whose review-verdict.json is not "pass" (or whose chain integrity is broken)
Then governance-check fails and the PR is blocked from merging to main
```

```
Given the "Main" ruleset requires governance-check and on-missing: pass
When a hand-authored human PR carries no .faff/anchors footprint
Then governance-check passes, writes "no governance artifacts carried" in its job summary, and the PR is mergeable
```

```
Given a present anchor with a broken integrity or incomplete merge_floor leg
When faff governance-check evaluates it
Then the verb exits non-zero regardless of any on-missing value (guard test)
```

- The required-check flip is verifiable via `faff branch-protection-check --branch main` listing `governance-check` in `required_checks`.

## 6. Design Decision Rationale

**Chosen gating model: Option B — footprint-discriminating adoption (`on-missing: pass` + mark required).**

- **Option A (gate only agent PRs by detecting authorship) — REJECTED, un-buildable here.** There is no robust author-identity signal in the repo: graft opens PRs via `gh pr create` under the human's own `gh` auth (so `github.event.pull_request.user.type` is `User`, not `Bot`, and the author login is the human's), it stamps **no** distinguishing commit trailer (grepped: graft/beep-boop add none), and branch naming (`FAFF-562-…` / `faff-562-…`) is shared with human ticket branches. The only real agent signal is the **anchor footprint** — and gating "only PRs that carry an anchor" *is* Option B. A stronger authorship gate would need an out-of-band identity mechanism this repo doesn't have; inventing one (a dedicated bot account, a signed trailer) is a separate body of work, not this ticket.
- **Option B — CHOSEN.** Keeps human PRs mergeable (zero footprint → `pass`) while binding the floor for the honest agent-PR case (present anchor → fail-closed on a bad floor). It is **born-verifiable** because the fail-closed-on-present-anchor behavior is already wired and tested at the verb level (FAFF-568/623); this ticket adds the guard test that locks its unconditionality and the ruleset flip that makes it binding. Safe within its stated residual.
- **Option C (label/path-conditioned required check in the ruleset) — REJECTED, not forge-supported.** GitHub `required_status_checks` in a ruleset applies to all PRs targeting the branch; the check cannot be made required "only when label X" or "only for author Y." Ruleset *conditions* target ref/path names, not PR authorship or labels. There is no forge mechanism to express Option C.

**The accepted residual, stated honestly.** Because the discriminator (the anchor) and the evidence (the anchor) are the same artifact, a mixed repo cannot simultaneously (a) wave through arbitrary zero-footprint human PRs and (b) force *every* agent PR to prove a floor — an actor who omits the anchor looks human. This is not a defect of Option B; it is the intrinsic ceiling of adoption mode on a repo with hand-authored PRs. It is closed only by removing class (a) — i.e. an agent-only branch/repo where `on-missing: fail` becomes correct with **no code change** (the same knob). This ticket documents that as the future lockdown lever and does not pretend adoption mode is lockdown.

**When to mark required (the old reopened Punt) — RESOLVED.** The 2026-07-22 spec left "mark-required-now-with-`pass` vs mark-required-last-after-predecessors" open because the predecessors (emitter commit + carve-out) were un-shipped. They are now shipped via the anchor path (FAFF-568/623), and footprint-present gating is real — so `on-missing: pass` is no longer "a floor with a hole," it is a floor that binds every PR carrying evidence and admits every PR carrying none. Mark-required-**now** is therefore correct: the check is no longer decorative.

**Human console action vs loop-automatable (Piece A) — CHOSEN: human.** The flip is scriptable via the rulesets API but mutates repo settings — state that persists regardless of any PR and is not `git revert`-reversible: a side-effect outside the PR-merge flow, which the autonomous loop never performs unattended (gateway hard-floor category c). A human repo-admin runs the documented runbook; this ticket wraps it with procedure + verification.

## 7. Open Questions and Assumptions

**Open Questions.** One non-design deferral: which project this eventually lives in — left to a later tidy/plot pass; does not affect build/execution. No design question remains open — the gating model is resolved (Option B).

**Assumptions.**

- **Assumes:** agent PRs commit an anchor under `.faff/anchors/**` and human PRs do not. *Validation:* `.gitignore:20-21` (`.faff/*` + `!.faff/anchors/`); graft Step 9b anchors every run-dir-bearing build; a hand-authored PR runs no graft step. Confirmed against the tree 2026-07-25.
- **Assumes:** the shipped Action fails closed on a present-but-invalid anchor irrespective of `on-missing`. *Validation:* `action.yml`'s "Run governance-check" step is gated on `discover.found || discover-anchors.found` and exits with the verb code; `on-missing` gates only the neither-found branch. `evaluateAnchorDir` returns `pass = integrity.pass && merge_floor.pass`. Existing tests: `test/faff-363-governance-check.test.mjs` (FAFF-568 anchor fail-closed cases).
- **Assumes:** `main` is protected by an active **ruleset** named "Main" requiring only `validate` today. *Validation:* `faff branch-protection-check --branch main --json` → `{"required_checks":["validate"], "basis":"gh api repos/shftwst/faff/rules/branches/main …"}` (run 2026-07-25).
- **Assumes:** the executor of Piece A holds repo-admin rights to edit the ruleset. *Validation:* the human running the runbook can open Settings → Rules, or their token carries admin scope.

## 8. DONE — Definition of Done

### Buildable — PR-shippable (Piece B; deliverable by a normal build)
- [ ] `governance.yml`'s header comment states `on-missing: pass` is the deliberate footprint-discriminating posture (present anchor gated fail-closed since FAFF-623; absent footprint presumptively-human), names the anchor-strip residual, and names `on-missing: fail` as the agent-only lockdown lever. The `on-missing: pass` value itself is unchanged.
- [ ] `docs/guide/governance-check.md` §3 carries the same posture write-down; §2's mark-required recipe is corrected from the legacy branch-protection endpoint to the rulesets procedure, cross-referencing FAFF-570 for the broader sweep.
- [ ] A guard test asserts a present-but-invalid anchor (broken `integrity` or incomplete `merge_floor`) exits non-zero from `faff governance-check` unconditionally, composing with the existing FAFF-568 anchor fail-closed tests.

### Human follow-up — NOT loop-deliverable (Piece A; documented runbook)
- [ ] A repo-admin runs the flip-ruleset runbook (§4): the "Main" ruleset's `required_status_checks` rule lists both `validate` and `governance-check`.
- [ ] `faff branch-protection-check --branch main` reports `governance-check` in `required_checks`.
- [ ] The required-check context string equals the job name `governance-check` exactly (no perpetual "Expected — waiting for status").

### From WHY (satisfied once Piece A lands)
- [ ] An agent PR whose `governance-check` job fails cannot merge to `main`; a zero-footprint human PR still merges with a "no governance artifacts carried" summary.

**Integration smoke test (after Piece A):**

```
Open a throwaway PR carrying a deliberately-invalid anchor (e.g. a review-verdict.json != "pass");
confirm governance-check fails and the merge button is blocked. Then open a normal human PR
carrying no .faff/anchors footprint; confirm it merges with a "no governance artifacts carried" summary.
```

## 9. Appendices

None.

confidence: high
