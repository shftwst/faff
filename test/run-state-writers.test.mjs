// FAFF-1258 — the build-progress and landing-progress writers stamp schema_version: 1, redact once, and
// validate against their closed v0.3 schemas before any bytes land.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { validateEvidenceDocument } = require("../plugin/skills/faff/bin/lib/evidence.js");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(REPO, "plugin", "skills", "faff");

function faff(args, { cli = path.join(PLUGIN, "bin", "faff"), cwd = REPO } = {}) {
  const r = spawnSync("node", [cli, ...args], { encoding: "utf8", cwd });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function fixture(rc) {
  const root = mkdtempSync(path.join(tmpdir(), "faff-1258-prog-"));
  mkdirSync(path.join(root, ".git"));
  if (rc) writeFileSync(path.join(root, ".faffrc.yaml"), rc);
  const runDir = path.join(root, ".faff", "runs", "RUN-P");
  mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
  return { root, runDir, file: (n) => path.join(runDir, "FAFF-1", n) };
}

const LEGACY_LANDING = {
  issue: "FAFF-1", fix_cycles: 1, last_head_sha: "abc",
  history: [{ cycle: 1, kind: "conflict", failing_checks: [], tried: ["rebase"], at: "2026-01-01T00:00:00.000Z" }],
  updated_at: "2026-01-01T00:00:00.000Z",
};

const writeBuild = (runDir, extra = [], opts) => faff(["build-progress", "write", runDir, "FAFF-1", "--build-complete", "--diff-hash", "h", "--branch", "b", ...extra], opts);
const recordCycle = (runDir, extra = [], opts) => faff(["landing-progress", "record-fix-cycle", runDir, "FAFF-1", "--kind", "regression", "--head-sha", "def", ...extra], opts);

test("build-progress write stamps schema_version first and validates", () => {
  const f = fixture();
  try {
    const r = writeBuild(f.runDir);
    assert.equal(r.code, 0, r.err);
    const doc = JSON.parse(readFileSync(f.file("build-progress.json"), "utf8"));
    assert.equal(Object.keys(doc)[0], "schema_version");
    assert.equal(doc.schema_version, 1);
    assert.deepEqual(validateEvidenceDocument("build-progress.json", doc).violations, []);
    assert.deepEqual(JSON.parse(r.out), doc);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("landing-progress record-fix-cycle stamps, increments on a legacy record, and read prints a legacy record unchanged", () => {
  const f = fixture();
  try {
    writeFileSync(f.file("landing-progress.json"), JSON.stringify(LEGACY_LANDING));
    const read = faff(["landing-progress", "read", f.runDir, "FAFF-1"]);
    assert.deepEqual(JSON.parse(read.out), LEGACY_LANDING);
    const r = recordCycle(f.runDir);
    assert.equal(r.code, 0, r.err);
    const doc = JSON.parse(readFileSync(f.file("landing-progress.json"), "utf8"));
    assert.equal(Object.keys(doc)[0], "schema_version");
    assert.equal(doc.schema_version, 1);
    assert.equal(doc.fix_cycles, 2);
    assert.deepEqual(validateEvidenceDocument("landing-progress.json", doc).violations, []);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("record-fix-cycle onto a record whose old history entry has an unlisted key succeeds and reports it as pre-existing", () => {
  const f = fixture();
  try {
    const legacy = { ...LEGACY_LANDING, history: [{ ...LEGACY_LANDING.history[0], note: "old" }] };
    writeFileSync(f.file("landing-progress.json"), JSON.stringify(legacy));
    const r = recordCycle(f.runDir);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /pre-existing schema violation.*note/);
    assert.equal(JSON.parse(readFileSync(f.file("landing-progress.json"), "utf8")).fix_cycles, 2);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("an unlisted top-level key left by a hand-edit is carried forward as pre-existing, never blamed on the writer", () => {
  const f = fixture();
  try {
    const r = faff(["landing-progress", "record-fix-cycle", f.runDir, "FAFF-1", "--kind", "regression", "--head-sha", "def"]);
    assert.equal(r.code, 0, r.err);
    // a hand-edit that gave the record an unlisted top-level key is carried forward as pre-existing, never blamed
    const doc = JSON.parse(readFileSync(f.file("landing-progress.json"), "utf8"));
    writeFileSync(f.file("landing-progress.json"), JSON.stringify({ ...doc, scratch: 1 }));
    const next = recordCycle(f.runDir);
    assert.equal(next.code, 0, next.err);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("both writers exit 1 and write nothing when the existing schema_version is not 1, without printing it", () => {
  const f = fixture();
  try {
    const build = JSON.stringify({ schema_version: "S3CR3T-SENTINEL", issue: "FAFF-1" });
    const landing = JSON.stringify({ ...LEGACY_LANDING, schema_version: 2 });
    writeFileSync(f.file("build-progress.json"), build);
    writeFileSync(f.file("landing-progress.json"), landing);
    const b = writeBuild(f.runDir);
    const l = recordCycle(f.runDir);
    assert.equal(b.code, 1);
    assert.equal(l.code, 1);
    assert.equal(readFileSync(f.file("build-progress.json"), "utf8"), build);
    assert.equal(readFileSync(f.file("landing-progress.json"), "utf8"), landing);
    assert.doesNotMatch(b.err + l.err + b.out, /S3CR3T-SENTINEL/);
    assert.match(b.err, /schema_version is not 1/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("a --tried value holding a known secret is written redacted", () => {
  const f = fixture("andon:\n  token: S3CR3T-SENTINEL\n");
  try {
    const r = recordCycle(f.runDir, ["--tried", "used S3CR3T-SENTINEL,rebase"], { cwd: f.root });
    assert.equal(r.code, 0, r.err);
    const raw = readFileSync(f.file("landing-progress.json"), "utf8");
    assert.doesNotMatch(raw + r.out, /S3CR3T-SENTINEL/);
    assert.match(raw, /used \[REDACTED\]/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("with the bundled schema narrowed to reject the record each writer exits 1, prints the violation and leaves the file byte-identical", () => {
  const f = fixture();
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-narrow-"));
  try {
    const copy = path.join(tmp, "faff");
    cpSync(PLUGIN, copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
    const narrow = (name, mutate) => {
      const p = path.join(copy, "contracts", "evidence-v0.3", "schema", `${name}.schema.json`);
      const s = JSON.parse(readFileSync(p, "utf8"));
      mutate(s);
      writeFileSync(p, JSON.stringify(s));
    };
    narrow("build-progress", (s) => { s.properties.build.properties.status.enum = ["draft"]; });
    narrow("landing-progress", (s) => { s.properties.fix_cycles.enum = [0]; });
    const cli = path.join(copy, "bin", "faff");
    const existingBuild = JSON.stringify({ schema_version: 1, issue: "FAFF-1", build: { status: "complete", diff_hash: "x", branch: "b", pushed_at: "t" }, updated_at: "t" });
    writeFileSync(f.file("build-progress.json"), existingBuild);
    const existingLanding = JSON.stringify({ ...LEGACY_LANDING, schema_version: 1 });
    writeFileSync(f.file("landing-progress.json"), existingLanding);
    const b = writeBuild(f.runDir, [], { cli });
    const l = recordCycle(f.runDir, [], { cli });
    assert.equal(b.code, 1, b.err);
    assert.equal(l.code, 1, l.err);
    assert.match(b.err, /build-progress write: build-progress\.json failed schema: .*enum/);
    assert.match(l.err, /landing-progress record-fix-cycle: landing-progress\.json failed schema: .*enum/);
    assert.equal(readFileSync(f.file("build-progress.json"), "utf8"), existingBuild);
    assert.equal(readFileSync(f.file("landing-progress.json"), "utf8"), existingLanding);
  } finally { rmSync(f.root, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true }); }
});

test("both writers use a per-call-unique temp name and leave no temp file behind", () => {
  const src = readFileSync(path.join(PLUGIN, "bin", "lib", "effects.js"), "utf8");
  const cmdBuild = src.slice(src.indexOf("function cmdBuildProgress"), src.indexOf("function buildProgressSelftest"));
  const cmdLanding = src.slice(src.indexOf("function cmdLandingProgress"), src.indexOf("function landingProgressSelftest"));
  for (const body of [cmdBuild, cmdLanding]) assert.doesNotMatch(body, /\.tmp"/, "no fixed .tmp sibling");
  assert.match(src.slice(src.indexOf("function writeRunState"), src.indexOf("function cmdBuildProgress")), /atomicWriteSingleValueFile/);
  const f = fixture();
  try {
    assert.equal(writeBuild(f.runDir).code, 0);
    assert.equal(recordCycle(f.runDir).code, 0);
    assert.deepEqual(readdirSync(path.join(f.runDir, "FAFF-1")).sort(), ["build-progress.json", "landing-progress.json"]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("review-progress stays unstamped (out of scope) and the 3-cycle cap is unchanged", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 3; i++) assert.equal(recordCycle(f.runDir).code, 0);
    const fourth = recordCycle(f.runDir);
    assert.equal(fourth.code, 2);
    assert.equal(JSON.parse(readFileSync(f.file("landing-progress.json"), "utf8")).fix_cycles, 3);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
