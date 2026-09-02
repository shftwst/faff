// FAFF-954 — the live decision-capture wiring at the orchestrator's core-loop gates.
// The pilot sites are SKILL.md prose (beep-boop §4, graft Step 2), so these tests exercise the
// MECHANISM those sites drive: a `faff decision-capture record` call shaped exactly as the sites
// prescribe (all seven `nextStep` keys, the REAL action, flag-guarded) flows through
// `decision-capture export` into `faff shadow-fidelity` and lands in the study matrix — and a
// deliberately-divergent record surfaces as a divergence, not manufactured agreement. Spawns the
// real CLI (execFileSync), mirroring test/decision-capture.test.mjs's conventions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const MAP_REL = join("docs", "rfc", "rfc-superdomestique-runtime", "v5", "STATE-AUTHORITY-MAP-v5.md");

function run(cwd, args, input) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

// A scratch root with capture on (unless captureOff), a run dir with a genesis event chain, and
// the state-authority map copied in (so shadow-fidelity resolves its scope under --root).
function scratchRoot({ captureOff = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-dcw-"));
  writeFileSync(join(root, ".faffrc.yaml"), captureOff ? "capture:\n  decision_kernel: off\n" : "capture:\n  decision_kernel: on\n");
  const runId = "run-20260101-000000-graft-FAFF-1";
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  // genesis event so the recorder has a chain head to anchor causation to
  const g = run(root, ["events", "append", "--run", runId, "--ts", "2026-01-01T00:00:00Z"], JSON.stringify({ phase: "run", type: "run-start" }));
  assert.equal(g.code, 0, g.err);
  // the map, so shadow-fidelity's deriveScope puts next/eligible in scope under this root
  mkdirSync(join(root, dirname(MAP_REL)), { recursive: true });
  writeFileSync(join(root, MAP_REL), readFileSync(join(REPO, MAP_REL), "utf8"));
  return { root, runId, runDir };
}

// The exact record shape the beep-boop / graft sites produce for `next` — all seven nextStep keys.
const NEXT_INPUTS = { status: "todo", spec: "high", eligible: true, parked: false, blocked: false, ifEligible: false, awaitingSpecReview: false };

function record(root, runId, issue, kernel, ni, action) {
  return run(root, ["decision-capture", "record", "--run", runId, "--issue", issue, "--kernel", kernel, "--root", root],
    JSON.stringify({ normalised_inputs: ni, selected_action: action }));
}

function study(root, runDir) {
  const out = join(runDir, "export");
  const e = run(root, ["decision-capture", "export", "--out", out, "--root", root]);
  assert.equal(e.code, 0, e.err);
  const r = run(root, ["shadow-fidelity", "run", "--corpus", join(out, "decision-corpus.jsonl"), "--root", root, "--json"]);
  assert.equal(r.code, 0, r.err || r.out);
  return JSON.parse(r.out);
}

test("AC1/AC2/AC5: a next record with all seven keys lands in matrix.next, end-to-end", () => {
  const { root, runId, runDir } = scratchRoot();
  const rec = record(root, runId, "FAFF-1", "next", NEXT_INPUTS, "graft");
  assert.equal(rec.code, 0, rec.err);
  assert.match(rec.out, /"coverage":"replayable"/);
  const result = study(root, runDir);
  assert.equal(result.null_result, false);                       // AC5: non-null
  assert.equal(result.matrix.next.denominator, 1);               // AC2/AC5: in matrix.next, denominator > 0
  assert.equal(result.matrix.next.agreement, 1);                 // AC1: real action == verdict → agreement
  assert.equal(result.exclusions.input_uncaptured.length, 0);    // AC2: NOT input-uncaptured
});

test("AC2: a next record OMITTING the now-required awaitingSpecReview classifies missing-input (FAFF-956 6→7 reconciliation)", () => {
  const { root, runId, runDir } = scratchRoot();
  const { awaitingSpecReview, ...sixKeys } = NEXT_INPUTS;         // drop the now-REQUIRED seventh key
  const rec = record(root, runId, "FAFF-1", "next", sixKeys, "graft");
  assert.equal(rec.code, 0, rec.err);
  assert.match(rec.out, /"coverage":"non-replayable"/);          // required key absent ⇒ non-replayable
  const result = study(root, runDir);
  assert.equal(result.matrix.next.denominator, 0);               // excluded from the matrix
  assert.equal(result.coverage.missing_input, 1);                // classifies missing-input, not input-uncaptured
  assert.equal(result.exclusions.input_uncaptured.length, 0);
});

test("AC3: a divergent eligible record (ineligible prescribed, eligible actual) is a wrong divergence, not agreement", () => {
  const { root, runId, runDir } = scratchRoot();
  // inputs that resolve INELIGIBLE (unlabelled + opt-in), but the site recorded it as built anyway
  const rec = record(root, runId, "FAFF-1", "eligible",
    { labels: [], automationDefault: "opt-in", trackerPresent: true }, "eligible");
  assert.equal(rec.code, 0, rec.err);
  const result = study(root, runDir);
  assert.equal(result.matrix.eligible.agreement, 0);             // NOT counted as agreement
  assert.equal(result.matrix.eligible.wrong, 1);                 // graded wrong
  assert.equal(result.divergences.length, 1);
  assert.equal(result.divergences[0].kernel, "eligible");
  assert.equal(result.divergences[0].prescribed, "ineligible");
  assert.equal(result.divergences[0].actual, "eligible");
  assert.equal(result.divergences[0].consequence, "wrong");
});

test("AC4: with the capture flag off, a pilot-shaped record call writes no decision-capture event", () => {
  const { root, runId } = scratchRoot({ captureOff: true });
  const rec = record(root, runId, "FAFF-1", "next", NEXT_INPUTS, "graft");
  assert.equal(rec.code, 0, rec.err);                            // best-effort: still exits 0
  // no event recorded → list is empty
  const list = run(root, ["decision-capture", "list", "--run", runId, "--root", root]);
  assert.equal(list.code, 0, list.err);
  assert.equal(list.out, "");
});

test("the edited SKILL.md files pass the authoring gate (AC6)", () => {
  const r = run(REPO, ["validate-adapters"]);
  assert.equal(r.code, 0, r.err || r.out.split("\n").filter((l) => /FAIL/.test(l)).join("\n"));
  assert.match(r.out, /RESULT: PASS/);
});
