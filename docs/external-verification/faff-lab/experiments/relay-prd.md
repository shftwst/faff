# PRD — relay: Durable Workflow Engine

- **Container:** relay
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver a durable workflow engine: workflows are DAGs of steps, each step an HTTP call to an external endpoint; runs are triggered manually or on a cron schedule; steps retry with backoff, time out, fan out and join; and a crash mid-run resumes exactly where it left off — completed steps are never re-executed, in-flight steps are retried safely. This is the class of system where the happy path is a weekend and the guarantees are the product: durability, exactly-once effect per step, and time that behaves.

## Goals & success metrics

- A run survives anything: kill the engine at any instant and the run completes correctly on restart, no step's effect applied twice, none skipped.
- Scheduled runs fire on time, indefinitely, without drift or pile-ups.
- A failed run says exactly which step failed, after exactly the promised attempts.

## Non-goals

- A workflow-authoring UI — workflows are defined in committed files (format is implementation's choice); a read-only run inspection surface is required, an editor is not.
- Step types beyond HTTP calls — no shell, no containers, no inline code.
- Multi-tenant isolation or accounts.
- Distributed/multi-node execution — one engine process, durable, is the brief.
- Event-triggered workflows — triggers are manual and cron only.

## Users

Developers defining workflows and inspecting runs through the API and the harness.

## Requirements

- A workflow is a named DAG of steps defined in a committed file: each step declares an HTTP request (method, URL, body), dependencies on other steps, a per-step timeout, and a retry policy (max attempts, backoff); cycles are rejected at load.
- Runs are triggered via the API or by a per-workflow cron expression; each run records, per step: state, attempt count, timestamps, and the response or error that decided it — inspectable via a read-only API or page.
- Steps execute when all dependencies succeed; independent steps run concurrently up to a stated per-run concurrency cap; a join step waits for all its dependencies.
- Every step request carries an idempotency key stable across retries and engine restarts of the same step in the same run, so a receiving endpoint can deduplicate.
- A step observed as completed is never re-executed — not on retry, not after an engine crash; recovery re-issues only steps that were in flight or pending, with their original idempotency keys.
- Retries follow the declared policy with backoff observable from recorded timestamps; a step exhausting its attempts fails the run (downstream steps do not execute; independent branches already running complete), and the run records the failing step.
- A step exceeding its timeout is treated as failed for retry purposes.
- Cron fidelity: scheduled runs fire at their appointed times without cumulative drift; if a run is still active when its next firing is due, the stated overlap policy (skip or queue — implementation's choice, stated) applies.
- All engine state persists in a database; the engine requires a continuously running process — request-scoped functions cannot satisfy this brief; Fly.io suits the process, Turso the database.
- A verification harness that runs its own scriptable target endpoints (recording every delivery, and per-script failing N times, hanging, or succeeding): it exercises fan-out/fan-in, retry-then-success, retry exhaustion, timeout enforcement, a real mid-run kill and restart of the engine process, idempotency-key stability across all of these, cron firing fidelity from recorded timestamps, and the overlap policy — reporting per-check results.
- Publicly deployed with automated deploys and a post-deploy smoke check that triggers a small workflow and sees it complete. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given a workflow file with a cycle, When loaded, Then it MUST be rejected.
- Given a run, When a step's dependencies have all succeeded, Then the step MUST execute; and independent steps MUST run concurrently within the stated cap.
- Given a join step, When any dependency has not yet succeeded, Then it MUST NOT execute.
- Given a step that fails then succeeds within its attempts, Then the run MUST proceed, and the recorded timestamps MUST show the declared backoff.
- Given a step that exhausts its attempts, Then the run MUST fail naming that step, downstream steps MUST NOT execute, and already-running independent branches MUST complete.
- Given a step exceeding its timeout, Then it MUST count as a failed attempt.
- Given the engine is killed mid-run at any instant, When it restarts, Then the run MUST resume and complete; steps the target recorded as completed MUST NOT be re-executed; re-issued steps MUST carry their original idempotency keys.
- Given any retry of a step, Then its idempotency key MUST equal the first attempt's.
- Given a cron workflow, When its recorded firing times are examined over the harness window, Then firings MUST match the schedule within a stated tolerance, with no cumulative drift.
- Given a firing due while a previous run is active, Then the stated overlap policy MUST be applied and recorded.
- Given a run, When inspected, Then every step's state, attempts, timestamps, and deciding response or error MUST be visible.
- The repository MUST include the harness with its scriptable targets, and running it MUST report per-check results.
- The engine MUST be publicly deployed with automated deploys, no manual deploy step, and a post-deploy smoke check that triggers a workflow and sees it complete.

## Evaluator note

The criteria live in time and in failure, so inspection verifies almost none of them: recovery code in particular looks correct far more often than it is. The harness owns the endpoints, so "the target recorded exactly one effective delivery per completed step" is a fact read from the harness's own logs, not the engine's claims. Residual duties: confirm the mid-run kill is a real process kill (not a graceful shutdown hook), that backoff and cron assertions are computed from recorded timestamps rather than configuration, and that the idempotency-key checks compare across a real restart. Timeliness beyond the stated tolerances is directional context for a human reviewer.

## Open questions

- Workflow file format, language, and the run-inspection surface (API-only or a page) are left to implementation.
- The concurrency cap, cron tolerance, and default retry policy are left to implementation — stated in the README and pinned by harness cases.
- Whether a failed run can be retried from the failing step is left to implementation.
- Payload templating between steps (passing one step's response into another's request) is left to implementation; if offered, it MUST be covered by a harness case.
