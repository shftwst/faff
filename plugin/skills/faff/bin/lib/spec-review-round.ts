// ===========================================================================
// === region:factory — spec-review-round — FAFF-1417: prep's post-dispatch spec-review sequence as one verb ===
//
// `faff spec-review round` runs what faff-prep's Spec-review gate did by hand after the
// `spec_review` occupant returned: window governance, locating the single verdict block, the
// write-before-pipe round record, the `spec-review-verdict` contract, the reject-approach route,
// churn, the appetite cap and the convergence yield, in that order. Each step calls the existing
// pure function in process, so no trigger, threshold or vocabulary is restated here. The routing
// is the pure `decideRound`, which returns one typed `action`; tracker writes, the park protocol,
// the judge and re-spec stay with the skill. Where the prose was silent the code takes the branch
// that parks or holds sooner.
// ===========================================================================

const fs: FsApi = require("node:fs");
const path: PathApi = require("node:path");

interface FsApi {
  readFileSync(file: string | number, encoding: "utf8"): string;
  writeFileSync(file: string, data: string): void;
  renameSync(from: string, to: string): void;
  mkdirSync(dir: string, opts: { recursive: boolean }): void;
  existsSync(file: string): boolean;
  readdirSync(dir: string): string[];
  rmSync(file: string, opts: { force: boolean }): void;
}
interface PathApi {
  join(...parts: string[]): string;
}
type GovernResult = { code: number; result: unknown; detail?: string };
interface WindowApi {
  nextRoundNumber(dir: string): number;
  readWindowStart(dir: string): number;
  writeWindowStart(dir: string, n: number): void;
  govern(dir: string, n: number, servedness: string): GovernResult;
}
interface ContractApi {
  contractSpecReviewVerdict(extraction: unknown): { contractData?: unknown; failLoud?: string | null };
}
interface RouteApi {
  routeRejectApproach(record: unknown): { route?: unknown; error?: string };
}
interface ChurnApi {
  detectSpecReviewChurn(prev: unknown, curr: unknown, prevRoundNumber: number | null): unknown;
  readRoundRecord(p: string): { record?: unknown; missing?: boolean; malformed?: string };
}
interface ConvergenceApi {
  detectSpecReviewConvergence(rounds: unknown[]): unknown;
  roundFilesInDir(dir: string): { n: number; path: string }[];
}
interface IterationCapApi {
  resolveReviewIterationCap(appetite: string): { cap?: number; error?: string };
}
interface ConfigCoreApi {
  loadConfig(root: string): unknown[];
  DEFAULTS: { [key: string]: string };
}
interface SharedInfraApi {
  findRoot(start?: string): string;
}
type ParsedArgs = { values: { [flag: string]: unknown }; errors: unknown[] };
interface ArgvApi {
  parseArgs(argv: string[], spec: unknown): ParsedArgs;
  usageError(errors: unknown[], usage: string): number;
}

const windowApi: WindowApi = require("./spec-review-window");
const contractApi: ContractApi = require("./contract-defs-review");
const routeApi: RouteApi = require("./spec-review");
const churnApi: ChurnApi = require("./spec-review-churn");
const convergenceApi: ConvergenceApi = require("./spec-review-convergence");
const capApi: IterationCapApi = require("./spec-review-iteration-cap");
const configApi: ConfigCoreApi = require("./config-core");
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
function parseJson(text: string): unknown {
  try {
    const v: unknown = JSON.parse(text);
    return v;
  } catch {
    return undefined;
  }
}
function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

// A fault the verb maps to exit 2 with `{action: "errored", reason}`.
class RoundFault extends Error {}

// --- Vocabulary (§3, §4.3). ---

const SEVERITIES = ["blocker", "major", "minor"];
const LOOP_VERDICTS = ["revise", "reject-approach"];
const BLOCK_INFO = "faff-contract:spec-review-verdict";
const CAUSE = {
  contract2: "spec-review contract not satisfied (exit 2)",
  contract1: "spec-review contract not satisfied (exit 1)",
  route: "spec-review route failed (exit 2)",
  plot: "spec-review reject-approach (methodology at major or above) — needs /faff-plot re-slice",
};
const RETAIN = "spec-review: approve";

type Objection = { lens: string; severity: string };
type RoundRecord = { verdict: string; objections: unknown[] };
type Level = "L3" | "L4" | null;
type Mode = "interactive" | "autonomous";
type Cap = { limit: number; used: number; from_round: number; reached: boolean; yielded: boolean };
type Summary = { max_severity: string | null; counts: { blocker: number; major: number; minor: number }; lenses: string[] };

type RoundResult = {
  action: string;
  round: number;
  window_start: number;
  verdict: string | null;
  cause: string | null;
  carried_design_objections: Objection[];
  outaged_lenses: string[];
  attempt: number | null;
  retry_limit: number | null;
  cap: Cap;
  churn: unknown;
  convergence: unknown;
  governance: { action: unknown; anomaly?: unknown; window_start: unknown } | null;
  summary: Summary;
  level: Level;
  retain: string | null;
  warnings: string[];
};

function objectionsOf(rec: unknown): unknown[] {
  const o = field(rec, "objections");
  return Array.isArray(o) ? o : [];
}
function lensSeverity(o: unknown): Objection | null {
  const lens = str(field(o, "lens"));
  const severity = str(field(o, "severity"));
  return lens !== undefined && severity !== undefined ? { lens, severity } : null;
}
function lensList(objections: unknown[]): string {
  return objections.map(lensSeverity).filter((x): x is Objection => x !== null).map((x) => `${x.lens}:${x.severity}`).join(", ");
}

// summarise(objections) -> the latest round's severities and lenses, so an interactive skill can
// apply the operator's rule without re-reading the records.
function summarise(objections: unknown[]): Summary {
  const counts = { blocker: 0, major: 0, minor: 0 };
  const lenses = new Set<string>();
  for (const o of objections) {
    const ls = lensSeverity(o);
    if (ls === null) continue;
    lenses.add(ls.lens);
    if (ls.severity === "blocker") counts.blocker++;
    else if (ls.severity === "major") counts.major++;
    else if (ls.severity === "minor") counts.minor++;
  }
  const max = SEVERITIES.find((s) => (s === "blocker" ? counts.blocker : s === "major" ? counts.major : counts.minor) > 0) ?? null;
  return { max_severity: max, counts, lenses: [...lenses].sort() };
}

// outagedLenses(record) -> the lenses of an `unavailable` record's objections that carry no
// `claim`: aggregate.mjs names a down lens as a bare {lens, severity}, while every gating
// objection from a served lens carries a claim.
function outagedLenses(record: unknown): string[] {
  const out = new Set<string>();
  for (const o of objectionsOf(record)) {
    const lens = str(field(o, "lens"));
    const claim = field(o, "claim");
    if (lens !== undefined && (claim === undefined || claim === null || claim === "")) out.add(lens);
  }
  return [...out].sort();
}

// --- The pure decision (§4.1 decideRound). ---

type DecideInputs = {
  n: number;
  records: Map<number, unknown>;   // round records [1..n] that exist on disk, the current one included
  windowStart: number;
  capFrom: number;                 // cap-reset.json from_round, else 1
  ratified: Set<number>;           // rounds with a ratified-<k>.json
  heldAtRound: number;             // the hold store's held_at_round, else 0
  capLimit: number;
  retryLimit: number;
  mode: Mode;
  level: Level;
  contractData: unknown;           // the conformant contract output for round n
};
type Decision = Pick<RoundResult, "action" | "cause" | "carried_design_objections" | "outaged_lenses" | "attempt" | "retry_limit" | "churn" | "convergence" | "retain"> & { cap: Cap };

// outageAttempt(records, n, heldAtRound) -> the count of consecutive `unavailable` records ending
// at n, numbered above heldAtRound: the dispatches of this round that came back unavailable.
function outageAttempt(records: Map<number, unknown>, n: number, heldAtRound: number): number {
  let attempt = 0;
  for (let k = n; k > heldAtRound; k--) {
    if (str(field(records.get(k), "verdict")) !== "unavailable") break;
    attempt++;
  }
  return attempt;
}

function capUsed(records: Map<number, unknown>, from: number, n: number, ratified: Set<number>): number {
  let used = 0;
  for (let k = Math.max(1, from); k <= n; k++) {
    const v = str(field(records.get(k), "verdict"));
    if (v !== undefined && LOOP_VERDICTS.includes(v) && !ratified.has(k)) used++;
  }
  return used;
}

function decideRound(i: DecideInputs): Decision {
  const used = capUsed(i.records, i.capFrom, i.n, i.ratified);
  const cap: Cap = { limit: i.capLimit, used, from_round: i.capFrom, reached: used >= i.capLimit, yielded: false };
  const base: Decision = { action: "", cause: null, carried_design_objections: [], outaged_lenses: [], attempt: null, retry_limit: null, churn: null, convergence: null, retain: null, cap };
  const curr = i.records.get(i.n);
  const verdict = str(field(i.contractData, "verdict"));
  const objections = objectionsOf(i.contractData);
  const wouldPark = (cause: string, extra: Partial<Decision>): Decision => ({
    ...base, ...extra, action: i.mode === "autonomous" && (i.level === "L3" || i.level === "L4") ? "judge" : "park", cause,
  });

  if (verdict === "approve") return { ...base, action: "approve", retain: RETAIN };
  if (verdict === "needs-human") return { ...base, action: "park", cause: `spec-review needs-human — ${lensList(objections)}` };
  if (verdict === "unavailable") {
    const outaged = outagedLenses(curr);
    if (i.mode === "interactive") return { ...base, action: "surface-outage", outaged_lenses: outaged };
    const attempt = outageAttempt(i.records, i.n, i.heldAtRound);
    return { ...base, action: attempt <= i.retryLimit ? "retry-outage" : "hold-outage", outaged_lenses: outaged, attempt, retry_limit: i.retryLimit };
  }
  if (verdict === "reject-approach") {
    const r = routeApi.routeRejectApproach(i.contractData);
    if (r.error !== undefined) return { ...base, action: "park", cause: CAUSE.route };
    if (str(field(r.route, "destination")) === "plot") {
      const carriedRaw = field(r.route, "carried_design_objections");
      const carried = (Array.isArray(carriedRaw) ? carriedRaw : []).map(lensSeverity).filter((x): x is Objection => x !== null);
      if (i.mode === "autonomous" && i.level === "L4") return { ...base, action: "re-slice", carried_design_objections: carried };
      const cause = carried.length ? `${CAUSE.plot}; design-lens objections carried: ${carried.map((c) => `${c.lens}:${c.severity}`).join(", ")}` : CAUSE.plot;
      return { ...base, action: "park", cause, carried_design_objections: carried };
    }
  }
  // revise, or a prep-destined reject-approach: the bounded loop.
  let prevK: number | null = null;
  for (let k = i.n - 1; k >= i.windowStart && k >= 1; k--) {
    if (i.records.has(k)) { prevK = k; break; }
  }
  let churn: unknown = null;
  if (prevK !== null) {
    churn = churnApi.detectSpecReviewChurn(i.records.get(prevK), curr, prevK);
    if (field(churn, "churn") === true) {
      const lenses = field(churn, "new_lenses");
      const named = Array.isArray(lenses) ? lenses.filter((l): l is string => typeof l === "string").join(", ") : "";
      return wouldPark(`spec-review churn detected — new objecting lens(es) since round ${prevK}: ${named}`, { churn });
    }
  }
  if (used < i.capLimit) return { ...base, action: "fix-and-rerun", churn };
  const window: unknown[] = [];
  for (let k = Math.max(1, i.windowStart); k <= i.n; k++) if (i.records.has(k)) window.push(i.records.get(k));
  const convergence = convergenceApi.detectSpecReviewConvergence(window);
  if (field(convergence, "converging") === true) return { ...base, action: "fix-and-rerun", churn, convergence, cap: { ...cap, yielded: true } };
  return wouldPark(`spec-review loop cap reached — ${verdict ?? "unknown"}`, { churn, convergence });
}

// --- Disk reads. ---

function readJsonFile(p: string): { value?: unknown; absent?: boolean; bad?: string } {
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    return field(e, "code") === "ENOENT" ? { absent: true } : { bad: errText(e) };
  }
  const v = parseJson(raw);
  return v === undefined ? { bad: `${p} is not valid JSON` } : { value: v };
}

function writeJsonAtomic(p: string, value: unknown): void {
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, p);
}

// readRecords(dir) -> every round-<k>.json on disk; a present-but-unparseable record is a fault.
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
    if (r.malformed !== undefined) throw new RoundFault(`${f.path} is not valid JSON (${r.malformed})`);
    if (r.missing === true) throw new RoundFault(`${f.path} could not be read`);
    out.set(f.n, r.record);
  }
  return out;
}

const SIDECAR = {
  decision: (n: number): string => `decision-${n}.json`,
  ratified: (n: number): string => `ratified-${n}.json`,
  capReset: "cap-reset.json",
};

function numberedFiles(dir: string, re: RegExp): number[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: number[] = [];
  for (const name of names) {
    const m = re.exec(name);
    const g = m ? m[1] : undefined;
    if (g !== undefined) out.push(parseInt(g, 10));
  }
  return out.sort((a, b) => a - b);
}

function readCapFrom(dir: string): number {
  const r = readJsonFile(path.join(dir, SIDECAR.capReset));
  if (r.absent === true) return 1;
  const from = field(r.value, "from_round");
  if (r.bad !== undefined || typeof from !== "number" || !Number.isInteger(from) || from < 1) throw new RoundFault(`${SIDECAR.capReset} is unreadable or has no integer from_round`);
  return from;
}

// The hold store's held_at_round, or 0. A missing or unreadable store reads 0 here: the hold
// verb itself parks a corrupt store before it could change any counter.
function readHeldAtRound(root: string, issue: string): number {
  const r = readJsonFile(path.join(root, ".faff", "resume", issue, "spec-review-hold.json"));
  const h = field(r.value, "held_at_round");
  return isNonNegInt(h) ? h : 0;
}

// The run level as a whitelist: only the exact strings L3 and L4 count.
function readLevel(runDir: string | null): Level {
  if (runDir === null || runDir === "") return null;
  const lv = field(readJsonFile(path.join(runDir, "run-ledger.json")).value, "level");
  return lv === "L3" || lv === "L4" ? lv : null;
}

// configValue(root, key) -> the dotted key from .faff/config.yaml, else the registry default.
function configValue(root: string, key: string): string | undefined {
  let data: unknown;
  try {
    data = configApi.loadConfig(root)[0];
  } catch (e) {
    throw new RoundFault(`config unreadable: ${errText(e)}`);
  }
  let cur: unknown = data;
  for (const part of key.split(".")) cur = field(cur, part);
  if (typeof cur === "string" || typeof cur === "number" || typeof cur === "boolean") return String(cur);
  return configApi.DEFAULTS[key];
}

function parseLimit(raw: string | undefined, name: string): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) throw new RoundFault(`${name} is not an integer >= 0 (got ${JSON.stringify(raw ?? null)})`);
  return parseInt(raw.trim(), 10);
}

// verdictBlocks(text) -> the bodies of every fenced faff-contract:spec-review-verdict block.
function verdictBlocks(text: string): string[] {
  const blocks: string[] = [];
  let open: string | null = null;
  let body: string[] | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const fence = m ? m[1] : undefined;
    const info = m ? m[2] : undefined;
    if (open !== null) {
      if (fence !== undefined && fence[0] === open[0] && fence.length >= open.length && (info ?? "").trim() === "") {
        if (body !== null) blocks.push(body.join("\n"));
        open = null; body = null;
      } else if (body !== null) body.push(line);
    } else if (fence !== undefined) {
      open = fence;
      body = (info ?? "").trim() === BLOCK_INFO ? [] : null;
    }
  }
  return blocks;
}

// --- The procedure (§4.1 round). ---

type RoundOpts = {
  issue: string;
  dir: string;
  verdictText: string;
  mode: Mode;
  occupant: "adversarial" | "single-pass";
  served: "any" | "none" | null;
  runDir: string | null;
  appetite: string | null;
  retryLimit: number | null;
  root: string;
};

// The one injectable seam: window governance, so a test can reach the record-missing branch that
// the real `govern` (which writes its record on every path) never takes.
type RoundDeps = { govern: (dir: string, n: number, servedness: string) => GovernResult };
const realDeps = (): RoundDeps => ({ govern: windowApi.govern });

function runRound(o: RoundOpts, deps: RoundDeps = realDeps()): RoundResult {
  try {
    fs.mkdirSync(o.dir, { recursive: true });
  } catch (e) {
    throw new RoundFault(`scratch dir ${o.dir} cannot be created: ${errText(e)}`);
  }
  const n = windowApi.nextRoundNumber(o.dir);
  let windowStart: number;
  try {
    windowStart = windowApi.readWindowStart(o.dir);
  } catch (e) {
    throw new RoundFault(errText(e));
  }
  if (o.occupant === "adversarial" && o.served === null) throw new RoundFault("--occupant adversarial requires --served any|none");
  if (o.occupant === "single-pass" && o.served !== null) throw new RoundFault("--occupant single-pass takes no --served");
  if (o.occupant === "single-pass" && fs.existsSync(path.join(o.dir, `served-${n}.json`))) throw new RoundFault(`--occupant single-pass but served-${n}.json is present: this round was adversarial`);

  const capLimitRes = capApi.resolveReviewIterationCap(o.appetite ?? configValue(o.root, "appetite") ?? "");
  if (capLimitRes.error !== undefined || capLimitRes.cap === undefined) throw new RoundFault(capLimitRes.error ?? "appetite did not resolve");
  const retryLimit = o.retryLimit ?? parseLimit(configValue(o.root, "prep.spec_review_outage_retry_limit"), "prep.spec_review_outage_retry_limit");
  const level = readLevel(o.runDir);
  const warnings: string[] = [];

  // 3. Window governance, adversarial occupant only.
  let governance: RoundResult["governance"] = null;
  if (o.occupant === "adversarial") {
    const g = deps.govern(o.dir, n, o.served === "any" ? "any-served" : "no-lens");
    if (isRecord(g.result)) {
      const ws = field(g.result, "window_start");
      windowStart = typeof ws === "number" && Number.isInteger(ws) ? ws : n;
      const anomaly = field(g.result, "anomaly");
      governance = { action: field(g.result, "action"), window_start: windowStart };
      if (anomaly !== null && anomaly !== undefined) governance.anomaly = anomaly;
      if (g.code !== 0) {
        windowStart = n; // a governance fault never compares across a boundary it cannot prove (P5)
        governance.window_start = n;
        warnings.push(`govern-fault: ${String(anomaly ?? g.detail ?? "exit 2")}`);
      }
      else if (anomaly !== null && anomaly !== undefined) warnings.push(`govern-anomaly: ${String(field(g.result, "action"))} ${String(anomaly)}`);
    } else {
      windowStart = n;
      warnings.push(`govern-fault: ${g.detail ?? `exit ${g.code}`}`);
    }
    const rec = readJsonFile(path.join(o.dir, `governance-${n}.json`));
    if (rec.value === undefined) {
      windowStart = n;
      warnings.push("govern-record-missing");
    }
  }

  const capFrom = readCapFrom(o.dir);
  const ratified = new Set(numberedFiles(o.dir, /^ratified-(\d+)\.json$/));
  const heldAtRound = readHeldAtRound(o.root, o.issue);
  let records = readRecords(o.dir);

  const finish = (verdict: string | null, objections: unknown[], d: Decision): RoundResult => {
    const result: RoundResult = {
      action: d.action, round: n, window_start: windowStart, verdict, cause: d.cause,
      carried_design_objections: d.carried_design_objections, outaged_lenses: d.outaged_lenses,
      attempt: d.attempt, retry_limit: d.retry_limit, cap: d.cap, churn: d.churn, convergence: d.convergence,
      governance, summary: summarise(objections), level, retain: d.retain, warnings,
    };
    writeJsonAtomic(path.join(o.dir, SIDECAR.decision(n)), result);
    return result;
  };
  const parkEarly = (verdict: string | null, objections: unknown[], cause: string): RoundResult => {
    const used = capUsed(records, capFrom, n, ratified);
    const cap: Cap = { limit: capLimitRes.cap ?? 0, used, from_round: capFrom, reached: used >= (capLimitRes.cap ?? 0), yielded: false };
    return finish(verdict, objections, { action: "park", cause, carried_design_objections: [], outaged_lenses: [], attempt: null, retry_limit: null, churn: null, convergence: null, retain: null, cap });
  };

  // 4. Locate exactly one block.
  const blocks = verdictBlocks(o.verdictText);
  const only = blocks.length === 1 ? blocks[0] : undefined;
  const block = only === undefined ? undefined : parseJson(only);
  if (!isRecord(block)) return parkEarly(null, [], CAUSE.contract2);
  const verdict = str(field(block, "verdict")) ?? null;
  const roundRecord: RoundRecord = { verdict: verdict ?? "", objections: objectionsOf(block) };
  if (verdict === null || !Array.isArray(field(block, "objections"))) return parkEarly(verdict, objectionsOf(block), CAUSE.contract2);

  // 5–6. Write the record, then pipe it with round_recorded read from disk.
  const recordPath = path.join(o.dir, `round-${n}.json`);
  writeJsonAtomic(recordPath, { verdict: roundRecord.verdict, objections: roundRecord.objections });
  let roundRecorded = false;
  try {
    roundRecorded = convergenceApi.roundFilesInDir(o.dir).length > 0;
  } catch {
    roundRecorded = false;
  }
  const c = contractApi.contractSpecReviewVerdict({ verdict: roundRecord.verdict, objections: roundRecord.objections, round_recorded: roundRecorded });
  if ((c.failLoud !== undefined && c.failLoud !== null) || c.contractData === undefined) {
    fs.rmSync(recordPath, { force: true });
    return parkEarly(verdict, roundRecord.objections, CAUSE.contract2);
  }
  if (field(c.contractData, "conformant") !== true) {
    fs.rmSync(recordPath, { force: true });
    return parkEarly(verdict, roundRecord.objections, CAUSE.contract1);
  }

  records = readRecords(o.dir);
  const d = decideRound({
    n, records, windowStart, capFrom, ratified, heldAtRound, capLimit: capLimitRes.cap, retryLimit,
    mode: o.mode, level, contractData: c.contractData,
  });
  return finish(verdict, roundRecord.objections, d);
}

// --- --open-window and --mark-ratified (§4.1). ---

function latestDecision(dir: string): { k: number; action: string | undefined } | null {
  const ks = numberedFiles(dir, /^decision-(\d+)\.json$/);
  const k = ks.length ? ks[ks.length - 1] : undefined;
  if (k === undefined) return null;
  return { k, action: str(field(readJsonFile(path.join(dir, SIDECAR.decision(k))).value, "action")) };
}

function openWindow(dir: string): { window_start: number; cap_from: number } {
  const last = latestDecision(dir);
  if (last === null || (last.action !== "park" && last.action !== "judge")) {
    throw new RoundFault("--open-window needs a recorded stop: the latest decision is not park or judge");
  }
  const n = windowApi.nextRoundNumber(dir);
  windowApi.writeWindowStart(dir, n);
  writeJsonAtomic(path.join(dir, SIDECAR.capReset), { from_round: n, reason: "human-unpark", after_decision: last.k, ts: new Date().toISOString() });
  return { window_start: n, cap_from: n };
}

function markRatified(dir: string, n: number, commentId: string): { round: number; ratified: true } {
  const rec = readJsonFile(path.join(dir, `round-${n}.json`));
  const v = str(field(rec.value, "verdict"));
  if (v === undefined || !LOOP_VERDICTS.includes(v)) throw new RoundFault(`round-${n}.json is not a loop round (revise or reject-approach)`);
  const dec = str(field(readJsonFile(path.join(dir, SIDECAR.decision(n))).value, "action"));
  if (dec !== "fix-and-rerun" && dec !== "park") throw new RoundFault(`decision-${n}.json action is ${JSON.stringify(dec ?? null)}, not fix-and-rerun or park`);
  writeJsonAtomic(path.join(dir, SIDECAR.ratified(n)), { round: n, comment_id: commentId, ts: new Date().toISOString() });
  return { round: n, ratified: true };
}

// --- The verb. ---

const ROUND_SPEC = {
  flags: {
    "--issue": { arity: 1 },
    "--dir": { arity: 1 },
    "--verdict-file": { arity: 1 },
    "--mode": { arity: 1, enum: ["interactive", "autonomous"] },
    "--occupant": { arity: 1, enum: ["adversarial", "single-pass"] },
    "--served": { arity: 1, enum: ["any", "none"] },
    "--run-dir": { arity: 1 },
    "--appetite": { arity: 1, enum: ["low", "medium", "high", "full"] },
    "--retry-limit": { arity: 1 },
    "--root": { arity: 1 },
    "--open-window": { arity: 0 },
    "--mark-ratified": { arity: 1 },
    "--comment-id": { arity: 1 },
    "--json": { arity: 0 },
  },
};
const ROUND_USAGE = [
  "usage: faff spec-review round --issue <ID> --dir <scratch> --verdict-file <file|-> --mode interactive|autonomous",
  "                              --occupant adversarial|single-pass [--served any|none] [--run-dir <dir>] [--appetite low|medium|high|full]",
  "                              [--retry-limit N] [--root <dir>] [--json]",
  "       faff spec-review round --open-window --dir <scratch> [--json]",
  "       faff spec-review round --mark-ratified <n> --comment-id <id> --dir <scratch> --mode interactive [--json]",
].join("\n");
const ISSUE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function emitFault(json: boolean, reason: string): number {
  if (json) process.stdout.write(`${JSON.stringify({ action: "errored", reason })}\n`);
  process.stderr.write(`faff spec-review round: ${reason}\n`);
  return 2;
}

function cmdSpecReviewRound(argv: string[]): number {
  const { values, errors } = argvApi.parseArgs(argv, ROUND_SPEC);
  if (errors.length) return argvApi.usageError(errors, ROUND_USAGE);
  const json = values["--json"] === true;
  const dir = str(values["--dir"]);
  if (dir === undefined || dir === "") return argvApi.usageError([{ code: "missing-required", detail: "--dir <scratch> is required" }], ROUND_USAGE);
  try {
    if (values["--open-window"] === true) {
      const r = openWindow(dir);
      process.stdout.write(json ? `${JSON.stringify(r)}\n` : `window opened at round ${r.window_start}\n`);
      return 0;
    }
    const markRaw = str(values["--mark-ratified"]);
    if (markRaw !== undefined) {
      if (!/^\d+$/.test(markRaw) || parseInt(markRaw, 10) < 1) throw new RoundFault("--mark-ratified expects a round number >= 1");
      if (values["--mode"] !== "interactive") throw new RoundFault("--mark-ratified requires --mode interactive");
      const commentId = str(values["--comment-id"]);
      if (commentId === undefined || commentId === "") throw new RoundFault("--mark-ratified requires --comment-id <id>");
      const level = readLevel(str(values["--run-dir"]) ?? process.env["FAFF_RUN_DIR"] ?? null);
      if (level !== null) throw new RoundFault(`--mark-ratified is refused on an autonomous ${level} run: only a present human ratifies`);
      const r = markRatified(dir, parseInt(markRaw, 10), commentId);
      process.stdout.write(json ? `${JSON.stringify(r)}\n` : `round ${r.round} ratified\n`);
      return 0;
    }
    const issue = str(values["--issue"]);
    if (issue === undefined || !ISSUE_RE.test(issue)) throw new RoundFault("--issue <ID> is required and must match ^[A-Za-z0-9][A-Za-z0-9._-]*$");
    const verdictFile = str(values["--verdict-file"]);
    if (verdictFile === undefined || verdictFile === "") throw new RoundFault("--verdict-file <file|-> is required");
    const mode = values["--mode"] === "interactive" ? "interactive" : values["--mode"] === "autonomous" ? "autonomous" : null;
    if (mode === null) throw new RoundFault("--mode interactive|autonomous is required");
    const occupant = values["--occupant"] === "adversarial" ? "adversarial" : values["--occupant"] === "single-pass" ? "single-pass" : null;
    if (occupant === null) throw new RoundFault("--occupant adversarial|single-pass is required");
    const served = values["--served"] === "any" ? "any" : values["--served"] === "none" ? "none" : null;
    let verdictText: string;
    try {
      verdictText = verdictFile === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(verdictFile, "utf8");
    } catch (e) {
      throw new RoundFault(`--verdict-file unreadable: ${errText(e)}`);
    }
    const retryRaw = str(values["--retry-limit"]);
    const result = runRound({
      issue, dir, verdictText, mode, occupant, served,
      runDir: str(values["--run-dir"]) ?? process.env["FAFF_RUN_DIR"] ?? null,
      appetite: str(values["--appetite"]) ?? null,
      retryLimit: retryRaw === undefined ? null : parseLimit(retryRaw, "--retry-limit"),
      root: str(values["--root"]) ?? sharedInfra.findRoot(),
    });
    process.stdout.write(json ? `${JSON.stringify(result)}\n` : `${result.action} round ${result.round}${result.cause === null ? "" : `: ${result.cause}`}\n`);
    return 0;
  } catch (e) {
    if (e instanceof RoundFault) return emitFault(json, e.message);
    return emitFault(json, `unexpected: ${errText(e)}`);
  }
}

module.exports = { cmdSpecReviewRound, decideRound, runRound, realDeps, outageAttempt, outagedLenses, verdictBlocks, summarise, readLevel, configValue, parseLimit, RoundFault, ROUND_USAGE, CAUSE };
