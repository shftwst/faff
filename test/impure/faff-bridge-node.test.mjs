// FAFF-1104 (impure) — faff-bridge-node.mjs end-to-end over a REAL TCP listener.
// Spawns the bridge as an actual process against a temp SUT module + manifest, then
// drives the frozen wire (open/call/call_static/close + health) over HTTP, asserting
// the conformance list from docs/reference/session-rpc-wire.md. Real subprocess +
// real socket, so this lives under test/impure/ (macOS + linux env-rootless lanes).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Acquire an OS-assigned free port (bind :0, read it, release). Removes the random-guess
// collision that made this real-listener test flaky under the concurrent sharded UNIT rung.
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(HERE, "..", "..", "plugin", "skills", "faff", "bin", "faff-bridge-node.mjs");
const W = "faff.session-rpc/1";

let dir, proc, base;

const SUT = `
export class Stack {
  constructor(init = []) { this.items = [...init]; }
  push(x) { this.items.push(x); }
  pop() { if (!this.items.length) throw new TypeError("pop from empty stack"); return this.items.pop(); }
}
export const util = { drain: (n) => n * 2 };
`;
const MANIFEST = {
  schema: 1, runtime: "node",
  bindings: [{
    name: "Stack", entry: "Stack",
    construction: { kind: "ctor", arity: { required: 0 } },
    instance_ops: [{ op: "push", arity: { required: 1 } }, { op: "pop", arity: { required: 0 } }],
    static_ops: [{ op: "util.drain", arity: { required: 1 } }],
  }],
};

const rpc = (body) => fetch(`${base}/faff-rpc`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer secret-token-xyz" }, body: JSON.stringify(body) }).then((r) => r.json());

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "faff-bridge-"));
  writeFileSync(join(dir, "stack.mjs"), SUT);
  writeFileSync(join(dir, "binding-manifest.json"), JSON.stringify(MANIFEST));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  let exited = null;
  proc = spawn(process.execPath, [BRIDGE, "--manifest", join(dir, "binding-manifest.json"), "--module", join(dir, "stack.mjs"), "--host", "127.0.0.1", "--port", String(port)], { stdio: ["ignore", "ignore", "inherit"] });
  proc.on("exit", (code) => { exited = code; });
  // Poll health until the listener is up (generous deadline — this runs under the concurrent
  // sharded UNIT rung, where ~4x parallel load slows subprocess start).
  const deadline = Date.now() + 30000;
  for (;;) {
    if (exited !== null) throw new Error(`bridge process exited early with code ${exited} (port ${port})`);
    if (Date.now() > deadline) throw new Error("bridge did not start listening within 30s");
    try { const r = await fetch(`${base}/faff-rpc/health`); if (r.ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(() => {
  if (proc) proc.kill("SIGTERM");
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("health returns 200 with the served wire version", async () => {
  const r = await fetch(`${base}/faff-rpc/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "ok", wire: ["faff.session-rpc/1"] });
});

test("open mints a session and call drives it over the wire", async () => {
  const o = await rpc({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [] });
  assert.equal(o.result.outcome, "returned");
  assert.match(o.result.session_id, /^s-/);
  const sid = o.result.session_id;
  assert.equal((await rpc({ wire: W, method: "call", id: "2", session_id: sid, op: "push", args: [42] })).result.outcome, "returned");
  assert.equal((await rpc({ wire: W, method: "call", id: "3", session_id: sid, op: "pop", args: [] })).result.value, 42);
});

test("a throwing op is returned as data (threw), never a top-level error", async () => {
  const sid = (await rpc({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [] })).result.session_id;
  const r = await rpc({ wire: W, method: "call", id: "2", session_id: sid, op: "pop", args: [] });
  assert.equal(r.result.outcome, "threw");
  assert.equal(r.result.error.type, "TypeError");
  assert.equal(r.error, undefined);
});

test("call on an unknown session is a strict wire error", async () => {
  const r = await rpc({ wire: W, method: "call", id: "1", session_id: "s-nope", op: "pop", args: [] });
  assert.equal(r.error.code, "unknown_session");
  assert.equal(r.result, undefined);
});

test("close is an idempotent returned no-op", async () => {
  const sid = (await rpc({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [] })).result.session_id;
  assert.equal((await rpc({ wire: W, method: "close", id: "2", session_id: sid })).result.value, null);
  const again = await rpc({ wire: W, method: "close", id: "3", session_id: sid });
  assert.equal(again.result.outcome, "returned");
  assert.equal(again.error, undefined);
});

test("call_static drives a pure function with no session", async () => {
  assert.equal((await rpc({ wire: W, method: "call_static", id: "1", op: "util.drain", args: [21] })).result.value, 42);
});

test("an unsupported major version is rejected loud", async () => {
  const r = await rpc({ wire: "faff.session-rpc/2", method: "open", id: "1", target: "Stack", ctor_args: [] });
  assert.equal(r.error.code, "unsupported_version");
});

test("a missing/undeclared op is dispatch_unavailable; prototype ops too", async () => {
  const sid = (await rpc({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [] })).result.session_id;
  assert.equal((await rpc({ wire: W, method: "call", id: "2", session_id: sid, op: "toString", args: [] })).error.code, "dispatch_unavailable");
  assert.equal((await rpc({ wire: W, method: "call", id: "3", session_id: sid, op: "constructor", args: [] })).error.code, "dispatch_unavailable");
});

test("malformed body is a malformed_request wire error", async () => {
  const r = await fetch(`${base}/faff-rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" }).then((x) => x.json());
  assert.equal(r.error.code, "malformed_request");
});

test("the bearer token never appears in any response (never-echo)", async () => {
  const sid = (await rpc({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [] })).result.session_id;
  const responses = [
    await rpc({ wire: W, method: "call", id: "2", session_id: sid, op: "pop", args: [] }),   // throws
    await rpc({ wire: W, method: "call", id: "3", session_id: sid, op: "toString", args: [] }), // dispatch_unavailable
    await rpc({ wire: W, method: "close", id: "4", session_id: sid }),
  ];
  for (const r of responses) assert.ok(!JSON.stringify(r).includes("secret-token-xyz"), "response must not echo the bearer token");
});
