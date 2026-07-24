# CLI hygiene (narrowed): dead exports, entrypoint-doc collapse, price-table staleness guard

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-579.

**Revised 2026-07-24 (autonomous stale-refresh)** — re-grounded against current `main` **HEAD 0ccd321** after a fast-forward pull. The pull landed FAFF-568 (events hash-chain in governance-check), FAFF-595 (de-hooked worktree provisioning), FAFF-592 (harness-coupling doc), FAFF-318, and merged FAFF-538 (the `bin/faff` `COMMANDS`-export drift-guard that was this spec's in-run collision partner). **None of those commits touched the item C/D/E surfaces** (`budget.js`, `resume.js`, `stage.js`, `bin/faff`) — verified via `git diff --stat 8538f77..0ccd321`. **Every line-number citation in this spec was re-verified exact against HEAD 0ccd321** (see the per-item confirmations below). The design, approach, and interfaces are unchanged; the retained `spec-review: approve` stands. FAFF-538's now-merged `COMMANDS` export is a mild tailwind for item D's "derive the USAGE command list from `COMMANDS`" step, not a change to it. Items A and B remain carved out to **FAFF-626** / **FAFF-627** and are **not** re-included here.

_Re-grounding line-number confirmations against HEAD 0ccd321:_ `BUDGET_DIMENSIONS` budget.js:113 def / :1329 export · `RE_ENTERABLE_STATES` resume.js:37 / :320 · `RESUME_REFUSAL_STATES` resume.js:38 / :320 · `selectiveStage` stage.js:100 / :220 · duplicated comment line bin/faff:335 (stray) with the real copy at :337 · longest `USAGE` line = 5,070 chars at bin/faff:157 · `PRICE_PER_MTOK` budget.js:142 · `budgetSelftest` budget.js:1079 · no `PRICE_TABLE_AS_OF` yet. All present and unchanged.

This spec covers the three low-risk hygiene items that remain on FAFF-579 after the two correctness defects were carved out to FAFF-626 (raw NUL byte in `effects.js`) and FAFF-627 (`process.exit` in `readGovernanceConfig`). It is written for the build agent and human reviewers. The three items are structurally independent but share one outcome — **removing latent drift, staleness, and dead weight from the faff CLI's lib + entrypoint** — and each is a small, mechanical, one-sitting change. All three are verified against current `main` (paths under `plugin/skills/faff/`).

## 1. WHY — Problem and Principles

**The load-bearing idea:** the faff CLI already designates a *single, CI-enforced* home for each kind of truth — `docs/guide/cli.md` is the one surface `faff lint-cli-doc` (FAFF-237) checks against the live `COMMANDS` registry. Every other copy of the same information (a header comment, a giant `USAGE` blob, an exported-but-unused constant) is an *unenforced duplicate that drifts by construction*. This work deletes or collapses those duplicates toward the enforced source; it changes no runtime behaviour a user relies on.

**Problem statement.** The CLI accretes three kinds of quiet rot: exported symbols no importer references (dead weight that reads as live API), an entrypoint whose hand-maintained command docs cover a subset of commands and whose `USAGE` string carries a single 5,070-character line, and a spend-governor price table with no freshness anchor that ages silently. None is a correctness bug; each erodes reviewability and trust in the surface. This change removes the dead exports, collapses the entrypoint docs onto the one lint-enforced surface, and gives the price table a dated anchor plus a self-test freshness nudge.

**Design principles.**

- **Collapse toward the enforced source, never add a new unenforced one.** `docs/guide/cli.md` is the CI-gated CLI-doc surface. Any restructure must reduce the number of hand-maintained doc surfaces, not hold them constant or add a fourth. This principle is what rejects a `faff help <sub>` runtime surface (see §3, item D).
- **Deterministic over hand-maintained (gateway governing principle "Deterministic tools over prose").** Where a doc surface must remain in the entrypoint, its command list is *derived from the `COMMANDS` registry*, so it cannot go stale.
- **Preserve documentary intent when deleting documentation-as-code.** Two of the dead constants encode a spec ENUM as their comment. Removing the export must not lose that knowledge — relocate it as an inline comment on the live code path (see §3, item C).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/budget.js` | JS (CommonJS) | Holds two of the dead exports (item C) and the `PRICE_PER_MTOK` table + `budgetSelftest` (item E). |
| `plugin/skills/faff/bin/lib/resume.js` | JS | Holds `RE_ENTERABLE_STATES` / `RESUME_REFUSAL_STATES` (item C). |
| `plugin/skills/faff/bin/lib/stage.js` | JS | Holds `selectiveStage` (item C). |
| `plugin/skills/faff/bin/faff` | JS (entrypoint) | Header comment + `USAGE` + `COMMANDS` registry + the duplicated comment line (item D). |
| `docs/guide/cli.md` | Markdown | The single lint-enforced CLI-doc surface (`faff lint-cli-doc`, FAFF-237). The target of item D's collapse. |

**Scope statement.** This is a maintenance sweep across the faff CLI's `bin/` tree; it touches no delivery-pipeline logic, no contract, and no gate.

## 2. OUT OF SCOPE

- **Items A and B (the correctness defects).** — The raw NUL byte (`effects.js`) and the `process.exit(2)` in `readGovernanceConfig` (`budget.js`). *Why excluded:* carved out to **FAFF-626** and **FAFF-627** by human decision (split comment, 2026-07-23) so the correctness fixes ship promptly and independently, not behind this hygiene work. *Extension point:* those tickets.
- **Rewriting `docs/guide/cli.md`'s content.** — *Why excluded:* it is already the enforced source and is correct by CI; this work points *at* it, it does not rewrite it. *Extension point:* the `lint-cli-doc` surface itself.
- **A per-subcommand help subsystem (`faff help <sub>`).** — *Why excluded:* it would add a new, un-lint-enforced doc surface, violating the collapse principle (see §3 item D rationale). *Extension point:* if ever wanted, it must be *generated* from `docs/guide/cli.md`, not hand-authored — a separate, larger ticket.
- **Repricing the model table or changing the override mechanism.** — *Why excluded:* item E adds a freshness *signal*, not new prices; `resolveEconomicsPriceMap` (the `budget.price_per_mtok_by_model` override) is untouched. *Extension point:* the config override path already exists.

## 3. WHAT — the three changes

### Item C — remove the confirmed dead exports

Four symbols are exported and referenced by **no** importer anywhere in `bin/`, `test/`, or `eval/`. Re-verified on HEAD 0ccd321: each appears exactly twice — at its definition and in its module's `module.exports` line — and nowhere else (whole-tree `grep` including the defining files, so they are unused internally too).

| Symbol | Defined | Exported | Note |
|---|---|---|---|
| `BUDGET_DIMENSIONS` | `budget.js:113` | `budget.js:1329` | `["until","max_attempts","tokens","cost"]` — reads as a dimension enum. |
| `RE_ENTERABLE_STATES` | `resume.js:37` | `resume.js:320` | Comment marks it "spec §3 ENUM"; `classifyReEnterable` does **not** reference it. |
| `RESUME_REFUSAL_STATES` | `resume.js:38` | `resume.js:320` | Same — the refusal-states half of the same §3 ENUM. |
| `selectiveStage` | `stage.js:100` (whole function) | `stage.js:220` | Allowlist-staging function superseded by the live `wipStage`; no caller. |

**Design decision — remove, but preserve documentary intent.** The two `resume.js` constants encode a spec ENUM as documentation-as-code; the park review flagged that some of these "read as spec-enum documentation." Deleting the *export* must not silently drop that knowledge.

- **Chosen:** Remove all four symbols (definition + `module.exports` entry). For the two `resume.js` constants, first confirm the state-set knowledge is documented on the live classifier (`classifyReEnterable`); if it is not already an inline comment there, relocate the "spec §3 ENUM: re-enterable = …; refusals = …" note onto that function before deleting the constants. `BUDGET_DIMENSIONS` and `selectiveStage` carry no knowledge not already live elsewhere and are removed outright. — *Rationale:* a dead export is worse than no export (it reads as live API and invites accidental coupling); the only thing worth keeping is the ENUM comment, which belongs *next to the logic it constrains*, not on an unused constant.

### Item D — collapse the entrypoint docs onto the one enforced surface

Three surfaces describe the CLI's subcommands, and only one is enforced:

- **Header comment** (`bin/faff:4–33`) enumerates a subset of subcommands; the `COMMANDS` registry dispatches far more. It is a *subset*, stale by construction — nothing keeps it in sync.
- **`USAGE` string** (defined `bin/faff:113`) contains single lines up to **5,070 characters** (line 157) and totals tens of KB. On an **unknown subcommand**, the entrypoint writes the *entire* `USAGE` to stderr — a wall of text as an error message.
- **`docs/guide/cli.md`** is the **only** lint-enforced surface: `faff lint-cli-doc` (FAFF-237) asserts, bidirectionally, that it documents every subcommand in the `COMMANDS` registry.

Plus a **duplicated comment line**: `bin/faff:335` and `:337` are both `// Exported pure functions (FAFF-373). Extensionless CJS imported from ESM exposes` (line 336 blank between them) — line 335 is a stray duplicate of the real comment that continues at 337–338. (Re-confirmed at HEAD 0ccd321: the duplication is current, at 335/337.)

**Design decision — this item carries the drop-vs-shrink architecture question.** The question is defensibly resolvable from the codebase's own conventions, so it is a **Chosen**, not a Punt:

- The repo has *already decided* where authoritative CLI docs live: `docs/guide/cli.md`, enforced by `faff lint-cli-doc` (FAFF-237). That is a real, CI-gated convention, not a preference.
- The gateway governing principle **"Deterministic tools over prose"** says a surface that must exist in code should be *derived*, not hand-maintained.
- The existing in-file comment style already carries a short "single public entrypoint / module layout (FAFF-441)" orientation block — a short pointer is consistent with it.

**Chosen:**

1. **Header comment — radically shrink to a pointer, do not drop entirely.** Replace the command enumeration with a few orientation lines that keep the existing "single public entrypoint / module layout" framing and point readers to `docs/guide/cli.md` (and `faff lint-cli-doc` as its enforcer) for the authoritative per-command reference. Keep it, shrunk — dropping it entirely loses first-open orientation that the file's comment style otherwise provides.
2. **`USAGE` — replace the multi-KB reference blob with a compact synopsis whose command list is derived from the `COMMANDS` registry**, so it is drift-proof by construction, and point to `docs/guide/cli.md` for detail. This is what fixes both the 5,070-char line and the multi-KB unknown-subcommand stderr dump in one move.
3. **Do NOT add a `faff help <sub>` runtime surface.** It would be a fourth, un-lint-enforced doc surface — the opposite of collapsing toward the enforced source. Long-form detail stays in `docs/guide/cli.md`. (`faff help` / `-h` / `--help` continue to print the new compact `USAGE`, unchanged in shape.)
4. **De-duplicate** the stray comment line at `bin/faff:335`.

*Rationale:* the drop-vs-shrink debate resolves against the repo's established single-enforced-source convention plus the deterministic-over-prose principle — shrink the two unenforced surfaces so they can't drift (derive the one that must stay from `COMMANDS`), keep a short orientation pointer, and refuse a new surface.

**Anti-pattern:** re-enumerating commands by hand in `USAGE` or the header. Why: that recreates the exact drift this item removes; the command list must come from `COMMANDS`.

### Item E — dated staleness anchor + self-test freshness nudge for the price table

`PRICE_PER_MTOK` (`budget.js:142`) is a 9-model default price table inside the spend governor. Its comment documents dated *model-id-suffix* stripping (`-YYYYMMDD`) but carries **no anchor for the table's own freshness** — there is no "as of" date and no signal when it ages. The config override path (`resolveEconomicsPriceMap`, reading `budget.price_per_mtok_by_model`) exists and is untouched. `budgetSelftest` (`budget.js:1079`) already exists as the natural home for a non-failing freshness check.

**Design decision.**

- **Chosen:** Add a dated anchor constant (e.g. `PRICE_TABLE_AS_OF = "2026-07-23"`) beside `PRICE_PER_MTOK` with a comment explaining it marks when the default prices were last confirmed and that the config override supersedes it, **and** add a **freshness nudge** to `budgetSelftest`: a non-failing check that surfaces a `[warn]`-style notice when the anchor is older than a threshold (guideline 180 days) relative to a passed-in "now". — *Rationale:* the ask is a *freshness signal*, not a correctness gate — stale defaults are a soft risk (the override is the real fix), so the nudge warns, it never fails the selftest. Anchoring the check to an explicit constant + an injectable "now" keeps `budgetSelftest` deterministic (it already uses a fixed `NOW` for its date-sensitive cases).

**Anti-pattern:** making the freshness check *fail* the selftest. Why: it would break CI on the mere passage of time with no code change — a self-inflicted flake; the signal is advisory.

## 4. HOW — Behavior

All three items are mechanical edits; only item E adds logic worth pseudocode.

**Item C.** For each symbol: delete its definition and its entry in the module's `module.exports`. For `resume.js`, before deleting, ensure the §3 ENUM state-sets are documented as an inline comment on `classifyReEnterable`; relocate the note if absent. No behaviour changes — the symbols had no consumers.

**Item D.** Edit `bin/faff` only: shrink the header comment block, replace the `USAGE` template so its command listing is generated from `Object.keys(COMMANDS)` (name-per-line synopsis) plus a pointer line, and remove the duplicate comment at :335. The unknown-subcommand and `help`/`-h`/`--help` paths keep calling `USAGE` — they inherit the smaller output for free.

**Item E** (the one non-trivial procedure):

```
PROCEDURE price_freshness_nudge(now):
  1. days_old = (now - parse(PRICE_TABLE_AS_OF)) / one_day
  2. IF days_old > STALENESS_THRESHOLD_DAYS (180):
     a. Emit a non-failing notice: "price table PRICE_TABLE_AS_OF is <days_old>d old — reconfirm defaults or set budget.price_per_mtok_by_model"
  3. Return pass unconditionally (the nudge never fails the selftest)
```

Wire this into `budgetSelftest` using an injected/known "now" (mirroring its existing fixed-`NOW` pattern) so the check is deterministic in CI.

**Failure mode — the freshness nudge fires spuriously or never.** *The failure:* a threshold that is too tight warns on every run (noise); one anchored to wall-clock `Date.now()` inside the selftest makes the test time-dependent and eventually self-trips in CI. *How you'd know:* the selftest prints the warn line on an unchanged tree, or CI starts warning/failing with no code change. *What it means:* anchor the check to an explicit `PRICE_TABLE_AS_OF` + a passed-in "now" (as chosen), not `Date.now()`, and keep it non-failing — proceed.

## Scenarios

```
Given the faff source tree on main
When a plain-text grep is run for `BUDGET_DIMENSIONS`, `RE_ENTERABLE_STATES`, `RESUME_REFUSAL_STATES`, or `selectiveStage`
Then no match remains anywhere under bin/, test/, or eval/ (definition and export both gone)
```

```
Given the shrunk entrypoint
When `faff <unknown-subcommand>` is run
Then the stderr output is a compact synopsis (well under the previous multi-KB dump) whose listed command names match Object.keys(COMMANDS)
And `bin/faff` contains no single line anywhere near 5,070 characters
```

```
Given budgetSelftest with an injected "now" more than 180 days after PRICE_TABLE_AS_OF
When the selftest runs
Then it emits the freshness warn notice
And still reports overall pass (the nudge is non-failing)
```

- The full test suite (`node --test`) and `faff lint-cli-doc` both pass after all three changes.

## 6. DESIGN DECISION RATIONALE

**Remove the dead exports, or leave them as documentation?** Options: (a) leave — they document enums/intent; (b) remove all, losing the notes; (c) remove, relocating documentary intent to live code. (a) keeps dead API that invites accidental coupling and defeats "referenced nowhere" cleanliness; (b) loses the spec-§3 ENUM knowledge. **Chosen:** (c) — remove all four, relocating the resume-state ENUM note onto `classifyReEnterable` first. Knowledge belongs next to the logic it constrains.

**Entrypoint docs: drop the header, or shrink it, and add `faff help <sub>`?** Options: (a) drop header entirely; (b) shrink header + shrink `USAGE`, no new surface; (c) shrink + add a `faff help <sub>` long-form runtime surface. (a) loses first-open orientation; (c) adds a fourth un-enforced doc surface that will itself drift. **Chosen:** (b) — collapse toward the one lint-enforced surface (`docs/guide/cli.md`), keep a short pointer header, derive the `USAGE` command list from `COMMANDS` (drift-proof), refuse a new surface. Grounded in FAFF-237's established convention and the "deterministic over prose" governing principle. At the time of writing there is no per-subcommand help mechanism; if one is ever wanted it should be *generated* from `cli.md`.

**Price staleness: fail or warn?** Options: (a) selftest *fails* when stale; (b) selftest *warns* when stale. (a) breaks CI on the passage of time with no code change. **Chosen:** (b) — advisory warn only; the config override (`budget.price_per_mtok_by_model`) is the real remedy, so the table aging is a soft risk deserving a nudge, not a gate.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the one architecture question (item D drop-vs-shrink) is resolved above from codebase convention.

**Assumptions:**

- **Assumes:** `docs/guide/cli.md` remains the lint-enforced CLI-doc surface (`faff lint-cli-doc` / FAFF-237). *Validate:* confirm the `lint-cli-doc` subcommand and the doc file exist before pointing the header/USAGE at them (both present on HEAD 0ccd321 — `lint-cli-doc` wired at bin/faff:78/281, doc file present).
- **Assumes:** `classifyReEnterable` in `resume.js` is the live consumer of the re-enterable/refusal state logic. *Validate:* read `classifyReEnterable` before deleting the constants; relocate the ENUM comment onto it if not already documented there.

## 8. DONE — Definition of Done

### From WHY
- [ ] No hand-maintained CLI-doc surface duplicates `docs/guide/cli.md` except a short pointer + a `COMMANDS`-derived synopsis.

### From WHAT / HOW — item C
- [ ] `BUDGET_DIMENSIONS` removed from `budget.js` (definition + export); grep finds it nowhere under bin/ test/ eval/.
- [ ] `RE_ENTERABLE_STATES` and `RESUME_REFUSAL_STATES` removed from `resume.js` (definitions + export); grep-clean.
- [ ] The re-enterable/refusal spec-§3 ENUM knowledge is present as an inline comment on `classifyReEnterable` (relocated if it was not already there).
- [ ] `selectiveStage` removed from `stage.js` (function + export); grep-clean.

### From WHAT / HOW — item D
- [ ] The `bin/faff` header comment no longer enumerates individual subcommands; it points to `docs/guide/cli.md` (+ `faff lint-cli-doc`).
- [ ] `USAGE` contains no single line near 5,070 chars; its command list is derived from `Object.keys(COMMANDS)`.
- [ ] `faff <unknown-sub>` stderr output is a compact synopsis, well under the previous multi-KB dump.
- [ ] No `faff help <sub>` per-subcommand runtime surface was added.
- [ ] The duplicated comment line at `bin/faff:335` is removed (single copy remains at what was :337).
- [ ] `faff lint-cli-doc` passes.

### From WHAT / HOW — item E
- [ ] A dated `PRICE_TABLE_AS_OF` anchor constant sits beside `PRICE_PER_MTOK` with an explanatory comment.
- [ ] `budgetSelftest` emits a non-failing freshness warn when a passed-in "now" exceeds the anchor by the threshold, and reports pass regardless.
- [ ] `resolveEconomicsPriceMap` and the price values are unchanged.

### Whole change
- [ ] `node --test` passes across the suite.

**Integration smoke test:**

```
1. Run `faff budget --selftest` → exit 0 (freshness nudge, if any, is advisory).
2. Run `faff lint-cli-doc` → PASS.
3. Run `faff bogus-subcommand` → exit 2, compact stderr synopsis.
4. grep the four dead symbols across bin/ test/ eval/ → no matches.
```

## Methodology critique

*(agile-delivery lens — issue-critique)*

- **Right-sized?** Yes. The five-item bundle was split by human decision; the two correctness defects (A/B) are now FAFF-626/627, leaving three homogeneous, low-risk, mechanical hygiene edits. Together they are comfortably a single sub-one-day unit. The earlier park's principle-4 objection was about *mixed severity that could not be sequenced honestly* (correctness behind a doc debate) — that heterogeneity is exactly what the split removed. No further split is warranted; the human already made the sequencing call on the control surface.
- **Workstream fit / cohesive?** Yes, now. With A/B gone, C/D/E share one real outcome — "remove latent drift/staleness/dead-weight from the CLI surface" — rather than the original catch-all "CLI hygiene" label spanning correctness and cosmetics.
- **Deps surfaced?** No hidden deps. C/D/E are independent of FAFF-626/627 (different files/lines; the split comment confirms non-overlap). No blocker links needed. The in-run `bin/faff` collision partner FAFF-538 has now **merged** (PR #464, 2026-07-23), so the collision hold that parked this last run no longer applies.
- **Risk profile?** Low. No novel integration, no external dep, no schema/API/security surface. Item E's only trap (time-dependent selftest) is called out and designed around. No de-risking spike needed.

confidence: high
spec-review: approve (single-pass — architectural / infosec / methodology / QA; no objections; re-affirmed 2026-07-24 autonomous on the re-grounded spec — no design change from the 2026-07-23 approve)