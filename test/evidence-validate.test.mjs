// FAFF-1256: `faff evidence validate <anchor-dir>` against the bundled v0.3 schemas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES = join(REPO, "verification", "evidence", "v0.3", "schema", "examples");
const { validateAnchorDir, exitCodeFor } = require("../plugin/skills/faff/bin/lib/evidence.js");
const REAL_ANCHOR = join(REPO, ".faff", "anchors", "run-20261010-213749-graft-FAFF-1213", "FAFF-1213");
const SENTINEL = "S3CR3T-SENTINEL";

const example = (name) => readFileSync(join(EXAMPLES, `${name}.example.json`), "utf8");
const scratch = () => mkdtempSync(join(tmpdir(), "faff-evidence-validate-"));

function copyAnchor() {
  const dir = scratch();
  cpSync(REAL_ANCHOR, dir, { recursive: true });
  return dir;
}

// The real anchor with schema_version stamped into the ledger and the two review files
// replaced by the v0.3 valid examples (scenario 1).
function stampedCopy() {
  const dir = copyAnchor();
  const ledger = JSON.parse(readFileSync(join(dir, "run-ledger.json"), "utf8"));
  writeFileSync(join(dir, "run-ledger.json"), JSON.stringify({ schema_version: 1, ...ledger }, null, 2));
  writeFileSync(join(dir, "ac-checklist.json"), example("ac-checklist"));
  writeFileSync(join(dir, "review-verdict.json"), example("review-verdict-anchored"));
  return dir;
}

const validate = (dir, ...extra) => runCli(["evidence", "validate", dir, "--json", ...extra]);

// Anchors minted after the FAFF-1258 serialiser stamp run-ledger.json and build-progress.json; until the
// FAFF-1277 writers, graft hand-wrote the other evidence files, so those anchors report fail. The list is
// frozen at MIXED_CUTOFF, the run timestamp of the FAFF-1277 graft: a run started later has the writers
// and its anchor must pass. A new row needs a reviewed cutoff change, never a quiet list edit.
const MIXED_CUTOFF = "20261014-142628";
const MIXED_ANCHORS = new Map([
  [".faff/anchors/run-20261014-125129-graft-FAFF-1274/FAFF-1274", ["ac-checklist.json", "review-verdict.json", "spec-review-verdict.json"]],
  [".faff/anchors/run-20261014-125614-graft-FAFF-1224/FAFF-1224", ["ac-checklist.json", "review-verdict.json", "spec-review-verdict.json"]],
  [".faff/anchors/run-20261014-140913-graft-FAFF-1260/FAFF-1260", ["ac-checklist.json", "review-verdict.json"]],
]);

const runTimestamp = (rel) => (rel.match(/\/run-(\d{8}-\d{6})-/) || [])[1] ?? null;
const notAfterCutoff = (rel) => runTimestamp(rel) === null || runTimestamp(rel) <= MIXED_CUTOFF;
const failingFiles = (report) => report.files.filter((f) => f.status !== "ok").map((f) => f.path).sort();

// committedAnchorProblems(root, rels) -> one message per anchor directory that breaks the rules: a listed
// anchor must fail on exactly its listed files and predate the cutoff; any other anchor must pass, or be
// legacy and predate the cutoff.
function committedAnchorProblems(root, rels, mixed = MIXED_ANCHORS) {
  const problems = [];
  for (const rel of rels) {
    const report = validateAnchorDir(join(root, rel));
    if (mixed.has(rel)) {
      if (!notAfterCutoff(rel)) problems.push(`${rel}: listed in MIXED_ANCHORS but dated after MIXED_CUTOFF`);
      if (report.status !== "fail" || JSON.stringify(failingFiles(report)) !== JSON.stringify(mixed.get(rel))) {
        problems.push(`${rel}: listed as mixed on ${mixed.get(rel).join(", ")} but reports ${report.status} on ${failingFiles(report).join(", ") || "nothing"}`);
      }
      continue;
    }
    if (report.status === "pass") continue;
    if (report.status === "legacy" && notAfterCutoff(rel)) continue;
    problems.push(`${rel}: ${report.status} on ${failingFiles(report).join(", ") || "nothing"}`);
  }
  return problems;
}

test("evidence validate: MIXED_ANCHORS is frozen at MIXED_CUTOFF", () => {
  for (const rel of MIXED_ANCHORS.keys()) assert.ok(notAfterCutoff(rel) && runTimestamp(rel) !== null, rel);
});

test("evidence validate: every git-tracked anchor passes, or is legacy or a listed mixed anchor from before the cutoff", () => {
  const tracked = execFileSync("git", ["ls-files", ".faff/anchors"], { cwd: REPO, encoding: "utf8" })
    .split("\n").filter(Boolean)
    .map((f) => f.split("/").slice(0, 4).join("/"));
  const dirs = [...new Set(tracked)].sort();
  assert.ok(dirs.length > 100, `expected the committed anchors, found ${dirs.length}`);
  assert.deepEqual(committedAnchorProblems(REPO, dirs), []);
  const legacy = dirs.find((rel) => validateAnchorDir(join(REPO, rel)).status === "legacy");
  assert.ok(legacy, "expected at least one legacy anchor for the exit-code checks");
  const report = validateAnchorDir(join(REPO, legacy));
  assert.equal(exitCodeFor(report, false), 0, legacy);
  assert.equal(exitCodeFor(report, true), 1, legacy);
  assert.equal(validate(join(REPO, legacy)).code, 0);
  assert.equal(validate(join(REPO, legacy), "--require-evidence-schema").code, 1);
});

test("evidence validate: a mixed anchor dated after the cutoff fails the committed-anchor rules, listed or not", () => {
  const root = scratch();
  const rel = ".faff/anchors/run-20991231-000000-graft-FAFF-9/FAFF-9";
  const dir = join(root, rel);
  const stamped = stampedCopy();
  cpSync(stamped, dir, { recursive: true });
  const review = JSON.parse(example("review-verdict-anchored"));
  delete review.schema_version;
  writeFileSync(join(dir, "review-verdict.json"), JSON.stringify(review));
  const [problem] = committedAnchorProblems(root, [rel]);
  assert.ok(problem.startsWith(rel) && problem.includes("review-verdict.json"), problem);
  const listed = committedAnchorProblems(root, [rel], new Map([[rel, ["review-verdict.json"]]]));
  assert.deepEqual(listed, [`${rel}: listed in MIXED_ANCHORS but dated after MIXED_CUTOFF`]);
  rmSync(dir, { recursive: true, force: true });
  cpSync(stamped, dir, { recursive: true });
  assert.deepEqual(committedAnchorProblems(root, [rel]), []);
  rmSync(root, { recursive: true, force: true });
  rmSync(stamped, { recursive: true, force: true });
});

test("evidence validate: scenario 1, a stamped copy of a real anchor passes with every file ok", () => {
  const dir = stampedCopy();
  const { stdout, code } = validate(dir);
  assert.equal(code, 0, stdout);
  const report = JSON.parse(stdout);
  assert.equal(report.status, "pass");
  assert.equal(report.spec_version, "v0.3");
  assert.equal(report.files.length, 7);
  assert.ok(report.files.every((f) => f.status === "ok"), JSON.stringify(report.files));
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: scenario 2, an extra property and a torn tail", () => {
  const dir = stampedCopy();
  const file = join(dir, "events.jsonl");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const edited = JSON.parse(lines[1]);
  edited.extra = 1;
  lines[1] = JSON.stringify(edited);
  writeFileSync(file, lines.join("\n") + '\n{"sch');
  const { stdout, code } = validate(dir);
  assert.equal(code, 1, stdout);
  const report = JSON.parse(stdout);
  assert.equal(report.status, "fail");
  const events = report.files.find((f) => f.path === "events.jsonl");
  assert.equal(events.status, "fail");
  assert.equal(events.torn_tail, true);
  assert.deepEqual(events.violations, ['line 2: additional property "extra" not allowed']);
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: a mixed anchor fails on the unstamped evidence document", () => {
  const dir = stampedCopy();
  const ac = JSON.parse(example("ac-checklist"));
  delete ac.schema_version;
  writeFileSync(join(dir, "ac-checklist.json"), JSON.stringify(ac));
  const { stdout, code } = validate(dir);
  assert.equal(code, 1);
  const report = JSON.parse(stdout);
  assert.equal(report.status, "fail");
  assert.ok(report.files.find((f) => f.path === "ac-checklist.json").violations.includes('missing required property "schema_version"'));
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: a file with no manifest entry is unschemaed", () => {
  const dir = stampedCopy();
  writeFileSync(join(dir, "notes.txt"), "stray");
  const report = JSON.parse(validate(dir).stdout);
  assert.equal(report.status, "fail");
  assert.equal(report.files.find((f) => f.path === "notes.txt").status, "unschemaed");
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: a mid-file non-JSON line fails", () => {
  const dir = stampedCopy();
  const file = join(dir, "events.jsonl");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  lines.splice(1, 0, "not json");
  writeFileSync(file, lines.join("\n") + "\n");
  const { stdout, code } = validate(dir);
  assert.equal(code, 1);
  assert.ok(JSON.parse(stdout).files.find((f) => f.path === "events.jsonl").violations.includes("line 2: not valid JSON"));
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: a legacy anchor holding an unmanifested file is legacy, not fail", () => {
  const dir = copyAnchor();
  writeFileSync(join(dir, "summary.md"), "stray");
  const { stdout, code } = validate(dir);
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).status, "legacy");
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: a pk.json-only anchor is legacy", () => {
  const dir = scratch();
  mkdirSync(join(dir, "commissaire", "producer"), { recursive: true });
  writeFileSync(join(dir, "commissaire", "producer", "pk.json"), example("producer-pk"));
  assert.equal(JSON.parse(validate(dir).stdout).status, "legacy");
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: human output prints at most five violations per file", () => {
  const dir = stampedCopy();
  const bad = JSON.parse(example("review-verdict-anchored"));
  for (let i = 0; i < 8; i++) bad[`extra${i}`] = i;
  writeFileSync(join(dir, "review-verdict.json"), JSON.stringify(bad));
  const { stdout, code } = runCli(["evidence", "validate", dir]);
  assert.equal(code, 1);
  assert.match(stdout, /^evidence validate .*: fail$/m);
  assert.equal((stdout.match(/^ {4}- /gm) || []).length, 5);
  assert.match(stdout, /\(\+3 more\)/);
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: usage errors and a missing directory exit 2", () => {
  assert.equal(runCli(["evidence"]).code, 2);
  assert.equal(runCli(["evidence", "validate"]).code, 2);
  assert.equal(runCli(["evidence", "validate", join(tmpdir(), "faff-evidence-does-not-exist")]).code, 2);
  assert.equal(runCli(["evidence", "validate", REAL_ANCHOR, "--bogus"]).code, 2);
});

test("evidence validate: an unreadable bundled manifest exits 2 with schema-unavailable", () => {
  const tree = scratch();
  cpSync(join(REPO, "plugin", "skills", "faff"), join(tree, "faff"), { recursive: true, filter: (src) => !src.includes("node_modules") });
  rmSync(join(tree, "faff", "contracts", "evidence-v0.3", "anchor-manifest.json"));
  const r = spawnSync(process.execPath, [join(tree, "faff", "bin", "faff"), "evidence", "validate", REAL_ANCHOR], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /schema-unavailable/);
  rmSync(tree, { recursive: true, force: true });
});

test("evidence validate: violation messages never print a data value", () => {
  const dir = stampedCopy();
  const bad = JSON.parse(example("review-verdict-anchored"));
  bad.signal = SENTINEL;
  bad.rounds_total = SENTINEL;
  bad.round_history = SENTINEL;
  writeFileSync(join(dir, "review-verdict.json"), JSON.stringify(bad));
  const { stdout } = validate(dir);
  assert.ok(!stdout.includes(SENTINEL));
  assert.match(stdout, /value not in enum \[pass, fail, needs-human, unavailable\]/);
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: faff evidence --selftest exits 0", () => {
  const { code, stdout } = runCli(["evidence", "--selftest"]);
  assert.equal(code, 0, stdout);
});

test("evidence validate: integration smoke", () => {
  const dir = copyAnchor();
  assert.equal(validate(dir).code, 0);
  assert.equal(JSON.parse(validate(dir).stdout).status, "legacy");
  const ledger = JSON.parse(readFileSync(join(dir, "run-ledger.json"), "utf8"));
  writeFileSync(join(dir, "run-ledger.json"), JSON.stringify({ schema_version: 1, ...ledger }));
  writeFileSync(join(dir, "ac-checklist.json"), example("ac-checklist"));
  writeFileSync(join(dir, "review-verdict.json"), example("review-verdict-anchored"));
  assert.equal(JSON.parse(validate(dir).stdout).status, "pass");
  const ac = JSON.parse(example("ac-checklist"));
  delete ac.schema_version;
  writeFileSync(join(dir, "ac-checklist.json"), JSON.stringify(ac));
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).files.find((f) => f.status === "fail").path, "ac-checklist.json");
  assert.ok(existsSync(dir) && readdirSync(dir).length > 0);
  rmSync(dir, { recursive: true, force: true });
});

// ---- FAFF-1258: --candidate-schemas and classifySchemaChange ----
import path from "node:path";
import { symlinkSync } from "node:fs";
const { classifySchemaChange } = require("../plugin/skills/faff/bin/lib/evidence.js");
const { validateAgainstSchema } = require("../plugin/skills/faff/bin/lib/contract-engine.js");
const PLUGIN = path.join(REPO, "plugin", "skills", "faff");
const BUNDLE = path.join(PLUGIN, "contracts", "evidence-v0.3");

const cliValidate = (args) => {
  const r = spawnSync("node", [path.join(PLUGIN, "bin", "faff"), "evidence", "validate", ...args], { encoding: "utf8", cwd: REPO });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
};

const NOW = "2026-10-14T00:00:00.000Z";
const ledger = (extra = {}, owner = {}) => ({
  schema_version: 1, run_id: "RUN-E", level: "L3", admitted: [], outcomes: {},
  owner: { status: "running", session_id: "S", pid: 1, started_at: NOW, last_heartbeat: NOW, ...owner }, ...extra,
});

function anchor(doc) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-1258-anchor-"));
  writeFileSync(path.join(dir, "run-ledger.json"), JSON.stringify(doc));
  return dir;
}

function candidateSet(edit) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-1258-cand-"));
  cpSync(BUNDLE, dir, { recursive: true });
  edit(dir, (name, mutate) => {
    const p = path.join(dir, "schema", `${name}.schema.json`);
    const s = JSON.parse(readFileSync(p, "utf8"));
    mutate(s);
    writeFileSync(p, JSON.stringify(s, null, 2));
  });
  return dir;
}

test("Scenario: an additive candidate is used (schema_source candidate); without it the unlisted key fails", () => {
  const cand = candidateSet((_d, edit) => edit("run-ledger", (s) => { s.properties.foo = { type: "string" }; }));
  const dir = anchor(ledger({ foo: "x" }));
  try {
    const withCand = cliValidate([dir, "--candidate-schemas", cand, "--json"]);
    assert.equal(withCand.code, 0, withCand.out + withCand.err);
    const report = JSON.parse(withCand.out);
    assert.equal(report.files.find((f) => f.path === "run-ledger.json").schema_source, "candidate");
    assert.deepEqual(report.candidate_rejected, []);
    const without = cliValidate([dir, "--json"]);
    assert.equal(without.code, 1);
    assert.match(JSON.parse(without.out).files[0].violations.join(" "), /"foo"/);
  } finally { rmSync(cand, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
});

test("Scenario: a loosened owner additionalProperties is rejected and the base schema decides", () => {
  const cand = candidateSet((_d, edit) => edit("run-ledger", (s) => { s.properties.owner.additionalProperties = true; }));
  const dir = anchor(ledger({}, { x: 1 }));
  try {
    const r = cliValidate([dir, "--candidate-schemas", cand, "--json"]);
    assert.equal(r.code, 1, r.out + r.err);
    const report = JSON.parse(r.out);
    assert.equal(report.files.find((f) => f.path === "run-ledger.json").schema_source, "base");
    const rejected = report.candidate_rejected.find((c) => c.path === "schema/run-ledger.schema.json");
    assert.ok(rejected.reasons.some((m) => /owner/.test(m) && /additionalProperties/.test(m)), JSON.stringify(rejected));
  } finally { rmSync(cand, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
});

test("a candidate whose manifest differs rejects the whole set", () => {
  const cand = candidateSet((d) => {
    const p = path.join(d, "anchor-manifest.json");
    const m = JSON.parse(readFileSync(p, "utf8"));
    m.note = "changed";
    writeFileSync(p, JSON.stringify(m));
  });
  const dir = anchor(ledger());
  try {
    const r = cliValidate([dir, "--candidate-schemas", cand, "--json"]);
    assert.equal(r.code, 0, r.out + r.err);
    const report = JSON.parse(r.out);
    assert.ok(report.files.every((f) => f.schema_source === "base"));
    assert.deepEqual(report.candidate_rejected, [{ path: "anchor-manifest.json", reasons: ["manifest differs"] }]);
  } finally { rmSync(cand, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
});

test("a candidate schema that escapes the directory by symlink is treated as unloadable; the exit code matches base alone", () => {
  const outside = mkdtempSync(path.join(tmpdir(), "faff-1258-outside-"));
  const loose = JSON.parse(readFileSync(path.join(BUNDLE, "schema", "run-ledger.schema.json"), "utf8"));
  loose.additionalProperties = true;
  writeFileSync(path.join(outside, "run-ledger.schema.json"), JSON.stringify(loose));
  const cand = candidateSet((d) => {
    rmSync(path.join(d, "schema", "run-ledger.schema.json"));
    symlinkSync(path.join(outside, "run-ledger.schema.json"), path.join(d, "schema", "run-ledger.schema.json"));
  });
  const dir = anchor(ledger({ scratch: 1 }));
  try {
    const baseOnly = cliValidate([dir, "--json"]);
    const r = cliValidate([dir, "--candidate-schemas", cand, "--json"]);
    assert.equal(r.code, baseOnly.code);
    assert.equal(r.code, 1);
    const report = JSON.parse(r.out);
    assert.equal(report.files.find((f) => f.path === "run-ledger.json").schema_source, "base");
    assert.ok(report.candidate_rejected.some((c) => c.path === "schema/run-ledger.schema.json"));
  } finally { rmSync(cand, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
});

test("a missing or unreadable candidate directory never changes the exit code", () => {
  const dir = anchor(ledger());
  try {
    const r = cliValidate([dir, "--candidate-schemas", path.join(dir, "nope"), "--json"]);
    assert.equal(r.code, 0, r.out + r.err);
    assert.deepEqual(JSON.parse(r.out).candidate_rejected, [{ path: "anchor-manifest.json", reasons: ["manifest differs"] }]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("without --candidate-schemas the report shape is unchanged", () => {
  const dir = anchor(ledger());
  try {
    const report = JSON.parse(cliValidate([dir, "--json"]).out);
    assert.equal("candidate_rejected" in report, false);
    assert.equal("schema_source" in report.files[0], false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("no candidate_rejected reason contains a value from the candidate schema", () => {
  const cand = candidateSet((_d, edit) => edit("run-ledger", (s) => {
    s.properties.owner.properties.status = { type: "string", const: SENTINEL, description: SENTINEL };
    s.properties.level = { type: "string", enum: [SENTINEL] };
  }));
  const dir = anchor(ledger());
  try {
    const r = cliValidate([dir, "--candidate-schemas", cand, "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.ok(JSON.parse(r.out).candidate_rejected.length > 0);
    assert.doesNotMatch(r.out + r.err, new RegExp(SENTINEL));
  } finally { rmSync(cand, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
});

// ---- classifySchemaChange unit table ----

const base = () => ({
  type: "object", additionalProperties: false, required: ["a"],
  properties: {
    a: { type: "string" },
    e: { type: "string", enum: ["x", "y"] },
    m: { type: "object", additionalProperties: { type: "string" } },
    o: { type: "object", additionalProperties: false, properties: { x: { type: "string" } } },
    open: { type: "object", properties: {} },
    r: { type: "array", maxItems: 2, items: { type: "integer" } },
    d: { type: "object", discriminator: { field: "k", mapping: { one: { type: "object", additionalProperties: false, properties: { k: { type: "string" } } } } } },
  },
});
const closedString = { type: "string" };

const additiveCases = {
  "identical": (h) => h,
  "description edit": (h) => { h.description = "new"; h.properties.a.description = "x"; h.properties.o.title = "t"; return h; },
  "new optional typed closed property on a closed object": (h) => { h.properties.n = closedString; return h; },
  "new optional property on a nested closed object": (h) => { h.properties.o.properties.z = { type: ["string", "null"] }; return h; },
  "new optional object property with a typed, closed map value": (h) => { h.properties.n = { type: "object", additionalProperties: { type: "string" } }; return h; },
  "new optional closed object property": (h) => { h.properties.n = { type: "object", additionalProperties: false, properties: { q: { type: "integer" } } }; return h; },
  "new optional array property with closed typed items": (h) => { h.properties.n = { type: "array", items: { type: "string" } }; return h; },
  "maxItems raised": (h) => { h.properties.r.maxItems = 3; return h; },
  "maxItems removed": (h) => { delete h.properties.r.maxItems; return h; },
  "new optional array property carrying maxItems": (h) => { h.properties.n = { type: "array", maxItems: 2, items: { type: "string" } }; return h; },
};
const nonAdditiveCases = {
  "new property in required": (h) => { h.properties.n = closedString; h.required.push("n"); return h; },
  "new optional array property with no items": (h) => { h.properties.n = { type: "array" }; return h; },
  "new optional nullable array property with no items": (h) => { h.properties.n = { type: ["array", "null"] }; return h; },
  "new untyped property": (h) => { h.properties.n = {}; return h; },
  "new property on a map node": (h) => { h.properties.m.properties = { z: closedString }; return h; },
  "new optional object property with additionalProperties {}": (h) => { h.properties.n = { type: "object", additionalProperties: {} }; return h; },
  "new optional object property with additionalProperties true": (h) => { h.properties.n = { type: "object", additionalProperties: true }; return h; },
  "new object property whose nested object has no additionalProperties": (h) => { h.properties.n = { type: "object", additionalProperties: false, properties: { inner: { type: "object", properties: {} } } }; return h; },
  "new object property without closure": (h) => { h.properties.n = { type: "object", properties: {} }; return h; },
  "new property on a node with no additionalProperties": (h) => { h.properties.open.properties.k = closedString; return h; },
  "new optional property inside a discriminator mapping": (h) => { h.properties.d.discriminator.mapping.one.properties.k2 = closedString; return h; },
  "maxItems lowered": (h) => { h.properties.r.maxItems = 1; return h; },
  "maxItems added where absent": (h) => { h.properties.a.type = "array"; h.properties.a.items = { type: "string" }; h.properties.a.maxItems = 2; return h; },
  "maxItems changed to a non-number": (h) => { h.properties.r.maxItems = "3"; return h; },
  "minLength added": (h) => { h.properties.a.minLength = 1; return h; },
  "const added": (h) => { h.properties.a.const = "z"; return h; },
  "additionalProperties false to true": (h) => { h.additionalProperties = true; return h; },
  "enum value added": (h) => { h.properties.e.enum.push("z"); return h; },
  "enum value removed": (h) => { h.properties.e.enum.pop(); return h; },
  "enum reordered": (h) => { h.properties.e.enum.reverse(); return h; },
  "type changed": (h) => { h.properties.a.type = "integer"; return h; },
  "property removed": (h) => { delete h.properties.e; return h; },
  "required dropped": (h) => { h.required = []; return h; },
  "unknown keyword": (h) => { h.properties.a.format = "email"; return h; },
  "$id changed": (h) => { h.$id = "other"; return h; },
};

for (const [name, edit] of Object.entries(additiveCases)) {
  test(`classifySchemaChange: ${name} is additive`, () => {
    const head = edit(structuredClone(base()));
    const verdict = classifySchemaChange(base(), head);
    assert.deepEqual(verdict, { additive: true, reasons: [] });
  });
}

for (const [name, edit] of Object.entries(nonAdditiveCases)) {
  test(`classifySchemaChange: ${name} is non-additive and the reasons name a pointer, not a value`, () => {
    const head = edit(structuredClone(base()));
    const verdict = classifySchemaChange(base(), head);
    assert.equal(verdict.additive, false);
    assert.ok(verdict.reasons.length > 0);
    for (const reason of verdict.reasons) assert.match(reason, /^\//, reason);
  });
}

test("classifySchemaChange: a keyword the table does not name, dropped from head, is non-additive", () => {
  const withMin = base();
  withMin.properties.a.minLength = 1;
  const verdict = classifySchemaChange(withMin, base());
  assert.equal(verdict.additive, false);
  assert.match(verdict.reasons[0], /^\/properties\/a: keyword "minLength" removed/);
});

test("classifySchemaChange: an unparseable or non-object head is non-additive", () => {
  for (const head of [null, "text", 5, [], undefined]) assert.equal(classifySchemaChange(base(), head).additive, false);
});

test("classifySchemaChange: a walk that throws is non-additive with a recorded reason", () => {
  const head = structuredClone(base());
  Object.defineProperty(head.properties, "boom", { enumerable: true, get() { throw new Error("explode"); } });
  const verdict = classifySchemaChange(base(), head);
  assert.equal(verdict.additive, false);
  assert.equal(verdict.reasons.length, 1);
});

test("classifySchemaChange: reasons never carry a schema value", () => {
  const head = base();
  head.properties.a.const = SENTINEL;
  head.properties.e.enum = [SENTINEL];
  head.description = SENTINEL;
  head.properties.o.default = SENTINEL;
  const verdict = classifySchemaChange(base(), head);
  assert.equal(verdict.additive, false);
  assert.doesNotMatch(verdict.reasons.join("\n"), new RegExp(SENTINEL));
});

test("property test: for each additive pair, every document valid under base is valid under head", () => {
  const docs = [
    { a: "x" },
    { a: "x", e: "y", m: { k: "v" }, o: { x: "q" }, open: {}, d: { k: "one" } },
    { a: "x", o: {} },
  ];
  const stray = [{}, { a: 1 }, { a: "x", zzz: 1 }, { a: "x", e: "bad" }];
  for (const [name, edit] of Object.entries(additiveCases)) {
    const head = edit(structuredClone(base()));
    for (const doc of docs) {
      assert.deepEqual(validateAgainstSchema(doc, base()), [], "fixture doc is valid under base");
      assert.deepEqual(validateAgainstSchema(doc, head), [], `${name}: valid under base implies valid under head`);
    }
    for (const doc of stray) {
      if (validateAgainstSchema(doc, base()).length === 0) assert.deepEqual(validateAgainstSchema(doc, head), []);
    }
  }
});

test("evidence --selftest still passes", () => {
  const r = spawnSync("node", [path.join(PLUGIN, "bin", "faff"), "evidence", "--selftest"], { encoding: "utf8", cwd: REPO });
  assert.equal(r.status, 0, r.stderr);
});
