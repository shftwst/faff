# Public trust claim audit and status ledger

> Spec: faffter-dark-nlspec · 2026-08-07 · autonomous · confidence: high. Full spec on Linear FAFF-732.

This specification defines the FAFF-732 documentation audit for the build agent and human reviewers. It produces one machine-readable claim ledger, a deterministic public report, and a discoverable link from the repository front page.

## 1. WHY: problem and principles

The load-bearing model is that a trust claim is useful only when its current status and evidence travel together. Faff currently has honest point corrections and evidence artifacts, but no single inventory that lets a reader distinguish enforced guarantees, attestations, demonstrations, plans, stale prose, and unsupported prose across the public repository. This change creates that factual baseline without rewriting the claims it audits.

**Classify what is current, not every historical sentence as a product promise.** ADRs, implementation specs, audit records, and fixtures remain in the file inventory, but their historical or test context must be recorded so old design prose is not silently promoted into a current guarantee.

**One authority, two views.** Structured data is the source of truth. The readable report is derived from it, so status summaries and gap lists cannot drift from the ledger.

**Evidence must match the strength of the status.** Source code or a validator can support `enforced`; an explicit compliance boundary can support `attested`; a recorded run can support `demonstrated`. A design document alone cannot prove any of those states.

**Audit first, correct later.** This issue records stale and unsupported claims and assigns their follow-up ownership. It does not fold every prose correction into one unreviewable documentation rewrite.

### Reference context

- **`docs/audits/2026-07-20-l4-capabilities-audit.md`**: existing prose audit that separates shipped machinery, enforcement seams, and evidence gaps.
- **`docs/audits/2026-08-02-FAFF-435-l4-gate-subversion.md`**: current pattern for a readable audit backed by a machine report.
- **`docs/audits/2026-08-02-FAFF-435-l4-gate-subversion/audit-report.json`**: machine-readable audit precedent.
- **`docs/audits/tools/faff-435/validate-report.mjs`**: dependency-free validator and self-test precedent.
- **`docs/evidence/README.md`**: existing distinction between conformance and authenticity.
- **`README.md`, `docs/guide/**`, `docs/concept/**`, `docs/reports/**`, `docs/external-verification/**`, and `website/src/pages/index.js`**: high-signal current public prose.

**Scope:** classify material trust and enforcement claims across every tracked path under `README.md`, `docs/**`, and `website/**`, then publish the current audit state without changing the claims themselves.

## 2. OUT OF SCOPE

- **Fixing audited prose**: this audit identifies stale or unsupported text and links it to an owning issue. Corrections land in those issues so each change can be reviewed against its own evidence. Extension point: the owner recorded on the gap row.
- **Rewriting the landing page or positioning**: FAFF-739 owns the front-page rewrite and consumes this audit as its baseline. Extension point: `README.md` and `website/src/pages/index.js` under FAFF-739.
- **Publishing new external-verification results**: FAFF-588 owns the results convention and evidence publication. This audit may classify the current lack or presence of results, but does not run or publish experiments. Extension point: `docs/external-verification/**` under FAFF-588.
- **Changing product enforcement**: a missing gate remains a planned or unsupported claim here. The relevant implementation issue owns the mechanism. Extension point: the issue linked from the claim ledger.
- **Treating tests, fixtures, generated output, package metadata, or historical design records as current marketing copy**: these paths stay inventoried with an explicit surface disposition. Extension point: the inventory policy in the audit data model.

## 3. WHAT: vocabulary, data, and interfaces

### Vocabulary

- **Claim**: a material statement that asks a reader to trust a product guarantee, enforcement boundary, observed capability, or delivery-process property.
- **Claim kind**: `product-guarantee` or `process-observation`, kept separate even when both cite the same artifact.
- **Status**: `enforced`, `attested`, `demonstrated`, `planned`, `stale`, or `unsupported`.
- **Evidence**: a stable repository path, tracker issue, pull request, or other durable artifact that directly supports the assigned status.
- **Gap owner**: an existing or newly filed FAFF issue that owns resolution of a `planned`, `stale`, or `unsupported` claim.
- **Surface disposition**: why an inventoried file does or does not contribute current public claims.

### Files

The build adds:

- `docs/audits/2026-08-07-FAFF-732-public-trust-claims.md`, the readable report.
- `docs/audits/2026-08-07-FAFF-732-public-trust-claims/claim-ledger.json`, the authoritative structured ledger.
- `docs/audits/tools/faff-732/validate-report.mjs`, the dependency-free validator, renderer, and self-test.
- `test/public-trust-claims.test.mjs`, the repository test that exercises validation and render parity.

The build updates `README.md` with one link to the readable report in its existing “Going further” list.

### Ledger shape

```text
RECORD ClaimLedger:
  schema: 1
  issue: "FAFF-732"
  source_commit: forty-character lowercase Git commit audited by this snapshot
  generated_at: ISO-8601 timestamp
  scope: ["README.md", "docs/**", "website/**"]
  terminology: LIST<TermDefinition>
  files: LIST<FileInventoryEntry>
  candidates: LIST<ClaimCandidateDisposition>
  claims: LIST<ClaimRecord>

RECORD TermDefinition:
  term: non-empty string
  definition: non-empty string
  preferred_term: optional non-empty string
  deprecated_aliases: LIST<string>

RECORD FileInventoryEntry:
  path: tracked repository-relative path
  surface: current-public | historical-record | test-or-fixture | generated-or-metadata | non-prose
  claim_ids: LIST<ClaimId>
  rationale: non-empty string when claim_ids is empty

RECORD ClaimCandidateDisposition:
  source: SourceAnchor
  matched_text: exact short excerpt matched by the recall-biased scanner
  matched_rule: guarantee-modal | enforcement-term | autonomy-level | support-term
  disposition: claim | not-a-claim | historical-context
  claim_id: required when disposition is claim
  rationale: required when disposition is not-a-claim or historical-context

RECORD ClaimRecord:
  id: stable slug unique within the ledger
  kind: product-guarantee | process-observation
  status: enforced | attested | demonstrated | planned | stale | unsupported
  summary: one-sentence plain-English claim
  source: SourceAnchor
  evidence: LIST<EvidenceRef>
  current_state: non-empty string
  target_state: optional non-empty string
  owner_issue: optional FAFF issue identifier

RECORD SourceAnchor:
  path: path present in files
  section: stable heading, symbol, or exact short anchor

RECORD EvidenceRef:
  label: non-empty string
  target: repository-relative path, FAFF issue, or absolute URL
  supports: enforcement-mechanism | enforcement-activation | attestation | demonstration | status-history
```

Claim IDs derive from the source path plus a normalised stable heading or symbol anchor. A later refresh preserves the existing ID while that source anchor persists; a moved claim records the old ID as an alias rather than minting an unrelated identity. Collisions receive a deterministic numeric suffix ordered by source position. A file with no material current claim still appears in `files`, with a disposition and rationale, so audit coverage is distinguishable from accidental omission.

The validator's scanner supplies a recall-biased, mechanically enumerable review floor. It records every sentence in `current-public` prose that contains a guarantee modal (`will`, `must`, `cannot`, `always`, `never`), an enforcement term (`enforce`, `deny`, `block`, `fail closed`, `mandatory`), an autonomy-level reference, or a support-status term. Each match must map to a claim or carry an explicit non-claim or historical-context rationale. Human or agent judgement still decides whether unflagged prose is material and whether linked evidence supports its status; the scanner makes missed obvious candidates and reviewer dispositions inspectable rather than claiming to prove semantic completeness.

### Readable report

`validate-report.mjs --render <ledger>` emits the complete Markdown report in a deterministic order:

1. Scope, audit commit, method, and classification rules.
2. Status summary and the full claim ledger.
3. Stale-content report containing every `stale` claim.
4. Terminology map from `terminology`.
5. Current-versus-target account for every claim with `target_state`.
6. Evidence-gap list containing every `planned`, `stale`, or `unsupported` claim, its evidence, and its owner issue.
7. File inventory grouped by surface disposition, including files with no material claim.

The committed Markdown must equal renderer output byte-for-byte. The renderer may include compact Markdown tables only where cells stay short; long evidence and rationale fields render as bold-lead lists.

### Validation rules

The validator must fail non-zero when any of these conditions holds:

- schema, issue, source commit, timestamp, enum, identifier, or required string is invalid;
- `files` is not an exact, duplicate-free set of the paths returned by `git ls-tree -r --name-only <source_commit> -- README.md docs website`, excluding the FAFF-732 report, ledger, validator, and focused test outputs because they did not exist in the audited source snapshot;
- a claim source is absent from `files`, a claim ID is duplicated, or `files[].claim_ids` and `claims[].source.path` disagree;
- a scanner match from a `current-public` file has no candidate disposition, a `claim` disposition lacks a valid claim ID, or a non-claim disposition lacks a rationale;
- an `enforced` claim lacks both the mechanism that can deny the unsafe action and the live activation path that makes that mechanism binding; an `attested` or `demonstrated` claim lacks evidence of its corresponding support type;
- a `planned`, `stale`, or `unsupported` claim lacks a valid `FAFF-N` owner issue;
- a claim is missing `kind`, `current_state`, or a stable source anchor;
- `planned`, `stale`, or `unsupported` claims are absent from the generated evidence-gap section;
- the committed Markdown differs from `--render` output.

The validator exposes `--selftest`. Its fixtures include one valid report and one failure for each rule family, including missing file coverage, an undispositioned claim candidate, false evidence strength, absent owner, mismatched claim references, and render drift. The report renderer is the template: the focused test runs `--render`, captures its bytes, and compares them directly with the committed Markdown, so no pre-authored report fixture is required.

## 4. HOW: audit and publication behaviour

### Inventory and classification procedure

```text
PROCEDURE build_claim_ledger:
  1. Record the current pre-change forty-character Git commit as source_commit.
  2. Enumerate tracked README.md, docs/**, and website/** paths from source_commit with git ls-tree.
  3. Assign every path one surface disposition.
  4. Scan current-public prose for claim candidates and record a disposition for every match.
  5. Review current-public prose for material trust and enforcement claims, including claims the scanner did not match.
  6. For each material claim:
     a. Record one stable source anchor and one claim kind.
     b. Inspect the mechanism, its activation or mandatory call path, tests, run record, and relevant issue.
     c. Assign exactly one status using the classification rules.
     d. Link direct evidence at the strength claimed.
     e. For planned, stale, or unsupported status, link an owning FAFF issue. If no focused owner exists,
        emit a concrete discovered-scope record and stop this build attempt before publication.
     f. Record current state and target state when they differ.
  7. Define preferred terms and deprecated aliases found during the review.
  8. Validate the ledger.
  9. Render the Markdown report from the validated ledger.
  10. Run validation again with render-parity checking.
```

`historical-record` includes dated audits, accepted ADRs, and issue-specific design specs unless the file explicitly presents a statement as current product truth. `test-or-fixture`, `generated-or-metadata`, and `non-prose` entries are not searched for reader-facing claims, but they remain visible in the inventory and may be cited as evidence.

### Classification precedence

When more than one status appears plausible, assign the strongest status directly supported by evidence, using this precedence only after the evidence type is established:

```text
IF current text contradicts current product state: stale
ELSE IF text asserts a capability with no supporting artifact or owner: unsupported
ELSE IF capability is future work with an owner: planned
ELSE IF a machine gate or validator compels the claimed outcome: enforced
ELSE IF a declared boundary reports compliance without preventing forgery: attested
ELSE IF a recorded execution shows the outcome but does not compel future outcomes: demonstrated
```

An attestation or demonstration must not be upgraded to enforcement because code or tests exist. An `enforced` row requires two direct evidence entries: `enforcement-mechanism` names the boundary that rejects or aborts the unsafe action, and `enforcement-activation` traces the live mandatory path or binding policy that invokes it. Optional code, an emitter-authored status, and an unrequired CI check are not enforcement. `status-history` supports why a claim is `planned`, `stale`, or otherwise changed over time; it never upgrades a claim to enforcement, attestation, or demonstration.

### Owner issue handling

Reuse an existing issue when its scope clearly owns the gap, including FAFF-588 for public external-verification results and FAFF-739 for front-page positioning. The implementer never writes the tracker. If no focused issue owns a gap, the build attempt writes the standard discovered-scope record under the run directory, leaves the ledger invalid, and stops before committing or publishing the report. The outer faff orchestrator files the focused Backlog issue between attempts. A later graft attempt re-reads tracker state and writes the returned real ID into the ledger. No test or clean build requires a synchronous tracker callback, and no placeholder ID or broad FAFF-732 ownership is permitted.

### Integration smoke test

```text
GIVEN the committed claim ledger and report
WHEN the repository test invokes validate-report on the ledger and compares --render output
THEN validation succeeds, the report matches exactly, every tracked in-scope path is inventoried,
     and each unresolved claim points to a real FAFF issue identifier
```

### Failure modes

- **The inventory is mechanically complete but semantically shallow.** How to notice: high-signal current pages are marked with no claims despite containing guarantee language. What it means: fail review and add the missing claims; path coverage is a floor, not proof of good judgement.
- **Evidence paths exist but do not support the assigned strength.** How to notice: an `enforced` row cites only prose or a test while no runtime gate is named. What it means: downgrade the status or cite the actual enforcing mechanism.
- **The report is mistaken for continuous coverage.** How to notice: later source edits are assumed to have been audited because validation still passes. What it means: validation checks the immutable `source_commit` snapshot. A later refresh workflow may compare current claim-bearing files against the ledger, but this ticket does not make that comparison a standing CI gate.

**Anti-pattern:** classify every sentence containing “must”, “safe”, or “guarantee” as a claim. Why: requirements in historical specs and test descriptions are not necessarily current public product promises.

**Anti-pattern:** cite a ticket as proof that a capability exists. Why: a ticket supports planned or historical status; it does not demonstrate or enforce behaviour.

**Anti-pattern:** hand-edit the rendered stale report or evidence-gap list. Why: the structured ledger is authoritative and the renderer owns all derived sections.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```text
Given a path tracked under README.md, docs/**, or website/** at the ledger's source_commit
When the FAFF-732 validator checks the claim ledger
Then the path is represented exactly once with a surface disposition and either claim IDs or a no-claim rationale
```

```text
Given a public claim that says a gate prevents an unsafe outcome
When the audit finds only emitter-authored compliance evidence and no enforcing boundary
Then the ledger classifies the claim as attested, stale, or unsupported rather than enforced, with the evidence and gap owner visible
```

## 6. DESIGN DECISION RATIONALE

**Where does the authoritative audit live?** A prose-only report is readable but hard to validate. Separate hand-maintained prose and JSON can drift. A canonical JSON ledger under the dated audit directory, with deterministic Markdown rendering, matches the existing FAFF-435 audit pattern and keeps one source of truth.

**Chosen:** store the authoritative data in `claim-ledger.json` and generate the committed audit Markdown from it with the dependency-free validator.

**How broad is inventory coverage?** Limiting review to guide and concept pages misses root and website claims. Treating every historical spec sentence as a live promise creates noise. A complete tracked-file inventory plus explicit surface dispositions preserves coverage while separating current prose from historical and non-prose material.

**Chosen:** inventory every path in the immutable `source_commit` snapshot under the ticket's three named roots, but classify material claims only where the file presents current public truth; record all other paths with an explicit disposition and rationale. Validation of the dated audit never compares it with a future working tree.

**Which classifications are mechanically checkable?** A validator can check enums, referential integrity, evidence presence by type, owner presence, full path coverage, and render parity. It cannot decide whether prose is materially a claim or whether cited code truly enforces the sentence.

**Chosen:** mechanise shape, immutable-snapshot coverage, support-type presence, gap-ownership, and render consistency while keeping semantic classification as an auditable human or agent judgement recorded in the ledger. Enforcement requires separate mechanism and live-activation evidence so code existence cannot masquerade as a binding gate.

**How are product guarantees separated from process observations?** Separate reports risk duplicating evidence and terminology. A required claim-kind field keeps one ledger while making the distinction filterable and visible in every rendered row.

**Chosen:** require `kind: product-guarantee | process-observation` on every claim and render the kind alongside its status.

**How is the audit made discoverable?** The website publishes only guide and concept trees, and expanding its navigation would mix this baseline with FAFF-739’s positioning work. The root README already indexes reports and is the stable public front door.

**Chosen:** add one README “Going further” link to the dated audit and leave website navigation and copy unchanged.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

No open questions remain. The issue’s two choices are closed by the existing machine-audit precedent and the validator boundary above.

## 8. DONE: definition of done

### From WHY and scope

- [ ] One dated audit classifies every material current trust or enforcement claim found in the tracked `README.md`, `docs/**`, and `website/**` inventory.
- [ ] Every claim records exactly one product-guarantee or process-observation kind and exactly one allowed status.
- [ ] Historical records, tests, fixtures, generated metadata, and non-prose files remain visible in the inventory without being presented as current product promises.

### From WHAT

- [ ] `claim-ledger.json` matches the specified schema, records the immutable source commit, and is the sole authored source for the report's claim rows, stale-content section, terminology map, current-versus-target account, evidence-gap list, and file inventory.
- [ ] The file inventory equals the duplicate-free path set at `source_commit` for `README.md`, `docs/**`, and `website/**`, subject only to the documented FAFF-732 output exclusion.
- [ ] Every recall-biased scanner match in current-public prose has an inspectable disposition, and every `claim` disposition maps to a ledger claim.
- [ ] Every enforced row cites both an enforcement mechanism and its live mandatory activation path; every attested and demonstrated row cites evidence of the corresponding support type.
- [ ] Every planned, stale, and unsupported row cites a real `FAFF-N` owner issue and appears in the evidence-gap section.
- [ ] Every claim has a stable source anchor, current-state account, evidence list, and target state where current and intended truth differ.
- [ ] The terminology map records preferred terms and deprecated aliases found in the audited prose.

### From HOW and verification

- [ ] `validate-report.mjs` fails closed on invalid shape, incomplete immutable-snapshot inventory, undispositioned claim candidates, duplicate or dangling references, missing mechanism or activation evidence for enforcement, mismatched evidence strength, missing gap ownership, and render drift.
- [ ] `validate-report.mjs --selftest` covers a valid fixture and each validation-rule family.
- [ ] `test/public-trust-claims.test.mjs` runs the self-test, validates the committed ledger, and proves the committed Markdown equals deterministic renderer output.
- [ ] `npm test` passes, and `npm --prefix website run build` still succeeds with no website-copy change.
- [ ] `README.md` links to the readable dated audit from “Going further”.

### From failure modes

- [ ] Review checks every high-signal current-public source named in Reference context for at least one explicit disposition and rejects evidence that is merely adjacent to the claimed strength.
- [ ] The report states that it is a dated `source_commit` baseline and does not claim continuous semantic enforcement or current-tree coverage over later prose edits.

## Producer self-review

- **Codebase fit:** the draft follows the existing dated-audit plus JSON sidecar and dependency-free validator pattern used by FAFF-435. Resolution: retained.
- **Scope check:** generated website output and package metadata are inventoried but not treated as claim-bearing prose; the three roots named by the issue remain complete through `git ls-files`. Resolution: made the disposition explicit rather than silently excluding paths.
- **Acceptance testability:** semantic judgement cannot be proved mechanically, but path coverage, enums, evidence-type requirements, ownership, and render parity have concrete checks. Resolution: separated the judgement boundary from enforceable validation.
- **Dependency check:** FAFF-732 has no blockers and precedes FAFF-733, FAFF-735, and FAFF-739. Related shipped work narrows evidence interpretation but does not deliver this ledger. Resolution: no blocker or punt added.
- **Adversarial revision 1:** the original current-tree parity check contradicted a dated audit. Resolution: validation now targets an immutable pre-change `source_commit` snapshot and excludes only this ticket's outputs. The original enforcement evidence rule also allowed code existence to read as a binding gate. Resolution: `enforced` now requires separate mechanism and live-activation evidence. Tracker creation moved from the implementer to the standard orchestrator discovered-scope handoff. Stable IDs and `status-history` now have defined behaviour.
- **Adversarial revision 2:** QA correctly identified that semantic coverage and missing-owner handoff needed observable boundaries. Resolution: a recall-biased claim-candidate scanner now requires a disposition for obvious guarantee language, while the spec still states that semantic sufficiency is judgement. Missing owners now stop the build attempt and use the persisted discovered-scope record between attempts; there is no synchronous tracker callback. The renderer itself defines the byte-comparison oracle.
- **Producer self-review:** the revised rules match the existing dated-audit pattern without making later documentation edits fail an unrelated snapshot test. The semantic audit remains an explicit build-agent task; deterministic code validates the data and rendering boundary. No unresolved blocker or major producer finding remains.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized and cohesive:** the ledger, renderer, validator, and public link form one thin audit slice. Splitting the renderer from the ledger would ship either unverifiable data or an unreadable artifact, so they should land together.
- **Workstream fit:** FAFF-732 creates the factual baseline promised by “Public trust claims have an authoritative status”. It does not absorb the downstream terminology guide, harness-status page, or front-page rewrite.
- **Dependencies:** no incoming blocker is present. FAFF-733, FAFF-735, and FAFF-739 correctly depend on this baseline, so completing the audit first prevents those tickets from rewriting against unclassified claims.
- **Risk:** semantic under-classification is the main uncertainty. A complete tracked-file inventory, explicit no-claim rationales, evidence-strength rules, and review of named high-signal surfaces de-risk it without creating a separate spike.

## Spec-review verdict

The second bounded review iteration returned one objection per lens. Grounding against the supplied spec and repository context removed all four because their premises were contradicted by the evidence: the audit artefact is not a faff producer-slot contract; the validator is specified as data-only JSON parsing rather than code evaluation; the focused test explicitly runs the renderer and compares its bytes; and spec review occurs before the listed implementation files exist. No grounded gating objection remains.

```faff-contract:spec-review-verdict
{"verdict":"approve","objections":[]}
```

spec-review: approve

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"}]}
```

