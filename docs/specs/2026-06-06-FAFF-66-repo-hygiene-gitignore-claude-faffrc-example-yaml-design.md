## Spec (faff-prep · faffter-noon-spec · 2026-06-06)

# FAFF-66 — Repo hygiene: gitignore local .claude config + standardize the .faffrc example on .yaml

## WHY — Problem and scope
Two small repo-hygiene gaps. (1) `.gitignore` ignores `.faffrc*`, `design/`, `.DS_Store` but **not** `.claude/settings.local.json` or `.claude/worktrees/`, so a broad `git add` in a graft worktree can sweep local config / worktree checkouts into a PR (this happened during FAFF-64). (2) The example config is `.faffrc.example.yml`, but the schema and primary form is `.faffrc.yaml` — standardize the example on `.yaml`. Also fold in `.faff/`, which the gateway says faff ignores on first write but which the repo currently doesn't ignore.

### Out of scope
- Changing accepted runtime config filenames (`.faffrc.yaml`/`.yml`/`.faffrc` all stay valid) — only the example template is renamed.
- Reworking FAFF-6 bootstrap.

## WHAT — changes (repo root)
1. **`.gitignore` additions. Chosen:** add `.claude/settings.local.json`, `.claude/worktrees/`, and `.faff/`. Do **not** blanket-ignore `.claude/` — a shared `.claude/settings.json` may legitimately be tracked.
2. **Rename the example. Chosen:** `git mv .faffrc.example.yml .faffrc.example.yaml`, then update **every** reference (the self-review found exactly 5 sites — update all):
   - the file itself (the rename),
   - `.gitignore` line 5 comment ("…the .faffrc.example.yml template stays tracked"),
   - `README.md` (line ~179),
   - **`.github/workflows/validate.yml`** (line ~28) — **CI-load-bearing**: the workflow copies `.faffrc.example.yml` into a tmp dir and runs `faff config dump`; if this isn't updated, **CI breaks**,
   - `docs/specs/2026-06-05-FAFF-48-ci-validate-design.md` (lines ~22, ~38).
3. The renamed example stays **tracked**: the gitignore patterns (`.faffrc`, `.faffrc.yml`, `.faffrc.yaml`) are exact-basename matches and do **not** match `.faffrc.example.yaml` — no `!negation` needed. **Assumes:** confirm with `git check-ignore`.

## HOW — behaviour
Mechanical. (1) Edit `.gitignore`: add the three patterns; fix the comment. (2) `git mv .faffrc.example.yml .faffrc.example.yaml`. (3) `grep -rn "faffrc.example.yml" .` (excluding `.git`) and update each hit (the 5 sites above) to `.yaml` — grep is the catch-all so no reference is missed. (4) Verify with `git check-ignore` + a local run of validate.yml's config step.
**Risk/edge:** the only real risk is missing the `validate.yml` reference → CI break; the grep + the explicit DONE item below guard it. Over-broad `.claude/` ignore avoided (specific paths only).

## DONE — Definition of Done
- [ ] `git check-ignore .claude/settings.local.json`, `.claude/worktrees/`, and `.faff/` each exit 0 (ignored).
- [ ] A shared `.claude/settings.json` is NOT ignored (only the specific local paths were added).
- [ ] `.faffrc.example.yml` no longer exists; `.faffrc.example.yaml` exists and is tracked (`git check-ignore .faffrc.example.yaml` → exit 1).
- [ ] No repo file references `.faffrc.example.yml` any more (`grep -rn "faffrc.example.yml"` excluding `.git` → no hits); the `.gitignore` comment, README, `validate.yml`, and the FAFF-48 spec doc all name `.faffrc.example.yaml`.
- [ ] **CI still passes**: `validate.yml`'s config step copies `.faffrc.example.yaml` and `faff config dump` succeeds (the example-config validation isn't broken by the rename).
- [ ] Diff limited to `.gitignore`, the renamed file, README, `validate.yml`, and the FAFF-48 spec doc.

---
**Self-review audit trail:** clean-context reviewer verified (origin/main) the `.gitignore` contents, that `.faffrc.example.yml` is tracked / `.yaml` absent, and that `.faff/`/`.claude/worktrees/` hold nothing tracked (safe to ignore). Key finding **applied**: the rename touches **5 reference sites**, including the **CI-load-bearing `.github/workflows/validate.yml`** (copies the example to run `config dump`) and the FAFF-48 spec doc — named all explicitly + added a "CI still passes" DONE item. Confirmed the `.faffrc.yaml` ignore line does not match `.faffrc.example.yaml` (exact-basename match) so no negation is needed. Net: 0 blockers; 1 completeness finding applied.

## Methodology critique (faffter-dark-methodology-agile-delivery · issue-critique)
- **Right-sized?** Yes — sub-hour mechanical change (gitignore + one rename + 4 reference updates).
- **Workstream fit?** Repo hygiene; relates to FAFF-6 (bootstrap owns gitignore provisioning).
- **Deps surfaced?** Clean — no blocker. The validate.yml coupling is in-scope, not a dep.
- **Risk profile?** Low, with one sharp edge (CI break if validate.yml missed) — explicitly guarded by a DONE item.

confidence: high
