// FAFF-1228: real-subprocess check that an empty 200 (reasoning-only deltas, finish_reason "length") is
// retained with its completion record. Runs review-call.mjs against an in-process 127.0.0.1 server whose
// model A streams 200 characters of delta.reasoning, a length finish and [DONE] on every chat POST, so the
// length re-call also comes back empty and the one-element chain exhausts to exit 11.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const REVIEW_CALL = path.resolve(import.meta.dirname, "../../plugin/skills/faffter-dark-adversarial-review/review-call.mjs");
const REASONING = "r".repeat(100) + "q".repeat(100);   // 200 characters, split over two frames
const frame = (o) => `data: ${JSON.stringify(o)}\n\n`;
const BODY = frame({ choices: [{ delta: { reasoning: REASONING.slice(0, 100) } }] })
  + frame({ choices: [{ delta: { reasoning: REASONING.slice(100) } }] })
  + frame({ choices: [{ delta: {}, finish_reason: "length" }] })
  + "data: [DONE]\n\n";

test("FAFF-1228: an empty 200 with reasoning-only deltas and finish_reason length is retained with its completion record (exit 11)", async () => {
  const budgets = [];
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "A" }] }));
      return;
    }
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      budgets.push(JSON.parse(raw).max_tokens);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(BODY);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = `http://127.0.0.1:${server.address().port}/v1`;
  const dir = mkdtempSync(path.join(tmpdir(), "faff-1228-"));
  let child;
  let guard;
  try {
    const rawDir = path.join(dir, "raw");
    writeFileSync(path.join(dir, "backends.json"), JSON.stringify([{ provider: "openai", model: "A", host }]));
    writeFileSync(path.join(dir, "system.txt"), "s");
    writeFileSync(path.join(dir, "diff.txt"), "d");
    mkdirSync(rawDir);
    child = spawn(process.execPath, [REVIEW_CALL, "--backends-json", path.join(dir, "backends.json"), "--system", path.join(dir, "system.txt"), "--diff", path.join(dir, "diff.txt"),
      "--raw-dir", rawDir, "--lens", "QA", "--round", "1", "--max-tokens", "100"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    guard = setTimeout(() => child.kill("SIGKILL"), 10000);
    const code = await new Promise((resolve) => child.on("exit", (c) => resolve(c)));

    assert.equal(code, 11, `stderr: ${stderr}`);
    assert.deepEqual(budgets, [100, 200], "first attempt then the length re-call at double the budget");
    const files = readdirSync(rawDir);
    assert.deepEqual(files, ["round-1.QA.0-openai-A.empty.txt"]);
    const file = readFileSync(path.join(rawDir, files[0]), "utf8");
    const preamble = file.slice(0, file.indexOf("# ---\n"));
    for (const l of ["# finish_reason: length", "# done: true", "# content_len: 0", "# reasoning_len: 200", "# length_retried: true"]) {
      assert.ok(preamble.split("\n").includes(l), `preamble has ${l}`);
    }
    const exhausted = stderr.split("\n").find((l) => l.startsWith("exhausted: openai/A produced non-findings output (empty content) (exit 11)"));
    assert.ok(exhausted, `stderr: ${stderr}`);
    assert.ok(exhausted.endsWith(" finish_reason=length done=true reasoning_len=200 content_len=0"), exhausted);
    assert.ok(!file.includes("rrrrr") && !file.includes("qqqqq"), "no reasoning text in the raw file");
    assert.ok(!stderr.includes("rrrrr") && !stderr.includes("qqqqq"), "no reasoning text on stderr");
  } finally {
    clearTimeout(guard);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
