# Design spec: publish the operator-attested bare Claude Code capture (FAFF-1018)

> Spec: faffter-dark-nlspec · 2026-09-07 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1018.

This spec covers FAFF-1018, "Publish the operator-attested bare Claude Code capture for the Commissaire consumer (FAFF-829 bullet 1)". It is written for the build agent that implements the code slice and for the operator who runs the human-in-the-loop capture, plus the human reviewers who gate the PR. It depends on FAFF-360 (the shipped bare-Claude harness), which is merged on `main`.

## 1. WHY, problem and principles

**The load-bearing model.** The shipped verifier already proves everything a machine can prove about a `claude-code-observed` capture: it requires exactly two Stop-shaped hook observations for the run, ordered block then allow, carrying the same `source` and an equal `session_id_sha256`. What it cannot prove is that the two Stop firings came from two real Claude Code turns rather than two hand-crafted Stop-shaped stdins. That single fact is the residual human oracle. This ticket adds one seam to record who vouches for it (`--attested-by`), then has an operator actually run two real turns and sign the result. The machine checks the shape; the operator vouches for the reality.

**Problem statement.** FAFF-360 shipped the harness but only ever exercised it through the deterministic `ci` fixture path, so no real Claude Code session has ever produced a published capture and the `claude-code-observed` branch is unproven end to end. FAFF-829 bullet 1 needs evidence that a real external producer, outside the factory, drove the governed workflow. This ticket produces and publishes that one real, operator-signed capture, and adds the attestation seam the verifier needs to record who signed it.

**Design principles.**

**The attestation is operator-attested by design, never hash-protected.** `demo-result.json` is deliberately excluded from the step-16 and step-16b member re-hash (see `verify-commissaire.mjs` lines 829 and 841). The `attested_by` field lands in that file precisely because its integrity rests on the operator, not on a digest. Do not try to move the field into a hashed member or otherwise "protect" it. Hashing it would falsely imply the tool can vouch for the name; it cannot.

**The source label stays derived from stdin shape, never caller-supplied.** The Stop-hook wrapper derives `claude-code-observed` only from the stdin shape plus a real transcript file plus a matching cwd (lines 120 to 149). `--attested-by` records a human name; it must never influence the `source` label or the `session_id_sha256`. The two are independent: the machine derives the label, the human signs the name.

**Say "ran and inspected", never "watched".** The attestation wording is "ran two real Claude Code turns and inspected the observations". Nobody watches the headless path, so "watched" would overstate what the operator did.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `verification/external-verification/commissaire-bare-claude/verify-commissaire.mjs` | Node (ESM) | The verifier this ticket extends: adds `--attested-by`, writes the field into DemoResult, threads it into the README template |
| `verification/external-verification/commissaire-bare-claude/commissaire-stop-hook.mjs` | Node (ESM) | Unchanged. Derives the `source` label and `session_id_sha256`; the spike question is aimed at its `hasShape` gate |
| `verification/external-verification/commissaire-bare-claude/README.md` | Markdown template | Gains an `@@ATTESTED_BY@@` placeholder and a signed attested line; already references FAFF-1018 and the FAFF-829 mapping |
| `verification/external-verification/scaffold-commissaire-bare-claude.sh` | Bash | Scaffolds a fresh no-remote SUT against the pinned driver checkout; used unchanged by the runbook |
| `test/impure/commissaire-bare-claude.test.mjs` | Node test | Gains a case for the `--attested-by` flag round-trip |
| `verification/external-verification/results/` | Directory | Where the dated capture is published; existing captures set the in-repo-commit precedent |

**Scope statement.** This is the one human-in-the-loop artefact split out of FAFF-360 because a live capture is operator-attested and cannot be a CI-gated acceptance criterion. It unblocks FAFF-829.

## 2. Out of scope

- **Re-deriving the `claude-code-observed` verify logic.** Why excluded: verify step 3 already requires both observations carry `source: "claude-code-observed"`, equal `session_id_sha256`, Stop shape, and block-then-allow (lines 704 to 718). A real capture flows through it unchanged. Extension point: none needed; the branch exists.
- **Hash-protecting the attestation.** Why excluded: the field is operator-attested by design (see principles). Extension point: if a future ticket wants a cryptographic signer identity, that is a new mechanism in the anchor, not a change to `demo-result.json`.
- **Any change to the Stop-hook wrapper's shape derivation.** Why excluded: the spike investigates whether the real `claude -p` Stop stdin satisfies the existing `hasShape` gate; it does not loosen that gate. Extension point: if headless Claude omits a required field, that is a follow-up ticket to record, not a gate to weaken here.
- **Removing the FAFF-1016 temp-copy workaround in `replay.sh`.** Why excluded: tracked in FAFF-1016. Extension point: `replay.sh` step 3.
- **A native Commissaire anchor verb (FAFF-1015) and the doc-drift fixes (FAFF-1017).** Why excluded: both are separately tracked and cited in the README's "Cited gaps". Extension point: their own tickets.

## 3. WHAT, vocabulary, types and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| SUT | The scaffolded system under test: a fresh no-remote git repo with the hand-written Stop hook and the verifier scripts, config-free |
| Driver checkout | A full SuperDomestique checkout at the pinned revision `fd1e9788a44860ee8804bdb775e33fb5dfd3f057`, supplied as `COMMISSAIRE_ROOT` |
| Real turn | One Claude Code assistant turn driven by a real `claude` invocation (headless `claude -p` or interactive), as opposed to the `ci` fixture that feeds the wrapper hand-made stdin |
| Attestation | The operator's signed statement that they ran two real Claude Code turns and inspected the observations |
| Capture | The curated, published evidence bundle under `results/<date>-commissaire-bare-claude/` |

**The `--attested-by` flag.** `parseArgs` already turns any `--x value` into `opts.x` (line 1078), so `--attested-by "Alec Hill"` arrives as `opts["attested-by"]` with no parser change. The name resolution:

```
RESOLVE attested_by:
  IF opts["attested-by"] is a non-empty string  -> use it (after validation)
  ELSE IF stdin is a TTY                          -> prompt interactively, read one line
  ELSE                                            -> leave attested_by unset (null)
```

**Validation of the name** (it flows into two curated authored files, so it must be clean):

```
VALIDATE attested_by(name):
  trim surrounding whitespace
  REJECT (exit 2) if empty after trim
  REJECT (exit 2) if it contains a newline or control character
  REJECT (exit 2) if length > 120
  # curate already scans authored files for secret shapes; a well-formed human name passes
```

**DemoResult field.** The result object built at step 16 (lines 847 to 878) gains one optional field, written only when a name resolved:

```
RECORD DemoResult (delta only):
  ...existing fields...
  attested_by: String?        # present only when the operator supplied a name; absent on the ci path
  source: "ci-fixture" | "claude-code-observed"   # existing, unchanged
  session_id_sha256: String?  # existing, present only when source == claude-code-observed

  CONSTRAINT attested_by is written into demo-result.json, which is EXCLUDED from members[] re-hash
  CONSTRAINT the ci phase produces source == "ci-fixture" and MUST leave attested_by absent/null
```

**README template placeholder.** The template gains `@@ATTESTED_BY@@`, substituted by `writeReadme` (lines 994 to 1000) alongside the existing `@@PINNED_REVISION@@` and `@@RUN_ID@@`:

```
attested line, resolved:
  IF attested_by present:  "Ran and inspected two real Claude Code turns. attested_by: <name>"
  ELSE:                    "Not operator-attested (ci-fixture run); source: ci-fixture"
```

The README's existing bounded-claim prose is preserved verbatim. The signed attested line is added; it does not replace the provenance-label section or the bounded denial claim.

**Design decision, where does `attested_by` come from.** Options: (a) read it from the README template the tool also writes, (b) a `--attested-by` flag with an interactive prompt fallback. Reading a file the tool writes is circular and gives the operator nothing to sign. **Chosen:** the flag plus interactive prompt (b). The operator supplies the name out of band; verify records it. This resolves round-5 open item 2.

## 4. HOW, behaviour

### 4.1 The two halves of the build

The work is two distinct halves, and the spec keeps them separate because only one can be CI-gated.

```
Half (a): the code slice  [machine-verified, gated in the PR]
  - add --attested-by flag + interactive-prompt fallback to verify
  - validate the name; write attested_by into DemoResult when present
  - add @@ATTESTED_BY@@ to the README template + thread it through writeReadme
  - firm up the README FAFF-829 bullet-1 mapping + the signed attested line
  - add an impure test case for the flag round-trip
  - the ci path stays green and leaves attested_by absent

Half (b): the operator-in-the-loop artefact  [operator-attested, NOT gateable]
  - the spike (does headless claude -p emit the full Stop shape, exactly once per turn?)
  - drive two real turns; run verify --attested-by outside the session
  - curate + publish the dated capture under results/
  - replay.sh replays clean from a temp copy
```

Half (a) is ordinary gated code. Half (b) is a runbook the operator executes with a signed attestation as the residual human oracle. This split is the whole reason FAFF-360 carved this ticket out.

### 4.2 The spike, the crux unknown

The verifier's `claude-code-observed` branch has never run against a real session. Two facts are genuinely unknown until measured:

1. Does headless `claude -p --output-format json` fire the Stop hook with the full stdin shape the wrapper needs (`session_id`, `transcript_path`, `cwd`, `stop_hook_active`), with a real transcript file and a cwd that resolves to the SUT root?
2. Does one real turn fire `hooks.Stop` exactly once? The verifier hard-requires exactly two observations for the run (line 706); more than two firings across the two turns fails verify.

**Behaviour summary.** The spike scaffolds a throwaway SUT, wires the Stop hook, runs one real `claude -p` turn, and inspects `hook-observations.jsonl` plus the derived `source`.

```
PROCEDURE spike:
  1. scaffold a throwaway SUT (scaffold-commissaire-bare-claude.sh) against the pinned driver
  2. run: verify-commissaire.mjs prepare   (writes the active-run pointer)
  3. run ONE real turn, e.g.:
       claude -p --output-format json "make a trivial no-op edit, then stop"
     with cwd == SUT root so the Stop hook fires there
  4. read .faff/hook-observations.jsonl for the run_id:
     a. how many observations did this ONE turn produce?
     b. is source == "claude-code-observed" or did it fall back to "ci-fixture"?
     c. if ci-fixture: which of transcript_exists / cwd_matched / hasShape failed?
  5. record the answer; it selects the capture path below
```

**Chosen: spike first, branch on outcome.** The Chosen capture path is not fixed in advance; it is selected by the spike result.

```
BRANCH on spike outcome:
  A. headless emits full Stop shape AND exactly one Stop per turn
     -> scripted two-turn capture:
          claude -p --output-format json "...prepare turn..."      (turn 1)
          claude -p --resume <session_id> "...complete turn..."    (turn 2)
        --resume MUST reuse the same session_id so both observations hash equal
  B. headless does NOT emit the full shape, OR fires Stop unpredictably
     -> interactive two-turn session: the operator drives two real turns in one
        interactive Claude Code session on the SUT, which holds one session_id throughout
```

**The exactly-two invariant.** This resolves round-5 open item 3.

```
PROCEDURE guard_exactly_two:
  after the two turns, before running verify:
    read hook-observations.jsonl filtered to this run_id
    IF the sequence is exactly [block, allow] (two entries)  -> proceed to verify
    ELSE  -> DISCARD this capture and re-run from a fresh scaffolded SUT
             (never hand-edit the observations file; editing it would forge the attestation)
```

**Anti-pattern:** hand-folding or trimming `hook-observations.jsonl` down to two entries when a real turn fired Stop more than once. Why: the file is the machine's record of what actually happened; editing it to satisfy the gate is exactly the forgery the bounded claim already admits a hostile operator could commit, and doing it ourselves destroys the honesty of the attestation. Discard and re-capture instead.

### 4.3 The attestation write path

```
PROCEDURE verify_with_attestation:
  1. operator runs, OUTSIDE the Claude session:
       verify-commissaire.mjs verify --capture <dir> --attested-by "<name>"
  2. verify resolves + validates the name (section 3)
  3. verify runs the existing step-3 checks unchanged:
       exactly two observations, block then allow, source claude-code-observed,
       equal session_id_sha256
  4. at step 16, write attested_by into demo-result.json (excluded from members[] re-hash)
  5. writeReadme substitutes @@ATTESTED_BY@@ into the signed attested line
  6. final curation (step 16c) scans the authored files, attested_by included, for secret shapes
```

### 4.4 PR scope and who publishes the capture

**Chosen: the gated PR carries half (a) plus the runbook; the operator adds the capture commit to the same PR branch.** The code slice and runbook are gated and reviewed. The operator then runs the runbook, produces the real capture, and commits it under `results/<date>-commissaire-bare-claude/` on the same branch. The PR merges once the capture is present and its `replay.sh` runs clean locally. The capture step is operator-attested, not CI-gated; the code slice around it is fully gated. Existing committed captures under `results/` (for example `2026-08-29-l4-p1-link-shortener-faff-499`) set the in-repo precedent, consistent with FAFF-588 (relatedTo: commit external-verification results in-repo).

**Punt:** if the spike lands on branch A (fully scriptable), the whole ticket could instead ship as one autonomous PR including the capture, since the run would be reproducible. Whether to collapse the two commits into one autonomous flow in that case is a human call. **Punt:** collapse-to-one-PR-if-scriptable or keep-operator-commit-split, needs human (decides: product).

### 4.5 Failure modes

- **The failure:** headless `claude -p` never emits `claude-code-observed` (the wrapper falls back to `ci-fixture`), so branch A is impossible. **How you'd know:** spike step 4b reports `source == "ci-fixture"`; step 4c names the missing field. **What it means:** take branch B (interactive). A valid, expected outcome, not a blocker.
- **The failure:** `claude -p --resume` starts a fresh session per turn, so the two observations carry different `session_id` and verify dies at line 716 ("unequal session hashes"). **How you'd know:** verify exits 1 with that message even though two observations exist. **What it means:** the two turns must share one session; use an interactive session (branch B) or confirm `--resume` preserves `session_id` in the spike.
- **The failure:** a real turn fires Stop more than once, so more than two observations accumulate and verify dies at line 706. **How you'd know:** the guard in section 4.2 sees a sequence longer than two. **What it means:** discard and re-capture; if it recurs on every attempt, the harness needs a per-turn fold, which is a follow-up ticket, not a hand-edit.
- **The failure:** the attestation is meaningless because a hostile operator could forge a matching Stop-shaped pair. **How you'd know:** this is known and stated, not discovered. **What it means:** proceed; the README's bounded claim already says the tool does not claim otherwise, and the demo does not overstate it.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Visible scenarios (the code slice, half (a)):

```
Given the verifier is invoked with --attested-by "Alec Hill" on a claude-code-observed run
When verify completes
Then demo-result.json contains attested_by: "Alec Hill"
And the published README's attested line reads "Ran and inspected two real Claude Code turns. attested_by: Alec Hill"
```

```
Given verify is invoked with --attested-by "  " (empty after trim) or a name over 120 chars or containing a newline
When the name is validated
Then verify exits 2 and writes no capture
```

```
Given the ci phase runs end to end (fixture-driven, source ci-fixture)
When verify completes inside ci
Then demo-result.json has source: "ci-fixture" and no attested_by field
And every existing ci assertion still holds
```

- The `attested_by` field is written into `demo-result.json`, which is excluded from `members[]`, so no member digest covers it (asserting the field is not hash-protected).

Holdout scenarios (operator-only, run against the real capture; withheld from the code-slice builder):

## 6. Design decision rationale

**Where does the operator name come from?** Options: read it from the README the tool writes (circular, nothing to sign), or a `--attested-by` flag with interactive-prompt fallback. **Chosen:** the flag plus prompt. The operator supplies the name out of band; the tool records it. `parseArgs` already accepts the flag with no change.

**Should `attested_by` be integrity-hashed?** Options: include it in `members[]` (implies the tool vouches for it), or leave `demo-result.json` excluded from the re-hash as it already is. **Chosen:** leave it excluded. The field is operator-attested by design; hashing would falsely imply machine-verified identity.

**"Watched" vs "ran" in the attestation wording.** **Chosen:** "ran two real Claude Code turns and inspected the observations". Nobody watches the headless path, so "watched" overstates it. Resolves round-5 open item 1.

**Headless-scripted vs interactive capture.** At the time of writing, whether headless `claude -p --output-format json` emits the full Stop stdin shape and fires Stop exactly once per turn is unmeasured. **Chosen:** spike first, then branch. Do not assume the headless path works; measure it, and fall back to interactive if it does not.

**Handling more-than-two Stop firings.** Options: hand-fold the observations to two, or discard and re-capture. **Chosen:** discard and re-capture, never hand-edit. Editing the observations file forges the very thing the attestation vouches for.

**PR scope.** Options: (i) code slice plus runbook gated, operator commits the capture to the same branch; (ii) one autonomous PR including the capture. **Chosen:** (i). The capture cannot be CI-gated, so gate the code and let the operator sign the capture commit. Left open (punted) only for the branch-A case where full scripting might make (ii) viable.

## 7. Open questions and assumptions

**Open questions.**

- **Collapse to one PR if the spike is fully scriptable?** If the spike lands on branch A, the capture becomes reproducible and could ship in one autonomous PR rather than an operator-signed follow-up commit. Human call (decides: product). Non-blocking: (i) always works; this only asks whether to optimise.

**Assumptions.**

- **Assumes:** `claude` is on PATH at `/usr/local/bin/claude` and can run against the scaffolded SUT. Validation: `command -v claude` before the spike; the ticket grounding confirms it is present.
- **Assumes:** the pinned driver checkout at `fd1e9788a44860ee8804bdb775e33fb5dfd3f057` is available as `COMMISSAIRE_ROOT`. Validation: the scaffolder refuses a revision mismatch at preflight (line 246); run `prepare` and confirm no drift error.
- **Assumes:** `claude -p --resume <session_id>` preserves one `session_id` across both turns, so the two observations hash equal. Validation: confirm in the spike; if it does not hold, take the interactive branch. This is the branch-B trigger.
- **Assumes:** a real Claude turn fires `hooks.Stop` exactly once. Validation: the spike counts firings for one turn; if more than one, the guard in section 4.2 catches it and the discard-and-recapture step applies.

## 8. DONE

### From WHAT (types and interfaces)
- [ ] `verify --attested-by "<name>"` is accepted and, on a `claude-code-observed` run, writes `attested_by: "<name>"` into `demo-result.json`.
- [ ] With no `--attested-by` and a TTY, verify prompts interactively and reads one line; with no `--attested-by` and no TTY (the ci path), `attested_by` is left absent.
- [ ] An empty (post-trim), over-120-char, or newline/control-char name causes exit 2 with no capture written.
- [ ] The README template carries `@@ATTESTED_BY@@`; `writeReadme` substitutes it into the signed attested line, which reads "Ran and inspected two real Claude Code turns. attested_by: <name>" when a name is present and the not-attested fallback otherwise.
- [ ] The README's existing bounded denial claim and provenance-label prose are preserved verbatim; the FAFF-829 bullet-1 mapping row is firmed up to reference this ticket's real capture.
- [ ] `attested_by` lands only in `demo-result.json`, which is excluded from `members[]`, so no member digest covers it.

### From HOW (behaviour, code slice)
- [ ] The `ci` phase still exits 0 with `source: "ci-fixture"` and no `attested_by`, and every pre-existing ci assertion still holds.
- [ ] An impure test case in `test/impure/commissaire-bare-claude.test.mjs` drives `--attested-by`, asserts the DemoResult field and the README attested line, and asserts the ci path leaves the field absent.

### From HOW (operator-in-the-loop, attested, not CI-gated)
- [ ] The spike is run and its outcome recorded: whether headless `claude -p --output-format json` yields `source: "claude-code-observed"`, and how many Stop firings one real turn produces. (operator-attested)
- [ ] Two real Claude Code turns are driven (scripted branch A or interactive branch B per the spike), and verify run outside the session confirms exactly two observations, block then allow, `claude-code-observed`, equal `session_id_sha256`. (operator-attested)
- [ ] The operator signs the capture with `--attested-by`, and `verify` records that name in `demo-result.json`. (operator-attested)
- [ ] The dated capture is published under `results/<date>-commissaire-bare-claude/`; `COMMISSAIRE_ROOT=<pinned> sh replay.sh` replays clean (audit verify pass, effects check no escape, bundle verify CLEAN). (operator-attested)

**Integration smoke test.**

```
PROCEDURE smoke:
  1. scaffold a throwaway SUT against the pinned driver
  2. verify-commissaire.mjs prepare
  3. run one real turn:  claude -p --output-format json "trivial no-op edit, then stop"  (cwd = SUT root)
  4. read hook-observations.jsonl: assert one observation for the run_id, and note its source
  5. IF source == claude-code-observed and exactly one firing -> branch A is viable
     ELSE -> branch B (interactive); record which field of hasShape failed
```

confidence: medium

build-tier: complex

spec-review: approve (round 1, faffter-dark-spec-review single-pass; architectural / infosec / QA all clear; build notes: substitute @@ATTESTED_BY@@ last and treat as literal; name a covering test for the TTY-prompt fallback)

```faff-contract:spec-readiness
{ "confidence": "medium", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "assumes" } ] }
```
