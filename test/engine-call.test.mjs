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
import engineCodex from "../plugin/skills/faff/bin/lib/engine-codex.js";
import config from "../plugin/skills/faff/bin/lib/config.js";

const { buildEngineRequest, parseEngineResponse, preflightEngine, runEngineCall, ENGINE_EXIT } = engine;
const { buildCodexArgv, parseCodexEvents, runCodexCall } = engineCodex;
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

// --- FAFF-593: codex spawn family — read-time guards (config get) ---

const CODEX_BLOCK = "backends:\n  codex-seat:\n    provider: codex\n    model: gpt-5-codex\n";

test("codex: engine:codex-seat on models.methodology resolves at read (host-less is valid)", () => {
  const dir = fixtureDir(CODEX_BLOCK + "models:\n  methodology: engine:codex-seat\n");
  try {
    const r = runCli(["config", "get", "models.methodology"], { cwd: dir });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), "engine:codex-seat");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("codex: a present host is refused at read with the named error", () => {
  const dir = fixtureDir("backends:\n  c:\n    provider: codex\n    model: m\n    host: http://h:1\nmodels:\n  intake: engine:c\n");
  try {
    const r = runCli(["config", "get", "models.intake"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /a codex engine has no host/);
    assert.match(r.stderr, /bin_path/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("codex: reasoning_off: true is refused at read (no codex mapping exists)", () => {
  const dir = fixtureDir("backends:\n  c:\n    provider: codex\n    model: m\n    reasoning_off: true\nmodels:\n  intake: engine:c\n");
  try {
    const r = runCli(["config", "get", "models.intake"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /reasoning_off is not supported on provider codex/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("codex: auth: none is refused at read (codex always authenticates)", () => {
  const dir = fixtureDir("backends:\n  c:\n    provider: codex\n    model: m\n    auth: none\nmodels:\n  intake: engine:c\n");
  try {
    const r = runCli(["config", "get", "models.intake"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /auth "none" is refused on provider codex/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("codex: a non-allowlisted lane still rejects an engine value at read (unchanged guard)", () => {
  const dir = fixtureDir(CODEX_BLOCK + "models:\n  build: engine:codex-seat\n");
  try {
    const r = runCli(["config", "get", "models.build"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /models\.methodology \| models\.intake/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("codex: resolveEngineForLane returns the codex-shaped record (binPath, no host)", () => {
  const r = resolveEngineForLane({
    backends: { c: { provider: "codex", model: "gpt-5-codex", bin_path: "/opt/codex/bin/codex", timeout: 30 } },
    models: { intake: "engine:c" },
  }, "intake");
  assert.equal(r.error, undefined);
  assert.equal(r.family, "codex");
  assert.equal(r.host, null);
  assert.equal(r.binPath, "/opt/codex/bin/codex");
  assert.equal(r.timeoutMs, 30000);
});

// --- FAFF-593: codex dispatch table (injected spawn — zero real spawns) ---

const CODEX_ENGINE = { name: "codex-seat", provider: "codex", family: "codex", model: "gpt-5-codex", binPath: "codex", apiKeyEnv: null, timeoutMs: 1000 };
const AGENT_LINE = JSON.stringify({ type: "item.completed", item: { id: "item_0", item_type: "agent_message", text: "the producer block" } });
const TURN_LINE = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } });
const PROBE_OK = { status: 0, stdout: "Logged in using ChatGPT", stderr: "", error: null, signal: null };
const sink = () => {};
// Injected spawn dispatcher: probe calls (login status) vs exec calls, with capture.
function spawnSeq(probeRes, execRes, calls = []) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return args[0] === "login" ? probeRes : execRes;
  };
}

test("codex dispatch: happy path — exit 0, stdout is the final agent message, one exec spawn", () => {
  const calls = [];
  let stdout = "";
  const code = runCodexCall({
    engine: CODEX_ENGINE, system: "SYS", user: "USR",
    spawnFn: spawnSeq(PROBE_OK, { status: 0, stdout: `${TURN_LINE}\n${AGENT_LINE}\n`, stderr: "", error: null, signal: null }, calls),
    stdoutWrite: (s) => (stdout += s), stderrWrite: sink,
  });
  assert.equal(code, ENGINE_EXIT.OK);
  assert.equal(stdout, "the producer block\n");
  const exec = calls.filter((c) => c.args[0] === "exec");
  assert.equal(exec.length, 1);
  assert.deepEqual(exec[0].args, buildCodexArgv("gpt-5-codex"));
  assert.equal(exec[0].opts.input, "SYS\n\nUSR");
});

test("codex dispatch: seat probe exit 1 → auth-failed exit 6, codex exec never spawned", () => {
  const calls = [];
  let stderr = "";
  const code = runCodexCall({
    engine: CODEX_ENGINE, system: "S", user: "U",
    spawnFn: spawnSeq({ status: 1, stdout: "", stderr: "Not logged in", error: null, signal: null }, null, calls),
    stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
  });
  assert.equal(code, ENGINE_EXIT.AUTH);
  assert.match(stderr, /codex login/);
  assert.equal(calls.filter((c) => c.args[0] === "exec").length, 0);
});

test("codex dispatch: ENOENT → engine-unreachable exit 5 naming install/bin_path", () => {
  let stderr = "";
  const enoent = { status: null, stdout: null, stderr: null, error: Object.assign(new Error("spawnSync codex ENOENT"), { code: "ENOENT" }), signal: null };
  const code = runCodexCall({ engine: CODEX_ENGINE, system: "S", user: "U", spawnFn: () => enoent, stdoutWrite: sink, stderrWrite: (s) => (stderr += s) });
  assert.equal(code, ENGINE_EXIT.UNREACHABLE);
  assert.match(stderr, /codex binary not found/);
  assert.match(stderr, /bin_path/);
});

test("codex dispatch: non-JSON stdout line → malformed-response exit 7 with excerpt", () => {
  let stderr = "";
  const code = runCodexCall({
    engine: CODEX_ENGINE, system: "S", user: "U",
    spawnFn: spawnSeq(PROBE_OK, { status: 0, stdout: `${AGENT_LINE}\nplain chatter\n`, stderr: "", error: null, signal: null }),
    stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
  });
  assert.equal(code, ENGINE_EXIT.MALFORMED);
  assert.match(stderr, /plain chatter/);
});

test("codex dispatch: clean exit with no agent message → malformed-response exit 7", () => {
  let stderr = "";
  const code = runCodexCall({
    engine: CODEX_ENGINE, system: "S", user: "U",
    spawnFn: spawnSeq(PROBE_OK, { status: 0, stdout: `${TURN_LINE}\n`, stderr: "", error: null, signal: null }),
    stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
  });
  assert.equal(code, ENGINE_EXIT.MALFORMED);
  assert.match(stderr, /no agent message/);
});

test("codex dispatch: auth-shaped child failure → auth-failed exit 6", () => {
  let stderr = "";
  const code = runCodexCall({
    engine: CODEX_ENGINE, system: "S", user: "U",
    spawnFn: spawnSeq(PROBE_OK, { status: 1, stdout: "", stderr: "HTTP 401 unauthorized", error: null, signal: null }),
    stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
  });
  assert.equal(code, ENGINE_EXIT.AUTH);
  assert.match(stderr, /remedy: codex login/);
});

test("codex dispatch: declared api_key_env unset → exit 6 before ANY spawn (probe included)", () => {
  const calls = [];
  let stderr = "";
  const code = runCodexCall({
    engine: { ...CODEX_ENGINE, apiKeyEnv: "FAFF593_TEST_UNSET_KEY" }, system: "S", user: "U",
    spawnFn: spawnSeq(PROBE_OK, null, calls), env: {},
    stdoutWrite: sink, stderrWrite: (s) => (stderr += s),
  });
  assert.equal(code, ENGINE_EXIT.AUTH);
  assert.match(stderr, /FAFF593_TEST_UNSET_KEY/);
  assert.equal(calls.length, 0);
});

test("codex parse: events (usage fields included) survive in the parse result — the FAFF-604 seam", () => {
  const p = parseCodexEvents(`${TURN_LINE}\n${AGENT_LINE}\n`);
  assert.equal(p.finalMessage, "the producer block");
  assert.equal(p.events.length, 2);
  assert.equal(p.events[0].usage.output_tokens, 5);
});

// --- FAFF-604: the codex call boundary records spend into the run ------------
// codex exec is --ephemeral (no session file, temp cwd removed), so nothing
// codex-side survives to be attributed later: the caller is the only place that
// knows both the usage and the run. These pin that the sink is wired end to end
// through `faff engine call`, and that a missing run degrades honestly.

const { sumCodexUsage } = engineCodex;
const CODEX_FIXTURE = "backends:\n  seat:\n    provider: codex\n    model: gpt-5-codex\nmodels:\n  methodology: engine:seat\n";

test("FAFF-604: sumCodexUsage totals turn.completed usage into the four token classes", () => {
  const u = sumCodexUsage([
    { type: "turn.completed", usage: { input_tokens: 40, output_tokens: 12, cached_input_tokens: 8 } },
    { type: "turn.completed", usage: { input_tokens: 2 } },
  ]);
  // 40 input of which 8 cached → 32 non-cached; plus 2 uncached from the second turn.
  assert.deepEqual(u, { input: 34, output: 12, cache_write: 0, cache_read: 8 });
});

test("FAFF-604: a successful codex call hands the sink one record with class-mapped usage", () => {
  const engineRef = { name: "seat", provider: "codex", family: "codex", model: "gpt-5-codex", binPath: "codex", apiKeyEnv: null, timeoutMs: 1000 };
  const stream = [
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 30, output_tokens: 9, cached_input_tokens: 4 } }),
    JSON.stringify({ type: "item.completed", item: { item_type: "agent_message", text: "block" } }),
  ].join("\n") + "\n";
  const recorded = [];
  const code = runCodexCall({
    engine: engineRef, system: "S", user: "U",
    spawnFn: (cmd, args) => (args[0] === "login"
      ? { status: 0, stdout: "ok", stderr: "", error: null, signal: null }
      : { status: 0, stdout: stream, stderr: "", error: null, signal: null }),
    stdoutWrite: () => {}, stderrWrite: () => {},
    spendSink: (r) => recorded.push(r), nowFn: () => "2026-07-25T00:00:00Z",
  });
  assert.equal(code, ENGINE_EXIT.OK);
  assert.deepEqual(recorded, [{
    ts: "2026-07-25T00:00:00Z", engine: "seat", provider: "codex", model: "gpt-5-codex",
    source: "exec-json-events", input: 26, output: 9, cache_write: 0, cache_read: 4,
  }]);
});

test("FAFF-604: a spend-sink write fault never changes the dispatch's exit code", () => {
  const engineRef = { name: "seat", provider: "codex", family: "codex", model: "m", binPath: "codex", apiKeyEnv: null, timeoutMs: 1000 };
  const stream = JSON.stringify({ type: "item.completed", item: { item_type: "agent_message", text: "block" } }) + "\n";
  let stderr = "";
  const code = runCodexCall({
    engine: engineRef, system: "S", user: "U",
    spawnFn: (cmd, args) => (args[0] === "login"
      ? { status: 0, stdout: "ok", stderr: "", error: null, signal: null }
      : { status: 0, stdout: stream, stderr: "", error: null, signal: null }),
    stdoutWrite: () => {}, stderrWrite: (s) => (stderr += s),
    spendSink: () => { throw new Error("EACCES"); },
  });
  assert.equal(code, ENGINE_EXIT.OK, "metering must never break a producer dispatch");
  assert.match(stderr, /could not record codex spend/);
});

test("FAFF-604: `engine call` outside a run says so rather than silently dropping the spend", () => {
  const dir = fixtureDir(CODEX_FIXTURE);
  try {
    const sys = path.join(dir, "s.txt"); const usr = path.join(dir, "u.txt");
    writeFileSync(sys, "S"); writeFileSync(usr, "U");
    // No .faff/runs at all, and no --run-dir: there is no run to attribute to.
    // The call still proceeds (it fails later on the absent codex binary) — the
    // point is the named notice, never a silent drop.
    const r = runCli(["engine", "call", "--lane", "methodology", "--system", sys, "--user", usr, "--root", dir], { cwd: dir });
    assert.match(r.stderr, /outside a run — spend not metered/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-604: --run-dir is accepted by `engine call` (explicit in-run attribution)", () => {
  const dir = fixtureDir(CODEX_FIXTURE);
  try {
    const sys = path.join(dir, "s.txt"); const usr = path.join(dir, "u.txt");
    writeFileSync(sys, "S"); writeFileSync(usr, "U");
    const r = runCli(["engine", "call", "--lane", "methodology", "--system", sys, "--user", usr, "--root", dir, "--run-dir", dir], { cwd: dir });
    // An explicit run dir resolves, so the outside-a-run notice must NOT fire.
    assert.ok(!/outside a run/.test(r.stderr), r.stderr);
    // The flag is known to the parser — an unknown flag would be a usage exit 2.
    assert.notEqual(r.code, 2, r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-604 REGRESSION: codex cached input is a SUBSET of input_tokens, never double-counted", () => {
  // The four-class model is Anthropic's, where the classes are disjoint. codex
  // reports cached input INSIDE input_tokens (hence codex-rs's non_cached_input
  // helper), so counting both would bill those tokens twice.
  const u = sumCodexUsage([{ type: "turn.completed", usage: { input_tokens: 40, output_tokens: 12, cached_input_tokens: 8 } }]);
  assert.deepEqual(u, { input: 32, output: 12, cache_write: 0, cache_read: 8 });
  assert.equal(u.input + u.cache_read, 40, "the classes must partition input_tokens, not overlap it");
  // Incoherent stream (more cached than input) clamps rather than going negative.
  const weird = sumCodexUsage([{ type: "turn.completed", usage: { input_tokens: 5, cached_input_tokens: 9 } }]);
  assert.equal(weird.input, 0);
});

// --- FAFF-666: cache_write_input_tokens and reasoning_output_tokens --------
// The two fields codex reports on turn.completed.usage that sumCodexUsage
// used to drop entirely, leaving totals.cache_write structurally dead for
// every codex backend. Oracles below are hand-derived from each fixture's own
// raw fields, never produced by running sumCodexUsage — an independent check,
// not a self-recompute.

test("FAFF-666: the committed real observed payload (codex-cli-observed.md) totals to the hand-derived oracle", () => {
  // docs/architecture/codex-cli-observed.md, the read-only-producer capture:
  // {"input_tokens":14775,"cached_input_tokens":12032,"cache_write_input_tokens":0,"output_tokens":6,"reasoning_output_tokens":0}
  const u = sumCodexUsage([
    { type: "turn.completed", usage: { input_tokens: 14775, cached_input_tokens: 12032, cache_write_input_tokens: 0, output_tokens: 6, reasoning_output_tokens: 0 } },
  ]);
  // 14775 - 12032 - 0 = 2743
  assert.deepEqual(u, { input: 2743, output: 6, cache_write: 0, cache_read: 12032 });
});

test("FAFF-666: a synthetic non-zero cache_write_input_tokens/reasoning_output_tokens payload proves the wiring", () => {
  const u = sumCodexUsage([
    { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 200, cache_write_input_tokens: 150, output_tokens: 40, reasoning_output_tokens: 9 } },
  ]);
  // cache_write_input_tokens now reaches totals.cache_write (structural deadness gone);
  // input subtracts BOTH cached and cache_write (1000 - 200 - 150 = 650, subset handling);
  // reasoning_output_tokens is NOT added to output (9 excluded, already-inside handling).
  assert.deepEqual(u, { input: 650, output: 40, cache_write: 150, cache_read: 200 });
});

test("FAFF-666: an incoherent stream where cache_write_input_tokens alone exceeds input_tokens clamps at 0", () => {
  const weird = sumCodexUsage([{ type: "turn.completed", usage: { input_tokens: 5, cache_write_input_tokens: 9 } }]);
  assert.equal(weird.input, 0);
  assert.equal(weird.cache_write, 9, "cache_write is still recorded even when the input clamp fires");
});

test("FAFF-666: an incoherent stream where cached + cache_write TOGETHER exceed input_tokens clamps at 0 (the actual widened guard)", () => {
  // The single-term `weird` cases above each exercise one subtracted term alone.
  // This is the case the widened subtraction (input - cached - cache_write) actually
  // guards: 4 + 4 = 8 > 5, so neither term alone overflows but their sum does.
  const weird = sumCodexUsage([{ type: "turn.completed", usage: { input_tokens: 5, cached_input_tokens: 4, cache_write_input_tokens: 4 } }]);
  assert.equal(weird.input, 0, "the combined subtraction clamps at 0, not a negative number");
  // cache_read and cache_write are still recorded at their full reported values —
  // per spec §4 "Edge cases", only `input` is floored; the other three classes are
  // direct sums of n()-guarded values. An incoherent stream (raw fields whose
  // subsets exceed the base) is out of contract for a real codex payload — every
  // class comes off the same turn.completed.usage object — so this is the existing
  // undercount-on-`input`-only posture (unchanged since the pre-FAFF-666 `cached`-only
  // clamp), not a new double-count introduced here.
  assert.equal(weird.cache_read, 4);
  assert.equal(weird.cache_write, 4);
});
