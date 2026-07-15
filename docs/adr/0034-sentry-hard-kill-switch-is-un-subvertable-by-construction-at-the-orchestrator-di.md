# ADR 0034 — Sentry hard kill-switch is un-subvertable by construction at the orchestrator dispatch boundary

- **Status:** Accepted
- **Date:** 2026-06-29
- **Issue:** FAFF-49

## Context

L4 lights-out runs need a live supervisor that can *stop* a derailing run as it happens — not only at the fixed prep/review/merge gates. The hard requirement on any such kill-switch is that the agent being supervised cannot disable or talk its way past it. A watcher whose stop signal flows through a channel the supervised agent can write to is theatre: a runaway (or a confused) build agent could suppress its own kill.

Two facts about the shipped run model make a genuinely un-subvertable stop possible without inventing new IPC:

- The orchestrator owns an out-of-band, append-only signal surface the build agent has no handle on — the run's `events.jsonl`, `run-ledger.json` (incl. `owner.last_heartbeat`), and the pure budget reading. The build runs as an isolated subagent that returns **only** a terminal token `{issue, outcome, pr}` and never writes the orchestrator's context.
- Dispatch is the orchestrator's: it decides whether to launch the next build unit and can stop an in-flight one.

The alternative — an orchestrator-internal supervision loop, or a watcher the build lane can signal back to — reopens the subversion surface and couples the watcher's liveness to the thing it watches.

## Decision

Sentry is the live-supervision **detection + hard stop** layer, structured so the stop is un-subvertable *by construction* rather than by policy:

- Sentry runs as its **own isolated supervisory lane** (a fourth lane peer to orchestrator / implementor / evaluator). It **reads** the orchestrator-owned surface and **never** mutates it.
- The kill is enforced at the **orchestrator dispatch boundary** — Sentry's verdict drives the orchestrator to decline the next dispatch and/or stop the in-flight subagent. Because the build subagent cannot write the orchestrator's ledger/context, no value it controls reaches Sentry's decision inputs. The detection core reads only a closed allowlist of orchestrator-surface inputs; any foreign field is structurally dropped before any predicate sees it.
- Sentry **consumes** the shipped deterministic signals — budget-breach is the existing budget CLI's `{breached, outcome}`, liveness is `owner.last_heartbeat` staleness — and re-implements none of that math.
- The v1 intervention ladder is `continue | pause | abort` and **stops at abort**. Authority to *correct* / *redirect* a running agent (which would require writing back into the supervised lane, reopening the subversion surface) is deferred to the Sentry-2 slice.
- `abort` leaves **resumable** state: it commits the in-flight worktree WIP to its branch (park-protocol shape), marks the ledger `aborted-resumable`, and never force-resets — the in-flight issue is left undispatched so the run is re-enterable, never a corrupt half-state.

The detection predicates, the intervention aggregation, and the abort ledger-mark are pure, deterministic, `--selftest`-covered cores in the `faff sentry` CLI; the only I/O is reading the surface (and a child call to the budget CLI).

## Consequences

- The un-subvertable claim is **co-bound to the isolation model**: it holds only while the build lane has no write-path to the orchestrator context. If a future build lane gains such a handle, the structural guarantee weakens and this decision must be revisited (the blast-radius/authority review owns flagging that).
- Detection is **event-boundary coarse**: event-derived triggers (thrash, repeated-failure) only fire on logged phase boundaries, so a runaway *inside* a single long step is caught by the real-time floor — heartbeat-staleness and budget — not by the event triggers. v1 deliberately does not promise sub-step detection.
- The `forbidden-side-effect-attempt` trigger degrades to no-signal until its boundary signal lands; the rest of v1 is unaffected.
- `aborted-resumable` is recorded as a ledger annotation (an `abort` record + a non-`running` owner status), **not** as a terminal outcome — preserving the run-ledger's terminal-outcome invariant so the completeness audit and resume both stay coherent.
- Corrective-intervention authority, concurrent-fleet supervision, and who-watches-the-watcher are explicitly out of this slice and tracked as the follow-on Sentry-2 work.

## Re-examination under the shared-fs container model (FAFF-324)

**Disposition: MATERIAL AMEND.** The "un-subvertable by construction" headline claim is downgraded to **conditional on fs/content integrity — a condition the shipped system does not currently meet**, and the follow-up guard named below is **load-bearing**, not merely recommended.

### The two-leg claim, restated

The Decision above rests on two legs:

1. **Terminal-token context isolation** — the build subagent returns only `{issue, outcome, pr}` and owns no field in `evaluateDerailment`'s in-memory signal bundle.
2. **The closed-allowlist normalizer (AC5)** — `normalizeSentrySignals` (`bin/lib/sentry.js`) drops any key outside `{events, ledger, budget, now_ms, scope_drift, forbidden_side_effect, heartbeat_source}` before a predicate ever sees it.

Both legs hold exactly as claimed, and `test/sentry.test.mjs`'s AC5 case still passes: no CLI argument or in-memory field a caller could pass to `sentry check` can flip a trip. **But this is not the reachable attack surface.** The production build subagent never invokes `sentry check` at all — the *orchestrator* does, between units — so leg 2's protection is against a channel (bundle-key injection) nothing in the shipped system can even reach. The FAFF-278 (Sentry-2) spike's finding stands: inside the container, the build lane **shares uid + filesystem** with the orchestrator's on-disk surface and can rewrite `run-ledger.json` / `events.jsonl` directly with a plain `fs.writeFileSync` — no CLI, no argument, no privilege escalation. Neither leg constrains that channel.

### Forgery-vector table (confirmed against the shipped `bin/lib/sentry.js`, `bin/lib/budget.js`, `bin/lib/heartbeat.js`, `bin/lib/reconcile.js`, `bin/lib/corrective-integrity.js`)

| # | On-disk vector (build-lane-writable) | Read path | Predicate suppressed | `faff reconcile` (FAFF-397) counterpart? | Hermetic probe |
|---|---|---|---|---|---|
| 1 | Forge a fake `issue-outcome`/`shipped` event | `sentryReadEvents` → `evalThrash` | fix-review-thrash | **Yes, but only if the ledger's final `outcomes` entry also claims `shipped`** — reconcile checks the *terminal* claim against `merge-record.json` + live `gh pr view`, not the event log | `test/sentry.test.mjs` — vector 1 |
| 2 | Truncate/rewrite `build-start` events | `sentryReadEvents` → `evalThrash` | fix-review-thrash | **No** — reconcile never inspects `events.jsonl` at all | vector 2 |
| 3 | Relabel `ledger.outcomes` entries (e.g. real attempts → `routed-out`) | `readLedger` → child `budget check` → `attemptsFromLedger` | budget-breach (`max_attempts`) | **No** — reconcile checks *shipped* claims only; it has no notion of attempt-count fidelity. (Emptying `outcomes` outright does **not** work as a forgery — `attemptsFromLedger` falls back to `admitted.length` when `outcomes` is empty, so a forger must leave same-cardinality, wrong-*value* entries, which is what the probe demonstrates.) | vector 3 |
| 4 | Rewrite `owner.last_heartbeat` directly in `run-ledger.json`, bypassing the sanctioned `faff heartbeat` write path entirely | `readLedger` → `evalWallClock` | wall-clock-runaway (heartbeat staleness) | **No — no git-truth for liveness exists in principle** | vector 4 |
| 4b | Call the **sanctioned** `faff heartbeat` command itself (no raw fs write, no bypassed guard — the exact write FAFF-355 grants every build subagent for legitimate mid-step ticking) while genuinely stalled | `readLedger` overlaid with `readHeartbeatFile` → `evalWallClock` | wall-clock-runaway (heartbeat staleness) | **No — same as vector 4, and *more* directly production-reachable: no forgery-grade access is required at all, only the tool the build lane already legitimately holds** | vector 4b |
| 5 | Forge `owner.started_at` to a recent instant | `readLedger` → `evalWallClock` | wall-clock-runaway (run-elapsed) | **No — same as above** | vector 5 |
| 6 | Flip `owner.status` running→done | `readLedger` → `evalWallClock`'s running-owner guard | wall-clock-runaway (both sub-checks) | **No** — reconcile never inspects `owner.*` at all | vector 6 |
| 7 | Truncate/rewrite `issue-outcome`/`park` failure events | `sentryReadEvents` → `evalRepeatedFailure` | repeated-identical-failure | **No**, same as vector 2 | vector 7 |

Vector 4 and 4b are deliberately distinct: 4 demonstrates the ledger-field is forgeable even by a raw `fs.writeFileSync` bypass of the sanctioned write path; 4b demonstrates the **same suppression is reachable through the legitimate `faff heartbeat` command alone** — the "gamed liveness" case (a genuinely stalled build lane that keeps ticking) needs no forgery-grade access at all, which is why the follow-up guard below treats it as the sharpest residual, not a hypothetical one. (The spec's WHAT table listed 6 candidate rows; this table has 8 because two rows each split into two predicate-distinct or reachability-distinct sub-vectors during the probe work — 2/7 split by which predicate they suppress, 4/4b split by write-path reachability.)

All eight vectors are backed by a committed, hermetic, mkRun/`--now-ms`-style regression test in `test/sentry.test.mjs` (search `FAFF-324 vector`): each demonstrates a **genuine trip**, then performs the exact on-disk rewrite (or, for 4b, the exact sanctioned CLI call) a same-uid build lane could perform, and asserts the trip is suppressed. `node --test test/sentry.test.mjs` reproduces all eight plus three structural guards (below) — 34/34 passing at time of writing (re-run to confirm at review time; the count is a live claim about a committed test, not a static one).

**Coverage note:** every trip-capable predicate in `SIGNAL_TRIP_INTERVENTION` — `budget-breach`, `wall-clock-runaway`, `fix-review-thrash`, `repeated-identical-failure` — is demonstrated forgeable. `scope-drift` is warn-only/advisory (never trips) and `forbidden-side-effect-attempt` was already a known no-signal-until-boundary-lands gap per the original Consequences above; neither is re-examined here.

**Named but not probed (per the spec's own scoping instruction):** the spec's Risks/edge-cases section flags the budget `tokens` dimension — measured from Claude Code transcripts under `~/.claude/projects/…/*.jsonl` (`measureTokens`) — as a **further** content-forgery vector against `evalBudgetBreach`, distinct from the `max_attempts` forgery vector 3 demonstrates, and explicitly scopes it out of this spike's probe work ("note whether it widens the finding, but do not let it balloon the spike beyond the ledger/events core"). It widens the finding: transcripts are shared-fs-writable by the same build lane, on the same trust model as every other vector above, so `evalBudgetBreach`'s `tokens` ceiling has a second, unprobed forgery surface alongside vector 3's `max_attempts`. It is named here, not solved — a hermetic probe against transcript content, and any remediation, are left to the named follow-up guard's scope review, not this spike.

### Per-vector reconcile/backstop coverage

- **`faff reconcile` (FAFF-397) is real and wired**, contrary to an initial read of the codebase suggesting otherwise: it is invoked at run-end by `faff-beep-boop`'s step 11.5 (`plugin/skills/faff-beep-boop/SKILL.md`), which assembles a `ReconcileInput` from every ledger outcome `== "shipped"` and pipes it to `faff reconcile --level <L>`. A probe test (`test/sentry.test.mjs`, "`faff reconcile`... DOES catch a forged TERMINAL 'shipped' claim") confirms end-to-end that a ledger claiming `shipped` with no matching `merge-record.json`/live merge is flagged `claimed-shipped-unmerged`.
- **But that coverage is narrow in three independent ways:**
  1. **Shape** — it only ever inspects the *final* `shipped` claim. Vectors 2, 3, 4, 4b, 6, and 7 tamper with *mid-run* signals in a way that never has to fake a terminal `shipped` outcome — a build lane that just wants to keep grinding past what should have been a `pause`/`abort` doesn't need to fake success, it only needs to suppress the trip that would have stopped it. A structural guard (`test/sentry.test.mjs`, "structural guard — `faff reconcile`'s divergence classes never inspect owner.\*/heartbeat fields") confirms `reconcile.js`'s three divergence classes (`phantom-merge`, `claimed-shipped-unmerged`, `unowned-sibling-mutation`) never reference `owner`, `last_heartbeat`, or `started_at` at all.
  2. **Timing** — it fires at **run-end**, not in real time. ADR-0034's headline motivation is a supervisor that stops a run "as it happens... not only at the fixed prep/review/merge gates." A reconcile that only fires after the run has already ended has, by definition, already let the run spend whatever budget/wall-clock time the forgery was hiding — it is a post-hoc audit trail, not a live stop.
  3. **Gating** — `reconcileCore`'s disposition is level-gated: `needs-human` (hard-block) only at **L4**; at **L1-L3 — the ordinary autonomous default this very run executes under — it is `warn`: non-blocking**, surfaced but not acted on. A probe test confirms the identical divergence produces `needs-human` at L4 and `warn` at L3.
- **The "budget/run-done floor" backstop the original spike speculatively named is not independent.** `faff run-done`'s `budget-breach`/`budget-narrow` floor rungs consume the *same* `faff budget check` `{breached, outcome}` read that `attemptsFromLedger` computes from the *same* `ledger.outcomes` vector 3 forges; `run-done`'s `ledger_clean` signal comes from `faff runcheck`, which audits ledger **completeness** (`admitted − outcomes = ∅`) — a shape check, never a truth check, so a relabelled-but-present outcome entry (vector 3) still reads "clean." Neither is a second, independently-rooted signal — both share the forgeable ledger's trust root.
- **FAFF-373's `detection` consumer disposition is shipped but unwired — dead code, confirmed structurally.** `corrective-integrity.js`'s `integrityGate` defines a `"detection" → "reconcile-only"` disposition, but grepping `bin/lib/sentry.js` for `correctiveIntegrityProbe`/`integrityGate` finds nothing — `cmdSentry`'s only touch of the corrective-integrity module family is a **different** consumer entirely (`corrective-integrity --consumer corrective`, for the Channel-A `authority` parameter). The `detection` consumer's only caller anywhere in the codebase is its own `--selftest`. A structural regression guard in `test/sentry.test.mjs` pins this.
- **FAFF-325's genuine trust channel (`FAFF_INTEGRITY_BOUNDARY`, an outer-layer pid-1 declaration + read-only mount) is wired for `corrective` and `merge-floor`, never `detection`.** Even a fully-hardened deployment — one where the outer container layer genuinely, honestly mounts `run-ledger.json` + the `corrective/` dir read-only for the build lane, and the declaration is asserted — buys `sentry check` **nothing today**, because nothing in the detection path ever asks. Wiring it in is the direct, half-built remedy (see follow-up below).
- **Even if wired, `correctiveIntegrityDirs`'s required-dir set is insufficient for detection purposes as-is**: it names only `run-ledger.json` + `corrective/` (+ three merge-floor artifacts when an issue is given) — never `events.jsonl` and never the dedicated heartbeat *file* (`<run-dir>/heartbeat`, FAFF-355). `events.jsonl` is documented single-writer-orchestrator-only by design (`bin/lib/events.js`: "Single-writer in slice 1: only the orchestrator appends") — so extending the required set to cover it would close vectors 1/2/7 with **zero** design tension. The heartbeat *file* is the opposite case: FAFF-355 explicitly grants the build subagent write access to it for legitimate liveness ticking during long steps (gate ladder, adversarial review) — a read-only mount there would break real heartbeats, not just forged ones. That residual is named, not solved, below.

### Does FAFF-325's integrity mechanism need to be a shared precondition for detection?

**Yes.** Confirmed, not merely suspected. The evidence: (a) every trip-capable predicate is demonstrably forgeable via the same shared-fs channel FAFF-278/ADR-0039 raised for the corrective artifact; (b) the one mechanism that *would* close most of that surface — FAFF-325's pid-1-sourced, unforgeable-by-the-build-lane declaration — already exists and is already wired for two of the three consumers `integrityGate` distinguishes; (c) the third consumer, `detection`, is the one Sentry-1's kill-switch needs, and it is the one consumer nothing calls. FAFF-325 was framed and shipped as a corrective-authority precondition (Channel A) and a merge-floor precondition; this re-examination finds it is *equally* a detection precondition — the same asserted/unasserted boundary, the same declaration, the same dir-coverage mechanics, just a third call site away from closing this gap. It is a **shared** precondition, not a corrective-authority-only tax.

### Follow-up guard (named, not filed — FAFF-324 does not file tickets)

**Wire `sentry check`'s content reads through `integrityGate`'s `detection` consumer, and expand its required-dir set for that purpose.** Scope:

1. `cmdSentry`'s `check` subcommand derives a `detectionTrust` value the same way it already derives `authority` — a child spawn of `corrective-integrity --consumer detection --run-dir <dir> --json` (mirroring `sentryReadCorrectiveAuthority`'s existing pattern; never a direct `require` of the factory-region module, preserving the governance/factory region boundary — ADR 0042).
2. Extend `correctiveIntegrityDirs`'s required set, **for the detection call site only** (a new optional parameter, not a change to the corrective/merge-floor call shape), to include `events.jsonl` — closing vectors 1/2/7 with no design-intent conflict, since the orchestrator is already documented as its sole legitimate writer.
3. When `detectionTrust` is `asserted:true`, `sentry check`'s ledger/event reads for `run-ledger.json` + `events.jsonl` are genuinely trustworthy (an honest outer-layer mount makes forgery structurally impossible, not merely reconciled) — closing vectors 2, 3, 5, 6, 7 and **vector 4 (the ledger-field bypass) outright — but not vector 4b**, whose write goes through the dedicated heartbeat file, out of scope for this mount (step 4 below). When unasserted, apply the shipped `reconcile-only` disposition: before actioning a `continue`-only result (i.e. before trusting the *absence* of a trip on a signal that would otherwise have fired), reconcile the read ledger/event content against live git/tracker truth **inline, at check time** — not deferred to run-end — the same divergence classes `faff reconcile` already defines, called earlier and more often, not a second implementation.
4. **Name, don't solve, the heartbeat-file residual**: the dedicated liveness file is load-bearing for legitimate FAFF-355 ticking by the build lane itself, so a read-only mount is not available as a remedy there. Closing vectors 4b/5 fully needs a mechanism that distinguishes genuine liveness from gamed liveness (e.g. an orchestrator-side corroborating signal — a heartbeat tick cross-checked against actual logged progress, not freshness alone) — out of this spike's scope; flagged as the sharpest open residual for whoever picks this up, and now demonstrated (vector 4b), not merely hypothesised.

This scope is sized as a single follow-up ticket. A human should `/faff-jot` it; this spike does not file it.

### Residual after the follow-up guard (for the record)

Even fully implemented, the follow-up guard above does not restore the *original* "un-subvertable by construction, no exceptions" framing:

- It remains **conditional** on the outer layer's declaration being honest — `correctiveIntegrityProbe`'s own scope note (`corrective-integrity.js`) is explicit that faff "asserts, not creates": it verifies a declaration is genuinely pid-1-sourced and its dir set isn't too narrow, but never audits whether the outer mount is honest.
- The heartbeat-file residual (above) stays open pending a genuinely different mechanism, not a mount.
- Detection stays **event-boundary coarse** regardless (the original Consequences' second bullet, unchanged by this amendment).

### Traceability

Scenario branch fired: the third (**"the shared-fs model defeats the detection claim broadly (multiple un-reconcilable trip-suppressions across predicates)"**) of the spec's decision table (FAFF-324, `docs/specs/2026-07-12-faff-324-*-design.md`). Evidence: all four trip-capable predicates demonstrated forgeable (8 hermetic probes, `test/sentry.test.mjs`); only one narrow, run-end-only, L4-only-blocking counterpart exists for one specific forgery shape; the liveness signals have zero counterpart of any kind, blocking or advisory, real-time or after-the-fact — and the sanctioned `faff heartbeat` command alone (vector 4b), not merely a raw-fs bypass, already reaches the weakest of them.
