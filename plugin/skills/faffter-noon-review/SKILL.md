---
name: faffter-noon-review
description: "Default code review for the `review` slot — a senior-engineer pass over the diff: AC coverage, bugs, scope, human-judgement flags. Returns a review verdict (faff contract review-verdict --describe). Runs via faff-graft, not the user `/` menu."
user-invocable: false
judgement_seam: verdict-revert, verdict-build
---

# faffter-noon-review

The default code review. Faff-graft plays the senior-engineer role — reads the diff, checks AC coverage, scans for bugs, validates scope, and flags decisions that need a human.

This is the implicit default when no `review` slot is configured. Extracted here so it can be referenced, tested, and swapped for a delegated skill (e.g. `gstack:review`) or an alternative faffter-dark review.

```yaml
slots:
  review: faffter-noon-review   # the default — explicit for clarity
```

The verdict vocabulary and its semantics (`faff contract review-verdict --describe`) are **not** defined here — they're the fixed review-verdict contract in the gateway, which also defines the output envelope (the `review_adaptor` slot was retired; this producer emits its verdict as a `faff-contract:review-verdict` block faff-graft parses). This skill is a reviewer: it owns the five passes below and the mapping from its findings to a verdict. It conforms to the contract; it does not define it.

## Why pre-PR

In human-in-the-loop development, review happens either implicitly during pair programming (pre-PR) or as a PR review (post-PR). In an automated pipeline, raising a PR has real costs — CI minutes, potential failed test runs, idle time waiting for infrastructure. Faff runs review **before** the PR is raised: cheaper, faster, catches issues before burning CI time. faff-graft opens the PR (its Step 9b) **only after this review returns `pass`** — identically in interactive and autonomous modes — so review-fix iterations never reach CI (FAFF-185).

Review findings that would have surfaced as PR comments are reported to the **tracker issue** instead (the single canonical findings surface — there is no PR at review time) — no loss of information, just earlier and cheaper feedback. faff-graft owns *how many* such comments: per its **collapse-and-log** policy (Step 9, FAFF-184) the per-pass findings accumulate in `.faff/logs` and only the final verdict lands as a **single** tracker comment — this producer returns findings, it does not itself post a comment per pass.

## When it runs

Invoked by faff-graft Step 9 after the build is complete and local tests pass, **before** the PR is raised. Runs in both interactive and autonomous modes.

## Input

Faff-graft provides:

- The full diff: `git diff main...HEAD`
- The spec (committed to `docs/specs/` on the feature branch)
- The test results (pass/fail, coverage if available)
- The AC checklist from Step 8 (which ACs were auto-verified, which need human)

## Output

A single signal plus findings, in the envelope defined in the gateway Review-verdict contract:

```
signal: <the closed review-verdict vocabulary — faff contract review-verdict --describe>

## Findings

### [category]: [title]
[description]
```

## The five review passes

### 1. AC coverage

Every acceptance criterion in the spec must have a corresponding test reference or observable verification in the diff. Check:

- Does a test file exercise this AC? (grep for AC keywords, assert the behaviour described)
- If not testable (visual, UX, subjective) — is it marked as needing human verification in Step 8?
- Missing coverage for a testable AC → finding (`fail`)

### 2. Obvious bugs

Scan the diff for common defects:

- Unused variables or imports introduced by this diff
- Commented-out code blocks (leftover debugging)
- Uncaught promises / unhandled async errors
- Mismatched async/sync patterns (awaiting non-async, fire-and-forget on something that should be awaited)
- Leftover debug prints (console.log, print(), debugger statements)
- Obvious null/undefined access without guards (where the spec doesn't say "assume non-null")
- Resource opens without corresponding closes on error paths

Any finding here → `fail` (fixable, iterate)

### 3. Scope check

The diff must be within the spec's scope:

- Changes only touch files/modules the spec addresses or that are necessary plumbing for the spec's goals
- No out-of-scope refactors smuggled in (renaming unrelated code, adding unrelated features, "while I'm here" cleanups)
- No dependency additions not mentioned in the spec
- Scope violations → `fail` with recommendation to revert the out-of-scope changes

### 4. Spec fidelity

The implementation matches the spec's intent, not just its letter:

- If the spec says `**Chosen:** X`, the code implements X (not Y with a comment saying "X was too hard")
- If the spec has pseudocode, the implementation follows the same logic (not a shortcut that skips steps)
- If the spec names error handling behaviour, those error paths exist
- Spec divergence → `fail` (either fix the code or update the spec if the divergence is justified)

### 5. Human-judgement flag

Does any decision in the diff require human judgement that the spec didn't anticipate?

- Product/UX calls the spec didn't address (new user-facing copy, visual layout decisions, behaviour when the spec is silent)
- Security posture changes (new auth boundaries, changed permission models, secrets handling)
- Irreversible external effects (messages sent, data deleted, external API calls that can't be undone)
- Spec gap — the implementation had to make a call the spec doesn't cover, and that call is non-trivial

If `git revert` on the merge commit fully undoes the change, it is **not** `needs-human`. Only flag when the effect persists after revert.

Any finding here → `needs-human` (park, don't iterate)

## Verdict rules

This maps *this reviewer's* five passes onto three of the review-verdict contract's four values. The contract's fourth value, `unavailable`, is an availability signal the orchestrator raises on a review-chain outage (FAFF-405) — never something this producer reports about its own run, since a reviewer can't declare its own review chain down. The verdicts' meaning and the revert test (`fail` vs `needs-human`) are part of the fixed review-verdict contract in the gateway, which also defines the envelope this reviewer emits them in.

- Any finding from pass 5 (human-judgement) → the human-judgement verdict
- Any finding from passes 1–4 → the fixable-issues verdict (iterate: fix, re-test, re-review)
- No findings → the approving verdict

## Output

Returns the signal (the closed review-verdict vocabulary — `faff contract review-verdict --describe`) and structured findings to the calling skill. The review does not decide what happens next — sequencing (iterate, raise PR, park) belongs to faff-graft.

## Contract artifact (FAFF-108)

After the prose output above (the `signal:` line and `## Findings`), append **one** fenced code block — tagged `faff-contract:review-verdict`, as the **last** thing in the output — declaring the verdict you just reached, so faff-graft (the consumer) parses it **deterministically** (no LLM re-read of your prose) and pipes it to `faff contract review-verdict`. You authored the verdict and raised each finding, so you declare them directly; the block mirrors the prose, it is not a second source of truth. (Same pattern the `spec` producer adopted for `faff-contract:spec-readiness`.)

````
```faff-contract:review-verdict
{ "signal": "<your verdict — faff contract review-verdict --describe>",
  "findings": [ { "location_present": <bool>, "action_present": <bool> }, ... one per finding you raised ] }
```
````

- **One** block, at the very end. `signal` is the same value as your `signal:` line. `findings` carries one entry per finding you raised, each declaring whether it named a code **location** (`location_present`) and a concrete **action/fix** (`action_present`) — you raised the finding, so you know both directly.
- the approving verdict may carry zero findings; the fixable-issues and human-judgement verdicts carry ≥1 (the contract script enforces this).
- Do **not** include `provenance_present` — that field is spec-specific; the review-verdict extraction is just `{ signal, findings }`.
- The block is machine-only (a human reader can ignore it). **Always emit it** — it is the deterministic path; a present-but-malformed block fails loud downstream (producer breakage), so emit valid JSON matching the shape exactly. (Omitting it falls back to faff-graft reading your prose — the absent-block fallback.)

## Appetite integration

| | low | medium | high (default) | full |
|---|---|---|---|---|
| Scope strictness | Strict — any out-of-scope line is a `fail` | Strict | Allows trivial adjacent cleanups (typo fixes, import sorting in touched files) | Same as high |
| Bug scan depth | Standard | Standard | Standard | Standard |
| Human-judgement threshold | Conservative — lower bar for `needs-human` | Standard | Standard | Standard |
| Review→fix→review iterations before escalation (FAFF-341: materialized by `faff review-iteration-cap`) | 1 | 3 | 5 | 10 |

The defect bar (what counts as a bug / spec-fidelity / correctness finding) does not loosen at any appetite level. The scope-strictness allowance at high/full above is a separate, narrow axis — permission to let trivial adjacent cleanups (typo fixes, import sorting) pass without flagging — not a softening of the defect bar itself. Appetite governs **persistence** — how many fix→review cycles the pipeline attempts before escalating to `needs-human`. At `low`, one failed iteration and it escalates. At `full`, it keeps trying up to 10 passes. This row is the human-readable statement of the policy; `faff review-iteration-cap --appetite <appetite>` is the runtime/machine form `faff-graft`'s Step 9 loop actually consumes (single literal source — FAFF-341), so the two cannot silently drift.

## Rules

- Never pass a diff that introduces a regression in existing tests.
- Never pass a diff that adds dead code (code with no execution path from the feature).
- The review is the diff vs the spec — not the diff vs "what I think good code looks like." If the spec says do X and the code does X correctly, it passes even if you'd have done it differently.
- Findings must be specific and actionable: file, line, what's wrong, what to do. "This might be a problem" is not a finding.
- When in doubt between the fixable-issues verdict and the approving verdict, choose fixable-issues — iteration is cheap, shipping a bug is not.
- When in doubt between the fixable-issues verdict and the human-judgement verdict, choose fixable-issues — only escalate when the code literally cannot proceed without a human decision.
