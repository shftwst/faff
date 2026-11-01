// FAFF-1434: beep-boop runs `faff graft admit` twice per admitted candidate (the first call and the
// final call), and graft's own Step 2 runs it again, all for one issue in one run. Called with
// --run-dir and no --wave, each call takes the run's next consult ordinal, so every call mints its
// own correlation id and every decision grades. With an explicit --wave the counter is skipped, all
// the calls collide on one id and only one grades (the FAFF-1394 collision), which the control
// below demonstrates. Each step is a fresh process, as each tool call is a fresh shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const MAP_REL = join("docs", "rfc", "rfc-superdomestique-runtime", "v5", "STATE-AUTHORITY-MAP-v5.md");
const RUN_ID = "run-20260101-000000-beepboop-list-1434aa";
const ISSUE = "FAFF-7";
const SPEC = "## Scenarios\n\n```\nGiven a spec\nWhen it is graded\nThen it is admissible\n```\n\n## 8. DONE\n\n- [ ] the command MUST exit 0\n";
const FACTS = {
  issue: ISSUE, status: "todo", labels: ["faff-automate"], spec: { found: true, confidence: "high" },
  externally_blocked: false, claimed_at: null, tracker: { mode: "tracker", configured: true, pinned: false, reachable: true },
};

const roots = [];
test.after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const BIN = mkdtempSync(join(tmpdir(), "faff-1434-bin-"));
roots.push(BIN);
writeFileSync(join(BIN, "faff"), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
chmodSync(join(BIN, "faff"), 0o755);

function call(root, script, input) {
  const env = { ...process.env, PATH: `${BIN}:${process.env.PATH}` };
  for (const k of ["FAFF_DECISION_CORRELATION_ID", "FAFF_DECISION_ISSUE", "FAFF_RUN_DIR", "FAFF_SESSION_ID"]) delete env[k];
  const r = spawnSync("bash", ["-c", script], { cwd: root, encoding: "utf8", env, input });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function scratchRoot() {
  const root = mkdtempSync(join(tmpdir(), "faff-1434-ids-"));
  roots.push(root);
  spawnSync("git", ["-C", root, "init", "-q"]);
  writeFileSync(join(root, ".faffrc.yaml"), "capture:\n  decision_kernel: on\nbundle_store: local\n");
  writeFileSync(join(root, "spec.md"), SPEC);
  const runDir = join(root, ".faff", "runs", RUN_ID);
  mkdirSync(runDir, { recursive: true });
  const g = call(root, `faff events append --run ${RUN_ID} --ts 2026-01-01T00:00:00Z <<'EOF'\n{"phase":"run","type":"run-start"}\nEOF`);
  assert.equal(g.code, 0, g.err);
  mkdirSync(join(root, dirname(MAP_REL)), { recursive: true });
  writeFileSync(join(root, MAP_REL), readFileSync(join(REPO, MAP_REL), "utf8"));
  return { root, runDir };
}

// One beep-boop admission call, exactly as step 4 runs it (plus an optional wave for the control).
function admit(root, runDir, wave) {
  const w = wave ? ` --wave ${wave}` : "";
  const r = call(root, `faff graft admit --mode autonomous --facts - --spec-file spec.md --run-dir '${runDir}'${w} --json`, JSON.stringify(FACTS));
  assert.equal(r.code, 0, r.err || r.out);
  assert.equal(JSON.parse(r.out).disposition, "proceed", r.out);
}

// A counter-based consult of the same kernel and issue: the driver and the consult in one command,
// the marker in a later call (the FAFF-1394 shape).
function counterConsult(root, runDir) {
  const c1 = call(root, `export FAFF_RUN_DIR='${runDir}'; eval "$(faff decision-capture decide --run "$FAFF_RUN_DIR" --issue ${ISSUE} --kernel next --export)" && faff next --status todo --spec high`);
  assert.equal(c1.code, 0, c1.err);
  const c2 = call(root, `export FAFF_RUN_DIR='${runDir}'; faff decision-capture action --run "$FAFF_RUN_DIR" --issue ${ISSUE} --kernel next --action graft`);
  assert.equal(c2.code, 0, c2.err);
}

function baseIds(runDir, kernel) {
  return readFileSync(join(runDir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.type === "decision-capture" && e.data.kernel === kernel).map((e) => e.data.correlation_id);
}

function study(root, runDir) {
  const out = join(runDir, "export");
  const e = call(root, `faff decision-capture export --out '${out}' --root '${root}'`);
  assert.equal(e.code, 0, e.err);
  const r = call(root, `faff shadow-fidelity run --corpus '${join(out, "decision-corpus.jsonl")}' --root '${root}' --json`);
  assert.equal(r.code, 0, r.err || r.out);
  return JSON.parse(r.out);
}

test("repeated admission calls with --run-dir and no --wave, beside a counter-based consult, mint distinct ids and all grade", () => {
  const { root, runDir } = scratchRoot();
  admit(root, runDir);          // beep-boop's first call
  counterConsult(root, runDir); // a counter-based consult of the same issue and kernel
  admit(root, runDir);          // beep-boop's final call
  admit(root, runDir);          // graft Step 2's own call
  const next = baseIds(runDir, "next");
  assert.deepEqual(next, [1, 2, 3, 4].map((n) => `${RUN_ID}/${ISSUE}/next/${n}`));
  const eligible = baseIds(runDir, "eligible");
  assert.equal(new Set(eligible).size, 3, `eligible ids: ${eligible}`);
  const result = study(root, runDir);
  assert.equal(result.matrix.next.denominator, 4, JSON.stringify(result.matrix.next));
  assert.equal(result.matrix.eligible.denominator, 3, JSON.stringify(result.matrix.eligible));
});

test("control: an explicit --wave collides every admission call on one id, so only one grades", () => {
  const { root, runDir } = scratchRoot();
  for (let i = 0; i < 3; i += 1) admit(root, runDir, "1");
  const next = baseIds(runDir, "next");
  assert.equal(next.length, 3);
  assert.equal(new Set(next).size, 1, `next ids: ${next}`);
  assert.ok(study(root, runDir).matrix.next.denominator < 3);
});
