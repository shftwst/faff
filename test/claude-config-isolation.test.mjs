// FAFF-647 — a `claude -p` engine-call spawn gets its own CLAUDE_CONFIG_DIR, not
// the orchestrator's. Covers: the pure helper functions (mintIsolatedConfigDir,
// forwardClaudeCredential, buildIsolatedChildEnv), the withIsolatedClaudeConfig
// orchestrator's auth-mode split (api-key never forwards a credential file;
// subscription-seat forwards + chmods it), and the SPAWN_FAMILY_RUNNERS
// registry that replaced engine.js's hardcoded `if (res.family === "codex")`
// fork — asserting codex still dispatches through it byte-equivalently and that
// it declares itself config-dir-free. The registry-driven conformance selftest
// (redaction for every runner; CLAUDE_CONFIG_DIR isolation for config-dir-bearing
// families) and the helper's own end-to-end selftest are exercised via
// `faff engine --selftest` in test/engine-call.test.mjs; this file covers the
// pure/direct-import seams those selftests don't re-state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import isolation from "../plugin/skills/faff/bin/lib/claude-config-isolation.js";
import engine from "../plugin/skills/faff/bin/lib/engine.js";
import engineCodex from "../plugin/skills/faff/bin/lib/engine-codex.js";

const { mintIsolatedConfigDir, forwardClaudeCredential, buildIsolatedChildEnv, withIsolatedClaudeConfig, CREDENTIAL_FILENAME, CLAUDE_AUTH_TOKEN_ENV } = isolation;
const { spawnFamilyRunners, SPAWN_FAMILY_CONFIG_DIR_BEARING } = engine;
const { runCodexCall } = engineCodex;

function tmp(prefix) { return mkdtempSync(path.join(tmpdir(), prefix)); }

// --- the registry (replaces engine.js's hardcoded codex fork) ---

test("SPAWN_FAMILY_RUNNERS registry: codex is registered as the first occupant", () => {
  const runners = spawnFamilyRunners();
  assert.equal(runners.codex, runCodexCall, "the SAME runCodexCall production dispatch already used — not a re-implementation");
});

test("SPAWN_FAMILY_CONFIG_DIR_BEARING: codex declares itself config-dir-free", () => {
  assert.equal(SPAWN_FAMILY_CONFIG_DIR_BEARING.codex, false);
});

test("registry lookup dispatches codex byte-equivalently to the pre-refactor hardcoded fork", async () => {
  // Same call shape runCodexCall's own selftest drives — the point is that
  // engine.js's dispatch now reaches it via SPAWN_FAMILY_RUNNERS[family], not a
  // hardcoded `if`, with no behavioural change. FAFF-877: runCodexCall is now
  // async and the exec spawn is a separate async child (spawnAsyncFn) — the seat
  // probe stays sync/spawnFn-shaped, unchanged.
  const { EventEmitter } = await import("node:events");
  const runner = spawnFamilyRunners().codex;
  let stdout = "";
  const AGENT_LINE = JSON.stringify({ type: "item.completed", item: { item_type: "agent_message", text: "hi" } });
  const code = await runner({
    engine: { name: "seat", provider: "codex", family: "codex", model: "m", binPath: "codex", apiKeyEnv: null, timeoutMs: 1000, operationDeadlineSecs: 3600 },
    system: "S", user: "U",
    spawnFn: () => ({ status: 0, stdout: "ok", stderr: "", error: null, signal: null }),
    spawnAsyncFn: () => {
      const child = new EventEmitter();
      child.pid = 9191;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write: () => {}, end: () => {} };
      queueMicrotask(() => { child.stdout.emit("data", `${AGENT_LINE}\n`); child.emit("exit", 0, null); });
      return child;
    },
    stdoutWrite: (s) => (stdout += s), stderrWrite: () => {},
  });
  assert.equal(code, 0);
  assert.equal(stdout, "hi\n");
});

// --- mintIsolatedConfigDir ---

test("mintIsolatedConfigDir: fresh empty dir under baseDir, mode 0700", () => {
  const base = tmp("faff647-base-");
  try {
    const dir = mintIsolatedConfigDir({ baseDir: base });
    try {
      assert.ok(dir.startsWith(base));
      assert.equal(statSync(dir).mode & 0o777, 0o700);
      assert.deepEqual(readdirSync(dir), []);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("mintIsolatedConfigDir: defaults baseDir to os.tmpdir() when unset", () => {
  const dir = mintIsolatedConfigDir({});
  try { assert.ok(dir.startsWith(tmpdir())); } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- forwardClaudeCredential ---

test("forwardClaudeCredential: copies only .credentials.json, chmod 0600, nothing else", () => {
  const ambient = tmp("faff647-ambient-");
  const isolated = tmp("faff647-isolated-");
  try {
    writeFileSync(path.join(ambient, CREDENTIAL_FILENAME), "seat-token");
    writeFileSync(path.join(ambient, ".claude.json"), "mutable-state");
    const dst = forwardClaudeCredential(isolated, { ambientDir: ambient });
    assert.equal(dst, path.join(isolated, CREDENTIAL_FILENAME));
    assert.equal(readFileSync(dst, "utf8"), "seat-token");
    assert.equal(statSync(dst).mode & 0o777, 0o600);
    assert.equal(existsSync(path.join(isolated, ".claude.json")), false);
  } finally {
    rmSync(ambient, { recursive: true, force: true });
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("forwardClaudeCredential: absent credential file -> null, never throws", () => {
  const ambient = tmp("faff647-ambient-empty-");
  const isolated = tmp("faff647-isolated-");
  try {
    assert.doesNotThrow(() => {
      const r = forwardClaudeCredential(isolated, { ambientDir: ambient });
      assert.equal(r, null);
    });
  } finally {
    rmSync(ambient, { recursive: true, force: true });
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("forwardClaudeCredential: no ambientDir -> null, never throws", () => {
  assert.equal(forwardClaudeCredential("/some/dir", {}), null);
});

// --- buildIsolatedChildEnv ---

test("buildIsolatedChildEnv: full ambient env inherited, exactly one CLAUDE_CONFIG_DIR override", () => {
  const { env } = buildIsolatedChildEnv({ HOME: "/h", PATH: "/bin", SHELL: "/bin/zsh" }, "/tmp/iso");
  assert.equal(env.HOME, "/h");
  assert.equal(env.PATH, "/bin");
  assert.equal(env.SHELL, "/bin/zsh");
  assert.equal(env.CLAUDE_CONFIG_DIR, "/tmp/iso");
});

test("buildIsolatedChildEnv: redactedEnv masks the injected api-key value, env carries the real one", () => {
  const { env, redactedEnv } = buildIsolatedChildEnv({}, "/tmp/iso", { name: CLAUDE_AUTH_TOKEN_ENV, value: "sk-live-secret-value" });
  assert.equal(env[CLAUDE_AUTH_TOKEN_ENV], "sk-live-secret-value");
  assert.notEqual(redactedEnv[CLAUDE_AUTH_TOKEN_ENV], "sk-live-secret-value");
  assert.doesNotMatch(JSON.stringify(redactedEnv), /sk-live-secret-value/);
});

// --- withIsolatedClaudeConfig: auth-mode split ---

test("withIsolatedClaudeConfig: subscription-seat mode forwards the credential file, injects no token", async () => {
  const ambient = tmp("faff647-ambient-seat-");
  writeFileSync(path.join(ambient, CREDENTIAL_FILENAME), "seat-cred");
  let capturedEnv = null;
  try {
    await withIsolatedClaudeConfig(async ({ env, cwd }) => {
      capturedEnv = env;
      assert.equal(existsSync(path.join(cwd, CREDENTIAL_FILENAME)), true, "credential forwarded before spawnFn runs");
      return { stdout: "" };
    }, { authMode: "subscription-seat", ambientDir: ambient, ambientEnv: { HOME: "/h" } });
    assert.equal(capturedEnv[CLAUDE_AUTH_TOKEN_ENV], undefined, "subscription-seat mode injects no token env override");
  } finally { rmSync(ambient, { recursive: true, force: true }); }
});

test("withIsolatedClaudeConfig: api-key mode injects the token value, forwards no credential file", async () => {
  const ambient = tmp("faff647-ambient-apikey-");
  writeFileSync(path.join(ambient, CREDENTIAL_FILENAME), "should-never-be-copied");
  let capturedEnv = null;
  try {
    await withIsolatedClaudeConfig(async ({ env, cwd }) => {
      capturedEnv = env;
      assert.equal(existsSync(path.join(cwd, CREDENTIAL_FILENAME)), false, "api-key mode forwards no credential file");
      return { stdout: "" };
    }, { authMode: "api-key", ambientDir: ambient, ambientEnv: { HOME: "/h", MY_KEY_ENV: "sk-injected" }, apiKeyEnv: "MY_KEY_ENV" });
    assert.equal(capturedEnv[CLAUDE_AUTH_TOKEN_ENV], "sk-injected");
  } finally { rmSync(ambient, { recursive: true, force: true }); }
});

test("withIsolatedClaudeConfig: isolated dir is gone after the finally, even on a spawnFn throw", async () => {
  let seenDir = null;
  await assert.rejects(
    withIsolatedClaudeConfig(async ({ cwd }) => { seenDir = cwd; throw new Error("spawn boom"); }, { authMode: "api-key", ambientEnv: {} }),
    /spawn boom/,
  );
  assert.ok(seenDir);
  assert.equal(existsSync(seenDir), false, "cleanup still ran in finally despite the thrown error");
});

test("withIsolatedClaudeConfig: a mkdtemp failure surfaces (never silently swallowed)", async () => {
  await assert.rejects(
    withIsolatedClaudeConfig(async () => ({ stdout: "" }), {
      authMode: "api-key", ambientEnv: {},
      seams: { mkdtempFn: () => { throw new Error("ENOSPC: no space left on device"); } },
    }),
    /ENOSPC/,
  );
});
