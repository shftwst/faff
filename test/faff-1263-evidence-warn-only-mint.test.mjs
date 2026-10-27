// FAFF-1263: the warn-only evidence-schema check at the per-PR mint and the report-only
// governance-check leg. Neither may change an exit code, stdout or the bytes written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, cpSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli } from "./helpers/run-cli.mjs";
import { mkChainedRun, writeEvidence, example, repoRoot } from "./helpers/evidence-anchor-fixtures.mjs";

const require = createRequire(import.meta.url);
const SENTINEL = "S3CR3T-SENTINEL";
// Under GitHub Actions governance-check prints real ::error:: annotation commands; the tests read plain output.
delete process.env.GITHUB_ACTIONS;

function fixture(shape, { mutate } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "faff-1263-"));
  const run = mkChainedRun(root);
  writeEvidence(run, shape);
  if (mutate) mutate(run);
  const dest = path.join(root, "dest");
  return { root, run, dest, mint: () => runCli(["events", "anchor", "--run-dir", run, "--issue", "FAFF-1", "--dest", dest]) };
}
const cleanup = (f) => rmSync(f.root, { recursive: true, force: true });
const filesOf = (dir) => readdirSync(dir).sort();

test("a legacy-shaped mint exits 0, keeps stdout, copies byte-equal files and warns on stderr", () => {
  const f = fixture("legacy");
  try {
    const r = f.mint();
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^events anchor: .* → .* \(head_seq 1, head_sha256 [0-9a-f]{12}…, 2 lines, schema_floor 2\) \+ ac-checklist\.json, review-verdict\.json\n$/);
    assert.deepEqual(filesOf(f.dest), ["ac-checklist.json", "chain-head.json", "events.jsonl", "review-verdict.json"]);
    for (const name of ["ac-checklist.json", "review-verdict.json", "events.jsonl"]) {
      const source = name === "events.jsonl" ? path.join(f.run, name) : path.join(f.run, "FAFF-1", name);
      assert.ok(readFileSync(source).equals(readFileSync(path.join(f.dest, name))), name);
    }
    assert.match(r.stderr, /evidence-schema warn-only: legacy FAFF-1/);
    assert.match(r.stderr, /not a refusal/);
    assert.match(r.stderr, new RegExp(`details: faff evidence validate ${f.dest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(r.stderr, /\n  ac-checklist\.json: legacy, 0 violation\(s\)\n/);
  } finally { cleanup(f); }
});

test("a conforming mint prints no warn-only line and evidence validate passes", () => {
  const f = fixture("v03");
  try {
    const r = f.mint();
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /warn-only/);
    const v = runCli(["evidence", "validate", f.dest]);
    assert.equal(v.code, 0, v.stdout);
    assert.match(v.stdout, /: pass/);
  } finally { cleanup(f); }
});

test("a non-conforming mint names the file, status and count, never violation text", () => {
  const f = fixture("v03", { mutate: (run) => {
    const doc = JSON.parse(example("review-verdict-anchored"));
    delete doc.rounds_total;
    doc.signal = SENTINEL;
    writeFileSync(path.join(run, "FAFF-1", "review-verdict.json"), JSON.stringify(doc));
  } });
  try {
    const r = f.mint();
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /warn-only: fail FAFF-1 \(1 non-conforming file\(s\)\); not a refusal/);
    assert.match(r.stderr, /\n  review-verdict\.json: fail, \d+ violation\(s\)\n/);
    assert.ok(!r.stderr.includes(SENTINEL));
    assert.ok(!r.stderr.includes("rounds_total"));
  } finally { cleanup(f); }
});

test("more than five non-conforming files are cut to five plus a count", () => {
  const f = fixture("legacy", { mutate: (run) => {
    writeFileSync(path.join(run, "run-ledger.json"), JSON.stringify({ schema_version: 1 }));
  } });
  try {
    // Seven stray files in the destination make the anchor fail with many unschemaed entries.
    mkdirSync(f.dest, { recursive: true });
    for (let i = 0; i < 7; i++) writeFileSync(path.join(f.dest, `stray-${i}.txt`), "x");
    const r = f.mint();
    assert.equal(r.code, 0, r.stderr);
    const fileLines = r.stderr.split("\n").filter((l) => /^ {2}\S.*: \w+, \d+ violation/.test(l));
    assert.equal(fileLines.length, 5);
    assert.match(r.stderr, /\(\+\d+ more files\)/);
  } finally { cleanup(f); }
});

test("a file name carrying :: or a newline is sanitised on the mint's stderr", () => {
  const f = fixture("legacy");
  try {
    mkdirSync(f.dest, { recursive: true });
    writeFileSync(path.join(f.dest, "::error::x\nnotice.txt"), "x");
    const r = f.mint();
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stderr.includes("::error::"));
    assert.match(r.stderr, /: :error: :x notice\.txt/);
  } finally { cleanup(f); }
});

test("a throwing validator, with the sentinel in its message, still exits 0 and prints only the class name", () => {
  const f = fixture("legacy");
  const evidence = require("../plugin/skills/faff/bin/lib/evidence.js");
  const events = require("../plugin/skills/faff/bin/lib/events.js");
  const real = evidence.validateAnchorDir;
  const stderr = [];
  const realWrite = process.stderr.write;
  const realLog = console.log;
  try {
    evidence.validateAnchorDir = () => { throw new TypeError(`${SENTINEL} boom`); };
    process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
    console.log = () => {};
    const code = events.cmdEvents(["anchor", "--run-dir", f.run, "--issue", "FAFF-1", "--dest", f.dest]);
    assert.equal(code, 0);
  } finally {
    evidence.validateAnchorDir = real;
    process.stderr.write = realWrite;
    console.log = realLog;
  }
  try {
    const text = stderr.join("");
    assert.match(text, /evidence-schema warn-only: error FAFF-1: TypeError; not a refusal/);
    assert.ok(!text.includes(SENTINEL));
    assert.deepEqual(filesOf(f.dest), ["ac-checklist.json", "chain-head.json", "events.jsonl", "review-verdict.json"]);
  } finally { cleanup(f); }
});

test("a schema-unavailable error result prints the error line with its reason, and the leg reports error", () => {
  const f = fixture("legacy");
  const evidence = require("../plugin/skills/faff/bin/lib/evidence.js");
  const events = require("../plugin/skills/faff/bin/lib/events.js");
  const gov = require("../plugin/skills/faff/bin/lib/governance-check.js");
  const real = evidence.validateAnchorDir;
  const stderr = [];
  const realWrite = process.stderr.write;
  const realLog = console.log;
  let leg;
  try {
    evidence.validateAnchorDir = () => ({ status: "error", message: "schema-unavailable /bundle/manifest.json" });
    process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
    console.log = () => {};
    assert.equal(events.cmdEvents(["anchor", "--run-dir", f.run, "--issue", "FAFF-1", "--dest", f.dest]), 0);
    leg = gov.evaluateAnchorDir(f.dest).legs.evidence_schema;
  } finally {
    evidence.validateAnchorDir = real;
    process.stderr.write = realWrite;
    console.log = realLog;
  }
  try {
    assert.match(stderr.join(""), /warn-only: error FAFF-1: schema-unavailable \/bundle\/manifest\.json; not a refusal/);
    assert.equal(leg.status, "error");
    assert.equal(leg.report_only, true);
    assert.match(leg.detail, /^validator error: schema-unavailable/);
  } finally { cleanup(f); }
});

test("with the bundled manifest removed the mint still exits 0, writes the anchor and prints the error line", () => {
  const f = fixture("legacy");
  const copy = mkdtempSync(path.join(tmpdir(), "faff-1263-plugin-"));
  try {
    cpSync(path.join(repoRoot, "plugin", "skills", "faff"), path.join(copy, "faff"), { recursive: true, filter: (src) => !src.includes("node_modules") });
    rmSync(path.join(copy, "faff", "contracts", "evidence-v0.3", "anchor-manifest.json"));
    const { spawnSync } = require("node:child_process");
    const r = spawnSync(process.execPath, [path.join(copy, "faff", "bin", "faff"), "events", "anchor", "--run-dir", f.run, "--issue", "FAFF-1", "--dest", f.dest], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /warn-only: error FAFF-1: schema-unavailable /);
    assert.deepEqual(filesOf(f.dest), ["ac-checklist.json", "chain-head.json", "events.jsonl", "review-verdict.json"]);
  } finally { cleanup(f); rmSync(copy, { recursive: true, force: true }); }
});

test("module wiring: events.js has no top-level evidence require, evidence.js requires no factory file", () => {
  const lib = path.join(repoRoot, "plugin", "skills", "faff", "bin", "lib");
  const events = readFileSync(path.join(lib, "events.js"), "utf8");
  const topLevel = events.split("\n").filter((l) => /^(const|let|var)\b.*require\(/.test(l));
  assert.ok(!topLevel.some((l) => l.includes('require("./evidence")')));
  const evidence = readFileSync(path.join(lib, "evidence.js"), "utf8");
  assert.ok(!/require\(["']\.\/(governance-check|evidence-readiness)["']\)/.test(evidence));
  const { REGION_MAP } = require("../plugin/skills/faff/bin/lib/regions.js");
  assert.equal(REGION_MAP["evidence-readiness"], "factory");
  const r = runCli(["evidence-readiness", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

// --- governance-check leg ---------------------------------------------------

function govJson(dir, extra = []) {
  const r = runCli(["governance-check", "--anchor-dir", dir, "--json", ...extra]);
  return { ...r, verdict: JSON.parse(r.stdout) };
}

test("a failing evidence document sets the leg to fail without changing pass, exit code or reasons", () => {
  const good = fixture("v03");
  const bad = fixture("v03", { mutate: (run) => {
    const doc = JSON.parse(example("review-verdict-anchored"));
    delete doc.rounds_total;
    writeFileSync(path.join(run, "FAFF-1", "review-verdict.json"), JSON.stringify(doc));
  } });
  try {
    good.mint(); bad.mint();
    const g = govJson(good.dest);
    const b = govJson(bad.dest);
    assert.equal(b.verdict.runs[0].legs.evidence_schema.status, "fail");
    assert.equal(b.verdict.runs[0].legs.evidence_schema.report_only, true);
    assert.equal(g.verdict.runs[0].legs.evidence_schema.status, "pass");
    assert.equal(b.code, g.code);
    assert.equal(b.verdict.pass, g.verdict.pass);
    assert.deepEqual(b.verdict.reasons, g.verdict.reasons);
    // FAFF-1347: the anchor's events.jsonl scope block is folded into the leg detail. This v03
    // fixture's anchor dest is not named for the chain-head issue, so the scope resolves refused
    // (whole-file judgement, byte-identical verdict to before) and the clause records that.
    assert.match(b.verdict.runs[0].legs.evidence_schema.detail, /^1 file\(s\) non-conforming: review-verdict\.json( \[events scope: [^\]]*\])?$/);
  } finally { cleanup(good); cleanup(bad); }
});

test("the legacy status reaches the leg and the text and markdown renderers show it as report-only", () => {
  const f = fixture("legacy");
  try {
    f.mint();
    const j = govJson(f.dest);
    assert.equal(j.verdict.runs[0].legs.evidence_schema.status, "legacy");
    const text = runCli(["governance-check", "--anchor-dir", f.dest]);
    assert.match(text.stdout, /\n  evidence_schema: legacy \(report-only\) — legacy anchor/);
    const md = path.join(f.root, "summary.md");
    runCli(["governance-check", "--anchor-dir", f.dest, "--summary-md", md]);
    assert.match(readFileSync(md, "utf8"), /\| evidence_schema _\(report-only\)_ \| legacy \| /);
  } finally { cleanup(f); }
});

test("file names with :: or | are neutralised in text, json and summary markdown", () => {
  const f = fixture("v03");
  try {
    f.mint();
    writeFileSync(path.join(f.dest, "::error::a|b.txt"), "x");
    const j = govJson(f.dest);
    const leg = j.verdict.runs[0].legs.evidence_schema;
    assert.equal(leg.status, "fail");
    assert.ok(!JSON.stringify(leg).includes("::error::"));
    assert.ok(leg.files[0].path.includes(": :error: :a|b.txt"));
    const text = runCli(["governance-check", "--anchor-dir", f.dest]);
    assert.ok(!text.stdout.includes("::error::"));
    const md = path.join(f.root, "summary.md");
    runCli(["governance-check", "--anchor-dir", f.dest, "--summary-md", md]);
    const row = readFileSync(md, "utf8").split("\n").filter((l) => l.startsWith("| evidence_schema"));
    assert.equal(row.length, 1);
    assert.ok(row[0].includes("a\\|b.txt"));
  } finally { cleanup(f); }
});

// FAFF-1347: evaluateRunDir now carries a run-dir evidence_schema leg (report-only by default,
// gating under --require-evidence-schema). A run dir with no events.jsonl is vacuously clean.
test("run-dir results carry a report-only evidence_schema leg that renders", () => {
  const f = fixture("v03");
  try {
    f.mint();
    const ledger = JSON.parse(example("run-ledger"));
    const liveDir = path.join(f.root, ".faff", "runs", "live");
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(path.join(liveDir, "run-ledger.json"), JSON.stringify(ledger));
    const r = runCli(["governance-check", "--run-dir", liveDir, "--json"], { cwd: f.root });
    const parsed = JSON.parse(r.stdout);
    const leg = parsed.runs[0].legs.evidence_schema;
    assert.ok(leg);
    assert.equal(leg.report_only, true);
    assert.equal(leg.status, "pass");
    const text = runCli(["governance-check", "--run-dir", liveDir], { cwd: f.root });
    assert.match(text.stdout, /evidence_schema/);
  } finally { cleanup(f); }
});

test("no sentinel planted in an evidence field reaches the leg or the mint line", () => {
  const f = fixture("v03", { mutate: (run) => {
    const doc = JSON.parse(example("ac-checklist"));
    doc.criteria[0].ac = SENTINEL;
    doc.extra_field = SENTINEL;
    writeFileSync(path.join(run, "FAFF-1", "ac-checklist.json"), JSON.stringify(doc));
    const events = readFileSync(path.join(run, "events.jsonl"), "utf8").trimEnd().split("\n");
    events.push(JSON.stringify({ schema: SENTINEL }));
    writeFileSync(path.join(run, "events.jsonl"), events.join("\n") + "\n");
  } });
  try {
    const r = f.mint();
    assert.ok(!r.stderr.includes(SENTINEL), r.stderr);
    assert.ok(!r.stdout.includes(SENTINEL));
    const j = govJson(f.dest);
    assert.ok(!JSON.stringify(j.verdict).includes(SENTINEL));
    const text = runCli(["governance-check", "--anchor-dir", f.dest]);
    assert.ok(!(text.stdout + text.stderr).includes(SENTINEL));
  } finally { cleanup(f); }
});

test("integration smoke: legacy mint warns, the leg says legacy and pass is unchanged", () => {
  const f = fixture("legacy");
  try {
    const m = f.mint();
    assert.equal(m.code, 0);
    assert.match(m.stderr, /warn-only: legacy FAFF-1/);
    const j = govJson(f.dest);
    assert.equal(j.verdict.runs[0].legs.evidence_schema.status, "legacy");
    const pass = j.verdict.pass;
    assert.equal(pass, j.verdict.runs[0].legs.integrity.pass && j.verdict.runs[0].legs.merge_floor.pass);
  } finally { cleanup(f); }
});
