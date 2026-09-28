# Spec: itemise verified acceptance criteria in `ac-checklist.json` (FAFF-1147)

> Spec: faffter-dark-nlspec · 2026-09-28 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1147.

_Revised 2026-09-28 — spec-review round 1 (`revise`, minor architectural): specified the producer's output for a zero-AC issue (emit schema-1, never `{all_verified:true, criteria:[]}`), closing the empty-criteria oracle gap. Spec-review round 2: approve._

This spec covers FAFF-1147. It is written for the build agent that will edit the graft producer prose and the merge-gate reader, and for the human reviewers who gate the spec. It assumes only the explore findings quoted inline; no source ADR or parent ticket is needed to build it.

## 1. WHY — Problem and principles

**The core model.** `ac-checklist.json` is a plain JSON evidence artifact the graft skill writes at build-complete and two merge-floor readers re-read at merge. Today it carries only an aggregate boolean (`all_verified`). Graft already composes the per-criterion detail the ticket wants — a human-readable AC line plus a "Verified:" note or a "Needs human verification" note — but only in the PR-body markdown, then collapses it to that one boolean when it writes the JSON. This change stops discarding that detail: it writes the same per-criterion record into the artifact, and makes the aggregate mean "every listed criterion is verified" rather than merely asserting it.

**Problem statement.** The artifact asserts `all_verified=true` without itemising which criteria were checked or how each passed, so the merge floor keeps no per-criterion audit trail. A reader cannot see what "all verified" actually covered. This change records each criterion (`ac` + `verified` + a pass flag) alongside the aggregate, and cross-checks the two at the gate.

**Design principles.**

- **Fail-closed is non-negotiable.** Both readers treat a missing, unreadable, or malformed artifact as not-verified. The enriched reader must only ever make the gate stricter, never more lenient — an unparseable `criteria` array falls back to not-verified, and never silently upgrades an aggregate.
- **Additive, not a migration.** Schema-1 files (`{all_verified}` or the legacy `{ac_complete}`, no `criteria` array) already exist on disk and in per-PR anchors. Readers must keep accepting them unchanged. The `criteria` array is optional.
- **Byte-identical round-trip.** The artifact is hashed by the corrective-integrity digest and byte-copied into per-PR anchors, then re-hashed and re-validated by the governance-check Action. Whatever bytes graft writes must be the exact bytes the anchor carries and the EvidenceReturn payload transports. The enriched schema changes the digest value (expected and fine); it must not introduce any non-deterministic serialisation.
- **One home for the per-AC prose.** The human-readable `ac` text and the `verified` note are the same strings graft already composes for the PR-body checklist. The producer writes them once and derives both the PR-body box and the JSON criterion from the same source, rather than authoring two independent copies that could drift.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` Step 8 (lines ~366-401) | Prose (SKILL.md) | The single real write site; composes the per-AC checklist and persists the JSON |
| `plugin/skills/faff/bin/lib/merge-gate.js` `readAcComplete` (lines 577-582) | JavaScript | The single reader function; returns the AC signal for the merge floor |
| `plugin/skills/faff/bin/lib/governance-check.js` `evaluateMergeFloorLeg` (line 138) | JavaScript | Consumes the imported `readAcComplete`; carries `ac_complete` in its result and re-validates the anchored copy |
| `corrective-integrity.js` `correctiveIntegrityDirs()` roster (lines ~191/218) | JavaScript | Hashes the artifact for the integrity digest; no change, but the digest value shifts |

**Scope.** This sits on the merge floor: the producer half is graft's build-complete evidence write, the consumer half is the merge-gate AC leg that both the live floor and the governance-check Action read.

## 2. OUT OF SCOPE

- **A `faff contract ac-checklist` validator.** Excluded — the artifact is not a gateway contract today (`faff contract ac-checklist --describe` returns "unknown contract"), and the two readers already validate it fail-closed. Adding a contract is a separate scope decision (see Design Decision Rationale). Extension point: `plugin/skills/faff/bin/lib/` alongside the review-verdict contract, wired into `faff contract`.
- **A structured `verified` object (method + reference).** Excluded — `verified` stays a free-text note (see rationale). Extension point: the `criteria[].verified` field could later become `{ method, reference }` without a reader change if the gate keeps reading the `passed` flag rather than parsing the note.
- **Migrating or re-writing existing schema-1 anchors.** Excluded — legacy anchors already report `legacy-unverifiable` under `legacy-policy` and stay valid. Extension point: a one-off backfill verb if per-criterion history is ever wanted on old PRs.
- **Changing the PR-body checklist format.** Excluded beyond deriving the JSON from the same source — the existing `## Acceptance Criteria` markdown block is unchanged in shape.
- **Changing the review-verdict or holdout artifacts.** Excluded — this ticket is only the AC leg.

## 3. WHAT — Vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| schema-1 | The current artifact: `{ all_verified }` or the legacy `{ ac_complete }`, no `criteria` array |
| schema-2 | The enriched artifact: the aggregate plus a `criteria` array of per-criterion records |
| criterion `passed` | The box-tick state: `true` when the AC was auto-verified, `false` when it needs human verification or was left unchecked |
| aggregate | `all_verified` (or legacy `ac_complete`) — the single boolean the gate reads today |

**Artifact schema (schema-2).**

```
RECORD AcChecklist:
  all_verified: Boolean            # aggregate; retained, still written
  criteria: List<Criterion>        # OPTIONAL; absent => schema-1, aggregate authoritative

RECORD Criterion:
  ac: String                       # human-readable criterion, as the PR-body line reads it; non-empty
  verified: String                 # free-text evidence note (test id / command + result),
                                   #   or "Needs human verification: <reason>" when passed = false
  passed: Boolean                  # true => auto-verified; false => needs-human / unchecked

  CONSTRAINT all_verified == true  IMPLIES  every criterion.passed == true
  CONSTRAINT criteria is a deterministic, stable-ordered array (PR-body AC order)
```

A legacy schema-1 file has no `criteria` key; readers must not require it.

**Reader interface.** `readAcComplete(runDir, issue) -> Boolean` keeps its signature and its fail-closed contract (missing/unreadable/malformed → `false`). `governance-check.js` continues to consume it unchanged through the import; no second reader is introduced.

**Design decision — schema shape.** Options: (a) `criteria: [{ ac, verified }]`, aggregate stays the only machine signal, `verified` free text; (b) `criteria: [{ ac, verified, passed }]`, `verified` free text, `passed` a machine-readable box state. Option (a) cannot support the ticket's "all_verified means every criterion passing" without prose-parsing the free-text note (fragile, not fail-closed). Option (b) adds one boolean, keeps `verified` as the free text graft already writes, and gives the reader a deterministic per-criterion state. **Chosen:** option (b) — `criteria: [{ ac, verified, passed }]`, `verified` free text, `passed` boolean.

**Design decision — back-compat.** The requirement is factual: schema-1 files exist on disk and in anchors and must keep passing. **Chosen:** `criteria` is optional and additive; when it is absent the aggregate is authoritative exactly as today, and both `all_verified` and legacy `ac_complete` continue to be accepted.

## 4. HOW — Behaviour

**Producer (graft Step 8 prose).** Graft already ticks each AC box and writes a `Verified:` or `Needs human verification:` note into the PR-body `## Acceptance Criteria` block. Extend the persist step (line 399) so that, from the same per-AC source it built the PR-body block from, it also writes the `criteria` array:

```
PROCEDURE persist_ac_checklist(per_ac_results, run_dir, issue):
  1. criteria = []
  2. FOR each ac_result in per_ac_results (PR-body order):
     a. passed   = ac_result.box_ticked          # true only if auto-verified
     b. verified = ac_result.note                # the same string written into the PR-body box
     c. append { ac: ac_result.description, verified: verified, passed: passed } to criteria
  3. all_verified = criteria.every(c => c.passed) # unchanged rule: a Needs-human box => false
  4. IF criteria is empty (a zero-AC issue):       # emit schema-1; never { all_verified:true, criteria:[] }
       Write <run-dir>/<issue>/ac-checklist.json = { "all_verified": all_verified }   # criteria key omitted
     ELSE:
       Write <run-dir>/<issue>/ac-checklist.json = { "all_verified": all_verified, "criteria": criteria }
     # deterministic key order + serialisation; this is the byte source anchored + returned
```

**Zero-AC issue (the empty-criteria case).** An issue with no acceptance criteria yields an empty `criteria` list, and `[].every(...)` is vacuously `true`. The producer must therefore emit **schema-1** for a zero-AC issue — `{ all_verified: true }` with the `criteria` key omitted — exactly as it writes today, never the self-contradictory `{ all_verified: true, criteria: [] }` that the consumer's step-5 empty-array rule would fail-close to `false`. This keeps the producer inside the spec's own "additive, not a migration" principle: a zero-AC issue that passes today keeps passing, and the enriched schema never turns a passing issue into a failing one. The consumer's empty-array rule (`criteria.length > 0`) still fail-closes a genuinely-malformed schema-2 file whose author emitted an empty array by mistake.

The aggregate rule is unchanged from today: `all_verified` is true only when every auto-verifiable AC is ticked, and an unchecked "Needs human verification" box keeps it false (fail-closed). Interactive top-level graft writes it directly; the dispatched lane returns the raw bytes through `EvidenceReturn` and the dispatcher persists them.

**Consumer (`readAcComplete`).** Enrich the single reader to cross-check when `criteria` is present, and to fall back to the aggregate when it is not:

```
PROCEDURE readAcComplete(run_dir, issue) -> Boolean:
  1. TRY parse <run-dir>/<issue>/ac-checklist.json ; on any throw RETURN false   # fail-closed
  2. aggregate = (j.all_verified === true) OR (j.ac_complete === true)           # schema-1 signal, unchanged
  3. IF j.criteria is absent:            RETURN aggregate                         # schema-1 path
  4. IF j.criteria is not an Array:      RETURN false                             # malformed => fail-closed
  5. every_passed = j.criteria.length > 0
                    AND j.criteria.every(c => c && c.passed === true)             # missing passed => not-passed
  6. RETURN aggregate AND every_passed                                            # cross-check
```

**Behaviour summary.** For schema-1 the reader behaves exactly as before. For schema-2 it grants the AC leg only when the aggregate is true and every listed criterion is `passed`, so `all_verified=true` is auditable against the itemised criteria rather than merely asserted.

**Unverifiable AC handling.** Graft's existing rule stands: a "Needs human verification" AC leaves its box unchecked, which sets that criterion's `passed=false`, which forces `all_verified=false`. The per-criterion record carries the reason in `verified` (`"Needs human verification: <reason>"`). There is no per-criterion `needs-human` gate state beyond `passed=false`; the aggregate staying false is the fail-closed outcome the ticket's open question asks for. **Chosen:** an unverifiable AC keeps `all_verified=false` (unchanged), and its reason is recorded per-criterion via `passed=false` + the `verified` note — no separate tri-state vocabulary.

**Gate semantics.** **Chosen:** the merge-floor reader cross-checks `criteria` when present (step 6 above). The ticket states `all_verified=true` should mean "every listed criterion has a passing verified entry"; the cross-check implements exactly that. Fail-closed implication: the cross-check can only ever make the gate stricter. A schema-2 artifact with `all_verified=true` but a criterion `passed=false` is internally inconsistent (a producer bug) and now fails the merge, which is the intended auditable behaviour, not a regression. Schema-1 artifacts are unaffected.

**Integrity, anchoring and EvidenceReturn.** **Chosen constraint:** the producer's written bytes, the anchored copy, and the `EvidenceReturn.ac_checklist.body` bytes must be byte-identical, so the corrective-integrity re-hash and the governance-check merge_floor re-validation agree. The EvidenceReturn path is schema-agnostic (raw bytes), so the enriched content flows through unchanged. The integrity digest value will change because the file content changed; that is expected and requires no digest-code change. The producer must therefore serialise deterministically (fixed key order, no incidental whitespace variation between the anchored write and the persisted write).

**Anti-pattern:** parsing the free-text `verified` note to decide pass/fail at the gate. Why: it is not deterministic and defeats fail-closed; the `passed` boolean is the machine signal, `verified` is the human note.

**Anti-pattern:** forking a second AC reader in `governance-check.js`. Why: it consumes the imported `readAcComplete`; a divergent copy would let the gating mirror contradict the live floor.

**Failure modes.**

- **The failure:** the cross-check silently changes behaviour for a legacy file if `criteria` presence is mis-detected (for example, treating an empty array as schema-1). **How you'd know:** a schema-1 fixture and an empty-`criteria` fixture in the self-test block produce the wrong signal. **What it means:** narrow the presence test to "key present and is an array"; an empty array is schema-2 and, per step 5, yields `every_passed=false` (fail-closed) — assert this explicitly.
- **The failure:** the anchored copy and the producer write diverge by a byte (key order or whitespace), so the governance-check re-hash rejects a legitimate artifact. **How you'd know:** the integrity leg reports a digest mismatch on a freshly built PR. **What it means:** the producer's serialisation is non-deterministic; pin the key order and serialisation in the Step 8 prose.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a build where every acceptance criterion was auto-verified
When graft persists ac-checklist.json at build-complete
Then the file contains all_verified=true and a criteria array with one { ac, verified, passed:true } entry per AC, in PR-body order
```

```
Given a legacy schema-1 ac-checklist.json ({ all_verified: true } with no criteria array)
When the merge-floor reader reads it
Then it returns true (aggregate authoritative; back-compat preserved)
```

- The reader returns false for a schema-2 file whose `criteria` is present but not an array (malformed => fail-closed).

## 6. Design decision rationale

**Is `verified` free text or a structured method+reference object?**
Options: free-text note (what graft already composes) vs `{ method, reference }`. Free text reuses the exact string graft writes into the PR-body box, keeps one source for the prose, and needs no producer-side parsing; no consumer requires structure because the gate reads `passed`, not the note. A structured object would be net-new parsing with no current reader. **Chosen:** free-text `verified`, with a structured object noted as a future extension point.

**Is `passed` a boolean or a state enum (`verified | needs-human | failed`)?**
A failing AC blocks the build before the artifact is written, so on the merge floor a criterion is either auto-verified or needs-human; a boolean captures both, with the reason carried in `verified`. An enum adds vocabulary the gate does not need. **Chosen:** boolean `passed`; enum rejected as unnecessary.

**Does the gate cross-check `criteria`, or stay aggregate-only (audit)?**
Aggregate-only would deliver itemisation but leave `all_verified` asserted, not auditable — contrary to the ticket's stated meaning. The cross-check is strictly fail-closed (can only tighten) and safe for schema-1 (skipped when `criteria` absent). **Chosen:** cross-check when `criteria` present.

**Introduce a `faff contract ac-checklist` validator?**
Review-verdict has one; AC-checklist does not, and the two readers already validate fail-closed. A validator is a larger surface (new contract, wiring, tests) the ticket does not require, and the enriched reader covers the need. **Chosen:** no new gateway contract; keep the plain artifact plus the enriched reader. Revisit if a third consumer needs to validate the artifact outside the merge floor. (At the time of writing, `ac-checklist` is not a registered contract.)

## 7. Open questions and assumptions

**Open questions.** None blocking. Every decision above is closed.

**Assumptions.**

- **Assumes:** `governance-check.js` obtains its AC signal by importing `readAcComplete` from `merge-gate.js` rather than reimplementing it, so a single reader change covers both the live floor and the governance-check Action. Validate before starting: confirm the import at the top of `governance-check.js` and that line 138 calls the imported function (explore findings confirm both).

## 8. DONE — Definition of Done

### From WHY
- [ ] The persisted `ac-checklist.json` records per-criterion detail; a reader can see which criteria were checked and how each passed, not only the aggregate.

### From WHAT (schema)
- [ ] Schema-2 file matches `{ all_verified: Boolean, criteria: [{ ac: String, verified: String, passed: Boolean }] }`.
- [ ] `criteria` is written in PR-body AC order with deterministic key order and serialisation.
- [ ] Schema-1 files (`{all_verified}` and legacy `{ac_complete}`, no `criteria`) are still accepted by the reader.

### From HOW (producer)
- [ ] Graft Step 8 prose writes the `criteria` array, deriving each `ac`, `verified`, and `passed` from the same per-AC source as the PR-body checklist.
- [ ] An unverifiable AC yields `passed=false` with `verified: "Needs human verification: <reason>"` and keeps `all_verified=false`.
- [ ] A zero-AC issue emits schema-1 (`{ all_verified: true }`, `criteria` key omitted), never `{ all_verified: true, criteria: [] }`; such an issue passes exactly as it does today.

### From HOW (consumer)
- [ ] `readAcComplete` returns the aggregate when `criteria` is absent (schema-1 path).
- [ ] `readAcComplete` returns `aggregate AND every criterion.passed` when `criteria` is a non-empty array.
- [ ] `readAcComplete` returns `false` when `criteria` is present but not an array, or empty, or any element lacks `passed===true` (fail-closed).
- [ ] Unit cases for schema-1, schema-2 all-passed, schema-2 aggregate-true-with-one-unpassed, empty-array, and malformed-`criteria` are added to the `merge-gate.js` inline self-test block; the existing merge-gate and governance-check self-tests still pass.

### From HOW (integrity / anchoring / EvidenceReturn)
- [ ] The producer write, the anchored copy, and the `EvidenceReturn.ac_checklist.body` bytes are byte-identical for a given build (no serialisation drift).
- [ ] The corrective-integrity digest re-hash and the governance-check merge_floor re-validation both pass on a freshly built schema-2 PR.

### From decisions
- [ ] No `faff contract ac-checklist` validator is introduced; `faff contract ac-checklist --describe` still returns "unknown contract".

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Simulate a build with 2 ACs: one auto-verified, one needs-human.
  2. Run the Step-8 persist logic => ac-checklist.json with all_verified=false and
     criteria=[{passed:true,...},{passed:false,verified:"Needs human verification: ..."}].
  3. readAcComplete(runDir, issue) => false (needs-human => aggregate false => leg blocks). PASS if false.
  4. Flip the second AC to auto-verified (passed:true) and all_verified=true; re-read => true. PASS if true.
  5. Read a legacy { all_verified: true } fixture (no criteria) => true. PASS if true (back-compat).
```

confidence: high
build-tier: complex
spec-review: approve
