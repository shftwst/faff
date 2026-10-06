// FAFF-1176 — `commissaire contract status` (the governed/custody read the runner's skills use instead of
// testing for the governor file by path) and `readChokepointKeyRecord` (the key resolver merge-gate reads
// instead of building the pk.json path). Both must reach exactly the decision today's file reads reach for
// every on-disk state, including malformed files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  readChokepointKeyRecord, governorFileOf, governorDirOf, pkFileOf, producerDirOf,
  COMMISSAIRE_DISPATCH, COMMISSAIRE_ALIASES, REQUIRED_FLAGS_BY_CANONICAL, COMMISSAIRE_SURFACE,
} from "../plugin/skills/faff/bin/lib/commissaire.js";
import {
  resolveCommissaireDecisionGrant, resolvePrCreateGrant, resolveBranchDeleteGrant,
  mergeCoveredBySchema3Grant, prCreateCoveredBySchema3Grant,
} from "../plugin/skills/faff/bin/lib/merge-gate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMISSAIRE_BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "commissaire");
const KEYS = ["governed", "custody", "pk_fingerprint"];

function mkRun(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", "RUN-STATUS");
  mkdirSync(runDir, { recursive: true });
  return { root, runDir };
}
const faff = (args, input) => runCli(["commissaire", ...args], { input });
const standalone = (args) => {
  const r = spawnSync(process.execPath, [COMMISSAIRE_BIN, ...args], { encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
};
function admit(runDir, extra = []) {
  const r = faff(["contract", "admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1",
    "--scope", "merge,branch-delete,pr-create", ...extra]);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
}
function parseOne(stdout) {
  const lines = stdout.split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1, `exactly one stdout line, got ${lines.length}`);
  return JSON.parse(lines[0]);
}

// --- The verb --------------------------------------------------------------------------------

test("admitted run: governed, in-process custody, the fingerprint admit printed; stdout is byte-exact and carries no secret key", () => {
  const { root, runDir } = mkRun("status-admitted-");
  try {
    const admitted = admit(runDir);
    const r = faff(["contract", "status", "--run-dir", runDir, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, JSON.stringify({ governed: true, custody: "in-process", pk_fingerprint: admitted.pk_fingerprint }) + "\n");
    const out = parseOne(r.stdout);
    assert.deepEqual(Object.keys(out), KEYS);
    assert.ok(!("sk" in out) && !("master_secret" in out));
    assert.ok(!r.stdout.includes("master_secret") && !r.stdout.includes('"sk"'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("ungoverned run (no commissaire dir): not governed, null custody and fingerprint", () => {
  const { root, runDir } = mkRun("status-ungoverned-");
  try {
    const r = faff(["contract", "status", "--run-dir", runDir]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, JSON.stringify({ governed: false, custody: null, pk_fingerprint: null }) + "\n");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a governor file that exists but is empty, invalid JSON, or lacks a string pk_fingerprint still reads governed (file existence is the predicate)", () => {
  const cases = [["", "empty"], ["{not json", "invalid JSON"], ["{}", "object without pk_fingerprint"], [JSON.stringify({ pk_fingerprint: 7 }), "non-string pk_fingerprint"], ["null", "JSON null"]];
  for (const [body, label] of cases) {
    const { root, runDir } = mkRun("status-corrupt-");
    try {
      admit(runDir);
      writeFileSync(governorFileOf(governorDirOf(runDir)), body);
      const r = faff(["contract", "status", "--run-dir", runDir]);
      assert.equal(r.code, 0, `${label}: ${r.stderr}`);
      assert.deepEqual(parseOne(r.stdout), { governed: true, custody: "in-process", pk_fingerprint: null }, label);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("a run dir that does not exist, a path to a regular file, or no --run-dir at all: exit 2, nothing on stdout", () => {
  const { root, runDir } = mkRun("status-missing-");
  try {
    const file = join(root, "a-file");
    writeFileSync(file, "x");
    for (const args of [["--run-dir", join(root, "nope")], ["--run-dir", file], []]) {
      const r = faff(["contract", "status", ...args]);
      assert.equal(r.code, 2, `args ${JSON.stringify(args)}`);
      assert.equal(r.stdout, "");
      assert.notEqual(r.stderr, "");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--governor-dir D reads D/governor.json; without it the same run reads not governed", () => {
  const { root, runDir } = mkRun("status-govdir-");
  try {
    const g = join(root, "elsewhere-governor");
    const admitted = admit(runDir, ["--governor-dir", g]);
    const withDir = faff(["contract", "status", "--run-dir", runDir, "--governor-dir", g]);
    assert.equal(withDir.code, 0, withDir.stderr);
    assert.deepEqual(parseOne(withDir.stdout), { governed: true, custody: "in-process", pk_fingerprint: admitted.pk_fingerprint });
    const without = faff(["contract", "status", "--run-dir", runDir]);
    assert.deepEqual(parseOne(without.stdout), { governed: false, custody: null, pk_fingerprint: null });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--json changes nothing: stdout is byte-identical with and without it, governed and ungoverned", () => {
  const { root, runDir } = mkRun("status-json-");
  try {
    const a = faff(["contract", "status", "--run-dir", runDir]).stdout;
    assert.equal(faff(["contract", "status", "--run-dir", runDir, "--json"]).stdout, a);
    admit(runDir);
    const b = faff(["contract", "status", "--run-dir", runDir]).stdout;
    assert.equal(faff(["contract", "status", "--run-dir", runDir, "--json"]).stdout, b);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the standalone commissaire binary answers identically to faff commissaire", () => {
  const { root, runDir } = mkRun("status-standalone-");
  try {
    assert.equal(standalone(["contract", "status", "--run-dir", runDir]).stdout, faff(["contract", "status", "--run-dir", runDir]).stdout);
    admit(runDir);
    const s = standalone(["contract", "status", "--run-dir", runDir, "--json"]);
    assert.equal(s.code, 0, s.stderr);
    assert.equal(s.stdout, faff(["contract", "status", "--run-dir", runDir, "--json"]).stdout);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("contract status is a canonical dispatch key requiring --run-dir, with no flat alias, listed in usage and the CLI surface", () => {
  assert.equal(typeof COMMISSAIRE_DISPATCH["contract status"], "function");
  assert.deepEqual(REQUIRED_FLAGS_BY_CANONICAL["contract status"], ["--run-dir"]);
  assert.ok(!Object.values(COMMISSAIRE_ALIASES).includes("contract status"));
  assert.ok(!("status" in COMMISSAIRE_ALIASES));
  assert.deepEqual(COMMISSAIRE_SURFACE.subcommands["contract status"], { required_flags: ["--run-dir"] });
  const usage = faff(["contract"]);
  assert.match(usage.stderr, /contract status\s+--run-dir DIR/);
});

// --- The resolver and merge-gate parity ------------------------------------------------------

test("readChokepointKeyRecord: ok:false for a missing or unparseable pk.json, else the parsed value unvalidated", () => {
  const { root, runDir } = mkRun("status-resolver-");
  try {
    assert.deepEqual(readChokepointKeyRecord(runDir), { ok: false });
    mkdirSync(producerDirOf(runDir), { recursive: true });
    const pk = pkFileOf(producerDirOf(runDir));
    writeFileSync(pk, "{not json");
    assert.deepEqual(readChokepointKeyRecord(runDir), { ok: false });
    writeFileSync(pk, "null");
    assert.deepEqual(readChokepointKeyRecord(runDir), { ok: true, record: null });
    writeFileSync(pk, JSON.stringify({ pk: "P", pk_fingerprint: "F" }));
    assert.deepEqual(readChokepointKeyRecord(runDir), { ok: true, record: { pk: "P", pk_fingerprint: "F" } });
    const other = join(root, "other-producer");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "pk.json"), JSON.stringify({ pk: "Q" }));
    assert.deepEqual(readChokepointKeyRecord(runDir, other), { ok: true, record: { pk: "Q" } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A governed run with covering grants for merge, branch-delete (both at step merge) and pr-create.
function grantedRun(prefix) {
  const { root, runDir } = mkRun(prefix);
  admit(runDir);
  const step = (kind, stepName, target) => {
    assert.equal(faff(["effect", "declare", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", stepName], JSON.stringify([{ kind, target }])).code, 0);
    const a = faff(["effect", "authorize", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", stepName], JSON.stringify({ effect: { kind, target } }));
    assert.equal(a.code, 0, a.stderr);
    assert.equal(JSON.parse(a.stdout.trim()).verdict, "grant");
  };
  step("merge", "merge", "main");
  step("branch-delete", "merge", "feature");
  step("pr-create", "pr-create", "main");
  return { root, runDir, pk: pkFileOf(producerDirOf(runDir)) };
}
const legs = (runDir) => ({
  merge: resolveCommissaireDecisionGrant(runDir, "FAFF-1", "main"),
  prCreate: resolvePrCreateGrant(runDir, "FAFF-1", "main"),
  branchDelete: resolveBranchDeleteGrant(runDir, "FAFF-1", "feature"),
});

test("parity: a valid pk.json grants all three legs", () => {
  const { root, runDir } = grantedRun("parity-valid-");
  try {
    assert.deepEqual(legs(runDir), { merge: "valid-grant", prCreate: "valid-grant", branchDelete: "valid-grant" });
    assert.equal(mergeCoveredBySchema3Grant(runDir, "FAFF-1", "main"), true);
    assert.equal(prCreateCoveredBySchema3Grant(runDir, "FAFF-1", "main"), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("parity: a missing or invalid-JSON pk.json fails every leg closed", () => {
  for (const mutate of [(pk) => rmSync(pk), (pk) => writeFileSync(pk, "{not json")]) {
    const { root, runDir, pk } = grantedRun("parity-unreadable-");
    try {
      mutate(pk);
      assert.deepEqual(legs(runDir), { merge: "absent-or-invalid", prCreate: "absent-or-invalid", branchDelete: "absent-or-invalid" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("parity: a pk.json holding JSON null still throws TypeError from the three resolvers, and the two covered-by helpers still catch it", () => {
  const { root, runDir, pk } = grantedRun("parity-null-");
  try {
    writeFileSync(pk, "null");
    assert.throws(() => resolveCommissaireDecisionGrant(runDir, "FAFF-1", "main"), TypeError);
    assert.throws(() => resolvePrCreateGrant(runDir, "FAFF-1", "main"), TypeError);
    assert.throws(() => resolveBranchDeleteGrant(runDir, "FAFF-1", "feature"), TypeError);
    assert.equal(mergeCoveredBySchema3Grant(runDir, "FAFF-1", "main"), false);
    assert.equal(prCreateCoveredBySchema3Grant(runDir, "FAFF-1", "main"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("parity: a pk.json swapped for a foreign key with its own matching fingerprint refuses a grant signed by the real governor", () => {
  const { root, runDir, pk } = grantedRun("parity-swapped-");
  try {
    const foreign = mkRun("parity-foreign-");
    try {
      admit(foreign.runDir);
      writeFileSync(pk, readFileSync(pkFileOf(producerDirOf(foreign.runDir)), "utf8"));
    } finally { rmSync(foreign.root, { recursive: true, force: true }); }
    assert.deepEqual(legs(runDir), { merge: "absent-or-invalid", prCreate: "absent-or-invalid", branchDelete: "absent-or-invalid" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
