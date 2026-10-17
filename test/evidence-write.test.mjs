// FAFF-1277 — `faff evidence write ac-checklist` and `faff evidence write review-verdict --terminal-only`:
// graft's two remaining verdict files written in the v0.3 shape, so a graft anchor validates as pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { emitGenesisRunStart } = require("../plugin/skills/faff/bin/lib/events.js");
const { readAcComplete, readReviewVerdict } = require("../plugin/skills/faff/bin/lib/merge-gate.js");
const { computeReviewVerdict } = require("../plugin/skills/faff/bin/lib/contract-defs.js");
const { validateAgainstSchema } = require("../plugin/skills/faff/bin/lib/contract-engine.js");
const { resolveFaffVersion } = require("../plugin/skills/faff/bin/lib/faff-version.js");

// FAFF-1395: every anchored evidence document carries the writing release as its second key.
const FAFF_VERSION = resolveFaffVersion().version;

const SCHEMAS = join(import.meta.dirname, "..", "plugin", "skills", "faff", "contracts", "evidence-v0.3", "schema");
const schema = (name) => JSON.parse(readFileSync(join(SCHEMAS, `${name}.schema.json`), "utf8"));
const SECRET = "supersecretvalue-0123456789";
const ISSUE = "ISSUE-1";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "faff-evidence-write-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, ".faff", "runs", "run-20991231-000000-graft-ISSUE-1");
  mkdirSync(runDir, { recursive: true });
  emitGenesisRunStart(runDir);
  const write = (name, input, extra = [], runDirArg = runDir, issue = ISSUE) =>
    runCli(["evidence", "write", name, ...extra, "--run-dir", runDirArg, "--issue", issue], { input, cwd: root });
  const ac = (input, ...rest) => write("ac-checklist", typeof input === "string" ? input : JSON.stringify(input), [], ...rest);
  const review = (input, ...rest) => write("review-verdict", typeof input === "string" ? input : JSON.stringify(input), ["--terminal-only"], ...rest);
  const out = (name) => join(runDir, ISSUE, name);
  const read = (name) => JSON.parse(readFileSync(out(name), "utf8"));
  const events = () => readFileSync(join(runDir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { root, runDir, write, ac, review, out, read, events };
}

const CRITERIA = [{ ac: "a", verified: "Verified: t", passed: true, ac_id: "issue-1#ac-1" }, { ac: "b", verified: "Verified: u", passed: true, ac_id: "issue-1#ac-2" }];
const FINDING = { title: "Missing null check", location: "src/a.js:10", action: "Guard it", location_present: true, action_present: true, severity: "minor", source: "standard", disposition: "fixed" };

test("ac-checklist: stamps schema_version, keeps criteria in order and drops unknown keys", (t) => {
  const f = fixture(t);
  const w = f.ac({ ac_complete: true, criteria: CRITERIA.map((c) => ({ ...c, extra: 1 })), all_verified: true, note: "x" });
  assert.equal(w.code, 0, w.stderr);
  assert.equal(w.stdout.trim(), f.out("ac-checklist.json"));
  assert.equal(readFileSync(f.out("ac-checklist.json"), "utf8"), JSON.stringify({ schema_version: 1, faff_version: FAFF_VERSION, all_verified: true, criteria: CRITERIA.map((c) => ({ ...c, verifications: null })) }, null, 2) + "\n");
  assert.deepEqual(validateAgainstSchema(f.read("ac-checklist.json"), schema("ac-checklist")), []);
  assert.equal(readAcComplete(f.runDir, ISSUE), true);
});

test("ac-checklist: a zero-AC input omits criteria and reads as complete", (t) => {
  const f = fixture(t);
  assert.equal(f.ac({ all_verified: true }).code, 0);
  assert.deepEqual(f.read("ac-checklist.json"), { schema_version: 1, faff_version: FAFF_VERSION, all_verified: true });
  assert.equal(readAcComplete(f.runDir, ISSUE), true);
});

test("ac-checklist: an unverified criterion is written as not verified", (t) => {
  const f = fixture(t);
  const criteria = [CRITERIA[0], { ac: "c", verified: "Needs human verification: visual", passed: false, ac_id: "issue-1#ac-3" }];
  assert.equal(f.ac({ all_verified: false, criteria }).code, 0);
  assert.equal(readAcComplete(f.runDir, ISSUE), false);
});

test("ac-checklist: exits 1 and writes nothing for each refused input", (t) => {
  const f = fixture(t);
  const cases = {
    "empty criteria": { all_verified: true, criteria: [] },
    "null criteria": { all_verified: true, criteria: null },
    "all_verified true with a failed criterion": { all_verified: true, criteria: [{ ...CRITERIA[0], passed: false }] },
    "all_verified false with every criterion passed": { all_verified: false, criteria: CRITERIA },
    "missing all_verified": { criteria: CRITERIA },
    "criterion missing passed": { all_verified: true, criteria: [{ ac: "a", verified: "v" }] },
    "not an object": "[1]",
    "not json": `{"all_verified": ${SECRET}`,
  };
  for (const [label, input] of Object.entries(cases)) {
    const w = f.ac(input);
    assert.equal(w.code, 1, `${label}: ${w.stderr}`);
    assert.equal(w.stdout, "", label);
    assert.ok(!w.stderr.includes(SECRET), label);
    assert.ok(!existsSync(f.out("ac-checklist.json")), label);
  }
});

test("review-verdict --terminal-only: null-fills every finding key and records one round", (t) => {
  const f = fixture(t);
  const w = f.review({ signal: "pass", findings: [FINDING, { title: "Second", severity: "observation", extra: 1 }, {}], unknown: true });
  assert.equal(w.code, 0, w.stderr);
  const doc = f.read("review-verdict.json");
  assert.deepEqual(Object.keys(doc), ["schema_version", "faff_version", "signal", "rounds_total", "round_history", "findings"]);
  assert.equal(doc.rounds_total, 1);
  assert.equal(doc.round_history, "terminal-only");
  assert.deepEqual(doc.findings.map((x) => x.finding_id), ["src/a.js::missing null check", "nolocation::second", "round-1#2"]);
  assert.deepEqual(doc.findings[1], {
    finding_id: "nolocation::second", title: "Second", location: null, action: null, location_present: false, action_present: false,
    severity: "observation", source: null, model: null, disposition: null, refutation: null, disposition_rationale: null,
    first_round: 1, last_round: 1, occurrences: [{ round: 1, title: "Second", location: null, severity: "observation", disposition: null }],
  });
  assert.deepEqual(doc.findings[0].occurrences, [{ round: 1, title: FINDING.title, location: FINDING.location, severity: "minor", disposition: "fixed" }]);
  assert.deepEqual(validateAgainstSchema(doc, schema("review-verdict-anchored")), []);
});

test("review-verdict --terminal-only: keeps adversarial_outcome, and the merge floor reads pass", (t) => {
  const f = fixture(t);
  assert.equal(f.review({ signal: "pass", adversarial_outcome: "chain-outage-skipped", findings: [FINDING] }).code, 0);
  const doc = f.read("review-verdict.json");
  assert.equal(doc.adversarial_outcome, "chain-outage-skipped");
  assert.deepEqual(Object.keys(doc).slice(0, 4), ["schema_version", "faff_version", "signal", "adversarial_outcome"]);
  assert.deepEqual(validateAgainstSchema(doc, schema("review-verdict-anchored")), []);
  assert.equal(readReviewVerdict(f.runDir, ISSUE), "pass");
  assert.deepEqual(computeReviewVerdict(doc).contractData.violations, []);
});

test("review-verdict --terminal-only: appends exactly one evidence-terminal-only event before the file", (t) => {
  const f = fixture(t);
  const before = f.events().length;
  assert.equal(f.review({ signal: "pass", findings: [] }).code, 0);
  const added = f.events().slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].type, "evidence-terminal-only");
  assert.equal(added[0].issue, ISSUE);
  assert.deepEqual(added[0].data, { issue: ISSUE, writer: "faff evidence write review-verdict --terminal-only" });
  assert.equal(runCli(["events", "verify", "--run-dir", f.runDir], { cwd: f.root }).code, 0);
});

test("review-verdict --terminal-only: a failed event append exits 2 and writes no file", (t) => {
  const f = fixture(t);
  rmSync(join(f.runDir, "events.jsonl"));
  mkdirSync(join(f.runDir, "events.jsonl"));
  const w = f.review({ signal: "pass", findings: [FINDING] });
  assert.equal(w.code, 2, w.stderr);
  assert.ok(!existsSync(f.out("review-verdict.json")));
  rmSync(join(f.runDir, "events.jsonl"), { recursive: true });
  const missing = f.review({ signal: "pass", findings: [FINDING] });
  assert.equal(missing.code, 2, missing.stderr);
  assert.ok(!existsSync(f.out("review-verdict.json")));
});

test("review-verdict --terminal-only: exits 1 and writes nothing for each refused input", (t) => {
  const f = fixture(t);
  const cases = {
    unavailable: { signal: "unavailable", findings: [] },
    "unknown signal": { signal: "maybe", findings: [] },
    "out-of-enum severity": { signal: "fail", findings: [{ ...FINDING, severity: "huge" }] },
    "out-of-enum adversarial_outcome": { signal: "pass", adversarial_outcome: "skipped", findings: [] },
    "non-object finding": { signal: "pass", findings: ["x"] },
    "not json": `{"signal": "${SECRET}`,
  };
  const before = f.events().length;
  for (const [label, input] of Object.entries(cases)) {
    const w = f.review(input);
    assert.equal(w.code, 1, `${label}: ${w.stderr}`);
    assert.ok(!w.stderr.includes(SECRET), label);
    assert.ok(!existsSync(f.out("review-verdict.json")), label);
  }
  assert.match(f.review(cases.unavailable).stderr, /--park unavailable/);
  mkdirSync(join(f.runDir, ISSUE, "review-rounds"), { recursive: true });
  writeFileSync(join(f.runDir, ISSUE, "review-rounds", "round-1.json"), "{}");
  assert.equal(f.review({ signal: "pass", findings: [] }).code, 1);
  assert.ok(!existsSync(f.out("review-verdict.json")));
  rmSync(join(f.runDir, ISSUE, "review-rounds"), { recursive: true });
  writeFileSync(join(f.runDir, ISSUE, "review-rounds"), "not a directory");
  assert.equal(f.review({ signal: "pass", findings: [] }).code, 1);
  assert.ok(!existsSync(f.out("review-verdict.json")));
  assert.equal(f.events().length, before);
});

test("bare review-verdict collates recorded rounds, refusing none (FAFF-1268); --terminal-only elsewhere exits 2", (t) => {
  const f = fixture(t);
  const bare = f.write("review-verdict", JSON.stringify({ signal: "pass", findings: [] }));
  assert.equal(bare.code, 1);
  assert.match(bare.stderr, /no review rounds recorded; use --park or --terminal-only/);
  assert.equal(f.write("ac-checklist", JSON.stringify({ all_verified: true }), ["--terminal-only"]).code, 2);
  assert.equal(f.write("holdout", "{}").code, 2);
  assert.deepEqual(readdirSync(f.runDir).filter((n) => n === ISSUE), []);
});

test("both writers exit 2 and write nothing for a bad issue id or a run dir outside .faff/runs", (t) => {
  const f = fixture(t);
  const elsewhere = join(f.root, "elsewhere");
  mkdirSync(elsewhere);
  for (const run of [(i, r) => f.ac({ all_verified: true }, r, i), (i, r) => f.review({ signal: "pass", findings: [] }, r, i)]) {
    for (const issue of ["../x", "a/b", "", ".hidden"]) assert.equal(run(issue, f.runDir).code, 2, issue);
    assert.equal(run(ISSUE, elsewhere).code, 2);
    assert.equal(run(ISSUE, join(f.root, ".faff", "runs")).code, 2);
  }
  assert.deepEqual(readdirSync(elsewhere), []);
  assert.ok(!existsSync(join(f.runDir, ISSUE)));
});

test("a known secret in a criterion or a finding rationale is written as [REDACTED]", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".faffrc.yaml"), `andon:\n  token: ${SECRET}\n`);
  assert.equal(f.ac({ all_verified: true, criteria: [{ ac: "a", verified: `Verified: ${SECRET}`, passed: true, ac_id: "issue-1#ac-1" }] }).code, 0);
  assert.equal(f.review({ signal: "pass", findings: [{ ...FINDING, disposition_rationale: `because ${SECRET}` }] }).code, 0);
  for (const name of ["ac-checklist.json", "review-verdict.json"]) {
    const text = readFileSync(f.out(name), "utf8");
    assert.ok(!text.includes(SECRET), name);
    assert.ok(text.includes("[REDACTED]"), name);
  }
});

test("computeReviewVerdict treats a null severity, disposition or source as absent", () => {
  const r = computeReviewVerdict({ signal: "fail", findings: [{ location_present: true, action_present: true, severity: null, disposition: null, source: null }] });
  assert.deepEqual(r.contractData.violations, []);
  assert.equal(r.contractData.signal, "fail");
  assert.deepEqual(r.contractData.findings, [{ location_present: true, action_present: true }]);
  assert.deepEqual(computeReviewVerdict({ signal: "pass", findings: [{ location_present: true, action_present: true, severity: "huge" }] }).contractData.violations, ['finding[0] severity "huge" not in {critical,major,minor,observation}']);
});

test("smoke: a graft run through the writers mints an anchor that validates as pass", (t) => {
  const root = mkdtempSync(join(tmpdir(), "faff-evidence-write-smoke-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.FAFF_RUN_DIR;
  delete env.FAFF_SESSION_ID;
  const git = (...a) => spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "README"), "seed\n");
  git("add", "README");
  git("commit", "-qm", "seed");
  const cli = (args, input) => runCli(args, { cwd: root, env, input });
  const mint = cli(["run-ledger", "init-interactive", "--issue", "FAFF-1", "--root", root, "--json"]);
  assert.equal(mint.code, 0, mint.stderr);
  const runDir = JSON.parse(mint.stdout).run_dir;
  assert.equal(cli(["build-progress", "write", runDir, "FAFF-1", "--build-complete", "--diff-hash", "a".repeat(64), "--branch", "b"]).code, 0);
  assert.equal(cli(["evidence", "write", "ac-checklist", "--run-dir", runDir, "--issue", "FAFF-1"], JSON.stringify({ all_verified: true, criteria: [{ ...CRITERIA[0], ac_id: "faff-1#ac-1" }] })).code, 0);
  assert.equal(cli(["evidence", "write", "review-verdict", "--terminal-only", "--run-dir", runDir, "--issue", "FAFF-1"], JSON.stringify({ signal: "pass", findings: [FINDING] })).code, 0);
  const scratch = join(root, "rounds");
  mkdirSync(scratch);
  writeFileSync(join(scratch, "round-1.json"), JSON.stringify({ verdict: "approve", objections: [] }));
  const comment = cli(["spec-review", "collate-evidence", "--dir", scratch, "--comment"]);
  assert.equal(comment.code, 0, comment.stderr);
  assert.equal(cli(["evidence", "write", "spec-review-verdict", "--run-dir", runDir, "--issue", "FAFF-1"], comment.stdout).code, 0);
  const dest = join(".faff", "anchors", "smoke", "FAFF-1");
  const anchor = cli(["events", "anchor", "--run-dir", runDir, "--issue", "FAFF-1", "--dest", dest]);
  assert.equal(anchor.code, 0, anchor.stderr);
  const report = JSON.parse(cli(["evidence", "validate", dest, "--json"]).stdout);
  assert.equal(report.status, "pass", JSON.stringify(report.files.filter((x) => x.status !== "ok")));
  assert.ok(["ac-checklist.json", "review-verdict.json", "spec-review-verdict.json"].every((n) => report.files.some((x) => x.path === n && x.status === "ok")));
  const anchored = readFileSync(join(root, dest, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(anchored.filter((e) => e.type === "evidence-terminal-only" && e.issue === "FAFF-1").length, 1);
});
