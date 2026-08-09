# FAFF-485 — Trim heavy Linear MCP response payloads (call-site discipline, economics-driven)

> Spec: faffter-dark-nlspec · 2026-07-23 · autonomous-refresh · confidence: high. Full spec on Linear FAFF-485.

This spec is for the build agent implementing the first action-slice of FAFF-419's context-volume lever, and for human reviewers weighing its scope. It has been **narrowed** from the ticket's original three-lever framing after the already-shipped scan (see _Already shipped against this surface_): the single biggest lever already shipped, and two of the three named mechanisms need machinery this ticket puts out of scope.

> **Refresh note (2026-07-23, autonomous-refresh).** The one open Punt — the reduction target — was closed by a human Decision comment (via /faff-tidy, 2026-07-23): **measure-first**. This refresh folds that resolution into §6 and §7, drops the Punt, and re-rates medium → high. No design decision, interface, or approach changed; the resolution only fixes *how the target is set* (calibrated from the build's opening `faff economics --by mcp` read, not named in advance), which the spec's measurement discipline already assumed. Design re-confirmed against current `main`: `economics.js --by mcp` exists (FAFF-410, Done), the gateway has no "Lean tracker reads" subsection yet (this ticket adds it), and FAFF-484 (the biggest contributor — `list_issues` workable-states constraint) has shipped and is already credited below.

## 1. WHY — Problem and Principles

**The load-bearing model:** a Linear MCP tool_result is a *resident* block. Once returned it sits in the transcript and is re-sent on every subsequent turn — billed as `cache_read` at ~14× amplification. So a payload's lifetime cost is `size × turns-resident`, and the only two ways to lower it are (a) make the payload smaller at the point it is returned, or (b) stop it being resident (evict it). This ticket can only do (a); (b) needs machinery that is out of scope.

**Problem:** FAFF-407 found ~88% of faff's spend is context; FAFF-409 measured MCP responses at a single-digit share of `cache_read` (7.03% on the run measured during this prep). The heavy Linear reads return full-object JSON that then rides forward ×14. This is the most concrete, already-measured volume contributor — the thinnest viable first slice.

**Design principles:**
- **Measure, cut, re-measure — never blanket-rewrite.** Every call-site change is justified by its rank in `faff economics --by mcp` and confirmed by a re-run. A call site not in the ranking is not touched.
- **Reduce at the call, because prose cannot evict.** The build agent cannot delete a tool_result it already received; instructing it to "summarise then forget" a 90 KB body does not remove the 90 KB from the transcript. Only shrinking what the call returns lowers resident `cache_read` within this ticket's scope.
- **One home for the rule.** The lean-read guidance lives in one gateway subsection the read/write skills reference, mirroring how "Always pull fresh" and "Re-ground before gate" are single-homed — never copied per skill.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/economics.js` | JS (Node) | `--by mcp` measurement (FAFF-410, Done) — the born-verifiable instrument; not modified here |
| `plugin/skills/faff/SKILL.md` | prose | Gateway — home of the new "Lean tracker reads" subsection |
| `plugin/skills/faff-prep/SKILL.md` (Scenario B Step 2a, Path 1) | prose | Post-spec `list_comments` scan — a top-ranked remaining call site |
| `plugin/skills/faff-tidy/SKILL.md` | prose | Comment-scan reads |
| `plugin/skills/faff-beep-boop/SKILL.md` (Step ~215) | prose | Queue `list_issues` — **already** query-constrained by FAFF-484 |

**Scope statement:** this is sub-lever 1 of FAFF-419 (trim MCP payloads); it sits alongside FAFF-486 (context lifetime) and FAFF-487 (lean prompts), and it unblocks nothing until it ships (it blocks FAFF-486/487 only as sequencing, not as a hard dependency).

## 2. OUT OF SCOPE

- **Summarise-on-ingest that evicts the raw body / drop-after-consume** — *Why excluded:* both require the raw tool_result to leave the transcript, which prose instructions to the same agent cannot achieve. *Extension point:* subagent isolation makes the heavy read inside a throwaway context that returns only a distilled summary — that is **FAFF-486** (context lifetime). This ticket carries the interaction note, not the mechanism.
- **Linear-CLI swap** — *Why excluded:* routing reads through a CLI would make field-selection real (a CLI can project fields and keep the body out of context), but it is **FAFF-177**. *Extension point:* the gateway "Lean tracker reads" subsection this ticket adds is the natural place FAFF-177 later hangs its projection contract. *Interaction:* if FAFF-177 lands first, most of this ticket's call-site caps become redundant — sequence accordingly.
- **`list_issues` whole-tracker / non-workable-states fetch** — *Why excluded:* **already shipped by FAFF-484** (Done). *Extension point:* none needed — done.
- **Model/effort routing** — the *rate* lever (FAFF-416), not volume.

## 3. WHAT — the change

No new types or interfaces. The change is (a) one gateway subsection and (b) edits to named call-site prose. The instrument (`faff economics --by mcp`) already exists and is unchanged.

**Design decision — where does the lever live, given the eviction limit?**
- Options: (i) per-skill "call leanly" notes; (ii) one gateway rule referenced by callers; (iii) a new CLI wrapper that fetches-and-projects out of context.
- (iii) is FAFF-177's job and out of scope. (i) duplicates prose (violates the house dedup standard).
- **Chosen:** (ii) — a single gateway **"Lean tracker reads"** subsection stating: pass an explicit `limit` sized to what the step consumes (never rely on the default 50); order newest-first when only recent rows matter (e.g. post-spec comment scans); never pass `includeRelations` / `includeReleases` / `includeCustomerNeeds` unless the expanded fields are consumed in the same step; prefer a single `get_issue` over a `list_issues` when the id is known. Read/write skills reference it exactly as they reference "Always pull fresh."

**Design decision — which call sites get actioned?**
- **Chosen:** only those ranked by `faff economics --by mcp` on a representative pass, minus what FAFF-484 already fixed. On the prep-time reading that is **`list_comments`** (prep post-spec scan in Scenario B Step 2a / Path 1; tidy's comment scans) plus an **expansion-audit sweep** of all faff read call sites for accidental opt-in expansions. `list_issues` is already constrained (FAFF-484); `get_issue` / `save_issue` are already default-lean (no expansions requested) — audit-confirm, don't rewrite.

## 4. HOW — Behaviour

**Approach:** documentation + prose-instruction change, gated by measurement. No code changes to the CLI.

```
PROCEDURE trim-mcp-payloads:
  1. Run `faff economics --by mcp` on a representative accumulated run → the ranking.
  2. Drop any tool FAFF-484 already constrained (list_issues workable-states) from the action set.
  3. Add the gateway "Lean tracker reads" subsection (single home).
  4. For each remaining top-ranked read call site (list_comments in prep/tidy):
     a. Set an explicit limit sized to what the step consumes.
     b. Order newest-first where only recent rows are used.
     c. Point the site at the gateway rule rather than restating it.
  5. Expansion-audit sweep: grep all faff SKILL.md read call sites; assert none opts into
     includeRelations/includeReleases/includeCustomerNeeds without consuming the expansion.
  6. Re-run `faff economics --by mcp` on a matched pass → confirm the actioned tools'
     resident cache_read did not rise and the targeted ones fell; record the before/after.
```

**Failure modes:**
- **The win is below the measurement noise floor.** *How you'd know:* the matched before/after `--by mcp` shows the targeted tools' `cache_read~` unmoved or within run-to-run variance. *What it means:* narrow — the honest conclusion is that call-site trimming's ceiling is small once FAFF-484 shipped, and the real volume win lives in FAFF-486 (eviction). Record the null result; do not manufacture a bigger change to hit a number.
- **`--by mcp` isn't comparable across the two passes.** The metric is per-run and workload-dependent, so a raw delta between two *different* workloads is a confound. *How you'd know:* the two passes touched different issue counts / comment volumes. *What it means:* compare on a matched workload (same command over the same tracker scope), or express the target as a per-call `resp~` reduction (workload-independent) rather than a run-total delta.

**Anti-pattern:** instructing the build agent to "read the body, extract the fields, then discard it." Why: the discard is a no-op against `cache_read` — the block stays resident. Only a smaller returned body, or eviction (FAFF-486), reduces the bill.

## 5. Scenarios — born-verifiable objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the prep post-spec comment scan (Scenario B Step 2a / Path 1)
When it calls list_comments
Then the call passes an explicit limit (not the default 50) and newest-first ordering,
     and points at the gateway "Lean tracker reads" rule
```

- The gateway carries exactly one "Lean tracker reads" subsection; the actioned read skills reference it rather than restating the guidance.
- No faff read call site opts into `includeRelations` / `includeReleases` / `includeCustomerNeeds` without consuming the expanded fields in the same step (grep-checkable).

## 6. Design decision rationale

**Where does the lever live?** → **Chosen:** one gateway "Lean tracker reads" subsection (dedup standard; single-home precedent = "Always pull fresh"). Rejected per-skill notes (duplication) and a fetch-and-project CLI (that is FAFF-177).

**Can this ticket deliver "drop-after-consume"?** → **Chosen:** No — deferred to FAFF-486. A resident tool_result cannot be evicted by same-agent prose; only subagent isolation or an out-of-context CLI evicts. This resolves the ticket's open question (call-site field-selection vs post-ingest summariser): the in-scope, measurable lever is call-site trimming; the summariser that actually helps is the eviction path, which is FAFF-486/177. At the time of writing the Linear MCP has no field-projection param, so revisit if that changes.

**How ambitious is the reduction target?** → **Chosen:** measure-first — the target is not named in advance. The build calibrates it from its opening `faff economics --by mcp` reading and reports the matched-workload before/after honestly. A null result (call-site trimming's achievable ceiling is below the run-to-run noise floor now that FAFF-484 — the biggest contributor — has shipped) is a **valid finding**, not a failure to manufacture a bigger change around. This makes the target data-derived rather than guessed, and it is exactly what the §4 failure-modes and the §8 measurement DoD already require. *(Resolved by human Decision comment via /faff-tidy, 2026-07-23; folded in by autonomous-refresh 2026-07-23.)*

## 7. Open questions and assumptions

**Open Questions**
- None open. The former Punt (the concrete reduction target) is resolved — see §6, **How ambitious is the reduction target?** (**Chosen:** measure-first, human Decision 2026-07-23). The target is set from the build's opening `faff economics --by mcp` read against a matched workload, and a null result is a valid finding.

**Assumptions**
- **Assumes:** `faff economics --by mcp` exists and reports per-tool `resp~` / `cache_read~` (FAFF-410, Done). *Validation:* already confirmed — it ran during this prep and produced the ranking cited above, and was re-confirmed present in `plugin/skills/faff/bin/lib/economics.js` on the 2026-07-23 refresh.

## Already shipped against this surface
- **FAFF-484** (Done, 2026-07-13, same project) — constrained beep-boop's no-issue-set `list_issues` to workable (non-terminal) states, one query-constrained call per category with `includeArchived:false`. This already delivers the mitigation for the **top-ranked** MCP contributor (`list_issues`). This ticket must **not** redo it; the remaining delta is `list_comments` + the expansion-audit + the single gateway rule. *(Re-confirmed shipped on `main` at the 2026-07-23 refresh: `faff-beep-boop/SKILL.md` steps ~152 and ~215 carry the workable-states constraint.)*
- **FAFF-201** (Done) — beep-boop per-issue context isolation (orchestrator holds only the ledger): the build-lane eviction half, adjacent to FAFF-486. Confirms that eviction (not call-site trimming) is where the large context wins already live.

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] Every actioned call site is justified by its rank in a `faff economics --by mcp` reading recorded in the PR, and no un-ranked site is changed.

### From WHAT / HOW
- [ ] The gateway (`plugin/skills/faff/SKILL.md`) gains exactly one "Lean tracker reads" subsection stating the limit / ordering / no-unused-expansion / prefer-`get_issue` rules.
- [ ] The prep post-spec `list_comments` scan and tidy's comment scans pass an explicit `limit` (not default 50), use newest-first ordering where only recent rows are consumed, and reference the gateway rule instead of restating it.
- [ ] A grep-verified expansion-audit: no faff read call site opts into `includeRelations` / `includeReleases` / `includeCustomerNeeds` without consuming the expansion in the same step.
- [ ] `list_issues` (FAFF-484) is left as-is and cited as already-delivered, not re-edited.

### From measurement (target = measure-first, per the 2026-07-23 Decision)
- [ ] The build's **opening** `faff economics --by mcp` reading is recorded in the PR as the calibration baseline (the target is derived from it, not named in advance).
- [ ] A matched-workload before/after `faff economics --by mcp` is recorded in the PR; the actioned tools' per-call `resp~` is reduced (or a null/negative result is honestly reported per the failure-mode), and the overall MCP share of `cache_read` is not increased. A null result is an acceptable, valid outcome.

### Integration smoke test
```
Run `faff economics --by mcp` before the change → note list_comments resp~ and MCP cache_read share.
Apply the gateway rule + call-site edits.
Run the same command over the same tracker scope → list_comments resp~ down, share not up.
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
