// FAFF-1104 — faff-bridge-node.mjs: the first per-runtime reflection adapter (SUT-cage bridge).
// Pure-core tests: import the module's exported functions and assert the envelope validation,
// allowlist gate, prototype-safe resolution, marshalling, and error-as-data behaviour directly
// (no real listener), then spawn `--selftest` as a subprocess assertion. Mirrors evaluate-call.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXIT, WIRE_NAME, RPC_PATH, HEALTH_PATH,
  parseBridgeArgs, buildAllowlist, resolveOwn, isJsonRepresentable, toThrownError,
  validateEnvelope, dispatch, handleRequest, healthBody,
} from "../plugin/skills/faff/bin/faff-bridge-node.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff-bridge-node.mjs");
const W = `${WIRE_NAME}/1`;

class Stack {
  constructor(init = []) { this.items = [...init]; }
  push(x) { this.items.push(x); }              // void method -> returned null
  pop() { if (!this.items.length) throw new TypeError("pop from empty stack"); return this.items.pop(); }
  async size() { return this.items.length; }   // async -> awaited
  weird() { return 10n; }                       // BigInt -> NonJSONReturn
}
const MODULE_ROOT = { Stack, util: { drain: (n) => n * 2 } };
const MANIFEST = {
  schema: 1, runtime: "node",
  bindings: [{
    name: "Stack", entry: "Stack",
    construction: { kind: "ctor", arity: { required: 0 } },
    instance_ops: [{ op: "push", arity: { required: 1 } }, { op: "pop", arity: { required: 0 } }, { op: "size", arity: { required: 0 } }, { op: "weird", arity: { required: 0 } }],
    static_ops: [{ op: "util.drain", arity: { required: 1 } }],
  }],
};
const mkState = () => ({ wireMajor: 1, allowlist: buildAllowlist(MANIFEST), moduleRoot: MODULE_ROOT, sessions: new Map() });

test("--selftest passes as a subprocess", () => {
  const r = spawnSync(process.execPath, [BRIDGE, "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, EXIT.OK, r.stderr);
});

test("constants are the frozen wire values", () => {
  assert.equal(WIRE_NAME, "faff.session-rpc");
  assert.equal(RPC_PATH, "/faff-rpc");
  assert.equal(HEALTH_PATH, "/faff-rpc/health");
});

test("parseBridgeArgs: required flags, selftest short-circuit, wire default", () => {
  assert.ok(parseBridgeArgs(["--host", "h"]).errors.length > 0);
  assert.equal(parseBridgeArgs(["--selftest"]).selftest, true);
  const ok = parseBridgeArgs(["--manifest", "m", "--module", "x", "--host", "h", "--port", "8080"]);
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.wireMajor, 1);
  assert.ok(parseBridgeArgs(["--manifest", "m", "--module", "x", "--host", "h", "--port", "0"]).errors.some((e) => /port/.test(e)));
  assert.ok(parseBridgeArgs(["--bogus"]).errors.some((e) => /unknown flag/.test(e)));
});

test("validateEnvelope: wire faults", () => {
  assert.equal(validateEnvelope([], 1).code, "malformed_request");
  assert.equal(validateEnvelope({ wire: "x/1", method: "open", id: "1", target: "S" }, 1).code, "malformed_request");
  assert.equal(validateEnvelope({ wire: "faff.session-rpc/2", method: "open", id: "1", target: "S" }, 1).code, "unsupported_version");
  assert.equal(validateEnvelope({ wire: W, method: "nope", id: "1" }, 1).code, "unknown_method");
  assert.equal(validateEnvelope({ wire: W, method: "open", id: "1", target: "S", session_id: "s" }, 1).code, "malformed_request");
  assert.equal(validateEnvelope({ wire: W, method: "open", id: "1", target: "S" }, 1).ok, true);
});

test("open mints a session; call drives it; void return is returned-null", async () => {
  const s = mkState();
  const o = await handleRequest({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [[1]] }, s);
  assert.equal(o.result.outcome, "returned");
  assert.equal(o.result.value, null);
  assert.match(o.result.session_id, /^s-/);
  const sid = o.result.session_id;
  const push = await handleRequest({ wire: W, method: "call", id: "2", session_id: sid, op: "push", args: [2] }, s);
  assert.equal(push.result.outcome, "returned");
  assert.equal(push.result.value, null, "void push -> returned null, never NonJSONReturn");
  const pop = await handleRequest({ wire: W, method: "call", id: "3", session_id: sid, op: "pop", args: [] }, s);
  assert.equal(pop.result.value, 2);
});

test("a throwing method is evidence (threw), not a wire error", async () => {
  const s = mkState();
  const sid = (await handleRequest({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [] }, s)).result.session_id;
  const r = await handleRequest({ wire: W, method: "call", id: "2", session_id: sid, op: "pop", args: [] }, s);
  assert.equal(r.result.outcome, "threw");
  assert.equal(r.result.error.type, "TypeError");
  assert.match(r.result.error.message, /empty stack/);
  assert.equal(r.error, undefined);
});

test("async return is awaited; BigInt return is NonJSONReturn threw", async () => {
  const s = mkState();
  const sid = (await handleRequest({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [] }, s)).result.session_id;
  assert.equal((await handleRequest({ wire: W, method: "call", id: "2", session_id: sid, op: "size", args: [] }, s)).result.value, 0);
  const nj = await handleRequest({ wire: W, method: "call", id: "3", session_id: sid, op: "weird", args: [] }, s);
  assert.equal(nj.result.outcome, "threw");
  assert.equal(nj.result.error.type, "faff.bridge.NonJSONReturn");
});

test("unknown session is a strict wire error; close is idempotent", async () => {
  const s = mkState();
  assert.equal((await handleRequest({ wire: W, method: "call", id: "1", session_id: "s-nope", op: "pop", args: [] }, s)).error.code, "unknown_session");
  const sid = (await handleRequest({ wire: W, method: "open", id: "2", target: "Stack", ctor_args: [] }, s)).result.session_id;
  assert.equal((await handleRequest({ wire: W, method: "close", id: "3", session_id: sid }, s)).result.value, null);
  const again = await handleRequest({ wire: W, method: "close", id: "4", session_id: sid }, s);
  assert.equal(again.result.outcome, "returned");
  assert.equal(again.error, undefined);
});

test("call_static drives a pure function with no session; undeclared -> dispatch_unavailable", async () => {
  const s = mkState();
  assert.equal((await handleRequest({ wire: W, method: "call_static", id: "1", op: "util.drain", args: [21] }, s)).result.value, 42);
  assert.equal((await handleRequest({ wire: W, method: "call_static", id: "2", op: "util.other", args: [] }, s)).error.code, "dispatch_unavailable");
});

test("allowlist gate: an undeclared-but-real method is dispatch_unavailable", async () => {
  const s = mkState();
  const sid = (await handleRequest({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [] }, s)).result.session_id;
  // toString is a real method but not in instance_ops.
  assert.equal((await handleRequest({ wire: W, method: "call", id: "2", session_id: sid, op: "toString", args: [] }, s)).error.code, "dispatch_unavailable");
});

test("prototype safety: constructor/__proto__ ops are dispatch_unavailable / resolution misses", async () => {
  const s = mkState();
  const sid = (await handleRequest({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [] }, s)).result.session_id;
  assert.equal((await handleRequest({ wire: W, method: "call", id: "2", session_id: sid, op: "constructor", args: [] }, s)).error.code, "dispatch_unavailable");
  assert.equal(resolveOwn("__proto__.x", MODULE_ROOT).ok, false);
  assert.equal(resolveOwn("constructor", MODULE_ROOT).ok, false);
  assert.equal(resolveOwn("util.drain", MODULE_ROOT).ok, true);
});

test("open on a ctor that throws mints no session", async () => {
  class Boom { constructor() { throw new Error("boom"); } }
  const s = { wireMajor: 1, moduleRoot: { Boom }, sessions: new Map(),
    allowlist: buildAllowlist({ schema: 1, runtime: "node", bindings: [{ name: "Boom", entry: "Boom", construction: { kind: "ctor", arity: { required: 0 } }, instance_ops: [{ op: "x", arity: { required: 0 } }] }] }) };
  const r = await handleRequest({ wire: W, method: "open", id: "1", target: "Boom", ctor_args: [] }, s);
  assert.equal(r.result.outcome, "threw");
  assert.equal(r.result.session_id, undefined);
  assert.equal(s.sessions.size, 0);
});

test("factory construction; open on a construction-less binding is dispatch_unavailable", async () => {
  const moduleRoot = { make: () => ({ ping: () => "pong" }), lib: { f: () => 1 } };
  const manifest = { schema: 1, runtime: "node", bindings: [
    { name: "Made", entry: "made", construction: { kind: "factory", factory: "make", arity: { required: 0 } }, instance_ops: [{ op: "ping", arity: { required: 0 } }] },
    { name: "OnlyStatic", entry: "lib", static_ops: [{ op: "lib.f", arity: { required: 0 } }] },
  ] };
  const s = { wireMajor: 1, moduleRoot, sessions: new Map(), allowlist: buildAllowlist(manifest) };
  const o = await handleRequest({ wire: W, method: "open", id: "1", target: "Made", ctor_args: [] }, s);
  assert.equal(o.result.outcome, "returned");
  assert.equal((await handleRequest({ wire: W, method: "call", id: "2", session_id: o.result.session_id, op: "ping", args: [] }, s)).result.value, "pong");
  assert.equal((await handleRequest({ wire: W, method: "open", id: "3", target: "OnlyStatic", ctor_args: [] }, s)).error.code, "dispatch_unavailable");
});

test("toThrownError: non-Error throw, payload from own props", () => {
  assert.deepEqual(toThrownError("bang"), { type: "string", message: "bang", payload: null });
  const e = new Error("x"); e.code = "E_FOO"; e.fn = () => 1;
  const t = toThrownError(e);
  assert.equal(t.type, "Error");
  assert.deepEqual(t.payload, { code: "E_FOO" }, "only JSON-representable own props survive");
});

test("isJsonRepresentable", () => {
  assert.equal(isJsonRepresentable({ a: 1 }), true);
  assert.equal(isJsonRepresentable(undefined), false);
  assert.equal(isJsonRepresentable(10n), false);
  assert.equal(isJsonRepresentable(() => 1), false);
  const c = {}; c.self = c;
  assert.equal(isJsonRepresentable(c), false);
});

test("healthBody shape", () => {
  assert.deepEqual(healthBody(1), { status: "ok", wire: ["faff.session-rpc/1"] });
});
