# FAFF-592 — Commit the per-seam harness-coupling disposition table

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous · confidence: high. Full spec on Linear FAFF-592.

This spec covers a single documentation deliverable: committing `docs/reference/architecture/harness-coupling.md`, the per-seam table that classifies every Claude Code coupling in faff as portable, adapter, down-stack, or drop. Audience: the build agent that writes the doc, and human reviewers checking the classifications against the codebase.

## 1. WHY — Problem and Principles

**The load-bearing model:** faff touches its harness (Claude Code today) at a small, enumerable set of seams, and each seam already has a settled portability disposition — decided in the 2026-07-21 cross-harness planning work and recorded in the FAFF-477 spike audit. What is missing is the committed artifact: one page in the repo that states each seam's disposition with its evidence, so the harness-abstraction interface work (FAFF-483) has a fixed inventory to trace against instead of re-deriving the audit from scattered tickets.

**Problem statement:** the FAFF-477 spike's audit findings live in ticket comments and a planning package, not the repo. FAFF-483 (the seam contract) and the sibling porting tickets need a stable, reviewable inventory to build from. This change commits that inventory as a one-page architecture doc.

**Design principles:**

**State the load-bearing principle once, then let the rows carry it.** The doc opens with the single governing principle — prompts target the Agent Skills open standard; determinism lives in the CLI; enforcement's floor lives in git + CI; harness hooks are progressive enhancement — and never restates it per row. Rows cite evidence, not philosophy.

**Every row is evidence-anchored.** Each seam row names the concrete artifact that embodies the coupling (a file, a hook list, a config key), so a reviewer can check the classification against the codebase and FAFF-483 can trace each interface seam to a row. A row without an anchor is an unverifiable claim.

**Disposition, not implementation.** The doc records *what happens to each seam* when faff runs under a different harness — it does not design the adapters. The sibling tickets (FAFF-593 codex engine, FAFF-594 window-mode budget, FAFF-595 worktree provisioning, FAFF-604 telemetry adapter, FAFF-605 appetite→permission mapping) own the implementations; the doc references them as the follow-on homes.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/*/SKILL.md` | Markdown + YAML frontmatter | The prompt tier — the portable rows' subject |
| `plugin/skills/faff/bin/` (`faff` + `lib/*.js`) | Node, dependency-free | The deterministic CLI; its two Claude tendrils are seam rows |
| `plugin/skills/faff/bin/lib/hooks-ensure.js` | Node | Registers the Stop set (`runcheck`, `prepcheck`, `sentrycheck`) and PreToolUse set (`merge-fence`, `background-fence`) into `.claude/settings.json` |
| `plugin/skills/faff/bin/lib/budget.js` | Node | Transcript-JSONL token metering keyed off `$CLAUDE_CODE_SESSION_ID` and the `~/.claude/projects/<encoded-cwd>/` convention |
| `plugin/skills/faff/bin/lib/governance-check.js` + `.github/actions/governance-check` | Node + CI | The down-stack authoritative home for the Stop-hook governance floor |
| `plugin/skills/faff/bin/lib/merge-fence.js`, `records/adr/0043-*.md` | Node + ADR | The PreToolUse merge fence and the forge-side floor it moves down to |
| `plugin/skills/faff-graft/setup-worktree.sh` | Bash | The WorktreeCreate hook slated for drop |
| `plugin/skills/faff/bin/lib/engine.js`, `lib/backends.js` | Node | The engine-fork dispatch transport and the `backends:` config namespace |

**Scope statement:** this is the deliverable half of the FAFF-477 spike, committed under `docs/reference/architecture/` alongside the existing L3/L4 architecture doc, and the starting inventory for FAFF-483's interface definition.

## 2. OUT OF SCOPE

- **The harness-abstraction interface itself** — why excluded: that is FAFF-483's deliverable, which consumes this table. Extension point: FAFF-483 respecs against the committed doc.
- **Any adapter implementation** (codex engine, window-mode budget, de-hooked worktree provisioning, telemetry adapter, appetite→permission mapping) — why excluded: each has its own ticket (FAFF-593/594/595/604/605). Extension point: the ticket references in the relevant rows.
- **Closing FAFF-477** — why excluded: tracker lifecycle, not repo content; the human comment on FAFF-477 says it closes when this merges, which is a post-merge tracker action outside this change. Extension point: the merge event itself.
- **Restructuring existing docs** — why excluded: `docs/reference/architecture/` already exists with the L3/L4 doc; this adds one file, moves nothing.

## 3. WHAT — the document's shape

**Vocabulary** (the closed disposition set — define at the top of the doc):

| Term | Definition |
|---|---|
| portable | Works on any harness implementing the Agent Skills open standard, or is harness-independent already; no work needed |
| adapter | Stays, but behind a swappable seam — a config-selected backend or a documented mapping table |
| down-stack | The authoritative enforcement moves below the harness (git + CI); the harness hook remains as fast local feedback, not the floor |
| drop | The harness mechanic is removed; its job moves into skill-step prose or the CLI |

**The table** — eight rows, columns `Seam | Today (Claude Code) | Disposition | Evidence / follow-on`:

1. **Skills + frontmatter** — SKILL.md prose with YAML frontmatter, read by the harness's skill loader. **Disposition: portable** — the Agent Skills open standard (Linux Foundation governed, 32+ tools including Codex reading SKILL.md from `~/.agents/skills/`).
2. **Deterministic CLI** — the dependency-free Node CLI under `plugin/skills/faff/bin/`. **Disposition: portable**, with exactly two Claude tendrils called out inline: (a) transcript-JSONL telemetry (`budget.js`: `$CLAUDE_CODE_SESSION_ID`, the `~/.claude/projects/<encoded-cwd>/` transcript dirs, child `agent-*.jsonl` attribution) → adapter seam, FAFF-604; (b) `hooks-ensure` writing `.claude/settings.json` → meaningful only where hooks exist.
3. **Stop hooks** (`runcheck` / `prepcheck` / `sentrycheck`) — **Disposition: down-stack** — the authoritative home is the `governance-check` required CI status check (FAFF-363, the FAFF-562 chain); harness Stop hooks are fast local feedback.
4. **PreToolUse fences** (`merge-fence` / `background-fence`) — **Disposition: down-stack** — branch protection + the required check *is* the merge fence per ADR-0043's forge-side floor; the PreToolUse deny is the local echo.
5. **Subagent dispatch** — the Agent-tool producer dispatch prose in the gateway. **Disposition: adapter** — the engine-fork transport (`faff engine call`, a CLI spawn) is the portable path; the Agent tool is the Claude fast path. Follow-on: FAFF-593.
6. **Permission / appetite mapping** — appetite levels ride Claude Code permission modes today. **Disposition: adapter** — a documented per-harness mapping table. Follow-on: FAFF-605.
7. **WorktreeCreate hook** — `setup-worktree.sh` invoked by the harness on worktree creation. **Disposition: drop** — graft's skill step provisions the worktree directly. Follow-on: FAFF-595.
8. **Model / effort lanes** — `models:` / `effort:` config resolved to Agent-tool parameters. **Disposition: adapter** — via the `backends:` namespace (FAFF-523), which already generalises engines to named backend records.

**Design decisions** are collected in section 6 with markers.

## 4. HOW — producing the doc

The change is one committed markdown file; no code, no config, no build steps.

```
PROCEDURE commit_disposition_table:
  1. Create docs/reference/architecture/harness-coupling.md
  2. Open with: title, one-paragraph purpose (FAFF-477 deliverable, FAFF-483 input),
     the load-bearing principle stated once, the four-term vocabulary table
  3. Emit the eight-row table (WHAT section above), each row carrying its
     evidence anchor (file path / hook list / ADR / config key) and, where an
     adapter or drop is planned, the follow-on ticket reference
  4. Close with a short "how to extend" note: a new harness coupling gets a row
     here BEFORE it gets an implementation, and FAFF-483's interface must trace
     every seam it names to a row
```

**Edge cases:** none runtime — the artifact is static documentation. The one review-time hazard is drift: a row citing a file or hook list that has since changed. The evidence-anchor principle exists so review catches this mechanically (check each anchor exists).

**Anti-pattern:** restating the gateway's levels/slots documentation inside the doc. Why: the doc classifies harness couplings; harness-independent behaviour contracts already have their homes, and duplication rots.

## Scenarios

Given `docs/reference/architecture/harness-coupling.md` is committed on main
When FAFF-483 respecs the harness-abstraction interface
Then every seam FAFF-483 names traces to exactly one row of the table

Given a reviewer reads any single row
When they open the row's evidence anchor (file, hook list, ADR, or config key)
Then the artifact exists in the repo and embodies the coupling the row describes

- The doc states the load-bearing principle exactly once (in the opener, not per row).
- The doc defines all four disposition terms before the table uses them, and uses no disposition term outside that closed set.

## 6. DESIGN DECISION RATIONALE

**Where does the artifact land?** FAFF-477 originally named `design/harness-portability-surface.md`; no `design/` directory exists in the repo, and the ticket that now owns the deliverable names `docs/reference/architecture/harness-coupling.md`, beside the existing L3/L4 architecture doc. **Chosen:** `docs/reference/architecture/harness-coupling.md` — the FAFF-592 path supersedes the spike's provisional path; the human comment on FAFF-477 confirms the deliverable moved.

**Disposition vocabulary.** Options: FAFF-477's original two-way split (backend-swappable vs runtime-bound) vs the planning package's four-way split. The two-way split cannot express "enforcement moves to CI" or "delete the mechanic", both of which are real outcomes here. **Chosen:** the four-way portable / adapter / down-stack / drop vocabulary, as a closed set defined in the doc.

**Row inventory.** The eight seams enumerated in the ticket, verified present in the codebase during prep (hook lists read from `hooks-ensure.js`, tendrils from `budget.js`, fence from `merge-fence.js` + ADR-0043, dispatch prose from the gateway, worktree hook from `setup-worktree.sh`, lanes from `backends.js`). **Chosen:** exactly these eight rows — additions are future edits under the doc's "how to extend" note, not scope of this change.

**Depth per row.** Options: full per-seam design notes vs one-line dispositions with anchors. **Chosen:** one page, evidence-anchored rows, follow-on work referenced by ticket — the doc is an inventory the interface work traces to, not a design document (Size S stays S).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — every decision above is closed; the classifications were settled by the planning package and verified against the codebase.

**Assumptions:**

**Assumes:** the evidence anchors exist as verified at prep time — `plugin/skills/faff/bin/lib/{budget,hooks-ensure,governance-check,merge-fence,engine,backends}.js`, `plugin/skills/faff-graft/setup-worktree.sh`, `records/adr/0043-*.md`, and the Stop/PreToolUse hook lists (`runcheck`/`prepcheck`/`sentrycheck`, `merge-fence`/`background-fence`). Validation: before writing each row, confirm the named path or list exists; if one has drifted, update the row's anchor to the current location rather than parking.

## 8. DONE — Definition of Done

### From WHY
- [ ] `docs/reference/architecture/harness-coupling.md` exists on the feature branch and states the load-bearing principle exactly once, in the opener

### From WHAT
- [ ] The four disposition terms are defined in a vocabulary table before first use, and no other disposition term appears
- [ ] The table has exactly the eight enumerated seam rows, each with a disposition from the closed set
- [ ] Every row names at least one evidence anchor (file path, hook list, ADR, or config key) that exists in the repo
- [ ] Rows with planned follow-on work reference their ticket (FAFF-593, FAFF-594, FAFF-595, FAFF-604, FAFF-605 as applicable)

### From HOW
- [ ] The doc closes with the "how to extend" note binding FAFF-483's interface seams to table rows
- [ ] The doc introduces no per-row restatement of the governing principle and no duplicated gateway documentation

**Integration smoke test:**

```
1. Open docs/reference/architecture/harness-coupling.md
2. For each of the 8 rows, resolve its evidence anchor in the repo — all resolve
3. Grep the doc for the principle sentence — exactly one occurrence
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
