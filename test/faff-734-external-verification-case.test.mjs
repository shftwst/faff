// FAFF-734 — focused tests for the Fly.io L3 FAFF-472 external-verification case.
//
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

// Curate once up front so on-disk artifacts reflect the current tools; used by many tests.
curator.curate();

// ---------------------------------------------------------------------------------------------
test("curation is deterministic: evidence, manifest, report, README are byte-identical across two runs (validation.json excluded)", () => {
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

test("full 33-file inventory: each source file is classified exactly once as member or omission", () => {
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
  const manifest = JSON.parse(fs.readFileSync(path.join(CASE_ROOT, "evidence", "manifest.json"), "utf8"));
  assert.equal(manifest.source_file_count, 33);
  assert.equal(manifest.member_count, 9);
  assert.equal(manifest.omission_count, 24);
  assert.equal(manifest.members.length + manifest.omissions.length, 33);
});

test("manifest source hashes match the real source bytes (source-drift detector)", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(CASE_ROOT, "evidence", "manifest.json"), "utf8"));
  for (const m of manifest.members) {
    const rel = m.source_path.replace("evidence/tampered-faff-runner-evidence/", "");
    const real = sha256(fs.readFileSync(path.join(SOURCE_ROOT, rel)));
    assert.equal(m.source_sha256, real, `source hash drift for ${rel}`);
    const pubRel = m.published_path.replace(CASE_REL + "/", "");
    const realPub = sha256(fs.readFileSync(path.join(CASE_ROOT, pubRel)));
    assert.equal(m.published_sha256, realPub, `published hash drift for ${pubRel}`);
  }
});

test("transcript exclusion: no transcript member, no transcript byte or filename under results/", () => {
  const inv = curator.inventory(SOURCE_ROOT);
  const transcripts = inv.filter((rel) => curator.TRANSCRIPT_RE.test(rel));
  assert.ok(transcripts.length >= 2, "expected the two source transcripts");
  for (const rel of transcripts) assert.ok(!curator.isMember(rel), `transcript must never be a member: ${rel}`);
  // whole committed case must not contain the timestamped transcript filename
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else {
        const text = fs.readFileSync(abs, "utf8");
        assert.doesNotMatch(text, /transcript-run-\d{8}-\d{6}/, `transcript filename leaked in ${abs}`);
      }
    }
  };
  walk(CASE_ROOT);
});

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
  // a benign string with only 40/64-hex digests must NOT trip any rule
  const clean = [];
  curator.scanText("head fb5e4327b34aaed81b9c3775e41289c41544dab2 diff " + "a".repeat(64), "clean", clean);
  assert.deepEqual(clean, []);
});

test("the committed case tree contains no forbidden content", () => {
  assert.deepEqual(curator.scanTree(path.join(CASE_ROOT, "evidence")), []);
  for (const rel of ["reports/0001.json", "README.md"]) {
    const errs = [];
    curator.scanText(fs.readFileSync(path.join(CASE_ROOT, rel), "utf8"), rel, errs);
    assert.deepEqual(errs, []);
  }
});

test("inventory refuses a symlink component in the source tree (traversal/symlink refusal)", () => {
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

test("report path containment: absolute and repository-escaping evidence paths fail closed", () => {
  const abs = clone(loadReport());
  abs.inputs[0].path = "/etc/passwd";
  assert.ok(validator.validateReport(abs, REPO).some((e) => e.startsWith("PATH_ABSOLUTE")));
  const esc = clone(loadReport());
  esc.inputs[0].path = "../../../etc/passwd";
  assert.ok(validator.validateReport(esc, REPO).some((e) => e.startsWith("PATH_ESCAPE")));
});

test("closed-schema builders fail closed on malformed machine records", () => {
  assert.throws(() => curator.BUILD.events([{ seq: 0, phase: "run", type: "not-a-type" }]), /CONSTRUCT_INVALID: events\.type/);
  assert.throws(() => curator.BUILD.events([{ seq: 0, phase: "cosmos", type: "run-end" }]), /CONSTRUCT_INVALID: events\.phase/);
  assert.throws(() => curator.BUILD.events([{ phase: "run", type: "run-end" }]), /CONSTRUCT_MISSING: events\.seq/);
  assert.throws(() => curator.BUILD.declaredEffects([{ seq: 0, kind_of_entry: "declare", step: "merge", effect: { kind: "wipe-main", reversible: true } }]), /CONSTRUCT_INVALID: declared-effects\.effect\.kind/);
  assert.throws(() => curator.BUILD.runLedger({ run_id: "run-20260812-153248-x", level: "L4", admitted: [], outcomes: {}, stop_reason: "x" }), /CONSTRUCT_INVALID: run-ledger\.level/);
  assert.throws(() => curator.BUILD.mergeRecord({ pr: 1, head_sha: "tooshort", merged: true, integrity: "unasserted", harness: "claude-code", model: "unknown" }), /CONSTRUCT_INVALID: merge-record\.head_sha/);
});

test("run-ledger.json preserves level:L3 — the tamper is never repaired", () => {
  const ledger = JSON.parse(fs.readFileSync(path.join(CASE_ROOT, "evidence", "run-ledger.json"), "utf8"));
  assert.equal(ledger.level, "L3");
  assert.deepEqual(Object.keys(ledger).sort(), ["admitted", "level", "outcomes", "run_id", "stop_reason"]);
});

test("does-not-support derivation from pass,pass,pass,fail,fail with first_failure null", () => {
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
  // a mistyped provenance sha must fail the case-specific grounding check
  const bad = clone(r);
  bad.revisions.subject.commit = "0000000000000000000000000000000000000000";
  assert.ok(validator.validateCaseSpecific(bad, REPO).some((e) => e.startsWith("GROUNDING_SUBJECT_COMMIT")));
});

test("accidental integrity-clean is caught: OC-4 must record tampered, never a clean re-verify", () => {
  const r = loadReport();
  const oc4 = r.objective_checks.find((c) => c.id === "OC-4");
  assert.equal(oc4.verdict, "fail");
  assert.match(oc4.observed, /tampered/);
  assert.match(oc4.observed, /run-ledger\.json/);
  // if a future edit relabelled OC-4 clean/pass, the case validator rejects it
  const clean = clone(r);
  const c = clean.objective_checks.find((x) => x.id === "OC-4");
  c.verdict = "pass";
  c.observed = "custody clean; no mismatch";
  assert.ok(validator.validateCaseSpecific(clean, REPO).some((e) => e.startsWith("OC4_NOT_TAMPERED")));
});

test("hash-drift detector: a corrupted evidence sha is rejected", () => {
  const bad = clone(loadReport());
  bad.outputs[0].sha256 = "f".repeat(64);
  assert.ok(validator.validateReport(bad, REPO).some((e) => e.startsWith("DIGEST_EVIDENCE_MISMATCH")));
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

test("the whole case validates end-to-end (subset validator + semantic + cross-surface + grounding)", () => {
  assert.deepEqual(validator.validateCase(), []);
});
