// FAFF-192 — `faff hooks-ensure`: idempotently register faff's Stop-hook command
// set into .claude/settings.json. Deterministic, non-destructive, byte-stable
// no-op when present, fail-loud on malformed JSON. The pure planner + identity +
// stale-bin logic are covered by `hooks-ensure --selftest`; these tests drive the
// real CLI against the filesystem (the I/O shell). The running faff bin serves
// all subcommands, so `skipped_stale` is exercised by the selftest, not here.
// FAFF-434 extended the same registrar to a SECOND event array — hooks.PreToolUse,
// carrying the merge-fence Bash-matcher hook — registered alongside the Stop set
// in the same call/write; every "creates from empty" / "idempotent" assertion
// below now expects merge-fence in the mix too.
// FAFF-471 extended the Stop set itself to a THIRD member — sentrycheck (ADR-0065's
// assist watchdog locus) — so every assertion enumerating the family below now
// expects `["runcheck", "prepcheck", "sentrycheck", "merge-fence"]` (Stop-set order,
// then the PreToolUse set), the combined `added`/`already` order cmdHooksEnsure emits.
// FAFF-491 extended the PreToolUse set to a SECOND member — background-fence (the
// self-backgrounded-gate fence) — so every assertion enumerating the family below now
// expects `["runcheck", "prepcheck", "sentrycheck", "merge-fence", "background-fence"]`.
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
function preToolUseCmds(s) { return (s.hooks?.PreToolUse ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command)); }

test("creates settings.json with all five faff Stop hooks + the PreToolUse merge-fence + background-fence when absent", () => {
  const root = mkroot();
  try {
    const r = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    assert.equal(r.created, true);
    assert.deepEqual(r.added, ["runcheck", "prepcheck", "inflightcheck", "sentrycheck", "turncheck", "Bash::merge-fence", "Bash::background-fence", "Monitor::background-fence"]);
    const s = readSettings(root);
    const cmds = stopCmds(s);
    assert.ok(cmds.some((c) => /faff runcheck --hook/.test(c)));
    assert.ok(cmds.some((c) => /faff prepcheck --hook/.test(c)));
    assert.ok(cmds.some((c) => /faff sentrycheck --hook/.test(c)));
    assert.ok(cmds.some((c) => /faff inflightcheck --hook/.test(c)));
    assert.ok(cmds.some((c) => /faff turncheck --hook/.test(c)));
    const preCmds = preToolUseCmds(s);
    assert.ok(preCmds.some((c) => /faff merge-fence --hook/.test(c)));
    assert.ok(preCmds.some((c) => /faff background-fence --hook/.test(c)));
    // FAFF-530: a Bash-matcher group (both fences) and a distinct Monitor-matcher group (background-fence only)
    const bashG = s.hooks.PreToolUse.find((g) => g.matcher === "Bash");
    const monitorG = s.hooks.PreToolUse.find((g) => g.matcher === "Monitor");
    assert.ok(bashG && bashG.hooks.some((h) => /faff merge-fence --hook/.test(h.command)) && bashG.hooks.some((h) => /faff background-fence --hook/.test(h.command)), "Bash group carries both fences");
    assert.ok(monitorG && monitorG.hooks.length === 1 && /faff background-fence --hook/.test(monitorG.hooks[0].command), "Monitor group carries only background-fence");
    assert.ok(!monitorG.hooks.some((h) => /faff merge-fence --hook/.test(h.command)), "merge-fence never joins the Monitor group");
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
    assert.deepEqual(r.already, ["runcheck", "prepcheck", "inflightcheck", "sentrycheck", "turncheck", "Bash::merge-fence", "Bash::background-fence", "Monitor::background-fence"]);
    assert.deepEqual(readFileSync(settingsPath(root)), before, "content unchanged");
    assert.equal(statSync(settingsPath(root)).mtimeMs, mtimeBefore, "not rewritten");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("adds the missing commands, normalizes a present-but-divergent path, preserves other settings + hooks (FAFF-200/434/471/491)", () => {
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
    assert.deepEqual(r.added, ["prepcheck", "inflightcheck", "sentrycheck", "turncheck", "Bash::merge-fence", "Bash::background-fence", "Monitor::background-fence"]);
    assert.deepEqual(r.already, ["runcheck"]);
    assert.deepEqual(r.normalized, ["runcheck"], "the divergent-path runcheck command is normalized to canonical");
    const s = readSettings(root);
    assert.deepEqual(s.permissions, { allow: ["Bash(git status:*)"] }, "unrelated settings preserved");
    // FAFF-530: both fences join the EXISTING Bash group; a NEW Monitor group is added → two groups total
    assert.equal(s.hooks.PreToolUse.length, 2, "existing Bash group + one new Monitor group");
    const bashG = s.hooks.PreToolUse.find((g) => g.matcher === "Bash");
    const monitorG = s.hooks.PreToolUse.find((g) => g.matcher === "Monitor");
    assert.deepEqual(bashG.hooks[0], { type: "command", command: "echo hi" }, "the pre-existing PreToolUse hook is preserved, not clobbered");
    assert.ok(bashG.hooks.some((c) => /faff merge-fence --hook/.test(c.command)), "merge-fence appended alongside it");
    assert.ok(bashG.hooks.some((c) => /faff background-fence --hook/.test(c.command)), "background-fence appended alongside it");
    assert.ok(monitorG.hooks.length === 1 && /faff background-fence --hook/.test(monitorG.hooks[0].command), "Monitor group carries only background-fence");
    const cmds = stopCmds(s);
    assert.ok(!cmds.includes("/some/path/faff runcheck --hook"), "divergent runcheck path rewritten, not left in place");
    assert.equal(cmds.filter((c) => /faff runcheck --hook/.test(c)).length, 1, "no duplicate runcheck");
    assert.ok(cmds.includes(`${r.bin} runcheck --hook`), "runcheck normalized to the resolved-bin canonical form");
    assert.ok(cmds.some((c) => /faff prepcheck --hook/.test(c)));
    assert.ok(cmds.some((c) => /faff sentrycheck --hook/.test(c)));
    assert.ok(cmds.some((c) => /faff inflightcheck --hook/.test(c)));
    assert.ok(cmds.some((c) => /faff turncheck --hook/.test(c)));
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
    // Re-run heals the drift, adds nothing (both fences already registered+canonical from `first`).
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

test("--dry-run reports a normalization (Stop) and an addition (inflightcheck + sentrycheck + PreToolUse fences) but writes nothing (FAFF-200/471/491)", () => {
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
    assert.deepEqual(r.added, ["inflightcheck", "sentrycheck", "turncheck", "Bash::merge-fence", "Bash::background-fence", "Monitor::background-fence"], "inflightcheck + sentrycheck + turncheck are wholly absent → fresh adds, not normalizes; no PreToolUse block yet → both fences in the Bash group + the Monitor group");
    assert.deepEqual(r.normalized, ["runcheck", "prepcheck"]);
    assert.deepEqual(readFileSync(settingsPath(root)), before, "dry-run wrote nothing");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("treats a command present only in settings.local.json as present (no settings.json write)", () => {
  const root = mkroot();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({
    hooks: {
      Stop: [{ hooks: [
        { type: "command", command: "faff runcheck --hook" },
        { type: "command", command: "faff prepcheck --hook" },
        { type: "command", command: "faff inflightcheck --hook" },
        { type: "command", command: "faff sentrycheck --hook" },
        { type: "command", command: "faff turncheck --hook" },
      ] }],
      PreToolUse: [
        { matcher: "Bash", hooks: [
          { type: "command", command: "faff merge-fence --hook" },
          { type: "command", command: "faff background-fence --hook" },
        ] },
        { matcher: "Monitor", hooks: [
          { type: "command", command: "faff background-fence --hook" },
        ] },
      ],
    },
  }, null, 2) + "\n");
  try {
    const r = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    assert.deepEqual(r.added, [], "all registrations present via local file → nothing to add (no double-registration)");
    assert.deepEqual(r.already, ["runcheck", "prepcheck", "inflightcheck", "sentrycheck", "turncheck", "Bash::merge-fence", "Bash::background-fence", "Monitor::background-fence"]);
    assert.equal(existsSync(settingsPath(root)), false, "settings.json not created when nothing to add");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--dry-run reports the plan but writes nothing", () => {
  const root = mkroot();
  try {
    const r = JSON.parse(run(["hooks-ensure", "--root", root, "--dry-run", "--json"]).out);
    assert.deepEqual(r.added, ["runcheck", "prepcheck", "inflightcheck", "sentrycheck", "turncheck", "Bash::merge-fence", "Bash::background-fence", "Monitor::background-fence"]);
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

// FAFF-434/491 — dedicated PreToolUse fence coverage mirroring the Stop-set tests above.
test("normalizes a divergent merge-fence path, adds the missing background-fence, preserves an unrelated PreToolUse group", () => {
  const root = mkroot();
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(settingsPath(root), JSON.stringify({
    hooks: {
      Stop: [{ hooks: [
        { type: "command", command: "faff runcheck --hook" },
        { type: "command", command: "faff prepcheck --hook" },
      ] }],
      PreToolUse: [
        { matcher: "Read", hooks: [{ type: "command", command: "echo unrelated" }] },
        { matcher: "Bash", hooks: [{ type: "command", command: "/divergent/path/faff merge-fence --hook" }] },
      ],
    },
  }, null, 2) + "\n");
  try {
    const r = JSON.parse(run(["hooks-ensure", "--root", root, "--json"]).out);
    // sentrycheck (Stop) and background-fence (PreToolUse: Bash + Monitor groups) are both wholly
    // absent from this fixture → fresh adds (not normalizes); only merge-fence is present-but-divergent.
    assert.deepEqual(r.added, ["inflightcheck", "sentrycheck", "turncheck", "Bash::background-fence", "Monitor::background-fence"]);
    // the fixture's Stop commands are the bare "faff <sub> --hook" form, which the resolved
    // (absolute-path) bin also normalizes — this test's focus is the PreToolUse behaviour,
    // asserted below via preCmds, so the full normalized set (merge-fence keyed by its Bash group) is expected.
    assert.deepEqual(r.normalized, ["runcheck", "prepcheck", "Bash::merge-fence"]);
    const s = readSettings(root);
    assert.deepEqual(s.hooks.PreToolUse[0], { matcher: "Read", hooks: [{ type: "command", command: "echo unrelated" }] }, "unrelated matcher group untouched");
    const preCmds = preToolUseCmds(s);
    assert.ok(!preCmds.includes("/divergent/path/faff merge-fence --hook"));
    assert.ok(preCmds.some((c) => /faff merge-fence --hook/.test(c) && c === `${r.bin} merge-fence --hook`));
    assert.ok(preCmds.some((c) => /faff background-fence --hook/.test(c) && c === `${r.bin} background-fence --hook`));
    // FAFF-530: the Monitor group was added carrying only background-fence
    const monitorG = s.hooks.PreToolUse.find((g) => g.matcher === "Monitor");
    assert.ok(monitorG && monitorG.hooks.length === 1 && /faff background-fence --hook/.test(monitorG.hooks[0].command), "Monitor group added with background-fence only");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
