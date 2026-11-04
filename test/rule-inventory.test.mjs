// FAFF-1428 — `faff rule-inventory check`: every block of skill prose a branch deletes must be moved
// verbatim into other skill prose or quoted by a `## Rule inventory` row in a spec the branch adds.
// Each case builds a fixture git repo with a local bare origin, commits skill prose to main, edits it
// on a branch and runs the real CLI with `--base origin/main`. A mutation case at the end copies the
// emitted module, breaks one rule at a time and shows a case here then fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const LIB = join(REPO, "plugin", "skills", "faff", "bin", "lib");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const require = createRequire(import.meta.url);
const ri = require("../plugin/skills/faff/bin/lib/rule-inventory.js");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
};

function sh(cwd, ...args) {
  const r = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

const GRAFT = `# Graft

## Step one

The first paragraph states that the build always fails closed on an unreadable ledger file.

- Push the branch before review so a stall never costs a rebuild.
- Tick the heartbeat before and after the gate ladder runs.
- Fails loud.
- When the probe is indeterminate it says - Fails loud. and never counts as a pass.

---

| Token | Action |
|---|---|
| ready | continue to the next step without asking |
| park | write the park comment and stop the build |
| hold | release the claim and requeue the issue |

### Example

An example paragraph that only illustrates the flow for a reader of this file.

## Step two

\`\`\`bash
faff gates run --json
\`\`\`
`;

const PREP = `# Prep

- Stage the spec before rendering it into the conversation, every time.
- Confirm the attach with the returned comment id after posting.
`;

const KERNEL = `# Kernel

A long paragraph about the shared rules that every faff skill applies
when it loads, written across several lines so that it can be reflowed
without changing a single word of it.
`;

// A fixture: bare origin + work clone on branch `feat`, main holding the base skill prose.
function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-ri-"));
  const origin = join(root, "origin.git");
  const dir = join(root, "work");
  sh(root, "init", "-q", "--bare", "-b", "main", origin);
  sh(root, "init", "-q", "-b", "main", dir);
  sh(dir, "remote", "add", "origin", origin);
  const base = {
    ".faff/config.yaml": "tracking:\n    spec_docs_path: records/specs/\n",
    "plugin/skills/faff-graft/SKILL.md": GRAFT,
    "plugin/skills/faff-prep/SKILL.md": PREP,
    "plugin/skills/faff/references/kernel.md": KERNEL,
    "test/x.test.mjs": 'test("x behaves", () => {});\n',
    ...files,
  };
  const fx = {
    root, dir,
    write(p, content) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), content); return fx; },
    read(p) { return readFileSync(join(dir, p), "utf8"); },
    edit(p, from, to) { const s = fx.read(p); assert.ok(s.includes(from), `fixture edit: ${from}`); return fx.write(p, s.replace(from, to)); },
    rm(p) { rmSync(join(dir, p)); return fx; },
    commit(msg = "change") { sh(dir, "add", "-A"); sh(dir, "commit", "-q", "--allow-empty", "-m", msg); return fx; },
    run(args, opts = {}) { return spawnSync(process.execPath, [CLI, "rule-inventory", "check", ...args], { cwd: dir, encoding: "utf8", ...opts }); },
    json(extra = []) {
      const r = fx.run(["--base", "origin/main", "--json", ...extra]);
      return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
  for (const [p, c] of Object.entries(base)) fx.write(p, c);
  fx.commit("base");
  sh(dir, "push", "-q", "origin", "main");
  sh(dir, "fetch", "-q", "origin");
  sh(dir, "checkout", "-q", "-b", "feat");
  return fx;
}

const SPEC = "records/specs/2026-11-04-FAFF-9-x-design.md";
const spec = (rows, { header = "| Prose rule | Covering test | Disposition |", section = true } = {}) =>
  `# FAFF-9\n\nIntro.\n\n${section ? "## Rule inventory\n\n" : ""}${header}\n|---|---|---|\n${rows.join("\n")}\n\n## Done\n`;
const row = (anchor, test, disp) => `| \`${anchor}\` | ${test} | ${disp} |`;

const BULLET1 = "- Push the branch before review so a stall never costs a rebuild.";
const BULLET2 = "- Tick the heartbeat before and after the gate ladder runs.";
const PARA = "The first paragraph states that the build always fails closed on an unreadable ledger file.";

test("a deleted paragraph with a committed spec and no inventory section fails, naming the file and the missing section", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${PARA}\n\n`, "").write(SPEC, "# FAFF-9\n\nNo inventory.\n").commit();
    const { status, out } = fx.json();
    assert.equal(status, 1);
    assert.equal(out.result, "fail");
    assert.equal(out.uncovered.length, 1);
    assert.equal(out.uncovered[0].file, "plugin/skills/faff-graft/SKILL.md");
    assert.equal(out.uncovered[0].base_line, 5);
    assert.deepEqual(out.row_errors, [{ spec: SPEC, line: 1, reason: "no ## Rule inventory section" }]);
    for (const k of ["result", "skipped_reason", "footprint_without_spec", "base", "specs", "blocks_deleted", "covered_moved", "covered_by_row", "row_covered", "uncovered", "row_errors", "warnings"]) assert.ok(k in out, k);
    const text = fx.run(["--base", "origin/main"]);
    assert.match(text.stdout, /^rule-inventory: uncovered plugin\/skills\/faff-graft\/SKILL\.md:5: .*docs\/reference\/skill-authoring\.md#rule-inventory/m);
  } finally { fx.cleanup(); }
});

test("two deleted bullets each quoted by a kept row naming an existing test pass", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-prep/SKILL.md", "- Stage the spec before rendering it into the conversation, every time.\n", "")
      .edit("plugin/skills/faff-prep/SKILL.md", "- Confirm the attach with the returned comment id after posting.\n", "")
      .write(SPEC, spec([row("Stage the spec before rendering it", "test/x.test.mjs", "kept"), row("Confirm the attach with the returned", "test/x.test.mjs: \"x behaves\"", "kept")]))
      .commit();
    const { status, out } = fx.json();
    assert.equal(status, 0, JSON.stringify(out));
    assert.equal(out.covered_by_row, 2);
    assert.deepEqual(out.uncovered, []);
    assert.deepEqual(out.row_errors, []);
  } finally { fx.cleanup(); }
});

test("deleted prose with no spec committed is skipped with no-spec-committed and the fixed notice", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${PARA}\n\n`, "").commit();
    const { status, out } = fx.json();
    assert.equal(status, 0);
    assert.equal(out.result, "skipped");
    assert.equal(out.skipped_reason, "no-spec-committed");
    const text = fx.run(["--base", "origin/main"]);
    assert.equal(text.status, 0);
    assert.equal(text.stdout.split("\n")[0], "::notice::rule-inventory: skipped, no spec committed");
  } finally { fx.cleanup(); }
});

test("an added or modified .faff/anchors/ path with deleted prose and no spec fails with footprint_without_spec", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${PARA}\n\n`, "").write(".faff/anchors/FAFF-9/anchor.json", "{}\n").commit();
    const { status, out } = fx.json();
    assert.equal(status, 1);
    assert.equal(out.footprint_without_spec, true);
    assert.equal(out.result, "fail");
  } finally { fx.cleanup(); }
  const fy = fixture({ ".faff/anchors/FAFF-8/anchor.json": "{}\n" });
  try {
    fy.edit("plugin/skills/faff-graft/SKILL.md", `${PARA}\n\n`, "").write(".faff/anchors/FAFF-8/anchor.json", "{\"v\":2}\n").commit();
    assert.equal(fy.json().out.footprint_without_spec, true, "a modified anchor is a footprint too");
  } finally { fy.cleanup(); }
});

test("a row whose anchor matches no deleted prose warns and does not fail", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n`, "")
      .write(SPEC, spec([row("Push the branch before review so a stall", "—", "dropped: graft pushes itself"), row("text that appears in no deleted block at all", "—", "dropped: obsolete")]))
      .commit();
    const { status, out } = fx.json();
    assert.equal(status, 0, JSON.stringify(out));
    assert.ok(out.warnings.some((w) => w.includes("anchor matches no deleted prose")));
  } finally { fx.cleanup(); }
});

test("a spec-derived workflow command never starts an output line", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n`, "")
      .write(SPEC, spec([row("Push the branch before review so a stall", "—", "dropped: ::error::forged"), "| `::error::x` | — | bogus |"]))
      .commit();
    const r = fx.run(["--base", "origin/main"]);
    assert.ok(r.stdout.length > 0);
    for (const line of r.stdout.split("\n")) assert.ok(!line.startsWith("::error::"), line);
    for (const line of r.stdout.split("\n").filter(Boolean)) assert.ok(line.startsWith("rule-inventory: "), line);
  } finally { fx.cleanup(); }
});

test("--summary appends the row-covered table with dropped rows first", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n${BULLET2}\n`, "")
      .write(SPEC, spec([row("Push the branch before review so a stall", "test/x.test.mjs", "kept"), row("Tick the heartbeat before and after", "—", "dropped: superseded by faff x")]))
      .commit();
    const out = join(fx.root, "out.md");
    writeFileSync(out, "existing\n");
    const r = fx.run(["--base", "origin/main", "--summary", out]);
    assert.equal(r.status, 0, r.stdout);
    const md = readFileSync(out, "utf8");
    assert.ok(md.startsWith("existing\n"), "appends");
    const rows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Disposition"));
    assert.equal(rows.length, 2);
    assert.match(rows[0], /^\| dropped \|/);
    assert.match(rows[1], /^\| kept \|/);
  } finally { fx.cleanup(); }
});

test("a kept row with an empty Covering test cell is a row error", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n`, "")
      .write(SPEC, spec([row("Push the branch before review so a stall", "", "kept")])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1);
    assert.ok(out.row_errors.some((e) => e.reason === "kept row names no covering test"));
  } finally { fx.cleanup(); }
});

test("a reworded heading alone is not exempt: it needs a row", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", "## Step one\n", "## Step 1\n").write(SPEC, spec([])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1);
    assert.equal(out.uncovered.length, 1);
    assert.equal(out.uncovered[0].base_line, 3);
  } finally { fx.cleanup(); }
});

test("a committed spec over 1 MiB exits 2", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n`, "").write(SPEC, `# big\n\n${"x".repeat(1024 * 1024 + 10)}\n`).commit();
    const r = fx.run(["--base", "origin/main"]);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, "");
  } finally { fx.cleanup(); }
});

test("a whole section deleted counts only its paragraph: the heading is exempt", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", "### Example\n\nAn example paragraph that only illustrates the flow for a reader of this file.\n\n", "")
      .write(SPEC, spec([row("An example paragraph that only illustrates", "—", "dropped: obsolete example")])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 0, JSON.stringify(out));
    assert.equal(out.blocks_deleted, 1);
  } finally { fx.cleanup(); }
});

test("a deleted thematic break alone is letterless and exempt", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", "---\n\n", "").write(SPEC, "# FAFF-9\n").commit();
    const { status, out } = fx.json();
    assert.equal(status, 0);
    assert.equal(out.skipped_reason, "no-prose-deleted");
  } finally { fx.cleanup(); }
});

test("a short anchor covers only a block whose whole text it equals, never a longer block containing it", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", "- Fails loud.\n- When the probe is indeterminate it says - Fails loud. and never counts as a pass.\n", "")
      .write(SPEC, spec([row("- Fails loud.", "—", "dropped: merged")])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1);
    assert.equal(out.covered_by_row, 1);
    assert.equal(out.uncovered.length, 1);
    assert.match(out.uncovered[0].excerpt, /indeterminate/);
    assert.deepEqual(out.row_errors, []);
  } finally { fx.cleanup(); }
});

test("a --base that is not a plain ref exits 2 and prints nothing on stdout", () => {
  const fx = fixture();
  try {
    for (const bad of ["-x", "a;b", "main^", "nope/not-a-ref"]) {
      const r = fx.run(["--base", bad]);
      assert.equal(r.status, 2, bad);
      assert.equal(r.stdout, "", bad);
    }
    assert.equal(fx.run(["--bogus"]).status, 2);
    assert.equal(fx.run(["--base", "origin/main", "extra"]).status, 2);
  } finally { fx.cleanup(); }
});

test("row errors: no code span, short anchor, bad disposition, empty reason, bad or missing test path, absent test name", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n`, "")
      .write(SPEC, spec([
        "| no code span here | — | dropped: x |",
        row("too short", "—", "dropped: x"),
        row("Push the branch before review so a stall", "—", "moved"),
        row("Push the branch before review so a stall", "—", "changed:   "),
        row("Push the branch before review so a stall", "src/a.js", "kept"),
        row("Push the branch before review so a stall", "test/../escape.test.mjs", "kept"),
        row("Push the branch before review so a stall", "test/missing.test.mjs", "kept"),
        row("Push the branch before review so a stall", "test/x.test.mjs: \"no such test\"", "kept"),
      ])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1);
    const reasons = out.row_errors.map((e) => `${e.line}:${e.reason}`);
    const has = (re) => assert.ok(reasons.some((r) => re.test(r)), `${re} in ${JSON.stringify(reasons)}`);
    has(/^9:Prose rule cell has no code-span anchor$/);
    has(/^10:anchor shorter than 20 characters$/);
    has(/^11:disposition is not kept/);
    has(/^12:changed row gives no reason$/);
    has(/^13:covering test src\/a\.js is not a test\/<path>\.test\.mjs path$/);
    has(/^14:covering test test\/\.\.\/escape\.test\.mjs is not a test/);
    has(/^15:covering test test\/missing\.test\.mjs does not exist$/);
    has(/^16:covering test test\/x\.test\.mjs has no test named "no such test"$/);
    // Line numbers point at the spec line, so the text output names spec:line.
    assert.match(fx.run(["--base", "origin/main"]).stdout, new RegExp(`^rule-inventory: row-error ${SPEC.replace(/[.]/g, "\\.")}:12: `, "m"));
  } finally { fx.cleanup(); }
});

test("an inventory table header with a Prose rule column but no Disposition column is a row error, never a skip", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n`, "")
      .write(SPEC, spec([row("Push the branch before review so a stall", "—", "dropped: x")], { header: "| Prose rule | Covering test | Outcome |" })).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1);
    assert.ok(out.row_errors.some((e) => /needs both a Prose rule and a Disposition column/.test(e.reason)));
    assert.equal(out.uncovered.length, 1);
  } finally { fx.cleanup(); }
});

test("a qualified header (`Prose rule (§2)`) is read; a kept row in a table with no Covering test column is a row error", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n${BULLET2}\n`, "")
      .write(SPEC, "# F\n\n## Rule inventory (slice A)\n\n| # | Prose rule (§2) | Disposition |\n|---|---|---|\n" +
        "| 1 | `Push the branch before review so a stall` | **dropped:** graft pushes |\n| 2 | `Tick the heartbeat before and after` | `kept` |\n").commit();
    const { status, out } = fx.json();
    assert.equal(status, 1);
    assert.equal(out.covered_by_row, 1);
    assert.ok(out.row_errors.some((e) => e.reason === "a table with a kept row needs a Covering test column"));
  } finally { fx.cleanup(); }
});

test("exemptions: separator rows are exempt; a header row is exempt only with its whole table", () => {
  const whole = "| Token | Action |\n|---|---|\n| ready | continue to the next step without asking |\n| park | write the park comment and stop the build |\n| hold | release the claim and requeue the issue |\n\n";
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", whole, "")
      .write(SPEC, spec([row("continue to the next step without", "—", "dropped: a"), row("write the park comment and stop", "—", "dropped: b"), row("release the claim and requeue", "—", "dropped: c")]))
      .commit();
    const { status, out } = fx.json();
    assert.equal(status, 0, JSON.stringify(out));
    assert.equal(out.blocks_deleted, 3, "three data rows; header and separator exempt");
  } finally { fx.cleanup(); }
  const fy = fixture();
  try {
    fy.edit("plugin/skills/faff-graft/SKILL.md", "| Token | Action |\n", "| Token | What to do |\n").write(SPEC, spec([])).commit();
    const { status, out } = fy.json();
    assert.equal(status, 1);
    assert.equal(out.uncovered.length, 1, "a header row reworded on its own needs a row");
    assert.equal(out.uncovered[0].base_line, 14);
  } finally { fy.cleanup(); }
  const fz = fixture();
  try {
    fz.edit("plugin/skills/faff-graft/SKILL.md", "| hold | release the claim and requeue the issue |\n", "").write(SPEC, spec([])).commit();
    const { out } = fz.json();
    assert.equal(out.blocks_deleted, 1, "one data row, its table's header kept");
  } finally { fz.cleanup(); }
});

test("text moved verbatim into another skill file, or reflowed in place, is moved and needs no row", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-prep/SKILL.md", "- Confirm the attach with the returned comment id after posting.\n", "")
      .edit("plugin/skills/faff-graft/SKILL.md", "## Step two\n", "## Step two\n\n- Confirm the attach with the returned comment id after posting.\n")
      .edit("plugin/skills/faff/references/kernel.md", "applies\nwhen it loads, written across several lines so that it can be reflowed\n", "applies when it\nloads, written across several lines so that it can be reflowed\n")
      .write(SPEC, "# FAFF-9\n\nNo inventory needed.\n").commit();
    const { status, out } = fx.json();
    assert.equal(status, 0, JSON.stringify(out));
    assert.equal(out.covered_moved, 2);
    assert.deepEqual(out.row_errors, []);
  } finally { fx.cleanup(); }
});

test("text moved into a non-watched file is not moved", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-prep/SKILL.md", "- Confirm the attach with the returned comment id after posting.\n", "")
      .write("docs/guide/prep.md", "- Confirm the attach with the returned comment id after posting.\n")
      .write(SPEC, spec([])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1);
    assert.equal(out.uncovered[0].file, "plugin/skills/faff-prep/SKILL.md");
  } finally { fx.cleanup(); }
});

test("only specs the diff adds are read: an older spec the branch modifies contributes no rows", () => {
  const fx = fixture({ "records/specs/2026-01-01-FAFF-1-old-design.md": spec([row("Push the branch before review so a stall", "—", "dropped: x")]) });
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n`, "").edit("records/specs/2026-01-01-FAFF-1-old-design.md", "Intro.", "Intro, edited.").commit();
    const { status, out } = fx.json();
    assert.equal(status, 0);
    assert.equal(out.skipped_reason, "no-spec-committed");
    assert.deepEqual(out.specs, []);
  } finally { fx.cleanup(); }
});

test("without --base: merge-base with origin/HEAD, else skipped no-base", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${PARA}\n\n`, "").write(SPEC, spec([])).commit();
    const none = fx.run(["--json"]);
    assert.equal(none.status, 0);
    assert.equal(JSON.parse(none.stdout).skipped_reason, "no-base");
    sh(fx.dir, "remote", "set-head", "origin", "main");
    sh(fx.dir, "fetch", "-q", "origin");
    const withHead = fx.run(["--json"]);
    assert.equal(withHead.status, 1);
    const out = JSON.parse(withHead.stdout);
    assert.equal(out.base, sh(fx.dir, "rev-parse", "origin/main").trim());
    assert.equal(out.uncovered.length, 1);
  } finally { fx.cleanup(); }
});

test("a failing git command exits 2, never 0", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${PARA}\n\n`, "").write(SPEC, spec([])).commit();
    const real = (args, input) => {
      const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: fx.dir, input });
      return { status: r.status ?? 128, stdout: r.stdout, stderr: String(r.stderr) };
    };
    for (const breaks of ["diff", "cat-file", "ls-tree"]) {
      const git = (args, input) => (args[0] === breaks ? { status: 128, stdout: Buffer.alloc(0), stderr: "fatal: broken" } : real(args, input));
      assert.throws(() => ri.check({ repo: fx.dir, base: "origin/main", git }), ri.CheckError, breaks);
    }
    assert.equal(fx.run(["--base", "refs/heads/nonexistent"]).status, 2);
    const notRepo = mkdtempSync(join(tmpdir(), "faff-ri-norepo-"));
    try { assert.equal(spawnSync(process.execPath, [CLI, "rule-inventory", "check"], { cwd: notRepo, encoding: "utf8", env: { ...GIT_ENV, GIT_CEILING_DIRECTORIES: dirname(notRepo) } }).status, 2); } finally { rmSync(notRepo, { recursive: true, force: true }); }
  } finally { fx.cleanup(); }
});

test("an unreadable config exits 2, never a pass", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${PARA}\n\n`, "").write(SPEC, spec([])).write(".faff/config.yaml", "- not\n- a mapping\n").commit();
    const r = fx.run(["--base", "origin/main"]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.equal(r.stdout, "");
  } finally { fx.cleanup(); }
});

test("a changed path under plugin/skills/ that is not valid UTF-8 is an error, never a skip", () => {
  const bad = Buffer.concat([Buffer.from("M\0plugin/skills/x/SKILL"), Buffer.from([0xff, 0xfe]), Buffer.from(".md\0")]);
  assert.throws(() => ri.parseNameStatus(bad), ri.CheckError);
  const other = Buffer.concat([Buffer.from("M\0docs/"), Buffer.from([0xff]), Buffer.from(".md\0A\0plugin/skills/x/SKILL.md\0")]);
  assert.deepEqual(ri.parseNameStatus(other).map((c) => c.status), ["X", "A"]);
});

test("normalise, clean and mdEscape", () => {
  assert.equal(ri.normalise("  **Fail** `closed`\n  on\terror  "), "Fail closed on error");
  assert.equal(ri.clean("a\u001b[31mb\nc"), "a [31mb c");
  assert.equal(Array.from(ri.clean("x".repeat(500))).length, 200);
  const e = ri.mdEscape("x | ![p](https://example.invalid/p.png) <b>&# _*`\\");
  assert.ok(!/(^|[^\\])!\[/.test(e), e);
  assert.ok(!/(^|[^\\])\|/.test(e), e);
  assert.ok(!e.includes("<") && !e.includes(">"), e);
  assert.match(e, /&amp;\\#/);
});

test("splitRow, firstCodeSpan and parseTests", () => {
  assert.deepEqual(ri.splitRow("| a \\| b | `c` |"), ["a | b", "`c`"]);
  assert.equal(ri.firstCodeSpan("x `` a `b` c `` y `z`"), "a `b` c");
  assert.equal(ri.firstCodeSpan("no span"), null);
  assert.deepEqual(ri.parseTests('test/a.test.mjs: "n, m"; test/b.test.mjs').tests, [{ file: "test/a.test.mjs", name: "n, m" }, { file: "test/b.test.mjs", name: null }]);
  assert.deepEqual(ri.parseTests("—").tests, []);
});

test("the CLI registration: a factory command with no selftest", () => {
  const regions = require("../plugin/skills/faff/bin/lib/regions.js");
  const map = regions.REGION_MAP ?? {};
  const argv = regions.REGION_SELFTEST_ARGV ?? {};
  if (Object.keys(map).length) assert.equal(map["rule-inventory"], "factory");
  if (Object.keys(argv).length) assert.equal(argv["rule-inventory"], null);
  const r = spawnSync(process.execPath, [CLI, "rule-inventory"], { encoding: "utf8" });
  assert.equal(r.status, 2);
});

// --- Review round 1 (FAFF-1428): each case closes an escape the first build allowed. ---------------

const EXAMPLE_HEAD = "### Example\n";
const EXAMPLE_PARA = "An example paragraph that only illustrates the flow for a reader of this file.";

test("a binary or -diff attribute, or a NUL byte at HEAD, never hides a deletion (review: binary diff)", () => {
  for (const [label, extra, nul] of [
    ["*.md -diff attribute", { ".gitattributes": "*.md -diff\n" }, false],
    ["SKILL.md binary attribute", { ".gitattributes": "SKILL.md binary\n" }, false],
    ["NUL byte at HEAD", {}, true],
  ]) {
    const fx = fixture(extra);
    try {
      fx.edit("plugin/skills/faff-graft/SKILL.md", `${PARA}\n\n`, nul ? "\u0000\n\n" : "").write(SPEC, spec([])).commit();
      const { status, out, stderr } = fx.json();
      assert.equal(status, 1, `${label}: ${stderr}`);
      assert.equal(out.uncovered.length, 1, label);
      assert.equal(out.uncovered[0].base_line, 5, label);
    } finally { fx.cleanup(); }
  }
});

test("a watched file whose diff has no text hunk is an error, never a skip (review: binary diff)", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${PARA}\n\n`, "").write(SPEC, spec([])).commit();
    const real = (args, input) => {
      const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd: fx.dir, input });
      return { status: r.status ?? 128, stdout: r.stdout, stderr: String(r.stderr) };
    };
    for (const fake of ["Binary files a/x and b/x differ\n", "diff --git a/x b/x\nindex 1..2 100644\n"]) {
      const git = (args, input) => (args.includes("-U0") ? { status: 0, stdout: Buffer.from(fake), stderr: "" } : real(args, input));
      assert.throws(() => ri.check({ repo: fx.dir, base: "origin/main", git }), ri.CheckError, fake);
    }
  } finally { fx.cleanup(); }
});

test("a reworded heading over a partly edited section is not exempt (review: section exemption)", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", EXAMPLE_HEAD, "### Merging\n")
      .edit("plugin/skills/faff-graft/SKILL.md", EXAMPLE_PARA, EXAMPLE_PARA.replace("reader", "Reader"))
      .write(SPEC, spec([row("An example paragraph that only illustrates", "—", "changed: capitalised")])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1, JSON.stringify(out));
    assert.equal(out.uncovered.length, 1);
    assert.equal(out.uncovered[0].base_line, 20, "the heading's base line");
  } finally { fx.cleanup(); }
});

test("a renamed table header is not exempt when the table's rows reappear (review: table exemption)", () => {
  const fx = fixture();
  try {
    const g = fx.read("plugin/skills/faff-graft/SKILL.md")
      .replace("| Token | Action |\n|---|---|\n", "| Signal | Action | Note |\n|---|---|---|\n")
      .replace("| ready | continue to the next step without asking |", "| ready | continue to the next step without asking | x |")
      .replace("| park | write the park comment and stop the build |", "| park | write the park comment and stop the build | y |")
      .replace("| hold | release the claim and requeue the issue |", "| hold | release the claim and requeue the issue | z |");
    fx.write("plugin/skills/faff-graft/SKILL.md", g).write(SPEC, spec([])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1, JSON.stringify(out));
    assert.equal(out.covered_moved, 3, "data rows reappear inside the widened rows");
    assert.deepEqual(out.uncovered.map((u) => u.base_line), [14], "the header row needs a row");
  } finally { fx.cleanup(); }
});

test("a section moved to another skill under a new heading is not exempt: its old heading needs a row (review: section exemption)", () => {
  const fx = fixture();
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${EXAMPLE_HEAD}\n${EXAMPLE_PARA}\n\n`, "")
      .write("plugin/skills/faff-prep/SKILL.md", `${fx.read("plugin/skills/faff-prep/SKILL.md")}\n### Illustration\n\n${EXAMPLE_PARA}\n`)
      .write(SPEC, spec([])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1, JSON.stringify(out));
    assert.equal(out.covered_moved, 1);
    assert.deepEqual(out.uncovered.map((u) => u.base_line), [20]);
  } finally { fx.cleanup(); }
});

test("a heading with an empty section is not exempt when deleted (review: empty section)", () => {
  const fx = fixture({ "plugin/skills/faff-prep/SKILL.md": "# Prep\n\n### A\n\n### B\n\nSome text under the second heading for a reader.\n" });
  try {
    fx.edit("plugin/skills/faff-prep/SKILL.md", "### A\n\n", "").write(SPEC, spec([])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1, JSON.stringify(out));
    assert.deepEqual(out.uncovered.map((u) => u.base_line), [3]);
  } finally { fx.cleanup(); }
});

test("a covering test that is a directory at HEAD does not exist (review: cat-file -t)", () => {
  const fx = fixture({ "test/dir.test.mjs/inner.txt": "not a test file\n" });
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n`, "")
      .write(SPEC, spec([row("Push the branch before review so a stall", "test/dir.test.mjs", "kept")])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1);
    assert.ok(out.row_errors.some((e) => e.reason === "covering test test/dir.test.mjs does not exist"), JSON.stringify(out.row_errors));
  } finally { fx.cleanup(); }
});

test("spec_docs_path is normalised: ./records/specs/ finds the spec; an absolute path exits 2 (review: spec_docs_path)", () => {
  const fx = fixture({ ".faff/config.yaml": "tracking:\n    spec_docs_path: ./records/specs/\n" });
  try {
    fx.edit("plugin/skills/faff-graft/SKILL.md", `${PARA}\n\n`, "").write(SPEC, "# FAFF-9\n\nNo inventory.\n").commit();
    const { status, out } = fx.json();
    assert.equal(status, 1, JSON.stringify(out));
    assert.deepEqual(out.specs, [SPEC]);
    fx.write(".faff/config.yaml", "tracking:\n    spec_docs_path: /abs/specs/\n").commit("abs");
    const r = fx.run(["--base", "origin/main"]);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, "");
  } finally { fx.cleanup(); }
});

test("a watched path with glob characters is matched literally (review: literal pathspecs)", () => {
  // `f[a]` as a glob pathspec also matches `fa`, so without --literal-pathspecs fa's hunks would be
  // read against f[a]'s base text and report a deletion f[a] never had.
  const fx = fixture({
    "plugin/skills/f[a]/SKILL.md": "# F\n\nA paragraph in the skill whose directory name holds glob characters.\n",
    "plugin/skills/fa/SKILL.md": "# F\n\nA paragraph in the plain sibling skill that this branch deletes outright.\n",
  });
  try {
    fx.edit("plugin/skills/fa/SKILL.md", "A paragraph in the plain sibling skill that this branch deletes outright.\n", "")
      .edit("plugin/skills/f[a]/SKILL.md", "holds glob characters.\n", "holds glob characters.\n\nAn added paragraph.\n")
      .write(SPEC, spec([])).commit();
    const { status, out } = fx.json();
    assert.equal(status, 1, JSON.stringify(out));
    assert.deepEqual(out.uncovered.map((u) => u.file), ["plugin/skills/fa/SKILL.md"]);
    assert.equal(out.blocks_deleted, 1, "f[a] deleted nothing");
    assert.equal(out.covered_moved, 0);
  } finally { fx.cleanup(); }
});

// --- Mutation proof: each rule bites. -------------------------------------------------------------
function mutant(from, to) {
  const src = readFileSync(join(LIB, "rule-inventory.js"), "utf8");
  assert.ok(src.includes(from), `mutation anchor not found: ${from}`);
  const dir = mkdtempSync(join(tmpdir(), "faff-ri-mut-"));
  const body = src.replace(from, to).replace(/require\("\.\/([^"]+)"\)/g, (_m, mod) => `require(${JSON.stringify(join(LIB, mod))})`);
  const file = join(dir, "rule-inventory.js");
  writeFileSync(file, body);
  return { mod: require(file), dir };
}

test("mutations: dropping the anchor-length floor, the kept-needs-test rule or the moved test each fail a case", () => {
  const cases = [
    {
      name: "anchor-length floor",
      mutate: ["const MIN_ANCHOR = 20;", "const MIN_ANCHOR = 0;"],
      setup: (fx) => fx.edit("plugin/skills/faff-graft/SKILL.md", "- Fails loud.\n- When the probe is indeterminate it says - Fails loud. and never counts as a pass.\n", "")
        .write(SPEC, spec([row("- Fails loud.", "—", "dropped: merged")])).commit(),
      expect: (r) => r.result === "fail" && r.uncovered.length === 1,
    },
    {
      name: "kept needs a test",
      mutate: ['if (row.disposition === "kept" && row.tests.length === 0)', "if (false)"],
      setup: (fx) => fx.edit("plugin/skills/faff-graft/SKILL.md", `${BULLET1}\n`, "")
        .write(SPEC, spec([row("Push the branch before review so a stall", "", "kept")])).commit(),
      expect: (r) => r.result === "fail" && r.row_errors.some((e) => e.reason === "kept row names no covering test"),
    },
    {
      name: "moved test",
      mutate: ["if (headBlocks.some((h) => h.includes(b.norm)))", "if (false)"],
      setup: (fx) => fx.edit("plugin/skills/faff-prep/SKILL.md", "- Confirm the attach with the returned comment id after posting.\n", "")
        .edit("plugin/skills/faff-graft/SKILL.md", "## Step two\n", "## Step two\n\n- Confirm the attach with the returned comment id after posting.\n")
        .write(SPEC, "# FAFF-9\n").commit(),
      expect: (r) => r.result === "pass" && r.covered_moved === 1,
    },
  ];
  for (const c of cases) {
    const fx = fixture();
    const m = mutant(c.mutate[0], c.mutate[1]);
    try {
      c.setup(fx);
      const good = ri.check({ repo: fx.dir, base: "origin/main" }).result;
      assert.ok(c.expect(good), `${c.name}: the real module passes the case`);
      const bad = m.mod.check({ repo: fx.dir, base: "origin/main" }).result;
      assert.ok(!c.expect(bad), `${c.name}: the mutant must fail the case`);
    } finally { fx.cleanup(); rmSync(m.dir, { recursive: true, force: true }); }
  }
});
