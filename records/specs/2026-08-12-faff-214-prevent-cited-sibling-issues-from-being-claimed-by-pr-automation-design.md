# Prevent cited sibling issues from being claimed by PR automation

> Spec: faffter-dark-nlspec · 2026-08-12 · interactive re-prep · confidence: high.

This hardening change adds a small deterministic whole-PR-body sanitizer/checker, wires it into `faff-graft`, and adds operator guidance for Linear-backed repositories. It adds no reconciliation pass, tracker write, configuration key, or run-ledger artefact.

## 1. WHY — Problem and principles

Linear's GitHub integration can treat every bare issue identifier in a PR body as linked work and apply its PR-open transition to each one. A PR that targets one issue but merely cites a sibling can therefore move the sibling to `In Progress`. That corrupts the tracker status used as faff's cross-run claim: finished work can appear reopened, and ready work can be skipped as peer-held.

Two observed incidents establish the failure mode: one left a completed sibling stranded in progress; another caused an unattended run to skip a ready issue as `claimed-by-peer`. The prevention belongs at the single PR-body construction point, before the integration sees the text.

**Human decision carried forward.** The prior design made automatic reconciliation conditional on reading the actor of the regressing state transition. The current Linear `get_issue` response exposes `stateHistory` entries with state and timestamps but no actor. Per the explicit human instruction — "if actor cannot be determined, drop the reconciliation part and just make the docs change" — reconciliation is removed, not degraded to inference from timing or work-product.

**Principles:**

- **Prevent the false signal at its source.** A sibling citation is prose, not a claim. Only the issue the PR targets may retain Linear-recognisable issue syntax in the PR body.
- **Protect human curation.** Without actor provenance, no automation may infer that a backward status transition was integration-authored and restore it. A false restore could overwrite a genuine human reopen.
- **One authoring rule, applied to the whole body.** The final rendered PR body is sanitised after the AC checklist and other generated sections are assembled; sanitising only a hand-written summary would miss identifiers copied from specs, test names, or evidence notes.
- **Mechanise the invariant.** A pure stdin→stdout command owns the closed transformation, and a check mode proves the exact bytes handed to `gh pr create` contain one target reference and no sibling token.
- **Operator configuration is defence in depth.** Documenting Linear's PR-open automation setting helps prevent out-of-band writes, but faff does not mutate workspace settings and must remain safe when the setting stays enabled.

### Current implementation anchors

| Surface | Current fact | Required change |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` → Step 8 | Defines the AC checklist inserted into the PR description | State that checklist/evidence text is included in the whole-body citation-hygiene pass |
| `plugin/skills/faff-graft/SKILL.md` → Step 9b | The sole PR-creation point; currently says only that the body carries the Step 8 checklist | Add the lean target-versus-citation rule immediately at this construction point |
| `plugin/skills/faff/bin/lib/` + CLI dispatcher | Existing dependency-free pure-command pattern | Add `pr-body sanitize\|check` without tracker/network access |
| `test/` | Node test suite and fixture conventions | Add focused fixtures and subprocess tests for the byte-level contract |
| `docs/guide/configuration.md` | Public operator configuration guide; already owns tracker/repository setup | Add a Linear + GitHub integration note near tracker setup, without ticket/ADR references |
| `docs/reference/skill-authoring.md` | Requires runtime prose to be lean, forward-looking, deduplicated, and free of external ticket references | Governs the edits and their verification |

## 2. OUT OF SCOPE

- **Terminal-state reconciliation, restoration, or a `reconcile-check` command.** Actor provenance is unavailable, so the human's prerequisite failed. Extension point: reconsider only if the tracker read surface later provides a trustworthy per-transition actor.
- **Claim-guard inference from branches, PRs, worktrees, commits, or timing.** Absence of visible work does not prove absence of a human claim; coincidence with a citing PR does not establish authorship. Existing claim semantics stay unchanged.
- **A `reconcile.terminal_regression` setting, appetite gate, tidy scan, or wtf bucket.** These belonged to the dropped reconciliation design.
- **Mutating Linear workspace settings.** The guide explains the operator action; faff neither detects nor changes the setting.
- **Rewriting committed specs, ADRs, tracker comments, commit messages, or code comments.** The hazardous integration surface is the PR body. Those source artefacts remain exact and searchable.
- **Changing issue titles, branch names, or the target issue's lifecycle.** The PR target must remain recognisable so normal link/transition/merge behaviour continues.
- **Claiming portability to every tracker/forge pair.** The observed behaviour is Linear + GitHub specific. The authoring rule is harmless elsewhere, but the guide labels its scope honestly.

## 3. WHAT — PR-body citation contract

### Vocabulary

| Term | Meaning |
|---|---|
| Target issue | The one issue passed to this graft/build and named by its branch/title; the PR claims delivery of it |
| Sibling citation | Any other tracker issue identifier included only as context, dependency, provenance, or related work |
| Recognisable identifier | The ASCII tracker-key form the integration matches, such as `FAFF-214` |
| Display-safe citation | The same human-readable key with its ASCII hyphen replaced by U+2011 NON-BREAKING HYPHEN, such as `FAFF‑214`; inside a URL the hyphen is percent-encoded as `%2D` so the destination remains usable without containing the raw token |

### Deterministic command contract

Add a pure command with two closed modes:

```console
faff pr-body sanitize --target <TARGET-ID> < draft.md > safe.md
faff pr-body check --target <TARGET-ID> < safe.md
```

Both modes require a target matching `[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*`; malformed/missing targets or unknown modes exit 2. Input is UTF-8 stdin. `sanitize` writes only the transformed body to stdout and exits 0. `check` writes a compact diagnostic and exits 0 when valid or 1 on a contract violation. Neither mode reads the repository, tracker, network, environment configuration, or filesystem.

`sanitize` applies these ordered rules to the **complete** body:

1. Recognise every ASCII issue token using that grammar, regardless of prefix and including occurrences in prose, inline code, fenced code, Markdown labels, and URL destinations.
2. Outside `http://` / `https://` URL spans, convert every recognised token — target and sibling alike — by replacing the ASCII hyphen with U+2011.
3. Inside URL spans, replace the token's hyphen with the literal characters `%2D`. This preserves navigation while ensuring the raw destination contains no integration token.
4. Remove trailing blank lines, append exactly one blank line and `Closes <TARGET-ID>`, then one final newline. Because all earlier target occurrences were neutralised, the target is recognisable exactly once.

The transform is idempotent: on a second pass, the existing ASCII closing reference is neutralised and the same single closing line is appended. U+2011 and `%2D` forms do not match the input grammar and remain unchanged.

`check` does not transform. It succeeds only when the target occurs exactly once, that occurrence is the complete final non-blank line `Closes <TARGET-ID>`, no other ASCII issue token matching the grammar occurs anywhere, and the input ends with exactly one newline. Failure diagnostics name only the broken rule and offending identifier/count, never body content.

### Step 9b integration

After every body section is composed, write the draft to a temporary file, run `sanitize` into a second file, run `check` against that exact second file, and pass it unchanged to `gh pr create --body-file`. A non-zero sanitize/check exit stops before PR creation and never falls back to the draft. Delete both files after the create attempt. Use quoted paths or argument arrays; never interpolate body bytes into a shell command.

In git-only mode Step 9b remains a no-op: do not compose a PR body, create temporary body files, invoke `pr-body`, or call `gh`.

**Why U+2011 / `%2D`.** U+2011 is visibly hyphen-like and breaks the ASCII token. Percent-encoding preserves URL navigation without retaining the raw key. Markdown escaping or code spans alone are rejected because integrations can scan raw text regardless of presentation.

**Target exception.** The target is intentionally linked and transitioned. A single closing line makes that intent auditable and prevents ordinary prose from becoming an accidental second targeting convention.

### Operator guide addition

Add a short subsection to `docs/guide/configuration.md` under tracker/forge setup:

- Scope it explicitly to repositories using Linear's GitHub integration.
- Explain that PR-open automation may transition issues merely mentioned in a PR body.
- Recommend disabling the team/workspace rule that moves linked issues to `In Progress` when a PR opens when the operator wants faff's explicit claim write to be the sole claim signal.
- State the trade-off: disabling it removes that convenience for manually opened PRs too; merge/link behaviour is configured separately and need not be disabled.
- State that faff still renders non-target issue citations with a non-ASCII hyphen because repository behaviour must not depend on an out-of-band workspace setting.
- Carry no ticket identifiers, incident narrative, or ADR citations, per `faff lint-refs` policy.

## 4. HOW — Editing procedure

1. Add `plugin/skills/faff/bin/lib/pr-body.js` with exported pure `sanitizePrBody` / `checkPrBody` functions, the closed grammar, CLI modes, and `--selftest` parity; register `pr-body` through existing CLI dispatch/help surfaces.
2. Add `test/fixtures/pr-body/{repeated-target,link-destination,multiple-prefixes,no-siblings,code-blocks}.{input,expected}.md` and `test/pr-body.test.mjs`; test pure functions plus subprocess stdin/stdout/exit behaviour. The test also reads the canonical Step 9b block and asserts its git-only guard precedes the sanitizer invocation, so the documented no-op cannot silently disappear.
3. In `plugin/skills/faff-graft/SKILL.md` Step 9b, replace the current body sentence with the draft→sanitize→check→`gh pr create --body-file` sequence. Keep the normative integration at this single point.
4. In Step 8, add only a pointer that the AC checklist is included in Step 9b's whole-body command. Mirror the autonomous summary only by reference to canonical Step 9b.
5. Add the operator subsection to `docs/guide/configuration.md` at the tracker/forge setup locus.
6. Keep added runtime/public prose forward-looking and free of ticket/ADR tags.

### Edge cases

- **Target identifier appears in copied AC text.** Normalise target mentions outside the closing line too; retain one recognisable occurrence in `Closes <TARGET-ID>`.
- **Several sibling prefixes.** Treat every non-target token matching the repository's visible issue-key convention as a sibling, not only the target's prefix. The rule is identity-relative: target versus non-target.
- **Sibling key inside backticks, a code block, command output, or test name.** Still convert it. Formatting is not evidence that the integration ignores raw text.
- **Sibling key inside a Markdown destination URL.** Percent-encode its hyphen as `%2D`; the destination stays navigable while the raw key disappears.
- **No sibling citations.** The closing line remains; the raw-body scan finds only the target and no other change is needed.
- **Git-only mode.** Step 9b is already a no-op because no PR is opened; citation hygiene has no runtime action there.
- **A sibling genuinely delivered by the same PR.** That is a scope/issue-model decision, not a citation exception. The graft has one target; split or explicitly retarget the work instead of making multiple recognisable closing references under this ticket.

### Failure modes and anti-patterns

- A new generated PR-body section bypasses the rule. Prevention: transform only after complete composition and check the exact output file consumed by `gh`.
- An operator leaves Linear automation enabled. The body rule still prevents sibling transitions; the target continues through the intended lifecycle.
- Linear changes its parser to recognise Unicode lookalikes. This spec does not claim an eternal parser guarantee. A recurrence should trigger a new measured representation choice, not silent status restoration.

**Anti-pattern:** preserve a canonical sibling URL unchanged while changing only the visible label. The raw URL still contains the key; percent-encode it.

**Anti-pattern:** add a global text rewrite to specs or repository docs. It damages exact citations on surfaces the integration never treats as a PR claim and broadens the change without safety value.

**Anti-pattern:** revive reconciliation using `actor=unknown` plus a timing fingerprint. That directly contradicts the human decision and leaves the false-restore hazard unresolved.

## 5. Scenarios

```text
Given a graft for target FAFF-900 whose completed AC checklist cites FAFF-19 and FAFF-82
And the AC text also repeats FAFF-900
When Step 9b sanitizes and checks the final PR body
Then its raw body contains exactly one recognisable issue key, "FAFF-900", in "Closes FAFF-900"
And the contextual citations render as "FAFF‑19" and "FAFF‑82"
And the earlier target mention renders as "FAFF‑900"
```

```text
Given `[related](https://linear.app/team/issue/OPS-42/slug)` appears in a body for target FAFF-900
When sanitize runs
Then the destination contains `OPS%2D42`, remains a URL, and contains no `OPS-42`
```

```text
Given a body contains sibling keys FAFF-19, OPS-42 and APP7-3 across prose and fenced code
When sanitize runs
Then every display key uses U+2011 regardless of prefix or Markdown formatting
And check succeeds with only the target ASCII key remaining
```

```text
Given a body contains no sibling key and mentions its target only in prose
When sanitize runs twice
Then both outputs are byte-identical and contain one final `Closes <TARGET-ID>` line
```

```text
Given a git-only graft
When Step 9b is reached
Then no draft/temp body is created, no pr-body command runs, no gh command runs, and the existing no-op is unchanged
```

```text
Given a Linear-backed operator follows the configuration guide
When they disable PR-open status automation
Then the guide makes clear that this is a manual, workspace-level trade-off
And faff still applies citation hygiene rather than trusting the external setting
```

## 6. Design decisions

- **Prevention versus reconciliation. Chosen:** prevention only. The required transition-actor evidence is absent from the current tracker read, so automatic restoration is unsafe and explicitly rejected by the human.
- **Transformation locus. Chosen:** a pure `faff pr-body sanitize|check` command over the complete body at graft Step 9b. This makes the invariant deterministic and covers all copied/generated sections.
- **Sibling representation. Chosen:** U+2011 in display text and `%2D` inside HTTP(S) URLs. Both remove the raw token; URL encoding preserves navigation.
- **Target representation. Chosen:** one exact `Closes <TARGET-ID>` line. It states the sole delivery claim and preserves intended integration behaviour.
- **Configuration posture. Chosen:** recommend disabling Linear's PR-open transition as operator-controlled defence in depth; do not add a faff config key or workspace mutation.
- **Verification posture. Chosen:** committed fixtures, focused pure/subprocess tests, `--selftest`, and existing suite/prose linters. This is deterministic code with no judgement seam, so no eval kind or baseline is warranted.

## 7. DONE — Definition of Done

### PR authoring

- [ ] `faff pr-body sanitize|check --target <ID>` implements the closed grammar, stdin/stdout/exit contract, idempotence, and content-safe diagnostics.
- [ ] Sanitization leaves one target-only closing reference, uses U+2011 for display citations, and `%2D` for issue keys inside HTTP(S) URLs.
- [ ] Step 9b checks the exact sanitized file passed unchanged to `gh pr create --body-file`; command failure stops before PR creation with no unsafe fallback.
- [ ] Step 8 points to Step 9b rather than duplicating the rule; the autonomous summary points back to the canonical step.
- [ ] Git-only behaviour and existing claim/status rules are unchanged.

### Operator documentation

- [ ] `docs/guide/configuration.md` documents the Linear + GitHub PR-open automation risk, the recommended manual setting, its trade-off for manual PRs, and the separation from merge/link behaviour.
- [ ] The guide states that citation hygiene remains active even when the operator disables the automation.
- [ ] New runtime/public prose contains no ticket tag, ADR citation, run ID, or incident narrative.

### Scope and safety

- [ ] No reconciliation code/prose, restore action, claim-guard inference, tidy/wtf scan, config knob, tracker mutation, or run-ledger artefact is added.
- [ ] The implementation does not rewrite specs, ADRs, commit messages, repository source, or tracker content.

### Verification

- [ ] `plugin/skills/faff/bin/faff validate-adapters` passes with no new failure.
- [ ] `plugin/skills/faff/bin/faff lint-refs` passes.
- [ ] `node --test test/pr-body.test.mjs` passes fixtures for repeated target in AC text, sibling in a link destination, multiple prefixes, no siblings/idempotence, inline/fenced code, malformed input, checker failures, and git-only no-op wiring.
- [ ] `plugin/skills/faff/bin/faff pr-body --selftest` passes.
- [ ] `plugin/skills/faff/bin/faff gates run` passes the repository's discovered UNIT/LINT rungs.
- [ ] A source review confirms Step 9b is the one integration locus and downstream mentions are pointers only.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```
