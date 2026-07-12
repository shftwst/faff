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
// ===========================================================================

const { containerCheck, realFsq } = require("./container-check");
const { findRoot } = require("./shared-infra");

// Pure core. `env` is a KEY→VALUE map; `fsq` is the injectable reader
//   { exists, readEnviron, isDirectory } (container-check's realFsq shape).
// `repoPath` is the codebase working tree the evaluator must NOT be able to read.
// Returns { holds, refusals: [{leg, detail}, ...] }; holds ⟺ every leg passed.
// Never throws — an fsq error is caught inside the adapter (fail-closed → the
// probe returns false), so a leg never blows up the preflight.
function evaluatorPreflight(env, fsq, repoPath) {
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
  // Legs 3 (host-socket-absent, FAFF-333) and 4 (integrity-signal-present, FAFF-325) are DEFERRED.
  return { holds: refusals.length === 0, refusals };
}

function cmdEvaluatorPreflight(args) {
  if (args.includes("--selftest")) return evaluatorPreflightSelftest();
  const json = args.includes("--json");
  const rpIdx = args.indexOf("--repo-path");
  if (rpIdx !== -1 && (args[rpIdx + 1] === undefined || args[rpIdx + 1] === "" || args[rpIdx + 1].startsWith("--"))) {
    // Fail-CLOSED on a missing/empty --repo-path value: an empty path must not
    // silently resolve to the blind (holds) state — that would report the
    // boundary present on garbage input. Usage error, like the missing-value case.
    process.stderr.write("usage: faff evaluator-preflight [--repo-path <path>] [--json] [--selftest]\n");
    return 2;
  }
  // Default: the resolved repo working tree (the codebase the evaluator must NOT see).
  const repoPath = rpIdx !== -1 ? args[rpIdx + 1] : (findRoot() || process.cwd());
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

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${CASES.length} cases + never-throws, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { cmdEvaluatorPreflight, evaluatorPreflight, evaluatorPreflightSelftest };
