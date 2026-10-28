// ===========================================================================
// === region:factory — land — FAFF-1396: graft's bounded landing loop as a command. ===
// `faff land` drives an open PR toward mergeable and returns one typed token for the skill to
// route. It observes CI with merge-gate's own observeCi (so `ready` can never disagree with the
// merge floor), runs `faff ci-triage` unchanged, re-runs a failed check within the flaky budget,
// and updates a BEHIND branch. It never merges, parks, drafts a PR, writes to the tracker, or edits
// code: `ready` hands back to the skill's merge handoff, and `needs-fix` / `needs-judgement` hand
// back to the agent. The 25-minute landing deadline and the re-run budget persist in
// <run-dir>/<issue>/landing-loop.json, so one call can stop under the tool cap (`pending`, exit 3)
// and the next call resumes the same loop.
// ===========================================================================
const fs = require("fs");
const path = require("path");
const { parseArgs, usageError } = require("./argv");
const { runGh, ghJson, ghRepoSlug } = require("./merge-gate-gh");
const { observeCi, readReviewVerdict } = require("./merge-gate-floor");
const { runCiTriage, writeCiTriageVerdict } = require("./ci-triage");
const { cmdHeartbeat } = require("./heartbeat");

const DEADLINE_MS = 25 * 60 * 1000;
const DEFAULT_SLICE_SECS = 480; // one call stays under the 10-minute tool cap
const POLL_MS = 15 * 1000;
const RERUNS_PER_SHA = 1;
const RERUNS_TOTAL = 2;
// A head that shows zero checks just after a push may simply not have queued them yet, so
// no-ci-coverage is only reported once it has held on the same head for this long.
const NO_CI_SETTLE_MS = 60 * 1000;
// After a re-run is requested, a red reading is the OLD attempt until the check is seen running
// again. If it is never seen running within this window, the red reading stands.
const RERUN_SETTLE_MS = 2 * 60 * 1000;

const LAND_SPEC = {
  flags: {
    "--pr": { arity: 1 }, "--issue": { arity: 1 }, "--run-dir": { arity: 1 },
    "--slice-secs": { arity: 1 }, "--fault-domain": { arity: 1 },
    "--dry-run": { arity: 0 }, "--json": { arity: 0 }, "--selftest": { arity: 0 },
  },
};
const LAND_USAGE = "usage: faff land --pr N --issue ID --run-dir DIR [--slice-secs N] [--fault-domain code|infra] [--dry-run] [--json]";

// ---------------------------------------------------------------------------
// Pure core.
// ---------------------------------------------------------------------------
function initialState(pr, nowMs) {
  return { schema: 1, pr: Number(pr), started_at: new Date(nowMs).toISOString(), reruns_by_sha: {}, reruns_total: 0, probe: null, no_ci: null };
}

function rerunBudgetRemains(st, head) {
  return (st.reruns_by_sha[head] || 0) < RERUNS_PER_SHA && st.reruns_total < RERUNS_TOTAL;
}

const isConflicting = (view) => view.mergeStateStatus === "DIRTY" || view.mergeStateStatus === "CONFLICTING" || view.mergeable === "CONFLICTING";

// decide(obs, st, nowMs) -> the next step for one observation. `obs` = { head, ci: observeCi's
// {ci_state, head_sha_matches}, view: {mergeStateStatus, mergeable, reviewDecision}, reviewPass }.
// Steps: {act:"wait"} | {act:"token", token, reason?} | {act:"triage", transience} |
// {act:"update-branch"}. A conflict is read first, because GitHub runs no pull-request CI on a
// head it cannot merge, so waiting for CI there never ends. Otherwise CI comes before the merge
// state: acting on a head whose CI is unsettled or red is premature.
function decide(obs, st, nowMs) {
  const { head, ci, view } = obs;
  const probe = st.probe && st.probe.head_sha === head ? st.probe : null;

  if (isConflicting(view)) return { act: "token", token: "needs-fix", reason: "conflict" };

  if (ci.ci_state === "indeterminate" || ci.head_sha_matches === false) return { act: "wait" };

  if (ci.ci_state === "no-ci-coverage") {
    if (st.no_ci && st.no_ci.head_sha === head && nowMs - Date.parse(st.no_ci.at) >= NO_CI_SETTLE_MS) {
      return { act: "token", token: "leave-for-human", reason: "no-ci-coverage" };
    }
    return { act: "wait", noCiSeen: true };
  }

  if (ci.ci_state === "ci-red") {
    if (probe && probe.stage === "rerun-requested") {
      if (nowMs - Date.parse(probe.at) < RERUN_SETTLE_MS) return { act: "wait" };
      return { act: "triage", transience: "persistent" };
    }
    if (probe) return { act: "triage", transience: "persistent" }; // rerun-running, or awaiting a fault domain
    return { act: "triage", transience: "unknown" };
  }

  // ci-green from here.
  if (probe) return { act: "triage", transience: "transient" }; // the re-run went green: record the flake
  if (view.mergeStateStatus === "BEHIND") return { act: "update-branch" };
  if (view.mergeable === "MERGEABLE" && obs.reviewPass) return { act: "token", token: "ready" };
  return { act: "wait" };
}

// routeTriage(verdict, transience, st, head, faultDomainGiven) -> the step after a ci-triage pass.
// The first look (transience unknown) only decides origin: main red or unreadable parks; else the
// re-run budget probes for a flake, and an exhausted budget is persistent by fiat. A persistent
// failure routes on ci-triage's own action; an undecided fault domain asks the agent once.
function routeTriage(verdict, transience, st, head, faultDomainGiven) {
  if (transience === "transient") return { act: "continue" };
  if (transience === "unknown") {
    if (verdict.origin !== "mine") return { act: "token", token: "leave-for-human", reason: "ci-red-park" };
    if (rerunBudgetRemains(st, head)) return { act: "rerun" };
    return { act: "triage", transience: "persistent" };
  }
  if (verdict.action === "fix-attempt") return { act: "token", token: "needs-fix", reason: "regression" };
  if (verdict.action === "park-needs-human" && verdict.origin === "mine" && verdict.fault_domain === "unknown" && !faultDomainGiven) {
    return { act: "token", token: "needs-judgement", reason: "fault-domain", awaitFaultDomain: true };
  }
  return { act: "token", token: "leave-for-human", reason: "ci-red-park" };
}

// ---------------------------------------------------------------------------
// Impure shell.
// ---------------------------------------------------------------------------
function statePath(runDir, issue) { return path.join(runDir, issue, "landing-loop.json"); }

function readState(runDir, issue) {
  try { return JSON.parse(fs.readFileSync(statePath(runDir, issue), "utf8")); } catch { return null; }
}

function writeState(runDir, issue, st) {
  const p = statePath(runDir, issue);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
  fs.renameSync(tmp, p);
}

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// The run ids behind the PR's failing checks, from each check's Actions link. A failing check with
// no Actions run (an external status) cannot be re-run, so the caller treats the failure as persistent.
function failingRunIds(rows) {
  const ids = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || (r.bucket !== "fail" && r.bucket !== "cancel")) continue;
    const m = /\/actions\/runs\/(\d+)/.exec(r.link || "");
    if (!m) return null;
    ids.add(m[1]);
  }
  return [...ids];
}

function defaultDeps(runDir, issue) {
  let repo;
  return {
    now: () => Date.now(),
    sleep: sleepMs,
    heartbeat: () => { try { cmdHeartbeat([runDir, "--unit", issue]); } catch { /* a missed tick is not a landing fault */ } },
    repo: () => (repo === undefined ? (repo = ghRepoSlug(null)) : repo),
    view: (pr) => ghJson(["pr", "view", String(pr), "--json", "headRefOid,mergeStateStatus,mergeable,reviewDecision"]),
    observeCi: (r, pr, head) => observeCi(r, pr, head),
    checks: (pr) => ghJson(["pr", "checks", String(pr), "--json", "name,bucket,link"]),
    rerun: (id) => runGh(["run", "rerun", String(id), "--failed"], { timeout: 60000 }).status === 0,
    updateBranch: (pr) => runGh(["pr", "update-branch", String(pr)], { timeout: 120000 }).status === 0,
    triage: (pr, transience, faultDomain) => runCiTriage({ pr, issue, transienceFlag: transience, faultDomainFlag: faultDomain, faultDomainSource: faultDomain ? "llm" : null }),
    writeTriage: (verdict) => writeCiTriageVerdict(runDir, issue, verdict),
    reviewPass: () => readReviewVerdict(runDir, issue) === "pass",
  };
}

// runLand(opts, deps) -> { token, reason?, exit, detail, head_sha? }. Loops observe -> decide -> act
// until a token, the landing deadline, or the end of this call's slice.
function runLand(opts, deps) {
  const { pr, issue, runDir, sliceMs, faultDomain, dryRun } = opts;
  const callStart = deps.now();
  let st = (!dryRun && readState(runDir, issue)) || null;
  if (!st || st.pr !== Number(pr)) st = initialState(pr, callStart);
  const save = () => { if (!dryRun) writeState(runDir, issue, st); };
  const out = (token, extra) => { save(); return { token, exit: token === "pending" ? 3 : token === "errored" ? 2 : 0, ...extra }; };
  save();

  const repo = deps.repo();
  if (!repo) return { token: "errored", exit: 2, detail: "cannot resolve the repo slug (gh repo view failed)" };

  for (;;) {
    if (!dryRun) deps.heartbeat();
    const now = deps.now();
    if (now - Date.parse(st.started_at) >= DEADLINE_MS) return out("landing-resumable", { detail: "the 25-minute landing deadline elapsed with the PR open" });
    if (now - callStart >= sliceMs) return out("pending", { detail: "this call's slice is spent; re-invoke to continue the same loop" });

    const v = deps.view(pr);
    if (!v.ok || !v.data || !v.data.headRefOid) { if (dryRun) return { token: "dry-run", exit: 0, would: "wait", detail: `gh pr view failed: ${v.stderr}` }; deps.sleep(POLL_MS); continue; }
    const view = v.data;
    const head = view.headRefOid;
    if (st.probe && st.probe.head_sha !== head) st.probe = null;
    const ci = deps.observeCi(repo, pr, head);
    if (st.probe && st.probe.stage === "rerun-requested" && ci.ci_state === "indeterminate") st.probe.stage = "rerun-running";
    if (ci.ci_state !== "no-ci-coverage") st.no_ci = null;

    let step = decide({ head, ci, view, reviewPass: deps.reviewPass() || view.reviewDecision === "APPROVED" }, st, now);
    const observed = { head_sha: head, ci_state: ci.ci_state, merge_state: view.mergeStateStatus, mergeable: view.mergeable };

    while (step.act === "triage") {
      if (dryRun && step.transience !== "unknown") return { token: "dry-run", exit: 0, would: `ci-triage --transience ${step.transience}`, observed };
      const t = deps.triage(pr, step.transience, step.transience === "persistent" ? faultDomain : null);
      if (t.failLoud) return out("errored", { detail: `ci-triage: ${t.failLoud}`, ...observed });
      if (!dryRun) deps.writeTriage(t.verdict);
      const transience = step.transience;
      step = routeTriage(t.verdict, transience, st, head, !!faultDomain);
      if (transience === "transient") st.probe = null;
      if (step.act === "token" && step.awaitFaultDomain) st.probe = { head_sha: head, stage: "await-fault-domain", at: new Date(now).toISOString() };
    }

    if (dryRun) {
      if (step.act === "token") return { token: "dry-run", exit: 0, would: step.reason ? `${step.token}:${step.reason}` : step.token, observed };
      if (step.act !== "continue") return { token: "dry-run", exit: 0, would: step.act, observed };
    }

    if (step.act === "token") {
      if (step.token !== "needs-judgement") st.probe = null;
      return out(step.token, { reason: step.reason, ...observed });
    }
    if (step.act === "rerun") {
      const c = deps.checks(pr);
      const ids = c.ok ? failingRunIds(c.data) : null;
      const rerunOk = !!ids && ids.length > 0 && ids.every((id) => deps.rerun(id));
      st.reruns_by_sha[head] = (st.reruns_by_sha[head] || 0) + 1;
      st.reruns_total += 1;
      st.probe = rerunOk ? { head_sha: head, stage: "rerun-requested", at: new Date(now).toISOString() } : { head_sha: head, stage: "rerun-failed", at: new Date(now).toISOString() };
      save();
      if (!rerunOk) continue; // nothing could be re-run: the next pass reads the failure as persistent
      deps.sleep(POLL_MS);
      continue;
    }
    if (step.act === "update-branch") {
      if (!deps.updateBranch(pr)) return out("leave-for-human", { reason: "rebase-conflict", ...observed });
      save();
      deps.sleep(POLL_MS);
      continue;
    }
    if (step.noCiSeen && !(st.no_ci && st.no_ci.head_sha === head)) st.no_ci = { head_sha: head, at: new Date(now).toISOString() };
    save();
    if (step.act === "continue") continue;
    deps.sleep(POLL_MS); // wait
  }
}

function cmdLand(args) {
  if (args.includes("--selftest")) return landSelftest();
  const { values, errors } = parseArgs(args, LAND_SPEC);
  if (errors.length) return usageError(errors, LAND_USAGE);
  const pr = values["--pr"], issue = values["--issue"], runDir = values["--run-dir"];
  if (!pr || !issue || !runDir) return usageError([{ code: "missing-value", detail: "--pr, --issue and --run-dir are required" }], LAND_USAGE);
  if (!/^\d+$/.test(pr)) return usageError([{ code: "bad-value", flag: "--pr", detail: "--pr must be a PR number" }], LAND_USAGE);
  const fd = values["--fault-domain"];
  if (fd != null && fd !== "code" && fd !== "infra") return usageError([{ code: "bad-value", flag: "--fault-domain", detail: "--fault-domain must be code or infra" }], LAND_USAGE);
  const slice = values["--slice-secs"] == null ? DEFAULT_SLICE_SECS : Number(values["--slice-secs"]);
  if (!Number.isFinite(slice) || slice <= 0) return usageError([{ code: "bad-value", flag: "--slice-secs", detail: "--slice-secs must be a positive number" }], LAND_USAGE);

  const result = runLand({ pr, issue, runDir, sliceMs: slice * 1000, faultDomain: fd || null, dryRun: !!values["--dry-run"] }, defaultDeps(runDir, issue));
  const { exit, ...body } = result;
  if (values["--json"]) console.log(JSON.stringify({ pr: Number(pr), issue, ...body }));
  else console.log(`land ${issue} #${pr}: ${body.token}${body.reason ? `:${body.reason}` : ""}${body.would ? ` (would ${body.would})` : ""}${body.detail ? ` — ${body.detail}` : ""}`);
  return exit;
}

// ---------------------------------------------------------------------------
// --selftest — the pure decision table.
// ---------------------------------------------------------------------------
function landSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };
  const T0 = Date.parse("2026-10-24T00:00:00Z");
  const st = () => initialState(1, T0);
  const green = { ci_state: "ci-green", head_sha_matches: true };
  const red = { ci_state: "ci-red", head_sha_matches: true };
  const clean = { mergeStateStatus: "CLEAN", mergeable: "MERGEABLE" };
  const obs = (ci, view, reviewPass = true) => ({ head: "h1", ci, view, reviewPass });

  ok("pending CI waits", decide(obs({ ci_state: "indeterminate" }, clean), st(), T0).act === "wait");
  ok("a stale green (checks on an older head) waits", decide(obs({ ci_state: "ci-green", head_sha_matches: false }, clean), st(), T0).act === "wait");
  ok("green, mergeable, review pass -> ready", decide(obs(green, clean), st(), T0).token === "ready");
  ok("green, mergeable, no review pass -> wait", decide(obs(green, clean, false), st(), T0).act === "wait");
  ok("green, DIRTY -> needs-fix:conflict", decide(obs(green, { mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" }), st(), T0).reason === "conflict");
  ok("a conflict is read before waiting on CI (no PR CI runs on an unmergeable head)", decide(obs({ ci_state: "ci-green", head_sha_matches: false }, { mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" }), st(), T0).reason === "conflict");
  ok("green, BEHIND -> update-branch", decide(obs(green, { mergeStateStatus: "BEHIND", mergeable: "MERGEABLE" }), st(), T0).act === "update-branch");
  ok("first red -> triage unknown", decide(obs(red, clean), st(), T0).transience === "unknown");
  const first = decide(obs({ ci_state: "no-ci-coverage", head_sha_matches: true }, clean), st(), T0);
  ok("first no-ci-coverage waits to settle", first.act === "wait" && first.noCiSeen === true);
  const settled = { ...st(), no_ci: { head_sha: "h1", at: new Date(T0).toISOString() } };
  ok("no-ci-coverage held 60s -> leave-for-human", decide(obs({ ci_state: "no-ci-coverage", head_sha_matches: true }, clean), settled, T0 + NO_CI_SETTLE_MS).reason === "no-ci-coverage");
  const req = { ...st(), probe: { head_sha: "h1", stage: "rerun-requested", at: new Date(T0).toISOString() } };
  ok("red just after a re-run request is the old attempt -> wait", decide(obs(red, clean), req, T0 + 1000).act === "wait");
  ok("red never seen running past the settle window -> persistent", decide(obs(red, clean), req, T0 + RERUN_SETTLE_MS).transience === "persistent");
  const running = { ...st(), probe: { head_sha: "h1", stage: "rerun-running", at: new Date(T0).toISOString() } };
  ok("red after the re-run ran -> persistent", decide(obs(red, clean), running, T0).transience === "persistent");
  ok("green after the re-run ran -> transient", decide(obs(green, clean), running, T0).transience === "transient");
  const otherHead = { ...st(), probe: { head_sha: "h0", stage: "rerun-running", at: new Date(T0).toISOString() } };
  ok("a probe on an older head is ignored", decide(obs(red, clean), otherHead, T0).transience === "unknown");

  const v = (origin, action, fault_domain = "unknown") => ({ origin, action, fault_domain });
  ok("main-was-red -> leave-for-human:ci-red-park", routeTriage(v("main-was-red", "park-needs-human"), "unknown", st(), "h1", false).reason === "ci-red-park");
  ok("origin unknown -> leave-for-human:ci-red-park", routeTriage(v("unknown", "park-needs-human"), "unknown", st(), "h1", false).reason === "ci-red-park");
  ok("mine, budget left -> rerun", routeTriage(v("mine", "park-needs-human"), "unknown", st(), "h1", false).act === "rerun");
  const spentSha = { ...st(), reruns_by_sha: { h1: 1 }, reruns_total: 1 };
  ok("mine, this sha already re-run -> persistent by fiat", routeTriage(v("mine", "park-needs-human"), "unknown", spentSha, "h1", false).transience === "persistent");
  const spentTotal = { ...st(), reruns_by_sha: { h0: 1, hx: 1 }, reruns_total: 2 };
  ok("mine, two re-runs this build -> persistent by fiat", routeTriage(v("mine", "park-needs-human"), "unknown", spentTotal, "h1", false).transience === "persistent");
  ok("persistent + code -> needs-fix:regression", routeTriage(v("mine", "fix-attempt", "code"), "persistent", st(), "h1", false).reason === "regression");
  ok("persistent + infra -> leave-for-human:ci-red-park", routeTriage(v("mine", "park-errored", "infra"), "persistent", st(), "h1", false).reason === "ci-red-park");
  ok("persistent + undecided fault domain -> needs-judgement", routeTriage(v("mine", "park-needs-human"), "persistent", st(), "h1", false).token === "needs-judgement");
  ok("persistent + still undecided after a judgement -> leave-for-human", routeTriage(v("mine", "park-needs-human"), "persistent", st(), "h1", true).reason === "ci-red-park");
  ok("transient -> continue", routeTriage(v("mine", "proceed-to-merge-gate"), "transient", st(), "h1", false).act === "continue");

  ok("failingRunIds reads the Actions run ids", JSON.stringify(failingRunIds([{ bucket: "fail", link: "https://github.com/o/r/actions/runs/42/job/7" }, { bucket: "pass", link: "x" }])) === '["42"]');
  ok("failingRunIds: a failing check with no Actions run -> null", failingRunIds([{ bucket: "fail", link: "https://ci.example/1" }]) === null);

  console.log(`RESULT ${fail ? "fail" : "ok"} land selftest (${fail} failures)`);
  return fail ? 1 : 0;
}

module.exports = {
  DEADLINE_MS, NO_CI_SETTLE_MS, RERUN_SETTLE_MS, LAND_SPEC,
  initialState, rerunBudgetRemains, decide, routeTriage, failingRunIds, statePath, runLand, cmdLand, landSelftest,
};
