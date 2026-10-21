// FAFF-1104 — faff-bridge-node.mjs: the first per-runtime reflection adapter (SUT-cage bridge).
// Pure-core tests: import the module's exported functions and assert the envelope validation,
// allowlist gate, prototype-safe resolution, marshalling, and error-as-data behaviour directly
// (no real listener), then spawn `--selftest` as a subprocess assertion. Mirrors evaluate-call.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  EXIT, WIRE_NAME, RPC_PATH, HEALTH_PATH,
  parseBridgeArgs, buildAllowlist, resolveOwn, isJsonRepresentable, toThrownError,
  validateEnvelope, dispatch, handleRequest, healthBody,
  BRIDGE_EXIT_BACKSTOP_GRACE_MS, armBridgeExitBackstop, runBridgeCli,
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
  // non-finite numbers are lossy through JSON (stringify -> "null"), so NOT representable — top-level and nested.
  assert.equal(isJsonRepresentable(NaN), false);
  assert.equal(isJsonRepresentable(Infinity), false);
  assert.equal(isJsonRepresentable(-Infinity), false);
  assert.equal(isJsonRepresentable({ x: NaN }), false);
});

test("a NaN/Infinity return is NonJSONReturn threw, never a lossy null", async () => {
  class N { ratio() { return 0 / 0; } huge() { return Infinity; } }
  const manifest = { schema: 1, runtime: "node", bindings: [{ name: "N", entry: "N", construction: { kind: "ctor", arity: { required: 0 } }, instance_ops: [{ op: "ratio", arity: { required: 0 } }, { op: "huge", arity: { required: 0 } }] }] };
  const s = { wireMajor: 1, moduleRoot: { N }, sessions: new Map(), allowlist: buildAllowlist(manifest) };
  const sid = (await handleRequest({ wire: W, method: "open", id: "1", target: "N", ctor_args: [] }, s)).result.session_id;
  for (const op of ["ratio", "huge"]) {
    const r = await handleRequest({ wire: W, method: "call", id: "2", session_id: sid, op, args: [] }, s);
    assert.equal(r.result.outcome, "threw", `${op} -> threw`);
    assert.equal(r.result.error.type, "faff.bridge.NonJSONReturn");
  }
});

test("close disposes the live instance (best-effort)", async () => {
  let disposed = false;
  class D { close() { disposed = true; } ping() { return "ok"; } }
  const manifest = { schema: 1, runtime: "node", bindings: [{ name: "D", entry: "D", construction: { kind: "ctor", arity: { required: 0 } }, instance_ops: [{ op: "ping", arity: { required: 0 } }] }] };
  const s = { wireMajor: 1, moduleRoot: { D }, sessions: new Map(), allowlist: buildAllowlist(manifest) };
  const sid = (await handleRequest({ wire: W, method: "open", id: "1", target: "D", ctor_args: [] }, s)).result.session_id;
  await handleRequest({ wire: W, method: "close", id: "2", session_id: sid }, s);
  assert.equal(disposed, true, "close should invoke the instance's disposer");
  assert.equal(s.sessions.size, 0);
  // a disposer that throws must not break close's idempotent no-op.
  class Bad { close() { throw new Error("disposer boom"); } ping() {} }
  const s2 = { wireMajor: 1, moduleRoot: { Bad }, sessions: new Map(), allowlist: buildAllowlist({ schema: 1, runtime: "node", bindings: [{ name: "Bad", entry: "Bad", construction: { kind: "ctor", arity: { required: 0 } }, instance_ops: [{ op: "ping", arity: { required: 0 } }] }] }) };
  const sid2 = (await handleRequest({ wire: W, method: "open", id: "3", target: "Bad", ctor_args: [] }, s2)).result.session_id;
  const r = await handleRequest({ wire: W, method: "close", id: "4", session_id: sid2 }, s2);
  assert.equal(r.result.outcome, "returned");
  assert.equal(r.error, undefined);
});

test("healthBody shape", () => {
  assert.deepEqual(healthBody(1), { status: "ok", wire: ["faff.session-rpc/1"] });
});

// ---- FAFF-1355: exit through process.exitCode, with a leak-only backstop ----

test("BRIDGE_EXIT_BACKSTOP_GRACE_MS is 2000", () => {
  assert.equal(BRIDGE_EXIT_BACKSTOP_GRACE_MS, 2000);
});

function fakeProc() {
  const lines = [];
  return { exitCode: undefined, stderr: { write: (s) => { lines.push(s); } }, lines };
}

test("runBridgeCli: code 0 leaves exitCode 0 and does not arm the backstop", async () => {
  const proc = fakeProc(); const armed = [];
  await runBridgeCli(Promise.resolve(EXIT.OK), proc, (c) => armed.push(c));
  assert.equal(proc.exitCode, 0);
  assert.deepEqual(armed, []);
});

test("runBridgeCli: code 2 sets exitCode and arms the backstop", async () => {
  const proc = fakeProc(); const armed = [];
  await runBridgeCli(Promise.resolve(EXIT.USAGE), proc, (c) => armed.push(c));
  assert.equal(proc.exitCode, 2);
  assert.deepEqual(armed, [2]);
});

test("runBridgeCli: rejection writes the fatal line, sets exitCode 1 and arms the backstop", async () => {
  const proc = fakeProc(); const armed = [];
  await runBridgeCli(Promise.reject(new Error("boom")), proc, (c) => armed.push(c));
  assert.equal(proc.exitCode, 1);
  assert.deepEqual(armed, [1]);
  assert.match(proc.lines.join(""), /^faff-bridge-node: fatal /);
});

test("armBridgeExitBackstop: forces exit once after the grace period, with an unref'd timer", async () => {
  const exits = []; const written = [];
  const t = armBridgeExitBackstop(3, {
    graceMs: 10,
    write: (s) => written.push(s),
    exit: (c) => exits.push(c),
    flush: (cb) => cb(),
    activeResources: () => ["Timeout", "TCPServerWrap"],
  });
  assert.equal(t.hasRef(), false);
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(exits, [3]);
  assert.match(written.join(""), /leaked handle\(s\): Timeout, TCPServerWrap/);
});

function boundPort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

async function runBridgeAgainstBoundPort(moduleSource) {
  const dir = mkdtempSync(join(tmpdir(), "faff-bridge-exit-"));
  const { srv, port } = await boundPort();
  try {
    const manifest = join(dir, "manifest.json");
    const mod = join(dir, "mod.mjs");
    writeFileSync(manifest, JSON.stringify(MANIFEST));
    writeFileSync(mod, moduleSource);
    const started = Date.now();
    const r = spawnSync(process.execPath, [BRIDGE, "--manifest", manifest, "--module", pathToFileURL(mod).href, "--host", "127.0.0.1", "--port", String(port)], { encoding: "utf8", timeout: 10000 });
    return { status: r.status, stderr: r.stderr, elapsedMs: Date.now() - started };
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("bridge start-up failure with a ref'd handle in the adopter module exits 1 via the backstop", async () => {
  const r = await runBridgeAgainstBoundPort("export class Stack {}\nsetInterval(() => {}, 1000);\n");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /faff-bridge-node: fatal/);
  assert.match(r.stderr, /leaked handle\(s\)/);
  assert.ok(r.elapsedMs < BRIDGE_EXIT_BACKSTOP_GRACE_MS + 3000, `took ${r.elapsedMs}ms`);
});

test("bridge start-up failure with no handles exits 1 without the backstop", async () => {
  const r = await runBridgeAgainstBoundPort("export class Stack {}\n");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /faff-bridge-node: fatal/);
  assert.doesNotMatch(r.stderr, /leaked handle\(s\)/);
  assert.ok(r.elapsedMs < BRIDGE_EXIT_BACKSTOP_GRACE_MS, `took ${r.elapsedMs}ms`);
});

test("bridge with no arguments exits 2 with the usage line and no backstop line", () => {
  const r = spawnSync(process.execPath, [BRIDGE], { encoding: "utf8", timeout: 10000 });
  assert.equal(r.status, EXIT.USAGE);
  assert.match(r.stderr, /usage: faff-bridge-node\.mjs/);
  assert.doesNotMatch(r.stderr, /leaked handle\(s\)/);
});
