// FAFF-190 — `faff doctor` install-health: detects copy-installs (stale risk) vs symlinks (live).
// Reads the filesystem, so it works even from a stale installed bin. Tested against fixture targets.
// FAFF-434 added a SECOND, independent install-health axis — the merge-fence PreToolUse
// registration under <--root>/.claude/settings.json or settings.local.json (FAFF-1295: either
// file, both read) — folded into the same exit code. The
// skill-link tests below are about --target only, so each passes a pre-fenced --root (a
// temp dir, never the real repo's .claude/settings files) to hold that axis constant at
// "present" and keep their original exit-code assertions meaningful; the fence-specific
// behaviour (present/missing/malformed) gets its own tests further down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
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
  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "faff merge-fence --hook" }] }] },
  }, null, 2) + "\n");
  return root;
}

// A --root fixture with the merge-fence PreToolUse hook already registered (fence axis
// held at "present"), so the --target skill-link tests exercise ONLY that axis.
function mkFencedRoot() {
  const root = mkdtempSync(join(tmpdir(), "doc-fence-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({
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
  writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({
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

// ---- FAFF-1295: doctor reads faff's hooks from either settings file ----

const FENCE_CMD = { type: "command", command: "faff merge-fence --hook" };
const stopHook = (s) => ({ type: "command", command: `faff ${s} --hook` });
const fenceUnder = (matcher) => ({ hooks: { PreToolUse: [{ matcher, hooks: [FENCE_CMD] }] } });

// A --root with the given file contents (objects are JSON-encoded, strings written raw).
function mkSettingsRoot({ shared, personal }) {
  const root = mkdtempSync(join(tmpdir(), "doc-hs-"));
  mkdirSync(join(root, ".claude"), { recursive: true });
  const put = (name, v) => { if (v !== undefined) writeFileSync(join(root, ".claude", name), typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n"); };
  put("settings.json", shared);
  put("settings.local.json", personal);
  return root;
}

// Runs doctor --json against a fresh one-link skills dir and the given root.
function doctorJson(root, env = {}) {
  const skills = mkSkillsTarget();
  try {
    const r = runEnv(env, "doctor", "--target", skills, "--root", root, "--json");
    return { code: r.code, json: JSON.parse(r.out) };
  } finally { rmSync(skills, { recursive: true, force: true }); }
}
function doctorHuman(root, env = {}) {
  const skills = mkSkillsTarget();
  try { return runEnv(env, "doctor", "--target", skills, "--root", root); }
  finally { rmSync(skills, { recursive: true, force: true }); }
}
const withRoot = (files, fn) => {
  const root = mkSettingsRoot(files);
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
};

test("doctor: merge-fence only in settings.local.json (no settings.json) → exit 0, present, no advisory line", () => {
  withRoot({ personal: fenceUnder("Bash") }, (root) => {
    const r = doctorHuman(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /merge-fence PreToolUse fence present/);
    assert.doesNotMatch(r.out, /⚠ faff hooks/);
  });
});

test("doctor: merge-fence only in settings.json → still present", () => {
  withRoot({ shared: fenceUnder("Bash") }, (root) => {
    const r = doctorHuman(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /merge-fence PreToolUse fence present/);
  });
});

test("doctor: neither settings file → MISSING line and exit 1", () => {
  withRoot({}, (root) => {
    const r = doctorHuman(root);
    assert.equal(r.code, 1);
    assert.ok(r.out.includes("merge-fence PreToolUse fence MISSING — run: faff hooks-ensure"));
    const { json } = doctorJson(root);
    assert.equal(json.merge_fence_status, "missing");
    assert.equal(json.hook_settings.shared.state, "absent");
    assert.equal(json.hook_settings.personal.state, "absent");
  });
});

for (const [file, key] of [["settings.local.json", "personal"], ["settings.json", "shared"]]) {
  test(`doctor: invalid ${file} alone → exit 1, ✗ line naming it, unconfirmed fence, Fix omits hooks-ensure`, () => {
    withRoot({ [key]: "{ not valid json" }, (root) => {
      const r = doctorHuman(root);
      assert.equal(r.code, 1);
      assert.match(r.out, new RegExp(`✗ \\.claude/${file.replaceAll(".", "\\.")}  invalid \\(not valid JSON\\)`));
      assert.match(r.out, /merge-fence PreToolUse fence unconfirmed/);
      assert.match(r.out, /1 unreadable Claude settings file\(s\)/);
      const fix = r.out.split("\n").find((l) => l.startsWith("Fix:"));
      assert.ok(fix, "a Fix line is printed");
      assert.doesNotMatch(fix, /faff hooks-ensure/);
      assert.ok(fix.includes(`fix the JSON in .claude/${file}`));
    });
  });
}

test("doctor --json: an empty settings.json and one holding [] each report state invalid", () => {
  for (const content of ["", "[]"]) {
    withRoot({ shared: content }, (root) => {
      const { code, json } = doctorJson(root);
      assert.equal(code, 1, `content ${JSON.stringify(content)}`);
      assert.equal(json.hook_settings.shared.state, "invalid", `content ${JSON.stringify(content)}`);
      assert.equal(json.hook_settings.shared.error, content === "" ? "not valid JSON" : "top-level value is not a JSON object");
    });
  }
});

test("doctor: Bash::merge-fence in one file and the other invalid → status present, exit 1", () => {
  withRoot({ shared: fenceUnder("Bash"), personal: "{ nope" }, (root) => {
    const { code, json } = doctorJson(root);
    assert.equal(json.merge_fence_status, "present");
    assert.equal(json.merge_fence, true);
    assert.equal(code, 1);
    assert.equal(json.exit, 1);
    assert.equal(json.hook_settings.personal.state, "invalid");
  });
});

test("doctor: no settings fixture (valid, invalid, absent) yields a code other than 0, 1 or 2 or a stack trace", () => {
  const fixtures = [
    {}, { shared: "" }, { shared: "[]" }, { shared: "null" }, { shared: "42" }, { personal: "\"str\"" },
    { shared: { hooks: "nope" } }, { shared: { hooks: { Stop: {}, PreToolUse: [null, 3, { matcher: 7, hooks: "x" }] } } },
    { shared: "{ x", personal: "{ y" }, { shared: fenceUnder("Bash("), personal: { hooks: null } },
  ];
  for (const f of fixtures) {
    withRoot(f, (root) => {
      const skills = mkSkillsTarget();
      try {
        const r = spawnSync("node", [CLI, "doctor", "--target", skills, "--root", root], { encoding: "utf8" });
        assert.ok([0, 1, 2].includes(r.status), `exit ${r.status} for ${JSON.stringify(f)}`);
        assert.doesNotMatch(r.stderr, /\n\s+at /, `stack trace for ${JSON.stringify(f)}`);
      } finally { rmSync(skills, { recursive: true, force: true }); }
    });
  }
});

const SPLIT = {
  shared: { hooks: { Stop: [{ hooks: [stopHook("runcheck")] }], PreToolUse: [{ matcher: "Bash", hooks: [FENCE_CMD] }] } },
  personal: { hooks: { Stop: [{ hooks: [stopHook("runcheck")] }] } },
};

test("doctor: advisories active (stubbed personal default) → both ⚠ lines print, exit 0", () => {
  withRoot(SPLIT, (root) => {
    const require = createRequire(import.meta.url);
    const hooksEnsure = require("../plugin/skills/faff/bin/lib/hooks-ensure.js");
    const { gatherDoctorState, buildDoctorJson } = require("../plugin/skills/faff/bin/lib/gates.js");
    const skills = mkSkillsTarget();
    const real = hooksEnsure.HOOKS_DEFAULT_TARGET;
    const lines = [];
    const origLog = console.log;
    try {
      hooksEnsure.HOOKS_DEFAULT_TARGET = "personal";
      const state = gatherDoctorState([skills], [], false, root, false);
      assert.equal(state.hookAdvisoriesActive, true);
      assert.equal(state.exit, 0);
      assert.equal(buildDoctorJson(state).hook_advisories_active, true);
      assert.deepEqual(state.hookSettings.shared.faff_hooks, ["runcheck", "Bash::merge-fence"]);
      assert.deepEqual(state.hookSettings.in_both, ["runcheck"]);
      // Render through the real command, in-process, with the stub still in place.
      console.log = (l) => lines.push(l);
      const { cmdDoctor } = require("../plugin/skills/faff/bin/lib/gates.js");
      const code = cmdDoctor(["--target", skills, "--root", root]);
      assert.equal(code, 0);
    } finally {
      console.log = origLog;
      hooksEnsure.HOOKS_DEFAULT_TARGET = real;
      rmSync(skills, { recursive: true, force: true });
    }
    const out = lines.join("\n");
    assert.match(out, /⚠ faff hooks in \.claude\/settings\.json .*: runcheck, Bash::merge-fence; .*--shared/);
    assert.match(out, /⚠ faff hooks registered in both settings files: runcheck;/);
  });
});

test("doctor: advisories inactive with the shipped default (shared) → neither ⚠ line, exit 0, hook_advisories_active false", () => {
  withRoot(SPLIT, (root) => {
    assert.equal(createRequire(import.meta.url)("../plugin/skills/faff/bin/lib/hooks-ensure.js").HOOKS_DEFAULT_TARGET, "shared");
    const r = doctorHuman(root);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /⚠ faff hooks/);
    const { code, json } = doctorJson(root);
    assert.equal(code, 0);
    assert.equal(json.hook_advisories_active, false);
    assert.deepEqual(json.hook_settings.shared.faff_hooks, ["runcheck", "Bash::merge-fence"]);
    assert.deepEqual(json.hook_settings.in_both, ["runcheck"]);
    assert.equal(json.merge_fence_status, "present");
  });
});

test("doctor: faff hooks only in settings.local.json → no ⚠ line even with advisories stubbed on", () => {
  withRoot({ personal: SPLIT.shared }, (root) => {
    const require = createRequire(import.meta.url);
    const hooksEnsure = require("../plugin/skills/faff/bin/lib/hooks-ensure.js");
    const { gatherDoctorState } = require("../plugin/skills/faff/bin/lib/gates.js");
    const skills = mkSkillsTarget();
    const real = hooksEnsure.HOOKS_DEFAULT_TARGET;
    const origLog = console.log;
    const lines = [];
    try {
      hooksEnsure.HOOKS_DEFAULT_TARGET = "personal";
      const state = gatherDoctorState([skills], [], false, root, false);
      assert.deepEqual(state.hookSettings.shared.faff_hooks, []);
      assert.deepEqual(state.hookSettings.in_both, []);
      console.log = (l) => lines.push(l);
      require("../plugin/skills/faff/bin/lib/gates.js").cmdDoctor(["--target", skills, "--root", root]);
    } finally {
      console.log = origLog;
      hooksEnsure.HOOKS_DEFAULT_TARGET = real;
      rmSync(skills, { recursive: true, force: true });
    }
    assert.doesNotMatch(lines.join("\n"), /⚠ faff hooks/);
  });
  withRoot({ personal: SPLIT.shared }, (root) => {
    assert.doesNotMatch(doctorHuman(root).out, /⚠ faff hooks/);
  });
});

test("doctor: merge-fence only under matcher Monitor → missing", () => {
  withRoot({ personal: fenceUnder("Monitor") }, (root) => {
    const { code, json } = doctorJson(root);
    assert.equal(json.merge_fence_status, "missing");
    assert.equal(code, 1);
  });
});

test("doctor: merge-fence under Bash|Monitor, and separately .*, → present (same code path as Bash)", () => {
  for (const m of ["Bash|Monitor", ".*"]) {
    withRoot({ personal: fenceUnder(m) }, (root) => {
      const { code, json } = doctorJson(root);
      assert.equal(json.merge_fence_status, "present", m);
      assert.equal(code, 0, m);
    });
  }
  withRoot({ personal: fenceUnder("Bash") }, (root) => {
    assert.equal(doctorJson(root).json.merge_fence_status, "present");
  });
});

test("doctor: merge-fence under a matcher that is not a valid regex (Bash open paren) → missing, no throw", () => {
  withRoot({ personal: fenceUnder("Bash(") }, (root) => {
    const { code, json } = doctorJson(root);
    assert.equal(json.merge_fence_status, "missing");
    assert.equal(code, 1);
  });
});

test("doctor: truncated JSON holding a credential names 'not valid JSON' and never echoes the secret", () => {
  withRoot({ shared: '{"env":{"API_TOKEN":"sk-test-123"' }, (root) => {
    const human = doctorHuman(root);
    assert.match(human.out, /not valid JSON/);
    assert.doesNotMatch(human.out, /sk-test-123/);
    const skills = mkSkillsTarget();
    try {
      const r = runEnv({}, "doctor", "--target", skills, "--root", root, "--json");
      assert.doesNotMatch(r.out, /sk-test-123/);
      assert.equal(JSON.parse(r.out).hook_settings.shared.error, "not valid JSON");
    } finally { rmSync(skills, { recursive: true, force: true }); }
  });
});

test("doctor --json: the hook-settings fields are present in the empty-union (exit 2) run too", () => {
  withRoot({ personal: fenceUnder("Bash") }, (root) => {
    const emptySkills = mkdtempSync(join(tmpdir(), "doc-hs-empty-"));
    try {
      const r = runEnv({}, "doctor", "--target", emptySkills, "--root", root, "--json");
      assert.equal(r.code, 2);
      const json = JSON.parse(r.out);
      assert.equal(json.merge_fence_status, "present");
      assert.equal(json.merge_fence, true);
      assert.equal(json.hook_advisories_active, false);
      assert.deepEqual(json.hook_settings.personal.faff_hooks, ["Bash::merge-fence"]);
      assert.deepEqual(json.hook_settings.in_both, []);
    } finally { rmSync(emptySkills, { recursive: true, force: true }); }
  });
});

test("doctor: read-only — both settings files stay byte-identical with unchanged mtimes", () => {
  const mixed = { hooks: { Stop: [{ hooks: [stopHook("runcheck"), { type: "command", command: "echo hi" }] }], PreToolUse: [{ matcher: "Bash", hooks: [FENCE_CMD, { type: "command", command: "ls" }] }] }, env: { A: "b" } };
  withRoot({ shared: mixed, personal: mixed }, (root) => {
    const files = ["settings.json", "settings.local.json"].map((n) => join(root, ".claude", n));
    for (const f of files) utimesSync(f, EMIT_OLD, EMIT_OLD);
    const before = files.map((f) => [readFileSync(f, "utf8"), statSync(f).mtimeMs]);
    doctorHuman(root);
    doctorJson(root);
    const after = files.map((f) => [readFileSync(f, "utf8"), statSync(f).mtimeMs]);
    assert.deepEqual(after, before);
  });
});

test("doctor: integration smoke — personal fence, then a broken shared file", () => {
  withRoot({ personal: { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [FENCE_CMD] }] } } }, (root) => {
    const r = doctorJson(root);
    assert.equal(r.code, 0);
    assert.equal(r.json.merge_fence_status, "present");
    assert.deepEqual(r.json.hook_settings.personal.faff_hooks, ["Bash::merge-fence"]);
    assert.equal(r.json.hook_settings.shared.state, "absent");
    writeFileSync(join(root, ".claude", "settings.json"), "{ broken");
    const r2 = doctorJson(root);
    assert.equal(r2.code, 1);
    assert.equal(r2.json.hook_settings.shared.state, "invalid");
    assert.equal(r2.json.merge_fence_status, "present");
  });
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
