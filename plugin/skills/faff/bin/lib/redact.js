// === region:governance — redact — FAFF-107: exact known-secret redaction at code-owned durable-write boundaries ===
//
// A single shared, pure primitive that replaces exact occurrences of secret
// values SuperDomestique already tracks with a fixed placeholder, wired into
// the CLI's two code-owned durable-write cores — `appendEventRecord`
// (events.js, nested `data` string leaves only) and `atomicWriteLedger`
// (heartbeat.js, before serialization + hashing). By-construction: every
// caller of those two cores inherits redaction; none can forget it.
//
// Deliberately narrow (records/specs/2026-08-12-faff-107-…-design.md §2):
// exact known values only, no token-shape regexes, no PII, no generic
// high-entropy scan, no config toggle, no `faff redact` filter verb. A value
// not reachable through the two allowlisted sources below passes through
// unchanged — an honest scope limit, not a bug.
//
// Known secret value = either:
//   1. a configured secret ENV HANDLE — a config field literally named
//      `api_key_env` or `seat_token_env` anywhere in the resolved config tree
//      (e.g. under each `backends.<name>.*`); its scalar value is an
//      environment-variable NAME, resolved through the live environment.
//   2. a configuration field whose schema explicitly stores a secret VALUE
//      directly — `andon.url` / `andon.token`.
// Only values of length >= 8 become targets (MIN_SECRET_LENGTH below).
//
// Governance region (ADR-0042): this module must never require a factory
// file. Config resolution reuses budget.js's `readGovernanceConfig` — the
// existing governance-safe, base-file-only, fail-loud reader (never
// config.js's factory `loadConfig`) — rather than opening a second config
// path. A malformed base config THROWS (readGovernanceConfig's own fail-loud
// contract, FAFF_CONFIG_BASE_LENIENT escape hatch included); redaction must
// not catch and silently degrade that failure into "no secrets collected".
// ===========================================================================

"use strict";

const { dig, findRoot } = require("./shared-infra");
const { readGovernanceConfig } = require("./budget");

// Explicit first-slice limitation (spec §3): a shorter real secret is not
// redacted, to avoid destructive empty/short-string replacement.
const MIN_SECRET_LENGTH = 8;
const REDACTED_PLACEHOLDER = "[REDACTED]";

// The collector is allowlisted to exactly these two handle-field NAMES —
// never every `*_env` key, never every `*_TOKEN`/`*_KEY`-shaped env var name.
const SECRET_ENV_HANDLE_KEYS = new Set(["api_key_env", "seat_token_env"]);

// Direct secret-bearing config fields (dotted paths) — the value itself is
// the known secret, no env-var indirection.
const DIRECT_SECRET_FIELD_PATHS = ["andon.url", "andon.token"];

// collectKnownSecretValues(config, env) -> String[]
//   Read allowlisted handles (recursively, by exact key NAME — never a *_env
//   pattern) and direct secret fields (fixed dotted paths). Resolve handles
//   through env. Drop absent, non-string, and length < MIN_SECRET_LENGTH
//   values. Deduplicate. Sort by descending length, then lexical value, for
//   deterministic longest-first overlap handling. Pure — no I/O.
function collectKnownSecretValues(config, env) {
  const values = new Set();
  const handleNames = new Set();
  (function walk(node) {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    for (const [key, val] of Object.entries(node)) {
      if (SECRET_ENV_HANDLE_KEYS.has(key) && typeof val === "string" && val !== "") {
        handleNames.add(val);
      } else {
        walk(val);
      }
    }
  })(config);
  for (const name of handleNames) {
    const v = env ? env[name] : undefined;
    if (typeof v === "string" && v.length >= MIN_SECRET_LENGTH) values.add(v);
  }
  for (const path of DIRECT_SECRET_FIELD_PATHS) {
    const v = dig(config, path);
    if (typeof v === "string" && v.length >= MIN_SECRET_LENGTH) values.add(v);
  }
  return [...values].sort((a, b) => (b.length - a.length) || (a < b ? -1 : a > b ? 1 : 0));
}

// redactKnownSecrets(value, secretValues) -> JSONValue
//   Recursively CLONES arrays and plain objects — never mutates `value`. For
//   every string leaf, replaces every exact occurrence of every target
//   (longest-first, per collectKnownSecretValues's own ordering) with
//   "[REDACTED]". Numbers, booleans, and null pass through unchanged. Pure,
//   deterministic, idempotent — a string already containing only placeholders
//   is unchanged on a second pass (no target value remains to match).
function redactKnownSecrets(value, secretValues) {
  if (typeof value === "string") {
    let out = value;
    for (const s of secretValues) {
      if (s && out.includes(s)) out = out.split(s).join(REDACTED_PLACEHOLDER);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactKnownSecrets(v, secretValues));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = redactKnownSecrets(value[k], secretValues);
    return out;
  }
  return value; // number, boolean, null, undefined
}

// resolveKnownSecretValues(root, env) -> String[]
//   The impure wrapper the write cores actually call: resolves the base
//   config via budget.js's governance-safe reader (fail-loud on malformed
//   config — never caught here), then collects known secret values from it.
//   `root` defaults to findRoot() (cwd-resolved) so call sites deep inside
//   the write cores (which see a run dir, not a repo root) need no extra
//   plumbing. Absent config ⇒ {} ⇒ no targets (not an error — a repo with no
//   `.faffrc.yaml` writes exactly as it does today).
function resolveKnownSecretValues(root = findRoot(), env = process.env) {
  const config = readGovernanceConfig(root);
  return collectKnownSecretValues(config, env);
}

// In-memory selftest of the pure cores — mirrors the sibling governance
// modules' `--selftest` shape (budget/heartbeat/events), invoked from
// eventsSelftest()/heartbeatSelftest() rather than standing up its own CLI
// verb (this module has none — no `faff redact` filter, spec §2).
function redactSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } };

  // --- collectKnownSecretValues ---
  const cfg1 = { backends: { a: { api_key_env: "A_KEY" }, b: { api_key_env: "B_KEY" } }, andon: { url: "https://hooks.example.com/T000/B000/longenoughtoken", token: "short12" } };
  const env1 = { A_KEY: "aaaaaaaaaaaaaaaa", B_KEY: "short" }; // B_KEY resolves to a 5-char value, below the floor
  const c1 = collectKnownSecretValues(cfg1, env1);
  ok("collect: resolves api_key_env handles through env, drops < 8 chars", c1.includes("aaaaaaaaaaaaaaaa") && !c1.includes("short"));
  ok("collect: andon.url >= 8 chars included, andon.token < 8 chars (7) dropped", c1.includes("https://hooks.example.com/T000/B000/longenoughtoken") && !c1.includes("short12"));
  ok("collect: sorted longest-first", c1[0].length >= c1[c1.length - 1].length);

  const c2 = collectKnownSecretValues({ backends: { a: { api_key_env: "MISSING_KEY" } } }, {});
  ok("collect: absent env handle contributes no target, no crash", c2.length === 0);

  const c3 = collectKnownSecretValues({ backends: { a: { seat_token_env: "SEAT" } } }, { SEAT: "seatvaluelongenough" });
  ok("collect: seat_token_env handle resolved same as api_key_env", c3.includes("seatvaluelongenough"));

  const c4 = collectKnownSecretValues({ some_other_env: "NOT_A_HANDLE", andon: {} }, { NOT_A_HANDLE: "shouldnotcollectXX" });
  ok("collect: only allowlisted handle field NAMES are read (no generic *_env sweep)", c4.length === 0);

  const c5 = collectKnownSecretValues({}, { X: "y" });
  ok("collect: empty config -> no targets", c5.length === 0);

  const dupCfg = { backends: { a: { api_key_env: "DUP" }, b: { api_key_env: "DUP2" } } };
  const c6 = collectKnownSecretValues(dupCfg, { DUP: "sameeightchar", DUP2: "sameeightchar" });
  ok("collect: duplicate resolved values deduplicated", c6.length === 1 && c6[0] === "sameeightchar");

  // --- redactKnownSecrets ---
  ok("redact: exact replacement", redactKnownSecrets("key is sk-abcdefgh", ["sk-abcdefgh"]) === "key is [REDACTED]");
  ok("redact: multiple occurrences", redactKnownSecrets("aaaaaaaa and aaaaaaaa", ["aaaaaaaa"]) === "[REDACTED] and [REDACTED]");
  ok("redact: nested arrays/objects", JSON.stringify(redactKnownSecrets({ a: ["x", "secretvalue"], b: { c: "secretvalue" } }, ["secretvalue"]))
    === JSON.stringify({ a: ["x", "[REDACTED]"], b: { c: "[REDACTED]" } }));
  ok("redact: non-string leaves preserved", (() => {
    const r = redactKnownSecrets({ n: 5, b: true, z: null }, ["secretvalue"]);
    return r.n === 5 && r.b === true && r.z === null;
  })());
  const overlapA = "shortsecret", overlapB = "shortsecretLONGER";
  ok("redact: longest-first overlap handling leaves no exposed suffix", redactKnownSecrets(overlapB, [overlapB, overlapA]) === "[REDACTED]");
  ok("redact: absent handle / no targets -> unchanged", redactKnownSecrets("nothing secret here", []) === "nothing secret here");
  ok("redact: idempotent — a second pass over already-redacted text is a no-op", (() => {
    const once = redactKnownSecrets("value is abcdefgh12345", ["abcdefgh12345"]);
    const twice = redactKnownSecrets(once, ["abcdefgh12345"]);
    return once === twice && once === "value is [REDACTED]";
  })());
  ok("redact: input non-mutation", (() => {
    const input = { data: { msg: "abcdefgh12345" } };
    const clone = JSON.parse(JSON.stringify(input));
    redactKnownSecrets(input, ["abcdefgh12345"]);
    return JSON.stringify(input) === JSON.stringify(clone);
  })());
  ok("redact: never emits the raw value inside the placeholder itself", !redactKnownSecrets("abcdefgh12345", ["abcdefgh12345"]).includes("abcdefgh12345"));

  console.log(fail === 0 ? "redact --selftest: ok" : `redact --selftest: ${fail} FAILED`);
  return fail === 0 ? 0 : 1;
}

module.exports = {
  MIN_SECRET_LENGTH, REDACTED_PLACEHOLDER, SECRET_ENV_HANDLE_KEYS, DIRECT_SECRET_FIELD_PATHS,
  collectKnownSecretValues, redactKnownSecrets, resolveKnownSecretValues, redactSelftest,
};
