# Spec: Discover and parse GitHub-native issue templates for the tier-1 slot (FAFF-1112)

> Spec: faffter-dark-nlspec · 2026-10-18 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1112.

build-tier: complex

This is the design spec for FAFF-1112, written for the build agent that will implement it and for the human reviewers who gate it. It covers one slice: finding a repo's own `.github/ISSUE_TEMPLATE*` files, reading their front matter, and bucketing them onto faff's six-type taxonomy. Choosing between two candidates of the same type is the sibling ticket FAFF-1113 and is not designed here.

## WHY — Problem and Principles

**The load-bearing model.** The create boundary resolves a ticket template in three tiers, and tier 1 — the tracker-native slot, "idea G" — currently has only a Linear occupant. The Linear occupant works by *identity*: `/faff-onboard` lists the tracker's templates over MCP, a human confirms a faff-type for each, and `faff native-map set` persists `{type → {id, name}}`; at create time the lane fetches that template's body live. A GitHub-templated repo has no such identity to store and no MCP call to make — its templates are **files already in the working tree**. So the GitHub occupant is not a second identity map; it is a **scan**, and this ticket builds the scan plus the type gate that turns raw files into a candidate set.

**Problem statement.** A repo whose issues are templated under `.github/ISSUE_TEMPLATE*` never gets those templates considered at create time, because nothing in the repo reads that directory — `conventions.js` scans `.github/workflows` and `.github/PULL_REQUEST_TEMPLATE*`, and nothing scans `ISSUE_TEMPLATE`. The result is that `/faff-jot` and `/faff-plot` mint tickets in faff's built-in field shape while the repo's own, usually better, template sits unread on disk. This change adds the offline scanner and type gate that produce the classified candidate set the selection verb will consume.

**The detection axis is the repo, not the configured tracker.** A `.github/ISSUE_TEMPLATE/` directory can exist regardless of what `tracking.tracker` names — this repo pins `tracking.tracker: linear` while being GitHub-hosted. The scan therefore keys off the working tree and never reads `tracking.tracker`; a Linear-pinned, GitHub-hosted repo must still get its GitHub templates discovered.

**Purity is the constraint, not a preference.** The new module mirrors `native-map.js`'s discipline: no MCP, no network, no git, no environment discovery, no subprocess. Its whole input is a filesystem root and its whole output is a data structure. This is what makes it testable with a temp directory and what keeps the tracker read in the orchestrator lane where the create boundary already puts it.

**Seed, never constrain.** Every absence and every malformation is a clean miss, never an error. The create boundary's load-bearing invariant is that ticket creation is never blocked, warned-to-block, or rejected because a template was missing or unreadable, so a scanner that can throw would be a defect in the invariant, not merely in itself.

**Classification must never fabricate.** A file that does not classify is dropped rather than guessed into a type. `/faff-onboard`'s own mapping step carries the same rule ("never fabricate") because a silent mis-map at create time produces a ticket born in the wrong shape, which is harder to notice than one born in the generic shape.

**Reference context.** `plugin/skills/faff/bin/lib/native-map.js` (the sibling tier-1 occupant; FAFF_TYPES), `plugin/skills/faff/bin/lib/shared-infra.js` (parseYamlSubset, scalar, stripInlineComment, findRoot), `plugin/skills/faff/references/create.md` (the three resolution tiers), `plugin/skills/faff/bin/lib/conventions.js` (listDirMatches idiom), `plugin/skills/faff/bin/lib/validate-adapters.js` (the front-matter fence regex), `plugin/skills/faff/bin/lib/cli-surface.js` (DISPATCH_SURFACES).

**Scope statement.** This sits at the create boundary's tier-1 resolution step, as the GitHub-side producer of candidates; the Linear side already produces its own via `faff native-map get`.

## OUT OF SCOPE

- The overlap scorer, thresholds, ambiguity prompt, `sanitize_for_display`, and `invocation_mode` plumbing — the sibling FAFF-1113.
- Extracting the `## <Field>` heading sequence from a chosen template's body.
- GitHub issue *forms* (`.yml`/`.yaml` under `.github/ISSUE_TEMPLATE/`).
- Changing `parseYamlSubset`'s flow-sequence handling.
- Replacing faff's six-type taxonomy with GitHub's vocabulary.
- Writing anything back to the tracker, or persisting the scan result to disk.
- Extracting a classifier shared with `/faff-onboard`'s Linear mapping step.

## WHAT — Vocabulary, Types, and Interfaces

```
ENUM FaffType: bug | feature | spike | chore | epic | default      # = FAFF_TYPES, imported
ENUM SubstantiveType: bug | feature | spike | chore | epic          # FaffType minus `default`
CONSTANT UNCLASSIFIED: the string "UNCLASSIFIED"
RECORD GithubTemplateCandidate: path, form ("directory"|"bare"), name, about, labels, type (SubstantiveType|null), universal
  CONSTRAINT universal = true IFF type = null
  CONSTRAINT universal = true IMPLIES form = "bare"
RECORD ScanResult: root, candidates, dropped, notes
RECORD DroppedFile: path, reason ("unclassified"|"unreadable"|"not-markdown"|"excluded-config")
```

CLI: `faff github-templates scan [--type <faff-type>] [--json] [--root DIR]`. An unknown `--type` is a usage error (exit 2); absence of templates is never an error.

**Chosen:** keep two independent legs and import `FAFF_TYPES` from `./native-map`.
**Chosen:** leave `parseYamlSubset` untouched and normalise labels locally with `normalize_labels`.
**Chosen:** the type gate returns a SubstantiveType or UNCLASSIFIED, never `default`.
**Chosen:** ship a registered subcommand-dispatch verb `faff github-templates scan`.

## HOW — Behaviour

One new module, `plugin/skills/faff/bin/lib/github-templates.js`, plain JavaScript, one `region:factory` banner; requires only `node:fs`, `node:path`, `./argv`, `./shared-infra`, `./native-map`. The scan lists `.github/ISSUE_TEMPLATE/` (byte order; config.yml/yaml excluded; non-.md dropped) and the bare `.github/ISSUE_TEMPLATE.md`, parses each file's fenced front matter, classifies by labels then name then about against an ordered table (bug, spike, chore, epic, feature), applies the bare-file universal rule, and sorts universal last then by path. Nothing throws at the caller. Registration: COMMANDS entry, REGION_MAP factory, REGION_SELFTEST_ARGV, DISPATCH_SURFACES surface, docs/guide/cli.md row, a `--selftest`.

## Scenarios — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose .github/ISSUE_TEMPLATE/ contains bug_report.md with front matter `name: Bug report` and `labels: [bug, triage]`
When `faff github-templates scan --type bug --json` runs against that root
Then the candidate set contains exactly that file, with type "bug", labels ["bug","triage"], and universal false
```

```
Given a repo with no .github/ISSUE_TEMPLATE directory and no .github/ISSUE_TEMPLATE.md
When the scan runs against that root
Then it exits 0 with zero candidates and zero notes, and the create boundary's tier-1 GitHub arm misses
```

```
Given a repo whose .github/ISSUE_TEMPLATE/ contains only config.yml
When the scan runs against that root
Then no .md candidates are produced, config.yml appears in dropped with reason "excluded-config", and the bare-form arm has still been evaluated
```

```
Given a repo with .github/ISSUE_TEMPLATE/notes.md whose front matter carries no classifiable signal
When the scan runs against that root
Then notes.md appears in dropped with reason "unclassified" and in no candidate set, including the universal one
```

```
Given a repo whose only template is a bare .github/ISSUE_TEMPLATE.md with no front-matter fence
When `faff github-templates scan --type <t> --json` runs for each of the six faff types in turn
Then every one of the six candidate sets contains that one file, with type null and universal true
```

```
Given a repo whose only templates are typed directory-form files and no bare .github/ISSUE_TEMPLATE.md
When `faff github-templates scan --type default --json` runs
Then the candidate set is empty — the type gate never emits `default`, so only a universal candidate could have matched
```

## Open Questions and Assumptions

**Open Questions.** None.

**Assumptions.** None.

## DONE — Definition of Done

### From WHY
- [ ] A repo with `.github/ISSUE_TEMPLATE/bug_report.md` yields that file in the `bug` candidate set, where before the ticket it yielded nothing.
- [ ] The scan produces identical output for the same tree whether `tracking.tracker` is `linear`, `github`, or unset — it never reads that key.
- [ ] No input causes the scan to throw at its caller; a missing directory, an unreadable file and a malformed fence each resolve to a recorded miss at exit 0.

### From WHAT (types and interfaces)
- [ ] `plugin/skills/faff/bin/lib/github-templates.js` exists, carries exactly one `// === region:factory — github-templates — FAFF-1112 … ===` banner, and `faff regions check` passes.
- [ ] The module is plain `.js` with no `.ts` sibling, and `build-manifest.json` is unchanged.
- [ ] Its require set is exactly `node:fs`, `node:path`, `./argv`, `./shared-infra`, `./native-map` — no `child_process`, no network module, no governance module.
- [ ] The six faff-type tokens appear in the module only via `FAFF_TYPES` imported from `./native-map`; the module contains no literal list of the six.
- [ ] Every emitted candidate satisfies `universal === (type === null)` and `universal === true` implies `form === "bare"`.
- [ ] `faff github-templates scan --type <unknown>` exits 2 as a usage error and emits no candidate set.

### From HOW (behaviour)
- [ ] `--type <t>` returns every candidate whose `type` is `t` plus every `universal` candidate, and nothing else.
- [ ] `--type default` returns exactly the universal candidates, and the type gate never emits `default` for any input.
- [ ] A directory-form `*.md` that fails to classify appears in `dropped` with reason `unclassified` and in no candidate set.
- [ ] A bare `.github/ISSUE_TEMPLATE.md` that fails to classify is a candidate for all six types with `type: null, universal: true`.
- [ ] A bare `.github/ISSUE_TEMPLATE.md` that does classify is a single-type candidate with `universal: false`.
- [ ] `normalize_labels` returns `["bug","triage"]` for each of `labels: [bug, triage]`, `labels: ["bug","triage"]`, `labels: '[bug, triage]'`, and the block-sequence form; `["bug"]` for `labels: bug`; and `[]` for an absent, empty, boolean or numeric value.
- [ ] `classify` resolves `labels` before `name` before `about`, and a template named `RFC proposal` classifies `spike`, not `feature`.
- [ ] Candidate output is sorted with `universal` last and otherwise by repo-relative path in byte order, so two runs over the same tree produce byte-identical output.

### From HOW (edge cases)
- [ ] `config.yml` and `config.yaml` are dropped with reason `excluded-config`, case-insensitively, and the bare-form arm still runs when the directory holds nothing else.
- [ ] A non-`.md` file in the directory is dropped with reason `not-markdown`; a nested directory is skipped with no `dropped` entry.
- [ ] An unreadable file is dropped with reason `unreadable`, recorded in `notes`, and the scan completes over the remaining entries.
- [ ] A `*.md` file with no front-matter fence parses to all-null signals rather than reading the markdown body as key lines.
- [ ] Two directory templates classifying to the same type both appear in that type's candidate set — the scan does not deduplicate.

### From HOW (registration)
- [ ] `faff github-templates scan` is reachable from the `faff` entrypoint via a `COMMANDS` entry.
- [ ] `REGION_MAP` maps `github-templates` to `factory` and `REGION_SELFTEST_ARGV` invokes its `--selftest`; `faff regions selftest --region factory` passes.
- [ ] `DISPATCH_SURFACES` in `cli-surface.js` carries a `github-templates` surface declaring the `scan` subcommand and the `--type` / `--json` / `--root` / `--selftest` flags.
- [ ] `docs/guide/cli.md` carries a row for the verb and `faff lint-cli-doc` passes bidirectionally.
- [ ] `faff lint-cli-coverage` passes, satisfied by `test/github-templates.test.mjs`.

### From the carried design-lens objections
- [ ] The spec records a `**Chosen:**` for the shared-versus-duplicate classifier question, and the module imports `FAFF_TYPES` rather than re-literalling the taxonomy.
- [ ] The spec records a `**Chosen:**` for the `parseYamlSubset` flow-sequence precursor, `labels` stays in scope, and `shared-infra.js` is unchanged by this ticket's diff.
- [ ] Two scenarios document the `default`-type path — the empty case and the universal-candidate case — and both are covered by tests.

confidence: high
