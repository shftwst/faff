// FAFF-1342: holdout.json can carry an optional delegated[] list.
//
// ac-1 and ac-6 pin the two schema copies, the docs and the changelog. ac-2 and ac-3 run the
// classifier and the FAFF-1278 base-commit leg (the real `run:` bodies of the governance-check
// Action) against a base commit that still carries the OLD holdout-anchored schema. ac-4 validates
// the example and four malformed rows. ac-5 compares the four holdout anchors committed before delegated[] under the
// old and the new schema. The leg helpers are the FAFF-1278 test's, which exports none.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { mkChainedRun, writeEvidence, repoRoot } from "./helpers/evidence-anchor-fixtures.mjs";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const evidence = require("../plugin/skills/faff/bin/lib/evidence.js");
const PLUGIN = "plugin/skills/faff";
const ANCHORS = ".faff/anchors";
const SCHEMA_REL = "schema/holdout-anchored.schema.json";
const COPIES = ["verification/evidence/v0.3", `${PLUGIN}/contracts/evidence-v0.3`];
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));
const newSchema = readJson(`${COPIES[0]}/${SCHEMA_REL}`);
const example = () => readJson(`${COPIES[1]}/schema/examples/holdout-anchored.example.json`);

const TMP = mkdtempSync(path.join(tmpdir(), "faff-1342-"));
process.on("exit", () => rmSync(TMP, { recursive: true, force: true }));

// The holdout-anchored schema before this change: the new schema without `delegated`. Built from the
// working tree, not from git, so the file loads on a shallow detached CI checkout and keeps meaning
// "the schema before FAFF-1342" after this change is on main.
const OLD_SCHEMA = structuredClone(newSchema);
delete OLD_SCHEMA.properties.delegated;
const OLD_TEXT = JSON.stringify(OLD_SCHEMA, null, 2) + "\n";

// --- ac-1 -----------------------------------------------------------------------------------------

test("ac-1: both schema copies are byte-identical and gain the optional closed delegated array; required is unchanged", () => {
  assert.equal(read(`${COPIES[0]}/${SCHEMA_REL}`), read(`${COPIES[1]}/${SCHEMA_REL}`));
  assert.ok(!newSchema.required.includes("delegated"));
  assert.deepEqual(newSchema.required, OLD_SCHEMA.required);
  assert.deepEqual(newSchema.properties.schema_version.enum, [1]);
  const row = newSchema.properties.delegated.items;
  assert.equal(newSchema.properties.delegated.type, "array");
  assert.equal(row.additionalProperties, false);
  assert.deepEqual(row.required, ["id", "text", "holdout", "verification_tier", "verifier", "ac_id"]);
  assert.deepEqual(Object.keys(row.properties), row.required);
  assert.deepEqual(row.properties.verification_tier.enum, ["delegated", "integration"]);
  assert.deepEqual(row.properties.verifier.enum, ["ac-checklist", "review-merge-floor"]);
  assert.deepEqual(row.properties.ac_id.type, ["string", "null"]);
  assert.equal(row.properties.id.pattern, "^(scenarios|done):[1-9][0-9]*$");
});

// --- ac-2 -----------------------------------------------------------------------------------------

test("ac-2: classifySchemaChange over the old and new holdout-anchored schema is additive", () => {
  const verdict = evidence.classifySchemaChange(OLD_SCHEMA, newSchema);
  assert.equal(verdict.additive, true, JSON.stringify(verdict.reasons));
});

// A bundle dir (anchor manifest plus schemas) whose holdout schema is the old one.
function oldBundle() {
  const dir = path.join(TMP, "old-bundle");
  cpSync(path.join(repoRoot, PLUGIN, "contracts/evidence-v0.3"), dir, { recursive: true });
  writeFileSync(path.join(dir, SCHEMA_REL), OLD_TEXT);
  return dir;
}

const holdoutWithDelegated = () => example();
function anchorWith(holdout) {
  const root = mkdtempSync(path.join(TMP, "anchor-"));
  const run = mkChainedRun(root);
  writeEvidence(run, "v03");
  writeFileSync(path.join(run, "FAFF-1", "ac-checklist.json"), JSON.stringify({
    schema_version: 1, all_verified: true, criteria: [{ ac: "a", verified: "Verified: test", passed: true }],
  }));
  const dest = path.join(root, "anchor");
  const r = runCli(["events", "anchor", "--run-dir", run, "--issue", "FAFF-1", "--dest", dest]);
  assert.equal(r.code, 0, r.stderr);
  if (holdout) writeFileSync(path.join(dest, "holdout.json"), JSON.stringify(holdout));
  return dest;
}

test("ac-2: validate --candidate-schemas with the new schema accepts an anchor whose holdout.json carries delegated; the old schema rejects it", () => {
  const anchor = anchorWith(holdoutWithDelegated());
  const candidate = path.join(repoRoot, PLUGIN, "contracts/evidence-v0.3");
  // The validating CLI is the one on this branch; point its bundle at the old schema through the
  // library, and the candidate dir at the new one through the real flag.
  const old = evidence.validateAnchorDir(anchor, { bundleDir: oldBundle() });
  const holdoutOld = old.files.find((f) => f.path === "holdout.json");
  assert.equal(holdoutOld.status, "fail", JSON.stringify(holdoutOld));
  assert.ok(holdoutOld.violations.some((v) => /delegated/.test(JSON.stringify(v))), JSON.stringify(holdoutOld));
  const withCandidate = evidence.validateAnchorDir(anchor, { bundleDir: oldBundle(), candidateDir: candidate });
  assert.deepEqual(withCandidate.candidate_rejected, []);
  assert.equal(withCandidate.files.find((f) => f.path === "holdout.json").status, "ok");
  const cli = runCli(["evidence", "validate", anchor, "--candidate-schemas", candidate, "--json"]);
  assert.equal(JSON.parse(cli.stdout).files.find((f) => f.path === "holdout.json").status, "ok", cli.stdout + cli.stderr);
});

// --- ac-3: the FAFF-1278 base-commit leg, with the OLD schema at the base commit -----------------

function git(dir, args, opts = {}) {
  const r = spawnSync("git", ["-C", dir, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", ...opts });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r;
}
function commitAll(dir, message) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]).stdout.trim();
}

const actionText = read(".github/actions/governance-check/action.yml");
function runBody(id) {
  const lines = actionText.split("\n");
  const at = lines.findIndex((l) => l === `      id: ${id}`);
  assert.ok(at >= 0, `step ${id} exists`);
  const runAt = lines.findIndex((l, i) => i > at && l === "      run: |");
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() !== "" && !l.startsWith("        ")) break;
    body.push(l.slice(8));
  }
  return body.join("\n") + "\n";
}
function parseOutputs(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)=(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}
function runStep(id, { cwd, env, temp }) {
  const scratch = mkdtempSync(path.join(TMP, `${id}-`));
  const outputFile = path.join(scratch, "output");
  const summaryFile = path.join(scratch, "summary.md");
  writeFileSync(outputFile, "");
  writeFileSync(summaryFile, "");
  const script = path.join(scratch, "step.sh");
  writeFileSync(script, runBody(id));
  const r = spawnSync("bash", ["-e", script], {
    cwd, encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_WORKSPACE: cwd, RUNNER_TEMP: temp, GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile, ...env },
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, outputs: parseOutputs(readFileSync(outputFile, "utf8")), summary: readFileSync(summaryFile, "utf8") };
}
function runLeg(repo, { base, head, mode }) {
  const temp = mkdtempSync(path.join(TMP, "runner-temp-"));
  const shas = { BASE_SHA: base, HEAD_SHA: head };
  const touched = runStep("anchors-touched", { cwd: repo, temp, env: { ANCHORS_PATH: ANCHORS, ...shas } });
  assert.equal(touched.outputs.touched, "true");
  const resolve = runStep("resolve-trusted-cli", { cwd: repo, temp, env: { IN_CHECKOUT: "true", PINNED_BIN: "", BASE_SHA: base } });
  const leg = runStep("evidence-schema-base", {
    cwd: repo, temp,
    env: {
      MODE: mode, TOUCHED: "true", UNAVAILABLE: resolve.outputs.unavailable ?? "", TRUSTED: resolve.outputs.trusted ?? "",
      CANDIDATE: resolve.outputs.candidate ?? "", HOLDOUT_BINDING: resolve.outputs["holdout-binding"] ?? "",
      ANCHORS_PATH: ANCHORS, ...shas,
    },
  });
  return { resolve, base: leg, log: leg.stdout + leg.stderr + resolve.stdout + resolve.stderr };
}

// A repo whose base commit carries this branch's CLI but the OLD holdout schema (as origin/main has),
// and whose head commit adds a conforming anchor with the given holdout.json. `headSchema` says
// whether the head also carries the new schema in both copies.
function scenario(holdout, { headSchema }) {
  const dir = path.join(TMP, `leg-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "t@example.com"]);
  git(dir, ["config", "user.name", "T"]);
  writeFileSync(path.join(dir, "README.md"), "fixture\n");
  const files = spawnSync("git", ["-C", repoRoot, "ls-files", "--", PLUGIN], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  for (const rel of files) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    cpSync(path.join(repoRoot, rel), path.join(dir, rel));
  }
  const schemaAt = (root) => path.join(dir, root, SCHEMA_REL);
  mkdirSync(path.dirname(schemaAt(COPIES[0])), { recursive: true });
  for (const root of COPIES) writeFileSync(schemaAt(root), OLD_TEXT);
  const base = commitAll(dir, "base (old holdout schema)");
  if (headSchema) for (const root of COPIES) writeFileSync(schemaAt(root), read(`${root}/${SCHEMA_REL}`));
  const dest = path.join(dir, ANCHORS, "run-x/FAFF-1");
  cpSync(anchorWith(holdout), dest, { recursive: true });
  return { dir, base, head: commitAll(dir, "head") };
}

test("ac-3: the base-commit leg passes for an anchor whose holdout.json carries delegated when the head carries the new schema", () => {
  const s = scenario(holdoutWithDelegated(), { headSchema: true });
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  assert.equal(r.base.code, 0, r.log);
  assert.equal(r.base.outputs.verdict, "pass");
  assert.match(r.base.summary, /\| ok \| pass \| - \| accepted \|/);
});

test("ac-3: without the head schema change the same anchor fails the leg (the test discriminates)", () => {
  const s = scenario(holdoutWithDelegated(), { headSchema: false });
  const r = runLeg(s.dir, { base: s.base, head: s.head, mode: "require" });
  assert.equal(r.base.code, 1, r.log);
  assert.equal(r.base.outputs.verdict, "fail");
});

// --- ac-4 -----------------------------------------------------------------------------------------

const check = (doc) => evidence.validateEvidenceDocument("holdout.json", doc);
const withRow = (patch) => ({ ...example(), delegated: [{ ...example().delegated[0], ...patch }] });

test("ac-4: both example copies carry a delegated row and validate against the new schema", () => {
  const a = readJson(`${COPIES[0]}/schema/examples/holdout-anchored.example.json`);
  const b = readJson(`${COPIES[1]}/schema/examples/holdout-anchored.example.json`);
  assert.deepEqual(a, b);
  assert.equal(a.delegated.length, 1);
  assert.deepEqual(check(a), { ok: true, violations: [] });
  assert.deepEqual(check({ ...a, delegated: [] }), { ok: true, violations: [] });
  const without = { ...a }; delete without.delegated;
  assert.equal(check(without).ok, true, "an anchor without delegated still validates");
  assert.equal(check({ ...a, delegated: [{ ...a.delegated[0], ac_id: null, id: "scenarios:2" }] }).ok, true);
});

test("ac-4: a delegated row with an extra key, a wrong tier, a wrong verifier or a malformed id fails", () => {
  const bad = {
    "extra key": withRow({ extra: 1 }),
    "wrong tier": withRow({ verification_tier: "holdout" }),
    "wrong verifier": withRow({ verifier: "human" }),
    "malformed id (source)": withRow({ id: "criteria:1" }),
    "malformed id (zero index)": withRow({ id: "done:0" }),
    "malformed id (no index)": withRow({ id: "done" }),
    "missing key": (() => { const d = withRow({}); delete d.delegated[0].verifier; return d; })(),
    "non-string ac_id": withRow({ ac_id: 3 }),
  };
  for (const [name, doc] of Object.entries(bad)) assert.equal(check(doc).ok, false, name);
  assert.equal(check({ ...example(), unknown_top: 1 }).ok, false, "the top level stays closed");
});

// --- ac-5 -----------------------------------------------------------------------------------------

test("ac-5: the four holdout anchors committed before delegated[] give the same evidence validate result under the old and new schema", () => {
  const preDelegated = ["FAFF-1197", "FAFF-1198", "FAFF-1201", "FAFF-1279"];
  const anchors = readdirSync(path.join(repoRoot, ANCHORS)).map((run) => path.join(ANCHORS, run))
    .flatMap((runDir) => readdirSync(path.join(repoRoot, runDir)).map((issue) => path.join(runDir, issue)))
    .filter((dir) => preDelegated.includes(path.basename(dir)))
    .filter((dir) => { try { readFileSync(path.join(repoRoot, dir, "holdout.json")); return true; } catch { return false; } });
  assert.deepEqual(anchors.map((d) => path.basename(d)).sort(), preDelegated);
  const bundle = oldBundle();
  for (const dir of anchors) {
    const before = evidence.validateAnchorDir(path.join(repoRoot, dir), { bundleDir: bundle });
    const after = evidence.validateAnchorDir(path.join(repoRoot, dir));
    assert.deepEqual(after, before, dir);
  }
  const statuses = Object.fromEntries(anchors.map((d) => [path.basename(d), evidence.validateAnchorDir(path.join(repoRoot, d)).status]));
  assert.deepEqual(statuses, { "FAFF-1197": "legacy", "FAFF-1198": "legacy", "FAFF-1201": "legacy", "FAFF-1279": "pass" });
});

// --- ac-6 -----------------------------------------------------------------------------------------

test("ac-6: both evidence-documents.md copies are byte-identical and document delegated[]; the README has a dated changelog entry", () => {
  const docs = read(`${COPIES[0]}/evidence-documents.md`);
  assert.equal(docs, read(`${COPIES[1]}/evidence-documents.md`));
  assert.match(docs, /`delegated\[\]`/);
  for (const key of ["id", "text", "holdout", "verification_tier", "verifier", "ac_id"]) assert.ok(docs.includes(`| \`${key}\` |`), key);
  assert.match(docs, /faff dod classify/);
  assert.match(docs, /still\s+validates/);
  const readme = read("verification/evidence/README.md");
  const entry = readme.split("\n- ").find((e) => e.startsWith("**v0.3 — 2026-10-18"));
  assert.ok(entry, "dated v0.3 changelog entry");
  for (const needle of ["FAFF-1342", "FAFF-1291", "`delegated`"]) assert.ok(entry.includes(needle), needle);
});
