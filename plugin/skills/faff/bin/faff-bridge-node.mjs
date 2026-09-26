#!/usr/bin/env node
// ===========================================================================
// === faff-bridge-node.mjs — the first per-runtime reflection adapter (FAFF-1104) ===
//
// The SUT-cage bridge for the code-blind holdout's code-interface path. It runs
// BESIDE the component in the SUT cage (the one that legitimately holds the code),
// reflects the component's public surface named by a validated Tier-1 binding
// manifest (FAFF-1103), and answers the four frozen session RPC wire methods
// (FAFF-1102) over TCP: open / call / call_static / close. The evaluator POSTs to
// it exactly as it POSTs to any service, so the cage guarantees hold for free.
//
// LOAD-BEARING RULE: the component's code must NEVER enter the evaluator cage. The
// bridge is a standalone server reached only over the process boundary; it is never
// published as a module importable alongside the SUT package. Placement + topology
// proof are FAFF-1105/1107's; this file carries the structural rule.
//
// SERVES EXACTLY THE MANIFEST'S DECLARED SURFACE. The manifest is a names-only
// allowlist. Every dispatch gates on the binding's declared op set BEFORE any
// reflection, and symbol resolution walks OWN properties only (never the prototype
// chain) and refuses __proto__/prototype/constructor — so the served surface is
// exactly the declared set, never an inherited or dunder symbol. (Spec-review
// round-1 infosec fix.)
//
// TWO DISJOINT PLANES: a WireError is an infra fault the evaluator reads as
// needs-human; a thrown exception is `result.outcome:"threw"` — evidence the
// evaluator asserts on, never anything executable. dispatch_unavailable is decided
// entirely before invocation; every failure from invocation onward is `threw`.
//
// PURE CORE + INJECTABLE I/O, mirroring evaluate-call.mjs / killable-spawn.mjs: the
// envelope parse/validate, allowlist + resolution, marshalling and response
// assembly are pure and covered by --selftest with zero real listeners; the
// import(), the node:http bind, and the reflective invocation are the injectable
// real-I/O edge. Zero dependencies, node stdlib only.
// ===========================================================================

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Exit family — mirrors the review-call/evaluate-call family (0 ok · 1 other · 2 usage).
export const EXIT = { OK: 0, OTHER: 1, USAGE: 2 };

export const WIRE_NAME = "faff.session-rpc";
export const RPC_PATH = "/faff-rpc";
export const HEALTH_PATH = "/faff-rpc/health";
export const METHODS = new Set(["open", "call", "call_static", "close"]);
export const WIRE_ERROR_CODES = new Set([
  "malformed_request", "unknown_method", "unknown_session", "unsupported_version", "dispatch_unavailable",
]);
// Reserved reflection segments never traversed — each is a valid single-segment
// identifier under the FAFF-1103 grammar, so the manifest allowlist alone cannot
// exclude them; the resolver refuses them structurally.
const RESERVED_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

// ---- pure: arg parsing -----------------------------------------------------

export function parseBridgeArgs(argv) {
  const spec = { "--manifest": 1, "--module": 1, "--host": 1, "--port": 1, "--wire": 1, "--selftest": 0 };
  const out = { selftest: false };
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!(a in spec)) { errors.push(`unknown flag ${a}`); continue; }
    if (spec[a] === 0) { out[a.slice(2)] = true; continue; }
    const v = argv[++i];
    if (v === undefined) { errors.push(`${a} requires a value`); continue; }
    out[a.slice(2)] = v;
  }
  if (out.selftest) return { selftest: true, errors: [] };
  for (const req of ["manifest", "module", "host", "port"]) {
    if (out[req] === undefined) errors.push(`--${req} is required`);
  }
  if (out.port !== undefined && !/^[1-9][0-9]*$/.test(String(out.port))) errors.push("--port must be a positive integer");
  out.wireMajor = out.wire === undefined ? 1 : Number(out.wire);
  if (!Number.isInteger(out.wireMajor) || out.wireMajor < 1) errors.push("--wire must be a positive integer");
  return { ...out, errors };
}

// ---- pure: manifest -> declared-op allowlist -------------------------------

// Build the lookup the dispatch gates read: per-binding-name instance-op sets, the
// binding records (for construction), and the union of declared static-op names.
export function buildAllowlist(manifest) {
  const bindings = new Map();       // name -> binding record
  const instanceOps = new Map();    // name -> Set(op)
  const staticOps = new Set();      // union of static op names
  for (const b of manifest.bindings) {
    bindings.set(b.name, b);
    instanceOps.set(b.name, new Set((b.instance_ops || []).map((o) => o.op)));
    for (const o of b.static_ops || []) staticOps.add(o.op);
  }
  return { bindings, instanceOps, staticOps };
}

// ---- pure: own-property, prototype-safe symbol resolution ------------------

const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

// Resolve a dotted path against the module root over OWN properties only, refusing
// reserved segments. Returns { ok, value } — ok:false is a resolution miss the
// caller maps to dispatch_unavailable.
export function resolveOwn(dottedPath, moduleRoot) {
  const segments = String(dottedPath).split(".");
  for (const seg of segments) if (RESERVED_SEGMENTS.has(seg)) return { ok: false };
  let cursor = moduleRoot;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (hasOwn(cursor, seg)) { cursor = cursor[seg]; continue; }
    if (i === 0 && hasOwn(cursor, "default") && hasOwn(cursor.default, seg)) { cursor = cursor.default[seg]; continue; }
    return { ok: false };
  }
  return { ok: true, value: cursor };
}

// ---- pure: marshalling + error-as-data -------------------------------------

// True iff the value round-trips through JSON without loss at the top level.
export function isJsonRepresentable(value) {
  if (value === undefined) return false;
  try {
    const s = JSON.stringify(value);
    return s !== undefined;   // JSON.stringify(function|symbol|undefined) === undefined
  } catch { return false; }   // circular / BigInt throw
}

export function toThrownError(err) {
  // Objects report their class (e.g. "TypeError"); a thrown primitive reports its
  // typeof ("string" for `throw "x"`) rather than its autoboxed wrapper ("String").
  const type = (err !== null && typeof err === "object")
    ? ((err.constructor && err.constructor.name) || err.name || "object")
    : typeof err;
  const message = String((err && err.message !== undefined && err.message !== null) ? err.message : err);
  let payload = null;
  if (err && typeof err === "object") {
    const p = {};
    for (const k of Object.keys(err)) {
      if (k === "type" || k === "message") continue;
      if (isJsonRepresentable(err[k])) p[k] = err[k];
    }
    if (Object.keys(p).length) payload = p;
  }
  return { type, message, payload };
}

// ---- pure: response builders ----------------------------------------------

const wireError = (wire, id, code, message) => ({ wire, id, error: { code, message } });
const resultReturned = (wire, id, value, extra = {}) => ({ wire, id, result: { outcome: "returned", value, ...extra } });
const resultThrew = (wire, id, error) => ({ wire, id, result: { outcome: "threw", error } });

// Marshal a returned value. A void return (`undefined`) is the common case for a
// mutator method and maps to a normal returned-null — never an error. Only a
// genuinely-unrepresentable value (BigInt, function, symbol, circular) is `threw`
// with the reserved NonJSONReturn type (never a WireError — the code enum is closed).
function respondWithValue(wire, id, value) {
  if (value === undefined) return resultReturned(wire, id, null);
  if (!isJsonRepresentable(value)) {
    return resultThrew(wire, id, { type: "faff.bridge.NonJSONReturn", message: `return value is not JSON-representable (${typeof value})`, payload: null });
  }
  return resultReturned(wire, id, value);
}

// ---- pure: strict envelope validation --------------------------------------

// Which fields each method is allowed to carry (beyond wire/method/id).
const ALLOWED_FIELDS = {
  open: new Set(["target", "ctor_args"]),
  call: new Set(["session_id", "op", "args"]),
  call_static: new Set(["op", "args"]),
  close: new Set(["session_id"]),
};
const BASE_FIELDS = new Set(["wire", "method", "id"]);

// Returns { code } on a wire-level fault (caller emits the WireError), else { ok:true }.
export function validateEnvelope(req, wireMajor) {
  if (req === null || typeof req !== "object" || Array.isArray(req)) return { code: "malformed_request", message: "request must be a JSON object" };
  if (typeof req.wire !== "string") return { code: "malformed_request", message: "missing or malformed wire tag" };
  const m = /^([A-Za-z0-9._-]+)\/([0-9]+)$/.exec(req.wire);
  if (!m || m[1] !== WIRE_NAME) return { code: "malformed_request", message: `unrecognised wire tag ${req.wire}` };
  if (Number(m[2]) !== wireMajor) return { code: "unsupported_version", message: `wire major ${m[2]} not served (serving ${wireMajor})` };
  if (typeof req.id !== "string") return { code: "malformed_request", message: "missing or malformed id" };
  if (!METHODS.has(req.method)) return { code: "unknown_method", message: `unknown method ${req.method}` };
  const allowed = ALLOWED_FIELDS[req.method];
  for (const k of Object.keys(req)) {
    if (BASE_FIELDS.has(k)) continue;
    if (!allowed.has(k)) return { code: "malformed_request", message: `field '${k}' not permitted for method ${req.method}` };
  }
  return { ok: true };
}

// ---- pure: the dispatch core ----------------------------------------------

// Dispatch a validated request. `state` = { wire, allowlist, moduleRoot, sessions }.
// Async because it awaits thenable returns; every from-invocation failure is `threw`.
export async function dispatch(req, state) {
  const { allowlist, moduleRoot, sessions } = state;
  const wire = req.wire;
  const id = req.id;

  if (req.method === "open") {
    const binding = allowlist.bindings.get(req.target);
    if (!binding || binding.construction === undefined) return wireError(wire, id, "dispatch_unavailable", `no constructible binding named ${req.target}`);
    const ctorArgs = Array.isArray(req.ctor_args) ? req.ctor_args : [];
    const c = binding.construction;
    let symRes;
    if (c.kind === "factory") {
      symRes = resolveOwn(c.factory, moduleRoot);
      if (!symRes.ok || typeof symRes.value !== "function") return wireError(wire, id, "dispatch_unavailable", `factory ${c.factory} is not callable`);
    } else {
      symRes = resolveOwn(binding.entry, moduleRoot);
      if (!symRes.ok || typeof symRes.value !== "function") return wireError(wire, id, "dispatch_unavailable", `entry ${binding.entry} is not a constructor`);
    }
    // THROW plane begins at construction.
    try {
      let instance = c.kind === "factory" ? symRes.value(...ctorArgs) : Reflect.construct(symRes.value, ctorArgs);
      if (instance && typeof instance.then === "function") instance = await instance;
      const sid = "s-" + randomUUID();
      sessions.set(sid, { instance, binding });
      return resultReturned(wire, id, null, { session_id: sid });
    } catch (err) {
      return resultThrew(wire, id, toThrownError(err));
    }
  }

  if (req.method === "call") {
    const session = sessions.get(req.session_id);
    if (!session) return wireError(wire, id, "unknown_session", `no live session ${req.session_id}`);
    const declared = allowlist.instanceOps.get(session.binding.name) || new Set();
    if (!declared.has(req.op)) return wireError(wire, id, "dispatch_unavailable", `op ${req.op} not declared in instance_ops for ${session.binding.name}`);
    if (RESERVED_SEGMENTS.has(req.op) || !hasOwnMethod(session.instance, req.op)) return wireError(wire, id, "dispatch_unavailable", `op ${req.op} is not a callable method`);
    const args = Array.isArray(req.args) ? req.args : [];
    try {
      let r = session.instance[req.op](...args);
      if (r && typeof r.then === "function") r = await r;
      return respondWithValue(wire, id, r);
    } catch (err) {
      return resultThrew(wire, id, toThrownError(err));
    }
  }

  if (req.method === "call_static") {
    if (!allowlist.staticOps.has(req.op)) return wireError(wire, id, "dispatch_unavailable", `op ${req.op} not declared in any static_ops`);
    const symRes = resolveOwn(req.op, moduleRoot);
    if (!symRes.ok || typeof symRes.value !== "function") return wireError(wire, id, "dispatch_unavailable", `static op ${req.op} is not a function`);
    const args = Array.isArray(req.args) ? req.args : [];
    try {
      let r = symRes.value(...args);
      if (r && typeof r.then === "function") r = await r;
      return respondWithValue(wire, id, r);
    } catch (err) {
      return resultThrew(wire, id, toThrownError(err));
    }
  }

  // close — idempotent, never errors.
  sessions.delete(req.session_id);
  return resultReturned(wire, id, null);
}

// A method is callable iff it resolves (own or inherited-instance-method) to a
// function AND is not a reserved segment. Instance methods commonly live on the
// prototype (a class method), so `call` accepts an inherited *function* here — the
// allowlist gate above is what restricts it to declared ops; the reserved-segment
// refusal blocks the dangerous ones.
function hasOwnMethod(instance, op) {
  if (instance == null) return false;
  return typeof instance[op] === "function";
}

// Handle one parsed request end-to-end (validate then dispatch). Pure over `state`.
export async function handleRequest(req, state) {
  const v = validateEnvelope(req, state.wireMajor);
  if (!v.ok) return wireError(req && typeof req === "object" && !Array.isArray(req) ? req.wire : undefined,
                              req && typeof req === "object" && !Array.isArray(req) ? req.id : undefined,
                              v.code, v.message);
  return dispatch(req, state);
}

export function healthBody(wireMajor) {
  return { status: "ok", wire: [`${WIRE_NAME}/${wireMajor}`] };
}

// ---- real I/O edge: startup + listen ---------------------------------------

// Load + validate the manifest; returns { manifest } or throws with a message.
function loadManifest(path) {
  const raw = readFileSync(path, "utf8");
  const { validateManifest, parseManifestInput } = require("./lib/manifest.js");
  const obj = parseManifestInput(raw);
  const violations = validateManifest(obj);
  if (violations.length) throw new Error(`invalid manifest:\n- ${violations.join("\n- ")}`);
  if (obj.runtime !== "node") throw new Error(`manifest runtime '${obj.runtime}' is not 'node' — this bridge serves node manifests only`);
  return obj;
}

export async function main(argv, io = {}) {
  const importFn = io.importFn || ((spec) => import(spec));
  const listen = io.listen || realListen;
  const log = io.log || ((s) => process.stderr.write(s + "\n"));

  const opts = parseBridgeArgs(argv);
  if (opts.selftest) return selftest(log);
  if (opts.errors.length) { for (const e of opts.errors) log(e); log("usage: faff-bridge-node.mjs --manifest F --module SPEC --host H --port P [--wire N]"); return EXIT.USAGE; }

  let manifest;
  try { manifest = loadManifest(opts.manifest); } catch (e) { log(`faff-bridge-node: ${e.message}`); return EXIT.OTHER; }

  let moduleRoot;
  try { moduleRoot = await importFn(opts.module); } catch (e) { log(`faff-bridge-node: cannot import --module ${opts.module}: ${e.message}`); return EXIT.OTHER; }

  const state = { wireMajor: opts.wireMajor, allowlist: buildAllowlist(manifest), moduleRoot, sessions: new Map() };
  await listen(opts.host, Number(opts.port), state, log);
  return EXIT.OK;
}

export function realListen(host, port, state, log = () => {}) {
  return new Promise((resolve, reject) => {
    const server = createServer((httpReq, httpRes) => {
      const send = (status, obj) => { httpRes.writeHead(status, { "content-type": "application/json" }); httpRes.end(JSON.stringify(obj)); };
      if (httpReq.method === "GET" && httpReq.url === HEALTH_PATH) { send(200, healthBody(state.wireMajor)); return; }
      if (httpReq.method !== "POST" || httpReq.url !== RPC_PATH) { send(404, { error: { code: "malformed_request", message: "unknown route" } }); return; }
      let body = "";
      httpReq.on("data", (c) => { body += c; });
      httpReq.on("end", async () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { send(200, wireError(undefined, undefined, "malformed_request", "body is not valid JSON")); return; }
        try { send(200, await handleRequest(parsed, state)); }
        catch (e) { send(200, wireError(parsed && parsed.wire, parsed && parsed.id, "dispatch_unavailable", `internal: ${e.message}`)); }
      });
    });
    server.on("error", reject);
    server.listen(port, host, () => { log(`faff-bridge-node: listening on ${host}:${port} (wire ${WIRE_NAME}/${state.wireMajor})`); resolve(server); });
  });
}

// ---- --selftest: pure core, zero real listeners ----------------------------

function selftest(log) {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { log(`faff-bridge-node --selftest FAIL: ${label}`); failed++; } };

  // A fake module root with a class (ctor + instance ops) and a static function.
  class Stack {
    constructor() { this.items = []; }
    push(x) { this.items.push(x); }
    pop() { if (!this.items.length) throw new TypeError("pop from empty stack"); return this.items.pop(); }
    async size() { return this.items.length; }
    bad() { return () => 1; }   // returns a non-JSON value
  }
  const moduleRoot = { Stack, util: { drain: (n) => n * 2 } };
  const manifest = {
    schema: 1, runtime: "node",
    bindings: [{
      name: "Stack", entry: "Stack",
      construction: { kind: "ctor", arity: { required: 0 } },
      instance_ops: [{ op: "push", arity: { required: 1 } }, { op: "pop", arity: { required: 0 } }, { op: "size", arity: { required: 0 } }, { op: "bad", arity: { required: 0 } }],
      static_ops: [{ op: "util.drain", arity: { required: 1 } }],
    }],
  };
  const mk = () => ({ wireMajor: 1, allowlist: buildAllowlist(manifest), moduleRoot, sessions: new Map() });
  const W = "faff.session-rpc/1";
  const run = async (req, state) => handleRequest(req, state);

  return (async () => {
    // Envelope faults.
    check("non-object -> malformed", (await run([], mk())).error?.code === "malformed_request");
    check("bad wire tag -> malformed", (await run({ wire: "x/1", method: "open", id: "1", target: "Stack" }, mk())).error?.code === "malformed_request");
    check("unsupported version", (await run({ wire: "faff.session-rpc/2", method: "open", id: "1", target: "Stack" }, mk())).error?.code === "unsupported_version");
    check("unknown method", (await run({ wire: W, method: "frobnicate", id: "1" }, mk())).error?.code === "unknown_method");
    check("stray field for method -> malformed", (await run({ wire: W, method: "open", id: "1", target: "Stack", session_id: "s" }, mk())).error?.code === "malformed_request");

    // open + call + throw + close over one session.
    const s = mk();
    const opened = await run({ wire: W, method: "open", id: "1", target: "Stack", ctor_args: [] }, s);
    check("open returns a session", opened.result?.outcome === "returned" && typeof opened.result.session_id === "string" && opened.result.value === null);
    const sid = opened.result.session_id;
    check("push returned", (await run({ wire: W, method: "call", id: "2", session_id: sid, op: "push", args: [7] }, s)).result?.outcome === "returned");
    const popped = await run({ wire: W, method: "call", id: "3", session_id: sid, op: "pop", args: [] }, s);
    check("pop returns the value", popped.result?.outcome === "returned" && popped.result.value === 7);
    const threw = await run({ wire: W, method: "call", id: "4", session_id: sid, op: "pop", args: [] }, s);
    check("empty pop is threw (not error)", threw.result?.outcome === "threw" && threw.result.error.type === "TypeError" && !threw.error);
    check("async size awaited -> returned", (await run({ wire: W, method: "call", id: "4b", session_id: sid, op: "size", args: [] }, s)).result?.value === 0);
    const nonjson = await run({ wire: W, method: "call", id: "4c", session_id: sid, op: "bad", args: [] }, s);
    check("non-JSON return -> threw NonJSONReturn", nonjson.result?.outcome === "threw" && nonjson.result.error.type === "faff.bridge.NonJSONReturn");

    // close idempotent.
    check("close returned", (await run({ wire: W, method: "close", id: "5", session_id: sid }, s)).result?.value === null);
    check("close again idempotent (no error)", (await run({ wire: W, method: "close", id: "6", session_id: sid }, s)).result?.outcome === "returned");

    // strict unknown session.
    check("call on unknown session -> unknown_session", (await run({ wire: W, method: "call", id: "7", session_id: "s-nope", op: "pop", args: [] }, mk())).error?.code === "unknown_session");

    // call_static.
    check("call_static drives a pure fn", (await run({ wire: W, method: "call_static", id: "8", op: "util.drain", args: [21] }, mk())).result?.value === 42);
    check("undeclared static op -> dispatch_unavailable", (await run({ wire: W, method: "call_static", id: "9", op: "util.other", args: [] }, mk())).error?.code === "dispatch_unavailable");

    // allowlist gate + prototype safety.
    const s2 = mk();
    const o2 = await run({ wire: W, method: "open", id: "10", target: "Stack", ctor_args: [] }, s2);
    const sid2 = o2.result.session_id;
    check("undeclared-but-real op -> dispatch_unavailable (allowlist)", (await run({ wire: W, method: "call", id: "11", session_id: sid2, op: "toString", args: [] }, s2)).error?.code === "dispatch_unavailable");
    check("constructor op -> dispatch_unavailable (prototype-safe)", (await run({ wire: W, method: "call", id: "12", session_id: sid2, op: "constructor", args: [] }, s2)).error?.code === "dispatch_unavailable");
    check("resolveOwn refuses __proto__", resolveOwn("__proto__.polluted", moduleRoot).ok === false);
    check("resolveOwn own-property hit", resolveOwn("util.drain", moduleRoot).ok === true);

    // ctor-throw mints no session.
    class Boom { constructor() { throw new Error("boom"); } }
    const bm = { wireMajor: 1, allowlist: buildAllowlist({ schema: 1, runtime: "node", bindings: [{ name: "Boom", entry: "Boom", construction: { kind: "ctor", arity: { required: 0 } }, instance_ops: [{ op: "x", arity: { required: 0 } }] }] }), moduleRoot: { Boom }, sessions: new Map() };
    const boom = await run({ wire: W, method: "open", id: "13", target: "Boom", ctor_args: [] }, bm);
    check("ctor throw -> threw, no session", boom.result?.outcome === "threw" && boom.result.session_id === undefined && bm.sessions.size === 0);

    // open on a static-only (construction-less) binding.
    const so = { wireMajor: 1, allowlist: buildAllowlist({ schema: 1, runtime: "node", bindings: [{ name: "S", entry: "S", static_ops: [{ op: "f", arity: { required: 0 } }] }] }), moduleRoot: { S: {}, f: () => 1 }, sessions: new Map() };
    check("open on construction-less binding -> dispatch_unavailable", (await run({ wire: W, method: "open", id: "14", target: "S", ctor_args: [] }, so)).error?.code === "dispatch_unavailable");

    // health body shape.
    check("health body", JSON.stringify(healthBody(1)) === JSON.stringify({ status: "ok", wire: ["faff.session-rpc/1"] }));

    // parseBridgeArgs.
    check("args: missing required -> error", parseBridgeArgs(["--host", "h"]).errors.length > 0);
    check("args: selftest short-circuit", parseBridgeArgs(["--selftest"]).selftest === true);
    check("args: wire defaults to 1", parseBridgeArgs(["--manifest", "m", "--module", "x", "--host", "h", "--port", "8080"]).wireMajor === 1);

    if (failed) return EXIT.OTHER;
    log("faff-bridge-node --selftest: ok");
    return EXIT.OK;
  })();
}

// Direct-invocation guard.
if (process.argv[1] && process.argv[1].endsWith("faff-bridge-node.mjs")) {
  main(process.argv.slice(2)).then((code) => { if (code !== EXIT.OK || process.argv.includes("--selftest")) process.exit(code); },
    (e) => { process.stderr.write(`faff-bridge-node: fatal ${e && e.stack || e}\n`); process.exit(EXIT.OTHER); });
}
