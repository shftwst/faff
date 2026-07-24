# FAFF-601 — Agent Delivery Evidence spec v0.2: document the shipped anchor/verify/integrity surface (FAFF-568 delta)

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-601.

This is a **delta spec**: it adds v0.2 of the `docs/evidence/` directory on top of the already-approved v0.1 (attached to this issue 2026-07-23). v0.1's architecture, page skeleton, versioning policy, and nine existing pages are unchanged and are **not** restated here — only what's new. Audience: the build agent (materialising v0.2) and human reviewers.

## 1. WHY — Problem and Principles

**Re-grounding.** v0.1 was approved (`confidence: high`, `spec-review: approve`) on 2026-07-23 with an explicit, reasoned OUT OF SCOPE exclusion: *"chain anchoring/verification is separate tracked work (FAFF-568) and not shipped, so v0.1 documents chain construction as normative and states plainly that no shipped verb re-hashes it."* FAFF-568 has since **shipped** (#471, `1a0d934`): `faff events verify`, `faff events anchor`, the `chain-head.json` witness artifact, the `.faff/anchors/` location, and governance-check's sixth `integrity` leg all now exist in `main`. The autonomous prep run on 2026-07-24 correctly parked rather than silently rewriting the approved v0.1 boundary (recorded on this issue); the human has now made the scoping call this park asked for: **v0.2 documents the shipped surface as a delta**, v0.1's construction-only baseline stands unmodified.

**Design principles (inherited from v0.1, restated because they govern the delta too):**

- **Document what ships, verbatim.** v0.2 contains no aspirational fields — every field in `chain-head.schema.json` is read from `computeChainHead` (`events.js`), every verb flag from `EVENTS_SURFACE`, every leg detail from `evaluateIntegrityLeg` (`governance-check.js`).
- **One source per schema.** No schema is duplicated between `docs/evidence/` and the runtime; where the runtime has no separately-schema'd artifact (the case here — `chain-head.json` has no `contracts/*.schema.json` twin), v0.2 authors one new schema.
- **The spec never outranks the validators.** `faff events verify` and governance-check's `integrity` leg remain the enforcement; v0.2 documents their classification states, it does not restate their code.
- **A version bump, not an edit.** Per v0.1's own versioning policy (*"any behaviour change lands as its own ticket and bumps the spec version"* — and FAFF-568's surface is exactly such a behaviour change, landed as its own ticket, now bumping the spec), v0.2 is a **new, additive version directory**. v0.1's `v0.1/` tree is never touched — immutability of published version directories, the versioning policy's own rule, applies to the spec's own prior version as much as to any future one.

**Reference context (delta only — v0.1's Reference context table still applies for everything else):**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` — `verifyChain`, `computeChainHead`, `cmdEvents` (`verify`/`anchor` branches), `splitPhysicalLines` | Node | the shipped verify/anchor surface this delta documents |
| `plugin/skills/faff/bin/lib/governance-check.js` — `evaluateIntegrityLeg`, `evaluateAnchorDir`, `evaluateRunDir` (six-leg composition) | Node | the sixth conformance leg |
| `.faff/anchors/<run-id>/<issue>/` (real committed anchors, e.g. `.faff/anchors/run-20260724-125424-beepboop-full/FAFF-634/`) | — | real-shaped examples for the new schema |

**Scope statement:** this delta is still the foundation artifact of "Unbundling — evidence, checks, lints" — FAFF-610's Action now cites the six-leg conformance statement, not five.

## 2. OUT OF SCOPE (delta — supersedes the matching v0.1 bullet only)

- **v0.1's "Hash-chain verification tooling" exclusion is retired by this delta** — the excluded surface has shipped and is now documented (§3 below). No other v0.1 OUT OF SCOPE bullet is affected; all of them (extraction into its own repo/package, the `issue`→`unit` rename, new CLI behaviour, signing/attestation, the non-consumed run-dir residents) stand unchanged for v0.2 too.
- **Anchor *authorship* policy (when/how CI decides to run `faff events anchor`, which branches get anchored)** — why: that's FAFF-623 (emitter-side commit convention), a separate tracked ticket about *producing* anchors; this delta documents the anchor *artifact and verbs* FAFF-568 shipped, not the calling convention FAFF-623 is scoping. Extension point: a future v0.3 page (or a `supporting-artifacts.md` update) once FAFF-623 lands.
- **`--legacy-policy` as a governance-check-wide config surface** — why: it's already a per-invocation CLI flag (`pass`/`warn`/`fail`) documented on the conformance page's fail-direction row for the `integrity` leg; no new configuration mechanism is introduced by this delta.

## 3. WHAT — New vocabulary, artifact, and directory delta

**New vocabulary:**

| Term | Definition |
|---|---|
| anchor dir | `.faff/anchors/<run-id>/<issue>/` — a committed, immutable per-PR snapshot of a run dir's chain evidence (`events.jsonl` + `run-ledger.json` byte-copies + a CLI-computed `chain-head.json`), written by `faff events anchor` |
| chain head / witness | the `chain-head.json` record: the CLI's own re-derived summary of an events.jsonl chain at anchor time, cross-checked (never trusted blind) by every later `verify` call against that same directory |
| integrity leg | governance-check's sixth leg (FAFF-568) — re-hashes a run/anchor dir's committed chain and reports one of: `verified`, `legacy-unverifiable`, `mixed`, `broken`, `witness-mismatch`, `witness-absent`, `malformed` |

### Directory delta (additive only — no existing v0.1 file moves or is edited)

```
docs/evidence/
  README.md                    # EDITED: versioning-policy changelog gains a v0.2 entry;
                                #   index gains the v0.2 page row
  v0.1/                         # UNCHANGED — every file as approved 2026-07-23
    ...
  v0.2/                         # NEW
    conformance.md              # NEW — six-leg version of the v0.1 conformance statement
    anchor-integrity.md         # NEW — the chain-head.json artifact + verify/anchor verbs
    schema/
      chain-head.schema.json    # NEW
      examples/
        chain-head.example.json # NEW — a real anchor's chain-head.json, hand-carried
```

**Chosen:** `v0.2/` is a **full sibling** of `v0.1/`, not an in-place patch — it carries its own `conformance.md` (the six-leg version) rather than mutating `v0.1/conformance.md`, matching the versioning policy's "published directories are immutable" rule literally. `v0.2/conformance.md` supersedes `v0.1/conformance.md` as the FAFF-610-cited statement; `v0.1/conformance.md` stays on disk unedited as the historical record of what v0.1 asserted.

**Chosen:** `v0.2/events.md` and `v0.2/run-ledger.md` etc. are **not** re-created — the events envelope, run-ledger shape, and the other eight v0.1 pages are unchanged by FAFF-568 (the `RunEvent`/`RunLedger` schemas gained no new fields; only a new *derived* artifact — `chain-head.json` — and two new *verbs* were added). `v0.2/anchor-integrity.md` is the only new artifact page; `v0.2/README.md`-level pointers (folded into the top-level `README.md` index) tell a v0.2 reader "for events/run-ledger/etc., see `v0.1/`; nothing changed there." This keeps the delta honest about its actual size and avoids nine near-duplicate pages that would immediately drift from their `v0.1/` originals.

### `anchor-integrity.md` — required sections (the same fixed skeleton as every v0.1 page)

**Purpose.** Documents two things FAFF-568 added: the `chain-head.json` witness artifact, and the `faff events verify` / `faff events anchor` verbs that produce and consume it.

**Location & lifecycle.**
- `chain-head.json` — path `.faff/anchors/<run-id>/<issue>/chain-head.json`; written once by `faff events anchor` (never hand-edited); the anchor dir it lives in is intended-immutable (a later `verify` re-derives and cross-checks against it — mutating it defeats its purpose).
- The anchor dir itself (`.faff/anchors/<run-id>/<issue>/`) — a byte-copy of `events.jsonl` + `run-ledger.json` from the source run dir, plus the witness. Committed (not gitignored, unlike run dirs), per FAFF-623's convention (referenced, not restated — out of scope above).

**Producer(s).** `faff events anchor --run-dir <dir> --issue <issue> --dest <anchor-dir>` (`events.js` `cmdEvents`, `anchor` branch) — computes `chain-head.json` via `computeChainHead`, byte-copies `events.jsonl`, copies `run-ledger.json` if present. The head hash is **always CLI-computed from the copied bytes, never caller-supplied** — this is the property that makes the witness trustworthy as a cross-check rather than decorative.

**Consumer(s).** `faff events verify --run-dir <dir>` (any dir, run or anchor) and governance-check's `integrity` leg (`evaluateIntegrityLeg`, called by both `evaluateRunDir` for live run dirs and `evaluateAnchorDir` for anchor dirs, the latter with `requireWitness: true`).

**Schema.** New `v0.2/schema/chain-head.schema.json` (below).

**Integrity.** This page **is** the integrity documentation — see the classification table below, which is the page's core content.

**Fail direction.** See the classification table; `broken` and `witness-mismatch` are always gating FAILs regardless of `--legacy-policy`. `witness-absent` is gating **only** when the dir is evaluated as an anchor (`requireWitness`); a live run dir has no witness by design and is unaffected.

**Example.** `schema/examples/chain-head.example.json`, hand-carried from a real committed anchor (e.g. `.faff/anchors/run-20260724-125424-beepboop-full/FAFF-634/chain-head.json`), scrubbed of nothing-secret (run/issue ids are not secret).

### `chain-head.schema.json` (the new schema)

```
RECORD ChainHead:                      # schema/chain-head.schema.json
  run_id: String                       # required; the source run dir's basename (NOT the
                                       #   anchor dir's basename, which is the issue id —
                                       #   this is why verifyChain's genesis hash uses the
                                       #   record's own run_id field, not path.basename(dir))
  issue: String                        # required; the --issue value at anchor time
  head_seq: Integer | null             # the last PARSEABLE record's seq (torn tail
                                       #   excluded); null if no parseable record
  head_sha256: Hex64 | null            # SHA-256 of the head (last) physical line's raw
                                       #   bytes; null if events.jsonl was empty at anchor
                                       #   time
  line_count: Integer                  # count of physical lines (torn tail counts as a line)
  schema_floor: Integer | null         # min(schema) across all parseable records; null if
                                       #   none carry an integer schema field

  CONSTRAINT additionalProperties: false   # CLI-computed and fully enumerated — unlike the
                                           # open run-ledger record, every field here is a
                                           # closed derived value with a single producer
```

### The six-leg conformance statement (`v0.2/conformance.md`)

Same five-part contents list as v0.1's `conformance.md` (claim / legs table / fail-direction table / authenticity boundary / version binding), with:

1. **The claim** — unchanged in spirit, reworded for six legs: *a conformant run dir or anchor dir is one whose artifacts validate against the v0.2 schemas (v0.1's nine plus `chain-head.json`) and satisfy the cross-artifact invariants, including chain integrity where a chain is present.*
2. **The legs table gains a sixth row:**
   - **integrity** — events.jsonl (+ `chain-head.json` witness when present; + run-ledger.json for the ledger-fold cross-check) → `evaluateIntegrityLeg` (composes `verifyChain`, the same core `faff events verify` uses — one hashing implementation, not a forked one) → **gating**. Fail direction: `broken` or `witness-mismatch` → hard FAIL, never softened by `--legacy-policy`; `legacy-unverifiable` / `mixed` → FAIL only under `--legacy-policy fail`, pass (with a `[warn]`-tagged detail) otherwise; `witness-absent` → FAIL, but **only** when evaluated as an anchor (`requireWitness`); absent `events.jsonl` entirely → `verified` (nothing to break, a clean no-op).
   - The five v0.1 legs (completeness / budget / merge_floor / coherence / liveness) are restated by reference to `v0.1/conformance.md`, not copied — the delta principle applies to the conformance page's own prose, not just to schemas.
3. **Anchor-dir special case (new).** An anchor dir (`.faff/anchors/<run-id>/<issue>/`) is evaluated **integrity-only** — `evaluateAnchorDir` marks the other five legs `n/a` (pass, never gating) because an anchor's `run-ledger.json` is a frozen, run-scoped copy, not a PR-scoped one; sweeping it through `completeness` would false-fail on work the anchor never claimed to cover. This is a governance-check consumer detail, not a new artifact, and belongs on the conformance page rather than a new artifact page.
4. **Authenticity boundary** — unchanged from v0.1, restated: the witness raises the bar from "shape-valid" to "shape-valid and internally self-consistent since anchor time," but it is still emitter-authored — a forging emitter that never calls the real `anchor` verb can fabricate a self-consistent `chain-head.json` from whole cloth. The integrity leg closes the *post-anchor tamper* gap, not the *forging emitter* gap; that boundary is unchanged from v0.1's stated posture.
5. **Version binding** — *"this statement describes spec v0.2; the Action names the spec version it checks against."* FAFF-610 (not yet built) should cite v0.2, not v0.1, once this delta lands.

**Chosen:** the fail-direction table's classification vocabulary (`verified` / `legacy-unverifiable` / `mixed` / `broken` / `witness-mismatch` / `witness-absent` / `malformed`) is transcribed **verbatim** from `verifyChain`'s own status strings and the comment block immediately above it in `events.js` (lines ~394–403) — not paraphrased — because that comment is itself the authoritative classification rationale and re-deriving it risks drifting from the code's own stated intent.

## 4. HOW — Behavior (delta)

**Approach:** identical method to v0.1 — transcription with verification, from shipped code and real committed anchors (`.faff/anchors/*`), locked by CI example-validation. Only the scope is smaller (one new page, one new schema, one superseding conformance page).

```
PROCEDURE build_the_v0.2_delta:
  1. Scaffold docs/evidence/v0.2/ (conformance.md, anchor-integrity.md, schema/)
  2. Write anchor-integrity.md per its section skeleton, reading verifyChain/computeChainHead/
     evaluateIntegrityLeg/evaluateAnchorDir directly (never re-derive the classification
     vocabulary from memory — transcribe the code comments)
  3. Author chain-head.schema.json; add ≥1 conformant example under schema/examples/,
     hand-carried from a real .faff/anchors/* directory
  4. Write conformance.md's six-leg version (integrity leg row + anchor-dir special case +
     restated authenticity boundary + v0.2 version binding); five inherited legs are
     referenced from v0.1/conformance.md, not copied
  5. Update docs/evidence/README.md: index gains the v0.2 row; versioning-policy changelog
     gains a dated v0.2 entry naming FAFF-568/FAFF-601 as the trigger
  6. Extend test/evidence-spec.test.mjs (the v0.1 CI harness) to also validate
     v0.2/schema/examples/chain-head.example.json against chain-head.schema.json, and to
     assert the example's head_sha256 matches a fresh faff events anchor run over the same
     source bytes (the same "does the spec describe reality" check v0.1 runs per-schema)
  7. Cross-link: docs/guide/governance-check.md's existing v0.1 conformance pointer is
     updated to point at v0.2/conformance.md
```

**Edge cases and fail directions to document (not change) — delta-specific:**

- A witness's `head_seq`/`schema_floor` can be `null` (an anchor taken over an events.jsonl with zero parseable records — all-torn) while `head_sha256` is non-null (the torn bytes still hash) — the schema allows this combination; the page states it explicitly since it looks like an inconsistency at a glance.
- `run_id` inside `chain-head.json` is the **source run dir's basename**, not the anchor dir's basename (which is the issue id) — the page calls this out with the genesis-hash rationale from the `events.js` comment (an anchor relocated under `.faff/anchors/<run>/<issue>/` must still verify against the record's own `run_id`, not the directory it now lives in).
- `witness-absent` only fires under `requireWitness` (anchor evaluation) — a live run dir mid-build has no witness by design and this is not a failure; the page states both directions so a reader doesn't assume run dirs need anchoring to pass.

**Failure modes (delta-specific):**

- **The failure:** a future change to `computeChainHead`'s field set (a new field, a renamed one) ships without bumping the spec. **How you'd know:** the extended CI test's example-validation fails the moment the real anchor output stops matching `chain-head.example.json`'s schema. **What it means:** bump to v0.3 in the same PR, per the versioning policy.
- **The failure:** `v0.2/conformance.md` is written by copying `v0.1/conformance.md`'s five-leg rows verbatim instead of referencing them, and they silently diverge from a later v0.1 correction. **How you'd know:** nothing mechanical catches prose drift; this is a review-time check. **What it means:** the "reference, don't copy" rule for schemas applies just as much to conformance prose across versions — call it out explicitly in review.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fresh checkout of the repo after this delta lands
When a reader opens docs/evidence/README.md
Then they find both v0.1/ and v0.2/ listed, with the changelog's v0.2 entry naming
  FAFF-568 as the shipped surface it documents
```

```
Given a real committed anchor directory under .faff/anchors/<run>/<issue>/
When its chain-head.json is validated against v0.2/schema/chain-head.schema.json
Then it validates clean
```

```
Given governance-check's six legs as enumerated in bin/lib/governance-check.js
  (evaluateRunDir / evaluateAnchorDir)
When each leg's read set is compared against the v0.2 page inventory (v0.1's nine pages +
  anchor-integrity.md)
Then every file a leg reads — including chain-head.json for the integrity leg — has a spec
  page naming that leg as a consumer
```

- Assertion: the extended CI test fails if `chain-head.schema.json`'s field set and `computeChainHead`'s returned object shape (keys) differ as sets.
- Assertion: no v0.2 page documents a verb or classification status that `verifyChain`/`evaluateIntegrityLeg` doesn't actually emit.

## 6. DESIGN DECISION RATIONALE

- **In-place v0.1 edit vs. a new v0.2 directory?** Options: rewrite v0.1's `conformance.md`/`events.md` in place (fastest, but breaks the versioning policy's own "published directories are immutable" rule and would falsify the historical record of what was approved 2026-07-23), a new v0.2 sibling directory (this delta). **Chosen:** new `v0.2/` directory — the policy the spec itself states leaves no other honest option, and it is the exact scenario the policy was written to handle (a shipped-surface delta, ticket-tracked, bumping the version).
- **Full re-creation of all nine pages under v0.2, or an additive-only delta?** Options: copy all nine v0.1 pages into `v0.2/` even where nothing changed (keeps every version self-contained but guarantees eight near-duplicate pages drift from their originals immediately), additive-only (one new page + one superseding conformance page, everything else referenced from `v0.1/`). **Chosen:** additive-only — matches what actually changed (FAFF-568 added a derived artifact and two verbs; it touched no existing artifact's shape), and keeps "one source per fact" (not just per schema) consistent with v0.1's own stated principle.
- **New top-level page vs. folding into `events.md`?** Options: extend `v0.1/events.md` in place (fails the immutability rule again), a new `v0.2/anchor-integrity.md` (chosen), fold into `v0.2/conformance.md` only (loses the page-per-artifact skeleton — chain-head.json is a real artifact with its own producer/consumer/schema, and conformance.md's job is the cross-artifact statement, not artifact documentation). **Chosen:** a dedicated `anchor-integrity.md`, keeping the fixed eight-section skeleton every other artifact page uses.
- **Does `--legacy-policy` need its own config page?** Options: a new configuration-surface page, document it inline on the leg's fail-direction row (chosen). **Chosen:** inline — it's a single CLI flag with three literal values already fully described by governance-check's own `--help`/code comments; a dedicated page would be the "restating validator logic as prose that could drift" anti-pattern v0.1 already names.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none blocking.

**Assumptions:**

- **Assumes:** `computeChainHead`'s returned shape (`run_id`, `issue`, `head_seq`, `head_sha256`, `line_count`, `schema_floor`) is stable as of `main` at prep time (validated: read directly from `events.js` lines 596–619, current HEAD after `git pull --ff-only`). Build agent: re-confirm the field set against `main` at build time before finalising `chain-head.schema.json`, since this is exactly the kind of drift the CI test is designed to catch if it happens between prep and build.
- **Assumes:** `.faff/anchors/<run>/<issue>/chain-head.json` real examples exist in the repo to hand-carry from (validated: `.faff/anchors/run-20260724-125424-beepboop-full/FAFF-634/chain-head.json` exists on `main` as of this prep). Build agent: pick any current, real anchor at build time — the specific one cited here is illustrative, not pinned.
- **Assumes:** the v0.1 CI harness (`test/evidence-spec.test.mjs`) exists and is extendable in the shape v0.1's own DoD describes (v0.1 is approved but its build status against this delta's prep is not re-verified here — v0.1 may or may not be built yet). Build agent: if `test/evidence-spec.test.mjs` doesn't exist yet (v0.1 not yet built), this delta's DoD item 6 folds into building it fresh with both v0.1 and v0.2 examples from the start, rather than extending a file that doesn't exist.

## 8. DONE — Definition of Done

### From WHY
- [ ] `docs/evidence/v0.2/` exists alongside an untouched `docs/evidence/v0.1/`; every statement in v0.2 describes shipped behaviour (no aspirational fields).

### From WHAT
- [ ] `v0.2/anchor-integrity.md` exists with all eight fixed sections (Purpose / Location & lifecycle / Producers / Consumers / Schema / Integrity / Fail direction / Example), documenting `chain-head.json`, `faff events verify`, `faff events anchor`, and the full classification vocabulary (`verified`/`legacy-unverifiable`/`mixed`/`broken`/`witness-mismatch`/`witness-absent`/`malformed`) transcribed from `verifyChain`'s code comments.
- [ ] `v0.2/schema/chain-head.schema.json` exists, draft 2020-12, `$id: faff/evidence/v0.2/chain-head`, `additionalProperties: false`, matching `computeChainHead`'s exact returned field set.
- [ ] `v0.2/conformance.md` states six legs (five referenced from `v0.1/conformance.md` by pointer, `integrity` documented in full), the anchor-dir integrity-only special case, the restated authenticity boundary, and version binding to v0.2.
- [ ] `docs/evidence/README.md` gains a v0.2 index row and a dated changelog entry naming FAFF-568/FAFF-601.
- [ ] `docs/guide/governance-check.md`'s existing conformance pointer is repointed to `v0.2/conformance.md`.

### From HOW (verification)
- [ ] ≥1 conformant `chain-head.json` example under `v0.2/schema/examples/`, hand-carried from a real committed anchor.
- [ ] The CI harness validates the v0.2 example against its schema and cross-checks it against a fresh `faff events anchor` run over the same source bytes.

### Eval coverage
- [ ] No LLM-judgement seam is introduced or changed (documentation + deterministic tests only) — no grader/eval registration required.

**Integration smoke test:**

```
1. Run the extended evidence-spec test file → all pass (v0.1 examples still validate, v0.2's
   chain-head example validates against chain-head.schema.json)
2. Pick a real anchor dir under .faff/anchors/; validate its chain-head.json against
   v0.2/schema/chain-head.schema.json
3. Run `faff events verify --run-dir <that anchor dir>` → status verified, matching the
   page's documented "clean anchor → verified" fail-direction row
```

## Methodology critique

*(agile-delivery lens, `issue-critique` — appended by faff-prep; advisory, does not gate promotion)*

- **Right-sized?** One new page, one new schema, one superseding conformance page, and a CI-test extension is a small, cohesive unit — smaller than v0.1 itself, and it has no independent shippable value split from v0.1 the way v0.1's own critique reasoned (a v0.2 that doesn't build on an existing v0.1 tree is meaningless). No split proposed.
- **Workstream fit?** Same foundation-artifact fit as v0.1 within "Unbundling — evidence, checks, lints" — FAFF-610 now cites v0.2's conformance statement instead of v0.1's. No issues.
- **Deps surfaced?** No new blocking edges — FAFF-568 (the surface being documented) is already merged; FAFF-610/FAFF-611 (blocked-by this ticket) are unaffected by the v0.1→v0.2 split, since either version satisfies "a conformance statement exists to cite." No issues.
- **Risk profile?** Low, same as v0.1 — documentation of already-shipped, already-tested behaviour. The one process risk (a v0.1 build not yet landed when this delta builds) is called out explicitly in §7's assumptions with a concrete build-agent instruction, not left implicit.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
