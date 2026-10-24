// FAFF-1394: a repeated consult of the same issue and kernel in one run mints a distinct id.
// A beep-boop routing consult and the dispatched graft's own consult of the same issue both minted
// `.../<kernel>/1`, so shadow-fidelity let only the first pair grade. `decide` without `--wave` now
// takes the next ordinal from `<run-dir>/decision-capture/counters.json`, and `action` without an
// exported id reads the current one. Each step is its own `bash -c` with a fresh environment, as each
// tool call is a fresh shell.
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
const RUN_ID = "run-20260101-000000-beepboop-list-1394bb";

function shimDir() {
  const bin = mkdtempSync(join(tmpdir(), "faff-1394b-bin-"));
  writeFileSync(join(bin, "faff"), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  chmodSync(join(bin, "faff"), 0o755);
  return bin;
}
const BIN = shimDir();

function call(root, script) {
  const env = { ...process.env, PATH: `${BIN}:${process.env.PATH}` };
  delete env.FAFF_DECISION_CORRELATION_ID;
  delete env.FAFF_DECISION_ISSUE;
  delete env.FAFF_RUN_DIR;
  const r = spawnSync("bash", ["-c", script], { cwd: root, encoding: "utf8", env });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function scratchRoot({ capture = "on" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-1394b-"));
  writeFileSync(join(root, ".faffrc.yaml"), `capture:\n  decision_kernel: ${capture}\n`);
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

const events = (runDir) => readFileSync(join(runDir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const counters = (runDir) => JSON.parse(readFileSync(join(runDir, "decision-capture", "counters.json"), "utf8"));
const ELIGIBLE = { kernel: "eligible", issue: "FAFF-22", consult: "faff eligible --label faff-automate" };

// The prose's sequence: driver and consult in one command, then the marker in a later call.
function consultThenAct(root, runDir, { kernel, issue, consult }, action) {
  const c1 = call(root, `export FAFF_RUN_DIR='${runDir}'; eval "$(faff decision-capture decide --run "$FAFF_RUN_DIR" --issue ${issue} --kernel ${kernel} --export)" && ${consult}`);
  assert.equal(c1.code, 0, c1.err || c1.out);
  const c2 = call(root, `export FAFF_RUN_DIR='${runDir}'; faff decision-capture action --run "$FAFF_RUN_DIR" --issue ${issue} --kernel ${kernel} --action ${action}`);
  assert.equal(c2.code, 0, c2.err);
}

test("the same issue and kernel consulted twice in one run mint /1 and /2, and both pairs grade", () => {
  const { root, runDir } = scratchRoot();
  consultThenAct(root, runDir, ELIGIBLE, "eligible");   // e.g. beep-boop's routing consult
  consultThenAct(root, runDir, ELIGIBLE, "eligible");   // e.g. the dispatched graft's own consult
  const ev = events(runDir);
  const bases = ev.filter((e) => e.type === "decision-capture").map((e) => e.data.correlation_id);
  const marks = ev.filter((e) => e.type === "decision-capture-action").map((e) => e.data.correlation_id);
  const ids = [`${RUN_ID}/FAFF-22/eligible/1`, `${RUN_ID}/FAFF-22/eligible/2`];
  assert.deepEqual(bases, ids);
  assert.deepEqual(marks, ids);
  assert.equal(study(root, runDir).matrix.eligible.denominator, 2);
});

test("an explicit --wave bypasses the counter: the id is as given and no counter file is written", () => {
  const { root, runDir } = scratchRoot();
  for (let i = 0; i < 2; i++) {
    const r = call(root, `faff decision-capture decide --run ${RUN_ID} --issue __run__ --kernel run-done --wave 3`);
    assert.equal(r.out, `${RUN_ID}/__run__/run-done/3`);
  }
  assert.equal(existsSync(join(runDir, "decision-capture", "counters.json")), false);
});

test("concurrent decides for the same key get distinct ordinals with no lost increment", () => {
  const { root, runDir } = scratchRoot();
  const N = 8;
  const script = `for i in $(seq 1 ${N}); do (faff decision-capture decide --run ${RUN_ID} --issue FAFF-30 --kernel next > out.$i) & done; wait; cat out.*`;
  const r = call(root, script);
  assert.equal(r.code, 0, r.err);
  const ids = r.out.split("\n").filter(Boolean);
  assert.equal(ids.length, N);
  assert.deepEqual(new Set(ids), new Set(Array.from({ length: N }, (_, i) => `${RUN_ID}/FAFF-30/next/${i + 1}`)));
  assert.equal(counters(runDir)["FAFF-30"].next, N);
});

test("action with no exported id reads the current ordinal, so it joins the latest base", () => {
  const { root, runDir } = scratchRoot();
  call(root, `faff decision-capture decide --run ${RUN_ID} --issue FAFF-31 --kernel next`);
  call(root, `faff decision-capture decide --run ${RUN_ID} --issue FAFF-31 --kernel next`);
  const r = call(root, `faff decision-capture action --run ${RUN_ID} --issue FAFF-31 --kernel next --action graft`);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).correlation_id, `${RUN_ID}/FAFF-31/next/2`);
});

test("counters are kept per issue and per kernel", () => {
  const { root, runDir } = scratchRoot();
  for (const [issue, kernel] of [["FAFF-40", "next"], ["FAFF-40", "eligible"], ["FAFF-41", "next"], ["FAFF-40", "next"]]) {
    call(root, `faff decision-capture decide --run ${RUN_ID} --issue ${issue} --kernel ${kernel}`);
  }
  assert.deepEqual(counters(runDir), { "FAFF-40": { next: 2, eligible: 1 }, "FAFF-41": { next: 1 } });
});

test("capture off: decide mints wave 1 and writes no counter", () => {
  const { root, runDir } = scratchRoot({ capture: "off" });
  for (let i = 0; i < 2; i++) {
    assert.equal(call(root, `faff decision-capture decide --run ${RUN_ID} --issue FAFF-50 --kernel next`).out, `${RUN_ID}/FAFF-50/next/1`);
  }
  assert.equal(existsSync(join(runDir, "decision-capture")), false);
});

test("no run dir resolves: decide still mints wave 1, exits 0 and leaves a degraded note", () => {
  const { root } = scratchRoot();
  const r = call(root, `faff decision-capture decide --run run-with-no-dir --issue FAFF-51 --kernel next`);
  assert.equal(r.code, 0);
  assert.equal(r.out, "run-with-no-dir/FAFF-51/next/1");
  assert.match(readFileSync(join(root, ".faff", "logs", "decision-capture.jsonl"), "utf8"), /no consult counter/);
});

test("an unreadable counter file falls back to wave 1 without failing decide", () => {
  const { root, runDir } = scratchRoot();
  mkdirSync(join(runDir, "decision-capture"), { recursive: true });
  writeFileSync(join(runDir, "decision-capture", "counters.json"), "not json");
  const r = call(root, `faff decision-capture decide --run ${RUN_ID} --issue FAFF-52 --kernel next`);
  assert.equal(r.code, 0);
  assert.equal(r.out, `${RUN_ID}/FAFF-52/next/1`);
  assert.match(readFileSync(join(root, ".faff", "logs", "decision-capture.jsonl"), "utf8"), /consult counter failed/);
});
