import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { aggregate } from "../../plugin/skills/faffter-dark-spec-review/aggregate.mjs";
import { test } from "node:test";
import { faffBin } from "../helpers/run-cli.mjs";

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
    const choices = [{ delta: { content: reply(request.messages[1].content) }, finish_reason: "stop" }];
    res.end("data: " + JSON.stringify({ choices }) + "\n\ndata: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  writeFileSync(join(root, ".faffrc.yaml"), "adversarial:\n  backends:\n    - provider: openai\n      model: fixture\n      host: http://127.0.0.1:" + server.address().port + "/v1\n");
  writeFileSync(join(root, "spec.md"), "Keep all rows.\n");
  writeFileSync(join(root, "context.md"), "A named file.\n");
  let proc;
  return { root, requests, bodies, resume() { slow = false; }, cancel() { proc.kill("SIGTERM"); }, async call(...extra) {
    const child = spawn(process.execPath, [faffBin, "spec-review", "dispatch", "--spec", "spec.md", "--context", "./context.md",
      "--dir", "pin", "--root", root, ...extra], { cwd: root, env: { ...process.env, TMPDIR: root } });
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

test("healthy slow transport hands back without a verdict or pin, then resumes on the same round", async t => {
  const f = await fixture(t, true);
  const blocked = await f.call("--turn-budget-secs", "1");
  assert.equal(blocked.code, 124, blocked.stderr);
  assert.equal(blocked.stdout, "");
  assert.equal(f.requests.length, 1);
  for (const name of ["served-1.json", "pin-capture.json", "round-1.json"]) assert.equal(existsSync(join(f.root, "pin", name)), false);
  f.resume();
  const resumed = await f.call();
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout.split("\n")[1]).verdict, "approve");
  assert.equal(JSON.parse(readFileSync(join(f.root, "pin/served-1.json"))).round, 1);
});

for (const selected of [null, ["architectural", "QA", "infosec"]]) {
  test(`a partial retry retains the dissent and replaces only QA for ${selected?.join(",") ?? "the default lenses"}`, async t => {
    const f = await fixture(t, false, brief => {
      if (brief.includes("**architectural** spec refuter")) return "### major: Missing acceptance check\n- claim: Completion has no pass condition.";
      if (brief.includes("**QA** spec refuter")) return "### major: Missing claim";
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
    const dir = join(f.root, "pin");
    const chain = join(f.root, "chain.json"), results = join(f.root, "retry.json");
    writeFileSync(chain, JSON.stringify([JSON.parse(readFileSync(join(dir, "pinned-reviewer.json")))]));
    writeFileSync(results, JSON.stringify([{ lens: "QA", exit: 0, stdout: "## Adversarial findings — openai/fixture (chain[0], host: config)\n\n### observation: no findings\n", stderr: "", truncated: false }]));
    const retry = spawnSync(process.execPath, [faffBin, "spec-review", "record-results", "--dir", dir, "--round", "1", "--lenses", "QA",
      "--results", results, "--backends-json", chain, "--receipts-only"], { cwd: f.root, encoding: "utf8" });
    assert.equal(retry.status, 0, retry.stderr);
    const final = aggregate(votes.map(v => v.lens === "QA" ? JSON.parse(retry.stdout)[0] : v), votes.length);
    assert.equal(final.verdict, "revise");
    assert.deepEqual(final.objections.map(o => o.lens), ["architectural"]);
    assert.equal(f.requests.length, votes.length);
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
