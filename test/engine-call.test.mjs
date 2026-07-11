// FAFF-422 — local-engine lane values v1: the engine:<name> config seam + `faff engine call`.
// Covers: read-time allowlist + engine-ref validation (config get), the dispatch-time
// allowlist/effort/anthropic guards (engine call exit 2 table — all config-fault paths,
// no network), the auth-failed unset-key exit BEFORE any transport, and the injected-
// transport one-shot orchestration (pure fns imported directly — CI makes zero real
// network calls). The byte-for-byte Anthropic-path criterion is covered by the untouched
// existing lanes: an Agent-token value resolves exactly as before (config-defaults tests).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli, repoRoot } from "./helpers/run-cli.mjs";
import engine from "../plugin/skills/faff/bin/lib/engine.js";
import config from "../plugin/skills/faff/bin/lib/config.js";

const { buildEngineRequest, parseEngineResponse, preflightEngine, runEngineCall, ENGINE_EXIT } = engine;
const { resolveEngineForLane, validateEngineRef, ENGINE_CALL_LANES } = config;

function fixtureDir(faffrcBody) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff422-"));
  if (faffrcBody !== undefined) writeFileSync(path.join(dir, ".faffrc.yaml"), faffrcBody);
  return dir;
}

const ENGINES_BLOCK = "engines:\n  studio:\n    provider: ollama\n    model: qwen3-next:80b\n    host: http://studio.test:11434\n";

// --- read-time validation (config get) ---

test("engines: map parses; config get engines.<name>.<field> resolves", () => {
  const dir = fixtureDir(ENGINES_BLOCK);
  try {
    const r = runCli(["config", "get", "engines.studio.model"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "qwen3-next:80b");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("allowlisted lanes accept engine:<name> at read; the reference resolves", () => {
  const dir = fixtureDir(ENGINES_BLOCK + "models:\n  methodology: engine:studio\n  intake: engine:studio\n");
  try {
    for (const key of ["models.methodology", "models.intake"]) {
      const r = runCli(["config", "get", key], { cwd: dir });
      assert.equal(r.code, 0, `${key}: ${r.stderr}`);
      assert.equal(r.stdout.trim(), "engine:studio");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("every other models.* lane rejects an engine value at read, naming the allowlist", () => {
  for (const lane of ["build", "prep_explore", "spec", "spec_review", "architecture", "eval"]) {
    const dir = fixtureDir(ENGINES_BLOCK + `models:\n  ${lane}: engine:studio\n`);
    try {
      const r = runCli(["config", "get", `models.${lane}`], { cwd: dir });
      assert.equal(r.code, 2, `models.${lane} must fail loud`);
      assert.match(r.stderr, /models\.methodology \| models\.intake/, `models.${lane} error names the allowlist`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test("unknown engine name fails at read, listing the configured engine names", () => {
  const dir = fixtureDir(ENGINES_BLOCK + "models:\n  intake: engine:nope\n");
  try {
    const r = runCli(["config", "get", "models.intake"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown engine "nope"/);
    assert.match(r.stderr, /studio/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("missing required engine field fails at read, naming the field", () => {
  const dir = fixtureDir("engines:\n  s:\n    provider: ollama\n    model: m\nmodels:\n  intake: engine:s\n");
  try {
    const r = runCli(["config", "get", "models.intake"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /"host"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("provider: anthropic inside an engines: entry is refused at read", () => {
  const dir = fixtureDir("engines:\n  a:\n    provider: anthropic\n    model: m\n    host: https://api.anthropic.com\nmodels:\n  methodology: engine:a\n");
  try {
    const r = runCli(["config", "get", "models.methodology"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /anthropic.*refused|refused.*anthropic/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a non-default engine value echoes in config resolved (visible, never silent)", () => {
  const dir = fixtureDir(ENGINES_BLOCK + "models:\n  intake: engine:studio\n");
  try {
    const r = runCli(["config", "resolved"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /model intake: engine:studio/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an Anthropic-token lane value still resolves exactly as before (byte-for-byte)", () => {
  const dir = fixtureDir(ENGINES_BLOCK + "models:\n  intake: sonnet\n");
  try {
    const r = runCli(["config", "get", "models.intake"], { cwd: dir });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), "sonnet");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- dispatch-time guards (`faff engine call` — config-fault table, no network) ---

test("engine call: non-allowlisted --lane is refused at dispatch, independent of config", () => {
  const dir = fixtureDir(ENGINES_BLOCK + "models:\n  methodology: engine:studio\n");
  try {
    const r = runCli(["engine", "call", "--lane", "build", "--system", "/dev/null", "--user", "/dev/null"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not engine-dispatchable/);
    assert.match(r.stderr, /methodology \| intake/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("engine call: an Anthropic-token lane is refused (engine call serves only engine values)", () => {
  const dir = fixtureDir("models:\n  intake: sonnet\n");
  try {
    const r = runCli(["engine", "call", "--lane", "intake", "--system", "/dev/null", "--user", "/dev/null"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not an engine:<name> value/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("engine call: non-inherit effort.<lane> on an engine-valued lane is refused, named", () => {
  const dir = fixtureDir(ENGINES_BLOCK + "models:\n  methodology: engine:studio\neffort:\n  methodology: high\n");
  try {
    const r = runCli(["engine", "call", "--lane", "methodology", "--system", "/dev/null", "--user", "/dev/null"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /effort\.methodology/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("engine call: declared api_key_env unset → auth-failed exit 6 BEFORE any network call", () => {
  const dir = fixtureDir("engines:\n  s:\n    provider: nvidia\n    model: m\n    host: https://x.test/v1\n    api_key_env: FAFF422_TEST_UNSET_KEY\nmodels:\n  intake: engine:s\n");
  try {
    const env = { ...process.env };
    delete env.FAFF422_TEST_UNSET_KEY;
    const r = runCli(["engine", "call", "--lane", "intake", "--system", "/dev/null", "--user", "/dev/null"], { cwd: dir, env });
    assert.equal(r.code, ENGINE_EXIT.AUTH);
    assert.match(r.stderr, /auth-failed/);
    assert.match(r.stderr, /FAFF422_TEST_UNSET_KEY/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("engine call: usage without required flags exits 2", () => {
  const r = runCli(["engine", "call", "--lane", "intake"], { cwd: repoRoot });
  assert.equal(r.code, 2);
});

test("engine --selftest passes (request/parse/preflight/orchestration table, no network)", () => {
  const r = runCli(["engine", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

// --- pure resolution seam (direct import) ---

test("v1 allowlist is exactly the pure-data-in producers", () => {
  assert.deepEqual([...ENGINE_CALL_LANES].sort(), ["intake", "methodology"]);
});

test("validateEngineRef: unknown provider fails naming the legal set", () => {
  const err = validateEngineRef({ engines: { s: { provider: "llamacpp", model: "m", host: "h" } } }, "engine:s");
  assert.match(err, /unknown provider/);
  assert.match(err, /ollama/);
});

test("resolveEngineForLane: happy path resolves family, options, defaults", () => {
  const r = resolveEngineForLane({
    engines: { s: { provider: "vllm", model: "m", host: "https://x/v1", reasoning_off: true, timeout: 30 } },
    models: { intake: "engine:s" },
  }, "intake");
  assert.equal(r.error, undefined);
  assert.equal(r.family, "openai");
  assert.equal(r.reasoningOff, true);
  assert.equal(r.timeoutMs, 30000);
  assert.equal(r.apiKeyEnv, null);
});

// --- one-shot transport (injected — zero real network calls) ---

test("runEngineCall: happy path is exactly ONE non-streaming completion", async () => {
  const eng = { name: "s", provider: "ollama", family: "ollama", model: "m1", host: "http://h:1", reasoningOff: false, timeoutMs: 1000 };
  let posts = 0;
  let sawStreamFalse = false;
  const r = await runEngineCall({
    engine: eng, system: "SYS", user: "USR",
    getFn: async () => JSON.stringify({ models: [{ name: "m1" }] }),
    postFn: async (req) => {
      posts++;
      sawStreamFalse = JSON.parse(req.body).stream === false;
      return JSON.stringify({ message: { content: "answer" } });
    },
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "answer");
  assert.equal(posts, 1);
  assert.equal(sawStreamFalse, true);
});

test("runEngineCall: unreachable probe → engine-unreachable; completion never attempted", async () => {
  const eng = { name: "s", provider: "ollama", family: "ollama", model: "m1", host: "http://h:1", reasoningOff: false, timeoutMs: 1000 };
  let posts = 0;
  const r = await runEngineCall({
    engine: eng, system: "S", user: "U",
    getFn: async () => { throw new Error("ECONNREFUSED"); },
    postFn: async () => { posts++; return ""; },
  });
  assert.equal(r.status, "engine-unreachable");
  assert.equal(posts, 0);
});

test("runEngineCall: model absent from the probe → model-not-served with the served list", async () => {
  const eng = { name: "s", provider: "openai", family: "openai", model: "m1", host: "https://x/v1", reasoningOff: false, timeoutMs: 1000 };
  const r = await runEngineCall({
    engine: eng, system: "S", user: "U",
    getFn: async () => JSON.stringify({ data: [{ id: "other" }] }),
    postFn: async () => "",
  });
  assert.equal(r.status, "model-not-served");
  assert.deepEqual(r.names, ["other"]);
});

test("runEngineCall: missing content field → malformed-response (fail-loud parse, no retry)", async () => {
  const eng = { name: "s", provider: "ollama", family: "ollama", model: "m1", host: "http://h:1", reasoningOff: false, timeoutMs: 1000 };
  let posts = 0;
  const r = await runEngineCall({
    engine: eng, system: "S", user: "U",
    getFn: async () => JSON.stringify({ models: [{ name: "m1" }] }),
    postFn: async () => { posts++; return JSON.stringify({ done: true }); },
  });
  assert.equal(r.status, "malformed-response");
  assert.equal(posts, 1);
});

test("buildEngineRequest: openai join preserves /v1; Bearer only with a key", () => {
  const withKey = buildEngineRequest({ family: "openai", host: "https://x/v1", model: "m", system: "s", user: "u", apiKey: "k" });
  assert.equal(withKey.url, "https://x/v1/chat/completions");
  assert.equal(withKey.headers.authorization, "Bearer k");
  const noKey = buildEngineRequest({ family: "openai", host: "https://x/v1", model: "m", system: "s", user: "u" });
  assert.equal("authorization" in noKey.headers, false);
});

test("parseEngineResponse: fail-loud on both families' unknown shapes", () => {
  assert.throws(() => parseEngineResponse("ollama", JSON.stringify({})), /message\.content/);
  assert.throws(() => parseEngineResponse("openai", "no json"), /not JSON/);
});

test("preflightEngine: openai 401 on the probe classifies as auth-failed, not unreachable", async () => {
  const e = Object.assign(new Error("HTTP 401: nope"), { statusCode: 401 });
  const pf = await preflightEngine({ family: "openai", host: "https://x/v1", model: "m", apiKey: "k", getFn: async () => { throw e; } });
  assert.equal(pf.authFailed, true);
});
