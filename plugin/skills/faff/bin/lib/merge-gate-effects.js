// ===========================================================================
// === region:factory — merge-gate-effects — FAFF-1391: the merge chokepoint's declare/observe effects and Commissaire grant legs (FAFF-383/1012, FAFF-1034/1118/1212) ===
// ===========================================================================
// Split out of merge-gate.js (FAFF-1391), unchanged.

const fs = require("node:fs");
const path = require("node:path");
const { appendEffectEntries, effectTargetMatches, matchesUnit } = require("./effects");
const commissaireVerify = require("./commissaire-verify");
const commissaireTrust = require("./commissaire-trust");
const { runGh, ghRepoSlug } = require("./merge-gate-gh");

// === FAFF-383 / FAFF-1012: the merge chokepoint is declarer AND observer for the merge ======
// Per ADR-0126 (which amends ADR-0064's authority split for the merge chokepoint only): merge-gate
// is the single component that both performs the merge and holds the (issue, step="merge",
// target=pr:N) tuple, so for the effect it is about to observe it also mints the covering DECLARE.
// The declare is an idempotent top-up: it re-reads the ledger and writes only the uncovered subset,
// so an already-present operator/orchestrator declare (graft Step 10, or a landing-comment template)
// is left alone and no redundant line is chained. Each auto-minted declare carries a record-level
// `origin: "merge-gate-auto"` marker so an audit consumer can still tell a genuine pre-merge declare
// (no origin) from a mechanical top-up; every coverage check ignores it. ADR-0064's
// declare-outside-the-actor rule still binds every other chokepoint (label-write, tracker-write,
// worktree-prune) — the self-declare carve-out is merge-only. Preserved invariants: the declare and
// the observe both run strictly AFTER the verdict is decided; every failure is swallowed to a stderr
// line, never a thrown/propagated error and never a schema-2 effects[] on the result object; nothing
// here changes merge-gate's verdict, exit code, or emitted JSON.

// Build the effect descriptors THIS invocation is about to observe. `deleteBranch` gates the
// branch-delete leg — only the clean-success tail may pass true; the classifyPostMerge "merged"
// path (post-merge step failed) always passes false, because whether --delete-branch itself
// succeeded is exactly what's unconfirmed on that path (see 4.2's path (b) note in the spec).
function mergeEffectsFor(pr, deleteBranch, headRefName) {
  const effects = [{ kind: "merge", target: `pr:${pr}`, reversible: true }];
  if (deleteBranch && headRefName) effects.push({ kind: "branch-delete", target: headRefName, reversible: true });
  return effects;
}

// Read declared-effects.jsonl and return the declared merge-step effect descriptors for `issue`
// (kind_of_entry "declare", step "merge"). Any read/parse failure degrades to [] (an unreadable
// ledger looks identical to an empty one). Shared by warnUncoveredMergeObserves and the FAFF-1012
// auto-declare, so both read the ledger and apply the covered-rule the same way, once.
function readDeclaredMergeEffects(runDir, issue) {
  try {
    const ledgerPath = path.join(runDir, "declared-effects.jsonl");
    if (!fs.existsSync(ledgerPath)) return [];
    return fs.readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim() !== "")
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
      .filter((e) => e.kind_of_entry === "declare" && matchesUnit(e, issue) && e.step === "merge")
      .map((e) => e.effect);
  } catch (e) { return []; /* unreadable ledger => [] => every effect reads as uncovered */ }
}

// Warn — never refuse — for each about-to-be-observed effect with no covering declaration at
// (issue, step "merge"): same kind, and target either an exact match or covered by a "*" wildcard
// declaration (effectTargetMatches, the same match rule `effects check` uses). Advisory-only: it
// never blocks. On success the FAFF-1012 auto-declare has already covered everything, so this stays
// silent; it fires only when the auto-declare could not run (e.g. an unwritable/unreadable ledger).
function warnUncoveredMergeObserves(runDir, issue, effects) {
  const declared = readDeclaredMergeEffects(runDir, issue);
  for (const eff of effects) {
    const covered = declared.some((d) => d && d.kind === eff.kind && effectTargetMatches(d.target, eff.target));
    if (!covered) {
      process.stderr.write(`faff merge-gate: observed ${eff.kind} ${eff.target} with no covering declaration — declare it at graft Step 10 (faff effects declare --step merge); this will read as an escaped side-effect\n`);
    }
  }
}

// FAFF-1012: mint the covering DECLARE for the effect set this invocation is about to observe.
// Idempotent top-up: re-read the ledger and declare only the effects with no covering declaration
// already present (effectTargetMatches, the same rule the observe warn and `effects check` use), so
// an already-declared effect (graft Step 10, or a landing-comment template) writes nothing. An empty
// uncovered set touches the ledger not at all. The auto-minted declare carries the record-level
// `origin: "merge-gate-auto"` marker (see the region header / ADR-0126) so an audit consumer can
// distinguish a mechanical top-up from a genuine pre-merge operator/orchestrator declare.
function autoDeclareMergeEffects(runDir, issue, effects) {
  const declared = readDeclaredMergeEffects(runDir, issue);
  const uncovered = effects.filter((eff) =>
    !declared.some((d) => d && d.kind === eff.kind && effectTargetMatches(d.target, eff.target)));
  if (uncovered.length === 0) return; // already covered — no duplicate declare
  const result = appendEffectEntries(runDir, "declare", issue, "merge", uncovered, undefined, { origin: "merge-gate-auto" });
  if (result.violations) {
    // Should not happen for internally-built descriptors (kind/target/reversible are all
    // faff-constructed, never derived from untrusted input) — surfaced loudly if it ever does.
    process.stderr.write(`faff merge-gate: effects ledger declare rejected internally-built descriptors: ${JSON.stringify(result.violations)}\n`);
  }
}

// Observe what THIS invocation actually did. Called at exactly two points, both AFTER a
// confirmed merge: the clean-success tail, and the classifyPostMerge "merged" path. The auto-declare
// runs first, in its OWN try/catch, so a declare failure never skips the observe that follows. Any
// failure anywhere in this function (unreadable ledger, append error) is swallowed to one stderr
// line — the merge outcome this function is called from is already final by the time it runs.
function observeMergeEffects(runDir, issue, effects) {
  try {
    autoDeclareMergeEffects(runDir, issue, effects);
  } catch (e) {
    process.stderr.write(`faff merge-gate: effects ledger auto-declare failed (merge outcome unaffected): ${e.message}\n`);
  }
  try {
    warnUncoveredMergeObserves(runDir, issue, effects);
    const result = appendEffectEntries(runDir, "observe", issue, "merge", effects);
    if (result.violations) {
      // Should not happen for internally-built descriptors (kind/target/reversible are all
      // faff-constructed, never derived from untrusted input) — surfaced loudly if it ever does.
      process.stderr.write(`faff merge-gate: effects ledger append rejected internally-built descriptors: ${JSON.stringify(result.violations)}\n`);
    }
  } catch (e) {
    process.stderr.write(`faff merge-gate: effects ledger observe failed (merge outcome unaffected): ${e.message}\n`);
  }
}

// FAFF-1212: the chokepoint legs. faff owns WHERE and WHEN a leg runs; Commissaire's
// commissaire-verify owns whether a grant is trustworthy (ADR 0135). Each leg resolves to a
// three-state signal decideFloor / cmdPrCreate consume ("not-applicable" for an ungoverned run, so
// it stays byte-for-byte unaffected and makes no trust-file read) plus a detail record the
// commands report beside it. A governed leg always takes its answer from a verifyGrant call that
// saw the trust read.

// FAFF-1140 — the run-start "governance-required" sentinel reader. A governance-required run whose
// run-start Commissaire admit failed writes <run_dir>/commissaire/governance-required.json before it
// refuses (belt-and-braces: the primary defence is the run-start refuse never reaching the floor).
// Pure and total: absent, unreadable, or malformed => false (never throws) — an ordinary run without
// the sentinel is byte-for-byte unaffected. TRUE only for the explicit `governance_required: true`
// stamp, so a stray/partial file can never fail-closed a run that was never required to be governed.
function governanceRequiredSentinelPresent(runDir) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(runDir, "commissaire", "governance-required.json"), "utf8"));
    return !!rec && rec.governance_required === true;
  } catch { return false; }
}

// The ref-name and owner/name patterns FAFF-1178 applies to `audit verify --base` / `--repo`
// (commissaire.ts AUDIT_BASE_RE / AUDIT_REPO_RE, not exported).
const TRUST_BASE_REF_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;
const TRUST_REPO_SLUG_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const validBaseRef = (ref) => typeof ref === "string" && TRUST_BASE_REF_RE.test(ref) && !ref.includes("..");
const validRepoSlug = (slug) => typeof slug === "string" && TRUST_REPO_SLUG_RE.test(slug) && !slug.includes("..");

// The repository a PR belongs to, parsed from the `url` of `gh pr view` (https://host/owner/name/pull/N);
// "" when the url does not parse.
function repoSlugFromPrUrl(url) {
  const m = typeof url === "string" ? url.match(/^https:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/\d+(?:[/?#].*)?$/) : null;
  return m ? `${m[1]}/${m[2]}` : "";
}

// PURE: true when an effective-rules array (the branch rules endpoint payload) carries a pull_request rule.
function hasPullRequestRule(rules) {
  return Array.isArray(rules) && rules.some((r) => !!r && r.type === "pull_request");
}

// One TrustContext per command invocation. `resolve_slug` (pr-create only) lets the first governed
// leg resolve the slug with `gh repo view`; the trust read and the rules read are memoised on it.
function makeTrustContext({ transport, repo_dir, repo_slug = null, base_ref, resolve_slug = false }) {
  return { transport, repo_dir, repo_slug, base_ref, resolve_slug, trustMemo: null, rulesMemo: null };
}

function memoisedTrustRead(ctx) {
  if (!ctx.trustMemo) {
    const remote = ctx.transport === "remote";
    ctx.trustMemo = {
      read: commissaireTrust.readTrustFile({ repoDir: ctx.repo_dir, ref: ctx.base_ref, transport: remote ? "remote" : "local", ...(remote ? { repoSlug: ctx.repo_slug } : {}) }),
      attempted: remote ? "remote-base" : "local-ref",
    };
  }
  return ctx.trustMemo;
}

// Whether the base branch's effective rules require a pull request; one rules-endpoint call per invocation.
function memoisedPullRequestProtection(ctx) {
  if (!ctx.rulesMemo) {
    const r = runGh(["api", `repos/${ctx.repo_slug}/rules/branches/${ctx.base_ref}`], { timeout: 60000 });
    let rules;
    if (!r.error && r.status === 0) { try { rules = JSON.parse(r.stdout); } catch { rules = undefined; } }
    if (r.error || r.status !== 0) ctx.rulesMemo = { evidence: false, basis: `protection-unreadable: gh api failed (${r.error ? "gh unavailable" : `exit ${r.status}`})` };
    else if (!Array.isArray(rules)) ctx.rulesMemo = { evidence: false, basis: "protection-unreadable: unparseable rules JSON" };
    else if (!hasPullRequestRule(rules)) ctx.rulesMemo = { evidence: false, basis: "no-pull-request-rule" };
    else ctx.rulesMemo = { evidence: true, basis: "pinned grant read from a remote base that requires a pull request" };
  }
  return ctx.rulesMemo;
}

// The detail for a refusal faff decided without a verifyGrant answer. `from` is the governance probe
// (custody, and the signer only when it bound a key), `trust` the trust input once a read was attempted.
function faffLegDetail(leg, reason, from, trust, ctx) {
  return {
    leg, outcome: "absent-or-invalid", reason,
    custody: from ? from.custody : null,
    classification: null,
    signer_fingerprint: from && from.pk ? from.signer_fingerprint : null,
    verdict_seq: null,
    trust_source: trust ? trust.attempted : "not-read",
    base_ref: ctx ? ctx.base_ref : null,
    repo_slug: trust && ctx && ctx.transport === "remote" ? ctx.repo_slug : null,
    evidence: false,
    evidence_basis: reason,
  };
}

function verifiedLegDetail(leg, res, ctx) {
  const detail = {
    leg, outcome: res.outcome, reason: res.reason, custody: res.custody, classification: res.classification,
    signer_fingerprint: res.signer_fingerprint, verdict_seq: res.verdict_seq, trust_source: res.trust_source,
    base_ref: ctx.base_ref, repo_slug: ctx.transport === "remote" ? ctx.repo_slug : null,
    evidence: false, evidence_basis: "",
  };
  if (res.outcome !== "valid-grant") detail.evidence_basis = res.reason;
  else if (res.classification !== "pinned") detail.evidence_basis = "not-pinned";
  else if (res.trust_source !== "remote-base") detail.evidence_basis = "not-remote-base";
  else { const p = memoisedPullRequestProtection(ctx); detail.evidence = p.evidence; detail.evidence_basis = p.basis; }
  return detail;
}

const LEG_EFFECTS = { "pr-create": ["pr-create", "pr-create"], merge: ["merge", "merge"], "branch-delete": ["merge", "branch-delete"] };

function refuseLeg(detail) { return { state: "absent-or-invalid", detail }; }

// Check one leg. `deps` is the test seam for the two Commissaire calls; production callers omit it.
function checkLeg(runDir, issue, leg, target, trustCtx, deps) {
  const { resolveAdmittedKey: probe, verifyGrant: verify } = deps || commissaireVerify;
  const [step, kind] = LEG_EFFECTS[leg];
  const crashed = (e, from, trust) => {
    process.stderr.write(`faff: Commissaire ${leg} grant check failed unexpectedly (${e && e.name ? e.name : "Error"})\n`);
    return refuseLeg(faffLegDetail(leg, "verify-error", from, trust, trustCtx));
  };
  let first;
  try { first = probe(runDir, { not_read: true }); } catch (e) { return crashed(e, null, null); }
  if (first.custody == null) {
    if (first.failure != null) return refuseLeg(faffLegDetail(leg, first.failure, first, null, trustCtx));
    if (governanceRequiredSentinelPresent(runDir)) return refuseLeg(faffLegDetail(leg, "governance-required-sentinel", first, null, trustCtx));
    return { state: "not-applicable", detail: null };
  }
  if (!trustCtx) return refuseLeg(faffLegDetail(leg, "trust-context-missing", first, null, null));
  if (!validBaseRef(trustCtx.base_ref)) return refuseLeg(faffLegDetail(leg, "base-ref-invalid", first, null, trustCtx));
  if (trustCtx.transport === "remote") {
    if (!trustCtx.repo_slug && trustCtx.resolve_slug) {
      trustCtx.resolve_slug = false;
      try { trustCtx.repo_slug = ghRepoSlug(null); } catch (e) { return crashed(e, first, null); }
    }
    if (!validRepoSlug(trustCtx.repo_slug)) return refuseLeg(faffLegDetail(leg, "repo-slug-unresolved", first, null, trustCtx));
  }
  let trust;
  let res;
  try {
    trust = memoisedTrustRead(trustCtx);
    res = verify({ run_dir: runDir, unit_id: issue, step, effect: { kind, target }, trust });
  } catch (e) { return crashed(e, first, trust || { attempted: trustCtx.transport === "remote" ? "remote-base" : "local-ref" }); }
  if (res.outcome === "not-applicable") return refuseLeg(faffLegDetail(leg, "governance-changed-during-check", first, trust, trustCtx));
  return { state: res.outcome, detail: verifiedLegDetail(leg, res, trustCtx) };
}

function resolveCommissaireDecisionGrantDetail(runDir, issue, mergeTarget, trustCtx, deps) {
  return checkLeg(runDir, issue, "merge", mergeTarget, trustCtx, deps);
}
function resolvePrCreateGrantDetail(runDir, issue, prTarget, trustCtx, deps) {
  return checkLeg(runDir, issue, "pr-create", prTarget, trustCtx, deps);
}
function resolveBranchDeleteGrantDetail(runDir, issue, branchTarget, trustCtx, deps) {
  return checkLeg(runDir, issue, "branch-delete", branchTarget, trustCtx, deps);
}

// FAFF-828: the merge chokepoint leg. `mergeTarget` is the PR's base branch, never the grant's own.
function resolveCommissaireDecisionGrant(runDir, issue, mergeTarget, trustCtx, deps) {
  return resolveCommissaireDecisionGrantDetail(runDir, issue, mergeTarget, trustCtx, deps).state;
}

// FAFF-1118: the pr-create chokepoint leg; `prTarget` is the base branch the PR opens against.
function resolvePrCreateGrant(runDir, issue, prTarget, trustCtx, deps) {
  return resolvePrCreateGrantDetail(runDir, issue, prTarget, trustCtx, deps).state;
}

// FAFF-1118: the branch-delete coattail leg (grant at step="merge", kind "branch-delete");
// `branchTarget` is the head ref the delete removes.
function resolveBranchDeleteGrant(runDir, issue, branchTarget, trustCtx, deps) {
  return resolveBranchDeleteGrantDetail(runDir, issue, branchTarget, trustCtx, deps).state;
}

// The command-output view of a list of LegChecks: the `commissaire_grants` details (empty when every
// leg is not-applicable) and one blocker line per refusing leg.
function legReport(checks) {
  return {
    details: checks.filter((c) => c.detail).map((c) => c.detail),
    blockers: checks.filter((c) => c.state === "absent-or-invalid" && c.detail).map((c) => `Commissaire ${c.detail.leg} grant refused: ${c.detail.reason}`),
  };
}

// True when the run carries governance material or the FAFF-1140 sentinel (a probe failure counts as governed).
function runIsGoverned(runDir) {
  try {
    const k = commissaireVerify.resolveAdmittedKey(runDir, { not_read: true });
    return k.custody != null || k.failure != null || governanceRequiredSentinelPresent(runDir);
  } catch { return true; }
}

// FAFF-1118: the fail-closed AND monoid over three-valued grants. "valid-grant" iff EVERY input is
// "valid-grant"; "absent-or-invalid" if ANY input is "absent-or-invalid" (it DOMINATES); otherwise
// "not-applicable" iff ALL inputs are "not-applicable" (an ungoverned run, byte-for-byte). A
// non-uniform mix with no absent leg (e.g. valid + not-applicable, which per-run shared governance
// context makes unreachable in practice) fails closed to "absent-or-invalid".
function andGrants(...grants) {
  if (!grants.length) return "absent-or-invalid"; // a zero-arg AND is fail-closed, never a vacuous valid-grant
  if (grants.some((g) => g === "absent-or-invalid")) return "absent-or-invalid";
  if (grants.every((g) => g === "valid-grant")) return "valid-grant";
  if (grants.every((g) => g === "not-applicable")) return "not-applicable";
  return "absent-or-invalid";
}

// FAFF-1034 — per-covered-merge schema:2 suppression predicate. TRUE iff THIS (issue, merge) carries
// a covering, verified schema:3 grant, so the covered merge keeps a SINGLE declaration lineage
// (schema:3) and computeEscapes never double-counts. The commands apply `legCovered` to the merge
// leg's pre-merge LegCheck instead of re-checking, so a later gh degradation cannot flip the answer.
function legCovered(check) { return !!check && check.state === "valid-grant"; }

function mergeCoveredBySchema3Grant(runDir, issue, mergeTarget, trustCtx, deps) {
  try { return legCovered(resolveCommissaireDecisionGrantDetail(runDir, issue, mergeTarget, trustCtx, deps)); }
  catch { return false; }
}

// FAFF-1118 — the pr-create sibling: cmdPrCreate suppresses its own schema:2 trail on a covered create.
function prCreateCoveredBySchema3Grant(runDir, issue, prTarget, trustCtx, deps) {
  try { return legCovered(resolvePrCreateGrantDetail(runDir, issue, prTarget, trustCtx, deps)); }
  catch { return false; }
}

module.exports = { mergeEffectsFor, readDeclaredMergeEffects, warnUncoveredMergeObserves, autoDeclareMergeEffects, observeMergeEffects, governanceRequiredSentinelPresent, TRUST_BASE_REF_RE, TRUST_REPO_SLUG_RE, validBaseRef, validRepoSlug, repoSlugFromPrUrl, hasPullRequestRule, makeTrustContext, memoisedTrustRead, memoisedPullRequestProtection, faffLegDetail, verifiedLegDetail, LEG_EFFECTS, refuseLeg, checkLeg, resolveCommissaireDecisionGrantDetail, resolvePrCreateGrantDetail, resolveBranchDeleteGrantDetail, resolveCommissaireDecisionGrant, resolvePrCreateGrant, resolveBranchDeleteGrant, legReport, runIsGoverned, andGrants, legCovered, mergeCoveredBySchema3Grant, prCreateCoveredBySchema3Grant };
