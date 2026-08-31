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
const casefile = require("./spec-judge-casefile");

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
    // FAFF-930 — case-file assembler / admit roll-up modes.
    "--assemble": { arity: 0 },
    "--admit": { arity: 0 },
    "--spec": { arity: 1 },
    "--out": { arity: 1 },
    "--run-id": { arity: 1 },
    "--run-dir": { arity: 1 },
    "--repo-root": { arity: 1 },
  },
};
const SPEC_JUDGE_EVIDENCE_USAGE =
  "usage: faff spec-judge-evidence --dir <scratch> --window-start <N> --level <L1..L4> " +
  "--appetite <low|medium|high|full> --issue <ISSUE-XX> [--container <c>]\n" +
  "   or: faff spec-judge-evidence --assemble --dir <scratch> --window-start <N> --spec <file> " +
  "--issue <ISSUE-XX> [--out <judge-dir>] [--repo-root <path>] [--run-id <id>] [--container <c>]\n" +
  "   or: faff spec-judge-evidence --admit --level <L3|L4> --out <judge-dir> --spec <file> " +
  "--dir <scratch> --window-start <N> [--run-dir <path>]";
const LEVELS = ["L1", "L2", "L3", "L4"];

function cmdSpecJudgeEvidence(args) {
  const { values, errors } = parseArgs(args, SPEC_JUDGE_EVIDENCE_SPEC);
  if (errors.length) return usageError(errors, SPEC_JUDGE_EVIDENCE_USAGE);
  if (values["--assemble"] && values["--admit"]) {
    return usageError([{ code: "invalid-value", detail: "--assemble and --admit are mutually exclusive" }], SPEC_JUDGE_EVIDENCE_USAGE);
  }
  if (values["--assemble"]) return cmdAssemble(values);
  if (values["--admit"]) return cmdAdmit(values);

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

// ===========================================================================
// === region:factory — spec-judge-accept-bar (FAFF-945) ===
// The deterministic accept-bar roll-up: given the pre-judge evidence bundle, the judge's
// CONFORMANT spec-judge-verdict, and the level, it returns the coerced disposition.
// "Arithmetic over the bundle, not the judge's read." It moves the infosec floor from the
// pre-judge residue to the POST-adjudication ledger at L1–L3, while keeping the interim
// pre-judge floor at L4 (flipped to full-trust by FAFF-946, once the durable audit trail lands).
//
// Preconditions (faff-prep enforces before calling this): the verdict has already been
// validated conformant by `faff contract spec-judge-verdict` (exit 0), so `computeAcceptBar`
// does NOT re-police the `accept ⇒ empty upheld` invariant — that is the contract layer's job.
// This is what keeps the L1–L3 `upheld`-scan forward-compatible: today `accept ⇒ empty upheld`
// (the scan is a no-op), but when the four-outcome vocabulary widens the contract to let a
// conformant `accept` carry an auto-applied UPHOLD_REVIEW correction on `upheld[]`, the same
// scan coerces on a still-standing infosec major with no rewrite.
//
// Fail direction: fail-CLOSED (exit 2, no disposition) on genuine plumbing faults only
// (non-object input, unreadable file, non-JSON body, verdict outside the closed three). A
// merely-missing blocker_free_latest/infosec_major_free_latest field is the fail-SAFE (the
// floor fires — coerce to park-needs-human), never clear.
// ===========================================================================

const ACCEPT_BAR_JUDGE_VERDICTS = ["accept", "keep-going", "park-needs-human"];

// computeAcceptBar — the pure coercion. `evidence` and `verdict` are assumed to be plain
// objects (the CLI validates that); `verdict.verdict` is assumed to be one of the closed three
// (the CLI validates that too). Returns { disposition, coerced_from, floor_fired, level }.
function computeAcceptBar(evidence, verdict, level) {
  const v = verdict.verdict;
  // The accept-bar only ever coerces an `accept`; keep-going / park-needs-human pass through.
  if (v === "keep-going" || v === "park-needs-human") {
    return { disposition: v, coerced_from: null, floor_fired: null, level };
  }
  // v === "accept" from here.
  // Blocker floor (unchanged, every level). Fail-safe: a missing blocker_free_latest fires.
  if (evidence.blocker_free_latest !== true) {
    return { disposition: "park-needs-human", coerced_from: "accept", floor_fired: "blocker", level };
  }
  // Infosec floor — level-aware (the FAFF-945 change).
  if (level === "L4") {
    // Interim PRE-judge floor: coerce on a standing pre-judge infosec major. Fail-safe: a
    // missing infosec_major_free_latest field fires (treated as not-free).
    if (evidence.infosec_major_free_latest !== true) {
      return { disposition: "park-needs-human", coerced_from: "accept", floor_fired: "infosec", level };
    }
  } else {
    // L1–L3 POST-adjudication floor: coerce only on an infosec major the judge left STANDING
    // in `upheld[]`. A conformant `accept` upholds none, so this is a no-op today; it goes live
    // under the widened four-outcome contract.
    if (!infosecMajorFree(verdict.upheld)) {
      return { disposition: "park-needs-human", coerced_from: "accept", floor_fired: "infosec", level };
    }
  }
  // Uncoerced accept — authority gate.
  return {
    disposition: level === "L4" ? "accept-final" : "accept-provisional",
    coerced_from: null,
    floor_fired: null,
    level,
  };
}

const SPEC_JUDGE_ACCEPT_BAR_SPEC = {
  flags: {
    "--evidence": { arity: 1 },
    "--verdict": { arity: 1 },
    "--level": { arity: 1 },
  },
};
const SPEC_JUDGE_ACCEPT_BAR_USAGE =
  "usage: faff spec-judge-accept-bar --evidence <file|-> --verdict <file|-> --level <L1..L4>";

// Read a `--evidence`/`--verdict` argument: a file path, or `-` for stdin. Returns the parsed
// object, or throws (caught by the caller and mapped to fail-closed exit 2).
function readJsonArg(value, label) {
  let raw;
  try {
    raw = value === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(value, "utf8");
  } catch (e) {
    throw new Error(`${label}: could not read ${value === "-" ? "stdin" : JSON.stringify(value)} (${e.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${label}: body is not valid JSON (${e.message})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label}: must be a JSON object`);
  }
  return parsed;
}

function cmdSpecJudgeAcceptBar(args) {
  const { values, errors } = parseArgs(args, SPEC_JUDGE_ACCEPT_BAR_SPEC);
  if (errors.length) return usageError(errors, SPEC_JUDGE_ACCEPT_BAR_USAGE);

  const evidenceArg = values["--evidence"];
  const verdictArg = values["--verdict"];
  const level = values["--level"];
  if (evidenceArg == null) return usageError([{ code: "missing-value", detail: "--evidence is required" }], SPEC_JUDGE_ACCEPT_BAR_USAGE);
  if (verdictArg == null) return usageError([{ code: "missing-value", detail: "--verdict is required" }], SPEC_JUDGE_ACCEPT_BAR_USAGE);
  if (!LEVELS.includes(level)) {
    return usageError([{ code: "invalid-value", detail: `--level must be one of ${LEVELS.join(", ")}` }], SPEC_JUDGE_ACCEPT_BAR_USAGE);
  }

  // Fail-closed (exit 2, no disposition on stdout) on any unreadable / malformed input.
  let evidence, verdict;
  try {
    evidence = readJsonArg(evidenceArg, "--evidence");
    verdict = readJsonArg(verdictArg, "--verdict");
  } catch (e) {
    process.stderr.write(`faff spec-judge-accept-bar: ${e.message}\n`);
    return 2;
  }
  if (!ACCEPT_BAR_JUDGE_VERDICTS.includes(verdict.verdict)) {
    process.stderr.write(
      `faff spec-judge-accept-bar: verdict.verdict ${JSON.stringify(verdict.verdict)} not in {accept,keep-going,park-needs-human}\n`,
    );
    return 2;
  }

  const result = computeAcceptBar(evidence, verdict, level);
  console.log(JSON.stringify(result));
  return 0;
}

// ===========================================================================
// === region:factory — FAFF-930: --assemble (case files + ledger) and --admit (roll-up) ===
// ===========================================================================

// Read the standing residue (the latest in-window round's objections) from the round records.
// Returns { objections } on success, { unreadable:true } (fail-safe park) or { malformed:true }
// (fail-loud) mirroring the bundle mode's two fail directions.
function readStandingResidue(dir, windowStart) {
  let files;
  try { files = roundFilesInDir(dir).filter((f) => f.n >= windowStart); }
  catch { return { unreadable: true }; }
  let latest = null;
  for (const f of files) {
    const read = readRoundRecord(f.path);
    if (read.malformed || read.missing) return { malformed: true, path: f.path, why: read.malformed || "vanished" };
    latest = read.record || {};
  }
  return { objections: latest && Array.isArray(latest.objections) ? latest.objections : [] };
}

// Resolve the serving backend identity + the reputation flagged[] list (best-effort; absence →
// identity "unknown" / empty flagged, never a blocker).
function resolveReputation(dir, notes) {
  let identity = "unknown";
  try {
    const pin = JSON.parse(fs.readFileSync(path.join(dir, "pinned-reviewer.json"), "utf8"));
    identity = backendIdentity(pin) || "unknown";
  } catch { notes.push("no pinned-reviewer.json — argument_A backend identity is \"unknown\""); }
  let flagged = [];
  const rep = runFaff(["spec-review-reputation", "--report", "--json"]);
  if (rep.code === 0) {
    try {
      const report = JSON.parse(rep.stdout);
      if (report && report.backends) {
        for (const [id, row] of Object.entries(report.backends)) if (row && row.flagged) flagged.push(id);
      }
    } catch { notes.push("reputation report unparseable — no contested_source annotation"); }
  }
  return { identity, flagged };
}

function resolveRunId(values, issue) {
  if (values["--run-id"] != null) return values["--run-id"];
  const runDir = values["--run-dir"] || process.env.FAFF_RUN_DIR;
  if (runDir) {
    try {
      const led = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
      if (led && typeof led.run_id === "string" && led.run_id) return led.run_id;
    } catch { /* fall through */ }
  }
  return issue;
}

function cmdAssemble(values) {
  const dir = values["--dir"];
  const specPath = values["--spec"];
  const issue = values["--issue"];
  if (dir == null) return usageError([{ code: "missing-value", detail: "--assemble requires --dir" }], SPEC_JUDGE_EVIDENCE_USAGE);
  if (specPath == null) return usageError([{ code: "missing-value", detail: "--assemble requires --spec" }], SPEC_JUDGE_EVIDENCE_USAGE);
  if (issue == null) return usageError([{ code: "missing-value", detail: "--assemble requires --issue" }], SPEC_JUDGE_EVIDENCE_USAGE);
  if (badBareId(issue)) return usageError([{ code: "invalid-value", detail: `--issue "${issue}" is not a bare id` }], SPEC_JUDGE_EVIDENCE_USAGE);
  const container = values["--container"];
  if (container != null && badBareId(container)) return usageError([{ code: "invalid-value", detail: `--container "${container}" is not a bare id` }], SPEC_JUDGE_EVIDENCE_USAGE);

  const rawWindow = values["--window-start"];
  if (rawWindow == null || !/^\d+$/.test(String(rawWindow)) || parseInt(rawWindow, 10) < 1) {
    return usageError([{ code: "invalid-value", detail: "--window-start expects an integer >= 1" }], SPEC_JUDGE_EVIDENCE_USAGE);
  }
  const windowStart = parseInt(rawWindow, 10);

  const residue = readStandingResidue(dir, windowStart);
  if (residue.unreadable) { console.log(JSON.stringify({ park: true, reason: "spec-review dir unreadable" })); return 0; }
  if (residue.malformed) { process.stderr.write(`faff spec-judge-evidence --assemble: ${residue.path} is malformed (${residue.why})\n`); return 2; }

  let specText;
  try { specText = fs.readFileSync(specPath, "utf8"); }
  catch (e) { process.stderr.write(`faff spec-judge-evidence --assemble: cannot read --spec ${JSON.stringify(specPath)}: ${e.message}\n`); return 2; }

  const notes = [];
  const governingRequirements = assembleRatifiedScope(container, notes) || "";
  const { identity, flagged } = resolveReputation(dir, notes);
  const runId = resolveRunId(values, issue);
  const repoRoot = values["--repo-root"] || process.cwd();
  const outDir = values["--out"] || path.join(dir, "judge");

  const { caseFiles, ledger } = casefile.assemble({
    standingObjections: residue.objections,
    specText, runId, windowStart, repoRoot,
    reputationFlagged: flagged, servingIdentity: identity,
    governingRequirements,
  });

  try { fs.mkdirSync(outDir, { recursive: true }); }
  catch (e) { process.stderr.write(`faff spec-judge-evidence --assemble: cannot create --out ${JSON.stringify(outDir)}: ${e.message}\n`); return 2; }

  for (const pid of ledger.order) {
    fs.writeFileSync(path.join(outDir, `case-${pid}.json`), JSON.stringify(caseFiles[pid], null, 2) + "\n");
  }
  // The ledger is the un-blinding key — write it 0600 (owner read/write only).
  fs.writeFileSync(path.join(outDir, "ledger.json"), JSON.stringify(ledger, null, 2) + "\n", { mode: 0o600 });
  try { fs.chmodSync(path.join(outDir, "ledger.json"), 0o600); } catch { /* best-effort on platforms without chmod */ }

  for (const note of notes) process.stderr.write(`faff spec-judge-evidence --assemble: ${note}\n`);
  console.log(JSON.stringify({ assembled: ledger.order.length, out: outDir, propositions: ledger.order }));
  return 0;
}

function cmdAdmit(values) {
  const level = values["--level"];
  if (level !== "L3" && level !== "L4") {
    return usageError([{ code: "invalid-value", detail: "--admit requires --level L3 or L4" }], SPEC_JUDGE_EVIDENCE_USAGE);
  }
  const outDir = values["--out"] || (values["--dir"] ? path.join(values["--dir"], "judge") : null);
  if (outDir == null) return usageError([{ code: "missing-value", detail: "--admit requires --out (or --dir)" }], SPEC_JUDGE_EVIDENCE_USAGE);
  const specPath = values["--spec"];
  if (specPath == null) return usageError([{ code: "missing-value", detail: "--admit requires --spec" }], SPEC_JUDGE_EVIDENCE_USAGE);

  // Malformed / unparseable ledger.json → fail-loud exit 2 (never a silent resolve/drop).
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(path.join(outDir, "ledger.json"), "utf8")); }
  catch (e) { process.stderr.write(`faff spec-judge-evidence --admit: ledger.json unreadable/malformed in ${outDir}: ${e.message}\n`); return 2; }
  if (!ledger || !Array.isArray(ledger.order) || !ledger.entries) {
    process.stderr.write(`faff spec-judge-evidence --admit: ledger.json in ${outDir} has no order[]/entries{}\n`); return 2;
  }

  let specText;
  try { specText = fs.readFileSync(specPath, "utf8"); }
  catch (e) { process.stderr.write(`faff spec-judge-evidence --admit: cannot read --spec ${JSON.stringify(specPath)}: ${e.message}\n`); return 2; }

  // Load rulings for every non-parked listed proposition (a missing ruling for a listed,
  // non-parked proposition is fail-loud).
  const rulings = {};
  for (const pid of ledger.order) {
    const entry = ledger.entries[pid];
    if (entry && entry.resolution === "parked") { rulings[pid] = null; continue; }
    const rp = path.join(outDir, `ruling-${pid}.json`);
    let ruling;
    try { ruling = JSON.parse(fs.readFileSync(rp, "utf8")); }
    catch (e) { process.stderr.write(`faff spec-judge-evidence --admit: missing/malformed ruling-${pid}.json in ${outDir}: ${e.message}\n`); return 2; }
    rulings[pid] = ruling;
  }

  // Floors. blocker_free_latest from convergence (shelled); infosec_major_free over the ledger's
  // retained {lens,severity}. A degraded convergence yields a null blocker floor (fails closed).
  let blockerFree = null;
  if (values["--dir"] && values["--window-start"]) {
    const conv = runFaff(["spec-review-convergence", "--dir", values["--dir"], "--window-start", String(values["--window-start"])]);
    if (conv.code === 0) {
      try { blockerFree = JSON.parse(conv.stdout).blocker_free_latest === true; } catch { blockerFree = null; }
    }
  } else {
    blockerFree = true; // no convergence source wired — treat as pass (the ledger-side floors still apply)
  }
  const ledgerObjections = ledger.order.map((pid) => ledger.entries[pid]).filter(Boolean).map((e) => ({ lens: e.lens, severity: e.severity }));
  const infosecMajorFreeVal = infosecMajorFree(ledgerObjections);

  const runDir = values["--run-dir"] || process.env.FAFF_RUN_DIR || null;

  let result;
  try {
    result = casefile.admitRollup({
      ledger, rulings, currentSpecText: specText, level, runDir,
      floors: { blocker_free_latest: blockerFree, infosec_major_free: infosecMajorFreeVal },
      governingRequirements: ledger.governing_requirements || "",
    });
  } catch (e) {
    if (e && e.failLoud) { process.stderr.write(`faff spec-judge-evidence --admit: ${e.failLoud}\n`); return 2; }
    throw e;
  }
  console.log(JSON.stringify(result));
  return 0;
}

module.exports = {
  cmdSpecJudgeEvidence,
  cmdSpecJudgeAcceptBar,
  computeAcceptBar,
  infosecMajorFree,
};
