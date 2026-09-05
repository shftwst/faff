// FAFF-1001 — the anchor-before-PR order lint in `faff validate-adapters`. faff-graft's Step 9b
// must commit + push the governance anchor BEFORE `gh pr create`, so a crash between PR-open and
// the anchor commit can never strand an open, review-passed PR whose head lacks its committed
// anchor (which `faff merge-gate` then refuses anchor-missing — the PR #856 incident). The
// crash-timing E2E in run-ledger-init-interactive.test.mjs only exercises resolveAnchorLevel's
// committed-anchor read (behaviour the reorder does NOT change), so it passes either order; THIS
// mechanical byte-offset lint is the reorder's only change-specific regression guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const { checkAnchorBeforePrOrder } =
  require("../plugin/skills/faff/bin/lib/validate-adapters.js");

const CORRECT = `# faff-graft fixture

**Step 9b: Open the PR**

4. \`faff events anchor --run-dir "$run_dir"\` then git commit + push the branch head.
5. \`faff bundle publish …\`
6. \`gh pr create --body-file safe.md\`

**Step 10: Merge-confidence gate**
`;
const WRONG = `# faff-graft fixture

**Step 9b: Open the PR**

4. \`gh pr create --body-file safe.md\`
5. \`faff events anchor --run-dir "$run_dir"\` then git commit + push the branch head.

**Step 10: Merge-confidence gate**
`;

function runOnFaffGraft(body) {
  return runOnNamed("faff-graft", body);
}
// FAFF-1004: same harness, arbitrary skill dir name — for the faff-graft-scoped fail-closed tests
// (a non-faff-graft skill without a Step 9b section must raise no finding).
function runOnNamed(name, body) {
  const dir = mkdtempSync(join(tmpdir(), "faff-1001-order-"));
  mkdirSync(join(dir, name));
  writeFileSync(join(dir, name, "SKILL.md"), body);
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}
// A faff-graft fixture whose Step 9b heading is renamed away (no `**Step 9b:` bound → scoped:false).
const RENAMED = `# faff-graft fixture

**Step 9x: Open the PR**

4. \`faff events anchor --run-dir "$run_dir"\` then git commit + push the branch head.
5. \`gh pr create --body-file safe.md\`

**Step 10: Merge-confidence gate**
`;
// A faff-graft fixture with `**Step 9b:` but no `**Step 10:` bound (partial section → scoped:false).
const PARTIAL = `# faff-graft fixture

**Step 9b: Open the PR**

4. \`faff events anchor --run-dir "$run_dir"\` then git commit + push the branch head.
5. \`gh pr create --body-file safe.md\`
`;

// --- the pure helper (unit) ---

test("helper: correct order (anchor before gh pr create) → ok", () => {
  assert.equal(checkAnchorBeforePrOrder(CORRECT).ok, true);
});

test("helper: wrong order (gh pr create before anchor) → not ok — the regression the lint guards", () => {
  const r = checkAnchorBeforePrOrder(WRONG);
  assert.equal(r.ok, false);
  assert.ok(r.prIdx >= 0 && r.anchorIdx >= 0 && r.prIdx < r.anchorIdx);
});

test("helper: a Step 9b missing either phrase → not ok (fail-closed, never a silent pass)", () => {
  assert.equal(checkAnchorBeforePrOrder("**Step 9b:** nothing here\n**Step 10:** x").ok, false);
});

test("helper: no Step 9b section → scoped:false, ok:true (the pure reporter; the faff-graft fail-closed policy lives at the CLI, FAFF-1004)", () => {
  // The helper stays a pure skill-agnostic reporter: an absent section is scoped:false/ok:true.
  // The "an absent Step 9b section FAILs faff-graft" policy is the call site's (see the FAFF-1004
  // CLI tests below); a NON-faff-graft skill without a Step 9b section still raises no finding.
  const r = checkAnchorBeforePrOrder("# some other skill\n\nno step nine-bee here");
  assert.equal(r.scoped, false);
  assert.equal(r.ok, true);
});

test("helper: the real shipped faff-graft SKILL.md is in the correct order", () => {
  const real = readFileSync(join(REPO, "plugin", "skills", "faff-graft", "SKILL.md"), "utf8");
  const r = checkAnchorBeforePrOrder(real);
  assert.equal(r.scoped, true);
  assert.equal(r.ok, true, "shipped Step 9b must anchor before gh pr create");
});

// --- the CLI lint (integration via --skills-dir) ---

test("CLI: a faff-graft fixture with gh pr create BEFORE the anchor FAILs the order lint", () => {
  const r = runOnFaffGraft(WRONG);
  assert.match(r.stdout, /anchor-before-PR order/);
  assert.match(r.stdout, /FAFF-1001/);
  assert.notEqual(r.status, 0);
});

test("CLI: a faff-graft fixture with the anchor BEFORE gh pr create raises no order finding", () => {
  const r = runOnFaffGraft(CORRECT);
  assert.doesNotMatch(r.stdout, /anchor-before-PR order/);
});

test("CLI: the shipped tree carries no anchor-before-PR order finding", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  assert.doesNotMatch(r.stdout, /anchor-before-PR order/, "the post-FAFF-1001 tree must be in the correct order");
});

// --- FAFF-1004: fail-closed on a renamed/absent or partial Step 9b section (faff-graft only) ---

test("FAFF-1004 CLI: a faff-graft fixture whose Step 9b heading is renamed/absent FAILs (fail-closed)", () => {
  const r = runOnFaffGraft(RENAMED);
  assert.match(r.stdout, /anchor-before-PR order/);
  assert.match(r.stdout, /FAFF-1004/);
  assert.notEqual(r.status, 0);
});

test("FAFF-1004 CLI: a faff-graft fixture with a partial Step 9b section (no `**Step 10:`) FAILs (fail-closed)", () => {
  const r = runOnFaffGraft(PARTIAL);
  assert.match(r.stdout, /anchor-before-PR order/);
  assert.match(r.stdout, /FAFF-1004/);
  assert.notEqual(r.status, 0);
});

test("FAFF-1004 CLI: a NON-faff-graft skill with no Step 9b section raises no finding (the guard stays faff-graft-scoped)", () => {
  const r = runOnNamed("faffter-noon-spec", "# some other skill\n\nno step nine-bee section here at all");
  assert.doesNotMatch(r.stdout, /anchor-before-PR order/);
});
