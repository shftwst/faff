# FAFF-1 — Adopt release-please for automated releases (bootstrap at 0.1.0)

*Spec produced by `faffter-noon-spec` via `/faff-prep`. Clean-context self-review: 0 findings. `confidence: high`.*

## WHY
faff has no release process: `.claude-plugin/plugin.json` carries no `version`, there is no `CHANGELOG.md`, and the repo has zero git tags. Claude Code reads a plugin's version from the `version` field in `plugin.json`; when absent it falls back to the git commit SHA, so today every commit is an implicit "update" for installed users. This change introduces release-please to derive versions, changelog, and release tags from Conventional Commits (already this repo's commit style), establishing a known 0.1.0 baseline and an automated path forward.

**Design principle — plugin.json is the single source of truth for version.** Claude reads version from `plugin.json`, and a value in `marketplace.json` is *silently overridden* by it. So the version is written to `plugin.json` only; `marketplace.json` is left untouched.

**Out of scope:**
- Publishing/distribution changes — marketplace listing stays as-is *(extension point: a later ticket if marketplace automation is wanted)*.
- Backfilling a CHANGELOG from history — release-please starts the changelog at 0.1.0 *(extension point: hand-author prior history later if desired)*.
- Inter-plugin dependency declarations — none exist *(extension point: when faff depends on another plugin)*.

## WHAT
Four new/changed files:
- `.claude-plugin/plugin.json` — add `"version": "0.1.0"`.
- `release-please-config.json` (repo root) — manifest-mode config.
- `.release-please-manifest.json` (repo root) — release-please's version source of truth.
- `.github/workflows/release-please.yml` — the repo's first GitHub Actions workflow.

**Key decision — releaser type.** No `package.json` exists, so the `node` releaser doesn't apply. **Chosen:** base `release-type: simple` with an `extra-files` JSON updater writing the version into `.claude-plugin/plugin.json` at `$.version`. No `version.txt` is added to the repo; plugin.json is the in-repo version file and the manifest is release-please's own record.

**Key decision — tag format.** Claude plugin tooling expects `{plugin-name}--v{version}` (double hyphen), e.g. `faff--v0.1.0` (via `claude plugin tag --push`; required for plugin dependency resolution, recommended for single plugins). **Chosen:** `component: "faff"`, `include-component-in-tag: true`, `tag-separator: "--"`, yielding `faff` + `--` + `v0.1.0` = `faff--v0.1.0`. The target tag string `faff--v0.1.0` is the contract; the separator key is the means and is verified at build time against the action version actually used.

**Key decision — bootstrap to exactly 0.1.0.** **Chosen:** seed `.release-please-manifest.json` to `{ ".": "0.0.0" }` and set a one-time `"release-as": "0.1.0"` on the package so the first release PR cuts exactly 0.1.0 (rather than an auto-derived bump), then remove `release-as` after the first release merges. plugin.json is seeded to `0.1.0` to match.

**Key decision — Action token.** **Chosen:** default `GITHUB_TOKEN` with job `permissions: contents: write, pull-requests: write`. No PAT — a PAT is only needed to trigger downstream workflows from the release PR, and none exist.

**Assumes:** the repo's default branch is `main` (the workflow triggers on push to `main`). *(Verified: default branch is `main`.)*
**Assumes:** Conventional Commits are used. *(Verified: recent history is `feat(faff):`, `fix(faff):`, `docs(faff):`, `refactor(faff):`.)*

## HOW
- `release-please-config.json` defines one package at path `.` with the four decisions above and a `$schema` pointer.
- `.github/workflows/release-please.yml`: trigger `on: push: branches: [main]`; one job using `googleapis/release-please-action@v4` (manifest mode reads `release-please-config.json` + `.release-please-manifest.json` by default); job-level `permissions` for contents + PRs; `GITHUB_TOKEN` passed.
- Flow once merged to `main`: release-please opens/maintains a release PR; merging it bumps plugin.json via extra-files, writes `CHANGELOG.md`, and creates tag `faff--v0.1.0`. The first PR is forced to 0.1.0 by `release-as`.
- Edge cases: changelog section filtering (which commit types show) is left at release-please defaults (feat/fix surfaced) — not configured. Build verifies the proposed tag string is exactly `faff--v0.1.0` before relying on it.

## DONE
- [ ] `.claude-plugin/plugin.json` contains `"version": "0.1.0"` and remains valid JSON; `marketplace.json` is unchanged (no version field added).
- [ ] `release-please-config.json` exists with `release-type: simple`, `component: faff`, `include-component-in-tag: true`, `tag-separator: "--"`, and an `extra-files` json updater on `.claude-plugin/plugin.json` `$.version`.
- [ ] `.release-please-manifest.json` exists, seeded `{ ".": "0.0.0" }`. The one-time `release-as: 0.1.0` lives in `release-please-config.json` (the `.` package block), **not** the manifest — and must be removed after the first 0.1.0 release ships, or every subsequent release re-cuts 0.1.0.
- [ ] `.github/workflows/release-please.yml` exists, triggers on push to `main`, uses `release-please-action@v4`, declares `contents: write` + `pull-requests: write`.
- [ ] A dry run / inspection confirms the release PR would create the tag exactly `faff--v0.1.0` (not `faff-v0.1.0`, not `v0.1.0`).
- [ ] No `version.txt` or `package.json` is introduced.

confidence: high
