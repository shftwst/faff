# Spec — FAFF-504: Commit the faff-lab PRD as the canonical setpoint + record the tracker-vs-git-only decision

> Spec: faffter-dark-nlspec · 2026-07-14 · interactive · confidence: high. Full spec on Linear FAFF-504.

This spec is for the build agent implementing FAFF-504 and for the human reviewers gating it. It defines two docs-only deliverables — committing the faff-lab PRD to a canonical in-repo location, and recording the tracker-vs-git-only decision as an ADR — and pins the real CLI admission flow that FAFF-505's runbook will depend on.

## 1. WHY — Problem and Principles

**The load-bearing idea:** faff-lab is the sixth external-verification rung, and unlike the throwaway P1–P5 SUTs it is a *long-lived real deliverable*. That single difference drives every decision here: a throwaway SUT can carry its brief as a heredoc inside a scaffold script, but a long-lived deliverable needs its human setpoint (the PRD) to live as a real, version-controlled, diff-able document that the scaffold *copies from* rather than *contains*. FAFF-504 establishes that document and records the one open policy decision (Linear tracker vs git-only) so FAFF-505 can scaffold against settled ground.

**Problem statement:** The faff-lab PRD — the immutable human setpoint for a public, faff-built gallery site — exists only as prose in the ticket and is committed nowhere in-repo, and the tracker-vs-git-only question for the first faff-lab run is unresolved. Until both are fixed and the *real* admission flow is recorded, FAFF-505 (`scaffold-faff-lab.sh`) cannot be built against a stable, correct base. This change commits the PRD verbatim to a canonical path, records the tracking decision as an ADR, and writes down the real CLI admission flow.

**Design principles:**

**The PRD is the human setpoint — commit it verbatim, never let a run edit it.** The build agent transcribes the PRD text as given and does not paraphrase, restructure, "improve", or annotate it. Any implementation that mutates PRD content is wrong even if the result reads better.

**Name only real CLI commands.** The ticket's P2-derived runbook cites `faff prd new --from` and `faff prd admit`, which do not exist. Every command named in a FAFF-504 deliverable must be a real one (verifiable against `bin/lib/prd.js`, `bin/lib/prdr.js`, `bin/lib/contract-defs.js`). This is a hard reject condition, not a nicety — FAFF-505's runbook inherits whatever we write.

**Singly-sourced PRD.** The PRD text has exactly one home (the canonical doc). The FAFF-505 scaffold will `cp` from it; the PRD is never duplicated into a heredoc, keeping it un-shell-escaped and drift-free.

**Reference context:**

| System | Kind | Relevance |
|---|---|---|
| `verification/external-verification/README.md` | Markdown | Frames the SUT as a separate subject repo; establishes that P1–P5 keep the PRD *out* of the faff repo |
| `verification/external-verification/scaffold-p2-task-api.sh` | Bash | Heredocs its brief into the SUT; documents the git-only→tracker upgrade path; cites the non-existent `faff prd` commands |
| `records/adr/` (0001–0066, next 0067) | Markdown | 66 Nygard-style ADRs; the format and next-number this ticket's ADR follows |
| `.faffrc.example.yaml` | YAML | `tracking.*` keys (tracker/team_key/project_id/repo/git_host/spec_docs_path) — the minimal Linear-binding block for the upgrade path |
| `bin/lib/prd.js` | JS | Real `faff prd` subcommands: `path \| new \| link \| list \| validate` — `new` writes a fresh template, does NOT ingest an existing file |
| `bin/lib/prdr.js` | JS | Real PRDR admission: `faff prdr new … / admit …` |
| `bin/lib/contract-defs.js` | JS | The `faff contract prd-readiness` deterministic validator behind the L4 run-start gate |

**Scope statement:** FAFF-504 is the docs/decision prerequisite that unblocks FAFF-505; it sits at the front of the faff-lab external-verification rung and produces only documents.

## 2. OUT OF SCOPE

- **`scaffold-faff-lab.sh`** — the scaffold script itself.
  - **Why excluded:** that is FAFF-505, the ticket this one unblocks.
  - **Extension point:** `verification/external-verification/scaffold-faff-lab.sh` (new file, FAFF-505), which will `cp` the PRD from the canonical doc this ticket creates.

- **Building the faff-lab site** — any HTML/CSS/site code, fixtures, deploy wiring.
  - **Why excluded:** the site is the *output* of running faff against the PRD, downstream of both this ticket and FAFF-505.
  - **Extension point:** the faff-lab SUT repo itself, produced by an L4 run once FAFF-505 scaffolds it.

- **Provisioning a Linear container for faff-lab** — creating the team/project, adding a `tracking:` block, dropping `automation_default`.
  - **Why excluded:** this ticket *decides* git-only-first and *records* the upgrade path; it does not execute the upgrade.
  - **Extension point:** a follow-up ticket that adds the `tracking:` block to the faff-lab config per ADR 0070's documented path, once the loop is proven in anger.

- **Fixing the P2 scaffold's wrong runbook** — correcting `scaffold-p2-task-api.sh`'s citations of `faff prd new --from` / `faff prd admit`.
  - **Why excluded:** it is a discovered adjacent defect in a different file; correcting it here would scope-creep FAFF-504. Filed as FAFF-507.
  - **Extension point:** FAFF-507, against `verification/external-verification/scaffold-p2-task-api.sh`.

- **CLI or slot-skill code changes** — no changes to `faff prd`, `faff prdr`, `faff contract`, `faff adr`, or any producer.
  - **Why excluded:** the real commands already exist and suffice; this ticket is docs-only.
  - **Extension point:** none needed.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| faff-lab | The long-lived, faff-built public gallery site comparing raw one-shot model runs vs faff L4 runs, per task-category tab |
| PRD (here) | The immutable human setpoint document describing faff-lab; committed verbatim, never run-edited |
| Canonical PRD doc | The single in-repo home for the PRD text: `verification/external-verification/faff-lab/PRD.md` |
| git-only-first | Running the first faff-lab loop with no Linear provisioning — PRD/PRDR + prd-readiness gates exercised against git alone |
| Upgrade path | The documented, later move to a dedicated Linear container (add `tracking:` block, drop `automation_default`) |
| prd-readiness gate | The L4 run-start admission: the `faffter-noon-prd` slot emits a `faff-contract:prd-readiness` block, piped to `faff contract prd-readiness` (deterministic validator) |

**Deliverable artifacts (the "shapes" this ticket produces):**

```
FILE verification/external-verification/faff-lab/PRD.md      # NEW
  - contains the faff-lab PRD text VERBATIM
  - human-editable markdown; the immutable setpoint
  - single source; FAFF-505 scaffold copies from it
  CONSTRAINT: content == ticket PRD text, transcribed unaltered
  CONSTRAINT: does NOT name `faff prd new --from` or `faff prd admit`

FILE records/adr/0070-faff-lab-tracker-vs-git-only.md   # NEW
  - Nygard format: title / metadata / Context / Decision / Consequences
  - Status: Accepted   Ticket: FAFF-504
  - records: git-only-first + the documented upgrade path
  CONSTRAINT: filename == 4-digit next number (0067), kebab title
  CONSTRAINT: Decision section uses "Chosen:" + Options considered

RUNBOOK-PROSE (in PRD.md or a sibling doc it references)
  - the REAL admission flow FAFF-505 depends on
  CONSTRAINT: names only real CLI commands
```

**Design decisions:** see §6 for the full rationale; the three closed decisions are carried by canonical markers there.

## 4. HOW — Behavior

**Approach:** Three sequential, mechanical steps: (1) write the canonical PRD doc; (2) write ADR 0070; (3) record the real admission flow. No code, no build. The only non-trivial judgement is *fidelity* (verbatim PRD, real commands only), which the DONE checklist makes grep-checkable.

**Where the PRD lives — and why not the obvious alternatives.**

The candidate path is `verification/external-verification/faff-lab/PRD.md`: colocated with the suite it belongs to, so FAFF-505's scaffold sits beside it.

- **Anti-pattern:** putting it in faff's own `docs/prd/`. Why: that directory is container-slug-keyed for faff's *own product* PRDs per ADR 0016; faff-lab is a verification subject, not a faff product PRD.
- **Anti-pattern:** heredocing the PRD into the FAFF-505 scaffold (the P1–P5 pattern). Why: faff-lab is long-lived, so its setpoint must be a real diff-able doc; a heredoc shell-escapes the text and forks the source of truth.

**Recording the real admission flow.** The P2 runbook is fiction. Record the actual two-layer flow so FAFF-505 inherits truth:

```
PROCEDURE record_real_admission_flow():
  # Layer 1 — PRD-readiness (the L4 run-start gate, beep-boop §0a)
  1. The `faffter-noon-prd` slot skill reads ONLY the PRD document
  2. It emits one `faff-contract:prd-readiness` block
  3. That block is piped to `faff contract prd-readiness`
     (deterministic validator in bin/lib/contract-defs.js) -> admit | refuse

  # Layer 2 — PRDR-level admission (separate from prd-readiness)
  4. `faff prdr new <title> --container <slug> --prd-goal <g> --provenance human|loop`
  5. `faff prdr admit <prdr> --actor loop|human …`

  # Real `faff prd` subcommands are: path | new <container> | link | list | validate
  #   - `faff prd new` writes a FRESH TEMPLATE to docs/prd/<slug>.md
  #   - it does NOT ingest an existing PRD file
  # NON-EXISTENT (never name these): `faff prd new --from`, `faff prd admit`
```

**ADR 0070 shape.** Follow the house Nygard format exactly (as in the 66 existing ADRs):

```
PROCEDURE write_adr_0067():
  1. Header:   "# ADR 0070 — faff-lab: tracker vs git-only for the first run"
  2. Metadata: Status: Accepted | Date: 2026-07-14 | Ticket: FAFF-504 | Supersedes: —
  3. ## Context:
     - faff-lab is the 6th external-verification rung, a long-lived deliverable
     - the active priority is closing the L4 loop ASAP
     - binding a Linear container needs tracker+team_key+project_id+repo provisioning
  4. ## Decision:
     - "Chosen: git-only-first" + Options considered (git-only vs dedicated Linear container)
     - document the upgrade path: add `tracking:` block (project_id/team_key),
       drop automation_default, let the tracker own eligibility labels
  5. ## Consequences:
     - first loop exercises full PRD/PRDR + prd-readiness gates, zero Linear setup
     - trade: no tracker-driven eligibility labels until the upgrade
     - upgrade is a proven, documented follow-up once the loop runs in anger
  CONSTRAINT: may be authored by hand, via `faff adr new --title …`,
              or via the `faffter-noon-adr` producer — all equivalent
```

**Failure modes.** Above the complexity bar because the whole value of this ticket rests on fidelity, not on code:

- **The failure:** the PRD is silently paraphrased/reformatted during transcription, so the "immutable setpoint" is already drifted from the human intent on day one.
  - **How you'd know:** a diff of `PRD.md` against the ticket PRD text shows non-whitespace deltas.
  - **What it means:** reject and re-transcribe verbatim.
- **The failure:** the recorded admission flow reintroduces `faff prd new --from` / `faff prd admit` (they're "obvious" and the P2 doc models them), so FAFF-505 is built against fiction again.
  - **How you'd know:** `grep -RnE 'faff prd (new --from|admit)' verification/external-verification/faff-lab/` returns matches.
  - **What it means:** reject; strip to real commands.

**Anti-pattern:** treating the PRD's content decisions (site behaviour, dark/light mode, deploy targets) as things *this ticket* resolves. Why: those are the human setpoint, transcribed as-is; FAFF-504 decides only *where the PRD lives* and *how faff-lab is tracked*.

## 5. Scenarios — born-verifiable main objectives

```
Given the FAFF-504 change is applied
When verification/external-verification/faff-lab/PRD.md is diffed against the ticket's PRD text
Then the content matches verbatim (whitespace-only differences permitted)
```

```
Given ADR 0070 is committed
When a reader opens records/adr/0070-faff-lab-tracker-vs-git-only.md
Then it is valid Nygard format (Context / Decision / Consequences), Status: Accepted,
  Ticket: FAFF-504, and its Decision records git-only-first plus the tracking-block upgrade path
```

```
Given the FAFF-504 deliverable docs are committed        [holdout]
When `grep -RnE 'faff prd (new --from|admit)' verification/external-verification/faff-lab/` is run
Then it returns zero matches
And the recorded admission flow names `faff contract prd-readiness` and `faff prdr new/admit`
```

## 6. DESIGN DECISION RATIONALE

**Where does the canonical faff-lab PRD live?**
- *Options:* (a) `verification/external-verification/faff-lab/PRD.md` — colocated real doc; (b) faff's own `docs/prd/<slug>.md`; (c) a heredoc inside the FAFF-505 scaffold (P1–P5 pattern).
- *(b)* miscategorises faff-lab as a faff product PRD (that dir is slug-keyed per ADR 0016). *(c)* shell-escapes the text and forks the source of truth, wrong for a long-lived deliverable.
- **Chosen:** `verification/external-verification/faff-lab/PRD.md` — a real, human-editable, diff-able doc colocated with the suite; the FAFF-505 scaffold copies from it, keeping the PRD singly-sourced and un-escaped. (decides: architecture)

**Tracker vs git-only for the first faff-lab run?**
- *Options:* (a) git-only-first, upgrade path documented; (b) provision a dedicated Linear container up front (tracker+team_key+project_id+repo).
- *(b)* front-loads Linear provisioning before the loop is proven, delaying the active priority.
- **Chosen:** git-only-first — it exercises the full PRD/PRDR + prd-readiness gates with zero Linear setup; the upgrade (add `tracking:` block, drop `automation_default`, let the tracker own eligibility labels) is a proven, documented follow-up. Recorded as ADR 0070. (decides: product)

**Which admission flow do we record?**
- *Options:* (a) the real flow — `faffter-noon-prd` → `faff contract prd-readiness` gate, plus `faff prdr new/admit`; (b) the P2 runbook's `faff prd new --from` / `faff prd admit`.
- *(b)* names commands that do not exist in `bin/lib/prd.js`; recording it propagates the fiction into FAFF-505.
- **Chosen:** the real flow, explicitly excluding the non-existent commands. At the time of writing, `faff prd` supports only `path | new | link | list | validate`, and `faff prd new` writes a fresh template rather than ingesting a file. (decides: qa)

## 7. Open Questions and Assumptions

**Open Questions:** none. All three decisions are closed (§6).

**Assumptions:**

- **Assumes:** the ticket's PRD prose is the complete and final human setpoint text to transcribe verbatim. *Validation:* before writing `PRD.md`, confirm the PRD text block in the ticket is the whole PRD (no truncation, no "see also"); if it references external content not in the ticket, stop and flag.
- **Assumes:** `records/adr/` next free number is 0067. *Validation:* `ls records/adr/ | sort | tail` — confirm no `0067-*` exists before authoring; if the log advanced, use the true next number.
- **Assumes:** `verification/external-verification/faff-lab/` does not yet exist and the PRD is committed nowhere in-repo. *Validation:* `test -e verification/external-verification/faff-lab/PRD.md` and a repo-wide grep for a distinctive PRD phrase; if either hits, reconcile before writing.

## 8. DONE — Definition of Done

### From WHY
- [ ] The faff-lab PRD is committed in-repo (was committed nowhere before)
- [ ] No PRD content was edited/paraphrased — `PRD.md` matches the ticket PRD text verbatim (whitespace-only diffs allowed)

### From WHAT (artifacts)
- [ ] `verification/external-verification/faff-lab/PRD.md` exists and contains the full PRD verbatim
- [ ] `records/adr/0070-faff-lab-tracker-vs-git-only.md` exists

### From HOW (ADR 0070)
- [ ] ADR 0070 is valid Nygard format: `# ADR 0070 — …`, metadata block, `## Context` / `## Decision` / `## Consequences`
- [ ] Metadata shows Status: Accepted and Ticket: FAFF-504
- [ ] Decision section uses `Chosen:` + Options considered, records git-only-first, and documents the upgrade path (add `tracking:` block, drop `automation_default`)

### From HOW (real admission flow)
- [ ] The recorded flow names `faffter-noon-prd` → `faff contract prd-readiness` and `faff prdr new` / `faff prdr admit`
- [ ] `grep -RnE 'faff prd (new --from|admit)' verification/external-verification/faff-lab/` returns zero matches

### From SCOPE
- [ ] No CLI/slot code changed; no `scaffold-faff-lab.sh` created; no faff-lab site code added (docs-only diff)

**Integration smoke test:**

```
PROCEDURE faff_504_smoke():
  1. test -f verification/external-verification/faff-lab/PRD.md            # PRD home exists
  2. test -f records/adr/0070-faff-lab-tracker-vs-git-only.md          # ADR exists
  3. grep -q "## Decision" records/adr/0070-faff-lab-tracker-vs-git-only.md
  4. ! grep -RqE 'faff prd (new --from|admit)' verification/external-verification/faff-lab/
  # all four pass => the docs plumbing FAFF-505 depends on is in place
```

## Appendix A — Discovered adjacent defect (filed as FAFF-507)

`verification/external-verification/scaffold-p2-task-api.sh`'s runbook cites `faff prd new --from PRD.md` and `faff prd admit`, neither of which exists (`bin/lib/prd.js` exposes only `path | new | link | list | validate`, and `new` writes a template). This is a real defect in that scaffold's prose but belongs to a separate ticket — filed as FAFF-507, and explicitly excluded from FAFF-504's diff.

confidence: high
