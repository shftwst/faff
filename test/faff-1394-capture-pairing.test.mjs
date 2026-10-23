// FAFF-1394: decision captures pair when driven the way an orchestrator actually drives them.
// Each step here is its own `bash -c` process with a fresh environment, as each tool call is a fresh
// shell. The run is carried as its run dir path (the form orchestrators hold, `RD=$(...)`), and the
// driver and the consult run in one command, `eval "$(faff decision-capture decide … --export)" &&
// faff <k> …`, as the skill prose now prescribes. The action marker is a later, separate command.
// Before this fix `decide` minted a path-shaped id from a path `--run`, and `action` looked for
// `.faff/runs/<path>`, wrote nothing and exited 0, so no pair joined.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const MAP_REL = join("docs", "rfc", "rfc-superdomestique-runtime", "v5", "STATE-AUTHORITY-MAP-v5.md");
const RUN_ID = "run-20260101-000000-beepboop-list-1394aa";

// A `faff` on PATH that runs this checkout's CLI, so the prose's commands run verbatim.
function shimDir() {
  const bin = mkdtempSync(join(tmpdir(), "faff-1394-bin-"));
  writeFileSync(join(bin, "faff"), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  chmodSync(join(bin, "faff"), 0o755);
  return bin;
}
const BIN = shimDir();

// One tool call: a fresh bash with no decision-capture env inherited from anything before it.
function call(root, script) {
  const env = { ...process.env, PATH: `${BIN}:${process.env.PATH}` };
  delete env.FAFF_DECISION_CORRELATION_ID;
  delete env.FAFF_DECISION_ISSUE;
  delete env.FAFF_RUN_DIR;
  const r = spawnSync("bash", ["-c", script], { cwd: root, encoding: "utf8", env });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function scratchRoot() {
  const root = mkdtempSync(join(tmpdir(), "faff-1394-"));
  writeFileSync(join(root, ".faffrc.yaml"), "capture:\n  decision_kernel: on\n");
  const runDir = join(root, ".faff", "runs", RUN_ID);
  mkdirSync(runDir, { recursive: true });
  const g = call(root, `faff events append --run ${RUN_ID} --ts 2026-01-01T00:00:00Z <<'EOF'\n{"phase":"run","type":"run-start"}\nEOF`);
  assert.equal(g.code, 0, g.err);
  mkdirSync(join(root, dirname(MAP_REL)), { recursive: true });
  writeFileSync(join(root, MAP_REL), readFileSync(join(REPO, MAP_REL), "utf8"));
  return { root, runDir };
}

function study(root, runDir) {
  const out = join(runDir, "export");
  const e = call(root, `faff decision-capture export --out '${out}' --root '${root}'`);
  assert.equal(e.code, 0, e.err);
  const r = call(root, `faff shadow-fidelity run --corpus '${join(out, "decision-corpus.jsonl")}' --root '${root}' --json`);
  assert.equal(r.code, 0, r.err || r.out);
  return JSON.parse(r.out);
}

function events(runDir) {
  return readFileSync(join(runDir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// Every wired kernel with a replayable consult, the issue it is captured under, and the action the
// orchestrator took (each kernel's own action vocabulary). Tier 2 kernels take no action marker.
const KERNELS = [
  { kernel: "next", issue: "FAFF-21", action: "graft", consult: "faff next --status todo --spec high" },
  { kernel: "eligible", issue: "FAFF-22", action: "eligible", consult: "faff eligible --label faff-automate" },
  { kernel: "claim-verdict", issue: "FAFF-11", action: "stale",
    consult: "faff claim-verdict --claimed-at 2026-01-01T00:00:00Z --now 2026-01-05T00:00:00Z --ttl-hours 24" },
  { kernel: "park-verdict", issue: "FAFF-12", action: "strip-ok",
    consult: "faff park-verdict --status in-progress --draft-pr absent --park-comment build --human-takeover false" },
  { kernel: "run-start", issue: "__run__", action: "refuse",
    consult: `faff run-start --signals '${JSON.stringify({ target_resolved: false, outward: false, prd_present: false, prd_ambiguous: false, prd_admissible: false, coverage_measurable: false, coverage_covered: false })}'` },
  { kernel: "run-outward", issue: "__run__", action: "outward-adopter",
    consult: `faff run-outward --target '${JSON.stringify({ container: null, repo: "acme/widgets" })}' --self '${JSON.stringify({ container: null, repo: "acme/faff", is_self: false })}' --json` },
  { kernel: "run-done", issue: "__run__", action: "run-complete", wave: "2",
    consult: "faff run-done --queue-empty --all-parked --ledger-clean --no-prd" },
];

// Drive one decision as the prose does: call 1 is the driver and the consult in one command; call 2,
// a fresh shell, is the action marker. `runArg` is how the run is named on both calls.
function drive(root, runDir, { kernel, issue, action, consult, wave }, runArg) {
  const w = wave ? ` --wave ${wave}` : "";
  const c1 = call(root, `export FAFF_RUN_DIR='${runDir}'; eval "$(faff decision-capture decide --run ${runArg} --issue ${issue} --kernel ${kernel}${w} --export)" && ${consult}`);
  assert.equal(c1.code, 0, `${kernel}: ${c1.err || c1.out}`);
  const c2 = call(root, `export FAFF_RUN_DIR='${runDir}'; faff decision-capture action --run ${runArg} --issue ${issue} --kernel ${kernel}${w} --action ${action}`);
  assert.equal(c2.code, 0, c2.err);
}

for (const form of [
  { name: "the run dir path", arg: (runDir) => `"$FAFF_RUN_DIR"` },
  { name: "the run id", arg: () => `"$(basename "$FAFF_RUN_DIR")"` },
]) {
  for (const k of KERNELS) {
    test(`${k.kernel}, run named by ${form.name}: driver and consult in one command, marker in a later call, the pair joins and grades`, () => {
      const { root, runDir } = scratchRoot();
      drive(root, runDir, k, form.arg(runDir));
      const base = events(runDir).find((e) => e.type === "decision-capture");
      assert.ok(base, `${k.kernel}: no base record`);
      assert.equal(base.data.correlation_id, `${RUN_ID}/${k.issue}/${k.kernel}/${k.wave || "1"}`); // canonical, never path-shaped
      const result = study(root, runDir);
      assert.equal(result.matrix[k.kernel].denominator, 1, `${k.kernel} should grade one decision`);
      assert.ok(!result.action_uncaptured.some((e) => e.kernel === k.kernel), `${k.kernel} must not be action_uncaptured`);
    });
  }
}

test("action with no --run writes the marker to $FAFF_RUN_DIR's run, and the pair joins", () => {
  const { root, runDir } = scratchRoot();
  const k = KERNELS.find((x) => x.kernel === "claim-verdict");
  const c1 = call(root, `export FAFF_RUN_DIR='${runDir}'; eval "$(faff decision-capture decide --issue ${k.issue} --kernel ${k.kernel} --export)" && ${k.consult}`);
  assert.equal(c1.code, 0, c1.err);
  const c2 = call(root, `export FAFF_RUN_DIR='${runDir}'; faff decision-capture action --issue ${k.issue} --kernel ${k.kernel} --action ${k.action}`);
  assert.equal(c2.code, 0, c2.err);
  assert.equal(study(root, runDir).matrix["claim-verdict"].denominator, 1);
});

test("Tier 2: queue-state and project-next, run named by path, mint the canonical id in one command", () => {
  const { root, runDir } = scratchRoot();
  const c1 = call(root, `export FAFF_RUN_DIR='${runDir}'; eval "$(faff decision-capture decide --run "$FAFF_RUN_DIR" --issue __run__ --kernel queue-state --export)" && faff queue-state derive --run-dir "$FAFF_RUN_DIR"`);
  assert.equal(c1.code, 0, c1.err);
  const c2 = call(root, `export FAFF_RUN_DIR='${runDir}'; eval "$(faff decision-capture decide --run "$FAFF_RUN_DIR" --issue __run__ --kernel project-next --export)" && faff project-next --current started --kind project --total 3 --active 1 --done 1`);
  assert.equal(c2.code, 0, c2.err);
  const ids = events(runDir).filter((e) => e.type === "decision-capture").map((e) => `${e.data.kernel}=${e.data.correlation_id}`);
  assert.deepEqual(ids, [`queue-state=${RUN_ID}/__run__/queue-state/1`, `project-next=${RUN_ID}/__run__/project-next/1`]);
});

test("control: the driver and the consult in separate calls lose the id, which is why the prose requires one command", () => {
  const { root, runDir } = scratchRoot();
  const k = KERNELS.find((x) => x.kernel === "run-done");
  call(root, `export FAFF_RUN_DIR='${runDir}'; eval "$(faff decision-capture decide --run "$FAFF_RUN_DIR" --issue __run__ --kernel run-done --wave 2 --export)"`);
  call(root, `export FAFF_RUN_DIR='${runDir}'; ${k.consult}`);
  call(root, `export FAFF_RUN_DIR='${runDir}'; faff decision-capture action --run "$FAFF_RUN_DIR" --issue __run__ --kernel run-done --wave 2 --action run-complete`);
  const base = events(runDir).find((e) => e.type === "decision-capture");
  assert.equal(base.data.correlation_id, "");                     // the export never reached the consult
  const result = study(root, runDir);
  assert.equal(result.matrix["run-done"].denominator, 0);
  const note = join(root, ".faff", "logs", "decision-capture.jsonl");
  assert.ok(existsSync(note) && /empty correlation_id/.test(readFileSync(note, "utf8")));
});

test("the shipped skill prose runs every wired kernel's driver and consult in one command", () => {
  const r = spawnSync(process.execPath, [CLI, "validate-adapters"], { cwd: REPO, encoding: "utf8" });
  assert.match(r.stdout, /pass\s+capture-same-command/, r.stdout.split("\n").filter((l) => /capture-same-command|✗/.test(l)).join("\n"));
  assert.match(r.stdout, /pass\s+capture-wiring/);
});
