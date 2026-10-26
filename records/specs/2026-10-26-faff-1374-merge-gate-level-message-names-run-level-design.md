# FAFF-1374 — Interpolate the run's resolved level into the merge-gate integrity-unasserted refusal message

> Spec: faffter-dark-nlspec · 2026-10-24 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1374.

This spec is for the build agent and human reviewers. It describes a two-line correction to the merge-gate floor code plus a level-pinning test, so an operator never again reads a hardcoded "at L4" on an L2 or L3 run.

## 1. WHY — Problem and Principles

**The load-bearing model.** The merge floor refuses an unasserted corrective-artifact integrity attestation from pure decision code (`decideFloor`) and from the already-merged retrospective path (`alreadyMergedReconcile`). Both already hold the run's resolved autonomy level in hand — but each prints a hardcoded `at L4` in the refusal text instead of interpolating that level.

**Problem statement.** The refusal message hardcodes `at L4` at two sites; an operator on an L2 or L3 run reads that as their run's level, mis-diagnoses the refusal, and (as recorded against FAFF-1111, Symptom 3) loses the real reason. This change makes the message name the run's actual resolved level while keeping the L4 reading unchanged.

**Design principles.**

- **Interpolate the already-resolved level; add no new plumbing.** The level is in scope at both sites. The fix is a template-literal substitution, not a new resolver, parameter, or lookup. An implementation that threads a new `level` argument through `decideFloor` or re-reads the ledger here should be rejected — the value is already present.
- **Preserve the L4 reading byte-for-byte.** On an L4 run the message must still read `at L4`. The existing tests pin this and operators expect it; any change that alters the L4 output is wrong.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/contract-defs-floor.js` | JavaScript (committed emit) | `decideFloor(f)` — the pure merge-floor core; one refusal site, and `resolveGateLevel` lives here |
| `plugin/skills/faff/bin/lib/merge-gate-floor.js` | JavaScript (committed emit) | `alreadyMergedReconcile(...)` — the already-merged retrospective floor; the sibling refusal site |
| `test/merge-gate-selftest.js`, `test/merge-gate-controlflow.test.mjs` | JavaScript tests | Where the existing L4 message assertions live and where the new non-L4 pin belongs |

**Scope statement.** This sits inside the merge-gate floor-decision layer; it changes refusal *wording only*, never which refusals fire.

## 2. OUT OF SCOPE

- **The `--describe` enum prose at `contract-defs-describe.js:58`** (`"...blocks merge at L4"`). Why excluded: it is static documentation of the holdout enum's general L4-specific semantics, not a per-run refusal naming an actual resolved level. Extension point: `contract-defs-describe.js` if describe prose ever needs per-run interpolation (it does not here).
- **The integrity-`violated` blocker** (`"...refused at every level"`). Why excluded: it is already level-agnostic and correct. Extension point: none needed.
- **Level resolution itself** (`resolveGateLevel`, `resolveAnchorLevel`). Why excluded: this change *consumes* the resolved level; it never alters how the level is resolved. Extension point: `contract-defs-floor.js` / `merge-gate-floor.js` resolvers, untouched here.
- **A `docs/guide/cli.md` prose edit.** Why excluded: verification (grep for `at L4` / `unasserted` / `corrective-artifact` / `FAFF-325` across `docs/guide/cli.md`) found none of the stale wording present — the ticket's cited "row 95" is the unrelated `corrective` command row. There is no stale doc prose to interpolate. Extension point: `docs/guide/cli.md` — see the DONE verification item, which keeps this honest by re-checking.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| resolved level | The run's authoritative autonomy level (`L1`–`L4`), produced by `resolveGateLevel(ledgerLevel, flagLevel)` |
| refusal message | The human-facing blocker string pushed onto the floor's `blockers` / `reasons` array when integrity is `unasserted-refuse` |

**The two refusal sites and their in-scope level values.**

- `decideFloor(f)` in `contract-defs-floor.js` reads `f.level` already (the holdout-posture back-compat default two lines above the refusal). The refusal string interpolates `f.level`.
- `alreadyMergedReconcile(emit, runDir, issue, pr, headSha, level, integrity)` in `merge-gate-floor.js` receives `level` as its 6th positional parameter, passed by its sole caller (`merge-gate.js`, which has just computed `{ level } = resolveGateLevel(...)`). The refusal string interpolates `level`.

**Design decision — where to read the level.**

Both candidate values (`f.level`, `level`) are already in scope at their respective sites; no alternative requires new plumbing.

**Chosen:** interpolate `f.level` in `decideFloor` and the `level` parameter in `alreadyMergedReconcile`. No new parameter, resolver, or ledger read is added.

**Design decision — the ticket's open question: what renders when the run has no resolved level (e.g. an interactive graft with no run substrate).**

Options weighed: (a) rely on `resolveGateLevel`'s existing `|| "L3"` fallback; (b) add a defensive placeholder such as `"the resolved level"` when the value is falsy; (c) treat the no-level state as structurally unreachable and not special-case it.

Evidence from the code (a matter of fact, not taste): `resolveGateLevel` never returns a null level — absent both a ledger level and a `--level` flag it returns `flagLevel || "L3"`, i.e. `"L3"`. Both production callers (`merge-gate.js`, `merge-gate-local.js`) resolve and validate the anchor level and fail loud (exit 2) on any non-`ok` anchor status *before* these sites run. The contract-CLI wrapper `computeIntegrityFloor` fail-louds when `level` is not in `FLOOR_LEVELS` *before* `decideFloor` runs. So the value interpolated into the message is always a valid `FLOOR_LEVELS` member.

**Chosen:** interpolate the resolved level directly, adding no new fallback branch. `resolveGateLevel`'s `|| "L3"` default already answers "what renders when nothing is resolved" (it renders `L3`), and `computeIntegrityFloor`'s `FLOOR_LEVELS` validation guarantees a valid level at the contract-CLI entry; a placeholder branch would be unreachable dead code. This closes the ticket's open question.

## 4. HOW — Behavior

**`decideFloor` (`contract-defs-floor.js`), the `f.integrity === "unasserted-refuse"` branch.** Replace the hardcoded `at L4` in the pushed blocker with the interpolated `f.level`:

```
# before: "corrective-artifact integrity unasserted at L4 (FAFF-325): ..."
# after:  `corrective-artifact integrity unasserted at ${f.level} (FAFF-325): ...`
# the trailing parenthetical ("no trusted attestation declaration — refused ...") is unchanged
```

**`alreadyMergedReconcile` (`merge-gate-floor.js`), the `integrity.state === "unasserted-refuse"` branch.** Replace the hardcoded `at L4` in the pushed reason with the interpolated `level` parameter:

```
# before: "corrective-artifact integrity unasserted at L4"
# after:  `corrective-artifact integrity unasserted at ${level}`
```

No other behaviour changes. The condition that fires each refusal is untouched; only the string content changes.

**Anti-pattern:** adding a `level` argument to `decideFloor`. Why: `f.level` is already a field on the object `decideFloor` reads, so a new argument is redundant plumbing.

**Anti-pattern:** adding a `|| "L3"` (or placeholder) fallback at the message site. Why: the level is already guaranteed non-null by `resolveGateLevel` and validated by `computeIntegrityFloor`, so the branch would be unreachable dead code.

## 5. SCENARIOS

```
Given an unattended run resolved to L3 with corrective-artifact integrity unasserted-refuse
When the merge floor is decided (decideFloor / alreadyMergedReconcile)
Then the refusal blocker text reads "...unasserted at L3..." and never "at L4"
```

```
Given a run resolved to L4 with corrective-artifact integrity unasserted-refuse
When the merge floor is decided
Then the refusal blocker text still reads "...unasserted at L4..."
```

These two scenarios are exactly the ≥2-level message pin the acceptance criteria require.

## 6. DESIGN DECISION RATIONALE

**Where to read the level at each site?** Options: thread a new argument vs use the in-scope value. **Chosen:** use the in-scope `f.level` (decideFloor) and `level` parameter (alreadyMergedReconcile) — rationale: the value is already present at both sites, so interpolation is a one-token change with no new plumbing and no new failure surface.

**What renders with no resolved level (the ticket's open question)?** Options: existing `|| "L3"` fallback / defensive placeholder / unreachable. **Chosen:** interpolate directly, no new fallback — rationale: `resolveGateLevel` (`flagLevel || "L3"`) and `computeIntegrityFloor` (`FLOOR_LEVELS` validation) already guarantee a valid non-null level at both reachable entry points, so any placeholder branch is dead code. At the time of writing, no caller reaches `decideFloor` / `alreadyMergedReconcile` with a falsy level; revisit if a future caller bypasses `resolveGateLevel`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The ticket's sole open question (no-resolved-level source) is resolved above as a `**Chosen:**` decision on the strength of the code's existing guarantees — a factual resolution, not a deferred judgement call.

**Assumptions.**

- **Assumes:** the two refusal sites above are the only operator-facing merge-gate refusal messages that hardcode `at L4`. Validation before build: re-grep `at L4` across `plugin/skills/faff/bin/lib/contract-defs-*.js` and `merge-gate-*.js`; confirm the only other hit is the static `contract-defs-describe.js` enum prose (out of scope) and that no new site has appeared since this spec was written.

## 8. DONE — Definition of Done

### From WHAT (the level-read decision)
- [ ] `decideFloor`'s `unasserted-refuse` blocker interpolates `f.level` instead of the literal `L4`
- [ ] `alreadyMergedReconcile`'s `unasserted-refuse` reason interpolates the `level` parameter instead of the literal `L4`

### From HOW (behaviour)
- [ ] An `unasserted-refuse` refusal on an L2 or L3 run names that level (e.g. `decideFloor({ ..., level: "L3", integrity: "unasserted-refuse" })` blocker contains `at L3`)
- [ ] An `unasserted-refuse` refusal on an L4 run still reads `at L4` (existing `/unasserted at L4/` assertions remain green)

### From the acceptance criteria (test)
- [ ] A test pins the refusal message text for at least two levels — the existing L4 assertion plus a new non-L4 (L2 or L3) assertion. Natural homes: `test/merge-gate-selftest.js` (next to the existing L4 `decideFloor` check) for the pure core, and `test/merge-gate-controlflow.test.mjs` for `alreadyMergedReconcile` via a non-L4 anchor fixture
- [ ] The committed `.js` emit is rebuilt only if a `.ts` source changed (these two files are plain `.js`; no rebuild expected)

### From OUT OF SCOPE (docs verification — keeps the stale AC honest)
- [ ] Verified by grep that no stale `at L4` merge-gate refusal wording remains in `docs/guide/cli.md`; if any is found, correct it to match the interpolated message. (At spec time: none present — the cited row 95 is the unrelated `corrective` command.)

### Regression floor
- [ ] `test/merge-gate-selftest.js`, `test/merge-gate-controlflow.test.mjs`, `test/merge-gate-local.test.mjs`, and `test/faff-895-pr-custody-basis.test.mjs` all stay green (byte-identical L4 behaviour)

**Integration smoke test.**

```
Run the merge-gate selftest (node plugin/skills/faff/bin/lib/merge-gate-selftest.js, or `faff` merge-gate --selftest):
  - the existing "unasserted-refuse names the FAFF-325 blocker" check at level L4 still matches /unasserted at L4/
  - the new level-L3 check matches /unasserted at L3/
If both pass, the interpolation is wired through the pure core.
```

confidence: high
build-tier: standard

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** Yes. A single, coherent 1-unit change — two one-line string edits plus one test — well under a day. No independent concerns to split; nothing to merge.
- **Workstream fit?** Clean. Split out of FAFF-1111 by operator decision, where the FAFF-1111 spec review found it independent of the `faff ship-parked` verb and worth shipping first on its own. Loose in Backlog with no project, which is appropriate for a standalone operator-legibility fix.
- **Deps surfaced?** No implicit dependencies. The change consumes an already-resolved value and touches only refusal wording; it blocks nothing and is blocked by nothing. No blocker edge is missing.
- **Risk profile?** Low. Pure string interpolation inside well-tested, pure floor-decision code, with existing L4 assertions acting as a regression net. No novel integration, no external dependency, no de-risking spike warranted.
