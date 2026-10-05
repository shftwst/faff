# Spec — FAFF-1162: bring the V5 state-authority map current to a pinned commit

> Spec: faffter-dark-nlspec · 2026-10-05 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1162.

This spec tells the build agent how to revise `docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` so it describes origin/main at one pinned commit, and how to prove the revision with the map's own eight-step smoke test. It is for the build agent and for the human who sits FAFF-827 (Phase 1 acceptance) against the result. Every fact below was checked against a read-only checkout of origin/main at `b02fac1b` (2026-10-05) unless it says otherwise; the build re-checks everything at its own pin.

## 1. Why

**The map is read by code, not only by people.** `plugin/skills/faff/bin/lib/shadow-fidelity.js :: readMapDecisionKernelCommands` parses the live map's classification table on every run with the regex `` ^\|\s*`([a-z][a-z0-9-]*)`\s*\|\s*[a-z-]+\s*\|\s*decision-kernel\s*\| `` to decide which commands the FAFF-826 shadow study replays and which it sets aside. `faff shadow-fidelity reproduce` then requires the recomputed set-aside list to be byte-identical to the banked `verification/reports/FAFF-826-coordination-fidelity/result.json`, and `test/shadow-fidelity.test.mjs` runs that reproduction in CI against the live map. So the map has two jobs that can pull apart: be true about the code today, and keep reproducing a result banked against an older revision of itself. This spec keeps the map true and moves the banked reproduction onto a pinned copy of the revision it was produced under.

**Problem.** The map was built at `174f62b7` (2026-08-31, commit `48be132d`, FAFF-825) over 114 `REGION_MAP` commands. At `b02fac1b` `REGION_MAP` holds 134, the modules the map leans on most have grown by hundreds of lines (merge-gate +796, contract-defs +564, gates +580, events +420, config +574, adr +510, validate-adapters +417), and the Commissaire facade, governed records and TypeScript emit have landed. FAFF-827 cannot accept a map that no longer describes the code, so this ticket revises it in place at one pinned commit and re-runs its smoke test.

### Design principles

**Facts from code, judgements from the map's own precedents.** `current_region` is copied from `REGION_MAP`. `semantic_owner`, `state_changing` and the class cells are judged by reading the handler module and its write closure, and a new row cites the existing row whose reasoning it follows (for example, `decision-capture` is `decision-kernel` because it feeds the shadow comparison; `park-verdict` is `decision-kernel` as a pure validity function; `park-history` is `software-delivery-policy`).

**Never shape a row to suit the parser.** A row's bucket is decided on its merits. Formatting tricks that hide a `decision-kernel` row from the regex, or a bucket chosen to keep the parsed set unchanged, are defects.

**History stays readable.** The 174f62b7 revision was consumed by FAFF-944 and the FAFF-826 report. The revised map names that revision and how to read it, and no banked evidence is rewritten (rollback rule 7: historical evidence is never rewritten to resemble the rolled-back version).

**The original FAFF-825 quality bar still applies.** Every column, enumeration and check in `records/specs/2026-08-31-FAFF-825-map-current-state-authority-design.md` (its "Type definitions", "Done" list and "Integration smoke test" procedure) binds new and revised rows exactly as it bound the original ones.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` | Markdown | The document revised in place (686 lines, unchanged since `48be132d`; sha256 `7a21e429b7e143023c6ea9ca0ac30e70099f5a777e8ef53d1ad37b29daba3389`) |
| `records/specs/2026-08-31-FAFF-825-map-current-state-authority-design.md` | Markdown | Column types, enumerations, build procedure and smoke-test procedure the revision must keep |
| `docs/rfc/rfc-superdomestique-runtime/v5/ADDENDUM-1-v5.md` | Markdown | "Map drift" treatment and the ratified rows the revision must reflect |
| `records/adr/0132-typescript-emit-lands-beside-source-under-the-js-name.md` | Markdown | TypeScript layout (d): the committed `.js` emit is the governed artifact |
| `plugin/skills/faff/bin/lib/regions.js` | JavaScript | `REGION_MAP`, the classification denominator; `faff regions list --json` and `faff regions selftest --region all` |
| `plugin/skills/faff/bin/lib/shadow-fidelity.js` | JavaScript | Parses the live map (read only; never edited here) |
| `test/shadow-fidelity.test.mjs` | JavaScript | The CI case "the committed FAFF-826 report reproduces from a clean context" |
| `docs/rfc/rfc-superdomestique-runtime/v5/CUTOVER-SLICE-SELECTION-v5.md` | Markdown | Cites the map's 59 ownership row keys; read only |
| `docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md` | Markdown | Lines 616 and 662 are the map's two pointer lines ("all 114 current commands") |

**Scope.** This is the Phase 1 map refresh the addendum's "Map drift" section asks for before FAFF-827; it changes documentation, `test/shadow-fidelity.test.mjs` (one new tripwire case, always; one repointed case and one committed fixture, only if the parsed decision-kernel set changes), and nothing under `plugin/skills/faff/bin/lib/`.

## 2. Out of scope

| Excluded | Why | Extension point |
|---|---|---|
| Any change under `plugin/skills/faff/bin/lib/`, including making `shadow-fidelity reproduce` read the map revision a result was produced under, and the stale "(twelve)" comment above `MAP_DK` in `shadow-fidelity.js :: shadowFidelitySelftest` | The ticket forbids bin/lib changes | The follow-up Linear issue this build files (section 4, step 6); `shadow-fidelity.js :: cmdReproduceVerb` |
| Rewriting anything under `verification/reports/FAFF-826-coordination-fidelity/` | Banked evidence; rollback rule 7 | None. A new fidelity result gets its own report directory |
| Choosing or rescoring a cutover slice; editing `CUTOVER-SLICE-SELECTION-v5.md` | FAFF-944's decision, made against the 174f62b7 revision | A future slice-selection ticket reads the revised map |
| Settling addendum decisions 2 (one ledger, two schemas), 3 (custody trigger), 5 (tier vocabulary) or 6 (envelope nouns); editing the addendum | Maintainer decisions | `ADDENDUM-1-v5.md`, "Decisions this addendum asks for" |
| The companion-document corrections the addendum lists (glossary, names and language, technical design "Current code shape") | Separate edits with separate owners | The addendum's "Corrections to companion documents" table |
| Fixing environment-sensitive member failures in `faff regions selftest --region all` (budget same-day clock cases, build-claim skew timing, gates OS mismatch on macOS) | Not map defects; `.faffrc.yaml` already excludes the command from the local gate ladder (FAFF-561) | The owning modules' selftests |
| The FAFF-1167 `schema:3` envelope rename (`issue` to `unit_id`) | Still Backlog; changes field names, not classifications | FAFF-1167 |
| Sitting FAFF-827 | A human gate | FAFF-827 |

## 3. What

### Vocabulary

| Term | Definition |
|---|---|
| Pin | The single origin/main commit the revised map is built against, recorded in its header |
| Prior revision | The map as committed at `48be132d`, built against `174f62b7`; byte-identical to the file at `b02fac1b` |
| Parsed decision-kernel set | The sorted list of commands `readMapDecisionKernelCommands`' regex extracts from a map file. On the prior revision it is: claim-verdict, decision-capture, eligible, next, park-verdict, project-next, queue-state, run-done, run-ledger, run-outward, run-start, state (12) |
| Fixture root | A committed directory holding a byte-identical copy of the prior revision at `docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` relative to itself, so it can be passed to `--root` |
| Row change list | The per-row record in the map's new "Changes since 174f62b7" section: which row, which table, added or revised, and why |
| `holdout` tag | Repo convention for an acceptance item the code-blind holdout evaluator checks; the item is still a Done criterion here |

All existing map vocabulary (row key, state-changing, canonical writer, semantic owner, migration rule, safe boundary, rollback, the five buckets, J-A to J-D, E-A to E-D, the six RFC identities, the disposition scopes) is unchanged.

### Deliverable files

| Path | New or edited | Holds |
|---|---|---|
| `docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` | edited in place | The revised map |
| `docs/rfc/rfc-superdomestique-runtime/v5/TECHNICAL-DESIGN-v5.md` | edited, two lines | Lines 616 and 662 lose the "114" count (section 3, "Pointer lines") |
| `test/fixtures/faff-826-map-root/docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` | new, only if the parsed decision-kernel set changes | Byte copy of the prior revision |
| `test/shadow-fidelity.test.mjs` | edited: one new case always; one existing case repointed only if the parsed decision-kernel set changes | The live-map tripwire case (section 3, "Live-map tripwire"); the FAFF-826 reproduce case pointed at the fixture root |

### Type definitions

The four row records from the FAFF-825 spec are unchanged. Two new records describe the revision itself.

```
RECORD MapHeader:
  pin:            CommitSha        # "Built against commit `<sha>`, <YYYY-MM-DD>."
  status:         String           # names FAFF-825 (built) and FAFF-1162 (revised), for FAFF-827
  source_basis:   String           # names the addendum as an additional, fresher source

RECORD RowChange:                  # one per added or revised row, in "Changes since 174f62b7"
  table:          classification | ownership | migration | assurance | disposition-scope
                | invariant-families
  row:            String           # the command or row_key, verbatim
  change:         added | revised
  reason:         String           # the fact that changed, with its commit or ticket where known

  CONSTRAINT the row-change table's first three cells never form the classification
             shape (backticked bare command, lowercase word, then `decision-kernel`);
             put `table` first and write `row` as plain text or as "table: key"
  CONSTRAINT a row whose cells are unchanged gets no RowChange entry
```

The classification row shape stays byte-compatible with the parser: `` | `cmd` | <region> | <bucket> | <owner_basis> | <state_changing> | <write_evidence> | <compatibility_only> | ``. Every table keeps its column set and order: classification 7, ownership 6, migration 6, assurance 5.

### Delta shape

**Chosen:** revise `STATE-AUTHORITY-MAP-v5.md` in place, with a "Changes since 174f62b7" section, rather than publish a separate delta document.

- `shadow-fidelity.js` reads the live map file. A separate delta would leave code reading a stale table while people read a fresh one.
- Smoke-test step 4 compares one table with one `REGION_MAP` count; a delta document would need a merge rule before step 4 could run.
- FAFF-827 sits one current map.

The new section names the prior pin `174f62b7`, the commit that built it (`48be132d`, FAFF-825), that FAFF-944 and the FAFF-826 report consumed that revision, how to read it (`git show 48be132d:docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md`), the parsed decision-kernel set before and after (as inline comma lists, never table rows), and the row change list.

### Pin

**Chosen:** the pin is the origin/main tip when the build starts, fetched fresh (`git fetch origin main`, then `git rev-parse origin/main`), recorded as "Built against commit `<sha>`, <YYYY-MM-DD>." All counts, citations, line ranges, sweeps and smoke-test steps resolve at that sha. The build re-derives the `REGION_MAP` diff at its own pin, so any command added after `b02fac1b` gets a row. FAFF-1167 is Backlog, so the build does not wait for it.

### Reading the REGION_MAP count

**Chosen:** read the count two ways at the pin and record both in the smoke-test step 4 evidence:

- `faff regions selftest --region all`, final line `RESULT: … (<N> members, …)`; at `b02fac1b` this is `RESULT: FAIL (134 members, 3 failed)`;
- `faff regions list --json`, number of keys; 134 at `b02fac1b`.

Both must equal the classification row count. Member-level selftest failures are recorded by name as out of scope (section 2), not as map defects. The selftest takes more than two minutes; run it in the background. This also settles the ticket's 132 versus 133 question: 133 at `2084139b`, plus `spec-review` (FAFF-1157, `31ad46ca`, 2026-09-30) gives 134.

### TypeScript modules

**Chosen:** classify, cite and sweep the committed `.js` emit, never the `.ts` source. `commissaire.ts`/`commissaire.js` and `producer-auth.ts`/`producer-auth.js` each count as one module. Citations read `commissaire.js :: <function>`. The write-site seed stays `.js`/`.mjs` only and the sweep scope statement says `.ts` is excluded because ADR-0132 layout (d) and the repo's `AGENTS.md` ("TypeScript source and the committed emit") make the `.js` the governed artifact that every test, region lint and install path reads. The map's vocabulary gains a two-sentence TypeScript note saying the same.

### Definition of state-changing for new artifacts

**Chosen:** keep the map's definition word for word and apply it the way the prior revision did. That revision counted `.gitignore` (`gitignore-ensure`), the linked skill install (`sync`) and git refs (`build-claim`, `landing-claim`) as durable writes although none sits under `.faff/`, `records/` or the anchors tree. New artifacts outside those trees (for example `.faff-templates/native-templates.yaml`, `refs/faff/judge-trail/<run_id>`, `shadow-fidelity run --out <dir>` report files) are graded by naming the closest precedent row in `owner_basis` or `write_evidence`, never by narrowing the definition.

### Revisit scope for existing rows

**Chosen:** all 59 existing row keys are kept byte for byte (`CUTOVER-SLICE-SELECTION-v5.md` cites them). The 114 existing classification rows stay unless a fact changed. Revisit, in this order, and change a cell only on a traced fact:

1. Rows owned by merge-gate, contract-defs, gates, events; then config, prdr, adr, validate-adapters, sentry.
2. Rows the addendum's ratified treatments touch:
   - `faff effects declare`, `faff effects observe`, `effects-chain-head.json`, `anchor: effects`: state the current fact that `schema:3` records chain into the same `declared-effects.jsonl` under the same lock (`commissaire.js` `LEDGER_CFG = { ledgerFile: "declared-effects.jsonl" … }`, appended through `events.js :: appendRecordsUnderLock`) and that existing readers are unchanged. Revise `compatibility_path` where it says "the generic effect stream starts fresh at cutover". Do not state which schema is canonical (addendum decision 2 is open).
   - `faff merge-gate` assurance: `effect_evidence` names the chokepoint verifying an Ed25519-signed grant (`commissaire.js :: chokepointPermit`, called from `merge-gate.js :: resolveGrantByEffectKind`, which `resolveCommissaireDecisionGrant` wraps; it fails closed on a governed run with no covering verdict), and carries the custody caveat in the addendum's words: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence. Any class cell resting on the grant is graded by the FAFF-825 rule (the weakest class the mechanism can prove against the orchestrator).
   - Identity cells: keep the RFC identity values; add one vocabulary note that, per the addendum (ratified for Phase 0 to 2A), `run_segment_id` exists in bundles, `contract_revision` exists in `schema:3`, and no stage-attempt, effect or work-item identity exists in code, the issue id standing in for the work item.
3. Rows where FAFF-1118 to 1120 governed records now exist. On a governed run, `faff-graft` and `faff-beep-boop` skill prose brackets the agent-side write with a declare/observe pair through `faff effects` (FAFF-1119 `af256e47` for label, push, ADR/PRDR; FAFF-1120 `368b5def` for tracker status). The `label-write` and `tracker-write` effect kinds already existed at `174f62b7`; FAFF-1119 added `push` and FAFF-1118 added `pr-create`. `faff worktree-prune` gained its own governed bracket under `--run-dir` (`worktree-prune.js`, FAFF-1119). Revise the four `tracker:` rows, `faff worktree-prune`, and the `faff adr …` and `faff prdr …` rows to state what the governed path records, who writes it and in which file. Keep `rebuildable-projection` for tracker rows unless a traced fact changes it.
4. Any row whose cited function, test path or line range moved. Known at `b02fac1b`: `bundle.js :: buildClaimSelftest` 1637 to 1519, `landingClaimSelftest` 2056 to 2073, `worktree-prune.js :: worktreePruneSelftest` 227 to 255, `gitignore-ensure.js :: gitignoreEnsureSelftest` 101 to 125; `contract-defs.js` amendment quote 805-807 to 988-990; `governance-profile.js` `ledger_outcomes` 126 to 140. Re-derive every range at the pin, end lines included.
5. `faff decision-capture` ownership `readers`: the shadow comparison now exists as `shadow-fidelity.js`.

The four `tracker:` rows already sit under "Harness orchestration and anchors" in all three tables (prior revision lines 398-401, 489-492, 580-583, 16 rows per section in each table). There is no misplacement to fix; the build leaves them there.

### Facts that changed outside the tables

**Chosen:** revise three prose sections whose claims are false at `b02fac1b`, each with a row change entry.

- **Disposition-scope "Work item" row and "The work-item terminal-verdict scope".** The prior revision says grepping `accepted_under_contract` outside the master RFC returns nothing. At `b02fac1b`, `commissaire.js :: cmdTerminalVerdict` (`verdict conclude`) appends a Commissaire-signed `schema:3` `accepted_under_contract` record. Restate the current vocabulary, its source line, and the remaining gap (the addendum's ratified depth: admission is scope-only; obligations, independence, waivers and seal are not modelled; `outcome_rejected`, `cancelled`, `abandoned` have no counterpart unless the build finds one).
- **Amendment surface investigation.** Add `commissaire.js` (`contract admit --contract-revision`, `--force`, and the "ambiguous contract revision" refusal) as a fourth candidate, quoted with file and line, and re-state the verdict against both clauses of the rule ("new immutable contract revision" and "new admission decision"). The verdict is not pre-supplied here. Update the three existing quotes' line numbers.
- **The eight invariant families.** Re-verify every family's mechanism at the pin. Known changes: the Merge family now includes the `schema:3` grant leg on a governed run; the Effect family's "detection only, never aborts" must be re-checked against the fail-closed chokepoint on a governed run (FAFF-1034) and the governance-required sentinel (FAFF-1140).

### New rows

**Chosen:** one classification row per command added to `REGION_MAP` since `174f62b7`, plus an ownership, migration and assurance row triple for each traced state-changing step or new durable artifact, under the FAFF-825 grain and splitting rules. Rows that share one module, one envelope and one custody caveat go in a new seventh area, **Commissaire facade**, in all three tables.

The new area is justified because placing `schema:3` rows under "Effects" would sit them beside the `schema:2` rows as one stream, which reads as an answer to addendum decision 2. Every other new row goes into one of the existing six areas, next to the precedent row it cites. The map's sentence "sectioned into six areas" and each area's row-count line are updated.

The 20 commands added between `174f62b7` and `b02fac1b`, with handler modules from `bin/faff`'s `COMMANDS` table. The table lists candidates to trace; it does not grade them. `state_changing` comes only from tracing each handler's write closure, as the prior revision did, because many modules write only inside `--selftest` scratch fixtures.

| Command | Region | Handler | Lead for the trace |
|---|---|---|---|
| `commissaire` | factory | `commissaire.js` (emit of `commissaire.ts`) | `schema:3` records into `declared-effects.jsonl`; governor and producer key material under `<run-dir>/commissaire/`; `audit seal`/`audit export` bundle writes; `audit anchor` via `events.js :: mintIssueAnchor` |
| `scenario-matrix` | governance | `scenario-matrix.js` | Pure emitter and report renderer |
| `judge-trail`, `judge-history` | factory | `judge-trail.js` | `refs/faff/judge-trail/<run_id>` via `git update-ref` or non-force push (sweep-invisible, like `build-claim`) |
| `punt-scan` | factory | `punt-scan.js` | Pure Punt classifier |
| `verification` | factory | `config.js :: cmdVerification` | Resolves verification posture |
| `park-reconsider` | factory | `park-reconsider.js` | Pure `classifyReEntry` plus a git-only unpark write helper |
| `shadow-fidelity` | factory | `shadow-fidelity.js` | Banner: "region:factory / decision-kernel"; `run --out` writes a report directory |
| `manifest` | factory | `manifest.js` | Tier-1 binding manifest validator |
| `conventions` | factory | `conventions.js` | `.faff/conventions.json` cache |
| `native-map` | factory | `native-map.js` | Committed `.faff-templates/native-templates.yaml` |
| `worktree-check` | factory | `worktree-check.js` | Pure classifier plus git read |
| `worktree-heal` | factory | `worktree-heal.js` | Restores git admin metadata; shells `git worktree repair` |
| `review-target` | factory | `review-target.js` | Pure resolver |
| `pr-create` | factory | `merge-gate.js :: cmdPrCreate` | Sole `gh pr create` path with a `schema:3` grant leg (FAFF-1118) |
| `spec-review` | factory | `spec-review.js` | Evidence extraction reader |
| `build-review-churn`, `build-review-convergence` | factory | `build-review-*.js` | Siblings of `spec-review-churn`/`-convergence` |
| `build-judge-evidence` | factory | `build-judge-evidence.js` | Case, ledger and ruling files (mode 0600) |
| `spec-judge-accept-bar` | factory | `spec-judge-evidence.js` | |

Expected but not pre-decided: `shadow-fidelity` classifies `decision-kernel` by the `decision-capture` precedent and its own banner. The build confirms by reading the module.

Candidate row keys for the Commissaire facade area, kept only where the trace confirms a durable write: `faff commissaire contract admit`, `faff commissaire effect declare`, `faff commissaire effect authorize`, `faff commissaire effect observe`, `faff commissaire effect reconcile`, `faff commissaire verdict conclude`, `faff commissaire audit seal`, `faff commissaire audit export`, `commissaire key material`. `faff commissaire audit anchor` reuses `mintIssueAnchor`; the build either gives it its own row or folds it into the anchor rows with a stated reason. Where a row must name the `issue` field, it names it as the code does today and notes FAFF-1167 as a pending rename that changes no classification.

### Pointer lines in TECHNICAL-DESIGN-v5.md

**Chosen:** edit lines 616 and 662 to drop the number, so they read "at the grain of all current commands" and "a classification row for every current command". A count in an unpinned pointer line goes stale on the next `REGION_MAP` addition; the pinned count lives in the map. Smoke-test step 2 extracts paths from these lines, not counts, so the edit is for accuracy, not to satisfy step 2. No other line in `TECHNICAL-DESIGN-v5.md` changes.

### The shadow-fidelity coupling

**Chosen:** classify honestly, then repair the one CI case the honest result breaks, without touching bin/lib or banked evidence.

| Option | Verdict |
|---|---|
| Keep every new row out of `decision-kernel` | Rejected: shapes the map to suit the parser |
| Hide rows from the regex (formatting, a split table) | Rejected: the same defect, harder to see |
| Rewrite the banked `result.json` | Rejected: rollback rule 7 |
| Change `cmdReproduceVerb` to pin the map revision | Right fix, but a bin/lib change; filed as a follow-up |
| Point the CI reproduce case at a committed fixture root holding the prior revision | Chosen: the banked result reproduces against the map it was produced under, auditable by digest |

**Ordering with FAFF-1174.** FAFF-1174 (Backlog; produce the post-fix coordination-fidelity corpus for FAFF-974) runs `faff shadow-fidelity` against the live map and commits a second result set under `verification/reports/FAFF-826-coordination-fidelity/`. Its done-when needs a human-confirmed Fly runner redeploy, so the expected order is FAFF-1162 first: the post-fix result is then produced under the revised map and reproduces against it. If FAFF-1174 has merged before the pin, the build applies the same fixture-root treatment to every banked result set in that directory whose reproduction the revised map breaks, one fixture root per map revision, and records each in the finding. The follow-up issue (step 6c.vi) is related to FAFF-1174 so the post-fix run can record its map digest.

**Live-map tripwire.** **Chosen:** add one committed test case to `test/shadow-fidelity.test.mjs`, unconditionally, that keeps CI parsing the live map once the reproduce case no longer does. It reads `docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` from the repository, calls the exported `readMapDecisionKernelCommands(REPO)`, and asserts two things: the result equals a decision-kernel set the test derives column-aware from the classification table alone (the rows between the "## Classification table" heading and the next `## ` heading, third cell), so a stray match from any other table or a row the regex silently drops fails CI; and the result equals the literal PARSED_AFTER list, so any later edit that changes the shadow study's scope must change the test in the same PR, in view of review. Without this case, repointing the reproduce case would leave no committed check on the live map's parseability, and `resolveMapCommands` fails open (an unreadable map yields an empty set, not an error).

The ticket's constraint names bin/lib, and the change sits in verification (test cases and one fixture). The map's own line "no module under `plugin/skills/faff/bin/lib/` and no file under `test/` was added, edited, or deleted to produce it" is revised to state exactly what this revision touched.

## 4. How

### Build procedure

Summary: pin, snapshot the parsed set, revise rows from traced facts, re-sweep, repair the reproduce case only if the parsed set moved, then run the full smoke test and record it.

```
PROCEDURE refresh_state_authority_map:
  1. PIN. git fetch origin main; PIN = rev-parse origin/main; work on a branch
     from PIN. Record PIN and today's date.
  2. SNAPSHOT.
     a. Compute sha256 of the map at PIN. Assert it equals
        sha256(git show 48be132d:<map path>). IF NOT: the map changed after
        48be132d; stop, record which commit changed it, and treat that commit's
        revision as the prior revision for steps 6 and 8 (needs a note in the
        revision history).
     b. Compute PARSED_BEFORE with the exact regex from
        shadow-fidelity.js :: readMapDecisionKernelCommands (re-read the regex
        at PIN; do not trust the copy in this spec).
  3. DENOMINATOR.
     a. KEYS_OLD = keys of `faff regions list --json` at 174f62b7 (temporary
        worktree or git archive); KEYS_NEW = same at PIN.
     b. ADDED = KEYS_NEW − KEYS_OLD; REMOVED = KEYS_OLD − KEYS_NEW;
        MOVED = keys whose region value differs. At b02fac1b: 20 added,
        0 removed, 0 moved. Any REMOVED or MOVED key gets a revised or
        deleted classification row and a row change entry.
     c. Run `faff regions selftest --region all` (background); record the
        member count line and each failing member by name.
  4. ROWS.
     a. FOR each ADDED command: trace its handler from bin/faff COMMANDS,
        follow its write closure to an fs primitive or named out-of-band
        mechanism, emit one classification row in the existing format,
        sorted into place alphabetically, citing a precedent row in
        owner_basis.
     a2. EARLY COUPLING READ. As soon as the classification table is final
        (it depends on nothing after 4a), compute PARSED_AFTER and run the
        step 6c.i check, so a park for a human or the need for the step 6c
        repair is known before the long revisit and sweep, not at the end.
     b. FOR each traced state-changing step or new durable artifact: emit
        ownership, migration and assurance rows under one new row_key,
        placed per section 3 "New rows".
     c. Revisit existing rows per section 3 "Revisit scope". Change a cell only
        on a traced fact; add a RowChange for every changed row.
     d. Revise the prose sections per section 3 "Facts that changed outside
        the tables", the header, "Authority and purpose", "Vocabulary"
        (counts, chosen grain, the TypeScript and identity notes), the
        classification intro (counts by region), "On the row count", and
        "Gaps and named findings".
  5. SWEEP, both directions, at PIN.
     a. Derived set: every file named in write_evidence or canonical_writer
        across all rows, restricted to fs-primitive-visible files; list the
        out-of-band mechanisms separately.
     b. Swept set: seed = every writeFileSync, appendFileSync, renameSync,
        mkdirSync, unlinkSync, rmSync, copyFileSync, cpSync, writeSync call
        site in any .js or .mjs file in the repository outside test/ and
        node_modules/ (.ts excluded; see "TypeScript modules"); closure to a
        fixed point.
     c. Two-way diff; resolve every entry with a stated reason; record both
        sets in full and the diff. Name every sweep-invisible mechanism: the
        build-claim and landing-claim git-ref pushes, judge-trail's
        refs/faff/judge-trail/<run_id> update-ref and push,
        worktree-heal's `git worktree repair`, the scripts/link-skills.sh
        install, and any other found.
  6. COUPLING.
     a. Compute PARSED_AFTER with the same regex on the revised map. Also
        compute the decision-kernel set from the classification table alone
        (column-aware). Assert the two are equal (no stray match from any
        other table).
     b. IF PARSED_AFTER == PARSED_BEFORE: skip to step 6d.
     c. ELSE:
        i.   Assert every command in PARSED_BEFORE is still in PARSED_AFTER
             unless a traced fact moved it; a removal of any of the nine
             replayable kernels parks the build for a human (it changes the
             shadow study's scope, not only its set-aside list).
        ii.  Commit the fixture: copy the prior revision's bytes to
             test/fixtures/faff-826-map-root/docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md.
        iii. Edit ONLY the case "the committed FAFF-826 report reproduces
             from a clean context" in test/shadow-fidelity.test.mjs: pass
             --root <fixture root>, and assert the fixture map's sha256
             equals 7a21e429b7e143023c6ea9ca0ac30e70099f5a777e8ef53d1ad37b29daba3389
             (or the step-2a prior revision's digest), with a one-line
             comment naming `git show 48be132d:<map path>` as the source.
        iv.  Run `faff shadow-fidelity reproduce --dir
             verification/reports/FAFF-826-coordination-fidelity --root
             <fixture root>`: exit 0. Run it with --root <repo>: record the
             exit code (expected 1) as the finding's evidence.
        v.   Add a named finding to "Gaps and named findings": reproduce
             reads the live map, so a banked result reproduces only against
             its own map revision; operators reproduce the FAFF-826 result
             with --root test/fixtures/faff-826-map-root until the follow-up
             ships. Note the stale "(twelve)" comment in
             shadow-fidelity.js's selftest as part of the same finding.
        vi.  File a Linear follow-up in the project "Orchestration fidelity
             is measured before authority moves" (the project holding
             FAFF-826 and FAFF-974): make `shadow-fidelity reproduce` pin the
             map revision a result was produced under (record the map digest
             in manifest.json at `run` time, verify it at reproduce time);
             related to FAFF-826, FAFF-974 and FAFF-1174; a bin/lib change.
             Link it from the finding.
     d. ALWAYS (whatever 6b decided): add the live-map tripwire case to
        test/shadow-fidelity.test.mjs per section 3 "Live-map tripwire",
        with PARSED_AFTER as its literal list. Check once that it fails
        when one classification row's bucket is changed in a scratch copy
        of the map, then restore.
  7. POINTERS. Edit TECHNICAL-DESIGN-v5.md lines 616 and 662 per section 3.
  8. SMOKE TEST. Run all eight steps (section 8) at PIN. Exception,
     stated in the recorded run: a path this revision itself adds (the
     fixture root, if any) does not exist at PIN; resolve it at the branch
     HEAD that carries it and name it as such in the step 3 record. Replace the
     174f62b7 record in the map's "Integration smoke test" section with
     the new run; keep the step definitions. Any failure: fix the map and
     re-run all eight.
  9. CHECKS. Run the suite as CI's unit job does (`node
     --no-experimental-strip-types --import ./test/hermetic-env.mjs
     --test`), `faff regions check`, `faff lint-refs`. Assert `git diff --name-only PIN...HEAD`
     contains no path under plugin/skills/faff/bin/lib/.
 10. COMMITS, ordered so every commit passes CI:
     a. IF step 6c ran: first commit = the fixture plus the repointed
        reproduce case (valid against the unrevised map, because the
        fixture is byte-identical to it).
     b. Next commit = the map edit, the pointer lines AND the live-map
        tripwire case together (the tripwire asserts PARSED_AFTER, so it
        must land with the map that produces it, never before).
     Every commit carries Signed-off-by (the .githooks prepare-commit-msg
     hook adds it; verify).
 11. RE-PIN CHECK before opening the PR: fetch origin main and diff
     `faff regions list --json` keys at the new tip against PIN. IF any key
     was added, removed or moved: rebase onto the new tip, set PIN to it,
     and re-run steps 2 to 9 in full (header, rows, sweep, PARSED_AFTER and
     the tripwire literal, smoke test). Never edit only the header. Record
     the outcome in the PR body.
```

### Edge cases

- **A command added after `b02fac1b`.** Step 3 picks it up; it gets a row like the 20.
- **FAFF-1167 merges before the build starts.** The pin includes it. Rows cite the field names at the pin; the FAFF-1167 note becomes "renamed at `<sha>`" instead of "pending".
- **The map changed after `48be132d`.** Step 2a catches it; the fixture copies the revision the FAFF-826 report was produced under, which is the one whose digest makes reproduce exit 0, not necessarily `48be132d`.
- **A new ownership row key that is a bare hyphenated word.** Harmless to the regex (the third ownership cell is a `module :: function` writer), but step 6a's column-aware check proves it.
- **The selftest member count and `regions list --json` disagree.** Smoke-test step 4 fails; record both and stop. This would mean `REGION_MAP` and the selftest runner disagree, a finding outside this ticket.

### Failure modes

- **The revision is a re-label, not a re-trace.** How you'd know: new rows' `write_evidence` cells name a module but no write call, or the sweep's swept-not-derived list contains a new module with a production write. What it means: the trace was skipped; redo step 4a for that command.
- **The custody caveat gets dropped from a cell that cites the grant.** How you'd know: a `merge-gate` or Commissaire facade row claims a class on the Ed25519 grant without the caveat. What it means: the class may be overstated; re-grade it by the FAFF-825 rule.
- **The fixture drifts.** How you'd know: the test's sha256 assertion fails. What it means: someone edited the fixture; restore it from `git show 48be132d:<map path>`.

**Anti-pattern:** editing a row's bucket because the change list would otherwise touch `test/`. Why: that trades a true map for a quiet CI run, the exact drift `readMapDecisionKernelCommands`' own comment says the derivation exists to prevent.

**Anti-pattern:** renumbering, renaming or merging any of the 59 row keys. Why: `CUTOVER-SLICE-SELECTION-v5.md` cites them and is out of scope.

**Anti-pattern:** narrowing "state-changing" so a new module drops out. Why: the FAFF-825 spec's own anti-pattern; completeness is measured against the registry and the swept set.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the revised map at the pin
When its classification command column is joined against `faff regions list --json` at the pin
Then every REGION_MAP key appears exactly once and no row names a key absent from REGION_MAP
```

```
Given the revised map changes the parsed decision-kernel set
When `faff shadow-fidelity reproduce --dir verification/reports/FAFF-826-coordination-fidelity --root test/fixtures/faff-826-map-root` runs
Then it exits 0, and the same command with `--root` set to the repository exits 1
```

```
Given the revised map at the pin
When one classification row's bucket cell is edited to or from `decision-kernel` in a scratch copy and the live-map tripwire case runs against it
Then the case fails, naming the changed command
```

- No path under `plugin/skills/faff/bin/lib/` and no path under `verification/reports/` appears in the build's diff against the pin.

## 6. Design decision rationale

**In place or a separate delta document?** A delta keeps the 174f62b7 revision untouched in the working tree but leaves `shadow-fidelity.js` reading stale rows and needs a merge rule for smoke-test step 4. In place keeps one current map; git history and the new section keep the old one readable. **Chosen:** in place.

**Which commit?** Waiting for FAFF-1167 delays FAFF-827 for a rename that changes no classification. **Chosen:** origin/main tip at build start.

**How to count REGION_MAP?** A textual count gave 133 against the addendum's 132. Reading through the CLI removes the parser as a variable. **Chosen:** both `regions selftest --region all` and `regions list --json`, recorded side by side.

**`.ts` or `.js` for TypeScript modules?** Citing `.ts` would double-count modules and cite a file no test or install path reads. **Chosen:** the `.js` emit (ADR-0132).

**Where do new artifacts outside `.faff/` and `records/` stand?** Narrowing would contradict the prior revision's own `gitignore-ensure`, `sync` and git-ref rows. **Chosen:** follow those precedents.

**Which existing rows to revisit?** Revisiting all 59 cell by cell is the same work as rebuilding; revisiting only the ticket's named modules misses addendum facts and moved line ranges. **Chosen:** the ordered scope in section 3, with every change justified by a traced fact. An earlier reading reported the four `tracker:` assurance rows under "Effects"; they sit under "Harness orchestration and anchors" in all three tables at `b02fac1b`, so no move is made.

**What about prose sections whose claims are now false?** Leaving them would ship a map that says `accepted_under_contract` has no code counterpart when `commissaire.js` writes it. **Chosen:** revise them with row change entries.

**Where do Commissaire rows go?** "Effects" mixes `schema:2` and `schema:3` rows as one stream and implies an answer to addendum decision 2. **Chosen:** a seventh area, Commissaire facade.

**Pointer-line count?** Updating the number fixes it until the next command lands. **Chosen:** remove the number.

**How to handle the shadow-fidelity coupling?** See the options table in section 3. **Chosen:** honest rows, fixture-root reproduce case, live-map tripwire, named finding, follow-up issue.

## 7. Open questions and assumptions

**Open questions:** none. Every decision above is marked `Chosen` on evidence checked at `b02fac1b`.

**Assumptions**

**Assumes:** FAFF-1167 is not merged at the pin, or, if it is, it renames fields without changing any record's writer, file or class.
*Validation:* check FAFF-1167's state in Linear at build start; if merged, read its diff for any change to a write path or ledger file before relying on the "no classification change" note.

**Assumes:** FAFF-974 still treats `verification/reports/FAFF-826-coordination-fidelity/` as banked evidence and the pre-fix pilot has not been re-run or re-published. FAFF-1174 may add a separate post-fix set to the same directory; that case is handled under "Ordering with FAFF-1174".
*Validation:* check FAFF-974 in Linear and `git log -- verification/reports/FAFF-826-coordination-fidelity/` at the pin (last change at `b02fac1b`: `a216aba4`, FAFF-1022).

## 8. Done

### From why
- [ ] The map header reads "Built against commit `<PIN>`, <date>." where `<PIN>` is the origin/main tip fetched at build start, and `git cat-file -e <PIN>` succeeds.
- [ ] The map's status line names FAFF-825 (built) and FAFF-1162 (revised), and its source basis names `ADDENDUM-1-v5.md`.
- [ ] The "Changes since 174f62b7" section lists, as named review items for the FAFF-827 sitter, the judgement calls this revision makes beyond copied facts: the amendment-surface verdict, the Effect family's "detection only, never aborts" re-check, and every class cell graded on the Ed25519 grant.
- [ ] The PR body records the step 11 re-pin check; if `REGION_MAP` changed, steps 2 to 9 were re-run at the new pin, not only the header.
- [ ] A "Changes since 174f62b7" section names `174f62b7`, `48be132d` (FAFF-825), FAFF-944 and the FAFF-826 report as consumers of that revision, the `git show 48be132d:…` read command, the parsed decision-kernel set before and after as comma lists, and one row change entry per added or revised row.

### From what
- [ ] The classification table has exactly one row per `REGION_MAP` key at the pin, including one row for each of the 20 commands listed in section 3 and any added after `b02fac1b`; its count equals both the `regions selftest --region all` member count and the `regions list --json` key count, all three recorded.
- [ ] Every new classification row uses the existing seven-column format, `current_region` copied verbatim, `semantic_owner` one of the five buckets, a non-empty `owner_basis` citing a precedent row or module behaviour, and `compatibility_only` populated.
- [ ] All 59 prior row keys appear byte for byte in each of the ownership, migration and assurance tables, and the three tables carry identical row-key sets.
- [ ] Each new ownership, migration and assurance row meets every FAFF-825 column constraint (enumerations, evidence cells, `characterisation_tests` covering the row's own fact or `gap` with a note).
- [ ] The Commissaire facade area exists in all three tables with a per-area row count, and the map's area count and total row count are updated.
- [ ] The map's vocabulary carries the TypeScript note and the identity note.
- [ ] The row-change table cannot match the parser: step 6a's regex set equals the column-aware classification set.

### From how (rows and prose)
- [ ] The rows named in section 3 "Revisit scope", items 1 to 5, were each checked at the pin, and every changed cell has a row change entry giving the fact and its commit or ticket.
- [ ] The effects rows state that `schema:3` records chain into `declared-effects.jsonl` and do not name a canonical schema.
- [ ] Every cell citing the Ed25519 grant carries the in-process custody caveat.
- [ ] The disposition-scope "Work item" row, the work-item terminal-verdict section, the amendment investigation (with `commissaire.js` as a quoted fourth candidate) and the invariant-families table reflect the pin.
- [ ] Every cited line range in the map is correct at the pin: an inline-selftest range starts on the line declaring the named function and ends on its closing line; a quoted line number is the line holding the quote.
- [ ] `TECHNICAL-DESIGN-v5.md` differs from the pin only on lines 616 and 662, and neither line contains a command count.

### From how (sweep)
- [ ] The map records the derived set and swept set in full at the pin, the two-way diff with every entry resolved, the closure additions, the scope statement (whole repository excluding `test/` and `node_modules/`, `.js`/`.mjs` only, `.ts` excluded with the reason), and every sweep-invisible mechanism named in step 5c.

### From how (coupling)
- [ ] `PARSED_BEFORE` and `PARSED_AFTER` are recorded.
- [ ] The live-map tripwire case exists in `test/shadow-fidelity.test.mjs`, asserts the regex set equals the column-aware classification-table set and equals the literal PARSED_AFTER list, and passes; editing one classification row's bucket in a scratch copy of the map makes it fail (checked once during the build, recorded in the PR body). If PARSED_BEFORE equals PARSED_AFTER, this is the only change under `test/`.
- [ ] If they differ: the fixture exists at `test/fixtures/faff-826-map-root/docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` with sha256 equal to `git show 48be132d:docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md | sha256sum` (or the step-2a prior revision); only the one named reproduce case was repointed (the tripwire case is the only other test change); `node --test test/shadow-fidelity.test.mjs` passes; the gaps section carries the named finding; the follow-up Linear issue exists, relates to FAFF-826 and FAFF-974, and is linked from the finding.
- [ ] No command in the prior parsed set was dropped from `decision-kernel` without a traced fact and a human decision.

### Constraints
- [ ] `git diff --name-only <PIN>...HEAD` lists no path under `plugin/skills/faff/bin/lib/` and none under `verification/reports/`.
- [ ] `ADDENDUM-1-v5.md` and `CUTOVER-SLICE-SELECTION-v5.md` are unchanged.
- [ ] Every commit on the branch carries a `Signed-off-by` trailer with the operator's identity (`git log --format=%B <PIN>..HEAD | grep -c Signed-off-by` equals the commit count).
- [ ] The PR's CI checks pass, including the unit job (which runs `test/shadow-fidelity.test.mjs`), `faff regions check` and `faff lint-refs`.

### Integration smoke test

All eight FAFF-825 steps, re-run at the pin and recorded in the map in place of the 174f62b7 record. Each step keeps its FAFF-825 definition, with one extension this revision adds and records as an extension in the map: step 7c, cited line numbers and ranges. Step 6's heading clause is FAFF-825's own ("assert the fragment appears verbatim in the named file, and that the nearest preceding heading at that position is the one the citing document names"); it applies only to fragments the map attributes to a named section, and a fragment the map cites by file and line is checked at that line instead. Every step must pass; a failure blocks the map and is fixed, never narrowed.

```
PROCEDURE citation_smoke_test(PIN):
  1. Read the commit in the map header; assert it is PIN and resolves.
  2. Extract every repository-relative path cited in the map and in
     TECHNICAL-DESIGN-v5.md lines 616 and 662 (code spans and table cells,
     including every characterisation_tests path), using the prior run's
     conservative extraction rule.
  3. Reject any path with a leading `/`, a `..` segment or a shell
     metacharacter; assert each exists with `git cat-file -e PIN:<path>`,
     the argument passed as one argv element.
  4. Assert classification row count == `faff regions list --json` key
     count == `faff regions selftest --region all` member count, at PIN.
  5. Assert ownership, migration and assurance row_key sets are identical,
     and contain the 59 prior keys.
  6. FOR each quoted RFC, addendum or module fragment: assert it appears
     verbatim in the named file at PIN, within one physical line or split
     with a bracketed continuation note. IF the map attributes it to a
     named section: assert the nearest preceding heading at that position
     is that section. ELSE (cited by file and line): assert the fragment
     sits on the cited line.
  7. a. FOR each `module.js :: function` in canonical_writer,
        journal_evidence and effect_evidence: assert the module exists at
        PIN (the .js emit for TypeScript modules) and declares or exports
        the function.
     b. FOR each named out-of-band mechanism, assert the spawn or ref name
        is present.
     c. (extension, recorded as such) FOR each cited line range: assert it
        starts on the line declaring the named function and ends on its
        closing line; FOR each cited single line number, assert it is the
        line holding the cited text.
  8. Recompute the step-5 sweep diff from the two enumerated sets in the
     map; assert it matches the map's stated diff and that the scope is
     named.
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery. Prep folded the actionable items into the spec above (early coupling read at step 4a2, the FAFF-1174 ordering note, the follow-up's project and relations, named judgement items for the FAFF-827 sitter, the step 11 re-pin check); FAFF-1162 is now related to FAFF-1174.

**Right-sized? (principle 4)**
- What's there: 20 new classification rows, a seventh area, an ordered revisit, three rewritten prose sections, a two-way sweep, a conditional CI coupling repair and the eight-step smoke test; `build-tier: complex`.
- Why: the map work cannot be split honestly. FAFF-827 sits one map at one pin, and smoke-test steps 4 and 5 pass only when all four tables move together. The coupling repair is the one independent part: the fixture is byte-identical to today's map, so it is valid before the map changes.
- What to do: keep one ticket. The spec's fixture-first commit order gives the coupling repair its own reviewable commit.

**Workstream fit? (principles 1 and 5)**
- No issues with the ticket's placement. The reproduce-pinning follow-up belongs in "Orchestration fidelity is measured before authority moves" (stated in step 6c.vi).

**Deps surfaced? (principle 6)**
- What's there: FAFF-1174 (post-fix fidelity corpus, Backlog, blocks FAFF-974) runs `faff shadow-fidelity` against the live map and commits a second result set beside the pilot.
- Why: which map revision that run reads decides its `set_aside` list, and today merge timing decides it.
- What to do: done in the spec ("Ordering with FAFF-1174"), and the issues are now related.

**Risk profile? (principle 7)**
- What's there: the riskiest outcome (a broken banked reproduction) was reproduced in explore and has a chosen fix. Two risks landed late: the coupling outcome was computed at step 6, and three judgement calls are checked only by a citation smoke test.
- What to do: done in the spec (step 4a2; named review items in "Changes since 174f62b7").
