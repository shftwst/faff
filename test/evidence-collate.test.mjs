// FAFF-1267 — collate every spec-review round into one digest-checked comment, and write the
// v0.3 spec-review-verdict.json from it. Covers the collator, the rendered comment, the writer's
// refusals and path guards, redaction before rendering, and the normaliser pass-through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_VERDICTS, REVIEW_DISPOSITIONS } from "../plugin/skills/faff/bin/lib/review-vocab.js";
import * as contractDefs from "../plugin/skills/faff/bin/lib/contract-defs.js";
import * as churn from "../plugin/skills/faff/bin/lib/spec-review-churn.js";
import { collateSpecReviewRounds, extractSpecReviewEvidence } from "../plugin/skills/faff/bin/lib/evidence-collate.js";
import * as specReview from "../plugin/skills/faff/bin/lib/spec-review.js";

const SECRET = "supersecretvalue-0123456789";
const obj = (lens, severity, extra = {}) => ({ lens, severity, ...extra });

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "faff-collate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scratch = join(root, "scratch");
  const runDir = join(root, ".faff", "runs", "run-x");
  mkdirSync(scratch, { recursive: true });
  mkdirSync(join(runDir, "ISSUE-1"), { recursive: true });
  const round = (n, verdict, objections) => writeFileSync(join(scratch, `round-${n}.json`), JSON.stringify({ verdict, objections }));
  const dispositions = (entries) => {
    const file = join(root, "dispositions.json");
    writeFileSync(file, JSON.stringify(entries));
    return file;
  };
  const collate = (...args) => runCli(["spec-review", "collate-evidence", "--dir", scratch, ...args], { cwd: root });
  const write = (input, runDirArg = runDir, issue = "ISSUE-1", cwd = root) => runCli(["evidence", "write", "spec-review-verdict", "--run-dir", runDirArg, "--issue", issue], { input, cwd });
  return { root, scratch, runDir, round, dispositions, collate, write, out: () => join(runDir, "ISSUE-1", "spec-review-verdict.json") };
}

function threeRounds(f) {
  f.round(1, "revise", [obj("architectural", "major", { claim: "C", evidence: "E1", spec_anchor: "storage" }), obj("QA", "minor", { claim: "D" })]);
  f.round(2, "revise", [obj("architectural", "blocker", { claim: "C", evidence: "E2", spec_anchor: "storage" }), obj("infosec", "minor")]);
  f.round(3, "approve", []);
}

const allFixed = (keys) => keys.map(({ key, lens }) => ({ key, lens, disposition: "fixed", disposition_rationale: `done ${key}` }));
const keysOf = (f) => JSON.parse(f.collate().stdout).objections.map((o) => ({ key: o.key, lens: o.lens }));
const commentOf = (f, entries) => {
  const c = f.collate("--dispositions", f.dispositions(entries ?? allFixed(keysOf(f))), "--comment");
  assert.equal(c.code, 0, c.stderr);
  return c.stdout;
};
const blockLine = (comment) => comment.split("\n").find((l) => l.startsWith("{"));
const digestOf = (comment) => comment.match(/^sha256: ([0-9a-f]{64})$/m)[1];

test("the vocabulary is re-exported under the same names and the churn module has no local list", () => {
  assert.deepEqual(contractDefs.SPEC_REVIEW_LENSES, SPEC_REVIEW_LENSES);
  assert.deepEqual(contractDefs.SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_SEVERITIES);
  assert.deepEqual(contractDefs.SPEC_REVIEW_VERDICTS, SPEC_REVIEW_VERDICTS);
  assert.deepEqual(contractDefs.REVIEW_DISPOSITIONS, REVIEW_DISPOSITIONS);
  assert.equal(churn.SPEC_REVIEW_LENSES, SPEC_REVIEW_LENSES);
  assert.equal(specReview.extractSpecReviewEvidence, extractSpecReviewEvidence);
});

test("collation keeps every objection of every round as its own keyed item and leaves round files untouched", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const before = readdirSync(f.scratch).map((n) => readFileSync(join(f.scratch, n), "utf8"));
  const plain = f.collate();
  assert.equal(plain.code, 0);
  const rec = JSON.parse(plain.stdout);
  assert.equal(rec.verdict, "revise");
  assert.equal(rec.final_verdict, "approve");
  assert.equal(rec.rounds_total, 3);
  assert.deepEqual(rec.objections.map((o) => o.key), ["1#0", "1#1", "2#0", "2#1"]);
  assert.deepEqual(rec.objections.map((o) => [o.first_round, o.last_round, o.occurrences.length]), [[1, 1, 1], [1, 1, 1], [2, 2, 1], [2, 2, 1]]);
  assert.equal(rec.objections[0].evidence, "E1");
  assert.equal(rec.objections[2].evidence, "E2");
  assert.deepEqual(readdirSync(f.scratch).map((n) => readFileSync(join(f.scratch, n), "utf8")), before);
});

test("two objections on one heading in one round stay two items with their own dispositions", (t) => {
  const f = fixture(t);
  f.round(1, "revise", [obj("methodology", "major", { claim: "a", spec_anchor: "2-out-of-scope" }), obj("methodology", "major", { claim: "b", spec_anchor: "2-out-of-scope" })]);
  const entries = [{ key: "1#0", lens: "methodology", disposition: "fixed" }, { key: "1#1", lens: "methodology", disposition: "accepted-risk", disposition_rationale: "why" }];
  const comment = commentOf(f, entries);
  const block = JSON.parse(blockLine(comment));
  assert.deepEqual(block.objections.map((o) => o.disposition), ["fixed", "accepted-risk"]);
});

test("the rendered block has no key fields, passes the contract and the writer, and the digest matches its line", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const comment = commentOf(f);
  const block = blockLine(comment);
  assert.ok(!block.includes('"key"'));
  assert.equal(digestOf(comment), createHash("sha256").update(block, "utf8").digest("hex"));
  assert.match(comment, /^## Spec-review evidence\n\n3 rounds, 4 objections \(round 1: 2, round 2: 2, round 3: 0\)\n/);
  assert.match(comment, /- \[round 1\] architectural major \(storage\): fixed\n/);
  assert.match(comment, /- \[round 1\] QA minor \(no anchor\): fixed\n/);
  const contract = runCli(["contract", "spec-review-verdict"], { input: block });
  assert.equal(contract.code, 0, contract.stderr + contract.stdout);
  const w = f.write(comment);
  assert.equal(w.code, 0, w.stderr);
  const doc = JSON.parse(readFileSync(f.out(), "utf8"));
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.objections.length, 4);
  assert.deepEqual(Object.keys(doc.objections[1]), ["lens", "severity", "claim", "evidence", "predicted_consequence", "spec_anchor", "disposition", "refutation", "disposition_rationale", "first_round", "last_round", "occurrences"]);
  assert.equal(doc.objections[1].evidence, null);
  assert.ok(readFileSync(f.out(), "utf8").endsWith("}\n"));
});

test("a comment with CRLF line endings still verifies", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const w = f.write(commentOf(f).replace(/\n/g, "\r\n"));
  assert.equal(w.code, 0, w.stderr);
});

test("the writer is byte-deterministic", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const comment = commentOf(f);
  f.write(comment);
  const first = readFileSync(f.out());
  rmSync(f.out());
  f.write(comment);
  assert.deepEqual(readFileSync(f.out()), first);
});

test("without --dispositions every objection renders unsettled and carries no disposition", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const c = f.collate("--comment");
  assert.equal(c.code, 0);
  assert.match(c.stdout, /\(storage\): unsettled\n/);
  assert.ok(!JSON.parse(blockLine(c.stdout)).objections.some((o) => "disposition" in o));
});

test("collate-evidence --comment exits 1 and prints nothing for each dispositions fault", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const keys = keysOf(f);
  const good = allFixed(keys);
  const cases = {
    uncovered: good.slice(1),
    unknown: [...good, { key: "9#9", lens: "QA", disposition: "fixed" }],
    duplicate: [...good, good[0]],
    "lens mismatch": good.map((e, i) => (i === 0 ? { ...e, lens: "QA" } : e)),
    "bad disposition": good.map((e, i) => (i === 0 ? { ...e, disposition: "waved-through" } : e)),
  };
  for (const [label, entries] of Object.entries(cases)) {
    const r = f.collate("--dispositions", f.dispositions(entries), "--comment");
    assert.equal(r.code, 1, label);
    assert.equal(r.stdout, "", label);
  }
  const notJson = join(f.root, "bad.json");
  writeFileSync(notJson, "{");
  assert.equal(f.collate("--dispositions", notJson, "--comment").code, 1);
});

test("a dispositions file built before a later round was written leaves that key uncovered", (t) => {
  const f = fixture(t);
  f.round(1, "revise", [obj("QA", "minor")]);
  f.round(2, "revise", [obj("QA", "minor")]);
  const early = f.dispositions([{ key: "1#0", lens: "QA", disposition: "fixed" }, { key: "2#0", lens: "QA", disposition: "fixed" }]);
  f.round(3, "revise", [obj("QA", "minor")]);
  const r = f.collate("--dispositions", early, "--comment");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /uncovered key 3#0/);
  assert.equal(r.stdout, "");
});

test("a round that is not a conformant round is skipped and named, and the rest collate", (t) => {
  const f = fixture(t);
  f.round(1, "revise", [obj("architectural", "major")]);
  f.round(2, "revise", [obj("security", "major")]);
  writeFileSync(join(f.scratch, "round-3.json"), "{ not json");
  f.round(4, "approve", [obj("QA", "minor")]);
  f.round(5, "approve", []);
  const r = f.collate("--dispositions", f.dispositions([{ key: "1#0", lens: "architectural", disposition: "fixed" }]), "--comment");
  assert.equal(r.code, 0, r.stderr);
  for (const name of ["round-2.json", "round-3.json", "round-4.json"]) assert.match(r.stderr, new RegExp(name));
  const block = JSON.parse(blockLine(r.stdout));
  assert.equal(block.rounds_total, 2);
  assert.equal(block.objections.length, 1);
  assert.equal(runCli(["contract", "spec-review-verdict"], { input: blockLine(r.stdout) }).code, 0);
  assert.equal(f.write(r.stdout).code, 0);
});

test("a loop accepted with objections in its last round carries that verdict as both verdicts", (t) => {
  const f = fixture(t);
  f.round(1, "revise", [obj("QA", "minor")]);
  const rec = JSON.parse(f.collate().stdout);
  assert.equal(rec.verdict, "revise");
  assert.equal(rec.final_verdict, "revise");
});

test("an unreadable --dir exits 2", (t) => {
  const f = fixture(t);
  assert.equal(runCli(["spec-review", "collate-evidence", "--dir", join(f.root, "nope")], { cwd: f.root }).code, 2);
  assert.equal(runCli(["spec-review", "collate-evidence"], { cwd: f.root }).code, 2);
});

test("select-evidence is gone", (t) => {
  const f = fixture(t);
  assert.equal(runCli(["spec-review", "select-evidence", "--dir", f.scratch], { cwd: f.root }).code, 2);
  assert.equal(specReview.selectEvidenceVerdict, undefined);
});

test("a configured known secret is redacted in the comment, its digest input and the anchored file", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".faffrc.yaml"), `andon:\n  token: ${SECRET}\n`);
  f.round(1, "revise", [obj("QA", "minor", { evidence: `leaked ${SECRET} here` })]);
  const c = f.collate("--dispositions", f.dispositions([{ key: "1#0", lens: "QA", disposition: "fixed", disposition_rationale: `cleared ${SECRET}` }]), "--comment");
  assert.equal(c.code, 0, c.stderr);
  assert.ok(!c.stdout.includes(SECRET));
  assert.ok(c.stdout.includes("[REDACTED]"));
  assert.equal(digestOf(c.stdout), createHash("sha256").update(blockLine(c.stdout), "utf8").digest("hex"));
  assert.equal(f.write(c.stdout).code, 0);
  assert.ok(!readFileSync(f.out(), "utf8").includes(SECRET));
});

test("the writer redacts again, so an unredacted carried block never reaches the anchor", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const block = JSON.parse(blockLine(commentOf(f)));
  block.objections[0].evidence = `raw ${SECRET}`;
  const line = JSON.stringify(block);
  const comment = `## Spec-review evidence\n\n\`\`\`faff-contract:spec-review-verdict\n${line}\n\`\`\`\nsha256: ${createHash("sha256").update(line).digest("hex")}\n`;
  writeFileSync(join(f.root, ".faffrc.yaml"), `andon:\n  token: ${SECRET}\n`);
  assert.equal(f.write(comment).code, 0);
  assert.ok(!readFileSync(f.out(), "utf8").includes(SECRET));
});

test("a malformed redaction config exits 2 from both verbs with nothing printed or written", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const comment = commentOf(f);
  writeFileSync(join(f.root, ".faffrc.yaml"), "- not\n- a map\n");
  const c = f.collate("--comment");
  assert.equal(c.code, 2);
  assert.equal(c.stdout, "");
  const w = f.write(comment);
  assert.equal(w.code, 2);
  assert.equal(w.stdout, "");
  assert.ok(!existsSync(f.out()));
});

test("the writer exits 1 and writes nothing for each refused input", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const comment = commentOf(f);
  const block = blockLine(comment);
  const fence = (body, digest) => `## Spec-review evidence\n\n\`\`\`faff-contract:spec-review-verdict\n${body}\n\`\`\`\n${digest === null ? "" : `sha256: ${digest}\n`}`;
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  const reDigest = (mutate) => { const b = JSON.parse(block); mutate(b); const line = JSON.stringify(b); return fence(line, sha(line)); };
  const cases = {
    "no section": "# nothing here\n",
    "no fence": "## Spec-review evidence\n\nprose\n",
    "missing digest": fence(block, null),
    "edited block": comment.replace('"claim":"C"', '"claim":"changed"'),
    "multi-line fence body": fence(JSON.stringify(JSON.parse(block), null, 2), sha(block)),
    "pre-collation block": fence(JSON.stringify({ verdict: "revise", objections: [{ lens: "QA", severity: "minor" }] }), sha(JSON.stringify({ verdict: "revise", objections: [{ lens: "QA", severity: "minor" }] }))),
    "approve with objections": reDigest((b) => { b.verdict = "approve"; }),
    "revise without objections": reDigest((b) => { b.objections = []; }),
    "out-of-enum lens": reDigest((b) => { b.objections[0].lens = "security"; }),
    "out-of-enum severity": reDigest((b) => { b.objections[0].severity = "huge"; }),
    "out-of-enum disposition": reDigest((b) => { b.objections[0].disposition = "waved"; }),
    "round outside rounds_total": reDigest((b) => { b.objections[0].last_round = 9; }),
    "occurrence outside its round range": reDigest((b) => { b.objections[0].occurrences[0].round = 3; }),
  };
  for (const [label, input] of Object.entries(cases)) {
    const w = f.write(input);
    assert.equal(w.code, 1, `${label}: ${w.stderr}`);
    assert.equal(w.stdout, "", label);
    assert.ok(!existsSync(f.out()), label);
  }
});

test("a git-only spec with the comment under its last heading is parsed by the writer", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const spec = `# A spec\n\nBody.\n\n## Done\n\n- item\n\n${commentOf(f)}`;
  assert.equal(f.write(spec).code, 0);
});

test("the writer exits 2 and writes nothing for a bad issue id and for a run dir outside .faff/runs", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const comment = commentOf(f);
  for (const issue of ["../x", "a/b", "", ".hidden"]) assert.equal(f.write(comment, f.runDir, issue).code, 2, issue);
  const elsewhere = join(f.root, "elsewhere");
  mkdirSync(elsewhere);
  assert.equal(f.write(comment, elsewhere).code, 2);
  assert.equal(f.write(comment, join(f.root, ".faff", "runs")).code, 2);
  const outside = mkdtempSync(join(tmpdir(), "faff-collate-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(f.root, ".faff", "runs", "linked"));
  assert.equal(f.write(comment, join(f.root, ".faff", "runs", "linked")).code, 2);
  assert.deepEqual(readdirSync(outside), []);
  symlinkSync(outside, join(f.runDir, "ISSUE-2"));
  assert.equal(f.write(comment, f.runDir, "ISSUE-2").code, 2);
  assert.deepEqual(readdirSync(outside), []);
});

test("a run dir in the main checkout is accepted when run from a linked worktree", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const comment = commentOf(f);
  const git = (...args) => execFileSync("git", ["-C", f.root, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { stdio: "pipe" });
  git("init", "-q");
  writeFileSync(join(f.root, "a.txt"), "a");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
  const worktree = join(f.root, "wt");
  git("worktree", "add", "-q", worktree, "-b", "linked");
  const w = f.write(comment, f.runDir, "ISSUE-1", worktree);
  assert.equal(w.code, 0, w.stderr);
  assert.ok(existsSync(f.out()));
});

test("the normaliser treats null optionals as absent and passes the collated fields through", () => {
  const base = { verdict: "revise", final_verdict: "approve", rounds_total: 2, schema_version: 1, objections: [{ lens: "QA", severity: "minor", claim: null, evidence: null, disposition: null, refutation: null, first_round: 1, last_round: 1, occurrences: [{ round: 1, severity: "minor" }] }] };
  const ok = contractDefs.computeSpecReviewVerdict(base);
  assert.deepEqual(ok.contractData.violations, []);
  assert.equal(ok.contractData.rounds_total, 2);
  assert.equal(ok.contractData.final_verdict, "approve");
  assert.equal(ok.contractData.schema_version, 1);
  assert.deepEqual(ok.contractData.objections[0], { lens: "QA", severity: "minor", first_round: 1, last_round: 1, occurrences: [{ round: 1, severity: "minor" }] });
  assert.equal(contractDefs.contractSpecReviewVerdict(base).failLoud, undefined);
  const mistyped = (mutate) => { const b = JSON.parse(JSON.stringify(base)); mutate(b); return contractDefs.contractSpecReviewVerdict(b); };
  assert.ok(mistyped((b) => { b.rounds_total = "2"; }).failLoud);
  assert.ok(mistyped((b) => { b.final_verdict = "maybe"; }).failLoud);
  assert.ok(mistyped((b) => { b.objections[0].first_round = "1"; }).failLoud);
  assert.ok(mistyped((b) => { b.objections[0].occurrences = [{ round: "1", severity: "minor" }]; }).failLoud);
});

test("the collator counts the sum of every valid round's objections", (t) => {
  const f = fixture(t);
  threeRounds(f);
  const { record } = collateSpecReviewRounds(f.scratch, []);
  assert.equal(record.objections.length, 4);
});

test("smoke: the written file validates as ok in an anchor directory", (t) => {
  const f = fixture(t);
  threeRounds(f);
  assert.equal(f.write(commentOf(f)).code, 0);
  const dest = join(f.root, "anchor");
  mkdirSync(dest);
  writeFileSync(join(dest, "spec-review-verdict.json"), readFileSync(f.out()));
  const report = JSON.parse(runCli(["evidence", "validate", dest, "--json"], { cwd: f.root }).stdout);
  assert.equal(report.status, "pass");
  assert.equal(report.files.find((e) => e.path === "spec-review-verdict.json").status, "ok");
});
