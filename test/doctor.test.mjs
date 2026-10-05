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
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync } from "node:fs";
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

// ---- FAFF-1172: the stale-emit axis fixtures ----
//
// A --root temp tree mirroring plugin/skills/faff/ for the stale-emit axis: a tsconfig `include`,
// its paired .ts/.js, an installed-toolchain signal (node_modules/typescript), and a merge-fence
// settings.json so the fence axis is held PRESENT. Paired with mkFixtureHome() (a deterministic
// bin/faff) and a --target skills dir with one live symlink (populated union), every OTHER axis
// is held constant, so the asserted exit code is attributable to the stale-emit axis alone.
function writeFence(root) {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "faff merge-fence --hook" }] }] },
  }, null, 2) + "\n");
}

function mkEmitRoot({ toolchain = true, tsconfig = true, include = ["bin/lib/producer-auth.ts"], writeSource = true, writeEmit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "doc-emit-"));
  const faffDir = join(root, "plugin", "skills", "faff");
  mkdirSync(join(faffDir, "bin", "lib"), { recursive: true });
  if (toolchain) {
    mkdirSync(join(faffDir, "node_modules", "typescript"), { recursive: true });
    writeFileSync(join(faffDir, "node_modules", "typescript", "package.json"), JSON.stringify({ name: "typescript", version: "5.9.0" }) + "\n");
  }
  if (tsconfig) writeFileSync(join(faffDir, "tsconfig.json"), JSON.stringify({ include }, null, 2) + "\n");
  const tsPath = join(faffDir, "bin", "lib", "producer-auth.ts");
  const jsPath = join(faffDir, "bin", "lib", "producer-auth.js");
  if (writeSource) writeFileSync(tsPath, "export const x = 1;\n");
  if (writeEmit) writeFileSync(jsPath, "exports.x = 1;\n");
  writeFence(root);
  return { root, faffDir, tsPath, jsPath };
}

// A --target skills dir whose single live symlink keeps the union non-empty (so emptyUnion is
// false and the exit rule reaches the fault disjunct, never early-returning exit 2).
function mkSkillsTarget() {
  const skills = mkdtempSync(join(tmpdir(), "doc-skills-"));
  symlinkSync("/tmp", join(skills, "faff-graft"));
  return skills;
}

const EMIT_OLD = new Date("2026-01-01T00:00:00Z");
const EMIT_NEW = new Date("2026-02-01T00:00:00Z");
const setStaleEmit = (tsPath, jsPath) => { utimesSync(jsPath, EMIT_OLD, EMIT_OLD); utimesSync(tsPath, EMIT_NEW, EMIT_NEW); };
const setFreshEmit = (tsPath, jsPath) => { utimesSync(tsPath, EMIT_OLD, EMIT_OLD); utimesSync(jsPath, EMIT_NEW, EMIT_NEW); };

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

// ---- FAFF-1172: the stale-emit axis ----
//
// Every case holds the other three axes constant — a populated union (--target with one live
// symlink), a present fence (writeFence in mkEmitRoot), and a deterministic bin/faff (mkFixtureHome
// via runEnv HOME) — so the asserted exit code is attributable to the stale-emit axis alone. The
// fixture $HOME fence is what makes these hermetic on a linked-worktree dev box, whose real
// ~/.local/bin/faff would otherwise drive exit 1 through the machine-wide bin/faff axis.

test("doctor: stale emit on a buildable checkout → exit 1, names the emit + the build fix", () => {
  const { root, tsPath, jsPath } = mkEmitRoot();
  const skills = mkSkillsTarget();
  const { home, nonRepo } = mkFixtureHome();
  try {
    setStaleEmit(tsPath, jsPath);
    const r = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills);
    assert.equal(r.code, 1, "a stale emit on a buildable checkout is a fault");
    assert.match(r.out, /bin\/lib\/producer-auth\.js\s+emit older than source bin\/lib\/producer-auth\.ts — run the build/);
    assert.match(r.out, /1 stale TypeScript emit\(s\)/);
    assert.match(r.out, /npm run build {2}\(from plugin\/skills\/faff\/\)/);
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});

test("doctor: a fresh build clears the finding → exit 0, emits up to date", () => {
  const { root, tsPath, jsPath } = mkEmitRoot();
  const skills = mkSkillsTarget();
  const { home, nonRepo } = mkFixtureHome();
  try {
    setFreshEmit(tsPath, jsPath);
    const r = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills);
    assert.equal(r.code, 0, "a fresh emit with every other axis clean is exit 0");
    assert.match(r.out, /✓ TypeScript emits up to date/);
    assert.doesNotMatch(r.out, /emit older than source/);
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});

test("doctor: adopter copy (tsconfig + .ts + stale .js, no node_modules/typescript) → axis skipped, no fault", () => {
  const { root, tsPath, jsPath } = mkEmitRoot({ toolchain: false });
  const skills = mkSkillsTarget();
  const { home, nonRepo } = mkFixtureHome();
  try {
    setStaleEmit(tsPath, jsPath); // stale, but not buildable here
    const r = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills, "--json");
    const j = JSON.parse(r.out);
    assert.equal(j.emit_check, "skipped", "no resolvable toolchain → axis skipped despite the stale pair");
    assert.deepEqual(j.stale_emits, []);
    assert.equal(j.exit, 0, "a non-buildable copy never turns an otherwise-clean doctor red");
    assert.equal(r.code, 0);
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});

test("doctor: toolchain present but no tsconfig → axis skipped, clean", () => {
  const { root } = mkEmitRoot({ tsconfig: false });
  const skills = mkSkillsTarget();
  const { home, nonRepo } = mkFixtureHome();
  try {
    const r = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills, "--json");
    const j = JSON.parse(r.out);
    assert.equal(j.emit_check, "skipped");
    assert.deepEqual(j.stale_emits, []);
    assert.equal(j.exit, 0);
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});

test("doctor: --json reflects emit_check + stale_emits with matching exit (stale)", () => {
  const { root, tsPath, jsPath } = mkEmitRoot();
  const skills = mkSkillsTarget();
  const { home, nonRepo } = mkFixtureHome();
  try {
    setStaleEmit(tsPath, jsPath);
    const r = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills, "--json");
    const j = JSON.parse(r.out);
    assert.equal(j.emit_check, "active");
    assert.deepEqual(j.stale_emits, [{ source: "bin/lib/producer-auth.ts", emit: "bin/lib/producer-auth.js" }]);
    assert.equal(j.exit, 1, "the --json exit matches the human renderer");
    assert.equal(r.code, 1);
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});

// Minor #1 (human-accept 2026-10-05): a glob include resolves to zero real pairs (doctor never
// expands globs), so the axis must report INACTIVE (skip) — never "active / up to date" while
// checking nothing — even with the toolchain present and real .ts/.js beside it.
test("doctor: glob include resolves to zero pairs → axis skipped, not a false green", () => {
  const { root } = mkEmitRoot({ include: ["bin/lib/*.ts"] });
  const skills = mkSkillsTarget();
  const { home, nonRepo } = mkFixtureHome();
  try {
    const r = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills, "--json");
    const j = JSON.parse(r.out);
    assert.equal(j.emit_check, "skipped", "a never-expanded glob matches no literal source → zero pairs → skip");
    assert.deepEqual(j.stale_emits, []);
    assert.equal(j.exit, 0);
    const human = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills);
    assert.doesNotMatch(human.out, /TypeScript emits up to date/, "never claims freshness while checking nothing");
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});

test("doctor: an all-non-.ts include → axis skipped, clean", () => {
  const { root } = mkEmitRoot({ include: ["bin/lib/foo.json"] });
  const skills = mkSkillsTarget();
  const { home, nonRepo } = mkFixtureHome();
  try {
    const r = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills, "--json");
    const j = JSON.parse(r.out);
    assert.equal(j.emit_check, "skipped");
    assert.equal(j.exit, 0);
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});

test("doctor: a .ts whose .js emit is missing → clean (not flagged), other pairs still checked", () => {
  const { root, faffDir, tsPath, jsPath } = mkEmitRoot({ include: ["bin/lib/producer-auth.ts", "bin/lib/commissaire.ts"] });
  const skills = mkSkillsTarget();
  const { home, nonRepo } = mkFixtureHome();
  try {
    // producer-auth has no committed .js (never-built → clean); commissaire is a genuine stale pair.
    rmSync(jsPath, { force: true });
    const cTs = join(faffDir, "bin", "lib", "commissaire.ts");
    const cJs = join(faffDir, "bin", "lib", "commissaire.js");
    writeFileSync(cTs, "export const y = 2;\n");
    writeFileSync(cJs, "exports.y = 2;\n");
    setStaleEmit(cTs, cJs);
    utimesSync(tsPath, EMIT_NEW, EMIT_NEW); // producer-auth.ts present, its .js absent
    const r = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills, "--json");
    const j = JSON.parse(r.out);
    assert.equal(j.emit_check, "active", "the resolvable commissaire pair keeps the axis active");
    assert.deepEqual(j.stale_emits, [{ source: "bin/lib/commissaire.ts", emit: "bin/lib/commissaire.js" }]);
    assert.equal(j.exit, 1);
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});

test("doctor: equal mtimes → not flagged (strictly-newer only)", () => {
  const { root, tsPath, jsPath } = mkEmitRoot();
  const skills = mkSkillsTarget();
  const { home, nonRepo } = mkFixtureHome();
  try {
    utimesSync(tsPath, EMIT_NEW, EMIT_NEW);
    utimesSync(jsPath, EMIT_NEW, EMIT_NEW);
    const r = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills, "--json");
    const j = JSON.parse(r.out);
    assert.equal(j.emit_check, "active");
    assert.deepEqual(j.stale_emits, []);
    assert.equal(j.exit, 0);
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});

// FAFF-1172 — the integration smoke test (spec §8): one fixture, the full stale → fresh → adopter
// arc, every other axis held constant so each asserted exit code is attributable to the axis alone.
test("doctor: stale-emit integration smoke — stale (exit 1) → fresh (exit 0) → adopter (skipped)", () => {
  const { root, faffDir, tsPath, jsPath } = mkEmitRoot();
  const skills = mkSkillsTarget();
  const { home, nonRepo } = mkFixtureHome();
  try {
    // 1-4: stale → exit 1, names the emit, Fix names the build.
    setStaleEmit(tsPath, jsPath);
    const stale = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills);
    assert.equal(stale.code, 1);
    assert.match(stale.out, /producer-auth\.js\s+emit older than source .*producer-auth\.ts — run the build/);
    assert.match(stale.out, /npm run build/);

    // 5-6: fresh → exit 0 (no other axis faults), emit_check active + empty under --json.
    setFreshEmit(tsPath, jsPath);
    const fresh = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills);
    assert.equal(fresh.code, 0);
    const freshJson = JSON.parse(runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills, "--json").out);
    assert.equal(freshJson.emit_check, "active");
    assert.deepEqual(freshJson.stale_emits, []);

    // 7-8: remove the toolchain, re-stale → axis skipped, exit 0 (the adopter-copy case).
    rmSync(join(faffDir, "node_modules"), { recursive: true, force: true });
    setStaleEmit(tsPath, jsPath);
    const adopter = JSON.parse(runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills, "--json").out);
    assert.equal(adopter.emit_check, "skipped");
    assert.deepEqual(adopter.stale_emits, []);
    assert.equal(adopter.exit, 0);
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});

// FAFF-1172 — guard against a production silent no-op (adversarial review, major): the axis fires
// only where the toolchain is resolvable AND tsconfig resolves >=1 real .ts/.js pair, so a glob-only
// or all-non-.ts include would (correctly, per the ratified decision) skip. This asserts the REAL
// repo's own tsconfig still resolves >=1 literal pair, so the axis actually fires here rather than
// silently skipping — a future switch to a glob include fails this loudly rather than going dark.
test("doctor: the real plugin/skills/faff tsconfig resolves >=1 literal .ts/.js pair (the axis is not a silent no-op here)", () => {
  const tsconfigDir = join(HERE, "..", "plugin", "skills", "faff");
  const cfg = JSON.parse(readFileSync(join(tsconfigDir, "tsconfig.json"), "utf8"));
  assert.ok(Array.isArray(cfg.include) && cfg.include.length > 0, "the real tsconfig.include is a non-empty array");
  const pairs = cfg.include
    .filter((e) => typeof e === "string" && e.endsWith(".ts"))
    .filter((e) => existsSync(join(tsconfigDir, e)) && existsSync(join(tsconfigDir, e.replace(/\.ts$/, ".js"))));
  assert.ok(pairs.length >= 1,
    "the real tsconfig must resolve >=1 literal .ts/.js pair so the stale-emit axis fires on this repo (a glob-only include would silently skip — see the ratified decision)");
});

// FAFF-1172 — a toolchain-present golden capturing the stale-emit human output byte-exactly
// (minor #3, human-accept 2026-10-05: the existing goldens are toolchain-absent and can only
// photograph the skip case). Per-run absolute paths are normalised to <TARGET>/<ROOT>/<HOME>, a
// byte comparison not a substring match — the same discipline as the FAFF-676 golden above.
test("doctor: stale-emit human output is byte-identical to the golden", () => {
  const { root, tsPath, jsPath } = mkEmitRoot();
  const skills = mkdtempSync(join(tmpdir(), "doc-emit-golden-"));
  const { home, nonRepo } = mkFixtureHome();
  try {
    symlinkSync(nonRepo, join(skills, "faff-graft")); // live, non-repo → "symlink (live → repo)"
    setStaleEmit(tsPath, jsPath);
    const r = runEnv({ HOME: home }, "doctor", "--root", root, "--target", skills);
    assert.equal(r.code, 1, "the golden fixture fixes exit 1");
    const normalised = r.out.split(skills).join("<TARGET>").split(root).join("<ROOT>").split(home).join("<HOME>");
    const golden = readFileSync(join(HERE, "golden", "doctor", "stale-emit.txt"), "utf8");
    assert.equal(normalised.trimEnd(), golden.trimEnd());
    assert.doesNotMatch(normalised.replace(/<TARGET>|<ROOT>|<HOME>/g, ""), /\/(tmp|var|Users|home)\//,
      "no absolute path may survive normalisation");
  } finally { [root, skills, home, nonRepo].forEach((d) => rmSync(d, { recursive: true, force: true })); }
});
