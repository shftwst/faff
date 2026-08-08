# FAFF-739: Rewrite the front page around governed autonomy

> Spec: faffter-dark-nlspec · 2026-08-08 · interactive · confidence: high. Full spec on Linear FAFF-739.

This specification defines a documentation-only rewrite of the repository front page, site landing page and site brand metadata. It is for the build agent and reviewers responsible for keeping public claims consistent with the shipped system and its dated evidence.

## 1. Why: problem and principles

The entry points must explain governed autonomy before they explain commands. The current README and site landing page still lead with chore-removal copy, while the canonical guide now positions SuperDomestique, currently shipped as `faff`, as progressively autonomous delivery governed by deterministic evidence.

**Current and target names stay distinct.** SuperDomestique is the target product identity. `faff` remains the current repository, package, CLI, configuration, path, and URL identity.

**Claims keep their evidence boundaries.** The front page may describe the L3 park-and-ledger boundary as enforced and the safe-to-stop-watching posture as attested. It must say that evidence for an unqualified L4-complete claim remains incomplete.

| Source | Relevance |
|---|---|
| `docs/concept/positioning-and-language.md` | Canonical position, naming and maturity language |
| `docs/audits/2026-08-07-FAFF-732-public-trust-claims.md` | Dated status of public trust claims |
| `README.md` | Complete repository front page |
| `website/src/pages/index.js` | Short documentation-site entrance |
| `website/docusaurus.config.js` | Site metadata and navigation labels |

**Scope:** Rewrite the public entry points. Do not change runtime behaviour or add copy-specific validation machinery.

## 2. Out of scope

- **Harness support matrix:** FAFF-735 owns detailed harness claims.
- **Corpus-wide naming:** FAFF-738 owns the remaining public documentation sweep.
- **Guide structure:** FAFF-737 owns the reader journey and section organisation.
- **Claim infrastructure:** FAFF-740 owns claim markers, reverse evidence indexes and wider validation.
- **Evidence publication:** Case studies, export controls and walkthroughs stay in their existing workstreams.
- **New validation systems:** No custom Markdown parser, Mermaid grammar, link checker, browser dependency or evidence schema.
- **System diagram:** FAFF-737 may place a maintained system diagram in the reader journey. This quick copy pass does not add a new rendering surface.

## 3. What: entry-point contract

### Naming and responsibility

The first README paragraph uses the bridge "SuperDomestique, currently shipped as `faff`". Its opening includes this sentence: "Governed autonomy reduces scheduled human attention only when named controls, evidence and failure paths earn trust for a workload."

Commissaire is the target name for the governance responsibility that checks evidence and applies deterministic gates. The README must say that this responsibility currently lives inside the `faff` repository and is not a separately shipped component or security boundary.

**Chosen:** Use SuperDomestique for the target product story, Commissaire for the target governance responsibility, and `faff` for every current technical identifier.

### README structure

The README presents, in order:

1. governed-autonomy problem and thesis;
2. current evidence and limits;
3. the L1 to L4 trust ladder;
4. installation, first use and command reference;
5. deeper documentation, naming status, credits and licence.

The README no longer opens with the dictionary-style `Faff (n.)` definition. It explains the governed-autonomy problem before installation or command detail.

### Evidence and maturity

The README links the canonical language guide and identifies the trust-claim audit as the dated 2026-08-07 status authority next to the relevant claims. It says:

- the tracker control-plane claim and safe-to-stop-watching posture are attested;
- L3 park and run-ledger closure are enforced at that boundary;
- L4 mechanisms exist, but external verification and programme closure remain incomplete, so an unqualified L4-complete claim is unsupported;
- the detailed harness matrix remains pending under FAFF-735.

The page must not claim defect-free delivery, complete L4, independent Commissaire deployment or cross-harness parity.

**Chosen:** Keep the evidence section short and link to the audit as the status authority instead of reproducing its ledger.

### Website entry point

The landing page uses SuperDomestique as the visible product name, immediately says that it is currently shipped as `faff`, and includes this sentence: "Governed autonomy reduces scheduled human attention only when named controls, evidence and failure paths earn trust for a workload." It names L3 as the current unattended centre and says L4 evidence remains incomplete. Its calls to action remain `/guide/adopting-by-change-class` and `/concept/positioning-and-language`.

The Docusaurus site title and navbar title are exactly `SuperDomestique`. The tagline is exactly `Governed autonomous delivery, currently shipped as faff.` Existing routes, repository URLs and technical identifiers remain unchanged.

**Chosen:** Keep the website short and point to canonical documents rather than duplicating the README.

## 4. How: implementation approach

1. Read the canonical guide and dated audit before editing.
2. Replace the README opening and explanatory sections as one coherent rewrite.
3. Retain accurate installation, requirements, command, credit and licence facts below the new story.
4. Synchronise the landing-page copy, metadata, calls to action, tagline and navbar label.
5. Let the normal pull-request checks validate the documentation build. Do not add unit tests that merely pin prose strings.

**Anti-pattern:** Strengthen an audit status to make the front page sound more complete. The audit remains authoritative.

**Anti-pattern:** Rename a command, package, path, URL or configuration key. Technical-identifier migration is separate work.

## 5. Scenarios

Given a technically senior reader opens the README
When they read the opening and maturity text
Then they can identify SuperDomestique, current `faff` identifiers, the Commissaire responsibility, L3's enforced park-and-ledger boundary and the incomplete L4 evidence boundary.

Given a reader opens the website landing page
When they read the opening and maturity text
Then they can identify SuperDomestique, current `faff` identifiers, the Commissaire responsibility and the incomplete L4 evidence boundary.

Given the README describes an unattended L3 run
When it explains what happens to ambiguous work
Then it says that the work is parked for a human decision rather than silently advanced.

## 6. Design decision rationale

**Which public surfaces change?** README-only would leave the published site inconsistent. A broader documentation rewrite would duplicate FAFF-737 and FAFF-738.

**Chosen:** Change `README.md`, `website/src/pages/index.js`, and brand-bearing metadata in `website/docusaurus.config.js`.

**How much validation is appropriate?** Custom parsers and copy-specific unit tests exceed the value of this documentation slice.

**Chosen:** Use the existing documentation build and normal pull-request checks.

## 7. Open questions and assumptions

There are no open questions.

**Assumes:** FAFF-732 and FAFF-733 remain the current audit and language authorities.

## 8. Done

### From Why and What

- [ ] README and website lead with governed autonomy and the target-to-current naming bridge.
- [ ] README no longer opens with the dictionary-style `Faff (n.)` definition.
- [ ] Both surfaces state the current Commissaire boundary and incomplete L4 evidence boundary.
- [ ] README links the canonical guide and dated audit next to material positioning and maturity claims.
- [ ] Installation and command details follow the product, system, evidence and maturity explanation.
- [ ] Docusaurus site title and navbar title are `SuperDomestique`; the tagline is `Governed autonomous delivery, currently shipped as faff.`; routes do not change.

### From How

- [ ] Current `faff` commands, package names, paths, URLs and configuration identifiers remain unchanged.
- [ ] The Docusaurus production build passes.
- [ ] Normal pull-request checks pass.
- [ ] No runtime source file changes and no copy-specific test machinery is added.

### Integration smoke test

1. Build the Docusaurus site through the normal pull-request checks.
2. Confirm both landing-page calls to action resolve to existing routes.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

The slice is one reader-visible documentation increment. It keeps the public entries consistent while preserving the separate harness, corpus naming, guide organisation and evidence workstreams. It changes no runtime source and relies on the repository's normal pull-request checks.

spec-review: approve

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
