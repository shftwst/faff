// FAFF-1002 — the local UNIT rung's `runRung` becomes shard-aware: a shard-capable command
// (`node … --test` with no existing `--test-shard`) runs as N bounded-parallel shards so a
// >600s whole-suite process fits a foreground turn. This file exercises the shard-level
// primitives directly (spawnAsync's own timeout/overflow kill, and a real end-to-end sharded
// run) — the fast pure-logic cases (shardCapable, aggregateShardResults, config resolution,
// a quick real pass/fail sharded run) already live in gates.js's own `--selftest` (gatesSelftest);
// this file is the dedicated, slower regression coverage, mirroring
// test/gates-rung-stdout-overflow.test.mjs's own split from the fast selftest.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runRung, MAX_RUNG_STDOUT_BYTES } = require("../plugin/skills/faff/bin/lib/gates.js");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-gates-shard-"));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

function mkFixture(name, files) {
  const dir = path.join(tmpRoot, name);
  for (const [f, body] of Object.entries(files)) {
    const p = path.join(dir, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}

test("a shard killed by the per-rung timeout surfaces as an errored aggregate with reason timed-out — never pass, never fail", async () => {
  // Two real test files, forced to 2 shards; one file's test sleeps well past the configured
  // 800ms rung_timeout_ms so its shard is killed (ETIMEDOUT), the other passes fast.
  const dir = mkFixture("shard-timeout", {
    "test/fast.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('fast', () => assert.ok(true));\n",
    "test/slow.test.mjs": "import test from 'node:test'; test('slow', () => new Promise((r) => setTimeout(r, 5000)));\n",
    ".faffrc.yaml": "gates:\n  local_shards: 2\n  rung_timeout_ms: 800\n",
  });
  const r = await runRung({ kind: "UNIT", name: "unit (sharded timeout)", command: "node --test" }, dir);
  assert.equal(r.status, "errored");
  assert.equal(r.reason, "timed-out");
  assert.equal(r.command, "node --test"); // the LOGICAL unsharded command, never a --test-shard= form
});

test("a shard whose stdout exceeds the 64 MiB ceiling is killed (ENOBUFS) and the aggregate classifies errored with reason stdout-overflow", async () => {
  // One shard writes well past MAX_RUNG_STDOUT_BYTES; the other passes fast. The overflowing
  // shard must be independently killed (spawnAsync's own per-stream byte counter), not just the
  // whole-batch classifier.
  // Few, LARGE writes (not millions of tiny ones) — keeps this fast: a 1 MiB chunk x ~80
  // iterations clears the 64 MiB ceiling in well under a second of child-side work, and keeps
  // this process's own per-chunk 'data' handler overhead (string concat + slice) negligible.
  const dir = mkFixture("shard-overflow", {
    "test/fast.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('fast', () => assert.ok(true));\n",
    "test/noisy.test.mjs":
      "import test from 'node:test'; test('noisy', () => { const chunk = 'x'.repeat(1024 * 1024); for (let i = 0; i < 80; i++) process.stdout.write(chunk); });\n",
    ".faffrc.yaml": "gates:\n  local_shards: 2\n",
  });
  const r = await runRung({ kind: "UNIT", name: "unit (sharded overflow)", command: "node --test" }, dir);
  assert.equal(r.status, "errored");
  assert.equal(r.reason, "stdout-overflow");
}, { timeout: 20000 });

test("MAX_RUNG_STDOUT_BYTES stays the same finite ceiling used per-shard (never Infinity)", () => {
  assert.equal(MAX_RUNG_STDOUT_BYTES, 64 * 1024 * 1024);
});

test("gates.local_shards=1 (forced single-core simulation) runs the byte-identical single-process path — no --test-shard token reaches the child", async () => {
  const dir = mkFixture("shard-forced-single", {
    "test/a.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('a', () => assert.ok(true));\n",
    ".faffrc.yaml": "gates:\n  local_shards: 1\n",
  });
  const r = await runRung({ kind: "UNIT", name: "unit (forced single)", command: "node --test" }, dir);
  assert.equal(r.status, "pass");
  assert.equal(r.command, "node --test");
});

test("a command already carrying --test-shard is not re-sharded (defensive predicate) — runs the single path", async () => {
  const dir = mkFixture("shard-already-present", {
    "test/a.test.mjs": "import test from 'node:test'; import assert from 'node:assert'; test('a', () => assert.ok(true));\n",
    ".faffrc.yaml": "gates:\n  local_shards: 4\n",
  });
  const r = await runRung({ kind: "UNIT", name: "unit (pre-sharded)", command: "node --test --test-shard=1/1" }, dir);
  assert.equal(r.status, "pass");
  assert.equal(r.command, "node --test --test-shard=1/1"); // unchanged — not re-wrapped
});

test("a non-shard-capable rung (lint) is completely unaffected by gates.local_shards", async () => {
  const dir = mkFixture("shard-lint-unaffected", {
    ".faffrc.yaml": "gates:\n  local_shards: 4\n",
  });
  const r = await runRung({ kind: "LINT", name: "lint", command: "true" }, dir);
  assert.equal(r.status, "pass");
  assert.equal(r.command, "true");
});
