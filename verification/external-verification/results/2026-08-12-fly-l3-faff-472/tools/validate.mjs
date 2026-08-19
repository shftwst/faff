#!/usr/bin/env node
// FAFF-734 - case validator. Holds the published case to the same bar the shipped v0.1 protocol
// test sets, plus two case-specific cross-checks the shipped test does not carry:
//   - the grounding cross-check: revisions.subject.commit == published merge-record.json head_sha;
//   - the cross-surface README/JSON agreement (hypothesis, main result, every local path,
//     the stable headings, no residual placeholder).
// It reuses the shipped subset validator (validate-schema.mjs) AS A SUBPROCESS for structural
// conformance, then re-applies the protocol's semantic rules in process. No network.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..", "..");
const CASE_REL = "verification/external-verification/results/2026-08-12-fly-l3-faff-472";
const CASE_ROOT = path.join(REPO, CASE_REL);
const VALIDATOR = path.join(REPO, "plugin", "skills", "faff", "contracts", "validate-schema.mjs");
const SCHEMA = path.join(REPO, "verification", "external-verification", "protocol", "v0.1", "schema", "experiment-report.schema.json");
const REPORT = path.join(CASE_ROOT, "reports", "0001.json");
const README = path.join(CASE_ROOT, "README.md");

const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const SC_RE = /^SC-\d+$/;
const OC_RE = /^OC-\d+$/;
const SJ_RE = /^SJ-\d+$/;
const HEX40 = /^[0-9a-f]{40}$/;

function checkEvidencePath(repoRoot, rel) {
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
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return ["PATH_ESCAPE: " + rel];
  return [];
}

function deriveResult(r) {
  const outcomes = r.criterion_outcomes.map((c) => c.outcome);
  if (!r.evidence_complete || outcomes.includes("unresolved")) return "inconclusive";
  if (outcomes.includes("fail")) return "does-not-support";
  return "supports-hypothesis";
}

// The protocol's in-process semantic rules (ported from test/external-verification-protocol.test.mjs).
export function validateReport(r, repoRoot) {
  const errs = [];
  const dup = (ids, code) => {
    const seen = new Set();
    for (const id of ids) { if (seen.has(id)) errs.push(`${code}: ${id}`); seen.add(id); }
  };
  for (const s of r.success_criteria) if (!SC_RE.test(s.id)) errs.push("ID_PATTERN: " + s.id);
  for (const c of r.objective_checks) if (!OC_RE.test(c.id)) errs.push("ID_PATTERN: " + c.id);
  for (const j of r.subjective_judgements) if (!SJ_RE.test(j.id)) errs.push("ID_PATTERN: " + j.id);
  dup(r.success_criteria.map((s) => s.id), "ID_DUPLICATE");
  dup(r.objective_checks.map((c) => c.id), "ID_DUPLICATE");
  dup(r.subjective_judgements.map((j) => j.id), "ID_DUPLICATE");

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

  if (r.main_result === "protocol-failure") {
    if (r.first_failure == null) errs.push("PROTOCOL_FAILURE_NO_FIRST_FAILURE");
  } else {
    if (r.first_failure != null) errs.push("CLASSIFY_MISMATCH: non-protocol-failure with first_failure");
    if (r.main_result === "supports-hypothesis" && r.criterion_outcomes.some((c) => c.outcome === "fail"))
      errs.push("CLASSIFY_SUPPORTS_WITH_FAIL");
    const derived = deriveResult(r);
    if (derived !== r.main_result) errs.push(`CLASSIFY_MISMATCH: derived ${derived} declared ${r.main_result}`);
  }

  const ca = r.claim_assessments;
  if (ca.reproducibility.result === "supported" && ca.reproducibility.independent_operator !== true)
    errs.push("CLAIM_REPRODUCIBILITY_FLOOR");
  if (ca.repeatability.result === "supported" && ca.repeatability.executions < 2)
    errs.push("CLAIM_REPEATABILITY_FLOOR");
  if (ca.generalisation.result === "supported" &&
      (ca.generalisation.axes.length < 1 || !ca.generalisation.population || !ca.generalisation.aggregation))
    errs.push("CLAIM_GENERALISATION_FLOOR");

  if (!HEX40.test(r.revisions.subject.commit)) errs.push("REVISION_FORMAT: subject");
  if (!HEX40.test(r.revisions.superdomestique.commit)) errs.push("REVISION_FORMAT: superdomestique");
  const protoPe = checkEvidencePath(repoRoot, r.protocol.path);
  protoPe.forEach((x) => errs.push(x));
  if (protoPe.length === 0) {
    try {
      if (sha256(fs.readFileSync(path.join(repoRoot, r.protocol.path))) !== r.protocol.sha256)
        errs.push("DIGEST_PROTOCOL_MISMATCH");
    } catch { errs.push("DIGEST_PROTOCOL_MISMATCH: unreadable"); }
  }

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
      if (e.sha256 == null && (!e.hash_absent_reason || e.hash_absent_reason.trim() === ""))
        errs.push("EVIDENCE_HASH_REASON_MISSING: " + e.url);
    }
  }

  if (!Array.isArray(r.limitations) || r.limitations.length < 1 || r.limitations.some((l) => !l || !l.trim()))
    errs.push("LIMITATIONS_EMPTY");

  return errs;
}

// Case-specific rules the shipped protocol test does not carry.
export function validateCaseSpecific(r, repoRoot) {
  const errs = [];
  // grounding cross-check: subject commit == published merge-record.json head_sha
  const mergeRef = r.outputs.find((o) => o.role === "merge-record") ||
    r.objective_checks.flatMap((c) => c.evidence).find((e) => e.role === "merge-record");
  if (!mergeRef || !mergeRef.path) errs.push("GROUNDING_NO_MERGE_RECORD");
  else {
    let mr;
    try { mr = load(path.join(repoRoot, mergeRef.path)); } catch { errs.push("GROUNDING_MERGE_UNREADABLE"); }
    if (mr && mr.head_sha !== r.revisions.subject.commit)
      errs.push(`GROUNDING_SUBJECT_COMMIT: report ${r.revisions.subject.commit} != merge-record head_sha ${mr.head_sha}`);
  }
  // deviation must name the unrecoverable runner-process checkout, with the grounded merge commit value
  const dev = r.deviations.find((d) => d.field === "revisions.superdomestique.commit");
  if (!dev) errs.push("DEVIATION_RUNNER_CHECKOUT_MISSING");
  if (!r.deviations.some((d) => d.field === "registered_at")) errs.push("DEVIATION_RETRO_REGISTRATION_MISSING");
  // OC-4 must observe tampered on the run-ledger, never a clean re-verify
  const oc4 = r.objective_checks.find((c) => c.id === "OC-4");
  if (!oc4 || oc4.verdict !== "fail" || !/tampered/i.test(oc4.observed) || !/run-ledger\.json/.test(oc4.observed))
    errs.push("OC4_NOT_TAMPERED");
  // OC-5 must observe verified-fail / node-test
  const oc5 = r.objective_checks.find((c) => c.id === "OC-5");
  if (!oc5 || oc5.verdict !== "fail" || !/verified-fail/.test(oc5.observed)) errs.push("OC5_NOT_VERIFIED_FAIL");
  // the published redacted ledger must still carry level:"L3"
  const ledger = load(path.join(CASE_ROOT, "evidence", "run-ledger.json"));
  if (ledger.level !== "L3") errs.push("LEDGER_LEVEL_REPAIRED");
  // the three claim assessments are all not-evaluated with honest floors
  const ca = r.claim_assessments;
  if (ca.reproducibility.result !== "not-evaluated" || ca.reproducibility.independent_operator !== false)
    errs.push("CLAIM_REPRODUCIBILITY_NOT_HONEST");
  if (ca.repeatability.result !== "not-evaluated" || ca.repeatability.executions !== 1)
    errs.push("CLAIM_REPEATABILITY_NOT_HONEST");
  if (ca.generalisation.result !== "not-evaluated" || ca.generalisation.axes.length !== 0)
    errs.push("CLAIM_GENERALISATION_NOT_HONEST");
  return errs;
}

const REQUIRED_HEADINGS = [
  "## Experiment", "## Hypothesis", "## Environment", "## Immutable revisions", "## Inputs",
  "## Procedure", "## Objective checks", "## Subjective judgements", "## Observations", "## Outputs",
  "## Deviations", "## Redactions", "## Criterion outcomes", "## Result", "## First failure",
  "## Claim assessments", "### Reproducibility", "### Repeatability", "### Generalisation", "## Limitations",
];

export function crossCheck(obj, md) {
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

export function validateCase() {
  const errs = [];
  const sub = spawnSync(process.execPath, [VALIDATOR, REPORT, SCHEMA], { encoding: "utf8" });
  if (sub.status !== 0) errs.push("SUBSET_VALIDATOR_FAIL: " + (sub.stdout + sub.stderr).trim());
  const report = load(REPORT);
  const md = fs.readFileSync(README, "utf8");
  errs.push(...validateReport(report, REPO));
  errs.push(...validateCaseSpecific(report, REPO));
  errs.push(...crossCheck(report, md));
  return errs;
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const errs = validateCase();
  if (errs.length === 0) { console.log("PASS - case validates against the v0.1 protocol"); process.exit(0); }
  console.error("FAIL - case violations:");
  for (const e of errs) console.error("  - " + e);
  process.exit(1);
}
