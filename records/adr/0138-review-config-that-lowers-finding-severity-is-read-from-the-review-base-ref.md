# ADR 0138 — Review config that lowers finding severity is read from the review base ref

- **Status:** Accepted
- **Provenance:** human
- **Date:** 2026-10-15
- **Issue:** FAFF-1279

## Context

Code review judges a PR's diff and can cap the severity of findings on paths the repo declares to be test data. FAFF-1279 adds the first such setting, `review.fixture_paths`, so that eval fixture files stop being reviewed as shipped code.

A setting that lowers severity is a way to make review quieter. If the resolver read it from the PR worktree, the PR under review could add or widen the setting in the same diff and so lower the findings raised against itself. Review would then be judged by config that the author of the change controls.

Two existing decisions bear on this. ADR-0067 makes the committed `.faffrc.yaml` the durable home for shareable behaviour, so the path list belongs there. ADR-0082 makes a malformed base config loud and exits 2 at the config chokepoints. This record settles which copy of the committed file a severity-lowering review setting is read from.

## Decision

Review config that lowers finding severity is read from the review base ref, never from the PR worktree. The resolver reads `.faffrc.yaml` as committed at the base ref (`git show <base>:.faffrc.yaml`) and ignores any edit to the file in the PR under review.

This applies to every future review setting that can lower severity, not only `review.fixture_paths`. A setting that can only raise severity or add scrutiny is not covered and may be read from the worktree. The rule is that a PR under review must not change the config that judges it.

Resolver behaviour at the base ref:

| Base ref state | Result |
|---|---|
| File missing | The built-in default list applies |
| Key missing | The built-in default list applies |
| File malformed, or the base ref cannot be read | The resolver exits non-zero; review proceeds with no cap and says so in its findings |

The failure case follows ADR-0082's loud-failure posture. It is fail-safe because the missing cap leaves findings at full severity, and it is visible because the review notes that fixture paths were unavailable.

Rejected: reading the worktree copy. It is simpler, but it lets a PR lower its own review severity.

## Consequences

- A PR that adds or changes a severity-lowering setting takes effect only for reviews after it merges. The PR that introduces `review.fixture_paths` is itself reviewed against the built-in defaults.
- Any later review setting that can lower severity must go through the same base-ref reader. A new worktree read of such a setting is a defect under this decision.
- A malformed base `.faffrc.yaml` removes the cap but does not block review. Operators see the warning and fix the file on the base branch.
- Operators cannot tune a severity-lowering setting for a single PR. Per-PR relief needs a separate, human-attributed mechanism, which this record does not provide.
- The machine-local overlay from ADR-0067 is not read for these settings. Only the committed base file at the base ref counts, so the cap is the same for every reviewer of the repo.
