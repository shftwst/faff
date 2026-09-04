// FAFF-913 — governance-check's `::error::` annotation renderer (spec §7 "Integration
// smoke test" + the golden-fixture DoD item).
//
// The renderer surfaces a failing `governance-check` verdict as job-level GitHub Actions
// `::error::` annotations — the one surface a required-check failure directs the reader to
// — while keeping local text output and `--json` stdout byte-for-byte unchanged. The verb
// owns rendering (a third renderer in governance-check.js), so local and CI never drift.
//
// The tests drive `cmdGovernanceCheck` in-process, capturing console.log (the pinned
// annotation stream), and toggling GITHUB_ACTIONS / --json in the test process env, exactly
// as spec §7 describes. The golden fixture is the separate cross-commit regression oracle
// proving the two pre-existing renderers stay byte-identical.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cmdGovernanceCheck,
  renderGovernanceCheckText,
  renderGovernanceCheckSummaryMd,
  renderGovernanceCheckAnnotations,
  escapeWorkflowData,
} from "../plugin/skills/faff/bin/lib/governance-check.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// --- helpers ---------------------------------------------------------------

// Run `fn` with console.log captured; return the captured stdout exactly as the lib's
// renderers write it (each console.log call is one joined line + trailing newline), and
// restore console.log on every path.
function captureStdout(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => { lines.push(args.map(String).join(" ")); };
  let ret;
  try { ret = fn(); }
  finally { console.log = orig; }
  const out = lines.length ? lines.join("\n") + "\n" : "";
  return { out, ret };
}

// Run cmdGovernanceCheck with a scoped env override (GITHUB_ACTIONS), always restored.
function runGovCheck(args, { githubActions } = {}) {
  const had = Object.prototype.hasOwnProperty.call(process.env, "GITHUB_ACTIONS");
  const prev = process.env.GITHUB_ACTIONS;
  if (githubActions === undefined) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = githubActions;
  try {
    return captureStdout(() => cmdGovernanceCheck(args));
  } finally {
    if (had) process.env.GITHUB_ACTIONS = prev;
    else delete process.env.GITHUB_ACTIONS;
  }
}

// Build a tmp anchor dir named for `issue`, mirroring PR #754's real shape: a complete
// ac-checklist and a non-`pass` review verdict, so merge_floor fails and nothing else does.
// No events.jsonl → the integrity leg is a clean verified no-op, isolating the failure to
// merge_floor.
function buildAnchorDir(issue, reviewSignal) {
  const root = mkdtempSync(path.join(tmpdir(), "faff913-anchor-"));
  const dir = path.join(root, issue);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "chain-head.json"), JSON.stringify({ run_id: `run-${issue}`, issue }));
  writeFileSync(path.join(dir, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
  writeFileSync(path.join(dir, "review-verdict.json"), JSON.stringify({ signal: reviewSignal, findings: [] }));
  return { root, dir };
}

const ERROR_LINE = /^::error::/;

// --- smoke test (spec §7) --------------------------------------------------

test("FAFF-913 smoke steps 1-6: a failing merge_floor anchor emits a named ::error:: annotation + one remediation line (GITHUB_ACTIONS=true)", () => {
  const { root, dir } = buildAnchorDir("FAFF-1", "unavailable");
  try {
    const { out, ret } = runGovCheck(["--anchor-dir", dir, "--issue", "FAFF-1"], { githubActions: "true" });
    assert.equal(ret, 1, "step 4: exit code 1 (failing verdict)");

    const errLines = out.split("\n").filter((l) => ERROR_LINE.test(l));
    // step 5: a per-reason annotation naming the run/anchor, the issue, and the exact cause.
    assert.ok(
      errLines.some((l) => /^::error::faff governance-check: .*FAFF-1.*merge_floor.*review-verdict/.test(l)),
      `step 5: expected a merge_floor/review-verdict annotation naming FAFF-1; got:\n${out}`,
    );
    // step 6: exactly one trailing remediation line.
    const remediation = errLines.filter((l) =>
      /^::error::faff governance-check: merge_floor failures need recorded evidence/.test(l));
    assert.equal(remediation.length, 1, `step 6: exactly one remediation line; got ${remediation.length}\n${out}`);
    assert.ok(/docs\/guide\/governance-check\.md/.test(remediation[0]), "remediation points at the docs guide");
    assert.ok(/faff-graft/.test(remediation[0]), "remediation points at /faff-graft's review step");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FAFF-913 smoke step 7: reason data containing a newline, percent, and :: rides a single ::error:: line, escaped, with no injected second command", () => {
  const nasty = "run-x/FAFF-1: merge_floor — payload with %pct, a\nnewline, and a ::warning:: delimiter";
  const verdict = {
    pass: false,
    reasons: [nasty],
    runs: [{ run_id: "run-x", run_dir: "/x", legs: { merge_floor: { pass: false, issues: [] } } }],
  };
  const had = Object.prototype.hasOwnProperty.call(process.env, "GITHUB_ACTIONS");
  const prev = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = "true";
  let out;
  try {
    ({ out } = captureStdout(() => renderGovernanceCheckAnnotations(verdict)));
  } finally {
    if (had) process.env.GITHUB_ACTIONS = prev; else delete process.env.GITHUB_ACTIONS;
  }

  // The nasty reason must render on exactly ONE physical line.
  const reasonLines = out.split("\n").filter((l) => l.includes("payload with"));
  assert.equal(reasonLines.length, 1, `the reason data must ride a single line; got ${reasonLines.length}\n${out}`);
  const line = reasonLines[0];
  assert.ok(line.includes("%25pct"), "percent escaped to %25");
  assert.ok(line.includes("a%0Anewline"), "newline escaped to %0A");
  assert.ok(line.includes("%3A%3Awarning%3A%3A"), "the :: delimiter escaped to %3A%3A");
  // No bare newline survived inside the data, and the ONLY line-leading `::` token is the
  // intended `::error::` prefix — no second `::`-delimited workflow command was opened.
  assert.ok(!/[^%]\n/.test("X" + line), "no bare newline inside the rendered data");
  assert.ok(line.startsWith("::error::faff governance-check: "), "line leads with the ::error:: prefix");
  assert.ok(!line.slice("::error::".length).includes("::"), "no second :: delimiter survives in the data");
});

test("FAFF-913 smoke step 8: GITHUB_ACTIONS unset prints zero ::error:: lines and is byte-identical to renderGovernanceCheckText output", () => {
  const { root, dir } = buildAnchorDir("FAFF-1", "unavailable");
  try {
    const { out, ret } = runGovCheck(["--anchor-dir", dir, "--issue", "FAFF-1"], { githubActions: undefined });
    assert.equal(ret, 1, "still a failing verdict");
    assert.equal(out.split("\n").filter((l) => ERROR_LINE.test(l)).length, 0, "zero ::error:: lines locally");

    // Byte-identical to what the text renderer alone produces for the same verdict — the
    // same-run, no-side-effect check (the committed golden below is the cross-commit oracle).
    // Recompute the verdict the CLI evaluated, via --json, then render it locally.
    const { out: jsonOut } = runGovCheck(["--anchor-dir", dir, "--issue", "FAFF-1", "--json"], { githubActions: undefined });
    const verdict = JSON.parse(jsonOut.trim());
    const { out: textOnly } = captureStdout(() => renderGovernanceCheckText(verdict));
    assert.equal(out, textOnly, "local cmdGovernanceCheck stdout == renderGovernanceCheckText output");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FAFF-913 smoke step 9: --json stays pure single-object JSON with zero ::error:: lines, even under GITHUB_ACTIONS=true", () => {
  const { root, dir } = buildAnchorDir("FAFF-1", "unavailable");
  try {
    const { out, ret } = runGovCheck(["--anchor-dir", dir, "--issue", "FAFF-1", "--json"], { githubActions: "true" });
    assert.equal(ret, 1, "failing verdict, exit 1");
    assert.equal(out.split("\n").filter((l) => ERROR_LINE.test(l)).length, 0, "no annotation lines interleaved into --json");
    const parsed = JSON.parse(out.trim()); // exactly one object; a stray ::error:: line would break this parse
    assert.equal(parsed.pass, false);
    assert.ok(Array.isArray(parsed.runs) && parsed.runs.length === 1, "single-object verdict with one run");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FAFF-913: the renderer gate is observed in both positions (architectural-minor fold)", () => {
  const { root, dir } = buildAnchorDir("FAFF-1", "unavailable");
  try {
    const set = runGovCheck(["--anchor-dir", dir, "--issue", "FAFF-1"], { githubActions: "true" });
    const unset = runGovCheck(["--anchor-dir", dir, "--issue", "FAFF-1"], { githubActions: undefined });
    assert.ok(set.out.split("\n").some((l) => ERROR_LINE.test(l)), "GITHUB_ACTIONS=true → annotations present");
    assert.equal(unset.out.split("\n").filter((l) => ERROR_LINE.test(l)).length, 0, "unset → no annotations");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- escapeWorkflowData unit (the escape order is load-bearing) -------------

test("FAFF-913 escapeWorkflowData: percent-first ordering leaves no double-escape, and :: is neutralised", () => {
  assert.equal(escapeWorkflowData("100%"), "100%25");
  assert.equal(escapeWorkflowData("a\r\nb"), "a%0D%0Ab");
  assert.equal(escapeWorkflowData("x::y"), "x%3A%3Ay");
  // The `::`-escape runs AFTER the %-escape, so its introduced %3A is NOT re-escaped to %253A.
  assert.equal(escapeWorkflowData("::"), "%3A%3A");
  assert.ok(!escapeWorkflowData("::").includes("%253A"), "no double-escape of the ::-introduced %3A");
  // A single colon in legitimate reason text stays readable.
  assert.equal(escapeWorkflowData("review-verdict: unavailable"), "review-verdict: unavailable");
});

// --- golden fixture (cross-commit regression oracle) -----------------------

test("FAFF-913 golden: renderGovernanceCheckText + renderGovernanceCheckSummaryMd stay byte-identical to the committed golden", () => {
  const verdict = JSON.parse(readFileSync(path.join(here, "fixtures", "faff-913-verdict.json"), "utf8"));
  const goldenText = readFileSync(path.join(here, "golden", "faff-913", "text.txt"), "utf8");
  const goldenSummary = readFileSync(path.join(here, "golden", "faff-913", "summary.md"), "utf8");

  const { out: text } = captureStdout(() => renderGovernanceCheckText(verdict));
  const summary = renderGovernanceCheckSummaryMd(verdict);

  assert.equal(text, goldenText, "renderGovernanceCheckText drifted from the committed golden (update the golden in the same PR if intended)");
  assert.equal(summary, goldenSummary, "renderGovernanceCheckSummaryMd drifted from the committed golden (update the golden in the same PR if intended)");
});
