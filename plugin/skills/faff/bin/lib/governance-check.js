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
// silent empty check). Anchor paths are PR-controlled input: `--derive-anchor-dirs`
// (the Action's discovery core) rejects traversal segments and realpath-contains
// every derived dir under the anchors root, and `--anchors-root` re-asserts that
// containment on the supplied `--anchor-dir`s (fail-loud exit 2, never a redirect).
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
const { computeChainHead, sha256Hex, verifyChain } = require("./events");

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
// blanket-failing: `verified` passes; `legacy-unverifiable` and `mixed` gate per
// legacy-policy (fail under `fail`; pass — with a loud note under `warn` — otherwise);
// `broken` (a prev/ledger mismatch — tampering), `witness-mismatch` (the chain-head.json
// witness disagrees with the re-derived log — a post-anchor rewrite, failed regardless
// of legacy-policy), and `malformed` (a corrupt committed anchor) all fail-closed. An
// absent events.jsonl → verified (nothing to break), so a run/PR carrying no chain is
// a clean no-op. Under `requireWitness` (anchor evaluation only) an events.jsonl with
// no chain-head.json beside it is `witness-absent` — fail-closed, since deleting the
// witness would otherwise re-open every spoof the cross-check closed. `note` (when
// set) is a warning line the shell emits to stderr and the renderers carry in the
// detail column — `warn` is never silently identical to `pass`.
// ---------------------------------------------------------------------------

function evaluateIntegrityLeg(dir, legacyPolicy = "pass", opts = {}) {
  const r = verifyChain(dir, { legacyPolicy });
  let pass, note = null;
  if (r.status === "verified") pass = true;
  else if (r.status === "legacy-unverifiable" || r.status === "mixed") {
    pass = legacyPolicy !== "fail";
    if (pass && legacyPolicy === "warn") {
      note = r.status === "mixed"
        ? "mixed chain (prev-less lines content-unverifiable) — pass under legacy-policy warn"
        : "legacy schema-1 log (no chain) — pass under legacy-policy warn";
    }
  } else pass = false; // broken | witness-mismatch | malformed → fail-closed
  // FAFF-568 fix pass 2: an ANCHOR requires its witness. `faff events anchor` always
  // writes chain-head.json, so an anchor dir carrying events.jsonl with NO witness
  // means post-anchor deletion or a broken writer — and deleting the witness would
  // otherwise re-open the legacy-downgrade spoof the cross-check closed. Fail-closed
  // (`witness-absent`), but only when the leg would otherwise pass: an already-failing
  // status (broken / witness-mismatch / malformed / policy-fail) keeps its more
  // specific forensics. `requireWitness` is set ONLY when the dir is evaluated AS an
  // anchor (evaluateAnchorDir) — a bare run dir has no witness by design, and the
  // verb path (`faff events verify`) is unchanged.
  if (opts.requireWitness && pass && r.witness === "absent" && fs.existsSync(path.join(dir, "events.jsonl"))) {
    return {
      pass: false, status: "witness-absent",
      detail: "witness-absent: anchor carries events.jsonl but no chain-head.json — an anchor is CLI-written with its witness, so absence means post-anchor deletion or a broken writer (fail-closed)",
      first_break: null, note: null, torn_tail: r.torn_tail, witness: "absent",
    };
  }
  let detail = r.detail;
  if (r.status === "broken" && r.first_break) {
    detail = `broken at line ${r.first_break.line}${r.first_break.seq != null ? ` (seq ${r.first_break.seq})` : ""}`;
  } else if (r.status === "broken" && r.ledger_fold === "mismatch") {
    detail = "ledger fold mismatch (unrecorded ledger rewrite)";
  }
  if (note) detail = `${detail} [warn]`;
  return { pass, status: r.status, detail, first_break: r.first_break, note, torn_tail: r.torn_tail, witness: r.witness };
}

// An ANCHOR is a per-PR snapshot, not a live run dir — completeness/budget/liveness never run
// against it (its run-ledger.json is a frozen copy whose `admitted` array is run-scoped, not
// PR-scoped — sweeping it would false-fail on undispatched work). FAFF-623: merge_floor DOES
// run against it — unlike completeness/budget it reads only per-ISSUE floor artifacts
// (ac-checklist.json / review-verdict.json / holdout.json), which `faff events anchor` now also
// copies DIRECTLY INTO the anchor dir (`--dest`), and nothing about the leg depends on the rest
// of a shared run. Reused via `evaluateMergeFloorLeg(dir, ".", level)` — the "." issue segment is
// a deliberate `path.join` no-op (`path.join(dir, ".", "x")` normalises to `path.join(dir, "x")`),
// so the floor files are read straight out of `dir` itself. This is chosen over the tempting
// `evaluateMergeFloorLeg(path.dirname(dir), issue, level)` shortcut, which only works when the
// anchor dir's OWN BASENAME happens to equal the issue id (true for graft's own
// `.faff/anchors/<run>/<issue>/` convention, but not a real invariant of this function or of
// `--anchor-dir` callers generally — the "." form has no such hidden dependency on caller-chosen
// directory names). `issue` for display/reasons purposes is still resolved from chain-head.json
// (falling back to the dir basename only when that's unreadable) and spliced onto the result
// below, independently of the file-lookup path. Returns the same run-result shape as
// `evaluateRunDir` so the renderers/reasons are unchanged; completeness/budget/liveness stay n/a.
// `pass = integrity.pass && merge_floor.pass`.
function evaluateAnchorDir(dir, legacyPolicy = "pass", level = "L3") {
  const integrity = evaluateIntegrityLeg(dir, legacyPolicy, { requireWitness: true });
  let label = path.basename(dir);
  let issue = path.basename(dir);
  try {
    const ch = JSON.parse(fs.readFileSync(path.join(dir, "chain-head.json"), "utf8"));
    if (ch && typeof ch.run_id === "string" && ch.run_id) label = ch.run_id + (ch.issue ? `/${ch.issue}` : "");
    if (ch && typeof ch.issue === "string" && ch.issue) issue = ch.issue;
  } catch { /* no chain-head witness — label/issue stay the dir basename */ }
  // FAFF-690 (F1b): derive the merge-floor level from the anchor's OWN committed run-ledger.json (the
  // same head-sha-pinned byte-copy `faff events anchor` writes into the dir), so the required
  // branch-protection-gated CI check and merge-gate consult the same pinned truth and cannot disagree
  // — an L4-anchored PR then has its holdout leg enforced by CI independently of merge-gate. Only
  // STRENGTHENS: a non-L4 / legacy / level-less / unreadable anchor keeps today's `--level`-flag
  // behaviour (fail-closed to the flag, unchanged).
  let effectiveLevel = level;
  try {
    const anchorLedger = JSON.parse(fs.readFileSync(path.join(dir, "run-ledger.json"), "utf8"));
    if (anchorLedger && FLOOR_LEVELS.includes(anchorLedger.level)) effectiveLevel = anchorLedger.level;
  } catch { /* no/unreadable/malformed anchor ledger → keep the --level flag (unchanged) */ }
  // Wrapped in the same `{ pass, issues: [...] }` shape `evaluateRunDir` uses (line ~376) —
  // buildReasons/the text+markdown renderers index `legs.merge_floor.issues`, so the raw
  // per-issue evaluateMergeFloorLeg result (no `issues` array) must never be assigned directly.
  const floorResult = { ...evaluateMergeFloorLeg(dir, ".", effectiveLevel), issue };
  const merge_floor = { pass: floorResult.pass, issues: [floorResult] };
  const naDetail = (name) => `n/a — anchor snapshot (${name} runs on live run dirs only)`;
  return {
    run_id: label,
    run_dir: dir,
    issues_checked: [issue],
    is_anchor: true,
    legs: {
      completeness: { pass: true, undispatched: [], invalid_outcomes: [], detail: naDetail("completeness") },
      budget: { pass: true, detail: naDetail("budget") },
      merge_floor,
      coherence: { clean: true },
      liveness: { pass: true, detail: naDetail("liveness"), status: null, heartbeat_age_secs: null },
      integrity,
    },
    pass: integrity.pass && merge_floor.pass,
  };
}

// ---------------------------------------------------------------------------
// Anchor discovery core (FAFF-568 fix pass) — the Action's `--derive-anchor-dirs`
// mode composes this. Input: the PR diff's changed paths + the configured
// anchors-path. Output: the anchor dirs (<anchors-path>/<run>/<issue>) to verify,
// derived by PREFIX-STRIPPING (works for any anchors-path depth — 1, 2, 3+
// segments — never an awk segment-count heuristic), plus the dropped paths with
// reasons (the caller warns loudly; a drop is never silent). Containment is
// two-fold: any ".."/"."/empty segment below the prefix is rejected (traversal),
// and each surviving dir must REALPATH-resolve under the anchors root (symlink
// escape — a PR can commit a symlink). A dir the PR itself deleted is skipped
// ("not carried anymore", mirroring the run-dir discovery's posture).
// ---------------------------------------------------------------------------

function deriveAnchorDirs(changedPaths, anchorsPath) {
  const prefix = String(anchorsPath).replace(/\/+$/, "");
  const dirs = [];
  const dropped = [];
  const seen = new Set();
  for (const p of changedPaths) {
    const f = String(p).trim();
    if (!f) continue;
    if (!f.startsWith(prefix + "/")) continue; // not under anchors-path — not ours
    const segs = f.slice(prefix.length + 1).split("/");
    if (segs.some((s) => s === ".." || s === "." || s === "")) {
      dropped.push({ path: f, reason: "path-traversal segment below anchors-path" });
      continue;
    }
    if (segs.length < 3) {
      dropped.push({ path: f, reason: "too shallow — an anchor file lives at <anchors-path>/<run>/<issue>/<file>" });
      continue;
    }
    const dir = `${prefix}/${segs[0]}/${segs[1]}`;
    if (seen.has(dir)) continue;
    seen.add(dir);
    let st;
    try { st = fs.statSync(dir); } catch { continue; } // the PR deleted it — not carried anymore
    if (!st.isDirectory()) continue;
    let rootReal, dirReal;
    try { rootReal = fs.realpathSync(prefix); dirReal = fs.realpathSync(dir); }
    catch { dropped.push({ path: f, reason: "anchors-path/anchor dir unresolvable" }); continue; }
    if (dirReal !== rootReal && !dirReal.startsWith(rootReal + path.sep)) {
      dropped.push({ path: f, reason: "resolves outside anchors-path (symlink escape)" });
      continue;
    }
    dirs.push(dir);
  }
  return { dirs: dirs.sort(), dropped };
}

// Re-assert containment on an explicit `--anchor-dir` when `--anchors-root` is
// supplied (defence-in-depth behind the discovery above — the CLI never trusts
// that its caller already contained the path). Returns null when contained, a
// human-readable violation string otherwise. Fail-closed on unresolvable paths.
function anchorDirContainmentViolation(anchorDir, anchorsRoot) {
  let rootReal, dirReal;
  try { rootReal = fs.realpathSync(anchorsRoot); dirReal = fs.realpathSync(anchorDir); }
  catch (e) { return `cannot resolve for containment: ${e.message}`; }
  if (dirReal !== rootReal && !dirReal.startsWith(rootReal + path.sep)) {
    return `resolves to ${dirReal}, outside the anchors root ${rootReal}`;
  }
  return null;
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

const { parseArgs, usageError } = require("./argv");
const GOVERNANCE_CHECK_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 },
  "--run-dir": { arity: 1, repeatable: true }, "--issue": { arity: 1 }, "--level": { arity: 1 }, "--summary-md": { arity: 1 },
  // FAFF-568/623: anchors are integrity + merge-floor targets (never the run-scoped
  // completeness/budget/liveness sweep); --anchors-root re-asserts containment;
  // --derive-anchor-dirs is the Action's discovery mode (changed paths on stdin).
  "--anchor-dir": { arity: 1, repeatable: true }, "--legacy-policy": { arity: 1 },
  "--anchors-root": { arity: 1 }, "--derive-anchor-dirs": { arity: 1 },
} };

function cmdGovernanceCheck(args) {
  if (args.includes("--selftest")) return governanceCheckSelftest();

  const { values, errors } = parseArgs(args, GOVERNANCE_CHECK_SPEC);
  if (errors.length) return usageError(errors, "usage: faff governance-check --run-dir DIR... [--anchor-dir DIR...] [--anchors-root DIR] [--legacy-policy pass|warn|fail] [--issue ID] [--level L1|L2|L3|L4] [--summary-md FILE] [--json] | --derive-anchor-dirs ANCHORS_PATH");
  const json = !!values["--json"];

  // FAFF-568 fix pass: `--derive-anchor-dirs <ANCHORS_PATH>` — the Action's anchor
  // discovery core. Reads the PR diff's changed paths from stdin (one per line),
  // prints the derived, containment-checked anchor dirs to stdout (one per line),
  // warns on stderr for every dropped path. One home for the derivation rule — the
  // workflow shell never re-implements it with awk.
  const derivePath = values["--derive-anchor-dirs"] === undefined ? null : values["--derive-anchor-dirs"];
  if (derivePath !== null) {
    if (!derivePath) {
      process.stderr.write("faff governance-check: --derive-anchor-dirs requires the anchors-path value\n");
      return 2;
    }
    let raw = "";
    try { raw = fs.readFileSync(0, "utf8"); } catch { raw = ""; }
    const { dirs, dropped } = deriveAnchorDirs(raw.split("\n"), derivePath);
    for (const d of dropped) process.stderr.write(`faff governance-check: anchor path dropped — ${d.reason}: ${d.path}\n`);
    for (const d of dirs) console.log(d);
    return 0;
  }

  const runDirs = values["--run-dir"] || [];
  const anchorDirs = values["--anchor-dir"] || [];
  const issueFlag = values["--issue"] || null;
  const levelFlag = values["--level"] || "L3";
  const legacyPolicy = values["--legacy-policy"] || "pass";
  const anchorsRoot = values["--anchors-root"] === undefined ? null : values["--anchors-root"];
  const summaryMdPath = values["--summary-md"] === undefined ? null : values["--summary-md"];

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
  // FAFF-568 fix pass: with `--anchors-root` supplied, every `--anchor-dir` must
  // realpath-contain under it — a PR-controlled path that escapes the anchors
  // subtree is a fail-loud exit 2 (a redirected verification target, never verified).
  if (anchorsRoot) {
    for (const d of anchorDirs) {
      const violation = anchorDirContainmentViolation(d, anchorsRoot);
      if (violation) {
        process.stderr.write(`faff governance-check: --anchor-dir ${d} ${violation}\n`);
        return 2;
      }
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
  // FAFF-568: anchors are integrity-verified always; FAFF-623: also merge-floor-verified
  // (never completeness/budget/liveness-swept — those stay run-scoped, see evaluateAnchorDir).
  for (const d of anchorDirs) {
    results.push(evaluateAnchorDir(d, legacyPolicy, levelFlag));
  }

  const pass = results.every((r) => r.pass);
  const reasons = results.flatMap(buildReasons);
  const verdict = { runs: results, pass, reasons };

  // FAFF-568 fix pass: legacy-policy `warn` actually warns — one stderr line per
  // integrity note (legacy/mixed under warn), distinct from a silent `pass`. The
  // note also rides the detail column in both renderers.
  for (const r of results) {
    if (r.legs.integrity && r.legs.integrity.note) {
      process.stderr.write(`faff governance-check: ${r.run_id}: integrity — ${r.legs.integrity.note}\n`);
    }
  }

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
  // An anchor fixture carries its CLI-shape witness (fix pass 2: anchors REQUIRE one).
  const writeWitness = (dir, runId, issue) => fs.writeFileSync(path.join(dir, "chain-head.json"),
    JSON.stringify(computeChainHead(fs.readFileSync(path.join(dir, "events.jsonl")), runId, issue), null, 2) + "\n");
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
      // Fix pass 2: an anchor without its witness now fails (witness-absent) — assert
      // that first, then add the witness and assert the clean pass.
      const { result: noWitnessRc, stdout: noWitnessOut } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", clean, "--json"]));
      check("anchor: events.jsonl with NO chain-head.json → exit 1 (witness-absent, fail-closed)", noWitnessRc === 1);
      check("anchor: witness-absent names the condition in the reason",
        (() => { try { return JSON.parse(noWitnessOut).reasons.some((x) => /witness-absent/.test(x)); } catch { return false; } })());
      writeWitness(clean, "run-c", "FAFF-1");
      // Pre-FAFF-623: no merge-floor evidence in the anchor → merge_floor now correctly fails,
      // even though integrity is clean — asserted explicitly before adding the floor files.
      const { result: noFloorRc } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", clean]));
      check("anchor: clean chain but NO merge-floor evidence → exit 1 (merge_floor fail, integrity still clean)", noFloorRc === 1);
      // FAFF-623: ac-checklist.json/review-verdict.json copied straight into the anchor dir
      // (mirroring `faff events anchor`'s own copy target) → merge_floor now passes too.
      fs.writeFileSync(path.join(clean, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
      fs.writeFileSync(path.join(clean, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
      const { result: cleanRc } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", clean]));
      check("anchor: clean chain + clean merge-floor evidence → exit 0 (integrity + merge_floor, no full run-dir sweep)", cleanRc === 0);

      buildChainFixture(broken, "run-b", [
        { phase: "run", type: "run-start" },
        { phase: "build", type: "build-start", issue: "FAFF-1" },
        { phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } },
      ]);
      writeWitness(broken, "run-b", "FAFF-1"); // pre-tamper witness: the head line stays intact, so `broken` keeps its own forensics
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
    // FAFF-568 fix pass: witness cross-check — a spoofed legacy downgrade is a FAIL
    // under ANY legacy-policy, and a mixed log gates per legacy-policy with a warn note.
    const tmp = mkTmpRunDir("faff-govcheck-witness-");
    try {
      const lines = buildChainFixture(tmp, "run-w", [
        { phase: "run", type: "run-start" },
        { phase: "build", type: "build-start", issue: "FAFF-1" },
      ]);
      fs.writeFileSync(path.join(tmp, "chain-head.json"),
        JSON.stringify(computeChainHead(fs.readFileSync(path.join(tmp, "events.jsonl")), "run-w", "FAFF-1"), null, 2) + "\n");
      check("witness: honest anchored chain → leg pass, witness match",
        (() => { const r = evaluateIntegrityLeg(tmp, "pass"); return r.pass === true && r.witness === "match"; })());
      // Strip prev + downgrade schema — reads as legacy without the witness.
      fs.writeFileSync(path.join(tmp, "events.jsonl"),
        lines.map((l) => { const { prev, ...rest } = JSON.parse(l); return JSON.stringify({ ...rest, schema: 1 }); }).join("\n") + "\n");
      const spoofed = evaluateIntegrityLeg(tmp, "pass");
      check("witness: legacy-downgrade spoof → witness-mismatch FAIL even under legacy-policy pass",
        spoofed.pass === false && spoofed.status === "witness-mismatch");
      // Fix pass 2: deleting the witness does NOT restore the spoof — as an anchor the
      // dir now fails witness-absent; as a bare run dir (no witness required) the same
      // log keeps today's legacy-under-policy behaviour.
      fs.rmSync(path.join(tmp, "chain-head.json"));
      const minusWitness = evaluateIntegrityLeg(tmp, "pass", { requireWitness: true });
      check("witness: spoof-minus-witness (deleted chain-head.json) → witness-absent FAIL as an anchor",
        minusWitness.pass === false && minusWitness.status === "witness-absent");
      check("witness: the same dir as a bare RUN dir (no witness required) keeps legacy-under-pass",
        evaluateIntegrityLeg(tmp, "pass").pass === true);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  {
    const tmp = mkTmpRunDir("faff-govcheck-mixed-");
    try {
      const legacy = JSON.stringify({ schema: 1, run_id: "run-m", seq: 0, ts: "t", phase: "run", type: "run-start" });
      const chained = JSON.stringify({ schema: 2, run_id: "run-m", seq: 1, ts: "t", prev: sha256Hex(Buffer.from(legacy, "utf8")), phase: "build", type: "build-start", issue: "FAFF-1" });
      fs.writeFileSync(path.join(tmp, "events.jsonl"), legacy + "\n" + chained + "\n");
      writeWitness(tmp, "run-m", "FAFF-1"); // anchors require a witness (fix pass 2)
      check("mixed: status mixed, passes under legacy-policy pass",
        (() => { const r = evaluateIntegrityLeg(tmp, "pass"); return r.pass === true && r.status === "mixed" && r.note === null; })());
      check("mixed: fails under legacy-policy fail", evaluateIntegrityLeg(tmp, "fail").pass === false);
      check("mixed: warn → pass WITH a note (never silently identical to pass)",
        (() => { const r = evaluateIntegrityLeg(tmp, "warn"); return r.pass === true && typeof r.note === "string" && /warn/.test(r.note); })());
      const { stderr } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", tmp, "--legacy-policy", "warn"]));
      check("mixed: cmd under warn emits the stderr note", /integrity —/.test(stderr));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  {
    // FAFF-568 fix pass: anchor discovery derivation — prefix-strip at any depth,
    // traversal rejection, deletion skip.
    const tmp = mkTmpRunDir("faff-govcheck-derive-");
    try {
      for (const p of ["anchors", ".faff/anchors", ".faff/sub/anchors"]) {
        fs.mkdirSync(path.join(tmp, p, "run-1", "FAFF-1"), { recursive: true });
      }
      const cwd = process.cwd();
      process.chdir(tmp);
      try {
        check("derive: 1-segment anchors-path",
          deriveAnchorDirs(["anchors/run-1/FAFF-1/events.jsonl"], "anchors").dirs.join(",") === "anchors/run-1/FAFF-1");
        check("derive: 2-segment anchors-path",
          deriveAnchorDirs([".faff/anchors/run-1/FAFF-1/chain-head.json"], ".faff/anchors").dirs.join(",") === ".faff/anchors/run-1/FAFF-1");
        check("derive: 3-segment anchors-path",
          deriveAnchorDirs([".faff/sub/anchors/run-1/FAFF-1/events.jsonl"], ".faff/sub/anchors").dirs.join(",") === ".faff/sub/anchors/run-1/FAFF-1");
        const trav = deriveAnchorDirs([".faff/anchors/../../evil/x/events.jsonl"], ".faff/anchors");
        check("derive: '..' segment rejected + reported", trav.dirs.length === 0 && trav.dropped.length === 1);
        check("derive: too-shallow path dropped, not misparsed",
          deriveAnchorDirs([".faff/anchors/loose-file.json"], ".faff/anchors").dirs.length === 0);
        check("derive: deleted anchor dir skipped (not carried anymore)",
          deriveAnchorDirs([".faff/anchors/run-gone/FAFF-9/events.jsonl"], ".faff/anchors").dirs.length === 0);
      } finally { process.chdir(cwd); }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  {
    // FAFF-568 fix pass: --anchors-root containment on explicit --anchor-dir.
    const tmp = mkTmpRunDir("faff-govcheck-root-");
    try {
      fs.mkdirSync(path.join(tmp, "anchors", "run-1", "FAFF-1"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "outside"), { recursive: true });
      // FAFF-623: this test asserts CONTAINMENT, not full-evaluation content — with no events.jsonl
      // at all, integrity trivially passes (nothing to verify), but merge_floor now also runs
      // against the same dir and fails closed on missing ac-checklist.json/review-verdict.json.
      // Write clean floor evidence so the assertion stays about containment, not merge_floor.
      fs.writeFileSync(path.join(tmp, "anchors", "run-1", "FAFF-1", "ac-checklist.json"), JSON.stringify({ all_verified: true }));
      fs.writeFileSync(path.join(tmp, "anchors", "run-1", "FAFF-1", "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
      const { result: contained } = captureOutput(() =>
        cmdGovernanceCheck(["--anchor-dir", path.join(tmp, "anchors", "run-1", "FAFF-1"), "--anchors-root", path.join(tmp, "anchors")]));
      check("anchors-root: contained --anchor-dir accepted", contained === 0);
      const { result: escaped } = captureOutput(() =>
        cmdGovernanceCheck(["--anchor-dir", path.join(tmp, "outside"), "--anchors-root", path.join(tmp, "anchors")]));
      check("anchors-root: escaping --anchor-dir → exit 2 (fail-loud, never verified)", escaped === 2);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  {
    // FAFF-623: L4 holdout on an anchor needs BOTH holdout.json and its build-progress.json
    // checkpoint — readHoldout's freshness check has nothing to compare against without the
    // latter, and reports "blocked" even for a genuinely valid holdout (the exact false-fail
    // this ticket's file-copy list exists to avoid introducing).
    const l4 = mkTmpRunDir("faff-govcheck-anchor-l4-");
    try {
      buildChainFixture(l4, "run-l4", [
        { phase: "run", type: "run-start" },
        { phase: "build", type: "build-start", issue: "FAFF-9" },
      ]);
      const writeWitnessL4 = (dir, runId, issue) => fs.writeFileSync(path.join(dir, "chain-head.json"),
        JSON.stringify(computeChainHead(fs.readFileSync(path.join(dir, "events.jsonl")), runId, issue), null, 2) + "\n");
      writeWitnessL4(l4, "run-l4", "FAFF-9");
      fs.writeFileSync(path.join(l4, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
      fs.writeFileSync(path.join(l4, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
      const buildCompleteAt = new Date(Date.now() - 60000).toISOString();
      fs.writeFileSync(path.join(l4, "holdout.json"), JSON.stringify({
        aggregate: "meets-spec", code_blind: true,
        criteria: [{ class: "scenario", verdict: "met", evidence_present: true }],
      }));

      const { result: noProgressRc } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", l4, "--level", "L4"]));
      check("anchor L4: holdout.json present but NO build-progress.json → exit 1 (freshness unprovable, blocked)", noProgressRc === 1);

      fs.writeFileSync(path.join(l4, "build-progress.json"), JSON.stringify({ updated_at: buildCompleteAt, build: { pushed_at: buildCompleteAt } }));
      const { result: withProgressRc } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", l4, "--level", "L4"]));
      check("anchor L4: holdout.json + its build-progress.json → exit 0 (meets-spec, not blocked)", withProgressRc === 0);
    } finally { fs.rmSync(l4, { recursive: true, force: true }); }
  }
  {
    // FAFF-690 (F1b): evaluateAnchorDir derives the merge-floor level from the anchor's OWN committed
    // run-ledger.json, not the --level flag. An L4-anchored dir with a clean AC+review floor but NO
    // holdout FAILs the required check even with no --level flag (which would default to L3, where the
    // holdout leg is skipped) — proving the level came from the anchor ledger. No events.jsonl ⇒ the
    // integrity leg trivially passes, isolating merge_floor as the variable.
    const anchorDir = mkTmpRunDir("faff-govcheck-anchorlevel-");
    try {
      fs.writeFileSync(path.join(anchorDir, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
      fs.writeFileSync(path.join(anchorDir, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
      // L4 in the anchor's own committed ledger — no holdout artifact beside it.
      writeLedger(anchorDir, { run_id: "anchored", level: "L4" });
      const { result: derivedL4 } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", anchorDir])); // no --level → flag default L3
      check("F1b: L4 anchor-ledger + no holdout → merge-floor FAILS (level derived from the anchor, not the L3 flag default)", derivedL4 === 1);

      // Rewrite the anchor ledger to a non-L4 level (or drop it) → the flag default (L3) governs again,
      // the holdout leg is skipped, and the same clean floor PASSES — the fallback is unchanged.
      writeLedger(anchorDir, { run_id: "anchored", level: "L3" });
      const { result: l3Anchor } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", anchorDir]));
      check("F1b: L3 anchor-ledger + clean floor → passes (non-L4 anchor keeps today's flag behaviour)", l3Anchor === 0);

      // A ledger with no usable level → the flag default (L3) governs (fail-closed to the flag), unchanged.
      writeLedger(anchorDir, { run_id: "anchored" });
      const { result: noLevel } = captureOutput(() => cmdGovernanceCheck(["--anchor-dir", anchorDir]));
      check("F1b: level-less anchor-ledger → flag default governs (unchanged), clean floor passes", noLevel === 0);
    } finally { fs.rmSync(anchorDir, { recursive: true, force: true }); }
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
  anchorDirContainmentViolation,
  cmdGovernanceCheck,
  deriveAnchorDirs,
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
