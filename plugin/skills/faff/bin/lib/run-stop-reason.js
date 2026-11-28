"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validStopToken = validStopToken;
exports.stopReasonFor = stopReasonFor;
exports.ledgerDigest = ledgerDigest;
exports.readLedgerDigest = readLedgerDigest;
exports.resolveStopReason = resolveStopReason;
// === region:factory — run-stop-reason — the stop-token vocabulary and the wave record's canonical token ===
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const PLAIN_TOKENS = ["queue-drained", "all-remaining-parked", "sentry-abort", "converged/both-dry", "non-convergence", "product-incomplete", "governance-admit-failed"];
const BUDGET_DIMS = ["until", "max_attempts", "tokens", "cost", "window"];
const GENERIC_TOKENS = ["queue-drained", "all-remaining-parked"];
const CONVERGED = "converged/both-dry";
const CONVERGED_REASONS = ["drained", "all-parked", "value-inflection"];
const ESCALATE_REASONS = ["non-convergence", "product-incomplete"];
function validStopToken(token) {
    if (PLAIN_TOKENS.includes(token))
        return true;
    const m = /^budget-(hit|escalated)\(([^()]+)\)$/.exec(token);
    const list = m === null ? undefined : m[2];
    if (list === undefined)
        return false;
    return list.split(",").every((d) => BUDGET_DIMS.includes(d));
}
function canonicalReason(verdict, reason) {
    if (verdict === "run-complete") {
        if (CONVERGED_REASONS.includes(reason))
            return CONVERGED;
        return reason.startsWith("budget-hit(") ? reason : null;
    }
    if (verdict === "escalate") {
        return reason.startsWith("budget-escalated(") || ESCALATE_REASONS.includes(reason) ? reason : null;
    }
    return null;
}
function stopReasonFor(verdict, reason) {
    const token = canonicalReason(verdict, reason);
    return token !== null && validStopToken(token) ? token : null;
}
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function canonicalJson(v) {
    if (Array.isArray(v))
        return `[${v.map(canonicalJson).join(",")}]`;
    if (isRecord(v))
        return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
    return JSON.stringify(v) ?? "null";
}
function ledgerDigest(ledger) {
    if (!isRecord(ledger))
        return null;
    const body = canonicalJson({ admitted: ledger.admitted ?? null, outcomes: ledger.outcomes ?? null });
    return crypto.createHash("sha256").update(body).digest("hex");
}
function readLedgerDigest(runDir) {
    try {
        return ledgerDigest(JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8")));
    }
    catch {
        return null;
    }
}
function parseWaveRecord(text, runId, wave) {
    let v;
    try {
        v = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (!isRecord(v) || v.run_id !== runId || v.wave !== wave)
        return null;
    const { verdict, reason, stop_reason, ledger_digest } = v;
    if (typeof verdict !== "string" || typeof reason !== "string")
        return null;
    if (stop_reason !== null && typeof stop_reason !== "string")
        return null;
    if (ledger_digest !== null && typeof ledger_digest !== "string")
        return null;
    return { verdict, reason, stop_reason, ledger_digest };
}
function latestWaveDir(runDir) {
    let latest = null;
    try {
        for (const entry of fs.readdirSync(runDir, { withFileTypes: true })) {
            const m = /^wave-([1-9]\d*)$/.exec(entry.name);
            if (m === null || !entry.isDirectory())
                continue;
            const wave = Number(m[1]);
            if (latest === null || wave > latest.wave)
                latest = { dir: path.join(runDir, entry.name), wave };
        }
    }
    catch { /* an unreadable run dir has no wave records */ }
    return latest;
}
// Older mode files only recorded fold. A git-only run consults even with fold off.
function skipsWaveConsult(runDir) {
    try {
        const mode = JSON.parse(fs.readFileSync(path.join(runDir, "wave-mode.json"), "utf8"));
        return isRecord(mode) && mode.run_id === path.basename(path.resolve(runDir)) &&
            mode.fold === false && mode.consult === false;
    }
    catch {
        return false;
    }
}
function resolveStopReason(runDir, arg, ledger) {
    const keep = (...faults) => ({ token: arg, adopted: false, faults });
    const generic = GENERIC_TOKENS.includes(arg);
    if (!generic && arg !== CONVERGED)
        return keep();
    const latest = latestWaveDir(runDir);
    if (latest === null)
        return keep();
    let text;
    try {
        text = fs.readFileSync(path.join(latest.dir, "run-done.json"), "utf8");
    }
    catch (e) {
        const missing = e instanceof Error && "code" in e && e.code === "ENOENT";
        if (missing && generic && skipsWaveConsult(runDir))
            return keep();
        return keep(missing ? "wave-record-missing" : "wave-record-unreadable");
    }
    const rec = parseWaveRecord(text, path.basename(path.resolve(runDir)), latest.wave);
    if (rec === null)
        return keep("wave-record-unreadable");
    const derived = stopReasonFor(rec.verdict, rec.reason);
    if (derived !== rec.stop_reason)
        return keep("wave-record-inconsistent");
    if (rec.ledger_digest === null || rec.ledger_digest !== ledgerDigest(ledger))
        return keep("wave-record-stale");
    if (arg === CONVERGED)
        return derived === arg ? keep() : keep("close-contradicts-wave-record");
    if (derived === null)
        return keep();
    return { token: derived, adopted: true, faults: [] };
}
