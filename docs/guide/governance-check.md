# Add governance-check to GitHub

`faff governance-check` rechecks run evidence in GitHub Actions. When branch
protection requires that status, an agent cannot omit its own checks and merge
through the normal path.

This guide explains how to add the check to a repository. For command flags,
see the [`governance-check` row in the CLI reference](cli.md). For the schemas
behind the check, see the
[Agent Delivery Evidence specification](https://github.com/shftwst/faff/blob/main/docs/evidence/v0.2/conformance.md).

## What the check can prove

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
`faff branch-protection-check`. Marking `governance-check` required is a human repo-admin
action (console or `gh api`); the autonomous build loop never performs it — it's a
repo-settings mutation outside the PR-merge flow, the same category of side effect the
loop's own hard floor keeps out of unattended reach.

**Use the rulesets API, not the legacy branch-protection endpoint.** A repo protected by a
GitHub **ruleset** (Settings → Rules → Rulesets — the modern surface, and the one
`faff branch-protection-check` reads) is not bound by the classic
`branches/<branch>/protection/required_status_checks` endpoint; PATCHing that endpoint on a
ruleset-protected repo silently mutates a different, unused surface and the check stays
non-binding. Confirm which surface you're on before picking a recipe below.

**Rulesets (recommended, and what faff's own repo uses):**

```console
# 1. Discover the ruleset id targeting your branch:
$ gh api repos/<owner>/<repo>/rulesets --jq '.[] | select(.name=="Main") | .id'

# 2. Read the current required_status_checks rule:
$ gh api repos/<owner>/<repo>/rulesets/<id> --jq '.rules[] | select(.type=="required_status_checks")'

# 3. PATCH the ruleset so required_status_checks contains BOTH your existing checks
#    and "governance-check" (the API replaces the rule wholesale — send the full
#    rules array back with governance-check added). Console equivalent:
#    Settings -> Rules -> Rulesets -> <ruleset name> -> Require status checks ->
#    add governance-check.
```

**Legacy classic branch protection** (only if your repo genuinely has no ruleset and
still uses the older `branches/.../protection` surface):

```console
$ gh api -X PUT repos/<owner>/<repo>/branches/<branch>/protection/required_status_checks \
    -f strict=true \
    -f 'contexts[]=governance-check'
```

Either way, confirm it landed with `faff branch-protection-check --branch <branch>` — it
prints the branch's `required_checks` list (reading the rulesets surface first), which
should now include `governance-check`. Also confirm the required-check context string
equals the job name `governance-check` exactly — a mismatch leaves PRs stuck on
"Expected — waiting for status" forever, even once the job itself is green.

A broader sweep for other docs still naming the legacy endpoint is tracked separately —
this guide corrects only its own recipe.

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

**Why `on-missing: pass` is the deliberate posture on a mixed repo, not a hole.** Once a
required check gates real PRs, "what happens on zero footprint" stops being a rollout
detail and becomes the whole gating model. A repo that mixes human-authored PRs (which
never run an agent build, so never carry an anchor) with agent-built ones (which always
do) has, in the artifact footprint itself — a committed `.faff/anchors/**` entry — exactly
the signal that discriminates the two classes, and it's already what the Action's
discovery step keys off. So the posture is **footprint-discriminating adoption**: a PR
that carries an anchor is gated fail-closed (the `integrity` + `merge_floor` legs)
*regardless* of `on-missing` — that knob only governs the branch where no footprint is
found at all, which `pass` treats as presumptively-human and lets through. This is what
makes a required check non-blocking for every hand-authored PR while still binding for the
honest agent-PR case. The accepted residual: a determined actor can strip the anchor to
present as a zero-footprint human PR and bypass the floor — unobservable by construction,
since the discriminator and the evidence are the same artifact. That's the intrinsic
ceiling of adoption mode on a mixed repo, closed only by flipping to `on-missing: fail`
once a branch becomes agent-only (no hand-authored PRs land there) — the same knob, no
code change, is the future lockdown lever.

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
