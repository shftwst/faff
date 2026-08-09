# FAFF-323 — Frontier whole-system coherence audit

> Spec: faffter-dark-nlspec · 2026-07-04 · interactive · confidence: high. Full spec on Linear FAFF-323.

This spec defines the frontier whole-system coherence audit of the faff suite: a single frontier reasoner reads the entire system — gateway, 28 sub-skill prompts, the CLI contract surface, 41 ADRs, and the live tracker — in one sustained context and produces an evidence-anchored findings document plus follow-on tickets. Audience: the build agent executing the audit, and human reviewers of the findings. *(Revised 2026-07-04 — supersedes the 2026-07-03 spec comment: re-authored by the frontier reasoner itself after a full-system exploration, per the ticket's "Fable does the read directly" requirement; same overall shape, sharper coverage inventory and DONE.)*

## 1. WHY — Problem and principles

**The load-bearing model: faff's correctness rests on prose↔mechanism agreement.** faff is a prose-orchestrated system with deterministic contract anchors — skills are markdown prompts that *claim* what CLI gates enforce, refer back to a gateway that *claims* to be the single home of shared rules, and embody ADRs that *claim* to be implemented. Every load-bearing claim that has silently drifted from its mechanism is a latent defect that only a whole-system read can see, because each PR reviews one seam at a time and nothing reviews the seams between the seams.

The system has grown across ~260 PRs. A preliminary sweep during exploration already surfaced confirmed drift of exactly this class (a slot whose fixed contract is referenced by two occupants but absent from the gateway; a hook whose prose says "block" where the CLI now warns; a lens instructing tags the label manifest rejects). The value is time-sensitive to the Fable window but the output — findings + tickets — is durable.

**Design principles:**

- **Evidence or it didn't happen.** Every finding cites the two disagreeing artifacts (file:line, `--selftest` output, or live tracker state). An uncited finding is inadmissible in the output doc.
- **Deterministic verification over impression.** Where a claim can be checked mechanically (a CLI exit code, a selftest table, a grep, a manifest), the finding records that check as its evidence — same tenet as faff's own deterministic-tools-over-prose.
- **Frontier-differentiated, single context.** The read is done by one frontier reasoner holding the whole system; no delegation of the coherence reasoning to sub-contexts (the cross-file connections *are* the deliverable).

**Reference context:**

| Surface | Size | Relevance |
|---|---|---|
| `plugin/skills/*/SKILL.md` (29 files) | 6,299 lines | The prose system: gateway (1,015) + 28 sub-skills/slots |
| `plugin/skills/faff/bin/faff` | 12,116 lines | The deterministic CLI: ~40 subcommands, contract scripts, selftests |
| `plugin/skills/faff/contracts/*.schema.json` | 14 schemas | The contract-as-code surface |
| `records/adr/` | 41 ADRs | The decision log axis 4 reads against |
| Linear team Faff (open issues) | live | Axis 3's deps-in-prose surface |

**Scope statement:** this is the *broad* coherence read (FAFF-323); the *targeted* adversarial gate-break of trust-critical gates is its sibling FAFF-316 and is out of scope here.

## 2. OUT OF SCOPE

- **Fixing the drift** — every remediation lands as a proposed follow-on ticket, not a change in this PR. Extension point: the tickets this audit files via the discovered-scope path.
- **Adversarial gate-breaking** (trying to defeat `admissible`/`sentry`/`holdout`/`contain` with crafted inputs) — FAFF-316's remit. This audit *notes* a suspected gate weakness as a finding and defers the break-attempt. Extension point: FAFF-316.
- **A correctness proof of the CLI** — no execution harness over all ~40 subcommands; verification is targeted probes (`--selftest`, exit-code calibration, greps) where a finding needs them.
- **Historical tracker archaeology** — axis 3 reads the currently-open backlog only (Ignore-cancelled rule); no reconstruction of closed/cancelled issues' edges.
- **Eval-suite / skill-judgement quality** — how *well* the prompts judge is the eval lanes' remit (separate workstream); this audit checks *coherence*, not judgement quality.

## 3. WHAT — The four drift axes and their coverage inventory

**Vocabulary:** *drift* = a load-bearing disagreement between two artifacts that claim to describe the same rule/mechanism; *finding* = one drift instance with citations, severity, and a proposed fix or ticket; *coverage statement* = the per-axis enumeration of what was read, so absence-of-finding is meaningful.

- **Axis 1 — Gateway ↔ sub-skill prose drift.** All 28 sub-skill SKILL.mds read against the full gateway. Targets: contradiction of a shared rule, silent duplication instead of refer-back, refer-backs to gateway sections that don't exist, gateway omissions of machinery the sub-skills rely on (e.g. slot-table completeness), stale cross-skill recaps (caps, enums, glob/layout formats).
- **Axis 2 — Slot contract ↔ implementation.** For the contract surface: the 14 `faff contract` dispatcher names, the 14 JSON schemas, the 13 `faff-contract:` block types named in prose, and the 3 CLI-emitted descriptor blocks — cross-referenced producer → block → schema → consumer → prose. Targets: documented-but-not-consumed, emitted-but-not-documented, consumed-but-never-produced, prose describing superseded CLI semantics (verified against `--selftest` tables and the CLI source).
- **Axis 3 — Dependency edges ↔ prose.** The open, automation-relevant Faff-team backlog: issues whose description/spec prose records an ordering/dependency with no `blockedBy` edge (the recurring deps-in-prose hazard), and edges with no discoverable rationale. Bounded: open issues only, sampled exhaustively over the automation-labelled set.
- **Axis 4 — ADRs ↔ code.** All 41 ADRs swept for status/embodiment coherence, with depth on the L4 governance set (0007/0008 liveness, 0010 blast-radius, 0020 admissibility, 0022–0024 PRDR gates, 0025–0028 spec-review, 0030–0034 architecture/env/holdout/sentry, 0036 lights-out, 0037 appetite-scoping, 0039 sentry-2, 0040 grounding, 0041 multi-cage). Targets: an ADR whose machinery shipped while its status says Proposed (or vice versa), gateway/skill prose that predates an accepted ADR, ADR-decided mechanisms with no implementation anchor.

**Design decisions:**

The audit's output artifact and filing mechanics involve four decisions, each closed below (rationale collected in section 6):

**Chosen:** read-only audit; sole repo artifact is the findings document; all remediation deferred to follow-on tickets.

**Chosen:** findings doc lands at `verification/audits/2026-07-04-faff-323-whole-system-coherence.md` (the `verification/audits/` directory already exists and holds the FAFF-114 audit precedent).

**Chosen:** every finding carries the two citations + severity (`defect` / `drift` / `observation`) + a proposed fix or ticket; findings without citations are cut.

**Chosen:** follow-on tickets are proposed in the doc's machine-locatable `## Proposed follow-on tickets` section and recorded to `discovered-scope.json`; the orchestrator lane files them (containment-checked, appetite-gated, deduped) — the audit build never writes the tracker.

**Assumes:** the Linear MCP is available for the axis-3 read (it is — the session's configured tracker).

**Assumes:** FAFF-316 exists as the home for gate-break follow-ons, so a suspected gate weakness found here routes there rather than spawning a duplicate ticket.

## 4. HOW — Behaviour

The audit proceeds in four passes over an already-loaded whole-system context (the reader holds gateway + all sub-skills + CLI help/selftest surface in one context throughout — that persistence is the method):

```
PROCEDURE whole_system_audit:
  1. Axis-1 pass: for each sub-skill S, diff S's claims against the gateway's
     shared rules; for each gateway shared rule, check the sub-skills that
     consume it honour it; record drift with file:line pairs.
  2. Axis-2 pass: build the contract cross-reference table
     (producer skill → faff-contract block → schema file → faff contract name →
      consumer skill); probe disputed semantics with --selftest / exit-code
     calibration / CLI-source greps; record skew.
  3. Axis-3 pass: fetch open Faff-team issues via the tracker MCP; for each
     automation-relevant issue, scan description+spec prose for dependency
     language; cross-reference against its live blockedBy edges; record
     prose-only deps and rationale-less edges.
  4. Axis-4 pass: read each ADR's Status + Decision; locate its implementation
     anchor (CLI subcommand, gateway section, skill step); record
     status/embodiment mismatches.
  5. Consolidate: dedupe overlapping findings across axes, assign severity,
     write the findings doc + discovered-scope.json; run faff lint-refs +
     faff lint-cli-doc; commit on the feature branch; PR.
```

**Edge cases / error handling:**

- A finding that dissolves under verification (the probe contradicts the impression) is recorded in a short "checked-and-clear" appendix line, not silently dropped — negative results are part of coverage honesty.
- Tracker MCP unavailable mid-axis-3 → the axis is reported as partially covered with the exact cut-off named; never silently thinner coverage.
- A drift where *which side is right* is genuinely ambiguous → the finding names both candidate resolutions and the ticket proposal asks for the human call; the audit never unilaterally declares the winner in prose-vs-prose ties.

**Failure modes:**

- **The failure:** the audit degenerates into a lint pass (surface nitpicks) and misses structural drift. **How you'd know:** findings skew `observation`-severity with no `defect`/`drift` entries touching load-bearing gates. **What it means:** narrow — re-read the trust-critical seams (merge floor, eligibility, ledger) specifically.
- **The failure:** false findings from reading stale context rather than live state. **How you'd know:** a cited line number/selftest doesn't reproduce. **What it means:** every finding's citation is re-checked against disk/CLI at doc-writing time; a non-reproducing finding is cut or moved to checked-and-clear.

## Scenarios

```
Given the full faff prose+contract+ADR surface and the live tracker
When the four-axis audit pass completes
Then verification/audits/2026-07-04-faff-323-whole-system-coherence.md exists on the
     feature branch, states per-axis coverage, and every finding in it carries
     two artifact citations, a severity, and a fix-or-ticket
```

```
Given the completed findings document
When the orchestrator reads .faff/runs/<run-id>/FAFF-323/discovered-scope.json
Then every actionable finding has a corresponding concrete entry
     (title + surface + axis + relationship to FAFF-323), and vague items are
     marked kind:"vague" (surfaced, never filed)
```

Assertion: the change is docs-only — `git diff` touches only `docs/` (+ the spec) — and `faff lint-refs` and `faff lint-cli-doc` exit 0.

## 6. DESIGN DECISION RATIONALE

- **Why read-only + tickets, not fix-in-place?** An N-finding audit fused with N fixes is unreviewable, couples unrelated changes, and the ticket's own deliverable is "findings list + follow-on tickets"; beep-boop's execution-discovered-scope path is the sanctioned create mechanism. **Chosen:** read-only, tickets deferred.
- **Why `verification/audits/`?** Audit precedent exists there (FAFF-114 doc); `docs/` outside `docs/guide/` is allow-by-default for FAFF-NN/ADR refs (`faff lint-refs` slice-1 scope is `docs/guide/**` only), and it is neither guide prose nor a spec. **Chosen:** `verification/audits/`.
- **Why per-finding citations + severity?** Unfalsifiable findings are noise; the severity split (defect = behaviour diverges from a load-bearing claim now / drift = claims disagree, behaviour TBD / observation = worth-confirming asymmetry) lets the reader triage. **Chosen:** cited + severity-tagged.
- **Why orchestrator-filed tickets?** The implementor lane records, never writes the tracker (Agent Lanes); routing proposals through discovered-scope keeps containment/dedup/appetite gates intact. **Chosen:** record-and-file.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — all four decisions closed above.

**Assumptions:**
- **Assumes:** Linear MCP available for axis 3 — validate at pass start by fetching the open-issue list; on failure, report partial coverage per the edge-case rule.
- **Assumes:** FAFF-316 open as the gate-break home — validate by fetching it; if cancelled, gate-weakness follow-ons file as ordinary proposals instead.

## 8. DONE — Definition of Done

### From WHY
- [ ] The findings doc opens with the load-bearing model (prose↔mechanism agreement) and the audit's method, so a reader can judge coverage claims.

### From WHAT (the four axes)
- [ ] Per-axis coverage statement present: axis 1 names all 28 sub-skills read; axis 2 tabulates the full contract cross-reference (14 dispatcher names × schemas × block types × producers × consumers); axis 3 states the issue set scanned; axis 4 lists all 41 ADRs with the depth tier applied to each.
- [ ] Every finding has: (a) two artifact citations (file:line / selftest / tracker state), (b) the specific drift, (c) severity ∈ {defect, drift, observation}, (d) a proposed fix or follow-on ticket. Zero uncited findings.
- [ ] Checked-and-clear appendix lists probed-and-dissolved candidates (negative results preserved).

### From HOW (mechanics)
- [ ] `## Proposed follow-on tickets` section is machine-locatable, one entry per actionable finding (title + one-line scope + originating axis), mirrored to `.faff/runs/<run-id>/FAFF-323/discovered-scope.json` with `kind: concrete|vague`.
- [ ] Doc committed at `verification/audits/2026-07-04-faff-323-whole-system-coherence.md` on branch `faff-323-frontier-whole-system-coherence-audit`, shipping in the PR with the spec.
- [ ] Docs-only diff; `faff lint-refs` exit 0; `faff lint-cli-doc` exit 0.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
