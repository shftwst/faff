# FAFF-754: Define a cleaner docs structure without breaking machine-consumed paths

> Spec: faffter-dark-nlspec · 2026-08-08 · interactive · confidence: high. Full spec on Linear FAFF-754.

This specification defines a one-day planning spike for FAFF-754. It is written for the agent performing the audit and for reviewers deciding which documentation changes should follow.

## 1. Why: problem and principles

Several paths under `docs/` are read or executed by config, commands, skills, tests, workflows, and Docusaurus. A safe information-architecture plan must treat those exact paths as compatibility constraints before it recommends a move.

The shipped tree contains 724 tracked documentation files across reader guides, design records, evidence, audits, reports, and executable assets. Browsing the directory does not explain which material is written for consumers, which material records decisions, or which paths are program inputs. This spike produces an evidence-backed classification and a staged work plan without changing the tree.

**Use shipped state for repository facts.** Resolve and record the `origin/main` commit at the start of the spike. Treat the working tree as a separate overlay because it can be behind `origin/main` and can contain ignored or empty directories.

**Treat exact paths as compatibility constraints.** A path consumed by config, code, a skill, a test, a workflow, the website, or a public link cannot be proposed for a move without identifying every consumer and the checks required to migrate it.

**Keep planning separate from implementation.** The spike records findings and creates follow-up tickets. It does not move files, alter routes, rewrite documentation, or add tests that assert prose.

### Reference context

- **`.faffrc.yaml` and the spec-path resolver:** `tracking.spec_docs_path` points to `docs/specs/`.
- **`plugin/skills/faff/bin/lib/adr.js` and graft flows:** ADR commands and merge checks use `docs/adr/`.
- **`plugin/skills/faff/bin/lib/prdr.js` and graft flows:** PRDR commands and merge checks use `docs/prdr/`, including when no tracked PRDR exists.
- **`.github/workflows/job-surface-probe.yml`:** Executes `docs/spikes/2026-07-26-FAFF-654/probe.sh`.
- **`website/docusaurus.config.js`:** Publishes `docs/guide/` at `/guide` and `docs/concept/` at `/concept`.
- **Evidence, audit, positioning, and scaffolder tests:** Load exact paths under `docs/evidence/`, `docs/audits/`, `docs/superpowers/`, and `docs/external-verification/`.
- **`faff ci-triage` and guide instructions:** Read or use assets under `docs/ci/`.
- **FAFF-737, consumer-guide reorganisation:** Already reorganised the consumer guide.
- **FAFF-741, run-outcome documentation:** Already added run-outcome guidance and evidence.

This spike sits between the completed consumer-documentation work and later changes to repository organisation.

## 2. Out of scope

- **Moving, renaming, adding, or deleting documentation files:** The inventory must precede any physical change. Follow-up tickets produced by this spike own later changes.
- **Changing Docusaurus routes, sidebars, or source directories:** Publication changes need their own link and build checks. A website follow-up ticket owns them.
- **Rewriting guide, concept, README, or branding copy:** FAFF-737 and FAFF-741 already cover the recent consumer-doc work. A content ticket must cite a specific remaining gap.
- **Adding redirects:** No route or file move occurs in this spike. The ticket changing a public path owns its redirect.
- **Choosing a repository-wide broken-link checker:** FAFF-659 owns that decision.
- **Changing config, CLI behaviour, skills, tests, or workflows:** The spike observes these consumers but does not alter them. A follow-up ticket owns each affected consumer set.
- **Adding tests that check literal wording:** Prose wording is not a functional contract. No follow-up is required.
- **Repeating FAFF-737 or FAFF-741:** Both changes are already on `origin/main`. The audit records only remaining structural gaps.

## 3. What: audit records and classifications

### Vocabulary

- **Shipped tree:** The tracked files and directories at the recorded `origin/main` commit.
- **Local overlay:** Immediate children present in the working tree, including empty and ignored paths.
- **Consumer:** A config entry, command, skill, test, workflow, website source, or exact public link that depends on a path.
- **Executable content:** A script, program, data file, or copied asset used as part of an operation.
- **Publication:** Whether Docusaurus publishes the item or it remains available through the repository.
- **Disposition:** The rule governing later work on the item.
- **Unresolved reference:** A tracked reference to a path that is absent from the shipped tree and cannot be classified as valid or stale from repository evidence alone.

### Audit report shape

```text
RECORD DocumentationStructureAudit:
  baseline_commit: GitCommit
  baseline_counts: Map<Path, Integer>
  shipped_children: Set<Path>
  local_overlay_children: Set<Path>
  referenced_absent_children: Set<Path>
  inventory: List<DocumentationEntry>
  unresolved_references: List<ReferenceFinding>
  target_categories: List<TargetCategory>
  publication_decision: PublicationDecision
  follow_up_tickets: List<TrackerIssue>

RECORD DocumentationEntry:
  path: Path
  tracked_state: tracked | local-only | ignored | empty | referenced-absent
  tracked_file_count: Integer
  primary_audience: consumer | contributor | maintainer | operator | agent
  publication: website | repository-only
  public_links: List<SourceLocation>
  consumers: List<ConsumerReference>
  executable_content: List<Path>
  primary_category: public-product-docs
                  | contributor-reference
                  | controlled-records
                  | operational-assets
                  | evidence-and-research
  additional_roles: Set<primary_category>
  disposition: keep-fixed | presentation-only | separately-verified-move-candidate
  reason: String
  required_checks_for_later_change: List<CommandOrInspection>

RECORD ConsumerReference:
  source_path: Path
  source_location: String
  consumer_kind: config | cli | skill | test | workflow | website | documentation-link
  dependency_kind: exact-path | directory | glob | generated-path | copy | execute | immutable-record

RECORD ReferenceFinding:
  source_path: Path
  referenced_path: Path
  evidence: String
  status: unresolved
  proposed_follow_up: TrackerIssue | none
```

Each immediate `docs/` child appears once in the inventory. Mixed directories receive one primary category and as many additional roles as the evidence requires. Exact executable, immutable, or machine-loaded files inside mixed directories are listed separately.

The inventory uses three outcomes:

- `keep-fixed`: later presentation work may describe or link the path, but a move is not proposed.
- `presentation-only`: later work may improve navigation or explanation without changing the path.
- `separately-verified-move-candidate`: a later ticket may propose a move after naming all consumers, compatibility work, and checks.

The report must include known machine-consumed surfaces under `docs/specs/`, `docs/adr/`, `docs/prdr/`, `docs/spikes/`, `docs/guide/`, `docs/concept/`, `docs/evidence/`, `docs/ci/`, `docs/external-verification/`, `docs/audits/`, and `docs/superpowers/`. It must also record tracked root files and locally present or referenced paths such as `docs/rfc/`, ignored reports, and absent design or report targets.

Docusaurus continues to publish only `docs/guide/` and `docs/concept/` until a later ticket changes that boundary. Other material remains repository-only, including material reached by a direct GitHub link.

The completed audit is posted as one final comment on FAFF-754. The comment contains the baseline, inventory, unresolved references, target categories, publication decision, and links to the follow-up tickets. No second planning document is added under `docs/`.

## 4. How: audit procedure

### Establish the baseline

```text
PROCEDURE establish_baseline:
  1. Fetch or otherwise verify the available origin/main reference.
  2. Resolve origin/main to one commit and record the commit.
  3. Count tracked files under each immediate docs child at that commit.
  4. List immediate children in the working tree.
  5. Record ignored and empty local children without treating them as shipped.
  6. Add docs paths named by tracked consumers even when the path is absent.
  7. Store the union as the inventory worklist.
```

The prep exploration found 724 tracked files at `origin/main`: 485 specs, 96 ADRs, 36 external-verification files, 31 spike files, 27 evidence files, 11 guide files, 10 audit files, 7 concept files, 7 report files, 5 architecture files, 4 CI files, one tracked superpowers file, and four root files. The spike refreshes these values against its recorded baseline instead of copying the prep counts without checking them.

### Find path consumers

```text
PROCEDURE inventory_consumers(entry):
  1. Search origin/main for the exact path and directory path.
  2. Search config resolvers, commands, skills, tests, workflows, website config,
     README files, guide files, and concept files.
  3. Inspect generated-path and glob logic that will not contain an exact filename.
  4. Record each source location and how it consumes the path.
  5. IF a referenced target is absent:
     a. Record it as unresolved.
     b. Do not infer that it is stale.
     c. Do not fix it in this spike.
  6. IF executable or machine-loaded files occur inside a mixed directory:
     a. Add file-level entries under executable_content.
     b. Name the checks a later change would have to run.
```

The search records both positive and negative evidence. A claim that a directory has no consumers includes the search terms and scopes used to reach that result.

### Classify each entry

```text
PROCEDURE classify(entry):
  1. Assign the primary audience and publication.
  2. Assign one primary category and any additional roles.
  3. IF any consumer depends on an exact path, directory, glob, generated path,
     copied asset, executed file, or immutable record:
       disposition = keep-fixed
  4. ELSE IF clearer browsing can be achieved through navigation or explanation:
       disposition = presentation-only
  5. ELSE:
       disposition = separately-verified-move-candidate
  6. Record the evidence and later checks supporting the disposition.
```

The target categories are a presentation model in the audit report. They are not proposed replacement directories.

### Produce follow-up tickets

Create the smallest independently deliverable follow-up tickets supported by the audit. Keep presentation-only work separate from a move that changes consumers. A move ticket must include every identified consumer and the checks required for that path.

At minimum, assess whether the evidence supports tickets for:

- a repository documentation landing page or navigation explanation;
- a publication or website-navigation change;
- one or more safe moves for unconsumed material;
- migration of executable assets from mixed documentation directories;
- unresolved-reference cleanup that does not duplicate FAFF-659.

Do not create a ticket when the audit finds no change worth making. Each created ticket links back to FAFF-754 and names the directory or consumer set in plain language.

### Verify the report

Check the report by inspection and existing commands. Do not add a test suite for the report.

- Every member of the inventory worklist has one entry.
- Every consumer citation resolves at the recorded baseline or is listed as unresolved.
- `tracking.spec_docs_path` and its resolver are represented.
- ADR and PRDR command, graft, workflow, and test consumers are represented.
- The FAFF-654 probe workflow is represented as an executable path consumer.
- Docusaurus publication claims match `website/docusaurus.config.js`.
- Evidence, public-trust, scaffolder, positioning, and CI asset consumers are represented.
- FAFF-737 and FAFF-741 are identified as completed work rather than follow-up scope.
- FAFF-659 remains the owner of the repository-wide broken-link-checker decision.
- Apart from the standard FAFF-754 spec committed by faff-graft, the spike changes no repository files.

### Failure modes

- **A text search misses a generated or globbed path.** The known consumer checks omit a surface such as spec discovery or PRDR resolution. Widen the search and keep the affected path fixed until the consumer is recorded.
- **The working checkout is mistaken for shipped state.** Counts or publication files differ from `origin/main`. Rebuild the report from the recorded baseline and keep local-only findings in the overlay.
- **A mixed directory receives one coarse label.** Executable or machine-loaded files disappear from the entry. Add file-level exceptions and narrow any follow-up ticket.
- **An unresolved reference is declared stale without evidence.** The report cannot show whether an ignored or external file is intentional. Leave the reference unresolved and create a separate investigation ticket only when useful.
- **The spike starts implementing its recommendations.** A repository diff contains changes beyond the standard FAFF-754 spec. Remove those changes and record them in follow-up tickets.
- **The follow-up set groups unrelated consumers.** One ticket would require independent migration and verification paths. Split it by consumer set.

## Scenarios

```text
Given the shipped docs tree, the local overlay, and paths named by tracked consumers
When the audit worklist is built
Then every immediate child or referenced-absent child has one inventory entry with its tracked state recorded
```

```text
Given a documentation path consumed by config, a command, a skill, a test, a workflow, the website, or an exact public link
When the audit assigns a disposition
Then the path is keep-fixed unless a separate follow-up names every consumer, compatibility change, and required check
```

```text
Given the completed inventory and publication evidence
When the audit proposes follow-up work
Then presentation changes, website changes, and physical moves are split according to their consumer and verification sets
```

## 6. Design decision rationale

**Which repository state should the audit describe?**

The working checkout is easy to inspect but can lag behind shipped documentation. `origin/main` describes shipped state, while a separate local overlay catches ignored and empty trees that influence contributor experience.

**Chosen:** Use a recorded `origin/main` commit as the baseline and record the working tree as a separate overlay.

**At what granularity should the docs tree be classified?**

A file-by-file inventory of 724 files would not fit a one-day spike. A directory-only inventory would hide executable and machine-loaded exceptions inside mixed directories.

**Chosen:** Inventory every immediate child, then add file-level exceptions for executable, immutable, machine-loaded, or otherwise exact-path-consumed content.

**Should the target categories become new directories in this spike?**

Changing the physical tree would mix discovery with migration and could break known consumers. A presentation classification can explain the tree and guide later tickets without changing paths.

**Chosen:** Define target categories in the audit report and make no physical tree change.

**Should the website publish more than the guide and concept directories now?**

The current website intentionally has separate guide and concept sources. The audit has no evidence that records, audits, reports, or executable assets should become website content.

**Chosen:** Keep `docs/guide/` and `docs/concept/` as the current website publication boundary; require a separate ticket for any change.

**Where should the spike result live?**

A new design, audit, or report file would add another record to the tree being assessed. The FAFF-754 issue, its standard attached spec, and linked follow-up tickets already provide a durable planning record.

**Chosen:** Post the completed decision report as one final FAFF-754 comment and create linked follow-up tickets; add no separate repository report.

**How should later work be divided?**

One broad cleanup ticket would combine navigation, website publication, executable asset migration, and record moves with different consumers and checks.

**Chosen:** Split follow-up tickets by independently verifiable consumer set, and omit changes unsupported by the audit.

**How should absent design, RFC, and report references be handled?**

Fixing or deleting them during the inventory would assume why the target is absent. Recording them preserves the evidence and lets FAFF-659 or a narrower cleanup ticket decide the remedy.

**Chosen:** Record absent targets as unresolved; do not repair them in this spike or duplicate FAFF-659.

## 7. Open questions and assumptions

### Open questions

None. The spike may conclude that a proposed category needs no follow-up change, but that is a finding rather than an open implementation decision.

### Assumptions

None. The procedure validates its repository baseline and records unresolved evidence instead of depending on an unverified external condition.

## 8. Done: definition of done

### From why

- [ ] The final FAFF-754 comment records the exact `origin/main` baseline commit and tracked file counts.
- [ ] The report distinguishes shipped state from local-only, ignored, empty, and referenced-absent paths.
- [ ] The report treats path consumers as compatibility constraints and does not propose an unverified move.

### From what

- [ ] Every immediate `docs/` child in the inventory worklist has one entry with all `DocumentationEntry` fields populated.
- [ ] Mixed directories list executable, immutable, or machine-loaded file exceptions.
- [ ] The inventory includes the known consumer surfaces under specs, ADRs, PRDRs, spikes, guide, concept, evidence, CI, external verification, audits, and superpowers.
- [ ] Root documentation files and local or referenced paths such as RFC, ignored reports, and absent design or report targets are recorded.
- [ ] The report assigns one primary category, any additional roles, and one disposition to each entry.
- [ ] The report states that Docusaurus currently publishes only guide and concept.
- [ ] Every unresolved reference includes its source, target, evidence, and follow-up outcome.
- [ ] The completed report is posted to FAFF-754, with no separate repository report.

### From how

- [ ] Each claim that a path has consumers cites source locations from the recorded baseline.
- [ ] Each claim that a path has no consumers records the search terms and scopes used.
- [ ] Follow-up tickets are created only for changes supported by the audit, link back to FAFF-754, and are split by consumer and verification set.
- [ ] Any follow-up that proposes a move names all known consumers, compatibility work, and checks.
- [ ] FAFF-737 and FAFF-741 work is not repeated.
- [ ] FAFF-659 retains ownership of the repository-wide broken-link-checker decision.
- [ ] No route, sidebar, content, redirect, config, command, skill, test, workflow, or documentation path is changed by the spike.
- [ ] No test that checks literal prose is added.
- [ ] Apart from the standard FAFF-754 spec committed by faff-graft, the spike changes no repository files.

### Audit smoke check

```text
PROCEDURE trace_known_executable_surface:
  1. Select docs/spikes/2026-07-26-FAFF-654/probe.sh.
  2. Verify that it exists at the recorded baseline.
  3. Locate every execution in .github/workflows/job-surface-probe.yml.
  4. Classify the spike directory as repository-only with an operational-assets role.
  5. Record the probe as executable content and assign keep-fixed.
  6. Confirm that any later move ticket would include workflow updates and the probe self-test.
  7. Assert that FAFF-754 itself proposes no move.
```

## Methodology critique

- **Right-sized:** No issue. FAFF-754 is a one-day planning spike with one deliverable: the final Linear audit comment. Keeping implementation in follow-up tickets prevents the audit from becoming an open-ended restructure.
- **Workstream fit:** No issue. Project-less Backlog is suitable because this ticket defines future work rather than delivering a standalone product outcome. FAFF-737 and FAFF-741 are completed context, not dependencies.
- **Dependencies:** No current blocker is required. FAFF-659 retains broken-link-checker ownership. Each follow-up should link to FAFF-754 and declare blocker relationships only where one consumer set must precede another.
- **Risk:** The main risk is declaring a path safe after missing a consumer. The `origin/main` baseline, local overlay, cited consumers, and unresolved status for absent references address this. No further de-risking spike is needed.

spec-review: approve

confidence: high

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ]
}
```
