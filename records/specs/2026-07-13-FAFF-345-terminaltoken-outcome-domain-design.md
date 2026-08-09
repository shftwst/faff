# FAFF-345 — Correct the TerminalToken outcome domain to the four build buckets

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high
> Full spec on FAFF-345.

confidence: high
spec-review: approve

This spec addresses FAFF-345. Audience: the build agent making the edit and human reviewers. It is a prose-only correction to two executor skill prompts.

## 1. WHY — Problem and Principles

**Load-bearing model:** a build subagent's `TerminalToken.outcome` and the run-ledger *file*'s accepted value set are two different domains. The token is what a build subagent can *return*; the ledger file additionally holds *orchestrator dispositions* the orchestrator writes itself.

**Problem statement:** Both concurrency executors say the token `outcome` "is one of the existing six ledger buckets" and enumerate `routed-out` and `unreached-budget` among them. Those two are orchestrator dispositions — `routed-out` written at queue assembly (verdict gate), `unreached-budget` at budget fire — never returned by a build subagent. The wording invites exactly the invalid-outcome ledger writes `runcheck` exists to flag.

**Design principle — match the gateway's fixed set.** The concurrency-contract obligation 3 (`faff/SKILL.md` → _The `concurrency` slot contract (fixed)_) fixes the recorded terminal-outcome buckets at four — `shipped` / `pr-open` / `parked` / `errored`. The corrected prose must agree with that source, not restate a wider set.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` | Skill prose | Sequential executor — sentence to correct (line 34) |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` | Skill prose | Parallel executor — sentence to correct (line 35) |
| `plugin/skills/faff/SKILL.md` → concurrency slot contract | Gateway | Fixed four-bucket source of truth (obligation 3) |

**Scope statement:** a two-file prose fix in the concurrency executor skills; no code, contract, or tooling change.

## 2. OUT OF SCOPE

- **The run-ledger file's accepted value set** — Why excluded: the ledger *file* legitimately holds six values (four build buckets + two orchestrator dispositions); this ticket corrects only the *token* domain wording, not the file schema. Extension point: `faff/SKILL.md` → `.faff/` logging → Run ledger, and the `runcheck` validator.
- **The `claimed-by-peer` clause** — Why excluded: already correct (resolved pre-dispatch, never returned); leave it in place. Extension point: same two sentences.
- **Any behavioural / code change** — Why excluded: documentation-accuracy fix only; the executors already record only the four buckets. Extension point: n/a.

## 3. WHAT — Vocabulary and the corrected statement

**Vocabulary:**

| Term | Definition |
|---|---|
| Build bucket | An outcome a build subagent can return in its `TerminalToken`: `shipped` / `pr-open` / `parked` / `errored`. |
| Orchestrator disposition | A ledger value the orchestrator writes itself, never returned by a build subagent: `routed-out` (queue-assembly verdict gate), `unreached-budget` (budget fire). |

**The corrected statement (both files):** the sentence must state that a build subagent's `TerminalToken.outcome` is one of the **four** build buckets — `shipped` / `pr-open` / `parked` / `errored` — and that `routed-out` + `unreached-budget` are orchestrator dispositions (written at queue assembly / budget fire), not values a build subagent returns. Preserve each sentence's existing surrounding clauses (the `claimed-by-peer` note; the `shipped` / `pr-open` imply `pr != null` clause in the sequential file).

**Design decision.**
**Chosen:** correct the wording in place to the four build buckets, naming the two excluded values as orchestrator dispositions — rather than silently trimming the enumeration. Rationale: the issue's WHY is reader-education about the token-vs-file domain split; naming the dispositions is what prevents the invalid write, so the replacement teaches the split rather than just shortening a list.

## 4. HOW — Behavior

Edit each of the two sentences:

- `faffter-noon-concurrency-sequential/SKILL.md` (sentence beginning "`outcome` is one of the existing six ledger buckets …", line 34): rewrite the domain to the four build buckets and add the orchestrator-disposition clause. Keep the trailing `claimed-by-peer` clause and the `shipped` / `pr-open` imply `pr != null` clause.
- `faffter-dark-concurrency-parallel/SKILL.md` (sentence ending "… `outcome` is one of the existing six ledger buckets — `claimed-by-peer` is resolved pre-dispatch, never returned.", line 35): rewrite the domain likewise, keeping the `claimed-by-peer` clause.

**Anti-pattern:** deleting the enumeration outright. Why: the value teaches the domain split — replace it with the four-bucket set + the named dispositions, don't just remove it.

## 5. DONE — Definition of Done

### From WHY
- [ ] Neither executor sentence claims the token outcome is "one of the existing six ledger buckets."

### From WHAT / HOW
- [ ] `faffter-noon-concurrency-sequential/SKILL.md`'s outcome sentence states the four build buckets (`shipped` / `pr-open` / `parked` / `errored`) and names `routed-out` + `unreached-budget` as orchestrator dispositions.
- [ ] `faffter-dark-concurrency-parallel/SKILL.md`'s outcome sentence does the same.
- [ ] The `claimed-by-peer` clause is preserved in each, and the `shipped` / `pr-open` imply `pr != null` clause is preserved in the sequential file.
- [ ] The corrected four-bucket set matches the gateway concurrency-contract obligation 3 fixed set (`faff/SKILL.md`).
- [ ] `faff validate-adapters` passes on both edited files (a prose fix must introduce no lint violation).

## Methodology critique

*(agile-delivery lens — `issue-critique`)*

- **Right-sized?** No issues — a single ~minutes prose correction across two files, one concern.
- **Workstream fit?** No issues — documentation-accuracy fix, cohesive with the audit-driven drift-correction workstream (FAFF-323 R8).
- **Deps surfaced?** No issues — no build dependency; the gateway source it aligns to is already merged. Related-to FAFF-323 (source) / FAFF-355 (unrelated heartbeat work), neither a blocker.
- **Risk profile?** No issues — no novel integration or external dependency; no de-risking spike warranted.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" } ] }
```
