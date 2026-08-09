# FAFF-162 — Wire the `faff park-history` seam into the live repeat-park diagnostic

> Spec: faffter-dark-nlspec · 2026-06-16 · autonomous · confidence: high. Full spec on Linear FAFF-162 (comment 82039db7-32f4-4956-b29c-1c0abc068f00).

This is the build spec for FAFF-162. Audience: the build agent making the edit, and human reviewers gating it. It describes a **prose-to-call rewiring** of one SKILL detection cell — no code, no tests. The deterministic `faff park-history` seam shipped in FAFF-152 (merged, `2791efb`); this spec makes the live repeat-park diagnostic **call** it instead of re-deriving the count in prose the LLM executes.

## 1. WHY — Problem and Principles

**Problem statement.** FAFF-152 shipped `faff park-history` (a deterministic, tested CLI that counts same-root-cause-class parks in a rolling 21-day window and emits `repeat_parked` at the ≥3 threshold) but deliberately did **not** change any skill's behaviour — the live repeat-park structural diagnostic still instructs the LLM to "read the last 50 run summaries, classify each park, count ≥3-in-21d" as prose it re-executes every pass. The seam is therefore tested-but-dead code, and the diagnostic stays non-deterministic where a deterministic tool now exists. This spec rewires the diagnostic's "How" to **call** the seam and consume its output.

**Design principles.**

**Deterministic tools over prose (the governing tenet here).** The whole point is to *remove* the prose the LLM re-executes and replace it with a single deterministic call. The rewrite must not leave any residual "read N summaries / classify / count" instruction behind that an LLM could still follow as an alternative path — that would defeat the change and re-introduce non-determinism. The seam is the single source of the count.

**Locate the change at the producer, not the consumer.** The repeat-park count is **owned** by the methodology's `backlog-diagnostics` output (the structural-methodology SKILL). `faff-tidy` already *consumes* that output — it does not re-derive the count. The load-bearing edit therefore lands in the structural-methodology detection cell, and `faff-tidy` only gets (at most) a clarifying pointer. Editing tidy's prose to "call park-history" would wrongly duplicate ownership of the count across two skills.

**No ambient clock — pass the date in.** `faff park-history` requires `--now <ISO-8601>` and refuses to read an ambient clock (exit 2 if absent). The rewired prose must pass the **system current date** as the window end, consistent with the gateway's stale-clock hazard guidance (trust the system `currentDate`, never a sandbox clock).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-methodology-structural/SKILL.md` | Markdown (SKILL prose) | **Primary edit target** — the `backlog-diagnostics` detection cell that re-derives the count |
| `plugin/skills/faff-tidy/SKILL.md` | Markdown (SKILL prose) | Consumer of the diagnostic; at most a one-line pointer note |
| `plugin/skills/faff/bin/faff` (`park-history` subcommand) | Node (CLI) | The shipped seam being wired in — **read-only here** (no change) |
| `faff/SKILL.md` → *Resolving the `faff` executable* | Markdown (gateway) | The canonical resolver idiom the rewired prose references |
| `eval/cases/routing-006.json` + `faff park-history --selftest` | JSON / Node | The safety net (FAFF-147 routing verdict + FAFF-152 seam selftest) |

**Scope statement.** This sits in faff's structural-diagnostics layer — the methodology slot's `backlog-diagnostics` named output that every faff pass depends on — turning one already-built-and-tested deterministic seam from dead code into the live path.

## 2. OUT OF SCOPE

- **Any change to `faff park-history` (the CLI seam).** — *Why excluded:* it shipped complete and tested in FAFF-152; this ticket only consumes it. — *Extension point:* `plugin/skills/faff/bin/faff` `cmdParkHistory` / `computeParkHistory`, behind `faff park-history --selftest`.
- **Any new or changed test/eval.** — *Why excluded:* the safety net already exists (FAFF-152's scripted-driver test for the seam; FAFF-147's routing eval for the verdict consumption). The prose rewiring is covered by the shipped judgement-eval surface, not by new assertions. — *Extension point:* `eval/cases/*.json` + `test/` if a future change needs fresh coverage.
- **The other detection categories in the same table** (cycles, ghost-project pointers, splittable specs, chain gaps). — *Why excluded:* each has its own derivation; only the repeat-park row has a shipped deterministic seam to wire. — *Extension point:* their own rows in the same `backlog-diagnostics` detection table.
- **The downstream demote *behaviour* and its appetite-gating** (demote `repeat-parked` Todo → Backlog). — *Why excluded:* the action is unchanged; only the *source* of the `repeat_parked` set changes (seam output, not a re-count). — *Extension point:* the mechanical-fix row + tidy's demote action bullet.
- **The root-cause-class taxonomy itself.** — *Why excluded:* the fixed five classes (`punt-not-closed`, `gap`, `cycle`, `spec-ambiguous-external`, `other`) are owned by the gateway automation-routing contract and the seam already classifies against them. — *Extension point:* the gateway root-cause enum + `ROOT_CAUSE_CLASSES` in the CLI.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| The seam | `faff park-history` — the deterministic repeat-park counting CLI subcommand (FAFF-152). |
| Detection cell | The "How" cell of the **Repeat-park patterns** row in the structural-methodology `backlog-diagnostics` "Detection categories" table. |
| `repeat_parked` | The seam-emitted sorted array of issue ids with ≥3 same-root-cause-class parks in the rolling window. |
| Re-derivation prose | The text being removed: "Reads last 50 `.faff/runs/*/summary.md` files; classifies each park by the root-cause class enum…". |

**The seam interface (consumed, not defined here — verified against the shipped CLI).**

```
COMMAND faff park-history --now <ISO-8601> [--issue <id>] [--root <dir>]
  --now   REQUIRED   window end; exit 2 if absent or unparseable (no ambient clock)
  --issue OPTIONAL   restrict counts/repeat_parked to a single issue
  --root  OPTIONAL   repo root override (defaults to discovered root)
  EXIT    0 on success (JSON to stdout) · 2 on missing/bad --now or malformed parks block (fail-loud)

OUTPUT (single-line JSON on stdout):
RECORD ParkHistory:
  window_days:   Integer        # seam-owned; currently 21
  threshold:     Integer        # seam-owned; currently 3
  counts:        Map<IssueId, Map<RootCauseClass, Integer>>   # per-issue per-class park tallies in window
  repeat_parked: List<IssueId>  # sorted; issues with any class count >= threshold

ENUM RootCauseClass: punt-not-closed | gap | cycle | spec-ambiguous-external | other
```

**Design decision — what the rewired detection cell says.**

The cell must (a) name the call `faff park-history --now <currentDate>` (with the `faff` executable resolved per the gateway resolver rule, not hardcoded), (b) state that it consumes `repeat_parked` (and `counts` for the per-issue/per-class breakdown), (c) state that the **21-day window and the ≥3 threshold are owned by the seam** (`window_days` / `threshold` in its output), not restated as prose the LLM applies, and (d) keep the cross-reference that the root-cause classes are the gateway taxonomy (the `routing_adaptor` slot assigns against it).

**Chosen:** rewrite the detection cell to a call-and-consume description of `faff park-history --now <currentDate>`, with window/threshold attributed to the seam and the root-cause-enum cross-reference retained — and **delete** the "read 50 summaries / classify / count" re-derivation prose so no LLM-executable alternative path remains.

## 4. HOW — Behavior

**Architecture and approach.** Three surgical prose edits, no code. The first is load-bearing; the second keeps the mechanical-fix row consistent with it; the third is an optional clarifying pointer in the consumer.

**Edit 1 — the detection cell (load-bearing).** In `plugin/skills/faffter-noon-methodology-structural/SKILL.md`, the **Repeat-park patterns** row of the `backlog-diagnostics` "Detection categories" table. Replace the current "How" cell (which begins "Reads last 50 `.faff/runs/*/summary.md` files; classifies each park…") with a call-and-consume description.

**Edit 2 — the mechanical-fix row note (consistency).** In the same file, the mechanical-fix row "Repeat-park (3+ runs, same root-cause class), issue still in Todo → Demote to Backlog…". Add a brief note that the qualifying set is the seam's `repeat_parked` output, not a re-count. The demote behaviour, the `repeat-parked` tag, and the appetite-gating are **unchanged** — only the source of the set is clarified.

**Edit 3 — the consumer pointer (optional, clarifying).** In `plugin/skills/faff-tidy/SKILL.md`, the "Demote `repeat-parked` Todos to Backlog" auto-action bullet. It already delegates to the methodology's `backlog-diagnostics`; add a one-line pointer that the count comes from the methodology's `backlog-diagnostics`, which is now backed by `faff park-history`. **Do not** make tidy call the seam directly — that would duplicate ownership of the count.

**Behavior summary.** After the edits, a structural pass that needs the repeat-park set runs one deterministic CLI call (`faff park-history --now <currentDate>`) and reads `repeat_parked` / `counts` from its JSON, instead of an LLM re-reading and re-classifying run-summary files. Output, thresholds, and downstream demote behaviour are observably identical; the derivation is now deterministic.

**Edge cases and error handling.**

- **Empty / no parks in window** → seam returns `repeat_parked: []`; the diagnostic surfaces no repeat-park finding.
- **`--now` missing or unparseable** → seam exits 2 (fail-loud). The rewired prose must always pass the system `currentDate`.
- **Malformed parks block in a summary** → seam exits 2 (fail-loud). The diagnostic does not paper over it with a prose fallback.
- **`faff` not on `PATH`** → resolve via the gateway fallback (`${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff`); never hardcode the dev path.

**Anti-patterns:** (1) leaving the "read 50 summaries / classify / count" prose in place "as documentation" — re-introduces a non-deterministic LLM-executable path; (2) wiring `faff-tidy` to call `faff park-history` itself — duplicates ownership; (3) restating `21` / `3` as literals in the rewired prose — the seam owns `window_days` / `threshold`.

## 5. SCENARIOS — born-verifiable main objectives

```
Given the structural-methodology backlog-diagnostics detection table
When the build rewrites the Repeat-park patterns "How" cell
Then the cell names the call `faff park-history --now <currentDate>` and consumes its `repeat_parked` array
 And no "read N summaries / classify / count" re-derivation instruction remains anywhere in the cell
```

```
Given the rewired detection cell
When a reader checks where the 21-day window and the >=3 threshold come from
Then both are attributed to the seam (window_days / threshold), not restated as prose to apply
 And the root-cause-class cross-reference to the gateway taxonomy is retained
```

```
Given `faff-tidy`'s repeat-park demote auto-action
When the build completes
Then tidy still delegates to the methodology's backlog-diagnostics output (it does not call the seam itself)
 And the demote behaviour, `repeat-parked` tag, and appetite-gating are unchanged
```

Non-functional assertions:

- The seam's behaviour is unchanged: `faff park-history --selftest` still passes (no CLI edit).
- The shipped repeat-park eval coverage still passes against the rewired prose (FAFF-147 routing verdict).

## 6. DESIGN DECISION RATIONALE

**Where does the load-bearing edit belong — the structural methodology SKILL or `faff-tidy` §5?** **Chosen:** the structural-methodology detection cell (the producer), with at most a clarifying pointer in tidy. The ticket title says "faff-tidy SKILL §5" but the re-derivation prose canonically lives in the methodology producer; tidy already delegates via "Detected by the methodology slot's `backlog-diagnostics`".

**Restate the window/threshold in prose, or attribute them to the seam?** **Chosen:** attribute them to the seam's `window_days` / `threshold` — restating invites prose/seam drift.

**Pass `--now` explicitly, or rely on the seam defaulting to "today"?** **Chosen:** always pass `--now <currentDate>` — the seam has no ambient clock (exit 2 without `--now`).

(At the time of writing, `faff park-history` on `main` (`abe2638`) emits exactly `{window_days, threshold, counts, repeat_parked}` and `--selftest` passes 7/7 — verified during build.)

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None.

**Assumptions.**

- `faff park-history` is present on `main` with the `{window_days, threshold, counts, repeat_parked}` output shape and `--now` required. Validation: `node plugin/skills/faff/bin/faff park-history --selftest` (PASS) + `--now 2026-06-16T00:00:00Z` (four-key JSON). Verified.
- The repeat-park re-derivation prose lives canonically in the structural-methodology `backlog-diagnostics` detection cell (one place); `faff-tidy` already delegates. Verified.
- The shipped judgement-eval coverage (FAFF-130 harness + FAFF-147 repeat-park routing eval) is the safety net and does not assert on the *prose method* of derivation. Verified.

## 8. DONE — Definition of Done

### From WHY
- [ ] The structural-methodology repeat-park detection no longer instructs the LLM to "read 50 summaries / classify / count" — that prose is removed.

### From WHAT (interfaces)
- [ ] The detection cell names the call `faff park-history --now <currentDate>` and consumes its `repeat_parked` array (and `counts`).
- [ ] The `faff` executable is referenced via the gateway resolver rule, not a hardcoded path.

### From HOW (behaviour)
- [ ] The 21-day window and ≥3 threshold are attributed to the seam (`window_days` / `threshold`), not restated as prose literals.
- [ ] The root-cause-class cross-reference to the gateway taxonomy / `routing_adaptor` is retained in the cell.
- [ ] The mechanical-fix row notes the qualifying set is the seam's `repeat_parked`, not a re-count; demote behaviour, `repeat-parked` tag, and appetite-gating are unchanged.
- [ ] `faff-tidy` still delegates to `backlog-diagnostics` (it does not call the seam itself); at most a one-line clarifying pointer is added.

### From HOW (edge cases)
- [ ] The cell notes the seam requires `--now` (no ambient clock) and fail-louds (exit 2) on missing `--now` or a malformed parks block.

### From safety net
- [ ] `faff park-history --selftest` still passes (no CLI change).
- [ ] The FAFF-147 repeat-park routing eval still passes against the rewired prose.

confidence: high
