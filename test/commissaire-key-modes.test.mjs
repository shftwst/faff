// FAFF-1195 — `contract admit` writes Commissaire key material owner-only: governor.json and
// producers/<id>.json are 0600 from the moment they exist, inside 0700 key directories. Existing
// directories and run dirs written before the change keep their modes, and still verify.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  governorDirOf, producerDirOf, governorFileOf, producerFileOf, pkFileOf, writeOwnerOnlyJson,
} from "../plugin/skills/faff/bin/lib/commissaire.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = join(HERE, "..", "plugin", "skills", "faff", "bin");
const FAFF_BIN = join(BIN_DIR, "faff");
const COMMISSAIRE_BIN = join(BIN_DIR, "commissaire");

const modeOf = (p) => statSync(p).mode & 0o777;
const octal = (m) => m.toString(8);

// Runs a binary under an explicit umask, so the assertions never depend on the caller's shell.
function runUnder(umask, argv, input = "") {
  const r = spawnSync("/bin/sh", ["-c", `umask ${umask}; exec "$0" "$@"`, process.execPath, ...argv], { encoding: "utf8", input });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status };
}
const faff = (args, input, umask = "022") => runUnder(umask, [FAFF_BIN, "commissaire", ...args], input);
const standalone = (args, umask = "022") => runUnder(umask, [COMMISSAIRE_BIN, ...args]);
const admitArgs = (runDir, extra = []) => ["contract", "admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge", ...extra];

function mkRun(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", "RUN-MODES");
  mkdirSync(runDir, { recursive: true });
  return { root, runDir };
}
const tmpLeftovers = (dir) => readdirSync(dir).filter((n) => n.endsWith(".tmp"));

function assertOwnerOnly(governorDir, producerDir) {
  assert.equal(octal(modeOf(governorFileOf(governorDir))), "600", "governor.json");
  assert.equal(octal(modeOf(producerFileOf(producerDir, "P1"))), "600", "producers/P1.json");
  assert.equal(octal(modeOf(governorDir)), "700", "governor dir");
  assert.equal(octal(modeOf(producerDir)), "700", "producer dir");
  assert.equal(octal(modeOf(join(producerDir, "producers"))), "700", "producers dir");
}

test("faff commissaire admit: secret files 0600, key directories 0700, commissaire/ and pk.json at the umask default", () => {
  const { root, runDir } = mkRun("modes-default-");
  try {
    const r = faff(admitArgs(runDir));
    assert.equal(r.code, 0, r.stderr);
    assertOwnerOnly(governorDirOf(runDir), producerDirOf(runDir));
    assert.equal(octal(modeOf(join(runDir, "commissaire"))), "755", "commissaire/ is not a key directory");
    assert.equal(octal(modeOf(pkFileOf(producerDirOf(runDir)))), "644", "pk.json is public");
    assert.deepEqual(tmpLeftovers(governorDirOf(runDir)), []);
    assert.deepEqual(tmpLeftovers(join(producerDirOf(runDir), "producers")), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("bin/commissaire admit under umask 000: modes are set at creation, not inherited from the umask", () => {
  const { root, runDir } = mkRun("modes-umask0-");
  try {
    const r = standalone(admitArgs(runDir), "000");
    assert.equal(r.code, 0, r.stderr);
    assertOwnerOnly(governorDirOf(runDir), producerDirOf(runDir));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--governor-dir that already exists keeps its mode; a missing --producer-dir is created 0700", () => {
  const { root, runDir } = mkRun("modes-overrides-");
  try {
    const g = join(root, "custody", "gov");
    const q = join(root, "custody", "prod");
    mkdirSync(g, { recursive: true });
    chmodSync(g, 0o755);
    const r = faff(admitArgs(runDir, ["--governor-dir", g, "--producer-dir", q]));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(octal(modeOf(g)), "755", "an existing directory is never chmod-ed");
    assert.equal(octal(modeOf(governorFileOf(g))), "600");
    assert.equal(octal(modeOf(q)), "700");
    assert.equal(octal(modeOf(join(q, "producers"))), "700");
    assert.equal(octal(modeOf(producerFileOf(q, "P1"))), "600");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--force rotation over a 0644 governor.json leaves a 0600 file and no temp file", () => {
  const { root, runDir } = mkRun("modes-force-");
  try {
    assert.equal(faff(admitArgs(runDir)).code, 0);
    const gov = governorFileOf(governorDirOf(runDir));
    chmodSync(gov, 0o644);
    const r = faff(admitArgs(runDir, ["--force"]));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(octal(modeOf(gov)), "600");
    assert.deepEqual(tmpLeftovers(governorDirOf(runDir)), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a run at the pre-change modes still declares, authorizes and passes audit verify, with every key mode unchanged", () => {
  const { root, runDir } = mkRun("modes-legacy-");
  try {
    assert.equal(faff(admitArgs(runDir)).code, 0);
    const legacy = new Map([
      [governorDirOf(runDir), 0o755], [governorFileOf(governorDirOf(runDir)), 0o644],
      [producerDirOf(runDir), 0o755], [join(producerDirOf(runDir), "producers"), 0o755],
      [producerFileOf(producerDirOf(runDir), "P1"), 0o644],
    ]);
    for (const [p, m] of legacy) chmodSync(p, m);
    const effect = { kind: "merge", target: "main" };
    assert.equal(faff(["effect", "declare", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], JSON.stringify([effect])).code, 0);
    const auth = faff(["effect", "authorize", "--run-dir", runDir, "--producer", "P1", "--unit-id", "FAFF-1", "--step", "merge"], JSON.stringify({ effect }));
    assert.equal(auth.code, 0, auth.stderr);
    assert.equal(JSON.parse(auth.stdout.trim()).verdict, "grant");
    const verify = faff(["audit", "verify", "--run-dir", runDir]);
    assert.equal(verify.code, 0, verify.stderr);
    for (const [p, m] of legacy) assert.equal(octal(modeOf(p)), octal(m), `${p} keeps its mode`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("writeOwnerOnlyJson: a failed rename throws and leaves no temp file behind", () => {
  const root = mkdtempSync(join(tmpdir(), "modes-rename-fail-"));
  try {
    const target = join(root, "governor.json");
    mkdirSync(target);
    writeFileSync(join(target, "occupant"), "x");
    assert.throws(() => writeOwnerOnlyJson(target, { sk: "s" }));
    assert.deepEqual(tmpLeftovers(root), []);
    assert.ok(existsSync(join(target, "occupant")), "the existing target is untouched");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
