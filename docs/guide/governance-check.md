# governance-check: the harness-independent enforcement binding

Every faff governance check (ledger completeness, budget, merge-floor conditions) ships
as a CLI verb — but a verb only holds if something *invokes* it. Run entirely inside the
Claude Code harness, an agent that never calls `runcheck`/`budget check`/`merge-gate` is
simply ungoverned. `faff governance-check` — wired as a GitHub Actions **required status
check** — moves the enforcement to a chokepoint the emitter does not control: the backend
emits the artifact format, and git refuses an unearned merge regardless of which harness
(or none) produced the PR.

**Read this if you're wiring the check into your own repo.** If you're looking for the
verb's flags, see the [`governance-check` row in the CLI reference](cli.md).

## Two warnings, stated plainly

- **Emitting the format ≠ being governed — until the check is *required*.** Adding the
  workflow only makes the check *runnable*. A PR still merges around a failing (or
  entirely unconfigured) check unless you mark it required in branch protection (below).
  Every run's job summary states plainly whether artifacts were carried at all — a repo
  that never marks the check required has adopted the format without the binding.
- **This check validates conformance, never authenticity.** The run artifacts are
  authored by the same emitter the check is judging — a hostile or careless agent can
  commit a *forged* clean ledger and fabricated `pass` verdicts, and the check reads
  that indistinguishably from the real thing. What it *does* catch: a cooperating-but-
  fallible emitter's incomplete runs, budget breaches, and tampered/missing floor
  artifacts — plus a visible, greppable audit trail for anyone looking. Artifact
  authenticity (signed artifacts, attestation) is a separate trust layer, out of scope
  for this binding.

## 1. Wire the workflow

Add a workflow that runs the composite Action on `pull_request` (faff's own
[`.github/workflows/governance.yml`](https://github.com/shftwst/faff/blob/main/.github/workflows/governance.yml) is the
reference — dogfooded on this repo's own PRs):

```yaml
name: governance-check

on:
  pull_request:

jobs:
  governance-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # the Action diffs base...head to discover carried run dirs

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: shftwst/faff/.github/actions/governance-check@<pinned-sha>
        with:
          on-missing: pass   # adoption mode — see §3
```

Consuming faff as a dependency (not faff's own repo)? Use the subpath `uses:` form above,
pinned to a **commit sha** (§4). Faff's own dogfood workflow uses the local form
(`uses: ./.github/actions/governance-check`) since the Action lives in the same repo.

## 2. Mark the check required

The Action never mutates branch protection — same assert-don't-enforce posture as
`faff branch-protection-check`. Marking `governance-check` required is a one-click human
action (or the `gh api` equivalent):

```console
$ gh api -X PUT repos/<owner>/<repo>/branches/<branch>/protection/required_status_checks \
    -f strict=true \
    -f 'contexts[]=governance-check'
```

Confirm it landed with `faff branch-protection-check --branch <branch>` — it prints the
branch's `required_checks` list, which should now include `governance-check`.

## 3. Pick your artifact-passing convention

The check reads a PR's carried run dirs — `<artifacts-path>/<run-id>/` directories present
in the PR's own diff — never "the newest run dir in the checkout" (a stale, already-merged
run must never satisfy a new PR).

| Emitter class | Convention |
|---|---|
| An agent building on a local dev machine / worktree | **Commit the run dir onto the PR branch** under `artifacts-path` (default `.faff/runs`). This is the v1-supported path — the only channel that reliably rides the PR for an emitter with no CI workflow run of its own. |
| A CI-resident emitter (the build itself runs as a GitHub Actions job) | Upload the run dir as a **workflow artifact**, then have `governance-check`'s job download it into `artifacts-path` before the Action step runs (an `actions/download-artifact` step ahead of `uses: .../governance-check`). The Action itself never fetches artifacts across workflow runs — that step is yours to add, using the standard `actions/upload-artifact` / `download-artifact` pair. |

**No artifacts carried at all** (neither convention wired yet, or a PR that genuinely
carries none) is a declared policy choice, not a silent pass:

- `on-missing: pass` (**default, adoption mode**) — the check passes, and the job summary
  states `no governance artifacts carried` so the gap stays visible while you roll the
  convention out. Use this on a mixed repo (human PRs alongside agent-built ones) — a
  required check that fails every human PR kills adoption.
- `on-missing: fail` (**locked-down mode**) — the check fails when nothing was carried.
  Flip individual branches to this once every PR landing there is agent-emitted and
  expected to carry artifacts (e.g. a branch protection rule scoped to an agent-only
  integration branch).

## 4. Pin the binary fetch

When no in-checkout `plugin/skills/faff/bin/faff` is found (the common case for a
*consumer* of the Action, not faff's own repo), the Action fetches the binary from
`raw.githubusercontent.com/shftwst/faff/<faff-version>/plugin/skills/faff/bin/faff`.

**Pin `faff-version` to a commit sha, not a tag.** A tag is a mutable ref — if it moves,
the fetch silently starts serving a different binary on your next PR, with no diff for
anyone to review. A commit sha can't move. Both forms are *accepted* (the input is a
free-form ref), but only a sha gives you the guarantee:

```yaml
      - uses: shftwst/faff/.github/actions/governance-check@<pinned-sha>
        with:
          faff-version: "a1b2c3d4e5f6..."   # a commit sha — not a tag
```

## Failure modes worth knowing about

- **Snapshot divergence.** The check verifies *what the PR carries*, not the live run —
  a committed ledger that was clean when committed but whose local run kept going after
  is not re-observed. The job summary prints the ledger's last recorded event
  seq/timestamp so this is visible, not hidden.
- **The `on-missing: pass` fail-open.** Named above — visible per-PR in the job summary,
  closed per-branch by flipping to `fail`.
- **Conformance, not authenticity.** Named above — the check's honest boundary.
