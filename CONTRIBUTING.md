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
`--status` lists the links and `--unlink` removes them.

## Tests and lints

CI runs these, and you can run them locally from the repository root:

```sh
node --test test/                                    # the test suite
node plugin/skills/faff/bin/faff validate-adapters   # SKILL.md lint
node plugin/skills/faff/bin/faff lint-refs           # ban tracker refs in skill prose
node plugin/skills/faff/bin/faff lint-cli-doc        # CLI-doc coverage
```

## Pull requests

- **Conventional Commit PR title.** The repository squash-merges with the PR
  title as the `main` commit subject, and release-please parses it, so a
  non-conforming title never triggers a release.
- **Sign off every commit** with `git commit -s`, adding a `Signed-off-by`
  trailer that certifies the [Developer Certificate of Origin v1.1](https://developercertificate.org).
  A CI check requires it on commits made after the check landed.
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
