// ===========================================================================
// === region:factory — merge-gate-floor — FAFF-1391: the merge floor's inputs (committed anchor level, CI observation, merge record, integrity, AC, review, custody, holdout) ===
// ===========================================================================
// Split out of merge-gate.js (FAFF-1391), unchanged. The impure readers that populate decideFloor's
// inputs from the run-dir and an independent CI observation; the merge record writer.

const fs = require("node:fs");
const path = require("node:path");
const { resolveFaffVersion } = require("./faff-version"); // FAFF-1395
const { spawnSync } = require("node:child_process");
const { FLOOR_LEVELS, computeCustodyVerdictAdmission, computeLaneBoundary, computeReviewVerdict, holdoutGateResult, requiresSelfConsistencyStamp, resolveHoldoutPosture } = require("./contract-defs");
const { realFsq } = require("./container-check");
const { correctiveIntegrityDirs, correctiveIntegrityProbe, integrityGate, foldMergeFloorAuthority } = require("./corrective-integrity");
const { buildProgressPath } = require("./effects");
const { sha256: custodyHashBytes } = require("./integrity-digest");
const { classifyCiObservation } = require("./merge-gate-classify");
const { runGh, resolveRunnerIdentityMemoised, ghJson } = require("./merge-gate-gh");

// Impure git helper mirroring ghJson's shape: run `git <args>` in cwd.
function gitRun(cwd, args, timeout = 15000) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout });
  if (r.error) return { ok: false, stdout: "", stderr: String(r.error.message || ""), status: null };
  return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim(), status: r.status };
}

// FAFF-747: read the REAL HTTP status of the Contents-API anchor read via a headers-only `gh api -I`
// probe, instead of inferring the class from `gh`'s human-readable stderr (not a contract — wording
// drifts across gh versions, locales, and GitHub Enterprise). `gh` exits non-zero on any HTTP error
// but still writes the response status line to stdout under `-I`; capture stdout regardless of exit
// code and parse the FIRST `HTTP/<ver> <code> <reason>` line. Called ONLY from the existing `!api.ok`
// failure branch of resolveAnchorLevel — the mainline success read and the git-show path never call
// this. Returns the 3-digit numeric status, or null if no status line is present (network failure,
// `gh` missing, unexpected output) — the caller treats null as indeterminate and fails safe.
function anchorHttpStatus(repo, anchorPath, headSha) {
  const r = runGh(["api", "-I", `repos/${repo}/contents/${anchorPath}?ref=${headSha}`], { timeout: 60000 }); // FAFF-1213
  const out = String((r && r.stdout) || "");
  const m = out.match(/^HTTP\/[\d.]+\s+(\d{3})\b/m);
  return m ? Number(m[1]) : null;
}

// FAFF-690 (F1): resolve the governing autonomy level from the HEAD-SHA-PINNED committed anchor
// (`.faff/anchors/<basename(run-dir)>/<issue>/run-ledger.json`, byte-copied + committed + pushed at
// graft Step 9b), NOT from the live-writable run-ledger.json the build lane it polices can rewrite.
// The committed blob is git content-addressed and immutable at `headSha`; changing it forces a new
// head sha → a re-run of the required branch-protection-gated `governance-check` → a visible PR diff.
// So a live rewrite of run-ledger.json — even with a coordinated valid events-chain append — cannot
// move the level. PRIMARY read: local git object store (`git show`, covers the graft/checkout case
// where the pushed head sha's object is present). FALLBACK (PR path only, `repo` non-null): the
// Contents API `?ref=<headSha>` for a pure-remote invocation with no local object. `--local` passes
// `repo === null` and gets NO API fallback (there is no forge to consult). Returns { level, status,
// source }; status ∈ ok | anchor-missing (404/empty/no object) | anchor-malformed (bad JSON or a
// level outside FLOOR_LEVELS) | anchor-unreadable (403 / a narrow forge token lacking contents:read
// — distinct from -missing because the operator remedy differs). Fail-closed everywhere: the caller
// REFUSES (exit 2) on any non-ok status; it NEVER falls back to the live ledger for level.
function resolveAnchorLevel(cwd, repo, runDir, issue, headSha) {
  const anchorPath = `.faff/anchors/${path.basename(runDir)}/${issue}/run-ledger.json`;
  let parsed, source;
  const r = gitRun(cwd, ["show", `${headSha}:${anchorPath}`]);
  if (r.ok) {
    source = "git-show";
    try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
  } else if (repo) {
    // NB: do NOT use `--jq .content` here. `gh api --jq` runs jq in RAW-OUTPUT mode, so a top-level
    // scalar STRING (`.content` is a base64 string) prints WITHOUT enclosing JSON quotes — and with
    // embedded newlines — which ghJson's unconditional JSON.parse then rejects (→ ok:false), silently
    // collapsing every correctly-anchored pure-remote PR to anchor-missing. Fetch the FULL contents
    // object and extract `.content` in JS.
    const api = ghJson(["api", `repos/${repo}/contents/${anchorPath}?ref=${headSha}`]);
    if (!api.ok) {
      // FAFF-747: distinguish HTTP 403 (read DENIED — a narrow token) from 404 / not-found (genuinely
      // absent) by the REAL HTTP status, read via a headers-only `gh api -I` probe — never by matching
      // `gh`'s stderr text, which is not a contract and drifts across gh versions/locales/GHE. Both
      // classes still fail closed (refuse, exit 2); only the reported status/remedy differs. Fail-safe:
      // any status other than a clear 403 — including 404, any other code, or an unparseable/absent
      // status line — maps to the generic anchor-missing; never over-claim a token-scope problem.
      const httpStatus = anchorHttpStatus(repo, anchorPath, headSha);
      if (httpStatus === 403) {
        return { level: null, status: "anchor-unreadable", source: "contents-api" };
      }
      return { level: null, status: "anchor-missing", source: null };
    }
    source = "contents-api";
    // A file response carries a base64 `content` field; a directory response is an array (no `content`),
    // and an OK-but-contentless body → anchor-missing (fail-closed, never a silent pass).
    const b64 = api.data && typeof api.data.content === "string" ? api.data.content : null;
    if (b64 === null) return { level: null, status: "anchor-missing", source: null };
    try { parsed = JSON.parse(Buffer.from(b64.replace(/\n/g, ""), "base64").toString("utf8")); }
    catch { parsed = null; }
  } else {
    // --local: local object store only, no forge to fall back to → git-show failure is terminal.
    return { level: null, status: "anchor-missing", source: null };
  }
  if (!parsed || typeof parsed !== "object") return { level: null, status: "anchor-malformed", source };
  if (!FLOOR_LEVELS.includes(parsed.level)) return { level: null, status: "anchor-malformed", source };
  return { level: parsed.level, status: "ok", source };
}

// FAFF-690 (F1): the fail-closed refusal message when no trusted committed anchor level resolves.
// The remedy differs by status: anchor-unreadable is a token-scope problem on the pure-remote path;
// everything else is a re-anchor (re-run graft Step 9b) or a merge-at-the-forge remedy. NEVER a
// live-ledger fallback — that is the exact hole F1 closes.
function anchorRefusal(runDir, issue, headSha, status) {
  const remedy = status === "anchor-unreadable"
    ? "the forge token cannot read .faff/anchors/…/run-ledger.json — grant classic-PAT repo (or public_repo for a public repo) or fine-grained-PAT/GitHub-App contents:read, or invoke from a checkout with the head-sha object"
    : "re-anchor (graft Step 9b) so the PR carries .faff/anchors/…/run-ledger.json, or merge at the forge";
  return `faff merge-gate: no trusted committed anchor level for run ${path.basename(runDir)} issue ${issue} at head ${headSha} (${status}) — ${remedy}\n`;
}

// FAFF-690 (F3): an already-MERGED PR re-derives the RETROSPECTIVE run-substrate floor (AC + review +
// at-L4 holdout + integrity) from the SAME persisted artifacts + the SAME readers merge-gate itself
// uses (no forked rule, and — critically — no `require("./governance-check")`, which would cycle:
// governance-check.js already requires this module). Live CI is deliberately NOT re-observed: it is
// unobservable on a merged PR, and the forge's branch protection already required CI-green to permit
// the merge (a documented limitation: on a repo with NO branch protection the forge did not gate CI
// at merge time, so this leg cannot assume CI was green — it still enforces AC/review/holdout/
// integrity). The skip is made OBSERVABLY DISTINCT from a stale-CI bug via the display-only sentinel
// `ci_state:"not-observed-already-merged"` (NEVER fed to decideFloor). Success evidence
// (merge-record.json) is written ONLY when the retrospective floor passes; a failing floor returns
// refuse (exit 1) with the failing legs and writes NOTHING. It never spawns `gh pr merge`.
function alreadyMergedReconcile(emit, runDir, issue, pr, headSha, level, integrity) {
  const reasons = [];
  if (!readAcComplete(runDir, issue)) reasons.push("ACs not all verified");
  const rv = readReviewVerdict(runDir, issue);
  if (rv !== "pass") reasons.push(`review verdict is ${rv}`);
  // FAFF-1040: the retrospective floor re-derives the SAME posture-based holdout leg as the live floor
  // (resolveHoldoutLeg), never a divergent `level === "L4"` test — otherwise an already-merged no-SUT
  // run that the live floor passed through would be refused retrospectively (no success evidence).
  const holdoutLeg = resolveHoldoutLeg(runDir, issue);
  if (holdoutLeg.holdout_posture === "strict" && holdoutLeg.holdout !== "meets-spec") reasons.push(`holdout guarantee (strict): ${holdoutLeg.holdout}`);
  if (integrity.state === "violated") reasons.push("corrective-artifact integrity violated");
  if (integrity.state === "unasserted-refuse") reasons.push(`corrective-artifact integrity unasserted at ${level}`);
  if (reasons.length === 0) {
    writeMergeRecord(runDir, issue, pr, headSha, integrity.display);
    return emit({ verdict: "merge-ok", merged: true, blockers: [], ci_state: "not-observed-already-merged", head_sha: headSha, integrity: integrity.display, note: "already merged" }, 0);
  }
  return emit({ verdict: "refuse", merged: true, blockers: reasons, ci_state: "not-observed-already-merged", head_sha: headSha, integrity: integrity.display, note: "already merged but merge-floor not satisfied — no success evidence written" }, 1);
}

// Observe CI for the head sha authoritatively (head-sha check-runs + legacy status). A zero head-sha
// set is disambiguated: if `gh pr checks` shows ANY checks they belong to an earlier commit → stale
// green (head_sha_matches:false → refuse); otherwise genuine no-ci-coverage. gh outage → indeterminate.
function observeCi(repo, pr, headSha) {
  const cr = ghJson(["api", `repos/${repo}/commits/${headSha}/check-runs`, "--jq", "[.check_runs[] | {status, conclusion}]"]);
  const stt = ghJson(["api", `repos/${repo}/commits/${headSha}/status`, "--jq", "{state: .state, count: (.statuses | length)}"]);
  // Trust judgement first (FAFF-376): loss of the PRIMARY check-runs signal → indeterminate regardless
  // of the legacy status. The old `!cr.ok && !stt.ok` early return is subsumed by this (its both-down
  // detail string is preserved). Only when the primary was readable do we proceed to head-state handling.
  // A zero-exit gh call whose payload is NOT the expected array means the primary responded but is
  // unreadable (malformed/shape-changed) — treat that as check-runs-unavailable (→ indeterminate), never
  // as an empty green set, so a malformed primary can never fail open into no-ci-coverage.
  const checkRunsOk = cr.ok && Array.isArray(cr.data);
  const cls = classifyCiObservation(
    checkRunsOk, checkRunsOk ? cr.data : [],
    stt.ok, stt.ok && stt.data ? stt.data.state : null,
    stt.ok && stt.data ? stt.data.count : 0,
  );
  if (cls.api_degraded_reason) return { ci_state: "indeterminate", head_sha_matches: true, detail: cls.api_degraded_reason };
  const headState = cls.ci_state;
  if (headState !== "no-ci-coverage") return { ci_state: headState, head_sha_matches: true, detail: `head-sha checks: ${headState}` };
  // Head sha carries zero checks — stale-green or genuine no-CI?
  const prc = ghJson(["pr", "checks", String(pr), "--json", "state"]);
  const anyPr = prc.ok && Array.isArray(prc.data) && prc.data.length > 0;
  if (anyPr) return { ci_state: "ci-green", head_sha_matches: false, detail: "checks exist but none on the current head sha (stale green)" };
  return { ci_state: "no-ci-coverage", head_sha_matches: true, detail: "no checks on head sha and none on the PR" };
}

// FAFF-397: the per-issue merge-record path — the additive floor artifact `faff reconcile`
// re-reads at run-end to confront a ledger `shipped` claim with the ACTUAL merged head sha.
// Mirrors ac-checklist.json/review-verdict.json's <run-dir>/<issue>/<file> convention exactly.
function mergeRecordPath(runDir, issue) {
  return path.join(runDir, issue, "merge-record.json");
}

// Write the merge record on every merge-ok path (idempotent already-merged, the normal
// successful merge, and the FAFF-365 post-merge-success re-read) — the sha it already resolved
// for --match-head-commit, so no second observation. Best-effort: a write failure is surfaced
// but never un-does an already-landed merge (the merge itself is the load-bearing event; a
// missing record just means `faff reconcile` will (correctly) flag this issue as unproven at
// run-end, fail-closed — never silently drop the merge).
// `integrity` (FAFF-325, optional): the corrective-integrity annotation ("asserted" |
// "unasserted" | "violated") — ALWAYS supplied by cmdMergeGate on every call site, so the merge
// record carries the attestation basis it was decided under, never silently omitted.
// FAFF-703: additively stamps `harness` + `model` from the single `faff harness identify`
// resolver (harness.js) — never re-derived here. `identity` is injectable (tests only); the real
// call path always resolves it fresh via the lazy require below (avoids a load-time cycle, same
// convention as harness.js's own lazy `require("./config")`). A resolution fault degrades to
// omitting both fields (mirrors the prep-marker's owner-omit-when-unset rule) rather than
// blocking the merge-record write the rest of `faff merge-gate` depends on.
// FAFF-1395: also stamps `faff_version` (the plugin release) beside harness/model. `faffVersion` is
// injectable (tests only); the real call path resolves it via the single faff-version resolver, and an
// unresolved version is written as "unknown", never omitted.
function writeMergeRecord(runDir, issue, pr, headSha, integrity, identity, githubActor, faffVersion) {
  try {
    const dir = path.join(runDir, issue);
    fs.mkdirSync(dir, { recursive: true });
    const record = { pr: Number(pr), head_sha: headSha, merged: true, merged_at: new Date().toISOString(), integrity: integrity || "unasserted" };
    let id = identity;
    if (id === undefined) {
      try { id = require("./harness").harnessIdentify(); } catch { id = null; }
    }
    if (id && id.harness) { record.harness = id.harness; record.model = id.model; }
    record.faff_version = faffVersion === undefined ? resolveFaffVersion().version : faffVersion;
    // FAFF-1213: record the acting GitHub identity as a NON-authoritative convenience copy
    // — login + credential_source only, NEVER the token. Resolved internally (lazy, like the
    // harness identity above) unless injected (tests). A resolution fault omits the field.
    let actor = githubActor;
    if (actor === undefined) {
      const ev = resolveRunnerIdentityMemoised(); // resolved once per process (no per-write gh probe)
      actor = ev ? { login: ev.github_login, source: ev.credential_source } : null;
    }
    if (actor) record.github_actor = { login: actor.login ?? null, source: actor.source };
    // FAFF-1213: route the WHOLE record through the known-secret redaction core before the
    // write, so the token cannot reach the merge record even via a future token-bearing field
    // (the {login, source}-only construction above is the first line of defence). A config-read
    // fault degrades to an empty secret set rather than failing the merge-record write.
    const { redactKnownSecrets, resolveKnownSecretValues } = require("./redact");
    let secretValues = [];
    try { secretValues = resolveKnownSecretValues(); } catch { secretValues = []; }
    const safe = redactKnownSecrets(record, secretValues);
    fs.writeFileSync(mergeRecordPath(runDir, issue), JSON.stringify(safe, null, 2) + "\n");
  } catch (e) {
    process.stderr.write(`faff merge-gate: warning — could not write merge-record.json: ${e.message}\n`);
  }
}

// FAFF-325: derive the corrective-integrity annotation for THIS merge decision.
//   probe    := correctiveIntegrityProbe(process.env, realFsq(), correctiveIntegrityDirs(runDir, issue))
//   gate     := integrityGate(probe, "merge-floor")  — trusted | refuse (violation) | unasserted
// The L4 defence-in-depth branch (unasserted -> refuse) is keyed on `level` — the SAME
// ledger-reconciled value the holdout leg already uses (resolveGateLevel's mismatch check, above
// in cmdMergeGate, already fail-LOUDS — exit 2 — the instant an explicit --level disagrees with
// run-ledger.json's level; it is never silently resolved in the ledger's favour). Re-deriving a
// SEPARATE, flag-only level source for this one leg would not close any gap the mismatch check
// doesn't already close when a level IS asserted at invocation, and would REGRESS a genuine L4
// run whose caller (legitimately) leans on the ledger-resolved level without repeating --level —
// so this leg rides the same reconciled `level`, exactly like holdout.
// Returns { state, display } — `state` (4-valued) is what decideFloor's blocker logic keys on;
// `display` (asserted|custody-trusted|unasserted|violated — FAFF-892 added custody-trusted) is what the merge record / banner annotate.
// FAFF-892: `digestVerify` (optional) is the merge-floor digest verify union the caller
// constructs via buildMergeFloorDigestVerify (below). Absent (no --custody-verdict flags) ⇒
// the fold reaches branch 6 (unasserted) ⇒ the level-branch yields today's L4 unasserted-refuse
// exactly — byte-for-byte no regression for runs where no digest bracket ran.
// FAFF-1072: `cfg` (the merged .faffrc document) is threaded in so branch-6 can resolve the
// UNATTENDED fact from the tamper-resistant committed anchor `level` PLUS live config. Interactive
// runs (L1/L2) are attended by construction (a human drives the graft), so a repo-wide unattended
// declaration never makes them unattended — only an automated run does (L4 always; L3 iff declared).
// Absent cfg (the config-less selftest call sites, or any legacy caller) ⇒ declaredUnattendedFromConfig
// is false, so an L4 run still resolves unattended via the level disjunct and below-L4 stays attended.
function resolveIntegrity(runDir, issue, level, digestVerify, cfg) {
  const dirs = correctiveIntegrityDirs(runDir, issue);
  const probe = correctiveIntegrityProbe(process.env, realFsq(), dirs);
  const mountGate = integrityGate(probe, "merge-floor"); // UNCHANGED — classifies the mount probe
  // Compose the mount gate with the caller-constructed digest verify at a NEW fold, never
  // inline in integrityGate (ADR-0114). A genuine mount violation refuses ABOVE the digest
  // consult, so a clean digest can never rescue a forged/malformed/dir-mismatched declaration.
  const fold = foldMergeFloorAuthority(mountGate, digestVerify);
  let state;
  if (fold.disposition === "trusted") state = "asserted";
  else if (fold.disposition === "refuse") state = "violated";
  else if (fold.disposition === "custody-trusted") state = "custody-trusted"; // the digest-verified grant (non-blocking)
  else {
    // fold.disposition === "unasserted" (no custody declaration). FAFF-1072: branch-6 keys on the
    // run FACTS, not the L4 label — block (require a self-consistency stamp) exactly where the
    // stamp fires: an UNATTENDED run merging in-session with NO dispatch cut above it to provide
    // detective custody. `level` is the reconciled committed anchor level (tamper-resistant); the
    // config disjunct (the ADR-0103 mix) applies only to the automated L3 level, so an interactive
    // L1/L2 merge is never unattended even in a repo that declares unattended. An indeterminate
    // dispatch-state is refused upstream by evaluateCustody, so requiresSelfConsistencyStamp's
    // `=== "absent"` is the only case reachable here that blocks.
    const { declaredUnattendedFromConfig } = require("./sentry"); // lazy — matches the file convention, avoids a load-time cycle
    const unattended = level === "L4" || (level === "L3" && declaredUnattendedFromConfig(cfg));
    const dispatchState = laneBoundaryDispatchState(runDir);
    state = requiresSelfConsistencyStamp(unattended, dispatchState) ? "unasserted-refuse" : "unasserted-ok";
  }
  const display =
    state === "asserted" ? "asserted"
    : state === "violated" ? "violated"
    : state === "custody-trusted" ? "custody-trusted"
    : "unasserted";
  return { state, display, basis: fold.basis };
}

// FAFF-892: construct the merge-floor digest verify union the integrity leg reads, reusing the
// EXISTING admission gate (computeCustodyVerdictAdmission + custodyHashBytes) — never a second
// implementation, never a bare writable-path read. Distinct from evaluateCustody (which gates on
// a structural dispatch cut); this leg admits the per-issue custody verdict FAFF-893 produces on
// the interactive/local path. Uncertainty fails toward refuse: any non-clean/non-tamper admission
// failure routes to the `error` arm, which the fold refuses on (branch 3).
function buildMergeFloorDigestVerify(runDir, issue, custodyPathArg, custodyShaArg) {
  if (!custodyPathArg || !custodyShaArg) return { held: false }; // no bracket ran ⇒ fold branch 6 ⇒ today's behaviour
  const canonical = path.join(runDir, issue, "custody-verdict.json");
  if (path.resolve(custodyPathArg) !== path.resolve(canonical)) {
    return { held: true, error: `custody verdict path is not canonical (expected ${canonical})` };
  }
  let raw;
  try { raw = fs.readFileSync(canonical, "utf8"); } catch { raw = null; }
  let actualSha256 = null;
  if (raw !== null) {
    try { actualSha256 = custodyHashBytes(Buffer.from(raw, "utf8")); } catch { actualSha256 = null; }
  }
  const admission = computeCustodyVerdictAdmission({
    raw, actualSha256, expectedSha256: custodyShaArg,
    expectedRunId: path.basename(runDir), expectedIssue: issue,
  });
  if (admission.admitted) return { held: true, diffs: [] }; // clean ⇒ fold branch 4 grant
  if (admission.classification === "tamper") return { held: true, diffs: ["corrective-integrity forge surface"] }; // proven forge ⇒ branch 5
  return { held: true, error: admission.reason }; // uncomputable / mismatch / malformed / absent ⇒ branch 3 refuse
}

// Read the AC-checklist artifact graft persists at <run-dir>/<ISSUE>/ac-checklist.json.
// Missing/unreadable/malformed → false (fail-closed: an unverifiable AC leg never passes).
// FAFF-1147: schema-2 enriches the artifact with an OPTIONAL per-criterion `criteria` array
// ([{ ac, verified, passed }]). When present, cross-check it against the aggregate — the leg
// grants only when the aggregate is true AND every listed criterion passed, so `all_verified`
// is auditable rather than merely asserted. Schema-1 files (no `criteria` key) keep the
// aggregate authoritative, unchanged. The cross-check can only ever tighten the gate
// (fail-closed): an inconsistent schema-2 file (all_verified=true but a criterion passed=false)
// now fails, and a non-array/empty `criteria` fails too.
function readAcComplete(runDir, issue) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(runDir, issue, "ac-checklist.json"), "utf8")); }
  catch { return false; }                                                // fail-closed
  if (!j || typeof j !== "object") return false;
  const aggregate = j.all_verified === true || j.ac_complete === true;   // schema-1 signal, unchanged
  if (!("criteria" in j)) return aggregate;                              // schema-1 path
  if (!Array.isArray(j.criteria)) return false;                          // malformed → fail-closed
  const everyPassed = j.criteria.length > 0 && j.criteria.every((c) => c && c.passed === true);
  return aggregate && everyPassed;                                       // cross-check
}

// Read + RE-VALIDATE the review-verdict block graft persists at <run-dir>/<ISSUE>/review-verdict.json
// through the SAME computeReviewVerdict rule (never a forked check). Missing/unreadable/fail-loud →
// "missing" (fail-closed). A conformant block yields its own signal (pass|fail|needs-human|unavailable —
// FAFF-405; decideFloor's `!== "pass"` check already blocks the new value with no change here).
function readReviewVerdict(runDir, issue) {
  let block;
  try { block = JSON.parse(fs.readFileSync(path.join(runDir, issue, "review-verdict.json"), "utf8")); }
  catch { return "missing"; }
  const { contractData, failLoud } = computeReviewVerdict(block);
  if (failLoud || !contractData) return "missing";
  return contractData.signal;
}

// FAFF-420: pure freshness check — the holdout verdict must STRICTLY postdate the build-complete
// checkpoint it's being read for, so a verdict produced before this build (stale, or left over from a
// prior build of the same issue) can never satisfy the gate. Both timestamps must be finite; a
// non-finite either side is never "fresh" (fail-closed, mirrors the mtime-floor precedent in prepIsHeld).
function holdoutIsFresh(holdoutMtimeMs, checkpointTimeMs) {
  return Number.isFinite(holdoutMtimeMs) && Number.isFinite(checkpointTimeMs) && holdoutMtimeMs > checkpointTimeMs;
}

// FAFF-420: read the per-issue holdout verdict RUN-DIR-RELATIVE (never CWD-relative — the CWD-relative
// default was the bug: a stale or foreign verdict sitting in the working directory could vacuously
// satisfy the gate). Mirrors readAcComplete/readReviewVerdict's convention exactly: the artifact lives
// at <run-dir>/<issue>/holdout.json, so a verdict from a different run is structurally unreadable here.
// On top of the structural binding, the verdict must be FRESH — its mtime must postdate the
// build-complete checkpoint (<run-dir>/<issue>/build-progress.json) — so a same-run-dir but
// pre-this-build verdict is refused too. Reduces through the SAME holdoutGateResult gate (never forked).
// pass → meets-spec; a "missing" block or an absent/foreign holdout file → missing; anything else
// (including unprovable/failed freshness) → blocked.
// FAFF-384: resolve the run's cage promise from its lane-boundary intent artifact (<run-dir>/lane-boundary.json,
// the orchestrator-held, rung-1-integrity-covered run dir). The promise ARMS the spawner-attestation ratchet in
// readHoldout below — the merge-floor's physical enforcement of "the evaluator was code-blind by construction".
// Fail-SAFE toward the strong direction the spec fixes ("a malformed promise never relaxes to legacy"):
//   - absent file (ENOENT) → promise ABSENT → ratchet OFF → byte-for-byte legacy (uncaged runs unaffected).
//   - present + valid + cage-shaped (lane evaluator, container own, accesses.repo absent) → ratchet ON.
//   - present + valid but NON-cage (e.g. container shared / repo present — a legitimate rung-0 declaration) → OFF.
//   - present + malformed/unreadable → ratchet ON (a present-but-broken promise never relaxes to self-attestation).
// PURE beyond the single-file read; never throws.
function laneBoundaryPromisesCage(runDir) {
  if (!runDir) return false;
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, "lane-boundary.json"), "utf8"); }
  catch (e) { return e.code === "ENOENT" ? false : true; } // absent → legacy; unreadable → present-but-broken → arm
  let intent;
  try { intent = JSON.parse(raw); } catch { return true; } // present-but-malformed → arm (never relax)
  const { contractData, failLoud } = computeLaneBoundary(intent);
  if (failLoud || !contractData) return true; // structurally malformed present intent → arm
  if (contractData.violations.length > 0) return true; // a present, invalid promise → arm
  return contractData.lane === "evaluator" && contractData.container === "own" && contractData.accesses.repo === "absent";
}

// FAFF-784: derive whether THIS merge is under a dispatch cut from the SAME canonical
// lane-boundary.json parser as laneBoundaryPromisesCage above — never a caller flag, never a
// possibly-suspect run-ledger.json field (a ledger flag is exactly what a compromised same-uid lane
// could set). "dispatched" ⇔ a present, structurally-valid lane-boundary.json (any lane value —
// its mere validated presence is the structural declaration the spec's reference table names, not
// specifically the evaluator-cage promise laneBoundaryPromisesCage keys its OWN narrower question
// on). Absent (ENOENT) ⇒ "absent" — no dispatch cut, existing (interactive / no-dispatch-cut)
// behaviour is untouched. Unreadable / unparseable / structurally malformed / any declared
// violation ⇒ "indeterminate" — a present-but-broken declaration NEVER relaxes to "no cut" (that
// would be the exact bypass the spec closes); the caller refuses unconditionally on indeterminate,
// regardless of what custody flags were passed. PURE beyond the single-file read; never throws.
function laneBoundaryDispatchState(runDir) {
  if (!runDir) return "absent";
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, "lane-boundary.json"), "utf8"); }
  catch (e) { return e.code === "ENOENT" ? "absent" : "indeterminate"; }
  let intent;
  try { intent = JSON.parse(raw); } catch { return "indeterminate"; }
  const { contractData, failLoud } = computeLaneBoundary(intent);
  if (failLoud || !contractData) return "indeterminate";
  if (contractData.violations.length > 0) return "indeterminate";
  return "dispatched";
}

// FAFF-784: the custody gate — { required, ok, reason? }. `required:false` ⇒ no dispatch cut (or no
// runDir), existing behaviour applies untouched. `required:true` binds admission to the EXACT
// recorded verdict: the canonical path (derived here, never trusted blindly off the caller's
// argument — a caller cannot point custody at an arbitrary file), the retained digest (compared
// against the on-disk bytes hashed via integrity-digest.js's ONE hasher — never a second
// implementation), and run/issue identity. Every failure mode (indeterminate dispatch state, missing
// flags, non-canonical path, unreadable/malformed/digest-mismatched/identity-mismatched/non-clean
// verdict) refuses — there is no caller-controlled opt-out for a structurally-detected dispatched
// merge. Never throws: an unreadable file or a hasher fault degrades to a refused admission, not an
// exception (fail-closed, not fail-crashed).
function evaluateCustody(runDir, issue, custodyPathArg, custodyShaArg) {
  const dispatchState = laneBoundaryDispatchState(runDir);
  if (dispatchState === "absent") return { required: false, ok: true };
  if (dispatchState === "indeterminate") {
    return { required: true, ok: false, reason: "lane-boundary.json is present but malformed/indeterminate — cannot establish dispatch context; refusing the custody-required merge" };
  }
  // dispatched: custody is mandatory, no caller opt-out.
  if (!custodyPathArg || !custodyShaArg) {
    return { required: true, ok: false, reason: "dispatched merge: --custody-verdict and --custody-verdict-sha256 are required (structurally detected dispatch cut — no caller opt-out)" };
  }
  const canonical = path.join(runDir, issue, "custody-verdict.json");
  if (path.resolve(custodyPathArg) !== path.resolve(canonical)) {
    return { required: true, ok: false, reason: `custody verdict path is not canonical (expected ${canonical})` };
  }
  let raw;
  try { raw = fs.readFileSync(canonical, "utf8"); } catch { raw = null; }
  let actualSha256 = null;
  if (raw !== null) {
    try { actualSha256 = custodyHashBytes(Buffer.from(raw, "utf8")); } catch { actualSha256 = null; }
  }
  const admission = computeCustodyVerdictAdmission({
    raw, actualSha256, expectedSha256: custodyShaArg,
    expectedRunId: path.basename(runDir), expectedIssue: issue,
  });
  if (!admission.admitted) return { required: true, ok: false, reason: admission.reason };
  return { required: true, ok: true };
}

function readHoldout(runDir, issue) {
  if (!runDir) return "missing"; // no run to bind to => fail-closed, never fall back to CWD-relative
  const holdoutPath = path.join(runDir, issue, "holdout.json");
  let block, holdoutMtimeMs;
  try {
    block = JSON.parse(fs.readFileSync(holdoutPath, "utf8"));
    holdoutMtimeMs = fs.statSync(holdoutPath).mtimeMs;
  } catch (e) { return "missing"; } // absent/unreadable/malformed/foreign => missing (existing posture)

  let checkpointTimeMs = NaN;
  try {
    const checkpoint = JSON.parse(fs.readFileSync(buildProgressPath(runDir, issue), "utf8"));
    checkpointTimeMs = Date.parse(checkpoint.updated_at ?? checkpoint.build?.pushed_at);
  } catch (e) { /* leave checkpointTimeMs NaN => not fresh below */ }
  if (!holdoutIsFresh(holdoutMtimeMs, checkpointTimeMs)) return "blocked"; // stale, or freshness unprovable => refuse (never "missing")

  // FAFF-384: arm the spawner-attestation ratchet iff THIS run promised the evaluator cage. Absent a promise
  // (the overwhelmingly common non-L4-cage path) the gate is byte-for-byte today's holdoutGateResult.
  const requireSpawnerAttested = laneBoundaryPromisesCage(runDir);
  const res = holdoutGateResult(block, { requireSpawnerAttested });
  if (res.gate === "pass") return "meets-spec";
  return res.reason === "missing" ? "missing" : "blocked";
}

// FAFF-1040: the "can-run" capability read for the holdout guarantee, THREE-way (satisfied/absent/
// faulted). The code-blind holdout verdict is the only merge-time on-disk evidence that a
// system-under-test was stood up and judged: the env-handle is an upstream in-band contract block,
// NEVER a run-dir artifact (Assumption 3 validated at build time — it is not reachable at the floor),
// and the full spec's holdout criteria are stripped from the committed builder view, so dodClassify
// is not runnable here either. So this reads the SAME <run-dir>/<issue>/holdout.json readHoldout
// consults and classifies the READ, not the verdict:
//   - absent (ENOENT) → no verdict was produced: holdout genuinely could not run (no standable SUT —
//     faff's own tickets, or a non-born-verifiable spec). The legitimate can't-run case → pass-through.
//   - faulted → present but unreadable/malformed, or present-but-STALE (freshness unprovable against
//     the build-complete checkpoint). A plumbing/tamper fault — fail SAFE (strict when unattended),
//     never a silent pass-through; this preserves today's L4 fail-closed posture for the broken case.
//   - satisfied → a fresh, readable verdict exists; the meets-spec/blocked check is left to readHoldout,
//     consulted by the caller once the posture resolves non-pass-through.
// PURE beyond the file reads; never throws.
function readCanRun(runDir, issue) {
  if (!runDir) return "absent"; // no run to bind to — nothing stood up
  const holdoutPath = path.join(runDir, issue, "holdout.json");
  let holdoutMtimeMs;
  try {
    JSON.parse(fs.readFileSync(holdoutPath, "utf8")); // readability + parseability
    holdoutMtimeMs = fs.statSync(holdoutPath).mtimeMs;
  } catch (e) {
    return e.code === "ENOENT" ? "absent" : "faulted"; // ENOENT → absent; unreadable/malformed → faulted
  }
  let checkpointTimeMs = NaN;
  try {
    const checkpoint = JSON.parse(fs.readFileSync(buildProgressPath(runDir, issue), "utf8"));
    checkpointTimeMs = Date.parse(checkpoint.updated_at ?? checkpoint.build?.pushed_at);
  } catch (e) { /* NaN → not fresh below */ }
  if (!holdoutIsFresh(holdoutMtimeMs, checkpointTimeMs)) return "faulted"; // stale/unprovable → fail safe
  return "satisfied";
}

// FAFF-1040: the "caged" capability read, THREE-way. Reuses the SAME lane-boundary.json parse as
// laneBoundaryPromisesCage, but SPLITS the "present-but-broken" case out as `faulted` (fail safe to
// strict) instead of folding it into the arm-the-ratchet true. absent (ENOENT, or a valid non-cage
// boundary — no cage promised) → pass-through; faulted (unreadable/malformed/invalid) → strict;
// satisfied (a valid evaluator-cage promise) → the cage capability holds. PURE beyond the read.
function readCaged(runDir) {
  if (!runDir) return "absent";
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, "lane-boundary.json"), "utf8"); }
  catch (e) { return e.code === "ENOENT" ? "absent" : "faulted"; }
  let intent;
  try { intent = JSON.parse(raw); } catch { return "faulted"; }
  const { contractData, failLoud } = computeLaneBoundary(intent);
  if (failLoud || !contractData) return "faulted";
  if (contractData.violations.length > 0) return "faulted";
  return (contractData.lane === "evaluator" && contractData.container === "own" && contractData.accesses.repo === "absent") ? "satisfied" : "absent";
}

// FAFF-1116: the captured standability fact, read LIVE from <run-dir>/run-ledger.json (NOT the anchor —
// sut_env_stood is not known until Step 10, after the Step-9b anchor is frozen, so it cannot be anchored;
// FAFF-690 reads `level` from the anchor precisely because the live ledger is build-lane-writable, and this
// read does NOT rely on write-isolation — its safety lives in resolveCanRun's contradiction guard + the
// pre-existing absent-verdict dominance). capabilities[issue].sut_env_stood is the boolean the trusted side
// writes at env-stand time. Returns true/false, or undefined (UNKNOWN) when the field, ledger, or file is
// absent/unreadable/malformed — the fail-safe fallback signal. PURE beyond the read; never throws.
function readLedgerSutEnvStood(runDir, issue) {
  if (!runDir) return undefined;
  try {
    const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
    const cap = ledger && ledger.capabilities && ledger.capabilities[issue];
    const v = cap ? cap.sut_env_stood : undefined;
    return typeof v === "boolean" ? v : undefined;
  } catch (e) { return undefined; }
}

// FAFF-1116: the standability arm of the can-run capability, redirected to the captured fact with a
// live-read fallback. The captured sut_env_stood replaces ONLY the "could a SUT stand?" inference; the
// verdict's own freshness/readability still comes from the live readCanRun. Posture-preserving:
//   - UNKNOWN (uncaptured / older run / unreadable) → the live readCanRun, byte-identical to today.
//   - false (stand failed) → absent when the live read is absent (the crux: a stand failure passes
//     through today), else faulted (a fresh verdict alongside a false is a contradiction → fail safe).
//   - true (stood) → defer to the live readCanRun (true+fresh→satisfied; true+stale→faulted; true+ENOENT
//     →absent, the stood-but-verdict-missing hole preserved).
// Same "satisfied"|"absent"|"faulted" domain as readCanRun, so resolveHoldoutPosture consumes it unchanged
// and governance-check's evaluateMergeFloorLeg inherits the redirect. PURE beyond the reads; never throws.
function resolveCanRun(runDir, issue) {
  const standable = readLedgerSutEnvStood(runDir, issue);
  if (standable === undefined) return readCanRun(runDir, issue); // fallback — exact live behaviour
  if (standable === false) return readCanRun(runDir, issue) === "absent" ? "absent" : "faulted";
  return readCanRun(runDir, issue); // standable === true → defer freshness/readability to the live read
}

// FAFF-1040: the impure holdout leg the merge floor folds — reads the two three-way CAPABILITY facts
// (can_run via FAFF-1116's resolveCanRun: the captured sut_env_stood fact with a live-read fallback; caged
// live from lane-boundary.json), resolves the posture through the PURE resolveHoldoutPosture, and reads the
// actual verdict only when the posture is not pass-through. Capability-driven and level-agnostic: a present,
// fresh, caged verdict is enforced at any level; nothing else is consulted. Returns the four floor fields
// (holdout + posture + the labelled missing/fault lists surfaced on the merge record).
function resolveHoldoutLeg(runDir, issue) {
  const caps = { can_run: resolveCanRun(runDir, issue), caged: readCaged(runDir) };
  const { posture, missing, fault } = resolveHoldoutPosture(caps);
  const holdout = posture === "pass-through" ? "not-applicable" : readHoldout(runDir, issue);
  return { holdout, holdout_posture: posture, holdout_missing: missing, holdout_fault: fault };
}

module.exports = { gitRun, anchorHttpStatus, resolveAnchorLevel, anchorRefusal, alreadyMergedReconcile, observeCi, mergeRecordPath, writeMergeRecord, resolveIntegrity, buildMergeFloorDigestVerify, readAcComplete, readReviewVerdict, holdoutIsFresh, laneBoundaryPromisesCage, laneBoundaryDispatchState, evaluateCustody, readHoldout, readCanRun, readCaged, readLedgerSutEnvStood, resolveCanRun, resolveHoldoutLeg };
