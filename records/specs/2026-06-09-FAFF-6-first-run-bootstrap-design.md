# FAFF-6 — First-run bootstrap skill + auto-detect "no .faffrc" trigger

> Spec: faffter-dark-nlspec · 2026-06-09 · interactive · adaptor: faffidavit-spec · confidence: high. (Punts resolved interactively 2026-06-09.)

## WHY
A new user has no on-ramp to a working config — the only path is hand-copying `.faffrc.example.yml` → `.faffrc.yaml` and editing five `tracking.*` keys by eye. FAFF-5 shipped the write half (`faff config init`), FAFF-67 shipped `gitignore-ensure`; missing is the conversational front half + a trigger so a config-less repo *offers* setup. Serves the adoptable + understandable tenets.

## WHAT
1. **`faff-onboard` sub-skill** — conversational first-run bootstrap. Auto-detects tracker MCP, `git remote` → repo slug + host, `docs/`/`doc/` presence; confirms guesses; asks only `team_key`; persists `tracking` via `faff config init`; runs `faff gitignore-ensure`. MVP: `tracking` block only.
2. **Shared "no .faffrc" trigger** — any faff entry surfaces `No .faffrc found. Set up faff for this repo now? (y/n)` with a non-nagging decline path.

- **Chosen:** name `faff-onboard` (front-door verb). **Chosen:** persist only via `faff config init --set tracking.<key>=<value>` (CLI-only-config, FAFF-50); never hand-write `.faffrc.yaml`. **Chosen:** MVP writes only allowlisted keys `tracker, team_key, repo, git_host, spec_docs_path`; `project_id` NOT in allowlist (deferred to a separate ticket).

## HOW
- **Skill:** `skills/faff-onboard/SKILL.md`, frontmatter `name: faff-onboard` + trigger-phrase description; omit `user-invocable` (visible front-door). Auto-discovered from `skills/`. Guarded "Load the gateway first" preamble (runs before config exists).
- **Detection (discovery-not-interrogation):**
  - Bail first: `faff config path` → exit 0 (config exists → report+stop, never clobber); exit 2 (legacy name → FAFF-50 loud rename error, don't bootstrap over); exit 3 (proceed).
  - **Chosen:** MCP detection lives in the skill, never the CLI → `tracking.tracker`.
  - Repo/host: parse `git remote -v` (origin); handle SSH + HTTPS, strip `.git`, map host → `git_host`. **Chosen:** unrecognised/self-hosted host surfaced as a guess to confirm.
  - `spec_docs_path`: write only when layout diverges from default (`doc/` but no `docs/`).
  - **Chosen — `team_key` MCP-tiered detection:** exactly one team → confident default (confirm); multiple → pick-list; tracker has no team concept → free-text prompt.
- **Persist:** one `faff config init --set …` (dry-run preview → one confirm → write); surgical merge preserves user content (FAFF-5); then `faff gitignore-ensure` (FAFF-67).
- **Trigger — Chosen:** single gateway-level check (new `## First run` section), not a per-skill snippet; **soft-offer** (decline proceeds on defaults); **on decline write a minimal stub `.faffrc.yaml`** via `config init` so `config path` returns exit 0 and the offer never re-fires; autonomous/beep-boop runs never offer (interactive-only). Gateway: add `/faff-onboard` to `## Routing` + a one-line `## Configuration` pointer.

**Assumes:** FAFF-5 + FAFF-67 on origin/main (Done); `TRACKING_KEYS = [tracker, team_key, repo, git_host, spec_docs_path]`; skills auto-discover (no marketplace edit).

## DONE
- [ ] `skills/faff-onboard/SKILL.md` valid frontmatter, visible in `/` menu.
- [ ] Config-less repo → any faff command surfaces exactly `No .faffrc found. Set up faff for this repo now? (y/n)`.
- [ ] On accept: ≤2 prompts, ends with a valid `tracking:` block (`faff config get tracking.team_key` exit 0).
- [ ] `team_key` detection MCP-tiered: 1→default, N→pick-list, no-team-concept→free-text.
- [ ] Detection covers tracker MCP, `git remote` (SSH+HTTPS, `.git` stripped), docs/ divergence; unrecognised host surfaced as a guess.
- [ ] On decline: proceeds on defaults, writes a stub `.faffrc.yaml`, does not re-offer.
- [ ] Re-run never clobbers (FAFF-5 idempotent/conflict-guarded); differing value refused without `--force`.
- [ ] Legacy-named config → FAFF-50 loud rename error, no bootstrap-over.
- [ ] Config written only via `faff config init` (passes `validate-adapters` CLI-only-config lint); `gitignore-ensure` run after.
- [ ] MCP detection in skill prose, not CLI; unattended runs never emit the offer.
- [ ] Gateway: `/faff-onboard` routing row + `## First run` section + `## Configuration` pointer.
