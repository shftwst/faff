# PRD — link-shortener

- **Container:** link-shortener
- **Status:** Active
- **Date:** 2026-08-15
- **Mode:** authored

## Problem / objective

There is no URL-shortener service in this repository. This PRD asks for a small, production-shaped one backed by a real persistent datastore: mint a short code for an absolute URL, resolve the code back to the URL by an HTTP redirect, and honour an optional time-to-live. It is the P1 first-light exercise of the architecture then env then evaluate chain against a non-faff product, so the delivered service must be genuinely runnable and verifiable end to end, not an in-memory toy.

## Goals & success metrics

- A running service that mints a code for an absolute URL and redirects that code to the URL.
- Codes survive an api container restart, proving the datastore is real rather than in-memory.
- An optional time-to-live is honoured: an expired code stops resolving.
- The packaged stack starts healthy and answers a liveness check quickly.
- An automated test suite covers every acceptance scenario below and passes.

## Non-goals

- Authentication and authorization.
- Custom aliases (caller-chosen codes).
- Analytics or click counting.
- A user interface.
- Deduplication of identical URLs (two shortenings of one URL may differ).

## Users

Operators and services that need to shorten an absolute URL and later follow the short code to it. There is no end-user identity model in v1.

## Requirements

P0:
- `POST /shorten` accepts a JSON body `{ "url": "<absolute http(s) url>", "ttl_seconds"?: <int> }` and returns a short code.
- `GET /{code}` redirects to the stored URL; an unknown or expired code is not found.
- `GET /healthz` reports liveness.
- Codes are stored in a real persistent datastore and survive an api restart.
- An optional `ttl_seconds` sets expiry; expiry is honoured on read.
- The service is packaged to run under docker-compose (an api plus a datastore), health-checked at `/healthz`.

P1:
- Structured JSON error responses.
- A schema migration creates the storage table.
- Configuration is read from the environment.

## Acceptance criteria

- Given a valid absolute http(s) URL, When the client sends `POST /shorten`, Then the response status is 201 and the body field `code` matches `^[0-9A-Za-z]{7}$` (exactly 7 base62 characters).
- Given a code returned by `POST /shorten` for a URL U, When the client sends `GET /{code}` without following redirects, Then the response status is 302 and the `Location` header equals U byte for byte.
- Given a code that was never issued, When the client sends `GET /{code}`, Then the response status is 404.
- Given a code created via `POST /shorten` with `ttl_seconds: 1`, When the client sends `GET /{code}` at least 2 seconds later, Then the response status is 404.
- Given the same URL submitted to `POST /shorten` twice, When both responses return 201, Then the two `code` values are different.
- Given a code created before an api container restart, When the api container is restarted and the client sends `GET /{code}`, Then the response status is 302 and the `Location` header equals the original URL.
- Given the stack started with `docker compose up`, When `GET /healthz` is polled, Then it returns status 200 within 60 seconds.
- The automated test suite covering the scenarios above MUST pass.

## Open questions

- Language and runtime (for example TypeScript on Node 20 or Go 1.22) and the specific datastore are implementation choices resolved at the architecture step. They do not change the acceptance criteria above.
