# Harness support

SuperDomestique's primary supported harness is Claude Code. Codex has driven a
complete interactive prep-to-merge run, but that run still needed manual
handoffs and exposed gaps in installation, containment, review, and run
attribution. Selected read-only producer calls through Codex are experimental.
Codex is not currently a supported unattended L3 or L4 path.

pi.dev is planned as a future harness target. It is not supported, and no
implementation or verification work is currently scheduled.

This status was checked on 2026-08-09. The `faff` plugin, CLI, and configuration
names are unchanged whichever harness starts the work.

## What the labels mean

- **Supported** means there is a documented, repeatable path with no known
  missing essential integration for the stated level.
- **Demonstrated with limitations** means a recorded successful path exists,
  but important setup, lifecycle, safety, or automation gaps remain.
- **Experimental** means a narrow implementation or observation exists. It is
  not an end-user support promise.
- **Planned** means the path has not shipped.
- **Not supported** means there is no current path to rely on.

A portable `SKILL.md`, a working CLI transport, and a supported delivery loop
are different claims. SuperDomestique treats them separately.

## Capability matrix

The short answer is to use Claude Code for the documented product today. Use
Codex only when the limitations below fit the job and you are prepared to
drive the handoffs yourself.

| Capability | Claude Code | Codex | pi.dev |
|---|---|---|---|
| Setup | [Supported](walkthroughs.md) | [Demonstrated with limitations](https://github.com/shftwst/faff/pull/507) | Not supported; no work scheduled |
| Skill discovery | [Supported](skills.md) | [Demonstrated with limitations](https://github.com/shftwst/faff/pull/501) | Not supported; no work scheduled |
| Tracker access | [Supported](configuration.md) | [Demonstrated with limitations](https://github.com/shftwst/faff/pull/516) | Not supported; no work scheduled |
| Interactive prep | [Supported](walkthroughs.md) | [Demonstrated with limitations](https://github.com/shftwst/faff/pull/510) | Not supported; no work scheduled |
| Interactive build and merge | [Supported](walkthroughs.md) | [Demonstrated with limitations](https://github.com/shftwst/faff/pull/510) | Not supported; no work scheduled |
| Producer dispatch | [Supported](https://github.com/shftwst/faff/blob/main/plugin/skills/faff/SKILL.md) | [Experimental, read-only](https://github.com/shftwst/faff/blob/main/plugin/skills/faff/bin/lib/engine-codex.js) | Not supported; no work scheduled |
| Independent review | [Supported](https://github.com/shftwst/faff/blob/main/plugin/skills/faffter-dark-adversarial-review/SKILL.md) | [Demonstrated with limitations](https://github.com/shftwst/faff/pull/510) | Not supported; no work scheduled |
| Parallel review fan-out | [Supported](https://github.com/shftwst/faff/blob/main/plugin/skills/faffter-dark-spec-review/SKILL.md) | [Experimental](https://github.com/shftwst/faff/pull/579) | Not supported; no work scheduled |
| L3 unattended entry | [Supported](unattended.md) | [Planned](https://github.com/shftwst/faff/blob/main/docs/architecture/harness-coupling.md#headless-session-entry) | Not supported; no work scheduled |
| L4 isolation and holdout | [Supported as preview](/concept/levels) | [Not supported](https://github.com/shftwst/faff/blob/main/docs/architecture/harness-coupling.md#headless-session-entry) | Not supported; no work scheduled |
| Usage telemetry | [Supported](https://github.com/shftwst/faff/blob/main/plugin/skills/faff/bin/lib/budget.js) | [Experimental](https://github.com/shftwst/faff/blob/main/docs/architecture/codex-cli-observed.md#token-usage) | Not supported; no work scheduled |
| Live event stream | [Supported](self-hosted-rig.md#watching-a-run-live) | [Experimental CLI stream](https://github.com/shftwst/faff/blob/main/docs/architecture/codex-cli-observed.md#event-stream) | Not supported; no work scheduled |

L4 is preview-labelled on every harness. The mechanisms exist, but the public
repository does not yet have enough external evidence for an unqualified
L4-complete claim. The [levels page](/concept/levels) describes the current
boundary.

## What differs under Codex

### Installation and discovery

Codex can discover globally linked skills, and the installer and doctor now
understand the shared agent skill locations. Repo-local and marketplace plugin
installs remain unavailable to Codex. The standard marketplace installation in
the README is therefore not a complete Codex setup path.

Tracker discovery has been corrected, but the tracker connector is still
registered by the harness. A connector available in Claude Code is not
automatically available in Codex.

### Session lifecycle

The recorded Codex run reached prep, implementation, pull request, and merge.
It did not prove unattended operation. The operator had to initiate each
handoff, and that lifecycle gap remains open.

`faff engine call` can spawn `codex exec` for selected producer lanes. That
child is deliberately read-only, ephemeral, and outside the working repository.
It cannot act as the write-capable build lane or the whole-session unattended
entry point. Build and evaluation routing remain planned work.

### Safety and evidence

The demonstrated run was uncaged, and work escaped its intended worktree. A
checked environment floor and non-Claude operator guidance have not shipped.

Codex events expose useful usage and tool information, but current run records
do not consistently identify the harness and model. That attribution gap
remains open.

### Review and fan-out

Concurrent non-Claude review-lens dispatch shipped in
[PR #579](https://github.com/shftwst/faff/pull/579). This improves the review
path, but it does not establish full fan-out or isolation parity. Whether
subagents actually ran remained opaque in the recorded workflow, and provider
policy blocked some adversarial work.

## Evidence

- The [Codex CLI observation](https://github.com/shftwst/faff/blob/main/docs/architecture/codex-cli-observed.md)
  records flags, event shapes, auth, state, and skill discovery observed with
  Codex CLI 0.145.0 on 2026-07-28.
- [PR #510](https://github.com/shftwst/faff/pull/510) is the durable repository
  outcome from the interactive Codex run. Its description and committed report
  record both the successful delivery path and the failed L4 audit result.
- The [Codex engine implementation](https://github.com/shftwst/faff/blob/main/plugin/skills/faff/bin/lib/engine-codex.js)
  defines the experimental read-only producer boundary.
- The [harness coupling inventory](https://github.com/shftwst/faff/blob/main/docs/architecture/harness-coupling.md)
  classifies the architectural seams. It is a design inventory, not a support
  promise.

## When this status can change

A completed ticket is not enough by itself. A support label moves only when the
path is documented, repeatable, and backed by a committed observation, run
result, enforcing mechanism, or merged implementation.

Codex L3 support needs a whole-session entry and run-lifecycle contract, plus a
documented environment that meets the level's floor. Codex L4 support also
needs the external B10 portability run and evidence that isolation, holdout,
attribution, and review still work together. Until then, a successful
interactive session does not imply unattended support. The
[harness coupling inventory](https://github.com/shftwst/faff/blob/main/docs/architecture/harness-coupling.md)
records the current implementation owners.
