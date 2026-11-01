// ===========================================================================
// === region:factory — spec-review-hold — FAFF-1417: prep's outage and turn-budget holds as one verb ===
//
// `faff spec-review hold` runs the two hold dispositions faff-prep carried as pseudocode: the
// provider-outage hold and the turn-budget hand-back. It reads and writes only the hold store
// `.faff/resume/<ISSUE>/spec-review-hold.json`, under the resume-store issue lock (a concurrent
// `resume-store stash` copies that file, so an unlocked write in between is lost). The decision is
// the pure `decideHold`; the label write, the hold notice comment and the park protocol are
// returned for the skill to perform. A corrupt store parks and is renamed aside, never silently
// read as zero; an exhausted counter parks; the two counters never reset each other.
// ===========================================================================

const fs: FsApi = require("node:fs");
const path: PathApi = require("node:path");

interface FsApi {
  readFileSync(file: string, encoding: "utf8"): string;
  writeFileSync(file: string, data: string): void;
  renameSync(from: string, to: string): void;
  mkdirSync(dir: string, opts: { recursive: boolean }): void;
  rmSync(file: string, opts: { force: boolean }): void;
}
interface PathApi {
  join(...parts: string[]): string;
}
type Lock = { stage: string; nonce: string };
interface ResumeStoreApi {
  takeLock(storeRoot: string, issue: string): Lock | null;
  releaseLock(lock: Lock): void;
  recover(storeRoot: string, issue: string): void;
}
interface RoundApi {
  outageAttempt(records: Map<number, unknown>, n: number, heldAtRound: number): number;
  configValue(root: string, key: string): string | undefined;
  parseLimit(raw: string | undefined, name: string): number;
  RoundFault: new (message: string) => Error;
}
interface ConvergenceApi {
  roundFilesInDir(dir: string): { n: number; path: string }[];
}
interface ChurnApi {
  readRoundRecord(p: string): { record?: unknown; missing?: boolean; malformed?: string };
}
interface SharedInfraApi {
  findRoot(start?: string): string;
}
type ParsedArgs = { values: { [flag: string]: unknown }; errors: unknown[] };
interface ArgvApi {
  parseArgs(argv: string[], spec: unknown): ParsedArgs;
  usageError(errors: unknown[], usage: string): number;
}

const resumeStore: ResumeStoreApi = require("./resume-store");
const roundApi: RoundApi = require("./spec-review-round");
const convergenceApi: ConvergenceApi = require("./spec-review-convergence");
const churnApi: ChurnApi = require("./spec-review-churn");
const sharedInfra: SharedInfraApi = require("./shared-infra");
const argvApi: ArgvApi = require("./argv");

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
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

// A fault the verb maps to exit 2; a held lock maps to exit 4.
class HoldFault extends Error {}
class LockBusy extends Error {}

// --- Vocabulary (§3, §4.3, §4.4). ---

type Cause = "outage" | "turn-budget";
type Mode = "interactive" | "autonomous";
const STORE_FILE = "spec-review-hold.json";
const LABEL = "faff-awaiting-spec-review";
const COUNTER: { [c in Cause]: string } = { outage: "outage_holds", "turn-budget": "turn_budget_holds" };
const TOKEN: { [c in Cause]: string } = { outage: "spec-review-held", "turn-budget": "spec-review-pending" };
const LIMIT_KEY: { [c in Cause]: string } = { outage: "prep.spec_review_outage_hold_limit", "turn-budget": "prep.spec_review_turn_budget_hold_limit" };
const ISSUE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function exhaustedCause(cause: Cause, count: number): string {
  return cause === "outage"
    ? `spec-review provider outage, ${count} held drains exhausted`
    : `spec-review turn-budget: ${count} held drains exhausted — spec may be too large or a backend degraded`;
}
function corruptCause(cause: Cause): string {
  return `spec-review-hold.json corrupt — cannot read ${COUNTER[cause]}`;
}
function notice(cause: Cause, count: number, limit: number): string {
  const lead = cause === "outage" ? "spec-review provider unavailable" : "spec-review did not finish this turn";
  return `${lead}; spec attached and held; attempt ${count}/${limit}; auto-resumes at review on the next drain`;
}

type LabelOp = { op: "add" | "remove"; label: string };
type StoreView = { state: "absent" | "valid" | "corrupt"; cause: string | null; outage_holds: number | null; turn_budget_holds: number | null; held_at_round: number | null };
type HoldResult = {
  action: "hold" | "park" | "surface" | "read" | "cleared";
  token: string | null;
  cause: string | null;
  holds: number | null;
  limit: number | null;
  label_ops: LabelOp[];
  comment: string | null;
  store_path: string;
  store: StoreView | null;
};

// --- The pure decision (§4.4 step 3). ---

type StoreRead = { state: "absent" } | { state: "valid"; value: object } | { state: "corrupt" };
type HoldDecision =
  | { kind: "corrupt"; cause: string }
  | { kind: "exhausted"; cause: string; holds: number }
  | { kind: "hold"; holds: number; write: { [k: string]: unknown } };

// decideHold(store, cause, limit, extra) -> what the locked step does. `extra` carries the
// optional fields the write adds (kind, outaged_lenses, pinned_reviewer, held_at_round, held_at).
function decideHold(store: StoreRead, cause: Cause, limit: number, extra: { [k: string]: unknown }): HoldDecision {
  if (store.state === "corrupt") return { kind: "corrupt", cause: corruptCause(cause) };
  const current: { [k: string]: unknown } = {};
  if (store.state === "valid") for (const [k, v] of Object.entries(store.value)) current[k] = v;
  const counter = COUNTER[cause];
  const raw = current[counter];
  if (raw !== undefined && !isNonNegInt(raw)) return { kind: "corrupt", cause: corruptCause(cause) };
  const holds = isNonNegInt(raw) ? raw : 0;
  if (holds + 1 >= limit) return { kind: "exhausted", cause: exhaustedCause(cause, holds + 1), holds: holds + 1 };
  const write: { [k: string]: unknown } = { ...current, cause, [counter]: holds + 1 };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) write[k] = v;
  return { kind: "hold", holds: holds + 1, write };
}

// readStore(text) classifies a store body: unparseable or not an object is corrupt. A counter
// that is present but not an integer >= 0 is corrupt for that counter's cause (decideHold) and
// for --read.
function classify(text: string | null): StoreRead {
  if (text === null) return { state: "absent" };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { state: "corrupt" };
  }
  return isRecord(v) ? { state: "valid", value: v } : { state: "corrupt" };
}

function view(store: StoreRead): StoreView {
  if (store.state !== "valid") return { state: store.state, cause: null, outage_holds: null, turn_budget_holds: null, held_at_round: null };
  const o = field(store.value, "outage_holds");
  const t = field(store.value, "turn_budget_holds");
  if ((o !== undefined && !isNonNegInt(o)) || (t !== undefined && !isNonNegInt(t))) {
    return { state: "corrupt", cause: null, outage_holds: null, turn_budget_holds: null, held_at_round: null };
  }
  const h = field(store.value, "held_at_round");
  return {
    state: "valid",
    cause: str(field(store.value, "cause")) ?? "outage",
    outage_holds: isNonNegInt(o) ? o : null,
    turn_budget_holds: isNonNegInt(t) ? t : null,
    held_at_round: isNonNegInt(h) ? h : null,
  };
}

// --- Disk. ---

function readText(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (e) {
    if (field(e, "code") === "ENOENT") return null;
    throw new HoldFault(`${p} could not be read: ${errText(e)}`);
  }
}

function writeJsonAtomic(p: string, value: unknown): void {
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, p);
}

function withLock<T>(storeRoot: string, issue: string, body: () => T): T {
  fs.mkdirSync(storeRoot, { recursive: true });
  const lock = resumeStore.takeLock(storeRoot, issue);
  if (lock === null) throw new LockBusy(`the resume-store lock for ${issue} is held`);
  try {
    resumeStore.recover(storeRoot, issue);
    return body();
  } finally {
    resumeStore.releaseLock(lock);
  }
}

function readRecords(dir: string): Map<number, unknown> {
  const out = new Map<number, unknown>();
  let files: { n: number; path: string }[];
  try {
    files = convergenceApi.roundFilesInDir(dir);
  } catch {
    return out;
  }
  for (const f of files) {
    const r = churnApi.readRoundRecord(f.path);
    if (r.record !== undefined) out.set(f.n, r.record);
    else throw new HoldFault(`${f.path} is unreadable`);
  }
  return out;
}

function readPin(dir: string): unknown {
  const text = readText(path.join(dir, "pinned-reviewer.json"));
  if (text === null) return undefined;
  try {
    const v: unknown = JSON.parse(text);
    return v;
  } catch {
    return undefined;
  }
}

// --- The procedure (§4.4). ---

type HoldOpts = {
  issue: string;
  cause: Cause;
  mode: Mode;
  kind: string | null;
  lenses: string[] | null;
  dir: string | null;
  holdLimit: number | null;
  retryLimit: number | null;
  root: string;
};

function storePaths(root: string, issue: string): { storeRoot: string; issueDir: string; file: string } {
  const storeRoot = path.join(root, ".faff", "resume");
  const issueDir = path.join(storeRoot, issue);
  return { storeRoot, issueDir, file: path.join(issueDir, STORE_FILE) };
}

function emptyResult(action: HoldResult["action"], file: string): HoldResult {
  return { action, token: null, cause: null, holds: null, limit: null, label_ops: [], comment: null, store_path: file, store: null };
}

function runHold(o: HoldOpts): HoldResult {
  const p = storePaths(o.root, o.issue);
  // 1. Interactive never auto-holds.
  if (o.mode === "interactive") return emptyResult("surface", p.file);

  // 2. The outage precondition: the in-turn ceiling was actually hit.
  let heldAtRound: number | undefined;
  let pinned: unknown;
  if (o.dir !== null) {
    const records = readRecords(o.dir);
    const ns = [...records.keys()].sort((a, b) => a - b);
    const latest = ns.length ? ns[ns.length - 1] : undefined;
    heldAtRound = latest;
    pinned = readPin(o.dir);
    if (o.cause === "outage") {
      if (latest === undefined || str(field(records.get(latest), "verdict")) !== "unavailable") {
        throw new HoldFault("--cause outage: the latest round record in --dir is not unavailable");
      }
      const retryLimit = o.retryLimit ?? roundApi.parseLimit(roundApi.configValue(o.root, "prep.spec_review_outage_retry_limit"), "prep.spec_review_outage_retry_limit");
      const prior = view(classify(readText(p.file))).held_at_round ?? 0;
      const attempt = roundApi.outageAttempt(records, latest, prior);
      if (attempt <= retryLimit) throw new HoldFault(`--cause outage: ${attempt} unavailable dispatch(es) this round, not above the retry limit ${retryLimit}`);
    }
  } else if (o.cause === "outage") {
    throw new HoldFault("--cause outage requires --dir <scratch>");
  }
  const limit = o.holdLimit ?? roundApi.parseLimit(roundApi.configValue(o.root, LIMIT_KEY[o.cause]), LIMIT_KEY[o.cause]);

  // 3. Under the resume-store lock.
  return withLock(p.storeRoot, o.issue, () => {
    const text = readText(p.file);
    const store = classify(text);
    const d = decideHold(store, o.cause, limit, {
      kind: o.kind ?? undefined,
      outaged_lenses: o.lenses ?? undefined,
      pinned_reviewer: pinned,
      held_at_round: heldAtRound,
      held_at: new Date().toISOString(),
    });
    const remove: LabelOp[] = [{ op: "remove", label: LABEL }];
    if (d.kind === "corrupt") {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.renameSync(p.file, path.join(p.issueDir, `spec-review-hold.corrupt-${stamp}.json`));
      return { ...emptyResult("park", p.file), token: "parked", cause: d.cause, limit, label_ops: remove };
    }
    if (d.kind === "exhausted") {
      fs.rmSync(p.file, { force: true });
      return { ...emptyResult("park", p.file), token: "parked", cause: d.cause, holds: d.holds, limit, label_ops: remove };
    }
    fs.mkdirSync(p.issueDir, { recursive: true });
    writeJsonAtomic(p.file, d.write);
    return {
      action: "hold", token: TOKEN[o.cause], cause: null, holds: d.holds, limit,
      label_ops: [{ op: "add", label: LABEL }], comment: notice(o.cause, d.holds, limit),
      store_path: p.file, store: view({ state: "valid", value: d.write }),
    };
  });
}

function readHold(root: string, issue: string): HoldResult {
  const p = storePaths(root, issue);
  return { ...emptyResult("read", p.file), store: view(classify(readText(p.file))) };
}

function clearHold(root: string, issue: string): HoldResult {
  const p = storePaths(root, issue);
  return withLock(p.storeRoot, issue, () => {
    fs.rmSync(p.file, { force: true });
    return { ...emptyResult("cleared", p.file), label_ops: [{ op: "remove", label: LABEL }] };
  });
}

// --- The verb. ---

const HOLD_SPEC = {
  flags: {
    "--issue": { arity: 1 },
    "--cause": { arity: 1, enum: ["outage", "turn-budget"] },
    "--mode": { arity: 1, enum: ["interactive", "autonomous"] },
    "--kind": { arity: 1, enum: ["infra-configured", "model-transient"] },
    "--lenses": { arity: 1 },
    "--dir": { arity: 1 },
    "--hold-limit": { arity: 1 },
    "--retry-limit": { arity: 1 },
    "--root": { arity: 1 },
    "--read": { arity: 0 },
    "--clear": { arity: 0 },
    "--json": { arity: 0 },
  },
};
const HOLD_USAGE = [
  "usage: faff spec-review hold --issue <ID> --cause outage|turn-budget --mode interactive|autonomous",
  "                             [--kind infra-configured|model-transient] [--lenses <csv>]",
  "                             [--dir <scratch>] [--hold-limit N] [--retry-limit N] [--root <dir>] [--json]",
  "       faff spec-review hold --read  --issue <ID> [--root <dir>] [--json]",
  "       faff spec-review hold --clear --issue <ID> [--root <dir>] [--json]",
].join("\n");

function printResult(json: boolean, r: HoldResult): void {
  if (json) { process.stdout.write(`${JSON.stringify(r)}\n`); return; }
  const tail = r.cause !== null ? `: ${r.cause}` : r.store !== null && r.action === "read" ? `: ${r.store.state}` : "";
  process.stdout.write(`${r.action}${r.token === null ? "" : ` ${r.token}`}${tail}\n`);
}

function cmdSpecReviewHold(argv: string[]): number {
  const { values, errors } = argvApi.parseArgs(argv, HOLD_SPEC);
  if (errors.length) return argvApi.usageError(errors, HOLD_USAGE);
  const json = values["--json"] === true;
  const fail = (code: number, reason: string): number => {
    if (json) process.stdout.write(`${JSON.stringify({ action: "errored", reason })}\n`);
    process.stderr.write(`faff spec-review hold: ${reason}\n`);
    return code;
  };
  const issue = str(values["--issue"]);
  if (issue === undefined || !ISSUE_RE.test(issue)) return fail(2, "--issue <ID> is required and must match ^[A-Za-z0-9][A-Za-z0-9._-]*$");
  try {
    const root = str(values["--root"]) ?? sharedInfra.findRoot();
    if (values["--read"] === true) { printResult(json, readHold(root, issue)); return 0; }
    if (values["--clear"] === true) { printResult(json, clearHold(root, issue)); return 0; }
    const cause = values["--cause"] === "outage" ? "outage" : values["--cause"] === "turn-budget" ? "turn-budget" : null;
    if (cause === null) return fail(2, "--cause outage|turn-budget is required");
    const mode = values["--mode"] === "interactive" ? "interactive" : values["--mode"] === "autonomous" ? "autonomous" : null;
    if (mode === null) return fail(2, "--mode interactive|autonomous is required");
    const holdRaw = str(values["--hold-limit"]);
    const retryRaw = str(values["--retry-limit"]);
    const lensesRaw = str(values["--lenses"]);
    const r = runHold({
      issue, cause, mode,
      kind: str(values["--kind"]) ?? null,
      lenses: lensesRaw === undefined ? null : lensesRaw.split(",").map((s) => s.trim()).filter((s) => s !== ""),
      dir: str(values["--dir"]) ?? null,
      holdLimit: holdRaw === undefined ? null : roundApi.parseLimit(holdRaw, "--hold-limit"),
      retryLimit: retryRaw === undefined ? null : roundApi.parseLimit(retryRaw, "--retry-limit"),
      root,
    });
    printResult(json, r);
    return 0;
  } catch (e) {
    if (e instanceof LockBusy) return fail(4, e.message);
    if (e instanceof HoldFault) return fail(2, e.message);
    if (e instanceof roundApi.RoundFault) return fail(2, e.message);
    throw e;
  }
}

module.exports = { cmdSpecReviewHold, decideHold, runHold, readHold, clearHold, HOLD_USAGE };
