// FAFF-1463 — a failed `git rev-parse --git-common-dir` inside a repo is an error, never
// "no main checkout". probeMainWorktree throws MainWorktreeProbeError; the config and
// overlay lookups let it propagate; runGovernedDispatch maps it to exit 2; worktree ensure
// and worktree-root adopt it; every blanket-catch config reader passes it through.
//
// Probe failures are injected with a `git` wrapper first on PATH. It logs every argument
// list to $GIT_WRAP_LOG, misbehaves on `--git-common-dir` per $GIT_WRAP_MODE, and otherwise
// runs the real git. Per ADR 0002 — assert exit codes, stdout and stderr, never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIB = path.join(repoRoot, "plugin", "skills", "faff", "bin", "lib");
const shared = require(path.join(LIB, "shared-infra.js"));
const { MainWorktreeProbeError, probeMainWorktree, mainWorktreeRoot, runGovernedDispatch, hasEnclosingGitEntry } = shared;

const REAL_GIT = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
const GIT_ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const PROBE_LINE = "cannot proceed — git could not resolve the main checkout for";

function tmp(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

// A directory under the temp dir must have no `.git` above it for the not-a-repo cases.
function assertNoGitAbove(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    assert.equal(fs.existsSync(path.join(d, ".git")), false, `fixture precondition: no .git at ${d}`);
    if (path.dirname(d) === d) break;
  }
}

function git(dir, args, env = {}) {
  const r = spawnSync(REAL_GIT, ["-C", dir, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: os.tmpdir(), ...GIT_ID, ...env } });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function writeFile(p, body) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

const configBody = (v) => `tracking:\n  spec_docs_path: ${v}\n`;

// A repo whose main checkout optionally holds a config, plus an optional linked worktree.
function makeRepo({ config = "design/specs/", worktree = false } = {}) {
  const base = tmp("faff-1463-");
  const main = path.join(base, "main");
  fs.mkdirSync(main);
  git(main, ["init", "-q"]);
  git(main, ["commit", "-q", "--allow-empty", "-m", "init"]);
  if (config !== null) writeFile(path.join(main, ".faff", "config.yaml"), configBody(config));
  let wt = null;
  if (worktree) {
    wt = path.join(base, "wt");
    git(main, ["worktree", "add", "-q", wt]);
  }
  return { base, main, wt };
}

// The PATH git wrapper. Modes: fail (exit 128, "fatal: injected"), silent (exit 1, no
// output), empty (exit 0, no output), signal (SIGKILL itself), noisy (control characters
// and a 300-character line), pass (real git).
function makeWrapper() {
  const dir = tmp("faff-1463-bin-");
  const log = path.join(dir, "git.log");
  fs.writeFileSync(path.join(dir, "git"), `#!/bin/sh
printf '%s\\n' "$*" >> "$GIT_WRAP_LOG"
case " $* " in
  *" --git-common-dir "*)
    case "$GIT_WRAP_MODE" in
      fail) echo "fatal: injected" >&2; exit 128 ;;
      silent) exit 1 ;;
      empty) exit 0 ;;
      signal) kill -KILL $$ ;;
      noisy) printf 'fatal: \\033[31mred\\007 %0300d\\n' 0 >&2; exit 128 ;;
    esac ;;
esac
exec "${REAL_GIT}" "$@"
`, { mode: 0o755 });
  fs.writeFileSync(log, "");
  return { dir, log, calls: () => fs.readFileSync(log, "utf8") };
}

// A hermetic child env (no ambient GIT_* leaks), the wrapper first on PATH.
function envFor(w, mode = "fail", extra = {}) {
  return { HOME: tmp("faff-1463-home-"), PATH: `${w.dir}:${process.env.PATH}`, GIT_WRAP_LOG: w.log, GIT_WRAP_MODE: mode, FAFF_WORKTREE_ROOT: "", ...GIT_ID, ...extra };
}

// Run `fn` with the wrapper first on this process's PATH (probeMainWorktree spawns `git`).
function withWrapper(w, mode, fn) {
  const saved = { PATH: process.env.PATH, GIT_WRAP_LOG: process.env.GIT_WRAP_LOG, GIT_WRAP_MODE: process.env.GIT_WRAP_MODE };
  process.env.PATH = `${w.dir}:${saved.PATH}`;
  process.env.GIT_WRAP_LOG = w.log;
  process.env.GIT_WRAP_MODE = mode;
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function probeError(fn) {
  try { fn(); } catch (e) { return e; }
  return null;
}

// Run a snippet in a child node process (cwd + env), printing one JSON line.
function runNode(code, { cwd, env }) {
  const r = spawnSync(process.execPath, ["-e", code], { cwd, env, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

const config = (args, cwd, env) => runCli(["config", "get", ...args], { cwd, env });

// ---------------------------------------------------------------------------------------
// Section 5 scenarios, end to end through the real entrypoint.
// ---------------------------------------------------------------------------------------

test("linked worktree, config only in the main checkout, failing probe → exit 2 with the dispatch line, stdout empty", () => {
  const { wt } = makeRepo({ worktree: true });
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path"], wt, envFor(w));
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  const lines = r.stderr.split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1, r.stderr);
  assert.ok(lines[0].startsWith(`faff config: ${PROBE_LINE}`), lines[0]);
  assert.ok(lines[0].includes("fatal: injected"), lines[0]);
});

test("the same linked worktree with a healthy git still falls back to the main checkout's config", () => {
  const { wt } = makeRepo({ worktree: true });
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path"], wt, envFor(w, "pass"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "design/specs/");
});

test("main checkout with a config and no overlay, failing probe → exit 2 naming git's message", () => {
  const { main } = makeRepo();
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path"], main, envFor(w));
  assert.equal(r.code, 2);
  assert.ok(r.stderr.includes("fatal: injected"), r.stderr);
});

test("main checkout with a healthy git prints its own config value", () => {
  const { main } = makeRepo();
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path"], main, envFor(w, "pass"));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "design/specs/");
});

// config get prints the -d default and exits 3 for an unset non-registry key (FAFF-182);
// the point here is that the failed probe outside a repo reads as null, not exit 2.
test("not a repo (no .git anywhere, no .faff), failing probe → the -d default, never exit 2", () => {
  const dir = tmp("faff-1463-norepo-");
  assertNoGitAbove(dir);
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path", "-d", "fallback/"], dir, envFor(w));
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.stdout.trim(), "fallback/");
  assert.equal(r.stderr, "");
});

test("not a repo with GIT_DIR naming a path that does not exist → the -d default, never exit 2", () => {
  const dir = tmp("faff-1463-norepo-");
  assertNoGitAbove(dir);
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path", "-d", "fallback/"], dir, envFor(w, "fail", { GIT_DIR: path.join(dir, "no-such-gitdir") }));
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.stdout.trim(), "fallback/");
});

test("a .faff-only workspace (no git anywhere), failing probe → its own config, exit 0", () => {
  const dir = tmp("faff-1463-ws-");
  assertNoGitAbove(dir);
  writeFile(path.join(dir, ".faff", "config.yaml"), configBody("ws/specs/"));
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path"], dir, envFor(w));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "ws/specs/");
});

test("a linked worktree with its own config and overlay never runs the probe", () => {
  const { wt } = makeRepo({ worktree: true });
  writeFile(path.join(wt, ".faff", "config.yaml"), configBody("own/specs/"));
  writeFile(path.join(wt, ".faff", "config.local.yaml"), configBody("overlay/specs/"));
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path"], wt, envFor(w));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "overlay/specs/");
  assert.ok(!w.calls().includes("--git-common-dir"), w.calls());
});

test("a linked worktree whose own overlay does not set the key still never runs the probe", () => {
  const { wt } = makeRepo({ worktree: true });
  writeFile(path.join(wt, ".faff", "config.yaml"), configBody("own/specs/"));
  writeFile(path.join(wt, ".faff", "config.local.yaml"), "appetite: medium\n");
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path"], wt, envFor(w));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "own/specs/");
  assert.ok(!w.calls().includes("--git-common-dir"), w.calls());
});

test("a linked worktree with its own config but no overlay still probes for the overlay, and a failure is exit 2", () => {
  const { main, wt } = makeRepo({ worktree: true });
  writeFile(path.join(main, ".faff", "config.local.yaml"), configBody("design/specs/"));
  writeFile(path.join(wt, ".faff", "config.yaml"), configBody("own/specs/"));
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path"], wt, envFor(w));
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.stderr.includes(PROBE_LINE), r.stderr);
});

test("a healthy linked worktree falls back for the base and the overlay independently", () => {
  const { main, wt } = makeRepo({ worktree: true });
  writeFile(path.join(main, ".faff", "config.local.yaml"), "appetite: medium\n");
  writeFile(path.join(wt, ".faff", "config.yaml"), configBody("own/specs/"));
  const w = makeWrapper();
  const env = envFor(w, "pass");
  assert.equal(config(["tracking.spec_docs_path"], wt, env).stdout.trim(), "own/specs/");
  assert.equal(config(["appetite"], wt, env).stdout.trim(), "medium");
});

test("a symlinked working directory onto the main checkout, failing probe → exit 2", () => {
  const { base, main } = makeRepo();
  const link = path.join(tmp("faff-1463-link-"), "alias");
  fs.symlinkSync(main, link);
  const w = makeWrapper();
  assert.equal(config(["tracking.spec_docs_path"], link, envFor(w)).code, 2);
  assert.equal(config(["tracking.spec_docs_path", "--root", link], base, envFor(w)).code, 2);
});

// The given path's lexical ancestors miss the repo; only its realpath chain finds `.git`.
test("--root through a symlink into a repo subdirectory, failing probe → exit 2 (the realpath chain)", () => {
  const { main } = makeRepo();
  fs.mkdirSync(path.join(main, "pkg"));
  const outside = tmp("faff-1463-link-");
  assertNoGitAbove(outside);
  const link = path.join(outside, "alias");
  fs.symlinkSync(path.join(main, "pkg"), link);
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path", "--root", link], outside, envFor(w));
  assert.equal(r.code, 2, r.stdout + r.stderr);
});

test("a subdirectory with its own .faff below the repo's .git, failing probe → exit 2", () => {
  const { main } = makeRepo({ config: null });
  writeFile(path.join(main, "pkg", ".faff", "config.yaml"), configBody("pkg/specs/"));
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path"], path.join(main, "pkg"), envFor(w));
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.stderr.includes("fatal: injected"), r.stderr);
});

test("a repo whose git dir lives outside the work tree via GIT_DIR, failing probe → exit 2", () => {
  const { base, main } = makeRepo();
  const gitDir = path.join(base, "external.git");
  fs.renameSync(path.join(main, ".git"), gitDir);
  const w = makeWrapper();
  const r = config(["tracking.spec_docs_path"], main, envFor(w, "fail", { GIT_DIR: gitDir, GIT_WORK_TREE: main }));
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.stderr.includes("fatal: injected"), r.stderr);
});

test("faff worktree-root --json in a linked worktree, failing probe → exit 2 through the dispatch arm", () => {
  const { wt } = makeRepo({ worktree: true });
  const w = makeWrapper();
  const r = runCli(["worktree-root", "--json"], { cwd: wt, env: envFor(w) });
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.stderr.startsWith(`faff worktree-root: ${PROBE_LINE}`), r.stderr);
});

// With its own config and overlay the worktree's config lookup makes no git call, so the
// exit 2 can only come from worktree-root's own --root mapping probe.
test("faff worktree-root fails on its own root-mapping probe even when the config lookup needs no git", () => {
  const { wt } = makeRepo({ worktree: true });
  writeFile(path.join(wt, ".faff", "config.yaml"), configBody("own/specs/"));
  writeFile(path.join(wt, ".faff", "config.local.yaml"), "appetite: medium\n");
  const w = makeWrapper();
  const r = runCli(["worktree-root", "--json"], { cwd: wt, env: envFor(w) });
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.stderr.startsWith(`faff worktree-root: ${PROBE_LINE}`), r.stderr);
  assert.equal(w.calls().split("\n").filter((l) => l.includes("--git-common-dir")).length, 1, w.calls());
});

test("faff worktree-root with a healthy git still maps a linked worktree back to the main checkout", () => {
  const { main, wt } = makeRepo({ worktree: true });
  const w = makeWrapper();
  const env = envFor(w, "pass");
  const r = runCli(["worktree-root", "--json"], { cwd: wt, env });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).root, path.join(env.HOME, ".faff", "worktrees", path.basename(main)));
});

test("faff worktree ensure in a linked worktree, failing probe → exit 2 naming git's message, no worktree created", () => {
  const { main, wt } = makeRepo({ worktree: true });
  const w = makeWrapper();
  const env = envFor(w);
  const before = git(main, ["worktree", "list", "--porcelain"]);
  const r = runCli(["worktree", "ensure", "--issue", "FAFF-9", "--slug", "demo", "--mode", "interactive", "--json"], { cwd: wt, env });
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.stderr.startsWith("faff worktree ensure:"), r.stderr);
  assert.ok(r.stderr.includes("fatal: injected"), r.stderr);
  assert.equal(r.stdout, "");
  assert.equal(git(main, ["worktree", "list", "--porcelain"]), before);
  assert.equal(fs.existsSync(path.join(env.HOME, ".faff", "worktrees")), false);
});

// ---------------------------------------------------------------------------------------
// Section 3: the outcome table, the failure shapes and the detail.
// ---------------------------------------------------------------------------------------

test("probe success: a linked worktree maps to its main checkout; the main checkout maps to itself", () => {
  const { main, wt } = makeRepo({ worktree: true });
  assert.equal(probeMainWorktree(wt), main);
  assert.equal(probeMainWorktree(main), main);
});

test("mainWorktreeRoot returns the probe's value on success: the main checkout for a linked worktree and for itself", () => {
  const { main, wt } = makeRepo({ worktree: true });
  assert.equal(mainWorktreeRoot(wt), main);
  assert.equal(mainWorktreeRoot(main), main);
});

test("probe success on a bare repo (common dir not named .git) → null", () => {
  const bare = tmp("faff-1463-bare-");
  git(bare, ["init", "-q", "--bare"]);
  assert.equal(probeMainWorktree(bare), null);
  assert.equal(mainWorktreeRoot(bare), null);
});

test("probe failure with no enclosing git entry → null (not a repo)", () => {
  const dir = tmp("faff-1463-norepo-");
  assertNoGitAbove(dir);
  const w = makeWrapper();
  assert.equal(withWrapper(w, "fail", () => probeMainWorktree(dir)), null);
});

for (const [mode, want] of [
  ["fail", "fatal: injected"],
  ["silent", "exited 1 with no output"],
  ["empty", "exited 0 with no output"],
  ["signal", "killed by SIGKILL"],
]) {
  test(`probe failure (${mode}) inside a repo throws MainWorktreeProbeError with detail "${want}"`, () => {
    const { main } = makeRepo();
    const w = makeWrapper();
    const e = withWrapper(w, mode, () => probeError(() => probeMainWorktree(main)));
    assert.ok(e instanceof MainWorktreeProbeError, String(e));
    assert.equal(e.message, "git-probe-failed");
    assert.equal(e.root, main);
    assert.equal(e.detail, want);
    // The wrapper keeps the old contract: null on every failure.
    assert.equal(withWrapper(w, mode, () => mainWorktreeRoot(main)), null);
  });
}

test("probe failure where git cannot be spawned (no git on PATH) inside a repo throws with the spawn error", () => {
  const { main } = makeRepo();
  const saved = process.env.PATH;
  process.env.PATH = tmp("faff-1463-empty-path-");
  let e;
  try { e = probeError(() => probeMainWorktree(main)); } finally { process.env.PATH = saved; }
  assert.ok(e instanceof MainWorktreeProbeError, String(e));
  assert.match(e.detail, /ENOENT/);
});

test("the detail is stripped of control characters and capped at 200 characters", () => {
  const { main } = makeRepo();
  const w = makeWrapper();
  const e = withWrapper(w, "noisy", () => probeError(() => probeMainWorktree(main)));
  assert.ok(e instanceof MainWorktreeProbeError);
  assert.equal(e.detail.length, 200);
  assert.ok(e.detail.startsWith("fatal: [31mred 000"), e.detail);
  assert.doesNotMatch(e.detail, /[\u0000-\u001f\u007f-\u009f]/);
  const direct = new MainWorktreeProbeError("/r", "a\u0000b\u001bc\u009fd\n" + "x".repeat(300));
  assert.equal(direct.detail, "abcd" + "x".repeat(196));
});

// ---------------------------------------------------------------------------------------
// Section 4.3: the walk. Outside a repo the real git probe fails, so these exercise the walk.
// ---------------------------------------------------------------------------------------

function notFound() { const e = new Error("ENOENT"); e.code = "ENOENT"; return e; }

test("a filesystem error during the walk counts as an enclosing entry, so the probe throws", () => {
  const dir = tmp("faff-1463-norepo-");
  assertNoGitAbove(dir);
  assert.equal(probeMainWorktree(dir), null);
  const eacces = { lstatSync: () => { const e = new Error("EACCES"); e.code = "EACCES"; throw e; }, realpathSync: fs.realpathSync };
  assert.ok(probeError(() => probeMainWorktree(dir, { fs: eacces })) instanceof MainWorktreeProbeError);
  const badReal = { lstatSync: () => { throw notFound(); }, realpathSync: () => { throw new Error("ELOOP"); } };
  assert.ok(probeError(() => probeMainWorktree(dir, { fs: badReal })) instanceof MainWorktreeProbeError);
  const missing = { lstatSync: () => { throw notFound(); }, realpathSync: fs.realpathSync };
  assert.equal(probeMainWorktree(dir, { fs: missing }), null);
});

test("GIT_DIR counts only when it names an existing path, resolved against root when relative", () => {
  const dir = tmp("faff-1463-norepo-");
  assertNoGitAbove(dir);
  fs.mkdirSync(path.join(dir, "gd"));
  assert.ok(probeError(() => probeMainWorktree(dir, { env: { GIT_DIR: path.join(dir, "gd") } })) instanceof MainWorktreeProbeError);
  assert.ok(probeError(() => probeMainWorktree(dir, { env: { GIT_DIR: "gd" } })) instanceof MainWorktreeProbeError);
  assert.equal(probeMainWorktree(dir, { env: { GIT_DIR: path.join(dir, "absent") } }), null);
  assert.equal(probeMainWorktree(dir, { env: { GIT_DIR: "" } }), null);
  const statFault = { lstatSync: (p) => { if (p.endsWith("gd")) { const e = new Error("EACCES"); e.code = "EACCES"; throw e; } throw notFound(); }, realpathSync: fs.realpathSync };
  assert.equal(hasEnclosingGitEntry(dir, { GIT_DIR: "gd" }, statFault), true);
});

test("the walk tests .git only: a .faff entry never stops it or counts as a repo", () => {
  const dir = tmp("faff-1463-ws-");
  assertNoGitAbove(dir);
  fs.mkdirSync(path.join(dir, ".faff"));
  assert.equal(hasEnclosingGitEntry(dir, {}), false);
  const { main } = makeRepo({ config: null });
  fs.mkdirSync(path.join(main, "pkg", ".faff"), { recursive: true });
  assert.equal(hasEnclosingGitEntry(path.join(main, "pkg"), {}), true);
});

test("a .git file (a linked worktree's pointer) counts as an enclosing entry", () => {
  const { wt } = makeRepo({ worktree: true });
  assert.ok(fs.statSync(path.join(wt, ".git")).isFile());
  assert.equal(hasEnclosingGitEntry(wt, {}), true);
});

// ---------------------------------------------------------------------------------------
// The dispatch arm, shared with the commissaire binary.
// ---------------------------------------------------------------------------------------

test("runGovernedDispatch maps git-probe-failed to exit 2 with one stderr line, any label", () => {
  const written = [];
  const orig = process.stderr.write;
  process.stderr.write = (s) => { written.push(String(s)); return true; };
  let code;
  try { code = runGovernedDispatch("anything", () => { throw new MainWorktreeProbeError("/r", "boom"); }, []); } finally { process.stderr.write = orig; }
  assert.equal(code, 2);
  assert.deepEqual(written, [`faff anything: ${PROBE_LINE} /r: boom\n`]);
  assert.throws(() => runGovernedDispatch("x", () => { throw new Error("other"); }, []), /other/);
});

// ---------------------------------------------------------------------------------------
// Section 4.2a: blanket-catch config readers pass the probe error through and keep their
// fallback for every other error. Each runs in a child with the failing wrapper on PATH.
// ---------------------------------------------------------------------------------------

const READERS = [
  ["gates-config gatesFallbackPolicy", `require(L + "/gates-config.js").gatesFallbackPolicy(root)`, "fail-closed"],
  ["gates-config readGatesConfig", `require(L + "/gates-config.js").readGatesConfig(root).fallback`, "fail-closed"],
  ["state resolveSpec", `require(L + "/state.js").resolveSpec(root, "FAFF-1")`, ["none", null]],
  ["bundle resolveClaimTtlHours", `require(L + "/bundle.js").resolveClaimTtlHours(root, {})`, 6],
  ["gates-doctor readConfiguredInstallTargets", `require(L + "/gates-doctor.js").readConfiguredInstallTargets(root, "/h")`, []],
  ["post-merge postMergeCheckEnabled", `require(L + "/post-merge.js").postMergeCheckEnabled(root)`, true],
  ["merge-gate-gh readRunnerGhConfig", `require(L + "/merge-gate-gh.js").readRunnerGhConfig().configFault`, true],
  ["config-write resolveOtherConfigPath", `require(L + "/config-write.js").resolveOtherConfigPath(root, false)`, null],
];

function callReader(expr, root, env) {
  const code = `const L = ${JSON.stringify(LIB)}; const root = ${JSON.stringify(root)};
let out; try { out = { value: ${expr} }; } catch (e) { out = { threw: e.message, name: e.name }; }
process.stdout.write(JSON.stringify(out));`;
  const r = runNode(code, { cwd: root, env });
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

for (const [name, expr, fallback] of READERS) {
  test(`${name} rethrows MainWorktreeProbeError instead of falling back to defaults`, () => {
    const { main } = makeRepo();
    const w = makeWrapper();
    const out = callReader(expr, main, envFor(w));
    assert.deepEqual(out, { threw: "git-probe-failed", name: "MainWorktreeProbeError" });
  });

  test(`${name} keeps its fallback for any other config error`, () => {
    const { main } = makeRepo();
    fs.writeFileSync(path.join(main, ".faff", "config.yaml"), "- not\n- a map\n");
    const w = makeWrapper();
    const out = callReader(expr, main, envFor(w, "pass"));
    assert.deepEqual(out, { value: fallback });
  });
}

test("a gate reader reached through runGovernedDispatch exits 2 with the dispatch line, not the default policy", () => {
  const { main } = makeRepo();
  fs.writeFileSync(path.join(main, ".faff", "config.yaml"), "gates:\n  fallback: advisory\n");
  const w = makeWrapper();
  const code = `const L = ${JSON.stringify(LIB)};
const { runGovernedDispatch } = require(L + "/shared-infra.js");
const { gatesFallbackPolicy } = require(L + "/gates-config.js");
process.exitCode = runGovernedDispatch("gates", () => { console.log(gatesFallbackPolicy(process.cwd())); return 0; }, []);`;
  const healthy = runNode(code, { cwd: main, env: envFor(w, "pass") });
  assert.equal(healthy.code, 0, healthy.stderr);
  assert.equal(healthy.stdout, "advisory");
  const r = runNode(code, { cwd: main, env: envFor(w) });
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.startsWith(`faff gates: ${PROBE_LINE}`), r.stderr);
});

// ---------------------------------------------------------------------------------------
// Section 4.2: the callers that keep the null-on-failure wrapper.
// ---------------------------------------------------------------------------------------

test("admissibility, evidence, gates-doctor and resolveRunDir still call mainWorktreeRoot", () => {
  const src = (f) => fs.readFileSync(path.join(LIB, f), "utf8");
  assert.match(src("admissibility.js"), /=\s*mainWorktreeRoot\(root\)/);
  assert.match(src("evidence.js"), /=\s*mainWorktreeRoot\(root\)/);
  assert.match(src("gates-doctor.js"), /=\s*mainWorktreeRoot\(dir\)/);
  const si = src("shared-infra.js");
  const rrd = si.slice(si.indexOf("function resolveRunDir("), si.indexOf("function findLocationWithMainFallback("));
  assert.match(rrd, /mainWorktreeRoot\(root\)/);
  assert.doesNotMatch(rrd, /probeMainWorktree/);
});

test("resolveRunDir keeps reading a failed probe as no main checkout", () => {
  const { wt } = makeRepo({ worktree: true });
  const w = makeWrapper();
  const got = withWrapper(w, "fail", () => shared.resolveRunDir(wt, "run-x", false));
  assert.equal(got, path.join(wt, ".faff", "runs", "run-x"));
});

// ---------------------------------------------------------------------------------------
// Every command path reaches the dispatch arm: async handlers, and commands whose own catch
// used to turn the probe error into a bare token.
// ---------------------------------------------------------------------------------------

test("runGovernedDispatch maps an async handler's git-probe-failed rejection to exit 2 with the same line", async () => {
  const written = [];
  const orig = process.stderr.write;
  process.stderr.write = (s) => { written.push(String(s)); return true; };
  let code;
  try { code = await runGovernedDispatch("gates", async () => { throw new MainWorktreeProbeError("/r", "boom"); }, []); } finally { process.stderr.write = orig; }
  assert.equal(code, 2);
  assert.deepEqual(written, [`faff gates: ${PROBE_LINE} /r: boom\n`]);
  assert.equal(await runGovernedDispatch("gates", async () => 7, []), 7);
  await assert.rejects(runGovernedDispatch("gates", async () => { throw new Error("other"); }, []), /other/);
});

function assertArmLine(r, label) {
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.startsWith(`faff ${label}: ${PROBE_LINE}`), r.stderr);
  assert.ok(r.stderr.includes("fatal: injected"), r.stderr);
  assert.doesNotMatch(r.stderr, /unhandled error/);
}

test("faff gates discover and gates run exit 2 with the dispatch line in a main checkout, a linked worktree and with --root", () => {
  const { base, main, wt } = makeRepo({ worktree: true });
  const w = makeWrapper();
  assertArmLine(runCli(["gates", "discover"], { cwd: main, env: envFor(w) }), "gates");
  assertArmLine(runCli(["gates", "run", "--json"], { cwd: main, env: envFor(w) }), "gates");
  assertArmLine(runCli(["gates", "discover"], { cwd: wt, env: envFor(w) }), "gates");
  assertArmLine(runCli(["gates", "discover", "--root", main], { cwd: base, env: envFor(w) }), "gates");
});

test("scenario 6: gates run --json with gates.fallback set exits 2, one dispatch line on stderr, stdout empty", () => {
  const { main } = makeRepo();
  fs.writeFileSync(path.join(main, ".faff", "config.yaml"), "gates:\n  fallback: advisory\n");
  const w = makeWrapper();
  const r = runCli(["gates", "run", "--json"], { cwd: main, env: envFor(w) });
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(r.stdout, "");
  assert.deepEqual(r.stderr.split("\n").filter((l) => l !== ""), [`faff gates: ${PROBE_LINE} ${main}: fatal: injected`]);
});

test("faff config check exits 2 with the dispatch line naming git's message", () => {
  const { main } = makeRepo();
  const w = makeWrapper();
  assertArmLine(runCli(["config", "check"], { cwd: main, env: envFor(w) }), "config");
});

// With no config in the checkout the base lookup itself probes, so this reaches the base catch.
test("faff config check with no config in the checkout exits 2 with the dispatch line from the base lookup", () => {
  const { main } = makeRepo({ config: null });
  const w = makeWrapper();
  assertArmLine(runCli(["config", "check"], { cwd: main, env: envFor(w) }), "config");
});

test("faff spec-review round exits 2 with the dispatch line naming git's message", () => {
  const { main } = makeRepo({ config: null });
  fs.writeFileSync(path.join(main, "v.json"), "{}");
  const w = makeWrapper();
  const r = runCli(["spec-review", "round", "--verdict-file", "v.json", "--issue", "FAFF-1", "--dir", "sr", "--mode", "interactive", "--occupant", "single-pass"], { cwd: main, env: envFor(w) });
  assertArmLine(r, "spec-review");
});

test("faff spec-review hold exits 2 with the dispatch line when its configured limit read fails", () => {
  const { main } = makeRepo({ config: null });
  const w = makeWrapper();
  const r = runCli(["spec-review", "hold", "--cause", "turn-budget", "--issue", "FAFF-1", "--mode", "autonomous"], { cwd: main, env: envFor(w) });
  assertArmLine(r, "spec-review");
});

test("spec-review-round's config readers pass the probe error through instead of a bare RoundFault", () => {
  const { main } = makeRepo();
  const w = makeWrapper();
  const out = callReader(`require(L + "/spec-review-round.js").configValue(root, "appetite")`, main, envFor(w));
  assert.deepEqual(out, { threw: "git-probe-failed", name: "MainWorktreeProbeError" });
});

test("faff holdout record exits 2 with the dispatch line when its config lookup's probe fails", () => {
  const { main } = makeRepo({ config: null });
  fs.writeFileSync(path.join(main, "spec.md"), "# s\n\n## 5. SCENARIOS\n\n```\nGiven a\nWhen b\nThen c\n```\n");
  const block = { aggregate: "meets-spec", code_blind: true, violations: [], criteria: [{ id: "scenarios:1", text: "criterion", holdout: false, class: "scenario", verdict: "met", evidence_present: true, exercised: "x", expected: "y", observed: "y", evidence_ref: null, reason: null }] };
  const w = makeWrapper();
  const r = runCli(["holdout", "record", "--issue", "FAFF-1", "--spec", "spec.md"], { cwd: main, env: envFor(w), input: JSON.stringify(block) });
  assertArmLine(r, "holdout");
  assert.equal(fs.existsSync(path.join(main, ".faff", "holdout")), false);
});

test("faff config unset with a failing probe exits 2 and leaves the config byte-identical", () => {
  const { main } = makeRepo();
  const cfg = path.join(main, ".faff", "config.yaml");
  const before = fs.readFileSync(cfg);
  const w = makeWrapper();
  const r = runCli(["config", "unset", "tracking.spec_docs_path"], { cwd: main, env: envFor(w) });
  assertArmLine(r, "config");
  assert.doesNotMatch(r.stdout, /removed/);
  assert.ok(fs.readFileSync(cfg).equals(before));
  const healthy = runCli(["config", "unset", "tracking.spec_docs_path"], { cwd: main, env: envFor(w, "pass") });
  assert.equal(healthy.code, 0, healthy.stderr);
  assert.match(healthy.stdout, /removed tracking\.spec_docs_path/);
});
