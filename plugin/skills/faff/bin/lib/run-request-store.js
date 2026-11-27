"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureRunRequests = captureRunRequests;
exports.requestReport = requestReport;
// === region:factory — durable observations of native model responses ===
const fs = require("node:fs");
const path = require("node:path");
const run_sdk_turns_1 = require("./run-sdk-turns");
const node_crypto_1 = require("node:crypto");
const run_request_metrics_1 = require("./run-request-metrics");
const { withFileLock } = require("./fs-lock");
const { readLeafNoFollow } = require("./leaf-read");
const filename = "run-request-metrics.json";
const tokenClasses = ["input", "output", "cache_read", "cache_write", "cache_write_5m", "cache_write_1h"];
function readStore(dir) {
    const leaf = readLeafNoFollow(path.join(dir, filename));
    if (leaf.kind === "absent")
        return null;
    if (leaf.kind !== "regular")
        throw Error("invalid request metrics file");
    const store = JSON.parse(leaf.bytes.toString("utf8"));
    if (store?.schema !== 1 || !store.epochs || typeof store.epochs !== "object" || Array.isArray(store.epochs))
        throw Error("invalid request metrics schema");
    for (const e of Object.values(store.epochs)) {
        if (!e || !Array.isArray(e.records) || !Array.isArray(e.warnings))
            throw Error("invalid request metrics epoch");
    }
    return store;
}
function stamp(raw) {
    if (typeof raw !== "string" || !Number.isFinite(Date.parse(raw)))
        return null;
    return new Date(Date.parse(raw)).toISOString();
}
function combine(previous, next) {
    if (!previous)
        return next;
    const [older, newer] = previous.until <= next.until ? [previous, next] : [next, previous];
    const rows = new Map(older.records.map(row => [row.id, row]));
    for (const row of newer.records) {
        const old = rows.get(row.id);
        if (!old) {
            rows.set(row.id, row);
            continue;
        }
        const usage = { ...row.usage };
        for (const field of tokenClasses)
            usage[field] ??= old.usage[field];
        const merged = { ...old, ...row, usage, turn_id: row.turn_id ?? old.turn_id };
        if (old.tool_outcome_bits && row.tool_outcome_bits) {
            const bits = { ...old.tool_outcome_bits };
            for (const [call, evidence] of Object.entries(row.tool_outcome_bits))
                bits[call] = (bits[call] ?? 0) | evidence;
            merged.tool_outcome_bits = bits;
        }
        if (old.worker_handoffs) {
            const calls = new Map(old.worker_handoffs.map(h => [h.dispatch_id, h]));
            for (const h of row.worker_handoffs ?? []) {
                if (h.returned_at || !calls.get(h.dispatch_id)?.returned_at)
                    calls.set(h.dispatch_id, h);
            }
            merged.worker_handoffs = [...calls.values()];
        }
        rows.set(row.id, merged);
    }
    return { ...newer, handoffs_scanned: Boolean(older.handoffs_scanned || newer.handoffs_scanned), records: [...rows.values()], last_observed_until: newer.last_observed_until ?? older.last_observed_until,
        status: newer.status === "unavailable" && older.last_observed_until ? "partial" : newer.status };
}
// Called at workflow boundaries. Measurement failure must never change delivery or ownership.
function captureRunRequests(runDir, root, sessionId, refresh = false) {
    try {
        const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
        const { events } = require("./economics").readRunEvents(runDir);
        const starts = events.filter((e) => e?.type === "run-start" && stamp(e.ts));
        const ends = events.filter((e) => e?.type === "run-end" && stamp(e.ts));
        const spans = ledger.budget?.sessions?.length ? ledger.budget.sessions : [{}];
        let since = stamp(starts[0]?.ts) ?? (spans.length === 1 ? stamp(ledger.owner?.started_at) : null);
        const now = new Date().toISOString();
        const updated = {};
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i], current = i === spans.length - 1;
            const terminal = ["done", "aborted", "aborted-resumable", "failed", "escalated"].includes(ledger.owner?.status);
            const closedAt = stamp(span.closed_at);
            const finalEvent = ends.map(e => stamp(e.ts)).find(ts => ts && since && ts >= since && (!closedAt || ts <= closedAt));
            const abort = ledger.owner?.status === "aborted-resumable" ? stamp(ledger.abort?.at) : null;
            const until = finalEvent ?? closedAt ?? (current && terminal ? abort ?? stamp(ledger.owner?.last_heartbeat) : now);
            if (current || refresh) {
                const id = (current && sessionId) || span.session_id || (current && (ledger.budget?.measure_session_id ||
                    (!refresh && process.env.CLAUDE_CODE_SESSION_ID) || ledger.owner?.session_id));
                const report = (0, run_request_metrics_1.collectRunRequestMetrics)({ runDir, root, sessionId: id || null, since: since ?? "", until: until ?? "" });
                updated[String(i)] = { since: since ?? "", until: until ?? "", last_observed_until: report.requests === null ? null : until,
                    handoffs_scanned: report.requests !== null, status: report.status, warnings: report.warnings, records: report.records };
            }
            since = stamp(span.closed_at);
        }
        const file = path.join(runDir, filename);
        withFileLock(file + ".lock", () => {
            const store = readStore(runDir) ?? { schema: 1, epochs: {} };
            for (const [key, epoch] of Object.entries(updated))
                store.epochs[key] = combine(store.epochs[key], epoch);
            const tmp = file + "." + (0, node_crypto_1.randomUUID)();
            try {
                fs.writeFileSync(tmp, JSON.stringify(store) + "\n", { mode: 0o600, flag: "wx" });
                fs.renameSync(tmp, file);
            }
            finally {
                fs.rmSync(tmp, { force: true });
            }
        });
        return true;
    }
    catch {
        process.stderr.write("faff economics: request metrics could not be saved\n");
        return false;
    }
}
// Admission can precede readiness. Report recorded elapsed time and keep the wait cause unknown.
function buildTiming(dir, details) {
    const { events, malformed } = require("./economics").readRunEvents(dir);
    const admitted = new Map();
    const running = new Map();
    const observations = [];
    let starts = 0, restarts = 0, reversed = 0;
    for (const e of events) {
        if (!e || typeof e.issue !== "string" || !/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(e.issue))
            continue;
        const at = stamp(e.ts);
        if (!at)
            continue;
        const ms = Date.parse(at);
        if (e.type === "issue-admitted") {
            admitted.set(e.issue, ms);
            continue;
        }
        if (e.type !== "build-start" && e.type !== "issue-outcome")
            continue;
        const launch = e.type === "build-start";
        const pending = launch ? admitted : running;
        const from = pending.get(e.issue);
        pending.delete(e.issue);
        if (from !== undefined) {
            if (ms < from)
                reversed++;
            else
                observations.push({ issue: e.issue, at, kind: launch ? "admission_to_start" : "start_to_outcome", seconds: (ms - from) / 1000 });
        }
        if (launch) {
            starts++;
            if (running.has(e.issue))
                restarts++;
            running.set(e.issue, ms);
        }
        else
            admitted.delete(e.issue);
    }
    function distribution(kind) {
        const values = observations.filter(o => o.kind === kind).map(o => o.seconds).sort((a, b) => a - b);
        const n = values.length;
        return { count: n, median_seconds: n ? ((values[Math.floor((n - 1) / 2)] ?? 0) + (values[Math.floor(n / 2)] ?? 0)) / 2 : null,
            max_seconds: values.at(-1) ?? null };
    }
    return { starts, restarts_without_outcome: restarts, open_starts: running.size, reversed_timestamps: reversed, malformed_event_lines: malformed,
        admission_to_start: distribution("admission_to_start"), start_to_outcome: distribution("start_to_outcome"), ...(details ? { observations } : {}) };
}
function toolCounts(bits) {
    const states = Object.values(bits);
    return { calls: states.length, observed_results: states.filter(v => v !== 0).length,
        errors: states.filter(v => v === 2).length, uncertain_results: states.filter(v => v === 3).length };
}
function toolSummary(rows) {
    const measured = rows.filter(r => r.tool_outcome_bits !== undefined);
    if (!measured.length)
        return null;
    let calls = 0, observed = 0, errors = 0, uncertain = 0, failed = 0, withCache = 0, cache = 0;
    for (const row of measured) {
        const n = toolCounts(row.tool_outcome_bits);
        calls += n.calls;
        observed += n.observed_results;
        errors += n.errors;
        uncertain += n.uncertain_results;
        if (!row.tool_coverage_incomplete && n.calls > 0 && n.calls === n.errors) {
            failed++;
            if (row.usage.cache_read !== null) {
                withCache++;
                cache += row.usage.cache_read;
            }
        }
    }
    return { measured_requests: measured.length, unmeasured_requests: rows.length - measured.length,
        incomplete_tool_list_requests: measured.filter(r => r.tool_coverage_incomplete).length,
        calls, observed_results: observed, missing_results: calls - observed, errors, uncertain_results: uncertain,
        all_tools_failed: { requests: failed, requests_with_cache_read_usage: withCache, observed_cache_read_tokens: cache } };
}
function requestReport(dir, ledger, details = false) {
    const store = readStore(dir);
    const epochs = Object.values(store?.epochs ?? {});
    const expected = Math.max(1, ledger.budget?.sessions?.length ?? 0);
    const any = epochs.some(e => e.last_observed_until);
    const rows = [...new Map(epochs.flatMap(e => e.records).map(r => [r.id, r])).values()];
    const requests = any ? rows.length : null;
    const transcriptTurns = rows.length && rows.every(r => r.turn_id) ? new Set(rows.map(r => r.turn_id)).size : null;
    const sdk = (0, run_sdk_turns_1.sdkTurnReceipts)(dir, ledger);
    const shipped = Object.values(ledger.outcomes ?? {}).filter(v => v === "shipped").length;
    function counts(key) {
        const result = new Map();
        for (const row of rows) {
            const k = String(key(row) ?? "unattributed");
            result.set(k, (result.get(k) ?? 0) + 1);
        }
        return Object.fromEntries(result);
    }
    const usage = Object.fromEntries(tokenClasses.map(field => {
        const complete = any && rows.every(row => row.usage[field] !== null);
        return [field, complete ? rows.reduce((sum, row) => sum + (row.usage[field] ?? 0), 0) : null];
    }));
    const parentByWave = new Map();
    const modelUsage = new Map();
    for (const row of rows) {
        if (row.role === "parent") {
            const wave = String(row.wave ?? "unattributed");
            parentByWave.set(wave, (parentByWave.get(wave) ?? 0) + 1);
        }
        const model = row.model ?? "unattributed";
        const total = modelUsage.get(model);
        if (!total)
            modelUsage.set(model, { ...row.usage });
        else
            for (const key of tokenClasses) {
                const value = row.usage[key];
                total[key] = total[key] === null || value === null ? null : total[key] + value;
            }
    }
    const calls = new Map();
    for (const row of rows)
        for (const call of row.worker_handoffs ?? [])
            calls.set(call.dispatch_id, call);
    const handoffs = [...calls.values()];
    const measured = handoffs.filter(call => call.returned_text_bytes !== null);
    const workerHandoffs = epochs.some(e => e.handoffs_scanned) || handoffs.length ? {
        observed_dispatches: handoffs.length,
        observed_returns: handoffs.filter(call => call.returned_at).length,
        sized_returns: measured.length,
        observed_return_text_bytes: measured.reduce((n, call) => n + (call.returned_text_bytes ?? 0), 0),
        scanned_epochs: epochs.filter(e => e.handoffs_scanned).length,
    } : null;
    const engine = require("./budget").readEngineSpend(dir);
    return { separate_engine_spend: { records: engine.records, engines: engine.engines, tokens: engine.totals }, run_id: path.basename(dir), source: "owned-claude-transcripts", status: !any ? "unavailable" : epochs.length < expected || engine.records || engine.malformed || epochs.some(e => e.status !== "observed") ? "partial" : "observed",
        requests, usage, tool_outcomes: toolSummary(rows), build_timing: buildTiming(dir, details), worker_handoffs: workerHandoffs, turns: sdk.turns, sdk_turns: sdk, transcript_turn_ids: transcriptTurns, shipped, observed_requests_per_shipped_issue: requests !== null && shipped ? requests / shipped : null,
        by_role: counts(r => r.role), by_issue: counts(r => r.issue), by_phase: counts(r => r.phase), by_wave: counts(r => r.wave),
        by_model: counts(r => r.model), verification_to_handoff_by_issue: countsSelected(rows),
        epochs: epochs.map(({ records, ...epoch }) => ({ ...epoch, observed_requests: epoch.last_observed_until ? records.length : null })),
        expected_epochs: expected, parent_by_wave: Object.fromEntries(parentByWave), usage_by_model: Object.fromEntries(modelUsage), ...(details ? { records: rows.map(({ tool_outcome_bits, ...row }) => ({ ...row, tool_outcomes: tool_outcome_bits ? toolCounts(tool_outcome_bits) : null })) } : {}) };
}
function countsSelected(rows) {
    const counts = new Map();
    for (const r of rows)
        if (r.role === "worker" && r.issue && r.verification_to_handoff)
            counts.set(r.issue, (counts.get(r.issue) ?? 0) + 1);
    return Object.fromEntries(counts);
}
