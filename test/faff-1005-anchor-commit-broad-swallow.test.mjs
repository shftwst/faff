// FAFF-1005 — the anchor-commit broad-swallow lint in `faff validate-adapters`. faff-graft's Step 9b
// anchor commit must abort a genuine failure before `gh pr create`, never mask it with a blanket
// `|| true` / `|| :` (FAFF-1001's nothing-to-commit-only tolerance). Step 9b is agent-run prose with
// no executable unit, so this static lint is the reachable guard. Crux: the correct prose NAMES
// `|| true` to forbid it, so the lint matches the swallow only when it shares a single code span with
// a `git commit`/`git add` command — the prohibitive prose keeps them in separate spans.
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
const { checkAnchorCommitNoBroadSwallow } =
  require("../plugin/skills/faff/bin/lib/validate-adapters.js");

// A faff-graft fixture with a command-position swallow in ONE inline span (the anti-pattern).
const SWALLOW_INLINE = `# faff-graft fixture

**Step 9b: Open the PR**

4. Anchor: \`faff events anchor --run-dir "$run_dir"\` then \`git commit -m msg || true\` and push.
5. \`gh pr create --body-file safe.md\`

**Step 10: Merge-confidence gate**
`;
// A fenced-line swallow on git add with `|| :` (the holdout).
const SWALLOW_FENCED = `# faff-graft fixture

**Step 9b: Open the PR**

\`\`\`
faff events anchor --run-dir "$run_dir"
git add -A || :
gh pr create --body-file safe.md
\`\`\`

**Step 10: Merge-confidence gate**
`;
// The prohibitive-prose shape: git command and \`|| true\` are named, but in SEPARATE spans — clean.
const PROHIBITIVE = `# faff-graft fixture

**Step 9b: Open the PR**

4. \`faff events anchor\` then \`git commit\` + push; the commit tolerates only nothing-to-commit, never a blanket \`|| true\` that would mask a real failure.
5. \`gh pr create --body-file safe.md\`

**Step 10: Merge-confidence gate**
`;
// A malformed section: a fence opens and never closes before Step 10, and prohibitive prose that
// merely names \`git commit\` and \`|| true\` follows it. A naive collector left in-fence would turn
// that prose into a whole-line span and raise a false FAIL — the exact false-positive class the
// design forbids. The buffered collector discards a never-closed fence, so this stays clean.
const UNTERMINATED_FENCE = `# faff-graft fixture

**Step 9b: Open the PR**

\`\`\`
faff events anchor --run-dir "$run_dir"

the anchor commit tolerates only nothing-to-commit, never a blanket git commit ... || true that masks a real failure

**Step 10: Merge-confidence gate**
`;

function runOnNamed(name, body) {
  const dir = mkdtempSync(join(tmpdir(), "faff-1005-swallow-"));
  mkdirSync(join(dir, name));
  writeFileSync(join(dir, name, "SKILL.md"), body);
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--skills-dir", dir], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return r;
}
const runOnFaffGraft = (body) => runOnNamed("faff-graft", body);

// --- the pure helper (unit) ---

test("helper: a git commit and `|| true` in the SAME span → not ok (the anti-pattern)", () => {
  const r = checkAnchorCommitNoBroadSwallow(SWALLOW_INLINE);
  assert.equal(r.ok, false);
  assert.match(r.hit, /git commit/);
});

test("helper: a fenced `git add -A || :` line → not ok", () => {
  assert.equal(checkAnchorCommitNoBroadSwallow(SWALLOW_FENCED).ok, false);
});

test("helper: prohibitive prose (git command and `|| true` in SEPARATE spans) → ok (not flagged)", () => {
  const r = checkAnchorCommitNoBroadSwallow(PROHIBITIVE);
  assert.equal(r.scoped, true);
  assert.equal(r.ok, true);
});

test("helper: an unterminated fence does not turn trailing prohibitive prose into a false FAIL", () => {
  const r = checkAnchorCommitNoBroadSwallow(UNTERMINATED_FENCE);
  assert.equal(r.scoped, true);
  assert.equal(r.ok, true);
});

test("helper: no Step 9b section → scoped:false, ok:true (pure reporter)", () => {
  const r = checkAnchorCommitNoBroadSwallow("# some other skill\n\nno step nine-bee here");
  assert.equal(r.scoped, false);
  assert.equal(r.ok, true);
});

test("helper: the real shipped faff-graft SKILL.md is scoped and clean (live guard, not a degenerate no-op)", () => {
  const real = readFileSync(join(REPO, "plugin", "skills", "faff-graft", "SKILL.md"), "utf8");
  const r = checkAnchorCommitNoBroadSwallow(real);
  assert.equal(r.scoped, true, "the shipped Step 9b section must be located (else the guard is a no-op)");
  assert.equal(r.ok, true, "the shipped prohibitive prose must not be flagged");
});

// --- the CLI lint (integration via --skills-dir) ---

test("CLI: a faff-graft fixture with `git commit … || true` in one span FAILs", () => {
  const r = runOnFaffGraft(SWALLOW_INLINE);
  assert.match(r.stdout, /anchor-commit broad-swallow/);
  assert.match(r.stdout, /FAFF-1005/);
  assert.notEqual(r.status, 0);
});

test("CLI: a fenced `git add -A || :` FAILs (holdout)", () => {
  const r = runOnFaffGraft(SWALLOW_FENCED);
  assert.match(r.stdout, /anchor-commit broad-swallow/);
  assert.notEqual(r.status, 0);
});

test("CLI: the prohibitive-prose fixture raises no broad-swallow finding", () => {
  const r = runOnFaffGraft(PROHIBITIVE);
  assert.doesNotMatch(r.stdout, /anchor-commit broad-swallow/);
});

test("CLI: a NON-faff-graft skill containing `git commit … || true` raises no finding (faff-graft-scoped)", () => {
  const r = runOnNamed("faffter-noon-spec", SWALLOW_INLINE);
  assert.doesNotMatch(r.stdout, /anchor-commit broad-swallow/);
});

test("CLI: the shipped tree carries no anchor-commit broad-swallow finding", () => {
  const r = spawnSync(process.execPath, [BIN, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  assert.doesNotMatch(r.stdout, /anchor-commit broad-swallow/, "the post-FAFF-1005 tree must be clean");
});
