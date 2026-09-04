// FAFF-981 — spawnSync's default maxBuffer (1 MB) meant any rung emitting more than ~1 MB of
// stdout (the UNIT rung's node --test TAP stream, easily several MB, is the reliable real-world
// case) was killed by Node with ENOBUFS and misclassified "errored" -> a false needs-human park.
// This file drives runRung directly (createRequire, per gates-ci-source.test.mjs's own pattern) so
// each case is a tight, fast assertion on the classifier rather than an end-to-end gate-ladder run.
//
// Sibling ticket FAFF-984 fixed the adjacent ETIMEDOUT branch of the same classifier (a distinct
// reason:"timed-out"); this file covers ENOBUFS only and never touches the timeout path.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { runRung, MAX_RUNG_STDOUT_BYTES } = require("../plugin/skills/faff/bin/lib/gates.js");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "faff-gates-overflow-"));
after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

test("MAX_RUNG_STDOUT_BYTES is a finite 64 MiB ceiling (never Infinity — bounds worst-case memory)", () => {
  assert.equal(MAX_RUNG_STDOUT_BYTES, 64 * 1024 * 1024);
  assert.ok(Number.isFinite(MAX_RUNG_STDOUT_BYTES));
});

test("a rung emitting well over 1 MB of stdout and exiting 0 classifies pass, not errored", () => {
  // ~2.4 MB — comfortably over Node's 1 MB spawnSync default, comfortably under the 64 MiB ceiling.
  const cmd = "node -e \"for(let i=0;i<80000;i++)process.stdout.write('x'.repeat(30)+'\\n')\"";
  const r = runRung({ kind: "UNIT", name: "noisy pass", command: cmd }, tmpRoot);
  assert.equal(r.status, "pass");
  assert.equal(r.reason, undefined);
});

test("a rung emitting well over 1 MB of stdout and exiting non-zero classifies fail, not errored", () => {
  const cmd = "node -e \"for(let i=0;i<80000;i++)process.stdout.write('x'.repeat(30)+'\\n');process.exit(1)\"";
  const r = runRung({ kind: "UNIT", name: "noisy fail", command: cmd }, tmpRoot);
  assert.equal(r.status, "fail");
  assert.equal(r.reason, undefined);
});

test("a command-not-found rung (exit 127) still classifies errored, unaffected by the overflow fix", () => {
  const r = runRung({ kind: "LINT", name: "missing", command: "this-command-does-not-exist-xyz" }, tmpRoot);
  assert.equal(r.status, "errored");
  assert.equal(r.reason, undefined);
});

test("a rung whose stdout exceeds the 64 MiB ceiling is killed (ENOBUFS) and classifies errored with a distinct overflow reason + detail", () => {
  // Write ~70 MiB in one burst — past MAX_RUNG_STDOUT_BYTES, so Node kills the child before it can
  // exit (res.status becomes null) and sets res.error.code === "ENOBUFS". This is the one case that
  // must generate real bytes past the production ceiling, so it is deliberately isolated to this
  // dedicated file rather than run on every `faff gates --selftest` pass.
  // Uses the `yes`/`head` coreutils (Unix-only) rather than a portable node -e writer — the same
  // convention this classifier's own FAFF-984 timeout case already relies on ("sleep 5" below, and
  // in gatesSelftest), and faff's CI matrix (validate + validate-macos) never runs Windows.
  const bytes = 70 * 1024 * 1024;
  const cmd = `yes | head -c ${bytes}`;
  const r = runRung({ kind: "UNIT", name: "over-ceiling", command: cmd }, tmpRoot);
  assert.equal(r.status, "errored");
  assert.equal(r.reason, "stdout-overflow");
  assert.match(r.detail, /exceeded the 64 MiB per-stream ceiling/);
});

test("a genuine spawn timeout (ETIMEDOUT) is unaffected — stays errored with reason timed-out, never stdout-overflow", () => {
  const configDir = path.join(tmpRoot, "timeout-fixture");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, ".faffrc.yaml"), "gates:\n  rung_timeout_ms: 500\n");
  const r = runRung({ kind: "UNIT", name: "sleeper", command: "sleep 5" }, configDir);
  assert.equal(r.status, "errored");
  assert.equal(r.reason, "timed-out");
});
