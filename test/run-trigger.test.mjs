// FAFF-1418 — `faff run trigger`: beep-boop's L4 run-start trigger (§0a) as one verb.
// The decision is driven through the pure `decideTrigger` and the real `run-start` ladder; the
// procedure through `runTrigger` with injected deps (each child's reply scripted, every call
// recorded); the exit codes through `cmdRunTrigger`; and end-to-end runs through the shipped CLI
// against real temp repos. Case names cite the spec's rule-inventory rows (T1–T39).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const rt = require("../plugin/skills/faff/bin/lib/run-trigger.js");
const runStart = require("../plugin/skills/faff/bin/lib/run-start.js");

const RUN_ID = "run-20261101-120000-lights-out";
const ROOT = "/tmp/faff-run-trigger-fake-root";
const RUN_DIR = `${ROOT}/.faff/runs/${RUN_ID}`;
const PRD_FILE = `${ROOT}/records/prd/demo.md`;

// --- Fakes ---

const ok = (obj) => ({ status: 0, stdout: typeof obj === "string" ? obj : JSON.stringify(obj), stderr: "" });
const fail = (status = 1) => ({ status, stdout: "", stderr: "boom" });
const READINESS_OK = { verdict: "admissible", reason: "", stop_conditions_verifiable: true, creative_licence: "tight", conformant: true, violations: [] };
const readinessFile = (block) => `Some prose from the slot.\n\n\`\`\`faff-contract:prd-readiness\n${typeof block === "string" ? block : JSON.stringify(block)}\n\`\`\`\n`;
const BLOCK = { verdict: "admissible", reason: "", stop_conditions_verifiable: true, creative_licence: "tight" };

// Replies are keyed by the first one or two argv words; "run-start" replies with the real ladder.
function fakeDeps({ replies = {}, config = {}, files = {}, classify = { verdict: "inherited-l4", runDir: RUN_DIR }, existing = [PRD_FILE] } = {}) {
  const calls = [];
  const markers = [];
  const mints = [];
  const base = {
    "prd list": ok([{ slug: "demo", container: "Demo", status: "Active" }]),
    "prd path": ok(`${PRD_FILE}\n`),
    "run-outward": (args) => {
      const target = JSON.parse(args[args.indexOf("--target") + 1]);
      const self = JSON.parse(args[args.indexOf("--self") + 1]);
      return ok(require("../plugin/skills/faff/bin/lib/run-outward.js").decideOutward(target, self));
    },
    "contract prd-readiness": ok(READINESS_OK),
    "prdr coverage": ok({ covered: false, uncovered_goals: ["g1"], satisfied: false }),
    "run-start": (args) => {
      const signals = JSON.parse(args[args.indexOf("--signals") + 1]);
      const v = runStart.deriveRunTrigger(runStart.normalizeRunTriggerSignals(signals));
      return ok({ ...v, signals });
    },
    "run-record-prd": ok("{}"),
  };
  const table = { ...base, ...replies };
  let counter = 0;
  return {
    calls,
    markers,
    mints,
    faff: (args, opts) => {
      calls.push({ args, input: opts.input, env: opts.env });
      const two = `${args[0]} ${args[1]}`;
      const reply = table[two] ?? table[args[0]];
      if (reply === undefined) throw new Error(`unscripted child: ${args.join(" ")}`);
      return typeof reply === "function" ? reply(args, opts) : reply;
    },
    configGet: (_root, key) => (key in config ? config[key] : null),
    classify: () => classify,
    mintId: (_root, run, kernel) => { counter += 1; const id = `${run}/__run__/${kernel}/${counter}`; mints.push(id); return id; },
    marker: (_root, run, kernel, id, action) => { markers.push({ run, kernel, id, action }); },
    readFile: (f) => { if (!(f in files)) throw new Error(`ENOENT ${f}`); return files[f]; },
    fileSize: (f) => { if (!(f in files)) throw new Error(`ENOENT ${f}`); return Buffer.byteLength(files[f]); },
    exists: (f) => existing.includes(f),
  };
}

const args = (over = {}) => ({ runDir: RUN_DIR, root: ROOT, readinessFile: null, slotUnreachable: false, goalsFile: null, afterPlan: false, correlationId: null, ...over });
const withInputs = (over = {}) => args({ readinessFile: "/r.out", goalsFile: "/g.json", ...over });
const filesFor = (block = BLOCK, goals = ["g1"]) => ({ "/r.out": readinessFile(block), "/g.json": JSON.stringify(goals) });
const childNames = (deps) => deps.calls.map((c) => (c.args[0].startsWith("run-") ? c.args[0] : `${c.args[0]} ${c.args[1]}`));

// --- decideTrigger and the ladder (one per verdict × reason) ---

const AFFIRM = { prd_present: true, prd_ambiguous: false, target_resolved: true, outward: true, prd_admissible: true, coverage_measurable: true, coverage_covered: true, needs_prd_inputs: false };
const ladder = (reads) => { const d = rt.decideTrigger(reads); return runStart.deriveRunTrigger(runStart.normalizeRunTriggerSignals(d.signals)); };

for (const [name, over, verdict, reason] of [
  ["plan/coverage-thin", { coverage_covered: false }, "plan", "coverage-thin"],
  ["drain/prd-covered", {}, "drain", "prd-covered"],
  ["drain/no-prd-nothing-to-plan", { prd_present: false }, "drain", "no-prd-nothing-to-plan"],
  ["refuse/no-target", { target_resolved: false }, "refuse", "no-target"],
  ["refuse/self-directed", { outward: false }, "refuse", "self-directed"],
  ["refuse/prd-ambiguous", { prd_ambiguous: true }, "refuse", "prd-ambiguous"],
  ["refuse/prd-inadmissible", { prd_admissible: false }, "refuse", "prd-inadmissible"],
  ["refuse/coverage-unmeasurable", { coverage_measurable: false }, "refuse", "coverage-unmeasurable"],
]) {
  test(`T6 decideTrigger drives run-start to ${name}`, () => {
    assert.deepEqual(ladder({ ...AFFIRM, ...over }), { verdict, reason });
  });
}

test("T6 decideTrigger: needs_prd_inputs yields needs-judgement:prd-inputs and no signals", () => {
  assert.deepEqual(rt.decideTrigger({ ...AFFIRM, needs_prd_inputs: true }), { signals: null, token_if_no_kernel: "needs-judgement:prd-inputs" });
});

test("T6 decideTrigger: a non-boolean read is never an affirmative signal", () => {
  const d = rt.decideTrigger({ ...AFFIRM, outward: "yes", prd_admissible: 1 });
  assert.equal(d.signals.outward, false);
  assert.equal(d.signals.prd_admissible, false);
});

// --- Classify (T1–T5, T37, T38) ---

test("T2/T37 not-l4 is skip and spawns nothing, reads no config and mints nothing", () => {
  const deps = fakeDeps({ classify: { verdict: "not-l4", reason: "no FAFF_RUN_DIR" } });
  deps.configGet = () => { throw new Error("config read on skip"); };
  const r = rt.runTrigger(args({ runDir: undefined }), deps);
  assert.equal(r.token, "skip");
  assert.equal(r.classify.verdict, "not-l4");
  assert.equal(r.verdict, null);
  assert.deepEqual(deps.calls, []);
  assert.deepEqual(deps.mints, []);
});

test("T3/T38 fault spawns nothing and exits 3 via the token", () => {
  const deps = fakeDeps({ classify: { verdict: "fault", reason: "FAFF_RUN_DIR names a dir with no run-ledger.json" } });
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.token, "fault");
  assert.equal(r.classify.reason, "FAFF_RUN_DIR names a dir with no run-ledger.json");
  assert.deepEqual(deps.calls, []);
});

test("T5/T28 no path mints or calls lights-out", () => {
  const deps = fakeDeps({ files: filesFor() });
  rt.runTrigger(withInputs(), deps);
  assert.ok(!deps.calls.some((c) => c.args[0] === "lights-out" || (c.args[0] === "run-ledger" && /^init/.test(c.args[1] ?? ""))));
});

// --- PRD selection (T7–T12) ---

test("T7 one PRD → its container", () => {
  const deps = fakeDeps();
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.prd.container, "Demo");
  assert.equal(r.prd.present, true);
});

test("T8 zero PRDs → no-PRD, and no-PRD drains as nothing-to-plan", () => {
  const deps = fakeDeps({ replies: { "prd list": ok([]) }, config: { "tracking.container": null } });
  // target unresolved without a PRD and with no config → refuse/no-target
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.prd.present, false);
  assert.equal(r.token, "refuse");
  assert.equal(r.verdict.reason, "no-target");
});

test("T9 several PRDs with one Active/Frozen survivor → it", () => {
  const deps = fakeDeps({ replies: { "prd list": ok([{ container: "Old", status: "Superseded" }, { container: "Demo", status: "Frozen (2026-10-01)" }]) } });
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.prd.container, "Demo");
  assert.equal(r.token, "needs-judgement:prd-inputs");
});

test("T10 several PRDs with zero survivors → no-PRD (plot's entry rule)", () => {
  const deps = fakeDeps({ replies: { "prd list": ok([{ container: "A", status: "Draft" }, { container: "B", status: "Superseded" }]) } });
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.prd.present, false);
  assert.equal(r.prd.ambiguous, false);
});

test("T9 several PRDs with two survivors → ambiguous → refuse/prd-ambiguous", () => {
  // An outward target, so the ladder reaches the PRD rungs.
  const deps = fakeDeps({ replies: { "prd list": ok([{ container: "A", status: "Active" }, { container: "B", status: "Active" }]), "run-outward": ok({ target: {}, outward: true, reason: "outward-adopter" }) }, config: { "tracking.container": "X" } });
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.prd.ambiguous, true);
  assert.equal(r.verdict.reason, "prd-ambiguous");
  assert.equal(r.token, "refuse");
});

test("T11 a failed prd list is ambiguous and refuses, never a silent no-PRD drain", () => {
  for (const reply of [fail(), ok("not json"), ok({ not: "an array" })]) {
    const deps = fakeDeps({ replies: { "prd list": reply, "run-outward": ok({ target: {}, outward: true, reason: "outward-adopter" }) }, config: { "tracking.container": "X" } });
    const r = rt.runTrigger(args(), deps);
    assert.equal(r.prd.ambiguous, true);
    assert.ok(r.diagnostics.includes("prd-list-failed"));
    assert.equal(r.verdict.reason, "prd-ambiguous");
    assert.equal(r.token, "refuse");
  }
});

test("T12 prd path non-zero → no-PRD", () => {
  const deps = fakeDeps({ replies: { "prd path": fail() } });
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.prd.present, false);
  assert.ok(r.diagnostics.includes("prd-file-missing"));
});

test("T12 PRD file missing → no-PRD", () => {
  const deps = fakeDeps({ existing: [] });
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.prd.present, false);
  assert.equal(r.prd.path, null);
});

// --- Target and self (T13–T17) ---

test("T13 container falls back to tracking.container when no PRD", () => {
  const deps = fakeDeps({ replies: { "prd list": ok([]) }, config: { "tracking.container": "Cfg" } });
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.target.container, "Cfg");
  assert.equal(r.self.container, "Cfg");
});

test("T14/T16 repo is one read reused for self; is_self by repo-slug match", () => {
  const deps = fakeDeps({ replies: { "prd list": ok([]) }, config: { "tracking.repo": "o/r" } });
  const r = rt.runTrigger(args(), deps);
  assert.deepEqual(r.target, { container: null, repo: "o/r" });
  assert.deepEqual(r.self, { container: null, repo: "o/r", is_self: true });
  assert.equal(r.verdict.reason, "self-directed");
});

test("T15 target_resolved is false with neither container nor repo", () => {
  const deps = fakeDeps({ replies: { "prd list": ok([]) } });
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.signals.target_resolved, false);
  assert.equal(r.verdict.reason, "no-target");
});

test("T17 run-outward failing (non-zero or unparseable) → outward false, refuse", () => {
  for (const reply of [fail(2), ok("garbage")]) {
    const deps = fakeDeps({ replies: { "run-outward": reply }, files: filesFor() });
    const r = rt.runTrigger(withInputs(), deps);
    assert.equal(r.outward, null);
    assert.equal(r.signals.outward, false);
    assert.ok(r.diagnostics.includes("run-outward-failed"));
    assert.equal(r.token, "refuse");
  }
});

// --- The judgement seam and readiness (T18–T20) ---

test("T19 present PRD with no readiness input → needs-judgement:prd-inputs; no kernel consulted, no capture base", () => {
  const deps = fakeDeps({ config: { "slots.prd": "faffter-noon-prd" } });
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.token, "needs-judgement:prd-inputs");
  assert.equal(r.prd.path, PRD_FILE);
  assert.equal(r.prd.slot, "faffter-noon-prd");
  assert.equal(r.verdict, null);
  assert.ok(!childNames(deps).includes("run-outward"));
  assert.ok(!childNames(deps).includes("run-start"));
  assert.deepEqual(deps.mints, []);
  assert.deepEqual(deps.markers, []);
});

test("T18 --prd-slot-unreachable → prd_admissible false, prd-inadmissible", () => {
  const deps = fakeDeps({ files: { "/g.json": "[\"g1\"]" } });
  const r = rt.runTrigger(args({ slotUnreachable: true, goalsFile: "/g.json" }), deps);
  assert.ok(r.diagnostics.includes("prd-slot-unreachable"));
  assert.equal(r.signals.prd_admissible, false);
  assert.equal(r.verdict.reason, "prd-inadmissible");
});

for (const [name, file, diag] of [
  ["block missing", "no fenced block here\n", "prd-readiness-block-missing"],
  ["two blocks", readinessFile(BLOCK) + readinessFile(BLOCK), "prd-readiness-block-malformed"],
  ["malformed JSON", readinessFile("{not json"), "prd-readiness-block-malformed"],
]) {
  test(`T20 readiness ${name} → admissible false (${diag})`, () => {
    const deps = fakeDeps({ files: { "/r.out": file, "/g.json": "[\"g1\"]" } });
    const r = rt.runTrigger(withInputs(), deps);
    assert.ok(r.diagnostics.includes(diag), JSON.stringify(r.diagnostics));
    assert.equal(r.signals.prd_admissible, false);
    assert.equal(r.creative_licence, null);
    assert.equal(r.token, "refuse");
    assert.ok(!childNames(deps).includes("contract prd-readiness"));
  });
}

test("T20 a readiness file over 1 MiB is malformed and never read", () => {
  const big = "x".repeat(1024 * 1024 + 1);
  const deps = fakeDeps({ files: { "/r.out": big, "/g.json": "[\"g1\"]" } });
  let read = false;
  const realRead = deps.readFile;
  deps.readFile = (f) => { if (f === "/r.out") read = true; return realRead(f); };
  const r = rt.runTrigger(withInputs(), deps);
  assert.ok(r.diagnostics.includes("prd-readiness-block-malformed"));
  assert.equal(read, false);
});

for (const [name, reply, diag] of [
  ["contract exit 1", { status: 1, stdout: JSON.stringify({ ...READINESS_OK, conformant: false }), stderr: "" }, true],
  ["contract exit 2", fail(2), true],
  ["not-ready", ok({ ...READINESS_OK, verdict: "not-ready", reason: "no-stop-conditions" }), false],
]) {
  test(`T20 readiness ${name} → admissible false, licence null`, () => {
    const deps = fakeDeps({ replies: { "contract prd-readiness": reply }, files: filesFor() });
    const r = rt.runTrigger(withInputs(), deps);
    assert.equal(r.signals.prd_admissible, false);
    assert.equal(r.creative_licence, null);
    assert.equal(r.diagnostics.includes("prd-readiness-contract-failed"), diag);
    assert.equal(r.verdict.reason, "prd-inadmissible");
  });
}

test("T20 the licence is the contract verb's validated output, never the raw block", () => {
  const deps = fakeDeps({ replies: { "contract prd-readiness": ok({ ...READINESS_OK, creative_licence: "broad" }) }, files: filesFor({ ...BLOCK, creative_licence: "tight" }) });
  const r = rt.runTrigger(withInputs(), deps);
  assert.equal(r.creative_licence, "broad");
  const call = deps.calls.find((c) => c.args[0] === "contract");
  assert.deepEqual(JSON.parse(call.input), { ...BLOCK, creative_licence: "tight" });
});

// --- Coverage (T21–T25) ---

test("T21 coverage is not read for an inadmissible PRD", () => {
  const deps = fakeDeps({ replies: { "contract prd-readiness": ok({ ...READINESS_OK, verdict: "not-ready", reason: "other" }) }, files: filesFor() });
  const r = rt.runTrigger(withInputs(), deps);
  assert.ok(!childNames(deps).includes("prdr coverage"));
  assert.equal(r.signals.coverage_measurable, false);
  assert.equal(r.signals.coverage_covered, false);
});

for (const [name, goalsText, diag] of [
  ["goals unparseable", "{not json", "prd-goals-missing"],
  ["goals not strings", "[1, 2]", "prd-goals-missing"],
  ["goals empty", "[]", "prd-goals-empty"],
]) {
  test(`T25 ${name} → coverage unmeasurable → refuse/coverage-unmeasurable`, () => {
    const deps = fakeDeps({ files: { "/r.out": readinessFile(BLOCK), "/g.json": goalsText } });
    const r = rt.runTrigger(withInputs(), deps);
    assert.ok(r.diagnostics.includes(diag));
    assert.equal(r.verdict.reason, "coverage-unmeasurable");
    assert.ok(!childNames(deps).includes("prdr coverage"));
  });
}

test("T22 goals flag missing → prd-goals-missing", () => {
  const deps = fakeDeps({ files: { "/r.out": readinessFile(BLOCK) } });
  const r = rt.runTrigger(args({ readinessFile: "/r.out" }), deps);
  assert.ok(r.diagnostics.includes("prd-goals-missing"));
  assert.equal(r.verdict.reason, "coverage-unmeasurable");
});

test("T23 coverage passes --container and --prd-goals, never --live-prdrs or --dod-verdicts", () => {
  const deps = fakeDeps({ files: filesFor() });
  rt.runTrigger(withInputs(), deps);
  const call = deps.calls.find((c) => c.args[0] === "prdr");
  assert.equal(call.args[call.args.indexOf("--container") + 1], "Demo");
  assert.deepEqual(JSON.parse(call.args[call.args.indexOf("--prd-goals") + 1]), ["g1"]);
  assert.ok(!call.args.includes("--live-prdrs"));
  assert.ok(!call.args.includes("--dod-verdicts"));
});

for (const [name, reply] of [["non-zero", fail()], ["unparseable", ok("nope")], ["no boolean covered", ok({ uncovered_goals: [] })]]) {
  test(`T24 coverage ${name} → measurable false, refuse/coverage-unmeasurable`, () => {
    const deps = fakeDeps({ replies: { "prdr coverage": reply }, files: filesFor() });
    const r = rt.runTrigger(withInputs(), deps);
    assert.ok(r.diagnostics.includes("coverage-failed"));
    assert.equal(r.verdict.reason, "coverage-unmeasurable");
  });
}

// --- The kernel (T26, T27) ---

test("T26/T36 the deciding call spawns run-start with the seven signals; plan on thin coverage", () => {
  const deps = fakeDeps({ files: filesFor() });
  const r = rt.runTrigger(withInputs(), deps);
  assert.equal(r.token, "plan");
  assert.equal(r.verdict.reason, "coverage-thin");
  assert.equal(r.creative_licence, "tight");
  assert.equal(r.signals.outward, true);
  const call = deps.calls.find((c) => c.args[0] === "run-start");
  assert.deepEqual(Object.keys(JSON.parse(call.args[call.args.indexOf("--signals") + 1])).sort(), ["coverage_covered", "coverage_measurable", "outward", "prd_admissible", "prd_ambiguous", "prd_present", "target_resolved"]);
});

test("T27 run-start failing → refuse with a null reason and run-start-failed", () => {
  for (const reply of [fail(2), ok("garbage"), ok({ verdict: "maybe" })]) {
    const deps = fakeDeps({ replies: { "run-start": reply }, files: filesFor() });
    const r = rt.runTrigger(withInputs(), deps);
    assert.deepEqual(r.verdict, { verdict: "refuse", reason: null });
    assert.ok(r.diagnostics.includes("run-start-failed"));
    assert.equal(r.token, "refuse");
  }
});

// --- Records (T31, T33, T34) ---

test("T33 drain with a licence records it", () => {
  const deps = fakeDeps({ replies: { "prdr coverage": ok({ covered: true, uncovered_goals: [] }) }, files: filesFor() });
  const r = rt.runTrigger(withInputs(), deps);
  assert.equal(r.token, "drain");
  assert.equal(r.verdict.reason, "prd-covered");
  const rec = deps.calls.find((c) => c.args[0] === "run-record-prd");
  assert.deepEqual(rec.args, ["run-record-prd", "--run-dir", RUN_DIR, "--prd-creative-licence", "tight"]);
  assert.deepEqual(r.recorded, { licence: "tight", root_container: null });
});

test("T33 drain on no-PRD records nothing", () => {
  const deps = fakeDeps({ replies: { "prd list": ok([]), "run-outward": ok({ target: {}, outward: true, reason: "outward-adopter" }) }, config: { "tracking.container": "Elsewhere" } });
  const r = rt.runTrigger(args(), deps);
  assert.equal(r.token, "drain");
  assert.equal(r.verdict.reason, "no-prd-nothing-to-plan");
  assert.ok(!childNames(deps).includes("run-record-prd"));
  assert.equal(r.recorded, null);
});

test("T33 a record that exits 4 (fence yielded) is record-failed", () => {
  const deps = fakeDeps({ replies: { "prdr coverage": ok({ covered: true, uncovered_goals: [] }), "run-record-prd": fail(4) }, files: filesFor() });
  const r = rt.runTrigger(withInputs(), deps);
  assert.equal(r.token, "record-failed");
  assert.ok(r.diagnostics.includes("run-record-prd-exit-4"));
});

test("T34 refuse writes nothing: no record, no close", () => {
  const deps = fakeDeps({ replies: { "contract prd-readiness": fail(2) }, files: filesFor() });
  const r = rt.runTrigger(withInputs(), deps);
  assert.equal(r.token, "refuse");
  assert.ok(!childNames(deps).some((n) => n === "run-record-prd" || n === "run close" || n === "run-ledger close"));
});

test("T34 refuse with a validated licence still records nothing", () => {
  const deps = fakeDeps({ files: filesFor(BLOCK, []) });
  const r = rt.runTrigger(withInputs(), deps);
  assert.equal(r.token, "refuse");
  assert.equal(r.verdict.reason, "coverage-unmeasurable");
  assert.equal(r.creative_licence, "tight");
  assert.ok(!childNames(deps).some((n) => n === "run-record-prd" || n === "run close" || n === "run-ledger close"));
  assert.equal(r.recorded, null);
});

// --- Phase C (T30, T31) ---

test("T30/T31 after-plan records licence and container, marks plan on the given id, returns recorded", () => {
  const deps = fakeDeps({ files: filesFor() });
  const r = rt.runTrigger(withInputs({ afterPlan: true, correlationId: `${RUN_ID}/__run__/run-start/7` }), deps);
  assert.equal(r.token, "recorded");
  const rec = deps.calls.find((c) => c.args[0] === "run-record-prd");
  assert.deepEqual(rec.args, ["run-record-prd", "--run-dir", RUN_DIR, "--prd-creative-licence", "tight", "--prd-root-container", "Demo"]);
  assert.deepEqual(deps.markers, [{ run: RUN_ID, kernel: "run-start", id: `${RUN_ID}/__run__/run-start/7`, action: "plan" }]);
  assert.ok(!childNames(deps).includes("run-start"));
  assert.ok(!childNames(deps).includes("run-outward"));
});

test("T30 after-plan: a still-thin re-read is not a stop; a failed re-read is never read as done", () => {
  for (const reply of [ok({ covered: false, uncovered_goals: ["g1"] }), fail()]) {
    const deps = fakeDeps({ replies: { "prdr coverage": reply }, files: filesFor() });
    const r = rt.runTrigger(withInputs({ afterPlan: true, correlationId: "x/__run__/run-start/1" }), deps);
    assert.equal(r.token, "recorded");
    if (reply.status !== 0) assert.ok(r.diagnostics.includes("coverage-failed"));
  }
});

test("T31 after-plan: a non-zero record is record-failed", () => {
  const deps = fakeDeps({ replies: { "run-record-prd": fail(1) }, files: filesFor() });
  const r = rt.runTrigger(withInputs({ afterPlan: true, correlationId: "x/__run__/run-start/1" }), deps);
  assert.equal(r.token, "record-failed");
  assert.deepEqual(deps.markers, []);
});

// --- Capture (T35, T36) ---

test("T35 each consult runs under its own minted id and its marker closes the same id", () => {
  const deps = fakeDeps({ replies: { "prdr coverage": ok({ covered: true, uncovered_goals: [] }) }, files: filesFor() });
  const r = rt.runTrigger(withInputs(), deps);
  const outCall = deps.calls.find((c) => c.args[0] === "run-outward");
  const startCall = deps.calls.find((c) => c.args[0] === "run-start");
  assert.equal(outCall.env.FAFF_DECISION_ISSUE, "__run__");
  assert.equal(startCall.env.FAFF_DECISION_ISSUE, "__run__");
  assert.equal(outCall.env.FAFF_RUN_DIR, RUN_DIR);
  const outMarker = deps.markers.find((m) => m.kernel === "run-outward");
  const startMarker = deps.markers.find((m) => m.kernel === "run-start");
  assert.equal(outMarker.id, outCall.env.FAFF_DECISION_CORRELATION_ID);
  assert.equal(startMarker.id, startCall.env.FAFF_DECISION_CORRELATION_ID);
  assert.notEqual(outMarker.id, startMarker.id);
  assert.equal(outMarker.action, "outward-adopter");
  assert.equal(startMarker.action, "drain");
  assert.equal(r.run_start_correlation_id, startMarker.id);
});

test("T36 an inward outward marks the inward reason; plan writes no run-start marker on the deciding call", () => {
  const deps = fakeDeps({ replies: { "prd list": ok([]) }, config: { "tracking.repo": "o/r" } });
  rt.runTrigger(args(), deps);
  assert.equal(deps.markers.find((m) => m.kernel === "run-outward").action, "self-marked");
  const deps2 = fakeDeps({ files: filesFor() });
  const r2 = rt.runTrigger(withInputs(), deps2);
  assert.equal(r2.token, "plan");
  assert.ok(!deps2.markers.some((m) => m.kernel === "run-start"));
});

test("T35 a failing capture never changes the token", () => {
  const deps = fakeDeps({ files: filesFor() });
  deps.mintId = () => { throw new Error("mint failed"); };
  deps.marker = () => { throw new Error("marker failed"); };
  const r = rt.runTrigger(withInputs(), deps);
  assert.equal(r.token, "plan");
  assert.equal(r.run_start_correlation_id, null);
});

// --- The verb: exit codes and usage ---

function cli(argv, env = {}, cwd = undefined) {
  const r = spawnSync(process.execPath, [CLI, "run", "trigger", ...argv], { encoding: "utf8", cwd, env: { HOME: process.env.HOME, PATH: process.env.PATH, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test("exit 2 on bad flag combinations, printing no result", () => {
  for (const argv of [
    ["--prd-readiness", "/x", "--prd-slot-unreachable", "--json"],
    ["--after-plan", "--prd-slot-unreachable", "--json"],
    ["--after-plan", "--correlation-id", "id", "--json"],
    ["--correlation-id", "id", "--json"],
  ]) {
    const r = cli(argv);
    assert.equal(r.code, 2, argv.join(" "));
    assert.equal(r.out, "");
  }
});

test("cmdRunTrigger maps tokens to exits: skip 0, plan 0, refuse 3, fault 3, record-failed 3", () => {
  const capture = (fn) => { const w = process.stdout.write; let out = ""; process.stdout.write = (s) => { out += s; return true; }; try { return { code: fn(), out }; } finally { process.stdout.write = w; } };
  const quiet = (fn) => { const w = process.stderr.write; process.stderr.write = () => true; try { return fn(); } finally { process.stderr.write = w; } };
  const files = filesFor();
  const cases = [
    [fakeDeps({ classify: { verdict: "not-l4", reason: "x" } }), [], 0, "skip"],
    [fakeDeps({ classify: { verdict: "fault", reason: "x" } }), [], 3, "fault"],
    [fakeDeps({ files }), ["--prd-readiness", "/r.out", "--prd-goals", "/g.json"], 0, "plan"],
    [fakeDeps({ files: filesFor(BLOCK, []) }), ["--prd-readiness", "/r.out", "--prd-goals", "/g.json"], 3, "refuse"],
    [fakeDeps({ files, replies: { "prdr coverage": ok({ covered: true }), "run-record-prd": fail(4) } }), ["--prd-readiness", "/r.out", "--prd-goals", "/g.json"], 3, "record-failed"],
  ];
  for (const [deps, extra, code, token] of cases) {
    const r = quiet(() => capture(() => rt.cmdRunTrigger(["--run-dir", RUN_DIR, "--root", ROOT, "--json", ...extra], deps)));
    assert.equal(r.code, code, token);
    assert.equal(JSON.parse(r.out).token, token);
  }
});

test("an unreadable --prd-goals path on the L4 path is exit 2 with no result", () => {
  const deps = fakeDeps({ files: { "/r.out": readinessFile(BLOCK) } });
  const w = process.stdout.write; let out = ""; process.stdout.write = (s) => { out += s; return true; };
  const e = process.stderr.write; process.stderr.write = () => true;
  let code;
  try { code = rt.cmdRunTrigger(["--run-dir", RUN_DIR, "--root", ROOT, "--prd-readiness", "/r.out", "--prd-goals", "/missing.json", "--json"], deps); }
  finally { process.stdout.write = w; process.stderr.write = e; }
  assert.equal(code, 2);
  assert.equal(out, "");
});

test("without --json it prints the token, the reason and each diagnostic", () => {
  const deps = fakeDeps({ files: filesFor(BLOCK, []) });
  const w = process.stdout.write; let out = ""; process.stdout.write = (s) => { out += s; return true; };
  try { rt.cmdRunTrigger(["--run-dir", RUN_DIR, "--root", ROOT, "--prd-readiness", "/r.out", "--prd-goals", "/g.json"], deps); }
  finally { process.stdout.write = w; }
  assert.deepEqual(out.trim().split("\n"), ["trigger: refuse", "reason: coverage-unmeasurable", "diagnostic: prd-goals-empty"]);
});

// --- End to end through the shipped CLI ---

function git(cwd, ...a) { spawnSync("git", a, { cwd, encoding: "utf8" }); }

function repo({ config = "", prd = false, prdr = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-run-trigger-"));
  git(root, "init", "-q");
  mkdirSync(join(root, ".faff"), { recursive: true });
  writeFileSync(join(root, ".faff", "config.yaml"), config);
  const runDir = join(root, ".faff", "runs", RUN_ID);
  mkdirSync(runDir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ run_id: RUN_ID, level: "L4", admitted: [], outcomes: {}, prd_creative_licence: null, prd_root_container: null, owner: { status: "running", session_id: "s", pid: 1, started_at: now, last_heartbeat: now } }, null, 2));
  const env = { FAFF_RUN_DIR: runDir };
  if (prd) {
    const r = spawnSync(process.execPath, [CLI, "prd", "new", "Demo", "--status", "Active", "--root", root], { encoding: "utf8", env: { HOME: process.env.HOME, PATH: process.env.PATH } });
    assert.equal(r.status, 0, r.stderr);
  }
  if (prdr) {
    const r = spawnSync(process.execPath, [CLI, "prdr", "new", "Cover g1", "--container", "Demo", "--prd-goals", "[\"g1\"]", "--root", root], { encoding: "utf8", env: { HOME: process.env.HOME, PATH: process.env.PATH } });
    assert.equal(r.status, 0, r.stderr);
  }
  return { root, runDir, env, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const write = (dir, name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };

test("e2e: FAFF_RUN_DIR unset → skip, exit 0", () => {
  const r = cli(["--json"]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.out);
  assert.equal(out.token, "skip");
  assert.equal(out.classify.verdict, "not-l4");
  assert.equal(out.verdict, null);
});

test("e2e: a run dir with no run-ledger.json → fault, exit 3, nothing written", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-run-trigger-empty-"));
  try {
    const r = cli(["--json"], { FAFF_RUN_DIR: dir });
    assert.equal(r.code, 3);
    assert.equal(JSON.parse(r.out).token, "fault");
    assert.deepEqual(readdirSync(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("e2e: one Active PRD and no readiness input → needs-judgement:prd-inputs", () => {
  const fx = repo({ prd: true });
  try {
    const r = cli(["--json"], fx.env, fx.root);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.token, "needs-judgement:prd-inputs");
    assert.ok(out.prd.path.startsWith(fx.root) && out.prd.path.endsWith("demo.md") && existsSync(out.prd.path), out.prd.path);
    assert.equal(out.verdict, null);
  } finally { fx.cleanup(); }
});

test("e2e: admissible readiness and an uncovered goal → plan/coverage-thin", () => {
  const fx = repo({ prd: true });
  try {
    const rf = write(fx.root, "r.out", readinessFile(BLOCK));
    const gf = write(fx.root, "g.json", "[\"g1\"]");
    const r = cli(["--prd-readiness", rf, "--prd-goals", gf, "--json"], fx.env, fx.root);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.token, "plan");
    assert.equal(out.verdict.reason, "coverage-thin");
    assert.equal(out.creative_licence, "tight");
    assert.equal(out.signals.outward, true);
  } finally { fx.cleanup(); }
});

test("e2e: empty goals → refuse/coverage-unmeasurable, exit 3", () => {
  const fx = repo({ prd: true });
  try {
    const rf = write(fx.root, "r.out", readinessFile(BLOCK));
    const gf = write(fx.root, "g.json", "[]");
    const r = cli(["--prd-readiness", rf, "--prd-goals", gf, "--json"], fx.env, fx.root);
    assert.equal(r.code, 3, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.token, "refuse");
    assert.equal(out.verdict.reason, "coverage-unmeasurable");
    assert.ok(out.diagnostics.includes("prd-goals-empty"));
  } finally { fx.cleanup(); }
});

test("e2e: tracking.repo set and no PRD → refuse/self-directed; ledger bytes unchanged", () => {
  const fx = repo({ config: "tracking:\n  repo: owner/repo\n" });
  try {
    const before = readFileSync(join(fx.runDir, "run-ledger.json"));
    const r = cli(["--json"], fx.env, fx.root);
    assert.equal(r.code, 3, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.token, "refuse");
    assert.equal(out.verdict.reason, "self-directed");
    assert.deepEqual(readFileSync(join(fx.runDir, "run-ledger.json")), before);
  } finally { fx.cleanup(); }
});

test("e2e: refuse after the PRD-present path leaves run-ledger.json byte-identical", () => {
  const fx = repo({ prd: true });
  try {
    const before = readFileSync(join(fx.runDir, "run-ledger.json"));
    const r = cli(["--prd-slot-unreachable", "--json"], fx.env, fx.root);
    assert.equal(r.code, 3, r.err);
    assert.equal(JSON.parse(r.out).verdict.reason, "prd-inadmissible");
    assert.deepEqual(readFileSync(join(fx.runDir, "run-ledger.json")), before);
  } finally { fx.cleanup(); }
});

test("e2e: drain/prd-covered with real children records the licence on the ledger", () => {
  const fx = repo({ prd: true, prdr: true });
  try {
    const rf = write(fx.root, "r.out", readinessFile(BLOCK));
    const gf = write(fx.root, "g.json", "[\"g1\"]");
    const r = cli(["--prd-readiness", rf, "--prd-goals", gf, "--json"], fx.env, fx.root);
    assert.equal(r.code, 0, r.err + r.out);
    const out = JSON.parse(r.out);
    assert.equal(out.token, "drain", JSON.stringify(out));
    assert.equal(out.verdict.reason, "prd-covered");
    assert.deepEqual(out.recorded, { licence: "tight", root_container: null });
    assert.equal(JSON.parse(readFileSync(join(fx.runDir, "run-ledger.json"), "utf8")).prd_creative_licence, "tight");
  } finally { fx.cleanup(); }
});

test("e2e: with capture off, no decision-capture events are written", () => {
  const fx = repo({ prd: true, prdr: true });
  try {
    const rf = write(fx.root, "r.out", readinessFile(BLOCK));
    const gf = write(fx.root, "g.json", "[\"g1\"]");
    cli(["--prd-readiness", rf, "--prd-goals", gf, "--json"], fx.env, fx.root);
    const ev = join(fx.runDir, "events.jsonl");
    const text = existsSync(ev) ? readFileSync(ev, "utf8") : "";
    assert.ok(!text.includes("decision-capture"));
  } finally { fx.cleanup(); }
});

// Capture on, against a real genesis chain: each consult's base and its marker share one id, and the
// judgement-seam call writes no base that no marker could close.
function captureRepo(withPrd) {
  const fx = repo({ config: "capture:\n  decision_kernel: \"on\"\n", prd: withPrd });
  const r = spawnSync(process.execPath, [CLI, "events", "append", "--run", RUN_ID, "--root", fx.root], { encoding: "utf8", input: JSON.stringify({ phase: "run", type: "run-start", data: {} }), env: { HOME: process.env.HOME, PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stderr);
  return fx;
}
const captureEvents = (runDir) => readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "decision-capture" || e.type === "decision-capture-action");

test("e2e T35: with capture on, each consult's base and marker share an id under __run__", () => {
  const fx = captureRepo(false);
  try {
    const r = cli(["--json"], fx.env, fx.root);
    assert.equal(r.code, 3, r.err);
    const out = JSON.parse(r.out);
    const ev = captureEvents(fx.runDir);
    for (const kernel of ["run-outward", "run-start"]) {
      const base = ev.filter((e) => e.type === "decision-capture" && e.data.kernel === kernel);
      const marker = ev.filter((e) => e.type === "decision-capture-action" && e.data.kernel === kernel);
      assert.equal(base.length, 1, kernel);
      assert.equal(marker.length, 1, kernel);
      assert.equal(base[0].issue, "__run__");
      assert.ok(base[0].data.correlation_id !== "");
      assert.equal(marker[0].data.correlation_id, base[0].data.correlation_id);
    }
    assert.equal(out.run_start_correlation_id, ev.find((e) => e.type === "decision-capture" && e.data.kernel === "run-start").data.correlation_id);
    assert.equal(ev.find((e) => e.type === "decision-capture-action" && e.data.kernel === "run-start").data.selected_action, "refuse");
  } finally { fx.cleanup(); }
});

test("e2e T35: the needs-judgement:prd-inputs call writes no capture base", () => {
  const fx = captureRepo(true);
  try {
    const r = cli(["--json"], fx.env, fx.root);
    assert.equal(JSON.parse(r.out).token, "needs-judgement:prd-inputs");
    assert.deepEqual(captureEvents(fx.runDir), []);
  } finally { fx.cleanup(); }
});
