# Design spec — FAFF-1242: bracket the Step-9b "In Review" tracker-write inline so governed-merge conclude stops refusing on `unreconciled-escape`

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high · build-tier: standard. Full spec on Linear FAFF-1242.

This is a design spec for the build agent implementing FAFF-1242, and for the human reviewers who gate it. It addresses an intermittent governance failure in `faff-graft`: a governed graft run records the "In Progress -> In Review" tracker transition as a Commissaire `observe` with no matching `declare`, so governed-merge `conclude` refuses with `unreconciled-escape` until a human appends the declare by hand. The fix is skill-prose only — no Commissaire or CLI code changes. Audience: the build agent (who edits one `SKILL.md` block and adds one test), and reviewers checking the bracket is correct and symmetric with its siblings.

## 1. WHY — Problem and Principles

**Load-bearing model.** Commissaire reconciles a governed run by set-matching every *observed* effect against the *declared* effects for the same `(unit, step)` group; an observed effect with no declare in its group is an `escaped-side-effect`, and `verdict conclude` refuses the signed `conformed_to_contract` record while any escape stands. So every agent-mediated side effect on a governed run must be **bracketed**: `declare` the intent, perform the effect, `observe` the result. The bracket is prose the graft agent executes, not CLI-enforced — if the agent skips the `declare`, nothing stops the effect, but `conclude` later refuses.

**Problem statement.** `faff-graft`'s Step-9b "In Review" transition performs an agent-mediated `save_issue` status write but its block (`PROCEDURE transition_to_in_review`, SKILL.md:575-589) carries no inline `declare`/`observe` bracket — it relies solely on the general *Governed tracker-write record* rule stated ~270 lines earlier at SKILL.md:301. The agent follows the explicit inline brackets around it (anchor-head push at :559, pr-create at :561-565) and intermittently overlooks the distant rule, emitting an `observe` with no `declare`. The change adds an inline governed bracket to the In Review block, citing line 301, so the write is declared where it happens.

**Design principles.**

**One canonical rule, cited not copied.** The binding *Governed tracker-write record* rule stays at SKILL.md:301 and remains the single source of truth; the new inline paragraph is a discoverability pointer carrying the concrete commands for *this* transition and an explicit cross-reference to line 301. Do not restate the full rule (scope, skip conditions, record-only semantics) inline — that would create two copies that drift. This follows the repo skill-authoring standard (say it once, reference it).

**Symmetry with the sibling inline brackets.** The In Review bracket must match the shape and idiom of its Step-9b neighbours — the anchor-head push paragraph (SKILL.md:559) is the closest model: a self-contained `_**Governed … record (on a governed run).**_` paragraph with `declare` before / `observe` after and the record-only + skip-on-ungoverned caveats by reference. The asymmetry (its neighbours inline, it not) is the root cause; the fix removes it.

**Match the existing verb, add none.** The surrounding graft prose uses the `faff effects declare/observe … --step tracker-write` idiom (SKILL.md:301). Reuse it exactly. Do not introduce a new verb, and do not switch this unprotected write to the heavier `faff commissaire effect declare/authorize/observe` producer-half form the pr-create block uses — that form is for protected effects that need a grant.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md:301` | Skill prose | Canonical *Governed tracker-write record* rule; names the Step-9b In Review transition; the inline bracket cites it |
| `plugin/skills/faff-graft/SKILL.md:575-589` | Skill prose | The `transition_to_in_review` block that gains the inline bracket |
| `plugin/skills/faff-graft/SKILL.md:559` | Skill prose | The anchor-head push inline governed bracket — the shape to mirror |
| `plugin/skills/faff/bin/lib/effects.js:74` | JS (committed emit) | `PROTECTED_EFFECT_KINDS = {merge, branch-delete, pr-create}` — tracker-write is unprotected |
| `plugin/skills/faff/bin/lib/effects.js:149` | JS (committed emit) | `computeEscapes` — order-independent `(unit, step)` set match |
| `plugin/skills/faff/bin/lib/commissaire.ts:756` | TypeScript source | `conclude` refuses `unreconciled-escape` on `any_escape` |
| `test/adr-extract-intent.test.mjs` | Node test | Model prose-contract test: reads `SKILL.md`, slices a block by heading, `assert.match`es prose invariants |

**Scope statement.** This sits entirely inside the graft skill's governed Step-9b path; it closes the one unbracketed agent-mediated status write in that path.

## 2. OUT OF SCOPE

- **Any Commissaire / CLI code change** — Why excluded: the rule, the verbs, the escape computation, and the `unreconciled-escape` refusal already exist and behave correctly; the miss is pure prose discoverability. Extension point: none needed — `effects.js` / `commissaire.ts` are untouched.
- **Step 5 "In Progress" claim bracket** — Why excluded: Step 5 (SKILL.md:294) has no inline bracket either, yet both reference runs recorded it correctly, so it is not the failing path; adding an inline bracket there is a separate symmetry call. Extension point: a future ticket could add an inline bracket at Step 5 mirroring this one if a miss is ever observed there.
- **The other line-301-governed transitions** (Step-3 premise-superseded `→ Done`, the two claim-holder `In Progress → Todo` hold releases) — Why excluded: not reported as missing, and FAFF-1242 is scoped to the In Review miss. Extension point: same inline-bracket pattern can be applied per-transition if any is later observed to escape.
- **Converting the record-only tracker-write bracket into a fail-closed precondition** — Why excluded: tracker-write is unprotected and DETECTED-not-prevented by design; escalating enforcement is a governance-model decision beyond this bug. Extension point: `PROTECTED_EFFECT_KINDS` in `effects.js:74` is where protection would be added.
- **A ledger-completeness integration test over a full governed graft run** — Why excluded: graft's Step-9b is agent-executed prose, not a callable function; a full governed-run harness is a larger build. Extension point: the new prose-contract test guards the prose; the CLI round-trip is already covered by `test/effects.test.mjs`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Governed run | A graft run where the governed-run check reports *governed* (a run substrate exists and governance is active); the bracket rules apply only here |
| Bracket | The `declare` (before) + `observe` (after) pair around one agent-mediated side effect on a governed run |
| Escape | An observed effect with no matching declare in its `(unit, step)` group; `computeEscapes` flags it `escaped-side-effect` |
| tracker-write | The effect kind for an agent-mediated `save_issue` status transition; **unprotected** (not in `PROTECTED_EFFECT_KINDS`) |
| Record-only / DETECTED | The bracket records and reconciles; it never blocks the write. A non-zero exit from `declare`/`observe` is logged and the write proceeds |

**The effect descriptor and commands (reuse from SKILL.md:301, unchanged).** The In Review transition declares and observes one tracker-write descriptor:

```
EFFECT_DESCRIPTOR (stdin to declare and observe):
  [ { kind: "tracker-write",
      target: "<ISSUE-XX>:In Progress->In Review",   # the rank transition, from->to
      reversible: true } ]

COMMAND (before the save_issue write):
  faff effects declare  --run "$(basename "$run_dir")" --issue <ISSUE-XX> --step tracker-write   < descriptor

COMMAND (after the save_issue write succeeds):
  faff effects observe  --run "$(basename "$run_dir")" --issue <ISSUE-XX> --step tracker-write   < descriptor
```

Both `faff effects declare/observe` and `faff commissaire effect declare/observe` write the same schema:3 records into the run's `declared-effects.jsonl`. This spec uses the `faff effects …` form to match line 301 and avoid two idioms for one write kind.

**Reconcile semantics (confirm, do not re-derive).** `computeEscapes` (effects.js:149) matches `observed MINUS declared` per `(unit, step)` as a **set** — order-independent — so a `declare` placed before *or* after the `observe` clears the escape, provided both land in the `(ISSUE-XX, tracker-write)` group. `tracker-write` is **not** in `PROTECTED_EFFECT_KINDS` (effects.js:74), so it needs `declare` + `observe` only — **no** `authorize`, **no** signed grant. `conclude` refuses `unreconciled-escape` on `any_escape` (commissaire.ts:756).

**Design decisions.** (Full rationale in §6; markers inline here.)

- Placement: **Chosen:** a self-contained `_**Governed In Review tracker-write record**_` paragraph immediately after the `transition_to_in_review` procedure block, mirroring the anchor-head push paragraph at SKILL.md:559.
- Idiom: **Chosen:** reuse `faff effects declare/observe … --step tracker-write` verbatim from SKILL.md:301 — no new verb, not the `commissaire effect` producer-half form.
- Bracket shape: **Chosen:** `declare` + `observe` only (tracker-write is unprotected) — no `authorize`, no grant.
- Canonical home: **Chosen:** cite the *Governed tracker-write record* rule **by its stable name** (never a bare line number) as the binding source, matching the file's own :299/:301 by-name cross-reference convention; the inline paragraph carries the concrete commands + the by-name cross-reference, not a restatement of the rule's scope/skip semantics.
- Regression guard: **Chosen:** a prose-contract test modelled on `test/adr-extract-intent.test.mjs` that slices the Step-9b In Review block and asserts the inline bracket + line-301 citation.

## 4. HOW — Behavior

**Architecture and approach.** Two edits, both prose-adjacent:

1. Add one inline governed-bracket paragraph to the Step-9b In Review block in `plugin/skills/faff-graft/SKILL.md`, placed after the `transition_to_in_review` PROCEDURE and its closing anti-patterns note (around SKILL.md:587-589), before "Proceed to Step 10." (SKILL.md:591). The paragraph declares the tracker-write before the step-4 `save_issue` write and observes after it, in the SKILL.md:301 idiom, and cites line 301 as the binding rule.
2. Add a prose-contract test asserting the In Review block carries that bracket, so the rule cannot silently fall back out of the 9b block.

**The inline paragraph — behaviour it must prescribe.** A one-sentence summary: on a governed run, bracket the In Review `save_issue` write so observed equals declared and reconcile stays clean.

```
PROCEDURE in_review_governed_bracket(run_dir, issue):   # inline in the Step-9b In Review block
  PRECONDITION the governed-run check reports governed   # else skip the whole bracket
  1. BEFORE the step-4 save_issue write:
       faff effects declare --run "$(basename "$run_dir")" --issue <issue> --step tracker-write
         < [{kind:"tracker-write", target:"<issue>:In Progress->In Review", reversible:true}]
  2. Perform the step-4 agent-mediated save_issue status write (In Progress -> In Review).
  3. AFTER it succeeds:
       faff effects observe --run "$(basename "$run_dir")" --issue <issue> --step tracker-write
         < (the same descriptor)
  NOTE record-only / DETECTED-never-prevented: a non-zero exit from declare or observe is logged;
       the status write still proceeds (never a precondition).
  NOTE skip the whole bracket on an ungoverned run / no run substrate (git-only, no-run-dir path),
       per the SKILL.md:301 rule this cites.
```

**Edge cases and precedence (inherit from the existing In Review procedure, do not change them).** The bracket wraps only the step-4 `ELSE (live status is In Progress) -> save_issue` path. When the procedure no-ops — no In Review-type state (step 2), or live status already In Review/Done (step 3) — **no `save_issue` fires, so neither `declare` nor `observe` fires** and there is nothing to reconcile. The bracket must not emit a `declare` for a write that will not happen (that would itself create a declared-with-no-observe, which is harmless to `computeEscapes` since escapes are observed-minus-declared, but it is noise — declare only on the branch that writes).

**Anti-pattern:** declaring the tracker-write unconditionally at the top of `transition_to_in_review` before the no-op branches are resolved. Why: the no-op branches (steps 2, 3) perform no write; declare only inside the step-4 write branch.

**Anti-pattern:** restating the full SKILL.md:301 rule (its scope list, skip conditions, record-only prose) inline. Why: it creates a second source of truth that drifts; cite line 301 and give only the concrete commands for this transition.

**Anti-pattern:** switching this bracket to `faff commissaire effect declare/authorize/observe` (the pr-create producer-half shape at SKILL.md:563-565). Why: tracker-write is unprotected (effects.js:74); it needs no grant, and the `authorize` step is wrong for it.

**Failure modes.**

- **The failure:** the inline paragraph is added but the agent still skips the `declare` because the paragraph is placed where the agent does not read it (e.g. after "Proceed to Step 10" or detached from the write). **How you'd know:** a governed graft run through Step-9b still shows an In Review `observe` with no `declare` in `declared-effects.jsonl`, and `conclude` still refuses `unreconciled-escape`. **What it means:** placement is wrong — move the paragraph adjacent to the step-4 write (mirroring SKILL.md:559), re-verify on a governed run.
- **The failure:** the prose-contract test asserts on wording so brittle that an innocuous reword of the block breaks CI without a real regression. **How you'd know:** the test fails on a cosmetic edit that still contains the bracket and the line-301 citation. **What it means:** narrow the test to the load-bearing invariants (the `tracker-write` declare/observe verbs, before/after ordering words, a line-301 cross-reference), not exact sentences — the same judgement `adr-extract-intent.test.mjs` uses.

## 5. SCENARIOS — born-verifiable main objectives

**Prose-contract (mechanically testable by the new test):**

```
Given the Step-9b "In Review transition" block of plugin/skills/faff-graft/SKILL.md
When the block is read as text
Then it contains an inline governed bracket that declares a tracker-write BEFORE the save_issue
     write and observes it AFTER, using the `faff effects declare/observe … --step tracker-write`
     idiom, and cites the SKILL.md:301 Governed tracker-write record rule
```

**Governed-run behavioural objective (verified by inspecting a governed graft run's ledger):**

```
Given a governed graft run that reaches Step-9b and performs the In Progress -> In Review save_issue write
When `faff commissaire effect reconcile` runs at governed merge
Then the (issue, tracker-write) group holds a matching declare+observe pair, computeEscapes reports
     no escaped-side-effect for it, and `faff commissaire verdict conclude` signs the
     conformed_to_contract record with no manual declare appended by hand
```

**Non-functional assertions:**

- An **ungoverned** graft run (governed-run check reports not governed, or no run substrate / git-only) performs the In Review transition **byte-identically to today** — the bracket is skipped, no `declare`/`observe` fires.
- The change touches **only** `plugin/skills/faff-graft/SKILL.md` prose and one new test file — no `.js`/`.ts` under `plugin/skills/faff/bin/lib/` changes, so no emit rebuild is required.

(No holdout marked: this is a skill-prose fix with no running feature for a code-blind evaluator to exercise; the scenarios are verified by the prose-contract test and by ledger inspection. Zero holdouts is valid.)

## 6. DESIGN DECISION RATIONALE

**Where does the bracket live?** Options: (a) inline in step 4 of the procedure; (b) a self-contained `_Governed …_` paragraph right after the procedure block; (c) rely on SKILL.md:301 only (status quo). (c) is the bug. (a) buries the commands inside pseudocode and reads unlike its siblings. (b) matches the anchor-head push paragraph at SKILL.md:559 and the pr-create paragraph at :561 — the established Step-9b shape for an inline governed bracket. **Chosen:** (b) — a `_**Governed In Review tracker-write record (on a governed run).**_` paragraph immediately after `transition_to_in_review`, before "Proceed to Step 10." Rationale: maximises discoverability and symmetry with the neighbouring brackets, which is the whole point of the fix.

**Which verb/idiom?** Options: `faff effects declare/observe` (line-301 idiom); `faff commissaire effect declare/observe` (schema-equivalent alias); a new status-specific verb. Both effects forms write identical schema:3 records. A new verb is banned (no `faff status set` exists and graft adds none — SKILL.md:589 anti-pattern). **Chosen:** `faff effects declare/observe … --step tracker-write`, matching SKILL.md:301 and the sibling tracker-write prose exactly. Rationale: one idiom for one write kind; the inline bracket and line 301 stay in lockstep.

**Declare+observe, or declare+authorize+observe?** The pr-create block (SKILL.md:563-565) runs the producer half with an `authorize` and a signed grant because pr-create is protected. tracker-write is not in `PROTECTED_EFFECT_KINDS` (effects.js:74). **Chosen:** `declare` + `observe` only — no `authorize`, no grant. Rationale: an unprotected effect needs reconciliation, not a grant; `conclude`'s grant-coverage leg (commissaire.ts, FAFF-1225) only weighs protected effects.

**Cite by name or restate it — and cite how?** **Chosen:** cite the rule **by its stable name** (`Governed tracker-write record`), not by a volatile `SKILL.md:301` line number. Rationale: the repo skill-authoring standard forbids duplicated prose, so the canonical rule stays the single binding source (scope, skip conditions, record-only semantics) and the inline paragraph carries only this transition's concrete commands plus a cross-reference. A bare line-number pointer rots on any edit above the rule and contradicts the file's own convention — `:299` says "the sibling **Governed tracker-write record** rule below" and `:301` replies "As with the label-write rule", both by name, never by number (spec-review infosec minor). So the inline paragraph and the regression-test assertion both reference the rule by name; a bare line-number literal as the sole cross-reference is forbidden. (A `SKILL.md:301`-style locator may still appear in *this spec's* reference context to point the build agent at where the rule lives today — it is the prescribed skill prose and the test that must use the name.)

**How to guard against regression?** Options: a prose-contract text test (model: `test/adr-extract-intent.test.mjs`); a full governed-run integration test; nothing. There is currently no test covering completeness of graft's effect ledger, and the CLI round-trip is already covered by `test/effects.test.mjs`. A full governed-run harness is disproportionate (Step-9b is agent-executed prose). **Chosen:** a prose-contract test that slices the Step-9b In Review block and asserts the bracket + line-301 citation. Rationale: it guards exactly the thing that regressed (the bracket falling out of the 9b block) at proportionate cost, and four existing tests already read `faff-graft/SKILL.md` as text, so the pattern is established.

**Which SKILL.md copy is the source of truth?** At the time of writing, the repo copy `plugin/skills/faff-graft/SKILL.md` and the installed copy `~/.claude/skills/faff-graft/SKILL.md` are byte-identical. **Chosen:** edit the repo copy; resync the installed copy afterward via `scripts/link-skills.sh` (the documented skill-link path). Rationale: the repo copy is governed; the installed copy is a materialised link that must be resynced or the running agent keeps the old prose.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. Every decision is closed against verified codebase facts.

**Assumptions.**

- **Assumes:** `faff effects declare` and `faff effects observe` accept `--run`, `--issue`, `--step tracker-write` and a JSON descriptor on stdin, writing schema:3 records to the run's `declared-effects.jsonl`. Validation: confirmed present and round-tripping in `test/effects.test.mjs` ("a tracker-write status descriptor round-trips through declare/observe with no escape"); the build agent can re-run that test.
- **Assumes:** `scripts/link-skills.sh` is the resync path that re-materialises `~/.claude/skills/faff-graft/SKILL.md` from the repo copy. Validation: confirmed referenced in `AGENTS.md` (sets `core.hooksPath`, links skills); the build agent checks the script links the `faff-graft` skill before relying on it, else uses the documented sync path.

## 8. DONE — Definition of Done

### From WHY
- [ ] A governed graft run reaching Step-9b records the In Progress -> In Review tracker-write as a matching `declare`+`observe` pair (no bare `observe`), so `conclude` signs without a hand-appended declare.
- [ ] **(spec-review QA observation) This runtime behavioural outcome is signed off by an explicit manual governed-run ledger inspection** — the prose-contract test proves the bracket text is present, not that the agent executes it; so a recorded DoD sign-off confirms a governed graft run's `declared-effects.jsonl` holds the matching declare+observe pair and `conclude` signs clean. The oracle gap (LLM-executed prose) is inherent and acknowledged; the manual check is the backstop, not left implicit.

### From WHAT (idiom and descriptor)
- [ ] The inline bracket uses `faff effects declare/observe --run "$(basename "$run_dir")" --issue <ISSUE-XX> --step tracker-write`, matching SKILL.md:301 — no new verb, not the `commissaire effect` producer-half form.
- [ ] The declared/observed descriptor is `[{kind:"tracker-write", target:"<ISSUE-XX>:In Progress->In Review", reversible:true}]`.
- [ ] The bracket is `declare`+`observe` only — no `authorize`, no grant (tracker-write stays unprotected).

### From HOW (behaviour)
- [ ] `plugin/skills/faff-graft/SKILL.md` Step-9b "In Review transition" block carries a self-contained inline governed-bracket paragraph (modelled on SKILL.md:559), placed after `transition_to_in_review` and before "Proceed to Step 10.".
- [ ] The inline paragraph cites the *Governed tracker-write record* rule **by its stable name** (not a volatile `SKILL.md:301` line number — matching the file's own :299/:301 by-name convention) and does not restate its scope/skip/record-only prose.
- [ ] The paragraph marks the bracket record-only / DETECTED-never-prevented (a non-zero `declare`/`observe` exit is logged; the status write proceeds) and skipped on an ungoverned run / no run substrate.
- [ ] The `declare` fires only on the step-4 write branch (In Progress -> In Review), not on the step-2/step-3 no-op branches.

### From HOW (regression guard)
- [ ] A new prose-contract test (modelled on `test/adr-extract-intent.test.mjs`) reads `plugin/skills/faff-graft/SKILL.md`, slices the Step-9b "In Review transition" block (bounding the slice with explicit start/end string markers — end at the `### Discovered scope` heading so the inserted paragraph, which sits after the `**Anti-patterns:**` lead-in and before "Proceed to Step 10.", is inside the slice), and asserts it contains the `tracker-write` declare-before + observe-after bracket and a by-name cross-reference to the *Governed tracker-write record* rule; the test fails if the bracket is removed from the 9b block.
- [ ] The test asserts load-bearing invariants (verbs, before/after ordering, the by-name rule citation), not brittle exact sentences, and does not assert on a volatile line number.

### From scope boundaries
- [ ] No file under `plugin/skills/faff/bin/lib/` (`effects.js`, `commissaire.ts`, emit) is changed — no emit rebuild required.
- [ ] The installed copy `~/.claude/skills/faff-graft/SKILL.md` is resynced from the repo copy (via `scripts/link-skills.sh` or the documented sync path) and matches the edited repo copy.

**Integration smoke test** (happy path, prose-contract form the new test encodes):

```
PROCEDURE smoke():
  1. md := readFile("plugin/skills/faff-graft/SKILL.md")
  2. block := slice md between explicit start/end markers (start at the "In Review transition"
     heading, end at the "### Discovered scope" heading) so the inserted paragraph is inside the
     slice (the pattern adr-extract-intent.test.mjs uses to bound Step-4b)
  3. ASSERT block matches /faff effects declare .*--step tracker-write/
  4. ASSERT block matches /faff effects observe .*--step tracker-write/
  5. ASSERT block references the "Governed tracker-write record" rule BY NAME (not a bare line number)
  6. ASSERT the declare is prescribed BEFORE, and the observe AFTER, the save_issue write
```

confidence: high