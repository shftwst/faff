// ===========================================================================
// === region:factory — run-close — FAFF-1437: beep-boop's run-end bracket as one verb ===
//
// `faff run close` runs the run-end bracket that used to live as prose in faff-beep-boop ("At
// orchestrator exit", the governed conclude, the git-only anchor and bundle, the judge-trail mint,
// the `run-end` event and the andon pump). It refuses, writing nothing, while an admitted issue has
// no recorded outcome, except on a sentry abort that deliberately left its in-flight issue
// re-enterable. Each step spawns the existing subcommand; a failed step is a fault and the close
// proceeds, as the prose did.
// ===========================================================================

const fs: FsApi = require("node:fs");
const path: PathApi = require("node:path");
const childProcess: ChildProcessApi = require("node:child_process");

interface FsApi {
  readFileSync(file: string, encoding: "utf8"): string;
  realpathSync(file: string): string;
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
type ExpectedOwner = { epoch: number; session_id?: string };
interface HeartbeatApi {
  mutateLedgerUnderLock(runDir: string, mutate: (fresh: unknown) => unknown, expectedOwner: ExpectedOwner): unknown;
}
type Audit = { undispatched: string[]; invalid_outcomes: string[] };
interface RuncheckApi {
  auditLedger(data: unknown, label: string): Audit;
}
type ParsedArgs = { values: { [flag: string]: unknown }; errors: unknown[] };
interface ArgvApi {
  parseArgs(argv: string[], spec: unknown): ParsedArgs;
  usageError(errors: unknown[], usage: string): number;
}

const heartbeatApi: HeartbeatApi = require("./heartbeat");
const runcheckApi: RuncheckApi = require("./runcheck");
const argvApi: ArgvApi = require("./argv");

const ENTRYPOINT = path.resolve(__dirname, "..", "faff");
const STATUS_TIMEOUT_MS = 30000;

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
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
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
// The owner-epoch write fence (heartbeat.js ownerEpochFenceStale): the locked write yields, writing
// nothing, when the on-disk owner's epoch or session moved on since this verb read it.
function expectedOwnerOf(ledger: unknown): ExpectedOwner {
  const owner = field(ledger, "owner");
  const epoch = Number(field(owner, "epoch") ?? 0);
  const session = str(field(owner, "session_id"));
  const out: ExpectedOwner = { epoch: Number.isFinite(epoch) ? epoch : 0 };
  if (session !== undefined) out.session_id = session;
  return out;
}

function exitDetail(r: SpawnResult): string {
  return r.status === null ? "timeout" : String(r.status);
}

// --- Stop tokens (§3). ---

const PLAIN_TOKENS = ["queue-drained", "all-remaining-parked", "sentry-abort", "converged/both-dry", "non-convergence", "product-incomplete", "governance-admit-failed"];
const BUDGET_DIMS = ["until", "max_attempts", "tokens", "cost", "window"];

function validStopToken(token: string): boolean {
  if (PLAIN_TOKENS.includes(token)) return true;
  const m = /^budget-(hit|escalated)\(([^()]+)\)$/.exec(token);
  const list = m === null ? undefined : m[2];
  if (list === undefined) return false;
  const dims = list.split(",");
  return dims.every((d) => BUDGET_DIMS.includes(d));
}

// --- The result record (§3). ---

type ConcludeEntry = { issue: string; reconcile_exit: number | null; conclude_exit: number | null };
interface CloseSteps {
  run_end: string;
  owner_close: string;
  poller_stop: string;
  governance_probe: string;
  conclude: ConcludeEntry[] | string;
  anchor_run: string;
  anchor_commit: string;
  bundle_publish: string;
  judge_trail: string;
  andon: string;
}
interface CloseResult {
  closed: boolean;
  undispatched: string[];
  abort_exempt: boolean;
  owner_status: string | null;
  steps: CloseSteps;
  faults: string[];
}

function skippedSteps(): CloseSteps {
  return { run_end: "skipped", owner_close: "skipped", poller_stop: "skipped", governance_probe: "skipped", conclude: "skipped", anchor_run: "skipped", anchor_commit: "skipped", bundle_publish: "skipped", judge_trail: "skipped", andon: "skipped" };
}

class CloseUsageError extends Error {}

// --- The run dir, the ledger and the root (shared with `run checkpoint`'s rule). ---

function canonical(p: string): string {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function readLedger(runDir: string): object {
  const file = path.join(runDir, "run-ledger.json");
  let text: string;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { throw new CloseUsageError(`cannot read ${file}: ${errText(e)}`); }
  const ledger = parseJsonObject(text);
  if (ledger === undefined) throw new CloseUsageError(`${file} is not a JSON object`);
  return ledger;
}

// root := the ledger's pinned measure_root, else --root, else the repo root above the run dir. A
// disagreement between the two is `root-drift`; neither present is `root-inferred`.
function resolveRoot(runDir: string, rootFlag: string | null, ledger: object): { root: string; faults: string[] } {
  const pinned = str(field(field(ledger, "budget"), "measure_root")) ?? null;
  const faults: string[] = [];
  let root: string;
  if (pinned !== null) {
    root = pinned;
    if (rootFlag !== null && canonical(rootFlag) !== canonical(pinned)) faults.push("root-drift");
  } else if (rootFlag !== null) {
    root = rootFlag;
  } else {
    root = path.resolve(runDir, "..", "..", "..");
    faults.push("root-inferred");
  }
  const expected = path.join(canonical(root), ".faff", "runs", path.basename(path.resolve(runDir)));
  if (canonical(runDir) !== expected) {
    throw new CloseUsageError(`run dir ${runDir} is not ${path.join(root, ".faff", "runs", path.basename(runDir))}`);
  }
  return { root, faults };
}

// --- Dependencies (injected in tests). ---

interface Deps {
  faff(args: string[], opts: { cwd: string; input?: string; timeoutMs?: number }): SpawnResult;
  git(args: string[], cwd: string): SpawnResult;
  mutateLedger(runDir: string, mutate: (fresh: unknown) => unknown, expectedOwner: ExpectedOwner): unknown;
}

function spawn(cmd: string, args: string[], cwd: string, input: string, timeoutMs?: number): SpawnResult {
  const opts: { cwd: string; encoding: "utf8"; input: string; env: { [k: string]: string | undefined }; timeout?: number } = { cwd, encoding: "utf8", input, env: process.env };
  if (timeoutMs !== undefined) opts.timeout = timeoutMs;
  const r = childProcess.spawnSync(cmd, args, opts);
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function realDeps(): Deps {
  return {
    faff: (args, opts) => spawn(process.execPath, [ENTRYPOINT, ...args], opts.cwd, opts.input ?? "", opts.timeoutMs),
    git: (args, cwd) => spawn("git", args, cwd, ""),
    mutateLedger: (runDir, mutate, expectedOwner) => heartbeatApi.mutateLedgerUnderLock(runDir, mutate, expectedOwner),
  };
}

// --- The procedure (§4.2). ---

interface CloseArgs {
  runDir: string;
  stopReason: string;
  gitOnly: boolean;
  root: string | null;
  sessionId: string | null;
}

interface CloseOutcome {
  code: number;
  result: CloseResult;
  reason: string | null;
}

function countOutcomes(ledger: object, state: string): number {
  const outcomes = field(ledger, "outcomes");
  return isRecord(outcomes) ? Object.values(outcomes).filter((v) => v === state).length : 0;
}

function runClose(args: CloseArgs, deps: Deps): CloseOutcome {
  const faults: string[] = [];
  const usage = (reason: string): CloseOutcome => {
    faults.push(reason);
    return { code: 2, result: { closed: false, undispatched: [], abort_exempt: false, owner_status: null, steps: skippedSteps(), faults }, reason };
  };

  // 1. The token, the root, the ledger, and a prior close with a different token.
  if (!validStopToken(args.stopReason)) return usage(`unknown stop reason ${JSON.stringify(args.stopReason)}`);
  let ledger: object;
  let root: string;
  try {
    ledger = readLedger(args.runDir);
    const resolved = resolveRoot(args.runDir, args.root, ledger);
    root = resolved.root;
    faults.push(...resolved.faults);
  } catch (e) {
    if (e instanceof CloseUsageError) return usage(e.message);
    throw e;
  }
  const runId = path.basename(path.resolve(args.runDir));
  const runDir = path.join(root, ".faff", "runs", runId);
  const prior = str(field(ledger, "stop_reason")) ?? null;
  if (prior !== null && prior !== args.stopReason) return usage(`run already closed as ${prior}`);
  const ownerRead = str(field(field(ledger, "owner"), "status")) ?? null;

  // 2. Completeness.
  let audit: Audit;
  try { audit = runcheckApi.auditLedger(ledger, runId); }
  catch (e) { return usage(`malformed ledger: ${errText(e)}`); }
  const refuse = (undispatched: string[]): CloseOutcome => ({ code: 3, result: { closed: false, undispatched, abort_exempt: false, owner_status: ownerRead, steps: skippedSteps(), faults }, reason: null });
  if (audit.invalid_outcomes.length > 0) {
    faults.push(`invalid outcomes: ${audit.invalid_outcomes.join(", ")}`);
    return refuse(audit.undispatched);
  }
  let abortExempt = false;
  if (audit.undispatched.length > 0) {
    const aborted = field(field(ledger, "abort"), "status") === "aborted-resumable" || ownerRead === "aborted-resumable";
    abortExempt = args.stopReason === "sentry-abort" && aborted;
    if (!abortExempt) return refuse(audit.undispatched);
  }

  const steps = skippedSteps();
  // A spawn that throws is a failed step like any other non-zero exit.
  const faff = (argv: string[], opts: { input?: string; timeoutMs?: number } = {}): SpawnResult => {
    try { return deps.faff(argv, { cwd: root, ...opts }); }
    catch (e) { return { status: null, stdout: "", stderr: errText(e) }; }
  };
  const git = (argv: string[]): SpawnResult => {
    try { return deps.git(argv, root); }
    catch (e) { return { status: null, stdout: "", stderr: errText(e) }; }
  };
  const record = (step: keyof CloseSteps, r: SpawnResult, fault: string): boolean => {
    if (r.status === 0) { Reflect.set(steps, step, "ok"); return true; }
    Reflect.set(steps, step, `failed:${exitDetail(r)}`);
    faults.push(fault);
    return false;
  };

  // 3. The run-end event, token-tagged.
  const sessionArgs = args.sessionId === null ? [] : ["--session-id", args.sessionId];
  const runEnd = { phase: "run", type: "run-end", data: { stop_reason: args.stopReason, shipped: countOutcomes(ledger, "shipped"), parked: countOutcomes(ledger, "parked") } };
  record("run_end", faff(["events", "append", "--run", runId, "--root", root, "--tokens", ...sessionArgs], { input: JSON.stringify(runEnd) }), "run-end-append-failed");

  // 4. The owner close and stop_reason, one locked write; an aborted-resumable owner keeps its status.
  // The status is reported only once the write has landed; a refused or yielded write is a post-read
  // write failure and exits 2 with nothing after it run.
  let staged: string | null = null;
  let writeError: string | null = null;
  try {
    const res = deps.mutateLedger(runDir, (fresh) => {
      if (!isRecord(fresh)) throw new Error("run-ledger.json is missing or not a JSON object");
      Reflect.set(fresh, "stop_reason", args.stopReason);
      const owner = field(fresh, "owner");
      if (isRecord(owner)) {
        if (field(owner, "status") !== "aborted-resumable") Reflect.set(owner, "status", "done");
        staged = str(field(owner, "status")) ?? null;
      }
      return fresh;
    }, expectedOwnerOf(ledger));
    if (field(res, "yielded") === true) writeError = "a newer owner holds the run";
  } catch (e) {
    writeError = errText(e);
  }
  if (writeError !== null) {
    steps.owner_close = "failed:write";
    const reason = `owner close refused in ${runDir}: ${writeError}`;
    faults.push(reason);
    return { code: 2, result: { closed: false, undispatched: [], abort_exempt: false, owner_status: null, steps, faults }, reason };
  }
  const ownerStatus: string | null = staged;
  steps.owner_close = "ok";
  const lw = faff(["events", "append", "--run", runId, "--root", root], { input: JSON.stringify({ phase: "run", type: "ledger-write" }) });
  if (lw.status !== 0) faults.push("ledger-write-append-failed");

  // 5. The poller (belt; it also self-stops on the close).
  record("poller_stop", faff(["sentry-poller", "stop", "--run-dir", runDir]), "sentry-poller-stop-failed");

  // 6. Governed conclude. A probe that cannot answer is treated as governed: on an ungoverned run
  // reconcile only reads and conclude refuses with no write.
  const status = faff(["commissaire", "contract", "status", "--run-dir", runDir], { timeoutMs: STATUS_TIMEOUT_MS });
  const governed = status.status === 0 ? field(parseJsonObject(status.stdout.trim()), "governed") : undefined;
  if (typeof governed === "boolean") steps.governance_probe = "ok";
  else {
    steps.governance_probe = `failed:${status.status === null ? "timeout" : status.status !== 0 ? String(status.status) : "unparseable"}`;
    faults.push("governance-probe-failed");
  }
  if (governed !== false) {
    const admitted = field(ledger, "admitted");
    // Under the abort exemption the undispatched issues stay unconcluded, so the resume concludes them
    // at the real close (operator decision A, 2026-10-31): a conclusion written now would come back as an
    // idempotent repeat for the resumed merge and skip its grant-coverage check.
    const resumable = abortExempt ? audit.undispatched : [];
    const issues = isStringArray(admitted) ? [...new Set(admitted)].filter((i) => !resumable.includes(i)) : [];
    const entries: ConcludeEntry[] = [];
    for (const issue of issues) {
      const rec = faff(["commissaire", "effect", "reconcile", "--run-dir", runDir, "--unit-id", issue]);
      const con = faff(["commissaire", "verdict", "conclude", "--run-dir", runDir, "--unit-id", issue]);
      entries.push({ issue, reconcile_exit: rec.status, conclude_exit: con.status });
      if (rec.status !== 0) faults.push(`reconcile-failed:${issue}`);
      if (con.status !== 0) faults.push(`conclude-failed:${issue}`);
    }
    steps.conclude = entries;
  }

  // 7. The git-only run-level anchor, its path-limited commit, and the run-close bundle.
  if (args.gitOnly) {
    if (record("anchor_run", faff(["events", "anchor-run", "--run-dir", runDir]), "anchor-run-failed")) {
      const anchorPath = path.join(".faff", "anchors", runId);
      const add = git(["add", "--", anchorPath]);
      const staged = add.status === 0 ? git(["diff", "--cached", "--quiet", "--", anchorPath]) : add;
      if (add.status !== 0) { steps.anchor_commit = `failed:${exitDetail(add)}`; faults.push("anchor-commit-failed"); }
      else if (staged.status === 0) steps.anchor_commit = "ok";
      else record("anchor_commit", git(["commit", "-m", `chore(anchor): run-level evidence anchor for ${runId}`, "--", anchorPath]), "anchor-commit-failed");
      record("bundle_publish", faff(["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "run-close", "--boundary-key", "run-close"]), "bundle-publish-failed");
    }
  }

  // 8–9. The judge trail on every run, then andon (fail-open).
  record("judge_trail", faff(["judge-trail", "mint", "--run-dir", runDir]), "judge-trail-failed");
  record("andon", faff(["andon", "pump", "--run-dir", runDir]), "andon-pump-failed");

  return { code: 0, result: { closed: true, undispatched: abortExempt ? audit.undispatched : [], abort_exempt: abortExempt, owner_status: ownerStatus, steps, faults }, reason: null };
}

// --- The verb. ---

const CLOSE_SPEC = {
  flags: {
    "--run-dir": { arity: 1 },
    "--stop-reason": { arity: 1 },
    "--git-only": { arity: 0 },
    "--root": { arity: 1 },
    "--session-id": { arity: 1 },
    "--json": { arity: 0 },
  },
};
const CLOSE_USAGE = "usage: faff run close --run-dir DIR --stop-reason TOKEN [--git-only] [--root DIR] [--session-id ID] [--json]";

function cmdRunClose(argv: string[], deps: Deps = realDeps()): number {
  const { values, errors } = argvApi.parseArgs(argv, CLOSE_SPEC);
  if (errors.length) return argvApi.usageError(errors, CLOSE_USAGE);
  const runDir = str(values["--run-dir"]);
  const stopReason = str(values["--stop-reason"]);
  if (runDir === undefined || runDir === "") return argvApi.usageError([{ code: "missing-required", detail: "--run-dir DIR is required" }], CLOSE_USAGE);
  if (stopReason === undefined || stopReason === "") return argvApi.usageError([{ code: "missing-required", detail: "--stop-reason TOKEN is required" }], CLOSE_USAGE);
  const outcome = runClose({ runDir, stopReason, gitOnly: values["--git-only"] === true, root: str(values["--root"]) ?? null, sessionId: str(values["--session-id"]) ?? null }, deps);
  const { code, result } = outcome;
  if (outcome.reason !== null) process.stderr.write(`faff run close: ${outcome.reason}\n`);
  if (values["--json"] === true) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (code === 0) process.stdout.write(`run close: closed as ${stopReason}${result.abort_exempt ? ` (abort exemption; undispatched: ${result.undispatched.join(", ")})` : ""}${result.faults.length ? `\n${result.faults.map((f) => `fault: ${f}`).join("\n")}` : ""}\n`);
  else if (code === 3) process.stdout.write(`run close: refused — undispatched: ${result.undispatched.join(", ") || "(none)"}${result.faults.length ? `\n${result.faults.map((f) => `fault: ${f}`).join("\n")}` : ""}\n`);
  return code;
}

module.exports = { cmdRunClose, runClose, realDeps, validStopToken, CLOSE_USAGE };
