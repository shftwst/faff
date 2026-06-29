# ADR 0034 — Sentry hard kill-switch is un-subvertable by construction at the orchestrator dispatch boundary

- **Status:** Proposed
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
