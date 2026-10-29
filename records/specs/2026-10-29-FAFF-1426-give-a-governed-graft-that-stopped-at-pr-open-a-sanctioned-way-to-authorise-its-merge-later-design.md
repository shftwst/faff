# FAFF-1426: Give a governed graft that stopped at PR open a sanctioned way to authorise its merge later

> Spec: faffter-dark-nlspec · 2026-10-29 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1426.

## 1. WHY

A standalone graft admits its run to Commissaire at run start, with a scope that includes `merge` and `branch-delete`. From then on `faff merge-gate` fails closed unless a signed grant covers the merge (and, under `--delete-branch`, the branch delete). The grants are written by prose in faff-graft Step 10's "Governed merge producer half": one `faff commissaire effect declare --step merge`, then one `faff commissaire effect authorize --step merge` per effect, with `level`, `attended` and `holdout` typed into each stdin payload.

A graft that stops at PR open never reaches Step 10. That is the normal path when the operator merges later. `merge-gate` then refuses with `no-verdict-for-step` on both legs, and no command writes the missing grants. On 2026-10-28 the agent wrote them by hand for FAFF-1424 (PR #1160) and FAFF-1406 (PR #1156).

Writing them by hand exposes two weak points. `holdout` and `attended` are typed in, and the Commissaire level policy (`evaluateLevelPolicy` in `decision-policy.js`) decides on exactly those values. At L4 it grants only when `holdout` is `meets-spec`; at L1 and L2 it grants only when `attended` is true. Nothing stops a caller from typing `meets-spec` for a run whose `holdout.json` says `needs-human`.

This change adds one command that writes the merge-step grants from the run's own facts, so that no caller supplies the values the policy decides on. graft Step 10 calls the same command, so the two paths cannot drift.

### Design principles

- **The policy's inputs come from the run, never from the caller.** The command derives level, attendance and holdout from the same sources `merge-gate` reads. It has no flag for any of them.
- **The actor does not authorise itself.** `merge-gate` keeps verifying grants and does not write them. The command runs before `merge-gate`, as the orchestrating step's half.
- **Commissaire learns nothing about faff and does not expand.** No `commissaire*` module changes, not even to add an export. This is the operator's ruling recorded in the decisions-register intent on this issue. The command lives on the faff side. It reads faff's own artifacts, assembles the request, and calls Commissaire's existing `effect declare`, `effect authorize` and `effect observe` unchanged.
- **Governance stays additive.** On an ungoverned run the command writes nothing and exits 0, and the merge is byte-for-byte today's.
- **Tests live in `test/`.** No `--selftest` block is added (AGENTS.md).

### Reference context

| Path | Role |
|---|---|
| `plugin/skills/faff-graft/SKILL.md` Step 10, "Governed merge producer half" | the prose this command replaces |
| `plugin/skills/faff/bin/lib/commissaire.ts` (+ committed `.js`) | `effect declare`, `effect authorize` (`cmdRequestDecision`), `effect observe` |
| `plugin/skills/faff/bin/lib/decision-policy.js` | `evaluateLevelPolicy`: L1/L2 need `attended`, L3 passes, L4 needs `holdout: meets-spec` |
| `plugin/skills/faff/bin/lib/merge-gate.js` | reads `baseRefName`/`headRefName`, resolves the anchor level, checks the merge and branch-delete legs |
| `plugin/skills/faff/bin/lib/merge-gate-floor.js` | `resolveAnchorLevel`, `resolveGateLevel`, `readHoldout` (freshness-checked) |
| `plugin/skills/faff/bin/lib/merge-gate-effects.js` | `runIsGoverned`, `resolveCommissaireDecisionGrantDetail`, `resolveBranchDeleteGrantDetail` |
| `plugin/skills/faff/bin/lib/config-resolve.js` | `verificationUnattended` (the attendance fact) |
| `records/adr/0064-…`, `records/adr/0126-…` | the authority split, and the one carve-out that lets `merge-gate` self-declare its schema:2 merge effect |

### Already shipped against this surface

- FAFF-1212 (Done): `merge-gate`, `pr-create` and branch-delete call Commissaire's grant verification. That is the refusal this ticket recovers from.
- FAFF-1118 (Done): a `--delete-branch` merge needs grants covering both merge and branch-delete.
- FAFF-1034 (Done): the runner is promoted onto the Commissaire facade at every level that causes a protected effect.
- FAFF-1176 (Done): `faff commissaire contract status` reports whether a run is governed.

None of these writes grants for a run that stopped before Step 10. The premise holds.

## 2. OUT OF SCOPE

- **The refusal message.** Naming the remedy in `merge-gate`'s refusal is FAFF-1425. Once this command exists, FAFF-1425 can point at it. FAFF-1425 is linked in the tracker as blocked by FAFF-1426, so it lands after this one.
- **Dispatched lanes.** A lane under the concurrency dispatcher inherits its orchestrator's admission and is merged at the dispatcher's merge locus, which writes its own grants. This command covers top-level graft runs only. The dispatcher could call it later.
- **An out-of-process governor.** Where the signing key lives is unchanged (ADR-0135). The command calls the same `effect authorize` path, so it works with whichever governor the run uses.
- **Level escalation at merge time.** `merge-gate`'s grant legs do not compare a grant's recorded level with the level they enforce. A grant decided at L2 therefore stays valid if the PR head moves to a commit anchored at L4. This gap predates this ticket (graft's hand-written grants have it too) and is filed as FAFF-1427. This command does its own part (section 4.2): it never treats a lower-level grant as covering.
- **Run close.** `effect reconcile` and `verdict conclude` stay where graft and the close-out flow already run them.

## 3. WHAT

### Where the command lives

**Chosen:** a faff-side CLI, `faff merge authorize` and its pair `faff merge observe`. It reads faff's own artifacts (holdout from `holdout.json` through `readHoldout`, level from the committed anchor, attendance from `verificationUnattended`), assembles the request, and calls Commissaire's existing `effect declare`, `effect authorize` and `effect observe` unchanged. Commissaire's verbs are untouched. No new ADR is needed: `merge-gate` still neither self-declares (beyond ADR-0126's schema:2 carve-out) nor self-authorises. _Decided by the operator on 2026-10-29: they answered "yes" to this faff-side proposal._ Rationale:
- Commissaire's CLI is a faff-agnostic object-verb grammar (ADR-0123; the `--issue` to `--unit-id` deprecation; FAFF-1207).
- A `merge` object under `faff commissaire` would couple the governance layer to faff's workflow.
- A graft prose resume is ruled out because it keeps hand-typed values.

`faff merge` is not an existing subcommand, so the name does not collide.

### Interface

```
faff merge authorize --run-dir DIR --issue ID (--pr N [--delete-branch] | --local [--base B] [--branch BR]) [--json]
faff merge observe   --run-dir DIR --issue ID (--pr N [--delete-branch] | --local [--base B] [--branch BR]) [--json]
```

- **`--local`** is the git-only form, mirroring `faff merge-gate --local`. There is no PR, so no `gh` call. The base and branch are resolved by the same `resolveLocalBase` and current-branch logic `merge-gate-local.js` uses. Level comes from the committed anchor at the branch head. The trust context is `makeTrustContext({ transport: "local", repo_dir, base_ref: base })`, exactly as in `merge-gate --local`. No branch-delete effect: the local merge does not delete branches. `--base` and `--branch` mean exactly what they mean to `merge-gate --local`: an explicit `--base` wins, and the rest is resolved. The caller passes the same values to both commands; graft passes the same values it passes to `merge-gate --local`. A mismatch fails closed: the grant targets a base the gate does not check, and `merge-gate --local` refuses. The resolved base is printed in `inputs.base`.
- **No `--level`, `--attended` or `--holdout` flag.** An unknown flag fails at the argv parser (exit 2), as everywhere else.
- **`--delete-branch`** mirrors the merge args the caller will pass to `merge-gate`. It adds the branch-delete effect.
- **Exit codes.**
  - **0:** granted, or the run is ungoverned (nothing written).
  - **1:** Commissaire denied, with the reason printed.
  - **2:** fail-loud, meaning an input could not be established (PR identity or anchor level). Governed status always resolves: `runIsGoverned` treats a probe failure as governed.

`--json` output:

```
{ governed: bool,
  inputs: { level, attended, holdout, base, head },
  effects: [ { kind, target, verdict, reason, verdict_seq } ],
  written: bool }
```

## 4. HOW

### 4.1 Deriving the inputs

Each value comes from the source `merge-gate` itself reads for the same decision:

| Input | Source | Why this source |
|---|---|---|
| governed | `runIsGoverned(runDir)` | the predicate `merge-gate` uses to decide the legs apply |
| base, head | `gh pr view N --json baseRefName,headRefName,headRefOid` | the targets `merge-gate`'s merge and branch-delete legs check |
| level | `resolveAnchorLevel` at the PR head sha | the level `merge-gate` enforces; an operator `--level` cannot override it there either |
| attended | the negation of `verificationUnattended({ ...ledger, level: <anchor level> }, cfg)`, exported from `config-resolve.js` (a faff module) by this change | the fact behind `faff verification resolve --json`'s `.unattended`, computed at the level that will be enforced |
| holdout | `readHoldout(runDir, issue)` | freshness-checked: a stale verdict reads `blocked`, an absent one `missing` |

**Chosen:** the holdout input is `readHoldout`'s result as returned, including `missing` and `blocked`. Rationale: those values already fail `evaluateLevelPolicy`'s L4 check, so a run with no fresh `meets-spec` verdict cannot be granted at L4. Graft's prose today sends `holdout` absent when no verdict exists. At L4 that is the same outcome, a deny, and below L4 the policy does not read `holdout`.

**Chosen:** attendance is computed at the anchor level, not the ledger level. Rationale: the grant records `level` and `attended` together, so both must describe the same level. An anchor at L4 is unattended by construction, and an anchor at L3 reads the config's declared-unattended signal, exactly as `verificationUnattended` already does for a ledger at that level.

**Chosen:** the command fails loud (exit 2) when the anchor level cannot be resolved, as `merge-gate` does. Rationale: falling back to the live ledger level would reopen the downgrade lever FAFF-690 closed.

### 4.2 authorize

```
authorize(run_dir, issue, pr, delete_branch):
  IF NOT runIsGoverned(run_dir): print governed:false; EXIT 0
  pr_info := gh pr view pr        # fail-loud on error, or on missing base (or head under delete_branch)
  IF pr_info.state == MERGED: EXIT 1 already-merged   # no post-hoc grants
  level := resolveAnchorLevel(…, pr_info.headRefOid)   # fail-loud unless status ok
  attended := NOT verificationUnattended({...ledger, level}, cfg)
  holdout := readHoldout(run_dir, issue)
  effects := [ {kind: merge, target: pr_info.baseRefName} ]
  IF delete_branch: effects += {kind: branch-delete, target: pr_info.headRefName}
  FOR each effect NOT already covered by a valid grant for (issue, step merge):
      declare it (if no declaration covers it)
      authorize it with {effect, level, attended, holdout}
  IF any verdict is deny: EXIT 1 with the reasons
  EXIT 0
```

**Chosen:** the command is idempotent per effect. Before writing, it checks each effect with the same verification `merge-gate` runs (`resolveCommissaireDecisionGrantDetail`, `resolveBranchDeleteGrantDetail`). It builds the trust context exactly as `merge-gate` does, with `makeTrustContext` and the repo slug taken from the PR's own url (`repoSlugFromPrUrl`), never from the checkout (the FAFF-1212 fix). An effect counts as covered only when it has a valid grant **and** that grant's recorded `level`, `attended` and `holdout` equal the inputs just derived. The resolvers already return the covering verdict's `verdict_seq`. The command reads the `effect-decision-verdict` record at that seq from the run's `declared-effects.jsonl`, using the existing ledger reader (`parseJsonlEntries` in `events.js`), and compares its `payload.level`, `payload.attended` and `payload.holdout`. That record is signed and already carries those fields today. Both prerequisites were verified against the code on 2026-10-29:
  - `verifiedLegDetail` in `merge-gate-effects.js` returns `verdict_seq`;
  - the `effect-decision-verdict` record written by `cmdRequestDecision` carries `payload.{level, attended, holdout}` (seen in `run-20261028-034228-graft-FAFF-1424`, seq 18).

  A test pins both, so a later change to either fails loudly instead of quietly weakening the idempotence check. No resolver, and no `commissaire*.js` module, changes. The stricter check lives only in the new module, as an extra filter on top of the shared verification, not a second copy of it. A covered effect gets no new declare and no new authorize; any other effect is authorised afresh. Rationale: graft Step 10 and an operator retry can both reach the command, and a hash-chained ledger should not gain redundant records. But a grant decided on older facts, such as a lower level or an earlier holdout, must not be reused.

**Chosen (ratified: human):** `--local` is supported in this change rather than left in graft prose. It is built after `--pr`: the `--pr` path and its tests come first, and `--local` reuses the same derivation with the local base, trust context and ancestry check. Rationale: graft's prose today covers both the `--pr` and `--local` merges. Leaving `--local` in prose would keep hand-typed values on the git-only path, which this ticket exists to remove.

**Chosen:** a deny is not retried and is not overridden. Rationale: a deny is the governance decision. The caller routes it as a merge block, as graft's prose already says.

### 4.3 observe

After a merge that went through, the command writes `effect observe --step merge` for the same effect set. It reads `<run>/<issue>/merge-record.json`, which `merge-gate` writes only on a confirmed merge, and refuses (exit 1) when that record is absent. **Chosen:** observing requires the merge record. Rationale: an observe must witness a real effect, and the merge record is the one artifact `merge-gate` writes on success.

### 4.4 Module placement, graft and docs

- The logic lives in a new factory-region TypeScript module, `plugin/skills/faff/bin/lib/merge-authorize.ts`, registered as the `faff merge` subcommand. The committed `tsc` emit `merge-authorize.js` sits beside it, and importers require it extensionless (`require("./merge-authorize")`). The file is added to `tsconfig.json`'s `include` list. `npm run build` in `plugin/skills/faff` regenerates the emit and `build-manifest.json`, and all three are committed with the `.ts` (ADR-0132, AGENTS.md). The small edit to `config-resolve.js` (the `verificationUnattended` export) stays JS, since it is an existing JS module. It reuses the merge-gate resolvers named in section 4.1 rather than copying them.
- **Chosen:** it calls Commissaire by spawning the existing facade CLI (`faff commissaire effect declare|authorize|observe`) with the same stdin payloads graft's prose sends today. Rationale: the public CLI is Commissaire's faff-agnostic interface. Going through it leaves `commissaire.ts` and its `.js` emit untouched, and the signed records stay identical to today's.
- graft Step 10's "Governed merge producer half" calls `faff merge authorize` before handing off to ship and `faff merge observe` after a shipped merge. Its hand-written declare and authorize payloads are removed.
- The faff-graft "stopped at PR open" path names the resume: run `faff merge authorize`, then `merge-gate`, then `faff merge observe`.
- `docs/reference/cli.md` gains the two rows.

### 4.5 Edge cases

- **PR already merged:** `authorize` refuses (exit 1, reason `already-merged`) and writes nothing. In local mode, "merged" means the branch is already an ancestor of the base. **Chosen:** no post-hoc grants. Rationale: a grant minted after the effect would present an unauthorised merge as pre-authorised in the ledger's declare → authorize → observe order. `merge-gate`'s own already-merged reconcile path is unchanged.
- **Head moved after authorize:** grants target branch names, not shas. `merge-gate` re-checks CI and re-resolves the anchor level on the new head. If the new head's anchor declares a different level, re-running `faff merge authorize` writes a fresh grant at that level, because the old grant no longer matches the derived inputs. `merge-gate` itself does not yet refuse the stale grant; that is FAFF-1427 (section 2).
- **Branch-delete grant present but merge grant missing:** only the merge effect is written.
- **Holdout changes after a grant:** re-running writes a fresh grant, because the recorded holdout no longer matches. Independently, a non-`meets-spec` verdict at L4 still blocks the merge, because `merge-gate`'s own holdout leg reads `holdout.json` at merge time.

### 4.6 Tests (in `test/` only)

- `test/merge-authorize.test.mjs` uses a fixture governed run with a stubbed `gh`. It covers:
  - grant at L2 attended;
  - `attended` is derived, not fixed: an L3 run whose config declares it unattended reports `attended: false` in the `--json` inputs. (An L1 or L2 run is attended by construction in `verificationUnattended`, so the L1/L2 deny cannot be reached through this command.)
  - deny at L4 with `holdout.json` aggregate `needs-human`;
  - deny at L4 with a stale `holdout.json` (`readHoldout` returns `blocked`, and the `--json` inputs show it);
  - deny at L4 with no `holdout.json` (`readHoldout` returns `missing`, and the `--json` inputs show it);
  - an ungoverned run writes nothing;
  - idempotent re-run: no new records when the derived inputs match the existing grant;
  - a fresh grant when the anchor level differs from the existing grant's recorded level;
  - the trust context is built from the PR url, not the checkout: a fixture whose checkout remote differs from the PR's repository still finds the existing grant;
  - `--delete-branch` writes two grants;
  - a PR already merged (or, with `--local`, a branch already in the base) exits 1 with `already-merged` and writes nothing;
  - an L4-anchored head on an L3 ledger records `attended: false` (attendance at the enforced level);
  - an unresolvable anchor (no committed anchor at the head) exits 2, writes nothing, and does not fall back to the ledger level;
  - with a valid branch-delete grant but no merge grant, only the merge effect is declared and authorised;
  - the prerequisites in section 4.2: the resolver detail carries `verdict_seq`, and the verdict record at that seq carries `payload.level`, `payload.attended` and `payload.holdout`;
  - `--holdout` and `--level` are rejected at the argv parser;
  - `faff merge observe` exits 1 and writes nothing without `merge-record.json`;
  - `faff merge observe` with a merge record writes one observe per effect in the set;
  - `--local` on a fixture git-only repo grants the merge effect against the resolved local base, with no `gh` call, and `merge-gate --local --check-only` then reports no grant blocker.
- An end-to-end case: after `authorize`, `merge-gate --check-only` on the same fixture reports no `no-verdict-for-step` blocker.
- Registration: `REGION_SELFTEST_ARGV` for the new command is `null`, with a `TEST_FILE_COVERAGE` entry naming the test file.

## Scenarios

```
Given a governed L2 run stopped at PR open, with no merge grant
When the operator runs `faff merge authorize --run-dir R --issue X --pr N --delete-branch`
Then it exits 0 and prints two effects, merge and branch-delete, each with verdict grant
And `faff merge-gate --pr N --issue X --run-dir R --check-only` reports no Commissaire grant blocker
```

```
Given a governed L4 run whose holdout.json aggregate is needs-human
When the operator runs `faff merge authorize` for it
Then it exits 1 and names the reason level-requires-holdout-meets-spec
And merge-gate still refuses that merge
```

```
Given a governed L2 run where `faff merge authorize` has already granted the merge effect
When the operator runs the same `faff merge authorize --json` again
Then it exits 0, and the JSON output has `written: false`
And declared-effects.jsonl gains no declare, request or verdict record
```

```
Given any governed run
When the caller passes `--holdout meets-spec`
Then the command exits 2 for an unknown flag and writes nothing
```

```
Given an ungoverned run
When the operator runs `faff merge authorize`
Then it exits 0, prints governed false, and declared-effects.jsonl is unchanged
```

## Rule inventory

graft Step 10's "Governed merge producer half" prose is replaced by calls to this command. One row per rule in that prose:

| Rule in graft SKILL.md (Step 10, governed merge producer half) | Command behaviour | Covering test (`test/merge-authorize.test.mjs` unless named) | Disposition |
|---|---|---|---|
| Run the block only when the governed-run check reports governed; on an ungoverned run skip it, and the schema:2 declare and the merge stay as today | `runIsGoverned` false → exit 0, nothing written | ungoverned run writes nothing | kept |
| `level` = the run-ledger level, as Step 10 resolved via `resolveGateLevel` | `level` = the committed anchor level at the head (`resolveAnchorLevel`), the level `merge-gate` enforces | fresh grant when the anchor level differs; unresolvable anchor exits 2 | changed: `merge-gate` enforces the anchor level, so the grant is decided at the level that will be enforced (FAFF-690) |
| `attended` = the negation of `faff verification resolve --json`'s `.unattended` | the negation of `verificationUnattended`, the function behind that output, evaluated at the anchor level | `attended` derived: unattended L3 reports `false`; L4 anchor on an L3 ledger records `false` | changed: computed at the enforced level, so the recorded `level` and `attended` describe the same level |
| `holdout` = `holdout.json`'s aggregate when Step 8c produced one, else absent | `readHoldout`: the aggregate when fresh, `blocked` when stale, `missing` when absent | L4 deny for `needs-human`, stale and absent | changed: a stale verdict no longer passes as current; `missing` replaces absent, and both deny at L4, so the outcome is the same |
| Declare `merge` targeting the base, before `merge-gate --execute` | declares the merge effect against the PR's `baseRefName` (or the resolved local base) | grant at L2 attended; `--local` grant | kept |
| Add a `branch-delete` declare iff the merge-args carry `--delete-branch` | `--delete-branch` adds the branch-delete effect targeting `headRefName` | `--delete-branch` writes two grants | kept |
| Authorize each effect with `{effect, level, attended, holdout}` | one `effect authorize --step merge` per uncovered effect, through the facade CLI | grant at L2 attended; `--delete-branch` writes two grants | kept |
| Match `<base>` to what `merge-gate` covers; `--local` passes null and the grant's own target is used | `--pr` uses `baseRefName`; `--local` uses the base `merge-gate --local` resolves | `--local` grant, then `merge-gate --local --check-only` has no grant blocker | changed: `--local` names the resolved base instead of null, so the grant targets what the local gate checks |
| A non-grant is a merge block, never a silent merge: route a deny through the merge-block handling, never hand off to ship | exit 1 with the reasons; graft routes exit 1 to its merge-block handling | L4 `needs-human` deny exits 1 and writes no grant | kept (the routing stays in graft prose; the command supplies the exit code) |
| On a shipped merge, observe with the same effect descriptors | `faff merge observe` writes one observe per effect, and only when `merge-record.json` exists | observe refuses without a merge record; observe writes one per effect | changed: an observe now requires the merge record as proof the merge happened |
| `merge-gate` suppresses its own schema:2 auto-declare/observe for a covered merge | unchanged: that is `merge-gate`'s behaviour, not this command's | existing merge-gate tests | kept (outside the deleted prose's mechanics, stated for completeness) |
| (implicit) authorize every time Step 10 runs | authorize only effects without a matching grant | idempotent re-run; scenario 3 | changed: idempotent, so a resumed run does not append duplicate records |

The "Conclude at run close" bullet that follows the governed half is not replaced (section 2, Run close) and stays in graft.

## 5. DESIGN DECISION RATIONALE

- **Why read `readHoldout`, not the raw file.** `merge-gate`'s holdout check refuses a stale verdict. Reading the raw aggregate would let a stale `meets-spec` grant an L4 merge that the floor itself treats as blocked.
- **Why not take the level from the ledger.** `merge-gate` enforces the committed anchor's level, and the grant should be decided at the level that will be enforced.
- **Why a separate command, not a `merge-gate` leg.** It keeps ADR-0064's split intact without a new ADR, and keeps open the path FAFF-1182 and FAFF-1220 are on, where the runner cannot grant itself a merge.
- **Why faff-side, not under `faff commissaire`.** Commissaire stays faff-agnostic (ADR-0123, FAFF-1207). The knowledge of which artifacts hold the inputs belongs to faff.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

None open. The operator decided the command shape on 2026-10-29 (section 3).

## 7. DONE

### From WHY
- [ ] A governed run stopped at PR open can be merged through `faff merge authorize`, `merge-gate`, then `faff merge observe`, with no hand-written `commissaire effect` call.
- [ ] No input that `evaluateLevelPolicy` decides on can be supplied by the caller: the command has no `--level`, `--attended` or `--holdout` flag.

### From WHAT and HOW
- [ ] `holdout` comes from `readHoldout`. A stale or absent verdict yields `blocked` or `missing`, and at L4 the command denies.
- [ ] `level` comes from the committed anchor at the PR head. An unresolvable anchor exits 2.
- [ ] `attended` is the negation of `verificationUnattended`, which `config-resolve.js` now exports.
- [ ] An ungoverned run is a no-op: nothing is written to `declared-effects.jsonl`, and the command exits 0.
- [ ] Re-running after a grant exists writes no new declare or authorize record when the grant's recorded level, attended and holdout equal the derived inputs, and writes a fresh grant when they differ.
- [ ] The coverage check builds its trust context from the PR's url with `makeTrustContext`, as `merge-gate` does.
- [ ] `faff merge observe` refuses without `merge-record.json`.
- [ ] graft Step 10's governed merge producer half calls the command, and its typed-in authorize payloads are gone.
- [ ] Every line deleted or replaced in graft SKILL.md's governed merge producer half maps to a row of the Rule inventory, and each row's disposition holds in the built command.
- [ ] `faff merge authorize --local` grants against the base `merge-gate --local` resolves, without calling `gh`.
- [ ] `docs/reference/cli.md` documents both subcommands.
- [ ] Commissaire does not expand: `faff commissaire` gains no object or verb, and no `commissaire*.ts` or `commissaire*.js` file (including `commissaire-verify.js` and `commissaire-trust.js`) changes, with no new export added for `faff merge`'s use. `git diff --stat` over `plugin/skills/faff/bin/lib/commissaire*` is empty. The new exports this change needs (`verificationUnattended`) are in faff modules.
- [ ] `faff merge authorize` on an already-merged PR exits 1 and writes nothing.
- [ ] Attendance is computed at the anchor level.
- [ ] An unresolvable anchor exits 2 without falling back to the ledger level.
- [ ] `merge-authorize.ts` exists with its committed `merge-authorize.js` emit, is listed in `tsconfig.json`'s `include`, and `build-manifest.json` is regenerated. `faff regions check` passes, and the CI stale-emit check in `validate.yml` passes.
- [ ] A `needs-human` holdout cannot be presented as `meets-spec`: at L4, with `holdout.json` aggregate `needs-human`, `faff merge authorize` exits 1 and writes no grant.

### Tests
- [ ] `test/merge-authorize.test.mjs` covers the cases in section 4.6 and passes.
- [ ] The new command is registered `REGION_SELFTEST_ARGV[cmd] = null`, with a `TEST_FILE_COVERAGE` entry. `lint-cli-coverage` passes.
- [ ] No `--selftest` case is added in any module.
- [ ] `faff gates run` passes.

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"}]}
```

## Methodology critique

_Lens: faffter-dark-methodology-agile-delivery, issue-critique._

- **Right-sized (principle 4):** no issues. One new command with two verbs, one export, a graft prose swap and one test file. One to two days.
- **Workstream fit (principles 1 and 5):** no issues. The outcome is named (a stopped governed graft can be merged), and it sits with the Commissaire chokepoint work (FAFF-1212, FAFF-1118).
- **Dependencies surfaced (principle 6):** no issues. The command shape was decided on 2026-10-29. FAFF-1425 is linked as blocked by FAFF-1426. FAFF-1427 (merge-gate refusing a grant decided at a lower level) is related but independent: this command is correct without it.
- **Risk profile (principle 7):** moderate. It touches the merge chokepoint's grant path but adds no new authority: it calls the same `effect authorize` with inputs the run already holds. The risk is fixture realism, especially for `--local`, so `--pr` is built and tested first (section 4.2).

