import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { aggregate } from "../../plugin/skills/faffter-dark-spec-review/aggregate.mjs";
import { test } from "node:test";
import { faffBin, runCli } from "../helpers/run-cli.mjs";

async function fixture(t, slow, reply = () => "### observation: no findings") {
  const root = mkdtempSync(join(tmpdir(), "faff-dispatch-wire-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const requests = [], bodies = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET") return res.end('{"data":[{"id":"fixture"}]}');
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    const body = Buffer.concat(parts);
    bodies.push(body);
    const request = JSON.parse(body);
    requests.push(request);
    if (slow) return;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const choices = [{ delta: { content: await reply(request.messages[1].content) }, finish_reason: "stop" }];
    res.end("data: " + JSON.stringify({ choices }) + "\n\ndata: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  writeFileSync(join(root, ".faffrc.yaml"), "adversarial:\n  backends:\n    - provider: openai\n      model: fixture\n      host: http://127.0.0.1:" + server.address().port + "/v1\n");
  writeFileSync(join(root, "spec.md"), "Keep all rows.\n");
  writeFileSync(join(root, "context.md"), "A named file.\n");
  let proc;
  const env = { ...process.env, TMPDIR: root };
  return { root, requests, bodies, env, pinDir: "pin", cancel() { proc.kill("SIGTERM"); }, async call(...extra) {
    const child = spawn(process.execPath, [faffBin, "spec-review", "dispatch", "--spec", "spec.md", "--context", "./context.md",
      "--dir", this.pinDir, "--root", root, ...extra], { cwd: root, env });
    proc = child;
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const [code] = await once(child, "close");
    return { code, stdout, stderr };
  } };
}

test("complete dispatch preserves literal context paths, independent lenses, served identity and verdict", async t => {
  const f = await fixture(t, false);
  const result = await f.call("--turn-budget-secs", "20");
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.split("\n")[1]), { verdict: "approve", objections: [] });
  assert.match(result.stderr, /served 4\/4/);
  assert.equal(f.requests.length, 4);
  const prefix = f.requests[0].messages[0].content;
  assert.match(prefix, /<file path="\.\/context\.md">/);
  assert.ok(f.requests.every(r => r.messages[0].content === prefix));
  assert.equal(new Set(f.requests.map(r => r.messages[1].content)).size, 4);
  const dir = join(f.root, "pin");
  assert.equal(JSON.parse(readFileSync(join(dir, "served-1.json"))).winner_index, 0);
  for (const lens of ["architectural", "infosec", "methodology", "QA"]) assert.ok(existsSync(join(dir, "round-1-" + lens + ".md")));
  assert.equal(existsSync(join(dir, "round-1.json")), false);
});

for (const [lenses, expected] of [
  [["QA"], "reject-approach"],
  [["infosec", "QA"], "revise"],
  [["QA", "architectural", "infosec"], "reject-approach"],
  [["methodology", "QA", "infosec", "architectural"], "revise"],
]) {
  test(`fresh selection ${lenses} matches the separate commands on the wire, in receipts and in its verdict`, async t => {
    const f = await fixture(t, false, brief => /\*\*(QA|architectural)\*\* spec refuter/.test(brief)
      ? "### major: Missing acceptance check\n- claim: Completion has no pass condition." : "### observation: clear");
    appendFileSync(join(f.root, ".faffrc.yaml"), "  spec_review:\n    dispatch_strategy: serial\n");
    const csv = lenses.join(",");
    const opts = { cwd: f.root, env: { ...process.env, TMPDIR: f.root } };
    const run = async (...args) => (await promisify(execFile)(process.execPath, args, opts)).stdout;
    const skills = join(dirname(faffBin), "../..");
    const descriptor = JSON.parse(await run(faffBin, "spec-review", "prepare-requests", "--dir", "pin", "--spec", "spec.md",
      "--context", "./context.md", "--root", f.root, "--lenses", csv));
    const results = await run(join(skills, "faffter-dark-adversarial-review/fan-out.mjs"),
      "--requests", descriptor.requests_path, "--strategy", descriptor.strategy);
    const raw = join(f.root, "results.json");
    writeFileSync(raw, results);
    const subset = lenses.length < 4;
    let baseline = await run(faffBin, "spec-review", "record-results", "--dir", "pin", "--round", String(descriptor.round),
      "--results", raw, "--backends-json", descriptor.backends_path, "--lenses", csv, ...(subset ? ["--receipts-only"] : []));
    if (subset) {
      const final = spawnSync(process.execPath, [join(skills, "faffter-dark-spec-review/aggregate.mjs")], {
        ...opts, input: JSON.stringify({ enabled_lenses: lenses, refutations: JSON.parse(baseline) }), encoding: "utf8",
      });
      assert.equal(final.status, 0, final.stderr);
      baseline = final.stdout;
    }
    renameSync(join(f.root, "pin"), join(f.root, "before"));

    const combined = await f.call("--enabled-lenses", csv);
    assert.equal(combined.code, 0, combined.stderr);
    assert.equal(combined.stdout, baseline);
    assert.equal(JSON.parse(combined.stdout.split("\n")[1]).verdict, expected);
    assert.ok(combined.stderr.includes(`served ${lenses.length}/${lenses.length}`));
    assert.equal(f.bodies.length, lenses.length * 2);
    assert.deepEqual(f.bodies.slice(lenses.length), f.bodies.slice(0, lenses.length));
    assert.deepEqual(f.requests.slice(lenses.length).map(r => r.messages[1].content.match(/\*\*(\w+)\*\* spec refuter/)[1]), lenses);
    const before = join(f.root, "before"), after = join(f.root, "pin");
    assert.deepEqual(readdirSync(after, { recursive: true }).sort(), readdirSync(before, { recursive: true }).sort());
    for (const name of readdirSync(before, { recursive: true })) {
      if (name === "raw") continue;
      const left = readFileSync(join(before, name), "utf8"), right = readFileSync(join(after, name), "utf8");
      if (name === "pin-capture.json" || name === "served-1.json") {
        const a = JSON.parse(left), b = JSON.parse(right);
        assert.ok(Number.isFinite(Date.parse(a.ts)) && Number.isFinite(Date.parse(b.ts)));
        assert.deepEqual({ ...b, ts: a.ts }, a);
      } else {
        assert.equal(right, left, name);
      }
    }
  });
}

test("a completed four-lens rejection survives a lingering fan-out handle", async t => {
  const claim = "A".repeat(128 * 1024);
  const f = await fixture(t, false, () => "### major: Missing acceptance check\n- claim: " + claim);
  const preload = join(f.root, "lingering-handle.cjs");
  writeFileSync(preload, 'if (require("node:path").basename(process.argv[1] || "") === "fan-out.mjs") setInterval(() => {}, 60000);');
  f.env.NODE_OPTIONS = [f.env.NODE_OPTIONS, '--require "' + preload + '"'].filter(Boolean).join(" ");
  const result = await f.call("--turn-budget-secs", "8");
  assert.equal(f.requests.length, 4);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.split("\n")[1]).verdict, "reject-approach");
  for (const lens of ["architectural", "infosec", "methodology", "QA"]) {
    assert.ok(readFileSync(join(f.root, "pin", "round-1-" + lens + ".md"), "utf8").includes(claim));
  }
});

test("healthy slow transport hands back without a verdict or pin, then resumes on the same round", async t => {
  const f = await fixture(t, false, async () => {
    await delay(1600);
    return "### major: Missing acceptance check\n- claim: Completion has no pass condition.";
  });
  const selection = ["--enabled-lenses", "QA"];
  const blocked = await f.call(...selection, "--turn-budget-secs", "1");
  assert.equal(blocked.code, 124, blocked.stderr);
  assert.equal(blocked.stdout, "");
  assert.equal(f.requests.length, 1);
  for (const name of ["served-1.json", "pin-capture.json", "round-1.json"]) assert.equal(existsSync(join(f.root, "pin", name)), false);
  const resumed = await f.call(...selection, "--turn-budget-secs", "15");
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout.split("\n")[1]).verdict, "reject-approach");
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.bodies[0], f.bodies[1]);
  assert.equal(JSON.parse(readFileSync(join(f.root, "pin/served-1.json"))).round, 1);
});

function ownedRun(f, name) {
  const dir = join(f.root, ".faff", "runs", name);
  mkdirSync(dir, { recursive: true });
  const old = new Date(Date.now() - 60000).toISOString();
  writeFileSync(join(dir, "run-ledger.json"), JSON.stringify({
    run_id: name, admitted: [], outcomes: {}, owner: { status: "running", started_at: old, last_heartbeat: old },
  }));
  return dir;
}

function checkStall(f, dir) {
  const check = runCli(["sentry", "check", "--root", f.root, "--run-dir", dir, "--json"], { cwd: f.root, env: f.env });
  assert.equal(check.code, 0, check.stderr);
  return JSON.parse(check.stdout).verdicts.find(v => v.signal === "wall-clock-runaway")?.evidence.tripped_on;
}

for (const retry of [false, true]) {
  test(`a quiet ${retry ? "retry" : "fresh review"} keeps its exact parent live across the stall window`, async t => {
    let release;
    const quiet = new Promise(resolve => { release = resolve; });
    const f = await fixture(t, false, async () => { await quiet; return "### observation: clear"; });
    appendFileSync(join(f.root, ".faffrc.yaml"), "sentry:\n  stall_window_secs: 1\n");
    const parent = ownedRun(f, "owner"), peer = ownedRun(f, "peer");
    f.env.FAFF_RUN_DIR = peer;
    f.pinDir = join(parent, "ABC-1", "spec-review");
    assert.equal(checkStall(f, parent), "heartbeat-staleness");
    const flags = [retry ? "--retry-lenses" : "--enabled-lenses", "QA"];
    const waiting = f.call(...flags, "--turn-budget-secs", "30", "--run-dir", parent);
    try {
      const deadline = Date.now() + 10000;
      while (!f.requests.length && Date.now() < deadline) await delay(20);
      assert.equal(f.requests.length, 1);
      const initial = readFileSync(join(parent, "heartbeat"), "utf8");
      await delay(1600);
      assert.notEqual(readFileSync(join(parent, "heartbeat"), "utf8"), initial);
      assert.equal(checkStall(f, parent), undefined);
      assert.equal(checkStall(f, peer), "heartbeat-staleness");
    } finally { release(); }
    const result = await waiting;
    assert.equal(result.code, 0, result.stderr);
    if (retry) assert.deepEqual(JSON.parse(result.stdout).map(v => [v.lens, v.outcome]), [["QA", "clear"]]);
    else assert.deepEqual(JSON.parse(result.stdout.split("\n")[1]), { verdict: "approve", objections: [] });
    assert.equal(f.requests.length, 1);
    assert.equal(existsSync(join(parent, "heartbeat.ABC-1")), false);
    assert.equal(existsSync(join(peer, "heartbeat")), false);
    assert.equal(existsSync(join(parent, "events.ndjson")), false);
    const final = readFileSync(join(parent, "heartbeat"), "utf8");
    await delay(1500);
    assert.equal(readFileSync(join(parent, "heartbeat"), "utf8"), final);
    assert.equal(checkStall(f, parent), "heartbeat-staleness");
  });
}

test("standalone reviews ignore ambient runs and a terminal owner cannot be revived", async t => {
  const f = await fixture(t, false);
  const parent = ownedRun(f, "owner");
  f.env.FAFF_RUN_DIR = parent;
  const standalone = await f.call("--enabled-lenses", "QA", "--turn-budget-secs", "15");
  assert.equal(standalone.code, 0, standalone.stderr);
  assert.equal(existsSync(join(parent, "heartbeat")), false);
  writeFileSync(join(parent, "run-ledger.json"), JSON.stringify({ owner: { status: "done" } }));
  f.pinDir = join(parent, "ABC-1", "spec-review");
  const finished = await f.call("--retry-lenses", "QA", "--turn-budget-secs", "15", "--run-dir", parent);
  assert.equal(finished.code, 0, finished.stderr);
  assert.equal(existsSync(join(parent, "heartbeat")), false);
});

test("the outer budget expires even with a fresh heartbeat during a quiet retry", async t => {
  const f = await fixture(t, true);
  const parent = ownedRun(f, "owner");
  f.pinDir = join(parent, "ABC-1", "spec-review");
  const outcome = await f.call("--retry-lenses", "QA", "--turn-budget-secs", "2", "--run-dir", parent);
  assert.equal(outcome.code, 124, outcome.stderr);
  assert.equal(outcome.stdout, "");
  assert.equal(f.requests.length, 1);
  assert.ok(existsSync(join(parent, "heartbeat")));
  for (const name of ["served-1.json", "round-1.json", "pin-capture.json"]) assert.equal(existsSync(join(f.pinDir, name)), false);
});

for (const selected of [null, ["architectural", "QA", "infosec"]]) {
  test(`a partial retry retains the dissent and replaces only QA for ${selected?.join(",") ?? "the default lenses"}`, async t => {
    let qaRecovered = false;
    const f = await fixture(t, false, brief => {
      if (brief.includes("**architectural** spec refuter")) return "### major: Missing acceptance check\n- claim: Completion has no pass condition.";
      if (!qaRecovered && brief.includes("**QA** spec refuter")) return "### major: Missing claim";
      return "### observation: no findings";
    });
    const outcome = await f.call(...(selected ? ["--enabled-lenses", selected.join(",")] : []));
    assert.equal(outcome.code, 0, outcome.stderr);
    assert.equal(JSON.parse(outcome.stdout.split("\n")[1]).verdict, "unavailable");
    const path = outcome.stderr.match(/carry prior lens entries from (.+)/)?.[1];
    assert.ok(path, outcome.stderr);
    const votes = JSON.parse(readFileSync(path));
    assert.deepEqual(votes.map(v => v.lens), selected ?? ["architectural", "infosec", "methodology", "QA"]);
    assert.equal(votes.find(v => v.lens === "QA").outcome, "unavailable");
    qaRecovered = true;
    const retry = await f.call("--retry-lenses", "QA", "--turn-budget-secs", "20");
    assert.equal(retry.code, 0, retry.stderr);
    const final = aggregate(votes.map(v => v.lens === "QA" ? JSON.parse(retry.stdout)[0] : v), votes.length);
    assert.equal(final.verdict, "revise");
    assert.deepEqual(final.objections.map(o => o.lens), ["architectural"]);
    assert.equal(f.requests.length, votes.length + 1);
    const originalQA = f.requests.findIndex(r => r.messages[1].content.includes("**QA** spec refuter"));
    assert.deepEqual(f.bodies.at(-1), f.bodies[originalQA]);
  });
}

test("cancelling the caller without a turn budget stops a live fan-out", async t => {
  const f = await fixture(t, true);
  const outcome = f.call();
  const until = Date.now() + 15000;
  while (f.requests.length === 0 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
  f.cancel();
  assert.equal((await outcome).code, 130);
  assert.equal(f.requests.length, 1);
  assert.equal(existsSync(join(f.root, "pin/pin-capture.json")), false);
});

test("a fresh decision matches ordinary dispatch and round, including served-but-unavailable votes", async t => {
  const f = await fixture(t, false, brief => brief.includes("**QA** spec refuter")
    ? "### major: Missing claim" : "### observation: no findings");
  delete f.env.FAFF_RUN_DIR;
  const issue = "ABC-1";
  f.pinDir = join(f.root, ".faff", "spec-review", issue);
  const flags = ["--enabled-lenses", "QA,architectural", "--turn-budget-secs", "20"];
  const split = await f.call(...flags);
  assert.equal(split.code, 0, split.stderr);
  const out = join(f.root, "returned.md");
  writeFileSync(out, split.stdout);
  const decision = runCli(["spec-review", "round", "--issue", issue, "--dir", f.pinDir, "--root", f.root,
    "--mode", "autonomous", "--occupant", "adversarial", "--served", "any", "--verdict-file", out, "--json"], { cwd: f.root, env: f.env });
  assert.equal(decision.code, 0, decision.stderr);
  const before = join(f.root, "before");
  renameSync(f.pinDir, before);
  const combined = await f.call(...flags, "--record-round", "autonomous", "--issue", issue);
  assert.equal(combined.code, 0, combined.stderr);
  const { retry_entries, ...actual } = JSON.parse(combined.stdout);
  assert.deepEqual(actual, JSON.parse(decision.stdout));
  assert.equal(actual.action, "retry-outage");
  assert.deepEqual(actual.outaged_lenses, ["QA"]);
  assert.deepEqual(JSON.parse(readFileSync(retry_entries)).map(row => [row.lens, row.outcome]),
    [["QA", "unavailable"], ["architectural", "clear"]]);
  assert.deepEqual(JSON.parse(readFileSync(join(f.pinDir, "decision-1.json"))), JSON.parse(combined.stdout));
  for (const name of ["round-1.json", "round-1-QA.md", "round-1-architectural.md"]) {
    assert.equal(readFileSync(join(f.pinDir, name), "utf8"), readFileSync(join(before, name), "utf8"), name);
  }
  assert.deepEqual(f.bodies.slice(2), f.bodies.slice(0, 2));
});

test("a recorded review scopes its marker to the explicit parent and hands a deadline back without a decision", async t => {
  const f = await fixture(t, true);
  const parent = ownedRun(f, "owner"), peer = ownedRun(f, "peer");
  f.env.FAFF_RUN_DIR = peer;
  const issue = "ABC-1";
  f.pinDir = join(parent, issue, "spec-review");
  const marker = (runDir, ...args) => runCli(["inflightcheck", ...args, "--root", f.root],
    { cwd: f.root, env: { ...f.env, FAFF_RUN_DIR: runDir } });
  assert.equal(marker(parent, "--open", "--key", issue, "--describe", "prep").code, 0);
  appendFileSync(join(f.root, ".faffrc.yaml"), "prep:\n  spec_review_turn_budget_secs: 2\n");
  const waiting = f.call("--record-round", "autonomous", "--issue", issue, "--enabled-lenses", "QA", "--run-dir", parent);
  const until = Date.now() + 10000;
  while (!f.requests.length && Date.now() < until) await delay(20);
  assert.equal(f.requests.length, 1);
  const active = JSON.parse(marker(parent, "--json").stdout).open;
  assert.equal(active.length, 2);
  assert.ok(active.includes(issue));
  assert.ok(active.some(k => k.startsWith("spec-review.ABC-1.")));
  assert.deepEqual(JSON.parse(marker(peer, "--json").stdout).open, []);
  const result = await waiting;
  assert.equal(result.code, 124, result.stderr);
  assert.equal(result.stdout, "");
  assert.ok(existsSync(join(parent, "heartbeat")));
  assert.ok(!existsSync(join(peer, "heartbeat")));
  assert.deepEqual(JSON.parse(marker(parent, "--json").stdout).open, [issue]);
  for (const name of ["round-1.json", "decision-1.json", "served-1.json"]) assert.ok(!existsSync(join(f.pinDir, name)));
});

test("overlapping fresh dispatches cannot attach the losing batch to another round", async t => {
  let release;
  const quiet = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, false, async () => { await quiet; return "### observation: no findings"; });
  delete f.env.FAFF_RUN_DIR;
  f.pinDir = join(f.root, ".faff", "spec-review", "ABC-1");
  const args = ["--record-round", "interactive", "--issue", "ABC-1", "--enabled-lenses", "QA", "--turn-budget-secs", "20"];
  const both = Promise.all([f.call(...args), f.call(...args)]);
  try {
    const until = Date.now() + 10000;
    while (f.requests.length < 2 && Date.now() < until) await delay(20);
    assert.equal(f.requests.length, 2);
  } finally { release(); }
  const results = await both;
  assert.deepEqual(results.map(r => r.code).sort(), [0, 2]);
  assert.equal(JSON.parse(results.find(r => r.code === 0).stdout).action, "approve");
  assert.match(results.find(r => r.code === 2).stderr, /another caller advanced round 1/);
  assert.ok(!existsSync(join(f.pinDir, "decision-2.json")));
  assert.ok(!existsSync(join(f.pinDir, "round-1-QA.retry-1.md")));
});

const stagedReviewBody = "# Keep rows\n\n**Chosen:** Keep each row.\nconfidence: high\n\n```faff-contract:spec-readiness\n" +
    '{"confidence":"high","decisions":[{"marker":"chosen"}]}\n```\n';

test("fresh recorded approval prepares an attachment only from the bytes sent to all lenses", async t => {
  const f = await fixture(t, false);
  delete f.env.FAFF_RUN_DIR;
  f.env.FAFF_SESSION_ID = "dispatch-owner";
  const issue = "ABC-1";
  f.pinDir = join(f.root, ".faff", "spec-review", issue);
  mkdirSync(join(f.root, ".faff"), { recursive: true });
  const source = join(f.root, "spec.md");
  writeFileSync(source, stagedReviewBody);
  const staged = runCli(["prep", "attach", "--git-only", "--issue", issue, "--spec", source,
    "--mode", "autonomous", "--json"], { cwd: f.root, env: f.env });
  assert.equal(staged.code, 0, staged.stderr);
  const sha = JSON.parse(staged.stdout).spec_sha256;
  const selected = ["--enabled-lenses", "QA,architectural,infosec,methodology"];
  const args = [...selected, "--record-round", "autonomous", "--issue", issue, "--prepare-attachment"];
  const refused = await f.call(...args, "0".repeat(64));
  assert.equal(refused.code, 2, refused.stderr);
  assert.equal(f.requests.length, 0);
  assert.ok(!existsSync(join(f.pinDir, "round-1.json")));

  renameSync(source, source + ".moved");
  const missing = await f.call(...args, sha);
  assert.equal(missing.code, 2, missing.stderr);
  assert.equal(f.requests.length, 0);
  assert.ok(!existsSync(join(f.pinDir, "decision-1.json")));
  renameSync(source + ".moved", source);

  const ordinary = await f.call(...selected);
  assert.equal(ordinary.code, 0, ordinary.stderr);
  const verdict = join(f.root, "ordinary.md");
  writeFileSync(verdict, ordinary.stdout);
  const split = runCli(["spec-review", "round", "--issue", issue, "--dir", f.pinDir, "--root", f.root,
    "--mode", "autonomous", "--occupant", "adversarial", "--served", "any", "--verdict-file", verdict,
    "--prepare-attachment", sha, "--json"], { cwd: f.root, env: f.env });
  assert.equal(split.code, 0, split.stderr);
  const prior = JSON.parse(split.stdout);
  assert.equal(prior.attachment.status, "prepared", prior.attachment.reason);
  const ordinarySpec = readFileSync(prior.attachment.spec_path);
  const ordinaryBodies = f.bodies.splice(0).map(bytes => bytes.toString()).sort();
  assert.equal(ordinaryBodies.length, 4);
  renameSync(f.pinDir, join(f.root, "ordinary-round"));

  const result = await f.call(...args, sha);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(f.bodies.map(bytes => bytes.toString()).sort(), ordinaryBodies);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.action, "approve");
  assert.equal(decision.attachment.status, "prepared", decision.attachment.reason);
  assert.deepEqual(readFileSync(decision.attachment.spec_path), ordinarySpec);
  assert.equal(JSON.parse(readFileSync(join(f.pinDir, "decision-1.json"))).attachment.spec_path,
    decision.attachment.spec_path);
});

test("a live spec edit between independent lenses cannot change their input or prepare an attachment", async t => {
  const f = await fixture(t, false, () => {
    writeFileSync(join(f.root, "spec.md"), "Edited after the first lens read.\n");
    return "### observation: no findings";
  });
  delete f.env.FAFF_RUN_DIR;
  f.env.FAFF_SESSION_ID = "changing-spec";
  const issue = "ABC-1";
  mkdirSync(join(f.root, ".faff"), { recursive: true });
  f.pinDir = join(f.root, ".faff", "spec-review", issue);
  const source = join(f.root, "spec.md");
  writeFileSync(source, stagedReviewBody);
  const staged = runCli(["prep", "attach", "--git-only", "--issue", issue, "--spec", source,
    "--mode", "autonomous", "--json"], { cwd: f.root, env: f.env });
  assert.equal(staged.code, 0, staged.stderr);
  const checked = JSON.parse(staged.stdout);
  const result = await f.call("--record-round", "autonomous", "--issue", issue,
    "--enabled-lenses", "QA,architectural", "--prepare-attachment", checked.spec_sha256);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(f.requests.length, 2);
  for (const req of f.requests) {
    assert.match(req.messages[0].content, /Keep each row/);
    assert.doesNotMatch(req.messages[0].content, /Edited after/);
  }
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.attachment.status, "stale", JSON.stringify(decision.attachment));
});
