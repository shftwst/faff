# FAFF-670 — Oracle triage for the seven never-reviewed eval kinds, and what rides the paid sweep

> Spec: faffter-dark-nlspec · 2026-08-01 · interactive · revision 2b (re-grounded after FAFF-671 shipped) · confidence: medium. Full spec on Linear FAFF-670.


**Revision 2b — a targeted re-ground, not a re-spec.** Revision 2 answered a spec-review gate, and nothing in that answer has been withdrawn. The scope, the slicing, the case arithmetic (41), the relocation mechanism and its one-line test consequences, the reworked completeness gate, the permanence ordering, the timebox story, the four-option `holdout-exercise` table, the FAFF-625 design-doc decision and the anti-patterns all stand exactly as revision 2 argued them. What changed is the ground underneath. FAFF-671 shipped on 2026-07-29 as PR #503 (`485b3f5`) and it landed *with* the freshness guard that had been split out into FAFF-677 — so `test/eval-readme-freshness.test.mjs` is now a live CI test on `main`, and it turns this spike's corpus relocation into an `eval/README.md` edit that cannot be deferred to another ticket.

This revision changes that, and the things it makes incoherent: Decision 13, the `eval/README.md` out-of-scope item and its anti-pattern, the order of work, the integration smoke test, one row of the cannot-be-checked table, and the DONE list. It also re-pins line references across the eval code and tests, several of which moved.

Every number and file claim below was re-checked against `origin/main` at `ad8626b` — the shipped state, four merges on from where revision 2 was written (`485b3f5` FAFF-671, `73f0c72` FAFF-678, `09cb386` FAFF-679, `ad8626b` FAFF-680). Probes are named inline so a reader can repeat them.

This is a **one-day spike**. Its deliverable is a decision artifact plus one mechanical change to the eval corpus, and now three small, argued data and doc edits. It is not a feature. Audience: the build agent that will produce the artifact, and the human operator who will afterwards spend real money on the FAFF-614 sweep.

---

## 1. WHY — problem and principles

### The load-bearing model

**A paid sweep freezes corpus composition into a number; it does not freeze oracle correctness.** `aggregateKind()` in `eval/run-evals.mjs` (line 156) is a flat mean over the case results for a kind, equal weight per case, so which case files exist in `eval/cases/` at sweep time *is* the row. Changing that composition afterwards means paying for another sweep. Oracle correctness is different: every per-rep judgement is captured durably to `.faff/eval-runs/<run-id>/judgements.jsonl`, so a wrong oracle discovered after the fact can be re-scored from data already bought — which is exactly what FAFF-615 exists to do.

That asymmetry sets the priority for this spike. **Corpus composition must be settled before the money is spent. Oracle correctness merely should be, because it is free and the sweep is not.**

### Problem statement

`eval/cases/` holds 84 case files across 29 grader kinds; `eval/baselines/frontier.json` holds `per_kind` rows for 14 of them (probe: `Object.keys(per_kind).length` → 14, `captured_at 2026-06-16`, no `holdout-exercise` row). Fifteen kinds therefore contribute nothing to the regression gate today, FAFF-319 statically triaged eight of them, and the seven remaining — `adr-drift`, `chain-gap`, `explanatory-order`, `grouping`, `holdout-exercise`, `prep-architecture-trigger`, `resolved-elsewhere` — have never had a fixture-vs-oracle review even though FAFF-614's pending paid sweep will write gate-bearing rows from them. This spike reviews those seven oracles, and settles the one composition question that the sweep will otherwise decide by accident.

### The composition question, and why it is not a judgement call

The `holdout-exercise` kind currently has seven case files. Two are real exercises (`holdout-exercise-001`, `-002`, from FAFF-317). Five are `holdout-seed-*.json` pilot fixtures authored by FAFF-563 as *labelled* seeded-defect cases for a completely different measurement — the holdout judge's false-pass rate.

They are not a deliberate pilot-in-the-gate. FAFF-563's own design says so, at line 105 of `docs/specs/2026-07-23-faff-563-seeded-defect-scaffolding-holdout-error-rates-design.md`: *"Keep the gate untouched; the scorer is a separate read over the same captured judgements."* And FAFF-625 has already superseded that pilot with a 450-file production corpus in `eval/cases-seeded/`, read by `eval/score-error-rates.mjs`, which never touches `per_kind` at all.

The five files ended up in the sweep's default directory because that is where FAFF-563 authored them, not because anyone decided a labelled corpus should shape a regression baseline. Left alone, they outvote the real exercises five-to-two in the flat mean, producing a `holdout-exercise` row that measures neither the skill's judgement nor the judge's error rate.

### Design principles

**Free work before paid work, but never at the cost of the paid work's inputs.** The triage of the seven oracles is free and reversible. The corpus decision is neither. If the timebox runs out, the triage degrades; the corpus decision does not, because it lands first.

**A degradation story is only true if a machine enforces it.** Revision 1 fixed the first half of this — the completeness test now derives its scope from the artifact rather than a hardcoded constant. The reviewer then found the second half: three of the artifact's fields are self-declared and nothing catches a declaration that lies. Section 4 fixes each of them, and where a check genuinely cannot bind, this spec says so in plain terms and names the backstop rather than pretending.

**A stale historical record is history; a stale executable instruction is a trap.** This is the distinction revision 1 missed. FAFF-671's precedent — leave a landed design doc alone, because it records what was known when — applies to prose. It does not apply to a command line a doc tells an operator to run at build start. See Decision 7.

**Every number in the artifact is counted, not asserted.** Revision 0's `case_count` was wrong by one and no test would have caught it, because `meta.case_count` in `eval/calibration/oracle-triage.json` is asserted by nothing in the repo today. Probe, re-run on `main` at `ad8626b`: `grep -rn "case_count"` across `*.mjs`, `*.json` and `*.js` returns exactly two things — the artifact's own `"case_count": 29` at `eval/calibration/oracle-triage.json:8`, and a local variable of the same name inside `test/eval-readme-freshness.test.mjs`, which derives a corpus count for the `eval/README.md` guard and never opens the triage artifact. Nothing joins the two. Numbers a spec states as literals are numbers that go stale silently. See Decision 4.

**Zero paid model reps.** ADR-0004. This is static prose triage: each oracle judged against its own fixture and the grader arm that reads it. The artifact records the zero, and a test asserts it strictly.

### Reference context

| What it is | File | Why it matters here |
|---|---|---|
| The sweep's case loader | `eval/run-evals.mjs`, `loadCases()` at line 82 | Defaults to `eval/cases/` and loads that directory **totally**. Anything in it rides the sweep. |
| The per-kind aggregator | `eval/run-evals.mjs`, `aggregateKind()` at line 156 | Flat mean at equal weight per case — the mechanism that makes composition permanent. |
| The regression gate's diff | `eval/run-evals.mjs`, `diffAgainstBaseline()` at line 252 | Fails on a **drop** only (line 268: `c.accuracy < base.accuracy - t`). Sets how a two-case row behaves — see Decision 12. |
| The gate's tolerance and warn policy | `eval/run-evals.mjs`, `toleranceFor()` at line 240, `DEFAULT_POLICY` at line 236 | `warn_kinds` is reported-not-failed regardless of grader class. `confidence` is the standing precedent. |
| The plain sweep's entry path | `eval/run-evals.mjs` lines 689–692 | Resolves the driver, loads cases, **then** applies `--only`. No case-count check anywhere — the fact that overturns revision 1's Decision 7. |
| The committed baseline | `eval/baselines/frontier.json` | 14 `per_kind` rows plus a `policy` block. `foldInAndWriteBaseline` (line 390) writes `policy: prevPolicy` (line 417), so a policy edit made now survives FAFF-614's sweep. |
| The existing triage artifact | `eval/calibration/oracle-triage.json` | 29 entries across the FAFF-319 eight kinds; `case_count: 29`; classes 23 `sound`, 2 `oracle-defect`, 1 `needs-evidence`, 3 `suspected-genuine-miss`. This spike extends it. |
| The completeness gate | `test/oracle-triage.test.mjs` | Six tests. Its `IN_SCOPE_KINDS` at line 22 is a hardcoded 8-member set; line 77 forbids a `discriminating_question` on any non-`needs-evidence` entry. |
| The pilot's five fixtures | `eval/cases/holdout-seed-*.json` | The composition problem, and the FAFF-563 authoring template FAFF-625 copied. |
| The production seeded corpus | `eval/cases-seeded/` (450 files) | Where the real error-rate measurement lives now. Never swept. |
| The precedent for a sibling directory | `eval/cases-live/` (4 files), loaded by `loadLiveCases()` at line 96 | Proof that "a case directory the black-box sweep never reads" is an established pattern here, not an invention. |
| The scorer's own tests | `test/score-error-rates.test.mjs` | **Nine** tests. Three of them reach the five pilot files — the leakage test at line 166, the pilot-corpus test at line 197 and the CLI smoke at line 214 — across four reference sites, all routed through one `CASES_DIR` constant. |
| The adapter coverage gate | `plugin/skills/faff/bin/lib/validate-adapters.js` lines 786–795 | Counts files in `eval/cases/` whose name starts `<kind>-`, and FAILs a `covered` registry kind with zero. Moved down the file by FAFF-678 (PR #504) since revision 2 quoted it at 714–723; the code is unchanged. |
| The `eval/README.md` freshness guard | `test/eval-readme-freshness.test.mjs` | New on `main` since revision 2 (FAFF-671, PR #503). Derives `case_count`, `kind_count`, `base_total`, `worst_total` and `gate_gap` at runtime from `loadCases()`, the exported `BASE_REPS` / `MAX_REPS` and the committed baseline, and asserts each appears — with the README's own thousands separators — in `eval/README.md`'s `## Re-baseline runbook` section. This spike's relocation moves three of those five, which is why the README edit is compulsory. See Decision 13. |

### Scope statement

This sits immediately upstream of FAFF-614 (the operator's paid re-baseline sweep), which this ticket blocks. FAFF-671 — correcting the runbook FAFF-614 follows — is **Done**: it merged on 2026-07-29 as PR #503 and brought the `eval/README.md` freshness guard with it, so it is no longer a sibling in flight but a constraint this spike has to satisfy. FAFF-669 (arming the four unarmed kinds) is still a sibling. FAFF-615 consumes whatever this spike leaves undecided.

---

## 2. OUT OF SCOPE

**Running the sweep, or any model reps at all.**
*Why excluded:* ADR-0004 forbids an agent session running the sweep; FAFF-614 is operator-owned by design.
*Extension point:* FAFF-614, whose instructions are `eval/README.md`'s re-baseline runbook.

**Resolving the FAFF-319 `needs-evidence` and `suspected-genuine-miss` entries.**
*Why excluded:* they need sweep captures, which do not exist yet.
*Extension point:* FAFF-615, which reads `.faff/eval-runs/<run-id>/judgements.jsonl`.

**Reworking `eval/README.md` beyond the numbers the corpus derives.**
*Why excluded:* FAFF-671 has already corrected that runbook end to end. Its lines 153-155 now state the real gap — 15 of the 29 kinds contribute nothing, against 14 committed `per_kind` rows — which is exactly the claim revision 2 wanted fixed and deferred to FAFF-671. This spike has no prose quarrel left with the file. What it does have is an unavoidable arithmetic edit: the relocation changes three numbers the README states, and `test/eval-readme-freshness.test.mjs` derives those numbers at runtime and fails if the file disagrees. That numeric edit is **in** scope and Decision 13 argues it. Everything else in the document — the ADR-0004 nesting warning, the `--resume` guidance, the model-resolution paragraph, the runbook's six points as prose — stays untouched.
*Extension point:* FAFF-677, which after its rewrite owns the guard's remaining residue — a durable proof-of-failure check for the guard itself. Section 7 records what this spike takes from FAFF-677 and what it leaves.

**Adding an empty-case-set guard to `eval/run-evals.mjs`.**
*Why excluded:* this spike's own argument is that the sweep's executable path must not change in the week before a real-money run, and a guard is a behaviour change to the file that spends the money. The stale command that motivated the guard is fixed at its source instead (Decision 7).
*Extension point:* `eval/run-evals.mjs` lines 689–692 — resolve the driver *after* the `--only` filter and refuse a zero-case frontier run. Filed as a named follow-up.

**Fixing the `chain-gap` / `resolved-elsewhere` tolerance mismatch.**
*Why excluded:* both kinds sit outside `CLOSED_SET_KINDS` so `toleranceFor()` hands them the 0.03 free-text tolerance (probe confirms: `toleranceFor("chain-gap")` → 0.03), yet both grade by exact set-equality via `gradeChainGap` / `gradeSplittable`, which return a binary PASS/FAIL per case. A fractional tolerance on a binary grade is incoherent. It is a real defect, but it is a grader-policy change, not an oracle correction, and changing tolerances immediately before a baseline sweep is precisely the wrong moment.
*Extension point:* `toleranceFor()` in `eval/run-evals.mjs` line 240. Recorded as a named follow-up.

**Authoring new fixtures for `grouping`, `resolved-elsewhere` and `holdout-exercise`.**
*Why excluded:* writing a fixture is authoring work, not triage, and it would change composition for more rows on the eve of the sweep — the exact thing this spike exists to prevent.
*Extension point:* `eval/cases/` plus the kind lists in `test/eval-grader.test.mjs` around line 717. Recorded as a named follow-up, and it is the follow-up that eventually retires Decision 12's `warn_kinds` entry.

**Any change to `eval/grader.mjs`, `eval/seam-registry.json`, `eval/run-evals.mjs`, or the `per_kind` gate *mechanics*.**
*Why excluded:* this spike judges oracles; it does not change how they are graded.
*Carve-out, stated explicitly so it is not a surprise:* one **data** edit to `eval/baselines/frontier.json` — adding `holdout-exercise` to the existing `policy.warn_kinds` array. That is the gate's policy input, not its mechanics; the array already exists, already holds `confidence`, and no code changes. Decision 12 argues it.
*Extension point:* FAFF-616 (covered ≠ calibrated) already owns the registry-tier conversation.

---

## 3. WHAT — the artifact, the corpus change, and the gate

### Vocabulary

| Term | Meaning here |
|---|---|
| Oracle | The expected-answer block on a case file — `closed_set`, `ordering`, or `gloss_rubric`, exactly one populated per `validateCase`. |
| Grader arm | The branch of `eval/grader.mjs` that reads a kind's envelope field and compares it to the oracle. |
| Triage entry | One record in `eval/calibration/oracle-triage.json`, judging one case's oracle against its own fixture and its grader arm. |
| Target kinds | The fifteen kinds with no `per_kind` row in `eval/baselines/frontier.json`. The FAFF-319 eight plus this spike's seven. |
| In-scope kinds | The subset of target kinds this artifact currently claims to have triaged completely — `meta.scope_kinds`. |
| Remaining kinds | Target kinds the artifact openly declares it has *not* triaged — `meta.remaining_kinds`. New in this pass; the mechanism that makes the timebox story true, and the field Decision 11 argues about. |
| Pilot fixtures | The five `holdout-seed-*.json` files FAFF-563 authored, currently in `eval/cases/`. |
| Warn kind | A kind listed in the baseline's `policy.warn_kinds`. Its regressions are reported, not failed, whatever its grader class. `confidence` is the only one today. |

### The extended triage artifact

`eval/calibration/oracle-triage.json`, extended in place. Entries keep the existing shape; `meta` gains four fields and every entry gains one, with a second new field on one class only.

```
RECORD TriageArtifact:
  meta: TriageMeta
  entries: List<TriageEntry>       # one per case file whose kind is in meta.scope_kinds

RECORD TriageMeta:
  ticket: String                   # unchanged: "FAFF-319" — the artifact's origin
  produced: Date                   # unchanged
  method: String                   # unchanged
  supersedes: String               # unchanged
  scope_kinds: List<Kind>          # EXTENDED — kinds this artifact has triaged completely
  remaining_kinds: List<Kind>      # NEW — target kinds NOT yet triaged; may be empty
  case_count: Integer              # RECOMPUTED at build; must equal entries.length
  class_counts: Map<Class,Integer> # RECOMPUTED at build; must sum to entries.length
  paid_model_reps: Integer         # NEW — must be exactly 0
  root_cause_note: String          # unchanged
  follow_ups: Map<String,String>   # EXTENDED — gains this pass's named follow-ups
  extensions: List<ExtensionRecord># NEW — one record per pass that widened this artifact
  assumption_checks: List<AssumptionCheck>  # NEW — structured, not free text (see below)

  CONSTRAINT scope_kinds ∪ remaining_kinds == TARGET_KINDS   (exactly the fifteen)
  CONSTRAINT scope_kinds ∩ remaining_kinds == ∅
  CONSTRAINT scope_kinds ⊇ the FAFF-319 eight                 (the ratchet)
  CONSTRAINT case_count == entries.length
  CONSTRAINT paid_model_reps == 0
  CONSTRAINT remaining_kinds non-empty ⟹ follow_ups.remaining_kinds names a ticket
             AND that follow-up's kind list, as a set, == remaining_kinds

RECORD AssumptionCheck:               # NEW SHAPE — this is the QA fix
  assumption: String                  # which of Section 7's three
  result: Enum{pass, fail}            # a machine-readable verdict, not prose
  detail: String                      # what was run and what came back, >40 chars
  CONSTRAINT result == pass            # a committed artifact may only record passes;
                                       # a fail means the build stopped and escalated,
                                       # so a failing check never reaches a commit

RECORD ExtensionRecord:
  ticket: String                   # "FAFF-670"
  date: Date
  kinds_added: List<Kind>          # must equal the kinds actually carried by FAFF-670 entries
  relocated_paths: List<PathMove>  # the five pilot fixtures: from → to
  origin_commit: String            # 7–40 lowercase hex, and resolvable in this repo
  note: String                     # why the relocation happened, in one sentence

RECORD TriageEntry:
  case_id: String
  kind: Kind
  grader_shape: String             # names the envelope field and the grade function
  class: Enum{oracle-defect, needs-evidence, suspected-genuine-miss, sound}
  rationale: String                # >40 chars, and not interchangeable with any other entry's
  proposed_fix: String?            # present iff class == oracle-defect
  discriminating_question: String? # present iff class == needs-evidence  (existing rule, kept)
  expected_signal: String?         # NEW — present iff class == suspected-genuine-miss;
                                   # what the sweep captures would show if the miss is genuine
  triage_ticket: String            # NEW on every entry — "FAFF-319" backfilled on the existing 29,
                                   # "FAFF-670" on the new ones
```

The **ratchet** constraint is the anti-bypass. `scope_kinds` may grow but the FAFF-319 eight may never leave it, so "drop a kind to make the suite green" is not a move that exists. A kind this spike does not reach must be declared in `remaining_kinds`, where it is visible in the artifact, priced by a filed ticket, and carried into the next pass.

**Why `expected_signal` is new.** The existing test at `test/oracle-triage.test.mjs:75-77` requires a `discriminating_question` on `needs-evidence` entries and **forbids** one on every other class. So revision 1's DONE criterion — that a `suspected-genuine-miss` entry carries a discriminating question — was not merely unverifiable, it contradicted a test that is green today over three such entries (`refutation-spec-007`, `-008`, `-009`, none of which carries one). `expected_signal` gives that class its own required field, in the same present-iff shape, so the "no unresolved observation" rule finally has an oracle. The three existing entries get the field backfilled.

### What lands in the corpus

The five pilot fixtures move from `eval/cases/` to a new sibling directory `eval/cases-pilot/`, contents unchanged and filenames unchanged. Nothing in the sweep path reads that directory. The files remain in git as the FAFF-563 authoring template both FAFF-563 and FAFF-625 document them as.

After the move, `eval/cases/` holds **79** files across **29** kinds — `holdout-exercise` still has its two real exercises, so no kind disappears.

### Design decisions

Each decision below carries exactly one canonical marker. Full rationale, including rejected options, is in Section 6.

**Decision 1 — do the pilot seeds shape the `holdout-exercise` gate row?**
**Chosen:** No. The row is built from `holdout-exercise-001` and `holdout-exercise-002` only.

**Decision 2 — what mechanism excludes them?**
**Chosen:** Relocate all five files to a new `eval/cases-pilot/` directory (`git mv`), following the `eval/cases-live/` precedent. Not deletion, not a `skip` field, not a move into `eval/cases-seeded/`. Unchanged from revision 1, whose mechanics the reviewer verified in full.

**Decision 3 — where does the triage live?**
**Chosen:** Extend `eval/calibration/oracle-triage.json` in place, per the record above. Not a sibling artifact.

**Decision 4 — how is `case_count` established?**
**Chosen:** Counted at build from `entries.length`, and machine-asserted (`meta.case_count === entries.length`). This spec states no literal as an input.

For the reader's calibration, a **complete** pass yields 41, derived as follows — but the artifact must arrive at this by counting, and a build that reaches a different number because it triaged fewer kinds is correct, not wrong:

| Kind | In-scope cases | Note |
|---|---|---|
| Existing FAFF-319 eight | 29 | unchanged; the artifact holds exactly 29 entries and `case_count: 29` today |
| `adr-drift` | 2 | |
| `chain-gap` | 2 | |
| `explanatory-order` | 2 | |
| `grouping` | 1 | single case — see follow-ups |
| `holdout-exercise` | 2 | after the five pilot fixtures relocate |
| `prep-architecture-trigger` | 2 | |
| `resolved-elsewhere` | 1 | single case — see follow-ups |
| **Complete-pass total** | **41** | 29 + 12 |

**Decision 5 — where does the completeness test get its scope from?**
**Chosen:** Derive it from `artifact.meta.scope_kinds`, and replace the now-tautological `scope_kinds` assertion with the ratchet and union constraints. Detailed in Section 4.

**Decision 6 — what happens to the four pilot-referencing sites in `test/score-error-rates.test.mjs`?**
**Chosen:** All four become one path swap on the shared `CASES_DIR` constant, with no scale change, no fixture rename, and no runtime change. Detailed in Section 4, with each site named.

**Decision 7 — is the FAFF-625 design doc edited? (Reversed from revision 1.)**
**Chosen:** Yes — edit exactly two lines in `docs/specs/2026-07-24-faff-625-holdout-error-rate-production-run-offline-proxy-lower-bound-design.md`: the inputs-table path at line 27 and the smoke command inside the `**Assumes:**` clause at line 183. Nothing else in that document is touched.

Both line references were re-confirmed against `origin/main` at `ad8626b`. Line 27 is still the inputs-table row reading `` `eval/cases/holdout-seed-*.json` (5) ``, and line 183 is still the `**Assumes:**` bullet carrying `node eval/run-evals.mjs --only holdout-seed-clean-001 --reps 1 --driver frontier`. None of the four merges since revision 2 touched that document. The reasoning below is likewise unaffected by FAFF-671 landing — it turns on what the sweep's entry path does with a zero-match `--only`, which no merge since has changed.

Revision 1 argued this the other way, and its premise was false in both halves. Verified:

- Line 27 is a **glob** — `` `eval/cases/holdout-seed-*.json` (5) `` — which after the move resolves to **zero files**, not to a moved path. There is no "one directory stale" state; the reference simply stops resolving.
- Line 183's command, `node eval/run-evals.mjs --only holdout-seed-clean-001 --reps 1 --driver frontier`, does **not** "fail loudly". The plain sweep resolves the driver at line 690, loads cases at 691, and filters on `--only` at 692, with no case-count check anywhere in the file. Zero matching cases means an empty sweep, a printed summary, and exit 0 — a silent no-op that reads as success.
- Worse, the asymmetry revision 1 created for itself: its own suggested remedy was to append `--cases-dir eval/cases-pilot`. That flag exists (FAFF-625 added it, plain-sweep-only, line 689), and with it the command runs a **real paid frontier rep** — precisely the silent-cost path the model pinning exists to prevent, reachable by copy-paste from a stale doc, by an operator on their way to FAFF-614's multi-hour paid sweep.

The FAFF-671 precedent still holds for what it actually covers: a landed design doc's *record of what was decided* stays as written. It does not cover an executable instruction that a doc tells the next operator to run. Fixing the command is a one-line correction that changes no claim the FAFF-625 author made.

**Decision 8 — is a defective oracle fixed here or deferred?**
**Chosen:** Fixed here **iff** the defect is decidable from the fixture text alone and the fix is contained to oracle values — the `architecture-002` precedent from FAFF-319. Otherwise classed `needs-evidence` with a discriminating question, or `suspected-genuine-miss` with an `expected_signal`, both aimed at FAFF-615. No entry is left as an unresolved observation, and both of those classes now have a required field, so the rule is checkable.

**Decision 9 — where do the follow-ups live?**
**Chosen:** Both places, in a fixed shape. Each follow-up is (a) a filed tracker ticket, and (b) a key in `meta.follow_ups` whose value names that ticket, matching the existing FAFF-319 shape (`"operator_sweep": "FAFF-614 (…)"`). A test asserts every follow-up value matches `/FAFF-\d+/`, so "recorded a follow-up" cannot be satisfied by prose alone. Section 4 states plainly which half of that is machine-checkable in-repo and which is not.

**Decision 10 — what does the timebox actually buy?**
**Chosen:** The corpus relocation, its test repoints and the two data/doc edits are **not** timeboxed out — they land first and complete. The seven-kind triage is timeboxed to the remainder of the day. On expiry, completed kinds sit in `scope_kinds`, unreached kinds sit in `remaining_kinds`, the suite is green, the artifact states its own incompleteness, and a filed ticket names the exact kinds left.

**Decision 11 — `remaining_kinds` is self-declared. Is that acceptable?**
**Chosen:** Accept the self-declaration, and price it. No in-repo check can distinguish "genuinely unreached under time pressure" from "deferred to dodge a hard judgement", because both produce a byte-identical artifact — so a check claiming to tell them apart would be theatre. What the design adds instead is a cost and a backstop: a non-empty `remaining_kinds` **must** be matched by a filed follow-up ticket whose kind list equals it exactly, asserted as a set, so deferral costs a named ticket enumerating the specific kinds rather than a quiet omission. The backstop is FAFF-614 itself: the sweep writes a `per_kind` row for every kind in `eval/cases/` whether or not it was triaged, so an untriaged kind still gets a gate row, and FAFF-615's read over the captures surfaces it as a low-accuracy kind with no triage entry behind it. Section 6 states the reasoning and Section 4 states the assertion.

**Decision 12 — the `holdout-exercise` row is built from two cases. Keep it, drop it, or soften it?**
**Chosen:** Keep the kind in the gate and add `holdout-exercise` to `policy.warn_kinds` in `eval/baselines/frontier.json` until real fixtures widen it. Two options revision 1 never weighed are weighed in Section 6; this is the fourth and it is the only one that is both buildable within this spike's out-of-scope boundaries and honest about the signal.

The reviewer's diagnosis is right and revision 1's "coarse but accepted" framing was too generous. `diffAgainstBaseline` fails on a **drop** only (line 268), so a single case flipping wrong moves accuracy by 0.5 against a closed-set tolerance of 0.0 — an unconditional gate failure from one case. That is not coarse detection, it is misleading detection. `warn_kinds` is the repo's own answer to exactly this shape: line 233 describes it as orthogonal to grader class, and `confidence` is already listed there as "closed-set-graded but empirically flaky per ADR-0004, pending fixture widening". The two-case `holdout-exercise` row is the same sentence with a different cause. The edit is one array element, `test/eval-baseline-gate.test.mjs:112` asserts only that `warn_kinds` *includes* `confidence` so it stays green, and `foldInAndWriteBaseline` writes `policy: prevPolicy` at line 417, so the entry survives FAFF-614's re-baseline rather than being overwritten by it.

**Decision 13 — the `eval/README.md` counts, now owned by a CI test.**
**Chosen:** This spike edits `eval/README.md`'s corpus-derived counts inside its own PR — **84 → 79**, **1,680 → 1,580**, **4,200 → 3,950** — and leaves `29` (kinds) and `15` (gate gap) alone, because neither of those moves. `node --test test/`, including `test/eval-readme-freshness.test.mjs`, must be green before the PR is proposed.

This replaces revision 2's plan, which was to leave the README to FAFF-671 and post a comment on that ticket recording the new counts. That plan is dead at both ends. FAFF-671 is **Done** — merged 2026-07-29 as PR #503 (`485b3f5`) — so a comment on it reaches nobody who can act on it. And FAFF-671 landed more than a prose correction: it added `test/eval-readme-freshness.test.mjs`, which derives five facts at runtime and asserts each one appears, formatted with the README's own thousands separators, inside the `## Re-baseline runbook` section.

| Derived fact | How the test derives it | On `main` today | After this spike's relocation |
|---|---|---|---|
| `case_count` | `loadCases().length` | 84 | **79** |
| `kind_count` | distinct `kind` across `loadCases()` | 29 | 29 — unchanged |
| `base_total` | `case_count × BASE_REPS`, `BASE_REPS = 20` | 1,680 | **1,580** |
| `worst_total` | `case_count × MAX_REPS`, `MAX_REPS = 50` | 4,200 | **3,950** |
| `gate_gap` | `kind_count` minus the `per_kind` rows in `eval/baselines/frontier.json` | 15 | 15 — unchanged |

`kind_count` holds at 29 because `holdout-exercise` keeps `holdout-exercise-001` and `holdout-exercise-002`, so the relocation removes five files but no kind. `gate_gap` holds at 15 because it is `kind_count` minus the 14 committed baseline rows, and this spike changes neither. Probe, run against `main` at `ad8626b`: `loadCases()` returns 84 cases across 29 kinds; the same list with `holdout-seed-*` ids filtered out returns 79 cases across 29 kinds. The arithmetic: 79 × 20 = 1,580, 79 × 50 = 3,950.

So the count coupling that revision 2 could only describe in a ticket comment is now enforced by a test that runs on every `node --test test/`. Leave the README alone and the suite goes red at step 2 of the order of work, before a single triage entry is written. Editing it is not a courtesy to a sibling ticket — it is part of the price of the relocation.

**And the three unguarded sites, taken here too.** The guard scopes its containment check to the `## Re-baseline runbook` section — `eval/README.md` line 151 to the end of the 219-line file, that heading being the file's last. All five derived facts are therefore machine-enforced somewhere inside it: `kind_count` (29) and `gate_gap` (15) at line 153, and the three that this spike moves at lines 190-192, in point 4. Three further statements of the same numbers sit above that section and would go silently stale in a file this PR already has open: line 18's `~1,680–4,200-run` range, line 39's Pieces-table entry `(84 files across 29 kinds)`, and line 103's `84 cases × K=20 base ≈ 1,680 reps, escalating toward 4,200`. Fix all three in the same edit. Line 18 is the residue FAFF-677 hoped would ride along with whatever next touched `eval/README.md`, and this is that ticket; FAFF-677 keeps its other half, the durable proof-of-failure check. Section 6 argues the call.

---

## 4. HOW — behaviour

### Architecture of the change

Four things move, in a strict order. The corpus change and its consequences land **completely and green** before a single triage entry is written, because the corpus change is the part that blocks real money and the triage is the part that can be cut short.

```
PROCEDURE faff_670:
  1. Validate the three assumptions (Section 7). Record each as an
     AssumptionCheck { assumption, result, detail }. If any result is
     "fail", STOP and escalate — do not commit, do not proceed on a
     stale premise. A committed artifact only ever holds passes.
  2. Land the corpus relocation:
     a. git mv the five eval/cases/holdout-seed-*.json to eval/cases-pilot/
     b. Verify the move was content-neutral: `git diff --cached --stat -M`
        across the move reports five renames with 0 insertions and
        0 deletions. (NOT `git log --follow` — see below.)
     c. Repoint CASES_DIR in test/score-error-rates.test.mjs, and the
        two eval/cases/ defaults in eval/score-error-rates.mjs itself
        (line 92 and line 237) — the test always passes --cases-dir, so
        repointing only the test would hide a silent-zero scorer run
     d. Repoint PILOT_DIR in test/cases-seeded-lint.test.mjs
     e. Update test/eval-grader.test.mjs: cases.length 84 -> 79, and the
        FAFF-563 comment block to say the pilot relocated
     f. Update eval/README.md's corpus-derived counts: 84 -> 79,
        1,680 -> 1,580 and 4,200 -> 3,950, at lines 18, 39, 103 and
        190-192. Leave 29 (kinds) and 15 (gate gap) exactly as they are.
        This is NOT optional tidying: test/eval-readme-freshness.test.mjs
        derives those numbers from loadCases(), BASE_REPS and MAX_REPS
        and goes RED without it.
     g. RUN the full suite, test/eval-readme-freshness.test.mjs
        included. It MUST be green before step 3 begins.
  3. Land the two argued data/doc edits:
     a. Add "holdout-exercise" to policy.warn_kinds in
        eval/baselines/frontier.json  (Decision 12)
     b. Fix the glob at line 27 and the smoke command at line 183 of the
        FAFF-625 design doc  (Decision 7)
     c. RUN the full suite. Green.
  4. Rework test/oracle-triage.test.mjs to the derived-scope design below.
     Backfill triage_ticket on the existing 29 entries and expected_signal
     on the three suspected-genuine-miss entries. Seed meta.remaining_kinds
     with all seven new kinds and meta.scope_kinds with the existing eight.
     RUN the suite. It MUST be green — this proves the degradation story
     with zero new triage work done.
  5. Triage, in permanence order (below). For EACH kind, in one step:
     a. Write every entry for that kind's cases
     b. Move that kind from meta.remaining_kinds to meta.scope_kinds
     c. Recompute meta.case_count and meta.class_counts from entries
     d. RUN test/oracle-triage.test.mjs — green before the next kind
  6. When the timebox expires OR all seven kinds are done:
     a. Write meta.extensions, meta.paid_model_reps = 0, meta.follow_ups
     b. File the follow-up tickets; if remaining_kinds is non-empty,
        file the ticket that names those exact kinds and record it
        under follow_ups.remaining_kinds. There is NO FAFF-671 comment
        to post — that ticket is closed and the count coupling is
        discharged by the eval/README.md edit in step 2f.
     c. RUN the full suite
```

**On step 2b.** Revision 1 named `git log --follow` as the verification that the move was a pure rename. That method cannot check its own claim: `--follow` reports rename **detection**, a similarity heuristic that happily reports a rename across a content edit that clears its threshold. A zero-line `git diff --cached --stat -M` across the move is the real oracle, because it reports the actual insertion and deletion counts. It must be `--cached`: `git mv` stages the rename, so a bare `git diff` sees an empty working tree and reports nothing at all, which is not the same evidence. A sha256 comparison of the five files before and after is an equally valid substitute; pick one and record which in the assumption check detail.

### Permanence ordering for step 5

Triage the kinds whose oracle errors are least recoverable first, so a timeout costs the least. Permanence is set by `toleranceFor()` — a kind at tolerance 0.0 admits no drift at all, so a wrong oracle baked into its row is a permanent false signal; a kind at 0.03 has a sliver of slack.

| Order | Kind | Tolerance | Why here |
|---|---|---|---|
| 1 | `explanatory-order` | 0.0 (ordering) | `toleranceFor` line 244 gives it the ordering tolerance explicitly; graded by `rankCorrelation`. Any inversion is a real regression. |
| 2 | `adr-drift` | 0.0 (closed set) | In `CLOSED_SET_KINDS`; binary `survived`/`overturned` off `env.challenge_outcome` (`eval/grader.mjs` lines 656-657). |
| 3 | `holdout-exercise` | 0.0 (closed set), and now a warn kind | In `CLOSED_SET_KINDS`; per-criterion `<key>:<class>` pairs via `pairsOf(env["holdout-exercise"])` (line 628). This is the kind whose composition this spike changed — triage it while that is fresh. Warn status softens the gate's response, not the oracle's correctness, so it does not move down this list. |
| 4 | `prep-architecture-trigger` | 0.0 (closed set) | In `CLOSED_SET_KINDS`; single-element set off `env.verdict`, values `fire`/`skip` (line 604). |
| 5 | `chain-gap` | 0.03 | Graded by exact set-equality (`gradeChainGap`, defined at line 725, dispatched at line 852) despite the free-text tolerance — the mismatch noted out of scope. Treat its oracle as if it were 0.0. |
| 6 | `resolved-elsewhere` | 0.03 | Same story: `gradeSplittable` (defined at line 689) over `env.resolved_elsewhere` (line 862), exact set-equality under a fractional tolerance. |
| 7 | `grouping` | 0.03 | Genuinely fractional — `gradeCoverage` (defined at line 429) over `env.grouping` against a `gloss_rubric` (line 819), returning PARTIAL on [0,1). The one kind whose tolerance matches its grader, so the most forgiving of an oracle error. |

**Anti-pattern:** extending `meta.scope_kinds` ahead of the entries for that kind. Why: `scope_kinds` is now the test's source of truth for what must be complete, so declaring a kind in scope before its entries exist turns the suite red for the duration — and invites the implementer to work around the redness rather than finish the kind.

### The completeness gate, reworked

Revision 0's degradation story was false and revision 1 fixed it. Verified again here: `test/oracle-triage.test.mjs` line 22 declares `IN_SCOPE_KINDS` as a hardcoded 8-member `new Set([…])`; `inScopeCaseIds()` scans every file in `eval/cases/` and keeps those whose `kind` is in that constant; the first test asserts `missing` is empty. Widening that constant to fifteen would turn the suite red the moment a triage pass was partial. Extending `meta.scope_kinds` behind completed entries had no effect whatsoever, because nothing read it for scope.

What revision 2 adds on top is the answer to "and what stops the artifact lying to the test that now reads it". Three fields were self-declared and unchecked. Each gets a binding assertion, or an honest note where none can bind.

```
CONSTANT TARGET_KINDS = the fifteen kinds with no per_kind row in
  eval/baselines/frontier.json  -- hardcoded; this is the SPIKE'S SCOPE
CONSTANT FAFF_319_KINDS = the original eight  -- the ratchet floor

DERIVED IN_SCOPE_KINDS = Set(artifact.meta.scope_kinds)
DERIVED REMAINING_KINDS = Set(artifact.meta.remaining_kinds)

TEST scope declaration is honest:
  1. IN_SCOPE_KINDS ∪ REMAINING_KINDS == TARGET_KINDS
  2. IN_SCOPE_KINDS ∩ REMAINING_KINDS == ∅
  3. FAFF_319_KINDS ⊆ IN_SCOPE_KINDS
     -- the ratchet: no already-triaged kind may retreat to "remaining"

TEST TARGET_KINDS has not silently gone stale:
  LET ungated = kinds present in eval/cases/ with no per_kind row in
                eval/baselines/frontier.json
  ASSERT ungated ⊆ TARGET_KINDS
  -- one-directional ON PURPOSE. A NEW ungated kind appearing fails
  -- loudly, which is the case that matters. TARGET_KINDS becoming a
  -- superset (FAFF-614 re-baselines and rows appear) does NOT fail,
  -- so this spike does not booby-trap the sweep it is unblocking.
  -- The constant's MEANING going stale is a known cost, owned below.

TEST deferral is priced, not free:
  IF REMAINING_KINDS is non-empty:
    ASSERT meta.follow_ups has a "remaining_kinds" key
    ASSERT its value matches /FAFF-\d+/
    ASSERT the kind names appearing in that value, as a set, == REMAINING_KINDS
    -- deferral now costs a filed ticket that enumerates the exact kinds

TEST per-kind set equality (replaces the flat union-level check):
  FOR EACH kind k IN IN_SCOPE_KINDS:
    caseIds  = ids of files in eval/cases/ whose kind == k
    entryIds = case_ids of entries whose kind == k
    ASSERT caseIds == entryIds as sets, both directions

TEST no entry for an out-of-scope kind:
  FOR EACH entry e: ASSERT IN_SCOPE_KINDS.has(e.kind)

TEST meta counts are counted, not asserted:
  ASSERT meta.case_count == entries.length
  ASSERT sum(meta.class_counts.values()) == entries.length
  ASSERT every key of meta.class_counts ∈ CLASSES

TEST the free-work claim:
  ASSERT meta.paid_model_reps === 0    -- strict, not truthy-zero

TEST provenance on every entry:
  FOR EACH entry e: ASSERT e.triage_ticket matches /^FAFF-\d+$/
  ASSERT the set of distinct triage_ticket values ⊆ {"FAFF-319","FAFF-670"}

TEST every deferred entry names its evidence:
  FOR EACH entry e:
    IF e.class == "needs-evidence":
      ASSERT e.discriminating_question is a string > 20 chars  (existing rule)
    IF e.class == "suspected-genuine-miss":
      ASSERT e.expected_signal is a string > 20 chars          (NEW)
      ASSERT e.discriminating_question == null   (existing line-77 rule, kept)
    OTHERWISE:
      ASSERT e.expected_signal == null
  -- this is what makes "no unresolved observation" checkable at all

TEST the extension record:
  ASSERT meta.extensions is a non-empty array
  LET x = the record whose ticket == "FAFF-670"
  ASSERT x.kinds_added is a non-empty array, every member ∈ TARGET_KINDS
  ASSERT x.kinds_added, as a set, == the set of kinds carried by entries
    whose triage_ticket == "FAFF-670"
    -- CORPUS-DERIVED, not declaration-derived. Copying scope_kinds
    -- minus the eight no longer passes; the entries must actually exist.
  ASSERT x.relocated_paths has 5 entries, each with a `from` under
    eval/cases/ and a `to` under eval/cases-pilot/, and each `to` file
    exists on disk
  ASSERT x.origin_commit matches /^[0-9a-f]{7,40}$/
    AND `git cat-file -e <origin_commit>^{commit}` succeeds
    -- "banana" no longer satisfies the provenance field

TEST follow-ups name tickets:
  FOR EACH value v of meta.follow_ups: ASSERT /FAFF-\d+/.test(v)

TEST assumption checks are verdicts, not prose:
  ASSERT meta.assumption_checks is an array of length >= 3
  FOR EACH check c:
    ASSERT c.assumption is a non-empty string
    ASSERT c.result === "pass"     -- a fail can never reach a commit
    ASSERT c.detail is a string > 40 chars
```

The five existing tests that are unaffected by scope derivation — per-class required fields, common fields, the generic-deferral / interchangeable-rationale stranger test, and the `supersedes` check — stay as they are, with `IN_SCOPE_KINDS` now derived rather than hardcoded, and the per-class test extended with the `expected_signal` rule above.

**One assertion is deliberately deleted, not widened.** The current last test does `assert.deepEqual(new Set(meta.scope_kinds), IN_SCOPE_KINDS)` at line 94. Once `IN_SCOPE_KINDS` is *derived from* `meta.scope_kinds`, that assertion is a tautology and would give false comfort. The union / disjointness / ratchet trio replaces it and is strictly stronger.

**The same circularity, caught one field over.** Revision 1 asserted `kinds_added == IN_SCOPE_KINDS minus FAFF_319_KINDS`, where `IN_SCOPE_KINDS` derives from `meta.scope_kinds` — so copying `scope_kinds` and subtracting the eight passed regardless of what was actually triaged. That is the line-94 tautology reintroduced under a different name. The fix above binds `kinds_added` to the **entries** instead: a kind only counts as added if entries carrying `triage_ticket: "FAFF-670"` exist for it, and the per-kind set-equality test independently requires those entries to cover every case file of that kind.

**One of revision 2's own surviving majors is resolved, not carried.** Revision 2's self-review left standing a major finding: that the cross-ticket count coupling with FAFF-671 was owned by neither ticket's machinery, because the handling was a comment and comments are not a dependency mechanism. That finding is now false, in the best available way. FAFF-671 shipped `test/eval-readme-freshness.test.mjs`, so the coupling is owned by a CI test that runs on every `node --test test/` and fails the moment the corpus and the runbook disagree. A test *is* a dependency mechanism. The row that used to sit in the table below — "the FAFF-671 comment posted: checkable by nothing" — is deleted rather than softened, because the obligation it described no longer exists. Decision 13 states what replaced it.

**What still cannot be checked, stated plainly.** Two DONE criteria have no in-repo oracle and this spec does not pretend otherwise:

| Criterion | What a test can check | What it cannot |
|---|---|---|
| Three follow-ups **filed** | that `meta.follow_ups` values match `/FAFF-\d+/`, so the shape is right | that a ticket with that identifier exists in the tracker. `"FAFF-999"` passes the test. |
| `remaining_kinds` honestly reflects what was reached | that a non-empty list is matched by a follow-up naming the same kinds | whether a kind was unreached or dodged. See Decision 11. |

For both, the verification is the **reviewer's**, at ticket close, by opening the named tickets. Recorded here so nobody mistakes a green suite for confirmation that the tickets were filed.

**Anti-pattern:** writing a `remaining_kinds` follow-up value that names a ticket but not the kinds, e.g. `"FAFF-700"`. Why: the deferral-is-priced test compares the kind names inside that value against `remaining_kinds` as a set, so it fails. The value must read like `"FAFF-700 (untriaged: grouping, resolved-elsewhere)"`. This is deliberate friction — the whole point of the check is that deferring costs an enumeration.

### The four pilot-referencing sites in `test/score-error-rates.test.mjs`

Under **deletion** these were not mechanical: the filename at line 167 has no counterpart in `eval/cases-seeded/`, and the `startsWith("holdout-seed-")` filters at lines 199 and 216 would go from 5 matches to 450, turning a unit test into a 450-case CLI run with per-case mock-judge JSONL synthesis. All confirmed — and all consequences of *deletion*, not of exclusion. Under relocation there is exactly one edit:

```
Line 31:  const CASES_DIR = join(HERE, "..", "eval", "cases");
      ->  const CASES_DIR = join(HERE, "..", "eval", "cases-pilot");
```

Site by site, with the end state stated:

| Site | What it does | After the one-line change |
|---|---|---|
| Line 167 | Reads `holdout-seed-neg-spec-satisfying-but-broken-elsewhere-001.json` by literal filename for the leakage test | The file is at that filename in `eval/cases-pilot/`. No rename. |
| Line 199 | `loadSeededCases(CASES_DIR).filter(id startsWith "holdout-seed-")`, asserts `>= 5` and one defective per stratum | Still exactly the same 5 files. No scale change. |
| Line 216 | Same filter, drives the CLI smoke over the pilot | Still 5 files, still ~277 ms (measured). No 450-case run. |
| Lines 231, 247 | `spawnSync` the scorer with `--cases-dir CASES_DIR` | Points at the pilot directory, 5 cases. Unchanged behaviour. |

`loadSeededCases` skips any case with `label == null`, and all five relocated files are labelled, so repointing at a five-file all-labelled directory changes the loaded set not at all. `eval/cases-seeded/` stays at 450 files, so the committed `n_positive: 90` / `n_negative: 360` denominators stay valid.

**The scorer's own default, which is a fifth site and not a test.** `eval/score-error-rates.mjs` defaults its case directory to `eval/cases/` in two places: `loadSeededCases(dir = join(HERE, "cases"))` at line 92, and the CLI fallback `argVal(argv, "--cases-dir") || join(HERE, "cases")` at line 237. `test/score-error-rates.test.mjs` never exercises those defaults — it always passes `--cases-dir` explicitly — so repointing the test alone hides the consequence rather than handling it. After the relocation, `node eval/score-error-rates.mjs <judgements.jsonl>` with no flag would load zero seeded cases and emit a report with `n_positive: 0` and `n_negative: 0`: a silent no-op that reads as a successful run, which is the same failure shape Decision 7 exists to remove from the FAFF-625 doc.

**Chosen:** repoint both defaults in `eval/score-error-rates.mjs` from `eval/cases/` to `eval/cases-pilot/` — line 92 and line 237, one path each. This is behaviour-preserving by construction: the five pilot fixtures are the only seeded cases that were ever in `eval/cases/`, so a no-flag scorer run finds exactly the same five cases after the move as before it. `eval/score-error-rates.mjs` is not on this spike's byte-untouched list (that list is `eval/grader.mjs`, `eval/run-evals.mjs` and `eval/seam-registry.json`), and it is not on the sweep's paid path, so the argument against touching `eval/run-evals.mjs` does not reach it. The alternative — leave the default pointing at a directory with no seeded cases in it — trades a two-line edit for a silent-zero report, which this spec has already argued is the worse deal.

**Anti-pattern:** repointing `CASES_DIR` at `eval/cases-seeded/`. Why: the `startsWith("holdout-seed-")` filter matches all 450 production cases, so the two CLI smoke tests become 450-case runs with synthesized JSONL inside the unit suite, and the leakage test's literal filename does not exist there (that corpus uses domain-suffixed ids like `…-file-upload-002`).

### The three other test edits, and the three data/doc edits

**`test/cases-seeded-lint.test.mjs` line 21** — `PILOT_DIR` points at `eval/cases/` and is used at line 68 to assert `eval/cases-seeded/` ids are disjoint from the pilot's. After the relocation this test would still *pass*, but it would be guarding nothing, because the pilot ids are no longer in the directory it scans. Repoint `PILOT_DIR` to `eval/cases-pilot/` — one line, and it preserves the check's meaning. The reviewer confirmed this: revision 1 was right and the earlier review was wrong.

**`test/eval-grader.test.mjs` line 714** — `assert.equal(cases.length, 84)` becomes 79.

**`test/eval-grader.test.mjs` around line 709** — the FAFF-563 comment block describes five files that will no longer be in the directory this test loads. Rewrite it to say the pilot fixtures relocated to `eval/cases-pilot/` under FAFF-670 so the sweep's flat per-kind mean is not shaped by a labelled corpus, and to say the kind's remaining two cases are FAFF-317's. The two kind-coverage loops below it need no edit — `holdout-exercise` still has 2 cases, satisfying both the `kinds.has(k)` list and the `>= 2` list, and both lists include it.

**`eval/README.md`, four count-bearing sites** — the runbook's point 4 at lines 190-192 (`**84** live case files`, `≈ **1,680** frontier reps`, `≈ **4,200** reps`), line 18's `~1,680–4,200-run` range, line 39's Pieces-table row `(84 files across 29 kinds)`, and line 103's `84 cases × K=20 base ≈ 1,680 reps, escalating toward 4,200`. Every `84` becomes `79`, every `1,680` becomes `1,580`, every `4,200` becomes `3,950`. The `29` on line 39 and the `15 of the 29 kinds` on line 153 stay exactly as written, because neither derived fact moves. Only the runbook site is machine-enforced — `test/eval-readme-freshness.test.mjs` scopes its containment check to the `## Re-baseline runbook` section, which begins at line 151 — but leaving three stale copies of the same number in a file this PR already has open is the failure the guard exists to catch. Decision 13 argues it.

**`eval/baselines/frontier.json`, `policy.warn_kinds`** — add `"holdout-exercise"` alongside `"confidence"`, with no other change to the file. `test/eval-baseline-gate.test.mjs:111-112` asserts only that `policy.warn_kinds` is an array that *includes* `"confidence"`, so this stays green. Decision 12 argues why.

**The FAFF-625 design doc, two lines** — line 27's inputs-table path becomes `eval/cases-pilot/holdout-seed-*.json (5)`, and line 183's smoke command gains `--cases-dir eval/cases-pilot`, or is replaced by the mock-driver test path that same clause already offers as the alternative. Prefer the mock-driver path: it removes a paid-rep command from a doc an operator reads on their way to a paid sweep, which is the whole reason this edit exists. Decision 7 argues why the FAFF-671 precedent does not cover it.

### Why `faff validate-adapters` is not disturbed

Stated once, because a reader otherwise cannot tell whether its exit 0 means it ran or passed vacuously. The `(eval coverage)` check at `plugin/skills/faff/bin/lib/validate-adapters.js` lines 786–795 reads `eval/seam-registry.json`, and for each registry kind counts files in `eval/cases/` whose **filename starts with `<kind>-`**; a kind whose registry status is `covered` with zero such files is a FAIL with the exact string `FAIL eval/cases/<kind> (eval coverage)`. The five pilot files are named `holdout-seed-*`, which never matched the `holdout-exercise-` prefix, so they never contributed to that count in the first place — before the move it was 2, after the move it is 2. `holdout-exercise` is registry-status `covered` (line 26 of the registry), so this is the check that would have caught removing the kind's real cases, and it is genuinely exercised rather than passing on an empty set.

### Failure modes

**The relocation does not actually exclude the pilot from the sweep.** Some path this spec has not found loads `eval/cases-pilot/` — a glob over `eval/cases*`, a config entry, a CI job.
*How you'd know:* Assumption A's validation. Call `loadCases()` with no argument after the move and count. It must return 79, and no `holdout-seed-*` id may appear. A grep for `eval/cases` across `.mjs`, `.json`, `.yaml` currently finds only `test/` consumers and the FAFF-625 `--cases-dir` flag, so the risk is low — but it is the assumption the whole ticket rests on.
*What it means:* if the count is not 79, the mechanism has failed and the spike must not close. The `AssumptionCheck` for A records `result: "fail"` and the build stops — it does not commit and switch to deletion under time pressure.

**The `holdout-exercise` row is built from two cases and its gate signal is misleading, not merely coarse.** Two cases can only produce accuracy 0.0, 0.5 or 1.0. Because `diffAgainstBaseline` fails on a drop against a closed-set tolerance of 0.0, one case flipping wrong is a 0.5 drop and an unconditional gate failure — too thin to detect gradual degradation and too sensitive to absorb a single-case wobble at the same time.
*How you'd know:* a `holdout-exercise` FAIL on a sweep where every other kind is flat, traceable to one case.
*What it means:* this is why Decision 12 puts the kind in `warn_kinds`. The regression is still reported in the gate output with its delta, so the signal is not lost; it just does not fail a run on a one-case flip. This is the `confidence` precedent applied to the same problem for the same stated reason, and the follow-up that authors more real `holdout-exercise` fixtures is also the follow-up that removes the warn entry.

**The `warn_kinds` entry outlives its justification and quietly weakens the gate.** A kind parked in `warn_kinds` for fixture thinness stays parked after the fixtures arrive.
*How you'd know:* `holdout-exercise` has more than two cases in `eval/cases/` while still appearing in `policy.warn_kinds`.
*What it means:* the fixture-widening follow-up owns removing it, and the follow-up's own acceptance says so. This spike does not add a test for it, because the condition can only be evaluated after work this spike explicitly does not do — asserting it now would be a test that fails on the day the follow-up succeeds.

**The static triage is systematically wrong in a way a static method cannot see.** Judging an oracle against its own fixture and grader arm catches self-inconsistency; it cannot catch an oracle that is coherent but does not match what a competent model would actually answer.
*How you'd know:* the sweep produces low accuracy on a kind this triage classed `sound` across the board.
*What it means:* proceed. This is the known limit of the FAFF-319 method, it is why `needs-evidence` and `suspected-genuine-miss` are classes at all, and it is what FAFF-615 resolves from the captures. A `sound` verdict here means "no defect visible statically", not "measured correct" — and the rationales should be written so a reader can tell the difference.

**A kind is declared `remaining` when it was actually dodged.** Decision 11's accepted residual risk.
*How you'd know:* not from this repo. From FAFF-614's sweep, which writes a `per_kind` row for every kind in `eval/cases/` regardless of triage, and from FAFF-615's read over the captures, where an untriaged kind with poor accuracy has no triage entry behind it to explain itself.
*What it means:* the follow-up ticket that `remaining_kinds` forces already names the kinds, so the next pass inherits an explicit list rather than a silent gap. That is the mitigation; it is not a proof.

**The timebox expires with `explanatory-order` half-done.** Kinds are atomic in step 5, so a kind is either fully entered and in `scope_kinds`, or fully absent and in `remaining_kinds`.
*How you'd know:* the per-kind set-equality test fails for that kind.
*What it means:* finish the kind or revert its partial entries and leave it in `remaining_kinds`. Never leave a kind straddling — the union constraint permits it but the per-kind equality will not.

### Anti-patterns for the whole build

**Anti-pattern:** skipping, stubbing, `t.skip`-ing, or deleting any test in `test/score-error-rates.test.mjs` to get past step 2. Why: that file guards `scoreErrorRates`, `loadSeededCases` and `perCriterionClasses` — the machinery that measures the holdout judge's false-pass rate, the only quantitative check on the evaluator that gates other work. Disabling it erodes that surface silently and nothing downstream notices. If the repoint does not go green, stop and escalate; do not route around it.

**Anti-pattern:** reaching a set-equality failure and resolving it by removing a case file, omitting a kind from the artifact, or editing `meta.case_count` to whatever makes the assertion pass. Why: a failing set-equality test is reporting a real discrepancy between the artifact and the corpus, and every one of those three moves converts a discovered problem into a hidden one. `case_count` is counted from `entries.length`, so hand-editing it can only ever make it wrong.

**Anti-pattern:** recording an `AssumptionCheck` with `result: "pass"` and a `detail` describing a failure. Why: this is the exact hole the reviewer found in revision 1's free-text array — a failed assumption written as a passing-shaped string kept the gate green. The `result` field exists to be the verdict; the `detail` explains it. If the detail describes something that did not hold, the result is `"fail"`, and a `"fail"` never reaches a commit because step 1 stops the build.

**Anti-pattern:** touching anything in `eval/README.md` beyond its four count-bearing sites — or skipping those four. Why: both halves are traps. Skipping them leaves `node --test test/` red at `test/eval-readme-freshness.test.mjs` and hands the operator a runbook whose stated costs are wrong at the moment they are budgeting for the sweep. Going the other way and reworking the runbook's prose re-opens a document FAFF-671 has just finished correcting, immediately before a human opens it for a multi-hour, real-money run. Change the numbers; change nothing else.

**Anti-pattern:** getting `test/eval-readme-freshness.test.mjs` green by editing the test, widening its section scope, or skipping it. Why: that test is the only thing joining this spike's corpus change to the instructions the operator will follow into FAFF-614. A red result from it is the guard working — the fix is always the README number, never the assertion. The test's own failure message says as much.

**Anti-pattern:** adding the empty-case-set guard to `eval/run-evals.mjs` while you are in there fixing the FAFF-625 command. Why: it is a real defect and it is filed, but `run-evals.mjs` is the file that spends the money, and this spike's entire argument is that the sweep's executable path does not change in the week before the sweep. Fixing the doc removes the reachable trap; the guard removes the class, and it can wait for a ticket that is not blocking a paid run.

---

## 5. Scenarios

> 5 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the five holdout-seed-*.json files have moved to eval/cases-pilot/
When loadCases() is called with no argument
Then it returns 79 cases, none of whose ids begin with "holdout-seed-",
  and holdout-exercise is represented by exactly holdout-exercise-001
  and holdout-exercise-002
```

```
Given eval/cases-pilot/ holds the five relocated fixtures unchanged
When test/score-error-rates.test.mjs runs with CASES_DIR repointed
Then all 9 tests in that file pass, the pilot-corpus test still sees
  exactly 5 fixtures spanning all four defect strata, and the CLI smoke
  still runs over 5 cases rather than 450
```

```
Given the reworked test/oracle-triage.test.mjs, meta.scope_kinds holding
  only the FAFF-319 eight, meta.remaining_kinds holding all seven new
  kinds, and NOT ONE new triage entry written
When node --test test/oracle-triage.test.mjs runs
Then the suite is GREEN — this is the worst case of the timebox, and it
  is the state the whole degradation design exists to make survivable
```

```
Given a triage pass that completed three of the seven new kinds before
  the timebox expired, and a follow-up ticket naming the other four
When node --test test/oracle-triage.test.mjs runs
Then the suite is GREEN, meta.scope_kinds holds the FAFF-319 eight plus
  those three, meta.remaining_kinds holds the other four, their union is
  exactly the fifteen target kinds, and meta.follow_ups.remaining_kinds
  names a FAFF ticket listing those same four kinds
```

```
Given a completed triage pass covering all seven new kinds
When meta.case_count is compared against entries.length
Then they are equal, and the value is 41
```

```
Given meta.extensions holds a FAFF-670 record whose kinds_added was
  copied from meta.scope_kinds minus the FAFF-319 eight, but no entries
  carrying triage_ticket "FAFF-670" were ever written
When node --test test/oracle-triage.test.mjs runs
Then the extension-record test FAILS, because kinds_added is compared
  against the kinds actually carried by FAFF-670 entries, not against
  the artifact's own scope declaration
```

```
Given the five holdout-seed-*.json files have moved to eval/cases-pilot/
  and eval/README.md's counts have been updated to 79 / 1,580 / 3,950
When node --test test/eval-readme-freshness.test.mjs runs
Then both its tests pass: the runbook section contains "79", "29",
  "1,580", "3,950" and "15", and base_total / worst_total still equal
  case_count x BASE_REPS / MAX_REPS
```

Non-functional assertions:

- The artifact MUST record `meta.paid_model_reps === 0`, and a test MUST assert it strictly.
- Every entry MUST carry a `triage_ticket` matching `/^FAFF-\d+$/`; the existing 29 backfill to `"FAFF-319"`.
- Every `suspected-genuine-miss` entry MUST carry an `expected_signal` over 20 characters, and no entry of any other class may carry one. The three existing such entries are backfilled.
- Every `AssumptionCheck` in the committed artifact MUST have `result === "pass"`.
- No file under `eval/cases-seeded/` is created, deleted or modified — the committed `eval/error-rates/2026-07-25-offline-frontier.json` denominators (`n_positive: 90`, `n_negative: 360`, against 450 files) stay valid.
- `eval/grader.mjs`, `eval/run-evals.mjs` and `eval/seam-registry.json` are byte-untouched. `eval/baselines/frontier.json` changes by exactly one array element in `policy.warn_kinds` and nothing else. `eval/README.md` changes only where it states a corpus-derived count — every `84` becomes `79`, every `1,680` becomes `1,580`, every `4,200` becomes `3,950`, and no other character of that file moves.

---

## 6. Design decision rationale

**Should a labelled seeded-defect corpus shape a regression-gate row?**
Options: leave the five pilot fixtures in the sweep (zero work, and they *do* exercise the same grader arm); or exclude them so the row reflects the two real exercises. Leaving them means five of seven cases in a flat equal-weight mean come from fixtures built to probe a judge's false-pass rate, not to test the skill's judgement — a row that measures neither question cleanly, frozen until someone pays for another sweep. FAFF-563's design explicitly says the gate stays untouched, and FAFF-625 has already replaced the pilot with 450 cases in a directory the sweep never reads.
**Chosen:** exclude. The row is `holdout-exercise-001` and `-002`.

**What mechanism excludes them?**

| Mechanism | Verdict |
|---|---|
| Relocate to a new `eval/cases-pilot/` directory | **Chosen.** Follows the `eval/cases-live/` precedent — a sibling case directory the black-box sweep never reads. Preserves the five files as the FAFF-563 authoring template both FAFF-563 and FAFF-625 document. Reduces every test consumer to a one-line path swap. Fully visible and reversible in git as a rename. |
| Delete the five files | **Rejected.** Strands the FAFF-625 design doc on paths that no longer exist, destroys the documented authoring template, and turns four test sites into a rework with no specifiable end state (a filename with no counterpart, and two filters going from 5 to 450 matches). Deletion buys nothing relocation does not. |
| A `skip` / `disabled` field on the case file, filtered by `loadCases` | **Rejected.** `validateCase` in `eval/grader.mjs` (line 345) has no such concept — verified — so this adds a new schema idea on the critical path of a sweep about to run for real money. |
| Move them into `eval/cases-seeded/` | **Rejected.** That corpus grows 450 → 455, desynchronising the committed `eval/error-rates/2026-07-25-offline-frontier.json` denominators and the floor counts in `test/cases-seeded-lint.test.mjs`. It also mixes the hand-authored pilot into a generated corpus. |

**Where does the triage live — extend, or a sibling artifact?**
A sibling artifact keeps FAFF-319's file frozen and avoids touching a landed deliverable. But then two files answer the same question with two shapes, `test/oracle-triage.test.mjs` needs a twin, and any consumer must know to read both. FAFF-319's meta already carries `scope_kinds` and `follow_ups`, which is precisely the vocabulary for saying "this artifact has grown".
**Chosen:** extend in place, with an `extensions` array so each widening pass is attributable and its origin commit is recorded and checkable.

**How is `case_count` established — a literal, or counted?**
Revision 0 stated 40 as a literal. The true complete-pass figure is 41, and nothing in the repo asserts `meta.case_count` today, so the spec text was its own and only oracle. A literal in a spec is also a number that goes stale the moment a case file is added.
**Chosen:** counted at build from `entries.length`, machine-asserted equal. 41 appears in this spec as a derivation for the reader's calibration, explicitly not as an input.

**Where does the completeness test get its scope?**
Hardcoding fifteen makes the timebox story false: the test would demand entries for all 41 in-scope cases regardless of what the artifact claims, so a partial pass is a red suite. Deriving scope from `meta.scope_kinds` makes the artifact's own declaration the thing under test, and converts the flat union-level equality into a per-kind check. The risk of deriving is that the artifact goes green by declaring nothing; the ratchet and the union constraint close that.
**Chosen:** derive, with `TARGET_KINDS` hardcoded as the spike's scope declaration and the ratchet as the anti-bypass.

**Who owns `TARGET_KINDS` when its meaning goes stale?**
The constant means "the fifteen kinds with no `per_kind` row". After FAFF-614 re-baselines, every kind in `eval/cases/` gets a row, so the constant stops describing anything true while continuing to make the union assertion pass. Two options. A two-directional assertion (`TARGET_KINDS` exactly equals the currently-ungated set) turns the suite red the day FAFF-614 lands — an unacceptable trap on the sweep this ticket exists to unblock. A one-directional assertion (`ungated ⊆ TARGET_KINDS`) never fails on re-baseline but does fail loudly if a *new* ungated kind appears, which is the case worth catching.
**Chosen:** the one-directional assertion, plus a comment in the test file naming FAFF-614 as the trigger to retire the constant, and a follow-up ticket that owns the retirement. Naming the owner is the honest half of this: the check does not make the meaning fresh, it only stops the set silently under-covering.

**Is the FAFF-625 design doc edited?**
Revision 1 said no, on the FAFF-671 precedent, and reasoned that relocation reduced the two references "from a dangling path to a moved one" whose blast radius was "a smoke command that fails loudly, not data loss". Both halves are false against the tree. Line 27 is a glob resolving to zero files after the move, not a moved path. And line 183's command does not fail loudly: the plain sweep resolves the driver, loads cases, then applies `--only`, with no case-count check in the file, so a zero-match `--only` sweeps nothing, prints a summary and exits 0. The remedy revision 1 itself suggested — appending `--cases-dir eval/cases-pilot` — makes it worse, because that flag exists and the command then runs a real paid frontier rep, reachable by copy-paste from a stale doc by an operator heading into FAFF-614's paid sweep.

The FAFF-671 precedent covers a landed doc's record of what was decided. A command a doc instructs the next operator to run at build start is not a record; it is an instruction, and a wrong instruction that silently succeeds is worse than one that errors. The alternative fix — guarding `--driver frontier` against an empty case set in `run-evals.mjs` — is the better long-term answer and is filed, but it changes the executable path of the file that spends the money, in the week before it spends it, which is the one thing this spike's own principles forbid.
**Chosen:** edit the two lines in the FAFF-625 doc (the glob and the smoke command, preferring its already-offered mock-driver alternative over a paid rep), leave everything else in that doc alone, and file the `run-evals.mjs` empty-case-set guard as a follow-up.

**`remaining_kinds` is self-declared. Should it be?**
The three shape constraints — union, disjointness, ratchet — verify that the declaration is *well-formed*, not that it is *true*. A build agent can decline to triage an awkward kind, declare it `remaining`, and nothing in the repo distinguishes that from running out of day. `assumption_checks` does not close the gap either: even restructured, it records what was probed at step 1, not what was completed at step 5.

Three options. Ignore it — but this is the field by which a red suite becomes green under timeout, and self-report is the thing a completeness gate normally exists to check rather than trust. Try to measure effort — a wall-clock or step-count field is equally self-reported and adds a second lie surface for no gain. Or make deferral cost something visible.
**Chosen:** accept the self-declaration, make it expensive and attributable, and say so out loud. A non-empty `remaining_kinds` must be matched by a `meta.follow_ups.remaining_kinds` value naming a filed ticket **and enumerating exactly those kinds**, asserted as a set — so deferring is no longer a quiet omission but a ticket someone has to write with the awkward kind's name in it. The backstop that would catch actual abuse is outside this repo and named as such: FAFF-614 writes a `per_kind` row for every kind in `eval/cases/` whether triaged or not, and FAFF-615's read over the captures surfaces a poorly-performing kind with no triage entry behind it. This spec claims no more than that.

**The `holdout-exercise` gate row is built from two cases. Keep, drop, or soften?**
Four options, and revision 1 only weighed two.

| Option | Verdict |
|---|---|
| Keep the five pilot seeds so the row has seven cases | **Rejected**, per Decision 1. Five-sevenths of a flat mean measuring a different question is worse than a thin row measuring the right one. |
| Keep the two-case row as-is and call it accepted coarseness | **Rejected.** This was revision 1's position and it understated the cost. `diffAgainstBaseline` fails on a drop against a closed-set tolerance of 0.0 (line 268), so one case flipping is a 0.5 drop and an unconditional gate failure. That is misleading detection, not coarse detection. |
| Remove `holdout-exercise` from the gate entirely until real fixtures exist | **Rejected**, on three concrete tree facts rather than on preference. Removing the kind from the gate means removing its cases from `eval/cases/`; `test/eval-grader.test.mjs`'s ≥2-cases-per-kind convention list at line 720 *includes* `holdout-exercise`, so that assertion goes red; the registry marks the kind `covered` (line 26), so `faff validate-adapters` emits `FAIL eval/cases/holdout-exercise (eval coverage)`; and un-marking it would mean editing `eval/seam-registry.json`, which this spike explicitly does not touch and which FAFF-616 owns. The option is coherent but it is a different, larger ticket. |
| Keep the kind in the gate and list it in `policy.warn_kinds` | **Chosen.** This is the repo's own existing answer to this exact shape. Line 233 documents `warn_kinds` as orthogonal to grader class, and `confidence` sits there today as "closed-set-graded but empirically flaky per ADR-0004, **pending fixture widening**" — the same sentence with a different cause. The regression still appears in the gate output with its delta, so the signal is reported rather than lost; it just does not fail a run on a one-case flip. The edit is one array element; `test/eval-baseline-gate.test.mjs:112` checks only that `warn_kinds` *includes* `confidence`, so it stays green; and `foldInAndWriteBaseline` writes `policy: prevPolicy` (line 417), so the entry made now survives FAFF-614's re-baseline rather than being erased by it. The fixture-widening follow-up owns removing it. |

**Is a defective oracle fixed here, or deferred?**
FAFF-319's precedent was to fix the clear ones (`architecture-002`, `roadmap-002`) and leave the rest for sweep evidence. That line holds: a defect visible in the fixture text with a fix contained to oracle values costs nothing to correct and removes a known-bad input before the sweep; a defect that turns on how a model actually answers cannot be resolved without the captures FAFF-615 will read. Revision 1's version of this rule was unenforceable, because `suspected-genuine-miss` had no required field — and the existing test at line 77 actively forbids the field revision 1's DONE asked for.
**Chosen:** fix iff decidable from the fixture text alone with a contained oracle-values fix; otherwise `needs-evidence` with a `discriminating_question`, or `suspected-genuine-miss` with an `expected_signal`. Both classes now have a required field and a present-iff assertion, so "no unresolved observation" is checkable rather than aspirational.

**Does this spike edit `eval/README.md`, and how far?**
Revision 2 said no, on the ground that FAFF-671 owned the file and that two tickets editing one runbook is a merge conflict on the document standing between a human and a paid sweep. The reasoning was sound and the situation has moved: FAFF-671 merged on 2026-07-29 as PR #503 (`485b3f5`). There is no second ticket left to conflict with. There is a test instead.

Three options. **Leave the README alone** — no longer available, because `test/eval-readme-freshness.test.mjs` derives `case_count`, `base_total` and `worst_total` from `loadCases()`, `BASE_REPS` and `MAX_REPS`, so the relocation turns `node --test test/` red and the spike cannot close green. **File a follow-up to correct the README afterwards** — this leaves `main` red between the two merges, which is the state a merge gate exists to prevent, and it hands the operator a runbook whose costs are wrong at exactly the moment they are budgeting for the sweep. **Make the edit in this spike's own PR.**
**Chosen:** make the edit here, confined to the numbers. Every `84` becomes `79`, every `1,680` becomes `1,580`, every `4,200` becomes `3,950`; `29` and `15` stay, because neither derived fact moves. Four sites, one machine-enforced and three not. No prose in that document is reworked — FAFF-671 has just finished getting it right, and the operator opens it next.

**FAFF-677's leftover README range — take it here, or leave it there?**
FAFF-677 was originally the split-out freshness guard. The guard shipped inside FAFF-671 instead, and FAFF-677 has since been rewritten down to the residue: a durable `--selftest`-style proof-of-failure for the guard, plus the separately-stale rep range at `eval/README.md:18`, which sits outside the section the guard scopes to. Both of its `blockedBy` edges are gone, and its open question notes that the range could ride along with whatever next touches `eval/README.md`. That is this ticket.
**Chosen:** take the `eval/README.md:18` range here, along with the two other unguarded sites at lines 39 and 103, and leave the proof-of-failure check with FAFF-677. The range edit is a handful of characters in a file this PR already has open, and shipping a change that corrects the guarded copy of a number while leaving three unguarded copies of the same number wrong is precisely the failure the guard was built to catch. The proof-of-failure check is different work — a test that proves a test fails — and it gets no cheaper by being done here.

**Where do follow-ups live so "recorded a follow-up" is checkable?**
Prose in a rationale would satisfy the words and nothing else. A `/FAFF-\d+/` assertion on `meta.follow_ups` values catches the shape but not the filing — `"FAFF-999"` passes while nothing exists in the tracker.
**Chosen:** a filed tracker ticket plus a `meta.follow_ups` key naming it, matching FAFF-319's existing shape, with a test asserting every value matches `/FAFF-\d+/` — and Section 4's table stating plainly that the *filing* half is reviewer-verified at close, not machine-checkable in-repo. Four follow-ups are known in advance: the `run-evals.mjs` empty-case-set guard; the `chain-gap` / `resolved-elsewhere` fractional-tolerance-on-a-binary-grade mismatch; the fixture widening for single-case `grouping`, single-case `resolved-elsewhere` and two-case `holdout-exercise`, which also removes the `warn_kinds` entry and retires `TARGET_KINDS`; and, conditionally, the `remaining_kinds` ticket if the timebox bites.

---

## 7. Open questions and assumptions

**Open questions:** none. Every decision in this spec is closed. The ticket's two original open questions — the excluding mechanism, and fix-here-versus-wait — are answered by Decision 2 and Decision 8.

**Assumptions** — validate all three at step 1 and record each as a structured `AssumptionCheck { assumption, result, detail }`. If any result is `"fail"`, stop and escalate; do not commit.

**Assumes:** `loadCases()` reads only `eval/cases/` by default, so a sibling directory is genuinely outside every sweep, gate and re-baseline path.
*Validation:* after the `git mv`, call `loadCases()` with no argument and assert it returns 79 cases with no id beginning `holdout-seed-`. Additionally grep `eval/cases` across `*.mjs`, `*.json`, `*.yaml`, `*.yml` and confirm every hit is either a `test/` consumer or the FAFF-625 `--cases-dir` flag. At spec time this holds for the sweep: `loadCases` (line 82) defaults to `join(HERE, "cases")`, and the only non-default call site is the `--cases-dir` route at line 689, which is plain-sweep-only and explicitly not read by `--gate` / `--against` / `--update-baseline` / `--compare` (the guard is at line 670, the warning at line 671).

The grep does *not* come back clean, and the spec says so rather than claiming otherwise. Re-run at `ad8626b`, it returns one non-test, non-flag consumer: `eval/score-error-rates.mjs` defaults its own case directory to `eval/cases/` at line 92 (`loadSeededCases`) and line 237 (the CLI fallback). That is the scorer, not the sweep — it never writes a `per_kind` row and never rides the paid run — so Assumption A about the *sweep* still holds. Section 4 handles the scorer separately, by repointing both defaults to `eval/cases-pilot/`. Anything the grep turns up beyond those two files and the known `test/` consumers is a new consumer and stops the build for a decision.

**Assumes:** nothing outside `test/score-error-rates.test.mjs`, `test/cases-seeded-lint.test.mjs`, `test/eval-grader.test.mjs`, `eval/score-error-rates.mjs`'s two default-directory expressions, and the FAFF-625 design doc references the five pilot paths.
*Validation:* `grep -rn "holdout-seed" --include=*.mjs --include=*.json --include=*.md --include=*.yml .` excluding `node_modules`, `eval/cases-seeded/`, and the files themselves. Read every hit and classify it as (a) one of the known consumers, (b) prose that describes the pilot without depending on its location — `eval/gen-cases-seeded.mjs`'s comments naming it as the authoring template, and the landed design-doc records that mention it in passing (the FAFF-563 design doc at line 74, and the FAFF-671 runbook design doc at lines 80 and 186, which in fact anticipates this corpus change) — which need no edit, or (c) a new consumer, which stops the build for a decision. At spec time only (a) and (b) appear.

Two notes on the probe's reach, so a clean-looking result is not over-read. `test/cases-seeded-lint.test.mjs` is one of the known consumers but contains no literal `holdout-seed` string — it reaches the pilot only through `PILOT_DIR`, so this grep cannot confirm it and the `PILOT_DIR` repoint in Section 4 is what covers it. And `eval/score-error-rates.mjs`'s two `eval/cases/` defaults do not contain the string either; they are found by the Assumption A grep instead.

**Assumes:** the test suite is green at build start, so "green before and after" is a meaningful gate rather than an inherited failure.
*Validation:* run `node --test test/` before touching anything and record the result in the check's `detail`. At spec time the directly-affected files were run and are green; the full suite must be confirmed at build start. This explicitly includes `test/eval-readme-freshness.test.mjs`, which FAFF-671 added on 2026-07-29 and which is green on `main` at `ad8626b` because the runbook and the 84-file corpus currently agree. If that test is *already* red at build start, the corpus and the README are out of step for a reason this spike did not cause — stop and escalate rather than fixing it in passing, because the cause matters more than the number.

**A note on FAFF-677, which is not an assumption but is easy to mistake for one.** FAFF-677 no longer blocks anything and is not blocked by anything: its `blockedBy` edges were removed when the freshness guard shipped inside FAFF-671. After its rewrite it covers only the residue — a durable proof-of-failure check for the guard, and the stale rep range at `eval/README.md:18`. This spike takes the range (Section 6 argues why) and leaves the proof-of-failure check. Nothing in this spec waits on FAFF-677, and FAFF-677 does not wait on this.

---

## 8. DONE

### From WHY (the composition problem)
- [ ] `eval/cases/` contains 79 case files across 29 kinds; no file whose id begins `holdout-seed-` remains in it.
- [ ] `eval/cases-pilot/` contains exactly the five relocated fixtures, verified content-identical by a `git diff --cached --stat -M` across the move reporting five renames with zero insertions and zero deletions (or an equivalent sha256 comparison — record which was used).
- [ ] `loadCases()` with no argument returns 79 cases, of which exactly two have kind `holdout-exercise`: `holdout-exercise-001` and `holdout-exercise-002`.
- [ ] `eval/cases-seeded/` still holds 450 files, unmodified; `eval/error-rates/2026-07-25-offline-frontier.json` is untouched.

### From WHAT (the artifact)
- [ ] `eval/calibration/oracle-triage.json` carries `meta.remaining_kinds`, `meta.paid_model_reps`, `meta.extensions` and `meta.assumption_checks`; `meta.scope_kinds`, `meta.case_count`, `meta.class_counts` and `meta.follow_ups` are updated.
- [ ] `meta.scope_kinds ∪ meta.remaining_kinds` is exactly the fifteen target kinds, and the two lists are disjoint.
- [ ] `meta.scope_kinds` contains all eight FAFF-319 kinds.
- [ ] `meta.case_count === entries.length`, and `meta.class_counts` sums to the same number. On a complete pass both are 41.
- [ ] `meta.paid_model_reps === 0`.
- [ ] Every entry carries `triage_ticket` matching `/^FAFF-\d+$/`; the pre-existing 29 read `"FAFF-319"` and every new entry reads `"FAFF-670"`.
- [ ] Every `suspected-genuine-miss` entry carries an `expected_signal` over 20 characters — including the three pre-existing ones (`refutation-spec-007`, `-008`, `-009`), backfilled — and no entry of any other class carries one.
- [ ] `meta.extensions` contains a FAFF-670 record whose `kinds_added` equals the set of kinds carried by entries with `triage_ticket: "FAFF-670"`, with five `relocated_paths` whose `to` files exist on disk, and an `origin_commit` matching `/^[0-9a-f]{7,40}$/` that resolves via `git cat-file -e <sha>^{commit}`.
- [ ] `meta.assumption_checks` holds at least three records, each with a named `assumption`, `result: "pass"`, and a `detail` over 40 characters stating what was run and what came back.
- [ ] Every entry names the envelope field and grade function it was judged against in `grader_shape`, and carries a rationale over 40 characters not interchangeable with any other entry's.

### From HOW (the completeness gate)
- [ ] `test/oracle-triage.test.mjs` derives `IN_SCOPE_KINDS` from `artifact.meta.scope_kinds`; no hardcoded in-scope set remains.
- [ ] The old `assert.deepEqual(new Set(meta.scope_kinds), IN_SCOPE_KINDS)` at line 94 is removed, replaced by the union / disjointness / ratchet trio.
- [ ] Set equality between entries and case files is asserted **per kind**, both directions.
- [ ] `TARGET_KINDS` is asserted as a superset of the currently-ungated kinds (one-directional, so FAFF-614's re-baseline does not turn the suite red), and the file carries a comment naming FAFF-614 as the trigger to retire the constant.
- [ ] A non-empty `meta.remaining_kinds` fails the suite unless `meta.follow_ups.remaining_kinds` names a FAFF ticket **and** enumerates exactly those kinds.
- [ ] `meta.extensions`'s `kinds_added` is asserted against the kinds carried by FAFF-670 entries, not against `meta.scope_kinds` — the circularity is gone.
- [ ] `origin_commit` is asserted for hex shape and repo reachability, not merely non-emptiness.
- [ ] `meta.assumption_checks` entries are asserted for `result === "pass"`, not merely for array length.
- [ ] Tests also assert `meta.case_count`, the `class_counts` sum, `paid_model_reps === 0`, `triage_ticket` on every entry, `expected_signal` present-iff-`suspected-genuine-miss`, and `follow_ups` values matching `/FAFF-\d+/`.
- [ ] The five unaffected FAFF-319 tests (per-class fields, common fields, stranger test, `supersedes`) still pass unchanged in substance.

### From HOW (the corpus relocation's consequences)
- [ ] `CASES_DIR` in `test/score-error-rates.test.mjs` points at `eval/cases-pilot/`; all **9** tests in that file pass with no fixture rename, no filter narrowing, and no runtime increase.
- [ ] `eval/score-error-rates.mjs`'s two default case-directory expressions — `loadSeededCases`'s parameter default at line 92 and the CLI fallback at line 237 — point at `eval/cases-pilot/`, so `node eval/score-error-rates.mjs <judgements.jsonl>` with no `--cases-dir` still loads the same five pilot fixtures it loads today rather than reporting `n_positive: 0` / `n_negative: 0` over an empty set.
- [ ] `PILOT_DIR` in `test/cases-seeded-lint.test.mjs` points at `eval/cases-pilot/`, so the `eval/cases-seeded/` disjointness check at line 68 still guards what it was written to guard.
- [ ] `test/eval-grader.test.mjs` asserts `cases.length === 79`, and its FAFF-563 comment block describes the relocation rather than five files sitting in `eval/cases/`.
- [ ] `eval/grader.mjs`, `eval/run-evals.mjs` and `eval/seam-registry.json` are byte-untouched. `eval/README.md` changes only where it states a corpus-derived count.
- [ ] `node --test test/` — `test/eval-readme-freshness.test.mjs` included — is green after the relocation step and before any triage entry is written, and green again at the end.
- [ ] `faff validate-adapters` exits 0 with no `(eval coverage)` FAIL. This is a real check, not a vacuous one: it counts files in `eval/cases/` whose name starts `holdout-exercise-` against the registry's `covered` status for that kind, and that count is 2 both before and after the move because the pilot files are named `holdout-seed-*` and never matched the prefix.

### From HOW (the argued data and doc edits)
- [ ] `eval/README.md`'s `## Re-baseline runbook` point 4 reads **79** live case files, ≈ **1,580** frontier reps and ≈ **3,950** worst-case reps, with the `29` kinds and the `15`-kind gate gap unchanged; `node --test test/eval-readme-freshness.test.mjs` passes both its tests. This is machine-checkable, and it replaces revision 2's comment-on-FAFF-671 criterion.
- [ ] The three count-bearing sites outside the guard's section scope are updated in the same edit: `eval/README.md` line 18 reads `~1,580–3,950-run`, line 39's Pieces row reads `(79 files across 29 kinds)`, and line 103 reads `79 cases × K=20 base ≈ 1,580 reps, escalating toward 3,950`. No other character of `eval/README.md` changes.
- [ ] `eval/baselines/frontier.json` `policy.warn_kinds` reads `["confidence", "holdout-exercise"]`; nothing else in that file changes, and `test/eval-baseline-gate.test.mjs` stays green.
- [ ] The FAFF-625 design doc's inputs-table entry at line 27 names `eval/cases-pilot/holdout-seed-*.json (5)`, and its `**Assumes:**` clause at line 183 no longer instructs an operator to run a frontier rep that would sweep zero cases — it points at the mock-driver path, or carries `--cases-dir eval/cases-pilot`. No other line of that document is touched.

### From HOW (timebox and follow-ups)
- [ ] If the timebox expired, every unreached kind appears in `meta.remaining_kinds`, the suite is green, and `meta.follow_ups.remaining_kinds` names a filed ticket enumerating exactly those kinds.
- [ ] Three follow-ups are named in `meta.follow_ups`: the `eval/run-evals.mjs` empty-case-set guard; the `chain-gap` / `resolved-elsewhere` fractional-tolerance-on-a-binary-grade mismatch; the fixture widening for `grouping`, `resolved-elsewhere` and `holdout-exercise`, which also owns removing the `warn_kinds` entry and retiring `TARGET_KINDS`.
- [ ] **Reviewer-verified, not machine-checkable:** those three tickets actually exist in the tracker. The test asserts only that the recorded values match `/FAFF-\d+/`; `"FAFF-999"` would satisfy it. The reviewer opens each named ticket at close.
- [ ] **Resolved, no longer a criterion.** Revision 2 required a comment on FAFF-671 recording the new counts, flagged reviewer-verified-not-machine-checkable. FAFF-671 merged on 2026-07-29 as PR #503 and brought `test/eval-readme-freshness.test.mjs` with it, so the count coupling is enforced by CI and discharged by the `eval/README.md` edit above. There is nothing left for a comment on a closed ticket to do.
- [ ] No triage entry is left as an unresolved observation: every entry is `sound`, or `oracle-defect` with an applied `proposed_fix`, or `needs-evidence` with a `discriminating_question`, or `suspected-genuine-miss` with an `expected_signal`. Each of those four states has a present-iff assertion, so this criterion can fail.

### Integration smoke test

```
1. git mv the five eval/cases/holdout-seed-*.json to eval/cases-pilot/
2. git diff --cached --stat -M -> 5 renames, 0 insertions, 0 deletions
3. node -e 'loadCases()' -> 79 cases across 29 kinds, no "holdout-seed-"
   id present
4. Apply the three test repoints (CASES_DIR, PILOT_DIR, 84 -> 79)
5. node --test test/eval-readme-freshness.test.mjs -> RED. It asserts
   fact by fact and throws on the first miss, so expect it to name
   case_count "79" as absent from the "## Re-baseline runbook" section
   and stop there, without reaching base_total or worst_total. This is
   the FAFF-671 guard catching the corpus change — expected here, not a
   defect, and the reason step 6 exists.
6. Edit eval/README.md: 84 -> 79, 1,680 -> 1,580, 4,200 -> 3,950 at
   lines 18, 39, 103 and 190-192.  Leave 29 and 15 alone.
7. node --test test/  -> GREEN, freshness guard included
8. Add "holdout-exercise" to policy.warn_kinds; fix the two FAFF-625
   doc lines
9. node --test test/  -> GREEN
10. Rework test/oracle-triage.test.mjs to derived scope; backfill
    triage_ticket on 29 entries and expected_signal on 3; seed
    meta.remaining_kinds with all seven new kinds
11. node --test test/oracle-triage.test.mjs -> GREEN with ZERO NEW
    triage entries written  (the degradation story, proven at its worst
    case before any triage work is done — this is Scenario 3)
12. Triage explanatory-order: 2 entries, move the kind from
    remaining_kinds to scope_kinds, recompute case_count (-> 31)
13. node --test test/oracle-triage.test.mjs -> GREEN
14. Deliberately delete one of those two entries
15. node --test test/oracle-triage.test.mjs -> RED, naming the missing
    case_id and its kind  (the per-kind check working)
16. Restore the entry -> GREEN. The plumbing is connected.
```

confidence: medium
