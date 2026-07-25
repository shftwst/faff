# holdout-verdict.json (shipped as `holdout.json`)

**Naming discrepancy (documented, not fixed).** The ticket and the contract call this
`holdout-verdict.json`; the shipped file is `<run-dir>/<issue>/holdout.json`. The shipped
artifact wins — this page documents `holdout.json` — and this note exists so the
discrepancy is visible rather than silently glossed. Renaming the shipped file was scoped
out of v0.1 (it would touch `merge-gate.js`, `faff-graft`, `governance-check.js`, and
`corrective-integrity` for zero behaviour gain).

**Purpose.** The per-issue floor artifact recording the L4 code-blind holdout evaluator's
verdict — whether the merged diff meets the spec, judged by an evaluator with no access
to the implementation. Only asserted under the L4 lights-out signal; L1–L3 provision no
holdout env and this artifact does not exist for those runs.

**Location & lifecycle.** `<run-dir>/<issue>/holdout.json`, written once by the
`holdout_step` (the shared L4 evaluator-lane routine `faff-graft`'s Step 10 holdout gate
invokes) after the code-blind evaluator returns. A copy is also written to the
run-agnostic roll-up `.faff/holdout/<issue>.json` — same content, two consumers, one
producer.

**Producer(s).** `holdout_step`, from the `evaluator` slot's verdict, code-blindness
asserted structurally via the spawner-attested envelope (FAFF-384) rather than the
judged process's self-claim.

**Consumer(s).** `faff holdout verdict --issue <id>` (the deterministic gate `faff-graft`
Step 10 asserts before the `ship` handoff), governance-check's L4 `merge_floor` leg
(reused via the same reader), `faff holdout verdicts --association` (the run-level
roll-up).

**Schema.** Existing `plugin/skills/faff/contracts/holdout-verdict.schema.json` —
referenced here, not copied.

**Integrity.** A single write per issue, torn down (env) on every exit path. Passing
requires **all** of: `code_blind: true`, the aggregate verdict `meets-spec`, and internal
coherence — a partial or malformed verdict never passes. Under a run whose
`lane-boundary.json` declares the evaluator cage, `code_blind` is derived from what was
provably withheld (a fresh, repo-blind OS process handed only the spec + an env-handle
endpoint), stamped `spawner_attested` — not the judged party's self-report.

**Fail direction.** Every non-`meets-spec` aggregate, a non-`code_blind` verdict, a
malformed verdict, or a **missing** verdict all block the merge (fail-closed) — a missing
file is never treated as "L4 doesn't apply here" once the lights-out signal is live.

**Example.** No `holdout.json` exists in this repo's own run history yet (no L4
lights-out run has completed here) — see the referenced contract's own shape for the
canonical example; this page will link a real one once one exists.
