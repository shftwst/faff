// ===========================================================================
// === region:factory — spec-judge-evidence — the spec-review judge's evidence bundle ===
// The deterministic summary the spec-review judge weighs at the would-be-park point.
// It NEVER re-derives a layer's output: it SHELLS the shipped resolvers (convergence,
// churn, reputation, ratified-scope) through the same `bin/faff` entrypoint and passes
// their output through verbatim, plus the raw round records and two arithmetic
// derivations (blocker_free_latest is reused verbatim from convergence;
// infosec_major_free_latest is derived here from the standing objections).
//
// INTERIM bundle shape (kept deliberately thin): solid plumbing, minimal vocabulary.
//
// Degrade discipline (mirrors the resolvers it shells):
//   - unreadable `--dir`            -> a park-direction bundle `{park:true, reason}`, exit 0
//                                      (fail-safe: the loop parks, the judge is NOT consulted)
//   - a malformed round record      -> exit 2 (fail-loud plumbing breakage)
//   - a merely-absent optional layer (no pinned reviewer / under-sampled backend / no
//     ratified scope / an errored optional source) -> that ONE field degrades to its null
//     form (`calibration.cleared:"unknown"`, `ratified_scope_block:null`) with a stderr note,
//     never blocking the judge.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { readRoundRecord } = require("./spec-review-churn");
const { roundFilesInDir } = require("./spec-review-convergence");
const { resolveReviewIterationCap } = require("./spec-review-iteration-cap");
const { backendIdentity } = require("./spec-review-pin");

// The same bin/faff entrypoint tests and users invoke — resolved relative to this module
// (lib/../faff), never a hardcoded absolute path.
const FAFF_BIN = path.resolve(__dirname, "..", "faff");

// The bare-id shape run-ledger.js enforces at its --issue/--container boundary. run-ledger's
// own regex is not exported, so this is the same shape restated for the values this CLI passes
// through to the shelled tools (boundary hygiene, not a new traversal guard).
const BARE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function badBareId(v) {
  return typeof v !== "string" || !BARE_ID_RE.test(v) || v.includes("..");
}

// Run a bin/faff subcommand, returning { code, stdout, stderr }. execFileSync throws on a
// non-zero exit; we recover the captured streams + status from the thrown error so the caller
// can branch on the exit code (exit 3 from ratified-scope is a NORMAL empty, not a fault).
function runFaff(args) {
  try {
    const stdout = execFileSync("node", [FAFF_BIN, ...args], { encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return {
      code: typeof e.status === "number" ? e.status : 1,
      stdout: e.stdout != null ? String(e.stdout) : "",
      stderr: e.stderr != null ? String(e.stderr) : "",
    };
  }
}

// infosec_major_free_latest — the security-severity floor input, derived arithmetically from
// the latest round's standing objections: true iff NO objection is an `infosec` objection at
// `major` or `blocker` (the two severities the judge may never down-weight to taste).
function infosecMajorFree(standingObjections) {
  const arr = Array.isArray(standingObjections) ? standingObjections : [];
  for (const o of arr) {
    if (o && typeof o === "object" && o.lens === "infosec" && (o.severity === "major" || o.severity === "blocker")) {
      return false;
    }
  }
  return true;
}

// The degraded (unknown) calibration figure — the null form for an absent pinned reviewer, an
// under-sampled backend, or a reputation lookup that errored. `cleared:"unknown"` is distinct
// from a cleared `false`: under-sampled, not yet judgeable.
function unknownCalibration(backend) {
  return { backend: backend || null, flagged: false, reviewed: 0, block_rate: 0, overturn_rate: 0, cleared: "unknown" };
}

// Assemble the CalibrationFigure by looking up the serving backend (from the round's
// pinned-reviewer.json) in `spec-review-reputation --report --json`. Any absence or error
// degrades to the unknown form (logged), never blocks the judge.
function assembleCalibration(dir, notes) {
  let pinRaw;
  try {
    pinRaw = fs.readFileSync(path.join(dir, "pinned-reviewer.json"), "utf8");
  } catch (e) {
    notes.push("no pinned-reviewer.json — calibration.cleared:\"unknown\"");
    return unknownCalibration(null);
  }
  let pin;
  try {
    pin = JSON.parse(pinRaw);
  } catch (e) {
    notes.push("pinned-reviewer.json is not valid JSON — calibration.cleared:\"unknown\"");
    return unknownCalibration(null);
  }
  const identity = backendIdentity(pin);
  const rep = runFaff(["spec-review-reputation", "--report", "--json"]);
  if (rep.code !== 0) {
    notes.push(`spec-review-reputation --report failed (exit ${rep.code}) — calibration.cleared:"unknown"`);
    return unknownCalibration(identity);
  }
  let report;
  try {
    report = JSON.parse(rep.stdout);
  } catch (e) {
    notes.push("spec-review-reputation output not parseable — calibration.cleared:\"unknown\"");
    return unknownCalibration(identity);
  }
  const row = report && report.backends ? report.backends[identity] : undefined;
  const minSample = report && typeof report.min_sample === "number" ? report.min_sample : 8;
  if (!row) {
    notes.push(`serving backend "${identity}" absent from the reputation ledger — calibration.cleared:"unknown"`);
    return unknownCalibration(identity);
  }
  const cleared = row.reviewed >= minSample ? !row.flagged : "unknown";
  return {
    backend: identity,
    flagged: !!row.flagged,
    reviewed: row.reviewed,
    block_rate: row.block_rate,
    overturn_rate: row.overturn_rate,
    cleared,
  };
}

// Assemble the ratified-scope stipulation text by shelling `ratified-scope --assemble`.
//   exit 0 -> the emitted `## Ratified scope` markdown, verbatim
//   exit 3 -> null (nothing ratified — a NORMAL empty value, not a degrade)
//   exit 2 / command absent / any other -> null with a logged note (a degraded source)
function assembleRatifiedScope(container, notes) {
  const args = ["ratified-scope", "--assemble"];
  if (container) args.push("--container", container);
  const res = runFaff(args);
  if (res.code === 0) return res.stdout;
  if (res.code === 3) return null; // nothing ratified — normal empty
  notes.push(`ratified-scope --assemble degraded (exit ${res.code}) — ratified_scope_block:null`);
  return null;
}

const SPEC_JUDGE_EVIDENCE_SPEC = {
  flags: {
    "--dir": { arity: 1 },
    "--window-start": { arity: 1 },
    "--level": { arity: 1 },
    "--appetite": { arity: 1 },
    "--issue": { arity: 1 },
    "--container": { arity: 1 },
  },
};
const SPEC_JUDGE_EVIDENCE_USAGE =
  "usage: faff spec-judge-evidence --dir <scratch> --window-start <N> --level <L1..L4> " +
  "--appetite <low|medium|high|full> --issue <ISSUE-XX> [--container <c>]";
const LEVELS = ["L1", "L2", "L3", "L4"];

function cmdSpecJudgeEvidence(args) {
  const { values, errors } = parseArgs(args, SPEC_JUDGE_EVIDENCE_SPEC);
  if (errors.length) return usageError(errors, SPEC_JUDGE_EVIDENCE_USAGE);

  const dir = values["--dir"];
  const level = values["--level"];
  const appetite = values["--appetite"];
  const issue = values["--issue"];
  const container = values["--container"]; // optional

  if (dir == null) return usageError([{ code: "missing-value", detail: "--dir is required" }], SPEC_JUDGE_EVIDENCE_USAGE);
  if (issue == null) return usageError([{ code: "missing-value", detail: "--issue is required" }], SPEC_JUDGE_EVIDENCE_USAGE);
  if (!LEVELS.includes(level)) {
    return usageError([{ code: "invalid-value", detail: `--level must be one of ${LEVELS.join(", ")}` }], SPEC_JUDGE_EVIDENCE_USAGE);
  }

  // --window-start: a strict integer-string >= 1 (usage error otherwise), validated up front so
  // it is independent of whether the directory is readable (mirrors spec-review-convergence).
  const rawWindow = values["--window-start"];
  if (rawWindow == null) {
    return usageError([{ code: "missing-value", detail: "--window-start is required" }], SPEC_JUDGE_EVIDENCE_USAGE);
  }
  if (!/^\d+$/.test(String(rawWindow)) || parseInt(rawWindow, 10) < 1) {
    return usageError([{ code: "invalid-value", detail: `--window-start expects an integer >= 1, got "${rawWindow}"` }], SPEC_JUDGE_EVIDENCE_USAGE);
  }
  const windowStart = parseInt(rawWindow, 10);

  // appetite_cap resolves through the single-source resolver (no shelling — it is a pure literal
  // lookup); an unrecognised appetite is a usage fault, exit 2.
  const capRes = resolveReviewIterationCap(appetite);
  if (capRes.error) { process.stderr.write(capRes.error + "\n"); return 2; }
  const appetiteCap = capRes.cap;

  // Boundary bare-id hygiene for the identifiers passed through to the shelled tools.
  if (badBareId(issue)) {
    return usageError([{ code: "invalid-value", detail: `--issue "${issue}" is not a bare id` }], SPEC_JUDGE_EVIDENCE_USAGE);
  }
  if (container != null && badBareId(container)) {
    return usageError([{ code: "invalid-value", detail: `--container "${container}" is not a bare id` }], SPEC_JUDGE_EVIDENCE_USAGE);
  }

  // Read the round records ourselves (raw data, not a layer output) — this owns the two
  // fail directions: an unreadable dir is fail-SAFE (park bundle), a malformed round record is
  // fail-LOUD (exit 2).
  let files;
  try {
    files = roundFilesInDir(dir).filter((f) => f.n >= windowStart);
  } catch (e) {
    // Unreadable --dir: mirror the convergence CLI's degrade direction — a park-direction
    // bundle, exit 0. The loop parks; the judge is NOT consulted on unassemblable evidence.
    console.log(JSON.stringify({ park: true, reason: "spec-review dir unreadable" }));
    return 0;
  }

  const rounds = [];
  for (const f of files) {
    const read = readRoundRecord(f.path);
    if (read.malformed || read.missing) {
      const why = read.malformed ? `not valid JSON (${read.malformed})` : "could not be read (listed then vanished)";
      process.stderr.write(`faff spec-judge-evidence: ${f.path} is ${why}\n`);
      return 2;
    }
    const rec = read.record || {};
    rounds.push({ n: f.n, verdict: rec.verdict, objections: Array.isArray(rec.objections) ? rec.objections : [] });
  }

  const latest = rounds.length ? rounds[rounds.length - 1] : null;
  const standingObjections = latest ? latest.objections : [];
  const notes = [];

  // convergence — shelled verbatim (blocker_free_latest is reused from its output).
  const conv = runFaff(["spec-review-convergence", "--dir", dir, "--window-start", String(windowStart)]);
  if (conv.code !== 0) {
    process.stderr.write(`faff spec-judge-evidence: spec-review-convergence failed (exit ${conv.code})\n${conv.stderr}`);
    return 2;
  }
  let convergence;
  try {
    convergence = JSON.parse(conv.stdout);
  } catch (e) {
    // The exit-2 fail-loud contract must hold on the shelled-CLI-stdout path too: an exit-0
    // resolver that emitted empty/non-JSON stdout is a plumbing fault, not a park signal.
    process.stderr.write(`faff spec-judge-evidence: spec-review-convergence returned unparseable stdout: ${e.message}\n`);
    return 2;
  }

  // churn — shelled over the last two in-window round records (the same pairing faff-prep's own
  // churn check uses). Fewer than two in-window rounds degrades to the churn-false null form.
  let churn;
  if (files.length >= 2) {
    const prev = files[files.length - 2].path;
    const curr = files[files.length - 1].path;
    const churnRes = runFaff(["spec-review-churn", "--prev", prev, "--curr", curr]);
    if (churnRes.code !== 0) {
      process.stderr.write(`faff spec-judge-evidence: spec-review-churn failed (exit ${churnRes.code})\n${churnRes.stderr}`);
      return 2;
    }
    try {
      churn = JSON.parse(churnRes.stdout);
    } catch (e) {
      process.stderr.write(`faff spec-judge-evidence: spec-review-churn returned unparseable stdout: ${e.message}\n`);
      return 2;
    }
  } else {
    churn = { churn: false, prev_lenses: [], curr_lenses: [], new_lenses: [], reason: "fewer than two in-window rounds" };
  }

  const bundle = {
    standing_objections: standingObjections,
    convergence,
    churn,
    blocker_free_latest: convergence.blocker_free_latest === true,
    infosec_major_free_latest: infosecMajorFree(standingObjections),
    calibration: assembleCalibration(dir, notes),
    ratified_scope_block: assembleRatifiedScope(container, notes),
    appetite_cap: appetiteCap,
    rounds,
    level,
  };

  for (const note of notes) process.stderr.write(`faff spec-judge-evidence: ${note}\n`);
  console.log(JSON.stringify(bundle));
  return 0;
}

module.exports = {
  cmdSpecJudgeEvidence,
  infosecMajorFree,
};
