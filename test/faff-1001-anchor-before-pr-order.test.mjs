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
  const dir = mkdtempSync(join(tmpdir(), "faff-1001-order-"));
  mkdirSync(join(dir, "faff-graft"));
  writeFileSync(join(dir, "faff-graft", "SKILL.md"), body);
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}

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

test("helper: no Step 9b section → scoped:false, ok:true (never false-fails a skill without Step 9b)", () => {
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
