"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectRunRequestMetrics = collectRunRequestMetrics;
// === region:factory — run-request-metrics — observations from an owned Claude session epoch ===
const node_crypto_1 = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const budget = require("./budget");
const { phaseWindowsFromEvents, readRunEvents } = require("./economics");
const { readLeafNoFollow } = require("./leaf-read");
function isObj(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
const obj = (v) => isObj(v) ? v : {};
const num = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
const hash = (s) => (0, node_crypto_1.createHash)("sha256").update(s).digest("hex");
const dateMs = (s) => typeof s === "string" && /^\d{4}-\d\d-\d\dT/.test(s) ? Date.parse(s) : NaN;
const issueKey = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const modelId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/;
const classes = ["input", "output", "cache_read", "cache_write", "cache_write_5m", "cache_write_1h"];
function projectedUsage(raw) {
    const u = obj(raw), ttl = obj(u.cache_creation);
    const five = num(ttl.ephemeral_5m_input_tokens), hour = num(ttl.ephemeral_1h_input_tokens);
    const total = num(u.cache_creation_input_tokens) ?? (five !== null && hour !== null ? five + hour : null);
    return { input: num(u.input_tokens), output: num(u.output_tokens), cache_read: num(u.cache_read_input_tokens),
        cache_write: total, cache_write_5m: five, cache_write_1h: hour };
}
function fileText(file) {
    try {
        return readLeafNoFollow(file).bytes?.toString("utf8") ?? null;
    }
    catch {
        return null;
    }
}
// A legacy child sits next to the parent. Newer clients nest agent files under
// the parent session. In either layout each file still has to identify its owner.
function children(dir, optional, warnings) {
    try {
        if (!fs.lstatSync(dir).isDirectory())
            return [];
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter(entry => entry.isFile() && /^agent-[A-Za-z0-9_-]+\.jsonl$/.test(entry.name))
            .map(entry => path.join(dir, entry.name)).sort();
    }
    catch (err) {
        if (!optional || obj(err).code !== "ENOENT")
            warnings.add("worker-discovery-unavailable");
        return [];
    }
}
// Read one JSON line at a time. A transcript can outgrow the heap. Preserve
// partial coverage on a malformed or unusually large (>32 MiB) record.
function* lines(file) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        if (!fs.fstatSync(fd).isFile())
            throw new Error("not-regular");
        const chunk = Buffer.allocUnsafe(128 * 1024);
        let carry = [], length = 0;
        while (true) {
            const n = fs.readSync(fd, chunk, 0, chunk.length, null);
            if (!n)
                break;
            let start = 0;
            while (start < n) {
                const newline = chunk.subarray(start, n).indexOf(10);
                const end = newline < 0 ? n : start + newline;
                length += end - start;
                if (length <= 32 * 1024 * 1024)
                    carry.push(Buffer.from(chunk.subarray(start, end)));
                else
                    carry = [];
                if (newline >= 0) {
                    yield length <= 32 * 1024 * 1024 ? Buffer.concat(carry).toString("utf8") : null;
                    carry = [];
                    length = 0;
                }
                start = end + 1;
            }
        }
        if (length)
            yield length <= 32 * 1024 * 1024 ? Buffer.concat(carry).toString("utf8") : null;
    }
    finally {
        fs.closeSync(fd);
    }
}
function owner(file) {
    for (const line of lines(file)) {
        if (!line)
            continue;
        try {
            const row = obj(JSON.parse(line));
            const sid = row.sessionId ?? row.session_id;
            if (typeof sid === "string" && sid)
                return sid;
        }
        catch { /* old children can start with a partial line */ }
    }
    return null;
}
function metadata(file) {
    try {
        return obj(JSON.parse(fileText(file) ?? "null"));
    }
    catch {
        return {};
    }
}
function sole(values) {
    return values.size === 1 ? [...values][0] ?? null : null;
}
// Only issue keys independently seen in this ledger or event stream may escape the collector.
function descriptionFacts(value, allowed) {
    const description = typeof value === "string" ? value : "";
    const issues = new Set((description.match(/\b[A-Za-z][A-Za-z0-9]*-\d+\b/g) ?? []).filter(k => allowed.has(k)));
    const waves = new Set();
    for (const m of description.matchAll(/\bwave[ -]([1-9][0-9]*)\b/ig)) {
        const n = num(Number(m[1]));
        if (n !== null)
            waves.add(n);
    }
    return { issues, waves };
}
function boundaries(events, allowed) {
    const windows = phaseWindowsFromEvents(events);
    return windows.filter(w => allowed.has(w.issue)).map(w => ({ issue: w.issue, phase: w.phase,
        start: dateMs(w.start_ts), end: dateMs(w.end_ts) }));
}
// A run-done capture is written by the wave consult with its actual ordinal. Bound
// a wave only between its first work event and its consult, and only when numbered
// boundaries are consecutive. Bootstrap, gaps and reporting stay unattributed.
function waveWindows(events, run) {
    const waves = [];
    const prefix = run + "/__run__/run-done/";
    let previous = 0, start = NaN;
    for (const event of events.map(obj)) {
        const ms = dateMs(event.ts);
        if (!Number.isFinite(ms))
            continue;
        if (!Number.isFinite(start) && ["prep-start", "issue-admitted", "build-start"].includes(String(event.type)))
            start = ms;
        const data = obj(event.data);
        if (event.type !== "decision-capture" || data.kernel !== "run-done" || event.issue !== "__run__" ||
            typeof data.correlation_id !== "string" || !data.correlation_id.startsWith(prefix))
            continue;
        const ordinal = data.correlation_id.slice(prefix.length);
        if (!/^[1-9][0-9]*$/.test(ordinal))
            continue;
        const wave = Number(ordinal);
        if (wave === previous + 1 && Number.isFinite(start) && start <= ms)
            waves.push({ wave, start, end: ms });
        previous = wave;
        start = NaN;
    }
    return waves;
}
function usageSum(previous, next) {
    const sum = { ...previous };
    for (const key of classes) {
        const a = previous[key], b = next[key];
        sum[key] = a !== null && b !== null ? a + b : null;
    }
    return sum;
}
function collectRunRequestMetrics({ runDir, root, sessionId, env = process.env, since, until }) {
    const warnings = new Set();
    const records = [];
    const byModel = new Map();
    const coverage = { files: 0, parent_responses: 0, worker_responses: 0, responses_with_usage: 0,
        responses_with_issue: 0, responses_with_phase: 0, responses_with_wave: 0, responses_with_turn: 0 };
    let available = false;
    function report() {
        const turns = records.length && coverage.responses_with_turn === records.length
            ? new Set(records.map(r => r.turn_id)).size : null;
        const status = !available ? "unavailable" : warnings.size ? "partial" : "observed";
        return { schema: 1, status,
            requests: available ? records.length : null, turns, coverage, warnings: [...warnings].sort(),
            by_model: Object.fromEntries(byModel), records };
    }
    const lo = dateMs(since), hi = dateMs(until);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) {
        warnings.add("epoch-boundaries-unavailable");
        return report();
    }
    if (!sessionId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId)) {
        warnings.add("session-unavailable");
        return report();
    }
    const base = budget.transcriptBaseDir(root, env);
    const parentFile = path.join(base, sessionId + ".jsonl");
    let files;
    if (typeof budget.ownedChildTranscriptFiles === "function") {
        files = [parentFile, ...budget.ownedChildTranscriptFiles(base, sessionId, null, budget.NATIVE_RESPONSE_METER)];
    }
    else {
        const owned = path.join(base, sessionId);
        let nested = [];
        try {
            if (fs.lstatSync(owned).isDirectory())
                nested = children(path.join(owned, "subagents"), true, warnings);
        }
        catch (err) {
            if (obj(err).code !== "ENOENT")
                warnings.add("worker-discovery-unavailable");
        }
        files = [parentFile, ...children(base, false, warnings), ...children(path.join(base, "subagents"), true, warnings), ...nested];
    }
    const ledger = metadata(path.join(runDir, "run-ledger.json"));
    const { events, malformed } = readRunEvents(runDir);
    if (malformed)
        warnings.add("malformed-event");
    const keys = [...Object.keys(obj(ledger.outcomes)), ...(Array.isArray(ledger.admitted) ? ledger.admitted : []), ...events.map(e => obj(e).issue)];
    const allowed = new Set(keys.filter((key) => typeof key === "string" && issueKey.test(key)));
    const windows = boundaries(events, allowed);
    const waves = waveWindows(events, path.basename(runDir));
    // The standalone graft run ID is bound to its issue at mint. Other one-item
    // batches can still do unrelated prep, so admitted cardinality alone is insufficient.
    const standalone = /-graft-([A-Za-z][A-Za-z0-9]*-\d+)$/.exec(path.basename(runDir))?.[1];
    const standaloneIssue = standalone && allowed.has(standalone) ? standalone : null;
    const candidates = new Map();
    const verifications = new Map();
    const handoffs = new Map();
    function mark(table, issue, ms) {
        if (typeof issue !== "string" || !allowed.has(issue) || !Number.isFinite(ms))
            return;
        const times = table.get(issue) ?? [];
        times.push(ms);
        table.set(issue, times);
    }
    for (const [idx, file] of files.entries()) {
        try {
            if (idx && typeof budget.ownedChildTranscriptFiles !== "function" && owner(file) !== sessionId)
                continue;
            const hints = idx ? descriptionFacts(metadata(file.replace(/\.jsonl$/, ".meta.json")).description, allowed) : descriptionFacts(null, allowed);
            const verifyTools = new Set();
            for (const line of lines(file)) {
                if (line === null) {
                    warnings.add("oversize-transcript-row");
                    continue;
                }
                if (!line.trim())
                    continue;
                let row;
                try {
                    row = obj(JSON.parse(line));
                }
                catch {
                    warnings.add("malformed-transcript-row");
                    continue;
                }
                if ([row.sessionId, row.session_id].some(id => typeof id === "string" && id !== sessionId))
                    continue;
                const msg = obj(row.message), ms = dateMs(row.timestamp);
                const blocks = Array.isArray(msg.content) ? msg.content.map(obj) : [];
                // A structured receipt is evidence of a successful verification. A command invocation alone is not.
                if (row.type === "user")
                    for (const b of blocks) {
                        if (b.type !== "tool_result" || b.is_error || typeof b.tool_use_id !== "string" || !verifyTools.has(b.tool_use_id))
                            continue;
                        const payload = typeof b.content === "string" ? b.content : obj(Array.isArray(b.content) && b.content.length === 1 ? b.content[0] : null).text;
                        if (typeof payload !== "string")
                            continue;
                        try {
                            const result = obj(JSON.parse(payload)), spec = obj(result.spec);
                            if (result.action === "verify-criteria" && spec.token === "verified")
                                mark(verifications, spec.issue, ms);
                        }
                        catch { /* decorated output does not establish a boundary */ }
                    }
                if ((row.type !== "assistant" && msg.role !== "assistant") || msg.model === "<synthetic>" || row.isApiErrorMessage === true)
                    continue;
                const id = typeof budget.nativeResponseId === "function" ? budget.nativeResponseId(row, budget.NATIVE_RESPONSE_METER)
                    : typeof msg.id === "string" && /^msg_[A-Za-z0-9_-]+$/.test(msg.id) ? msg.id : null;
                if (!id || !Number.isFinite(ms)) {
                    if (!Number.isFinite(ms) || (ms >= lo && ms < hi))
                        warnings.add(!id ? "assistant-response-id-unavailable" : "response-time-unavailable");
                    continue;
                }
                if (ms >= hi)
                    continue;
                const role = idx > 0 || row.isSidechain === true || typeof row.parent_tool_use_id === "string" ? "worker" : "parent";
                const r = candidates.get(id) ?? { id, ms, usageAt: -Infinity, usage: projectedUsage(null), role, model: null,
                    issues: new Set(), waves: new Set(), turn: null };
                candidates.set(id, r);
                r.ms = Math.min(r.ms, ms);
                if (role === "worker")
                    r.role = role;
                if (typeof msg.model === "string" && modelId.test(msg.model))
                    r.model = msg.model;
                if (typeof row.turnId === "string" && row.turnId)
                    r.turn = hash(sessionId + "\0" + (idx ? path.basename(file) : "parent") + "\0" + row.turnId);
                const usage = msg.usage ?? row.usage;
                if (usage && ms >= r.usageAt && ms < hi) {
                    r.usage = projectedUsage(usage);
                    r.usageAt = ms;
                }
                for (const key of hints.issues)
                    r.issues.add(key);
                for (const n of hints.waves)
                    r.waves.add(n);
                for (const b of blocks) {
                    if (b.type === "text" && role === "worker" && typeof b.text === "string" && b.text.trimStart().startsWith("{")) {
                        try {
                            const receipt = obj(JSON.parse(b.text));
                            if (receipt.outcome === "pr-ready")
                                mark(handoffs, receipt.issue, ms);
                        }
                        catch { /* prose cannot establish a handoff */ }
                    }
                    if (b.type !== "tool_use")
                        continue;
                    const input = obj(b.input);
                    for (const key of [input.issue, input.id, input.issueId]) {
                        if (typeof key === "string" && allowed.has(key))
                            r.issues.add(key);
                    }
                    if (b.name === "Bash" && typeof input.command === "string" && typeof b.id === "string" &&
                        /(?:^|[;\n&])\s*(?:faff|"\$faff"|\$faff)\s+graft\s+verify-build(?:\s|$)/.test(input.command))
                        verifyTools.add(b.id);
                }
            }
            coverage.files++;
            available = true;
        }
        catch {
            warnings.add(idx ? "unreadable-worker-transcript" : "unreadable-parent-transcript");
        }
    }
    for (const r of [...candidates.values()].filter(r => r.ms >= lo && r.ms < hi).sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id))) {
        const issue = r.issues.size ? sole(r.issues) : standaloneIssue;
        for (const w of waves)
            if (w.start <= r.ms && r.ms <= w.end)
                r.waves.add(w.wave);
        const wave = sole(r.waves);
        const active = windows.filter(w => (!issue || w.issue === issue) && w.start <= r.ms && r.ms <= w.end);
        const phase = sole(new Set(active.map(w => w.phase))) ?? (issue && issue === standaloneIssue ? "build" : null);
        const interval = Boolean(issue) && active.some(w => w.phase === "build" && (verifications.get(w.issue) ?? []).some(v => v >= w.start && v <= r.ms &&
            (handoffs.get(w.issue) ?? []).some(h => h >= r.ms && h <= w.end)));
        const row = { id: hash(r.id), at: new Date(r.ms).toISOString(), role: r.role, model: r.model,
            issue, wave, phase, verification_to_handoff: interval || null, turn_id: r.turn, usage: r.usage };
        records.push(row);
        if (row.role === "parent")
            coverage.parent_responses++;
        else
            coverage.worker_responses++;
        if ([r.usage.input, r.usage.output, r.usage.cache_read, r.usage.cache_write].every(v => v !== null))
            coverage.responses_with_usage++;
        if (issue)
            coverage.responses_with_issue++;
        if (phase)
            coverage.responses_with_phase++;
        if (wave)
            coverage.responses_with_wave++;
        if (r.turn)
            coverage.responses_with_turn++;
        const model = r.model ?? "unknown", prev = byModel.get(model);
        byModel.set(model, { requests: (prev?.requests ?? 0) + 1, usage: prev ? usageSum(prev.usage, r.usage) : r.usage });
    }
    if (coverage.responses_with_usage < records.length)
        warnings.add("incomplete-token-usage");
    return report();
}
