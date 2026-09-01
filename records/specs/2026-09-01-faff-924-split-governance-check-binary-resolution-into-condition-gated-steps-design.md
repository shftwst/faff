# Split governance-check binary resolution into condition-gated steps

> Spec: faffter-dark-nlspec · 2026-09-01 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-924.

This spec targets **FAFF-924**. Audience: the build agent implementing the change, and the human reviewer confirming it. It rewrites the `Resolve faff binary` step of the `faff governance-check` composite action so a dormant error line in an untaken branch can no longer masquerade as real runtime output in the job log. It is a pure diagnosability fix — governance semantics are unchanged.

## 1. WHY — Problem and Principles

**Load-bearing model.** GitHub Actions prints the entire `run:` script of a step as a `##[group]Run …` source preview *before* executing it. A single inline shell `if/else` therefore echoes **both** branches' source — including the untaken branch's `echo "::error::…"` line — into the log as literal text. A reader scanning raw logs sees an `::error::`-shaped line even when the in-checkout binary resolved cleanly. Splitting the branches into separate steps gated by a step-level `if:` fixes this: a step whose `if:` is false is *completely silent* (no `##[group]Run` header, no script source, no error line), so the untaken branch's error text never appears.

**Problem statement.** The current `resolve-binary` step (`.github/actions/governance-check/action.yml`, lines 82–105) packs the checkout-success and fetch/fault branches into one inline block, so a fetch-branch `::error::` shows in the log source preview even on the success path. This confuses log diagnosis (FAFF-913's investigation chased exactly this phantom and found no real resolution failure). This change splits the block into a boolean probe plus two mutually-exclusive gated steps so only the branch that actually ran emits any text.

**Design principles.**

- **Preserve existing resolution semantics exactly.** Checkout-first precedence, the genuine setup-fault message strings, and non-zero exit on real faults must be byte-for-byte unchanged. This is a refactor of *where* text is emitted, never *what* is resolved.
- **Branch on an explicit boolean, never on stringified emptiness.** The probe emits a dedicated boolean output; gating steps compare it to `'true'`/`'false'`. This follows the file's own established convention (see Reference context) rather than inventing a new one.
- **Silence by skipping, not by suppression.** The untaken branch stays out of the log because its step is `if:`-skipped, not because output is redirected or swallowed. Any approach that keeps both branches in one executed step defeats the fix.

**Reference context.**

| System | Location | Relevance |
|---|---|---|
| `resolve-binary` step | `action.yml` L82–105 | The combined block being replaced |
| `discover` step's `found=true\|false` output | `action.yml` L131–136 | Established boolean-output convention the probe copies |
| `verdict` action output | `action.yml` L76 | Established `stepA.out \|\| stepB.out \|\| stepC.out` selection idiom across mutually-exclusive `if:`-gated steps — the exact pattern the consumers will use |
| Two `BIN=` consumers | `action.yml` L151 (`discover-anchors`), L241 (`governance-check`) | Read the resolved binary path; must select from whichever branch ran |
| `test/faff-363-governance-check.test.mjs` | node:test | Existing test file; exercises the CLI verb, does not assert `action.yml` structure today |

**Scope statement.** This is one step-group inside one composite action; nothing about the governance-check CLI verb, its arguments, or its verdict changes.

## 2. OUT OF SCOPE

- **Binary-resolution hardening / retry / integrity checks** — explicitly excluded by the issue. Extension point: a future hardening issue would extend the `fetch-pinned` step.
- **A default `faff-version` pin** — excluded. The no-pin setup fault remains a genuine fault, unchanged. Extension point: `inputs.faff-version` default in `action.yml`.
- **Annotation rendering / `::error::` renderer changes** — stays in FAFF-913. Extension point: the renderer/docs half tracked there.
- **The sibling `faff-landing-comment` action** — `.github/actions/faff-landing-comment/action.yml` has the same combined-block pattern with its own `resolve-binary` step, but FAFF-924 is scoped to `governance-check`. Extension point: a follow-up could apply the identical split there; do **not** touch it here.

## 3. WHAT — Structure and Interfaces

**Vocabulary.**

| Term | Meaning |
|---|---|
| probe | The unconditional boolean step (`check-binary`) that only tests presence and emits a boolean; never fetches or errors |
| in-checkout path | Resolution branch where `inputs.faff-binary` exists at checkout — success, silent-normal |
| fetch-pinned path | Resolution branch where no in-checkout binary exists; fetches by `inputs.faff-version`, or faults if unpinned/unreachable |
| selection expression | The GHA `\|\|` expression the consumers use to read the bin output of whichever branch ran |

**Three-step replacement of `resolve-binary`.** The single step becomes three steps, in order:

```
STEP check-binary  (id: check-binary)          # runs always, no if:
  in: inputs.faff-binary
  emits: in-checkout = "true" | "false"        # boolean output, no bin, no error, no fetch

STEP use-in-checkout  (id: use-in-checkout)
  if: steps.check-binary.outputs.in-checkout == 'true'
  emits: bin = <inputs.faff-binary>            # the success message + chmod live here

STEP fetch-pinned  (id: fetch-pinned)
  if: steps.check-binary.outputs.in-checkout == 'false'
  emits: bin = <fetched temp path>             # holds BOTH setup-fault ::error::+exit1 lines and the fetch
```

**Probe output name.** Use `in-checkout` (hyphenated output keys are valid GHA — cf. `actions/cache`'s `cache-hit`). The literal token is a builder detail; the invariant is that it is an explicit `true`/`false` boolean output, mirroring the `found=` convention, not a comparison of whether a multiline value stringifies to empty.

**Consumer selection interface.** Both consumers change their `BIN=` assignment from `${{ steps.resolve-binary.outputs.bin }}` to the selection expression:

```
BIN="${{ steps.use-in-checkout.outputs.bin || steps.fetch-pinned.outputs.bin }}"
```

A skipped step's `outputs.bin` is the empty string (falsy) in a GHA expression, so `||` yields the bin of whichever branch ran. This is the same idiom the `verdict` output already uses at L76.

**Retire the old id.** No step keeps id `resolve-binary`. After this change, `steps.resolve-binary.outputs.bin` must not appear anywhere in `governance-check/action.yml`.

**Preserved message strings (verbatim — do not reword).**

- Success (in `use-in-checkout`): `faff governance-check: using in-checkout binary: $BIN`
- Fetch notice (in `fetch-pinned`): `faff governance-check: no in-checkout binary at ${{ inputs.faff-binary }} — fetching pinned ref from $URL`
- No-pin fault (in `fetch-pinned`): `::error::faff governance-check: setup fault — no in-checkout binary at $BIN and no faff-version pinned to fetch one (pin a commit sha, preferably, or a tag)`
- Fetch-fail fault (in `fetch-pinned`): `::error::faff governance-check: setup fault — failed to fetch the faff binary from $URL (faff-version=${{ inputs.faff-version }})`

In `fetch-pinned`, `$BIN` in the no-pin message must still be `inputs.faff-binary` (as in the current code) at the point the message is emitted, before any reassignment to the temp path.

**Design decisions.**

**Chosen:** Path A — a step-level `if:`-gated three-step split. The human spike (Resolution comment, 2026-08-30) read a raw scratch-branch job log and empirically confirmed the two behaviours this fix turns on: an `if:`-skipped step is completely silent (no group header, no source, no error), whereas an inline `if/else` echoes its whole `run:` source including the untaken `::error::`. Path B (extracting the logic to an external script) was considered and rejected — it is not needed once the split makes the untaken branch a skipped step, and it would add a new file and indirection for no diagnostic gain. The prior two parks were solely on this now-resolved empirical fork; it is closed.

**Chosen:** explicit boolean probe output (`in-checkout=true|false`), not empty-string branching. The file already emits `found=true|false` (L131–136) precisely to avoid relying on whether a multiline value compares equal to `''` in an `if:` expression. The probe follows that convention rather than gating on `steps.check-binary.outputs.bin == ''`. Rejected: reusing a single value output and testing emptiness — the file's own comment documents why that is ambiguous.

**Chosen:** `||` selection expression across the two branch outputs. Rejected: re-probing in each consumer, or funnelling both branches back through a fourth "collector" step — both re-add indirection. The `||` idiom is already the file's pattern for reading from mutually-exclusive gated steps (`verdict`, L76), so consumers stay a one-line change.

**Chosen:** split verification into automated-structural and manual-CI-log. The deterministic parts — the output-selection expression, the step `if:` gating, the retirement of the old id, and the presence/absence of the untaken `::error::` *source* — are testable by reading `action.yml` and asserting structural invariants. Genuinely observing that a skipped step produces no log lines is a property of the GitHub Actions runner, not of our code, so DoD item 4's "verify both paths from raw job logs" is a **manual CI verification**, not an automated unit test. Rejected: attempting to assert runner log behaviour from a unit test — the runner is not in scope of node:test and the human spike already established the runner behaviour.

**Chosen:** text-based structural assertions, no YAML parser dependency. The repo ships no `yaml`/`js-yaml` dependency, and existing tests that inspect YAML files read them as text and match with regex/`includes`. The new structural test reads `action.yml` via `readFileSync` and asserts on its text. Rejected: adding a YAML-parsing dependency for one test — unnecessary and off-convention.

## 4. HOW — Behaviour

**Probe (`check-binary`).** Runs unconditionally. Tests `[ -f "${{ inputs.faff-binary }}" ]` inside an `if` statement (so `set -euo pipefail` does not exit on a false test — same shape as the `found=` writer), and writes exactly one boolean line to `$GITHUB_OUTPUT`. It does not chmod, fetch, echo a resolution message, or emit any `::error::`.

```
PROCEDURE check-binary:
  1. BIN = inputs.faff-binary
  2. IF file exists at BIN:
       write  in-checkout=true   to $GITHUB_OUTPUT
     ELSE:
       write  in-checkout=false  to $GITHUB_OUTPUT
```

**Use-in-checkout (`use-in-checkout`, if in-checkout == 'true').** Owns the success message and the best-effort chmod, then publishes its bin output. Skipped (silent) on the fetch path.

```
PROCEDURE use-in-checkout:
  1. BIN = inputs.faff-binary
  2. echo  "faff governance-check: using in-checkout binary: $BIN"
  3. chmod +x "$BIN" 2>/dev/null || true
  4. write  bin=$BIN  to $GITHUB_OUTPUT
```

**Fetch-pinned (`fetch-pinned`, if in-checkout == 'false').** Owns the entire fetch-or-fault flow — the no-pin fault, the fetch notice, the curl, the fetch-fail fault, the chmod, and its bin output. Skipped (silent) on the in-checkout path — this is the whole point: its `::error::` source lines never enter the log when the binary was present.

```
PROCEDURE fetch-pinned:
  1. BIN = inputs.faff-binary                      # for the no-pin message
  2. IF inputs.faff-version is empty:
       echo "::error::…no in-checkout binary at $BIN and no faff-version pinned…"
       exit 1
  3. BIN = "${RUNNER_TEMP}/faff-governance-check-bin"
  4. URL = raw.githubusercontent.com/shftwst/faff/<faff-version>/plugin/skills/faff/bin/faff
  5. echo "faff governance-check: no in-checkout binary at <faff-binary> — fetching pinned ref from $URL"
  6. IF curl -fsSL "$URL" -o "$BIN" fails:
       echo "::error::…failed to fetch the faff binary from $URL (faff-version=…)"
       exit 1
  7. chmod +x "$BIN"
  8. write  bin=$BIN  to $GITHUB_OUTPUT
```

**Consumers.** In `discover-anchors` (L151) and `governance-check` (L241), replace the `BIN=` right-hand side with the selection expression. No other line in those steps changes; the resolved path flows into `node "$BIN" governance-check …` exactly as before.

**Anti-pattern:** collapsing the probe and `use-in-checkout` into one step "to save a step". Why: the probe must run unconditionally to produce the gate, and `use-in-checkout` must be `if:`-gated so it is skipped (silent) on the fetch path; merging them re-creates a step that runs on both paths.

**Anti-pattern:** keeping a hidden `resolve-binary` alias or leaving one consumer on the old reference. Why: a stale `steps.resolve-binary.outputs.bin` reads empty after the split and silently hands an empty `BIN` to `node`, breaking resolution while looking like a no-op diff.

**Failure modes.**

- **The failure:** GHA does not treat a skipped step's `outputs.bin` as falsy, so the `||` selection returns empty. **How you'd know:** the manual CI run on the in-checkout path shows `node ""` / "cannot find module" instead of resolving. **What it means:** the assumption is wrong — but the `verdict` output (L76) already relies on this exact behaviour across three mutually-exclusive gated steps in this file, so this is a known-good idiom; a failure here would mean a broader regression, not a narrow one. Proceed.
- **The failure:** the runner still prints something for an `if:`-skipped step, so the untaken `::error::` source leaks anyway. **How you'd know:** DoD item 1's raw-log check on the in-checkout path finds `::error::` fetch-branch text. **What it means:** the human spike would be contradicted; abandon Path A and reopen the empirical fork. (Not expected — the spike verified silence directly.)

## Scenarios

```
Given a checkout where inputs.faff-binary exists
When the composite action runs its binary-resolution steps
Then use-in-checkout runs and fetch-pinned is skipped, and the raw job log
     contains no ::error::-prefixed text from the fetch branch
```

```
Given a checkout with no in-checkout binary and inputs.faff-version empty
When the composite action runs its binary-resolution steps
Then check-binary emits in-checkout=false, fetch-pinned runs and emits the
     existing no-pin setup-fault ::error:: line as genuine runtime output, and
     the step exits non-zero
```

```
Given either resolution path completed and published its bin output
When discover-anchors and governance-check read the selection expression
Then both consumers receive the same non-empty binary path the branch resolved,
     and no step references steps.resolve-binary.outputs.bin
```

- The structural invariants (step ids, `if:` gates, selection expression, retired id, verbatim message strings, probe emits no `::error::`/`curl`) are asserted by an automated node:test reading `action.yml` as text.
- The raw-job-log observations in scenarios 1 and 2 (skipped step silent; genuine fault on the no-pin path) are the **manual CI-log verification** of DoD item 4, run once against a scratch branch — not automated.

## 5. DESIGN DECISION RATIONALE

Consolidated from §3 for the build agent (do not re-propose the rejected options):

- **Path A three-step split** over Path B external script — closed by the human spike; Path B adds indirection for no diagnostic gain.
- **Explicit boolean probe output** over empty-string branching — matches the file's `found=` convention (L131–136), which exists specifically to avoid multiline-emptiness comparison ambiguity.
- **`||` selection expression** over re-probing or a collector step — matches the file's `verdict` idiom (L76).
- **Automated-structural + manual-CI-log split** over trying to unit-test runner log behaviour — the silence of a skipped step is a runner property the spike already established.
- **Text-based structural test** over adding a YAML parser — matches repo test convention; no YAML dependency exists.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the one historical fork (Path A vs Path B) is closed by the human spike Resolution.

**Assumptions.**

**Assumes:** the GitHub-hosted runner behaves as the human spike recorded — an `if:`-skipped composite step emits no `##[group]Run` header, source, or `::error::` line, and an executed inline `if/else` echoes its full `run:` source. Validation: this is the manual CI-log verification (DoD item 4); the builder confirms it on a scratch branch by reading the raw job log of both paths, as the spike did. This is an external platform behaviour, hence an assumption rather than a code fact, but it is already empirically confirmed and is the premise the whole approach rests on.

## 7. DONE — Definition of Done

### From WHY / structure
- [ ] The `resolve-binary` step is gone; no `steps.resolve-binary.outputs.bin` reference remains anywhere in `governance-check/action.yml`.
- [ ] Three steps exist in order: `check-binary` (no `if:`), `use-in-checkout` (`if: steps.check-binary.outputs.in-checkout == 'true'`), `fetch-pinned` (`if: … == 'false'`).

### From WHAT (interfaces)
- [ ] `check-binary` emits an explicit boolean output (`in-checkout=true|false`) and contains no `::error::`, no `curl`, no chmod, no `bin=` output.
- [ ] `use-in-checkout` emits the verbatim `using in-checkout binary` message, chmods best-effort, sets `bin=` to `inputs.faff-binary`, and contains no `::error::`.
- [ ] `fetch-pinned` contains both verbatim `::error::` setup-fault lines, each with `exit 1`, the fetch notice, the curl, the chmod, and sets `bin=` to the temp path.
- [ ] Both consumers (`discover-anchors` L151, `governance-check` L241) read `${{ steps.use-in-checkout.outputs.bin || steps.fetch-pinned.outputs.bin }}`.

### From HOW (behaviour) — DoD items 1–3
- [ ] Binary-present path: raw job log contains no `::error::`-prefixed text from the fetch branch (DoD 1 — manual CI-log verification).
- [ ] Binary-absent + no-pin path: the existing no-pin setup-fault `::error::` line is emitted as genuine runtime output and the step exits non-zero (DoD 2 — manual CI-log verification).
- [ ] The selected binary path reaches both downstream consumers unchanged and non-empty (DoD 3).

### From verification — DoD item 4
- [ ] A new automated node:test (e.g. `test/faff-924-*.test.mjs`) reads `governance-check/action.yml` as text and asserts: the retired id is absent; the three step ids and their `if:` gates; the selection expression in both consumers; the probe emits no `::error::`/`curl`; and the two verbatim fault strings live only in `fetch-pinned`. It passes under the repo's standard test runner.
- [ ] Governance semantics are unchanged: the `governance-check` CLI verb, its args, and its verdict are untouched; existing tests (incl. `faff-363-governance-check.test.mjs`) still pass.

**Integration smoke test.**

```
GIVEN the edited action.yml
WHEN the new structural test reads it and the existing suite runs
THEN the structural test passes (all invariants above hold) AND the existing
     governance-check tests still pass — the split is wired and semantics intact.
```

confidence: high
spec-review: approve
build-tier: complex
