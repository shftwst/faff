// ===========================================================================
// === region:factory — evaluator-preflight — FAFF-276: the assert-in half of the ADR-0041 rung-2 seam. ===
// The holdout evaluator's `code_blind: true` is today a self-attestation by the
// judged party (`faff contract holdout-verdict` checks only that the flag is
// present + true — it cannot detect an evaluator that read the codebase and lied).
// This is the ASSERT-IN primitive that makes blindness a PHYSICAL FACT at lane
// entry: the evaluator lane runs this preflight and REFUSES (exit 1) unless it is
// inside a container AND the codebase directory is physically unreadable. So a
// `code_blind: true` verdict emitted after a passing preflight is backed by a
// physical probe, not a promise.
//
// Sibling to container-check, not an edit to it: container-check WARNS (its exit
// stays advisory); the evaluator lane must REFUSE — a different posture, a
// different exit contract. The in-container leg reuses containerCheck VERBATIM.
//
// PURE given (env, fsq, repoPath) — no tracker, no network (parity with
// container-check / checkWorktreeIsolation). The `fsq` seam is injectable so the
// selftest runs synthetic fixtures, and realFsq()'s never-throws guarantee makes
// an unreadable/absent repo path fail-CLOSED to the blind (passing) state rather
// than crash.
//
// A declaration is never a trust source: the refuse decision rests on the physical
// fsq.isDirectory probe, NEVER on what a lane-boundary intent artifact CLAIMS —
// trusting a build-lane-writable declaration would re-open the forge this rung
// closes (the correctiveIntegrityProbe lesson). A present artifact MAY be
// cross-checked for defence-in-depth, but a claim never relaxes a refuse.
//
// SHIP-NOT-WIRE: this slice ships the primitive built + tested + documented but
// does NOT call it from the live holdout dispatch — today's evaluator is
// dispatched inline sharing the run cwd (it can see the repo), so a wired
// repo-absent leg would refuse on every uncaged run and break the holdout phase.
// Wiring rides with the cage+spawner sibling (FAFF-384). The host-socket-absent
// (FAFF-333) and integrity-signal (FAFF-325) refuse-legs are deferred; the
// lane-boundary schema carries their fields as declaration-only until then.
//
// FAFF-859 — the ISOLATION-MISMATCH leg: an OPTIONAL, caller-passed declared
// boundary is cross-checked against the physical observation, additively (it can
// raise a refusal on divergence, never relax one). Also SHIP-NOT-WIRE — no live
// call site passes declaredBoundary this slice, so absent it the two legs above
// are byte-for-byte unchanged; live wiring rides with FAFF-384 too.
// ===========================================================================

const { containerCheck, realFsq } = require("./container-check");
const { findRoot } = require("./shared-infra");

// Pure core. `env` is a KEY→VALUE map; `fsq` is the injectable reader
//   { exists, readEnviron, isDirectory } (container-check's realFsq shape).
// `repoPath` is the codebase working tree the evaluator must NOT be able to read.
// `declaredBoundary` (FAFF-859, OPTIONAL) is the resolved lane-boundary intent the
// CALLER passes in — the pure function does NO I/O (the requireSpawnerAttested
// precedent), so it never reads config or lane-boundary.json itself.
// Returns { holds, refusals: [{leg, detail}, ...] }; holds ⟺ every leg passed.
// Never throws — an fsq error is caught inside the adapter (fail-closed → the
// probe returns false), so a leg never blows up the preflight.
function evaluatorPreflight(env, fsq, repoPath, declaredBoundary) {
  const refusals = [];
  // Leg 1 — in-container: the evaluator cage must exist (reuses containerCheck verbatim).
  const cc = containerCheck(env, fsq);
  if (cc.result !== "contained") {
    refusals.push({ leg: "in-container", detail: `no container boundary — ${cc.basis}` });
  }
  // Leg 2 — repo-absent: the codebase must be physically unreadable. The refuse
  // decision rests on this PHYSICAL probe, never on any declared intent.
  if (fsq.isDirectory(repoPath) === true) {
    refusals.push({ leg: "repo-absent", detail: `repo path '${repoPath}' is a readable directory — evaluator is not code-blind` });
  }
  // FAFF-859 — the isolation-mismatch leg: compare the caller-passed DECLARATION against
  // the PHYSICAL observation and refuse on divergence. STRICTLY ADDITIVE — it only ever
  // pushes refusals, NEVER removes one the physical legs above raised; a declaration can
  // raise a refusal on divergence, it can never relax one (a build-lane-writable claim
  // must never be a trust source — the correctiveIntegrityProbe lesson). It compares two
  // INDEPENDENTLY-probed facts: the declaration and containerCheck's physical probe (the
  // same probe Leg 1 uses), so the physical probe stays the refuse basis. SHIP-NOT-WIRE:
  // no live call site passes declaredBoundary this slice (absent ⇒ the leg is skipped and
  // the two legs above behave byte-for-byte as before), so live runs are unaffected.
  if (declaredBoundary) {
    // Observation: containment maps `contained` → own, otherwise shared (the two-value axis).
    const observedContainer = cc.result === "contained" ? "own" : "shared";
    if (declaredBoundary.container !== observedContainer) {
      refusals.push({ leg: "isolation-mismatch", detail: `declared container ${JSON.stringify(declaredBoundary.container)} != observed ${observedContainer}` });
    }
    // Locality: this slice has no remote-observation seam (FAFF-817), so observation is
    // always local. A declared `host: local` is asserted against it; a declared
    // `host: remote` is NOT evaluated (neither a hold nor a refuse on the host axis) —
    // physical remote-observation is deferred, so refusing on it would contradict scope.
    const observedHost = "local";
    if (declaredBoundary.host === "local" && observedHost !== "local") {
      refusals.push({ leg: "isolation-mismatch", detail: `declared host local != observed ${observedHost}` });
    }
  }
  // Legs 3 (host-socket-absent, FAFF-333) and 4 (integrity-signal-present, FAFF-325) are DEFERRED.
  return { holds: refusals.length === 0, refusals };
}

const { parseArgs, usageError } = require("./argv");
const EVALUATOR_PREFLIGHT_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--repo-path": { arity: 1 } } };
const EVALUATOR_PREFLIGHT_USAGE = "usage: faff evaluator-preflight [--repo-path <path>] [--json] [--selftest]";

function cmdEvaluatorPreflight(args) {
  if (args.includes("--selftest")) return evaluatorPreflightSelftest();
  const { values, errors } = parseArgs(args, EVALUATOR_PREFLIGHT_SPEC);
  if (errors.length) return usageError(errors, EVALUATOR_PREFLIGHT_USAGE);
  const json = !!values["--json"];
  // Fail-CLOSED on an EMPTY --repo-path value (a missing / --prefixed value is already a
  // missing-value exit 2 above): an empty path must not silently resolve to the blind
  // (holds) state — that would report the boundary present on garbage input.
  if (values["--repo-path"] === "") { process.stderr.write(EVALUATOR_PREFLIGHT_USAGE + "\n"); return 2; }
  // Default: the resolved repo working tree (the codebase the evaluator must NOT see).
  const repoPath = values["--repo-path"] !== undefined ? values["--repo-path"] : (findRoot() || process.cwd());
  const fsq = realFsq();
  const { holds, refusals } = evaluatorPreflight(process.env, fsq, repoPath);
  if (json) {
    console.log(JSON.stringify({ holds, repo_path: repoPath, refusals }));
  } else if (holds) {
    console.log(`holds — evaluator boundary present (repo-path: ${repoPath})`);
  } else {
    console.log(`REFUSE — evaluator boundary absent (repo-path: ${repoPath})`);
    for (const r of refusals) console.log(`  ✗ ${r.leg}: ${r.detail}`);
  }
  return holds ? 0 : 1;
}

// In-memory selftest over synthetic (env, fsq) fixtures — mirrors the
// container-check selftest shape (per-case ok/FAIL + a RESULT line, non-zero on
// any fail). `present` gates the in-container leg (a /.dockerenv marker fixture),
// `dirs` gates the repo-absent leg (which paths isDirectory reports true for).
function evaluatorPreflightSelftest() {
  const mkFsq = (present, dirs) => ({
    exists: (p) => present.has(p),
    readEnviron: () => "",
    isDirectory: (p) => dirs.has(p),
  });
  const CONTAINED = new Set(["/.dockerenv"]);   // a docker marker → containerCheck contained
  const NOSIGNAL = new Set();                     // no marker → not_confirmed
  const CASES = [
    // [container-present, dirs, repoPath, want-holds, want-legs (sorted), label]
    [CONTAINED, new Set(), "/gone", true, [], "contained + repo absent → holds"],
    [CONTAINED, new Set(["/repo"]), "/repo", false, ["repo-absent"], "contained + repo readable → refuse repo-absent"],
    [NOSIGNAL, new Set(), "/gone", false, ["in-container"], "not contained + repo absent → refuse in-container"],
    [NOSIGNAL, new Set(["/repo"]), "/repo", false, ["in-container", "repo-absent"], "both fail → both refusals (reports every leg)"],
    [CONTAINED, new Set(["/other"]), "/repo", true, [], "contained + repoPath not a dir → holds (blind state)"],
  ];
  let fail = 0;
  for (const [present, dirs, repoPath, wantHolds, wantLegs, label] of CASES) {
    const { holds, refusals } = evaluatorPreflight({}, mkFsq(present, dirs), repoPath);
    const legs = refusals.map((r) => r.leg).sort();
    const want = [...wantLegs].sort();
    const ok = holds === wantHolds && JSON.stringify(legs) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} → holds=${holds}/legs=[${legs}] (want holds=${wantHolds}/legs=[${want}])`);
  }
  // never-throws (real adapter): an absent repo path yields the blind (passing) state, no exception,
  // and repo-absent is never a refusal for a non-directory path.
  try {
    const r = evaluatorPreflight({}, realFsq(), "/no/such/repo/xyz");
    if (r.refusals.some((x) => x.leg === "repo-absent")) { console.log("FAIL real adapter flagged repo-absent for an absent path"); fail++; }
  } catch { console.log("FAIL evaluatorPreflight threw on an absent repo path"); fail++; }

  // FAFF-859 — the isolation-mismatch leg (declaredBoundary passed by the caller). Additive:
  // it raises a refusal on declared-vs-observed divergence, never suppresses a physical refusal.
  // [container-present, dirs, repoPath, declaredBoundary, want-holds, want-legs (sorted), label]
  const ISO_CASES = [
    // no declared boundary → byte-for-byte the two-leg behaviour (guards the SHIP-NOT-WIRE default).
    [CONTAINED, new Set(), "/gone", undefined, true, [], "no declared boundary → skipped, holds"],
    // declared own + physically contained (own) → match, no isolation refusal.
    [CONTAINED, new Set(), "/gone", { container: "own", host: "local" }, true, [], "declared own + observed own → holds (match)"],
    // declared own but physically NOT contained (observed shared) → isolation-mismatch refusal (additive to in-container).
    [NOSIGNAL, new Set(), "/gone", { container: "own", host: "local" }, false, ["in-container", "isolation-mismatch"], "declared own + observed shared → isolation-mismatch + in-container (both, none suppressed)"],
    // declared shared but physically contained (observed own) → over-provisioned isolation is still a mismatch.
    [CONTAINED, new Set(), "/gone", { container: "shared", host: "local" }, false, ["isolation-mismatch"], "declared shared + observed own → isolation-mismatch (over-provisioned still refuses)"],
    // declared host: remote → NOT evaluated on the host axis (no refusal, no hold change) — container still matches.
    [CONTAINED, new Set(), "/gone", { container: "own", host: "remote" }, true, [], "declared host remote → host axis not evaluated (deferred), container matches → holds"],
    // additivity: a declared boundary NEVER suppresses the physical repo-absent refusal.
    [CONTAINED, new Set(["/repo"]), "/repo", { container: "own", host: "local" }, false, ["repo-absent"], "declared own matches, but repo readable → repo-absent still refuses (declaration never relaxes)"],
  ];
  for (const [present, dirs, repoPath, declared, wantHolds, wantLegs, label] of ISO_CASES) {
    const { holds, refusals } = evaluatorPreflight({}, mkFsq(present, dirs), repoPath, declared);
    const legs = refusals.map((r) => r.leg).sort();
    const want = [...wantLegs].sort();
    const ok = holds === wantHolds && JSON.stringify(legs) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} → holds=${holds}/legs=[${legs}] (want holds=${wantHolds}/legs=[${want}])`);
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${CASES.length} cases + never-throws + ${ISO_CASES.length} isolation-leg cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { cmdEvaluatorPreflight, evaluatorPreflight, evaluatorPreflightSelftest };
