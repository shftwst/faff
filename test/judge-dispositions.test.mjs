// FAFF-1406: `faff spec-review collate-evidence --from-judge`. Builds a spec-review scratch dir with
// round records and a judge dir with a ledger and rulings, then runs the real CLI: each judge state maps
// to its disposition, earlier-round keys stay open, the comment parses, disagreements and missing files
// fail with their exit codes, and re-stamping the spec between --admit and --from-judge changes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const { parseSpecReviewComment } = require("../plugin/skills/faff/bin/lib/evidence-collate.js");
const { readStandingResidue } = require("../plugin/skills/faff/bin/lib/spec-judge-evidence.js");
const { buildJudgeDispositions } = require("../plugin/skills/faff/bin/lib/judge-dispositions.js");

const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const LITERAL = "the stage step writes the marker before reading the H1";
const PRE = "# EX: spec\n\n> Spec: p · 2026-10-28 · interactive · a/b · faff 1 · confidence: high.\n\nBody text.\n\nconfidence: high\nbuild-tier: standard\n";
const POST = PRE.replace("Body text.", `Body text. Now ${LITERAL}.`);

const obj = (lens, severity, claim) => ({ lens, severity, claim, evidence: "e", predicted_consequence: "p", spec_anchor: "how" });

// Round 1 holds one earlier objection; round 2 (the window) holds the judged residue.
function fixture({ residue, entries, rulings, spec = POST, windowStart = 2 }) {
  const root = mkdtempSync(join(tmpdir(), "faff-judge-disp-"));
  const dir = join(root, "scratch");
  const judge = join(dir, "judge");
  mkdirSync(judge, { recursive: true });
  writeFileSync(join(root, ".gitignore"), "");
  writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "revise", objections: [obj("QA", "minor", "earlier")] }));
  writeFileSync(join(dir, "round-2.json"), JSON.stringify({ verdict: residue.length ? "reject-approach" : "approve", objections: residue }));
  const order = entries.map((_, i) => `p-0${i + 1}`);
  const ledgerEntries = Object.fromEntries(entries.map((e, i) => [order[i], { proposition_id: order[i], pre_ruling_spec_sha: sha(PRE), pre_ruling_spec_content: PRE, resolution: "ruled", ...e }]));
  writeFileSync(join(judge, "ledger.json"), JSON.stringify({ order, entries: ledgerEntries, window_start: windowStart }));
  for (const [pid, r] of Object.entries(rulings)) writeFileSync(join(judge, `ruling-${pid}.json`), JSON.stringify({ proposition_id: pid, ...r }));
  const specFile = join(root, "s.md");
  writeFileSync(specFile, spec);
  return { root, dir, judge, specFile };
}

function cli(f, extra = []) {
  const r = spawnSync("node", [CLI, "spec-review", "collate-evidence", "--dir", f.dir, ...extra], { cwd: f.root, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const fromJudge = (f, extra = []) => cli(f, ["--from-judge", "--spec", f.specFile, ...extra]);
const byKey = (stdout) => Object.fromEntries(JSON.parse(stdout).objections.map((o) => [o.key, o]));

const TABLE = {
  residue: [obj("architectural", "major", "a"), obj("infosec", "minor", "b"), obj("QA", "major", "c"), obj("methodology", "minor", "d"), obj("architectural", "minor", "e")],
  entries: [
    { lens: "architectural", severity: "major" },
    { lens: "infosec", severity: "minor", resolution: "parked" },
    { lens: "QA", severity: "major" },
    { lens: "methodology", severity: "minor" },
    { lens: "architectural", severity: "minor" },
  ],
  rulings: {
    "p-01": { outcome: "AFFIRM_SPEC", rationale: "the spec already covers it" },
    "p-03": { outcome: "UPHOLD_REVIEW", rationale: "upheld", correction: { summary: "added the marker-first sentence", verification: LITERAL } },
    "p-04": { outcome: "SYNTHESIZE", rationale: "partly right, not applied", correction: { summary: "s", verification: "a literal that the spec never gained anywhere" } },
    "p-05": { outcome: "PRD_BOUNDARY", rationale: "a product call" },
  },
};

test("each judge state maps to its disposition and rationale; earlier rounds stay open", () => {
  const f = fixture(TABLE);
  const r = fromJudge(f);
  assert.equal(r.status, 0, r.stderr);
  const o = byKey(r.stdout);
  assert.deepEqual([o["2#0"].disposition, o["2#0"].disposition_rationale], ["refuted", "the spec already covers it"]);
  assert.deepEqual([o["2#1"].disposition, o["2#1"].disposition_rationale], ["open", undefined]);
  assert.deepEqual([o["2#2"].disposition, o["2#2"].disposition_rationale], ["fixed", "added the marker-first sentence"]);
  assert.deepEqual([o["2#3"].disposition, o["2#3"].disposition_rationale], ["open", "partly right, not applied"]);
  assert.deepEqual([o["2#4"].disposition, o["2#4"].disposition_rationale], ["open", "a product call"]);
  assert.deepEqual([o["1#0"].disposition, o["1#0"].disposition_rationale], ["open", undefined]);
});

test("an UPHOLD_REVIEW whose literal is absent from --spec is open, never fixed", () => {
  const f = fixture({ ...TABLE, spec: PRE.replace("Body text.", "Body text, edited without the literal.") });
  const o = byKey(fromJudge(f).stdout);
  assert.equal(o["2#2"].disposition, "open");
  assert.equal(o["2#2"].disposition_rationale, "upheld");
});

test("an empty rationale is omitted, never written as an empty string", () => {
  const f = fixture({ residue: [obj("QA", "minor", "x")], entries: [{ lens: "QA", severity: "minor" }], rulings: { "p-01": { outcome: "AFFIRM_SPEC", rationale: "  " } } });
  const o = byKey(fromJudge(f).stdout);
  assert.equal(o["2#0"].disposition, "refuted");
  assert.equal("disposition_rationale" in o["2#0"], false);
});

test("--comment output parses with no disposition value supplied by the caller", () => {
  const f = fixture(TABLE);
  const r = fromJudge(f, ["--comment"]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = parseSpecReviewComment(r.stdout);
  assert.equal(parsed.objections.length, 6);
});

test("re-stamping the stamp and build-tier lines between --admit and --from-judge changes no disposition", () => {
  const f = fixture(TABLE);
  const before = fromJudge(f).stdout;
  writeFileSync(f.specFile, POST.replace(/^> Spec: .*$/m, "> Spec: p · 2026-10-29 · autonomous · c/d · faff 2 · confidence: high. Full spec on Linear EX-1.").replace("build-tier: standard", "build-tier: complex"));
  assert.equal(fromJudge(f).stdout, before);
});

test("a ledger that disagrees with the latest round exits 1", () => {
  let f = fixture({ ...TABLE, entries: TABLE.entries.slice(0, 4) });
  assert.equal(fromJudge(f).status, 1, "length");
  f = fixture({ ...TABLE, entries: [{ lens: "QA", severity: "major" }, ...TABLE.entries.slice(1)] });
  assert.equal(fromJudge(f).status, 1, "lens");
  f = fixture({ ...TABLE, entries: [{ lens: "architectural", severity: "minor" }, ...TABLE.entries.slice(1)] });
  assert.equal(fromJudge(f).status, 1, "severity");
  f = fixture({ ...TABLE, rulings: { ...TABLE.rulings, "p-01": { outcome: "OVERTURN" } } });
  assert.equal(fromJudge(f).status, 1, "outcome");
});

test("a missing ruling for a non-parked proposition, or a missing ledger, exits 2", () => {
  let f = fixture(TABLE);
  rmSync(join(f.judge, "ruling-p-03.json"));
  assert.equal(fromJudge(f).status, 2);
  f = fixture(TABLE);
  rmSync(join(f.judge, "ledger.json"));
  assert.equal(fromJudge(f).status, 2);
});

test("usage: --from-judge with --dispositions, or without --spec, or --spec alone, exits 2", () => {
  const f = fixture(TABLE);
  const disp = join(f.root, "d.json");
  writeFileSync(disp, "[]");
  assert.equal(fromJudge(f, ["--dispositions", disp]).status, 2);
  assert.equal(cli(f, ["--from-judge"]).status, 2);
  assert.equal(cli(f, ["--spec", f.specFile]).status, 2);
});

test("an empty ledger over an empty residue leaves every key open; over a non-empty residue it exits 1", () => {
  let f = fixture({ residue: [], entries: [], rulings: {} });
  let r = fromJudge(f);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(Object.values(byKey(r.stdout)).map((o) => o.disposition), ["open"]);
  f = fixture({ residue: [obj("QA", "minor", "x")], entries: [], rulings: {} });
  assert.equal(fromJudge(f).status, 1);
});

test("readStandingResidue is exported and returns the latest in-window round's number", () => {
  const f = fixture(TABLE);
  const res = readStandingResidue(f.dir, 1);
  assert.equal(res.n, 2);
  assert.equal(res.objections.length, 5);
  assert.equal(readStandingResidue(f.dir, 3).n, null);
  assert.equal(typeof buildJudgeDispositions, "function");
  assert.match(readFileSync(join(HERE, "..", "plugin", "skills", "faff", "bin", "lib", "judge-dispositions.js"), "utf8"), /require\("\.\/spec-judge-evidence"\)/);
});
