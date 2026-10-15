// FAFF-1266 / FAFF-1276 — the `finding-identity` eval: registry and grader wiring, fixture shape, the
// carried-mode driver (pass B sees pass A's findings by handle), the runner (result file, bar,
// --model/--effort), and the reviewer contract additions. Every model is an injected mock: nothing here
// spawns `claude`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

const requireCjs = createRequire(import.meta.url);
const { priorFindingsList, renderPriorFindingsBlock } = requireCjs("../plugin/skills/faff/bin/lib/review-prior.js");

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

const ACTION_A = "ACTION-A-SENTINEL round the page count up";

// A mock reviewer: one defect finding per pass at the case's defect file. On the second pass every case
// rewords the title and carries the prior handle P1, except `drift` ids, which reword without a carry.
// Pass-B locations sit at line 9999, outside any second_defect_b range.
function mockReviewer(allCases, { drift = new Set(), log = null } = {}) {
  const byId = new Map(allCases.map((c) => [c.id, c]));
  const calls = new Map();
  return (prompt) => {
    const id = caseIdOf(prompt);
    const n = (calls.get(id) ?? 0) + 1;
    calls.set(id, n);
    const defectFile = byId.get(id).fixture.defect_file;
    let out;
    if (n === 1) out = envelope(id, [{ title: "Off-by-one in pageCount", location: `${defectFile}:12`, action: ACTION_A, severity: "major" }]);
    else if (drift.has(id)) out = envelope(id, [{ title: "Partial last page dropped", location: `./${defectFile}:9999`, action: "fix", severity: "major" }]);
    else out = envelope(id, [{ title: "Partial last page dropped", location: `./${defectFile}:9999`, carried_id: "P1", action: "fix", severity: "major" }]);
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

test("at least 16 finding-identity fixtures: reps 1, a defect_file the diff touches, two or more files, 3+ with diff_b", () => {
  const all = cases();
  assert.ok(all.length >= 16, `have ${all.length}`);
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

// The new-file line numbers of defect_file's added and context lines in a unified diff.
function newSideLines(diff, file) {
  const lines = new Set();
  let inFile = false;
  let n = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) { inFile = line.startsWith(`diff --git a/${file} b/`); continue; }
    if (!inFile || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) { n = Number(hunk[1]); continue; }
    if (line.startsWith("+") || line.startsWith(" ")) lines.add(n++);
  }
  return lines;
}

test("at least three fixtures carry second_defect_b, and every line in its range is on diff_b's new side of defect_file", () => {
  const withSecond = cases().filter((c) => c.fixture.second_defect_b);
  assert.ok(withSecond.length >= 3, `have ${withSecond.length}`);
  for (const c of withSecond) {
    const [start, end] = c.fixture.second_defect_b.lines;
    assert.ok(Number.isInteger(start) && Number.isInteger(end) && start <= end, c.id);
    const visible = newSideLines(c.fixture.diff_b, c.fixture.defect_file);
    for (let l = start; l <= end; l++) assert.ok(visible.has(l), `${c.id}: line ${l} is not an added or context line of ${c.fixture.defect_file}`);
  }
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

// --- the driver: pass B sees pass A's findings ---------------------------------------------------

test("every fixture: exactly two model calls; pass A has no prior block, pass B has A's block and none of A's action text", async (t) => {
  const all = cases();
  for (const c of all) {
    const { tracker, repo } = substrate();
    t.after(() => repo.teardown());
    const log = [];
    const model = mockReviewer(all, { log });
    const out = await driveFindingIdentityCase(c, { runSkill, tracker, repo, model });
    assert.equal(log.length, 2, `${c.id} made ${log.length} calls`);
    assert.equal(log[0].prompt.includes("## Prior findings (previous review round)"), false, `${c.id}: pass A saw a prior block`);
    const passA = JSON.parse(/```faff-eval:judgement\n([\s\S]*?)\n```/.exec(log[0].out)[1]).findings;
    assert.ok(log[1].prompt.includes(renderPriorFindingsBlock(priorFindingsList(passA))), `${c.id}: pass B lacks A's prior block`);
    assert.equal(log[1].prompt.includes(ACTION_A), false, `${c.id}: pass B saw pass A's action`);
    assert.match(log[1].prompt, /Do not emit finding_id/);
    assert.equal(out.env["finding-identity"], "stable", c.id);
    assert.equal(out.detail.id_a, out.detail.id_b);
    assert.equal(out.detail.carried_b, true);
    assert.equal(out.detail.title_stable, false);
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
  const drifted = await run([envelope(c.id, [f("A")]), envelope(c.id, [f("B")])]);
  assert.equal(drifted.env["finding-identity"], "drifted");
  assert.deepEqual([drifted.detail.carried_b, drifted.detail.merged, drifted.detail.title_stable], [false, false, false]);
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
  assert.equal(detail.carried_b, true);
  const result = buildFindingIdentityResult(s, { commit: "abc", runAt: "2026-10-14T00:00:00.000Z", model: "m", effort: null });
  assert.equal(result.mode, "carried");
  assert.deepEqual(result.cases, [{ id: c.id, outcome: "stable", id_a: detail.id_a, id_b: detail.id_b, carried_b: true, title_stable: false, refused_carries: 0 }]);
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
  assert.deepEqual(Object.keys(result), ["kind", "mode", "commit", "run_at", "model", "effort", "fixtures", "stable", "drifted", "merged", "undetected", "errored", "carried", "title_stable", "refused_carries", "rate", "bar", "pass", "cases"]);
  assert.deepEqual([result.mode, result.carried, result.title_stable, result.merged], ["carried", all.length - 2, 0, 0]);
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

// --- FAFF-1276: carried-mode grading ---------------------------------------------------------------

const secondCase = () => cases().find((c) => c.fixture.second_defect_b);

async function runPair(t, c, passA, passB) {
  const { tracker, repo } = substrate();
  t.after(() => repo.teardown());
  const responses = [envelope(c.id, passA), envelope(c.id, passB)];
  let n = 0;
  return driveFindingIdentityCase(c, { runSkill, tracker, repo, model: () => responses[n++] });
}

test("scenario: pass B names the defect differently but carries pass A's handle — stable, carried, and the result is carried mode", async (t) => {
  const c = cases()[0];
  const file = c.fixture.defect_file;
  const out = await runPair(t, c,
    [{ title: "Other nit", location: "elsewhere.js:2", severity: "minor" }, { title: "pagecount truncates partial last page with math.floor", location: `${file}:12`, severity: "major" }],
    [{ title: "pagecount rounds down a partial last page", location: `${file}:15`, carried_id: "P2", severity: "major" }]);
  assert.equal(out.env["finding-identity"], "stable");
  assert.deepEqual([out.detail.carried_b, out.detail.title_stable, out.detail.merged, out.detail.refused_carries], [true, false, false, 0]);
  const summary = { cases: [{ case_id: c.id, kind: "finding-identity", rep_results: [{ detail: out.detail }] }] };
  assert.equal(buildFindingIdentityResult(summary, { commit: "c", runAt: "t", model: "m", effort: null }).mode, "carried");
});

test("merged: a second-defect finding carrying A's handle grades merged, accepted or refused claimed-twice, and when it is pass B's only finding", async (t) => {
  const c = secondCase();
  const file = c.fixture.defect_file;
  const inSecond = `${file}:${c.fixture.second_defect_b.lines[0]}`;
  const a = [{ title: "First defect", location: `${file}:3`, severity: "major" }];
  const accepted = await runPair(t, c, a, [{ title: "Second defect", location: inSecond, carried_id: "P1", severity: "major" }]);
  assert.equal(accepted.env["finding-identity"], "merged");
  assert.equal(accepted.detail.merged, true);
  const claimedTwice = await runPair(t, c, a, [
    { title: "First defect reworded", location: `${file}:3`, carried_id: "P1", severity: "major" },
    { title: "Second defect", location: inSecond, carried_id: "P1", severity: "major" },
  ]);
  assert.equal(claimedTwice.env["finding-identity"], "merged");
  assert.equal(claimedTwice.detail.refused_carries, 1);
  const onlySecond = await runPair(t, c, a, [{ title: "Second defect", location: inSecond, carried_id: " P1 ", severity: "critical" }]);
  assert.equal(onlySecond.env["finding-identity"], "merged");
  assert.equal(onlySecond.detail.id_b, null);
});

test("stable without merging: a second-defect finding whose title alone matches A's, with no carry, is excluded from B's defect", async (t) => {
  const c = secondCase();
  const file = c.fixture.defect_file;
  const inSecond = `${file}:${c.fixture.second_defect_b.lines[1]}`;
  const out = await runPair(t, c,
    [{ title: "First defect", location: `${file}:3`, severity: "major" }],
    [{ title: "First defect, reworded", location: `${file}:4`, carried_id: "P1", severity: "major" }, { title: "First defect", location: inSecond, severity: "critical" }]);
  assert.equal(out.env["finding-identity"], "stable");
  assert.equal(out.detail.merged, false);
});

test("undetected: pass B with no defect finding, and the result counts merged and refused carries", async (t) => {
  const c = secondCase();
  const file = c.fixture.defect_file;
  const out = await runPair(t, c, [{ title: "First defect", location: `${file}:3`, severity: "major" }], [{ title: "x", location: "other.js:1", carried_id: "P1", severity: "minor" }]);
  assert.equal(out.env["finding-identity"], "undetected");
  assert.deepEqual([out.detail.carried_b, out.detail.title_stable, out.detail.refused_carries], [false, false, 1]);
  const mk = (detail, i) => ({ case_id: `c${i}`, kind: "finding-identity", rep_results: [{ detail }] });
  const r = buildFindingIdentityResult({ cases: [mk(out.detail, 0), mk({ outcome: "merged", merged: true, refused_carries: 2 }, 1)] }, { commit: "c", runAt: "t", model: "m", effort: null });
  assert.deepEqual([r.undetected, r.merged, r.refused_carries, r.stable], [1, 1, 3, 0]);
});

test("loadReviewFindingProse carries the carried_id rule", () => {
  const prose = loadReviewFindingProse();
  assert.match(prose, /"carried_id"/);
  assert.match(prose, /`carried_id` is the handle of the prior finding when this finding is the same defect/);
  assert.match(prose, /never re-raise a finding because it is listed/);
});

test("faff contract review-verdict ignores carried_id: same output with and without it", () => {
  const bare = { signal: "fail", findings: [{ location_present: true, action_present: true, severity: "major", title: "t", location: "a.js:1" }] };
  const carried = { signal: "fail", findings: [{ ...bare.findings[0], carried_id: "P1" }], extra_top_level: true };
  const a = runCli(["contract", "review-verdict"], { input: JSON.stringify(bare) });
  const b = runCli(["contract", "review-verdict"], { input: JSON.stringify(carried) });
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  assert.equal(b.stdout, a.stdout);
});

test("the adversarial SKILL carries the carries: line rule and carried_id in escalated_criticals", () => {
  const dark = readFileSync(join(ROOT, "plugin", "skills", "faffter-dark-adversarial-review", "SKILL.md"), "utf8");
  assert.match(dark, /`carries: P<k>`/);
  assert.match(dark, /"escalated_criticals": \[ \{ "severity": "critical", "location": "\.\.\.", "title": "\.\.\.", "carried_id"/);
  assert.match(dark, /copied verbatim from its section's first `carries:` line/);
});
