# FAFF-733: Publish the canonical Faff language guide

> Spec: faffter-dark-nlspec · 2026-08-08 · interactive · confidence: high. Full spec on Linear FAFF-733.

This specification defines the documentation and decision-record changes for FAFF-733. It is written for the build agent and reviewers who must establish one authoritative public language source without renaming current technical identifiers.

## Refresh note

Revised on 2026-08-08 after FAFF-732 shipped the public trust-claims audit in PR #564 and FAFF-746 shipped the clean-review parser fix in PR #566. The 2026-08-07 park comments recorded those two process blockers; neither changed the product decisions in this spec.

Spec-review revision 1 grounds claim wording in pinned ledger tuples, defines the structural documentation oracle, and makes the ignored July brief's historical-record treatment explicit.

Spec-review revision 2 replaces proxy checks with exact owned-region, paragraph, link, marker, and review-rubric boundaries.

## 1. WHY: problem and principles

The change depends on one ownership rule: product positioning and language live in one canonical concept page, while every other document either gives a short context-specific summary or links to that page.

Current public prose already says that Faff is "safe to stop watching" and that trust is earned per rung, but it has no settled account of SuperDomestique, Commissaire, or the transition from the current Faff identity. The July 2026 positioning brief explicitly rejects a separate brand and rename, which now conflicts with the target direction. FAFF-733 records the new decision, publishes the language people should use, and keeps technical identifiers stable during the transition.

**Evidence governs claims.** The guide must distinguish implemented mechanisms, observed results, and target direction. It must link the public-claims audit rather than turn planned or attested behaviour into an enforcement claim.

**One source owns the language.** The concept page contains the full definitions and writing rules. The glossary remains a lookup and other concept pages keep only enough summary to orient a reader.

**The transition must not break users.** This ticket changes prose and decision records. It does not rename the repository, package, CLI, configuration keys, command names, URLs, or source identifiers.

### Reference context

- `docs/superpowers/specs/2026-07-20-docs-positioning-design.md` is the earlier positioning decision. Its evidence-first and governance-product decisions remain useful; its rejection of separate branding conflicts with the current direction.
- `docs/concept/what-is-faff.md`, `docs/concept/levels.md`, and `docs/concept/governing-principles.md` contain the present public model.
- `docs/GLOSSARY.md` defines itself as a one-sentence lookup whose normative prose lives elsewhere.
- FAFF-359, "Carve the logical governance boundary", shipped the in-repo governance region and its dependency-direction checks. This is evidence for a distinct governance responsibility, not evidence of a separately packaged product.
- FAFF-732, "Audit and publish the status of public trust claims", shipped the authoritative dated audit at `docs/audits/2026-08-07-FAFF-732-public-trust-claims.md` and its claim ledger at `docs/audits/2026-08-07-FAFF-732-public-trust-claims/claim-ledger.json`.
- `website/sidebars.js` autogenerates the concept navigation, so adding a concept page with front matter is sufficient for discovery in the docs site.

This ticket is the decision and canonical-language slice for the "Faff has one canonical position and vocabulary" project. README and site-wide adoption belong to downstream tickets.

## 2. OUT OF SCOPE

- **README and front-page rewrite**: FAFF-739 owns the public front page. Extension point: `README.md` and `website/src/pages/index.js` consume this guide after it lands.
- **Docs-wide transitional rename**: FAFF-738 owns applying the chosen language across public documentation. Extension point: update each public surface to link or quote the canonical guide without duplicating it.
- **Execution-governance contract**: FAFF-742 owns the detailed technical responsibility boundary. Extension point: the canonical guide links that contract once published.
- **Physical Commissaire extraction**: FAFF-359 established a logical boundary only. A separate package, service, repository, or distribution remains future work.
- **Technical identifier changes**: repository, package, CLI, commands, configuration keys, URLs, source paths, and run-artifact names remain unchanged.
- **Complete rebrand or migration date**: this ticket establishes target and transitional language. It does not choose when technical identifiers change.
- **New trust claims**: FAFF-733 classifies and links claims; it does not create evidence or upgrade a claim's status.

## 3. WHAT: vocabulary, ownership, and decisions

### 3.1 Canonical source

Create `docs/concept/positioning-and-language.md` as the authoritative source for public positioning, target naming, transitional language, maturity wording, preferred terms, misleading terms, and the short writing guide.

**Chosen:** `docs/concept/positioning-and-language.md` is the single canonical positioning and language source. It receives normal Docusaurus front matter and a sidebar position beside the existing "What faff is" page.

### 3.2 Relationship to existing concept pages and the glossary

`docs/concept/what-is-faff.md` may retain a short explanation of the harness and tracker control plane, but it must link to the canonical guide for product identity, transitional naming, and writing rules. `docs/concept/intro.md` must link the new page in its reading path. `docs/GLOSSARY.md` receives concise lookup entries for the new coined terms, each pointing to the canonical page as its owning artifact.

**Chosen:** concept pages may summarise for local context, while the glossary contains one-sentence lookup definitions only. Neither repeats the canonical guide's full positioning or writing rules.

### 3.3 Product identity

The guide must define the following terms before using them:

- **Faff**: the current project, repository, package, CLI, and shipped technical identity during the transition.
- **SuperDomestique**: the target product identity for the engineering system that runs a progressively autonomous AI software-delivery loop under deterministic governance.
- **Commissaire**: the target name for the governance responsibility that checks evidence and applies deterministic gates at trusted chokepoints. Today it is a logical responsibility inside the Faff repository, not a separately packaged product.
- **Governed autonomy**: a delivery model in which scheduled human attention decreases only as named deterministic controls, evidence, and failure paths earn that trust.
- **Rung**: one level of the L1 to L4 trust ladder for a workload. The guide must not describe a rung as a convenience tier.

**Chosen:** SuperDomestique is the target umbrella identity. Faff remains the current shipped and technical identity until separate migration work changes it.

### 3.4 Transitional naming

The guide must provide one preferred introductory form for public prose:

> SuperDomestique, currently shipped as `faff`, is an engineering system for progressively autonomous AI software delivery governed by deterministic evidence.

After that first reference, a document may use "SuperDomestique" for the target product story and `faff` for current commands, packages, configuration, repository paths, and other literal identifiers. Historical documents keep the name they were written under.

**Chosen:** use "SuperDomestique, currently shipped as `faff`" at first public mention. Do not use "formerly Faff" because the current technical product has not yet been renamed.

### 3.5 Commissaire responsibility

The guide must describe Commissaire through the responsibility it names:

- deterministic contract validation and coercion;
- run evidence, audit, and liveness records;
- budget, side-effect, and termination checks;
- review, holdout, and merge interlocks where their current evidence supports the claim.

It must also state the current boundary: FAFF-359 proves an in-repo logical governance region with a dependency-direction check. It does not prove an independent package, process, service, or security boundary.

**Chosen:** "Commissaire" names the governance responsibility and target product concept. Current architecture prose may still say "governance layer" or "governance region" when referring to existing code and artifacts.

### 3.6 Core proposition and maturity language

The guide must define "safe to stop watching" as a workload-specific outcome backed by the mechanisms named for that rung. It does not mean defect-free output, full autonomy, or that every guarantee is mechanically enforced.

The guide must state maturity per rung and per mechanism. Current evidence supports L3 unattended delivery with a run ledger and park protocol. L4 remains preview until its external proof and code-blind holdout claims reach the status recorded by the public-claims audit.

**Chosen:** every maturity or safety statement names the rung and links its supporting artifact or evidence. A general claim of "fully autonomous" or "safe" without that scope is misleading language.

### 3.7 Writing guide and terminology status

The canonical page must include a short public-writing guide:

- lead with governed autonomy and "safe to stop watching";
- describe levels as trust earned per rung;
- treat governance as a product responsibility, not an appendix;
- distinguish enforced, attested, demonstrated, planned, stale, and unsupported claims using the classifications published by FAFF-732;
- use current identifiers literally and target names conceptually;
- avoid the retired convenience-tool, chore-removal, project-management, and unqualified full-autonomy framing;
- state gaps with a status, evidence link, and owning issue.

The page must also carry a terminology-lifecycle list with four categories: preferred public term, retained technical identifier, misleading or retired term, and unsettled future decision. This is a naming lifecycle axis, distinct from the six evidence statuses applied to claims. Known unsettled decisions are the exact statements "Whether Commissaire becomes a separate distribution remains unsettled" and "Whether or when `faff` technical identifiers are renamed remains unsettled." Those decisions remain visible without being decided here.

**Chosen:** the language guide records unsettled future naming decisions explicitly but does not turn them into `**Punt:**` items for this build. They are intentional boundaries of the transitional position.

### 3.8 Superseding the July positioning brief

Create a new ADR recording the target SuperDomestique identity, the Commissaire responsibility, and the staged transition that preserves current technical identifiers. The ADR must name the July 2026 positioning brief and state exactly which prior decisions it supersedes: the rejection of a separate brand and the "no renaming" non-goal. The earlier brief's evidence-first policy, trust-per-rung model, and treatment of governance as a product remain in force.

The July brief currently exists under the ignored `docs/superpowers/` planning tree. Add this one file to version control as a historical record with an explicit path-scoped force-add, without changing the ignore rule or admitting sibling planning files. At byte zero, prepend this owned notice region:

```text
<!-- faff-positioning-supersession:FAFF-733 -->
> **Status:** This historical brief is partly superseded. The accepted FAFF-733 ADR records the decision; the canonical language guide states the current position.
<!-- /faff-positioning-supersession:FAFF-733 -->

```

The original first byte, `# Docs positioning`, follows the displayed blank line. The test requires exactly one opening and closing marker, requires the region to begin at byte zero, removes everything through the two newline bytes after the closing marker, and hashes every remaining byte. That remainder must retain SHA-256 `577d78f1beb1f72dd0378c960d7773be6c0ad6e1a35319085cb9ee1922a7083a`. This is a regression check for historical preservation, not a security boundary.

**Chosen:** the accepted ADR is the decision authority. The newly tracked historical brief keeps its original body byte-for-byte and receives only a factual pointer to the ADR and canonical guide.

### 3.9 Public-claims audit dependency

The canonical guide must link the dated audit at `docs/audits/2026-08-07-FAFF-732-public-trust-claims.md` and use its shipped classifications without presenting the snapshot as continuous semantic enforcement. The build must re-read the merged audit and claim ledger before editing claim-status prose.

**Chosen:** FAFF-732's dated audit and machine-readable claim ledger are the authority for status wording in this slice. Later evidence changes require an explicit audit refresh rather than silent reinterpretation in the language guide.

Add `test/positioning-language-doc.test.mjs` as a dependency-free structural oracle. It does not claim to prove semantic completeness. It must:

1. Load the FAFF-732 ledger, require `source_commit == 5120f5481e64c759769e76b61955550022f12223`, and require these exact claim tuples: `readme-safe-to-stop-watching / attested`, `readme-l3-park-and-ledger / enforced`, and `l4-completion-claim / unsupported`.
2. Outside fenced code blocks, require one `<!-- faff-claim-status:<id>:<status> -->` marker on its own line immediately before the paragraph it classifies for each tuple. Reject marker text inside other Markdown contexts, unknown or duplicate markers, and any marker whose identifier or status differs from the ledger.
3. Require the canonical headings `Current and target identity`, `What Commissaire means today`, `Maturity and evidence`, `Writing guide`, and `Unsettled decisions`. Require definition entries for Faff, SuperDomestique, Commissaire, and governed autonomy, each with explicit current or target status and a boundary sentence stating what it is not. Under `Unsettled decisions`, require the two exact statements from section 3.7.
4. Enforce a required minimum link graph: the canonical page links the FAFF-732 audit, tracked July brief, ADR 0042 file, and one added ADR whose body names FAFF-733; the brief notice links the canonical page and that ADR; the new ADR links the canonical page, brief, audit, and ADR 0042; `intro.md`, `what-is-faff.md`, and the three new glossary rows link back to the canonical page. Additional links are allowed. Parse every relative link added to the changed files, resolve its repository path, and when it carries a fragment require the GitHub-compatible heading slug in the target. ADR 0042 needs no reverse link.
5. Check only the new glossary rows for SuperDomestique, Commissaire, and governed autonomy. After Markdown link destinations and inline-code delimiters are removed, each meaning cell must end with one period and contain no other `.`, `?`, or `!`; semicolons and colons are not boundaries. A passing shape is: `Target product identity; current commands remain faff.`
6. Compare paragraphs, not sliding word windows. Split outside fenced code on blank lines; discard headings, link-only lines, and paragraphs shorter than 12 words. Normalize each remaining paragraph with Unicode NFKC, lowercase, replace Markdown link destinations and inline-code delimiters, replace punctuation with spaces, and collapse whitespace. Reject an exact normalized paragraph present in both the canonical guide and either touched consumer page, `intro.md` or `what-is-faff.md`. Short phrases and independently written summaries remain allowed.
7. Apply the exact byte-zero marker-region splice from section 3.8 to the tracked July brief, require that it is tracked despite the unchanged ignore rule, and require the original-body SHA-256 above.

Local targets resolve inside the repository root and heading fragments use the repository's GitHub-compatible slug rules.

The L3 semantic review has a repeatable pass/fail rubric. List every guide line that matches the FAFF-732 recall families: guarantee modals (`will`, `must`, `cannot`, `always`, `never`), enforcement terms, L1 to L4 or unattended language, and support-status terms. Pass only when each line is one of the three mechanically marked audit claims, or it explicitly says `current`, `target`, `historical`, `planned`, or `unsettled` and links its owning local artifact. Fail with the unmatched line and required correction otherwise. This review procedure owns semantic disposition; the focused test owns the structural subset and does not claim that a digest, marker, or regex is a security boundary.

### 3.10 Document ownership shape

The delivered documentation must follow this ownership map:

```text
DOCUMENT positioning-and-language:
  owns: product position, target names, transitional wording,
        maturity wording, public writing rules, unsettled terms

DOCUMENT GLOSSARY:
  owns: one-sentence lookup definitions and artifact links

DOCUMENT what-is-faff:
  owns: short current-system overview and tracker-control-plane explanation

ADR staged-superdomestique-transition:
  owns: why the naming direction changed and which earlier decision it supersedes

DOCUMENT public-claims-audit:
  owns: evidence-backed status of each public trust claim
```

**Chosen:** each fact has one owner in this map. Cross-links replace duplicated normative prose.

## 4. HOW: documentation flow

### 4.1 Produce the decision record

The ADR created from the promotion intent below records the staged naming decision before the guide presents it as settled. The ADR must use the repository's current accepted format and link FAFF-733, the July positioning brief, FAFF-359, and the FAFF-732 audit artifact.

### 4.2 Publish the canonical page

Write the canonical page from the decisions in section 3. Keep claims tied to the public-claims audit and current code evidence. Use prose and short definition lists rather than a wide comparison table.

### 4.3 Connect existing documentation

Apply narrow edits:

```text
PROCEDURE connect_canonical_language_source:
  1. Add the supersession notice to the July positioning brief.
  2. Add short SuperDomestique, Commissaire, and governed-autonomy lookup rows to the glossary.
  3. Link the canonical page from the concept introduction.
  4. Link the canonical page from "What faff is" for naming and writing guidance.
  5. Preserve current technical identifiers everywhere in this ticket.
```

Do not sweep README, guide pages, or the website front page. Those changes belong to the downstream adoption tickets and need the canonical source first.

### 4.4 Validation

Run `node --test test/positioning-language-doc.test.mjs` to verify the pinned claim tuples, markers, headings, minimum link graph plus all added relative links, new glossary rows, exact-paragraph duplication boundary, and historical-body digest. Run `npm --prefix website run build` to prove the new concept route renders; because the current Docusaurus configuration only warns on broken links, the focused test remains the binding link oracle.

Review `git diff --name-only <merge-base>..HEAD` and require the spec, canonical guide, three narrow consumer surfaces, one historical brief, one ADR, and the focused test only. Review the prose for material claims not covered by a marker and for accidental renaming of repository `shftwst/faff`, CLI command `faff`, configuration prefix `faff-`, current URLs, or source identifiers. These are explicit human review checks at L3, not claims of mechanical semantic proof.

### 4.5 Failure modes

- **The claims audit is treated as continuously current**: the guide would overstate a dated snapshot. Link the shipped report, preserve its classifications, and state that later evidence changes require an explicit audit refresh.
- **Touched consumer pages copy the language guide**: an exact normalized paragraph of at least 12 words fails the focused test. Replace the copied paragraph with an independently written summary and link. Untouched README, guide, and front-page prose remains explicitly assigned to downstream adoption tickets.
- **Prose outruns the architecture**: calling Commissaire a package or independent security boundary would overstate FAFF-359. The canonical page must cite the logical region and state what it does not prove.
- **The transition becomes a technical rename**: changed package, command, configuration, repository, or URL identifiers would break the stated scope. The final diff must contain documentation and ADR changes only.
- **The earlier brief loses historical meaning**: rewriting its decisions would erase the reason for supersession. The old file receives only a notice and link.

## Scenarios

```text
Given a reader enters through the concept documentation
When they follow the positioning and language page
Then they can distinguish SuperDomestique, Commissaire, governed autonomy, and current `faff` identifiers without consulting another positioning source
```

```text
Given a contributor reads the July 2026 positioning brief
When they reach its status notice
Then they can see which no-rebrand decisions were superseded, which decisions remain active, and the ADR that records the change
```

```text
Given the three audit-backed maturity and enforcement statements in the canonical guide
When the focused test reads their adjacent claim-status markers
Then each identifier and status exactly matches the pinned FAFF-732 ledger tuple
```

## 5. DESIGN DECISION RATIONALE

### Where should the canonical source live?

`docs/concept/` is already the public home for the system model and is built into the documentation site. `docs/GLOSSARY.md` explicitly limits itself to one-sentence lookup entries, and an ADR records why a decision changed rather than carrying a full public writing guide.

**Chosen:** publish the guide at `docs/concept/positioning-and-language.md`; keep short linked entries in `docs/GLOSSARY.md`.

### How should the earlier no-rebrand decision be superseded?

Editing the old brief in place would obscure what was originally agreed. A new ADR provides the durable rationale and supersession relation, while a short notice prevents readers from treating the old no-rebrand clause as current.

**Chosen:** create a new ADR and add a notice to the old brief without changing its historical body.

### How far should transitional naming reach?

A full identifier rename would combine public positioning with package and compatibility migration. Keeping technical identifiers stable lets downstream documentation adopt the target story before a separate migration decision exists.

**Chosen:** change public conceptual language only; retain all current `faff` technical identifiers.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

No build-blocking product or architecture question remains. The canonical guide records the two deliberately unsettled future decisions: physical Commissaire distribution and any later rename of `faff` technical identifiers.

### Assumptions

No unresolved build assumption remains. FAFF-732 is Done, PR #564 is merged, and its dated audit and claim ledger paths are known.

## 7. DONE: definition of done

### From WHY

- [ ] `docs/concept/positioning-and-language.md` is the one authoritative positioning and language source and is discoverable through the concept documentation.
- [ ] The guide carries the three required claim-status markers, and the focused test proves each identifier and status matches the pinned FAFF-732 ledger tuple.

### From OUT OF SCOPE

- [ ] The diff does not rename repository, package, CLI, command, configuration, URL, source, or run-artifact identifiers.
- [ ] The diff does not perform the README, site-front-page, or docs-wide transitional naming sweep owned by downstream tickets.

### From WHAT

- [ ] The canonical guide defines Faff, SuperDomestique, Commissaire, governed autonomy, "safe to stop watching", and trust earned per rung.
- [ ] The guide contains current-versus-target naming, maturity wording, preferred and misleading terms, the short writing guide, and the two unsettled future naming decisions.
- [ ] The guide uses "SuperDomestique, currently shipped as `faff`" for first public mention and reserves literal `faff` for current technical identifiers.
- [ ] `docs/GLOSSARY.md` contains concise linked lookup entries without duplicating the full guide.
- [ ] `docs/concept/intro.md` and `docs/concept/what-is-faff.md` point readers to the canonical guide without duplicating its normative rules.
- [ ] A new ADR records the staged identity decision and explicitly supersedes only the July brief's separate-brand rejection and no-renaming non-goal.
- [ ] The single July positioning brief is added as a tracked historical record, its notice links the new ADR and canonical guide, and its original-body digest remains unchanged.
- [ ] The canonical guide links the FAFF-732 dated audit and uses the three pinned claim classifications without describing the snapshot as continuously current.

### From HOW

- [ ] The focused test resolves the required minimum link graph and every added relative link, and rejects exact normalized paragraph duplication on the two touched consumer pages.
- [ ] `npm --prefix website run build` completes successfully and emits the canonical concept page.
- [ ] A final diff review applies the line-level disposition rubric, records every unmatched line as a failure, and confirms the declared file scope and current technical identifiers.

### Integration smoke test

```text
PROCEDURE smoke_test_canonical_language_guide:
  1. Run `node --test test/positioning-language-doc.test.mjs` and require exit 0.
  2. Run `npm --prefix website run build` and require exit 0.
  3. Require `website/build/concept/positioning-and-language/index.html` after the build.
  4. Review `git diff --name-only <merge-base>..HEAD` against the declared file scope.
  5. Review unmarked material claims and current technical identifiers using the explicit L3 review checklist in section 4.4.
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

No delivery-shape issue found. FAFF-733 is one cohesive one-to-three-day documentation decision slice: the ADR, canonical guide, glossary lookups, and supersession notice must ship together to make the new language authoritative. FAFF-732 is now Done, and the issue already declares the downstream tickets that consume this source. No split, merge, new blocker link, or de-risking spike is indicated.

## Producer self-review

- **Codebase fit:** passed. `docs/concept/` is an autogenerated Docusaurus collection, and `docs/GLOSSARY.md` explicitly limits itself to linked one-sentence entries.
- **Assumption validity:** passed. FAFF-732 is Done and PR #564 provides the dated audit and claim-ledger paths used by this spec.
- **Decision closure:** passed. Both issue questions are resolved from existing repository conventions; no `**Punt:**` remains.
- **Acceptance testability:** passed after revision 2. The focused test pins claim tuples, marker context, definition boundaries, a minimum link graph plus all relative targets, glossary punctuation, exact normalized paragraph duplication, and an owned historical-notice splice; the L3 semantic review has a line-level disposition rubric.
- **Scope and interfaces:** passed. README and docs-wide adoption stay in downstream tickets, while the old brief receives only a supersession notice.

spec-review: approve

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" },
  { "marker": "chosen" }
] }
```
