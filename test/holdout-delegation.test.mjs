// FAFF-1291 — the code-blind holdout judges only criteria a machine can check. A prose DONE item is tiered
// `delegated` by `faff dod classify`, listed by the record writer in `delegated[]` with its verifier, and
// kept out of the judged set the aggregate is derived from. These tests cover the writer, the contract rules,
// the CLI surface and the re-classification of the four committed anchors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const require = createRequire(import.meta.url);
const { buildHoldoutRecord, delegationViolations } = require("../plugin/skills/faff/bin/lib/holdout-record.js");
const { dodClassify } = require("../plugin/skills/faff/bin/lib/admissibility.js");
const { computeHoldoutVerdict, holdoutGateResult } = require("../plugin/skills/faff/bin/lib/contract-defs.js");
const { validateAnchorDir } = require("../plugin/skills/faff/bin/lib/evidence.js");

function repo() {
  const root = mkdtempSync(join(tmpdir(), "faff-holdout-delegation-"));
  mkdirSync(join(root, ".git"));
  return root;
}
const faff = (root, args, input) => spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: "utf8", input });
const record = (root, args, block) => faff(root, ["holdout", "record", ...args], typeof block === "string" ? block : JSON.stringify(block));
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const storeFile = (root, key) => join(root, ".faff", "holdout", `${key}.json`);

const met = (id, extra = {}) => ({ id, text: `criterion ${id}`, holdout: false, class: "scenario", verdict: "met", evidence_present: true, exercised: "GET /x", expected: "200", observed: "200", evidence_ref: null, reason: null, ...extra });
const block = (criteria, extra = {}) => ({ aggregate: "meets-spec", code_blind: true, violations: [], criteria, ...extra });
const withSpec = (root, text, name = "spec.md") => { const f = join(root, name); writeFileSync(f, text); return f; };

// The spec from the integration smoke test: two scenario units, one DONE assertion, two prose DONE items.
const SMOKE_SPEC = [
  "## Scenarios", "",
  "```", "Given a user", "When they sign in", "Then they see a dashboard", "```", "",
  "```", "Given a user", "When they sign out", "Then the session ends", "```", "",
  "## 8. DONE", "",
  "- [ ] [ac-1] The sign-in endpoint must return 200",
  "- [ ] [ac-2] The dashboard feels fast to operators",
  "- [ ] [ac-3] The onboarding copy reads warmly",
  "",
].join("\n");
const SMOKE_BLOCK = block([met("scenarios:1"), met("scenarios:2"), met("done:1", { class: "assertion" })]);

test("ac-1 smoke: two scenarios, one assertion and prose DONE items reach meets-spec through faff holdout record --spec", () => {
  const root = repo();
  const spec = withSpec(root, SMOKE_SPEC);
  const classify = JSON.parse(faff(root, ["dod", "classify", "--spec", spec, "--issue", "FAFF-1", "--json"]).stdout);
  assert.equal(classify.judged_count, 3);
  assert.equal(classify.delegated_count, 2);
  const r = record(root, ["--issue", "FAFF-1", "--spec", spec], SMOKE_BLOCK);
  assert.equal(r.status, 0, r.stderr);
  const doc = read(storeFile(root, "FAFF-1"));
  assert.equal(doc.aggregate, "meets-spec");
  assert.equal(doc.criteria.length, 3);
  assert.deepEqual(doc.delegated.map((d) => [d.id, d.verification_tier, d.verifier, d.ac_id]), [
    ["done:2", "delegated", "ac-checklist", "faff-1#ac-2"],
    ["done:3", "delegated", "ac-checklist", "faff-1#ac-3"],
  ]);
  const c = faff(root, ["contract", "holdout-verdict"], readFileSync(storeFile(root, "FAFF-1"), "utf8"));
  assert.equal(c.status, 0, c.stdout + c.stderr);
  assert.equal(JSON.parse(c.stdout).delegated.length, 2, "contractData carries delegated when the input does");
  const anchorDir = join(root, "anchor");
  mkdirSync(anchorDir);
  writeFileSync(join(anchorDir, "holdout.json"), readFileSync(storeFile(root, "FAFF-1")));
  // FAFF-1261 binds holdout.json to the issue chain-head.json names, so the anchor carries one.
  const chainHead = JSON.parse(readFileSync(join(REPO, "verification", "evidence", "v0.3", "schema", "examples", "chain-head.example.json"), "utf8"));
  writeFileSync(join(anchorDir, "chain-head.json"), JSON.stringify({ ...chainHead, issue: "FAFF-1" }));
  const report = validateAnchorDir(anchorDir);
  assert.deepEqual(report.files.filter((f) => f.path === "holdout.json").map((f) => [f.status, f.violations]), [["ok", []]]);
  rmSync(root, { recursive: true, force: true });
});

test("ac-2: a FAFF-1279-shaped spec (one no-surface assertion, a When-only unit, 22 prose DONE) has 22 delegated rows and a needs-human aggregate", () => {
  const root = repo();
  const done = Array.from({ length: 22 }, (_, i) => `- [ ] Prose item ${i + 1} reads well to operators`);
  const spec = withSpec(root, [
    "## Scenarios", "",
    "```", "Given a request", "When it is made", "Then 200", "```", "",
    "When the flag is absent, the output is unchanged", "",
    "## 8. DONE", "",
    "- [ ] `faff review-fixture-paths` MUST print the defaults",
    ...done, "",
  ].join("\n"));
  const classify = dodClassify(readFileSync(spec, "utf8"), { issue: "FAFF-1" });
  assert.equal(classify.verification_tier_counts.delegated, 22);
  const b = block([
    met("scenarios:1"),
    { id: "scenarios:2", text: "When the flag is absent, the output is unchanged", holdout: false, class: "prose", verdict: "needs-human", evidence_present: false, exercised: null, expected: null, observed: null, evidence_ref: null, reason: "prose scenario: no machine check and no delegate verifier", reason_code: "human-only" },
    { id: "done:1", text: "d", holdout: false, class: "assertion", verdict: "needs-human", evidence_present: false, exercised: null, expected: null, observed: null, evidence_ref: null, reason: "no surface", reason_code: "no-surface" },
  ], { aggregate: "needs-human" });
  const r = record(root, ["--issue", "FAFF-1", "--spec", spec], b);
  assert.equal(r.status, 0, r.stderr);
  const doc = read(storeFile(root, "FAFF-1"));
  assert.equal(doc.delegated.length, 22);
  assert.equal(doc.aggregate, "needs-human");
  assert.equal(faff(root, ["holdout", "verdict", "--issue", "FAFF-1"]).status, 1, "the gate still blocks");
  rmSync(root, { recursive: true, force: true });
});

test("ac-9: a run key writes ac_id null on every row; an integration DONE assertion lands in delegated[] with review-merge-floor; --spec - exits 2", () => {
  const root = repo();
  const spec = withSpec(root, [
    "## Scenarios", "", "```", "Given a", "When b", "Then c", "```", "",
    "## 8. DONE", "", "- [ ] The rollback must restore the previous release", "- [ ] Operators like it", "",
  ].join("\n"));
  const r = record(root, ["--issue", "run-20261018-1", "--spec", spec], block([met("scenarios:1")]));
  assert.equal(r.status, 0, r.stderr);
  const doc = read(storeFile(root, "run-20261018-1"));
  assert.deepEqual(doc.delegated.map((d) => [d.id, d.verification_tier, d.verifier, d.ac_id]), [
    ["done:1", "integration", "review-merge-floor", null],
    ["done:2", "delegated", "ac-checklist", null],
  ]);
  for (const row of doc.delegated) assert.deepEqual(Object.keys(row).sort(), ["ac_id", "holdout", "id", "text", "verification_tier", "verifier"]);
  const dash = record(root, ["--issue", "FAFF-2", "--spec", "-"], block([met("scenarios:1")]));
  assert.equal(dash.status, 2);
  assert.equal(existsSync(storeFile(root, "FAFF-2")), false);
  rmSync(root, { recursive: true, force: true });
});

test("ac-10: a prose done:2 row in criteria is a contract violation naming criteria[i]", () => {
  const b = { aggregate: "needs-human", code_blind: true, violations: [], criteria: [{ id: "done:2", class: "prose", verdict: "needs-human", evidence_present: false }] };
  const root = repo();
  const c = faff(root, ["contract", "holdout-verdict"], JSON.stringify(b));
  assert.equal(c.status, 1);
  assert.match(JSON.parse(c.stdout).violations.join("\n"), /criteria\[0\] is a delegated prose DONE criterion and must not be judged/);
  rmSync(root, { recursive: true, force: true });
});

test("ac-11: a scenarios:N prose row is conformant as needs-human and a violation as met", () => {
  const root = repo();
  const mk = (verdict) => ({ aggregate: verdict === "met" ? "meets-spec" : "needs-human", code_blind: true, violations: [], criteria: [{ id: "scenarios:2", class: "prose", verdict, evidence_present: verdict === "met" }] });
  assert.equal(faff(root, ["contract", "holdout-verdict"], JSON.stringify(mk("needs-human"))).status, 0);
  assert.equal(faff(root, ["contract", "holdout-verdict"], JSON.stringify(mk("met"))).status, 1);
  rmSync(root, { recursive: true, force: true });
});

test("ac-12: an id in both lists, a wrong tier and verifier pairing, and a delegated-tier scenarios id each exit 1", () => {
  const root = repo();
  const row = (extra) => ({ id: "done:1", text: "t", holdout: false, verification_tier: "delegated", verifier: "ac-checklist", ac_id: null, ...extra });
  const run = (b) => faff(root, ["contract", "holdout-verdict"], JSON.stringify({ code_blind: true, violations: [], ...b })).status;
  assert.equal(run({ aggregate: "meets-spec", criteria: [{ id: "done:1", class: "assertion", verdict: "met", evidence_present: true }], delegated: [row()] }), 1);
  assert.equal(run({ aggregate: "needs-human", criteria: [], delegated: [row({ verifier: "review-merge-floor" })] }), 1);
  assert.equal(run({ aggregate: "needs-human", criteria: [], delegated: [row({ id: "scenarios:1" })] }), 1);
  assert.equal(run({ aggregate: "needs-human", criteria: [], delegated: [row(), row()] }), 1, "an id may not appear twice");
  assert.equal(run({ aggregate: "needs-human", criteria: [], delegated: [row(), row({ id: "done:2", verification_tier: "integration", verifier: "review-merge-floor" })] }), 0);
  rmSync(root, { recursive: true, force: true });
});

test("ac-13: criteria [] with a non-empty delegated derives needs-human and the gate blocks", () => {
  const b = { aggregate: "needs-human", code_blind: true, violations: [], criteria: [], delegated: [{ id: "done:1", text: "t", holdout: false, verification_tier: "delegated", verifier: "ac-checklist", ac_id: null }] };
  const { contractData } = computeHoldoutVerdict(b);
  assert.deepEqual(contractData.violations, []);
  assert.equal(contractData.aggregate, "needs-human");
  assert.equal(holdoutGateResult(b).gate, "block");
  const asMeets = computeHoldoutVerdict({ ...b, aggregate: "meets-spec" });
  assert.ok(asMeets.contractData.violations.length > 0, "meets-spec over nothing judged is still rejected");
});

test("ac-14: delegationViolations is exported and both the contract and the record validator call it", () => {
  assert.equal(typeof delegationViolations, "function");
  const bad = { aggregate: "needs-human", code_blind: true, violations: [], criteria: [{ id: "done:3", class: "prose", verdict: "needs-human", evidence_present: false }] };
  assert.ok(computeHoldoutVerdict(bad).contractData.violations.some((v) => v.includes("must not be judged")));
  const regions = spawnSync(process.execPath, [BIN, "regions", "check"], { cwd: REPO, encoding: "utf8" });
  assert.equal(regions.status, 0, regions.stdout + regions.stderr);
  const src = readFileSync(join(REPO, "plugin", "skills", "faff", "bin", "lib", "holdout-record.js"), "utf8");
  assert.match(src, /found\.push\(\.\.\.delegationViolations\(doc\)\)/, "holdoutRecordViolations calls it");
  assert.doesNotMatch(src, /require\("\.\/admissibility"\)/, "the governance-region writer does not require the factory classifier");
});

test("ac-15: faff holdout record without --spec exits 2 with a usage message and writes no file", () => {
  const root = repo();
  const r = record(root, ["--issue", "FAFF-1"], block([met("scenarios:1")]));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--spec/);
  assert.equal(existsSync(join(root, ".faff")), false);
  rmSync(root, { recursive: true, force: true });
});

test("ac-16: the writer refuses a missing judged id, a delegated id and an id classify did not mint, and names them", () => {
  const root = repo();
  const spec = withSpec(root, SMOKE_SPEC);
  const refused = (criteria) => {
    const r = record(root, ["--issue", "FAFF-1", "--spec", spec], block(criteria));
    assert.equal(r.status, 1);
    const doc = read(storeFile(root, "FAFF-1"));
    assert.equal(doc.aggregate, "needs-human");
    assert.deepEqual(doc.criteria, []);
    return doc.violations.join("\n");
  };
  assert.match(refused([met("scenarios:1"), met("done:1", { class: "assertion" })]), /missing \[scenarios:2\]/);
  assert.match(refused([met("scenarios:1"), met("scenarios:2"), met("done:1", { class: "assertion" }), met("done:2")]), /unexpected \[done:2\]/);
  assert.match(refused([met("scenarios:1"), met("scenarios:2"), met("done:1", { class: "assertion" }), met("scenarios:9")]), /unexpected \[scenarios:9\]/);
  rmSync(root, { recursive: true, force: true });
});

test("ac-17: the written delegated[] comes from classify, not from the block", () => {
  const root = repo();
  const spec = withSpec(root, SMOKE_SPEC);
  const forged = { ...SMOKE_BLOCK, delegated: [{ id: "done:2", text: "forged", holdout: false, verification_tier: "delegated", verifier: "ac-checklist", ac_id: "forged" }] };
  const r = record(root, ["--issue", "FAFF-1", "--spec", spec], forged);
  assert.equal(r.status, 0, r.stderr);
  const doc = read(storeFile(root, "FAFF-1"));
  assert.equal(doc.delegated.length, 2);
  assert.ok(doc.delegated.every((d) => d.text !== "forged" && d.ac_id !== "forged"));
  const omitted = record(root, ["--issue", "FAFF-1", "--spec", spec], { ...SMOKE_BLOCK, delegated: [] });
  assert.equal(omitted.status, 0);
  assert.equal(read(storeFile(root, "FAFF-1")).delegated.length, 2, "a block that drops the list does not drop a row");
  rmSync(root, { recursive: true, force: true });
});

test("ac-28: a refused record keeps the classify-derived delegated[]; a block whose rows lack ids is refused fail-closed", () => {
  const root = repo();
  const spec = withSpec(root, SMOKE_SPEC);
  const r = record(root, ["--issue", "FAFF-1", "--spec", spec], block([met("scenarios:1")]));
  assert.equal(r.status, 1);
  const doc = read(storeFile(root, "FAFF-1"));
  assert.deepEqual(doc.delegated.map((d) => d.id), ["done:2", "done:3"]);
  const noIds = record(root, ["--issue", "FAFF-1", "--spec", spec], block([met("scenarios:1", { id: undefined }), met("scenarios:2", { id: undefined }), met("done:1", { id: undefined })]));
  assert.equal(noIds.status, 1);
  const refusedDoc = read(storeFile(root, "FAFF-1"));
  assert.equal(refusedDoc.aggregate, "needs-human");
  assert.match(refusedDoc.violations.join("\n"), /\.id: missing/);
  assert.equal(refusedDoc.delegated.length, 2);
  const unreadable = record(root, ["--issue", "FAFF-1", "--spec", join(root, "no-such-spec.md")], SMOKE_BLOCK);
  assert.equal(unreadable.status, 1);
  assert.deepEqual(read(storeFile(root, "FAFF-1")).delegated, [], "a refusal before classify output writes an empty list");
  rmSync(root, { recursive: true, force: true });
});

test("an env-not-ready block refused for missing judged ids keeps the evaluator's own reason after the refusal", () => {
  const root = repo();
  const spec = withSpec(root, SMOKE_SPEC);
  const r = record(root, ["--issue", "FAFF-1", "--spec", spec], { aggregate: "needs-human", code_blind: true, violations: ["env not ready: health check failed"], criteria: [] });
  assert.equal(r.status, 1);
  const doc = read(storeFile(root, "FAFF-1"));
  assert.equal(doc.aggregate, "needs-human");
  assert.match(doc.violations[0], /^holdout record refused: criteria ids do not match/);
  assert.equal(doc.violations.at(-1), "env not ready: health check failed");
  assert.equal(doc.delegated.length, 2);
  rmSync(root, { recursive: true, force: true });
});

test("ac-30: an all-prose spec is not skipped; an integration-only spec is not skipped; a rollback prose DONE is delegated", () => {
  const allProse = dodClassify("## Scenarios\n\nThe copy feels friendly\n\n## 8. DONE\n\n- [ ] Operators like the flow\n- [ ] The rollback is smooth\n");
  assert.ok(allProse.judged_count > 0);
  const rollbackProse = allProse.criteria.find((c) => /rollback/.test(c.text));
  assert.equal(rollbackProse.verification_tier, "delegated");
  assert.equal(rollbackProse.verifier, "ac-checklist");
  const integrationOnly = dodClassify("## Scenarios\n\n```integration\nGiven a\nWhen b\nThen c\n```\n\n## 8. DONE\n\n- [ ] Operators like the flow\n");
  assert.equal(integrationOnly.judged_count, 0);
  assert.ok(integrationOnly.integration_count > 0);
  // the holdout for the all-prose spec ends needs-human: the prose Scenarios unit is recorded needs-human
  const root = repo();
  const spec = withSpec(root, "## Scenarios\n\nThe copy feels friendly\n\n## 8. DONE\n\n- [ ] Operators like the flow\n");
  const r = record(root, ["--issue", "FAFF-1", "--spec", spec], block([{ id: "scenarios:1", text: "The copy feels friendly", holdout: false, class: "prose", verdict: "needs-human", evidence_present: false, exercised: null, expected: null, observed: null, evidence_ref: null, reason: "prose scenario: no machine check and no delegate verifier", reason_code: "human-only" }], { aggregate: "needs-human" }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(storeFile(root, "FAFF-1")).aggregate, "needs-human");
  rmSync(root, { recursive: true, force: true });
});

test("ac-31: a delegated row with a known secret is redacted and a long row is truncated, on the success and the fail-closed paths", () => {
  const secret = "tok-delegated-9f8e7d";
  const classified = dodClassify(`## Scenarios\n\n\`\`\`\nGiven a\nWhen b\nThen c\n\`\`\`\n\n## 8. DONE\n\n- [ ] Operators see ${secret} ${"x".repeat(3000)}\n`, { issue: "FAFF-1" });
  const opts = { issue: "FAFF-1", secretValues: [], extraSecrets: [secret], classified };
  const ok = buildHoldoutRecord(block([met("scenarios:1")]), opts);
  assert.equal(ok.ok, true);
  const refused = buildHoldoutRecord(block([]), opts);
  assert.equal(refused.ok, false);
  for (const out of [ok, refused]) {
    assert.equal(out.bytes.includes(secret), false);
    assert.equal(out.doc.delegated[0].text.length, 2000);
    assert.ok(out.doc.delegated[0].text.includes("[REDACTED]"));
    assert.ok(out.doc.delegated[0].text.endsWith("…[truncated]"));
  }
});

test("ac-27: re-classifying the committed specs of the four anchors leaves no judged scenario or assertion row behind", () => {
  // The committed specs under records/specs are BUILDER views: each holdout scenario is withheld from them and
  // replaced by a note ("N holdout scenario(s) withheld from this view"), so the re-classified count of
  // running-stack scenario and assertion rows is compared after adding the withheld units back.
  const anchors = {
    "FAFF-1197": ["2026-10-06-FAFF-1197-one-dispatch-tree-pairs-model-and-effort-design.md", "run-20261006-001706-graft-FAFF-1197"],
    "FAFF-1198": ["2026-10-06-FAFF-1198-dispatch-cutover-design.md", "run-20261006-144106-graft-FAFF-1198"],
    "FAFF-1201": ["2026-10-06-FAFF-1201-faff-config-unset-design.md", "run-20261006-130209-graft-FAFF-1201"],
    "FAFF-1279": ["2026-10-15-FAFF-1279-code-review-treats-eval-fixture-files-as-test-data-not-shipped-code-design.md", "run-20261015-013751-graft-FAFF-1279"],
  };
  for (const [issue, [specName, runName]] of Object.entries(anchors)) {
    const specText = readFileSync(join(REPO, "records", "specs", specName), "utf8");
    const rec = read(join(REPO, ".faff", "anchors", runName, issue, "holdout.json"));
    const withheld = Number((specText.match(/(\d+) holdout scenario\(s\) withheld from this view/) || [0, 0])[1]);
    const classified = dodClassify(specText, { issue });
    const judgedNow = classified.criteria.filter((c) => c.verification_tier === "running-stack" && c.class !== "prose").length + withheld;
    const judgedBefore = rec.criteria.filter((r) => r.class === "scenario" || r.class === "assertion").length;
    assert.ok(judgedNow >= judgedBefore, `${issue}: ${judgedNow} judged now (withheld ${withheld} included) vs ${judgedBefore} judged before`);
    if (rec.criteria.every((r) => typeof r.id === "string")) {
      // Ids carry. Withheld scenarios are absent from the builder view, so scenarios:N shifts down by the number of
      // withheld units before it; every record row that is not withheld must keep its tier or move to delegated prose.
      const withheldIds = rec.criteria.filter((r) => r.holdout === true).map((r) => Number(r.id.split(":")[1]));
      assert.equal(withheldIds.length, withheld, `${issue}: the withheld note matches the record's holdout rows`);
      const byId = new Map(classified.criteria.map((c) => [c.id, c]));
      for (const r of rec.criteria.filter((x) => x.holdout !== true)) {
        const [source, n] = r.id.split(":");
        const idNow = source === "scenarios" ? `scenarios:${Number(n) - withheldIds.filter((w) => w < Number(n)).length}` : r.id;
        const now = byId.get(idNow);
        assert.ok(now, `${issue}: ${r.id} is still classified as ${idNow}`);
        if (r.class === "scenario" || r.class === "assertion") assert.equal(now.verification_tier, "running-stack", `${issue}: ${r.id} is still judged`);
        if (now.verification_tier === "delegated") assert.ok(source === "done" && r.class === "prose", `${issue}: ${r.id} moved to delegated and is a done:N prose row`);
      }
    }
  }
});

test("the holdout record directory holds only the store copy (no stray files from a refusal)", () => {
  const root = repo();
  const spec = withSpec(root, SMOKE_SPEC);
  record(root, ["--issue", "FAFF-1", "--spec", spec], block([met("scenarios:1")]));
  assert.deepEqual(readdirSync(join(root, ".faff", "holdout")), ["FAFF-1.json"]);
  rmSync(root, { recursive: true, force: true });
});
