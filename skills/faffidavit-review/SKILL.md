# faffidavit-review

The review-verdict contract — defines the three-valued review signal (`pass` / `fail` / `needs-human`), what each verdict means, the output envelope every reviewer returns, and **validates** a review skill's output against them on demand. A `faffidavit-*` skill: it both *defines* a conformance standard and *checks* conformance, so it's invokable rather than a passive document.

This is the implicit default for the `review_contract` slot. Every reviewer — `faffter-noon-review`, `faffter-dark-adversarial-review`, or any delegated `review` skill (e.g. `gstack:review`) — conforms to it; faff-workit's Step 9 gate reads the verdict from it.

```yaml
planning_skills:
  review_contract: faffidavit-review   # the default — explicit for clarity
```

## Why the contract exists

The `review` slot is the most substitution-exposed slot in faff — it's the one users most want to point at their own reviewer. faff-workit's post-build gate branches on a three-valued signal: ship the PR, iterate the code, or park for a human. If the verdict vocabulary lived inside the default reviewer (`faffter-noon-review`), swapping the reviewer would take the contract with it and faff-workit would have nothing stable to branch on. This contract is the stable boundary: any reviewer in the slot emits this envelope; faff-workit reads it without knowing which reviewer produced it.

## Two faces

- **Define** (reference): the verdict vocabulary, the semantics of each verdict, and the output envelope below. Reviewers read this and conform; faff-workit reads it to branch mechanically.
- **Validate** (invokable): given a reviewer's raw output, return `pass` / `fail` plus violations — a missing or unparseable `signal:` line, an unrecognised verdict word, findings that don't carry a location/action. Invoked when a delegated (third-party) reviewer's output needs adapting to the envelope, or standalone against any review block.

## The verdict vocabulary

A review returns exactly one of three signals:

| Verdict | Meaning | What the caller does |
|---|---|---|
| `pass` | No findings that block. The diff satisfies the spec. | Proceed — raise the PR. |
| `fail` | One or more **fixable** findings. The code can be corrected and re-reviewed. | Iterate: fix, re-test, re-review (bounded by appetite). |
| `needs-human` | A finding that requires **human judgement** the spec didn't anticipate, and that **persists after revert**. | Park. Do not iterate. |

### The revert test (fail vs needs-human)

The line between `fail` and `needs-human` is the revert test: if `git revert` on the merge commit fully undoes the effect, it is **not** `needs-human` — it is `pass` or `fail`. `needs-human` is reserved for effects that persist after revert (irreversible external effects, security-posture changes, product/UX calls the spec is silent on). A reviewer that returns `needs-human` for a merely-buggy diff is non-conforming.

### Tie-break direction

- When in doubt between `pass` and `fail` → `fail`. Iteration is cheap; shipping a bug is not.
- When in doubt between `fail` and `needs-human` → `fail`. Only escalate when the code literally cannot proceed without a human decision.

The contract owns this direction; it does not own *how a reviewer arrives at a verdict* (its passes, depth, and the mapping from its own findings to a verdict are the reviewer's concern).

## Output envelope

Every reviewer returns:

```
signal: pass | fail | needs-human

## Findings

### [category]: [title]
[description — file, line, what's wrong, what to do]
```

- `signal:` is the first line, exactly one of the three words.
- `pass` may carry zero findings; `fail` and `needs-human` must carry at least one.
- Each finding is **specific and actionable**: location + what's wrong + what to do. "This might be a problem" is not a finding.

## Validation

Run when adapting a delegated reviewer's output, or on demand against any review block.

**Checks:**

1. A parseable `signal:` line exists and is exactly one of `pass` / `fail` / `needs-human`.
2. `fail` / `needs-human` carry at least one finding; each finding has a location and an action.
3. No `needs-human` verdict whose sole basis is a revert-reversible defect (revert-test violation), where detectable from the findings.

**Output:**

```
signal: pass | fail

## Violations
### [rule]: [where]
[what's wrong] → [the fix]
```

`pass` when no violation fires. On a malformed verdict that can't be coerced, the safe normalisation is `needs-human` with the raw output attached as a finding — never silently drop to `pass`.

## Rules

- The vocabulary is closed: three verdicts, no more. A reviewer needing a fourth state is misusing the contract — fold it into one of the three.
- The contract defines the verdict and the envelope; it does not define review depth, passes, or quality bar. Those belong to the reviewer in the `review` slot.
- Sequencing (iterate / raise PR / park) belongs to faff-workit, not here. The contract says what each verdict *means*, not what happens next.
- Validation reports or normalises; it never changes the verdict's substance, only its conformance to the envelope.
