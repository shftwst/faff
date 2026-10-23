// FAFF-1379 — scripts/link-skills.sh puts both CLI binaries, `faff` and the standalone
// `commissaire` (FAFF-999), on PATH as symlinks under ~/.local/bin, and `--unlink` removes them.
// This is the install and rollback evidence FAFF-827 found missing for `bin/commissaire`: link
// creates both, unlink removes both, and unlink never removes a same-named link it does not own.
// Runs the real script under a faked $HOME against a throwaway git checkout with stub binaries.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readlinkSync, lstatSync, existsSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const LINK_SH = join(REPO, "scripts", "link-skills.sh");
const CLIS = ["faff", "commissaire"];

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (prefix) => { const d = realpathSync(mkdtempSync(join(tmpdir(), prefix))); dirs.push(d); return d; };

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
}

// A main checkout with the real installer and stub `faff` and `commissaire` executables. Detached
// git maintenance is off so teardown never races a background writer (see FAFF-775).
function mkRepo() {
  const root = tmp("ls-cli-");
  git(root, "init", "-q", "-b", "main");
  for (const [k, v] of [["user.email", "t@t.t"], ["user.name", "t"], ["gc.auto", "0"], ["gc.autoDetach", "false"], ["maintenance.auto", "false"], ["core.fsmonitor", "false"]]) git(root, "config", k, v);
  mkdirSync(join(root, "scripts"), { recursive: true });
  cpSync(LINK_SH, join(root, "scripts", "link-skills.sh"));
  const bin = join(root, "plugin", "skills", "faff", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(root, "plugin", "skills", "faff", "SKILL.md"), "# faff\n");
  for (const c of CLIS) writeFileSync(join(bin, c), "#!/usr/bin/env node\n", { mode: 0o755 });
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return { root, bin };
}

function linkSh(root, home, ...args) {
  const r = spawnSync("bash", [join(root, "scripts", "link-skills.sh"), ...args], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

test("--global links both faff and commissaire into ~/.local/bin, pointing at the checkout's binaries", () => {
  const { root, bin } = mkRepo();
  const home = tmp("ls-cli-home-");
  const r = linkSh(root, home, "--global");
  assert.equal(r.code, 0, r.out);
  for (const c of CLIS) {
    const dst = join(home, ".local", "bin", c);
    assert.ok(isLink(dst), `${c} symlink missing:\n${r.out}`);
    assert.equal(readlinkSync(dst), join(bin, c));
  }
});

test("--global --unlink removes both CLI symlinks, the rollback for the commissaire binary", () => {
  const { root } = mkRepo();
  const home = tmp("ls-cli-home-");
  assert.equal(linkSh(root, home, "--global").code, 0);
  const r = linkSh(root, home, "--global", "--unlink");
  assert.equal(r.code, 0, r.out);
  for (const c of CLIS) assert.ok(!existsSync(join(home, ".local", "bin", c)) && !isLink(join(home, ".local", "bin", c)), `${c} survived --unlink:\n${r.out}`);
  assert.match(r.out, /commissaire \(CLI\)/);
});

test("--unlink leaves a commissaire symlink that points somewhere else in place", () => {
  const { root } = mkRepo();
  const home = tmp("ls-cli-home-");
  const other = tmp("ls-cli-other-");
  writeFileSync(join(other, "commissaire"), "#!/bin/sh\n", { mode: 0o755 });
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  symlinkSync(join(other, "commissaire"), join(home, ".local", "bin", "commissaire"));
  const r = linkSh(root, home, "--global", "--unlink");
  assert.equal(r.code, 0, r.out);
  assert.equal(readlinkSync(join(home, ".local", "bin", "commissaire")), join(other, "commissaire"));
});
