# FAFF-1212: Make merge-gate, pr-create and branch-delete call Commissaire's grant verification

> Spec: faffter-dark-nlspec · 2026-10-12 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1212.

Revised on 2026-10-12 after seven adversarial spec-review rounds (architectural, infosec, methodology, QA). Round 6 did not run (reviewer spend limit). Round 7 asked for two fixes: the schema:2 suppression checks reuse the leg's pre-merge result, and the stricter `gh pr view` handling applies to governed runs only. Round 8 asked for one: pins are read from the repository the PR belongs to (parsed from its `url`), not from a separately resolved slug that a fork checkout could point elsewhere. Round 9 asked for five: fail closed when the probe reports a failure with no custody, a test seam for the two Commissaire calls, the accepted base-ref-name limit stated, the multi-leg output case, and corrected `ghRepoSlug` wording. Round 10 raised whether this ticket's output should mark evidence-grade entries itself; that is now an open question for a human, and the loop stopped there (new objecting lenses each round, objection counts rising).

Resolved on 2026-10-12 by the operator: option (b), an `evidence` flag on each `commissaire_grants` entry (section 3). The operator also ruled that this spec builds without further review rounds; the human ruling replaces the non-converging review loop, and the code review at build time is the next check.

This spec is for the build agent and human reviewers of FAFF-1212. It replaces the grant check inside `merge-gate.js` with a call to `verifyGrant`, the governance-region function FAFF-1178 adds, for the merge, pr-create and branch-delete legs. It changes faff's call sites only; the verification rules belong to FAFF-1178.

## 1. Why

**The model.** `merge-gate.js` stops deciding whether a grant is trustworthy. For each leg it resolves the effect target, reads the trust file from the base branch when the run is governed, calls `verifyGrant`, and maps the result onto the three-state `decision_grant` signal `decideFloor` and `cmdPrCreate` already consume. Commissaire owns the rules; faff owns where and when the check runs (ADR 0135 ownership line, FAFF-1109 comment 4706c740).

**Problem.** Today `resolveGrantByEffectKind` in `merge-gate.js` takes both the public key and the fingerprint it checks from the runner-written `producer/pk.json`, through `readChokepointKeyRecord`. A runner that writes its own key pair into that file can self-sign a grant the chokepoint accepts; both FAFF-1109 prototypes showed this. The merge leg also passes a `null` target, so the grant is checked against its own declared target and coverage is always true.

**Design principles.**

**`decideFloor` does not change.** The pure floor core keeps its three-state `decision_grant` input. Reasons, custody and classification travel beside it in the command's output, never into the floor's contract.

**Ungoverned runs make no new calls.** An ungoverned run does not read the trust file, does not call `gh` for it, and produces output byte-identical to today.

**Every governed leg reads the trust file.** Once `resolveAdmittedKey` says the run is governed, the leg's answer always comes from a `verifyGrant` call that saw the trust read. A not-read result is never returned for a governed leg, because a not-read call classifies every governor grant as `unpinned`, which FAFF-1219's strict mode would refuse.

**The target comes from GitHub or the operator, never from the grant.** Every leg passes the target it is about to act on; a missing target refuses.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript (factory) | `resolveGrantByEffectKind`, the three leg wrappers, `andGrants`, `governanceRequiredSentinelPresent`, `cmdMergeGate`, `cmdMergeGateLocal`, `cmdPrCreate`, the two `...CoveredBySchema3Grant` predicates |
| `plugin/skills/faff/bin/lib/commissaire-verify.ts` | TypeScript (governance) | `verifyGrant` and `resolveAdmittedKey`, added by FAFF-1178 |
| `plugin/skills/faff/bin/lib/commissaire-trust.ts` | TypeScript (governance) | `readTrustFile({ repoDir, ref, transport, repoSlug })` from FAFF-1210 |
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript (factory) | `readChokepointKeyRecord`, retired here |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript (factory) | `decideFloor` and its `decision_grant` enum, unchanged |
| `plugin/skills/faff/bin/lib/regions.js` | JavaScript (factory) | `faff regions check`: factory may require governance, never the reverse |
| `test/pr-create-chokepoint.test.mjs`, `test/commissaire.test.mjs`, `test/commissaire-contract-status.test.mjs` | Test | Existing grant-leg and key-seam tests |

**Scope.** faff's three chokepoint legs and the two schema:2 suppression predicates that reuse them.

## 2. Out of scope

- **The verification rules, reasons and classification.** FAFF-1178 owns them. Extension point: `commissaire-verify.ts`.
- **Strict mode.** FAFF-1219 adds the `grant-not-pinned` refusal inside `verifyGrant`. This ticket passes the trust read through, so strict mode reaches all three legs with no further change here.
- **Counting a run toward Gate 1.** FAFF-1182 decides which merges count, reading each entry's `evidence` flag (section 3). Extension point: the `commissaire_grants` output field.
- **The already-merged reconcile path.** `alreadyMergedReconcile` never checked a grant and still does not; it writes no new effect. Extension point: its `reasons` list.
- **`governance-check.js` and `worktree-prune.js`.** Both still call `hasGovernanceContext` (schema:3 records only), which is narrower than FAFF-1178's governance-material rule. Extension point: a follow-on that moves them to `resolveAdmittedKey`.
- **Recording custody or classification in `merge-record.json`.** The merge record's shape is unchanged. Extension point: `writeMergeRecord`.

## 3. What

### Vocabulary

| Term | Meaning |
|---|---|
| Leg | One chokepoint check: merge (step `merge`, kind `merge`), branch-delete (step `merge`, kind `branch-delete`), pr-create (step `pr-create`, kind `pr-create`) |
| Effect target | The base branch for merge and pr-create, the head ref for branch-delete |
| Leg result | The `GrantVerifyResult` `verifyGrant` returned for one leg, plus the `base_ref` used for the trust read |
| Governance-required sentinel | `<run_dir>/commissaire/governance-required.json` with `governance_required: true` (FAFF-1140), faff's own fail-closed marker |

### Leg resolver

`resolveGrantByEffectKind` keeps its name and its three-state return so `andGrants`, `decideFloor` and `cmdPrCreate` are untouched. It gains a detail return beside the state.

```
RECORD LegCheck:
  state: "valid-grant" | "absent-or-invalid" | "not-applicable"   # what decision_grant receives
  detail: LegDetail | null                                        # null iff state == "not-applicable"

RECORD LegDetail:
  leg: "merge" | "branch-delete" | "pr-create"
  outcome: "valid-grant" | "absent-or-invalid"
  reason: String          # a GrantReason from verifyGrant, or one of the faff reasons below
  custody: "governor" | "in-process" | null
  classification: "pinned" | "unpinned" | "in-process" | null
  signer_fingerprint: String | null
  verdict_seq: Integer | null
  trust_source: "remote-base" | "local-ref" | "not-read"
  base_ref: String | null  # the ref the trust file was read from
  repo_slug: String | null # the repository the trust file was read from; null on the --local path
  evidence: Boolean        # true only for a pinned grant read from a remote base that requires a PR (below)
  evidence_basis: String   # one line: why evidence is true or false, for logs and FAFF-1182 audits

INTERFACE TrustContext:    # built once per command invocation
  transport: "remote" | "local"
  repo_dir: Path
  repo_slug: String | null # required for "remote"
  base_ref: String         # the PR's base branch (merge, branch-delete) or --base (pr-create)

FUNCTION checkLeg(run_dir, issue, leg, target, trust_ctx: TrustContext, deps?) -> LegCheck
                           # deps: { resolveAdmittedKey, verifyGrant }, defaulting to commissaire-verify.js;
                           #   the test seam for stubbing the two calls, never set by a production caller
```

The existing wrappers keep their names and return `LegCheck.state`, so every current caller reads the same three strings. They gain a required trailing `trust_ctx`. A governed leg called without one refuses with `trust-context-missing`; it never falls back to a not-read answer, so a call site that forgets the context fails closed instead of silently skipping strict mode. An ungoverned leg still returns `not-applicable` before the context is looked at. New `...Detail` variants return the whole `LegCheck` for the command shells.

Every faff-side reason fills the rest of `LegDetail` the same way, defined by `faffDetail` in section 4: `custody` comes from the governance probe when it ran, and `signer_fingerprint` only when the probe bound a key; `classification` and `verdict_seq` are always null, because no faff-side reason comes from a `verifyGrant` call that saw the trust file; `trust_source` is the source the trust read targeted once it was attempted, else `not-read`; `base_ref` is the context's base ref, or null without a context.

Faff-side reasons, used only when `verifyGrant` did not decide:

| Reason | When |
|---|---|
| `governance-required-sentinel` | `resolveAdmittedKey` found no governance material but the FAFF-1140 sentinel is present |
| `trust-context-missing` | A governed leg was called without a `TrustContext` |
| `governance-changed-during-check` | `resolveAdmittedKey` saw governance material and `verifyGrant` then returned `not-applicable` |
| `verify-error` | `verifyGrant` threw (it is specified never to throw); fail closed. Stderr gets one fixed line naming the leg and the exception's `name` only, never its message, because the message can quote runner-written ledger bytes |
| `base-ref-invalid` | The base ref fails the ref-name pattern below; nothing is read |
| `repo-slug-unresolved` | A remote read is needed but no slug resolves, or the slug (from either path) fails FAFF-1178's `--repo` pattern |

**Chosen:** keep the three-state wrappers and add detail beside them. `decideFloor`'s input enum, its `--describe` text and the contract tests stay byte-identical, and FAFF-1178 already shaped `GrantVerifyResult.outcome` to match.

### Command output additions

`merge-gate` (PR and `--local` paths) and `pr-create` gain one optional output field, present only when at least one leg's state is not `not-applicable`:

```
commissaire_grants: [LegDetail, ...]     # one per leg whose state is not "not-applicable", in check order
```

Only the primary leg checks (merge, branch-delete, pr-create) add entries. The schema:2 suppression checks reuse the merge (or pr-create) leg's `LegCheck`, computed before the effect ran, and add none. They make no trust read, `gh` call or ledger walk of their own, so a suppression check after the merge lands cannot disagree with the leg that allowed the merge, even if `gh` degrades in between.

When the run's decision grant is `absent-or-invalid`, the command also appends one blocker line per refusing leg after `decideFloor`'s existing blocker: `Commissaire <leg> grant refused: <reason>`. `pr-create`'s blockers become that line followed by its existing sentence ("Commissaire pr-create decision absent or invalid — …"), which existing tests match.

### The `evidence` flag

**Chosen:** each `LegDetail` carries `evidence`, true only when all three hold: the leg's `outcome` is `valid-grant` with `classification: "pinned"`, `trust_source` is `remote-base`, and the base branch's effective rules include a `pull_request` rule. This is the operator's decision (option (b), 2026-10-12): the "only a protected base counts" rule has one home, next to the data, instead of being re-derived by FAFF-1182 and FAFF-1217.

- **When it is computed.** Only for an entry that already satisfies the first two conditions. Every other entry gets `evidence: false` with no extra call, and `evidence_basis` naming the first failed condition (`not-pinned`, `not-remote-base`, or the refusing reason).
- **How protection is read.** One `gh api repos/{repo_slug}/rules/branches/{base_ref}` call per invocation, through the same `runGh` chokepoint (FAFF-1213 runner identity) that `branch-protection-check` uses, shared by every leg in that invocation. A new pure helper `hasPullRequestRule(rules)` sits beside `extractRequiredChecks`; it is true when any rule has `type: "pull_request"`. `extractRequiredChecks` and `branch-protection-check` are unchanged.
- **Failing toward `false`.** An unreachable endpoint, a non-200 answer, unparseable JSON or a rules array with no `pull_request` rule all give `evidence: false`, with `evidence_basis` saying which (`protection-unreadable: <basis>` or `no-pull-request-rule`). The read never changes `state`, `outcome`, the blockers or the exit code: `evidence` is reporting, not a gate.
- **What it does not prove.** The rules endpoint does not show bypass actors to a non-admin caller, so `evidence: true` cannot rule out a bypass; FAFF-1217's `status` states the same limit and leaves the bypass check to the operator (FAFF-1213).
- **Consumers.** FAFF-1182 (counting) and FAFF-1217 (`commissaire governor status`) consume `evidence` rather than re-deriving the rule from `classification`, `trust_source` and `base_ref`.

**Chosen:** an additive output field and extra blocker lines, not a change to `decideFloor`'s blocker text. The floor's generic blocker is asserted by existing tests and stays; the reason that FAFF-1212's done list asks for is the added line.

## 4. How

### Building the trust context

Each command builds one `TrustContext` and reads the trust file at most once, lazily, the first time a leg needs it.

| Command path | Transport | `repo_slug` | `base_ref` |
|---|---|---|---|
| `merge-gate` PR path | `remote` | the PR's own base repository, parsed from the `url` field the existing `gh pr view` call already returns (`https://github.com/<owner>/<name>/pull/<n>`) | `baseRefName` from the same call |
| `merge-gate --local` (git-only) | `local` | none | the `base` `resolveLocalBase` already returns. This path has no branch-delete leg: `cmdMergeGateLocal` validates `--merge-args` but lands the merge with `landBaseFfOnly` (a fast-forward `git update-ref`) and never deletes a branch, so it gains no leg |
| `pr-create` | `remote` | null at build time; step 7 of `checkLeg` resolves it once with `ghRepoSlug(null)` and memoises it on the context; a governed leg then passes that same slug to `gh pr create` as `--repo` | `--base` |

**Chosen:** the trust file is read from the repository the effect lands in, never from a separately resolved slug. `merge-gate` resolves `repo` with `gh repo view` but looks the PR up with a bare `gh pr view`, and in a fork checkout the two can name different repositories; reading pins from the fork would let a runner pin its own key there and have a merge into the parent classify `pinned`. The PR's `url` names the repository the PR, and so the merge, belongs to. `pr-create` closes the same gap the other way, by creating the PR in the slug it read the pins from. A governed PR path whose `url` does not parse to an `owner/name` that passes FAFF-1178's `--repo` pattern refuses with `repo-slug-unresolved`.

**Chosen:** the PR path and `pr-create` read the trust file over `gh` from the remote base branch, not from a local ref. A local ref in the runner's worktree is runner-writable, and ADR 0135 decision 6 counts only a remote-base read as evidence. The git-only `--local` path has no remote, so it reads the local ref and reports `local-ref`, which FAFF-1178 never counts as pinned-governor evidence.

**Which branch's pins apply.** The trust file is read from the branch the effect lands on (ADR 0135 decision 6 and FAFF-1178 both say "the base branch"). A runner can open a PR against a branch it created, carrying its own `trust.toml`, and the leg then classifies its self-signed grant `pinned` against that branch. This gains the runner nothing it does not already have. It holds the GitHub credential and can push to an unprotected branch directly, without merge-gate (ADR 0135 decision 10), and a later PR from that branch into the protected branch is checked against the protected branch's own pins. What it can forge is a `pinned` label on a merge into an unprotected branch. That is why each entry carries `base_ref`, `repo_slug` and the `evidence` flag, which is false unless the base branch requires a PR; counting (FAFF-1182) and `commissaire governor status` (FAFF-1217) read `evidence`. The git-only `--local` path is the same case: the runner owns the whole ref store and can move the base ref with `git update-ref` without merge-gate, so its local read keeps an honest run's classification consistent and is never evidence (FAFF-1217: a run with no remote does not count).

`gh pr view` already runs on every PR-path invocation; this ticket adds `baseRefName` to its `--json` field list rather than making a second call. On a governed run, a response that lacks `baseRefName` (or `headRefName` when `--delete-branch` is passed) makes `merge-gate` exit 2 with the same identity-failure diagnostic it uses for a missing `headRefOid`. An ungoverned run never reads either field for a leg check, so its handling of the response is unchanged and its output stays byte-identical to today.

The base ref must match `^[A-Za-z0-9_][A-Za-z0-9_./-]*$` and contain no `..`, the pattern FAFF-1178 applies to `audit verify --base`. `readTrustFile` interpolates the ref unencoded into a `gh api` path and a `git show` argument. **Chosen:** check it in `merge-gate.js` before any read, importing FAFF-1178's validator if it exports one, otherwise one local constant with a comment naming FAFF-1178. A failing ref gives `base-ref-invalid` on a governed leg; an ungoverned leg never reaches the check.

**Chosen:** accept that a governed leg refuses a base branch whose name falls outside this pattern (a space, `+`, `?` or non-ASCII). Protected bases in practice are `main` and `release/*`, which pass. Widening the pattern safely needs `readTrustFile` to encode the ref, a change to FAFF-1210's reader and a follow-on, not this ticket. An ungoverned run is unaffected.

### Checking one leg

`checkLeg` asks FAFF-1178's `resolveAdmittedKey` whether the run is governed, without a trust read. A governed leg then reads the trust file and takes its answer from one `verifyGrant` call.

```
PROCEDURE checkLeg(run_dir, issue, leg, target, trust_ctx):
  1. (step, kind) := leg == "pr-create" ? ("pr-create", "pr-create")
                   : leg == "merge"     ? ("merge", "merge")
                   :                      ("merge", "branch-delete")
  2. input := { run_dir, unit_id: issue, step, effect: { kind, target } }
  3. TRY first := resolveAdmittedKey(run_dir, { not_read: true })      # the governance probe; reads only run_dir
     CATCH -> RETURN { state: "absent-or-invalid", detail: faffDetail(leg, "verify-error", null) }
  4. IF first.custody == null AND first.failure != null               # governed but damaged (e.g. ledger-malformed)
       -> RETURN { state: "absent-or-invalid", detail: faffDetail(leg, first.failure, first) }
     IF first.custody == null:                                          # no governance material at all
       IF governanceRequiredSentinelPresent(run_dir)
         -> RETURN { state: "absent-or-invalid", detail: faffDetail(leg, "governance-required-sentinel", first) }
       RETURN { state: "not-applicable", detail: null }                 # ungoverned: no trust read, no gh call
  5. IF trust_ctx is missing
       -> RETURN { state: "absent-or-invalid", detail: faffDetail(leg, "trust-context-missing", first) }
  6. IF NOT validRefName(trust_ctx.base_ref)
       -> RETURN { state: "absent-or-invalid", detail: faffDetail(leg, "base-ref-invalid", first) }
  7. IF trust_ctx.transport == "remote":
       IF trust_ctx.repo_slug == null: trust_ctx.repo_slug := ghRepoSlug(null)   # pr-create only; once, memoised
                                                                        # PR path: already set from the PR url
       IF repo_slug is empty OR fails FAFF-1178's --repo pattern      # checked on every path, PR path included
         -> RETURN { state: "absent-or-invalid", detail: faffDetail(leg, "repo-slug-unresolved", first) }
  8. trust := memoisedTrustRead(trust_ctx)                              # { read: readTrustFile(...) }; once per invocation
  9. TRY res := verifyGrant(input with { trust })
     CATCH -> RETURN { state: "absent-or-invalid", detail: faffDetail(leg, "verify-error", first, trust) }
 10. IF res.outcome == "not-applicable"                              # governance material vanished between the calls
       -> RETURN { state: "absent-or-invalid", detail: faffDetail(leg, "governance-changed-during-check", first, trust) }
 11. RETURN { state: res.outcome, detail: LegDetail from res, plus leg, base_ref and repo_slug;
               trust_source from the attempted read, as in faffDetail }

FUNCTION faffDetail(leg, reason, from: KeyResolution | null, trust: TrustInput | null) -> LegDetail:
  outcome := "absent-or-invalid"; leg, reason as given
  custody := from's custody, or null when from is null
  signer_fingerprint := from's signer_fingerprint when from.pk is non-null, else null   # never an unbound value
  classification := null       # the probe ran without the trust file; its "unpinned" is not a classification
  verdict_seq := null
  trust_source := once the trust read was attempted, the source it targeted ("remote-base" for the remote transport,
                  "local-ref" for local), whether or not it succeeded; else "not-read"
  base_ref := trust_ctx.base_ref when a context exists, else null
```

Step 10 closes a window the probe and the verify call open. The runner shares the worktree, so it can delete `producer/pk.json` and `declared-effects.jsonl` while step 8 waits on `gh`. Once step 4 has seen governance material, the leg can never pass as ungoverned.

Step 4 relies on FAFF-1178's rule that `resolveAdmittedKey` returns `custody: null` exactly when the run has no governance material, without reading the trust file. This ties faff's "skip the read" decision to Commissaire's own applicability rule, through the function FAFF-1178 exports for that question, instead of a second, faff-side definition of "governed".

**Chosen:** every governed leg reads the trust file and takes its answer only from the `verifyGrant` call that saw it. Answering a governed leg without the read looks safe for refusals until strict mode: a not-read call classifies a pinned governor grant as `unpinned`, FAFF-1219 refuses it with `grant-not-pinned`, and that refusal would be permanent. One rule (governed means read) is also simpler to test than a list of refusal reasons that do or do not depend on the trust file. Governed CLI tests therefore need a stub `gh` on `PATH` for `repo view` and the contents read, as `pr-create-chokepoint.test.mjs` already does for `pr create`.

**Chosen:** probe with `resolveAdmittedKey` rather than calling `hasGovernanceContext` first. `hasGovernanceContext` looks only for schema:3 records, while FAFF-1178 treats `pk.json` or `governor.json` as governance material too. Using it would let a runner that deletes the ledger skip the trust read and the refusal FAFF-1178 designed for that case.

**Chosen:** a `verifyGrant` exception refuses (`verify-error`). Today any read error in this leg becomes `not-applicable`, which fails open on a governed run. FAFF-1178 specifies `verifyGrant` never throws, so this branch is a backstop.

**Anti-pattern:** reading the trust file before step 4. Why: an ungoverned run would make a `gh api` call it never made before, breaking the "ungoverned runs are unchanged" requirement and adding a network failure mode to every merge.

**Anti-pattern:** falling back to the grant's own target when the caller has none. Why: it compares the grant with itself; FAFF-1178 refuses an empty target with `effect-target-missing`.

### Call-site changes

| Call site | Today | After |
|---|---|---|
| `cmdMergeGate`, merge leg | `resolveCommissaireDecisionGrant(runDir, issue, null)` | merge leg with target `baseRefName` |
| `cmdMergeGate`, branch-delete leg (`--delete-branch` only) | `resolveBranchDeleteGrant(runDir, issue, headRefName)` | branch-delete leg with target `headRefName` |
| `cmdMergeGate`, both schema:2 suppression checks | `mergeCoveredBySchema3Grant(runDir, issue, null)` | the merge leg's pre-merge `LegCheck` result; no new read or walk |
| `cmdMergeGateLocal`, merge leg | target `base` | unchanged target, local transport |
| `cmdPrCreate`, guard and suppression | target `base` | unchanged target, remote transport; the suppression check reuses the guard's `LegCheck`; on a governed leg `--base` and `--repo` are also forwarded to `gh pr create` |

**Chosen:** on a governed pr-create leg, forward `--base` to `gh pr create`. Today `--base` is only the grant-coverage target and `gh pr create` opens the PR against the repository's default branch, so a runner could pass `--base` naming a branch it controls, have the grant checked (and the trust file read) there, and open the PR against the protected branch. Forwarding it makes the checked target the acted target. An ungoverned leg keeps today's `gh pr create` arguments exactly, so ungoverned runs stay unchanged.

`andGrants` combines the merge and branch-delete states exactly as today. The `commissaire_grants` array lists both legs.

The `require("./commissaire")` line in `merge-gate.js` (which imports `chokepointPermit`, `readLedgerEntries`, `readChokepointKeyRecord` and `hasGovernanceContext`) is replaced by `require("./commissaire-verify")` and `require("./commissaire-trust")`. `merge-gate.js` then reads no file under `commissaire/producer/` itself.

**Chosen:** retire `readChokepointKeyRecord`. FAFF-1178 leaves it exported for this ticket to remove. Remove it from `commissaire.ts`'s exports and body, delete its unit test in `test/commissaire-contract-status.test.mjs`, and rebuild the emit (`npm run build` in `plugin/skills/faff`), committing `commissaire.js` and `build-manifest.json`.

### Region boundary

`merge-gate.js` is factory region; `commissaire-verify` and `commissaire-trust` are governance region. Factory requiring governance is legal under `regions.js`'s direction lint. Nothing in the governance region requires `merge-gate.js`.

### Failure modes

- **The failure:** the remote trust read fails during a `gh` outage, so every governed leg refuses with `trust-file-invalid`, including in-process runs with valid grants that pass today. **How you'd know:** a governed merge-gate run refuses with that reason while `gh` is degraded. **What it means:** proceed. FAFF-1178 fails closed on purpose (ADR 0135 decision 11), and the same outage already makes `observeCi` report CI as indeterminate, so the merge would refuse anyway.
- **The failure:** the probe and the verify call each walk `declared-effects.jsonl`, so a governed leg walks it twice, and a `merge-gate --delete-branch` invocation up to four times (the suppression checks reuse the merge leg's result and walk nothing). **How you'd know:** merge-gate latency on long ledgers. **What it means:** proceed; ledgers are small today. If it matters later, memoise the probe per invocation rather than adding a faff-side applicability rule.
- **The failure:** an existing test builds a governed run by hand without a seq-0 admission, so it now refuses with `admission-missing`. **How you'd know:** a grant-leg test in `test/commissaire.test.mjs` or `test/pr-create-chokepoint.test.mjs` flips from `valid-grant` to `absent-or-invalid`. **What it means:** fix the fixture to go through `commissaire contract admit`, as `pr-create-chokepoint.test.mjs` already does; do not loosen the leg.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a governor-custody run whose governor fingerprint is pinned in the remote base branch's trust file
And the runner has replaced producer/pk.json with a key pair it minted and appended self-signed merge, branch-delete and pr-create grants
When merge-gate (with --delete-branch) and pr-create run their legs
Then each leg's state is "absent-or-invalid"
And each commissaire_grants entry has reason "governor-key-not-admitted"
And merge-gate refuses with exit 1 and pr-create opens nothing, each with a "Commissaire <leg> grant refused: governor-key-not-admitted" blocker
```

```
Given a governor-custody run with genuine grants from a governor pinned in the remote base branch's trust file
When merge-gate checks the merge leg against the PR's baseRefName
Then the state is "valid-grant" and the entry reports custody "governor", classification "pinned", trust_source "remote-base"
```

```
Given an in-process governed run with a covering pr-create grant and no trust file on the base branch
When pr-create runs
Then the PR opens and commissaire_grants reports custody "in-process", classification "in-process"
```

```
Given a governed in-process run with valid merge and branch-delete grants
When merge-gate runs with --delete-branch
Then commissaire_grants has two entries, merge then branch-delete, each with state "valid-grant"
```

```
Given a governed run with a valid merge grant from a pinned governor
When the remote trust-file read fails (gh returns a 500 for the contents path)
Then the merge leg's state is "absent-or-invalid" with reason "trust-file-invalid"
And merge-gate refuses with a "Commissaire merge grant refused: trust-file-invalid" blocker
```

```
Given a git-only repository (no remote) with a governed in-process run and a valid merge grant for main
When merge-gate --local runs
Then the merge leg reads .commissaire/trust.toml from the local main ref and reports trust_source "local-ref", base_ref "main"
```

- A merge leg on a governed run where the PR's base branch is `main` checks the grant against `main`, never against the grant's own declared target.

## 6. Design decision rationale

**Where does the reason travel?** Options: extend `decideFloor`'s input with a reason (changes a fixed contract and its tests); or keep the three-state input and carry detail in the command output. **Chosen:** detail beside the state, plus one blocker line per refusing leg.

**How does faff know whether to read the trust file?** Options: `hasGovernanceContext` (narrower than Commissaire's rule, so ledger deletion skips the read); a faff copy of the governance-material rule (two definitions to drift); a full `verifyGrant` with `not_read` (works, but answers a bigger question than asked); FAFF-1178's `resolveAdmittedKey`. **Chosen:** `resolveAdmittedKey`, whose `custody: null` means exactly "no governance material".

**Which transport?** Options: local `git show` against the worktree's base ref (runner-writable, not evidence); remote `gh api` contents. **Chosen:** remote on the PR and pr-create paths, local only on the git-only `--local` path.

**Where does the merge target come from?** Options: keep `null` and let the grant supply it (self-coverage); a second `gh` call; add `baseRefName` to the existing `gh pr view`. **Chosen:** add `baseRefName` to the existing call, and on a governed run exit 2 if it (or `headRefName` under `--delete-branch`) is missing. Ungoverned runs keep today's handling.

**What happens when `verifyGrant` throws?** Options: `not-applicable`, as today's read errors; refuse. **Chosen:** refuse with `verify-error`.

**Which branch does pr-create open against?** Options: leave `--base` as a check-only argument (the checked target can differ from the PR's real base); always forward it (changes ungoverned runs); forward it on governed legs. **Chosen:** forward it on governed legs.

**Is the trust context optional?** Options: optional, with a not-read fallback for tests (a forgotten context silently skips strict mode); required, refusing a governed leg without one. **Chosen:** required.

**When is the trust file read?** Options: only when the grant verified without it (fewer `gh` calls, but a strict-mode refusal computed without the pins becomes permanent); on every governed leg. **Chosen:** on every governed leg.

**Which branch's pins apply?** Options: the effect's base branch (ADR 0135 decision 6, FAFF-1178); the repository's default branch (resists a runner-created base branch, but contradicts both and misapplies pins to release branches). **Chosen:** the base branch, with `base_ref` and `evidence` reported so counting accepts only a protected base; a runner-created base gains nothing a direct push does not.

**Who decides which entries are evidence?** Options: (a) report the classification and leave the protected-base rule to FAFF-1182 and FAFF-1217; (b) an `evidence` flag computed here from merge-gate's branch-protection read. **Chosen:** (b), the operator's decision on 2026-10-12. One home for the rule, and a consumer that forgets it cannot mistake a self-pinned branch for evidence.

**Is `readChokepointKeyRecord` kept?** **Chosen:** removed, with its unit test; `merge-gate.js` was its only caller.

**Where is the ref-name check?** Options: in `readTrustFile` (changes FAFF-1210's module); in `merge-gate.js`. **Chosen:** in `merge-gate.js`, reusing FAFF-1178's validator when exported.

## 7. Open questions and assumptions

**Open questions.**

None. The `evidence` question was settled by the operator on 2026-10-12 (section 3).

**Assumptions.**

- **Assumes:** FAFF-1178 has merged `plugin/skills/faff/bin/lib/commissaire-verify.js` exporting `resolveAdmittedKey` (`custody: null` exactly when the run has no governance material, no trust read with `{ not_read: true }`) and `verifyGrant` with the input and result shapes in its attached spec (Linear comment 052cb980 on FAFF-1178): `{ run_dir, unit_id, step, effect: { kind, target }, trust, governor_dir?, producer_dir? }` in, `{ outcome, reason, custody, classification, signer_fingerprint, verdict_seq, trust_source }` out, `not-applicable` without any read when the run has no governance material, and no exceptions. FAFF-1178's amended spec adds an optional `run_id` input to both functions (the expected run id, default `basename(run_dir)`); `checkLeg` omits it, because merge-gate always verifies the live run directory. Validate: `node -e 'console.log(Object.keys(require("./plugin/skills/faff/bin/lib/commissaire-verify.js")))'` lists `verifyGrant` and `resolveAdmittedKey`, and FAFF-1178 is Done. `checkLeg` does not rely on `custody: null` alone: step 4 treats any probe that reports a failure as governed, so a FAFF-1178 build that leaves `custody` null on `ledger-malformed` still fails closed (the garbled-ledger test above covers it).
- **Assumes:** in-process `commissaire contract admit` writes both `commissaire/governor/governor.json` and `commissaire/producer/pk.json` (today `cmdAdmit` in `commissaire.ts` writes `governor.json` with `writeOwnerOnlyJson(governorFileOf(...))` and publishes `pk.json`), which the smoke test's `pk-fingerprint-tampered` expectation relies on. Validate: after an in-process admit in a temp run dir, both files exist.
- **Assumes:** `readTrustFile` in `commissaire-trust.js` keeps the FAFF-1210 signature `({ repoDir, ref, transport, repoSlug })` returning `Result<TrustRead, TrustFileError>`. Validate: read its export before building.

## 8. Done

### From why
- [ ] `merge-gate.js` no longer requires `./commissaire` and reads no file under `commissaire/producer/` or `commissaire/governor/` itself.
- [ ] The merge leg checks the grant against the PR's `baseRefName`; no leg passes a `null` or empty target.

### From what
- [ ] `resolveCommissaireDecisionGrant`, `resolvePrCreateGrant` and `resolveBranchDeleteGrant` keep their names and three-state returns; `...Detail` variants return `LegCheck` with the fields in section 3.
- [ ] `merge-gate --json` and `pr-create --json` include `commissaire_grants` when any leg is not `not-applicable`, and omit it otherwise. Every leg in one invocation shares the run's governance state, so the field is either absent or carries one entry per checked leg in check order: `merge-gate --delete-branch` on a governed run gives two entries (`merge`, then `branch-delete`), without `--delete-branch` one.
- [ ] A refusing leg adds `Commissaire <leg> grant refused: <reason>` to the blockers; `decideFloor`'s own blocker text and `--describe` output are unchanged.

### From how
- [ ] An ungoverned run makes no trust-file read and no `gh api .../contents/...` call (asserted with a stubbed `gh` that logs its arguments).
- [ ] A governed run reads the trust file exactly once per command invocation, across the merge leg, the branch-delete leg and both suppression checks, whether the legs pass or refuse.
- [ ] A `commissaire_grants` entry has `trust_source` `not-read` exactly when the leg refused before the trust read: `governance-required-sentinel`, a probe failure from step 4 (for example `ledger-malformed`), `trust-context-missing`, `base-ref-invalid`, `repo-slug-unresolved` or a `verify-error` from the probe. Every entry produced after the read was attempted, including `trust-file-invalid`, has `remote-base` or `local-ref` by transport.
- [ ] An entry's `signer_fingerprint` is null whenever the probe or `verifyGrant` bound no key (for example `governor-key-not-admitted` after a swapped `pk.json`); it never carries a value read from `pk.json` alone.
- [ ] If governance material is deleted between the probe and the verify call (test passes `deps` stubs to `checkLeg`: `resolveAdmittedKey` returns a custody, `verifyGrant` returns `not-applicable`), the leg refuses with `governance-changed-during-check`, never `not-applicable`.
- [ ] The repo slug is checked against FAFF-1178's `--repo` pattern on the merge-gate PR path as well as pr-create.
- [ ] A merge grant whose declared target differs from the PR's base branch is no longer treated as covered: the merge refuses and the schema:2 suppression check returns false.
- [ ] A governed leg called without a trust context refuses with `trust-context-missing` and reads nothing; an ungoverned leg called without one returns `not-applicable`.
- [ ] Faff-side reasons fill `custody` from the probe and `signer_fingerprint` only when the probe bound a key, else null, and always set `classification` and `verdict_seq` to null.
- [ ] On a governed pr-create leg, the `gh pr create` arguments include `--base <base>` and `--repo <slug>`, where `<slug>` is the repository the trust file was read from; on an ungoverned one they are byte-identical to today (asserted with a stub `gh` that logs its arguments).
- [ ] On the merge-gate PR path, the trust file is read from the repository parsed from the PR's `url`, even when `gh repo view` returns a different slug (stub `gh` returning a fork slug for `repo view` and the parent in the PR `url`); every `commissaire_grants` entry carries that `repo_slug`. An unparseable `url` on a governed run refuses with `repo-slug-unresolved`.
- [ ] `merge-gate --local --merge-args "--delete-branch"` deletes no branch and adds no branch-delete entry, as today.
- [ ] `verify-error` writes the exception's `name` to stderr and never its message.
- [ ] Suppression checks add no `commissaire_grants` entries.
- [ ] A `trust-file-invalid` read refuses the leg and adds the blocker line; a `--local` leg reports `trust_source: "local-ref"`.
- [ ] The PR path and `pr-create` use the remote transport; `--local` uses the local transport.
- [ ] A base ref that fails the ref-name pattern gives `base-ref-invalid` on a governed leg and no read.
- [ ] `gh pr view` requests `baseRefName`. On a governed run, a response missing `baseRefName` (or `headRefName` under `--delete-branch`) exits 2; on an ungoverned run the same response behaves exactly as today (test with a stub `gh` omitting both fields).
- [ ] The schema:2 suppression checks reuse the merge (or pr-create) leg's pre-merge `LegCheck`: with a stub `gh` that fails every call after the merge, a granted governed merge still suppresses its schema:2 declare/observe trail.
- [ ] A run with the FAFF-1140 sentinel and no governance material refuses with `governance-required-sentinel`.
- [ ] A throwing `verifyGrant` (test stub) refuses with `verify-error`.
- [ ] A governed leg with no resolvable repo slug, or a slug failing FAFF-1178's `--repo` pattern, refuses with `repo-slug-unresolved`. On `pr-create`, `ghRepoSlug` runs at most once per invocation; the merge-gate PR path takes the trust slug from the PR `url` and makes no extra `ghRepoSlug` call for it.
- [ ] A governed run whose `declared-effects.jsonl` has a non-record line mid-file refuses every leg with `ledger-malformed` (or another named failure), never `not-applicable`, whatever `custody` the probe reports.
- [ ] A governed PR into a base branch named outside the ref pattern (e.g. `release 1.0`) refuses with `base-ref-invalid` and makes no trust read; the same PR on an ungoverned run behaves as today.
- [ ] Each `commissaire_grants` entry carries `base_ref` and `repo_slug`.
- [ ] Each `commissaire_grants` entry carries `evidence` and `evidence_basis`. Tests with a stub `gh`: a pinned `remote-base` grant whose rules include `pull_request` gives `evidence: true`; the same grant with no `pull_request` rule, with the rules call failing, or with unparseable rules JSON gives `evidence: false` and the matching basis; an `unpinned`, `in-process` or `local-ref` entry gives `evidence: false` and makes no rules call. In every case `state`, the blockers and the exit code match the run without the rules call.
- [ ] `hasPullRequestRule` is pure and covered by the merge-gate selftest; `extractRequiredChecks` and `branch-protection-check` output are unchanged.
- [ ] `readChokepointKeyRecord` is removed from `commissaire.ts` and its emit, its test is removed, and `npm run build` output is committed.

### From scenarios and acceptance criteria
- [ ] Adversarial test: a governor-custody run with a trust file pinning the real governor, `producer/pk.json` replaced by a runner-minted key pair, and self-signed grants appended. The merge, branch-delete and pr-create legs each refuse with reason `governor-key-not-admitted`.
- [ ] A grant from a pinned governor passes all three legs with classification `pinned`.
- [ ] An in-process governed run with no trust file passes and reports `custody: "in-process"`.
- [ ] The existing `not-applicable` tests for ungoverned runs pass with their assertions unchanged, apart from calls that passed a `null` target, which now pass a branch name. Governed wrapper tests pass a `TrustContext` (a local transport against a temp git repo with no trust file is enough).
- [ ] `faff regions check` passes.
- [ ] The full test suite passes.

### Integration smoke test

```
1. Admit a governed in-process run with `commissaire contract admit`; declare and authorize a pr-create grant for "main".
2. In a temp repo with a remote, put a stub gh on PATH that answers `repo view` with a slug, returns 404 for the
   trust-file contents path and 200 for the repo root, and succeeds for `pr create`. Run `faff pr-create --run-dir <run> --issue FAFF-1 --base main --body-file b.md --title t --json`.
   EXPECT verdict "opened", commissaire_grants[0] = { leg: "pr-create", outcome: "valid-grant", custody: "in-process", trust_source: "remote-base" }.
3. Overwrite producer/pk.json with a fresh key pair and append a self-signed pr-create grant; rerun.
   EXPECT verdict "refuse", exit 1, commissaire_grants[0].reason "pk-fingerprint-tampered"
   (in-process admit writes governor.json, so the bound key is the governor.json key and pk.json now disagrees).
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Bundled behaviour change (review round 10, minor, not acted on):** forwarding `--base` and `--repo` to `gh pr create` on governed legs is a second behaviour change riding in this ticket. It stays here because the check target and the PR's real base must agree for the grant check to mean anything.
- **Right-sized (principle 4):** no issues. One unit: swap the grant check in `merge-gate.js` for `verifyGrant`, fix the leg targets, add the output field, retire `readChokepointKeyRecord`. Size S holds.
- **Workstream fit (principles 1 and 5):** no issues. The work sits in the outcome-named project "Governed execution is compared with a strong one-shot control" and is the faff half of the FAFF-1178 split.
- **Surfaced dependencies (principle 6):** one gap, now closed. FAFF-1219's done list requires `merge-gate`, pr-create and branch-delete to refuse through the verify function "(FAFF-1212)", but FAFF-1219 listed FAFF-1212 only as related. Prep added the link FAFF-1212 blocks FAFF-1219 on 2026-10-12.
- **Risk profile (principle 7):** no spike needed. No new integration; the one risk is building against FAFF-1178's interface before it ships, which the FAFF-1178 blocker link already sequences.

confidence: high
build-tier: complex
spec-review: human-override (operator, 2026-10-12)

```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "assumes"}, {"marker": "assumes"}, {"marker": "assumes"}]}
```
