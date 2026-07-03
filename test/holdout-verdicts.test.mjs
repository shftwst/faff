// FAFF-277 — `faff holdout verdicts`: the pure, trust-gated bridge from the evaluator's persisted
// holdout verdicts (.faff/holdout/<issue|run>.json) to the already-shipped `faff prdr coverage
// --dod-verdicts` flag. Reads each verdict, re-validates it through the SAME computeHoldoutVerdict gate
// (never a forked rule), translates a passing meets-spec → the literal "met", folds conservatively per
// PRDR, and keys by the supplied issue→PRDR association. These tests exercise the CLI surface + the
// end-to-end pipe into `prdr coverage` (the consumer is unchanged — regression-guarded here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", input });
const holdout = (args, input) => run(["holdout", ...args], input);

// A conformant holdout-verdict block: code_blind + a single born-verifiable criterion whose verdict
// derives the given aggregate (met→meets-spec, unmet→fails).
const block = (aggregate, verdict, code_blind = true) => JSON.stringify({
  aggregate, code_blind,
  criteria: [{ class: "assertion", verdict, evidence_present: true }],
  violations: [],
});
const MEETS = block("meets-spec", "met");
const FAILS = block("fails", "unmet");

// A temp .faff/holdout store seeded with { "<key>.json": <body> }.
function store(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "faff-holdout-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}
const parse = (r) => JSON.parse(r.stdout);

test("--selftest passes", () => {
  const r = holdout(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /holdout --selftest: ok/);
});

test("conformant meets-spec + association → {prdr:'met'}, exit 0 (DONE: WHAT/translation)", () => {
  const dir = store({ "FAFF-34.json": MEETS });
  const r = holdout(["verdicts", "--association", '{"FAFF-34":"0007"}', "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(parse(r).verdicts, { "0007": "met" });
  rmSync(dir, { recursive: true, force: true });
});

test("code_blind:false → PRDR absent, skipped contract-rejected (DONE: trust gate)", () => {
  const dir = store({ "FAFF-34.json": block("meets-spec", "met", false) });
  const r = holdout(["verdicts", "--association", '{"FAFF-34":"0007"}', "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = parse(r);
  assert.equal("0007" in out.verdicts, false);
  assert.ok(out.skipped.some((s) => s.key === "FAFF-34" && s.reason === "contract-rejected"));
  rmSync(dir, { recursive: true, force: true });
});

test("conformant fails → verdicts[prdr]=='fails' (≠ met) (DONE: translation pass-through)", () => {
  const dir = store({ "FAFF-B.json": FAILS });
  const r = holdout(["verdicts", "--association", '{"FAFF-B":"0008"}', "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(parse(r).verdicts["0008"], "fails");
  rmSync(dir, { recursive: true, force: true });
});

test("empty --dir → empty verdicts, exit 0 (DONE: edge case)", () => {
  const dir = store();
  const r = holdout(["verdicts", "--association", '{"FAFF-34":"0007"}', "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(parse(r).verdicts, {});
  rmSync(dir, { recursive: true, force: true });
});

test("absent --dir → empty verdicts, exit 0 (the 'nothing trusted yet' answer)", () => {
  const r = holdout(["verdicts", "--association", '{"x":"1"}', "--dir", "/no/such/holdout/dir", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(parse(r).verdicts, {});
});

test("conservative fold: two trusted files one PRDR, meets+fails → not met (DONE: fold)", () => {
  const dir = store({ "FAFF-A.json": MEETS, "FAFF-B.json": FAILS });
  const r = holdout(["verdicts", "--association", '{"FAFF-A":"0007","FAFF-B":"0007"}', "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(parse(r).verdicts["0007"], "met");
  rmSync(dir, { recursive: true, force: true });
});

test("conservative fold: two trusted met files one PRDR → met", () => {
  const dir = store({ "FAFF-A.json": MEETS, "FAFF-C.json": MEETS });
  const r = holdout(["verdicts", "--association", '{"FAFF-A":"0007","FAFF-C":"0007"}', "--dir", dir, "--json"]);
  assert.equal(parse(r).verdicts["0007"], "met");
  rmSync(dir, { recursive: true, force: true });
});

test("a holdout key absent from the association → skipped no-association (a PRDR is never guessed)", () => {
  const dir = store({ "FAFF-X.json": MEETS });
  const r = holdout(["verdicts", "--association", "{}", "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = parse(r);
  assert.deepEqual(out.verdicts, {});
  assert.ok(out.skipped.some((s) => s.key === "FAFF-X" && s.reason === "no-association"));
  rmSync(dir, { recursive: true, force: true });
});

test("malformed holdout JSON → skipped unreadable, never met", () => {
  const dir = store({ "FAFF-A.json": "{not json", "FAFF-B.json": MEETS });
  const r = holdout(["verdicts", "--association", '{"FAFF-A":"0007","FAFF-B":"0008"}', "--dir", dir, "--json"]);
  const out = parse(r);
  assert.equal("0007" in out.verdicts, false);
  assert.equal(out.verdicts["0008"], "met");
  assert.ok(out.skipped.some((s) => s.key === "FAFF-A" && s.reason === "unreadable"));
  rmSync(dir, { recursive: true, force: true });
});

test("--association via @file and via stdin both work", () => {
  const dir = store({ "FAFF-A.json": MEETS });
  const assocFile = join(dir, "assoc.json");
  writeFileSync(assocFile, '{"FAFF-A":"0007"}');
  // @file (the assoc.json is not *.json-loaded as a holdout — it has no association entry for itself anyway)
  const rFile = holdout(["verdicts", "--association", `@${assocFile}`, "--dir", dir, "--json"]);
  assert.equal(parse(rFile).verdicts["0007"], "met");
  // stdin
  const rStdin = holdout(["verdicts", "--association", "-", "--dir", dir, "--json"], '{"FAFF-A":"0007"}');
  assert.equal(parse(rStdin).verdicts["0007"], "met");
  rmSync(dir, { recursive: true, force: true });
});

test("usage errors → exit 2: missing/non-object/malformed --association, unreadable --dir, wrong action", () => {
  const dir = store({ "FAFF-A.json": MEETS });
  assert.equal(holdout(["verdicts", "--dir", dir]).status, 2, "missing --association");
  assert.equal(holdout(["verdicts", "--association", "[1,2]", "--dir", dir]).status, 2, "array --association");
  assert.equal(holdout(["verdicts", "--association", "{not json", "--dir", dir]).status, 2, "malformed --association JSON");
  assert.equal(holdout(["verdicts", "--association", "{}", "--dir", join(dir, "FAFF-A.json")]).status, 2, "unreadable --dir (a file)");
  assert.equal(holdout(["bogus", "--association", "{}"]).status, 2, "unknown action");
  rmSync(dir, { recursive: true, force: true });
});

test("never exit 1 — report-only parity with coverage/yagni", () => {
  const dir = store({ "FAFF-A.json": block("meets-spec", "met", false) }); // all contract-rejected
  const r = holdout(["verdicts", "--association", '{"FAFF-A":"0007"}', "--dir", dir, "--json"]);
  assert.equal(r.status, 0, "even an all-rejected store is exit 0, never 1");
  rmSync(dir, { recursive: true, force: true });
});

// --- Integration smoke: the plumbing-connected path into the unchanged coverage consumer (DONE: From WHY) ---
test("end-to-end: holdout verdicts → prdr coverage --dod-verdicts rolls prd-satisfied up", () => {
  const dir = store({ "FAFF-A.json": MEETS, "FAFF-B.json": FAILS });
  const assoc = '{"FAFF-A":"0007","FAFF-B":"0008"}';
  const live = '[{"id":"0007","prd_goal":"g7"},{"id":"0008","prd_goal":"g8"}]';
  const goals = '["g7","g8"]';

  const out = parse(holdout(["verdicts", "--association", assoc, "--dir", dir, "--json"]));
  assert.deepEqual(out.verdicts, { "0007": "met", "0008": "fails" });

  const cov1 = parse(run(["prdr", "coverage", "--prd-goals", goals, "--live-prdrs", live, "--dod-verdicts", JSON.stringify(out.verdicts)]));
  assert.equal(cov1.satisfied, false, "a failing DoD blocks prd-satisfied");
  assert.ok(cov1.completion.unmet_or_unverified.includes("0008"));

  // The produced map conforms to the prd-coverage contract (the gate the run-terminator consumes).
  const contract = run(["contract", "prd-coverage"], JSON.stringify(cov1));
  assert.equal(contract.status, 0, contract.stderr);

  // Flip B to meets-spec, re-run → prd-satisfied becomes true (covered ∧ all DoDs met).
  writeFileSync(join(dir, "FAFF-B.json"), MEETS);
  const out2 = parse(holdout(["verdicts", "--association", assoc, "--dir", dir, "--json"]));
  assert.deepEqual(out2.verdicts, { "0007": "met", "0008": "met" });
  const cov2 = parse(run(["prdr", "coverage", "--prd-goals", goals, "--live-prdrs", live, "--dod-verdicts", JSON.stringify(out2.verdicts)]));
  assert.equal(cov2.satisfied, true, "covered ∧ all DoDs met → prd-satisfied");
  rmSync(dir, { recursive: true, force: true });
});

test("regression guard: prdr --selftest (the 58-case coverage table) still passes — consumer unchanged", () => {
  const r = run(["prdr", "--selftest"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /prdr --selftest: ok/);
});

// --- FAFF-311: the singular per-issue merge-floor gate `faff holdout verdict --issue <id>` ---
// The graft Step-10 call-site (Decision 4 → Option A). Reuses the SAME computeHoldoutVerdict trust gate
// as the run-bridge, reduced to one pass/block decision, keyed to the issue, before the PRDR fold. The
// exit code IS the gate: 0=pass, 1=block, 2=usage. Fail-closed on every non-meets-spec / missing / malformed.
const seedOne = (issue, body) => { const dir = store({ [`${issue}.json`]: body }); return dir; };

test("gate: conformant code-blind meets-spec → pass, exit 0 (DONE: the only pass condition)", () => {
  const dir = seedOne("FAFF-311", MEETS);
  const r = holdout(["verdict", "--issue", "FAFF-311", "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = parse(r);
  assert.equal(out.gate, "pass");
  assert.equal(out.aggregate, "meets-spec");
  assert.equal(out.code_blind, true);
  rmSync(dir, { recursive: true, force: true });
});

test("gate: fails → block, exit 1, reason carries the aggregate (DONE: fails never merges)", () => {
  const dir = seedOne("FAFF-A", FAILS);
  const r = holdout(["verdict", "--issue", "FAFF-A", "--dir", dir, "--json"]);
  assert.equal(r.status, 1, "a failing verdict blocks (exit 1)");
  assert.equal(parse(r).gate, "block");
  assert.equal(parse(r).reason, "fails");
  rmSync(dir, { recursive: true, force: true });
});

test("gate: code_blind:false meets-spec → block, exit 1 (DONE: a non-blind verdict never merges)", () => {
  const dir = seedOne("FAFF-NB", block("meets-spec", "met", false));
  const r = holdout(["verdict", "--issue", "FAFF-NB", "--dir", dir, "--json"]);
  assert.equal(r.status, 1, "non-blind is structurally inadmissible — block");
  assert.equal(parse(r).gate, "block");
  assert.equal(parse(r).reason, "contract-rejected");
  rmSync(dir, { recursive: true, force: true });
});

test("gate: incoherent (aggregate lies about criteria) → block via contract violation, exit 1", () => {
  // meets-spec declared but the single criterion is unmet → derivation is 'fails' → contract-rejected.
  const dir = seedOne("FAFF-IC", block("meets-spec", "unmet"));
  const r = holdout(["verdict", "--issue", "FAFF-IC", "--dir", dir, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(parse(r).reason, "contract-rejected");
  rmSync(dir, { recursive: true, force: true });
});

test("gate: gaps / needs-human → block, exit 1 (DONE: only meets-spec passes)", () => {
  const gaps = JSON.stringify({ aggregate: "gaps", code_blind: true,
    criteria: [{ class: "assertion", verdict: "met", evidence_present: true }, { class: "assertion", verdict: "unmet", evidence_present: true }], violations: [] });
  const dir = seedOne("FAFF-GP", gaps);
  const r = holdout(["verdict", "--issue", "FAFF-GP", "--dir", dir, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(parse(r).reason, "gaps");
  rmSync(dir, { recursive: true, force: true });
});

test("gate: missing verdict file → block 'missing', exit 1 (DONE: fail-closed, never a silent pass)", () => {
  const dir = store();  // empty store, no file for this issue
  const r = holdout(["verdict", "--issue", "FAFF-ABSENT", "--dir", dir, "--json"]);
  assert.equal(r.status, 1, "a missing verdict blocks — never silently passes");
  assert.equal(parse(r).gate, "block");
  assert.equal(parse(r).reason, "missing");
  rmSync(dir, { recursive: true, force: true });
});

test("gate: malformed verdict JSON → block 'unreadable', exit 1 (fail-closed)", () => {
  const dir = seedOne("FAFF-BAD", "{not json");
  const r = holdout(["verdict", "--issue", "FAFF-BAD", "--dir", dir, "--json"]);
  assert.equal(r.status, 1);
  assert.equal(parse(r).reason, "unreadable");
  rmSync(dir, { recursive: true, force: true });
});

test("gate: missing --issue → exit 2 (usage), not a silent block", () => {
  const dir = store();
  assert.equal(holdout(["verdict", "--dir", dir]).status, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("gate + bridge are one artifact, two consumers: the SAME file feeds both, unchanged (Decision 4 → Option A)", () => {
  // The per-issue gate blocks locally; the same file rolls up through `holdout verdicts --association`.
  const dir = store({ "FAFF-One.json": MEETS });
  const gate = holdout(["verdict", "--issue", "FAFF-One", "--dir", dir, "--json"]);
  assert.equal(gate.status, 0, "gate passes on the per-issue file");
  const roll = holdout(["verdicts", "--association", '{"FAFF-One":"0007"}', "--dir", dir, "--json"]);
  assert.equal(parse(roll).verdicts["0007"], "met", "the same file feeds the run roll-up unchanged");
  rmSync(dir, { recursive: true, force: true });
});
