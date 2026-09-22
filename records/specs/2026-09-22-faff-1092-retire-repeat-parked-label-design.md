# Retire the `faff-repeat-parked` control-label (keep the `repeat-parked` verdict)

> Spec: faffter-dark-nlspec · 2026-09-22 · autonomous · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-1092.

This spec is for the build agent implementing FAFF-1092, and for the human reviewers gating it. It describes a small, mechanical removal: deleting one inert control-label role and every write-site and doc reference that applies or describes it, while leaving the identically-named routing verdict completely untouched. Read the WHY's opening model first — the whole spec turns on one name meaning two unrelated things.

## 1. WHY — Problem and Principles

**The load-bearing model.** The string `repeat-parked` names two independent things in this codebase. One is a **control LABEL** (`faff-repeat-parked`), a role in `CONTROL_LABEL_DEFS` (`labels.js`), applied to a tracker issue on a repeat-park demotion. The other is a **routing VERDICT** (`repeat-parked`), a token in `ROUTING_VERDICTS` (`contract-defs.js`), assigned to an issue by the routing slot and rendered by `/faff-wtf`. They share a name but nothing else: no code path derives one from the other. This ticket removes the LABEL and leaves the VERDICT exactly as it is. Every decision below hangs on keeping that boundary clean.

**Problem statement.** The `faff-repeat-parked` label is inert and display-only — it is written on demotion but never read back as pipeline input, because repeat-park detection is seam-computed (`faff park-history`) and surfaced via the routing verdict. It is also the only state label designed to co-exist with `faff-parked`, making it the single-select-group outlier that blocks a clean single-select "state" label group. This change deletes the label role and its write-sites so the label stops being emitted, provisioned, or applied.

**Design principles.**

**Do not touch the verdict machinery.** The `repeat-parked` routing verdict, its schema enum, its rendering, and the `park-history` seam are out of scope and must behave byte-identically after the change. The shared name is a trap: an edit that greps for `repeat-parked` and changes everything breaks routing. Scope every edit to the LABEL (the `faff-`/`sd-`-prefixed name, the `CONTROL_LABEL_DEFS` role entry, and the write-sites that apply it).

**Load-bearing behaviour is `faff-parked`, not `faff-repeat-parked`.** On a repeat-park demotion, `faff-parked` is what removes the issue from the eligible pool and the demotion comment is what records the reason. Both must survive; only the `faff-repeat-parked` tag is dropped.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/labels.js` | JavaScript | `CONTROL_LABEL_DEFS` manifest + selftest — the role is removed here |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript | `ROUTING_VERDICTS` holds the `repeat-parked` verdict — KEEP untouched |
| `plugin/skills/faff/bin/lib/park-history.js` | JavaScript | Seam that computes repeat-park detection — KEEP untouched |
| `plugin/skills/faff-tidy/SKILL.md` | Markdown (skill prompt) | Repeat-park demotion write-site — drops the tag |
| `plugin/skills/faffter-noon-methodology-thematic/SKILL.md` | Markdown (skill prompt) | Thematic demotion write-site — drops the tag |
| `plugin/skills/faff/references/autonomous.md` | Markdown (reference doc) | Control-label manifest prose — drops the enumeration entry + description |

**Scope statement.** This sits at the control-label manifest layer of faff's autonomous pipeline; it narrows the state-label set so FAFF-1091 can define a single-select "state" group.

## 2. OUT OF SCOPE

- **The `repeat-parked` routing verdict** — Why excluded: it is a distinct mechanism (routing, not labelling) that this ticket explicitly keeps. Extension point: `contract-defs.js` `ROUTING_VERDICTS` (line 144) and its semantics (lines 2422, 2943-2949); `automation-routing.schema.json` enum; `faffidavit-routing/SKILL.md`; `faff-wtf/SKILL.md` verdict rendering. All unchanged.
- **The `park-history` seam** — Why excluded: repeat-park detection is seam-computed and independent of the label. Extension point: `park-history.js` (`repeat_parked` output). Unchanged.
- **Per-role label-name / group-membership config** — Why excluded: that is FAFF-1091's single-select state-group work, which this ticket only unblocks. Extension point: the future label-group config surface (FAFF-1091).
- **Migrating live tickets that already carry `faff-repeat-parked`** — Why excluded: no migration tooling ships for control-label changes (same policy as the FAFF-1044 prefix change); an orphaned label on an old ticket is inert and harmless. Extension point: a coordinated human relabel, if ever wanted.
- **The `awaiting-adjudication` omission in `autonomous.md`** — Why excluded: the manifest enumeration prose is already stale (it lists 7 roles for an 8-entry manifest, omitting `awaiting-adjudication`); fixing that pre-existing gap is separate hygiene. Extension point: `autonomous.md` line 156. This ticket removes only `repeat-parked` from that list.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| control label | A tracker label in faff's fixed manifest (`CONTROL_LABEL_DEFS`); the pipeline signals it tags issues with. |
| role | The stable, prefix-independent identity of a control label (e.g. `repeat-parked`); rendered as `<prefix>-<role>` (e.g. `faff-repeat-parked`). |
| routing verdict | A token in `ROUTING_VERDICTS` assigned to an issue by the routing slot; a separate mechanism that happens to reuse the name `repeat-parked`. |
| write-site | A code or prose location that applies the label; distinct from a read-site (none exist for this label). |

**Manifest entry being removed** (`labels.js`, `CONTROL_LABEL_DEFS`):

```
ENTRY repeat-parked:        # to be DELETED
  role: "repeat-parked"
  color: "#d97706"
  description: "Cosmetic breadcrumb ..."
  # no tracker_owned flag (CLI-writable)
```

`controlLabels(prefix)` maps over `CONTROL_LABEL_DEFS`, so it emits the remaining roles automatically once this entry is gone — no factory change needed.

**Selftest fixtures being updated** (`labels.js`, `LABELS_SELFTEST_CASES`): the two expected-name arrays each list `<prefix>-repeat-parked`. Remove `"faff-repeat-parked"` (case `"faff"`) and `"sd-repeat-parked"` (case `"sd"`) so the expected names match the reduced manifest, preserving order.

**Design decision — verdict vs label under a shared name.** The name `repeat-parked` is reused by a role in `CONTROL_LABEL_DEFS` and a token in `ROUTING_VERDICTS`. Option A: remove both (wrong — breaks routing). Option B: remove only the label role and its write-sites, leave the verdict and seam. **Chosen:** B — the ticket retires the label only; the verdict is a distinct, still-needed mechanism.

**Design decision — does any read-site need repointing?** The ticket raised this as an open question. Grep of `park-history.js`, the calibration path, and `references/methodology.md` shows no code or prose reads the `faff-repeat-parked` label as input; detection comes from the `park-history` seam and the label is write-only. **Assumes:** nothing reads the `faff-repeat-parked` label as input (validate before starting — see Assumptions), so no repoint is required and AC "nothing reads the label after the change" already holds by construction.

## 4. HOW — Behavior

**Approach.** Delete the manifest role and its selftest fixtures, drop the `faff-repeat-parked` tag from the two demotion write-sites (keeping the `faff-parked` tag + demotion comment), and remove the label from the reference-doc manifest prose. No factory, verdict, seam, or schema code changes.

**Edit 1 — `labels.js` manifest and selftest.**
```
PROCEDURE remove_label_role:
  1. Delete the CONTROL_LABEL_DEFS entry whose role === "repeat-parked" (the object literal, lines 31-32).
  2. In LABELS_SELFTEST_CASES:
     a. From the "faff" expected-names array, remove "faff-repeat-parked".
     b. From the "sd" expected-names array, remove "sd-repeat-parked".
     c. Preserve the order of every remaining name.
  3. Leave controlLabels(), labelsSelftest(), cmdLabels(), and module.exports unchanged.
```

**Edit 2 — `faff-tidy/SKILL.md` demotion write-sites.**
```
PROCEDURE detag_tidy:
  1. Table row (line 141, "Repeat-park ... issue still in Todo"):
     - Keep: demote Todo->Backlog; apply faff-parked; post the demotion-specific park comment; log.
     - Drop: the faff-repeat-parked tag and the "stays the breadcrumb" clause.
  2. Auto rule (line 309, "Demote repeat-parked Todos to Backlog"):
     - Keep: demote Todo->Backlog; apply faff-parked (the label that removes the issue from the pool); post the demotion comment; log.
     - Drop: applying faff-repeat-parked, and the prose framing it as "an inert breadcrumb kept only for /faff-wtf surfacing and the calibration loop".
```

**Behaviour summary — tidy demotion after the change:** an issue in the `park-history` `repeat_parked` set, still in Todo, is demoted to Backlog, tagged `faff-parked`, and given the demotion-specific park comment; it no longer receives `faff-repeat-parked`. Its removal from the eligible pool and its `/faff-wtf` surfacing are unaffected (both come from `faff-parked` + the seam/verdict, not the dropped tag).

**Edit 3 — `faffter-noon-methodology-thematic/SKILL.md` demotion write-sites.**
```
PROCEDURE detag_thematic:
  1. Line 55 ("Repeat-parked: ... demote to Backlog, tag faff-repeat-parked ..."):
     - Keep the demote-to-Backlog + faff-parked behaviour; drop the faff-repeat-parked tag.
  2. Line 105 (detection-table demote row, "tag with faff-repeat-parked via the sanctioned op"):
     - Keep the demote + log + appetite-gating; drop the faff-repeat-parked tag.
```

**Edit 4 — `autonomous.md` manifest prose.**
```
PROCEDURE clean_reference_doc:
  1. Line 156 enumeration ("... awaiting-spec-review, repeat-parked, claimed — seven stable roles ..."):
     - Remove "repeat-parked" from the listed roles.
     - Keep the count word consistent with the roles it now lists (do NOT also add the pre-existing awaiting-adjudication omission — out of scope).
  2. Line 160: delete the sentence describing faff-repeat-parked as a cosmetic breadcrumb (the sentence up to "... routing verdict token."). Leave the awaiting-review / awaiting-spec-review / claimed sentences intact.
```

**Design decision — the `autonomous.md` count word.** Removing `repeat-parked` drops the enumeration from 7 listed names to 6. Leaving the word "seven" would create a fresh list-vs-count mismatch. **Chosen:** update the count word to match the reduced enumeration (six listed roles), and do NOT attempt to also fix the separate `awaiting-adjudication` omission (pre-existing staleness, out of scope). This keeps the sentence internally consistent without widening scope.

**Anti-pattern:** grepping `repeat-parked` and editing every hit. Why: it will change `ROUTING_VERDICTS`, the schema enum, the seam, and the verdict rendering — all of which must stay untouched. Edit only the label role, the two selftest names, the demotion write-sites, and the two `autonomous.md` prose spots.

**Anti-pattern:** dropping `faff-parked` or the demotion comment along with `faff-repeat-parked`. Why: `faff-parked` is the load-bearing label that removes the issue from the pool; only the co-applied `faff-repeat-parked` tag is inert.

## 5. Scenarios

```
Given the faff CLI after the change
When `faff labels --names` is run (default prefix)
Then the output does NOT include `faff-repeat-parked`, and still includes faff-parked, faff-claimed, and the other retained roles
```

```
Given the updated LABELS_SELFTEST_CASES
When `node plugin/skills/faff/bin/lib/labels.js --selftest` is run
Then it exits 0 (RESULT: PASS) — the emitted names match the reduced expected arrays for both the faff and sd prefixes
```

```
Given an issue in the park-history repeat_parked set, still in Todo, processed by faff-tidy
When the repeat-park demotion runs
Then the issue is demoted Todo->Backlog, tagged faff-parked, and given the demotion comment, and is NOT tagged faff-repeat-parked
```

- The `repeat-parked` routing verdict MUST remain in `ROUTING_VERDICTS` and behave identically (its `contract-defs.js` semantics, schema enum, and `/faff-wtf` rendering unchanged).
- No code or prose path reads the `faff-repeat-parked` label as pipeline input after the change.

(No holdouts — this is a self-hosting internal mechanical change; every scenario stays visible to the builder.)

## 6. DESIGN DECISION RATIONALE

**Remove both `repeat-parked` names, or only the label?**
- Remove both — Con: breaks the routing verdict, its schema, and `/faff-wtf` rendering; contradicts the ticket.
- Remove only the label role + write-sites — Pro: matches the ticket exactly; verdict/seam untouched.
- **Chosen:** remove only the label — the verdict and the label are unrelated mechanisms that happen to share a name.

**Does any read-site need repointing?**
- The ticket flagged this as open. Exploration (grep of `park-history.js`, the calibration path, `references/methodology.md`, and all of `plugin/`) found no read-site: the label is applied on demotion and surfaced only via the `park-history` seam + the routing verdict, never read as input.
- **Chosen:** no repoint — the label is write-only today, so the AC "nothing reads the label after the change" already holds. Recorded as an Assumption with a re-run-the-grep validation instruction so the build agent confirms it before deleting.

**The `autonomous.md` role-count word.**
- Leave "seven" — Con: fresh mismatch (6 listed, says seven).
- Update to match the reduced list; ignore the pre-existing `awaiting-adjudication` omission — Pro: internally consistent, scope stays tight.
- **Chosen:** update the count word to the reduced enumeration; do not fix the unrelated omission (out of scope).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The ticket's only open question (whether a read-site needs repointing) is resolved: nothing reads the label.

**Assumptions.**
- **Assumes:** nothing reads the `faff-repeat-parked` label as pipeline input. Validation: before deleting, run `grep -rn "repeat-parked" plugin/ docs/` and confirm every non-verdict/non-seam hit is a write-site or descriptive prose (no `labelOp`/read-side comparison of the label as an input signal). If a genuine read-site surfaces, stop and repoint it to the `park-history` seam / routing verdict instead.

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] The `repeat-parked` routing verdict, its schema enum, the `park-history` seam, and `/faff-wtf` verdict rendering are byte-identical to before (no diff in `contract-defs.js` `ROUTING_VERDICTS`, `automation-routing.schema.json`, `park-history.js`, `faff-wtf/SKILL.md` verdict lines).
- [ ] On a repeat-park demotion, `faff-parked` is still applied and the demotion comment still posted.

### From WHAT (manifest + selftest)
- [ ] `CONTROL_LABEL_DEFS` in `labels.js` no longer contains a `role: "repeat-parked"` entry.
- [ ] `LABELS_SELFTEST_CASES` no longer lists `"faff-repeat-parked"` or `"sd-repeat-parked"`; remaining names keep their order.
- [ ] `controlLabels()`, `labelsSelftest()`, `cmdLabels()`, and `module.exports` are otherwise unchanged.

### From HOW (behaviour)
- [ ] `faff labels --names` (default prefix) does not emit `faff-repeat-parked` and still emits the retained roles.
- [ ] `node plugin/skills/faff/bin/lib/labels.js --selftest` exits 0 (RESULT: PASS).
- [ ] `faff-tidy/SKILL.md`: the repeat-park table row (≈line 141) and the auto rule (≈line 309) demote Todo→Backlog, apply `faff-parked`, and post the demotion comment, but no longer apply `faff-repeat-parked`; the "inert breadcrumb / calibration loop" rationale prose is removed.
- [ ] `faffter-noon-methodology-thematic/SKILL.md`: the repeat-parked demotion (≈line 55) and the detection-table demote row (≈line 105) keep demote + `faff-parked`, and no longer tag `faff-repeat-parked`.

### From HOW (reference doc)
- [ ] `autonomous.md` line 156 enumeration no longer lists `repeat-parked`, and the accompanying count word matches the roles it now lists.
- [ ] `autonomous.md` line 160's `faff-repeat-parked` cosmetic-breadcrumb sentence is removed; the surrounding `awaiting-review` / `awaiting-spec-review` / `claimed` prose is intact.

### From assumptions
- [ ] The validation grep confirms nothing reads the `faff-repeat-parked` label as input (no repoint needed).

### Project checks
- [ ] `faff validate-adapters` (SKILL.md lint) passes after the SKILL.md edits.
- [ ] The repo test suite passes (in particular any labels-manifest test).

**Integration smoke test:**
```
PROCEDURE smoke:
  1. Run `node plugin/skills/faff/bin/lib/labels.js --selftest`  -> expect exit 0, RESULT: PASS
  2. Run `faff labels --names`                                    -> expect NO line equal to "faff-repeat-parked"
  3. Assert `ROUTING_VERDICTS` in contract-defs.js still contains "repeat-parked"
  # If 1 and 2 pass and 3 holds, the label is retired and the verdict is intact — plumbing correct.
```

confidence: high
spec-review: approve