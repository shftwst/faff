// FAFF-1263: `faff evidence-readiness`, the measurable exit criterion for the warn-only period.
// Every test builds a throwaway git repo; nothing reads the real .faff/anchors.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli } from "./helpers/run-cli.mjs";
import { example, repoRoot } from "./helpers/evidence-anchor-fixtures.mjs";

const WRITERS = ["FAFF-1266", "FAFF-1268", "FAFF-1267", "FAFF-1258", "FAFF-1259", "FAFF-1260"];
const BEEP = "run-20261014-100000-beepboop-list-aaaaaa";
const GRAFT = "run-20261014-090000-graft-FAFF-9";
const oneLine = (name) => JSON.stringify(JSON.parse(example(name))) + "\n";

// Every routine and writer-proof file, built from the shipped v0.3 valid examples.
const FULL = {
  "events.jsonl": oneLine("run-event"),
  "declared-effects.jsonl": oneLine("declared-effect"),
  "run-ledger.json": example("run-ledger"),
  "build-progress.json": example("build-progress"),
  "ac-checklist.json": example("ac-checklist"),
  "review-verdict.json": example("review-verdict-anchored"),
  "chain-head.json": example("chain-head"),
  "effects-chain-head.json": example("chain-head"),
  "spec-review-verdict.json": example("spec-review-verdict-anchored"),
  "holdout.json": example("holdout-anchored"),
};
const without = (...names) => Object.fromEntries(Object.entries(FULL).filter(([k]) => !names.includes(k)));

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-1263-ready-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: process.env.GIT_AUTHOR_DATE ?? "", GIT_COMMITTER_DATE: process.env.GIT_COMMITTER_DATE ?? "" } }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  const write = (rel, content) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  };
  const commit = (subject, files = {}) => {
    for (const [rel, content] of Object.entries(files)) write(rel, content);
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", subject);
    return git("rev-parse", "HEAD");
  };
  const anchor = (run, issue, files) => Object.fromEntries(Object.entries(files).map(([n, c]) => [`.faff/anchors/${run}/${issue}/${n}`, c]));
  const writers = () => Object.fromEntries(WRITERS.map((w) => [w, commit(`feat: writer (${w}) (#1)`)]));
  const readiness = (args, opts = {}) => runCli(["evidence-readiness", ...args], { cwd: opts.cwd ?? dir });
  return { dir, git, write, commit, anchor, writers, readiness, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function parse(r) { return JSON.parse(r.stdout); }

// The spec's scenario: six writers, a legacy graft anchor, then two conforming beep-boop anchors.
function scenario(repo) {
  const w = repo.writers();
  const graft = repo.commit("feat: graft change (FAFF-9) (#2)", repo.anchor(GRAFT, "FAFF-9", { "events.jsonl": oneLine("run-event"), "ac-checklist.json": JSON.stringify({ all_verified: true }) }));
  repo.commit("feat: ten (FAFF-10) (#3)", repo.anchor(BEEP, "FAFF-10", FULL));
  repo.commit("feat: eleven (FAFF-11) (#4)", repo.anchor(BEEP, "FAFF-11", without("holdout.json")));
  return { w, graft };
}

test("scenario: a legacy graft anchor blocks, moving the cutover past it makes the window ready", () => {
  const repo = makeRepo();
  try {
    const { w, graft } = scenario(repo);
    const r = repo.readiness(["--since", w["FAFF-1260"], "--json"]);
    assert.equal(r.code, 1, r.stderr);
    const report = parse(r);
    assert.equal(report.warnings, 1);
    assert.equal(report.window_anchors, 3);
    assert.equal(report.runs.find((x) => x.run === BEEP).qualifying, true);
    assert.ok(report.unmet.some((u) => u.includes("warning")));
    assert.deepEqual(report.warning_anchors.map((x) => [x.anchor, x.status]), [[`${GRAFT}/FAFF-9`, "legacy"]]);
    for (const issue of WRITERS) assert.equal(report.writers.find((x) => x.issue === issue).commit, w[issue]);
    assert.equal(report.since, w["FAFF-1260"]);
    assert.equal(report.head, repo.git("rev-parse", "HEAD"));
    assert.equal(report.spec_version, "v0.3");

    const ok = repo.readiness(["--since", graft, "--json"]);
    assert.equal(ok.code, 0, ok.stdout);
    const okReport = parse(ok);
    assert.equal(okReport.ready, true);
    assert.equal(okReport.warnings, 0);
    assert.deepEqual(okReport.unmet, []);

    const late = repo.readiness(["--since", w["FAFF-1258"], "--json"]);
    assert.equal(late.code, 1);
    const unmet = parse(late).unmet.join("\n");
    assert.match(unmet, /writer FAFF-1259 merged after --since/);
    assert.match(unmet, /writer FAFF-1260 merged after --since/);
  } finally { repo.cleanup(); }
});

test("a fail anchor with several bad files counts as one warning, a legacy one as one", () => {
  const repo = makeRepo();
  try {
    const w = repo.writers();
    repo.commit("feat: (FAFF-1)", repo.anchor(BEEP, "FAFF-1", { ...FULL, "ac-checklist.json": "{}", "review-verdict.json": "{}", "build-progress.json": "{}" }));
    const report = parse(repo.readiness(["--since", w["FAFF-1260"], "--json"]));
    assert.equal(report.warnings, 1);
    assert.equal(report.warning_anchors[0].status, "fail");
    assert.deepEqual(report.warning_anchors[0].files.sort(), ["ac-checklist.json", "build-progress.json", "review-verdict.json"]);
  } finally { repo.cleanup(); }
});

test("ready follows the constraint: empty window, no qualifying run, unobserved routine and writer-proof files", () => {
  const repo = makeRepo();
  try {
    const w = repo.writers();
    const since = w["FAFF-1260"];
    const empty = repo.readiness(["--since", since, "--json"]);
    assert.equal(empty.code, 1);
    assert.match(parse(empty).unmet.join("\n"), /no anchors in window/);

    repo.commit("feat: (FAFF-1)", repo.anchor(GRAFT, "FAFF-1", FULL));
    const noRun = parse(repo.readiness(["--since", since, "--json"]));
    assert.equal(noRun.ready, false);
    assert.match(noRun.unmet.join("\n"), /no qualifying beep-boop run/);
    assert.equal(noRun.writer_proof_files["holdout.json"].observed, true);
    assert.equal(noRun.routine_files["build-progress.json"].observed, false);

    repo.commit("feat: (FAFF-2)", repo.anchor(BEEP, "FAFF-2", without("build-progress.json", "holdout.json")));
    const noBuild = parse(repo.readiness(["--since", since, "--json"]));
    assert.equal(noBuild.runs.find((r) => r.run === BEEP).qualifying, true);
    assert.equal(noBuild.routine_files["build-progress.json"].observed, false);
    assert.match(noBuild.unmet.join("\n"), /routine file build-progress\.json not observed/);
    assert.equal(noBuild.ready, false);
  } finally { repo.cleanup(); }
});

test("a window without holdout.json is not ready, and one interactive-graft anchor carrying it satisfies the clause", () => {
  const repo = makeRepo();
  try {
    const w = repo.writers();
    repo.commit("feat: (FAFF-1)", repo.anchor(BEEP, "FAFF-1", without("holdout.json", "spec-review-verdict.json")));
    const missing = parse(repo.readiness(["--since", w["FAFF-1260"], "--json"]));
    assert.match(missing.unmet.join("\n"), /writer-proof file holdout\.json not observed in window/);
    repo.commit("feat: (FAFF-2)", repo.anchor("run-20261014-110000-interactive-FAFF-2", "FAFF-2", { "holdout.json": FULL["holdout.json"], "spec-review-verdict.json": FULL["spec-review-verdict.json"] }));
    const r = repo.readiness(["--since", w["FAFF-1260"], "--json"]);
    const report = parse(r);
    assert.equal(report.writer_proof_files["holdout.json"].observed, true);
    assert.ok(!report.unmet.some((u) => u.includes("holdout.json")));
  } finally { repo.cleanup(); }
});

test("writer matching: exact parenthesised ticket, two tickets in one subject, newest first-parent wins, no skip flag", () => {
  const repo = makeRepo();
  try {
    const a = repo.commit("feat: (FAFF-12660) not it");
    const first = repo.commit("feat: old (FAFF-1266)", {});
    const second = repo.commit("feat: both (FAFF-1266) (FAFF-1267)");
    for (const w of ["FAFF-1268", "FAFF-1258", "FAFF-1259", "FAFF-1260"]) repo.commit(`feat: (${w})`);
    const report = parse(repo.readiness(["--since", "HEAD", "--json"]));
    assert.deepEqual(report.writers.map((x) => x.issue), ["FAFF-1266", "FAFF-1267", "FAFF-1268", "FAFF-1258", "FAFF-1259", "FAFF-1260"]);
    assert.equal(report.writers[0].commit, second);
    assert.equal(report.writers[1].commit, second);
    assert.notEqual(report.writers[0].commit, a);
    assert.notEqual(report.writers[0].commit, first);
    assert.ok(!report.writers.some((x) => x.issue === "FAFF-1257"));
    assert.equal(runCli(["evidence-readiness", "--since", "HEAD", "--skip-writers"], { cwd: repo.dir }).code, 2);
  } finally { repo.cleanup(); }
});

test("a writer with no matching first-parent commit makes ready false and is named", () => {
  const repo = makeRepo();
  try {
    for (const w of WRITERS.slice(1)) repo.commit(`feat: (${w})`);
    repo.commit("feat: (FAFF-1)", repo.anchor(BEEP, "FAFF-1", FULL));
    const report = parse(repo.readiness(["--since", "HEAD~1", "--json"]));
    assert.equal(report.writers[0].commit, null);
    assert.equal(report.ready, false);
    assert.match(report.unmet.join("\n"), /writer FAFF-1266 has no merge commit/);
  } finally { repo.cleanup(); }
});

test("the newer first-parent commit is reported even when its author date is older", () => {
  const repo = makeRepo();
  try {
    repo.commit("feat: new (FAFF-1266)");
    const env = { ...process.env, GIT_AUTHOR_DATE: "2001-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2001-01-01T00:00:00Z" };
    execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "feat: nearer HEAD (FAFF-1266)"], { cwd: repo.dir, env });
    const nearer = repo.git("rev-parse", "HEAD");
    const report = parse(repo.readiness(["--since", "HEAD", "--json"]));
    assert.equal(report.writers[0].commit, nearer);
  } finally { repo.cleanup(); }
});

test("usage and environment errors exit 2", () => {
  const repo = makeRepo();
  const outside = mkdtempSync(path.join(tmpdir(), "faff-1263-nogit-"));
  try {
    repo.commit("init");
    assert.equal(repo.readiness(["--since", "no-such-rev"]).code, 2);
    assert.equal(repo.readiness(["--since", "-x"]).code, 2);
    assert.equal(repo.readiness([]).code, 2);
    assert.equal(runCli(["evidence-readiness", "--since", "HEAD"], { cwd: outside }).code, 2);
    assert.equal(repo.readiness(["--since", "HEAD", "--anchors-root", outside]).code, 2);
    assert.equal(repo.readiness(["--since", "HEAD", "--anchors-root", "../elsewhere"]).code, 2);
  } finally { repo.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("exit 2 when the bundled manifest is unavailable, even with an empty window", () => {
  const repo = makeRepo();
  const copy = mkdtempSync(path.join(tmpdir(), "faff-1263-plugin-"));
  try {
    repo.commit("init");
    execFileSync("cp", ["-R", path.join(repoRoot, "plugin", "skills", "faff"), path.join(copy, "faff")]);
    rmSync(path.join(copy, "faff", "contracts", "evidence-v0.3", "anchor-manifest.json"));
    const r = execFileSync(process.execPath, ["-e", `process.exitCode = require(${JSON.stringify(path.join(copy, "faff", "bin", "lib", "evidence-readiness.js"))}).cmdEvidenceReadiness(["--since","HEAD"])`], { cwd: repo.dir, stdio: "pipe", encoding: "utf8" });
    assert.fail(`expected a non-zero exit, got ${r}`);
  } catch (e) {
    if (e.code === "ERR_ASSERTION") throw e;
    assert.equal(e.status, 2, String(e.stderr));
  } finally { repo.cleanup(); rmSync(copy, { recursive: true, force: true }); }
});

test("dirty or untracked anchors root and an escaping symlinked root exit 2", () => {
  const repo = makeRepo();
  const outside = mkdtempSync(path.join(tmpdir(), "faff-1263-out-"));
  try {
    const w = repo.writers();
    repo.commit("feat: (FAFF-1)", repo.anchor(BEEP, "FAFF-1", FULL));
    const since = w["FAFF-1260"];
    repo.write(`.faff/anchors/${BEEP}/FAFF-1/ac-checklist.json`, "{}");
    const dirty = repo.readiness(["--since", since]);
    assert.equal(dirty.code, 2);
    assert.match(dirty.stderr, /uncommitted changes/);
    repo.git("checkout", "--", ".");
    repo.write(`.faff/anchors/${BEEP}/FAFF-1/untracked.txt`, "x");
    assert.equal(repo.readiness(["--since", since]).code, 2);
    rmSync(path.join(repo.dir, `.faff/anchors/${BEEP}/FAFF-1/untracked.txt`));
    symlinkSync(outside, path.join(repo.dir, "linked-root"));
    assert.equal(repo.readiness(["--since", since, "--anchors-root", "linked-root"]).code, 2);
    symlinkSync(path.join(outside, "missing"), path.join(repo.dir, "dangling-root"));
    assert.equal(repo.readiness(["--since", since, "--anchors-root", "dangling-root"]).code, 2);
  } finally { repo.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("a README under the anchors root is ignored, a symlink-escape anchor is dropped, an added-then-deleted anchor is neither", () => {
  const repo = makeRepo();
  const outside = mkdtempSync(path.join(tmpdir(), "faff-1263-out-"));
  try {
    const w = repo.writers();
    repo.commit("docs: readme", { ".faff/anchors/README.md": "hello" });
    repo.commit("feat: gone (FAFF-3)", repo.anchor(BEEP, "FAFF-3", FULL));
    repo.git("rm", "-rq", `.faff/anchors/${BEEP}/FAFF-3`);
    repo.git("commit", "-qm", "chore: remove");
    repo.commit("feat: esc (FAFF-4)", repo.anchor(BEEP, "FAFF-4", FULL));
    repo.git("rm", "-rq", `.faff/anchors/${BEEP}/FAFF-4`);
    mkdirSync(path.join(repo.dir, ".faff/anchors", BEEP), { recursive: true });
    symlinkSync(outside, path.join(repo.dir, `.faff/anchors/${BEEP}/FAFF-4`));
    repo.git("add", "-A");
    repo.git("commit", "-qm", "chore: swap for a symlink");
    const report = parse(repo.readiness(["--since", w["FAFF-1260"], "--json"]));
    assert.ok(report.ignored.some((x) => x.path === ".faff/anchors/README.md"));
    assert.ok(report.ignored.every((x) => x.path.split("/").length < 5));
    assert.equal(report.dropped.length, 1);
    assert.match(report.dropped[0].path, /FAFF-4/);
    assert.equal(report.ready, false);
    assert.equal(report.window_anchors, 0);
  } finally { repo.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("a newline or | in an added path is dropped and blocks", () => {
  const repo = makeRepo();
  try {
    const w = repo.writers();
    repo.commit("feat: (FAFF-1)", { ...repo.anchor(BEEP, "FAFF-1", FULL), [`.faff/anchors/${BEEP}/FAFF-1/we|rd.txt`]: "x", [`.faff/anchors/${BEEP}/FAFF-1/new\nline.txt`]: "x" });
    const report = parse(repo.readiness(["--since", w["FAFF-1260"], "--json"]));
    assert.equal(report.dropped.length, 2);
    assert.ok(report.dropped.every((d) => d.reason === "unsafe path characters"));
    assert.ok(report.dropped.every((d) => !d.path.includes("\n")));
    assert.equal(report.ready, false);
  } finally { repo.cleanup(); }
});

test("an anchor added before the cutover is not counted; one added then deleted is not counted", () => {
  const repo = makeRepo();
  try {
    repo.commit("feat: old (FAFF-1)", repo.anchor(GRAFT, "FAFF-1", { "events.jsonl": oneLine("run-event") }));
    const w = repo.writers();
    const report = parse(repo.readiness(["--since", w["FAFF-1260"], "--json"]));
    assert.equal(report.window_anchors, 0);
    assert.equal(report.warnings, 0);
  } finally { repo.cleanup(); }
});

test("the report is the same from a subdirectory and with an absolute --anchors-root", () => {
  const repo = makeRepo();
  try {
    const { w } = scenario(repo);
    const since = w["FAFF-1260"];
    const root = parse(repo.readiness(["--since", since, "--json"]));
    mkdirSync(path.join(repo.dir, "sub", "deeper"), { recursive: true });
    const sub = parse(repo.readiness(["--since", since, "--json"], { cwd: path.join(repo.dir, "sub", "deeper") }));
    assert.deepEqual(sub, root);
    const abs = parse(repo.readiness(["--since", since, "--anchors-root", path.join(repo.dir, ".faff", "anchors"), "--json"]));
    assert.deepEqual(abs, root);
  } finally { repo.cleanup(); }
});

test("binding: an anchor added under a subject not naming its issue is unbound, does not qualify and proves nothing", () => {
  const repo = makeRepo();
  try {
    const w = repo.writers();
    const since = w["FAFF-1260"];
    repo.commit("feat: unrelated work", repo.anchor("run-20261014-100000-beepboop-list-x", "FAFF-9", FULL));
    let report = parse(repo.readiness(["--since", since, "--json"]));
    assert.deepEqual(report.unbound_anchors.map((u) => u.anchor), ["run-20261014-100000-beepboop-list-x/FAFF-9"]);
    assert.equal(report.runs[0].qualifying, false);
    assert.equal(report.writer_proof_files["holdout.json"].observed, false);

    repo.commit("feat: names a longer id (FAFF-90)", repo.anchor("run-20261014-100001-beepboop-list-y", "FAFF-9", FULL));
    report = parse(repo.readiness(["--since", since, "--json"]));
    assert.equal(report.unbound_anchors.length, 2);

    repo.commit("feat: binds (FAFF-9) (#1)", repo.anchor("run-20261014-100002-beepboop-list-z", "FAFF-9", FULL));
    report = parse(repo.readiness(["--since", since, "--json"]));
    assert.equal(report.runs.find((r) => r.run.endsWith("-z")).qualifying, true);
    assert.equal(report.unbound_anchors.length, 2);
  } finally { repo.cleanup(); }
});

test("a straddling run is not qualifying and its legacy anchor is listed", () => {
  const repo = makeRepo();
  try {
    const w = repo.writers();
    repo.commit("feat: (FAFF-1)", repo.anchor(BEEP, "FAFF-1", FULL));
    repo.commit("feat: (FAFF-2)", repo.anchor(BEEP, "FAFF-2", { "events.jsonl": oneLine("run-event") }));
    const report = parse(repo.readiness(["--since", w["FAFF-1260"], "--json"]));
    assert.equal(report.runs.find((r) => r.run === BEEP).qualifying, false);
    assert.deepEqual(report.warning_anchors.map((x) => x.anchor), [`${BEEP}/FAFF-2`]);
  } finally { repo.cleanup(); }
});

test("the drop decision never reads deriveAnchorDirs's reason text", () => {
  const repo = makeRepo();
  const outside = mkdtempSync(path.join(tmpdir(), "faff-1263-out-"));
  try {
    const w = repo.writers();
    repo.commit("docs: readme", { ".faff/anchors/README.md": "hello" });
    repo.commit("feat: esc (FAFF-4)", repo.anchor(BEEP, "FAFF-4", FULL));
    repo.git("rm", "-rq", `.faff/anchors/${BEEP}/FAFF-4`);
    mkdirSync(path.join(repo.dir, ".faff/anchors", BEEP), { recursive: true });
    symlinkSync(outside, path.join(repo.dir, `.faff/anchors/${BEEP}/FAFF-4`));
    repo.git("add", "-A");
    repo.git("commit", "-qm", "swap");
    const script = `
      const gov = require(${JSON.stringify(path.join(repoRoot, "plugin/skills/faff/bin/lib/governance-check.js"))});
      const real = gov.deriveAnchorDirs;
      gov.deriveAnchorDirs = (...a) => { const r = real(...a); return { dirs: r.dirs, dropped: r.dropped.map((d) => ({ path: d.path, reason: "XYZ" })) }; };
      process.exitCode = require(${JSON.stringify(path.join(repoRoot, "plugin/skills/faff/bin/lib/evidence-readiness.js"))}).cmdEvidenceReadiness(["--since", ${JSON.stringify(w["FAFF-1260"])}, "--json"]);`;
    let out;
    try { out = execFileSync(process.execPath, ["-e", script], { cwd: repo.dir, encoding: "utf8" }); } catch (e) { out = e.stdout; }
    const report = JSON.parse(out);
    assert.ok(report.ignored.some((x) => x.path === ".faff/anchors/README.md"));
    assert.ok(report.ignored.every((x) => x.path.split("/").length < 5));
    assert.equal(report.dropped.length, 1);
    assert.equal(report.dropped[0].reason, "XYZ");
  } finally { repo.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test("git is only invoked through execFileSync with argument arrays", () => {
  const src = readFileSync(path.join(repoRoot, "plugin/skills/faff/bin/lib/evidence-readiness.js"), "utf8");
  assert.match(src, /execFileSync\("git", args/);
  assert.ok(!/\bexecSync\b|\bexec\(|shell:\s*true|spawnSync\(["'`]git/.test(src));
});

test("no sentinel planted in an evidence field reaches readiness output", () => {
  const repo = makeRepo();
  try {
    const w = repo.writers();
    repo.commit("feat: (FAFF-1)", repo.anchor(BEEP, "FAFF-1", {
      ...FULL,
      "events.jsonl": JSON.stringify({ schema: "S3CR3T-SENTINEL" }) + "\n",
      "ac-checklist.json": JSON.stringify({ schema_version: 1, all_verified: "S3CR3T-SENTINEL" }),
    }));
    for (const args of [["--json"], []]) {
      const r = repo.readiness(["--since", w["FAFF-1260"], ...args]);
      assert.ok(!(r.stdout + r.stderr).includes("S3CR3T-SENTINEL"));
    }
  } finally { repo.cleanup(); }
});

test("the cli doc carries the readiness row and the enforcement hand-off (ticket ids stay out of docs/guide: lint-refs)", () => {
  const doc = readFileSync(path.join(repoRoot, "docs/guide/cli.md"), "utf8");
  const row = doc.split("\n").find((l) => l.startsWith("| `evidence-readiness --since <rev>"));
  assert.ok(row);
  assert.match(row, /requires `faff evidence-readiness --since <rev>` to exit 0 at the commit it branches from and again at its own head/);
  assert.match(row, /one beep-boop list run and one graft run with a holdout scenario/);
  assert.match(doc, /report-only `evidence_schema` leg/);
});

test("human output names READY or NOT READY and each unmet reason", () => {
  const repo = makeRepo();
  try {
    const w = repo.writers();
    const r = repo.readiness(["--since", w["FAFF-1260"]]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^evidence-readiness since [0-9a-f]{12}: NOT READY\n/);
    assert.match(r.stdout, /unmet: no anchors in window/);
  } finally { repo.cleanup(); }
});
