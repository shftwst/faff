// FAFF-1009 — completes FAFF-989's runtime join for the seven un-wired decision-capture kernels.
// These tests drive the REAL kernels through the exact wiring the SKILL prose now prescribes, in the
// shape of test/faff-989-decision-capture-driver.test.mjs (which covers `next`): the `decide` driver
// mints a correlation id, the real kernel mints its base IN-KERNEL from that env var, and — for the
// five Tier-1 kernels — the `action` verb re-derives the same id and emits the marker, so
// shadow-fidelity JOINS and grades the pair. The two Tier-2 rollups (queue-state, project-next) mint
// an id and emit no marker (mint-and-silence): a non-empty correlation_id that lands action_uncaptured
// by design, with the empty-id degraded note silenced. Spawns the real CLI, mirroring faff-989's
// conventions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const MAP_REL = join("docs", "rfc", "rfc-superdomestique-runtime", "v5", "STATE-AUTHORITY-MAP-v5.md");

function run(cwd, args, { input, env } = {}) {
  const childEnv = { ...process.env };
  for (const [k, v] of Object.entries(env || {})) { if (v === undefined) delete childEnv[k]; else childEnv[k] = v; }
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "", env: childEnv });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

// A scratch root with capture on (unless captureOff), a run dir with a genesis event chain, and the
// state-authority map copied in so shadow-fidelity resolves all nine kernels in scope under --root.
function scratchRoot({ captureOff = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-1009-"));
  writeFileSync(join(root, ".faffrc.yaml"), captureOff ? "capture:\n  decision_kernel: off\n" : "capture:\n  decision_kernel: on\n");
  const runId = "run-20260101-000000-beepboop-FAFF-1";
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const g = run(root, ["events", "append", "--run", runId, "--ts", "2026-01-01T00:00:00Z"], { input: JSON.stringify({ phase: "run", type: "run-start" }) });
  assert.equal(g.code, 0, g.err);
  mkdirSync(join(root, dirname(MAP_REL)), { recursive: true });
  writeFileSync(join(root, MAP_REL), readFileSync(join(REPO, MAP_REL), "utf8"));
  return { root, runId, runDir };
}

function study(root, runDir) {
  const out = join(runDir, "export");
  const e = run(root, ["decision-capture", "export", "--out", out, "--root", root]);
  assert.equal(e.code, 0, e.err);
  const r = run(root, ["shadow-fidelity", "run", "--corpus", join(out, "decision-corpus.jsonl"), "--root", root, "--json"]);
  assert.equal(r.code, 0, r.err || r.out);
  return JSON.parse(r.out);
}

// Mint the id via `decide`, spawn the REAL kernel with that id in the env (base captured in-kernel),
// then — Tier 1 — emit the action marker with the id RE-DERIVED (no --correlates), exactly as the
// orchestrator prose prescribes. `--wave` (when given) is passed to BOTH decide and action.
function driveTier1(root, runId, { kernel, kernelArgs, issue, action, wave }) {
  const runDir = join(root, ".faff", "runs", runId);
  const decideArgs = ["decision-capture", "decide", "--run", runId, "--issue", issue, "--kernel", kernel, "--root", root];
  if (wave !== undefined) decideArgs.push("--wave", wave);
  const cid = run(root, decideArgs);
  assert.equal(cid.code, 0, cid.err);
  const kenv = { FAFF_RUN_DIR: runDir, FAFF_DECISION_CORRELATION_ID: cid.out, FAFF_DECISION_ISSUE: issue };
  const verdict = run(root, kernelArgs, { env: kenv }); // kernelArgs already leads with the kernel name
  assert.equal(verdict.code, 0, `${kernel} exit: ${verdict.err || verdict.out}`);
  const actArgs = ["decision-capture", "action", "--run", runId, "--issue", issue, "--kernel", kernel, "--action", action, "--root", root];
  if (wave !== undefined) actArgs.push("--wave", wave);
  const marker = run(root, actArgs);
  assert.equal(marker.code, 0, marker.err);
  return { cid: cid.out };
}

// The five Tier-1 kernels and a valid, replayable consult for each. The action token is drawn from
// each kernel's own action vocabulary (run-start/run-done use the verdict vocabulary).
const TIER1 = [
  { kernel: "claim-verdict", issue: "FAFF-11", action: "stale",
    kernelArgs: ["claim-verdict", "--claimed-at", "2026-01-01T00:00:00Z", "--now", "2026-01-05T00:00:00Z", "--ttl-hours", "24"] },
  { kernel: "park-verdict", issue: "FAFF-12", action: "strip-ok",
    kernelArgs: ["park-verdict", "--status", "in-progress", "--draft-pr", "absent", "--park-comment", "build", "--human-takeover", "false"] },
  { kernel: "run-start", issue: "__run__", action: "refuse",
    kernelArgs: ["run-start", "--signals", JSON.stringify({ target_resolved: false, outward: false, prd_present: false, prd_ambiguous: false, prd_admissible: false, coverage_measurable: false, coverage_covered: false })] },
  { kernel: "run-outward", issue: "__run__", action: "outward-adopter",
    kernelArgs: ["run-outward", "--target", JSON.stringify({ container: null, repo: "acme/widgets" }), "--self", JSON.stringify({ container: null, repo: "acme/faff", is_self: false }), "--json"] },
  { kernel: "run-done", issue: "__run__", action: "run-complete", wave: "2",
    kernelArgs: ["run-done", "--queue-empty", "--all-parked", "--ledger-clean", "--no-prd"] },
];

for (const spec of TIER1) {
  test(`Tier 1: a driven in-kernel \`${spec.kernel}\` decision JOINS its action marker and grades`, () => {
    const { root, runId, runDir } = scratchRoot();
    driveTier1(root, runId, spec);
    const result = study(root, runDir);
    assert.ok(result.matrix[spec.kernel].denominator >= 1, `${spec.kernel}.denominator should be >= 1`);
    assert.ok(!result.action_uncaptured.some((e) => e.kernel === spec.kernel), `${spec.kernel} must NOT be action_uncaptured`);
  });
}

test("run-done: the action's --wave must match the decide's --wave, or the pair never joins", () => {
  const { root, runId, runDir } = scratchRoot();
  // decide at wave 2 → base minted with the wave-2 id; action given a MISMATCHED wave 9 that also
  // sets no reuse env, so it re-derives the wave-9 id and cannot join the wave-2 base.
  const cid = run(root, ["decision-capture", "decide", "--run", runId, "--issue", "__run__", "--kernel", "run-done", "--wave", "2", "--root", root]);
  const kenv = { FAFF_RUN_DIR: runDir, FAFF_DECISION_CORRELATION_ID: cid.out, FAFF_DECISION_ISSUE: "__run__" };
  run(root, ["run-done", "--queue-empty", "--all-parked", "--ledger-clean", "--no-prd"], { env: kenv });
  run(root, ["decision-capture", "action", "--run", runId, "--issue", "__run__", "--kernel", "run-done", "--wave", "9", "--action", "run-complete", "--root", root]);
  const result = study(root, runDir);
  assert.equal(result.matrix["run-done"].denominator, 0);
  assert.ok(result.action_uncaptured.some((e) => e.kernel === "run-done"));
});

test("Tier 2: queue-state and project-next mint a non-empty id, land action_uncaptured, log no empty-id note", () => {
  const { root, runId, runDir } = scratchRoot();
  const tier2 = [
    { kernel: "queue-state", kernelArgs: ["queue-state", "derive", "--run-dir", runDir] },
    { kernel: "project-next", kernelArgs: ["project-next", "--current", "started", "--kind", "project", "--total", "3", "--active", "1", "--done", "1"] },
  ];
  const mintedIds = {};
  for (const t of tier2) {
    // Tier 2: `decide --export` only, issue __run__, NO action marker.
    const cid = run(root, ["decision-capture", "decide", "--run", runId, "--issue", "__run__", "--kernel", t.kernel, "--root", root]);
    assert.equal(cid.code, 0, cid.err);
    mintedIds[t.kernel] = cid.out;
    const kenv = { FAFF_RUN_DIR: runDir, FAFF_DECISION_CORRELATION_ID: cid.out, FAFF_DECISION_ISSUE: "__run__" };
    const v = run(root, t.kernelArgs, { env: kenv });
    assert.equal(v.code, 0, `${t.kernel} exit: ${v.err || v.out}`);
  }
  const result = study(root, runDir);
  for (const t of tier2) {
    const entry = result.action_uncaptured.find((e) => e.kernel === t.kernel);
    assert.ok(entry, `${t.kernel} should land action_uncaptured (mint-and-silence)`);
    assert.equal(entry.correlation_id, mintedIds[t.kernel]); // a real, non-empty minted id
    assert.notEqual(entry.correlation_id, "");
  }
  // the empty-id degraded note never fired for either kernel
  const notePath = join(root, ".faff", "logs", "decision-capture.jsonl");
  if (existsSync(notePath)) {
    assert.doesNotMatch(readFileSync(notePath, "utf8"), /empty correlation_id/);
  }
});

test("negative control 1: driver env unset (FAFF_RUN_DIR set) → empty id, no join, empty-id note fires", () => {
  const { root, runId, runDir } = scratchRoot();
  const kenv = { FAFF_RUN_DIR: runDir, FAFF_DECISION_CORRELATION_ID: undefined, FAFF_DECISION_ISSUE: "FAFF-11" };
  const v = run(root, ["claim-verdict", "--claimed-at", "2026-01-01T00:00:00Z", "--now", "2026-01-05T00:00:00Z", "--ttl-hours", "24"], { env: kenv });
  assert.equal(v.code, 0, v.err);
  run(root, ["decision-capture", "action", "--run", runId, "--issue", "FAFF-11", "--kernel", "claim-verdict", "--action", "stale", "--root", root]);
  const result = study(root, runDir);
  assert.equal(result.matrix["claim-verdict"].denominator, 0); // not graded
  assert.ok(result.action_uncaptured.some((e) => e.kernel === "claim-verdict"));
  const notePath = join(root, ".faff", "logs", "decision-capture.jsonl");
  assert.ok(existsSync(notePath), "expected a degraded-capture note file");
  assert.match(readFileSync(notePath, "utf8"), /empty correlation_id/);
});

test("negative control 2: FAFF_RUN_DIR unset → no base minted, consult output byte-identical", () => {
  const { root } = scratchRoot();
  const off = scratchRoot({ captureOff: true });
  const args = ["claim-verdict", "--claimed-at", "2026-01-01T00:00:00Z", "--now", "2026-01-05T00:00:00Z", "--ttl-hours", "24"];
  const kenv = { FAFF_RUN_DIR: undefined, FAFF_DECISION_CORRELATION_ID: undefined, FAFF_DECISION_ISSUE: undefined };
  const withCaptureOnNoRunDir = run(root, args, { env: kenv });
  const withCaptureOff = run(off.root, args, { env: kenv });
  assert.equal(withCaptureOnNoRunDir.code, withCaptureOff.code); // exit unchanged
  assert.equal(withCaptureOnNoRunDir.out, withCaptureOff.out);   // stdout bytes unchanged
  // no base minted: captureDecision no-ops before any run-dir write (it emits only a standalone-call
  // degraded note, never an "empty correlation_id" note and never a base event in the run journal).
  const eventsPath = join(root, ".faff", "runs", "run-20260101-000000-beepboop-FAFF-1", "events.jsonl");
  const events = readFileSync(eventsPath, "utf8");
  assert.doesNotMatch(events, /decision-capture/); // no base record appended
  const notePath = join(root, ".faff", "logs", "decision-capture.jsonl");
  if (existsSync(notePath)) assert.doesNotMatch(readFileSync(notePath, "utf8"), /empty correlation_id/);
});
