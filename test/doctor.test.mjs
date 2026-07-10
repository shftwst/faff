// FAFF-190 — `faff doctor` install-health: detects copy-installs (stale risk) vs symlinks (live).
// Reads the filesystem, so it works even from a stale installed bin. Tested against fixture targets.
// FAFF-434 added a SECOND, independent install-health axis — the merge-fence PreToolUse
// registration under <--root>/.claude/settings.json — folded into the same exit code. The
// skill-link tests below are about --target only, so each passes a pre-fenced --root (a
// temp dir, never the real repo's .claude/settings.json) to hold that axis constant at
// "present" and keep their original exit-code assertions meaningful; the fence-specific
// behaviour (present/missing/malformed) gets its own tests further down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(...args) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString() }; }
}

// A --root fixture with the merge-fence PreToolUse hook already registered (fence axis
// held at "present"), so the --target skill-link tests exercise ONLY that axis.
function mkFencedRoot() {
  const root = mkdtempSync(join(tmpdir(), "doc-fence-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "faff merge-fence --hook" }] }] },
  }, null, 2) + "\n");
  return root;
}

test("doctor: a symlinked install is clean (exit 0, live)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-ok-"));
  const fenceRoot = mkFencedRoot();
  try {
    symlinkSync("/tmp", join(dir, "faff-graft"));
    symlinkSync("/tmp", join(dir, "faffter-noon-review"));
    const r = run("doctor", "--target", dir, "--root", fenceRoot);
    assert.equal(r.code, 0);
    assert.match(r.out, /repo is live/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fenceRoot, { recursive: true, force: true }); }
});

test("doctor: a copy install is flagged (exit 1, names the skill + the fix)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-copy-"));
  const fenceRoot = mkFencedRoot();
  try {
    mkdirSync(join(dir, "faff-graft"));        // real dir = copy
    symlinkSync("/tmp", join(dir, "faff-prep")); // mixed: one symlink
    const r = run("doctor", "--target", dir, "--root", fenceRoot);
    assert.equal(r.code, 1, "exit non-zero when any skill is a copy");
    assert.match(r.out, /faff-graft\s+COPY/);
    assert.match(r.out, /link-skills\.sh --global --replace/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fenceRoot, { recursive: true, force: true }); }
});

test("doctor: ignores non-faff dirs", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-mix-"));
  const fenceRoot = mkFencedRoot();
  try {
    mkdirSync(join(dir, "some-other-skill"));   // not faff-family → ignored
    symlinkSync("/tmp", join(dir, "faff"));      // the only faff skill, live
    const r = run("doctor", "--target", dir, "--root", fenceRoot);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /some-other-skill/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fenceRoot, { recursive: true, force: true }); }
});

test("doctor: a target with no faff skills is a usage error (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-empty-"));
  try { assert.equal(run("doctor", "--target", dir).code, 2); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-299 — a dangling symlink (target gone, e.g. a rename-orphaned link) is unhealthy,
// not `✓ live → repo`. lstat says "is-a-symlink"; existsSync follows the link to check it resolves.
test("doctor: a dangling symlink is flagged unhealthy (exit 1, not live → repo)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-dangle-"));
  const fenceRoot = mkFencedRoot();
  try {
    symlinkSync(join(dir, "no-such-target-xyz"), join(dir, "faffter-noon-methodology-structural")); // dangling
    const r = run("doctor", "--target", dir, "--root", fenceRoot);
    assert.equal(r.code, 1, "exit non-zero when a skill symlink is dangling");
    assert.match(r.out, /faffter-noon-methodology-structural\s+symlink-dangling/);
    assert.match(r.out, /install is not clean/);
    assert.doesNotMatch(r.out, /faffter-noon-methodology-structural\s+symlink \(live → repo\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fenceRoot, { recursive: true, force: true }); }
});

// FAFF-299 — a mix of live + dangling + copy distinguishes each state with its own label.
test("doctor: mixed live / dangling / copy — each distinguished (exit 1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-mix3-"));
  const fenceRoot = mkFencedRoot();
  try {
    symlinkSync("/tmp", join(dir, "faff-graft"));                          // live
    symlinkSync(join(dir, "gone"), join(dir, "faffter-noon-review"));      // dangling
    mkdirSync(join(dir, "faff-prep"));                                     // copy
    const r = run("doctor", "--target", dir, "--root", fenceRoot);
    assert.equal(r.code, 1);
    assert.match(r.out, /faff-graft\s+symlink \(live → repo\)/);
    assert.match(r.out, /faffter-noon-review\s+symlink-dangling/);
    assert.match(r.out, /faff-prep\s+COPY/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fenceRoot, { recursive: true, force: true }); }
});

// FAFF-434 — the merge-fence PreToolUse registration axis, independent of --target.
test("doctor: merge-fence MISSING (no settings.json under --root) → exit 1, names hooks-ensure", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-fence-target-"));
  const fenceRoot = mkdtempSync(join(tmpdir(), "doc-fence-missing-")); // no .claude/settings.json at all
  try {
    symlinkSync("/tmp", join(dir, "faff-graft")); // skill-link axis clean, in isolation
    const r = run("doctor", "--target", dir, "--root", fenceRoot);
    assert.equal(r.code, 1, "a missing fence alone makes doctor non-clean");
    assert.match(r.out, /merge-fence PreToolUse fence MISSING/);
    assert.match(r.out, /faff hooks-ensure/);
    assert.doesNotMatch(r.out, /repo is live/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fenceRoot, { recursive: true, force: true }); }
});

test("doctor: merge-fence present (registered by hooks-ensure) → exit 0 alongside a clean skill-link scan", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-fence-target-"));
  const fenceRoot = mkdtempSync(join(tmpdir(), "doc-fence-present-"));
  try {
    symlinkSync("/tmp", join(dir, "faff-graft"));
    const ensured = run("hooks-ensure", "--root", fenceRoot);
    assert.equal(ensured.code, 0);
    const r = run("doctor", "--target", dir, "--root", fenceRoot);
    assert.equal(r.code, 0);
    assert.match(r.out, /merge-fence PreToolUse fence present/);
    assert.match(r.out, /repo is live/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fenceRoot, { recursive: true, force: true }); }
});

test("doctor: malformed settings.json under --root degrades to MISSING, not a crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-fence-target-"));
  const fenceRoot = mkdtempSync(join(tmpdir(), "doc-fence-malformed-"));
  try {
    symlinkSync("/tmp", join(dir, "faff-graft"));
    mkdirSync(join(fenceRoot, ".claude"), { recursive: true });
    writeFileSync(join(fenceRoot, ".claude", "settings.json"), "{ not valid json");
    const r = run("doctor", "--target", dir, "--root", fenceRoot);
    assert.equal(r.code, 1);
    assert.match(r.out, /merge-fence PreToolUse fence MISSING/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fenceRoot, { recursive: true, force: true }); }
});

test("doctor: both a copy install AND a missing fence are named together (exit 1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "doc-fence-target-"));
  const fenceRoot = mkdtempSync(join(tmpdir(), "doc-fence-both-"));
  try {
    mkdirSync(join(dir, "faff-graft")); // copy
    const r = run("doctor", "--target", dir, "--root", fenceRoot);
    assert.equal(r.code, 1);
    assert.match(r.out, /faff-graft\s+COPY/);
    assert.match(r.out, /merge-fence PreToolUse fence MISSING/);
    assert.match(r.out, /link-skills\.sh --global --replace/);
    assert.match(r.out, /faff hooks-ensure/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(fenceRoot, { recursive: true, force: true }); }
});
