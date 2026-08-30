# Roadmap — link-shortener (git-only skeleton)

Planned by /faff-plot --autonomous (run run-20260829-100405-lights-out, L4 lights-out, git-only).
Lens: faffter-dark-methodology-agile-delivery (MVP-shaped, thinnest viable slice first).
Source PRD: docs/prd/link-shortener.md. Creative licence: broad.

Tracker-less mode: no containers are created in a tracker. This file is the written skeleton
down to first-slice epics plus their dependency links. Leaves grow later from specs (/faff-prep).

## Outcome

A genuinely runnable, persistent URL-shortener service that mints a short code for an absolute
URL, redirects the code to the URL, honours an optional TTL, and starts healthy under
docker-compose — verifiable end to end against the PRD acceptance criteria.

## Initiative: runnable link-shortener service

### Project: link-shortener v1

First-slice epics (sequenced by value x risk, thinnest runnable slice first):

- [ ] Persisted mint-and-resolve MVP under docker-compose <!-- gitkey:gk-20260829-zr4n8l -->
  - The thinnest slice that is actually runnable end to end. POST /shorten returns 201 with a
    7-char base62 code; GET /{code} returns 302 with a byte-exact Location, 404 for unknown;
    GET /healthz returns 200. Codes persist in a real datastore (survive an api container
    restart) via a schema migration that creates the storage table. Config is read from the
    environment. Packaged under docker-compose (api + datastore), health-checked at /healthz.
    Two shortenings of one URL yield different codes. Automated tests cover these scenarios.
  - Covers PRD P0 in full, plus P1 schema-migration and env-config (a real persistent service
    needs both from the start).
  - No blockers.

- [ ] Honour optional TTL expiry <!-- gitkey:gk-20260829-u9qzgx -->
  - POST /shorten accepts optional ttl_seconds; an expired code stops resolving (GET returns
    404 after expiry). Expiry honoured on read. Automated tests cover the ttl_seconds:1 scenario.
  - Blocked by: gk-20260829-zr4n8l (consumes the store and the resolve path).

- [ ] Structured JSON error responses <!-- gitkey:gk-20260829-tleugm -->
  - Error responses (bad request body, not-found, expired) return structured JSON rather than
    bare status text. Automated tests cover the error shapes.
  - Blocked by: gk-20260829-zr4n8l (extends the same request/response surface).

## Dependency links

- gk-20260829-u9qzgx  blocked-by  gk-20260829-zr4n8l
- gk-20260829-tleugm  blocked-by  gk-20260829-zr4n8l

## Stop-rule note

Decomposition stops at first-slice epics. No further leaves are enumerated; they grow from
/faff-prep specs and the bottom-up tributaries. No branch was halted for want of discovery —
the PRD is concrete enough to shape all three epics directly.
