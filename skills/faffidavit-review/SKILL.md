---
name: faffidavit-review
description: "Default `review_adaptor` — translates a reviewer's native output into the fixed pass/fail/needs-human verdict envelope and validates conformance. Swap to adapt a third-party reviewer. Runs as a configured slot, not the user `/` menu."
user-invocable: false
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

**How this contract reaches you.** The fixed definition is loaded by the invoking consumer (`/faff-graft` reads the gateway on entry), so when you run as the `review_adaptor` slot it is already in context. If you are invoked **standalone** (normalising a review block on demand), **Read the sibling `faff/SKILL.md` → _Core contracts and adaptor slots → Review verdict_ now** before mapping. Refer back to it; the recap below is non-normative and the gateway wins on any conflict.

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

## Validate — wired to the contract script (FAFF-78)

Validation is **conformance by construction** (FAFF-21): this adaptor does **not** prose-check the envelope. It **extracts** the reviewer's output into a structured candidate, hands that to the deterministic **contract script**, and returns the script's output. **The contract script `faff contract review-verdict` is the sole source of contract data** — this adaptor never builds the contract data itself, never decides `conformant` / `violations`. That delegation is what `faff validate-adapters` checks (the wiring-check).

**The split (the translation seam):**

- **This adaptor (extraction — the translation judgement):** read the reviewer's native output into an **extraction JSON** —
  ```
  { "signal": "<verbatim pass|fail|needs-human, or whatever the reviewer emitted>",
    "findings": [ { "location_present": <bool>, "action_present": <bool> }, ... ] }
  ```
  Mapping a third-party reviewer's native output onto a candidate `signal` + per-finding location/action presence is the adaptor's job.
- **The contract script (all conformance computation — deterministic):** validates `signal` against the closed enum and, when it isn't one of the three, **coerces to `needs-human`** (never `pass` — the safe target, FAFF-76 Decision 3); flags `fail`/`needs-human` with no findings, and any finding missing a location or action; emits the canonical contract data. It **fails loud** only on an unparseable extraction (an un-readable verdict still coerces to `needs-human`, never a phantom `pass`).

**Invocation + signal mapping:**

```
echo '<extraction JSON>' | faff contract review-verdict
```

| Script exit | Meaning |
|---|---|
| 0 | conformant: `conformant:true`, `violations:[]` (the script's stdout) |
| 1 | non-conformant verdict (incl. a coerced `signal`): `violations` name the cause |
| 2 | fail-loud: the extraction is unparseable / not an object |

The contract data the caller branches on is **the script's stdout, verbatim**. The revert test and what each verdict *means* for the merge gate are **gateway semantics**, not the script's.

## Rules

- The vocabulary is closed at three states — that closure is fixed in the gateway, not here. A reviewer needing a fourth state is misusing the contract; fold it into one of the three.
- This adaptor owns the envelope and the translation; it does not own review depth, passes, or the quality bar (those belong to the reviewer in the `review` slot), nor the verdict semantics or sequencing (those are fixed in the gateway / owned by faff-graft).
- Validation reports or normalises; it never changes a verdict's substance, only its conformance to the envelope.
