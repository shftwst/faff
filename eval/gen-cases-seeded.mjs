// FAFF-625 — production SeededDefectCase corpus generator.
//
// WHAT: authors the ≥300-negative / ≥60-clean corpus this ticket's spec requires, under
// eval/cases-seeded/. Cases follow the FAFF-563 SeededDefectCase format exactly (same shape as the
// eval/cases/holdout-seed-*.json pilot): a `holdout-exercise` fixture (spec_dod + raw recordings), a
// label/defect_class/expected_aggregate triple, and a closed_set oracle mapping every criterion key to
// its ground-truth class.
//
// WHY a generator (not 360 hand-written fixtures): the corpus-lint constraints (unique ids, pairwise-
// distinct bodies, oracle<->expected_aggregate coherence) are exactly the invariants a deterministic
// generator can guarantee by construction, and 20+ distinct DOMAIN definitions below (not template-swaps
// of one noun) satisfy the domain-diversity review bar. The generator is committed alongside its output
// for provenance/reproducibility; the corpus itself is the checked-in, reviewed artifact — CI and the
// scorer read the static eval/cases-seeded/*.json files, never re-run this script.
//
// DEFECT-POSITION CONVENTION (mirrors the pilot exactly — eval/cases/holdout-seed-neg-*-001.json):
// every domain names four born-verifiable criteria in a fixed role order, and each role always maps to
// the same defect_class when broken:
//   role 0 (scenario, PRIMARY happy path)        -> subtly-wrong             (core action looks right, isn't)
//   role 1 (scenario, SECONDARY / edge path)      -> missed-criterion         (a whole requirement unmet)
//   role 2 (assertion, VALIDATION / guard)        -> working-but-off-spec    (happy path fine, guard absent)
//   role 3 (assertion, PERSISTENCE / side-effect)  -> spec-satisfying-but-broken-elsewhere (broken adjacently)
// Exactly one role is broken per defective case; the other three (plus any distractor/prose criteria)
// stay clean — matching the "one seeded defect per case" measurement design (FAFF-563 §3).
//
// Zero-dependency: node builtins only (mirrors the rest of eval/).

import { writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "cases-seeded");

const QUESTION =
  "Derive which of the raw recordings bear on each DoD criterion (ignore any that bear on none), " +
  "classify each met / unmet / needs-human, and force every `prose` criterion to needs-human.";

// ─── Domain definitions ──────────────────────────────────────────────────────────────────────────────
// Each domain is a FUNCTION of a param object -> { criteria: [...], recordings(brokenRole) }.
// `criteria` always lists the four core roles first (scenario, scenario, assertion, assertion), then an
// optional prose criterion, then 0-2 optional distractor criteria (always "met", varying the 3-7 count).
// `recordings(brokenRole)` returns the raw recordings array for the clean case (brokenRole === null) or
// for the case where exactly that role index (0-3) is broken.

function httpOrdersLike(p) {
  const { noun, id1, id2, field, badField, port } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `POST /${noun}s with a valid payload returns HTTP 201 and a new ${noun} id in the response body.` },
    { key: "c1", class: "scenario", text: `DELETE /${noun}s/<id> for a ${noun} id that does not exist returns HTTP 404.` },
    { key: "c2", class: "assertion", text: `A request missing the required \`${field}\` field is rejected with HTTP 422 and an error body naming the missing field.` },
    { key: "c3", class: "assertion", text: `The ${badField} selected at ${noun} creation is faithfully persisted — querying the ${noun} afterward returns the same value that was originally submitted.` },
    { key: "c4", class: "prose", text: `The ${noun} confirmation copy feels reassuring and on-brand.` },
  ];
  const recordings = (broken) => [
    { request: `POST http://env:${port}/${noun}s {"${field}":"a@x.io","${badField}":"${badField}-1"}`,
      response: broken === 0 ? `200 OK; body {"id":"${id1}","status":"pending"}` : `201 Created; body {"id":"${id1}","status":"pending"}` },
    { request: `POST http://env:${port}/${noun}s {"${badField}":"${badField}-1"}`,
      response: broken === 2 ? `201 Created; body {"id":"${id2}","status":"pending"}` : `422 Unprocessable Entity; body {"error":"missing_field","field":"${field}"}` },
    { request: `GET http://env:${port}/${noun}s/${id1}`,
      response: broken === 3 ? `200 OK; body {"id":"${id1}","status":"pending","${badField}":"${badField}-9"}` : `200 OK; body {"id":"${id1}","status":"pending","${badField}":"${badField}-1"}` },
    { request: `DELETE http://env:${port}/${noun}s/${id2}9`,
      response: broken === 1 ? `200 OK; body {"deleted":true}` : `404 Not Found; body {"error":"not_found"}` },
  ];
  return { criteria, recordings };
}

function cliDeployLike(p) {
  const { tool, env, ver1, ver2 } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `\`${tool} deploy --env ${env} --version ${ver1}\` exits 0 and prints "deployed ${ver1} to ${env}".` },
    { key: "c1", class: "scenario", text: `\`${tool} deploy --env ${env} --version bogus\` (an unpublished version) exits 1 with "version not found".` },
    { key: "c2", class: "assertion", text: `\`${tool} deploy\` invoked with no --env exits 2 and prints usage, without contacting the deploy target.` },
    { key: "c3", class: "assertion", text: `After a successful deploy, \`${tool} status --env ${env}\` reports the version just deployed, not a stale prior one.` },
    { key: "c4", class: "prose", text: `The deploy tool's console output is easy to follow under time pressure.` },
  ];
  const recordings = (broken) => [
    { command: `${tool} deploy --env ${env} --version ${ver1}`,
      output: broken === 0 ? `exit 0\ndeployed ${ver2} to ${env}` : `exit 0\ndeployed ${ver1} to ${env}` },
    { command: `${tool} deploy --env ${env} --version bogus`,
      output: broken === 1 ? `exit 0\ndeployed bogus to ${env}` : `exit 1\nerror: version not found` },
    { command: `${tool} deploy --version ${ver1}`,
      output: broken === 2 ? `exit 0\ndeployed ${ver1} to production (default env used)` : `exit 2\nusage: ${tool} deploy --env <env> --version <ver>` },
    { command: `${tool} status --env ${env}`,
      output: broken === 3 ? `current version: ${ver2}` : `current version: ${ver1}` },
  ];
  return { criteria, recordings };
}

function batchEtlLike(p) {
  const { job, srcRows, badRows, table } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `A clean run of \`${job}\` over ${srcRows} source rows loads exactly ${srcRows} rows into \`${table}\` and exits 0.` },
    { key: "c1", class: "scenario", text: `A source file containing ${badRows} malformed rows causes \`${job}\` to quarantine those rows (never load them) and still exit 0.` },
    { key: "c2", class: "assertion", text: `A duplicate primary key across two source rows is rejected — the job logs a dedup-conflict error and does not silently overwrite the earlier row.` },
    { key: "c3", class: "assertion", text: `Row counts logged at job completion (loaded + quarantined) sum to the total source row count read.` },
    { key: "c4", class: "prose", text: `The job's completion summary is clear about what happened, not just a raw number dump.` },
  ];
  const recordings = (broken) => [
    { log: `[${job}] read ${srcRows} rows from source` },
    { log: broken === 0 ? `[${job}] loaded ${srcRows - 1} rows into ${table}; exit 0` : `[${job}] loaded ${srcRows} rows into ${table}; exit 0` },
    { log: broken === 1 ? `[${job}] ${badRows} malformed rows loaded into ${table} anyway; exit 0` : `[${job}] quarantined ${badRows} malformed rows (0 loaded from that set); exit 0` },
    { log: broken === 2 ? `[${job}] duplicate pk detected; overwrote earlier row silently` : `[${job}] duplicate pk detected; logged dedup-conflict, row not loaded` },
    { log: broken === 3 ? `[${job}] summary: loaded ${srcRows}, quarantined ${badRows} (totals do not reconcile against ${srcRows} read)` : `[${job}] summary: loaded ${srcRows - badRows}, quarantined ${badRows} (reconciles to ${srcRows} read)` },
  ];
  return { criteria, recordings };
}

function authLoginLike(p) {
  const { service, user, badPass, lockThreshold } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `A correct username/password for \`${user}\` on ${service} returns a valid session token and HTTP 200.` },
    { key: "c1", class: "scenario", text: `${lockThreshold} consecutive wrong-password attempts for \`${user}\` locks the account and further correct-password attempts are rejected until unlock.` },
    { key: "c2", class: "assertion", text: `A wrong password for \`${user}\` returns HTTP 401 with a generic error (never revealing whether the username exists).` },
    { key: "c3", class: "assertion", text: `The session token issued on login carries the exact \`${user}\` identity — a subsequent \`/me\` call with that token returns \`${user}\`, not another account.` },
    { key: "c4", class: "prose", text: `The login error messaging is reassuring rather than alarming for a simple typo.` },
  ];
  const recordings = (broken) => [
    { request: `POST /login {"user":"${user}","pass":"correct"}`,
      response: broken === 0 ? `500 Internal Server Error` : `200 OK; body {"token":"tok-${user}-1"}` },
    { request: `POST /login {"user":"${user}","pass":"${badPass}"} x${lockThreshold}`,
      response: broken === 1 ? `200 OK; body {"token":"tok-${user}-2"} (account never locked)` : `423 Locked; body {"error":"account_locked"}` },
    { request: `POST /login {"user":"${user}","pass":"${badPass}"}`,
      response: broken === 2 ? `401 Unauthorized; body {"error":"user_not_found"}` : `401 Unauthorized; body {"error":"invalid_credentials"}` },
    { request: `GET /me (Authorization: Bearer tok-${user}-1)`,
      response: broken === 3 ? `200 OK; body {"user":"someone-else"}` : `200 OK; body {"user":"${user}"}` },
  ];
  return { criteria, recordings };
}

function pipelineValidateLike(p) {
  const { pipeline, schemaField, threshold, badRatio } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `A record whose \`${schemaField}\` matches the declared schema passes \`${pipeline}\`'s validation stage unchanged.` },
    { key: "c1", class: "scenario", text: `A record missing \`${schemaField}\` entirely is routed to the dead-letter output, never the accepted stream.` },
    { key: "c2", class: "assertion", text: `When the reject ratio for a batch exceeds ${threshold}%, \`${pipeline}\` halts the batch and raises an alert instead of continuing to process it.` },
    { key: "c3", class: "assertion", text: `Records that pass validation retain every original field byte-for-byte in the accepted-stream output (no silent field coercion).` },
    { key: "c4", class: "prose", text: `The dead-letter alert's phrasing gives an on-call engineer enough context to act without digging.` },
  ];
  const recordings = (broken) => [
    { event: `record {"${schemaField}":"ok-1"} -> validation`, outcome: broken === 0 ? "rejected: schema mismatch" : "accepted, unchanged" },
    { event: `record {} (missing ${schemaField}) -> validation`, outcome: broken === 1 ? "accepted into main stream" : "routed to dead-letter" },
    { event: `batch reject ratio ${badRatio}% (threshold ${threshold}%)`, outcome: broken === 2 ? "batch continued processing, no alert" : "batch halted, alert raised" },
    { event: `record {"${schemaField}":"ok-2","extra":"x"} -> accepted stream`, outcome: broken === 3 ? `field "extra" coerced to null in output` : `output byte-identical to input` },
  ];
  return { criteria, recordings };
}

function notificationSendLike(p) {
  const { channel, recipient, template, retryMax } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `Sending a \`${template}\` notification to \`${recipient}\` over ${channel} succeeds and is recorded as delivered.` },
    { key: "c1", class: "scenario", text: `A transient send failure is retried up to ${retryMax} times before being marked permanently failed.` },
    { key: "c2", class: "assertion", text: `A recipient who has opted out of \`${template}\` notifications never receives one, regardless of trigger.` },
    { key: "c3", class: "assertion", text: `A successfully delivered notification is recorded exactly once in the delivery log — a retried-then-succeeded send does not double-log.` },
    { key: "c4", class: "prose", text: `The notification copy for \`${template}\` reads naturally, not like a template dump.` },
  ];
  const recordings = (broken) => [
    { queue_msg: `send ${template} to ${recipient} via ${channel}`, result: broken === 0 ? "delivery_failed: unknown_recipient" : "delivered" },
    { queue_msg: `send ${template} to ${recipient}, transient failure x${retryMax}`, result: broken === 1 ? `gave up after 1 attempt (retryMax ${retryMax} not honoured)` : `delivered on final retry (${retryMax} attempts)` },
    { queue_msg: `send ${template} to ${recipient} (opted-out)`, result: broken === 2 ? "delivered" : "suppressed: recipient opted out" },
    { queue_msg: `send ${template} to ${recipient}, retried once then succeeded`, result: broken === 3 ? "delivery log has 2 entries for this send" : "delivery log has 1 entry for this send" },
  ];
  return { criteria, recordings };
}

function webhookDeliveryLike(p) {
  const { endpoint, event, secret, backoffBase } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `A \`${event}\` webhook POSTed to \`${endpoint}\` that returns HTTP 200 is marked delivered and not retried.` },
    { key: "c1", class: "scenario", text: `An endpoint returning HTTP 500 is retried with exponential backoff starting at ${backoffBase}s, not retried instantly in a tight loop.` },
    { key: "c2", class: "assertion", text: `Every outbound webhook payload is signed with an HMAC using \`${secret}\` and the signature header is present on every attempt, including retries.` },
    { key: "c3", class: "assertion", text: `The payload body delivered on a retry is byte-identical to the original attempt (no re-serialization drift between attempts).` },
    { key: "c4", class: "prose", text: `The webhook delivery dashboard makes it obvious at a glance which endpoints are unhealthy.` },
  ];
  const recordings = (broken) => [
    { request: `POST ${endpoint} {"event":"${event}"}`, response: broken === 0 ? `200 OK (queued for retry anyway)` : `200 OK, no retry scheduled` },
    { request: `POST ${endpoint} {"event":"${event}"} (endpoint returns 500)`, response: broken === 1 ? `retried immediately, no backoff` : `retry scheduled after ${backoffBase}s backoff` },
    { request: `POST ${endpoint} attempt 2 (retry)`, response: broken === 2 ? `sent with no X-Signature header` : `sent with X-Signature: hmac-sha256(...,"${secret}")` },
    { request: `POST ${endpoint} attempt 2 body diff vs attempt 1`, response: broken === 3 ? `field order changed between attempts` : `byte-identical to attempt 1` },
  ];
  return { criteria, recordings };
}

function queueConsumerLike(p) {
  const { queue, worker, poisonMax } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `\`${worker}\` consuming a well-formed message from \`${queue}\` processes it and acks it exactly once.` },
    { key: "c1", class: "scenario", text: `A message that fails processing ${poisonMax} times in a row is moved to the poison-message queue, not requeued forever.` },
    { key: "c2", class: "assertion", text: `\`${worker}\` never acks a message before processing completes (an ack-before-process would lose messages on a crash).` },
    { key: "c3", class: "assertion", text: `Two workers consuming \`${queue}\` concurrently never both process the same message (no double-processing under concurrency).` },
    { key: "c4", class: "prose", text: `The poison-queue alert gives an operator enough to triage without replaying the message by hand first.` },
  ];
  const recordings = (broken) => [
    { queue_event: `${worker} received msg-1 from ${queue}`, outcome: broken === 0 ? "processed, ack sent twice" : "processed, ack sent once" },
    { queue_event: `msg-2 fails processing x${poisonMax}`, outcome: broken === 1 ? "requeued a 4th time" : "moved to poison queue" },
    { queue_event: `${worker} receives msg-3`, outcome: broken === 2 ? "acked immediately, then processing begins" : "ack sent only after processing completes" },
    { queue_event: `worker-A and worker-B both receive msg-4 concurrently`, outcome: broken === 3 ? "both processed msg-4" : "exactly one of worker-A/worker-B processed msg-4" },
  ];
  return { criteria, recordings };
}

function rateLimiterLike(p) {
  const { api, limitPerMin, client } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `\`${client}\` making ${limitPerMin} requests to ${api} in one minute succeeds on all ${limitPerMin}.` },
    { key: "c1", class: "scenario", text: `\`${client}\`'s (${limitPerMin} + 1)th request within the same minute is rejected with HTTP 429.` },
    { key: "c2", class: "assertion", text: `The 429 response carries a \`Retry-After\` header naming a wait time, not a bare rejection.` },
    { key: "c3", class: "assertion", text: `The rate-limit counter for \`${client}\` resets at the minute boundary — a request one second into the next minute is not still counted against the prior window.` },
    { key: "c4", class: "prose", text: `The 429 error body is written for the API consumer, not an internal stack trace.` },
  ];
  const recordings = (broken) => [
    { request: `${client}: ${limitPerMin} req/min to ${api}`, response: broken === 0 ? `request ${limitPerMin} rejected 429` : `all ${limitPerMin} requests 200 OK` },
    { request: `${client}: request #${limitPerMin + 1} same minute`, response: broken === 1 ? `200 OK (limit not enforced)` : `429 Too Many Requests` },
    { request: `429 response headers`, response: broken === 2 ? `no Retry-After header present` : `Retry-After: 42` },
    { request: `${client}: request 1s into next minute`, response: broken === 3 ? `429 (stale window counted)` : `200 OK (fresh window)` },
  ];
  return { criteria, recordings };
}

function cacheInvalidationLike(p) {
  const { cacheKey, ttlSec, store } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `Writing \`${cacheKey}\` to ${store} and reading it back within ${ttlSec}s returns the written value from cache (no re-fetch from the source of truth).` },
    { key: "c1", class: "scenario", text: `Explicitly invalidating \`${cacheKey}\` makes the very next read miss the cache and hit the source of truth.` },
    { key: "c2", class: "assertion", text: `A cached entry older than ${ttlSec}s is treated as expired and re-fetched, never served stale past its TTL.` },
    { key: "c3", class: "assertion", text: `Updating the source-of-truth value for \`${cacheKey}\` without an explicit invalidation leaves the cached copy exactly as it was (write-through is NOT assumed for this cache) — no silent staleness masquerading as freshness.` },
    { key: "c4", class: "prose", text: `Cache-hit/miss log lines are informative enough to debug a staleness complaint quickly.` },
  ];
  const recordings = (broken) => [
    { op: `write ${cacheKey}=v1, read within ${ttlSec}s`, result: broken === 0 ? "cache miss, re-fetched from source" : "cache hit, returned v1" },
    { op: `invalidate ${cacheKey}, immediate read`, result: broken === 1 ? "cache hit (stale value returned)" : "cache miss, source of truth read" },
    { op: `read ${cacheKey} at age ${ttlSec + 5}s (past TTL ${ttlSec}s)`, result: broken === 2 ? "cache hit, stale value returned" : "cache miss, treated as expired" },
    { op: `source updated to v2, no invalidation call made, cache read`, result: broken === 3 ? "returned v2 (unexpected write-through)" : "returned v1 (cached copy unchanged, as designed)" },
  ];
  return { criteria, recordings };
}

function cronSchedulerLike(p) {
  const { job, cronExpr, overlapMode } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `\`${job}\` scheduled at \`${cronExpr}\` fires at its next scheduled time and completes successfully.` },
    { key: "c1", class: "scenario", text: `If \`${job}\`'s previous run is still executing when the next scheduled time arrives, the scheduler applies its \`${overlapMode}\` policy rather than starting a second concurrent run unconditionally.` },
    { key: "c2", class: "assertion", text: `A run of \`${job}\` that throws is recorded as \`failed\`, not silently swallowed as a completed run.` },
    { key: "c3", class: "assertion", text: `The scheduler's next-run-time calculation for \`${cronExpr}\` accounts for the job's OWN actual last-run time, not a naive fixed-interval guess that could drift.` },
    { key: "c4", class: "prose", text: `The scheduler's run-history view makes it easy to spot a job that's silently stopped firing.` },
  ];
  const recordings = (broken) => [
    { log: `[scheduler] ${job} fired at scheduled time (${cronExpr})`, log2: broken === 0 ? "run recorded as failed despite clean exit" : "run recorded as succeeded" },
    { log: `[scheduler] ${job} still running; next fire time reached (overlapMode=${overlapMode})`, log2: broken === 1 ? "started a second concurrent run unconditionally" : `applied ${overlapMode} policy` },
    { log: `[scheduler] ${job} run threw an exception`, log2: broken === 2 ? "run recorded as succeeded" : "run recorded as failed" },
    { log: `[scheduler] ${job} last actual run was late by 90s`, log2: broken === 3 ? "next-run time computed from the ORIGINAL schedule, drift compounding" : "next-run time computed accounting for the actual last-run" },
  ];
  return { criteria, recordings };
}

function configValidateLike(p) {
  const { tool, key1, key2 } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `A config file with every required key present, including \`${key1}\`, validates cleanly under \`${tool} config validate\` and exits 0.` },
    { key: "c1", class: "scenario", text: `A config file missing the required \`${key2}\` key fails validation and names \`${key2}\` specifically in the error.` },
    { key: "c2", class: "assertion", text: `A config file with an out-of-range value for \`${key1}\` (e.g. a negative timeout) is rejected, not silently clamped.` },
    { key: "c3", class: "assertion", text: `Validating a config file never mutates the file on disk — a byte-for-byte diff of the file before and after \`config validate\` is empty.` },
    { key: "c4", class: "prose", text: `The validation error for a missing key tells you exactly which file and line to fix.` },
  ];
  const recordings = (broken) => [
    { command: `${tool} config validate (all keys present incl. ${key1})`, output: broken === 0 ? `exit 1: unexpected error` : `exit 0: config OK` },
    { command: `${tool} config validate (missing ${key2})`, output: broken === 1 ? `exit 1: validation failed (no key named)` : `exit 1: missing required key "${key2}"` },
    { command: `${tool} config validate (${key1}=-5, out of range)`, output: broken === 2 ? `exit 0: config OK (clamped ${key1} to 0)` : `exit 1: ${key1} must be >= 0` },
    { command: `${tool} config validate; diff config.yaml before/after`, output: broken === 3 ? `diff non-empty: trailing whitespace normalized` : `diff empty` },
  ];
  return { criteria, recordings };
}

function migrationRunLike(p) {
  const { tool, table, colName, target } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `Running \`${tool} migrate up\` applies the pending migration adding \`${colName}\` to \`${table}\` and records it as applied.` },
    { key: "c1", class: "scenario", text: `Running \`${tool} migrate down\` after that reverts the \`${colName}\` addition and the migration is recorded as un-applied again.` },
    { key: "c2", class: "assertion", text: `A migration that fails partway through is rolled back in full — \`${table}\` is left in its pre-migration state, not half-migrated.` },
    { key: "c3", class: "assertion", text: `Existing rows in \`${table}\` retain their original values for every column other than the new \`${colName}\` after the migration runs (no unrelated data drift).` },
    { key: "c4", class: "prose", text: `The migration tool's dry-run preview gives an operator real confidence before running it for real against ${target}.` },
  ];
  const recordings = (broken) => [
    { command: `${tool} migrate up`, output: broken === 0 ? `applied 0 migrations (expected: add ${colName} to ${table})` : `applied 1 migration: add ${colName} to ${table}` },
    { command: `${tool} migrate down`, output: broken === 1 ? `no-op; ${colName} still present on ${table}` : `reverted 1 migration; ${colName} removed from ${table}` },
    { command: `${tool} migrate up (injected failure mid-migration)`, output: broken === 2 ? `partial state left on ${table}; not rolled back` : `migration failed and was fully rolled back; ${table} unchanged` },
    { command: `SELECT * FROM ${table} LIMIT 1 (before/after migration)`, output: broken === 3 ? `other column values changed unexpectedly` : `all other column values unchanged` },
  ];
  return { criteria, recordings };
}

function permissionCheckLike(p) {
  const { resource, role1, role2, action } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `A user with role \`${role1}\` performing \`${action}\` on \`${resource}\` is allowed.` },
    { key: "c1", class: "scenario", text: `A user with role \`${role2}\`, which lacks \`${action}\` permission on \`${resource}\`, is denied with HTTP 403.` },
    { key: "c2", class: "assertion", text: `A denied \`${action}\` attempt on \`${resource}\` is written to the audit log with the actor's identity, not silently dropped.` },
    { key: "c3", class: "assertion", text: `Revoking \`${role1}\`'s \`${action}\` permission on \`${resource}\` takes effect on the NEXT request from an already-logged-in \`${role1}\` user, not only for new logins.` },
    { key: "c4", class: "prose", text: `The 403 response explains what permission is missing, without revealing more than the caller should know.` },
  ];
  const recordings = (broken) => [
    { request: `${role1} attempts ${action} on ${resource}`, response: broken === 0 ? `403 Forbidden` : `200 OK` },
    { request: `${role2} attempts ${action} on ${resource}`, response: broken === 1 ? `200 OK (permission not enforced)` : `403 Forbidden` },
    { request: `${role2}'s denied attempt`, response: broken === 2 ? `no audit log entry written` : `audit log entry written with actor=${role2}` },
    { request: `${role1}'s permission revoked mid-session; next request`, response: broken === 3 ? `200 OK (stale session permission honoured)` : `403 Forbidden (revocation applied)` },
  ];
  return { criteria, recordings };
}

function auditLoggingLike(p) {
  const { system, actor, action, target } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `\`${actor}\` performing \`${action}\` on \`${target}\` in ${system} produces exactly one audit-log entry naming the actor, action, and target.` },
    { key: "c1", class: "scenario", text: `A failed (rejected) \`${action}\` attempt is ALSO audit-logged, not only successful ones.` },
    { key: "c2", class: "assertion", text: `An audit-log entry, once written, is never mutated by a later action — re-reading it after other events occur returns the byte-identical original entry.` },
    { key: "c3", class: "assertion", text: `The audit-log timestamp for an entry matches the actual time the action occurred, not the time a batched writer happened to flush it.` },
    { key: "c4", class: "prose", text: `Audit entries read clearly enough for a compliance reviewer with no system context to understand what happened.` },
  ];
  const recordings = (broken) => [
    { event: `${actor} performs ${action} on ${target}`, log: broken === 0 ? `2 audit entries written for this single action` : `1 audit entry: actor=${actor} action=${action} target=${target}` },
    { event: `${actor}'s ${action} on ${target} is rejected`, log: broken === 1 ? `no audit entry written` : `1 audit entry, outcome=rejected` },
    { event: `re-read the entry after 3 unrelated later events`, log: broken === 2 ? `entry fields differ from the original write` : `entry byte-identical to the original write` },
    { event: `action occurred at T, batched writer flushed at T+30s`, log: broken === 3 ? `entry timestamp = T+30s (flush time)` : `entry timestamp = T (actual action time)` },
  ];
  return { criteria, recordings };
}

function sessionManagementLike(p) {
  const { app, user, idleMin } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `A freshly-issued ${app} session for \`${user}\` is accepted on the very next authenticated request.` },
    { key: "c1", class: "scenario", text: `A session idle for longer than ${idleMin} minutes is rejected on the next request, requiring re-authentication.` },
    { key: "c2", class: "assertion", text: `Logging out \`${user}\` invalidates that session immediately — a request replayed with the same (now-logged-out) session token is rejected.` },
    { key: "c3", class: "assertion", text: `Two concurrent sessions for \`${user}\` (e.g. two devices) are independent — logging out one does not invalidate the other.` },
    { key: "c4", class: "prose", text: `The session-expired message tells the user what happened without sounding like a security alarm.` },
  ];
  const recordings = (broken) => [
    { request: `authenticated request, session issued 1s ago`, response: broken === 0 ? `401 Unauthorized` : `200 OK` },
    { request: `authenticated request, session idle ${idleMin + 1} minutes`, response: broken === 1 ? `200 OK (idle timeout not enforced)` : `401 Unauthorized, re-auth required` },
    { request: `logout ${user}, then replay old session token`, response: broken === 2 ? `200 OK (old session still valid)` : `401 Unauthorized` },
    { request: `${user} logs out device A; request on device B's session`, response: broken === 3 ? `401 Unauthorized (device B invalidated too)` : `200 OK (device B unaffected)` },
  ];
  return { criteria, recordings };
}

function paymentProcessingLike(p) {
  const { gateway, amount, currency, orderId } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `Charging ${amount} ${currency} against a valid card via ${gateway} for order \`${orderId}\` succeeds and the order is marked paid.` },
    { key: "c1", class: "scenario", text: `A declined card is reported to the caller as declined (not silently retried against the same card) and the order stays unpaid.` },
    { key: "c2", class: "assertion", text: `The same idempotency key submitted twice for order \`${orderId}\` results in exactly one charge, not two.` },
    { key: "c3", class: "assertion", text: `A refund issued against a charge for \`${orderId}\` updates the order's paid amount to reflect the refund; the order does not still show the original full amount as paid.` },
    { key: "c4", class: "prose", text: `The decline-reason messaging shown to the customer is helpful without exposing raw gateway internals.` },
  ];
  const recordings = (broken) => [
    { request: `charge ${amount} ${currency} to order ${orderId} via ${gateway}`, response: broken === 0 ? `declined; order stays unpaid` : `charge succeeded; order ${orderId} marked paid` },
    { request: `charge declined card for order ${orderId}`, response: broken === 1 ? `charge retried automatically against same card, also declined` : `declined; reported once, no auto-retry; order unpaid` },
    { request: `same idempotency key submitted twice for order ${orderId}`, response: broken === 2 ? `2 separate charges recorded` : `1 charge recorded (2nd submission returned the original result)` },
    { request: `refund issued for order ${orderId}`, response: broken === 3 ? `order still shows full ${amount} ${currency} as paid` : `order's paid amount reduced to reflect the refund` },
  ];
  return { criteria, recordings };
}

function searchIndexingLike(p) {
  const { index, docId, field, term } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `Indexing a document with \`${field}\` containing "${term}" into \`${index}\` makes it findable by searching for "${term}" immediately after indexing completes.` },
    { key: "c1", class: "scenario", text: `Deleting document \`${docId}\` from \`${index}\` removes it from subsequent search results for terms it previously matched.` },
    { key: "c2", class: "assertion", text: `Re-indexing document \`${docId}\` with updated \`${field}\` content replaces the old indexed version — search no longer matches on the OLD \`${field}\` value.` },
    { key: "c3", class: "assertion", text: `A search for "${term}" returns document \`${docId}\` at most once, even if "${term}" appears multiple times within its \`${field}\`.` },
    { key: "c4", class: "prose", text: `Search result snippets highlight the matched term in a way that's actually useful to a user scanning results.` },
  ];
  const recordings = (broken) => [
    { op: `index doc ${docId} with ${field}="...${term}...", then search "${term}"`, result: broken === 0 ? `0 results` : `doc ${docId} found` },
    { op: `delete doc ${docId} from ${index}, then search a term it previously matched`, result: broken === 1 ? `doc ${docId} still returned` : `doc ${docId} not returned` },
    { op: `re-index doc ${docId} with new ${field} content, search OLD ${field} value`, result: broken === 2 ? `doc ${docId} still matches the old value` : `doc ${docId} does not match the old value` },
    { op: `search "${term}" (matches doc ${docId} 3x within its ${field})`, result: broken === 3 ? `doc ${docId} appears 3 times in results` : `doc ${docId} appears once in results` },
  ];
  return { criteria, recordings };
}

function fileUploadLike(p) {
  const { service, maxMb, fileName } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `Uploading \`${fileName}\` under the ${maxMb}MB limit to ${service} succeeds and returns a retrievable file id.` },
    { key: "c1", class: "scenario", text: `Uploading a file over the ${maxMb}MB limit is rejected with HTTP 413, not accepted and truncated.` },
    { key: "c2", class: "assertion", text: `A file uploaded and then downloaded from ${service} is byte-for-byte identical to what was uploaded (no re-encoding/corruption).` },
    { key: "c3", class: "assertion", text: `Deleting an uploaded file makes it immediately return HTTP 404 on subsequent download attempts, not still-servable stale content.` },
    { key: "c4", class: "prose", text: `The 413-too-large error message tells the user the actual limit, not a generic failure.` },
  ];
  const recordings = (broken) => [
    { request: `upload ${fileName} (under ${maxMb}MB)`, response: broken === 0 ? `413 Payload Too Large` : `201 Created; file id issued` },
    { request: `upload oversized.bin (over ${maxMb}MB)`, response: broken === 1 ? `201 Created; file truncated to ${maxMb}MB and stored` : `413 Payload Too Large` },
    { request: `download ${fileName} after upload; compare bytes`, response: broken === 2 ? `bytes differ from the original upload` : `bytes identical to the original upload` },
    { request: `delete ${fileName}, then download it`, response: broken === 3 ? `200 OK, stale content served` : `404 Not Found` },
  ];
  return { criteria, recordings };
}

function rateAlertingLike(p) {
  const { metric, threshold, service } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `\`${metric}\` for ${service} crossing above ${threshold} fires exactly one alert to the on-call channel.` },
    { key: "c1", class: "scenario", text: `\`${metric}\` returning back below ${threshold} after an alert fires a resolved notification, not left open forever.` },
    { key: "c2", class: "assertion", text: `\`${metric}\` oscillating around ${threshold} (crossing it repeatedly within a short window) does not spam a fresh alert on every single crossing — flap-suppression applies.` },
    { key: "c3", class: "assertion", text: `The alert payload for a \`${metric}\` breach includes the actual observed value, not just a static "threshold breached" message.` },
    { key: "c4", class: "prose", text: `The alert text gives an on-call engineer enough to decide urgency without opening a dashboard first.` },
  ];
  const recordings = (broken) => [
    { event: `${metric} crosses above ${threshold} for ${service}`, alerting: broken === 0 ? `0 alerts fired` : `1 alert fired` },
    { event: `${metric} drops back below ${threshold} after an open alert`, alerting: broken === 1 ? `alert remains open indefinitely` : `resolved notification fired` },
    { event: `${metric} crosses ${threshold} 5 times in 60s`, alerting: broken === 2 ? `5 separate alerts fired` : `1 alert fired (flap-suppressed)` },
    { event: `${metric} breach at value ${threshold + 37}`, alerting: broken === 3 ? `alert body: "threshold breached" (no value)` : `alert body includes observed value ${threshold + 37}` },
  ];
  return { criteria, recordings };
}

function backupRestoreLike(p) {
  const { tool, snapshotId, db } = p;
  const criteria = [
    { key: "c0", class: "scenario", text: `\`${tool} backup ${db}\` produces a snapshot \`${snapshotId}\` and \`${tool} verify ${snapshotId}\` confirms it is restorable.` },
    { key: "c1", class: "scenario", text: `\`${tool} restore ${snapshotId}\` into a fresh target reproduces \`${db}\`'s row counts exactly as they were at backup time.` },
    { key: "c2", class: "assertion", text: `A backup taken while a write is mid-transaction never captures a partially-committed row (the snapshot is transactionally consistent).` },
    { key: "c3", class: "assertion", text: `Restoring \`${snapshotId}\` into an already-populated target refuses by default (no silent overwrite) unless an explicit \`--force\` is given.` },
    { key: "c4", class: "prose", text: `The restore tool's confirmation prompt makes the blast radius of the operation clear before it runs.` },
  ];
  const recordings = (broken) => [
    { command: `${tool} backup ${db}; ${tool} verify ${snapshotId}`, output: broken === 0 ? `verify FAILED: snapshot corrupt` : `verify OK: ${snapshotId} restorable` },
    { command: `${tool} restore ${snapshotId} into fresh target`, output: broken === 1 ? `row counts differ from backup time` : `row counts match backup time exactly` },
    { command: `backup taken during a mid-transaction write`, output: broken === 2 ? `snapshot contains a partially-committed row` : `snapshot is transactionally consistent` },
    { command: `${tool} restore ${snapshotId} into an already-populated target (no --force)`, output: broken === 3 ? `restore proceeded, existing data overwritten` : `refused: target not empty, use --force` },
  ];
  return { criteria, recordings };
}

function DOMAINS_LIST() {
  return [
    { key: "http-orders", build: httpOrdersLike,
      params: [
        { noun: "order", id1: "ord-1001", id2: "ord-1101", field: "email", badField: "item", port: 8080 },
        { noun: "invoice", id1: "inv-2001", id2: "inv-2101", field: "customer_id", badField: "line_item", port: 8081 },
        { noun: "ticket", id1: "tkt-3001", id2: "tkt-3101", field: "reporter", badField: "priority", port: 8082 },
        { noun: "booking", id1: "bkg-4001", id2: "bkg-4101", field: "guest_email", badField: "room_type", port: 8083 },
        { noun: "shipment", id1: "shp-5001", id2: "shp-5101", field: "recipient", badField: "carrier", port: 8084 },
        { noun: "subscription", id1: "sub-6001", id2: "sub-6101", field: "plan_id", badField: "billing_cycle", port: 8085 },
      ] },
    { key: "cli-deploy", build: cliDeployLike,
      params: [
        { tool: "shipctl", env: "staging", ver1: "1.4.2", ver2: "1.4.1" },
        { tool: "releaser", env: "production", ver1: "9.0.0", ver2: "8.9.7" },
        { tool: "pushtool", env: "canary", ver1: "2.1.0-rc3", ver2: "2.0.9" },
        { tool: "rollout", env: "eu-west", ver1: "5.3.0", ver2: "5.2.8" },
        { tool: "cfctl", env: "dr", ver1: "0.9.1", ver2: "0.9.0" },
      ] },
    { key: "batch-etl", build: batchEtlLike,
      params: [
        { job: "orders-etl", srcRows: 5000, badRows: 12, table: "orders_fact" },
        { job: "clickstream-etl", srcRows: 82000, badRows: 340, table: "events_fact" },
        { job: "billing-etl", srcRows: 1200, badRows: 3, table: "invoices_fact" },
        { job: "inventory-etl", srcRows: 9600, badRows: 41, table: "stock_fact" },
        { job: "hr-etl", srcRows: 640, badRows: 2, table: "employees_fact" },
      ] },
    { key: "auth-login", build: authLoginLike,
      params: [
        { service: "portal", user: "alice", badPass: "wrong1", lockThreshold: 5 },
        { service: "admin-console", user: "bob", badPass: "wrong2", lockThreshold: 3 },
        { service: "mobile-api", user: "carol", badPass: "wrong3", lockThreshold: 5 },
        { service: "partner-hub", user: "dave", badPass: "wrong4", lockThreshold: 10 },
        { service: "internal-tools", user: "erin", badPass: "wrong5", lockThreshold: 5 },
      ] },
    { key: "pipeline-validate", build: pipelineValidateLike,
      params: [
        { pipeline: "events-pipeline", schemaField: "user_id", threshold: 5, badRatio: 8 },
        { pipeline: "metrics-pipeline", schemaField: "metric_name", threshold: 2, badRatio: 4 },
        { pipeline: "logs-pipeline", schemaField: "trace_id", threshold: 10, badRatio: 15 },
        { pipeline: "orders-pipeline", schemaField: "order_id", threshold: 1, badRatio: 3 },
      ] },
    { key: "notification-send", build: notificationSendLike,
      params: [
        { channel: "email", recipient: "user-1", template: "welcome", retryMax: 3 },
        { channel: "sms", recipient: "user-2", template: "otp", retryMax: 2 },
        { channel: "push", recipient: "user-3", template: "reminder", retryMax: 3 },
        { channel: "email", recipient: "user-4", template: "receipt", retryMax: 4 },
        { channel: "slack", recipient: "user-5", template: "alert", retryMax: 1 },
      ] },
    { key: "webhook-delivery", build: webhookDeliveryLike,
      params: [
        { endpoint: "https://partner-a.example/hook", event: "order.created", secret: "whsec-a", backoffBase: 2 },
        { endpoint: "https://partner-b.example/hook", event: "invoice.paid", secret: "whsec-b", backoffBase: 5 },
        { endpoint: "https://partner-c.example/hook", event: "shipment.updated", secret: "whsec-c", backoffBase: 3 },
        { endpoint: "https://partner-d.example/hook", event: "user.deleted", secret: "whsec-d", backoffBase: 1 },
      ] },
    { key: "queue-consumer", build: queueConsumerLike,
      params: [
        { queue: "orders-queue", worker: "order-worker", poisonMax: 5 },
        { queue: "email-queue", worker: "email-worker", poisonMax: 3 },
        { queue: "image-queue", worker: "thumbnail-worker", poisonMax: 4 },
        { queue: "export-queue", worker: "export-worker", poisonMax: 6 },
      ] },
    { key: "rate-limiter", build: rateLimiterLike,
      params: [
        { api: "/v1/search", limitPerMin: 60, client: "client-x" },
        { api: "/v1/upload", limitPerMin: 10, client: "client-y" },
        { api: "/v1/orders", limitPerMin: 120, client: "client-z" },
        { api: "/v1/reports", limitPerMin: 20, client: "client-w" },
      ] },
    { key: "cache-invalidation", build: cacheInvalidationLike,
      params: [
        { cacheKey: "user:42:profile", ttlSec: 60, store: "redis-profiles" },
        { cacheKey: "product:900:price", ttlSec: 30, store: "redis-catalog" },
        { cacheKey: "session:abc123", ttlSec: 900, store: "redis-sessions" },
        { cacheKey: "config:feature-flags", ttlSec: 15, store: "redis-config" },
      ] },
    { key: "cron-scheduler", build: cronSchedulerLike,
      params: [
        { job: "nightly-report", cronExpr: "0 2 * * *", overlapMode: "skip" },
        { job: "hourly-sync", cronExpr: "0 * * * *", overlapMode: "queue" },
        { job: "weekly-cleanup", cronExpr: "0 3 * * 0", overlapMode: "skip" },
        { job: "5min-heartbeat", cronExpr: "*/5 * * * *", overlapMode: "kill-and-restart" },
      ] },
    { key: "config-validate", build: configValidateLike,
      params: [
        { tool: "svcctl", key1: "timeout_ms", key2: "db_url" },
        { tool: "appcfg", key1: "max_conns", key2: "api_key" },
        { tool: "envtool", key1: "retry_budget", key2: "region" },
        { tool: "confcheck", key1: "cache_ttl", key2: "log_level" },
      ] },
    { key: "migration-run", build: migrationRunLike,
      params: [
        { tool: "dbmig", table: "users", colName: "last_login_at", target: "production" },
        { tool: "schemer", table: "orders", colName: "fulfilled_at", target: "staging" },
        { tool: "flyweight-mig", table: "invoices", colName: "currency_code", target: "production" },
        { tool: "railsmig", table: "sessions", colName: "device_type", target: "staging" },
      ] },
    { key: "permission-check", build: permissionCheckLike,
      params: [
        { resource: "billing-settings", role1: "admin", role2: "viewer", action: "edit" },
        { resource: "user-records", role1: "hr-manager", role2: "employee", action: "delete" },
        { resource: "deploy-pipeline", role1: "release-manager", role2: "developer", action: "approve" },
        { resource: "financial-report", role1: "finance-lead", role2: "sales-rep", action: "export" },
      ] },
    { key: "audit-logging", build: auditLoggingLike,
      params: [
        { system: "billing-system", actor: "admin-1", action: "refund", target: "invoice-500" },
        { system: "access-system", actor: "admin-2", action: "grant-role", target: "user-77" },
        { system: "content-system", actor: "editor-1", action: "publish", target: "article-88" },
        { system: "infra-system", actor: "operator-1", action: "restart-service", target: "svc-payments" },
      ] },
    { key: "session-management", build: sessionManagementLike,
      params: [
        { app: "web-portal", user: "frank", idleMin: 30 },
        { app: "mobile-app", user: "grace", idleMin: 15 },
        { app: "admin-console", user: "heidi", idleMin: 10 },
        { app: "partner-portal", user: "ivan", idleMin: 60 },
      ] },
    { key: "payment-processing", build: paymentProcessingLike,
      params: [
        { gateway: "stripe-like", amount: "49.99", currency: "USD", orderId: "ord-9001" },
        { gateway: "adyen-like", amount: "120.00", currency: "EUR", orderId: "ord-9002" },
        { gateway: "braintree-like", amount: "15.50", currency: "GBP", orderId: "ord-9003" },
        { gateway: "worldpay-like", amount: "300.00", currency: "USD", orderId: "ord-9004" },
      ] },
    { key: "search-indexing", build: searchIndexingLike,
      params: [
        { index: "products-index", docId: "doc-1", field: "title", term: "wireless" },
        { index: "articles-index", docId: "doc-2", field: "body", term: "migration" },
        { index: "users-index", docId: "doc-3", field: "bio", term: "engineer" },
        { index: "support-index", docId: "doc-4", field: "summary", term: "refund" },
      ] },
    { key: "file-upload", build: fileUploadLike,
      params: [
        { service: "media-store", maxMb: 25, fileName: "report.pdf" },
        { service: "avatar-store", maxMb: 5, fileName: "avatar.png" },
        { service: "attachment-store", maxMb: 50, fileName: "archive.zip" },
        { service: "video-store", maxMb: 500, fileName: "clip.mp4" },
      ] },
    { key: "rate-alerting", build: rateAlertingLike,
      params: [
        { metric: "error_rate_pct", threshold: 5, service: "checkout-svc" },
        { metric: "p99_latency_ms", threshold: 800, service: "search-svc" },
        { metric: "queue_depth", threshold: 1000, service: "worker-pool" },
        { metric: "cpu_pct", threshold: 90, service: "api-gateway" },
      ] },
    { key: "backup-restore", build: backupRestoreLike,
      params: [
        { tool: "dbback", snapshotId: "snap-2026-01", db: "orders-db" },
        { tool: "volback", snapshotId: "snap-2026-02", db: "users-db" },
        { tool: "clusterback", snapshotId: "snap-2026-03", db: "analytics-db" },
        { tool: "quickback", snapshotId: "snap-2026-04", db: "billing-db" },
      ] },
  ];
}

// ─── Case assembly ───────────────────────────────────────────────────────────────────────────────────

const DEFECT_CLASS_BY_ROLE = ["subtly-wrong", "missed-criterion", "working-but-off-spec", "spec-satisfying-but-broken-elsewhere"];

// PURE — vary the criteria-set size (spec §3: "roughly 3-7 per case") without touching the four core
// roles or the defect-position convention. `variant` (0-2) is deterministic per (domain, instance) so
// the corpus is reproducible: 0 = base 5 (4 core + prose, the majority shape), 1 = drop prose -> 4 (a
// born-verifiable-only case, still >=3), 2 = add 2 always-met distractor criteria -> 7 (never targeted
// by a defect, so they never affect polarity — only the criteria-count and read-realism).
function varyCriteria(criteria, variant, domainKey, instanceIdx) {
  if (variant === 1) return criteria.filter((c) => c.class !== "prose"); // 4 born-verifiable, no prose
  if (variant === 2) {
    const extra = [
      { key: "cx1", class: "scenario", text: `An unrelated read-only endpoint touched incidentally by this flow behaves as documented elsewhere (distractor — not part of this case's seeded defect).` },
      { key: "cx2", class: "assertion", text: `A concurrent, unrelated request against a different resource is unaffected by this flow (distractor — not part of this case's seeded defect).` },
    ];
    return [...criteria, ...extra];
  }
  return criteria; // variant 0 — base 5
}

// PURE — the distractor recordings appended for variant 2 (always resolve "met" for cx1/cx2, never
// touched by any role's break — a genuine distractor, present in every case built from this variant).
const DISTRACTOR_RECORDINGS = [
  { note: "GET /health (unrelated endpoint touched incidentally by this flow)", response: "200 OK; body {\"status\":\"ok\"}" },
  { note: "a concurrent, unrelated request against a different resource, observed mid-flow", response: "200 OK; unaffected by this flow" },
];

function buildCases(domainKey, instanceIdx, spec) {
  const variant = instanceIdx % 3; // deterministic 0/1/2 rotation across a domain's param instances
  const criteria = varyCriteria(spec.criteria, variant, domainKey, instanceIdx);
  const withDistractors = variant === 2;
  const recordingsFor = (broken) => withDistractors ? [...spec.recordings(broken), ...DISTRACTOR_RECORDINGS] : spec.recordings(broken);
  const cases = [];

  // clean case
  const cleanOracle = criteria.map((c) => `${c.key}:${c.class === "prose" ? "needs-human" : "met"}`);
  cases.push({
    id: `holdout-seed-clean-${domainKey}-${String(instanceIdx).padStart(3, "0")}`,
    kind: "holdout-exercise",
    label: "clean",
    defect_class: null,
    expected_aggregate: "meets-spec",
    fixture: { version: 1, spec_dod: criteria, recordings: recordingsFor(null) },
    question: QUESTION,
    oracle: { closed_set: cleanOracle },
  });

  // one defective case per role (0-3) — distractor keys (cx1/cx2, when present) are NEVER targeted:
  // role only ranges 0-3, and distractors sit at higher indices, so `i === role` is always false for them.
  for (let role = 0; role < 4; role++) {
    const defect_class = DEFECT_CLASS_BY_ROLE[role];
    const oracle = criteria.map((c, i) => {
      if (c.class === "prose") return `${c.key}:needs-human`;
      return `${c.key}:${i === role ? "unmet" : "met"}`;
    });
    cases.push({
      id: `holdout-seed-neg-${defect_class}-${domainKey}-${String(instanceIdx).padStart(3, "0")}`,
      kind: "holdout-exercise",
      label: "defective",
      defect_class,
      expected_aggregate: "gaps",
      fixture: { version: 1, spec_dod: criteria, recordings: recordingsFor(role) },
      question: QUESTION,
      oracle: { closed_set: oracle },
    });
  }

  return cases;
}

export function generateCorpus() {
  const domains = DOMAINS_LIST();
  const all = [];
  for (const d of domains) {
    d.params.forEach((p, i) => {
      const spec = d.build(p);
      all.push(...buildCases(d.key, i + 1, spec));
    });
  }
  return all;
}

function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const cases = generateCorpus();
  for (const c of cases) {
    writeFileSync(join(OUT_DIR, `${c.id}.json`), JSON.stringify(c, null, 2) + "\n");
  }
  const neg = cases.filter((c) => c.label === "defective");
  const clean = cases.filter((c) => c.label === "clean");
  const byClass = {};
  for (const c of neg) byClass[c.defect_class] = (byClass[c.defect_class] ?? 0) + 1;
  console.log(`[gen-cases-seeded] wrote ${cases.length} cases to ${OUT_DIR}`);
  console.log(`  clean: ${clean.length}`);
  console.log(`  defective: ${neg.length} (${JSON.stringify(byClass)})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
