// FAFF-1412: `faff drain-filter` drops a runner pre-check candidate that a recent drain declined
// and that nobody has changed since, and keeps every candidate it is not sure about. Every case
// runs the real CLI against a mkdtempSync runs dir.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "plugin", "skills", "faff", "bin", "faff");
const NOW = "2026-10-27T19:00:00Z";
const RUN_A = "run-20261027-185215-beepboop-list-1456d4";
const RUN_B = "run-20261027-185806-beepboop-list-620a46";

function filter(runsDir, candidates, extra = []) {
  const stdin = typeof candidates === "string" ? candidates : JSON.stringify(candidates);
  const env = { ...process.env };
  delete env.FAFF_RUN_DIR;
  const r = spawnSync("node", [CLI, "drain-filter", "--runs-dir", runsDir, ...extra], { input: stdin, encoding: "utf8", env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const json = (runsDir, candidates, extra = []) => {
  const r = filter(runsDir, candidates, ["--now", NOW, "--json", ...extra]);
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out);
};

function runsDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "faff-1412-runs-")); }
function writeRun(dir, name, ledger) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, "run-ledger.json"), typeof ledger === "string" ? ledger : JSON.stringify({ schema_version: 1, run_id: name, ...ledger }));
}
const declined1318 = (at = "2026-10-27T18:56:00Z") => ({ admitted: [], declined: { "FAFF-1318": { reason: "inadmissible:0 born-verifiable scenario(s)", at } } });
const unchanged = [{ issue: "FAFF-1318", changed_at: "2026-10-27T07:31:53Z" }];

test("a declined, unchanged candidate is suppressed and an unrelated one kept", () => {
  const d = runsDir();
  writeRun(d, RUN_A, declined1318());
  const r = json(d, [...unchanged, { issue: "FAFF-9", changed_at: "2026-10-27T07:00:00Z" }]);
  assert.deepEqual(r.kept, ["FAFF-9"]);
  assert.equal(r.suppressed.length, 1);
  assert.equal(r.suppressed[0].issue, "FAFF-1318");
  assert.equal(r.suppressed[0].run_id, RUN_A);
  assert.equal(r.suppressed[0].declined_at, "2026-10-27T18:56:00Z");
  assert.equal(r.degraded, null);
  assert.equal(r.window_hours, 24);
});

test("default output is the kept ids space-separated; a change after the decline keeps it", () => {
  const d = runsDir();
  writeRun(d, RUN_A, declined1318());
  const r = filter(d, [{ issue: "FAFF-1318", changed_at: "2026-10-27T18:58:00Z" }], ["--now", NOW]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "FAFF-1318\n");
  const none = filter(d, unchanged, ["--now", NOW]);
  assert.equal(none.out, "\n");
});

test("a later unreadable ledger keeps the candidate and is named in degraded", () => {
  const d = runsDir();
  writeRun(d, RUN_A, declined1318());
  writeRun(d, RUN_B, "{not json");
  const r = json(d, unchanged);
  assert.deepEqual(r.kept, ["FAFF-1318"]);
  assert.deepEqual(r.suppressed, []);
  assert.match(r.degraded, new RegExp(`unreadable-ledger:${RUN_B}`));
});

test("an unreadable ledger older than the deciding decline does not keep the candidate", () => {
  const d = runsDir();
  writeRun(d, "run-20261027-184000-beepboop-list-000000", "{not json");
  writeRun(d, RUN_A, declined1318());
  const r = json(d, unchanged);
  assert.deepEqual(r.kept, []);
  assert.equal(r.suppressed[0].issue, "FAFF-1318");
  assert.match(r.degraded, /unreadable-ledger:run-20261027-184000/);
});

test("a run older than the window is ignored", () => {
  const d = runsDir();
  writeRun(d, "run-20261026-120000-beepboop-list-aaaaaa", declined1318("2026-10-26T12:04:00Z"));
  const r = json(d, [{ issue: "FAFF-1318", changed_at: "2026-10-25T00:00:00Z" }]);
  assert.deepEqual(r.kept, ["FAFF-1318"]);
  const wide = json(d, [{ issue: "FAFF-1318", changed_at: "2026-10-25T00:00:00Z" }], ["--max-age-hours", "48"]);
  assert.deepEqual(wide.kept, []);
});

test("admitted wins inside a run: a wave-1 decline then a wave-2 admission keeps the candidate", () => {
  const d = runsDir();
  writeRun(d, RUN_A, { ...declined1318(), admitted: ["FAFF-1318"], outcomes: { "FAFF-1318": "shipped" } });
  assert.deepEqual(json(d, unchanged).kept, ["FAFF-1318"]);
});

test("the newest mentioning run decides: a later admission after a decline keeps the candidate", () => {
  const d = runsDir();
  writeRun(d, RUN_A, declined1318());
  writeRun(d, RUN_B, { admitted: ["FAFF-1318"], outcomes: { "FAFF-1318": "parked" } });
  assert.deepEqual(json(d, unchanged).kept, ["FAFF-1318"]);
});

test("a double decline in one run keeps the later record (written twice through record-declined)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "faff-1412-dd-"));
  const genv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.t" };
  delete genv.FAFF_RUN_DIR;
  spawnSync("git", ["-C", root, "init", "-q", "-b", "main"], { env: genv });
  spawnSync("git", ["-C", root, "commit", "-q", "--allow-empty", "-m", "seed"], { env: genv });
  const mint = spawnSync("node", [CLI, "run-ledger", "init-self-drain", "--root", root, "--json"], { encoding: "utf8", env: genv });
  assert.equal(mint.status, 0, mint.stderr);
  const runDir = JSON.parse(mint.stdout).run_dir;
  const t0 = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  for (const at of [iso(t0 - 120000), iso(t0 - 60000)]) {
    const w = spawnSync("node", [CLI, "run-ledger", "record-declined", "--issue", "FAFF-1318", "--reason", "inadmissible:test", "--observed-at", at, "--run-dir", runDir], { encoding: "utf8", env: genv });
    assert.equal(w.status, 0, w.stderr);
  }
  const runs = path.join(root, ".faff", "runs");
  const now = ["--now", iso(t0 + 60000), "--json"];
  // Between the two observations: suppressed only if the later record won.
  assert.deepEqual(JSON.parse(filter(runs, [{ issue: "FAFF-1318", changed_at: iso(t0 - 90000) }], now).out).kept, []);
  assert.deepEqual(JSON.parse(filter(runs, [{ issue: "FAFF-1318", changed_at: iso(t0 - 30000) }], now).out).kept, ["FAFF-1318"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("two runs with the same start second are ordered by run dir name", () => {
  const d = runsDir();
  writeRun(d, "run-20261027-185215-beepboop-list-aaaaaa", { admitted: ["FAFF-1318"], outcomes: { "FAFF-1318": "parked" } });
  writeRun(d, "run-20261027-185215-beepboop-list-bbbbbb", declined1318());
  assert.deepEqual(json(d, unchanged).kept, [], "the later name (bbbbbb, declined) decides");
});

test("a crashed run's decline (owner still running) suppresses", () => {
  const d = runsDir();
  writeRun(d, RUN_A, { ...declined1318(), owner: { status: "running" } });
  assert.deepEqual(json(d, unchanged).kept, []);
});

test("clock-skew boundary: one second after at keeps, equal to at suppresses, fractional seconds compare as instants", () => {
  const d = runsDir();
  writeRun(d, RUN_A, declined1318("2026-10-27T18:56:00Z"));
  assert.deepEqual(json(d, [{ issue: "FAFF-1318", changed_at: "2026-10-27T18:56:01Z" }]).kept, ["FAFF-1318"]);
  assert.deepEqual(json(d, [{ issue: "FAFF-1318", changed_at: "2026-10-27T18:56:00Z" }]).kept, []);
  assert.deepEqual(json(d, [{ issue: "FAFF-1318", changed_at: "2026-10-27T18:56:00.000Z" }]).kept, []);
});

test("an unknown changed_at keeps the candidate", () => {
  const d = runsDir();
  writeRun(d, RUN_A, declined1318());
  assert.deepEqual(json(d, [{ issue: "FAFF-1318", changed_at: null }]).kept, ["FAFF-1318"]);
  assert.deepEqual(json(d, [{ issue: "FAFF-1318", changed_at: "yesterday" }]).kept, ["FAFF-1318"]);
  assert.deepEqual(json(d, [{ issue: "FAFF-1318" }]).kept, ["FAFF-1318"]);
});

test("a routed-out outcome with no decline record keeps the candidate", () => {
  const d = runsDir();
  writeRun(d, RUN_A, { admitted: [], outcomes: { "FAFF-1318": "routed-out" } });
  assert.deepEqual(json(d, unchanged).kept, ["FAFF-1318"]);
});

test("a malformed candidate id is kept in input order and named in degraded", () => {
  const d = runsDir();
  writeRun(d, RUN_A, declined1318());
  const r = json(d, [{ issue: "FAFF-9", changed_at: null }, { issue: "../x", changed_at: null }, ...unchanged]);
  assert.deepEqual(r.kept, ["FAFF-9", "../x"]);
  assert.match(r.degraded, /bad-candidate:1/);
});

test("a missing runs dir keeps everything with degraded no-runs-dir", () => {
  const r = json(path.join(os.tmpdir(), "faff-1412-no-such-dir-" + process.pid), unchanged);
  assert.deepEqual(r.kept, ["FAFF-1318"]);
  assert.equal(r.degraded, "no-runs-dir");
});

test("a symlinked runs dir is read through the link", () => {
  const real = runsDir();
  writeRun(real, RUN_A, declined1318());
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "faff-1412-link-")), "runs");
  fs.symlinkSync(real, link);
  assert.deepEqual(json(link, unchanged).kept, []);
});

test("a run dir whose name has no time uses owner.started_at, then the dir mtime, for the window", () => {
  const d = runsDir();
  writeRun(d, "custom-run", { ...declined1318(), owner: { started_at: "2026-10-27T18:50:00Z" } });
  assert.deepEqual(json(d, unchanged).kept, []);
  const old = runsDir();
  writeRun(old, "custom-old", { ...declined1318(), owner: { started_at: "2026-10-20T00:00:00Z" } });
  assert.deepEqual(json(old, unchanged).kept, ["FAFF-1318"]);
  const bare = runsDir();
  writeRun(bare, "no-time", declined1318());
  const now = new Date().toISOString();
  const r = filter(bare, unchanged, ["--now", now, "--json"]);
  assert.deepEqual(JSON.parse(r.out).kept, [], "mtime is now, so the run is inside the window");
});

test("stdin and flag validation: exit 2", () => {
  const d = runsDir();
  for (const stdin of ["{}", "[1,2]", "not json", "[null]"]) {
    assert.equal(filter(d, stdin).code, 2, `stdin ${stdin}`);
  }
  for (const extra of [["--max-age-hours", "0"], ["--max-age-hours", "169"], ["--max-age-hours", "x"], ["--now", "yesterday"], ["--bogus"]]) {
    assert.equal(filter(d, unchanged, extra).code, 2, extra.join(" "));
  }
  assert.equal(filter(d, unchanged, ["--max-age-hours", "168"]).code, 0);
});

test("drain-filter writes nothing", () => {
  const d = runsDir();
  writeRun(d, RUN_A, declined1318());
  const before = fs.readFileSync(path.join(d, RUN_A, "run-ledger.json"));
  json(d, unchanged);
  assert.deepEqual(fs.readdirSync(d), [RUN_A]);
  assert.deepEqual(fs.readdirSync(path.join(d, RUN_A)), ["run-ledger.json"]);
  assert.deepEqual(fs.readFileSync(path.join(d, RUN_A, "run-ledger.json")), before);
});
