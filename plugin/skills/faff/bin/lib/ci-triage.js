// ===========================================================================
// === region:factory — ci-triage — FAFF-391: CI failure triage (classify flaky vs real, act per class). ===
// `faff ci-triage` mirrors merge-gate's own split (FAFF-350): a pure classification core
// (`deriveTriageAction`, contract-defs.js, registered as CONTRACTS["ci-triage"]) + a thin impure
// shell (here) that OBSERVES the PR head's check-runs, main's head check-runs, and the committed
// flaky register — never re-triggers a run, never parks, never files a ticket, never merges. The
// CLI observes and classifies only; the skill (faff-graft Step 10) acts on the verdict. The
// verdict is NEVER passed into `faff merge-gate` — a cleared-transient failure proceeds only
// because the clean re-run made the head-sha checks ACTUALLY green, and merge-gate independently
// re-observes them (see merge-gate.js's own header for the identical discipline).
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const CI_TRIAGE_SPEC = { flags: {
  "--json": { arity: 0 }, "--selftest": { arity: 0 },
  "--fault-domain": { arity: 1 }, "--fault-domain-source": { arity: 1 }, "--issue": { arity: 1 },
  "--pr": { arity: 1 }, "--repo": { arity: 1 }, "--root": { arity: 1 }, "--run-dir": { arity: 1 },
  "--transience": { arity: 1 },
} };
const { CI_TRIAGE_FAULT_DOMAIN, CI_TRIAGE_TRANSIENCE, deriveTriageAction } = require("./contract-defs");
const { ghJson, ghRepoSlug } = require("./merge-gate");
const { findRoot } = require("./shared-infra");

// A failing check-run's conclusion vocabulary — mirrors classifyHeadShaChecks' own FAIL set
// (merge-gate.js) so "this check is failing" means the same thing in both places; an unknown/
// non-terminal conclusion is treated as failing too (fail-closed — never silently dropped from
// the failing set just because its conclusion string is unrecognised).
const FAIL_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out", "action_required", "stale", "startup_failure"]);
const OK_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);
function isFailingRun(r) {
  if (!r || !r.name) return false;
  if (r.status && r.status !== "completed") return false; // still pending — not a terminal failure
  return FAIL_CONCLUSIONS.has(r.conclusion) || !OK_CONCLUSIONS.has(r.conclusion);
}
function failingCheckNames(runs) {
  return (Array.isArray(runs) ? runs : []).filter(isFailingRun).map((r) => r.name);
}

// PURE: mechanical-first fault-domain read over THIS PR's failing check-run rows. `infra` iff any
// failing check's conclusion names an infra-shaped fault (startup_failure / timed_out — a runner/
// daemon/network/setup fault, never a code defect); everything else is `unknown` — the residue the
// LLM tiebreaker exists for. Never mechanically guesses `code` — that would let a metadata
// misread silently claim the residue the spec reserves for judgement.
const INFRA_CONCLUSIONS = new Set(["startup_failure", "timed_out"]);
function classifyFaultDomainFromMetadata(failingRuns) {
  for (const r of (Array.isArray(failingRuns) ? failingRuns : [])) {
    if (r && INFRA_CONCLUSIONS.has(r.conclusion)) return "infra";
  }
  return "unknown";
}

// PURE: origin is PER-CHECK (a main failure on a DIFFERENT check is still `mine` — main-was-red is
// never a per-repo verdict). `mainRuns === null` means main's head was unreadable — fails CLOSED to
// `unknown`, never silently "mine" (an unprovable origin must never let a merge-eligible action fall
// out of it).
function classifyOrigin(failingNames, mainRuns) {
  if (mainRuns === null) return "unknown";
  const mainFailing = new Set(failingCheckNames(mainRuns));
  return failingNames.some((n) => mainFailing.has(n)) ? "main-was-red" : "mine";
}

// Flaky signature (FAFF-391 vocabulary): check-run name + best-effort failing-test identifier.
// v1 uses the check-run name ALONE — a coarser but still valid dedupe key, the spec's own sanctioned
// fallback for when test-id extraction isn't feasible (extracting a specific failing-test name out
// of a raw log requires fetching + parsing full run logs — a heavier seam left as a discovered-scope
// follow-up, not built here).
function flakySignature(checkName) {
  return checkName;
}

// === Flaky register — docs/ci/flaky-register.json, the single committed carrier of cross-run =====
// flaky history (ratified 2026-07-06). ALL access goes through readFlakyRegister/writeFlakyRegister
// (the spec's "single read/append accessor") so a future carrier swap touches one seam.
const QUARANTINE_THRESHOLD = 3;

function flakyRegisterPath(root) {
  return path.join(root, "docs", "ci", "flaky-register.json");
}

// Absent/unreadable/malformed -> an empty register (never crash triage on a missing/corrupt file).
function readFlakyRegister(root) {
  try {
    const j = JSON.parse(fs.readFileSync(flakyRegisterPath(root), "utf8"));
    return { entries: Array.isArray(j.entries) ? j.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function writeFlakyRegister(root, register) {
  const p = flakyRegisterPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(register, null, 2) + "\n");
}

// PURE (in-memory): append one observed event for `signature`, and quarantine (mark the register
// entry — never an autonomous test-file edit) THE FIRST TIME the entry's event count reaches the
// threshold with no `quarantine_ticket` yet set — a signature already carrying a ticket is NEVER
// re-quarantined (re-filed). The ticket field is a placeholder marker ("presence = already
// quarantined" per the spec's RECORD comment) until a real tracker id backfills it — that backfill
// is the orchestrator's job (beep-boop's filing step), not this accessor's.
function recordFlakyEvent(register, signature, event) {
  const entries = (register.entries || []).map((e) => ({ ...e, events: Array.isArray(e.events) ? e.events.slice() : [] }));
  let entry = entries.find((e) => e.signature === signature);
  if (!entry) {
    entry = { signature, events: [], quarantine_ticket: null };
    entries.push(entry);
  }
  entry.events.push(event);
  let justQuarantined = false;
  if (entry.events.length >= QUARANTINE_THRESHOLD && !entry.quarantine_ticket) {
    entry.quarantine_ticket = `pending-quarantine:${signature}`;
    justQuarantined = true;
  }
  return { register: { entries }, justQuarantined, eventsCount: entry.events.length };
}

// Impure shell: resolve repo/PR identity, observe PR-head + main-head check-runs, classify all
// three axes, fold in the register, derive the action, and (on a caller-asserted `transience:
// transient`) append flaky events for this pass's failing signatures. Returns { verdict, failLoud,
// exit } — verdict is the FULL persisted record (contract-shaped fields + issue/checked_at/
// quarantine bookkeeping); failLoud names an unresolvable identity (exit 2, before any classification).
function runCiTriage({ pr, issue, repoFlag, transienceFlag, faultDomainFlag, faultDomainSource, root }) {
  const repoRoot = root || findRoot();
  const repo = ghRepoSlug(repoFlag);
  if (!repo) return { failLoud: "cannot resolve repo slug (gh repo view failed)" };

  const hv = ghJson(["pr", "view", String(pr), "--json", "headRefOid"]);
  if (!hv.ok || !hv.data || !hv.data.headRefOid) return { failLoud: `cannot establish PR identity for #${pr}: ${hv.stderr}` };
  const headSha = hv.data.headRefOid;

  const prRuns = ghJson(["api", `repos/${repo}/commits/${headSha}/check-runs`, "--jq", "[.check_runs[] | {name, status, conclusion}]"]);
  const prRunsOk = prRuns.ok && Array.isArray(prRuns.data);
  const failingNames = prRunsOk ? failingCheckNames(prRuns.data) : [];
  const failingRuns = prRunsOk ? prRuns.data.filter(isFailingRun) : [];

  // main's head sha (local git — no network beyond what the caller's own fetch already did).
  const rp = spawnSync("git", ["rev-parse", "origin/main"], { cwd: repoRoot, encoding: "utf8" });
  const mainHeadSha = rp.status === 0 ? rp.stdout.trim() : null;
  let mainRuns = null; // null = unreadable (fail-closed origin)
  let mainCiState = null;
  if (mainHeadSha) {
    const mr = ghJson(["api", `repos/${repo}/commits/${mainHeadSha}/check-runs`, "--jq", "[.check_runs[] | {name, status, conclusion}]"]);
    if (mr.ok && Array.isArray(mr.data)) {
      mainRuns = mr.data;
      mainCiState = failingCheckNames(mainRuns).length > 0 ? "ci-red" : "ci-green";
    }
  }

  const origin = classifyOrigin(failingNames, mainRuns);

  // fault_domain: an explicit --fault-domain (the skill-side LLM tiebreaker) governs when given —
  // validated against the closed enum; anything else (missing flag, malformed, out-of-enum) coerces
  // to unknown, mirroring the metadata-only mechanical read. metadata is tried FIRST regardless (the
  // spec's "never the reverse order" rule) — an explicit flag only ever narrows an already-unknown
  // metadata read, it can't override a metadata-resolved `infra`. The two flags are a PAIR — the
  // override only applies when BOTH `--fault-domain` and `--fault-domain-source llm` are present, so
  // `fault_domain_source` always accurately names HOW `fault_domain` was resolved (never `llm` for a
  // value that was actually just the mechanical default because the source flag was missing/wrong).
  const metadataFaultDomain = classifyFaultDomainFromMetadata(failingRuns);
  let fault_domain = metadataFaultDomain;
  let fault_domain_source = metadataFaultDomain === "unknown" ? "none" : "metadata";
  if (metadataFaultDomain === "unknown" && faultDomainFlag != null && faultDomainSource === "llm") {
    fault_domain = CI_TRIAGE_FAULT_DOMAIN.includes(faultDomainFlag) ? faultDomainFlag : "unknown";
    fault_domain_source = "llm";
  }

  // transience: fed in by the caller (graft) AFTER it performs the clean same-sha re-run itself —
  // this CLI never re-triggers runs. Absent/malformed -> unknown (the pre-rerun first call).
  const transience = CI_TRIAGE_TRANSIENCE.includes(transienceFlag) ? transienceFlag : "unknown";

  const flakySignatures = failingNames.map(flakySignature);
  let register = readFlakyRegister(repoRoot);
  const quarantine = [];
  if (transience === "transient" && flakySignatures.length > 0) {
    const event = { observed_at: new Date().toISOString(), head_sha: headSha, run_ref: `pr:${pr}` };
    for (const sig of flakySignatures) {
      const rec = recordFlakyEvent(register, sig, event);
      register = rec.register;
      if (rec.justQuarantined) quarantine.push({ signature: sig, events: rec.eventsCount });
    }
    writeFlakyRegister(repoRoot, register);
  }

  const action = deriveTriageAction(transience, fault_domain, origin);
  const verdict = {
    issue: issue || null,
    pr: Number(pr),
    head_sha: headSha,
    transience,
    fault_domain,
    origin,
    action,
    evidence: {
      reruns_used: 0, // bookkeeping the CALLER (graft) increments across its own rerun loop; this
                        // single-pass CLI never re-triggers a run, so it always reports 0 here.
      main_head_sha: mainHeadSha,
      main_ci_state: mainCiState,
      fault_domain_source,
      flaky_signatures: flakySignatures,
    },
    quarantine,
    conformant: true,
    violations: [],
    checked_at: new Date().toISOString(),
  };
  return { verdict };
}

function ciTriagePath(runDir, issue) {
  return path.join(runDir, issue, "ci-triage.json");
}

function writeCiTriageVerdict(runDir, issue, verdict) {
  try {
    const dir = path.join(runDir, issue);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ciTriagePath(runDir, issue), JSON.stringify(verdict, null, 2) + "\n");
    return true;
  } catch (e) {
    process.stderr.write(`faff ci-triage: warning — could not write ci-triage.json: ${e.message}\n`);
    return false;
  }
}

function cmdCiTriage(args) {
  if (args.includes("--selftest")) return ciTriageSelftest();
  const parsed = parseArgs(args, CI_TRIAGE_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff ci-triage --pr N --issue ID --run-dir DIR [--repo R] [--transience T] [--fault-domain D] [--fault-domain-source S] [--json] [--root DIR]");
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const json = !!parsed.values["--json"];
  const pr = get("--pr");
  const issue = get("--issue");
  const runDir = get("--run-dir");
  const repoFlag = get("--repo");
  const transienceFlag = get("--transience");
  const faultDomainFlag = get("--fault-domain");
  const faultDomainSource = get("--fault-domain-source");
  const root = get("--root");

  if (!pr || !issue || !runDir) {
    process.stderr.write("faff ci-triage: --pr, --issue and --run-dir are required\n");
    return 2;
  }

  const { verdict, failLoud } = runCiTriage({ pr, issue, repoFlag, transienceFlag, faultDomainFlag, faultDomainSource, root });
  if (failLoud) {
    process.stderr.write(`faff ci-triage: fail-loud: ${failLoud}\n`);
    return 2;
  }

  writeCiTriageVerdict(runDir, issue, verdict);
  if (json) {
    process.stdout.write(JSON.stringify(verdict) + "\n");
  } else {
    console.log(`ci-triage ${issue}: transience=${verdict.transience} fault_domain=${verdict.fault_domain} origin=${verdict.origin} -> action=${verdict.action}`);
    if (verdict.quarantine.length) console.log(`  quarantined: ${verdict.quarantine.map((q) => q.signature).join(", ")}`);
  }
  return 0;
}

function ciTriageSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } else console.log(`ok   ${label}`); };

  // deriveTriageAction: every axis combination, no network (imported from contract-defs — this
  // module's own contribution is exercising it through the CI-observation classifiers below).
  for (const transience of ["transient", "persistent", "unknown"]) {
    for (const fault_domain of ["infra", "code", "unknown"]) {
      for (const origin of ["mine", "main-was-red", "unknown"]) {
        const action = deriveTriageAction(transience, fault_domain, origin);
        let want;
        if (origin === "main-was-red" || origin === "unknown") want = "park-needs-human";
        else if (transience === "transient") want = "proceed-to-merge-gate";
        else if (transience === "unknown") want = "park-needs-human";
        else if (fault_domain === "infra") want = "park-errored";
        else if (fault_domain === "code") want = "fix-attempt";
        else want = "park-needs-human";
        check(`deriveTriageAction(${transience},${fault_domain},${origin}) -> ${want}`, action === want);
      }
    }
  }

  // classifyFaultDomainFromMetadata: mechanical-first read, never guesses "code".
  check("fault-domain metadata: startup_failure -> infra", classifyFaultDomainFromMetadata([{ name: "build", conclusion: "startup_failure" }]) === "infra");
  check("fault-domain metadata: timed_out -> infra", classifyFaultDomainFromMetadata([{ name: "build", conclusion: "timed_out" }]) === "infra");
  check("fault-domain metadata: plain failure -> unknown (never guesses code)", classifyFaultDomainFromMetadata([{ name: "build", conclusion: "failure" }]) === "unknown");
  check("fault-domain metadata: empty set -> unknown", classifyFaultDomainFromMetadata([]) === "unknown");

  // classifyOrigin: per-check, fail-closed on unreadable main.
  check("origin: main unreadable (null) -> unknown, fail-closed", classifyOrigin(["build"], null) === "unknown");
  check("origin: main failing the SAME check -> main-was-red", classifyOrigin(["build"], [{ name: "build", status: "completed", conclusion: "failure" }]) === "main-was-red");
  check("origin: main failing a DIFFERENT check -> mine (per-check, not per-repo)", classifyOrigin(["build"], [{ name: "lint", status: "completed", conclusion: "failure" }]) === "mine");
  check("origin: main all-green -> mine", classifyOrigin(["build"], [{ name: "build", status: "completed", conclusion: "success" }]) === "mine");

  // failingCheckNames: pending never reads as failing; unknown conclusions fail-closed.
  check("failingCheckNames: pending excluded", failingCheckNames([{ name: "build", status: "in_progress", conclusion: null }]).length === 0);
  check("failingCheckNames: success/skipped/neutral excluded", failingCheckNames([{ name: "a", status: "completed", conclusion: "success" }, { name: "b", status: "completed", conclusion: "skipped" }]).length === 0);
  check("failingCheckNames: unrecognised conclusion still counts (fail-closed)", failingCheckNames([{ name: "build", status: "completed", conclusion: "weird" }]).length === 1);

  // recordFlakyEvent: pure in-memory register fold — the quarantine-threshold + never-re-file table.
  let reg = { entries: [] };
  const ev = (n) => ({ observed_at: `t${n}`, head_sha: `sha${n}`, run_ref: `pr:${n}` });
  let r1 = recordFlakyEvent(reg, "build", ev(1));
  check("register: 1st event -> not yet quarantined", r1.justQuarantined === false && r1.eventsCount === 1);
  let r2 = recordFlakyEvent(r1.register, "build", ev(2));
  check("register: 2nd event -> still not quarantined", r2.justQuarantined === false && r2.eventsCount === 2);
  let r3 = recordFlakyEvent(r2.register, "build", ev(3));
  check("register: 3rd event -> quarantined (threshold)", r3.justQuarantined === true && r3.eventsCount === 3);
  const ticketAfterQuarantine = r3.register.entries.find((e) => e.signature === "build").quarantine_ticket;
  check("register: quarantine_ticket now set (non-null)", !!ticketAfterQuarantine);
  let r4 = recordFlakyEvent(r3.register, "build", ev(4));
  check("register: 4th event on an already-quarantined signature -> never re-quarantines", r4.justQuarantined === false);
  check("register: an already-quarantined signature keeps its ticket (never overwritten)", r4.register.entries.find((e) => e.signature === "build").quarantine_ticket === ticketAfterQuarantine);
  let r5 = recordFlakyEvent(reg, "other-check", ev(1));
  check("register: a DIFFERENT signature gets its own independent entry", r5.register.entries.length === 1 && r5.register.entries[0].signature === "other-check");

  // readFlakyRegister/writeFlakyRegister: real fs round-trip (no network).
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-ci-triage-"));
  try {
    check("readFlakyRegister: absent file -> empty register (never crash)", readFlakyRegister(tmp).entries.length === 0);
    writeFlakyRegister(tmp, r3.register);
    const reread = readFlakyRegister(tmp);
    check("writeFlakyRegister/readFlakyRegister: round-trips", reread.entries.length === 1 && reread.entries[0].signature === "build" && reread.entries[0].events.length === 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // cmdCiTriage: usage validation (fail-loud before any gh call — no network needed to reach exit 2).
  check("cmd: missing --pr/--issue/--run-dir -> exit 2 usage, before any gh call", cmdCiTriage(["--issue", "FAFF-1"]) === 2);

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (ci-triage, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  QUARANTINE_THRESHOLD, ciTriagePath, classifyFaultDomainFromMetadata, classifyOrigin, cmdCiTriage,
  failingCheckNames, flakyRegisterPath, flakySignature, isFailingRun, readFlakyRegister, recordFlakyEvent,
  runCiTriage, writeCiTriageVerdict, writeFlakyRegister,
};
