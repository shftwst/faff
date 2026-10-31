// ===========================================================================
// === region:factory — run-open — FAFF-1437: beep-boop's run-start bracket as one verb ===
//
// `faff run open` runs the run-start bracket that used to live as prose in faff-beep-boop ("Run
// ledger" mint, "Owner stamp & heartbeat" at run start, the Commissaire admit): mint or adopt the
// run, enrich the owner, write the budget envelope once and snapshot the baseline, settle governance,
// then register the Stop hooks and start the sentry poller. Each step spawns the existing subcommand
// or calls an exported function, so no signing, accounting or minting logic moves here. Governance
// settles before anything long-lived starts: a run that is required to be governed and is not stops
// at exit 3 having started nothing.
// ===========================================================================

const fs: FsApi = require("node:fs");
const path: PathApi = require("node:path");
const childProcess: ChildProcessApi = require("node:child_process");

interface FsApi {
  readFileSync(file: string, encoding: "utf8"): string;
  writeFileSync(file: string, data: string): void;
  renameSync(from: string, to: string): void;
  rmSync(file: string, opts: { force: boolean }): void;
  mkdirSync(dir: string, opts: { recursive: boolean }): void;
}
interface PathApi {
  join(...parts: string[]): string;
  basename(p: string): string;
  resolve(...parts: string[]): string;
}
type SpawnResult = { status: number | null; stdout: string; stderr: string };
interface ChildProcessApi {
  spawnSync(cmd: string, args: string[], opts: { cwd: string; encoding: "utf8"; input: string; env: { [k: string]: string | undefined }; timeout?: number }): SpawnResult;
}
interface BudgetApi {
  readGovernanceConfig(root: string): unknown;
  envelopeFrom(cfg: unknown, flags: { until?: string; max_attempts?: string }): unknown;
}
interface HeartbeatApi {
  mutateLedgerUnderLock(runDir: string, mutate: (fresh: unknown) => unknown): unknown;
}
interface RuncheckApi {
  ownedByEnvPointer(runDir: string, env: { [k: string]: string | undefined }): boolean;
}
type ParsedArgs = { values: { [flag: string]: unknown }; errors: unknown[] };
interface ArgvApi {
  parseArgs(argv: string[], spec: unknown): ParsedArgs;
  usageError(errors: unknown[], usage: string): number;
}

const budgetApi: BudgetApi = require("./budget");
const heartbeatApi: HeartbeatApi = require("./heartbeat");
const runcheckApi: RuncheckApi = require("./runcheck");
const argvApi: ArgvApi = require("./argv");

const ENTRYPOINT = path.resolve(__dirname, "..", "faff");
const STATUS_TIMEOUT_MS = 30000;
const ADMIT_SCOPE = "merge,branch-delete,pr-create,push,label-write,file-write,tracker-write";

// --- Untyped-JSON helpers. ---

function isRecord(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function field(o: unknown, key: string): unknown {
  return isRecord(o) ? Reflect.get(o, key) : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function parseJsonObject(text: string): object | undefined {
  try {
    const v: unknown = JSON.parse(text);
    return isRecord(v) ? v : undefined;
  } catch {
    return undefined;
  }
}
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function exitDetail(r: SpawnResult): string {
  return r.status === null ? "timeout" : String(r.status);
}

// --- The result record (§3). ---

type Step = string;
interface OpenSteps {
  mint: Step;
  enrich: Step;
  envelope: Step;
  baseline: Step;
  governance: Step;
  poller: Step;
  hooks: Step;
}
interface OpenResult {
  run_dir: string | null;
  governance: string | null;
  fail_closed_cause: string | null;
  budget_envelope: object | null;
  steps: OpenSteps;
  hooks_report: string | null;
  faults: string[];
}

function emptySteps(): OpenSteps {
  return { mint: "skipped", enrich: "skipped", envelope: "skipped", baseline: "skipped", governance: "skipped", poller: "skipped", hooks: "skipped" };
}

// An exit-2 refusal: `runDir` is the minted or adopted dir when the refusal came after one existed.
class OpenRefusal extends Error {
  runDir: string | null;
  constructor(message: string, runDir: string | null) {
    super(message);
    this.runDir = runDir;
  }
}

// --- Dependencies (injected in tests). ---

interface Deps {
  faff(args: string[], opts: { cwd: string; input?: string; timeoutMs?: number }): SpawnResult;
  readConfig(root: string): unknown;
  mutateLedger(runDir: string, mutate: (fresh: unknown) => unknown): unknown;
  readLedger(runDir: string): object | undefined;
  writeSentinel(runDir: string, body: object): void;
  env: { [k: string]: string | undefined };
}

function realDeps(): Deps {
  return {
    faff: (args, opts) => {
      const spawnOpts: { cwd: string; encoding: "utf8"; input: string; env: { [k: string]: string | undefined }; timeout?: number } = { cwd: opts.cwd, encoding: "utf8", input: opts.input ?? "", env: process.env };
      if (opts.timeoutMs !== undefined) spawnOpts.timeout = opts.timeoutMs;
      const r = childProcess.spawnSync(process.execPath, [ENTRYPOINT, ...args], spawnOpts);
      return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    readConfig: (root) => budgetApi.readGovernanceConfig(root),
    mutateLedger: (runDir, mutate) => heartbeatApi.mutateLedgerUnderLock(runDir, mutate),
    readLedger: (runDir) => {
      try { return parseJsonObject(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8")); }
      catch { return undefined; }
    },
    writeSentinel: (runDir, body) => {
      const dir = path.join(runDir, "commissaire");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "governance-required.json");
      const tmp = `${file}.tmp-${process.pid}`;
      try {
        fs.writeFileSync(tmp, `${JSON.stringify(body)}\n`);
        fs.renameSync(tmp, file);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
    },
    env: process.env,
  };
}

// --- The envelope (§4.1 steps 0 and 3). ---

function ceilingsOf(envelope: unknown): { until: unknown; max_attempts: unknown } {
  const c = field(envelope, "ceilings");
  return { until: field(c, "until") ?? null, max_attempts: field(c, "max_attempts") ?? null };
}

// A recorded envelope is never rewritten; a flag that resolves to a different ceiling is refused.
function envelopeConflict(recorded: unknown, fresh: unknown, flags: OpenArgs): string | null {
  const r = ceilingsOf(recorded);
  const f = ceilingsOf(fresh);
  if (flags.until !== null && f.until !== r.until) return `until ${JSON.stringify(f.until)} differs from the recorded ${JSON.stringify(r.until)}`;
  if (flags.max !== null && f.max_attempts !== r.max_attempts) return `max_attempts ${JSON.stringify(f.max_attempts)} differs from the recorded ${JSON.stringify(r.max_attempts)}`;
  return null;
}

// --- The procedure (§4.1). ---

interface OpenArgs {
  mode: string | null;
  adoptRunDir: string | null;
  until: string | null;
  max: string | null;
  root: string;
  sessionId: string;
}

interface OpenOutcome {
  code: number;
  result: OpenResult;
  reason: string | null;
}

function runOpen(args: OpenArgs, deps: Deps): OpenOutcome {
  const steps = emptySteps();
  const faults: string[] = [];
  const result: OpenResult = { run_dir: null, governance: null, fail_closed_cause: null, budget_envelope: null, steps, hooks_report: null, faults };
  const root = args.root;
  // A spawn that throws is a failed step like any other non-zero exit.
  const faff = (argv: string[], opts: { input?: string; timeoutMs?: number } = {}): SpawnResult => {
    try { return deps.faff(argv, { cwd: root, ...opts }); }
    catch (e) { return { status: null, stdout: "", stderr: errText(e) }; }
  };
  const refuse = (reason: string, runDir: string | null): OpenOutcome => {
    faults.push(reason);
    result.run_dir = runDir;
    result.governance = null;
    result.fail_closed_cause = null;
    result.budget_envelope = null;
    return { code: 2, result, reason };
  };

  try {
    // 0. Flags and the envelope, before anything is minted.
    if (args.max !== null && !/^[1-9][0-9]*$/.test(args.max)) return refuse(`--max ${JSON.stringify(args.max)} is not a positive integer`, null);
    let cfg: unknown;
    try { cfg = deps.readConfig(root); }
    catch (e) { return refuse(`config unreadable: ${errText(e)}`, null); }
    const flags: { until?: string; max_attempts?: string } = {};
    if (args.until !== null) flags.until = args.until;
    if (args.max !== null) flags.max_attempts = args.max;
    const envelope = budgetApi.envelopeFrom(cfg, flags);
    const untilInvalid = field(envelope, "until_invalid");
    if (typeof untilInvalid === "string") return refuse(`until ${JSON.stringify(untilInvalid)} is not a valid HH:MM`, null);

    // 1. Mint, or adopt this session's own running run.
    let runDir: string;
    if (args.adoptRunDir !== null) {
      runDir = path.resolve(args.adoptRunDir);
      const ledger = deps.readLedger(runDir);
      if (ledger === undefined) return refuse(`adopt refused: ${path.join(runDir, "run-ledger.json")} is missing or not a JSON object`, null);
      const status = field(field(ledger, "owner"), "status");
      if (status !== "running") return refuse(`adopt refused: owner.status is ${JSON.stringify(status ?? null)}, not "running"`, null);
      if (!runcheckApi.ownedByEnvPointer(runDir, deps.env)) return refuse("adopt refused: $FAFF_RUN_DIR does not name this run", null);
    } else {
      const mint = faff(["run-ledger", "init-self-drain", "--mode", args.mode ?? "", "--root", root]);
      const minted = mint.stdout.trim().split("\n").pop() ?? "";
      if (mint.status !== 0 || minted === "") {
        steps.mint = `failed:${exitDetail(mint)}`;
        return refuse(`mint failed (exit ${exitDetail(mint)}): ${mint.stderr.trim()}`, null);
      }
      runDir = path.resolve(minted);
      if (deps.readLedger(runDir) === undefined) {
        steps.mint = "failed:no-ledger";
        return refuse(`mint printed ${JSON.stringify(minted)} but no readable run-ledger.json is there`, null);
      }
      steps.mint = "ok";
    }
    result.run_dir = runDir;
    const runId = path.basename(runDir);
    const ledgerWrite = (): void => {
      const r = faff(["events", "append", "--run", runId, "--root", root], { input: JSON.stringify({ phase: "run", type: "ledger-write" }) });
      if (r.status !== 0) faults.push("ledger-write-append-failed");
    };
    const mutate = (fn: (ledger: object) => boolean): boolean => {
      let changed = false;
      try {
        deps.mutateLedger(runDir, (fresh) => {
          if (!isRecord(fresh)) throw new Error("run-ledger.json is missing or not a JSON object");
          changed = fn(fresh);
          return changed ? fresh : null;
        });
      } catch (e) {
        throw new OpenRefusal(`ledger write refused in ${runDir}: ${errText(e)}`, runDir);
      }
      if (changed) ledgerWrite();
      return changed;
    };

    // 2. Enrich the owner with harness/model, only where absent; every other owner field is kept.
    const id = faff(["harness", "identify", "--json"]);
    const identity = id.status === 0 ? parseJsonObject(id.stdout) : undefined;
    if (identity === undefined) {
      steps.enrich = `failed:${exitDetail(id)}`;
      faults.push("harness-identify-failed");
    } else {
      mutate((ledger) => {
        const owner = field(ledger, "owner");
        if (!isRecord(owner)) return false;
        let changed = false;
        for (const key of ["harness", "model"]) {
          const value = field(identity, key);
          if (field(owner, key) === undefined && typeof value === "string") { Reflect.set(owner, key, value); changed = true; }
        }
        return changed;
      });
      steps.enrich = "ok";
    }

    // 3. The envelope, write-once, then the write-once baseline.
    // The locked write re-checks under the lock; whatever is on the ledger afterwards is what is reported.
    const wrote = mutate((ledger) => {
      const existing = field(ledger, "budget");
      const budget = isRecord(existing) ? existing : {};
      if (field(budget, "envelope") !== undefined) return false;
      Reflect.set(budget, "envelope", envelope);
      Reflect.set(budget, "measure_root", root);
      Reflect.set(ledger, "budget", budget);
      return true;
    });
    const recorded = field(field(deps.readLedger(runDir), "budget"), "envelope");
    if (!wrote) {
      const conflict = envelopeConflict(recorded, envelope, args);
      if (conflict !== null) return refuse(`budget envelope already set: ${conflict}`, runDir);
    }
    if (!isRecord(recorded)) return refuse(`budget envelope missing from ${path.join(runDir, "run-ledger.json")} after the write`, runDir);
    result.budget_envelope = recorded;
    steps.envelope = wrote ? "ok" : "skipped";
    const baseline = faff(["budget", "baseline", "--run-dir", runDir, "--root", root, "--session-id", args.sessionId]);
    if (baseline.status === 0) steps.baseline = "ok";
    else { steps.baseline = `failed:${exitDetail(baseline)}`; faults.push("budget-baseline-failed"); }

    // 4. Governance.
    const hooks = (): void => {
      const r = faff(["hooks-ensure", "--root", root]);
      const report = r.stdout.trim();
      result.hooks_report = report === "" ? null : report;
      if (r.status === 0) steps.hooks = "ok";
      else { steps.hooks = `failed:${exitDetail(r)}`; faults.push("hooks-ensure-failed"); }
    };
    const failClosed = (cause: string, governor: string | null): OpenOutcome => {
      const sentinel: { governance_required: boolean; governor?: string } = { governance_required: true };
      if (governor !== null) sentinel.governor = governor;
      try { deps.writeSentinel(runDir, sentinel); }
      catch (e) { faults.push(`governance-sentinel-write-failed: ${errText(e)}`); }
      const park = faff(["events", "append", "--run", runId, "--root", root], { input: JSON.stringify({ phase: "run", type: "park", issue: runId, data: { reason: "needs-human" } }) });
      if (park.status !== 0) faults.push("park-append-failed");
      if (faff(["andon", "pump", "--run-dir", runDir]).status !== 0) faults.push("andon-pump-failed");
      // A refused close write is a fault on the fail-closed outcome, never a change of exit class.
      try {
        mutate((ledger) => {
          const owner = field(ledger, "owner");
          if (isRecord(owner)) Reflect.set(owner, "status", "done");
          Reflect.set(ledger, "stop_reason", "governance-admit-failed");
          return true;
        });
      } catch (e) {
        faults.push(`owner-close-failed: ${errText(e)}`);
      }
      hooks();
      result.governance = "fail-closed";
      result.fail_closed_cause = cause;
      steps.governance = `failed:${cause}`;
      return { code: 3, result, reason: null };
    };

    const status = faff(["commissaire", "contract", "status", "--run-dir", runDir], { timeoutMs: STATUS_TIMEOUT_MS });
    const probe = status.status === 0 ? parseJsonObject(status.stdout.trim()) : undefined;
    const governed = field(probe, "governed");
    if (typeof governed !== "boolean") {
      faults.push(`commissaire-status-failed: ${status.status === null ? "timeout" : status.status !== 0 ? `exit ${status.status}` : "unparseable output"}`);
      return failClosed("commissaire-status-failed", null);
    }
    if (governed) {
      result.governance = "already-governed";
      steps.governance = "ok";
    } else {
      const admit = faff(["commissaire", "contract", "admit", "--run-dir", runDir, "--producer", runId, "--contract-revision", "faff-runner-v1", "--scope", ADMIT_SCOPE]);
      if (admit.status === 0) {
        result.governance = "admitted";
        steps.governance = "ok";
      } else {
        const admitOut = parseJsonObject(admit.stdout.trim());
        if (field(admitOut, "governor_unreachable") === true) return failClosed("governor-unreachable", str(field(admitOut, "governor")) ?? null);
        const req = faff(["commissaire", "admit-required", "--run-dir", runDir, "--json"]);
        const required = req.status === 0 ? field(parseJsonObject(req.stdout.trim()), "governance_required") : undefined;
        if (required !== false) return failClosed("governance-required", null);
        result.governance = "ungoverned-optional";
        steps.governance = `failed:${exitDetail(admit)}`;
        faults.push(`admit-failed:${exitDetail(admit)}`);
      }
    }

    // 5–6. Register the Stop hooks, then start the poller.
    hooks();
    const poller = faff(["sentry-poller", "start", "--run-dir", runDir]);
    if (poller.status === 0) steps.poller = "ok";
    else { steps.poller = `failed:${exitDetail(poller)}`; faults.push("sentry-poller-start-failed"); }
    return { code: 0, result, reason: null };
  } catch (e) {
    if (e instanceof OpenRefusal) return refuse(e.message, e.runDir);
    throw e;
  }
}

// --- The verb. ---

const OPEN_SPEC = {
  flags: {
    "--mode": { arity: 1 },
    "--adopt-run-dir": { arity: 1 },
    "--until": { arity: 1 },
    "--max": { arity: 1 },
    "--root": { arity: 1 },
    "--session-id": { arity: 1 },
    "--export": { arity: 0 },
    "--json": { arity: 0 },
  },
};
const OPEN_USAGE = "usage: faff run open (--mode M | --adopt-run-dir DIR) [--until HH:MM] [--max N] --root DIR --session-id ID [--export | --json]";

// POSIX single-quote shell quoting.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function cmdRunOpen(argv: string[], deps: Deps = realDeps()): number {
  const { values, errors } = argvApi.parseArgs(argv, OPEN_SPEC);
  if (errors.length) return argvApi.usageError(errors, OPEN_USAGE);
  const mode = str(values["--mode"]) ?? null;
  const adopt = str(values["--adopt-run-dir"]) ?? null;
  const root = str(values["--root"]);
  const sessionId = str(values["--session-id"]);
  const asExport = values["--export"] === true;
  const asJson = values["--json"] === true;
  const usage = (detail: string): number => argvApi.usageError([{ code: "usage", detail }], OPEN_USAGE);
  if ((mode === null) === (adopt === null)) return usage("exactly one of --mode M or --adopt-run-dir DIR is required");
  if (mode === "" || adopt === "") return usage("--mode and --adopt-run-dir take a non-empty value");
  if (root === undefined || root === "") return usage("--root DIR is required");
  if (sessionId === undefined || sessionId === "") return usage("--session-id ID is required");
  if (asExport && asJson) return usage("--export and --json are mutually exclusive");

  const outcome = runOpen({ mode, adoptRunDir: adopt, until: str(values["--until"]) ?? null, max: str(values["--max"]) ?? null, root: path.resolve(root), sessionId }, deps);
  const { code, result } = outcome;
  if (code === 2 && outcome.reason !== null) process.stderr.write(`faff run open: ${outcome.reason}${result.run_dir === null ? "" : ` (run dir ${result.run_dir})`}\n`);
  if (asJson) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    // Without --json the report and the faults go to stderr, so --export's stdout stays two eval-able lines.
    if (result.hooks_report !== null) process.stderr.write(`faff run open: hooks-ensure: ${result.hooks_report}\n`);
    if (code !== 2) for (const f of result.faults) process.stderr.write(`faff run open: fault: ${f}\n`);
  }
  if (!asJson && code !== 2 && result.run_dir !== null) {
    if (asExport) process.stdout.write(`export FAFF_RUN_DIR=${shellQuote(result.run_dir)}\nexport FAFF_SESSION_ID=${shellQuote(path.basename(result.run_dir))}\n`);
    else process.stdout.write(`${result.run_dir}\n`);
  }
  return code;
}

module.exports = { cmdRunOpen, runOpen, realDeps, shellQuote, OPEN_USAGE };
