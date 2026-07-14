# Test-authoring trap: assertions on a commit made INSIDE a faff CLI child go false-red in CI (no repo-local git identity)

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-476.

This spec addresses FAFF-476 for the build agent that hardens `test/helpers/seed-repo.mjs`, and for reviewers auditing the change. It also records — for the record, not for action — that the specific reproduction named in the ticket is **already fixed**, and precisely re-scopes the remaining, still-open work to the shared-helper hardening the ticket's own fix-direction names.

## Already-verified-fixed (audit note, not a DONE item)

The ticket's reproduction (`test/stage.test.mjs`, "a resumable WIP commit is created and the untracked `.env` is not in it") is **already shipped**, in `ddb754b` (landed with FAFF-457, PR #341): `tmpRepo()` now calls `git config user.email`/`git config user.name` (repo-local) right after `git init` (`test/stage.test.mjs:29-37`). The ticket's own "Scope" section already declares this out of scope ("the FAFF-457 point-fix (already shipped)"). Re-verified against current code: `test/stage.test.mjs` at HEAD carries the fix; `node --test test/stage.test.mjs` passes.

Separately, `test/sentry.test.mjs`'s own hand-rolled fixture (its `git(wt, …)` helper, used at `test/sentry.test.mjs:197`, asserting on the `faff sentry abort` WIP commit sha and `git log -1 --pretty=%s` message) has carried repo-local `user.email`/`user.name` since the **original** FAFF-49 commit (`b674f6d`) — this file never had the bug.

**So no test in the suite is currently false-red.** This is why the disposition below is a promotion, not a park: the ticket's own scope already narrows to the *durable, preventative* half — "a shared `tmpRepo`/fixture helper that always sets repo-local git identity, so no test hand-rolls it" — and that half is **not yet done**. `test/helpers/seed-repo.mjs`, the one true shared throwaway-repo substrate (11 consumers), still lacks repo-local identity. It is inert today only because no current consumer pairs it with a CLI-child-commit assertion — but per the ticket's own RCA, that is exactly the kind of gap "each such test rediscovers independently" the moment a new one does.

## 1. WHY

**Load-bearing model:** a git child process reads identity from three places, in order — an explicit `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env var, then repo-local `.git/config`, then global `~/.gitconfig`. A test fixture that only sets the env var protects git commands the *test itself* runs through its own helper — but a nested `faff` CLI child spawned by the test (e.g. `faff sentry abort`, which spawns its own bare `git commit`) gets whatever env the test passed to *that* spawn, which is typically bare `process.env`, not the fixture's env override. With no repo-local config to fall back on, an identity-less environment (CI: no global `~/.gitconfig`) leaves that nested `git commit` with no identity; git refuses and the commit silently no-ops. A developer's global git config masks this locally, so the gap surfaces only in CI — the textbook false-red-in-CI mechanism.

Repo-local `git config user.email`/`user.name`, written once into the throwaway repo's own `.git/config`, is read by **every** git process rooted at that repo — CLI child included — closing the gap regardless of ambient environment.

**Problem:** two test files (`stage.test.mjs`, `sentry.test.mjs`) already carry this fix, each having discovered it independently (one from day one, one via a CI-only false-red incident). The shared substrate every *other* throwaway-repo test uses (`seedRepo`) does not carry it. The next test that pairs `seedRepo` with a CLI-child-commit assertion will rediscover the same trap the hard way (green locally, red in CI) — exactly the failure mode this ticket exists to prevent, not just to patch once more.

**Design principles:**

**Fix the shared substrate, not the ambient environment.** Setting a global git identity in CI (`.github/workflows/validate.yml`) would make today's tests pass, but it restores the exact masking effect that hid this bug for months — any other identity-less context (a fresh contributor machine, a devcontainer, a different CI provider, `GIT_CONFIG_GLOBAL=/dev/null` used deliberately for isolation) stays vulnerable. `seed-repo.mjs`'s own header already states the house philosophy — "Determinism is PROVISIONED, not assumed" — repo-local identity is the environment-independent instance of that rule.

**Scope statement:** this is a test-harness-only change (`test/helpers/seed-repo.mjs`); no production code path changes. It complements, not replaces, the two already-correct hand-rolled fixtures.

| System | Language | Relevance |
|---|---|---|
| `test/helpers/seed-repo.mjs` | JS (Node test helper) | The shared throwaway-repo substrate to harden — this spec's locus |
| `test/stage.test.mjs:29-37` | JS | Reference implementation of the fix, already shipped (FAFF-457) |
| `test/sentry.test.mjs:197` | JS | Second independent reference implementation, correct since inception |
| `plugin/skills/faff/bin/lib/sentry.js:688` | JS | The one CLI-child `git commit` spawn site in the whole codebase today |

## 2. OUT OF SCOPE

- **The FAFF-457 point-fix in `test/stage.test.mjs`** — already shipped (`ddb754b`), and explicitly named out of scope by the ticket itself. No action.
- **A CI-wide git identity (`git config --global` in `validate.yml`)** — rejected direction. It would mask the gap rather than close it (see Design principles above); no change proposed to `.github/workflows/validate.yml`.
- **Hardening `sentry.js`'s CLI-side commit to fail loudly on a missing identity** — the swallow at `plugin/skills/faff/bin/lib/sentry.js:688-692` is intentional, documented production behaviour ("WIP commit is best-effort" — a real worktree always has an operator identity, so this is a test-environment gap, not a runtime one, per the ticket's own scope note). Not touched. Extension point: if a future ticket wants abort-WIP failures surfaced, that is a `sentry.js` change with its own spec, not this one.
- **Migrating `test/stage.test.mjs` / `test/sentry.test.mjs` onto `seedRepo`** — both fixtures are small, already correct, and don't use `seedRepo`'s commit/branch/spec-seeding surface; forcing a migration is pure refactor risk for zero behavioural gain. Extension point: a future test-harness consolidation ticket, if the duplication becomes a maintenance burden.
- **A static lint/guard flagging "a test spawns a CLI subcommand that commits, in a repo without repo-local identity"** — the ticket names this as optional. Today there is exactly one CLI-child commit site in the whole codebase (`sentry.js:688`) and exactly two consuming tests, both already correct; a bespoke static-analysis pass is disproportionate to that surface. Extension point: if the CLI grows more commit-producing subcommands (a real `graft`/`park` CLI entrypoint, not today's skill-prose-driven flow), revisit — `faff validate-adapters` (`plugin/skills/faff/bin/lib/*` contract-validators) is the natural home for a future check.

## 3. WHAT

**Vocabulary:**

| Term | Definition |
|---|---|
| Repo-local git identity | `user.email`/`user.name` set via `git config` (no `--global`), written to the repo's own `.git/config`; read by every git process rooted at that repo, including a spawned child |
| CLI-child commit | A `git commit` invoked by the `faff` CLI binary itself (a nested child of the test process), as opposed to a commit the test's own git helper runs directly |

No new types or interfaces — this is a same-shape addition to `seedRepo`'s existing internal `git()` runner (`test/helpers/seed-repo.mjs`); no change to `seedRepo`'s public `spec`/return-value contract.

**Design decision:**

**Locus: harden `seed-repo.mjs` vs. CI-wide config vs. CLI-hardening vs. a new dedicated helper.**
- CI-wide git config: rejected (masks the environment-dependence rather than removing it — see Design principles).
- CLI-hardening (`sentry.js`): rejected (the swallow is deliberate, documented, production-correct behaviour; not a bug).
- A brand-new dedicated `tmpRepo`-style helper: rejected — `seedRepo` is already the designated, actively-used shared substrate (11 consumers) for exactly this need; adding a second competing helper duplicates the choice this ticket exists to close.
- **Chosen:** extend `test/helpers/seed-repo.mjs`'s existing repo-provisioning step to set repo-local `user.email`/`user.name` immediately after `git init`, alongside its existing `DETERMINISM_ENV` neutralisation (`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` → `/dev/null`). This is the smallest change that closes the gap for every current and future `seedRepo` consumer, matches the two already-correct reference implementations, and is architecturally consistent with the file's own stated determinism philosophy.

## 4. HOW

**Approach:** in `test/helpers/seed-repo.mjs`'s `provision()` function, immediately after the existing `git("init", "-b", spec.defaultBranch || "main");` call (currently line 99), add two calls setting repo-local identity through the same `git()` runner already defined in the file (so failures throw loud, consistent with every other step in `provision()`):

```
PROCEDURE provision():
  1. git("init", "-b", <defaultBranch>)
  2. git("config", "user.email", "test@faff.invalid")   # NEW — repo-local, matches
  3. git("config", "user.name", "faff test")            # NEW —   DETERMINISM_ENV's existing identity values
  4. ...(existing commit/branch/spec/worktree provisioning, unchanged)
```

Use the **same** literal identity values already in `DETERMINISM_ENV` (`test@faff.invalid` / `faff test`) so a commit made via the env-var path and a commit made via a CLI child are attributed identically — no test can distinguish which path produced a given commit by author, avoiding a new, accidental behavioural difference between the two.

**Edge cases:**
- `useGit` false (`spec.git === false`, no-git seed) — the two new calls sit inside the existing `if (useGit) { ... }` block, so a no-git seed is unaffected.
- Existing consumers that seed **zero** commits (`commits: []`, no branches/worktree/specs) — `git config` is idempotent and cheap; runs unconditionally as part of repo setup, same as `git init` does today.
- A future consumer that spawns a CLI child inside a `seedRepo`-provisioned repo — now covered by construction, no fixture-author action required.

**Anti-pattern:** don't gate the new `git config` calls behind a new opt-in `spec` flag (e.g. `spec.repoLocalIdentity`). Why: an opt-in default keeps the trap live for every consumer that doesn't know to opt in — the entire point of a shared, durable fix is that it applies unconditionally.

## 5. Scenarios

```
Given a fresh `seedRepo()`-provisioned throwaway repo (any spec, git enabled)
When any process spawned inside that repo — including a nested `faff` CLI child — runs `git commit`
Then the commit succeeds using the repo-local identity, with no dependency on ambient (global/system) git config
```

```
Given a `seedRepo()`-provisioned repo run under `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null` (the CI-identity-less condition reproduced in FAFF-476's evidence)
When `node --test` is run against every existing consumer of `seedRepo` (`test/faff-tidy*.test.mjs`, `test/rendering-routing.test.mjs`, `test/eval-*.test.mjs`, `test/skill-harness.test.mjs`, `test/decision-assert.test.mjs`, `test/seed-repo.test.mjs`)
Then every test still passes — the hardening is a strict addition, not a behavioural change for existing consumers
```

- Non-functional: the new `git config` calls add no new dependency (`git` is already the CLI's own runtime dependency, per the file's existing header comment) and no measurable runtime cost (two more sub-ms `git config` invocations per seeded repo).

## 6. Design decision rationale

**Where should the durable fix live — CI config, the CLI's commit path, or the test harness?**
- CI-wide identity: would fix today's known cases but re-introduces environment-dependence (see WHY/OUT OF SCOPE) — rejected.
- CLI-hardening: the one commit site (`sentry.js:688`) is deliberately best-effort by production design; changing it conflates a test-fixture gap with a production behaviour change — rejected.
- **Chosen:** test-harness locus, specifically `seed-repo.mjs` — the shared substrate the ticket's own fix-direction section names, matching the pattern both already-fixed test files independently converged on.

**Should this also build a lint/guard?**
- **Chosen:** not now. The ticket names the lint/guard as explicitly optional; today's surface is one CLI-child commit site (`sentry.js:688`) and two consumers, both already correct — a bespoke static-analysis pass is disproportionate to that surface, and the `seed-repo.mjs` hardening above closes the actual live gap. Revisit (natural home: `faff validate-adapters`) if/when the CLI grows more commit-producing subcommands.

## 7. Open questions and assumptions

**Open Questions:** none — every design decision above is marked `**Chosen:**`, none deferred to a human reviewer.

**Assumptions:**
- `seed-repo.mjs`'s `DETERMINISM_ENV` identity values (`test@faff.invalid` / `faff test`) remain the house convention for test-authored commits — validated by grep: unchanged since the file's FAFF-90 introduction, still referenced by every current consumer.
- No current `seedRepo` consumer relies on the *absence* of a repo-local identity (e.g. asserting that a commit inside the seeded repo fails for lack of identity) — validated by reading all 11 current consumers' test bodies; none assert commit failure.

## 8. Done

### From WHY / WHAT
- [ ] `test/helpers/seed-repo.mjs`'s `provision()` sets repo-local `git config user.email` and `git config user.name` immediately after `git init`, using the same identity values as `DETERMINISM_ENV`.
- [ ] The two new calls run through the file's existing `git()` runner (so a failure throws loud, consistent with every other provisioning step).

### From HOW (edge cases)
- [ ] The new calls sit inside the existing `if (useGit) { ... }` guard — a `spec.git === false` seed is unaffected.
- [ ] No new opt-in flag gates the behaviour — it applies unconditionally to every `seedRepo` call.

### Integration smoke test
- [ ] `node --test test/seed-repo.test.mjs` and every other current `seedRepo` consumer (`test/faff-tidy.test.mjs`, `test/faff-tidy-repeat-park.test.mjs`, `test/rendering-routing.test.mjs`, `test/eval-ollama-model.test.mjs`, `test/eval-shaping-decomposition-drysmoke.test.mjs`, `test/eval-verdict-build-drysmoke.test.mjs`, `test/eval-live-driver.test.mjs`, `test/eval-reconciliation-drysmoke.test.mjs`, `test/eval-run-live-evals.test.mjs`, `test/skill-harness.test.mjs`, `test/decision-assert.test.mjs`) pass unchanged, run both normally and under `HOME=/tmp/x GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null` (the FAFF-476 identity-less repro condition).
- [ ] A manual scratch check: inside a `seedRepo()`-provisioned repo with `GIT_CONFIG_GLOBAL=/dev/null`, spawn `faff sentry abort --worktree <seeded worktree> ...` (or any future CLI-child-commit path) and confirm the resulting commit lands with the repo-local identity — demonstrating the gap this spec closes, not just the absence of regressions.

---
**Self-review audit trail:** clean-context reviewer independently re-verified all five load-bearing claims against current code (git log/show, grep, direct file reads) — `test/stage.test.mjs:29-37`'s fix, `test/sentry.test.mjs`'s independent day-one correctness (`b674f6d`), the zero-hit grep across all 11 other `seedRepo` consumers for any CLI-spawn, the single `sentry.js:688` commit site with its intentional swallow, and the absence of a real `graft`/`park` CLI subcommand. Verdict: ready to attach as-is, no corrections. (One prior finding, already applied before this pass: the lint/guard question was reframed from `**Punt:**` to `**Chosen:** not now`, so Open Questions is empty and confidence legitimately reads `high` per the producer's own rubric.)

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues — a 2-line addition to one existing test helper (`test/helpers/seed-repo.mjs`), sub-hour build; deliberately does NOT bundle the already-shipped point-fix or a migration of the two already-correct hand-rolled fixtures.
- **Workstream fit?** No issues — test-determinism / test-harness-authoring convention; sibling of FAFF-462 (still open, different file/mechanism) and FAFF-467 (parked premise-superseded, different file) — this ticket's own scope already narrows to the one remaining, still-undone half its RCA names.
- **Deps surfaced?** None — no blocker on or from FAFF-462/467; independent of both.
- **Risk profile?** Low — additive-only to a shared fixture; confirmed by grep that no current consumer depends on the absence of repo-local identity; DONE items require running the full existing `seedRepo`-consumer suite (11 files) both normally and under the identity-less repro condition before merge.

confidence: high
