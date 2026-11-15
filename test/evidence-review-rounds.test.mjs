// FAFF-1268 — `faff evidence record-review-round` records each code-review pass, and
// `faff evidence write review-verdict` collates the recorded rounds (default, --park, --judge-admitted).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { emitGenesisRunStart } = require("../plugin/skills/faff/bin/lib/events.js");
const { readReviewVerdict } = require("../plugin/skills/faff/bin/lib/merge-gate.js");
const { collateReviewRounds } = require("../plugin/skills/faff/bin/lib/evidence-collate.js");
const { computeReviewVerdict, contractReviewVerdict } = require("../plugin/skills/faff/bin/lib/contract-defs.js");
const { validateAgainstSchema } = require("../plugin/skills/faff/bin/lib/contract-engine.js");
const { resolveFaffVersion } = require("../plugin/skills/faff/bin/lib/faff-version.js");

const SCHEMAS = join(import.meta.dirname, "..", "plugin", "skills", "faff", "contracts", "evidence-v0.3", "schema");
const schema = (name) => JSON.parse(readFileSync(join(SCHEMAS, `${name}.schema.json`), "utf8"));
const FAFF = join(import.meta.dirname, "..", "plugin", "skills", "faff", "bin", "faff");
const SECRET = "supersecretvalue-0123456789";
const ISSUE = "ISSUE-1";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "faff-review-rounds-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, ".faff", "runs", "run-20991231-000000-graft-ISSUE-1");
  mkdirSync(runDir, { recursive: true });
  emitGenesisRunStart(runDir);
  const issueDir = join(runDir, ISSUE);
  const cli = (args, input, env) => runCli(args, { cwd: root, input, env });
  const record = (block, extra = [], runDirArg = runDir, issue = ISSUE) =>
    cli(["evidence", "record-review-round", ...extra, "--run-dir", runDirArg, "--issue", issue], typeof block === "string" ? block : JSON.stringify(block));
  const write = (extra = [], runDirArg = runDir, issue = ISSUE) =>
    cli(["evidence", "write", "review-verdict", ...extra, "--run-dir", runDirArg, "--issue", issue], "");
  const round = (n) => JSON.parse(readFileSync(join(issueDir, "review-rounds", `round-${n}.json`), "utf8"));
  const verdict = () => JSON.parse(readFileSync(join(issueDir, "review-verdict.json"), "utf8"));
  const verdictPath = join(issueDir, "review-verdict.json");
  return { root, runDir, issueDir, cli, record, write, round, verdict, verdictPath };
}

const finding = (title, location, extra = {}) => ({ title, location, action: "fix it", location_present: true, action_present: true, severity: "major", source: "standard", ...extra });
const A = finding("leaks fd", "a.js:3");
const B = finding("missing null check", "b.js:7");
const C = finding("off by one", "c.js:1");

function recordAll(f, blocks) {
  for (const block of blocks) {
    const r = f.record(block);
    assert.equal(r.code, 0, r.stderr);
  }
}

function writeRound(f, n, findings, signal = "fail", extra = {}) {
  const dir = join(f.issueDir, "review-rounds");
  mkdirSync(dir, { recursive: true });
  const full = findings.map((x) => ({
    finding_id: "stored", carried_id: null, title: null, location: null, action: null, location_present: false, action_present: false,
    severity: null, source: null, model: null, disposition: null, refutation: null, disposition_rationale: null, ...x,
  }));
  writeFileSync(join(dir, `round-${n}.json`), JSON.stringify({ schema_version: 1, round: n, signal, adversarial_outcome: null, findings: full, ...extra }));
}

const byTitle = (doc, title) => doc.findings.find((x) => x.title === title);

// --- the nine scenarios -------------------------------------------------------

test("scenario: fail, fail with a refutation and a new finding, then pass", (t) => {
  const f = fixture(t);
  recordAll(f, [
    { signal: "fail", findings: [A, B] },
    { signal: "fail", findings: [{ ...A, disposition: "refuted", refutation: "the fd is closed in finally", carried_id: "P1" }, C] },
    { signal: "pass", findings: [] },
  ]);
  const w = f.write();
  assert.equal(w.code, 0, w.stderr);
  const doc = f.verdict();
  assert.equal(doc.signal, "pass");
  assert.equal(doc.rounds_total, 3);
  assert.equal(doc.round_history, "recorded");
  assert.equal(doc.findings.length, 3);
  assert.deepEqual([byTitle(doc, "leaks fd").disposition, byTitle(doc, "leaks fd").last_round, byTitle(doc, "leaks fd").refutation], ["refuted", 2, "the fd is closed in finally"]);
  assert.deepEqual([byTitle(doc, "missing null check").disposition, byTitle(doc, "missing null check").first_round, byTitle(doc, "missing null check").last_round, byTitle(doc, "missing null check").disposition_rationale], ["fixed", 1, 1, null]);
  assert.equal(byTitle(doc, "off by one").disposition, "fixed");
  assert.deepEqual(validateAgainstSchema(doc, schema("review-verdict-anchored")), []);
  assert.equal(readReviewVerdict(f.runDir, ISSUE), "pass");
});

test("scenario: a carried, reworded finding keeps the round-1 id across rounds", (t) => {
  const f = fixture(t);
  recordAll(f, [
    { signal: "fail", findings: [finding("pagecount truncates partial last page with math.floor", "lib/page.js:12")] },
    { signal: "fail", findings: [finding("pagecount rounds down a partial last page", "lib/page.js:15", { carried_id: "P1" })] },
    { signal: "pass", findings: [] },
  ]);
  assert.equal(f.write().code, 0);
  const doc = f.verdict();
  assert.equal(doc.findings.length, 1);
  assert.equal(doc.findings[0].finding_id, "lib/page.js::pagecount truncates partial last page with math.floor");
  assert.equal(doc.findings[0].occurrences.length, 2);
  assert.equal(doc.findings[0].last_round, 2);
  assert.equal(doc.findings[0].disposition, "fixed");
});

test("scenario: a dialogue-loop handle is translated through --prior-dir", (t) => {
  const f = fixture(t);
  const M = finding("unused import", "a.js:5", { severity: "minor" });
  const Crit = finding("leaks fd", "a.js:40", { severity: "critical" });
  recordAll(f, [{ signal: "fail", findings: [M, Crit] }]);
  const buildReview = join(f.issueDir, "build-review");
  mkdirSync(buildReview);
  writeFileSync(join(buildReview, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: [Crit] }));
  const r = f.record({ signal: "needs-human", findings: [finding("file descriptor leaks on error", "a.js:44", { severity: "critical", carried_id: "P1" })] }, ["--prior-dir", buildReview]);
  assert.equal(r.code, 0, r.stderr);
  const rec = f.round(2);
  assert.equal(rec.findings[0].carried_id, "P2");
  assert.equal(rec.findings[0].finding_id, "a.js::leaks fd");
});

test("scenario: a needs-human terminal round settles an unraised finding open, never fixed", (t) => {
  const f = fixture(t);
  recordAll(f, [
    { signal: "fail", findings: [A, B] },
    { signal: "needs-human", findings: [{ ...A, carried_id: "P1", disposition: "accepted-risk", disposition_rationale: "owner call" }] },
  ]);
  assert.equal(f.write().code, 0);
  const doc = f.verdict();
  assert.equal(doc.signal, "needs-human");
  assert.deepEqual([byTitle(doc, "leaks fd").disposition, byTitle(doc, "leaks fd").disposition_rationale], ["accepted-risk", "owner call"]);
  assert.equal(byTitle(doc, "missing null check").disposition, "open");
});

test("scenario: a hold-limit park keeps a refutation and leaves the rest open", (t) => {
  const f = fixture(t);
  recordAll(f, [
    { signal: "fail", findings: [A, B] },
    { signal: "needs-human", findings: [{ ...A, carried_id: "P1", disposition: "refuted", refutation: "closed in finally" }] },
  ]);
  const w = f.write(["--park", "needs-human"]);
  assert.equal(w.code, 0, w.stderr);
  const doc = f.verdict();
  assert.equal(doc.signal, "needs-human");
  assert.equal(doc.rounds_total, 2);
  assert.deepEqual([byTitle(doc, "leaks fd").disposition, byTitle(doc, "leaks fd").refutation], ["refuted", "closed in finally"]);
  assert.equal(byTitle(doc, "missing null check").disposition, "open");
  assert.ok(doc.findings.every((x) => x.disposition !== "fixed"));
});

test("scenario: a judge admit writes pass with admitted_by, and refuses without the judge's admit", (t) => {
  const f = fixture(t);
  const Crit = finding("leaks fd", "a.js:40", { severity: "critical" });
  recordAll(f, [
    { signal: "fail", findings: [B] },
    { signal: "needs-human", findings: [{ ...Crit, disposition: "open" }] },
  ]);
  const missing = f.write(["--judge-admitted"]);
  assert.equal(missing.code, 1);
  assert.ok(!existsSync(f.verdictPath));
  const judge = join(f.issueDir, "build-review", "judge");
  mkdirSync(judge, { recursive: true });
  writeFileSync(join(judge, "admit-result.json"), JSON.stringify({ admit: false }));
  assert.equal(f.write(["--judge-admitted"]).code, 1);
  assert.ok(!existsSync(f.verdictPath));
  writeFileSync(join(judge, "admit-result.json"), JSON.stringify({ admit: true }));
  const w = f.write(["--judge-admitted"]);
  assert.equal(w.code, 0, w.stderr);
  const doc = f.verdict();
  assert.equal(doc.signal, "pass");
  assert.equal(doc.admitted_by, "build-judge");
  assert.equal(byTitle(doc, "leaks fd").disposition, "open");
  assert.equal(readReviewVerdict(f.runDir, ISSUE), "pass");
});

test("scenario: an exhausted outage after one fail round writes unavailable with findings open", (t) => {
  const f = fixture(t);
  recordAll(f, [{ signal: "fail", findings: [A] }]);
  assert.equal(f.write(["--park", "unavailable"]).code, 0);
  const doc = f.verdict();
  assert.equal(doc.signal, "unavailable");
  assert.equal(doc.rounds_total, 1);
  assert.equal(doc.findings[0].disposition, "open");
  assert.deepEqual(validateAgainstSchema(doc, schema("review-verdict-anchored")), []);
  assert.equal(readReviewVerdict(f.runDir, ISSUE), "unavailable");
});

test("scenario: the terminal round's adversarial_outcome reaches review-verdict.json", (t) => {
  const f = fixture(t);
  recordAll(f, [{ signal: "pass", adversarial_outcome: "chain-outage-skipped", findings: [] }]);
  assert.equal(f.round(1).adversarial_outcome, "chain-outage-skipped");
  assert.equal(f.write().code, 0);
  assert.equal(f.verdict().adversarial_outcome, "chain-outage-skipped");
  assert.deepEqual(Object.keys(f.verdict()).slice(0, 4), ["schema_version", "faff_version", "signal", "adversarial_outcome"]);
  assert.equal(f.verdict().faff_version, resolveFaffVersion().version);
});

test("scenario: a resume into a fresh run dir numbers on from the restored rounds", (t) => {
  const f = fixture(t);
  recordAll(f, [{ signal: "fail", findings: [A] }, { signal: "fail", findings: [{ ...A, carried_id: "P1" }] }]);
  const fresh = join(f.root, ".faff", "runs", "run-20991231-000001-graft-ISSUE-1");
  mkdirSync(join(fresh, ISSUE), { recursive: true });
  emitGenesisRunStart(fresh);
  spawnSync("cp", ["-R", join(f.issueDir, "review-rounds"), join(fresh, ISSUE)]);
  const r = f.record({ signal: "pass", findings: [] }, [], fresh);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.trim().endsWith("round-3.json"));
  assert.equal(f.write([], fresh).code, 0);
  const doc = JSON.parse(readFileSync(join(fresh, ISSUE, "review-verdict.json"), "utf8"));
  assert.equal(doc.rounds_total, 3);
  assert.equal(doc.findings.length, 1);
  assert.equal(doc.findings[0].disposition, "fixed");
});

// --- the recorder ----------------------------------------------------------------

test("record-review-round: refuses unavailable, ignores a supplied finding_id, stores carried_id and resolves the carry", (t) => {
  const f = fixture(t);
  const out = f.record({ signal: "unavailable", findings: [] });
  assert.equal(out.code, 1);
  assert.ok(!existsSync(join(f.issueDir, "review-rounds")));
  recordAll(f, [{ signal: "fail", findings: [{ ...A, finding_id: "made-up" }] }]);
  assert.equal(f.round(1).findings[0].finding_id, "a.js::leaks fd");
  recordAll(f, [{ signal: "fail", findings: [finding("descriptor never closed", "a.js:9", { carried_id: " P1 ", finding_id: "other" })] }]);
  const rec = f.round(2);
  assert.equal(rec.findings[0].carried_id, "P1");
  assert.equal(rec.findings[0].finding_id, "a.js::leaks fd");
  assert.deepEqual(validateAgainstSchema(rec, schema("review-round")), []);
  assert.deepEqual(Object.keys(rec), ["schema_version", "faff_version", "round", "signal", "adversarial_outcome", "findings"]);
  assert.equal(rec.faff_version, resolveFaffVersion().version);
});

test("record-review-round: an out-of-enum value is written as null with a warning that hides the value", (t) => {
  const f = fixture(t);
  const r = f.record({ signal: "fail", findings: [{ ...A, severity: `huge-${SECRET}`, source: "elsewhere", disposition: 4, carried_id: 7 }] });
  assert.equal(r.code, 0, r.stderr);
  const rec = f.round(1).findings[0];
  assert.deepEqual([rec.severity, rec.source, rec.disposition, rec.carried_id], [null, null, null, null]);
  assert.match(r.stderr, /findings\[0\]\.severity: not in the enum; written as null/);
  assert.match(r.stderr, /findings\[0\]\.carried_id: not a string/);
  assert.ok(!r.stderr.includes(SECRET));
  assert.ok(!r.stderr.includes("huge"));
});

test("record-review-round: --prior-dir stores null with a warning when there is no single match or no prior round", (t) => {
  const f = fixture(t);
  recordAll(f, [{ signal: "fail", findings: [A, { ...A, location: "a.js:30" }] }]);
  const buildReview = join(f.issueDir, "build-review");
  mkdirSync(buildReview);
  writeFileSync(join(buildReview, "round-1.json"), JSON.stringify({ findings: [A, C] }));
  const ambiguous = f.record({ signal: "fail", findings: [{ ...A, carried_id: "P1" }, { ...C, carried_id: "P2" }, { ...C, carried_id: "P9" }] }, ["--prior-dir", buildReview]);
  assert.equal(ambiguous.code, 0, ambiguous.stderr);
  assert.deepEqual(f.round(2).findings.map((x) => x.carried_id), [null, null, null]);
  assert.equal((ambiguous.stderr.match(/warning/g) || []).length, 3);
  const absent = f.record({ signal: "fail", findings: [{ ...A, carried_id: "P1" }], adversarial_outcome: `skipped-${SECRET}` }, ["--prior-dir", join(f.issueDir, "build-review-missing")]);
  assert.equal(absent.code, 0, absent.stderr);
  assert.equal(f.round(3).findings[0].carried_id, null);
  assert.equal(f.round(3).adversarial_outcome, null);
  assert.match(absent.stderr, /--prior-dir has no round record/);
  assert.match(absent.stderr, /adversarial_outcome: not in the enum; written as null/);
  assert.ok(!absent.stderr.includes(SECRET));
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  const escape = f.record({ signal: "fail", findings: [{ ...A, carried_id: "P1" }] }, ["--prior-dir", outside]);
  assert.equal(escape.code, 2);
  assert.ok(!existsSync(join(f.issueDir, "review-rounds", "round-4.json")));
});

test("record-review-round: exits 2 naming a corrupt existing round record, and writes nothing", (t) => {
  const f = fixture(t);
  recordAll(f, [{ signal: "fail", findings: [A] }]);
  writeFileSync(join(f.issueDir, "review-rounds", "round-1.json"), `{"secret": "${SECRET}"`);
  const r = f.record({ signal: "pass", findings: [] });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /review-rounds\/round-1\.json/);
  assert.ok(!r.stderr.includes(SECRET));
  assert.deepEqual(readdirSync(join(f.issueDir, "review-rounds")), ["round-1.json"]);
});

test("record-review-round: two concurrent calls never record the same round number", async (t) => {
  const f = fixture(t);
  const one = () => new Promise((resolve) => {
    const child = spawn("node", [FAFF, "evidence", "record-review-round", "--run-dir", f.runDir, "--issue", ISSUE], { cwd: f.root });
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify({ signal: "fail", findings: [A] }));
  });
  for (let i = 0; i < 5; i++) {
    const results = await Promise.all([one(), one(), one()]);
    const written = results.filter((r) => r.code === 0).map((r) => r.stdout.trim());
    assert.equal(new Set(written).size, written.length);
    assert.ok(results.every((r) => r.code === 0 || r.code === 2));
  }
  const files = readdirSync(join(f.issueDir, "review-rounds")).filter((n) => n.endsWith(".json"));
  assert.ok(files.every((n) => /^round-\d+\.json$/.test(n)));
});

// --- every command: guards, refusals, determinism, redaction ----------------------

const COMMANDS = [
  ["record-review-round", (f, ...a) => f.record({ signal: "pass", findings: [] }, [], ...a)],
  ["write review-verdict", (f, ...a) => f.write([], ...a)],
  ["--park needs-human", (f, ...a) => f.write(["--park", "needs-human"], ...a)],
  ["--park unavailable", (f, ...a) => f.write(["--park", "unavailable"], ...a)],
];

test("every command exits 2 and writes nothing for a bad issue id or a run dir outside .faff/runs", (t) => {
  const f = fixture(t);
  const elsewhere = join(f.root, "elsewhere");
  mkdirSync(join(elsewhere, "runs"), { recursive: true });
  const linked = join(f.root, ".faff", "runs", "linked");
  symlinkSync(join(elsewhere, "runs"), linked);
  for (const [label, run] of COMMANDS) {
    for (const issue of ["../x", "a/b"]) assert.equal(run(f, f.runDir, issue).code, 2, `${label} ${issue}`);
    assert.equal(run(f, join(elsewhere, "runs")).code, 2, `${label} outside`);
    assert.equal(run(f, linked).code, 2, `${label} symlink`);
  }
  assert.ok(!existsSync(f.issueDir));
  assert.deepEqual(readdirSync(join(elsewhere, "runs")), []);
});

test("every command exits 1 and writes nothing on invalid input", (t) => {
  const f = fixture(t);
  for (const bad of [`{"signal": "${SECRET}`, "[1]", { signal: "maybe", findings: [] }, { signal: "fail", findings: ["x"] }, { signal: "fail", findings: [{ ...A, title: 5 }] }]) {
    const r = f.record(bad);
    assert.equal(r.code, 1, r.stderr);
    assert.ok(!r.stderr.includes(SECRET));
  }
  assert.ok(!existsSync(join(f.issueDir, "review-rounds")));
  writeRound(f, 1, [{ title: "x" }], "fail", { extra: 1 });
  for (const [label, run] of COMMANDS.slice(1)) {
    const r = run(f);
    assert.equal(r.code, 1, label);
    assert.match(r.stderr, /review-rounds\/round-1\.json/, label);
    assert.ok(!existsSync(f.verdictPath), label);
  }
});

test("identical input against identical run-dir state yields byte-identical output", (t) => {
  const outputs = [];
  for (let i = 0; i < 2; i++) {
    const f = fixture(t);
    recordAll(f, [{ signal: "fail", findings: [A, B] }, { signal: "pass", findings: [{ ...A, carried_id: "P1", disposition: "accepted-risk" }] }]);
    assert.equal(f.write().code, 0);
    const parked = join(f.root, "parked.json");
    outputs.push([readFileSync(join(f.issueDir, "review-rounds", "round-1.json"), "utf8"), readFileSync(join(f.issueDir, "review-rounds", "round-2.json"), "utf8"), readFileSync(f.verdictPath, "utf8")]);
    assert.equal(f.write(["--park", "unavailable"]).code, 0);
    writeFileSync(parked, readFileSync(f.verdictPath));
    outputs[i].push(readFileSync(parked, "utf8"));
  }
  assert.deepEqual(outputs[0], outputs[1]);
});

test("every command replaces a configured known secret, from the config or an env var", (t) => {
  const f = fixture(t);
  const ENV_SECRET = "envsecretvalue-9876543210";
  writeFileSync(join(f.root, ".faffrc.yaml"), `andon:\n  token: ${SECRET}\nengines:\n  x:\n    api_key_env: FAFF_TEST_KEY\n`);
  const env = { ...process.env, FAFF_TEST_KEY: ENV_SECRET };
  const r = f.cli(["evidence", "record-review-round", "--run-dir", f.runDir, "--issue", ISSUE], JSON.stringify({ signal: "fail", findings: [{ ...A, action: `rotate ${SECRET}`, refutation: `see ${ENV_SECRET}` }] }), env);
  assert.equal(r.code, 0, r.stderr);
  const roundText = readFileSync(join(f.issueDir, "review-rounds", "round-1.json"), "utf8");
  assert.ok(!roundText.includes(SECRET) && !roundText.includes(ENV_SECRET) && roundText.includes("[REDACTED]"));
  writeRound(f, 2, [{ title: `seen ${SECRET}`, location: "z.js:1" }], "needs-human");
  for (const extra of [[], ["--park", "needs-human"], ["--park", "unavailable"]]) {
    const w = f.cli(["evidence", "write", "review-verdict", ...extra, "--run-dir", f.runDir, "--issue", ISSUE], "", env);
    assert.equal(w.code, 0, w.stderr);
    const text = readFileSync(f.verdictPath, "utf8");
    assert.ok(!text.includes(SECRET) && !text.includes(ENV_SECRET), extra.join(" "));
  }
});

test("a malformed redaction config exits 2 from every command with nothing written", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".faffrc.yaml"), "- not\n- a map\n");
  for (const [label, run] of COMMANDS) {
    const r = run(f);
    assert.equal(r.code, 2, label);
    assert.equal(r.stdout, "", label);
  }
  assert.ok(!existsSync(f.issueDir));
});

// --- writer modes ------------------------------------------------------------------

test("default mode refuses no rounds or a fail terminal round; parks write empty verdicts; flags exclude each other", (t) => {
  const f = fixture(t);
  const none = f.write();
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no review rounds recorded; use --park or --terminal-only/);
  for (const park of ["needs-human", "unavailable"]) {
    assert.equal(f.write(["--park", park]).code, 0);
    const doc = f.verdict();
    assert.deepEqual([doc.signal, doc.rounds_total, doc.findings, doc.round_history], [park, 0, [], "recorded"]);
    assert.deepEqual(validateAgainstSchema(doc, schema("review-verdict-anchored")), []);
    rmSync(f.verdictPath);
  }
  recordAll(f, [{ signal: "fail", findings: [A] }]);
  const fail = f.write();
  assert.equal(fail.code, 1);
  assert.match(fail.stderr, /terminal round is fail; the review loop has not finished/);
  for (const flags of [["--park", "needs-human", "--judge-admitted"], ["--park", "unavailable", "--terminal-only"], ["--judge-admitted", "--terminal-only"], ["--park", "fixed"]]) {
    assert.equal(f.write(flags).code, 2, flags.join(" "));
  }
  assert.equal(f.cli(["evidence", "write", "ac-checklist", "--park", "needs-human", "--run-dir", f.runDir, "--issue", ISSUE], "{}").code, 2);
  assert.ok(!existsSync(f.verdictPath));
});

// --- the collator ------------------------------------------------------------------

const rec = (round, findings, signal = "fail") => ({
  round,
  signal,
  findings: findings.map((x) => ({
    finding_id: "stored", carried_id: null, title: null, location: null, action: null, location_present: true, action_present: true,
    severity: null, source: null, model: null, disposition: null, refutation: null, disposition_rationale: null, ...x,
  })),
});

test("collateReviewRounds: model falls back to the latest round where it is non-null", () => {
  const out = collateReviewRounds([
    rec(1, [{ title: "t", location: "a.js:1", severity: "minor", model: "m-1" }]),
    rec(2, [{ title: "t", location: "a.js:1", severity: "critical", model: null }]),
    rec(3, [{ title: "t", location: "a.js:4", severity: "minor", model: "m-3" }]),
  ], "pass", false);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].severity, out[0].model, out[0].location], ["critical", "m-3", "a.js:4"]);
});

test("collateReviewRounds: a carry across a missing round is refused, giving two merged findings", () => {
  const out = collateReviewRounds([
    rec(1, [{ title: "old wording", location: "a.js:1" }]),
    rec(3, [{ title: "new wording", location: "a.js:2", carried_id: "P1" }]),
  ], "needs-human", true);
  assert.deepEqual(out.map((x) => x.finding_id), ["a.js::old wording", "a.js::new wording"]);
});

test("collateReviewRounds: an edited stored finding_id changes nothing, even for an untitled refused carry", () => {
  const rounds = [
    rec(1, [{ title: "leaks fd", location: "a.js:1" }, { location: "b.js:1", finding_id: "b-1" }]),
    rec(2, [{ location: "b.js:2", carried_id: "P2", finding_id: "b-1" }, { title: "x", location: "a.js:9", carried_id: "P1", finding_id: "a.js::leaks fd" }]),
  ];
  const edited = structuredClone(rounds);
  edited[1].findings[0].finding_id = "round-1#1";
  edited[0].findings[0].finding_id = "anything";
  const ids = (rs) => collateReviewRounds(rs, "pass", false).map((x) => [x.finding_id, x.occurrences.map((o) => o.round)]);
  assert.deepEqual(ids(edited), ids(rounds));
  assert.deepEqual(ids(rounds), [["a.js::leaks fd", [1, 2]], ["round-1#1", [1]], ["round-2#0", [2]]]);
});

// --- the normaliser -----------------------------------------------------------------

test("computeReviewVerdict passes the collation fields through typed, never carried_id", () => {
  const block = {
    signal: "pass", schema_version: 1, rounds_total: 2, round_history: "recorded", adversarial_outcome: "chain-outage-skipped", admitted_by: "build-judge",
    findings: [{ location_present: true, action_present: true, finding_id: "a.js::t", title: "t", location: "a.js:1", action: "do", carried_id: "P1", first_round: 1, last_round: 2, occurrences: [{ round: 1, title: "t", location: "a.js:1", severity: null, disposition: null }] }],
  };
  const r = contractReviewVerdict(block);
  assert.equal(r.failLoud, undefined);
  const data = r.contractData;
  assert.deepEqual([data.schema_version, data.rounds_total, data.round_history, data.adversarial_outcome, data.admitted_by], [1, 2, "recorded", "chain-outage-skipped", "build-judge"]);
  assert.deepEqual(Object.keys(data.findings[0]), ["location_present", "action_present", "finding_id", "title", "location", "action", "first_round", "last_round", "occurrences"]);
  const withoutCarry = structuredClone(block);
  delete withoutCarry.findings[0].carried_id;
  assert.deepEqual(computeReviewVerdict(withoutCarry), computeReviewVerdict(block));
  const mistyped = structuredClone(block);
  mistyped.findings[0].occurrences[0].round = "one";
  assert.match(contractReviewVerdict(mistyped).failLoud, /occurrences\[0\]\.round/);
  const dropped = computeReviewVerdict({ signal: "pass", round_history: "other", admitted_by: "me", rounds_total: "2", findings: [{ location_present: true, action_present: true, first_round: "1", title: 3 }] }).contractData;
  assert.deepEqual(Object.keys(dropped), ["signal", "findings", "conformant", "violations"]);
  assert.deepEqual(dropped.findings[0], { location_present: true, action_present: true });
});

// --- integration smoke --------------------------------------------------------------

test("smoke: recorded rounds collate into an anchor that validates and a floor that reads pass", (t) => {
  const root = mkdtempSync(join(tmpdir(), "faff-review-rounds-smoke-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.FAFF_RUN_DIR;
  delete env.FAFF_SESSION_ID;
  const git = (...a) => spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "README"), "seed\n");
  git("add", "README");
  git("commit", "-qm", "seed");
  const cli = (args, input) => runCli(args, { cwd: root, env, input });
  const mint = cli(["run-ledger", "init-interactive", "--issue", "ISSUE-1", "--root", root, "--json"]);
  assert.equal(mint.code, 0, mint.stderr);
  const runDir = JSON.parse(mint.stdout).run_dir;
  const rr = (block) => cli(["evidence", "record-review-round", "--run-dir", runDir, "--issue", "ISSUE-1"], JSON.stringify(block));
  assert.equal(rr({ signal: "fail", findings: [finding("leaks fd", "a.js:3")] }).code, 0);
  assert.equal(rr({ signal: "fail", findings: [finding("descriptor left open", "a.js:9", { carried_id: "P1" })] }).code, 0);
  assert.equal(rr({ signal: "pass", findings: [] }).code, 0);
  assert.equal(cli(["evidence", "write", "review-verdict", "--run-dir", runDir, "--issue", "ISSUE-1"], "").code, 0);
  const doc = JSON.parse(readFileSync(join(runDir, "ISSUE-1", "review-verdict.json"), "utf8"));
  assert.deepEqual([doc.findings.length, doc.findings[0].occurrences.length, doc.findings[0].disposition], [1, 2, "fixed"]);
  assert.equal(cli(["evidence", "write", "ac-checklist", "--run-dir", runDir, "--issue", "ISSUE-1"], JSON.stringify({ all_verified: true, criteria: [{ ac: "a", verified: "Verified: t", passed: true, ac_id: "issue-1#ac-1" }] })).code, 0);
  assert.equal(cli(["build-progress", "write", runDir, "ISSUE-1", "--build-complete", "--diff-hash", "a".repeat(64), "--branch", "b"]).code, 0);
  const dest = join(".faff", "anchors", "smoke", "ISSUE-1");
  const anchor = cli(["events", "anchor", "--run-dir", runDir, "--issue", "ISSUE-1", "--dest", dest]);
  assert.equal(anchor.code, 0, anchor.stderr);
  const report = JSON.parse(cli(["evidence", "validate", dest, "--json"]).stdout);
  for (const name of ["review-verdict.json", "ac-checklist.json"]) assert.ok(report.files.some((x) => x.path === name && x.status === "ok"), name);
  assert.equal(JSON.parse(readFileSync(join(root, dest, "review-verdict.json"), "utf8")).round_history, "recorded");
  assert.equal(readReviewVerdict(runDir, "ISSUE-1"), "pass");
});
