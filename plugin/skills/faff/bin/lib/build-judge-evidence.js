// ===========================================================================
// === region:factory — build-judge-evidence — the build-review would-be-park judge's CLI layer ===
// Sibling of `spec-judge-evidence.js`'s `--assemble`/`--admit` CLI layer, ported to the
// build-review dialogue's would-be-park point (FAFF-996). Two modes on one subcommand:
//
//   --assemble --dir <build-review-dir> --issue <issue> --diff <diff-file> [...]
//     Reads the dialogue round records, derives the adjudication set (standing criticals plus
//     any rebuttal-driven withdrawal awaiting confirmation, p-05), calls
//     `assembleBuildCaseFiles` (the deterministic case-file assembler in
//     `build-judge-casefile.js`), writes `case-<case_id>.json` + `ledger.json` (mode 0600) —
//     THEN, for each non-parked case_id in ledger order, dispatches the two-phase judge via
//     `review-call.mjs` (Phase 1 blind reconstruction, Phase 2 rule), writing
//     `ruling-<case_id>.json` per finding. Unlike the spec side (whose per-proposition dispatch
//     is driven by faff-prep's own SKILL.md loop), the build side's dispatch is embedded HERE —
//     a deliberate shape departure the FAFF-996 spec calls for, not a refactor of the spec side.
//
//   --admit --dir <build-review-dir> --level <level> --run-dir <run-dir>
//     Rolls the resolved ledger up via `admitBuildRollup`, computing the ONE build-side floor
//     (critical-free-latest, p-17) from the last dialogue round record here (never inside the
//     deterministic roll-up, which stays a pure fn over its floor INPUT). Prints the AdmitResult
//     and exits 0 (admit) / 1 (not admit) — mirroring spec-judge-evidence's --admit convention.
//
// Degrade discipline mirrors spec-judge-evidence.js: an unreadable --dir is fail-SAFE (a
// park-direction bundle, exit 0 — the loop parks, the judge is never consulted on unassemblable
// evidence); a malformed round record is fail-LOUD (exit 2, plumbing breakage).
// ===========================================================================

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { readRoundRecord } = require("./spec-review-churn");
const { roundFilesInDir } = require("./spec-review-convergence");
const { standingCriticalIds } = require("./build-review-churn");
const { assembleBuildCaseFiles, admitBuildRollup } = require("./build-judge-casefile");
const { parseVerdictBlock, validateReconstruction, imperativeScrub } = require("./adversarial-judge-scrub");

const FAFF_BIN = path.resolve(__dirname, "..", "faff");
const REVIEW_CALL_MJS = path.resolve(__dirname, "..", "..", "..", "faffter-dark-adversarial-review", "review-call.mjs");
const PHASE1_PROMPT = path.resolve(__dirname, "..", "..", "..", "faffter-dark-adversarial-review", "adjudicate-build-phase1-reconstruct.md");
const PHASE2_PROMPT = path.resolve(__dirname, "..", "..", "..", "faffter-dark-adversarial-review", "adjudicate-build-phase2-rule.md");

const BARE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function badBareId(v) {
  return typeof v !== "string" || !BARE_ID_RE.test(v) || v.includes("..");
}

// Run a bin/faff subcommand, returning { code, stdout, stderr } — the same recover-from-throw
// shape spec-judge-evidence.js's runFaff uses.
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

// The REAL review-call.mjs transport — a thin execFileSync wrapper. Injectable (see
// dispatchJudgeRulings' `deps` parameter) so tests never spawn a real subprocess or hit a
// network backend.
function realRunReviewCall(args) {
  try {
    const stdout = execFileSync("node", [REVIEW_CALL_MJS, ...args], { encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return {
      code: typeof e.status === "number" ? e.status : 1,
      stdout: e.stdout != null ? String(e.stdout) : "",
      stderr: e.stderr != null ? String(e.stderr) : "",
    };
  }
}

// judgeDispatchDisposition lives in review-call.mjs (ESM) — dynamic `import()` is the only way
// to reach it from this CJS module (never reimplemented; the exit-taxonomy-to-disposition
// mapping is single-sourced there). Cached after first resolution.
let _judgeDispatchDispositionFn = null;
async function realJudgeDispatchDisposition(exit) {
  if (!_judgeDispatchDispositionFn) {
    const mod = await import(require("node:url").pathToFileURL(REVIEW_CALL_MJS).href);
    _judgeDispatchDispositionFn = mod.judgeDispatchDisposition;
  }
  return _judgeDispatchDispositionFn(exit);
}

// --- adjudication-set derivation (which findings need a judge pass) --------

// findLastKnownFinding(findingId, rounds) -> {location, title} | null — scans rounds NEWEST-
// first for a `findings[]` entry carrying this finding_id, so a withdrawn finding's identity
// fields (needed to build its case file) are recovered from its last known appearance.
function findLastKnownFinding(findingId, rounds) {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const findings = Array.isArray(rounds[i].findings) ? rounds[i].findings : [];
    const hit = findings.find((f) => f && f.finding_id === findingId);
    if (hit) return { location: hit.location || "", title: hit.title || "" };
  }
  return null;
}

// latestRebuttalFor(findingId, rounds) -> the most recent rebuttal_text authored for this
// finding_id (newest-round-first scan of author_replies), or undefined.
function latestRebuttalFor(findingId, rounds) {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const replies = Array.isArray(rounds[i].author_replies) ? rounds[i].author_replies : [];
    const hit = [...replies].reverse().find((r) => r && r.kind === "rebuttal" && r.finding_ref === findingId);
    if (hit) return hit.rebuttal_text;
  }
  return undefined;
}

// collectAdjudicationSet(rounds) -> [{finding_id, location, title, rebuttal_text, requires_confirm}]
//   adjudicate := standing_criticals ∪ rebuttal_withdrawn_criticals(last_round) — the PROCEDURE
//   build_judge input set (spec HOW section). `rounds` is ordered ascending, already read from
//   disk by the caller.
function collectAdjudicationSet(rounds) {
  if (!rounds.length) return [];
  const latest = rounds[rounds.length - 1];
  const standing = (Array.isArray(latest.findings) ? latest.findings : []).filter((f) => f && f.severity === "critical");
  const out = standing.map((f) => ({
    finding_id: f.finding_id,
    location: f.location || "",
    title: f.title || "",
    rebuttal_text: latestRebuttalFor(f.finding_id, rounds),
    requires_confirm: false,
  }));

  if (standing.length === 0 && rounds.length >= 2) {
    const prev = rounds[rounds.length - 2];
    const rebuttalReplies = (Array.isArray(prev.author_replies) ? prev.author_replies : []).filter((r) => r && r.kind === "rebuttal");
    if (rebuttalReplies.length) {
      const seen = new Set();
      for (const r of rebuttalReplies) {
        const id = r.finding_ref;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const info = findLastKnownFinding(id, rounds) || { location: "", title: "" };
        out.push({ finding_id: id, location: info.location, title: info.title, rebuttal_text: r.rebuttal_text, requires_confirm: true });
      }
    }
  }
  return out;
}

// --- Phase 1/2 dispatch loop -------------------------------------------------

// Write a scratch file under a tmp dir and return its path (dispatch context files).
function writeTmp(tmpDir, name, content) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

// dispatchOne(caseId, caseFile, tmpDir, deps) -> { ruling: BuildJudgeVerdict|null, resolution,
//   cause } — runs Phase 1 (bounded retry on UNREACHABLE/DEADLINE) then, on a valid
// reconstruction, Phase 2 (same bounded retry), returning a park cause on any other disposition.
async function dispatchOne(caseId, caseFile, tmpDir, deps) {
  const { runReviewCall, judgeDispatchDisposition, retryLimit } = deps;
  const diffFile = writeTmp(tmpDir, `${caseId}-diff.txt`, caseFile.reconstruction_context.relevant_diff || "");

  // Phase 1: blind reconstruction — --context is the reconstruction_context ONLY, never
  // argument_A/B.
  const reconContextFile = writeTmp(tmpDir, `${caseId}-recon-context.json`, JSON.stringify({
    acceptance_criteria: caseFile.reconstruction_context.acceptance_criteria,
    repository_evidence: caseFile.reconstruction_context.repository_evidence,
    proposition: caseFile.reconstruction_context.proposition,
  }, null, 2));
  let phase1Res = null;
  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    phase1Res = runReviewCall([
      "--system", PHASE1_PROMPT, "--diff", diffFile, "--context", reconContextFile,
      "--expect", "contract",
    ]);
    const disp = await judgeDispatchDisposition(phase1Res.code);
    if (disp === "retry") continue;
    break;
  }
  const finalDisp1 = await judgeDispatchDisposition(phase1Res.code);
  if (finalDisp1 !== "ruling") {
    return { ruling: null, resolution: "parked", cause: `phase-1 dispatch disposition "${finalDisp1}" (exit ${phase1Res.code})` };
  }
  const reconCheck = validateReconstruction(phase1Res.stdout);
  if (!reconCheck.ok) {
    return { ruling: null, resolution: "parked", cause: `reconstruction empty/failed: ${reconCheck.reason}` };
  }

  // Phase 2: rule — imperative-scrub the Phase-1 OUTPUT (closes the two-call laundering path),
  // then the scrubbed reconstruction + the already-scrubbed arguments A/B as --context.
  const scrubbedRecon = imperativeScrub(phase1Res.stdout);
  const phase2ContextFile = writeTmp(tmpDir, `${caseId}-phase2-context.json`, JSON.stringify({
    reconstruction: scrubbedRecon,
    argument_A: caseFile.arguments.argument_A,
    argument_B: caseFile.arguments.argument_B,
    proposition: caseFile.reconstruction_context.proposition,
  }, null, 2));
  let phase2Res = null;
  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    phase2Res = runReviewCall([
      "--system", PHASE2_PROMPT, "--diff", diffFile, "--context", phase2ContextFile,
      "--expect", "contract",
    ]);
    const disp = await judgeDispatchDisposition(phase2Res.code);
    if (disp === "retry") continue;
    break;
  }
  const finalDisp2 = await judgeDispatchDisposition(phase2Res.code);
  if (finalDisp2 !== "ruling") {
    return { ruling: null, resolution: "parked", cause: `phase-2 dispatch disposition "${finalDisp2}" (exit ${phase2Res.code})` };
  }
  const parsed = parseVerdictBlock(phase2Res.stdout, "build-judge-verdict");
  if (!parsed.ok) {
    return { ruling: null, resolution: "parked", cause: `phase-2 verdict block: ${parsed.cause}` };
  }
  const outcome = parsed.json && parsed.json.outcome;
  return { ruling: parsed.json, resolution: outcome === "OVERTURN" ? "overturned" : "pending", cause: null };
}

// dispatchJudgeRulings(ledger, caseFiles, judgeDir, { runReviewCall, judgeDispatchDisposition,
//   retryLimit }) -> mutates ledger.entries[*].{ruling,resolution} in place, writes
//   ruling-<case_id>.json for every dispatched (non-parked-at-assemble) case. Returns the
//   mutated ledger. Every dependency is injectable so a test never spawns review-call.mjs.
async function dispatchJudgeRulings(ledger, caseFiles, judgeDir, deps) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-build-judge-dispatch-"));
  try {
    for (const cid of ledger.order) {
      const entry = ledger.entries[cid];
      if (!entry || entry.resolution === "parked") continue; // already parked at assemble
      const caseFile = caseFiles[cid];
      const result = await dispatchOne(cid, caseFile, tmpDir, deps);
      entry.ruling = result.ruling;
      entry.resolution = result.resolution;
      if (result.cause) entry.park_cause = result.cause;
      if (result.ruling) {
        fs.writeFileSync(path.join(judgeDir, `ruling-${cid}.json`), JSON.stringify(result.ruling, null, 2) + "\n");
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return ledger;
}

// --- critical-free-latest floor (p-17) — computed HERE (CLI layer), never inside the pure
// admitBuildRollup. Reads the last dialogue round record's standing criticals and checks every
// one resolved to an OVERTURNed ledger entry. Missing/unreadable --dir or no rounds -> null
// (degraded -> admitBuildRollup fails it CLOSED).
function computeCriticalFreeLatestFloor(dir, ledger) {
  let files;
  try { files = roundFilesInDir(dir); } catch { return null; }
  if (!files.length) return null;
  const latestFile = files[files.length - 1];
  const read = readRoundRecord(latestFile.path);
  if (read.malformed || read.missing) return null;
  const standingIds = standingCriticalIds(read.record && read.record.findings);
  if (standingIds.length === 0) return true;
  const overturnedIds = new Set(
    Object.values((ledger && ledger.entries) || {})
      .filter((e) => e && e.resolution === "overturned")
      .map((e) => e.finding_id),
  );
  return standingIds.every((id) => overturnedIds.has(id));
}

// ===========================================================================
// CLI
// ===========================================================================

const BUILD_JUDGE_EVIDENCE_SPEC = {
  flags: {
    "--dir": { arity: 1 },
    "--issue": { arity: 1 },
    "--diff": { arity: 1 },
    "--out": { arity: 1 },
    "--run-id": { arity: 1 },
    "--run-dir": { arity: 1 },
    "--window-start": { arity: 1 },
    "--level": { arity: 1 },
    "--assemble": { arity: 0 },
    "--admit": { arity: 0 },
    "--repository-evidence": { arity: 1 },
    "--acceptance-criteria": { arity: 1 },
    "--retry-limit": { arity: 1 },
  },
};
const BUILD_JUDGE_EVIDENCE_USAGE =
  "usage: faff build-judge-evidence --assemble --dir <build-review-dir> --issue <issue> --diff <diff-file> " +
  "[--out <judge-dir>] [--acceptance-criteria <file>] [--repository-evidence <file>] [--window-start N] [--run-id ID] [--retry-limit N]\n" +
  "   or: faff build-judge-evidence --admit --dir <build-review-dir> --level <level> --run-dir <run-dir> [--out <judge-dir>]";

const DEFAULT_BUILD_JUDGE_RETRY_LIMIT = 2;

function cmdBuildJudgeEvidence(args) {
  const { values, errors } = parseArgs(args, BUILD_JUDGE_EVIDENCE_SPEC);
  if (errors.length) return usageError(errors, BUILD_JUDGE_EVIDENCE_USAGE);
  const modeCount = ["--assemble", "--admit"].filter((f) => values[f]).length;
  if (modeCount !== 1) {
    return usageError([{ code: "invalid-value", detail: "exactly one of --assemble or --admit is required" }], BUILD_JUDGE_EVIDENCE_USAGE);
  }
  if (values["--assemble"]) return cmdAssemble(values);
  return cmdAdmit(values);
}

function cmdAssemble(values, deps = {}) {
  const dir = values["--dir"];
  const issue = values["--issue"];
  const diffPath = values["--diff"];
  if (dir == null) return usageError([{ code: "missing-value", detail: "--assemble requires --dir" }], BUILD_JUDGE_EVIDENCE_USAGE);
  if (issue == null) return usageError([{ code: "missing-value", detail: "--assemble requires --issue" }], BUILD_JUDGE_EVIDENCE_USAGE);
  if (diffPath == null) return usageError([{ code: "missing-value", detail: "--assemble requires --diff" }], BUILD_JUDGE_EVIDENCE_USAGE);
  if (badBareId(issue)) return usageError([{ code: "invalid-value", detail: `--issue "${issue}" is not a bare id` }], BUILD_JUDGE_EVIDENCE_USAGE);

  const rawWindow = values["--window-start"];
  const windowStart = rawWindow == null ? 1 : parseInt(rawWindow, 10);
  if (rawWindow != null && (!/^\d+$/.test(String(rawWindow)) || windowStart < 1)) {
    return usageError([{ code: "invalid-value", detail: "--window-start expects an integer >= 1" }], BUILD_JUDGE_EVIDENCE_USAGE);
  }

  let files;
  try { files = roundFilesInDir(dir).filter((f) => f.n >= windowStart); }
  catch { console.log(JSON.stringify({ park: true, reason: "build-review dir unreadable" })); return 0; }

  const rounds = [];
  for (const f of files) {
    const read = readRoundRecord(f.path);
    if (read.malformed || read.missing) {
      const why = read.malformed ? `not valid JSON (${read.malformed})` : "could not be read (listed then vanished)";
      process.stderr.write(`faff build-judge-evidence --assemble: ${f.path} is ${why}\n`);
      return 2;
    }
    rounds.push(read.record || {});
  }

  let diffText;
  try { diffText = fs.readFileSync(diffPath, "utf8"); }
  catch (e) { process.stderr.write(`faff build-judge-evidence --assemble: cannot read --diff ${JSON.stringify(diffPath)}: ${e.message}\n`); return 2; }

  const acPath = values["--acceptance-criteria"];
  let acceptanceCriteria = "";
  if (acPath != null) {
    try { acceptanceCriteria = fs.readFileSync(acPath, "utf8"); }
    catch (e) { process.stderr.write(`faff build-judge-evidence --assemble: cannot read --acceptance-criteria ${JSON.stringify(acPath)}: ${e.message}\n`); return 2; }
  }
  const rePath = values["--repository-evidence"];
  let repositoryEvidenceText = "";
  if (rePath != null) {
    try { repositoryEvidenceText = fs.readFileSync(rePath, "utf8"); }
    catch (e) { process.stderr.write(`faff build-judge-evidence --assemble: cannot read --repository-evidence ${JSON.stringify(rePath)}: ${e.message}\n`); return 2; }
  }

  const runId = values["--run-id"] || issue;
  const outDir = values["--out"] || path.join(dir, "judge");

  const criticalsToAdjudicate = collectAdjudicationSet(rounds);
  const { caseFiles, ledger, parked } = assembleBuildCaseFiles({
    criticalsToAdjudicate, diffText, acceptanceCriteria, runId, windowStart, repositoryEvidenceText,
  });

  try { fs.mkdirSync(outDir, { recursive: true }); }
  catch (e) { process.stderr.write(`faff build-judge-evidence --assemble: cannot create --out ${JSON.stringify(outDir)}: ${e.message}\n`); return 2; }

  for (const cid of ledger.order) {
    if (caseFiles[cid]) fs.writeFileSync(path.join(outDir, `case-${cid}.json`), JSON.stringify(caseFiles[cid], null, 2) + "\n");
  }
  const writeLedger = () => {
    fs.writeFileSync(path.join(outDir, "ledger.json"), JSON.stringify(ledger, null, 2) + "\n", { mode: 0o600 });
    try { fs.chmodSync(path.join(outDir, "ledger.json"), 0o600); } catch { /* best-effort */ }
  };
  writeLedger();

  if (ledger.order.length === 0) {
    console.log(JSON.stringify({ assembled: 0, dispatched: 0, out: outDir, cases: [] }));
    return 0;
  }

  const rawRetryLimit = values["--retry-limit"];
  const retryLimit = rawRetryLimit != null && /^\d+$/.test(String(rawRetryLimit)) ? parseInt(rawRetryLimit, 10) : DEFAULT_BUILD_JUDGE_RETRY_LIMIT;
  const dispatchDeps = {
    runReviewCall: deps.runReviewCall || realRunReviewCall,
    judgeDispatchDisposition: deps.judgeDispatchDisposition || realJudgeDispatchDisposition,
    retryLimit,
  };

  return dispatchJudgeRulings(ledger, caseFiles, outDir, dispatchDeps).then((finalLedger) => {
    writeLedger(); // persist rulings/resolutions/park_cause mutated by the dispatch loop
    console.log(JSON.stringify({ assembled: finalLedger.order.length, dispatched: finalLedger.order.length - parked.length, out: outDir, cases: finalLedger.order }));
    return 0;
  }).catch((e) => {
    process.stderr.write(`faff build-judge-evidence --assemble: judge dispatch failed: ${(e && e.message) || e}\n`);
    return 2;
  });
}

function cmdAdmit(values) {
  const level = values["--level"];
  if (level == null) return usageError([{ code: "missing-value", detail: "--admit requires --level" }], BUILD_JUDGE_EVIDENCE_USAGE);
  const dir = values["--dir"];
  const outDir = values["--out"] || (dir ? path.join(dir, "judge") : null);
  if (outDir == null) return usageError([{ code: "missing-value", detail: "--admit requires --out (or --dir)" }], BUILD_JUDGE_EVIDENCE_USAGE);

  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(path.join(outDir, "ledger.json"), "utf8")); }
  catch (e) { process.stderr.write(`faff build-judge-evidence --admit: ledger.json unreadable/malformed in ${outDir}: ${e.message}\n`); return 2; }
  if (!ledger || !Array.isArray(ledger.order) || !ledger.entries) {
    process.stderr.write(`faff build-judge-evidence --admit: ledger.json in ${outDir} has no order[]/entries{}\n`); return 2;
  }

  const rulings = {};
  for (const cid of ledger.order) {
    const entry = ledger.entries[cid];
    if (entry && entry.resolution === "parked") { rulings[cid] = null; continue; }
    if (entry && entry.ruling) { rulings[cid] = entry.ruling; continue; }
    const rp = path.join(outDir, `ruling-${cid}.json`);
    let ruling;
    try { ruling = JSON.parse(fs.readFileSync(rp, "utf8")); }
    catch (e) { process.stderr.write(`faff build-judge-evidence --admit: missing/malformed ruling-${cid}.json in ${outDir}: ${e.message}\n`); return 2; }
    rulings[cid] = ruling;
  }

  const criticalFreeLatest = dir ? computeCriticalFreeLatestFloor(dir, ledger) : null;

  let result;
  try {
    result = admitBuildRollup({ ledger, rulings, floors: { critical_free_latest: criticalFreeLatest } });
  } catch (e) {
    if (e && e.failLoud) { process.stderr.write(`faff build-judge-evidence --admit: ${e.failLoud}\n`); return 2; }
    throw e;
  }
  result.level = level;
  try { fs.writeFileSync(path.join(outDir, "admit-result.json"), JSON.stringify(result, null, 2) + "\n"); }
  catch (e) { process.stderr.write(`faff build-judge-evidence --admit: warning — could not write admit-result.json: ${e.message}\n`); }
  console.log(JSON.stringify(result));
  return result.admit ? 0 : 1;
}

module.exports = {
  cmdBuildJudgeEvidence,
  cmdAssemble,
  cmdAdmit,
  collectAdjudicationSet,
  findLastKnownFinding,
  latestRebuttalFor,
  dispatchOne,
  dispatchJudgeRulings,
  computeCriticalFreeLatestFloor,
  realRunReviewCall,
  realJudgeDispatchDisposition,
};
