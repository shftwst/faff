// ===========================================================================
// === region:factory — governance-check — FAFF-363: the harness-independent CI enforcement binding ===
// The composition verb behind `.github/actions/governance-check` — the required
// status check that binds faff's governance floor to any emitter, not just the
// Claude Code harness. Composes ALREADY-SHIPPED cores: runcheck's completeness
// audit (`auditLedger`), the budget envelope's LAST recorded `budget-checkpoint`
// event (never a live token recompute), merge-gate's floor-artifact re-validation
// (`readAcComplete`/`readReviewVerdict`/`readHoldout` — the SAME functions
// `merge-gate` reads, never a forked rule), audit's events↔ledger coherence join
// (`buildReconstruction`), and the run-ledger's owner-block shape. Adds NO new
// invariant — every leg re-reads/re-validates a substrate an existing verb already
// produces or validates; this verb only aggregates the verdict and renders it.
//
// Factory (not governance), mirroring merge-gate's own placement for the identical
// reason (see REGION_MAP's merge-gate comment): this file references
// computeReviewVerdict-derived helpers from merge-gate.js/contract-defs.js
// (factory identifiers), so a governance-region tag would violate the direction
// lint (`faff regions check`) the instant it did.
//
// Pure evaluator posture: NO network call anywhere in this file. The only
// subprocess is a local `git rev-parse` (branch-name issue derivation) — repo
// introspection, not a network call. Every read is scoped to the given run
// dirs + the local repo; nothing here reaches the tracker, a forge API, or an
// LLM. Fail-closed on malformed input (a malformed run-ledger.json is a fail-loud
// exit 2, never a leg failure); explicit on absent (`--issue`/branch-derivation
// failing degrades to "every admitted issue with a terminal outcome", never a
// silent empty check).
// ===========================================================================

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { auditLedger, TERMINAL_STATES } = require("./runcheck");
const { readAcComplete, readHoldout, readReviewVerdict } = require("./merge-gate");
const { buildReconstruction, readEvents } = require("./audit");
const { FLOOR_LEVELS } = require("./contract-defs");
const { findRoot, readLedger } = require("./shared-infra");
const { sha256Hex, verifyChain } = require("./events");

// ---------------------------------------------------------------------------
// Leg: budget — the ledger envelope + the LAST recorded budget-checkpoint event.
// NEVER recomputes tokens (that stays `faff budget check`'s live-recompute job —
// this verb only re-reads what a run already recorded). A checkpoint's `data` is
// the `BudgetState` shape `faff budget check --json` emits: `{breached, outcome}`.
// Gates ONLY on `breached.length > 0 && outcome === "escalate"` (the recorded
// at_ceiling value at breach time) — a `stop`/`narrow` breach already ended that
// run cleanly and is not a merge-floor concern.
// ---------------------------------------------------------------------------

// Read events.jsonl for `budget-checkpoint` events only, in seq order. Returns
// `null` when events.jsonl itself is absent/unreadable (distinct from `[]` —
// present but carrying no checkpoints), so the caller can fall back to the
// ledger's own `stop_reason` (the one other durable record of a budget escalate).
function readBudgetCheckpoints(runDir) {
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8"); }
  catch { return null; }
  const records = raw.split("\n").filter((l) => l.trim() !== "")
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .filter((e) => e && e.type === "budget-checkpoint");
  records.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return records;
}

// PURE. `checkpoints` is the array `readBudgetCheckpoints` returns (or `null` for
// an absent/unreadable events substrate).
function evaluateBudgetLeg(ledger, checkpoints) {
  if (checkpoints === null) {
    const stopReason = (ledger && typeof ledger.stop_reason === "string") ? ledger.stop_reason : "";
    if (stopReason.startsWith("budget-escalated")) {
      return { pass: false, detail: `no events substrate — ledger stop_reason records ${stopReason}` };
    }
    return { pass: true, detail: "no checkpoints (events.jsonl absent) — ledger records no budget escalation" };
  }
  if (checkpoints.length === 0) return { pass: true, detail: "no budget-checkpoint events recorded" };
  const last = checkpoints[checkpoints.length - 1];
  const data = (last && typeof last.data === "object" && last.data) || {};
  const breached = Array.isArray(data.breached) ? data.breached : [];
  const outcome = data.outcome;
  if (breached.length > 0 && outcome === "escalate") {
    return { pass: false, detail: `breached [${breached.join(",")}] at outcome escalate (seq ${last.seq})` };
  }
  return {
    pass: true,
    detail: breached.length
      ? `breached [${breached.join(",")}] at outcome ${outcome} (non-gating — not escalate)`
      : "clean",
  };
}

// ---------------------------------------------------------------------------
// Leg: liveness — is the ledger's owner block WELL-FORMED (gating)? status +
// heartbeat age are REPORTED only, never gating — a committed snapshot cannot
// prove the emitting run is still heartbeat-live at CI time (see the spec's
// "snapshot divergence" failure mode), so this leg asserts SHAPE, not freshness.
// An absent owner block is legacy-tolerated (pre-owner-block ledgers exist).
// ---------------------------------------------------------------------------

const OWNER_STATUSES = new Set(["running", "done", "aborted-resumable"]);

function evaluateLivenessLeg(ledger, nowMs) {
  const owner = ledger ? ledger.owner : undefined;
  if (owner === undefined) {
    return { pass: true, detail: "no owner block (legacy run)", status: null, heartbeat_age_secs: null };
  }
  if (owner === null || typeof owner !== "object" || Array.isArray(owner)
      || typeof owner.status !== "string" || !OWNER_STATUSES.has(owner.status)) {
    return { pass: false, detail: `malformed owner block: ${JSON.stringify(owner)}`, status: null, heartbeat_age_secs: null };
  }
  let heartbeatAgeSecs = null;
  const t = Date.parse(owner.last_heartbeat);
  if (Number.isFinite(t)) heartbeatAgeSecs = Math.round((nowMs - t) / 1000);
  return {
    pass: true,
    detail: `status ${owner.status}${heartbeatAgeSecs != null ? `, heartbeat age ${heartbeatAgeSecs}s` : ""} (report-only — snapshot semantics)`,
    status: owner.status,
    heartbeat_age_secs: heartbeatAgeSecs,
  };
}

// ---------------------------------------------------------------------------
// Leg: merge_floor — for each target issue, re-validate the SAME persisted floor
// artifacts `faff merge-gate` reads, through the SAME functions (never a forked
// rule): `readAcComplete` + `readReviewVerdict` (both merge-gate.js). At L4 the
// floor ALSO covers the persisted holdout verdict (`readHoldout`), the same
// gate merge-gate applies under `--level L4`.
// ---------------------------------------------------------------------------

function evaluateMergeFloorLeg(runDir, issue, level) {
  const acComplete = readAcComplete(runDir, issue);
  const reviewVerdict = readReviewVerdict(runDir, issue);
  const reasons = [];
  if (!acComplete) reasons.push("ac-checklist.json missing/incomplete");
  if (reviewVerdict !== "pass") reasons.push(`review-verdict ${reviewVerdict}`);
  let holdout = null;
  if (level === "L4") {
    holdout = readHoldout(runDir, issue);
    if (holdout !== "meets-spec") reasons.push(`holdout ${holdout}`);
  }
  return { issue, pass: reasons.length === 0, ac_complete: acComplete, review_verdict: reviewVerdict, holdout, reasons };
}

// ---------------------------------------------------------------------------
// Leg: integrity (FAFF-568) — re-hash the committed chain and confirm the ledger
// fold. GATING (a broken chain must fail the merge, per the RFC), unlike coherence.
// COMPOSES `faff events verify`'s core (`verifyChain`) — never a forked hash-walk (the
// file's own invariant: a leg re-reads a verb's substrate). Classifies rather than
// blanket-failing: `verified`/`torn`/`legacy` (under pass|warn) pass; only `broken`
// (a prev/ledger mismatch — tampering) fails, plus `malformed` (a corrupt committed
// anchor — fail-closed). `legacy-unverifiable` under `legacy-policy: fail` also fails
// (the locked-down opt-in). An absent events.jsonl → verified (nothing to break), so
// a run/PR carrying no chain is a clean no-op.
// ---------------------------------------------------------------------------

function evaluateIntegrityLeg(dir, legacyPolicy = "pass") {
  const r = verifyChain(dir, { legacyPolicy });
  let pass;
  if (r.status === "verified") pass = true;
  else if (r.status === "legacy-unverifiable") pass = legacyPolicy !== "fail";
  else pass = false; // broken | malformed → fail-closed
  let detail = r.detail;
  if (r.status === "broken" && r.first_break) {
    detail = `broken at line ${r.first_break.line}${r.first_break.seq != null ? ` (seq ${r.first_break.seq})` : ""}`;
  } else if (r.status === "broken" && r.ledger_fold === "mismatch") {
    detail = "ledger fold mismatch (unrecorded ledger rewrite)";
  }
  return { pass, status: r.status, detail, first_break: r.first_break };
}

// An ANCHOR is a per-PR snapshot, not a live run dir — it is verified INTEGRITY-ONLY.
// The completeness/budget/merge_floor/liveness legs never run against it (its
// run-ledger.json is a frozen copy whose `admitted` array is run-scoped, not
// PR-scoped — sweeping it would false-fail on undispatched work). Returns the same
// run-result shape as `evaluateRunDir` so the renderers/reasons are unchanged, with
// the non-integrity legs marked n/a (pass, never gating). `pass = integrity.pass`.
function evaluateAnchorDir(dir, legacyPolicy = "pass") {
  const integrity = evaluateIntegrityLeg(dir, legacyPolicy);
  let label = path.basename(dir);
  try {
    const ch = JSON.parse(fs.readFileSync(path.join(dir, "chain-head.json"), "utf8"));
    if (ch && typeof ch.run_id === "string" && ch.run_id) label = ch.run_id + (ch.issue ? `/${ch.issue}` : "");
  } catch { /* no chain-head witness — label stays the dir basename */ }
  const naDetail = (name) => `n/a — anchor snapshot (${name} runs on live run dirs only)`;
  return {
    run_id: label,
    run_dir: dir,
    issues_checked: [],
    is_anchor: true,
    legs: {
      completeness: { pass: true, undispatched: [], invalid_outcomes: [], detail: naDetail("completeness") },
      budget: { pass: true, detail: naDetail("budget") },
      merge_floor: { pass: true, issues: [], detail: naDetail("merge_floor") },
      coherence: { clean: true },
      liveness: { pass: true, detail: naDetail("liveness"), status: null, heartbeat_age_secs: null },
      integrity,
    },
    pass: integrity.pass,
  };
}

// ---------------------------------------------------------------------------
// Issue derivation for the merge-floor leg: explicit `--issue` > branch-name
// match > every admitted issue with a terminal outcome in this run dir. PURE
// over its inputs (the branch-name regex match, and the ledger read) — the git
// spawn that PRODUCES the branch name lives in `deriveIssueFromBranch` below.
// ---------------------------------------------------------------------------

const ISSUE_BRANCH_RE = /[A-Za-z]+-[0-9]+/;

// PURE: extract the case-insensitive issue-shaped token from a branch name,
// upcased — the same heuristic the composite Action applies to derive its own
// `issue` input default from the PR head branch (spec §3, "issue" WHAT input).
function matchIssueFromBranchName(branchName) {
  if (typeof branchName !== "string") return null;
  const m = branchName.match(ISSUE_BRANCH_RE);
  return m ? m[0].toUpperCase() : null;
}

// Local git introspection only (no network) — resolve the checked-out branch
// name and extract an issue id from it. Any failure (detached HEAD, not a git
// repo, no match) degrades to `null`, never a thrown error.
function deriveIssueFromBranch(cwd) {
  const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8", timeout: 10000 });
  if (r.status !== 0) return null;
  return matchIssueFromBranchName((r.stdout || "").trim());
}

// PURE: the three-tier fallback. `explicitIssue` and `branchIssue` are already
// resolved by the caller (branchIssue is `null` whenever explicitIssue is set —
// the git spawn is skipped entirely in that case, an optimisation with no
// behavioural difference since explicit always wins).
function resolveTargetIssues(explicitIssue, branchIssue, ledger) {
  if (explicitIssue) return [explicitIssue];
  if (branchIssue) return [branchIssue];
  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object" && !Array.isArray(ledger.outcomes))
    ? ledger.outcomes : {};
  return Object.keys(outcomes).filter((issue) => TERMINAL_STATES.has(outcomes[issue]));
}

// ---------------------------------------------------------------------------
// Per-run-dir evaluation: the thin impure shell around the pure leg functions
// above. Malformed run-ledger.json (absent, unreadable, or auditLedger's own
// "outcomes must be an object" throw) is FAIL-LOUD — `{malformed:true}` — the
// caller turns that into exit 2, never a leg failure (spec §4 step 1).
// ---------------------------------------------------------------------------

function evaluateRunDir(runDir, opts) {
  let ledger;
  try { ledger = readLedger(runDir); }
  catch (e) { return { malformed: true, run_dir: runDir, error: `run-ledger.json unreadable/invalid JSON: ${e.message}` }; }

  const label = (ledger && typeof ledger.run_id === "string" && ledger.run_id) || path.basename(runDir);

  let audit;
  try { audit = auditLedger(ledger, label); }
  catch (e) { return { malformed: true, run_dir: runDir, error: `malformed run-ledger.json: ${e.message}` }; }
  const completeness = {
    pass: audit.clean,
    undispatched: audit.undispatched,
    invalid_outcomes: audit.invalid_outcomes,
    detail: audit.clean ? "clean" : `undispatched=[${audit.undispatched.join(",")}] invalid=[${audit.invalid_outcomes.join(",")}]`,
  };

  const checkpoints = readBudgetCheckpoints(runDir);
  const budget = evaluateBudgetLeg(ledger, checkpoints);
  const liveness = evaluateLivenessLeg(ledger, opts.nowMs);

  const branchIssue = opts.issue ? null : deriveIssueFromBranch(opts.root);
  const issues = resolveTargetIssues(opts.issue, branchIssue, ledger);
  const floorIssues = issues.map((issue) => evaluateMergeFloorLeg(runDir, issue, opts.level));
  const merge_floor = { pass: floorIssues.every((f) => f.pass), issues: floorIssues };

  // Coherence: reuse audit.js's OWN join verbatim (never a forked recompute) —
  // report-only, mirroring `faff audit`'s own posture (a readable run exits 0
  // even when incoherent). provenanceMap is deliberately {} — coherence never
  // depends on it, and reading `.faff/provenance/*` would be an unused I/O cost.
  const eventsResult = readEvents(runDir);
  const recon = buildReconstruction(label, runDir, eventsResult, ledger, {});
  const coherence = recon.coherence;

  // FAFF-568: integrity — re-hash this run dir's own committed chain (GATING). A live
  // run dir carries a valid chain by construction; an absent events.jsonl → verified.
  const integrity = evaluateIntegrityLeg(runDir, opts.legacyPolicy || "pass");

  const pass = completeness.pass && budget.pass && merge_floor.pass && liveness.pass && integrity.pass;

  return {
    run_id: label,
    run_dir: runDir,
    issues_checked: issues,
    legs: { completeness, budget, merge_floor, coherence, liveness, integrity },
    pass,
  };
}

// One reason string per failing GATING leg, naming run-id + leg + cause (spec's
// `GovernanceCheckVerdict.reasons` shape). Coherence never contributes (report-only).
function buildReasons(runResult) {
  const reasons = [];
  const { run_id, legs } = runResult;
  if (!legs.completeness.pass) reasons.push(`${run_id}: completeness — ${legs.completeness.detail}`);
  if (!legs.budget.pass) reasons.push(`${run_id}: budget — ${legs.budget.detail}`);
  if (!legs.merge_floor.pass) {
    for (const f of legs.merge_floor.issues) {
      if (!f.pass) reasons.push(`${run_id}: merge_floor — ${f.issue}: ${f.reasons.join("; ")}`);
    }
  }
  if (!legs.liveness.pass) reasons.push(`${run_id}: liveness — ${legs.liveness.detail}`);
  if (legs.integrity && !legs.integrity.pass) reasons.push(`${run_id}: integrity — ${legs.integrity.detail}`);
  return reasons;
}

function renderGovernanceCheckText(verdict) {
  for (const r of verdict.runs) {
    console.log(`run ${r.run_id}  (${r.run_dir})`);
    console.log(`  completeness: ${r.legs.completeness.pass ? "pass" : "FAIL"} — ${r.legs.completeness.detail}`);
    console.log(`  budget:       ${r.legs.budget.pass ? "pass" : "FAIL"} — ${r.legs.budget.detail}`);
    const floorDetail = r.legs.merge_floor.issues.length
      ? r.legs.merge_floor.issues.map((f) => `${f.issue}:${f.pass ? "pass" : f.reasons.join(",")}`).join("; ")
      : "(no target issues)";
    console.log(`  merge_floor:  ${r.legs.merge_floor.pass ? "pass" : "FAIL"} — ${floorDetail}`);
    console.log(`  coherence:    ${r.legs.coherence.clean ? "clean" : "findings"} (report-only)`);
    console.log(`  liveness:     ${r.legs.liveness.pass ? "pass" : "FAIL"} — ${r.legs.liveness.detail}`);
    if (r.legs.integrity) console.log(`  integrity:    ${r.legs.integrity.pass ? "pass" : "FAIL"} — ${r.legs.integrity.detail}`);
  }
  console.log(`\nverdict: ${verdict.pass ? "PASS" : "FAIL"}`);
  for (const reason of verdict.reasons) console.log(`  ✗ ${reason}`);
}

// Renders the SAME verdict as a job-summary markdown table — the flight-recorder
// readout, byte-identical whether it lands in a local terminal capture or
// $GITHUB_STEP_SUMMARY (the verb owns rendering, so local and CI never drift).
function renderGovernanceCheckSummaryMd(verdict) {
  const lines = ["# faff governance-check", "", `**verdict:** ${verdict.pass ? "✅ pass" : "❌ fail"}`, ""];
  for (const r of verdict.runs) {
    lines.push(`## ${r.run_id}`, "", "| leg | result | detail |", "|---|---|---|");
    lines.push(`| completeness | ${r.legs.completeness.pass ? "pass" : "**FAIL**"} | ${r.legs.completeness.detail} |`);
    lines.push(`| budget | ${r.legs.budget.pass ? "pass" : "**FAIL**"} | ${r.legs.budget.detail} |`);
    const floorDetail = r.legs.merge_floor.issues.length
      ? r.legs.merge_floor.issues.map((f) => `${f.issue}: ${f.pass ? "pass" : f.reasons.join("; ")}`).join("<br>")
      : "(no target issues)";
    lines.push(`| merge_floor | ${r.legs.merge_floor.pass ? "pass" : "**FAIL**"} | ${floorDetail} |`);
    lines.push(`| coherence _(report-only)_ | ${r.legs.coherence.clean ? "clean" : "findings"} | ${r.legs.coherence.clean ? "—" : "see \`faff audit ${r.run_id}\`"} |`);
    lines.push(`| liveness | ${r.legs.liveness.pass ? "pass" : "**FAIL**"} | ${r.legs.liveness.detail} |`);
    if (r.legs.integrity) lines.push(`| integrity | ${r.legs.integrity.pass ? "pass" : "**FAIL**"} | ${r.legs.integrity.detail} |`);
    lines.push("");
  }
  if (verdict.reasons.length) {
    lines.push("### failing reasons", "");
    for (const reason of verdict.reasons) lines.push(`- ${reason}`);
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function cmdGovernanceCheck(args) {
  if (args.includes("--selftest")) return governanceCheckSelftest();

  const json = args.includes("--json");
  const getAll = (flag) => {
    const out = [];
    for (let i = 0; i < args.length; i++) if (args[i] === flag) out.push(args[i + 1]);
    return out;
  };
  const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

  const runDirs = getAll("--run-dir");
  const anchorDirs = getAll("--anchor-dir");
  const issueFlag = get("--issue") || null;
  const levelFlag = get("--level") || "L3";
  const legacyPolicy = get("--legacy-policy") || "pass";
  const summaryMdPath = get("--summary-md");

  if (!runDirs.length && !anchorDirs.length) {
    process.stderr.write("faff governance-check: at least one --run-dir or --anchor-dir is required\n");
    return 2;
  }
  if (!FLOOR_LEVELS.includes(levelFlag)) {
    process.stderr.write(`faff governance-check: --level ${JSON.stringify(levelFlag)} not in {${FLOOR_LEVELS.join(",")}}\n`);
    return 2;
  }
  if (!["pass", "warn", "fail"].includes(legacyPolicy)) {
    process.stderr.write(`faff governance-check: --legacy-policy must be pass|warn|fail (got ${JSON.stringify(legacyPolicy)})\n`);
    return 2;
  }
  for (const d of [...runDirs, ...anchorDirs]) {
    if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) {
      process.stderr.write(`faff governance-check: run/anchor dir is not a directory: ${d}\n`);
      return 2;
    }
  }

  const root = findRoot();
  const nowMs = Date.now();
  const results = [];
  for (const d of runDirs) {
    const r = evaluateRunDir(d, { issue: issueFlag, level: levelFlag, nowMs, root, legacyPolicy });
    if (r.malformed) {
      process.stderr.write(`faff governance-check: ${r.run_dir}: ${r.error}\n`);
      return 2;
    }
    results.push(r);
  }
  // FAFF-568: anchors are integrity-verified ONLY — never swept as run dirs.
  for (const d of anchorDirs) {
    results.push(evaluateAnchorDir(d, legacyPolicy));
  }

  const pass = results.every((r) => r.pass);
  const reasons = results.flatMap(buildReasons);
  const verdict = { runs: results, pass, reasons };

  if (json) console.log(JSON.stringify(verdict));
  else renderGovernanceCheckText(verdict);
  if (summaryMdPath) {
    try { fs.appendFileSync(summaryMdPath, renderGovernanceCheckSummaryMd(verdict)); }
    catch (e) { process.stderr.write(`faff governance-check: warning — could not write --summary-md: ${e.message}\n`); }
  }

  return pass ? 0 : 1;
}

// ---------------------------------------------------------------------------
// --selftest — drives the pure leg functions + the full cmdGovernanceCheck shell
// (in-process, output captured) over real tmp-dir fixtures. Covers the spec's
// required table: pass, completeness-fail, budget-breach, floor-fail,
// malformed-ledger exit 2, and the multiple-run-dirs AND aggregation.
// ---------------------------------------------------------------------------

function mkTmpRunDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeLedger(runDir, ledger) {
  fs.writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
}

function writeFloorArtifacts(runDir, issue, { acComplete = true, reviewVerdict = "pass" } = {}) {
  const dir = path.join(runDir, issue);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ac-checklist.json"), JSON.stringify({ all_verified: acComplete }));
  fs.writeFileSync(path.join(dir, "review-verdict.json"), JSON.stringify({ signal: reviewVerdict, findings: [] }));
}

// Run `fn` with console.log/process.stdout.write/process.stderr.write swallowed;
// returns { result, stdout, stderr }. Mirrors merge-gate.js's own capture pattern
// for its effects-warning selftest cases.
function captureOutput(fn) {
  const origLog = console.log, origOut = process.stdout.write, origErr = process.stderr.write;
  let stdout = "", stderr = "";
  console.log = (...a) => { stdout += a.join(" ") + "\n"; };
  process.stdout.write = (chunk) => { stdout += chunk; return true; };
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  let result;
  try { result = fn(); }
  finally { console.log = origLog; process.stdout.write = origOut; process.stderr.write = origErr; }
  return { result, stdout, stderr };
}

function governanceCheckSelftest() {
  let fail = 0;
  const check = (label, cond, detail) => {
    if (!cond) { fail++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`ok   ${label}`);
  };

  // --- evaluateBudgetLeg ---
  check("budget: no events substrate + no escalate stop_reason → pass",
    evaluateBudgetLeg({}, null).pass === true);
  check("budget: no events substrate + budget-escalated(tokens) stop_reason → fail",
    evaluateBudgetLeg({ stop_reason: "budget-escalated(tokens)" }, null).pass === false);
  check("budget: events present, zero checkpoints → pass",
    evaluateBudgetLeg({}, []).pass === true);
  check("budget: last checkpoint breached at outcome escalate → fail",
    evaluateBudgetLeg({}, [{ seq: 0, data: { breached: ["tokens"], outcome: "escalate" } }]).pass === false);
  check("budget: last checkpoint breached at outcome stop (non-gating) → pass",
    evaluateBudgetLeg({}, [{ seq: 0, data: { breached: ["tokens"], outcome: "stop" } }]).pass === true);
  check("budget: last checkpoint clean → pass",
    evaluateBudgetLeg({}, [{ seq: 0, data: { breached: [], outcome: "none" } }]).pass === true);
  check("budget: LAST checkpoint wins (earlier escalate, later clean) → pass",
    evaluateBudgetLeg({}, [
      { seq: 0, data: { breached: ["tokens"], outcome: "escalate" } },
      { seq: 1, data: { breached: [], outcome: "none" } },
    ]).pass === true);
  check("budget: LAST checkpoint wins (earlier clean, later escalate) → fail",
    evaluateBudgetLeg({}, [
      { seq: 0, data: { breached: [], outcome: "none" } },
      { seq: 1, data: { breached: ["tokens"], outcome: "escalate" } },
    ]).pass === false);

  // --- evaluateLivenessLeg ---
  const NOW = Date.parse("2026-07-13T18:00:00Z");
  check("liveness: no owner block (legacy) → pass",
    evaluateLivenessLeg({}, NOW).pass === true);
  check("liveness: well-formed running owner → pass",
    evaluateLivenessLeg({ owner: { status: "running", last_heartbeat: "2026-07-13T17:59:00Z" } }, NOW).pass === true);
  check("liveness: well-formed done owner, no heartbeat → pass, age null",
    (() => { const r = evaluateLivenessLeg({ owner: { status: "done" } }, NOW); return r.pass === true && r.heartbeat_age_secs === null; })());
  check("liveness: owner present but missing status → fail",
    evaluateLivenessLeg({ owner: {} }, NOW).pass === false);
  check("liveness: owner status outside the closed set → fail",
    evaluateLivenessLeg({ owner: { status: "weird" } }, NOW).pass === false);
  check("liveness: owner is an array → fail",
    evaluateLivenessLeg({ owner: [] }, NOW).pass === false);
  check("liveness: owner is null → fail",
    evaluateLivenessLeg({ owner: null }, NOW).pass === false);

  // --- resolveTargetIssues ---
  check("issues: explicit --issue wins", resolveTargetIssues("FAFF-9", "FAFF-1", { outcomes: {} }).join(",") === "FAFF-9");
  check("issues: branch-derived when no explicit", resolveTargetIssues(null, "FAFF-2", { outcomes: {} }).join(",") === "FAFF-2");
  check("issues: falls back to every terminal-outcome admitted issue",
    resolveTargetIssues(null, null, { outcomes: { A: "shipped", B: "parked", C: "routed-out" } }).sort().join(",") === "A,B,C");
  check("issues: empty outcomes → empty set (vacuous, never a crash)",
    resolveTargetIssues(null, null, { outcomes: {} }).length === 0);

  // --- matchIssueFromBranchName (pure regex, no git spawn) ---
  check("branch: faff-363-governance-check-... → FAFF-363", matchIssueFromBranchName("faff-363-governance-check-github-action") === "FAFF-363");
  check("branch: feature/FAFF-42-foo → FAFF-42", matchIssueFromBranchName("feature/FAFF-42-foo") === "FAFF-42");
  check("branch: main → null (no issue-shaped token)", matchIssueFromBranchName("main") === null);
  check("branch: non-string → null", matchIssueFromBranchName(undefined) === null);

  // --- evaluateMergeFloorLeg (real fs fixtures) ---
  {
    const tmp = mkTmpRunDir("faff-govcheck-floor-");
    try {
      writeFloorArtifacts(tmp, "FAFF-1", { acComplete: true, reviewVerdict: "pass" });
      check("floor: ac-complete + review pass → pass", evaluateMergeFloorLeg(tmp, "FAFF-1", "L3").pass === true);

      writeFloorArtifacts(tmp, "FAFF-2", { acComplete: false, reviewVerdict: "pass" });
      check("floor: ac incomplete → fail", evaluateMergeFloorLeg(tmp, "FAFF-2", "L3").pass === false);

      writeFloorArtifacts(tmp, "FAFF-3", { acComplete: true, reviewVerdict: "fail" });
      check("floor: review-verdict fail → fail", evaluateMergeFloorLeg(tmp, "FAFF-3", "L3").pass === false);

      check("floor: missing artifacts entirely → fail (fail-closed)", evaluateMergeFloorLeg(tmp, "FAFF-404", "L3").pass === false);

      writeFloorArtifacts(tmp, "FAFF-4", { acComplete: true, reviewVerdict: "pass" });
      check("floor: L4 with no holdout.json → fail (holdout missing)", evaluateMergeFloorLeg(tmp, "FAFF-4", "L4").pass === false);
      check("floor: L3 (same issue, no holdout required) → pass", evaluateMergeFloorLeg(tmp, "FAFF-4", "L3").pass === true);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // --- evaluateRunDir + cmdGovernanceCheck: full spec table over real fixtures ---
  {
    const tmp = mkTmpRunDir("faff-govcheck-pass-");
    try {
      writeLedger(tmp, { run_id: "R1", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } });
      writeFloorArtifacts(tmp, "FAFF-1", { acComplete: true, reviewVerdict: "pass" });
      const { result, stdout } = captureOutput(() => cmdGovernanceCheck(["--run-dir", tmp, "--issue", "FAFF-1", "--json"]));
      check("cmd: clean ledger + valid floor → exit 0", result === 0);
      check("cmd: --json emits a parseable verdict", (() => { try { return JSON.parse(stdout).pass === true; } catch { return false; } })());
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  {
    const tmp = mkTmpRunDir("faff-govcheck-completeness-");
    try {
      writeLedger(tmp, { run_id: "R2", admitted: ["FAFF-1", "FAFF-2"], outcomes: { "FAFF-1": "shipped" } });
      const { result } = captureOutput(() => cmdGovernanceCheck(["--run-dir", tmp, "--issue", "FAFF-1"]));
      check("cmd: undispatched admitted issue → exit 1 (completeness fail)", result === 1);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  {
    const tmp = mkTmpRunDir("faff-govcheck-budget-");
    try {
      writeLedger(tmp, { run_id: "R3", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } });
      writeFloorArtifacts(tmp, "FAFF-1", { acComplete: true, reviewVerdict: "pass" });
      fs.appendFileSync(path.join(tmp, "events.jsonl"),
        JSON.stringify({ schema: 1, run_id: "R3", seq: 0, ts: "t", phase: "run", type: "budget-checkpoint", data: { breached: ["tokens"], outcome: "escalate" } }) + "\n");
      const { result } = captureOutput(() => cmdGovernanceCheck(["--run-dir", tmp, "--issue", "FAFF-1"]));
      check("cmd: recorded budget escalate → exit 1 (budget fail)", result === 1);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  {
    const tmp = mkTmpRunDir("faff-govcheck-floorfail-");
    try {
      writeLedger(tmp, { run_id: "R4", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } });
      writeFloorArtifacts(tmp, "FAFF-1", { acComplete: true, reviewVerdict: "needs-human" });
      const { result } = captureOutput(() => cmdGovernanceCheck(["--run-dir", tmp, "--issue", "FAFF-1"]));
      check("cmd: tampered/non-pass review-verdict → exit 1 (merge_floor fail)", result === 1);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  {
    const tmp = mkTmpRunDir("faff-govcheck-malformed-");
    try {
      fs.writeFileSync(path.join(tmp, "run-ledger.json"), "{ not valid json");
      const { result } = captureOutput(() => cmdGovernanceCheck(["--run-dir", tmp]));
      check("cmd: malformed run-ledger.json → exit 2 (fail-loud, not a leg failure)", result === 2);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  {
    // Multiple run dirs AND: one clean, one with an undispatched issue → overall fail.
    const tmpA = mkTmpRunDir("faff-govcheck-and-a-");
    const tmpB = mkTmpRunDir("faff-govcheck-and-b-");
    try {
      writeLedger(tmpA, { run_id: "RA", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } });
      writeFloorArtifacts(tmpA, "FAFF-1", { acComplete: true, reviewVerdict: "pass" });
      writeLedger(tmpB, { run_id: "RB", admitted: ["FAFF-9"], outcomes: {} });
      const { result } = captureOutput(() => cmdGovernanceCheck(["--run-dir", tmpA, "--run-dir", tmpB, "--issue", "FAFF-1"]));
      check("cmd: multiple run dirs, one clean + one incomplete → exit 1 (AND over runs)", result === 1);

      const { result: bothClean } = captureOutput(() => cmdGovernanceCheck(["--run-dir", tmpA, "--issue", "FAFF-1"]));
      check("cmd: sanity — the clean dir alone passes", bothClean === 0);
    } finally {
      fs.rmSync(tmpA, { recursive: true, force: true });
      fs.rmSync(tmpB, { recursive: true, force: true });
    }
  }

  {
    // Coherence never gates: an events↔ledger mismatch is a finding, not a failure.
    const tmp = mkTmpRunDir("faff-govcheck-coherence-");
    try {
      writeLedger(tmp, { run_id: "R5", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "parked" } });
      writeFloorArtifacts(tmp, "FAFF-1", { acComplete: true, reviewVerdict: "pass" });
      fs.appendFileSync(path.join(tmp, "events.jsonl"),
        JSON.stringify({ schema: 1, run_id: "R5", seq: 0, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } }) + "\n");
      const r = evaluateRunDir(tmp, { issue: "FAFF-1", level: "L3", nowMs: Date.now(), root: tmp });
      check("coherence: mismatch present in the finding", r.legs.coherence.clean === false);
      check("coherence: run STILL passes (report-only, never gates)", r.pass === true);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // --- integrity leg + anchor routing (FAFF-568) ---
  const buildChainFixture = (dir, runId, payloads) => {
    let prevBytes = null;
    const lines = [];
    payloads.forEach((p, i) => {
      const prev = prevBytes === null ? sha256Hex(Buffer.from(runId, "utf8")) : sha256Hex(prevBytes);
      const line = JSON.stringify({ schema: 2, run_id: runId, seq: i, ts: "t", prev, ...p });
      lines.push(line);
      prevBytes = Buffer.from(line, "utf8");
    });
    fs.writeFileSync(path.join(dir, "events.jsonl"), lines.join("\n") + "\n");
    return lines;
  };
  {
    const tmp = mkTmpRunDir("faff-govcheck-integrity-");
    try {
      buildChainFixture(tmp, "run-i", [
        { phase: "run", type: "run-start" },
        { phase: "build", type: "build-start", issue: "FAFF-1" },
      ]);
      check("integrity: clean chain → leg pass", evaluateIntegrityLeg(tmp, "pass").pass === true);
      const p = path.join(tmp, "events.jsonl");
      const ls = fs.readFileSync(p, "utf8").split("\n");
      ls[0] = ls[0].replace('"run-start"', '"run-abort"'); // equal-length byte edit of line 1
      fs.writeFileSync(p, ls.join("\n"));
      const broken = evaluateIntegrityLeg(tmp, "pass");
      check("integrity: broken chain → leg fail", broken.pass === false && broken.status === "broken");
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  check("integrity: absent events.jsonl → leg pass (no chain to break)",
    evaluateIntegrityLeg(path.join(os.tmpdir(), "faff-govcheck-noexist-" + Date.now()), "pass").pass === true);
  {
    const tmp = mkTmpRunDir("faff-govcheck-legacy-anchor-");
    try {
      fs.writeFileSync(path.join(tmp, "events.jsonl"),
        JSON.stringify({ schema: 1, run_id: "run-l", seq: 0, ts: "t", phase: "run", type: "run-start" }) + "\n");
      check("integrity: legacy schema-1 anchor under pass → leg pass", evaluateIntegrityLeg(tmp, "pass").pass === true);
      check("integrity: legacy schema-1 anchor under fail → leg fail", evaluateIntegrityLeg(tmp, "fail").pass === false);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  {
    // Anchor routing: a clean anchor passes; a broken anchor gates the aggregate + names integrity.
    const clean = mkTmpRunDir("faff-govcheck-anchor-clean-");
    const broken = mkTmpRunDir("faff-govcheck-anchor-broken-");
    try {
      buildChainFixture(clean, "run-c", [
        { phase: "run", type: "run-start" },
        { phase: "build", type: "build-start", issue: "FAFF-1" },
      ]);
      const { result: cleanRc } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", clean]));
      check("anchor: clean chain → exit 0 (integrity-only, no run-dir sweep)", cleanRc === 0);

      buildChainFixture(broken, "run-b", [
        { phase: "run", type: "run-start" },
        { phase: "build", type: "build-start", issue: "FAFF-1" },
        { phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } },
      ]);
      const bp = path.join(broken, "events.jsonl");
      const bls = fs.readFileSync(bp, "utf8").split("\n");
      bls[1] = bls[1].replace('"build-start"', '"build-abort"'); // equal-length byte edit of line 2
      fs.writeFileSync(bp, bls.join("\n"));
      const { result: brokenRc, stdout } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", broken, "--json"]));
      check("anchor: broken chain → exit 1 (integrity gates)", brokenRc === 1);
      check("anchor: broken chain → reason names integrity",
        (() => { try { return JSON.parse(stdout).reasons.some((x) => /integrity/.test(x)); } catch { return false; } })());
    } finally {
      fs.rmSync(clean, { recursive: true, force: true });
      fs.rmSync(broken, { recursive: true, force: true });
    }
  }
  {
    // A run dir carrying a clean chain still passes end-to-end (integrity wired into the full sweep).
    const tmp = mkTmpRunDir("faff-govcheck-rundir-chain-");
    try {
      writeLedger(tmp, { run_id: "run-rc", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } });
      writeFloorArtifacts(tmp, "FAFF-1", { acComplete: true, reviewVerdict: "pass" });
      buildChainFixture(tmp, "run-rc", [
        { phase: "run", type: "run-start" },
        { phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } },
      ]);
      const { result } = captureOutput(() => cmdGovernanceCheck(["--run-dir", tmp, "--issue", "FAFF-1"]));
      check("run-dir: clean chain + valid floor → exit 0 (integrity leg passes in full sweep)", result === 0);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  // --- usage errors ---
  {
    const { result } = captureOutput(() => cmdGovernanceCheck([]));
    check("cmd: no --run-dir/--anchor-dir → exit 2 (usage)", result === 2);
  }
  {
    const tmp = mkTmpRunDir("faff-govcheck-badlevel-");
    try {
      writeLedger(tmp, { run_id: "R6", admitted: [], outcomes: {} });
      const { result } = captureOutput(() => cmdGovernanceCheck(["--run-dir", tmp, "--level", "L9"]));
      check("cmd: unrecognised --level → exit 2 (usage)", result === 2);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  {
    const { result } = captureOutput(() => cmdGovernanceCheck(["--run-dir", "/definitely/not/a/real/path"]));
    check("cmd: nonexistent --run-dir → exit 2 (usage)", result === 2);
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (governance-check pure cores + shell, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  cmdGovernanceCheck,
  evaluateAnchorDir,
  evaluateBudgetLeg,
  evaluateIntegrityLeg,
  evaluateLivenessLeg,
  evaluateMergeFloorLeg,
  evaluateRunDir,
  governanceCheckSelftest,
  matchIssueFromBranchName,
  readBudgetCheckpoints,
  renderGovernanceCheckSummaryMd,
  resolveTargetIssues,
};
