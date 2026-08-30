# L4 lights-out end-to-end run: write-up and critique

Run: `run-20260829-100405-lights-out`. SUT: P1 link-shortener. Level L4 (autonomous, contained,
convergence forced). Window 2026-08-29 10:04:05 to 16:51:43 UTC (~6h47m). Minted from a clean PRD with
no build, no ADRs, no generated tracker docs in the tree.

Outcome: `faff disposition: clean`, `stop_reason: converged/both-dry`, three epics shipped and merged to
main, every gate passed. This is the first full end-to-end delivery for this SUT.

## 1. What happened

The run decomposed the PRD, then delivered three feature epics through the full spec to merge pipeline.
It parked once, on a reviewer-availability outage (not a product defect), which was cleared by a config
change plus a resume.

| Time (UTC) | Event | Note |
| --- | --- | --- |
| 10:04 | run-start | L4 ledger minted, 8/8 guardrails armed and enforced |
| 10:14 to 11:18 | prep-start to prep-done | epic A (core) spec produced and adversarially reviewed |
| 11:23 to 12:09 | build-start to issue-outcome shipped | epic A built, gated, holdout-verified, merged |
| 12:10 | discovered-scope-filed | additional scope surfaced during epic A build |
| 12:46 to 13:28 | epic B (TTL) build | built and AC-verified, then parked |
| 13:28 to 13:31 | park, run-end | epic B parked `reviewer-pool-unavailable`; run ended `product-incomplete` |
| 14:24 | run-resume | fired after the config fix; claimed epoch 1 |
| 14:45 | run-claim-abandoned | a dead resume-claim turn was released by resumecheck (working as designed) |
| 15:14 | issue-outcome shipped | epic B TTL merged; outcome reconciled parked to shipped |
| 15:15 to 16:51 | epic C build to run-end | epic C (structured errors) built, gated, merged; both queues dry |
| 16:51 | run-end run-complete | converged/both-dry, disposition clean |

The park at 13:28 was the only stop. Root cause was the code-review backend pool going 0-of-3
(local qwen truncated by a deadline slice below its own timeout, deepseek returned empty content even in
isolation, gemini-gemma free tier hit HTTP 429). At L4 a no-opinion mandatory review fails closed, which
is correct. The fix was config-only: a code-review deadline resize plus one reliable paid fallback
backend (`openrouter-gemma-paid`, `google/gemma-4-31b-it`). On resume, that fallback served the review
that unblocked the TTL epic, and it also served the spec-review judge that later shipped epic C.

## 2. What it decided along the way

- Decomposition. The clean PRD was decomposed into one PRDR (`0001-link-shortener-v1-persisted-runnable-service`)
  and three build epics: A `gk-20260829-zr4n8l` (persisted mint-and-resolve MVP), B `gk-20260829-u9qzgx`
  (optional TTL expiry), C `gk-20260829-tleugm` (structured JSON error responses).
- Architecture. A single `faff-contract:architecture-proposal` was authored into epic A's spec:
  Go 1.22 stdlib `net/http` (1.22 ServeMux method+pattern routing) over Postgres 16 via pgx v5, startup
  migrations under a Postgres advisory lock, `go:embed`ed SQL, 7-char base62 codes from crypto/rand with
  collision retry, distroless final image, db on the compose network with no published host port. The
  proposal deliberately reserved a nullable `expires_at` column in migration 0001 so the later TTL epic
  was purely additive, no schema break. That forethought is visible in the delivery: epic B changed only
  the store and handler, not the schema.
- Discovered scope. During epic A's build a `discovered-scope-filed` event fired; the structured-error
  work (epic C) was delivered as its own epic rather than smuggled into A.
- Spec-review iteration. Each epic went through multiple adversarial spec-review rounds (A: 5, B: 3,
  C: 6) before build. The reviewer materially improved the specs, for example splitting epic C's DONE list
  into a code-blind holdout subset and an in-repo unit-test subset, pinning error `message` values to
  fixed literals, and making the encoder's control-byte escaping explicit.
- The spec-review judge ruled on epic C. Epic C's raw round-6 aggregate was `reject-approach`, but the
  reviewer would not converge and its standing round-6 blockers were assessed unfounded (an architectural
  `critical` that hallucinated a no-execute-floor guardrail belonging to the run harness not the spec, and
  a QA `critical` demanding a `Store` interface that contradicted the single-file scope). The L3-L4
  spec-review judge (FAFF-922) overrode with a documented `accept` (L4-final), after every founded
  objection had been resolved in place. This is the arbiter functioning as intended: it shipped a sound
  approach over a churning reviewer instead of parking for a human. Note the accept-bar did not block here
  because round-6 infosec was only `minor`; had a standing infosec `major` remained, the judge would have
  been coerced to park. The judge was served by the same `openrouter-gemma-paid` backend added mid-run.

## 3. What was delivered

A persisted, restart-safe link shortener on main. Endpoints: `POST /shorten` (`{url, ttl_seconds?}` to
201 `{code}`), `GET /{code}` (302 with a byte-exact `Location`), `GET /healthz`. Structured JSON error
bodies (`{error, message}`) on every client-facing failure.

Source (LOC on main):

| Area | Files | LOC |
| --- | --- | --- |
| entrypoint | `cmd/api/main.go` | 83 |
| http | `internal/httpapi/handlers.go` (+ test) | 211 (+105) |
| store | `internal/store/store.go` | 78 |
| migrate | `internal/migrate/migrate.go`, `migrations/` | 129 + embed |
| codes | `internal/code/code.go` (+ test) | 32 (+35) |
| dsn | `internal/dsn/dsn.go` (+ test) | 54 (+52) |
| integration tests | `test/integration_test.go` | 682 (28 tests) |
| packaging | `docker-compose.yml`, `.github/workflows/ci.yml` | 42 + 18 |

## 4. Guardrails, holdout, lanes, and code-blindness

Guardrails. The ledger armed and enforced all eight L4 guardrails for the whole run (admissibility,
spec_review, terminating, budget, observability, kill_switch, holdout, container).

Holdout evidence (code-blind). Every epic passed a code-blind black-box holdout:

| Epic | criteria | aggregate | code_blind | review |
| --- | --- | --- | --- | --- |
| zr4n8l | 15 | meets-spec | true | pass |
| u9qzgx | 13 | meets-spec | true | pass |
| tleugm | 19 (12 scenario + 7 assertion, 0 prose) | meets-spec | true | pass, reviewed-clean |

The epic C holdout evidence is representative: the evaluator provisioned its own environment
(`docker compose -p tleugmholdout up -d --build`, api on distroless plus postgres:16-alpine), read only
the spec DoD, exercised the running stack over HTTP at `http://localhost:8080` via an eval script that
references only the HTTP surface and the spec-derived expectations, recorded 11 observable checks
covering the 19 criteria (PASS=11 FAIL=0), then tore the environment down. No implementation source,
diff, build history, or builder test suite was read.

Lane usage. The pipeline held the lane boundaries: spec produced then adversarially reviewed before any
code; the evaluator provisioned, exercised, and tore down its own env and never read the codebase;
`custody-verdict.json` records an integrity-digest verification of run evidence taken pre-merge on the
trusted side before the outcome was consumed; each epic carries a `merge-record.json` and
`post-merge-verification.json`. The build to merge order for every epic was spec, spec-review, build,
AC verification, code-review, holdout, merge.

Honest caveat on code-blindness. `code_blind: true` on all three holdouts is self-declared by the
evaluator and backed by the evidence trail (the eval scripts reference only HTTP), but
`spawner_attested` and `attestation` are null, so this is not the stronger caged form where a spawner
derives `code_blind` from what it provably withheld. The blindness is evidence-supported, not
cryptographically attested.

## 5. Why no ADRs or decisions were stored

No `docs/adr/*.md` and no `docs/decisions.md` were written this run, even though the architecture
decision was made. Three reasons, all structural rather than a failure:

1. The architecture decision was captured as an in-spec `faff-contract:architecture-proposal` block in
   epic A's spec, including two explicit `adr_candidates` (the Go/Postgres stack, and the base62 code
   scheme) with rationale and assumptions. The build, env, and spec-review architectural lens all read
   that block. So the decision exists and is traceable, it just lives in the spec, not in `docs/adr`.
2. The run decomposed straight into feature epics; no standalone architecture epic was minted. The
   earlier `wng8an` run authored `docs/adr/0001-0005` because it ran a dedicated architecture-decision
   epic. This run had none, so the ADR-authoring step that would promote `adr_candidates` into
   `docs/adr` files never ran.
3. `docs/decisions.md` (the ratified-scope register) is materialised by graft on a human build-confirm
   (its Step 4c). Autonomous L4 has no human confirm, so the register was never written.

Consequence and gap. The decisions are recoverable from the spec proposal block, each spec's `Chosen:`
markers, and the epic C judge disposition, but they are not first-class durable artifacts on main. In a
feature-first autonomous flow, architecture decisions get made and consumed but stranded in the spec;
`adr_candidates` are produced and never promoted. That is worth raising as a faff gap: an autonomous run
that makes a real architecture call should be able to persist it as an ADR without a human confirm and
without a separate architecture epic.

## 6. Critique

### Product

Sound thin slice. It is genuinely runnable, persistent across an api-only restart, and correct on the
subtle points. Two implementation choices stand out as better than typical autonomous output:

- TTL is computed and evaluated entirely on the database clock (`expires_at = now() + make_interval`,
  and `expires_at IS NULL OR expires_at > now()` at resolve), so mint and resolve share one clock with
  no mixed-clock seam.
- Codes are uniform base62 by rejection sampling from crypto/rand (bytes 248..255 rejected so there is
  no modulo bias), which avoids both enumeration and a skewed keyspace.

Gaps for production, none of which are MVP-blocking:

- No abuse protection. `POST /shorten` is unauthenticated with no rate limit, so a caller can mint
  unbounded rows (a storage-growth denial of service). Body size is capped (8 KiB) and TTL is capped
  (ten years), which bound a single request but not request volume.
- Expired rows are never purged and `expires_at` is not indexed. Resolve is a primary-key lookup so it
  stays fast, but storage grows without bound and there is no reaper or partial index.
- Open redirect is inherent and unmitigated. The service redirects to any validated http(s) host; there
  is no denylist or phishing check. That is the nature of a shortener, but a production deployment would
  weigh it.
- No request logging, metrics, or tracing beyond `healthz`.

### Tests

Strong for the size. 28 integration tests cover mint, all TTL variants (expiry, negative, zero, large,
above-cap, absent field), byte-equal Location, unknown and malformed 404s, same-URL-different-codes,
oversize body, and every one of the eight error shapes. Notably it tests the migration concurrency
directly (`TestConcurrentStartupMigration`, `TestAdvisoryLockSerialisesMigration`), which is where a
naive startup migration would break under multiple replicas. Unit tests cover code shape and randomness,
DSN password redaction in three forms, and the error-slug sink.

Gaps: no test exercises the `ErrCodeExhausted` retry-exhaustion path (hard to force, but untested), and
the datastore-down 500 path is argued correct by construction rather than tested. There is no
concurrency test for mint-collision retry under load.

CI caveat. The CI workflow runs gofmt, `go vet -tags integration`, and unit tests for `internal/code`
and `internal/dsn` only. The 28 integration tests and the handler unit tests need Postgres and run in the
AC and holdout path, not in CI. So CI alone proves formatting, vet, and two small unit packages; the real
behavioural coverage is gated elsewhere. A production setup would run the integration suite against an
ephemeral Postgres in CI.

### Architecture

Clean and idiomatic. Layered `cmd/api` over `internal/{store,httpapi,code,migrate,dsn}` with embedded
migrations, no web framework, modern 1.22 routing. The migration runner is the strongest piece:
`schema_migrations` bookkeeping applied inside a single transaction-level advisory lock, so concurrent
starters serialise and a second starter finds everything already applied rather than racing on a
relation-exists error. Reserving `expires_at` in migration 0001 made the TTL epic additive. The main
reservation is that all logic sits in a handful of files with concrete types (no `Store` interface); the
epic C judge disposition explicitly accepted that as correct for the scope, but it does constrain
fault-injection unit testing.

### Defensibility

Good posture for an MVP: control-byte validation on both the mint and resolve paths (defence in depth
against `Location` header injection and response splitting), status-before-body error writes that fail
closed, body and TTL caps, a code-shape gate before any database query, DSN redaction that never logs the
password, a distroless final image, and a database with no published host port. The 500-no-leak property
is guaranteed by construction (fixed literal error bodies at every call site) and argued in the judge
disposition. The open items are the abuse and open-redirect surfaces noted above.

### MVP versus production ready

This is a well-built MVP, not a production service. It clears the bar the PRD set: runnable, persistent,
restart-safe, with real migration safety and careful correctness. To be production ready it needs rate
limiting and abuse controls, expiry reaping plus an index, authentication or per-caller quota,
observability, an open-redirect policy, and CI that runs the integration suite. The multi-replica
migration lock is already a production-grade touch, which suggests the architecture was scoped with more
than a demo in mind.

## Evidence in this bundle

- `run-summary/` copies of the ledger, full events, and disposition.
- `holdout/` the three holdout verdicts and epic C's code-blind evidence and raw log.
- `judge/` epic C's spec-review disposition (the FAFF-922 judge ruling and round-by-round audit).
- `custody/` the three pre-merge custody verdicts and merge records.
- `specs/` the three delivered specs, including epic A's architecture-proposal block.
- `code/` a snapshot of the delivered source from main.
