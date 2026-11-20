import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { faffBin, runCli } from "./helpers/run-cli.mjs";

const exec = promisify(execFile);

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-review-resume-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const issue = "TEST-9";
  const call = (sub, ...args) => runCli(["review-progress", sub, dir, issue, ...args], { cwd: dir });
  const ok = (sub, ...args) => {
    const result = call(sub, ...args);
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  return { dir, issue, call, ok, resume: hash => ok("resume", "--diff-hash", hash),
    file: path.join(dir, issue, "review-progress.json") };
}

test("resume binds a checkpoint and readable findings to the issue and captured diff", t => {
  const { dir, file, issue, resume, ok, call } = fixture(t);
  assert.deepEqual(resume("one"), { action: "fresh" });
  assert.equal(call("resume", "--diff-hash").code, 2);
  ok("write", "--phase1-pass", "--diff-hash", "one");
  assert.deepEqual(resume("one"), { action: "phase2" });
  assert.deepEqual(resume("two"), { action: "fresh" });
  ok("write", "--phase2", "in_flight", "--expect-diff", "one");
  assert.deepEqual(resume("one"), { action: "phase2" });
  writeFileSync(path.join(dir, "findings.md"), "fixture finding");
  ok("write", "--phase2", "complete", "--findings", "findings.md", "--expect-diff", "one");
  assert.deepEqual(resume("one"), { action: "dispose-findings", findings_ref: "findings.md" });
  rmSync(path.join(dir, "findings.md"));
  assert.deepEqual(resume("one"), { action: "phase2" });
  const original = ok("read");
  for (const partial of [{...original, issue: "OTHER"}, {...original, phase1: {}},
    {...original, phase2: null}, {...original, phase2: {status: "unknown"}}, {issue}]) {
    writeFileSync(file, JSON.stringify(partial));
    assert.deepEqual(resume("one"), { action: "fresh" });
  }
  writeFileSync(file, "{");
  assert.deepEqual(resume("one"), { action: "fresh" });
});

test("a late Phase-2 callback leaves the newer receipt intact; each skip retains its status", t => {
  const { call, file, ok, resume } = fixture(t);
  assert.equal(call("write", "--phase2", "in_flight", "--expect-diff", "old").code, 3);
  ok("write", "--phase1-pass", "--diff-hash", "old");
  ok("write", "--phase1-pass", "--diff-hash", "new");
  const before = readFileSync(file);
  for (const status of ["complete", "in_flight", "skipped_unreachable", "skipped_deadline"]) {
    const late = call("write", "--phase2", status, "--expect-diff", "old", "--findings", "obsolete.md");
    assert.equal(late.code, 3, late.stderr);
    assert.deepEqual(readFileSync(file), before);
  }
  for (const status of ["skipped_unreachable", "skipped_deadline"]) {
    ok("write", "--phase2", status, "--expect-diff", "new");
    assert.deepEqual(resume("new"), { action: "reconcile-skip", status });
  }
  assert.equal(call("write", "--phase2", "in_flight", "--expect-diff").code, 2);
  assert.equal(call("write", "--outage-retry", "--expect-diff", "new").code, 2);
});

test("retries survive phase rewrites, replacement diffs and concurrent increments", async t => {
  const { dir, issue, ok } = fixture(t);
  ok("write", "--phase1-pass", "--diff-hash", "one");
  assert.equal(ok("write", "--outage-retry").outage_retries, 1);
  assert.equal(ok("write", "--phase2", "in_flight").outage_retries, 1);
  assert.equal(ok("write", "--phase1-pass", "--diff-hash", "two").outage_retries, 1);
  await Promise.all(Array.from({length: 8}, () => exec(process.execPath, [faffBin, "review-progress", "write", dir, issue, "--outage-retry"])));
  assert.equal(ok("read").outage_retries, 9);
});
