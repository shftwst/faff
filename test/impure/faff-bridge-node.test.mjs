// FAFF-1104 (impure) — faff-bridge-node.mjs end-to-end over a REAL TCP listener.
// Starts the bridge's actual node:http server (the exported realListen) in-process on an
// OS-assigned port and drives the frozen wire (open/call/call_static/close + health) over
// real HTTP, asserting the conformance list from docs/reference/session-rpc-wire.md. A real
// socket, so it lives under test/impure/. It binds in-process (no subprocess spawn, no
// startup poll, OS-assigned port) so it stays deterministic under the concurrent sharded
// UNIT rung — the true argv->process->listen path is covered by the --selftest subprocess
// assertion in test/faff-bridge-node.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { realListen, buildAllowlist } from "../../plugin/skills/faff/bin/faff-bridge-node.mjs";

const W = "faff.session-rpc/1";

// A representative SUT module reflected by the bridge.
class Stack {
  constructor(init = []) { this.items = [...init]; }
  push(x) { this.items.push(x); }
  pop() { if (!this.items.length) throw new TypeError("pop from empty stack"); return this.items.pop(); }
}
const MODULE_ROOT = { Stack, util: { drain: (n) => n * 2 } };
const MANIFEST = {
  schema: 1, runtime: "node",
  bindings: [{
    name: "Stack", entry: "Stack",
    construction: { kind: "ctor", arity: { required: 0 } },
    instance_ops: [{ op: "push", arity: { required: 1 } }, { op: "pop", arity: { required: 0 } }],
    static_ops: [{ op: "util.drain", arity: { required: 1 } }],
  }],
};

let server, base;

const rpc = (body) => fetch(`${base}/faff-rpc`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer secret-token-xyz" },
  body: JSON.stringify(body),
}).then((r) => r.json());

before(async () => {
  const state = { wireMajor: 1, allowlist: buildAllowlist(MANIFEST), moduleRoot: MODULE_ROOT, sessions: new Map() };
  server = await realListen("127.0.0.1", 0, state);   // port 0 -> OS assigns; no race, no poll
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { if (server) server.close(); });

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
    await rpc({ wire: W, method: "call", id: "2", session_id: sid, op: "pop", args: [] }),      // throws
    await rpc({ wire: W, method: "call", id: "3", session_id: sid, op: "toString", args: [] }),  // dispatch_unavailable
    await rpc({ wire: W, method: "close", id: "4", session_id: sid }),
  ];
  for (const r of responses) assert.ok(!JSON.stringify(r).includes("secret-token-xyz"), "response must not echo the bearer token");
});

// FAFF-1128 — a real bridge with an armed per-request timeout returns dispatch_timeout for a
// hung op within the window, releases the socket, retains the session, and keeps the disjoint
// planes clean even when the orphaned op settles (rejects) AFTER the breach.
test("per-request timeout: hung op -> dispatch_timeout, socket released, session retained, no late unhandledRejection", async () => {
  class HangStack {
    constructor() { this.items = []; }
    push(x) { this.items.push(x); }
    hang() { return new Promise(() => {}); }                                   // never settles
    lateReject() { return new Promise((_, rej) => setTimeout(() => rej(new Error("late")), 120)); }  // rejects AFTER the 40ms deadline
  }
  const moduleRoot = { HangStack };
  const manifest = {
    schema: 1, runtime: "node",
    bindings: [{
      name: "HangStack", entry: "HangStack",
      construction: { kind: "ctor", arity: { required: 0 } },
      instance_ops: [{ op: "push", arity: { required: 1 } }, { op: "hang", arity: { required: 0 } }, { op: "lateReject", arity: { required: 0 } }],
    }],
  };
  const state = { wireMajor: 1, allowlist: buildAllowlist(manifest), moduleRoot, sessions: new Map(),
    requestTimeoutMs: 40, timers: { set: setTimeout, clear: clearTimeout } };
  const srv = await realListen("127.0.0.1", 0, state);
  const b = `http://127.0.0.1:${srv.address().port}`;
  const call = (body) => fetch(`${b}/faff-rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  const rejections = [];
  const onRej = (e) => rejections.push(e);
  process.on("unhandledRejection", onRej);
  try {
    const sid = (await call({ wire: W, method: "open", id: "1", target: "HangStack", ctor_args: [] })).result.session_id;

    const hung = await call({ wire: W, method: "call", id: "2", session_id: sid, op: "hang", args: [] });
    assert.equal(hung.error.code, "dispatch_timeout");          // wire plane, never a result
    assert.equal(hung.result, undefined);

    // the socket was released (this second request completes) and the session is retained.
    assert.equal((await call({ wire: W, method: "call", id: "3", session_id: sid, op: "push", args: [7] })).result.outcome, "returned");

    // an op whose promise REJECTS after the breach: still dispatch_timeout, and the late
    // rejection must be swallowed (no unhandledRejection), the session still clean.
    const late = await call({ wire: W, method: "call", id: "4", session_id: sid, op: "lateReject", args: [] });
    assert.equal(late.error.code, "dispatch_timeout");
    await new Promise((r) => setTimeout(r, 200));               // let the detached rejection fire
    assert.equal(rejections.length, 0, "a late-settling timed-out op must not surface an unhandledRejection");
    assert.equal((await call({ wire: W, method: "close", id: "5", session_id: sid })).result.value, null);
  } finally {
    process.removeListener("unhandledRejection", onRej);
    srv.close();
  }
});
