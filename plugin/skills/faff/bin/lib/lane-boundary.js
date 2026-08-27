// ===========================================================================
// === region:factory — lane-boundary — FAFF-859: the EMIT half of the config-declares → emit → assert-in chain. ===
// The intent-out writer of the ADR-0041 rung-2 seam. An operator DECLARES a lane's
// intended physical boundary in `.faffrc` (`lanes.<lane>.isolation.{container,host}`);
// this command RESOLVES that declaration and EMITS it as `<run-dir>/lane-boundary.json`
// — faff becomes the first-ever writer of that file (nothing wrote it in production
// before; only fixtures did). The assert-in counterpart is `faff evaluator-preflight`.
//
// WRITE AUTHORITY: `lane-boundary.json` is Evidence class (SKILL.md → Run-artifact write
// authority) — orchestrator/trusted-side only, NEVER lane-written. This command is
// invoked orchestrator-side; it never runs from within a lane.
//
// NEVER writes a broken promise: the assembled intent is validated through
// `computeLaneBoundary` (the SAME pure validator `faff contract lane-boundary` and
// merge-gate.js's laneBoundaryPromisesCage use) BEFORE the file is written — a
// structurally-malformed or out-of-enum intent errors out rather than persisting an
// invalid declaration the merge-gate fail-safe would then read.
//
// LIVE WIRING (per lane). A present, valid `lane-boundary.json` flips merge-gate.js's
// laneBoundaryDispatchState to "dispatched" (custody mandatory, no caller opt-out), so it is
// emitted only where custody is intended:
//   - build lane (`--lane build`): WIRED LIVE by FAFF-894's dispatched-build custody producer.
//     The concurrency dispatcher emits it once at pass start (gateway obligation 7), so a
//     DISPATCHED build run reads "dispatched" and the detective-custody verdict gates its merge;
//     a `build` lane never arms the evaluator cage (laneBoundaryPromisesCage stays evaluator-keyed).
//     Top-level / interactive graft has no dispatch cut and emits NO boundary, so its merges keep
//     `lane-boundary.json` ABSENT and the merge-gate fail-safe byte-for-byte preserved.
//   - evaluator lane (`--lane evaluator`): still SHIP-NOT-WIRE — its live wiring rides with the
//     cage+spawner sibling (FAFF-384); until then no live path emits an evaluator boundary.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { findRoot, dig } = require("./shared-infra");
const { DEFAULTS, loadConfig } = require("./config");
const { computeLaneBoundary } = require("./contract-defs");

// Pure: assemble the v1 lane-boundary intent from the resolved declaration. The
// `accesses`/`integrity_signal` v1 fields reflect the declared CONTAINER (own → the repo
// is withheld; shared → present), unchanged in meaning from v1. `host` is the new
// orthogonal locality axis, carried verbatim. `version` stays 1 — computeLaneBoundary
// never branches on it, and there is no prior production writer to be (in)compatible with.
function buildLaneBoundaryIntent(lane, container, host) {
  const repo = container === "own" ? "absent" : "present";
  const host_socket = container === "own" ? "absent" : "present";
  return { version: 1, lane, container, host, accesses: { repo, host_socket }, integrity_signal: false, violations: [] };
}

// Validate-then-write. Returns { ok:true, path, intent } on a written file, or
// { ok:false, error } when the assembled intent would fail its own contract (never
// writes an invalid promise). `deps.writeFileSync` / `deps.mkdirSync` are injectable so
// the selftest exercises the validate/refuse path without touching the real filesystem.
function emitLaneBoundary(lane, runDir, { container, host }, deps = {}) {
  const write = deps.writeFileSync || fs.writeFileSync;
  const mkdir = deps.mkdirSync || fs.mkdirSync;
  const intent = buildLaneBoundaryIntent(lane, container, host);
  const { contractData, failLoud } = computeLaneBoundary(intent);
  if (failLoud) return { ok: false, error: `refusing to emit — assembled intent is structurally malformed: ${failLoud}` };
  if (contractData.violations.length > 0) {
    return { ok: false, error: `refusing to emit an invalid lane-boundary intent (never write a broken promise): ${contractData.violations.join("; ")}` };
  }
  const outPath = path.join(runDir, "lane-boundary.json");
  mkdir(runDir, { recursive: true });
  write(outPath, JSON.stringify(contractData));
  return { ok: true, path: outPath, intent: contractData };
}

const LANE_BOUNDARY_SPEC = {
  flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--lane": { arity: 1 }, "--run-dir": { arity: 1 } },
  positionals: { min: 0, max: 1, name: "subcommand" },
};
const LANE_BOUNDARY_USAGE = "usage: faff lane-boundary emit --run-dir <dir> [--lane <lane>] [--json]";

function cmdLaneBoundary(args) {
  if (args.includes("--selftest")) return laneBoundarySelftest();
  const { values, positionals, errors } = parseArgs(args, LANE_BOUNDARY_SPEC);
  if (errors.length) return usageError(errors, LANE_BOUNDARY_USAGE);
  const sub = positionals[0];
  if (sub !== "emit") {
    process.stderr.write(`${LANE_BOUNDARY_USAGE}\n${sub ? `unknown subcommand '${sub}'` : "missing subcommand"} — the only subcommand is 'emit'\n`);
    return 2;
  }
  const runDir = values["--run-dir"];
  if (!runDir) { process.stderr.write(`${LANE_BOUNDARY_USAGE}\nemit requires --run-dir\n`); return 2; }
  const lane = values["--lane"] || "evaluator";
  const root = findRoot() || process.cwd();
  const [data] = loadConfig(root);
  const cKey = `lanes.${lane}.isolation.container`;
  const hKey = `lanes.${lane}.isolation.host`;
  const container = dig(data, cKey) ?? DEFAULTS[cKey];
  const host = dig(data, hKey) ?? DEFAULTS[hKey];
  // An unknown lane has no registry default — refuse rather than emit an undefined-shaped intent.
  if (container === undefined || host === undefined) {
    process.stderr.write(`faff lane-boundary emit: unknown lane '${lane}' — no isolation declaration/default resolves for it\n`);
    return 2;
  }
  const res = emitLaneBoundary(lane, runDir, { container, host });
  if (!res.ok) { process.stderr.write(`faff lane-boundary emit: ${res.error}\n`); return 1; }
  if (values["--json"]) {
    console.log(JSON.stringify({ ok: true, path: res.path, intent: res.intent }));
  } else {
    console.log(`wrote ${res.path} (lane=${lane}, container=${container}, host=${host})`);
  }
  return 0;
}

// In-memory selftest over the pure assemble + validate-then-write seam — mirrors the
// container-check / evaluator-preflight selftest shape (per-case ok/FAIL + a RESULT line,
// non-zero on any fail). The write is stubbed so the selftest never touches the real fs.
function laneBoundarySelftest() {
  let fail = 0;
  const captureWrite = () => {
    const calls = [];
    return { calls, deps: { writeFileSync: (p, d) => calls.push({ p, d }), mkdirSync: () => {} } };
  };

  // [lane, container, host, want-ok, want-write-count, want-host-in-file, label]
  const CASES = [
    ["evaluator", "shared", "local", true, 1, "local", "default declaration (shared/local) → writes, host local"],
    ["evaluator", "own", "remote", true, 1, "remote", "own/remote → writes clean, host remote is a top-level sibling"],
    ["evaluator", "own", "local", true, 1, "local", "own/local → writes clean"],
    ["evaluator", "vm", "local", false, 0, null, "off-vocabulary container → refuse, no write (never a broken promise)"],
    ["evaluator", "own", "moon", false, 0, null, "off-vocabulary host → refuse, no write (never a broken promise)"],
  ];
  for (const [lane, container, host, wantOk, wantWrites, wantHost, label] of CASES) {
    const { calls, deps } = captureWrite();
    const res = emitLaneBoundary(lane, "/tmp/run-xyz", { container, host }, deps);
    let ok = res.ok === wantOk && calls.length === wantWrites;
    if (ok && wantOk) {
      let parsed = null; try { parsed = JSON.parse(calls[0].d); } catch { /* leave null → fail */ }
      ok = parsed && parsed.host === wantHost && parsed.container === container
        && parsed.violations.length === 0 && calls[0].p === "/tmp/run-xyz/lane-boundary.json";
    }
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} → ok=${res.ok}/writes=${calls.length}${res.error ? ` (${res.error})` : ""}`);
  }

  // The written intent validates clean through the real contract validator (belt-and-braces:
  // the emitter's own gate IS computeLaneBoundary, so this asserts the round-trip).
  {
    const { calls, deps } = captureWrite();
    emitLaneBoundary("evaluator", "/tmp/run-xyz", { container: "own", host: "remote" }, deps);
    const intent = JSON.parse(calls[0].d);
    const { contractData, failLoud } = computeLaneBoundary(intent);
    const ok = !failLoud && contractData && contractData.violations.length === 0 && contractData.host === "remote";
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} written own/remote intent re-validates clean via computeLaneBoundary`);
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${CASES.length} cases + round-trip, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { cmdLaneBoundary, emitLaneBoundary, buildLaneBoundaryIntent, laneBoundarySelftest, LANE_BOUNDARY_SPEC };
