# Spec — FAFF-797: Ledger auto-close for a merged-but-unclosed L3 run (the recovery verb)

> Spec: faffter-dark-nlspec · 2026-08-16 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-797.

This spec is for the build agent and human reviewers. It builds the *auto-close* half that FAFF-782 deliberately deferred: a merged-but-unclosed L3 run-ledger — the harness killed the orchestrator after a durable merge, before it wrote `record-outcome shipped` — is closed to its true terminal `shipped` state by a **new, distinct, `faff reconcile`-adjacent recovery verb**, and only when a re-run `post-merge-check` verifies the merged code. The write-authority direction was settled by the human on 2026-08-16 (unpark comment); this spec settles the two sub-questions the human left for prep — the exact staleness/merged-ness predicate, and reconcile-adjacent verb vs orchestrator-resume — against the shipped codebase.

## 1. WHY — Problem and Principles

**The load-bearing model.** A drain's *real work* (the merge) and its *ledger bookkeeping* (write the `shipped` outcome, flip `owner.status:"done"`) happen at different instants. FAFF-782 proved the gap is real: PR #641 merged durably on `main`, then the harness's background-task ceiling force-killed the orchestrator four minutes before it reached `record-outcome`. FAFF-782 shipped *detection* — `faff disposition` now surfaces a `merged-unclosed` attention item — but left the ledger stuck `owner.status:"running"`/`outcomes:{}`, requiring a human to re-run `post-merge-check` + `record-outcome` by hand against the persisted run-dir. This spec removes that manual reconciliation for the safe, provable case.

**Problem statement.** There is no headless path that closes a merged-but-unclosed ledger, so every truncated-post-merge drain needs manual recovery even though the code already shipped and can be re-verified deterministically. The FAFF-782 spec named the extension point and Punted the write-authority question `(decides: architecture)`; the human has now chosen the direction (unpark, 2026-08-16): *a new `faff reconcile`-adjacent recovery verb owns the auto-close write, gated on a passing `post-merge-check`.*

**Design principles.**

- **The read-only run-end family stays read-only.** `faff disposition` and `faff reconcile` are pure/read-only by contract (ADR-0056; disposition's stated "writes nothing" invariant). The auto-close write does **not** live in either — it lives in the new recovery verb, which reuses the *existing* ledger-close writer (`run-ledger record-outcome`). This is the design the human's chosen direction requires.
- **Scoped recovery write-authority, not impersonation.** The ledger rule "only the run's own agents write `owner.status`" (ADR-0008 lineage) is honoured by *not* pretending a killed run's agents are still alive. Instead a distinct, explicitly-authorised recovery verb holds a **narrowly-scoped** recovery write-authority — recovery of a verifiably-merged, verifiably-stale, unclosed run only — recorded as a deliberate exception in an ADR, exactly as ADR-0057 (graft's claim-holder self-release) and ADR-0098 (stale-claim reclaim) already scope two named exceptions to the same write-authority/monotonicity invariant.
- **Never mask a post-merge regression.** The auto-close is *gated* on a re-run `post-merge-check` returning `verified-ok`. A red (`verified-fail`) or absent/unrunnable (`unverified`) verdict **blocks** the close, leaving the existing `merged-unclosed` attention item standing for a human — the run is never silently greened over a regression.
- **Recover only the provable, close only what already happened.** The write records a truth that is already durable on `main` (the merge) — it is idempotent and non-destructive. It asserts nothing new about the world; it transcribes proven reality into the ledger the killed orchestrator never reached.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/disposition.js` | Node (CJS) | `readMergedMap` (merge-record `merged===true`) + `computeDisposition` already detect `merged-unclosed`. Reused verbatim as the read-only admission detector — never re-derived. |
| `plugin/skills/faff/bin/lib/runcheck.js` | Node (CJS) | `runIsHeld(ledger, nowMs, env)` — owner.status `running` + heartbeat fresher than `RUN_HEARTBEAT_STALE_SECS_DEFAULT`. Its negation is the "verifiably-stale / not-live" predicate. Reused; never a second liveness rule. |
| `plugin/skills/faff/bin/lib/heartbeat.js` | Node (CJS) | `overlayHeartbeat` / `effectiveHeartbeatIso` — the effective liveness instant (max of the heartbeat file and `owner.last_heartbeat`) the staleness check must read. |
| `plugin/skills/faff/bin/lib/post-merge.js` | Node (CJS) | `verifyPostMerge` — re-runs the UNIT rung in an ephemeral detached worktree at the recorded merge sha. `verified-ok`=exit 0, `verified-fail`=exit 1, `unverified`=exit 3. The gate. |
| `plugin/skills/faff/bin/lib/run-ledger.js` | Node (CJS) | `applyTerminalOutcome` + `record-outcome` under `mutateLedgerUnderLock` — the single tested ledger-close writer (outcomes[issue]=shipped, owner.status:done, issue-outcome close event). Reused as the write. |
| `plugin/skills/faff/bin/lib/merge-gate.js` | Node (CJS) | `writeMergeRecord` → `{pr, head_sha, merged:true, merged_at, integrity}`. Supplies `pr`/`head_sha` for the post-merge-check call. |
| `records/adr/0057-*.md`, `records/adr/0098-*.md` | prose | The two shipped scoped exceptions to the write-authority/monotonicity invariant — the precedent template for this verb's ADR. |
| `records/adr/0077-*.md` | prose | Two-class write authority: the ledger close is a trusted-side, evidence-class write — the recovery verb is trusted-side by construction. |
| `operations/ci/faff-cron.sh`, `operations/ci/l3-watcher.yml` | bash / Actions | The in-repo REFERENCE drain wrappers (already call `faff disposition`); the invocation site the recovery verb attaches to, mirrored for the operator. |

**Scope statement.** This sits at the L3 drain's run-end boundary — the same seam FAFF-782 addressed — adding the *write* half (a new recovery verb) over FAFF-782's *detection* half, plus its wiring into the reference drain wrappers' disposition arm.

## 2. OUT OF SCOPE

- **Auto-revert / reopen on a post-merge regression.** A `verified-fail` verdict blocks the auto-close and leaves the merged-unclosed attention item for a human; it does **not** trigger a revert or reopen. Why excluded: revert-on-regression is the separate, already-unbuilt post-merge "seam (b)" (FAFF-782 §2). Extension point: `post-merge.js`.
- **Closing a non-`shipped` terminal (parked/errored/routed-out) from evidence.** Recovery only ever writes `shipped`, and only behind merge-evidence + a green post-merge-check. A run killed *before* merge has no merge-record and is not recoverable here — it stays a generic `incomplete-ledger` item (a human looks). Why excluded: only a durable merge is provable from a persisted artifact; nothing else is.
- **Changing the live `fly-ci-l3-runner` deployment (`drain.sh`/`entrypoint.sh`).** Those files live on the fly app, not in this repo. Why excluded: this repo's PR cannot edit them. Extension point: an operator change mirrored from the reference wrappers (§7 Assumes) — the same boundary FAFF-782 drew.
- **Cross-host live-run detection beyond the heartbeat contract.** The staleness predicate is the shipped owner-emitted heartbeat signal (ADR-0008); no new host-id or cross-host store is added. Why excluded: ADR-0098 already ruled cross-host recovery is time/heartbeat-based, not identity-based. The recovery write is idempotent + non-destructive, so a residual cross-host race closes a ledger to the truth that already happened.
- **A `faff-parked` / needs-human ledger state.** Recovery closes to `shipped` or does nothing; it never invents a new outcome token.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| merged-unclosed | The FAFF-782 run-end state: an admitted issue absent from `outcomes`, whose `merge-record.json` shows `merged:true`. The merge is durable; only the ledger close is missing. |
| recoverable run | A merged-unclosed run that is **also** verifiably-stale (not live) **and** whose re-run `post-merge-check` is `verified-ok`. Only a recoverable run is auto-closed. |
| verifiably-stale | The negation of runcheck's `runIsHeld`: the effective owner heartbeat is older than `RUN_HEARTBEAT_STALE_SECS_DEFAULT` (900s) or `owner.status` is not `running`. A live run that merged seconds ago has a fresh heartbeat and is excluded. |
| recovery write-authority | The scoped, ADR-recorded exception that lets this one verb write `outcomes[issue]=shipped` + `owner.status:done` on a run whose own agents are gone — recovery of a verifiably-merged/stale/unclosed run only. |

**The recovery verb (the new surface).**

**Chosen:** a **distinct, top-level `faff reconcile-recover` verb** — reconcile-adjacent in the run-end integrity family, never folded into `faff reconcile` (which stays pure per ADR-0056). Rationale: the human's direction names "a `faff reconcile`-adjacent recovery verb"; a sibling top-level verb reads as adjacent-to-reconcile at the CLI while keeping `reconcile`/`disposition` read-only. The verb is a *thin composition* — it invokes the shipped read-only detectors and the shipped write core; it introduces no new detection, liveness, gate, or write logic of its own. (The command surface is low-stakes: a `faff run-ledger recover` subcommand would be equally valid since the write core lives there. `reconcile-recover` is chosen for the read-side adjacency the human named; the build agent may realise it as either without re-opening this decision.)

```
faff reconcile-recover --run-dir DIR --issue ISSUE-ID --level L1|L2|L3|L4 [--json] [--dry-run]
  # --pr / --sha are read from <run-dir>/<issue>/merge-record.json; --sha override allowed (parity with post-merge-check)
  # exit 0  → recovered (outcomes[issue]=shipped, owner.status:done written) OR nothing to do (already closed) — idempotent clean
  # exit 1  → NOT recovered because the post-merge-check gate is red/absent (verified-fail | unverified) — the blocking outcome
  # exit 2  → usage / malformed input (bad issue-id, missing flag)
  # exit 3  → NOT recoverable on admission (not merged, not unclosed, or NOT verifiably-stale i.e. the run still looks live) — fail-safe no-op
```

**Recovery result (`--json`, illustrative).**

```
{ "verb": "reconcile-recover", "run_id": "run-…-l3", "issue": "FAFF-417",
  "recovered": true, "admission": "recoverable",
  "predicate": { "merged": true, "unclosed": true, "verifiably_stale": true },
  "post_merge_check": "verified-ok", "pr": 641, "merge_sha": "abc123de",
  "wrote": { "outcome": "shipped", "owner_status": "done" } }
```

**Admission predicate (the pure core).** A single pure function `admitRecovery({ ledger, issue, merged, held })` — testable in isolation, no filesystem — returns `recoverable | not-merged | not-unclosed | live`:

```
admitRecovery(ledger, issue, merged, held):
  IF NOT merged:                                RETURN "not-merged"      # merge-record.merged !== true → exit 3 no-op
  IF issue NOT in ledger.admitted
     OR issue in ledger.outcomes:               RETURN "not-unclosed"    # already closed / never admitted → exit 3 no-op
  IF held === true:                             RETURN "live"            # runIsHeld → the run is still live → exit 3 no-op
  RETURN "recoverable"
```

- `merged` is `readMergedMap(runDir, admitted)[issue] === true` (disposition's shipped substrate — reused, not re-read a second way).
- `held` is `runIsHeld(ledger, Date.now(), process.env)` computed against the **effective** heartbeat (`overlayHeartbeat` applied first, so a heartbeat-file tick is honoured). This is the sole "is it live?" signal — the same one runcheck's Stop-hook trusts.
- Admission is entirely read-only; the write happens only on `recoverable` after the gate.

## 4. HOW — Behavior

**Architecture.** The verb is a four-step pipeline over shipped primitives: **detect (read-only) → gate (post-merge-check) → write (record-outcome) → report.** No step re-implements logic that already exists.

```
PROCEDURE cmdReconcileRecover(runDir, issue, level, dryRun):
  1. Validate: issue matches ISSUE_ID_RE; run-dir has run-ledger.json; else exit 2/3 (parity with post-merge-check / record-outcome).
  2. ledger   = readLedger(runDir)                                  # malformed → exit 2 (parity with disposition)
     overlayHeartbeat(runDir, ledger)                               # fold the effective heartbeat instant
     merged   = readMergedMap(runDir, ledger.admitted)[issue] === true
     held     = runIsHeld(ledger, Date.now(), process.env)
     admission = admitRecovery(ledger, issue, merged, held)
  3. IF admission !== "recoverable": print + return exit 3 (no-op, fail-safe)   # not merged / already closed / still live
  4. GATE — re-run post-merge-check for this issue:
       rec = readMergeRecord(runDir, issue)   # {pr, head_sha}
       verdict, exit = verifyPostMerge({ issue, pr: rec.pr, runDir, root })
       IF verdict !== "verified-ok":            print + return exit 1        # verified-fail OR unverified/absent → BLOCK
  5. IF dryRun: print "would recover" + return exit 0                        # inspect without writing
  6. WRITE — reuse the existing locked ledger-close writer:
       recordOutcome({ issue, outcome: "shipped", runDir })                 # applyTerminalOutcome under mutateLedgerUnderLock
       # → outcomes[issue]="shipped", owner.status="done", issue-outcome close event appended
  7. Emit the recovery result (--json) / one-line summary; return exit 0.
```

- **Idempotent + re-entrant.** Re-running after a successful recovery re-reads `issue in outcomes` → `not-unclosed` → exit 3 no-op. Two concurrent recoveries serialise on `mutateLedgerUnderLock`; the second sees the closed ledger and no-ops. Nothing is double-written or corrupted.
- **The gate is the whole safety.** `post-merge-check` runs the project's *own* declared UNIT rung against the *actually-merged* sha (from `merge-record.json`) in an ephemeral worktree. A regression that landed on `main` post-merge fails the rung → `verified-fail` → exit 1 → the ledger stays open and the `merged-unclosed` attention item stands. An absent UNIT rung → `unverified` → exit 3-from-gate → also blocks (a merge we cannot re-verify is not auto-closed). This is the "a red or absent post-merge-check must block" rule the human named, realised exactly.
- **The write is trusted-side (ADR-0077).** The recovery verb runs from the drain wrapper / orchestrator layer — the trusted side of the dispatch cut — so writing the ledger-close evidence is authorised by ADR-0077's two-class model, not a lane self-marking its homework.

**Layer — invocation wiring (where auto-close fires).** **Chosen:** the recovery verb is invoked from the **drain wrapper's disposition arm** — the same layer that already runs `faff disposition --run-dir <run>` at run-end (FAFF-782). On a `merged-unclosed` disposition, the wrapper calls `faff reconcile-recover --run-dir <run> --issue <issue> --level L3` per merged-unclosed issue; a green recovery closes the ledger and the re-run disposition is clean, a blocked recovery leaves the attention item. Rationale: the wrapper already holds the abandoned run-dir and already branches on disposition's exit — this is the minimal, lowest-coupling attachment, and it keeps recovery a *deliberate headless step*, never a dead orchestrator resuming as itself. In-repo this is wired into the reference wrappers (`operations/ci/faff-cron.sh`, `operations/ci/l3-watcher.yml`) and documented in `docs/guide/self-hosted-rig.md`; the live `fly-ci-l3-runner` mirrors it operationally (§7 Assumes — the FAFF-782 boundary).

**Anti-pattern:** putting the write inside `faff reconcile` or `faff disposition`. Why: it breaks their pure/read-only contract (ADR-0056; the disposition module invariant), the exact invariant this design preserves by using a distinct verb.

**Anti-pattern:** resuming/re-minting the killed run to write the close "as its own agent". Why: the orchestrator is gone; impersonating it re-imports the write-authority tension the recovery verb exists to avoid, and re-minting an L3 ledger risks the downgrade guards `run-ledger` already refuses (`isLiveHigherLevel`).

**Anti-pattern:** treating `owner.status:"running"` alone as recoverable. Why: a *live* run is also `running`; the discriminator is the *stale* heartbeat (negation of `runIsHeld`) intersected with merge-evidence and unclosed-audit — never `running` on its own.

**Failure modes.**

- **The failure:** a live run merged seconds ago and hasn't yet called `record-outcome`. **How you'd know:** its effective heartbeat is fresh → `runIsHeld` true → `admitRecovery` returns `live` → exit 3 no-op. **What it means:** correct — recovery never races a live close; the run closes itself moments later. Proceed.
- **The failure:** the merged code carries a regression that fails CI post-merge. **How you'd know:** `post-merge-check` → `verified-fail` → exit 1, no write. **What it means:** correct — the ledger stays open, the `merged-unclosed` attention item stands, a human looks. Proceed.
- **The failure:** the repo has no discoverable UNIT rung, so the merge can't be re-verified. **How you'd know:** `post-merge-check` → `unverified` → the gate blocks (exit 1 from the verb). **What it means:** fail-safe — an unverifiable merge is not auto-closed; it degrades to the existing manual path. Proceed.
- **The failure:** `merge-record.json` is corrupt/partial (killed mid-write). **How you'd know:** `readMergedMap` omits the issue → `merged:false` → `not-merged` → exit 3 no-op. **What it means:** correct fail-safe — an unprovable merge is never asserted; identical to FAFF-782's degrade direction. Proceed.
- **The failure:** two drains recover the same run-dir concurrently (cross-host). **How you'd know:** `mutateLedgerUnderLock` serialises; the loser re-reads `issue in outcomes` → no-op. **What it means:** acceptable — the write is idempotent and records an already-durable merge; no corruption, no double-effect. Proceed.

## 5. Scenarios

```
Given an admitted issue FAFF-417 absent from outcomes, owner.status:"running" with a heartbeat older than 900s
  And <run-dir>/FAFF-417/merge-record.json has merged:true (pr 641, head_sha abc123)
  And the UNIT rung passes at abc123
When faff reconcile-recover --run-dir <run> --issue FAFF-417 --level L3
Then post-merge-check returns verified-ok
  And the ledger is closed: outcomes["FAFF-417"]="shipped", owner.status="done"
  And an issue-outcome close event is appended
  And the verb exits 0 (recovered)
  And a re-run faff disposition on the run is clean
```

```
Given the same merged-unclosed FAFF-417 but the UNIT rung FAILS at the merged sha (post-merge regression)
When faff reconcile-recover ... --issue FAFF-417 --level L3
Then post-merge-check returns verified-fail
  And NOTHING is written to the ledger (owner.status stays "running", outcomes stays {})
  And the verb exits 1 (blocked)
  And faff disposition still reports the merged-unclosed attention item for a human
```

```
Given an admitted issue absent from outcomes, owner.status:"running", but a FRESH heartbeat (< 900s — the run is live)
When faff reconcile-recover ... --issue FAFF-417 --level L3
Then admission is "live"
  And post-merge-check is never invoked and nothing is written
  And the verb exits 3 (no-op, fail-safe — never races a live run)
```

```
Given an admitted issue with NO merge-record.json (killed before the merge)
When faff reconcile-recover ... --issue <issue> --level L3
Then admission is "not-merged"
  And nothing is written; the verb exits 3 (stays a generic incomplete-ledger item for a human)
```

```
Given a run whose ledger already has outcomes[issue]="shipped" (already closed / re-run)
When faff reconcile-recover ... --issue <issue> --level L3
Then admission is "not-unclosed"
  And nothing is written; the verb exits 0 (idempotent clean — nothing to do)
```

- A `reconcile-recover --selftest` fixture table drives the pure `admitRecovery` across every admission branch (recoverable / not-merged / not-unclosed / live), mirroring `disposition --selftest`. The gate + write paths are exercised by an integration selftest that mints a run-dir + a real merge (parity with `post-merge --selftest`).

## 6. Design Decision Rationale

**Reconcile-adjacent verb vs orchestrator-resume entry point (the human's sub-question 2).** Options: (a) a distinct recovery verb composing the read-only detectors + the shipped write core; (b) an orchestrator "resume" path that re-enters the killed run and closes it as its own agent. **Chosen:** (a) a distinct verb. Rationale: the killed orchestrator is *gone* — there is no live agent to resume, and re-minting one to write the close is precisely the "impersonate the killed run's agents" move the human's chosen direction rejects; it also collides with `run-ledger`'s live-higher-level downgrade guard. A distinct verb holding a named, scoped recovery write-authority is the design ADR-0057/0098 already established for two sibling exceptions, and keeps `reconcile`/`disposition` pure (ADR-0056).

**The staleness/merged-ness predicate (the human's sub-question 1).** Options for "is this run genuinely stale vs live": a file-mtime heuristic; a tracker/forge probe; the shipped owner-emitted heartbeat. **Chosen:** the owner-emitted heartbeat — recovery admits iff `merged (merge-record.merged===true)` ∧ `unclosed (admitted ∖ outcomes)` ∧ `verifiably-stale (¬runIsHeld against the effective heartbeat)`, then gated on `post-merge-check == verified-ok`. Rationale: ADR-0008 already ruled liveness is owner-emitted on-disk heartbeat state, never mtime or out-of-band probes, and `runIsHeld` (900s `RUN_HEARTBEAT_STALE_SECS_DEFAULT`) is that exact contract — a live run that merged seconds ago has a fresh heartbeat and is correctly excluded, which is precisely "how it distinguishes a genuinely-stale merged run from a live one." Reusing `readMergedMap`, `runIsHeld`, and `post-merge-check` means the predicate is composed of three already-tested primitives, not a fourth new judgement.

**Where the write lives.** Options: a new bespoke writer; reuse `run-ledger record-outcome`. **Chosen:** reuse `record-outcome`/`applyTerminalOutcome` under `mutateLedgerUnderLock`. Rationale: it is the single tested ledger-close writer (outcomes + owner.status + issue-outcome close event + chain fold), already fail-closed on lock contention; a second writer would fork the close semantics. The recovery verb is authorship-thin — it *decides admission* and *runs the gate*, then delegates the write.

**The gate's block direction.** Options: block only on `verified-fail`; block on `verified-fail` AND `unverified`. **Chosen:** block on anything that is not `verified-ok`. Rationale: the human's rule is "a red **or absent** post-merge-check must block." `unverified` (no rung / worktree failure / errored) is "absent proof of health" — auto-closing on it would green a merge we cannot re-verify, the exact masking risk. Only a positive `verified-ok` admits.

**Invocation from the drain's disposition arm vs a fresh drain's Step-11.** Options: wire recovery into the drain wrapper's existing post-`disposition` branch; or have the next `/faff-beep-boop` run detect a prior run's merged-unclosed and recover it. **Chosen:** the drain wrapper's disposition arm. Rationale: that layer already holds the abandoned run-dir and already branches on disposition's exit (FAFF-782), so it is the minimal attachment with no new run-scanning machinery; a fresh drain's Step-11 reconciles *its own* run, not an arbitrary prior one. Mirrored in the reference wrappers; the live runner is the operator's mirror (§7).

## 7. Open Questions and Assumptions

**Open Questions.** None. The write-authority direction was settled by the human (unpark, 2026-08-16); the two sub-questions (staleness/merged-ness predicate; reconcile-adjacent vs resume) are settled above against shipped primitives and the ADR-0057/0098 precedent. This spec carries no `**Punt:**`.

**Assumptions.**

- **Assumes:** the production `fly-ci-l3-runner` deployment (`drain.sh`/`entrypoint.sh`, outside this repo) receives the equivalent `faff reconcile-recover` call in its disposition-non-zero arm, mirrored by an operator from the in-repo reference wrappers. Validation: the build agent adds the call to `operations/ci/faff-cron.sh` + `operations/ci/l3-watcher.yml` and documents it in `docs/guide/self-hosted-rig.md`, and notes the operator follow-up in the PR description — exactly the boundary FAFF-782 drew. This repo's PR alone does not change the live runner.
- **Assumes:** `merge-gate` writes `<run-dir>/<issue>/merge-record.json` with `{pr, head_sha, merged:true}`. Validation: confirmed in `merge-gate.js` `writeMergeRecord`; the build agent re-checks `pr`/`head_sha` field names before feeding them to `post-merge-check`.
- **Assumes:** the shipped `runIsHeld` + `overlayHeartbeat` liveness contract (owner heartbeat, 900s default) is the authoritative "is this run live?" signal at recovery time. Validation: reused directly from `runcheck.js`/`heartbeat.js`; the recovery verb adds no second liveness rule and no new threshold.

## 8. DONE — Definition of Done

### From WHY
- [ ] A merged-but-unclosed L3 run whose merged code re-verifies is closed to `shipped` by `faff reconcile-recover` with no manual reconciliation; one that does not re-verify (or is still live) is left untouched for a human.

### From WHAT / HOW (the recovery verb)
- [ ] `faff reconcile-recover --run-dir DIR --issue ID --level L1|L2|L3|L4 [--json] [--dry-run]` exists, registered in the subcommand registry, with usage exit 2 on missing/invalid flags.
- [ ] A pure `admitRecovery(ledger, issue, merged, held)` returns `recoverable | not-merged | not-unclosed | live`, covered by `--selftest` fixtures for every branch, with no filesystem I/O in the pure core.
- [ ] Admission reuses `readMergedMap` (merge-evidence), the audit's admitted∖outcomes (unclosed), and `runIsHeld` against the `overlayHeartbeat`-effective instant (verifiably-stale) — no new detection/liveness rule is introduced.
- [ ] On `recoverable`, the verb re-runs `post-merge-check` (`verifyPostMerge`) for the issue using `pr`/`sha` from `merge-record.json`.
- [ ] `verified-ok` → the verb writes `outcomes[issue]="shipped"` + `owner.status:"done"` via the existing `record-outcome`/`applyTerminalOutcome` locked writer and appends the issue-outcome close event; exit 0.
- [ ] `verified-fail` OR `unverified`/absent → NO ledger write; exit 1; the `merged-unclosed` disposition item still surfaces.
- [ ] `not-merged` / `not-unclosed` / `live` admission → NO write; exit 3 (no-op fail-safe), except `not-unclosed` (already closed) which is an idempotent exit 0.
- [ ] `--dry-run` reports the would-be recovery without writing.
- [ ] The verb is idempotent and lock-serialised: a re-run or a concurrent run does not double-write or corrupt the ledger.

### From HOW (invocation wiring — reference wrappers)
- [ ] `operations/ci/faff-cron.sh` and `operations/ci/l3-watcher.yml` invoke `faff reconcile-recover` in the disposition arm for each `merged-unclosed` issue; `docs/guide/self-hosted-rig.md` documents it and the operator mirror for the live runner.

### From write-authority / ADR
- [ ] An ADR records the scoped recovery write-authority: the new verb, its scope (verb-only actor; `running→done` + `outcomes:absent→shipped` operation only; verifiably-merged/stale/unclosed precondition; post-merge-check `verified-ok` pairing), and how it distinguishes a genuinely-stale merged run from a live one — as a deliberate, named exception to "only the run's own agents write owner.status", sibling to ADR-0057 and ADR-0098. (Materialised at graft from the `## ADR promotion intent` comment.)

### From OUT OF SCOPE
- [ ] No auto-revert/reopen, no new outcome token, no change to `disposition`/`reconcile` purity, and no edit to the out-of-repo `drain.sh`/`entrypoint.sh` are introduced.

**Integration smoke test.**

```
1. Mint a run dir: run-ledger.json admitted:["FAFF-417"], outcomes:{}, owner.status:"running", owner.last_heartbeat 20min ago.
2. Write <run-dir>/FAFF-417/merge-record.json = {pr:641, head_sha:<green sha>, merged:true}; ensure the repo's UNIT rung passes at that sha.
3. Run: faff reconcile-recover --run-dir <run-dir> --issue FAFF-417 --level L3 --json
4. Expect: post_merge_check "verified-ok", recovered:true, ledger now outcomes["FAFF-417"]="shipped" + owner.status "done", exit 0.
5. Re-run the same command → exit 0, recovered:false (not-unclosed, idempotent). Run faff disposition --run-dir <run-dir> → clean.
6. Repeat 1–3 with a failing UNIT rung at the sha → exit 1, ledger unchanged, faff disposition still reports merged-unclosed.
```

confidence: high
build-tier: complex

## Methodology critique

Agile-delivery lens (`issue-critique`), non-blocking in autonomous prep.

- **Right-sized?** No issues. One cohesive concern — the recovery verb (admission + post-merge-check gate + ledger-close write) plus its reference-wrapper wiring and the write-authority ADR. These always ship together (a verb without its gate or its ADR is not deliverable), so there is no independent second concern to split out; build-tier `complex` reflects care needed, not two units.
- **Workstream fit?** No issues. Sits in project *"A current unattended run survives executor loss at safe boundaries"* as the auto-close half of FAFF-782's detection-only slice — outcome-named and cohesive.
- **Deps surfaced?** No issues. Blocker FAFF-782 is Done (satisfied edge); no implicit unlinked dependency. The out-of-repo `drain.sh` mirror is surfaced as an explicit `**Assumes:**`, not a hidden edge.
- **Risk profile?** One flag. This is a scoped exception to a core write-authority invariant ("only the run's own agents write `owner.status`"). The risk is concentrated in the ADR's scoping, not in novel integration — the verb composes three already-tested primitives and adds no external dependency, so a de-risking spike is not warranted. The mitigations are in-spec: the `post-merge-check` `verified-ok` gate, the idempotent/non-destructive write, and the ADR ratified at PR review (sibling to ADR-0057/0098). PR review should scrutinise the ADR's scope wording specifically.
