// FAFF-1239: real-subprocess regression: a served fallback review must exit 0 promptly even though the
// slice-exhausted primary was still trickling bytes. Runs review-call.mjs against an in-process 127.0.0.1
// server where model A trickles SSE comments forever and model B serves findings. Without the per-element
// abort the child outlives main (A's socket stays open); the exit backstop would hide that only after
// about 2s, so the 3000ms bound here proves the leak fix, not the backstop.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const REVIEW_CALL = path.resolve(import.meta.dirname, "../../plugin/skills/faffter-dark-adversarial-review/review-call.mjs");
const OK_BODY = `data: ${JSON.stringify({ choices: [{ delta: { content: "### observation: no findings" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;

async function runCase(firstByteTimeout) {
  const intervals = new Set();
  const state = { aClosedAt: null };
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "A" }, { id: "B" }] }));
      return;
    }
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const model = JSON.parse(raw).model;
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (model === "A") {
        res.on("close", () => { if (state.aClosedAt === null) state.aClosedAt = Date.now(); });
        res.write(": keepalive\n\n");
        const iv = setInterval(() => { if (!res.destroyed) res.write(": keepalive\n\n"); }, 50);
        intervals.add(iv);
        res.on("close", () => clearInterval(iv));
      } else {
        res.end(OK_BODY);
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = `http://127.0.0.1:${server.address().port}/v1`;
  const dir = mkdtempSync(path.join(tmpdir(), "faff-1239-"));
  let child;
  let guard;
  try {
    const mk = (model) => ({ provider: "openai", model, host, ...(firstByteTimeout === undefined ? {} : { first_byte_timeout: firstByteTimeout }) });
    writeFileSync(path.join(dir, "backends.json"), JSON.stringify([mk("A"), mk("B")]));
    writeFileSync(path.join(dir, "system.txt"), "s");
    writeFileSync(path.join(dir, "diff.txt"), "d");
    const t0 = Date.now();
    child = spawn(process.execPath, [REVIEW_CALL, "--backends-json", path.join(dir, "backends.json"), "--system", path.join(dir, "system.txt"), "--diff", path.join(dir, "diff.txt"), "--deadline", "2"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    guard = setTimeout(() => child.kill("SIGKILL"), 10000);
    const { code, exitedAt } = await new Promise((resolve) => child.on("exit", (c) => resolve({ code: c, exitedAt: Date.now() })));
    return { code, stdout, stderr, elapsed: exitedAt - t0, exitedAt, aClosedAt: state.aClosedAt };
  } finally {
    clearTimeout(guard);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    for (const iv of intervals) clearInterval(iv);
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertServed(r) {
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /### observation: no findings/);
  assert.doesNotMatch(r.stderr, /process still alive/);
  assert.ok(r.aClosedAt !== null && r.aClosedAt <= r.exitedAt, "A's request closed before the child exited");
  assert.ok(r.elapsed < 3000, `child exited in ${r.elapsed}ms`);
}

test("FAFF-1239: a served fallback exits 0 promptly while the abandoned primary was trickling (first-byte window enabled)", async () => {
  assertServed(await runCase(undefined));
});

test("FAFF-1239: the same with first_byte_timeout: 0 on both backends", async () => {
  assertServed(await runCase(0));
});
