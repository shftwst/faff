# A suppressed capture's reason keeps its violations when the kernel name is long (FAFF-1421)

> Spec: faffter-dark-nlspec · 2026-10-28 · interactive · claude-code/unknown · faff 0.43.0 · confidence: high. Full spec on Linear FAFF-1421.

_Revised 2026-10-28, round 4, after spec review round 3 (revise, one architectural minor): `lineSafe`'s class also covers the implicit direction marks U+200E, U+200F and U+061C. Revised in round 3, after spec review round 2 (reject-approach routed to prep: one architectural minor, one infosec minor; the operator chose to fold both). The violation guarantee is now scoped to the violation sets the capture paths can reach, with the reachability fact stated, and `lineSafe`'s character class gains the bidirectional-format controls. Round 2's revision (round 1's architectural minor) made the violation budget a stated, tested ceiling, made the order of the reason's parts a stated decision, and described the whole-reason cap as a size bound._

This spec is for the build agent and human reviewers. It changes how `faff decision-capture` builds the one-line reason for a suppressed capture, so that a long `--kernel` value can no longer push the violation text out of the reason. FAFF-1354 (Done) added that reason. This ticket changes the length bound FAFF-1354's spec chose.

## 1. WHY

**The core change:** the reason is one string, built in a fixed order (event type, then kernel, then rule, then violations) and cut to 1024 UTF-8 bytes from the end. The kernel name comes from the caller and has no length limit, and it sits before the violations. So the kernel is what has to be bounded. If it has its own small byte budget before the string is built, the violations always fit, because the rest of the reason has a known maximum length.

**Problem.** Today a `--kernel` longer than about 860 bytes (or about 440 bytes when all nine violations fire) pushes the violation text out of the reason, which leaves an operator unable to tell why the capture was suppressed. The note's `rules` field still names the rule, so the loss is the diagnosis, not the rule name. This change bounds the kernel to 256 bytes inside the reason and in the note's `kernel` field, and keeps the final 1024-byte cap as a backstop.

**Design principles**

- **The violations take priority over the kernel.** The kernel only identifies the call; the violations are the diagnosis. If something has to be cut, cut the kernel.
- **The note and stderr agree.** The note's `reason` stays byte-for-byte equal to the stderr text after the prefix, as FAFF-1354 promised. The note's `kernel` field is now exactly the kernel text that appears inside that reason.
- **The best-effort-fail contract stays as it is.** Exit code 0, stdout empty, one stderr line, one note. Only the content of the reason and of `kernel` changes.
- **The violation budget is a checked ceiling for the violations a capture can reach.** The violations get whatever the fixed text and the bounded kernel leave: 1024 − 116 − 256 = 652 bytes.
  - All three capture sites check the payload before they append: `record` and the in-kernel capture with `decisionCaptureViolations` (`decision-capture.js:517`, `:584`), and `action` with `decisionCaptureActionViolations` (`:716`). These are hand-kept mirrors of the write core's payload rules. So a payload that reaches the write core passes its payload-schema rule, and the only write-core refusal a capture can meet today is the issue-scoped rule (74 bytes for `decision-capture`, 81 for `decision-capture-action`).
  - A payload-schema refusal is reachable only if the two copies drift apart. The longest set it could produce today is the 474-byte empty-data set.
  - A repository test builds the worst-case reason from that set for both event types and fails if it no longer fits in 652 bytes (a set of exactly 652 bytes fits). Growth of that set, or a mirror drift that exposes it with longer text, shows up in CI.
  - The guarantee does not cover violation messages a future rule might add that echo caller payload values. Such a rule cannot reach a capture while the mirrors agree, and the 1024-byte size bound still holds for it.

**Reference context**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/decision-capture.js` `lineSafe` (:395-409), `bestEffortFail` (:414-424), `reportAppendFailure` (:431-440) | JavaScript | The only code that changes |
| `test/faff-1354-suppressed-capture.test.mjs` :101-116, :198-209 | JavaScript (node:test) | The `lineSafe` unit test (unchanged) and the 2000-byte-kernel test (updated) |
| `effects-reconcile.js:126-133` `sanitizeDetail` | JavaScript | Earlier example of a per-field byte cap; it adds no marker, so it is not reused |

**Scope.** This is a local change to how the degraded-capture reason is built in the decision-capture CLI. No other surface changes.

## 2. OUT OF SCOPE

- **A length limit on `--kernel` at input validation.** Why excluded: refusing long kernels would change what `record` and `action` accept, and the ticket asks only for the diagnosis to survive. Where it would go: the non-empty-string checks at `decision-capture.js:312`, `:365` and `events.js:330`, `:379`.
- **The correlation id built from the kernel on the action verb.** Why excluded: the id is a join key and its bytes must not be cut; it is not part of the suppressed-capture reason. Where it would go: `mintCorrelationId` and the action verb near `decision-capture.js:674`.
- **Bidirectional-control handling in the other sanitisers** (`effects-reconcile.js` `sanitizeDetail`, `finding-id.js`). Why excluded: this ticket owns only `lineSafe`. Where it would go: each sanitiser's character class.
- **Other `bestEffortFail` reasons that contain caller text** (for example the action verb's correlation-id mismatch note, which contains the derived id and so the kernel). Why excluded: they are not the suppressed-capture reason, and the 1024-byte cap still bounds them. Where it would go: each call site of `bestEffortFail`.
- **Editing FAFF-1354's committed spec under `records/specs/`.** Why excluded: committed specs are historical records. This spec supersedes its long-kernel row and scenario.

## 3. WHAT

**Terms**

| Term | Definition |
|---|---|
| Reason | The single string `capture suppressed: <event_type> event for kernel <kernel> refused by the <rule phrase>: <violations>` written to stderr and to the note's `reason` field |
| Kernel budget | The most UTF-8 bytes the kernel may take up inside the reason and in the note's `kernel` field: 256, including the truncation marker |
| Truncation marker | The existing `...[truncated]` string, 14 bytes |

**Constants and signature**

```
CONSTANT REASON_MAX_BYTES = 1024          # unchanged
CONSTANT KERNEL_MAX_BYTES = 256           # new, defined next to REASON_MAX_BYTES
CONSTANT TRUNCATION_MARKER = "...[truncated]"   # unchanged

FUNCTION lineSafe(value, maxBytes = REASON_MAX_BYTES) -> String
  # unchanged behaviour when maxBytes is omitted
  # result has no U+0000-001F, U+007F-009F, U+2028, U+2029,
  #   U+061C, U+200E-200F, U+202A-202E or U+2066-2069
  #   (each run collapses to one space); trimmed
  # IF byte length <= maxBytes: returned as is
  # ELSE: longest code-point-safe prefix of at most (maxBytes - 14) bytes, followed by the marker
  CONSTRAINT byteLength(result) <= maxBytes
```

**Note shape** (degraded-capture note in `.faff/logs/decision-capture.jsonl`; only the `kernel` bound changes):

```
RECORD SuppressedCaptureNote:
  ts, run, note: "degraded-capture"     # unchanged
  reason: String        # line-safe, <= 1024 bytes, equals stderr text after the prefix
  event_type: String    # unchanged
  kernel: String        # line-safe, <= 256 bytes (was <= 1024); equals the kernel text inside reason
  rules: List<String>   # unchanged
```

**Design decisions**

- **The kernel budget value.** The fixed text other than the kernel and violations is at most 116 bytes (action event type, both rules). The longest violation text joins to 474 bytes (nine violations on the CLI path). 116 + 474 = 590, which leaves 434 bytes. Registry kernel names are under 16 bytes.
  **Chosen:** 256 bytes including the marker. In the worst case the reason is at most 116 + 256 + 474 = 846 bytes, which leaves 178 bytes for violation text that does not exist yet. 256 is still far more than any real kernel name needs.
- **How the budget is applied: cut the kernel, or reserve space for the violations.** Reserving space means computing the space the violations need and giving the kernel what is left, which turns a constant into arithmetic.
  **Chosen:** cut the kernel to 256 bytes with the same `lineSafe` logic before building the reason. The rule is one line and easy to read in the output.
- **The marker for a truncated kernel.** **Chosen:** the same `...[truncated]` marker. It is one recognisable marker, and an operator can see the kernel was cut.
- **Bidirectional-format controls in `lineSafe`.** FAFF-1354 left the bidirectional controls out of `lineSafe`, deferring them as a hardening call across every sanitiser, and named `lineSafe`'s character class as the place to add them. The kernel is caller-supplied text that now sits in a fixed-width line, and an override character such as U+202E can make the stderr line and the note display the rule and violations in a misleading order.
  **Chosen:** add every Unicode bidirectional format character to `lineSafe`'s collapse class, so each run of them becomes one space like the other controls: the explicit embeddings and overrides U+202A–202E, the isolates U+2066–2069, and the implicit marks U+200E (left-to-right mark), U+200F (right-to-left mark) and U+061C (Arabic letter mark). `lineSafe` has no callers outside `decision-capture.js` and its test file, so no other sanitiser changes. Hardening the other sanitisers (`sanitizeDetail`, `finding-id.js`) is not part of this ticket.
- **Add a parameter to `lineSafe`, or add a separate helper.** **Chosen:** an optional `maxBytes` parameter that defaults to `REASON_MAX_BYTES`. Existing callers and the `lineSafe` unit test at :101-116 do not change, and the code-point-safe truncation logic stays in one place.
- **Whether the whole-reason `lineSafe` still runs.** **Chosen:** yes. `bestEffortFail` still passes the complete reason through `lineSafe(reason)`, so 1024 bytes stays the final limit on the line's size, including for the generic `journal append failed` reasons. It is a size bound, not a diagnosis guarantee: it cuts from the end, where the violations sit. The guarantee that violations survive comes from the violation-budget test below, which fails when a violation set would no longer fit in 652 bytes.
- **The order of the parts in the reason.** **Chosen:** keep the FAFF-1354 order: event type, kernel, rule phrase, violations. Both properties this spec states depend on it: the kernel sits before the violations, so the whole-reason cap can never cut into the kernel, and the note's `kernel` field always matches the kernel text in the stderr line. A change to the order must revisit both, and the agreement test below fails if it breaks them.
- **Whether the note's `kernel` field uses the same budget.** **Chosen:** yes. The note's `kernel` is the same bounded value placed in the reason, so the note and stderr always show the same kernel text. This narrows FAFF-1354's "note kernel at most 1024 UTF-8 bytes" to at most 256. Every value that meets the new bound also meets the old one, so nothing that relied on the old promise breaks.
- **The action verb and the in-kernel call site.** **Chosen:** no per-call-site change. All three call sites (record :526, in-kernel :589, action :725) go through `reportAppendFailure`, so they all get the bound. For the fixed registry names on the in-kernel path, nothing changes.
- **A `docs/guide/cli.md` change.** **Chosen:** no change. The decision-capture row at :190 says the note names the event type, kernel and rule, which stays true. It states no cap or format, so there is nothing to correct.

## 4. HOW

**The approach.** Bound the kernel once, at the top of the EVENT_SCHEMA branch of `reportAppendFailure`, and use that one value in both the reason and the note.

```
PROCEDURE reportAppendFailure(root, run, e, eventType, kernel):
  1. IF e.code == "EVENT_SCHEMA":
     a. rules = e.rules if a non-empty list, else []
     b. safeKernel = lineSafe(kernel, KERNEL_MAX_BYTES)
     c. reason = "capture suppressed: " + eventType + " event for kernel " + safeKernel
                 + " refused by the " + rulePhrase(rules) + ": " + join(e.violations or [], "; ")
     d. RETURN bestEffortFail(root, run, reason,
                              { event_type: eventType, kernel: safeKernel, rules })
        # bestEffortFail still applies lineSafe(reason) with the 1024 default
  2. ELSE: unchanged generic "journal append failed: <message>" path
```

**Edge cases**

| Input kernel | Kernel inside the reason and note `kernel` | Reason |
|---|---|---|
| `next` (short) | `next` | Unchanged from today |
| Exactly 256 bytes, no control characters | Unchanged, no marker | Contains the kernel in full and all the violations |
| 257 bytes or more (for example 2000 × `k`) | The first 242 bytes + `...[truncated]` = 256 bytes | Contains the full violation text and does not end with the marker |
| Multi-byte characters past the budget (for example 300 × `é`) | Cut on a code-point boundary, no U+FFFD, at most 256 bytes, ends with the marker | Contains the full violations |
| `bad\nkernel` | `bad kernel` | Unchanged from today (FAFF-1354 test at :218-221) |
| `bad` + U+202E + `kernel`, or `bad` + U+200F + `kernel` | `bad kernel` | The direction control is collapsed to a space and never reaches stderr or the note |

The second pass of `lineSafe` over the reason never changes an already bounded kernel. A bounded kernel has no control characters, and it sits before the violations, so a cut from the end can only reach the violations. The violation-budget test keeps that cut from happening for every violation set that exists.

`lineSafe` with an explicit `maxBytes` keeps today's order: collapse control-character runs, trim, then cut to the byte limit. A kernel with leading or trailing whitespace is trimmed before it is measured.

The in-kernel call site passes fixed registry names (`next`, `eligible` and the rest, all under 16 bytes), so the bound never cuts there. The existing FAFF-1354 per-kernel tests already cover that path, and their expectations do not change.

**Anti-pattern:** taking the 256-byte cut from the end of the kernel, or replacing the kernel with a hash. Why: the start of the name is the most recognisable part, and the existing marker convention cuts from the end.

**Anti-pattern:** counting the space the violations need and giving the kernel whatever is left. Why: the kernel's length would then depend on the violations, and the fixed bound in the note's `kernel` field could no longer be stated.

## Scenarios

```
Given capture.decision_kernel is "on" and run "run-1" exists with a prior chain head in events.jsonl
When `faff decision-capture record --run run-1 --issue "" --kernel <2000 × "k">` runs with a valid payload on stdin
Then the exit code is 0 and stdout is empty
And the note's reason contains "type 'decision-capture' is issue-scoped but missing required field 'issue'" in full
And the note's reason does not end with "...[truncated]"
And the note's kernel is 242 × "k" followed by "...[truncated]" (256 bytes)
And the note's reason contains "for kernel " + note.kernel + " refused by the issue-scoped rule"
And the stderr line after the prefix equals the note's reason byte for byte
```

```
Given capture.decision_kernel is "on" and run "run-1" exists with a prior chain head
When `faff decision-capture action --run run-1 --issue "" --kernel <2000 × "k"> --action graft` runs
Then the exit code is 0
And the note's reason contains "type 'decision-capture-action' is issue-scoped but missing required field 'issue'" in full
And the note's kernel is at most 256 bytes and ends with "...[truncated]"
```

- Every suppressed-capture note's `kernel` field MUST be at most 256 UTF-8 bytes, and its `reason` MUST be at most 1024 UTF-8 bytes.

## 5. Design decision rationale

- **How many bytes should the kernel get?** The options were 128, 256 and 434 (everything the worst case leaves). 128 is tight for a descriptive kernel name. 434 leaves no room for violation text added later. **Chosen:** 256. It leaves 178 bytes of headroom over the worst case today.
- **Add a parameter to `lineSafe`, or write a separate helper?** A separate helper would duplicate the code-point-safe loop. **Chosen:** add a `maxBytes` parameter with a default.
- **What should the note's `kernel` field hold?** It could stay at the 1024-byte bound or use the new 256-byte bound. Keeping 1024 means stderr and the note can show different kernel text, which is the gap this ticket names. **Chosen:** the 256-byte value, so both always agree.
- **Is the whole-reason 1024 cap still needed?** Dropping it would remove the only size limit on the line. **Chosen:** keep it as the final size limit. It never reaches the kernel, because it cuts from the end and the kernel comes before the violations, so the note's `kernel` field and the kernel text on stderr still agree.
- **How far does the violation guarantee reach?** It could be claimed for any violation text, or only for what a capture can reach. A general claim would need reserved space, which the next entry rejects. **Chosen:** only what a capture can reach. The payload is checked before append, the only reachable refusal is the issue-scoped rule, and the test pins the largest set a mirror drift could expose.
- **Strip bidirectional controls here, or defer them as FAFF-1354 did?** Deferring keeps every sanitiser consistent, but leaves a caller-supplied override character in a line this ticket is already reshaping. **Chosen:** strip them in `lineSafe` now. It is the only sanitiser this ticket touches, and FAFF-1354 named its class as the place for them.
- **Fixed kernel bound, or reserve space for the violations?** Reserving space would protect the violations unconditionally, but the kernel's length would then depend on the violations and the note's `kernel` field would have no fixed limit. **Chosen:** the fixed 256-byte bound, with the violation budget pinned by a test. It keeps a fixed limit and turns violation growth past 652 bytes into a failing test rather than a lost diagnosis.
- **Should `docs/guide/cli.md` change?** **Chosen:** no. The guide promises no cap or format.

## 6. Open questions and assumptions

- **Open questions:** none.
- **Assumptions:** none outside the repo. Every fact used here was checked on `main` at 484a362f.

## 7. DONE

### From WHY

- [ ] `faff decision-capture record --run run-1 --issue "" --kernel <2000 × "k">` writes a note whose `reason` contains `type 'decision-capture' is issue-scoped but missing required field 'issue'` in full.

### From WHAT (types and interfaces)

- [ ] `lineSafe(value, maxBytes)` returns at most `maxBytes` UTF-8 bytes, cut on a code-point boundary and ending with `...[truncated]` when cut. With `maxBytes` omitted it behaves exactly as before.
- [ ] `KERNEL_MAX_BYTES` is 256 and is defined in `decision-capture.js` next to `REASON_MAX_BYTES`.
- [ ] A suppressed-capture note's `kernel` field is at most 256 UTF-8 bytes, and the reason contains `for kernel <note.kernel> refused by`.

### From HOW (behaviour)

- [ ] With a 2000-byte kernel, the note's `kernel` field is 242 × `k` followed by `...[truncated]`, and the note's `reason` does not end with `...[truncated]`.
- [ ] `faff decision-capture action --run run-1 --issue "" --kernel <2000 × "k"> --action graft` writes a note whose `reason` contains `type 'decision-capture-action' is issue-scoped but missing required field 'issue'` in full and whose `kernel` is at most 256 bytes.
- [ ] Exit code 0, empty stdout, one stderr line, and the stderr text after the prefix equals the note's `reason` byte for byte, unchanged for long kernels.
- [ ] The generic `journal append failed: <message>` path is unchanged.

### From HOW (edge cases)

- [ ] A kernel of exactly 256 single-byte characters appears in full in both the reason and the note's `kernel` field, with no marker.
- [ ] A kernel of 300 × `é` gives a note `kernel` of at most 256 bytes, ending with the marker and containing no U+FFFD.

### Repository tests

- [ ] `test/faff-1354-suppressed-capture.test.mjs:198-209` is updated. It replaces the `reason.endsWith("...[truncated]")` assertion with: the reason contains `ISSUE_LINE` and does not end with the marker, `bytes(note.kernel) <= 256`, and `note.kernel` ends with the marker. It keeps `bytes(note.reason) <= 1024` and the stderr-equals-note assertion.
- [ ] New tests in `test/faff-1354-suppressed-capture.test.mjs` cover the action verb with a 2000-byte kernel, the 256-byte boundary, the multi-byte kernel, and `lineSafe` with an explicit `maxBytes`.
- [ ] A violation-budget test covers `decision-capture` and `decision-capture-action`. For each, it takes the violations the write core returns for an empty issue and no data, and builds the reason through `reportAppendFailure` with both rules and a 2000-byte kernel. It then asserts that the note's `reason` contains every violation in full and does not end with `...[truncated]`. If that violation set grows past 652 bytes, this test fails.
- [ ] `lineSafe` gives `"a b"` for each of these inputs: `a` + U+202E + `b`; `a` + U+2066 + U+2069 + `b`; `a` + U+202A + U+202B + `b`; `a` + U+200E + `b`; `a` + U+200F + `b`; and `a` + U+061C + `b`. A `record` call with `--kernel` set to `bad` + U+200F + `kernel` and an empty `--issue` writes a note whose `kernel` is `bad kernel`, and its stderr line contains none of U+061C, U+200E–200F, U+202A–202E or U+2066–2069.
- [ ] All other FAFF-1354 tests, including the `lineSafe` unit test at :101-116 and the `bad\nkernel` test at :212-222, pass unchanged.

**End-to-end check**

```
1. Set up a scratch repo with capture.decision_kernel = "on" and run "run-1"
2. Run: record --run run-1 --issue "" --kernel <2000 × "k"> with PAYLOAD on stdin
3. Read the last line of .faff/logs/decision-capture.jsonl as note
4. Assert exit 0, empty stdout, note.reason contains ISSUE_LINE,
   bytes(note.kernel) == 256, the stderr text after the prefix == note.reason
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Advisory only; it gates nothing.

### Right-sizing

No issues. The spec covers one concern: the kernel gets its own byte budget inside the suppressed-capture reason, and the note's `kernel` field uses that same bounded value. That is about half a day of work. It is under the 1–3 day guide, but there is nothing to merge it with: its only neighbour, FAFF-1354, is Done. Splitting it would be wrong too, because the reason and the note's `kernel` field have to change together to stay in agreement. The spec keeps the work small. It does not add a limit on `--kernel` at input, does not touch the correlation id, and leaves the other `bestEffortFail` reasons alone.

### Workstream fit

- **What's there.** FAFF-1421 is in the project "Anchor evidence is enforced on a verdict the merge floor can trust". It got there by following FAFF-1354 at filing time, not because that outcome needs it. The change makes the operator's message clearer when a capture is suppressed. Whether a capture is suppressed, and what the merge floor sees, do not change. The note's `rules` field already names the rule, so the gap is only in the diagnosis.
- **Why it matters.** If this ticket counts toward the project's done-bar, a minor diagnostic improvement can keep the project open after its anchor-enforcement work has shipped. It also adds a ticket to the project that sits off its main path. Under this lens, work found during a build goes to Backlog with no project by default.
- **What to do.** Either keep it in the project but treat it as outside the done-bar, or move it to Backlog with no project. Either way, it stays a ticket of its own.

### Dependencies

No issues. The one blocker, FAFF-1354, is Done and merged in PR #1097 (commit 484a362f). The code on `main` matches what the spec cites: `lineSafe`, `bestEffortFail` and `reportAppendFailure` in `plugin/skills/faff/bin/lib/decision-capture.js`. FAFF-1394, the other recent change to this file, is also Done, so no open work is competing for the same code. Nothing in `plugin/` reads the `degraded-capture` note, so lowering the note's `kernel` limit from 1024 to 256 bytes affects no other code. The only thing that has to change with it is the FAFF-1354 test, and the spec already lists it.

### Risk

No issues. Everything is local and known: one optional parameter with a default value, one new constant, and one call site. The best-effort contract stays the same: exit code 0, empty stdout, and one stderr line that matches the note's `reason`. The 1024-byte cap on the whole reason stays as a backstop. The worst case today is 846 bytes, so the violations always fit. There is no new integration or untried approach, and nothing depends on another team, so a de-risking spike would add nothing.

build-tier: complex
spec-review: approve
confidence: high
