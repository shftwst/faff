// FAFF-1266 — the `finding-identity` title-stability eval: registry and grader wiring, fixture shape,
// the two-independent-passes driver, the runner (result file, bar, --model/--effort), and the reviewer
// contract additions. Every model is an injected mock: nothing here spawns `claude`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill } from "./helpers/skill-harness.mjs";
import { runCli } from "./helpers/run-cli.mjs";
import { grade, validateCase, KINDS, CLOSED_SET_KINDS } from "../eval/grader.mjs";
import { loadLiveCases } from "../eval/run-evals.mjs";
import { loadReviewFindingProse } from "../eval/cli-driver.mjs";
import { driveFindingIdentityCase, buildFindingIdentityPrompt } from "../eval/live-driver.mjs";
import {
  LIVE_KINDS,
  runLiveEvals,
  buildFindingIdentityResult,
  resolveLiveFrontier,
} from "../eval/run-live-evals.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const cases = () => loadLiveCases().filter((c) => c.kind === "finding-identity");

function substrate() {
  const tracker = loadFixture({ version: 1, issues: [{ id: "ISS-A", title: "anything", state: "Todo", stateCategory: "unstarted" }] });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
  return { tracker, repo };
}

const envelope = (caseId, findings, signal = "fail") =>
  "```faff-eval:judgement\n" + JSON.stringify({ case_id: caseId, signal, findings }) + "\n```";

const caseIdOf = (prompt) => /"case_id": "(finding-identity-\d+)"/.exec(prompt)[1];

// A mock reviewer: one defect finding per pass at the case's defect file. `drift` ids get a different
// title on the second pass; every other case words the title differently but normalises identically.
function mockReviewer(allCases, { drift = new Set(), log = null } = {}) {
  const byId = new Map(allCases.map((c) => [c.id, c]));
  const calls = new Map();
  return (prompt) => {
    const id = caseIdOf(prompt);
    const n = (calls.get(id) ?? 0) + 1;
    calls.set(id, n);
    const defectFile = byId.get(id).fixture.defect_file;
    let out;
    if (n === 1) out = envelope(id, [{ title: "Off-by-one in pageCount", location: `${defectFile}:12`, action: "use ceil", severity: "major" }]);
    else if (drift.has(id)) out = envelope(id, [{ title: "Partial last page dropped", location: `./${defectFile}:15`, action: "use ceil", severity: "major" }]);
    else out = envelope(id, [{ title: "off-by-one in  pageCount.", location: `./${defectFile}:15`, action: "use ceil", severity: "major" }]);
    if (log) log.push({ id, n, prompt, out });
    return out;
  };
}

// --- registry and grader wiring -------------------------------------------------------------------

test("finding-identity is a registered, closed-set grader KIND with a seam-registry row and a live adapter", () => {
  assert.ok(KINDS.includes("finding-identity"));
  assert.ok(CLOSED_SET_KINDS.has("finding-identity"));
  const reg = JSON.parse(readFileSync(join(ROOT, "eval", "seam-registry.json"), "utf8"));
  const row = Object.values(reg).flatMap((v) => (v && typeof v === "object" ? Object.entries(v) : [])).find(([k]) => k === "finding-identity");
  assert.deepEqual(row[1], { surface: "faffter-noon-review", status: "designed" });
  assert.equal(typeof LIVE_KINDS["finding-identity"].loader, "function");
  assert.equal(typeof LIVE_KINDS["finding-identity"].driveCase, "function");
});

test("grade: stable passes; drifted, undetected and a missing outcome fail with clean signatures", () => {
  const c = cases()[0];
  assert.equal(grade(c, { "finding-identity": "stable" }).score, 1);
  assert.equal(grade(c, { "finding-identity": "drifted" }).score, 0);
  assert.equal(grade(c, { "finding-identity": "undetected" }).score, 0);
  assert.equal(grade(c, {}).score, 0);
});

test("the faffter-noon-review frontmatter declares the finding-identity judgement seam", () => {
  const md = readFileSync(join(ROOT, "plugin", "skills", "faffter-noon-review", "SKILL.md"), "utf8");
  const seam = /^judgement_seam:\s*(.+)$/m.exec(md)[1].split(",").map((s) => s.trim());
  assert.ok(seam.includes("finding-identity"));
});

// --- fixtures -------------------------------------------------------------------------------------

test("at least 10 finding-identity fixtures: reps 1, a defect_file the diff touches, two or more files, 3+ with diff_b", () => {
  const all = cases();
  assert.ok(all.length >= 10, `have ${all.length}`);
  for (const c of all) {
    validateCase(c);
    assert.equal(c.reps, 1, c.id);
    assert.deepEqual(c.oracle, { closed_set: ["stable"] }, c.id);
    const files = [...c.fixture.diff.matchAll(/^diff --git a\/(\S+) b\//gm)].map((m) => m[1]);
    assert.ok(files.length >= 2, `${c.id} diff touches ${files.length} file(s)`);
    assert.ok(files.includes(c.fixture.defect_file), `${c.id} diff touches its defect_file`);
    if (c.fixture.diff_b) {
      assert.ok(c.fixture.diff_b.includes(`diff --git a/${c.fixture.defect_file} b/`), `${c.id} diff_b keeps the defect file`);
      assert.notEqual(c.fixture.diff_b, c.fixture.diff, c.id);
    }
  }
  assert.ok(all.filter((c) => c.fixture.diff_b).length >= 3);
});

test("finding-identity fixtures are not picked up by the black-box loadCases() sweep", async () => {
  const { loadCases } = await import("../eval/run-evals.mjs");
  assert.ok(!loadCases().some((c) => c.kind === "finding-identity"));
});

// --- prompt ---------------------------------------------------------------------------------------

test("the prompt carries the review rubric with the finding-field guidance, the fixture and the instruction", () => {
  const prose = loadReviewFindingProse();
  assert.match(prose, /Review verdict \(fixed\)/);
  assert.match(prose, /## The five review passes/);
  assert.match(prose, /Finding fields/);
  const c = cases()[0];
  const prompt = buildFindingIdentityPrompt(c.fixture, { caseId: c.id });
  assert.ok(prompt.includes(c.fixture.diff));
  assert.ok(prompt.includes(`"case_id": "${c.id}"`));
  assert.match(prompt, /Do not emit an id/);
  assert.ok(buildFindingIdentityPrompt(c.fixture, { caseId: c.id, diff: "OTHER DIFF" }).includes("OTHER DIFF"));
});

// --- the driver: two independent passes -----------------------------------------------------------

test("every fixture: exactly two model calls, and pass B's prompt contains none of pass A's output", async (t) => {
  const all = cases();
  for (const c of all) {
    const { tracker, repo } = substrate();
    t.after(() => repo.teardown());
    const log = [];
    const model = mockReviewer(all, { log });
    const out = await driveFindingIdentityCase(c, { runSkill, tracker, repo, model });
    assert.equal(log.length, 2, `${c.id} made ${log.length} calls`);
    assert.equal(log[1].prompt.includes(log[0].out), false, `${c.id}: pass B saw pass A output`);
    assert.equal(log[1].prompt.includes("Off-by-one in pageCount"), false, `${c.id}: pass B saw pass A title`);
    assert.equal(out.env["finding-identity"], "stable", c.id);
    assert.equal(out.detail.id_a, out.detail.id_b);
  }
});

test("pass B reviews diff_b when the fixture has one, and diff otherwise", async (t) => {
  const all = cases();
  const withB = all.find((c) => c.fixture.diff_b);
  const without = all.find((c) => !c.fixture.diff_b);
  for (const [c, wantB] of [[withB, withB.fixture.diff_b], [without, without.fixture.diff]]) {
    const { tracker, repo } = substrate();
    t.after(() => repo.teardown());
    const log = [];
    await driveFindingIdentityCase(c, { runSkill, tracker, repo, model: mockReviewer(all, { log }) });
    assert.ok(log[0].prompt.includes(c.fixture.diff));
    assert.ok(log[1].prompt.includes(wantB));
  }
});

test("a tracker that throws on everything but listIssues does not change the prompt (byte-identical across calls)", async (t) => {
  const all = cases();
  const c = all[0];
  const stub = new Proxy({ listIssues: () => [] }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => { throw new Error(`tracker.${String(prop)} must not be called`); };
    },
  });
  const prompts = [];
  for (let i = 0; i < 2; i++) {
    const { repo } = substrate();
    t.after(() => repo.teardown());
    const log = [];
    await driveFindingIdentityCase(c, { runSkill, tracker: stub, repo, model: mockReviewer(all, { log }) });
    prompts.push(log.map((l) => l.prompt));
  }
  assert.deepEqual(prompts[0], prompts[1]);
});

test("outcomes: no defect finding in a pass is undetected; a changed title is drifted; the highest severity in the file wins", async (t) => {
  const c = cases()[0];
  const run = async (responses) => {
    const { tracker, repo } = substrate();
    t.after(() => repo.teardown());
    let n = 0;
    return driveFindingIdentityCase(c, { runSkill, tracker, repo, model: () => responses[n++] });
  };
  const f = (title, severity = "major", location = `${c.fixture.defect_file}:5`) => ({ title, location, action: "fix", severity });
  assert.equal((await run([envelope(c.id, [], "pass"), envelope(c.id, [f("A")])])).env["finding-identity"], "undetected");
  assert.equal((await run([envelope(c.id, [f("Other file", "major", "elsewhere.js:1")]), envelope(c.id, [f("A")])])).env["finding-identity"], "undetected");
  assert.equal((await run([envelope(c.id, [f("A")]), envelope(c.id, [f("B")])])).env["finding-identity"], "drifted");
  const picked = await run([envelope(c.id, [f("Minor nit", "minor"), f("Real defect", "critical")]), envelope(c.id, [f("Real defect", "critical"), f("Minor nit", "minor")])]);
  assert.equal(picked.env["finding-identity"], "stable");
  assert.match(picked.detail.id_a, /real defect$/);
});

test("a pass that emits no parseable envelope throws, so the runner records an errored rep", async (t) => {
  const c = cases()[0];
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());
  await assert.rejects(driveFindingIdentityCase(c, { runSkill, tracker, repo, model: () => "no block here" }));
});

// --- the runner and the result file ---------------------------------------------------------------

test("scenario: a stable case with reworded title and location grades stable, accuracy 1.00, ids equal in the detail", async (t) => {
  const all = cases();
  const c = all[1];
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());
  const s = await runLiveEvals({ kind: "finding-identity", only: c.id, ctx: { runSkill, tracker, repo, model: mockReviewer(all) } });
  assert.equal(s.per_kind["finding-identity"].accuracy, 1);
  const detail = s.cases[0].rep_results[0].detail;
  assert.equal(detail.outcome, "stable");
  assert.equal(detail.id_a, detail.id_b);
  const result = buildFindingIdentityResult(s, { commit: "abc", runAt: "2026-10-14T00:00:00.000Z", model: "m", effort: null });
  assert.deepEqual(result.cases, [{ id: c.id, outcome: "stable", id_a: detail.id_a, id_b: detail.id_b }]);
});

test("scenario: the full set with two drifting fixtures writes a below-bar result", async (t) => {
  const all = cases();
  const drift = new Set([all[0].id, all[1].id]);
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());
  const s = await runLiveEvals({ kind: "finding-identity", ctx: { runSkill, tracker, repo, model: mockReviewer(all, { drift }) } });
  const result = buildFindingIdentityResult(s, { commit: "abc123", runAt: "2026-10-14T00:00:00.000Z", model: "opus", effort: "high" });
  assert.equal(result.fixtures, all.length);
  assert.equal(result.stable, all.length - 2);
  assert.equal(result.drifted, 2);
  assert.equal(result.rate, Math.round(((all.length - 2) / all.length) * 100) / 100);
  assert.equal(result.pass, result.rate >= 0.9);
  assert.equal(result.pass, false);
  assert.deepEqual(Object.keys(result), ["kind", "commit", "run_at", "model", "effort", "fixtures", "stable", "drifted", "undetected", "errored", "rate", "bar", "pass", "cases"]);
  assert.equal(result.bar, 0.9);
  assert.equal(result.effort, "high");
});

test("scenario: ten cases of which two drift give rate 0.80 and pass false; all stable passes", () => {
  const mk = (n, drifted) => ({
    cases: Array.from({ length: n }, (_, i) => ({
      case_id: `finding-identity-${i}`, kind: "finding-identity",
      rep_results: [{ detail: { outcome: i < drifted ? "drifted" : "stable", id_a: "a", id_b: i < drifted ? "b" : "a" } }],
    })),
  });
  const meta = { commit: "c", runAt: "t", model: "m", effort: null };
  const two = buildFindingIdentityResult(mk(10, 2), meta);
  assert.equal(two.rate, 0.8);
  assert.equal(two.pass, false);
  assert.equal(two.effort, "inherit");
  const none = buildFindingIdentityResult(mk(10, 0), meta);
  assert.equal(none.rate, 1);
  assert.equal(none.pass, true);
  const one = buildFindingIdentityResult(mk(10, 1), meta);
  assert.equal(one.rate, 0.9);
  assert.equal(one.pass, true);
});

test("fewer than 10 fixtures never passes, and errored or undetected reps count as not stable", () => {
  const meta = { commit: "c", runAt: "t", model: "m", effort: null };
  const nine = { cases: Array.from({ length: 9 }, (_, i) => ({ case_id: `x${i}`, kind: "finding-identity", rep_results: [{ detail: { outcome: "stable", id_a: "a", id_b: "a" } }] })) };
  assert.equal(buildFindingIdentityResult(nine, meta).pass, false);
  const mixed = { cases: [
    { case_id: "e", kind: "finding-identity", rep_results: [{ graded: "ERRORED" }] },
    { case_id: "u", kind: "finding-identity", rep_results: [{ detail: { outcome: "undetected", id_a: null, id_b: "b" } }] },
  ] };
  const r = buildFindingIdentityResult(mixed, meta);
  assert.deepEqual([r.errored, r.undetected, r.stable], [1, 1, 0]);
});

test("--model and --effort flow into the frontier options (pure builder, no spawn)", () => {
  const { opts, model, effort } = resolveLiveFrontier(["--model", "claude-opus-5-5", "--effort", "high"], { bin: "claude", pluginDir: "/p" });
  assert.equal(model, "claude-opus-5-5");
  assert.equal(effort, "high");
  assert.equal(opts.model, "claude-opus-5-5");
  assert.equal(opts.effort, "high");
  assert.equal(opts.pluginDir, "/p");
  assert.equal(opts.forwardCreds, true);
  assert.equal(resolveLiveFrontier(["--model", "m", "--effort", "inherit"]).opts.effort, null);
  assert.throws(() => resolveLiveFrontier(["--model", "m", "--effort", "bogus"]), /unknown level/);
});

// --- reviewer contract additions ------------------------------------------------------------------

test("faff contract review-verdict ignores title, location and action: same output with and without them", () => {
  const bare = { signal: "fail", findings: [{ location_present: true, action_present: true, severity: "major" }] };
  const rich = { signal: "fail", findings: [{ ...bare.findings[0], title: "Leaks fd in readFirstLine", location: "lib/reader.js:9", action: "close the fd" }] };
  const a = runCli(["contract", "review-verdict"], { input: JSON.stringify(bare) });
  const b = runCli(["contract", "review-verdict"], { input: JSON.stringify(rich) });
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.equal(b.stdout, a.stdout);
});

test("both review SKILLs document title, location and action and point at the shared helper", () => {
  const noon = readFileSync(join(ROOT, "plugin", "skills", "faffter-noon-review", "SKILL.md"), "utf8");
  const dark = readFileSync(join(ROOT, "plugin", "skills", "faffter-dark-adversarial-review", "SKILL.md"), "utf8");
  for (const md of [noon, dark]) {
    assert.match(md, /"title"/);
    assert.match(md, /"location"/);
    assert.match(md, /"action"/);
  }
  assert.match(noon, /no line numbers, severity words or category/);
  assert.match(dark, /finding-id\.js/);
});
