import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));
const { EVENT_LEDGER_OUTCOMES } = await import("../plugin/skills/faff/bin/lib/events.js");

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, "run", "return-map", ...args], { encoding: "utf8", ...options });
}

test("maps reconciled terminal returns to existing ledger and issue-outcome buckets", () => {
  for (const [token, bucket, annotation] of [
    ["shipped", "shipped", null],
    ["superseded-done", "superseded", null],
    ["pr-open-for-human", "pr-open", null],
    ["needs-human", "parked", null],
    ["retry-later", "parked", "review_outage_pending"],
    ["built-but-not-admitted", "parked", "build_review_dialogue_pending"],
    ["landing-resumable", "pr-open", "landing_resumable"],
    ["parked", "parked", null],
    ["errored", "errored", null],
  ]) {
    const result = run(["--outcome", token]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { action: "terminal", bucket, annotation }, token);
    assert(EVENT_LEDGER_OUTCOMES.has(bucket), `${bucket} must also be a valid issue-outcome payload`);
  }
});

test("keeps dispatcher handoff and pre-admission skips out of terminal buckets", () => {
  const handoff = run(["--outcome", "pr-ready"]);
  assert.equal(handoff.status, 0, handoff.stderr);
  assert.deepEqual(JSON.parse(handoff.stdout), { action: "merge-handoff", bucket: null, annotation: null });
  for (const token of ["ineligible", "blocked", "inadmissible", "claimed-by-peer"]) {
    const result = run(["--outcome", token]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { action: "pre-admission", bucket: null, annotation: null }, token);
  }
});

test("rejects unknown returns, wrong-phase ledger tokens and conflicting arguments", () => {
  for (const args of [
    [],
    ["--outcome", "unknown"],
    ["--outcome", "promoted"],
    ["--outcome", "pr-open"],
    ["--outcome", "routed-out"],
    ["--outcome", "unreached-budget"],
    ["--outcome", "parked", "--outcome", "shipped"],
    ["--outcome", "parked", "--run-dir", "/some/run"],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /run return-map/);
  }
});

test("is repeatable and never writes the current run ledger or event log", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "faff-return-map-"));
  try {
    const runDir = path.join(root, ".faff", "runs", "test");
    mkdirSync(runDir, { recursive: true });
    const originals = { "run-ledger.json": "{}\n", "events.jsonl": "fixture sentinel\n" };
    for (const [filename, body] of Object.entries(originals)) writeFileSync(path.join(runDir, filename), body);
    const options = { cwd: root, env: { ...process.env, FAFF_RUN_DIR: runDir } };
    const args = ["--outcome", "retry-later"];
    const first = run(args, options);
    const repeated = run(args, options);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.equal(first.stdout, repeated.stdout);
    assert.deepEqual(readdirSync(runDir).sort(), Object.keys(originals).sort());
    for (const [filename, body] of Object.entries(originals)) assert.equal(readFileSync(path.join(runDir, filename), "utf8"), body);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
