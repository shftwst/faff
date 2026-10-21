// FAFF-1360 — a non-prose DONE item that names a repository test file or an exported symbol is tiered
// `integration` by `faff dod classify`, so the code-blind holdout is not asked to judge it. These tests
// spawn the CLI over the FAFF-1354 DoD fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const FIXTURE = join(HERE, "fixtures", "faff-1360", "faff-1354-dod.md");

const faff = (cwd, args, input) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", input });
const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), "faff-1360-"));
  mkdirSync(join(root, ".git"));
  return root;
};
const specFile = (root, text, name = "spec.md") => { const f = join(root, name); writeFileSync(f, text); return f; };
const classify = (root, spec, issue = "FAFF-1354") => {
  const r = faff(root, ["dod", "classify", "--spec", spec, "--issue", issue, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const byId = (c, id) => c.criteria.find((x) => x.id === id);
const met = (id) => ({ id, text: `criterion ${id}`, holdout: false, class: "scenario", verdict: "met", evidence_present: true, exercised: "GET /x", expected: "200", observed: "200", evidence_ref: null, reason: null });
const block = (criteria, aggregate) => ({ aggregate, code_blind: true, violations: [], criteria });
const record = (root, issue, spec, b) => faff(root, ["holdout", "record", "--issue", issue, "--spec", spec], JSON.stringify(b));
const stored = (root, issue) => JSON.parse(readFileSync(join(root, ".faff", "holdout", `${issue}.json`), "utf8"));

test("ac-1: the FAFF-1354 DoD sends done:3 and done:8 to the test floor and judges the 7 scenarios", () => {
  const root = scratch();
  const c = classify(root, FIXTURE);
  for (const id of ["done:3", "done:8"]) {
    assert.equal(byId(c, id).verification_tier, "integration", id);
    assert.equal(byId(c, id).verifier, "review-merge-floor", id);
  }
  for (let n = 1; n <= 7; n++) {
    assert.equal(byId(c, `scenarios:${n}`).verification_tier, "running-stack");
    assert.equal(byId(c, `scenarios:${n}`).verifier, "holdout");
  }
  assert.equal(c.judged_count, 7);
  assert.equal(c.integration_count, 2);
  assert.equal(c.delegated_count, 15);
  rmSync(root, { recursive: true, force: true });
});

test("ac-6: counts and every other tier are unchanged on the FAFF-1354 DoD", () => {
  const root = scratch();
  const c = classify(root, FIXTURE);
  assert.deepEqual(c.counts, { scenario: 7, assertion: 2, prose: 13 });
  assert.deepEqual(c.holdout_counts, { holdout: 2, visible: 20 });
  assert.equal(c.oracle_less_count, 0);
  for (const x of c.criteria) {
    if (x.id === "done:3" || x.id === "done:8") continue;
    assert.equal(x.verification_tier, x.source === "scenarios" ? "running-stack" : "delegated", x.id);
  }
  rmSync(root, { recursive: true, force: true });
});

test("scenario 2 and ac-5: a CLI-only DONE item and a Scenarios test-file unit stay running-stack", () => {
  const root = scratch();
  const spec = specFile(root, ["## Scenarios", "", "- `test/a.test.mjs` MUST pass", "", "## 8. DONE", "", "- [ ] `faff events append` MUST exit 1 on an empty issue", ""].join("\n"));
  const c = classify(root, spec, "FAFF-9");
  assert.equal(c.criteria.length, 2);
  for (const x of c.criteria) {
    assert.equal(x.verification_tier, "running-stack");
    assert.equal(x.verifier, "holdout");
  }
  rmSync(root, { recursive: true, force: true });
});

test("ac-2 and scenario 3: an all-met block for the 7 scenarios records meets-spec with 15 delegated rows", () => {
  const root = scratch();
  const spec = specFile(root, readFileSync(FIXTURE, "utf8"));
  const r = record(root, "FAFF-1354", spec, block([1, 2, 3, 4, 5, 6, 7].map((n) => met(`scenarios:${n}`)), "meets-spec"));
  assert.equal(r.status, 0, r.stderr);
  const doc = stored(root, "FAFF-1354");
  assert.equal(doc.aggregate, "meets-spec");
  assert.equal(doc.criteria.length, 7);
  assert.equal(doc.delegated.length, 15);
  for (const id of ["done:3", "done:8"]) {
    const row = doc.delegated.find((d) => d.id === id);
    assert.equal(row.verification_tier, "integration");
    assert.equal(row.verifier, "review-merge-floor");
  }
  rmSync(root, { recursive: true, force: true });
});

test("ac-7: faff admissible --lights-out warns once, naming 2 code-surface items with 1 mixed", () => {
  const root = scratch();
  const r = faff(root, ["admissible", "--lights-out", "--spec", FIXTURE, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const warnings = JSON.parse(r.stdout).warnings.filter((w) => w.startsWith("code-surface advisory:"));
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].startsWith("code-surface advisory: 2 DONE item(s)"), warnings[0]);
  assert.match(warnings[0], /\(1 also name CLI or HTTP behaviour;/);
  const plain = faff(root, ["admissible", "--spec", FIXTURE, "--json"]);
  assert.ok(!JSON.parse(plain.stdout).warnings.some((w) => w.startsWith("code-surface advisory:")));
  const good = specFile(root, ["## Scenarios", "", "```", "Given a lights-out run and a concrete spec", "When the gate evaluates it", "Then the verdict is admissible", "```", "", "## 8. DONE", "", "- [ ] `faff admissible` MUST emit the verdict JSON", "- [ ] exit code MUST be 0 admissible / 1 inadmissible", ""].join("\n"), "good.md");
  const g = faff(root, ["admissible", "--lights-out", "--spec", good, "--json"]);
  assert.ok(!JSON.parse(g.stdout).warnings.some((w) => w.startsWith("code-surface advisory:")));
  rmSync(root, { recursive: true, force: true });
});

test("ac-17 and scenario 4: nothing judged rolls up to needs-human, and the writer refuses meets-spec over no criteria", () => {
  const root = scratch();
  const spec = specFile(root, ["## Scenarios", "", "## 8. DONE", "", "- [ ] `pkg/store_test.go` MUST pass", ""].join("\n"));
  const c = classify(root, spec, "FAFF-9");
  assert.equal(c.judged_count, 0);
  assert.equal(c.integration_count, 1);
  const ok = record(root, "FAFF-9", spec, block([], "needs-human"));
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(stored(root, "FAFF-9").aggregate, "needs-human");
  const bad = record(root, "FAFF-9", spec, block([], "meets-spec"));
  assert.equal(bad.status, 1);
  const doc = stored(root, "FAFF-9");
  assert.equal(doc.aggregate, "needs-human");
  assert.deepEqual(doc.criteria, []);
  assert.ok(doc.violations.includes('holdout record refused: aggregate is "meets-spec" but criteria derive "needs-human"'), doc.violations.join("\n"));
  rmSync(root, { recursive: true, force: true });
});
