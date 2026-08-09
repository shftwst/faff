# PRD — plinth: Headless CMS

- **Container:** plinth
- **Status:** Draft
- **Date:** 2026-07-20
- **Mode:** authored

## Problem / objective

Deliver a headless CMS: editors define content types, author entries through drafts and immutable published versions, and downstream sites consume a fast cached delivery API and signed webhooks. The product is a platform, and platforms earn trust in stages — a types-and-entries editor with a delivery API is a usable product before versioning exists, versioning before webhooks, webhooks before references. The brief requires delivery in that spirit: a sequence of releases, each deployed and usable, not one final drop. The hard cores are the parts consumers bet on: version immutability, cache invalidation that never serves stale content beyond its stated bound, and webhook delivery that retries honestly.

## Goals & success metrics

- Each release is a CMS someone could adopt for a real site at that stage.
- Published version N is the same bytes forever — history is append-only, rollback included.
- A consumer never reads stale content beyond the stated bound, and never misses a publish event.

## Non-goals

- A website renderer or templates — delivery is JSON; presentation is the consumer's.
- Rich-text/WYSIWYG editing — long text is plain text or markdown, stored as authored.
- Media transformation (resizing, cropping) — assets are stored and served as uploaded.
- Localization/multi-language entries.
- Per-editor accounts and roles — editorial access is by a shared unguessable management link; the delivery API is public.

## Users

Editors modelling content and publishing entries; developers consuming the delivery API and webhooks.

## Requirements

- Editorial surface reached only by an unguessable management link (identifiers carry at least 128 bits of randomness); the delivery API and served assets are public and read-only.
- Content types are defined with named fields of types: text, number, boolean, date, asset, and reference (to an entry of a stated type); fields may be marked required. Type definitions with duplicate field names or unknown field types are refused.
- Entries are authored as drafts; server-side validation enforces field types and required fields on publish (drafts may be incomplete); publishing creates version 1, 2, 3 … — each published version is immutable forever.
- Rollback republishes an earlier version's content as a new version — history is never rewritten; the version list, with timestamps and a diff of changed fields between any two versions, is visible in the editorial surface.
- Unpublishing removes an entry from delivery without destroying its version history.
- Assets (images, files) upload to object storage (R2 is available) and are served publicly; asset fields reference uploaded assets.
- Reference integrity: an entry cannot be deleted while a published entry references it — refused with the referrers named; the delivery API never serves a dangling reference.
- Delivery API: list and fetch published entries by type, filterable by field equality, returning the latest published version; responses served through a cache with a stated staleness bound — after a publish, unpublish, or rollback, delivery reflects the change within that bound, and never serves a mix of old and new versions of a single entry in one response.
- Webhooks: a consumer registers an endpoint URL and receives a shared secret; publish, unpublish, and rollback events are delivered as HMAC-signed POSTs; failed deliveries retry with backoff up to a stated attempt bound, then mark the delivery failed; per-endpoint delivery log (event, attempts, outcomes) is visible in the editorial surface; events for a given entry arrive at a consumer in occurrence order.
- Everything persists in a database; a restart or redeploy loses no types, entries, versions, or undelivered webhook events — pending deliveries resume.
- Incremental delivery, as a requirement of the brief: the product ships as at least three releases, each deployed to the public instance when made, each independently usable for a coherent slice of the product, and each recorded in a committed release log stating its scope, its tagged commit, its deployment, and which acceptance criteria it brought to passing. Criteria, once passing in a release, stay passing in every later one.
- A verification harness run against a running instance: version-immutability checks (published bytes stable across subsequent edits, rollbacks, and restarts), staleness-bound measurement from timestamped publishes and delivery reads, validation and reference-integrity refusals, and webhook checks against harness-owned endpoints — signature verification with the shared secret, retry-then-success and retry-exhaustion schedules read from recorded delivery timestamps, per-entry ordering, and resumption of pending deliveries across a real server restart.
- Publicly deployed with automated deploys. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given only delivery API URLs or asset URLs, When used, Then no editorial operation may be reachable; management identifiers MUST contain at least 128 bits of randomness.
- Given a type definition with a duplicate field name or unknown field type, When submitted, Then it MUST be refused.
- Given a draft missing a required field or with a type-invalid value, When publish is attempted, Then it MUST be refused server-side naming the failing fields.
- Given a published version, Then its content MUST be byte-stable forever — after later edits, later publishes, rollbacks, and restarts.
- Given a rollback to version K, Then a new version MUST be created with K's content and no existing version may change.
- Given two versions of an entry, When their diff is requested in the editorial surface, Then changed fields MUST be identified.
- Given an entry referenced by a published entry, When deletion is attempted, Then it MUST be refused naming the referrers; and the delivery API MUST NOT serve a reference to a nonexistent or unpublished entry.
- Given a publish, unpublish, or rollback, When delivery is read after the stated staleness bound, Then it MUST reflect the change; and no single response may mix versions of one entry.
- Given a registered webhook endpoint, When a publish event occurs, Then delivery MUST be an HMAC-signed POST verifiable with the shared secret.
- Given an endpoint that fails then recovers, Then recorded delivery timestamps MUST show the declared backoff and eventual success; Given an endpoint that never recovers, Then attempts MUST stop at the stated bound and the delivery MUST be marked failed in the log.
- Given multiple events for one entry, Then a consumer MUST receive them in occurrence order.
- Given a server restart with webhook deliveries pending, Then pending deliveries MUST resume and complete or exhaust normally.
- Given a restart or redeploy, Then all types, entries, versions, assets, and logs MUST be intact.
- The committed release log MUST record at least three releases, each with its scope, tagged commit, deployment, and the acceptance criteria it brought to passing.
- Given successive releases in the log, Then each release's passing-criteria set MUST contain the previous release's, and the final release's MUST be the full set.
- Given any recorded release, Then its tagged commit and deployment MUST date from when the release was made, evidenced by repository and deploy automation history.
- The repository MUST include the harness, and running it MUST report per-check results.
- The service MUST be publicly deployed with automated deploys and no manual deploy step.

## Evaluator note

The correctness cores are consumer-side promises, so the harness verifies them from the consumer's seat: immutability by re-reading version bytes across mutations and restarts, staleness by measuring real publish-to-read intervals, webhooks by owning the receiving endpoints and reading the schedule from its own logs. Residual duties: confirm the restart checks kill the real process, that the staleness measurement spans the cache actually deployed (not a cache-bypassing debug path), and that signature verification uses the secret as issued rather than a harness backdoor. The release log is verified from history — tags, CI, deploy records — with one release spot-checked by building it; a retroactively assembled log fails the brief. Slice coherence is a human judgement; the monotone criteria ladder is the gate.

## Open questions

- The staleness bound, webhook attempt bound, and backoff shape are left to implementation — stated in the editorial surface or README and pinned by harness cases.
- Cache implementation (in-process, HTTP caching, or otherwise) is left to implementation.
- Draft autosave behavior and concurrent-editor conflict handling on drafts are left to implementation.
- Whether delivery supports pagination/cursoring beyond simple lists is left to implementation.
- The release slicing itself is left to implementation; the log and the criteria ladder are the contract.
