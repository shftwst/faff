// FAFF-1244: real-transport regression: a build-judge dispatch against a backend that trickles SSE
// comments forever must end bounded. Drives cmdAssemble with an injected chain and a 2s judge clock
// but the REAL runReviewCall and judgeDispatchDisposition, so the argv threading, the --deadline
// exit 8 and the retry disposition are all exercised end to end. The server lives in its own
// process because realRunReviewCall is synchronous and would starve an in-process server.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bje = require("../../plugin/skills/faff/bin/lib/build-judge-evidence.js");

const SERVER_SRC = `
const http = require("node:http");
let posts = 0;
const timers = new Set();
const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/count") { res.end(String(posts)); return; }
  if (req.method === "GET") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "A" }] }));
    return;
  }
  req.resume();
  req.on("end", () => {
    posts++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": keepalive\\n\\n");
    const iv = setInterval(() => { if (!res.destroyed) res.write(": keepalive\\n\\n"); }, 50);
    timers.add(iv);
    res.on("close", () => { clearInterval(iv); timers.delete(iv); });
  });
});
server.listen(0, "127.0.0.1", () => { console.log(server.address().port); });
`;

function startServer() {
  const child = spawn(process.execPath, ["-e", SERVER_SRC], { stdio: ["ignore", "pipe", "inherit"] });
  const port = new Promise((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (c) => { buf += c; const m = buf.match(/^(\d+)\n/); if (m) resolve(Number(m[1])); });
    child.on("error", reject);
    child.on("exit", () => reject(new Error("fake server exited before listening")));
  });
  return { child, port };
}

function getText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let b = ""; res.on("data", (c) => { b += c; }); res.on("end", () => resolve(b)); }).on("error", reject);
  });
}

test("FAFF-1244: a trickling one-backend chain parks with an (exit 8) cause after the retries, bounded", async () => {
  const savedRunDir = process.env.FAFF_RUN_DIR;
  delete process.env.FAFF_RUN_DIR; // an inherited L4 run ledger would remap exit 8 to 9
  const tmp = mkdtempSync(join(tmpdir(), "faff-1244-"));
  const server = startServer();
  try {
    const port = await server.port;
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({
      signal: "needs-human",
      findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }],
      author_replies: [],
    }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const judgeDir = join(tmp, "judge");
    const t0 = Date.now();
    const code = await Promise.resolve(bje.cmdAssemble(
      { "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir, "--retry-limit": "1" },
      {
        resolveAdversarialBackends: () => ({ chain: [{ provider: "openai", model: "A", host: `http://127.0.0.1:${port}/v1` }] }),
        resolveBuildJudgeClock: () => ({ deadline: 2, timeout: 120 }),
      },
    ));
    const elapsed = Date.now() - t0;
    assert.equal(code, 0);
    assert.ok(elapsed < 12000, `cmdAssemble took ${elapsed}ms`);
    assert.equal(await getText(`http://127.0.0.1:${port}/count`), "2", "exactly two Phase-1 POSTs (one retry)");
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    assert.equal(ledger.entries["f-01"].resolution, "parked");
    assert.equal(ledger.entries["f-01"].park_cause, 'phase-1 dispatch disposition "retry" (exit 8)');
    assert.deepEqual(readdirSync(judgeDir).filter((f) => /^ruling-.*\.json$/.test(f)), []);
  } finally {
    if (savedRunDir === undefined) delete process.env.FAFF_RUN_DIR; else process.env.FAFF_RUN_DIR = savedRunDir;
    server.child.kill("SIGKILL");
    rmSync(tmp, { recursive: true, force: true });
  }
});
