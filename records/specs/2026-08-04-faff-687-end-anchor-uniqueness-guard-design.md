# FAFF-687 — End-anchor uniqueness guard for the eval CLI-driver

> Spec: faffter-dark-nlspec · 2026-08-03 · autonomous · confidence: high. Full spec on Linear FAFF-687.

This spec is for the build agent (and human reviewers) implementing FAFF-687. It adds a test-only guard so the eval CLI-driver's section **end** anchors get the same protection against silent mis-slicing that FAFF-669 gave the **start** anchors. No production loader behaviour changes.

## 1. WHY — Problem and Principles

The driver slices each rubric out of a shipped SKILL.md by two string anchors, and it always takes the **first** match: `extractSection` computes the end boundary as `md.indexOf(endAnchor, startPos)`. So the section a loader returns is whatever sits between the start anchor and the *first* end-anchor occurrence after it. That "first match wins" rule is the one idea this whole guard turns on.

**Problem statement.** FAFF-669 proved that a start anchor appearing more than once silently sliced the wrong prose — nothing threw, every check stayed green, and the eval measured a rubric it was never meant to see. It fixed that with a class-level test asserting every start anchor occurs exactly once in the file its loader reads. End anchors got no equivalent, so the mirror-image trap is still open: a new occurrence of an end-anchor string landing between a section's start and its true end silently **truncates** the rubric, with the same "still runs, still scores, no longer measures the right thing" blast radius.

**This is prevention, not a repair.** There is no live instance today. The reason to do it now is the count: the start-anchor version of this bug was fixed four separate times (FAFF-284, FAFF-317, FAFF-319, FAFF-669) before it got a guard. The end-anchor side should not wait for its fourth recurrence.

**Design principles.**

**The guard must keep protecting every anchor, not just the well-behaved ones.** An invariant that has to exempt an anchor to stay green leaves that anchor unguarded — the one place a regression could still slip through unseen. Prefer an invariant that accommodates a legitimate quirk while still firing on a real regression at that same anchor.

**Safe-direction over minimal.** Mirroring the start-anchor check, a false positive costs one conscious re-look at an anchor; a false negative costs a silently-wrong measurement for tickets on end. When the two trade off, be stricter.

**One registry, or it rots.** The start check already carries a hand-maintained registry with a forcing-function test so it can't go stale. The end check must ride the *same* registry, so a loader added later is covered by both checks or by neither — never by one.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/cli-driver.mjs` | JavaScript (ESM) | Declares the `*_START` / `*_END` anchor consts and `extractSection` / `extractSectionToEnd` / `sliceAnchored`. Read-only for this ticket. |
| `test/eval-cli-driver.test.mjs` | JavaScript (node:test) | Home of the FAFF-669 start-anchor guard (`ANCHOR_REGISTRY`, the uniqueness test, the coverage forcing-function). All of this ticket's work lands here. |
| `plugin/skills/*/SKILL.md` | Markdown | The shipped prose each loader slices. The anchors are headings/fragments in these files. |

**Scope statement.** This sits in the eval harness's static-guard layer — the tests that catch anchor drift before a run measures the wrong prose — alongside FAFF-669's start-anchor uniqueness test.

## 2. OUT OF SCOPE

- **Rewriting `extractSection` / `extractSectionToEnd` / `sliceAnchored`.** — Why excluded: the loaders are correct today; this ticket guards them, it does not change them. Extension point: any behavioural change to slicing is its own ticket against `eval/cli-driver.mjs`.
- **Re-pointing or hardening any anchor value.** — Why excluded: no anchor is wrong today (the empirical scan below confirms all 27 end anchors resolve correctly). Extension point: an anchor that a future SKILL.md edit breaks is fixed at its const in `eval/cli-driver.mjs`, and this guard is what will flag it.
- **The ladder refactor (parallel if-else ladders → per-kind registry table).** — Why excluded: named as a follow-up in FAFF-669's spec and not yet landed (the if-else ladders are still present in `eval/cli-driver.mjs` at this commit). Extension point: when it lands, the start+end registry rows fold into that table; see the note in §4.
- **A start-anchor for `loadAdrDriftProse`.** — Why excluded: it deliberately uses `extractSectionToEnd` (slices start→EOF, no end anchor) because its section is the last in its file; its end-drift is bought back by a content assertion. The guard must *account* for this asymmetry, not erase it.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Anchor | The literal string a loader passes to `indexOf` to find a section boundary. Declared as a `const NAME_START` / `const NAME_END` in `eval/cli-driver.mjs`. |
| After-start window | For one loader, the file text from the position of its start anchor to end of file — i.e. `md.slice(startPos + startAnchor.length)`. This is exactly the region `indexOf(endAnchor, startPos)` searches. |
| Registry row | One entry in `ANCHOR_REGISTRY`, keyed by a `*_START` const name. Two-source loaders (which read two files) own two rows, one per start/end pair. |
| Expected end-count | The number of times a row's end anchor legitimately occurs in that row's after-start window today. Defaults to 1; a documented row may override it. |

**The registry shape (evolved from FAFF-669).** FAFF-669's `ANCHOR_REGISTRY` maps a `*_START` const name to a skill-directory string. To carry the end check on the same registry (principle: one registry), evolve each value from a bare string into a record. The start anchor and end anchor of any one pair live in the **same** file, so a single `skill` field serves both checks in that row.

```
RECORD RegistryRow:
  skill: string          # plugin/skills/<skill>/SKILL.md — the file BOTH this row's start and end anchor live in
  end: string | null     # the paired *_END const NAME, or null for the one extractSectionToEnd loader
  endCount: int          # expected occurrences of `end`'s value in the after-start window; DEFAULT 1, omit unless overridden

  CONSTRAINT endCount >= 1
  CONSTRAINT end == null  IFF  the keyed start belongs to a loader that uses extractSectionToEnd
```

The registry is keyed by the `*_START` const name, exactly as today. Each two-source loader keeps its two separate keys (e.g. `REVIEW_VERDICT_START` and `GATEWAY_VERDICT_START`), and each such key now also names its own paired end anchor in its own file.

**Design decision — one shared registry vs. a second parallel map.** Acceptance criterion 3 asks the end check to *share* the start registry, not maintain a second list. Two shapes were considered:

- **(a) One registry, richer rows** — evolve each value to `{ skill, end, endCount }`. One row per start/end pair covers both checks; adding a loader is one row.
- **(b) Two maps + a binding test** — keep `ANCHOR_REGISTRY` as-is, add `END_ANCHORS`, and assert the key-sets correspond. Still two hand-lists that can drift between edits; the binding test only catches the drift after the fact.

**Chosen:** (a) one registry with richer rows — rationale: it satisfies "shares the registry rather than maintaining a second list" literally, and makes "covered by both or by neither" structural (a row either exists or it doesn't) rather than something a separate test has to reconcile. The cost is updating the existing start test's destructuring from `[name, skill]` to reading `row.skill`; that is a one-line change in the same module.

## 4. HOW — Behavior

**The invariant.** For each registry row whose `end` is not null: locate the start anchor, then assert the end anchor's value occurs in the after-start window **exactly `endCount` times** (default 1).

```
PROCEDURE assert_end_anchor(row, startConstName):
  md        := read plugin/skills/<row.skill>/SKILL.md
  startVal  := anchorValue(startConstName)        # parsed from driver source, as today
  endVal    := anchorValue(row.end)
  startPos  := md.indexOf(startVal)
  window    := md.slice(startPos + startVal.length)
  ASSERT occurrences(window, endVal) === (row.endCount ?? 1),
         message names the loader/anchor: "<row.end> occurs <n>x after <startConstName> in
         <row.skill>/SKILL.md, expected <endCount> — extractSection would silently truncate"
```

**Why after-start-window count, and why against an expected number.** The bug is a *future* duplicate inserted between a section's start and its true end. A test on today's tree cannot know the "intended" end independently of the anchor, so it cannot check the current slice in isolation — within `[start, firstEnd]` the end anchor always appears exactly once, by construction, so that window can never reveal an inserted duplicate. The region that *can* reveal one is the same region `indexOf` searches — start to EOF. Counting occurrences there against a known-good expected number is the exact mirror of the start check counting occurrences in `[0, EOF]` against 1. Any duplicate inserted into a guarded section bumps the count above `endCount` and fires, naming the loader and anchor.

**Why an expected-count and not a blanket "exactly once".** An empirical scan of all 27 end anchors (counting occurrences in each loader's after-start window) found 26 satisfy exactly-once but **one does not**: `SPLITTABLE_END` (`"#### Chain gaps"`) occurs twice — once as the real heading at `faff-tidy/SKILL.md:166` (the correct boundary, taken by first-match) and once as a harmless prose cross-reference at `:178` (`the` `#### Chain gaps` `heading`), which sits *after* the section's true end and so never truncates it. A blanket exactly-once assertion would be born red on this legitimately-correct anchor. Two ways out were considered:

- **Exempt `SPLITTABLE_END`** from the count check and lean on a content assertion instead (the pattern the "three raw anchors" test and `loadAdrDriftProse`'s content buy-back already use). This works, but it *surrenders the count guard for that one anchor* — the exempted anchor is then the single place an inserted duplicate could still pass unseen.
- **Per-row expected-count** (default 1, `SPLITTABLE_END` row carries `endCount: 2`). Every anchor including `SPLITTABLE_END` keeps a live count guard; inserting a duplicate inside *any* section, that one included, pushes its count above its expected value and fires.

**Chosen:** per-row expected-count — rationale: it keeps every anchor guarded (principle: keep protecting every anchor), it is strictly a superset of the exemption approach's coverage, and the override is self-documenting (one row carries `endCount: 2` with a comment pointing at the `:178` cross-reference). It is stricter than strictly necessary — a *harmless* duplicate added after a section's true end also fires — but that is the same safe-direction over-strictness the start-uniqueness check already accepts: a false positive is one conscious re-look, and forcing that re-look on any change to the anchor's occurrence count is the point.

A third option — count within `[start, next-registered-start-in-the-same-file]` — was rejected: most end anchors are arbitrary headings that do not coincide with the next registered start, so the window rarely matches the true section, making the check both more complex and less clearly correct than the after-start-window count.

**The extractSectionToEnd asymmetry.** There are 27 `*_END` consts but 28 `*_START` consts; `loadAdrDriftProse` is the one loader with no end anchor. Its registry row carries `end: null` and the end check skips it. This is not left implicit — a forcing-function (below) asserts exactly one row has `end: null` and it is `ADR_DRIFT_PROSE_START`, so a future loader that forgets its end anchor cannot hide in the same gap.

**Coverage forcing-functions (so the registry can't rot).**

```
PROCEDURE assert_registry_covers_end_anchors():
  declaredEnds := match /const (\w+_END) = / over the driver source   # expect 27
  registered   := every non-null row.end across ANCHOR_REGISTRY
  ASSERT set(declaredEnds) === set(registered)                        # every end anchor is on exactly one row
  ASSERT count(rows with end == null) === 1
  ASSERT the single null-end row's key === "ADR_DRIFT_PROSE_START"
```

This mirrors FAFF-669's existing "the registry covers every start-anchor constant declared in the driver" test (which asserts 28 start consts): a new end anchor added to the driver with no registry row turns the suite red.

**Failure modes.**

- **The failure:** the `endCount: 2` override quietly masks a *real* future duplicate on `SPLITTABLE_END` — someone inserts a genuine mid-section duplicate and the count rises 2→3, but a reviewer later "fixes" the red by bumping `endCount` to 3 instead of investigating. **How you'd know:** the override carries a comment naming the exact expected occurrences (`:166` heading + `:178` cross-reference); a bump beyond 2 has no third legitimate site to cite. **What it means:** proceed — the guard still fires on the regression; the residual risk is a careless reviewer, which the cited-sites comment is there to stop, same as any expected-count.
- **The failure:** the ladder refactor lands first and moves the anchors into a per-kind table, orphaning this registry. **How you'd know:** the coverage forcing-functions go red (declared consts no longer match the rows). **What it means:** narrow — fold the `{ end, endCount }` fields into the table row at that point; the note below flags the ordering.

**Ladder-refactor ordering (from the ticket note).** The per-kind registry-table refactor named in FAFF-669's spec has **not** landed at this commit. So the end registry stays a hand-maintained parallel list for now, exactly as the start registry already is, and carries the same "folds into the table when the ladder refactor lands" comment the start registry carries — so whoever does that refactor moves both together.

**Anti-pattern:** adding a standalone `END_ANCHOR_REGISTRY` object next to `ANCHOR_REGISTRY`. Why: it is the "second list that drifts" acceptance criterion 3 rules out; the end info belongs on the existing rows.

**Anti-pattern:** demonstrating the red by editing a real `plugin/skills/*/SKILL.md` on disk. Why: it dirties the tree and races other tests reading the same file; inject into an in-memory copy of the file's text instead (§Scenarios).

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the current tree, with every end anchor resolving correctly
When the end-anchor uniqueness test runs over ANCHOR_REGISTRY
Then every non-null row passes: its end anchor occurs exactly endCount times in its after-start window (SPLITTABLE_END's row expects 2, all others 1)
```

```
Given a copy of a guarded SKILL.md text with a duplicate of one section's end-anchor string spliced in between that section's start and its true end
When the same occurrences-after-start check runs against that modified text
Then it reports a mismatch (observed count exceeds the row's endCount) and the failure message names the loader/anchor and the file
```

```
Given the driver declares a new *_END const with no matching registry row
When the coverage forcing-function runs
Then it fails, because the set of declared end consts no longer equals the set of registered row ends
```

## 6. DESIGN DECISION RATIONALE

**Which invariant genuinely prevents silent end-anchor truncation?**
- *Blanket exactly-once in the after-start window* — simplest, mirrors the start check; but born red on `SPLITTABLE_END`'s legitimate downstream duplicate.
- *Exactly-once with `SPLITTABLE_END` exempted + content assertion* — green, precedented; but surrenders the count guard for the one anchor that already has a duplicate.
- *Per-row expected-count (default 1)* — green on all 27, keeps every anchor guarded, self-documenting override.
- *Window bounded by the next registered start* — handles `SPLITTABLE_END` at expected 1, but windows rarely match true section ends; more complex, less clearly correct.

**Chosen:** per-row expected-count in the after-start window — it is the only option that stays green today *and* keeps a live count guard on every anchor, at the cost of accepting the same safe-direction over-strictness the start check already accepts.

**Where does the end check live — same registry or a companion map?**
- *Companion map + binding test* — least churn to existing rows; but two hand-lists that can drift.
- *Evolve `ANCHOR_REGISTRY` rows to `{ skill, end, endCount }`* — one list, structural "both or neither" coverage.

**Chosen:** evolve the rows — satisfies acceptance criterion 3 literally; the only cost is a one-line destructuring change in the existing start test.

Temporal anchor: at this commit the ladder-refactor follow-up has not landed, so the registry stays a hand-maintained list. When that refactor arrives, the `end` / `endCount` fields fold into its per-kind table row.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The one genuine design fork (which invariant) is decided above with its reasoning recorded, per the ticket's explicit ask.

**Assumptions.**

- **Assumes:** the FAFF-669 start-anchor guard (`ANCHOR_REGISTRY`, `anchorValue`, `occurrences`, the two coverage tests) is present in `test/eval-cli-driver.test.mjs` as described. Validation: before starting, grep the test file for `ANCHOR_REGISTRY` and `every registered start anchor occurs exactly once`; both must be present. (Confirmed present at this commit.)
- **Assumes:** all 27 end anchors resolve correctly on the current tree, so the new test is green on first run (only `SPLITTABLE_END` needs a non-default `endCount`). Validation: run the new test after wiring it; a red on any row other than a deliberate injection means an anchor has already drifted and is a real find to report, not a test bug.

## 8. DONE — Definition of Done

### From WHY
- [ ] End anchors have a class-level guard that fires when a duplicate end-anchor string is inserted between a section's start and its true end.

### From WHAT (registry)
- [ ] `ANCHOR_REGISTRY` rows carry the paired end anchor and an optional expected end-count; the start-anchor tests still pass against the evolved shape.
- [ ] The registry remains a single shared structure — no second parallel end-anchor list is introduced.

### From HOW (behaviour)
- [ ] For every registry row with a non-null end, the end anchor occurs exactly `endCount` (default 1) times in that row's after-start window; the test is green on the current tree.
- [ ] `SPLITTABLE_END`'s row carries `endCount: 2` with a comment citing the two legitimate occurrence sites (`faff-tidy/SKILL.md:166` heading, `:178` cross-reference).
- [ ] A coverage forcing-function asserts every `*_END` const declared in the driver (27) is on exactly one registry row.
- [ ] A forcing-function asserts exactly one row has a null end and it is `ADR_DRIFT_PROSE_START` (the sole `extractSectionToEnd` loader).
- [ ] The end registry carries the same "folds into the per-kind table when the ladder refactor lands" note as the start registry.

### From HOW (demonstrated red)
- [ ] A test demonstrates the guard firing: an in-memory copy of a guarded SKILL.md with a duplicate end-anchor spliced inside a section makes the occurrences-after-start check report a mismatch that names the loader/anchor. No real SKILL.md file is edited on disk.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Run `node --test test/eval-cli-driver.test.mjs`
  2. Expect: all pre-existing FAFF-669 tests green (registry shape change didn't break them)
  3. Expect: the new end-anchor uniqueness test green; the two coverage forcing-functions green
  4. Expect: the demonstrated-red test green (it asserts the check FIRES on injected input)
```

## Already shipped against this surface

Scan of Done tickets in the Skill-behaviour harness project touching the eval driver / anchor machinery. Related context, not superseding — the premise holds.

- **FAFF-669** (Done, 2026-08-01) — *Arm the four unarmed eval kinds; add the start-anchor uniqueness guard.* This is the direct paired sibling: it built the `ANCHOR_REGISTRY` + start-anchor uniqueness test this ticket extends. It explicitly did **not** guard end anchors — FAFF-687 is the other half of that pair, named in FAFF-669's own writeup. Nothing to redo; this ticket builds on top of it.
- **FAFF-284 / FAFF-317 / FAFF-319** (Done) — the prior recurrences of the *start*-anchor mis-slice bug. Context for why a preventative end-anchor guard is worth landing now rather than after a fourth end-side recurrence. None delivered any end-anchor check.

No Done ticket delivers an end-anchor uniqueness guard. Premise still load-bearing → proceed.

## Methodology critique

Agile-delivery lens (issue-critique), applied by prep. Advisory in autonomous mode — does not gate promotion.

- **Right-sized?** Yes. One cohesive concern (end-anchor silent-truncation guard), a single 1–3 day test-only unit. The registry-shape change, the expected-count invariant, and the two coverage forcing-functions are one indivisible piece of work — splitting them would leave a half-guard. No split, no merge.
- **Workstream fit?** Clean. Sits in the eval static-guard workstream directly beside FAFF-669, in the outcome-named "Skill-behaviour harness" project.
- **Deps surfaced?** One implicit dependency: the FAFF-669 start-anchor guard must be in place — it is (Done/merged), so no blocker link is needed, and the spec's Assumptions validate it at build start. The ladder-refactor follow-up is a soft ordering note (§4), not a blocker.
- **Risk profile?** Low. No novel integration, no external dependency, no runtime surface — a test against in-repo prose. No de-risking spike warranted.

No issues.

confidence: high
