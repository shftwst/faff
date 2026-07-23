// FAFF-433 — First-run DECLINE path leaves the repo at accept/decline parity.
//
// The gateway "First run" soft-offer's decline branch writes a stub .faffrc.yaml
// (so the offer doesn't re-fire) and then — mirroring /faff-onboard step 5 — runs
// `gitignore-ensure` + `hooks-ensure`. These tests drive that exact mechanical
// sequence against the REAL CLI on the filesystem and pin the invariant the prose
// promises: after a decline, `.faff/` is gitignored AND both `runcheck` /
// `prepcheck` Stop hooks are registered, `.faffrc.yaml` exists, and a re-run is a
// byte-stable no-op.
//
// Fidelity note: the decline prose runs the bare `"$faff" config …` /
// `"$faff" gitignore-ensure` / `"$faff" hooks-ensure` forms with NO `--root` flag —
// each resolves the repo root via findRoot() from cwd. So the tests seed a real
// `git init` repo (findRoot anchors on `.git`) and invoke every CLI with
// `cwd = root` and no `--root`, exercising the same cwd-based resolution the real
// decline path relies on — not a `--root` override the prose never names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// Run the real faff CLI with cwd = root and NO --root, so root resolves via
// findRoot(process.cwd()) exactly as the bare decline-branch invocations do.
function run(args, root, { allowFail = false } = {}) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8", cwd: root }) }; }
  catch (e) { if (!allowFail) throw e; return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() }; }
}

// Seed a real git repo so findRoot anchors on `.git` (the real decline cwd).
function seedGitRepo() {
  const root = mkdtempSync(join(tmpdir(), "decline-parity-"));
  const r = spawnSync("git", ["-C", root, "init", "-q"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr || r.status}`);
  return root;
}

function settingsPath(root) { return join(root, ".claude", "settings.json"); }
function readSettings(root) { return JSON.parse(readFileSync(settingsPath(root), "utf8")); }
function stopCmds(s) { return (s.hooks?.Stop ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command)); }

// The exact decline-branch mechanical sequence: stub write, then the two ensurers
// onboard step 5 runs — all bare (no --root), cwd-rooted at `root`.
function declineSequence(root) {
  run(["config", "init", "--set", "tracking.spec_docs_path="], root);
  run(["gitignore-ensure"], root);
  return JSON.parse(run(["hooks-ensure", "--json"], root).out);
}

test("decline sequence registers both runcheck and prepcheck Stop hooks (accept/decline parity)", () => {
  const root = seedGitRepo();
  try {
    const r = declineSequence(root);
    assert.equal(r.created, true);
    assert.ok(r.added.includes("runcheck") && r.added.includes("prepcheck"),
      "runcheck + prepcheck are freshly registered");
    const cmds = stopCmds(readSettings(root));
    assert.ok(cmds.some((c) => /runcheck --hook/.test(c)), "a Stop command invokes `runcheck --hook`");
    assert.ok(cmds.some((c) => /prepcheck --hook/.test(c)), "a Stop command invokes `prepcheck --hook`");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("decline sequence gitignores `.faff/*` + carves out `!.faff/anchors/` — the other half of the parity invariant", () => {
  const root = seedGitRepo();
  try {
    declineSequence(root);
    const gi = readFileSync(join(root, ".gitignore"), "utf8");
    // FAFF-568: `.faff/*` (contents glob, not `.faff/`) so git descends and the anchors
    // carve-out below can re-include the committed per-PR chain anchors.
    assert.match(gi, /^\.faff\/\*$/m, "`.faff/*` is listed in .gitignore");
    assert.match(gi, /^!\.faff\/anchors\/$/m, "`!.faff/anchors/` carve-out is listed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("decline sequence writes a stub .faffrc.yaml so `config path` exits 0 (offer will not re-fire)", () => {
  const root = seedGitRepo();
  try {
    declineSequence(root);
    assert.equal(existsSync(join(root, ".faffrc.yaml")), true, ".faffrc.yaml stub written");
    const p = run(["config", "path"], root, { allowFail: true });
    assert.equal(p.code, 0, "`faff config path` exits 0 → the first-run offer does not re-fire");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the ensurers are idempotent: a second run adds nothing and does not rewrite settings.json", () => {
  const root = seedGitRepo();
  try {
    declineSequence(root);
    const before = readFileSync(settingsPath(root));
    const mtimeBefore = statSync(settingsPath(root)).mtimeMs;
    // Re-run the ensurers (a re-decline, or an already-onboarded repo).
    run(["gitignore-ensure"], root);
    const r2 = JSON.parse(run(["hooks-ensure", "--json"], root).out);
    assert.deepEqual(r2.added, [], "second hooks-ensure adds nothing");
    assert.ok(r2.already.includes("runcheck") && r2.already.includes("prepcheck"),
      "both safety hooks reported already-present");
    // deepEqual on the bytes is the authoritative no-rewrite invariant; the mtime
    // check is additive belt-and-braces, mirroring test/hooks-ensure.test.mjs.
    assert.deepEqual(readFileSync(settingsPath(root)), before, "settings.json byte-identical");
    assert.equal(statSync(settingsPath(root)).mtimeMs, mtimeBefore, "settings.json not rewritten");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
