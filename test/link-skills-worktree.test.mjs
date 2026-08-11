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
import { createRequire } from "node:module";

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
//
// `realCli: true` (FAFF-684) copies the ACTUAL plugin/skills/faff bin+lib tree from this repo
// rather than the plain-shebang stub every other test in this file uses — the installer's
// `install.skill_targets` read shells `node "$BIN_SRC" config get …`, and a stub with no body
// always returns empty/exit-0, which is indistinguishable from "config genuinely has nothing
// configured". Only tests that need the config read to actually resolve pass this.
function mkMainRepo({ withSkills = true, realCli = false } = {}) {
  const main = mkdtempSync(join(tmpdir(), "ls-main-"));
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "t@t.t");
  git(main, "config", "user.name", "t");
  // Teardown-race hardening (FAFF-775). These are real git checkouts that clean() removes
  // recursively at the end of each test, and a recursive rmSync is not atomic: it walks the tree
  // then rmdir's each now-empty directory. If a *background/detached* git process writes into
  // `.git` between that walk and the rmdir, the rmdir sees a non-empty directory and throws
  // `ENOTEMPTY`, which is the flake. A bounded rmSync retry (tried first) proved insufficient on
  // CI because the writer is sustained, not a brief flush tail: on the hosted runners git's own
  // auto-maintenance detaches a gc/commit-graph writer that outlives the test's synchronous
  // children. So remove the writer at its source rather than race it: disable every detached
  // maintenance path so `.git` is quiescent by teardown. Deterministic, not timing-dependent.
  git(main, "config", "gc.auto", "0");              // no auto gc at all
  git(main, "config", "gc.autoDetach", "false");    // and any gc that does run stays synchronous, never a detached writer
  git(main, "config", "maintenance.auto", "false"); // no background maintenance scheduler
  git(main, "config", "core.fsmonitor", "false");   // no fsmonitor daemon touching .git
  mkdirSync(join(main, "scripts"), { recursive: true });
  cpSync(LINK_SH, join(main, "scripts", "link-skills.sh"));
  if (withSkills) {
    if (realCli) {
      cpSync(join(REPO, "plugin", "skills", "faff"), join(main, "plugin", "skills", "faff"), { recursive: true });
    } else {
      mkdirSync(join(main, "plugin", "skills", "faff", "bin"), { recursive: true });
      writeFileSync(join(main, "plugin", "skills", "faff", "SKILL.md"), "# faff\n");
      writeFileSync(join(main, "plugin", "skills", "faff", "bin", "faff"), "#!/usr/bin/env node\n");
    }
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

// Backstop to the mkMainRepo maintenance-disabling above (FAFF-775): with the detached git
// writer removed at its source, `.git` is quiescent by teardown and the first rmdir succeeds.
// A recursive rmSync is still non-atomic, so retry the errno class (ENOTEMPTY/EBUSY/EPERM) with
// backoff to absorb any residual filesystem lag. Retry ALONE was proven insufficient on CI (the
// sustained writer outran it): it earns its place only as the second layer behind removing the
// writer, never as the fix on its own.
const clean = (paths) => { for (const p of paths) rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };

// ---- FAFF-675: plugin-root doctor scan fixtures ----
//
// A marketplace-plugin install places faff skills as REAL directories (copies) under
// $CLAUDE_PLUGIN_ROOT/skills, not symlinks — this builds exactly that shape. `home` is
// deliberately a bare temp dir by default (no .local/bin/faff, no ~/.claude) so the plugin-root
// scan is the ONLY thing under test; mkPluginHomeWithRealBin below is the opt-in fixture for
// the advisory bin_faff pin.
function mkPluginRoot(skillNames) {
  const root = mkdtempSync(join(tmpdir(), "ls-pluginroot-"));
  const skillsDir = join(root, "skills");
  mkdirSync(skillsDir, { recursive: true });
  for (const name of skillNames) {
    mkdirSync(join(skillsDir, name), { recursive: true });
    writeFileSync(join(skillsDir, name, "SKILL.md"), `# ${name}\n`);
  }
  return root;
}

function mkPluginHomeWithRealBin() {
  const home = mkdtempSync(join(tmpdir(), "ls-pr-home-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "faff"), "#!/usr/bin/env node\n"); // a real file — the realistic plugin-machine shape (installed via a package manager, not dev-linked)
  return home;
}

// Runs `faff doctor` with $CLAUDE_PLUGIN_ROOT set to `pluginRoot` (no --target — so
// resolveDoctorScanSet's pluginRootEnv branch fires), $HOME set to `home`, and `--root
// fenceRoot`. Uses spawnSync (not execFileSync) so stdout/stderr are captured on every exit
// code, not just the successful one.
function doctorPlugin(pluginRoot, fenceRoot, home, ...extraArgs) {
  const env = { ...process.env, HOME: home, CLAUDE_PLUGIN_ROOT: pluginRoot };
  const r = spawnSync("node", [CLI, "doctor", "--root", fenceRoot, ...extraArgs], { encoding: "utf8", env });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

// FAFF-684: write a committed-base .faffrc.yaml carrying `install.skill_targets` at `dir`
// (the SRC_ROOT the installer's config read runs against — the main checkout, never the
// worktree, since --global always retargets there first). `entries` are pre-quoted YAML
// scalars so a caller can exercise both the normal `~/...` shape and a deliberately
// malformed one in the same helper.
function writeSkillTargetsConfig(dir, entries) {
  const body = "install:\n  skill_targets:\n" + entries.map((e) => `    - ${e}\n`).join("");
  writeFileSync(join(dir, ".faffrc.yaml"), body);
}

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

// ---- FAFF-684: config-driven install-target list ----
//
// The installer reads `install.skill_targets` from the SRC_ROOT's .faffrc.yaml — the main
// checkout, always, since --global retargets there before the read ever runs (mkMainRepo IS
// that checkout in every test below; there's no separate worktree in play here).

test("FAFF-684: key unset — TARGET_DIRS is exactly the default pair, no config-read warning on stderr", () => {
  const main = mkMainRepo();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    const r = linkSh(main, home, "--global");
    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, "", "no config-read warning when the key is simply unset");
    for (const t of [".claude", ".agents"]) {
      assert.ok(existsSync(join(home, t, "skills", "demo-skill")), `${t}/skills/demo-skill should exist`);
    }
  } finally { clean([main, home]); }
});

test("FAFF-684: a set install.skill_targets drives --global into every configured directory", () => {
  const main = mkMainRepo({ realCli: true });
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    writeSkillTargetsConfig(main, ["~/.claude/skills", "~/.agents/skills", "~/.h3/skills"]);
    const r = linkSh(main, home, "--global");
    assert.equal(r.code, 0, r.err);
    for (const t of [".claude", ".agents", ".h3"]) {
      const link = join(home, t, "skills", "demo-skill");
      assert.ok(existsSync(link), `${t}/skills/demo-skill should exist`);
      assert.equal(realpathSync(link), realpathSync(join(main, "plugin", "skills", "demo-skill")),
        `${t} link must resolve under the source checkout`);
    }
    assert.match(r.out, /Targets:\n(.|\n)*\.h3\/skills/, "the Targets: header names the configured directory");
  } finally { clean([main, home]); }
});

test("FAFF-684: a malformed (non-list) install.skill_targets falls back to the default pair, warns on stderr, and the install COMPLETES", () => {
  const main = mkMainRepo({ realCli: true });
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    writeFileSync(join(main, ".faffrc.yaml"), "install:\n  skill_targets: not_a_list\n");
    const r = linkSh(main, home, "--global");
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /ignoring install target/, "a non-usable entry warns rather than silently vanishing");
    for (const t of [".claude", ".agents"]) {
      assert.ok(existsSync(join(home, t, "skills", "demo-skill")), `${t}/skills/demo-skill should exist — the install completed into the default pair`);
    }
  } finally { clean([main, home]); }
});

test("FAFF-684: a non-absolute, non-~ entry is skipped with a notice; the remaining usable entries are used", () => {
  const main = mkMainRepo({ realCli: true });
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    writeSkillTargetsConfig(main, ["relative/path", "~/.h3/skills"]);
    const r = linkSh(main, home, "--global");
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /ignoring install target 'relative\/path'/);
    assert.ok(existsSync(join(home, ".h3", "skills", "demo-skill")), "the usable entry is still installed");
    assert.equal(existsSync(join(home, ".claude", "skills")), false, "the default pair is NOT also installed — a usable configured entry replaces it, not augments it");
  } finally { clean([main, home]); }
});

test("FAFF-684: two configured entries resolving to the same directory collapse to one target with one notice", () => {
  const main = mkMainRepo({ realCli: true });
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    mkdirSync(join(home, ".h3", "skills"), { recursive: true });
    execFileSync("ln", ["-s", join(home, ".h3"), join(home, ".h3alias")]);
    writeSkillTargetsConfig(main, ["~/.h3/skills", "~/.h3alias/skills"]);
    const r = linkSh(main, home, "--global", "--status");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /resolves to .*\.h3\/skills — treating them as one target/);
    const targetLines = (r.out.match(/^Target: /gm) || []).length;
    assert.equal(targetLines, 1, "a collapsed configured pair reports exactly one target");
  } finally { clean([main, home]); }
});

test("FAFF-684: local (non --global) mode never consults install.skill_targets", () => {
  const main = mkMainRepo();
  const wt = addWorktree(main);
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    writeSkillTargetsConfig(main, ["~/.h3/skills"]);
    const r = linkSh(wt, home); // no --global
    assert.equal(r.code, 0, r.err);
    assert.equal(realpathSync(join(wt, ".claude", "skills", "demo-skill")),
      realpathSync(join(wt, "plugin", "skills", "demo-skill")),
      "local mode still links the worktree's own skills, ignoring the configured global targets");
  } finally { clean([main, wt, home]); }
});

test("FAFF-684: node absent from PATH — the config read is skipped, and the install still COMPLETES into the default pair", () => {
  const main = mkMainRepo();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  try {
    writeSkillTargetsConfig(main, ["~/.h3/skills"]); // would matter if read — it must not be
    const r = spawnSync("bash", [join(main, "scripts", "link-skills.sh"), "--global"],
      { env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    for (const t of [".claude", ".agents"]) {
      assert.ok(existsSync(join(home, t, "skills", "demo-skill")), `${t}/skills/demo-skill should exist — fallback, not abort`);
    }
  } finally { clean([main, home]); }
});

// ---- FAFF-684: doctor's default scan set is also config-sourced ----

test("FAFF-684: doctor scans a configured third directory and flags a copy install there (exit 1)", () => {
  const main = mkMainRepo();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  const fence = mkFencedRoot();
  try {
    writeSkillTargetsConfig(fence, ["~/.claude/skills", "~/.h3/skills"]);
    mkdirSync(join(home, ".claude", "skills", "faff-graft"), { recursive: true });
    mkdirSync(join(home, ".h3", "skills", "faff-graft"), { recursive: true }); // a real dir, not a symlink — a COPY install
    writeFileSync(join(home, ".h3", "skills", "faff-graft", "SKILL.md"), "# copy\n");
    const r = doctorDefault(fence, home);
    assert.equal(r.code, 1, "a copy install in the configured third directory is not clean");
    assert.match(r.out, /\.h3\/skills/, "the configured directory is named in the report");
    assert.doesNotMatch(r.out, /\.agents\/skills/, "the un-configured default's second member is not scanned once a config list is set");
  } finally { clean([main, home, fence]); }
});

test("FAFF-684: doctor --target DIR scans exactly that directory and does not read install.skill_targets", () => {
  const main = mkMainRepo();
  const home = mkdtempSync(join(tmpdir(), "ls-home-"));
  const fence = mkFencedRoot();
  try {
    writeSkillTargetsConfig(fence, ["~/.h3/skills"]); // must be ignored — --target pins the scan
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    execFileSync("ln", ["-s", join(main, "plugin", "skills", "demo-skill"), join(home, ".claude", "skills", "faff-graft")]);
    const r = doctor(join(home, ".claude", "skills"), fence, home);
    assert.equal(r.code, 0, "the pinned target is healthy, and the (unconfigured/unscanned) .h3/skills must not affect the verdict");
    assert.doesNotMatch(r.out, /\.h3\/skills/, "--target never reads install.skill_targets");
  } finally { clean([main, home, fence]); }
});

// ---- FAFF-675: the plugin-root copy-classifier carve-out ----
//
// ADR-0097: $CLAUDE_PLUGIN_ROOT is authoritative for the invoking harness — a marketplace
// plugin install ships its skills as real (copied) directories by construction, so a copy
// there is the EXPECTED shape, not the dev-linked COPY fault the classifier was written for.

test("FAFF-675: plugin-root copy install with fence present reads as an expected install (exit 0)", () => {
  const pluginRoot = mkPluginRoot(["faff-graft", "faff-prep"]);
  const fence = mkFencedRoot();
  const home = mkdtempSync(join(tmpdir(), "ls-pr-home-"));
  try {
    const r = doctorPlugin(pluginRoot, fence, home);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /✓ faff-graft {2}plugin install \(copy under \$CLAUDE_PLUGIN_ROOT — expected, not dev-linked\)/);
    assert.match(r.out, /✓ faff-prep {2}plugin install \(copy under \$CLAUDE_PLUGIN_ROOT — expected, not dev-linked\)/);
    assert.doesNotMatch(r.out, /COPY/, "no copy-fault finding for an expected plugin install");
    assert.doesNotMatch(r.out, /link-skills\.sh/, "no unrunnable repair for a plugin user");
    assert.match(r.out, /RESULT: faff skills are a marketplace-plugin install \(copies under \$CLAUDE_PLUGIN_ROOT\) — expected\. Nothing to repair\./);
  } finally { clean([pluginRoot, fence, home]); }
});

test("FAFF-675: plugin-root copy install with fence ABSENT → exit 1, faff hooks-ensure only (no link-skills.sh)", () => {
  const pluginRoot = mkPluginRoot(["faff-graft"]);
  const noFenceRoot = mkdtempSync(join(tmpdir(), "ls-nofence-"));
  const home = mkdtempSync(join(tmpdir(), "ls-pr-home-"));
  try {
    const r = doctorPlugin(pluginRoot, noFenceRoot, home);
    assert.equal(r.code, 1);
    assert.match(r.out, /Fix: faff hooks-ensure\s*$/m);
    assert.doesNotMatch(r.out, /link-skills\.sh/, "the copy contribution is excluded — only the fence fix is offered");
    assert.match(r.out, /✓ faff-graft {2}plugin install/, "the copied skill still renders as expected, not a fault");
  } finally { clean([pluginRoot, noFenceRoot, home]); }
});

test("FAFF-675: faff doctor --json on a plugin-root install names the scanned directory, expected_install:true, copies:0", () => {
  const pluginRoot = mkPluginRoot(["faff-graft"]);
  const fence = mkFencedRoot();
  const home = mkdtempSync(join(tmpdir(), "ls-pr-home-"));
  try {
    const r = doctorPlugin(pluginRoot, fence, home, "--json");
    assert.equal(r.code, 0, r.out + r.err);
    const json = JSON.parse(r.out);
    assert.equal(json.exit, 0);
    assert.equal(json.ok, true);
    assert.equal(json.plugin_root, join(pluginRoot, "skills"));
    assert.equal(json.scanned.length, 1);
    assert.equal(json.scanned[0].directory, join(pluginRoot, "skills"));
    assert.equal(json.scanned[0].expected_install, true);
    assert.equal(json.scanned[0].copies, 0);
    assert.ok(json.scanned[0].expected > 0);
  } finally { clean([pluginRoot, fence, home]); }
});

test("FAFF-675: exit-1 parity — plugin-root with fence absent returns exit 1 with and without --json", () => {
  const pluginRoot = mkPluginRoot(["faff-graft"]);
  const noFenceRoot = mkdtempSync(join(tmpdir(), "ls-nofence-"));
  const home = mkdtempSync(join(tmpdir(), "ls-pr-home-"));
  try {
    const human = doctorPlugin(pluginRoot, noFenceRoot, home);
    const asJson = doctorPlugin(pluginRoot, noFenceRoot, home, "--json");
    assert.equal(human.code, 1);
    assert.equal(asJson.code, 1, "exit parity: --json must return the SAME exit as the human path for the same state");
    assert.match(human.out, /Fix: faff hooks-ensure\s*$/m);
    assert.doesNotMatch(human.out, /link-skills\.sh/);
    const parsed = JSON.parse(asJson.out);
    assert.equal(parsed.exit, 1);
    assert.equal(parsed.ok, false);
  } finally { clean([pluginRoot, noFenceRoot, home]); }
});

test("FAFF-675: exit-2 parity + shape — an empty plugin-root skills dir returns exit 2 with and without --json; the breadcrumb reaches stderr both times", () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "ls-pluginroot-empty-"));
  mkdirSync(join(pluginRoot, "skills"), { recursive: true }); // present but empty — no faff skills at all
  const fence = mkFencedRoot();
  const home = mkdtempSync(join(tmpdir(), "ls-pr-home-"));
  try {
    const human = doctorPlugin(pluginRoot, fence, home);
    assert.equal(human.code, 2);
    assert.match(human.err, /faff doctor: no faff skills found under any of:/);
    assert.equal(human.out, "", "the human path's empty-union case prints nothing to stdout — unchanged from main");

    const asJson = doctorPlugin(pluginRoot, fence, home, "--json");
    assert.equal(asJson.code, 2, "exit parity holds at exit 2 too");
    assert.match(asJson.err, /faff doctor: no faff skills found under any of:/, "the --json path ALSO writes the breadcrumb to stderr");
    const parsed = JSON.parse(asJson.out);
    assert.equal(parsed.exit, 2);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.scanned[0].directory, join(pluginRoot, "skills"));
  } finally { clean([pluginRoot, fence, home]); }
});

test("FAFF-675: advisory fields pin the realistic plugin-machine shape — merge_fence true, bin_faff 'copy', live==0", () => {
  const pluginRoot = mkPluginRoot(["faff-graft", "faff-prep"]);
  const fence = mkFencedRoot();
  const home = mkPluginHomeWithRealBin();
  try {
    const r = doctorPlugin(pluginRoot, fence, home, "--json");
    assert.equal(r.code, 0, r.out + r.err);
    const json = JSON.parse(r.out);
    assert.equal(json.merge_fence, true);
    assert.equal(json.bin_faff, "copy", "a real-file ~/.local/bin/faff is the realistic plugin-machine shape, not symlink-live");
    assert.equal(json.scanned[0].live, 0, "the live formula subtracts expected — an all-expected scan has zero live");
    assert.equal(json.scanned[0].expected, 2);
  } finally { clean([pluginRoot, fence, home]); }
});

test("FAFF-675: a dangling symlink under the plugin root is classified normally, not swallowed by expectCopies (exit 1)", () => {
  const pluginRoot = mkPluginRoot(["faff-graft"]);
  execFileSync("ln", ["-s", join(pluginRoot, "skills", "gone-xyz"), join(pluginRoot, "skills", "faff-prep")]);
  const fence = mkFencedRoot();
  const home = mkdtempSync(join(tmpdir(), "ls-pr-home-"));
  try {
    const r = doctorPlugin(pluginRoot, fence, home);
    assert.equal(r.code, 1, "a genuine dangling symlink still drives a non-clean exit under the plugin root");
    assert.match(r.out, /✗ faff-prep {2}symlink-dangling \(target gone — stale orphan\)/);
    assert.match(r.out, /✓ faff-graft {2}plugin install/, "the copied sibling is still read as expected, not swept up by the dangling finding");
  } finally { clean([pluginRoot, fence, home]); }
});

test("FAFF-675: --target pointed at a plugin root still classifies copies as faults, naming the --target-audits reason", () => {
  const pluginRoot = mkPluginRoot(["faff-graft"]);
  const fence = mkFencedRoot();
  const home = mkdtempSync(join(tmpdir(), "ls-pr-home-"));
  try {
    const env = { ...process.env, HOME: home, CLAUDE_PLUGIN_ROOT: pluginRoot };
    const r = spawnSync("node", [CLI, "doctor", "--target", join(pluginRoot, "skills"), "--root", fence], { encoding: "utf8", env });
    assert.equal(r.status, 1, "an explicit --target audits as dev-linked even with a plugin root present — exit 1");
    assert.match(r.stdout, /✗ faff-graft {2}COPY — --target audits as a dev-linked install; omit --target to audit as a plugin install/);
    assert.match(r.stdout, /link-skills\.sh --global --replace/, "--target's COPY fault still offers the (here, runnable-for-the-operator) repair");
  } finally { clean([pluginRoot, fence, home]); }
});

test("FAFF-675: $CLAUDE_PLUGIN_ROOT set but its skills/ is absent → exit 2, not a false exit 0", () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "ls-pluginroot-nosk-"));
  // deliberately no `skills/` subdirectory under pluginRoot
  const fence = mkFencedRoot();
  const home = mkdtempSync(join(tmpdir(), "ls-pr-home-"));
  try {
    const r = doctorPlugin(pluginRoot, fence, home);
    assert.equal(r.code, 2, "a plugin harness with no skills dir is genuinely nothing-installed, not an expected install");
  } finally { clean([pluginRoot, fence, home]); }
});

test("FAFF-675: DoctorJson is a total projection of DoctorState — every axis is reflected", () => {
  const require = createRequire(import.meta.url);
  const { gatherDoctorState, buildDoctorJson } = require("../plugin/skills/faff/bin/lib/gates.js");
  const pluginRoot = mkPluginRoot(["faff-graft"]);
  const fence = mkFencedRoot();
  try {
    const scanSet = [join(pluginRoot, "skills")];
    const state = gatherDoctorState(scanSet, [], true, fence, false);
    const json = buildDoctorJson(state);

    assert.equal(json.plugin_root, state.pluginRoot);
    assert.equal(json.merge_fence, state.fenceOk);
    assert.equal(json.bin_faff, state.binFaff);
    assert.equal(json.exit, state.exit);
    assert.equal(json.ok, state.exit === 0);

    const s = state.scans[0];
    const j = json.scanned[0];
    assert.equal(j.directory, s.directory);
    assert.equal(j.readable, s.readable);
    assert.equal(j.reason, s.reason);
    assert.equal(j.copies, s.copies);
    assert.equal(j.dangling, s.dangling);
    assert.equal(j.into_worktree, s.intoWorktree);
    assert.equal(j.expected, s.expected);
    assert.deepEqual(j.missing_here, s.missingHere ?? []);
    assert.deepEqual(j.findings, s.findings);
    assert.deepEqual(j.names_found, [...s.namesFound].sort());

    // The meta-check this test exists for: every axis gatherDoctorState returns today is
    // accounted for above (either as a direct DoctorJson field or as a per-scan field checked
    // against `s`/`j`). A future axis added to DoctorState and not added HERE fails loudly,
    // rather than silently missing from --json.
    const accountedFor = new Set([
      "scanSet", "scans", "collapseNotices", "unionSize", "emptyUnion",
      "copies", "dangling", "intoWorktree", "expected",
      "binFaff", "fenceOk", "pluginRoot", "anyMissingHere", "exit",
    ]);
    for (const key of Object.keys(state)) {
      assert.ok(accountedFor.has(key), `DoctorState gained an axis ("${key}") not reflected in this completeness test / buildDoctorJson — extend both.`);
    }
  } finally { clean([pluginRoot, fence]); }
});

test("FAFF-675: the resolveDoctorScanSet return-site invariant throws on a synthetic multi-element expectCopies scan set", () => {
  const require = createRequire(import.meta.url);
  const { assertScanSetExpectCopiesInvariant } = require("../plugin/skills/faff/bin/lib/gates.js");
  assert.throws(
    () => assertScanSetExpectCopiesInvariant({ scanSet: ["/a", "/b"], collapseNotices: [], expectCopies: true }),
    /invariant violated/,
    "a multi-element scanSet with expectCopies:true must trip the guard rather than pass silently",
  );
  // The legitimate shapes must NOT throw: single-element + true, and any-length + false.
  assert.doesNotThrow(() => assertScanSetExpectCopiesInvariant({ scanSet: ["/a"], collapseNotices: [], expectCopies: true }));
  assert.doesNotThrow(() => assertScanSetExpectCopiesInvariant({ scanSet: ["/a", "/b"], collapseNotices: [], expectCopies: false }));
});
