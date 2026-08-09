# Harness support status and evidence map

> Spec: faffter-dark-nlspec · 2026-08-07 · autonomous · confidence: high. Full spec on Linear FAFF-735.

This specification defines the FAFF-735 documentation change for the build agent and human reviewers. It publishes one current support page for Claude Code, Codex, and planned pi.dev work, then corrects public portability wording that claims more than the evidence supports.

## 1. WHY: problem and principles

The load-bearing model is that a portable artifact, a demonstrated workflow, and a supported harness are three different claims. Faff currently records useful Codex observations and one interactive end-to-end run, while its portability prose sometimes jumps from those facts to broad interchangeability. This change gives readers one evidence-linked status page that says what works, what was merely observed, and what remains planned.

**Support follows evidence, not design intent.** A portable `SKILL.md` format or an implemented `codex exec` transport does not prove the full loop works unattended under Codex.

**Parity is row-by-row.** “Codex parity” is forbidden unless every material setup, lifecycle, dispatch, enforcement, and observability row has equivalent demonstrated support.

**Current limitations stay beside the positive claim.** A reader must not need to follow several issue links to discover that the demonstrated Codex run was interactive, uncaged, manually handed off, or unable to complete independent review normally.

**One support page, evidence kept at source.** The new guide synthesises status and links to dated observations, audits, code, and owning issues. It does not copy full transcripts or turn itself into another historical record.

### Reference context

- **`docs/architecture/harness-coupling.md`**: seam inventory and current portability dispositions, including a stale `codex --full-auto` reference.
- **`docs/architecture/codex-cli-observed.md`**: dated Codex 0.145.0 observations for permissions, event streams, auth, skill loading, and state.
- **`docs/adr/0090-engine-transport-gains-a-spawn-family-codex-extending-adr-0054-s-per-lane-transp.md`**: accepted read-only Codex engine transport boundary.
- **`docs/audits/2026-08-02-FAFF-435-l4-gate-subversion.md`**: committed result of the Codex/GPT-5.6-sol audit run.
- **FAFF-694**: completed record of the interactive Codex run from prep through merge and its limitations.
- **FAFF-665**: completed live Codex CLI and engine-path probe.
- **FAFF-613**: pending autonomous B10 Codex run; the explicit boundary on broader support claims.
- **FAFF-732 and FAFF-733**: upstream public-claim classification and canonical language inputs.

**Scope:** publish current harness support truth and correct directly conflicting public portability prose. No adapter, runtime, or harness implementation is added.

## 2. OUT OF SCOPE

- **Running the autonomous Codex B10 experiment**: FAFF-613 owns the scored P1-class run and committed result. Extension point: `docs/external-verification/**` under FAFF-613.
- **Implementing Codex build, eval, or whole-session lanes**: FAFF-479, FAFF-480, and related harness-interface work own those paths. Extension point: the engine and concurrency modules named by those issues.
- **Building a Codex cage or environment**: FAFF-662 owns operator guidance and FAFF-605 owns the environment floor. This page reports the current absence without prescribing a new container product.
- **Fixing provider policy, worktree escape, provenance, handoff, or fan-out gaps**: the status page links FAFF-697, FAFF-702, FAFF-703, FAFF-699, FAFF-700, and other current owners instead of absorbing their work.
- **Changing the canonical Faff vocabulary**: FAFF-733 owns names and positioning language. This page consumes its shipped terms.
- **Rewriting the front page**: FAFF-739 owns the positioning rewrite. FAFF-735 changes only portability claims and adds a support-status link.

## 3. WHAT: vocabulary, support page, and interfaces

### Support vocabulary

- **Supported**: a documented current path with repeatable evidence and no known missing load-bearing seam for the stated autonomy level.
- **Demonstrated with limitations**: a recorded successful path exists, but material setup, lifecycle, safety, or automation limitations remain.
- **Experimental**: a narrow implementation or observation exists, but it is not an end-user support promise.
- **Planned**: no current support claim; a real owning issue names the intended work or evidence.
- **Not supported**: no current path is offered, and no implication of present compatibility is allowed.

These support labels describe harness usability. They do not replace FAFF-732’s trust-claim statuses such as `enforced`, `attested`, and `demonstrated`; the page cites those classifications when available.

### Files

The build adds `docs/guide/harness-support.md`, the canonical current support page published automatically by the existing guide docs plugin.

The build updates:

- `README.md`, adding a concise harness-status statement and link under “Going further”.
- `docs/architecture/harness-coupling.md`, linking the current status page and correcting statements that exceed observed Codex behaviour, including the nonexistent `--full-auto` flag.
- `docs/architecture/codex-cli-observed.md`, linking forward to the current support judgement while retaining the dated observation unchanged in substance.
- `docs/guide/self-hosted-rig.md`, replacing any wording that implies a complete Codex unattended drain with the current bounded status and support-page link.

No website configuration edit is needed. `website/docusaurus.config.js` already reads `docs/guide` in place, and `website/sidebars.js` autogenerates navigation from that directory.

### Page structure

`docs/guide/harness-support.md` contains these sections in order:

1. Current headline: Claude Code is the primary supported harness; Codex is demonstrated interactively with limitations and experimental for selected engine calls; pi.dev is planned, not supported.
2. Evidence rules and the support vocabulary.
3. Capability matrix comparing setup, skill discovery, tracker access, interactive prep, interactive build and merge, producer dispatch, independent review, parallel fan-out, L3 unattended entry, L4 isolation and holdout, telemetry, and live streaming.
4. Setup and lifecycle differences.
5. Known Codex limitations with real issue owners.
6. Evidence index with dated repository artifacts, merged PRs where relevant, and tracker records.
7. Re-evaluation rules describing what evidence permits a support label to move.

### Required capability conclusions

The matrix must preserve these evidence-bounded conclusions at build time unless newer shipped evidence explicitly supersedes them:

- **Claude Code**: primary supported harness for the documented L1-L4 entry paths, subject to each level’s existing environment and preview caveats.
- **Codex skill loading**: demonstrated by FAFF-665, with global install improvements from FAFF-672 and FAFF-676; repo-local and marketplace visibility remain limited by FAFF-674 and FAFF-685.
- **Codex interactive prep through merge**: demonstrated with limitations by FAFF-694 and PR #510, not proof of unattended parity.
- **Codex read-only producer dispatch**: experimental and demonstrated through `faff engine call` plus `codex exec`; it is not a write-capable build lane.
- **Codex tracker discovery**: the original deferred-tool failure was fixed by FAFF-695, while connector setup remains harness-specific.
- **Codex review and fan-out**: no parity claim while FAFF-700, FAFF-706, or their current successors remain open.
- **Codex unattended L3 and isolated L4**: planned, not supported, until the whole-session, environment, and B10 evidence owners ship.
- **pi.dev**: planned, not supported. No implementation or verification work is currently scheduled, and the page must say so plainly.

### Evidence requirements

Every `Supported`, `Demonstrated with limitations`, or `Experimental` matrix cell links at least one direct artifact:

- a dated committed observation or audit;
- an enforcing code or contract path for a mechanism claim;
- a merged PR plus its owning completed issue for a delivery claim; or
- a committed run result.

Every `Planned` or `Not supported` cell links a real owning issue or explicitly states that no implementation is intended. A ticket alone never upgrades a row to demonstrated or supported.

## 4. HOW: publication and correction behaviour

### Evidence reconciliation

```text
PROCEDURE publish_harness_status:
  1. Confirm FAFF-732 and FAFF-733 have shipped and read their canonical outputs.
  2. Read the current status and latest significant evidence for every issue cited by the matrix.
  3. Read the dated Codex observation, coupling inventory, engine transport, and FAFF-435 audit record.
  4. For each capability row and harness:
     a. Identify the narrowest capability actually evidenced.
     b. Assign one support label.
     c. Link the direct evidence and any open limitation owner.
     d. State version or date when the evidence is a snapshot rather than a contract.
  5. Record pi.dev as unscheduled planned work; do not create a ticket merely to satisfy this documentation page.
  6. Render the support page, then correct conflicting public wording in the named files.
  7. Inspect the evidence links, run the existing documentation checks, and build the website.
```

Do not count this FAFF-735 documentation build itself as evidence of Codex parity. The run may be mentioned only if a durable outcome record exists independently of the prose being authored.

### Correction rules

- Replace `codex --full-auto` with the observed separate approval and sandbox axes from `docs/architecture/codex-cli-observed.md`.
- Replace broad “any harness” or “swap your harness” claims with the narrower artifact-level or demonstrated-path claim they can support.
- Keep the distinction between the Agent Skills artifact being portable and its installation, invocation, lifecycle, and enforcement integrations being harness-specific.
- Preserve historical observations and accepted decisions. Add current-status links or caveats rather than rewriting dated records to look prescient.
- Use exact version/date language for Codex CLI observations, because CLI flags and event shapes can change.

### Integration smoke test

```text
GIVEN the new harness support page and corrected public references
WHEN a reader follows the Codex interactive-prep row and the Codex unattended-L3 row
THEN the first reaches dated evidence plus current limitations,
     while the second says planned and links its evidence owner rather than implying parity
```

### Failure modes

- **A completed issue is mistaken for proof.** How to notice: a positive support cell links only Linear and no run, merged change, code path, or committed observation. What it means: downgrade the label or add direct evidence.
- **The matrix freezes a moving CLI as timeless truth.** How to notice: Codex flags are described without version and observation date. What it means: restore the snapshot qualifier and link the observed page.
- **The page becomes a second coupling inventory.** How to notice: seam design rationale is copied rather than linked. What it means: keep the current user-facing status here and the architectural disposition in `harness-coupling.md`.
- **Blocked inputs change before build.** How to notice: FAFF-732’s classification or FAFF-733’s canonical terms differ from this draft. What it means: use their shipped outputs as authority, adjust wording without widening the support claims, and rerun review.

**Anti-pattern:** label Codex “supported” because this repository is currently being read by Codex. Why: one interactive session does not prove installation, lifecycle, containment, autonomous entry, review, or evidence persistence.

**Anti-pattern:** present pi.dev in a future-looking feature list without “planned” beside it. Why: adjacency to supported harnesses is itself an implied support claim.

## 5. SCENARIOS

```text
Given a reader wants to run faff under Codex
When they open the harness support page
Then they can distinguish the demonstrated interactive path, the experimental read-only producer path,
     and the unsupported autonomous paths without consulting issue history first
```

```text
Given a capability has an implementation ticket but no successful run or committed observation
When the support matrix is rendered
Then the capability is labelled planned or not supported, never demonstrated or supported
```

## 6. DESIGN DECISION RATIONALE

**Where should current harness status live?** Extending the architecture inventory would mix design dispositions with end-user support promises. A guide page is published automatically by the current website and can link back to architectural evidence without duplicating it.

**Chosen:** make `docs/guide/harness-support.md` the canonical current support page and keep `docs/architecture/harness-coupling.md` as the seam-design inventory.

**How should support be expressed?** One binary supported/unsupported flag hides the difference between a successful interactive run, a narrow engine transport, and an unattended product path. A five-label vocabulary preserves those boundaries while staying readable.

**Chosen:** use `Supported`, `Demonstrated with limitations`, `Experimental`, `Planned`, and `Not supported`, with evidence rules for each.

**Can Codex parity be claimed?** FAFF-694 proves a meaningful interactive path, while FAFF-613 is still pending and several lifecycle, isolation, fan-out, and provenance gaps remain open. Calling that parity would erase the strongest evidence in the same record.

**Chosen:** state that Codex is demonstrated interactively with limitations and experimental for selected producer calls; make no full-harness or unattended parity claim.

**How should dated observations be maintained?** Rewriting the Codex observation each time support changes would corrupt the record. Linking it forward to a current status page preserves both historical evidence and a maintainable present-tense answer.

**Chosen:** retain dated observation and audit documents in substance, adding current-status links or scoped corrections only where their public claims conflict.

**Does the website need custom navigation work?** The guide plugin reads `docs/guide` directly and uses an autogenerated sidebar. A configuration edit would add maintenance without changing discoverability.

**Chosen:** rely on the existing guide publication path and add only the README support link.

**Who owns pi.dev support?** FAFF-483 is a general interface foundation, not a pi.dev implementation or proof. Reusing it would hide an unplanned support commitment.

**Chosen:** state that pi.dev is planned but not supported, and that no implementation or verification work is currently scheduled. Do not create a placeholder ticket for the documentation.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

No design question remains in FAFF-735. Unscheduled product work is identified as such rather than given a placeholder owner.

**Assumes:** FAFF-732 ships its authoritative public-claim audit before FAFF-735 builds. Validate: confirm FAFF-732 is Done and read the committed or tracker-authoritative audit before assigning support language.

**Assumes:** FAFF-733 ships the canonical Faff language guide before FAFF-735 builds. Validate: confirm FAFF-733 is Done and apply its preferred terms without changing package, command, repository, configuration, or URL identifiers.

## 8. DONE: definition of done

### From WHY and scope

- [ ] One canonical guide page plainly distinguishes portable artifacts, demonstrated workflows, and supported harnesses.
- [ ] Claude Code, Codex, and pi.dev each have an evidence-bounded current headline with no parity implication beyond the matrix rows.
- [ ] No adapter, runtime, cage, or new portability implementation lands in this change.

### From WHAT

- [ ] `docs/guide/harness-support.md` contains the required headline, vocabulary, capability matrix, setup and lifecycle differences, known limitations, evidence index, and re-evaluation rules.
- [ ] Every positive support cell links direct evidence, and every planned or unsupported gap links a real owner or states that no implementation is intended.
- [ ] Codex interactive prep-through-merge is recorded as demonstrated with limitations, with FAFF-694 and the committed FAFF-435 audit as evidence.
- [ ] The Codex engine transport is described as an experimental read-only producer path, not a build lane.
- [ ] Autonomous Codex L3/L4 support remains planned until FAFF-613 and the relevant lifecycle and environment owners ship evidence.
- [ ] pi.dev is labelled planned and not currently supported, with no suggestion that implementation is under way.

### From HOW and corrections

- [ ] `docs/architecture/harness-coupling.md` links the support page and no longer claims Codex has a `--full-auto` flag.
- [ ] `docs/architecture/codex-cli-observed.md` links forward to current support while retaining its dated observed facts.
- [ ] `docs/guide/self-hosted-rig.md` does not imply a complete Codex unattended path and links the support page where it mentions harness swapping.
- [ ] `README.md` links the harness support page and gives the bounded Claude-primary, Codex-limited, pi-planned summary.
- [ ] Historical audit and decision records remain historical rather than being silently rewritten.

### From verification

- [ ] Evidence and owner links are checked by inspection; no test is added for literal prose.
- [ ] `npm --prefix website run build` succeeds and publishes the new guide page through existing autogenerated navigation.
- [ ] No file under `website/build`, `website/.docusaurus`, or `website/node_modules` is committed or edited.

## Producer self-review

- **Codebase fit:** the guide plugin already publishes `docs/guide` and autogenerates its sidebar, so the proposed page needs no navigation mechanism. Resolution: removed a website-config edit from the scope.
- **Evidence fit:** FAFF-665 proves the live CLI and producer transport; FAFF-694 proves one interactive prep-to-merge run; FAFF-613 explicitly withholds broader Codex support until an autonomous run passes. Resolution: split Codex into demonstrated-interactive, experimental-producer, and planned-autonomous rows.
- **Claim accuracy:** `harness-coupling.md` still names `codex --full-auto`, contradicted by the observed page. Resolution: made that correction a required DONE item and regression assertion.
- **Dependency check:** FAFF-732 and FAFF-733 are real incoming blockers and currently parked. Resolution: retained them as build-time assumptions with validation instructions rather than inventing their outputs or parking spec production.
- **Scope check:** current limitation owners remain separate work. Resolution: the page links them and this ticket changes documentation only.
- **Review findings:** no blocker or major producer-review finding remained. The lack of scheduled pi.dev work is stated directly instead of being assigned inaccurately to FAFF-483.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized and cohesive:** the support page and direct claim corrections are one documentation slice. Splitting the corrections from the page would leave contradictory public claims live.
- **Workstream fit:** FAFF-735 delivers exactly the project outcome: demonstrated support, meaningful differences, and planned work stated plainly. It does not absorb runtime portability implementation.
- **Dependencies:** FAFF-732 supplies claim status and FAFF-733 supplies canonical language. Both blockers are load-bearing for the final wording, but neither prevents the support-page structure from being fully specified now.
- **Risk:** the evidence comes from several kinds of record and is easy to overstate. Row-level labels, direct links, dated observations, inspection, and the existing documentation build bound the claims without tests for wording.

## Build clarification

The user's 2026-08-09 direction supersedes the original proposal to add a unit test for documentation wording. This build uses inspection and the existing documentation checks. It does not create a pi.dev ticket merely to give planned work an owner.

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"}]}
```
