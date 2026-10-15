// Fixture-data handling in code review: the `faff review-fixture-paths` resolver, the
// review-call.mjs matcher mirror, and the deterministic severity cap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXIT, FIXTURE_CAP_SEVERITIES, capFixtureFindings, isFixturePath as isFixturePathMirror, main, parseArgs, parseDiffFiles,
} from "../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const lib = require("../plugin/skills/faff/bin/lib/review-fixture-paths.js");
const FAFF = join(root, "plugin/skills/faff/bin/faff");
const ADVERSARIAL_SKILL = join(root, "plugin/skills/faffter-dark-adversarial-review/SKILL.md");

const REPO_PREFIXES = [
  "eval/cases/", "eval/cases-live/", "eval/cases-pilot/", "eval/cases-seeded/", "eval/baselines/", "test/fixtures/", "testdata/",
];

function fileDiff(path, addedLines, { status = "new" } = {}) {
  const body = addedLines.map((l) => `+${l}`).join("\n");
  const head = status === "new"
    ? `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${addedLines.length} @@`
    : `diff --git a/${path} b/${path}\nindex 2222222..3333333 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,0 +1,${addedLines.length} @@`;
  return `${head}\n${body}\n`;
}

function deletedFileDiff(path) {
  return `diff --git a/${path} b/${path}\ndeleted file mode 100644\nindex 4444444..0000000\n--- a/${path}\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-removed line\n`;
}

const finding = (severity, title, body) => `### ${severity}: ${title}\n${body}\n`;

test("isFixturePath: matches segment-anchored directory prefixes only", () => {
  assert.equal(lib.isFixturePath("test/fixtures/x.json", ["fixtures/"]), true);
  assert.equal(lib.isFixturePath("fixtures/x.json", ["fixtures/"]), true);
  assert.equal(lib.isFixturePath("eval/cases/a.json", ["eval/cases/"]), true);
  assert.equal(lib.isFixturePath("b/eval/cases/a.json", ["eval/cases/"]), true);
  assert.equal(lib.isFixturePath("eval/bridge-fixture.mjs", ["eval/cases/"]), false);
  assert.equal(lib.isFixturePath("eval/grader.mjs", ["eval/cases/"]), false);
  assert.equal(lib.isFixturePath("eval/cases-live/a.json", ["eval/cases/"]), false);
  assert.equal(lib.isFixturePath("myfixtures/x", lib.DEFAULT_FIXTURE_PATHS), false);
  assert.equal(lib.isFixturePath("eval/bridge-fixture.mjs", lib.DEFAULT_FIXTURE_PATHS), false);
});

test("matcher parity: the review-call.mjs mirror agrees with the bin/lib module", () => {
  const paths = [
    "test/fixtures/x.json", "fixtures/x.json", "a/fixtures/x.json", "./testdata/y", "eval/cases/a.json",
    "eval/cases-live/a.json", "eval/bridge-fixture.mjs", "eval/grader.mjs", "myfixtures/x", "src/db/users.js",
    "b/eval/cases/z.json", "deep/er/__fixtures__/q.js", "",
  ];
  const lists = [[], ["eval/cases/"], lib.DEFAULT_FIXTURE_PATHS, REPO_PREFIXES];
  for (const prefixes of lists) {
    for (const p of paths) {
      assert.equal(isFixturePathMirror(p, prefixes), lib.isFixturePath(p, prefixes), `${JSON.stringify(p)} against ${JSON.stringify(prefixes)}`);
    }
  }
});

test("resolveFixturePaths: default, replace, empty and non-string entries", () => {
  assert.deepEqual(lib.resolveFixturePaths({}), [...lib.DEFAULT_FIXTURE_PATHS]);
  assert.deepEqual(lib.resolveFixturePaths({ review: { fixture_paths: ["eval/cases", "./a/"] } }), ["eval/cases/", "a/"]);
  assert.deepEqual(lib.resolveFixturePaths({ review: { fixture_paths: [] } }), []);
  assert.deepEqual(lib.resolveFixturePaths({ review: { fixture_paths: ["x/", 3, null] } }), ["x/"]);
});

function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function runCli(cwd, ...args) {
  return spawnSync("node", [FAFF, "review-fixture-paths", ...args], { cwd, encoding: "utf8" });
}

test("review-fixture-paths CLI: --ref reads the base ref, not the PR's working tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-fixture-paths-cli-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, ".faffrc.yaml"), "review:\n  fixture_paths:\n    - eval/cases/\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "base");
    git(dir, "switch", "-q", "-c", "pr");
    writeFileSync(join(dir, ".faffrc.yaml"), "review:\n  fixture_paths:\n    - src/\n");
    git(dir, "commit", "-q", "-am", "pr widens the list");

    const atBase = runCli(dir, "--ref", "main");
    assert.equal(atBase.status, 0, atBase.stderr);
    assert.equal(atBase.stdout, "eval/cases/\n");

    const workingTree = runCli(dir);
    assert.equal(workingTree.stdout, "src/\n");

    const base = lib.resolveFixturePaths(lib.readConfigAtRef(dir, "main").cfg);
    const diff = fileDiff("src/db/users.js", ["const findRow = 1;"], { status: "changed" });
    const critical = finding("critical", "Broken `findRow` handling", "Names src/db/users.js directly.");
    const { content, caps } = capFixtureFindings(critical, diff, [], base);
    assert.equal(content, critical, "a critical in src/ is not capped because the list comes from the base ref");
    assert.deepEqual(caps, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("review-fixture-paths CLI: unset key, empty list, missing file, malformed file and bad ref", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-fixture-paths-cli-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "commit", "-q", "--allow-empty", "-m", "empty");
    assert.equal(runCli(dir, "--ref", "main").stdout, "fixtures/\n__fixtures__/\ntestdata/\n");

    writeFileSync(join(dir, ".faffrc.yaml"), "review:\n  fixture_paths: []\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "empty list");
    const empty = runCli(dir, "--ref", "main");
    assert.equal(empty.status, 0);
    assert.equal(empty.stdout, "");

    writeFileSync(join(dir, ".faffrc.yaml"), "appetite: high\n");
    git(dir, "commit", "-q", "-am", "key unset");
    assert.equal(runCli(dir, "--ref", "main").stdout, "fixtures/\n__fixtures__/\ntestdata/\n");

    writeFileSync(join(dir, ".faffrc.yaml"), "review:\n  fixture_paths:\n    - a/\n    - 7\n    - b/\n");
    git(dir, "commit", "-q", "-am", "mixed entries");
    assert.equal(runCli(dir, "--ref", "main").stdout, "a/\nb/\n");

    writeFileSync(join(dir, ".faffrc.yaml"), "- just\n- a list\n");
    git(dir, "commit", "-q", "-am", "malformed");
    const malformed = runCli(dir, "--ref", "main");
    assert.equal(malformed.status, 2);
    assert.match(malformed.stderr, /malformed/);
    assert.equal(malformed.stdout, "");

    const badRef = runCli(dir, "--ref", "no-such-ref");
    assert.equal(badRef.status, 2);
    assert.match(badRef.stderr, /no-such-ref/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("review-fixture-paths CLI: a legacy-named config at the ref exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-fixture-paths-cli-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, ".faffrc.yml"), "appetite: high\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "legacy name");
    const r = runCli(dir, "--ref", "main");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /legacy config filename/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("review-fixture-paths --selftest passes", () => {
  const r = spawnSync("node", [FAFF, "review-fixture-paths", "--selftest"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("this repo's .faffrc.yaml sets the configured fixture paths", () => {
  const r = spawnSync("node", [FAFF, "review-fixture-paths"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split("\n"), REPO_PREFIXES);
  assert.ok(!REPO_PREFIXES.includes("eval/"), "eval/ holds real code and is never a fixture path");
});

test("parseDiffFiles: names deleted files and collects added-line identifiers per file", () => {
  const diff = deletedFileDiff("src/a.js") + fileDiff("test/fixtures/b.json", ["{\"name\": \"loadWidget\"}"]);
  const { paths, addedTokens } = parseDiffFiles(diff);
  assert.deepEqual([...paths].sort(), ["src/a.js", "test/fixtures/b.json"]);
  assert.ok(addedTokens.get("test/fixtures/b.json").has("loadWidget"));
  assert.equal(addedTokens.has("src/a.js"), false);
});

test("parseDiffFiles: a hunk body line that reads like a header is data", () => {
  const diff = "diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n@@ -1,1 +1,2 @@\n ctx\n+++ b/trap.js\n";
  const { paths } = parseDiffFiles(diff);
  assert.deepEqual([...paths], ["x.txt"]);
});

const FIXTURE = "test/fixtures/case.json";
const fixtureDiff = fileDiff(FIXTURE, ["{\"code\": \"function findUserByName(name) { return db.query(name); }\"}"]);

test("cap: a critical naming only a fixture, identifier on an added fixture line, is capped with evidence", () => {
  const diff = fixtureDiff + fileDiff("src/other.js", ["const unrelated = 1;"], { status: "changed" });
  const content = [
    "## Adversarial findings - x/y",
    "",
    finding("critical", "SQL injection in findUserByName", `Names \`${FIXTURE}\`.`),
    finding("minor", "Unrelated nit", "None."),
  ].join("\n");
  const { content: out, caps } = capFixtureFindings(content, diff, [], ["test/fixtures/"]);
  assert.match(out, /^### minor: \[fixture-data\] SQL injection in findUserByName$/m);
  assert.match(out, new RegExp(`^> fixture-data: located only in fixture path\\(s\\) ${FIXTURE.replace(/[./]/g, "\\$&")}; capped from critical \\(test data, not shipped code\\)$`, "m"));
  assert.deepEqual(caps, [{ title: "SQL injection in findUserByName", from: "critical", files: [FIXTURE] }]);
  assert.doesNotMatch(out, /### critical:/);
});

test("cap: untouched sections keep their exact bytes, spacing included", () => {
  const diff = fixtureDiff;
  const before = "## Header\n\n### major: A major\nbody  with  odd   spacing\n\n\n";
  const target = `### critical: Bad findUserByName\nSee ${FIXTURE}.\n\n`;
  const after = "### minor: Last\ntail\n";
  const { content: out } = capFixtureFindings(before + target + after, diff, [], ["test/fixtures/"]);
  assert.ok(out.startsWith(before));
  assert.ok(out.endsWith(`\n\n${after}`));
  assert.equal(out.split("\n").length, (before + target + after).split("\n").length + 1);
});

test("cap: a critical naming a fixture and a real file stays critical", () => {
  const diff = fixtureDiff + fileDiff("src/real.js", ["const findUserByName = 1;"], { status: "changed" });
  const content = finding("critical", "Bad findUserByName", `Names ${FIXTURE} and src/real.js.`);
  assert.equal(capFixtureFindings(content, diff, [], ["test/fixtures/"]).content, content);
});

test("cap: a critical naming no PR path stays critical in a mixed PR", () => {
  const diff = fixtureDiff + fileDiff("src/real.js", ["const x = 1;"], { status: "changed" });
  const content = finding("critical", "Bad findUserByName", "Mentions only `findUserByName`.");
  const out = capFixtureFindings(content, diff, [], ["test/fixtures/"]);
  assert.equal(out.content, content);
  assert.deepEqual(out.caps, []);
});

test("cap: a critical naming no PR path is capped in a fixture-only PR", () => {
  const content = finding("critical", "Bad findUserByName", "Mentions `findUserByName` from an embedded diff of src/db/users.js.");
  const { content: out, caps } = capFixtureFindings(content, fixtureDiff, [], ["test/fixtures/"]);
  assert.match(out, /^### minor: \[fixture-data\] Bad findUserByName$/m);
  assert.deepEqual(caps[0].files, [FIXTURE]);
});

test("cap: major and observation findings are never touched", () => {
  const content = finding("major", "Bad findUserByName", `Names ${FIXTURE}.`) + finding("observation", "Odd findUserByName", `Names ${FIXTURE}.`);
  assert.equal(capFixtureFindings(content, fixtureDiff, [], ["test/fixtures/"]).content, content);
});

test("cap: an already refuted section is skipped", () => {
  const content = finding("observation", "[auto-refuted] Bad findUserByName", `Names ${FIXTURE}.\n> auto-refuted: node --check passed`);
  assert.equal(capFixtureFindings(content, fixtureDiff, [], ["test/fixtures/"]).content, content);
});

test("cap: no prefixes leaves the content unchanged", () => {
  const content = finding("critical", "Bad findUserByName", `Names ${FIXTURE}.`);
  const out = capFixtureFindings(content, fixtureDiff, [], []);
  assert.equal(out.content, content);
  assert.deepEqual(out.caps, []);
});

test("cap origin check: identifiers on no added fixture line keep the critical (unchanged loader shape)", () => {
  const diff = fileDiff(FIXTURE, ["{\"id\": \"case-1\"}"]);
  const content = finding("critical", "Unsafe evalFixtureText", `\`evalFixtureText\` runs eval on the content of ${FIXTURE}.`);
  assert.equal(capFixtureFindings(content, diff, [], ["test/fixtures/"]).content, content);
});

test("cap origin check: an identifier on both an added fixture line and an added real line keeps the critical", () => {
  const diff = fixtureDiff + fileDiff("src/copy.js", ["function findUserByName(name) {}"], { status: "changed" });
  const content = finding("critical", "Bad `findUserByName`", `Names ${FIXTURE}.`);
  assert.equal(capFixtureFindings(content, diff, [], ["test/fixtures/"]).content, content);
});

test("cap: a file deleted from real code still blocks the fixture-only fallback", () => {
  const diff = deletedFileDiff("src/a.js") + fileDiff("test/fixtures/b.json", ["{\"call\": \"findUserByName\"}"]);
  const content = finding("critical", "Bad findUserByName", "Names no path, only `findUserByName`.");
  assert.equal(capFixtureFindings(content, diff, [], ["test/fixtures/"]).content, content);
});

test("cap: context paths join the PR path set", () => {
  const content = finding("critical", "Bad findUserByName", "Names no path, only `findUserByName`.");
  const out = capFixtureFindings(content, fixtureDiff, ["src/ctx.js"], ["test/fixtures/"]);
  assert.equal(out.content, content, "a real-code context file means the PR is not fixture-only");
});

test("cap: eval/ runners stay critical even beside eval/cases/ fixtures", () => {
  const diff = fileDiff("eval/cases/refutation-code-006.json", ["{\"x\": \"gradeWidget\"}"]) +
    fileDiff("eval/grader.mjs", ["export function gradeThing() {}"], { status: "changed" });
  const content = finding("critical", "Broken gradeThing", "Names eval/grader.mjs.");
  const out = capFixtureFindings(content, diff, [], ["eval/cases/"]);
  assert.equal(out.content, content);
});

test("the cap set equals the autonomous-escalation set and the SKILL.md names it", () => {
  assert.deepEqual([...FIXTURE_CAP_SEVERITIES], ["critical"]);
  const skill = readFileSync(ADVERSARIAL_SKILL, "utf8");
  assert.match(skill, /ESCALATE_SEVERITIES = \{ critical \}/);
  assert.match(skill, /FIXTURE_CAP_SEVERITIES/);
});

test("FAFF-1266 replay: the recorded critical on finding-identity-011.json leaves no critical section", () => {
  const diff = readFileSync(join(here, "fixtures/faff-1266-merge-diff.patch"), "utf8");
  const content = [
    "## Adversarial findings - x/y",
    "",
    "### critical: SQL injection in findUserByName, caller input concatenated into the query string",
    "The new `findUserByName` builds its query by concatenating `name` into the SQL string, as shown in eval/cases-live/finding-identity-011.json.",
    "",
    "### minor: Unrelated style note",
    "Nothing to see in eval/grader.mjs.",
  ].join("\n");
  const { content: out, caps } = capFixtureFindings(content, diff, [], REPO_PREFIXES);
  assert.match(out, /^### minor: \[fixture-data\] SQL injection in findUserByName, caller input concatenated into the query string$/m);
  assert.match(out, /^> fixture-data: located only in fixture path\(s\) eval\/cases-live\/finding-identity-011\.json;/m);
  assert.doesNotMatch(out, /^### critical:/m);
  assert.equal(caps.length, 1);
  assert.match(out, /### minor: Unrelated style note\nNothing to see in eval\/grader\.mjs\.$/);
});

function writeInputs(dir, diffText) {
  mkdirSync(dir, { recursive: true });
  const sys = join(dir, "sys.txt");
  const diff = join(dir, "d.patch");
  writeFileSync(sys, "LENS");
  writeFileSync(diff, diffText);
  return { sys, diff };
}

async function runMain(argv, content) {
  const outW = process.stdout.write.bind(process.stdout);
  const errW = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  let code;
  try {
    code = await main(argv, { runReviewFn: async () => ({ status: "ok", content, truncated: false }) });
  } finally {
    process.stdout.write = outW;
    process.stderr.write = errW;
  }
  return { code, out, err };
}

test("main(): --fixture-path caps the finding and writes one capped: line to stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-fixture-main-"));
  try {
    const { sys, diff } = writeInputs(dir, fixtureDiff);
    const content = finding("critical", "Bad findUserByName", `Names ${FIXTURE}.`) + finding("critical", "Second findUserByName", `Names ${FIXTURE} again.`);
    const base = ["--host", "https://h/v1", "--model", "m", "--system", sys, "--diff", diff, "--host-source", "config"];
    const { code, out, err } = await runMain([...base, "--fixture-path", "test/fixtures"], content);
    assert.equal(code, EXIT.OK, err);
    assert.doesNotMatch(out, /### critical:/);
    assert.equal(err.split("\n").filter((l) => l.startsWith("capped: ")).length, 2);
    assert.match(err, /capped: "Bad findUserByName" \(fixture data in test\/fixtures\/case\.json\); critical → minor/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("main(): with no --fixture-path, or with --expect contract, the output is unchanged", async () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-fixture-main-"));
  try {
    const { sys, diff } = writeInputs(dir, fixtureDiff);
    const content = finding("critical", "Bad findUserByName", `Names ${FIXTURE}.`);
    const base = ["--host", "https://h/v1", "--model", "m", "--system", sys, "--diff", diff, "--host-source", "config"];

    const plain = await runMain(base, content);
    assert.match(plain.out, /### critical: Bad findUserByName/);
    assert.doesNotMatch(plain.err, /capped:/);

    const contract = await runMain([...base, "--expect", "contract", "--fixture-path", "test/fixtures/"], content);
    assert.equal(contract.out, content.trim() + "\n");
    assert.doesNotMatch(contract.err, /capped:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseArgs: --fixture-path is repeatable and normalised", () => {
  const a = parseArgs(["--fixture-path", "eval/cases", "--fixture-path", "./test/fixtures/", "--fixture-path", ""]);
  assert.deepEqual(a.fixturePaths, ["eval/cases/", "test/fixtures/"]);
  assert.deepEqual(parseArgs([]).fixturePaths, []);
});
