# Contributing

Contributions to SuperDomestique happen in this repository, which keeps the
technical name `faff` for its CLI, paths, plugin, and commands. See the
[README](README.md) for what the project is.

## Development setup

Clone the repository. The root is intentionally dependency-free, so there is
nothing to install (`website/` has its own `package.json` for the documentation
site only). You need **Node 20 or later**, which is what CI uses. Link the
skills and the `faff` CLI with [`scripts/link-skills.sh`](scripts/link-skills.sh):
`--global` for a machine-wide link, no flag for a repository-local one;
`--status` lists the links and `--unlink` removes them. The same script points
this clone's `core.hooksPath` at [`.githooks/`](.githooks), which installs a
`prepare-commit-msg` hook that adds the DCO sign-off for you (see below).

## Tests and lints

CI runs these, and you can run them locally from the repository root:

```sh
node --import ./test/hermetic-env.mjs --test test/   # the test suite (canonical invocation)
node plugin/skills/faff/bin/faff validate-adapters   # SKILL.md lint
node plugin/skills/faff/bin/faff lint-refs           # ban tracker refs in skill prose
node plugin/skills/faff/bin/faff lint-cli-doc        # CLI-doc coverage
```

The `--import ./test/hermetic-env.mjs` preload is the **canonical way to run the
suite** (FAFF-785). It scrubs faff-owned `FAFF_*`/`CLAUDE_*` variables from the
environment before any test loads, so a checkout that is itself a live faff repo
— an operator shell full of `FAFF_*` and a populated `.faff/runs/` history —
produces the same green result as clean CI. A bare `node --test` still works on a
clean checkout; the preload is what makes a *dirty* one match it. The one
exception, `FAFF_REQUIRE_DOCKER`, survives the scrub so docker-gated cases keep
failing loud rather than silently skipping (FAFF-274).

## Pull requests

- **Conventional Commit PR title.** The repository squash-merges with the PR
  title as the `main` commit subject, and release-please parses it, so a
  non-conforming title never triggers a release.
- **Sign off every commit**, adding a `Signed-off-by` trailer that certifies the
  [Developer Certificate of Origin v1.1](https://developercertificate.org). Once
  you have run `scripts/link-skills.sh`, the `prepare-commit-msg` hook adds the
  trailer automatically; `git commit -s` does the same by hand. A CI check
  requires it on commits made after the check landed.
- **CI must pass**, and **never hand-bump versions** (release-please owns them).

## Reports, decisions, and authoring

- **Reports.** There is no public issue tracker. Open a pull request to propose
  a change; report a security issue through [SECURITY.md](SECURITY.md).
- **Decisions** live in `records/adr/` and `records/specs/`. `FAFF-XX` history
  references point to a private tracker; the public reasoning is in those records.
- **Authoring standards** are in [`AGENTS.md`](AGENTS.md) (auto-loaded) and, for
  skill edits, [`docs/reference/skill-authoring.md`](docs/reference/skill-authoring.md).

## Licence

Contributions are accepted inbound = outbound under Apache-2.0, attested per
commit by the DCO sign-off above. See the [Licence](README.md#licence) section
for the project's licence commitment.
