# Spec — Document per-change-class autonomy as the adoption pattern

> Spec: faffter-dark-nlspec · 2026-07-12 · autonomous · confidence: high. Full spec on Linear FAFF-358.

This is a **documentation / positioning** spec for FAFF-358, for the build agent that will author the guide prose and for human reviewers. It adds no product code: every mechanism it describes already ships. The deliverable is a new user-guide page plus a one-sentence reframe of the levels narrative, both grounded in faff's existing per-ticket eligibility and crank-up machinery.

## 1. WHY — Problem and Principles

**The load-bearing model: a level is a property of a *workload*, not of a *team*.** faff already decides autonomy per ticket — the `faff-automate` label makes one ticket eligible for the autonomous pipeline while an unlabelled ticket beside it stays human-run. So on a single board, on a single night, some tickets run unattended (L3) and others are left for the engineer (L1) — simultaneously. "Which level am I at?" is the wrong question; "which change-classes have I cranked up?" is the right one. Everything else in this spec follows from stating that clearly in the docs.

**Problem statement.** The guide and the levels table frame adoption as a per-team ladder ("which level are you at"). Real teams adopt autonomy by **risk-tier per change-class** — unattended for dependency bumps and test backfill while keeping schema and auth changes hand-driven, at the same time. The current framing is both less accurate and less sellable than the per-ticket story faff's machinery already implements, so a reader mis-models faff as a single global dial.

**Design principles (govern the prose).**

- **Document existing mechanisms, invent none.** The page describes `faff-automate` per-ticket eligibility, the `appetite` dial, and the routing-verdict gate as they already work. If the prose seems to need a new label, path-pattern matcher, or config key, that is a signal to stop and re-scope — not to build it. A change-class *lens* on crank-up-sets is explicitly future work (OUT OF SCOPE).
- **Be accurate about crank-up-sets.** Today the methodology's `crank-up-set` output batches not-eligible work by **dependency chain** (root + its ordered slice-members), not by change-class. The page must not imply faff groups crank-ups by change-class today; the change-class *unit of adoption* is expressed by **which tickets a human labels `faff-automate`**, one ticket (or one chain) at a time.
- **Guide prose is lint-enforced self-contained.** `docs/guide/**` is gated by `faff lint-refs`: no references to external artifacts (design notes, ADRs, ticket IDs, research citations) in the prose. The rule must be inlined and the page must read stand-alone.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` → *Automation eligibility* | Skill prose | Canonical per-ticket eligibility rule (`faff-automate` / `faff-automation-hold` / `automation_default`) the page cites in plain English |
| `plugin/skills/faff/SKILL.md` → levels intro (top) | Skill prose | The levels table + intro that gets the one-sentence reframe |
| `README.md` → *The levels* | Repo README | Mirrors the levels table/intro — kept consistent with the reframe |
| `docs/guide/*.md` + README *Going further* index | User guide | Where the new page lands and is linked from |
| `plugin/skills/faff/bin/lib/lint-refs.js` | CLI | Enforces the self-contained rule over `docs/guide/**` — the page must pass it |

**Scope statement.** This sits in the user-facing guide (`docs/guide/`) and the gateway/README levels narrative — the adoption-story surface, not the pipeline mechanics.

## 2. OUT OF SCOPE

- **A change-class lens for `crank-up-set`** (batching by label or path-pattern rather than by dependency chain) — **Why excluded:** it is a real future refinement but not needed to tell the adoption story; per-ticket labelling already expresses change-class adoption. **Extension point:** the `crank-up-set` named output in `plugin/skills/faff/SKILL.md` → *The `methodology` slot*, plus the methodology skill that answers it.
- **Any new control label, config key, or path-pattern matcher** — **Why excluded:** the thesis is that no new machinery is required. **Extension point:** *Automation eligibility* label set + `.faffrc` schema, if a future ticket ever justifies it.
- **The honest-ladder guarantee table** (per-level guarantees) — **Why excluded:** a sibling positioning ticket owns it; this page cross-sells the framing but does not build that table. **Extension point:** that ticket's deliverable.
- **Rewriting the levels table itself** — **Why excluded:** the table is correct; only the framing sentence around it changes. **Extension point:** the levels intro paragraph.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Change-class | A category of change sharing a risk profile — e.g. dependency bumps, docs, test backfill, config-guarded-by-CI (low risk); schema, auth, public API (high risk). Not a faff object; a human's mental grouping. |
| Risk-tiered adoption | Cranking up autonomy for low-risk change-classes first and widening class-by-class as calibration data accrues, rather than flipping a whole team to a level. |
| Per-workload level | The observation that the L1–L4 level applies to a given piece of work (via its eligibility), not to the whole team. |

**The deliverable is prose, so the "interfaces" are the claims the page must make and the edit it must apply:**

**A. New guide page — `docs/guide/adopting-by-change-class.md`.** Self-contained (passes `faff lint-refs`). It must assert, in skimmable house style:
1. The opt-in default — nothing is automatable until a human sets `faff-automate`; a forgotten label means "left alone," never "picked up."
2. The adoption motion — crank up narrow, low-risk change-classes first (deps, docs, test backfill, config-with-CI), widen class-by-class as trust/calibration accumulates.
3. The reframe — the level describes *how a given class is run*, not *what the team is*; L1 and L3 legitimately coexist on one board the same night.
4. The mechanism grounding — this is achieved with existing pieces: per-ticket `faff-automate` eligibility, the `appetite` dial, and the routing-verdict gate that admits only confident work. No new machinery.
5. The crank-up-set honesty note — the methodology groups not-eligible work into crank-up batches by dependency chain today; a change-class lens is possible future refinement, not current behaviour.

**B. Gateway reframe sentence — `plugin/skills/faff/SKILL.md` levels intro.** One added sentence: levels are per-workload, not per-team — a team legitimately runs L1 and L3 on the same board the same night (eligibility decides which). Must respect the skill-authoring lean/lint standard (`faff validate-adapters`).

**C. README consistency — `README.md` *The levels*.** Mirror the same one-sentence reframe so the pitch and the gateway agree (the levels table is duplicated across both today).

**D. Index link — `README.md` *Going further*.** Add a bullet linking the new page, matching the existing index-entry style.

**Design decisions.**

- New page vs. a section in an existing page. Options: (a) new `docs/guide/adopting-by-change-class.md`; (b) a section inside `configuration.md` or `unattended.md`. A standalone page is discoverable from the README index, is a distinct adoption-narrative topic, and keeps `unattended.md` focused on L3 mechanics. **Chosen:** a new standalone guide page (option a).
- Whether to also touch the README levels intro. The levels narrative is duplicated README↔gateway; leaving one un-reframed creates a contradiction. **Chosen:** apply the one-sentence reframe in both the gateway and the README (item C), keeping them consistent.
- Scope of the crank-up-set nod. **Chosen:** describe current chain-batching accurately and name a change-class lens as future work only — no code, per OUT OF SCOPE.

## 4. HOW — Behaviour

**Approach.** Author the new page, apply the two-place reframe, add the index link, then verify against the lint gates. All edits are prose; the "behaviour" is what the reader can check.

**Anti-pattern:** claiming faff batches crank-ups *by change-class* today. Why: `crank-up-set` batches by dependency chain; the change-class unit is per-ticket labelling. Mis-stating this invents behaviour that doesn't exist.

**Anti-pattern:** citing the source research note, ADR, or ticket IDs in the guide-page prose. Why: `faff lint-refs` fails the build for external-artifact refs in `docs/guide/**`; inline the rule instead.

**Anti-pattern:** framing appetite as per-ticket. Why: `appetite` is a single global project dial (no per-issue override); the per-workload lever is `faff-automate` eligibility, not appetite. The page must attribute the per-workload behaviour to eligibility.

**Failure mode — the framing is accurate but ungrounded.** The page could read as aspirational positioning rather than a description of shipped mechanism. *How you'd know:* a reader can't point at the concrete lever (which label, which gate) after reading. *What it means:* every claim in the page must name the existing mechanism that implements it (eligibility label, appetite dial, verdict gate). If a claim has no mechanism, cut the claim — don't add the mechanism.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a reader who thinks faff autonomy is a single global team-level setting
When they read docs/guide/adopting-by-change-class.md
Then the page states levels apply per-workload (via faff-automate eligibility), and that L1 and L3 coexist on one board the same night
```

```
Given the new guide page and the reframed gateway/README levels intro
When `faff lint-refs` runs over docs/guide/**
Then it passes — the page contains no external-artifact references (no design-note, ADR, ticket-ID, or research citations)
```

```
Given the README "Going further" index
When a reader scans it
Then it links docs/guide/adopting-by-change-class.md in the existing index style
```

- The page attributes the per-workload lever to `faff-automate` eligibility and the risk-throttle to the `appetite` dial + routing-verdict gate — not to any new or invented mechanism.
- The page describes `crank-up-set` as batching by dependency chain today and names a change-class lens only as future work.

## 6. DESIGN DECISION RATIONALE

**Where does the adoption pattern live — new page or existing section?**
- Options: new standalone guide page; a section in `configuration.md`/`unattended.md`.
- New page is independently linkable from the README index, keeps existing pages focused, and reads as a first-class adoption narrative.
- **Chosen:** new `docs/guide/adopting-by-change-class.md` — rationale above.

**Reframe one place or two?**
- The levels table/intro is duplicated in the gateway and the README; reframing only one leaves a visible contradiction.
- **Chosen:** the same one-sentence reframe in both — minimal, keeps the two authoritative copies consistent.

**How far to take the crank-up-set nod?**
- The ticket flags it as optional/assess-at-prep. Building a change-class lens is real scope with a methodology contract change.
- **Chosen:** documentation only — state current chain-batching accurately, name the change-class lens as future work. No code.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the one substantive choice (new page vs section) is closed above.

**Assumptions:**
- **Assumes:** `docs/guide/**` is lint-enforced self-contained by `faff lint-refs` (confirmed at `plugin/skills/faff/bin/lib/lint-refs.js`). *Validate:* run `faff lint-refs` after authoring; it must PASS.
- **Assumes:** the gateway/README levels intro edit stays within the skill-authoring lean standard. *Validate:* run `faff validate-adapters` after the edit.

## 8. DONE — Definition of Done

### From WHY
- [ ] A reader of the new page can identify the concrete lever (per-ticket `faff-automate` eligibility) that makes a level a property of a workload, not a team.

### From WHAT (deliverables)
- [ ] `docs/guide/adopting-by-change-class.md` exists and states: opt-in default; crank low-risk classes first then widen; level is per-workload (L1+L3 coexist same board same night); grounded in `faff-automate` eligibility + `appetite` dial + routing-verdict gate; no new machinery.
- [ ] The gateway levels intro (`plugin/skills/faff/SKILL.md`) gains one sentence: levels are per-workload, not per-team.
- [ ] `README.md` *The levels* carries the same one-sentence reframe (consistency with the gateway).
- [ ] `README.md` *Going further* links the new page in the existing index style.

### From HOW (accuracy / gates)
- [ ] The page describes `crank-up-set` as batching by dependency chain today and names a change-class lens only as future work (no claim that faff batches crank-ups by change-class today).
- [ ] The page attributes the risk-throttle to `appetite` + the routing-verdict gate, and does not frame `appetite` as per-ticket.
- [ ] `faff lint-refs` PASSES over `docs/guide/**` (page is self-contained — no external-artifact refs).
- [ ] `faff validate-adapters` PASSES (gateway edit conforms to the lean standard).

**Integration smoke test:** author the page + apply the three edits, then run `faff lint-refs && faff validate-adapters` — both PASS, and the README index link resolves to the new file.

confidence: high
