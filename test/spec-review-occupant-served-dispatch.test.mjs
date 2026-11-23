// Exercise the serving identity that the spec-review window reads after a retry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { faffBin } from "./helpers/run-cli.mjs";
import { backendIdentity } from "../plugin/skills/faff/bin/lib/spec-review-pin.js";

const exec = promisify(execFile);
const json = file => JSON.parse(readFileSync(file, "utf8"));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "faff-occupant-dispatch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, ".faff", "config.yaml");
  mkdirSync(join(root, ".faff"));
  writeFileSync(config, "{}\n");
  writeFileSync(join(root, "spec.md"), "Keep every row.\n");
  const cli = async (...args) => (await exec(process.execPath, [faffBin, ...args], {
    cwd: root, env: { ...process.env, TMPDIR: root },
  })).stdout;
  const dir = join(root, "pin");
  const dispatch = (...selection) => cli("spec-review", "dispatch", "--dir", dir, "--root", root,
    "--spec", "spec.md", "--turn-budget-secs", "20", ...selection);
  return { root, dir, config, cli, dispatch };
}

test("the retry records its actual serving backend and leaves the original pin intact", async t => {
  const f = fixture(t);
  let available = "primary";
  const calls = [];
  const server = createServer(async (req, res) => {
    if (req.method === "GET") return res.end(JSON.stringify({ data: [{ id: available }] }));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks));
    calls.push(request.model);
    const content = request.model === "primary" ? "### major: Missing claim" : "### observation: no findings";
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end("data: " + JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const host = "http://127.0.0.1:" + server.address().port + "/v1";
  const backends = ["primary", "fallback"].map(model => ({ provider: "openai", model, host }));
  const rows = backends.map(({ model }) => "    - provider: openai\n      model: " + model + "\n      host: " + host);
  writeFileSync(f.config, ["adversarial:", "  backends:", ...rows, ""].join("\n"));

  const fresh = await f.dispatch("--enabled-lenses", "QA");
  assert.equal(JSON.parse(fresh.split("\n")[1]).verdict, "unavailable");
  const pinned = join(f.dir, "pinned-reviewer.json");
  assert.equal(backendIdentity(json(pinned)), backendIdentity(backends[0]));
  assert.equal(json(join(f.dir, "served-1.json")).served_identity, backendIdentity(backends[0]));
  writeFileSync(join(f.root, "verdict.md"), fresh);
  const decision = await f.cli("spec-review", "round", "--issue", "TEST-1", "--dir", f.dir, "--root", f.root,
    "--verdict-file", "verdict.md", "--mode", "autonomous", "--occupant", "adversarial", "--served", "any", "--json");
  assert.equal(JSON.parse(decision).action, "retry-outage");

  available = "fallback";
  const retry = await f.dispatch("--retry-lenses", "QA");
  assert.deepEqual(JSON.parse(retry), [{ lens: "QA", outcome: "clear", objections: [], model: "openai/fallback" }]);
  assert.deepEqual(calls, ["primary", "fallback"]);
  assert.equal(backendIdentity(json(pinned)), backendIdentity(backends[0]));
  assert.equal(json(join(f.dir, "served-2.json")).served_identity, backendIdentity(backends[1]));
  const governed = await f.cli("spec-review-window", "--govern", "--dir", f.dir, "--round", "2", "--any-served");
  assert.equal(JSON.parse(governed).action, "swap-reset");
});

test("an unconfigured retry returns unavailable receipts without pinning a reviewer", async t => {
  const f = fixture(t);
  const retry = JSON.parse(await f.dispatch("--retry-lenses", "QA"));
  assert.equal(retry.length, 1);
  assert.equal(retry[0].lens, "QA");
  assert.equal(retry[0].outcome, "unavailable");
  assert.equal(retry[0].kind, "config-fault");
  assert.equal(existsSync(join(f.dir, "pinned-reviewer.json")), false);
  assert.equal(json(join(f.dir, "pin-capture.json")).state, "skipped-no-lens");
});
