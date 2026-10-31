// ===========================================================================
// === region:factory — merge-authorize — FAFF-1426: `faff merge authorize|observe`, the merge-step Commissaire grants from the run's own facts ===
//
// A governed graft that stops at PR open never reaches graft Step 10, where the merge-step grants
// were written by hand. This command writes them from the run itself: the level from the committed
// anchor at the head `merge-gate` will enforce, attendance from verificationUnattended at that level,
// and the holdout through readHoldout. No flag supplies any of the three, so a caller cannot present
// a `needs-human` holdout as `meets-spec`.
//
// It is the orchestrating step's half of ADR-0064's split: `merge-gate` keeps verifying grants and
// never writes them. Commissaire is reached only through its existing facade CLI (`faff commissaire
// effect declare|authorize|observe`), so no commissaire module changes and the signed records are the
// ones graft's prose wrote before. An ungoverned run writes nothing and exits 0.
//
// Exit codes: 0 granted (or ungoverned) / 1 denied, already merged, or observe without a merge record
// / 2 an input could not be established (usage, PR identity, anchor level, a facade call failing).
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

interface ParsedArgs { values: { [flag: string]: unknown }; positionals: string[]; errors: unknown[] }
interface ArgvApi {
  parseArgs(argv: string[], spec: unknown): ParsedArgs;
  usageError(errors: unknown[], usage: string): number;
}
interface GhResult { ok: boolean; data: unknown; stderr: string }
interface GhApi { ghJson(args: string[]): GhResult; ghRepoSlug(explicit: string | null): string | null }
interface AnchorLevel { level: string | null; status: string }
interface FloorApi {
  gitRun(cwd: string, args: string[], timeout?: number): { ok: boolean; stdout: string; status: number | null };
  resolveAnchorLevel(cwd: string, repo: string | null, runDir: string, issue: string, headSha: string): AnchorLevel;
  readHoldout(runDir: string, issue: string): string;
  mergeRecordPath(runDir: string, issue: string): string;
}
interface TrustContext { transport: string; base_ref: string }
interface LegDetail { verdict_seq: unknown; reason: unknown }
interface LegCheck { state: string; detail: LegDetail | null }
interface EffectsApi {
  runIsGoverned(runDir: string): boolean;
  repoSlugFromPrUrl(url: unknown): string;
  makeTrustContext(opts: { transport: string; repo_dir: string; repo_slug?: string | null; base_ref: string }): TrustContext;
  resolveCommissaireDecisionGrantDetail(runDir: string, issue: string, target: string, ctx: TrustContext): LegCheck;
  resolveBranchDeleteGrantDetail(runDir: string, issue: string, target: string, ctx: TrustContext): LegCheck;
}
interface LocalApi { resolveLocalBase(cwd: string, explicitBase: string | null): string | null }
interface ConfigResolveApi { verificationUnattended(ledger: unknown, cfg: unknown): boolean }
interface ConfigApi { loadConfig(root: string): unknown[] }
interface SharedInfraApi { readLedger(runDir: string): unknown }
interface EventsApi { parseJsonlEntries(text: string): unknown[] }
interface LedgerEffectsApi {
  effectTargetMatches(declared: unknown, observed: string): boolean;
  matchesUnit(rec: unknown, unit: string): boolean;
}

const argv: ArgvApi = require("./argv");
const gh: GhApi = require("./merge-gate-gh");
const floor: FloorApi = require("./merge-gate-floor");
const effects: EffectsApi = require("./merge-gate-effects");
const local: LocalApi = require("./merge-gate-local");
const configResolve: ConfigResolveApi = require("./config-resolve");
const config: ConfigApi = require("./config");
const sharedInfra: SharedInfraApi = require("./shared-infra");
const events: EventsApi = require("./events");
const ledgerEffects: LedgerEffectsApi = require("./effects");

const FAFF_BIN: string = path.resolve(__dirname, "..", "faff");
const STEP = "merge";
const USAGE = "usage: faff merge authorize|observe --run-dir DIR --issue ID (--pr N [--delete-branch] | --local [--base B] [--branch BR]) [--json]";
const MERGE_SPEC = {
  flags: {
    "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--pr": { arity: 1 }, "--base": { arity: 1 }, "--branch": { arity: 1 },
    "--delete-branch": { arity: 0 }, "--local": { arity: 0 }, "--json": { arity: 0 },
  },
  positionals: { min: 1, max: 1, name: "subcommand" },
};

type Effect = { kind: string; target: string };
interface Inputs { level: string; attended: boolean; holdout: string; base: string; head: string | null }
interface EffectOutcome { kind: string; target: string; verdict: string; reason: string; verdict_seq: number | null }
interface Target { base: string; head: string | null; headSha: string; merged: boolean; repo: string | null; trust: TrustContext }

function isRecord(v: unknown): v is { [k: string]: unknown } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null { return typeof v === "string" && v !== "" ? v : null; }

// A failure the command reports and exits on; `code` is the process exit code.
class MergeAuthorizeError extends Error {
  code: number;
  constructor(code: number, message: string) { super(message); this.code = code; }
}

// --- Inputs ---------------------------------------------------------------------------------------

// The PR or local-branch identity the grants target, resolved exactly as `merge-gate` resolves it.
function resolvePrTarget(pr: string, deleteBranch: boolean, cwd: string): Target {
  const hv = gh.ghJson(["pr", "view", pr, "--json", "headRefOid,headRefName,baseRefName,state,url"]);
  const data = isRecord(hv.data) ? hv.data : null;
  const headSha = data ? str(data["headRefOid"]) : null;
  if (!hv.ok || data === null || headSha === null) throw new MergeAuthorizeError(2, `cannot establish PR identity for #${pr}: ${hv.stderr || "no headRefOid"}`);
  const base = str(data["baseRefName"]);
  if (base === null) throw new MergeAuthorizeError(2, `cannot establish PR identity for #${pr}: response lacks baseRefName`);
  const head = str(data["headRefName"]);
  if (deleteBranch && head === null) throw new MergeAuthorizeError(2, `cannot establish PR identity for #${pr}: response lacks headRefName`);
  // FAFF-1212: the repository is the PR's own, from its url, never the checkout's remote.
  const slug = effects.repoSlugFromPrUrl(data["url"]);
  const repo = slug !== "" ? slug : gh.ghRepoSlug(null);
  const trust = effects.makeTrustContext({ transport: "remote", repo_dir: cwd, repo_slug: slug, base_ref: base });
  return { base, head, headSha, merged: data["state"] === "MERGED", repo, trust };
}

// The git-only form: the same base and branch `merge-gate --local` resolves, and no forge.
function resolveLocalTarget(baseFlag: string | null, branchFlag: string | null, cwd: string): Target {
  const branch = branchFlag ?? (() => { const r = floor.gitRun(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]); return r.ok ? r.stdout : null; })();
  if (branch === null || branch === "" || branch === "HEAD") throw new MergeAuthorizeError(2, "cannot resolve the current branch (detached HEAD?); pass --branch explicitly");
  const base = local.resolveLocalBase(cwd, baseFlag);
  if (base === null) throw new MergeAuthorizeError(2, "cannot resolve a local base branch (no --base, and neither main nor master exists locally)");
  if (base === branch) throw new MergeAuthorizeError(2, `branch and base are the same ref (${branch})`);
  const sha = floor.gitRun(cwd, ["rev-parse", branch]);
  if (!sha.ok || sha.stdout === "") throw new MergeAuthorizeError(2, `cannot resolve the head of branch ${branch}`);
  const merged = floor.gitRun(cwd, ["merge-base", "--is-ancestor", branch, base]).ok;
  const trust = effects.makeTrustContext({ transport: "local", repo_dir: cwd, base_ref: base });
  return { base, head: null, headSha: sha.stdout, merged, repo: null, trust };
}

// Level, attendance and holdout, each from the source `merge-gate` reads for the same decision.
// `faff pr open` (FAFF-1416) derives its pr-create grant inputs through this same function, so the
// two commands cannot disagree about a run's level, attendance or holdout.
function deriveGrantInputs(runDir: string, issue: string, at: { cwd: string; repo: string | null; headSha: string }): { level: string; attended: boolean; holdout: string } {
  const { cwd } = at;
  const anchor = floor.resolveAnchorLevel(cwd, at.repo, runDir, issue, at.headSha);
  if (anchor.status !== "ok" || anchor.level === null) {
    throw new MergeAuthorizeError(2, `no trusted committed anchor level for run ${path.basename(runDir)} issue ${issue} at head ${at.headSha} (${anchor.status}); re-anchor (graft Step 9b) so the head carries .faff/anchors/…/run-ledger.json`);
  }
  let ledger: unknown = null;
  try { ledger = sharedInfra.readLedger(runDir); } catch {
    ledger = null;
    process.stderr.write(`faff merge: note: ${path.join(runDir, "run-ledger.json")} is unreadable; attended is derived from the anchor level and config alone\n`);
  }
  const cfg = config.loadConfig(cwd)[0];
  // Attendance is judged at the level that will be enforced, so the grant's level and attended agree.
  const atAnchor = isRecord(ledger) ? { ...ledger, level: anchor.level } : { level: anchor.level };
  const attended = !configResolve.verificationUnattended(atAnchor, cfg);
  return { level: anchor.level, attended, holdout: floor.readHoldout(runDir, issue) };
}

function deriveInputs(runDir: string, issue: string, target: Target, cwd: string): Inputs {
  return { ...deriveGrantInputs(runDir, issue, { cwd, repo: target.repo, headSha: target.headSha }), base: target.base, head: target.head };
}

function effectSet(target: Target, deleteBranch: boolean): Effect[] {
  const set: Effect[] = [{ kind: "merge", target: target.base }];
  if (deleteBranch && target.head !== null) set.push({ kind: "branch-delete", target: target.head });
  return set;
}

// --- The run's ledger -----------------------------------------------------------------------------

function ledgerEntries(runDir: string): { [k: string]: unknown }[] {
  let text = "";
  try { text = fs.readFileSync(path.join(runDir, "declared-effects.jsonl"), "utf8"); } catch { return []; }
  return events.parseJsonlEntries(text).filter(isRecord);
}

// The producer the run was admitted under, from its seq-0 admission; the run id when absent.
function producerOf(runDir: string, entries: { [k: string]: unknown }[]): string {
  const admission = entries.find((e) => e["schema"] === 3 && e["kind_of_entry"] === "admission");
  return (admission && str(admission["producer_id"])) ?? path.basename(runDir);
}

function entryEffect(e: { [k: string]: unknown }): { [k: string]: unknown } | null {
  if (isRecord(e["effect"])) return e["effect"];
  const payload = e["payload"];
  return isRecord(payload) && isRecord(payload["effect"]) ? payload["effect"] : null;
}

// True when a schema:3 producer record of `kind_of_entry` at (issue, step merge) covers the effect.
function producerRecordCovers(entries: { [k: string]: unknown }[], issue: string, kindOfEntry: string, eff: Effect): boolean {
  return entries.some((e) => {
    if (e["schema"] !== 3 || e["kind_of_entry"] !== kindOfEntry || e["step"] !== STEP || !ledgerEffects.matchesUnit(e, issue)) return false;
    const recorded = entryEffect(e);
    return recorded !== null && recorded["kind"] === eff.kind && ledgerEffects.effectTargetMatches(recorded["target"], eff.target);
  });
}

// The signed verdict at `seq`, when it records exactly these inputs. A grant decided on other facts
// (a lower level, an earlier holdout) is not reused.
function grantRecordsInputs(entries: { [k: string]: unknown }[], seq: number, inputs: Inputs): boolean {
  const verdict = entries.find((e) => e["seq"] === seq && e["kind_of_entry"] === "effect-decision-verdict");
  const payload = verdict && isRecord(verdict["payload"]) ? verdict["payload"] : null;
  return payload !== null && payload["level"] === inputs.level && payload["attended"] === inputs.attended && payload["holdout"] === inputs.holdout;
}

// The covering grant's seq when the effect already holds a valid grant that records `inputs`.
function coveringGrantSeq(runDir: string, issue: string, eff: Effect, target: Target, inputs: Inputs, entries: { [k: string]: unknown }[]): number | null {
  const check = eff.kind === "merge"
    ? effects.resolveCommissaireDecisionGrantDetail(runDir, issue, eff.target, target.trust)
    : effects.resolveBranchDeleteGrantDetail(runDir, issue, eff.target, target.trust);
  const seq = check.detail ? check.detail.verdict_seq : null;
  if (check.state !== "valid-grant" || typeof seq !== "number") return null;
  return grantRecordsInputs(entries, seq, inputs) ? seq : null;
}

// --- The facade ------------------------------------------------------------------------------------

function facade(verb: string, runDir: string, producer: string, issue: string, extra: string[], input: unknown): string {
  const r = spawnSync(process.execPath, [FAFF_BIN, "commissaire", "effect", verb, "--run-dir", runDir, "--producer", producer, "--unit-id", issue, "--step", STEP, ...extra],
    { input: JSON.stringify(input), encoding: "utf8", timeout: 120000 });
  if (r.error || r.status !== 0) {
    const why = String(r.stderr || (r.error ? r.error.message : "") || `exit ${r.status}`).trim();
    throw new MergeAuthorizeError(2, `faff commissaire effect ${verb} failed: ${why}`);
  }
  return String(r.stdout || "");
}

function authorizeEffect(runDir: string, producer: string, issue: string, eff: Effect, inputs: Inputs): EffectOutcome {
  const out = facade("authorize", runDir, producer, issue, ["--level", inputs.level],
    { effect: { kind: eff.kind, target: eff.target }, level: inputs.level, attended: inputs.attended, holdout: inputs.holdout });
  const lines = out.trim().split("\n");
  let parsed: unknown = null;
  try { parsed = JSON.parse(lines[lines.length - 1] ?? ""); } catch { parsed = null; }
  if (!isRecord(parsed)) throw new MergeAuthorizeError(2, "faff commissaire effect authorize printed no verdict");
  const verdict = str(parsed["verdict"]) ?? "unknown";
  const seq = parsed["verdict_seq"];
  return { kind: eff.kind, target: eff.target, verdict, reason: str(parsed["reason"]) ?? "", verdict_seq: typeof seq === "number" ? seq : null };
}

// --- Commands --------------------------------------------------------------------------------------

interface Common { runDir: string; issue: string; deleteBranch: boolean; target: Target }

function authorize(c: Common, cwd: string): { inputs: Inputs; outcomes: EffectOutcome[]; written: boolean } {
  if (c.target.merged) throw new MergeAuthorizeError(1, "already-merged: no grant is written after the merge");
  const inputs = deriveInputs(c.runDir, c.issue, c.target, cwd);
  let entries = ledgerEntries(c.runDir);
  const producer = producerOf(c.runDir, entries);
  const outcomes: EffectOutcome[] = [];
  let written = false;
  for (const eff of effectSet(c.target, c.deleteBranch)) {
    const covered = coveringGrantSeq(c.runDir, c.issue, eff, c.target, inputs, entries);
    if (covered !== null) { outcomes.push({ kind: eff.kind, target: eff.target, verdict: "grant", reason: "already-granted", verdict_seq: covered }); continue; }
    if (!producerRecordCovers(entries, c.issue, "declare", eff)) {
      facade("declare", c.runDir, producer, c.issue, [], [{ kind: eff.kind, target: eff.target, reversible: true }]);
      written = true;
    }
    outcomes.push(authorizeEffect(c.runDir, producer, c.issue, eff, inputs));
    written = true;
    entries = ledgerEntries(c.runDir);
  }
  return { inputs, outcomes, written };
}

function observe(c: Common): { outcomes: EffectOutcome[]; written: boolean } {
  if (!fs.existsSync(floor.mergeRecordPath(c.runDir, c.issue))) {
    throw new MergeAuthorizeError(1, `no merge record at ${floor.mergeRecordPath(c.runDir, c.issue)}: an observe must witness a merge merge-gate confirmed`);
  }
  const entries = ledgerEntries(c.runDir);
  const producer = producerOf(c.runDir, entries);
  const outcomes: EffectOutcome[] = [];
  let written = false;
  for (const eff of effectSet(c.target, c.deleteBranch)) {
    if (producerRecordCovers(entries, c.issue, "observe", eff)) { outcomes.push({ kind: eff.kind, target: eff.target, verdict: "observed", reason: "already-observed", verdict_seq: null }); continue; }
    facade("observe", c.runDir, producer, c.issue, [], [{ kind: eff.kind, target: eff.target, reversible: true }]);
    outcomes.push({ kind: eff.kind, target: eff.target, verdict: "observed", reason: "observed", verdict_seq: null });
    written = true;
  }
  return { outcomes, written };
}

function emit(json: boolean, sub: string, governed: boolean, inputs: Inputs | null, outcomes: EffectOutcome[], written: boolean): void {
  if (json) { process.stdout.write(JSON.stringify({ governed, inputs, effects: outcomes, written }) + "\n"); return; }
  if (!governed) { process.stdout.write(`faff merge ${sub}: run is not governed; nothing written\n`); return; }
  if (inputs !== null) process.stdout.write(`inputs: level ${inputs.level}, attended ${inputs.attended}, holdout ${inputs.holdout}, base ${inputs.base}${inputs.head !== null ? `, head ${inputs.head}` : ""}\n`);
  for (const o of outcomes) process.stdout.write(`${o.kind} ${o.target}: ${o.verdict}${o.reason ? ` (${o.reason})` : ""}${o.verdict_seq !== null ? ` seq ${o.verdict_seq}` : ""}\n`);
}

function cmdMerge(args: string[]): number {
  const parsed = argv.parseArgs(args, MERGE_SPEC);
  if (parsed.errors.length) return argv.usageError(parsed.errors, USAGE);
  const get = (f: string): string | null => str(parsed.values[f]);
  const sub = parsed.positionals[0] ?? "";
  if (sub !== "authorize" && sub !== "observe") return argv.usageError([`unknown subcommand '${sub}'`], USAGE);
  const runDir = get("--run-dir");
  const issue = get("--issue");
  const pr = get("--pr");
  const isLocal = parsed.values["--local"] === true;
  const deleteBranch = parsed.values["--delete-branch"] === true;
  const json = parsed.values["--json"] === true;
  const fail = (msg: string): number => { process.stderr.write(`faff merge ${sub}: ${msg}\n${USAGE}\n`); return 2; };
  if (runDir === null || issue === null) return fail("--run-dir and --issue are required");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(issue) || issue.includes("..")) return fail(`--issue ${JSON.stringify(issue)} is not a valid issue id`);
  if ((pr === null) === !isLocal) return fail("pass exactly one of --pr N or --local");
  if (isLocal && deleteBranch) return fail("--delete-branch applies to --pr only; a local merge deletes no branch");
  if (!isLocal && (get("--base") !== null || get("--branch") !== null)) return fail("--base and --branch apply to --local only");
  if (pr !== null && !/^[0-9]+$/.test(pr)) return fail(`--pr ${JSON.stringify(pr)} is not a PR number`);

  const cwd = process.cwd();
  if (!effects.runIsGoverned(runDir)) { emit(json, sub, false, null, [], false); return 0; }
  try {
    const target = pr !== null ? resolvePrTarget(pr, deleteBranch, cwd) : resolveLocalTarget(get("--base"), get("--branch"), cwd);
    const common: Common = { runDir, issue, deleteBranch, target };
    if (sub === "observe") {
      const r = observe(common);
      emit(json, sub, true, null, r.outcomes, r.written);
      return 0;
    }
    const r = authorize(common, cwd);
    emit(json, sub, true, r.inputs, r.outcomes, r.written);
    const denied = r.outcomes.filter((o) => o.verdict !== "grant");
    if (denied.length) {
      process.stderr.write(`faff merge authorize: denied: ${denied.map((o) => `${o.kind} ${o.target} (${o.reason})`).join(", ")}\n`);
      return 1;
    }
    return 0;
  } catch (e) {
    if (e instanceof MergeAuthorizeError) { process.stderr.write(`faff merge ${sub}: ${e.message}\n`); return e.code; }
    throw e;
  }
}

module.exports = { cmdMerge, deriveGrantInputs, grantRecordsInputs, producerRecordCovers };
