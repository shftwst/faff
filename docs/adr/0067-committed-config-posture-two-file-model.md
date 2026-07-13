# ADR 0067 — Committed-config posture — two-file model

- **Status:** Proposed
- **Date:** 2026-07-13
- **Issue:** FAFF-387

## Context

`.faffrc.yaml` — the factory's own control-panel config (slots, appetite, adversarial backend, tracking paths) — has been gitignored since FAFF-67, on the reasoning that a config file is machine-local and might carry secrets. Neither premise held: on 2026-07-01 a wholesale agent rewrite silently dropped the whole `faffter_dark.adversarial` block and downgraded `slots.review`, and nothing detected it because the file carries no version history. The schema was already secret-free by construction — `api_key_env` stores an env-var *name*, and `review-call.mjs` resolves the actual key from `process.env` at read time, never persisting it to the file. A gitignored file with no secrets in it is pure downside: no backup, no diff, no recoverability, and a repeat of the 2026-07-01 failure mode is both undetectable and unrecoverable today. The tracker owner resolved the direction directly (FAFF-387 comment, 2026-07-07): the rc file describes durable behaviour and should be committed; secrets always come from env. This partially reverses FAFF-67's posture and cross-cuts every config consumer (onboarding, `gitignore-ensure`, worktree setup, the new `config check`), so the reversal earns its own durable record rather than living only in a ticket.

## Decision

Split factory config into two files with a fixed precedence, both under the same `.faffrc.yaml` schema:

- **`.faffrc.yaml`** (base) — committed, tracked by git. Carries durable, shareable behaviour: slots, appetite, tracking paths, adversarial-backend routing. Recoverable via `git checkout`; drift is visible via `git diff`.
- **`.faffrc.local.yaml`** (overlay) — gitignored, optional, machine-local. Carries per-operator values an owner may consider private (an internal hostname, a personal model preference) without those values ever needing to be secrets.

Resolution merges overlay over base (deep-merge maps per leaf, wholesale-replace sequences, overlay wins scalars) before falling back to the DEFAULTS registry; an overlay parse failure is a loud exit, never a silent partial-apply. A new deterministic `faff config check` — read-only, no tracker/network access — checks parse validity, posture (is the base actually tracked, not just present?), overlay hygiene (the overlay must NOT be tracked), and scans scalar values against a small secret-shape table, redacting any hit to key-path + length + a 4-character prefix. Migration is fail-safe by construction: faff never auto-commits, un-gitignores, or edits an existing repo's own `.gitignore` outside the append-only `gitignore-ensure` bootstrap path — an existing install is flagged and guided, and only a fresh bootstrap gets the committed-base posture by default. `config check` findings are advisory everywhere in faff itself (warn, never block); a consuming repo's own CI may choose to gate on them.

## Consequences

- A config corruption or loss on the base file is now exactly a `git checkout -- .faffrc.yaml` away from recovery, and a silent wholesale rewrite (the 2026-07-01 failure mode) shows up as an ordinary reviewable diff instead of vanishing.
- Every config-reading code path (`config get/dump/resolved`, the FAFF-208 linked-worktree fallback, `spec-docs-path`, the governance budget/sentry reader) must resolve through the merged two-file document, not just the base file — a second read path that forgets the overlay is a silent regression class this ADR puts future contributors on notice against.
- `gitignore-ensure`'s canonical set changes for new bootstraps (`.faffrc.yaml` drops out, `.faffrc.local.yaml` joins `.faffrc`/`.faffrc.yml`/`.faff/`); existing `.gitignore` files are never rewritten to remove a line, so an already-ignored `.faffrc.yaml` in an existing repo stays ignored until a human deliberately migrates it (`config check`'s posture finding names the 3 migration steps).
- This repo's own `.gitignore` is deliberately NOT flipped by the PR that ships this ADR — the operator still needs to split any machine-local values (e.g. the adversarial backend's private host) into the overlay before committing the base; auto-flipping first risks a broad `git add` sweeping a private value into history. That migration is an explicit human follow-up.
- The schema gains no new secret-bearing fields and the `*_env` indirection pattern is unchanged; the secret scan is a backstop invariant, not a new capability, and its pattern table is data (one row per detector) so extending it is a one-line change.
- Operators who prefer the old fully-gitignored posture lose nothing — the two-file model is additive and the overlay-only (no base) shape is a supported edge case — but a repo that adopts the recommended posture gains diffable config at the cost of one more file to reason about when debugging "why is this value X" (mitigated by `config resolved` naming both active files).
