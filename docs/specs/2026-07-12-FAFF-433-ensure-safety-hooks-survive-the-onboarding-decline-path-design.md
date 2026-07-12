# Spec — Ensure safety hooks survive the onboarding decline path (FAFF-433)

> Spec: faffter-dark-nlspec · 2026-07-12 · autonomous · confidence: high. Full spec on Linear FAFF-433.

This spec addresses FAFF-433 for the build agent and human reviewers. It closes a first-run asymmetry: accepting the onboarding offer registers faff's Stop hooks; declining it does not — leaving `runcheck`/`prepcheck` absent for a decline-then-work user. The fix restores accept/decline parity at the one place the asymmetry is born.

## 1. WHY — Problem and Principles

**Load-bearing model.** faff's Stop hooks (`runcheck --hook`, `prepcheck --hook`) are the *harness-enforced* backstops that make the run-ledger completeness guarantee and the same-turn spec-attach guarantee real rather than prose-only. They live in `.claude/settings.json`, put there by `faff hooks-ensure`. The **only** interactive path that runs `hooks-ensure` today is `/faff-onboard` step 5 — which the first-run **decline** branch skips entirely, because decline never enters onboard.

**Problem statement.** The gateway "First run" soft-offer has two outcomes: *accept* → invoke `/faff-onboard` (which runs `gitignore-ensure` + `hooks-ensure` at step 5), and *decline* → write a minimal stub `.faffrc.yaml` via `faff config init --set tracking.spec_docs_path=` so the offer doesn't re-fire. The decline branch writes the stub and stops — it never runs the two ensurers. A user who declines then runs `/faff-beep-boop` (or interactive `/faff-prep`) has no Stop-hook backstop: the run-ledger honesty guard the README sells is silently absent.

**Design principles.**

- **First-run parity is the invariant.** Whichever way the human answers the offer, the repo must end up in the same *infrastructure* state — `.faff/` gitignored and both Stop hooks registered. The answer to the offer governs whether a `tracking:` config is populated, not whether the safety backstops exist. Any fix that leaves the two outcomes divergent on hooks is treating a symptom.
- **Fix at the source of the asymmetry, not at each consumer.** The gap is one missing action on one branch. Patching every downstream consumer to self-heal (beep-boop, prep, …) multiplies the surface and still misses the next consumer. Fix where the divergence is introduced.
- **Idempotent, safe-by-construction.** The ensurers are already idempotent and non-destructive (`hooks-ensure` is a byte-stable no-op when present and *skips* a hook the resolved bin can't serve rather than wiring a session-blocker). Adding them to the decline branch cannot regress a repo that already has them.

**Scope statement.** A prose change to the gateway's first-run decline branch (plus a regression test pinning the mechanical guarantee). It touches faff's config-bootstrap seam, nothing in the run/build pipeline.

## 2. OUT OF SCOPE

- Changing `/faff-onboard` step 5 — it already runs both ensurers correctly (the reference, not the defect).
- Removing / altering beep-boop's own `hooks-ensure` self-heal — legitimate defence-in-depth, now a redundant safety net.
- New `faff` subcommand or a combined `faff bootstrap` ensurer — unjustified for a one-line parity fix.
- Autonomous-mode hook provisioning — the first-run offer is interactive-only by contract.

## 3. WHAT — Behavior contract

**The behavioural change (decline branch, after the stub write):**

```
PROCEDURE first_run_decline():
  1. Write the stub config:
       "$faff" config init --set tracking.spec_docs_path=
  2. Run the two ensurers, exactly as onboard step 5 does, using the SAME resolved "$faff":
       a. "$faff" gitignore-ensure     # .faff/ + rc forms ignored; no-op if already
       b. "$faff" hooks-ensure         # runcheck + prepcheck Stop hooks; no-op if already;
                                       # skips a hook the resolved bin can't serve (never a session-blocker)
  3. Continue the original command on defaults (unchanged).
```

**`$faff` resolution.** The decline branch already holds a resolved `"$faff"` (it invokes `config init`). Reuse it — do **not** re-resolve or hardcode a path.

**Design decisions.**

- **Fix locus.** Chosen: (a) — add `gitignore-ensure` + `hooks-ensure` to the decline branch, mirroring onboard step 5. Rationale: single edit at the source of the asymmetry, consumer-agnostic, reuses already-tested idempotent machinery.
- **Include `gitignore-ensure`, not just `hooks-ensure`.** Chosen: run the pair, matching onboard step 5, so decline parity is total.

## 4. HOW — Behavior

The decline branch is agent-executed gateway prose in `plugin/skills/faff/SKILL.md` → **First run**; there is no JS code path to edit. The change: after the sentence that specifies the stub `config init` write, append the instruction to run `gitignore-ensure` then `hooks-ensure` with the same resolved `"$faff"`, naming that this mirrors onboard step 5 and that both are idempotent no-ops when already wired.

**Anti-pattern:** Re-resolving `"$faff"` or hardcoding `~/.claude/skills/faff/bin/faff` in the decline branch.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a fresh repo with no .faffrc.yaml and no faff Stop hooks in .claude/settings.json
When the first-run decline branch runs its sequence — `config init --set tracking.spec_docs_path=`, then `gitignore-ensure`, then `hooks-ensure`
Then .claude/settings.json contains a Stop-hook command invoking `runcheck --hook` AND one invoking `prepcheck --hook`
 And .faffrc.yaml exists so `faff config path` exits 0 (the offer will not re-fire)
```

```
Given a repo where the decline sequence has already run once (both hooks present)
When the decline sequence's ensurers run again
Then `hooks-ensure` reports no change (byte-stable no-op) and settings.json is unmodified
```

## 8. DONE — Definition of Done

- [ ] The first-run decline branch leaves the repo with both `runcheck` and `prepcheck` Stop hooks registered — accept/decline parity holds.
- [ ] `plugin/skills/faff/SKILL.md` → **First run** decline bullet instructs running `gitignore-ensure` then `hooks-ensure` with the already-resolved `"$faff"`, after the stub `config init` write, cross-referencing onboard step 5.
- [ ] The instruction reuses the resolved `"$faff"` — no re-resolution, no hardcoded path.
- [ ] Both ensurers are described as idempotent no-ops when already wired.
- [ ] A test seeds a fresh repo, runs the decline mechanical sequence, and asserts `.claude/settings.json` Stop array contains a command invoking `runcheck --hook` **and** one invoking `prepcheck --hook`; asserts `.faffrc.yaml` exists; a second ensurer run is a byte-stable no-op.

confidence: high
