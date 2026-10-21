// FAFF-1259 — `faff holdout record` and the shared holdout-record.js writer: the evaluator's block becomes
// the v0.3 `holdout-anchored` record, for the global store and the run-scoped copy the merge floor reads.
// The gate (computeHoldoutVerdict, readHoldout, `faff holdout verdict`) must route exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, utimesSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const require = createRequire(import.meta.url);
const { buildHoldoutRecord, holdoutRecordViolations, isSafeHoldoutKey, resolveContained } = require("../plugin/skills/faff/bin/lib/holdout-record.js");
const { readHoldout } = require("../plugin/skills/faff/bin/lib/merge-gate.js");
const { dodClassify } = require("../plugin/skills/faff/bin/lib/admissibility.js");
const { validateAgainstSchema } = require("../plugin/skills/faff/bin/lib/contract-engine.js");
const SCHEMA = JSON.parse(readFileSync(join(HERE, "..", "plugin", "skills", "faff", "contracts", "evidence-v0.3", "schema", "holdout-anchored.schema.json"), "utf8"));

function repo() {
  const root = mkdtempSync(join(tmpdir(), "faff-holdout-record-"));
  mkdirSync(join(root, ".faff", "runs", "run-x", "FAFF-1"), { recursive: true });
  mkdirSync(join(root, ".git"));
  return root;
}
const faff = (root, args, input, env = {}) => spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: "utf8", input, env: { ...process.env, ...env } });
// FAFF-1291: `faff holdout record` needs the full-view spec the evaluator received. SPEC has one judged
// scenario (scenarios:1) and two prose DONE items (delegated to the AC checklist).
const SPEC = ["## Scenarios", "", "```", "Given an order", "When it is posted", "Then 201", "```", "", "## 8. DONE", "", "- [ ] [ac-1] The copy reads well", "- [ ] [ac-2] Operators like the dashboard", ""].join("\n");
const specFile = (root, text = SPEC, name = "spec.md") => { const f = join(root, name); writeFileSync(f, text); return f; };
const holdoutRecord = (root, args, input, env) => {
  const withSpec = args.includes("--spec") ? args : [...args, "--spec", specFile(root)];
  return faff(root, ["holdout", "record", ...withSpec], typeof input === "string" ? input : JSON.stringify(input), env);
};

const scenario = (extra = {}) => ({
  id: "scenarios:1", text: "Given an order When it is posted Then 201", holdout: true, class: "scenario", verdict: "met", evidence_present: true,
  exercised: 'POST /orders {"sku":"a"}', expected: "201 and an order id", observed: '201 Created; body {"id":"ord-1"}', evidence_ref: null, reason: null, ...extra,
});
const prose = () => ({ id: "scenarios:1", text: "The copy reads well", holdout: false, class: "prose", verdict: "needs-human", evidence_present: false, reason: "prose scenario: no machine check and no delegate verifier" });
const block = (criteria = [scenario()], extra = {}) => ({ aggregate: "meets-spec", code_blind: true, violations: [], criteria, ...extra });
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const storeFile = (root, key) => join(root, ".faff", "holdout", `${key}.json`);
const runFile = (root, issue = "FAFF-1") => join(root, ".faff", "runs", "run-x", issue, "holdout.json");

test("accepted block: exit 0, byte-identical store and run copies, detail kept, gate unchanged", () => {
  const root = repo();
  const b = block([scenario()], { aggregate: "meets-spec" });
  const r = holdoutRecord(root, ["--issue", "FAFF-1", "--run-dir", ".faff/runs/run-x"], b);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(storeFile(root, "FAFF-1"), "utf8"), readFileSync(runFile(root), "utf8"));
  const rec = read(runFile(root));
  assert.equal(rec.issue, "FAFF-1");
  assert.equal(rec.criteria[0].id, "scenarios:1");
  assert.equal(rec.criteria[0].exercised, b.criteria[0].exercised);
  assert.deepEqual(validateAgainstSchema(rec, SCHEMA), []);
  assert.deepEqual(rec.delegated.map((r) => [r.id, r.verification_tier, r.verifier, r.ac_id]), [["done:1", "delegated", "ac-checklist", "faff-1#ac-1"], ["done:2", "delegated", "ac-checklist", "faff-1#ac-2"]]);
  const verdict = faff(root, ["holdout", "verdict", "--issue", "FAFF-1"]);
  assert.equal(verdict.status, 0);
  assert.equal(JSON.parse(verdict.stdout).gate, "pass");
  rmSync(root, { recursive: true, force: true });
});

test("a record written after the build-complete checkpoint passes readHoldout's freshness check", () => {
  const root = repo();
  const progress = join(root, ".faff", "runs", "run-x", "FAFF-1", "build-progress.json");
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  writeFileSync(progress, JSON.stringify({ schema_version: 1, updated_at: oneMinuteAgo.toISOString() }));
  const r = holdoutRecord(root, ["--issue", "FAFF-1", "--run-dir", ".faff/runs/run-x"], block([scenario()], { aggregate: "meets-spec" }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readHoldout(join(root, ".faff", "runs", "run-x"), "FAFF-1"), "meets-spec");
  rmSync(root, { recursive: true, force: true });
});

test("detail keys do not change the gate: same result with and without them", () => {
  const root = repo();
  const bare = { aggregate: "meets-spec", code_blind: true, violations: [], criteria: [{ class: "scenario", verdict: "met", evidence_present: true }] };
  const bareDir = join(root, "bare");
  mkdirSync(bareDir);
  writeFileSync(join(bareDir, "FAFF-1.json"), JSON.stringify(bare));
  const withoutDetail = JSON.parse(faff(root, ["holdout", "verdict", "--issue", "FAFF-1", "--dir", bareDir]).stdout);
  holdoutRecord(root, ["--issue", "FAFF-1"], block([scenario()], { aggregate: "meets-spec" }));
  const withDetail = JSON.parse(faff(root, ["holdout", "verdict", "--issue", "FAFF-1"]).stdout);
  for (const key of ["gate", "reason", "aggregate", "code_blind"]) assert.equal(withDetail[key], withoutDetail[key], key);
  rmSync(root, { recursive: true, force: true });
});

test("a met criterion with exercised null: exit 1, a fail-closed record on disk, and the gate blocks", () => {
  const root = repo();
  const r = holdoutRecord(root, ["--issue", "FAFF-1", "--run-dir", ".faff/runs/run-x"], block([scenario({ exercised: null })], { aggregate: "meets-spec" }));
  assert.equal(r.status, 1);
  const rec = read(runFile(root));
  assert.equal(rec.aggregate, "needs-human");
  assert.deepEqual(rec.criteria, []);
  assert.match(rec.violations[0], /^holdout record refused:/);
  assert.equal(readFileSync(storeFile(root, "FAFF-1"), "utf8"), readFileSync(runFile(root), "utf8"));
  assert.equal(faff(root, ["holdout", "verdict", "--issue", "FAFF-1"]).status, 1);
  rmSync(root, { recursive: true, force: true });
});

test("a needs-human criterion without a reason is refused; unparseable stdin is refused with a record", () => {
  const root = repo();
  const proseSpec = specFile(root, "## Scenarios\n\nThe copy reads well\n", "prose-spec.md");
  const noReason = holdoutRecord(root, ["--issue", "FAFF-1", "--spec", proseSpec], block([{ ...prose(), reason: null }], { aggregate: "needs-human" }));
  assert.equal(noReason.status, 1);
  const garbage = holdoutRecord(root, ["--issue", "FAFF-1"], "this is not json");
  assert.equal(garbage.status, 1);
  const rec = read(storeFile(root, "FAFF-1"));
  assert.equal(rec.aggregate, "needs-human");
  assert.match(rec.violations[0], /^holdout record refused:/);
  rmSync(root, { recursive: true, force: true });
});

test("an env-not-ready block (no criteria) is accepted when classify judges nothing, and refused when it judges something", () => {
  const root = repo();
  const doneOnly = specFile(root, "## 8. DONE\n\n- [ ] The copy reads well\n", "done-only.md");
  const r = holdoutRecord(root, ["--issue", "FAFF-1", "--spec", doneOnly], { aggregate: "needs-human", code_blind: true, violations: ["env not ready"], criteria: [] });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(read(storeFile(root, "FAFF-1")).violations, ["env not ready"]);
  const refused = holdoutRecord(root, ["--issue", "FAFF-1"], { aggregate: "needs-human", code_blind: true, violations: ["env not ready"], criteria: [] });
  assert.equal(refused.status, 1);
  assert.match(read(storeFile(root, "FAFF-1")).violations[0], /missing \[scenarios:1\]/);
  rmSync(root, { recursive: true, force: true });
});

test("a fenced faff-contract:holdout-verdict block in markdown is accepted", () => {
  const root = repo();
  const md = `# report\n\n\`\`\`faff-contract:holdout-verdict\n${JSON.stringify(block([scenario()], { aggregate: "meets-spec" }))}\n\`\`\`\n`;
  const r = holdoutRecord(root, ["--issue", "FAFF-1"], md);
  assert.equal(r.status, 0, r.stderr);
  rmSync(root, { recursive: true, force: true });
});

test("input that claims spawner_attested is written as false and null", () => {
  const root = repo();
  const claim = block([scenario()], {
    aggregate: "meets-spec", spawner_attested: true,
    attestation: { spawner: "evaluate-call.mjs", withheld: { repo: true, worktree_cwd: true, diff: true }, preflight: "pass" },
  });
  const r = holdoutRecord(root, ["--issue", "FAFF-1"], claim);
  assert.equal(r.status, 0, r.stderr);
  const rec = read(storeFile(root, "FAFF-1"));
  assert.equal(rec.spawner_attested, false);
  assert.equal(rec.attestation, null);
  rmSync(root, { recursive: true, force: true });
});

test("identical input gives byte-identical output", () => {
  const root = repo();
  holdoutRecord(root, ["--issue", "FAFF-1"], block());
  const first = readFileSync(storeFile(root, "FAFF-1"), "utf8");
  holdoutRecord(root, ["--issue", "FAFF-1"], block());
  assert.equal(readFileSync(storeFile(root, "FAFF-1"), "utf8"), first);
  rmSync(root, { recursive: true, force: true });
});

test("--issue differing from the recorded issue: exit 2 and both files unchanged", () => {
  const root = repo();
  holdoutRecord(root, ["--issue", "FAFF-1"], block());
  const before = readFileSync(storeFile(root, "FAFF-1"), "utf8");
  const r = holdoutRecord(root, ["--issue", "FAFF-2", "--key", "FAFF-1", "--run-dir", ".faff/runs/run-x"], block([scenario({ exercised: null })]));
  assert.equal(r.status, 2);
  assert.equal(readFileSync(storeFile(root, "FAFF-1"), "utf8"), before);
  assert.equal(existsSync(runFile(root, "FAFF-2")), false);
  rmSync(root, { recursive: true, force: true });
});

test("--key names the file and --issue names the record; an issue-less legacy file is overwritten", () => {
  const root = repo();
  mkdirSync(join(root, ".faff", "holdout"), { recursive: true });
  writeFileSync(storeFile(root, "FAFF-9"), JSON.stringify({ aggregate: "meets-spec", code_blind: true, criteria: [], violations: [] }));
  const r = holdoutRecord(root, ["--issue", "FAFF-2", "--key", "FAFF-9"], block());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(storeFile(root, "FAFF-9")).issue, "FAFF-2");
  rmSync(root, { recursive: true, force: true });
});

test("an unparseable store file is renamed aside before the write", () => {
  const root = repo();
  mkdirSync(join(root, ".faff", "holdout"), { recursive: true });
  writeFileSync(storeFile(root, "FAFF-1"), "{ not json");
  const r = holdoutRecord(root, ["--issue", "FAFF-1"], block());
  assert.equal(r.status, 0, r.stderr);
  const aside = readdirSync(join(root, ".faff", "holdout")).filter((f) => f.startsWith("FAFF-1.json.unparseable-"));
  assert.equal(aside.length, 1);
  assert.equal(readFileSync(join(root, ".faff", "holdout", aside[0]), "utf8"), "{ not json");
  rmSync(root, { recursive: true, force: true });
});

test("id guard, --run-dir containment and credentials-env failures exit 2 and write nothing", () => {
  const root = repo();
  const elsewhere = mkdtempSync(join(tmpdir(), "faff-holdout-elsewhere-"));
  symlinkSync(elsewhere, join(root, ".faff", "runs", "linked"));
  const cases = [
    ["--issue", "../x"],
    ["--issue", "a/b"],
    ["--issue", "FAFF-1", "--key", "..", ],
    ["--issue", "FAFF-1", "--key", "-x"],
    ["--issue", "FAFF-1", "--run-dir", elsewhere],
    ["--issue", "FAFF-1", "--run-dir", ".faff/runs/linked"],
    ["--issue", "FAFF-1", "--run-dir", ".faff/runs"],
    ["--issue", "FAFF-1", "--credentials-env", "FAFF_HOLDOUT_UNSET_VAR"],
  ];
  for (const args of cases) {
    const r = holdoutRecord(root, args, block());
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
  }
  const bad = holdoutRecord(root, ["--issue", "FAFF-1", "--credentials-env", "FAFF_HOLDOUT_CREDS"], block(), { FAFF_HOLDOUT_CREDS: "{ nope" });
  assert.equal(bad.status, 2);
  assert.equal(bad.stderr.includes("nope"), false, "the credential value is never echoed");
  assert.equal(existsSync(join(root, ".faff", "holdout")), false);
  assert.deepEqual(readdirSync(elsewhere), []);
  rmSync(root, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

test("--run-dir creates <run-dir>/<issue>/ when absent, and --json prints the written record", () => {
  const root = repo();
  const r = holdoutRecord(root, ["--issue", "FAFF-7", "--run-dir", ".faff/runs/run-x", "--json"], block());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, readFileSync(runFile(root, "FAFF-7"), "utf8"));
  rmSync(root, { recursive: true, force: true });
});

test("--credentials-env removes the bearer token everywhere, including across the truncation point, and writes only the two copies", () => {
  const root = repo();
  const token = "tok-9f8e7d6c5b4a";
  const creds = JSON.stringify({ scheme: "bearer", token });
  const straddling = scenario({ observed: `${"x".repeat(1978)}${token}${"y".repeat(100)}` });
  const echoed = scenario({ id: "scenarios:2", expected: `expects Authorization: Bearer ${token}` });
  const twoScenarios = specFile(root, SPEC.replace("## 8. DONE", "```\nGiven b\nWhen c\nThen d\n```\n\n## 8. DONE").replace("Then 201\n```\n\n```\nGiven b", "Then 201\n```\n\n```\nGiven b"), "two.md");
  const r = holdoutRecord(root, ["--issue", "FAFF-1", "--run-dir", ".faff/runs/run-x", "--credentials-env", "FAFF_HOLDOUT_CREDS", "--spec", twoScenarios], block([straddling, echoed], { aggregate: "meets-spec", violations: [`saw ${token}`] }), { FAFF_HOLDOUT_CREDS: creds });
  assert.equal(r.status, 0, r.stderr);
  const bytes = readFileSync(runFile(root), "utf8");
  for (let n = 6; n <= token.length; n++) {
    assert.equal(bytes.includes(token.slice(0, n)), false, `prefix ${token.slice(0, n)} leaked`);
  }
  assert.match(bytes, /\[REDACTED\]/);
  assert.deepEqual(readdirSync(join(root, ".faff", "holdout")), ["FAFF-1.json"]);
  assert.deepEqual(readdirSync(join(root, ".faff", "runs", "run-x", "FAFF-1")), ["holdout.json"]);
  rmSync(root, { recursive: true, force: true });
});

test("holdout record is listed in the CLI surface (usage names it, missing --issue exits 2)", () => {
  const root = repo();
  const r = faff(root, ["holdout", "record"], "{}");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--issue/);
  const noSpec = faff(root, ["holdout", "record", "--issue", "FAFF-1"], JSON.stringify(block()));
  assert.equal(noSpec.status, 2);
  assert.match(noSpec.stderr, /--spec/);
  assert.equal(existsSync(join(root, ".faff", "holdout")), false);
  rmSync(root, { recursive: true, force: true });
});

test("library: truncation, surrogate pairs, config secrets and value-free violation messages", () => {
  const opts = { issue: "FAFF-1", secretValues: ["config-secret-123"], classified: dodClassify(SPEC, { issue: "FAFF-1" }) };
  const long = buildHoldoutRecord(block([scenario({ observed: "z".repeat(5000) })], { aggregate: "meets-spec" }), opts);
  assert.equal(long.doc.criteria[0].observed.length, 2000);
  assert.ok(long.doc.criteria[0].observed.endsWith("…[truncated]"));
  const pair = buildHoldoutRecord(block([scenario({ observed: `${"z".repeat(1987)}\u{1F600}${"t".repeat(100)}` })], { aggregate: "meets-spec" }), opts);
  assert.equal(pair.doc.criteria[0].observed.length, 1999);
  const secret = buildHoldoutRecord(block([scenario({ observed: "key=config-secret-123" })], { aggregate: "meets-spec" }), opts);
  assert.equal(secret.doc.criteria[0].observed, "key=[REDACTED]");

  const sentinel = "SENTINEL-VALUE-xyz";
  const messages = holdoutRecordViolations({ ...long.doc, criteria: [{ ...long.doc.criteria[0], id: sentinel, text: 5, verdict: "met", exercised: null }] });
  assert.ok(messages.length > 0);
  assert.ok(messages.every((m) => !m.includes(sentinel)));

  assert.ok(isSafeHoldoutKey("FAFF-1") && !isSafeHoldoutKey("a/b") && !isSafeHoldoutKey("a..b"));
  assert.equal(resolveContained("/tmp/base", "../x"), null);
});

test("library: the writer refuses an aggregate the criteria do not derive, never rewrites it", () => {
  const out = buildHoldoutRecord(block([scenario()], { aggregate: "fails" }), { issue: "FAFF-1", secretValues: [], classified: dodClassify(SPEC, { issue: "FAFF-1" }) });
  assert.equal(out.ok, false);
  assert.equal(out.doc.aggregate, "needs-human");
  assert.ok(out.doc.violations.includes('holdout record refused: aggregate is "fails" but criteria derive "meets-spec"'), out.doc.violations.join("\n"));
});

test("holdout --selftest and the contract accept an accepted record", () => {
  const root = repo();
  assert.equal(faff(root, ["holdout", "--selftest"]).status, 0);
  holdoutRecord(root, ["--issue", "FAFF-1"], block([scenario()], { aggregate: "meets-spec" }));
  const c = faff(root, ["contract", "holdout-verdict"], readFileSync(storeFile(root, "FAFF-1"), "utf8"));
  assert.equal(c.status, 0, c.stdout + c.stderr);
  rmSync(root, { recursive: true, force: true });
});

test("skill prose: graft's resume skip needs an empty violations list, and the callers name the writers (FAFF-1259)", () => {
  const read = (p) => readFileSync(join(HERE, "..", "plugin", "skills", p, "SKILL.md"), "utf8");
  const graft = read("faff-graft");
  const skip = graft.split("\n").find((l) => l.includes("idempotent on resume"));
  assert.ok(skip && /violations list is empty/.test(skip), "the 8c skip fires only for a record with no violations");
  assert.match(graft, /`faff holdout record --spec <full_spec>` \(inline\) or the evaluate-call\.mjs spawner \(caged\)/);
  const beep = read("faff-beep-boop");
  assert.match(beep, /faff holdout record --issue <key> --spec </);
  assert.match(beep, /--store-out <abs repo root>\/\.faff\/holdout\/<key>\.json/);
  assert.match(beep, /written by `faff holdout record` or the spawner's `--store-out`/);
  const evaluator = read("faffter-noon-evaluate");
  assert.doesNotMatch(evaluator, /persist the \*\*same\*\* block to `\.faff\/holdout/);
  assert.match(evaluator, /you write no file/);
  assert.match(evaluator, /Excerpt rule/);
});
