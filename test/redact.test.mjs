// FAFF-107 — exact known-secret redaction at the two code-owned durable-write
// boundaries: `appendEventRecord` (events.js) and `atomicWriteLedger`
// (heartbeat.js). Narrow, human-approved slice: exact values only, from an
// allowlisted set of config sources (`api_key_env` / `seat_token_env` handles,
// `andon.url` / `andon.token` direct fields), length >= 8, replaced with the
// single opaque placeholder `[REDACTED]`. No token-shape regexes, no PII, no
// config toggle (records/specs/2026-08-12-faff-107-…-design.md).
//
// Three layers of coverage:
//  - pure-core (collectKnownSecretValues / redactKnownSecrets): direct import,
//    no filesystem/config involved.
//  - wiring (appendEventRecord / atomicWriteLedger): direct import + a real
//    fixture `.faffrc.yaml` + `process.chdir` (mirrors test/models-config.test.mjs's
//    established pattern), since redaction resolves config via findRoot()
//    against the caller's cwd, not a passed-in root.
//  - a `faff events --selftest` / `faff heartbeat --selftest` CLI smoke check
//    that the redaction pure-core assertions in redact.js's own `redactSelftest`
//    are wired into the existing selftest surfaces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectKnownSecretValues, redactKnownSecrets, resolveKnownSecretValues, MIN_SECRET_LENGTH, REDACTED_PLACEHOLDER } from "../plugin/skills/faff/bin/lib/redact.js";
import { appendEventRecord } from "../plugin/skills/faff/bin/lib/events.js";
import { atomicWriteLedger } from "../plugin/skills/faff/bin/lib/heartbeat.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function runCliRaw(args, env) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

// ---------------------------------------------------------------------------
// pure core: collectKnownSecretValues
// ---------------------------------------------------------------------------

test("collectKnownSecretValues: resolves api_key_env through env, andon.url/token direct", () => {
  const config = {
    backends: { primary: { provider: "nvidia", api_key_env: "SERVICE_API_KEY" } },
    andon: { url: "https://hooks.example.com/T000/B000/aLongEnoughWebhookSecret", token: "shortish" },
  };
  const env = { SERVICE_API_KEY: "aLongEnoughApiKeyValue1234" };
  const values = collectKnownSecretValues(config, env);
  assert.ok(values.includes("aLongEnoughApiKeyValue1234"));
  assert.ok(values.includes("https://hooks.example.com/T000/B000/aLongEnoughWebhookSecret"));
  // "shortish" is 8 chars exactly — the floor is inclusive (>= 8) — included.
  assert.ok(values.includes("shortish"));
});

test("collectKnownSecretValues: eight-char floor is strict — 7-char values excluded", () => {
  const values = collectKnownSecretValues({ andon: { token: "seven77" } }, {});
  assert.equal(values.includes("seven77"), false);
  assert.equal(values.length, 0);
});

test("collectKnownSecretValues: absent env handle contributes no target, no crash", () => {
  const values = collectKnownSecretValues({ backends: { a: { api_key_env: "NOT_SET_ANYWHERE" } } }, {});
  assert.deepEqual(values, []);
});

test("collectKnownSecretValues: only the allowlisted field NAMES are read — no generic *_env sweep", () => {
  const config = { some_random_env: "LOOKS_LIKE_A_HANDLE", weird_TOKEN_field: "alsolookssecret" };
  const values = collectKnownSecretValues(config, { LOOKS_LIKE_A_HANDLE: "shouldnotbecollectedXX" });
  assert.deepEqual(values, []);
});

test("collectKnownSecretValues: seat_token_env resolved the same as api_key_env", () => {
  const config = { backends: { seat: { auth: "subscription-seat", seat_token_env: "CLAUDE_SEAT_TOKEN" } } };
  const values = collectKnownSecretValues(config, { CLAUDE_SEAT_TOKEN: "aLongEnoughSeatToken123" });
  assert.ok(values.includes("aLongEnoughSeatToken123"));
});

test("collectKnownSecretValues: recurses into nested backend maps (allowlisted key NAME, any depth)", () => {
  const config = { faffter_dark: { adversarial: { backends: { inline: { api_key_env: "NESTED_KEY" } } } } };
  const values = collectKnownSecretValues(config, { NESTED_KEY: "aNestedSecretValue12" });
  assert.ok(values.includes("aNestedSecretValue12"));
});

test("collectKnownSecretValues: deduplicates and sorts longest-first, then lexical", () => {
  const config = { backends: { a: { api_key_env: "K1" }, b: { api_key_env: "K2" }, c: { api_key_env: "K3" } } };
  const env = { K1: "shorter8", K2: "aMuchLongerValueHere123", K3: "shorter8" };
  const values = collectKnownSecretValues(config, env);
  assert.deepEqual(values, ["aMuchLongerValueHere123", "shorter8"]);
});

test("collectKnownSecretValues: empty config -> no targets", () => {
  assert.deepEqual(collectKnownSecretValues({}, { X: "anything12345" }), []);
});

// ---------------------------------------------------------------------------
// pure core: redactKnownSecrets
// ---------------------------------------------------------------------------

test("redactKnownSecrets: exact replacement with the single opaque placeholder", () => {
  assert.equal(redactKnownSecrets("key is sk-abcdefgh12345", ["sk-abcdefgh12345"]), `key is ${REDACTED_PLACEHOLDER}`);
});

test("redactKnownSecrets: multiple occurrences all replaced", () => {
  assert.equal(redactKnownSecrets("aaaaaaaa near aaaaaaaa", ["aaaaaaaa"]), `${REDACTED_PLACEHOLDER} near ${REDACTED_PLACEHOLDER}`);
});

test("redactKnownSecrets: nested arrays and objects — structure preserved, only string leaves touched", () => {
  const input = { a: ["x", "topsecret1"], b: { c: "topsecret1", d: 3 } };
  const out = redactKnownSecrets(input, ["topsecret1"]);
  assert.deepEqual(out, { a: ["x", REDACTED_PLACEHOLDER], b: { c: REDACTED_PLACEHOLDER, d: 3 } });
});

test("redactKnownSecrets: numbers, booleans, null preserved unchanged", () => {
  const out = redactKnownSecrets({ n: 5, b: true, z: null, s: "topsecret1" }, ["topsecret1"]);
  assert.deepEqual(out, { n: 5, b: true, z: null, s: REDACTED_PLACEHOLDER });
});

test("redactKnownSecrets: longest-first overlap — no exposed suffix of a longer value", () => {
  const short = "shortsecret";
  const long = "shortsecretLONGERTAIL";
  assert.equal(redactKnownSecrets(long, [long, short]), REDACTED_PLACEHOLDER);
});

test("redactKnownSecrets: defensive re-sort — an UNSORTED (shortest-first) secretValues array still leaves no exposed suffix (adversarial-review finding)", () => {
  const short = "shortsecret";
  const long = "shortsecretLONGERTAIL";
  // Deliberately shortest-first — the opposite of collectKnownSecretValues'
  // documented ordering — to prove redactKnownSecrets does not simply trust
  // caller order. A naive shortest-first walk would redact "shortsecret"
  // first and leave "LONGERTAIL" exposed after the placeholder.
  const out = redactKnownSecrets(long, [short, long]);
  assert.equal(out, REDACTED_PLACEHOLDER);
  assert.equal(out.includes("LONGERTAIL"), false);
});

test("redactKnownSecrets: no targets -> value unchanged (same content)", () => {
  assert.equal(redactKnownSecrets("nothing secret here", []), "nothing secret here");
});

test("redactKnownSecrets: idempotent — a second pass over redacted text is a no-op", () => {
  const once = redactKnownSecrets("value is abcdefgh12345", ["abcdefgh12345"]);
  const twice = redactKnownSecrets(once, ["abcdefgh12345"]);
  assert.equal(once, twice);
  assert.equal(once, `value is ${REDACTED_PLACEHOLDER}`);
});

test("redactKnownSecrets: does not mutate its input (arrays/objects cloned)", () => {
  const input = { data: { msg: "abcdefgh12345" }, list: ["abcdefgh12345"] };
  const snapshot = JSON.parse(JSON.stringify(input));
  redactKnownSecrets(input, ["abcdefgh12345"]);
  assert.deepEqual(input, snapshot);
});

test("redactKnownSecrets: never re-emits a fragment of the secret as part of the output", () => {
  const out = redactKnownSecrets("abcdefgh12345", ["abcdefgh12345"]);
  assert.equal(out.includes("abcdefgh12345"), false);
  assert.equal(out.includes("abcdefgh"), false);
});

test("redactKnownSecrets: an unrelated known-shape string (git SHA / UUID) is left byte-for-byte alone", () => {
  const sha = "a".repeat(40);
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(redactKnownSecrets(sha, ["totallyunrelatedsecretvalue"]), sha);
  assert.equal(redactKnownSecrets(uuid, ["totallyunrelatedsecretvalue"]), uuid);
});

test("MIN_SECRET_LENGTH is 8 (the documented explicit first-slice floor)", () => {
  assert.equal(MIN_SECRET_LENGTH, 8);
});

// ---------------------------------------------------------------------------
// wiring: appendEventRecord (events.js) — the event-trail boundary
// ---------------------------------------------------------------------------

function mkFixtureRoot(faffrcYaml) {
  const root = mkdtempSync(join(tmpdir(), "faff107-"));
  if (faffrcYaml !== null) writeFileSync(join(root, ".faffrc.yaml"), faffrcYaml);
  const runDir = join(root, ".faff", "runs", "RUN-R");
  mkdirSync(runDir, { recursive: true });
  return { root, runDir };
}

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

test("appendEventRecord: redacts a known env-handle secret out of data string leaves; physical line omits it", () => {
  const { root, runDir } = mkFixtureRoot(
    "backends:\n  primary:\n    provider: nvidia\n    model: m\n    host: https://x/v1\n    api_key_env: FAFF107_TEST_KEY\n"
  );
  const SECRET = "aLongEnoughApiKeyValueForTesting123";
  try {
    withCwd(root, () => {
      const env0 = process.env.FAFF107_TEST_KEY;
      process.env.FAFF107_TEST_KEY = SECRET;
      try {
        appendEventRecord(runDir, "RUN-R", { phase: "run", type: "run-start", data: { msg: `key is ${SECRET}` } }, "2026-01-01T00:00:00Z");
      } finally {
        if (env0 === undefined) delete process.env.FAFF107_TEST_KEY; else process.env.FAFF107_TEST_KEY = env0;
      }
    });
    const raw = readFileSync(join(runDir, "events.jsonl"), "utf8");
    assert.equal(raw.includes(SECRET), false, "raw secret must not appear anywhere in the physical line");
    assert.ok(raw.includes(REDACTED_PLACEHOLDER));
    const rec = JSON.parse(raw.trim().split("\n")[0]);
    assert.equal(rec.data.msg, `key is ${REDACTED_PLACEHOLDER}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("appendEventRecord: a known secret colliding with phase/type/issue leaves those structural fields byte-for-byte unchanged", () => {
  // "run-start" is >= 8 chars — a legitimate MIN_SECRET_LENGTH-qualifying value.
  const { root, runDir } = mkFixtureRoot("andon:\n  token: run-start\n");
  try {
    withCwd(root, () => {
      appendEventRecord(runDir, "RUN-R", {
        phase: "run", type: "run-start", issue: "run-start",
        data: { msg: "the phrase run-start appears in free text too" },
      }, "2026-01-01T00:00:00Z");
    });
    const rec = JSON.parse(readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n")[0]);
    assert.equal(rec.phase, "run");
    assert.equal(rec.type, "run-start");
    assert.equal(rec.issue, "run-start");
    // Only the nested data string leaf is eligible for redaction.
    assert.equal(rec.data.msg, `the phrase ${REDACTED_PLACEHOLDER} appears in free text too`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("appendEventRecord: andon.url (direct secret field, not env-indirected) is redacted", () => {
  const ANDON_URL = "https://hooks.example.com/services/T0/B0/aLongEnoughWebhookSecretValue";
  const { root, runDir } = mkFixtureRoot(`andon:\n  url: ${ANDON_URL}\n`);
  try {
    withCwd(root, () => {
      appendEventRecord(runDir, "RUN-R", { phase: "run", type: "run-start", data: { detail: `posting to ${ANDON_URL}` } }, "2026-01-01T00:00:00Z");
    });
    const raw = readFileSync(join(runDir, "events.jsonl"), "utf8");
    assert.equal(raw.includes(ANDON_URL), false);
    assert.ok(raw.includes(REDACTED_PLACEHOLDER));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("appendEventRecord: no .faffrc.yaml at all -> no targets, write proceeds exactly as before (backward compat)", () => {
  const { root, runDir } = mkFixtureRoot(null);
  try {
    withCwd(root, () => {
      appendEventRecord(runDir, "RUN-R", { phase: "run", type: "run-start", data: { msg: "plain text, nothing secret" } }, "2026-01-01T00:00:00Z");
    });
    const rec = JSON.parse(readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n")[0]);
    assert.deepEqual(rec.data, { msg: "plain text, nothing secret" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("appendEventRecord: an absent configured handle contributes no target — no crash, no empty-string replacement", () => {
  const { root, runDir } = mkFixtureRoot("backends:\n  primary:\n    api_key_env: NEVER_SET_IN_THIS_TEST\n");
  try {
    withCwd(root, () => {
      appendEventRecord(runDir, "RUN-R", { phase: "run", type: "run-start", data: { msg: "" } }, "2026-01-01T00:00:00Z");
    });
    const rec = JSON.parse(readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n")[0]);
    assert.equal(rec.data.msg, ""); // no empty-string over-match / destructive replacement
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("appendEventRecord: a malformed base config fails LOUD (never silently caught and suppressed)", () => {
  const { root, runDir } = mkFixtureRoot("- just\n- a\n- sequence\n"); // top-level sequence -> not a mapping -> malformed
  try {
    assert.throws(() => {
      withCwd(root, () => {
        appendEventRecord(runDir, "RUN-R", { phase: "run", type: "run-start", data: { msg: "x" } }, "2026-01-01T00:00:00Z");
      });
    }, /base-parse-error/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// wiring: atomicWriteLedger (heartbeat.js) — the run-ledger boundary
// ---------------------------------------------------------------------------

test("atomicWriteLedger: redacts the ledger before serialize+hash; ledger_sha256 matches the REDACTED bytes; caller object untouched", () => {
  const { root, runDir } = mkFixtureRoot("andon:\n  token: aLongEnoughAndonTokenValueXYZ\n");
  const TOKEN = "aLongEnoughAndonTokenValueXYZ";
  try {
    const callerLedger = { run_id: "RUN-R", owner: { status: "running" }, note: `carrying ${TOKEN} inline` };
    const snapshotBefore = JSON.parse(JSON.stringify(callerLedger));
    const sha = withCwd(root, () => atomicWriteLedger(runDir, callerLedger));

    // The caller-provided object is never mutated.
    assert.deepEqual(callerLedger, snapshotBefore);

    const writtenBytes = readFileSync(join(runDir, "run-ledger.json"));
    const writtenText = writtenBytes.toString("utf8");
    assert.equal(writtenText.includes(TOKEN), false, "raw secret must not appear in the on-disk ledger");
    assert.ok(writtenText.includes(REDACTED_PLACEHOLDER));
    assert.equal(sha, sha256(writtenBytes), "the returned/chained hash must describe the REDACTED bytes actually written");

    const writtenLedger = JSON.parse(writtenText);
    assert.equal(writtenLedger.note, `carrying ${REDACTED_PLACEHOLDER} inline`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("atomicWriteLedger: no configured secrets -> ledger written unchanged (backward compat)", () => {
  const { root, runDir } = mkFixtureRoot(null);
  try {
    const ledger = { run_id: "RUN-R", owner: { status: "running" }, note: "nothing sensitive here" };
    withCwd(root, () => atomicWriteLedger(runDir, ledger));
    const written = JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8"));
    assert.equal(written.note, "nothing sensitive here");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// resolveKnownSecretValues — the impure wrapper
// ---------------------------------------------------------------------------

test("resolveKnownSecretValues: end-to-end config read -> env resolve -> collected values", () => {
  const { root } = mkFixtureRoot("andon:\n  token: aResolvedThroughRootDefaultValue\n");
  try {
    const values = withCwd(root, () => resolveKnownSecretValues());
    assert.ok(values.includes("aResolvedThroughRootDefaultValue"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// selftest surfaces — redact.js's own pure-core selftest is wired into
// `faff events --selftest` (governance modules must carry a runnable selftest).
// ---------------------------------------------------------------------------

test("faff events --selftest passes (includes redact.js's pure-core assertions)", () => {
  const r = runCliRaw(["events", "--selftest"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /events --selftest: ok/);
});
