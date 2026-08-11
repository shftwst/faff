# ADR 0101 — Andon transport lives in the faff binary and is fail-open by construction

- **Status:** Accepted
- **Provenance:** loop
- **Date:** 2026-08-11
- **Issue:** FAFF-386

## Context

FAFF-386 gives faff its first outbound-network code path: `faff andon` pushes a notification to a webhook when a run parks, trips Sentry, or breaches budget, so a human doesn't have to poll `/faff-wtf`. Two questions had to be settled together: where does the HTTP code live, and what happens when the network call fails? The obvious sibling precedent, `faffter-dark-adversarial-review/review-call.mjs`, is skill-scoped `node:http`/`node:https` — but it's skill-scoped precisely because the adversarial reviewer is a swappable slot occupant, not core governance. The andon sits with `events`, `budget`, and `sentry` — all in-binary, all pure-function-testable, none of them swappable slots. Every candidate channel the ticket named (ntfy, Slack, Discord, a generic webhook) collapses to one HTTP POST, so no per-channel client library is needed.

## Decision

Andon transport is `cmdAndon`, inline in `plugin/skills/faff/bin/faff`, built entirely on `node:http`/`node:https` — zero new npm dependencies, matching every other subcommand's zero-dependency posture. It is the one command in the binary that opens a real network connection; `docs/guide/cli.md` marks it as such so the "faff makes no network calls unless told to" property stays legible elsewhere. It is fail-open by construction: a notification failure (timeout, refused connection, non-2xx, DNS failure) is caught, logged into `andon-state.json`'s `failures` array, and the command still exits 0. `faff andon pump`/`send` never propagate a transport error as a command failure, never park a run, and never gate a merge — the andon is telemetry sitting beside the correctness machinery (park protocol, ledger, runcheck, Sentry), not inside it.

## Consequences

- Every call site that invokes `faff andon pump`/`send` (beep-boop step 8.1, run-end) can treat the call as unconditionally safe to add — no error-handling branch is needed at the call site, because the command itself never signals failure through its exit code.
- The binary's "no dependencies, node built-ins only" invariant is preserved even though it now does I/O over the network; a future transport (email/SMTP, OS notifications) that can't be expressed as a built-in HTTP POST stays out of scope for this same reason — it would break the invariant this ADR just extended, and the spec names both as explicit non-goals with the transport branch in `cmdAndon` as their extension point.
- Testability is loopback-only: `test/andon.test.mjs` must exercise `cmdAndon` against an in-test `node:http` server, never a real external endpoint, since the command has no dependency-injection seam for a different HTTP client.
- If the andon's own webhook is down, the run's only signal is `andon-state.json.failures` surfaced at the next `/faff-wtf` read — a fail-open transport cannot itself alert on its own failure. Accepted as the v1 posture (the existing pull surface remains the backstop); reopening this ADR is the right move if that gap needs closing (e.g. a `run-start` heartbeat ping).
