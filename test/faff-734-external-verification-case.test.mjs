// FAFF-734 — focused tests for the Fly.io L3 FAFF-472 external-verification case.
//
// HERMETIC: the source capture (evidence/tampered-faff-runner-evidence/) is gitignored, so it is
// absent on CI and on any clean checkout. The tests are split in two:
//   - committed-case conformance tests read ONLY committed files and ALWAYS run (they are the bar
//     CI enforces);
//   - source-dependent tests re-curate from the ignored capture and SKIP (never fail) when it is
//     absent, so they still run on a dev machine that has the capture.
// Covers the DoD "Focused tests" list: deterministic curation (separate from validator
// observations), the full 33-file inventory, transcript exclusion, every forbidden class via
// injection fixtures, hash/source drift, traversal/symlink refusal, malformed machine JSONL
// (closed-schema fail-closed), the does-not-support derivation, the not-evaluated claim floors,
// the runner-checkout deviation, and accidental integrity-clean detection. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const CASE_REL = "verification/external-verification/results/2026-08-12-fly-l3-faff-472";
const CASE_ROOT = path.join(REPO, CASE_REL);
const TOOLS = path.join(CASE_ROOT, "tools");
const SOURCE_ROOT = path.join(REPO, "evidence/tampered-faff-runner-evidence");

const curator = await import(path.join(TOOLS, "curate.mjs"));
const validator = await import(path.join(TOOLS, "validate.mjs"));

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const loadReport = () => JSON.parse(fs.readFileSync(path.join(CASE_ROOT, "reports", "0001.json"), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

// Detect the ignored source capture once. When present (dev machine), refresh the committed
// artifacts from the current tools so the committed-case tests below run against fresh output;
// when absent (CI / clean checkout), the committed files on disk are the subject.
const SOURCE_PRESENT = fs.existsSync(SOURCE_ROOT);
const srcOnly = SOURCE_PRESENT ? {} : { skip: "source capture not present (dev-only test)" };
if (SOURCE_PRESENT) curator.curate();

// =============================================================================================
// Committed-case conformance tests — read only committed files; ALWAYS run (this is the CI bar).
// =============================================================================================

test("report loads: does-not-support derives from pass,pass,pass,fail,fail with first_failure null", () => {
  const r = loadReport();
  assert.deepEqual(r.criterion_outcomes.map((c) => c.outcome), ["pass", "pass", "pass", "fail", "fail"]);
  assert.equal(r.main_result, "does-not-support");
  assert.equal(r.evidence_complete, true);
  assert.equal(r.first_failure, null);
  assert.equal(r.experiment.synthetic, false);
  assert.equal(r.subjective_judgements.length, 0);
  assert.deepEqual(validator.validateReport(r, REPO), []);
});

test("all three claim assessments are not-evaluated with honest floor fields", () => {
  const ca = loadReport().claim_assessments;
  assert.equal(ca.reproducibility.result, "not-evaluated");
  assert.equal(ca.reproducibility.independent_operator, false);
  assert.equal(ca.repeatability.result, "not-evaluated");
  assert.equal(ca.repeatability.executions, 1);
  assert.equal(ca.generalisation.result, "not-evaluated");
  assert.deepEqual(ca.generalisation.axes, []);
});

test("the runner-checkout and retrospective-registration deviations are present, no fabricated commit", () => {
  const r = loadReport();
  const runner = r.deviations.find((d) => d.field === "revisions.superdomestique.commit");
  assert.ok(runner, "runner-checkout deviation present");
  assert.match(runner.description, /not asserted to be the runner's exact process checkout/);
  assert.equal(r.revisions.superdomestique.commit, "cd062ac5be5387ba073553dfccd868b3dda7554c");
  assert.ok(r.deviations.some((d) => d.field === "registered_at"), "retrospective-registration deviation present");
});

test("grounding cross-check: subject commit equals the published merge-record head_sha", () => {
  const r = loadReport();
  const mr = JSON.parse(fs.readFileSync(path.join(CASE_ROOT, "evidence", "FAFF-472", "merge-record.json"), "utf8"));
  assert.equal(r.revisions.subject.commit, mr.head_sha);
  const bad = clone(r);
  bad.revisions.subject.commit = "0000000000000000000000000000000000000000";
  assert.ok(validator.validateCaseSpecific(bad, REPO).some((e) => e.startsWith("GROUNDING_SUBJECT_COMMIT")));
});

test("accidental integrity-clean is caught: OC-4 records tampered, never a clean re-verify", () => {
  const r = loadReport();
  const oc4 = r.objective_checks.find((c) => c.id === "OC-4");
  assert.equal(oc4.verdict, "fail");
  assert.match(oc4.observed, /tampered/);
  assert.match(oc4.observed, /run-ledger\.json/);
  const clean = clone(r);
  const c = clean.objective_checks.find((x) => x.id === "OC-4");
  c.verdict = "pass";
  c.observed = "custody clean; no mismatch";
  assert.ok(validator.validateCaseSpecific(clean, REPO).some((e) => e.startsWith("OC4_NOT_TAMPERED")));
});

test("OC-5 records verified-fail / node-test", () => {
  const oc5 = loadReport().objective_checks.find((c) => c.id === "OC-5");
  assert.equal(oc5.verdict, "fail");
  assert.match(oc5.observed, /verified-fail/);
});

test("run-ledger.json preserves level:L3 — the tamper is never repaired", () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(CASE_ROOT, "evidence", "run-ledger.json"), "utf8"));
  assert.equal(ledger.level, "L3");
  assert.deepEqual(Object.keys(ledger).sort(), ["admitted", "level", "outcomes", "run_id", "stop_reason"]);
});

test("committed manifest inventories 33 source files exactly once (9 members, 24 omissions)", () => {
  const m = JSON.parse(fs.readFileSync(path.join(CASE_ROOT, "evidence", "manifest.json"), "utf8"));
  assert.equal(m.source_file_count, 33);
  assert.equal(m.member_count, 9);
  assert.equal(m.omission_count, 24);
  assert.equal(m.members.length + m.omissions.length, 33);
  const paths = new Set([...m.members.map((x) => x.source_path), ...m.omissions.map((x) => x.source_path)]);
  assert.equal(paths.size, 33, "every source_path appears exactly once");
  for (const o of m.omissions) assert.ok(["duplicate", "ephemeral", "private-risk", "not-needed-for-bounded-claim"].includes(o.reason), o.reason);
});

test("every committed evidence reference's SHA-256 recomputes from committed bytes", () => {
  const r = loadReport();
  const refs = [
    ...r.inputs, ...r.outputs,
    ...r.objective_checks.flatMap((c) => c.evidence),
  ].filter((e) => e.path && e.sha256);
  assert.ok(refs.length >= 10, "expected the protocol, manifest, and evidence references");
  for (const e of refs) {
    const real = sha256(fs.readFileSync(path.join(REPO, e.path)));
    assert.equal(e.sha256, real, `digest drift for ${e.path}`);
  }
});

test("committed manifest published hashes recompute from committed evidence bytes", () => {
  const m = JSON.parse(fs.readFileSync(path.join(CASE_ROOT, "evidence", "manifest.json"), "utf8"));
  for (const member of m.members) {
    const pubRel = member.published_path.replace(CASE_REL + "/", "");
    const real = sha256(fs.readFileSync(path.join(CASE_ROOT, pubRel)));
    assert.equal(member.published_sha256, real, `published hash drift for ${pubRel}`);
  }
});

test("committed case tree contains no forbidden content, and no transcript filename under results/", () => {
  assert.deepEqual(curator.scanTree(path.join(CASE_ROOT, "evidence")), []);
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) { walk(abs); continue; }
      const text = fs.readFileSync(abs, "utf8");
      const errs = [];
      curator.scanText(text, path.relative(CASE_ROOT, abs), errs);
      assert.deepEqual(errs, [], `forbidden content in ${abs}: ${errs.join(" | ")}`);
      assert.doesNotMatch(text, /transcript-run-\d{8}-\d{6}/, `transcript filename leaked in ${abs}`);
    }
  };
  walk(CASE_ROOT);
});

test("validation.json records the four validator observations over the source, including the expected negative", () => {
  const v = JSON.parse(fs.readFileSync(path.join(CASE_ROOT, "evidence", "validation.json"), "utf8"));
  const names = v.observations.map((o) => o.name);
  assert.deepEqual(names.sort(), ["events-validate", "governance-check", "integrity-digest-verify", "runcheck"]);
  for (const o of v.observations) {
    assert.ok(Array.isArray(o.args), "argument array recorded");
    assert.match(o.tool_commit, /^[0-9a-f]{40}$/, "full tool commit recorded");
    assert.ok(Array.isArray(o.input_members) && o.input_members.length >= 1, "input member hashes recorded");
    assert.ok("exit_code" in o && "result" in o, "exit code and normalised result recorded");
  }
  const custody = v.observations.find((o) => o.name === "integrity-digest-verify");
  assert.equal(custody.result.verdict, "tampered");
  assert.deepEqual(custody.result.mismatches, ["run-ledger.json"]);
  assert.deepEqual(custody.result.clean_members, ["events.jsonl"]);
  assert.equal(custody.expected_negative, true);
});

test("report path containment: absolute and repository-escaping evidence paths fail closed", () => {
  const abs = clone(loadReport());
  abs.inputs[0].path = "/etc/passwd";
  assert.ok(validator.validateReport(abs, REPO).some((e) => e.startsWith("PATH_ABSOLUTE")));
  const esc = clone(loadReport());
  esc.inputs[0].path = "../../../etc/passwd";
  assert.ok(validator.validateReport(esc, REPO).some((e) => e.startsWith("PATH_ESCAPE")));
});

test("hash-drift detector: a corrupted evidence sha is rejected", () => {
  const bad = clone(loadReport());
  bad.outputs[0].sha256 = "f".repeat(64);
  assert.ok(validator.validateReport(bad, REPO).some((e) => e.startsWith("DIGEST_EVIDENCE_MISMATCH")));
});

test("the whole committed case validates end-to-end (subset validator + semantic + cross-surface + grounding)", () => {
  assert.deepEqual(validator.validateCase(), []);
});

// --- pure-logic tests: no source, no committed-file coupling; ALWAYS run ----------------------

test("forbidden-class scanner flags every category via injection fixtures", () => {
  const cases = [
    ["PRIVATE_PATH_POSIX", "path is /home/faff/app/.faff/runs"],
    ["SESSION_UUID", "session c7220352-77f5-41e4-a43c-583806525328 recorded"],
    ["TRANSCRIPT_FILENAME", "see transcript-run-20260812-153033-fly-l3.jsonl"],
    ["MEASURE_ROOT_KEY", '"measure_root": "/x"'],
    ["SECRET_PREFIX", "token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"],
    ["PEM_PRIVATE_KEY", "-----BEGIN OPENSSH PRIVATE KEY-----"],
    ["AUTH_HEADER", "Authorization: Bearer abc.def"],
    ["CREDENTIAL_URL", "https://user:s3cr3t@example.com/x"],
  ];
  for (const [id, text] of cases) {
    const errs = [];
    curator.scanText(text, "fixture", errs);
    assert.ok(errs.some((e) => e.startsWith(id)), `expected ${id}, got: ${errs.join(" | ")}`);
  }
  const clean = [];
  curator.scanText("head fb5e4327b34aaed81b9c3775e41289c41544dab2 diff " + "a".repeat(64), "clean", clean);
  assert.deepEqual(clean, []);
});

test("closed-schema builders fail closed on malformed machine records", () => {
  assert.throws(() => curator.BUILD.events([{ seq: 0, phase: "run", type: "not-a-type" }]), /CONSTRUCT_INVALID: events\.type/);
  assert.throws(() => curator.BUILD.events([{ seq: 0, phase: "cosmos", type: "run-end" }]), /CONSTRUCT_INVALID: events\.phase/);
  assert.throws(() => curator.BUILD.events([{ phase: "run", type: "run-end" }]), /CONSTRUCT_MISSING: events\.seq/);
  assert.throws(() => curator.BUILD.declaredEffects([{ seq: 0, kind_of_entry: "declare", step: "merge", effect: { kind: "wipe-main", reversible: true } }]), /CONSTRUCT_INVALID: declared-effects\.effect\.kind/);
  assert.throws(() => curator.BUILD.runLedger({ run_id: "run-20260812-153248-x", level: "L4", admitted: [], outcomes: {}, stop_reason: "x" }), /CONSTRUCT_INVALID: run-ledger\.level/);
  assert.throws(() => curator.BUILD.mergeRecord({ pr: 1, head_sha: "tooshort", merged: true, integrity: "unasserted", harness: "claude-code", model: "unknown" }), /CONSTRUCT_INVALID: merge-record\.head_sha/);
});

test("inventory refuses a symlink component in a tree (traversal/symlink refusal)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "faff-734-sym-"));
  try {
    fs.writeFileSync(path.join(root, "real.json"), "{}");
    fs.symlinkSync(path.join(root, "real.json"), path.join(root, "link.json"));
    assert.throws(() => curator.inventory(root), /SOURCE_SYMLINK/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("assertSafeRoot rejects a root outside the repository", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "faff-734-out-"));
  try {
    assert.throws(() => curator.assertSafeRoot(outside), /ROOT_ESCAPE/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// =============================================================================================
// Source-dependent tests — re-curate from the ignored capture; SKIP on a clean checkout / CI.
// =============================================================================================

test("curation is deterministic across two runs (evidence, manifest, report, README byte-identical; validation.json excluded)", srcOnly, () => {
  const collect = () => {
    const files = {};
    const walk = (dir, base) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const abs = path.join(dir, name);
        if (fs.statSync(abs).isDirectory()) walk(abs, path.join(base, name));
        else files[path.join(base, name).split(path.sep).join("/")] = sha256(fs.readFileSync(abs));
      }
    };
    walk(path.join(CASE_ROOT, "evidence"), "evidence");
    files["reports/0001.json"] = sha256(fs.readFileSync(path.join(CASE_ROOT, "reports", "0001.json")));
    files["README.md"] = sha256(fs.readFileSync(path.join(CASE_ROOT, "README.md")));
    delete files["evidence/validation.json"]; // pinned observations, excluded from the reproducibility diff
    return files;
  };
  curator.curate();
  const a = collect();
  curator.curate();
  const b = collect();
  assert.deepEqual(a, b);
});

test("full 33-file inventory: each SOURCE file is classified exactly once as member or omission", srcOnly, () => {
  const inv = curator.inventory(SOURCE_ROOT);
  assert.equal(inv.length, 33);
  let members = 0, omissions = 0;
  for (const rel of inv) {
    const m = curator.isMember(rel), o = curator.isOmission(rel);
    assert.ok(m !== o, `expected exactly one classification for ${rel} (member=${m} omission=${o})`);
    if (m) members++; else omissions++;
  }
  assert.equal(members, 9);
  assert.equal(omissions, 24);
});

test("manifest source hashes match the real source bytes (source-drift detector)", srcOnly, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(CASE_ROOT, "evidence", "manifest.json"), "utf8"));
  for (const m of manifest.members) {
    const rel = m.source_path.replace("evidence/tampered-faff-runner-evidence/", "");
    const real = sha256(fs.readFileSync(path.join(SOURCE_ROOT, rel)));
    assert.equal(m.source_sha256, real, `source hash drift for ${rel}`);
  }
});

test("transcript exclusion in the SOURCE inventory: transcripts are private-risk omissions, never members", srcOnly, () => {
  const inv = curator.inventory(SOURCE_ROOT);
  const transcripts = inv.filter((rel) => curator.TRANSCRIPT_RE.test(rel));
  assert.ok(transcripts.length >= 2, "expected the two source transcripts");
  for (const rel of transcripts) {
    assert.ok(!curator.isMember(rel), `transcript must never be a member: ${rel}`);
    assert.equal(curator.omissionReason(rel), "private-risk");
  }
});
