# FAFF-554 — Bless a string-only `outcomes` contract and an additive `outcome_details` sidecar

> Spec: faffter-dark-nlspec · 2026-07-20 · autonomous · confidence: high. Full spec on Linear FAFF-554.

This spec addresses FAFF-554, a run-ledger schema / authoring-ergonomics bug. Audience: the build agent implementing the fix, and human reviewers. It decides how a run author records *rich per-issue detail* (why/how an issue shipped) without tripping `faff runcheck` / `faff run-done`.

## 1. WHY — Problem and Principles

**The load-bearing model.** `run-ledger.json`'s `outcomes` map is a **completeness ledger**, not a detail store: its one job is to prove every admitted issue reached a terminal bucket (the invariant `admitted − outcomes.keys() == ∅`). `runcheck` reads each value as a bare terminal-state **string** and checks membership in a fixed vocabulary. Rich per-issue detail is a *different concern* and belongs beside the ledger, never inside a value the completeness check must interpret.

**Problem statement.** A run author naturally reaches for `outcomes[issue] = { state: "shipped", merged_head, satisfies, tests, … }` to record why/how an issue shipped; `auditLedger` then stringifies the object and logs `INVALID outcomes: <issue>=[object Object]`, and the downstream `ledger_clean` reads false. The natural place to record detail is schema-invalid, and the diagnostic is baffling. This change formally blesses a string-only `outcomes` contract plus an additive `outcome_details` sidecar, and makes the diagnostic explain the mistake.

**Design principles.**

- **No schema ripple.** `outcomes` values stay bare strings so nothing changes in `auditLedger` or the ~10 consumers that read `outcomes[issue]` as a string (`lights-out`, `quality`, `economics`, `disposition`, `budget`, `queue-state`, `governance-check`, `resume`, `state`, `audit`). Any design that widens the value shape is rejected on this principle — the blast radius is silent misclassification (worst case: `lights-out` resume treating a shipped issue as in-flight) for no functional gain.
- **The completeness invariant is sacred.** The sidecar must be *inert* to `runcheck` / `run-done` — outside the invariant, exactly like the existing orthogonal annotations (`review_adversarial_skipped`, `review_outage_pending`, `post_merge_verification_*`, `stop_reason`).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/runcheck.js` | JS (Node) | `auditLedger()` — the sole `outcomes` validator; where the `[object Object]` diagnostic is produced |
| `plugin/skills/faff-beep-boop/SKILL.md` (§ Run ledger, ~L338–360) | Markdown (canonical schema doc) | The load-bearing prose contract for the ledger shape and its orthogonal-annotation family |
| `plugin/skills/faff/bin/lib/run-done.js` | JS (Node) | Consumes `runcheck`'s precomputed `.clean` boolean; never reads `outcomes` directly |

**Scope statement.** This sits in the L3 run-ledger honesty backstop — the `outcomes` map that `runcheck`/`run-done` gate an unattended run on.

## 2. OUT OF SCOPE

- **Widening `outcomes` to accept objects (the ticket's option b).** *Why excluded:* touches ~10 string-reading consumers with silent-misclassification risk and dozens of test fixtures, for no functional gain over a sidecar. *Extension point:* none intended — the string-only contract is now blessed; a future need for structured state would be a new field, not a widened value.
- **Migrating the existing per-issue `merge-record.json`.** *Why excluded:* `merge-record.json` (ADR-0056) already homes merge-head detail written by the *build lane* (`merge-gate`) at merge time; it is a separate writer/timing and stays as-is. *Extension point:* `plugin/skills/faff/bin/lib/merge-gate.js`.
- **A `faff contract` validator or `faff` verb for `outcome_details`.** *Why excluded:* the sidecar is informational and untyped by design (like its annotation siblings); nothing gates on it. *Extension point:* if a consumer ever needs to read it, add a reader then — not now.
- **Changing the terminal-state vocabulary or the `events.jsonl` `ledger_outcomes` vocab.** *Why excluded:* unrelated to this bug.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| completeness invariant | `admitted − outcomes.keys() == ∅` — every admitted issue has a recorded terminal outcome |
| orthogonal annotation | An additive top-level ledger field that carries per-run/per-issue detail but is **outside** the completeness invariant (`runcheck` never gates on it) |

**The `outcomes` contract (unchanged in shape, now documented as fixed).**

```
run-ledger.outcomes : Map<IssueId, TerminalStateString>
  # value MUST be one of DELIVERY_PROFILE.terminal_states:
  #   "shipped" | "pr-open" | "parked" | "errored" | "routed-out" | "unreached-budget"
  # value MUST NOT be an object — rich detail goes in outcome_details (below)
```

**The `outcome_details` sidecar (new, additive, top-level).**

```
run-ledger.outcome_details : Map<IssueId, Object>   # OPTIONAL, informational
  # e.g. { "SHF-1": { "state": "shipped", "merged_head": "abc123",
  #                   "satisfies": [...], "tests": "...", "absorbed": [...] } }
  # - keyed by issue, mirrors an outcomes key when detail is worth recording
  # - free-form object; no fixed schema, no faff-contract validator
  # - OUTSIDE the completeness invariant: runcheck / run-done never read it
  # - absent by default (a run that records no detail simply omits it)
```

**Design decision — sidecar shape: top-level ledger field vs per-issue file.** The two in-repo precedents split by *writer*: build-lane detail written per-issue at merge time uses a file (`<run-dir>/<issue>/merge-record.json`, ADR-0056); orchestrator-written per-issue annotations recorded at the ledger use a top-level additive field (`review_adversarial_skipped` et al.). `outcome_details` is written by the **orchestrator at the same moment and by the same actor as `outcomes`**, so it follows the field precedent — no new file-path convention, no new reader plumbing, sits beside its annotation siblings. **Chosen:** a top-level additive `outcome_details` map on the ledger.

**Design decision — object-valued `outcomes` stays invalid, with a clearer diagnostic.** Option (a) means an object in `outcomes[issue]` is a genuine authoring error and must keep failing `runcheck` (exit 2) — silently accepting it would defeat the string-only contract. What changes is the *message*: instead of `<issue>=[object Object]`, `runcheck` detects an object (or any non-string) value and points the author at the sidecar. **Chosen:** keep object-valued outcomes invalid; replace the stringified diagnostic with a targeted one naming `outcome_details`.

**Design decision — where the contract is documented.** The canonical schema doc is `faff-beep-boop/SKILL.md` § Run ledger; the string-only rule and the new sidecar are documented there, in the existing orthogonal-annotation list, not in a new doc. **Chosen:** document in `faff-beep-boop/SKILL.md` alongside the annotation family.

## 4. HOW — Behavior

**Approach.** Three coordinated changes, no data migration:

1. **`runcheck.js` — clearer non-string diagnostic.** In `auditLedger` (currently lines ~38–39), split the invalid detection so a non-string value produces a helpful entry rather than `[object Object]`. Object/non-string values remain invalid (still counted, still exit 2).

```
# auditLedger, replacing the current invalid-mapping (~L38–39)
invalid := []
FOR (issue, value) IN outcomes:
  IF typeof value != "string":
    invalid.push(`${issue}=<non-string outcome; record rich detail in outcome_details, keep outcomes[${issue}] a terminal-state string>`)
  ELSE IF NOT validStates.has(value):
    invalid.push(`${issue}=${value}`)
invalid := unique(invalid).sort()
```

- The `clean` computation, exit codes, and the `INVALID outcomes:` print line (runcheck.js:200) are unchanged — only the *content* of an invalid entry for a non-string value changes.
- `outcome_details` is **never** read by `auditLedger`: it is not `outcomes`, so it never enters the invariant or the invalid check.

**Anti-pattern:** coercing an object value to a string and passing it (e.g. reading `value.state`). Why: that silently blesses the wrong authoring shape and re-opens the option-(b) blast radius; the contract is that `outcomes[issue]` *is* a string.

2. **`faff-beep-boop/SKILL.md` — document the contract.** Under § Run ledger: (a) state that `outcomes[issue]` MUST be a terminal-state string (make the already-implicit rule explicit), and (b) add an `outcome_details` bullet to the orthogonal-annotation list, mirroring the `review_adversarial_skipped` bullet's phrasing — "an additive top-level map, informational, **outside** the `runcheck` completeness invariant, no ledger migration needed," carrying rich per-issue detail (state echo, merged head, satisfies/tests/absorbed) when a run wants to record why/how an issue reached its bucket.

3. **Tests — cover the diagnostic and the sidecar's inertness.** Extend the runcheck selftest cases / `test/runcheck-gate.test.mjs` per § Scenarios.

**Failure mode — the sidecar quietly re-imports the invariant.** *The failure:* a future consumer starts reading `outcome_details` and treats its absence as an error, making the "informational, absent-by-default" promise false. *How you'd know:* a `runcheck`/`run-done` run goes non-clean on a ledger whose `outcomes` are all valid strings but which omits `outcome_details`. *What it means:* abandon that consumer coupling — `outcome_details` must stay inert to the completeness gate by construction, exactly as documented.

## 5. SCENARIOS

```
Given a run-ledger whose outcomes value for an admitted issue is an object { state: "shipped", … }
When faff runcheck audits the ledger
Then the issue is reported invalid, the diagnostic names outcome_details and states the value must be a terminal-state string (no "[object Object]"), and runcheck exits 2
```

```
Given a run-ledger with all outcomes as valid terminal-state strings AND a populated outcome_details map keyed by those issues
When faff runcheck (and the ledger_clean signal run-done consumes) audit the ledger
Then the run is clean (exit 0) — outcome_details is inert to the completeness invariant
```

- The string-only `outcomes` contract and the `outcome_details` sidecar are documented in `faff-beep-boop/SKILL.md` § Run ledger.

## 6. DESIGN DECISION RATIONALE

**Option (a) string-only + sidecar vs option (b) widen `outcomes` to objects.**
- (a): zero schema ripple; sidecar inert to the gate; matches the existing orthogonal-annotation pattern and ADR-0056's rationale ("the ledger `outcomes` value stays a plain string, so no schema migration ripples through `auditLedger` or the executors"). Con: rich detail lives beside, not inside, the outcome.
- (b): one place per issue. Con: ~10 string-reading consumers must each unwrap `.state` or silently misclassify (worst: `lights-out` resume treats a shipped issue as in-flight); dozens of test fixtures churn; contradicts a shipped ADR.
- **Chosen:** (a) — the risk/effort asymmetry is decisive and the precedent is explicit.

**Sidecar shape: top-level field vs per-issue file.**
- Top-level `outcome_details` field: consistent with orchestrator-written annotation siblings; no new path/reader machinery.
- Per-issue `<run-dir>/<issue>/outcome-details.json` file: mirrors `merge-record.json`, but that file exists because a *different lane* (`merge-gate`) writes it at merge time; `outcome_details` is orchestrator-written at the ledger, so the file form adds machinery for no benefit here.
- **Chosen:** top-level `outcome_details` field on the ledger.

**Object-valued `outcomes`: accept-and-unwrap vs reject-with-better-message.**
- **Chosen:** reject (keep it invalid, exit 2) but replace the `[object Object]` string with a diagnostic naming `outcome_details`. Accepting would re-open option (b)'s blast radius; the real bug was the *confusing message*, not the *rejection*.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the sub-decisions above are all closed on explicit in-repo precedent.

**Assumptions:** none requiring pre-build validation. (`outcome_details` is orchestrator-authored prose in the beep-boop write path; no code currently writes it, and none is required to — this spec blesses and documents the shape and hardens the diagnostic.)

## 8. DONE — Definition of Done

### From WHY
- [ ] A run author recording rich per-issue detail has a documented, valid home (`outcome_details`) that does not trip `runcheck`/`run-done`.

### From WHAT / HOW (runcheck diagnostic)
- [ ] `auditLedger` reports a non-string `outcomes` value as invalid (still exit 2) with a message that names `outcome_details` and states the value must be a terminal-state string — never `[object Object]`.
- [ ] String-valued `outcomes` behaviour (valid vocabulary → clean; unknown string → invalid `<issue>=<value>`) is byte-unchanged.
- [ ] `outcome_details`, when present, is never read by `auditLedger` and never affects `clean` / exit code / the completeness invariant.

### From WHAT / HOW (documentation)
- [ ] `faff-beep-boop/SKILL.md` § Run ledger states `outcomes[issue]` MUST be a terminal-state string.
- [ ] `faff-beep-boop/SKILL.md` § Run ledger lists `outcome_details` in the orthogonal-annotation family (additive top-level map, informational, outside the completeness invariant, no migration).

### From SCENARIOS (tests)
- [ ] A test asserts an object-valued outcome → invalid + new diagnostic text + exit 2 (runcheck selftest case and/or `test/runcheck-gate.test.mjs`).
- [ ] A test asserts a ledger with valid string outcomes + a populated `outcome_details` map → clean (exit 0), proving the sidecar's inertness.

**Integration smoke test:**
```
1. Construct a ledger: admitted:["X"], outcomes:{ X:"shipped" }, outcome_details:{ X:{ state:"shipped", merged_head:"deadbeef" } }
2. Run faff runcheck --run-dir <dir>  → prints "clean", exit 0
3. Mutate outcomes.X to { state:"shipped" } (object) → runcheck prints an INVALID line naming outcome_details (not [object Object]), exit 2
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (P4)** — One cohesive 1–3 day unit: a diagnostic hardening + a doc contract + covering tests, all converging on the single outcome "authoring rich per-issue detail no longer trips the ledger validators." No independent second concern to split out, nothing to merge. No issues.
- **Workstream fit? (P1/P5)** — Project-less in Backlog, which is the lens's correct default landing for a captured minor bug; it belongs to the "signals tell the truth" / run-ledger-honesty theme but is too small to warrant its own outcome container. Leaving it loose is deliberate, not a smell. No action.
- **Deps surfaced? (P6)** — No blocker links, and none are missing: the spec builds on the already-shipped `merge-record.json` precedent (FAFF-397 / ADR-0056, Done) rather than on live work. No implicit unlinked dependency. No issues.
- **Risk profile? (P7)** — Low: contained diagnostic + docs + tests, no novel integration, no external dependency, fully reversible, and object-valued outcomes stay invalid (no behavioural loosening). No de-risking spike warranted.

confidence: high
spec-review: approve
