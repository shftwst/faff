# Spec — FAFF-1066: `review-call.mjs --no-trim` emits a stderr note confirming untrimmed mode

> Spec: faffter-dark-nlspec · 2026-09-20 · autonomous · claude-code/unknown · confidence: high · build-tier: standard. Full spec on Linear FAFF-1066.

This is the buildable spec for FAFF-1066, addressed to the build agent and human reviewers. It is a mechanical observability change to one file, `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`.

## 1. WHY — Problem and Principles

**Load-bearing model.** `review-call.mjs` runs two independent context-reduction passes before dispatching an adversarial-review call: pass 1 is the byte-gated relevance trim (`trimContextFiles`, FAFF-915), pass 2 is the window-targeted trim (FAFF-1039). Every *outcome* of those passes that an operator would want to know about emits a single `[note] …` line on stderr — except the one outcome where the operator explicitly turned trimming off.

**Problem statement.** FAFF-1058 added `--no-trim`, which drives pass 1 to its disabled short-circuit (reason `"disabled"`) and skips pass 2 entirely. The pass-1 note `switch` handles `"disabled"` under `default: break` (no note), and the skipped pass 2 emits nothing, so an operator who set `adversarial.code_review.trim: false` gets zero confirmation in the run output that trimming was actually off. This change emits one confirming note.

**Design principles.**

- **Key the note off the operator's intent, not the pass-1 reason.** `trimReport.reason === "disabled"` is *not* equivalent to `--no-trim`: passing `--context-trim-bytes 0` alone also yields reason `"disabled"`, yet in that case pass 2 (the window-targeted trim) still runs, because a declared context-window overrides `--context-trim-bytes 0` (see the arg-parse comment at review-call.mjs:1476–1484). Keying the note off the `reason` would both fire on the wrong condition and falsely claim "both passes off". The note must gate on the `noTrim` boolean — the single fact that means "both passes are off."
- **Observability only, zero behaviour change.** The note is a human-facing `[note]` line. It changes no exit code, no payload, no chain decision, and no other stderr line.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | The only file changed; `main()` owns the trim passes and their notes |
| `test/adversarial-call.test.mjs`, `test/faff-1058-controllable-trimming.test.mjs` | Node test | Where a `--no-trim`/note assertion belongs, alongside the sibling ticket's trimming tests |

**Scope statement.** A one-line operator-note fix inside the adversarial-review backend caller; it completes the FAFF-1058 `--no-trim` feature's observability.

## 2. OUT OF SCOPE

- **Machine-signal semantics** — Why excluded: the new note is human-facing (`[note] …`), never a line-anchored-equality sentinel like `PRIMARY_SKIP_SIGNAL`/`TRUNCATION_SIGNAL`. Extension point: if a downstream ever needs `--no-trim` as a structured signal, add a dedicated exported constant on its own stderr line (mirror `TRUNCATION_SIGNAL`) — not this change.
- **Any change to trim behaviour** — Why excluded: passes 1 and 2 behave exactly as FAFF-1058 shipped them. Extension point: none; this is note-only.
- **The `--context-trim-bytes 0` (byte-gate-only-off) case** — Why excluded: that is a distinct, partial disable where pass 2 still runs, and the ticket is specifically about `--no-trim`. Extension point: if a note is later wanted for that partial case, it is a separate observability decision keyed off its own condition, not `noTrim`.

## 3. WHAT — Behaviour surface

There are no new types or interfaces. The observable surface is exactly one stderr line, emitted iff `--no-trim` is set:

```
INTERFACE no-trim-note:
  condition:  noTrim === true          # the parsed --no-trim flag; independent of trimReport.reason
  channel:    process.stderr           # consistent with every other [note]
  form:       "[note] …\n"             # single line, matches the existing FAFF-915/1039/1051 note style
  content:    states trimming is DISABLED for this call, BOTH passes off
  count:      exactly one per invocation when noTrim; ZERO when noTrim is false
```

**Design decision — where to gate the note.**

- Option A: extend the pass-1 `switch (trimReport.reason)` to emit on `"disabled"`. Rejected: `"disabled"` also arises from `--context-trim-bytes 0` alone (pass 2 still runs), so it fires on the wrong condition and misstates "both passes off."
- Option B: a dedicated `if (noTrim) { … }` emission in `main()`, independent of the `reason` switch and of the pass-2 window block. Chosen.

**Chosen:** emit the note from a dedicated `noTrim`-gated branch in `main()`, separate from the `trimReport.reason` switch — the only condition that is true exactly when both passes are off.

**Wording** is an audit-trail string, not a contract (the same latitude the existing truncation note takes — "wording is NOT a contract — reword freely"). A suitable form, consistent with the existing notes:

```
[note] FAFF-1058 --no-trim: context trimming disabled for this call (both passes off)
```

## 4. HOW — Behaviour

**Approach.** In `main()`, after `noTrim` is computed (review-call.mjs:2117) and near the existing pass-1 note `switch` (:2124–2137), add a single `noTrim`-gated stderr write. It sits outside the `switch` (so it does not depend on `trimReport.reason`) and outside the pass-2 `if (primaryWindow && !noTrim && …)` block (so it fires even when there is no primary window and pass 2 would not have run anyway).

```
PROCEDURE emit_trim_notes(noTrim, trimReport, ...):
  1. (existing) SWITCH trimReport.reason:
       case "trimmed": emit FAFF-915 note (+ FAFF-1051 zero-hunk advisory); break
       default: break            # unchanged
  2. (new) IF noTrim:
       emit ONE "[note] … --no-trim … disabled … both passes off" line to stderr
  3. (existing) pass-2 window block runs only when primaryWindow && !noTrim && diffKind !== "prose"
```

**Ordering note.** The exact placement relative to the pass-1 `switch` (just before or just after) is immaterial to correctness — under `--no-trim`, pass 1's reason is always `"disabled"`, so the `switch` emits nothing and cannot interleave a competing line. Placing the new branch immediately after the `switch` reads most naturally.

**Edge cases.**

- `--no-trim` with `--diff-kind prose`: `noTrim` is true → the note fires once. Correct: both passes are off regardless of kind.
- `--no-trim` with a declared `--context-window`: pass 2 is skipped by the `!noTrim` guard → the note still fires (it is not gated on `primaryWindow`). Correct.
- `--context-trim-bytes 0` **without** `--no-trim`: `noTrim` is false → the new note does **not** fire, and pass 2 still runs and emits its own note if it trims. Correct — this is the partial-disable case, deliberately excluded.
- No `--no-trim`: `noTrim` false → zero new output; every existing byte on stderr is unchanged.

**Anti-pattern:** gating the note on `trimReport.reason === "disabled"`. Why: `"disabled"` also results from `--context-trim-bytes 0` alone, where pass 2 still runs, so the note would fire on the wrong condition and falsely assert both passes are off.

**Anti-pattern:** emitting the note as a bare sentinel or reusing a machine-signal constant. Why: `fan-out.mjs` matches machine signals by line-anchored equality; a `[note] …` human line is correctly never mistaken for one, and must stay that way.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given review-call.mjs is invoked with --no-trim
When main() runs its trim passes
Then exactly one stderr line matching /^\[note\].*no-?trim/i (stating trimming disabled, both passes off) is emitted
```

## 6. DESIGN DECISION RATIONALE

**Where to gate the confirming note?**
- *Extend the `reason` switch (`"disabled"` case)* — pro: co-located with the other trim notes; con: `"disabled"` conflates `--no-trim` with `--context-trim-bytes 0` (pass 2 still running), firing on the wrong condition and misstating "both passes off."
- *Dedicated `if (noTrim)` branch* — pro: fires exactly when both passes are off; con: one more emission site in `main()` (negligible).
- **Chosen:** dedicated `if (noTrim)` branch — the `noTrim` flag is the only signal that is true precisely when both passes are disabled.

**Is the note a contract string?**
- **Chosen:** no — it is an operator audit line, freely rewordable, matching the existing `[note] …` style; downstream `fan-out.mjs` keys only on line-anchored machine sentinels, which this is not.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** the `noTrim` local (`a.noTrim === true`) at review-call.mjs:2117 is in scope at the chosen emission point in `main()`. Validation: confirm the new branch is placed within `main()` after line 2117 and before dispatch — trivially true at the pass-1 switch site (:2124–2137).

## 8. DONE — Definition of Done

### From WHY
- [ ] With `--no-trim` set, the run output confirms trimming was off (an operator gets the missing confirmation).

### From WHAT / HOW (behaviour)
- [ ] With `--no-trim`, `main()` writes exactly one `[note] …` stderr line stating trimming is disabled for this call (both passes off), in the existing note style.
- [ ] The note is gated on the `noTrim` flag, not on `trimReport.reason`.
- [ ] Without `--no-trim` (including `--context-trim-bytes 0` alone), the note is not emitted and no other stderr output changes.
- [ ] No exit code, payload, or chain decision changes; the change is note-only.

### From SCENARIOS (tests)
- [ ] A test (alongside `test/adversarial-call.test.mjs` / `test/faff-1058-controllable-trimming.test.mjs`) asserts the note appears on stderr under `--no-trim` and is absent without it. The existing tests already capture `main()` stderr with an injected transport (zero real network calls), so this fits the established harness.

**Integration smoke test:**
```
Invoke main() with a minimal backends config + injected transport and --no-trim;
assert stderr contains one line matching the no-trim note; assert exit code equals the no-trim-absent baseline.
```

confidence: high

## Methodology critique

_Methodology: faffter-dark-methodology-agile-delivery_

- **Right-sized? (principle 4)** No issues. A single, indivisible ~sub-day unit — one operator-facing note gated on one existing flag, in one function. Nothing to split; nothing that must always-ship-together to merge.
- **Workstream fit? (principles 1 + 5)** No issues. A cohesive observability follow-up completing FAFF-1058's `--no-trim` feature. It sits correctly project-less in Backlog; no outcome-container is warranted for a lone nit.
- **Deps surfaced? (principle 6)** No issues. The only dependency — FAFF-1058, which added `--no-trim` — is already merged, so there is no open blocker to link; the related-issue links (FAFF-1058/1039/915/1051) are present and honest.
- **Risk profile? (principle 7)** No issues. Note-only, no behaviour change, no novel integration or external dependency. No de-risking spike is warranted; the one bounded `**Assumes:**` (the `noTrim` local is in scope at the emission point) is validated trivially against the cited line.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
