# Spec — FAFF-174: release-please isn't cutting releases for skills-prose changes

> Spec: faffter-dark-nlspec · 2026-06-17 · interactive · confidence: high.
> Revised 2026-06-17 — release-gate logic lives in a repo-internal `scripts/release-gate.mjs`, NOT the shipped `faff` CLI. The bundled CLI ships to adopters; repo-only tooling must not live in it.

## 1. Preamble

- **Artifact:** a buildable spec for FAFF-174 — make faff's own `release-please` reliably cut releases when skills-prose changes.
- **Audience:** the build agent (adds a CI workflow + a repo-internal script + backfills the changelog in THIS repo) and the human reviewer (wires the branch-protection required check + supervises the catch-up release).
- **Shape of the fix:** a required PR-title CI gate (zero-dependency, repo-internal `scripts/` script) + a one-time CHANGELOG backfill + catch-up release. **No `plugin/skills/**` prose edits, and no change to the shipped `faff` CLI.**

## 2. WHY

**Status quo → pain → change**
- Repo is **squash-only** with `squash_merge_commit_title = COMMIT_OR_PR_TITLE`, so a multi-commit PR's squash *subject* is the **PR title**; individual commits land only in the squash *body*.
- `release-please` (`release-type: simple`) bumps **only** on a `feat:`/`fix:` *subject* and ignores the body. A PR titled `FAFF-164: …` (no type) → squash subject has no releasing type → release-please cuts **nothing**.
- Skills prose (`plugin/skills/**/SKILL.md`) **is the user-facing product**. Five post-0.4.0 features (FAFF-129/169/170/114/164) all merged with non-releasing subjects → all unreleased, absent from the changelog, `plugin.json` stuck at `0.4.0` (no adopter update signal). FAFF-164 (canonical-skill-naming delegation convention) is a "very important change" the human wants visible.

**Design principles (non-obvious constraints only)**
- **Governing tenet — configurable-not-opinionated.** The fix must NOT encode faff's conventional-commit preference into shipped prose (faff runs on *other people's* repos). The mechanism lives **only in this repo's CI/release infra**.
- **Shipped surface stays user-facing.** The product that ships to adopters is *two* surfaces — the skills prose **and** the bundled `faff` CLI (`plugin/skills/faff/bin/faff`). The CLI must contain only commands a user would call, or that faff needs to function on *their* project. A repo-only release gate is **not** such a command → it lives **outside `plugin/`** in repo-root `scripts/` (alongside `scripts/link-skills.sh`), never as a `faff` subcommand.
- **No false misses.** Bias toward over-releasing. A missed release is the failure to eliminate; an over-release (a patch for a typo) is acceptable. The gate **fails closed** — ambiguous path-detection ⇒ treat as user-facing.
- **Zero-dependency ethos.** The script is zero-dep node, consistent with the repo's no-deps stance.

**Reference context (verified in-repo)**

| Fact | Locus |
|---|---|
| `release-type: simple`, component `faff`, tag `faff--vX.Y.Z`, extra-files bumps plugin.json `$.version` | `release-please-config.json` |
| manifest `{".":"0.4.0"}` | `.release-please-manifest.json` |
| release-please on push-to-main | `release-please.yml` |
| CI gate (validate-adapters + 8 selftests + `node --test`) | `validate.yml` |
| `pull_request` trigger is **bare** → omits `edited` | `validate.yml` |
| product version `0.4.0` | `plugin/.claude-plugin/plugin.json` |
| changelog (release-please-maintained), last header `0.4.0` | `CHANGELOG.md` |
| repo-internal tooling already lives at repo root | `scripts/link-skills.sh`, `eval/`, `test/` |

**Scope (one line):** guarantee that any PR touching `plugin/skills/**` or `plugin/.claude-plugin/**` carries a releasing (`feat:`/`fix:`) PR title via a required CI check (a repo-internal script), and one-time backfill the five missing changelog entries + cut the catch-up release.

## 3. OUT OF SCOPE

- **`plugin/skills/**` / faff-graft / faff-ship prose change** — why: breaches *configurable-not-opinionated*; extension point: none — hard exclusion.
- **Any new command in the shipped `faff` CLI** (`plugin/skills/faff/bin/faff`) — why: the CLI ships to adopters and must hold only user-facing commands; extension point: repo-root `scripts/`.
- **faff product's lights-out release-scheduling (FAFF-39 / methodology slot)** — why: that's the product's behaviour on adopter repos; extension point: FAFF-39.
- **Reworking release-please off `release-type: simple`** — why: the defect is subject-type discipline, not release-please config; extension point: a future ticket.
- **Auto-release fallback workflow** — why: the title-gate is deterministic and sufficient; extension point: build only if the gate proves insufficient.

## 4. WHAT

**Vocabulary**
- **User-facing paths** = `plugin/skills/**` ∪ `plugin/.claude-plugin/**`.
- **Releasing title** = PR title whose subject is conventional-commit form with type `feat` or `fix` (scoped/bang ok). `docs:`/`chore:`/`refactor:`/bare `FAFF-164:` are **non-releasing**.

**Artifact A — PR-title release-gate CI check**
- New workflow `.github/workflows/release-gate.yml` on `pull_request` with **`types: [opened, edited, synchronize, reopened]`**.
- Logic: detect whether changed files intersect user-facing paths; if so, assert the PR title is a releasing title; fail otherwise with a remediation message.
- Implementation: a **repo-internal zero-dep script `scripts/release-gate.mjs`** does the title-type assertion (pure string logic + a `--selftest` fixtures table); path-detection done in the workflow via `git diff --name-only` against the base SHA.
- **Chosen:** new `release-gate.yml` + `scripts/release-gate.mjs` — repo-internal (NOT a `faff` CLI subcommand, since the CLI ships to users; NOT folded into validate.yml, which lacks `edited` and would re-run 8 selftests per title edit). Zero-dep, unit-tested under `node --test`. *(Rejected: `faff release-gate` subcommand — bloats the shipped CLI; rejected: `action-semantic-pull-request` — third-party.)*

**Artifact B — branch-protection required check**
- The `release-gate` job added to `main`'s required status checks. **Punt:** human must wire this in GitHub settings (not in-repo). **Assumes:** branch protection forces PR-only merges to `main`.

**Artifact C — CHANGELOG backfill + catch-up release**
- One-time prepend of the five unreleased entries (FAFF-129/169/170/114/164) under a new `0.5.0` header in `CHANGELOG.md`, plus the manifest/version bump. **Chosen:** bump to **0.5.0** (minor — FAFF-164/169/170/114 are features). Co-existence mechanics in §5.

**Title-policy assertion**
- `releasing-title` ≔ subject matches `^(feat|fix)(\(scope\))?!?: .+` (lowercase type). Everything else (incl. bare `FAFF-XXX:`) is non-releasing.

## 5. HOW

**CI check** — `release-gate.yml`: checkout (full depth) → setup-node 20 → "detect user-facing changes" step diffs `base.sha…head.sha` with `git diff --name-only`, greps anchored `^plugin/(skills|\.claude-plugin)/`, sets `user_facing` output → "assert releasing title" step (only if `user_facing == true`) runs `node scripts/release-gate.mjs --title "$PR_TITLE"`.
- `node scripts/release-gate.mjs --title <t>`: exit `0` if releasing, exit `1` with a stderr remediation. `--selftest` runs a fixtures table (releasing: `feat: x`, `fix(FAFF-1): y`, `feat!: z`; non-releasing: `docs: x`, `chore: y`, bare `FAFF-164:`, empty).
- **Fail-closed:** if the base/head diff can't be computed, treat `user_facing=true`. Add `test/release-gate.test.mjs` (`node --test` already globs `test/`) covering the fixtures + parse edge cases.
- **The shipped `faff` CLI is NOT touched** — no new subcommand, no `main(argv)` dispatch change.

**Branch-protection** — after merge the human adds `release-gate` to `main`'s required checks; without it the check advises but doesn't block. Human step (§9).

**Changelog backfill** — release-please **prepends** to `CHANGELOG.md` and reconciles to the *manifest version*. Procedure:
1. Prepend a hand-written `## [0.5.0](…compare/faff--v0.4.0...faff--v0.5.0) (<date>)` section with a `### Features` list: FAFF-164 (lead), FAFF-114, FAFF-169, FAFF-170, FAFF-129 — each linking PR (#110/#109/#107/#108/#106) + commit, matching existing format. Place under the `# Changelog` H1, above `0.4.0`.
2. Set `.release-please-manifest.json` → `{".":"0.5.0"}`.
3. Set `plugin/.claude-plugin/plugin.json` version → `0.5.0`.
4. The FAFF-174 PR carries a `feat:` title → on push-to-main release-please reconciles to manifest `0.5.0`, tags `faff--v0.5.0`. **Punt:** confirm release-please-action@v4 won't emit a *duplicate* `0.5.0` header; if it would, fall back to letting release-please own the bump (manual changelog prose only, manifest left at `0.4.0`). Bias: manual manifest bump + verify no dup header.

**Edge cases**
- **Single-commit PR:** squash subject = the commit message, not the PR title (`COMMIT_OR_PR_TITLE`). **Chosen:** flip repo `squash_merge_commit_title` → `PR_TITLE` (one-time human step) so the PR title always wins — closes the only real false-miss hole.
- **Direct push to `main`:** the PR gate can't see it. Mitigation: branch protection forces PR-only (Assumes).
- **Non-skills PR:** `user_facing=false` → no-op pass.
- **Cosmetic prose tweak:** under no-false-misses, a `fix:` (patch) is the correct floor — accepted over-release.

**Anti-patterns:** don't add the convention to any `SKILL.md`; don't add a subcommand to the shipped `faff` CLI; don't parse the squash *body* for a type; don't pass silently on path-detection error (fail closed); don't hand-tag a release outside release-please.

## 6. SCENARIOS

- Given a PR changes `plugin/skills/faff-tidy/SKILL.md`, When title is `docs(FAFF-200): tweak`, Then `release-gate` fails + merge blocked.
- Given the same change, When title is `fix(FAFF-200): correct tidy gate`, Then gate passes; after squash-merge release-please cuts a patch release + bumps plugin.json.
- Given a PR changes only `plugin/.claude-plugin/plugin.json`, When title is bare `FAFF-201: bump`, Then gate fails (manifest path is user-facing).
- Given a PR changes only `test/foo.test.mjs`, When title is `chore: tidy tests`, Then `user_facing=false`, gate passes.
- Assertion: base/head diff uncomputable → gate treats changes as user-facing (fail-closed).
- Assertion: `node scripts/release-gate.mjs --selftest` passes all releasing/non-releasing fixtures.
- Given the backfill merged, When a reader opens `CHANGELOG.md`, Then the `0.5.0` section lists **FAFF-164** (+ FAFF-114/169/170/129).
- Assertion: after the catch-up release, `plugin.json` version reads `0.5.0`.
- Assertion: the diff contains **zero** `plugin/skills/**` edits and **no** change to `plugin/skills/faff/bin/faff`.

## 7. DESIGN DECISION RATIONALE

- **Where the gate logic lives** — (a) repo-internal `scripts/release-gate.mjs` + `release-gate.yml`; (b) a `faff` CLI subcommand; (c) fold into validate.yml; (d) third-party action. **Chosen: (a)** — repo-only tooling stays out of the shipped CLI, own trigger types incl. `edited`, zero-dep, unit-tested. (b) rejected (bloats shipped CLI); (c) rejected (forces `edited` + re-runs selftests per title edit); (d) rejected (third-party).
- **Auto-release fallback** — gate alone vs gate + push-to-main force-release. **Chosen: gate alone** (deterministic, low-magic).
- **Single-commit squash-subject hole** — **Chosen: flip `squash_merge_commit_title=PR_TITLE`**.
- **Version bump** — **Chosen: 0.5.0** (features).
- **Changelog co-existence** — **Punt** (build validates).
- **Branch-protection required check** — **Punt** (human-only GitHub setting).

## 8. OPEN QUESTIONS & ASSUMPTIONS

- **Punt — changelog/manifest co-existence:** does manual `0.5.0` manifest + manual `0.5.0` CHANGELOG section make release-please emit a duplicate header? Validate at build; fall back to "release-please owns the bump."
- **Punt — branch-protection required check:** human wires it in GitHub settings.
- **Punt — direct-push handling:** depends on whether branch protection forbids direct pushes.
- **Assumes — branch protection forces PR-only merges to `main`.** Validate: `gh api repos/shftwst/faff/branches/main/protection`.
- **Assumes — squash settings as grounded** (`COMMIT_OR_PR_TITLE`, squash-only). Validate: `gh api repos/shftwst/faff` squash flags.
- **Assumes — `node --test` globs `test/`** so `test/release-gate.test.mjs` runs in the existing CI gate. Validate: confirm the test is picked up.

## 9. DONE

- [ ] `.github/workflows/release-gate.yml` exists, triggers on `pull_request` `types: [opened, edited, synchronize, reopened]`.
- [ ] `scripts/release-gate.mjs` exists (repo-internal, zero-dep); `--title <t>` exits 1 for `docs:`/`chore:`/bare `FAFF-X:`/empty; exits 0 for `feat:`/`fix:`/`feat(...):`/`feat!:`.
- [ ] `node scripts/release-gate.mjs --selftest` passes; `test/release-gate.test.mjs` covers the fixtures under `node --test`.
- [ ] Workflow fails a user-facing change under a non-releasing title; passes under a releasing title; no-op passes for non-user-facing diffs; fails closed on diff error.
- [ ] `release-gate` added to `main`'s required status checks (human step).
- [ ] Repo `squash_merge_commit_title` flipped to `PR_TITLE` (human step).
- [ ] `CHANGELOG.md` backfilled with a `0.5.0` section listing **FAFF-164** + FAFF-114/169/170/129.
- [ ] `.release-please-manifest.json` = `{".":"0.5.0"}` and `plugin.json` version = `0.5.0` (or the release-please-owned equivalent per the Punt); catch-up release cut on next push-to-main without a duplicate `0.5.0` header.
- [ ] **NO `plugin/skills/**` edits** in the diff, and **the shipped `faff` CLI is unchanged** (no new subcommand).
- **Integration smoke test:** open a throwaway PR editing a `SKILL.md` with title `docs: x` → `release-gate` red; rename title to `fix: x` → `release-gate` green.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "assumes" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "chosen" } ] }
```
