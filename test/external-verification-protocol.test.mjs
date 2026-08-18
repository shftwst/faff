// FAFF-743 — the drift alarm for the v0.1 external-verification protocol.
//
// It implements PROCEDURE VALIDATE_PROTOCOL from the spec: the shared subset validator
// (plugin/skills/faff/contracts/validate-schema.mjs) is reused AS A SUBPROCESS for structural
// validation of the (schema, example) pair and the structural negatives, then every richer rule
// the subset validator cannot express is enforced in process against the parsed fixtures. No
// network request is made; recorded evidence URLs are never fetched (checkEvidencePath is only
// ever called with local paths, never URLs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const VALIDATOR = path.join(REPO, "plugin", "skills", "faff", "contracts", "validate-schema.mjs");
const PROT = path.join(REPO, "verification", "external-verification", "protocol", "v0.1");
const SCHEMA = path.join(PROT, "schema", "experiment-report.schema.json");
const EX = path.join(PROT, "schema", "examples");
const NEG = path.join(EX, "negative");
const SEQ = path.join(EX, "publication-sequences");

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function runValidator(dataPath) {
  return spawnSync(process.execPath, [VALIDATOR, dataPath, SCHEMA], { encoding: "utf8" });
}

// --- component-wise symlink rejection (lstat) then realpath containment, before any hash read ---
function checkEvidencePath(repoRoot, rel) {
  const errs = [];
  if (path.isAbsolute(rel)) return ["PATH_ABSOLUTE: " + rel];
  const parts = rel.split("/").filter(Boolean);
  if (parts.includes("..")) return ["PATH_ESCAPE: " + rel];
  let cur = repoRoot;
  for (const part of parts) {
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch { return ["PATH_MISSING: " + rel]; }
    if (st.isSymbolicLink()) return ["PATH_SYMLINK: " + rel];
  }
  let real;
  try { real = fs.realpathSync(path.join(repoRoot, rel)); } catch { return ["PATH_MISSING: " + rel]; }
  const realRoot = fs.realpathSync(repoRoot);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) errs.push("PATH_ESCAPE: " + rel);
  return errs;
}

const SC_RE = /^SC-\d+$/;
const OC_RE = /^OC-\d+$/;
const SJ_RE = /^SJ-\d+$/;
const HEX40 = /^[0-9a-f]{40}$/;

function deriveResult(r) {
  const outcomes = r.criterion_outcomes.map((c) => c.outcome);
  if (!r.evidence_complete || outcomes.includes("unresolved")) return "inconclusive";
  if (outcomes.includes("fail")) return "does-not-support";
  return "supports-hypothesis";
}

// The full in-process semantic validator. Returns coded error strings (empty = valid).
function validateReport(r, repoRoot) {
  const errs = [];
  const dup = (ids, code) => {
    const seen = new Set();
    for (const id of ids) { if (seen.has(id)) errs.push(`${code}: ${id}`); seen.add(id); }
  };

  // 3a. ID patterns + uniqueness
  for (const s of r.success_criteria) if (!SC_RE.test(s.id)) errs.push("ID_PATTERN: " + s.id);
  for (const c of r.objective_checks) if (!OC_RE.test(c.id)) errs.push("ID_PATTERN: " + c.id);
  for (const j of r.subjective_judgements) if (!SJ_RE.test(j.id)) errs.push("ID_PATTERN: " + j.id);
  dup(r.success_criteria.map((s) => s.id), "ID_DUPLICATE");
  dup(r.objective_checks.map((c) => c.id), "ID_DUPLICATE");
  dup(r.subjective_judgements.map((j) => j.id), "ID_DUPLICATE");

  // 3b. exactly-once criterion resolution
  const declared = new Set(r.success_criteria.map((s) => s.id));
  const critById = new Map(r.success_criteria.map((s) => [s.id, s]));
  const counts = new Map();
  for (const o of r.criterion_outcomes) {
    if (!declared.has(o.criterion_id)) errs.push("CRIT_UNDECLARED_OUTCOME: " + o.criterion_id);
    counts.set(o.criterion_id, (counts.get(o.criterion_id) || 0) + 1);
  }
  for (const id of declared) {
    const n = counts.get(id) || 0;
    if (n === 0) errs.push("CRIT_MISSING_OUTCOME: " + id);
    if (n > 1) errs.push("CRIT_DUP_OUTCOME: " + id);
  }

  // 3c. deciding-record resolution + agreement + judgement predeclaration + unresolved_reason
  for (const o of r.criterion_outcomes) {
    if (o.outcome === "unresolved") {
      if (typeof o.unresolved_reason !== "string" || o.unresolved_reason.trim() === "")
        errs.push("UNRESOLVED_REASON_MISSING: " + o.criterion_id);
    } else if (o.unresolved_reason !== null && o.unresolved_reason !== undefined) {
      errs.push("UNRESOLVED_REASON_FORBIDDEN: " + o.criterion_id);
    }
    const { kind, id } = o.deciding;
    const pool = kind === "objective-check" ? r.objective_checks : r.subjective_judgements;
    const matches = pool.filter((x) => x.id === id);
    if (matches.length === 0) { errs.push("DECIDE_DANGLING: " + o.criterion_id + " -> " + id); continue; }
    if (matches.length > 1) { errs.push("DECIDE_MULTIPLE: " + o.criterion_id + " -> " + id); continue; }
    const rec = matches[0];
    const mapped = kind === "objective-check"
      ? { pass: "pass", fail: "fail", "not-run": "unresolved" }[rec.verdict]
      : rec.criterion_outcome;
    if (mapped !== o.outcome) errs.push("DECIDE_DISAGREE: " + o.criterion_id);
    if (kind === "subjective-judgement") {
      const crit = critById.get(o.criterion_id);
      if (crit && crit.judgement_dependent !== true) errs.push("JUDGEMENT_NOT_PREDECLARED: " + o.criterion_id);
    }
  }

  // 3d. classification derivation
  if (r.main_result === "protocol-failure") {
    if (r.first_failure == null) errs.push("PROTOCOL_FAILURE_NO_FIRST_FAILURE");
  } else {
    if (r.first_failure != null) errs.push("CLASSIFY_MISMATCH: non-protocol-failure with first_failure");
    if (r.main_result === "supports-hypothesis" && r.criterion_outcomes.some((c) => c.outcome === "fail"))
      errs.push("CLASSIFY_SUPPORTS_WITH_FAIL");
    const derived = deriveResult(r);
    if (derived !== r.main_result) errs.push(`CLASSIFY_MISMATCH: derived ${derived} declared ${r.main_result}`);
  }

  // 3e. claim support-floors
  const ca = r.claim_assessments;
  if (ca.reproducibility.result === "supported" && ca.reproducibility.independent_operator !== true)
    errs.push("CLAIM_REPRODUCIBILITY_FLOOR");
  if (ca.repeatability.result === "supported" && ca.repeatability.executions < 2)
    errs.push("CLAIM_REPEATABILITY_FLOOR");
  if (ca.generalisation.result === "supported" &&
      (ca.generalisation.axes.length < 1 || !ca.generalisation.population || !ca.generalisation.aggregation))
    errs.push("CLAIM_GENERALISATION_FLOOR");

  // 3f. revision format + protocol/evidence digests + hash-reason
  if (!HEX40.test(r.revisions.subject.commit)) errs.push("REVISION_FORMAT: subject");
  if (!HEX40.test(r.revisions.superdomestique.commit)) errs.push("REVISION_FORMAT: superdomestique");
  for (const e of checkEvidencePath(repoRoot, r.protocol.path)) errs.push(e);
  try {
    if (sha256(fs.readFileSync(path.join(repoRoot, r.protocol.path))) !== r.protocol.sha256)
      errs.push("DIGEST_PROTOCOL_MISMATCH");
  } catch { errs.push("DIGEST_PROTOCOL_MISMATCH: unreadable"); }

  const allEvidence = [
    ...r.inputs, ...r.outputs,
    ...r.objective_checks.flatMap((c) => c.evidence),
    ...r.subjective_judgements.flatMap((j) => j.evidence),
  ];
  for (const e of allEvidence) {
    if (e.path != null) {
      const pe = checkEvidencePath(repoRoot, e.path);
      pe.forEach((x) => errs.push(x));
      if (pe.length === 0 && e.sha256 != null) {
        if (sha256(fs.readFileSync(path.join(repoRoot, e.path))) !== e.sha256)
          errs.push("DIGEST_EVIDENCE_MISMATCH: " + e.path);
      }
      if (e.sha256 == null && (!e.hash_absent_reason || e.hash_absent_reason.trim() === ""))
        errs.push("EVIDENCE_HASH_MISSING: " + e.path);
    } else if (e.url != null) {
      // network URL — never fetched; a missing hash needs an explicit reason
      if (e.sha256 == null && (!e.hash_absent_reason || e.hash_absent_reason.trim() === ""))
        errs.push("EVIDENCE_HASH_REASON_MISSING: " + e.url);
    }
  }

  // minimum evidence: non-empty limitations
  if (!Array.isArray(r.limitations) || r.limitations.length < 1 || r.limitations.some((l) => !l || !l.trim()))
    errs.push("LIMITATIONS_EMPTY");

  return errs;
}

// step 4 — publication append-only / predecessor-digest / frozen-field
function checkSequence(dir) {
  const errs = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const reports = files.map((f) => {
    const bytes = fs.readFileSync(path.join(dir, f));
    return { name: f, bytes, obj: JSON.parse(bytes.toString("utf8")) };
  });
  const first = reports[0].obj;
  const FROZEN = ["hypothesis", "decision_rule", "success_criteria", "procedure"];
  reports.forEach((r, i) => {
    const p = r.obj.publication;
    if (p.revision !== i + 1) errs.push(`PUB_NONCONTIGUOUS: ${r.name} revision ${p.revision} expected ${i + 1}`);
    const expectedPath = `reports/${String(p.revision).padStart(4, "0")}.json`;
    if (p.path !== expectedPath) errs.push(`PUB_PATH_MISMATCH: ${r.name} path ${p.path} expected ${expectedPath}`);
    if (i === 0) {
      if (p.status !== "original" || p.supersedes !== null || p.correction_reason !== null)
        errs.push(`PUB_ORIGINAL: ${r.name}`);
      return;
    }
    if (p.status !== "correction") errs.push(`PUB_STATUS: ${r.name}`);
    if (!p.correction_reason || !p.correction_reason.trim()) errs.push(`PUB_CORRECTION_REASON: ${r.name}`);
    const prevSha = sha256(reports[i - 1].bytes);
    if (!p.supersedes || p.supersedes.sha256 !== prevSha) errs.push(`PUB_PREDECESSOR_DIGEST: ${r.name}`);
    for (const field of FROZEN) {
      if (JSON.stringify(r.obj[field]) !== JSON.stringify(first[field]))
        errs.push(`PUB_FROZEN_FIELD: ${r.name} ${field}`);
    }
  });
  return errs;
}

// step 5 — Markdown/JSON agreement + required headings + no residual placeholder
const REQUIRED_HEADINGS = [
  "## Experiment", "## Hypothesis", "## Environment", "## Immutable revisions", "## Inputs",
  "## Procedure", "## Objective checks", "## Subjective judgements", "## Observations", "## Outputs",
  "## Deviations", "## Redactions", "## Criterion outcomes", "## Result", "## First failure",
  "## Claim assessments", "### Reproducibility", "### Repeatability", "### Generalisation", "## Limitations",
];

function crossCheck(obj, md) {
  const errs = [];
  const m = md.match(/Main result:\s*([a-z-]+)/);
  if (!m) errs.push("CROSS_NO_RESULT");
  else if (m[1] !== obj.main_result) errs.push(`CROSS_CLASSIFICATION: md ${m[1]} json ${obj.main_result}`);
  if (!md.includes(obj.hypothesis)) errs.push("CROSS_HYPOTHESIS");
  const localPaths = new Set([obj.protocol.path]);
  const collect = (refs) => refs.forEach((e) => { if (e.path) localPaths.add(e.path); });
  collect(obj.inputs); collect(obj.outputs);
  obj.objective_checks.forEach((c) => collect(c.evidence));
  obj.subjective_judgements.forEach((j) => collect(j.evidence));
  for (const p of localPaths) if (!md.includes(p)) errs.push("CROSS_EVIDENCE_LINK: " + p);
  for (const h of REQUIRED_HEADINGS) if (!md.includes(h)) errs.push("CROSS_HEADING: " + h);
  if (/\{\{/.test(md)) errs.push("CROSS_PLACEHOLDER");
  return errs;
}

// =============================== step 1: structural validation ===============================

test("positive fixture validates against the schema via the subset validator (subprocess)", () => {
  const r = runValidator(path.join(EX, "experiment-report.example.json"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

const STRUCTURAL_NEGATIVES = ["extra-property", "wrong-type", "out-of-enum", "missing-required"];
for (const name of STRUCTURAL_NEGATIVES) {
  test(`structural negative rejected by the subprocess validator: ${name}`, () => {
    const r = runValidator(path.join(NEG, name + ".json"));
    assert.notEqual(r.status, 0, `expected ${name} to fail the subset validator`);
  });
}

test("closure fires: the extra-property fixture proves additionalProperties:false is enforced", () => {
  const r = runValidator(path.join(NEG, "extra-property.json"));
  assert.match(r.stdout + r.stderr, /additional property "bogus" not allowed/);
});

// =============================== step 3: semantic validation ===============================

test("positive fixture passes every in-process semantic rule", () => {
  const report = load(path.join(EX, "experiment-report.example.json"));
  assert.deepEqual(validateReport(report, REPO), []);
});

test("positive fixture exercises the required coverage", () => {
  const r = load(path.join(EX, "experiment-report.example.json"));
  assert.equal(r.experiment.synthetic, true);
  assert.ok(r.objective_checks.length >= 1, "at least one objective check");
  const jd = r.success_criteria.find((s) => s.judgement_dependent);
  assert.ok(jd, "a judgement-dependent criterion");
  const jdOutcome = r.criterion_outcomes.find((c) => c.criterion_id === jd.id);
  assert.equal(jdOutcome.deciding.kind, "subjective-judgement");
  assert.ok(["does-not-support", "inconclusive"].includes(r.main_result), "a non-trivial classification path");
  const results = Object.values(r.claim_assessments).map((a) => a.result);
  assert.ok(results.includes("not-evaluated"), "a not-evaluated claim");
  assert.ok(results.includes("supported"), "a supported claim meeting its floor");
});

const SEMANTIC_NEGATIVES = [
  ["bad-id", "ID_PATTERN"],
  ["dup-id", "ID_DUPLICATE"],
  ["missing-criterion-outcome", "CRIT_MISSING_OUTCOME"],
  ["dup-criterion-outcome", "CRIT_DUP_OUTCOME"],
  ["undeclared-criterion-outcome", "CRIT_UNDECLARED_OUTCOME"],
  ["dangling-deciding", "DECIDE_DANGLING"],
  ["multiple-deciding", "DECIDE_MULTIPLE"],
  ["deciding-disagree", "DECIDE_DISAGREE"],
  ["unresolved-without-reason", "UNRESOLVED_REASON_MISSING"],
  ["pass-with-unresolved-reason", "UNRESOLVED_REASON_FORBIDDEN"],
  ["judgement-not-predeclared", "JUDGEMENT_NOT_PREDECLARED"],
  ["classification-inconsistent", "CLASSIFY_MISMATCH"],
  ["supports-with-failed-criterion", "CLASSIFY_SUPPORTS_WITH_FAIL"],
  ["protocol-failure-no-first-failure", "PROTOCOL_FAILURE_NO_FIRST_FAILURE"],
  ["generalisation-floor", "CLAIM_GENERALISATION_FLOOR"],
  ["repeatability-floor", "CLAIM_REPEATABILITY_FLOOR"],
  ["reproducibility-floor", "CLAIM_REPRODUCIBILITY_FLOOR"],
  ["short-revision", "REVISION_FORMAT"],
  ["evidence-digest-mismatch", "DIGEST_EVIDENCE_MISMATCH"],
];
for (const [name, code] of SEMANTIC_NEGATIVES) {
  test(`semantic negative is structurally valid but rejected in process (${code}): ${name}`, () => {
    const file = path.join(NEG, name + ".json");
    assert.equal(runValidator(file).status, 0, "semantic fixture must pass the structural validator");
    const errs = validateReport(load(file), REPO);
    assert.ok(errs.some((e) => e.startsWith(code)), `expected ${code}, got: ${errs.join(" | ")}`);
  });
}

// step 3g: path containment — driven directly through checkEvidencePath
test("path containment: absolute and repository-escaping paths fail closed", () => {
  const abs = load(path.join(NEG, "path-absolute.json")).inputs[0].path;
  assert.ok(checkEvidencePath(REPO, abs).some((e) => e.startsWith("PATH_ABSOLUTE")));
  const esc = load(path.join(NEG, "path-escaping.json")).inputs[0].path;
  assert.ok(checkEvidencePath(REPO, esc).some((e) => e.startsWith("PATH_ESCAPE")));
});

const SYMLINK_CASES = [
  ["path-symlink-outside", (root, at) => fs.symlinkSync("/etc/hostname", at)],
  ["path-symlink-inside", (root, at) => { const real = path.join(root, "real.txt"); fs.writeFileSync(real, "x"); fs.symlinkSync(real, at); }],
  ["path-symlink-broken", (root, at) => fs.symlinkSync(path.join(root, "does-not-exist"), at)],
];
for (const [name, setup] of SYMLINK_CASES) {
  test(`path containment: symlink component rejected before any hash read (${name})`, () => {
    const rel = load(path.join(NEG, name + ".json")).inputs[0].path;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "faff-ev-path-"));
    try {
      const at = path.join(root, rel);
      fs.mkdirSync(path.dirname(at), { recursive: true });
      setup(root, at);
      assert.ok(checkEvidencePath(root, rel).some((e) => e.startsWith("PATH_SYMLINK")),
        `expected PATH_SYMLINK for ${name}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

// =============================== step 4: publication sequences ===============================

test("valid publication sequence passes the append-only checks", () => {
  assert.deepEqual(checkSequence(path.join(SEQ, "valid-sequence")), []);
});

const SEQUENCE_NEGATIVES = [
  ["overwritten", "PUB_PATH_MISMATCH"],
  ["edited-earlier", "PUB_FROZEN_FIELD"],
  ["skipped-revision", "PUB_NONCONTIGUOUS"],
  ["bad-predecessor-digest", "PUB_PREDECESSOR_DIGEST"],
];
for (const [name, code] of SEQUENCE_NEGATIVES) {
  test(`publication sequence rejected (${code}): ${name}`, () => {
    const errs = checkSequence(path.join(SEQ, name));
    assert.ok(errs.some((e) => e.startsWith(code)), `expected ${code}, got: ${errs.join(" | ")}`);
  });
}

// =============================== step 5: cross-surface agreement ===============================

test("positive Markdown and JSON agree, all headings present, no residual placeholder", () => {
  const obj = load(path.join(EX, "experiment-report.example.json"));
  const md = fs.readFileSync(path.join(EX, "experiment-report.example.md"), "utf8");
  assert.deepEqual(crossCheck(obj, md), []);
});

test("cross-surface negative: Markdown and JSON disagree on classification", () => {
  const obj = load(path.join(NEG, "cross-md-json-disagree.json"));
  const md = fs.readFileSync(path.join(NEG, "cross-md-json-disagree.md"), "utf8");
  assert.ok(crossCheck(obj, md).some((e) => e.startsWith("CROSS_CLASSIFICATION")));
});

test("cross-surface negative: residual template placeholder", () => {
  const obj = load(path.join(NEG, "cross-residual-placeholder.json"));
  const md = fs.readFileSync(path.join(NEG, "cross-residual-placeholder.md"), "utf8");
  assert.ok(crossCheck(obj, md).some((e) => e.startsWith("CROSS_PLACEHOLDER")));
});
