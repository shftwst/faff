// FAFF-999 — the standalone `commissaire` binary: byte-identical parity with `faff commissaire …`,
// and the import-independence guard proving its require graph never reaches an orchestration module.
//
// The parity tests spawn BOTH entrypoints (the real shebang dispatch, exactly as users invoke them)
// and assert identical stdout/stderr/exit. The independence guard reuses regions.js's own
// regionsRequireEdges walker rather than re-solving comment/string-embedded require detection, and
// proves itself live against a deliberately-tainted fixture (a copy of commissaire.js with one
// injected denylisted require — the real source tree is never mutated).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { regionsRequireEdges } from "../plugin/skills/faff/bin/lib/regions.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const BIN_DIR = join(REPO, "plugin", "skills", "faff", "bin");
const FAFF = join(BIN_DIR, "faff");
const COMMISSAIRE = join(BIN_DIR, "commissaire");
const LIB = join(BIN_DIR, "lib");

// The eleven orchestration-module basenames the standalone binary must never reach — derived from
// regions.js's REGION_MAP factory entries naming scheduling/tracker/harness concerns.
const DENYLIST = new Set([
  "tracker", "harness", "engine", "next", "project-next", "run-start",
  "run-done", "queue-state", "lights-out", "self-intake", "scenario-matrix",
]);

// The wired grammar (canonical object-action keys) + the flat FAFF-828 aliases.
const CANONICAL = [
  ["contract", "admit"], ["effect", "declare"], ["effect", "authorize"], ["effect", "observe"],
  ["effect", "reconcile"], ["verdict", "conclude"], ["audit", "seal"], ["audit", "verify"],
];
const ALIASES = ["admit", "declare", "request-decision", "observe", "reconcile", "terminal-verdict", "seal-bundle"];

function run(bin, args, opts = {}) {
  const r = spawnSync("node", [bin, ...args], { cwd: REPO, input: opts.input, encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
}

// Assert `faff commissaire <args>` and `commissaire <args>` are byte-for-byte identical.
function assertParity(args, opts = {}) {
  const a = run(FAFF, ["commissaire", ...args], opts);
  const b = run(COMMISSAIRE, args, opts);
  const label = args.join(" ") || "(no args)";
  assert.equal(b.stdout, a.stdout, `stdout parity for: ${label}`);
  assert.equal(b.stderr, a.stderr, `stderr parity for: ${label}`);
  assert.equal(b.code, a.code, `exit parity for: ${label}`);
  return a;
}

test("no-args usage error is byte-identical across both entrypoints (exit 2)", () => {
  const a = assertParity([]);
  assert.equal(a.code, 2);
});

test("-h / --help falls through to usage identically", () => {
  assertParity(["-h"]);
  assertParity(["--help"]);
});

test("each wired verb's usage/validation error is byte-identical (missing required flags)", () => {
  for (const key of CANONICAL) assertParity(key);
});

test("each flat-verb alias's usage/validation error is byte-identical", () => {
  for (const a of ALIASES) assertParity([a]);
});

test("success path: `contract admit` dispatches the real handler identically on both entrypoints", () => {
  // Fresh run-dir per invocation (admit mutates); pin --ts so any timestamp is deterministic.
  function admit(viaFaff) {
    const dir = mkdtempSync(join(tmpdir(), "cmsr-standalone-"));
    const args = ["contract", "admit", "--run-dir", dir, "--producer", "P1",
      "--contract-revision", "r1", "--scope", "merge", "--ts", "2026-01-01T00:00:00Z"];
    const r = viaFaff ? run(FAFF, ["commissaire", ...args]) : run(COMMISSAIRE, args);
    return { r, dir };
  }
  const A = admit(true);
  const B = admit(false);
  try {
    assert.equal(A.r.code, 0, `faff commissaire admit failed: ${A.r.stderr}`);
    assert.equal(B.r.code, 0, `commissaire admit failed: ${B.r.stderr}`);
    // Both entrypoints ran the real handler: each stdout is the same admission JSON shape, and each
    // wrote a structurally-identical admission record. (Byte-identity across the two is impossible —
    // admit mints a random governor keypair and embeds the run-dir basename in run_id.)
    for (const j of [A.r, B.r]) {
      const out = JSON.parse(j.stdout);
      assert.equal(out.admitted, true);
      assert.equal(out.producer_id, "P1");
      assert.deepEqual(out.admitted_scope, ["merge"]);
    }
    for (const dir of [A.dir, B.dir]) {
      const rec = JSON.parse(readFileSync(join(dir, "declared-effects.jsonl"), "utf8").trim());
      assert.equal(rec.kind_of_entry, "admission");
      assert.equal(rec.author, "commissaire");
      assert.equal(rec.contract_revision, "r1");
      assert.deepEqual(rec.payload.admitted_scope, ["merge"]);
    }
  } finally {
    rmSync(A.dir, { recursive: true, force: true });
    rmSync(B.dir, { recursive: true, force: true });
  }
});

test("standalone `commissaire --selftest` passes (full admit->declare->authorize->reconcile round trip)", () => {
  const r = run(COMMISSAIRE, ["--selftest"]);
  assert.equal(r.code, 0, `commissaire --selftest failed: ${r.stderr}`);
});

// --- Import-independence guard ------------------------------------------------------------------

function libSourceSet(extra = []) {
  const files = readdirSync(LIB).filter((f) => f.endsWith(".js")).map((f) => join(LIB, f));
  return new Set([...files, FAFF, COMMISSAIRE, ...extra]);
}

// Walk the transitive require closure from `seeds`, returning every visited file + any require
// edge regions.js could not attribute (a non-literal argument, or a spec resolving outside the set).
function walk(seeds, sourceSet) {
  const visited = new Set();
  const malformed = [];
  const emptyMap = new Map(); // only edge.toFile is used here — no region banner needed
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const { edges, malformed: mf } = regionsRequireEdges(file, emptyMap, sourceSet);
    malformed.push(...mf);
    for (const e of edges) queue.push(e.toFile);
  }
  return { visited, malformed };
}

test("the standalone commissaire require graph never reaches an orchestration module", () => {
  const sourceSet = libSourceSet();
  const { visited, malformed } = walk([COMMISSAIRE, join(LIB, "commissaire.js")], sourceSet);

  assert.deepEqual(malformed, [], `unattributable / outside-set requires: ${malformed.join("; ")}`);

  const denyHits = [...visited].filter((f) => DENYLIST.has(basename(f, ".js")));
  assert.deepEqual(denyHits.map((f) => basename(f)), [],
    `denylisted orchestration modules are reachable: ${denyHits.map((f) => basename(f)).join(", ")}`);

  const outside = [...visited].filter((f) => !f.startsWith(BIN_DIR + "/"));
  assert.deepEqual(outside, [], `files resolved outside plugin/skills/faff/bin/: ${outside.join(", ")}`);
});

// --- FAFF-1000: runtime spawn-guard --------------------------------------------------------------
// The static walk proves commissaire.js never REQUIRES the faff bin's graph; this proves the
// depth'd `verdict conclude` / `audit seal` never EXEC it either (a require-graph guard cannot catch
// a dynamically-constructed spawn). A fresh child node process patches child_process.spawnSync to
// record every call BEFORE requiring lib/commissaire.js, sets up a governed run + a directly-minted
// run-close anchor, drives the two verbs through COMMISSAIRE_DISPATCH in-process, and exits non-zero
// if any recorded spawn names the faff ENTRYPOINT. commissaireSelftest's own legitimate faff-bin
// spawns are never reached — the harness calls the dispatch table directly, never --selftest.
test("FAFF-1000 runtime spawn-guard: neither `verdict conclude` nor `audit seal` spawns the faff bin", () => {
  const harness = join(tmpdir(), `commissaire-spawnguard-${process.pid}.cjs`);
  const body = `
const cp = require("node:child_process");
const realSpawnSync = cp.spawnSync;
const calls = [];
// Record every call, then DELEGATE to the real spawnSync so any legitimate non-faff tool (git for a
// manifest hash, say) still behaves — the assertion is specifically "no spawn names the faff bin".
cp.spawnSync = function (command, args, options) { calls.push({ command, args: args || [] }); return realSpawnSync.call(cp, command, args, options); };

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const LIB = ${JSON.stringify(LIB)};
const { ENTRYPOINT } = require(path.join(LIB, "shared-infra.js"));
// Requiring commissaire.js AFTER the patch: its own \`const { spawnSync } = require("node:child_process")\`
// destructures the patched function out of the fresh child's module cache.
const { COMMISSAIRE_DISPATCH } = require(path.join(LIB, "commissaire.js"));
const { mintIssueAnchor } = require(path.join(LIB, "events.js"));

// Feed the stdin-reading verbs (declare/authorize/observe) their payloads without a real pipe: a
// queue drained through a targeted fs.readFileSync(0, ...) override.
let stdinQueue = [];
const realReadFileSync = fs.readFileSync;
fs.readFileSync = function (p, ...rest) { if (p === 0) return stdinQueue.length ? stdinQueue.shift() : ""; return realReadFileSync.call(fs, p, ...rest); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmsr-spawnguard-"));
const runId = "RUN-GUARD";
const runDir = path.join(root, ".faff", "runs", runId);
fs.mkdirSync(runDir, { recursive: true });
const D = (key, flags) => COMMISSAIRE_DISPATCH[key](flags);

let rc = 0;
try {
  if (D("contract admit", { "--run-dir": runDir, "--producer": "P1", "--contract-revision": "r1", "--scope": "merge" }) !== 0) throw new Error("admit");
  stdinQueue.push(JSON.stringify([{ kind: "merge", target: "main" }]));
  if (D("effect declare", { "--run-dir": runDir, "--producer": "P1", "--issue": "FAFF-1", "--step": "merge" }) !== 0) throw new Error("declare");
  stdinQueue.push(JSON.stringify({ effect: { kind: "merge", target: "main" } }));
  if (D("effect authorize", { "--run-dir": runDir, "--producer": "P1", "--issue": "FAFF-1", "--step": "merge" }) !== 0) throw new Error("authorize");
  stdinQueue.push(JSON.stringify([{ kind: "merge", target: "main" }]));
  if (D("effect observe", { "--run-dir": runDir, "--producer": "P1", "--issue": "FAFF-1", "--step": "merge" }) !== 0) throw new Error("observe");

  // run-ledger + a directly-minted run-close anchor (fs writes under root/.faff/anchors/<run_id>/) —
  // never via \`faff events anchor-run\`; the guard's whole point is a path with no faff-bin call.
  fs.writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { epoch: 0, status: "done" } }));
  fs.writeFileSync(path.join(runDir, "events.jsonl"), '{"schema":1,"run_id":"' + runId + '","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\\n');
  fs.mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
  const anchorRoot = path.join(root, ".faff", "anchors", runId);
  const mint = mintIssueAnchor(runDir, "FAFF-1", path.join(anchorRoot, "FAFF-1"));
  if (!mint.ok) throw new Error("anchor mint");
  fs.mkdirSync(anchorRoot, { recursive: true });
  fs.writeFileSync(path.join(anchorRoot, "summary.md"), "# run\\n");

  // Measure ONLY the two verbs under test.
  calls.length = 0;
  const vc = D("verdict conclude", { "--run-dir": runDir, "--issue": "FAFF-1" });
  const seal = D("audit seal", { "--run-dir": runDir, "--root": root });
  if (vc !== 0) throw new Error("verdict conclude exit " + vc);
  if (seal !== 0) throw new Error("audit seal exit " + seal);

  const faffSpawns = calls.filter((c) => c.command === ENTRYPOINT || (c.args || []).some((a) => a === ENTRYPOINT));
  if (faffSpawns.length !== 0) { process.stderr.write("faff-bin spawn detected: " + JSON.stringify(faffSpawns) + "\\n"); rc = 3; }
} catch (e) {
  process.stderr.write("spawn-guard setup error: " + (e && e.stack || e) + "\\n");
  rc = 2;
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}
process.exit(rc);
`;
  try {
    writeFileSync(harness, body);
    const r = spawnSync("node", [harness], { cwd: REPO, encoding: "utf8" });
    assert.equal(r.status, 0, `spawn-guard child exited ${r.status}: ${r.stderr}`);
  } finally {
    rmSync(harness, { force: true });
  }
});

test("the independence guard fires against a tainted fixture (proves it is not vacuous)", () => {
  // Copy commissaire.js into bin/lib as a temp sibling and inject one denylisted require, so
  // `./tracker` resolves EXACTLY as a real edge would. The real commissaire.js is never touched.
  const taint = join(LIB, `commissaire-taint-${process.pid}.js`);
  try {
    const body = readFileSync(join(LIB, "commissaire.js"), "utf8") + '\nrequire("./tracker");\n';
    writeFileSync(taint, body);
    const { visited } = walk([taint], libSourceSet([taint]));
    const denyHits = [...visited].filter((f) => DENYLIST.has(basename(f, ".js")));
    assert.ok(
      denyHits.some((f) => basename(f) === "tracker.js"),
      "tainted fixture must trip the denylist on tracker.js — otherwise the guard is vacuous",
    );
  } finally {
    rmSync(taint, { force: true });
  }
});
