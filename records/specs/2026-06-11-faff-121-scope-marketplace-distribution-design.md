# Scope the marketplace plugin to skills-only — move the dev script to root, relocate the plugin into a clean ./plugin subtree

> Spec: faffter-dark-nlspec · 2026-06-11 · interactive · confidence: high. Full spec on Linear FAFF-121.

*Marketplace mechanism resolved against authoritative Claude Code plugin docs: no native exclusion exists; pointing the plugin `source` at a subdirectory scopes what a consumer's `/plugin install` copies. Chosen mechanism: a clean `./plugin/` subtree.*

Build spec for FAFF-121. Two parts: (1) move the dev link-script out of the skills tree; (2) relocate the plugin into a clean `./plugin/` subtree so a marketplace install pulls only the skills + manifest.

## 1. WHY

Installing the faff plugin (`/plugin marketplace add shftwst/faff` → `/plugin install faff@faff`) gives the consumer the whole repo as the plugin, because `.claude-plugin/marketplace.json` sets the plugin `source` to `"./"` (repo root = plugin root). The active plugin then carries repo-internal scaffolding — `docs/`, `test/`, `.github/` CI, `release-please` config, `CHANGELOG.md`. Separately, `skills/scripts/link-skills.sh` is dev-only and sits inside the skills tree.

**Authoritative mechanism:** `/plugin install` copies only the plugin `source` subtree into the consumer's plugin cache; that subtree is `${CLAUDE_PLUGIN_ROOT}`. There is no `.claudeignore`/exclude field. `source` resolves relative to the marketplace root (the dir holding `.claude-plugin/`). The plugin manifest must live inside the source subtree; skills resolve at `<plugin-root>/skills/<skill>/SKILL.md`. So scoping the plugin to skills-only requires `source` to be a clean subdir holding only the manifest + `skills/`.

**Principles:** keep `${CLAUDE_PLUGIN_ROOT}/skills/…` resolution intact (holds — new root `plugin/` has a `skills/` child); move authorship not behaviour (no skill content changes); `marketplace.json` stays at the repo root (the `marketplace add` target).

## 2. OUT OF SCOPE

- Changing skill content or CLI logic — path-only relocation.
- `design/` / `.faff/` — already `.gitignore`d.
- The marketplace catalog clone holding the full repo — that's the index, not the active plugin.
- Historical path refs in CHANGELOG / old specs.

## 3. WHAT

**Decision — Part 1: move `link-skills.sh`.** **Chosen:** `skills/scripts/link-skills.sh` → `scripts/link-skills.sh` (repo root), rewrite its path anchors to `REPO_ROOT=$SCRIPT_DIR/..`, `SKILLS_ROOT=$REPO_ROOT/plugin/skills`.

**Decision — Part 2: scope the distribution.** **Chosen:** Option A — clean `./plugin/` subtree containing `.claude-plugin/plugin.json` (moved) + `skills/` (all dirs moved); `marketplace.json` `source: "./plugin"`. Rejected: native exclusion (doesn't exist), accept-the-footprint (misses the goal), literal `source: "./skills"` (breaks discovery + CLI path).

**Decision — manifest placement.** **Chosen:** `marketplace.json` stays at `<repo>/.claude-plugin/`; `plugin.json` moves to `<repo>/plugin/.claude-plugin/plugin.json`.

## 4. HOW

```
Part 2:
  git mv .claude-plugin/plugin.json plugin/.claude-plugin/plugin.json
  git mv skills plugin/skills
  marketplace.json: "source": "./" → "./plugin"
  repoint repo-root-relative skills/ literals in live tooling:
    .github/workflows/validate.yml (skills/faff/bin/faff → plugin/skills/faff/bin/faff)
    test harness CLI path (test/helpers/run-cli.mjs etc.)
    README CLI-location reference
  (${CLAUDE_PLUGIN_ROOT}/skills/… in-skill refs DO NOT change — plugin-root-relative)
Part 1:
  git mv plugin/skills/scripts/link-skills.sh scripts/link-skills.sh
  rewrite anchors: SKILLS_ROOT=$REPO_ROOT/plugin/skills
  README usage lines → scripts/link-skills.sh
```

**Anti-patterns:** editing `${CLAUDE_PLUGIN_ROOT}/skills/…` in-skill refs (stay correct); moving `marketplace.json` under `plugin/`.

## 5. RATIONALE

Option A is the only mechanism that scopes the install (B doesn't exist, C misses the goal). The manifest moves inside the subtree because that's the installed plugin root; the marketplace file stays at the repo root because `source` resolves relative to it. Big diff but pure `git mv` + ~12 path repoints, CI-guarded.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**
- `git mv` preserves the executable bit on `link-skills.sh` — verify `ls -l`.
- No tracked tooling resolves a skill path the sweep misses — CI is the backstop.

## 7. DONE

- [ ] `scripts/link-skills.sh` exists, anchors rewritten; `--dry-run --global` lists the same 24 skills; README references `scripts/link-skills.sh`.
- [ ] `plugin/.claude-plugin/plugin.json` + `plugin/skills/<dirs>/` exist; old `skills/` + root `plugin.json` gone; `marketplace.json` `source: "./plugin"` at repo root.
- [ ] `validate.yml` + test harness + README repointed to `plugin/skills/faff/bin/faff`; no repo-root-relative `skills/` literal in live tooling (CHANGELOG/historical exempt).
- [ ] `node plugin/skills/faff/bin/faff validate-adapters` + `node --test` pass; CI green.
- [ ] Plugin-root resolution re-verified (`../faff/SKILL.md` sibling, `${CLAUDE_PLUGIN_ROOT}/skills/faff/bin/faff`).

confidence: high
