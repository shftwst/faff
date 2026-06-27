// FAFF-267 — the L4 adversarial spec reviewer's majority/severity aggregation: pure functions +
// the contract-block emission + the CLI selftest. Zero live model calls — aggregation is pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregate, strictMajority, mapSeverity, renderBlock, SEVERITY_MAP,
} from "../plugin/skills/faffter-dark-spec-review/aggregate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGG = join(HERE, "..", "plugin", "skills", "faffter-dark-spec-review", "aggregate.mjs");
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

// builders
const r = (lens, sev) => ({ lens, outcome: "refuted", objections: sev ? [{ severity: sev }] : [] });
const clear = (lens) => ({ lens, outcome: "clear", objections: [] });
const down = (lens, kind) => ({ lens, outcome: "unavailable", kind, objections: [] });

test("strictMajority is ceil((n+1)/2) for n=1..4", () => {
  assert.equal(strictMajority(1), 1);
  assert.equal(strictMajority(2), 2);
  assert.equal(strictMajority(3), 2);
  assert.equal(strictMajority(4), 3);
});

test("mapSeverity folds the adversarial vocab onto the contract enum, observation→null", () => {
  assert.equal(mapSeverity("critical"), "blocker");
  assert.equal(mapSeverity("major"), "major");
  assert.equal(mapSeverity("minor"), "minor");
  assert.equal(mapSeverity("observation"), null);
  assert.equal(mapSeverity("nonsense"), null);
  assert.equal(SEVERITY_MAP.critical, "blocker");
});

test("scenario: 2/4 major refuted (no critical) → revise; a 3rd flips to reject-approach", () => {
  let v = aggregate([r("architectural", "major"), r("infosec", "major"), clear("methodology"), clear("QA")], 4);
  assert.equal(v.verdict, "revise");
  assert.equal(v.objections.length, 2);
  v = aggregate([r("architectural", "major"), r("infosec", "major"), r("methodology", "major"), clear("QA")], 4);
  assert.equal(v.verdict, "reject-approach");
});

test("any critical → reject-approach regardless of the other lenses, emitted as blocker", () => {
  const v = aggregate([r("architectural", "critical"), clear("infosec"), clear("methodology"), clear("QA")], 4);
  assert.equal(v.verdict, "reject-approach");
  assert.deepEqual(v.objections, [{ lens: "architectural", severity: "blocker" }]);
});

test("all clear → approve with no objections (founded-verdict invariant)", () => {
  const v = aggregate([clear("architectural"), clear("infosec"), clear("methodology"), clear("QA")], 4);
  assert.equal(v.verdict, "approve");
  assert.deepEqual(v.objections, []);
});

test("a config-fault unavailable lens forces needs-human even when others are clear, naming it", () => {
  const v = aggregate([down("infosec", "config-fault"), clear("architectural"), clear("methodology"), clear("QA")], 4);
  assert.equal(v.verdict, "needs-human");
  assert.ok(v.objections.some((o) => o.lens === "infosec" && o.severity === "blocker"));
});

test("an infra-configured down lens → needs-human when it could swing, reject when it cannot", () => {
  let v = aggregate([down("infosec", "infra-configured"), clear("architectural"), clear("methodology"), clear("QA")], 4);
  assert.equal(v.verdict, "needs-human", "missing lens could swing a clean board");
  v = aggregate([down("infosec", "infra-configured"), r("architectural", "critical"), clear("methodology"), clear("QA")], 4);
  assert.equal(v.verdict, "reject-approach", "available critical already forces reject; missing lens cannot change it");
});

test("majority math for small enabled sets — n=1 single refute is already a majority", () => {
  assert.equal(aggregate([r("architectural", "minor")], 1).verdict, "reject-approach");
  assert.equal(aggregate([clear("architectural")], 1).verdict, "approve");
  // n=2: one refuter is a minority (revise), two is the majority (reject)
  assert.equal(aggregate([r("architectural", "major"), clear("infosec")], 2).verdict, "revise");
  assert.equal(aggregate([r("architectural", "major"), r("infosec", "major")], 2).verdict, "reject-approach");
});

test("observation-only objections are advisory — the lens is clear, not refuted", () => {
  const v = aggregate([{ lens: "QA", outcome: "refuted", objections: [{ severity: "observation" }] }, clear("architectural")], 2);
  assert.equal(v.verdict, "approve");
});

test("every non-approve verdict carries ≥1 objection; approve carries none", () => {
  const cases = [
    aggregate([r("architectural", "major"), clear("infosec")], 2),       // revise
    aggregate([down("infosec", "config-fault"), clear("architectural")], 2), // needs-human
    aggregate([r("architectural", "critical")], 1),                       // reject-approach
    aggregate([clear("architectural")], 1),                              // approve
  ];
  for (const v of cases) {
    if (v.verdict === "approve") assert.equal(v.objections.length, 0);
    else assert.ok(v.objections.length >= 1, `${v.verdict} must carry ≥1 objection`);
  }
});

test("renderBlock emits exactly one faff-contract:spec-review-verdict fenced block", () => {
  const out = renderBlock({ verdict: "approve", objections: [] });
  assert.match(out, /^```faff-contract:spec-review-verdict\n/);
  assert.match(out, /\n```\n$/);
  const json = out.split("\n")[1];
  assert.deepEqual(JSON.parse(json), { verdict: "approve", objections: [] });
});

test("aggregate.mjs --selftest passes", () => {
  const res = spawnSync(process.execPath, [AGG, "--selftest"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /aggregate --selftest: ok/);
});

test("aggregate.mjs CLI fail-safe: empty/inconsistent input exits non-zero (never a silent approve)", () => {
  // empty refutation set → refuse to vote (would otherwise approve)
  let res = spawnSync(process.execPath, [AGG], { input: JSON.stringify({ refutations: [], enabled_lenses: ["architectural"] }), encoding: "utf8" });
  assert.notEqual(res.status, 0, "empty set must not exit 0");
  assert.doesNotMatch(res.stdout, /spec-review-verdict/, "no verdict block emitted for an empty set");
  // a bare empty array likewise
  res = spawnSync(process.execPath, [AGG], { input: "[]", encoding: "utf8" });
  assert.notEqual(res.status, 0);
  // refutation count disagreeing with --n → refuse
  res = spawnSync(process.execPath, [AGG, "--n", "4"], { input: JSON.stringify([r("architectural", "major")]), encoding: "utf8" });
  assert.notEqual(res.status, 0, "count != n must not exit 0");
  // unparseable JSON → non-zero (no fabricated verdict)
  res = spawnSync(process.execPath, [AGG], { input: "{ not json", encoding: "utf8" });
  assert.notEqual(res.status, 0);
});

test("aggregate.mjs CLI: stdin refutations → a contract block that validates against faff contract", () => {
  const input = JSON.stringify({
    enabled_lenses: ["architectural", "infosec", "methodology", "QA"],
    refutations: [r("architectural", "critical"), clear("infosec"), clear("methodology"), clear("QA")],
  });
  const agg = spawnSync(process.execPath, [AGG], { input, encoding: "utf8" });
  assert.equal(agg.status, 0, agg.stderr);
  // extract the JSON line from the fenced block and pipe it to the contract validator
  const json = agg.stdout.split("\n").find((l) => l.trim().startsWith("{"));
  assert.ok(json, "a JSON line is emitted");
  const contract = spawnSync(process.execPath, [BIN, "contract", "spec-review-verdict"], { input: json, encoding: "utf8" });
  assert.equal(contract.status, 0, `contract validation failed: ${contract.stdout}${contract.stderr}`);
});
