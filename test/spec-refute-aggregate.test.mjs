// FAFF-267 — the L4 adversarial spec reviewer's majority/severity aggregation: pure functions +
// the contract-block emission + the CLI selftest. Zero live model calls — aggregation is pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  aggregate, strictMajority, mapSeverity, renderBlock, SEVERITY_MAP, entrypoint_href,
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

test("an infra-configured down lens → unavailable when it could swing (FAFF-900), reject when it cannot", () => {
  let v = aggregate([down("infosec", "infra-configured"), clear("architectural"), clear("methodology"), clear("QA")], 4);
  assert.equal(v.verdict, "unavailable", "missing lens could swing a clean board — a transient, never needs-human");
  assert.ok(v.objections.some((o) => o.lens === "infosec" && o.severity === "major"), "outaged lens named as a major objection");
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

test("FAFF-935: the {claim, evidence, predicted_consequence} triple rides verbatim onto the output objection, changing no verdict", () => {
  const enriched = {
    lens: "architectural", outcome: "refuted",
    objections: [{ severity: "major", claim: "the loop cannot terminate", evidence: "How, step 3", predicted_consequence: "hangs on empty --dir" }],
  };
  const v = aggregate([enriched, clear("infosec"), clear("methodology"), clear("QA")], 4);
  assert.equal(v.verdict, "revise", "the triple never changes the gating decision");
  assert.deepEqual(v.objections, [{
    lens: "architectural", severity: "major",
    claim: "the loop cannot terminate", evidence: "How, step 3", predicted_consequence: "hangs on empty --dir",
  }]);
  // a bare {severity} objection yields today's {lens, severity} shape with no triple keys
  const bare = aggregate([r("architectural", "major"), clear("infosec"), clear("methodology"), clear("QA")], 4);
  assert.deepEqual(bare.objections, [{ lens: "architectural", severity: "major" }]);
});

test("FAFF-935: an enriched objection flows through the CLI into a block that validates and keeps the triple", () => {
  const enriched = {
    lens: "infosec", outcome: "refuted",
    objections: [{ severity: "major", claim: "auth bypass on empty token", evidence: "refute-infosec", predicted_consequence: "unauthenticated writes" }],
  };
  const input = JSON.stringify({
    enabled_lenses: ["architectural", "infosec", "methodology", "QA"],
    refutations: [enriched, clear("architectural"), clear("methodology"), clear("QA")],
  });
  const agg = spawnSync(process.execPath, [AGG], { input, encoding: "utf8" });
  assert.equal(agg.status, 0, agg.stderr);
  const json = agg.stdout.split("\n").find((l) => l.trim().startsWith("{"));
  const parsed = JSON.parse(json);
  assert.equal(parsed.objections[0].claim, "auth bypass on empty token");
  assert.equal(parsed.objections[0].predicted_consequence, "unauthenticated writes");
  const contract = spawnSync(process.execPath, [BIN, "contract", "spec-review-verdict"], { input: json, encoding: "utf8" });
  assert.equal(contract.status, 0, `contract validation failed: ${contract.stdout}${contract.stderr}`);
  // the validator preserves the triple through to contractData
  const cd = JSON.parse(contract.stdout);
  assert.equal(cd.objections[0].evidence, "refute-infosec");
});

test("every non-approve verdict carries ≥1 objection; approve carries none", () => {
  const cases = [
    aggregate([r("architectural", "major"), clear("infosec")], 2),       // revise
    aggregate([down("infosec", "config-fault"), clear("architectural")], 2), // needs-human
    aggregate([down("infosec", "infra-configured"), clear("architectural")], 2), // unavailable (FAFF-900)
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

test("aggregate.mjs CLI-entrypoint guard fires from a URL-special-char path (FAFF-464)", () => {
  // Regression: the guard once compared import.meta.url (percent-encoded) against a hand-built
  // `file://${process.argv[1]}` (raw path). From a dir whose path holds a URL-special char (`×`),
  // the two diverged, the guard failed, main() never ran, and the process exited 0 with EMPTY
  // stdout — a silent no-op on a gate component. pathToFileURL encodes identically, so the guard
  // now fires. Zero-dependency (node:fs + node:url stdlib only), so a standalone copy runs.
  const dir = mkdtempSync(join(tmpdir(), "faff-×-"));
  try {
    const agg = join(dir, "aggregate.mjs");
    copyFileSync(AGG, agg);
    const res = spawnSync(process.execPath, [agg, "--n", "1"], {
      input: '[{"lens":"architectural","outcome":"clear","objections":[]}]',
      encoding: "utf8",
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /faff-contract:spec-review-verdict/,
      "guard must fire from a special-char path — a non-empty verdict block, never a silent empty exit 0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregate.mjs CLI-entrypoint guard fires through a symlinked install path (FAFF-813)", () => {
  // Regression: faff installs each skill by symlinking `plugin/skills/<skill>/` into
  // `~/.claude/skills/<skill>`, so production's process.argv[1] is the symlink path while
  // import.meta.url is already the repo REALPATH. The two hrefs diverged, the guard was false, and
  // main() silently no-op'd — exit 0, empty stdout. A file symlink reproduces the identical
  // divergence (Node realpath-resolves import.meta.url either way), so a lone symlinkSync suffices.
  const dir = mkdtempSync(join(tmpdir(), "faff-symlink-"));
  try {
    const link = join(dir, "aggregate.mjs");
    symlinkSync(AGG, link);
    const res = spawnSync(process.execPath, [link, "--selftest"], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /aggregate --selftest: ok/,
      "guard must fire through a symlinked path — the selftest output, never a silent empty exit 0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("entrypoint_href: falsy argv1 → null (guard false, main() does not run)", () => {
  assert.equal(entrypoint_href(undefined), null);
  assert.equal(entrypoint_href(""), null);
});

test("entrypoint_href: a realpathSync throw (ENOENT) falls back to the raw-path href (FAFF-464 behaviour), never throws", () => {
  const synthetic = join(tmpdir(), "faff-813-does-not-exist", "ghost.mjs");
  assert.doesNotThrow(() => entrypoint_href(synthetic));
  assert.equal(entrypoint_href(synthetic), pathToFileURL(synthetic).href);
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

test("aggregate.mjs CLI: a swing-capable infra-configured outage emits an unavailable block that validates (FAFF-900)", () => {
  const input = JSON.stringify({
    enabled_lenses: ["architectural", "infosec", "methodology", "QA"],
    refutations: [down("infosec", "infra-configured"), clear("architectural"), clear("methodology"), clear("QA")],
  });
  const agg = spawnSync(process.execPath, [AGG], { input, encoding: "utf8" });
  assert.equal(agg.status, 0, agg.stderr);
  const json = agg.stdout.split("\n").find((l) => l.trim().startsWith("{"));
  assert.ok(json, "a JSON line is emitted");
  assert.equal(JSON.parse(json).verdict, "unavailable");
  const contract = spawnSync(process.execPath, [BIN, "contract", "spec-review-verdict"], { input: json, encoding: "utf8" });
  assert.equal(contract.status, 0, `contract validation failed: ${contract.stdout}${contract.stderr}`);
});
