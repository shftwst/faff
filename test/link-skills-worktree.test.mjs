// FAFF-443 — a `--global` skill install is machine-wide and long-lived, so it must be sourced
// from the stable MAIN checkout, never an ephemeral linked worktree (else the global links
// dangle when the worktree is removed). These tests build a REAL linked worktree (`git init` +
// `git worktree add`, so its `.git` is a FILE — the `.git`-DIR layout in sync.test.mjs's mkRepo
// cannot reproduce the capture) and exercise:
//   (a) scripts/link-skills.sh --global retargets the source to main, with a notice;
//   (b) faff doctor flags a live global symlink resolving INTO a worktree (⚠ intoWorktree, exit 1).
// Plus the load-bearing edge/regression cases: main-checkout unchanged, local-mode unchanged,
// refuse-when-main-lacks-plugin/skills, and doctor's no-false-positive on a healthy install.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, realpathSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const LINK_SH = join(REPO, "scripts", "link-skills.sh");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

// A MAIN git checkout carrying scripts/link-skills.sh + a couple of skills, committed. When
// withSkills=false, plugin/skills is absent (exercises the refuse-when-bare guard).
function mkMainRepo({ withSkills = true } = {}) {
  const main = mkdtempSync(join(tmpdir(), "ls-main-"));
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "t@t.t");
  git(main, "config", "user.name", "t");
  mkdirSync(join(main, "scripts"), { recursive: true });
  cpSync(LINK_SH, join(main, "scripts", "link-skills.sh"));
  if (withSkills) {
    mkdirSync(join(main, "plugin", "skills", "faff", "bin"), { recursive: true });
    writeFileSync(join(main, "plugin", "skills", "faff", "SKILL.md"), "# faff\n");
    writeFileSync(join(main, "plugin", "skills", "faff", "bin", "faff"), "#!/usr/bin/env node\n");
    mkdirSync(join(main, "plugin", "skills", "demo-skill"), { recursive: true });
    writeFileSync(join(main, "plugin", "skills", "demo-skill", "SKILL.md"), "# demo\n");
  } else {
    writeFileSync(join(main, "README"), "x\n"); // something to commit
  }
  git(main, "add", "-A");
  git(main, "commit", "-qm", "init");
  return main;
}

function addWorktree(main) {
  const wt = mkdtempSync(join(tmpdir(), "ls-wt-"));
  rmSync(wt, { recursive: true, force: true }); // git worktree add wants a non-existent path
  git(main, "worktree", "add", "-q", "-b", "wt-branch", wt);
  assert.ok(statSync(join(wt, ".git")).isFile(), "a linked worktree's .git must be a FILE");
  return wt;
}

function linkSh(scriptDir, home, ...args) {
  const r = spawnSync("bash", [join(scriptDir, "scripts", "link-skills.sh"), ...args],
    { env: { ...process.env, HOME: home }, encoding: "utf8" });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function doctor(target, root, home) {
  try { return { code: 0, out: execFileSync("node", [CLI, "doctor", "--target", target, "--root", root],
    { encoding: "utf8", env: { ...process.env, HOME: home } }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString() }; }
}

// A --root fixture with the merge-fence PreToolUse hook registered, so doctor's fence axis is
// held at "present" and the exit code reflects only the skill-link scan (mirrors doctor.test.mjs).
function mkFencedRoot() {
  const root = mkdtempSync(join(tmpdir(), "ls-fence-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "faff merge-fence --hook" }] }] },
  }, null, 2) + "\n");
  return root;
}

const clean = (paths) => { for (const p of paths) rmSync(p, { recursive: true, force: true }); };

test("FAFF-443: --global from a linked worktree sources the MAIN checkout (not the worktree)", () => {
  const main = mkMainRepo();
  const wt = addWorktree(main);
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    const r = linkSh(wt, home, "--global");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /worktree detected — sourcing global links from the main checkout/);
    const demoLink = join(home, ".claude", "skills", "demo-skill");
    assert.ok(existsSync(demoLink), "demo-skill link should exist");
    assert.equal(realpathSync(demoLink), realpathSync(join(main, "plugin", "skills", "demo-skill")),
      "demo-skill must resolve under MAIN's plugin/skills");
    assert.equal(realpathSync(demoLink).startsWith(realpathSync(wt)), false, "must NOT resolve under the worktree");
    // the ~/.local/bin/faff CLI link is re-derived from the retargeted source too
    assert.equal(realpathSync(join(home, ".local", "bin", "faff")),
      realpathSync(join(main, "plugin", "skills", "faff", "bin", "faff")), "bin/faff under MAIN");
  } finally { clean([main, wt, home]); }
});

test("FAFF-443: --global from a linked worktree whose main lacks plugin/skills REFUSES (exit 1)", () => {
  const main = mkMainRepo({ withSkills: false });
  const wt = addWorktree(main);
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    const r = linkSh(wt, home, "--global");
    assert.equal(r.code, 1, "must refuse rather than dangle");
    assert.match(r.err, /main checkout has no plugin\/skills/);
    assert.equal(existsSync(join(home, ".claude", "skills")), false, "no links created on refuse");
  } finally { clean([main, wt, home]); }
});

test("FAFF-443 regression: --global from the MAIN checkout is unchanged (no retarget, no notice)", () => {
  const main = mkMainRepo();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    const r = linkSh(main, home, "--global");
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /worktree detected/, "no retarget notice from the main checkout");
    assert.equal(realpathSync(join(home, ".claude", "skills", "demo-skill")),
      realpathSync(join(main, "plugin", "skills", "demo-skill")), "links under main, as before");
  } finally { clean([main, home]); }
});

test("FAFF-443 regression: local (non --global) mode from a worktree links the worktree's OWN skills", () => {
  const main = mkMainRepo();
  const wt = addWorktree(main);
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    const r = linkSh(wt, home); // no --global → repo-local target inside the worktree
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.out, /worktree detected/, "local mode never retargets");
    assert.equal(realpathSync(join(wt, ".claude", "skills", "demo-skill")),
      realpathSync(join(wt, "plugin", "skills", "demo-skill")), "local links point at the worktree's own skills");
  } finally { clean([main, wt, home]); }
});

test("FAFF-443: doctor flags a live global symlink resolving INTO a worktree (⚠ intoWorktree, exit 1)", () => {
  const main = mkMainRepo();
  const wt = addWorktree(main);
  const target = mkdtempSync(join(tmpdir(), "ls-target-"));
  const fence = mkFencedRoot();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    // a live link whose target sits inside the linked worktree
    execFileSync("ln", ["-s", join(wt, "plugin", "skills", "demo-skill"), join(target, "faff-graft")]);
    const r = doctor(target, fence, home);
    assert.equal(r.code, 1, "a worktree-sourced global link is not clean");
    assert.match(r.out, /faff-graft\s+symlink \(live → WORKTREE/);
    assert.match(r.out, /worktree-sourced link\(s\) \(fragile/);
    assert.doesNotMatch(r.out, /faff-graft\s+symlink \(live → repo\)/);
  } finally { clean([main, wt, target, fence, home]); }
});

test("FAFF-443: doctor no false positive — a healthy global link (→ main checkout) is clean (exit 0)", () => {
  const main = mkMainRepo();
  const target = mkdtempSync(join(tmpdir(), "ls-target-"));
  const fence = mkFencedRoot();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    execFileSync("ln", ["-s", join(main, "plugin", "skills", "demo-skill"), join(target, "faff-graft")]);
    const r = doctor(target, fence, home);
    assert.equal(r.code, 0, "a main-sourced link must not trip intoWorktree");
    assert.match(r.out, /faff-graft\s+symlink \(live → repo\)/);
    assert.doesNotMatch(r.out, /intoWorktree|live → WORKTREE/);
  } finally { clean([main, target, fence, home]); }
});
