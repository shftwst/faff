// ===========================================================================
// === region:factory — merge-gate-selftest — FAFF-1391: `faff merge-gate --selftest`, the in-memory selftest over the merge-gate modules ===
// ===========================================================================
// Split out of merge-gate.js (FAFF-1391), unchanged.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { decideFloor, resolveGateLevel } = require("./contract-defs");
const { appendEffectEntries, computeEscapes } = require("./effects");
const { parseMergeArgs, resolveMergeFlags, fenceHumanFlags, nonGraftFloorSignature, narrowReviewUnavailableExcusable, classifyHeadShaChecks, classifyCiObservation, classifyMergeFailure, classifyPostMerge } = require("./merge-gate-classify");
const { mergeRecordPath, writeMergeRecord, resolveIntegrity, readAcComplete, holdoutIsFresh, laneBoundaryPromisesCage, laneBoundaryDispatchState, evaluateCustody, readCanRun, readCaged, readLedgerSutEnvStood, resolveCanRun, resolveHoldoutLeg } = require("./merge-gate-floor");
const { mergeEffectsFor, observeMergeEffects, repoSlugFromPrUrl, hasPullRequestRule, andGrants } = require("./merge-gate-effects");
const { gitRemoteEmpty, resolveLocalBase, gatesSignalToCiState, cmdMergeGateLocal } = require("./merge-gate-local");
const { classifyDependencyGate } = require("./merge-gate-stack");

// In-memory selftest: drives the PURE cores (decideFloor via classifyHeadShaChecks + parseMergeArgs
// + classifyBranchProtection) with NO network. The impure gh/git path is covered by the integration
// smoke test in the spec, not here (parity with container-check's pure-only selftest).
async function mergeGateSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } else console.log(`ok   ${label}`); };
  const F = (o) => decideFloor({ ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", no_ci_policy: "needs-human", ...o });
  check("all-green → merge-ok", F({}).verdict === "merge-ok");
  check("ci-red → refuse", F({ ci_state: "ci-red" }).verdict === "refuse");
  check("no-ci-coverage → refuse (default)", F({ ci_state: "no-ci-coverage" }).verdict === "refuse");
  check("no-ci-coverage + allow → merge-ok", F({ ci_state: "no-ci-coverage", no_ci_policy: "allow" }).verdict === "merge-ok");
  check("head-sha-mismatch → refuse", F({ head_sha_matches: false }).verdict === "refuse");
  check("indeterminate → refuse", F({ ci_state: "indeterminate" }).verdict === "refuse");
  check("absent review block → refuse", F({ review_verdict: "missing" }).verdict === "refuse");
  check("unavailable review verdict → refuse, never merge-ok (FAFF-405)", F({ review_verdict: "unavailable" }).verdict === "refuse");
  check("L4 holdout meets-spec → merge-ok", F({ level: "L4", holdout: "meets-spec" }).verdict === "merge-ok");
  check("L4 holdout missing → refuse", F({ level: "L4", holdout: "missing" }).verdict === "refuse");
  check("L4 holdout blocked → refuse", F({ level: "L4", holdout: "blocked" }).verdict === "refuse");
  // FAFF-1040: decideFloor blocks on the resolved POSTURE, not the L-level label. Only "strict"
  // blocks; "pass-through" never blocks; an unset posture keeps the level-aware back-compat default
  // (the three L4 checks above rely on it: L4 → strict, so they are unchanged).
  check("holdout posture strict + missing → refuse", F({ holdout_posture: "strict", holdout: "missing" }).verdict === "refuse");
  check("holdout posture strict + meets-spec → merge-ok", F({ holdout_posture: "strict", holdout: "meets-spec" }).verdict === "merge-ok");
  check("holdout posture pass-through + missing → merge-ok (never blocks)", F({ holdout_posture: "pass-through", holdout: "missing" }).verdict === "merge-ok");
  check("holdout posture absent + L3 defaults pass-through → merge-ok", F({ level: "L3", holdout: "missing" }).verdict === "merge-ok");
  check("holdout posture strict names the FAFF-1040 blocker", /holdout guarantee \(strict\)/.test(F({ holdout_posture: "strict", holdout: "missing" }).blockers.join(" ")));
  // holdoutIsFresh (FAFF-420): pure freshness comparator readHoldout wraps around the run-scoped read
  check("holdoutIsFresh: fresh (holdout after checkpoint) → true", holdoutIsFresh(200, 100) === true);
  check("holdoutIsFresh: stale (holdout before checkpoint) → false", holdoutIsFresh(50, 100) === false);
  check("holdoutIsFresh: equal timestamps (not strictly after) → false", holdoutIsFresh(100, 100) === false);
  check("holdoutIsFresh: non-finite holdout mtime → false", holdoutIsFresh(NaN, 100) === false);
  check("holdoutIsFresh: non-finite checkpoint time → false", holdoutIsFresh(200, NaN) === false);
  check("holdoutIsFresh: both non-finite → false", holdoutIsFresh(NaN, NaN) === false);
  // FAFF-1147: readAcComplete — schema-1 back-compat + schema-2 per-criterion cross-check (real fs fixtures).
  {
    const acTmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-ac-checklist-"));
    const writeAc = (issue, obj) => {
      fs.mkdirSync(path.join(acTmp, issue), { recursive: true });
      fs.writeFileSync(path.join(acTmp, issue, "ac-checklist.json"), JSON.stringify(obj));
    };
    try {
      writeAc("S1", { all_verified: true });
      check("readAcComplete: schema-1 all_verified:true, no criteria → true (aggregate authoritative)", readAcComplete(acTmp, "S1") === true);
      writeAc("S1F", { all_verified: false });
      check("readAcComplete: schema-1 all_verified:false → false", readAcComplete(acTmp, "S1F") === false);
      writeAc("LEGACY", { ac_complete: true });
      check("readAcComplete: legacy schema-1 ac_complete:true → true (back-compat)", readAcComplete(acTmp, "LEGACY") === true);
      writeAc("S2OK", { all_verified: true, criteria: [{ ac: "A", verified: "test x", passed: true }, { ac: "B", verified: "test y", passed: true }] });
      check("readAcComplete: schema-2 all passed → true", readAcComplete(acTmp, "S2OK") === true);
      writeAc("S2BAD", { all_verified: true, criteria: [{ ac: "A", verified: "test x", passed: true }, { ac: "B", verified: "Needs human verification: layout", passed: false }] });
      check("readAcComplete: schema-2 aggregate-true but one criterion passed:false → false (auditable, fail-closed)", readAcComplete(acTmp, "S2BAD") === false);
      writeAc("S2EMPTY", { all_verified: true, criteria: [] });
      check("readAcComplete: schema-2 empty criteria array → false (fail-closed; a real zero-AC issue emits schema-1)", readAcComplete(acTmp, "S2EMPTY") === false);
      writeAc("S2NOTARR", { all_verified: true, criteria: "oops" });
      check("readAcComplete: schema-2 criteria not an array → false (malformed, fail-closed)", readAcComplete(acTmp, "S2NOTARR") === false);
      writeAc("S2NOPASS", { all_verified: true, criteria: [{ ac: "A", verified: "x" }] });
      check("readAcComplete: schema-2 criterion missing passed → false (missing passed => not-passed)", readAcComplete(acTmp, "S2NOPASS") === false);
      check("readAcComplete: missing file → false (fail-closed)", readAcComplete(acTmp, "NOPE") === false);
      fs.mkdirSync(path.join(acTmp, "MAL"), { recursive: true });
      fs.writeFileSync(path.join(acTmp, "MAL", "ac-checklist.json"), "{not valid json");
      check("readAcComplete: unparseable json → false (fail-closed)", readAcComplete(acTmp, "MAL") === false);
    } finally { fs.rmSync(acTmp, { recursive: true, force: true }); }
  }
  check("multi-blocker names all legs", F({ ac_complete: false, review_verdict: "fail" }).blockers.length === 2);
  // decideFloor integrity leg (FAFF-325): undefined (every pre-existing fixture above) is a no-op;
  // "violated" refuses at EVERY level, never level-graded; "unasserted-refuse" (the L4
  // defence-in-depth branch) refuses; "asserted"/"unasserted-ok" never block.
  check("integrity: undefined (unset) → no-op, all-green still merge-ok", F({}).verdict === "merge-ok");
  check("integrity: asserted → merge-ok", F({ integrity: "asserted" }).verdict === "merge-ok");
  check("integrity: unasserted-ok (L1-L3, no declaration) → merge-ok", F({ integrity: "unasserted-ok" }).verdict === "merge-ok");
  check("integrity: unasserted-refuse (L4 defence-in-depth) → refuse", F({ level: "L4", holdout: "meets-spec", integrity: "unasserted-refuse" }).verdict === "refuse");
  check("integrity: violated at L3 → refuse (violation is never level-graded)", F({ integrity: "violated" }).verdict === "refuse");
  check("integrity: violated at L4 → refuse too", F({ level: "L4", holdout: "meets-spec", integrity: "violated" }).verdict === "refuse");
  check("integrity: violated names the FAFF-325 blocker", /corrective-artifact integrity violated/.test(F({ integrity: "violated" }).blockers.join(" ")));
  check("integrity: unasserted-refuse names the FAFF-325 blocker", /unasserted at L4/.test(F({ level: "L4", holdout: "meets-spec", integrity: "unasserted-refuse" }).blockers.join(" ")));
  // FAFF-1077 dependency_gate leg: absent/not-applicable/satisfied never block; blocked refuses.
  check("dependency_gate: undefined (unset) → no-op, all-green still merge-ok", F({}).verdict === "merge-ok");
  check("dependency_gate: not-applicable → merge-ok", F({ dependency_gate: "not-applicable" }).verdict === "merge-ok");
  check("dependency_gate: satisfied → merge-ok", F({ dependency_gate: "satisfied" }).verdict === "merge-ok");
  check("dependency_gate: blocked → refuse", F({ dependency_gate: "blocked" }).verdict === "refuse");
  check("dependency_gate: blocked names the FAFF-1077 blocker", /stacked dependency PR not yet merged/.test(F({ dependency_gate: "blocked" }).blockers.join(" ")));
  // FAFF-1077 classifyDependencyGate (pure, born-verifiable): the two owner-park outcomes carry a
  // park intent + reconsider:human; open/transient block without a park; merged+ok is satisfied.
  check("classifyDependencyGate: dependency OPEN → blocked, no park", (() => { const c = classifyDependencyGate("B", 7, "OPEN", null); return c.gate === "blocked" && !c.park; })());
  check("classifyDependencyGate: dependency MERGED + rebase ok → satisfied", (() => { const c = classifyDependencyGate("B", 7, "MERGED", "ok"); return c.gate === "satisfied" && !c.park; })());
  check("classifyDependencyGate: dependency MERGED + rebase conflict → blocked + park:human", (() => { const c = classifyDependencyGate("B", 7, "MERGED", "conflict"); return c.gate === "blocked" && c.park && c.park.reconsider === "human"; })());
  check("classifyDependencyGate: dependency CLOSED-unmerged → blocked + dead-base park:human", (() => { const c = classifyDependencyGate("B", 7, "CLOSED", null); return c.gate === "blocked" && c.park && /base is dead/.test(c.park.cause) && c.park.reconsider === "human"; })());
  check("classifyDependencyGate: unreadable (null) → blocked, no park (transient)", (() => { const c = classifyDependencyGate("B", 7, null, null); return c.gate === "blocked" && !c.park && /forge blip/.test(c.note); })());
  // resolveIntegrity (FAFF-325): pure-enough to drive with a synthetic fsq (no real /proc/1/environ
  // dependency) — proves the L4 branch is keyed on the SAME reconciled `level` as holdout, never a
  // second, divergent source, and that a violation basis always yields "violated" regardless of level.
  check("resolveIntegrity: no-declaration + L3 → unasserted-ok/unasserted", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-integrity-"));
    try {
      const r = resolveIntegrity(tmp, "FAFF-1", "L3");
      return r.state === "unasserted-ok" && r.display === "unasserted";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("resolveIntegrity: no-declaration + L4 → unasserted-refuse/unasserted (defence-in-depth)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-integrity-"));
    try {
      const r = resolveIntegrity(tmp, "FAFF-1", "L4");
      return r.state === "unasserted-refuse" && r.display === "unasserted";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // FAFF-892: a clean digest verify union at L4 no-declaration GRANTS (custody-trusted), not refuse.
  check("resolveIntegrity: no-declaration + L4 + clean digest → custody-trusted (grant)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-integrity-"));
    try {
      const r = resolveIntegrity(tmp, "FAFF-1", "L4", { held: true, diffs: [] });
      return r.state === "custody-trusted" && r.display === "custody-trusted" && r.basis === "digest-verified";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // FAFF-892: an uncomputable/tampered digest union at L4 no-declaration still REFUSES (violated).
  check("resolveIntegrity: no-declaration + L4 + tampered digest → violated (refuse)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-integrity-"));
    try {
      const r = resolveIntegrity(tmp, "FAFF-1", "L4", { held: true, diffs: ["x"] });
      return r.state === "violated";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // FAFF-1072: branch-6 keys on the run FACTS, not the L4 label. An UNATTENDED L3 top-level merge
  // (declared-unattended config, no lane-boundary ⇒ dispatch "absent") with no custody declaration
  // now refuses (the previously-uncovered cell); an ATTENDED L3 stays unasserted-ok (byte-for-byte).
  check("resolveIntegrity: L3 + declared-unattended + no dispatch cut → unasserted-refuse (FAFF-1072 new cell)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-integrity-"));
    try {
      const r = resolveIntegrity(tmp, "FAFF-1", "L3", undefined, { autonomous: { unattended: true } });
      return r.state === "unasserted-refuse";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("resolveIntegrity: L3 + attended (no config) + no dispatch cut → unasserted-ok (unchanged)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-integrity-"));
    try {
      const r = resolveIntegrity(tmp, "FAFF-1", "L3", undefined, {});
      return r.state === "unasserted-ok";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // FAFF-1072: an interactive L2 merge is attended by construction — a repo-wide unattended
  // declaration never makes it require a custody stamp (only an automated run does).
  check("resolveIntegrity: L2 + declared-unattended config → unasserted-ok (interactive is attended, never unattended)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-integrity-"));
    try {
      const r = resolveIntegrity(tmp, "FAFF-1", "L2", undefined, { autonomous: { unattended: true } });
      return r.state === "unasserted-ok";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // FAFF-1072: the legacy alias key (autonomous.sentry_acting) also asserts unattended (ADR-0103 mix).
  check("resolveIntegrity: L3 + sentry_acting alias + no dispatch cut → unasserted-refuse", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-integrity-"));
    try {
      const r = resolveIntegrity(tmp, "FAFF-1", "L3", undefined, { autonomous: { sentry_acting: true } });
      return r.state === "unasserted-refuse";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // resolveGateLevel (FAFF-424): ledger governs when present; flag/default path unchanged when absent
  check("resolveGateLevel: L4 ledger, no flag → L4/no-mismatch", (() => { const r = resolveGateLevel("L4", null); return r.level === "L4" && r.mismatch === false; })());
  check("resolveGateLevel: L4 ledger, L3 flag → mismatch", (() => { const r = resolveGateLevel("L4", "L3"); return r.level === "L4" && r.mismatch === true; })());
  check("resolveGateLevel: L4 ledger, L4 flag → L4/no-mismatch", (() => { const r = resolveGateLevel("L4", "L4"); return r.level === "L4" && r.mismatch === false; })());
  check("resolveGateLevel: no ledger, L3 flag → L3/no-mismatch", (() => { const r = resolveGateLevel(null, "L3"); return r.level === "L3" && r.mismatch === false; })());
  check("resolveGateLevel: no ledger, no flag → L3 default", (() => { const r = resolveGateLevel(null, null); return r.level === "L3" && r.mismatch === false; })());
  check("resolveGateLevel: out-of-enum ledger level (pre-normalised null), L4 flag → L4", (() => { const r = resolveGateLevel(null, "L4"); return r.level === "L4" && r.mismatch === false; })());

  // FAFF-1118 andGrants — the fail-closed AND monoid over the three-valued grant. absent-or-invalid
  // DOMINATES; valid-grant only when every input is valid; not-applicable only when all are.
  check("andGrants: all valid → valid-grant", andGrants("valid-grant", "valid-grant") === "valid-grant");
  check("andGrants: any absent-or-invalid dominates (valid + absent)", andGrants("valid-grant", "absent-or-invalid") === "absent-or-invalid");
  check("andGrants: absent dominates not-applicable too", andGrants("not-applicable", "absent-or-invalid") === "absent-or-invalid");
  check("andGrants: all not-applicable → not-applicable (ungoverned, byte-for-byte)", andGrants("not-applicable", "not-applicable") === "not-applicable");
  check("andGrants: a non-uniform valid+not-applicable mix fails closed to absent-or-invalid", andGrants("valid-grant", "not-applicable") === "absent-or-invalid");
  check("andGrants: single valid grant → valid-grant (non-delete merge, the FAFF-1034 path)", andGrants("valid-grant") === "valid-grant");
  check("andGrants: single not-applicable → not-applicable (ungoverned non-delete merge)", andGrants("not-applicable") === "not-applicable");
  // FAFF-1212 hasPullRequestRule — pure; true only when a pull_request rule is present.
  check("hasPullRequestRule: a pull_request rule → true", hasPullRequestRule([{ type: "deletion" }, { type: "pull_request" }]) === true);
  check("hasPullRequestRule: no pull_request rule → false", hasPullRequestRule([{ type: "deletion" }, { type: "required_status_checks" }]) === false);
  check("hasPullRequestRule: empty / non-array / null entries → false", hasPullRequestRule([]) === false && hasPullRequestRule(null) === false && hasPullRequestRule([null]) === false);
  check("repoSlugFromPrUrl: parses owner/name from a PR url", repoSlugFromPrUrl("https://github.com/acme/widgets/pull/12") === "acme/widgets");
  check("repoSlugFromPrUrl: an unparseable url → empty", repoSlugFromPrUrl("not a url") === "" && repoSlugFromPrUrl(undefined) === "");
  check("andGrants: zero args → absent-or-invalid (fail-closed, never a vacuous valid-grant)", andGrants() === "absent-or-invalid");

  // classifyHeadShaChecks
  check("head checks: empty → no-ci-coverage", classifyHeadShaChecks([], null, 0) === "no-ci-coverage");
  check("head checks: all success → ci-green", classifyHeadShaChecks([{ status: "completed", conclusion: "success" }], "success", 1) === "ci-green");
  check("head checks: a failure → ci-red", classifyHeadShaChecks([{ status: "completed", conclusion: "failure" }], null, 0) === "ci-red");
  check("head checks: pending → indeterminate", classifyHeadShaChecks([{ status: "in_progress", conclusion: null }], null, 0) === "indeterminate");
  check("head checks: unknown conclusion → ci-red (fail-closed)", classifyHeadShaChecks([{ status: "completed", conclusion: "weird" }], null, 0) === "ci-red");
  check("head checks: status failure → ci-red", classifyHeadShaChecks([], "failure", 1) === "ci-red");
  // FAFF-369: Actions-only repo — green check-run + GitHub's default empty legacy status {pending,0} → ci-green (not indeterminate)
  check("head checks: success + empty legacy {pending,count:0} → ci-green (FAFF-369)", classifyHeadShaChecks([{ status: "completed", conclusion: "success" }], "pending", 0) === "ci-green");
  check("head checks: success + no legacy status at all → ci-green", classifyHeadShaChecks([{ status: "completed", conclusion: "success" }], null, 0) === "ci-green");
  // FAFF-366: checks exist but all skipped/neutral (none executed green) → no-ci-coverage, not a vacuous ci-green (fail-open guard)
  check("head checks: all skipped → no-ci-coverage (FAFF-366)", classifyHeadShaChecks([{ status: "completed", conclusion: "skipped" }, { status: "completed", conclusion: "skipped" }], null, 0) === "no-ci-coverage");
  check("head checks: all neutral → no-ci-coverage (FAFF-366)", classifyHeadShaChecks([{ status: "completed", conclusion: "neutral" }], null, 0) === "no-ci-coverage");
  check("head checks: mixed success + skipped → ci-green (FAFF-366)", classifyHeadShaChecks([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "skipped" }], null, 0) === "ci-green");
  // real legacy status still honoured when it genuinely exists (count>0)
  check("head checks: legacy pending with count>0 → indeterminate", classifyHeadShaChecks([], "pending", 2) === "indeterminate");
  // FAFF-1035 (AC6): a job ended by its own timeout-minutes bound is TERMINAL for the merge
  // observer, not another pending row — cancelled/timed_out are already in the FAIL set above;
  // these two are a regression-lock, not a code change.
  check("head checks: completed/cancelled → ci-red (FAFF-1035)", classifyHeadShaChecks([{ status: "completed", conclusion: "cancelled" }], null, 0) === "ci-red");
  check("head checks: completed/timed_out → ci-red (FAFF-1035)", classifyHeadShaChecks([{ status: "completed", conclusion: "timed_out" }], null, 0) === "ci-red");
  // parseMergeArgs
  check("merge-args: allowed pass through", (() => { const p = parseMergeArgs("--squash --delete-branch"); return p.flags.length === 2 && p.rejected.length === 0; })());
  check("merge-args: unknown token rejected", parseMergeArgs("--squash; rm -rf /").rejected.length > 0);
  check("merge-args: empty → nothing", (() => { const p = parseMergeArgs(""); return p.flags.length === 0 && p.rejected.length === 0; })());
  // FAFF-375: --admin is no longer in the allowlist — it lands in rejected (exit-2 path)
  check("merge-args: --admin rejected (FAFF-375)", (() => { const p = parseMergeArgs("--admin"); return p.rejected.includes("--admin") && p.flags.length === 0; })());
  check("merge-args: --squash --admin → --squash passes, --admin rejected", (() => { const p = parseMergeArgs("--squash --admin"); return p.flags.includes("--squash") && p.rejected.includes("--admin"); })());
  // resolveMergeFlags (FAFF-537): bare method flag folds in, dedupes, conflicts loud, empty → no method
  check("resolve: bare --squash (no --merge-args) folds in", (() => { const r = resolveMergeFlags(["--execute", "--squash"], ""); return r.flags.includes("--squash") && r.method_present && !r.conflict; })());
  check("resolve: bare --squash + --merge-args same method dedupes", (() => { const r = resolveMergeFlags(["--squash"], "--squash --delete-branch"); return r.flags.filter((f) => f === "--squash").length === 1 && r.methods.length === 1 && !r.conflict && r.method_present; })());
  check("resolve: bare --squash + --merge-args --rebase → conflict", (() => { const r = resolveMergeFlags(["--squash"], "--rebase"); return r.conflict && r.methods.length === 2 && r.method_present; })());
  check("resolve: no method anywhere → method_present false", (() => { const r = resolveMergeFlags(["--execute"], ""); return !r.method_present && !r.conflict && r.methods.length === 0; })());
  check("resolve: --merge-args --delete-branch (modifier only) + bare --squash proceeds", (() => { const r = resolveMergeFlags(["--squash"], "--delete-branch"); return r.method_present && r.flags.includes("--squash") && r.flags.includes("--delete-branch") && !r.conflict; })());
  check("resolve: bad --merge-args token still rejected", (() => { const r = resolveMergeFlags(["--squash"], "--admin"); return r.rejected.includes("--admin"); })());
  check("resolve: --merge-args \"--squash --delete-branch\" unchanged, no bare harvest", (() => { const r = resolveMergeFlags(["--merge-args", "--squash --delete-branch"], "--squash --delete-branch"); return r.method_present && r.flags.length === 2 && r.flags.includes("--squash") && r.flags.includes("--delete-branch") && !r.conflict; })());
  // fenceHumanFlags (FAFF-375): human-only flags fenced on a genuine interactivity signal (TTY + --interactive)
  // FAFF-673: the default carries a non-empty override_reason so the pre-existing --human-override
  // ok-cases below stay ok (the reason requirement is exercised by its own cases further down).
  const fence = (o) => fenceHumanFlags({ human_override: false, override_reason: "spike findings; no floor", allow_no_ci: false, interactive: false, stdin_is_tty: false, ...o });
  check("fence: --human-override + non-TTY → violation", !fence({ human_override: true, interactive: true }).ok);
  check("fence: --human-override + TTY + no --interactive → violation", !fence({ human_override: true, stdin_is_tty: true }).ok);
  check("fence: --human-override + TTY + --interactive → ok", fence({ human_override: true, interactive: true, stdin_is_tty: true }).ok);
  check("fence: --allow-no-ci + non-TTY → violation", !fence({ allow_no_ci: true, interactive: true }).ok);
  check("fence: --allow-no-ci + TTY + no --interactive → violation", !fence({ allow_no_ci: true, stdin_is_tty: true }).ok);
  check("fence: --allow-no-ci + TTY + --interactive → ok", fence({ allow_no_ci: true, interactive: true, stdin_is_tty: true }).ok);
  check("fence: neither human-only flag + non-TTY → ok (ordinary autonomous path untouched)", fence({}).ok);
  check("fence: non-TTY names the real-terminal remedy", /real terminal/.test(fence({ human_override: true, interactive: true }).violations.join(" ")));
  // FAFF-673: --human-override REQUIRES a non-empty --override-reason (the explainable-record guard)
  check("fence: --human-override + TTY + --interactive + NO reason → violation", !fence({ human_override: true, interactive: true, stdin_is_tty: true, override_reason: "" }).ok);
  check("fence: --human-override + whitespace-only reason → violation", !fence({ human_override: true, interactive: true, stdin_is_tty: true, override_reason: "   " }).ok);
  check("fence: --human-override + absent reason → violation", !fence({ human_override: true, interactive: true, stdin_is_tty: true, override_reason: undefined }).ok);
  check("fence: --human-override + reason present → ok", fence({ human_override: true, interactive: true, stdin_is_tty: true, override_reason: "spike; no floor" }).ok);
  check("fence: missing-reason violation names --override-reason", /--override-reason/.test(fence({ human_override: true, interactive: true, stdin_is_tty: true, override_reason: "" }).violations.join(" ")));
  check("fence: --override-reason WITHOUT --human-override → ok (reason only meaningful paired)", fence({ human_override: false, override_reason: "" }).ok);
  // FAFF-912: --accept-review-unavailable gets the SAME TTY/--interactive/reason fence as
  // --human-override, plus mutual exclusion with it.
  check("fence: --accept-review-unavailable + non-TTY → violation", !fence({ accept_review_unavailable: true, interactive: true }).ok);
  check("fence: --accept-review-unavailable + TTY + no --interactive → violation", !fence({ accept_review_unavailable: true, stdin_is_tty: true }).ok);
  check("fence: --accept-review-unavailable + TTY + --interactive + reason → ok", fence({ accept_review_unavailable: true, interactive: true, stdin_is_tty: true, override_reason: "outage; clean graft" }).ok);
  check("fence: --accept-review-unavailable + NO reason → violation", !fence({ accept_review_unavailable: true, interactive: true, stdin_is_tty: true, override_reason: "" }).ok);
  check("fence: --accept-review-unavailable + whitespace-only reason → violation", !fence({ accept_review_unavailable: true, interactive: true, stdin_is_tty: true, override_reason: "   " }).ok);
  check("fence: --accept-review-unavailable + absent reason → violation", !fence({ accept_review_unavailable: true, interactive: true, stdin_is_tty: true, override_reason: undefined }).ok);
  check("fence: --accept-review-unavailable missing-reason violation names --override-reason", /--override-reason/.test(fence({ accept_review_unavailable: true, interactive: true, stdin_is_tty: true, override_reason: "" }).violations.join(" ")));
  check("fence: --accept-review-unavailable non-TTY names the real-terminal remedy", /real terminal/.test(fence({ accept_review_unavailable: true, interactive: true }).violations.join(" ")));
  check("fence: --human-override + --accept-review-unavailable together → violation (mutual exclusion)", !fence({ human_override: true, accept_review_unavailable: true, interactive: true, stdin_is_tty: true, override_reason: "x" }).ok);
  check("fence: mutual-exclusion violation names both flags", (() => { const v = fence({ human_override: true, accept_review_unavailable: true, interactive: true, stdin_is_tty: true, override_reason: "x" }).violations.join(" "); return /--human-override/.test(v) && /--accept-review-unavailable/.test(v) && /mutually exclusive/.test(v); })());
  // FAFF-673: nonGraftFloorSignature — the non-graft tell (!ac_complete && review missing); a graft
  // floor (review fail/pass, or ac_complete true) never matches. Signature-boundary coverage.
  check("nonGraftFloorSignature: !ac_complete && review missing → true", nonGraftFloorSignature({ ac_complete: false, review_verdict: "missing" }) === true);
  check("nonGraftFloorSignature: review fail (graft, not yet cleared) → false", nonGraftFloorSignature({ ac_complete: false, review_verdict: "fail" }) === false);
  check("nonGraftFloorSignature: review pass → false", nonGraftFloorSignature({ ac_complete: false, review_verdict: "pass" }) === false);
  check("nonGraftFloorSignature: ac_complete true (graft) → false", nonGraftFloorSignature({ ac_complete: true, review_verdict: "missing" }) === false);
  check("nonGraftFloorSignature: unavailable review verdict → false (not the missing tell)", nonGraftFloorSignature({ ac_complete: false, review_verdict: "unavailable" }) === false);
  // FAFF-912: narrowReviewUnavailableExcusable — true iff review_verdict is "unavailable" AND
  // forcing it to "pass" leaves ZERO remaining blockers (every other leg already green). A pure
  // selftest table: true for review-unavailable-only; false for review fail/missing/needs-human,
  // and for review-unavailable + any other unmet leg, at both L3 and L4.
  const cleanFloorL3 = { ac_complete: true, review_verdict: "unavailable", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", no_ci_policy: "needs-human" };
  const cleanFloorL4 = { ...cleanFloorL3, level: "L4", holdout: "meets-spec", integrity: "asserted" };
  check("narrowReviewUnavailableExcusable: L3, review-unavailable-only → true", narrowReviewUnavailableExcusable(cleanFloorL3) === true);
  check("narrowReviewUnavailableExcusable: L4, review-unavailable-only + holdout meets-spec → true", narrowReviewUnavailableExcusable(cleanFloorL4) === true);
  check("narrowReviewUnavailableExcusable: review fail → false", narrowReviewUnavailableExcusable({ ...cleanFloorL3, review_verdict: "fail" }) === false);
  check("narrowReviewUnavailableExcusable: review missing → false", narrowReviewUnavailableExcusable({ ...cleanFloorL3, review_verdict: "missing" }) === false);
  check("narrowReviewUnavailableExcusable: review needs-human → false", narrowReviewUnavailableExcusable({ ...cleanFloorL3, review_verdict: "needs-human" }) === false);
  check("narrowReviewUnavailableExcusable: review pass (not unavailable) → false", narrowReviewUnavailableExcusable({ ...cleanFloorL3, review_verdict: "pass" }) === false);
  check("narrowReviewUnavailableExcusable: review-unavailable + CI red → false (another leg unmet)", narrowReviewUnavailableExcusable({ ...cleanFloorL3, ci_state: "ci-red" }) === false);
  check("narrowReviewUnavailableExcusable: review-unavailable + AC not verified → false", narrowReviewUnavailableExcusable({ ...cleanFloorL3, ac_complete: false }) === false);
  check("narrowReviewUnavailableExcusable: review-unavailable + head-sha mismatch → false", narrowReviewUnavailableExcusable({ ...cleanFloorL3, head_sha_matches: false }) === false);
  check("narrowReviewUnavailableExcusable: L4 review-unavailable + holdout blocked → false", narrowReviewUnavailableExcusable({ ...cleanFloorL4, holdout: "blocked" }) === false);
  check("narrowReviewUnavailableExcusable: L4 review-unavailable + holdout missing → false", narrowReviewUnavailableExcusable({ ...cleanFloorL4, holdout: "missing" }) === false);
  check("narrowReviewUnavailableExcusable: review-unavailable + integrity violated → false", narrowReviewUnavailableExcusable({ ...cleanFloorL3, integrity: "violated" }) === false);
  // classifyCiObservation (FAFF-376): primary check-runs signal is required; legacy status is an optional supplement
  check("ci-obs: both APIs down → indeterminate + reason", (() => { const r = classifyCiObservation(false, [], false, null, 0); return r.ci_state === "indeterminate" && !!r.api_degraded_reason; })());
  check("ci-obs: check-runs down + legacy success(n>0) → indeterminate (FAFF-376)", classifyCiObservation(false, [], true, "success", 1).ci_state === "indeterminate");
  check("ci-obs: check-runs down + legacy failure(n>0) → indeterminate (uniform severity)", classifyCiObservation(false, [], true, "failure", 1).ci_state === "indeterminate");
  check("ci-obs: check-runs ok(empty) + legacy API down → no-ci-coverage (classification proceeds)", (() => { const r = classifyCiObservation(true, [], false, null, 0); return r.ci_state === "no-ci-coverage" && r.api_degraded_reason === null; })());
  check("ci-obs: check-runs ok(success) + legacy API down → ci-green (supplement optional)", classifyCiObservation(true, [{ status: "completed", conclusion: "success" }], false, null, 0).ci_state === "ci-green");
  check("ci-obs: check-runs ok(success) + legacy success → ci-green (delegation intact)", classifyCiObservation(true, [{ status: "completed", conclusion: "success" }], true, "success", 1).ci_state === "ci-green");
  // classifyMergeFailure (FAFF-376): every kind is a refusal, no success branch
  check("merge-fail: pin-mismatch → head-drift names observed sha", (() => { const r = classifyMergeFailure("failed to merge PR: Head branch was modified. Review and try the merge again.", "abc1234"); return r.kind === "head-drift" && r.blocker.includes("abc1234"); })());
  check("merge-fail: camelCase expectedHeadOid → head-drift", (() => { const r = classifyMergeFailure("GraphQL: expectedHeadOid abcd does not match head", "abc1234"); return r.kind === "head-drift"; })());
  check("merge-fail: 'head ref was modified' → head-drift", (() => { const r = classifyMergeFailure("pull request head ref was modified; review and try the merge again", "abc1234"); return r.kind === "head-drift"; })());
  check("merge-fail: unknown flag → pin-unsupported says upgrade gh", (() => { const r = classifyMergeFailure("unknown flag: --match-head-commit", "abc1234"); return r.kind === "pin-unsupported" && /upgrade gh/i.test(r.blocker); })());
  check("merge-fail: unrelated stderr → generic embeds it verbatim", (() => { const r = classifyMergeFailure("failed to merge: merge conflict between base and head", "abc1234"); return r.kind === "generic" && r.blocker.includes("merge conflict between base and head"); })());
  check("merge-fail: empty stderr → generic 'non-zero exit'", (() => { const r = classifyMergeFailure("", "abc1234"); return r.kind === "generic" && /non-zero exit/.test(r.blocker); })());
  // classifyPostMerge (FAFF-365): the merged-vs-refuse decision on a NON-ZERO gh pr merge exit is a
  // pure function of (merge exit, re-read PR state) — PR state is authoritative over the exit code.
  check("post-merge: merge_ok=true → merged, no warning/blocker", (() => { const r = classifyPostMerge({ merge_ok: true, post_state: null, merge_stderr: "" }); return r.merged === true && r.outcome === "merged" && r.warning === null && r.blocker === null; })());
  check("post-merge: non-zero exit + re-read MERGED → merged with a warning, no blocker", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: "MERGED", merge_stderr: "fatal: 'main' is already checked out" }); return r.merged === true && r.outcome === "merged" && r.blocker === null && /post-merge step failed/.test(r.warning) && r.warning.includes("already checked out"); })());
  check("post-merge: non-zero exit + re-read OPEN → refuse, no warning", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: "OPEN", merge_stderr: "some error" }); return r.merged === false && r.outcome === "refuse" && r.warning === null && /some error/.test(r.blocker); })());
  check("post-merge: non-zero exit + re-read CLOSED → refuse", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: "CLOSED", merge_stderr: "some error" }); return r.merged === false && r.outcome === "refuse"; })());
  check("post-merge: non-zero exit + unreadable re-read (null) → refuse (fail-closed), blocker notes the re-read failure", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: null, merge_stderr: "some error" }); return r.merged === false && r.outcome === "refuse" && /post-merge state re-read failed/.test(r.blocker); })());
  check("post-merge: multi-line stderr collapses to one line in the warning (adversarial review finding)", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: "MERGED", merge_stderr: "line one\nline two\r\nline three" }); return !/[\r\n]/.test(r.warning) && r.warning.includes("line one line two line three"); })());
  check("post-merge: post_state=undefined is NOT treated as unreadable (strict === null, not == null)", (() => { const r = classifyPostMerge({ merge_ok: false, post_state: undefined, merge_stderr: "some error" }); return r.outcome === "refuse" && !/post-merge state re-read failed/.test(r.blocker); })());
  // writeMergeRecord / mergeRecordPath (FAFF-397): the additive floor artifact `faff reconcile`
  // re-reads at run-end — written under <run-dir>/<issue>/merge-record.json on every merge-ok path.
  check("mergeRecordPath: <run-dir>/<issue>/merge-record.json", mergeRecordPath("/r/run-1", "FAFF-397") === path.join("/r/run-1", "FAFF-397", "merge-record.json"));
  check("writeMergeRecord: writes {pr,head_sha,merged,merged_at} to the resolved path", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-record-"));
    try {
      writeMergeRecord(tmp, "FAFF-397", 42, "abc123");
      const record = JSON.parse(fs.readFileSync(mergeRecordPath(tmp, "FAFF-397"), "utf8"));
      return record.pr === 42 && record.head_sha === "abc123" && record.merged === true && typeof record.merged_at === "string";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // writeMergeRecord (FAFF-325): the merge record ALWAYS carries the integrity annotation — an
  // omitted `integrity` arg defaults to "unasserted" (never silently absent), and an explicit
  // value is persisted verbatim.
  check("writeMergeRecord: integrity defaults to 'unasserted' when omitted", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-record-"));
    try {
      writeMergeRecord(tmp, "FAFF-1", 1, "abc");
      const record = JSON.parse(fs.readFileSync(mergeRecordPath(tmp, "FAFF-1"), "utf8"));
      return record.integrity === "unasserted";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("writeMergeRecord: an explicit integrity value is persisted verbatim", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-record-"));
    try {
      writeMergeRecord(tmp, "FAFF-1", 1, "abc", "violated");
      const record = JSON.parse(fs.readFileSync(mergeRecordPath(tmp, "FAFF-1"), "utf8"));
      return record.integrity === "violated";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // writeMergeRecord (FAFF-703): additive harness+model, injectable for the test — a legacy
  // caller that never passes `identity` still resolves it fresh (see the real-resolution check
  // below), and a resolution fault (injected identity: null) omits both fields rather than
  // failing the write — the merge-record schema stays valid with or without them either way.
  check("writeMergeRecord: an injected identity is persisted additively as harness+model", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-record-"));
    try {
      writeMergeRecord(tmp, "FAFF-1", 1, "abc", "asserted", { harness: "codex", model: "gpt-5.6-sol", source: "config" });
      const record = JSON.parse(fs.readFileSync(mergeRecordPath(tmp, "FAFF-1"), "utf8"));
      return record.harness === "codex" && record.model === "gpt-5.6-sol" && record.pr === 1 && record.integrity === "asserted";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("writeMergeRecord: a null/unresolvable identity omits harness+model (record stays valid)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-record-"));
    try {
      writeMergeRecord(tmp, "FAFF-1", 1, "abc", "unasserted", null);
      const record = JSON.parse(fs.readFileSync(mergeRecordPath(tmp, "FAFF-1"), "utf8"));
      return !("harness" in record) && !("model" in record) && record.pr === 1;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("writeMergeRecord: an omitted identity resolves the real harness (never throws, always writes)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-record-"));
    try {
      writeMergeRecord(tmp, "FAFF-1", 1, "abc"); // identity omitted entirely — the true default path
      const record = JSON.parse(fs.readFileSync(mergeRecordPath(tmp, "FAFF-1"), "utf8"));
      return typeof record.harness === "string" && record.harness.length > 0 && typeof record.model === "string";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  // mergeEffectsFor / observeMergeEffects (FAFF-383): the merge chokepoint's mechanical-observe
  // side of the effects ledger — pure descriptor construction + the ledger-append integration.
  check("mergeEffectsFor: merge only, no delete-branch → one merge descriptor", (() => {
    const e = mergeEffectsFor(7, false, "some-branch");
    return e.length === 1 && e[0].kind === "merge" && e[0].target === "pr:7" && e[0].reversible === true;
  })());
  check("mergeEffectsFor: delete-branch requested + headRefName known → merge + branch-delete", (() => {
    const e = mergeEffectsFor(7, true, "faff-7-x");
    return e.length === 2 && e[1].kind === "branch-delete" && e[1].target === "faff-7-x" && e[1].reversible === true;
  })());
  check("mergeEffectsFor: delete-branch requested but headRefName unknown → merge only (no crash, no null target)", (() => {
    const e = mergeEffectsFor(7, true, null);
    return e.length === 1 && e[0].kind === "merge";
  })());
  // FAFF-1012: observeMergeEffects now auto-declares the uncovered subset before observing.
  check("observeMergeEffects: with NO prior declare, auto-declares (origin=merge-gate-auto) then observes; computeEscapes reports no merge escape", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-observe-"));
    try {
      observeMergeEffects(tmp, "FAFF-9", mergeEffectsFor(9, false, null));
      const lines = fs.readFileSync(path.join(tmp, "declared-effects.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
      const declares = lines.filter((l) => l.kind_of_entry === "declare");
      const observes = lines.filter((l) => l.kind_of_entry === "observe");
      const escaped = computeEscapes(lines, "FAFF-9").escapes.some((s) => s.step === "merge");
      return declares.length === 1 && declares[0].origin === "merge-gate-auto" && declares[0].effect.target === "pr:9"
        && observes.length === 1 && observes[0].effect.target === "pr:9" && !escaped;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("observeMergeEffects: a pre-existing operator declare is an idempotent top-up (no 2nd declare, sole declare carries no origin)", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-observe-idem-"));
    try {
      appendEffectEntries(tmp, "declare", "FAFF-9", "merge", [{ kind: "merge", target: "pr:9" }]);
      observeMergeEffects(tmp, "FAFF-9", mergeEffectsFor(9, false, null));
      const lines = fs.readFileSync(path.join(tmp, "declared-effects.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
      const declares = lines.filter((l) => l.kind_of_entry === "declare");
      const observes = lines.filter((l) => l.kind_of_entry === "observe");
      return declares.length === 1 && !("origin" in declares[0]) && observes.length === 1 && observes[0].effect.target === "pr:9";
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("observeMergeEffects: branch-delete symmetry — declare (origin) AND observe cover both merge pr:9 and branch-delete; no escape", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-observe-bd-"));
    try {
      observeMergeEffects(tmp, "FAFF-9", mergeEffectsFor(9, true, "faff-9-x"));
      const lines = fs.readFileSync(path.join(tmp, "declared-effects.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
      const declares = lines.filter((l) => l.kind_of_entry === "declare");
      const observes = lines.filter((l) => l.kind_of_entry === "observe");
      const has = (arr, kind, target) => arr.some((l) => l.effect.kind === kind && l.effect.target === target);
      const escaped = computeEscapes(lines, "FAFF-9").escapes.some((s) => s.step === "merge");
      return declares.length === 2 && declares.every((d) => d.origin === "merge-gate-auto")
        && has(declares, "merge", "pr:9") && has(declares, "branch-delete", "faff-9-x")
        && has(observes, "merge", "pr:9") && has(observes, "branch-delete", "faff-9-x") && !escaped;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("observeMergeEffects: on a writable empty-ledger dir the uncovered warning stays SILENT (auto-declare covered it) and the ledger ends covered", (() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-observe-quiet-"));
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = (chunk) => { captured += chunk; return true; };
    try { observeMergeEffects(tmp, "FAFF-9", mergeEffectsFor(9, false, null)); }
    finally { process.stderr.write = origWrite; }
    try {
      const lines = fs.readFileSync(path.join(tmp, "declared-effects.jsonl"), "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
      const escaped = computeEscapes(lines, "FAFF-9").escapes.some((s) => s.step === "merge");
      return !/no covering declaration/.test(captured) && !escaped;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })());
  check("observeMergeEffects: an unwritable run dir never throws; auto-declare-failed + the uncovered warning + observe-failed all reach stderr (declare failure does not skip the observe)", (() => {
    const origWrite = process.stderr.write;
    let captured = "";
    process.stderr.write = (chunk) => { captured += chunk; return true; };
    let threw = false;
    try { observeMergeEffects("/nonexistent/definitely-not-a-real-path", "FAFF-9", mergeEffectsFor(9, false, null)); }
    catch (e) { threw = true; }
    finally { process.stderr.write = origWrite; }
    return !threw
      && /effects ledger auto-declare failed/.test(captured)
      && /observed merge pr:9 with no covering declaration — declare it at graft Step 10/.test(captured)
      && /effects ledger observe failed/.test(captured);
  })());
  // === FAFF-526: git-only `--local` branch — pure + integration coverage ===================
  // gatesSignalToCiState: the WHOLE CI-equivalent substitution table (spec §3 WHAT).
  check("gatesSignalToCiState: pass → ci-green", gatesSignalToCiState({ signal: "pass", discovery: "confident" }) === "ci-green");
  check("gatesSignalToCiState: fail → ci-red", gatesSignalToCiState({ signal: "fail", discovery: "confident" }) === "ci-red");
  check("gatesSignalToCiState: needs-human (errored rung, gates WERE discovered) → indeterminate", gatesSignalToCiState({ signal: "needs-human", discovery: "confident" }) === "indeterminate");
  check("gatesSignalToCiState: discovery:none → no-ci-coverage EVEN THOUGH runLadder folds it into signal=needs-human under gates.fallback:fail-closed (must not collide with a genuine errored-rung indeterminate)", gatesSignalToCiState({ signal: "needs-human", discovery: "none" }) === "no-ci-coverage");
  check("gatesSignalToCiState: discovery:none under gates.fallback:advisory (signal=pass) → still no-ci-coverage (discovery, not signal, governs)", gatesSignalToCiState({ signal: "pass", discovery: "none" }) === "no-ci-coverage");
  check("gatesSignalToCiState: unrecognised/other signal → no-ci-coverage (fail-closed, never a fabricated green)", gatesSignalToCiState({ signal: "something-else", discovery: "confident" }) === "no-ci-coverage");
  check("gatesSignalToCiState: null/undefined outcome → no-ci-coverage (fail-closed)", gatesSignalToCiState(null) === "no-ci-coverage");

  // gitRemoteEmpty / resolveLocalBase / cmdMergeGateLocal — integration coverage against REAL git
  // repos (mirrors post-merge.js's postMergeSelftest pattern: no mocking of git itself).
  await (async () => {
    const gitTmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-gate-local-"));
    const git = (cwd, ...gitArgs) => spawnSync("git", ["-C", cwd, ...gitArgs], { encoding: "utf8" });
    const makeRepo = (dir, testScript) => {
      fs.mkdirSync(dir, { recursive: true });
      git(dir, "init", "-q", "-b", "main");
      git(dir, "config", "user.email", "t@t.t");
      git(dir, "config", "user.name", "t");
      if (testScript !== null) fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: testScript } }));
      else fs.writeFileSync(path.join(dir, "README.md"), "no gates declared\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-qm", "base");
      git(dir, "checkout", "-qb", "feature");
      fs.writeFileSync(path.join(dir, "feature.txt"), "x");
      git(dir, "add", "-A");
      git(dir, "commit", "-qm", "feature work");
    };
    const writeFloor = (runDir, issue, acVerified, reviewSignal) => {
      fs.mkdirSync(path.join(runDir, issue), { recursive: true });
      fs.writeFileSync(path.join(runDir, issue, "ac-checklist.json"), JSON.stringify({ all_verified: acVerified }));
      fs.writeFileSync(path.join(runDir, issue, "review-verdict.json"), JSON.stringify({ signal: reviewSignal, findings: [] }));
    };
    // FAFF-690 (F1): the --local level source is now the committed anchor at the branch head. Commit
    // .faff/anchors/<basename(runDir)>/<issue>/run-ledger.json onto the branch under merge (makeRepo
    // leaves the repo on `feature`) so `git show <featureHead>:<anchorPath>` resolves it.
    const commitAnchor = (repoDir, runDir, issue, level) => {
      const abs = path.join(repoDir, ".faff", "anchors", path.basename(runDir), issue, "run-ledger.json");
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, JSON.stringify({ run_id: path.basename(runDir), level }));
      git(repoDir, "add", "-A");
      git(repoDir, "commit", "-qm", "anchor");
    };
    const runLocal = (issue, runDir, cwd, overrides) => cmdMergeGateLocal({
      issue, runDir, branchFlag: null, baseFlag: null, flagLevel: null, mode: "execute",
      interactive: false, humanOverride: false, allowNoCi: false, noCiPolicy: "needs-human",
      mergeArgsRaw: "", json: true, cwd, ...overrides,
    });
    try {
      // --- repo A: no remote, a passing UNIT rung, a clean feature branch ---
      const repoA = path.join(gitTmp, "repo-a");
      makeRepo(repoA, "true");

      check("gitRemoteEmpty: no remote configured → true", gitRemoteEmpty(repoA) === true);
      check("resolveLocalBase: explicit --base wins", resolveLocalBase(repoA, "custom") === "custom");
      check("resolveLocalBase: main exists locally → 'main'", resolveLocalBase(repoA, null) === "main");

      const runDirA = path.join(gitTmp, "run-dir-a");
      writeFloor(runDirA, "FAFF-526A", true, "pass");
      commitAnchor(repoA, runDirA, "FAFF-526A", "L3");
      const featureShaA = git(repoA, "rev-parse", "feature").stdout.trim(); // after the anchor commit
      const okRes = await runLocal("FAFF-526A", runDirA, repoA);
      check("cmdMergeGateLocal: clean build (AC+review+gates green) → exit 0 merge-ok", okRes === 0);
      check("cmdMergeGateLocal: base ref advanced to the feature tip", git(repoA, "rev-parse", "main").stdout.trim() === featureShaA);
      const recordA = JSON.parse(fs.readFileSync(path.join(runDirA, "FAFF-526A", "merge-record.json"), "utf8"));
      check("cmdMergeGateLocal: merge-record.json carries head_sha + pr:0 (null pr coerced by Number())", recordA.head_sha === featureShaA && recordA.pr === 0 && recordA.merged === true);

      // idempotent: a second invocation on the now-already-merged branch is a no-op merge-ok
      const idempotentRes = await runLocal("FAFF-526A", runDirA, repoA);
      check("cmdMergeGateLocal: already-merged branch → idempotent exit 0 (no double-merge)", idempotentRes === 0);

      // --- repo B: no remote, a FAILING UNIT rung ---
      const repoB = path.join(gitTmp, "repo-b");
      makeRepo(repoB, "false");
      const runDirB = path.join(gitTmp, "run-dir-b");
      writeFloor(runDirB, "FAFF-526B", true, "pass");
      commitAnchor(repoB, runDirB, "FAFF-526B", "L3");
      const baseBeforeB = git(repoB, "rev-parse", "main").stdout.trim();
      const failRes = await runLocal("FAFF-526B", runDirB, repoB);
      check("cmdMergeGateLocal: failing gates run (signal=fail → ci-red) → exit 1 refuse", failRes === 1);
      check("cmdMergeGateLocal: failing gates → base ref NOT advanced", git(repoB, "rev-parse", "main").stdout.trim() === baseBeforeB);
      check("cmdMergeGateLocal: failing gates → no merge-record.json written", !fs.existsSync(path.join(runDirB, "FAFF-526B", "merge-record.json")));

      // --- repo C: no remote, no declared gates at all (discovery:none) ---
      const repoC = path.join(gitTmp, "repo-c");
      makeRepo(repoC, null);
      const runDirC = path.join(gitTmp, "run-dir-c");
      writeFloor(runDirC, "FAFF-526C", true, "pass");
      commitAnchor(repoC, runDirC, "FAFF-526C", "L3");
      const noGatesRes = await runLocal("FAFF-526C", runDirC, repoC);
      check("cmdMergeGateLocal: discovery:none (no declared gates) → refuse fail-closed (no_ci_policy default needs-human)", noGatesRes === 1);

      // --- repo D: HAS a configured remote → bypass-guard refuses --local outright ---
      const repoD = path.join(gitTmp, "repo-d");
      const remoteD = path.join(gitTmp, "remote-d.git");
      git(gitTmp, "init", "-q", "--bare", remoteD);
      makeRepo(repoD, "true");
      git(repoD, "remote", "add", "origin", remoteD);
      check("gitRemoteEmpty: a configured remote → false", gitRemoteEmpty(repoD) === false);
      const remoteRes = await runLocal("FAFF-526D", path.join(gitTmp, "run-dir-d"), repoD);
      check("cmdMergeGateLocal: repo WITH a remote → bypass-guard refuses exit 2 (never usable as a CI-skip)", remoteRes === 2);

      // --- repo E: base branch moved (not fast-forwardable) after the feature branched ---
      const repoE = path.join(gitTmp, "repo-e");
      makeRepo(repoE, "true");
      const runDirE = path.join(gitTmp, "run-dir-e");
      writeFloor(runDirE, "FAFF-526E", true, "pass");
      commitAnchor(repoE, runDirE, "FAFF-526E", "L3"); // on feature, before main diverges
      git(repoE, "checkout", "-q", "main");
      fs.writeFileSync(path.join(repoE, "main-moved.txt"), "y");
      git(repoE, "add", "-A");
      git(repoE, "commit", "-qm", "main moved on independently");
      git(repoE, "checkout", "-q", "feature");
      const notFfRes = await runLocal("FAFF-526E", runDirE, repoE);
      check("cmdMergeGateLocal: base moved since branching (non-ff) → refuse 'rebase first' (ff-only)", notFfRes === 1);

      // --- repo F: non-pass review verdict ---
      const repoF = path.join(gitTmp, "repo-f");
      makeRepo(repoF, "true");
      const runDirF = path.join(gitTmp, "run-dir-f");
      writeFloor(runDirF, "FAFF-526F", true, "needs-human");
      commitAnchor(repoF, runDirF, "FAFF-526F", "L3");
      const nonPassRes = await runLocal("FAFF-526F", runDirF, repoF);
      check("cmdMergeGateLocal: review verdict != pass → refuse (identical fail-closed floor as the PR path)", nonPassRes === 1);

      // --- repo G: AC not all verified ---
      const repoG = path.join(gitTmp, "repo-g");
      makeRepo(repoG, "true");
      const runDirG = path.join(gitTmp, "run-dir-g");
      writeFloor(runDirG, "FAFF-526G", false, "pass");
      commitAnchor(repoG, runDirG, "FAFF-526G", "L3");
      const acRes = await runLocal("FAFF-526G", runDirG, repoG);
      check("cmdMergeGateLocal: AC not all verified → refuse", acRes === 1);

      // === FAFF-673: non-graft remedy + explainable-record integration on the local path ========
      // Capture the emitted JSON (runLocal passes json:true → the result object is written to stdout).
      const captureStdout = async (fn) => {
        const orig = process.stdout.write; let out = "";
        process.stdout.write = (c) => { out += c; return true; };
        let ret; try { ret = await fn(); } finally { process.stdout.write = orig; }
        return { out, ret };
      };

      // --- repo H: NON-GRAFT refuse (no ac-checklist, no review-verdict) → refuse names the remedy ---
      const repoH = path.join(gitTmp, "repo-h");
      makeRepo(repoH, "true");
      const runDirH = path.join(gitTmp, "run-dir-h");
      fs.mkdirSync(path.join(runDirH, "FAFF-673H"), { recursive: true }); // no floor artifacts written
      commitAnchor(repoH, runDirH, "FAFF-673H", "L3");
      const capH = await captureStdout(() => runLocal("FAFF-673H", runDirH, repoH));
      const resH = JSON.parse(capH.out);
      check("FAFF-673: non-graft refuse (no AC, no review) → exit 1", capH.ret === 1);
      check("FAFF-673: non-graft refuse → remedy names the human-merge path (--override-reason)", typeof resH.remedy === "string" && /--override-reason/.test(resH.remedy) && /faff effects declare/.test(resH.remedy));

      // --- repo I: GRAFT refuse (AC verified, review FAIL) → signature does NOT match → NO remedy ---
      const repoI = path.join(gitTmp, "repo-i");
      makeRepo(repoI, "true");
      const runDirI = path.join(gitTmp, "run-dir-i");
      writeFloor(runDirI, "FAFF-673I", true, "fail"); // ac_complete true, review "fail" → not the non-graft key
      commitAnchor(repoI, runDirI, "FAFF-673I", "L3");
      const capI = await captureStdout(() => runLocal("FAFF-673I", runDirI, repoI));
      const resI = JSON.parse(capI.out);
      check("FAFF-673: graft refuse (review fail, AC ok) → refuse, NO remedy (signature mismatch)", capI.ret === 1 && resI.remedy === undefined);

      // --- repo J: sanctioned local override (TTY stubbed) → override JSON carries reason + source ---
      const repoJ = path.join(gitTmp, "repo-j");
      makeRepo(repoJ, "true");
      const runDirJ = path.join(gitTmp, "run-dir-j");
      fs.mkdirSync(path.join(runDirJ, "FAFF-673J"), { recursive: true }); // non-graft refuse, then override
      commitAnchor(repoJ, runDirJ, "FAFF-673J", "L3");
      const origTty = process.stdin.isTTY;
      let overrideExit;
      try {
        process.stdin.isTTY = true; // the fence requires a real terminal; stub it for the test
        overrideExit = (await captureStdout(() => runLocal("FAFF-673J", runDirJ, repoJ, { interactive: true, humanOverride: true, overrideReason: "spike findings; no floor applies" }))).ret;
      } finally { process.stdin.isTTY = origTty; }
      check("FAFF-673: local override with reason → exit 0 (override replaces the refusal, merges)", overrideExit === 0);
      const ovrJ = JSON.parse(fs.readFileSync(path.join(runDirJ, "FAFF-673J", "merge-gate-override.json"), "utf8"));
      check("FAFF-673: local override JSON carries the reason", ovrJ.reason === "spike findings; no floor applies");
      check("FAFF-673: local override JSON carries source:human-override", ovrJ.source === "human-override");

      // --- repo K: --human-override with NO reason → exit 2 (fenced), NO override JSON written ---
      const repoK = path.join(gitTmp, "repo-k");
      makeRepo(repoK, "true");
      const runDirK = path.join(gitTmp, "run-dir-k");
      fs.mkdirSync(path.join(runDirK, "FAFF-673K"), { recursive: true });
      commitAnchor(repoK, runDirK, "FAFF-673K", "L3");
      let noReasonExit;
      const origStderr673 = process.stderr.write;
      try {
        process.stdin.isTTY = true;
        process.stderr.write = () => true; // swallow the expected fence stderr
        noReasonExit = await runLocal("FAFF-673K", runDirK, repoK, { interactive: true, humanOverride: true, overrideReason: null });
      } finally { process.stdin.isTTY = origTty; process.stderr.write = origStderr673; }
      check("FAFF-673: --human-override with NO --override-reason → exit 2 (fenced, never a silent override)", noReasonExit === 2);
      check("FAFF-673: --human-override with NO reason → NO merge-gate-override.json written", !fs.existsSync(path.join(runDirK, "FAFF-673K", "merge-gate-override.json")));

      // === FAFF-912: --accept-review-unavailable — the narrow, audited outage-accept =============

      // --- repo L: clean build EXCEPT review is "unavailable" → narrow accept lands the merge ---
      const repoL = path.join(gitTmp, "repo-l");
      makeRepo(repoL, "true");
      const runDirL = path.join(gitTmp, "run-dir-l");
      writeFloor(runDirL, "FAFF-912L", true, "unavailable");
      commitAnchor(repoL, runDirL, "FAFF-912L", "L3");
      let acceptExit;
      try {
        process.stdin.isTTY = true;
        acceptExit = (await captureStdout(() => runLocal("FAFF-912L", runDirL, repoL, { interactive: true, acceptReviewUnavailable: true, overrideReason: "outage; clean graft" }))).ret;
      } finally { process.stdin.isTTY = origTty; }
      check("FAFF-912: narrow accept on a review-unavailable-only refuse → exit 0 (merges)", acceptExit === 0);
      const ovrL = JSON.parse(fs.readFileSync(path.join(runDirL, "FAFF-912L", "merge-gate-override.json"), "utf8"));
      check("FAFF-912: narrow accept override JSON carries source:review-unavailable-accept", ovrL.source === "review-unavailable-accept");
      check("FAFF-912: narrow accept override JSON carries the reason", ovrL.reason === "outage; clean graft");
      check("FAFF-912: narrow accept override JSON names the review-unavailable blocker", ovrL.blockers.some((b) => /review verdict is unavailable/.test(b)));

      // --- repo M: review is "fail" (an adverse finding, not an outage) → narrow accept REFUSES,
      // never merges, writes NO override record, and does NOT escalate to a blanket override ---
      const repoM = path.join(gitTmp, "repo-m");
      makeRepo(repoM, "true");
      const runDirM = path.join(gitTmp, "run-dir-m");
      writeFloor(runDirM, "FAFF-912M", true, "fail");
      commitAnchor(repoM, runDirM, "FAFF-912M", "L3");
      const baseBeforeM = git(repoM, "rev-parse", "main").stdout.trim();
      let refuseExit;
      try {
        process.stdin.isTTY = true;
        refuseExit = (await captureStdout(() => runLocal("FAFF-912M", runDirM, repoM, { interactive: true, acceptReviewUnavailable: true, overrideReason: "trying to excuse a real failure" }))).ret;
      } finally { process.stdin.isTTY = origTty; }
      check("FAFF-912: narrow accept on review 'fail' (not an outage) → exit 1 refuse, no merge", refuseExit === 1);
      check("FAFF-912: narrow-accept refuse → base ref NOT advanced", git(repoM, "rev-parse", "main").stdout.trim() === baseBeforeM);
      check("FAFF-912: narrow-accept refuse on review-fail → NO merge-gate-override.json written", !fs.existsSync(path.join(runDirM, "FAFF-912M", "merge-gate-override.json")));

      // --- repo N: review "unavailable" but CI red (another leg unmet) → narrow accept REFUSES,
      // naming the CI leg — never widens into a blanket override ---
      const repoN = path.join(gitTmp, "repo-n");
      makeRepo(repoN, "false"); // failing UNIT rung → CI red
      const runDirN = path.join(gitTmp, "run-dir-n");
      writeFloor(runDirN, "FAFF-912N", true, "unavailable");
      commitAnchor(repoN, runDirN, "FAFF-912N", "L3");
      let ciRedRefuseExit, ciRedRefuseOut;
      try {
        process.stdin.isTTY = true;
        const cap = await captureStdout(() => runLocal("FAFF-912N", runDirN, repoN, { interactive: true, acceptReviewUnavailable: true, overrideReason: "outage; also CI is red" }));
        ciRedRefuseExit = cap.ret; ciRedRefuseOut = cap.out;
      } finally { process.stdin.isTTY = origTty; }
      check("FAFF-912: narrow accept with review-unavailable + CI red → exit 1 refuse (another leg unmet)", ciRedRefuseExit === 1);
      check("FAFF-912: narrow-accept refuse → NO merge-gate-override.json written", !fs.existsSync(path.join(runDirN, "FAFF-912N", "merge-gate-override.json")));
      check("FAFF-912: narrow-accept refuse remedy names --accept-review-unavailable + the CI leg", (() => { const r = JSON.parse(ciRedRefuseOut); return typeof r.remedy === "string" && /--accept-review-unavailable/.test(r.remedy) && /CI failing/.test(r.remedy); })());

      // --- repo O: both --human-override and --accept-review-unavailable somehow reach cmdMergeGateLocal
      // (the CLI-level fence already refuses this at exit 2 — see the arg-validation tests in
      // test/merge-gate.test.mjs; this proves the byte-for-byte-unchanged blanket path still works
      // standalone) ---
      const repoO = path.join(gitTmp, "repo-o");
      makeRepo(repoO, "true");
      const runDirO = path.join(gitTmp, "run-dir-o");
      writeFloor(runDirO, "FAFF-912O", true, "unavailable");
      commitAnchor(repoO, runDirO, "FAFF-912O", "L3");
      let blanketStillWorksExit;
      try {
        process.stdin.isTTY = true;
        blanketStillWorksExit = (await captureStdout(() => runLocal("FAFF-912O", runDirO, repoO, { interactive: true, humanOverride: true, overrideReason: "spike; no floor" }))).ret;
      } finally { process.stdin.isTTY = origTty; }
      check("FAFF-912: --human-override blanket path is byte-for-byte unchanged (still lands, still source:human-override)", blanketStillWorksExit === 0);
      const ovrO = JSON.parse(fs.readFileSync(path.join(runDirO, "FAFF-912O", "merge-gate-override.json"), "utf8"));
      check("FAFF-912: unchanged blanket override still records source:human-override", ovrO.source === "human-override");
    } finally {
      fs.rmSync(gitTmp, { recursive: true, force: true });
    }
  })();

  // FAFF-894: a build-lane boundary makes the run "dispatched" (custody required) but NEVER arms the
  // evaluator cage — laneBoundaryPromisesCage stays keyed on lane === "evaluator". This is the core
  // security property of admitting `build` to LANE_BOUNDARY_LANES; assert it against the shipped readers.
  (() => {
    const emit = (dir, intent) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "lane-boundary.json"), JSON.stringify(intent)); };
    const buildIntent = { version: 1, lane: "build", container: "shared", host: "local", accesses: { repo: "present", host_socket: "present" }, integrity_signal: false };
    const cageIntent = { version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-lane-build-"));
    try {
      const bDir = path.join(tmp, "build"); emit(bDir, buildIntent);
      const cDir = path.join(tmp, "cage"); emit(cDir, cageIntent);
      check("FAFF-894: build-lane boundary → dispatchState 'dispatched' (custody required)", laneBoundaryDispatchState(bDir) === "dispatched");
      check("FAFF-894: build-lane boundary → laneBoundaryPromisesCage false (never arms the cage)", laneBoundaryPromisesCage(bDir) === false);
      check("FAFF-894: evaluator own/absent boundary still arms the cage (predicate unchanged)", laneBoundaryPromisesCage(cDir) === true);
      const cust = evaluateCustody(bDir, "FAFF-894", undefined, undefined);
      check("FAFF-894: dispatched build run with no custody flags → required:true, refuse (FAFF-784 gate fires, not {required:false})", cust.required === true && cust.ok === false);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  })();

  // FAFF-1040: the three-way capability reads + the mint-stamped attendedness fact + the folded leg.
  (() => {
    const ISSUE = "FAFF-1040";
    const cageIntent = { version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false };
    const buildIntent = { version: 1, lane: "build", container: "shared", host: "local", accesses: { repo: "present", host_socket: "present" }, integrity_signal: false };
    // writeRun builds a run dir: fresh|stale|malformed|none holdout, optional lane-boundary + ledger.
    const writeRun = (opts) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-1040-"));
      const idir = path.join(dir, ISSUE); fs.mkdirSync(idir, { recursive: true });
      if (opts.holdout === "fresh" || opts.holdout === "stale") {
        fs.writeFileSync(path.join(idir, "build-progress.json"), JSON.stringify({ updated_at: new Date(1000).toISOString() }));
        fs.writeFileSync(path.join(idir, "holdout.json"), JSON.stringify(opts.block || { aggregate: "meets-spec", criteria: [] }));
        // fresh ⇒ holdout mtime postdates the checkpoint (set the checkpoint to the epoch above);
        // stale ⇒ backdate holdout.json's mtime to before the checkpoint.
        if (opts.holdout === "stale") { const t = new Date(500); fs.utimesSync(path.join(idir, "holdout.json"), t, t); }
      } else if (opts.holdout === "malformed") {
        fs.writeFileSync(path.join(idir, "holdout.json"), "{not json");
      }
      if (opts.lane === "cage") fs.writeFileSync(path.join(dir, "lane-boundary.json"), JSON.stringify(cageIntent));
      else if (opts.lane === "build") fs.writeFileSync(path.join(dir, "lane-boundary.json"), JSON.stringify(buildIntent));
      else if (opts.lane === "malformed") fs.writeFileSync(path.join(dir, "lane-boundary.json"), "{not json");
      return dir;
    };
    const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
    // readCanRun three-way
    let d = writeRun({ holdout: "none" }); check("FAFF-1040: readCanRun no holdout.json → absent", readCanRun(d, ISSUE) === "absent"); rm(d);
    d = writeRun({ holdout: "malformed" }); check("FAFF-1040: readCanRun malformed holdout.json → faulted", readCanRun(d, ISSUE) === "faulted"); rm(d);
    d = writeRun({ holdout: "stale" }); check("FAFF-1040: readCanRun present-but-stale holdout → faulted (fail-safe)", readCanRun(d, ISSUE) === "faulted"); rm(d);
    d = writeRun({ holdout: "fresh" }); check("FAFF-1040: readCanRun fresh readable holdout → satisfied", readCanRun(d, ISSUE) === "satisfied"); rm(d);
    check("FAFF-1040: readCanRun no runDir → absent", readCanRun(null, ISSUE) === "absent");
    // readCaged three-way
    d = writeRun({ holdout: "none", lane: "none" }); check("FAFF-1040: readCaged no lane-boundary → absent", readCaged(d) === "absent"); rm(d);
    d = writeRun({ holdout: "none", lane: "malformed" }); check("FAFF-1040: readCaged malformed lane-boundary → faulted (fail-safe)", readCaged(d) === "faulted"); rm(d);
    d = writeRun({ holdout: "none", lane: "build" }); check("FAFF-1040: readCaged valid non-cage lane → absent (no cage promised)", readCaged(d) === "absent"); rm(d);
    d = writeRun({ holdout: "none", lane: "cage" }); check("FAFF-1040: readCaged valid evaluator-cage lane → satisfied", readCaged(d) === "satisfied"); rm(d);
    // resolveHoldoutLeg integration: fresh caged verdict present → strict (any level), verdict read back
    d = writeRun({ holdout: "fresh", lane: "cage" });
    let leg = resolveHoldoutLeg(d, ISSUE);
    check("FAFF-1040: leg can-run+caged → strict (any level)", leg.holdout_posture === "strict");
    check("FAFF-1040: leg strict reads the verdict back (a real verdict, not pass-through's not-applicable)", leg.holdout !== "not-applicable" && ["meets-spec", "missing", "blocked"].includes(leg.holdout));
    check("FAFF-1040: leg strict has no missing/fault labels", leg.holdout_missing.length === 0 && leg.holdout_fault.length === 0); rm(d);
    // no cage → pass-through labelled, holdout not read
    d = writeRun({ holdout: "fresh", lane: "none" });
    leg = resolveHoldoutLeg(d, ISSUE);
    check("FAFF-1040: leg no cage → pass-through", leg.holdout_posture === "pass-through");
    check("FAFF-1040: leg pass-through labels no-proven-cage + holdout not-applicable", leg.holdout_missing.includes("no-proven-cage") && leg.holdout === "not-applicable"); rm(d);
    // no verdict → pass-through labelled (nothing stood up)
    d = writeRun({ holdout: "none", lane: "cage" });
    leg = resolveHoldoutLeg(d, ISSUE);
    check("FAFF-1040: leg absent verdict → pass-through", leg.holdout_posture === "pass-through");
    check("FAFF-1040: leg absent labels no-...-standable-sut", leg.holdout_missing.includes("no-born-verifiable-dod-or-standable-sut")); rm(d);
    // faulted capability → strict (fail-safe), fault surfaced, verdict read back
    d = writeRun({ holdout: "malformed", lane: "cage" });
    leg = resolveHoldoutLeg(d, ISSUE);
    check("FAFF-1040: leg faulted can-run → strict (fail-safe, never pass-through)", leg.holdout_posture === "strict");
    check("FAFF-1040: leg faulted surfaces the fault + reads verdict (missing) → decideFloor blocks", leg.holdout_fault.length > 0 && leg.holdout === "missing"); rm(d);
    check("FAFF-1040: leg strict + non-meets-spec → decideFloor blocks", decideFloor({ ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "missing", holdout_posture: "strict" }).verdict === "refuse");
    check("FAFF-1040: leg pass-through → decideFloor does not block", decideFloor({ ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", holdout_posture: "pass-through" }).verdict === "merge-ok");
  })();

  // FAFF-1115: the resume-store restore carries a Step-8c holdout.json forward, and freshness holds
  // across the copy regardless of `cp` glob order — readCanRun/readHoldout compare holdout.json's file
  // mtime against build-progress.json's `updated_at` CONTENT field, not its file mtime. A restored
  // verdict stays fresh whichever order the two files land in the fresh run dir.
  (() => {
    const ISSUE = "FAFF-1115";
    const past = new Date(1000).toISOString();
    const mkStore = () => {
      const s = fs.mkdtempSync(path.join(os.tmpdir(), "faff-1115-store-"));
      fs.writeFileSync(path.join(s, "build-progress.json"), JSON.stringify({ updated_at: past }));
      fs.writeFileSync(path.join(s, "holdout.json"), JSON.stringify({ aggregate: "meets-spec", criteria: [] }));
      return s;
    };
    // Restore = copy every *.json from the store into <run_dir>/<issue>/ in a given order (plain cp: dest mtime = now).
    const restore = (order) => {
      const store = mkStore();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-1115-run-"));
      const idir = path.join(dir, ISSUE); fs.mkdirSync(idir, { recursive: true });
      for (const name of order) fs.copyFileSync(path.join(store, name), path.join(idir, name));
      fs.rmSync(store, { recursive: true, force: true });
      return dir;
    };
    const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
    // readCanRun's "satisfied" is exactly the freshness capability (it wraps holdoutIsFresh): satisfied ⟺ the
    // restored verdict postdates the checkpoint's content timestamp. That is the "freshness preserved across the
    // copy" pin; the meets-spec/blocked content check is readHoldout's separate concern, not freshness.
    let d = restore(["build-progress.json", "holdout.json"]);
    check("FAFF-1115: restore (checkpoint→verdict glob order) → readCanRun satisfied (fresh)", readCanRun(d, ISSUE) === "satisfied"); rm(d);
    d = restore(["holdout.json", "build-progress.json"]);
    check("FAFF-1115: restore (verdict→checkpoint glob order) → readCanRun satisfied (glob order irrelevant)", readCanRun(d, ISSUE) === "satisfied"); rm(d);
    // cp -p variant: source mtimes preserved; the stashed holdout was written AFTER the checkpoint, so it stays fresh.
    d = (() => {
      const store = mkStore();
      const later = new Date(2000); fs.utimesSync(path.join(store, "holdout.json"), later, later);
      const older = new Date(1000); fs.utimesSync(path.join(store, "build-progress.json"), older, older);
      const rd = fs.mkdtempSync(path.join(os.tmpdir(), "faff-1115-runp-"));
      const idir = path.join(rd, ISSUE); fs.mkdirSync(idir, { recursive: true });
      for (const name of ["holdout.json", "build-progress.json"]) {
        fs.copyFileSync(path.join(store, name), path.join(idir, name));
        const st = fs.statSync(path.join(store, name)); fs.utimesSync(path.join(idir, name), st.atime, st.mtime);
      }
      fs.rmSync(store, { recursive: true, force: true });
      return rd;
    })();
    check("FAFF-1115: restore with mtime-preserving copy (cp -p) → readCanRun satisfied", readCanRun(d, ISSUE) === "satisfied"); rm(d);
  })();

  // FAFF-1116: capture sut_env_stood in the run ledger + redirect resolveCanRun to read it (live-read
  // fallback). Posture-preservation is the binding constraint — every LEGITIMATE row matches the live floor;
  // only the illegitimate contradiction row diverges, and only toward strict (fail-safe).
  (() => {
    const ISSUE = "FAFF-1116";
    const cage = { version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false };
    // opts: standable (true|false|undefined→omit capabilities), holdout ("fresh"|"none"), caged (bool)
    const mk = (opts) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-1116-"));
      const idir = path.join(dir, ISSUE); fs.mkdirSync(idir, { recursive: true });
      const ledger = { run_id: "r", level: "L2", admitted: [ISSUE], outcomes: {} };
      if (opts.standable !== undefined) ledger.capabilities = { [ISSUE]: { sut_env_stood: opts.standable } };
      fs.writeFileSync(path.join(dir, "run-ledger.json"), JSON.stringify(ledger));
      if (opts.holdout === "fresh") {
        fs.writeFileSync(path.join(idir, "build-progress.json"), JSON.stringify({ updated_at: new Date(1000).toISOString() }));
        fs.writeFileSync(path.join(idir, "holdout.json"), JSON.stringify({ aggregate: "fails", criteria: [] })); // mtime now > 1000 ⇒ fresh
      }
      if (opts.caged) fs.writeFileSync(path.join(dir, "lane-boundary.json"), JSON.stringify(cage));
      return dir;
    };
    const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
    // readLedgerSutEnvStood three-way (true / false / uncaptured→undefined)
    let d = mk({ standable: true, holdout: "none", caged: false }); check("FAFF-1116: readLedgerSutEnvStood captured true", readLedgerSutEnvStood(d, ISSUE) === true); rm(d);
    d = mk({ standable: false, holdout: "none", caged: false }); check("FAFF-1116: readLedgerSutEnvStood captured false", readLedgerSutEnvStood(d, ISSUE) === false); rm(d);
    d = mk({ standable: undefined, holdout: "none", caged: false }); check("FAFF-1116: readLedgerSutEnvStood uncaptured → undefined", readLedgerSutEnvStood(d, ISSUE) === undefined); rm(d);
    d = mk({ standable: undefined, holdout: "none", caged: false }); check("FAFF-1116: readLedgerSutEnvStood no runDir → undefined", readLedgerSutEnvStood(null, ISSUE) === undefined); rm(d);
    // crux: captured false + no holdout → absent (NEVER faulted), pass-through under a cage
    d = mk({ standable: false, holdout: "none", caged: true });
    check("FAFF-1116: crux — captured false + no holdout → resolveCanRun absent (never faulted)", resolveCanRun(d, ISSUE) === "absent");
    check("FAFF-1116: crux — stand-failed run → holdout_posture pass-through (merge not blocked)", resolveHoldoutLeg(d, ISSUE).holdout_posture === "pass-through"); rm(d);
    // a captured false does NOT newly block a run that passes through today (uncaptured baseline == captured-false)
    d = mk({ standable: undefined, holdout: "none", caged: true });
    const baseline = resolveHoldoutLeg(d, ISSUE).holdout_posture; rm(d);
    d = mk({ standable: false, holdout: "none", caged: true });
    check("FAFF-1116: captured false posture == uncaptured baseline (no new block)", resolveHoldoutLeg(d, ISSUE).holdout_posture === baseline && baseline === "pass-through"); rm(d);
    // captured true + fresh verdict → satisfied → strict (with cage), verdict enforced
    d = mk({ standable: true, holdout: "fresh", caged: true });
    check("FAFF-1116: captured true + fresh → resolveCanRun satisfied", resolveCanRun(d, ISSUE) === "satisfied");
    check("FAFF-1116: captured true + fresh + cage → strict (verdict enforced)", resolveHoldoutLeg(d, ISSUE).holdout_posture === "strict"); rm(d);
    // uncaptured fallback == live readCanRun, byte-identical
    d = mk({ standable: undefined, holdout: "fresh", caged: true });
    check("FAFF-1116: uncaptured fallback → resolveCanRun == live readCanRun (satisfied)", resolveCanRun(d, ISSUE) === readCanRun(d, ISSUE) && resolveCanRun(d, ISSUE) === "satisfied"); rm(d);
    // contradiction guard: captured false + fresh verdict → faulted → strict (fail-safe block)
    d = mk({ standable: false, holdout: "fresh", caged: true });
    check("FAFF-1116: contradiction false+fresh (caged) → resolveCanRun faulted", resolveCanRun(d, ISSUE) === "faulted");
    check("FAFF-1116: contradiction false+fresh (caged) → strict (fail-safe block)", resolveHoldoutLeg(d, ISSUE).holdout_posture === "strict"); rm(d);
    // caged==absent axis — the axis the posture proof depends on (resolveHoldoutPosture is fault-first)
    d = mk({ standable: false, holdout: "fresh", caged: false });
    check("FAFF-1116: caged==absent — contradiction false+fresh → strict (fault-first, no cage)", resolveHoldoutLeg(d, ISSUE).holdout_posture === "strict"); rm(d);
    d = mk({ standable: true, holdout: "fresh", caged: false });
    check("FAFF-1116: caged==absent — legitimate true+fresh → pass-through (no cage, unchanged vs live)", resolveHoldoutLeg(d, ISSUE).holdout_posture === "pass-through"); rm(d);
  })();

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (merge-gate pure cores, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { mergeGateSelftest };
