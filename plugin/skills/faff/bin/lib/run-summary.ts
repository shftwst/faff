// ===========================================================================
// === region:factory — run-summary — FAFF-1435: render beep-boop's run summary from the run directory ===
//
// `faff run summary` renders `<run-dir>/summary.md`, the template that used to live as prose in
// faff-beep-boop's Reporting §1. Everything the run dir, the repo config, the install and the forge
// can answer is computed here, in-process: the ledger and events are read directly, economics,
// budget state, install health and the ground-truth divergences come from their owning modules'
// own functions, and PR numbers come from disk records first, then merge-gate's `gh` path. Only
// tracker reads and in-run judgements come from the orchestrator's facts file, and every markdown
// line built from one ends ` _(reported)_`. A missing or malformed facts file, a failed doctor and
// a failed forge read each render a visible line at exit 0; only an unreadable ledger (or one
// missing a core field) exits 2. The command never reads the clock and spawns no faff subprocess.
// ===========================================================================

const fs: FsApi = require("node:fs");
const path: PathApi = require("node:path");

// --- Typed views of the JS modules this command composes (no casts: the annotation types `require`). ---

interface FsApi {
  readFileSync(file: string | number, encoding: "utf8"): string;
  writeFileSync(file: string, data: string): void;
  renameSync(from: string, to: string): void;
  existsSync(file: string): boolean;
}
interface PathApi {
  join(...parts: string[]): string;
  basename(p: string): string;
  dirname(p: string): string;
  resolve(...parts: string[]): string;
}
type GhResult = { ok: boolean; data: unknown; stderr: string };
interface MergeGateGhApi {
  ghJson(args: string[]): GhResult;
}
type Divergence = { class: string; issue: string | null; detail: string };
type ReconcileResult = { divergences: Divergence[]; consistent: boolean; disposition: string };
interface ReconcileApi {
  reconcileCore(input: unknown): ReconcileResult;
  validateReconcileInput(input: unknown): string | null;
}
interface EconomicsApi {
  economicsForRun(runDir: string, opts: { root: string; sessionId: string | null; env: { [k: string]: string } }): unknown;
}
interface BudgetApi {
  budgetCheckForRun(runDir: string, opts: { root: string; sessionId: string | null; env: { [k: string]: string }; nowMs: number; resolveUnmetered: unknown; persistWindow: boolean }): unknown;
}
interface BackendsApi {
  unmeteredFleetEngines(cfg: unknown, allow: string[]): string[];
}
type DoctorScanSet = { scanSet: string[]; collapseNotices: string[]; expectCopies: boolean };
interface DoctorApi {
  resolveDoctorScanSet(targetFlag: string | null, pluginRootEnv: string | undefined, home: string, root: string): DoctorScanSet;
  gatherDoctorState(scanSet: string[], collapseNotices: string[], expectCopies: boolean, root: string, targetOverridesPluginRoot: boolean): unknown;
  buildDoctorJson(state: unknown): unknown;
  doctorResultLine(state: unknown): string;
}
interface EventsApi {
  parseJsonlEntries(text: string): unknown[];
}
interface HeartbeatApi {
  readHeartbeatFile(runDir: string): string | null;
}
interface HoldoutApi {
  HOLDOUT_REASON_CODES: string[];
}
interface ContractEvidenceApi {
  rollupNeedsHumanReasons(criteria: unknown[]): { [code: string]: number };
}
interface ConfigCoreApi {
  loadConfig(root: string): unknown[];
}
interface SharedInfraApi {
  findRoot(): string;
  homeDir(env?: { [k: string]: string | undefined }): string;
}
type ParsedArgs = { values: { [flag: string]: unknown }; errors: unknown[] };
interface ArgvApi {
  parseArgs(argv: string[], spec: unknown): ParsedArgs;
  usageError(errors: unknown[], usage: string): number;
}

const mergeGateGh: MergeGateGhApi = require("./merge-gate-gh");
const reconcileApi: ReconcileApi = require("./reconcile");
const economicsApi: EconomicsApi = require("./economics");
const budgetApi: BudgetApi = require("./budget");
const backendsApi: BackendsApi = require("./backends");
const doctorApi: DoctorApi = require("./gates-doctor");
const eventsApi: EventsApi = require("./events");
const heartbeatApi: HeartbeatApi = require("./heartbeat");
const holdoutApi: HoldoutApi = require("./holdout-record");
const contractEvidence: ContractEvidenceApi = require("./contract-defs-evidence");
const configCore: ConfigCoreApi = require("./config-core");
const sharedInfra: SharedInfraApi = require("./shared-infra");
const argvApi: ArgvApi = require("./argv");

// --- Untyped-JSON helpers: every read of a ledger, facts or record value goes through these. ---

function isRecord(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function field(o: unknown, key: string): unknown {
  return isRecord(o) ? Reflect.get(o, key) : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function keysOf(o: unknown): string[] {
  return isRecord(o) ? Object.keys(o) : [];
}
function readJson(file: string): unknown {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
}
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- 4.3 Neutralisation: no string from the facts file (or a tracker- or forge-derived disk string) may
// become markdown structure. Newlines collapse to spaces; a leading block marker is backslash-escaped. ---

const LEADING_BLOCK_MARKER = /^(\s*)(#|`+|~+|>|-|\*|\+|\||\d+\.)/;

function factText(v: unknown): string {
  const s = (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v)).replace(/\r\n|\r|\n/g, " ");
  return s.replace(LEADING_BLOCK_MARKER, (_m: string, sp: string, mark: string) => `${sp}\\${mark}`);
}

const REPORTED = " _(reported)_";

// --- The facts file (§3). format 2; every field optional. ---

const FACTS_TOP_KEYS = ["format", "tracker", "run"];
const FACTS_TRACKER_KEYS = ["titles", "sibling_end_states", "superseded_delivered"];
const FACTS_RUN_KEYS = ["gloss", "methodology_findings", "verdicts", "resolve_attempts", "park_records", "reasons", "inferred_deps", "discovered_scope", "follow_ups", "prep_summary", "tidy_log", "waves"];

interface FactsRead {
  facts: unknown;
  note: string | null;
  unknownKeys: string[];
}

function readFacts(factsPath: string | null): FactsRead {
  if (factsPath === null) return { facts: {}, note: "⚠ could not read facts: no facts file given", unknownKeys: [] };
  let text: string;
  try { text = fs.readFileSync(factsPath, "utf8"); }
  catch (e) { return { facts: {}, note: `⚠ could not read facts: ${factText(errText(e))}`, unknownKeys: [] }; }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { return { facts: {}, note: `⚠ could not read facts: invalid JSON (${factText(errText(e))})`, unknownKeys: [] }; }
  if (!isRecord(parsed)) return { facts: {}, note: "⚠ could not read facts: the facts file is not a JSON object", unknownKeys: [] };
  const format = field(parsed, "format");
  if (format !== 2) {
    const why = format === undefined ? "format missing" : `format ${factText(JSON.stringify(format))} is not 2`;
    return { facts: {}, note: `⚠ could not read facts: ${why}`, unknownKeys: [] };
  }
  const unknownKeys: string[] = [];
  for (const k of keysOf(parsed)) if (!FACTS_TOP_KEYS.includes(k)) unknownKeys.push(k);
  for (const k of keysOf(field(parsed, "tracker"))) if (!FACTS_TRACKER_KEYS.includes(k)) unknownKeys.push(`tracker.${k}`);
  for (const k of keysOf(field(parsed, "run"))) if (!FACTS_RUN_KEYS.includes(k)) unknownKeys.push(`run.${k}`);
  return { facts: parsed, note: null, unknownKeys };
}

// --- The ledger (§4.1 step 1). ---

class LedgerFault extends Error {}

function readLedgerStrict(runDir: string): unknown {
  let ledger: unknown;
  try { ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8")); }
  catch (e) { throw new LedgerFault(`cannot read ${path.join(runDir, "run-ledger.json")}: ${errText(e)}`); }
  if (!isRecord(ledger)) throw new LedgerFault("run-ledger.json is not a JSON object");
  if (str(field(field(ledger, "owner"), "started_at")) === undefined) throw new LedgerFault("run-ledger.json has no owner.started_at string");
  if (!isStringArray(field(ledger, "admitted"))) throw new LedgerFault("run-ledger.json admitted is missing or not an array of ids");
  const outcomes = field(ledger, "outcomes");
  if (!isRecord(outcomes) || !Object.values(outcomes).every((v) => typeof v === "string")) throw new LedgerFault("run-ledger.json outcomes is missing or not an id → outcome map");
  return ledger;
}

// An annotation array: absent reads as empty; present but mistyped renders a could-not-read line.
type IdList = { ids: string[]; bad: string | null };
function idList(ledger: unknown, name: string): IdList {
  const v = field(ledger, name);
  if (v === undefined) return { ids: [], bad: null };
  if (isStringArray(v)) return { ids: v, bad: null };
  return { ids: [], bad: `- (could not read ${name}: not an array of issue ids)` };
}

function outcomeEntries(ledger: unknown): Array<[string, string]> {
  const o = field(ledger, "outcomes");
  const out: Array<[string, string]> = [];
  for (const k of keysOf(o)) {
    const v = str(field(o, k));
    if (v !== undefined) out.push([k, v]);
  }
  return out;
}

// --- Dependencies, injectable so tests can stub the forge, the install and the clock-free figures. ---

interface Deps {
  ghJson(args: string[]): GhResult;
  doctor(root: string): { exit: number; resultLine: string };
  economics(runDir: string, root: string, sessionId: string | null): unknown;
  budget(runDir: string, root: string, sessionId: string | null, nowMs: number): unknown;
  methodology(root: string): string | null;
}

// The env handed to the economics and budget functions: the ledger's own measure session, plus only
// the variables that LOCATE transcripts (home and Claude config dir). Never the ambient session id.
function measureEnv(sessionId: string | null): { [k: string]: string } {
  const env: { [k: string]: string } = {};
  for (const k of ["HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR"]) {
    const v = process.env[k];
    if (typeof v === "string" && v !== "") env[k] = v;
  }
  if (sessionId !== null) env["CLAUDE_CODE_SESSION_ID"] = sessionId;
  return env;
}

function realDeps(): Deps {
  return {
    ghJson: (args) => mergeGateGh.ghJson(args),
    doctor: (root) => {
      const set = doctorApi.resolveDoctorScanSet(null, process.env["CLAUDE_PLUGIN_ROOT"], sharedInfra.homeDir(), root);
      const state = doctorApi.gatherDoctorState(set.scanSet, set.collapseNotices, set.expectCopies, root, false);
      const json = doctorApi.buildDoctorJson(state);
      const exit = num(field(json, "exit")) ?? 0;
      if (field(state, "emptyUnion") === true) return { exit, resultLine: `RESULT: no faff skills found under any of: ${set.scanSet.join(", ")}` };
      return { exit, resultLine: doctorApi.doctorResultLine(state) };
    },
    economics: (runDir, root, sessionId) => economicsApi.economicsForRun(runDir, { root, sessionId, env: measureEnv(sessionId) }),
    budget: (runDir, root, sessionId, nowMs) => budgetApi.budgetCheckForRun(runDir, {
      root, sessionId, env: measureEnv(sessionId), nowMs,
      resolveUnmetered: (cfg: unknown, allow: string[]) => backendsApi.unmeteredFleetEngines(cfg, allow),
      persistWindow: false,
    }),
    methodology: (root) => {
      const loaded = configCore.loadConfig(root);
      return str(field(field(loaded[0], "slots"), "methodology")) ?? null;
    },
  };
}

// --- Formatting helpers. ---

function fmtTokens(n: unknown): string {
  const v = num(n);
  if (v === undefined) return "?";
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}
function fmtCost(n: unknown): string | null {
  const v = num(n);
  return v === undefined ? null : `$${v.toFixed(2)}`;
}
function utcStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return factText(iso);
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}
function fmtDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}
function modeOf(runId: string, ledger: unknown): string {
  const m = /-beepboop-([a-z]+)-[0-9a-f]+$/.exec(runId);
  const token = m && m[1] !== undefined ? m[1] : str(field(ledger, "mode"));
  if (token === undefined) return "(unknown)";
  return token === "list" ? "explicit-list" : factText(token);
}

const INTERVENTION_ORDER = ["continue", "surface", "pause", "correct", "abort"];

// --- The render. ---

interface RenderInput {
  runDir: string;
  factsPath: string | null;
  root: string;
  sessionId: string | null;
}

class Lines {
  out: string[] = [];
  push(line: string): void { this.out.push(line); }
}

function renderRunSummary(input: RenderInput, deps: Deps): string {
  const runDir = input.runDir;
  const ledger = readLedgerStrict(runDir);
  const runId = str(field(ledger, "run_id")) ?? path.basename(path.resolve(runDir));
  const facts = readFacts(input.factsPath);
  const F = facts.facts;
  const tracker = field(F, "tracker");
  const run = field(F, "run");
  const titles = field(tracker, "titles");
  const gloss = field(run, "gloss");
  const reasons = field(run, "reasons");
  const budgetRec = field(ledger, "budget");
  const sessionId = input.sessionId ?? str(field(budgetRec, "measure_session_id")) ?? null;
  const root = str(field(budgetRec, "measure_root")) ?? input.root;
  const startedAt = str(field(field(ledger, "owner"), "started_at")) ?? "";
  const outcomes = outcomeEntries(ledger);
  const idsWith = (...wanted: string[]): string[] => outcomes.filter(([, o]) => wanted.includes(o)).map(([id]) => id);
  const L = new Lines();

  // Titles and glosses come from the tracker / the run's judgements: reported.
  const titleOf = (id: string): { text: string; reported: boolean } => {
    const t = str(field(titles, id));
    return t === undefined ? { text: "", reported: false } : { text: `: ${factText(t)}`, reported: true };
  };
  const glossOf = (id: string): { text: string; reported: boolean } => {
    const g = str(field(gloss, id));
    return g === undefined ? { text: "", reported: false } : { text: `  ${factText(g)}`, reported: true };
  };
  const reasonOf = (id: string): string | null => {
    const r = str(field(reasons, id));
    return r === undefined ? null : factText(r);
  };
  const label = (line: string, reported: boolean): string => (reported ? line + REPORTED : line);

  // PR numbers: merge-record.json, then landing-loop.json, then the forge.
  const forgeFailures: string[] = [];
  const prOf = (id: string): number | null => {
    const fromDisk = num(field(readJson(path.join(runDir, id, "merge-record.json")), "pr"))
      ?? num(field(readJson(path.join(runDir, id, "landing-loop.json")), "pr"));
    if (fromDisk !== undefined && fromDisk > 0) return fromDisk;
    const r = deps.ghJson(["pr", "list", "--search", `${id} in:title`, "--state", "all", "--json", "number,headRefName"]);
    if (!r.ok) { forgeFailures.push(`- could not read forge: PR lookup for ${factText(id)}: ${factText(r.stderr || "gh failed")}`); return null; }
    const prefix = id.toLowerCase();
    if (Array.isArray(r.data)) {
      for (const row of r.data) {
        const head = str(field(row, "headRefName"));
        const n = num(field(row, "number"));
        if (head !== undefined && n !== undefined && head.toLowerCase().startsWith(prefix)) return n;
      }
    }
    return null;
  };
  const prSuffix = (id: string): string => {
    const n = prOf(id);
    return n === null ? "" : ` (PR #${n})`;
  };

  // §4.1 step 7a: the facts-problem note, then install health.
  if (facts.note !== null) L.push(facts.note);
  try {
    const d = deps.doctor(input.root);
    // Exit 1 is "install not clean"; exit 2 (nothing installed anywhere) adds no line, as in the prose.
    if (d.exit === 1) L.push(`⚠ INSTALL-HEALTH: ${factText(d.resultLine)} — remediation: run \`faff sync\``);
  } catch (e) {
    L.push(`⚠ could not read install health: ${factText(errText(e))}`);
  }

  // 7b: the methodology line.
  let methodology: string | null = null;
  try { methodology = deps.methodology(input.root); } catch { methodology = null; }
  if (methodology !== null) L.push(`Methodology: ${factText(methodology)}`);

  // 7c: the header.
  let events: unknown[] | null = null;
  try { events = eventsApi.parseJsonlEntries(fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8")); } catch { events = null; }
  const endpoints: number[] = [];
  const hb = heartbeatApi.readHeartbeatFile(runDir);
  if (hb !== null) endpoints.push(Date.parse(hb));
  const lastHb = str(field(field(ledger, "owner"), "last_heartbeat"));
  if (lastHb !== undefined) endpoints.push(Date.parse(lastHb));
  if (events !== null && events.length > 0) {
    const lastTs = str(field(events[events.length - 1], "ts"));
    if (lastTs !== undefined) endpoints.push(Date.parse(lastTs));
  }
  const startMs = Date.parse(startedAt);
  const finite = endpoints.filter((n) => Number.isFinite(n));
  const endMs = finite.length > 0 ? Math.max(...finite) : startMs;
  L.push(`# Beep-Boop Run — ${utcStamp(startedAt)}`);
  L.push(`Mode: ${modeOf(runId, ledger)} · Duration: ${Number.isFinite(startMs) && Number.isFinite(endMs) ? fmtDuration(endMs - startMs) : "?"}`);
  let sentry: string;
  if (events === null) sentry = "Sentry: (events unreadable)";
  else {
    const checkpoints = events.filter((e) => field(e, "type") === "sentry-checkpoint");
    let max = -1;
    for (const c of checkpoints) max = Math.max(max, INTERVENTION_ORDER.indexOf(str(field(field(c, "data"), "intervention")) ?? ""));
    const maxText = max >= 0 ? (INTERVENTION_ORDER[max] ?? "none") : "none";
    sentry = `Sentry: ${checkpoints.length} checkpoints · max intervention: ${maxText}`;
  }
  const waves = num(field(run, "waves"));
  L.push(`${sentry} · Waves: ${waves === undefined ? "?" : String(waves)}${REPORTED}`);
  const stop = str(field(ledger, "stop_reason"));
  L.push(`Stop reason: ${stop === undefined ? "(not recorded)" : factText(stop)}`);

  // A4: unit economics.
  L.push("");
  L.push("## Unit economics");
  try {
    const econ = deps.economics(runDir, root, sessionId);
    const parts: string[] = [];
    const cost = fmtCost(field(econ, "cost_total"));
    parts.push(`Run spend ${fmtTokens(field(econ, "tokens_total"))} (${factText(str(field(econ, "tokens_source")) ?? "?")})${cost === null ? "" : ` · ${cost}`}`);
    if (field(econ, "zero_ship") === true) parts.push("per shipped — (0 shipped) ⚠ ZERO-SHIP");
    else {
      const ps = field(econ, "cost_per_shipped");
      if (isRecord(ps)) {
        const c = fmtCost(field(ps, "cost_each"));
        parts.push(`per shipped ${fmtTokens(field(ps, "tokens_each"))}${c === null ? "" : ` · ${c}`}`);
      }
    }
    const pa = field(econ, "cost_per_attempt");
    if (isRecord(pa)) parts.push(`per attempt ${fmtTokens(field(pa, "tokens_each"))} (${num(field(pa, "denom")) ?? 0})`);
    const buckets = field(econ, "buckets");
    const bucketText = Array.isArray(buckets) && buckets.length > 0
      ? buckets.map((b) => `${factText(str(field(b, "bucket")) ?? "?")} ${num(field(b, "count")) ?? 0}`).join("·")
      : "no build outcomes this run";
    parts.push(`per bucket ${bucketText}`);
    const perIssue = field(econ, "per_issue");
    if (Array.isArray(perIssue) && perIssue.length > 0) {
      parts.push(`per issue ${perIssue.map((p) => `${factText(str(field(p, "issue")) ?? "?")} ${fmtTokens(field(p, "tokens"))}`).join(", ")}`);
    }
    L.push(parts.join(" · "));
    const warnings = field(econ, "warnings");
    if (isStringArray(warnings)) for (const w of warnings) L.push(`⚠ ${factText(w)}`);
    if (field(field(budgetRec, "metering"), "degraded") === true) L.push("⚠ metering degraded at mint: estimate-only (budget.on_estimate_only: warn)");
  } catch (e) {
    L.push(`Unit economics unavailable (${factText(errText(e))})`);
  }

  // A5: methodology findings, only when a methodology skill is configured.
  if (methodology !== null) {
    L.push("");
    L.push(`## Methodology findings${REPORTED}`);
    const mf = field(run, "methodology_findings");
    const findings = field(mf, "findings");
    if (isStringArray(findings) && findings.length > 0) for (const f of findings) L.push(`- ${factText(f)}${REPORTED}`);
    else L.push("- (no methodology findings reported)");
    const prd = str(field(mf, "prd_distance"));
    if (prd !== undefined) L.push(`- PRD-distance: ${factText(prd)}${REPORTED}`);
  }

  // A6: build queue verdicts.
  const verdicts = field(run, "verdicts");
  const admitted = field(ledger, "admitted");
  L.push("");
  L.push("## Build queue verdicts at admission");
  const ff = num(field(verdicts, "fire_and_forget"));
  const lf = num(field(verdicts, "likely_fire"));
  L.push(`- fire-and-forget: ${ff === undefined ? "?" : String(ff)}${REPORTED}`);
  L.push(`- likely-fire: ${lf === undefined ? "?" : String(lf)}${REPORTED}`);
  L.push(`(admitted: ${Array.isArray(admitted) ? admitted.length : 0} total)`);

  // A7: routed out, by class.
  const routedOut = field(verdicts, "routed_out");
  const routedClasses = keysOf(routedOut).filter((k) => arr(field(routedOut, k)).length > 0);
  const routedLedger = idsWith("routed-out");
  if (routedClasses.length > 0 || routedLedger.length > 0) {
    L.push("");
    L.push("## Routed out (not built — needs human action)");
    const covered = new Set<string>();
    for (const cls of ["gap-blocked", "circular-blocked", "repeat-parked"].filter((c) => routedClasses.includes(c)).concat(routedClasses.filter((c) => !["gap-blocked", "circular-blocked", "repeat-parked"].includes(c)))) {
      const rows = field(routedOut, cls);
      if (!Array.isArray(rows)) continue;
      L.push("");
      L.push(`${factText(cls)}${cls === "repeat-parked" ? " ⚠" : ""} (${rows.length})${REPORTED}`);
      for (const row of rows) {
        const id = str(field(row, "id")) ?? "?";
        covered.add(id);
        const g = glossOf(id);
        const detail = str(field(row, "detail"));
        L.push(`- ${factText(id)}${g.text}${detail === undefined ? "" : ` — ${factText(detail)}`}${REPORTED}`);
      }
    }
    const rest = routedLedger.filter((id) => !covered.has(id));
    if (rest.length > 0) {
      L.push("");
      L.push(`unclassified (${rest.length})`);
      for (const id of rest) { const g = glossOf(id); L.push(label(`- ${factText(id)}${g.text}`, g.reported)); }
    }
  }

  // A8: resolve-attempts.
  const ra = field(run, "resolve_attempts");
  if (isRecord(ra)) {
    L.push("");
    L.push(`## Resolve-attempts (appetite high/full)${REPORTED}`);
    L.push(`- Attempted: ${num(field(ra, "attempted")) ?? "?"} — Succeeded (proceeded with audit trail): ${num(field(ra, "succeeded")) ?? "?"} — Failed (parked): ${num(field(ra, "failed")) ?? "?"}${REPORTED}`);
    const pm = field(ra, "proceeded_medium");
    const rows = Array.isArray(pm) ? pm : [];
    L.push("");
    L.push(`### Proceeded on medium confidence: ${rows.length}${REPORTED}`);
    if (rows.length > 0) L.push("> These shipped autonomously on an inferred answer. The audit-trail comment is on each PR — review before merge if you disagree; faff re-parks on a dissenting comment. Full record in `.faff/calibration/appetite-decisions/`.");
    for (const row of rows) {
      const id = str(field(row, "id")) ?? "?";
      const g = glossOf(id);
      const pr = num(field(row, "pr"));
      L.push(`- ${factText(id)}${g.text} — inferred ${factText(field(row, "inferred"))} from ${factText(field(row, "evidence"))}${pr === undefined ? "" : `; PR #${pr}`} (audit comment posted)${REPORTED}`);
    }
  }

  // A9/A10: shipped, under exactly one subsection (post-merge flagged wins a tie).
  const skipped = idList(ledger, "review_adversarial_skipped");
  const pmUnverified = idList(ledger, "post_merge_verification_unverified");
  const pmFailuresRaw = field(ledger, "post_merge_verification_failures");
  const pmFailures = new Map<string, unknown>();
  let pmFailuresBad: string | null = null;
  if (pmFailuresRaw !== undefined) {
    if (Array.isArray(pmFailuresRaw)) { for (const f of pmFailuresRaw) { const id = str(field(f, "issue")); if (id !== undefined) pmFailures.set(id, f); } }
    else pmFailuresBad = "- (could not read post_merge_verification_failures: not an array)";
  }
  const shipped = idsWith("shipped");
  const flagged = shipped.filter((id) => pmFailures.has(id) || pmUnverified.ids.includes(id));
  const skippedShipped = shipped.filter((id) => !flagged.includes(id) && skipped.ids.includes(id));
  const autoMerged = shipped.filter((id) => !flagged.includes(id) && !skippedShipped.includes(id));
  const issueLine = (id: string, tail: string, extraReported = false): string => {
    const t = titleOf(id);
    return label(`- ${factText(id)}${t.text}${prSuffix(id)}${tail}`, t.reported || extraReported);
  };
  L.push("");
  L.push(`## Shipped (auto-merged): ${autoMerged.length}`);
  for (const id of autoMerged) L.push(issueLine(id, ""));
  if (skipped.bad !== null) L.push(skipped.bad);
  if (skippedShipped.length > 0) {
    L.push("");
    L.push(`## Shipped (adversarial review skipped — chain outage): ${skippedShipped.length}`);
    for (const id of skippedShipped) L.push(issueLine(id, " — every adversarial backend was unreachable; merged on Phase-1 + AC + CI, WITHOUT a second-opinion pass (ledger: review_adversarial_skipped)"));
  }
  if (pmFailures.size > 0 || pmUnverified.ids.length > 0 || pmFailuresBad !== null || pmUnverified.bad !== null) {
    L.push("");
    L.push(`## Shipped (post-merge verification flagged): ${flagged.length}`);
    for (const id of flagged) {
      const f = pmFailures.get(id);
      if (f !== undefined) {
        const sha = str(field(f, "merge_sha"));
        L.push(issueLine(id, ` — merged main HEAD failed its own declared test command on re-run: \`${factText(str(field(f, "command")) ?? "?")}\`${sha === undefined ? "" : ` (sha \`${factText(sha.slice(0, 7))}\`)`}; tracker comment + discovered-scope entry filed, NOT reverted, NOT reopened (ledger: post_merge_verification_failures)`));
      } else {
        L.push(issueLine(id, " — no declared UNIT rung, or a worktree/execution error; verdict unobtainable, not a defect (ledger: post_merge_verification_unverified)"));
      }
    }
    if (pmFailuresBad !== null) L.push(pmFailuresBad);
    if (pmUnverified.bad !== null) L.push(pmUnverified.bad);
  }

  // A11: superseded.
  const superseded = idsWith("superseded");
  if (superseded.length > 0) {
    L.push("");
    L.push(`## Superseded (delivered by prior tickets): ${superseded.length}`);
    for (const id of superseded) {
      const t = titleOf(id);
      const rec = readJson(path.join(runDir, id, "supersession.json"));
      const by = field(rec, "superseded_by");
      const tail = isStringArray(by) && by.length > 0
        ? ` — deliverables already on \`main\` via ${by.map((b) => factText(b)).join(", ")} (supersession: \`.faff/runs/${runId}/${id}/supersession.json\`)`
        : " (supersession record missing)";
      L.push(label(`- ${factText(id)}${t.text}${tail}`, t.reported));
    }
  }

  // A12: PR open vs awaiting landing.
  const landing = idList(ledger, "landing_resumable");
  const prOpen = idsWith("pr-open");
  const awaitingLanding = prOpen.filter((id) => landing.ids.includes(id));
  const plainPrOpen = prOpen.filter((id) => !landing.ids.includes(id));
  L.push("");
  L.push(`## PR open for human review: ${plainPrOpen.length}`);
  for (const id of plainPrOpen) { const r = reasonOf(id); L.push(issueLine(id, r === null ? "" : ` — reason: ${r}`, r !== null)); }
  if (landing.bad !== null) L.push(landing.bad);
  if (landing.ids.length > 0) {
    L.push("");
    L.push(`## Awaiting landing (resumable): ${awaitingLanding.length}`);
    for (const id of awaitingLanding) L.push(issueLine(id, " — landing-time budget elapsed mid-CI-wait; PR open, non-draft; a later drain resumes the landing loop via the recovery-claim (ledger: landing_resumable)"));
  }

  // A13/A14: parked, and the build-side review-outage hold.
  const reviewOutage = idList(ledger, "review_outage_pending");
  const parkedAll = idsWith("parked", "parked-window");
  const outageHeld = parkedAll.filter((id) => reviewOutage.ids.includes(id));
  const parked = parkedAll.filter((id) => !reviewOutage.ids.includes(id));
  const parkRecords = field(run, "park_records");
  const records: unknown[] = Array.isArray(parkRecords) ? parkRecords : [];
  L.push("");
  L.push(`## Parked: ${parked.length}${REPORTED}`);
  for (const id of parked) {
    const t = titleOf(id);
    const rec = records.find((r) => field(r, "issue_id") === id);
    const r = reasonOf(id) ?? (rec === undefined ? null : `root cause ${factText(str(field(rec, "root_cause_class")) ?? "?")}`);
    L.push(label(`- ${factText(id)}${t.text}${r === null ? "" : ` — reason: ${r}`}`, t.reported || r !== null));
  }
  const parksJson = JSON.stringify(records);
  let longestRun = 0;
  for (const m of parksJson.match(/`+/g) ?? []) longestRun = Math.max(longestRun, m.length);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  L.push(`${fence}faff-parks`);
  L.push(parksJson);
  L.push(fence);
  if (reviewOutage.bad !== null) L.push(reviewOutage.bad);
  if (reviewOutage.ids.length > 0) {
    L.push("");
    L.push(`## Awaiting review (adversarial outage): ${outageHeld.length}`);
    for (const id of outageHeld) {
      const t = titleOf(id);
      L.push(label(`- ${factText(id)}${t.text} — review provider unavailable; build held (branch pushed, checkpoint intact); auto-resumes at review next drain (ledger: review_outage_pending)`, t.reported));
    }
  }

  // A15: the prep-side spec-review holds.
  const specHolds: Array<[string, string, string]> = [
    ["spec_review_outage_pending", "Awaiting spec-review (adversarial outage)", "spec-review provider unavailable; spec attached and held; auto-resumes at review next prep drain (ledger: spec_review_outage_pending)"],
    ["spec_review_turn_budget_pending", "Awaiting spec-review (slow fan-out)", "spec-review did not finish this turn; spec attached and held; auto-resumes at review next prep drain (ledger: spec_review_turn_budget_pending)"],
  ];
  for (const [name, heading, tail] of specHolds) {
    const list = idList(ledger, name);
    if (list.bad !== null) { L.push(""); L.push(`## ${heading}`); L.push(list.bad); continue; }
    if (list.ids.length === 0) continue;
    L.push("");
    L.push(`## ${heading}: ${list.ids.length}`);
    for (const id of list.ids) { const t = titleOf(id); L.push(label(`- ${factText(id)}${t.text} — ${tail}`, t.reported)); }
  }

  // A16: errored.
  const errored = idsWith("errored");
  L.push("");
  L.push(`## Errored: ${errored.length}`);
  for (const id of errored) {
    const t = titleOf(id);
    const r = reasonOf(id);
    L.push(label(`- ${factText(id)}${t.text}${r === null ? "" : ` — ${r}`}`, t.reported || r !== null));
  }

  // A17: unreached (budget hit).
  const unreached = idsWith("unreached-budget");
  if (unreached.length > 0) {
    L.push("");
    L.push(`## Unreached (budget hit): ${unreached.length}`);
    let tokensSource = "(tokens_source unknown)";
    let breached: string[] = [];
    try {
      const nowMs = Number.isFinite(endMs) ? endMs : startMs;
      const state = deps.budget(runDir, root, sessionId, nowMs);
      const b = field(state, "breached");
      if (isStringArray(b)) breached = b;
      const ts = str(field(state, "tokens_source"));
      if (ts !== undefined) tokensSource = `tokens_source: ${factText(ts)}`;
    } catch { tokensSource = "(tokens_source unknown)"; }
    for (const id of unreached) { const t = titleOf(id); L.push(label(`- ${factText(id)}${t.text} — admitted to build queue, not dispatched`, t.reported)); }
    if (breached.some((d) => d === "tokens" || d === "cost")) L.push(`- breached: ${breached.map((d) => factText(d)).join(", ")} · ${tokensSource}`);
  }

  // A18: product-incomplete, only when the holdout phase ran (its run record exists).
  const holdout = readJson(path.join(input.root, ".faff", "holdout", `${runId}.json`));
  if (holdout !== undefined) {
    L.push("");
    L.push("## Product-incomplete (holdout escalation)");
    L.push(`- Aggregate: ${factText(str(field(holdout, "aggregate")) ?? "?")} (holdout: \`.faff/holdout/${runId}.json\`)`);
    let counts: { [code: string]: number } = {};
    const fromFile = field(holdout, "needs_human_reasons");
    if (isRecord(fromFile)) { for (const k of keysOf(fromFile)) { const n = num(field(fromFile, k)); if (n !== undefined) counts[k] = n; } }
    else { const criteria = field(holdout, "criteria"); counts = contractEvidence.rollupNeedsHumanReasons(Array.isArray(criteria) ? criteria : []); }
    const envCodes = holdoutApi.HOLDOUT_REASON_CODES.filter((c) => c !== "human-only").concat(["unspecified"]);
    const env = keysOf(counts).filter((k) => envCodes.includes(k));
    const unknown = keysOf(counts).filter((k) => !envCodes.includes(k) && k !== "human-only");
    if (env.length > 0) L.push(`- Environment gaps (fix the env and re-run): ${env.map((k) => `${factText(k)} ${counts[k] ?? 0}`).join(", ")}`);
    if (counts["human-only"] !== undefined) L.push(`- Human-only: ${counts["human-only"]}`);
    if (unknown.length > 0) L.push(`- Unrecognised reason codes: ${unknown.map((k) => `${factText(k)} ${counts[k] ?? 0}`).join(", ")}`);
  }

  // A19: ground-truth divergences from reconcileCore over an input assembled here (§3).
  const ground = groundTruth(runDir, ledger, tracker, deps, outcomes);
  if (ground.lines.length > 0 || ground.divergences.length > 0) {
    L.push("");
    const suffix = ground.disposition === "needs-human" ? " — ESCALATED" : ground.disposition === "warn" ? " — warn" : "";
    L.push(`## Ground-truth divergences: ${ground.divergences.length}${suffix}`);
    for (const d of ground.divergences) L.push(`- [${factText(d.class)}] ${factText(d.issue ?? "run")}: ${factText(d.detail)}`);
    for (const line of ground.lines) L.push(line);
  }

  // A20: inferred build-order deps.
  const inferred = field(run, "inferred_deps");
  const edges = Array.isArray(field(inferred, "edges")) ? arr(field(inferred, "edges")) : arr(inferred);
  if (edges.length > 0) {
    L.push("");
    L.push(`## Inferred build-order deps: ${edges.length} (run-local — no tracker write)${REPORTED}`);
    for (const e of edges) {
      if (typeof e === "string") { L.push(`- ${factText(e)}${REPORTED}`); continue; }
      const note = str(field(e, "note"));
      L.push(`- ${factText(field(e, "consumer"))} ← ${factText(field(e, "producer"))}${note === undefined ? "" : `: ${factText(note)}`}${REPORTED}`);
    }
    for (const a of arr(field(inferred, "ambiguous"))) {
      L.push(`- Surfaced, not serialised: ${factText(field(a, "id"))}: ${factText(field(a, "text"))}${REPORTED}`);
    }
    for (const c of arr(field(inferred, "cycles"))) {
      L.push(`- Cycle flagged (likely spec error): ${factText(c)}${REPORTED}`);
    }
  }

  // A21: discovered scope.
  const filedCount = num(field(ledger, "discovered_scope_filed"));
  const ds = field(run, "discovered_scope");
  if ((filedCount !== undefined && filedCount > 0) || isRecord(ds)) {
    L.push("");
    L.push(`## Discovered scope (execution-reported): ${filedCount ?? 0} filed`);
    const filed = field(ds, "filed");
    for (const f of Array.isArray(filed) ? filed : []) {
      L.push(`- ${factText(field(f, "from"))} → filed ${factText(field(f, "id"))} (${factText(field(f, "relationship"))}): "${factText(field(f, "title"))}"${REPORTED}`);
    }
    if (isRecord(ds)) {
      const surfaced = field(ds, "surfaced");
      const surfacedRows = Array.isArray(surfaced) ? surfaced : [];
      L.push(`- Deduped (already tracked): ${num(field(ds, "deduped")) ?? 0} — Surfaced only (vague, or low appetite): ${surfacedRows.length}${REPORTED}`);
      for (const s of surfacedRows) L.push(`  - ${factText(field(s, "id"))}: "${factText(field(s, "text"))}" — ${factText(field(s, "why"))}${REPORTED}`);
    }
  }

  // A22: human follow-ups.
  const followUps = field(run, "follow_ups");
  if (isStringArray(followUps) && followUps.length > 0) {
    L.push("");
    L.push(`## Human follow-ups: ${followUps.length}${REPORTED}`);
    for (const f of followUps) L.push(`- ${factText(f)}${REPORTED}`);
  }

  // A23: prep summary and tidy, full mode only.
  if (modeOf(runId, ledger) === "full") {
    const ps = field(run, "prep_summary");
    if (isRecord(ps)) {
      L.push("");
      L.push(`## Prep queue summary (full mode only)${REPORTED}`);
      const prepRows: Array<[string, string]> = [["refreshed", "Refreshed"], ["promoted", "Promoted"], ["promoted_needs_review", "Promoted (needs review, medium confidence)"], ["parked", "Parked"], ["errored", "Errored"]];
      for (const [k, name] of prepRows) {
        L.push(`- ${name}: ${num(field(ps, k)) ?? 0}${REPORTED}`);
      }
    }
    const tidy = str(field(run, "tidy_log"));
    if (tidy !== undefined) {
      L.push("");
      L.push(`## Tidy findings (full mode only) — see ${factText(tidy)}${REPORTED}`);
    }
  }

  if (forgeFailures.length > 0) {
    L.push("");
    for (const f of forgeFailures) L.push(f);
  }
  if (facts.unknownKeys.length > 0) {
    L.push("");
    L.push(`⚠ facts: unknown key(s) ${facts.unknownKeys.map((k) => factText(k)).join(", ")}`);
  }
  return L.out.join("\n") + "\n";
}

// --- §3 ReconcileInput assembly + §4.1 step 5. ---

type Ground = { divergences: Divergence[]; disposition: string; lines: string[] };

function assembleReconcileInput(runDir: string, ledger: unknown, tracker: unknown, deps: Deps, outcomes: Array<[string, string]>): { input: { [k: string]: unknown } | null; lines: string[] } {
  const lines: string[] = [];
  const shipped = outcomes.filter(([, o]) => o === "shipped").map(([id]) => id);
  const supersededIds = outcomes.filter(([, o]) => o === "superseded").map(([id]) => id);
  const baselinePath = path.join(runDir, "sibling-baseline.json");
  const baselineRaw = readJson(baselinePath);
  const baseline = Array.isArray(baselineRaw) ? baselineRaw : null;
  if (shipped.length === 0 && supersededIds.length === 0 && baseline === null && !fs.existsSync(baselinePath)) return { input: null, lines };

  const input: { [k: string]: unknown } = { level: field(ledger, "level") };
  input["shipped"] = shipped.map((id) => {
    const recorded = readJson(path.join(runDir, id, "merge-record.json"));
    const observed: { [k: string]: unknown } = {};
    const pr = num(field(recorded, "pr"));
    if (pr !== undefined && pr > 0) {
      // Head against head: recorded.head_sha is the PR head merge-gate pinned, so the forge's
      // headRefOid is the comparable value (step 11.5's rule; a squash mints a new commit sha).
      const r = deps.ghJson(["pr", "view", String(pr), "--json", "state,headRefOid"]);
      if (r.ok) {
        observed["pr_merged"] = field(r.data, "state") === "MERGED";
        observed["merged_head_sha"] = field(r.data, "headRefOid");
      } else {
        lines.push(`- could not read forge: ${factText(id)} PR #${pr}: ${factText(r.stderr || "gh failed")}`);
      }
    }
    return { issue: id, recorded: isRecord(recorded) ? recorded : null, observed };
  });
  if (baseline !== null) input["sibling_baseline"] = { captured: true, entry_count: baseline.length };

  if (!isRecord(tracker)) {
    if (supersededIds.length > 0 || (baseline !== null && baseline.length > 0)) {
      lines.push("- could not read tracker observations: superseded and sibling checks not run _(reported input missing)_");
    }
    return { input, lines };
  }
  const delivered = field(tracker, "superseded_delivered");
  input["superseded"] = supersededIds.map((id) => {
    const rec = readJson(path.join(runDir, id, "supersession.json"));
    const d = field(delivered, id);
    return { issue: id, recorded: isRecord(rec) ? rec : null, observed: typeof d === "boolean" ? { all_delivered: d } : {} };
  });
  const ends = field(tracker, "sibling_end_states");
  const admitted = field(ledger, "admitted");
  const missing: string[] = [];
  input["siblings"] = (baseline ?? []).map((entry) => {
    const id = str(field(entry, "issue")) ?? "";
    const end = field(field(ends, id), "end_state_terminal");
    if (typeof end !== "boolean") missing.push(id);
    return {
      issue: id,
      start_state_terminal: field(entry, "start_state_terminal") === true,
      end_state_terminal: end === true,
      admitted: isStringArray(admitted) && admitted.includes(id),
    };
  });
  if (missing.length > 0) lines.push(`- could not read tracker observations for sibling(s): ${missing.map((m) => factText(m)).join(", ")}${REPORTED}`);
  return { input, lines };
}

function groundTruth(runDir: string, ledger: unknown, tracker: unknown, deps: Deps, outcomes: Array<[string, string]>): Ground {
  const { input, lines } = assembleReconcileInput(runDir, ledger, tracker, deps, outcomes);
  if (input === null) return { divergences: [], disposition: "pass", lines };
  const problem = reconcileApi.validateReconcileInput(input);
  if (problem !== null) return { divergences: [], disposition: "pass", lines: [`- could not read reconcile input: ${factText(problem)}`, ...lines] };
  const result = reconcileApi.reconcileCore(input);
  return { divergences: result.divergences, disposition: result.disposition, lines };
}

// --- The verb. ---

const SUMMARY_SPEC = {
  flags: {
    "--run-dir": { arity: 1 },
    "--facts": { arity: 1 },
    "--root": { arity: 1 },
    "--session-id": { arity: 1 },
    "--out": { arity: 1 },
  },
};
const SUMMARY_USAGE = "usage: faff run summary --run-dir DIR [--facts FILE] [--root DIR] [--session-id ID] [--out FILE]";

function cmdRunSummary(args: string[], deps: Deps = realDeps()): number {
  const { values, errors } = argvApi.parseArgs(args, SUMMARY_SPEC);
  if (errors.length) return argvApi.usageError(errors, SUMMARY_USAGE);
  const runDir = str(values["--run-dir"]);
  if (runDir === undefined || runDir === "") return argvApi.usageError([{ code: "missing-required", detail: "--run-dir DIR is required" }], SUMMARY_USAGE);
  let root: string;
  try { root = str(values["--root"]) ?? sharedInfra.findRoot(); }
  catch (e) { process.stderr.write(`faff run summary: cannot resolve the repo root: ${errText(e)}\n`); return 2; }
  let text: string;
  try {
    text = renderRunSummary({ runDir, factsPath: str(values["--facts"]) ?? null, root, sessionId: str(values["--session-id"]) ?? null }, deps);
  } catch (e) {
    if (e instanceof LedgerFault) { process.stderr.write(`faff run summary: ${e.message}\n`); return 2; }
    throw e;
  }
  const out = str(values["--out"]) ?? path.join(runDir, "summary.md");
  const tmp = `${out}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, out);
  } catch (e) {
    process.stderr.write(`faff run summary: cannot write ${out}: ${errText(e)}\n`);
    return 2;
  }
  process.stdout.write(text);
  return 0;
}

module.exports = { cmdRunSummary, renderRunSummary, assembleReconcileInput, readFacts, factText, realDeps, LedgerFault };
