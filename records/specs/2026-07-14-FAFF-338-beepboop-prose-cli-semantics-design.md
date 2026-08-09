# FAFF-338 — Correct beep-boop prose to shipped CLI semantics (runcheck warn-not-block · sessionId token attribution)

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-338.

This spec addresses FAFF-338: two prose corrections in `plugin/skills/faff-beep-boop/SKILL.md` where the documentation still describes **pre-shipped** behaviour that the current CLI refutes. Audience: the build agent (a two-edit, prose-only change) and human reviewers verifying the prose now matches the shipped code. There is no runtime code change — the code is already correct; the prose lags it.

## 1. WHY — Problem and Principles

**The load-bearing model:** these are *documentation-coherence defects* (audit FAFF-323 findings D5 + R4/T4). Two shipped CLI behaviours — FAFF-235 (runcheck warn-not-block) and FAFF-229 (sessionId token attribution) — changed the mechanism, but the beep-boop prose still narrates the superseded behaviour. Prose that contradicts the shipped mechanism is a live defect: a reader (human or agent) reasoning from it reaches the wrong conclusion about what the guard-rail actually does.

**Problem statement:** the beep-boop SKILL.md Stop-hook section says a foreign abandoned run "audits-and-may-block" and a legacy ownerless ledger is "audited exactly as before" — both describe pre-FAFF-235 hard-block behaviour. The token-accounting bullet says child transcripts are attributed by "modified ≥ run start" (mtime) — the exact over-count mechanism FAFF-229 replaced with sessionId attribution. Each edit realigns one prose passage to the mechanism the CLI actually implements.

**Design principles:**

- **Docs never go stale — the prose must match the shipped code verbatim in mechanism, not vibe.** The corrected prose must be *falsifiable against the CLI*: the runcheck rewrite is checkable against `faff runcheck --selftest` (13 cases); the token rewrite is checkable against `bin/faff` `measureTokens` (the `childOwningSession === sid` attribution gate, `mtime >= runStartMs` pre-filter).
- **State the mechanism the guarantee rests on.** The "never overcounts" claim is only sound because foreign/unattributable children are *excluded*; the prose must name that mechanism (sessionId attribution) rather than the discredited one (mtime), so the guarantee is grounded, not asserted.
- **Skill-authoring standard applies** (`docs/reference/skill-authoring.md`): lean, skimmable, no changelog-in-prose. State the rule forward. `faff validate-adapters` gates the lintable subset (line caps, stray markers) in CI.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` | Markdown (skill prose) | The single file edited — both passages live here |
| `plugin/skills/faff/bin/faff` `runcheck --selftest` | Node | Ground truth for edit 1 (13 warn/block cases) |
| `plugin/skills/faff/bin/faff` `measureTokens` (~L2597–2632) | Node | Ground truth for edit 2 (sessionId attribution + mtime pre-filter) |

**Scope statement:** a documentation-coherence fix inside the faff skill-prose corpus; it closes two audit findings and changes no runtime behaviour.

## 2. OUT OF SCOPE

- **Any change to `bin/faff` runtime code.** — Why excluded: the CLI already implements the correct behaviour (FAFF-229, FAFF-235 both shipped and pass their selftests); only the prose lags. — Extension point: none needed; the code is the source of truth this prose is being aligned to.
- **The `faff-prep` prepcheck ownership prose (the sibling marker-mtime gate).** — Why excluded: FAFF-338 scopes only the two named passages in `faff-beep-boop/SKILL.md`; the prepcheck prose (in `faff-prep/SKILL.md`) is a separate surface. — Extension point: a follow-up audit ticket if that prose is found to lag its own selftest (`bin/faff` prepcheck cases at ~L1659–1679 already assert warn-not-block, so verify separately).
- **Other FAFF-323 audit findings beyond D5 + R4/T4.** — Why excluded: each audit finding is its own ticket. — Extension point: `verification/audits/2026-07-04-faff-323-whole-system-coherence.md`.

## 3. WHAT — the two edits

Both edits are in `plugin/skills/faff-beep-boop/SKILL.md`. Line numbers below are indicative (the file drifts); match on the quoted text, not the line number.

### Edit A — Token-accounting bullet (the `## Budget flags → The check` section, the "Token accounting." bullet)

**Current prose (defective clause):**

> … the orchestrator transcript (keyed off `$CLAUDE_CODE_SESSION_ID` — **never** the mtime-newest file, which can be a different session) **plus** every child `agent-*.jsonl` **modified ≥ run start** (subagent grafts dominate run spend and live in separate files), summed and **baselined** at run start (`tokens_at_start`). A missed late child file undercounts but never overcounts (guard-rail semantics).

**Required corrected meaning:** child `agent-*.jsonl` transcripts are aggregated by **owning session** — a child counts iff its owning session equals `$CLAUDE_CODE_SESSION_ID` (the `childOwningSession(f) === sid` attribution gate in `measureTokens`). The `mtime ≥ run start` comparison is retained **only as a cheap pre-filter** (skip obviously-old files without opening them) — it is *not* the attribution gate; removing it would change speed, never the total. A child whose session is foreign or unattributable is **excluded**, which lowers — never raises — the figure. This is *why* the never-overcounts guarantee holds: mtime alone would sweep in a prior/parallel run's child touched after this run's start and over-count (the FAFF-229 defect).

### Edit B — Stop-hook Ownership + liveness gate (the `### Stop hook` section, "Ownership + liveness gate (FAFF-205)" paragraph)

**Current prose (defective clauses):**

> … it audits-and-may-block only when the resolved run is one **this session owns** … **or** is **genuinely abandoned** (`owner` absent, `status≠"running"`, or `last_heartbeat` staler than `FAFF_RUN_HEARTBEAT_STALE_SECS`). … A legacy ledger with no `owner` is treated as unowned and audited exactly as before (zero regression).

**Required corrected meaning (FAFF-235):** the hook **hard-blocks only** when the resolved run is one **this session owns** (the `FAFF_RUN_DIR` / `FAFF_SESSION_ID` match against the `owner` stamp) **or** when a human passes explicit **`--recover`**. A **foreign, not-held** run — one whose owner is absent (legacy ledger), whose `status` is `done`, or whose `last_heartbeat` is staler than `FAFF_RUN_HEARTBEAT_STALE_SECS` — with admitted-but-undispatched work now **WARNs, never blocks**: the abandoned queue is still *surfaced* (so nothing is silently dropped), but a non-owning session is never hard-blocked by another run's incompleteness. A foreign run a live owner is still holding (running + fresh heartbeat) stays **silent**. The legacy no-owner ledger is treated as unowned and **warned, not blocked** — it is *not* "audited exactly as before" (the pre-FAFF-235 behaviour was a hard block).

## 4. HOW — Behaviour

No procedure or pseudocode: this is a text substitution. The build agent rewrites the two quoted passages to the corrected meaning above, honouring the skill-authoring standard (lean, skimmable, forward-stated, no FAFF-NN war-story breadcrumbs beyond the load-bearing `(FAFF-205)` / `(FAFF-229)` / `(FAFF-235)` provenance the surrounding prose already carries). Preserve the existing prose voice and any adjacent unaffected sentences. Keep the load-bearing anchors (`$CLAUDE_CODE_SESSION_ID`, `FAFF_RUN_DIR` / `FAFF_SESSION_ID`, `FAFF_RUN_HEARTBEAT_STALE_SECS`, `--recover`).

**Anti-pattern:** re-deriving the semantics from memory. Why: the shipped selftest is the authority — quote the mechanism it asserts, not a paraphrase.

## Scenarios

Non-functional (documentation-correctness) assertions — the observable is that the prose now matches the CLI it describes:

```
Assert: the corrected Stop-hook prose matches every case in `faff runcheck --selftest`
        — foreign not-held (stale heartbeat / status:done / legacy no-owner) + undispatched => WARN, not block;
          owned + undispatched => block; `--recover` on a foreign not-held run => block.
Assert: the corrected token-accounting prose matches `measureTokens` — child attribution is
        `childOwningSession === $CLAUDE_CODE_SESSION_ID`; `mtime >= run start` is a pre-filter only.
Assert: `faff validate-adapters` passes on the edited SKILL.md (no line-cap / stray-marker / dup-block regression).
```

## 5. DESIGN DECISION RATIONALE

**Rewrite the token bullet to name the sessionId attribution mechanism (not merely delete the wrong mtime clause).**
Options: (a) delete "modified ≥ run start" and leave the guarantee unexplained; (b) rewrite to state childOwningSession attribution + mtime-as-pre-filter, grounding the never-overcounts claim.
**Chosen:** (b) — rewrite to name the mechanism. Rationale: FAFF-338 explicitly flags that "the 'never overcounts' guarantee now rests on a mechanism the prose contradicts"; merely deleting the clause would leave the guarantee floating. Naming childOwningSession attribution makes the prose falsifiable against `measureTokens`.

**Rewrite the Stop-hook gate to warn-not-block for foreign not-held runs, block only for owned or `--recover`.**
Options: (a) minimally strike "genuinely abandoned → may-block"; (b) fully restate the warn/block matrix (owned or `--recover` => block; foreign not-held incl. legacy/stale/done => warn; foreign held => silent).
**Chosen:** (b) — fully restate the matrix. Rationale: the current prose is wrong in two places (the "genuinely abandoned" branch and the "legacy … audited exactly as before" sentence). A complete, selftest-aligned restatement removes both defects and matches the 13-case ground truth, rather than leaving a half-corrected paragraph.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**

- **Assumes:** the shipped CLI semantics are frozen for this change — `faff runcheck --selftest` (13 cases) and `measureTokens` reflect the intended behaviour. Validation: re-run `faff runcheck --selftest` (expect PASS, 13/0) and read `measureTokens` before editing; both were confirmed at spec time (2026-07-07).

## Already shipped against this surface

- **FAFF-235** (Done) — *runcheck Stop hook: a non-owning session must never be hard-blocked … warn, don't block.* Shipped the warn-not-block behaviour this prose must now describe (edit B). Related, **not superseding**: FAFF-338 exists *because* FAFF-235 shipped and the prose lagged.
- **FAFF-229** (Done) — *FAFF-36 budget: child agent-\*.jsonl token accounting can over-count (mtime-only scoping).* Shipped the sessionId attribution this prose must now describe (edit A). Same relationship — necessitates the fix, does not deliver it.
- **FAFF-346** (related) — architecture-slot wiring; unrelated surface, no overlap.

Premise verdict: **holds** — the two Done tickets changed the *code*; this ticket changes the *prose* to match. No portion of FAFF-338's deliverable is covered by them.

## Methodology critique

Agile-delivery lens (`faffter-dark-methodology-agile-delivery`), issue-critique:

- **Right-sized?** Yes — a single <1-day prose unit, two edits in one file, one concern (doc-coherence). No split warranted; the two edits always ship together (one audit finding pair, one PR), so no merge warranted either.
- **Workstream fit?** Cohesive — closes FAFF-323 audit findings D5 + R4/T4; the `faff-chain-gap-fill` label already frames it as gap-closure.
- **Deps surfaced?** No implicit deps — the upstream code tickets (FAFF-229, FAFF-235) are already Done; correctly modelled as `relatedTo`, not `blockedBy`.
- **Risk profile?** Minimal — prose-only, no runtime surface, fully verifiable against shipped selftests. No de-risking spike needed.

## 8. DONE — Definition of Done

### From WHAT (edit A)
- [ ] The token-accounting bullet no longer attributes child transcripts by "modified ≥ run start"; it states child aggregation is by owning session (`childOwningSession === $CLAUDE_CODE_SESSION_ID`).
- [ ] The bullet names `mtime ≥ run start` as a **pre-filter only**, not the attribution gate.
- [ ] The never-overcounts guarantee is grounded in the exclusion of foreign/unattributable children (undercount-not-overcount), matching `measureTokens`.

### From WHAT (edit B)
- [ ] The Stop-hook gate states the hook hard-blocks only for an **owning** session or explicit **`--recover`**.
- [ ] A foreign **not-held** run (owner absent / `status:done` / stale `last_heartbeat`) with undispatched work is documented as **WARN, not block**.
- [ ] The "legacy ledger … audited exactly as before" sentence is corrected to warn-not-block (no claim of pre-FAFF-235 parity).
- [ ] A foreign run a live owner still holds (running + fresh heartbeat) is documented as **silent**.

### From WHY / verification
- [ ] The corrected prose is consistent with `faff runcheck --selftest` (13 cases) and `measureTokens`.
- [ ] `faff validate-adapters` passes on the edited `faff-beep-boop/SKILL.md` (no lint regression).

**Integration smoke test:**

```
1. Re-read the two edited passages against `faff runcheck --selftest` output and `measureTokens` source.
2. Run `faff validate-adapters` => passes (skill-prose lint gate).
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
