*Agent-written (Claude Code): FAFF-1417 spec, produced by interactive prep for the operator. Revised after spec-review rounds 1–2.*

# FAFF-1417: faff spec-review round and hold — move prep's round write, convergence and outage rules from prose into commands

> Spec: faffter-dark-nlspec · 2026-10-31 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1417.

> 2026-11-01 operator amendment: ten existing tests that pinned the replaced prep prose (in `spec-review-pin`, `spec-review-window`, `spec-review-convergence`, `spec-review-churn` and `spec-review-iteration-cap`) are repointed to assert that `faff-prep/SKILL.md` calls `faff spec-review round` / `hold` at the right points. Every guarantee they protected maps to a command-level test in `test/spec-review-round.test.mjs`, each shown to fail under a mutation that breaks it; the PR carries the mapping. Tests only, no behaviour change.

This spec is for the build agent and its reviewers. It replaces the post-dispatch half of faff-prep's Spec-review gate (the round-record write, the contract pipe, routing, churn, the loop cap, convergence and window governance) with one verb, `faff spec-review round`, and the two hold dispositions (provider outage and turn budget) with a second verb, `faff spec-review hold`.

## 1. WHY

**The load-bearing idea:** after the `spec_review` occupant returns, every step prep takes is already a CLI call or a file read. What the prose carries is the order of those calls, which result wins, and the exact park cause. That sequencing becomes code. The skill keeps the dispatch, the judgement steps (ratify, the judge's rulings, re-spec) and one branch on a typed `action`.

**Problem.**
- The post-dispatch rules are spread across `faff-prep/SKILL.md` (663 lines at `948a8f1d`, baseline 664): the window-governance paragraph and its three bullets (l. 98–106), the consumer-fold and routing table (l. 145–169), the loop-cap and convergence paragraphs (l. 229–231, two paragraphs of about 600 words), the outage disposition, its pseudocode and resume rule (l. 254–294), the turn-budget hand-back (l. 300–319) and the park-cause list (l. 325). Every prep re-reads them every turn.
- Every interactive prep this session ran the same steps through a hand-written runner (`round.sh` plus a `post.mjs`, re-typed per ticket: FAFF-1436, FAFF-1442, FAFF-1443, FAFF-1444). The scripts stop at the aggregate; the write-then-pipe order, churn and cap were then done by hand.
- The hold counters exist only in prose. No code reads or writes `outage_holds` or `turn_budget_holds` (`grep` over `bin/lib` finds them only in comments), so the corrupt-store and exhaustion rules have never run under a test.
- The prose leaves four things open that the code must decide: when churn is checked (the prose says "on the second round"; recent preps check every round), how the loop cap counts (the counter is agent-held, so it restarts with each session), how the in-turn outage retry counts its attempts, and what a hold write does to the other hold's counter.

### Design principles

**Compose, never re-implement.** The verb calls the existing pure functions in process: `nextRoundNumber`, `readWindowStart`, `writeWindowStart` and `govern` (`spec-review-window.js`), `contractSpecReviewVerdict` (`contract-defs-review.js`), `routeRejectApproach` (`spec-review.js`), `detectSpecReviewChurn` and `readRoundRecord` (`spec-review-churn.js`), `detectSpecReviewConvergence` and `roundFilesInDir` (`spec-review-convergence.js`) and `resolveReviewIterationCap` (`spec-review-iteration-cap.js`). No trigger, threshold or vocabulary is restated.

**Local effects only; return tokens for the rest.** `round` writes only the scratch-dir files the prose already writes (`round-<n>.json`, `governance-<n>.json`, `window.json`) plus three additive sidecars (§3). `hold` writes only `.faff/resume/<ISSUE>/spec-review-hold.json`. Tracker comments, label writes, the park protocol, the judge and re-spec stay with the skill, returned as typed fields.

**Fail toward a human.** Every state the prose parks on still parks. Where the prose is silent, the code takes the branch that parks or holds sooner, never the one that admits sooner.

**The operator's accept stays the operator's.** In interactive mode the verb's `park` is a recommendation the skill surfaces, with the facts the operator's own rule reads (the latest round's severities, new lenses, cap state). It never blocks a human accept.

### Reference context

| System | Relevance |
|---|---|
| `plugin/skills/faff-prep/SKILL.md` | The prose replaced (line ranges above). Anchor phrases `never end a turn` and `in-flight marker` live in the Turn-survival paragraph (l. 143), which stays. |
| `bin/lib/spec-review.js` (legacy JS, `region:factory`) | The `faff spec-review` dispatcher (`cmdSpecReview`, l. 144). It gains two verbs that delegate to the new modules; its selftest is untouched. `routeRejectApproach` (l. 44) is reused. |
| `bin/lib/spec-review-window.js` | `nextRoundNumber` l. 50, `readWindowStart` l. 81 (absent → 1, corrupt → throws), `writeWindowStart` l. 106, `govern(dir, n, servedness)` l. 177 (writes `governance-<n>.json` on every non-usage path). |
| `bin/lib/spec-review-churn.js`, `spec-review-convergence.js` | Pure comparators over `{verdict, objections}` round records; the convergence CLI reads every record in the window regardless of verdict. |
| `bin/lib/contract-defs-review.js` | `contractSpecReviewVerdict` l. 231; `round_recorded:false` with `approve` is a violation (l. 223). |
| `bin/lib/resume-store.js` | `PREP_HOLD` l. 25; `takeLock` and `recover` exported; `stash` copies the prep hold into its swap (l. 235), so an unlocked hold write can be lost to a concurrent stash. |
| `bin/lib/lights-out.js` l. 1621 | Writes a `cause:"reconsider-input-changed"` hold with no counters (the git-only reconsider path). |
| `bin/lib/config-core.js` l. 163–182 | `prep.spec_review_outage_retry_limit` (2), `prep.spec_review_outage_hold_limit` (3), `prep.spec_review_turn_budget_hold_limit` (3). |
| `bin/lib/run-checkpoint.ts`, `run.ts` (FAFF-1436) | The TypeScript composer pattern (injected deps, pure decision function, layout d) this follows. |

### Already shipped against this surface

- **FAFF-707 / FAFF-874 / FAFF-909 / FAFF-1052**: churn, convergence, the persisted window and window governance, each a CLI. This ticket composes them; none changes.
- **FAFF-900 / FAFF-950**: the outage and turn-budget holds, specified in prose only. This ticket gives them their first code.
- **FAFF-1204**: `faff spec-review route`. Reused in process; the verb stays for its other caller (`faffter-noon-spec-review/SKILL.md` names it).
- **FAFF-1406**: `faff prep attach`, the attach-side extraction this ticket's blocker. Merged.

The premise holds: no Done ticket composes the post-dispatch sequence or implements the hold counters.

## 2. OUT OF SCOPE

- **The pre-dispatch half of a round.** Ratified-scope assembly and the tracker-resolution fold (l. 108–141), the in-flight marker bracket (l. 143), lens selection and the occupant dispatch stay in prose. **Extension point:** a `--prelude` mode on `faff spec-review round` that runs the assemble and fold calls.
- **The judge.** Case-file assembly, the two-phase dispatch and `spec-judge-evidence --admit` (l. 233–252) are unchanged. `round` returns `action: judge` where the prose would consult it.
- **Ratify, re-spec, the L4 `/faff-plot --autonomous` invocation and the evidence collation** (l. 171–227, l. 296–298) stay in prose; `round` returns the facts they need.
- **The occupant's per-lens transcript rule** that assumes an in-turn retry reuses the round number (`faffter-dark-spec-review/SKILL.md` l. 213). The round number is already derived from disk there, so it never collides; the stale wording is left for a separate edit.
- **`faff-tidy`'s stale-hold clear** (`faff-tidy/SKILL.md` l. 282) could call `hold --clear`; not changed here.
- **The lights-out reconsider hold writer** (`lights-out.js` l. 1621) keeps its own unlocked write.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| scratch dir | The per-spec dir `faff spec-review-dir` prints; every file below lives in it. |
| round record | `round-<n>.json`, exactly `{verdict, objections}` as the occupant's block carried them. |
| loop round | A round record whose verdict is `revise` or `reject-approach`. |
| would-be-park | The point where the prose parks unless the L3–L4 judge intercepts: churn, or the cap reached without convergence. |
| decision record | `decision-<n>.json`, the RoundResult the gate returned for round `n`. |
| cap reset | `cap-reset.json {from_round, reason, after_decision, ts}`, written when a human unparks; loop rounds before `from_round` no longer count. |
| ratified round | A loop round whose every objection the human ratified; marked by `ratified-<n>.json {round, comment_id, ts}`, excluded from the cap count. |
| hold store | `.faff/resume/<ISSUE>/spec-review-hold.json`. |

No sidecar name matches `^round-(\d+)\.json$`, so `nextRoundNumber`, churn, convergence, `collate-evidence` and `spec-judge-evidence` read the scratch dir exactly as today.

### Interface: `faff spec-review round`

```
faff spec-review round --issue <ID> --dir <scratch> --verdict-file <file|-> --mode interactive|autonomous
                       --occupant adversarial|single-pass [--served any|none] [--run-dir <dir>] [--appetite low|medium|high|full]
                       [--retry-limit N] [--root <dir>] [--json]
faff spec-review round --open-window --dir <scratch> [--json]
faff spec-review round --mark-ratified <n> --comment-id <id> --dir <scratch> --mode interactive [--json]
```

- `--issue` names the hold store (`<root>/.faff/resume/<ISSUE>/spec-review-hold.json`) whose `held_at_round` the outage attempt count reads.
- `--verdict-file` is the occupant's returned output; the verb locates the fenced `faff-contract:spec-review-verdict` block itself.
- `--occupant` is the lens selection's `mode` (`faff spec-review-lenses` prints it), which prep already holds. It decides whether the round is governed; pin files on disk never decide it.
- `--served` is the round's servedness for window governance: `any` when at least one lens returned exit 0, `none` when none did. It is required with `--occupant adversarial` and refused with `--occupant single-pass`.
- `--appetite` defaults to `faff config get appetite`; `--retry-limit` to `prep.spec_review_outage_retry_limit`. `--run-dir` defaults to `$FAFF_RUN_DIR`; its `run-ledger.json` `level` field is read as a whitelist (only the exact strings `L3` and `L4` count; absent, unreadable or anything else reads as neither).

```
RECORD RoundResult
  action: "approve" | "fix-and-rerun" | "park" | "judge" | "re-slice"
        | "retry-outage" | "hold-outage" | "surface-outage"
  round: int                          -- n, the round this call recorded
  window_start: int                   -- after governance
  verdict: string | null              -- null when no block was located
  cause: string | null                -- park and judge: the exact §4.3 park cause
  carried_design_objections: [{lens, severity}]   -- plot-destined only, else []
  outaged_lenses: [lens]              -- outage actions only, else []
  attempt: int | null                 -- outage actions: dispatches of this round that came back unavailable
  retry_limit: int | null
  cap: { limit: int, used: int, from_round: int, reached: bool, yielded: bool }
  churn: <spec-review-churn result> | null
  convergence: <spec-review-convergence result> | null
  governance: { action, anomaly?, window_start } | null
  summary: { max_severity: "blocker"|"major"|"minor"|null, counts: {blocker, major, minor}, lenses: [lens] }
  level: "L3" | "L4" | null
  retain: "spec-review: approve" | null
  warnings: [string]
```

- `--json` prints the RoundResult; without it, one line `<action> round <n>[: <cause>]`.
- **Exit 0** for every action, `park` included. **Exit 2** for a fault, with `{action: "errored", reason}` under `--json`: usage, an unreadable `--verdict-file`, a corrupt `window.json`, a scratch dir that cannot be created, `--occupant adversarial` without `--served`, or `--occupant single-pass` with `--served` or with this round's `served-<n>.json` in the scratch dir.
- Every `round` call ends by writing its RoundResult to `decision-<n>.json` (the audit record of what the gate decided).
- `--open-window` prints `{window_start, cap_from}`. It exits 2 unless the latest `decision-<k>.json` has action `park` or `judge`: the cap resets only after the loop actually stopped for a human, never mid-loop.
- `--mark-ratified` prints `{round, ratified: true}`. It exits 2 unless `--mode interactive` and `--comment-id <id>` are given (the re-attach comment carrying the human's neutralised quote, recorded in the sidecar), `round-<n>.json` is a loop round, and `decision-<n>.json` has action `fix-and-rerun` or `park`.

### Interface: `faff spec-review hold`

```
faff spec-review hold --issue <ID> --cause outage|turn-budget --mode interactive|autonomous
                      [--kind infra-configured|model-transient] [--lenses <csv>]
                      [--dir <scratch>] [--hold-limit N] [--retry-limit N] [--root <dir>] [--json]
faff spec-review hold --read  --issue <ID> [--root <dir>] [--json]
faff spec-review hold --clear --issue <ID> [--root <dir>] [--json]
```

```
RECORD HoldResult
  action: "hold" | "park" | "surface" | "read" | "cleared"
  token: "spec-review-held" | "spec-review-pending" | "parked" | null
  cause: string | null               -- park: the exact §4.3 cause
  holds: int | null                  -- the counter value after this call
  limit: int | null
  label_ops: [{ op: "add"|"remove", label: "faff-awaiting-spec-review" }]
  comment: string | null             -- the hold notice, verbatim, for the skill to post
  store_path: string
  store: { state: "absent"|"valid"|"corrupt", cause, outage_holds, turn_budget_holds, held_at_round } | null
```

- **Exit 0** for `hold`, `park`, `surface`, `read` and `cleared`. **Exit 2** for usage or an `--issue` failing `^[A-Za-z0-9][A-Za-z0-9._-]*$`, and for `--cause outage` without `--dir`, or with a scratch dir whose latest round record is not `unavailable` with its attempts above the retry limit (§4.4). **Exit 4** when the resume-store issue lock is held; the caller retries once and then treats it as `errored`.
- **Hold store shape** (all fields optional on read): `cause` (`outage` | `turn-budget` | `reconsider-input-changed`; absent reads as `outage`), `outage_holds`, `turn_budget_holds` (integers ≥ 0), `outaged_lenses`, `kind`, `pinned_reviewer`, `held_at_round`, `held_at`. Unknown keys are preserved on write.

### Where the code lives

| File | Change |
|---|---|
| `bin/lib/spec-review-round.ts` (new; `.js` emit committed) | `decideRound` (pure) and the `round` verb's I/O shell |
| `bin/lib/spec-review-hold.ts` (new; `.js` emit committed) | `decideHold` (pure) and the `hold` verb's I/O shell |
| `bin/lib/spec-review.js` | Two dispatch lines: `round` and `hold` delegate to the new modules; usage strings extended |
| `bin/lib/resume-store.js` | Export `releaseLock` (one line) |
| `tsconfig.json`, `test/check-no-boundary-cast.test.mjs`, `build-manifest.json` | Both new `.ts` files added to `include` and the pin list; manifest rebuilt |
| `plugin/skills/faff-prep/SKILL.md` | §4.6 |
| `bin/lib/validate-adapters.js` | `SKILL_LINE_BASELINE["faff-prep"]` lowered to the new count, with its comment entry |
| `docs/guide/cli.md` | Two rows beside `spec-review route` (l. 181) |
| `test/spec-review-round.test.mjs`, `test/spec-review-hold.test.mjs`, `test/fixtures/spec-review-round-corpus/` | §4.5 |

`spec-review` stays `factory` with its existing selftest argv; no region or `TEST_FILE_COVERAGE` change is needed, and no selftest case is added.

## 4. HOW

### 4.1 `round` procedure

**Summary:** record the round the way the prose orders it, then decide the next action from disk.

```
PROCEDURE round(dir, verdict_file, mode, occupant, served, run_dir, appetite, retry_limit):
  1. mkdir -p dir; n := nextRoundNumber(dir); window_start := readWindowStart(dir)   -- corrupt → exit 2
  2. occupant adversarial AND served absent → exit 2
     occupant single-pass AND (served present OR dir holds served-<n>.json for this n) → exit 2
  3. IF occupant adversarial:
       g := govern(dir, n, served)
       g.result present → window_start := g.result.window_start; any anomaly → warnings
       g.result absent  → window_start := n; warnings += "govern-fault: <detail>"
       governance-<n>.json absent or unreadable → window_start := n; warnings += "govern-record-missing"
  4. blocks := fenced faff-contract:spec-review-verdict blocks in verdict_file
     IF count != 1 OR JSON.parse fails → park "spec-review contract not satisfied (exit 2)"; write nothing; RETURN
  5. write round-<n>.json := { verdict: block.verdict, objections: block.objections }
  6. round_recorded := roundFilesInDir(dir) is non-empty
     c := contractSpecReviewVerdict({ verdict, objections, round_recorded })
     c.failLoud → delete round-<n>.json; park "spec-review contract not satisfied (exit 2)"; RETURN
     NOT c.contractData.conformant → delete round-<n>.json; park "spec-review contract not satisfied (exit 1)"; RETURN
  7. RETURN decideRound(inputs read from disk, c.contractData, mode, level(run_dir), limits)
```

`decideRound` is pure: it takes the records `[1..n]`, `window_start`, the cap reset, the ratified set, the hold store's `held_at_round`, the iteration cap, the retry limit, the mode and the level.

```
FUNCTION decideRound(...):
  approve      → action approve, retain "spec-review: approve"
  needs-human  → park "spec-review needs-human — <lens:severity, …>"          -- never the judge
  unavailable  →
     mode interactive → surface-outage, outaged_lenses
     attempt := count of consecutive unavailable records ending at n, numbered above held_at_round
     attempt <= retry_limit → retry-outage (attempt, retry_limit, outaged_lenses)
     ELSE → hold-outage (attempt, retry_limit, outaged_lenses)
  reject-approach →
     r := routeRejectApproach(contractData); r.error → park "spec-review route failed (exit 2)"
     r.destination = plot →
        mode autonomous AND level = L4 → re-slice, carried_design_objections
        ELSE → park plot cause (§4.3), carried_design_objections
     r.destination = prep → LOOP
  revise → LOOP

  LOOP:
     prev := the highest round record k < n with k >= window_start
     IF prev exists: churn := detectSpecReviewChurn(prev, curr, k)
        churn.churn → WOULD-PARK("spec-review churn detected — new objecting lens(es) since round k: <lenses>")
     limit := resolveReviewIterationCap(appetite).cap
     used  := loop rounds k in [cap.from_round .. n] with no ratified-<k>.json
     used < limit → fix-and-rerun
     convergence := detectSpecReviewConvergence(records in [window_start .. n])
     convergence.converging → fix-and-rerun, cap.yielded = true
     ELSE → WOULD-PARK("spec-review loop cap reached — <verdict>")

  WOULD-PARK(cause):
     mode autonomous AND level ∈ {L3, L4} → judge, cause
     ELSE → park, cause
```

- The churn check's `k` and the convergence window both use the post-governance `window_start`.
- A window of one record never yields: `detectSpecReviewConvergence` returns `converging: false` for fewer than two rounds (`spec-review-convergence.js` l. 84). So a swap round that resets `window_start := n` at the cap goes to would-be-park, never to a vacuous yield.
- **One `round` call per dispatch.** In autonomous mode each in-turn outage re-dispatch's output is passed to `round` too, which writes one `unavailable` record per dispatch (the shape FAFF-1170's rounds 3–5 already show). `attempt` therefore counts dispatches from disk.
- `outaged_lenses` are the lenses of the `unavailable` record's objections that carry no `claim`: `aggregate.mjs` names a down lens as a bare `{lens, severity}` (l. 89), while `parse-refutation.mjs` guarantees a `claim` on every gating objection from a served lens.
- `summary`, `cap` and `level` are filled on every return so the interactive skill can apply the operator's rule without re-reading the records.

**`--open-window`:** check the latest decision; `n := nextRoundNumber(dir)`; `writeWindowStart(dir, n)`; write `cap-reset.json {from_round: n, reason: "human-unpark", after_decision: k, ts}`. **`--mark-ratified n`:** write `ratified-<n>.json {round: n, comment_id, ts}`.

Both writes lift a termination bound, so neither trusts the caller alone: the reset needs a recorded stop, and the ratify mark needs interactive mode plus the audited comment the ratify procedure already posts. An agent cannot reset the cap every round, because a reset is refused until the loop parks again.

### 4.2 Decisions

- **Chosen:** one verb for the whole post-dispatch sequence, with the order fixed in code: govern, locate, write, pipe, then route. The prose's write-before-pipe rule (so an `approve` is backed by a record) becomes a step the agent cannot reorder. Alternative rejected: separate `record` and `decide` verbs, which leaves the order to the prose again.
- **Chosen:** check churn at every round against the previous round in the window, not only at the second round. The prose's "on the second round" reads as "on each round after the first" in practice: FAFF-1436 and FAFF-1444 both churn-parked at round 3. Checking every round can only park sooner. Alternative rejected: second round only, which lets a new objecting lens at round 3 loop until the cap.
- **Chosen:** count the cap from disk: loop rounds since the last human unpark, excluding fully ratified rounds. A reviewer swap resets the comparison window but not the cap, so a pin that flaps every round cannot loop forever. Alternatives rejected: counting from `window_start` (a flapping pin resets the cap) and counting every round ever (an unparked spec would cap-park on its first new round).
- **Chosen:** an `unavailable` verdict is recorded as a round like every other verdict, as the prose writes it and as the six historical `unavailable` records show. It is not a loop round, so it never counts toward the cap; churn and convergence read it exactly as the standalone CLIs do. Alternative rejected: keeping outages out of the round sequence, which would change what convergence compares and could let it yield where today's CLI does not.
- **Chosen:** derive the in-turn outage attempt from disk: the trailing run of `unavailable` records above the hold store's `held_at_round`. A resumed drain therefore gets its full in-turn retries again, as today's agent-held counter does. Alternative rejected: the agent passing `--attempt`, which is the agent-held counter this ticket removes.
- **Chosen:** a hold write preserves the other hold's counter and unknown keys. The prose says the two counters never mask each other's escalation; overwriting the store would reset one. Alternative rejected: writing only the fields the prose's example lists.
- **Chosen:** a corrupt hold store is renamed aside to `spec-review-hold.corrupt-<ISO>.json` before the park, not left in place and not deleted. In git-only mode the store's presence is the awaiting-spec-review signal, so leaving it would keep a parked issue in the prep queue; renaming keeps the evidence.
- **Chosen:** `hold` takes the resume-store issue lock (`takeLock`, `recover`, `releaseLock`), because `resume-store stash` copies the prep hold into its swap and an unlocked write in between is lost.
- **Chosen:** prep passes the occupant kind explicitly (`--occupant`, from the lens selection's `mode`) instead of the verb inferring it from pin files. A failed round-1 pin capture would otherwise make an adversarial loop look single-pass and skip governance silently; with the flag, a missing `--served` on an adversarial round is an exit 2, and `govern` surfaces the `round1-capture-missed` anomaly. Alternative rejected: inferring from `pinned-reviewer.json`, which fails open on exactly the capture fault it should catch.
- **Assumes:** the occupant's `round-<n>-<lens>.md` transcripts and `served-<n>.json` are written before prep calls `round`, as `faffter-dark-spec-review/SKILL.md` l. 146–163 orders today. Check: `govern` reads `served-<n>.json` for the same `n`.
- **Assumes:** a down lens appears in an `unavailable` block with no `claim` (`aggregate.mjs` l. 89, `parse-refutation.mjs`). Check both at build time; if either changes, `outaged_lenses` is the only field affected.

### 4.3 Park causes (exact strings)

| Source | Cause |
|---|---|
| no block / unparseable / failLoud | `spec-review contract not satisfied (exit 2)` |
| contract violations | `spec-review contract not satisfied (exit 1)` |
| `needs-human` | `spec-review needs-human — <lens:severity, …>` |
| route error | `spec-review route failed (exit 2)` |
| plot, no carried objections | `spec-review reject-approach (methodology at major or above) — needs /faff-plot re-slice` |
| plot, carried objections | the same, then `; design-lens objections carried: <lens:severity, …>` |
| churn | `spec-review churn detected — new objecting lens(es) since round <k>: <lenses>` |
| cap | `spec-review loop cap reached — <verdict>` |
| (not a park) `approve` | retained line `spec-review: approve`, returned as `retain` |
| hold, outage exhausted | `spec-review provider outage, <holds+1> held drains exhausted` |
| hold, turn budget exhausted | `spec-review turn-budget: <holds+1> held drains exhausted — spec may be too large or a backend degraded` |
| hold, corrupt store | `spec-review-hold.json corrupt — cannot read outage_holds` (or `turn_budget_holds`) |

### 4.4 `hold` procedure

```
PROCEDURE hold(issue, cause, mode, kind, lenses, dir, hold_limit):
  1. mode interactive → action surface; write nothing; RETURN       -- interactive never auto-holds
  2. cause outage: require dir, and the latest round record in dir is unavailable with
     its trailing attempt (§4.1) above the retry limit; else exit 2
  3. under the resume-store lock for issue:
     s := read store: absent → {}; unparseable, not an object, or the cause's counter
          present but not an integer >= 0 → CORRUPT
     CORRUPT → rename aside; park "spec-review-hold.json corrupt — cannot read <counter>";
               label_ops remove; RETURN
     holds := s[counter] or 0
     holds + 1 >= hold_limit → delete the store file only; park <exhausted cause>; label_ops remove; RETURN
     write s ∪ { cause, counter: holds + 1, kind?, outaged_lenses?, pinned_reviewer?, held_at_round?, held_at }
     action hold, token spec-review-held (outage) | spec-review-pending (turn-budget),
     label_ops add, comment <hold notice>
```

- `counter` is `outage_holds` for `outage`, `turn_budget_holds` for `turn-budget`. `hold_limit` defaults to `prep.spec_review_outage_hold_limit` or `prep.spec_review_turn_budget_hold_limit`.
- With `--dir`, `pinned_reviewer` is copied from `pinned-reviewer.json` when present, and `held_at_round` is the highest round record's number.
- Hold notices, verbatim: outage `spec-review provider unavailable; spec attached and held; attempt <holds+1>/<limit>; auto-resumes at review on the next drain`; turn budget `spec-review did not finish this turn; spec attached and held; attempt <holds+1>/<limit>; auto-resumes at review on the next drain`.
- **`--read`** reports `store.state` (`absent`, `valid`, `corrupt`) and the fields; a `reconsider-input-changed` store with no counters is `valid`. **`--clear`** deletes the store file only, never the `<ISSUE>` directory, and returns `label_ops` remove; it is idempotent.
- `hold` never emits a `faff-parked` label op: a hold is not a park. On `park` the skill runs the park protocol, which adds `faff-parked`.

**Anti-pattern:** deleting `.faff/resume/<ISSUE>/` on clear or exhaustion. Why: the build-side resume store shares that directory.

### 4.5 Tests (in `test/` only, `node --test`, no new `--selftest` cases)

- `test/spec-review-round.test.mjs`: one named case per rule-inventory row marked with a test; the six scenarios below; `decideRound` table cases for every action; each fault exit; `--open-window` and `--mark-ratified`; the governance fault and missing-record warnings with `window_start := n`.
- `test/spec-review-hold.test.mjs`: hold, exhaustion, corrupt rename, counter independence, unknown-key preservation, `--read` on all three states (including the lights-out `reconsider-input-changed` store), `--clear` leaving a sibling `hold.json` in place, the outage precondition, and the lock-busy exit 4.
- **Corpus replay.** Copy at least 12 historical scratch dirs from `.faff/spec-review/` and `.faff/runs/*/*/spec-review/` (at least one each with churn, a cap reach, an `unavailable` round and a `reject-approach` to plot; round records and `window.json` only) into `test/fixtures/spec-review-round-corpus/`. For every round `k >= 2`, run the CLI on a copy truncated to rounds `< k` with round `k`'s record as the occupant block, and assert: the written `round-<k>.json` deep-equals the original; `churn` equals `faff spec-review-churn --prev round-<k-1> --curr round-<k>`; and at a cap reach, `convergence` equals `faff spec-review-convergence --dir <copy> --window-start <ws>`. At build time also run the same replay over the full local corpus (281 dirs, 614 records at `948a8f1d`) and put the action counts and any mismatch in the PR description.

### 4.6 Skill edit (`faff-prep/SKILL.md`)

- The Reviewer-pin paragraph keeps the scratch-dir and occupant pin-dir sentences; its window-governance paragraph and three bullets become one sentence naming `round --served`, and the human-unpark sentence names `round --open-window`.
- The consumer-fold list, the routing table, the reject-approach route table, the loop-cap paragraph and the convergence-yield paragraph become: one call, `faff spec-review round … --json`, after the occupant returns; copy `warnings` into `prep.md`; and a routing table over `action` (approve, fix-and-rerun, park, judge, re-slice, retry-outage, hold-outage, surface-outage). The interactive row says the skill surfaces `park` with `summary` and `cap` and the human decides.
- The ratify procedure's step 4d names `round --mark-ratified` when every objection of the round was ratified.
- The outage pseudocode and the turn-budget pseudocode become `faff spec-review hold` calls and a token table; the in-turn retry passes every re-dispatch's output to `round` and calls `hold --cause outage` only on `hold-outage`; the resume paragraph uses `hold --read` and `hold --clear`. The turn-budget wall-clock wrap and its one in-turn re-attempt stay as prose.
- The park-cause list points at the command's causes.
- `hold` exit 4 (issue lock busy): retry once; a second exit 4 is `errored` (interactive: surface; autonomous: the existing `errored` return, which the run treats as a park). Any other non-zero `round` or `hold` exit is handled the same way.
- Scenario A's "(cap 2)" and Path 2's "(cap 2 iterations)" become references to the gate.
- `SKILL_LINE_BASELINE["faff-prep"]` is lowered to the new line count; `ANCHOR_PHRASES["faff-prep"]` are unaffected.

### 4.7 Edge cases and failure modes

- **Resumed loop.** `n` comes from disk, so a resumed loop appends and never overwrites `round-1.json` (FAFF-909's invariant, unchanged).
- **Approve on round 1.** The record is written before the pipe, so `round_recorded` is true.
- **A block with extra top-level keys.** Only `verdict` and `objections` are written to the round record; per-objection enrichment fields ride through unchanged.
- **Two blocks in one output.** Parks as `exit 2`: the prose names "the single fenced block", and picking one would be a guess.
- **Failure mode: a mis-ordered call.** The skill calls `round` before the occupant's `served-<n>.json` lands. Observable: a `govern-fault` warning naming a missing served record, and `window_start := n` (the safe reset).
- **Failure mode: cap count drift.** A human unpark without `--open-window` leaves the old count. Observable: an immediate `would-be-park` on the first post-unpark round, which parks (the safe side) and shows `cap.used` in the result.

**Anti-pattern:** calling `faff spec-review route`, `spec-review-churn` or `spec-review-convergence` beside `round` and acting on their output. Why: the verb already ran them in the order the gate needs; a second reading can disagree on the window.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a scratch dir holding round-1.json {"verdict":"revise","objections":[{"lens":"architectural","severity":"major"}]} and round-2.json {"verdict":"revise","objections":[{"lens":"architectural","severity":"minor"}]}
When `faff spec-review round --issue FAFF-9001 --dir D --verdict-file F --occupant single-pass --mode autonomous --appetite high --json` runs with F holding a spec-review-verdict block {"verdict":"revise","objections":[{"lens":"architectural","severity":"minor"},{"lens":"QA","severity":"minor"}]}
Then it exits 0 with action "park"
And cause is "spec-review churn detected — new objecting lens(es) since round 2: QA"
And D/round-3.json exists with verdict "revise"
```

```
Given an empty scratch dir
When `faff spec-review round --issue FAFF-9001 --dir D --verdict-file F --occupant single-pass --mode interactive --json` runs with F holding the block {"verdict":"approve","objections":[{"lens":"QA","severity":"minor"}]}
Then it exits 0 with action "park" and cause "spec-review contract not satisfied (exit 1)"
And D/round-1.json does not exist
```

```
Given a scratch dir holding revise rounds 1 and 2 with 3 and 2 architectural objections
When `faff spec-review round --issue FAFF-9001 --dir D --verdict-file F --occupant single-pass --mode autonomous --appetite medium --json` runs with F holding a revise block with 1 architectural minor objection
Then it exits 0 with action "fix-and-rerun"
And cap.limit is 3, cap.used is 3 and cap.yielded is true
```

```
Given R/.faff/resume/FAFF-9001/spec-review-hold.json holding {"turn_budget_holds":1}
When `faff spec-review hold --issue FAFF-9001 --cause turn-budget --mode autonomous --root R --json` runs
Then it exits 0 with action "hold" and token "spec-review-pending"
And the store holds turn_budget_holds 2 and cause "turn-budget"
And label_ops is [{"op":"add","label":"faff-awaiting-spec-review"}]
```

## 5. DESIGN DECISION RATIONALE

- **Why one verb per half.** `round` covers what happens after a verdict; `hold` covers what happens when there is none worth routing. The skill branches on one `action` or one `token` each time.
- **Why the stricter readings.** Each open point (churn timing, cap counting, two blocks, corrupt store) is settled toward an earlier park or hold. None admits a spec the prose would park.
- **Why sidecars, not a wider round record.** `round-<n>.json` stays `{verdict, objections}`, so every existing reader (churn, convergence, collation, the judge's case files) is untouched.
- **Why TypeScript.** New `bin/lib` modules are TypeScript (AGENTS.md); `spec-review.js` gets a two-line dispatch edit and stays JavaScript.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes:** the occupant writes `served-<n>.json` before prep calls `round` (§4.2). Check by reading `faffter-dark-spec-review/SKILL.md` l. 146–163 at build time.

## Rule inventory

Disposition key: `kept` = the command does what the prose says; `changed` = differs, with the reason; `kept in prose` = stays a skill step.

| # | Prose rule (`faff-prep` §, line at `948a8f1d`) | Command behaviour | Covering test | Disposition |
|---|---|---|---|---|
| P1 | Scratch dir resolved once; every round write and read under it (l. 98) | `--dir` | (skill text) | kept in prose |
| P2 | `window_start` read from disk, never agent-held (l. 98) | step 1 | "window read" | kept |
| P3 | Govern after each round with any-served or no-lens (l. 100) | step 3 | "govern any-served", "govern no-lens" | kept |
| P4 | Govern anomaly surfaced loud into `prep.md` (l. 102) | `warnings` | "govern anomaly" | kept |
| P5 | Govern non-zero → `window_start := n` (l. 103) | step 3 | "govern fault" | kept |
| P6 | Missing `governance-<n>.json` → `window_start := n`, `govern-record-missing` (l. 104) | step 3 | "govern record missing" | kept |
| P7 | Human unpark opens a new window at the next round (l. 106) | `--open-window`, only after a recorded park or judge | "open window", "open window refused mid-loop" | changed: also writes the cap reset; refused unless the loop stopped |
| P8 | The single-pass occupant is never governed (l. 106) | `--occupant single-pass` | "single-pass no govern" | kept |
| P9 | (none) | `--occupant adversarial` without `--served` → exit 2; single-pass with `--served` or this round's `served-<n>.json` → exit 2 | "served required", "single-pass served this round", "single-pass after old adversarial rounds" | changed: new, fail-closed |
| P10 | Churn and convergence compare only within `[window_start .. n]` (l. 106, l. 229) | LOOP | "window bounds churn" | kept |
| P11 | Ratified-scope assembly, exit codes, tracker fold (l. 108–141) | none | (skill text) | kept in prose |
| P12 | In-flight marker around the dispatch (l. 143) | none | (skill text) | kept in prose |
| P13 | No block or unparseable → needs-human park (l. 147) | step 4 | "no block", "bad json" | kept |
| P14 | (none) | more than one block → park | "two blocks" | changed: new, the prose assumed one |
| P15 | Contract exit 2 → park (l. 148) | step 6 | "fail loud" | kept |
| P16 | Contract exit 1 → park (l. 149) | step 6 | scenario 2 | kept |
| P17 | `approve` → confidence gate, both gates must pass (l. 156) | `approve`, `retain` | "approve" | kept |
| P18 | `revise` → fix in place, re-rate, re-review (l. 157) | `fix-and-rerun` | "revise" | kept |
| P19 | `reject-approach` routed by `spec-review route` (l. 162) | `routeRejectApproach` | "route prep", "route plot" | kept |
| P20 | Route exit 2 → park (l. 162) | park | "route error" | kept |
| P21 | Plot at L1–L3 or interactive → park, carried objections verbatim (l. 167) | park + `carried_design_objections` | "plot park carried" | kept |
| P22 | Plot at L4 → autonomous re-slice; level whitelist (l. 167, l. 218) | `re-slice` | "plot L4", "level whitelist" | kept |
| P23 | `needs-human` → park (l. 159) | park | "needs-human" | kept |
| P24 | `unavailable` → outage disposition (l. 160) | outage actions | "unavailable routes" | kept |
| P25 | Ratify procedure, scope test, quote audit (l. 171–214) | none | (skill text) | kept in prose |
| P26 | A ratified objection consumes no cap iteration (l. 201) | `--mark-ratified` excludes the round; interactive only, with the quote comment id | "ratified round not counted", "ratify refused autonomous" | changed: honoured when every objection of the round was ratified |
| P27 | Carried design-lens objections block (l. 216) | field | "plot park carried" | kept |
| P28 | L4 re-slice steps and plot refuse (l. 220–227) | none | (skill text) | kept in prose |
| P29 | Cap `N` from `spec-review-iteration-cap --appetite` (l. 229) | `resolveReviewIterationCap` | "cap by appetite" | kept |
| P30 | At the cap: human present or judge off → park; L3–L4 → judge (l. 229) | WOULD-PARK | scenario 4, "cap interactive park" | kept |
| P31 | Churn on the second round; churn → park, judge at L3–L4 (l. 229) | LOOP, every round | scenario 1 | changed: every round vs the previous in the window |
| P32 | No churn → proceed (l. 229) | LOOP | "no churn" | kept |
| P33 | Round number from disk; a resumed loop appends (l. 229) | step 1 | "resume appends" | kept |
| P34 | Write `round-<n>.json` verbatim before the pipe, hard floor (l. 229) | step 5 | "write before pipe" | kept |
| P35 | `round_recorded` from disk, piped with the verdict (l. 229) | step 6 | "approve round 1" | kept |
| P36 | Non-conformant pipe → delete the record (l. 229) | step 6 | scenario 2 | kept |
| P37 | (counter agent-held) | cap counted from disk since the cap reset, excluding ratified rounds | "cap from disk", "cap after unpark" | changed: deterministic counter |
| P38 | Converging → grant the round; not → would-be-park (l. 231) | LOOP | scenario 3, scenario 4 | kept |
| P39 | Judge only at L3–L4, never with a human present (l. 233) | WOULD-PARK | "interactive never judge" | kept |
| P40 | Config-fault `needs-human` bypasses the judge (l. 233) | `needs-human` parks directly | "needs-human no judge" | kept |
| P41 | Judge assembly, dispatch, roll-up (l. 235–252) | none | (skill text) | kept in prose |
| P42 | Interactive outage → surface, never auto-hold (l. 258) | `surface-outage`; `hold` → `surface` | "interactive outage" | kept |
| P43 | In-turn retry up to `retry_limit` (l. 259–264) | `retry-outage` / `hold-outage` | "outage retry count" | changed: attempt derived from disk |
| P44 | Re-dispatch only the still-outaged lenses (l. 262) | `outaged_lenses` from claim-less objections | "outaged lenses" | kept |
| P45 | Absent store → 0; corrupt → park, no increment (l. 266–273) | hold step 3 | scenario 6 | changed: the corrupt store is renamed aside |
| P46 | `holds + 1 >= limit` → park, remove label, delete the store file only (l. 274–279) | hold step 3 | "outage exhausted" | kept |
| P47 | Write the hold store (l. 281–282) | hold step 3 | "outage hold" | changed: preserves the other counter and unknown keys; adds `held_at_round`, `held_at` |
| P48 | Label add, hold notice, stay Backlog, `spec-review-held` (l. 283–287) | `label_ops`, `comment`, `token` | "outage hold" | kept |
| P49 | Never write the hold before the in-turn ceiling (l. 290) | outage precondition | "outage precondition" | changed: enforced |
| P50 | Never coerce an outage to approve; never dual-tag `faff-parked` (l. 292) | no approve path; no `faff-parked` op | "hold has no parked op" | kept |
| P51 | Resume: label + valid store skips re-production; conclusive verdict clears; label without a valid store is ordinary (l. 294) | `--read`, `--clear` | "read states", "clear keeps hold.json" | kept |
| P52 | Turn-budget wall-clock wrap and one in-turn re-attempt (l. 300) | none | (skill text) | kept in prose |
| P53 | Turn-budget interactive → surface (l. 304) | `surface` | "interactive turn budget" | kept |
| P54 | Turn-budget exhaustion → park, remove label, delete file only (l. 306–310) | hold step 3 | "turn budget exhausted" | kept |
| P55 | Turn-budget hold write, label, notice, `spec-review-pending` (l. 311–316) | hold step 3 | scenario 5 | kept |
| P56 | Corrupt `turn_budget_holds` → park, no increment (l. 319) | hold step 3 | scenario 6 | kept |
| P57 | The two counters are independent (l. 319) | counter preserved | "counters independent" | kept |
| P58 | A store without `cause` reads as outage (l. 319) | `--read` | "legacy store" | kept |
| P59 | No round record and no verdict on a hand-back (l. 319) | `hold` writes no round record | "hold writes no round" | kept |
| P60 | Modes: identical computation, only who acts differs (l. 321) | `--mode` changes only outage and judge actions | "mode parity" | kept |
| P61 | Park causes (l. 325) | §4.3 strings | one case per cause | kept |
| P62 | A `reconsider-input-changed` store is a resumable hold (l. 555) | `--read` valid | "reconsider store" | kept |

## 7. DONE

### From WHY
- [ ] `faff-prep/SKILL.md` calls `faff spec-review round` and `faff spec-review hold` in place of the prose in §4.6, and `SKILL_LINE_BASELINE["faff-prep"]` is lowered to the new count with its comment entry.
- [ ] `faff validate-adapters` passes with no RATCHET finding for `faff-prep`.

### From WHAT
- [ ] `faff spec-review round --json` prints a RoundResult with every §3 field and exits 0 or 2 per §3.
- [ ] `faff spec-review hold --json` prints a HoldResult with every §3 field and exits 0, 2 or 4 per §3.
- [ ] `spec-review-round.ts` and `spec-review-hold.ts` are in `tsconfig.json` `include` and the `check-no-boundary-cast` pin list, with committed `.js` emits and `build-manifest.json`; `node scripts/build-manifest.js check` passes.
- [ ] `docs/guide/cli.md` has rows for both verbs.
- [ ] The PR diff touches no `commissaire*` file.

### From HOW
- [ ] `decideRound` returns the §4.1 action for each verdict × mode × level combination in a table test.
- [ ] Every park cause in §4.3 is produced by at least one test, as an exact string.
- [ ] `hold --clear` and an exhausted hold delete only `spec-review-hold.json`; a sibling `hold.json` survives.
- [ ] `round-<n>.json` written by the verb deep-equals `{verdict, objections}` from the block.

### From HOW (edge cases)
- [ ] `--occupant adversarial` without `--served` exits 2; `--occupant single-pass` exits 2 when this round's `served-<n>.json` exists and proceeds when only earlier rounds' pin files exist.
- [ ] `--open-window` exits 2 when the latest `decision-<k>.json` action is not `park` or `judge`, and `--mark-ratified` exits 2 without `--mode interactive` and `--comment-id`.
- [ ] A hold write preserves `outage_holds` when it increments `turn_budget_holds`, and the reverse.

### Rule inventory
- [ ] Every line the PR deletes from `faff-prep/SKILL.md` maps to a row P1–P62. The PR description lists the deleted line ranges against row ids.
- [ ] Every row with a covering test has that test, by name, and it passes.

### Tests
- [ ] `test/spec-review-round.test.mjs` and `test/spec-review-hold.test.mjs` pass under `node --test`; no `--selftest` case is added.
- [ ] The corpus replay over `test/fixtures/spec-review-round-corpus/` passes, and the PR description reports the full-corpus replay's action counts and mismatches.
- [ ] `faff gates run` passes.

**Integration smoke test:**

```bash
d=$(mktemp -d)
printf '```faff-contract:spec-review-verdict\n{"verdict":"approve","objections":[]}\n```\n' > "$d/out.md"
faff spec-review round --issue FAFF-9001 --dir "$d/s" --verdict-file "$d/out.md" --occupant single-pass --mode interactive --json
# EXPECT exit 0, action "approve", round 1, retain "spec-review: approve", and $d/s/round-1.json present
```

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

- **Right-sized?** No issues, at the top of the range. Two TypeScript modules with pure decision functions, a two-line dispatch edit, two test files with a corpus fixture, and a prep skill edit. About 2–3 days. The split line, if needed, is `round` and `hold`: they share no code and either ships alone.
- **Workstream fit?** No issues. It is extraction #9 of the 2026-10-22 review's prose-to-code track, beside FAFF-1406 (prep attach, done) and FAFF-1436 (run checkpoint, done).
- **Deps surfaced?** FAFF-1406 (the blocker) is merged. FAFF-1443 edits the same skill's _Stage and attach_ section and `prep-attach.ts`; the only shared line is `SKILL_LINE_BASELINE["faff-prep"]`, so whichever lands second rebases that one number. Recommend FAFF-1443 first (High). FAFF-1442 (byte ratchet) will add a byte baseline for the same file; the second to land re-pins it. FAFF-1428 (rule-inventory gate) would check this ticket's inventory once it exists.
- **Risk profile?** Medium-low. Every behaviour change is toward an earlier park or hold; the corpus replay over 614 historical round records is the de-risking step.