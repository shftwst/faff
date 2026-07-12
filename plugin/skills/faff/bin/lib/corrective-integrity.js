// ===========================================================================
// === region:factory — corrective-integrity — FAFF-373 (fail-safe half) + FAFF-325 (activation half). ===
// Under a shared uid faff cannot cryptographically stop a same-uid build lane
// from forging a corrective artifact or rewriting run-ledger.json (bin/faff:1683 —
// "Guardrail, not cryptographic control: a local agent can always write a
// marker"). FAFF-373 shipped DISTRUST BY DEFAULT (asserted:false for every
// input, no trust channel wired). FAFF-325 wires the one trust channel ADR-0061
// admits: an OUTER-LAYER, launch-time declaration
// (`FAFF_INTEGRITY_BOUNDARY=<version>:<dir1>,<dir2>,...`) read ONLY from pid-1's
// environ (`/proc/1/environ`, via the injectable fsq — mirrors container-check's
// containerCheck) — NEVER the CLI's own inherited process env, which shells here
// can poison via shared-fs profile files. No crypto, no secret, no signature — a
// shared-uid secret is itself forgeable, so it is false assurance (ADR-0061); the
// fs boundary set by the outer layer before this process even starts is the only
// closing mechanism. faff's role is ASSERTION, not creation (ADR-0010): with no
// outer-layer mount + declaration, the probe stays asserted:false forever — that
// is correct fail-safe behaviour, not a bug.
// PURE over (env, fsq, requiredDirs) like container-check; the CLI wrapper does the I/O.
// ===========================================================================

const path = require("node:path");
const { realFsq } = require("./container-check");

const INTEGRITY_DECL_ENV = "FAFF_INTEGRITY_BOUNDARY";
// The three "a declaration exists but fails verification" bases — tamper evidence
// or misconfiguration, as distinct from the honest "no-declaration" absence case.
// Violation is NEVER level-graded (spec §3): every consumer refuses on these.
const VIOLATION_BASES = new Set(["env-injection", "malformed", "dir-mismatch"]);

// Parse "<version>:<dir1>,<dir2>,..." -> {version, dirs} or null when malformed
// (no colon, empty version, or an empty/whitespace-only dir list).
function parseIntegrityDeclaration(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const idx = raw.indexOf(":");
  if (idx <= 0) return null; // need a non-empty version strictly before the first colon
  const version = raw.slice(0, idx);
  const dirs = raw.slice(idx + 1).split(",").map((s) => s.trim()).filter(Boolean);
  if (dirs.length === 0) return null;
  return { version, dirs };
}

// NUL-separated KEY=VALUE lookup over a /proc/<pid>/environ-shaped string — mirrors
// container-check's `container=` convention parse exactly.
function readDeclFromEnvironText(environText, key) {
  const kv = (environText || "").split("\0").find((t) => t.startsWith(key + "="));
  return kv ? kv.slice(key.length + 1) : null;
}

// A required path is "covered" by a declared dir when it EQUALS the dir or sits
// strictly under it (path.sep-bounded, so "corrective-evil" can never match a
// declared "corrective" dir by bare string prefix).
function pathCovered(requiredPath, declaredDir) {
  if (requiredPath === declaredDir) return true;
  const withSep = declaredDir.endsWith(path.sep) ? declaredDir : declaredDir + path.sep;
  return requiredPath.startsWith(withSep);
}

function dirsCoverAll(declaredDirs, requiredDirs) {
  return (requiredDirs || []).every((req) => declaredDirs.some((d) => pathCovered(req, d)));
}

// Pure probe. Returns { asserted, basis[, version, dirs] }. Trust ONLY ever comes
// from `fsq.readEnviron("/proc/1/environ")` — `env` (the CLI's own inherited
// process env) is read ONLY to detect a poisoning attempt (a declaration present
// there that pid-1 does not corroborate), never as a trust source itself.
// `requiredDirs` is the explicitly-passed integrity-dir set the declaration's
// ro-dir-set must cover (FAFF-337: the probe never does latest-run discovery); a
// non-array value degrades to "nothing required", never to a security hole.
//   asserted:true  ONLY when: a pid-1 declaration exists, is well-formed, AND its
//                  dir set ⊇ requiredDirs.
//   asserted:false otherwise, with `basis` distinguishing:
//     no-declaration — honest absence (nothing in pid-1 environ, nothing inherited).
//     env-injection  — a declaration in the inherited env with no pid-1 match, or
//                      one that disagrees with a genuine pid-1 declaration.
//     malformed      — a pid-1 declaration exists but does not parse.
//     dir-mismatch   — a well-formed pid-1 declaration whose dir set does not
//                      cover requiredDirs (a bypass, not a partial pass).
function correctiveIntegrityProbe(env, fsq, requiredDirs) {
  env = env || {};
  const dirs = Array.isArray(requiredDirs) ? requiredDirs : [];
  const pid1Text = (fsq && typeof fsq.readEnviron === "function") ? (fsq.readEnviron("/proc/1/environ") || "") : "";
  const pid1Decl = readDeclFromEnvironText(pid1Text, INTEGRITY_DECL_ENV);
  const inheritedDecl = Object.prototype.hasOwnProperty.call(env, INTEGRITY_DECL_ENV) ? String(env[INTEGRITY_DECL_ENV]) : null;

  if (pid1Decl === null) {
    return inheritedDecl === null ? { asserted: false, basis: "no-declaration" } : { asserted: false, basis: "env-injection" };
  }
  if (inheritedDecl !== null && inheritedDecl !== pid1Decl) return { asserted: false, basis: "env-injection" };

  const parsed = parseIntegrityDeclaration(pid1Decl);
  if (!parsed) return { asserted: false, basis: "malformed" };
  if (!dirsCoverAll(parsed.dirs, dirs)) return { asserted: false, basis: "dir-mismatch" };

  return { asserted: true, basis: "asserted", version: parsed.version, dirs: parsed.dirs };
}

// Pure gate. Given a probe result + a consumer, decide trust + disposition.
// asserted:true -> trusted, for every consumer.
// Unasserted degrades per consumer:
//   corrective  -> channel-D (human relay; FAFF-326's future wiring).
//   detection   -> reconcile-only (ledger content cross-checked vs git; FAFF-324).
//   merge-floor -> "refuse" on a violation basis (never level-graded — every level
//                  refuses); "unasserted" on honest absence (cmdMergeGate then
//                  applies its OWN level-branch: L4 defence-in-depth refuse,
//                  L1-L3 proceed+annotate — level-sourcing lives THERE, on the
//                  invocation-context --level flag, never here and never off
//                  run-ledger.json, per the "forged level input" failure mode).
// An UNKNOWN consumer fails safe to channel-D — never trusted.
function integrityGate(probeResult, consumer) {
  const p = probeResult || {};
  if (p.asserted === true) return { trusted: true, disposition: "trusted" };
  if (consumer === "merge-floor") {
    return VIOLATION_BASES.has(p.basis)
      ? { trusted: false, disposition: "refuse" }
      : { trusted: false, disposition: "unasserted" };
  }
  if (consumer === "detection") return { trusted: false, disposition: "reconcile-only" };
  return { trusted: false, disposition: "channel-D" };
}

// The forge-surface path set for a run: the corrective-artifact dir + run-ledger.json
// (FAFF-373), PLUS — when `issue` is given — the three merge-floor artifacts F1's
// audit fold added (FAFF-325): <run-dir>/<issue>/ac-checklist.json,
// <run-dir>/<issue>/review-verdict.json, <run-dir>/<issue>/holdout.json. Omitting
// `issue` (the L4 run-start preflight call site, which runs before any issue is
// dispatched and before a run-dir even exists) yields the original 2-entry set —
// existing callers are unaffected. Single-sourced from the SAME run-dir layout
// readAcComplete/readReviewVerdict/readHoldout use in merge-gate.js; never a
// second, divergent hand-written list. PURE — derives paths only.
function correctiveIntegrityDirs(runDir, issue) {
  const dirs = [
    path.join(runDir, "corrective"),
    path.join(runDir, "run-ledger.json"),
  ];
  if (issue) {
    dirs.push(
      path.join(runDir, issue, "ac-checklist.json"),
      path.join(runDir, issue, "review-verdict.json"),
      path.join(runDir, issue, "holdout.json"),
    );
  }
  return dirs;
}

const CONSUMERS = ["corrective", "detection", "merge-floor"];

function cmdCorrectiveIntegrity(args) {
  if (args.includes("--selftest")) return correctiveIntegritySelftest();
  const json = args.includes("--json");
  const ci = args.indexOf("--consumer");
  const consumer = ci !== -1 && args[ci + 1] ? args[ci + 1] : "corrective";
  // Closed vocabulary — reject an unknown --consumer loudly (usage error, exit 2),
  // matching the CLI's other flag validation. The gate's unknown->channel-D fail-safe
  // is defence-in-depth, not a licence for the CLI to accept garbage silently.
  if (!CONSUMERS.includes(consumer)) {
    process.stderr.write(`corrective-integrity: unknown --consumer '${consumer}' (expected: ${CONSUMERS.join(" | ")})\n`);
    return 2;
  }
  const rdi = args.indexOf("--run-dir");
  const runDir = rdi !== -1 ? args[rdi + 1] : null;
  const isi = args.indexOf("--issue");
  const issue = isi !== -1 ? args[isi + 1] : null;
  // No --run-dir -> no required dirs (the probe can still surface no-declaration /
  // env-injection / malformed; dir-mismatch needs a concrete dir set to check).
  const dirs = runDir ? correctiveIntegrityDirs(runDir, issue) : [];
  const probe = correctiveIntegrityProbe(process.env, realFsq(), dirs);
  const gate = integrityGate(probe, consumer);
  const out = { asserted: probe.asserted, basis: probe.basis, trusted: gate.trusted, disposition: gate.disposition };
  if (json) console.log(JSON.stringify(out));
  else console.log(`corrective-integrity: asserted=${out.asserted} basis=${out.basis} → trusted=${out.trusted} disposition=${out.disposition} (consumer: ${consumer})`);
  // Report/degrade, never a hard failure — an unasserted boundary is a legitimate
  // (rung-0) posture, NOT an error. Always exit 0; cmdMergeGate/lightsOutPreflight
  // are the call sites that turn a disposition into a refusal.
  return 0;
}

// In-memory selftest over synthetic fixtures — mirrors the container-check shape
// (per-case ok/FAIL + a RESULT line, non-zero on any fail).
function correctiveIntegritySelftest() {
  let total = 0, fail = 0;
  const ok = (cond, label) => { total++; if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };

  const mkFsq = (environText) => ({ readEnviron: () => environText || "" });
  const runDir = path.join("/tmp", "faff-run-xyz");
  const reqDirs = correctiveIntegrityDirs(runDir, "FAFF-1");
  const wellFormedDecl = `v1:${path.join(runDir, "corrective")},${path.join(runDir, "run-ledger.json")},${path.join(runDir, "FAFF-1")}`;
  const narrowDecl = `v1:${path.join(runDir, "corrective")}`; // omits run-ledger.json + the FAFF-1 dir

  // --- probe: honest absence ---
  ok(correctiveIntegrityProbe({}, mkFsq(""), []).basis === "no-declaration", "probe: bare env/fsq -> no-declaration");
  ok(correctiveIntegrityProbe({}, mkFsq("HOME=/root"), []).basis === "no-declaration", "probe: pid-1 environ present but no FAFF_INTEGRITY_BOUNDARY key -> no-declaration");
  ok(correctiveIntegrityProbe({}, mkFsq(""), reqDirs).asserted === false, "probe: no declaration + real required dirs -> still unasserted");

  // --- probe: env-injection (the profile-poison red-team case) ---
  ok(correctiveIntegrityProbe({ FAFF_INTEGRITY_BOUNDARY: wellFormedDecl }, mkFsq(""), []).basis === "env-injection",
    "probe: declaration ONLY in inherited env (shell-sourced rc file), absent from pid-1 -> env-injection (SECURITY-CRITICAL: never honoured)");
  ok(correctiveIntegrityProbe({ FAFF_INTEGRITY_BOUNDARY: narrowDecl }, mkFsq(`X=1\0${INTEGRITY_DECL_ENV}=${wellFormedDecl}`), []).basis === "env-injection",
    "probe: inherited env disagrees with a genuine pid-1 declaration -> env-injection (mismatch is tamper evidence)");
  ok(correctiveIntegrityProbe({ FAFF_INTEGRITY_BOUNDARY: wellFormedDecl }, mkFsq(`X=1\0${INTEGRITY_DECL_ENV}=${wellFormedDecl}`), reqDirs).asserted === true,
    "probe: inherited env AGREES with a genuine pid-1 declaration -> not penalised (still asserted when dirs cover)");

  // --- probe: malformed ---
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=garbage-no-colon`), []).basis === "malformed", "probe: pid-1 declaration with no colon -> malformed");
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=v1:`), []).basis === "malformed", "probe: pid-1 declaration with empty dir list -> malformed");
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=:${runDir}`), []).basis === "malformed", "probe: pid-1 declaration with empty version -> malformed");

  // --- probe: dir-mismatch ---
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=${narrowDecl}`), reqDirs).basis === "dir-mismatch",
    "probe: well-formed declaration whose dir set omits required dirs -> dir-mismatch (bypass, not partial pass)");
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=${narrowDecl}`), [path.join(runDir, "FAFF-1", "review-verdict.json")]).basis === "dir-mismatch",
    "probe: dir set individually omitting the review-verdict.json path -> dir-mismatch");

  // --- probe: asserted+clean ---
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=${wellFormedDecl}`), reqDirs).asserted === true,
    "probe: well-formed pid-1 declaration covering the full forge surface -> asserted:true");
  ok(correctiveIntegrityProbe({}, mkFsq(`${INTEGRITY_DECL_ENV}=${wellFormedDecl}`), []).asserted === true,
    "probe: well-formed declaration + no required dirs (vacuously covered) -> asserted:true");

  // --- probe: a garbage requiredDirs param never opens a hole ---
  ok(correctiveIntegrityProbe({}, mkFsq(""), { asserted: true, source: "shared-fs" }).asserted === false,
    "probe: non-array requiredDirs degrades to empty, never a trust shortcut");
  ok(correctiveIntegrityProbe({}, mkFsq(""), "trust-me").asserted === false,
    "probe: string requiredDirs degrades to empty, never a trust shortcut");

  // --- gate: corrective / detection (unchanged FAFF-373 shape) ---
  const unasserted = { asserted: false, basis: "no-declaration" };
  const violated = { asserted: false, basis: "env-injection" };
  const asserted = { asserted: true, basis: "asserted" };
  ok(integrityGate(unasserted, "corrective").disposition === "channel-D", "gate corrective/unasserted -> channel-D");
  ok(integrityGate(unasserted, "detection").disposition === "reconcile-only", "gate detection/unasserted -> reconcile-only");
  ok(integrityGate(unasserted, "wat").disposition === "channel-D", "gate unknown consumer -> channel-D (fail-safe)");
  ok(integrityGate(asserted, "corrective").trusted === true && integrityGate(asserted, "corrective").disposition === "trusted", "gate asserted:true -> trusted (any consumer)");

  // --- gate: merge-floor (FAFF-325, the F1 audit fold) ---
  ok(integrityGate(asserted, "merge-floor").disposition === "trusted", "gate merge-floor + asserted -> trusted");
  ok(integrityGate(unasserted, "merge-floor").disposition === "unasserted", "gate merge-floor + no-declaration -> unasserted (level-branch is cmdMergeGate's job)");
  for (const basis of VIOLATION_BASES) {
    ok(integrityGate({ asserted: false, basis }, "merge-floor").disposition === "refuse", `gate merge-floor + ${basis} -> refuse (violation, never level-graded)`);
  }

  // --- correctiveIntegrityDirs ---
  const base = correctiveIntegrityDirs(runDir);
  ok(base.length === 2, "correctiveIntegrityDirs(runDir): 2 base entries with no issue");
  ok(base.every((d) => d === runDir || d.startsWith(runDir + path.sep)), "correctiveIntegrityDirs(runDir): all under runDir");
  ok(base.includes(path.join(runDir, "run-ledger.json")), "correctiveIntegrityDirs(runDir): includes the ledger path");
  ok(base.includes(path.join(runDir, "corrective")), "correctiveIntegrityDirs(runDir): includes the corrective-artifact dir");
  const withIssue = correctiveIntegrityDirs(runDir, "FAFF-1");
  ok(withIssue.length === 5, "correctiveIntegrityDirs(runDir, issue): 5 entries (2 base + 3 merge-floor)");
  ok(withIssue.includes(path.join(runDir, "FAFF-1", "ac-checklist.json")), "correctiveIntegrityDirs(runDir, issue): includes ac-checklist.json");
  ok(withIssue.includes(path.join(runDir, "FAFF-1", "review-verdict.json")), "correctiveIntegrityDirs(runDir, issue): includes review-verdict.json");
  ok(withIssue.includes(path.join(runDir, "FAFF-1", "holdout.json")), "correctiveIntegrityDirs(runDir, issue): includes holdout.json");

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} checks, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = {
  cmdCorrectiveIntegrity, correctiveIntegrityDirs, correctiveIntegrityProbe,
  correctiveIntegritySelftest, integrityGate, parseIntegrityDeclaration, VIOLATION_BASES,
};
