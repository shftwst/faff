# PRD — poke: Uptime Monitor

- **Container:** poke
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver an uptime monitor: register a URL and a check interval, get a public status page showing up/down state, response times, and incident history. The surface is small; the substance is a correct long-running scheduler — checks that keep their interval without drift, never overlap, suppress one-blip false alarms, survive restarts with history intact, and refuse to be aimed at internal networks.

## Goals & success metrics

- Detection is prompt and honest: real outages surface quickly, single blips never open an incident.
- The scheduler is boring: no drift, no pile-ups, no checks silently stopping.
- History is trustworthy — a restart or redeploy changes nothing a visitor can see.

## Non-goals

- Notifications of any kind — email, SMS, webhooks. The status page is the product.
- Accounts — management is by unguessable link.
- Multi-region or redundant checking.
- TLS-certificate expiry, keyword, or content assertions — reachability only.
- Historical data export.

## Users

Anyone wanting a public status page for a site they run; visitors reading one.

## Requirements

- Register a monitor: an http(s) URL plus an interval chosen from an offered set; registration issues a public read-only status page and a separate unguessable management link (identifiers carry at least 128 bits of randomness) from which the monitor can be paused, resumed, or deleted.
- A check is an HTTP GET with a stated timeout; 2xx/3xx within the timeout is up, anything else — including timeout — is a failure.
- Flap suppression: a failed check is retried after a short delay before the monitor is declared down; a confirmed down opens an incident with its start time, and recovery closes it with the recovery time.
- Interval fidelity: consecutive checks of a monitor are spaced at its interval within a stated tolerance, without cumulative drift; checks of the same monitor never run concurrently, however slow the target.
- SSRF guard: URLs resolving to private, loopback, or link-local addresses are refused at registration, and the resolved address is re-validated at check time — a target that later resolves to an internal address is not fetched.
- The status page shows current state, uptime percentage over a stated window, per-check response times, and the incident log.
- Monitors, checks, and incidents persist in a database; after a restart or redeploy every active monitor resumes checking within one interval and no history is lost.
- The checker requires a continuously running process — request-scoped functions or static hosting cannot satisfy this brief; Fly.io suits the process, Turso the database.
- A verification harness that runs its own controllable target server: it registers monitors against the target, scripts it to go down and recover, and asserts detection and recovery within bounds, retry-before-down behavior, interval spacing from recorded check timestamps, non-overlap under a deliberately slow target, restart recovery, and refusal of internal-address URLs at both registration and check time.
- Publicly deployed with automated deploys. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given a valid http(s) URL and an offered interval, When registered, Then a public status page and a separate management link MUST be issued.
- Given only the status page URL, When used, Then pause, resume, and delete MUST NOT be reachable.
- Management and status identifiers MUST contain at least 128 bits of randomness.
- Given a URL that resolves to a private, loopback, or link-local address, When registered, Then it MUST be refused.
- Given a monitored URL that later resolves to an internal address, When its check is due, Then the fetch MUST NOT be made and the check MUST be recorded as refused.
- Given a target that fails one check and passes the retry, Then no incident may open and the monitor MUST remain up.
- Given a target that fails a check and its retry, Then the monitor MUST show down and an incident MUST open with its start time.
- Given a down monitor whose target recovers, When the next check succeeds, Then the incident MUST close with the recovery time and the monitor MUST show up.
- Given a monitor with interval I, When its recorded check timestamps are examined, Then consecutive checks MUST be spaced I apart within the stated tolerance, with no cumulative drift.
- Given a target slower than the check interval, When checks are due, Then checks of that monitor MUST NOT overlap and each MUST fail at the stated timeout.
- Given a service restart or redeploy, Then every active monitor MUST resume checking within one interval and prior checks and incidents MUST be intact.
- Given a status page, When displayed, Then it MUST show current state, uptime percentage over the stated window, per-check response times, and the incident log.
- Given a paused monitor, Then no checks may be made until it is resumed.
- The repository MUST include the harness with its controllable target, and running it MUST report per-check results.
- The service MUST be publicly deployed with automated deploys and no manual deploy step.

## Evaluator note

The criteria are objective, but almost none of them can be verified by inspection — a scheduler's bugs live in time, not in code shape. The harness is the instrument: it owns a target it can break on cue, so detection bounds, retry behavior, interval spacing, non-overlap, and restart recovery are all asserted from recorded timestamps rather than trusted. Residual duties: confirm the harness's target is a genuinely separate process, that the restart check kills the real service rather than simulating it, and that the SSRF cases cover check-time re-resolution, not just registration-time string matching. "Prompt" and "boring" are directional context for a human reviewer; the tolerance numbers are the gates.

## Open questions

- The offered interval set, the check timeout, the retry delay, and the spacing tolerance are left to implementation — stated in the UI and pinned by harness cases.
- The uptime window shown on the status page is left to implementation.
- How check start times are staggered across monitors after a restart is left to implementation.
