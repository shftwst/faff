import timing from "../plugin/skills/faff/bin/lib/run-timing.js";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(
  new URL("../plugin/skills/faff/bin/faff", import.meta.url),
);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "faff-timing-"));
  const dir = join(root, ".faff", "runs", "run-example");
  mkdirSync(dir, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const call = (...args) =>
    spawnSync(cli, args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, FAFF_WORKER_TIMING: "1" },
    });
  return { dir, root, call };
}

test("foreground wait wakes on a real evidence return and ignores old or unrelated hints", async (t) => {
  const { root, dir, call } = fixture(t);
  const send = (id) =>
    assert.equal(
      call("evidence", "return", "--run-dir", dir, "--issue", id).status,
      0,
    );
  send("A");
  const since = new Date(Date.now() + 1).toISOString();
  const args = [
    "run",
    "wait-ready",
    "--run-dir",
    dir,
    "--since",
    since,
    "--timeout-ms",
  ];
  send("B");
  assert.equal(JSON.parse(call(...args, "0", "A").stdout).wake, "checkpoint");
  const waiter = spawn(cli, [...args, "10000", "A"], { cwd: root });
  let output = "";
  waiter.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const done = once(waiter, "close");
  const timer = setTimeout(() => send("A"), 300);
  t.after(() => clearTimeout(timer));
  assert.equal((await done)[0], 0);
  assert.equal(JSON.parse(output).wake, "evidence-ready");
});

test("report separates retries and missing measurements and deduplicates native requests", (t) => {
  const { dir, call } = fixture(t);
  const ts = (n) => new Date(1700000000000 + n).toISOString();
  const line = (type, n, issue) => JSON.stringify({ type, issue, ts: ts(n) });
  writeFileSync(
    join(dir, "events.jsonl"),
    [
      line("run-start", 0),
      line("prep-start", 10, "A"),
      line("build-start", 20, "A"),
      line("build-start", 30, "A"),
      line("issue-outcome", 60, "A"),
      line("run-end", 70),
      "invalid",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "worker-timing.jsonl"),
    [
      line("worker-evidence-ready", 40, "A"),
      line("member-verify-start", 50, "A"),
    ].join("\n"),
  );
  const sample = {
    id: "r1",
    at: ts(24),
    role: "worker",
    usage: { cache_read: 120 },
  };
  writeFileSync(
    join(dir, "run-request-metrics.json"),
    JSON.stringify({
      schema: 1,
      epochs: { 0: { records: [sample] }, 1: { records: [sample] } },
    }),
  );
  const r = call("run", "timing", "--run-dir", dir, "--json");
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.run_ms, 70);
  assert.equal(report.prep_to_build_ms, 10);
  assert.equal(report.skipped_rows, 1);
  assert.deepEqual(
    report.builds.map((b) => b.ready_to_verify_ms),
    [null, 10],
  );
  assert.equal(report.request_windows.observed_requests, 1);
  assert.equal(
    report.request_windows.windows.build_to_last_outcome.cache_read,
    120,
  );
});

test("standalone attachment duration survives retries and remains scoped to the staged spec", (t) => {
  const { root, call } = fixture(t);
  const { finishPrepTiming } = timing;
  const start = "2026-11-27T12:00:00Z";
  finishPrepTiming(root, "A", start, "2026-11-27T12:00:05Z");
  finishPrepTiming(root, "A", start, "2026-11-27T12:01:00Z");
  const parent = join(root, ".faff", "prep", "timing");
  const [key] = readdirSync(parent);
  const dir = join(parent, key);
  const report = JSON.parse(
    call("run", "timing", "--run-dir", dir, "--json").stdout,
  );
  assert.equal(report.prep_observed_span_ms, 5000);
  assert.equal(report.run_ms, null);
  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, "run-timing.json"))),
    report,
  );
});

test("prep without a build attributes only requests inside its observed span", (t) => {
  const { dir, call } = fixture(t);
  const ts = n => new Date(1700000000000 + n).toISOString();
  const events = [[10, "prep-start"], [30, "prep-done"]].map(([n, type]) =>
    JSON.stringify({ ts: ts(n), type, issue: "A" }));
  writeFileSync(join(dir, "events.jsonl"), events.join("\n"));
  const records = [9, 10, 20, 30, 31].map(n => ({
    id: String(n), at: ts(n), role: "parent", usage: { cache_read: n },
  }));
  writeFileSync(join(dir, "prep-request-metrics.json"), JSON.stringify({ records }));
  const result = call("run", "timing", "--run-dir", dir, "--json");
  assert.equal(result.status, 0, result.stderr);
  const { windows } = JSON.parse(result.stdout).request_windows;
  assert.equal(windows.entry.requests, 1);
  assert.equal(windows.prep_and_admission.requests, 3);
  assert.equal(windows.prep_and_admission.cache_read, 60);
  assert.equal(windows.unattributed.requests, 1);
  assert.equal(windows.build_to_last_outcome.requests, 0);
});
