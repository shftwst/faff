// FAFF-192 — `faff hooks-ensure`: idempotently register faff's Stop-hook command
// set into .claude/settings.json. Deterministic, non-destructive, byte-stable
// no-op when present, fail-loud on malformed JSON. The pure planner + identity +
// stale-bin logic are covered by `hooks-ensure --selftest`; these tests drive the
// real CLI against the filesystem (the I/O shell). The running faff bin serves
// both subcommands, so `skipped_stale` is exercised by the selftest, not here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, { allowFail = false } = {}) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8" }) }; }
  catch (e) { if (!allowFail) throw e; return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() }; }
}
function mkroot() { return mkdtempSync(join(tmpdir(), "hooks-ensure-")); }
function settingsPath(root) { return join(root, ".claude", "settings.json"); }
function readSettings(root) { return JSON.parse(readFileSync(settingsPath(root), "utf8")); }
function stopCmds(s) { return (s.hooks?.Stop ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command)); }

test("creates settings.json with both faff Stop hooks when absent", () => {
  const root = mkroot();
  try {
    const r = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    assert.equal(r.created, true);
    assert.deepEqual(r.added, ["runcheck", "prepcheck"]);
    const cmds = stopCmds(readSettings(root));
    assert.ok(cmds.some((c) => /faff runcheck --hook/.test(c)));
    assert.ok(cmds.some((c) => /faff prepcheck --hook/.test(c)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("idempotent: a second run adds nothing and does not rewrite the file (byte-identical)", () => {
  const root = mkroot();
  try {
    run(["hooks-ensure", "--root", root]);
    const before = readFileSync(settingsPath(root));
    const mtimeBefore = statSync(settingsPath(root)).mtimeMs;
    const r = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    assert.deepEqual(r.added, []);
    assert.deepEqual(r.already, ["runcheck", "prepcheck"]);
    assert.deepEqual(readFileSync(settingsPath(root)), before, "content unchanged");
    assert.equal(statSync(settingsPath(root)).mtimeMs, mtimeBefore, "not rewritten");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("adds the missing command, normalizes a present-but-divergent path, preserves other settings + hooks (FAFF-200)", () => {
  const root = mkroot();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(settingsPath(root), JSON.stringify({
    permissions: { allow: ["Bash(git status:*)"] },
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "/some/path/faff runcheck --hook" }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
    },
  }, null, 2) + "\n");
  try {
    const r = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    assert.deepEqual(r.added, ["prepcheck"]);
    assert.deepEqual(r.already, ["runcheck"]);
    assert.deepEqual(r.normalized, ["runcheck"], "the divergent-path runcheck command is normalized to canonical");
    const s = readSettings(root);
    assert.deepEqual(s.permissions, { allow: ["Bash(git status:*)"] }, "unrelated settings preserved");
    assert.deepEqual(s.hooks.PreToolUse, [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }], "other hook types preserved");
    const cmds = stopCmds(s);
    assert.ok(!cmds.includes("/some/path/faff runcheck --hook"), "divergent runcheck path rewritten, not left in place");
    assert.equal(cmds.filter((c) => /faff runcheck --hook/.test(c)).length, 1, "no duplicate runcheck");
    assert.ok(cmds.includes(`${r.bin} runcheck --hook`), "runcheck normalized to the resolved-bin canonical form");
    assert.ok(cmds.some((c) => /faff prepcheck --hook/.test(c)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("normalizes drift then no-ops: corrupt a canonical command's path, re-run normalizes it, third run is byte-stable (FAFF-200)", () => {
  const root = mkroot();
  try {
    const first = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    const bin = first.bin;
    // Simulate path drift on the prepcheck command (e.g. a hand-wired absolute-repo path).
    const s = readSettings(root);
    for (const g of s.hooks.Stop) for (const h of g.hooks) if (/prepcheck/.test(h.command)) h.command = "/divergent/repo/path/faff prepcheck --hook";
    writeFileSync(settingsPath(root), JSON.stringify(s, null, 2) + "\n");
    // Re-run heals the drift, adds nothing.
    const r2 = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    assert.deepEqual(r2.added, []);
    assert.deepEqual(r2.normalized, ["prepcheck"]);
    const cmds = stopCmds(readSettings(root));
    assert.ok(cmds.includes(`${bin} prepcheck --hook`), "prepcheck restored to canonical");
    assert.ok(!cmds.includes("/divergent/repo/path/faff prepcheck --hook"));
    // Third run: present + canonical → byte-stable no-op.
    const before = readFileSync(settingsPath(root));
    const r3 = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    assert.deepEqual(r3.normalized, []);
    assert.deepEqual(r3.added, []);
    assert.deepEqual(readFileSync(settingsPath(root)), before, "third run byte-identical");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--dry-run reports a normalization but writes nothing (FAFF-200)", () => {
  const root = mkroot();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(settingsPath(root), JSON.stringify({
    hooks: { Stop: [{ hooks: [
      { type: "command", command: "/x/faff runcheck --hook" },
      { type: "command", command: "/x/faff prepcheck --hook" },
    ] }] },
  }, null, 2) + "\n");
  const before = readFileSync(settingsPath(root));
  try {
    const r = JSON.parse(run(["hooks-ensure", "--root", root, "--dry-run", "--json"]).out);
    assert.deepEqual(r.added, []);
    assert.deepEqual(r.normalized, ["runcheck", "prepcheck"]);
    assert.deepEqual(readFileSync(settingsPath(root)), before, "dry-run wrote nothing");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("treats a command present only in settings.local.json as present (no settings.json write)", () => {
  const root = mkroot();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({
    hooks: { Stop: [{ hooks: [
      { type: "command", command: "faff runcheck --hook" },
      { type: "command", command: "faff prepcheck --hook" },
    ] }] },
  }, null, 2) + "\n");
  try {
    const r = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    assert.deepEqual(r.added, [], "both present via local file → nothing to add (no double-registration)");
    assert.deepEqual(r.already, ["runcheck", "prepcheck"]);
    assert.equal(existsSync(settingsPath(root)), false, "settings.json not created when nothing to add");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--dry-run reports the plan but writes nothing", () => {
  const root = mkroot();
  try {
    const r = JSON.parse(run(["hooks-ensure", "--root", root, "--dry-run", "--json"]).out);
    assert.deepEqual(r.added, ["runcheck", "prepcheck"]);
    assert.equal(r.created, false, "dry-run never reports a creation");
    assert.equal(existsSync(settingsPath(root)), false, "no file written on dry-run");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("malformed settings.json fails loud (exit 2) and writes nothing", () => {
  const root = mkroot();
  mkdirSync(join(root, ".claude"), { recursive: true });
  const bad = "{ not valid json";
  writeFileSync(settingsPath(root), bad);
  try {
    const r = run(["hooks-ensure", "--root", root], { allowFail: true });
    assert.equal(r.code, 2);
    assert.equal(readFileSync(settingsPath(root), "utf8"), bad, "malformed file left untouched");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("hooks-ensure --selftest passes", () => {
  const r = run(["hooks-ensure", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});
