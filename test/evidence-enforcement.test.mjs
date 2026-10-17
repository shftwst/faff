// FAFF-1261: the per-PR mint refuses an anchor that fails its schema, `--check` runs the same checks without
// committing, the holdout binding lives in the validator, and `faff evidence write ac-checklist` refuses a
// criterion with no `ac_id`. Replaces the warn-only mint test (FAFF-1263); its governance-check leg cases
// live here too, built from anchors that were minted and then altered, since a bad anchor can no longer be minted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli } from "./helpers/run-cli.mjs";
import {
  example, exampleObject, mkChainedRun, repoRoot, seedFloor, seedOptionalFloor, writeEvidence,
} from "./helpers/evidence-anchor-fixtures.mjs";

const require = createRequire(import.meta.url);
const SENTINEL = "S3CR3T-SENTINEL";
const SECRET = "supersecretvalue-0123456789";
// Under GitHub Actions governance-check prints real ::error:: annotation commands; the tests read plain output.
delete process.env.GITHUB_ACTIONS;

const evidence = require("../plugin/skills/faff/bin/lib/evidence.js");
const events = require("../plugin/skills/faff/bin/lib/events.js");
const holdoutRecord = require("../plugin/skills/faff/bin/lib/holdout-record.js");
const gov = require("../plugin/skills/faff/bin/lib/governance-check.js");

const FILE_LINE = /^faff events anchor: (?:unschemaed-file|schema-mismatch) /;

// A run dir for FAFF-1 with v0.3 evidence, and a --dest whose parent does not exist yet.
function fixture({ shape = "v03", optional = false, mutate } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "faff-1261-"));
  const run = mkChainedRun(root);
  writeEvidence(run, shape);
  if (optional) seedOptionalFloor(run);
  if (mutate) mutate(run, root);
  const parent = path.join(root, "out");
  const dest = path.join(parent, "dest");
  const args = (extra = []) => ["events", "anchor", "--run-dir", run, "--issue", "FAFF-1", "--dest", dest, ...extra];
  return { root, run, parent, dest, args, mint: (extra = [], opts = {}) => runCli(args(extra), { cwd: root, ...opts }) };
}
const cleanup = (...fs) => fs.forEach((f) => rmSync(f.root, { recursive: true, force: true }));
const editJson = (file, edit) => writeFileSync(file, JSON.stringify(edit(JSON.parse(readFileSync(file, "utf8")))));
const issueFile = (f, name) => path.join(f.run, "FAFF-1", name);
const lines = (text) => text.split("\n").filter(Boolean);

// A byte snapshot of a directory tree: relative path -> sha256, plus the empty directories.
function snapshot(dir) {
  if (!existsSync(dir)) return null;
  const out = {};
  const walk = (d, prefix) => {
    const entries = readdirSync(d, { withFileTypes: true });
    if (entries.length === 0 && prefix) out[`${prefix}/`] = "dir";
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), rel);
      else out[rel] = createHash("sha256").update(readFileSync(path.join(d, e.name))).digest("hex");
    }
  };
  walk(dir, "");
  return out;
}

// A copy of the plugin whose bundled evidence manifest a test may edit or remove.
function pluginCopy(edit) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-1261-plugin-"));
  const copy = path.join(dir, "faff");
  cpSync(path.join(repoRoot, "plugin", "skills", "faff"), copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
  edit(path.join(copy, "contracts", "evidence-v0.3"));
  const run = (args, opts = {}) => {
    const r = spawnSync(process.execPath, [path.join(copy, "bin", "faff"), ...args], { encoding: "utf8", env: process.env, ...opts });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return { dir, run };
}

// Runs cmdEvents in this process with the output captured, so a test can stub a module function.
function inProcess(args) {
  const err = [];
  const out = [];
  const realWrite = process.stderr.write;
  const realLog = console.log;
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  console.log = (...a) => { out.push(a.join(" ")); };
  try {
    const code = events.cmdEvents(args.slice(1)); // drop the leading "events"
    return { code, stderr: err.join(""), stdout: out.join("\n") };
  } finally {
    process.stderr.write = realWrite;
    console.log = realLog;
  }
}

// --- Scenario 1 and the refusal table ---------------------------------------------------------------

test("a review verdict without schema_version is refused: exit 3, schema-mismatch, no --dest and no parent created", () => {
  const f = fixture({ mutate: (run) => editJson(path.join(run, "FAFF-1", "review-verdict.json"), (d) => { delete d.schema_version; return d; }) });
  try {
    const r = f.mint();
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /faff events anchor: schema-mismatch review-verdict\.json: fail, \d+ violation\(s\)/);
    assert.equal(existsSync(f.dest), false);
    assert.equal(existsSync(f.parent), false, "no directory was created under the --dest parent");
    assert.equal(r.stdout, "");
  } finally { cleanup(f); }
});

test("a conforming mint exits 0, prints today's success line, and the landed anchor validates", () => {
  const f = fixture();
  try {
    const r = f.mint();
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^events anchor: .* → .* \(head_seq 1, head_sha256 [0-9a-f]{12}…, 2 lines, schema_floor 2\) \+ ac-checklist\.json, review-verdict\.json\n$/);
    assert.equal(r.stderr, "");
    assert.deepEqual(readdirSync(f.dest).sort(), ["ac-checklist.json", "chain-head.json", "events.jsonl", "review-verdict.json", "run-ledger.json"]);
    assert.ok(readFileSync(path.join(f.run, "events.jsonl")).equals(readFileSync(path.join(f.dest, "events.jsonl"))));
    const v = runCli(["evidence", "validate", f.dest, "--require-evidence-schema"]);
    assert.equal(v.code, 0, v.stdout);
    assert.deepEqual(readdirSync(path.dirname(f.dest)), ["dest"], "no staging directory is left beside --dest");
  } finally { cleanup(f); }
});

test("each refusal code exits 3 and creates neither --dest nor its parent", () => {
  const unavailable = fixture();
  const unschemaed = fixture({ optional: true });
  const mismatch = fixture({ mutate: (run) => editJson(path.join(run, "FAFF-1", "ac-checklist.json"), (d) => ({ ...d, extra: 1 })) });
  const checkError = fixture();
  const copyA = pluginCopy((v03) => rmSync(path.join(v03, "anchor-manifest.json")));
  const copyB = pluginCopy((v03) => editJson(path.join(v03, "anchor-manifest.json"), (m) => { delete m.files["landing-progress.json"]; return m; }));
  try {
    const a = copyA.run(unavailable.args());
    assert.equal(a.code, 3, a.stderr);
    assert.match(a.stderr, /^faff events anchor: schema-unavailable anchor-manifest\.json$/m);

    const b = copyB.run(unschemaed.args());
    assert.equal(b.code, 3, b.stderr);
    assert.match(b.stderr, /^faff events anchor: unschemaed-file landing-progress\.json$/m);

    const c = mismatch.mint();
    assert.equal(c.code, 3, c.stderr);
    assert.match(c.stderr, /^faff events anchor: schema-mismatch ac-checklist\.json: fail, 1 violation\(s\)$/m);

    const real = evidence.validateAnchorDir;
    let d;
    try {
      evidence.validateAnchorDir = () => { throw new Error(`${SENTINEL} boom`); };
      d = inProcess(checkError.args());
    } finally { evidence.validateAnchorDir = real; }
    assert.equal(d.code, 3, d.stderr);
    assert.match(d.stderr, /^faff events anchor: schema-check-error Error$/m);
    assert.ok(!d.stderr.includes(SENTINEL), "a validator exception's message never reaches stderr");

    for (const f of [unavailable, unschemaed, mismatch, checkError]) {
      assert.equal(existsSync(f.dest), false);
      assert.equal(existsSync(f.parent), false);
    }
  } finally {
    cleanup(unavailable, unschemaed, mismatch, checkError);
    rmSync(copyA.dir, { recursive: true, force: true });
    rmSync(copyB.dir, { recursive: true, force: true });
  }
});

test("a legacy staged anchor is refused with one schema-mismatch line per present evidence document", () => {
  const f = fixture({ shape: "legacy" });
  try {
    const r = f.mint();
    assert.equal(r.code, 3, r.stderr);
    assert.deepEqual(lines(r.stderr), [
      "faff events anchor: schema-mismatch ac-checklist.json: legacy, 0 violation(s)",
      "faff events anchor: schema-mismatch review-verdict.json: legacy, 0 violation(s)",
    ]);
    assert.equal(existsSync(f.parent), false);
  } finally { cleanup(f); }
});

test("refusal lines are grouped in table order, sorted by path, at most five files in total, then a (+N more files) suffix", () => {
  const f = fixture({
    optional: true,
    mutate: (run) => {
      for (const name of ["ac-checklist.json", "review-verdict.json", "spec-review-verdict.json", "holdout.json"]) editJson(path.join(run, "FAFF-1", name), (d) => ({ ...d, extra: 1 }));
      editJson(path.join(run, "run-ledger.json"), (d) => ({ ...d, extra: 1 }));
    },
  });
  const copy = pluginCopy((v03) => editJson(path.join(v03, "anchor-manifest.json"), (m) => { delete m.files["build-progress.json"]; delete m.files["landing-progress.json"]; return m; }));
  try {
    const r = copy.run(f.args());
    assert.equal(r.code, 3, r.stderr);
    assert.deepEqual(lines(r.stderr), [
      "faff events anchor: unschemaed-file build-progress.json",
      "faff events anchor: unschemaed-file landing-progress.json",
      "faff events anchor: schema-mismatch ac-checklist.json: fail, 1 violation(s)",
      "faff events anchor: schema-mismatch holdout.json: fail, 1 violation(s)",
      "faff events anchor: schema-mismatch review-verdict.json: fail, 1 violation(s)",
      "faff events anchor: (+2 more files)",
    ]);
    assert.equal(lines(r.stderr).filter((l) => FILE_LINE.test(l)).length, 5);
  } finally { cleanup(f); rmSync(copy.dir, { recursive: true, force: true }); }
});

test("no mint stderr line carries violation text or a field value; --check --json and evidence validate may", () => {
  const f = fixture({
    mutate: (run) => {
      const log = path.join(run, "events.jsonl");
      const last = readFileSync(log, "utf8").trimEnd().split("\n").at(-1);
      const prev = createHash("sha256").update(last).digest("hex");
      const rec = { schema: 2, run_id: path.basename(run), seq: 2, ts: "2026-01-01T00:00:00.000Z", prev, phase: "build", type: SENTINEL, issue: "FAFF-1", data: {} };
      appendFileSync(log, JSON.stringify(rec) + "\n");
    },
  });
  try {
    const r = f.mint();
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /schema-mismatch events\.jsonl: fail, \d+ violation\(s\)/);
    assert.ok(!r.stderr.includes(SENTINEL) && !r.stdout.includes(SENTINEL));
    const diagnostic = f.mint(["--check", "--json"]);
    assert.equal(diagnostic.code, 3);
    assert.ok(!diagnostic.stderr.includes(SENTINEL));
    assert.ok(diagnostic.stdout.includes(SENTINEL), "the local diagnostic keeps the violation text");
  } finally { cleanup(f); }
  const g = fixture();
  try {
    assert.equal(g.mint().code, 0);
    appendFileSync(path.join(g.dest, "events.jsonl"), JSON.stringify({ schema: 2, type: SENTINEL }) + "\n");
    const v = runCli(["evidence", "validate", g.dest]);
    assert.equal(v.code, 1);
  } finally { cleanup(g); }
});

test("a torn final line in events.jsonl or declared-effects.jsonl is skipped: the mint passes", () => {
  const f = fixture({ mutate: (run) => appendFileSync(path.join(run, "events.jsonl"), '{"schema":2,"run_id":"x","seq":2,"ts":"t","prev":"') });
  try {
    const r = f.mint();
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(runCli(["evidence", "validate", f.dest, "--json"]).stdout);
    assert.equal(report.status, "pass");
    assert.equal(report.files.find((e) => e.path === "events.jsonl").torn_tail, true);
  } finally { cleanup(f); }
  const g = fixture();
  try {
    const effect = readFileSync(path.join(repoRoot, "plugin", "skills", "faff", "contracts", "evidence-v0.3", "schema", "examples", "declared-effect.example.json"), "utf8").replace(/\s*\n\s*/g, " ");
    writeFileSync(path.join(g.run, "declared-effects.jsonl"), `${effect}\n{"schema":3,"run_id":"x`);
    const r = g.mint();
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(runCli(["evidence", "validate", g.dest, "--json"]).stdout);
    assert.equal(report.files.find((e) => e.path === "declared-effects.jsonl").torn_tail, true);
  } finally { cleanup(g); }
});

test("a run dir holding review-rounds/ mints with exit 0 and the landed --dest has no review-rounds path", () => {
  const f = fixture({
    mutate: (run) => {
      mkdirSync(path.join(run, "FAFF-1", "review-rounds"), { recursive: true });
      writeFileSync(path.join(run, "FAFF-1", "review-rounds", "round-1.json"), example("review-round"));
    },
  });
  try {
    const r = f.mint();
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!readdirSync(f.dest, { recursive: true }).some((p) => String(p).includes("review-rounds")));
  } finally { cleanup(f); }
});

// --- --dest guards -----------------------------------------------------------------------------------

test("a --dest holding a non-anchor file, or a non-empty --dest with no chain-head.json, exits 2 dest-not-anchor and is untouched", () => {
  const stray = fixture();
  const headless = fixture();
  try {
    mkdirSync(stray.dest, { recursive: true });
    assert.equal(stray.mint().code, 0);
    writeFileSync(path.join(stray.dest, "notes.txt"), "mine");
    const before = snapshot(stray.dest);
    const a = stray.mint();
    assert.equal(a.code, 2, a.stderr);
    assert.match(a.stderr, /^faff events anchor: --dest holds non-anchor files: .*dest$/m);
    assert.deepEqual(snapshot(stray.dest), before);

    mkdirSync(headless.dest, { recursive: true });
    writeFileSync(path.join(headless.dest, "events.jsonl"), "x");
    const beforeHeadless = snapshot(headless.dest);
    const b = headless.mint();
    assert.equal(b.code, 2, b.stderr);
    assert.match(b.stderr, /--dest holds non-anchor files/);
    assert.deepEqual(snapshot(headless.dest), beforeHeadless);
  } finally { cleanup(stray, headless); }
});

test("an empty existing --dest is filled in place and not removed; the landed --dest passes checkAnchorDir", () => {
  const f = fixture();
  try {
    mkdirSync(f.dest, { recursive: true });
    const inode = statSync(f.dest).ino;
    const r = f.mint();
    assert.equal(r.code, 0, r.stderr);
    assert.equal(statSync(f.dest).ino, inode, "the directory itself was kept");
    assert.equal(evidence.checkAnchorDir(f.dest).status, "pass");
  } finally { cleanup(f); }
});

test("a --dest that is a symlink or a regular file exits 2 and nothing it points to is touched", () => {
  const f = fixture();
  try {
    const target = path.join(f.root, "target");
    mkdirSync(target);
    writeFileSync(path.join(target, "keep.txt"), "keep");
    mkdirSync(f.parent);
    symlinkSync(target, f.dest);
    const r = f.mint();
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /^faff events anchor: --dest is not a plain directory: /m);
    assert.deepEqual(snapshot(target), { "keep.txt": createHash("sha256").update("keep").digest("hex") });
    assert.ok(lstatSync(f.dest).isSymbolicLink());
    const check = f.mint(["--check"]);
    assert.equal(check.code, 2);
    rmSync(f.dest);
    writeFileSync(f.dest, "a file");
    assert.equal(f.mint().code, 2);
    assert.equal(readFileSync(f.dest, "utf8"), "a file");
  } finally { cleanup(f); }
});

// --- Scenario 2: a re-mint replaces --dest wholesale -------------------------------------------------

test("a re-mint replaces --dest wholesale; a re-mint that would drop a file exits 3 anchor-shrink and --check agrees", () => {
  const f = fixture();
  try {
    assert.equal(f.mint().code, 0);
    // An older anchor: a subset of the new mint's files, one of which differs.
    rmSync(path.join(f.dest, "run-ledger.json"));
    writeFileSync(path.join(f.dest, "review-verdict.json"), example("review-verdict-anchored"));
    const stale = snapshot(f.dest);
    const check = f.mint(["--check"]);
    assert.equal(check.code, 0, check.stderr);
    assert.match(check.stdout, /^events anchor --check: ok$/m);
    assert.deepEqual(snapshot(f.dest), stale, "--check leaves --dest byte-identical");

    const r = f.mint();
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readdirSync(f.dest).sort(), ["ac-checklist.json", "chain-head.json", "events.jsonl", "review-verdict.json", "run-ledger.json"]);
    assert.ok(readFileSync(issueFile(f, "review-verdict.json")).equals(readFileSync(path.join(f.dest, "review-verdict.json"))), "the new review-verdict.json bytes landed");
    assert.equal(runCli(["evidence", "validate", f.dest, "--require-evidence-schema"]).code, 0);

    // A file the run dir no longer has.
    writeFileSync(path.join(f.dest, "holdout.json"), JSON.stringify({ ...exampleObject("holdout-anchored"), issue: "FAFF-1" }));
    const held = snapshot(f.dest);
    const shrink = f.mint();
    assert.equal(shrink.code, 3, shrink.stderr);
    assert.match(shrink.stderr, /^faff events anchor: anchor-shrink holdout\.json: present in the existing anchor, absent from the staged anchor$/m);
    assert.deepEqual(snapshot(f.dest), held);
    const shrinkCheck = f.mint(["--check"]);
    assert.equal(shrinkCheck.code, 3);
    assert.deepEqual(snapshot(f.dest), held);
  } finally { cleanup(f); }
});

// --- --check -----------------------------------------------------------------------------------------

test("--check exits with the real mint's code on every case and leaves --dest byte-identical", () => {
  const cases = {
    pass: {},
    "absent dest, schema-mismatch": { mutate: (run) => editJson(path.join(run, "FAFF-1", "ac-checklist.json"), (d) => ({ ...d, extra: 1 })) },
    "anchor-shrink": { dest: (f) => { writeFileSync(path.join(f.dest, "holdout.json"), JSON.stringify({ ...exampleObject("holdout-anchored"), issue: "FAFF-1" })); } },
    "dest-not-anchor": { dest: (f) => writeFileSync(path.join(f.dest, "notes.txt"), "x"), headless: true },
  };
  for (const [label, c] of Object.entries(cases)) {
    const real = fixture({ mutate: c.mutate });
    const check = fixture({ mutate: c.mutate });
    try {
      for (const f of [real, check]) {
        if (!c.dest) continue;
        mkdirSync(f.dest, { recursive: true });
        if (!c.headless) {
          // Seed a prior anchor from a conforming run, so the shrink case has something to drop.
          const prior = fixture();
          assert.equal(prior.mint().code, 0);
          cpSync(prior.dest, f.dest, { recursive: true });
          cleanup(prior);
        }
        c.dest(f);
      }
      const before = snapshot(check.dest);
      const a = real.mint();
      const b = check.mint(["--check"]);
      assert.equal(b.code, a.code, `${label}: ${a.stderr} | ${b.stderr}`);
      assert.deepEqual(snapshot(check.dest), before, `${label}: --check never touches --dest`);
      assert.equal(existsSync(check.parent), c.dest ? true : false, label);
      if (a.code === 0) assert.match(b.stdout, /^events anchor --check: ok$/m);
    } finally { cleanup(real, check); }
  }
});

test("--check --json prints the redacted validation report on a pass and on a refusal, and none when the validator produced none", () => {
  const bad = fixture({ mutate: (run, root) => {
    writeFileSync(path.join(root, ".faffrc.yaml"), `andon:\n  token: ${SECRET}\n`);
    editJson(path.join(run, "FAFF-1", "ac-checklist.json"), (d) => ({ ...d, extra: 1 }));
    const log = path.join(run, "events.jsonl");
    const last = readFileSync(log, "utf8").trimEnd().split("\n").at(-1);
    const rec = { schema: 2, run_id: path.basename(run), seq: 2, ts: "2026-01-01T00:00:00.000Z", prev: createHash("sha256").update(last).digest("hex"), phase: "build", type: `x ${SECRET}`, issue: "FAFF-1", data: {} };
    appendFileSync(log, JSON.stringify(rec) + "\n");
  } });
  const good = fixture();
  const noSchema = fixture();
  const copy = pluginCopy((v03) => rmSync(path.join(v03, "anchor-manifest.json")));
  try {
    const refused = bad.mint(["--check", "--json"]);
    assert.equal(refused.code, 3, refused.stderr);
    const report = JSON.parse(refused.stdout.split("\n")[0]);
    assert.equal(report.status, "fail");
    assert.ok(report.files.some((e) => e.path === "ac-checklist.json" && e.violations.length > 0));
    assert.ok(!refused.stdout.includes(SECRET), "the report is redacted");
    assert.ok(refused.stdout.includes("[REDACTED]"));
    assert.ok(!refused.stderr.includes("violation text"), "the refusal lines still carry counts only");

    const passed = good.mint(["--check", "--json"]);
    assert.equal(passed.code, 0, passed.stderr);
    assert.equal(JSON.parse(passed.stdout.split("\n")[0]).status, "pass");
    assert.match(passed.stdout, /events anchor --check: ok/);

    const none = copy.run(noSchema.args(["--check", "--json"]));
    assert.equal(none.code, 3);
    assert.equal(none.stdout, "", "schema-unavailable: the validator produced no report");
  } finally { cleanup(bad, good, noSchema); rmSync(copy.dir, { recursive: true, force: true }); }
});

test("--check --json exits 2 and prints no report when the redaction config cannot be read", () => {
  const f = fixture({ mutate: (_run, root) => writeFileSync(path.join(root, ".faffrc.yaml"), "- not\n- a mapping\n") });
  try {
    const r = f.mint(["--check", "--json"]);
    assert.equal(r.code, 2, r.stderr);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /redaction config could not be read/);
  } finally { cleanup(f); }
});

test("--check returns before commitMint (commitMint stubbed to throw)", () => {
  const f = fixture();
  const real = events.commitMint;
  try {
    events.commitMint = () => { throw new Error("commitMint must not run under --check"); };
    const r = inProcess(f.args(["--check"]));
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /events anchor --check: ok/);
    assert.equal(existsSync(f.parent), false);
    assert.throws(() => inProcess(f.args()), /commitMint must not run under --check/, "the real mint does reach commitMint");
    assert.equal(existsSync(f.dest), false, "the stub threw before anything was written");
  } finally { events.commitMint = real; cleanup(f); }
});

// --- holdout binding and constraints -----------------------------------------------------------------

test("a holdout.json whose issue differs from chain-head.json is refused at mint and fails validate, naming neither id", () => {
  const f = fixture({ mutate: (run) => {
    mkdirSync(path.join(run, "FAFF-1"), { recursive: true });
    writeFileSync(path.join(run, "FAFF-1", "holdout.json"), JSON.stringify({ ...exampleObject("holdout-anchored"), issue: "FAFF-2" }));
  } });
  const g = fixture();
  try {
    const r = f.mint();
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /^faff events anchor: schema-mismatch holdout\.json: fail, 1 violation\(s\)$/m);
    assert.ok(!r.stderr.includes("FAFF-2") && !r.stderr.includes("FAFF-1"));

    assert.equal(g.mint().code, 0);
    writeFileSync(path.join(g.dest, "holdout.json"), JSON.stringify({ ...exampleObject("holdout-anchored"), issue: "FAFF-2" }));
    const v = runCli(["evidence", "validate", g.dest]);
    assert.equal(v.code, 1, v.stdout);
    assert.match(v.stdout, /holdout\.json: issue does not match anchor issue/);
    assert.ok(!v.stdout.includes("FAFF-2") && !v.stdout.includes("FAFF-1"));
    const json = runCli(["evidence", "validate", g.dest, "--json"]);
    assert.ok(!json.stdout.includes("FAFF-2"));
  } finally { cleanup(f, g); }
});

test("a holdout.json with no chain-head.json fails evidence validate", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-1261-holdout-"));
  try {
    writeFileSync(path.join(dir, "holdout.json"), example("holdout-anchored"));
    const v = runCli(["evidence", "validate", dir]);
    assert.equal(v.code, 1, v.stdout);
    assert.match(v.stdout, /holdout\.json: issue does not match anchor issue/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a holdout.json failing the writer-only constraints is refused at mint", () => {
  const f = fixture({ mutate: (run) => {
    mkdirSync(path.join(run, "FAFF-1"), { recursive: true });
    const doc = { ...exampleObject("holdout-anchored"), issue: "FAFF-1" };
    doc.criteria[0].id = "scenarios:0";
    writeFileSync(path.join(run, "FAFF-1", "holdout.json"), JSON.stringify(doc));
  } });
  try {
    const r = f.mint();
    assert.equal(r.code, 3, r.stderr);
    assert.match(r.stderr, /schema-mismatch holdout\.json: fail, 1 violation\(s\)/);
    assert.equal(existsSync(f.dest), false);
  } finally { cleanup(f); }
});

test("holdoutRecordViolations is the schema check followed by holdoutConstraintViolations", () => {
  const good = { ...exampleObject("holdout-anchored") };
  assert.deepEqual(holdoutRecord.holdoutConstraintViolations(good), []);
  assert.deepEqual(holdoutRecord.holdoutRecordViolations(good), []);
  const bad = { ...good, criteria: [{ ...good.criteria[0], id: "scenarios:0", observed: null }] };
  const constraints = holdoutRecord.holdoutConstraintViolations(bad);
  assert.equal(constraints.length, 2);
  assert.deepEqual(holdoutRecord.holdoutRecordViolations(bad).slice(-constraints.length), constraints);
  assert.deepEqual(holdoutRecord.holdoutConstraintViolations(null), []);
});

test("evidence capabilities lists holdout-binding", () => {
  const r = runCli(["evidence", "capabilities", "--json"]);
  assert.deepEqual(JSON.parse(r.stdout), { validate: ["require-evidence-schema", "candidate-schemas", "holdout-binding"] });
});

test("the warn-only check is gone from events.js", () => {
  const text = readFileSync(path.join(repoRoot, "plugin", "skills", "faff", "bin", "lib", "events.js"), "utf8");
  assert.ok(!text.includes("warnOnEvidenceSchema"));
  assert.ok(!text.includes("warn-only"));
});

test("module wiring: events.js has no top-level evidence require, evidence.js requires no factory file", () => {
  const lib = path.join(repoRoot, "plugin", "skills", "faff", "bin", "lib");
  const text = readFileSync(path.join(lib, "events.js"), "utf8");
  const topLevel = text.split("\n").filter((l) => /^(const|let|var)\b.*require\(/.test(l));
  assert.ok(!topLevel.some((l) => l.includes('require("./evidence")')));
  const ev = readFileSync(path.join(lib, "evidence.js"), "utf8");
  assert.ok(!/require\(["']\.\/(governance-check|evidence-readiness)["']\)/.test(ev));
  const { REGION_MAP } = require("../plugin/skills/faff/bin/lib/regions.js");
  assert.equal(REGION_MAP["evidence-readiness"], "factory");
  for (const name of ["holdout-record.js", "evidence.js"]) assert.match(readFileSync(path.join(lib, name), "utf8"), /^\/\/ === region:governance/m, `${name} is governance-region`);
  const r = runCli(["evidence-readiness", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

// --- ac_id writer rule (Scenario 4) ------------------------------------------------------------------

function writerFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "faff-1261-ac-"));
  const run = mkChainedRun(root);
  const file = path.join(run, "FAFF-1", "ac-checklist.json");
  const write = (input) => runCli(["evidence", "write", "ac-checklist", "--run-dir", run, "--issue", "FAFF-1"], { input: typeof input === "string" ? input : JSON.stringify(input), cwd: root });
  return { root, run, file, write };
}
const crit = (n, extra = {}) => ({ ac: `Criterion ${n} ${SENTINEL}`, verified: `Verified ${n} ${SENTINEL}`, passed: true, ...extra });

test("ac-checklist writer: a criterion with no ac_id is refused with its index, no criterion text, and nothing written", () => {
  const w = writerFixture();
  try {
    const one = w.write({ all_verified: true, criteria: [crit(1, { ac_id: "faff-1#ac-1" }), crit(2)] });
    assert.equal(one.code, 1, one.stderr);
    assert.match(one.stderr, /faff evidence write ac-checklist: refused: criteria\[1\]\.ac_id: required \(take it from faff dod classify --issue\)/);
    assert.ok(!one.stderr.includes(SENTINEL) && !one.stderr.includes("Criterion"));
    assert.equal(existsSync(w.file), false);

    const nulls = w.write({ all_verified: true, criteria: [crit(1, { ac_id: null }), crit(2, { ac_id: null })] });
    assert.equal(nulls.code, 1);
    assert.equal(nulls.stderr.split("\n").filter((l) => /criteria\[\d\]\.ac_id: required/.test(l)).length, 2, "one line per offending criterion");
    assert.ok(!nulls.stderr.includes(SENTINEL));

    const absent = w.write({ all_verified: true, criteria: [crit(1)] });
    assert.equal(absent.code, 1);
    assert.match(absent.stderr, /criteria\[0\]\.ac_id: required/);

    const mixed = w.write({ all_verified: true, criteria: [crit(1, { ac_id: "faff-1#ac-1" }), crit(2, { ac_id: null })] });
    assert.equal(mixed.code, 1);
    assert.match(mixed.stderr, /ac_id: every criterion carries one, or none does/);
    assert.match(mixed.stderr, /criteria\[1\]\.ac_id: required/);
    assert.equal(existsSync(w.file), false);
  } finally { cleanup(w); }
});

test("ac-checklist writer: a zero-AC input and criteria that all carry classify ids (including done:N) are written", () => {
  const w = writerFixture();
  try {
    assert.equal(w.write({ all_verified: true }).code, 0);
    rmSync(w.file);
    const ids = w.write({ all_verified: true, criteria: [crit(1, { ac_id: "faff-1#ac-1" }), crit(2, { ac_id: "faff-1#done:2" })] });
    assert.equal(ids.code, 0, ids.stderr);
    assert.deepEqual(JSON.parse(readFileSync(w.file, "utf8")).criteria.map((c) => c.ac_id), ["faff-1#ac-1", "faff-1#done:2"]);
  } finally { cleanup(w); }
});

test("a checklist whose criteria all carry ac_id: null still renders, validates, mints and passes --check", () => {
  const f = fixture({ mutate: (run) => {
    writeFileSync(path.join(run, "FAFF-1", "ac-checklist.json"), JSON.stringify({
      schema_version: 1, all_verified: true,
      criteria: [{ ac: "a", verified: "v", passed: true, ac_id: null, verifications: null }, { ac: "b", verified: "w", passed: true, ac_id: null, verifications: null }],
    }));
  } });
  try {
    const render = runCli(["evidence", "render", "ac-checklist", "--run-dir", f.run, "--issue", "FAFF-1"], { cwd: f.root });
    assert.equal(render.code, 0, render.stderr);
    const check = f.mint(["--check"]);
    assert.equal(check.code, 0, check.stderr);
    assert.equal(f.mint().code, 0);
    assert.equal(runCli(["evidence", "validate", f.dest, "--require-evidence-schema"]).code, 0);
  } finally { cleanup(f); }
});

test("the committed FAFF-1300, FAFF-1301 and FAFF-1302 anchors (every ac_id null) still pass evidence validate --require-evidence-schema", () => {
  const anchors = path.join(repoRoot, ".faff", "anchors");
  const found = [];
  for (const run of readdirSync(anchors)) {
    for (const issue of ["FAFF-1300", "FAFF-1301", "FAFF-1302"]) {
      const dir = path.join(anchors, run, issue);
      if (existsSync(dir)) found.push(dir);
    }
  }
  assert.equal(found.length, 3);
  for (const dir of found) {
    const doc = JSON.parse(readFileSync(path.join(dir, "ac-checklist.json"), "utf8"));
    assert.ok(doc.criteria.every((c) => c.ac_id === null), dir);
    const v = runCli(["evidence", "validate", dir, "--require-evidence-schema"]);
    assert.equal(v.code, 0, v.stdout);
  }
});

// --- governance-check leg (carried from the warn-only test; anchors are minted, then altered) ----------

function govJson(dir, extra = []) {
  const r = runCli(["governance-check", "--anchor-dir", dir, "--json", ...extra]);
  return { ...r, verdict: JSON.parse(r.stdout) };
}
function mintedAnchor(mutate) {
  const f = fixture();
  assert.equal(f.mint().code, 0);
  if (mutate) mutate(f.dest);
  return f;
}

test("a failing evidence document sets the leg to fail without changing pass, exit code or reasons", () => {
  const good = mintedAnchor();
  const bad = mintedAnchor((dest) => editJson(path.join(dest, "review-verdict.json"), (d) => { delete d.rounds_total; return d; }));
  try {
    const g = govJson(good.dest);
    const b = govJson(bad.dest);
    assert.equal(b.verdict.runs[0].legs.evidence_schema.status, "fail");
    assert.equal(b.verdict.runs[0].legs.evidence_schema.report_only, true);
    assert.equal(g.verdict.runs[0].legs.evidence_schema.status, "pass");
    assert.equal(b.code, g.code);
    assert.equal(b.verdict.pass, g.verdict.pass);
    assert.deepEqual(b.verdict.reasons, g.verdict.reasons);
    // FAFF-1347: the anchor's events.jsonl scope block is folded into the leg detail.
    assert.match(b.verdict.runs[0].legs.evidence_schema.detail, /^1 file\(s\) non-conforming: review-verdict\.json( \[events scope: [^\]]*\])?$/);
  } finally { cleanup(good, bad); }
});

test("the legacy status reaches the leg and the text and markdown renderers show it as report-only", () => {
  const f = mintedAnchor((dest) => {
    rmSync(path.join(dest, "run-ledger.json"));
    writeFileSync(path.join(dest, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
    writeFileSync(path.join(dest, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
  });
  try {
    const j = govJson(f.dest);
    assert.equal(j.verdict.runs[0].legs.evidence_schema.status, "legacy");
    const text = runCli(["governance-check", "--anchor-dir", f.dest]);
    assert.match(text.stdout, /\n  evidence_schema: legacy \(report-only\) — legacy anchor/);
    const md = path.join(f.root, "summary.md");
    runCli(["governance-check", "--anchor-dir", f.dest, "--summary-md", md]);
    assert.match(readFileSync(md, "utf8"), /\| evidence_schema _\(report-only\)_ \| legacy \| /);
  } finally { cleanup(f); }
});

test("file names with :: or | are neutralised in text, json and summary markdown", () => {
  const f = mintedAnchor();
  try {
    writeFileSync(path.join(f.dest, "::error::a|b.txt"), "x");
    const leg = govJson(f.dest).verdict.runs[0].legs.evidence_schema;
    assert.equal(leg.status, "fail");
    assert.ok(!JSON.stringify(leg).includes("::error::"));
    assert.ok(leg.files[0].path.includes(": :error: :a|b.txt"));
    const text = runCli(["governance-check", "--anchor-dir", f.dest]);
    assert.ok(!text.stdout.includes("::error::"));
    const md = path.join(f.root, "summary.md");
    runCli(["governance-check", "--anchor-dir", f.dest, "--summary-md", md]);
    const row = readFileSync(md, "utf8").split("\n").filter((l) => l.startsWith("| evidence_schema"));
    assert.equal(row.length, 1);
    assert.ok(row[0].includes("a\\|b.txt"));
  } finally { cleanup(f); }
});

// FAFF-1347: evaluateRunDir carries a run-dir evidence_schema leg (report-only by default,
// gating under --require-evidence-schema). A run dir with no events.jsonl is vacuously clean.
test("run-dir results carry a report-only evidence_schema leg that renders", () => {
  const f = mintedAnchor();
  try {
    const liveDir = path.join(f.root, ".faff", "runs", "live");
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(path.join(liveDir, "run-ledger.json"), example("run-ledger"));
    const r = runCli(["governance-check", "--run-dir", liveDir, "--json"], { cwd: f.root });
    const leg = JSON.parse(r.stdout).runs[0].legs.evidence_schema;
    assert.ok(leg);
    assert.equal(leg.report_only, true);
    assert.equal(leg.status, "pass");
    assert.match(runCli(["governance-check", "--run-dir", liveDir], { cwd: f.root }).stdout, /evidence_schema/);
  } finally { cleanup(f); }
});

// --- Integration smoke -------------------------------------------------------------------------------

test("integration smoke: mint passes and validates; a verdict without schema_version is refused, --check agrees; the writer refuses a missing ac_id", () => {
  const f = fixture();
  const w = writerFixture();
  try {
    assert.equal(f.mint().code, 0);
    assert.equal(runCli(["evidence", "validate", f.dest, "--require-evidence-schema"]).code, 0);

    editJson(issueFile(f, "review-verdict.json"), (d) => { delete d.schema_version; return d; });
    const fresh = path.join(f.root, "out2", "dest2");
    const refused = runCli(["events", "anchor", "--run-dir", f.run, "--issue", "FAFF-1", "--dest", fresh], { cwd: f.root });
    assert.equal(refused.code, 3);
    assert.equal(existsSync(fresh), false);
    const before = snapshot(f.dest);
    const check = f.mint(["--check"]);
    assert.equal(check.code, 3);
    assert.deepEqual(snapshot(f.dest), before);

    assert.equal(w.write({ all_verified: true, criteria: [{ ac: "a", verified: "v", passed: true }] }).code, 1);
    assert.equal(existsSync(w.file), false);
    assert.equal(w.write({ all_verified: true, criteria: [{ ac: "a", verified: "v", passed: true, ac_id: "faff-1#ac-1" }] }).code, 0);
  } finally { cleanup(f, w); }
});
