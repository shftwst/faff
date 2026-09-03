// FAFF-989 — the decision-capture-action marker is emitted and JOINS at runtime, driven through
// the real in-kernel path. The existing test/decision-capture-wiring.test.mjs drives the LEGACY
// `record` verb (base + inline selected_action) and passes even with this bug present; these tests
// instead drive the exact wiring that was never exercised: the `decide` driver mints a correlation
// id, a REAL `faff next` kernel mints the base IN-KERNEL from that env-var, the `action` verb
// re-derives the SAME id and emits the marker, and `export` → `shadow-fidelity` GRADES the join in
// matrix.next — the path finding-7 named as having zero coverage. Spawns the real CLI (execFileSync),
// mirroring test/decision-capture-wiring.test.mjs's conventions.
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

// run the CLI; `env` extends process.env (undefined values delete a key), so a test can spawn the
// REAL kernel with FAFF_RUN_DIR / FAFF_DECISION_CORRELATION_ID set exactly as the driver would.
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
// state-authority map copied in (so shadow-fidelity resolves next/eligible in scope under --root).
function scratchRoot({ captureOff = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-989-"));
  writeFileSync(join(root, ".faffrc.yaml"), captureOff ? "capture:\n  decision_kernel: off\n" : "capture:\n  decision_kernel: on\n");
  const runId = "run-20260101-000000-graft-FAFF-1";
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  const g = run(root, ["events", "append", "--run", runId, "--ts", "2026-01-01T00:00:00Z"], { input: JSON.stringify({ phase: "run", type: "run-start" }) });
  assert.equal(g.code, 0, g.err);
  mkdirSync(join(root, dirname(MAP_REL)), { recursive: true });
  writeFileSync(join(root, MAP_REL), readFileSync(join(REPO, MAP_REL), "utf8"));
  return { root, runId, runDir };
}

// Drive one `next` decision the way the orchestrator prose now prescribes: mint the id via `decide`,
// spawn the REAL `faff next` kernel with that id in the env (base captured in-kernel), then emit the
// action marker via `action` with the id RE-DERIVED (no --correlates). `nextArgs` are the real
// `faff next` flags; `action` is the actual downstream action recorded on the marker.
function driveNext(root, runId, { action, nextArgs = ["--status", "todo", "--spec", "high"], wave }) {
  const decideArgs = ["decision-capture", "decide", "--run", runId, "--issue", "FAFF-1", "--kernel", "next", "--root", root];
  if (wave !== undefined) decideArgs.push("--wave", wave);
  const cid = run(root, decideArgs);
  assert.equal(cid.code, 0, cid.err);
  const kenv = { FAFF_RUN_DIR: join(root, ".faff", "runs", runId), FAFF_DECISION_CORRELATION_ID: cid.out, FAFF_DECISION_ISSUE: "FAFF-1" };
  const verdict = run(root, ["next", ...nextArgs], { env: kenv }); // `next` reads no --root; capture uses findRoot() from cwd
  assert.equal(verdict.code, 0, verdict.err);
  const actArgs = ["decision-capture", "action", "--run", runId, "--issue", "FAFF-1", "--kernel", "next", "--action", action, "--root", root];
  if (wave !== undefined) actArgs.push("--wave", wave);
  const marker = run(root, actArgs);
  assert.equal(marker.code, 0, marker.err);
  return { cid: cid.out, verdict: verdict.out, marker };
}

function study(root, runDir) {
  const out = join(runDir, "export");
  const e = run(root, ["decision-capture", "export", "--out", out, "--root", root]);
  assert.equal(e.code, 0, e.err);
  const r = run(root, ["shadow-fidelity", "run", "--corpus", join(out, "decision-corpus.jsonl"), "--root", root, "--json"]);
  assert.equal(r.code, 0, r.err || r.out);
  return JSON.parse(r.out);
}

test("Part A: a driven in-kernel `next` decision JOINS its action marker and grades as agreement", () => {
  const { root, runId, runDir } = scratchRoot();
  const { verdict } = driveNext(root, runId, { action: "graft" }); // next(todo,high) prescribes graft; the run built => graft
  assert.match(verdict, /"next":"graft"/);
  const result = study(root, runDir);
  assert.equal(result.matrix.next.denominator, 1);            // the base JOINED a marker and was graded
  assert.equal(result.matrix.next.agreement, 1);              // prescribed graft == actual graft
  assert.equal(result.action_uncaptured.length, 0);           // NOT orphaned — the bug's symptom is gone
});

test("Part A negative control: a divergent action (park vs the graft verdict) grades as a divergence, never agreement", () => {
  const { root, runId, runDir } = scratchRoot();
  driveNext(root, runId, { action: "park" });                 // the run parked despite a graft verdict
  const result = study(root, runDir);
  assert.equal(result.matrix.next.denominator, 1);
  assert.equal(result.matrix.next.agreement, 0);              // never manufactured agreement
  assert.equal(result.divergences.length, 1);
  assert.equal(result.divergences[0].kernel, "next");
  assert.equal(result.divergences[0].prescribed, "graft");
  assert.equal(result.divergences[0].actual, "park");
});

test("Part A: the join fails without the driver env — proving the test exercises the real defect path", () => {
  // Same scratch root, but DO NOT set FAFF_DECISION_CORRELATION_ID (the pre-fix runtime state):
  // the base is minted with an empty id, so even an emitted marker cannot join it.
  const { root, runId, runDir } = scratchRoot();
  const kenv = { FAFF_RUN_DIR: join(root, ".faff", "runs", runId), FAFF_DECISION_CORRELATION_ID: undefined, FAFF_DECISION_ISSUE: "FAFF-1" };
  const v = run(root, ["next", "--status", "todo", "--spec", "high"], { env: kenv });
  assert.equal(v.code, 0, v.err);
  // a marker emitted now cannot join an empty-id base — it lands action_uncaptured
  run(root, ["decision-capture", "action", "--run", runId, "--issue", "FAFF-1", "--kernel", "next", "--action", "graft", "--root", root]);
  const result = study(root, runDir);
  assert.equal(result.matrix.next.denominator, 0);            // NOT graded
  assert.equal(result.action_uncaptured.length, 1);           // the pre-fix symptom, reproduced on demand
});

test("Part B: an empty correlation_id writes a loud degraded-capture note, and the kernel's stdout+exit are unchanged", () => {
  const { root, runId } = scratchRoot();
  const kenv = { FAFF_RUN_DIR: join(root, ".faff", "runs", runId), FAFF_DECISION_CORRELATION_ID: undefined, FAFF_DECISION_ISSUE: "FAFF-1" };
  const withCapture = run(root, ["next", "--status", "todo", "--spec", "high"], { env: kenv });
  // same kernel call under capture-off — the authority-inert invariant: byte-identical stdout + exit
  const off = scratchRoot({ captureOff: true });
  const offKenv = { FAFF_RUN_DIR: join(off.root, ".faff", "runs", off.runId), FAFF_DECISION_CORRELATION_ID: undefined, FAFF_DECISION_ISSUE: "FAFF-1" };
  const withoutCapture = run(off.root, ["next", "--status", "todo", "--spec", "high"], { env: offKenv });
  assert.equal(withCapture.code, withoutCapture.code);        // exit unchanged
  assert.equal(withCapture.out, withoutCapture.out);          // stdout bytes unchanged
  // the degraded note landed, naming the empty-correlation-id condition
  const notePath = join(root, ".faff", "logs", "decision-capture.jsonl");
  assert.ok(existsSync(notePath), "expected a degraded-capture note file");
  const note = readFileSync(notePath, "utf8");
  assert.match(note, /empty correlation_id/);
});

test("Part C: `decide` mints a deterministic id and `action` re-derives the identical id (join by construction)", () => {
  const { root, runId } = scratchRoot();
  const bare = run(root, ["decision-capture", "decide", "--run", runId, "--issue", "FAFF-1", "--kernel", "next", "--wave", "3", "--root", root]);
  assert.equal(bare.code, 0, bare.err);
  assert.equal(bare.out, `${runId}/FAFF-1/next/3`);           // canonical <run>/<issue>/<kernel>/<wave>
  const exp = run(root, ["decision-capture", "decide", "--run", runId, "--issue", "FAFF-1", "--kernel", "next", "--export", "--root", root]);
  assert.match(exp.out, /export FAFF_DECISION_CORRELATION_ID='run-20260101-000000-graft-FAFF-1\/FAFF-1\/next\/1'/);
  assert.match(exp.out, /export FAFF_DECISION_ISSUE='FAFF-1'/);
  // a driven decision at wave 3 still joins — the action verb re-derives the same wave-3 id
  driveNext(root, runId, { action: "graft", wave: "3" });
  const result = study(root, join(root, ".faff", "runs", runId));
  assert.equal(result.matrix.next.denominator, 1);
  assert.equal(result.matrix.next.agreement, 1);
});

test("Part C hardening: `action` reuses the exported id, so a --wave mismatch cannot silently break the join", () => {
  const { root, runId, runDir } = scratchRoot();
  // decide (wave default 1) → base minted with env id .../next/1
  const cid = run(root, ["decision-capture", "decide", "--run", runId, "--issue", "FAFF-1", "--kernel", "next", "--root", root]);
  assert.equal(cid.out, `${runId}/FAFF-1/next/1`);
  const kenv = { FAFF_RUN_DIR: runDir, FAFF_DECISION_CORRELATION_ID: cid.out, FAFF_DECISION_ISSUE: "FAFF-1" };
  run(root, ["next", "--status", "todo", "--spec", "high"], { env: kenv });
  // action inherits the env id but is (mistakenly) given a MISMATCHED --wave 9 — the reuse path must
  // win over the fresh derivation (.../next/9), so the marker still carries .../next/1 and JOINS.
  const marker = run(root, ["decision-capture", "action", "--run", runId, "--issue", "FAFF-1", "--kernel", "next", "--wave", "9", "--action", "graft", "--root", root], { env: kenv });
  assert.equal(marker.code, 0, marker.err);
  const result = study(root, runDir);
  assert.equal(result.matrix.next.denominator, 1);            // joined despite the arg mismatch
  assert.equal(result.matrix.next.agreement, 1);
  assert.equal(result.action_uncaptured.length, 0);
});

test("the edited SKILL.md files pass the authoring gate", () => {
  const r = run(REPO, ["validate-adapters"]);
  assert.equal(r.code, 0, r.err || r.out.split("\n").filter((l) => /FAIL/.test(l)).join("\n"));
  assert.match(r.out, /RESULT: PASS/);
});
