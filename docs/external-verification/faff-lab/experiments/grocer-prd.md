# PRD — grocer: Event-Driven Order & Stock

- **Container:** grocer
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver a production-shaped backend: two services — Orders and Inventory — each owning its own data, communicating only through events on a real message broker. Placing an order returns immediately; reservation, confirmation, rejection, and cancellation all happen asynchronously. The task is the part that never demos well: transactional outbox, idempotent consumers, out-of-order and duplicate delivery, crash recovery mid-flow, and stock accounting that is exact under a concurrent storm. There is no bespoke frontend — the HTTP API and the harness are the interfaces, with served Swagger (OpenAPI) docs as the human-browsable front door. The system runs wherever containers do: the composed local environment is canonical for development and verification, and the same containers deploy publicly to Fly.io.

## Goals & success metrics

- Stock is never oversold and never leaks: every unit is accounted for through any interleaving of orders, cancellations, crashes, and duplicate deliveries.
- Either service can be killed at any moment and the system converges on restart — no stuck orders, no lost events.
- The whole environment — broker, both services, their stores — comes up with one command on a clean machine.

## Non-goals

- A bespoke web frontend — the served Swagger UI is the only human-facing surface.
- Authentication, payments, pricing, or shipping — the public instance stays open and is demo-hardened by reset, rate limits, and caps instead.
- Multiple warehouses or stock locations.
- Exactly-once delivery at the transport level — delivery is at-least-once; correctness comes from idempotent effects.

## Users

Developers evaluating the system through its API, its harness, and its event stream.

## Requirements

- Implemented in Java (17 or later), building with a committed Gradle or Maven wrapper.
- Two services, separately run: Orders (HTTP API to place an order of one or more item lines, cancel it, and read its status) and Inventory (stock levels per item, a restock operation, reservation logic).
- Each service serves an OpenAPI spec generated from its code — not hand-maintained — with an interactive Swagger UI from which every public endpoint can be explored and exercised; the deployed Orders docs page is the system's public face.
- Each service owns its own datastore; the services never share tables and never call each other synchronously — all cross-domain communication is events on a real broker running in the composed environment (broker choice is implementation's; an in-process event bus does not satisfy this brief).
- Order lifecycle: PLACED on acceptance (returned synchronously), then asynchronously CONFIRMED (all lines reserved) or REJECTED (any line short — reservation is all-or-nothing); a PLACED or CONFIRMED order can be cancelled, releasing any reservation.
- Transactional outbox on both services: a state change and the publication of its event succeed or fail together — a crash between commit and publish loses nothing.
- Consumers are idempotent under at-least-once delivery: duplicate or redelivered events apply their effect once.
- Out-of-order arrivals (e.g. a cancellation racing a reservation result) resolve to a consistent final state with exact stock accounting.
- A poison event that keeps failing is moved to a dead-letter destination after a bounded number of attempts and does not block later events.
- Stock invariant, always: available stock is never negative, and available + reserved reconciles exactly against initial stock plus restocks minus confirmed sales.
- One command (e.g. `docker compose up`) brings up broker, services, and stores on a machine with only Docker installed.
- A verification harness run against the composed environment: a concurrent order storm targeting scarce stock, broker-level duplicate injection, out-of-order delivery, a real mid-flow container kill and restart of each service, a poison message, and invariant reconciliation read from both services' stores — reporting per-check results.
- CI on GitHub builds the project and runs the full harness against the composed environment on every push to the default branch.
- Publicly deployed on Fly.io from the same container images — broker and both services — with automated deploys and a post-deploy smoke check that places an order and sees it confirm.
- The deployed instance is self-healing without accounts: its state resets to the seeded catalogue and stock on a stated schedule, order placement is rate-limited per client, and line quantities and order sizes have stated sanity caps enforced server-side. Resets apply to the deployed demo only — the composed environment and harness manage their own state. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given an order whose lines are all in stock, When placed, Then the API MUST return PLACED immediately and the order MUST eventually become CONFIRMED with every line reserved.
- Given an order with any line short of stock, When processed, Then it MUST become REJECTED and no line of it may remain reserved.
- Given N concurrent orders competing for K remaining units of an item, When all resolve, Then the total confirmed quantity of that item MUST equal exactly K's available supply — never more.
- The Orders and Inventory services MUST NOT share a datastore or make synchronous calls to each other; every cross-domain effect MUST travel as a broker event.
- Given a service crash between committing a state change and publishing its event, When the service restarts, Then the event MUST still be published and the flow MUST complete.
- Given any event delivered more than once, When consumed, Then its effect MUST be applied exactly once.
- Given a cancellation of a CONFIRMED order, When processed, Then its reserved stock MUST be released and available again.
- Given a cancellation and a reservation result arriving in either order, When both are processed, Then the final order state MUST be consistent and stock accounting exact.
- Given a poison event that fails its bounded processing attempts, Then it MUST move to the dead-letter destination and subsequent events MUST process normally.
- At every harness checkpoint, available stock MUST be non-negative and available + reserved MUST reconcile exactly against initial stock, restocks, and confirmed sales.
- Given a clean machine with only Docker, When the single documented command runs, Then broker, both services, and their stores MUST come up and serve the API.
- Given a mid-flow kill of either service's container, When it restarts, Then all in-flight orders MUST reach a terminal or stable state with no lost events and no stuck orders.
- The system MUST be implemented in Java (17+) and build via the committed wrapper.
- The repository MUST include the harness, and running it MUST report per-check results.
- CI MUST build the project and run the full harness on every push to the default branch, and MUST be green.
- The system MUST be publicly deployed on Fly.io from the same container images as the composed environment, with automated deploys and no manual deploy step.
- Given a deploy completes, When the post-deploy smoke check places an order for in-stock items on the deployed instance, Then the order MUST become CONFIRMED.
- Given the deployed instance, When a service's docs URL is opened, Then an interactive Swagger UI MUST be served whose spec is generated from the code and covers every public endpoint, and requests MUST be executable from it.
- Given the reset schedule elapses on the deployed instance, Then it MUST return to the seeded catalogue and stock, clearing accumulated orders.
- Given an order whose line quantity or line count exceeds the stated caps, When placed, Then it MUST be rejected server-side.
- Given a placement burst beyond the rate limit, When it hits the deployed API, Then excess requests MUST be rejected with HTTP 429.

## Evaluator note

Almost nothing here is verifiable by inspection: outbox atomicity, idempotency, and oversell protection are the canonical cases of code that looks correct far more often than it is. The harness is the instrument — and the criteria only count as demonstrated when it exercises them the hard way: kills are real container kills (not graceful shutdowns), duplicates are injected at the broker (not simulated in a unit test), and reconciliation reads both services' stores directly rather than trusting the API's answer. The evaluator's residual duties are confirming exactly those three things, plus that the two-datastore rule holds in the compose topology, not just in the diagrams. The destructive checks run against the composed environment in CI; the deployed instance is held to the smoke check, and to image parity with what the harness verified — the evaluator confirms the deploy uses the same images, not that kills were re-run in production. "Production-shaped" as an overall judgement is directional context for a human reviewer.

## Open questions

- Broker choice, Java framework, and event serialization format are left to implementation.
- Outbox mechanics (polling publisher, CDC, or otherwise) are left to implementation.
- Retry counts, backoff, and the dead-letter attempt bound are left to implementation — stated in the README and pinned by harness cases.
- Whether order status reads are served from Orders' store alone or via a read model is left to implementation.
- How the broker is hosted on Fly.io (a Fly app running the broker, or otherwise) is left to implementation, within the no-new-paid-services cap.
- The reset schedule, rate-limit threshold, and quantity/size caps are left to implementation — stated in the served docs.
