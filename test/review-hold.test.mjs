import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runCli } from "./helpers/run-cli.mjs";

const issue = "ISS-7";
const hash = "a".repeat(64);
const cli = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));
const counters = ["--fix-rounds-used", "1", "--rebuttal-rounds-used", "0"];
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "review-prepare-hold-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  // Match config get's repo root and resolve real defaults from the CLI.
  execFileSync("git", ["init", "-q"], { cwd });
  const store = join(cwd, ".faff", "resume");
  const stored = join(store, issue);
  const opts = ["--store-root", store, "--issue", issue];
  const checkpoint = (run, name) => join(run, issue, name);
  const json = (file, value) => { mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, JSON.stringify(value)); };
  const load = (file) => JSON.parse(readFileSync(file, "utf8"));
  const prepareArgs = (run, cause = "review-outage", ...extra) => ["resume-store", "prepare-hold", "--run-dir", run, "--root", cwd, "--mode", "autonomous", "--cause", cause, ...opts, ...extra];
  const command = (args) => runCli(args, { cwd });
  const expect = (args) => {
    const result = command(args);
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const create = (tag, withDialogue = false) => {
    const run = join(cwd, tag);
    json(checkpoint(run, "build-progress.json"), { issue, build: { status: "complete", branch: "feature", diff_hash: hash } });
    json(checkpoint(run, "review-progress.json"), { issue, phase1: { verdict: "pass", diff_hash: hash }, phase2: { status: "in_flight" } });
    if (withDialogue) {
      json(checkpoint(run, "build-review/round-1.json"), { signal: "fail", findings: [], author_replies: [] });
      json(checkpoint(run, "build-review/judge/ledger.json"), {});
    }
    return run;
  };
  const restore = tag => {
    const run = join(cwd, tag);
    const result = expect(["resume-store", "restore", "--run-dir", run, ...opts]);
    return { run, result };
  };
  return { cwd, store, stored, checkpoint, json, load, prepareArgs, command, expect, create, restore };
}

test("outage publishes the next counter with the stash, replays byte-identically and carries it across drains", t => {
  const f = fixture(t);
  const a = f.create("A");
  const liveReview = f.checkpoint(a, "review-progress.json");
  const original = readFileSync(liveReview);
  f.json(join(f.stored, "spec-review-hold.json"), { unrelated: true });
  const args = f.prepareArgs(a);
  const first = f.expect(args);
  assert.deepEqual(first, {
    action: "hold", role: "awaiting-review", token: "retry-later",
    notice: "provider unavailable; build held; attempt 1/3; auto-resumes next drain",
  });
  assert.deepEqual(readFileSync(liveReview), original);
  assert.equal(f.load(join(f.stored, "review-progress.json")).outage_retries, 1);
  assert.equal(f.load(join(f.stored, "review-progress.json")).phase2.status, "in_flight");
  assert.deepEqual(f.load(join(f.stored, "spec-review-hold.json")), { unrelated: true });
  const published = readFileSync(join(f.stored, "hold.json"));
  assert.deepEqual(f.expect(args), first);
  assert.deepEqual(readFileSync(join(f.stored, "hold.json")), published);
  assert.ok(!existsSync(join(f.stored, "review-verdict.json")));

  const b = f.restore("B").run;
  assert.equal(f.load(f.checkpoint(b, "review-progress.json")).outage_retries, 1);
  const next = f.expect(f.prepareArgs(b, "review-outage", "--resumed"));
  assert.match(next.notice, /attempt 2\/3/);
  assert.equal(f.load(join(f.stored, "review-progress.json")).outage_retries, 2);
  assert.equal(f.expect(args).action, "stale");
  assert.equal(f.load(join(f.stored, "review-progress.json")).outage_retries, 2);
});

test("a torn store swap recovers before retry and a live lock spends no cycle", t => {
  const f = fixture(t);
  const a = f.create("A");
  f.expect(f.prepareArgs(a));
  const b = f.restore("B").run;
  const args = f.prepareArgs(b, "review-outage", "--resumed");
  const stage = join(f.store, "." + issue + ".stage");
  const old = join(f.store, "." + issue + ".old");
  mkdirSync(stage);
  const busy = f.command(args);
  assert.equal(busy.code, 4);
  assert.equal(f.load(join(f.stored, "review-progress.json")).outage_retries, 1);
  // Simulate interruption after swapping out the previous store, before
  // publishing the newly staged stores' counter and receipt.
  renameSync(f.stored, old);
  f.json(join(stage, "review-progress.json"), { issue, outage_retries: 2 });
  const past = new Date(Date.now() - 20 * 60 * 1000);
  utimesSync(stage, past, past);
  assert.match(f.expect(args).notice, /attempt 2\/3/);
  assert.match(f.expect(args).notice, /attempt 2\/3/);
  assert.equal(f.load(join(f.stored, "review-progress.json")).outage_retries, 2);
  assert.equal(f.load(f.checkpoint(b, "review-progress.json")).outage_retries, 1);
  assert.ok(!existsSync(old));
});

test("a damaged published hold does not replay as resumable or spend another cycle", t => {
  const f = fixture(t);
  const run = f.create("A");
  const args = f.prepareArgs(run);
  f.expect(args);
  const saved = readFileSync(join(f.stored, "hold.json"));
  rmSync(join(f.stored, "review-progress.json"));
  assert.equal(f.expect(args).reason, "published-outage-counter-missing-or-changed");
  assert.deepEqual(readFileSync(join(f.stored, "hold.json")), saved);
  assert.ok(!existsSync(join(f.stored, "review-progress.json")));
});

test("dialogue and outage use distinct caps and preserve the resumed judge state", t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, ".faffrc.yaml"), "graft:\n  build_review_hold_limit: 1\n  review_outage_retry_limit: 1\n");
  const source = f.create("A", true);
  const d = f.expect(f.prepareArgs(source, "build-review-dialogue", ...counters));
  assert.deepEqual(d, {
    action: "hold", role: "awaiting-adjudication", token: "built-but-not-admitted",
    notice: "build-review dialogue pending; held (1/1); auto-resumes next drain",
  });
  const { run: b, result } = f.restore("B");
  assert.deepEqual(result.dialogue, { hold_count: 1, next_round: 2, fix_rounds_used: 1, rebuttal_rounds_used: 0, stage: "judge" });
  assert.deepEqual(f.expect(f.prepareArgs(b, "build-review-dialogue", "--resumed", ...counters)), {
    action: "park", signal: "needs-human", reason: "build-review-holds-exhausted", clear_store: true,
  });
  const o = f.expect(f.prepareArgs(b, "review-outage", "--resumed", ...counters));
  assert.match(o.notice, /attempt 1\/1/);
  assert.equal(f.load(join(f.stored, "hold.json")).dialogue.hold_count, 1);
  const c = f.restore("C").run;
  assert.deepEqual(f.expect(f.prepareArgs(c, "review-outage", "--resumed", ...counters)), {
    action: "park", signal: "unavailable", reason: "review-outage-retries-exhausted", clear_store: true,
  });
});

test("missing initial and lost resumed holds differ, and corrupt evidence cannot publish a hold", t => {
  const f = fixture(t);
  const run = f.create("A");
  assert.equal(f.expect(f.prepareArgs(run, "review-outage", "--resumed")).reason, "resumed-hold-missing");
  const options = f.prepareArgs(run).map(x => x === "autonomous" ? "interactive" : x);
  assert.deepEqual(f.expect(options), { action: "park", signal: "unavailable", reason: "interactive-review", clear_store: false });
  const progress = f.checkpoint(run, "review-progress.json");
  const original = readFileSync(progress);
  rmSync(progress);
  assert.equal(f.expect(f.prepareArgs(run)).reason, "no-review-checkpoint");
  writeFileSync(progress, "{ bad");
  assert.equal(f.command(f.prepareArgs(run)).code, 2);
  writeFileSync(progress, original);
  f.json(f.checkpoint(run, "review-verdict.json"), { signal: "needs-human" });
  assert.equal(f.expect(f.prepareArgs(run)).reason, "terminal-review-verdict-present");
  rmSync(f.checkpoint(run, "review-verdict.json"));
  rmSync(f.checkpoint(run, "build-progress.json"));
  assert.equal(f.expect(f.prepareArgs(run)).reason, "no-build-checkpoint");
  assert.ok(!existsSync(f.stored));
});

test("a concurrent duplicate can retry without publishing a second hold", async t => {
  const f = fixture(t);
  const run = f.create("A");
  const args = f.prepareArgs(run);
  const invoke = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: f.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", data => { out += data; });
    child.stderr.on("data", data => { err += data; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, out, err }));
  });
  const responses = await Promise.all([invoke(), invoke()]);
  assert.ok(responses.some(r => r.code === 0));
  for (const r of responses) {
    assert.ok(r.code === 0 || r.code === 4, r.err);
    if (r.code === 0) assert.match(r.out, /attempt 1\/3/);
  }
  assert.match(f.expect(args).notice, /attempt 1\/3/);
  assert.equal(f.load(join(f.stored, "review-progress.json")).outage_retries, 1);
});
