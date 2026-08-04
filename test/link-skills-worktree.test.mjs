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
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, realpathSync, existsSync, statSync, lstatSync } from "node:fs";
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

// FAFF-676: a sibling of `doctor` above that passes NO --target at all, so it actually
// reaches the default scan-set branch of resolve_doctor_scan_set — the existing helper
// hardcodes --target and can therefore never exercise it. Deletes CLAUDE_PLUGIN_ROOT from
// the child environment rather than merely overriding HOME: that variable is live in this
// repo's world (test/setup-worktree-direct.test.mjs and test/setup-worktree-clobber.test.mjs
// both set it deliberately, and any agent session running faff as an installed plugin has it
// set in the parent environment that runs this suite), and step 2 of resolve_doctor_scan_set
// short-circuits to the plugin's own skills directory the moment it survives into the child —
// which would let the installer-and-doctor agreement test below pass while exercising a code
// path this ticket does not touch, proving nothing about the claim it exists to check.
function doctorDefault(root, home) {
  const env = { ...process.env, HOME: home };
  delete env.CLAUDE_PLUGIN_ROOT;
  try { return { code: 0, out: execFileSync("node", [CLI, "doctor", "--root", root], { encoding: "utf8", env }) }; }
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
    assert.match(r.err, /worktree detected — sourcing global links from the main checkout/); // notice on stderr (stays loud under >/dev/null)
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
    // FAFF-672: a refusal that populated ONE target would itself be a half-install — neither may exist
    assert.equal(existsSync(join(home, ".agents", "skills")), false, "no ~/.agents/skills created on refuse either");
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

test("FAFF-443: --global --unlink from a worktree does NOT retarget (documented pre-worktree-remove cleanup operates on the worktree's own links)", () => {
  const main = mkMainRepo();
  const wt = addWorktree(main);
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    // simulate a pre-fix worktree-SOURCED global install (links → the worktree's plugin/skills)
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    execFileSync("ln", ["-s", join(wt, "plugin", "skills", "demo-skill"), join(home, ".claude", "skills", "demo-skill")]);
    const r = linkSh(wt, home, "--global", "--unlink");
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /worktree detected/, "--unlink must not retarget");
    // the worktree-sourced link is the one --unlink cleans (retarget would have missed it)
    assert.equal(existsSync(join(home, ".claude", "skills", "demo-skill")), false,
      "the worktree-sourced link should have been unlinked");
  } finally { clean([main, wt, home]); }
});

// ---- FAFF-672: --global installs into TWO targets (~/.claude/skills + ~/.agents/skills) ----

test("FAFF-672: --global installs each skill into BOTH ~/.claude/skills and ~/.agents/skills, resolving to MAIN", () => {
  const main = mkMainRepo();
  const wt = addWorktree(main);
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    const r = linkSh(wt, home, "--global");
    assert.equal(r.code, 0, r.err);
    for (const t of [".claude", ".agents"]) {
      const link = join(home, t, "skills", "demo-skill");
      assert.ok(existsSync(link), `${t}/skills/demo-skill should exist`);
      assert.equal(realpathSync(link), realpathSync(join(main, "plugin", "skills", "demo-skill")),
        `${t} link must resolve under MAIN's plugin/skills`);
    }
    // both point at the repo, not at each other
    assert.equal(realpathSync(join(home, ".claude", "skills", "demo-skill")),
      realpathSync(join(home, ".agents", "skills", "demo-skill")),
      "both targets resolve to the same source");
    // neither target directory is itself a symlink — other tools' entries stay put
    assert.equal(lstatSync(join(home, ".claude", "skills")).isSymbolicLink(), false, "~/.claude/skills is a real dir");
    assert.equal(lstatSync(join(home, ".agents", "skills")).isSymbolicLink(), false, "~/.agents/skills is a real dir");
  } finally { clean([main, wt, home]); }
});

test("FAFF-672: --global --unlink from a worktree cleans worktree-sourced links from BOTH targets", () => {
  const main = mkMainRepo();
  const wt = addWorktree(main);
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    // a pre-fix worktree-SOURCED global install present in both targets
    for (const t of [".claude", ".agents"]) {
      mkdirSync(join(home, t, "skills"), { recursive: true });
      execFileSync("ln", ["-s", join(wt, "plugin", "skills", "demo-skill"), join(home, t, "skills", "demo-skill")]);
    }
    const r = linkSh(wt, home, "--global", "--unlink");
    assert.equal(r.code, 0, r.err);
    assert.equal(existsSync(join(home, ".claude", "skills", "demo-skill")), false, "the ~/.claude worktree-sourced link is cleaned");
    assert.equal(existsSync(join(home, ".agents", "skills", "demo-skill")), false, "the ~/.agents worktree-sourced link is cleaned too");
  } finally { clean([main, wt, home]); }
});

test("FAFF-672: --global --replace replaces a faff-named copy in ~/.agents/skills but leaves a non-faff entry beside it untouched", () => {
  const main = mkMainRepo();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    // a non-faff entry and a faff-named COPY install, side by side in ~/.agents/skills
    mkdirSync(join(home, ".agents", "skills", "other-tool-skill"), { recursive: true });
    writeFileSync(join(home, ".agents", "skills", "other-tool-skill", "keep"), "x\n");
    mkdirSync(join(home, ".agents", "skills", "demo-skill"), { recursive: true });
    writeFileSync(join(home, ".agents", "skills", "demo-skill", "SKILL.md"), "# copy\n");
    const r = linkSh(main, home, "--global", "--replace");
    assert.equal(r.code, 0, r.err);
    // the bound that is the whole safety argument: a name no faff skill owns is never touched
    assert.ok(existsSync(join(home, ".agents", "skills", "other-tool-skill", "keep")),
      "a non-faff entry must survive --replace");
    // the faff-named copy is now a repo symlink
    assert.equal(lstatSync(join(home, ".agents", "skills", "demo-skill")).isSymbolicLink(), true,
      "the faff-named copy was replaced by a symlink");
    assert.equal(realpathSync(join(home, ".agents", "skills", "demo-skill")),
      realpathSync(join(main, "plugin", "skills", "demo-skill")), "and it points into the repo");
  } finally { clean([main, home]); }
});

test("FAFF-672: with ~/.agents/skills symlinked to ~/.claude/skills, --status reports one target and counts each skill once", () => {
  const main = mkMainRepo();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    linkSh(main, home, "--global"); // populate both targets as real dirs
    // the user hand-fixed the bug with a directory symlink — collapse must kick in
    rmSync(join(home, ".agents", "skills"), { recursive: true, force: true });
    execFileSync("ln", ["-s", join(home, ".claude", "skills"), join(home, ".agents", "skills")]);
    const r = linkSh(main, home, "--global", "--status");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /resolves to .*\.claude\/skills — treating them as one target/);
    const targetLines = (r.out.match(/^Target: /gm) || []).length;
    assert.equal(targetLines, 1, "a collapsed setup reports exactly one target");
    // two skills (faff, demo-skill), each counted once — not doubled
    assert.match(r.out, /linked \(this repo\): 2/);
  } finally { clean([main, home]); }
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

// ---- FAFF-676: doctor's default scan set must agree with the installer's target list ----
//
// Doctor restates the installer's target-directory derivation in Node rather than shelling
// out to the bash script (resolve_doctor_scan_set in gates.js) — the cost of restating is
// drift, and this is the test that pays for it: run the REAL installer, then the REAL
// doctor, under one faked $HOME, and assert they agree about which directories exist. If the
// two lists ever diverge, this fails — doctor would otherwise report confidently about a
// directory nothing writes to, which the spec calls worse than the silent doctor it replaces.
test("FAFF-676: faff doctor's default scan set agrees with scripts/link-skills.sh --global's target list", () => {
  const main = mkMainRepo();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  const fence = mkFencedRoot();
  try {
    const installed = linkSh(main, home, "--global");
    assert.equal(installed.code, 0, installed.err);

    // The agreement claim only holds if this call actually reached the default branch of
    // resolve_doctor_scan_set. If CLAUDE_PLUGIN_ROOT leaked into the child, step 2 would
    // short-circuit to the plugin's own skills directory and this test would pass while
    // proving nothing about the claim it exists to check — so assert the environment it
    // built, not only doctor's output.
    const env = { ...process.env, HOME: home };
    delete env.CLAUDE_PLUGIN_ROOT;
    assert.equal(env.CLAUDE_PLUGIN_ROOT, undefined, "the child environment must not carry CLAUDE_PLUGIN_ROOT");

    const r = doctorDefault(fence, home);
    assert.equal(r.code, 0, "both installer-created directories are healthy, so the verdict must be clean");
    // every directory the installer created appears as a section in doctor's report —
    // under the faked $HOME, never a plugin-root path.
    assert.match(r.out, new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.claude/skills`));
    assert.match(r.out, new RegExp(`${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.agents/skills`));
    assert.doesNotMatch(r.out, /MISSING here/);
  } finally { clean([main, home, fence]); }
});

// The same agreement test's negative half: a REMOVED ~/.agents/skills (the state every
// pre-FAFF-672 machine is in immediately after that ticket ships) must turn doctor loud —
// this is the half-install detector actually firing on the population it exists to reach.
test("FAFF-676: with ~/.agents/skills removed after a --global install, doctor names it MISSING (exit 1)", () => {
  const main = mkMainRepo();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  const fence = mkFencedRoot();
  try {
    const installed = linkSh(main, home, "--global");
    assert.equal(installed.code, 0, installed.err);
    rmSync(join(home, ".agents", "skills"), { recursive: true, force: true });

    const r = doctorDefault(fence, home);
    assert.equal(r.code, 1, "a half-install must not report clean");
    assert.match(r.out, /\.agents\/skills/);
    assert.match(r.out, /MISSING here|not present/);
    assert.match(r.out, /link-skills\.sh --global --replace/);
  } finally { clean([main, home, fence]); }
});
