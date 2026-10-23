// ===========================================================================
// === region:factory — merge-gate-gh — FAFF-1391: the single `gh` chokepoint (runGh), runner identity, and the branch-protection and GitHub-auth probes ===
// ===========================================================================
// Split out of merge-gate.js (FAFF-1391), unchanged. Every `gh` invocation faff makes routes through
// runGh below, which holds the only direct `gh` spawn in the merge-gate modules.

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { extractRequiredChecks, classifyBranchProtection, classifyGithubAuth } = require("./merge-gate-classify");

const BRANCH_PROTECTION_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--repo": { arity: 1 }, "--branch": { arity: 1 },
} };
// FAFF-728: the GitHub-auth preflight probe — user-scoped, so it needs no repo slug.
const GITHUB_AUTH_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 } } };

// ===========================================================================
// FAFF-1213: the single `gh` env chokepoint — give the runner a GitHub identity
// separate from the human's. Every `gh` invocation faff makes routes through
// `runGh`, which injects a configured runner credential as GH_TOKEN when one is
// configured and otherwise leaves the ambient environment byte-identical. The
// token is an opaque bearer string faff never interprets, reads fresh per call,
// and never persists. Zero-config (no runner credential) touches no `gh` env.
// ===========================================================================

// Per-process config memo + warn-once flags (module-level, so each distinct
// warning fires at most once per process). The CONFIG read is memoised; the
// token VALUE is never cached — it is read fresh from process.env per call so an
// externally-refreshed App installation token is always picked up.
let _runnerGhConfigMemo = null;
let _warnedConfigFault = false;
let _warnedUnresolved = false;

// FAFF-1213: narrow, fault-tolerant reader of ONLY the two `autonomous` keys,
// decoupled from the throwing loadConfig() so a malformed `.faffrc` cannot break
// GitHub diagnostics or the merge. Memoised once per process. Returns
// { tokenEnvName, configuredLogin, configFault }.
function readRunnerGhConfig() {
  if (_runnerGhConfigMemo) return _runnerGhConfigMemo;
  const two = (data) => {
    const auto = data && typeof data.autonomous === "object" && !Array.isArray(data.autonomous) ? data.autonomous : {};
    const pick = (v) => (typeof v === "string" && v !== "" ? v : null);
    return { tokenEnvName: pick(auto.runner_github_token_env), configuredLogin: pick(auto.runner_github_login), configFault: false };
  };
  try {
    // loadConfig REQUIRES a root (loadConfig() with no arg throws on findConfig(undefined)); resolve
    // it via the canonical findRoot(), matching resolveKnownSecretValues' own default.
    const { findRoot } = require("./shared-infra");
    const [data] = require("./config").loadConfig(findRoot()); // lazy — matches this file's config-read convention
    _runnerGhConfigMemo = two(data);
  } catch {
    // Any config fault (malformed base/overlay, legacy name, …) degrades to ambient
    // with tokenEnvName null — a broken `.faffrc` is an environment problem, never a
    // separation signal, and GitHub diagnostics keep running.
    _runnerGhConfigMemo = { tokenEnvName: null, configuredLogin: null, configFault: true };
  }
  return _runnerGhConfigMemo;
}

// FAFF-1213: PURE over its inputs — decides the `gh` identity from the config read
// plus the current environment. The token VALUE is read from the passed `env`, so a
// refreshed token is always current. Returns the `RunnerGhEnv` record. In every
// ambient branch `env` is returned by REFERENCE (never spread/copied), so the spawned
// `gh` environment stays byte-identical to the ambient process environment.
function resolveRunnerGhEnv(runnerGhConfig, env) {
  if (runnerGhConfig && runnerGhConfig.configFault) {
    return { env, redactedEnv: env, identitySource: "ambient", tokenEnvName: null, credentialUnresolved: false, configFault: true };
  }
  const name = runnerGhConfig ? runnerGhConfig.tokenEnvName : null;
  if (!name) {
    return { env, redactedEnv: env, identitySource: "ambient", tokenEnvName: null, credentialUnresolved: false, configFault: false };
  }
  const token = env ? env[name] : undefined;
  if (token === undefined || token === null || token === "") {
    return { env, redactedEnv: env, identitySource: "ambient", tokenEnvName: name, credentialUnresolved: true, configFault: false };
  }
  const built = { ...env, GH_TOKEN: token };
  const redacted = { ...built, GH_TOKEN: "***REDACTED***" };
  return { env: built, redactedEnv: redacted, identitySource: "runner-credential", tokenEnvName: name, credentialUnresolved: false, configFault: false };
}

// FAFF-1213: THE single `gh` spawn wrapper. All 9 of faff's `gh` sites route here.
// Reuses the memoised config, reads the token value fresh, warns once on a config
// fault or a named-but-empty credential, and spawns `gh` with the resolved env. The
// per-site timeout / cwd ride `opts`; `env` is the only addition over the bare call.
function runGh(args, opts) {
  const cfg = readRunnerGhConfig();
  const resolved = resolveRunnerGhEnv(cfg, process.env);
  if (resolved.configFault && !_warnedConfigFault) {
    _warnedConfigFault = true;
    process.stderr.write("faff: .faffrc could not be read; proceeding as the ambient GitHub identity\n");
  } else if (resolved.credentialUnresolved && !_warnedUnresolved) {
    _warnedUnresolved = true;
    process.stderr.write(`faff: runner_github_token_env names ${resolved.tokenEnvName} but it is empty; proceeding as the ambient identity\n`);
  }
  return spawnSync("gh", args, { encoding: "utf8", env: resolved.env, ...(opts || {}) });
}

// FAFF-1213: PURE comparator for FAFF-1182 independence counting — normalises a
// trailing `[bot]` on EITHER argument before comparing, so `my-app[bot]` and
// `my-app` match. null/non-string inputs never match.
function githubActorMatches(recordedLogin, observedActorLogin) {
  const norm = (s) => (typeof s === "string" ? s.replace(/\[bot\]$/, "") : null);
  const a = norm(recordedLogin);
  const b = norm(observedActorLogin);
  return a !== null && b !== null && a === b;
}

// FAFF-1213: resolve the acting GitHub login into a RunnerIdentityEvidence record
// (never the token). The configured `runner_github_login` is the source of truth;
// `gh api user` is a best-effort verifier that also auto-fills the login for PAT /
// bot-account tokens. An App installation token makes `gh api user` return 403, so
// for Apps the configured login stands unverified rather than failing.
function resolveRunnerIdentity(runnerGhConfig, resolvedEnv, probeOverride) {
  const configuredLogin = runnerGhConfig ? runnerGhConfig.configuredLogin : null;
  if (!resolvedEnv || resolvedEnv.identitySource === "ambient") {
    return {
      github_login: configuredLogin || null,
      github_login_source: configuredLogin ? "configured" : "unresolved",
      credential_source: "ambient",
      credential_unresolved: !!(resolvedEnv && resolvedEnv.credentialUnresolved),
      verified: false,
    };
  }
  // `probeOverride` is injectable (tests only) — the real call path always runs the probe fresh
  // UNDER the runner credential; tests drive the authed / App-403 / unresolved branches with a
  // pre-classified result rather than a live forge.
  const probe = probeOverride !== undefined ? probeOverride : classifyGithubAuth(runGh(["api", "user"], { timeout: 60000 }));
  if (probe.status === "authed" && probe.login) {
    if (configuredLogin && !githubActorMatches(configuredLogin, probe.login)) {
      process.stderr.write(`faff: configured runner_github_login (${configuredLogin}) != gh api user login (${probe.login})\n`);
    }
    return { github_login: probe.login, github_login_source: "gh-api-user", credential_source: "runner-credential", credential_unresolved: false, verified: true };
  }
  if (configuredLogin) {
    return { github_login: configuredLogin, github_login_source: "configured", credential_source: "runner-credential", credential_unresolved: false, verified: false };
  }
  return { github_login: null, github_login_source: "unresolved", credential_source: "runner-credential", credential_unresolved: false, verified: false };
}

// FAFF-1213: resolve the acting identity ONCE per process and cache it. The merge-record and
// pr-create convenience copies call this (rather than re-resolving per write), so a runner-
// credential merge flow issues at most one `gh api user` probe, not one per writeMergeRecord call.
// The login/source is stable for the run even if the underlying token refreshes, so caching the
// classification (never the token) is safe.
let _runnerIdentityMemo;
function resolveRunnerIdentityMemoised() {
  if (_runnerIdentityMemo !== undefined) return _runnerIdentityMemo;
  try {
    const cfg = readRunnerGhConfig();
    _runnerIdentityMemo = resolveRunnerIdentity(cfg, resolveRunnerGhEnv(cfg, process.env));
  } catch { _runnerIdentityMemo = null; }
  return _runnerIdentityMemo;
}

// FAFF-1213: append the run-level `runner-identity` evidence record to the run's
// hash-chained events.jsonl (via appendEventRecord, which scrubs data through the
// known-secret redactor by construction). The record is run-level (no `issue`), so
// `mintIssueAnchor`'s verbatim events.jsonl byte-copy carries it into every per-PR
// anchor — the only identity source Gate 1 (FAFF-1182) trusts. Best-effort: never
// throws out, so a recording fault never blocks a run.
function recordRunnerIdentity(runDir, opts) {
  try {
    const cfg = readRunnerGhConfig();
    const resolved = resolveRunnerGhEnv(cfg, (opts && opts.env) || process.env);
    const evidence = resolveRunnerIdentity(cfg, resolved);
    const { appendEventRecord } = require("./events"); // lazy — avoids a load-time cycle
    appendEventRecord(runDir, path.basename(runDir), { phase: "run", type: "runner-identity", data: evidence });
    return evidence;
  } catch (e) {
    process.stderr.write(`faff: warning — could not record runner identity: ${e.message}\n`);
    return null;
  }
}

// Impure gh helper: run `gh <args>`, JSON-parse stdout. Returns { ok, data, status, stderr }.
function ghJson(args) {
  const r = runGh(args, { timeout: 60000 }); // FAFF-1213: route through the single gh chokepoint
  if (r.error || r.status !== 0) return { ok: false, data: null, status: r.status, stderr: (r.stderr || (r.error && r.error.message) || "").trim() };
  try { return { ok: true, data: JSON.parse(r.stdout), status: 0, stderr: "" }; }
  catch { return { ok: false, data: null, status: 0, stderr: "unparseable gh JSON" }; }
}

function ghRepoSlug(explicit) {
  if (explicit) return explicit;
  const r = ghJson(["repo", "view", "--json", "nameWithOwner"]);
  return r.ok && r.data ? r.data.nameWithOwner : null;
}

function cmdBranchProtectionCheck(args) {
  if (args.includes("--selftest")) return branchProtectionSelftest();
  const parsed = parseArgs(args, BRANCH_PROTECTION_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff branch-protection-check [--repo R] [--branch B] [--json]");
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const json = !!parsed.values["--json"];
  const repo = ghRepoSlug(get("--repo"));
  if (!repo) { process.stderr.write("faff branch-protection-check: cannot resolve repo slug (gh repo view failed)\n"); return 2; }
  let branch = get("--branch");
  if (!branch) {
    const dv = ghJson(["repo", "view", "--json", "defaultBranchRef"]);
    branch = dv.ok && dv.data && dv.data.defaultBranchRef ? dv.data.defaultBranchRef.name : "main";
  }
  // FAFF-503: probe the effective-rules endpoint — the documented union of classic protection +
  // rulesets — not the classic protection API (which 404s on ruleset-only protection).
  const r = runGh(["api", `repos/${repo}/rules/branches/${branch}`], { timeout: 60000 }); // FAFF-1213
  let probe;
  let codeOwnerReview = null;
  if (r.error) probe = { ok: false, basis: `gh unavailable: ${r.error.message}` };
  else if (r.status === 0) {
    let rules;
    try { rules = JSON.parse(r.stdout); } catch { rules = undefined; }
    if (!Array.isArray(rules)) {
      // Unparseable / non-array body: never read a shape change as [] → unprotected. Fail-closed.
      probe = { ok: false, basis: `unparseable rules JSON from gh api repos/${repo}/rules/branches/${branch}` };
    } else {
      const { protected: prot, required_checks, code_owner_review } = extractRequiredChecks(rules);
      codeOwnerReview = code_owner_review;
      probe = prot
        ? { ok: true, protected: true, required_checks, basis: `gh api repos/${repo}/rules/branches/${branch} — required_status_checks rule present` }
        : { ok: true, protected: false, basis: `no required-status-check rule on ${branch} (rules endpoint returned ${rules.length} rule(s))` };
    }
  } else if (/404|Not Found/i.test(r.stderr || "")) {
    // Unlike the classic API, a 404 here is NOT "unprotected" — the rules endpoint returns [] (exit 0)
    // for an unprotected/nonexistent branch. A 404 means the repo is unreachable or the endpoint is
    // absent (GHES older than ruleset support) → cannot confirm → indeterminate.
    probe = { ok: false, basis: `rules endpoint 404 (repo unreachable or host without ruleset support) on ${branch}` };
  } else {
    probe = { ok: false, basis: `gh api error (${r.status}): ${(r.stderr || "").split("\n")[0]}` };
  }
  const st = classifyBranchProtection(probe);
  st.branch = branch; st.repo = repo; st.code_owner_review = codeOwnerReview;
  if (json) process.stdout.write(JSON.stringify(st) + "\n");
  else console.log(`${st.status} (basis: ${st.basis})${st.required_checks.length ? ` — required: ${st.required_checks.join(", ")}` : ""} — code-owner review: ${codeOwnerReview === true ? "required" : "not required"}`);
  return st.status === "protected" ? 0 : 1;
}



// FAFF-728: the run-start GitHub-auth preflight — one read-only `gh api user` call, classified via
// the pure core above. Reuses the 60s bound the sibling gh probes carry so a hung network never
// stalls kickoff. exit 0 == authed, exit 1 == auth-failed OR indeterminate (mirrors
// branch-protection-check: 0 = confirmed-good, 1 = otherwise).
function cmdGithubAuthCheck(args) {
  if (args.includes("--selftest")) return githubAuthSelftest();
  const parsed = parseArgs(args, GITHUB_AUTH_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff github-auth-check [--json]");
  const json = !!parsed.values["--json"];
  // FAFF-1213: the probe now runs UNDER the runner credential when one is configured
  // (routed through runGh). Resolve which identity it reflects and augment the output
  // WITHOUT losing the existing status/basis/login "is gh auth working" signal.
  const cfg = readRunnerGhConfig();
  const resolvedEnv = resolveRunnerGhEnv(cfg, process.env);
  const r = runGh(["api", "user"], { timeout: 60000 });
  const st = classifyGithubAuth({ error: r.error || null, status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" });
  const identitySource = resolvedEnv.identitySource;
  if (json) {
    process.stdout.write(JSON.stringify({ ...st, identity_source: identitySource, credential_source: identitySource, credential_unresolved: resolvedEnv.credentialUnresolved, config_fault: resolvedEnv.configFault }) + "\n");
  } else {
    const loginPart = st.status === "authed" && st.login ? ` — ${st.login}` : "";
    let reason = "";
    if (resolvedEnv.configFault) reason = " (config fault: .faffrc unreadable; proceeding ambient)";
    else if (resolvedEnv.credentialUnresolved) reason = ` (runner_github_token_env ${resolvedEnv.tokenEnvName} empty; proceeding ambient)`;
    console.log(`${st.status} (basis: ${st.basis})${loginPart} [${identitySource}]${reason}`);
  }
  return st.status === "authed" ? 0 : 1;
}

// In-memory selftest: drives the PURE classifier with authed / auth-failed (401) / indeterminate
// (gh-missing) fixtures — no network (parity with branch-protection-check's pure-only selftest;
// the live gh path is the spec's integration smoke test).
function githubAuthSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } else console.log(`ok   ${label}`); };
  const authed = classifyGithubAuth({ error: null, status: 0, stdout: JSON.stringify({ login: "octocat", id: 1 }), stderr: "" });
  check("exit0 + parseable .login → authed", authed.status === "authed");
  check("authed captures login", authed.login === "octocat");
  check("authed basis names the probe", /gh api user ok/.test(authed.basis));
  check("exit0 + unparseable body → indeterminate", classifyGithubAuth({ error: null, status: 0, stdout: "not json", stderr: "" }).status === "indeterminate");
  check("exit0 + no .login field → indeterminate", classifyGithubAuth({ error: null, status: 0, stdout: JSON.stringify({ id: 1 }), stderr: "" }).status === "indeterminate");
  const auth401 = classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: Bad credentials (HTTP 401)" });
  check("401 bad credentials → auth-failed", auth401.status === "auth-failed");
  check("auth-failed basis echoes the stderr first line", /Bad credentials/.test(auth401.basis));
  check("auth-failed carries no login", auth401.login === null);
  check("403 → auth-failed", classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: HTTP 403: Forbidden" }).status === "auth-failed");
  check("not-logged-in → auth-failed", classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh auth login required: not logged in to any GitHub hosts" }).status === "auth-failed");
  const ghMissing = classifyGithubAuth({ error: new Error("spawnSync gh ENOENT"), status: null, stdout: "", stderr: "" });
  check("gh missing (spawn error) → indeterminate", ghMissing.status === "indeterminate");
  check("gh-missing basis says unavailable", /gh unavailable/.test(ghMissing.basis));
  check("gh-missing is NOT auth-failed", ghMissing.status !== "auth-failed");
  check("non-auth error (500) → indeterminate", classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: Something broke (HTTP 500)" }).status === "indeterminate");
  // fail-open boundary: a non-auth fault that merely MENTIONS "authentication" must stay indeterminate,
  // never a false re-auth claim (the spec anti-pattern; a bare `authentication` match would break these).
  check("proxy 407 (network fault mentioning authentication) → indeterminate, not auth-failed", classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: request failed: 407 Proxy Authentication Required" }).status === "indeterminate");
  check("authentication-service 5xx (transient) → indeterminate, not auth-failed", classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: authentication service temporarily unavailable (HTTP 500)" }).status === "indeterminate");
  check("real GitHub 401 wording (Requires authentication) → auth-failed", classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: Requires authentication (HTTP 401)" }).status === "auth-failed");
  check("null result → indeterminate (defensive)", classifyGithubAuth(null).status === "indeterminate");
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (github-auth pure classifier, ${fail} failed)`);
  return fail ? 1 : 0;
}

function branchProtectionSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) { console.log(`FAIL ${label}`); fail++; } else console.log(`ok   ${label}`); };
  check("reachable + protected → protected", classifyBranchProtection({ ok: true, protected: true, required_checks: ["validate"] }).status === "protected");
  check("protected carries required_checks", classifyBranchProtection({ ok: true, protected: true, required_checks: ["validate"] }).required_checks.length === 1);
  check("reachable + not protected → unprotected", classifyBranchProtection({ ok: true, protected: false }).status === "unprotected");
  check("unreachable → indeterminate", classifyBranchProtection({ ok: false, basis: "gh outage" }).status === "indeterminate");
  check("null probe → indeterminate", classifyBranchProtection(null).status === "indeterminate");
  // FAFF-503: the ruleset-shaped effective-rules payload drives extractRequiredChecks with no network.
  const rulesetPayload = [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "required_status_checks", parameters: { required_status_checks: [{ context: "validate", integration_id: 15368 }] } },
    { type: "required_linear_history" },
    { type: "pull_request", parameters: { required_approving_review_count: 0 } },
  ];
  const ext = extractRequiredChecks(rulesetPayload);
  check("ruleset payload → protected", ext.protected === true);
  check("ruleset payload → required_checks [\"validate\"]", ext.required_checks.length === 1 && ext.required_checks[0] === "validate");
  const empty = extractRequiredChecks([]);
  check("empty rules array → not protected", empty.protected === false);
  check("empty rules array → no required_checks", empty.required_checks.length === 0);
  check("rules without required_status_checks → not protected", extractRequiredChecks([{ type: "deletion" }, { type: "pull_request" }]).protected === false);
  check("required_status_checks rule with empty contexts → protected, []", (() => { const e = extractRequiredChecks([{ type: "required_status_checks", parameters: { required_status_checks: [] } }]); return e.protected === true && e.required_checks.length === 0; })());
  check("non-array rules → not protected (defensive)", extractRequiredChecks(null).protected === false);
  // FAFF-1278: code_owner_review from the ruleset pull_request rule.
  const prRule = (params) => [{ type: "required_status_checks", parameters: { required_status_checks: [] } }, { type: "pull_request", parameters: params }];
  check("pull_request rule requiring code-owner review → code_owner_review true", extractRequiredChecks(prRule({ require_code_owner_review: true })).code_owner_review === true);
  check("pull_request rule not requiring code-owner review → code_owner_review false", extractRequiredChecks(prRule({ require_code_owner_review: false })).code_owner_review === false);
  check("no pull_request rule → code_owner_review null", extractRequiredChecks([{ type: "deletion" }]).code_owner_review === null);
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (branch-protection pure classifier, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { BRANCH_PROTECTION_SPEC, GITHUB_AUTH_SPEC, _runnerGhConfigMemo, _warnedConfigFault, _warnedUnresolved, readRunnerGhConfig, resolveRunnerGhEnv, runGh, githubActorMatches, resolveRunnerIdentity, resolveRunnerIdentityMemoised, recordRunnerIdentity, ghJson, ghRepoSlug, cmdBranchProtectionCheck, cmdGithubAuthCheck, githubAuthSelftest, branchProtectionSelftest };
