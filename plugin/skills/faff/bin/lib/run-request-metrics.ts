// === region:factory — run-request-metrics — observations from an owned Claude session epoch ===
import { createHash } from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";

const budget = require("./budget");
const { phaseWindowsFromEvents, readRunEvents } = require("./economics");
const { readLeafNoFollow } = require("./leaf-read");

type Obj = Record<string, unknown>;
function isObj(v: unknown): v is Obj { return typeof v === "object" && v !== null && !Array.isArray(v); }
const obj = (v: unknown): Obj => isObj(v) ? v : {};
const num = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const dateMs = (s: unknown) => typeof s === "string" && /^\d{4}-\d\d-\d\dT/.test(s) ? Date.parse(s) : NaN;
const issueKey = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const modelId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/;
type TokenClass = "input" | "output" | "cache_read" | "cache_write" | "cache_write_5m" | "cache_write_1h";
const classes: TokenClass[] = ["input", "output", "cache_read", "cache_write", "cache_write_5m", "cache_write_1h"];
type Usage = Record<TokenClass, number | null>;
type Role = "parent" | "worker";
type Phase = "prep" | "build";

export interface WorkerHandoff {
  dispatch_id: string;
  build_wave?: number;
  returned_at: string | null;
  returned_text_bytes: number | null;
  is_error: boolean | null;
}
export interface RequestObservation {
  // Per-call evidence for idempotent partial refreshes. Keys are truncated SHA-256
  // digests. Bits 1/2 mean observed success/error. Both bits mean uncertain.
  tool_outcome_bits?: Record<string, number>;
  tool_coverage_incomplete?: true;
  bash_cli_usage_diagnostic?: boolean;
  enclosing_build_wave?: number;
  worker_dispatch_id?: string;
  worker_handoffs?: WorkerHandoff[];
  id: string;
  at: string;
  role: Role;
  model: string | null;
  issue: string | null;
  phase: Phase | null;
  wave: number | null;
  verification_to_handoff: true | null;
  turn_id: string | null;
  usage: Usage;
}
export interface RequestMetricsOptions {
  runDir: string; root: string; sessionId?: string | null; env?: NodeJS.ProcessEnv;
  since: string; until: string;
}
interface PhaseWindow { issue: string; phase: Phase; start_ts: string | null; end_ts: string | null }
interface Candidate {
  id: string; ms: number; usageAt: number; usage: Usage; role: Role; model: string | null;
  issues: Set<string>; waves: Set<number>; launches: Set<string>; turn: string | null;
}
// A matching excerpt can also come from a test or a log. Record its presence only.
function hasCliUsageDiagnostic(content: unknown): boolean {
  const matches = (text: unknown) => typeof text === "string" &&
    /^faff: (?:unknown-flag|bad-enum|missing-value|too-many-positionals|duplicate-flag|bad-value):[^\n]*\n(?:faff: [^\n]*\n)*usage: faff [a-z][a-z0-9-]*\b/m.test(text);
  return matches(content) || (Array.isArray(content) && content.some(item => matches(obj(item).text)));
}
function projectedUsage(raw: unknown): Usage {
  const u = obj(raw), ttl = obj(u.cache_creation);
  const five = num(ttl.ephemeral_5m_input_tokens), hour = num(ttl.ephemeral_1h_input_tokens);
  const total = num(u.cache_creation_input_tokens) ?? (five !== null && hour !== null ? five + hour : null);
  return { input: num(u.input_tokens), output: num(u.output_tokens), cache_read: num(u.cache_read_input_tokens),
    cache_write: total, cache_write_5m: five, cache_write_1h: hour };
}
function fileText(file: string): string | null {
  try { return readLeafNoFollow(file).bytes?.toString("utf8") ?? null; } catch { return null; }
}
// A legacy child sits next to the parent. Newer clients nest agent files under
// the parent session. In either layout each file still has to identify its owner.
function children(dir: string, optional: boolean, warnings: Set<string>): string[] {
  try {
    if (!fs.lstatSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir, {withFileTypes: true})
      .filter(entry => entry.isFile() && /^agent-[A-Za-z0-9_-]+\.jsonl$/.test(entry.name))
      .map(entry => path.join(dir, entry.name)).sort();
  } catch (err) {
    if (!optional || obj(err).code !== "ENOENT") warnings.add("worker-discovery-unavailable");
    return [];
  }
}

// Read one JSON line at a time. A transcript can outgrow the heap. Preserve
// partial coverage on a malformed or unusually large (>32 MiB) record.
function* lines(file: string): Generator<string | null> {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("not-regular");
    const chunk = Buffer.allocUnsafe(128 * 1024);
    let carry: Buffer[] = [], length = 0;
    while (true) {
      const n = fs.readSync(fd,chunk,0,chunk.length,null);
      if (!n) break;
      let start = 0;
      while (start < n) {
        const newline = chunk.subarray(start,n).indexOf(10);
        const end = newline < 0 ? n : start + newline;
        length += end-start;
        if (length <= 32*1024*1024) carry.push(Buffer.from(chunk.subarray(start,end)));
        else carry = [];
        if (newline >= 0) {
          yield length <= 32*1024*1024 ? Buffer.concat(carry).toString("utf8") : null;
          carry = []; length = 0;
        }
        start = end+1;
      }
    }
    if (length) yield length <= 32*1024*1024 ? Buffer.concat(carry).toString("utf8") : null;
  } finally { fs.closeSync(fd); }
}
function owner(file: string): string | null {
  for (const line of lines(file)) {
    if (!line) continue;
    try {
      const row = obj(JSON.parse(line));
      const sid = row.sessionId ?? row.session_id;
      if (typeof sid === "string" && sid) return sid;
    } catch { /* old children can start with a partial line */ }
  }
  return null;
}
function metadata(file: string): Obj {
  try { return obj(JSON.parse(fileText(file) ?? "null")); } catch { return {}; }
}
function sole<T>(values: Set<T>): T | null {
  return values.size === 1 ? [...values][0] ?? null : null;
}
// Only issue keys independently seen in this ledger or event stream may escape the collector.
function descriptionFacts(value: unknown, allowed: Set<string>) {
  const description = typeof value === "string" ? value : "";
  const issues = new Set((description.match(/\b[A-Za-z][A-Za-z0-9]*-\d+\b/g) ?? []).filter(k => allowed.has(k)));
  const waves = new Set<number>();
  for (const m of description.matchAll(/\bwave[ -]([1-9][0-9]*)\b/ig)) {
    const n = num(Number(m[1]));
    if (n !== null) waves.add(n);
  }
  return { issues, waves };
}

// Keep only a whitelisted issue and the invocation link, never the description or prompt.
// A dispatch naming several issues or a foreign key cannot establish a single work item.
interface Dispatch { issue: string | null; parent: string | null; blocked: boolean }
function rememberDispatch(dispatches: Map<string, Dispatch>, id: string, description: unknown, parent: string | null, allowed: Set<string>) {
  const keys = new Set(typeof description === "string" ? description.match(/\b[A-Za-z][A-Za-z0-9]*-\d+\b/g) ?? [] : []);
  const key = sole(keys);
  const issue = key && allowed.has(key) ? key : null;
  const old = dispatches.get(id);
  const blocked = (keys.size > 0 && !issue) || Boolean(old && (old.blocked || old.issue !== issue || old.parent !== parent));
  dispatches.set(id, { issue, parent, blocked });
}
function dispatchedIssue(launches: Set<string>, dispatches: Map<string, Dispatch>): string | null {
  let id = sole(launches);
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const dispatch = dispatches.get(id);
    if (!dispatch || dispatch.blocked) return null;
    if (dispatch.issue) return dispatch.issue;
    id = dispatch.parent;
  }
  return null;
}

// A relationship to a build dispatch can span inner review or verification work.
function buildWaveOf(launches: Set<string>, tagged: Map<string, number | null>, dispatches: Map<string, Dispatch>) {
  let id = sole(launches);
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    if (tagged.has(id)) return tagged.get(id) ?? null;
    id = dispatches.get(id)?.parent ?? null;
  }
  return null;
}

function boundaries(events: unknown[], allowed: Set<string>) {
  const windows: PhaseWindow[] = phaseWindowsFromEvents(events);
  return windows.filter(w => allowed.has(w.issue)).map(w => ({ issue: w.issue, phase: w.phase,
    start: dateMs(w.start_ts), end: dateMs(w.end_ts) }));
}
// A run-done capture is written by the wave consult with its actual ordinal. Bound
// a wave only between its first work event and its consult, and only when numbered
// boundaries are consecutive. Bootstrap, gaps and reporting stay unattributed.
function waveWindows(events: unknown[], run: string) {
  const waves: {wave:number; start:number; end:number}[] = [];
  const prefix = run + "/__run__/run-done/";
  let previous = 0, start = NaN;
  for (const event of events.map(obj)) {
    const ms = dateMs(event.ts);
    if (!Number.isFinite(ms)) continue;
    if (!Number.isFinite(start) && ["prep-start","issue-admitted","build-start"].includes(String(event.type))) start = ms;
    const data = obj(event.data);
    if (event.type !== "decision-capture" || data.kernel !== "run-done" || event.issue !== "__run__" ||
        typeof data.correlation_id !== "string" || !data.correlation_id.startsWith(prefix)) continue;
    const ordinal = data.correlation_id.slice(prefix.length);
    if (!/^[1-9][0-9]*$/.test(ordinal)) continue;
    const wave = Number(ordinal);
    if (wave === previous + 1 && Number.isFinite(start) && start <= ms) waves.push({wave,start,end:ms});
    previous = wave;
    start = NaN;
  }
  return waves;
}
function usageSum(previous: Usage, next: Usage): Usage {
  const sum = { ...previous };
  for (const key of classes) {
    const a = previous[key], b = next[key];
    sum[key] = a !== null && b !== null ? a + b : null;
  }
  return sum;
}

export function collectRunRequestMetrics({ runDir, root, sessionId, env = process.env, since, until }: RequestMetricsOptions) {
  const warnings = new Set<string>();
  const records: RequestObservation[] = [];
  const byModel = new Map<string, { requests: number; usage: Usage }>();
  const coverage = { files: 0, parent_responses: 0, worker_responses: 0, responses_with_usage: 0,
    responses_with_issue: 0, responses_with_phase: 0, responses_with_wave: 0, responses_with_turn: 0 };
  let available = false;
  function report() {
    const turns = records.length && coverage.responses_with_turn === records.length
      ? new Set(records.map(r => r.turn_id)).size : null;
    const status: "unavailable" | "partial" | "observed" = !available ? "unavailable" : warnings.size ? "partial" : "observed";
    return { schema: 1, status,
      requests: available ? records.length : null, turns, coverage, warnings: [...warnings].sort(),
      by_model: Object.fromEntries(byModel), records };
  }
  const lo = dateMs(since), hi = dateMs(until);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) { warnings.add("epoch-boundaries-unavailable"); return report(); }
  if (!sessionId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId)) { warnings.add("session-unavailable"); return report(); }
  const base = budget.transcriptBaseDir(root, env);
  const parentFile = path.join(base, sessionId + ".jsonl");
  let files: string[];
  if (typeof budget.ownedChildTranscriptFiles === "function") {
    files = [parentFile, ...budget.ownedChildTranscriptFiles(base, sessionId, null, budget.NATIVE_RESPONSE_METER)];
  } else {
    const owned = path.join(base, sessionId);
    let nested: string[] = [];
    try {
      if (fs.lstatSync(owned).isDirectory()) nested = children(path.join(owned,"subagents"),true,warnings);
    } catch (err) { if (obj(err).code !== "ENOENT") warnings.add("worker-discovery-unavailable"); }
    files = [parentFile, ...children(base,false,warnings), ...children(path.join(base,"subagents"),true,warnings), ...nested];
  }
  const ledger = metadata(path.join(runDir, "run-ledger.json"));
  const { events, malformed }: { events: unknown[]; malformed: number } = readRunEvents(runDir);
  if (malformed) warnings.add("malformed-event");
  const keys = [...Object.keys(obj(ledger.outcomes)), ...(Array.isArray(ledger.admitted) ? ledger.admitted : []), ...events.map(e => obj(e).issue)];
  const allowed = new Set(keys.filter((key): key is string => typeof key === "string" && issueKey.test(key)));
  const windows = boundaries(events, allowed);
  const waves = waveWindows(events,path.basename(runDir));
  // The standalone graft run ID is bound to its issue at mint. Other one-item
  // batches can still do unrelated prep, so admitted cardinality alone is insufficient.
  const standalone = /-graft-([A-Za-z][A-Za-z0-9]*-\d+)$/.exec(path.basename(runDir))?.[1];
  const standaloneIssue = standalone && allowed.has(standalone) ? standalone : null;
  const candidates = new Map<string, Candidate>();
  const dispatches = new Map<string, Dispatch>();
  const tagged = new Map<string, number | null>();
  const toolScopes = new Map<string, Map<string, Set<string>>>();
  const toolOwners = new Map<string, string | null>();
  const incompleteTools = new Set<string>();
  const bashCalls = new Set<string>();
  const usageDiagnostics = new Set<string>();
  const toolResults = new Map<string, number>();
  const issued = new Map<string, Set<string>>();
  const returns = new Map<string, { at: string; bytes: number | null; error: boolean }>();
  const verifications = new Map<string, number[]>();
  const handoffs = new Map<string, number[]>();
  function mark(table: Map<string, number[]>, issue: unknown, ms: number) {
    if (typeof issue !== "string" || !allowed.has(issue) || !Number.isFinite(ms)) return;
    const times = table.get(issue) ?? [];
    times.push(ms); table.set(issue, times);
  }
  for (const [idx, file] of files.entries()) {
    try {
      if (idx && typeof budget.ownedChildTranscriptFiles !== "function" && owner(file) !== sessionId) continue;
      const sidecar = idx ? metadata(file.replace(/\.jsonl$/, ".meta.json")) : {};
      const hints = descriptionFacts(sidecar.description, allowed);
      const verifyTools = new Set<string>();
      for (const line of lines(file)) {
        if (line === null) { warnings.add("oversize-transcript-row"); continue; }
        if (!line.trim()) continue;
        let row: Obj;
        try { row = obj(JSON.parse(line)); } catch { warnings.add("malformed-transcript-row"); continue; }
        if ([row.sessionId, row.session_id].some(id => typeof id === "string" && id !== sessionId)) continue;
        const msg = obj(row.message), ms = dateMs(row.timestamp);
        const blocks = Array.isArray(msg.content) ? msg.content.map(obj) : [];
        // A stream can interleave parent and worker results. Disk child transcripts
        // also have a distinct scope when their stream parent ID is absent.
        const scope = JSON.stringify([idx, row.parent_tool_use_id ?? null]);
        // A structured receipt is evidence of a successful verification. A command invocation alone is not.
        if (row.type === "user") for (const b of blocks) {
          if (b.type === "tool_result" && typeof b.tool_use_id === "string" && ms >= lo && ms < hi) {
            const resultKey = JSON.stringify([scope, b.tool_use_id]);
            const bits = b.is_error === true ? 2 : b.is_error === undefined || b.is_error === false ? 1 : 3;
            toolResults.set(resultKey, (toolResults.get(resultKey) ?? 0) | bits);
            const content = b.content;
            if (hasCliUsageDiagnostic(content)) usageDiagnostics.add(resultKey);
            const bytes = typeof content === "string" ? Buffer.byteLength(content) : Array.isArray(content)
              ? content.reduce((n: number, item: unknown) => {
                const text = obj(item).text;
                return n + (typeof text === "string" ? Buffer.byteLength(text) : 0);
              }, 0) : null;
            returns.set(b.tool_use_id, {at: new Date(ms).toISOString(), bytes, error: b.is_error === true});
          }
          if (b.type !== "tool_result" || b.is_error || typeof b.tool_use_id !== "string" || !verifyTools.has(b.tool_use_id)) continue;
          const payload = typeof b.content === "string" ? b.content : obj(Array.isArray(b.content) && b.content.length === 1 ? b.content[0] : null).text;
          if (typeof payload !== "string") continue;
          try {
            const result = obj(JSON.parse(payload)), spec = obj(result.spec);
            if (result.action === "verify-criteria" && spec.token === "verified") mark(verifications, spec.issue, ms);
          } catch { /* decorated output does not establish a boundary */ }
        }
        if ((row.type !== "assistant" && msg.role !== "assistant") || msg.model === "<synthetic>" || row.isApiErrorMessage === true) continue;
        const id: string | null = typeof budget.nativeResponseId === "function" ? budget.nativeResponseId(row,budget.NATIVE_RESPONSE_METER)
          : typeof msg.id === "string" && /^msg_[A-Za-z0-9_-]+$/.test(msg.id) ? msg.id : null;
        if (!id || !Number.isFinite(ms)) {
          if (!Number.isFinite(ms) || (ms >= lo && ms < hi)) warnings.add(!id ? "assistant-response-id-unavailable" : "response-time-unavailable");
          continue;
        }
        if (ms >= hi) continue;
        const role = idx > 0 || row.isSidechain === true || typeof row.parent_tool_use_id === "string" ? "worker" : "parent";
        const r: Candidate = candidates.get(id) ?? { id, ms, usageAt: -Infinity, usage: projectedUsage(null), role, model: null,
          issues: new Set<string>(), waves: new Set<number>(), launches: new Set<string>(), turn: null };
        candidates.set(id, r);
        const parentId = typeof row.parent_tool_use_id === "string" ? row.parent_tool_use_id
          : typeof sidecar.toolUseId === "string" ? sidecar.toolUseId : null;
        if (parentId && role === "worker") r.launches.add(parentId);
        r.ms = Math.min(r.ms, ms);
        if (role === "worker") r.role = role;
        if (typeof msg.model === "string" && modelId.test(msg.model)) r.model = msg.model;
        if (typeof row.turnId === "string" && row.turnId) r.turn = hash(sessionId + "\0" + (idx ? path.basename(file) : "parent") + "\0" + row.turnId);
        const usage = msg.usage ?? row.usage;
        if (usage && ms >= r.usageAt && ms < hi) { r.usage = projectedUsage(usage); r.usageAt = ms; }
        for (const key of hints.issues) r.issues.add(key);
        for (const n of hints.waves) r.waves.add(n);
        if (!Array.isArray(msg.content) && typeof msg.content !== "string") incompleteTools.add(id);
        for (const b of blocks) {
          if (b.type === "text" && role === "worker" && typeof b.text === "string" && b.text.trimStart().startsWith("{")) {
            try {
              const receipt = obj(JSON.parse(b.text));
              if (receipt.outcome === "pr-ready") mark(handoffs, receipt.issue, ms);
            } catch { /* prose cannot establish a handoff */ }
          }
          if (b.type !== "tool_use") continue;
          if (typeof b.id === "string" && b.id.length) {
            const calls = toolScopes.get(id) ?? new Map<string, Set<string>>();
            const scopes = calls.get(b.id) ?? new Set<string>();
            const key = JSON.stringify([scope, b.id]);
            if (b.name === "Bash") bashCalls.add(key);
            if (!toolOwners.has(key)) toolOwners.set(key, id);
            else if (toolOwners.get(key) !== id) toolOwners.set(key, null);
            scopes.add(key);
            calls.set(b.id, scopes);
            toolScopes.set(id, calls);
          } else incompleteTools.add(id);
          const input = obj(b.input);
          if (ms >= lo && (b.name === "Agent" || b.name === "Task") && typeof b.id === "string") {
            const calls = issued.get(id) ?? new Set<string>();
            calls.add(b.id);
            issued.set(id, calls);
            const description = typeof input.description === "string" ? input.description : "";
            const tags = [...description.matchAll(/(?:^|\s)faff-build-wave:([^\s]+)/g)];
            if (tags.length) {
              const match = tags[0]?.[1] ?? "";
              const number = Number(match);
              const value = tags.length === 1 && /^[1-9][0-9]*$/.test(match) && Number.isSafeInteger(number) ? number : null;
              tagged.set(b.id, tagged.has(b.id) && tagged.get(b.id) !== value ? null : value);
            }
            rememberDispatch(dispatches, b.id, input.description, parentId, allowed);
          }
          for (const key of [input.issue, input.id, input.issueId]) {
            if (typeof key === "string" && allowed.has(key)) r.issues.add(key);
          }
          if (b.name === "Bash" && typeof input.command === "string" && typeof b.id === "string" &&
              /(?:^|[;\n&])\s*(?:faff|"\$faff"|\$faff)\s+graft\s+verify-build(?:\s|$)/.test(input.command)) verifyTools.add(b.id);
        }
      }
      coverage.files++;
      available = true;
    } catch { warnings.add(idx ? "unreadable-worker-transcript" : "unreadable-parent-transcript"); }
  }
  for (const r of [...candidates.values()].filter(r => r.ms >= lo && r.ms < hi).sort((a,b) => a.ms-b.ms || a.id.localeCompare(b.id))) {
    const directIssue = r.issues.size ? sole(r.issues) : standaloneIssue;
    const issue = r.role === "worker" && !r.issues.size && !directIssue ? dispatchedIssue(r.launches, dispatches) : directIssue;
    for (const w of waves) if (w.start <= r.ms && r.ms <= w.end) r.waves.add(w.wave);
    const buildWave = buildWaveOf(r.launches, tagged, dispatches);
    const wave = buildWave ?? sole(r.waves);
    const active = windows.filter(w => (!directIssue || w.issue === directIssue) && w.start <= r.ms && r.ms <= w.end);
    const phase: Phase | null = sole(new Set(active.map(w => w.phase))) ?? (directIssue && directIssue === standaloneIssue ? "build" : null);
    const interval = Boolean(issue) && active.some(w => w.issue === issue && w.phase === "build" && (verifications.get(w.issue) ?? []).some(v => v >= w.start && v <= r.ms &&
      (handoffs.get(w.issue) ?? []).some(h => h >= r.ms && h <= w.end)));
    const row: RequestObservation = { id: hash(r.id), at: new Date(r.ms).toISOString(), role: r.role, model: r.model,
      issue, wave, phase, verification_to_handoff: interval || null, turn_id: r.turn, usage: r.usage };
    row.tool_outcome_bits = {};
    row.bash_cli_usage_diagnostic = false;
    for (const [call, scopes] of toolScopes.get(r.id) ?? []) {
      let bits = 0;
      for (const scopedCall of scopes) {
        if (toolOwners.get(scopedCall) === r.id) {
          bits |= toolResults.get(scopedCall) ?? 0;
          if (bashCalls.has(scopedCall) && usageDiagnostics.has(scopedCall)) row.bash_cli_usage_diagnostic = true;
        }
        else incompleteTools.add(r.id);
      }
      row.tool_outcome_bits[hash(r.id + "\0" + call).slice(0, 32)] = bits;
    }
    if (incompleteTools.has(r.id)) row.tool_coverage_incomplete = true;
    if (buildWave !== null) row.enclosing_build_wave = buildWave;
    const dispatch = sole(r.launches);
    if (dispatch) row.worker_dispatch_id = hash(sessionId + "\0" + dispatch);
    const calls = issued.get(r.id);
    if (calls) row.worker_handoffs = [...calls].map(call => {
      const result = returns.get(call);
      const build = tagged.get(call);
      return {...(build ? {build_wave: build} : {}), dispatch_id: hash(sessionId + "\0" + call), returned_at: result?.at ?? null,
        returned_text_bytes: result?.bytes ?? null, is_error: result?.error ?? null};
    });
    records.push(row);
    if (row.role === "parent") coverage.parent_responses++; else coverage.worker_responses++;
    if ([r.usage.input,r.usage.output,r.usage.cache_read,r.usage.cache_write].every(v => v !== null)) coverage.responses_with_usage++;
    if (issue) coverage.responses_with_issue++;
    if (phase) coverage.responses_with_phase++;
    if (wave) coverage.responses_with_wave++;
    if (r.turn) coverage.responses_with_turn++;
    const model = r.model ?? "unknown", prev = byModel.get(model);
    byModel.set(model, { requests: (prev?.requests ?? 0)+1, usage: prev ? usageSum(prev.usage, r.usage) : r.usage });
  }
  if (coverage.responses_with_usage < records.length) warnings.add("incomplete-token-usage");
  return report();
}

export type RequestMetrics = ReturnType<typeof collectRunRequestMetrics>;
