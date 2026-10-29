// FAFF-1431 — the TS-first leg of `faff regions check`. A JavaScript module under bin/lib needs a
// `.ts` source or a legacy-js-modules.json entry; the allowlist only shrinks (a stale entry fails,
// and with --base an entry the base lacked fails); a `.ts` outside tsconfig.json `include` fails.
// Command cases drive the real CLI through the FAFF_EMIT_COVERAGE_TS_DIR fixture seam, which also
// supplies the fixture's own tsconfig.json and allowlist.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync, readFileSync, chmodSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regionsTsFirst, regionsJsModules, regionsValidateAllowlist } from "../plugin/skills/faff/bin/lib/regions.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const FAFF = path.join(REPO, "plugin", "skills", "faff", "bin", "faff");
const BIN_LIB = path.join(REPO, "plugin", "skills", "faff", "bin", "lib");

const tmp = (tag) => mkdtempSync(path.join(tmpdir(), `faff-ts-first-${tag}-`));
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

// A self-contained fixture dir: module files, its own tsconfig.json include, its own allowlist.
function fixture(dir, { files = {}, include = [], allowlist = [] } = {}) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  if (include !== null) writeFileSync(path.join(dir, "tsconfig.json"), json({ include }));
  if (allowlist !== null) writeFileSync(path.join(dir, "legacy-js-modules.json"), typeof allowlist === "string" ? allowlist : json(allowlist));
  return dir;
}

function check(dir, extra = [], opts = {}) {
  return spawnSync(process.execPath, [FAFF, "regions", "check", ...extra], {
    encoding: "utf8",
    cwd: opts.cwd || REPO,
    env: { ...process.env, FAFF_EMIT_COVERAGE_TS_DIR: dir },
  });
}

function withTmp(tag, fn) {
  const d = tmp(tag);
  try { return fn(d); } finally { rmSync(d, { recursive: true, force: true }); }
}

const NO_INPUT = { jsFiles: [], tsFiles: [], allowlist: [], include: [] };

// ---- pure: regionsTsFirst ------------------------------------------------------------------

test("pure: a JS file with no .ts and no allowlist entry is one violation", () => {
  const r = regionsTsFirst({ ...NO_INPUT, jsFiles: ["new-thing.js"] });
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0], /"new-thing\.js": new bin\/lib module has no TypeScript source/);
});

test("pure: the same file allowlisted is no violation", () => {
  assert.deepEqual(regionsTsFirst({ ...NO_INPUT, jsFiles: ["old.js"], allowlist: ["old.js"] }), { violations: [], malformed: [] });
});

test("pure: a JS file with a .ts sibling is no violation", () => {
  const r = regionsTsFirst({ ...NO_INPUT, jsFiles: ["x.js"], tsFiles: ["x.ts"], include: ["bin/lib/x.ts"] });
  assert.deepEqual(r, { violations: [], malformed: [] });
});

test("pure: an .mjs with no .ts and no entry is one violation (only .ts pairs with .js)", () => {
  const r = regionsTsFirst({ ...NO_INPUT, jsFiles: ["helper.mjs"], tsFiles: ["helper.ts"], include: ["bin/lib/helper.ts"] });
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0], /"helper\.mjs": new bin\/lib module/);
});

test("pure: an allowlist entry for a file that now has a .ts is stale", () => {
  const r = regionsTsFirst({ ...NO_INPUT, jsFiles: ["x.js"], tsFiles: ["x.ts"], include: ["bin/lib/x.ts"], allowlist: ["x.js"] });
  assert.deepEqual(r.violations, ['"x.js": allowlist entry is stale (remove it from legacy-js-modules.json)']);
});

test("pure: an allowlist entry for a missing file is stale", () => {
  const r = regionsTsFirst({ ...NO_INPUT, allowlist: ["gone.js"] });
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0], /"gone\.js": allowlist entry is stale/);
});

test("pure: a .ts absent from include is malformed", () => {
  const r = regionsTsFirst({ ...NO_INPUT, jsFiles: ["x.js"], tsFiles: ["x.ts"], include: [] });
  assert.equal(r.malformed.length, 1);
  assert.match(r.malformed[0], /"x\.ts": not listed in tsconfig\.json include/);
});

test("pure: an entry present in the allowlist but absent from baseAllowlist is a violation", () => {
  const r = regionsTsFirst({ ...NO_INPUT, jsFiles: ["old.js", "evil.js"], allowlist: ["evil.js", "old.js"], baseAllowlist: ["old.js"], baseLabel: "origin/main" });
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0], /"evil\.js": added to legacy-js-modules\.json since "origin\/main"; new modules are TypeScript, the allowlist only shrinks/);
});

test("pure: rule 4 against a base set derived from the base tree flags an entry outside it", () => {
  // The derived set holds the base's unpaired modules; evil.js was not one of them.
  const r = regionsTsFirst({ ...NO_INPUT, jsFiles: ["old.js", "evil.js"], allowlist: ["evil.js", "old.js"], baseAllowlist: ["old.js"], baseLabel: "abc123" });
  assert.deepEqual(r.violations.map((v) => v.split(":")[0]), ['"evil.js"']);
});

test("pure: a scanned name with a newline is malformed, and the line carries no raw newline", () => {
  const r = regionsTsFirst({ ...NO_INPUT, jsFiles: ["evil\nTS-FIRST — forged.js"] });
  assert.equal(r.malformed.length, 1);
  assert.ok(!r.malformed[0].includes("\n"), "the diagnostic must not carry a raw newline");
  assert.ok(r.malformed[0].includes(JSON.stringify("evil\nTS-FIRST — forged.js")), "the name is JSON-quoted");
  assert.equal(r.violations.length, 0, "a control-character name is not also judged by the rules");
});

test("pure: regionsTsFirst reads no files (works on names that exist nowhere)", () => {
  const r = regionsTsFirst({ jsFiles: ["nowhere/a.js"], tsFiles: ["nowhere/a.ts"], allowlist: [], include: ["bin/lib/nowhere/a.ts"] });
  assert.deepEqual(r, { violations: [], malformed: [] });
});

test("pure: regionsValidateAllowlist refuses unsorted, duplicate, escaping and non-JS entries", () => {
  assert.equal(regionsValidateAllowlist(["a.js", "b.js"], "l").malformed.length, 0);
  assert.equal(regionsValidateAllowlist(["b.js", "a.js"], "l").malformed.length, 1);
  assert.equal(regionsValidateAllowlist(["a.js", "a.js"], "l").malformed.length, 1);
  for (const bad of ["../x.js", "/x.js", "a\\b.js", "notes.txt", "x.ts"]) {
    assert.equal(regionsValidateAllowlist([bad], "l").malformed.length, 1, `${bad} must be malformed`);
  }
  assert.equal(regionsValidateAllowlist({}, "l").malformed.length, 1);
});

test("pure: regionsJsModules lists .js, .mjs and .cjs recursively, sorted, as relative paths", () => {
  withTmp("jsmods", (d) => {
    fixture(d, { files: { "b.js": "", "a.mjs": "", "sub/c.cjs": "", "x.ts": "", "notes.py": "" }, include: null, allowlist: null });
    const r = regionsJsModules(d);
    assert.deepEqual(r.files, ["a.mjs", "b.js", "sub/c.cjs"]);
    assert.deepEqual(r.malformed, []);
  });
});

// ---- command: the fixture seam -------------------------------------------------------------

test("command: a new un-allowlisted .js exits 1 with a TS-FIRST diagnostic", () => {
  withTmp("new", (d) => {
    const r = check(fixture(d, { files: { "new-thing.js": "" } }));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /TS-FIRST — "new-thing\.js": new bin\/lib module has no TypeScript source/);
  });
});

test("command: a .ts with a .js sibling but no include entry exits 2", () => {
  withTmp("noinc", (d) => {
    const r = check(fixture(d, { files: { "x.ts": "export {};\n", "x.js": "" }, include: [] }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /TS-FIRST — "x\.ts": not listed in tsconfig\.json include/);
  });
});

test("command: a missing allowlist file exits 2 naming the file", () => {
  withTmp("noallow", (d) => {
    const r = check(fixture(d, { files: { "a.js": "" }, allowlist: null }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /legacy-js-modules\.json.*missing or unreadable/);
  });
});

test("command: an unparseable allowlist exits 2 naming the file", () => {
  withTmp("badjson", (d) => {
    const r = check(fixture(d, { allowlist: "[ \"a.js\",\n" }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /legacy-js-modules\.json.*not valid JSON/);
  });
});

test("command: a new .cjs with no .ts and no entry exits 1", () => {
  withTmp("cjs", (d) => {
    const r = check(fixture(d, { files: { "helper.cjs": "" } }));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /TS-FIRST — "helper\.cjs": new bin\/lib module/);
  });
});

test("command: a fixture x.cts exits 2", () => {
  withTmp("cts", (d) => {
    const r = check(fixture(d, { files: { "x.cts": "export {};\n" } }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /"x\.cts": bin\/lib sources are \.ts/);
  });
});

test("command: a scanned file name holding a control character exits 2, JSON-quoted", () => {
  withTmp("ctrl", (d) => {
    fixture(d);
    const name = "evil\nTS-FIRST — forged.js";
    try { writeFileSync(path.join(d, name), ""); } catch { return; } // a filesystem that refuses the name has nothing to scan
    const r = check(d);
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.includes(JSON.stringify(name)), "the name is printed JSON-quoted");
    assert.equal(r.stderr.split("\n").filter((l) => l.startsWith("TS-FIRST — forged")).length, 0, "no forged line");
  });
});

test("command: an unsorted or duplicate allowlist exits 2", () => {
  for (const allowlist of [["b.js", "a.js"], ["a.js", "a.js"]]) {
    withTmp("order", (d) => {
      const r = check(fixture(d, { files: { "a.js": "", "b.js": "" }, allowlist }));
      assert.equal(r.status, 2, `${JSON.stringify(allowlist)}: ${r.stderr}`);
      assert.match(r.stderr, /legacy-js-modules\.json/);
    });
  }
});

test("command: an escaping or non-JS allowlist entry exits 2, not a rule-2 violation", () => {
  for (const entry of ["../x.js", "/x.js", "notes.txt"]) {
    withTmp("escape", (d) => {
      const r = check(fixture(d, { allowlist: [entry] }));
      assert.equal(r.status, 2, `${entry}: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /allowlist entry is stale/);
    });
  }
});

test("command: a new sub/evil.js in a subdirectory exits 1 naming sub/evil.js", () => {
  withTmp("sub", (d) => {
    const r = check(fixture(d, { files: { "sub/evil.js": "" } }));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /TS-FIRST — "sub\/evil\.js"/);
  });
});

test("command: a symlinked directory exits 2", () => {
  withTmp("link", (d) => {
    const target = tmp("link-target");
    try {
      writeFileSync(path.join(target, "hidden.js"), "");
      fixture(d);
      symlinkSync(target, path.join(d, "linked"));
      const r = check(d);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /TS-FIRST — "linked": symlinked directory/);
    } finally { rmSync(target, { recursive: true, force: true }); }
  });
});

test("command: a sub/x.ts with no sub/x.js exits 2 at the emit floor naming sub/x.ts", () => {
  withTmp("subemit", (d) => {
    const r = check(fixture(d, { files: { "sub/x.ts": "export {};\n" }, include: ["bin/lib/sub/x.ts"] }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /EMIT-MISSING — sub\/x\.ts/);
  });
});

test("command: a fixture x.mts exits 2", () => {
  withTmp("mts", (d) => {
    const r = check(fixture(d, { files: { "x.mts": "export {};\n" } }));
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /"x\.mts": bin\/lib sources are \.ts/);
  });
});

test("command: a seamed tsconfig listing bin/lib/probe.ts passes; without the entry it exits 2", () => {
  withTmp("probe", (d) => {
    fixture(d, { files: { "probe.ts": "export {};\n", "probe.js": "" }, include: ["bin/lib/probe.ts"] });
    assert.equal(check(d).status, 0, check(d).stderr);
    writeFileSync(path.join(d, "tsconfig.json"), json({ include: [] }));
    assert.equal(check(d).status, 2);
  });
});

test("command: a renamed allowlisted module fails as a stale entry plus a new module", () => {
  withTmp("rename", (d) => {
    const r = check(fixture(d, { files: { "new.js": "" }, allowlist: ["old.js"] }));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /"old\.js": allowlist entry is stale/);
    assert.match(r.stderr, /"new\.js": new bin\/lib module has no TypeScript source/);
  });
});

test("command: --base with a value holding $ or starting with - exits 2 before git runs", () => {
  withTmp("badbase", (d) => {
    fixture(d);
    for (const v of ["x$(id)", "-x"]) {
      const r = check(d, [`--base=${v}`]);
      assert.equal(r.status, 2, `${v}: ${r.stderr}`);
    }
    const r = check(d, ["--base", "x$(id)"]);
    assert.match(r.stderr, /--base "x\$\(id\)" is not a plain ref/);
  });
});

// ---- command: --base against a real git history ---------------------------------------------

function gitRepo(tag) {
  const root = realpathSync(tmp(tag));
  const g = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  g("config", "commit.gpgsign", "false");
  const lib = path.join(root, "lib");
  mkdirSync(lib);
  const commit = (msg) => { g("add", "-A"); g("commit", "-q", "--no-verify", "-m", msg); return g("rev-parse", "HEAD").trim(); };
  return { root, lib, g, commit };
}

test("command: --base whose base has no allowlist derives the base set from the base tree", () => {
  const { root, lib, commit } = gitRepo("derive");
  try {
    fixture(lib, { files: { "old.js": "" }, allowlist: null });
    const base = commit("base: old.js, no allowlist");
    fixture(lib, { files: { "evil.js": "" }, allowlist: ["evil.js", "old.js"] });
    commit("head: evil.js and its entry");
    const bad = check(lib, ["--base", base]);
    assert.equal(bad.status, 1, bad.stderr);
    assert.match(bad.stderr, /"evil\.js": added to legacy-js-modules\.json since/);
    rmSync(path.join(lib, "evil.js"));
    writeFileSync(path.join(lib, "legacy-js-modules.json"), json(["old.js"]));
    const ok = check(lib, ["--base", base]);
    assert.equal(ok.status, 0, ok.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("command: --base with a smaller base allowlist flags the added entry", () => {
  const { root, lib, commit } = gitRepo("smaller");
  try {
    fixture(lib, { files: { "old.js": "" }, allowlist: ["old.js"] });
    const base = commit("base");
    fixture(lib, { files: { "added.js": "" }, allowlist: ["added.js", "old.js"] });
    commit("head");
    const r = check(lib, ["--base", base]);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /"added\.js": added to legacy-js-modules\.json since/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("command: --base gives the same result from the repository root and from a subdirectory", () => {
  const { root, lib, commit } = gitRepo("cwd");
  try {
    fixture(lib, { files: { "old.js": "" }, allowlist: ["old.js"] });
    const base = commit("base");
    fixture(lib, { files: { "added.js": "" }, allowlist: ["added.js", "old.js"] });
    commit("head");
    mkdirSync(path.join(lib, "deep"));
    const fromRoot = check(lib, ["--base", base], { cwd: root });
    const fromSub = check(lib, ["--base", base], { cwd: path.join(lib, "deep") });
    assert.equal(fromRoot.status, 1);
    assert.equal(fromSub.status, fromRoot.status);
    assert.equal(fromSub.stderr, fromRoot.stderr);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("command: --base naming an unknown ref exits 2", () => {
  const { root, lib, commit } = gitRepo("unknown");
  try {
    fixture(lib, { files: { "old.js": "" }, allowlist: ["old.js"] });
    commit("base");
    const r = check(lib, ["--base", "no-such-ref"]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /does not name a commit/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- the real tree -----------------------------------------------------------------------------

test("command: the real tree passes regions check", () => {
  const r = spawnSync(process.execPath, [FAFF, "regions", "check"], { encoding: "utf8", cwd: REPO });
  assert.equal(r.status, 0, r.stderr);
});

test("real tree: legacy-js-modules.json equals the bin/lib JS modules with no .ts sibling", () => {
  const all = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(BIN_LIB, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r); else all.push(r);
    }
  };
  walk("");
  const ts = new Set(all.filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts")));
  const expected = all.filter((f) => /\.(?:js|mjs|cjs)$/.test(f) && !(f.endsWith(".js") && ts.has(f.slice(0, -3) + ".ts"))).sort();
  const actual = JSON.parse(readFileSync(path.join(REPO, "plugin", "skills", "faff", "legacy-js-modules.json"), "utf8"));
  assert.deepEqual(actual, expected);
});

// ---- validate.yml: the regions check step ------------------------------------------------------

// The step's lines, from its `- name:` line to the next step at the same indent.
function regionsStep() {
  const lines = readFileSync(path.join(REPO, ".github", "workflows", "validate.yml"), "utf8").split("\n");
  const start = lines.findIndex((l) => /^\s*- name: Enforce the region require-graph/.test(l));
  assert.ok(start >= 0, "the regions check step exists");
  const indent = lines[start].indexOf("-");
  let end = start + 1;
  while (end < lines.length && !(lines[end].trim() !== "" && lines[end].search(/\S/) <= indent)) end++;
  const step = lines.slice(start, end);
  const runAt = step.findIndex((l) => /^\s*run: \|\s*$/.test(l));
  assert.ok(runAt >= 0, "the step has a block-scalar run:");
  const keyIndent = step[runAt].search(/\S/);
  const body = [];
  for (const l of step.slice(runAt + 1)) {
    if (l.trim() !== "" && l.search(/\S/) <= keyIndent) break;
    body.push(l);
  }
  const strip = Math.min(...body.filter((l) => l.trim() !== "").map((l) => l.search(/\S/)));
  return { step, script: body.map((l) => l.slice(strip)).join("\n") };
}

test("workflow, static: the regions check step routes event values only through env:", () => {
  const { step, script } = regionsStep();
  const text = step.join("\n");
  assert.match(text, /EVENT: \$\{\{ github\.event_name \}\}/);
  assert.match(text, /BASE_REF: \$\{\{ github\.base_ref \}\}/);
  assert.match(text, /BEFORE: \$\{\{ github\.event\.before \}\}/);
  assert.ok(!script.includes("${{"), "no ${{ expression inside the run: script");
});

// Run the extracted script under bash with stub `git` and `node` first on PATH. The `node` stub
// records calls to bin/faff and passes every other call (the script's JSON quoting) to real node.
function runStep(env, { fetchFails = false } = {}) {
  const d = tmp("wf");
  try {
    const stubs = path.join(d, "stubs");
    mkdirSync(stubs);
    const log = path.join(d, "calls.log");
    writeFileSync(path.join(stubs, "git"), `#!/bin/sh\nprintf 'git %s\\n' "$*" >> "${log}"\nif [ "$1" = fetch ] && [ -n "$STUB_FETCH_FAIL" ]; then exit 1; fi\nexit 0\n`);
    writeFileSync(path.join(stubs, "node"), `#!/bin/sh\ncase "$1" in\n  */bin/faff) shift; printf 'faff %s\\n' "$*" >> "${log}"; exit 0 ;;\nesac\nexec "${process.execPath}" "$@"\n`);
    chmodSync(path.join(stubs, "git"), 0o755);
    chmodSync(path.join(stubs, "node"), 0o755);
    writeFileSync(path.join(d, "step.sh"), regionsStep().script);
    const r = spawnSync("bash", [path.join(d, "step.sh")], {
      encoding: "utf8",
      cwd: d,
      env: { PATH: `${stubs}:${process.env.PATH}`, EVENT: "", BASE_REF: "", BEFORE: "", ...env, ...(fetchFails ? { STUB_FETCH_FAIL: "1" } : {}) },
    });
    let calls = [];
    try { calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean); } catch { calls = []; }
    return { status: r.status, calls, stdout: r.stdout, stderr: r.stderr };
  } finally { rmSync(d, { recursive: true, force: true }); }
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("workflow, behavioural: pull_request fetches the base ref and checks against it", () => {
  const r = runStep({ EVENT: "pull_request", BASE_REF: "main" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, ["git fetch --depth=1 origin +refs/heads/main:refs/remotes/origin/main", "faff regions check --base origin/main"]);
});

test("workflow, behavioural: pull_request with a shell-shaped base_ref fails with no git or faff call", () => {
  const r = runStep({ EVENT: "pull_request", BASE_REF: "x$(id)" });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.calls, []);
});

test("workflow, behavioural: push with a 40-hex before checks against that commit", () => {
  const r = runStep({ EVENT: "push", BEFORE: SHA });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, [`git fetch --depth=1 origin ${SHA}`, `faff regions check --base ${SHA}`]);
});

test("workflow, behavioural: push whose before cannot be fetched fails with no faff call", () => {
  const r = runStep({ EVENT: "push", BEFORE: SHA }, { fetchFails: true });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.calls, [`git fetch --depth=1 origin ${SHA}`]);
  assert.match(r.stdout, /cannot fetch the push's before commit/);
});

test("workflow, behavioural: push with an all-zero before checks without --base", () => {
  const r = runStep({ EVENT: "push", BEFORE: "0".repeat(40) });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, ["faff regions check"]);
});

test("workflow, behavioural: push with a malformed before fails", () => {
  const r = runStep({ EVENT: "push", BEFORE: "abc" });
  assert.notEqual(r.status, 0);
  assert.deepEqual(r.calls, []);
  assert.match(r.stdout, /push event before "abc" is neither/);
});

test("workflow, behavioural: workflow_dispatch checks without --base", () => {
  const r = runStep({ EVENT: "workflow_dispatch" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, ["faff regions check"]);
});
