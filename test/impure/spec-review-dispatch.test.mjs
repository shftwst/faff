import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aggregate } from "../../plugin/skills/faffter-dark-spec-review/aggregate.mjs";
import { test } from "node:test";
import { faffBin } from "../helpers/run-cli.mjs";

async function fixture(t, slow, reply = () => "### observation: no findings") {
  const root = mkdtempSync(join(tmpdir(), "faff-dispatch-wire-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET") return res.end('{"data":[{"id":"fixture"}]}');
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    const request = JSON.parse(Buffer.concat(parts));
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
  return { root, requests, resume() { slow = false; }, cancel() { proc.kill("SIGTERM"); }, async call(...extra) {
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

test("a partial retry retains the served dissent and replaces only the unavailable QA vote", async t => {
  const f = await fixture(t, false, brief => {
    if (brief.includes("**architectural** spec refuter")) return "### major: Missing acceptance check\n- claim: Completion has no pass condition.";
    if (brief.includes("**QA** spec refuter")) return "### major: Missing claim";
    return "### observation: no findings";
  });
  const outcome = await f.call();
  assert.equal(outcome.code, 0, outcome.stderr);
  assert.equal(JSON.parse(outcome.stdout.split("\n")[1]).verdict, "unavailable");
  const path = outcome.stderr.match(/carry prior lens entries from (.+)/)?.[1];
  assert.ok(path, outcome.stderr);
  const votes = JSON.parse(readFileSync(path));
  assert.equal(votes.length, 4);
  assert.equal(votes.find(v => v.lens === "QA").outcome, "unavailable");
  const dir = join(f.root, "pin");
  const chain = join(f.root, "chain.json"), results = join(f.root, "retry.json");
  writeFileSync(chain, JSON.stringify([JSON.parse(readFileSync(join(dir, "pinned-reviewer.json")))]));
  writeFileSync(results, JSON.stringify([{ lens: "QA", exit: 0, stdout: "## Adversarial findings — openai/fixture (chain[0], host: config)\n\n### observation: no findings\n", stderr: "", truncated: false }]));
  const retry = spawnSync(process.execPath, [faffBin, "spec-review", "record-results", "--dir", dir, "--round", "1", "--lenses", "QA",
    "--results", results, "--backends-json", chain, "--receipts-only"], { cwd: f.root, encoding: "utf8" });
  assert.equal(retry.status, 0, retry.stderr);
  const final = aggregate(votes.map(v => v.lens === "QA" ? JSON.parse(retry.stdout)[0] : v), 4);
  assert.equal(final.verdict, "revise");
  assert.deepEqual(final.objections.map(o => o.lens), ["architectural"]);
  assert.equal(f.requests.length, 4);
});

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
