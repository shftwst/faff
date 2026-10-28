// ===========================================================================
// === region:factory — merge-gate-pr-create — FAFF-1391: `faff pr-create`, the sole sanctioned PR-open path (FAFF-1118) ===
// ===========================================================================
// Split out of merge-gate.js (FAFF-1391), unchanged.

const { parseArgs, usageError } = require("./argv");
const { appendEffectEntries } = require("./effects");
const { runGh, resolveRunnerIdentityMemoised } = require("./merge-gate-gh");
const { makeTrustContext, resolvePrCreateGrantDetail, legReport, legCovered } = require("./merge-gate-effects");
const { gitRemoteEmpty } = require("./merge-gate-local");

// FAFF-1118: the flag grammar for `faff pr-create`. `--base` is the grant-coverage target (the
// base branch the PR opens against). The gh invocation is `--body-file` + a REQUIRED `--title` (gh
// demands a title in a non-interactive session; see the title guard in cmdPrCreate), so an
// ungoverned PR-open is identical to a raw titled gh pr create; a governed leg also forwards
// `--base` and `--repo` (FAFF-1212) so the checked target is the acted target.
const PR_CREATE_SPEC = { flags: {
  "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--base": { arity: 1 },
  "--body-file": { arity: 1 }, "--title": { arity: 1 }, "--level": { arity: 1 }, "--json": { arity: 0 },
} };

// FAFF-1118: the SOLE sanctioned `gh pr create` path. Mirrors merge-gate's shell shape — a
// fail-closed three-valued grant guard (resolvePrCreateGrant) inline BEFORE the effect (pr-create
// carries no CI/AC/review floor of its own, so a full decideFloor would be dead machinery), an
// ungoverned run byte-for-byte unaffected (grant not-applicable → open exactly as a raw gh pr
// create), and a covered-create schema:2 suppression. Git-only (no pushable remote) is a no-op
// exit 0. On absent-or-invalid, or a missing --title (required in a non-interactive session), it
// exits non-zero and opens NOTHING.
function cmdPrCreate(args) {
  const parsed = parseArgs(args, PR_CREATE_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff pr-create --run-dir DIR --issue ID --base BRANCH --body-file FILE [--title T] [--level L] [--json]");
  const get = (f) => (parsed.values[f] === undefined ? null : parsed.values[f]);
  const json = !!parsed.values["--json"];
  const runDir = get("--run-dir");
  const issue = get("--issue");
  const base = get("--base");
  const bodyFile = get("--body-file");
  const title = get("--title");
  if (!runDir || !issue || !base || !bodyFile) { process.stderr.write("faff pr-create: --run-dir, --issue, --base and --body-file are required\n"); return 2; }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) || issue.includes("..")) { process.stderr.write(`faff pr-create: --issue ${JSON.stringify(issue)} is not a valid issue id\n`); return 2; }

  const emit = (res, status) => {
    if (json) process.stdout.write(JSON.stringify(res) + "\n");
    else {
      console.log(`${res.verdict}${res.opened ? " (opened)" : ""}${res.pr_url ? ` — ${res.pr_url}` : ""}`);
      for (const b of (res.blockers || [])) console.log(`  ✗ ${b}`);
    }
    return status;
  };

  // (1) Git-only (no pushable remote) → no-op exit 0, mirroring Step 9b's git-only no-op.
  if (gitRemoteEmpty(process.cwd()) === true) return emit({ verdict: "no-op", opened: false, note: "git-only (no remote) — no PR to open" }, 0);

  // (2)+(3) the fail-closed pr-create chokepoint — a governed-but-uncovered create opens NOTHING.
  // FAFF-1212: governed legs read the trust file over gh from the remote base branch; the slug resolves once.
  const trustCtx = makeTrustContext({ transport: "remote", repo_dir: process.cwd(), base_ref: base, resolve_slug: true });
  const prLeg = resolvePrCreateGrantDetail(runDir, issue, base, trustCtx);
  const grantReport = legReport([prLeg]);
  const grantFields = grantReport.details.length ? { commissaire_grants: grantReport.details } : {};
  if (prLeg.state === "absent-or-invalid") {
    return emit({ verdict: "refuse", opened: false, blockers: [...grantReport.blockers, "Commissaire pr-create decision absent or invalid — a governed run must carry a covering signed pr-create grant for this base branch before the PR opens"], ...grantFields }, 1);
  }

  // (4) THE SOLE gh pr create invocation. On not-applicable (ungoverned) / valid-grant the PR opens.
  // gh pr create requires --title in a non-interactive session (no TTY to prompt, and it does not
  // derive one from the head commit) — a title-less call there dumps gh's usage text and opens
  // nothing. Fail loud with the remedy instead of shelling that guaranteed-to-fail call.
  if (!title) {
    return emit({ verdict: "refuse", opened: false, blockers: ["faff pr-create: --title is required (gh pr create needs --title in a non-interactive session); pass --title resolved from the build's pr_title/commit_subject convention"], ...grantFields }, 2);
  }
  const ghArgs = ["pr", "create", "--body-file", bodyFile, "--title", title];
  // FAFF-1212: on a governed leg the checked target is the acted target: open against the base the grant
  // covered, in the repository the trust file was read from. An ungoverned create keeps today's arguments.
  if (prLeg.state !== "not-applicable") ghArgs.push("--base", base, "--repo", trustCtx.repo_slug);
  const r = runGh(ghArgs, { timeout: 120000 }); // FAFF-1213: route through the single gh chokepoint
  if (r.status !== 0) {
    return emit({ verdict: "refuse", opened: false, blockers: [`gh pr create failed: ${(r.stderr || "").trim() || "non-zero exit"}`], ...grantFields }, 1);
  }

  // (5) declare + observe the schema:2 pr-create effect UNLESS a covering schema:3 grant already
  // owns the lineage (single schema:3 lineage for a covered create — mirrors merge-gate.js's own
  // covered-merge suppression). Every failure is swallowed — the PR is already open by now.
  if (!legCovered(prLeg)) {
    const effects = [{ kind: "pr-create", target: base, reversible: true }];
    // FAFF-1213: the acting GitHub identity rides the pr-create ENVELOPE (recordFields), never
    // the effect descriptor — normEffect canonicalises a descriptor to {kind,target,reversible},
    // so descriptor extras would be dropped. A NON-authoritative convenience copy ({login, source},
    // never the token); a resolution fault omits it.
    const prCreateEv = resolveRunnerIdentityMemoised(); // resolved once per process
    const prCreateActor = prCreateEv ? { login: prCreateEv.github_login ?? null, source: prCreateEv.credential_source } : null;
    const prCreateFields = prCreateActor ? { origin: "pr-create-auto", github_actor: prCreateActor } : { origin: "pr-create-auto" };
    try {
      const dec = appendEffectEntries(runDir, "declare", issue, "pr-create", effects, undefined, prCreateFields);
      if (dec.violations) process.stderr.write(`faff pr-create: effects ledger declare rejected internally-built descriptors: ${JSON.stringify(dec.violations)}\n`);
      const obs = appendEffectEntries(runDir, "observe", issue, "pr-create", effects);
      if (obs.violations) process.stderr.write(`faff pr-create: effects ledger observe rejected internally-built descriptors: ${JSON.stringify(obs.violations)}\n`);
    } catch (e) { process.stderr.write(`faff pr-create: effects ledger append failed (PR already open): ${e.message}\n`); }
  }
  // (6)
  return emit({ verdict: "opened", opened: true, pr_url: (r.stdout || "").trim(), ...grantFields }, 0);
}

module.exports = { PR_CREATE_SPEC, cmdPrCreate };
