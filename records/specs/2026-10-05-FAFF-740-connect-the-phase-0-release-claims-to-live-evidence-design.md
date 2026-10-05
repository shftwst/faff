# FAFF-740: Connect the Phase 0 release claims to live evidence

> Spec: faffter-dark-nlspec · 2026-10-05 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-740.

This spec covers the narrowed slice of FAFF-740 as re-verified on 2026-10-05 against `origin/main` at `b02fac1b`. It repairs the public trust-claim audit so every pointer a reader is told to follow resolves today, re-points its unresolved claims at open owners, corrects three false rows on the concept evidence page and gives two published artefacts their first public inbound link. It is written for the build agent and for the adversarial spec reviewer that must clear it before any build starts. It supersedes the 2026-08-07 nlspec comment on the issue, which covered a broader scope and must not be built from.

## 1. WHY

**The load-bearing model.** The FAFF-732 claim ledger is a dated audit frozen at commit `5120f548`, and that freeze is deliberate: its file inventory, candidate dispositions and claim source paths describe the tree as it stood then, and default validation never compares them with a later tree. The defect is that the same frozen record also holds the pointers a reader follows today (evidence targets, owner issues) and nothing checks those against today. This change keeps the frozen half frozen and adds a separate, additive, HEAD-facing check over only the reader-facing pointers, with one optional field to say where a moved source file now lives.

**Problem.** The front page sends readers to the trust-claim audit and the concept evidence page, and both are wrong in ways CI cannot see: four evidence entries and two source anchors in the audit name paths that FAFF-754 moved, all three unresolved claims (and one attested claim) name an owner issue that is Done or Cancelled, three rows on `docs/concept/evidence.md` call shipped artefacts pending, and the external-verification protocol and the Fly.io L3 case study have no inbound link from any public page. This change repairs the data, adds the one missing mechanism (a liveness check that fails the build), and fixes the prose under the link checks CI already runs.

### Design principles

**The frozen contract stays frozen.** The 694 dead inventory paths, the 201 candidate dispositions, `source_commit`, `generated_at`, `scope` and every `claims[].source.path` are untouched. Reject any implementation that rewrites `files[]`, changes a frozen `source.path`, or makes default validation look at the working tree.

**Missing evidence stays explicit.** No claim gains a pointer, status or owner that the repository and tracker do not support today. Where no honest open owner exists, use the follow-up the issue already names (filed as FAFF-1183) rather than borrowing a nearby open ticket.

**One deterministic oracle per item, offline.** Every check runs without network access and gives the same answer on every run of the same tree. Reject a check that reads the tracker, depends on clone depth, or depends on the date.

**The report is generated.** `verification/audits/2026-08-07-FAFF-732-public-trust-claims.md` is only ever written by `validate-report.mjs --render`. Never hand-edit it.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `verification/audits/tools/faff-732/validate-report.mjs` | JavaScript (Node ESM) | The validator, renderer and CLI this change extends |
| `verification/audits/2026-08-07-FAFF-732-public-trust-claims/claim-ledger.json` | JSON | The ledger whose pointers are repaired |
| `verification/audits/2026-08-07-FAFF-732-public-trust-claims.md` | Markdown (generated) | Re-rendered, never hand-edited |
| `test/public-trust-claims.test.mjs` | JavaScript (`node:test`) | Gains the liveness and owner assertions; runs in the CI `unit` job |
| `docs/concept/evidence.md` | Markdown (Docusaurus-routed) | The "Current position" table the front page links to |
| `.github/workflows/validate.yml`, step "Validate out-of-tree docs links" | Bash | Existing FAFF-659 check that every `https://github.com/shftwst/faff/blob/main/<path>` URL in `docs/guide` and `docs/concept` names a path that exists (`[ -e "$path" ]`) |
| `records/specs/2026-08-07-faff-732-audit-and-publish-the-status-of-public-trust-claims-design.md` | Markdown | FAFF-732 design; line 111 allows an evidence target to be a repository path, a FAFF issue or an absolute URL; line 240 is the frozen-snapshot rule this change preserves |

**Scope.** This is the Phase 0 slice named by `docs/rfc/rfc-superdomestique-runtime/phase-0-ticket-carry-forward-v2.md`; it unblocks FAFF-824 ("Accept Phase 0B outward evidence baseline"), whose required evidence includes "every material claim links to evidence".

## Already shipped against this surface

Do not rebuild any of this. All of it is present on `origin/main` at `b02fac1b`, and no commit since `84f378dc` touches the ledger, validator, test, `docs/concept/evidence.md` or the two unlinked artefacts.

| Ticket | Merge | What it delivered here |
|---|---|---|
| FAFF-732 | `a5f72a20` | The claim ledger (nine claims, six-status vocabulary, typed evidence, owner issues, file-to-claim index), the lexical scanner, the byte-exact renderer, the 200-line validator and its test |
| FAFF-735 | `44083fef` | `docs/guide/harness-support.md`, the per-capability harness support matrix (Claude Code, Codex, pi.dev) |
| FAFF-739 | `75302444` | The rewritten `README.md`, including its harness-neutral "Harness support" section |
| FAFF-741 | `4015fd93` | `verification/evidence/paired-run-walkthroughs.md` and its reciprocal link with `docs/guide/run-outcomes.md` |
| FAFF-743 | `c41ab44a` | `verification/external-verification/protocol/v0.1/README.md` |
| FAFF-734 | `c1b51d4d` | `verification/external-verification/results/2026-08-12-fly-l3-faff-472/README.md` (main result: does-not-support) |
| FAFF-659 | `9b5b5675` | `onBrokenLinks` and `markdown.hooks.onBrokenMarkdownLinks` set to `throw`; the CI step that checks absolute `blob/main/` URLs in `docs/guide` and `docs/concept` |
| FAFF-754 | `84571b63` | Moved `docs/architecture/**` to `docs/reference/architecture/**` and `docs/evidence/**` to `verification/evidence/**`, which is what broke the ledger pointers |

The premise still holds: no Done ticket since 2026-09-07 delivers any of the four defects below.

## 2. OUT OF SCOPE

The issue's "Remainder, to be filed separately" list stays out of this build. Every item was filed during prep on 2026-10-05 so the scope survives FAFF-740 closing: R1 is FAFF-1184, R2 FAFF-1185, R3 FAFF-1186, R4 FAFF-1183, R5 FAFF-1187, R6 FAFF-1188, R7 FAFF-1189, R8 FAFF-1190 and R9 FAFF-1191. FAFF-1191 (exact source binding) and FAFF-1189 (lint-refs and owner markers) block FAFF-1184 (status markers). FAFF-1183, the ledger rebuild, is also the owner of three claims (see section 4, "Owner re-assignment"). None of them blocks FAFF-824.

| Excluded | Why excluded | Extension point |
|---|---|---|
| Repository-wide status markers and a marker generator (R1 in the issue) | Bundled scope the 2026-08-07 review rejected | A new `--render-marker` mode in `validate-report.mjs`, after exact source binding exists |
| A HEAD-facing lexical scanner for new unlinked claims (R2) | Measured yield 0 of 201 matches; a different mechanism from pointer liveness | `scannerMatches()` in `validate-report.mjs` |
| Reconciling the three status vocabularies (R3) | Prose and policy work, no Phase 0 dependency | `docs/concept/positioning-and-language.md`, `docs/guide/harness-support.md` |
| Rebuilding the ledger against the current tree (R4), including re-anchoring the six README claims whose sections no longer exist, the two `source.section` values ("Observed behaviour", "Portability boundary") that were never real headings even at `5120f548`, and refreshing `current_state` / `target_state` text | A rebuild, not a repair; it would rewrite the dated judgement | FAFF-1183, "Rebuild the FAFF-732 public-trust claim ledger against the current tree" |
| Growing `--selftest` to one fixture per rule family (R5) | FAFF-732's defect; the test keeps asserting `ok (3 cases)` | `selftest()` in `validate-report.mjs` |
| Extending the out-of-tree link check to `README.md`, `docs/reference/**`, `verification/**`, `records/**` or relative paths (R6) | Separate CI policy change | `.github/workflows/validate.yml`, step "Validate out-of-tree docs links" |
| `faff lint-refs` versus owning-issue markers in `docs/guide/**` (R7) | Only matters once markers exist; this change edits no `docs/guide` file | `plugin/skills/faff/bin/lib/lint-refs.js` |
| Artefact-to-claim reverse index and record reciprocity (R8) | New index; no Phase 0 dependency | A new rendered section in `renderReport()` |
| Exact source-text binding and `--check-sources` (R9) | Needs its own drift oracle; liveness here is path-level only | A new mode in `validate-report.mjs` |
| A networked owner-state check that notices when an owner issue closes later | Violates the offline, deterministic CI invariant | A scheduled job or the faff-tidy spec-health pass reading tracker state |
| Rendering ledger pointers as Markdown links | The report lives outside the routed docs trees, so no link checker would see the links; `--check-live` is the oracle instead | `renderReport()` once R6 covers `verification/**` |
| Any change to `website/docusaurus.config.js`, `README.md`, `docs/reference/GLOSSARY.md`, the ledger `schema` number, or an ADR | Not needed; the issue withdraws the ADR intent from this slice | None |

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Frozen fields | Everything in the ledger that describes the `5120f548` snapshot: `schema`, `issue`, `source_commit`, `generated_at`, `scope`, `terminology`, `files`, `candidates`, and each claim's `id`, `kind`, `status`, `summary`, `source.path`, `source.section`, `current_state`, `target_state` |
| Reader-facing pointers | The values a report reader is told to follow today: each claim's source location (its `source.current_path` when present, otherwise `source.path`), each `evidence[].target`, and each `owner_issue` |
| Working tree | The checked-out repository the validator file sits in; its root is four directories above `validate-report.mjs` |
| Liveness check | The new `--check-live` mode: every reader-facing path pointer exists in the working tree |
| Closed-owner list | A constant in `test/public-trust-claims.test.mjs` naming FAFF issues known to be closed (or closing with this change); no claim may name one as its owner |

### Ledger shape change

One optional field. The `schema` number stays `1`, because every existing ledger without the field remains valid and no existing field changes meaning.

```
RECORD SourceAnchor:
  path: String            # FROZEN; must be present in files[] (unchanged rule)
  section: String         # FROZEN; non-empty (unchanged rule)
  current_path: String?   # NEW, optional. Repository-relative path where the source file lives today.
                          # Present only when path no longer exists in the working tree.

  CONSTRAINT IF current_path is present: current_path is a non-empty string AND current_path != path
```

`validateLedger()` gains exactly one shape rule: when `claim.source` has a `current_path` key that is empty, not a string, or equal to `source.path`, push the error `<claim id>: invalid source.current_path`. The rule does not touch the filesystem, so the default validation mode still never compares the dated audit with the working tree.

### New CLI mode and export

```
validate-report.mjs --check-live <ledger.json>

  exit 2  no ledger argument (prints the usage line, which now lists --check-live)
  exit 1  ledger JSON unreadable ("invalid ledger: <message>" on stderr), or any liveness error (one per stderr line)
  exit 0  stdout is exactly one line: {"live":true,"checked":<n>,"skipped":<n>}

EXPORT FUNCTION checkLive(ledger, root) -> { errors: List<String>, checked: Integer, skipped: Integer }
```

`--check-live` runs only the liveness check. It does not run `validateLedger()`, read the report, or call git. The usage line becomes:

```
usage: validate-report.mjs <ledger.json> [report.md] | --render <ledger.json> | --check-live <ledger.json> | --selftest
```

### Liveness error messages (exact)

| Condition | Message |
|---|---|
| No `current_path`, and `source.path` is missing from the working tree | `<id>: source path <path> does not exist in the working tree; record the move in source.current_path` |
| `current_path` present and missing from the working tree | `<id>: source.current_path <current_path> does not exist in the working tree` |
| Evidence target is a path and is missing | `<id>: evidence target <target> does not exist in the working tree` |
| A checked path is absolute or has a `..` segment | `<id>: <field> <value> must be a repository-relative path` where `<field>` is `source path`, `source.current_path` or `evidence target` |

### Renderer change

Two deterministic changes in `renderReport()`; everything else renders byte-for-byte as today.

1. The `Source:` line of a claim with `source.current_path` becomes:
   `` - Source: `<path>` (<section>), now at `<current_path>` ``
   Claims without the field render exactly as before.
2. A new paragraph directly after the existing Method paragraph (the one ending "Human review still owns semantic sufficiency and evidence strength."), separated by one blank line, with this exact text:
   `Claim source paths and the file inventory stay pinned to the source commit. Where a source file has since moved, its current location is shown as "now at". Evidence targets and "now at" paths are checked against the current tree, so a reader can follow them.`

### Ledger data changes (complete list)

No other byte of the ledger changes.

| Claim | Field | From | To |
|---|---|---|---|
| `readme-claude-only-harness-wording` | `evidence[0].target` | `docs/architecture/codex-cli-observed.md` | `docs/reference/architecture/codex-cli-observed.md` |
| `codex-observed-capability` | `source.current_path` (new) | absent | `docs/reference/architecture/codex-cli-observed.md` |
| `codex-observed-capability` | `evidence[0].target` | `docs/architecture/codex-cli-observed.md` | `docs/reference/architecture/codex-cli-observed.md` |
| `harness-portability-boundary` | `source.current_path` (new) | absent | `docs/reference/architecture/harness-coupling.md` |
| `harness-portability-boundary` | `evidence[0].target` | `docs/architecture/harness-coupling.md` | `docs/reference/architecture/harness-coupling.md` |
| `l4-completion-claim` | `evidence[0].target` | `docs/evidence/README.md` | `verification/evidence/README.md` |
| `readme-safe-to-stop-watching` | `owner_issue` | `FAFF-741` | key removed |
| `readme-claude-only-harness-wording` | `owner_issue` | `FAFF-735` | `FAFF-1183` |
| `harness-portability-boundary` | `owner_issue` | `FAFF-735` | `FAFF-1183` |
| `l4-completion-claim` | `owner_issue` | `FAFF-736` | `FAFF-1183` |

Each moved path is a pure Git rename of the snapshot file (`git diff -M 5120f548 HEAD` shows `docs/architecture/codex-cli-observed.md`, `docs/architecture/harness-coupling.md` and `docs/evidence/README.md` as renames to the successors above), so the evidence each pointer names is the same record, now at its live path.

### Prose changes in `docs/concept/evidence.md`

Lines 14 and 17 (the "L3 parking and run completion" and "L4 completion" rows) and the rest of the page are unchanged. The three rows below replace lines 15, 16 and 18 exactly.

```
| External L3 delivery | Demonstrated on a subject repository. The published Fly.io case study delivered its issue, but two governance controls failed, so it does not support a clean governed delivery | [July L4 capabilities audit](https://github.com/shftwst/faff/blob/main/verification/audits/2026-07-20-l4-capabilities-audit.md); [Fly.io L3 case study](https://github.com/shftwst/faff/blob/main/verification/external-verification/results/2026-08-12-fly-l3-faff-472/README.md) |
| Harness support | Claude Code is the primary supported harness. Codex has completed an interactive run with limitations, and pi.dev is planned | [Harness support](/guide/harness-support); [Harness coupling inventory](https://github.com/shftwst/faff/blob/main/docs/reference/architecture/harness-coupling.md) |
| Independent governance verification | The external-verification protocol is published. Its first real case did not support a clean governed delivery, and reproducible external proof is still pending | [External-verification protocol v0.1](https://github.com/shftwst/faff/blob/main/verification/external-verification/protocol/v0.1/README.md) |
```

Add one bullet to the end of the "Read the records" list:

```
- The [external-verification index](https://github.com/shftwst/faff/blob/main/verification/external-verification/README.md)
  lists the published protocol and each real case.
```

The `/guide/harness-support` form follows the existing concept-to-guide links (`docs/concept/levels.md:37`, `docs/concept/intro.md:23`) and is checked by the Docusaurus build (`onBrokenLinks: 'throw'`, run on every pull request by `deploy-docs.yml`). The three `blob/main/` URLs are checked by the FAFF-659 CI step. `docs/concept/**` is exempt from `faff lint-refs`, so the `faff-472` directory name is allowed.

## 4. HOW

### Build order

```
PROCEDURE build:
  1. In Linear, confirm FAFF-1183 is open (status type neither completed nor canceled), and confirm every CLOSED_OWNER_ISSUES entry except FAFF-740 is completed or canceled. List each state in the PR body.
  2. Extend validate-report.mjs: current_path shape rule, checkLive(), --check-live mode, renderer changes, usage line.
  3. Edit claim-ledger.json per the "Ledger data changes" table.
  4. Regenerate the report:
       node verification/audits/tools/faff-732/validate-report.mjs --render <ledger> > <report>
  5. Extend test/public-trust-claims.test.mjs (see "Test changes").
  6. Edit docs/concept/evidence.md per section 3.
  7. Run every command in DONE.
```

### Liveness check

Summary: walk every claim once, resolve each reader-facing path against the working-tree root, and report every miss in one pass so a single run names all dead pointers.

```
PROCEDURE checkLive(ledger, root):
  errors = []; checked = 0; skipped = 0
  FOR claim IN ledger.claims (ledger order):
    IF claim.source.current_path is a non-empty string:
       field = "source.current_path"; value = claim.source.current_path
    ELSE:
       field = "source path"; value = claim.source.path
    checked += 1
    check_path(claim.id, field, value)

    FOR ref IN claim.evidence (ledger order):
      IF ref.target matches ^https?:// OR ^FAFF-[1-9][0-9]*$:
         skipped += 1          # allowed target forms per the FAFF-732 design; not checkable offline
         CONTINUE
      checked += 1
      check_path(claim.id, "evidence target", ref.target)
  RETURN { errors, checked, skipped }

PROCEDURE check_path(id, field, value):
  1. IF value is absolute OR any "/"-separated segment equals "..":
       push "<id>: <field> <value> must be a repository-relative path"; RETURN
  2. IF NOT exists(join(root, value)):          # file or directory, like the CI step's [ -e ]
       IF field == "source path":
          push "<id>: source path <value> does not exist in the working tree; record the move in source.current_path"
       ELSE:
          push "<id>: <field> <value> does not exist in the working tree"

root = the directory four levels above validate-report.mjs, derived from the module's own URL
       (verification/audits/tools/faff-732/ -> repository root), never from process.cwd()
```

CLI wiring: `--check-live` is matched as `args[0]` before the existing branches, exactly like `--selftest`. It reads `args[1]`, exits 2 with the usage line when absent, exits 1 with `invalid ledger: <message>` on a JSON parse failure (same wording as today), prints errors to stderr and exits 1 when `errors` is non-empty, else prints `JSON.stringify({ live: true, checked, skipped })` and exits 0.

Expected values: the repaired ledger has 9 claims and 11 evidence entries, all repository paths, so `--check-live` prints `{"live":true,"checked":20,"skipped":0}`. Run against the unrepaired `origin/main` ledger, the same mode exits 1 and its stderr is exactly these six lines, in this order (ledger claim order, source before evidence), each ending in a newline. That is the check that would have caught the defect.

```
readme-claude-only-harness-wording: evidence target docs/architecture/codex-cli-observed.md does not exist in the working tree
codex-observed-capability: source path docs/architecture/codex-cli-observed.md does not exist in the working tree; record the move in source.current_path
codex-observed-capability: evidence target docs/architecture/codex-cli-observed.md does not exist in the working tree
harness-portability-boundary: source path docs/architecture/harness-coupling.md does not exist in the working tree; record the move in source.current_path
harness-portability-boundary: evidence target docs/architecture/harness-coupling.md does not exist in the working tree
l4-completion-claim: evidence target docs/evidence/README.md does not exist in the working tree
```

**Anti-pattern:** folding the liveness check into `validateLedger()` or the default `<ledger> <report>` mode. Why: the FAFF-732 design fixes that default validation never compares the dated audit with a future tree; the new check must stay a separate, additive mode.

**Anti-pattern:** replacing `source.path` with the new path. Why: `source.path` must appear in the frozen `files[]`, and the old paths are the only ones in it; the rename fails validation and erases the snapshot record.

**Anti-pattern:** checking liveness with `git ls-files` or `git cat-file`. Why: the CI checkout is shallow, and the established CI precedent for "does this pointer resolve" is plain path existence.

### Failing the build

`test/public-trust-claims.test.mjs` runs in the CI `unit` job (`node --import ./test/hermetic-env.mjs --test --test-shard=N/4`), so a dead pointer fails every pull request that causes it. Moving a file that the ledger names becomes a change to three files (the move, the ledger, the regenerated report), and the error message names the field to edit.

### Owner re-assignment

Linear states verified on 2026-10-05: FAFF-741 Done, FAFF-735 Done, FAFF-736 Cancelled. No open issue owns pi.dev or Codex support work. FAFF-1183, "Rebuild the FAFF-732 public-trust claim ledger against the current tree" (Backlog, project-less, related to FAFF-740 and FAFF-732, not blocking FAFF-824), was filed during prep as the R4 remainder item and names itself owner of record for the three unresolved rows.

| Claim | Status (unchanged) | New owner | Why this is honest |
|---|---|---|---|
| `readme-safe-to-stop-watching` | attested | none | The validator never required an owner for an attested claim, and FAFF-741 delivered the paired walkthroughs; leaving a closed owner only misleads |
| `readme-claude-only-harness-wording` | stale | FAFF-1183 | The wording fix shipped after the snapshot (FAFF-739, FAFF-735); what remains is re-judging this dated row against the current tree, which is exactly the rebuild's scope |
| `harness-portability-boundary` | planned | FAFF-1183 | The support matrix shipped after the snapshot (FAFF-735); same reasoning |
| `l4-completion-claim` | unsupported | FAFF-1183 | The rebuild re-anchors this README claim (its "The levels" section no longer exists) and re-judges it against current evidence. FAFF-824 is a human acceptance gate that any outcome closes, so naming it would recreate the closed-owner defect |

### Owner-liveness assertion

Summary: no tracker read is possible in CI, so the test pins the closed owners it knows about and fails if any claim names one.

```
CONSTANT CLOSED_OWNER_ISSUES =
  FAFF-732, FAFF-734, FAFF-735, FAFF-736, FAFF-739, FAFF-740, FAFF-741, FAFF-743
  # Read in Linear on 2026-10-05: FAFF-736 canceled, the other six completed; FAFF-740 closes when this change merges.

TEST "no claim names a closed owner issue":
  ledger = parse claim-ledger.json
  FOR claim IN ledger.claims WHERE claim has owner_issue:
    ASSERT claim.owner_issue NOT IN CLOSED_OWNER_ISSUES   # message names the claim id and owner
```

Honest limit, stated in the test's one-line comment: this catches a claim pointed at a known-closed owner, including a re-point back to one; it cannot notice an owner closing after merge. Whoever closes an owner issue adds it to the list, and the test then fails until the claim is re-owned. A tracker-reading check is out of scope (section 2).

### Test changes

Existing three tests stay, with unchanged assertions: `ok (3 cases)`, `files === 715` with `valid: true`, and `--render` byte equality. Add four:

```
TEST "pointers a reader follows resolve in the working tree":
  run --check-live LEDGER
  ASSERT exit 0; ASSERT stdout (trimmed) == {"live":true,"checked":20,"skipped":0}

TEST "undoing the path repairs reproduces exactly the six original errors":
  copy = LEDGER with the six path rows of "Ledger data changes" reverted:
           the four evidence targets set back to their "From" values,
           source.current_path deleted from codex-observed-capability and harness-portability-boundary
  write copy to a fresh mkdtemp directory; run --check-live <copy>
  ASSERT exit 1
  ASSERT stderr == the six lines under "Liveness check", joined and terminated by "\n"
  ASSERT stdout == ""
  remove the temp directory

TEST "an empty source.current_path is rejected":
  copy = LEDGER with codex-observed-capability.source.current_path = ""
  run validate-report.mjs <copy>            # default validation, no report argument
  ASSERT exit 1; ASSERT stderr contains "codex-observed-capability: invalid source.current_path"

TEST "no claim names a closed owner issue"   # as above
```

Temp ledgers go under `os.tmpdir()` via `mkdtempSync` and are removed in a `finally`. The validator resolves pointers against its own location, so the temp ledger's directory does not matter.

### Failure modes

| The failure | How you'd know | What it means |
|---|---|---|
| The closed-owner list gives false comfort: an owner closes and nobody adds it | The test stays green while the report names a closed issue; only a human or tracker read notices | Proceed. The limit is stated in the test and here; the tracker-reading check is a named extension point |
| Path existence is weaker than "the evidence still says what the claim needs": a file is rewritten in place | Nothing mechanical fires | Proceed. Content binding is the exact-source-text work (R9), out of scope |
| The build-failing check is too costly for documentation moves | Pull requests that move a ledger-named file fail the `unit` job | Proceed. The error names the fix, and the ledger names only nine distinct paths today |

### Edge cases

- A claim with `current_path` whose `source.path` still exists: valid; only `current_path` is checked. Not produced by this change.
- An evidence target that is a directory: passes, matching the CI step's `[ -e ]`.
- An evidence target that is a URL or `FAFF-N`: counted in `skipped`, never fetched.
- A ledger with no claims: `{"live":true,"checked":0,"skipped":0}`, exit 0.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the repaired ledger and the docs moves already on main
When a later pull request moves docs/reference/architecture/harness-coupling.md without touching the ledger
Then the unit job fails, and the failure names harness-portability-boundary and the source.current_path to update
```

```
Given the unrepaired ledger from origin/main at b02fac1b (reproduced in the test by undoing the six path rows)
When the new validator runs --check-live against it
Then it exits 1 and stderr is exactly the six lines listed under "Liveness check"
```

- The liveness check MUST make no network call and MUST NOT invoke git.
- `--check-live` MUST give the same output on a shallow and a full clone of the same commit.

## 5. DESIGN DECISION RATIONALE

**How should a claim record that its source file moved, given `source.path` must be in the frozen `files[]`?**

- Alias or successor field modelled on FAFF-732 design line 115: that precedent is about claim IDs ("a moved claim records the old ID as an alias"), not file paths, so borrowing it would conflate identity with location.
- Rewrite `source.path` and add the new path to `files[]`: fails the inventory check (`files[]` must equal the `5120f548` tree exactly) and erases the snapshot record; a schema change in disguise.
- Keep `source.path` frozen and add an optional `source.current_path`: one field, nested where the location already lives, old ledgers stay valid, schema number unchanged.

**Chosen:** optional `source.current_path` inside the source anchor, schema `1` retained, with a shape rule in `validateLedger()` and liveness checked only by `--check-live`.

**Where should the HEAD-facing check live?**

- Inside `validateLedger()` or the default mode: contradicts FAFF-732 design line 240 and makes the dated audit depend on the current tree.
- A separate test-only script: duplicates ledger parsing and leaves the validator unable to answer the question.
- A separate `--check-live` mode plus an exported `checkLive()`: additive, mirrors the existing `--render` and `--selftest` modes, pure filesystem.

**Chosen:** a separate `--check-live` mode in `validate-report.mjs`, with no git call and no network call.

**What counts as "resolves"?**

- Tracked in Git (`git ls-files`): needs git state, and a shallow checkout behaves differently.
- Exists in the working tree, resolved from the validator's own location: same rule as the FAFF-659 CI step (`[ -e "$path" ]`), works in any checkout and any working directory.

**Chosen:** working-tree existence relative to the repository root derived from the validator's location; reject absolute paths and `..` segments; skip URL and `FAFF-N` targets, which the FAFF-732 design allows and which cannot be checked offline.

**Should the liveness check fail the build or report from a scheduled job?**

- Scheduled job: no friction on moves, but nobody is present when it fires, and this defect already sat unseen for two months.
- Fail the build: the person moving the file is present with full context; costs a ledger edit and re-render per move; matches FAFF-659's posture for out-of-tree links.

**Chosen:** fail the build, by asserting `--check-live` from `test/public-trust-claims.test.mjs` in the CI `unit` job.

**How should the report show a moved source?**

- Show only the new path: hides that the audit judged the snapshot file.
- Show only the old path: the current defect.
- Show both, and say in the Method section which fields are pinned and which are checked live.

**Chosen:** `` `<path>` (<section>), now at `<current_path>` `` on the Source line, plus one fixed Method paragraph; code spans, not links.

**Who owns each claim that names a closed owner?**

- Re-status the two claims whose remediation shipped: the six-status vocabulary has no "resolved" state, and changing a dated judgement is the rebuild's job.
- Point them at a nearby open ticket (for example FAFF-613, a Codex run): plausible-looking but false; that ticket does not own these rows.
- Point them at FAFF-740 itself: closes on merge.
- Point the L4 claim at FAFF-824: it is a human acceptance gate whose Accept, Reject or Narrow outcome closes it without doing the re-status work, so the claim would name a closed owner again.
- Point all three unresolved claims at the ledger rebuild the issue already names (R4), filed during prep as FAFF-1183; drop the attested claim's owner.

**Chosen:** `readme-safe-to-stop-watching` loses its owner; `readme-claude-only-harness-wording`, `harness-portability-boundary` and `l4-completion-claim` go to FAFF-1183; no status changes.

**How can CI assert owner liveness without reading the tracker?**

- Committed `owner_state` snapshot in the ledger: a second new field, and "open" decays silently, which recreates the defect in a new place.
- Allowlist of verified-open owners: same decay problem.
- Date-based staleness check: non-deterministic across days.
- Git-history heuristic (closing commits): depends on clone depth.
- Denylist of known-closed owners in the test: "closed" does not decay, no ledger change, deterministic.

**Chosen:** a `CLOSED_OWNER_ISSUES` constant in `test/public-trust-claims.test.mjs` (FAFF-732, FAFF-734, FAFF-735, FAFF-736, FAFF-739, FAFF-740, FAFF-741, FAFF-743) and a test that no claim names one, with the limit stated.

**What should the three stale rows on the concept evidence page say?**

- Delete "pending" only: leaves the reader without the new records.
- Restate each row from its now-published record, including the Fly.io case's does-not-support result and the still-pending reproducible proof (FAFF-824's first required evidence item).

**Chosen:** the exact replacement rows in section 3, which keep the existing record links and add the case study, the harness support guide and the protocol.

**Where should the inbound links for the protocol and the Fly.io case go?**

- `README.md` or `docs/reference/**`: not covered by the FAFF-659 CI step.
- `docs/guide/**`: covered, but `faff lint-refs` constrains FAFF references there and the guide is task-oriented.
- `docs/concept/evidence.md`: routed, covered by the CI step, exempt from `faff lint-refs`, and already the page the front page sends readers to for evidence.

**Chosen:** absolute `https://github.com/shftwst/faff/blob/main/` URLs in the `docs/concept/evidence.md` table rows, plus one "Read the records" bullet for the external-verification index.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

**Assumes:** FAFF-1183 is still open when the build starts. Validate in build step 1 by reading it in Linear. If it has closed, stop and park: the three unresolved claims need a new owner decision.

## 7. DONE

Paths below are relative to the repository root. `V` is `verification/audits/tools/faff-732/validate-report.mjs`, `L` is `verification/audits/2026-08-07-FAFF-732-public-trust-claims/claim-ledger.json`, `R` is `verification/audits/2026-08-07-FAFF-732-public-trust-claims.md`.

### From WHY (frozen contract intact)

- [ ] At build time, after `git fetch origin main`, a `node -e` script that parses `L` and `git show origin/main:L` and compares with `assert.deepStrictEqual` finds `schema`, `issue`, `source_commit`, `generated_at`, `scope`, `terminology`, `files` and `candidates` deep-equal, and for every claim `id`, `kind`, `status`, `summary`, `source.path`, `source.section`, `current_state` and `target_state` deep-equal
- [ ] `node V L R` exits 0 and prints JSON with `"valid":true,"files":715,"claims":9,"candidates":201`
- [ ] `node V --selftest` exits 0 and prints `validate-report --selftest: ok (3 cases)`

### From WHAT (ledger shape and data)

- [ ] `L` differs from `origin/main` only in the ten rows of the "Ledger data changes" table
- [ ] A ledger copy with `codex-observed-capability.source.current_path` set to `""` makes `node V <copy>` exit 1 with `codex-observed-capability: invalid source.current_path`
- [ ] The usage line printed by `node V` with no arguments (exit 2) lists `--check-live <ledger.json>`

### From WHAT (renderer and report)

- [ ] `node V --render L | cmp - R` exits 0
- [ ] `R` contains `` - Source: `docs/architecture/codex-cli-observed.md` (Observed behaviour), now at `docs/reference/architecture/codex-cli-observed.md` `` and the harness-coupling equivalent
- [ ] `R` contains the new Method paragraph verbatim, once
- [ ] `grep -o` occurrence counts in `R`: `docs/architecture/codex-cli-observed.md` 2, `docs/architecture/harness-coupling.md` 2, `docs/evidence/README.md` 1 (Source lines and the frozen inventory only); `docs/reference/architecture/codex-cli-observed.md` 3, `docs/reference/architecture/harness-coupling.md` 2, `verification/evidence/README.md` 1
- [ ] `grep -cE 'Owner: FAFF-(735|736|741)' R` prints `0`

### From HOW (liveness check)

- [ ] `node V --check-live L` exits 0 and prints exactly `{"live":true,"checked":20,"skipped":0}`
- [ ] `git show origin/main:L > /tmp/old.json && node V --check-live /tmp/old.json` exits 1, prints nothing on stdout, and its stderr is byte-identical to the six lines listed under "Liveness check" in section 4
- [ ] `--check-live` source contains no `spawnSync`, `execSync` or network call (inspect `checkLive()`); the root is derived from `import.meta.url`

### From HOW (owners)

- [ ] FAFF-1183 is open in Linear at build time, every `CLOSED_OWNER_ISSUES` entry except FAFF-740 is completed or canceled at build time, and the PR body lists each state
- [ ] No claim in `L` has an `owner_issue` in `CLOSED_OWNER_ISSUES`; `readme-safe-to-stop-watching` has no `owner_issue` key; `readme-claude-only-harness-wording`, `harness-portability-boundary` and `l4-completion-claim` each have `owner_issue` `FAFF-1183`

### From HOW (tests)

- [ ] `node --import ./test/hermetic-env.mjs --test test/public-trust-claims.test.mjs` exits 0 with 7 passing tests (3 existing, 4 new), including "undoing the path repairs reproduces exactly the six original errors"

### From WHAT (concept page prose)

- [ ] `grep -cE 'still being prepared|support statement is pending|external proof are still pending' docs/concept/evidence.md` prints `0`
- [ ] `docs/concept/evidence.md` contains the three replacement rows and the new "Read the records" bullet exactly as in section 3; the "L3 parking and run completion" and "L4 completion" rows are byte-identical to `origin/main`
- [ ] `grep -c 'blob/main/verification/external-verification/protocol/v0.1/README.md' docs/concept/evidence.md` and `grep -c 'blob/main/verification/external-verification/results/2026-08-12-fly-l3-faff-472/README.md' docs/concept/evidence.md` each print at least `1`
- [ ] The "Validate out-of-tree docs links" step body from `.github/workflows/validate.yml`, run locally, prints no `BROKEN` line and exits 0
- [ ] `npm --prefix website ci && npm --prefix website run build` exits 0 (resolves `/guide/harness-support`)
- [ ] `node plugin/skills/faff/bin/faff lint-refs` exits 0

### Integration smoke test

```
1. node V --check-live L                      -> exit 0, {"live":true,"checked":20,"skipped":0}
2. node V L R                                 -> exit 0, valid, files 715
3. node V --render L | cmp - R                -> exit 0
4. mv docs/reference/architecture/harness-coupling.md /tmp/hc.md
   node V --check-live L                      -> exit 1, two lines naming harness-portability-boundary
   mv /tmp/hc.md docs/reference/architecture/harness-coupling.md
5. node --import ./test/hermetic-env.mjs --test test/public-trust-claims.test.mjs -> 7 pass
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

The approach is sound. The narrowing settles the 2026-08-07 `reject-approach`: one optional field, one additive `--check-live` mode, data repairs and prose, each with a deterministic offline check.

**Right-sized: No issues.** Seven build steps, about 20 lines of validator code, ten ledger rows, three table rows and one bullet: a 1-3 day unit. The validator half (D1, D2) and the prose half (D3, D4) are separable, but both serve the same FAFF-824 evidence item ("every material claim links to evidence"), so splitting adds a ticket without letting anything ship earlier.

**Workstream fit: No issues (applied during prep).** The ledger-rebuild follow-up was filed project-less as FAFF-1183, related to FAFF-732 and FAFF-740, so it does not load the Phase 0 outcome project with work its definition of done does not need.

**Surfaced deps: No issues (both findings applied during prep).**
- `l4-completion-claim` was going to be owned by FAFF-824, a human acceptance gate this ticket blocks and that any of its outcomes closes. It is now owned by FAFF-1183, which re-judges the claim.
- The R1 to R9 remainder would have lived only in the FAFF-740 description. All nine are now filed project-less in Backlog (FAFF-1183 to FAFF-1191), with FAFF-1191 and FAFF-1189 blocking FAFF-1184, so the "R9 before R1" and "R7 before R1" ordering is an edge.

**Risk profile: No issues (applied during prep).** Filing the follow-up during prep removed the only build step that depended on outside state; build step 1 now only confirms FAFF-1183 is open.

Contingency: if review objects only to the validator half, peel the prose fixes (D3, D4) into their own ticket rather than holding them.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
