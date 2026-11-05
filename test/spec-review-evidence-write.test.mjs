// FAFF-1467 — `faff spec-review collate-evidence --comment` writes spec-review-verdict.json itself, and
// `faff spec-review write-evidence` gives the paths-only carry the same write. Each test builds a temp git
// root holding `.faff/runs` and `.faff/spec-review`, then drives the real CLI (or the placement function
// in-process from that root).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { WriterFault, guardWriterPaths, placeSpecReviewEvidence } = require("../plugin/skills/faff/bin/lib/evidence.js");
const { collateSpecReviewRounds } = require("../plugin/skills/faff/bin/lib/evidence-collate.js");
const { specReviewDir } = require("../plugin/skills/faff/bin/lib/spec-review-pin.js");
const { cmdSpecReview } = require("../plugin/skills/faff/bin/lib/spec-review.js");

const ISSUE = "FAFF-9";
const WARNING = "faff spec-review collate-evidence: warning: spec-review-verdict.json not written:";
const obj = (lens, severity = "major") => ({ lens, severity, claim: "c" });
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "faff-sre-write-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const runDir = join(root, ".faff", "runs", "run-X");
  const runScratch = join(runDir, ISSUE, "spec-review");
  const interactive = join(root, ".faff", "spec-review", ISSUE);
  mkdirSync(runScratch, { recursive: true });
  mkdirSync(interactive, { recursive: true });
  const rounds = (dir) => {
    writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "revise", objections: [obj("architectural")] }));
    writeFileSync(join(dir, "round-2.json"), JSON.stringify({ verdict: "approve", objections: [] }));
  };
  rounds(runScratch);
  rounds(interactive);
  const dispositions = join(root, "d.json");
  writeFileSync(dispositions, JSON.stringify([{ key: "1#0", lens: "architectural", disposition: "fixed" }]));
  const cli = (args, opts = {}) => runCli(args, { cwd: root, ...opts });
  const collate = (dir, ...extra) => cli(["spec-review", "collate-evidence", "--dir", dir, ...extra]);
  const comment = (dir) => {
    const c = collate(dir, "--dispositions", dispositions, "--comment");
    assert.equal(c.code, 0, c.stderr);
    return c.stdout;
  };
  const writeEvidence = (dir, text, opts = {}) => {
    const file = join(root, "comment.md");
    writeFileSync(file, text);
    return cli(["spec-review", "write-evidence", "--dir", dir, "--file", file], opts);
  };
  const file = (dir) => join(dir, "spec-review-verdict.json");
  return { root, runDir, runScratch, interactive, dispositions, cli, collate, comment, writeEvidence, file, runTarget: join(runDir, ISSUE) };
}

const runCommentOf = (f) => f.comment(f.runScratch);
const lines = (s, prefix) => s.split("\n").filter((l) => l.startsWith(prefix));

test("run mode: --comment prints the comment, exits 0 and leaves the file, byte-equal to the evidence-write replay", (t) => {
  const f = fixture(t);
  const c = f.collate(f.runScratch, "--dispositions", f.dispositions, "--comment");
  assert.equal(c.code, 0, c.stderr);
  assert.match(c.stdout, /^## Spec-review evidence/m);
  assert.match(c.stdout, /^sha256: [0-9a-f]{64}$/m);
  assert.deepEqual(lines(c.stderr, "faff spec-review collate-evidence: wrote "), [`faff spec-review collate-evidence: wrote ${f.file(f.runTarget)}`]);
  assert.ok(existsSync(f.file(f.runTarget)));
  const other = join(f.root, ".faff", "runs", "run-Y");
  mkdirSync(join(other, ISSUE), { recursive: true });
  const replay = f.cli(["evidence", "write", "spec-review-verdict", "--run-dir", other, "--issue", ISSUE], { input: c.stdout });
  assert.equal(replay.code, 0, replay.stderr);
  assert.equal(readFileSync(f.file(f.runTarget), "utf8"), readFileSync(f.file(join(other, ISSUE)), "utf8"));
});

test("stdout of --comment is the rendered comment alone, and the file digest matches its block", (t) => {
  const f = fixture(t);
  const c = f.collate(f.runScratch, "--dispositions", f.dispositions, "--comment");
  const block = c.stdout.split("\n").find((l) => l.startsWith("{"));
  assert.equal(c.stdout.match(/^sha256: (\w+)$/m)[1], sha(block));
  assert.ok(!c.stdout.includes("wrote "));
});

test("the integration smoke: a replay of the printed comment leaves the written file unchanged", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  const before = readFileSync(f.file(f.runTarget), "utf8");
  assert.equal(f.cli(["evidence", "write", "spec-review-verdict", "--run-dir", f.runDir, "--issue", ISSUE], { input: text }).code, 0);
  assert.equal(readFileSync(f.file(f.runTarget), "utf8"), before);
});

test("interactive mode: --comment writes schema_version 1 into the scratch dir", (t) => {
  const f = fixture(t);
  const c = f.collate(".faff/spec-review/" + ISSUE, "--dispositions", f.dispositions, "--comment");
  assert.equal(c.code, 0, c.stderr);
  assert.equal(JSON.parse(readFileSync(f.file(f.interactive), "utf8")).schema_version, 1);
  assert.equal(lines(c.stderr, "faff spec-review collate-evidence: wrote ").length, 1);
});

test("a relative --dir places correctly when the command runs from a subdirectory", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  rmSync(f.file(f.interactive), { force: true });
  const sub = join(f.root, "pkg", "deep");
  mkdirSync(sub, { recursive: true });
  const w = f.cli(["spec-review", "write-evidence", "--dir", ".faff/spec-review/" + ISSUE, "--file", "-"], { cwd: sub, input: text });
  assert.equal(w.code, 0, w.stderr);
  assert.ok(existsSync(f.file(f.interactive)));
  assert.ok(!existsSync(join(sub, ".faff")));
});

test("plain mode (no --comment) writes no file in either layout", (t) => {
  const f = fixture(t);
  assert.equal(f.collate(f.runScratch).code, 0);
  assert.equal(f.collate(f.interactive).code, 0);
  assert.equal(f.collate(f.runScratch, "--dispositions", f.dispositions).code, 0);
  assert.ok(!existsSync(f.file(f.runTarget)));
  assert.ok(!existsSync(f.file(f.interactive)));
  assert.ok(!existsSync(f.file(f.runScratch)));
});

test("a symlinked .faff/spec-review warns, exits 0, prints the comment and writes nothing in the link target", (t) => {
  const f = fixture(t);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "faff-sre-outside-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(outside, ISSUE));
  writeFileSync(join(outside, ISSUE, "round-1.json"), JSON.stringify({ verdict: "revise", objections: [obj("architectural")] }));
  writeFileSync(join(outside, ISSUE, "round-2.json"), JSON.stringify({ verdict: "approve", objections: [] }));
  rmSync(join(f.root, ".faff", "spec-review"), { recursive: true });
  symlinkSync(outside, join(f.root, ".faff", "spec-review"));
  const c = f.collate(".faff/spec-review/" + ISSUE, "--dispositions", f.dispositions, "--comment");
  assert.equal(c.code, 0, c.stderr);
  assert.match(c.stdout, /^## Spec-review evidence/m);
  assert.equal(lines(c.stderr, WARNING).length, 1);
  assert.ok(!existsSync(join(outside, ISSUE, "spec-review-verdict.json")));
  assert.ok(!existsSync(join(outside, "spec-review-verdict.json")));
});

test("a placement fault leaves an earlier file untouched (no target is known)", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  const before = readFileSync(f.file(f.runTarget), "utf8");
  const stray = join(f.root, "stray");
  mkdirSync(stray);
  writeFileSync(join(stray, "round-1.json"), JSON.stringify({ verdict: "approve", objections: [] }));
  const c = f.collate(stray, "--comment");
  assert.equal(c.code, 0);
  assert.equal(lines(c.stderr, WARNING).length, 1);
  assert.equal(readFileSync(f.file(f.runTarget), "utf8"), before);
  assert.ok(text.length > 0);
});

test("a run dir outside .faff/runs warns and still prints the comment", (t) => {
  const f = fixture(t);
  const scratch = join(f.root, "elsewhere", "run-Z", ISSUE, "spec-review");
  mkdirSync(scratch, { recursive: true });
  writeFileSync(join(scratch, "round-1.json"), JSON.stringify({ verdict: "approve", objections: [] }));
  const c = f.collate(scratch, "--comment");
  assert.equal(c.code, 0, c.stderr);
  assert.match(c.stdout, /^## Spec-review evidence/m);
  assert.match(c.stderr, /warning: spec-review-verdict.json not written: --run-dir is not inside \.faff\/runs\//);
  assert.ok(!existsSync(join(scratch, "..", "spec-review-verdict.json")));
});

test("the terminal seam run twice leaves one file matching the latest comment", (t) => {
  const f = fixture(t);
  const first = runCommentOf(f);
  const bytes = readFileSync(f.file(f.runTarget), "utf8");
  assert.equal(runCommentOf(f), first);
  assert.equal(readFileSync(f.file(f.runTarget), "utf8"), bytes);
  writeFileSync(join(f.runScratch, "round-3.json"), JSON.stringify({ verdict: "revise", objections: [obj("QA")] }));
  writeFileSync(join(f.runScratch, "round-4.json"), JSON.stringify({ verdict: "approve", objections: [] }));
  writeFileSync(f.dispositions, JSON.stringify([{ key: "1#0", lens: "architectural", disposition: "fixed" }, { key: "3#0", lens: "QA", disposition: "fixed" }]));
  runCommentOf(f);
  assert.equal(JSON.parse(readFileSync(f.file(f.runTarget), "utf8")).rounds_total, 4);
  assert.deepEqual(readdirSync(f.runTarget).sort(), ["spec-review", "spec-review-verdict.json"]);
});

test("write-evidence: exit 0 and the path on stdout for a carry comment, from a file and from stdin", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  rmSync(f.file(f.runTarget));
  const w = f.writeEvidence(f.runScratch, text);
  assert.equal(w.code, 0, w.stderr);
  assert.equal(w.stdout.trim(), f.file(f.runTarget));
  const viaStdin = f.cli(["spec-review", "write-evidence", "--dir", f.interactive, "--file", "-"], { input: text });
  assert.equal(viaStdin.code, 0, viaStdin.stderr);
  assert.equal(viaStdin.stdout.trim(), f.file(f.interactive));
  assert.equal(readFileSync(f.file(f.runTarget), "utf8"), readFileSync(f.file(f.interactive), "utf8"));
});

test("write-evidence: a digest mismatch exits 1 with refused: and removes an earlier file", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  assert.ok(existsSync(f.file(f.runTarget)));
  const edited = text.replace(/^sha256: .*$/m, `sha256: ${"0".repeat(64)}`);
  const w = f.writeEvidence(f.runScratch, edited);
  assert.equal(w.code, 1);
  assert.match(w.stderr, /^refused: digest mismatch/m);
  assert.ok(!existsSync(f.file(f.runTarget)));
  assert.equal(readdirSync(f.runTarget).includes("spec-review-verdict.stale.json"), false);
});

test("write-evidence: a refusal with no earlier file writes nothing; a missing section exits 1", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  rmSync(f.file(f.runTarget));
  const bad = f.writeEvidence(f.runScratch, text.replace(/^sha256: .*$/m, `sha256: ${"1".repeat(64)}`));
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /refused: digest mismatch/);
  assert.ok(!existsSync(f.file(f.runTarget)));
  const none = f.writeEvidence(f.runScratch, "# just a spec\n");
  assert.equal(none.code, 1);
  assert.match(none.stderr, /refused: no '## Spec-review evidence' section/);
});

test("write-evidence: a refusal into an interactive scratch removes the earlier file", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  const w = f.writeEvidence(f.interactive, text.replace(/^sha256: .*$/m, `sha256: ${"2".repeat(64)}`));
  assert.equal(w.code, 1);
  assert.ok(!existsSync(f.file(f.interactive)));
});

test("write-evidence: missing flags, an unreadable --file and a placement fault exit 2", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  assert.equal(f.cli(["spec-review", "write-evidence", "--file", "-"], { input: text }).code, 2);
  assert.equal(f.cli(["spec-review", "write-evidence", "--dir", f.runScratch]).code, 2);
  assert.equal(f.cli(["spec-review", "write-evidence", "--dir", f.runScratch, "--file", join(f.root, "nope.md")]).code, 2);
  const stray = join(f.root, "stray");
  mkdirSync(stray);
  const w = f.cli(["spec-review", "write-evidence", "--dir", stray, "--file", "-"], { input: text });
  assert.equal(w.code, 2);
  assert.ok(!existsSync(f.file(stray)));
});

test("write-evidence: a symlinked .faff/spec-review/<ISSUE> exits 2 and writes nothing in the target", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "faff-sre-outside-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  rmSync(f.interactive, { recursive: true });
  symlinkSync(outside, f.interactive);
  const w = f.writeEvidence(".faff/spec-review/" + ISSUE, text);
  assert.equal(w.code, 2);
  assert.deepEqual(readdirSync(outside), []);
});

test("a write fault moves an earlier file to spec-review-verdict.stale.json and the warning is printed", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  // A non-empty directory at the canonical name makes the writer's rename fail: an IO fault after placement.
  rmSync(f.file(f.runTarget));
  mkdirSync(f.file(f.runTarget));
  writeFileSync(join(f.file(f.runTarget), "earlier"), "x");
  const c = f.collate(f.runScratch, "--dispositions", f.dispositions, "--comment");
  assert.equal(c.code, 0, c.stderr);
  assert.equal(c.stdout, text);
  assert.equal(lines(c.stderr, WARNING).length, 1);
  assert.ok(!existsSync(f.file(f.runTarget)));
  assert.ok(existsSync(join(f.runTarget, "spec-review-verdict.stale.json", "earlier")));
  // write-evidence follows the same rule: a fault exits 2.
  mkdirSync(f.file(f.runTarget));
  writeFileSync(join(f.file(f.runTarget), "earlier"), "y");
  rmSync(join(f.runTarget, "spec-review-verdict.stale.json"), { recursive: true });
  const w = f.writeEvidence(f.runScratch, text);
  assert.equal(w.code, 2);
  assert.ok(existsSync(join(f.runTarget, "spec-review-verdict.stale.json", "earlier")));
});

test("the --from-judge path writes the same file as the --dispositions path", (t) => {
  const f = fixture(t);
  const PRE = "# EX: spec\n\n> Spec: p · 2026-10-28 · interactive · a/b · faff 1 · confidence: high.\n\nBody text.\n\nconfidence: high\nbuild-tier: standard\n";
  const LITERAL = "the stage step writes the marker before reading the H1";
  const POST = PRE.replace("Body text.", `Body text. Now ${LITERAL}.`);
  const dir = join(f.root, ".faff", "spec-review", "FAFF-8");
  const judge = join(dir, "judge");
  mkdirSync(judge, { recursive: true });
  writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: [{ ...obj("architectural"), evidence: "e", predicted_consequence: "p", spec_anchor: "how" }] }));
  writeFileSync(join(judge, "ledger.json"), JSON.stringify({
    order: ["p-01"],
    entries: { "p-01": { proposition_id: "p-01", lens: "architectural", severity: "major", pre_ruling_spec_sha: sha(PRE), pre_ruling_spec_content: PRE, resolution: "ruled" } },
    window_start: 1,
  }));
  writeFileSync(join(judge, "ruling-p-01.json"), JSON.stringify({ proposition_id: "p-01", outcome: "UPHOLD_REVIEW", rationale: "upheld", correction: { summary: "added the sentence", verification: LITERAL } }));
  const spec = join(f.root, "s.md");
  writeFileSync(spec, POST);
  const judgeRun = f.collate(dir, "--from-judge", "--spec", spec, "--comment");
  assert.equal(judgeRun.code, 0, judgeRun.stderr);
  const viaJudge = readFileSync(f.file(dir), "utf8");
  rmSync(f.file(dir));
  const d = join(f.root, "d8.json");
  writeFileSync(d, JSON.stringify([{ key: "1#0", lens: "architectural", disposition: "fixed", disposition_rationale: "added the sentence" }]));
  const viaFile = f.collate(dir, "--dispositions", d, "--comment");
  assert.equal(viaFile.code, 0, viaFile.stderr);
  assert.equal(readFileSync(f.file(dir), "utf8"), viaJudge);
  assert.equal(viaFile.stdout, judgeRun.stdout);
});

test("round readers ignore spec-review-verdict.json and its temp sibling in an interactive scratch", (t) => {
  const f = fixture(t);
  runCommentOf(f);
  f.collate(f.interactive, "--dispositions", f.dispositions, "--comment");
  writeFileSync(join(f.interactive, ".spec-review-verdict.json.tmp-123"), "{}");
  assert.ok(existsSync(f.file(f.interactive)));
  const { record, skipped, rounds } = collateSpecReviewRounds(f.interactive, []);
  assert.deepEqual(skipped, []);
  assert.equal(record.rounds_total, 2);
  assert.equal(rounds.length, 2);
});

test("collation: an objection-bearing round before a clean approve is kept, a malformed round is skipped, the plain CLI exits 0 (moved from the selftest)", (t) => {
  const f = fixture(t);
  const dir = join(f.root, "collate-only");
  mkdirSync(dir);
  const mk = (n, verdict, objections) => writeFileSync(join(dir, `round-${n}.json`), JSON.stringify({ verdict, objections }));
  mk(1, "revise", [obj("architectural"), obj("QA")]);
  mk(2, "approve", []);
  const { record } = collateSpecReviewRounds(dir, []);
  assert.ok(record.verdict === "revise" && record.final_verdict === "approve" && record.rounds_total === 2 && record.objections.length === 2);
  assert.deepEqual(record.objections.map((o) => o.key), ["1#0", "1#1"]);
  writeFileSync(join(dir, "round-3.json"), "{ not json");
  assert.equal(collateSpecReviewRounds(dir, []).skipped.join(), "round-3.json");
  assert.equal(f.collate(dir).code, 0);
  assert.equal(f.cli(["spec-review", "collate-evidence"]).code, 2);
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;
  let code;
  try { code = cmdSpecReview(["collate-evidence", "--dir", dir]); } finally { process.stdout.write = origWrite; }
  assert.equal(code, 0);
});

test("faff evidence write spec-review-verdict still refuses a --run-dir outside .faff/runs with exit 2", (t) => {
  const f = fixture(t);
  const text = runCommentOf(f);
  const stray = join(f.root, "stray-run");
  mkdirSync(join(stray, ISSUE), { recursive: true });
  const w = f.cli(["evidence", "write", "spec-review-verdict", "--run-dir", stray, "--issue", ISSUE], { input: text });
  assert.equal(w.code, 2);
  assert.ok(!existsSync(f.file(join(stray, ISSUE))));
});

test("the diff adds no network or tracker require to the two modules", () => {
  for (const name of ["spec-review.js", "evidence.js"]) {
    const src = readFileSync(join(import.meta.dirname, "..", "plugin", "skills", "faff", "bin", "lib", name), "utf8");
    assert.ok(!/require\(["']node:(http|https|net)["']\)/.test(src), name);
    assert.ok(!/require\(["']\.\/[\w-]*(tracker|linear|github)[\w-]*["']\)/.test(src), name);
  }
});

// --- placeSpecReviewEvidence, in-process from a temp root -------------------------------------------------

function inRoot(f, fn) {
  const prev = process.cwd();
  process.chdir(f.root);
  try { return fn(); } finally { process.chdir(prev); }
}
const faults = (f, dir, re) => inRoot(f, () => assert.throws(() => placeSpecReviewEvidence(dir), (e) => e instanceof WriterFault && re.test(e.message)));

test("placeSpecReviewEvidence pins specReviewDir for both modes", (t) => {
  const f = fixture(t);
  const run = inRoot(f, () => placeSpecReviewEvidence(specReviewDir(ISSUE, f.runDir)));
  assert.deepEqual(run, { issue: ISSUE, target_dir: f.runTarget, mode: "run" });
  const inter = inRoot(f, () => placeSpecReviewEvidence(specReviewDir(ISSUE)));
  assert.deepEqual(inter, { issue: ISSUE, target_dir: f.interactive, mode: "interactive" });
});

test("placeSpecReviewEvidence throws WriterFault for every other directory", (t) => {
  const f = fixture(t);
  faults(f, join(f.root, "nope"), /not a directory/);
  faults(f, f.root, /neither/);
  const stray = join(f.root, "elsewhere", "spec-review");
  mkdirSync(stray, { recursive: true });
  faults(f, stray, /not inside \.faff\/runs/);
  const deeper = join(f.interactive, "judge");
  mkdirSync(deeper);
  faults(f, deeper, /neither/);
  const badId = join(f.root, ".faff", "spec-review", "bad id");
  mkdirSync(badId);
  faults(f, badId, /not a valid spec-review scratch dir/);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "faff-sre-outside-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  faults(f, outside, /neither/);
});

test("placeSpecReviewEvidence refuses a symlinked child, a symlinked .faff/spec-review and a symlinked .faff", (t) => {
  const f = fixture(t);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "faff-sre-outside-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(outside, ISSUE));
  rmSync(f.interactive, { recursive: true });
  symlinkSync(join(outside, ISSUE), f.interactive);
  faults(f, ".faff/spec-review/" + ISSUE, /neither/);
  rmSync(f.interactive);
  mkdirSync(f.interactive);
  const sr = join(f.root, ".faff", "spec-review");
  rmSync(sr, { recursive: true });
  symlinkSync(outside, sr);
  faults(f, ".faff/spec-review/" + ISSUE, /resolves outside the repository/);
  rmSync(sr);
  mkdirSync(join(sr, ISSUE), { recursive: true });
  const faffDir = join(f.root, ".faff");
  const moved = join(f.root, "moved-faff");
  execFileSync("mv", [faffDir, moved]);
  symlinkSync(moved, faffDir);
  faults(f, ".faff/spec-review/" + ISSUE, /resolves outside the repository/);
});

test("guardWriterPaths still refuses a run dir outside .faff/runs", (t) => {
  const f = fixture(t);
  inRoot(f, () => assert.throws(() => guardWriterPaths(join(f.root, "elsewhere"), ISSUE), WriterFault));
});

test("write-evidence --file - on a terminal stdin exits 2 instead of waiting for input", (t) => {
  const f = fixture(t);
  const desc = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  const origErr = process.stderr.write.bind(process.stderr);
  let err = "";
  process.stderr.write = (s) => { err += s; return true; };
  let code;
  try { code = inRoot(f, () => cmdSpecReview(["write-evidence", "--dir", f.runScratch, "--file", "-"])); } finally {
    process.stderr.write = origErr;
    if (desc) Object.defineProperty(process.stdin, "isTTY", desc); else delete process.stdin.isTTY;
  }
  assert.equal(code, 2);
  assert.match(err, /nothing was piped/);
  assert.ok(!existsSync(f.file(f.runTarget)));
});
