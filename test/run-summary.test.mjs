// FAFF-1435 — `faff run summary`: beep-boop's run summary rendered from the run directory.
// Fixtures are minted by the real writers (test/fixtures/run-summary/build.mjs). Most cases drive
// the in-process renderer with injected deps (a stubbed forge, a fixed doctor); the exit codes,
// the no-subprocess guarantee and the integration smoke run the shipped CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { buildRun, buildReference, referenceGh, cli, REPO, CLI } from "./fixtures/run-summary/build.mjs";

const require = createRequire(import.meta.url);
const rs = require("../plugin/skills/faff/bin/lib/run-summary.js");
const { extractParksBlock } = require("../plugin/skills/faff/bin/lib/park-history.js");
const reconcile = require("../plugin/skills/faff/bin/lib/reconcile.js");

// Economics meters transcripts under $HOME; an empty home makes every figure the estimate path.
const EMPTY_HOME = mkdtempSync(join(tmpdir(), "faff-run-summary-home-"));
process.env.HOME = EMPTY_HOME;
delete process.env.CLAUDE_CONFIG_DIR;

const CLEAN_DOCTOR = () => ({ exit: 0, resultLine: "RESULT: all faff skills are dev-linked (symlinks) — repo is live." });
const NO_FORGE = (args) => ({ ok: false, data: null, stderr: `unstubbed gh ${args.join(" ")}` });
const ECON = () => ({ tokens_total: 1000, tokens_source: "estimate", cost_total: null, zero_ship: false, cost_per_shipped: { tokens_each: 1000, cost_each: null }, cost_per_attempt: { denom: 1, tokens_each: 1000, cost_each: null }, buckets: [{ bucket: "shipped", count: 1 }], per_issue: [], warnings: [] });

function deps(over = {}) {
  return { ghJson: NO_FORGE, doctor: CLEAN_DOCTOR, economics: ECON, budget: () => ({ breached: [], tokens_source: "estimate" }), methodology: () => null, ...over };
}

function writeFacts(root, facts) {
  const p = join(root, `facts-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(p, typeof facts === "string" ? facts : JSON.stringify(facts));
  return p;
}

function render(fx, facts, over = {}) {
  const factsPath = facts === null ? null : writeFacts(fx.root, facts);
  return rs.renderRunSummary({ runDir: fx.runDir, factsPath, root: fx.root, sessionId: null }, deps(over));
}

const F = (run = {}, tracker = {}) => ({ format: 2, tracker, run });
const lines = (text) => text.split("\n");
const has = (text, heading) => lines(text).some((l) => l.startsWith(heading));

// --- Scenarios (spec §Scenarios) ---

test("scenario: no facts file — first line is the facts warning; awaiting landing renders, spec-review holds do not", () => {
  const fx = buildRun({ admitted: ["Q"], outcomes: { Q: "pr-open" }, ledger: { landing_resumable: ["Q"], spec_review_outage_pending: [], spec_review_turn_budget_pending: [] } });
  const r = cli(fx.root, ["run", "summary", "--run-dir", fx.runDir], { env: { HOME: EMPTY_HOME } });
  assert.equal(r.code, 0, r.err);
  assert.match(lines(r.out)[0], /^⚠ could not read facts: /);
  assert.ok(r.out.includes("## Awaiting landing (resumable): 1"));
  assert.ok(!r.out.includes("Awaiting spec-review"));
  assert.equal(readFileSync(join(fx.runDir, "summary.md"), "utf8"), r.out);
});

test("scenario: a shipped id flagged by both annotations renders only under post-merge flagged (the A9 tie-break)", () => {
  const fx = buildRun({ admitted: ["X"], outcomes: { X: "shipped" }, ledger: { review_adversarial_skipped: ["X"], post_merge_verification_failures: [{ issue: "X", command: "npm test" }] } });
  const out = render(fx, F());
  const sections = out.split("\n## ");
  const inSection = (h) => sections.filter((s) => s.startsWith(h)).some((s) => s.includes("- X"));
  assert.ok(inSection("Shipped (post-merge verification flagged)"));
  assert.ok(!inSection("Shipped (auto-merged)"));
  assert.ok(!inSection("Shipped (adversarial review skipped"));
});

test("scenario: superseded cites the delivering ids", () => {
  const fx = buildRun({ admitted: ["Y"], outcomes: { Y: "superseded" }, files: { "Y/supersession.json": { issue: "Y", superseded_by: ["W"] } } });
  const out = render(fx, F());
  assert.ok(out.includes("## Superseded (delivered by prior tickets): 1"));
  assert.ok(lines(out).some((l) => l.includes("Y") && l.includes("W")));
});

test("scenario: an L4 phantom merge escalates", () => {
  const fx = buildRun({ admitted: ["S"], outcomes: { S: "shipped" }, ledger: { level: "L4" }, files: { "S/merge-record.json": { pr: 9, head_sha: "aaa" }, "sibling-baseline.json": [] } });
  const gh = (args) => (args[1] === "view" ? { ok: true, data: { state: "MERGED", headRefOid: "bbb" }, stderr: "" } : NO_FORGE(args));
  const out = render(fx, F(), { ghJson: gh });
  assert.ok(lines(out).some((l) => l.startsWith("## Ground-truth divergences") && l.endsWith("ESCALATED")));
  assert.ok(lines(out).some((l) => l.startsWith("- [phantom-merge] S")));
});

test("scenario: hostile title and park record create no banned heading", () => {
  const fx = buildRun({ admitted: ["Z"], outcomes: { Z: "parked" } });
  const out = render(fx, F({ park_records: [{ issue_id: "Z", root_cause_class: "c\n## Queued for next run", timestamp: "2026-10-29T00:00:00Z" }] }, { titles: { Z: "t\n## Deferred" } }));
  assert.ok(!lines(out).some((l) => l.startsWith("## Deferred") || l.startsWith("## Queued for next run")));
});

// --- Conditional sections (A1–A23): each renders under its rule and is absent otherwise ---

test("A1: install-health warning first when doctor reports unclean; absent when clean; a throwing doctor renders its could-not-read line", () => {
  const fx = buildRun({});
  const dirty = render(fx, F(), { doctor: () => ({ exit: 1, resultLine: "RESULT: 2 copy / 0 dangling skill link(s) — install is not clean." }) });
  assert.equal(lines(dirty)[0], "⚠ INSTALL-HEALTH: RESULT: 2 copy / 0 dangling skill link(s) — install is not clean. — remediation: run `faff sync`");
  assert.ok(!render(fx, F()).includes("INSTALL-HEALTH"));
  assert.ok(!render(fx, F(), { doctor: () => ({ exit: 2, resultLine: "RESULT: none" }) }).includes("INSTALL-HEALTH"));
  const thrown = render(fx, F(), { doctor: () => { throw new Error("scan failed"); } });
  assert.equal(lines(thrown)[0], "⚠ could not read install health: scan failed");
  const withNote = render(fx, null, { doctor: () => ({ exit: 1, resultLine: "RESULT: x" }) });
  assert.match(lines(withNote)[0], /^⚠ could not read facts/);
  assert.match(lines(withNote)[1], /^⚠ INSTALL-HEALTH/);
});

test("A2/A5: methodology line and findings only when configured", () => {
  const fx = buildRun({});
  const on = render(fx, F({ methodology_findings: { findings: ["re-ordered 2 groups"], prd_distance: "0 matches" } }), { methodology: () => "lens-x" });
  assert.equal(lines(on)[0], "Methodology: lens-x");
  assert.ok(on.includes("## Methodology findings _(reported)_"));
  assert.ok(on.includes("- re-ordered 2 groups _(reported)_"));
  const off = render(fx, F({ methodology_findings: { findings: ["x"] } }));
  assert.ok(!off.includes("Methodology"));
});

test("A3: header — mode, duration, sentry count and max, waves, stop reason; unreadable events marked", () => {
  const fx = buildRun({ mode: "full", ledger: { stop_reason: "queue-drained" }, events: [{ ts: "2026-01-01T00:30:00.000Z", type: "sentry-checkpoint", data: { intervention: "pause" } }] });
  const out = render(fx, F({ waves: 3 }));
  assert.ok(out.includes("# Beep-Boop Run — 2026-01-01 00:00:00"));
  assert.ok(out.includes("Mode: full · Duration: 2h 34m"));
  assert.ok(out.includes("Sentry: 1 checkpoints · max intervention: pause · Waves: 3 _(reported)_"));
  assert.ok(out.includes("Stop reason: queue-drained"));
  unlinkSync(join(fx.runDir, "events.jsonl"));
  assert.ok(render(fx, F()).includes("Sentry: (events unreadable)"));
});

test("A4: economics renders its figures, ZERO-SHIP and warnings; a throwing function renders unavailable", () => {
  const fx = buildRun({ admitted: ["A"], outcomes: { A: "parked" }, ledger: { budget: { metering: { degraded: true } } } });
  const out = render(fx, F(), { economics: () => ({ ...ECON(), zero_ship: true, warnings: ["w1"] }) });
  assert.ok(out.includes("per shipped — (0 shipped) ⚠ ZERO-SHIP"));
  assert.ok(out.includes("⚠ w1"));
  assert.ok(out.includes("⚠ metering degraded at mint"));
  const bad = render(fx, F(), { economics: () => { throw new Error("no ledger"); } });
  assert.ok(bad.includes("Unit economics unavailable (no ledger)"));
});

test("A6/A7: verdict counts and routed-out classes", () => {
  const fx = buildRun({ admitted: ["R"], outcomes: { R: "routed-out" } });
  const out = render(fx, F({ verdicts: { fire_and_forget: 2, likely_fire: 1, routed_out: { "gap-blocked": [{ id: "R", detail: "spec assumes a queue" }] } }, gloss: { R: "queue work" } }));
  assert.ok(out.includes("- fire-and-forget: 2 _(reported)_"));
  assert.ok(out.includes("(admitted: 1 total)"));
  assert.ok(out.includes("gap-blocked (1) _(reported)_"));
  assert.ok(out.includes("- R  queue work — spec assumes a queue _(reported)_"));
  assert.ok(!render(buildRun({}), F()).includes("## Routed out"));
});

test("A8: resolve-attempts only when reported", () => {
  const fx = buildRun({});
  assert.ok(render(fx, F({ resolve_attempts: { attempted: 1, succeeded: 1, failed: 0, proceeded_medium: [{ id: "P", inferred: "x", evidence: "y", pr: 3 }] } })).includes("## Resolve-attempts"));
  assert.ok(!render(fx, F({ resolve_attempts: null })).includes("## Resolve-attempts"));
});

test("A9/A10: adversarial-skipped and post-merge sections only when their arrays say so", () => {
  const plain = render(buildRun({ admitted: ["A"], outcomes: { A: "shipped" } }), F());
  assert.ok(plain.includes("## Shipped (auto-merged): 1"));
  assert.ok(!plain.includes("adversarial review skipped") && !plain.includes("post-merge verification flagged"));
  const skipped = render(buildRun({ admitted: ["A"], outcomes: { A: "shipped" }, ledger: { review_adversarial_skipped: ["A"] } }), F());
  assert.ok(skipped.includes("## Shipped (adversarial review skipped — chain outage): 1"));
  const unverified = render(buildRun({ admitted: ["A"], outcomes: { A: "shipped" }, ledger: { post_merge_verification_unverified: ["A"] } }), F());
  assert.ok(unverified.includes("## Shipped (post-merge verification flagged): 1"));
});

test("A11: superseded absent without a superseded outcome; a missing record is named", () => {
  assert.ok(!render(buildRun({}), F()).includes("## Superseded"));
  const out = render(buildRun({ admitted: ["Y"], outcomes: { Y: "superseded" } }), F());
  assert.ok(out.includes("(supersession record missing)"));
});

test("A12: PR-open vs awaiting landing", () => {
  const out = render(buildRun({ admitted: ["P", "Q"], outcomes: { P: "pr-open", Q: "pr-open" }, ledger: { landing_resumable: ["Q"] } }), F({ reasons: { P: "CI failing" } }));
  assert.ok(out.includes("## PR open for human review: 1"));
  assert.ok(out.includes("- P — reason: CI failing _(reported)_"));
  assert.ok(out.includes("## Awaiting landing (resumable): 1"));
  assert.ok(!render(buildRun({ admitted: ["P"], outcomes: { P: "pr-open" } }), F()).includes("Awaiting landing"));
});

test("A13: the parks block is `[]` for zero parks and carries the records", () => {
  const empty = render(buildRun({}), F());
  assert.deepEqual(extractParksBlock(empty, "r"), []);
  const rec = { issue_id: "Z", root_cause_class: "low-confidence", timestamp: "2026-01-01T00:00:00Z" };
  const out = render(buildRun({ admitted: ["Z"], outcomes: { Z: "parked" } }), F({ park_records: [rec] }));
  assert.deepEqual(extractParksBlock(out, "r"), [rec]);
  assert.ok(out.includes("## Parked: 1 _(reported)_"));
});

test("A13: a park record holding a backtick run still round-trips through park-history", () => {
  const rec = { issue_id: "Z", root_cause_class: "fence ```` inside", timestamp: "t" };
  const out = render(buildRun({ admitted: ["Z"], outcomes: { Z: "parked" } }), F({ park_records: [rec] }));
  assert.deepEqual(extractParksBlock(out, "r"), [rec]);
  assert.ok(out.includes("`````faff-parks"));
});

test("A14/A15: the outage and slow-fan-out holds render only when their arrays are non-empty", () => {
  const held = render(buildRun({ admitted: ["H"], outcomes: { H: "parked" }, ledger: { review_outage_pending: ["H"], spec_review_outage_pending: ["S1"], spec_review_turn_budget_pending: ["S2"] } }), F());
  assert.ok(held.includes("## Awaiting review (adversarial outage): 1"));
  assert.ok(held.includes("## Awaiting spec-review (adversarial outage): 1"));
  assert.ok(held.includes("## Awaiting spec-review (slow fan-out): 1"));
  assert.ok(held.includes("## Parked: 0"));
  const none = render(buildRun({}), F());
  assert.ok(!none.includes("Awaiting review") && !none.includes("Awaiting spec-review"));
});

test("A16: errored with its reported reason", () => {
  const out = render(buildRun({ admitted: ["E"], outcomes: { E: "errored" } }), F({ reasons: { E: "MCP timeout" } }));
  assert.ok(out.includes("## Errored: 1"));
  assert.ok(out.includes("- E — MCP timeout _(reported)_"));
});

test("A17: unreached only on an unreached-budget outcome; tokens_source on a tokens breach; a throwing budget degrades", () => {
  assert.ok(!render(buildRun({}), F()).includes("## Unreached"));
  const fx = buildRun({ admitted: ["U"], outcomes: { U: "unreached-budget" } });
  const out = render(fx, F(), { budget: () => ({ breached: ["tokens"], tokens_source: "transcript" }) });
  assert.ok(out.includes("## Unreached (budget hit): 1"));
  assert.ok(out.includes("tokens_source: transcript"));
  assert.ok(render(fx, F(), { budget: () => { throw new Error("x"); } }).includes("## Unreached (budget hit): 1"));
});

test("A18: product-incomplete only when the holdout record exists; environment gaps apart from human-only; unknown codes named", () => {
  assert.ok(!render(buildRun({}), F()).includes("Product-incomplete"));
  const fx = buildRun({});
  const holdoutDir = join(fx.root, ".faff", "holdout");
  mkdirSync(holdoutDir, { recursive: true });
  writeFileSync(join(holdoutDir, `${fx.runId}.json`), JSON.stringify({ aggregate: "needs-human", needs_human_reasons: { "no-surface": 2, "human-only": 1, "mystery": 1 } }));
  const out = render(fx, F());
  assert.ok(out.includes("## Product-incomplete (holdout escalation)"));
  assert.ok(out.includes("- Environment gaps (fix the env and re-run): no-surface 2"));
  assert.ok(out.includes("- Human-only: 1"));
  assert.ok(out.includes("- Unrecognised reason codes: mystery 1"));
  writeFileSync(join(holdoutDir, `${fx.runId}.json`), JSON.stringify({ aggregate: "needs-human", criteria: [{ verdict: "needs-human", reason_code: "wire-error" }, { verdict: "needs-human" }] }));
  assert.ok(render(fx, F()).includes("- Environment gaps (fix the env and re-run): wire-error 1, unspecified 1"));
});

test("A19: ground-truth divergences render only when reconcile found one (or a read failed); warn at L3", () => {
  const clean = buildRun({ admitted: ["S"], outcomes: { S: "shipped" }, ledger: { level: "L3" }, files: { "S/merge-record.json": { pr: 9, head_sha: "aaa" }, "sibling-baseline.json": [] } });
  const merged = (args) => (args[1] === "view" ? { ok: true, data: { state: "MERGED", headRefOid: "aaa" }, stderr: "" } : NO_FORGE(args));
  assert.ok(!render(clean, F(), { ghJson: merged }).includes("Ground-truth"));
  const unmerged = (args) => (args[1] === "view" ? { ok: true, data: { state: "OPEN", headRefOid: "aaa" }, stderr: "" } : NO_FORGE(args));
  const out = render(clean, F(), { ghJson: unmerged });
  assert.ok(lines(out).some((l) => l.startsWith("## Ground-truth divergences: 1") && l.endsWith("— warn")));
  assert.ok(out.includes("- [claimed-shipped-unmerged] S"));
});

test("A20/A21/A22: inferred deps, discovered scope and follow-ups only when present", () => {
  const fx = buildRun({ ledger: { discovered_scope_filed: 1 } });
  const out = render(fx, F({ inferred_deps: { edges: [{ consumer: "E", producer: "D", note: "rate limiter" }] }, discovered_scope: { filed: [{ from: "X", id: "N-1", title: "t", relationship: "downstream" }], deduped: 0, surfaced: [] }, follow_ups: ["delete branch feat/x"] }));
  assert.ok(out.includes("## Inferred build-order deps: 1"));
  assert.ok(out.includes("## Discovered scope (execution-reported): 1 filed"));
  assert.ok(out.includes("## Human follow-ups: 1 _(reported)_"));
  const none = render(buildRun({}), F());
  assert.ok(!none.includes("Inferred build-order") && !none.includes("Discovered scope") && !none.includes("Human follow-ups"));
});

test("A23: prep summary and tidy only in full mode", () => {
  const facts = F({ prep_summary: { refreshed: 1, promoted: 2, promoted_needs_review: 0, parked: 0, errored: 0 }, tidy_log: "logs/2026-01-01/000000-tidy.md" });
  const full = render(buildRun({ mode: "full" }), facts);
  assert.ok(full.includes("## Prep queue summary (full mode only)") && full.includes("## Tidy findings (full mode only)"));
  const list = render(buildRun({ mode: "list" }), facts);
  assert.ok(!list.includes("Prep queue summary") && !list.includes("Tidy findings"));
});

test("A24: no banned heading appears for any fixture in this file's shapes", () => {
  const banned = ["Deferred", "Queued for next run", "Saved for later", "Not dispatched this conversation", "Build queue ready for next pass"];
  const out = render(buildRun({ admitted: ["A", "B"], outcomes: { A: "parked", B: "unreached-budget" } }), F());
  for (const b of banned) assert.ok(!lines(out).some((l) => l.startsWith("#") && l.includes(b)), b);
});

// --- Facts problems, ledger faults, neutralisation ---

test("facts problems: absent, invalid JSON, format missing, an unknown key — each exits 0 with its ⚠ line", () => {
  const fx = buildRun({});
  for (const [facts, want] of [[null, /^⚠ could not read facts: no facts file given$/], ["{not json", /^⚠ could not read facts: invalid JSON/], [{ tracker: {} }, /^⚠ could not read facts: format missing$/]]) {
    assert.match(lines(render(fx, facts))[0], want);
  }
  const unknown = render(fx, { format: 2, bogus: 1, run: { nope: 1 } });
  assert.ok(lines(unknown).includes("⚠ facts: unknown key(s) bogus, run.nope"));
  const r = cli(fx.root, ["run", "summary", "--run-dir", fx.runDir, "--facts", writeFacts(fx.root, "{")], { env: { HOME: EMPTY_HOME } });
  assert.equal(r.code, 0);
});

test("facts problems: a malformed facts file whose bytes include a heading yields one ⚠ line and no heading", () => {
  const fx = buildRun({});
  const out = render(fx, '{"format":2,\n## Deferred\n');
  assert.match(lines(out)[0], /^⚠ could not read facts: invalid JSON/);
  assert.ok(!lines(out).some((l) => l.startsWith("## Deferred")));
  const keyed = render(fx, JSON.stringify({ format: 2, "x\n## Deferred": 1 }));
  assert.ok(!lines(keyed).some((l) => l.startsWith("## Deferred")));
});

test("ledger faults: missing admitted exits 2; a mistyped annotation array renders its could-not-read line", () => {
  const fx = buildRun({});
  const ledgerPath = join(fx.runDir, "run-ledger.json");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  writeFileSync(ledgerPath, JSON.stringify({ ...ledger, landing_resumable: "Q" }));
  assert.ok(render(fx, F()).includes("- (could not read landing_resumable: not an array of issue ids)"));
  delete ledger.admitted;
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  const r = cli(fx.root, ["run", "summary", "--run-dir", fx.runDir], { env: { HOME: EMPTY_HOME } });
  assert.equal(r.code, 2);
  assert.match(r.err, /admitted/);
});

test("neutralisation: x\\n## Deferred in every facts string field creates no heading", () => {
  const hostile = "x\n## Deferred";
  const fx = buildRun({ mode: "full", admitted: ["A", "R", "E", "P"], outcomes: { A: "shipped", R: "routed-out", E: "errored", P: "pr-open" }, ledger: { discovered_scope_filed: 1 } });
  const stringFields = [
    (h) => F({}, { titles: { A: h, R: h, E: h, P: h } }),
    (h) => F({ gloss: { R: h } }),
    (h) => F({ reasons: { E: h, P: h } }),
    (h) => F({ methodology_findings: { findings: [h], prd_distance: h } }),
    (h) => F({ verdicts: { routed_out: { "gap-blocked": [{ id: h, detail: h }] } } }),
    (h) => F({ resolve_attempts: { attempted: 1, succeeded: 1, failed: 0, proceeded_medium: [{ id: h, inferred: h, evidence: h }] } }),
    (h) => F({ park_records: [{ issue_id: h, root_cause_class: h, timestamp: h }] }),
    (h) => F({ inferred_deps: { edges: [{ consumer: h, producer: h, note: h }], ambiguous: [{ id: h, text: h }], cycles: [h] } }),
    (h) => F({ discovered_scope: { filed: [{ from: h, id: h, title: h, relationship: h }], deduped: 0, surfaced: [{ id: h, text: h, why: h }] } }),
    (h) => F({ follow_ups: [h] }),
    (h) => F({ tidy_log: h, prep_summary: { refreshed: 0 } }),
  ];
  for (const mk of stringFields) {
    const out = render(fx, mk(hostile), { methodology: () => "lens" });
    assert.ok(!lines(out).some((l) => l.startsWith("## Deferred")), JSON.stringify(mk("…")));
  }
  assert.equal(rs.factText("# heading"), "\\# heading");
  assert.equal(rs.factText("1. item"), "\\1. item");
  assert.equal(rs.factText("```fence"), "\\```fence");
});

test("labelling: facts-sourced lines end _(reported)_, the ⚠ facts diagnostics do not, disk-only lines do not", () => {
  const fx = buildRun({ admitted: ["A", "B"], outcomes: { A: "shipped", B: "errored" }, files: { "A/merge-record.json": { pr: 5, head_sha: "h" } } });
  const titled = render(fx, { format: 2, extra: 1, tracker: { titles: { A: "Alpha" } }, run: { reasons: { B: "boom" } } });
  for (const l of lines(titled)) {
    if (l.includes("Alpha") || l.includes("boom")) assert.ok(l.endsWith(" _(reported)_"), l);
    if (l.startsWith("⚠ facts:") || l.startsWith("⚠ could not read facts")) assert.ok(!l.endsWith("_(reported)_"), l);
  }
  assert.ok(titled.includes("## Parked: 0 _(reported)_"));
  assert.ok(lines(titled).includes("## Errored: 1"));
  assert.ok(lines(titled).includes("## Shipped (auto-merged): 1"));
  const untitled = render(fx, F());
  assert.ok(lines(untitled).includes("- A (PR #5)"));
});

// --- Determinism, reconcile equivalence, forge, tracker observations, doctor, PR lookup ---

test("determinism: two renders at different clocks and ambient session ids, same forge responses, are byte-identical", () => {
  const fx = buildReference();
  const realNow = Date.now;
  const first = (() => { Date.now = () => 1; process.env.CLAUDE_CODE_SESSION_ID = "aaa"; return render(fx, JSON.parse(readFileSync(fx.factsPath, "utf8")), { ghJson: referenceGh, economics: rs.realDeps().economics }); })();
  const second = (() => { Date.now = () => 9e12; process.env.CLAUDE_CODE_SESSION_ID = "zzz"; return render(fx, JSON.parse(readFileSync(fx.factsPath, "utf8")), { ghJson: referenceGh, economics: rs.realDeps().economics }); })();
  Date.now = realNow;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  assert.equal(first, second);
});

test("reconcile in-process: a phantom merge, and the result deep-equals `faff reconcile --json` on the same input", () => {
  const fx = buildRun({ admitted: ["S"], outcomes: { S: "shipped" }, ledger: { level: "L3" }, files: { "S/merge-record.json": { pr: 9, head_sha: "aaa" }, "sibling-baseline.json": [] } });
  const gh = (args) => (args[1] === "view" ? { ok: true, data: { state: "MERGED", headRefOid: "bbb" }, stderr: "" } : NO_FORGE(args));
  const ledger = JSON.parse(readFileSync(join(fx.runDir, "run-ledger.json"), "utf8"));
  const { input } = rs.assembleReconcileInput(fx.runDir, ledger, {}, deps({ ghJson: gh }), Object.entries(ledger.outcomes));
  const inProcess = reconcile.reconcileCore(input);
  assert.equal(inProcess.divergences[0].class, "phantom-merge");
  const r = cli(fx.root, ["reconcile", "--run-dir", fx.runDir, "--level", "L3", "--json"], { input: JSON.stringify(input) });
  assert.deepEqual(JSON.parse(r.out), inProcess);
});

test("forge failure: a failing gh renders could-not-read-forge lines and the render still exits 0", () => {
  const fx = buildRun({ admitted: ["S", "P"], outcomes: { S: "shipped", P: "pr-open" }, files: { "S/merge-record.json": { pr: 9, head_sha: "aaa" } } });
  const out = render(fx, F());
  assert.ok(out.includes("- could not read forge: S PR #9"));
  assert.ok(out.includes("- could not read forge: PR lookup for P"));
});

test("no tracker facts: superseded and siblings with a readable baseline fabricate no divergence and say the checks did not run", () => {
  const fx = buildRun({ admitted: ["Y"], outcomes: { Y: "superseded" }, files: { "Y/supersession.json": { issue: "Y", superseded_by: ["W"] }, "sibling-baseline.json": [{ issue: "SIB-1", start_state_terminal: false }] } });
  const out = render(fx, null);
  for (const cls of ["superseded-unproven", "unowned-sibling-mutation", "sibling-check-unproven"]) assert.ok(!out.includes(`[${cls}]`), cls);
  assert.ok(out.includes("- could not read tracker observations: superseded and sibling checks not run"));
  const ledger = JSON.parse(readFileSync(join(fx.runDir, "run-ledger.json"), "utf8"));
  const { input } = rs.assembleReconcileInput(fx.runDir, ledger, undefined, deps(), Object.entries(ledger.outcomes));
  assert.equal(reconcile.validateReconcileInput(input), null);
});

test("missing baseline: no sibling-baseline.json renders exactly one sibling-check-unproven line", () => {
  const fx = buildRun({ admitted: ["Y"], outcomes: { Y: "superseded" }, files: { "Y/supersession.json": { issue: "Y", superseded_by: ["W"] } } });
  const out = render(fx, null);
  assert.equal(lines(out).filter((l) => l.startsWith("- [sibling-check-unproven] run:")).length, 1);
});

test("PR lookup order: merge-record wins over landing-loop, which wins over the forge; a forge hit on another branch is ignored", () => {
  const forge = (args) => (args[1] === "list" ? { ok: true, data: [{ number: 77, headRefName: "other-branch" }, { number: 88, headRefName: `${args[3].split(" ")[0].toLowerCase()}-x` }], stderr: "" } : NO_FORGE(args));
  const fx = buildRun({ admitted: ["A", "B", "C"], outcomes: { A: "pr-open", B: "pr-open", C: "pr-open" }, files: { "A/merge-record.json": { pr: 1 }, "A/landing-loop.json": { pr: 2 }, "B/landing-loop.json": { pr: 3 } } });
  const out = render(fx, F(), { ghJson: forge });
  assert.ok(out.includes("- A (PR #1)"));
  assert.ok(out.includes("- B (PR #3)"));
  assert.ok(out.includes("- C (PR #88)"));
});

test("doctor in-process: the real install-health path renders doctor's own RESULT text when unclean", () => {
  const fx = buildRun({});
  const real = rs.realDeps();
  const d = real.doctor(fx.root);
  const out = render(fx, F(), { doctor: real.doctor });
  if (d.exit === 1) assert.ok(lines(out)[0].startsWith(`⚠ INSTALL-HEALTH: ${d.resultLine}`));
  else assert.ok(!out.includes("INSTALL-HEALTH"));
});

test("no faff subprocess: with every child_process spawn but gh made to throw, the CLI still renders economics and install health", () => {
  const fx = buildRun({ admitted: ["P"], outcomes: { P: "pr-open" } });
  const guard = join(fx.root, "spawn-guard.cjs");
  writeFileSync(guard, `
const cp = require("node:child_process");
const deny = (name) => function (cmd, args) {
  if (cmd === "gh") return name === "spawnSync" ? { status: 0, stdout: "[]", stderr: "" } : "[]";
  throw new Error("spawn denied: " + name + " " + cmd + " " + (Array.isArray(args) ? args.join(" ") : ""));
};
for (const n of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) cp[n] = deny(n);
`);
  const base = { ...process.env, HOME: EMPTY_HOME };
  delete base.FAFF_RUN_DIR;
  const r = spawnSync("node", ["--require", guard, CLI, "run", "summary", "--run-dir", fx.runDir, "--root", fx.root], { cwd: fx.root, encoding: "utf8", env: base });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes("Unit economics unavailable"), r.stdout);
  assert.ok(!r.stdout.includes("could not read install health"), r.stdout);
  assert.ok(!r.stderr.includes("spawn denied"), r.stderr);
});

test("an unwritable --out exits 2 with a cannot-write line", () => {
  const fx = buildRun({});
  const r = cli(fx.root, ["run", "summary", "--run-dir", fx.runDir, "--out", join(fx.root, "no-such-dir", "summary.md")], { env: { HOME: EMPTY_HOME } });
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot write/);
});

test("`faff run bogus` exits 2 with a usage line naming summary", () => {
  const r = cli(REPO, ["run", "bogus"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /registered verbs: summary/);
});

// --- The synthetic reference golden and the integration smoke ---

const GOLDEN = join(REPO, "test", "fixtures", "run-summary", "reference.golden.md");

test("synthetic reference fixture renders the committed golden (in-process, stubbed forge, clean doctor)", () => {
  const fx = buildReference();
  const out = rs.renderRunSummary({ runDir: fx.runDir, factsPath: fx.factsPath, root: fx.root, sessionId: null }, { ...rs.realDeps(), ghJson: referenceGh, doctor: CLEAN_DOCTOR });
  if (process.env.FAFF_UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, out);
  assert.equal(out, readFileSync(GOLDEN, "utf8"));
});

test("integration smoke: the CLI on the reference fixture equals the golden outside install health and ground truth", () => {
  const fx = buildReference();
  const r = cli(fx.root, ["run", "summary", "--run-dir", fx.runDir, "--facts", fx.factsPath, "--root", fx.root], { env: { HOME: EMPTY_HOME } });
  assert.equal(r.code, 0, r.err);
  const strip = (t) => {
    const out = [];
    let skip = false;
    for (const l of t.split("\n")) {
      if (l.startsWith("⚠ INSTALL-HEALTH") || l.startsWith("⚠ could not read install health")) continue;
      if (l.startsWith("## ")) skip = l.startsWith("## Ground-truth divergences");
      if (l.startsWith("- could not read forge")) continue;
      if (!skip) out.push(l);
    }
    return out.join("\n");
  };
  assert.equal(strip(r.out), strip(readFileSync(GOLDEN, "utf8")));
  assert.equal(readFileSync(join(fx.runDir, "summary.md"), "utf8"), r.out);
});
