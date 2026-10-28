# In-spec-ratification fixture set

The committed regression fixtures for the **in-spec human ratification** deferral clause — the
clause that lets a design lens read a `(ratified: human)` tag off a `**Chosen:**` line in the spec
body and record an otherwise-gating objection as an `observation` instead.

The load-bearing claim is an LLM-judgement outcome, not a mechanical one: that a design lens
actually reads the tag and downgrades the objection it settles, **and only that objection, never an
implementation-flavoured one**. Prose plausibility is not evidence for that class of claim, so these
fixtures are what the claim rests on. They are a **regression fixture set for an existing lens's
behaviour change**, the same class of artefact `../spec-judge-discrimination/` holds for the judge —
not a new grader seam, and not a permanently-wired CI eval.

## The fixtures

| File | Role |
|---|---|
| `spec-decision-untagged.md` | A minimal spec whose one design decision draws a `major` decision-level objection from the architectural lens. The pinned baseline. |
| `spec-decision-tagged.md` | Byte-identical to the above except `(ratified: human)` on that one `**Chosen:**` line. `diff <(sed 's/ (ratified: human)//' spec-decision-tagged.md) spec-decision-untagged.md` is empty by construction. |
| `spec-decision-critical.md` | A decision that draws a `critical`, with the tag applied. A lens that defers a `critical` on the strength of the tag fails here. |
| `spec-implementation.md` | A spec whose choice is sound but whose execution has a named gap, so the objection it draws is implementation-level. |
| `scope-test-objections.json` | The three objection claims the ratify offer's decision-vs-implementation scope test is run against, each with its expected classification as the oracle. Includes a decision-level positive control, so a scope test that always answers "no" cannot pass the set. |
| `decisions-fixture.md` | A `docs/decisions.md` body carrying one `ratified_tradeoff` entry for a synthetic issue, for the register round-trip check. |
| `run-log.md` | The pinned run variables and the recorded outcome of every check. |

## Running the checks

`run-log.md` holds the pin and the exact commands. In short:

- **The three spec variants** run through the occupant's own transport
  (`build-lens-requests.mjs` → `fan-out.mjs` → `review-call.mjs`) with `--system-dir` pointing at the
  occupant directory, so each run reads the `refute-<lens>.md` under test. Every run variable except
  the fixture file is pinned identically.
- **The scope-test cases** run the scope-test prose extracted verbatim from `faff-prep/SKILL.md` as
  the system brief, with one objection claim as the diff, and the answer is checked against the
  oracle in `scope-test-objections.json`. Running it as an independent pass rather than classifying
  the claims in the authoring context is the point: a gate that grades its own answer is no gate.
- **The contract-extraction check** derives the `decisions[]` extraction from each variant's
  line-anchored markers, pipes both through `faff contract spec-readiness`, and diffs the output
  byte-for-byte. A tagged `**Chosen:**` must emit exactly what an untagged one does.
- **The register round-trip** points `faff ratified-scope --assemble --root` at a directory holding
  `decisions-fixture.md` as `docs/decisions.md`, confirms the
  `### Ratified tradeoffs (docs/decisions.md)` subsection names the entry, and confirms
  `--validate` still passes.

## What these fixtures are not

They are not built, they name no real ticket, and nothing reads them at runtime. The specs inside
them are deliberately flawed — that is what makes them draw the objections the checks need. A defect
inside a fixture spec is the fixture working, never a defect in the shipped change.
