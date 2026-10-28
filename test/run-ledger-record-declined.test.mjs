// FAFF-1412: `faff run-ledger record-declined` writes `declined[issue] = {reason, at, recorded_at}`
// into a live run ledger under the shared lock, leaves every other field alone, and validates
// against the v0.3 run-ledger schema. Exercised through the real CLI on mkdtempSync repos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { validateEvidenceDocument } = require("../plugin/skills/faff/bin/lib/evidence.js");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "plugin", "skills", "faff", "bin", "faff");
const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.t" };

function env() {
  const e = { ...process.env, ...GIT_ENV };
  for (const k of ["FAFF_RUN_DIR", "FAFF_SESSION_ID", "CLAUDE_CODE_SESSION_ID"]) delete e[k];
  return e;
}
function faff(args, { cwd = REPO, input } = {}) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", env: env(), cwd, input });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}
function gitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-1412-rd-"));
  spawnSync("git", ["-C", dir, "init", "-q", "-b", "main"], { env: env() });
  spawnSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "seed"], { env: env() });
  return dir;
}
function mintL3(root) {
  const r = faff(["run-ledger", "init-self-drain", "--root", root, "--json"]);
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out).run_dir;
}
const ledgerOf = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
const declined = (runDir, issue, reason, observedAt, extra = []) =>
  faff(["run-ledger", "record-declined", "--issue", issue, "--reason", reason, "--observed-at", observedAt, "--run-dir", runDir, ...extra]);

test("record-declined writes the entry, prints --json, and the ledger stays clean and schema-valid", () => {
  const root = gitRepo();
  try {
    const runDir = mintL3(root);
    const before = ledgerOf(runDir);
    const r = declined(runDir, "FAFF-1292", "claimed-by-peer:bundle-recover refused", "2026-10-27T18:53:00Z", ["--json"]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.recorded, true);
    assert.equal(out.issue, "FAFF-1292");
    assert.equal(out.declined.reason, "claimed-by-peer:bundle-recover refused");
    const after = ledgerOf(runDir);
    assert.equal(after.declined["FAFF-1292"].reason, "claimed-by-peer:bundle-recover refused");
    assert.equal(after.declined["FAFF-1292"].at, "2026-10-27T18:53:00.000Z");
    assert.ok(!Number.isNaN(Date.parse(after.declined["FAFF-1292"].recorded_at)));
    for (const k of ["admitted", "outcomes", "owner", "level", "budget"]) assert.deepEqual(after[k], before[k], `${k} unchanged`);
    const v = validateEvidenceDocument("run-ledger.json", after);
    assert.deepEqual(v.violations.map((x) => x.message), []);
    const rc = faff(["runcheck", "--json", runDir]);
    assert.equal(rc.code, 0, rc.out + rc.err);
    const verify = faff(["events", "verify", "--run-dir", runDir]);
    assert.equal(verify.code, 0, verify.out + verify.err);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("default output names the issue and run dir; a second record for the same issue overwrites", () => {
  const root = gitRepo();
  try {
    const runDir = mintL3(root);
    const first = declined(runDir, "FAFF-1318", "inadmissible:first", "2026-10-27T18:53:00Z");
    assert.equal(first.code, 0, first.err);
    assert.equal(first.out, `recorded FAFF-1318 declined in ${runDir}\n`);
    assert.equal(declined(runDir, "FAFF-1318", "inadmissible:second", "2026-10-27T18:55:00Z").code, 0);
    const entry = ledgerOf(runDir).declined["FAFF-1318"];
    assert.equal(entry.reason, "inadmissible:second");
    assert.equal(entry.at, "2026-10-27T18:55:00.000Z");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("control characters in --reason are replaced by spaces", () => {
  const root = gitRepo();
  try {
    const runDir = mintL3(root);
    assert.equal(declined(runDir, "FAFF-1", "a\rb\nc\td", "2026-10-27T18:53:00Z").code, 0);
    assert.equal(ledgerOf(runDir).declined["FAFF-1"].reason, "a b c d");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("bad input exits 2 and writes nothing; any past --observed-at is accepted", () => {
  const root = gitRepo();
  try {
    const runDir = mintL3(root);
    const before = fs.readFileSync(path.join(runDir, "run-ledger.json"));
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    for (const [issue, reason, at] of [
      ["../x", "r", "2026-10-27T18:53:00Z"],
      ["FAFF-1", "", "2026-10-27T18:53:00Z"],
      ["FAFF-1", "\n\t", "2026-10-27T18:53:00Z"],
      ["FAFF-1", "x".repeat(201), "2026-10-27T18:53:00Z"],
      ["FAFF-1", "r", "yesterday"],
      ["FAFF-1", "r", future],
    ]) {
      assert.equal(declined(runDir, issue, reason, at).code, 2, `${issue} ${reason.length} ${at}`);
    }
    assert.deepEqual(fs.readFileSync(path.join(runDir, "run-ledger.json")), before);
    const hoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    assert.equal(declined(runDir, "FAFF-1", "x".repeat(200), hoursAgo).code, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("no resolvable run dir exits 3", () => {
  const root = gitRepo();
  try {
    const r = declined(path.join(root, ".faff", "runs", "missing"), "FAFF-1", "r", "2026-10-27T18:53:00Z");
    assert.equal(r.code, 3, r.err);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("integration: a recorded decline is suppressed by drain-filter until the issue changes", () => {
  const root = gitRepo();
  try {
    const runDir = mintL3(root);
    const observed = new Date(Date.now() - 60 * 1000).toISOString();
    assert.equal(declined(runDir, "FAFF-1318", "inadmissible:test", observed).code, 0);
    const now = new Date(Date.now() + 60 * 1000).toISOString();
    const quiet = faff(["drain-filter", "--root", root, "--now", now], { input: JSON.stringify([{ issue: "FAFF-1318", changed_at: "2026-10-27T07:31:53Z" }]) });
    assert.equal(quiet.code, 0, quiet.err);
    assert.equal(quiet.out, "\n");
    const changed = faff(["drain-filter", "--root", root, "--now", now], { input: JSON.stringify([{ issue: "FAFF-1318", changed_at: new Date().toISOString() }]) });
    assert.equal(changed.out, "FAFF-1318\n");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
