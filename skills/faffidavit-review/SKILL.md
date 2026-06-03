---
name: faffidavit-review
description: "Default `review_adaptor` — translates a reviewer's native output into the fixed pass/fail/needs-human verdict envelope and validates conformance. Swap to adapt a third-party reviewer. Invokable standalone."
---

# faffidavit-review

The default **adaptor** for the `review_adaptor` slot. It translates a reviewer's native output into faff-core's fixed review-verdict contract — the output envelope every reviewer returns, the parsing/normalisation of raw output into the three fixed states — and **validates** conformance on demand. A `faffidavit-*` skill: it both *defines* its dialect and *checks* conformance, so it's invokable rather than a passive document.

```yaml
slots:
  review_adaptor: faffidavit-review   # the default — explicit for clarity
```

## Internal contract (fixed — see gateway)

The review-verdict contract itself is a faff-core invariant and lives in the gateway (_Core contracts and adaptor slots → Review verdict_), **not** here. Fixed there, and unaffected by swapping this slot:

- the three verdict states — `pass` / `fail` / `needs-human` — and their semantics,
- the **revert test** that separates `fail` from `needs-human`,
- the coercion rule (a malformed/unparseable verdict normalises to `needs-human`, never silently to `pass`), and
- faff-graft's proceed / iterate / park branch on those three states.

This skill does not get to change any of that. What it owns is the *envelope and translation* — how a reviewer's native output is shaped and parsed into those fixed states. That is what makes the slot swappable: a third-party reviewer plugs in behind a different adaptor, and faff-graft still branches on the same three states.

**How this contract reaches you.** The fixed definition is loaded by the invoking consumer (`/faff-graft` reads the gateway on entry), so when you run as the `review_adaptor` slot it is already in context. If you are invoked **standalone** (normalising a review block on demand), **Read `~/.claude/skills/faff/SKILL.md` → _Core contracts and adaptor slots → Review verdict_ now** before mapping. Refer back to it; the recap below is non-normative and the gateway wins on any conflict.

## The three states (non-normative recap for translation)

The adaptor must map every reviewer's output onto exactly one of these. The authoritative definition is the gateway's; this table recaps it so the mapping is unambiguous (gateway wins on any conflict):

| Verdict | Meaning | What the caller does |
|---|---|---|
| `pass` | No findings that block. The diff satisfies the spec. | Proceed — raise the PR. |
| `fail` | One or more **fixable** findings. The code can be corrected and re-reviewed. | Iterate: fix, re-test, re-review (bounded by appetite). |
| `needs-human` | A finding requiring **human judgement** the spec didn't anticipate, that **persists after revert**. | Park. Do not iterate. |

Tie-break direction (also fixed in the gateway): in doubt between `pass`/`fail` → `fail`; in doubt between `fail`/`needs-human` → `fail`. This adaptor preserves that direction when normalising; it never relaxes it.

## Adaptor (this skill's dialect)

The envelope every reviewer in this slot returns:

```
signal: pass | fail | needs-human

## Findings

### [category]: [title]
[description — file, line, what's wrong, what to do]
```

- `signal:` is the first line, exactly one of the three words.
- `pass` may carry zero findings; `fail` and `needs-human` must carry at least one.
- Each finding is **specific and actionable**: location + what's wrong + what to do. "This might be a problem" is not a finding.

When a delegated (third-party) reviewer emits something other than this envelope, the adaptor's translation job is to map its native output onto a `signal:` line + findings — picking the state that honours the fixed semantics and tie-break direction above.

## Validate

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

- The vocabulary is closed at three states — that closure is fixed in the gateway, not here. A reviewer needing a fourth state is misusing the contract; fold it into one of the three.
- This adaptor owns the envelope and the translation; it does not own review depth, passes, or the quality bar (those belong to the reviewer in the `review` slot), nor the verdict semantics or sequencing (those are fixed in the gateway / owned by faff-graft).
- Validation reports or normalises; it never changes a verdict's substance, only its conformance to the envelope.
