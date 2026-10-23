// FAFF-1213 — give the runner a GitHub identity separate from the human's (faff-side slice).
// Pure-core + wiring coverage for the single `gh` env chokepoint, the identity evidence record,
// the anchored round-trip, the comparison hook, and the token-leakage controls. The live `gh`
// path is the spec's integration smoke test, not here (parity with merge-gate's pure-only tests).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readRunnerGhConfig, resolveRunnerGhEnv, resolveRunnerIdentity, githubActorMatches, writeMergeRecord, mergeRecordPath,
} from "../plugin/skills/faff/bin/lib/merge-gate.js";
import { appendEventRecord, emitGenesisRunStart, mintIssueAnchor, eventViolations } from "../plugin/skills/faff/bin/lib/events.js";
import { resolveKnownSecretValues } from "../plugin/skills/faff/bin/lib/redact.js";
import { readMergeGateSources } from "./helpers/merge-gate-modules.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "..", "plugin", "skills", "faff", "bin", "lib");

// --- resolveRunnerGhEnv: PURE over its inputs -------------------------------

test("resolveRunnerGhEnv: zero-config is byte-identical — env returned by reference, no GH_TOKEN added", () => {
  const env = { PATH: "/x", HOME: "/h" };
  const r = resolveRunnerGhEnv({ tokenEnvName: null, configuredLogin: null, configFault: false }, env);
  assert.equal(r.env, env, "ambient returns the SAME env reference (no copy, no reorder)");
  assert.equal(r.redactedEnv, env);
  assert.equal(r.identitySource, "ambient");
  assert.equal(r.credentialUnresolved, false);
  assert.equal(r.configFault, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(r.env, "GH_TOKEN"), "faff never adds GH_TOKEN zero-config");
});

test("resolveRunnerGhEnv: a configured, resolvable credential injects GH_TOKEN and masks it in redactedEnv", () => {
  const env = { PATH: "/x", RUNNER_TOK: "tok-abc123value" };
  const r = resolveRunnerGhEnv({ tokenEnvName: "RUNNER_TOK", configuredLogin: null, configFault: false }, env);
  assert.equal(r.identitySource, "runner-credential");
  assert.equal(r.env.GH_TOKEN, "tok-abc123value", "GH_TOKEN equals the named var's fresh value");
  assert.equal(r.redactedEnv.GH_TOKEN, "***REDACTED***", "redactedEnv masks the token for logging");
  assert.notEqual(r.env, env, "runner-credential builds a NEW env (never mutates the input)");
  assert.ok(!Object.prototype.hasOwnProperty.call(env, "GH_TOKEN"), "the input env is left untouched");
});

test("resolveRunnerGhEnv: named-but-empty credential → credentialUnresolved, ambient, GH_TOKEN untouched (no silent fallback)", () => {
  const env = { PATH: "/x", RUNNER_TOK: "" };
  const r = resolveRunnerGhEnv({ tokenEnvName: "RUNNER_TOK", configuredLogin: null, configFault: false }, env);
  assert.equal(r.identitySource, "ambient");
  assert.equal(r.credentialUnresolved, true);
  assert.equal(r.tokenEnvName, "RUNNER_TOK");
  assert.equal(r.env, env);
  assert.ok(!Object.prototype.hasOwnProperty.call(r.env, "GH_TOKEN"));
});

test("resolveRunnerGhEnv: a config fault forces ambient with tokenEnvName null and credentialUnresolved false", () => {
  const env = { PATH: "/x" };
  const r = resolveRunnerGhEnv({ tokenEnvName: null, configuredLogin: null, configFault: true }, env);
  assert.equal(r.identitySource, "ambient");
  assert.equal(r.configFault, true);
  assert.equal(r.tokenEnvName, null);
  assert.equal(r.credentialUnresolved, false, "a config fault is an environment problem, not a separation signal");
  assert.equal(r.env, env);
});

// --- resolveRunnerIdentity: evidence record ---------------------------------

test("resolveRunnerIdentity: authed probe → gh-api-user login, verified true", () => {
  const cfg = { tokenEnvName: "RUNNER_TOK", configuredLogin: "octocat", configFault: false };
  const resolved = { identitySource: "runner-credential", credentialUnresolved: false };
  const ev = resolveRunnerIdentity(cfg, resolved, { status: "authed", login: "octocat", basis: "gh api user ok" });
  assert.deepEqual(ev, { github_login: "octocat", github_login_source: "gh-api-user", credential_source: "runner-credential", credential_unresolved: false, verified: true });
});

test("resolveRunnerIdentity: App-token 403 (probe not authed) + configured login → configured, verified false", () => {
  const cfg = { tokenEnvName: "RUNNER_TOK", configuredLogin: "my-app[bot]", configFault: false };
  const resolved = { identitySource: "runner-credential", credentialUnresolved: false };
  const ev = resolveRunnerIdentity(cfg, resolved, { status: "auth-failed", login: null, basis: "gh api user rejected credential: HTTP 403" });
  assert.deepEqual(ev, { github_login: "my-app[bot]", github_login_source: "configured", credential_source: "runner-credential", credential_unresolved: false, verified: false });
});

test("resolveRunnerIdentity: runner credential, no configured login and probe not authed → unresolved", () => {
  const cfg = { tokenEnvName: "RUNNER_TOK", configuredLogin: null, configFault: false };
  const resolved = { identitySource: "runner-credential", credentialUnresolved: false };
  const ev = resolveRunnerIdentity(cfg, resolved, { status: "indeterminate", login: null, basis: "gh unavailable" });
  assert.equal(ev.github_login, null);
  assert.equal(ev.github_login_source, "unresolved");
  assert.equal(ev.verified, false);
});

test("resolveRunnerIdentity: ambient (zero-config) → ambient source, no probe, configured login or null", () => {
  const ev1 = resolveRunnerIdentity({ configuredLogin: "octocat" }, { identitySource: "ambient", credentialUnresolved: false });
  assert.deepEqual(ev1, { github_login: "octocat", github_login_source: "configured", credential_source: "ambient", credential_unresolved: false, verified: false });
  const ev2 = resolveRunnerIdentity({ configuredLogin: null }, { identitySource: "ambient", credentialUnresolved: true });
  assert.deepEqual(ev2, { github_login: null, github_login_source: "unresolved", credential_source: "ambient", credential_unresolved: true, verified: false });
});

// --- githubActorMatches: the FAFF-1182 comparison hook ----------------------

test("githubActorMatches: normalises a trailing [bot] on either side", () => {
  assert.equal(githubActorMatches("my-app[bot]", "my-app"), true);
  assert.equal(githubActorMatches("my-app", "my-app[bot]"), true);
  assert.equal(githubActorMatches("my-app[bot]", "my-app[bot]"), true);
  assert.equal(githubActorMatches("octocat", "octocat"), true);
  assert.equal(githubActorMatches("octocat", "someone-else"), false);
  assert.equal(githubActorMatches(null, "octocat"), false);
  assert.equal(githubActorMatches("octocat", null), false);
});

// --- eventViolations: the runner-identity payload validator -----------------

const ENV = (type, data) => ({ schema: 2, run_id: "r", seq: 1, ts: "t", prev: "a".repeat(64), phase: "run", type, data });

test("eventViolations: a well-formed runner-identity record is accepted (github_login string OR null)", () => {
  assert.equal(eventViolations(ENV("runner-identity", { github_login: "octocat", github_login_source: "gh-api-user", credential_source: "runner-credential", credential_unresolved: false, verified: true }), true).length, 0);
  assert.equal(eventViolations(ENV("runner-identity", { github_login: null, github_login_source: "unresolved", credential_source: "ambient", credential_unresolved: false, verified: false }), true).length, 0);
});

test("eventViolations: a malformed runner-identity record is rejected (bad enum, non-boolean, extra field)", () => {
  assert.ok(eventViolations(ENV("runner-identity", { github_login: "x", github_login_source: "gh-api-user", credential_source: "human", credential_unresolved: false, verified: true }), true).length > 0, "bad credential_source");
  assert.ok(eventViolations(ENV("runner-identity", { github_login: "x", github_login_source: "nope", credential_source: "ambient", credential_unresolved: false, verified: true }), true).length > 0, "bad github_login_source");
  assert.ok(eventViolations(ENV("runner-identity", { github_login: "x", github_login_source: "configured", credential_source: "ambient", credential_unresolved: false, verified: "yes" }), true).length > 0, "non-boolean verified");
  assert.ok(eventViolations(ENV("runner-identity", { github_login: "x", github_login_source: "configured", credential_source: "ambient", credential_unresolved: false, verified: true, token: "leak" }), true).length > 0, "unexpected top-level data field");
});

// --- the anchored round-trip: evidence reaches the committed, head-sha-pinned anchor ---

test("runner-identity reaches the committed anchor: present in anchored events.jsonl + chain-head matches the last line", () => {
  const runDir = mkdtempSync(join(tmpdir(), "faff1213-anchor-"));
  const destDir = mkdtempSync(join(tmpdir(), "faff1213-dest-"));
  try {
    emitGenesisRunStart(runDir); // seq 0 genesis run-start (prev = SHA-256(run_id)) — untouched
    const evidence = { github_login: "octocat", github_login_source: "gh-api-user", credential_source: "runner-credential", credential_unresolved: false, verified: true };
    appendEventRecord(runDir, "irrelevant-run-id-arg-is-overridden-by-basename", { phase: "run", type: "runner-identity", data: evidence });
    const mint = mintIssueAnchor(runDir, "FAFF-1213", destDir);
    assert.ok(mint.ok, `mintIssueAnchor failed: ${JSON.stringify(mint)}`);

    const anchored = readFileSync(join(destDir, "events.jsonl"), "utf8");
    const lines = anchored.split("\n").filter((l) => l.length > 0);
    const records = lines.map((l) => JSON.parse(l));
    const ri = records.find((r) => r.type === "runner-identity");
    assert.ok(ri, "runner-identity record present in the ANCHORED events.jsonl");
    assert.deepEqual(ri.data, evidence);
    assert.ok(records.some((r) => r.type === "run-start" && r.seq === 0), "genesis run-start untouched");

    const chainHead = JSON.parse(readFileSync(join(destDir, "chain-head.json"), "utf8"));
    const lastLineSha = createHash("sha256").update(Buffer.from(lines[lines.length - 1], "utf8")).digest("hex");
    assert.equal(chainHead.head_sha256, lastLineSha, "chain-head.json head_sha256 pins the anchored log's last line");
    assert.equal(lines[lines.length - 1], JSON.stringify(ri), "the runner-identity record is the head the witness pins");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(destDir, { recursive: true, force: true });
  }
});

// --- token-leakage controls: the token never reaches a durable write --------

function mkFixtureRoot(faffrcYaml) {
  const root = mkdtempSync(join(tmpdir(), "faff1213-redact-"));
  writeFileSync(join(root, ".faffrc.yaml"), faffrcYaml);
  return root;
}

test("redaction: runner_github_token_env is a known-secret handle → its value is collected for the redactor", () => {
  const root = mkFixtureRoot("autonomous:\n  runner_github_token_env: FAFF_TEST_GH_TOKEN\n");
  try {
    const vals = resolveKnownSecretValues(root, { FAFF_TEST_GH_TOKEN: "RUNTOKEN-abcdef1234567890" });
    assert.ok(vals.includes("RUNTOKEN-abcdef1234567890"), "the token value is in the known-secret set (so the ledger/events/merge-record redactors scrub it)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("redaction: token absent from events.jsonl and merge-record.json after a configured-credential run", () => {
  const TOKEN = "RUNTOKEN-abcdef1234567890";
  const root = mkFixtureRoot("autonomous:\n  runner_github_token_env: FAFF_TEST_GH_TOKEN\n");
  const prevCwd = process.cwd();
  const prevTok = process.env.FAFF_TEST_GH_TOKEN;
  try {
    process.env.FAFF_TEST_GH_TOKEN = TOKEN;
    process.chdir(root);

    // events.jsonl — appendEventRecord scrubs data through the known-secret walk. Even if a token
    // leaked into a data field, it must not survive the write.
    emitGenesisRunStart(root);
    appendEventRecord(root, "ignored", { phase: "run", type: "runner-identity", data: { github_login: TOKEN, github_login_source: "gh-api-user", credential_source: "runner-credential", credential_unresolved: false, verified: true } });
    const events = readFileSync(join(root, "events.jsonl"), "utf8");
    assert.ok(!events.includes(TOKEN), "token value absent from events.jsonl");

    // merge-record.json — writeMergeRecord routes the whole record through redactKnownSecrets.
    // Inject the token into a field (simulating a future token-bearing field) to prove the routing
    // scrubs it even past the {login,source}-only construction guarantee.
    writeMergeRecord(root, "FAFF-1213", 5, "deadbeef", "asserted", { harness: "codex", model: TOKEN }, { login: "octocat", source: "runner-credential" });
    const mr = readFileSync(mergeRecordPath(root, "FAFF-1213"), "utf8");
    assert.ok(!mr.includes(TOKEN), "token value absent from merge-record.json");
    const rec = JSON.parse(mr);
    assert.deepEqual(rec.github_actor, { login: "octocat", source: "runner-credential" }, "github_actor records login+source, never the token");
  } finally {
    process.chdir(prevCwd);
    if (prevTok === undefined) delete process.env.FAFF_TEST_GH_TOKEN; else process.env.FAFF_TEST_GH_TOKEN = prevTok;
    rmSync(root, { recursive: true, force: true });
  }
});

// --- the one-chokepoint conformance grep ------------------------------------

test("conformance: no bare spawnSync(\"gh\" remains outside runGh across the 9-site surface; ghJson delegates to runGh", () => {
  // FAFF-1391: merge-gate.js is a facade; the count runs over every merge-gate module, and runGh
  // and ghJson live in merge-gate-gh.js.
  const sources = readMergeGateSources(LIB);
  const mg = sources["merge-gate-gh.js"];
  // Every bare `gh` spawn in the emit is now inside runGh (the single chokepoint). The ONLY
  // literal spawnSync("gh" left is runGh's own body.
  const bareGh = (s) => (s.match(/spawnSync\(\s*["']gh["']/g) || []).length;
  assert.equal(Object.values(sources).reduce((n, s) => n + bareGh(s), 0), 1, "merge-gate modules: exactly one spawnSync(\"gh\" — inside runGh");
  const runGhBody = mg.slice(mg.indexOf("function runGh("), mg.indexOf("function githubActorMatches("));
  assert.ok(/spawnSync\(\s*"gh"/.test(runGhBody), "the sole spawnSync(\"gh\" lives inside runGh");
  for (const f of ["forge-merge.js", "review-target.js", "prdr.js"]) {
    assert.equal(bareGh(readFileSync(join(LIB, f), "utf8")), 0, `${f}: no bare spawnSync(\"gh\" — routed through runGh`);
  }
  // ghJson delegates to runGh.
  const ghJsonBody = mg.slice(mg.indexOf("function ghJson("), mg.indexOf("function ghRepoSlug("));
  assert.ok(/runGh\(/.test(ghJsonBody), "ghJson delegates to runGh");
});

// readRunnerGhConfig is memoised once per process — a smoke check it returns a stable shape.
test("readRunnerGhConfig: returns the fault-tolerant shape and memoises (stable reference)", () => {
  const a = readRunnerGhConfig();
  const b = readRunnerGhConfig();
  assert.equal(a, b, "memoised: same reference across calls");
  assert.ok("tokenEnvName" in a && "configuredLogin" in a && "configFault" in a);
});

// readRunnerGhConfig actually reads a REAL .faffrc (not just the hand-built-config path). Run in a
// fresh subprocess so the per-process memo is clean and cwd is the fixture root. This is the
// regression guard for the loadConfig()-needs-a-root bug: a no-arg loadConfig() always threw, which
// would have silently forced configFault (zero-config) forever, so a configured credential would
// never be read.
const MG_PATH = join(LIB, "merge-gate.js");
function readConfigInDir(dir, extraEnv = {}) {
  const out = execFileSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(MG_PATH)}).readRunnerGhConfig()))`], { cwd: dir, encoding: "utf8", env: { ...process.env, NODE_EXTRA_CA_CERTS: "", ...extraEnv } });
  return JSON.parse(out);
}

test("readRunnerGhConfig: reads a configured runner credential from a real .faffrc (configFault false)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff1213-cfg-"));
  try {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".faffrc.yaml"), "autonomous:\n  runner_github_token_env: RUNNER_GH_TOKEN\n  runner_github_login: my-runner-bot\n");
    const cfg = readConfigInDir(root);
    assert.deepEqual(cfg, { tokenEnvName: "RUNNER_GH_TOKEN", configuredLogin: "my-runner-bot", configFault: false });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("readRunnerGhConfig: a repo with no runner keys reads clean (zero-config, no spurious configFault)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff1213-cfg0-"));
  try {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".faffrc.yaml"), "appetite: high\n");
    const cfg = readConfigInDir(root);
    assert.deepEqual(cfg, { tokenEnvName: null, configuredLogin: null, configFault: false });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
