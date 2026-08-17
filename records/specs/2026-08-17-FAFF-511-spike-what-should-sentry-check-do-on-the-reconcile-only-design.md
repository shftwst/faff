# Spec — FAFF-511: What `sentry check` should do on the reconcile-only (unasserted) detection case

> Spec: faffter-dark-nlspec · 2026-08-17 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-511.

This is an **architecture-decision spike spec** for the build agent and human reviewers. Its deliverable is a *settled approach* for how `sentry check` should treat the `reconcile-only` detection disposition, plus concrete acceptance criteria — not a large feature build. It settles the two decisions the exploration could defend on evidence (D1, D2) **and** the three sub-decisions the human closed out in the "Punts resolved" comment of 2026-08-17 (D3–D5). There are no open punts remaining.

> **Refreshed 2026-08-17 (autonomous, run `run-20260817-070358-beepboop-list-48ba2e`).** Folds the human "Punts resolved" decision (comment 2026-08-17T04:45, `alec@shftwst.dev`) into the spec: the three escalated punts P1/P2/P3 are now settled decisions D3/D4/D5, each carrying a `**Chosen:**` marker and the human's DoD deltas. The headline approach (D1 approach iii via `verifyChain`; D2 single substrate-integrity cross-check) is **unchanged** — the resolutions settle the enforcement *response*, *cadence*, and *residual treatment* around that approach, not the approach itself. `faff-parked` was cleared by the same comment. Re-rated `medium` → `high`.

## Already shipped against this surface

Related, non-superseding — the network-free substrate this spec adopts already exists on `main`, which strengthens the premise rather than replacing it:

- **FAFF-564** (Done 2026-07-22) — "Add a tamper-evident hash chain to events.jsonl": shipped the `prev`-SHA-256 chain + ledger-fold this spec's approach (iii) consumes.
- **FAFF-568** (Done 2026-07-23) — "Anchor and verify the events.jsonl hash chain in governance-check": shipped `verifyChain` wiring into governance-check (a *different* consumer than `sentry check` — this spike wires the same `verifyChain` into `sentry check`).
- **FAFF-518** (Done 2026-07-16) — `integrity-digest snapshot/verify`: the adjacent evidence-bracket mechanism.

No Done ticket settles the enforcement question "what should `sentry check` do on `reconcile-only`" — FAFF-466 shipped the annotation and explicitly handed that decision to FAFF-511. Premise holds.

## 1. WHY — Problem and Principles

**Load-bearing model.** faff already ships a network-free tamper-evidence mechanism that `sentry check` does not yet call: `events.jsonl` is a schema-2 hash chain (each record's `prev` = SHA-256 of the previous physical line's bytes), and the last `ledger-write` event records `data.ledger_sha256` = SHA-256 of the post-write `run-ledger.json` bytes. `verifyChain(dir)` (exposed as `faff events verify`) walks that chain and folds the recorded ledger hash against the on-disk `run-ledger.json`, returning `status: broken` on any mismatch. This is a pure, dependency-free, already-CLI-tested function (`plugin/skills/faff/bin/lib/events.js`). So "reconcile the ledger/event content network-free" is a *substrate-integrity cross-check that already exists* — the spike's job is to decide whether and how `sentry check` should consult it, not to invent reconciliation.

**Problem statement.** When `sentry check`'s `detection_trust.disposition` is `reconcile-only` (the common case — no pid-1 `FAFF_INTEGRITY_BOUNDARY` mount, so `run-ledger.json`/`events.jsonl` are forgeable by a same-uid build lane), FAFF-466 shipped only an annotation: predicate evaluation is byte-identical for both dispositions. ADR-0034's follow-up guard asks `sentry check` to "reconcile the read ledger/event content against live git/tracker truth inline," but that literal wording collides with `sentry check`'s pure, network-free, hot-path design. This spec settles which enforcement path becomes real and pins down exactly what network-free reconciliation can and cannot defend.

**Design principle — the pure-evaluator invariant is non-negotiable.** `sentry check` must remain network-free and dependency-free: its only subprocess calls are to other faff verbs (`faff budget check`, `faff corrective-integrity`), never `gh`/git/MCP. An implementation that gives `sentry check` forge/network capability is rejected on sight, regardless of correctness. Reason: the detached `sentry-poller` watchdog treats `sentry check` as authoritative, and a network dependency in the kill-switch makes the kill-switch itself fail-prone (compare FAFF-577's config-fault degradation).

**Design principle — hot-path cost bound.** `sentry check` runs dozens of times per run. Any reconciliation it performs must be cheap: bounded file reads plus hashing, no per-predicate fork. The chosen cadence (D4) is per-checkpoint, gated on a build-time wall-time measurement with a once-per-run caching fallback — see D4.

**Design principle — honesty about coverage.** A network-free check can only detect *internal-consistency* divergence. It can never confirm *external* ground truth (was this PR actually merged), and it gives **zero** coverage of a legitimately-authored-but-dishonest write. Any decision here must state its residual, not paper over it — see D5.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentry.js` (`cmdSentry` check body ~L993–1041) | JS | Where the disposition is read (`sentryReadDetectionIntegrity`, ~L807–822/L1009) and the `--json` payload assembled (~L1031) |
| `plugin/skills/faff/bin/lib/events.js` (`verifyChain` L740, `walkPhysicalChain` L538, `eventsLedgerFold` L614) | JS | The already-built, network-free chain-walk + ledger-fold this spec adopts |
| `plugin/skills/faff/bin/lib/reconcile.js` | JS | Pure core over a caller-assembled `ReconcileInput`; its input production needs `gh`/git/MCP — the hard bound proving external reconcile is not network-free |
| `plugin/skills/faff/bin/lib/corrective-integrity.js` (`integrityGate`) | JS | Produces the `reconcile-only` disposition when no pid-1 boundary mount exists |

**Scope.** This sits between FAFF-466 (shipped the `detection_trust` annotation) and any future enforcement work: it decides the enforcement *path* and *floor* and bounds them, so downstream tickets build against a settled substrate rather than re-litigating approaches (i)/(ii)/(iii).

## 2. OUT OF SCOPE

- **Inline external ground-truth reconciliation (approach i).** Excluded — giving `sentry check` its own `gh`/git/MCP capability breaks the pure-evaluator invariant and the watchdog authority chain. Extension point: if external reconciliation is ever wanted at check time, it belongs in the orchestrator (approach ii), not `sentry.js` — see the run-end `faff reconcile` verb (`reconcile.js`), which already does external reconcile out of the hot path.
- **Orchestrator pre-assembled reconcile evidence (approach ii).** Excluded from *this* spike as the chosen path (see Decision D1), but not forbidden forever. Extension point: `evaluateDerailment`'s signal bundle in `sentry.js` (~L1028) is where pre-assembled evidence would be threaded in as an explicit parameter, mirroring how `authority` and `detection_trust` are passed today.
- **Escalation beyond the annotate floor (pause/abort intervention).** D3 settles the floor as surface-only; changing predicate intervention on a `broken`/`witness-mismatch` result to a pause or a new hard verdict is deliberately deferred to a separate, later ticket that must land paired `sentry-poller` tests (see D3 rationale). It is out of scope for *this* build.
- **Closing the vector-4b residual.** Detecting a *legitimate* build-lane heartbeat write issued while genuinely stalled (FAFF-355 vector 4b) is out of scope for any network-free mechanism — it produces a correctly-hashed, chain-clean ledger-write. D5 accepts it as an open residual and files the follow-up (FAFF-847); nothing here attempts to cover 4b.
- **Changing `corrective-integrity`'s disposition derivation.** `integrityGate` and how `reconcile-only` is produced are untouched. Extension point: `corrective-integrity.js`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| substrate | the on-disk files `sentry check`'s four predicates read: `events.jsonl` and `run-ledger.json` |
| substrate-integrity check | a network-free verification that the substrate is internally consistent (chain intact + recorded ledger hash matches on-disk bytes) — what `verifyChain` performs |
| chain-walk | `walkPhysicalChain`: confirms each schema-2 record's `prev` matches the SHA-256 of the previous physical line; `status: broken` + `first_break` on mismatch (catches truncate/rewrite, ADR-0034 vectors 2/7) |
| ledger-fold | `eventsLedgerFold`: compares the last `ledger-write`'s `data.ledger_sha256` against the current `run-ledger.json` bytes; `status: broken`, `ledger_fold: "mismatch"` on divergence (catches unrecorded ledger rewrites, ADR-0034 vectors 3/4/5/6) |
| annotate floor | the guaranteed minimum behaviour: the substrate-integrity result is computed network-free and surfaced on the `--json` payload; predicate intervention is unchanged. D3 settles this as the enforcement response for this build |

**The reconcile-check result surfaced on the payload** (the annotate floor — a new sibling field, network-free-derived, mirroring how FAFF-466 attached `detection_trust`):

```
RECORD ReconcileCheck:                # attached to sentry check --json payload
  status: Enum{verified, broken,      # from verifyChain(runDir).status
              witness-mismatch,       #   verified = substrate internally consistent
              legacy-unverifiable,    #   broken / witness-mismatch = tamper detected
              mixed, malformed}
  first_break: {seq, line, expected, actual} | null   # present when status = broken
  ledger_fold: Enum{match, mismatch, absent}          # from verifyChain
  checked: Bool                       # false when disposition = trusted OR no run-dir (skipped)

  CONSTRAINT status derived only from verifyChain(runDir) — NO network I/O, NO gh/git/MCP
  CONSTRAINT computed only when disposition = reconcile-only (trusted needs no reconcile)
```

**Design decision D1 — which approach becomes the real enforcement path.**

| Approach | Pro | Con |
|---|---|---|
| (i) network in `sentry check` | catches external ground-truth (vector 1) | breaks pure-evaluator invariant; poisons the watchdog authority chain |
| (ii) orchestrator pre-assembles evidence | keeps `sentry` pure; could carry external truth | unbuilt; per-checkpoint cost/latency/staleness unquantified |
| (iii) network-free subset in `sentry.js` | pure; **uses an already-built, already-tested mechanism** (`verifyChain`) | internal-consistency only — never external truth, never vector-4b |

**Chosen:** approach (iii), realized specifically as consulting the already-built `verifyChain` / `faff events verify` (chain-walk + ledger-fold) from `sentry.js` — not a newly-written reconciler. Rationale: it is the only path that preserves the pure-evaluator invariant *and* reuses shipped, CLI-tested code; approaches (i) and (ii) are rejected/deferred per Out of Scope. This closes the spike's headline question.

**Design decision D2 — what the network-free subset can defend, per predicate.** The subset defends *substrate integrity* for all four Sentry-1 predicates by checking the files they read, not by re-deriving each predicate's semantics:

| Predicate | On-disk read | Network-free coverage |
|---|---|---|
| `budget-breach` (`evalBudgetBreach`) | `run-ledger.json` via `faff budget check` | ledger-fold detects any unrecorded rewrite of `run-ledger.json` |
| `wall-clock-runaway` (`evalWallClock`) | `ledger.owner` fields + heartbeat sidecar | ledger portion fold-covered; sidecar freshness-vs-progress is the **vector-4b gap** (see D5) |
| `fix-review-thrash` (`evalThrash`) | `build-start` events in `events.jsonl` | chain-walk detects truncation/rewrite of those events |
| `repeated-identical-failure` (`evalRepeatedFailure`) | `park`/errored events in `events.jsonl` | chain-walk detects truncation/rewrite of those events |

**Chosen:** the network-free reconciliation subset is a single substrate-integrity cross-check (`verifyChain` over `events.jsonl` + the `run-ledger.json` fold), covering the on-disk substrate of all four predicates. It explicitly does **not** re-derive any predicate against external truth (that needs `reconcile.js`'s `gh`/git/MCP input) and does **not** cover vector 4b (a chain-clean legitimate write). Rationale: a per-predicate semantic re-derivation would either need external evidence (out of scope) or duplicate `verifyChain` — one substrate check subsumes all four cheaply.

**Design decision D3 — enforcement response to a detected divergence** *(settled by human decision 2026-08-17, was Punt P1).*

**Chosen:** surface-only — the **annotate floor**. On `reconcile_check.status` = `broken` / `witness-mismatch` under `reconcile-only`, `sentry check` attaches the result to the `--json` payload and leaves predicate verdicts and intervention **byte-identical** (no pause, no abort at the floor). Rationale (human): there is no false-positive cost to surfacing — a `broken` chain can be a benign non-atomic write — and `sentry check` is the authority the detached poller trusts, so escalation to a soft/hard intervention is deferred until there is data on how often `broken` fires benignly. Any later escalation to pause/abort is a **separate change that must land paired `sentry-poller` tests** (out of scope here).

**Design decision D4 — verification cadence and per-checkpoint cost budget** *(settled by human decision 2026-08-17, was Punt P2).*

**Chosen:** per-checkpoint — the substrate-integrity walk (`verifyChain`) runs on **every** `sentry check` invocation, not once-per-run cached. Because `sentry check` fires dozens of times per run and no per-checkpoint cost measurement exists yet, this decision carries a **build-time guard**: the build MUST measure `faff gates run` / `sentry check` wall-time against a large `events.jsonl` and confirm it stays inside the hot-path budget; if the measurement is bad, the build **falls back to once-per-run caching keyed on `events.jsonl` size+mtime**. The direction is settled; the measurement is a required acceptance criterion, not an open question (see DoD).

**Design decision D5 — treatment of the vector-4b residual** *(settled by human decision 2026-08-17, was Punt P3).*

**Chosen:** accept-and-document + follow-up. The residual — a chain-clean legitimate build-lane write issued while genuinely stalled (FAFF-355 vector 4b) — is documented as **accepted-open**: no network-free check can cover it, and nothing in this build attempts to. A follow-up is filed for the heartbeat-freshness-vs-logged-progress correlation signal that could eventually close it: **FAFF-847** ("Heartbeat-freshness-vs-logged-progress correlation signal (close the vector-4b residual)"). This build is **not** blocked on FAFF-847.

## 4. HOW — Behavior

**Approach.** At the annotate floor, the check body computes the reconcile result once, only in the `reconcile-only` disposition, and attaches it to the payload. It threads through the existing seam: `detection_trust` is already derived at ~L1009 and attached at ~L1031; the reconcile result is derived immediately after and attached as a sibling. No predicate evaluation (`evaluateDerailment`, ~L1028) is altered — that is the D3 surface-only floor.

```
PROCEDURE sentry_check_reconcile_floor(resolved, detectionTrust):
  1. IF detectionTrust.disposition != "reconcile-only":
     a. reconcile_check = { checked: false }        # trusted needs no reconcile
  2. ELSE IF resolved.empty OR no run-dir:
     a. reconcile_check = { checked: false }        # nothing on disk to verify
  3. ELSE:
     a. r = verifyChain(resolved.runDir)            # PURE, network-free, one bounded walk (D4: per-checkpoint)
     b. reconcile_check = { checked: true, status: r.status,
                            first_break: r.first_break, ledger_fold: r.ledger_fold }
  4. Attach reconcile_check to the --json payload (sibling of detection_trust)
  5. Predicate verdicts/intervention UNCHANGED                # ← D3 (Chosen): surface-only floor
```

**Behaviour summary.** The floor makes the substrate-integrity verdict *visible* on every `reconcile-only` check without changing what the check *does* about it — exactly FAFF-466's annotate-only shape, extended from "is the substrate trusted" to "is the substrate internally consistent." Per D3, a `broken`/`witness-mismatch` result surfaces on the payload and does **not** escalate to a pause or abort in this build; any future escalation is a separate change with paired poller tests.

**Anti-pattern:** re-observing CI/merge/tracker state inside `sentry check`. Why: it re-introduces the impurity `reconcile.js` deliberately keeps in the orchestrator shell, and poisons the watchdog authority chain.

**Anti-pattern:** forking a subprocess per predicate to reconcile each. Why: dozens-per-run invocation makes per-predicate forks unaffordable; one bounded `verifyChain` walk covers all four substrates.

**Anti-pattern:** treating a `verified` reconcile result as proof the run is honest. Why: `verified` only means *internally consistent*; a same-uid lane calling the sanctioned `faff heartbeat`/write path (vector 4b, vector 1 forging an internally-consistent terminal event) produces a chain-clean `verified` result. Never let `verified` suppress an otherwise-tripping predicate.

**Edge cases.**
- `disposition = trusted` → `checked: false`, no walk (a covering declaration already vouches for the substrate).
- Empty surface / no run requested → `checked: false`, no fault (mirrors the existing empty-surface path, ~L975).
- `verifyChain` throws (unreadable substrate) → the check must not die; surface `status: malformed` and continue on predicate evaluation (mirrors FAFF-577's degrade-loud posture and FAFF-425's indeterminate-not-silent posture). Terminal fault handling for a broken *ledger read* already exists upstream (`resolveLedgerOrFault`, ~L948) and is unchanged.

**Failure modes.**
- **The failure:** the substrate-integrity check gives a false sense of enforcement — reviewers assume `reconcile-only` is now "handled" when the check only detects clumsy tampering (vectors 2/3/5/6/7), leaving the legitimate-write vectors (1, 4b) fully open. **How you'd know:** a red-team run that stalls while calling the sanctioned `faff heartbeat` CLI produces `reconcile_check.status: verified` yet the run is genuinely derailed. **What it means:** this is the *accepted* posture, not a bug — D3 keeps the floor at surface-only and D5 documents vector-4b as accepted-open (FAFF-847). The spec must not be read as closing the enforcement gap; it names the residual explicitly.
- **The failure:** the per-checkpoint walk (D4) turns out to blow the hot-path budget on a large `events.jsonl`. **How you'd know:** `sentry check` wall-time regresses measurably across a run with a large event log. **What it means:** the D4 build-time measurement is mandatory — if it is bad, the build narrows to once-per-run caching keyed on `events.jsonl` size+mtime before shipping.
- **The failure:** a *future* enforcement change (should a later ticket escalate D3 beyond the floor) silently alters `sentry-poller` behaviour, since the detached watchdog treats `sentry check` as authoritative. **How you'd know:** `test/sentry-poller.test.mjs` intervention-propagation assertions change. **What it means:** this build makes no such change (D3 floor keeps poller behaviour byte-identical); any future escalation beyond the floor must land paired poller tests in the same change.

## 5. Scenarios

```
Given a reconcile-only run whose events.jsonl chain is intact and whose
      run-ledger.json matches the last ledger-write's recorded ledger_sha256
When  sentry check --json runs
Then  the payload carries reconcile_check.checked = true and status = "verified",
      and verdicts/intervention are byte-identical to the pre-change payload
```

```
Given a reconcile-only run where run-ledger.json was rewritten by a same-uid
      fs.writeFileSync bypass (leaving the recorded ledger_sha256 stale)
When  sentry check --json runs
Then  reconcile_check.status = "broken" with ledger_fold = "mismatch",
      derived with no gh/git/MCP subprocess call, and verdicts/intervention
      byte-identical (D3 surface-only floor)
```

```
Given a reconcile-only run where a build-start or failure event in events.jsonl
      was truncated/rewritten mid-log
When  sentry check --json runs
Then  reconcile_check.status = "broken" with a non-null first_break pointing at
      the tampered line, and no network I/O occurred
```

```
Given a reconcile-only run genuinely stalled while calling the sanctioned
      faff heartbeat CLI (FAFF-355 vector 4b — a chain-clean legitimate write)
When  sentry check --json runs
Then  reconcile_check.status = "verified" (the network-free check gives this
      vector ZERO coverage — the accepted-open residual per D5, not a bug)
```

- The reconcile result is computed only when `disposition = reconcile-only`; a `trusted` disposition yields `reconcile_check.checked = false` with no chain-walk.
- The substrate-integrity computation issues no `gh`/git/MCP subprocess — asserted by the same absence-of-network structural guard style as FAFF-324's vector probes and FAFF-466's structural guard.

## 6. Design Decision Rationale

**Which of approaches (i)/(ii)/(iii) becomes the real enforcement path?**
- (i) network-in-sentry — Pro: catches external truth. Con: breaks the invariant that keeps the watchdog trustworthy. Rejected.
- (ii) orchestrator pre-assembly — Pro: pure `sentry`. Con: unbuilt, unquantified per-checkpoint cost; premature for a spike. Deferred (Out of Scope extension point named).
- (iii) network-free subset via already-built `verifyChain` — Pro: pure + reuses shipped/tested code. Con: internal-consistency only. **Chosen** (D1): (iii) via `verifyChain`/`faff events verify`.

**What can the network-free subset defend?**
- Per-predicate semantic re-derivation — needs external evidence (out of scope) or duplicates `verifyChain`. Rejected.
- One substrate-integrity cross-check covering all four predicates' on-disk reads — cheap, complete for the internal-consistency class. **Chosen** (D2). Temporal anchor: at time of writing, `reconcile.js` requires caller-assembled `gh`/git/MCP input, so external-truth reconcile is structurally not network-free — revisit only if a network-free external-truth oracle appears.

**Enforcement response, cadence, and residual (D3/D4/D5 — human decision 2026-08-17).**
- **D3 surface-only floor:** the conservative option with no false-positive cost — a `broken` chain can be a benign non-atomic write, and `sentry check` is the poller's authority, so intervention escalation waits for real `broken`-frequency data. Escalation is a named, separate follow-on (with paired poller tests), not part of this build.
- **D4 per-checkpoint + measurement guard:** the walk is one bounded `verifyChain` call; running it every checkpoint keeps detection current, and the mandatory wall-time measurement (with a size+mtime once-per-run caching fallback) bounds the hot-path risk deterministically rather than by guess.
- **D5 accept-and-document + FAFF-847:** no network-free mechanism can catch a chain-clean legitimate write; honesty about coverage (a WHY principle) requires naming the residual and routing the eventual fix to a dedicated follow-up rather than silently over-claiming.

## 7. Resolved sub-decisions and Assumptions

**Resolved sub-decisions (P1–P3 → D3–D5, closed by the human "Punts resolved" comment 2026-08-17T04:45).** These were escalated as `**Punt:** … needs human` in the prior (medium-confidence) spec; the human authored the `**Chosen:**` values, now folded in above as D3 (enforcement response — surface-only floor), D4 (cadence — per-checkpoint + measurement guard), and D5 (vector-4b residual — accept-and-document + FAFF-847). No open punt remains.

**Assumptions.**

- **Assumes:** `verifyChain(dir)` / `faff events verify --run-dir DIR` remains pure and network-free and returns `{status, first_break, ledger_fold}` with the `verified|broken|witness-mismatch|legacy-unverifiable|mixed|malformed` vocabulary. Validate: read `plugin/skills/faff/bin/lib/events.js` (`verifyChain` L740, `verifyLedgerChain` L646, `walkPhysicalChain` L538, `eventsLedgerFold` L614) and confirm no `gh`/git/network spawn in the verify read path before building. *(Refresh grounding 2026-08-17 confirmed these symbols present and the verify path network-free.)*
- **Assumes:** the FAFF-466 `detection_trust` seam (`sentryReadDetectionIntegrity` L814, payload attach ~L1031) is the correct attach point for the sibling `reconcile_check` field, and that predicate evaluation stays byte-identical at the floor (pinned by FAFF-466 Scenario 2). Validate: `test/sentry.test.mjs` still passes with the field added. *(Refresh grounding 2026-08-17 confirmed the seam and payload-attach line.)*

## 8. DONE — Definition of Done

### From WHY
- [ ] The chosen path preserves the pure-evaluator invariant: `sentry check` issues no `gh`/git/MCP subprocess for reconciliation (structural guard test, `test/sentry.test.mjs`).
- [ ] The spec names, in prose, exactly what the network-free subset does NOT cover (external ground-truth / vector 1, and vector 4b).

### From WHAT (decisions and types)
- [ ] Decisions D1 (approach iii via `verifyChain`), D2 (single substrate-integrity cross-check), D3 (surface-only floor), D4 (per-checkpoint + measurement guard), and D5 (accept-and-document + FAFF-847) each carry a `**Chosen:**` marker; no decision remains an open `**Punt:**`.
- [ ] The `reconcile_check` payload field matches the defined record (`status`, `first_break`, `ledger_fold`, `checked`) and is derived only from `verifyChain`.

### From HOW (behaviour — annotate floor / D3)
- [ ] Under `reconcile-only` with an intact substrate, `sentry check --json` emits `reconcile_check.status = "verified"` and verdicts/intervention byte-identical to the pre-change payload (`test/sentrycheck.test.mjs` and FAFF-466 Scenario 2 in `test/sentry.test.mjs`).
- [ ] **(D3)** Under `reconcile-only` with a `broken` substrate, `sentry check --json` surfaces `reconcile_check.status = "broken"` and leaves predicate verdicts/intervention byte-identical — no pause/abort at the floor (`test/sentry.test.mjs`).
- [ ] An unrecorded `run-ledger.json` rewrite yields `status = "broken"`, `ledger_fold = "mismatch"` (`test/sentry.test.mjs`, sitting alongside the FAFF-324 vector 3/4/5/6 probes ~L762–943).
- [ ] A mid-log truncation/rewrite of a `build-start`/failure event yields `status = "broken"` with a non-null `first_break` (`test/sentry.test.mjs`, vectors 2/7).
- [ ] `disposition = trusted` and the empty/no-run-dir surface both yield `reconcile_check.checked = false` with no chain-walk.
- [ ] A `verifyChain` throw degrades loud to `status: "malformed"` and does not abort the check (`test/sentrycheck.test.mjs`).

### From HOW (cadence / D4)
- [ ] **(D4)** The substrate-integrity walk runs per-checkpoint; a wall-time measurement of `faff gates run` / `sentry check` against a large `events.jsonl` confirms `sentry check` stays inside the hot-path budget — else the build narrows to once-per-run caching keyed on `events.jsonl` size+mtime. The measurement (or the caching fallback it forces) is recorded in the PR.

### From HOW (edge cases / watchdog coupling)
- [ ] **(D5)** A red-team run that stalls via the sanctioned `faff heartbeat` write still yields `reconcile_check.status = "verified"`, documented as the accepted-open vector-4b residual with a citation to the follow-up FAFF-847 (`test/sentry.test.mjs`).
- [ ] The floor makes no change to `sentry-poller` intervention behaviour: `test/sentry-poller.test.mjs` intervention-propagation assertions are unchanged (any future D3 escalation beyond the floor must land paired poller tests).

**Integration smoke test.**
```
1. Create a reconcile-only run-dir (no FAFF_INTEGRITY_BOUNDARY): valid events.jsonl chain + matching run-ledger.json.
2. Run: faff sentry check --json --run-dir DIR
   → assert JSON.detection_trust.disposition == "reconcile-only"
   → assert JSON.reconcile_check.checked == true && status == "verified"
3. Rewrite run-ledger.json bytes directly (bypass the sanctioned write path).
4. Run: faff sentry check --json --run-dir DIR
   → assert JSON.reconcile_check.status == "broken" && ledger_fold == "mismatch"
   → assert verdicts/intervention byte-identical to step 2 (D3 surface-only floor)
   → assert no gh/git/MCP process was spawned (structural guard)
```

confidence: high
build-tier: complex
spec-review: approve

---
_Prep: autonomous refresh (`/faff-beep-boop`, run `run-20260817-070358-beepboop-list-48ba2e`). Refreshed from the prior medium-confidence spec by folding the human "Punts resolved" decision (2026-08-17T04:45): P1/P2/P3 → D3/D4/D5, each now `**Chosen:**`. Approach (D1/D2) unchanged. Re-rated **medium → high**; no open punts. Spec-review re-run on the refresh: **approve** (architectural + infosec + QA lenses). Routing verdict: **fire-and-forget** — build-eligible. Audit trail in `.faff/runs/run-20260817-070358-beepboop-list-48ba2e/FAFF-511/`._