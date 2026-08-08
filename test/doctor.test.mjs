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
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

function run(...args) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString() }; }
}

// FAFF-676: an explicit child environment for every test that reaches the DEFAULT scan set
// (no --target) or asserts doctor's output BYTE-exactly. `run` above passes no `env` at all,
// so a child would inherit the real `$HOME` and `$CLAUDE_PLUGIN_ROOT` of whoever runs the
// suite — harmless for the ten existing `--target` tests above (which never reach the
// default branch), but fatal for anything that does: it would scan the runner's actual
// `~/.claude/skills`, or short-circuit to a plugin path, and a golden captured on one
// machine could never byte-match on another. `delete`, not assigning `undefined` — whether
// a spawn drops an `undefined` env value is a Node version detail this must not depend on.
function runEnv(env, ...args) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.CLAUDE_PLUGIN_ROOT;
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8", env: childEnv }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString() }; }
}

// A fenced --root plus a fixture $HOME whose .local/bin/faff is a deterministic live symlink
// to a non-repo path — the shape capture_single_directory_golden pins, reused here so every
// default-scan-set test gets the same non-flaky bin/faff + fence axes.
function mkFixtureHome() {
  const home = mkdtempSync(join(tmpdir(), "doc-home-"));
  const nonRepo = mkdtempSync(join(tmpdir(), "doc-nonrepo-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  symlinkSync(nonRepo, join(home, ".local", "bin", "faff"));
  return { home, nonRepo };
}

function mkFencedRootHere() {
  const root = mkdtempSync(join(tmpdir(), "doc-fence-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "faff merge-fence --hook" }] }] },
  }, null, 2) + "\n");
  return root;
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

// ---- FAFF-676: the single-directory golden — proves --target output did NOT move ----
//
// Captured BEFORE cmdDoctor was touched, from a scan fixture covering live / dangling / copy
// classifications with the live link pointing OUTSIDE the repo (so classifyGlobalLink cannot
// return intoWorktree whether this suite runs from the main checkout or a linked worktree),
// plus a fixture $HOME whose .local/bin/faff is a symlink to that same non-repo path (so the
// bin/faff line is deterministically "✓ bin/faff  symlink (live)" and adds nothing to
// intoWorktree). The committed file has every per-run absolute path normalised to <TARGET>,
// <ROOT> and <HOME> — a byte comparison, never a substring match, because substrings are
// exactly what let wording, ordering and indentation drift through unnoticed (the failure
// mode all three review passes on this spec's producer objected to).
test("doctor: --target output is byte-identical to the pre-FAFF-676 golden", () => {
  const scanDir = mkdtempSync(join(tmpdir(), "doc-golden-target-"));
  const { home, nonRepo } = mkFixtureHome();
  const root = mkFencedRootHere();
  try {
    symlinkSync(nonRepo, join(scanDir, "faff-graft"));                            // live, non-repo
    symlinkSync(join(scanDir, "gone-xyz"), join(scanDir, "faffter-noon-review")); // dangling
    mkdirSync(join(scanDir, "faff-prep"));                                        // copy

    const r = runEnv({ HOME: home }, "doctor", "--target", scanDir, "--root", root);
    assert.equal(r.code, 1, "the golden fixture set fixes exit 1");

    const normalised = r.out.split(scanDir).join("<TARGET>").split(root).join("<ROOT>").split(home).join("<HOME>");
    const golden = readFileSync(join(HERE, "golden", "doctor", "single-directory.txt"), "utf8");
    assert.equal(normalised.trimEnd(), golden.trimEnd());

    // The leak check: a per-run absolute path nobody pinned would survive normalisation and
    // silently turn this into a photograph of the machine that ran it, not of doctor.
    assert.doesNotMatch(normalised.replace(/<TARGET>|<ROOT>|<HOME>/g, ""), /\/(tmp|var|Users|home)\//,
      "no absolute path may survive normalisation");

    // No missing-here finding — the constraint from WHAT: missing_here is empty by
    // construction whenever the scan set has exactly one entry, which --target always is.
    assert.doesNotMatch(r.out, /MISSING here/);
  } finally {
    rmSync(scanDir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    rmSync(nonRepo, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- FAFF-676: the default (no --target) scan set — half-install detection ----

test("doctor: default scan set — one healthy, one absent → exit 1, names the absent directory as MISSING", () => {
  const { home, nonRepo } = mkFixtureHome();
  const root = mkFencedRootHere();
  try {
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    symlinkSync(nonRepo, join(home, ".claude", "skills", "faff-graft"));
    // ~/.agents/skills does not exist — the state every pre-FAFF-672 machine is in.
    const r = runEnv({ HOME: home }, "doctor", "--root", root);
    assert.equal(r.code, 1);
    assert.match(r.out, /\.agents\/skills/);
    assert.match(r.out, /not present — all 1 faff skill\(s\) found elsewhere are MISSING here/);
    assert.match(r.out, /1 skill\(s\) missing from .*\.agents\/skills/);
    assert.match(r.out, /link-skills\.sh --global --replace/);
    // the healthy directory's own section carries no problem
    assert.doesNotMatch(r.out, /skill\(s\) missing from .*\.claude\/skills/);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(nonRepo, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test("doctor: default scan set — both directories healthy → exit 0, a section for each", () => {
  const { home, nonRepo } = mkFixtureHome();
  const root = mkFencedRootHere();
  try {
    for (const dir of [".claude", ".agents"]) {
      mkdirSync(join(home, dir, "skills"), { recursive: true });
      symlinkSync(nonRepo, join(home, dir, "skills", "faff-graft"));
    }
    const r = runEnv({ HOME: home }, "doctor", "--root", root);
    assert.equal(r.code, 0);
    assert.match(r.out, /2 directories scanned/);
    assert.match(r.out, /\.claude\/skills/);
    assert.match(r.out, /\.agents\/skills/);
    assert.doesNotMatch(r.out, /MISSING here/);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(nonRepo, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test("doctor: default scan set — both directories absent or empty → exit 2, both named", () => {
  const home = mkdtempSync(join(tmpdir(), "doc-home-"));
  try {
    const r = runEnv({ HOME: home }, "doctor");
    assert.equal(r.code, 2);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("doctor: default scan set — a subset missing from one directory names exactly that skill, no problem against the other", () => {
  const { home, nonRepo } = mkFixtureHome();
  const root = mkFencedRootHere();
  try {
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    mkdirSync(join(home, ".agents", "skills"), { recursive: true });
    symlinkSync(nonRepo, join(home, ".claude", "skills", "faff-graft"));
    symlinkSync(nonRepo, join(home, ".claude", "skills", "faff-prep"));
    symlinkSync(nonRepo, join(home, ".agents", "skills", "faff-graft"));
    // faff-prep is missing from .agents/skills only
    const r = runEnv({ HOME: home }, "doctor", "--root", root);
    assert.equal(r.code, 1);
    assert.match(r.out, /✗ faff-prep\s+MISSING here/);
    assert.doesNotMatch(r.out, /✗ faff-graft\s+MISSING here/);
    assert.match(r.out, /1 skill\(s\) missing from .*\.agents\/skills/);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(nonRepo, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test("doctor: default scan set — one directory symlinked to the other collapses to a single-directory report (exit 0, no missing-here)", () => {
  const { home, nonRepo } = mkFixtureHome();
  const root = mkFencedRootHere();
  try {
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    mkdirSync(join(home, ".agents"), { recursive: true });
    symlinkSync(nonRepo, join(home, ".claude", "skills", "faff-graft"));
    symlinkSync(join(home, ".claude", "skills"), join(home, ".agents", "skills"));
    const r = runEnv({ HOME: home }, "doctor", "--root", root);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /directories scanned/, "a collapsed set reports as a single directory, not a count");
    assert.match(r.out, /resolves to .*\.claude\/skills — treating them as one target/);
    assert.doesNotMatch(r.out, /MISSING here/);
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(nonRepo, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});
