// FAFF-433 — First-run DECLINE path leaves the repo at accept/decline parity.
//
// The gateway "First run" soft-offer's decline branch writes a stub .faffrc.yaml
// (so the offer doesn't re-fire) and then — mirroring /faff-onboard step 5 — runs
// `gitignore-ensure` + `hooks-ensure`. These tests drive that exact mechanical
// sequence against the REAL CLI on the filesystem and pin the invariant the prose
// promises: after a decline, both `runcheck` and `prepcheck` Stop hooks are
// registered and `.faffrc.yaml` exists, and a re-run is a byte-stable no-op.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, { allowFail = false } = {}) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }) }; }
  catch (e) { if (!allowFail) throw e; return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() }; }
}
function mkroot() { return mkdtempSync(join(tmpdir(), "decline-parity-")); }
function settingsPath(root) { return join(root, ".claude", "settings.json"); }
function readSettings(root) { return JSON.parse(readFileSync(settingsPath(root), "utf8")); }
function stopCmds(s) { return (s.hooks?.Stop ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command)); }

// The exact decline-branch mechanical sequence, keyed to `root` via --root
// (the CLI's root override — the runtime resolves it via findRoot from cwd).
function declineSequence(root) {
  run(["config", "init", "--root", root, "--set", "tracking.spec_docs_path="]);
  run(["gitignore-ensure", "--root", root]);
  return JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
}

test("decline sequence registers both runcheck and prepcheck Stop hooks (accept/decline parity)", () => {
  const root = mkroot();
  try {
    const r = declineSequence(root);
    // hooks-ensure created the settings and added the safety hooks.
    assert.equal(r.created, true);
    assert.ok(r.added.includes("runcheck") && r.added.includes("prepcheck"),
      "runcheck + prepcheck are freshly registered");
    const cmds = stopCmds(readSettings(root));
    assert.ok(cmds.some((c) => /runcheck --hook/.test(c)), "a Stop command invokes `runcheck --hook`");
    assert.ok(cmds.some((c) => /prepcheck --hook/.test(c)), "a Stop command invokes `prepcheck --hook`");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("decline sequence writes a stub .faffrc.yaml so `config path` exits 0 (offer will not re-fire)", () => {
  const root = mkroot();
  try {
    declineSequence(root);
    assert.equal(existsSync(join(root, ".faffrc.yaml")), true, ".faffrc.yaml stub written");
    const p = run(["config", "path", "--root", root], { allowFail: true });
    assert.equal(p.code, 0, "`faff config path` exits 0 → the first-run offer does not re-fire");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the ensurers are idempotent: a second run adds nothing and does not rewrite settings.json", () => {
  const root = mkroot();
  try {
    declineSequence(root);
    const before = readFileSync(settingsPath(root));
    const mtimeBefore = statSync(settingsPath(root)).mtimeMs;
    // Re-run the ensurers (a re-decline, or an already-onboarded repo).
    run(["gitignore-ensure", "--root", root]);
    const r2 = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    assert.deepEqual(r2.added, [], "second hooks-ensure adds nothing");
    assert.ok(r2.already.includes("runcheck") && r2.already.includes("prepcheck"),
      "both safety hooks reported already-present");
    assert.deepEqual(readFileSync(settingsPath(root)), before, "settings.json byte-identical");
    assert.equal(statSync(settingsPath(root)).mtimeMs, mtimeBefore, "settings.json not rewritten");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
