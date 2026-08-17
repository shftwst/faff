# Clean-machine install verification (FAFF-586)

**Date:** 2026-08-16
**Ticket:** FAFF-586, verify the documented install on a clean machine
**Provenance:** external adversarial critique 2026-07-21, appendix row 15
(`docs/audits/2026-07-21-external-adversarial-critique.md`)
**Feeds:** FAFF-824, accept the Phase 0B outward-evidence baseline

## Why

The README documents one install path (marketplace) but spelled every command
bare (`/faff-onboard`, `/faff-wtf`, …). The eval doc states plugin-loaded skills
are namespaced (`/faff:faff-tidy`, `eval/README.md`). Nobody had run the two
README install lines on a machine with no prior faff and recorded what actually
works. A development box cannot answer this: `link-skills.sh` symlinks the skills
into `~/.claude/skills` (bare names) at the same time as the plugin is installed
(namespaced names), so both spellings resolve there.

## Method

A clean container, reproducible from the sibling `Dockerfile`
(`2026-08-16-FAFF-586-clean-machine-install/Dockerfile`). No faff pre-seeded: no
`~/.claude/skills`, no symlinks, no CLI on PATH. The two documented README lines
were run through their non-interactive CLI equivalents:

- `/plugin marketplace add shftwst/faff` → `claude plugin marketplace add shftwst/faff`
- `/plugin install faff@faff` → `claude plugin install faff@faff`

The command spellings were then read back from the container's own Claude Code
session, which is grounded in the skills actually registered.

## Environment stamp

| Field | Value |
|---|---|
| Base image | `ubuntu:24.04` (24.04.4 LTS) |
| Local image digest | `sha256:fdd44b161cb3041f5c83fed1c6592ed22a80a35d7e63a137007fec58f8b73791` |
| Node | v20.20.2 |
| git | 2.43.0 |
| Claude Code | 2.1.197 |
| Marketplace source | `shftwst/faff` @ `e3f0f42` (2026-08-16) |
| Plugin installed | `faff@faff` 0.17.0, 30 skills |

## What happened

Baseline, before any install:

```
faff: NOT on PATH
~/.claude/skills:  does not exist
~/.claude/plugins: does not exist
```

The two documented lines, verbatim output:

```
$ claude plugin marketplace add shftwst/faff
✔ Successfully added marketplace: faff (declared in user settings)   (exit 0)

$ claude plugin install faff@faff
✔ Successfully installed plugin: faff@faff (scope: user)             (exit 0)
```

No authentication, and no `ANTHROPIC_API_KEY`, was needed for either line. The
install requires network access and git (the marketplace add clones
`https://github.com/shftwst/faff.git`).

Command spellings, read from the container's Claude session after install:

```
/faff:faff          /faff:faff-jot     /faff:faff-prep
/faff:faff-onboard  /faff:faff-map     /faff:faff-graft
/faff:faff-wtf      /faff:faff-plot    /faff:faff-tidy
/faff:faff-beep-boop
```

## Finding

Every command on the documented install path is namespaced `/faff:faff-…`. The
bare `/faff-onboard` form the README documented does not exist on that path: the
plugin ships only `skills/` (no `commands/` directory), and nothing writes into
`~/.claude/skills`, so no bare command is registered. The bare form is a property
of the contributor install (`link-skills.sh`) alone. This confirms the ticket's
suspicion: the README's quickstart commands were written in a spelling the only
documented install path does not produce.

## README defects and disposition

| Ticket claim | Finding | Fix |
|---|---|---|
| Bare spellings contradict the namespaced form | Confirmed. Six quickstart commands were bare | Rewritten to `/faff:faff-…` |
| Node ≥20 stated nowhere user-facing | Already addressed before this run: README states "Node 20 or later" plus macOS/Linux/WSL2 | No change needed |
| git prerequisite unstated | Confirmed. Install clones over git; README did not mention it | Added to the prerequisites |
| Dev-install path undocumented | Confirmed. `link-skills.sh` was absent from README | Added a contributor-install note pointing to `CONTRIBUTING.md` |

## Bounds

- One install, one host image, one marketplace commit (`e3f0f42`). The result is
  a property of Claude Code's plugin namespacing, not of the commit, so it is
  expected to hold across versions, but only this point was measured.
- The command spellings were read from a live Claude Code session; reproducing
  that step needs a Claude Code credential staged into the container. The install
  itself (both README lines) needs no credential.
- FAFF-165 (drop the `faff-` prefix) would have changed the spelling to
  `/faff:onboard`. It is cancelled, so `/faff:faff-onboard` is the standing
  answer and the README documents it as such.
