# faff prd-checklist — read checklist-PRD stop-conditions into the prd-coverage schema

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: high. Full spec on Linear FAFF-557.

This spec defines `faff prd-checklist`, a new pure CLI command and module (`plugin/skills/faff/bin/lib/prd-checklist.js`) that parses a checklist-style PRD's GFM task-list stop-conditions and emits the **existing** `prd-coverage` contract shape. Audience: the build agent implementing the command, and human reviewers checking the grammar and mapping calls. It is slice 2/3 of FAFF-551 and independent of the queue-state slice; it unblocks FAFF-559 (git-only §8.5 run-done wiring).

## 1. WHY — Problem and Principles

**Load-bearing model.** A checklist PRD is the git-only stand-in for the whole `goal → PRDR → DoD` machinery that tracker mode gets from FAFF-34's evaluator. Each GFM task-list item (`- [ ]` / `- [x]`) is one PRD stop-condition; **a ticked box is the human asserting that condition is done**. `prd-checklist` reads those checkboxes and expresses them in the shape `faff run-done --prd-coverage` already consumes — so the orchestrator can derive a real `prd_satisfied` instead of always passing `--no-prd`.

**Problem statement.** In git-only mode the orchestrator has no machine-readable PRD gate, so `faff run-done` can only receive `--no-prd` and never learns whether the product is done. A checklist-style PRD is machine-parseable; reading it lets the orchestrator pass a real `--prd-coverage` block. This command does that parse-and-emit, reusing the shipped coverage contract with no new schema.

**Design principles.**

- **Never a false `covered`/`satisfied`.** This is the governing safety constraint (it mirrors the whole prd-coverage contract's fail-safe bias). Every ambiguous or unparseable input must degrade to a loud non-zero exit with no block emitted — never to a block asserting the PRD is satisfied. An implementation that emits `satisfied:true` on an empty or non-checklist file is wrong even if otherwise clean.
- **Reuse the schema, add none.** The output MUST validate against the existing `prd-coverage` contract (`plugin/skills/faff/contracts/prd-coverage.schema.json`) and pass `faff contract prd-coverage`. Do not introduce a new schema, a new contract name, or a new validator.
- **Pure CLI.** Filesystem read of the named PRD file only. No tracker, no network, no subprocess, no writes. This mirrors `faff prdr coverage`'s purity.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/contracts/prd-coverage.schema.json` | JSON Schema | The exact output shape to emit and validate against |
| `plugin/skills/faff/bin/lib/contract-defs.js` (`computePrdCoverage`, ~L1252) | Node CJS | The consumer-side validator + the load-bearing invariants the output must satisfy |
| `plugin/skills/faff/bin/lib/prdr.js` (`coverage` action, ~L407) | Node CJS | Producer precedent: pure, belt-and-braces `schemaCheck` before emit, raw JSON to stdout, exit 0 report-only |
| `plugin/skills/faff/bin/lib/run-done.js` (~L149) | Node CJS | The target consumer: reads **only** `.satisfied` from the `--prd-coverage` block |
| `plugin/skills/faff/bin/lib/contract-engine.js` (`schemaCheck`) | Node CJS | Belt-and-braces schema check helper the module reuses |
| `plugin/skills/faff/bin/faff` (require block ~L82, command map ~L242, usage ~L157) | Node CJS | Where the new subcommand is wired |
| `test/prdr.test.mjs` | node:test | Test convention: `spawnSync` against the real `bin/faff`, temp-dir fixtures |

**Scope statement.** This is the parse-and-emit half of FAFF-551's git-only PRD gate; the run-done wiring that consumes its output is FAFF-559.

## 2. OUT OF SCOPE

- **Wiring the output into `run-done` / the orchestrator.** — Excluded: that is FAFF-559's job (this ticket `blocks` it). Extension point: FAFF-559 calls `faff run-done --prd-coverage "$(faff prd-checklist <path>)"`.
- **Changing `faff run-done` or any run-done semantics.** — Excluded: the acceptance criterion requires run-done consume the output unchanged. Extension point: none — run-done already accepts any conformant prd-coverage block.
- **PRDR-based coverage / supersession semantics.** — Excluded: a checklist PRD has no PRDRs; `faff prdr coverage` already owns the PRDR-citation path. Extension point: `prdr.js` `coverage` action.
- **The `completion` DoD-evaluator (FAFF-34) integration.** — Excluded: in checklist mode the checkbox *is* the DoD verdict; there is no separate evaluator to consult. Extension point: `--dod-verdicts` on `faff prdr coverage`.
- **Non-checklist PRD formats (prose PRDs, front-matter goal lists, headings-as-goals).** — Excluded: only GFM task-lists are in scope; anything else degrades loudly. Extension point: a future `faff prd-<format>` sibling command emitting the same schema.
- **Discovering / locating the PRD file.** — Excluded: the caller passes an explicit path. Extension point: the orchestrator (FAFF-559) resolves which file to pass.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Checklist PRD | A markdown PRD whose stop-conditions are expressed as GFM task-list items |
| Task-list item | A line matching a GFM checkbox: list marker + `[ ]`/`[x]`/`[X]` + label |
| Goal | One stop-condition = one task-list item (any nesting depth); the unit of coverage |
| Checked / unchecked | `[x]`/`[X]` = the human asserts this goal is done; `[ ]` = not yet |
| Coverage face | The `covered` / `uncovered_goals` half of prd-coverage — "is this goal tracked at all" |
| Completion face | The `completion.all_met` / `unmet_or_unverified` half — "is this goal actually done" |

**CLI surface.**

```
faff prd-checklist <path>
  <path>   required positional; path to the checklist PRD markdown file.
           Filesystem read only (no network/tracker/writes).

  stdout:  on success, one line of JSON — a prd-coverage block (raw, unfenced),
           byte-shape identical to `faff prdr coverage` output. exit 0.
  stderr:  on any parse/usage failure, a one-line diagnostic naming the fault.
           NO stdout block emitted. exit 2.
```

**Output shape (the existing prd-coverage contract — emit exactly these keys).**

```
RECORD PrdCoverage:               # == plugin/skills/faff/contracts/prd-coverage.schema.json
  covered: Boolean                # coverage face
  uncovered_goals: List<String>   # coverage face; covered ⟺ empty
  satisfied: Boolean              # the roll-up run-done reads via .satisfied
  reason: String                  # non-satisfied MUST carry a non-empty reason
  completion: RECORD:
    all_met: Boolean              # all_met ⟺ unmet_or_unverified empty
    unmet_or_unverified: List<String>
  measure: RECORD (OPTIONAL):     # observability only; run-done ignores it
    total_goals: Integer
    covered_goals: Integer
  conformant: Boolean             # true (producer self-reports clean)
  violations: List<String>        # []

  # additionalProperties:false at every level — emit no other keys.
```

**Design decision — the two-face mapping.** A checkbox carries one bit; prd-coverage has two faces. The checkbox must map onto exactly one so the block stays internally conformant.

**Chosen:** map checkbox state onto the **completion face**, not the coverage face. Every parsed task-list item is a *covered* goal (`covered: true`, `uncovered_goals: []`), and the checkbox is its DoD/completion verdict: `completion.all_met = (all boxes checked)`, `unmet_or_unverified = [labels of unchecked goals]`, `satisfied = all_met`. Rationale: (1) `run-done` reads **only** `.satisfied`, so both candidate mappings yield an identical consumer outcome — the choice is about semantic honesty, not behaviour; (2) a ticked box means *done*, which is the completion concept, whereas "coverage" means *a goal is tracked at all* — every listed checkbox is trivially tracked, so the coverage face is complete by construction; (3) the checkbox is the git-only stand-in for FAFF-34's per-PRDR DoD verdict, which feeds exactly the completion face. The rejected alternative (unchecked → `uncovered_goals`) is documented in §6.

**Design decision — checklist grammar (what counts as a goal).** This is the ticket's explicit open question, settled here — `prd-checklist` is an internal parser within faff's own authority.

**Chosen:** a goal is **any GFM task-list item at any nesting depth** (flatten the whole list tree into a flat goal set). Concretely:

- A goal line matches: optional leading whitespace, a list marker (`-`, `*`, or `+`), whitespace, a checkbox `[ ]` / `[x]` / `[X]`, whitespace, then a non-empty label.
- **Nested task-list items are goals too** (not ignored, not merged into parents). Rationale: this is the fail-safe choice — no unchecked box is ever silently dropped, so the command can never report `satisfied:true` while an unchecked (even deeply nested) stop-condition remains.
- **Section headers** (`#`, `##`, …), **plain non-checkbox list items** (`- foo` without a checkbox), and all other prose are **not** goals — only task-list items count.
- **Lines inside fenced code blocks** (delimited by ``` or `~~~`) are **ignored** — a PRD may show example checklist syntax in a code fence, and those examples must not be parsed as real goals.
- The goal's **label** is the text after the checkbox, trimmed. An empty/whitespace-only label is a malformed goal → degrade loudly (see HOW).

## 4. HOW — Behavior

**Architecture.** A single pure module `plugin/skills/faff/bin/lib/prd-checklist.js` exporting `cmdPrdChecklist(args, ...)` following the existing `cmd*` signature (see `prdr.js` / how `bin/faff` invokes command-map entries). Wired into `bin/faff`: a `require` line (alongside ~L82) and a command-map entry `"prd-checklist": cmdPrdChecklist` (alongside ~L242), plus one usage/help line in the usage block. The module: reads the file → parses task-list items → builds the prd-coverage verdict → `schemaCheck`s it → prints JSON. It reuses `schemaCheck` from `contract-engine.js`; it does **not** reuse `computePrdCoverageVerdict` (that computes coverage from PRDR citations — the wrong input model here) but MUST produce the same schema.

**Behavior summary — parse.** Read the file, walk it line by line tracking code-fence state, collect every task-list item outside fences as a goal with a `checked` flag and a `label`.

```
PROCEDURE parse_checklist(text):
  1. goals := []            # list of { checked: Boolean, label: String }
  2. in_fence := false; fence_marker := null
  3. FOR each line in text.split on newline:
     a. IF line is a code-fence delimiter (``` or ~~~, optionally with info string):
        - IF not in_fence: in_fence := true; fence_marker := the delimiter kind
        - ELSE IF line closes the same fence kind: in_fence := false; fence_marker := null
        - CONTINUE (fence delimiter line is never a goal)
     b. IF in_fence: CONTINUE
     c. Match TASK_ITEM_RE against line:
        TASK_ITEM_RE = ^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$
        - no match: CONTINUE (not a task-list item)
        - match: mark := group 1; raw_label := group 2
          i.  label := raw_label.trim()
          ii. IF label == "": RAISE parse_error("task-list item with empty label")
          iii. checked := (mark == "x" OR mark == "X")
          iv. goals.append({ checked, label })
  4. IF goals is empty: RAISE parse_error("no GFM task-list stop-conditions found — not a checklist PRD")
  5. RETURN goals
```

**Behavior summary — build the verdict.** Every parsed goal is covered; checkbox state drives completion and the roll-up.

```
PROCEDURE build_coverage(goals):
  1. unchecked := [ g.label FOR g IN goals IF not g.checked ]
  2. all_met := (unchecked is empty)
  3. satisfied := all_met                       # covered is always true, so satisfied == all_met
  4. reason := "" IF satisfied
               ELSE "unchecked stop-conditions: " + join(unchecked, "; ")
  5. verdict := {
       covered: true,
       uncovered_goals: [],
       satisfied: satisfied,
       reason: reason,
       completion: { all_met: all_met, unmet_or_unverified: unchecked },
       measure: { total_goals: len(goals), covered_goals: len(goals) },
       conformant: true,
       violations: []
     }
  6. RETURN verdict
```

**Behavior summary — command entry.** Validate args, read the file, parse, build, belt-and-braces schema-check, emit.

```
PROCEDURE cmdPrdChecklist(args):
  1. path := the single positional argument
     - missing/blank: stderr "usage: faff prd-checklist <path>"; RETURN 2
  2. text := read file at path (utf8)
     - read error (ENOENT/EISDIR/unreadable): stderr "cannot read <path>: <msg>"; RETURN 2
  3. TRY goals := parse_checklist(text)
     CATCH parse_error e: stderr "faff prd-checklist: " + e.message; RETURN 2
  4. verdict := build_coverage(goals)
  5. err := schemaCheck(verdict, "prd-coverage")     # belt-and-braces, mirrors prdr coverage
     - err non-null: stderr "faff prd-checklist: " + err; RETURN 2
  6. stdout := JSON.stringify(verdict) + "\n"
  7. RETURN 0
```

**Edge cases.**

- **Empty file / whitespace-only file** → zero goals → parse_error → exit 2. (Critical: prevents a vacuous `all_met:true` → `satisfied:true` false positive.)
- **File with prose/headers but no checkboxes** → zero goals → exit 2 (non-checklist degrades loudly).
- **Malformed checkbox** (`- [y] foo`, `- [] foo`, `-[ ] foo` with no space) → does not match `TASK_ITEM_RE` → not counted as a goal. If that leaves zero goals → exit 2. (A malformed line is simply not a goal; it never becomes a silent checked/unchecked goal.)
- **Checkbox with empty label** (`- [ ]` alone, or trailing whitespace only) → parse_error → exit 2 (an unidentifiable goal is a loud failure, never a silent one).
- **Mixed checked/unchecked** → `covered:true`, `all_met:false`, `unmet_or_unverified` = the unchecked labels, `satisfied:false`, `reason` naming them.
- **All checked** → `satisfied:true`, `reason:""`. (The intended `prd_satisfied` path.)
- **Duplicate labels** → kept as-is (distinct list entries); the schema permits duplicate strings in `unmet_or_unverified`. No dedup — duplicates never collapse a real unchecked condition.
- **Checkbox inside a code fence** → ignored (fence tracking), never a goal.

**Failure modes — how the approach falls over.**

- **The failure:** the completion-face mapping makes `covered` always `true`, so a future consumer that gates on `.covered` (e.g. `faff run-start`, which reads `.covered`) would read this block as coverage-complete regardless of checkbox state. **How you'd know:** a git-only `run-start` path is later wired to consume a checklist-derived block and treats an all-unchecked checklist as `plan/coverage-thin` vs `drain/prd-covered` incorrectly. **What it means:** proceed — `run-start`'s `.covered` is a PRDR/supersession-coverage signal out of scope for FAFF-557/FAFF-559 (whose consumer is `run-done`, which reads only `.satisfied`); if a checklist→run-start path is ever built, it belongs to that future ticket to decide whether the coverage face should reflect checkboxes there. Documented, not silently assumed.
- **The failure:** the fence-tracking or task-item regex is too loose and misclassifies example syntax or prose as goals (over-count), or too strict and drops real conditions (under-count). **How you'd know:** the fixture tests below (fenced-example, header-not-goal, plain-bullet-not-goal, nested-item) fail. **What it means:** narrow the regex / fence handling until the fixtures pass — the grammar in §3 is the contract.

**Anti-pattern:** reusing `computePrdCoverageVerdict` from `contract-defs.js`. Why: it derives coverage from PRDR `prd_goal` citations, which do not exist for a checklist PRD — it would model the wrong thing. Build the verdict directly and validate it with `schemaCheck`.

**Anti-pattern:** emitting a `faff-contract:prd-coverage` **fenced** block or extra keys. Why: the consumer path is `faff run-done --prd-coverage "$(faff prd-checklist …)"` — raw single-line JSON, exactly like `faff prdr coverage`. `additionalProperties:false` rejects extra keys.

**Anti-pattern:** returning exit 0 with a `satisfied:true`-shaped block on an empty or non-checklist file. Why: that is the exact false-`satisfied` the whole design forbids — no goals means degrade loudly (exit 2), never "vacuously done".

## 5. SCENARIOS — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a checklist PRD with 7 task-list conditions, 4 checked and 3 unchecked
When `faff prd-checklist <path>` runs
Then it prints one line of JSON with satisfied:false, covered:true,
     completion.all_met:false, unmet_or_unverified listing the 3 unchecked labels,
     and a non-empty reason; exit 0
```

```
Given a checklist PRD whose task-list conditions are all checked
When `faff prd-checklist <path>` runs
Then it prints satisfied:true, covered:true, completion.all_met:true,
     unmet_or_unverified:[], reason:""; exit 0
And the output piped to `faff run-done --prd-coverage <json>` is accepted
     unchanged and yields prd_satisfied:true
```

- The emitted block MUST pass `faff contract prd-coverage` (schema + invariants) for every non-error input.
- The command MUST perform no network or tracker access and write no files (pure).

## 6. DESIGN DECISION RATIONALE

**Which face of prd-coverage does a checkbox map to?**
- *Completion face (unchecked → `unmet_or_unverified`, covered always true):* semantically honest (ticked = done); coverage is trivially complete for any listed checkbox; matches the git-only stand-in for FAFF-34's DoD verdict.
- *Coverage face (unchecked → `uncovered_goals`, completion always met):* also internally conformant, also yields the same `.satisfied`. Con: conflates "not done" with "not tracked"; a listed-but-unchecked condition *is* tracked, so calling it uncovered is misleading; leaves the completion face vestigial.

**Chosen:** completion face — because `run-done` reads only `.satisfied` (identical outcome either way) so the tiebreaker is semantic accuracy, and a ticked checkbox is a completion assertion, not a coverage one.

**What counts as a goal (checklist grammar)?**
- *Top-level task-list items only (ignore nested):* simpler roll-up, but a nested unchecked condition would be silently dropped → risk of false `satisfied:true`.
- *Every task-list item at any depth (flatten):* no unchecked box ever ignored → fail-safe against false `satisfied`. Con: a deliberately nested "sub-detail" checkbox is counted as a full goal — acceptable, and authors keep stop-conditions flat by convention.
- *Headers / plain bullets as goals:* rejected — too loose, would misread ordinary prose lists as stop-conditions.

**Chosen:** every task-list item at any nesting depth is a goal; headers and non-checkbox bullets are not; fenced code blocks are ignored — the fail-safe reading that best serves "never a false `satisfied`".

**Command name / shape.**
- *`faff prd-checklist <path>` (top-level, positional path):* matches the ticket's named command; parallels the pure `faff prdr coverage` producer.
**Chosen:** `faff prd-checklist <path>`, filesystem-read-only, raw JSON to stdout, exit 2 on any parse/usage failure — the ticket's stated command with the shipped producer's I/O conventions.

**Reuse `computePrdCoverageVerdict` vs. build directly?**
- *Reuse:* wrong input model (PRDR citations); would require faking PRDRs.
**Chosen:** build the verdict object directly and validate via `schemaCheck(verdict, "prd-coverage")` — the same belt-and-braces the `prdr coverage` action uses.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the checklist-grammar question the ticket raised is settled above (`**Chosen:**`), as an internal parser within faff's authority.

**Assumptions.**

- **Assumes:** the `prd-coverage` schema and `faff contract prd-coverage` validator remain as read in the codebase (required keys `covered, uncovered_goals, satisfied, reason, completion, conformant, violations`; optional `measure`; `additionalProperties:false`). *Validate:* before building, re-read `plugin/skills/faff/contracts/prd-coverage.schema.json` and confirm the key set; the belt-and-braces `schemaCheck` will fail loudly at runtime if it has drifted.
- **Assumes:** `faff run-done --prd-coverage` continues to read `.satisfied` and require a conformant prd-coverage object. *Validate:* the all-checked scenario pipes real output through `faff run-done --prd-coverage` and asserts `prd_satisfied:true`.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff prd-checklist <path>` emits a `prd-coverage` block derived from a checklist PRD's checkboxes, letting the orchestrator pass a real `--prd-coverage` (no `--no-prd`) in git-only mode.
- [ ] The command is pure: no tracker, no network, no writes, no subprocess — only a filesystem read of `<path>`.

### From WHAT (types and interfaces)
- [ ] The emitted JSON validates against `plugin/skills/faff/contracts/prd-coverage.schema.json` and passes `faff contract prd-coverage` (schema + invariants), with no keys beyond the schema.
- [ ] `covered:true`, `uncovered_goals:[]` for any successfully parsed checklist; `completion.all_met` and `unmet_or_unverified` reflect checked-vs-unchecked; `satisfied == all_met`; a non-satisfied block carries a non-empty `reason`.
- [ ] Optional `measure.total_goals`/`measure.covered_goals` equal the parsed goal count.

### From WHAT (grammar)
- [ ] A goal is any GFM task-list item (`[-*+] [ ]/[x]/[X] label`) at any nesting depth; headers and non-checkbox bullets are not goals.
- [ ] Task-list lines inside fenced code blocks (``` / ~~~) are ignored.
- [ ] `[x]`/`[X]` = checked, `[ ]` = unchecked; the label is the trimmed text after the checkbox.

### From HOW (behaviour)
- [ ] All conditions checked → `satisfied:true`, `all_met:true`, `unmet_or_unverified:[]`, `reason:""`, exit 0.
- [ ] Some unchecked → `satisfied:false`, `all_met:false`, `unmet_or_unverified` = unchecked labels, non-empty `reason`, exit 0.
- [ ] Output is raw single-line JSON on stdout; accepted unchanged by `faff run-done --prd-coverage`.

### From HOW (edge cases / degrade-loud)
- [ ] Empty / whitespace-only file → exit 2, stderr diagnostic, no stdout block (no false `satisfied`).
- [ ] File with no task-list items (prose/headers only) → exit 2, stderr, no block.
- [ ] Checkbox with empty label → exit 2, stderr, no block.
- [ ] Missing / unreadable / directory path → exit 2, stderr, no block.
- [ ] Malformed checkbox tokens (`[y]`, `[]`, no space after marker) are not counted as goals.

### From WHAT (wiring)
- [ ] `bin/faff` gains the `require` + command-map entry `"prd-checklist"` + one usage/help line; `faff prd-checklist` dispatches to the new module.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Write a temp PRD with 3 task-list items, all `- [x]`.
  2. out := `faff prd-checklist <temp>`   ; assert exit 0, JSON parses, satisfied==true.
  3. `faff run-done --prd-coverage "$out" --queue-empty --ledger-clean`
     ; assert it parses the block and reports prd_satisfied true (no --no-prd needed).
  4. Flip one item to `- [ ]`; re-run step 2 ; assert satisfied==false, reason non-empty.
  5. Write a temp file of prose only ; assert `faff prd-checklist` exits 2, empty stdout.
```

confidence: high
spec-review: approve
